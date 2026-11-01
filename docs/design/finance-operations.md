# Finance Operations — Technical Design

> 状态：`ACTIVE`
> Owner：Finance Operations
> 权威来源：`solution.md` §28
> 来源：`solution.md` §28.0–§28.29（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## 28.0 Scope of This Section

A–S outputs as required by `document.md §33.5 / §33.39 / §33.40` and the Phase §6 Design Principles:

```text
A.  Finance domain architecture & ownership
B.  Recognition state model
C.  Canonical AR/AP open-item model
D.  Due-schedule model
E.  Provisional model
F.  Settlement/allocation model
G.  Treasury movement model
H.  Invoice model
I.  Bank statement/reconciliation model
J.  Business close model
K.  Integration adapters
L.  Permission model
M.  API/route architecture
N.  Mobile information architecture
O.  Migration / convergence strategy
P.  Transaction / locking model
Q.  MySQL race design (15)
R.  UAT traceability (32)
S.  Implementation waves (5)
```

Capability / UAT / RACE / Wave 计数不变（58 / 32 / 15 / ≤5）。

## 28.1 Architecture & Ownership

### 28.1.1 Canonical Service Ownership & Module Responsibility Map

按 `document.md §33.1` ownership，Finance Operations Domain 形成如下 canonical service ownership（命名空间冻结；后续 Implementation 不得新增第二引擎）：

> **本节不冻结 source-file count**。下表为 canonical service ownership / writer responsibility / domain module responsibility map；物理文件数量可在 Implementation 阶段自由调整（如拆分 helper module、合并 co-located route + service、引入 internal lib）而**不重开 Design**。

```text
Finance Operations Canonical Services
  finance-recognition-policy        (FO01 / FO02)
  finance-parameters                (FO01)
  finance-terms                     (FO03)
  finance-due-schedule              (FO04)
  finance-settlement-scheme         (FO05)

  finance-ar-init                   (FO06)
  finance-ap-init                   (FO07)
  finance-treasury-init             (FO08)

  finance-ar-open-item              (FO09 / FO11)
  finance-ap-open-item              (FO10 / FO12)
  finance-provisional-conversion    (FO13)
  finance-manual-ar-ap              (FO14)
  finance-counterparty-transfer     (FO15)

  finance-collection                (FO16)
  finance-payment                   (FO17)
  finance-allocation                (FO18)
  finance-reconciliation            (FO19 / FO20 / FO21)
  finance-settlement-reversal       (FO22)
  finance-unapplied-balance         (FO23 / FO24 / FO25 / FO26)

  finance-write-off                 (FO27)
  finance-bad-debt-provision        (FO28)

  finance-sales-invoice             (FO29 / FO31 / FO32 / FO33 / FO34 / FO36)
  finance-purchase-invoice          (FO30 / FO31 / FO35 / FO36)

  finance-settlement-account        (FO37 / FO38)  ← extends bank_accounts (§28.11.1)
  finance-treasury-movement         (FO39)
  finance-treasury-cash             (FO40)
  finance-treasury-bank-transfer    (FO41)
  finance-notes                     (FO42 / FO43)
  finance-payment-request           (FO44)
  finance-cash-count                (FO45)

  finance-bank-statement            (FO46)
  finance-bank-import               (FO47)
  finance-bank-reconciliation       (FO48 / FO49)

  finance-business-close            (FO51 / FO52 / FO53)

  finance-reports                   (FO54 / FO55 / FO56)

Integration-Backed Services
  finance-source-adapter            (FO57)  [INTEGRATION-BACKED]
  finance-accounting-adapter        (FO58)  [INTEGRATION-BACKED]
  finance-gl-reconcile              (FO50)  [INTEGRATION-BACKED]

Converged Existing Canonical Implementations
  settlement-core  ← used by FO16 / FO17 / FO18
  settlement       ← FO21 records & trace
  financial-controls ← FO22 / FO23–FO26 / FO27
  discounts        ← FO26 / sales-discount finance effect
  commercial-golive ← FO06 / FO07 / FO08 initialization
```

禁止命名（document.md §33.43）：

```text
settlement-v2
treasury-v2
new_ar_ledger
new_ap_ledger
finance-recognition-policy-v2
finance-treasury-movement-v2
```

Canonical Writers（implementation 阶段必须由以下唯一入口承载；其它任何代码路径不得直接写入对应表）：

```text
recognizeFinanceExposure              → account_receivables / account_payables (canonical open-item header; refreshOpenAmount rebuilds finance_open_item_effects VIEW projection)
applyTreasuryMovement                 → finance_treasury_movements + bank_accounts.balance_cents cache
convertProvisionalToFinancial         → account_receivables / account_payables (canonical header; conversion_state + converted_open_item_id)
executeCounterpartyTransfer           → account_receivables / account_payables (canonical header; provisional_origin_id / converted_open_item_id lineage)
assertFinanceBusinessDateOpen         → finance_business_close_state (FOR UPDATE)
refreshOpenAmount(openItemId)         → reads finance_open_item_effects VIEW only (chain: source facts → VIEW → equation → cached open_amount_cents; §28.3.2.1)
refreshSettlementAccountBalance(id)   → derived projection from finance_treasury_movements (§28.11.3)
emitAccountingEvent                   → Accounting & Analytics existing voucher adapter (§28.14.2)
```

`finance_open_item_effects` 是 DERIVED SQL VIEW（§28.3.4），不归入任何 writer；任何路径均不 INSERT / UPDATE / DELETE 该 view（view 不允许）。

### 28.1.2 Canonical Table Inventory (Exact)

下表是 Finance Operations Domain 唯一权威 table inventory；每一个 distinct physical relation 单独列出（header 与 line table 各自计数）。

#### 28.1.2.1 EXISTING_CONVERGE（已存在 / additive 扩展；非 NEW）

| Table | Owner | Purpose | PK | Critical Unique |
|---|---|---|---|---|
| `account_receivables` | finance-ar-open-item | canonical open-item header AR | `id TEXT` | `voucher_no TEXT UNIQUE` |
| `account_payables` | finance-ap-open-item | canonical open-item header AP | `id TEXT` | `voucher_no TEXT UNIQUE` |
| `payment_collections` | finance-collection | collection document | `id TEXT` | `collection_no TEXT UNIQUE` |
| `payment_disbursements` | finance-payment | payment document | `id TEXT` | `disbursement_no TEXT UNIQUE` |
| `payment_collection_items` | finance-allocation | collection allocation line | `id TEXT` | `(payment_collection_id, open_item_id)` composite unique |
| `payment_disbursement_items` | finance-allocation | payment allocation line | `id TEXT` | `(payment_disbursement_id, open_item_id)` composite unique |
| `financial_credit_adjustments` | financial-controls | commercial credit adjustment history | `id TEXT` | per-row |
| `settlement_unapplied_balances` | finance-unapplied-balance | unapplied PREPAYMENT / CREDIT | `id TEXT` | `(source_type, source_id) UNIQUE` |
| `balance_applications` | finance-unapplied-balance | unapplied → open-item application | `id TEXT` | `application_no TEXT UNIQUE` |
| `financial_refunds` | finance-unapplied-balance | unapplied balance refund | `id TEXT` | `refund_no TEXT UNIQUE` |
| `financial_refund_reversals` | finance-unapplied-balance | refund reversal | `id TEXT` | `refund_id TEXT UNIQUE` |
| `settlement_reversals` | finance-settlement-reversal | settlement reversal header | `id TEXT` | `reversal_no TEXT UNIQUE` |
| `settlement_reversal_items` | finance-settlement-reversal | reversal component line | `id TEXT` | `(reversal_id, component_type, original_component_id) UNIQUE` |
| `financial_write_offs` | finance-write-off | write-off header | `id TEXT` | `write_off_no TEXT UNIQUE` |
| `financial_write_off_reversals` | finance-write-off | write-off reversal | `id TEXT` | `write_off_id TEXT UNIQUE` |
| `bank_statements` | finance-bank-statement | bank statement header | `id TEXT` | per-row |
| `bank_statement_items` | finance-bank-statement | bank statement line | `id TEXT` | `import_fingerprint TEXT UNIQUE` |
| `bank_accounts` | finance-settlement-account | **canonical operational settlement account master (FO37)**; additive extend CASH/BANK + opening_balance_cents + accounting_subject_id; `balance_cents` = derived cache | `id TEXT` | `code TEXT UNIQUE` (after additive extend) |
| `sales_invoices` | finance-sales-invoice | sales invoice document | `id TEXT` | `invoice_no TEXT UNIQUE` |
| `supplier_bills` | finance-purchase-invoice | purchase invoice document | `id TEXT` | `bill_no TEXT UNIQUE` |
| `commercial_credit_notes` | finance-sales-invoice | credit/red note document | `id TEXT` | `note_no TEXT UNIQUE` |

#### 28.1.2.2 NEW（Implementation 阶段 additive 新建）

| # | Table | Owner | Purpose | PK | Critical Unique |
|---|---|---|---|---|---|
| 1 | `finance_parameters` | finance-parameters | FO01 finance parameters singleton | `id TEXT` | `code TEXT UNIQUE` |
| 2 | `finance_recognition_policy` | finance-recognition-policy | FO02 recognition policy per (side, source_type, source_id) | `id TEXT` | `(side, source_type, source_id, effective_date) UNIQUE` |
| 3 | `finance_payment_terms` | finance-terms | FO03 collection/payment terms master | `id TEXT` | `code TEXT UNIQUE` |
| 4 | `finance_due_schedule_lines` | finance-due-schedule | FO04 multi-due-date schedule line | `id TEXT` | `(side, open_item_id, sequence) UNIQUE` |
| 5 | `finance_settlement_schemes` | finance-settlement-scheme | FO05 reconciliation scheme config | `id TEXT` | `(side, scheme_code) UNIQUE` |
| 6 | `finance_counterparty_transfers` | finance-counterparty-transfer | FO15 transfer header | `id TEXT` | `transfer_no TEXT UNIQUE` |
| 7 | `finance_counterparty_transfer_lines` | finance-counterparty-transfer | FO15 transfer line | `id TEXT` | `(transfer_id, source_open_item_id, side) UNIQUE` |
| 8 | `finance_bad_debt_provisions` | finance-bad-debt-provision | FO28 bad-debt provision header | `id TEXT` | `provision_no TEXT UNIQUE` |
| 9 | `finance_invoice_source_links` | finance-invoice-cardinality | FO31 invoice source cardinality | `id TEXT` | `(invoice_id, invoice_side, source_type, source_id, source_line_id) UNIQUE` |
| 10 | `finance_treasury_movements` | finance-treasury-movement | FO39 canonical treasury movement | `id TEXT` | `idempotency_key TEXT UNIQUE` |
| 11 | `finance_notes` | finance-notes | FO42/FO43 notes receivable/payable | `id TEXT` | `note_no TEXT UNIQUE` |
| 12 | `finance_payment_requests` | finance-payment-request | FO44 payment request | `id TEXT` | `request_no TEXT UNIQUE` |
| 13 | `finance_cash_counts` | finance-cash-count | FO45 cash count header | `id TEXT` | `count_no TEXT UNIQUE` |
| 14 | `finance_cash_count_lines` | finance-cash-count | FO45 cash count denomination line | `id TEXT` | `(count_id, denomination) UNIQUE` |
| 15 | `finance_bank_statement_imports` | finance-bank-import | FO47 bank statement import batch | `id TEXT` | `(file_name, fingerprint) UNIQUE` |
| 16 | `finance_bank_reconciliations` | finance-bank-reconciliation | FO48 reconciliation header (canonical) | `id TEXT` | `(settlement_account_id, statement_id) UNIQUE` |
| 17 | `finance_bank_reconciliation_matches` | finance-bank-reconciliation | FO48 reconciliation match line | `id TEXT` | `(reconciliation_id, statement_line_id, treasury_movement_id) UNIQUE` |
| 18 | `finance_business_close_state` | finance-business-close | **stable control anchor** (FO51/FO52/FO53 RACE-15 lock target; seeded with exactly 3 rows: AR / AP / TREASURY) | `close_type TEXT` | `close_type PRIMARY KEY` |
| 19 | `finance_business_closures` | finance-business-close | FO51/FO52/FO53 close / reopen history rows | `id TEXT` | `(close_type, closed_through_date) UNIQUE` |

#### 28.1.2.3 COMPATIBILITY（仅 read 投影 / 兼容层；不得作为 active canonical master）

> **分类互斥**：每张物理表**恰好**归入 EXISTING_CONVERGE / NEW / COMPATIBILITY 之一；不得重复列出。

| Table | Status | Purpose |
|---|---|---|
| `cash_journals` | COMPATIBILITY document/read model | §28.11.4 — write path 迁移至 `applyTreasuryMovement`；保留为 read projection / report |
| `bills` | COMPATIBILITY legacy | legacy notes; migration 到 `finance_notes` 后 read-only |
| `bank_reconciliations` | COMPATIBILITY legacy | legacy reconciliation header; canonical 由 `finance_bank_reconciliations` 接管；legacy 路径 read-only |
| `period_closures` | COMPATIBILITY / Accounting & Analytics | accounting period close 由 Accounting & Analytics 拥有；Finance Operations 不写 |

#### 28.1.2.4 DERIVED_VIEW（DERIVED SQL VIEW，非物理表）

| # | View | Owner | Purpose | Logical Uniqueness |
|---|---|---|---|---|
| 1 | `finance_open_item_effects` | finance-open-item-effect | DERIVED SQL VIEW 投影 4 canonical effect categories（§28.3.4）；non-authoritative / non-persisted / rebuild-free；no INSERT / UPDATE / DELETE permitted | `(source_table, source_effect_id)` |

> **此 view 是唯一 Finance Operations 派生 SQL VIEW**；任何其它对象不归入 DERIVED_VIEW。

#### 28.1.2.5 Exact Counts

```text
physical EXISTING_CONVERGE tables = 21
physical NEW tables                = 19  (header + line 分计)
physical COMPATIBILITY tables      = 4
derived SQL views                  = 1

分类互斥：每张物理表恰好归入 EXISTING_CONVERGE / NEW / COMPATIBILITY 之一；
view 单独归入 DERIVED_VIEW；无重复列出。
```

EXISTING_CONVERGE（21）：

```text
account_receivables
account_payables
payment_collections
payment_disbursements
payment_collection_items
payment_disbursement_items
financial_credit_adjustments
settlement_unapplied_balances
balance_applications
financial_refunds
financial_refund_reversals
settlement_reversals
settlement_reversal_items
financial_write_offs
financial_write_off_reversals
bank_statements
bank_statement_items
bank_accounts                          ← canonical settlement account master (§28.11.1)
sales_invoices
supplier_bills
commercial_credit_notes
```

COMPATIBILITY（4）：

```text
cash_journals              (read projection; §28.11.4)
bills                      (legacy → finance_notes migration)
bank_reconciliations       (legacy → finance_bank_reconciliations canonical)
period_closures            (Accounting & Analytics compatibility)
```

DERIVED_VIEW（1）：

```text
finance_open_item_effects  (DERIVED SQL VIEW over canonical source facts; §28.3.4)
```

NEW 表 #1..#19 物理表清单：

```text
  1  finance_parameters
  2  finance_recognition_policy
  3  finance_payment_terms
  4  finance_due_schedule_lines
  5  finance_settlement_schemes
  6  finance_counterparty_transfers
  7  finance_counterparty_transfer_lines
  8  finance_bad_debt_provisions
  9  finance_invoice_source_links
  10 finance_treasury_movements
  11 finance_notes
  12 finance_payment_requests
  13 finance_cash_counts
  14 finance_cash_count_lines
  15 finance_bank_statement_imports
  16 finance_bank_reconciliations
  17 finance_bank_reconciliation_matches
  18 finance_business_close_state       ← stable anchor (3 seeded rows)
  19 finance_business_closures
```

