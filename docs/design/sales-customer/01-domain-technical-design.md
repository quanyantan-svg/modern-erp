# Sales & Customer — Domain Technical Design

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/design/sales-customer/README.md`
> 来源：`solution.md` §29（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## 29. Sales & Customer Domain Technical Design

> 本节原冻结 Sales & Customer Domain Closure 的 Technical Design 阶段成果；2026-10-13 远端外部评审进一步发现订单变更、预留、直出、sellable scope、物理计数与 Sales-group isolation 缺口，故 Requirement 与 Design 被再次有限重开。本次修正 §29 / §30 的有界物理模型、执行合同、验收追溯与计数；DR-SAL-01 Option A 已获用户批准并完成设计闭环。2026-10-14 外部独立评审对 Requirement / Technical Design / Implementation Wave Plan 均返回 PASS，用户已明确批准正式 Freeze；冻结内容基线为 `5469891b78acb5b03940944698e5c51a38cf5491`。

```text
AUDIT                         PASS / FROZEN
REQUIREMENT                   PASS / FROZEN
TECHNICAL DESIGN              PASS / FROZEN
IMPLEMENTATION WAVE PLAN      PASS / FROZEN
WAVE 0                        PASS / FROZEN
WAVES 1–13                    NOT IMPLEMENTED / NOT ACCEPTED
```
> Manual Evidence Baseline：B3102 销售管理 + B3103 信用管理（同时遵守已 frozen 的 Master & Engineering / Planning / Procurement & Outsourcing / Manufacturing & Quality / Inventory & Warehouse / Finance Operations 等其它 domain 的边界）。
> 本节 Coverage 以 Sales & Customer Domain Requirement（`document.md §34`，commit `414f2bb603fb1e9966d61811787b81f79103ecba`）为准：
>
> ```text
>   Sales Capabilities           = 114   (SC01..SC114)
>   DOMAIN_OWNED                = 100
>   INTEGRATION_BACKED          =   3   (SC51, SC58, SC71)
>   EXISTING_REUSE              =  11   (SC24, SC25, SC33, SC34, SC35, SC36,
>                                       SC49, SC52, SC53, SC54, SC79)
>   OUT_OF_SCOPE                =   0
>
>   Business Invariants         = 20    (S01..S20)
>   Functional UAT              = 44    (UAT-S-01..UAT-S-44)
>   MySQL Races                 = 24    (R-SAL-01..R-SAL-24)
>   Cross-Domain Boundary Fam   = 15
>
>   Audit CAP Trace             = 36/36 (CAP-1..CAP-36)
>   SC Acceptance Coverage      = 114/114
> ```
>
> 本节不进入 Implementation / Migration / Code / Schema / Test 任一阶段。Design 阶段成果再经外部 Review 后方进入 Implementation。
> 本节不重写已 frozen 的 Master & Engineering / Planning / Procurement & Outsourcing / Manufacturing & Quality / Inventory & Warehouse / Finance Operations 中的任何 capability 或 canonical fact。Sales & Customer 通过消费这些 frozen canonical truth 完成自身业务，不允许 second-truth / shadow ledger。

### 29.1 范围与 Architecture

#### 29.1.1 Sales & Customer 拥有

Sales & Customer 是以下能力的唯一 canonical business owner：

- **商业 Sales Truth**：Customer Commercial Extensions / Quotation / Sales Order / Sales Order Change / Delivery Notice / Sales Delivery / Sales Return / Replacement & Replenishment / Service Item Sales / Consignment 商业 lifecycle / Prepayment Gate 商业规则 / Sales Pricing / Order-Time Discount / Sales Reporting projections / Sales Reservation Intent。
- **Credit 商业语义全部 9 capability**：Credit Parameters / Rules / Profile / Occupancy / Check / Special Approval / Recalculation / Query / Evaluation。

#### 29.1.2 Sales & Customer 不拥有

- Customer 身份 foundation（Master & Engineering）
- Product / Material identity 与 UoM foundation（Master & Engineering）
- Warehouse identity / layout（Master & Engineering）
- Physical inventory truth / on-hand / locks / LOT-SERIAL / location / ownership dimension（Inventory & Warehouse）
- Reservation canonical truth / MRP / demand planning（Planning）
- OQC / Quality 引擎（Manufacturing & Quality）
- AR / AP open-item truth（Finance Operations）
- Advance Receipt / Unapplied Balance / Refund / Write-off / Collection / Invoice operational truth / Treasury（Finance Operations）
- Voucher / GL / Period close / Financial reports（Accounting & Analytics）
- RBAC / Workflow mechanics / Audit notification / Numbering / generic mechanics / document relation-conversion（Platform）；Sales parameter namespace、bounded codes、validation、storage 与 business semantics 不因使用 Platform mechanics 而转移 ownership

#### 29.1.3 Architecture 原则

```text
商业-物理-truth 分离  : Sales commercial truth ≠ Inventory/Finance/Reservation
                                      canonical truth
派生真理原则        : 优先 derived / projected truth；不建立 second mutable ledger
frozen-domain 适配器: 物理 mutation 永远走 frozen Domain canonical writer
Audit 强制          : 关键 mutation 与 audit 共享 transaction boundary
Effective snapshot  : Credit Check 使用一个 coherent effective policy snapshot
                                              (R-SAL-24 business-snapshot invariant)
Backend fail-closed : mandatory BLOCK 必 backend fail closed；前端 hidden !== 控制
Source-identity 保持 : Quotation → SO → Delivery Notice → Sales Delivery → Return
                                      → Finance AR adapter 链路全程保留
```

### 29.2 Physical Model Inventory（machine-checkable）

#### 29.2.0 Wave 1 Design Reopen contradiction evidence

| Evidence | Original frozen reference | Contradiction confirmed |
|---|---|---|
| A | 原 §29.4.2 | `users.salesperson_code` assigned to Wave 1 |
| B | 原 §29.4.2 | `users.sales_group_code` assigned to Wave 1 |
| C | 原 §29.4.2 | a separate `sales_group` physical table was required but absent from the physical inventory |
| D | 原 §30.2 / §30.8 / §30.17 | Wave 1 declared only 3 NEW tables |
| E | 原 Wave 1 implementation authorization | Wave 1 required 0 existing-table extension fields, while §30 assigned two `users` fields |
| F | 原 §29.4.1 | `customer_commercial_extensions.default_pricing_list_id` referenced `sales_price_lists` |
| G | 原 §30.2 / §30.8 | `sales_price_lists` is created only in Wave 2 |
| H | 原 §29.4.1 | `commercial_defaults_snapshot_id` had no canonical physical target anywhere in §29 inventory |

Correction decisions below supersede these contradictory physical allocations and the later remote-review defects recorded in `document.md §34` (SC01 / SC08 / SC30 semantics and acceptance). SC / Invariant / UAT / Race counts remain unchanged.

#### 29.2.0.1 Wave 6 bounded Design reopen — missing Sales Return source-line identity

The original Design used the not-yet-implemented term `ORDER_BACKED`, while the frozen Requirement §34.3.10 and UAT-S-20 use `SO_BACKED`. This bounded correction standardizes the target Design, API and database enum on `SO_BACKED`; it does not add a fourth mode or change the approved business meaning.

The original physical inventory also omitted the line-level carrier required by §29.30. Add one nullable logical field, `return_order_items.sales_order_item_id`, with a real FK to `sales_order_items.id`. It persists the authoritative source line for `SO_BACKED` returns, without creating a Sales Delivery, rewriting executed Sales Order history, or introducing Inventory / Finance truth owned by Sales. Existing rows remain NULL and are never inferred or backfilled from product, customer or date.

```text
Classification dimensions:
  TABLES:
    EXISTING_CONVERGE          → 已存在并将由本 Domain 继续使用，不修改语义
    NEW                        → 本 Design 新增的物理表（additive migration only）
    DEPRECATED_NO_NEW_WRITES   → 保留读取能力；禁止新写入；迁移期间兼容

  COLUMN EXTENSIONS (separate inventory, see B):
    additive migration; not table count

  DERIVED VIEWS (separate inventory, see C):
    query-layer projection only; no physical table

  COMPATIBILITY BEHAVIORS (separate inventory, see D):
    legacy read path; no new writes; not a table

  DEPRECATED FIELDS (separate inventory, see E):
    single physical classification; distinct from COMPATIBILITY
```

#### A. Physical Tables

A physical TABLE = a single SQL relation; columns are NOT counted as tables.

| # | Table | Classification | Migration Source / Origin | Owner Domain |
|---|---|---|---|---|
| A-01 | `customers` | EXISTING_CONVERGE | db.js:934 | Master & Engineering |
| A-02 | `sales_orders` | EXISTING_CONVERGE | db.js:972 (additive cols in §29.8.2) | Sales & Customer |
| A-03 | `sales_order_items` | EXISTING_CONVERGE | db.js:991 (additive cols in §29.8.2) | Sales & Customer |
| A-04 | `sales_deliveries` | EXISTING_CONVERGE | db.js:1175 | Sales & Customer |
| A-05 | `sales_delivery_items` | EXISTING_CONVERGE | db.js:1198 | Sales & Customer |
| A-06 | `return_orders` | EXISTING_CONVERGE | db.js:1208 (additive col: commercial_source_marker) | Sales & Customer / Procurement & Outsourcing (shared) |
| A-07 | `return_order_items` | EXISTING_CONVERGE | db.js:1232 (additive col: sales_order_item_id) | Sales & Customer / Procurement & Outsourcing (shared) |
| A-08 | `sales_discounts` | EXISTING_CONVERGE | discounts-schema.js:28 | Sales & Customer (route-table owned) — M14 post-delivery finance adjustment |
| A-09 | `sales_invoices` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:70 | Finance Operations |
| A-10 | `sales_invoice_items` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:78 | Finance Operations |
| A-11 | `commercial_credit_notes` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:111 | Finance Operations |
| A-12 | `document_sequences` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:63 | Platform (numbering) |
| A-13 | `document_number_allocations` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:67 | Platform (numbering) |
| A-14 | `tax_codes` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:57 | Finance Operations |
| A-15 | `uoms` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:46 | Master & Engineering |
| A-16 | `product_uom_conversions` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:50 | Master & Engineering |
| A-17 | `planning_reservations` | EXISTING_CONVERGE (frozen) | planning-domain-schema.js | Planning |
| A-18 | `inventory` | EXISTING_CONVERGE (frozen) | db.js + inventory-position-schema.js | Inventory & Warehouse |
| A-19 | `account_receivables` | EXISTING_CONVERGE (frozen) | v22 migrations | Finance Operations |
| A-20 | `account_role_mappings` | EXISTING_CONVERGE (frozen) | v13-phase6d-financial-inventory.js | Finance Operations |
| A-21 | `idempotency_records` | EXISTING_CONVERGE | v13-phase6a-financial-controls.js:144 | **Platform / shared** infrastructure; Sales uses it for Sales command identities (semantic namespaces: quotation conversion / DN confirm / service fulfillment / etc.) — Sales owns the namespace meaning, not the storage infrastructure |
| A-22 | `audit_logs` | EXISTING_CONVERGE (frozen) | db.js | Platform |
| A-23 | `lifecycle_archives` | EXISTING_CONVERGE | lifecycle-schema.js | Platform |
| A-24 | `approval_requests` | EXISTING_CONVERGE (frozen for SALES_ORDER family) | db.js:1030 | Platform |
| A-25 | `sales_quotations` | NEW | §29.5 | Sales & Customer |
| A-26 | `sales_quotation_lines` | NEW | §29.5 | Sales & Customer |
| A-27 | `sales_quotation_conversions` | NEW | §29.5.3 | Sales & Customer — explicit conversion evidence |
| A-28 | `sales_price_lists` | NEW | §29.6 | Sales & Customer |
| A-29 | `sales_price_list_entries` | NEW | §29.6 | Sales & Customer |
| A-30 | `sales_price_list_versions` | NEW | §29.6 | Sales & Customer |
| A-31 | `sales_discount_schemes` | NEW | §29.7 | Sales & Customer |
| A-32 | `sales_discount_scheme_rules` | NEW | §29.7 | Sales & Customer |
| A-33 | `sales_order_changes` | NEW | §29.9 | Sales & Customer |
| A-34 | `sales_order_change_lines` | NEW | §29.9 | Sales & Customer |
| A-35 | `delivery_notices` | NEW | §29.11 | Sales & Customer |
| A-36 | `delivery_notice_lines` | NEW | §29.11 | Sales & Customer |
| A-37 | `sales_order_replacements` | NEW (header) | §29.14 | Sales & Customer |
| A-38 | `sales_order_replacement_lines` | NEW (line) | §29.14 | Sales & Customer |
| A-39 | `customer_commercial_extensions` | NEW | §29.4 | Sales & Customer (extends Master customer identity) |
| A-40 | `customer_material_xref` | NEW | §29.4 | Sales & Customer |
| A-41 | `sales_prepayment_requirements` | NEW | §29.16 | Sales & Customer |
| A-42 | `sales_prepayment_gate_results` | NEW | §29.16 | Sales & Customer |
| A-43 | `sales_reservation_intent` | NEW | §29.17 | Sales & Customer (intent state only; canonical reserved qty in `planning_reservations`) |
| A-44 | `service_fulfillments` | NEW | §29.18 | Sales & Customer |
| A-45 | `consignment_commercial_documents` | NEW | §29.19 | Sales & Customer (commercial layer; physical layer is Inventory) |
| A-46 | `consignment_commercial_lines` | NEW | §29.19 | Sales & Customer (commercial layer) |
| A-47 | `consignment_commodity_locations` | NEW (commercial) | §29.19 | Sales & Customer (commercial consignment location identity, ≠ physical warehouse) |
| A-48 | `credit_parameters` | NEW | §29.21 | Sales & Customer |
| A-49 | `credit_check_rules` | NEW | §29.21 | Sales & Customer |
| A-50 | `credit_policy_snapshots` | NEW (R-SAL-24 lockable anchor row) | §29.21 | Sales & Customer |
| A-51 | `credit_profile` | NEW | §29.22 | Sales & Customer (extends customer identity) |
| A-52 | `credit_profile_ratings` | NEW | §29.22 | Sales & Customer |
| A-53 | `credit_special_approval` | NEW | §29.26 | Sales & Customer |
| A-54 | `credit_check_results` | NEW | §29.25 | Sales & Customer (decision artifact, not exposure ledger) |
| A-55 | `credit_evaluation_indicator` | NEW | §29.27 | Sales & Customer |
| A-56 | `credit_evaluation_scheme` | NEW | §29.27 | Sales & Customer |
| A-57 | `credit_evaluation_model` | NEW | §29.27 | Sales & Customer |
| A-58 | `credit_evaluation_scoring_sheet` | NEW | §29.27 | Sales & Customer |
| A-59 | `credit_evaluation_result` | NEW | §29.27 | Sales & Customer |
| A-60 | `credit_recalculation_history` | NEW | §29.28 | Sales & Customer |
| A-61 | `product_commercial_classification` | NEW (Sales-owned extension table) | §29.18 — Service Item boundary | Sales & Customer (extends Master product identity at commercial level) |
| A-62 | `credit_lock_anchors` (REFINED; replaces original A-62 design) | NEW (stable long-lived lock identity; one generic table; anchor_type ∈ {CREDIT_OBJECT, POLICY_SCOPE}) | §29.20 / §29.21 / §29.25.2-3 — stable Credit-control anchor (CREDIT_OBJECT + POLICY_SCOPE) | Sales & Customer |
| A-63 | `sales_groups` | NEW | §29.4.2 — canonical Sales group identity | Sales & Customer |
| A-64 | `salesperson_profiles` | NEW | §29.4.2 — canonical Sales salesperson identity; optional login link | Sales & Customer |
| A-65 | `sales_parameters` | NEW | §29.4.5 — bounded SYSTEM / DOCUMENT_TYPE Sales configuration | Sales & Customer |
| A-66 | `salesperson_group_memberships` | NEW | §29.4.2 — multi-group membership + one default group | Sales & Customer |
| A-67 | `account_payables` | EXISTING_CONVERGE (frozen) | v22 migrations | Finance Operations |
| A-68 | `sales_replacement_fulfillments` | NEW | §29.14.1 — confirmed replacement-delivery line evidence | Sales & Customer |
| A-69 | `sales_sellable_scope_rules` | NEW | §29.4.3 — customer/material, salesperson/material, salesperson/customer allow/deny | Sales & Customer |
| A-70 | `sales_return_valuation_provenance` | NEW (bounded superseding correction) | §30.31.2 — immutable Return valuation allocation → eligible original outbound evidence; not a general layer ledger | Sales & Customer evidence consuming Inventory canonical facts |

Counts:

```text
Physical tables total                                  = 70
  EXISTING_CONVERGE  (incl. frozen)                   = 25  (A-01..A-24 + A-67)
  NEW (physical tables in §29 Domain closure/design)  = 45  (A-25..A-66 + A-68..A-70)
  DEPRECATED_NO_NEW_WRITES (tables)                   =  0
```

#### B. Existing-Table Extensions (column additions; do NOT count as tables)

| Existing Table | New logical field(s) | Business purpose | Owner | Compatibility rule |
|---|---|---|---|---|
| A-02 `sales_orders` | `salesperson_id`, `sales_group_id`, `settlement_party_id`, `payer_id`, `customer_material_xref_id`, `commercial_tax_code`, `tax_inclusive`, `required_prepayment_cents`, `reservation_intent_state`, `commercial_close_state`, `gift_summary_cents`, `commercial_pricing_uom_code`, `effective_version` | SO commercial extension, lifecycle / closure and monotonic controlled-change concurrency anchor (§29.8 / §29.9 / §29.10) | Sales & Customer | nullable commercial fields on legacy rows display `(legacy)` without fabrication; `effective_version` is `INTEGER NOT NULL DEFAULT 1`, and migration backfills legacy rows to compatibility baseline `1` without inventing prior versions |
| A-03 `sales_order_items` | `is_gift_line`, `commercial_tax_basis`, `tax_inclusive_assumption`, `pricing_uom_code_applied`, `qty_break_applied_min`, `qty_break_applied_max`, `planned_delivery_date`, `upper_delivery_tolerance_bps`, `lower_delivery_tolerance_bps`, `price_snapshot_json`, `discount_snapshot_json` | Line-level commercial snapshot; authoritative price/version/UoM and discount-stage evidence; gift line marker; bounded one-schedule-per-line delivery plan/tolerance snapshot | Sales & Customer | both JSON columns remain nullable for legacy rows and display `(legacy)`; every Batch A canonical new line requires valid non-empty server-generated evidence; legacy tolerance does not get reinterpreted from later defaults |
| A-04 `sales_deliveries` | `delivery_notice_id`, `source_mode`, `billing_mode` (existing) | truthful DIRECT_ORDER / DELIVERY_NOTICE source discriminator; preserved billing mode | Sales & Customer | legacy rows: `source_mode=LEGACY_UNCLASSIFIED`; no fabricated DN |
| A-05 `sales_delivery_items` | `delivery_notice_line_id` | DN line capacity anchor (§29.11 / §29.17) | Sales & Customer | legacy rows: NULL `delivery_notice_line_id` allowed (legacy path) |
| A-06 `return_orders` | `commercial_source_marker` (CHECK: DELIVERY_BACKED / SO_BACKED / NO_SOURCE) | Three-mode explicit | Sales & Customer | legacy NULL remains readable/displayable as unclassified legacy; Confirm/Reverse or other economic mutation returns 409 and never infers DELIVERY_BACKED |
| A-07 `return_order_items` | `sales_order_item_id` (nullable FK to `sales_order_items.id`) | Real SO source-line identity for SO_BACKED trace, capacity and locking | Sales & Customer | legacy rows remain NULL; no inferred or fabricated backfill |
| A-39 `customer_commercial_extensions` | `default_pricing_list_id`, `default_discount_scheme_id` | Wave 2 adds FKs only after A-28 `sales_price_lists` and A-31 `sales_discount_schemes` exist; B3102 customer default semantics retained without dangling Wave 1 pseudo-FKs | Sales & Customer | Wave 1 rows remain valid with fields absent; Wave 2 adds nullable FKs without fabricating defaults |
| A-19 `account_receivables` | (none this closure) | AR canonical owner = Finance; Sales reads only | Finance Operations | n/a |

Counts:

```text
Existing-table extensions                                  = 7  (six pre-existing tables + A-39 extended in Wave 2)
New logical fields across extensions                       = 32
(no new physical tables created from this sub-class)
```

#### C. Derived Views / Projections

| # | Derived object | Canonical source facts | Persisted? | Rebuild semantics |
|---|---|---|---|---|
| C-01 | `credit_exposure_view` | approved SO commitment + delivered-not-settled + Finance AR open + overdue state + eligible advance / unapplied + returns / credits + collections + write-offs (per §29.23) | NO (DERIVED projection; §29.24 default) | PURE_DERIVED; not stored; computed on read |
| C-02 | `credit_query_snapshot` | credit_profile + effective credit_policy_snapshots + finance adapter response | NO | query at access time |
| C-03 | `customer_open_exposure_summary` | C-01 per customer_id | NO | per query |
| C-04 | `sales_outstanding_projection` | sales_orders × sales_deliveries (per Requirement §34.5 UAT-S-37 / UAT-S-38) | NO | existing decision-reports; extended |
| C-05 | `sales_order_fulfillment_projection` | sales_orders.commercial_close_state + derived (deliveries, returns) | CONTROLLED HYBRID (§29.10): commercial_close_state PERSISTED; partial fulfillment DERIVED | at read time |

Counts:

```text
Derived views / projections                                = 4 pure-no + 1 controlled-hybrid = 5 logical objects
  persisted? YES                                           = 0
  persisted? NO                                            = 5
```

C-06 removed: `idempotency_records` is already counted as physical table A-21; reading the same object via two categories is double-count. Sales semantic idempotency namespaces (quotation conversion, delivery notice confirm, service fulfillment confirm, etc.) are explained in §29.45 (Idempotency Design) — they USE A-21 as the shared storage; they do not create a new derived object.

#### D. Compatibility Behaviors (separate dimension; not a table)

| # | Legacy path | New write allowed? | New read allowed? | Notes |
|---|---|---|---|---|
| D-01 | Legacy Sales Delivery without source discriminator (`source_mode = LEGACY_UNCLASSIFIED`) | NO for new writes; legacy rows retained | YES (read) | new writes explicitly choose DIRECT_ORDER or DELIVERY_NOTICE; no historical reinterpretation |
| D-02 | Legacy Sales Order without commercial parties / tax-basis / prepayment / reservation_intent columns | NO for new normal flow | YES (display `(legacy)`) | legacy rows remain valid; no fabrication |
| D-03 | Legacy Sales Return without `commercial_source_marker` and without `sales_order_item_id` | NO (new writes must set an explicit marker and valid mode/source pair) | YES for display/read only; every economic mutation returns 409 for NULL/unknown marker | no source inference, DELIVERY_BACKED fall-through or fabricated backfill |
| D-04 | Legacy Customer without commercial extensions | NO (new entries must record extension) | YES (display `(none)`) | backward compatible |
| D-05 | Legacy Credit Profile missing | policy-dependent; §29.27 + §29.12 fail-closed rule | YES (display `(none)`) | missing required profile must trigger config BLOCK, NOT silent PASS |
| D-06 | Legacy Product without A-61 commercial classification | NO for any new commercial write | YES (display `(unclassified legacy)`) | missing/inactive row never implies `sales_enabled=TRUE` or non-service |
Counts:

```text
Compatibility behaviors                                    = 6
  new write through legacy bypass                          = 0 (ALL legacy paths disabled for new writes)
  legacy correction (bounded)                              = pending case-by-case policy
  legacy read                                              = 6 (all legacy reads allowed)
```

#### E. Deprecated Fields / No-New-Write Surfaces (single physical classification)

| # | Deprecated field / object | Physical classification | Compatibility behavior | Notes |
|---|---|---|---|---|
| E-01 | `products.price_cents` | **DEPRECATED_NO_NEW_WRITES** | may be READ as legacy pricing fallback (5th in §29.6.2 resolver priority chain); must NOT be treated as canonical new Sales Pricing truth | single classification; distinct from COMPATIBILITY behavior dimension |

Counts:

```text
Deprecated-no-new-write fields/tables                     = 1
```

#### F. Service Item classification storage

Per §29.18 + Micro-Closure §8: prefer Sales-owned commercial product extension over adding column to frozen Master `products` table.

```text
Chosen: Option A  Sales-owned commercial product extension table
  object: product_commercial_classification (A-61)
  product_id: FK to products.id (Master-owned identity; Sales only reads)
  sales_enabled + Sales/Pricing UoM references + upper/lower tolerance defaults
  service_classification (bool)
  one current row per product; transactional audit history
  no write to products table; no Master-frozen-column alteration
```

If frozen Domain (Master & Engineering) implements an additive `products.is_service` column at a later date, Sales will switch to read that attribute via cross-domain contract; this Domain closure does NOT depend on it.

#### G. Consignment location-vs-ownership inventory clarification

This Domain closure requires the seller retain inventory ownership at consignment shipment. Settlement/title-transfer moves ownership out of the seller position; consignment return retains/restores seller ownership. The current Inventory V21 model carries customer-owned positions for genuinely customer-owned / entrusted stock, which is a DIFFERENT business meaning and must not be conflated with sales consignment.

Per §29.19 corrected design (rebuild in this §29 of the corrected micro-closure) consignment makes seller retention explicit; no fake CUSTOMER-owned position is created for consigned stock.

**Frozen-domain integration contract status: NO CHANGE required for design.** The seller-ownership retention on consignment is expressed entirely in the new consignment commercial documents + inventory transfer with seller ownership marker; existing Inventory V21 canonical `inventory` position already records warehouse_id + owner_type / owner_id, and Sales only requests transfers with `owner_type = ENTERPRISE` (seller) during consignment shipment. The owner attribute in V21 already distinguishes ENTERPRISE from CUSTOMER at the position-key level. No `BOUNDED INTEGRATION CONTRACT EXTENSION` is required for §29.19 given this interpretation; if a future Implementation evidence shows seller-ownership cannot currently be represented on consignment transfer through Inventory V21, then `BOUNDED INTEGRATION CONTRACT EXTENSION` is filed and the model is revised before Implementation. (No silent CUSTOMER-owned redefinition.)

#### 29.2.1 Recalculated counts (Micro-Closure)

```text
A  Physical tables total                     = 70
     EXISTING_CONVERGE                       = 25  (A-01..A-24 + A-67)
     NEW                                     = 45  (A-25..A-66 + A-68..A-70)
     DEPRECATED_NO_NEW_WRITES (tables)      =  0

B  Existing-table extensions                = 7  covered tables across the wave sequence
                                                 (7 extensions, 32 logical fields;
                                                  31 ADD + 1 existing reused field)

C  Derived views / projections               = 5  logical objects
     persisted? YES                         = 0
     persisted? NO                          = 5

D  Compatibility behaviors                  = 6  legacy read = YES; new write through legacy bypass = NO

E  Deprecated fields (no-new-write)         = 1  (products.price_cents; single classification)

Sum check:
  A tables:  25 + 44 + 0 = 69 ✓
  Sub-categories are disjoint (every table belongs to exactly one of A classifications)
  Columns are NEVER counted as tables (see B for column extensions)


### 29.3 Canonical Writer Inventory

下表列出关键 business fact 的 canonical writer / service owner 与 Sales direct-write 权限：

| Business fact | Canonical writer / owner | Sales may write directly? | Adapter | Transaction boundary | Audit owner |
|---|---|---|---|---|---|
| Sales Order (header + lines) | Sales `sales_order_canonical_writer` | YES (own commercial) | n/a | one transaction: SO + items + commercial snapshot | audit_logs |
| Quotation (header + lines) | Sales `quotation_canonical_writer` | YES | n/a | one transaction | audit_logs |
| Pricing snapshot | Sales `pricing_canonical_writer` (resolveSalesPrice + persist) | YES | n/a | one transaction with SO creation | audit_logs |
| Order-Time Discount snapshot | Sales `discount_canonical_writer` | YES | n/a | one transaction with SO creation | audit_logs |
| Delivery Notice | Sales `delivery_notice_canonical_writer` | YES | n/a | one transaction | audit_logs |
| Sales Delivery | Sales `sales_delivery_canonical_writer` (Phase 6E) | YES (commercial) | invokes Inventory V21 `applyInventoryMutation` + OQC + Finance recognition | one transaction: SO inventory + AR recognition + COGS | audit_logs |
| Sales Return (DELIVERY_BACKED) | Sales `sales_return_canonical_writer` | YES | invokes Inventory V21 restoreSourceValue + Finance credit adjustment | one transaction | audit_logs |
| Sales Return (SO_BACKED / NO_SOURCE) | Sales `sales_return_canonical_writer` (new mode; owns commercial state only) | YES (commercial only) | Inventory canonical acceptance/mutation + strict `receivePositiveSourceValue()` Option-A adapter + Accounting canonical voucher writer; optional Finance AR credit is a separate authoritative-basis branch | one protected transaction with explicit source marker, source-capacity locks, valuation-plan locks, physical/valuation/voucher/audit/idempotency effects; missing basis is 409/zero-side-effect | Sales audit + Inventory/Accounting canonical evidence |
| Sales Return Reversal (DELIVERY_BACKED) | Sales `sales_return_canonical_writer.reversal_branch` (existing `reverseOperationalReturn` at `server/modules/financial-controls.js:323-382`) | YES | existing reverse handler unchanged; reuses credit gate + voucher direction swap + inventory OUT + return_reversal evidence; canonical Finance/Inventory primitives | one transaction; idempotency under SALES_RETURN_REVERSAL | audit_logs |
| Sales Return Reversal (SO_BACKED / NO_SOURCE) | Sales `sales_return_canonical_writer.option_c_branch` (new bounded adapter per §29.13.11) | YES (commercial only) | canonical Inventory valuation reverse via `consumeOriginalInboundValue` (gated by strict MOVING_AVERAGE / LOT / SERIAL downstream-consumption proof) + canonical Accounting voucher reverse via `createSystemVoucher(reversalOfId)` + optional canonical Finance Credit reverse via `reverseCreditAdjustment`; never writes Inventory truth or Finance valuation truth directly | one protected transaction with mode resolver, Gate-A Replacement dependency, Gate-B downstream consumption proof, Gate-C valuation reverse, Gate-D voucher reverse, Gate-E optional credit; full-only reversal; idempotency under SALES_RETURN_REVERSAL_OPTION_C | Sales audit + Inventory/Accounting canonical evidence |
| Replacement obligation | Sales `replacement_canonical_writer` | YES | no inventory/finance bypass; fulfillment only through `sales_replacement_fulfillments` | one transaction | audit_logs |
| Reservation Intent | Sales `reservation_intent_writer` | YES (intent only) | Planning reservation canonical reader | one transaction intent-state write | audit_logs |
| Prepayment Gate evaluation | Sales `prepayment_gate_evaluator` (uses Finance canon) | YES (rule only) | reads Finance `settlement_unapplied_balances` / advance receipts | one transaction (gate decision) | audit_logs |
| Consignment commercial doc | Sales `consignment_commercial_writer` | YES (commercial layer only) | requests Inventory ENTERPRISE-owned position at customer/consignment location; writes Finance settlement ref | one transaction per layer | audit_logs |
| Service fulfillment confirmation | Sales `service_fulfillment_writer` | YES | invokes Finance recognition; no inventory OUT | one transaction | audit_logs |
| Credit Parameters / Rules | Sales `credit_policy_writer` (Platform parameter infra) | YES (semantic) | Platform parameter storage | one transaction | audit_logs |
| Credit Profile (rating applied) | Sales `credit_profile_writer` | YES | n/a | one transaction | audit_logs |
| Credit Check decision | Sales `credit_check_evaluator` | YES | reads Finance AR + Planning exposure | one transaction; fail-closed BLOCK | audit_logs + credit_policy_snapshot_ref |
| Credit Special Approval | Sales (semantic) + Platform (workflow infra) | YES (semantic) | Platform workflow infra; bounded authority | one transaction; **preserves check + snapshot identity** | audit_logs |
| Credit Recalculation | Sales (rebuild logic) | YES (pure CHECK-only by default; cache optional per §29.24) | Finance AR canonical | rebuild tx; cannot mutate historical canonical | audit_logs |
| Credit Evaluation Indicators/Scheme/Model/Sheet/Result | Sales `credit_evaluation_writer` | YES | NO external bureau / AI / ML | one transaction per artifact | audit_logs |
| Customer identity | Master & Engineering | NO | n/a (read-only via canonical adapter) | n/a | n/a |
| Material identity + UOM | Master & Engineering | NO | n/a | n/a | n/a |
| Warehouse identity | Master & Engineering | NO | n/a | n/a | n/a |
| Physical inventory truth | Inventory & Warehouse (V21) | NO | `applyInventoryMutation` adapter | one tx on Inventory side | n/a |
| LOT / SERIAL | Inventory & Warehouse | NO | postTrackedMovement adapter | n/a | n/a |
| Inventory Locks | Inventory & Warehouse | NO | n/a | n/a | n/a |
| Reservation canonical quantity | Planning (V19) | NO | `assertStrongReservationAvailability` reader | n/a | n/a |
| OQC | Manufacturing & Quality (V18) | NO | quality gate adapter | one tx | n/a |
| AR open amount | Finance Operations (V22) | NO | `recognizeFinanceExposure` / `applyCreditAdjustment` | one tx | n/a |
| Advance Receipt / Unapplied | Finance Operations | NO | read | n/a | n/a |
| Collection / Refund / Write-off | Finance Operations | NO | write via canonical adapter | one tx | n/a |
| Invoice operational finance truth | Finance Operations | NO | postSalesInvoice / postSupplierBill | one tx | n/a |
| Treasury | Finance Operations | NO | applyTreasuryMovement | one tx | n/a |
| Voucher / GL | Accounting & Analytics | NO | n/a | n/a | n/a |
| RBAC / Audit notification / Numbering | Platform | NO | Platform parameters / generic services | per Platform | Platform |

> Audit 必须 与 mutation 共享 transaction boundary；不允许 mutation 提交后 audit 才写。

### 29.4 Sales Commercial Foundation

#### 29.4.1 Customer Commercial Extensions

Customer identity foundation = Master & Engineering。Sales 通过 `customer_commercial_extensions`（A-39）扩展 customer identity；该表只保存 commercial facets，不复制 customer code / name 等 Master truth。

```text
customer_id                    (FK customers.id, NOT NULL)
effective_from                 (DATE, NOT NULL)
settlement_party_customer_id   (FK customers.id, NULL)
payer_customer_id              (FK customers.id, NULL)
default_salesperson_id         (FK salesperson_profiles.id, NULL)
default_sales_group_id         (FK sales_groups.id, NULL)
default_payment_terms_days     (INTEGER, NULL, CHECK >= 0)
default_settlement_method      (TEXT, NULL)
sellable_scope_mode            (TEXT, NOT NULL, CHECK IN 'ALL_SALES_ENABLED','RULE_CONTROLLED')
effective_to                   (DATE, NULL; CHECK effective_to >= effective_from)
created_at / updated_at        (NOT NULL audit timestamps)
created_by / updated_by        (FK users.id, NULL; audit actor only, not salesperson identity)
PRIMARY KEY (customer_id, effective_from)
```

Notes:
- Ship-to / Settlement Party / Payer 不必自有 Customer row；可以引用同一 Customer（self）。
- 主键：`PRIMARY KEY (customer_id, effective_from)` 仅定位一条版本，**不**被误认为能够阻止区间重叠。
- Hard invariant：对同一 `customer_id` 与任一 `business_date`，至多一条 extension row 满足 `effective_from <= business_date AND (effective_to IS NULL OR business_date <= effective_to)`；同一 customer 的两个有效区间不得重叠。
- Cross-dialect mutation：SQLite 使用 `BEGIN IMMEDIATE`；MySQL 在同一 transaction 中先 `SELECT customers.id ... FOR UPDATE`，以 Master customer identity row 作为稳定的 customer-scoped serialization anchor，再重读全部相关 effective rows。发现 overlap 时明确拒绝；仅显式的 controlled supersession 可先把上一行 `effective_to` 设为新行前一业务日，然后写新行与 audit，最后 commit。读取 Master row 的锁不会转移 customer identity ownership，且不得修改 Master row。
- `effective_to IS NULL` 表示 open-ended effective record；effective row 本身即版本身份，不增加另一套 mutable `version` truth。
- Frozen `customers.payment_terms_days` 保留（legacy compatibility）；不在 Wave 1 修改 `customers`。Extension 中的 nullable default 不反写 Master row，也不为历史 customer fabrication。
- `credit_limit` 不在本表重复定义；属于 `credit_profile`（§29.22）。SC1 在 §34.1 中明示 `credit_limit` 不归 Customer commercial master（避免 double-counting）。
- `default_pricing_list_id` / `default_discount_scheme_id` 保留 B3102 customer-default 语义，但归 Wave 2：A-28 `sales_price_lists` / A-31 `sales_discount_schemes` 创建后才向 A-39 增加 nullable FK。Wave 1 不创建字段、不创建 TEXT pseudo-FK、不提前创建 target table。
- `commercial_defaults_snapshot_id` 从 target physical design 删除：Requirement 未要求 customer-default snapshot identity，且无 canonical target。变更历史由 A-22 `audit_logs`；交易时不可变事实由后续 Sales document snapshot 保存。

Wave 1 field disposition（no TBD）：

| Field | Disposition | Reason |
|---|---|---|
| `customer_id`, `effective_from`, `effective_to` | `WAVE_1_PHYSICAL` | Master FK + effective-dated identity |
| `settlement_party_customer_id`, `payer_customer_id` | `WAVE_1_PHYSICAL` | SC03 / SC04; canonical customer references |
| `default_salesperson_id`, `default_sales_group_id` | `WAVE_1_PHYSICAL` | SC05 / SC06; canonical Sales-owned references |
| `default_payment_terms_days`, `default_settlement_method`, `sellable_scope_mode` | `WAVE_1_PHYSICAL` | nullable commercial defaults + coherent customer-level sellable policy; no Master rewrite |
| `created_at`, `updated_at`, `created_by`, `updated_by` | `WAVE_1_PHYSICAL` | audit metadata; actor identity is not salesperson identity |
| `default_pricing_list_id` | `DEFER_TO_WAVE_2` | A-28 target does not exist before Wave 2; SC08 final completion remains Wave 5 after tolerance execution |
| `default_discount_scheme_id` | `DEFER_TO_WAVE_2` | A-31 target does not exist before Wave 2; nullable customer discount-table default, no fabrication |
| any prepayment / reservation / credit default | `DEFER_TO_LATER_WAVE` | owned by Waves 7 / 9+; not introduced in Wave 1 |
| `commercial_defaults_snapshot_id` | `REMOVED_AS_INVALID_DESIGN` | no Requirement mandate and no canonical physical target |

#### 29.4.2 Salesperson / Sales Group

Salesperson 是 Sales business identity，不是 Platform login identity。Wave 1 不修改 `users`。

```text
sales_groups (A-63):
  id                    (PK)
  group_code            (TEXT, NOT NULL, UNIQUE)
  name                  (TEXT, NOT NULL)
  description           (TEXT, NULL)
  active                (BOOLEAN, NOT NULL, DEFAULT TRUE)
  created_at / updated_at (NOT NULL)

salesperson_profiles (A-64):
  id                    (PK; canonical Sales salesperson identity)
  salesperson_code      (TEXT, NOT NULL, UNIQUE)
  name                  (TEXT, NOT NULL)
  user_id               (FK users.id, NULL, UNIQUE)
  active                (BOOLEAN, NOT NULL, DEFAULT TRUE)
  created_at / updated_at (NOT NULL)

salesperson_group_memberships (A-66):
  id                    (PK)
  salesperson_id        (FK salesperson_profiles.id, NOT NULL)
  sales_group_id        (FK sales_groups.id, NOT NULL)
  is_default            (BOOLEAN, NOT NULL, DEFAULT FALSE)
  active                (BOOLEAN, NOT NULL, DEFAULT TRUE)
  effective_from        (DATE, NOT NULL)
  effective_to          (DATE, NULL; CHECK effective_to >= effective_from)
  created_at / updated_at / created_by / updated_by
  UNIQUE (salesperson_id, sales_group_id, effective_from)
```

- `user_id IS NULL` 合法：salesperson 可以没有 ERP login；login user 不自动成为 salesperson。
- `users.id` 只作为可选 login link / audit actor；`salesperson_profiles.id` 是唯一 Sales salesperson identity。
- `sales_groups.id` 是唯一 group identity；Customer default、Quotation、SO 与后续 Credit salesperson dimension 均引用 ID，不存 canonical group free text。
- 默认组是日期有效业务不变量：零个 active membership 时允许零 default，但该 salesperson 不得参与新的 group-scoped document；恰有一个 active membership 时必须 `EXACTLY_ONE` 且就是该 membership；多个 active memberships 时也必须 `EXACTLY_ONE`。`AT_MOST_ONE` 仅是写入过程始终成立的唯一性下界，不能替代非空 active set 的 exactly-one 合同。默认 membership 到期/停用、group inactive 或 salesperson inactive 时解析 fail closed，必须受控重选，不能静默挑选另一组。历史 Quotation/SO snapshot 不回写。
- membership/default mutation 以 `salesperson_profiles.id` 为稳定锁锚：SQLite `BEGIN IMMEDIATE`；MySQL `SELECT salesperson_profiles.id ... FOR UPDATE`，锁内重读 memberships/groups 后执行相同日期区间与 exactly-one 校验，再与 audit 同 transaction 写入。单列 UNIQUE 不能表达跨日期合同。
- Quotation（Wave 3）与 Sales Order（Wave 4）写入时 snapshot `sales_group_id`；从 Wave 3 起统一 backend predicate 按 login → `salesperson_profiles.user_id` → effective active memberships/groups 授权读取、写入、审批、导出。`sales_group_data_scope_enabled=TRUE` 启用 membership scope；`FALSE` 对普通用户 fail closed，只允许显式 `sales:cross-group` 权限绕过并 audit，绝不解释为全员可见。无 login link、无 membership、membership expired、group inactive 均 fail closed。Report（Wave 12）复用既有 predicate并完成综合验证，不负责首次补授权。SC06 final-completion 仍为 Wave 12。
- 历史 row 缺 salesperson / group 时显示 `(unassigned)`，不 fabrication 商业事实。
- Wave 1 对 `users` / `customers` / `products` / `sales_orders` / `sales_order_items` 的 schema extension 均为 0；A-65 / A-66 均为 Sales-owned 新表。

#### 29.4.3 Customer-Material Cross Reference

`customer_material_xref`（A-40）：

```text
id                         (PK)
customer_id                (FK customers.id, NOT NULL)
product_id                 (FK products.id, NOT NULL)
customer_material_code     (TEXT, NULL)
customer_material_name     (TEXT, NULL; customer-facing identity only)
commercial_uom_code        (TEXT, NULL; FK/contract to existing canonical UOM)
effective_from             (DATE, NOT NULL)
effective_to               (DATE, NULL; CHECK effective_to >= effective_from)
active                     (BOOLEAN, NOT NULL, DEFAULT TRUE)
created_at / updated_at    (NOT NULL)
UNIQUE (customer_id, product_id, effective_from)
```

- `customer_material_code` / `customer_material_name` = customer-specific mapping；canonical product identity 始终是 `products.id`，不复制 product code / name / base UOM truth。
- xref row 只表达 customer code/name ↔ internal `product_id` 翻译，不承载 Sellable Scope。相同 `(customer_id, customer_material_code, business_date)` 可有多个 internal-product 候选；resolver 不自动猜测，必须接收显式 `product_id` 并验证 effective xref，未选择、无匹配或选择后仍歧义均 BLOCK。唯一性只保持 `(customer_id, product_id, effective_from)` row identity。
- `sales_sellable_scope_rules`（A-69）独立存储可销范围：`id`、`scope_dimension` (`CUSTOMER_PRODUCT|SALESPERSON_PRODUCT|SALESPERSON_CUSTOMER`)、按 dimension 必填的 `customer_id/salesperson_id/product_id`、`effect` (`ALLOW|DENY`)、`effective_from/effective_to`、active 与 audit metadata。业务日期上显式 DENY 优先；启用 sellable control 时，各启用维度必须命中 ALLOW 且不得命中 DENY。A-61 `sales_enabled=TRUE` 是所有模式的先决条件，参数关闭不能绕过。
- xref mutation 与 A-39 共用 customer anchor；sellable rule mutation 按 customer 或 salesperson canonical anchor。SQLite `BEGIN IMMEDIATE`；MySQL 对对应 anchor `FOR UPDATE`，锁内重读 effective intervals、防止相同 rule key/effect 冲突，再与 audit 同 transaction 写入。
- `effective_to IS NULL` 表示 open-ended current candidate；实际 effective row 必须以传入的 authoritative `business_date` 解析。

#### 29.4.4 Order-time Frozen Commercial Defaults

SO create-time 形如：

```text
SO_id  →  stored: (ship_to_contact / ship_to_phone / ship_to_address /
                   salesperson_id / sales_group_id /
                   settlement_party_id / payer_id / customer_material_xref_id /
                   commercial_tax_code / tax_inclusive_flag /
                   commercial_pricing_uom_code)
```

Snapshot columns 是 additive；不改写 existing historical orders（FROZEN）。

#### 29.4.5 Sales Parameters (SC01)

实际仓库复核结论：现有 `inventory_parameters`、`planning_parameters`、`procurement_parameters`、`finance_parameters` 与 accounting config 都是各领域自有的显式 schema/module；仓库没有可安全承载 Sales-owned SYSTEM / DOCUMENT_TYPE 参数语义的 canonical generic Platform parameter storage。A-21 `idempotency_records` 等 Platform shared mechanics 也不是参数存储。因此采用 Sales-owned bounded table A-65，而不创建 uncontrolled generic key/value store，也不复用 Wave 9 `credit_parameters`。

```text
sales_parameters (A-65):
  scope_key                         (PK; 'SYSTEM' or 'DOCUMENT_TYPE:<bounded-code>')
  scope_type                        (CHECK IN 'SYSTEM','DOCUMENT_TYPE')
  document_type                     (NULL for SYSTEM; bounded code for DOCUMENT_TYPE)
  sellable_control_enabled          (BOOLEAN NOT NULL)
  customer_material_xref_enabled    (BOOLEAN NOT NULL)
  sales_group_data_scope_enabled    (BOOLEAN NOT NULL)
  delivery_schedule_enabled         (BOOLEAN NOT NULL)
  delivery_quantity_control_enabled (BOOLEAN NOT NULL)
  order_change_mode                 (CHECK IN 'DISABLED','CONTROLLED_DIRECT',
                                     'CONTROLLED_DOCUMENT','BOTH')
  reservation_behavior              (CHECK IN 'DISABLED','INVENTORY_LOCK',
                                     'MANUAL_RESERVATION','ON_HAND_RESERVATION',
                                     'EXPECTED_SUPPLY_RESERVATION')
  active / created_at / updated_at / created_by / updated_by
```

- `scope_type='SYSTEM'` 时 `document_type IS NULL`；`DOCUMENT_TYPE` 时必须为 Sales registry 中的 bounded document type。所有 code 均由 Sales validator 白名单校验，不接受任意 key/value。
- resolution deterministic：先读取 exact active `DOCUMENT_TYPE:<code>` row；存在时该完整控制行覆盖 SYSTEM，否则使用唯一 active SYSTEM row；缺少 SYSTEM row 或 code 非法时 backend fail closed。Platform 只提供 transaction/audit/RBAC 等通用 mechanics，不拥有 parameter namespace/code/validation/business meaning。
- `order_change_mode` 语义固定：`DISABLED` 两条 APPROVED-order change path 均拒绝；`CONTROLLED_DIRECT` 只允许受控直接入口；`CONTROLLED_DOCUMENT` 只允许正式变更单入口；`BOTH` 同时开放两个入口但每个入口仍执行其自身权限与同一 approval/application contract。变更申请保存 resolved parameter scope、row identity/hash 与 mode snapshot；参数后续变化不得改写 APPLIED history。尚未应用的 request 在 approval/application transaction 中重读当前 effective parameter；若该 path 已被禁用则 fail closed，必须取消或重新申请。
- feature enable 与业务事实分离：`customer_material_xref_enabled` 只决定 A-40 翻译是否可用；`sellable_control_enabled` 决定是否执行 A-69 可销范围。A-39 `sellable_scope_mode` 是 customer-level applicability selector，不再把 xref 当作 sellable rule。所有模式都先要求 active A-61 且 `sales_enabled=TRUE`；所有检查在 backend 执行，frontend hidden 不是 authorization。
- 后续能力依赖：Wave 4 执行 `order_change_mode`；Wave 5 执行 delivery schedule/quantity controls；Wave 7 执行 `reservation_behavior`。A-65 从 Wave 1 一次建立完整 bounded columns，但 SC01 的 primary/final-completion wave 是 Wave 7。

### 29.5 Quotation Technical Design

#### 29.5.1 Lifecycle

```text
DRAFT
EFFECTIVE        (i.e. ACTIVE; frozen as 'EFFECTIVE' = APPROVED if Quotation needs approval per policy)
EXPIRED          (validity < business_date; auto-transition by trigger / runtime check)
CLOSED           (cancelled by user; partial-conversion preserved)
FULLY_CONVERTED  (when converted qty = qty aggregate; remains in history)
```

> 本 Design 不强制 Quotation approval。Approval 是 policy 选项；若启用则 state `EFFECTIVE` 是 approval 的产物。

#### 29.5.2 物理对象

`sales_quotations` (NEW #22) + `sales_quotation_lines` (NEW #23)：

```text
sales_quotations:
  id, quotation_no (UNIQUE), customer_id (FK),
  salesperson_id (FK salesperson_profiles.id, nullable),
  sales_group_id (FK sales_groups.id, nullable),
  status (CHECK IN 'DRAFT', 'EFFECTIVE', 'EXPIRED', 'CLOSED', 'FULLY_CONVERTED'),
  currency_code (single base currency only; NOT multi-currency),
  valid_from, valid_to,
  payment_terms, payment_terms_days,
  commercial_tax_code (or NULL), tax_inclusive (bool or NULL),
  total_cents (computed),
  converted_total_cents (computed),
  created_at / updated_at, creator_id, reviewer_id,
  remarks

sales_quotation_lines:
  id, quotation_id (FK), line_no,
  material_id (FK), commercial_uom_code,
  quantity (REAL), unit_price_cents, amount_cents,
  converted_qty (REAL; SUM of all SO lines sourced from this quotation line),
  remaining_qty (generated column from quantity - converted_qty),
  discount_snapshot (see §29.7),
  tax_basis_assumption (commercial; not statutory),
  remarks
```

#### 29.5.3 Conversion → Sales Order (canonical choice)

This Domain keeps `sales_quotation_conversions` as an EXPLICIT physical conversion-evidence table (chosen canonical option; no duplicate conversion truth via Platform relation infra).

`sales_quotation_conversions` (NEW, physical table — see §29.2 A-27):

```text
sales_quotation_conversions:
  id                              (PK)
  quotation_id                   (FK sales_quotations.id)
  quotation_line_id              (FK sales_quotation_lines.id)
  sales_order_id                 (FK sales_orders.id)
  sales_order_item_id            (FK sales_order_items.id)
  converted_qty                  (REAL; signed positive for normal conversion;
                                   conversion CANNOT exceed remaining)
  converted_unit_price_cents      (snapshot at conversion time; required)
  converted_amount_cents         (snapshot; required for audit)
  converted_uom_code             (snapshot UoM; nullable if UoM is the same)
  business_date                  (date of conversion)
  converted_at                   (timestamp; audit)
  converted_by                   (FK users.id; audit)
  idempotency_key                (UNIQUE with sales_quotation_conversions.id)
  PR UNIQUE (quotation_line_id, sales_order_item_id)
```

Constraints:

- `converted_qty ≤ SO item quantity` per conversion row.
- Per quotation_line: `SUM(converted_qty) ≤ sales_quotation_lines.quantity`.
- Repeated conversion (Requirement SC14): allowed only when:
  - `quotations.status = 'EFFECTIVE'`
  - `quotation.valid_to >= business_date`
  - `SUM(converted_qty for this quotation_line) < quotation_line.quantity`
- Each conversion commits as ONE tx: insert + capacity re-read + check + audit.

#### 29.5.4 Capacity Trace & Audit

- `sales_quotation_lines.remaining_qty` is computed as `quantity - SUM(sales_quotation_conversions.converted_qty for this quotation_line_id)`. Generated column at SQL layer.
- Each conversion writes audit `entity_type = 'SALES_QUOTATION_CONVERSION'`, `detail = {quotation_id, quotation_line_id, sales_order_id, sales_order_item_id, converted_qty, business_date}`.
- Capacity anchor for R-SAL-06: `sales_quotation_lines.id` (FOR UPDATE on this row when converting); secondary FOR UPDATE on `sales_order_items.id` at SO item side to prevent post-submit frozen-line mutation.

### 29.6 Sales Pricing Technical Design

Wave 2 dependency order is fixed: create A-28 `sales_price_lists` and A-31 `sales_discount_schemes`, then add nullable `customer_commercial_extensions.default_pricing_list_id` / `default_discount_scheme_id` with FKs to those targets. Wave 1 contains neither column nor any unvalidated placeholder.

#### 29.6.1 物理对象

`sales_price_lists` (NEW #24) + `sales_price_list_entries` (NEW #25) + `sales_price_list_versions` (NEW #26)：

```text
sales_price_lists:
  id (TEXT PK), price_list_code (UNIQUE NOT NULL), name, currency_code (single base),
  priority (int; lower = higher priority), fallback_price_list_id (FK self),
  effective_from, effective_to,
  status (CHECK IN 'DRAFT', 'ACTIVE', 'RETIRED'),
  activated_at/by, retired_at/by, created_at/by, updated_at/by

sales_price_list_entries:
  id (TEXT PK), price_list_id (FK), material_id (FK products.id),
  customer_id (FK customers.id; NULL = all customers),
  customer_scope_type (NOT NULL; 'ALL' | 'CUSTOMER'),
  material_identity_key (NOT NULL; canonical ASCII, length <= 128),
  customer_scope_key (NOT NULL; canonical ASCII, length <= 128),
  pricing_uom_code (FK uoms.code),
  pricing_identity_key (NOT NULL; canonical ASCII, length <= 128),
  qty_break_min_micros (safe integer; inclusive),
  qty_break_max_micros (safe integer nullable; inclusive; NULL = unbounded),
  effective_from, effective_to,
  created_at, created_by,
  UNIQUE (price_list_id, material_identity_key,
          customer_scope_key, pricing_identity_key)

sales_price_list_versions:  -- snapshot history (append-only)
  id (TEXT PK), entry_id (FK sales_price_list_entries.id),
  version (safe integer >= 1), unit_price_cents (safe integer >= 0),
  snapshot_json,
  created_at, created_by
  UNIQUE (entry_id, version)
```

Identity / constraint contract:

- `sales_price_list_entries.id` is the sole row PK on both engines. `sales_price_list_versions.entry_id` therefore references an actually unique target. No nullable column participates in a PK.
- `sales_price_lists.id` is a service-generated lower-case RFC-4122 UUID (36 ASCII characters) and is immutable. The three non-null normalized identity keys use the following exact, case-stable encoding over UTF-8 bytes; upper-case hexadecimal means two ASCII hex characters per byte and no delimiter appears inside an encoded component:
  - `material_identity_key = 'M:' + HEX(material_id)`; `material_id` must encode to 1..63 UTF-8 bytes, so the key is 4..128 ASCII characters.
  - `customer_scope_key = 'A'` when `(customer_scope_type='ALL', customer_id IS NULL)`; otherwise `customer_scope_key = 'C:' + HEX(customer_id)` when `(customer_scope_type='CUSTOMER', customer_id IS NOT NULL)`. A customer id used by pricing must encode to 1..63 UTF-8 bytes. `A` cannot collide with any `C:` identity.
  - `pricing_identity_key = 'U:' + HEX(pricing_uom_code) + '|Q:' + PAD16(qty_break_min_micros) + '|D:' + YYYYMMDD(effective_from)`. Pricing UoM codes are limited to 1..32 UTF-8 bytes; quantity minimum is a non-negative safe integer rendered as exactly 16 decimal digits; date is a validated ISO date with hyphens removed. The maximum key length is 96 ASCII characters.
- Inputs exceeding these bounds fail with `PRICE_IDENTITY_COMPONENT_TOO_LONG`; the service never truncates, case-folds, hashes, or substitutes them. It re-derives all three keys and compares exact equality before INSERT. Identity-bearing fields and keys cannot be updated in place, even in DRAFT: a DRAFT identity change deletes/recreates the entry with a new `id`; price changes append only a version. This removes key-drift update paths.
- Database CHECKs enforce the list UUID/identity-key non-null and length bounds plus the ALL/CUSTOMER nullability/prefix shape. Wave-2 migration also installs exactly two dialect-local, metadata-checked guards: `trg_sales_price_entries_identity_bi` (`BEFORE INSERT`) and `trg_sales_price_entries_identity_bu` (`BEFORE UPDATE`). SQLite compares against its native `hex()` encoding; MySQL live registry replay compares against `HEX()`/`CONCAT()` encoding. They reject any byte-for-byte derivation mismatch and any in-place identity-field/key update. Trigger creation is idempotent through `sqlite_master` / `information_schema.TRIGGERS` inspection and requires no global Adapter change. The backend performs the same derivation before SQL.
- Trigger derivation is exact, not implementation-defined: SQLite uses `'M:' || hex(material_id)`, `CASE ... 'A' ... 'C:' || hex(customer_id)`, and `'U:' || hex(pricing_uom_code) || '|Q:' || printf('%016d', qty_break_min_micros) || '|D:' || replace(effective_from,'-','')`; MySQL uses the equivalent `CONCAT`, `HEX`, `LPAD(CAST(... AS CHAR),16,'0')`, and `REPLACE`. Component bounds use SQLite BLOB byte length and MySQL `OCTET_LENGTH`, so multibyte input has identical acceptance. The canonical uppercase hex output is compared byte-for-byte under both databases.
- The plain four-column UNIQUE is the database business-uniqueness authority on both engines, while the guard triggers prevent alternate-key bypass. No partial, expression, seven-column, or generated SHA/digest index is permitted.
- Current `mysqlType()` maps every indexed TEXT component to `VARCHAR(128)`. The four-column utf8mb4 worst-case key budget is `4 × 128 × 4 = 2048` bytes, below InnoDB's 3072-byte limit; therefore neither prefix indexing nor digest fallback is needed.
- `effective_to IS NULL` means open-ended and every date range is inclusive. `effective_to < effective_from`, negative breaks, or `max < min` is rejected.
- For the same list/material/customer scope/UoM, quantity-break rectangles must not overlap when their inclusive business-date ranges overlap. Adjacent breaks therefore require `previous.max < next.min`; equality is an overlap. The service enforces this after locking the owning list row and re-reading all peers in the same transaction.
- Entry identity/range fields are mutable only while the owning list is `DRAFT`. A version row is never updated or deleted. Editing a draft price appends `version=max+1`; activation freezes the list, all entries, and all versions. A commercial change after activation requires a new list identity; retirement only changes the list lifecycle fields and never rewrites history.
- FK targets, CHECKs, the ordered four-column UNIQUE, safe-integer bounds, normalized-key derivation, and immutability guards have identical SQLite/MySQL acceptance tests. Application validation supplements rather than replaces DB constraints.

#### 29.6.2 Canonical UoM and quantity normalization

- Wave 2 creates no conversion column or conversion table. `base_uom_code`, `conversion_factor`, floating quantity breaks, and any Sales-owned UoM truth are forbidden.
- The frozen inventory label at §29.2 E-01 uses “legacy pricing fallback” only for historical-document/reference display. This bounded correction removes the former fifth resolver fallback; no new pricing decision may read `products.price_cents`.
- Given `material_id`, `pricing_uom_code`, and `business_date`, resolve exactly one active Master-owned A-16 `product_uom_conversions` row satisfying `effective_from <= business_date <= effective_to` (NULL end = open) and whose `base_uom_code` equals the product base UoM. Base-UoM pricing uses evidence `(uom_code=base, numerator=1, denominator=1, version=0)` without inserting a conversion row.
- Direction is frozen as `base quantity = document/pricing quantity × numerator ÷ denominator`, matching the canonical Master service. The resolver never inverts this ratio implicitly.
- API quantities are decimal strings with at most six fractional digits, parsed to safe integer micro-units (`1 unit = 1,000,000 micros`). Convert the requested document quantity to base rational quantity, then into the candidate entry's pricing UoM by the candidate's effective conversion. Round exactly once to pricing-UoM micros using non-negative `HALF_UP`; compare the resulting integer against inclusive break bounds. Money is not rounded during this normalization.
- Missing, inactive, future-only, expired, wrong-product, wrong-base, ambiguous, non-positive, unsafe-integer, or zero-denominator conversion evidence fails closed with 409. No legacy factor or `products.price_cents` can repair that failure.
- Resolver evidence includes requested UoM/quantity micros plus both conversion identities and immutable `{id, numerator, denominator, version, effective_from, effective_to}` values. It is an output evidence envelope in Wave 2; Wave 4 persists it on the SO line. Later Master conversion changes must not reinterpret persisted evidence.

#### 29.6.3 Resolver Service

`resolveSalesPrice(context)` 商业 signature（伪）：

```text
INPUT:
  customer_id
  material_id
  pricing_uom_code
  quantity_decimal
  business_date
  explicit_price_list_ids[]  (optional; caller order is significant)
  manual_price_cents         (optional)
  override_reason            (required with manual price)

OUTPUT:
  resolved_price_cents   (bigint)
  source_rule_identity   (list id + entry id + version row id/version)
  effective_range        (date range applied)
  uom_evidence           (requested + candidate canonical rational snapshots)
  qty_break_applied      (integer micros min/max + normalized quantity)
  override_state         ('NONE' | 'OVERRIDDEN'; unauthorized requests are errors)
  snapshot_evidence      (immutable output envelope; no Wave-2 SO persistence)

PRECONDITIONS:
  - one base currency only
  - all candidate lists are ACTIVE and list/entry dates include business_date
  - list currency equals the configured base currency; no FX conversion
  - canonical UoM evidence satisfies §29.6.2

OVERRIDE:
  - manual price must be a non-negative safe integer and requires
    pricing:override plus a trimmed non-empty reason
  - resolver returns override evidence but performs zero DB mutation
  - no sales_pricing_override_log and no override_reason_id table/FK exist
```

Exact candidate order:

1. Normalize and de-duplicate `explicit_price_list_ids` preserving caller order; each explicit id must be visible and applicable or the request fails closed (it is never silently skipped).
2. Append the customer's effective `default_pricing_list_id` if non-null and not already present. A missing/inactive/out-of-date configured default fails closed.
3. If neither source produces a root list, return `PRICE_NOT_CONFIGURED`; do not scan arbitrary ACTIVE lists.
4. Resolve each root completely before the next root. Within one list, customer-specific entries precede list-wide entries. Within the same scope, choose the matching break with greatest `qty_break_min_micros`, then latest `effective_from`, then lexicographically smallest `entry.id`; choose that entry's greatest version, then smallest version-row id. If supposedly unique state leaves another tie, fail closed as corrupted metadata.
5. When a list has no matching entry, follow its `fallback_price_list_id` chain depth-first. A fallback target must be ACTIVE, effective, same currency, and not previously visited. Activation validates the full chain under deterministic list-id locks; self-reference, cycle, missing target, or repeated node is rejected. Runtime repeats the visited-set guard and fails closed on corrupted chains.
6. List `priority` is not an invitation to scan globally. It is used only to order multiple customer defaults if legacy data temporarily exposes more than one effective extension (`priority`, then list id); current Wave-1 authority should yield one. Explicit caller order always wins. No unspecified “next higher-priority list” exists.
7. `products.price_cents` is excluded from all new resolver/write paths. It remains display/read compatibility for historical documents only (§29.40); `PRICE_NOT_CONFIGURED` is returned instead of bypassing the engine.

Decision examples:

| Situation | Deterministic result |
|---|---|
| Explicit L2 then L1; L2 has list-wide match and L1 has customer match | L2 list-wide wins: root order precedes customer scope across roots |
| Root L1 has customer and list-wide matches | L1 customer match wins |
| L1 has no match and falls back to L3; L2 is next explicit root | L3 is evaluated before L2 |
| Two matching breaks start at 10.000000 and 20.000000 pricing units | greatest qualifying minimum (20.000000) wins; boundaries are inclusive |
| No explicit/default root, but product has legacy price | `PRICE_NOT_CONFIGURED`; legacy price is not returned |
| Fallback L1 → L2 → L1 | activation and runtime both reject the cycle |

#### 29.6.4 Lifecycle, locking, and evidence boundary

- Create/update/delete-entry/version operations require `pricing:manage` and a locked `DRAFT` list. Activation and retirement require `Idempotency-Key`; exact replay returns the stored result from existing Platform A-21 mechanics, while key/payload mismatch is 409.
- Activation locks the root and reachable fallback lists in ascending id order, re-reads all entries/versions and canonical effective UoM evidence, validates uniqueness/range/cycle/currency, then writes `ACTIVE` plus `audit_logs` in one transaction. An empty list or entry without a version cannot activate. Retirement locks and transitions only `ACTIVE → RETIRED`; repeated same-key replay is stable, while direct replay with a different key against an already retired list is 409.
- `POST /api/sales-pricing/resolve` is pure: read-only transaction, zero writes to the five Wave-2 tables, `audit_logs`, or idempotency state. Its result is preview/decision evidence, not an approved-order snapshot.
- Wave 2 does **not** add or mutate `sales_orders` / `sales_order_items`. The output evidence contract contains resolved cents, list/entry/version identities, date/break/UoM evidence, override actor/reason when applicable, and resolver contract version `SALES_PRICE_V1`. Wave 4 owns actual SO create persistence and approved-order immutability. Therefore UAT-S-08 resolver evidence is executable in Wave 2, while the approved-SO half of R-SAL-11 is not complete before Wave 4.
- Approved Limited Design Reopen mapping: the Wave-4 canonical writer re-runs this resolver inside its transaction and serializes the complete versioned envelope into `sales_order_items.price_snapshot_json`. The JSON includes contract version, business date, request fingerprint, price-list/entry/version identities, immutable version/catalog unit cents separately from resolved unit cents, requested and pricing UoM rational evidence, quantity evidence, gross line cents, and any authorized manual-override actor/`SALES_PRICING_OVERRIDE` authority/reason. Client JSON is never authoritative; the writer and approval path recompute the evidence fingerprint and cross-check version/catalog price, resolved order price, UoM, quantity and gross amount.

### 29.7 Order-Time Discount Technical Design

#### 29.7.1 物理对象

`sales_discount_schemes` (NEW #27) + `sales_discount_scheme_rules` (NEW #28). Wave 2 adds no SO snapshot table or SO columns：

```text
sales_discount_schemes:
  id (TEXT PK), scheme_code (UNIQUE NOT NULL), name, currency_code,
  priority (int; lower = higher priority), fallback_scheme_id (FK self nullable),
  effective_from, effective_to, version (safe integer >= 1),
  status ('DRAFT'|'ACTIVE'|'RETIRED'),
  activated_at/by, retired_at/by, created_at/by, updated_at/by

sales_discount_scheme_rules:
  id (TEXT PK), scheme_id (FK), rule_key (NOT NULL), rule_version (safe integer >= 1),
  enabled (0|1; NOT NULL DEFAULT 1),
  material_id (FK nullable), customer_id (FK nullable),
  customer_scope_type ('ALL'|'CUSTOMER'), customer_scope_key (NOT NULL),
  pricing_uom_code (FK uoms.code nullable),
  line_scope ('LINE'|'HEADER'), application_mode ('AUTOMATIC'|'MANUAL'),
  discount_kind ('PERCENT'|'AMOUNT'),
  discount_bps (safe integer nullable; 0..10000),
  discount_amount_cents (safe integer nullable; >= 0),
  priority (int; lower first),
  qty_break_min_micros (safe integer NOT NULL DEFAULT 0),
  qty_break_max_micros (safe integer nullable),
  effective_from, effective_to, created_at, created_by,
  UNIQUE (scheme_id, rule_key, rule_version)
```

- PERCENT requires only `discount_bps`; AMOUNT requires only `discount_amount_cents`. `REAL`, fraction-valued percent, per-unit fixed amount, and dual-populated value columns are forbidden. An AMOUNT rule means one total discount amount for the matched line or header, never cents-per-unit.
- LINE applicability may use `material_id`, customer scope, `pricing_uom_code`, quantity break, and inclusive business-date range. Nullable material/UoM means any value; minimum 0 + NULL maximum means any non-negative quantity.
- HEADER applicability is order-level only. Its database CHECK requires `material_id IS NULL`, `pricing_uom_code IS NULL`, `qty_break_min_micros = 0`, and `qty_break_max_micros IS NULL`; backend create/append/activate validation repeats the same rule and returns 422 for any violation. HEADER still uses customer scope, inclusive business date, priority, scheme fallback, AUTOMATIC/MANUAL ordering, override authority, and reason. Its calculation base is the whole order subtotal after every LINE stage.
- Customer scope normalization, date/break validity, canonical UoM lookup for LINE only, safe-integer rules, ACTIVE immutability, fallback-cycle checks, scheme-row locking, activation/retirement replay, and audit transaction follow §29.6.
- Each rule-version row is append-only from creation. A DRAFT edit appends `rule_version=max+1` under the locked scheme; it does not PATCH or delete the prior version. Logical removal appends a later version with `enabled=0` and its intended `effective_from`. For a business date, group rows by `(scheme_id, rule_key)`, restrict to versions with `effective_from <= business_date`, then choose exactly the greatest `rule_version`. If that chosen version is disabled or its `effective_to < business_date`, the rule_key contributes nothing; an older version never revives as fallback. Activation requires versions to be positive, unique, gap-free, and non-decreasing by `effective_from`; ACTIVE schemes freeze every version. Later terms require a cloned DRAFT scheme/version.
- `UNIQUE (scheme_id, rule_key, rule_version)` is a three-column Bootstrap-supported database constraint; the greatest-version rule is the single current logical version. Scheme `version` plus selected rule `id/rule_key/rule_version` is returned as immutable evidence. No sixth history/snapshot/override table is created.

#### 29.7.2 解析

`resolveOrderTimeDiscount(context)`：

```text
INPUT: customer_id, business_date, explicit_scheme_ids[],
       lines[{line_id, line_no, material_id, requested_uom_code,
              quantity_decimal, explicit_price_list_ids[],
              expected_pricing_evidence?}],
       manual_rule_selections[{rule_id, line_id nullable}], override_reason
OUTPUT:
  line_discount_cents_by_line
  header_discount_cents_total + header_allocation_cents_by_line
  total_discount_cents
  applied_rule_evidence[] (scheme id/version + rule id/key/version + order)
  rounding_evidence ('HALF_UP_CENT_V1' + allocation trace)
```

Scheme roots use explicit caller order, then the one effective customer default, then each root's validated fallback chain; no global ACTIVE scan occurs. Before applicability ranking, each `(scheme_id, rule_key)` contributes only the current business-date version selected by the preceding contract; a disabled/expired current version contributes nothing and a requested historical manual `rule_id` is rejected. Among enabled current versions, customer-specific precedes list-wide, lower rule priority precedes higher, greatest qualifying break minimum precedes lower for LINE only, latest effective start precedes earlier, and lexicographically smallest rule id is the final stable tie-break. Ambiguous corrupted state fails closed.

Pricing authority boundary:

- The discount resolver does not accept client-supplied unit price, normalized quantity, or pricing evidence as authority. For every line it invokes the canonical §29.6 price resolver server-side under the same read snapshot using customer/material/requested UoM/quantity/business date/explicit-list context; manual price follows the existing `pricing:override` + reason contract.
- `expected_pricing_evidence`, when present, is only an optimistic assertion. Its price, list/entry/version, UoM conversion identities, normalized quantity, effective range, and fingerprint must exactly match the server result or the request fails 409. The server calculation always uses its own result.
- Consequently Wave-2 output remains a zero-write preview but is based on canonical server facts and is safe for later Wave-4 reuse. No authoritative SO writer may persist a client-provided preview without re-resolving/revalidating inside that writer's transaction.

Calculation pipeline (all operands safe integers):

1. For each line, use the server-resolved price and normalized pricing quantity to compute `gross_line_cents = floor((resolved_unit_price_cents × normalized_pricing_quantity_micros + 500000) / 1000000)`. This is the single non-negative HALF_UP rounding from price × pricing-UoM quantity to line cents; unsafe multiplication or an expected-evidence mismatch fails closed.
2. Select at most one current AUTOMATIC LINE rule per line using material/customer/UoM/quantity/date applicability. If the caller supplies one current applicable MANUAL LINE rule for that line, apply it second to the remaining line amount. Each manual rule requires `pricing:override` and the same non-empty `override_reason`; no permission or reason means 403/422, not silent omission. More than one manual rule per line/scope is rejected.
3. PERCENT amount is `floor((current_base_cents × discount_bps + 5000) / 10000)` (non-negative HALF_UP to one cent). AMOUNT uses the exact stored total cents. If a stage discount exceeds its current base, reject the entire request with 409; do not cap. A result of exactly zero is valid, never negative.
4. Sum all post-LINE amounts into the order discounted subtotal. Select at most one current AUTOMATIC HEADER rule using only customer/date/priority/fallback applicability, then at most one current authorized MANUAL HEADER rule, each applied to the remaining order subtotal. HEADER never evaluates material, UoM, or quantity break. Thus all LINE stages precede all HEADER stages; AUTOMATIC precedes MANUAL within each scope.
5. Allocate each header-stage total across lines proportional to the line amounts entering that header stage. First assign floor shares; distribute remainder cents by descending fractional remainder, then ascending `line_no`, then lexicographically ascending `line_id`. Zero-base lines receive zero. Allocation sum must equal the header discount exactly. Each later header stage uses the amounts remaining after the earlier allocated stage.
6. Verify every line and order result remains `>= 0`, all sums are safe integers, and `total_discount = sum(line discounts) + sum(header allocations)`. Any violation fails atomically with zero side effects.

Integer-cents worked examples:

| Case | Calculation | Result |
|---|---|---|
| Line auto then manual | `1000 cents × 3,000,000 micros / 1,000,000 = 3000`; auto `1250 bps` gives `floor((3000×1250+5000)/10000)=375`; manual fixed `125` applies to remaining `2625` | line discount `500`; final line `2500` cents |
| Header percent + remainder | post-line amounts are line 1=`1001`, line 2=`2000`; subtotal `3001`; `1000 bps` gives `floor((3001×1000+5000)/10000)=300`; floor proportional shares are `100` and `199`, with one remainder cent | fractions rank line 2 first, so allocations are `100` and `200`; exact total `300` |
| Half-cent edge | current base `1` cent, `5000 bps` | `(1×5000+5000)/10000 = 1` cent under HALF_UP; final amount `0` is valid |
| Over-discount | current base `100` cents, fixed discount `101` | reject 409 with zero output mutation; never cap to `100` |

#### 29.7.3 与 pricing / 商业 amount 区分

```text
gross line amount       : resolved price × quantity, rounded by the commercial
                          amount contract before discount resolution
post-line subtotal      : gross line amount - automatic line - manual line
final commercial amount : post-line subtotal - allocated automatic header
                          - allocated manual header
```

No “final unit price” is reverse-derived from allocated cents. UAT-S-09 freezes calculation/evidence at amount level with this ordering, cent rounding, allocation, and zero-floor contract.

#### 29.7.4 与 M14 Sales Discount 区分

M14 (`sales_discounts`) = post-delivery finance adjustment integration。Finance canonical adapter 写入。本 Design 不让 order-time discount 进入 M14 path；M14 与 order-time discount 是 distinct canonical truth tables。

#### 29.7.5 Evidence / cross-wave boundary

- `POST /api/sales-discounts/resolve` is read-only and writes neither pricing tables nor `audit_logs`. It returns the complete calculation envelope: input fingerprint, scheme/rule versions, ordered stages, bases, bps/fixed cents, per-stage discount, header allocation trace, final line totals, actor id for manual selection, reason text, and contract version `ORDER_DISCOUNT_V1`.
- Wave 2 owns executable UAT-S-04..S-07 configuration/lifecycle/authorization behavior, UAT-S-08 price resolver evidence, and UAT-S-09 discount calculation/evidence. It does not claim actual SO persistence.
- Wave 4 persists the price and discount evidence on SO create and enforces write-once approved-order history for S19/S20/R-SAL-11. No Wave-4 column or handler is introduced by Wave 2, and R-SAL-11 remains incomplete until its approved-SO concurrency test passes.
- The approved Wave-4 persistence target is `sales_order_items.discount_snapshot_json`. Its versioned envelope contains `ORDER_DISCOUNT_V1`, request fingerprint, selected scheme/rule identities and versions, ordered LINE/HEADER stages, exact cents and HEADER allocation, rounding evidence, final commercial amount, explicit zero-discount evidence when no rule applies, and manual override actor/reason when present. The canonical writer re-resolves and verifies this evidence against `amount_cents`, line/order totals and the paired price snapshot before INSERT.

#### 29.7.6 Bounded design-reopen trace and implementation gate

| Original finding | Frozen source | Resolution | Updated section | Binding implementation rule | Required test |
|---|---|---|---|---|---|
| F1 — entry identity / nullable PK / version FK | SC15..SC20; S19/S20 | independent entry PK; bounded canonical material/customer/pricing identity keys; Bootstrap-supported four-column business UNIQUE; version FK to unique id; overlap rejection and append-only versions | §29.6.1, §29.41–43 | no nullable/7-column/hash identity; derive keys exactly; key fields never update in place; ACTIVE rows immutable | SQLite/MySQL fresh + existing-upgrade + second-init ordered-index metadata; duplicate probes; encoding bounds; boundary overlap; immutability |
| F2 — duplicate UoM truth | SC16/SC17; UAT-S-05/06 | Master A-16 rational lookup by business date; direction, micros precision, HALF_UP point and evidence frozen; no Sales factor | §29.6.2, §29.42 | read canonical numerator/denominator only; missing/ambiguous/unsafe conversion 409 | base/non-base/effective-date/direction/rounding/fail-closed cases on both DBs |
| F3 — ambiguous price precedence / legacy bypass | SC15..SC20; UAT-S-04..08 | explicit roots → effective customer default; customer before list-wide inside root; depth-first fallback; stable tie-break; cycle reject; no global scan or legacy fallback | §29.6.3, §29.40 | implement decision table literally; unresolved is `PRICE_NOT_CONFIGURED` | every decision-table row; fallback cycle; corrupted tie; product legacy price cannot rescue new resolve |
| F4 — floating/ambiguous discount | SC21..SC23; UAT-S-09 | bps/cents only; LINE filters separated from order-level HEADER; greatest rule version only; server-canonical pricing input; unchanged HALF_UP/largest-remainder algorithm | §29.7.1–5 | HEADER has no material/UoM/break; no historical-version fallback; client price evidence is assertion only | DB/backend HEADER rejection; current/disabled/inapplicable-version cases; canonical price mismatch; percent/fixed, allocation, edge and override cases |
| F5 — API / permission / audit ambiguity | SC19/SC109/SC114; P1/P3/P5 | POST-only zero-write resolvers; exact three-permission five-role matrix; atomic lifecycle audit; A-21 replay; no override log | §29.31.2–3, §29.33, §29.35 | exact endpoint/method and authority; manage/override independent; preview never writes | positive/negative matrix for five roles; resolver DB diff = zero; activate/retire audit rollback/replay/payload mismatch |
| F6 — MySQL additive reconciliation gap | S19/S20; SQLite/MySQL acceptance | target-first five-table creation; <=4-column inline entry UNIQUE; two nullable fields and named real MySQL FKs; preserve rows; mismatch fail-closed | §29.41–43, §30.8, §30.12 | fresh/upgrade/repeat converge without Adapter or generated-index changes | SQLite PRAGMA + MySQL information_schema ordered UNIQUE/FK/CHECK assertions; no `__partial_*`; duplicate probes and row-count preservation |
| F7 — Wave-plan/UI/acceptance inconsistency | mobile-first governance; UAT-S-04..09; S19/S20; R-SAL-11 | contextual sub-page/no top-level route/four-width matrix; Wave 2 proves config/resolvers/evidence while Wave 4 persists SO snapshot and completes race proof | §29.6.4, §29.7.5, §29.43 R-SAL-11, §30.2/11/17 | no UI implementation or SO schema/writer in Wave 2; no premature R-SAL-11 PASS | route/launcher/four-width acceptance later; Wave-2 UAT-S-04..09 + structural R-SAL-11; Wave-4 persistence/write-once/concurrency test |

Closure count for this reopen: original findings `7/7` resolved; authorized correction workstreams A–H `8/8` covered; Wave-2 new tables `5/5`; existing-table fields `2/2`; permission codes `3/3`; frozen roles mapped `5/5`; UAT allocated `6/6` (`UAT-S-04..09`); unresolved design decisions `0`; `TBD = 0`. This is a design gate only: implementation remains prohibited until external approval.

### 29.8 Sales Order Canonical Model

#### 29.8.1 Lifecycle

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
+ 设计上叠加 (controlled hybrid) 商业 fulfillment projection:
  REMAINING_OBLIGATION_PARTIAL (no persisted state; derived)
  REMAINING_OBLIGATION_FULL_DONE (no persisted state; derived)
  CLOSED_COMMERCIALLY (persisted via SC43, requires explicit close action)
  CANCELLED_COMMERCIALLY (persisted via SC44, requires explicit cancel)
```

> `CLOSED_COMMERCIALLY` 与 `CANCELLED_COMMERCIALLY` 是 persisted state in `sales_orders.commercial_status`；FROZEN lifecycle status (DRAFT/SUBMITTED/APPROVED/REJECTED) 与商业 close state 是两个 orthogonal dimensions（不 mix）。

#### 29.8.2 Schema Additive

`sales_orders` 新 additive columns：

```text
order_date                       (date — already from v13-phase1)
requested_delivery_date          (date — already)
payment_terms, payment_terms_days (already)
ship_to_contact_name, ship_to_phone, ship_to_address (already)
salesperson_id                    (NEW — FK salesperson_profiles.id nullable)
sales_group_id                    (NEW — FK sales_groups.id nullable)
settlement_party_id              (NEW — FK customers nullable)
payer_id                         (NEW — FK customers nullable)
customer_material_xref_id        (NEW — FK customer_material_xref nullable)
commercial_pricing_uom_code      (NEW — resolved commercial pricing UoM snapshot)
commercial_tax_code              (NEW — derived from extension)
tax_inclusive                    (NEW — bool nullable)
required_prepayment_cents         (NEW — int nullable, 0 means none)
reservation_intent_state         (NEW — enum: 'NONE'|'REQUESTED'|'GRANTED'|'RELEASED')
gift_summary_cents                (NEW — sum of is_gift_line amount_cents)
commercial_close_state           (NEW — 'OPEN'|'PARTIAL_DONE'|'CLOSED'|'CANCELLED')
```

`sales_order_items` 新 additive columns：

```text
is_gift_line                   (NEW — bool default false)
commercial_tax_basis           (NEW — varchar code nullable; commercial only,
                                not statutory invoice tax)
tax_inclusive_assumption       (NEW — bool nullable)
pricing_uom_code_applied       (NEW)
qty_break_applied_min           (NEW REAL nullable)
qty_break_applied_max           (NEW REAL nullable)
planned_delivery_date           (NEW DATE nullable; one-schedule-per-line identity = sales_order_items.id)
upper_delivery_tolerance_bps    (NEW INTEGER nullable; CHECK >= 0)
lower_delivery_tolerance_bps    (NEW INTEGER nullable; CHECK 0..10000)
price_snapshot_json             (NEW TEXT/JSON nullable for legacy; mandatory non-empty canonical evidence for Batch A new lines)
discount_snapshot_json          (NEW TEXT/JSON nullable for legacy; mandatory non-empty canonical evidence, including explicit zero discount)
```

> 不破坏 existing rows；legacy rows 缺新字段为 NULL，行为为 PARTIAL compatibility。

#### 29.8.3 Commercial Party Snapshot

SO create 时将 `customer_commercial_extensions` 当前 effective record 冻结进 SO header snapshot columns（per §29.4.4）。Effective dating 通过 `effective_from / effective_to` 在 `customer_commercial_extensions` 表本身表达；SO 时序上不再 re-evaluate。

#### 29.8.3.1 SC30 Delivery Schedule + SC08 Tolerance Snapshot

现有 B3102 可读证据只证明交货计划/交货日期与超交、欠交控制，未证明一个 SO line 必须支持多个 schedule。bounded baseline 因而采用 **line-level single schedule snapshot**，不虚构 dedicated `sales_order_delivery_schedules` relation：`sales_order_items.id` 同时是 source-line identity 与该行唯一 schedule identity；`planned_delivery_date` 可由 header `requested_delivery_date` 默认，但最终逐行存储。

在 SO create/approval（以首次形成 APPROVED immutable obligation 为最终冻结点）从 A-61 默认值解析并写入 line snapshot；审批后不得由 later master/default change 重算。只有 SC37–SC40 controlled SO Change 可对**未执行剩余量**产生新 effective version，且保留 before/after/reason/audit；已经 notified/delivered 的历史不改写。

```text
base_qty                = sales_order_items.quantity in Sales UoM
upper_tolerated_qty     = base_qty × (10000 + upper_delivery_tolerance_bps) / 10000
lower_tolerated_qty     = base_qty × (10000 - lower_delivery_tolerance_bps) / 10000
```

quantity 使用现有 deterministic decimal/quantity convention 做整数刻度或数据库精确十进制运算，统一舍入规则后比较；禁止 binary-float 临界比较。Sales/Pricing UoM 不同则先通过 canonical `product_uom_conversions` 归一至 Sales UoM；缺 conversion 时 backend BLOCK。

- Delivery Notice（Wave 5）在 source-line lock 内重读 `SUM(active notified qty)`，新累计值超过 `upper_tolerated_qty` 时 BLOCK，失败副作用为零。
- Sales Delivery（Wave 5）在同一 transaction 内重读 DN/SO source capacity，`SUM(confirmed delivered qty)` 超 upper bound 时 BLOCK，失败副作用为零。
- 正常完成点仍是 ordered `base_qty`。若 delivered qty 已达到 lower bound，可通过显式 controlled close 豁免 remainder，必须记录 reason、actor、before/after 与 audit；低于 lower bound 不得标记 fulfilled，必须用 controlled change/cancel 处理剩余义务。
- `delivery_schedule_enabled` / `delivery_quantity_control_enabled` 按 A-65 SYSTEM/DOCUMENT_TYPE resolution 执行；配置关闭不删除已批准快照，也不重写历史。

#### 29.8.4 Commercial Tax-Basis Assumption Snapshot

Requirement SC27 / SC28 / RC-24:

```text
SO Header column commercial_tax_code  — commercial tax code (nullable)
SO Header column tax_inclusive         — bool (nullable)
SO Item column commercial_tax_basis    — commercial tax-basis assumption per item
SO Item column tax_inclusive_assumption
```

> Tax Snapshot 是 commercial assumption 持久化；statutory invoice tax truth 仍归 Finance Operations canonical `sales_invoices` + `account_role_mappings`。Sales 不 mirror statutory tax ledger；Sales 不 compute invoice tax。

#### 29.8.5 Compatibility

- Legacy Sales Orders without commercial parties / tax-basis / prepayment / reservation_intent: SO business 显示 `(legacy)` 标记；不 fabrication 商业事实。
- 任何 historical modification：禁止 retro-rewrite；只允许 forward-only SO Change (SC37..SC40)。

### 29.9 Sales Order Change Technical Design

#### 29.9.1 物理对象

`sales_order_changes` (NEW #29) + `sales_order_change_lines` (NEW #30) + `sales_order_change_state_machine`：

```text
sales_order_changes:
  id, change_no (UNIQUE), sales_order_id (FK),
  change_path (CHECK IN 'CONTROLLED_DIRECT','CONTROLLED_DOCUMENT'),
  state (CHECK IN 'DRAFT','SUBMITTED','REJECTED','CANCELLED','APPLIED'),
  reason_code (enum), reason_text,
  before_snapshot_hash, after_snapshot_hash,
  base_effective_version, target_effective_version,
  parameter_scope_key, parameter_snapshot_hash, order_change_mode_snapshot,
  request_idempotency_key, application_idempotency_key,
  requested_by, requested_at,
  approver_id, approved_at, applied_by, applied_at,
  created_at

sales_order_change_lines:
  id, change_id (FK), line_no,
  op ('ADD','MODIFY','CANCEL'),
  sales_order_item_id (FK; NULL for ADD),
  before_values_json, after_values_json, qty_delta, amount_delta,
  delivered_before_qty, delivered_after_qty,
  constraint_check_result
```

#### 29.9.2 约束 (R-SAL-07 / R-SAL-08 + SC40 invariant)

```text
applied rule:
- both paths call the same canonical `applySalesOrderChange(change_id, expected_base_version, idempotency_key, actor)` service
- no field may be changed below an already executed/notified/reserved/recognized fact
- qty cannot be reduced below SUM(sales_delivery_items.qty for so_item)
- planned delivery schedule 不能 reduce below already-notified Delivery Notice
- prepayment requirement 边界 由 prepayment_gate re-evaluation (§29.16)
- credit 边界 by SC95 + R-SAL-24 (re-evaluate against current policy snapshot)
- pricing snapshot 不变 (R-SAL-11)
- historic price/discount 字段 never overwritten (SC40)
- executed inventory/finance history NOT touched; reversal/credit mechanisms
  走 frozen-domain adapters
- source customer/quotation/SO/line identity cannot be reassigned; ADD lines receive new identity
- `BOTH` only enables both request entry paths; it never changes authorization, approval, validation or lock rules
```

#### 29.9.3 Effective Versioning

`sales_orders` 增加物理列 `effective_version INTEGER NOT NULL DEFAULT 1 CHECK (effective_version >= 1)`（MySQL 使用等价 `INT` 约束）。新建 SO 初始化为 `1`；Wave 4 additive migration 将全部 legacy SO（包括既有 APPROVED / 已履约订单）回填为兼容基线 `1`。该回填只建立未来并发锚点，不声称重建未知历史版本，也不生成虚假 change evidence。

SO header 的 `effective_version` 表示当前生效商业版本；A-33 的 `base_effective_version` 必须等于 request transaction 读取的当前值，`target_effective_version` 固定为 `base + 1`。既有 APPROVED 版本及其 before/after snapshot、A-33/A-34 evidence 均为只读历史；当前 SO 投影只能由 canonical `applySalesOrderChange` 推进，普通 create/edit/PATCH allow-list 不接受客户端写入 `effective_version`，也不得静默覆盖 APPROVED 历史。

每次成功 application 在同一 transaction 内重读并校验 `base_effective_version == sales_orders.effective_version`，且以 `UPDATE sales_orders ... WHERE id = ? AND effective_version = ?` 执行 compare-and-swap；affected row 必须恰为 `1`，否则以 409 stale 冲突回滚且零副作用。成功时 `effective_version` 恰好递增一次；拒绝、取消、失败和同一 idempotency key 的重放均不得递增。SQLite 使用 `BEGIN IMMEDIATE` 后执行相同 CAS；MySQL 先 `SELECT ... FOR UPDATE` 锁 SO header，再按既定顺序锁 change、affected lines 与 source-capacity anchors，并仍以 CAS 作为最终 stale guard。

版本 CAS、未执行 remainder 更新、A-33/A-34 APPLIED append-only evidence、approval decision、idempotency record 与 audit 必须在同一 application transaction 原子提交。任一步失败全部回滚。已通知/已交付/已保留/已确认收入数量，以及既有 Inventory、Finance 和 source relations 只读受保护，不随版本推进而改写；参数改变也不得重解释或追溯改写历史 APPLIED evidence。

#### 29.9.4 Approval workflow

SO Change belongs to SALES_ORDER approval family (current Platform)。两条路径差异只在 authoring surface：

- `CONTROLLED_DIRECT`：从 APPROVED SO 发起；不提供可长期编辑的独立变更单 UI，但在 request transaction 中立即创建 A-33/A-34 immutable draft evidence，并创建 Platform approval request。
- `CONTROLLED_DOCUMENT`：先创建可编辑的 DRAFT change document，submit 后冻结内容并创建 Platform approval request。
- `BOTH`：允许上述两种 request；direct permission 不能调用 document-only command，document permission 也不能调用 direct-only command。requester 不能批准自己的 request；只有独立 approval authority 可进入 canonical application。

State machine：

```text
CONTROLLED_DIRECT:   SUBMITTED → APPLIED
                              ↘ REJECTED / CANCELLED
CONTROLLED_DOCUMENT: DRAFT → SUBMITTED → APPLIED
                                      ↘ REJECTED / CANCELLED
```

Request transaction：resolve mode + RBAC，读取当前 SO/version，canonicalize before/after，写 A-33/A-34、parameter snapshot、request idempotency evidence、approval request 与 audit；不改变 SO。

Approval/application transaction：

1. RBAC/SOD 校验独立 approver；lock approval request、SO header、change row，再按 ID 排序 lock affected SO lines/source-capacity anchors；
2. 重读 SO effective version、delivered/notified/reserved facts、Inventory/Finance source relations、当前 effective parameter 与 credit/prepayment constraints；
3. 校验 path 在 request snapshot 与当前 mode 中均允许，且 before hash / base version 未 stale；
4. 以 application key `SO_CHANGE_APPLY:<change_id>:<target_version>` 写 A-21 idempotency guard；
5. 调用唯一 `applySalesOrderChange`，仅更新未执行 remainder；同步写 version、APPLIED evidence、approval decision 与 audit；
6. commit 后新版本生效。任一校验/adapter/audit 失败则整笔 rollback，approval 不得独立变成成功。

SQLite 使用 `BEGIN IMMEDIATE`；MySQL 使用上述 deterministic `SELECT ... FOR UPDATE` 顺序。R-SAL-07 覆盖 approve/change 序列化，R-SAL-08 覆盖 Change vs direct Sales Delivery，R-SAL-18 覆盖 Change vs Delivery Notice；既有三个 Race ID 已覆盖本决策，不新增 Race ID。

若 SO Change 涉及 credit / prepayment / reservation，additional gate evidence 必须由 §29.16 + §29.17 + §29.25 提供并纳入同一 application transaction。

#### 29.9.5 DR-SAL-01 approved mode boundary

DR-SAL-01 Option A 已由用户正式批准：

- `DISABLED`：两条路径均 backend BLOCK；
- `CONTROLLED_DIRECT`：只接受 direct request；
- `CONTROLLED_DOCUMENT`：只接受 formal change document；
- `BOTH`：接受两条路径，但不能借另一入口绕过 permission/approval/SOD。

两条路径共享 A-33/A-34 evidence、canonical application service、lock order、idempotency namespace、audit 与 version rules；四模式决策不新增物理表，但 canonical version contract 要求在既有 A-02 增加一个 `effective_version` 字段。SC37..SC40 / UAT-S-15 的设计决策缺口已闭合；外部评审已 PASS，用户 Freeze approval 已确认，本 Technical Design 正式 `PASS / FROZEN`。

### 29.10 Sales Order Fulfillment / Close Lifecycle

#### 29.10.1 Design 决定（controlled hybrid）

本 Design 采用 **controlled hybrid**：

```text
A. PERSIST commercial_close_state (列) ONLY on completion:
     OPEN → COMMERCIALLY_CLOSED
     OPEN → COMMERCIALLY_CANCELLED
   (semantic state change requires explicit user action; partial fulfillment
    does not persist state transitions)
B. PARTIAL fulfillment state is DERIVED from:
     sales_deliveries.sales_order_id × sales_order_items.quantity
     vs sales_deliveries 聚合
     (no persisted 'partially fulfilled' bit)
C. REMAINING_OBLIGATION_FROZEN: never overwritten in place; period close and
   finance close NEVER depend on SO closure. SO closure is a Sales-side
   projection only.
```

#### 29.10.2 Effective Identity

```text
Sales commercial close_state = persisted in sales_orders.commercial_close_state
                                   ('OPEN' | 'PARTIAL_DONE' | 'CLOSED' | 'CANCELLED')
PARTIAL_DONE = derived (no persisted bit); triggers if
              SUM(deliveries.confirmed) > 0 AND SUM(deliveries.confirmed) < ordered_qty
CLOSED = persisted via explicit action + completed check
CANCELLED = persisted via explicit action + reason + audit
```

### 29.11 Delivery Notice Technical Design

#### 29.11.1 物理对象

`delivery_notices` (NEW #31) + `delivery_notice_lines` (NEW #32)：

```text
delivery_notices:
  id, notice_no (UNIQUE), sales_order_id (FK),
  state ('DRAFT','CONFIRMED','CANCELLED','CLOSED'),
  warehouse_id (FK), ship_to_snapshot_json,
  planned_delivery_date, business_date,
  customer_id, customer_snapshot,
  creator_id, created_at,
  confirmed_at, confirmed_by

delivery_notice_lines:
  id, delivery_notice_id (FK), sales_order_item_id (FK),
  scheduled_qty (REAL),
  notified_qty (REAL; sum of all confirmed Sales Delivery referenced),
  cancelled_notified_qty (REAL; cancelled or reversed notice qty),
  remaining_notified_qty (GENERATED: scheduled - notified)
  PRIMARY KEY (delivery_notice_id, sales_order_item_id)
```

#### 29.11.2 链

```text
Sales Order
→ Delivery Notice (商业指令；不 mutate stock)
→ Sales Delivery (实际执行；consumes Delivery Notice remaining)
→ Inventory physical outbound (canonical V21)
```

#### 29.11.3 多 Sales Delivery 对同一 Delivery Notice

允许：同一 Delivery Notice 的同一 line 可以由多个 Sales Delivery 消费，按 `sales_delivery_items.delivery_notice_line_id` 加 references 累加 notified_qty。

#### 29.11.4 不 mutate inventory

Delivery Notice CONFIRM 不写 inventory；只写 delivery_notice_lines 自身 rows。

#### 29.11.5 容量 invariant (R-SAL-16 / R-SAL-17)

```text
scheduled_qty ≤ SO line qty (audit snapshot)
remaining_notified_qty = scheduled_qty - notified_qty (GENERATED)
delivery_notified_qty ≤ scheduled_qty
sales_delivery_items (for this DN line) qty ≤ remaining_notified_qty
```

Locking: Sales-Delivery confirm 必 lock both:
1. `sales_delivery_items source_line_identity` (for SDD capacity)
2. `delivery_notice_lines remaining_notified_qty` (for DN capacity)

→ SQLite `BEGIN IMMEDIATE`; MySQL `SELECT … FOR UPDATE` on both targets before compute and write.

### 29.12 Sales Delivery Convergence

#### 29.12.0 Two truthful source paths for new Sales Delivery

Frozen Requirement permits both chains:

```text
Sales Order → Sales Delivery → Inventory physical outbound
Sales Order → Delivery Notice → Sales Delivery → Inventory physical outbound
```

Compatibility boundary:

| Compliance path | Legacy read | Legacy mutate (correction) | New write through legacy bypass |
|---|---|---|---|
| Legacy Sales Delivery (`source_mode` absent/backfilled `LEGACY_UNCLASSIFIED`) | YES | bounded (Policy §29.45 correction) | NO |
| New direct-order Sales Delivery | n/a | n/a | `source_mode=DIRECT_ORDER`; DN refs NULL; SO header/line refs mandatory |
| New notice-backed Sales Delivery | n/a | n/a | `source_mode=DELIVERY_NOTICE`; DN header/line refs mandatory |

Therefore the canonical new-flow invariant:

```text
NEW Sales Delivery after domain cutover MUST explicitly choose one source_mode.
DIRECT_ORDER uses existing sales_deliveries.sales_order_id and
sales_delivery_items.sales_order_item_id; DELIVERY_NOTICE additionally requires
delivery_notice_id + delivery_notice_line_id. Mixed modes in one SD are forbidden.
```

Direct delivery never creates a fake DN. Both paths lock the canonical SO line, recompute cumulative confirmed delivery against tolerance, execute credit/prepayment/reservation/OQC gates, call Inventory and Finance canonical adapters in the caller transaction, use the same confirm idempotency key, and write audit. Notice-backed flow additionally locks DN line capacity.

#### 29.12.1 Compatibility Design (legacy SDs read-only preserved)

```text
legacy SD row pre-cutover:
  source_mode = LEGACY_UNCLASSIFIED
  → read path allowed
  → correction path governed by Policy §29.45 only (no automatic fill-in)
  → no automatic source reinterpretation
new SD after cutover:
  source_mode IN (DIRECT_ORDER, DELIVERY_NOTICE), never LEGACY_UNCLASSIFIED
```

#### 29.12.2 Existing Invariants preserved

```text
- OQC gate (assertQualityGate 'OQC')
- Inventory canonical writer (applyInventoryMutation, postTrackedMovement)
- LOT/SERIAL tracking
- valuation / COGS (issueSourceValue)
- Finance recognition adapter (recognizeFinanceExposure auto Invoice if
  billing_mode = DIRECT_BILL; or post AR if LEGACY_DIRECT)
- Idempotency (idempotency-key on confirm)
- Audit (audit_logs entity_type='SALES_DELIVERY')
```

### 29.13 Sales Return Technical Design

#### 29.13.1 物理对象

`return_orders.source_type` 已存在 'PURCHASE' | 'SALES'；新增 commercial_source_marker column：

```text
return_orders.commercial_source_marker  -- NEW
  CHECK IN ('DELIVERY_BACKED', 'SO_BACKED', 'NO_SOURCE')

return_order_items.sales_order_item_id  -- NEW, NULLABLE
  FK → sales_order_items.id
  purpose = authoritative SO source-line identity for SO_BACKED only
```

(DESIGN alternative): 新建 `return_modes` 表；本 Design 选 column-additive 保持最小 invasive.

The line source-pair contract is exclusive for every new Sales Return write:

| Mode | `delivery_item_id` | `sales_order_item_id` |
|---|---|---|
| `DELIVERY_BACKED` | required | NULL |
| `SO_BACKED` | NULL | required |
| `NO_SOURCE` | NULL | NULL |

The canonical writer and confirm transaction validate the header marker and every line source pair before any inventory, valuation, Finance, success-audit or idempotency side effect. Mixed modes within one header, both identities populated, or a missing required identity fail closed with zero side effects.

#### 29.13.2 三种 mode

| Mode | Required source | Inventory effect | Finance effect | Audit |
|---|---|---|---|---|
| DELIVERY_BACKED (SC54) | `sales_delivery_items.id` | IN (applyInventoryMutation) | applyCreditAdjustment (DR AR / CR Sales Revenue voucher) | full audit |
| SO_BACKED (SC55) | `sales_order_items.id` persisted in `return_order_items.sales_order_item_id`; the line belongs to the referenced real SO, its SO customer equals the Return customer, its product equals the Return-line product, and no executed Sales Delivery exists for that SO line | real accepted IN through Inventory canonical writer; strict positive valuation plan only; no delivery-cost history may be fabricated from the SO line | canonical voucher DR inventory / CR `INVENTORY_GAIN_LOSS`; `applyCreditAdjustment` only when a separate authoritative Finance-side AR basis exists | full audit + explicit source marker and SO-line identity |
| NO_SOURCE (SC56) | no source sales row | real accepted IN through Inventory canonical writer; strict positive valuation plan only | canonical voucher DR inventory / CR `INVENTORY_GAIN_LOSS`; credit only with separate authoritative Finance-side AR basis, otherwise no credit | full audit + explicit `NO_SOURCE` marker |

#### 29.13.3 容量 invariant

```text
return_qty ≤ source_line_remaining_qty
R-SAL-03 source-line remaining holds
```

For `SO_BACKED`, capacity is keyed and locked by the real `sales_order_items.id`; it is never grouped by product/customer/date. Remaining capacity is the SO-line quantity less authoritative effective confirmed Return evidence for that same ID. DRAFT and CANCELLED Return headers do not consume capacity. Existing canonical `return_reversals` / `return_reversal_items` evidence reduces the effective confirmed quantity; this correction does not invent a `REVERSED` Return-header state or redefine the frozen reversal lifecycle.

#### 29.13.4 SO_BACKED guardrail

A `SO_BACKED` return must NOT automatically imply:

```text
- a fake Delivery
- a fake Invoice
- a fake AR row
```

It may record the commercial document. Any Inventory IN is executed only through the Inventory canonical writer and cannot derive nonexistent historical carrying cost or COGS from the SO price. Any Finance credit is conditional on an authoritative Finance-side basis and uses the Finance canonical adjustment primitive. Absence of either basis cannot be repaired by creating a fake Delivery, AR row, voucher, valuation source or shadow ledger.

#### 29.13.5 NO_SOURCE guardrail

```text
return_orders.commercial_source_marker = 'NO_SOURCE'
+ mandatory fields: customer_id, material_id, quantity, warehouse_id,
  reason_code, business_date, authorization_role.
+ NO automatic Finance credit; lawful inventory receipt + Option-A valuation
  voucher + audit remain independent from AR.
+ visible in Sales UI as "无来源销售退货" separate from DELIVERY_BACKED and
  SO_BACKED; not mergeable.
```

#### 29.13.6 Additive migration, compatibility and rollback

Future Wave 6 Implementation must add `return_order_items.sales_order_item_id` through the new Wave 6 migration only; no historical migration is edited.

```text
SQLite:
  additive nullable column + real FK metadata to sales_order_items.id;
  verify PRAGMA table_info / foreign_key_list.

MySQL 8:
  dialect-correct nullable column + named real FK constraint;
  verify information_schema.COLUMNS / KEY_COLUMN_USAGE /
  REFERENTIAL_CONSTRAINTS.

Required paths:
  fresh bootstrap;
  upgrade from the exact pre-Wave-6 schema;
  repeated migration / replay;
  row preservation and legacy NULL compatibility;
  fail closed on unexpected type, nullability, FK target or constraint conflict.
```

No migration may infer or backfill `sales_order_item_id` for historical rows, and no existing Return row may be rewritten merely to populate the new field. Rollback is compatibility-first: older application code may ignore the nullable column, while the column and any already-written source evidence remain in place. Dropping the column/FK or rewriting populated evidence is a separate destructive migration requiring dependency proof and explicit approval; it is not part of Wave 6 rollback.

#### 29.13.7 Option A valuation primitive contract — approved bounded correction

DR-SAL-04 approves the accounting policy that was left open by the second clarification. The three existing Finance valuation primitives remain non-interchangeable:

| Primitive / path | Authoritative value source | Sales Return use | Strict guardrails | Accounting / AR |
|---|---|---|---|---|
| `restoreSourceValue()` | exact POSTED outbound valuation movements of the referenced Delivery item | `DELIVERY_BACKED` only; unchanged | preserves existing original LOT/SERIAL cost matching and Batch-A legacy compatibility | existing Inventory debit / COGS credit and independently lawful Delivery-backed credit path remain unchanged |
| `receiveSourceValue()` | caller-owned explicit total value allocated across authoritative posted identities | not an HTTP/client value source; may be used only internally to apply an already locked and verified Option-A valuation plan | plan identity, quantity and cents must be revalidated; it cannot select a cost basis itself | no AR implication and no counterpart selection |
| strict Option-A adaptation of `receivePositiveSourceValue()` | `MOVING_AVERAGE` 使用 exact positive pool；`LOT` 使用 exact positive same-identity carrying pool；`SERIAL` 使用 §30.31 唯一 eligible original outbound valuation provenance；仅在 Requirement 明确允许且存在独立 approved/frozen/effective authority 时才可考虑 standard cost | `SO_BACKED` / `NO_SOURCE` only | `LEGACY_UNVALUED`, zero/default, client/manual, SO/Quotation price, fake Delivery cost、cross-identity pool 与 positive same-serial pool 均为 impossible branches | Inventory debit / existing `INVENTORY_GAIN_LOSS` credit; AR remains a separate Finance-owned decision |

The existing implementation is not yet strict enough for this path: it reads `products.standard_manufacturing_cost_cents` without approval/freeze evidence and may emit `LEGACY_UNVALUED` when valuation has not been activated. The `product_costs` table has only `ACTIVE/HISTORICAL`, creator and effective date; it has no approver/freeze evidence. Therefore neither carrier currently proves the DR-SAL-04 standard-cost condition. Wave 6 must keep the standard-cost fallback unavailable and return HTTP 409 after an exact positive pool miss. It must not infer approval from `ACTIVE`, a positive field, an audit CREATE row, or a product value. Enabling that fallback requires a pre-existing authoritative Master/Finance approval-and-freeze contract; if none is available, a separately approved cross-domain Requirement/Design change is required. Wave 6 adds no approval field, status or shadow evidence.

The strict adaptation is additive and caller-scoped so existing inventory-adjustment/count behavior is not silently changed:

```text
resolvePositiveSourceValuePlan(db, input, policy = SALES_RETURN_OPTION_A)
  -> read/lock every exact valuation identity before any Return write
  -> return immutable in-transaction line/allocation plan with basis + cents

receivePositiveSourceValue(db, input, resolvedPlan,
                           policy = SALES_RETURN_OPTION_A)
  -> revalidate plan identity/quantity/positive cents under the same locks
  -> apply only the resolved plan through receiveValue()
  -> never enter LEGACY_UNVALUED or raw product-standard-cost fallback
```

The names describe responsibilities rather than a second ledger or new persistence object. Implementation may factor the resolver inside `financial-inventory.js`, but the public Sales handler cannot accept a cost, basis, unit cost or valuation plan from the client.

Valuation validation is exact and performed for the complete Return before physical mutation；本段由 §30.31 对 LOT/SERIAL/NO_SOURCE provenance 作有界 supersede：

- `MOVING_AVERAGE`: lock/read the balance keyed by the same `warehouse_id + product_id`; both quantity and value must be positive and the allocated inbound cents must remain positive.
- `LOT_SPECIFIC_POOL`: every accepted Return allocation must name the same real LOT identity and use only that exact warehouse/product/LOT positive carrying pool；Reverse 不再要求 aggregate pool 等于本次 Return movement，而使用 §30.31 conservative movement fence。
- `SPECIFIC_SERIAL`: every accepted serial must be unique for the request, match the Return product/warehouse identity, have no active in-stock duplicate, and resolve exactly one eligible original `SALES_DELIVERY_COGS` outbound valuation movement plus its tracked OUT evidence；current positive same-serial pool is never valuation authority.
- `NO_SOURCE` commercial identity remains independent from valuation provenance. It may bind the bounded immutable provenance carrier in §30.31 without acquiring SO/Delivery commercial source identity；missing or ambiguous provenance fails 409.
- A required pool/provenance with zero/negative quantity, zero/non-positive value, incompatible valuation method, missing tracking allocation or mismatched identity is not eligible. It cannot fall through to `LEGACY_UNVALUED` or standard cost.
- All lines are planned against the transaction-start locked authority snapshot. Value written by an earlier line in the same Return cannot become the authority for a later line.

#### 29.13.8 Warehouse acceptance and atomic confirm flow

`sales_return_canonical_writer` owns the Return mode, source and state; it delegates physical truth to the existing Inventory canonical mutation boundary. “Warehouse acceptance” is the successful mode-aware Inventory validation and posting inside confirm, not a Sales-side stock update and not a pre-confirmed external fact.

```text
POST /api/sales-returns/:id/confirm + Idempotency-Key
  1. authorize RETURNS_MANAGE; open canonical transaction; acquire idempotency scope
  2. lock DRAFT return header and all lines in stable id order
  3. validate one header mode + exclusive line source pairs
  4. SO_BACKED: lock real sales_order_items.id anchors; recheck SO/customer/product,
     no executed Delivery condition, and effective confirmed-return capacity
  5. validate warehouse/product/tracking policy and the proposed LOT/SERIAL
     acceptance allocations without posting them
  6. assert Inventory and Accounting periods open on return_date
  7. for every SO_BACKED/NO_SOURCE line, lock and freeze one complete strict
     positive valuation plan; if any line lacks a legal basis -> HTTP 409
  8. invoke Inventory canonical tracking + quantity mutation using source identity
     SALES_RETURN, then apply the frozen valuation plan and bind movements to the
     resulting inventory_transaction_id / Return line
  9. build and post one balanced canonical inventory-value voucher for the Return
 10. independently resolve/apply an eligible Finance AR credit, if and only if a
     real matching authoritative Finance basis and existing contract permit it
 11. transition Return to CONFIRMED; write success audit and idempotency result
 12. commit
```

Steps 3–7 are mandatory preflight under the same transaction and locks as steps 8–11. The writer may call Inventory validation helpers before mutation, but cannot mark tracking allocations posted, adjust inventory, create an inventory transaction or valuation movement until every line and voucher prerequisite has passed. A failure at any later step rolls back all earlier writes. Existing independent failure/security logging may remain outside the business-success facts.

`DELIVERY_BACKED` takes a separate unchanged branch after the common mode/source validation: it locks the real Delivery line, posts the accepted physical return, calls `restoreSourceValue()` against exact outbound evidence, posts the existing COGS reversal, and applies credit only under its existing authoritative Finance contract. It never enters Option-A pool/standard-cost selection.

#### 29.13.9 Option A voucher and Finance AR boundary

The Option-A inventory-value voucher is a canonical Accounting artifact whose business source remains `SALES_RETURN`; it is not an Inventory Adjustment or historical Delivery reversal.

```text
per valued allocation/line:
  DEBIT  inventoryAccountRole(product_id)  = positive inbound value cents

per Return voucher:
  CREDIT INVENTORY_GAIN_LOSS               = sum of all positive inbound value cents
```

The writer resolves every inventory role through `inventoryAccountRole(product_id)` and the existing account-role mapping; it never hardcodes a subject id. Lines are deterministically grouped by resolved inventory role (and may carry line summaries), so multiple products and valuation methods produce the exact sum of their canonical movements. The single `INVENTORY_GAIN_LOSS` credit equals the total debit; all amounts are safe positive integer cents. Missing role mapping, an empty/zero entry set, unsafe cents, mismatch with valuation movements or debit/credit imbalance is HTTP 409 and rolls back confirmation.

The voucher is emitted exactly once through `createSystemVoucher()` (or the same canonical Accounting writer after factoring) with `sourceType='SALES_RETURN'` and `sourceId=returnId`. It must not collide with, overwrite or masquerade as `SALES_RETURN_COGS`, Sales Revenue reversal, Delivery or Inventory Adjustment. If the current writer's `(source_type, source_id)` uniqueness cannot represent both this Return inventory event and a separately lawful Finance credit event, the credit branch must use its existing Finance-owned event identity or fail closed; it must not rename the Return business source or overwrite the inventory voucher.

Inventory valuation and Finance AR are resolved independently. The Return handler does not call `ensureReceivableSource()`, create an Invoice/Open Item/Revenue/Delivery, or synthesize a COGS reversal for Option A. It may call `applyCreditAdjustment()` only after locking and revalidating a real matching Finance-owned AR/Open Item basis for the same customer and permitted amount under the existing contract. “No AR basis” means skip the optional credit branch and still commit the lawful inventory receipt. “Basis exists but Finance validation/writer fails” means the transaction fails and all Option-A effects roll back.

#### 29.13.10 Idempotency, lock order and failure contract

The confirm endpoint uses the existing `idempotency_records` contract with operation namespace `SALES_RETURN_CONFIRM`, document id = Return id, and a fingerprint covering action plus authoritative request fields. Same key/same payload replays the committed result; same key/different payload is 409; no success record is saved before all effects succeed. The Return status lock also prevents a second key from confirming the same document twice.

Canonical lock order is deterministic:

```text
idempotency scope -> return header -> return lines (ascending id)
-> mode source lines (ascending real SD/SO line id)
-> tracking identities / Inventory positions (canonical key order)
-> valuation balances (balance_key order)
-> optional Finance AR/Open Item locks (canonical Finance order)
-> voucher source identity
```

SQLite uses the encompassing write transaction; MySQL uses independent-session row-lock evidence. Every capacity and valuation aggregate is re-read under its anchor lock. Failure leaves Return state, Inventory quantity, tracking, valuation movements/balances, voucher/GL, AR/Credit Adjustment, success audit and success idempotency evidence unchanged. This is also required for period closure, missing account role, duplicate serial, stale capacity, writer error and deadlock/loser retry.

#### 29.13.11 Sales Return Reversal — Option C Restricted Economic Reversal (`SO_BACKED` / `NO_SOURCE`)

DR-SAL-04 (Option A) governs confirm-time valuation + accounting; DR-SAL-05 (Option C) governs the bounded post-confirm reversal of `SO_BACKED` and `NO_SOURCE` confirmed Returns. This sub-section is the technical contract for Option C; it does NOT touch DELIVERY_BACKED, existing `reverseOperationalReturn()`, Batch A, Option A confirm-time valuation, or Replacement immutable fulfillment evidence.

##### 29.13.11.1 Mode-aware dispatch (one endpoint, two branches)

`POST /api/sales-returns/:id/reverse` resolves once at handler entry to one of two branches; mixing modes inside a single transaction is impossible by design.

```text
1. authorize RETURNS_MANAGE; parse body; open the mode-dispatch transaction/read boundary
2. SELECT commercial_source_marker FROM return_orders WHERE id=? FOR UPDATE
   (SQLite: implicit write-tx serialization)
3. switch (header.commercial_source_marker):
   case DELIVERY_BACKED:
     -> delegate to existing reverseOperationalReturn()  unchanged
   case SO_BACKED:
   case NO_SOURCE:
     -> require explicit non-empty Idempotency-Key header; missing -> HTTP 400
     -> acquire SALES_RETURN_REVERSAL_OPTION_C scope; continue §29.13.11.2..8
   default (UNKNOWN / NULL / unexpected):
     -> HTTP 409 (拒绝冲销: 未识别或缺失 mode marker)
```

`reverseOperationalReturn()` (in `server/modules/financial-controls.js`) is preserved verbatim, including its existing idempotency contract; Option-C's mandatory header is enforced only after the locked marker selects `SO_BACKED` / `NO_SOURCE`. A future bounded adapter may factor out side effects, but DELIVERY_BACKED must not gain or lose any current observable behavior. A mixed-mode or unknown-marker Return cannot be reversed: HTTP 409 with explicit reason; there is no silent fall-through to a default branch.

##### 29.13.11.2 Gate-A — Replacement Dependency (canonical fulfillment evidence only)

```text
per return_line_id:
  # 1. 必须先以真实 fulfillment evidence 为权威
  SELECT rf.* FROM sales_replacement_fulfillments rf
  JOIN sales_order_replacement_lines rl ON rl.id = rf.replacement_line_id
  WHERE rl.source_return_item_id = return_line.id

  if any row -> A.3 HTTP 409 整体回滚
    (不得删除 fulfillment; 不得改写已确认 Delivery;
     不得伪造 Delivery reversal; 不得将已履行数量改写为零;
     不得静默恢复原 SO executed history;
     这里 fulfillment evidence 是 canonical truth, 不得
     因 header.cancellation_state='FULFILLED' / 'CANCELLED' 而绕过)

  # 2. 没有 fulfillment evidence 时,才检查 header 取消状态
  #    任何 partial 或 fully-fulfilled 状态都已被上面 A.3 捕获,
  #    所以此分支 effective_fulfilled = 0 恒真。
  if no fulfillment row:
    SELECT rl.id, rl.replacement_quantity, sr.cancellation_state
    FROM sales_order_replacement_lines rl
    JOIN sales_order_replacements sr ON sr.id = rl.replacement_id
    WHERE rl.source_return_item_id = return_line.id
    # LEFT JOIN rf has no rows here by definition of the outer guard
    GROUP BY rl.id, rl.replacement_quantity, sr.cancellation_state

    for each rl row:
      if sr.cancellation_state = 'ACTIVE':
        -> A.2 HTTP 409 (ACTIVE + effective_fulfilled (==0) < replacement_quantity;
                          必须先经正规业务流程取消剩余补货义务)
      if sr.cancellation_state = 'CANCELLED':
        -> A.4 通过; continue Gate-B
      else:
        -> HTTP 409 (header state 未知)

  # 3. 完全没有 Replacement obligation
  if no rows at all:
    -> A.1 通过; continue Gate-B
```

判断必须基于 `sales_replacement_fulfillments` 真实 join 的 row-level evidence, **不得**仅依赖 `sales_order_replacements.state` / `cancellation_state` 等可编辑 lifecycle 字段;任何 partial / fully-fulfilled 状态都已被 A.3 捕获 (在 Step 1 提前 409),不会到达本步 effective_fulfilled 求值,故不再需要 "fully fulfilled → 通过" 的兜底条款 (DR-SAL-05 明确禁止这种绕过). R-SAL-10 既有 canonical lock identity (`return_order_items.id` + `sales_order_replacement_lines.id` + `sales_delivery_items.id`) 继续负责 Replacement ↔ Return 序列化.

##### 29.13.11.3 Gate-B — Downstream Consumption Proof (canonical evidence, strict fail-closed)

Goal: prove that the original Option A inbound quantities + value cents can still be EXACTLY reversed without recomputing sale price / current standard cost / current average cost. `current_inventory_quantity >= return_quantity` is **not** sufficient evidence; shared valuation pool's current balance alone is also not sufficient for MOVING_AVERAGE.

Per Return line, locked canonical reads in order:

```text
M0 identity anchors
   - product_id, warehouse_id, lot_id (or NULL), serial allocation set (or NULL)
   - business_date (must be inside open Inventory + Accounting periods)

M1 locate original POSTED positive valuation movements
   SELECT * FROM inventory_valuation_movements
   WHERE source_type='SALES_RETURN' AND source_id=? AND source_item_id=?
         AND quantity_delta > 0 AND status='POSTED'
   ORDER BY created_at, id
   if empty -> HTTP 409 (原入库缺少权威估值事件)

M2 identity/method exact-reverse feasibility proof
   for each m in originals:
     if lot_id IS NULL AND serial_id IS NULL AND product valuation method='MOVING_AVERAGE':
       lot_id IS NULL AND serial_id IS NULL
       -> MOVING_AVERAGE_GUARD (strict)
     elif lot_id IS NOT NULL AND serial_id IS NULL AND product valuation method='LOT_SPECIFIC_POOL':
       lot_id IS NOT NULL
       -> LOT_GUARD
     elif serial_id IS NOT NULL AND product valuation method='SPECIFIC_SERIAL'
          AND exactly one §30.31 provenance row exists:
       serial_id IS NOT NULL
       -> SERIAL_GUARD
     else:
       -> HTTP 409 (method/identity/provenance marker 未知或不一致,不得推断)

M3 duplicate-reverse guard
   for each m in originals:
     SELECT COUNT(*) FROM inventory_valuation_movements
     WHERE reversal_of_id=m.id AND status='POSTED'
     if > 0 -> HTTP 409 (已被冲销)
```

**MOVING_AVERAGE_GUARD (strict fail-closed)**

```text
the SHARED pool's value may have been partially consumed by subsequent issuances
or losses; exact-value reverse requires proof that no downstream valuation
movement has reduced this specific pool since the original Return's inbound.

strict_negative_post = SELECT COALESCE(SUM(quantity_delta),0)
   FROM inventory_valuation_movements
   WHERE product_id = m.product_id
     AND warehouse_id = m.warehouse_id
     AND lot_id IS NULL AND serial_id IS NULL
     AND quantity_delta < 0                                    -- 任意下游净消耗
     AND status IN ('POSTED')
     AND created_at > m.created_at                             -- 严格晚于原始 Return 入库
     AND inventory_transaction_id <> m.inventory_transaction_id -- 排除原始自身 transaction
  # 注意: 不依赖 movement_type LIKE 通配, 因 LIKE 容易漏掉
  # INVENTORY_ADJUSTMENT_LOSS / INVENTORY_COUNT_SHORTAGE / INVENTORY_SCRAP /
  # SALES_DELIVERY_COGS 等真实存在的负 quantity_delta movement_type;
  # canonical 谓词是 quantity_delta < 0 同一 (product, warehouse, lot NULL, serial NULL),
  # 这是 MOVING_AVERAGE 实际减少池容量的唯一充分判据.

if strict_negative_post < 0:
  -> HTTP 409 (downstream consumption breaks exact-value reverse)
  不得仅凭 current_pool.quantity >= m.quantity_delta 与
  current_pool.value_cents >= m.value_delta_cents 通过:
  MOVING_AVERAGE cannot strictly prove the original value block is intact
  without recomputing the average or back-tracking per-inbound provenance,
  both forbidden by DR-SAL-05.

# 排除原始 Return 自身 transaction 引发的连带 valuation 借方 (例如同一 RETURN
# 的 COGS_REVERSAL 镜像, 如果 Option A confirm 时同 transaction 已发出)
# 上面 inventory_transaction_id <> m.inventory_transaction_id 已保证。

additional duplicate-reverse check:
  SELECT COALESCE(SUM(-value_delta_cents),0) FROM inventory_valuation_movements
  WHERE reversal_of_id=m.id AND status='POSTED'
  if > 0 -> HTTP 409 (已被冲销)
```

**LOT_GUARD (strict)**

```text
identity = exact (product_id, warehouse_id, lot_id); NULL/wrong identity -> 409.
original Return authority = the exact POSTED positive SALES_RETURN movement m,
its real inventory_transaction_id, and its unreversed quantity/value.

current sufficiency (necessary, never sufficient by itself):
  balance = locked inventory_valuation_balances row for identity
  lot_balance = locked inventory_lot_balances row for identity
  require valuation_method='LOT_SPECIFIC_POOL'
  require balance.quantity >= unreversed_return_quantity
  require balance.value_cents >= unreversed_return_value_cents
  require lot_balance.quantity >= unreversed_return_quantity

negative-movement frontier:
  reject if any POSTED inventory_valuation_movements row for the exact identity
  has quantity_delta < 0, differs from m.inventory_transaction_id, and:
    created_at > m.created_at, OR created_at = m.created_at.
  The equality branch is deliberately conservative: timestamp ties are treated
  as ambiguous/post-frontier and reject; UUID/id ordering is never used as a
  causal clock. The same rule applies to tracked_inventory_movements OUT rows.

dependency proof under the same locks:
  - active inventory_locks on the exact position_key -> 409;
  - active ON_HAND planning_reservations for product/warehouse cannot identify
    LOT, therefore any such row is an unresolved dependency -> 409;
  - any post-Return INVENTORY_TRANSFER OUT/MOVE or other tracked OUT -> 409;
  - HOLD is allowed only when it is the unchanged Return-created HOLD state;
    any later tracked_identity_hold_history action is a dependency -> 409;
  - unknown source/status, missing canonical position, or disagreement among
    physical position, lot balance, tracking and valuation -> 409.

aggregate balance equality is forbidden as a gate. OUT then replenishment still
rejects because the negative frontier is append-only even when current quantity
and value again appear sufficient. No general inventory layer allocation is added.
```

**SERIAL_GUARD (strict)**

```text
Confirm-time authority is the unique eligible original outbound pair, never the
current positive same-serial pool:
  outbound valuation: POSTED, quantity_delta=-1, value_delta_cents<0,
    movement_type='SALES_DELIVERY_COGS', source_type='SALES_DELIVERY',
    exact product/warehouse/serial and real inventory_transaction_id.
  outbound tracking: exactly one unreversed tracked_inventory_movements OUT row
    with the same transaction/product/warehouse/serial and quantity=1.
  serial lifecycle before Confirm: DELIVERED, current_warehouse_id IS NULL;
    no AVAILABLE/HOLD row or other active in-stock duplicate for the identity.
  reversal/restoration history: outbound has not already supplied an active
    restoration; the selected evidence is unique after all filters, else 409.

Confirm restores exactly one unit and exactly -outbound.value_delta_cents through
one positive SALES_RETURN valuation movement. §30.31 provenance freezes the
selected outbound valuation/tracking identities and quantity/value in the same
transaction. SO_BACKED/NO_SOURCE commercial fields do not alter this authority.

Reverse requires the same provenance row, the one positive Return movement still
unreversed, serial still exactly once at original product/warehouse in
AVAILABLE/HOLD, quantity=1, and no later tracked OUT/MOVE, transfer, reservation,
lock, HOLD/RELEASE action or other dependency. It removes exactly that restored
unit and negates the Return movement/value. Missing, multiple, stale or conflicting
outbound candidates, already-restored/consumed evidence, lifecycle disagreement,
or legacy rows without deterministic provenance -> HTTP 409 with zero effects.
```

`reverseValuationSource()` (in `server/modules/financial-inventory.js`) reads by `(originalSourceType, originalSourceId)` and would also work as the actual movement step, but **does not** perform the per-basis strict MOVING_AVERAGE / LOT / SERIAL downstream-consumption proof required by Gate-B. The strict proof is added by this section as a precheck before any canonical reverse primitive is called.

##### 29.13.11.4 Gate-C — Exact Original Valuation Reverse (canonical primitive)

After Gate-A and Gate-B pass, one reverse per line uses the canonical primitive:

```text
result = consumeOriginalInboundValue(db, {
  productId, warehouseId, lotId, serialId,
  businessDate,
  quantity: original.quantity_delta,        // full reverse only
  originalSourceType: 'SALES_RETURN',
  originalSourceId: returnId,
  originalSourceItemId: return_line.id,
  sourceType: 'SALES_RETURN_REVERSAL',
  sourceId: reversalId,
  sourceItemId: return_line.id,
  movementType: 'INVENTORY_VALUATION_REVERSAL',
  createdAt,
})
# result: array of one or more paired reversal movements
#   - reversal_of_id   = original.id (per original)
#   - quantity_delta   = -original.quantity_delta      (full)
#   - value_delta_cents = -original.value_delta_cents (full)
#   - basis / lot_id / serial_id preserved verbatim
#   - inventory_transaction_id = same as original
# 任何 primitive 抛出的 409 都使整体 Option C transaction 回滚。
# Gate-B 是 contract, 保证该 primitive 在本上下文中安全调用。
```

Forbidden in this gate:
- LEGACY_UNVALUED / 任意零值 / 客户端手工值 / SO 或 Quotation 售价 / 假 Delivery COGS / 跨身份 pool allocation
- 按销售单价、当前平均成本或当前标准成本 recompute 历史金额
- 将同一商业金额重复分配到多条原始凭证分录
- 把一个原始 movement 拆给多个 reversal
- 多次部分冲销后再 "full reverse" (cumulative 已被 reverse > 0 即 409)

##### 29.13.11.5 Gate-D — Exact Original Voucher Reverse

The Option A confirm path wrote exactly one `accounting_vouchers` row keyed `(voucher_origin='SYSTEM', source_type='SALES_RETURN', source_id=returnId)`. Its entries debit `inventoryAccountRole(product_id)` per valued allocation and credit `INVENTORY_GAIN_LOSS`, every amount safe integer cents. Option C reverses that voucher without recomputation:

```text
1. original = SELECT * FROM accounting_vouchers
              WHERE voucher_origin='SYSTEM' AND source_type='SALES_RETURN'
                    AND source_id=? AND status='POSTED'
   if none                                  -> HTTP 409 (缺少原始凭证)
2. if any posted reversal voucher with reversal_of_id = original.id -> HTTP 409 (duplicate)
3. original_entries = SELECT * FROM accounting_entries WHERE voucher_id = original.id
                       ORDER BY line_no, id
4. reversal_entries = for each entry:
     subject_id   = entry.subject_id                       (verbatim)
     direction    = entry.direction == 'DEBIT' ? 'CREDIT' : 'DEBIT'
     amount_cents = entry.amount_cents                     (verbatim, safe integer)
     summary      = `冲销:${entry.summary || original.voucher_no}`
     line_no      = entry.line_no
5. reversal_voucher_id = createSystemVoucher(db, {
     sourceType:    'SALES_RETURN_REVERSAL',
     sourceId:      reversalId,
     reversalOfId:  original.id,
     remark, actorId, businessDate,
     entries:       reversal_entries,
   })
6. assert new voucher.status='POSTED' AND new voucher.period = original.period
```

Debit/Credit mirroring preserves exact original cents; voucher balance is verified inside `createSystemVoucher()` (canonical Accounting writer in `server/modules/financial-inventory.js:172`). No new account role, no new voucher type, no manual amount.

Forbidden:
- `return_quantity * sales_unit_price` as the reverse amount
- distributed commercial amount across multiple original lines / entries
- duplicating one original entry as multiple reversal entries
- changing `subject_id` of any entry
- posting outside an open Accounting period
- multiple reversal vouchers against the same original

DELIVERY_BACKED existing reverse path in `server/modules/financial-controls.js:371-373` continues to flip its DELIVERY_BACKED voucher separately; Option C writer does not touch that path.

##### 29.13.11.6 Gate-E — Optional Finance Credit Reverse

Independent branch on the existence of the `financial_credit_adjustments` row:

A. **No confirmed Credit exists**:

```text
SELECT * FROM financial_credit_adjustments
WHERE source_type='SALES_RETURN' AND source_id=returnId AND status='CONFIRMED'
if empty:
  - 不引用虚构 Credit
  - 不写 credit_reversal_components 行
  - 不访问不存在 target Open Item
  - 不调用虚假 AR refresh
  - 继续已合法的 Gate-A..D
```

B. **Confirmed Credit exists**:

```text
balance = SELECT id FROM settlement_unapplied_balances
          WHERE balance_type='CREDIT' AND source_id=credit.id

if balance is not null:
  already_consumed = COALESCE(SUM(amount_cents),0) over balance_applications
                     WHERE status='CONFIRMED'
                   + COALESCE(SUM(amount_cents),0) over financial_refunds
                     WHERE status='CONFIRMED'
  if already_consumed > 0:
    -> HTTP 409 (Credit 已被后续 application/refund 消费; 不得部分冲销)

reverseCreditAdjustment(db, 'AR', 'SALES_RETURN', returnId,
                        actor.id, businessDate, reason)
# canonical primitive (server/modules/settlement-core.js:165)
# flips status to 'REVERSED' and refreshes open item amount.
```

C. **Credit reversal fails** for any reason (writer error, period closed, status race, etc.): the entire Option C transaction rolls back; original Return and its evidence remain unchanged.

DELIVERY_BACKED existing reverse path uses its own credit gate at `server/modules/financial-controls.js:332-339`; Option C writer does not modify it.

##### 29.13.11.6.b Commercial Amount & NO_SOURCE Schema Constraint

`return_reversals.amount_cents INTEGER NOT NULL CHECK(amount_cents > 0)` 与
`return_reversal_items.amount_cents INTEGER NOT NULL CHECK(amount_cents > 0)`
在 `server/migrations/v13-phase6a-financial-controls.js:106-119` 中硬编码为严格正数,
这是 DELIVERY_BACKED 既有 reverse 路径在 `financial-controls.js:346` 写入的形状
(`quantity * original.unit_price_cents`, 总是 > 0).

Option C 对 NO_SOURCE 模式产生约束冲突: NO_SOURCE Return 没有 canonical 销售单价
(按 DR-SAL-04 + §29.13 / §29.13.5 / §30.29 的 "no fake source sale" 约束),
`return_order_items.unit_price_cents` 在 confirm 阶段即为 0/空, 反向冲销时
`quantity * 0 = 0`, 违反 CHECK(amount_cents > 0), 普通 INSERT 会被数据库拒绝.

DR-SAL-05 + Option C 商业合同的最小可行解:

```text
A. SO_BACKED: canonical 销售单价存在 (sales_order_items.unit_price_cents > 0),
   amount_cents = quantity * unit_price_cents, 与 DELIVERY_BACKED 既有行为一致,
   不需要额外 schema 修改, CHECK(amount_cents > 0) 自动满足.

B. NO_SOURCE: canonical 销售单价不存在 / 为 0,
   不得伪造 commercial amount,
   不得通过 (sales_order_items.unit_price_cents, SO price, Quotation price,
            average cost, current standard cost) 反推金额,
   唯一合规的做法是接受 NO_SOURCE reverse 写入 amount_cents = 0,
   需要把以下两个 CHECK 从 "严格正数" 放宽为 "非负整数分":

   ALTER TABLE return_reversals
     DROP CONSTRAINT (SQLite reproduction) / DROP CHECK chk_xxx (MySQL)
     AND re-ADD CONSTRAINT ... CHECK (amount_cents >= 0);
     # 同时 UNIQUE(reversal_no) 等不变.

   ALTER TABLE return_reversal_items
     SAME relaxation, CHECK(amount_cents >= 0);
     # return_reversal_items.quantity CHECK(quantity > 0) 保持不变,
     # 因为 quantity 始终是原 return_order_items.quantity (> 0), 与 amount_cents 解耦.

C. 回退兼容: DELIVERY_BACKED 既有 reverseOperationalReturn 写 amount_cents > 0,
   >= 0 的放宽对其保持 no-op, 不会引入回归.
```

如果该 CHECK 放宽被推迟 / 被拒绝, 那么 NO_SOURCE Option C reverse 实施就需要
引入第二套 evidence 表 (第二套 reversal 记录), 这等同于在仓库内增加新的库存 / 估值
/ 凭证之外的额外平行表, 与 Frozen Domain Integrity 冲突, 不得绕过治理新增.
因此本节把 CHECK 放宽登记为 Wave 6 Implementation 阶段必需的有界 migration delta,
并把精确差异 (金额语义两条记录分离、商业金额为 0 / 估值金额为正向 / 不伪造) 写入
§30.30 的 Implementation 证据清单.

##### 29.13.11.7 Atomicity, lock order, idempotency

All Gates run inside ONE `transaction(db, () => { ... })` bound to one `SALES_RETURN_REVERSAL_OPTION_C` idempotency record. After the locked mode resolver selects `SO_BACKED` / `NO_SOURCE`, the client must provide a non-empty `Idempotency-Key`; validation occurs before any business mutation and the server must not synthesize a random fallback. The lock order is canonical across SQLite and MySQL and is superseded/expanded by §30.31 where provenance/dependency locks are named:

```text
 1. acquire idempotency scope
      (operation_type='SALES_RETURN_REVERSAL_OPTION_C', document_id=returnId,
       idempotency_key=clientKey) + canonical payload fingerprint
 2. SELECT * FROM return_orders WHERE id=? FOR UPDATE
 3. SELECT * FROM return_order_items WHERE return_id=? ORDER BY id FOR UPDATE
 4. for each line:
    SELECT replacement evidence from sales_order_replacement_lines +
           sales_replacement_fulfillments WHERE source_return_item_id=line.id FOR UPDATE
 5. for each line (ascending line id, then movement id):
    SELECT originals FROM inventory_valuation_movements
       WHERE source_type='SALES_RETURN' AND source_id=? AND source_item_id=?
       FOR UPDATE
 6. SELECT provenance + original outbound evidence (when required), exact Inventory
    positions/tracking identities, valuation/LOT balances, active locks/reservations,
    hold history and post-frontier movement rows in §30.31 canonical key order FOR UPDATE
 7. SELECT original FROM accounting_vouchers
       WHERE source_type='SALES_RETURN' AND source_id=? FOR UPDATE
 8. SELECT credit FROM financial_credit_adjustments WHERE source_type='SALES_RETURN' AND source_id=?
    (only when Step 8 found a row; otherwise step skipped to avoid unused-lock contention)
 9. canonical reverses:
    consumeOriginalInboundValue(...) per line (Gate-C) -> creates reversal movements
    createSystemVoucher(...)                once       (Gate-D) -> creates reversal voucher
    reverseCreditAdjustment(...)            once       (Gate-E)
10. INSERT INTO return_reversals; INSERT INTO return_reversal_items;
    INSERT INTO credit_reversal_components (Gate-E only)
11. INSERT INTO audit_logs
12. saveIdempotency(SALES_RETURN_REVERSAL_OPTION_C, returnId, key, fingerprint, result)
13. COMMIT
```

SQLite: the whole sequence runs in `BEGIN IMMEDIATE` write transaction. MySQL: every SELECT … FOR UPDATE acquires the row lock under the same caller transaction; range/absence locks use the §30.31 anchor rows and indexed predicates so missing-row checks cannot admit phantoms. Independent-session evidence is required in the Wave 6 acceptance gate; a single shared connection is not concurrency evidence.

Idempotency contract:

```text
scope = (SALES_RETURN_REVERSAL_OPTION_C, returnId, clientKey)
fingerprint = canonical { action='reverse', normalized businessDate, normalized reason,
                          every authoritative request field changing economic effect }
transport noise and body idempotency aliases are excluded.
same scope/key + equivalent fingerprint -> replay the committed result (HTTP 200),
  without duplicate Inventory, traceability, valuation, voucher, Credit, audit or idem effects
same scope/key + different fingerprint -> HTTP 409 with zero new effects
missing/blank Idempotency-Key header -> HTTP 400 before mutation/success audit/success idem
server-generated random or deterministic replacement key -> forbidden
```

Concurrent races (Option C spec adds no new Race ID; reuses R-SAL-09 / R-SAL-10):

```text
- Two Option C reverses of same Return id: serialized on return_orders FOR UPDATE;
  the duplicate-reverse guards + idempotency record produce replay / 409.
- Option C reverse vs Sales Delivery confirm of same product / warehouse position:
  serialized on inventory_valuation_balances FOR UPDATE; exactly-once net effect or 409.
- Option C reverse vs Replacement fulfillment evidence insert:
  serialized on sales_replacement_fulfillments FOR UPDATE;
  Replacement cannot fulfill during a Return Reverse; second writer sees post-reverse state.
- Option C reverse vs Finance Credit application / refund:
  serialized on financial_credit_adjustments + settlement_unapplied_balances
  (reverseCreditAdjustment already locks them).
```

Failure roll back entire Option C transaction; original Return status, Return items, `inventory_valuation_movements`, `inventory_valuation_balances`, `accounting_vouchers`, AR, `return_reversals`, audit, idempotency — all unchanged.

##### 29.13.11.8 DELIVERY_BACKED Compatibility

`reverseOperationalReturn()` in `server/modules/financial-controls.js:323-382` remains the DELIVERY_BACKED path. The mode resolver (§29.13.11.1) routes DELIVERY_BACKED to that function unchanged. No Option C primitive touches DELIVERY_BACKED's voucher, credit adjustment, `credit_reversal_components`, inventory OUT or `return_reversal_items` row. Batch A frozen semantics are not extended.

A separate future bounded Design task may propose Option-C-style evidence for DELIVERY_BACKED reverse; that work cannot start under this DR and must not modify `reverseOperationalReturn` without its own approved Requirement delta.

### 29.14 Replacement / Replenishment Technical Design

#### 29.14.1 物理对象（header + line）

Replacement is LINE-CAPACITY based. Identity anchor:

```text
Source return line = return_order_items.id  (preferred; matches source-capacity unit)
  Header object     = sales_order_replacements          (NEW A-37 header; line-aggregate)
  Line object       = sales_order_replacement_lines     (NEW A-38 line; per material / qty)
```

`sales_order_replacements` (NEW A-37 header):

```text
sales_order_replacements:
  id, replacement_no (UNIQUE),
  source_return_id (FK return_orders.id, NOT NULL),
  cancellation_state ('ACTIVE','CANCELLED'),
  fulfillment_state (PURE_DERIVED API/read projection:
                     'OPEN','PARTIAL','FULFILLED','CANCELLED'),
  replacement_quantity (header roll-up; computed from lines),
  fulfilled_quantity   (header roll-up; computed from lines),
  remaining_quantity   (header roll-up; computed from lines),
  created_at, creator_id, closed_at, closed_by
```

There is no persisted header `delivery_link_id`. `sales_replacement_fulfillments` is the only authoritative Replacement-to-Delivery relationship and preserves all deliveries without first/last-row overwrite or lossy projection.

`sales_order_replacement_lines` (NEW A-38 line):

```text
sales_order_replacement_lines:
  id, replacement_id (FK sales_order_replacements.id),
  line_no,
  source_return_item_id (FK return_order_items.id, NOT NULL),
  replacement_material_id (FK products.id),
  replacement_quantity (REAL),
  fulfilled_quantity (PURE_DERIVED SQL projection; not a physical generated column)
  remaining_quantity (PURE_DERIVED = replacement_quantity - effective fulfilled quantity)
  replacement_uom_code
  business_date
  created_at
```

`sales_replacement_fulfillments` (NEW link table; one-row per confirmed replacement_delivery item):

```text
sales_replacement_fulfillments:
  id, replacement_line_id (FK sales_order_replacement_lines.id),
  sales_delivery_id (FK sales_deliveries.id),
  sales_delivery_item_id (FK sales_delivery_items.id),
  fulfilled_qty, business_date
```

The link table has no independent mutable lifecycle state and no cached aggregate. A row is immutable confirmed-fulfillment evidence and may be inserted only in the same transaction that verifies the referenced Delivery item belongs to the referenced Delivery, has the same product as the Replacement line, and the Delivery is effectively `CONFIRMED`. DRAFT/CANCELLED Delivery rows cannot create fulfillment evidence.

Effective fulfillment is a pure SQL projection from the same facts for header, line, API and UI:

```text
effective_fulfilled(line)
  = SUM(link.fulfilled_qty
        WHERE link.replacement_line_id = line.id
          AND linked Sales Delivery execution remains canonically effective)

line.remaining = MAX(0, line.replacement_quantity - effective_fulfilled(line))
header quantities = SUM(the corresponding line projections)
header fulfillment_state = OPEN when fulfilled=0;
               PARTIAL when 0 < fulfilled < replacement;
               FULFILLED when fulfilled=replacement;
               CANCELLED only when cancellation_state=CANCELLED, while the
               already-fulfilled quantity remains visible and immutable.
```

Current Sales Delivery lifecycle has no canonical reversal of an already confirmed Delivery. Wave 6 must not simulate one by deleting/updating a fulfillment link. A future Delivery reversal may reduce this projection only when its own canonical, atomic reversal evidence exists; adding such a reversal contract requires its own approved Requirement/Design change. Replacement cancellation closes only the unfulfilled remainder and never erases confirmed Delivery execution. Thus all currently valid cancel paths remain truthful, while an unsupported confirmed-Delivery reversal fails closed instead of creating Sales-only counter-evidence.

#### 29.14.2 Constraints

```text
- replacement_quantity (header) = derived SUM(sales_order_replacement_lines.replacement_quantity)
- fulfilled_quantity (line/header) = one pure SQL projection over effective sales_replacement_fulfillments; no cross-table Generated Column
- remaining_quantity            = derived SUM(line replacement_quantity - effective line fulfilled quantity)
- replacement_quantity per line ≤ source_return_item.quantity (R-SAL-10 lock anchor)
- 不 reopen 原 SO 的 executed history；replacement 是一个新商业 obligation
- inventory effect 仅 when replacement_delivery confirm (canonical Inventory V21)
- finance effect 仅 when replacement delivery confirm + canonical AR adapter
- no second inventory ledger; no second AR ledger
- no persisted header delivery shortcut; every linked Delivery is queried through the fulfillment evidence table
- no mutable quantity cache unless a later approved Design supplies strict invalidation/reconciliation proof
```

#### 29.14.3 与 Quotation / SO / Delivery / Prepayment 互动

- Replacement 可以触发新的 Quotation（policy-dependent）；不是 mandatory.
- Replacement 可以触发 Prepayment Gate（policy-dependent）。
- Replacement fulfillment 走 new Sales Delivery + Inventory physical outbound.
- Replacement delivery source line integrity: `sales_delivery_items.delivery_notice_id` MAY reference a Delivery Notice created for the replacement, or NO Delivery Notice if replacement is a one-shot direct delivery (subject to Product Domain rule at implementation evidence).

#### 29.14.4 Capacity anchor (R-SAL-10)

For R-SAL-10 lock matrix:

```text
canonical lock identity = return_order_items.id (line-level)
secondary lock for confirmation = sales_order_replacement_lines.id (line-level)
delivery consume lock = sales_delivery_items.id (already established)
```

Frozen-domain integrity: replacement creation does NOT silently rewrite `return_orders` or `sales_delivery_items`; replacement is a new obligation that DELIBERATELY references the source return line by FK.

### 29.15 Gift Line Technical Design

#### 29.15.1 标识

`sales_order_items.is_gift_line` (NEW bool default false).

#### 29.15.2 语义

```text
selling price = 0 (unit_price_cents = 0; amount_cents = 0)
commercial amount = 0
commercial tax basis = 0 (regardless of tax-inclusive flag)
inventory / reservation / OQC / COGS / source-line trace continue normally
COGS continues; revenue 0
```

#### 29.15.3 链

```text
SO (is_gift_line true)
→ Delivery Notice (line carries gift marker)
→ Sales Delivery (line executes inventory OUT normally)
→ Sales Invoice or M14 economics
  (commercial amount = 0; COGS still booked; gift cost retention per Finance
   adapter decision; SC29 + S07 invariant)
```

#### 29.15.4 Audit

Gift line on SO 触发 audit `entity_type=SALES_ORDER, action=GIFT_LINE_ADDED, detail=line_no`.

### 29.16 Prepayment Gate Technical Design

#### 29.16.1 物理对象

`sales_prepayment_requirements` (NEW #37) + `sales_prepayment_gate_results` (NEW #38)：

```text
sales_prepayment_requirements:
  id, sales_order_id, line_no,
  required_amount_cents, ratio_basis ('LINE_VALUE'|'ORDER_VALUE'),
  effective_from, effective_to,
  created_at, created_by
  PRIMARY KEY (sales_order_id, line_no)

sales_prepayment_gate_results:
  id, sales_order_id (FK),
  stage ('PLANNING_RELEASE','RESERVATION','DELIVERY'),
  eligible_advance_cents (from Finance advance/unapplied reads; bounded),
  remaining_required_cents (GENERATED: required_amount - advance_applied),
  decision ('PASS','WARN','BLOCK','OVERRIDE_REQUIRED'),
  override_reason, overridden_by,
  evaluated_at, evaluated_by,
  snapshot_key (idempotency / replay)
  PRIMARY KEY (sales_order_id, stage, snapshot_key)
```

#### 29.16.2 Evaluator (one canonical Finance-side value with shared lock)

```text
Chosen Design: Sales calls a Sales-owned Finance adapter that reads ONE canonical
Finance-side eligible prepayment value AND acquires the canonical Finance
balance locks in the SAME database connection/transaction as the Sales gate
mutation.

Sales does NOT independently SUM:
  advance_receipts + settlement_unapplied_balances + applied_applications;
  those are NOT proven disjoint in the frozen Finance domain.

Sales calls:
  financeAdapter.resolveEligiblePrepaymentForSalesGate(
    customer_id, business_date, gate_stage, sales_order_id,
    remaining_required_cents,
    lockMode = FOR_UPDATE         ← locks the canonical Finance balance rows
  )
  → returns:
    eligible_amount_cents             (single canonical value)
    source_balance_identities         (ref to balance rows consumed in this read)
    already_applied_amount_cents       (applied by previous gates / refunds)
    refunded_amount_cents             (refunded portion reducing remaining)
    remaining_eligible_cents           (eligible_amount - already_applied)
    decision_hint                     (Finance hint: OK / WATCH / NOT-OK)
    business_date
    contract_version                  (frozen Finance contract snapshot)
```

The adapter must:

```text
identify all canonical Finance balance rows that contribute to eligible
eligible prepayment (customer's unapplied + advance + applied + refunded
pool), lock them in deterministic order, re-read eligible / applied /
refunded / remaining, return the decision evidence to Sales.
```

Sales gate logic (consumer, in same connection/transaction):

```text
evaluateSalesPrepaymentGate(sales_order_id, stage):
  1. lock sales_prepayment_requirements for sales_order_id
  2. call financeAdapter.resolveEligiblePrepaymentForSalesGate(
       ..., lockMode = FOR_UPDATE
     )  → acquires canonical Finance balance locks in this transaction
  3. compute remaining_required_cents
  4. compare Finance remaining_eligible_cents vs required remaining
  5. emit decision (PASS / WARN / BLOCK / OVERRIDE_REQUIRED)
  6. write sales_prepayment_gate_results row in same transaction
     with source_balance_identities captured (audit trace)
  7. write audit
  8. COMMIT
```

R-SAL-15 serialization (Final Closure design):

```text
The Sales gate + Finance refund/Application serialize on the SAME canonical
Finance balance locks acquired inside the SAME transaction/connection by
the financeAdapter.

Sales gate wins first:
  financeAdapter locks canonical Finance balances FOR UPDATE
  gate reads locked eligible balance
  sales_prepayment_gate_results inserted
  COMMIT
  then Finance refund / Application proceeds (must acquire SAME locks)

Finance mutation wins first:
  financeAdapter locks canonical Finance balances FOR UPDATE
  eligible balance changes
  Finance mutation commits
  Sales gate acquires the same locks
  re-reads reduced balance
  PASS / BLOCK is decided from new state
```

Forbidden:

```text
Sales passes from a stale eligible amount
while a concurrent Finance mutation has already consumed / refunded it.
```

#### 29.16.3 Frozen-domain contract status for R-SAL-15 (Final Closure)

Canonical V22 identities and locked set (Final Closure implementation-ready):

```text
which canonical Finance row identities are locked
  (per V22 §33 frozen accounting settlement / prepayment flow):

  settlement_unapplied_balances       (the unapplied credit memo / unapplied balance
                                       pool that contributes to "eligible prepayment")
  payment_collections                  (customer prepayments / advance receipts applied
                                       by collection; reduces remaining available)
  financial_credit_adjustments         (refund / write-off / credit adjustment operations
                                       that reduce remaining eligible)

  These are the actual V22 canonical objects used by the Prepayment Gate
  eligible-amount computation. NO new Finance balance is invented.
```

```text
deterministic Finance lock order
  (must match the order used by Finance refund / Application path):

  1. settlement_unapplied_balances FOR UPDATE
       (per customer, per business_date)
  2. payment_collections FOR UPDATE
       (per customer, per business_date)
  3. financial_credit_adjustments FOR UPDATE
       (per customer, per business_date)
```

```text
which Finance refund / application paths already use those locks
  (existing V22 §33.39 / §28 Finance-specific concurrency requires):

  Yes — Finance refund paths in v22 Financial Controls already
  acquire these canonical Finance balance locks when reducing
  eligible amount. Sales does NOT introduce new Finance locking.
```

```text
which paths need the bounded contract extension
  (the missing piece from current V22):

  The locked-READ contract variant (lockMode = FOR UPDATE on the
  SAME canonical Finance balance set, returning the same evidence
  to the caller) is not yet exposed. Current V22 returns the
  eligible value but does not acquire FOR UPDATE on the balance
  set as part of the read. This read-then-acquire pattern is the
  missing piece required by R-SAL-15. Bounded contract extension only.
```

The shared contract:

```text
Sales gate locked-read
and
Finance balance-reducing mutation
serialize on the SAME Finance economic balance identity.
```

#### 29.16.3.1 Canonical Finance parent balance lock identity (Final Two-Point Closure)

The canonical economic balance identity for Sales Prepayment Gate is:

```text
settlement_unapplied_balances.id
(where balance_type = 'PREPAYMENT')
```

This is the PRIMARY cross-domain lock identity for R-SAL-15. Child facts read
beneath the parent balance lock (NOT primary locks themselves):

```text
balance_applications         (consumes PREPAYMENT balance)
financial_refunds            (refunds PREPAYMENT balance)
applicable reversal effects (e.g. settlement_unapplied_balances reversal rows
                             that reduce the eligible prepayment pool)
```

`payment_collections` is a SOURCE DOCUMENT (the customer advance that originally
created the PREPAYMENT balance) — it is NOT the primary balance serialization
lock. The canonical R-SAL-15 lock set is the parent balance row.

#### 29.16.3.2 Canonical remaining-prepayment formula (per eligible balance)

For each eligible Finance PREPAYMENT balance row (locked FOR UPDATE):

```text
remaining

=
  settlement_unapplied_balances.original_amount_cents

- confirmed balance_applications                   (consumed portion)

- confirmed financial_refunds                      (refunded portion)

- applicable unapplied-balance reversal effects    (reversal portion)
```

Use the exact existing V22 canonical reversal semantics. Do NOT invent another
balance or another decrement field. The financeAdapter returns the remaining
eligible amount per eligible balance and the source identities for audit.

#### 29.16.3.3 Frozen-domain contract status for R-SAL-15 (Final Two-Point Closure)

```text
Finance business semantics                            NO CHANGE
Finance canonical balance (settlement_unapplied_balances)  NO CHANGE
sales locked-read adapter for R-SAL-15              BOUNDED INTEGRATION CONTRACT EXTENSION
Finance mutation path that reduces remaining     NO CHANGE if it already
  eligible prepayment                                  locks settlement_unapplied_balances.id;
                                                       otherwise BOUNDED INTEGRATION
                                                       CONTRACT EXTENSION
```

`payment_collections` and `financial_credit_adjustments` are NOT the primary lock
set; they are source documents / economic evidence respectively. They are not
re-defined in this Design.

If V22 later exposes a similar locked-read contract on the parent balance
row, the extension collapses to a no-op without semantics change.

#### 29.16.3.4 Required adapter contract (Sales locked-read)

```text
financeAdapter.resolveEligiblePrepaymentForSalesGate(
  customer_id, business_date, gate_stage, sales_order_id,
  remaining_required_cents, lockMode = FOR_UPDATE,
  db_transaction_context
)
  1. identify eligible PREPAYMENT settlement_unapplied_balances rows
  2. order their IDs deterministically (lexicographic by balance id)
  3. SELECT those balance rows FOR UPDATE
  4. under those locks re-read canonical child effects:
       balance_applications
       financial_refunds
       applicable reversal effects
  5. calculate remaining eligible prepayment per balance per §29.16.3.2 formula
  6. return evidence to Sales (eligible_amount_cents, source_balance_locked
     identities, already_applied, refunded, remaining_eligible, decision_hint,
     business_date, contract_version)
  7. keep locks until caller transaction commits / rolls back
```

If multiple balance rows contribute:

```text
lock all eligible balance rows
in one deterministic order
```

#### 29.16.3.5 Finance mutation paths MUST acquire the same parent balance lock

Any Finance operation that REDUCES remaining eligible prepayment must first
serialize on:

```text
settlement_unapplied_balances.id FOR UPDATE
```

before re-reading remaining balance and writing its child effect.

At minimum verify / design this contract for:

```text
Balance Application
Unapplied-Balance Refund
any reversal / mutation that reduces the currently eligible prepayment amount
```

The child rows:

```text
balance_applications
financial_refunds
settlement_reversal_items
```

are economic evidence / effects. They are NOT the primary cross-domain lock
identity.

#### 29.16.3.6 R-SAL-15 serialization

```text
Sales Gate wins:
  Sales locks PREPAYMENT balance row(s) FOR UPDATE
  recomputes remaining eligible amount
  evaluates gate
  writes gated Sales mutation
  COMMIT
  Finance Application / Refund then acquires the balance lock
  and sees post-Sales state

Finance mutation wins:
  Finance locks PREPAYMENT balance row FOR UPDATE
  writes Application / Refund / relevant effect
  COMMIT
  Sales later acquires balance row lock
  recomputes lower remaining amount
  PASS / BLOCK uses new state
```

Forbidden:

```text
Sales PASS based on stale prepayment balance
while Finance concurrently consumes / refunds the same balance
```

#### 29.16.3.7 Exact bounded-extension classification against actual V22

Inspect current V22 implementation. The required lock contract is:

```text
Finance owned lock (settlement_unapplied_balances.id)
+ Sales locked-read adapter that returns the same evidence to caller
+ Finance mutation path that acquires the same lock before reducing balance
```

The bounded extension is the missing SALES-side locked-READ adapter contract.
Finance business semantics are unchanged. Finance canonical balance is unchanged.
Finance mutation paths that ALREADY acquire the parent balance lock are
unchanged. Only the SALES-side locked-READ adapter requires the extension.

If a V22 mutation path that reduces remaining eligible prepayment does not yet
acquire the parent balance lock, that path is also BOUNDED INTEGRATION
CONTRACT EXTENSION (Finance-owned change; same contract target).

#### 29.16.3.8 Frozen-domain contract summary (Repository-Evidence Final Closure; no conditional)

```text
CURRENT V22 DOES NOT YET PROVIDE
THE REQUIRED MYSQL PARENT-BALANCE ROW LOCK
ON ALL R-SAL-15 BALANCE-REDUCING PATHS.
```

| Component | Classification |
|---|---|
| Finance business semantics | **NO CHANGE** |
| Finance canonical balance (`settlement_unapplied_balances`) | **NO CHANGE** |
| Sales locked-read adapter for R-SAL-15 (`resolveEligiblePrepaymentForSalesGate`) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** |
| Finance mutation `applyUnappliedBalance` (acquires `settlement_unapplied_balances.id FOR UPDATE` before re-read/validation) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** |
| Finance mutation `createRefund` (acquires parent balance `FOR UPDATE` before capacity decision) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** |
| Finance mutation `reverseSettlementDocument` for PREPAYMENT / UNAPPLIED reduction (acquires parent balance `FOR UPDATE` before remaining / validation / reversal mutation) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** (only the PREPAYMENT / eligible-unapplied reduction semantics relevant to R-SAL-15; do NOT redesign unrelated reversal behavior) |
| Finance increasing-balance reversals (reverse Balance Application, reverse Refund) | **NO CHANGE** (they restore eligible prepayment; conservative temporary BLOCK on the next Sales risk-increasing evaluation is acceptable; they may use the same parent-lock helper if that simplifies Finance concurrency, but that is an implementation choice, not a Requirement change) |
| Source document linkage `payment_collections` | **NO CHANGE** (not the primary lock) |

The Finance Operations bounded extension is **ONE bounded Finance integration contract extension**, scoped to:

```text
A. Add transactional locked-read contract:
   resolveEligiblePrepaymentForSalesGate(...)
B. Locked-read accepts caller DB transaction/context.
C. It locks eligible PREPAYMENT settlement_unapplied_balances.id FOR UPDATE
   inside the same connection/transaction.
D. applyUnappliedBalance acquires the same parent lock before
   remaining-capacity validation.
E. createRefund acquires the same parent lock before
   remaining-capacity validation.
F. PREPAYMENT / UNAPPLIED balance-reducing reverseSettlementDocument
   acquires the same parent lock before remaining / validation /
   settlement_reversal_items mutation.
```

This is **NOT**:

```text
Finance semantic redesign
new Finance ledger
new balance truth
new recognition model
```

#### 29.16.4 Invariant: no double-count

```text
one advance / prepayment economic amount
must never satisfy the Prepayment Gate twice;
the canonical eligible amount + applied amount + refunded amount accounting
is Finance-owned; Sales reads once per gate evaluation via the adapter;
the same Finance-side canonical locks serialize Sales gate and Finance
refund / Application.
```

#### 29.16.5 R-SAL-15 transaction-context contract (Final Closure)

The application architecture required to safely share canonical Finance locks is:

```text
ONE DB TRANSACTION / ONE CONNECTION
shared by:
  1. Sales Prepayment Gate evaluation (lock sales_prepayment_requirements;
     call financeAdapter)
  2. financeAdapter locked-READ on canonical Finance balance set
     (settlement_unapplied_balances + payment_collections +
      financial_credit_adjustments) FOR UPDATE
  3. Sales gated mutation (e.g. write sales_prepayment_gate_results;
     possibly update Sales source fact inside the same gate result)
  4. COMMIT (atomic)
```

If the existing `financeAdapter` implementation starts its OWN transaction, the
Design requires the adapter to accept the CALLER's transaction / connection /
context instead of opening a new one. Concretely:

```text
financeAdapter.resolveEligiblePrepaymentForSalesGate(
  customer_id, business_date, gate_stage, sales_order_id,
  remaining_required_cents, lockMode = FOR_UPDATE,
  db_transaction_context              ← caller provides the same tx
) → returns the same evidence as today, but acquired under the caller's
   transaction; Sales gate and Sales gated mutation are atomic with the
   Finance locked-READ.

financeAdapter MUST NOT open a new db transaction independently when the
caller provides a transaction context.
```

If at the time of Implementation the existing `financeAdapter` is found to
require its own transaction (not callable within the caller's tx), the
bounded contract extension above includes the migration of the adapter to
"inherits caller transaction" semantics. No Finance semantic redesign.

The required outcome at runtime is exactly:

```text
one DB transaction
one connection
shared canonical Finance locks
Sales decision + gated Sales mutation
```

where the gated operation requires atomic protection.

#### 29.16.6 Implementation Evidence — Wave 7 (2026-10-18) R-SAL-15 bounded extension

The R-SAL-15 bounded integration contract extension is implemented in
`server/modules/sales-prepayment-finance-adapter.js`. The adapter exposes
`resolveEligiblePrepaymentForSalesGate(...)` with the same evidence contract as
the Design (§29.16.3.4) and acquires the canonical V22 PREPAYMENT parent
balance lock (`settlement_unapplied_balances.id` WHERE
`balance_type='PREPAYMENT'`) FOR UPDATE inside the caller's transaction.
Child facts (`balance_applications`, `financial_refunds`, applicable reversal
effects via `settlement_reversal_items.component_type='UNAPPLIED'`) are re-read
beneath the parent locks. A separate exported helper
`acquireParentBalanceLock(balanceId)` is invoked at the very start of the
`transaction(db, ...)` block in:
  * `applyUnappliedBalance`     (server/modules/financial-controls.js)
  * `createRefund`              (server/modules/financial-controls.js)
  * `reverseSettlementDocument` (server/modules/settlement.js) — for every
    UNAPPLIED component in the reversal request
so Sales gate and Finance mutations serialize on the same canonical balance
identity. `reverseOperationalReturn` (sales-return reversal path) does not
acquire this lock because it reduces CREDIT balances (credit_reversal_components
under `financial_credit_adjustments`), not PREPAYMENT-eligible balances — its
eligible-unapplied source, when present, remains CREDIT and is not in the
R-SAL-15 critical set. Finance business semantics and Finance canonical
balance are unchanged.

The Prepayment Gate canonical writer (`server/modules/sales-prepayment-gate.js`)
emits the full 4-way decision matrix from §29.16.1 / §29.16.2 step 5:
  * `PASS`              eligible ≥ required    (full coverage, proceed)
  * `WARN`              0 < eligible < required (partial coverage, proceed with audit)
  * `BLOCK`             eligible == 0       (no eligible balance, refuse)
  * `OVERRIDE_REQUIRED` prior override carries forward until eligibility rises
                                              to PASS, or explicit override is re-applied
The writer persists the result in `sales_prepayment_gate_results` atomically
with the locked-READ. Override endpoint requires a non-empty reason and
refuses to override PASS. snapshot_key UNIQUE enables idempotent replay.

Stage-gate enforcement at business entry points (`assertSalesPrepaymentGateAtStage`)
binds the gate decision to the actual mutations:
  * `salesOrderAction('submit')`              → PLANNING_RELEASE gate must PASS
  * `requestReservationIntent`               → RESERVATION gate must PASS
  * `confirmSalesDelivery` (in app.js)       → DELIVERY gate must PASS
BLOCK or missing evaluation refuses with explicit
`SALES_PREPAYMENT_GATE_*` codes so the UI surfaces the failure reason.

#### 29.16.7 Wave 7-R1 correctness remediation evidence (2026-10-18)

The business-entry contract is implemented by
`authorizeSalesPrepaymentGateForMutation(...)`, not by trusting the last
persisted Gate Result. `salesOrderAction('submit')`,
`requestReservationIntent` and `confirmSalesDelivery` call it from their
existing mutation transaction. A prior stage result proves only that the
stage was explicitly evaluated (and carries approved override reason/actor);
the mutation-time authorization locks the effective requirement and the
canonical PREPAYMENT parents, re-reads Finance child effects, emits fresh Gate
evidence, enforces PASS/WARN/BLOCK/OVERRIDE_REQUIRED, and then allows the
caller to continue before the same commit. NOT_REQUIRED remains a no-op and a
configured stage with no prior evaluation remains NOT_EVALUATED. Existing
command idempotency checks run before the transaction, so an already-completed
same-key command replays, while a new command can never reuse an old monetary
decision.

Failure rolls back the mutation-time Gate row/audit together with all Sales,
Planning and success-idempotency effects. The focused SQLite acceptance suite
proves stale PASS rejection after the canonical balance is exhausted and
proves the sufficient-balance commit path through the real Reservation entry.
The registered real-MySQL Wave 7 concurrency suite invokes the real Gate,
`applyUnappliedBalance`, `createRefund` and `reverseSettlementDocument`
(UNAPPLIED) paths on independent connections; execution remains subject to
the separately authorized disposable-MySQL gate.

#### 29.16.8 Wave 7-R1 final P1 coverage closure evidence (2026-10-18)

The registered Wave 7 acceptance suite now exercises the production Sales
Order submit and Sales Delivery confirm entries, not only the Gate helper.
Both stage matrices cover current PASS, WARN, BLOCK, authorized and malformed
OVERRIDE_REQUIRED, effective-date before/within/after behavior, NOT_REQUIRED,
NOT_EVALUATED, stale prior PASS after Finance balance reduction, command
replay, conflicting command payload/action, and rollback of Gate/audit/
idempotency plus protected business effects. Delivery success additionally
asserts exact-once Inventory, valuation, COGS, revenue, AR and audit results;
denial asserts that none of those effects commits.

The canonical real-MySQL Wave 7 concurrency suite and its existing worker are
extended rather than replaced. In addition to the preserved Reservation
scenarios, the worker invokes `salesOrderAction(..., 'submit')` and
`confirmSalesDelivery(...)` on independent MySQL sessions. Each of
PLANNING_RELEASE and DELIVERY is registered against the real
`applyUnappliedBalance`, `createRefund`, and
`reverseSettlementDocument` UNAPPLIED mutation. The suite proves transaction
overlap through the canonical transaction gate, then asserts the serialized
business result: either the Sales action commits once with fresh Gate evidence
and its complete business effects, or the Finance mutation wins and the Sales
action re-reads zero eligible balance, returns
`SALES_PREPAYMENT_GATE_BLOCKED`, and leaves zero partial success effects.
Runtime MySQL evidence remains pending explicit disposable-database approval.

### 29.17 Reservation Intent Design

#### 29.17.1 物理对象

`sales_reservation_intent` (NEW #57)：

```text
sales_reservation_intent:
  id, sales_order_id (FK), sales_order_item_id (FK), product_id, warehouse_id,
  intent_state ('NONE','REQUESTED','GRANTED','RELEASED','CONSUMED'),
  requested_at, released_at,
  planning_reservation_id (FK nullable to planning_reservations.id),
  consumer_event (e.g. 'DELIVERY_CONFIRMED', 'SO_CHANGED', 'CANCELLED')
```

Rules:
- `INVENTORY_LOCK`：Sales intent calls Inventory canonical lock adapter with SO-line source identity；truth stays in `inventory_locks`。
- `MANUAL_RESERVATION`：calls Planning reservation with `reservation_type=MANUAL`。
- `ON_HAND_RESERVATION`：calls Planning with strong on-hand semantics (`STRONG + ON_HAND`)；Sales 写 intent only。
- `EXPECTED_SUPPLY_RESERVATION`：calls Planning with expected-supply identity；当前 `EXPECTED` 返回无限容量且没有有限权威供给校验，故标记 `BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED`。扩展完成前该 mode fail closed，不能把无限占位当完成。
- Sales 读取 Planning canonical reservation / Inventory canonical lock；delivery confirmed 后通过 owner adapter consume/release，并只更新 intent evidence。

R-SAL-02: Sales Delivery × 2 against same reservation 已 covered by Planning's `assertStrongReservationAvailability`; Sales 引用 its result via the same identity.

Manual-to-adapter closure matrix：

| Manual behavior | Sales intent | Existing canonical adapter / truth | Gap | Decision |
|---|---|---|---|---|
| 未启用预留时库存锁定 | `INVENTORY_LOCK` with SO/line source | Inventory `inventory_locks`; lock/unlock owner API | current API requires Inventory permission and lacks a frozen Sales service contract | bounded adapter contract; Inventory remains writer |
| 手工预留 | `MANUAL_RESERVATION` | Planning `planning_reservations` type `MANUAL` | Sales source-linked adjust/consume contract not frozen | bounded adapter contract |
| 库存量预留 | `ON_HAND_RESERVATION` | Planning `STRONG + ON_HAND`; `assertStrongReservationAvailability` | consumption/release must be source-linked and atomic with delivery | bounded adapter contract |
| 预计量预留 | `EXPECTED_SUPPLY_RESERVATION` | Planning source type `EXPECTED` | current `physicalSupplyQuantity(EXPECTED)` is infinite; no authoritative finite capacity | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED**; fail closed until delivered |
| 调整/释放 | `ADJUST/RELEASE` event on existing intent | Planning release + Inventory unlock exist separately | no unified source-line adjust/consume contract | owner-specific adapter; deterministic lock order + audit |

The extension may add adapter behavior but may not add a Sales reservation balance, mutate frozen owner tables directly, or silently reinterpret existing Planning records.

#### 29.17.2 React to events

```text
SO Change       → lock source line; adjust/release and re-request delta through the same owner adapter
SO Cancel/Close → release remaining canonical lock/reservation
Delivery        → consume or release delivered portion; never exceed canonical grant
Return          → no automatic recreation; explicit policy may re-request against reopened obligation
Replacement     → new source-linked intent; does not reopen original intent silently
```

### 29.18 Service Item Sales Technical Design

#### 29.18.0 Frozen-Master boundary decision

This Domain closure adopts **Option A** from the Micro-Closure menu: Sales-owned commercial product extension table `product_commercial_classification` (NEW A-61). Sales does NOT silently add columns to frozen-Master-owned `products` table.

```text
Business owner      : Sales & Customer (commercial classification is a Sales business concept)
Physical owner      : Sales & Customer — a NEW Sales-owned table keyed by product_id
Read direction      : Sales reads `products` (Master identity) only as FK target
Write direction     : Sales writes ONLY to `product_commercial_classification`
                     NO writes to `products` table
Compatibility behavior: legacy reads may show an unclassified product; every new
                       commercial write requires an active A-61 row and never
                       infers sales-enabled/non-service from absence.
```

`product_commercial_classification` (NEW A-61):

```text
product_commercial_classification:
  id
  product_id (FK products.id, NOT NULL; UNIQUE per product)
  sales_enabled (bool NOT NULL; explicit provisioning, no missing-row default)
  sales_uom_code (FK uoms.code, nullable; NULL means canonical product/base UoM)
  pricing_uom_code (FK uoms.code, nullable)
  default_upper_delivery_tolerance_bps (INTEGER NOT NULL default 0; CHECK >= 0)
  default_lower_delivery_tolerance_bps (INTEGER NOT NULL default 0; CHECK 0..10000)
  service_classification (bool default false)
  service_kind (text nullable; bounded Sales code when service_classification=true)
  active (bool default true)
  created_at, updated_at, created_by, updated_by
```

此表是每个 product 一条 current Sales commercial classification；变更历史由 transactional `audit_logs` 保存，不同时维护 contradictory effective intervals。UoM identity 与 conversion truth 始终来自 Master-owned A-15 `uoms` / A-16 `product_uom_conversions`，本表只引用 Sales 使用/计价 UoM，不复制 conversion。两 UoM 不同时必须存在 canonical conversion，否则报价/订单解析 fail closed。tolerance 是 SC08 默认值，进入 SO line 后以 §29.8.3.1 snapshot 为执行真理；后续默认变化不得重解释已批准订单。

Missing/inactive contract：历史 row 可 read-only 显示 `(unclassified legacy)`；新 quotation、pricing、SO、reservation、DN/SD write 必须命中 active A-61 且 `sales_enabled=TRUE`。nullable Sales/Pricing UoM 只在 Master product 有 active canonical base UoM 时回退；缺 base UoM、缺 conversion 或缺 required tolerance defaults 均 BLOCK。缺 A-61 不得被解释为 `sales_enabled=TRUE` 或 `service_classification=FALSE`。

#### 29.18.1 物理对象

```text
service_fulfillments (NEW A-44):
  id, sales_order_id (FK), sales_order_item_id (FK),
  confirmation_state ('PENDING','CONFIRMED','CANCELLED'),
  confirmation_qty (REAL; remaining = SO line qty - SUM(confirmation_qty)),
  confirmation_at, confirmed_by,
  finance_recognition_id (FK nullable to Finance adapter result)
```

#### 29.18.2 决策点

Sales Delivery confirm path:

```text
if JOIN product_commercial_classification → service_classification = TRUE for this
   sales_order_item_id.product_id:
   if confirmation exists in service_fulfillments for that line: do inventory OUT 0
   else: BLOCK (cannot confirm; service not confirmed)
else:
   proceed with inventory OUT (current path)
```

#### 29.18.3 Frozen Master & Engineering boundary

```text
- products table is frozen-Master-owned; Sales does NOT add is_service column
- Sales-owned commercial classification in product_commercial_classification
- Read cross-domain contract:
    Sales uses products.id (FK only)
    NO write back to products
- Compatibility fallback: if Master later canonicalizes is_service at frozen
    product level, Sales switches to that contract path; this Domain closure does
    NOT block on that
```

### 29.19 Consignment Three-Truth Design

#### 29.19.0 Critical ownership correction (Micro-Closure)

The previous draft mapped Sales Consignment physical truth to `inventory V21 CUSTOMER-owned` position. This is **wrong** by §7 corrected semantics:

```text
WRONG:  physical ownership at consignment = CUSTOMER-owned
RIGHT:  physical ownership at consignment = seller/our organization (ENTERPRISE-owned
       in Inventory V21 position-key); until settlement / ownership-transfer event.
       CUSTOMER-owned position represents a DIFFERENT business meaning
       (entrusted stock / customer-owned material), NOT consignment.
```

Sales Consignment at Layer 2 (Inventory) MUST keep ownership = `owner_type='ENTERPRISE'` with location = customer / consignment site. Settlement / return triggers ownership transfer (Layout-2 → Layout-3 → finance).

#### 29.19.1 Three truth layers (corrected)

```text
Layer 1 : Sales & Customer commercial layer
         consignment_commercial_documents (NEW A-45)
         consignment_commercial_lines (NEW A-46)
         consignment_commodity_locations (NEW A-47; commercial location identity)
         consigned_quantity, settled_quantity, returned_quantity,
         remaining_consigned_quantity

Layer 2 : Inventory & Warehouse physical layer
         inventory_v21 canonical position (owner_type = ENTERPRISE during consignment;
                                            location = consignment_commodity_location FK or
                                            warehouse_id; no CUSTOMER-owner assignment
                                            for consignment)
         tracked_inventory_movements / inventory_v21 carrier types

Layer 3 : Finance Operations settlement layer
         account_receivables (settlement vs AR)
         financial_credit_adjustments (settlement reversal / return)
```

Ownership transition (canonical):

```text
Settlement (SALES decision):
  Layer 1 settlement confirmation → ownership at Layer 2 transfers:
    Layer 2 position.ENTERPRISE → Layer 2 position.CUSTOMER-owned OR out
    of layer 2 inventory (depending on settlement = sale or = return)
  Layer 3 AR adapter writes corresponding Finance economic effect.

Return (SALES decision):
  Layer 1 commercial return → Layer 2 inventory restore with same Layer 2 owner
  identity (ENTERPRISE). No second physical ledger.
```

#### 29.19.2 Chain (corrected)

```text
Consignment Instruction
  → Sales-only commercial document
  → Inventory physical transfer (canonical writer applyInventoryMutation;
     owner_type = ENTERPRISE; location = consignment_commodity_location)
  → Customer Settlement Confirmation (Sales business process; triggers Finance
     settlement + ownership transfer at Layer 2)
  → Consignment Commercial Return (Sales business process; Layer 2 inventory
     restore with ENTERPRISE ownership; Layer 3 refund)
```

#### 29.19.3 Capacity (corrected)

```text
Layer 1 capacity     = SUM(consignment_commercial_lines.consigned_quantity) -
                       SUM(consignment_commercial_lines.settled_quantity) -
                       SUM(consignment_commercial_lines.returned_quantity)
Layer 2 capacity     = Inventory ENTERPRISE-owned position at
                       consignment_commodity_location
                       (must equal Layer 1 capacity modulo settlement timing lag)
Layer 3 settlement    = sum(amount) in finance settlement subledger
                       (must equal Layer 1 settled total modulo refund lag)

R-SAL-20 / R-SAL-21: Layer 1 + Layer 3 must serialize on Layer 1
   remaining_consigned_capacity (canonical lock identity = consignment_commercial_lines.id).
   Layer 2 mutations triggered by Layer 1 must be audited cross-layer.
   Layer 2 owner always = ENTERPRISE during consignment; settlement → ownership
   transfer event.
```

#### 29.17.5 Implementation Evidence — Wave 7 (2026-10-18) Reservation Intent

The Sales Reservation Intent canonical writer lives in
`server/modules/sales-reservation-intent.js`. The four reservation modes are
implemented as bounded adapter delegations to canonical owner tables:
  * `INVENTORY_LOCK`            → `inventory_locks`        (Inventory V21 canonical)
  * `MANUAL_RESERVATION`        → `planning_reservations`  type MANUAL  (Planning V19)
  * `ON_HAND_RESERVATION`       → `planning_reservations`  type STRONG + supply ON_HAND
  * `EXPECTED_SUPPLY_RESERVATION` → `planning_reservations` supply EXPECTED
EXPECTED mode fails closed with code
`SALES_RESERVATION_EXPECTED_BOUNDED_EXTENSION_REQUIRED` because the frozen
`physicalSupplyQuantity(EXPECTED)` returns POSITIVE_INFINITY. Client-supplied
`expected_supply_capacity` is NOT used as authority (per task instruction §4)
— capacity is derived exclusively from the canonical Planning/Purchase/
Production source record identified by `expected_supply_source_type` +
`expected_supply_source_id`. If the source is pure `EXPECTED` with no concrete
canonical document, the writer refuses.

The writer persists only intent evidence (`sales_reservation_intent`); it does
NOT maintain a Sales-owned shadow reserved-qty balance. Concurrent over-
reservation is rejected by re-reading the canonical supply minus ACTIVE
reservations of the same supply identity inside the transaction. React-to-
event helpers (`adjustReservationIntentOnChange`,
`releaseReservationIntentsForOrder`) cover SO Change / Cancel / Close /
Delivery / Return / Replacement per §29.17.2.

#### 29.17.6 Wave 7-R1 canonical Planning and schema-parity remediation evidence (2026-10-18)

Planning now exposes transaction-inheriting canonical services for create,
release and consumption evidence. Sales Reservation Intent delegates to those
services and no longer inserts or updates `planning_reservations` directly.
For a concrete PLANNED_ORDER/PURCHASE_ORDER/PRODUCTION_ORDER source, Planning
locks the canonical source row before validating identity/status, computing
finite physical capacity, and subtracting ACTIVE reservations. Pure EXPECTED,
missing, unsupported, terminal/invalid and exhausted sources fail closed;
client capacity is never authority. The Sales intent, Planning reservation,
mutation-time Gate evidence and audits share one transaction.

Reservation Intent logical uniqueness is
`(sales_order_id, COALESCE(sales_order_item_id,''), reservation_mode)` in both
dialects. SQLite retains its expression index; MySQL 8 uses the equivalent
functional unique key part, without adding a column or business identifier.
MySQL migration reconciliation now verifies every approved Wave 7 FK, CHECK,
index and column type/null/default/precision contract, and refuses an
incompatible existing structure or duplicate normalized identity. The
registered `mysql-sales-customer-wave7.integration.js` covers live fresh,
replay and information_schema metadata; the registered concurrency suite
covers independent-session finite PLANNED_ORDER competition. Neither suite is
executed without explicit disposable-database/reset authorization.

#### 29.17.7 Wave 7 Final Acceptance Design Closure (2026-10-18)

Approval/Closure basis: user explicitly approved `document.md` DR-SAL-06 (including the A.2 four-clause authorization-boundary clarification) and authorized Stage 2 (Design Closure). This sub-section records the centralized design closure that maps each DR-SAL-06 Acceptance sub-clause to existing design coverage + Stage 3 (集中实施) minimal-fix scope. It does NOT modify any preceding §29.x or §30.x content; it documents the convergence between the frozen Requirement (document.md §34.3.12 / §34.3.13 + DR-SAL-04 / 05 / 04·05 superseding + the new DR-SAL-06) and the existing implementation referenced by §29.16.1–8 and §29.17.1–6.

##### 29.17.7.1 Stage-2 / Stage-3 boundary

Stage 2 (this Design Closure): append-only this sub-section + append-only the matching `log/2026-10-18.md` entry. No source / migration / test / gate / config / DB change. No execution of `pnpm.cmd test:mysql` / `pnpm.cmd test:mysql:concurrency` / `pnpm test:*` / `pnpm build` / direct DB connection. Stage 3 (集中实施) is authorized only after the user explicitly approves this Design Closure Report; Stage 3 may execute ONLY the two real MySQL gates authorized under DR-SAL-06 §A.2.1 and apply minimal fixes gated by §29.17.7.7 failure-dispatch and §29.17.7.9 stop conditions.

##### 29.17.7.2 DR-SAL-06 ↔ existing design coverage mapping

The table below records — at design level only — where each DR-SAL-06 sub-clause is already covered by existing §29.16 / §29.17 sub-sections, and where Stage 3 minimal-fix scope is allowed (left column). It is NOT a re-statement of business semantics; the §34 contract remains frozen.

| DR-SAL-06 子条款 | Existing design coverage (non-modifying reference) | Stage 3 minimal-fix scope (only if real MySQL gate reproduces concrete failure) |
|---|---|---|
| §A.1 已冻结商业语义不得重写 | §34.3.12 / §34.3.13 / DR-SAL-04·05 / S12 / S13 / R-SAL-02 / R-SAL-15 / §29.16.3.1–8 | 无；本轮不修改上述合同 |
| §A.2.1 仅两道真实 MySQL gate 获准执行 | DR-SAL-06 Acceptance Contract 文本自身 | 无 |
| §A.2.2 / §A.2.3 / §A.2.4 SQLite focused 保留 / 不可替代 / 不可删 assertion | — | 无 |
| §A.3.C1 迁移契约（fresh / upgrade / idempotent rerun + 三表 PK / FK / CHECK / UNIQUE / default / precision；`source_balance_identities` / `intent_state` default 在 MySQL 8 真实 `COLUMN_DEFAULT` 文本下通过 `assertMySqlColumnContracts` + `normalizeDefault` 等价匹配） | §29.16.1 (§29.16.1 物理对象) + `server/migrations/sales-customer-wave7-prepayment-reservation.js:65-91` `MYSQL_COLUMN_CONTRACTS` + line 108-142 `assertMySqlColumnContracts` + line 99-108 `normalizeDefault`；§29.17.1 物理对象 + 同一迁移 line 80-91（`sales_reservation_intent` contract） | 仅当真实 MySQL gate 复现契约冲突时，按 §29.17.7.7 分流表处置；最小修复优先级 (a) 扩展 `normalizeDefault` 正则以覆盖新增表示、(b) 在 §29.16.1 / §29.17.1 中明确 DDL 形式、`(c)` 调整 `assertMySqlColumnContracts` 等价匹配规则；任意一种修复必须保留 SQLite / MySQL parity 完整性，并新增单测覆盖新表示 |
| §A.3.C2 业务唯一性 + 完整性（`uq_sales_reservation_intent_order_line_mode` 在 fresh 与 existing 幂等存在；normalized duplicate fail-closed；reservation 走 canonical adapter 无 Sales 影子余额） | §29.17.1 物理对象 + `sales-customer-wave7-prepayment-reservation.js:291-316` `ensureMySqlReservationIntentUniqueness` + line 384-406 SQLite functional UNIQUE；§29.17.5 Implementation Evidence 描述四模式 bounded adapter；§29.17.6 Wave 7-R1 描述 Planning canonical transaction-inheriting services | 唯一允许：(a) `ensureMySqlReservationIntentUniqueness` duplicate 探测对真实 normalized 历史数据返回精确错误文本；(b) 调整时锁序；(c) Adapter 错误码与 §29.16.3.4 对齐 |
| §A.3.C3 并发不变量（独立 session、PLANNING_RELEASE / RESERVATION / DELIVERY 不超额放行；reservation/lock 合并消耗 ≤ 授权量；R-SAL-15 mutation/lock chain；回滚零副作用） | §29.16.3.5–3.6 Finance mutation 顶部 parent balance lock；§29.16.6 Implementation Evidence 描述 mutation-time gate 重新加锁并 re-read；§29.16.8 Wave 7-R1 final P1 描述并发套件扩展 `salesOrderAction('submit')` / `confirmSalesDelivery` 在独立 MySQL 连接之上 | 唯一允许：(a) 调整 `mysql-concurrency-sales-wave7-worker.mjs` 与 `mysql-sales-customer-wave7-concurrency.integration.js` 以覆盖 Stage 3 真实失败后回归；(b) 调整 lock-mode 探测；(c) 为新发现 race class 增设 worker command |
| §A.4 Failure Branching（四类失败、最小修复、`REQUIREMENT_REOPEN_REQUIRED` 路径、`TEST_EVIDENCE_PENDING` 路径、SQLite/真实 MySQL 语义差异单独记录） | — | Stage 3 不重写 §A.4；按 §29.17.7.7 失败分流执行 |
| §A.5 Stop Conditions（HEAD drift / unauthorized tracked diff / unauthorized meta edit / assertion 删降 / SQLite PASS 替代 / 异常→成功） | — | Stage 3 不重写 §A.5；按 §29.17.7.9 stop conditions 执行 |

##### 29.17.7.3 Migration behavior (fresh / existing / idempotent rerun)

For the three Wave 7 carriers (`sales_prepayment_requirements`, `sales_prepayment_gate_results`, `sales_reservation_intent`) under real MySQL execution:

- **Fresh database bootstrap**：先由 §29.16 / §29.17 underlying migration registry 的 `bootstrapMySql` 走 SQLite snapshot → MySQL DDL 转换并写入；新增列若被 snapshot renderer 归类为 LONGTEXT，则其后由 `sales-customer-wave7-prepayment-reservation.js` `migrateMysql` 的 `reconcileMySqlColumnContracts → assertMySqlColumnContracts` 收紧为 canonical 契约（`ratio_basis` VARCHAR(16), `stage` VARCHAR(32), `gate_decision` VARCHAR(32), `reservation_mode` VARCHAR(32), `intent_state` VARCHAR(16), `expected_supply_source_type` VARCHAR(64), `expected_supply_source_id` VARCHAR(128), `consumer_event` VARCHAR(64)），并在存储值长度不超过目标宽度时安全 alter。
- **Existing database upgrade**：(i) 三表若不存在 → 走 Fresh CREATE TABLE；(ii) 已有表 → 走 `ensureMySqlForeignKey` 按 FK 缺失补、`ensureMySqlCheck` 按 named CHECK 缺失 / 不一致补、`ensureMySqlIndex` 按 7 个普通索引幂等补、`ensureMySqlReservationIntentUniqueness` 按 MySQL 8 functional keypart `COALESCE(sales_order_item_id,'')` 重建 unique；(iii) 长度收紧前先 `MAX(CHAR_LENGTH(\`${column}\`))` 字符宽度探针，避免按字节截断；预存字符数 `> target n` → fail-closed（拒绝静默重写 / 不丢弃 / 不迁移原值）；
  - **目标宽度契约澄清**：MySQL 8 中 `VARCHAR(n)` / `VARCHAR(n) CHARACTER SET utf8mb4` 的容量按字符数 `n` 计量，不按字节计量；本 sub-section 第 (iii) 项的探针必须使用 `CHAR_LENGTH(column)` 而非 `LENGTH(column)`。`LENGTH(column)` 返回字符串的字节长度；在 `CHARACTER SET utf8mb4` / `COLLATE utf8mb4_0900_ai_ci` 下，任何字符最多占 4 字节；若以 `LENGTH()` 替代 `CHAR_LENGTH()` 作探针，字符数 `≤ n`、但多字节编码后字节数 `> n` 的合法多字节字符串会被误判为"超宽"并 fail-closed，从而拒绝一次本应允许的 reconcile ALTER，违反 §29.17.7.9 "不静默重写 / 不丢弃 / 不迁移原值" 契约。
  - **字节宽度独立约束**：本 Wave 7 收紧的 VARCHAR 目标列均为字符宽度语义（`ratio_basis VARCHAR(16)` / `stage VARCHAR(32)` / `gate_decision VARCHAR(32)` / `reservation_mode VARCHAR(32)` / `intent_state VARCHAR(16)` / `expected_supply_source_type VARCHAR(64)` / `expected_supply_source_id VARCHAR(128)` / `consumer_event VARCHAR(64)`），不引入任何显式 `BYTE` modifier 或非字符宽度的字段级字节约束。InnoDB key prefix 字节约束（如 Wave 6 `idx_valuation_movements_identity_status_created` 的 prefix 长度）属于 index-level prefix 字节约束，独立于本表 `VARCHAR(n)` 列宽契约；本 sub-section 不再讨论 index prefix 字节行为，避免与 `VARCHAR(n)` 字符宽契约混淆。
  - **回归场景**：上述修正必须在已授权的真实 MySQL 集成套件 `server/mysql-sales-customer-wave7.integration.js` 内增加回归场景，**不得**新建独立 gate 或独立 worker（与 §29.17.7.6 的"既已注册 worker / suite 内扩展"原则保持一致）：
    - 多字节值在目标字符宽 `n` 之内（即 `CHAR_LENGTH(value) <= n`）→ 不应仅因编码后字节长度 `> n` 而被拒绝；migration 必须可成功 ALTER COLUMN 至目标 `VARCHAR(n)`；
    - 单值字符数 `> n` → migration 仍 fail-closed 并抛以 `Wave 7 MySQL narrowing conflict: ... has stored values up to M chars, cannot narrow to VARCHAR(n) without truncation` 为模式的消息，不静默重写、截断或丢弃原值。
- **Idempotent rerun**：所有 DDL 使用 `IF NOT EXISTS` / information_schema 探针 / 命名索引已存在则 skip；`sales-customer-wave0-migration-runner.test.js` 已升级认定 registry 长度 7 + `Wave 7 must not create any Wave 8+ Sales table`，与本节兼容。

##### 29.17.7.4 Schema-parity and default value comparison rules (MySQL ↔ SQLite)

MySQL 8 表达 default（如 `DEFAULT ('[]')` / `DEFAULT _utf8mb4'[]'`) 在 `information_schema.COLUMNS.COLUMN_DEFAULT` 返回带括号 / 带 charset prefix / 带 padding 等不同表示。`server/migrations/sales-customer-wave7-prepayment-reservation.js` `assertMySqlColumnContracts` 的 `normalizeDefault` 通过剥离 `_(utf8mb4|utf8mb3|utf8|latin1)` 与 `()'"` 与空白后等价比较，应支持 `'[]'` / `('[]')` / `_utf8mb4'[]'` / `_utf8mb4('[]')` 等表示。SQLite migration 直接 `TEXT NOT NULL DEFAULT '[]'`，并在运行时通过 `JSON.parse` 安全反序列化（详见 `sales-prepayment-gate.js` `summarizeGateResult`）。本节固化：MySQL 侧 `assertMySqlColumnContracts` 是唯一权威 default 契约断言点；SQLite 侧仅检查 `sqlite_master.sql` 中的 CHECK / NOT NULL，不参与 default 表示差异比较。

##### 29.17.7.5 Prepayment balance lock & reservation transaction boundary

- **Prepayment Gate author-time**：`sales-prepayment-gate.js` `authorizeSalesPrepaymentGateForMutation` 在 caller transaction 内部调用 `resolveEligiblePrepaymentForSalesGate`（lockMode='FOR_UPDATE'）→ `lockParentBalances` 按 id 排序逐行 `SELECT ... FOR UPDATE`（MySQL）或 `BEGIN IMMEDIATE`（SQLite）→ 重新读 canonical `balance_applications` / `financial_refunds` / `settlement_reversal_items` → 通过四-way decision matrix → INSERT 新 gate_result → audit。caller 同 transaction 内继续 Sales mutation；commit 一次性提交或回滚（gate evidence + Finance 二次读 + Sales mutation + audit + idempotency）。
- **Sales mutation R-SAL-15 parent lock acquisition**：Finance mutation paths（`applyUnappliedBalance` / `createRefund` / `reverseSettlementDocument UNAPPLIED`）在 `transaction(db, ...)` 顶部调用 `acquireParentBalanceLock`（来自 `sales-prepayment-finance-adapter.js`），对 canonical `settlement_unapplied_balances.id`（`balance_type='PREPAYMENT'`）做 FOR UPDATE；锁顺序：先 finance parent balance lock，再 re-read child effects，最后 Sales locked-read 与 Sales mutation 在同一连接内共享该 lock chain；不得旁路。
- **Reservation Intent transaction boundary**：`sales-reservation-intent.js` requestReservationIntent 在 caller `transaction` 内依序：Sales Gate (PLANNING_RELEASE/RESERVATION/DELIVERY) 重新加锁 + re-read → canonical adapter (Inventory V21 `inventory_locks` 或 Planning V19 `planning_reservations`) FOR UPDATE → 重新验证 capacity 减去 ACTIVE reservations → INSERT `sales_reservation_intent` (REQUESTED) → audit。Consume / Release 同样在 caller transaction 内部按 canonical owner adapter 写入 + audit；任何失败整体回滚。
- **Cross-domain lock chain order**：(1) gate mutation-time Finance parent balance lock（lockParentBalances / acquireParentBalanceLock），(2) Sales mutation-time canonical adapter lock（Inventory `inventory_locks.position_key` / Planning `planning_reservations` identity），(3) Sales intent row INSERT / UPDATE。死锁规避：多 eligible balance row 按 canonical id 升序；多 canonical record 按 created_at / id 升序。

##### 29.17.7.6 Concurrency test architecture (real MySQL, independent sessions)

real MySQL 并发套件基于 `scripts/gates/mysql-concurrency-gate.mjs` 的第 9 个 suite：`server/mysql-sales-customer-wave7-concurrency.integration.js` + `scripts/gates/mysql-concurrency-sales-wave7-worker.mjs`。

- **Independent session**：每个 worker 通过 `node:child_process` `spawn` 启动独立的 `MySqlSyncAdapter`；每个 worker 的第一条 SQL 是 `SELECT CONNECTION_ID()` 收集自身的连接身份，最终在主进程断言所有 connectionId 互不相同。
- **Sync anchor**：所有 worker 先 `register` → `hold-gate` 在 canonical `mysql_transaction_gates.gate_id=1` 上 `FOR UPDATE`；主进程在所有 worker 都已 waitAtGate 之后才 `release-gate`，确保真实 cross-session interleaving（同一进程内 fake race 不算独立 session 证据）。
- **Competing operations**：当前注册覆盖 (`applyUnappliedBalance`, `createRefund`, `reverseSettlementDocument UNAPPLIED`) × (`requestReservationIntent`, `salesOrderAction('submit')`, `confirmSalesDelivery(...)`)。Round 4 注释的 planned-but-not-executed race classes（同一 `sales_order_id` 多 Prepayment Gate 同 snapshot_key 重放；多个独立 `salesOrderAction('submit')` 同一 SO 上并发；OQC 完成前 delivery confirm 并发）在 real MySQL 仍未跑过；Stage 3 仅允许在 `mysql-sales-customer-wave7-concurrency.integration.js` 内沿既有架构扩展 worker，不得新启独立 gate 文件或新 worker 文件。
- **Business invariants asserted**：同一 `sales_order_id` PLANNING_RELEASE / RESERVATION / DELIVERY 顺序放行；同一 `planning_reservation` 双消费合并 ≤ grant；R-SAL-15 Finance mutation 与 Sales locked-read 在 `settlement_unapplied_balances.id` 上 lock 串行；失败后 gate_result / intent / planning_reservation / inventory_lock / audit / idempotency_record 同时保持初始或同时回滚；stage gate 状态与 SO status / DN status / delivery status 不出现 partial side effects。
- **Failure stop**：若该 suite 在 real MySQL 上 fail，Stage 3 必须保留完整 stderr / stdout / 失败断言文本，最小修复仅限上述架构内的同步扩展或 worker command 增加，不得新启独立 gate 文件。

##### 29.17.7.7 Failure-dispatch table (real MySQL gate failure triage)

| 失败类型 | Stage 3 disposition |
|---|---|
| `ER_KEY_COLUMN_DOES_NOT_EXITS`（errno 1072）或索引 DDL `` `null` `` literal | 重审 `mysql-schema.js` `useDigest` / `hasExpressionColumns` / `mysqlIndexColumnList` 是否仍漏表达式列；优先扩展 `useDigest` 判定而非新增 case |
| `Wave 7 MySQL column conflict: ... default`（含 `source_balance_identities` / `intent_state` / `ratio_basis` 等 default） | (a) 优先扩展 `normalizeDefault` 正则覆盖新观察到表示 / charset prefix；不得放宽 `assertMySqlColumnContracts`；(b) 仅当 (a) 无法匹配且观察到具体 `[information_schema.COLUMNS.COLUMN_DEFAULT]` 文本时退回 DDL 改写（如 `DEFAULT '[]'` 取代 `DEFAULT ('[]')`），并在新 DDL 上重建测试 fixture |
| `Wave 7 MySQL column type mismatch: ... ratio_basis is longtext, expected varchar(16)` | 检查 `MAX(CHAR_LENGTH(...))` 探针（与 §29.17.7.3 第 (iii) 项对齐，字符宽度语义）；预存字符数超宽 → 拒绝修改，必须由用户单独批准 canonical 契约宽度 |
| `Wave 7 MySQL narrowing conflict: ... stored values up to N chars` | 同上：失败即停，记 `REQUIREMENT_REOPEN_REQUIRED` |
| `Wave 7 MySQL uniqueness conflict: duplicate normalized reservation intent identity` | fail-closed by design；记录 duplicate 来自何处（历史导入 / fixture / 真实场景）；若是历史数据请 `REQUIREMENT_REOPEN_REQUIRED`，若是 fixture 错误请修正 fixture |
| `Wave 7 MySQL CHECK conflict: <name>` | 检查 `CHECK_CLAUSE` 文本归一化是否覆盖；扩展 `normalizeMySqlExpression`；或若 V22 canonical 表达式与迁移表达式因 whitespace / 大小写分歧，调整迁移或 [CHECK_CONSTRAINTS] 的归一化 |
| Concurrency 类（reservation overbooking / gate re-evaluation race / R-SAL-15 lock 串行化失败） | 重审 §29.17.7.6 架构；最小扩展 worker 或 waitAtGate 同步；不得新启独立 gate 文件 |
| Gate `MYSQL TEST ENVIRONMENT = UNAVAILABLE` 或 gate-level reset 失败 | `TEST_EVIDENCE_PENDING`；不宣称 PASS；记录并向用户申请 disposable DB 授权 |
| Test harness / fixture 缺陷（不属于实现 / 迁移 / 契约缺陷） | 仅当失败信号明显指向测试期望错误（如新信息揭示原有期望即违反新约束）时修正 fixture；任何对 assertion 的删除 / 合并 / 放宽都不允许 |
| 实在与既有 §34 商业语义冲突的新发现 | 立即停；记 `REQUIREMENT_REOPEN_REQUIRED`；不回滚已 PASS；只允许记录 |

##### 29.17.7.8 Files explicitly NOT touched in this Stage 2 / not to be touched by Stage 3 without separate authorization

`document.md` §34.3.12 / §34.3.13 / DR-SAL-01..05 / 04·05 superseding / Wave 6 frozen footer / historical baseline footer / any frozen SC / UAT / Race / Audit CAP identifiers / counts (114/20/44/24/36) — **NOT touched** by Stage 2/3 unless the user reopens under `REQUIREMENT_REOPEN_REQUIRED`.

`solution.md` §29.16.1–8 / §29.17.1–6 / any preceding §29 / §30 content — **NOT modified**; Stage 3 may APPEND new §29.17.x sub-sections for additional implementation evidence after each fix, but never alter prior paragraphs.

`server/database/mysql-schema.js` core reconciliation logic (lines around `useDigest` / `hasExpressionColumns` / `mysqlIndexColumnList` / `generatedPartialIndex`) — currently green; Stage 3 may extend but not regress behavior in a way that re-introduces the `null`-column literal bug.

`server/database/mysql-schema-bug-fix.test.js` — currently 25/25; Stage 3 must preserve all 25 assertions.

`server/sales-customer-wave7-migration.test.js` / `server/sales-customer-wave7-functional.test.js` / `server/sales-customer-wave7-acceptance.test.js` — must be preserved verbatim; Stage 3 may ADD test cases only, never delete.

`server/mysql-sales-customer-wave7.integration.js` / `server/mysql-sales-customer-wave7-concurrency.integration.js` / `scripts/gates/mysql-concurrency-sales-wave7-worker.mjs` — extend only along §29.17.7.6 architecture; do not replace.

`scripts/gates/mysql-gate.mjs` / `scripts/gates/mysql-concurrency-gate.mjs` gate-level reset / fail-closed checks — preserve verbatim.

`src/pages/sales-wave7.jsx` / `src/navigation/applicationRegistry.js` (Wave 7 routes) — Stage 3 不动。

`scripts/testing/test-suites.js` registry — Stage 3 不动。

`APPLY_GUIDE.md` / `README.md` / `AGENTS.md` / `CLAUDE.md` / `package.json` / release tags / prior log entries — Stage 3 不动。

##### 29.17.7.9 Stop conditions for Stage 3 (mirrors DR-SAL-06 §A.5 + Wave 7-specific)

- HEAD drift from `0d4e4b8a0b71d43551072349b55f494d9a439b53`;
- Non-authorized tracked-file diff at any time;
- Non-authorized edits to `APPLY_GUIDE.md` / `README.md` / `AGENTS.md` / `CLAUDE.md` / `package.json` / release tag;
- Deletion, merging, skipping or relaxation of any already-PASS SQLite focused assertion;
- SQLite PASS being cited as real-MySQL gate PASS;
- Exception rewritten into a success response;
- Any unilateral declaration of Wave 7 Acceptance PASS or FROZEN before the §A.3 C1 / C2 / C3 are simultaneously satisfied by real MySQL evidence and the user has given a separate explicit acceptance;
- Any modification to Wave 6 frozen contract or §34 frozen business text;
- Any DML/DDL on a non-`modern_erp_domain_test` database.

##### 29.17.7.10 Rollback / data preservation

- 每条 Stage 3 修复 commit 之前由 gate 自行 fail-closed reset / `SHOW TABLES = 0` 验证 DB 干净；commit 后追加 `log/2026-10-18.md` append-only 说明。
- 真实 MySQL `modern_erp_domain_test` 是 disposable 数据库；任何中途失败均由 gate-level reset 重新清理，下一次 gate 跑前 `SHOW TABLES = 0`。
- 不允许任何 ALTER / DROP 触及既有 Wave 1–6 表与 §34.3.12 / §34.3.13 之前的 canonical 表，包括 `settlement_unapplied_balances`、`planning_reservations`、`inventory_locks`、`sales_orders`、`sales_order_items` 等。
- 任何最小修复如果影响 `DEFAULT` / `CHECK` / `UNIQUE` / `FOREIGN KEY` 语义，必须先在 `mysql-schema-bug-fix.test.js` 与 `sales-customer-wave7-migration.test.js` 中加入新 fixture；不允许在真实 DB 上做 trial-and-error。

##### 29.17.7.11 Approval gate

This Design Closure is not Stage-3-authorizing until the user explicitly approves this sub-section + the corresponding `log/2026-10-18.md` Design Closure entry. After user approval and during Stage 3:

- Stage 3 may apply minimal fixes per §29.17.7.2 table + §29.17.7.7 failure-dispatch.
- Stage 3 may execute ONLY `pnpm.cmd test:mysql` and `pnpm.cmd test:mysql:concurrency` per DR-SAL-06 §A.2.1.
- Stage 3 must preserve all files in §29.17.7.8 verbatim unless §A.5 stop conditions force a `REQUIREMENT_REOPEN_REQUIRED` return.

##### 29.17.7.12 Wave 7 Implementation Acceptance & Freeze Record (USER APPROVED 2026-10-19)

**Decision: ACCEPTANCE PASS / FROZEN — `WAVE7_FINAL_ACCEPTANCE_PASS — FROZEN`**

This record is a documentation-only append that re-states the Wave 7 acceptance outcome and points to the supporting evidence. It does NOT modify any §29.17.7.x sub-section, §34 frozen design, or §29.x frozen Design in this file; it does NOT introduce a new technical design, new module / function / API / schema / migration / test / gate / package / release tag.

**Acceptance Contract satisfaction** (per DR-SAL-06 §A.3 + §29.17.7.11, both preserved verbatim):

| §A.3 condition | Status (real MySQL evidence) |
|---|---|
| §A.3.C1 migration contract (fresh / upgrade / idempotent rerun, three carrier PK / FK / CHECK / UNIQUE / default / precision) | **SATISFIED** — `pnpm.cmd test:mysql` 56/56 PASS on the disposable `modern_erp_domain_test` MySQL 8 instance; Wave 7 migration / metadata suite 4/4 + Wave 0 migration runner smoke 2/2 + V1.3 Phase 7A SQLite-to-MySQL conversion rehearsal 1/1 verified at real MySQL; `normalizeDefault` regex extension (`[()'"\s\\]`) added to accept MySQL 8.0.37's `_utf8mb4\'[]\'` literal-backslash default form for `sales_prepayment_gate_results.source_balance_identities`. The previously-reported table total of "58" reconciles to a sum of 56 visible per-suite counts with the remaining 2 tests mapped to the unlisted suite inside the "16 suites" framing; the closure report and the corresponding log entry record this disclosure explicitly. |
| §A.3.C2 business uniqueness + completeness | **SATISFIED** — `pnpm.cmd test:mysql` Wave 7 metadata 4/4 verifies FK + UNIQUE + CHECK + default / precision for all three Wave 7 carriers; `V1.4.1 hotfix` additive upgrade suite PASS; V21 inventory position-key uniqueness exercised in V21 14 race suite. |
| §A.3.C3 concurrency invariants (independent MySQL sessions, transaction overlap, R-SAL-15 lock chain) | **SATISFIED** — `pnpm.cmd test:mysql:concurrency` 87/87 PASS across 9 / 9 suites including Wave 7 concurrency suite 3 / 3 subtests with real spawned-worker independent MySQL session evidence: (a) PLANNED_ORDER finite-supply competition — 3 workers on distinct `MySqlSyncAdapter` connections, sync anchored on `mysql_transaction_gates.gate_id=1` FOR UPDATE; (b) Gate competes with `apply-unapplied` / `create-refund` / `reverse-settlement` Finance mutations on canonical PREPAYMENT parents — 3 scenarios × real cross-session interleaving, with canonical 13-column inventory fixture seeded via `computePositionKey` from `server/lib/inventory-position.js`; (c) `PLANNING_RELEASE` submit + `DELIVERY` confirm compete with all three Finance mutations — 6 scenarios × real cross-session interleaving. |

**Manual regression attestation** (project owner, 2026-10-19, current dirty working tree at HEAD `0d4e4b8`):

- `pnpm.cmd test:fast` → PASS
- `pnpm.cmd test` → PASS
- `pnpm.cmd test:heavy` → PASS
- `pnpm.cmd build` → PASS

**Disclosed TAP raw-log archive limitation** (non-blocking, non-failure per DR-SAL-06 §A.4.3): the complete TAP-style raw terminal output for the two real-MySQL gates in this round was not archived into `.tmp/` (the directory's MySQL logs are dated `2026-10-10` and pre-date Wave 7 implementation). This limitation is recorded here as a transparent evidence-handling disclosure. Per DR-SAL-06 §A.4.3 + the user's explicit 2026-10-19 approval, this disclosure does not constitute a §A.3 evidence failure and does not block Wave 7 Acceptance PASS / FROZEN; future rounds should archive `.tmp/*.log` for each real-MySQL gate invocation as a process improvement.

**Implementation location mapping** (additive only; no §34 contract change):

- `server/migrations/sales-customer-wave7-prepayment-reservation.js` — additive migration with MySQL 8 `assertMySqlColumnContracts` + `normalizeDefault` charset-prefix-with-escaped-quotes regex extension.
- `server/sales-customer-wave7-migration.test.js` — focused migration tests; new test case added for the MySQL 8.0.37 production-stored default form.
- `server/mysql-sales-customer-wave7.integration.js` — registered in `scripts/gates/mysql-gate.mjs`; real-MySQL Wave 7 migration / metadata suite.
- `server/mysql-sales-customer-wave7-concurrency.integration.js` — registered in `scripts/gates/mysql-concurrency-gate.mjs`; Wave 7 independent-session concurrency suite (3 subtests).
- `scripts/gates/mysql-concurrency-sales-wave7-worker.mjs` — Wave 7 worker driving real `applyUnappliedBalance` / `createRefund` / `reverseSettlementDocument` / `request-reservation` entries on independent connections.
- `server/mysql-sales-customer-wave0.integration.js` / `server/mysql-sales-customer-wave1-upgrade.integration.js` — minimal fixture-drift repair removing the three Wave 7 carriers from `WAVE7_PLUS_SALES_TABLES` and adding `'wave-7-prepayment-reservation'` to the Wave 1 upgrade expected migrations array.
- `src/navigation/applicationRegistry.js` — `sales-prepayment-gates` + `sales-reservation-intents` contextual routes.
- `src/pages/sales-wave7.jsx` — PrepaymentGates + ReservationIntents mobile-first surfaces; uses `api` direct call replacing the prior `formatError` shim.
- `scripts/acceptance/sales-customer-wave7-responsive.mjs` — browser UAT at 320 / 390 / 430 / 680 CSS px; screenshots in `docs/evidence/sales-customer-wave7/`.

**Boundaries** (preserved verbatim, not modified by this record):

- HEAD = `0d4e4b8a0b71d43551072349b55f494d9a439b53` / branch = `feature/sales-waves6-13` / package = `1.6.2`.
- 8 accepted working-tree modifications: `document.md` / `solution.md` / `log/2026-10-18.md` / `server/migrations/sales-customer-wave7-prepayment-reservation.js` / `server/sales-customer-wave7-migration.test.js` / `server/mysql-sales-customer-wave0.integration.js` / `server/mysql-sales-customer-wave1-upgrade.integration.js` / `server/mysql-sales-customer-wave7-concurrency.integration.js`. All remain unstaged and uncommitted at the moment of this Freeze record.
- No `git add` / `git commit` / `git push` / `git merge` / `git rebase` / `git reset` / `git clean` / `git stash` / `git tag` / `git push --tags` / `release` / `deploy` is authorized by this record; the accepted working tree awaits the user's separate manual Git handling.
- No `APPLY_GUIDE.md` / `README.md` / `AGENTS.md` / `CLAUDE.md` / `package.json` / release tag modification.
- No new SC / Invariant / UAT / Race / Audit Capability ID; SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36 counts unchanged.
- Wave 6 (`WAVE6_FINAL_ACCEPTANCE_PASS — FROZEN`, HEAD `aee1e0c`) remains unchanged.
- Wave 8–13 remain `OUT_OF_SCOPE` and are not authorized to start by this record.
- No new test or database operation was performed in this bounded documentation closure.

**Final governance status: WAVE7_FINAL_ACCEPTANCE_PASS — FROZEN — USER APPROVED (2026-10-19).**



#### 29.19.4 Frozen-domain integration contract status

```text
Inventory V21 (canonical_position): owner_type / owner_id attributes at position-key
  level ALREADY distinguish ENTERPRISE / CUSTOMER ownership.
  This Domain closure uses ENTERPRISE for consignment; no BOUNDED INTEGRATION
  CONTRACT EXTENSION is required FOR §29.19 given this interpretation.

IF Implementation phase discovers Inventory V21 cannot currently express
ENTERPRISE-owned at consignment_commodity_location, then file:

  FROZEN_DOMAIN_INTEGRATION_CONTRACT_EXTENSION_REQUIRED

and revise this §29.19 before Implementation begins. Do NOT silently redefine
CUSTOMER-owned as a proxy.
```

#### 29.19.5 Distinction from CUSTOMER-owned (entrusted material)

```text
Customs Customer-owned (entrusted material):
  meaning       = customer-owned stock physically at our warehouse
                 OUR organization may sell/use it only per entrusted rule
  Layer 2 owner = CUSTOMER (different from consignment!)
  Layer 1       = Inventory V21 canonical_CUSTOMER-owned_entrusted flow

Consignment:
  meaning       = seller-owned stock physically at customer / consignment site
  Layer 2 owner = ENTERPRISE (seller)
  Layer 1       = consignment_commercial_documents (this Design)

These are TWO DIFFERENT business meanings.
They MUST NOT share identifier.
```

### 29.20 Credit Architecture Overview

```text
Layer A: Credit Policy       (parameters + rules; effective-dated, with
                                lockable snapshot anchor)
Layer B: Credit Profile      (per-customer limit; rating; overdue policy;
                                effective-dated, lockable against mutations)
Layer C: Credit Exposure     (PURE_DERIVED; never a mutable second ledger;
                                consumed from Finance + Sales canonical facts)
Layer D: Credit Decision     (credit_check_result; with policy + profile
                                snapshot identity; R-SAL-24 + R-SAL-12)
Layer E: Credit Exception    (credit_special_approval; bounded authority;
                                §29.26; snapshot-locked)
Layer F: Credit Evaluation   (indicator / scheme / model / scoring sheet /
                                result / rating applied to profile)

Recognition-mode aware:
  Credit Exposure MUST consume the same Finance recognition-mode contracts
  as V22 §28.2 (DIRECT_BUSINESS_OPEN_ITEM, INVOICE_DRIVEN_OPEN_ITEM,
  PROVISIONAL_TO_FINANCIAL). Bucket transitions differ by mode.

Sales never writes:
  AR open items
  Advance Receipt / Unapplied
  Collection / Refund / Write-off
  Invoice / Treasury / Voucher / GL

Sales reads via:
  financeAdapter.resolveCreditExposureComponents(...) (§29.23)
  financeAdapter.resolveEligiblePrepaymentForSalesGate(...) (§29.16)
  financeAdapter.resolveARForCustomerSalesContext(...) (§29.23)
  assertStrongReservationAvailability (Planning, §29.17)
  applyInventoryMutation / postTrackedMovement (Inventory V21, on SD confirm)
  OQC adapter (M&Q V18, on SD confirm)
```

### 29.21 Credit Policy / Version / Effective Snapshot

Stable long-lived lock identity (Lock-Anchor Final Closure decision):

```text
credit_lock_anchors (REFINED; replaces A-62):
  id (PK; stable, never replaced)
  anchor_key           (NOT NULL, UNIQUE; canonical non-null uniqueness identity)
  anchor_type          (CHECK IN ('CREDIT_OBJECT','POLICY_SCOPE'))
  customer_id          (FK customers.id, nullable)
  salesperson_id         (FK salesperson_profiles.id, nullable)
  credit_object_type   (text, nullable; CREDIT_OBJECT anchor only)
  credit_object_id     (text, nullable; CREDIT_OBJECT anchor only)
  policy_scope_type    (text, nullable; POLICY_SCOPE anchor only;
                        e.g. 'GLOBAL', 'SALES_ORG', etc.)
  policy_scope_id      (text, nullable; POLICY_SCOPE anchor only)
  created_at
```

Why `anchor_key` is the canonical uniqueness (not nullable composite UNIQUE):

```text
- sales_lock_anchor (decomposed nullable columns) is permitted to have
  multiple rows where any nullable component is NULL under MySQL (and
  would also behave inconsistently under partial-index MySQL semantics
  vs SQLite).
- anchor_key is a NOT NULL deterministic string built at provisioning,
  e.g. for CREDIT_OBJECT:
      CUSTOMER:<customer-id>:SALESPERSON:<id-or-ALL>:OBJECT:<type>:<id>
  e.g. for POLICY_SCOPE:
      POLICY_SCOPE:<scope_type>:<scope_id-or-GLOBAL>
- UNIQUE(anchor_key) provides reliable cross-dialect (SQLite + MySQL) uniqueness.
- Decomposed nullable columns (customer_id / salesperson_id / policy_scope_*) are
  retained for FK + query convenience; they are NOT the sole uniqueness
  guarantee.

This anchor row is the PRIMARY long-lived lock identity for ALL Credit-control
serialization (R-SAL-12, R-SAL-24, R-SAL-13). It is created once per logical
scope and never replaced when profile / policy / snapshot versions change. New
profile effective rows or new policy snapshot rows are added beneath this
stable anchor.

#### 29.21.1 Anchor provisioning lifecycle (Final Closure)

Preferred rule:

```text
credit-lock anchor is provisioned
BEFORE any credit-consuming transaction can execute.
```

Provisioning paths:

```text
CREDIT_OBJECT anchor:
  - new customer: provisioned at customer creation OR on first
    credit-controlled transaction; creation is the SAME DB transaction
    as the first authorized credit-controlled read/write
  - new salesperson-specific credit object: provisioned at first
    credit-controlled transaction on that salesperson+customer combination
  - legacy customer backfill: deterministic bootstrap at domain cutover
    (one-time migration) over existing customers with credit_profile;
    creates anchor_key for each (customer, salesperson, credit_object_type,
    credit_object_id) tuple present in legacy credit_profile rows

POLICY_SCOPE anchor:
  - GLOBAL: provisioned at system install (or one-time bootstrap migration)
  - additional policy scope: provisioned at first policy scope creation
  - always present; if missing unexpectedly → FAIL CLOSED
```

Mandatory Credit Check must NEVER behave as:

```text
anchor missing
→ skip credit control
```

The rule is:

```text
anchor missing unexpectedly
→ FAIL CLOSED
until safely provisioned.
```

A first-use anchor creation INSIDE the first credit-controlled transaction
without a separate provisioning step is forbidden; it would create a
definition-vs-first-use race. The provisioning step is a distinct transaction
(or part of a system-init migration) that completes before any credit
consumption can race.

#### 29.21.2 Two anchor types — separation (Final Closure)

There are two different concurrency identities, kept separate:

```text
A. CREDIT_OBJECT anchor (one row per credit object):
   protects customer/salesperson credit capacity + profile-effective state
   + risk-increasing Sales transactions
   used by R-SAL-12 + Profile mutation + rating-result application

B. POLICY_SCOPE anchor (one row per policy scope):
   protects effective Credit Parameters + Credit Rules + scope-wide policy
   policy scope may be: GLOBAL, organization, sales org, other frozen
     Requirement-supported scope
   used by R-SAL-24 (policy/rule mutation path) + shared read of
     Credit Check (FOR SHARE under MySQL; same-tx serial under SQLite)
```

A single logical operation that legitimately touches BOTH (combined
mutation) acquires both anchors in a single deterministic order — see §29.25.3.

#### 29.21.3 Anchor first-use concurrency protocol (Final Two-Point Closure)

Two concurrent Credit Checks must not both observe:

```text
anchor does not yet exist
```

before either obtains the stable row lock. Therefore, every Credit-controlled
path begins with one canonical provisioning concept (name not design-finalizing):

```text
ensureCreditLockAnchor(anchor_type, anchor_key_components)
  → returns the canonical credit_lock_anchors.id FOR that anchor_key
```

Required semantics:

```text
1. derive deterministic non-null anchor_key from input components
   (CREDIT_OBJECT or POLICY_SCOPE)
2. attempt to provision the anchor (INSERT)
3. if INSERT succeeds:
     use the inserted row
4. if concurrent INSERT wins and this INSERT hits UNIQUE(anchor_key):
     re-read the already-created canonical row
     do NOT fail the business operation merely because another
     transaction provisioned it
5. acquire the canonical anchor row using the required lock mode
   (FOR UPDATE for the mutating path; FOR SHARE for the read-only path
   on POLICY_SCOPE; see §29.25.2-3)
6. only after the lock is acquired may Credit Check / mutation continue
```

The required invariant:

```text
one logical credit-control scope
→ exactly one canonical anchor
→ all contenders converge on that same row
```

Anchors are provisioned:

```text
CREDIT_OBJECT:
  - at customer creation (or first credit-controlled transaction)
  - via deterministic bootstrap migration for legacy customers
POLICY_SCOPE:
  - at system install (GLOBAL anchor)
  - via deterministic bootstrap migration for additional policy scopes
```

If an expected anchor is missing unexpectedly at the start of a mandatory
Credit Check / mutation, the only allowed behavior is:

```text
attempt safe deterministic provisioning once;
if it still cannot resolve the canonical row → FAIL CLOSED
```

Forbidden:

```text
anchor missing
→ continue without lock
```

#### 29.21.4 Cross-dialect provisioning semantics

```text
SQLite (BEGIN IMMEDIATE):
  anchor provisioning occurs inside BEGIN IMMEDIATE before the protected
  Credit decision / mutation proceeds. The serialized write discipline
  matches the rest of the Sales mutex model; first-write wins, follow-on
  reads see the canonical row.

MySQL 8 (deterministic anchor_key + UNIQUE):
  concurrent INSERTs of the same anchor_key collide on UNIQUE;
  the loser catches the duplicate-key error and re-reads the canonical row.
  The pattern is:
    INSERT credit_lock_anchors (...)  →  on UNIQUE violation → SELECT
    the canonical row by anchor_key (FOR UPDATE / FOR SHARE as
    appropriate).
  Do NOT continue the Credit decision without re-acquiring the
  canonical row's lock; that is the first-use race this protocol prevents.
```

The protocol is the first-line guard against first-use race; FOR UPDATE / FOR
SHARE on the canonical row is the second-line guard.

物理对象 (versioned records, NOT the lock anchor):

```text
credit_parameters (NEW A-48):
  id, code (UNIQUE), value_text, value_int, value_bool, value_date,
  effective_from, effective_to,
  status ('DRAFT','ACTIVE','INACTIVE'),
  created_at, created_by, superseded_by_id (nullable)
  PRIMARY KEY (code, effective_from)

credit_check_rules (NEW A-49):
  id, rule_code, business_stage ('SO_SUBMIT','SO_APPROVE','SALES_DELIVERY_CONFIRM'),
  scenario ('STANDARD','OVERRIDE_REQUEST','WARNING_ONLY','BLOCK'),
  check_timing ('BEFORE_WRITE','AFTER_WRITE_DEFERRED'),
  control_strength ('WARNING','BLOCK'),
  credit_item (enum; L | D | ...; referenced entity),
  recognition_mode (CHECK IN recognized V22 modes;
                    NULL means applies to all modes),
  effective_from, effective_to, status,
  result_payload_json
```

```text
credit_policy_snapshots (NEW A-50; DECISION EVIDENCE identity, NOT primary lock):
  id (PK)
  snapshot_fingerprint (UNIQUE; computed from parameter_set + rule_set
                         + profile_effective_state + business_date)
  captured_at (timestamp)
  captured_by (FK users.id)
  credit_control_anchor_id (FK A-62; the stable lock anchor)
  parameter_set_hash (text)
  rule_set_hash (text)
  profile_effective_state_hash (text)
  business_date (DATE)
  notes_json (text nullable)
```

Lock identity (Final Closure decision):

```text
PRIMARY long-lived lock identity:
  credit_control_anchor.id (NEW A-62)
  - one stable row per (customer, salesperson, credit_object_type, credit_object_id)
  - UNIQUE
  - never replaced when profile / policy / snapshot versions change
  - acquired FOR UPDATE at the start of every Credit Check + every Credit
    mutation path

DECISION EVIDENCE identity (separately retained):
  credit_policy_snapshots.id (NEW A-50)
  - append-only by fingerprint
  - bound to credit_check_result row + credit_special_approval row
  - historical evidence, not the lock anchor itself
```

Lock acquisition order (Final Closure):

```text
1. credit_control_anchor (stable) FOR UPDATE  ← PRIMARY LOCK
2. credit_profile (effective row at business_date) FOR UPDATE
3. credit_policy_snapshots (NEW or matched by fingerprint) FOR UPDATE
4. credit_check_rules (effective) FOR UPDATE
5. effective version reads (parameters, rules) under those locks
```

Lock identity and decision-evidence identity are distinct (§29.5):

```text
lock identity       = credit_control_anchor.id   (stable; used for FOR UPDATE)
decision evidence  = credit_policy_snapshots.id + snapshot_fingerprint
                       (append-only; bound to credit_check_result row)
```

R-SAL-24 invariant enforced (Final Closure):

```text
Inside one Credit Check evaluation, all parameters and rules MUST come from
ONE snapshot identity (one credit_policy_snapshots row).
After evaluation, snapshot_identity (credit_policy_snapshots.id + fingerprint)
binds to credit_check_result row.
Later policy mutation CANNOT reinterpret this decision's outcome; if
revalidation required by policy, a NEW credit_policy_snapshots row + NEW
credit_check_result must be produced.
```

### 29.22 Credit Profile

`credit_profile` (NEW A-51) + `credit_profile_ratings` (NEW A-52)：

```text
credit_profile:
  id, customer_id (FK), salesperson_id (FK salesperson_profiles.id nullable),
  credit_object_type, credit_object_id,
  credit_limit_cents (BIGINT NULL = unbounded),
  initial_state (enum), status ('ACTIVE','SUSPENDED','CLOSED'),
  rating_grade, rating_effective_from, rating_effective_to,
  rule_id (FK credit_check_rules.id),
  effective_from, effective_to,
  created_at, created_by,
  PRIMARY KEY (customer_id, salesperson_id, credit_object_type, credit_object_id, effective_from)
  FK: implicit logical reference to credit_control_anchor.id (A-62) for the
     same (customer_id, salesperson_id, credit_object_type, credit_object_id)
```

`credit_profile_ratings`:
  id, credit_profile_id (FK), evaluation_result_id (FK credit_evaluation_result.id),
  applied_at, applied_by,
  superseded_at (nullable)

Effective-dating via `effective_from / effective_to`. SO Check at SO_SUBMIT reads effective profile at business_date; the effective row is locked FOR UPDATE during evaluation. Profile mutation FOR UPDATE acquires the same stable `credit_control_anchor.id` (A-62) lock before new profile rows may take effect, until in-flight checks complete.

Customer identity (Master & Engineering) remains in the composite primary key (`customer_id`); Sales extends.
Salesperson identity uses A-64 `salesperson_profiles.id`; optional A-64 `user_id` is never substituted as the Credit salesperson object.

#### 29.22.1 Credit missing-profile compatibility (fail-closed rule)

```text
Credit Management disabled              → no credit enforcement (gate bypassed)
Customer / scenario exempt by rule      → no credit enforcement (explicit rule)
Credit Management enabled
  AND mandatory rule applies            → credit_profile required; if missing/invalid
                                          → FAIL CLOSED (config / credit-control BLOCK)
```

A missing required Credit Profile MUST never silently turn mandatory Credit Control off. Legacy compatibility cannot weaken mandatory BLOCK fail-closed.

Customer-readable display for missing-profile cases: `Credit profile required` + admin action item; never PASS without evaluation.

### 29.23 Credit Occupancy / Exposure Model

#### 29.23.1 设计：PURE_DERIVED 投影 (not persisted mutable)

```text
Credit exposure = DERIVED computation over canonical facts.
No physical `credit_exposure` table.

Source canonical facts:
  Sales: sales_orders.approved exposure (total_cents of APPROVED SO within exposure window)
  Sales: sales_deliveries.delivered-not-yet-settled exposure
  Finance: account_receivables.open amount
  Finance: settlement_unapplied_balances (eligible advance offsets)
  Finance: financial_credit_adjustments (returns / discounts / write-offs)
  Finance: payment_collections (collection reductions)

Equation (transition-aware):

E = SUM(approved SO commitment, age <= window or until delivered)
  + SUM(delivered-not-settled)
  + SUM(AR open by source SO item)
  + SUM(overdue AR)
  - SUM(eligible advance / unapplied applied)
  - SUM(returns / credits applied)
  - SUM(collections applied)
  - SUM(write-offs)
```

#### 29.23.2 Recognition-mode-aware bucket transition (Final Closure exact matrix)

For the same economic amount X (or any sub-amount), the bucket transitions are
mutually exclusive. The same amount X is in exactly one of A / B / C / P / E /
D-overdue (where D is a subset of C) at any instant.

```text
Mode 1: DIRECT_BUSINESS_OPEN_ITEM (LEGACY_DIRECT semantic)
  Before delivery of X:
    A (approved SO commitment) = X
    B (delivered-not-settled)  = 0
    C (final AR open)         = 0
    P (provisional)           = 0
  On Sales Delivery confirm, Finance creates final AR in the canonical
  Sales+Finance transition. For quantity/value X committed in the SO:
    A -= X
    C += X
  (atomic / logically as one transition; no separately additive B for the
  same portion after final AR exists. Any internal transient calculation
  is NEVER separately countable exposure.)

Mode 2: INVOICE_DRIVEN_OPEN_ITEM (SEPARATE semantic)
  Before delivery of X:
    A = X; B = C = P = 0
  At Sales Delivery confirm:
    A -= X
    B += X              ← operational evidence; no AR yet
  At Sales Invoice post:
    B -= X
    C += X              ← final AR open

Mode 3: PROVISIONAL_TO_FINANCIAL (AUTO_BILL semantic)
  Before delivery of X:
    A = X; B = C = P = 0
  At source / delivery recognition:
    A -= X
    P += X              ← provisional exposure
  At provisional → final conversion (Sales Invoice / final receipt post):
    P -= X
    C += X              ← final AR open
  No ordinary settlement against P; no P + C coexistence for same X.
```

Partial-quantity / partial-value transitions example (per task §7):

```text
SO value = 100

deliver 40  (Mode 2):
  A = 60
  B = 40
  C = 0

Invoice 25:
  A = 60
  B = 15
  C = 25

Collection 10:
  A = 60
  B = 15
  C = 15
```

Mode 1 / Mode 3 follow the same partial arithmetic over the corresponding
buckets. The exact exposure formula must make it impossible for one economic
amount to occupy two incompatible stages simultaneously.

Overdue (D): NOT a separate additive exposure bucket. D is a subset of C
(AR open) per the V22 frozen overdue / provisioning_status semantic.
Therefore:

  used credit
  must NOT add:  C + overdue(C)
  (unless the frozen Requirement explicitly defines an extra risk multiplier,
   which it did not)
```

#### 29.23.3 Forbidden double-count (recognition-mode aware)

```text
For mode 1:  SO commitment + delivered-not-settled + AR open CANNOT count the
            same economic amount twice; Bucket A reduces as B grows; B reduces
            as C grows; C reduces as E grows.
For mode 2:  A → B is non-AR; B → C is AR at invoice post; no other overlap.
For mode 3:  A0 → P (Provisional) at receipt; P → C at final; A0 does NOT
            become C directly; P is NOT in approved SO commitment E.
            Provisional + AR open cannot both count.
required invariant:
  one economic customer exposure
  must occupy exactly the intended credit-risk bucket(s)
  under the active recognition mode
```

#### 29.23.4 Eligibility & R-SAL-15 (Prepayment Gate)

The Prepayment Gate reads ONE canonical Finance-side eligible prepayment value via `financeAdapter.resolveEligiblePrepaymentForSalesGate(...)` (see §29.16); no SUM of disjoint balance rows. The eligible amount is per (customer, business_date, gate_stage, sales_order_id, remaining_required_cents). Sales records the gate decision in `sales_prepayment_gate_results` with the source balance identities captured (audit trace).

#### 29.23.5 Sales cannot reconstruct AR truth

```text
Sales MUST NOT:
  reconstruct AR truth independently
  reinterpret provisional/final Finance recognition
  mutate Finance open items

Sales MUST use:
  frozen Finance recognition / source adapter or canonical query contract;
  if a new read adapter needed, define the integration contract (NOT a second
  Sales ledger).
```

#### 29.23.6 Forbidden

```text
no second mutable Sales/Finance credit exposure ledger
no SUM that silently double-counts SO + delivered + AR + overdue (per mode)
no static copy of canonical figures into Sales tables
no single static pre-computed credit_exposure row anywhere
```

#### 29.23.7 Amount-delta clarification (Final Closure)

`X` in §29.23.2 transitions means **matched economic credit-risk amount** (matched
at Sales side), not blindly the SO line quantity. If the downstream final AR differs
from the upstream commercial exposure due to legitimate:

```text
tax assumption → invoice tax truth
rounding (cents)
bounded invoice adjustment
```

then the transition is conceptually:

```text
release upstream commercial exposure amount U (from Sales side)
add canonical downstream exposure amount F (from Finance AR)
```

rather than assuming `U == F`. The delta is `F - U`; it is explicit, non-duplicative,
and reconciled by canonical Finance AR truth. Still never count the same economic
component in two incompatible stages simultaneously. Do NOT redesign Finance
recognition; this only reconciles the Sales-side exposure component with the
Finance-side AR component per bucket transition.

### 29.24 Credit Projection / Cache Decision

#### 29.24.1 Decision: PURE_DERIVED (default baseline)

```text
chosen: PURE_DERIVED
evidence: frozen §33 Finance V22 + V21 Inventory + V19 Planning canonical
         provide all source facts; query-layer projection is sufficient for
         current scale.

implication:
  R-SAL-23 = structurally NON_MATERIALIZED (no rebuild cache to protect).
  R-SAL-23 remains in this Requirement set as conditional for transparency but
  does NOT need an executable Materialize gate under this choice.
```

#### 29.24.2 If a future scope requires persisted cache

```text
would require: source facts remain canonical;
              rebuild deterministic;
              CHECK reconciliation available;
              drift detectable;
              rebuild must never overwrite newer exposure state
              (the one economic amount invariant);
              R-SAL-23 becomes mandatory executable concurrency acceptance.
```

Decision: stay PURE_DERIVED for this baseline; if future Implementation evidence changes, re-open Requirement.

### 29.25 Credit Check Technical Design

`evaluateCredit(input)`:

```text
INPUT:
  customer_id
  salesperson_id (nullable)
  sales_order_id / sales_delivery_id (which stage)
  business_date
  proposed_exposure_delta_cents
  recognition_mode                       (one of V22 §28.2 modes; defaulted
                                          from sales_delivery.billing_mode or
                                          financeAdapter.active_mode)

PROCESS (canonical lock order; see §29.43; Lock-Anchor Final Closure):
  0a. acquire POLICY_SCOPE anchor (NEW A-62 row WHERE anchor_type='POLICY_SCOPE')
      FOR SHARE  (MySQL; read of shared policy) — multiple Credit Checks may
                share-policy-read concurrently
      [SQLite: BEGIN IMMEDIATE serializes writers; same effective result]
  0b. acquire CREDIT_OBJECT anchor (NEW A-62 row WHERE anchor_type='CREDIT_OBJECT'
      AND anchor_key matches the credit object) FOR UPDATE
  1. read financeAdapter.resolveCreditExposureComponents(...) including:
     - current approved SO commitment (per mode)
     - delivered-not-settled (per mode)
     - Finance AR open amount (per mode)
     - eligible prepayment via
       financeAdapter.resolveEligiblePrepaymentForSalesGate(..., lockMode=FOR_UPDATE)
       (one canonical Finance value + same-tx shared lock; see §29.16)
     - already applied via earlier gates / refunds / write-offs
     (every component carries its source identity for audit)
  2. acquire remaining locks in canonical order:
     a. credit_profile effective row FOR UPDATE
     b. credit_policy_snapshots FOR UPDATE (create or select by fingerprint)
     c. credit_check_rules effective rows FOR UPDATE
  3. read effective policy snapshot identity
     (= credit_policy_snapshots.snapshot_fingerprint)
  4. compute current exposure E per §29.23.2 (recognition-mode aware)
  5. proposed_total = E + proposed_exposure_delta_cents
     (also accounting for any offset consumed by this Prepayment Gate application)
  6. available_buffer = credit_limit - E (effective profile)
  7. decision:
     if rule STRENGTH = BLOCK and proposed_total > credit_limit:
       decision = 'BLOCK'  (mandatory; backend fail-closed)
     elif rule STRENGTH = WARNING and ... :
       decision = 'WARNING'
     if special_approval_available and approved_authority(scope):
       decision = 'SPECIAL_APPROVAL_REQUIRED'
     else (no configured rule / no matching):
       decision = 'PASS'
  8. capture credit_policy_snapshots.id + fingerprint in result record
     (decision evidence; NOT the primary lock — see §29.21)
  9. write credit_check_result (NEW A-54) in same tx (commit-or-rollback)
 10. write audit with policy_snapshot_fingerprint + business_date
 11. COMMIT (releases credit_control_anchor lock)
```

#### 29.25.1 credit_check_result (NEW A-54)

```text
credit_check_result:
  id (PK),
  sales_order_id (FK), sales_delivery_id (FK nullable),
  stage, proposed_delta_cents,
  credit_control_anchor_id (FK A-62; the stable lock anchor),
  credit_policy_snapshots_id (FK; DECISION EVIDENCE identity),
  policy_snapshot_fingerprint (text),
  profile_effective_state_hash (text),
  recognition_mode (text),
  decision ('PASS','WARNING','BLOCK','SPECIAL_APPROVAL_REQUIRED'),
  reason_codes_json,
  component_breakdown_json (per bucket, recognition-mode aware),
  eligible_prepayment_source_identity (text),
  special_approval_id (FK nullable; must equal the credit_special_approval.id
                        bound on success),
  evaluated_at, evaluated_by
```

Decision artifact; NOT a second exposure ledger. Source-of-truth for `Special Approval`
must point back at the exact `(credit_policy_snapshots_id, fingerprint)` pair that
produced the `SPECIAL_APPROVAL_REQUIRED` decision.

#### 29.25.2 R-SAL-12 anchor (PURE_DERIVED exposure; credit consumption serialization)

Credit Exposure has no persisted mutable row; therefore R-SAL-12 must serialize on a
Sales-owned ANCHOR — not on a nonexistent exposure balance row.

```text
PRIMARY long-lived lock identity for R-SAL-12 =
    credit_lock_anchors.id  (REFINED, replaces A-62;
                              anchor_type = 'CREDIT_OBJECT';
                              UNIQUE on anchor_key)
    FOR UPDATE on the credit-object anchor row
```

For two concurrent risk-increasing Sales transactions (e.g. two SO submits, two SD
confirms, or SO submit + SD confirm with overlapping risk-increasing delta), both must
acquire the credit-object anchor row FOR UPDATE in the SAME canonical order; whichever
wins blocks the other at the anchor row lock. The blocked transaction reads the updated
state (which now includes the winner's committed Sales source fact) and re-evaluates
against it.

```text
risk-increasing transaction A  vs  risk-increasing transaction B
  → serialize on credit_lock_anchors.id
    (anchor_type='CREDIT_OBJECT', anchor_key matches this credit object)
    FOR UPDATE
  → POLICY_SCOPE anchor FOR SHARE already acquired (allows multiple
    concurrent policy reads during this credit check)
  → credit_profile effective row + credit_policy_snapshots + rules
    are acquired beneath the anchor
  → one wins; the loser re-reads and re-evaluates
  → combined committing commitments ≤ available credit capacity
```

The decision does NOT lock any non-existent Credit Exposure balance row; it uses
the stable credit-object anchor as the serialization identity.

Risk-releasing Finance event
(collection, refund, write-off, overdue transition)
  → Finance-owned; visible to Sales via Finance canonical source adapter
  → if visibility lag → conservative temporary BLOCK on the next Sales
    risk-increasing evaluation is acceptable (mandatory BLOCK fail-closed)
  → never causes over-credit approval

Distinction between risk-increasing and risk-releasing events is essential. Sales-owned
anchors do not require frozen Finance mutations to acquire new locks; only Sales-owned
readers acquire them.

#### 29.25.3 R-SAL-24 (coherent effective policy snapshot; two anchor types; lock order)

R-SAL-24 protects two independent mutation classes against a Credit Check; the final
model distinguishes them.

```text
CREDIT_CHECK path (consumer of policy):
  1. acquire POLICY_SCOPE anchor FOR SHARE  (multiple checks may share
                                              policy reads concurrently;
                                              FOR SHARE under MySQL; same-tx
                                              serial under SQLite BEGIN IMMEDIATE)
  2. acquire CREDIT_OBJECT anchor FOR UPDATE
  3. resolve effective: parameters / rules / profile / limit / overdue / rating
  4. construct one immutable decision snapshot (credit_policy_snapshots insert
     or select by fingerprint; record fingerprint + anchor identity)
  5. evaluate decision; bind to credit_check_result
  6. commit

POLICY / RULE MUTATION path:
  1. acquire POLICY_SCOPE anchor FOR UPDATE  (exclusive on policy scope)
  2. apply new effective version(s) of credit_parameters / credit_check_rules
  3. effective rows that change in the window may produce a new
     credit_policy_snapshots fingerprint on subsequent Credit Check
  4. commit

PROFILE / LIMIT / RATING MUTATION path:
  1. acquire CREDIT_OBJECT anchor FOR UPDATE
  2. apply new effective version of credit_profile (or rating_result application)
  3. commit

COMBINED POLICY + PROFILE MUTATION (one operation legitimately touches both):
  1. acquire POLICY_SCOPE anchor FOR UPDATE  (FIRST)
  2. acquire CREDIT_OBJECT anchor FOR UPDATE  (SECOND)
  Never reverse this order in another mutation path.
```

Immutable / append-only semantic for snapshots (Final Closure clarification):

```text
credit_policy_snapshots is IMMUTABLE / APPEND-ONLY.

A policy / profile mutation:
  1. acquires the appropriate anchor FOR UPDATE (POLICY_SCOPE and / or
     CREDIT_OBJECT)
  2. changes the EFFECTIVE source records (credit_parameters / credit_check_rules
     / credit_profile / rating application) under the lock
  3. commits; the existing credit_policy_snapshots rows are NOT modified
  4. a subsequent Credit Check observes a DIFFERENT fingerprint and either
     picks the existing matching row (fingerprint unchanged) or inserts a NEW
     credit_policy_snapshots row (fingerprint changed)

No mutation ever "updates" an existing credit_policy_snapshots row.
The row, once written, is historical evidence — append-only by definition.
```

```text
Credit Check path
  → acquire POLICY_SCOPE anchor FOR SHARE
  → acquire CREDIT_OBJECT anchor FOR UPDATE
  → create or select credit_policy_snapshots row by fingerprint
    (FOR UPDATE on the existing row if fingerprint matches; new INSERT
     if fingerprint does not match any existing row)
  → read effective parameters / rules / profile / limit / overdue / rating
  → evaluate decision; bind decision to credit_check_result row
  → commit

Allowed outcome per single Credit Check:
  complete OLD snapshot
  or
  complete NEW snapshot

Forbidden:
  mixed OLD/NEW components

`credit_policy_snapshots.id` is the decision evidence / version identity;
it is NOT the primary stable serialization anchor (that is
credit_lock_anchors.id where anchor_type='CREDIT_OBJECT' or 'POLICY_SCOPE').
```

`credit_lock_anchors.id` is the SERIALIZATION identity (lock).
`credit_policy_snapshots.id` is the DECISION EVIDENCE identity (append-only history).
The two are distinct; do NOT conflate.

#### 29.25.4 Special Approval snapshot identity (preserved)

```text
Credit Special Approval row carries:
  source_credit_check_result_id (FK credit_check_result.id; UNIQUE)
  source_credit_policy_snapshots_id (FK; same snapshot row as the check)
  source_policy_snapshot_fingerprint (text)
  source_profile_effective_state_hash (text)
```

The Special Approval row is bound to the exact `(credit_policy_snapshots.id,
fingerprint)` pair that produced the `SPECIAL_APPROVAL_REQUIRED` decision. The
stable `credit_control_anchor.id` is for SERIALIZATION only; the snapshot is for
HISTORICAL EVIDENCE only. They are distinct identities; do NOT conflate.

### 29.26 Credit Special Approval Technical Design

`credit_special_approval` (NEW A-53)：

```text
credit_special_approval:
  id, source_credit_check_result_id (FK credit_check_result.id; UNIQUE),
  source_sales_order_id (FK),
  source_credit_policy_snapshots_id (FK; same snapshot row as the check; NOT NULL),
  source_policy_snapshot_fingerprint, source_profile_effective_state_hash,
  reason, requested_override_cents, requested_expiry_business_date,
  requested_ceiling_cents,
  authority_ceiling_cents (snapshot from user.role at request time),
  decision ('PENDING','APPROVED','REJECTED'),
  approved_override_cents, approved_ceiling_cents, approved_expiry_business_date,
  scope ('ONE_TIME','TIME_BOUNDED','OBJECT_BOUNDED'),
  approver_id, decided_at,
  audit_id
  PRIMARY KEY (source_credit_check_result_id)
```

Constraints:
- approved_override_cents ≤ requested_override_cents ≤ authority_ceiling_cents at request time
- approved_expiry ≥ business_date; not in the past
- snapshot identity MUST match source_credit_check_result's snapshot identity
  (matched via source_credit_policy_snapshots_id + fingerprint)
- A later policy mutation CANNOT reinterpret this approval; if revalidation required by policy (e.g. rating downgrade), it must produce a NEW credit_check_result and NEW approval request — the old approval is read-only history

R-SAL-13 + R-SAL-24 interplay:
- Special Approval consumes R-SAL-13 with the `credit_special_approval` row lock
  (UNIQUE on source_credit_check_result_id) + the snapshot row lock
- The check that produced SPECIAL_APPROVAL_REQUIRED was bound to one snapshot
  (source_credit_policy_snapshots_id)
- The approval row carries the same snapshot identity
- A different credit check (different snapshot, e.g. next SO) gets a new approval flow

### 29.27 Credit Evaluation

`credit_evaluation_indicator` (NEW #47) + `credit_evaluation_scheme` (NEW #48) + `credit_evaluation_model` (NEW #49) + `credit_evaluation_scoring_sheet` (NEW #50) + `credit_evaluation_result` (NEW #51)。

Per-evaluator bounded. NO external bureau / AI / ML / complex corporate-risk analytics.

```text
credit_evaluation_indicator:
  id, code (UNIQUE), kind ('QUALITATIVE'|'QUANTITATIVE'),
  description, max_score (REAL)

credit_evaluation_scheme:
  id, code (UNIQUE), name, rating_grades_json

credit_evaluation_model:
  id, scheme_id (FK), name,
  applicable_from, applicable_to,
  indicator_weights_json,  -- [{indicator_id, weight}]
  scoring_sheet_template_json

credit_evaluation_scoring_sheet:
  id, model_id (FK), evaluator_id (FK users.id),
  customer_id (FK), profile_snapshot_identity,
  sheet_data_json,
  submitted_at, finalized_at

credit_evaluation_result:
  id, sheet_id (FK), scheme_id (FK),
  total_score, rating_grade,
  applied_at, applied_by,
  applied_to_profile_id (FK credit_profile.id)
  -- can apply update via credit_profile_ratings
```

Bounded multi-scorer via SC106: aggregation restricted to within one scoring_sheet instance with multiple evaluator entries; no global open-scorer pool.

### 29.28 Credit Recalculation

`credit_recalculation_history` (NEW #52)：

```text
credit_recalculation_history:
  id, kind ('CHECK_ONLY','DETERMINISTIC_REBUILD'),
  triggered_by, triggered_at,
  source_snapshot_window, scope_filter_json,
  result_summary, duration_ms,
  inconsistency_count, drift_detected
```

This history table is ONLY for human audit trail of when reconciliations ran; it does NOT store any derived/exposure data that would create a second ledger.

R-SAL-23 conditional semantics preserved (see §29.24). Pure CHECK-only is default; deterministic rebuild NOT exercised against any materialized cache in this baseline.

### 29.29 Credit Query / Exception History (DERIVED)

Layer 4 read-side:

```text
credit_query_snapshot -- DERIVED view only; not a table
exception_history -- READ from credit_check_result + credit_special_approval
                     joined with source SO / SD
```

No physical table for these results; constructed by query at the time of access.

### 29.30 Source / Capacity Model (canonical edge table, Micro-Closure corrected)

For every edge: source identity / target identity / original capacity / executed or converted / reversed or cancelled / remaining / canonical lock anchor.
For non-quantity edges: `capacity = N/A`.

| # | Source | Target | Source identity | Source line | Original capacity | Executed / Converted | Reversed / Cancelled | Remaining | Canonical lock anchor |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Quotation line | Sales Order line | sales_quotation_lines.id | sales_order_items.id | sales_quotation_lines.quantity | sales_quotation_conversions.converted_qty | (R-SAL-06; none today) | quantity − SUM(converted_qty) | sales_quotation_lines.id (R-SAL-06) |
| 2 | Sales Order line | Delivery Notice line | sales_order_items.id | sales_order_items.id | sales_order_items.quantity | SUM(delivery_notice_lines.scheduled_qty) | delivery_notice_lines.cancelled_notified_qty | SO quantity − SUM(scheduled) | sales_order_items.id (R-SAL-16) |
| 3 | Delivery Notice line | Sales Delivery line | delivery_notice_lines.id | sales_delivery_items.delivery_notice_line_id (= DN line id) | scheduled_qty − notified_qty | sales_delivery_items.delivery_notice_line → SD item qty | (none) | scheduled − confirmed − claimed | delivery_notice_lines.id (R-SAL-17) |
| 4 | Sales Delivery line | Delivery-backed Return line | sales_delivery_items.id (with `commercial_source_marker = 'DELIVERY_BACKED'`) | return_order_items.delivery_item_id | sales_delivery_items.quantity | SUM(return_order_items.qty where delivery_item_id = this SD item) | (per return reversal) | SD item qty − returned qty | sales_delivery_items.id (R-SAL-03) |
| 5 | Sales Order line | SO-backed Return line | `sales_order_items.id` (with `commercial_source_marker = 'SO_BACKED'`; the line must belong to the referenced real SO/customer/product and have no executed SD evidence) | `return_order_items.sales_order_item_id` | `sales_order_items.quantity` | effective confirmed Return quantity grouped by the exact `sales_order_item_id` | canonical `return_reversal_items` quantity | SO line qty − effective confirmed returned qty | `sales_order_items.id` (real line identity; capacity/concurrency anchor) |
| 6 | No-source Return | (explicit NO_SOURCE capacity policy) | n/a | return_order_items.id where `commercial_source_marker='NO_SOURCE'` | capacity = N/A (consignment-inventory economics not derived from any SO/SD/return aggregate) | n/a | n/a | n/a | n/a |
| 7 | Return line | Replacement obligation / fulfillment | return_order_items.id | sales_order_replacement_lines.source_return_item_id; fulfillment evidence then points to each real confirmed Sales Delivery item | return_order_items.qty (return_qty) for obligation creation; replacement line qty for fulfillment | effective replacement obligation quantity for source capacity; effective fulfilled quantity is the pure projection over immutable fulfillment links whose Delivery execution remains canonical | explicit Replacement cancellation removes only unfulfilled obligation; a confirmed Delivery reversal may reduce fulfillment only through a separately approved canonical Delivery-reversal fact | source remaining = return qty − non-cancelled replacement obligation qty; fulfillment remaining = replacement line qty − effective fulfilled qty | return_order_items.id (obligation creation) → sales_order_replacement_lines.id (fulfillment), R-SAL-10 |
| 8 | Sales Order / line | Sales Order Change | sales_orders.id + sales_order_items.id | sales_order_changes.id + sales_order_change_lines.id | capacity = N/A (not a quantity edge; evidence exists for both direct/document paths) | canonical apply uses line op ∈ {ADD,MODIFY,CANCEL} on remaining obligation | REJECTED/CANCELLED evidence | remaining-not-yet-executed after APPLIED version | sales_order_changes.id + sales_order_items.id (R-SAL-07 / 08 / 18) |
| 9 | Sales Order line | Reservation Intent | sales_order_items.id | sales_reservation_intent.id | sales_order_items.quantity | requested_qty (intent) + Planning canonical consumed | released / canceled | qty − Planning consumed (canonical in Planning) | sales_order_items.id (consume-side) + sales_reservation_intent.id (intent-side) |
| 10 | Sales Order | Prepayment Gate evaluation | sales_orders.id | sales_prepayment_requirements.id | required_prepayment_cents | eligible_prepayment_cents (per gate evaluation; from Finance adapter) | (none) | required − applied (cumulative gate-eligible) | **V22 Finance parent balance lock**: `settlement_unapplied_balances.id` (balance_type='PREPAYMENT') FOR UPDATE inside SAME connection/transaction via financeAdapter (R-SAL-15 primary lock; per §29.16.3.1); sales_prepayment_requirements.id + sales_prepayment_gate_results.snapshot_key as Sales-owned record/audit identity |
| 11 | SO service line | Service Fulfillment | sales_order_items.id (with `product_commercial_classification.service_classification = TRUE`) | service_fulfillments.sales_order_item_id | sales_order_items.quantity | service_fulfillments.confirmation_qty | (per cancel) | qty − confirmed | sales_order_items.id (capacity anchor) + service_fulfillments.id (R-SAL-22) |
| 12 | Consignment line | Settlement | consignment_commercial_lines.id (where `commercial_source_marker` indicates commercial settlement path) | (settlement row in finance canonical AR) | consigned_quantity | settled qty (per settlement event) | (per settlement reversal) | consigned − settled | consignment_commercial_lines.id (R-SAL-20) |
| 13 | Consignment line | Consignment Return | consignment_commercial_lines.id | (return row in finance canonical refund) | consigned_quantity | returned qty | (per return reversal) | consigned − settled − returned | consignment_commercial_lines.id (R-SAL-21) |
| 14 | Sales / Finance canonical facts | Credit Exposure (DERIVED) | sales_orders / sales_deliveries / Finance canonical rows | sales_orders / sales_deliveries / account_receivables etc. | proposed_exposure_delta (input) | credit_check_result.decision consumed | (none; DERIVED) | E = computed per §29.23 (PURE_DERIVED) | **credit_control_anchor.id** (NEW A-62; PRIMARY long-lived lock); secondary: credit_profile effective row + credit_policy_snapshots (R-SAL-12 / 24, see §29.25.2-3) |
| 15 | Credit Check Result | Credit Special Approval | credit_check_result.id (where decision = 'SPECIAL_APPROVAL_REQUIRED') | credit_special_approval.source_credit_check_result_id | capacity = N/A (not a quantity edge; approval is a bounded exception request) | approved_override_cents (per decision) | REJECTED approval | n/a (bounded authority check, not running total) | credit_special_approval.id (UNIQUE on source_credit_check_result_id) + credit_policy_snapshots.id (R-SAL-13) |
| 16 | Confirmed Sales Return (`SO_BACKED` / `NO_SOURCE`, status='CONFIRMED') | Option C Reversal Evidence (`return_reversals` + `return_reversal_items` + paired `inventory_valuation_movements` REVERSAL + reversing `accounting_vouchers` SALES_RETURN_REVERSAL + optional `credit_reversal_components`) | `return_orders.id` (mode-resolved per §29.13.11.1); per-line: `return_order_items.id`; per-line original movement: `inventory_valuation_movements.id` (status='POSTED', quantity_delta>0, source_type='SALES_RETURN'); per-line original voucher: `accounting_vouchers.id` (status='POSTED', source_type='SALES_RETURN'); per-line optional credit: `financial_credit_adjustments.id` (status='CONFIRMED'); per-line replacement canonical: `sales_replacement_fulfillments` ↔ `return_order_items.id` join (Gate-A evidence) | full Return qty only (no partial); cumulative prior reversals must equal 0 to enable fresh full reverse | n/a (Reversal mirrors original Return quantity exactly per Gate-B Gate-C) | the exact paired `inventory_valuation_movements` rows with `reversal_of_id = originals.id` and negated cents, plus the unique `SALES_RETURN_REVERSAL` voucher, plus optional REVERSED credit | one SALES_RETURN_REVERSAL row per reverse; original Return header / lines / metadata remain immutable | remaining = 0 once a full reversal is committed; partial / cumulative non-zero is HTTP 409 | `return_orders.id` (mode-resolved header row) FOR UPDATE -> `return_order_items.id` FOR UPDATE (ascending) -> `inventory_valuation_movements.id` (per-line original) FOR UPDATE -> `inventory_valuation_balances` (per product/warehouse/lot/serial) FOR UPDATE -> `accounting_vouchers.id` (per-line original) FOR UPDATE -> optional `financial_credit_adjustments.id` FOR UPDATE; R-SAL-09 / R-SAL-10 reuse — no new Race ID |

#### 29.30.1 Direction audit (sources of edge)

```text
Quotation → SO  ✓  source: quotation line; target: SO line
SO → Delivery Notice  ✓  source: SO line; target: DN line
Delivery Notice → SD  ✓  source: DN line; target: SD line
SD → Return (DELIVERY_BACKED)  ✓  source: SD line; target: delivery_item_id on return line
SO → Return (SO_BACKED)  ✓  source: SO line; target: sales_order_item_id on return line
NO_SOURCE Return  ✓  source: explicit NO_SOURCE marker; no upstream capacity edge
Return → Replacement  ✓  source: return line; target: replacement line
SO → SO Change  ✓  source: SO; target: append-only change evidence for direct/document path (NOT vice-versa)
SO → Reservation Intent  ✓  source: SO line; target: intent row
SO → Prepayment Gate  ✓  source: SO; target: gate evaluation
SO service line → Service Fulfillment  ✓  source: SO line; target: fulfillment
Consignment line → Settlement / Return  ✓  source: commercial line; target: settlement/return financial row
Sales / Finance facts → Credit Exposure  ✓  source: canonical facts; target: DERIVED
Credit Check Result → Credit Special Approval  ✓  source: check result; target: approval
Confirmed SO_BACKED / NO_SOURCE Return → Option C Reversal Evidence  ✓  source: confirmed Return header + lines + canonical valuation movement / voucher / credit identity; target: independent append-only SALES_RETURN_REVERSAL evidence; reverses Inventory IN + valuation IN + voucher + optional credit; existing confirmed Return and its history remain immutable (see §29.13.11 + §29.30 row 16)
```

No edge direction is reversed in this table.

### 29.31 API Inventory

> 每个 API 在 design 上明确 method / path / purpose / permission / identity / source-cap / idempotency / tx。本节不写 handler 代码。

#### 29.31.1 Quotation API surface

```text
GET    /api/sales-quotations              list (status filter)
GET    /api/sales-quotations/:id          detail (with lines + remaining)
POST   /api/sales-quotations              create (DRAFT)
PATCH  /api/sales-quotations/:id          mutate (DRAFT only)
POST   /api/sales-quotations/:id/effective-publish  DRAFT→EFFECTIVE (if approval policy)
POST   /api/sales-quotations/:id/cancel   DRAFT/EFFECTIVE→CLOSED (with reason)
POST   /api/sales-quotations/:id/convert-to-so
       body: {line_selections, qty_per_line}
       converts to SO via canonical sales_order_canonical_writer
       idempotency: (idempotency-key) → lock + check + insert conversions
```

#### 29.31.2 Sales Pricing API surface

```text
GET    /api/sales-price-lists                list
POST   /api/sales-price-lists                create DRAFT
GET    /api/sales-price-lists/:id            detail + entries + versions
PATCH  /api/sales-price-lists/:id            update DRAFT header only
DELETE /api/sales-price-lists/:id            delete never-activated DRAFT only
POST   /api/sales-price-lists/:id/entries    create DRAFT entry + version 1
PATCH  /api/sales-price-lists/:id/entries/:entryId
                                               update DRAFT non-key range fields only;
                                               identity change = delete/recreate
POST   /api/sales-price-lists/:id/entries/:entryId/versions
                                               append immutable DRAFT price version
DELETE /api/sales-price-lists/:id/entries/:entryId
                                               delete DRAFT entry only
POST   /api/sales-price-lists/:id/activate   ACTIVATE (frozen effective window)
POST   /api/sales-price-lists/:id/retire     ACTIVE → RETIRED
POST   /api/sales-pricing/resolve            body input → resolved price/evidence
                                              (read-only; zero DB mutation)
```

All reads/resolution require `pricing:view`; configuration mutations require `pricing:manage`; manual price requires `pricing:override`. Activation/retirement require `Idempotency-Key` and the atomic validation/audit contract in §29.6.4. There is no GET-with-body resolver and no pricing override log endpoint.

#### 29.31.3 Order-Time Discount API surface

```text
GET    /api/sales-discount-schemes
POST   /api/sales-discount-schemes            create DRAFT
GET    /api/sales-discount-schemes/:id        detail + immutable rule versions
PATCH  /api/sales-discount-schemes/:id        update DRAFT header only
DELETE /api/sales-discount-schemes/:id        delete never-activated DRAFT only
POST   /api/sales-discount-schemes/:id/rules  create DRAFT rule
POST   /api/sales-discount-schemes/:id/rules/:ruleKey/versions
                                                append DRAFT rule version;
                                                enabled=0 is logical removal
POST   /api/sales-discount-schemes/:id/activate
POST   /api/sales-discount-schemes/:id/retire
POST   /api/sales-discounts/resolve            body input → calculation/evidence
                                                (read-only; zero DB mutation)
```

The same `pricing:view` / `pricing:manage` split applies. Supplying any MANUAL rule additionally requires `pricing:override` plus reason; `pricing:manage` never implies override and `pricing:override` never implies manage. No Wave-4 writer is required to implement or test Wave-2 preview authorization.

#### 29.31.4 Sales Order API surface (canonical)

```text
GET    /api/sales-orders                    list
GET    /api/sales-orders/:id                detail (commercial party snap, snapshot, lines)
POST   /api/sales-orders                    create (commercial party default snapshot)
PATCH  /api/sales-orders/:id                update (DRAFT/REJECTED only)
POST   /api/sales-orders/:id/submit          DRAFT→SUBMITTED
POST   /api/sales-orders/:id/approve         SUBMITTED→APPROVED  (SOD; SALES_ORDER family)
POST   /api/sales-orders/:id/reject          SUBMITTED→REJECTED  (with reason)
POST   /api/sales-orders/:id/close           commercial close (SC43) — explicit action
POST   /api/sales-orders/:id/cancel          commercial cancel (SC44) — explicit action
POST   /api/sales-orders/:id/gift-line       add gift line (SC29) — additive
GET    /api/sales-orders/:id/fulfillment     DERIVED projection (partial/full/etc)
```

#### 29.31.5 Sales Order Change API surface

```text
POST   /api/sales-orders/:id/controlled-change create CONTROLLED_DIRECT evidence
                                                 (SUBMITTED + approval request;
                                                  Idempotency-Key required)
POST   /api/sales-order-changes               create CONTROLLED_DOCUMENT (DRAFT)
PATCH  /api/sales-order-changes/:id          change lines
POST   /api/sales-order-changes/:id/submit    DRAFT→SUBMITTED (platform approval create)
POST   /api/sales-order-changes/:id/approve   SUBMITTED→APPLIED via canonical
                                                 applySalesOrderChange;
                                                 Idempotency-Key required
POST   /api/sales-order-changes/:id/reject    SUBMITTED→REJECTED
POST   /api/sales-order-changes/:id/cancel    DRAFT→CANCELLED (no SO state change)
```

#### 29.31.6 Delivery Notice API surface

```text
GET    /api/delivery-notices                 list
GET    /api/delivery-notices/:id             detail (lines + remaining)
POST   /api/delivery-notices                 create (DRAFT)
PATCH  /api/delivery-notices/:id             lines
POST   /api/delivery-notices/:id/confirm     DRAFT→CONFIRMED
POST   /api/delivery-notices/:id/cancel       DRAFT/CONFIRMED→CANCELLED
```

#### 29.31.7 Sales Delivery (existing) — converged

```text
GET    /api/sales-deliveries                (existing)
POST   /api/sales-deliveries                (existing) — explicit sourceMode;
                                                 deliveryNoticeId required only for
                                                 DELIVERY_NOTICE, forbidden for DIRECT_ORDER
PATCH  /api/sales-deliveries/:id            (existing)
POST   /api/sales-deliveries/:id/confirm    (existing) — extended: also locks
                                                  delivery_notice remaining + uses
                                                  applyInventoryMutation + OQC + Finance
                                                  recognition. Delivery Notice lock identity
                                                  becomes part of the confirm path. Service
                                                  items require service_fulfillments pre-check.
```

#### 29.31.8 Sales Return (existing) — extended

```text
GET    /api/sales-returns                   (existing)
POST   /api/sales-returns                   (existing; must specify
                                              commercialSourceMarker ∈
                                              {DELIVERY_BACKED, SO_BACKED, NO_SOURCE};
                                              SO_BACKED lines require salesOrderItemId)
PATCH  /api/sales-returns/:id               (existing)
POST   /api/sales-returns/:id/confirm       (existing; Idempotency-Key required;
                                              mode-specific atomic behavior)
POST   /api/sales-returns/:id/reverse       (Option C; Idempotency-Key required;
                                              mode-aware dispatch per §29.13.11.1;
                                              body: {businessDate, reason};
                                              DELIVERY_BACKED -> existing reverse
                                                handler (unchanged);
                                              SO_BACKED / NO_SOURCE -> new §29.13.11
                                                Option C Reverse handler;
                                              full Return qty only; HTTP 409 on
                                                Gate-A / Gate-B / Gate-C / Gate-D /
                                                Gate-E failure; response carries
                                                reversalNo, reversalId, mode,
                                                SALES_RETURN_REVERSAL inventory
                                                transaction id, paired valuation
                                                reversal movement ids, reversal
                                                voucher id, optional credit
                                                reversal id, idempotent result)
```

Confirm accepts no client cost, valuation basis, account id, voucher entry, AR id or fabricated source evidence. `SO_BACKED` / `NO_SOURCE` returns HTTP 409 with the §29.13.10 zero-side-effect contract when any line lacks an eligible positive valuation plan. A successful response exposes the true `SALES_RETURN` identity, commercial mode, inventory transaction/value evidence and inventory voucher reference; an optional credit-adjustment reference appears only when Finance independently resolves and accepts an authoritative basis. Absence of AR basis is not represented as an error or a fake credit. `DELIVERY_BACKED` response compatibility remains unchanged.

#### 29.31.9 Replacement API surface

```text
GET    /api/sales-order-replacements
POST   /api/sales-order-replacements         create from return
PATCH  /api/sales-order-replacements/:id    cancel active unfulfilled remainder;
                                             fulfillment state is not client-writable
POST   /api/sales-order-replacements/:id/fulfill  atomically validate confirmed
                                                 Sales Delivery item(s) and append
                                                 line-level fulfillment evidence;
                                                 one request may link lines from the
                                                 same Delivery, and repeated requests
                                                 may link later Deliveries
```

#### 29.31.10 Prepayment Gate API surface

```text
GET    /api/sales-prepayment-requirements
POST   /api/sales-prepayment-gate/evaluate
       body: {sales_order_id, stage}
       → returns {decision, eligible_advance_cents, remaining_required_cents}
```

#### 29.31.11 Reservation Intent API surface

```text
POST   /api/sales-reservation-intent/request       create intent request
POST   /api/sales-reservation-intent/release       release intent
GET    /api/sales-reservation-intent                  list (by SO)
```

#### 29.31.12 Service Fulfillment API surface

```text
POST   /api/service-fulfillments                   create PENDING (per SO line)
POST   /api/service-fulfillments/:id/confirm       → CONFIRMED (triggers Finance recognition)
POST   /api/service-fulfillments/:id/cancel
```

#### 29.31.13 Consignment Commercial API surface

```text
GET    /api/consignment-commercial-documents
POST   /api/consignment-commercial-documents         create instruction
PATCH  /api/consignment-commercial-documents/:id
POST   /api/consignment-commercial-documents/:id/settle      settlement confirmation (→ Finance)
POST   /api/consignment-commercial-documents/:id/return       commercial return (→ Inventory + Finance)
GET    /api/consignment-commercial-documents/:id/remaining    remaining capacity
```

#### 29.31.14 Credit API surface

```text
GET    /api/credit-parameters              (active effective at business_date)
GET    /api/credit-check-rules
POST   /api/credit-parameters              create (DRAFT)
POST   /api/credit-parameters/:id/activate set effective_from
POST   /api/credit-check-rules/:id/activate

GET    /api/credit-profile                 per customer (effective at business_date)
POST   /api/credit-profile                 create / update (effective-dated)
GET    /api/credit-profile/:id/ratings

POST   /api/credit-check/evaluate
       body: {customer_id, salesperson_id, sales_order_id/sales_delivery_id,
              stage, business_date, proposed_exposure_delta}
       → returns {decision, component_breakdown, snapshot_identity,
                   special_approval_requirement}
       idempotency: (idempotency-key) required

POST   /api/credit-special-approval       request with reason + requested override
POST   /api/credit-special-approval/:id/decide    decision (bounded authority check)

POST   /api/credit-evaluation/indicator   create indicator
POST   /api/credit-evaluation/scheme
POST   /api/credit-evaluation/model
POST   /api/credit-evaluation/scoring-sheets    create sheet (bound evaluators)
POST   /api/credit-evaluation/scoring-sheets/:id/finalize
POST   /api/credit-evaluation/scoring-sheets/:id/apply-to-profile
POST   /api/credit-recalculation/run              CHECK_ONLY by default
GET    /api/credit-query                    limit / used / remaining / components
GET    /api/credit-exceptions               exception history (DERIVED query)
```

#### 29.31.15 Customer Commercial Extensions API surface

```text
GET    /api/customer-commercial-extensions
POST   /api/customer-commercial-extensions     create effective-dated
PATCH  /api/customer-commercial-extensions/:id
GET    /api/customer-material-xref
POST   /api/customer-material-xref
```

#### 29.31.16 Permission Intents (SC108..SC114)

```text
sales:view
sales:create
sales:manage
sales:approve
sales-order-change:direct-request
sales-order-change:document-manage
sales-order-change:approve

pricing:view
pricing:manage
pricing:override                 (SC109; PRICE OVERRIDE separate authority)

quotation:manage
return:manage
consignment:manage
service-sales:manage
replacement:manage

credit:view
credit:manage
credit:evaluate
credit:special-approve            (SC111; bounded authority)
```

### 29.32 Lifecycle Inventory

| State Machine | States |
|---|---|
| Quotation (§29.5.1) | DRAFT → EFFECTIVE → (CLOSE_CANCELLED) ∨ FULLY_CONVERTED ∨ EXPIRED |
| Sales Order (frozen) | DRAFT → SUBMITTED → APPROVED → REJECTED |
| Sales Order (commercial close; §29.10) | overlay: OPEN → CLOSED_COMMERCIALLY / CANCELLED_COMMERCIALLY |
| Sales Order Change — controlled direct (§29.9) | SUBMITTED → APPLIED ∨ REJECTED ∨ CANCELLED |
| Sales Order Change — formal document (§29.9) | DRAFT → SUBMITTED → APPLIED ∨ REJECTED ∨ CANCELLED |
| Delivery Notice (§29.11.1) | DRAFT → CONFIRMED → CANCELLED / CLOSED (by exhaustion) |
| Sales Delivery (frozen) | DRAFT → CONFIRMED → CANCELLED |
| Sales Return (frozen + commercial_marker) | DRAFT → CONFIRMED → CANCELLED with marker |
| Sales Return Reversal Evidence (Option C; append-only; independent of `return_orders.status`) | per-Reverse header row in `return_reversals`: `SALES_RETURN_REVERSAL`; reversed return status does NOT change; one row per reverse; idempotency row records the committed result. Reversal is NOT a `return_orders` state transition. |
| Replacement (§29.14.1) | derived `OPEN → PARTIAL → FULFILLED`; explicit cancellation of unfulfilled remainder exposes `CANCELLED` without erasing fulfilled evidence |
| Service Fulfillment (§29.18.1) | PENDING → CONFIRMED → CANCELLED |
| Consignment Commercial (§29.19.2) | DRAFT → INSTRUCTION → PARTIAL_SETTLED → SETTLED ∨ RETURNED ∨ CANCELLED |
| Prepayment Gate (§29.16.2) | PASS / WARN / BLOCK / OVERRIDE_REQUIRED (per stage) |
| Credit Special Approval (§29.26) | PENDING → APPROVED / REJECTED |
| Credit Evaluation Sheet (§29.27) | DRAFT → SUBMITTED → FINALIZED → APPLIED (to profile) |

### 29.33 RBAC / SOD Design

目标：映射 SC108..SC114 与 §34.7 P1..P5 至现行 Platform permission registry。

```text
Backend authorization (FAIL-CLOSED):
- VIEW      ≠ WRITE       (P1)
- CREATE    ≠ APPROVE    (P2)
- PRICE_OVERRIDE separate authority
             (P3 — sales:create / pricing:override 不能 same user)
- CREDIT_SPECIAL_APPROVE bounded authority
             (P4 — credit:special-approve 受 user.role ceiling 制约)
- AUDIT 不可跳过
             (P5 — critical mutation 与 audit_logs 共 tx)

SOD on Sales Order approval:
- creator_id ≠ reviewer_id (frozen in M3R)

SOD on Sales Order Change:
- requester_id ≠ approver_id for both CONTROLLED_DIRECT and CONTROLLED_DOCUMENT
- direct-request / document-manage / approve are separate backend authorities
- BOTH never aliases these permissions and never authorizes self-approval

Frontend visibility is NOT authorization.
hidden field != bypass; 必须 backend allow 拒绝。
```

#### 29.33.1 Existing Permission Codes (重用 + 冻结扩展)

Reuse (frozen):
```text
SALES_ORDER (family): sales:view / sales:create / sales:approve / sales:reject
                      (current per-platform mapping for SALES_ORDER approval family)

Standard 5-role baseline (frozen):
  role-sales, role-reviewer, role-warehouse, role-accounting, role-admin
  (frozen §34.7)
```

New (additive, business-meaning from §34.7):
```text
sales:manage (SC108)
sales-order-change:direct-request / sales-order-change:document-manage /
sales-order-change:approve (SC37..SC40; separate request/document/approve authorities)
pricing:view / pricing:manage / pricing:override (SC109)
quotation:manage (SC110)
return:manage (SC110)
consignment:manage (SC110, SC113)
service-sales:manage (SC110, SC113)
replacement:manage (SC112)
credit:view / credit:manage / credit:evaluate / credit:special-approve (SC111)
```

#### 29.33.2 Backend Authorization Ownership

Every Sales-owned write API has:

```text
checkPermissionOrForbid(actor, permissionCode, resourceType, resourceId)
```

writes audit `entity_type=SOMETHING, action=AUTH_DENIED` for fail-closed cases.

#### 29.33.3 Wave-2 exact pricing matrix

Permission codes are frozen for Wave 2 as three independent authorities:

| Role | `pricing:view` | `pricing:manage` | `pricing:override` |
|---|---:|---:|---:|
| `role-admin` | YES | YES | YES |
| `role-sales` | YES | YES | NO |
| `role-reviewer` | YES | NO | YES |
| `role-warehouse` | NO | NO | NO |
| `role-accounting` | YES | NO | NO |

- `pricing:manage` does not imply `pricing:override`; `pricing:override` does not imply `pricing:manage`. Every endpoint checks the exact authority even when the actor has another pricing authority.
- `pricing:view` covers list/scheme reads and both pure resolver previews. `pricing:manage` covers DRAFT configuration plus activate/retire. `pricing:override` is additionally required when a price or MANUAL discount rule is supplied.
- Manual preview requires the override actor and non-empty reason in the returned evidence. The resolver has no Sales-document creator context and remains zero-write, so Wave 2 tests permission/reason decisions without a Wave-4 writer. Wave 4 must persist actual override actor/reason and enforce `sales:create` actor ≠ override actor for the SO mutation, including an admin who owns both permissions.
- Denied configuration mutations write `AUTH_DENIED` through the existing audit service. Denied or successful pure resolver previews write no `audit_logs` row; HTTP security/access observability is not a business mutation audit. No endpoint may create a pricing-specific override log.

### 29.34 Approval / Workflow Boundary

Current Platform approval family `SALES_ORDER` must remain working.

New approval needs:

```text
Sales Order Change         :  SALES_ORDER family; both change paths require reason,
                              independent approver, parameter/path snapshot,
                              pre-effect-version check and atomic approve+apply
Credit Special Approval    :  new approval family = 'CREDIT_SPECIAL_APPROVAL';
                              bounded authority; ceiling; expiry; scope
Quotation approval (optional policy): new family = 'QUOTATION_APPROVAL' (optional,
                                     policy-dependent; off by default)
Delivery Notice approval   :  not required; CONFIRM is direct by Sales user
Replacement approval       :  policy-dependent; default = none;
                              SALES_ORDER family for replacement delivery link
Service Fulfillment approval: not required; CONFIRM is direct by Sales user
```

Generic Workflow itself remains Platform-scope (OUT_OF_SCOPE §34.10).

Use bounded existing Platform approval mechanics (SALES_ORDER family + new CREDIT_SPECIAL_APPROVAL family) where possible; do NOT implement Generic Workflow engine.

### 29.35 Audit Design

Critical mutations require audit; mutation + audit shared transaction boundary where possible.

```text
entity_type                  audited actions (action label)
sales_quotation              CREATE / UPDATE / STATE_TRANSITION / CONVERT_TO_SO
sales_price_list            CREATE / UPDATE / DELETE_DRAFT / ACTIVATE / RETIRE
sales_price_list_entry      CREATE / UPDATE_DRAFT / DELETE_DRAFT /
                            APPEND_VERSION (append-only version evidence)
sales_discount_scheme       CREATE / UPDATE / DELETE_DRAFT / ACTIVATE / RETIRE
sales_discount_scheme_rule  CREATE / UPDATE_DRAFT / DELETE_DRAFT
sales_order                 CREATE / UPDATE / SUBMIT / APPROVE / REJECT / GIFT_LINE_ADDED
                            CLOSE_COMMERCIALLY / CANCEL_COMMERCIALLY
sales_order_change          CREATE_DIRECT_REQUEST / CREATE_DOCUMENT / SUBMIT /
                            APPROVE_AND_APPLY / REJECT / CANCEL / IDEMPOTENT_REPLAY
                            (records path, parameter snapshot, base/target version,
                             requester, approver and application actor)
sales_order_change_line     ADD / MODIFY / CANCEL (before/after per-line evidence;
                            append-only after APPLIED)
delivery_notice             CREATE / CONFIRM / CANCEL
sales_delivery              CREATE / UPDATE / CONFIRM / CANCEL (existing)
sales_return                CREATE / UPDATE / CONFIRM / CANCEL (existing; +mode)
sales_order_replacement     CREATE / UPDATE / FULFILL / CANCEL
sales_reservation_intent    REQUEST / RELEASE / CONSUME
sales_prepayment_requirement CREATE / UPDATE
sales_prepayment_gate_result EVALUATE
service_fulfillment         CREATE / CONFIRM / CANCEL
consignment_commercial_doc  CREATE / SETTLE / RETURN / CANCEL
consignment_commercial_line UPDATE
credit_parameters          CREATE / ACTIVATE
credit_check_rules          CREATE / ACTIVATE
credit_profile              CREATE / UPDATE / EFFECTIVE_SET
credit_profile_ratings      APPLY
credit_check_result         EVALUATE
credit_special_approval     REQUEST / DECIDE
credit_evaluation_indicator CREATE
credit_evaluation_scheme     CREATE
credit_evaluation_model     CREATE
credit_evaluation_scoring_sheet CREATE / SUBMIT / FINALIZE / APPLY
credit_recalculation_history RUN
```

Audit entity values MUST reference `policy_snapshot_identity` for any credit-related audit row (per R-SAL-24 design enforcement).

Wave-2 pricing/scheme activation and retirement validate state and write the business row plus exactly one action audit in one transaction. Exact `Idempotency-Key` replay returns the stored original response with zero business/audit mutation; payload mismatch fails 409. `POST .../resolve` never appears as a business audit action because both resolvers are strictly zero-mutation. Actual order-time manual override audit belongs to the future Wave-4 SO writer and reuses `audit_logs`; no sixth Wave-2 business table is allocated.

### 29.36 Mobile IA Design

Sales & Customer launcher goal: ≤ 6 primary entries.

Design proposal:

```text
Sales & Customer launcher:
  Customers           (SC02..SC07; existing route customers)
  Quotations          (SC09..SC14; new route quotations/primary)
  Orders              (SC24..SC44; existing route orders)
  Fulfillment         (SC45..SC58; combined entry: Delivery Notice + Sales Delivery + Return)
                      (Navigation: notice/delivery/return contextual tabs)
  Returns / Replacements (SC54..SC61; existing route returns with new tab: replacement)
  Credit              (SC82..SC107; new route credit/workspace)
```

Total primary launcher entries = 6.

Contextual surfaces (not in launcher):

```text
Pricing             → pricing sub-page accessible from Orders
Quotation detail    → route quotations/:id
Discount            → route sales-discounts (existing; AR/parent chain)
Consignment         → route consignment accessible from Customers OR a contextual detail tab
Service sales       → conditional; standard SO item type is service when product.is_service_classification
```

### 29.37 Route Design

`applicationRegistry.js` remains canonical front-end route truth.

```text
Existing routes (frozen compatibility):
  customers
  orders (sales order list / detail / editor)
  sales-deliveries
  returns (sales returns AND purchase returns)
  sales-discounts
  sales-invoices

New routes (NEW):
  quotations                  → list / detail / editor / conversion-to-SO
  delivery-notices            → list / detail / editor
  sales-orders-change         → list / detail / editor  (route id: 'sales-order-changes')
  sales-order-replacements    → list / detail / editor (under returns parentRoute)
  service-fulfillments        → list / detail (under orders parentRoute)
  consignment-commercial      → list / detail / editor (under customers parentRoute)
  customer-commercial-extensions  → detail within customer profile (NOT a primary route)
  customer-material-xref      → detail within customer profile (NOT a primary route)
  prepayment-gate             → embedded in order / delivery flows (NOT a primary route)
  credit-parameters           → settings under credit workspace
  credit-profile              → list under credit workspace
  credit-check-rules          → settings under credit workspace
  credit-check-evaluate       → embedded in SO/SD checkout
  credit-special-approvals     → list under credit workspace
  credit-evaluation            → list under credit workspace
  credit-query                 → query surface under credit workspace
  credit-exceptions            → query surface under credit workspace

Aliases (compat):
  none mandatory; existing routes retained
```

domain assignment:
all new routes → `sales-customer`.

access RBAC: per SC108..SC114 / §34.7.

mobile exposure per:
```text
  primary (launcher ≤ 6 entries):  customers, quotations, orders, fulfillment, returns-replacements, credit
  contextual (never in launcher): pricing, quotation-detail, discount, consignment, service-sales, prepayment, all credit sub-routes
  workflow (mobile-first editor): orders-editor, quotation-editor, delivery-notice-editor, credit-special-approvals-detail
  report (mobile-tolerant):  sales-summary, sales-outstanding (existing decision-reports entry points)
```

### 29.38 Responsive Design

```text
widths        : 320 / 390 / 430 / 680
primary      : 390
touch target : ≥ 44 CSS px
horizontal   : permanent horizontal scroll NOT for core tasks
core pattern : LIST → DETAIL → EDITOR / WORKFLOW
```

Each new workflow specifies:

```text
LIST    : customer / quotation / order / DN / replacement / credit list views
DETAIL  : detail of each entity with sectioned (commercial / finance / inventory / audit)
EDITOR  : for create / update / state transitions; modal or full-page per §34.7
WORKFLOW: for state machine-driven flows (DRAFT→EFFECTIVE→CONVERT; CREDIT→CHECK→SPECIAL_APPROVE)
```

### 29.39 Reporting Design

Existing decision-reports sales-summary / sales-outstanding extended; new projections:

```text
Quotation execution         : SC78 ← decision-reports sales-quotation-summary
Sales Order execution       : SC78 ← decision-reports sales-summary (existing extended)
Delivery Notice execution   : SC78 ← new sales-delivery-notice-execution
Sales Delivery execution     : SC78 ← decision-reports sales-outstanding (existing extended)
Return execution            : SC78 ← new sales-return-execution (3 modes split)
Replacement execution       : SC78 ← new sales-replacement-execution
Consignment execution       : SC78 ← new consignment-execution (3-layer split)
Credit exceptions            : SC78 ← new credit-exception-list

Sales Outstanding            : SC79 ← decision-reports sales-outstanding (existing)
Sales Gross Profit           : SC80 ← existing; consumes canonical valuation evidence
Sales Ranking                 : SC81 ← new sales-ranking by (customer, material, salesperson, sales_group)
                             dimensions
```

Reports use canonical business dates (§34.4 S19 invariant).

No shadow ledger for Sales cost: gross profit consumes canonical cost from Inventory V21 + Finance V22.

### 29.40 Historical Compatibility (new-flow enforcement + fail-closed)

| Existing concept | Row without new field | Legacy read | Legacy mutate (correction) | New write through legacy bypass |
|---|---|---|---|---|
| Legacy SO without tax_basis snapshot | NULL commercial_tax_code column | YES (display `(legacy)`) | bounded (Policy §29.45) | NO (new normal flow requires commercial snapshot) |
| Legacy SO without `effective_version` | Wave 4 migration backfills `1` as a forward-only compatibility baseline | YES; existing APPROVED/history remains read-only | only canonical SO Change may advance `1 → 2...`; no reconstructed history | NO; create initializes `1`, normal edit cannot write version |
| Legacy SD without source discriminator | source_mode absent / LEGACY_UNCLASSIFIED | YES (read) | bounded (Policy §29.45; no auto-classification) | NO; new writes require DIRECT_ORDER or DELIVERY_NOTICE (§29.12.0) |
| Legacy Order without commercial parties | NULL salesperson / sales_group / settlement_party / payer | YES (display `(legacy)`) | bounded | NO |
| Legacy Returns without `commercial_source_marker` | NULL remains visibly unclassified on read; mutation/reverse → HTTP 409 | YES (read only) | bounded fail-closed | NO (new entries must set marker; no DELIVERY_BACKED inference) |
| Legacy Customers without commercial extensions | NULL | YES (display `(none)`) | bounded | NO |
| Legacy Credit Profile missing | NULL credit_profile row | YES (display `(none)`) | per §29.22.1 rule (FAIL CLOSED if Credit Management enabled + mandatory rule) | per §29.22.1; no new write allows "no profile" exception to silent PASS |
| Legacy tax basis | NULL | YES (treat as no commercial tax snapshot) | bounded | NO |
| Legacy product reference price (`products.price_cents`) | DEPRECATED_NO_NEW_WRITES; historical display/read only, never returned by §29.6 resolver | YES (legacy document/reference read) | n/a | NO (new preview/write requires the Sales Pricing engine and returns `PRICE_NOT_CONFIGURED` when unresolved) |

> Default rule: legacy read = YES, legacy correction (bounded) = policy-defined, new write through legacy bypass = NO.
> Compatibility must not become a permanent bypass around new canonical contracts.
> 禁止 retroactive rewrite of historical rows; 只 forward-only SO Change 允许。

### 29.41 Schema Constraints (proposed; no migration code)

| Constraint | Enforces |
|---|---|
| `customers.id` PK | identity foundation invariant (Master & Engineering) |
| `sales_groups.group_code UNIQUE NOT NULL` | one canonical Sales group code |
| `salesperson_profiles.salesperson_code UNIQUE NOT NULL` | one canonical Sales salesperson code |
| `salesperson_profiles.user_id UNIQUE NULLABLE FK users.id` | optional one-to-one login link; salesperson may exist without login |
| `salesperson_group_memberships UNIQUE (salesperson_id, sales_group_id, effective_from)` | multi-group membership identity; one effective default is transactionally enforced under salesperson anchor lock |
| `sales_parameters.scope_key PK` + bounded scope/code CHECK | one explicit SYSTEM row or document-type override; no arbitrary KV |
| `sales_parameters.order_change_mode CHECK` | `DISABLED / CONTROLLED_DIRECT / CONTROLLED_DOCUMENT / BOTH` only |
| `customer_commercial_extensions PK (customer_id, effective_from)` | version identity only; no-overlap is transactionally enforced under customer anchor lock |
| `customer_commercial_extensions` party / salesperson / group FKs | no orphan Master or Sales commercial references |
| `customer_material_xref UNIQUE (customer_id, product_id, effective_from)` | one effective mapping identity per customer / product / start date |
| no UNIQUE on `(customer_id, customer_material_code, effective_from)` alone | preserves approved multi-product candidates; explicit product selection + effective validation resolves ambiguity |
| `customer_commercial_extensions.sellable_scope_mode CHECK` | coherent customer-level `ALL_SALES_ENABLED / RULE_CONTROLLED`; xref remains translation only, A-69 owns allow/deny scope |
| `product_commercial_classification.product_id UNIQUE FK products.id` | one current Sales commercial classification/default set per Master product; no `products` mutation |
| `sales_price_lists.id PK`; `price_list_code UNIQUE`; lifecycle/date/currency CHECKs | stable list identity; one base currency; DRAFT → ACTIVE → RETIRED only |
| `sales_price_list_entries.id PK` + four-column business UNIQUE | version FK has a real unique target; `(price_list_id, material_identity_key, customer_scope_key, pricing_identity_key)` is directly materialized by current MySQL Bootstrap (`<=4` columns) and SQLite |
| price entry normalized-key CHECK / service derivation | bounded ASCII material/customer/pricing keys encode the complete semantic identity without nullable columns, delimiter ambiguity, truncation, case-folding, or generated hash index |
| price entry quantity/date CHECK + transactional overlap rejection | integer-micro inclusive breaks and inclusive effective dates never overlap for the same business scope |
| `sales_price_list_versions UNIQUE(entry_id, version)` + integer cents CHECK | append-only exact price version; no floating money |
| `sales_discount_schemes.id PK`; `scheme_code UNIQUE`; lifecycle/date/currency CHECKs | stable scheme/version identity and deterministic fallback root |
| `sales_discount_scheme_rules UNIQUE(scheme_id, rule_key, rule_version)` | immutable rule-version evidence without a sixth table |
| discount kind/value CHECK | PERCENT has integer 0..10000 bps only; AMOUNT has non-negative integer cents only; exactly one value populated |
| discount LINE/HEADER applicability CHECK | HEADER requires material/UoM NULL and break `[0, unbounded]`; LINE alone may filter material/UoM/quantity |
| discount greatest-version selection under scheme lock | one current version per rule_key; disabled/inapplicable greatest version never falls back to history |
| Wave-2 target-first FKs + A-39 nullable default FKs | five targets are created first; both customer defaults are real FKs with no fabricated value |
| `sales_order_items` tolerance snapshot CHECK | upper bps >= 0; lower bps 0..10000; immutable approved execution baseline |
| `sales_order_items.price_snapshot_json` / `discount_snapshot_json` | nullable physical compatibility for legacy rows; canonical Batch A writer requires valid non-empty versioned server evidence and rejects forged/missing/mismatched snapshots; approved history is write-once |
| `sales_orders.order_no UNIQUE` | no duplicate order |
| `sales_orders.effective_version INTEGER NOT NULL DEFAULT 1 CHECK (effective_version >= 1)` | one monotonic current-version anchor; application also requires locked-read + conditional CAS update |
| `sales_order_changes.change_no UNIQUE` + `application_idempotency_key UNIQUE` | one evidence identity and exact-once application |
| `sales_order_changes` path/mode/version CHECK | approved direct/document path; base < target; APPLIED evidence immutable |
| `sales_deliveries.delivery_no UNIQUE` | R-SAL-01 anchor |
| `sales_deliveries.sales_order_id` FK (existing) | no orphan |
| `sales_delivery_items.sales_order_item_id` FK | source-line identity |
| `sales_delivery_items.delivery_notice_line_id` FK (NEW nullable) | R-SAL-17 anchor; legacy NULL allowed |
| `return_orders.source_type CHECK` (existing) | source-type invariant |
| `return_orders.commercial_source_marker CHECK` (NEW) | 3-modes invariant |
| `return_order_items.sales_order_item_id` nullable FK → `sales_order_items.id` (NEW) | real SO_BACKED source-line identity; legacy/other-mode NULL; writer enforces exclusive mode/source pair |
| no new Return valuation/standard-cost column | Option A consumes locked canonical valuation facts only; client/manual cost and shadow approval evidence cannot persist |
| strict Option-A `receivePositiveSourceValue()` policy | requires an exact positive locked pool or independently proven approved/frozen effective standard-cost evidence; current repository has no sufficient standard-cost approval evidence, so that fallback stays disabled; `LEGACY_UNVALUED` is forbidden |
| one canonical Option-A voucher per Return inventory event | source remains SALES_RETURN; debit lines reconcile exactly to valuation movements and credit existing `INVENTORY_GAIN_LOSS`; canonical writer uniqueness prevents duplicate GL effect |
| no new Option-C Sales Return Reverse table | reuse existing `return_reversals` / `return_reversal_items` / `credit_reversal_components`; §30.31 adds only the bounded `sales_return_valuation_provenance` carrier and supporting indexes required by R2/R3, not a second reversal table; DELIVERY_BACKED-existing reverse path continues unchanged |
| `sales_quotation_lines PK (quotation_id, line_no)` | canonical line |
| `sales_quotation_conversions PK (quotation_id, sales_order_line_id)` | source-line conversion uniqueness |
| `delivery_notices.notice_no UNIQUE` | identity |
| `delivery_notice_lines PK (delivery_notice_id, sales_order_item_id)` | capacity invariant |
| `sales_order_changes.change_no UNIQUE` | identity |
| `sales_order_replacements.replacement_no UNIQUE` | identity |
| `sales_order_replacements.source_return_id FK` | replacement ↔ return |
| `sales_order_replacements.cancellation_state CHECK ('ACTIVE','CANCELLED')` | only persisted Replacement lifecycle command; fulfillment state is derived and not client-writable |
| no `sales_order_replacements.delivery_link_id` | multi-Delivery truth is exclusively line-level in `sales_replacement_fulfillments`; no lossy header shortcut |
| `sales_replacement_fulfillments.sales_delivery_item_id UNIQUE` | one confirmed Delivery item cannot fulfill more than one Replacement evidence row |
| Replacement fulfilled/remaining quantities are PURE_DERIVED | SQLite/MySQL generated columns must not contain cross-table aggregate; every reader uses the same link + effective Delivery predicate |
| `credit_parameters PK (code, effective_from)` | effective-dated uniqueness |
| `credit_check_rules.rule_code UNIQUE per effective_from` | effective-dated uniqueness |
| `credit_profile PK (customer_id, salesperson_id, credit_object_type, credit_object_id, effective_from)` | effective-dated uniqueness |
| `credit_special_approval PK (source_credit_check_result_id)` | one-time-only approval per check |
| `consignment_commercial_lines PK (doc_id, material_id, lot_code effective)` | consignment stream integrity |
| `idempotency_records PK (entity_type, entity_id, idempotency_key)` | command idempotency |

### 29.42 SQLite / MySQL Parity

Hardening surface checklist (anticipated hazards):

```text
- partial-index: ensure no UNIQUE … WHERE clauses; use plain UNIQUE
  on (effective_from) composite keys.
- UPSERT: avoid SQLite-only ON CONFLICT syntax that has no MySQL 8
  direct equivalent. Use INSERT-or-check-then-UPDATE; or use INSERT IGNORE
  with care for InnoDB semantics.
- concurrent UPDATE: avoid SQLite-only UPSERT / DO NOTHING that bypasses
  row-lock in MySQL. For capacity updates use explicit
  SELECT ... FOR UPDATE then UPDATE; never rely on conditional UPDATE.
- JSON: store JSON in TEXT / JSON columns using universal JSON1 / MySQL JSON
  document with same content semantics.
- Sales line snapshot JSON follows the existing Bootstrap type mapping: canonical SQLite `TEXT` is reconciled to the adapter-supported MySQL JSON/text representation without raw SQLite DDL replay. Application validation is authoritative for the versioned envelope, safe integers and cross-field equality on both engines.
- AUTOINCREMENT: rely on explicit id generation; do not assume auto-assigned
  values exist on both engines identically. Use TEXT IDs consistent with
  current implementation.
- date / time: store ISO date (YYYY-MM-DD) for business_date; full ISO 8601
  for timestamp columns. Timezone normalize at app boundary.
- defaults: every column with default has explicit default; not engine-specific.
- nullable identity: never use nullable `customer_id` in PK/UNIQUE semantics.
  Price entry uniqueness is the ordered four-column plain UNIQUE on list id plus
  three bounded canonical ASCII keys; it is not a seven-column SQLite autoindex
  and does not use `generatedPartialIndex()` / SHA digest behavior.
- quantity/money: no REAL/FLOAT for quantity breaks, percentages, or cents;
  micro-quantity, basis points, and cents are safe integers at API/service/DB boundaries.
- FK upgrade: SQLite must expose the two A-39 defaults through
  `PRAGMA foreign_key_list`; MySQL must add named `ALTER TABLE ... ADD CONSTRAINT`
  FKs and verify them through `information_schema.REFERENTIAL_CONSTRAINTS` /
  `KEY_COLUMN_USAGE`. A column-shaped match without its FK is not success.
- metadata reconciliation: fresh init, upgrade from exact Wave-1 baseline, and
  repeated init must converge to exactly five new tables + two nullable fields.
  Expected missing objects are added; compatible existing objects are retained;
  any unexpected type/nullability/default/PK/UNIQUE/CHECK/FK/index mismatch fails
  closed before business handlers are enabled. Existing rows are never rewritten.
- price-entry UNIQUE acceptance is path-specific and mandatory:
  SQLite fresh: PRAGMA index_list/index_info reports one UNIQUE with ordered
    columns (price_list_id, material_identity_key, customer_scope_key,
    pricing_identity_key); sqlite_master reports both identity guard triggers;
    duplicate canonical, forged-key INSERT, and identity UPDATE are rejected.
  MySQL fresh: information_schema.STATISTICS reports NON_UNIQUE=0 with the same
    four SEQ_IN_INDEX columns; this is emitted inline by tableDefinition().
    The subsequent canonical Sales registry replay installs exactly the two
    MySQL guard triggers, verified through information_schema.TRIGGERS.
  Existing MySQL upgrade: when the complete pre-Wave-2 database lacks the table,
    tableDefinition() creates it with the same inline <=4-column UNIQUE; the
    design does not depend on planMySqlIndexReconciliation(), which skips
    origin='u', or on generatedPartialIndex(). Live Wave-2 registry replay then
    installs/verifies the guards. A pre-existing incompatible table/index/trigger
    is an unexpected mismatch and startup fails closed.
  Second initialization: exactly one equivalent UNIQUE remains, duplicate
    canonical/forged-key/identity-update probes still fail, exactly two guards
    remain, table/row/index counts are unchanged, and no generated __partial_*
    column/index exists.
- Wave-6 parity: SQLite PRAGMA and MySQL information_schema must prove the real
  Return SO-line FK, the three-mode CHECK, `cancellation_state` two-value CHECK,
  fulfillment FKs/UNIQUE and the absence of provisional `state`, header
  `delivery_link_id`, persisted fulfillment aggregates and generated SUMs.
- Option-A behavior must execute on both dialects with identical strict basis
  selection, integer-cent allocation, source identity, voucher aggregation,
  HTTP 409 and rollback semantics. A mock MySQL adapter test is not a substitute
  for the protected real-MySQL functional and independent-session race gates.

Tests:
  SQLite parity = node --test that runs both engines on the same SQL.
  Real MySQL = pnpm test:mysql / pnpm test:mysql:concurrency per §34.6 races.
```

### 29.43 Transaction Model

The canonical SO writer re-runs Pricing and Discount resolution after acquiring its transaction gate and before inserting any SO row. It serializes only the resulting server envelopes into `price_snapshot_json` / `discount_snapshot_json`, verifies unit price, gross/final line cents, UoM evidence, header allocation and order total, and commits the two snapshots with the line/header/audit/idempotency facts. A supplied client snapshot is only an optimistic assertion and any mismatch rolls back with zero side effects. Ordinary PATCH never accepts either snapshot for an approved SO.

The Wave-6 Return writer follows the specialized all-or-nothing sequence in §29.13.8–10. Its valuation preflight is part of the write transaction, not a stale preview: source capacity, tracking identity, period state, exact pool balances, account-role mappings and optional Finance basis are re-read under the canonical locks before any physical or economic fact commits. Replacement readers and writers use the one §29.14 pure-derived projection; no transaction updates a cached fulfillment state or quantity.

#### 29.43.1 SQLite strategy

```text
WRITE tx:
  BEGIN IMMEDIATE   (whole DB write lock to serialize concurrent writers; freezer-friendly)
  SELECT ... FOR UPDATE (MySQL only; not used on SQLite; SQLite serializes via BEGIN IMMEDIATE)
  capacity read + check
  capacity write
  audit write
  COMMIT

  Wave-2 list/scheme mutation:
    BEGIN IMMEDIATE → read owning list/scheme + peers → validate state, overlaps,
    fallback graph, versions and canonical UoM → mutate → audit → COMMIT.
    Resolver preview uses READ tx only and writes nothing.

READ tx:
  BEGIN DEFERRED   (default; let SQLite upgrade to IMMEDIATE if writer pending)
```

#### 29.43.2 MySQL strategy

```text
WRITE tx:
  START TRANSACTION
  SELECT … FOR UPDATE on
    source line identity (sales_order_items.id / sales_delivery_items.id /
                          delivery_notice_lines.id / return_orders.id / etc.)
    Credit Profile identity (credit_profile.id)
    credit_special_approval source (credit_special_approval.source_credit_check_result_id)
  computed capacity check INSIDE transaction
  capacity write
  audit write
  COMMIT

  Wave-2 list/scheme mutation:
    lock all affected sales_price_lists or sales_discount_schemes rows in
    ascending id order; then lock entry/rule/version rows in ascending id order;
    re-read overlap/fallback/UoM authority; mutate + audit atomically. Activation
    of a fallback graph locks every reachable header before validation. Resolver
    preview is a non-locking consistent read and performs zero DB mutation.

READ tx:
  SELECT … (no lock; READ COMMITTED default)

Lock ordering (canonical, Micro-Closure corrected):
  Acquire lock identities in one deterministic order:
    1. Sales-owned business / capacity anchor (preferred)
       (sales_order_items.id / sales_delivery_items.id /
        delivery_notice_lines.id / return_order_items.id /
        sales_order_replacement_lines.id / service_fulfillments.id /
         consignment_commercial_lines.id / sales_quotation_lines.id /
         sales_price_lists.id / sales_discount_schemes.id)
    2. Sales-owned Credit anchors (R-SAL-12 / 24):
       - credit_profile (effective row) FOR UPDATE
       - credit_policy_snapshots FOR UPDATE
       - credit_check_rules (effective) FOR UPDATE
    3. Sales-owned Prepayment anchor (R-SAL-15):
       - sales_prepayment_requirements / sales_prepayment_gate_results (snapshot_key)
    4. Cross-domain read rows that the frozen integration contract requires
       (acquire only if necessary):
       - approval_requests (frozen Platform) FOR UPDATE
       - planning_reservations FOR UPDATE (consume-side, R-SAL-02)
       - account_receivables / settlement_unapplied_balances via canonical
         Finance read adapter; NOT a Sales-owned lock; not a FOR UPDATE
         on Finance rows unless the frozen Finance contract specifies it
    5. audit_logs (no lock; append-only)

  Do NOT acquire the same lock classes in reverse order in another mutation
  path.

  Commit / rollback releases transaction locks atomically.

  Cross-domain read rows are NOT locked by default; Sales reads use canonical
  read adapters; only acquire the cross-domain FOR UPDATE if the frozen
  contract specifies it (rare).

Lock order rule: never read a row without FOR UPDATE first then update; never
rely on timeouts/sleeps.

### 29.44 R-SAL-01..24 Lock Matrix

| Race | Op A | Op B | Lock identity | Lock acquisition order | Allowed serialization | Forbidden final state | Required invariants | SQLite | MySQL | Acceptance plan |
|---|---|---|---|---|---|---|---|---|---|---|
| R-SAL-01 | SD confirm × 2 vs same SO line | — | sales_delivery_items source line | SD item → SO item | One wins; second re-reads remaining ≥ 0 | over-delivered (SO line remaining) | S05, S06 | source-line identity FOR UPDATE; remaining compute before write | source-line FOR UPDATE | R-SAL-01 test |
| R-SAL-02 | SD confirm × 2 vs same Planning reservation | — | planning_reservations.id | Planning reservation FIRST, then SD item | One wins; partial consumption serialized through Planning | reservation overstep | S12 | Planning canonical FOR UPDATE on its row; SD reads via assertStrongReservationAvailability | planning + SD FOR UPDATE | R-SAL-02 test |
| R-SAL-03 | SR confirm × 2 vs same delivery_item | — | return_order_items.delivery_item_id | delivery item → return item → AR adapter | One wins; second sees reduced remaining | over-return (> delivery qty) | S06, S10 | delivery_item FOR UPDATE; remaining compute before write | FOR UPDATE both | R-SAL-03 test |
| R-SAL-04 | M14 sales discount confirm × 2 vs same source AR | — | M14 sales_discounts.source_receivable_id → AR.id | AR row → discount row | One wins; second sees reduced remaining | over-discount (remaining ≤ 0) | S13 | AR FOR UPDATE then discount insert | FOR UPDATE both | R-SAL-04 test (M14 existing) |
| R-SAL-05 | SD confirm vs SR confirm (same physical race) | — | Inventory V21 canonical position (position_key) | inventory canonical → SD/SR line | exact-once net effect | net negative inventory | S01, Inventory frozen writer | inventory FOR UPDATE on position_key | FOR UPDATE position | R-SAL-05 test |
| R-SAL-06 | Quotation convert × 2 vs same Q line | — | sales_quotation_lines.id | quotation line → SO item → conversions insert | combined ≤ line qty | over-conversion | S04, S06 | quotation line FOR UPDATE; remaining compute | FOR UPDATE | R-SAL-06 test |
| R-SAL-07 | SO approve/application vs another SO change | direct + document | approval request + sales_orders.id effective_version + sales_order_changes.id | approval → SO header → change → affected lines | one application wins; loser is stale; version monotonic | silent rewrite or two changes applying same base version | S05 | conditional base-version update + application idempotency | same order for both paths | R-SAL-07 test |
| R-SAL-08 | SO change application vs direct/notice-backed Delivery create/confirm | direct + document | sales_orders.id + affected sales_order_items.id + SD source-line identity | SO header → affected SO lines → DN line when present → SD item | change sees executed quantity or delivery sees new version; only one valid serialization | change reduces/reassigns already shipping line | S05, S06 | both paths share apply service; delivery re-reads effective version/capacity | same source lock order | R-SAL-08 test |
| R-SAL-09 | Delivery vs Return/Reopen | — | delivery_items → return_items → AR update | both FOR UPDATE | one wins; reopen explicit | silent relive of cleared | S05, S10 | idempotent return + reopen; Option C reversal does NOT touch Sales Delivery or Return Reopen paths | FOR UPDATE both | R-SAL-09 test + Option C R-SAL-09 negative (Option C does not reopen Delivery / SO) |
| R-SAL-10 | Return vs Replacement fulfillment | — | return_order_items.id (line) + sales_order_replacement_lines.id (line) + referenced sales_delivery_items.id | obligation create: return-line FOR UPDATE → replacement-line insert; fulfill: replacement-line FOR UPDATE in ascending id → Delivery item/effective lifecycle lock in ascending id → re-read one canonical aggregate. Option C reverse: same replacement lock combination per Gate-A; confirmed fulfillment rows block reverse; ACTIVE not-fully-fulfilled Replacement requires prior cancellation; CANCELLED or fulfilled passes Gate-A. | multiple partial fulfillments and multiple Deliveries serialize; combined effective fulfilled ≤ replacement line qty; all header/line states derive from the same evidence. Option C reverse must not delete or modify fulfillment rows and must not rewrite confirmed Delivery; second concurrent reverse reproduces Gate-A evidence view and hits Gate-A idempotent / 409 behavior | over-fulfilled line, lossy first/last Delivery projection, or state disagrees with quantity; Option C silent rewrite of confirmed fulfillment; deletion of fulfillment row; rewrite of confirmed Delivery; fabrication of Delivery reversal | S10, S61 | fulfillment appends immutable evidence only after locked confirmed-Delivery validation; cancellation closes remaining only; unsupported confirmed-Delivery reversal fails closed; Option C reverse reuses this contract and Gate-A rules per §29.13.11.2 | same lock order; aggregate re-read under locks; Option C Gate-A is the controlled serialization boundary | R-SAL-10 multi-Delivery + same-line concurrent fulfill test + Option C reverse confirmed-fulfillment Block test (HTTP 409) + Option C reverse ACTIVE not-fulfilled Block test (HTTP 409) + Option C reverse concurrent vs Replacement fulfillment test |
| R-SAL-11 | Pricing update vs Order approval | — | Wave-2 list/version identity + immutable identity properties inside Wave-4 `sales_order_items.price_snapshot_json` | Wave 2 freezes ACTIVE pricing versions; Wave 4 locks SO item on create/approve and persists the server-generated evidence | resolver evidence is immutable by version; future approved SO snapshot remains unchanged | price change rewrites approved SO price | S20 | Wave-2 structural/version test now; Wave-4 snapshot write-once + concurrent approval test later | same two-wave boundary; no Wave-2 SO schema | Wave-2 partial evidence + Wave-4 final R-SAL-11 test |
| R-SAL-12 | Credit Check × 2 vs same credit object (PURE_DERIVED exposure) | — | **credit_lock_anchors.id** (REFINED A-62; anchor_type='CREDIT_OBJECT'; UNIQUE on anchor_key) | 1) POLICY_SCOPE anchor FOR SHARE; 2) CREDIT_OBJECT anchor FOR UPDATE; 3) credit_profile effective row FOR UPDATE; 4) credit_policy_snapshots create-or-select FOR UPDATE; 5) credit_check_rules effective rows FOR UPDATE | one wins; the loser re-reads and re-evaluates against updated state; multiple concurrent Credit Checks may share the same policy read (FOR SHARE) but serialize per credit object; combined committing commitments ≤ available credit | combined committing commitments > available credit; or check reads from stale eligible balance while concurrent Finance mutation has already consumed/refunded it | S14, S15 | PRIMARY long-lived lock identity = CREDIT_OBJECT anchor; Prepayment Gate acquires same Finance canonical locks via financeAdapter (see R-SAL-15); risk-releasing Finance events do not need to acquire Sales anchor; visibility lag → conservative temporary BLOCK acceptable, never over-credit approval | FOR UPDATE anchor (CREDIT_OBJECT) → profile → snapshot → rules; FOR SHARE on POLICY_SCOPE | R-SAL-12 test |
| R-SAL-13 | Credit Special Approval vs Order approval | — | credit_special_approval.source_credit_check_result_id (PK) + credit_policy_snapshots.id + sales_orders.id (effective_version) | approval FOR UPDATE → snapshot FOR UPDATE → SO FOR UPDATE | either special-approve or standard approval wins; never both silently | both silently | S16 | approval + SO tx; check + approval PK link | FOR UPDATE all three | R-SAL-13 test |
| R-SAL-14 | Credit release vs Collection / Return | — | credit_exposure_view (DERIVED) over Finance canonical AR / settlement_unapplied / financial_credit_adjustments | collection/return FOR UPDATE (Finance-owned rows) | transition rule prevents double-count | double-count | S14 | OCCUPANCY transition rule (per §29.23.2) at write; recognition-mode aware | FOR UPDATE on Finance-side rows | R-SAL-14 test |
| R-SAL-15 | Prepayment Gate vs Refund / Application | — | **canonical V22 Finance parent balance lock**: `settlement_unapplied_balances.id` (balance_type = 'PREPAYMENT') inside SAME connection/transaction via financeAdapter (lockMode = FOR UPDATE); child facts read beneath the parent lock (balance_applications, financial_refunds, applicable reversal effects); `payment_collections` is source document, NOT primary lock | financeAdapter resolves eligible prepayment and acquires FOR UPDATE on the parent balance rows in deterministic id order; reads child effects beneath; remaining = original_amount - confirmed balance_applications - confirmed financial_refunds - applicable reversal effects (per §29.16.3.2); Sales gate + Finance mutation serialize on SAME parent balance lock | one wins; either Sales gate first then Finance mutation, or Finance mutation first then Sales gate re-reads reduced balance; same economic amount never satisfies gate twice | Sales gate passes from stale eligible balance while concurrent Finance mutation has already consumed/refunded it | S13 | shared contract: financeAdapter.resolveEligiblePrepaymentForSalesGate(..., lockMode = FOR UPDATE) acquires FOR UPDATE on canonical V22 settlement_unapplied_balances rows; inherited caller transaction per §29.16.5; Finance business semantics unchanged; canonical balance unchanged; only the Sales locked-read adapter requires extension; if a V22 mutation path does not yet acquire the parent balance lock, that path also requires extension → BOUNDED INTEGRATION CONTRACT EXTENSION (see §29.16.3.1-7) | FOR UPDATE on `settlement_unapplied_balances.id` (PREPAYMENT) via financeAdapter | R-SAL-15 test |
| R-SAL-16 | DN create × 2 vs same SO line | — | sales_order_items.id (line) | SO item FOR UPDATE (first) | combined scheduled_qty ≤ SO line qty | over-scheduled | S04, S06 | SO item FOR UPDATE before aggregate | FOR UPDATE SO item | R-SAL-16 test |
| R-SAL-17 | SD confirm × 2 vs same DN remaining | — | delivery_notice_lines.id (line) | DN line FOR UPDATE (first) | combined delivered_qty ≤ DN remaining | over-delivered | S09, S06 | DN line FOR UPDATE before aggregate; legacy SD allowed (delivery_notice_id IS NULL) with SO line FOR UPDATE | FOR UPDATE DN line | R-SAL-17 test |
| R-SAL-18 | SO Change vs DN create/confirm | direct + document | sales_orders.id + affected sales_order_items.id + delivery_notice_lines.id | SO header → SO lines → DN lines | change applies to remaining obligation only | change after concurrent DN confirm | S05, S09 | shared apply service + effective_version + DN remaining recompute | same order for both paths | R-SAL-18 test |
| R-SAL-19 | SO Close/Cancel vs DN/SD confirm | — | sales_orders.id (commercial_close_state) + DN/SD | SO header FOR UPDATE → DN/SD FOR UPDATE | one wins; close does not silently coerce | silent coercion | S05, S09 | close_action + pending-DN check | FOR UPDATE both | R-SAL-19 test |
| R-SAL-20 | Consignment settlement × 2 vs same unsettled consigned quantity | — | consignment_commercial_lines.id (commercial line; seller ownership at Layer 2 per §29.19) | commercial line FOR UPDATE | combined settled ≤ consigned (seller ownership, not CUSTOMER-owned) | over-settled (seller ownership preserved until settlement event) | S18, §29.19 ownership correction | commercial line FOR UPDATE before aggregate; Inventory V21 position remains ENTERPRISE-owned during consignment | FOR UPDATE commercial line | R-SAL-20 test |
| R-SAL-21 | Consignment settlement vs consignment return | — | consignment_commercial_lines.id | commercial line FOR UPDATE | settlement or return commits; combined ≤ consigned; seller ownership preserved until settlement event | over-settled + returned; silent CUSTOMER-owner redefinition | S18, §29.19 | settlement + return serialized on same line; Layer 2 owner remains ENTERPRISE until settlement | FOR UPDATE commercial line | R-SAL-21 test |
| R-SAL-22 | Service fulfillment × 2 vs same Service order remaining | — | sales_order_items.id (service line) | SO service line FOR UPDATE (first) | combined confirmation_qty ≤ service line qty | over-confirmed | S08 | no inventory OUT path; service-only; service_classification = TRUE precondition | FOR UPDATE SO line + service_fulfillments | R-SAL-22 test |
| R-SAL-23 | Credit Recalculation vs new credit-consuming SO tx (CONDITIONAL — materializes only if §29.24 deviates from PURE_DERIVED) | — | N/A under PURE_DERIVED choice (§29.24) | N/A | N/A (rebuild is non-mutating) | stale rebuild overwrite of newer state | S14, S17, SC100 | under PURE_DERIVED: R-SAL-23 = structurally non-materialized | FOR UPDATE under materialized mode | none needed today; documented for future |
| R-SAL-24 | Credit Policy / Profile Mutation vs Credit Check | — | **credit_lock_anchors.id** (REFINED A-62); two anchor types distinguished: POLICY_SCOPE (for policy/rule mutation + shared read) and CREDIT_OBJECT (for profile mutation + shared read); secondary: credit_policy_snapshots.id (decision evidence identity; append-only by fingerprint) | Credit Check: 1) POLICY_SCOPE FOR SHARE; 2) CREDIT_OBJECT FOR UPDATE; 3) effective policy / profile / limit / overdue / rating read; 4) snapshot create-or-select FOR UPDATE; 5) evaluate. Policy/Rule Mutation: 1) POLICY_SCOPE FOR UPDATE; 2) apply new effective version; 3) commit (snapshot fingerprint may change on next read). Profile/Limit/Rating Mutation: 1) CREDIT_OBJECT FOR UPDATE; 2) apply new effective version; 3) commit. Combined Policy+Profile Mutation: 1) POLICY_SCOPE FOR UPDATE; 2) CREDIT_OBJECT FOR UPDATE; never reverse order. | one wins; check uses complete OLD or complete NEW snapshot; mutation appends new snapshot (immutable); if check was in-flight, it blocks on anchor until mutation completes, then re-reads | mixed OLD/NEW values inside one check evaluation | R-SAL-24 invariant (one credit decision = one coherent effective policy version) | both paths acquire the appropriate anchor (CREDIT_OBJECT and/or POLICY_SCOPE) FOR UPDATE first; snapshot is decision evidence, NOT the lock; if V22 changes effective rows, new credit_policy_snapshots row inserted as append-only; stable non-null canonical anchor_key is the lock identity (Final Closure decision) | FOR UPDATE / FOR SHARE on appropriate anchor; snapshot create-or-select FOR UPDATE | R-SAL-24 test |

### 29.45 Idempotency Design

```text
Command idempotency required for (at minimum):

- POST /api/sales-quotations/:id/convert-to-so
- POST /api/sales-orders/:id/submit
- POST /api/sales-orders/:id/approve
- POST /api/sales-orders/:id/reject
- POST /api/sales-orders/:id/close
- POST /api/sales-orders/:id/cancel
- POST /api/sales-orders/:id/controlled-change
- POST /api/sales-order-changes/:id/submit
- POST /api/sales-order-changes/:id/approve
- POST /api/delivery-notices/:id/confirm
- POST /api/sales-deliveries/:id/confirm
- POST /api/sales-returns/:id/confirm
- POST /api/sales-order-replacements/:id/fulfill
- POST /api/service-fulfillments/:id/confirm
- POST /api/consignment-commercial-documents/:id/settle
- POST /api/consignment-commercial-documents/:id/return
- POST /api/credit-check/evaluate
- POST /api/credit-special-approval/:id/decide
- POST /api/credit-evaluation/scoring-sheets/:id/finalize
- POST /api/credit-evaluation/scoring-sheets/:id/apply-to-profile
```

Idempotency key: follow each operation's frozen contract. A client-provided `Idempotency-Key` HTTP header is required where the API row says so; legacy operations may retain an already-frozen deterministic body key. **Wave 6 `SO_BACKED` / `NO_SOURCE` Option C Reverse is header-only per §30.31.6 and may not use a body, random or server-derived fallback.**

```text
same key + same payload  → replay (return existing result)
same key + diff payload  → 409 Conflict (per existing M14 / V22 pattern)
no key                   → 400 Bad Request (require key on these)
```

Persisted via `idempotency_records` (existing).

SO Change uses separate namespaces: request/submit keys deduplicate evidence creation, while `SO_CHANGE_APPLY:<change_id>:<target_version>` deduplicates approval/application. A replay with the same key and payload returns the existing APPLIED version; reuse against another payload/version is 409. `BOTH` cannot reuse a key across direct and document paths.

### 29.46 Implementation Waves

```text
Wave A  Foundation / Commercial Extensions / Pricing / Quotation
  - M3R-style foundation: sales_groups, salesperson_profiles,
    customer_commercial_extensions, customer_material_xref,
    product_commercial_classification
  - Pricing engine + price list + override authority
  - Quotation document lifecycle + conversion

Wave B  Sales Order Enrichment / Change / Lifecycle
  - SO commercial parties, tax-basis snapshot, prepayment requirement,
    reservation intent field, gift line flag, fulfillment projection
  - SO Change document

Wave C  Delivery Notice / Return / Replacement
  - Delivery Notice doc + capacity invariants
  - Sales Return 3-mode (DELIVERY_BACKED / SO_BACKED / NO_SOURCE)
  - Replacement obligation + state machine
  - Sales Delivery convergence (DN ref + delivery_notice_id column)

Wave D  Prepayment / Reservation Intent / Service Item Sales / Consignment
  - Prepayment Gate evaluator
  - Reservation intent writer + Planning integration
  - Service Item classification + confirmation
  - Consignment commercial document (3-layer)

Wave E  Credit Foundation / Exposure / Check / Approval / Evaluation
  - credit_parameters + credit_check_rules (effective-dated)
  - credit_profile + credit_profile_ratings + credit_evaluation*
  - credit_check_result + credit_special_approval
  - credit_recalculation_history (CHECK-only)
  - credit_query / exception DERIVED surfaces

Wave F  Mobile IA / Reporting / Compatibility Convergence
  - new routes (quotations, delivery-notices, sales-order-changes,
    replacements, service-fulfillments, consignment-commercial, credit)
  - launcher converge (≤ 6 primary entries)
  - extended decision-reports (sales-quotation-summary, sales-delivery-notice-
    execution, sales-replacement-execution, sales-ranking, credit-exceptions)
  - legacy compatibility behavior

Wave G  Concurrency / MySQL Hardening / Final Acceptance
  - R-SAL-01..24 evidence
  - 36 / 36 audit + 24 / 24 race + 44 / 44 UAT evidence
  - real MySQL functional + concurrency + performance gates
  - build, git diff --check, gates
```

### 29.47 SC Design Traceability

```text
SC01..SC114 expected = 114
SC01..SC114 designed  = 114
missing              = 0
```

Per-SC trace table is finalized in `document.md §34.13` (Manual → Audit CAP → Coverage → Gap → RC → SC family). This §29 Design contributes the per-SC physical mapping as below.

Per-SC trace conventions:

| Field | Source |
|---|---|
| SC ID | §34.3 |
| Requirement family | §34.3 (SC name) + §34.2 (scope status) |
| Physical model | this §29.2 + §29.4-29.27 |
| Service/owner | this §29.3 |
| API | this §29.31 |
| Permission | this §29.33 |
| Transaction | this §29.43 |
| Audit | this §29.35 |
| UAT refs | this §29.39 |
| Race refs | this §29.44 |
| Implementation wave | this §29.46 |

(No orphan SC; capability 1=physical 1-or-more rows is NOT required; classification per §29.2.1.)

### 29.48 Invariant Traceability

```text
S01..S20 expected = 20
S01..S20 designed = 20
missing          = 0
```

Per-invariant mechanism map:

| ID | Invariant | Design mechanism | Physical constraint | Transaction check |
|---|---|---|---|---|
| S01 | Sales commercial ≠ Inventory physical truth | 商业 fields never write to inventory_* | inventory_* columns immutable to Sales | never OUT_OF_SCOPE code path writes inventory directly |
| S02 | Sales commercial ≠ Finance open-item truth | AR / advance written only via Finance adapter | n/a (Sales has no AR table write) | Finance adapter enforces |
| S03 | Sales commercial ≠ GL truth | voucher engine is Accounting & Analytics | n/a | n/a |
| S04 | Quotation conversion preserves source trace | sales_quotation_conversions table | PK on (quotation_id, sales_order_line_id) | verified in convert-to-so |
| S05 | Approved history cannot be silently rewritten | both paths → shared SO Change evidence/application + effective_version + READ-ONLY past snapshot | sales_order_items historical snapshot immutable; only unexecuted remainder receives next version | idempotency + FOR UPDATE + state machine |
| S06 | Source-line capacity cannot be over-executed | sales_delivery_items / return_order_items / delivery_notice_lines capacity checks | FK + capacity check | FOR UPDATE on line + capacity compute |
| S07 | Gift revenue 0 ≠ inventory/cost 0 | is_gift_line + commercial amount 0; COGS continues | flag column | confirmed at confirm path |
| S08 | Service fulfillment ≠ inventory movement | service_fulfillments + products.is_service_classification gate | service lines block SD confirm | pre-check at SD confirm |
| S09 | Delivery Notice ≠ Sales Delivery ≠ Inventory Movement | three distinct tables; not collapsed | PK + FK on their own paths | separate FOR UPDATE |
| S10 | Return ≠ Delete; Replacement ≠ Return; NO_SOURCE ≠ fake sale | explicit commercial_source_marker; replacement FK to return | CHECK constraint | FOR UPDATE on mode-specific source |
| S11 | No-Source Return must visibly remain NO_SOURCE | commercial_source_marker = 'NO_SOURCE' | check constraint | explicit marker on every read |
| S12 | Reservation intent ≠ canonical reservation truth | sales_reservation_intent + planning_reservations | n/a (Sales has no canonical reserved qty) | intent does not write reserved qty |
| S13 | Prepayment Gate ≠ Advance-Receipt truth | Sales owns gate decision; Finance owns money truth | n/a (Finance balance canonical) | gate reads only, writes only result |
| S14 | Credit exposure must not double-count stages | bucket transition model §29.23 | n/a (DERIVED) | transition rule at every credit-touching write |
| S15 | Credit Check mandatory BLOCK must fail closed | evaluateCredit MUST return BLOCK on over-limit; backend enforces | n/a | fail-closed enforced in backend authorization |
| S16 | Credit exception is bounded | credit_special_approval ceiling/expiry/scope | scope + ceiling columns | FOR UPDATE on approval PK |
| S17 | Credit Recalculation must not rewrite historical truth | credit_recalculation_history records but never mutates canonical | n/a | CHECK-only / cache-optional |
| S18 | Consignment location ≠ ownership ≠ settlement | three-layer separation; Sales requests Inventory ENTERPRISE-owned position until settlement/title transfer | n/a (Sales has no own physical ledger) | settlement serialized on commercial line |
| S19 | Business dates are authoritative | ISO YYYY-MM-DD business_date columns throughout | date columns | validated at API entry |
| S20 | Same base currency baseline; multi-currency OUT_OF_SCOPE | currency_code column is single base; multi-currency out-of-scope per §34.10 | n/a (single currency enforced) | API rejects non-base |

### 29.49 Acceptance Architecture

Design target gates:

```text
focused unit/integration      : per SC capability (Wave A..F)
Functional Sales UAT         : 44 scenarios (§34.5; UAT-S-01..44)
Responsive browser matrix    : 320 / 390 / 430 / 680 (Wave F)
FAST                         : pnpm test:fast
FULL                         : pnpm test (canonical FULL regression)
HEAVY                        : pnpm test:heavy
build                        : pnpm build
git diff --check             : clean (no semantic / whitespace error)
SQLite compatibility          : node --test with both engines (per §29.42)
real MySQL functional        : pnpm test:mysql
generic MySQL concurrency    : pnpm test:mysql:concurrency
Sales MySQL concurrency      : R-SAL-01..24 evidence plan (§29.44)
MySQL performance (if applies): pnpm test:mysql:performance (only if scale requires)
```

These gates must pass before Implementation is frozen.

### 29.50 Final Design State

```text
Sales & Customer Domain Design contains:
  - 1 architectural scope statement (§29.1)
  - 1 physical-model inventory (§29.2; 5 sub-categories A..E)
  - 1 canonical-writer inventory (§29.3)
  - 1 commercial foundation design (§29.4)
  - 11 capability-family designs (§29.5-29.16 / 29.17-29.18 / 29.19 / 29.20-29.29)
  - 1 source-capacity edge table (§29.30; 15 edges)
  - 1 API inventory (§29.31)
  - 1 lifecycle inventory (§29.32)
  - 1 RBAC/SOD design (§29.33)
  - 1 approval boundary (§29.34)
  - 1 audit design (§29.35)
  - 1 Mobile IA design (§29.36)
  - 1 route design (§29.37)
  - 1 responsive design (§29.38)
  - 1 reporting design (§29.39)
  - 1 historical compatibility matrix (§29.40; legacy-bypass-default-NO)
  - 1 schema constraints table (§29.41)
  - 1 SQLite/MySQL parity checklist (§29.42)
  - 1 transaction model (§29.43; canonical lock order)
  - 1 R-SAL-01..24 lock matrix (§29.44; with corrected lockable anchors)
  - 1 idempotency design (§29.45)
  - 1 implementation waves (§29.46)
  - 1 SC design traceability commitment (§29.47)
  - 1 invariant traceability (§29.48)
  - 1 acceptance architecture (§29.49)

Physical model counts (post-remote-review rebuild):
  A tables total                  = 70
    EXISTING_CONVERGE              = 25
    NEW                            = 45   (A-25..A-66 + A-68..A-70)
    DEPRECATED_NO_NEW_WRITES (tbl) =  0
  B existing-table extensions      =  7 (32 logical fields; 31 ADD + 1 reused)
  C derived views / projections   =  5 (4 pure-no + 1 controlled-hybrid; C-06 removed)
  D compatibility behaviors        =  6 (legacy read=YES; new write through bypass=NO)
  E deprecated-no-new-write fields =  1 (products.price_cents; single classification)

Sum check:
  A tables: 25 + 45 + 0 = 70 ✓
  Sub-categories are disjoint (every table belongs to exactly one of A classifications)
  Columns are NEVER counted as tables (see B for column extensions)

Sum checks (structural trace complete; product decisions frozen):
  114 SC  : 114 designed 0 orphan
   20 S##  : 20 designed 0 missing
   44 UAT  : 44 designed 0 missing
   24 RACE : 24 designed 0 missing 0 TBD
   36 CAP  : trace preserved; Requirement PASS / FROZEN
   15 Cross-Domain Boundary families  : 1:1 with §34.8

Frozen Dependency Discipline:
  - Customer identity  → Master & Engineering
  - Material identity  → Master & Engineering
  - Login/user identity → Platform (optional link only)
  - Salesperson identity → Sales & Customer (`salesperson_profiles.id`)
  - Sales-group identity → Sales & Customer (`sales_groups.id`)
  - Physical inventory → Inventory & Warehouse (V21 §32)
  - Reservation        → Planning (V19 §30)
  - OQC                → Manufacturing & Quality (V18 §29)
  - AR / Advance / Refund / Write-off / Invoice / Treasury → Finance Operations (V22 §33)
  - Voucher / GL       → Accounting & Analytics
  - RBAC / Workflow / Audit notification / Numbering → Platform

Sales never writes second ledger:
  - no Sales-side inventory table write
  - no Sales-side AR write
  - no Sales-side reservation qty write
  - no Sales-side voucher write
  - no Sales-side credit exposure mutable ledger
  - credit exposure = DERIVED (§29.24 default)

DR-SAL-01 Option A is approved: A-65 carries all four modes, both paths use the shared application service, and SC37..SC40 / UAT-S-15 / Wave 4 are internally aligned. External review returned PASS and user Freeze approval is confirmed; this Technical Design is `PASS / FROZEN` at content baseline `5469891b78acb5b03940944698e5c51a38cf5491`.

#### 29.50.1 Frozen-domain boundary matrix (task §21)

| Frozen Domain | Canonical truth consumed by Sales | Sales write allowed? | Adapter / contract | Design change required to frozen domain? |
|---|---|---|---|---|
| Master & Engineering (V17) | customer identity; product identity; warehouse identity; UoM foundation; service classification (via own table `product_commercial_classification`, NOT by adding column to products) | NO (NO CHANGE) | Customer/Product/Warehouse UoM as FK target; Service classification via Sales-owned extension | NO CHANGE — Sales does not add column to products |
| Planning (V19) | reservation canonical quantity (read-only) | NO direct write | canonical reservation adapter / `assertStrongReservationAvailability` | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** for finite EXPECTED-supply capacity + adjust/consume contract; no second balance |
| Manufacturing & Quality (V18) | OQC outcome | NO (NO CHANGE) | `assertQualityGate('OQC', deliveryId)` reader | NO CHANGE |
| Inventory & Warehouse (V21) | physical inventory truth; on-hand; locks; owner_type; consignment-position (ENTERPRISE-owned during consignment, see §29.19) | NO direct write (NO CHANGE) | `applyInventoryMutation`, `postTrackedMovement` adapters | **NO CHANGE** — V21 canonical position supports `owner_type = ENTERPRISE` at any position; consignment_commodity_location is modeled as a warehouse_id; consignment uses existing ENTERPRISE owner marker; no schema change required (see §29.19.4); do NOT silently redefine CUSTOMER-owned |
| Finance Operations (V22) | AR open amount; advance / unapplied / refund / write-off; collection; invoice; treasury; provisional / financial recognition; eligible prepayment (per §29.16); `settlement_unapplied_balances` (PREPAYMENT parent balance row) | NO (NO CHANGE) | `recognizeFinanceExposure` / `applyCreditAdjustment` / `generateVoucher` / `createSystemVoucher`; `financeAdapter.resolveCreditExposureComponents`, `financeAdapter.resolveARForCustomerSalesContext`; **`financeAdapter.resolveEligiblePrepaymentForSalesGate(..., lockMode = FOR_UPDATE)`** for R-SAL-15; **Finance mutations `applyUnappliedBalance` / `createRefund` / `reverseSettlementDocument` (PREPAYMENT/UNAPPLIED reduction)** must acquire `settlement_unapplied_balances.id FOR UPDATE` | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** (Repository-Evidence Final Closure; no conditional wording) for the canonical `lockMode = FOR_UPDATE` parent-balance row contract; see §29.16.3.8; other reads are NO CHANGE — Sales reads via adapter only; never reconstructs AR truth |
| Accounting & Analytics | voucher / GL | NO (NO CHANGE) | n/a | NO CHANGE |
| Platform | login/user identity; RBAC; workflow mechanics; audit notification; numbering; generic mechanics; document relation-conversion; **shared canonical idempotency_records (A-21)** | limited writes (ApprovalRequests for SALES_ORDER family); A-64 may hold a nullable FK to `users.id` but never writes Platform user business fields | Platform provides mechanics only; actual repo has no suitable generic parameter storage, so A-65 storage + namespace/codes/validation/business semantics remain Sales-owned; Sales uses A-21 for command identities | **NO CHANGE** — no Sales columns on `users` and no new Platform schema; Platform owns login/mechanics, Sales owns salesperson identity and Sales parameter semantics |

Required Sales Design change to a frozen domain = **NO CHANGE for most frozen domains** EXCEPT:

- **Inventory & Warehouse (V21) / Consignment**: **NO CHANGE** (V21 canonical position supports `owner_type = ENTERPRISE` at any position; consignment_commodity_location is modeled as a warehouse_id; no schema change required; see §29.19.4).
- **Finance Operations (V22) / Prepayment Gate (R-SAL-15)**: **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** (Repository-Evidence Final Closure decision; no conditional wording).
  Sales requires `financeAdapter.resolveEligiblePrepaymentForSalesGate(..., lockMode = FOR_UPDATE)` to acquire canonical Finance `settlement_unapplied_balances.id` (PREPAYMENT) FOR UPDATE in the same transaction.
  Current V22 does NOT yet provide the required MySQL parent-balance row lock on all R-SAL-15 balance-reducing paths; therefore the bounded extension covers:
    - Sales transactional locked-read adapter
    - Finance `applyUnappliedBalance` (acquire parent balance FOR UPDATE before re-read/validation)
    - Finance `createRefund` (acquire parent balance FOR UPDATE before capacity decision)
    - Finance `reverseSettlementDocument` for PREPAYMENT / UNAPPLIED reduction (acquire parent balance FOR UPDATE before remaining / validation / `settlement_reversal_items` mutation)
  Business semantics: UNCHANGED; canonical balance: `settlement_unapplied_balances` (NO CHANGE); duplicate truth: NONE.
  See §29.16.3.
- **Platform / shared / Idempotency (A-21 idempotency_records)**: **NO CHANGE**. A-21 is shared Platform infrastructure. Sales uses it for Sales command identities (semantic namespaces: quotation conversion, DN confirm, service fulfillment confirm, etc.). Sales owns the namespace meaning, not the storage infrastructure. See §29.16.2 / §29.45.

The 18 sales credits / 9 credit capability business semantics remain entirely within Sales-owned tables (sales_credit_parameters, sales_credit_check_rules, sales_credit_policy_snapshots, sales_credit_profile, sales_credit_check_result, sales_credit_special_approval, sales_credit_evaluation_*, sales_credit_recalculation_history) and consume Finance + Planning + Inventory canonical facts via existing adapters.

If Implementation evidence shows any of these require a frozen-domain schema change, then file:

  FROZEN_DOMAIN_INTEGRATION_DEFECT  (not a silent change)

or:

  BOUNDED INTEGRATION CONTRACT EXTENSION  (documented, scoped, auditable)

and revise this §29.50.1 before Implementation. Do NOT silently alter a frozen Domain schema.

Out of Design scope (per §34.10; not in this Domain closure):
  - multi-currency
  - external credit bureau / AI / ML / complex corporate-risk analytics
  - CRM extension
  - Generic Workflow engine
  - mobile IA wider than launcher ≤ 6 primary entries
  - schema migration code (Implementation)

External Review Result — PASS:
  - per §34.13 36/36 CAP trace
  - per §34.13.1 114/114 SC acceptance coverage
  - per §34.5 44 UAT-IDs
  - per §34.6 24 race IDs (no TBD)
  - per §34.4 20 invariants

Technical Design: PASS / FROZEN.
User Freeze approval: CONFIRMED.
```

---

### 29.51 Cross-References (§29 only)

| Topic | Section |
|---|---|
| Architecture / Ownership | §29.1 |
| Physical Model Inventory | §29.2 |
| Canonical Writer Inventory | §29.3 |
| Sales Commercial Foundation | §29.4 |
| Quotation Design | §29.5 |
| Sales Pricing Design | §29.6 |
| Order-Time Discount Design | §29.7 |
| Sales Order Canonical Model | §29.8 |
| Sales Order Change Design | §29.9 |
| Sales Order Fulfillment / Close Lifecycle | §29.10 |
| Delivery Notice Design | §29.11 |
| Sales Delivery Convergence | §29.12 |
| Sales Return Design | §29.13 |
| Replacement / Replenishment Design | §29.14 |
| Gift Line Design | §29.15 |
| Prepayment Gate Design | §29.16 |
| Reservation Intent Design | §29.17 |
| Service Item Sales Design | §29.18 |
| Consignment Three-Truth Design | §29.19 |
| Credit Architecture Overview | §29.20 |
| Credit Policy / Version / Effective Snapshot | §29.21 |
| Credit Profile | §29.22 |
| Credit Occupancy / Exposure Model | §29.23 |
| Credit Projection / Cache Decision | §29.24 |
| Credit Check Design | §29.25 |
| Credit Special Approval Design | §29.26 |
| Credit Evaluation | §29.27 |
| Credit Recalculation | §29.28 |
| Credit Query / Exception History | §29.29 |
| Source / Capacity Model | §29.30 |
| API Inventory | §29.31 |
| Lifecycle Inventory | §29.32 |
| RBAC / SOD Design | §29.33 |
| Approval / Workflow Boundary | §29.34 |
| Audit Design | §29.35 |
| Mobile IA Design | §29.36 |
| Route Design | §29.37 |
| Responsive Design | §29.38 |
| Reporting Design | §29.39 |
| Historical Compatibility | §29.40 |
| Schema Constraints | §29.41 |
| SQLite / MySQL Parity | §29.42 |
| Transaction Model | §29.43 |
| R-SAL-01..24 Lock Matrix | §29.44 |
| Idempotency Design | §29.45 |
| Implementation Waves | §29.46 |
| SC Design Traceability | §29.47 |
| Invariant Traceability | §29.48 |
| Acceptance Architecture | §29.49 |
| Final Design State | §29.50 |
| Cross-References | §29.51 |

---