精确 NEW 表数 = **19**（header + line 分计；唯一权威 inventory）。

本表为唯一权威 inventory；后续 Implementation 不得新建额外 canonical 表 / view（仅允许 additive migration / index）。

`bank_accounts` 归入 EXISTING_CONVERGE（canonical master）。`finance_open_item_effects` 是 DERIVED VIEW，**不**是 NEW 物理表。`bank_reconciliations` 与 `period_closures` 归入 COMPATIBILITY（不归 EXISTING_CONVERGE）。



### 28.1.2 Canonical HTTP Dispatch

`server/app.js` 是 **only** HTTP lifecycle + auth + thin dispatch 层。

每条 finance route 必须：

```text
1. 路由 descriptor 仅声明 route facts（method, path, owner, permission, idempotencyKey）
2. handler = server/modules/<owner>.js 中 exports.fn
3. permission 后端 fail closed（§28.12）
4. transaction 由 owner module 负责（§28.16）
5. audit 由 owner module 负责
```

`ownedRouteTable` 由 `server/modules/finance-routes.js`（或现有 `app.js` route-table 段）单一承载，§28.13 详述。

### 28.1.3 Frontend Domain Mapping

`src/navigation/domainMetadata.js` 中 `finance-operations` taxonomy 已存在；本 Domain Closure 不得破坏既有 `finance-operations` metadata，但 sub-functions 通过 §28.14 mobile IA 收敛。

历史 frozen page 仍可保留 disabled / contextual route，**不得**复活 `cash-journals` / `bills` / `fixed-assets` 作为 active launcher。

## 28.2 Recognition State Model

### 28.2.1 Three Canonical Models

```text
DIRECT_BUSINESS_OPEN_ITEM
INVOICE_DRIVEN_OPEN_ITEM
PROVISIONAL_TO_FINANCIAL
```

#### 28.2.1.1 DIRECT_BUSINESS_OPEN_ITEM

- Confirmed business event（`SALES_DELIVERY` confirm / `PURCHASE_RECEIPT` confirm）→ exactly one final open item created at confirmation time。
- Later invoice / bill 仅 link，不创建 second final open item，不增加 open exposure。
- Source identity 在 invoice post 时仍可识别；`open_item.invoice_id` / `open_item.invoice_line_id` 为 additive reference column。

#### 28.2.1.2 INVOICE_DRIVEN_OPEN_ITEM

- Delivery / receipt 仅产生 operational evidence；**不**创建 AR / AP open item。
- Posted sales invoice → one final AR open item。
- Posted supplier bill / purchase invoice → one final AP open item。
- Source cardinality preserved（§28.10）。

#### 28.2.1.3 PROVISIONAL_TO_FINANCIAL

- `PURCHASE_RECEIPT` confirm 在该 mode 下创建 PROVISIONAL AP open item。
- Posted supplier bill 通过 `convertProvisionalToFinancial`：
  - 必须 reverse PROVISIONAL open item（保留 `provisional_conversion.provisional_open_item_id` + reversal movement evidence）。
  - 必须 create FINAL open item with `source_type = 'SUPPLIER_BILL'` / `source_id = <bill_id>`。
- provisional 与 final 暴露不得 double-count；Settlement 仅 final 参与 `payment_disbursements` allocation（除非 future Requirement 显式放宽）。
- AR 等价 semantics：`SALES_DELIVERY` → PROVISIONAL AR → posted sales invoice → reverse + create FINAL。

### 28.2.2 Recognition Policy (FO01 / FO02)

新增 `finance_recognition_policy` 表 / owner module：

```sql
CREATE TABLE IF NOT EXISTS finance_recognition_policy (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL CHECK(side IN ('AR','AP')),
  recognition_mode TEXT NOT NULL CHECK(recognition_mode IN ('DIRECT_BUSINESS_OPEN_ITEM','INVOICE_DRIVEN_OPEN_ITEM','PROVISIONAL_TO_FINANCIAL')),
  source_type TEXT NOT NULL,        -- e.g. SALES_DELIVERY / PURCHASE_RECEIPT / SALES_INVOICE / SUPPLIER_BILL
  source_id TEXT,                   -- nullable for site-wide default
  effective_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recognition_policy_lookup ON finance_recognition_policy(side, source_type, active, effective_date);
```

- effective default = site-wide row（`source_id IS NULL`），可在 effective_date 之后替换。
- lookup algorithm：`active=1 AND effective_date <= business_date ORDER BY effective_date DESC, id ASC LIMIT 1`；优先 site-wide，再按 source-level override。
- `finance-recognition-policy.js::resolveRecognitionPolicy(side, sourceType, sourceId, businessDate)` 是唯一 policy resolver；其他 handler 不得重新实现选择逻辑。

### 28.2.3 Recognition Adapter (FO23 / §28.4)

唯一 entry：

```text
recognizeFinanceExposure(input: {
  side: 'AR' | 'AP',
  recognitionMode,
  source: { sourceType, sourceId, sourceNo, sourceLineId? },
  invoice: { id?, no?, businessDate } | null,
  amountCents,
  businessDate
}) -> { openItemId, itemKind: 'FINAL' | 'PROVISIONAL', recognizedCents, links }
```

各 Domain handler 仅调用此 adapter：

```text
SALES_DELIVERY.confirm      → recognizeFinanceExposure(DIRECT_BUSINESS_OPEN_ITEM)
PURCHASE_RECEIPT.confirm    → recognizeFinanceExposure(per policy)
SALES_INVOICE.post          → recognizeFinanceExposure(INVOICE_DRIVEN_OPEN_ITEM)
SUPPLIER_BILL.post          → recognizeFinanceExposure(per policy)
```

禁止在 purchase receipt / sales delivery / supplier bill / sales invoice handler 中硬编码 open item 创建；必须经 adapter。

## 28.3 Canonical AR / AP Open-Item Model (MODEL B — Canonical Source Facts)

### 28.3.0 Effect Authority Decision — MODEL B + 4 Canonical Categories

**本 Domain Closure 显式选择 MODEL B：Canonical Source Facts。**

```text
MODEL B — Canonical Source Facts

existing authoritative business / effect tables
  payment_collection_items
  payment_disbursement_items
  financial_credit_adjustments
  balance_applications
  financial_refunds
  settlement_reversal_items       (component_type='ALLOCATION' only contributes to AR/AP)
  financial_write_offs
  financial_write_off_reversals
  commercial_credit_notes         (source-document evidence; financial effect
                                    materializes via financial_credit_adjustments)
  sales_discounts / purchase_discounts (chain via financial_credit_adjustments)
  return effects (chain via financial_credit_adjustments)
= canonical economic facts

refreshOpenAmount()
  reads the finance_open_item_effects VIEW only (DERIVED SQL VIEW; non-persisted)

finance_open_item_effects (DERIVED SQL VIEW)
  = non-authoritative
  = non-persisted
  = rebuild-free
  = NOT a physical table
  = NOT a materialized/cache table
  MUST NEVER be independently written as economic truth
  MUST NEVER be summed in the equation alongside its source facts
  No INSERT / UPDATE / DELETE permitted against it (view disallows).
```

#### 28.3.0.1 Frozen 4 Open-Item Effect Categories

AR / AP open-item remaining amount 由 **exactly 4** canonical categories 构成；不允许第 5 个独立 economic category 除非 Requirement 重开。

| Category | Canonical Source Table | Net-of-Reversal Source | Notes |
|---|---|---|---|
| **A. SETTLEMENT_ALLOCATION** | `payment_collection_items` (AR side) + `payment_disbursement_items` (AP side) | minus `settlement_reversal_items` rows where `component_type='ALLOCATION'` AND the reversed allocation targets this open item | only confirmed effective allocation amount |
| **B. UNAPPLIED_APPLICATION** | `balance_applications` | minus REVERSED applications | only CONFIRMED/effective applications; REVERSED contributes zero |
| **C. CREDIT_ADJUSTMENT** | `financial_credit_adjustments` | net of canonical reversal (status='CONFIRMED' minus REVERSED rows) | typed effects: `RETURN` / `DISCOUNT` / `COMMERCIAL_CREDIT` / `OTHER`; chain: `commercial_credit_notes` / `sales_discounts` / `purchase_discounts` / return source documents → `applyCreditAdjustment` → `financial_credit_adjustments` |
| **D. WRITE_OFF** | `financial_write_offs` | minus `financial_write_off_reversals` | only CONFIRMED amount |

No fifth independent economic category is allowed.

#### 28.3.0.2 Commercial-Credit / Discount / Return Single-Path Rule

Current runtime chain:

```text
commercial_credit_notes
→ applyCreditAdjustment(...)
→ financial_credit_adjustments
```

Therefore:

```text
commercial_credit_notes
= commercial / source-document evidence (audit / trace only)

financial_credit_adjustments
= canonical open-item financial effect
```

Effect path is exactly once via `financial_credit_adjustments`. `refreshOpenAmount()` MUST NOT independently re-sum:

```text
commercial_credit_notes
sales_discounts
purchase_discounts
sales_returns / purchase_returns
```

after their financial effect has materialized into `financial_credit_adjustments`. Those source documents remain trace / audit evidence only.

#### 28.3.0.3 Settlement Reversal Mapping

`settlement_reversal_items` carries `component_type IN ('ALLOCATION', 'UNAPPLIED')`.

```text
component_type = 'ALLOCATION'
  → may reopen an AR / AP open item
  → effective_settlement_allocations(§A) deducts this reversal amount

component_type = 'UNAPPLIED'
  → only affects unapplied-balance lifecycle
  → MUST NOT directly alter AR / AP open item remaining amount
  → §B (UNAPPLIED_APPLICATION) is reduced only via balance_applications.REVERSED rows
     (not via settlement_reversal_items.UNAPPLIED)
```

#### 28.3.0.4 Refund / Reversal Boundary

```text
financial_refunds
financial_refund_reversals
= belong to unapplied-balance truth + treasury truth
= do NOT directly contribute to AR / AP open-item remaining amount
= removed from the open-item equation entirely
```

This preserves the frozen Requirement invariant:

```text
FO22 Settlement Reversal
!=
FO26 Unapplied-Balance Refund
```

#### 28.3.0.5 Conversion / Re-allocation

`CONVERSION (PROVISIONAL → FINAL)` 不改变 total exposure；通过 `account_receivables.conversion_state='CONVERTED'` + `provisional_origin_id` / `converted_open_item_id` 表达；不进入 open-item equation。

#### 28.3.0.6 Forbidden Double-Adjustment

```text
source fact contributes to balance
+
finance_open_item_effects contributes again
for the same economic effect
```

Implementation 阶段必须 fail closed if 任何 mutation 路径绕过 canonical source 表直接 mutate `account_receivables.open_amount_cents` 或 `account_payables.open_amount_cents` 而不经过 source 表 + `refreshOpenAmount()`。

### 28.3.1 Identity & Schema (Canonical Headers)

**确认：`account_receivables` / `account_payables` 仍是 Finance Operations canonical open-item header 表。**

```text
finance_open_item_effects（DERIVED SQL VIEW）
= effects projection (NOT a second open-item header ledger)
= non-authoritative / non-persisted / rebuild-free
= 唯一 Finance canonical 派生 SQL VIEW（§28.1.2.4）
```

保留并 additive 扩展现有 `account_receivables` / `account_payables`（converge 策略见 §28.18）。

最小字段：

```text
id
side                  AR | AP
voucher_no
party_type             CUSTOMER | SUPPLIER
party_id
recognition_mode       DIRECT_BUSINESS_OPEN_ITEM | INVOICE_DRIVEN_OPEN_ITEM | PROVISIONAL_TO_FINANCIAL
item_kind              FINAL | PROVISIONAL
conversion_state       OPEN | CONVERTED  (PROVISIONAL → FINAL 状态；FINAL 行为 OPEN)
source_type
source_id
source_no
business_date
original_amount_cents
open_amount_cents      cache projection (derived from refreshOpenAmount)
paid_cents             cache projection
write_off_cents        cache projection
status                 OPEN | PARTIAL | SETTLED | WRITTEN_OFF
due_date               primary due (legacy; §28.4 introduces lines)
provisional_origin_id  null for FINAL/PROVISIONAL non-converted; for CONVERTED FINAL, link to original PROVISIONAL
converted_open_item_id null for FINAL/PROVISIONAL non-converted; for CONVERTED PROVISIONAL, link to final created
settlement_account_id   nullable
created_by
created_at
updated_at
```

Additive migration 添加列（不得破坏既有 check / index）：

```sql
ALTER TABLE account_receivables ADD COLUMN recognition_mode TEXT
  CHECK(recognition_mode IN ('DIRECT_BUSINESS_OPEN_ITEM','INVOICE_DRIVEN_OPEN_ITEM','PROVISIONAL_TO_FINANCIAL'));
ALTER TABLE account_receivables ADD COLUMN item_kind TEXT
  CHECK(item_kind IN ('FINAL','PROVISIONAL'));
ALTER TABLE account_receivables ADD COLUMN conversion_state TEXT
  CHECK(conversion_state IN ('OPEN','CONVERTED')) DEFAULT 'OPEN';
ALTER TABLE account_receivables ADD COLUMN provisional_origin_id TEXT REFERENCES account_receivables(id);
ALTER TABLE account_receivables ADD COLUMN converted_open_item_id TEXT REFERENCES account_receivables(id);
ALTER TABLE account_receivables ADD COLUMN settlement_account_id TEXT REFERENCES bank_accounts(id);

ALTER TABLE account_payables ADD COLUMN recognition_mode TEXT
  CHECK(recognition_mode IN ('DIRECT_BUSINESS_OPEN_ITEM','INVOICE_DRIVEN_OPEN_ITEM','PROVISIONAL_TO_FINANCIAL'));
ALTER TABLE account_payables ADD COLUMN item_kind TEXT
  CHECK(item_kind IN ('FINAL','PROVISIONAL'));
ALTER TABLE account_payables ADD COLUMN conversion_state TEXT
  CHECK(conversion_state IN ('OPEN','CONVERTED')) DEFAULT 'OPEN';
ALTER TABLE account_payables ADD COLUMN provisional_origin_id TEXT REFERENCES account_payables(id);
ALTER TABLE account_payables ADD COLUMN converted_open_item_id TEXT REFERENCES account_payables(id);
ALTER TABLE account_payables ADD COLUMN settlement_account_id TEXT REFERENCES bank_accounts(id);
```

注：`account_receivables.party_type='CUSTOMER'`；`account_payables.party_type='SUPPLIER'`。

### 28.3.2 Canonical Equation (F1 / §33.3) — 4 Categories

> **每个 `effective_*` 已经 net of its own valid reversal state/evidence；不再额外加 generic reversal。避免 "subtract source → add reversal → exclude reversed source" 三重调整。**

```text
open_amount
=
original_amount
- effective_settlement_allocations
- effective_unapplied_applications
- effective_credit_adjustments
- effective_write_offs
```

Each component is defined as:

```text
effective_settlement_allocations(open_item_id, side)
  = SUM(payment_collection_items.amount_cents
        WHERE open_item_id = ? AND side = 'AR' AND status = 'CONFIRMED')
  + SUM(payment_disbursement_items.amount_cents
        WHERE open_item_id = ? AND side = 'AP' AND status = 'CONFIRMED')
  - SUM(settlement_reversal_items.amount_cents
        WHERE component_type = 'ALLOCATION'
          AND original_component_id IN (
              SELECT id FROM payment_collection_items WHERE open_item_id = ?
              UNION
              SELECT id FROM payment_disbursement_items WHERE open_item_id = ?
            ))

effective_unapplied_applications(open_item_id, side)
  = SUM(balance_applications.amount_cents
        WHERE target_open_item_id = ? AND side = ? AND status = 'CONFIRMED')
  - 0    -- REVERSED applications contribute zero (filtered by status='CONFIRMED' above)

effective_credit_adjustments(open_item_id, side)
  = SUM(financial_credit_adjustments.effect_cents
        WHERE open_item_id = ? AND side = ? AND status = 'CONFIRMED')
  - SUM(financial_credit_adjustments.effect_cents
        WHERE open_item_id = ? AND side = ? AND status = 'REVERSED')
  -- effect_type IN ('RETURN','DISCOUNT','COMMERCIAL_CREDIT','OTHER')
  -- commercial_credit_notes / sales_discounts / purchase_discounts / returns
  --    already materialized via financial_credit_adjustments; do NOT re-sum.

effective_write_offs(open_item_id, side)
  = SUM(financial_write_offs.amount_cents
        WHERE open_item_id = ? AND side = ? AND status = 'CONFIRMED')
  - SUM(financial_write_off_reversals.amount_cents
        WHERE reverses_write_off_id IN (
            SELECT id FROM financial_write_offs WHERE open_item_id = ? AND side = ?
          ))
```

**Excluded from the equation (intentional):**

```text
financial_refunds           -- belongs to unapplied-balance truth + treasury truth
financial_refund_reversals   -- belongs to unapplied-balance truth + treasury truth
commercial_credit_notes     -- source-document evidence only;
                              -- financial effect materialized via financial_credit_adjustments
sales_discounts             -- source-document evidence only;
                              -- financial effect materialized via financial_credit_adjustments
purchase_discounts          -- same
sales_returns / purchase_returns  -- source-document evidence only;
                                    -- financial effect materialized via financial_credit_adjustments
settlement_reversal_items.UNAPPLIED  -- only affects unapplied-balance lifecycle
```

`paid_cents` / `write_off_cents` / `open_amount_cents` 是 cache projection，由 `refreshOpenAmount(openItemId)` 在每个 mutation 末尾统一更新。

#### 28.3.2.1 refreshOpenAmount() — Reads VIEW Only

```text
refreshOpenAmount(openItemId):
  side = lookup_by_id(openItemId).side

  -- single dependency: finance_open_item_effects VIEW
  effective = SUM(effective_amount_cents)
              FROM finance_open_item_effects
              WHERE side = ? AND open_item_id = ?

  remaining = original_amount_cents - effective
  UPDATE account_receivables / account_payables
    SET open_amount_cents = remaining,
        status = derived_status(remaining, write_off_cents)
```

`refreshOpenAmount` reads **`finance_open_item_effects` VIEW only**。Chain：

```text
canonical source facts
→ finance_open_item_effects VIEW  (DERIVED SQL VIEW; non-persisted; rebuild-free)
→ canonical equation
→ cached account_receivables / account_payables.open_amount_cents
```

Never：

```text
source facts
+
view
```

in the same equation.

#### 28.3.2.2 assertOpenAmountReconciled()

```text
canonical = canonical_equation(openItemId, side)
            -- canonical_equation reads finance_open_item_effects VIEW only
cached    = lookup.open_amount_cents
if canonical != cached:
  throw HttpError(500, 'open amount cache mismatch — fail closed', { open_item_id, canonical, cached })
```

`assertOpenAmountReconciled` independently recomputes through the same VIEW contract and compares the cached header value. Reader path / health check / close pre-check 可独立调用。

禁止 `refreshOpenAmount` 直接被 reader 路径调用；只允许 canonical writer 末尾。

### 28.3.3 Status Lifecycle

```text
OPEN     --  remaining > 0 且未 settle
PARTIAL  --  remaining > 0 且已部分 allocated
SETTLED  --  remaining == 0 且全部 effect CONFIRMED
WRITTEN_OFF   --  write-off CONFIRMED; remaining == 0
```

`CONVERTED` 不作为 `status`；改由 `account_receivables.conversion_state='CONVERTED'` / `account_payables.conversion_state='CONVERTED'` 表达（PROVISIONAL → FINAL 转换后原行）。

不允许 `OPEN / PARTIAL / SETTLED / WRITTEN_OFF` 之外的临时 status；不允许混用 document status 与 settlement status。

### 28.3.4 finance_open_item_effects (DERIVED SQL VIEW — Contract)

> **`finance_open_item_effects` 是 DERIVED SQL VIEW，NOT a physical table。**
>
> - **non-authoritative**
> - **non-persisted**
> - **rebuild-free**
> - **NOT a physical table**
> - **NOT a materialized/cache table**
> - No INSERT / UPDATE / DELETE is permitted against it (view disallows).

View 投影 exactly 4 frozen effect categories，每类已经 net of its own reversal semantics：

```text
SETTLEMENT_ALLOCATION
UNAPPLIED_APPLICATION
CREDIT_ADJUSTMENT
WRITE_OFF
```

#### 28.3.4.1 View Definition (Portable SQL)

```sql
CREATE VIEW IF NOT EXISTS finance_open_item_effects AS
  -- ============================================================
  -- A. SETTLEMENT_ALLOCATION
  --    payment_collection_items (AR) ∪ payment_disbursement_items (AP)
  --    net of settlement_reversal_items WHERE component_type='ALLOCATION'
  -- ============================================================
  SELECT
    'AR' AS side,
    pci.open_item_id AS open_item_id,
    'SETTLEMENT_ALLOCATION' AS effect_type,
    'payment_collection_items' AS source_table,
    pci.payment_collection_id AS source_id,
    pci.id AS source_effect_id,
    pci.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pci.id
    ), 0) AS reversed_amount_cents,
    pci.amount_cents - COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pci.id
    ), 0) AS effective_amount_cents,
    pci.business_date AS business_date
  FROM payment_collection_items pci
  WHERE pci.status = 'CONFIRMED'
  UNION ALL
  SELECT
    'AP' AS side,
    pdi.open_item_id AS open_item_id,
    'SETTLEMENT_ALLOCATION' AS effect_type,
    'payment_disbursement_items' AS source_table,
    pdi.payment_disbursement_id AS source_id,
    pdi.id AS source_effect_id,
    pdi.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pdi.id
    ), 0) AS reversed_amount_cents,
    pdi.amount_cents - COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pdi.id
    ), 0) AS effective_amount_cents,
    pdi.business_date AS business_date
  FROM payment_disbursement_items pdi
  WHERE pdi.status = 'CONFIRMED'

  UNION ALL

  -- ============================================================
  -- B. UNAPPLIED_APPLICATION
  --    balance_applications WHERE status='CONFIRMED'
  --    REVERSED applications contribute zero (filtered)
  -- ============================================================
  SELECT
    ba.side AS side,
    ba.target_open_item_id AS open_item_id,
    'UNAPPLIED_APPLICATION' AS effect_type,
    'balance_applications' AS source_table,
    ba.balance_id AS source_id,
    ba.id AS source_effect_id,
    ba.amount_cents AS gross_amount_cents,
    0 AS reversed_amount_cents,
    ba.amount_cents AS effective_amount_cents,
    ba.business_date AS business_date
  FROM balance_applications ba
  WHERE ba.status = 'CONFIRMED'

  UNION ALL

  -- ============================================================
  -- C. CREDIT_ADJUSTMENT
  --    financial_credit_adjustments WHERE status='CONFIRMED'
  --    net of REVERSED rows; typed RETURN/DISCOUNT/COMMERCIAL_CREDIT/OTHER
  --    commercial_credit_notes / sales_discounts / purchase_discounts / returns
  --    already materialize via financial_credit_adjustments; do NOT re-sum.
  -- ============================================================
  SELECT
    fca.side AS side,
    fca.open_item_id AS open_item_id,
    'CREDIT_ADJUSTMENT' AS effect_type,
    'financial_credit_adjustments' AS source_table,
    fca.source_id AS source_id,
    fca.id AS source_effect_id,
    fca.effect_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(fca2.effect_cents)
      FROM financial_credit_adjustments fca2
      WHERE fca2.status = 'REVERSED'
        AND fca2.source_id = fca.id
    ), 0) AS reversed_amount_cents,
    fca.effect_cents - COALESCE((
      SELECT SUM(fca2.effect_cents)
      FROM financial_credit_adjustments fca2
      WHERE fca2.status = 'REVERSED'
        AND fca2.source_id = fca.id
    ), 0) AS effective_amount_cents,
    fca.business_date AS business_date
  FROM financial_credit_adjustments fca
  WHERE fca.status = 'CONFIRMED'

  UNION ALL

  -- ============================================================
  -- D. WRITE_OFF
  --    financial_write_offs WHERE status='CONFIRMED'
  --    net of financial_write_off_reversals
  -- ============================================================
  SELECT
    fwo.side AS side,
    fwo.open_item_id AS open_item_id,
    'WRITE_OFF' AS effect_type,
    'financial_write_offs' AS source_table,
    fwo.id AS source_id,
    fwo.id AS source_effect_id,
    fwo.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(fwor.amount_cents)
      FROM financial_write_off_reversals fwor
      WHERE fwor.write_off_id = fwo.id
    ), 0) AS reversed_amount_cents,
    fwo.amount_cents - COALESCE((
      SELECT SUM(fwor.amount_cents)
      FROM financial_write_off_reversals fwor
      WHERE fwor.write_off_id = fwo.id
    ), 0) AS effective_amount_cents,
    fwo.business_date AS business_date
  FROM financial_write_offs fwo
  WHERE fwo.status = 'CONFIRMED';
```

> **Excluded from the view (intentional, per §28.3.0.2 / §28.3.0.3 / §28.3.0.4 / §28.3.0.5):**
>
> - `financial_refunds` / `financial_refund_reversals` (unapplied-balance truth + treasury truth)
> - `commercial_credit_notes` (source-document evidence; financial effect materialized via `financial_credit_adjustments`)
> - `sales_discounts` / `purchase_discounts` (source-document evidence; financial effect materialized via `financial_credit_adjustments`)
> - `sales_returns` / `purchase_returns` (source-document evidence; financial effect materialized via `financial_credit_adjustments`)
> - `settlement_reversal_items` rows with `component_type='UNAPPLIED'` (only affects unapplied-balance lifecycle)

#### 28.3.4.2 Logical Uniqueness

```text
(source_table, source_effect_id)
```

是 view 的逻辑唯一键。view 自身不支持 UNIQUE 约束；测试必须 assert 投影无重复 identity。

#### 28.3.4.3 No Physical Persistence

```text
finance_open_item_effects 是 VIEW；
无 CREATE TABLE finance_open_item_effects；
无 materialized / cache 表；
无 rebuild 步骤（每次 query 重新计算）。
```

Authoritative writes never target this view（view 不允许 DML）。

## 28.4 Due-Schedule Model (FO04)

### 28.4.1 Schema (side + open_item_id portable identity)

`finance_due_schedule_lines` 是 additive child table，**不允许**仅以单一 `due_date` 列表达 multi-due terms。

为了避免 shared child table 跨 side 引用歧义，使用 `(side, open_item_id)` portable identity：

```sql
CREATE TABLE IF NOT EXISTS finance_due_schedule_lines (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL CHECK(side IN ('AR','AP')),
  open_item_id TEXT NOT NULL,
  ar_open_item_id TEXT,  -- nullable; non-null iff side='AR'
  ap_open_item_id TEXT,  -- nullable; non-null iff side='AP'
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  due_date TEXT NOT NULL,
  scheduled_amount_cents INTEGER NOT NULL CHECK(scheduled_amount_cents > 0),
  settled_amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','SETTLED','REVERSED')),
  created_at TEXT NOT NULL,
  CHECK (
    (side = 'AR' AND ar_open_item_id IS NOT NULL AND ap_open_item_id IS NULL) OR
    (side = 'AP' AND ap_open_item_id IS NOT NULL AND ar_open_item_id IS NULL)
  ),
  FOREIGN KEY (ar_open_item_id) REFERENCES account_receivables(id),
  FOREIGN KEY (ap_open_item_id) REFERENCES account_payables(id),
  UNIQUE(side, open_item_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_due_schedule_item ON finance_due_schedule_lines(side, open_item_id, sequence);
CREATE INDEX IF NOT EXISTS idx_due_schedule_due ON finance_due_schedule_lines(due_date, status);
```

应用层 invariant 守卫：

```text
assertOpenItemSide(openItemId):
  if side='AR': exists in account_receivables where id=openItemId
  if side='AP': exists in account_payables where id=openItemId
  else: throw HttpError(400, 'cross-side reference rejected', { side, open_item_id })
```

避免 SQLite / MySQL FK 跨边限制差异；CHECK 约束保证 column-level，application assert 保证 row-level。

### 28.4.2 Invariant

```text
SUM(scheduled_amount_cents) = original_amount_cents
```

检查时机：open item create / amount edit（仅 DRAFT） / schedule amendment。

### 28.4.3 Default Schedule

Legacy single `due_date` 在 migration 阶段迁移为一条 schedule line：

```text
sequence = 1
scheduled_amount_cents = original_amount_cents
due_date = legacy.due_date
```

未知 / 缺 legacy terms 的 open item 保留为一条 default schedule，不得 fabricate multi-line。

### 28.4.4 Allocation Priority

默认策略：

```text
ORDER BY due_date ASC, business_date ASC, open_item_id ASC
```

explicit user allocation 必须记录 `payment_collection_items.user_allocated=1`；不得 silently override。

## 28.5 Provisional Model (FO11 / FO12 / FO13)

### 28.5.1 First-Class Identity

PROVISIONAL 是 first-class `item_kind`，**不**仅靠 `source_type='PURCHASE_RECEIPT'` 隐式标记。

```text
item_kind = 'PROVISIONAL'
recognition_mode = 'PROVISIONAL_TO_FINANCIAL'
```

后续 Invoice post → `convertProvisionalToFinancial`（§28.5.3）。

### 28.5.2 Provisional Open Items

- 由 `recognizeFinanceExposure` 在 PROVISIONAL_TO_FINANCIAL policy 下创建。
- 允许在 conversion 前完成 payment / allocation？**否**。仅 final 可付款；provisional open item 显式拒绝 `payment_disbursements` allocation（除非 future Requirement 显式放宽）。
- migration 不允许把所有 `PURCHASE_RECEIPT` AR/AP auto-label 为 PROVISIONAL；只有 policy evidence 允许的才迁移。

### 28.5.3 Conversion / Reversal

`finance-provisional-conversion.js::convertProvisionalToFinancial`：

```text
input: { provisionalOpenItemId, finalOpenItemId, supplierBillId, businessDate, amountCents, actor }
1. lock provisionalOpenItemId FOR UPDATE
2. assert provisionalOpenItemId.item_kind='PROVISIONAL' 且未 converted
3. set provisional.conversion_state='CONVERTED' + provisional.converted_open_item_id=finalOpenItemId
4. finalOpenItem 已由 recognizeFinanceExposure 在同一事务内创建（INVOICE_DRIVEN_OPEN_ITEM 路径）
5. audit

Note: finance_open_item_effects 是 DERIVED SQL VIEW；no INSERT against it.
       conversion 由 account_receivables / account_payables 头上的 conversion_state
       + converted_open_item_id 表达；view 自动反映。
```

Reversal path 同 reverseSettlementReversal 模式（§28.8）；不 hard-delete provisional。

### 28.5.4 AR Equivalence

AR PROVISIONAL → SALES_INVOICE.post → `reverseProvisionalAndCreateFinal`；reference 见 §28.5.3 镜像实现。

## 28.6 Settlement / Allocation Model (FO16–FO22)

### 28.6.1 Documents

保留并扩展 `payment_collections` / `payment_disbursements`（converge 策略见 §28.15）。

Lifecycle：

```text
DRAFT → CONFIRMED → (PARTIAL_REVERSAL | FULL_REVERSAL | CANCELLED)
```

`CANCELLED` 仅允许 `status='DRAFT'` 的零效应 cancellation；CONFIRMED 之后必须走 reversal（§28.8）。

### 28.6.2 Allocation Items

保留 `payment_collection_items` / `payment_disbursement_items`（converge）。

新增 evidence：

```text
allocation_id
open_item_id (linkage; canonical source table for §A SETTLEMENT_ALLOCATION effect via finance_open_item_effects VIEW projection)
amount_cents
open_before_cents
open_after_cents
reversal_of_allocation_id (nullable)
reversed_amount_cents (nullable; default 0)
created_by
created_at
```

Allocation priority 默认 `due_date ASC, business_date ASC, open_item_id ASC`；explicit user override 必须 persist `user_allocated=1`。

### 28.6.3 Settlement Reversal (FO22)

保留 `settlement_reversals` / `settlement_reversal_items`（v13-phase6a 已扩展 component_type）。

component_type：

```text
ALLOCATION    -- 撤销 cash allocation
UNAPPLIED     -- 撤销 unapplied balance application
```

Partial reversal 允许；remaining reversible amount = sum(component.cents) - sum(component.reversed_cents)。

### 28.6.4 Multi-Item / Partial

- `n settlements → 1 open item`：`payment_collection_items` 允许多行同 `open_item_id`。
- `1 settlement → n open items`：同上，单 `payment_collection_id` 多 `payment_collection_items`。
- 不允许 over-application：confirm 前必须重算 remaining 并 fail closed。

## 28.7 Unapplied Balance Model (FO23–FO26)

### 28.7.1 Canonical Model

保留 `settlement_unapplied_balances` / `balance_applications` / `financial_refunds` / `financial_refund_reversals`（v13-phase6a 已建立）。

Invariant：

```text
remaining = original - applications - refunds - reversals
remaining >= 0
```

balance_type：

```text
PREPAYMENT    --  advance receipt / prepayment
CREDIT        --  commercial credit adjustment
```

### 28.7.2 Refund (FO26)

- 仅指向 `settlement_unapplied_balances`（FO26 ≠ FO22）。
- side：`CUSTOMER | SUPPLIER`。
- 必须同时形成 treasury movement（§28.9）+ accounting adapter event（§28.11）。
- 双方向 evidence（UAT-18）：customer-side / supplier-side 各自独立 reconciliation test。

### 28.7.3 Application (FO25)

`balance_applications` 已建立；同一 transaction 内：

```text
1. lock balance_id FOR UPDATE
2. lock target_open_item_id FOR UPDATE
3. assert balance.remaining >= amount
4. assert target_open_item.remaining >= amount
5. insert balance_applications row (CONFIRMED)   -- canonical source for §B UNAPPLIED_APPLICATION
6. emit treasury movement (null; balance 转换不产生现金动作)
7. emit accounting adapter event
8. refresh canonical balance / open item        -- refreshOpenAmount reads VIEW; no separate INSERT

Note: finance_open_item_effects 是 DERIVED SQL VIEW；no INSERT against it.
       balance_applications 是 §B canonical source.
```

## 28.8 Write-Off / Bad Debt (FO27 / FO28)

### 28.8.1 Write-Off Lifecycle

保留 `financial_write_offs` / `financial_write_off_reversals`。

```text
DRAFT → SUBMITTED → CONFIRMED → REVERSED
       ↘ REJECTED
```

`REVERSED` 通过 `financial_write_off_reversals` evidence；不得 hard delete CONFIRMED。

### 28.8.2 Bad-Debt Provision (FO28)

`finance_bad_debt_provisions` 表 + lifecycle：

```text
DRAFT → SUBMITTED → CONFIRMED → REVERSED
       ↘ REJECTED
```

字段：

```text
id
provision_no
side                AR | AP
method              AGING | INDIVIDUAL
open_item_id        (null for AGING batch)
amount_cents        CHECK(amount_cents > 0)
business_date
reason
status
creator_id
confirmer_id
created_at
confirmed_at
reversed_by
reversed_at
```

**不得**实现 IFRS / ECL engine；只 AGING bucket 或 INDIVIDUAL single-item 评估。

## 28.9 Counterparty Transfer (FO15)

### 28.9.1 Document

`finance_counterparty_transfers` 表（first-class）：

```text
id
transfer_no
side                AR | AP
source_party_id
target_party_id
business_date
reason
status              DRAFT | CONFIRMED | REVERSED
creator_id
confirmer_id
created_at
confirmed_at
```

### 28.9.2 Lines

`finance_counterparty_transfer_lines`：

```text
id
transfer_id
source_open_item_id
amount_cents
```

### 28.9.3 Execution

确认事务：

```text
1. lock source_open_items FOR UPDATE (sort ASC)
2. assert sum(lines.amount_cents) == 0
3. 创建 target_party 的新 final open item（FINAL，recognition_mode=DIRECT_BUSINESS_OPEN_ITEM，source_type=FINANCE_TRANSFER，source_id=transfer_id）
4. 写 accounting adapter event
5. audit

Note: finance_open_item_effects 是 DERIVED SQL VIEW；no INSERT against it.
       total exposure conserved 由 canonical equation (refreshOpenAmount → VIEW) 体现。
       不得写 treasury movement (FO15 = AR/AP counterparty transfer; 无现金动作).
```

total exposure conserved：`SUM(source_open_item.effect) + SUM(target_open_item.effect) == 0`。

不得 `UPDATE account_receivables.party_id = ?` 原 counterparty；必须创建 evidence 行。

## 28.10 Invoice Model (FO29–FO36)

### 28.10.1 Document Lifecycle vs Credit Exposure (Separated)

> **不再把 `CREDITED` / `VOIDED` / `CANCELLED` 与 `DRAFT → POSTED` 混为单线 terminal state。明确分离两个独立维度：**
>
> ```text
> (A) Document Lifecycle      (DRAFT / POSTED / VOIDED / CANCELLED)
> (B) Credit Exposure State   (credit_state + credited_amount + remaining_creditable_amount)
> ```
>
> `CREDITED` 不作为单一 terminal document state。Credit / red notes 是独立 economic documents；原 invoice 仅在 credit_state projection 上积累。

保留 `sales_invoices` / `supplier_bills` / `commercial_credit_notes`（converge 策略见 §28.18）。

**Document Lifecycle（独立）：**

```text
DRAFT
  ↓ post
POSTED
  ↓ allow (under conditions below)
  ↘ VOIDED            -- only when all dependent effects atomically reversed or absent
  ↘ CANCELLED         -- only from DRAFT (zero effect)
```

```sql
-- sales_invoices.status, supplier_bills.status:
--   IN ('DRAFT','POSTED','VOIDED','CANCELLED')
-- (legacy 'CREDITED' status value is REMOVED; replaced by credit_state column below)
```

**Credit Exposure State（独立 projection on POSTED invoice）：**

```sql
ALTER TABLE sales_invoices ADD COLUMN credit_state TEXT NOT NULL DEFAULT 'NONE'
  CHECK(credit_state IN ('NONE','PARTIAL','FULL'));
ALTER TABLE sales_invoices ADD COLUMN credited_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_invoices ADD COLUMN remaining_creditable_amount_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE supplier_bills ADD COLUMN credit_state TEXT NOT NULL DEFAULT 'NONE'
  CHECK(credit_state IN ('NONE','PARTIAL','FULL'));
ALTER TABLE supplier_bills ADD COLUMN credited_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_bills ADD COLUMN remaining_creditable_amount_cents INTEGER NOT NULL DEFAULT 0;
```

Invariant：

```text
SUM(commercial_credit_notes.amount_cents WHERE invoice_id=? AND side=? AND status='POSTED' AND NOT reversed)
  = sales_invoices.credited_amount_cents
  = sales_invoices.total_amount_cents - sales_invoices.remaining_creditable_amount_cents

credit_state:
  NONE   -- credited_amount_cents == 0
  PARTIAL -- 0 < credited_amount_cents < total_amount_cents
  FULL   -- credited_amount_cents == total_amount_cents
```

`commercial_credit_notes` 是独立 economic document 类型：

```text
id
note_no
invoice_id
invoice_side                  SALES_INVOICE | SUPPLIER_BILL
amount_cents                  CHECK(amount_cents > 0)
business_date
status                        DRAFT | POSTED | VOIDED
reference                     reason / external
created_by
created_at
UNIQUE(invoice_id, note_no)
```

允许：

```text
1 张原 invoice → N 张 partial credit notes
```

`FULL` credit 不 hard-delete 原 invoice；原 invoice 仍存在，`credit_state='FULL'`，`remaining_creditable_amount_cents=0`。

**VOID 语义：**

```text
POSTED invoice may be VOIDED only when:
  (a) business / legal rules permit, AND
  (b) all dependent economic effects are absent
      OR
      atomically reversed in same transaction

atomic-reversal scope:
  open_item           → reverseFinanceExposure (mirror recognizeFinanceExposure reverse path)
  credit_notes posted against this invoice → reverse all (status='VOIDED')
  treasury movements  → applyTreasuryMovement (reversal via reversal_of_movement_id)
  accounting events   → reverseAccountingEvent (FO58)
  voucher             → Accounting & Analytics reversal
  tax snapshot        → reverse

VOID 失败 → transaction 回滚 → invoice 保持 POSTED + 全部 effect 存在。
```

禁止混淆：

```text
CANCELLED    -- DRAFT → CANCELLED, no economic effect ever existed
VOIDED       -- POSTED → VOIDED, all economic effects atomically reversed
PARTIALLY_CREDITED   -- credit_state = 'PARTIAL'
FULLY_CREDITED       -- credit_state = 'FULL'
```

### 28.10.2 Schemas

新增 additive 列：

```text
sales_invoices / supplier_bills
  recognition_mode          -- 接 §28.2 policy
  open_item_id              -- nullable; post 后填
  provisional_origin_id     -- nullable
  credit_state              -- NONE / PARTIAL / FULL  (above)
  credited_amount_cents
  remaining_creditable_amount_cents
  verification_state        -- UNVERIFIED / VERIFIED / CERTIFIED / REJECTED (supplier_bills only; FO35)
  posted_at
  posted_by
```

### 28.10.3 Source Cardinality (FO31)

`finance_invoice_source_links`：

```text
id
invoice_id
invoice_side                  SALES_INVOICE | SUPPLIER_BILL
source_type
source_id
source_line_id
invoiced_quantity
invoiced_amount_cents
UNIQUE(invoice_id, invoice_side, source_type, source_id, source_line_id)
```

Invariants：

```text
SUM(invoice_lines.invoiced_quantity) <= source_line.quantity - source_line.reversed_quantity
SUM(invoice_lines.invoiced_amount_cents) <= source_line.amount - source_line.reversed_amount
```

不得 over-invoice。

### 28.10.4 Credit / Red / Void (FO33 / FO34)

- Posted invoice 纠错通过 `commercial_credit_notes`（FO33），独立 economic document；原 invoice 仅累积 credit_state。
- `VOID / CANCEL` 仅在 lifecycle 条件满足时允许（§28.10.1）。
- 不得留 orphan AR/AP / settlement / voucher / tax effects。

### 28.10.5 Invoice Recognition Adapter

唯一入口 `recognizeFinanceExposure`（§28.2.3）。

路径：

```text
INVOICE_DRIVEN_OPEN_ITEM:
  posted invoice
  → recognizeFinanceExposure({...})
  → open_item created

DIRECT_BUSINESS_OPEN_ITEM:
  posted invoice is link only
  → link invoice.id to existing open_item.id
  → no new open item, no exposure change

PROVISIONAL_TO_FINANCIAL:
  posted invoice (supplier_bill)
  → reverse provisional open item (CONVERSION)
  → create final open item (FINAL)
```

不得散落到各 Domain handler。

### 28.10.6 Input Invoice Verification (FO35)

`supplier_bills.verification_state` lifecycle：

```text
UNVERIFIED → VERIFIED → CERTIFIED
            ↘ REJECTED
```

外部 government certification 保持 OUT_OF_SCOPE（document.md §33.44）。

## 28.11 Treasury Movement Model (FO37–FO45)

### 28.11.1 Settlement Account Master (FO37) — bank_accounts is EXISTING_CONVERGE Canonical

**本 Domain Closure 显式选择：扩展 `bank_accounts` 为 canonical operational CASH/BANK account master；不新建第二 master。**

```text
bank_accounts
  = canonical operational CASH/BANK settlement account master
  = the ONLY authoritative operational account identity
  = EXISTING_CONVERGE in canonical table inventory (§28.1.2.1)
  = NO competing finance_settlement_accounts master

finance_settlement_accounts
  = REMOVED from canonical design
  = not a separate master; not a competing active table
  (per "Do not introduce second active master" in document.md §33.43)
```

Additive migration 在 `bank_accounts` 上扩展：

```sql
-- existing bank_accounts columns preserved
-- ADDITIVE columns only:

ALTER TABLE bank_accounts ADD COLUMN code TEXT;
ALTER TABLE bank_accounts ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bank_accounts ADD COLUMN accounting_role TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_accounts ADD COLUMN accounting_subject_id TEXT;

-- balance_cents remains; converted from authoritative balance to derived cache projection

-- CASH / BANK union support
-- existing account_type default 'CHECKING' is preserved; additive allow:
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_type_check
  CHECK(account_type IN ('CASH','BANK','CHECKING','SAVINGS','OTHER') OR account_type IS NULL);

-- code unique after backfill (one-time migration backfills code = id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_code ON bank_accounts(code) WHERE code IS NOT NULL;
```

CASH account representation（不通过会计 subject `1001` 隐式表达）：

```text
CASH accounts are bank_accounts rows with account_type='CASH' and code/name distinct from BANK accounts.
operational identity = bank_accounts.id (canonical).
accounting_subject_id nullable: optional downstream mapping to GL subject 1001 only as a reference,
not as the operational account identity.
```

`bank_accounts.balance_cents` 保留为 derived cache projection；canonical truth = `finance_treasury_movements` aggregate per `settlement_account_id`。

禁止：

```text
1. CREATE TABLE finance_settlement_accounts  -- never created as canonical master
2. Independent bank_accounts writes  outside applyTreasuryMovement
3. UPDATE bank_accounts.balance_cents  outside refreshSettlementAccountBalance
```

Legacy `/api/bank-accounts` route 全部走 canonical settlement-account service（finance-settlement-account）。`bank_accounts.balance_cents` 兼容性 cache 仅在 migration 过渡期保留。

### 28.11.2 Canonical Treasury Movement (FO39)

```sql
CREATE TABLE IF NOT EXISTS finance_treasury_movements (
  id TEXT PRIMARY KEY,
  settlement_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  business_date TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  counterparty_type TEXT NOT NULL DEFAULT '',
  counterparty_id TEXT NOT NULL DEFAULT '',
  external_reference TEXT NOT NULL DEFAULT '',
  reversal_of_movement_id TEXT,
  movement_group_id TEXT NOT NULL,
  accounting_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','REVERSED')),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_movement_idem ON finance_treasury_movements(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_treasury_movement_account ON finance_treasury_movements(settlement_account_id, business_date);
CREATE INDEX IF NOT EXISTS idx_treasury_movement_group ON finance_treasury_movements(movement_group_id);
```

#### 28.11.2.1 Idempotency Examples

```text
COLLECTION_CONFIRM:{collection_id}
PAYMENT_CONFIRM:{disbursement_id}
REFUND_CONFIRM:{refund_id}
SETTLEMENT_REVERSAL:{reversal_id}
TREASURY_TRANSFER:{transfer_id}
CASH_DEPOSIT:{deposit_id}
CASH_WITHDRAWAL:{withdrawal_id}
NOTE_SETTLEMENT:{note_settlement_id}
```

同 key 不同 payload → 409；同 key 同 payload → 幂等返回。

### 28.11.3 Canonical Balance

```text
opening_balance_cents
+ SUM(IN confirmed movements) - SUM(OUT confirmed movements)
= canonical balance
```

Reconciliation invariant：

```text
finance_settlement_accounts.cached_balance_cents (derived) == canonical
```

Mismatch → `finance-treasury-movement.js::assertBalanceReconciled` fail closed。

### 28.11.4 cash_journals 处置 (F8 / §33.24)

`cash_journals` 必须 converge / retire：

```text
A. 现金日记账作为读模型 / 兼容 projection 保留（cash_journals 表 + 列保留）
B. 所有写路径迁移到 applyTreasuryMovement(input)
C. 不得 UPDATE bank_accounts.balance_cents 绕过 applyTreasuryMovement
D. applyTreasuryMovement 是 finance-treasury-movement.js 唯一公开 API
```

`applyTreasuryMovement` 内部：

```text
1. lock settlement_account_id FOR UPDATE
2. assert account active
3. insert finance_treasury_movements row
4. update settlement_account.cached_balance_cents (derived)
5. emit accounting event
6. audit
```

### 28.11.5 Cash Deposit / Withdrawal (FO40)

`Cash → Bank` / `Bank → Cash`：

```text
applyTreasuryMovement(IN, account_id=cash, amount, ...)   // cash side down (if withdraw)
applyTreasuryMovement(OUT, account_id=bank, amount, ...)  // bank side down
```

或 `IN bank + OUT cash`，paired movement_group_id。

禁止 one-sided manual journal 当两边都是 internal account。

### 28.11.6 Internal Bank Transfer (FO41)

```text
applyTreasuryMovement(OUT, account_A, amount, group=transfer_id, ...)
applyTreasuryMovement(IN,  account_B, amount, group=transfer_id, ...)
```

Total organization cash 不变。Lock ordering: 字典序 ASC。

### 28.11.7 Notes (FO42 / FO43)

`finance_notes` 表 + lifecycle：

```text
REGISTERED → HELD → (ENDORSED | DISCOUNTED) → SETTLED
            ↘ CANCELLED
```

direction：`RECEIVABLE | PAYABLE`。财务 effect 走 AR/AP adapter + treasury adapter。

### 28.11.8 Payment Request (FO44)

`finance_payment_requests`：

```text
DRAFT → SUBMITTED → (APPROVED | REJECTED) → EXECUTED → CANCELLED
```

`APPROVED != cash movement`。Execution 才走 `applyTreasuryMovement`。Workflow approval 可走 Platform workflow。

### 28.11.9 Cash Count (FO45)

`finance_cash_counts` (header) + `finance_cash_count_lines`：

```text
header:
  id, count_no, settlement_account_id, business_date, book_amount_cents,
  physical_amount_cents, difference_cents, status, ...

lines:
  id, count_id, denomination, count_quantity, total_cents
```

Count confirm 不得 silent-overwrite balance；difference 走 explicit adjustment evidence（adapter 决定）。

## 28.12 Bank Statement / Reconciliation (FO46–FO49)

### 28.12.1 Statement Header / Lines (FO46)

保留 `bank_statements` / `bank_statement_items`（v13 + extended-schema 已建立）。

Lines 必须包含：

```text
id
statement_id
external_transaction_date
value_date
amount_cents
direction            IN | OUT
counterparty
bank_reference
description
import_fingerprint    UNIQUE
```

### 28.12.2 Import (FO47)

`finance_bank_statement_imports`：

```text
id
file_name
fingerprint
status              PENDING | IMPORTED | FAILED
imported_at
```

Import 通过 `import_fingerprint` UNIQUE idempotent；相同 fingerprint + 不同 payload → conflict；不同 payload 完全 idempotent。

### 28.12.3 Reconciliation (FO48)

`finance_bank_reconciliations` + `finance_bank_reconciliation_matches`：

```text
matches:
  id
  reconciliation_id
  statement_line_id
  treasury_movement_id
  matched_amount_cents
  match_method         AUTO | MANUAL
  matched_by
  matched_at
```

支持：

```text
1 ↔ 1
1 ↔ n
n ↔ 1
```

Invariant：

```text
SUM(matched_amount_cents) <= statement_line.remaining_amount_cents
SUM(matched_amount_cents) <= treasury_movement.remaining_amount_cents
```

reconciliation **不得**写 treasury movement。

### 28.12.4 Unmatched Items (FO49)

不创建 duplicate ledger。Report 派生：

```text
statement_line.remaining_amount_cents = amount_cents - SUM(matches.matched_amount_cents)
treasury_movement.unmatched_amount_cents = amount_cents - SUM(matches.matched_amount_cents)
```

## 28.13 Business Close (FO51 / FO52 / FO53)

### 28.13.1 Stable Lock Anchors — finance_business_close_state (NEW table #18)

**RACE-15 设计决策：稳定可锁定的 3 个 control anchor rows（per close_type），必须在普通 finance transactions 运行前存在；不得依赖 `SELECT latest closure row FOR UPDATE` 在 absence-row 上的 race。**

```sql
CREATE TABLE IF NOT EXISTS finance_business_close_state (
  close_type TEXT PRIMARY KEY CHECK(close_type IN ('AR','AP','TREASURY')),
  closed_through_date TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

-- 必装 3 rows by migration seed
INSERT OR IGNORE INTO finance_business_close_state(close_type, closed_through_date, updated_at, updated_by)
VALUES ('AR', '', datetime('now'), 'system'),
       ('AP', '', datetime('now'), 'system'),
       ('TREASURY', '', datetime('now'), 'system');
```

事务流：

```text
ordinary finance transaction (e.g. collection confirm):
  1. assertFinanceBusinessDateOpen('AR', businessDate)
       1.1. SELECT * FROM finance_business_close_state WHERE close_type='AR' FOR UPDATE
       1.2. assert closed_through_date == '' OR businessDate > closed_through_date
       1.3. proceed with canonical writer
  2. ... economic write ...
  3. COMMIT

finance close handler:
  1. SELECT * FROM finance_business_close_state WHERE close_type=? FOR UPDATE
  2. pre-close inspection
  3. UPDATE finance_business_close_state SET closed_through_date=newDate WHERE close_type=?
  4. INSERT INTO finance_business_closures (...) -- history row
  5. COMMIT

finance reopen handler:
  1. SELECT * FROM finance_business_close_state WHERE close_type=? FOR UPDATE
  2. assert closed_through_date != ''
  3. UPDATE finance_business_close_state SET closed_through_date='' WHERE close_type=?
  4. INSERT INTO finance_business_closures (status='REOPENED', reopened_by=?, reopened_at=?)
  5. COMMIT
```

Invariant：3 个 anchor row 在 migration 完成时已存在；任何 absence-row race 不可能发生。

### 28.13.2 History Rows — finance_business_closures (NEW table #19)

`finance_business_closures` 是 history / event 投影；仅记录 close / reopen 事件，不作为 lock target：

```sql
CREATE TABLE IF NOT EXISTS finance_business_closures (
  id TEXT PRIMARY KEY,
  close_type TEXT NOT NULL CHECK(close_type IN ('AR','AP','TREASURY')),
  closed_through_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED','REOPENED')),
  closed_by TEXT,
  closed_at TEXT,
  reopened_by TEXT,
  reopened_at TEXT,
  reopen_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(close_type, closed_through_date, status)
);
CREATE INDEX IF NOT EXISTS idx_business_closures_type ON finance_business_closures(close_type, status);
```

读模型（history）使用本表；写模型（lock target）使用 `finance_business_close_state`。

### 28.13.3 Guard

唯一入口：

```text
assertFinanceBusinessDateOpen(closeType: 'AR' | 'AP' | 'TREASURY', businessDate)
  1. SELECT * FROM finance_business_close_state WHERE close_type=? FOR UPDATE
  2. assert closed_through_date == '' OR businessDate > closed_through_date
```

每次 mutation 入口必声明：

```text
AR:    invoice recognition, collection, write-off, AR transfer, credit-note AR effect
AP:    supplier-bill recognition, payment, write-off, AP transfer, credit-note AP effect
TREASURY: applyTreasuryMovement, bank transfer, refund (treasury side), cash op, bank rec match
```

Transaction 可能要求多个 guard（如 AP write-off 同时要求 AP + TREASURY guard）。

### 28.13.4 Close Ordering

Document.md §33.31 不强制顺序。Design 推荐：

```text
AR  →  AP  →  TREASURY
```

各 close 仍独立（不同 `close_type`）；但 lock 顺序按字典序 ASC（§28.19）。

### 28.13.5 Reopen

Reopen 必须：

```text
1. 选定 close_type 的 finance_business_close_state row FOR UPDATE
2. UPDATE closed_through_date='' (或 new future date)
3. INSERT finance_business_closures REOPENED history row
4. 不允许 silent-reset; 不允许 DROP finance_business_closures history
```

### 28.13.6 Accounting Period Close

`finance_business_close_state` 与 Accounting & Analytics period close 独立：

```text
assertAccountingPeriodOpen  ←  Accounting & Analytics
assertFinanceBusinessDateOpen  ←  Finance Operations
```

两者并存，互不重写。

## 28.14 Integration Adapters

### 28.14.1 FO57 — Source Business Document Adapter

```text
getFinancialSourceFacts(sourceType, sourceId) -> {
  party: { type, id },
  business_date,
  source_lines: [{ line_id, quantity, amount_cents, currency, tax_snapshot }],
  source_status,
  source_no,
  billing_mode,
  approval_state,
}
```

消费 frozen domain source（Sales / Procurement / Outsourcing）；Finance Operations **不得** rewrite source。

### 28.14.2 FO58 — Accounting Event / Voucher Adapter

唯一 emit 入口：

```text
emitAccountingEvent(input: {
  source_type, source_id, source_no,
  business_date,
  event_type: 'AR_RECOGNITION' | 'AP_RECOGNITION' | 'COLLECTION' | 'PAYMENT' |
              'REFUND' | 'SETTLEMENT_REVERSAL' | 'WRITE_OFF' | 'TRANSFER' |
              'TREASURY_MOVEMENT' | 'PROVISIONAL_CONVERSION' | ...,
  amount_cents,
  debit_subjects: [...],
  credit_subjects: [...],
  idempotency_key,
}) -> { accounting_event_id, voucher_id? }
```

复用既有 canonical voucher adapter（createSystemVoucher / voucher-templates）；**不得**新建第二 voucher engine。

### 28.14.3 FO50 — Treasury ↔ GL Reconciliation

```text
compareTreasuryToGL(settlementAccountId, businessDate) -> {
  treasury_balance_cents,
  gl_balance_cents,
  delta_cents,
  status: 'PASS' | 'MISMATCH',
}
```

CHECK-only。Mismatch 仅生成 reconciliation evidence，**不得** auto repair GL。

## 28.15 Permission Model

### 28.15.0 Capability Boundary — NOT Finance Operations Capabilities

**明确划清：以下 permission codes 不是 Finance Operations capability permissions。它们属于 Accounting & Analytics / Master & Engineering。Finance Operations Design 不将其计入 FINANCE_* family，亦不基于 `role-accounting` 历史 seed 持有而扩展为 Finance capability。**

```text
FIXED_ASSETS_VIEW / MANAGE         ← Accounting & Analytics (B3107 固定资产)
COST_*                             ← Accounting & Analytics (B3106 存货核算 + B3117 经营会计)
VOUCHER_SUBMIT                     ← Accounting & Analytics (B3114 智能会计平台)
VOUCHER_*                          ← Accounting & Analytics
ACCOUNTING_VIEW                    ← Accounting & Analytics (B3115 总账)
PRODUCT_COSTS_*                    ← Accounting & Analytics
```

本节兼容性 §28.15.1 中保留这些 codes（因为 `role-accounting` 历史 seed 已持有），但仅作为 **compatibility retention**，**不**作为 Finance Operations capability。

### 28.15.1 兼容策略

保留现有（其中 FIXED_ASSETS_* / VOUCHER_SUBMIT / ACCOUNTING_VIEW 保留为 compatibility retention per §28.15.0；不属于 Finance capability）：

```text
AR_VIEW                 COLLECTION_MANAGE
AP_VIEW                 PAYMENT_MANAGE
CASH_JOURNALS_VIEW/MANAGE
BANK_ACCOUNTS_VIEW/MANAGE
BILLS_VIEW/MANAGE
BANK_RECONCILE_VIEW/MANAGE
SALES_DISCOUNT_MANAGE   PURCHASE_DISCOUNT_MANAGE
(FIXED_ASSETS_VIEW/MANAGE  -- Compatibility retention; NOT Finance Operations capability)
(VOUCHER_SUBMIT           -- Compatibility retention; NOT Finance Operations capability)
(ACCOUNTING_VIEW          -- Compatibility retention; NOT Finance Operations capability)
REPORT_VIEW
```

Finance Operations 新增 bounded family（admin 继承；其它角色按 Design 默认 deny）：

```text
FINANCE_RECOGNITION_POLICY_VIEW / MANAGE
FINANCE_AR_VIEW                 (alias AR_VIEW; additive)
FINANCE_AP_VIEW                 (alias AP_VIEW; additive)
FINANCE_INVOICE_VIEW / MANAGE
FINANCE_TREASURY_VIEW / MANAGE
FINANCE_SETTLEMENT_ACCOUNT_VIEW / MANAGE  (over bank_accounts master)
FINANCE_TRANSFER_MANAGE         (FO15)
FINANCE_WRITE_OFF_MANAGE        (FO27)
FINANCE_BAD_DEBT_MANAGE         (FO28)
FINANCE_NOTES_MANAGE            (FO42 / FO43)
FINANCE_PAYMENT_REQUEST_MANAGE  (FO44)
FINANCE_CASH_COUNT_MANAGE       (FO45)
FINANCE_BANK_STATEMENT_IMPORT   (FO47)
FINANCE_RECONCILE_MANAGE        (FO48)
FINANCE_CLOSE_VIEW / MANAGE     (FO51 / FO52 / FO53)
```

5 个 role seed：`admin / sales / warehouse / reviewer / accounting` 默认值保持现状；`admin` 继承全部新增（含 FINANCE_*）；`role-accounting` 增加：

```text
FINANCE_RECOGNITION_POLICY_MANAGE
FINANCE_INVOICE_MANAGE
FINANCE_TREASURY_MANAGE
FINANCE_SETTLEMENT_ACCOUNT_MANAGE
FINANCE_TRANSFER_MANAGE
FINANCE_WRITE_OFF_MANAGE
FINANCE_BAD_DEBT_MANAGE
FINANCE_NOTES_MANAGE
FINANCE_PAYMENT_REQUEST_MANAGE
FINANCE_CASH_COUNT_MANAGE
FINANCE_BANK_STATEMENT_IMPORT
FINANCE_RECONCILE_MANAGE
FINANCE_CLOSE_MANAGE
```

注：`role-accounting` 历史持有的 `FIXED_ASSETS_*` / `VOUCHER_SUBMIT` / `ACCOUNTING_VIEW` 不被本 Design 重分类为 Finance capability；保留为 compatibility retention（其 canonical owner 由 Accounting & Analytics Domain Closure 决定）。

其它角色（`sales` / `warehouse` / `reviewer`）默认 deny finance permission（除非 future Requirement 显式放宽）。

### 28.15.2 Backend Fail Closed

每个 mutation handler 必须 `allow(actor, 'FINANCE_*')`；前端 hidden 不等于授权；VIEW 不隐含 MANAGE。

`role-accounting` 历史持有 `FIXED_ASSETS_*` 不构成 Finance Operations 写权限 — 例如 `updateFixedAsset` handler 不允许由 FINANCE_* MANAGE 通过；必须由 Accounting & Analytics capability 鉴权（即便未来实现尚未启动）。

## 28.16 API / Route Architecture

### 28.16.1 Endpoint Family（命名空间）

保留兼容 + additive：

```text
GET/POST/PATCH /api/finance/parameters
GET/POST/PATCH /api/finance/recognition-policy

GET/POST/PATCH /api/finance/due-schedules

GET/POST/PATCH /api/accounts-receivable
GET/POST/PATCH /api/accounts-payable

GET/POST/PATCH /api/payment-collections
GET/POST/PATCH /api/payment-disbursements

GET/POST/PATCH /api/finance/unapplied-balances
GET/POST/PATCH /api/finance/refunds
GET/POST/PATCH /api/finance/write-offs
GET/POST/PATCH /api/finance/bad-debt-provisions
GET/POST/PATCH /api/finance/transfers

GET/POST/PATCH /api/sales-invoices
GET/POST/PATCH /api/supplier-bills
GET/POST/PATCH /api/commercial-credit-notes

GET/POST/PATCH /api/finance/settlement-accounts
GET       /api/finance/treasury-movements
POST      /api/finance/treasury-transfers
POST      /api/finance/treasury/cash-deposit
POST      /api/finance/treasury/cash-withdrawal
GET/POST/PATCH /api/finance/notes
GET/POST/PATCH /api/finance/payment-requests
GET/POST/PATCH /api/finance/cash-counts

GET/POST/PATCH /api/finance/bank-statements
POST      /api/finance/bank-statements/import
GET/POST/PATCH /api/finance/bank-reconciliations

POST      /api/finance/business-close/{ar|ap|treasury}/close
POST      /api/finance/business-close/{ar|ap|treasury}/reopen
GET       /api/finance/business-close

GET       /api/finance/reports/{ar|ap|treasury}/{summary|detail|aging|due|tracking|uninvoiced|reconciliation}

POST      /api/finance/source-facts          (FO57 read-only)
POST      /api/finance/accounting-events     (FO58 emit)
```

`/api/finance/*` 是命名空间；legacy 路径保留为 alias。

### 28.16.2 Compatibility / 410 Strategy

不 flag-day rewrite：

```text
legacy endpoint
  → canonical finance module
  → 旧业务逻辑禁止散落；仅保留 dispatch + adapter
```

Deprecated routes 在 caller migration 完成后返回 410：

```text
/api/cash-journals  → 410 after migration
/api/bills          → 410 after migration
/api/fixed-assets   → 410 after migration (B3107 → Accounting & Analytics)
/api/bank-accounts  → /api/finance/settlement-accounts alias 保留至 migration 完
```

## 28.17 Mobile Information Architecture

### 28.17.1 Launcher Strategy

≤ 6 Finance Operations primary launcher entries（document.md §33.41）：

```text
Receivables     (FO09 / FO11 / FO15 / FO22 / FO26 / FO27 / FO28)
Collections     (FO16 / FO18 / FO19 / FO20)
Payables        (FO10 / FO12 / FO15)
Payments        (FO17 / FO18 / FO25 / FO26)
Invoices        (FO29 / FO30 / FO31 / FO33 / FO34 / FO35)
Treasury        (FO37 / FO39 / FO40 / FO41 / FO45 / FO48 / FO53)
```

Sub-functions（refund / write-off / bad-debt / close / bank reconciliation / cash count / notes / payment request / AR-AP transfer）通过 hub / contextual navigation。

### 28.17.2 Responsive Contract

```text
320 / 390 / 430 / 680 CSS px
no horizontal document overflow
touch targets ≥ 44px
LIST → DETAIL → EDITOR / WORKFLOW
```

### 28.17.3 Domain Alignment Migration

B3106 (`product-costs` / `cost-rates`) 与 B3107 (`fixed-assets`) 当前 `domain='finance-operations'` 保留为 architectural debt。本 Domain Closure 不实施 route 移动；后续 Domain Alignment 单独调整。

### 28.17.4 Discount UI

- sales-discounts：commercial UI owner = Sales & Customer；finance effect = Finance Operations（FO26 经 credit-adjustment）。
- purchase-discounts：contextual Finance Operations；finance effect = Finance Operations。
- 不得仅因视觉对称 move routes。

## 28.18 Migration / Convergence Strategy

### 28.18.1 既有 canonical 保留（converge）

保留并扩展：

```text
account_receivables            (FO09 / FO11; canonical open-item header AR with additive recognition_mode / item_kind / conversion_state / provisional_origin_id / converted_open_item_id / settlement_account_id)
account_payables               (FO10 / FO12; canonical open-item header AP same additive)
payment_collections            (FO16)
payment_disbursements          (FO17)
payment_collection_items       (FO18; canonical source for ALLOCATION)
payment_disbursement_items     (FO18; canonical source for ALLOCATION)
financial_credit_adjustments   (CREDIT canonical source)
settlement_unapplied_balances  (PREPAYMENT / CREDIT canonical source)
balance_applications           (UNAPPLIED_APPLICATION canonical source)
financial_refunds              (FO26)
financial_refund_reversals     (REFUND reversal canonical source)
settlement_reversals           (FO22 header)
settlement_reversal_items      (FO22 component-level reversal; ALLOCATION + UNAPPLIED)
financial_write_offs           (FO27; WRITE_OFF canonical source)
financial_write_off_reversals  (WRITE_OFF reversal canonical source)
bank_statements / items        (FO46)
bank_reconciliations           (legacy compat projection; canonical 由 finance_bank_reconciliations 接管)
cash_journals                  (FO39 read projection; write path 全部迁移至 applyTreasuryMovement)
bills                          (FO42 / FO43 legacy; migrate to finance_notes)
sales_invoices / supplier_bills / commercial_credit_notes  (FO29 / FO30 / FO33)
```

`bank_accounts` 现归 EXISTING_CONVERGE（canonical master，见 §28.1.2.1）。`bank_reconciliations` / `period_closures` 归 COMPATIBILITY（§28.1.2.3）。

MODEL B 决定：

```text
existing source tables = canonical economic facts
finance_open_item_effects = DERIVED SQL VIEW (non-authoritative / non-persisted / rebuild-free)
refreshOpenAmount() reads the VIEW only; chain: source facts → VIEW → equation → cached open_amount_cents
```

不得新建第二 engine；finance_settlement_accounts master **不创建**（bank_accounts 单 master）。

### 28.18.2 Additive / Idempotent Migration

每个 finance migration 必须：

```text
1. ADD COLUMN / CREATE TABLE IF NOT EXISTS
2. idempotent（重跑 OK）
3. 不 DROP historical finance table
4. 不 UPDATE 历史已确认 financial facts
5. before / after reconciliation check
6. fail-closed on mismatch
7. rollback aware
```

### 28.18.3 AR / AP Double Recognition Detection

启用新 recognition engine 前：

```sql
SELECT * FROM account_receivables a
WHERE EXISTS (
  SELECT 1 FROM sales_invoices si WHERE si.id = a.source_id AND si.source_type='SALES_INVOICE'
)
```

分类：

```text
SAFE_LINK          -- invoice.post 显式 link 既有 AR
DUPLICATE_EXPOSURE  -- AR 已有 + invoice post 又创建新 AR
AMBIGUOUS          -- 无法判定 → migration abort + report
```

ambiguous → 不启用；要求 user intervention。

### 28.18.4 Treasury Reconciliation

```text
bank_accounts.balance_cents  vs  SUM(finance_treasury_movements by account)
cash_journals                 →  classify already_represented / needs_migration / ambiguous
```

不得 double import。convergence 后只 `applyTreasuryMovement` 一个 active writer。

### 28.18.5 Due Schedule

```text
INSERT INTO finance_due_schedule_lines(open_item_id, sequence=1, due_date=ar.due_date, scheduled_amount_cents=ar.original_amount_cents)
```

未知 / 缺 legacy terms：保留 single-line default。

### 28.18.6 Provisional Migration

只 migrate policy evidence 允许的；其他保留 legacy final/open facts。

### 28.18.7 Health Checks

```text
duplicate exposure
negative open amount
open cache mismatch
orphan allocation
negative unapplied balance
treasury balance mismatch
orphan treasury movement
invoice recognition mismatch
provisional conversion mismatch
bank match over-allocation
business-close violation
```

Blocking mismatch → health FAIL。

## 28.19 Transaction / Locking Model

### 28.19.1 Transaction Boundaries

每个 economic write 必须 transaction boundary：

```text
open-item recognition           → transaction
allocation confirm              → transaction
reversal                        → transaction
refund                          → transaction
write-off                       → transaction
transfer                        → transaction
provisional conversion          → transaction
invoice post                    → transaction
treasury movement               → transaction (applyTreasuryMovement)
bank transfer                   → transaction
business close                  → transaction
bank reconciliation match       → transaction (no cash mutation)
```

不允许 partial economic commit。

### 28.19.2 Lock Ordering

Open item 锁定顺序：

```text
1. collect open_item IDs
2. deduplicate
3. sort lexicographic ASC
4. lock ASC (FOR UPDATE on MySQL; BEGIN IMMEDIATE on SQLite)
```

Settlement account：

```text
1. collect account IDs
2. deduplicate
3. sort ASC
4. lock ASC
```

Bank reconciliation match：

```text
1. statement_line IDs
2. treasury_movement IDs
3. combined sort ASC
```

不得基于业务方向加锁（避免反向 transfer deadlock）。

### 28.19.3 SQLite vs MySQL

SQLite：`BEGIN IMMEDIATE` 序列化写。

MySQL：`SELECT ... FOR UPDATE` 锁存在行；absence / uniqueness race 走：

```text
UNIQUE keys
idempotency keys
transaction retry (复用既有 retry infrastructure)
```

`finance_treasury_movements.idempotency_key` UNIQUE 与 `finance_bank_statement_items.import_fingerprint` UNIQUE 是 absence-race 的兜底。`finance_open_item_effects` 是 DERIVED SQL VIEW（无 UNIQUE 约束）；absence-race 兜底由 underlying source tables 提供。

## 28.20 MySQL Race Design (15)

每个 race 真实 MySQL 实证；SQLite-only 不计入。

### 28.20.1 Race Matrix

| Race | Conflicting Ops | Rows Locked | Lock Order | Idempotency | Expected Outcome |
|---|---|---|---|---|---|
| RACE-01 | Collection vs Collection on same AR | target AR open items (sorted) + both collections' allocations | AR open_item_ids ASC | COLLECTION_CONFIRM:{collection_id} UNIQUE | exactly-one total allocation succeeds; no negative open |
| RACE-02 | Payment vs Payment on same AP | target AP open items + both disbursements' allocations | AP open_item_ids ASC | PAYMENT_CONFIRM:{disbursement_id} UNIQUE | exactly-one total allocation succeeds |
| RACE-03 | Collection confirm vs settlement reversal | collection + allocations + affected open items | settlement id ASC then open_item id ASC | COLLECTION_CONFIRM + SETTLEMENT_REVERSAL both UNIQUE | either both committed or no cash reversal without allocation reversal |
| RACE-04 | Payment confirm vs settlement reversal | disbursement + allocations + open items | same as RACE-03 | same | same invariant |
| RACE-05 | Same prepayment / advance application twice | unapplied_balance + target_open_item | balance_id then target_open_item_id ASC | BALANCE_APPLY:{balance_id}:{target_id}:{amount} UNIQUE | remaining unapplied cannot go negative |
| RACE-06 | Refund vs balance application | balance_id + target_open_item | balance_id then target_open_item_id ASC | REFUND_CONFIRM + BALANCE_APPLY UNIQUE | only remaining consumed |
| RACE-07 | Write-off vs settlement | open_item_id + write_off + settlement allocation | open_item_id ASC | WRITE_OFF_CONFIRM + COLLECTION_CONFIRM UNIQUE | combined effect cannot exceed open amount |
| RACE-08 | AR transfer vs collection | source_open_item + transfer + target open item | open_item_ids ASC | TRANSFER_CONFIRM + COLLECTION_CONFIRM UNIQUE | total exposure conserved |
| RACE-09 | AP transfer vs payment | same as RACE-08 for AP side | same | same | same |
| RACE-10 | Same sales invoice post twice | invoice + invoice_source_links + recognizeFinanceExposure | invoice.id ASC | INVOICE_POST:{invoice_id} UNIQUE | idempotent repeat → same result or controlled 409 |
| RACE-11 | Supplier Bill Match / Post / Double-Post | supplier_bill + receipt lines + invoice_source_links + recognizeFinanceExposure | bill.id then source line ids ASC | SUPPLIER_BILL_MATCH + SUPPLIER_BILL_POST UNIQUE | A match vs post protected; B post vs post protected |
| RACE-12 | Provisional conversion vs ordinary settlement | provisional_open_item + conversion + target final open item + payment | open_item_ids ASC | PROVISIONAL_CONVERT:{bill_id} UNIQUE | conversion locks provisional before payment can target final |
| RACE-13 | Same treasury transfer execute twice | **both bank_accounts canonical settlement accounts** + finance_treasury_movements | **both settlement_account_ids ASC (deterministic ordering across two accounts)** | TREASURY_TRANSFER:{transfer_id} UNIQUE | exactly one OUT + IN pair; lock order ASC over the two bank_accounts rows |
| RACE-14 | Same bank statement line reconcile twice | statement_line + treasury_movement + reconciliation_match | statement_line ASC then movement ASC | BANK_MATCH:{statement_id}:{movement_id}:{amount} UNIQUE | remaining cannot go negative |
| RACE-15 | Business close vs dated financial transaction | **finance_business_close_state row (3 seeded anchors)** + any dated transaction | **stable anchor FOR UPDATE** in `finance_business_close_state(close_type=?)` | assertFinanceBusinessDateOpen locks same row as close handler; **no absence-row race** | either transaction commits before close or close commits first and transaction rejects; never both inconsistent |

### 28.20.2 Future Gate

```text
pnpm test:mysql:finance-concurrency
  → FINANCE RACE DIALECT = mysql
  → RACE-01..15 = PASS
```

必须真实 MySQL；不得复用 Inventory race list。

## 28.21 UAT Traceability (32)

| UAT | Capability | Service | Table | Endpoint | Evidence |
|---|---|---|---|---|---|
| UAT-01 AR initialization | FO06 | finance-ar-init.js | account_receivables (opening) + finance_due_schedule_lines | /api/finance/parameters + opening handler | opening AR + opening_other_AR; no fake daily history |
| UAT-02 AP initialization | FO07 | finance-ap-init.js | account_payables + finance_due_schedule_lines | same | same |
| UAT-03 Treasury initialization | FO08 | finance-treasury-init.js | **bank_accounts (canonical settlement account master via additive extend)** + finance_treasury_movements (opening) | /api/finance/settlement-accounts POST | opening cash + bank + enterprise outstanding |
| UAT-04 DIRECT_BUSINESS AR | FO09 + FO02 | recognizeFinanceExposure | account_receivables (canonical header); finance_open_item_effects (DERIVED VIEW projection) | sales-deliveries confirm + /api/accounts-receivable | one final AR; later invoice link only |
| UAT-05 INVOICE_DRIVEN AR | FO09 + FO02 | recognizeFinanceExposure | account_receivables | sales-invoices post | one final AR; no delivery AR |
| UAT-06 PROVISIONAL_TO_FINANCIAL AR | FO11 + FO13 | recognizeFinanceExposure + reverseProvisionalAndCreateFinal | account_receivables (conversion_state + converted_open_item_id); finance_open_item_effects (DERIVED VIEW projection) | /api/sales-invoices post | provisional reverse + final create |
| UAT-07 DIRECT_BUSINESS AP | FO10 + FO02 | recognizeFinanceExposure | account_payables | purchase-receipts confirm | one final AP |
| UAT-08 INVOICE_DRIVEN AP | FO10 + FO02 | recognizeFinanceExposure | account_payables | supplier-bills post | one final AP |
| UAT-09 PROVISIONAL_TO_FINANCIAL AP | FO12 + FO13 | recognizeFinanceExposure + convertProvisionalToFinancial | account_payables (conversion_state + converted_open_item_id); finance_open_item_effects (DERIVED VIEW projection) | /api/supplier-bills post | provisional reverse + final create |
| UAT-10 Multi-due-date Schedule | FO04 | finance-due-schedule.js | finance_due_schedule_lines (side+open_item_id portable identity) | /api/finance/due-schedules | sum=original; partial allocation tracks due_date ASC |
| UAT-11 Partial collection | FO16 + FO18 | payment_collections + payment_collection_items | payment_collections + payment_collection_items (canonical source) | /api/payment-collections POST | partial open → PARTIAL; no over-application |
| UAT-12 Partial payment | FO17 + FO18 | payment_disbursements + payment_disbursement_items | payment_disbursements + payment_disbursement_items (canonical source) | /api/payment-disbursements POST | partial open → PARTIAL |
| UAT-13 Multi-open-item allocation | FO18 | payment_*_items | payment_*_items (canonical source) | multi-line allocation | one settlement → many items; many → one |
| UAT-14 Automatic / manual reconciliation | FO19 + FO20 | finance-reconciliation.js | payment_*_items (auto) + manual allocation | /api/finance/reconciliation run + manual | single AR/AP truth |
| UAT-15 Advance receipt | FO23 | finance-unapplied-balance.js | settlement_unapplied_balances (PREPAYMENT, canonical source) | /api/payment-collections w/ explicit_unapplied | balance created; not allocation |
| UAT-16 Supplier prepayment | FO23 | finance-unapplied-balance.js | settlement_unapplied_balances (PREPAYMENT, SUPPLIER) | /api/payment-disbursements w/ explicit_unapplied | balance created |
| UAT-17 Unapplied balance application | FO25 | balance_applications | balance_applications (canonical source) | /api/finance/unapplied-balances apply | balance remaining → 0; target open_item down |
| UAT-18 Unapplied-Balance Refund | FO26 | financial_refunds + applyTreasuryMovement | financial_refunds + finance_treasury_movements | /api/finance/refunds POST | customer-side + supplier-side both PASS |
| UAT-19 Settlement reversal | FO22 | settlement_reversals + settlement_reversal_items | settlement_reversals + settlement_reversal_items (canonical source) | /api/finance/settlements/{id}/reverse | ALLOCATION + UNAPPLIED component reversal |
| UAT-20 Write-off + reversal | FO27 | financial_write_offs + reversals | financial_write_offs + financial_write_off_reversals (canonical source) | /api/finance/write-offs + reverse | DRAFT → CONFIRMED → REVERSED; accounting event |
| UAT-21 Bad-Debt Provision | FO28 | finance_bad_debt_provisions | finance_bad_debt_provisions | /api/finance/bad-debt-provisions | AGING + INDIVIDUAL; reversal evidence |
| UAT-22 AR counterparty transfer | FO15 | finance-counterparty-transfer | finance_counterparty_transfers + finance_counterparty_transfer_lines | /api/finance/transfers | source down + target up; total conserved |
| UAT-23 AP counterparty transfer | FO15 | same AP | same | /api/finance/transfers | same invariant |
| UAT-24 Sales invoice partial / source / credit / void | FO29 + FO31 + FO33 + FO34 | finance-sales-invoice.js | sales_invoices (lifecycle + credit_state) + finance_invoice_source_links + commercial_credit_notes | /api/sales-invoices POST + patch | partial invoicing + credit_state NONE/PARTIAL/FULL; void only with atomic reversal |
| UAT-25 Purchase invoice matching / verification / credit | FO30 + FO31 + FO35 | finance-purchase-invoice.js | supplier_bills + finance_invoice_source_links + verification_state | /api/supplier-bills POST + verify | 3-way match; UNVERIFIED→VERIFIED→CERTIFIED/REJECTED |
| UAT-26 Cash / Bank settlement account | FO37 + FO38 | finance-settlement-account | **bank_accounts (canonical, additive extended with CASH/BANK/code/opening_balance_cents/accounting_role)** | /api/finance/settlement-accounts | CASH + BANK rows in single master; opening + accounting_role + accounting_subject_id; finance_settlement_accounts master NOT created |
| UAT-27 Cash deposit / withdrawal + internal transfer | FO40 + FO41 | finance-treasury-cash + finance-treasury-bank-transfer | finance_treasury_movements (paired, movement_group_id) + bank_accounts.balance_cents cache | /api/finance/treasury/cash-deposit + treasury-transfers | paired IN/OUT; total conserved; balance cache reconciles to canonical movements |
| UAT-28 Notes receivable / payable + payment request | FO42 + FO43 + FO44 | finance-notes + finance-payment-request | finance_notes + finance_payment_requests | /api/finance/notes + /api/finance/payment-requests | REGISTERED→HELD→SETTLED; APPROVED!=movement |
| UAT-29 Cash count | FO45 | finance-cash-count | finance_cash_counts + finance_cash_count_lines | /api/finance/cash-counts POST | book vs physical; difference explicit; no silent overwrite |
| UAT-30 Bank statement import + reconciliation + unmatched items | FO46 + FO47 + FO48 + FO49 | finance-bank-statement + finance-bank-import + finance-bank-reconciliation | bank_statements + bank_statement_items + **finance_bank_statement_imports** + **finance_bank_reconciliations** + **finance_bank_reconciliation_matches** | /api/finance/bank-statements/import + reconciliations | idempotent import (fingerprint); 1↔1 / 1↔n / n↔1 matches; unmatched projection; no treasury mutation from recon |
| UAT-31 AR / AP / Treasury close + reopen | FO51 + FO52 + FO53 | finance-business-close | **finance_business_close_state (stable 3-seeded anchor, lock target)** + finance_business_closures (history rows) | /api/finance/business-close/{ar\|ap\|treasury}/{close\|reopen} | composite: three independent closes each PASS; absence-row race eliminated by seeded anchors |
| UAT-32 AR / AP / Treasury reports + Treasury ↔ GL reconciliation | FO54 + FO55 + FO56 + FO50 | finance-reports + finance-gl-reconcile | report projections + comparison result | /api/finance/reports/* + /api/finance/gl-reconcile | POSTED-only fact projections; PASS/MISMATCH |

Final Acceptance 必须 `32 / 32 PASS`；不得 defer。

### 28.21.1 UAT-18 双方向必证

UAT-18 必须独立两个 test：

```text
UAT-18a Customer-side refund PASS
UAT-18b Supplier-side refund PASS
```

UAT-19 不得替代 UAT-18。

### 28.21.2 UAT-31 三独立业务关账

UAT-31 是 composite：

```text
UAT-31a AR close + reopen PASS
UAT-31b AP close + reopen PASS
UAT-31c Treasury close + reopen PASS
UAT-31d AR close != AP close != Treasury close
UAT-31e 三者均 != Accounting & Analytics accounting-period close
```

## 28.22 Capability Traceability (58)

| ID | Domain / Integration | Status | Service | Schema / Module |
|---|---|---|---|---|
| FO01 | Domain-Owned | EXISTING_REUSE | finance-parameters | finance_parameters (NEW table #1) |
| FO02 | Domain-Owned | NEW | finance-recognition-policy | finance_recognition_policy (NEW table #2) |
| FO03 | Domain-Owned | NEW | finance-terms | finance_payment_terms (NEW table #3) |
| FO04 | Domain-Owned | NEW | finance-due-schedule | finance_due_schedule_lines (NEW table #4; side+open_item_id portable identity) |
| FO05 | Domain-Owned | NEW | finance-settlement-scheme | finance_settlement_schemes (NEW table #5) |
| FO06 | Domain-Owned | CONVERGE | finance-ar-init + commercial-golive | account_receivables (canonical header; additive cols) + finance_due_schedule_lines (opening migration) |
| FO07 | Domain-Owned | CONVERGE | finance-ap-init + commercial-golive | account_payables (canonical header; additive cols) + finance_due_schedule_lines |
| FO08 | Domain-Owned | CONVERGE | finance-treasury-init | bank_accounts (canonical master additive extend) + finance_treasury_movements (opening) |
| FO09 | Domain-Owned | CONVERGE | finance-ar-open-item | account_receivables (canonical header); finance_open_item_effects (DERIVED VIEW projection) |
| FO10 | Domain-Owned | CONVERGE | finance-ap-open-item | account_payables (canonical header); finance_open_item_effects (DERIVED VIEW projection) |
| FO11 | Domain-Owned | NEW | finance-ar-open-item (PROVISIONAL) | item_kind='PROVISIONAL' on account_receivables |
| FO12 | Domain-Owned | NEW | finance-ap-open-item (PROVISIONAL) | item_kind='PROVISIONAL' on account_payables |
| FO13 | Domain-Owned | NEW | finance-provisional-conversion | conversion_state / converted_open_item_id on account_receivables / account_payables |
| FO14 | Domain-Owned | NEW | finance-manual-ar-ap | account_receivables / account_payables (manual) |
| FO15 | Domain-Owned | NEW | finance-counterparty-transfer | finance_counterparty_transfers (NEW #6) + finance_counterparty_transfer_lines (NEW #7) |
| FO16 | Domain-Owned | EXISTING_REUSE | finance-collection | payment_collections (EXISTING_CONVERGE) |
| FO17 | Domain-Owned | EXISTING_REUSE | finance-payment | payment_disbursements (EXISTING_CONVERGE) |
| FO18 | Domain-Owned | EXISTING_REUSE | finance-allocation | payment_collection_items / payment_disbursement_items (canonical source for ALLOCATION) |
| FO19 | Domain-Owned | NEW | finance-reconciliation (auto) | finance_settlement_schemes (NEW #5) rule rows |
| FO20 | Domain-Owned | NEW | finance-reconciliation (manual) | manual allocation path |
| FO21 | Domain-Owned | EXISTING_REUSE | settlement | audit / trace evidence |
| FO22 | Domain-Owned | EXISTING_REUSE | finance-settlement-reversal | settlement_reversals + settlement_reversal_items (canonical source for REVERSAL) |
| FO23 | Domain-Owned | EXISTING_REUSE | finance-unapplied-balance (PREPAYMENT) | settlement_unapplied_balances (canonical source) |
| FO24 | Domain-Owned | EXISTING_REUSE | finance-unapplied-balance (CREDIT) | settlement_unapplied_balances (canonical source) |
| FO25 | Domain-Owned | EXISTING_REUSE | finance-unapplied-balance (apply) | balance_applications (canonical source for UNAPPLIED_APPLICATION) |
| FO26 | Domain-Owned | EXISTING_REUSE | finance-unapplied-balance (refund) | financial_refunds + applyTreasuryMovement |
| FO27 | Domain-Owned | EXISTING_REUSE | finance-write-off | financial_write_offs (canonical source for WRITE_OFF) |
| FO28 | Domain-Owned | NEW | finance-bad-debt-provision | finance_bad_debt_provisions (NEW #8) |
| FO29 | Domain-Owned | CONVERGE | finance-sales-invoice | sales_invoices (additive cols incl. credit_state / credited_amount_cents / remaining_creditable_amount_cents) |
| FO30 | Domain-Owned | CONVERGE | finance-purchase-invoice | supplier_bills (additive cols incl. credit_state etc.) |
| FO31 | Domain-Owned | NEW | finance-invoice-cardinality | finance_invoice_source_links (NEW #9) |
| FO32 | Domain-Owned | NEW | finance-invoice-arap-reconcile | invoice ↔ open_item links |
| FO33 | Domain-Owned | EXISTING_REUSE | finance-sales-invoice (credit) | commercial_credit_notes (canonical source for COMMERCIAL_CREDIT) |
| FO34 | Domain-Owned | CONVERGE | finance-sales-invoice (void) | sales_invoices.status=VOIDED/CANCELLED (atomic-reversal scope) |
| FO35 | Domain-Owned | NEW | finance-purchase-invoice (verification) | supplier_bills.verification_state |
| FO36 | Domain-Owned | NEW | finance-reports | invoice operational reports (report projection) |
| FO37 | Domain-Owned | NEW | finance-settlement-account | **bank_accounts (canonical master, additive extend — no finance_settlement_accounts table)** |
| FO38 | Domain-Owned | NEW | finance-settlement-method | bank_accounts.account_type / accounting_role additive cols |
| FO39 | Domain-Owned | NEW | finance-treasury-movement | finance_treasury_movements (NEW #10) + applyTreasuryMovement |
| FO40 | Domain-Owned | NEW | finance-treasury-cash | paired movements via applyTreasuryMovement |
| FO41 | Domain-Owned | NEW | finance-treasury-bank-transfer | paired movements via applyTreasuryMovement (bank_accounts lock ASC) |
| FO42 | Domain-Owned | NEW | finance-notes (RECEIVABLE) | finance_notes (NEW #11) |
| FO43 | Domain-Owned | NEW | finance-notes (PAYABLE) | finance_notes (NEW #11) |
| FO44 | Domain-Owned | NEW | finance-payment-request | finance_payment_requests (NEW #12) |
| FO45 | Domain-Owned | NEW | finance-cash-count | finance_cash_counts (NEW #13) + finance_cash_count_lines (NEW #14) |
| FO46 | Domain-Owned | EXISTING_REUSE | finance-bank-statement | bank_statements + items |
| FO47 | Domain-Owned | NEW | finance-bank-import | finance_bank_statement_imports (NEW #15) |
| FO48 | Domain-Owned | NEW | finance-bank-reconciliation | finance_bank_reconciliations (NEW #16) + finance_bank_reconciliation_matches (NEW #17) |
| FO49 | Domain-Owned | NEW | finance-bank-reconciliation (unmatched) | unmatched projections (read model) |
| FO50 | Integration-Backed | INTEGRATION | finance-gl-reconcile | comparison evidence (no GL mutation) |
| FO51 | Domain-Owned | NEW | finance-business-close (AR) | finance_business_close_state (NEW #18; AR seed) + finance_business_closures (NEW #19; history) |
| FO52 | Domain-Owned | NEW | finance-business-close (AP) | finance_business_close_state (NEW #18; AP seed) + finance_business_closures (NEW #19; history) |
| FO53 | Domain-Owned | NEW | finance-business-close (TREASURY) | finance_business_close_state (NEW #18; TREASURY seed) + finance_business_closures (NEW #19; history) |
| FO54 | Domain-Owned | NEW | finance-reports (AR) | AR reports |
| FO55 | Domain-Owned | NEW | finance-reports (AP) | AP reports |
| FO56 | Domain-Owned | NEW | finance-reports (Treasury) | Treasury reports |
| FO57 | Integration-Backed | INTEGRATION | finance-source-adapter | getFinancialSourceFacts (read only) |
| FO58 | Integration-Backed | INTEGRATION | finance-accounting-adapter | emitAccountingEvent (use existing voucher adapter) |

合计 `58 = 55 Domain-Owned + 3 Integration-Backed`。每 ID 显式标注 status；后续 Implementation 不得变更。

## 28.23 Implementation Waves (5, fixed)

不得扩展至 Wave F+。

### 28.23.0 Primary Wave Ownership — Exactly One Per Capability

每个 FO01..FO58 显式拥有唯一 primary Wave；其它 Wave 仅能以 dependency / integration / acceptance reuse 引用。

| FO | Primary Wave | Role in Other Waves |
|---|---|---|
| FO01 | **Wave A** | A 主；B/C/D/E 仅读取参数 |
| FO02 | **Wave A** | A 主；B/C 消费 policy |
| FO03 | **Wave A** | A 主；B 消费 terms 生成 allocation priority |
| FO04 | **Wave A** | A 主；B 在 allocation 时消费 schedule lines |
| FO05 | **Wave B** | B 主；A 仅占位 schema |
| FO06 | **Wave A** | A 主；E 关闭 compatibility 报告 |
| FO07 | **Wave A** | A 主；E 关闭 compatibility 报告 |
| FO08 | **Wave A** | A 主；D 消费 opening movements |
| FO09 | **Wave A** | A 主；B 写入 allocation；C 写入 invoice recognition |
| FO10 | **Wave A** | A 主；B 写入 allocation；C 写入 invoice recognition |
| FO11 | **Wave A** | A 主；C 触发 conversion |
| FO12 | **Wave A** | A 主；C 触发 conversion |
| FO13 | **Wave A** | A 主；C 调用 conversion；E 验证 acceptance |
| FO14 | **Wave A** | A 主（手动 AR / AP 在 truth foundation 建立后即可工作；C 仅消费） |
| FO15 | **Wave B** | B 主；E 仅依赖 transfer 路径 |
| FO16 | **Wave B** | B 主 |
| FO17 | **Wave B** | B 主 |
| FO18 | **Wave B** | B 主 |
| FO19 | **Wave B** | B 主 |
| FO20 | **Wave B** | B 主 |
| FO21 | **Wave B** | B 主；E 复用 records & trace |
| FO22 | **Wave B** | B 主 |
| FO23 | **Wave B** | B 主 |
| FO24 | **Wave B** | B 主 |
| FO25 | **Wave B** | B 主 |
| FO26 | **Wave B** | B 主（依赖 D 写 treasury movement） |
| FO27 | **Wave B** | B 主 |
| FO28 | **Wave B** | B 主 |
| FO29 | **Wave C** | C 主；B 不消费；E 仅报表 |
| FO30 | **Wave C** | C 主；B 不消费；E 仅报表 |
| FO31 | **Wave C** | C 主 |
| FO32 | **Wave C** | C 主 |
| FO33 | **Wave C** | C 主；B 不消费；E 验证 credit_state |
| FO34 | **Wave C** | C 主 |
| FO35 | **Wave C** | C 主 |
| FO36 | **Wave E** | E 主（invoice operational reports 是 reporting concern） |
| FO37 | **Wave D** | D 主；A 仅占位 schema |
| FO38 | **Wave D** | D 主 |
| FO39 | **Wave D** | D 主；B 调用以写 cash allocation；E 验证 |
| FO40 | **Wave D** | D 主 |
| FO41 | **Wave D** | D 主 |
| FO42 | **Wave D** | D 主 |
| FO43 | **Wave D** | D 主 |
| FO44 | **Wave D** | D 主 |
| FO45 | **Wave D** | D 主 |
| FO46 | **Wave D** | D 主 |
| FO47 | **Wave D** | D 主 |
| FO48 | **Wave D** | D 主 |
| FO49 | **Wave D** | D 主 |
| FO50 | **Wave E** | E 主（GL reconcile 是 reporting concern） |
| FO51 | **Wave A** | A 主；B/C/D 调用 guard |
| FO52 | **Wave A** | A 主；B/C/D 调用 guard |
| FO53 | **Wave A** | A 主；B/C/D 调用 guard |
| FO54 | **Wave E** | E 主 |
| FO55 | **Wave E** | E 主 |
| FO56 | **Wave E** | E 主 |
| FO57 | **Wave E** | E 主（source adapter finalize） |
| FO58 | **Wave E** | E 主（accounting adapter finalize） |

每 Wave 主 ownership 计数：

```text
Wave A: FO01, FO02, FO03, FO04, FO06, FO07, FO08, FO09, FO10, FO11, FO12, FO13, FO14, FO51, FO52, FO53  = 16
Wave B: FO05, FO15, FO16, FO17, FO18, FO19, FO20, FO21, FO22, FO23, FO24, FO25, FO26, FO27, FO28          = 15
Wave C: FO29, FO30, FO31, FO32, FO33, FO34, FO35                                                          = 7
Wave D: FO37, FO38, FO39, FO40, FO41, FO42, FO43, FO44, FO45, FO46, FO47, FO48, FO49                       = 13
Wave E: FO36, FO50, FO54, FO55, FO56, FO57, FO58                                                           = 7
```

合计 `16 + 15 + 7 + 13 + 7 = 58` ✓。每个 FO 恰好一个 primary Wave；其余 Wave 仅以 dependency / integration / acceptance reuse 引用。

### 28.23.1 Wave A — Finance Truth Foundation

```text
FO01 / FO02  recognition policy
FO03 / FO04  terms + due schedule
FO06 / FO07 / FO08  initialization
FO09 / FO10  final open items
FO11 / FO12 / FO13  provisional + conversion
FO14        manual AR / AP
FO51 / FO52 / FO53  business-close foundation (stable anchor seeded)
O. migration / reconciliation
P. transaction / locking (sqlite / mysql parity)
Q. RACE-15 (close vs dated; locks finance_business_close_state)
```

Exit gates：

```text
5+ focused tests
pnpm test:fast PASS
sqlite BEGIN IMMEDIATE + mysql FOR UPDATE 已贯通
finance_business_close_state 已 seed 3 行
```

### 28.23.2 Wave B — Settlement Convergence

```text
FO05        settlement / reconciliation scheme
FO15        AR/AP counterparty transfer
FO16 / FO17  collection / payment
FO18        allocation
FO19 / FO20 / FO21  reconciliation
FO22        reversal
FO23 / FO24 / FO25 / FO26  unapplied + refund
FO27 / FO28  write-off + bad debt
Q. RACE-01..09
```

Exit gates：

```text
5+ focused tests
pnpm test:fast + test:heavy PASS
mysql RACE-01..09 (real MySQL)
```

### 28.23.3 Wave C — Invoice / Recognition Convergence

```text
FO29 / FO30  sales / purchase invoice
FO31 / FO32  cardinality + recon
FO33 / FO34  credit / void
FO35        verification
Q. RACE-10 / RACE-11 / RACE-12
```

Exit gates：

```text
5+ focused tests
duplicate-exposure detection PASS
no orphan AR/AP after credit / void / VOIDED
mysql RACE-10/11/12
```

### 28.23.4 Wave D — Treasury Convergence

```text
FO37 / FO38  settlement accounts (bank_accounts additive extend)
FO39        canonical treasury movement
FO40 / FO41  cash / bank transfer
FO42 / FO43  notes
FO44        payment request
FO45        cash count
FO46 / FO47  bank statement + import
FO48 / FO49  reconciliation + unmatched
Q. RACE-13 / RACE-14
```

Exit gates：

```text
5+ focused tests
cash_journals → applyTreasuryMovement migrate PASS
bank_accounts additive extend (CASH / BANK / accounting_role / opening_balance_cents) PASS
mysql RACE-13/14
```

### 28.23.5 Wave E — Reporting / Compatibility / Final Convergence

```text
FO36        invoice operational reports
FO50        Treasury ↔ GL reconcile
FO54 / FO55 / FO56  reports
FO57 / FO58  source / accounting adapter finalize
N. mobile IA (≤ 6 launchers)
legacy route convergence (cash-journals / bills / fixed-assets → 410 后置)
M. permission finalize (FINANCE_*)
32 UAT harness + 15 RACE harness finalize
D. responsive 320/390/430/680
```

Exit gates：

```text
pnpm test / test:heavy / test:mysql / test:mysql:concurrency (15 finance races) / test:mysql:performance
pnpm build
git diff --check
32/32 UAT PASS
6/6 launchers × 4 widths responsive
```

## 28.24 Compatibility / Normalization vs Older Sections

### 28.24.1 `solution.md §9.4 Finance` Normalization

`solution.md §9.4` 早期 finance flow 描述保留作为 historical context；本 Domain Closure 的 canonical 入口与所有权映射以 §28.1.1 为准。`Sales Invoice / Supplier Bill → AR/AP Open Item → Collection/Payment/Credit → Allocation → Refund/Write-off/Reversal` 仍是有用主线，但必须经 `recognizeFinanceExposure`（§28.2.3）与 `applyTreasuryMovement`（§28.11.4）。

### 28.24.2 `solution.md §13` Normalization

- `§13.1 AR/AP` → 已被 §28.3 / §28.6 取代；
- `§13.2 Invoice/Bill` → 已被 §28.10 取代；
- `§13.3 Inventory Cost` → 归属 Accounting & Analytics（B3106），本 Domain 不承接；
- `§13.4 Fixed Assets` → 归属 Accounting & Analytics（B3107），本 Domain 不承接；
- `§13.5 Smart Accounting` → 归属 Accounting & Analytics（B3114），本 Domain 不承接。

`solution.md §13.1 / §13.2` 仍保留文字，但不再作为 Finance Operations canonical 实现入口；本节为唯一权威。

### 28.24.3 Frozen Domain Boundaries

本节不重写：

```text
Master & Engineering §28  (Engineering / BOM)
Manufacturing & Quality §24  (Production / Quality)
Planning §25                 (MRP / Reservation)
Procurement & Outsourcing §26 (Sourcing / VMI / Outsourcing)
Inventory & Warehouse §27    (Canonical position_key / applyInventoryMutation)
```

Finance Operations 仅 consume 这些 frozen domains 的 source facts 与 inventory adapter，不重写。

## 28.25 Testing Strategy

### 28.25.1 Suite Membership

新增 finance focused suite 入 `scripts/testing/test-suites.js`：

```text
finance-recognition-policy.test.js   (Wave A)
finance-due-schedule.test.js          (Wave A)
finance-open-item.test.js             (Wave A)
finance-provisional-conversion.test.js (Wave A)
finance-business-close.test.js        (Wave A)
finance-settlement.test.js            (Wave B)
finance-reversal.test.js              (Wave B)
finance-unapplied-balance.test.js     (Wave B)
finance-refund.test.js                (Wave B)
finance-write-off.test.js             (Wave B)
finance-bad-debt.test.js              (Wave B)
finance-counterparty-transfer.test.js (Wave B)
finance-sales-invoice.test.js         (Wave C)
finance-purchase-invoice.test.js      (Wave C)
finance-invoice-cardinality.test.js   (Wave C)
finance-invoice-credit-void.test.js   (Wave C)
finance-verification.test.js          (Wave C)
finance-settlement-account.test.js    (Wave D)
finance-treasury-movement.test.js     (Wave D)
finance-cash-deposit-withdrawal.test.js (Wave D)
finance-bank-transfer.test.js         (Wave D)
finance-notes.test.js                 (Wave D)
finance-payment-request.test.js       (Wave D)
finance-cash-count.test.js            (Wave D)
finance-bank-statement.test.js        (Wave D)
finance-bank-import.test.js           (Wave D)
finance-bank-reconciliation.test.js   (Wave D)
finance-unmatched-items.test.js       (Wave D)
finance-reports.test.js               (Wave E)
finance-gl-reconcile.test.js          (Wave E)
finance-source-adapter.test.js        (Wave E)
finance-accounting-adapter.test.js    (Wave E)
finance-route-architecture.test.js    (Wave E)
finance-domain-race.test.js           (15 races, all waves)
```

### 28.25.2 Gates

```text
pnpm test:fast
pnpm test
pnpm test:heavy
pnpm test:mysql
pnpm test:mysql:concurrency
pnpm test:mysql:finance-concurrency  (NEW; RACE-01..15)
pnpm test:mysql:performance
pnpm build
git diff --check
```

## 28.26 Audit / Transaction / Error

每个 mutation：

```text
1. 后端 allow(actor, 'FINANCE_*')
2. assertFinanceBusinessDateOpen (按 close type)
3. transaction { ... }
4. 重读权威状态 (open item remaining / balance remaining / account active)
5. idempotency check (UNIQUE on source table)
6. 写 canonical source tables (e.g. payment_*_items / balance_applications / financial_credit_adjustments / financial_write_offs / finance_treasury_movements)
7. refresh canonical balance / status — refreshOpenAmount reads finance_open_item_effects VIEW
8. emitAccountingEvent (FO58)
9. audit (CREATE / UPDATE / REVERSE / CLOSE / REOPEN)
10. fail closed on any mismatch
```

不得 silent-fallback。`systemHealth` 默认 CHECK-only（参考 §14.2）；新增 health probes：

```text
duplicate AR/AP exposure
open cache mismatch
treasury balance mismatch
orphan allocation
bank match over-allocation
business-close violation
```

## 28.27 Rollback Strategy

每个 finance migration：

```text
1. additive column / CREATE TABLE IF NOT EXISTS
2. 启用 finance_recognition_policy 双读模式（canonical + legacy projection）
3. 切换前 reconciliation health check
4. 切换 canonical writer
5. 监控 reconciliation 失败 → 切回 legacy
6. 旧 legacy 路径 410 后置
```

`cash_journals` 旧 write 路径保留 30 天兼容性，30 天后逐步 410。

## 28.28 Final Acceptance

- focused tests（每 Wave ≥ 5）；
- `pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 受保护 disposable MySQL 8 环境：`pnpm test:mysql` + `pnpm test:mysql:concurrency` + `pnpm test:mysql:finance-concurrency` 全 PASS（15 finance races）；
- 32 / 32 UAT PASS（不得 defer）；
- 6 launcher × 4 width responsive PASS（320 / 390 / 430 / 680）；
- 既 frozen domains（Master & Engineering / Manufacturing / Planning / Procurement / Inventory）gates 保持 green；
- 既 5 角色（admin / sales / warehouse / reviewer / accounting）不被破坏；
- release tag 不动；package.json version 不变。

Final verdict（本 Design）：`READY FOR USER REVIEW`。

后续 Implementation 严禁：

```text
1. 新增 capability ID / UAT / RACE / Wave
2. 引入第二 AR/AP ledger / Treasury movement engine / Voucher engine
3. UPDATE 历史已确认 finance facts
4. DROP historical finance table
5. 移动 B3106 / B3107 路由至 Finance Operations
6. 绕过 recognizeFinanceExposure 或 applyTreasuryMovement
```

## 28.29 Cross-References

| Topic | Section |
|---|---|
| Architecture / Ownership | §28.1 |
| Recognition Models | §28.2 |
| Open-Item / Provisional | §28.3 / §28.5 |
| Due Schedule | §28.4 |
| Settlement / Allocation | §28.6 |
| Unapplied / Refund | §28.7 |
| Write-Off / Bad Debt | §28.8 |
| Counterparty Transfer | §28.9 |
| Invoice | §28.10 |
| Treasury | §28.11 |
| Bank Statement / Recon | §28.12 |
| Business Close | §28.13 |
| Integration Adapters | §28.14 |
| Permission | §28.15 |
| API / Route | §28.16 |
| Mobile IA | §28.17 |
| Migration | §28.18 |
| Transaction / Lock | §28.19 |
| MySQL Races (15) | §28.20 |
| UAT Trace (32) | §28.21 |
| Capability Trace (58) | §28.22 |
| Implementation Waves (5) | §28.23 |
| Older Section Normalization | §28.24 |
| Tests | §28.25 |
| Audit / Error | §28.26 |
| Rollback | §28.27 |
| Final Acceptance | §28.28 |

---
