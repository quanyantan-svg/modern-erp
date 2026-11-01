# Sales & Customer — Implementation Wave Plan

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/design/sales-customer/README.md`
> 来源：`solution.md` §30、§30.26（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 30. Sales & Customer Domain Implementation Wave Plan

> This is the Implementation Sequencing Plan only. It was limitedly reopened on 2026-10-13 together with §29 to close the remote-review Requirement / Design defects. External review returned PASS and user Freeze approval is confirmed; the plan is now `PASS / FROZEN`. Waves 1–13 remain `NOT IMPLEMENTED / NOT ACCEPTED`.
> Plan-only output: no code, no migrations, no schema, no tests, no stages, no commits, no pushes, no tag, no version bump.

### 30.1 Total final wave count

```text
14 implementation waves (Wave 0 through Wave 13)
```

Each wave is small enough that one engineer / coding agent can implement, test, review the diff, and reason about its invariants as one coherent checkpoint. Regrouping / splitting is permitted if Implementation evidence demands it; this plan is the baseline.

### 30.2 Wave summary table

| Wave | One-line business objective | Primary SC IDs (count) | Primary new physical tables | Primary file changes (planned; not yet executed) |
|---|---|---|---|---|
| 0 | Schema / shared Sales infrastructure + migration runner readiness | n/a (foundation) | 0 | server/migrations/* (infrastructure; no new tables yet); existing migration files remain untouched |
| 1 | Sales parameters + Sales Groups / multi-membership + Customer commercial extension/xref + sellable rules + product commercial classification foundation | 6 (SC02..SC05, SC07, SC69) | 8 (`sales_parameters`, `sales_groups`, `salesperson_profiles`, `salesperson_group_memberships`, `customer_commercial_extensions`, `customer_material_xref`, `sales_sellable_scope_rules`, `product_commercial_classification`) | Sales-owned foundation modules + customer detail integration; no `users` / Master schema extension |
| 2 | Pricing engine + Order-Time Discount + customer price-list/discount-table defaults | 9 (SC15..SC23) | 5 (`sales_price_lists`, `sales_price_list_entries`, `sales_price_list_versions`, `sales_discount_schemes`, `sales_discount_scheme_rules`) | add exactly two A-39 nullable default FKs only after A-28/A-31 exist; contextual pricing/discount sub-page under existing Sales & Customer navigation; no top-level route |
| 3 | Quotation + Quotation conversion | 6 (SC09..SC14) | 3 (sales_quotations, sales_quotation_lines, sales_quotation_conversions) | server/modules/quotation.js (new); src/pages/quotations.jsx (new route); conversion API with idempotency |
| 4 | Sales Order enrichment + lifecycle + two-path Change + line schedule snapshot | 20 (SC24..SC29, SC31..SC44) | 2 (sales_order_changes, sales_order_change_lines) | shared canonical change application service; direct/document request handlers; additive SO/line snapshots; approval/version/audit concurrency contract |
| 5 | Delivery Notice + direct/notice-backed Sales Delivery convergence + tolerance execution | 11 (SC08, SC30, SC45..SC53) | 2 (delivery_notices, delivery_notice_lines) | truthful DIRECT_ORDER / DELIVERY_NOTICE source identity; shared SO capacity/gates plus DN capacity where applicable |
| 6 | Returns + Replacement | 8 (SC54..SC61) | 3 (sales_order_replacements, sales_order_replacement_lines, sales_replacement_fulfillments) | SR canonical writer extended with three truthful modes, strict Option-A Inventory/valuation/voucher adapter and independent Finance-credit branch; Replacement uses line-level multi-Delivery evidence; return_orders.commercial_source_marker and return_order_items.sales_order_item_id are additive; src/pages/returns.jsx extended with replacement tab |
| 7 | Finance V22 R-SAL-15 bounded extension + Prepayment Gate + Reservation Intent | 8 (SC01, SC62..SC68) | 3 (sales_prepayment_requirements, sales_prepayment_gate_results, sales_reservation_intent) | final SC01 execution via reservation behavior after order-change and delivery parameter controls; Finance locked-read extension |
| 8 | Service Fulfillment + Consignment commercial | 8 (SC70..SC77) | 4 (service_fulfillments, consignment_commercial_documents, consignment_commercial_lines, consignment_commodity_locations) | server/modules/service-fulfillment.js; server/modules/consignment.js; src/pages/consignment.jsx; SD confirm gate |
| 9 | Credit stable anchor + Credit Policy + Profile foundation | 7 (SC83..SC89) | 6 (credit_lock_anchors, credit_policy_snapshots, credit_parameters, credit_check_rules, credit_profile, credit_profile_ratings) | server/modules/credit-anchor.js (new; ensureCreditLockAnchor + first-use provisioning); server/modules/credit-policy.js; legacy credit_profile backfill in migration |
| 10 | Credit Check + Special Approval + Exposure | 10 (SC82, SC90..SC98) | 2 (credit_check_results, credit_special_approval) | server/modules/credit-check.js (evaluateCredit service); server/modules/credit-special-approval.js; PURE_DERIVED exposure; recognition-mode aware |
| 11 | Credit Evaluation + Reconciliation + Query | 9 (SC99..SC107) | 6 (credit_evaluation_indicator, credit_evaluation_scheme, credit_evaluation_model, credit_evaluation_scoring_sheet, credit_evaluation_result, credit_recalculation_history) | server/modules/credit-evaluation.js; credit_query_snapshot (DERIVED C-02) + credit_exposure_view (DERIVED C-01) query layer |
| 12 | Mobile IA + Reporting + Compatibility + Sales-group data-scope convergence | 5 (SC06, SC78..SC81) + 7 (SC108..SC114) | 0 | final backend group-filter/report proof + new routes; launcher ≤ 6 primary entries; decision reports extensions; responsive convergence |
| 13 | MySQL race hardening + Final domain acceptance | n/a (verification) | 0 | tests only; real MySQL functional + concurrency + performance gates; 24 race evidence plan executed |

### 30.3 Dependency DAG

```text
Wave 0 (Schema / shared Sales infrastructure)
  └─ Wave 1 (Customer commercial extensions + service classification foundation)
       ├─ Wave 2 (Pricing + Order-Time Discount)
       │    └─ Wave 3 (Quotation + Quotation conversion)
       │         └─ Wave 4 (Sales Order enrichment + lifecycle + Change)
       │              ├─ Wave 5 (Delivery Notice + Sales Delivery convergence)
       │              │    └─ Wave 6 (Returns + Replacement)
       │              │         └─ Wave 8 (Service Fulfillment + Consignment)
       │              ├─ Wave 7 (Finance V22 R-SAL-15 extension + Prepayment Gate + Reservation Intent)
       │              │    └─┐
       │              └─ Wave 9 (Credit stable anchor + Policy + Profile foundation)
       │                   └─ Wave 10 (Credit Check + Special Approval + Exposure)
       │                        └─ Wave 11 (Credit Evaluation + Query)
       ├─ Wave 6 ─┐
       │         │
       ├─ Wave 7 ─┤
       │         │
       ├─ Wave 8 ─┼→ Wave 12 (Mobile IA + Reporting + Compatibility convergence) → Wave 13 (MySQL race hardening + Final domain acceptance)
       │         │
       └─ Wave 11 ┘
```

No cycles. Every dependency is explicit. Wave 12 depends on Waves 6 / 7 / 8 / 11 (the branches that produce the workflows Wave 12 must report / expose / reconcile). **Wave 13 depends on Wave 12**; the convergence edge is `Wave 12 → Wave 13`, which transitively requires every preceding business branch.

### 30.4 SC allocation (114/114, duplicates 0, missing 0)

```text
SC expected = 114
SC assigned = 114
duplicates  = 0
missing    = 0
```

| Wave | SC IDs (count) |
|---|---|
| 1 | SC02, SC03, SC04, SC05, SC07, SC69 (6) |
| 2 | SC15, SC16, SC17, SC18, SC19, SC20, SC21, SC22, SC23 (9) |
| 3 | SC09, SC10, SC11, SC12, SC13, SC14 (6) |
| 4 | SC24, SC25, SC26, SC27, SC28, SC29, SC31, SC32, SC33, SC34, SC35, SC36, SC37, SC38, SC39, SC40, SC41, SC42, SC43, SC44 (20) |
| 5 | SC08, SC30, SC45, SC46, SC47, SC48, SC49, SC50, SC51, SC52, SC53 (11) |
| 6 | SC54, SC55, SC56, SC57, SC58, SC59, SC60, SC61 (8) |
| 7 | SC01, SC62, SC63, SC64, SC65, SC66, SC67, SC68 (8) |
| 8 | SC70, SC71, SC72, SC73, SC74, SC75, SC76, SC77 (8) |
| 9 | SC83, SC84, SC85, SC86, SC87, SC88, SC89 (7) |
| 10 | **SC82, SC90, SC91, SC92, SC93, SC94, SC95, SC96, SC97, SC98** (10 — Credit Exposure Canonical-Fact Invariant is primary here; runtime credit check / exposure / special approval require it) |
| 11 | SC99, SC100, SC101, SC102, SC103, SC104, SC105, SC106, SC107 (9) |
| 12 | SC06, SC78, SC79, SC80, SC81, SC108, SC109, SC110, SC111, SC112, SC113, SC114 (12) |
| 13 | verification only (all 114 SC acceptance covered by 1–12; Wave 13 verifies) |

Sum check: 6+9+6+20+11+8+8+8+7+10+9+12 = 114 ✓ (Wave 0 = n/a, Wave 13 = verification).

Primary wave means earliest **final-completion** wave, not first table creation. SC01 completes in Wave 7 (parameter storage W1; order-change W4; delivery controls W5; reservation behavior W7). SC06 completes in Wave 12 (identity/membership W1; Quotation/SO group snapshots W3/W4; final report/backend data-scope proof W12). SC08 and SC30 complete in Wave 5 when commercial defaults/UoM resolution plus line snapshot and DN/SD tolerance execution are all executable. No SC ID is added, removed, or duplicated.

### 30.5 Invariant allocation (20/20)

```text
S expected = 20
S assigned = 20
missing   = 0
```

| Invariant | First enforcing wave | Final verifying wave |
|---|---|---|
| S01 (commercial ≠ inventory) | 1 (Customer commercial extensions; SD confirm path enforces) | 13 (full MySQL regression) |
| S02 (commercial ≠ AR) | 4 (SO enrichment; AR adapter paths) | 13 |
| S03 (commercial ≠ GL) | 4 (voucher flows deferred to Finance) | 13 |
| S04 (Quotation conversion preserves source trace) | 3 (Quotation conversion) | 13 |
| S05 (history not silently rewritten) | 4 (SO Change; commercial_close_state) | 13 |
| S06 (source-line capacity not over-executed) | 5 (DN capacity; SD confirm) | 13 |
| S07 (Gift revenue 0 ≠ cost 0) | 4 (is_gift_line flag; COGS continues) | 13 |
| S08 (Service ≠ Inventory) | 8 (Service Fulfillment gate; no inventory OUT) | 13 |
| S09 (DN ≠ SD ≠ Inventory) | 5 (DN lifecycle; SD reads DN; Inventory V21) | 13 |
| S10 (Return ≠ Delete; Replacement ≠ Return; NO_SOURCE ≠ fake sale) | 6 (3-mode return; replacement) | 13 |
| S11 (NO_SOURCE marker) | 6 (NO_SOURCE commercial_source_marker) | 13 |
| S12 (Reservation intent ≠ canonical reservation) | 7 (sales_reservation_intent; Planning canonical) | 13 |
| S13 (Prepayment Gate ≠ Advance-Receipt truth) | 7 (R-SAL-15 financeAdapter; canonical V22 balance lock) | 13 |
| S14 (Credit exposure no double-count) | 10 (recognition-mode aware bucket transition) | 13 |
| S15 (BLOCK fail-closed) | 10 (evaluateCredit + ensureCreditLockAnchor) | 13 |
| S16 (Credit exception bounded) | 10 (credit_special_approval; ceiling + scope + expiry) | 13 |
| S17 (Recalculation no historical rewrite) | 11 (credit_recalculation_history; CHECK-only default) | 13 |
| S18 (Consignment location ≠ ownership ≠ settlement) | 8 (3-layer separation) | 13 |
| S19 (Business dates authoritative) | 4 (SO creation; enforced ISO date) | 13 |
| S20 (Single base currency) | 2 (Pricing engine; no multi-currency) | 13 |

### 30.6 UAT allocation (44/44)

```text
UAT expected = 44
assigned    = 44
missing     = 0
```

| Wave | UAT IDs (count) |
|---|---|
| 1 | no final-completion UAT (foundation focused tests only) (0) |
| 2 | UAT-S-04..09 (Pricing + override + snapshot + Discount) (6) |
| 3 | UAT-S-01..03 (Quotation lifecycle + conversion) (3) |
| 4 | UAT-S-10..16 (SO parties / gift / tax terms / submit / change / fulfill) + UAT-S-39 (edit policy) + UAT-S-42 (commercial tax-basis boundary) + UAT-S-43 (gift cost retention); Sales-foundation partial assertions only (10) |
| 5 | UAT-S-17 (DN capacity) + UAT-S-18 (SD confirm) (2) |
| 6 | UAT-S-19..21 (3-Return modes) + UAT-S-22 (Replacement) (4) |
| 7 | UAT-S-23 (Prepayment Gate) + UAT-S-24 (Reservation Intent) + UAT-S-28 (final Sales foundation) + UAT-S-40 (canonical read-only) (4) |
| 8 | UAT-S-25 (Service Item) + UAT-S-26..27 (Consignment) + UAT-S-41 (consignment location / ownership / settlement distinction) (4) |
| 9 | UAT-S-29 (Credit Profile) + UAT-S-30 (Credit Parameters + Rules) (2) |
| 10 | UAT-S-31 (Occupancy transition) + UAT-S-32 (Credit Check) + UAT-S-33 (Special Approval) (3) |
| 11 | UAT-S-34 (Recalculation) + UAT-S-35 (Query + Exception) + UAT-S-36 (Evaluation) (3) |
| 12 | UAT-S-37 (Reporting — execution) + UAT-S-38 (Reporting — outstanding + GP + ranking) + UAT-S-44 (Permission / RBAC / SOD) (3) |

Sum: 0+6+3+10+2+5+4+3+2+3+3+3 = 44 ✓

The Sales Order Change acceptance assigned to Wave 4 contains a parameterized matrix over all four `order_change_mode` values and both path types: DISABLED blocks both; each single-path mode admits only its named path; BOTH admits both without permission or approval bypass. Every admitted case proves separate requester/approver, canonical apply reuse, idempotent replay, append-only before/after evidence, monotonic effective version and non-retroactive parameter snapshot. Negative cases cover stale base version, forbidden field/source reassignment, reduction below notified/delivered/reserved/recognized quantity, missing authority, self-approval and adapter/audit failure rollback. R-SAL-07 / 08 / 18 provide concurrency acceptance; no new Race ID is required.

### 30.7 Race allocation (24/24)

```text
Race Requirement IDs assigned = 24 / 24

Materialized executable MySQL race scenarios
= 23  (all R-SAL-01..24 except R-SAL-23)

Conditional structural race
= 1
  R-SAL-23
  (frozen PURE_DERIVED baseline; structurally non-materialized under current baseline)

Race coverage
= 24 / 24  (R-SAL-23 covered as structural assertion, not materialized test)
TBD = 0
```

R-SAL-23 keeps its frozen PURE_DERIVED conditional semantics; structurally possible from Wave 9 onward (anchor infrastructure), but materially non-materialized until persisted cache is introduced (which is NOT the chosen baseline).

Acceptance form under the frozen baseline:

```text
Race coverage                 = 24 / 24
Materialized MySQL race tests = 23
Structural assertion races     = 1 (R-SAL-23: "no persisted mutable Credit Exposure
                              cache exists; no stale rebuild can overwrite newer
                              exposure state; therefore the cache-rebuild race
                              is structurally non-materialized")
```

If implementation later proposes a persisted Credit Exposure cache, STOP + REQUIREMENT_REOPEN_REQUIRED / DESIGN_REOPEN_REQUIRED.

| Race | First structurally possible | First executable MySQL test | Final acceptance |
|---|---|---|---|
| R-SAL-01 | 5 (SD confirm) | 5 | 13 |
| R-SAL-02 | 7 (Reservation Intent + Planning) | 7 | 13 |
| R-SAL-03 | 6 (Return) | 6 | 13 |
| R-SAL-04 | 4 (M14 Sales Discount; existing) | 4 (already exists) | 13 |
| R-SAL-05 | 5 (SD vs SR) | 5 | 13 |
| R-SAL-06 | 3 (Quotation convert) | 3 | 13 |
| R-SAL-07 | 4 (SO Change vs approve) | 4 | 13 |
| R-SAL-08 | 4 (SO Change vs SD) | 4 | 13 |
| R-SAL-09 | 6 (SD vs Return/Reopen) | 6 | 13 |
| R-SAL-10 | 6 (Return vs Replacement) | 6 | 13 |
| R-SAL-11 | 2 (Pricing vs Order approval) | 2 | 13 |
| R-SAL-12 | 9 (CREDIT_OBJECT anchor) | 9 | 13 |
| R-SAL-13 | 10 (Special Approval vs Order) | 10 | 13 |
| R-SAL-14 | 10 (Credit release vs Collection/Return) | 10 | 13 |
| R-SAL-15 | 7 (Prepayment Gate vs Finance) | 7 | 13 |
| R-SAL-16 | 5 (DN create vs SO capacity) | 5 | 13 |
| R-SAL-17 | 5 (SD vs DN remaining) | 5 | 13 |
| R-SAL-18 | 5 (SO Change vs DN) | 5 | 13 |
| R-SAL-19 | 5 (SO Close vs DN/SD) | 5 | 13 |
| R-SAL-20 | 8 (Consignment settlement) | 8 | 13 |
| R-SAL-21 | 8 (Consignment settlement vs return) | 8 | 13 |
| R-SAL-22 | 8 (Service fulfillment) | 8 | 13 |
| R-SAL-23 | 9 (Credit recalculation; PURE_DERIVED) | 13 (only structurally asserted) | 13 (structural assertion) |
| R-SAL-24 | 9 (POLICY_SCOPE + CREDIT_OBJECT) | 9 | 13 |

### 30.8 Physical schema / migration allocation

```text
new physical tables total = 44
corrected existing-table extension inventory = 7 tables / 32 logical fields
actual NEW extension fields requiring schema migration = 31
existing reused extension fields requiring NO ADD COLUMN = 1
  sales_deliveries.billing_mode
duplicate ADD attempts = 0
```

Wave 6 arithmetic after this bounded correction:

```text
new tables                         = 3  (unchanged)
extended existing tables          = 2  (return_orders, return_order_items)
Wave 6 new logical extension fields = 2  (commercial_source_marker,
                                           sales_order_item_id)
```

The corrected §29 inventory is the logical Design inventory. Wave 1 adds eight Sales-owned tables and zero fields to existing tables. Wave 2 adds nullable `default_pricing_list_id` / `default_discount_scheme_id` only after A-28/A-31 exist.

| Existing table | Logical field | Frozen §29 classification | Current physical state | Implementation wave | Migration action |
|---|---|---|---|---:|---|
| `customer_commercial_extensions` | `default_pricing_list_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 2 | `ADD` after `sales_price_lists`; nullable FK, no fabricated default |
| `customer_commercial_extensions` | `default_discount_scheme_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 2 | `ADD` after `sales_discount_schemes`; nullable FK, no fabricated default |
| `sales_orders` | `salesperson_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; FK A-64 |
| `sales_orders` | `sales_group_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; FK A-63 |
| `sales_orders` | `settlement_party_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `payer_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `customer_material_xref_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `commercial_tax_code` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `tax_inclusive` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `required_prepayment_cents` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `reservation_intent_state` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `commercial_close_state` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `gift_summary_cents` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `commercial_pricing_uom_code` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `effective_version` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD INTEGER NOT NULL DEFAULT 1 CHECK >= 1`; initialize new SO at `1`; legacy backfill `1` is a compatibility baseline only; canonical application uses locked-read + CAS |
| `sales_order_items` | `is_gift_line` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `commercial_tax_basis` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `tax_inclusive_assumption` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `pricing_uom_code_applied` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `qty_break_applied_min` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `qty_break_applied_max` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `planned_delivery_date` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; bounded one-schedule-per-line identity is the item id |
| `sales_order_items` | `upper_delivery_tolerance_bps` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; immutable approved snapshot; CHECK >= 0 |
| `sales_order_items` | `lower_delivery_tolerance_bps` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; immutable approved snapshot; CHECK 0..10000 |
| `sales_order_items` | `price_snapshot_json` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; nullable physical compatibility, mandatory validated server evidence for every Batch A new line; immutable after approval |
| `sales_order_items` | `discount_snapshot_json` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; nullable physical compatibility, mandatory ordered stage/allocation evidence including explicit zero discount; immutable after approval |
| `sales_deliveries` | `delivery_notice_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 5 | `ADD` |
| `sales_deliveries` | `source_mode` | `NEW_LOGICAL_FIELD` | `ABSENT` | 5 | `ADD`; CHECK DIRECT_ORDER / DELIVERY_NOTICE / LEGACY_UNCLASSIFIED |
| `sales_deliveries` | `billing_mode` | `EXISTING_REUSED_FIELD` | `EXISTS` (`v13-phase6e-commercial-golive`) | 5 | `REUSE_EXISTING` |
| `sales_delivery_items` | `delivery_notice_line_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 5 | `ADD` |
| `return_orders` | `commercial_source_marker` | `NEW_LOGICAL_FIELD` | `ABSENT` | 6 | `ADD` |
| `return_order_items` | `sales_order_item_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 6 | `ADD`; nullable real FK to `sales_order_items.id`; no historical inference/backfill; SO_BACKED only |

```text
logical extension fields = 32 / 32
new schema fields to add = 31
existing extension fields reused = 1
duplicate ADD attempts = 0
```

| Wave | New tables | Existing tables extended | Migration scope (planned) |
|---|---|---|---|
| 0 | 0 | 0 | migration runner readiness only; no new migration content |
| 1 | 8 (`sales_parameters`, `sales_groups`, `salesperson_profiles`, `salesperson_group_memberships`, `customer_commercial_extensions`, `customer_material_xref`, `sales_sellable_scope_rules`, `product_commercial_classification`) | 0 | bounded Sales parameter codes; independent xref/sellable rules; customer/person anchor overlap locks; no `users` / Master extension; no Wave-2 FK; SQLite + MySQL compatible |
| 2 | 5 (`sales_price_lists`, `sales_price_list_entries`, `sales_price_list_versions`, `sales_discount_schemes`, `sales_discount_scheme_rules`) | `customer_commercial_extensions` (+ exactly `default_pricing_list_id`, `default_discount_scheme_id`, both nullable) | create all five targets with PK/UNIQUE/CHECK/FK metadata first; current Bootstrap materializes the four-column entry UNIQUE inline; canonical registry replay installs/verifies dialect-local normalized-key guards; add the two fields without rewriting rows; SQLite verifies PRAGMA/sqlite_master and MySQL verifies named real FKs/index/triggers through information_schema; fresh/upgrade/repeat converge or fail closed on mismatch |
| 3 | 3 (sales_quotations, sales_quotation_lines, sales_quotation_conversions) | 0 | new migration file; UNIQUE on (quotation_id, line_no); PR UNIQUE on (quotation_id, sales_order_line_id); idempotency_key column |
| 4 | 2 (sales_order_changes, sales_order_change_lines) | sales_orders (+ 13 cols: salesperson_id, sales_group_id, settlement_party_id, payer_id, customer_material_xref_id, commercial_tax_code, tax_inclusive, required_prepayment_cents, reservation_intent_state, commercial_close_state, gift_summary_cents, commercial_pricing_uom_code, effective_version), sales_order_items (+ 11 cols: is_gift_line, commercial_tax_basis, tax_inclusive_assumption, pricing_uom_code_applied, qty_break_applied_min, qty_break_applied_max, planned_delivery_date, upper_delivery_tolerance_bps, lower_delivery_tolerance_bps, price_snapshot_json, discount_snapshot_json) | additive snapshot columns; JSON columns and other commercial fields remain nullable for legacy rows but are mandatory in the canonical new writer; `effective_version` alone is NOT NULL, initializes/backfills to compatibility baseline `1`, then advances only through locked canonical change application + CAS |
| 5 | 2 (delivery_notices, delivery_notice_lines) | sales_deliveries (+ `delivery_notice_id`, `source_mode`; reuse existing `billing_mode`), sales_delivery_items (+ `delivery_notice_line_id`) | source_mode truthfully distinguishes direct/notice/legacy; no fake DN; common SO line lock/tolerance/gates, plus DN lock only for notice-backed path; billing_mode reused, no duplicate ADD |
| 6 | 4 (sales_order_replacements, sales_order_replacement_lines, sales_replacement_fulfillments, sales_return_valuation_provenance) | return_orders (+ commercial_source_marker), return_order_items (+ nullable sales_order_item_id FK); existing Inventory/Planning tables gain only §30.31 supporting indexes | existing Wave-6 migration file only; Replacement and F5/F6 contracts unchanged; bounded provenance is immutable allocation evidence, not a general layer ledger or commercial source. SQLite/MySQL real FK/CHECK/index metadata; fresh/upgrade/replay and row preservation; no legacy provenance backfill or cost inference; unexpected shape fails closed. Option C still reuses `return_reversals`, `return_reversal_items`, `credit_reversal_components`, valuation/voucher/Credit evidence and `idempotency_records(operation_type='SALES_RETURN_REVERSAL_OPTION_C')`; no second reversal table or migration file. |
| 7 | 3 (sales_prepayment_requirements, sales_prepayment_gate_results, sales_reservation_intent) | 0 | new migration file; PK on (sales_order_id, line_no); snapshot_key idempotency; Finance R-SAL-15 extension plus Planning EXPECTED-supply bounded contract extension before enabling that mode |
| 8 | 4 (service_fulfillments, consignment_commercial_documents, consignment_commercial_lines, consignment_commodity_locations) | 0 | new migration file; consignment FK; consignment_commodity_locations is the commercial location identity (≠ physical warehouse_id) |
| 9 | 5 (credit_lock_anchors, credit_policy_snapshots, credit_parameters, credit_check_rules, credit_profile) + credit_profile_ratings (A-52, 1 more) | 0 | new migration file; UNIQUE (anchor_key) NOT NULL on credit_lock_anchors; PK on credit_parameters (code, effective_from); PK on credit_profile (customer_id, salesperson_id, credit_object_type, credit_object_id, effective_from); legacy bootstrap migration for credit_profile + credit_lock_anchors over existing credit_profile tuples |
| 10 | 2 (credit_check_results, credit_special_approval) | 0 | new migration file; PR UNIQUE (source_credit_check_result_id) on credit_special_approval; FK to credit_policy_snapshots + credit_control_anchor |
| 11 | 6 (credit_evaluation_indicator, credit_evaluation_scheme, credit_evaluation_model, credit_evaluation_scoring_sheet, credit_evaluation_result, credit_recalculation_history) | 0 | new migration file; bounded multi-scorer per scoring_sheet |
| 12 | 0 | 0 | no schema changes; UI work only |
| 13 | 0 | 0 | no schema changes; tests only |

Sum check: 8+5+3+2+2+3+3+4+6+2+6 = 44 ✓ (matches corrected Design)

Wave 6 draft-migration delta recorded for the next Implementation gate (this Design task does not edit the migration): the current uncommitted draft still persists `sales_order_replacements.state` with `OPEN/IN_PROGRESS/FULFILLED/CANCELLED` in both SQLite and MySQL and indexes that column. Implementation must replace that provisional shape—not add a second lifecycle column—with `cancellation_state NOT NULL DEFAULT 'ACTIVE' CHECK ('ACTIVE','CANCELLED')`, update the index/metadata assertions, and keep fulfillment state and all header/line quantities out of physical columns. Because the draft is not an applied historical migration, synchronization occurs in that new Wave 6 file before execution; no historical migration is rewritten. If any database already contains the provisional shape, migration must fail closed rather than guess a conversion, and that database requires separately controlled remediation.

The same migration gate must prove SQLite and MySQL fresh bootstrap, exact pre-Wave-6 additive upgrade, repeated replay, row preservation, legacy NULL compatibility, named/real FK and CHECK metadata, and absence of `delivery_link_id`, physical fulfillment-state columns or cross-table generated sums. Rollback remains compatibility-first: leave nullable source evidence and created tables in place but disable new writers; destructive DROP/rename after data exists requires separate approval and dependency proof.

Wave 1 proof: NEW tables = 8; existing-table extension tables = 0; existing-table extension fields = 0; dangling FK targets = 0; undefined physical FK identities = 0; Wave-2 early business tables = 0; Master/Platform schema changes = 0.

### 30.9 Finance V22 R-SAL-15 bounded extension wave

The Finance V22 R-SAL-15 bounded extension is scheduled in **Wave 7 (Finance V22 R-SAL-15 bounded extension + Prepayment Gate + Reservation Intent)**.

Required contract introduced in Wave 7:

```text
financeAdapter.resolveEligiblePrepaymentForSalesGate(
  customer_id, business_date, gate_stage, sales_order_id,
  remaining_required_cents, lockMode = FOR UPDATE,
  db_transaction_context
) → acquires FOR UPDATE on canonical V22 settlement_unapplied_balances
  (balance_type = 'PREPAYMENT') in deterministic order, re-reads child
  effects (balance_applications, financial_refunds, applicable reversal
  effects), returns remaining eligible amount and source_balance_locked
  identities; locks held until caller transaction commits / rolls back.

Finance V22 mutations:
  applyUnappliedBalance
  → acquires settlement_unapplied_balances.id FOR UPDATE
    before remaining-capacity validation
  createRefund
  → acquires parent settlement_unapplied_balances.id FOR UPDATE
    before remaining-capacity validation
  reverseSettlementDocument (PREPAYMENT / UNAPPLIED reduction)
  → acquires parent settlement_unapplied_balances.id FOR UPDATE
    before remaining / validation / settlement_reversal_items mutation
```

Finance business semantics UNCHANGED. Canonical balance UNCHANGED. NO conditional wording. NO new Finance balance.

Wave 7 reports separately (per task §25) the Finance files changed and why each change is bounded.

Wave 7 must exist before the Sales Prepayment Gate is considered complete. Wave 11 (Credit Evaluation + Query) does NOT depend on Prepayment Gate; it can proceed in parallel after Wave 10.

### 30.10 Credit implementation sequence

Credit implementation sequence is:

```text
Wave 9  : credit_lock_anchors + credit_policy_snapshots + credit_parameters
         + credit_check_rules + credit_profile (+ credit_profile_ratings)
         + ensureCreditLockAnchor provisioning + legacy bootstrap
         (stable anchor; must exist BEFORE any Credit Check / mutation)

Wave 10 : credit_check_results + credit_special_approval
         + evaluateCredit() service
         + PURE_DERIVED exposure derivation
         + recognition-mode aware (DIRECT_BUSINESS / INVOICE_DRIVEN /
           PROVISIONAL_TO_FINANCIAL) bucket transition
         (R-SAL-12 anchored on CREDIT_OBJECT; R-SAL-13; R-SAL-14)

Wave 11 : credit_evaluation_indicator + scheme + model + scoring_sheet
         + result + credit_recalculation_history
         + credit_query_snapshot (DERIVED C-02) + credit_exposure_view
         (DERIVED C-01) query layer
         (R-SAL-23 conditional on PURE_DERIVED)

Wave 13 : MySQL race hardening + final domain acceptance (all materialized Sales MySQL race scenarios + R-SAL-23 structural assertion; no artificial Credit Exposure cache introduced)
```

R-SAL-12 / R-SAL-13 / R-SAL-14 become executable from Wave 10 onward. R-SAL-23 remains a structural assertion under the frozen PURE_DERIVED baseline (no persisted cache introduced; Wave 13 documents the conditional status). R-SAL-24 anchor infrastructure becomes executable from Wave 9 onward.

### 30.11 Mobile / frontend sequence

Frontend work is concentrated in **Wave 12 (Mobile IA + Reporting + Compatibility convergence)** but each prior wave that introduces a user-visible workflow may include a small frontend integration AFTER the backend contract is stable.

| Wave | Backend stability point | Frontend integration scope |
|---|---|---|
| 1 | customer_commercial_extensions | customer detail extension panel; (none) for new route |
| 2 | pure price/discount resolvers + DRAFT/ACTIVE/RETIRED lifecycle | one contextual pricing/discount sub-page reached from existing Sales & Customer navigation; no new launcher tile or top-level route; LIST → DETAIL → EDITOR/WORKFLOW pattern |
| 3 | quotation API | quotations new route (LIST / DETAIL / EDITOR / CONVERT-TO-SO) |
| 4 | SO enrichment + change | SO editor extended; SO change workflow (LIST / DETAIL / EDITOR) |
| 5 | DN API | delivery-notices new route (LIST / DETAIL / EDITOR) |
| 6 | return + replacement | returns route extended with replacement tab |
| 7 | Prepayment Gate | prepayment sub-page inside SO context |
| 8 | service + consignment | service-fulfillment list inside SO; consignment new route |
| 9 | credit_lock_anchors | (admin / setup only) |
| 10 | credit check + special approval | credit-check evaluate surface; credit-special-approvals new route |
| 11 | credit evaluation | credit-evaluation new route |
| 12 | (consolidation) | new sales-customer launcher (≤ 6 primary entries); decision reports extensions; consolidated responsive acceptance reruns |

Widths remain 320 / 390 / 430 / 680. 390px is primary. Wave-2 contextual pricing UI is included in the same matrix. Touch targets ≥ 44 CSS px. Core tasks do not depend on permanent horizontal scroll. This section schedules later implementation only; the bounded design reopen changes no frontend code.

### 30.12 MySQL verification sequence

MySQL verification is **NOT** deferred to the final wave.

For every wave that introduces any of the following:

```text
FOR UPDATE
source capacity
credit anchor
Finance shared lock
idempotency uniqueness
```

a MySQL verification checkpoint is planned **within that wave**.

| Wave | MySQL verification scope |
|---|---|
| 0 | migration runner on real MySQL (smoke) |
| 1 | eight-table FK / UNIQUE / CHECK parity; SYSTEM/document-type parameter resolution; independent xref/sellable interval rejection; salesperson multi-group/exactly-one-default; legacy fail-closed; second initialization idempotency |
| 2 | fresh Wave-2 init, exact Wave-1 upgrade, and repeated init; exactly five tables + two nullable A-39 fields; entry PK + ordered four-column normalized-key UNIQUE materialized inline by current Bootstrap, with no generated digest; duplicate probe and version FK target; LINE/HEADER CHECK parity; greatest discount rule version only; server-canonical pricing evidence; integer micros/bps/cents; named A-39 MySQL FKs + SQLite FK metadata; overlap/cycle rejection; ACTIVE immutability; resolver zero-write; lifecycle replay/audit |
| 3 | UNIQUE on conversion PK; idempotency_key UNIQUE on real MySQL |
| 4 | four-mode/path parity; request/apply idempotency; effective_version monotonic; R-SAL-07/08 shared lock order on MySQL |
| 5 | DN capacity locks; legacy SD path coexistence on MySQL |
| 6 | return source marker; replacement line capacity on MySQL |
| 7 | R-SAL-15 financeAdapter locked-read on real MySQL; PREPAYMENT balance FOR UPDATE |
| 8 | service fulfillment FOR UPDATE; consignment lock |
| 9 | FOR UPDATE on credit_lock_anchors; ensureCreditLockAnchor convergence; legacy bootstrap on real MySQL |
| 10 | R-SAL-12 / R-SAL-13 / R-SAL-14 on real MySQL with full anchor |
| 11 | R-SAL-23 conditional; bounded multi-scorer locks on real MySQL |
| 12 | UI integration smoke on real MySQL |
| 13 | all materialized Sales MySQL race scenarios (R-SAL-01..22 + R-SAL-24) + R-SAL-23 structural assertion; pnpm test:mysql / pnpm test:mysql:concurrency |

Wave 13 reruns all 23 materialized Sales MySQL race scenarios on real MySQL and verifies the R-SAL-23 structural assertion.

### 30.13 Final domain acceptance wave (Wave 13)

Wave 13 final domain acceptance runs:

```text
focused unit + integration per wave
Functional Sales UAT 44 / 44 (UAT-S-01..44 all executable)
Responsive browser matrix 320 / 390 / 430 / 680
FAST
FULL
HEAVY
build
git diff --check
SQLite compatibility per §29.42
real MySQL functional
generic MySQL concurrency
Sales MySQL concurrency
  materialized executable MySQL race scenarios = 23  (R-SAL-01..22, R-SAL-24)
  structural assertion
    R-SAL-23  (PURE_DERIVED baseline; "no persisted mutable Credit Exposure
               cache exists; no stale rebuild can overwrite newer
               exposure state; cache-rebuild race structurally
               non-materialized under the current baseline")
  = 23 + 1 = 24 / 24 requirement coverage
MySQL performance (if scale requires)
```

Acceptance criteria match §34.11 (8 criteria A–H) with final counts 114/114 / 20/20 / 44/44 / 24/24 (23 materialized + 1 structural) / 36-36 / 0 TBD.

R-SAL-23 acceptance form is a structural assertion under the PURE_DERIVED baseline. No artificial cache is created just to make R-SAL-23 materialized.

### 30.14 Risk matrix

| Wave | Risk | Classification | Reason |
|---|---|---|---|
| 0 | migration runner | LOW | infrastructure only |
| 1 | eight-table Sales commercial/parameter identity foundation | HIGH | cross-dialect interval locking, bounded parameter resolution, independent sellable scope, exactly-one default and optional user link require SQLite/MySQL proof |
| 2 | pricing resolver; price snapshot immutability | MEDIUM | multi-currency, UoM, qty-break; resolved snapshot must be immutable (R-SAL-11) |
| 3 | quotation convert × 2; capacity; idempotency | HIGH | R-SAL-06 is the first user-visible source-capacity race |
| 4 | SO Change effective_version; commercial_close_state; historical immutability | HIGH | S05 (R-SAL-07 / R-SAL-08) |
| 5 | Direct/notice-backed delivery source integrity; legacy coexistence | HIGH | SO/DN capacity locks, common gates, R-SAL-16..19; S09; no fake DN |
| 6 | 3-mode return; strict positive valuation/accounting; replacement; SO-backed without fake delivery; DR-SAL-05 Option C Restricted Economic Reversal | **CRITICAL** | atomic Inventory/valuation/voucher/optional-AR boundary; current standard-cost approval evidence unavailable; R-SAL-09 / R-SAL-10 (Option C clauses appended); S01/S02/S03/S05/S10/S11. Option C adds five Gate components plus §30.31 corrected LOT/SERIAL provenance/dependency proof; full independent-session MySQL race evidence is mandatory before Wave 6 Acceptance, not deferred to a later wave |
| 7 | Finance V22 + Planning expected-supply bounded extensions | **CRITICAL** | S12/S13; R-SAL-02/R-SAL-15; finite expected capacity and canonical adjust/consume required |
| 8 | Service Fulfillment; Consignment ownership (Enterprise not Customer) | **HIGH** | S08 / S18; three-layer separation (commercial / inventory / settlement); R-SAL-20 / R-SAL-21; cross-domain lock on canonical V22 settlement; no second Finance balance |
| 9 | credit_lock_anchors + ensureCreditLockAnchor provisioning | **CRITICAL** | anchor infrastructure precedes any Credit runtime; legacy backfill on real MySQL |
| 10 | R-SAL-12 / R-SAL-13 / R-SAL-14; recognition-mode aware; OLD/NEW snapshot | **CRITICAL** | S14 / S15 / S16; R-SAL-24; first executable Credit Check |
| 11 | credit evaluation; bounded multi-scorer; recalculation | MEDIUM | R-SAL-23 conditional on PURE_DERIVED |
| 12 | Mobile IA; routes; launcher | MEDIUM | responsive matrix rerun; no schema |
| 13 | all materialized Sales MySQL race scenarios + R-SAL-23 structural assertion; final acceptance | **CRITICAL** | 23 materialized + 1 structural = 24 / 24 requirement coverage under PURE_DERIVED baseline; final domain acceptance |

### 30.15 Stop conditions

Each wave has explicit stop conditions. The Implementation agent MUST NOT silently "work around" any of these.

| Wave | Stop conditions (must be surfaced and reported) |
|---|---|
| all | capacity invariant cannot be preserved |
| all | frozen domain requires semantic change → REQUIREMENT_REOPEN_REQUIRED or DESIGN_REOPEN_REQUIRED |
| all | legacy data cannot migrate safely (no historical rewrite) |
| all | SQLite / MySQL semantics diverge (cannot produce same lock contract) |
| all | Credit exposure double-count discovered (R-SAL-12 invariant breach) |
| all | Finance adapter cannot inherit caller transaction (R-SAL-15 architectural breach) |
| all | APPLY_GUIDE.md appears in git diff --cached (user-owned state must not be staged) |
| 1 | Wave 1 needs a ninth table, any existing-table field, a Platform/Master schema change, an unbounded parameter code, or a Wave-2 FK target |
| 4 | SO Change cannot satisfy R-SAL-07 / R-SAL-08 (e.g. effective_version breaks) |
| 5 | New SD lacks explicit DIRECT_ORDER / DELIVERY_NOTICE source mode, fabricates a DN, or bypasses shared SO capacity/gates (§29.12.0) |
| 7 | Finance V22 cannot provide parent balance lock (extension cannot be implemented) |
| 9 | ensureCreditLockAnchor cannot be made create-or-converge safe (no fail-open) |
| 10 | Recognition-mode transition produces mixed-version decision (R-SAL-24 breach) |

### 30.15.1 Per-wave backend authorization (incremental RBAC / SOD)

SC108..SC114 (Permissions / RBAC / SOD) is primarily **allocated to Wave 12** for final permission matrix completion, launcher exposure, and UAT-S-44 final proof. However, **every earlier wave introducing a protected backend endpoint or mutation must implement its applicable** `backend permission check` **+** `SOD restriction` **+** `negative authorization test` **in the same wave**. Frontend-hidden-only is forbidden.

| Wave | Endpoint / mutation introduced | Required backend authorization (same wave) |
|---|---|---|
| 1 | Sales parameter / sales group / salesperson membership / customer commercial extension / xref / classification mutation | permission check + SOD on canonical parameter and salesperson/group assignment; backend data scope cannot be delegated to frontend |
| 2 | pricing resolver, price_override, discount resolver | permission check + separate override authority (PRICE OVERRIDE) per §34.7 P3 |
| 3 | quotation convert → SO | permission check |
| 4 | SO submit / approve / reject / close / cancel; direct/document SO Change request + canonical apply | separate direct-request/document-manage/approve permissions + requester ≠ approver + BOTH no-bypass per §34.7 P2 |
| 5 | DN confirm; SD confirm | permission check + reservation intent / prepayment / credit gate consumption |
| 6 | return confirm; replacement fulfill | permission check + return-mode / replacement-state guard |
| 7 | prepayment gate evaluate; reservation intent request/release | permission check + Prepayment override authority |
| 8 | service fulfillment confirm; consignment settle/return | permission check + Consignment owner-attribute guard (SELLER, NOT CUSTOMER) |
| 9 | credit anchor admin; profile rating apply; policy mutation | permission check + Credit Management must be enabled OR fail-closed per §29.22.1 |
| 10 | credit check evaluate; special approval request/decide | permission check + bounded authority ceiling for special approval per §34.7 P4 + fail-closed BLOCK if mandatory rule + missing profile |
| 11 | evaluation scoring finalize; recalculation run | permission check + bounded multi-scorer aggregation |
| 12 | final permission matrix; launcher exposure; cross-workflow SOD consolidation; UAT-S-44 final proof | consolidates the per-wave negative authorization tests; no retroactive security; no wave accepted frontend-hidden-only |
| 13 | verification only | re-runs the per-wave negative authorization test suite; full RBAC regression |

No wave may be accepted with `frontend-hidden only` authorization. If a wave cannot represent its required authorization while SC108..SC114 primary wave is Wave 12, the per-wave negative authorization for that endpoint must still be added in the wave that introduces the endpoint; Wave 12 only consolidates the final matrix.

For each wave the following fields are planned (not yet implemented):

```text
Wave ID

Business objective

SC IDs

Invariant IDs

UAT IDs

Race IDs

Dependencies (from §30.3 DAG)

Physical tables added (from §30.8)

Existing tables extended (from §30.8)

Backend files expected to change

Frontend files expected to change

Tests expected to be added/updated

Migration scope (from §30.8)

Compatibility responsibilities (legacy SD without DN; products.price_cents legacy fallback; legacy customer; legacy return source marker)

Frozen-domain integrations (Finance V22 R-SAL-15 from Wave 7; Accounting & Analytics reads; Platform A-21 idempotency)

Explicit OUT OF WAVE items (do not creep scope)

Acceptance gates (focused + integration + R-SAL evidence + MySQL checkpoint if applicable)

Commit boundary (one primary local commit after external review; no push)
```

### 30.16 Per-wave contract (canonical pattern)

For each wave the following fields are planned (not yet implemented):

```text
Wave ID

Business objective

SC IDs

Invariant IDs

UAT IDs

Race IDs

Dependencies (from §30.3 DAG)

Physical tables added (from §30.8)

Existing tables extended (from §30.8)

Backend files expected to change

Frontend files expected to change

Tests expected to be added/updated

Migration scope (from §30.8)

Compatibility responsibilities (legacy SD without DN; products.price_cents legacy fallback; legacy customer; legacy return source marker)

Frozen-domain integrations (Finance V22 R-SAL-15 from Wave 7; Accounting & Analytics reads; Platform A-21 idempotency)

Explicit OUT OF WAVE items (do not creep scope)

Acceptance gates (focused + integration + R-SAL evidence + MySQL checkpoint if applicable)

Commit boundary (one primary local commit after external review; no push)
```

### 30.17 Wave contract table (concise)

| Wave | Dependencies | New tables | Existing ext | Backend files | Frontend files | Tests | Migration | Compatibility | Frozen-domain integration | OUT OF WAVE | Acceptance | Commit boundary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | n/a | 0 | 0 | server/migrations/* runner; no new migration | none | migration-runner smoke | infrastructure | n/a | none | migration-runner passes on SQLite + MySQL | n/a | one local commit after review |
| 1 | Wave 0 | 8 (`sales_parameters`, `sales_groups`, `salesperson_profiles`, `salesperson_group_memberships`, `customer_commercial_extensions`, `customer_material_xref`, `sales_sellable_scope_rules`, `product_commercial_classification`) | 0 | bounded Sales foundation modules; no Platform / Master schema changes | customer detail extension panel only | parameter/xref/sellable interval races + membership exactly-one/default + FK/CHECK/legacy tests | Wave 1 registry steps; no forward FK | legacy missing extension/classification read-only; new writes fail closed; salesperson may lack login but cannot access group-scoped docs | Master/Platform read-only targets; Platform mechanics only | focused integration + SQLite/MySQL locking checkpoint; permission gate | one local commit after external review |
| 2 | Wave 1 | exactly 5 (price_lists, price_list_entries, price_list_versions, discount_schemes, discount_scheme_rules) | A-39 exactly two nullable FKs: `default_pricing_list_id` + `default_discount_scheme_id` | pricing/discount lifecycle modules; two POST pure resolver APIs; existing audit/idempotency services | contextual pricing/discount sub-page under existing Sales & Customer navigation; no top-level route | UAT-S-04..07 configuration/lifecycle/override; UAT-S-08 resolver evidence; UAT-S-09 deterministic discount calculation; four-column entry UNIQUE fresh/upgrade/repeat; LINE/HEADER + greatest-rule-version checks; canonical pricing mismatch; FK/CHECK/UoM/cycle/overlap/zero-write/RBAC/replay/audit parity | target-first five-table create; current Bootstrap inline <=4-column UNIQUE; no Adapter/generated digest; preserve rows; add/verify two real nullable FKs; fresh/upgrade/repeat convergence, mismatch fail-closed | no fabricated default; `products.price_cents` historical read/display only and never a new resolver/write fallback | Master UoM read-only; Platform `audit_logs`/A-21 mechanics reused with no schema change | no quotation/SO schema or writer, no actual SO snapshot persistence, no Master/Inventory/Finance/Platform schema, no sixth table | SC15..SC23 and UAT-S-04..09 Wave-2 evidence; S19/S20 preserved; R-SAL-11 only structural/version evidence until Wave-4 SO persistence + immutability test | one local commit after external review |
| 3 | Wave 2 | 3 (sales_quotations, sales_quotation_lines, sales_quotation_conversions) | 0 | quotation handlers with group-scope backend predicate from first route | quotations LIST / DETAIL / EDITOR / CONVERT | unit + R-SAL-06 + fail-closed group access | new migration file; PK + PR UNIQUE | n/a | n/a | UAT-S-01..03; R-SAL-06 evidence; UAT-S-28 partial | one local commit |
| 4 | Waves 1, 2, 3 | 2 (sales_order_changes, sales_order_change_lines) | sales_orders (+ 13 cols, including `effective_version`); sales_order_items (+ 11 cols, including `price_snapshot_json` / `discount_snapshot_json`) | shared canonical writer/change application service; direct/document handlers; group-scope + authoritative line snapshots; locked-read + version CAS | SO direct-change action + change-document workflow | UAT-S-10..16 including four-mode UAT-S-15; R-SAL-07/08/11; UAT-S-28 partial | additive migration; snapshot JSON nullable for legacy but required for new canonical lines; version initializes/backfills to baseline `1` and is not client-writable | later parameters/defaults never rewrite APPLIED history; approved snapshots/evidence remain append-only | n/a | SC37..SC40/UAT-S-15 final owner Wave 4; SC30 final W5 | one local commit |
| 5 | Wave 4 | 2 (delivery_notices, delivery_notice_lines) | sales_deliveries (+ `delivery_notice_id`, `source_mode`; reuse `billing_mode`); sales_delivery_items (+ `delivery_notice_line_id`) | direct/notice source capacity + tolerance enforcement | delivery-notices route | upper BLOCK + lower controlled-close + direct/notice races | explicit source_mode; no fake DN; no duplicate billing_mode | LEGACY_UNCLASSIFIED read-only | n/a | UAT-S-17/S-18; SC08+SC30 final completion; S09 | one local commit |
| 6 | Wave 5 | 4 (Replacement three tables + `sales_return_valuation_provenance`) | return_orders (+ commercial_source_marker); return_order_items (+ nullable sales_order_item_id FK); supporting indexes only on valuation/tracking/reservation evidence | SR canonical writer + method-specific Option-A authority; bounded provenance resolver; corrected LOT/SERIAL Gate-B; canonical voucher/optional Credit; Replacement pure projection; mandatory explicit-key Option C per §29.13.11 + §30.31 | existing returns surface/API only; optional outbound movement identity input and mandatory reverse header; no redesign | six-combination positive/negative matrix; LOT no-consumption/OUT/replenishment; SERIAL success/duplicate/provenance; legacy/unknown marker; 400/replay/409; rollback/audit/period/RBAC; five real independent-session MySQL races | additive SQLite/MySQL fresh/upgrade/replay; exact FKs/CHECKs/indexes; no historical migration edit/backfill; no new reversal table | legacy missing/ambiguous provenance 409; DELIVERY_BACKED, MOVING_AVERAGE validated behavior, Replacement and Batch A unchanged | Inventory/Accounting canonical adapters; Finance Credit only with authority; bounded Sales Return provenance consumes Inventory facts without second ledger | UAT-S-19..22; S01/S02/S03/S05/S10/S11; §30.31 matrix | one local commit only after separate Implementation approval and full gate |
| 7 | Waves 5, 6 | 3 (sales_prepayment_requirements, sales_prepayment_gate_results, sales_reservation_intent) | 0 | finance locked-read; reservation intent adapters; Finance V22 bounded extension | prepayment/reservation sub-pages | R-SAL-02/R-SAL-15; MySQL locked-read; reservation mode matrix | new migration file; idempotency snapshot_key | n/a | Finance extension + Planning EXPECTED finite-capacity bounded extension | UAT-S-23/S-24/S-28/S-40 final; S12/S13 | one local commit + cross-domain change reports |
| 8 | Wave 7 | 4 (service_fulfillments, consignment_commercial_documents, consignment_commercial_lines, consignment_commodity_locations) | 0 | new service-fulfillment module; new consignment module; SD confirm gate (service items require confirmation) | src/pages/consignment.jsx; service sub-page inside SO | unit + R-SAL-20 / R-SAL-21 / R-SAL-22 tests | new migration file | n/a | n/a | UAT-S-25..27 + UAT-S-41; S08 / S18 invariant proof | one local commit |
| 9 | Wave 1 (foundation) | 5 (credit_lock_anchors, credit_policy_snapshots, credit_parameters, credit_check_rules, credit_profile) + credit_profile_ratings (1 more) = 6 | 0 | new credit-anchor module; ensureCreditLockAnchor provisioning; new credit-policy module; new credit-profile module; legacy backfill on real MySQL | credit-anchor admin / setup only; legacy bootstrap on real MySQL | unit + R-SAL-12 anchor lock test + R-SAL-24 anchor lock test; legacy bootstrap on real MySQL | new migration file; UNIQUE (anchor_key) NOT NULL; PK on credit_parameters (code, effective_from); legacy backfill on existing credit_profile tuples | n/a | n/a (no Finance) | UAT-S-29 + S-30; first anchor infrastructure in place; no fail-open | one local commit |
| 10 | Wave 9 | 2 (credit_check_results, credit_special_approval) | 0 | evaluateCredit() service; credit-special-approval workflow | credit-check evaluate surface; credit-special-approvals new route | unit + R-SAL-12 / R-SAL-13 / R-SAL-14 tests; recognition-mode tests; MySQL FOR UPDATE on real MySQL | new migration file; PR UNIQUE (source_credit_check_result_id) | n/a | n/a (Credit Special Approval uses existing Platform approval) | UAT-S-31..33; S14 / S15 / S16 invariant proof; first executable Credit runtime | one local commit |
| 11 | Waves 7, 10 | 6 (credit_evaluation_indicator, credit_evaluation_scheme, credit_evaluation_model, credit_evaluation_scoring_sheet, credit_evaluation_result, credit_recalculation_history) | 0 | new credit-evaluation module; credit_query_snapshot (DERIVED C-02); credit_exposure_view (DERIVED C-01) | credit-evaluation new route | unit + R-SAL-23 conditional test (PURE_DERIVED default); bounded multi-scorer aggregation | new migration file; bounded multi-scorer per scoring_sheet | n/a | n/a | UAT-S-34..36; S17 invariant proof; PURE_DERIVED default | one local commit |
| 12 | Waves 6, 7, 8, 11 | 0 | 0 | (no backend changes except small integration) | new routes (quotations / delivery-notices / sales-order-changes / sales-order-replacements / service-fulfillments / consignment-commercial / credit-*); sales-customer launcher ≤ 6 primary entries; decision reports extensions; src/styles/* | responsive matrix reruns (320/390/430/680); 390px primary | none | n/a | n/a | UAT-S-37 + S-38 + S-44; full responsive acceptance | one local commit |
| 13 | Wave 12 | 0 | 0 | (verification only) | (verification only) | all 23 materialized Sales MySQL race scenarios + R-SAL-23 structural assertion; pnpm test:mysql / pnpm test:mysql:concurrency; full FAST / FULL / HEAVY | none | n/a | n/a | full domain acceptance: 36/36 Audit CAP; 24/24 race (23 materialized + 1 structural); 44/44 UAT; 114/114 SC coverage; 0 TBD | one local commit |

### 30.18 Wave dependency DAG (text form)

```text
Wave 0 (Schema / shared Sales infrastructure)
  └─ Wave 1 (Customer commercial extensions + service classification foundation)
       ├─ Wave 2 (Pricing + Order-Time Discount)
       │    └─ Wave 3 (Quotation + Quotation conversion)
       │         └─ Wave 4 (Sales Order enrichment + lifecycle + Change)
       │              ├─ Wave 5 (Delivery Notice + Sales Delivery convergence)
       │              │    └─ Wave 6 (Returns + Replacement)
       │              │         └─ Wave 8 (Service Fulfillment + Consignment)
       │              ├─ Wave 7 (Finance V22 R-SAL-15 bounded extension + Prepayment Gate + Reservation Intent)
       │              │    └─┐
       │              └─ Wave 9 (Credit stable anchor + Policy + Profile foundation)
       │                   └─ Wave 10 (Credit Check + Special Approval + Exposure)
       │                        └─ Wave 11 (Credit Evaluation + Query)
       ├─ Wave 6 ─┐
       ├─ Wave 7 ─┤
       ├─ Wave 8 ─┼→ Wave 12 (Mobile IA + Reporting + Compatibility convergence) → Wave 13 (MySQL race hardening + Final domain acceptance)
       └─ Wave 11 ┘
```

No cycles. Every edge is explicit. Wave 12 depends on Waves 6 / 7 / 8 / 11, and Wave 13 depends on Wave 12.

### 30.19 SC trace 114/114 (validation)

```text
SC expected = 114
SC assigned = 114
duplicates  = 0
missing     = 0
```

Per-SC primary wave assignment is recorded in §30.4.

### 30.20 Invariant trace 20/20 (validation)

```text
S expected = 20
S assigned = 20
missing   = 0
```

Per-invariant first enforcing wave + final verifying wave is recorded in §30.5.

### 30.21 UAT trace 44/44 (validation)

```text
UAT expected = 44
assigned    = 44
missing     = 0
```

Per-UAT wave assignment is recorded in §30.6.

### 30.22 Race trace 24/24 (validation)

```text
Race Requirement coverage        = 24 / 24
Materialized executable scenarios = 23
Conditional structural races      = 1 (R-SAL-23)
final acceptance                   = 24 / 24
TBD                                = 0
```

Per-Race wave assignment is recorded in §30.7.

### 30.23 Frozen-domain boundary

Sales does not mutate Planning or Inventory truth directly. The reopen identifies one bounded Planning integration gap instead of silently changing the frozen domain.

| Frozen Domain | Classification |
|---|---|
| Master & Engineering (V17) | NO CHANGE |
| Planning (V19) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** in Wave 7: finite EXPECTED-supply authority plus adjust/consume/release adapter; canonical reservation quantity and writer remain Planning |
| Manufacturing & Quality (V18) | NO CHANGE |
| Inventory & Warehouse (V21) | NO CHANGE |
| Finance Operations (V22) | BOUNDED INTEGRATION CONTRACT EXTENSION (scheduled in Wave 7) |
| Accounting & Analytics | NO CHANGE |
| Platform / shared / Idempotency (A-21) | NO CHANGE |

### 30.24 Documentation updates planned

For each future Implementation wave:

```text
solution.md
→ implementation-specific function / module relationships (NOT changing frozen Design)
   (append to §30 with wave updates; not altering §29)

README.md
→ only if structure / runtime / repo usage changes (NO change unless Wave 0 / 12 introduces one)

log/YYYY-MM-DD.md
→ append-only development record per wave
```

If Implementation discovers genuine Requirement contradiction → STOP + REQUIREMENT_REOPEN_REQUIRED. If genuine frozen Design contradiction → STOP + DESIGN_REOPEN_REQUIRED. Do not silently drift.

### 30.25 Commit strategy (per wave)

Each wave receives ONE primary local checkpoint commit after external review.

```text
feat(sales): <wave business objective>
test(sales): <wave focused tests>
fix(sales): <fixes if needed>
```

No single giant commit. No push until external authorization.

---

## 30.26 Final Wave-Plan Summary

This limited reopen closed all identified documentation defects, including approved DR-SAL-01 Option A. External review returned PASS and the user approved formal Freeze. Requirement, Technical Design and Implementation Wave Plan are now `PASS / FROZEN` at content baseline `5469891b78acb5b03940944698e5c51a38cf5491`; Waves 1–13 remain not implemented and not accepted.

```text
14 implementation waves (Wave 0..13)
SC: 114/114, duplicates 0, missing 0
Invariant: 20/20
UAT: 44/44
Race: 24/24, TBD 0
Materialized executable MySQL races: 23
Conditional structural races: 1 (R-SAL-23)
Physical tables: 69 = 25 EXISTING_CONVERGE + 44 NEW + 0 deprecated tables
Physical NEW tables: 44
Corrected existing-table extension inventory: 7 tables / 32 logical fields
Actual extension migration work: 31 NEW fields
Existing extension fields reused: 1 (sales_deliveries.billing_mode)
Wave 1 physical allocation: 8 NEW tables / 0 existing-table extensions / 0 existing-table fields
Wave 2 dependency correction: creates sales_price_lists / sales_discount_schemes before adding A-39 default FKs
Sales fields on Platform users / Master customers / Master products: 0
Wave 13 dependency: Wave 12 → Wave 13
Finance V22 R-SAL-15 extension scheduled in Wave 7 (CRITICAL; before Sales Prepayment Gate completion).
credit_lock_anchors introduced in Wave 9 (BEFORE any Credit runtime).
PURE_DERIVED exposure preserved (no mutable exposure balance).
Master & Engineering boundary: NO CHANGE.
Platform boundary: NO schema change; generic mechanics remain Platform-owned, A-65 parameter storage/namespace/validation/semantics are Sales-owned.
Open product decisions: 0 (DR-SAL-01 Option A approved and documented).
```

```text
SALES & CUSTOMER DOMAIN

REQUIREMENT: PASS / FROZEN
TECHNICAL DESIGN: PASS / FROZEN
IMPLEMENTATION WAVE PLAN: PASS / FROZEN

FREEZE CONTENT BASELINE:
5469891b78acb5b03940944698e5c51a38cf5491

EXTERNAL REVIEW: PASS
USER FREEZE APPROVAL: CONFIRMED

WAVE 0:
PASS / FROZEN
73abaa146c644df72d2c040af4c26548bf92e880

WAVES 1–13:
NOT IMPLEMENTED / NOT ACCEPTED

NEXT:
APPLY_GUIDE.md isolated forward correction,
then Sales Wave 1 implementation.
```

The future freeze-record commit SHA is record metadata and must not be confused with the frozen content baseline above. This task does not begin the `APPLY_GUIDE.md` correction or Wave 1 implementation and does not stage, commit or push.

### 30.27 Wave 6 bounded Design correction record — 2026-10-16

This Design-only correction closes one confirmed physical-inventory omission without changing `document.md §34`:

```text
Requirement term preserved       = SO_BACKED
superseded unimplemented term    = ORDER_BACKED (Design-only historical wording)
new line identity carrier        = return_order_items.sales_order_item_id
FK target                        = sales_order_items.id
nullable / legacy backfill       = YES / NONE
Wave 6 new tables                = 4 after §30.31 bounded provenance correction
Wave 6 extended existing tables  = 2
SC / UAT / Race counts           = unchanged
Implementation started           = NO
```

The correction is limited to the source-line carrier, naming consistency, schema arithmetic, migration/FK/compatibility design, and the already-approved source/capacity guardrails. It creates no new commercial mode, does not reinterpret historical Returns, and does not authorize Wave 6 Implementation. Implementation remains paused until explicit user approval of this corrected Design.

### 30.28 Wave 6 second bounded clarification — Replacement cardinality and superseded valuation blocker

Repository evidence establishes two different outcomes.

Replacement is a Design-only correction within SC59–SC61:

```text
authoritative Delivery relation = sales_replacement_fulfillments only
header delivery_link_id         = removed from not-yet-landed target model
persisted header lifecycle      = cancellation_state only (ACTIVE/CANCELLED)
fulfillment lifecycle           = derived OPEN/PARTIAL/FULFILLED/CANCELLED
deliveries per Replacement      = many
fulfillments per line           = many partial rows
line/header aggregates          = PURE_DERIVED SQL projection
cross-table generated columns   = forbidden / not used
new physical tables             = 3 (unchanged)
new existing-table extensions   = 2 (unchanged from §30.27)
SC / UAT / Race IDs             = unchanged
```

The link is immutable confirmed-execution evidence and carries no second lifecycle truth. Header cancellation closes only unfulfilled remaining obligation. The current frozen Sales Delivery lifecycle has no reversal of an already confirmed Delivery; therefore Wave 6 cannot manufacture a Sales-only reversal or delete a link. Any future canonical Delivery reversal must contribute its own authoritative reversal fact before it can reduce the pure-derived aggregate.

The valuation blocker recorded by this clarification was valid at the time: `receivePositiveSourceValue()` selected a basis but SC54–SC58 did not then select the accounting counterpart. It is superseded only by the accepted DR-SAL-04 delta recorded in §30.29 below. The repository evidence discovered here remains material: the primitive's raw standard-cost and `LEGACY_UNVALUED` branches are not legal for the new Return modes, and valuation success never establishes AR authority.

### 30.29 Wave 6 Option A Design correction record — 2026-10-16

User Requirement Acceptance froze DR-SAL-04 for this bounded scope. The corrected Design is:

```text
applicable modes                 = SO_BACKED / NO_SOURCE
warehouse acceptance            = Inventory canonical validation + mutation
valuation priority              = MOVING_AVERAGE exact eligible positive pool;
                                  LOT exact same-identity carrying pool;
                                  SERIAL unique eligible original outbound provenance;
                                  NO_SOURCE may use §30.31 bounded outbound provenance;
                                  otherwise HTTP 409
current standard-cost evidence  = INSUFFICIENT; fallback disabled
forbidden                       = LEGACY_UNVALUED / zero / manual / SO price /
                                  Quotation price / fake Delivery cost /
                                  cross-identity pool / fabricated evidence
voucher debit                   = inventoryAccountRole(product_id)
voucher credit                  = existing INVENTORY_GAIN_LOSS
voucher amount                  = Finance canonical positive-inbound value
business source identity        = SALES_RETURN
AR credit                       = independent authoritative Finance basis only
transaction                     = source + acceptance + tracking + valuation +
                                  voucher + optional credit + state + audit + idem
DELIVERY_BACKED                 = unchanged restoreSourceValue / COGS path
```

No new table, field, account role, commercial mode, Requirement ID or cross-domain owner is introduced. In particular, the Design does not treat `products.standard_manufacturing_cost_cents` or `product_costs.status='ACTIVE'` as approval/freeze evidence; the standard-cost branch remains unavailable until an already-authoritative contract can prove approval, freeze and business-date effectiveness. This is a fail-closed implementation constraint, not a new business decision.

The protected uncommitted migration was inspected but not modified by this Design task. Its Return marker and SO-line FK match the approved source model. Its Replacement header still uses the rejected provisional four-value `state`; Implementation must synchronize it to the sole two-value `cancellation_state`, update SQLite/MySQL CHECK/index metadata and tests, and retain `sales_replacement_fulfillments` as the only Delivery relation. See §30.8 and §30.17.

#### 30.29.1 Required implementation evidence

Wave 6 cannot pass its internal gate without all of the following evidence:

1. SQLite and MySQL migration tests: fresh, exact legacy upgrade, replay, row preservation, legacy NULLs, real FK/CHECK/UNIQUE metadata, conflict fail-closed, and proof that only `cancellation_state` is persisted.
2. Return positive cases: exact MOVING_AVERAGE pool, exact LOT carrying pool and exact SERIAL original-outbound provenance; multi-line/multi-product/mixed-method voucher aggregation; authoritative role mapping; balanced cents; true `SALES_RETURN` source identity; no AR basis yields no credit.
3. Standard-cost cases: raw `products.standard_manufacturing_cost_cents` and `product_costs.ACTIVE` are rejected as insufficient evidence; a legal approved/frozen effective-cost case may pass only if an existing authoritative contract is identified without schema or Requirement invention. Until then the positive fallback case is explicitly unavailable and tested as HTTP 409.
4. Negative/rollback cases: no pool, zero pool, `LEGACY_UNVALUED`, client/manual cost, SO/Quotation price, cross-warehouse/product/LOT/SERIAL pool, missing/mismatched tracking, closed period, missing role, unbalanced voucher, writer failure, invalid mode/source and unauthorized/SOD all leave the §29.13.10 zero-side-effect state.
5. Idempotency/concurrency: same-key replay, changed-payload conflict, different-key duplicate confirm, two Returns against one SD/SO capacity, and two Return confirmations contending for the same valuation pool must use real independent MySQL sessions and verify exact-once quantity, valuation, voucher, credit, audit and idempotency effects.
6. Replacement: zero/partial/multiple-Delivery/full/cancelled derived states, more than one fulfillment row per line, one Delivery item used at most once, competing same-line fulfillment, cancellation preserving prior evidence, and unsupported Delivery reversal fail-closed. Every API/read path must agree with the same PURE_DERIVED projection.
7. Regression: DELIVERY_BACKED restores original value and retains its existing COGS/credit behavior; Batch A source history remains immutable; no fake Delivery, Revenue, AR/Open Item, COGS reversal or Inventory Adjustment is produced for Option A.

Implementation remains paused after this record. Approval of DR-SAL-04 Requirement does not itself approve this corrected Design or authorize Wave 6 code changes.

### 30.30 Wave 6 Option C Restricted Economic Reversal — Design Correction Record — 2026-10-17

User Requirement Acceptance froze DR-SAL-05 for this bounded scope. The corrected Design is the §29.13.11 sub-section added above. Summary:

```text
modes                            = SO_BACKED / NO_SOURCE only
reversal coverage                = Full Return Reversal only (no partial)
mode-aware dispatch              = §29.13.11.1 (existing reverseOperationalReturn unchanged for DELIVERY_BACKED)
Gate-A Replacement Dependency   = canonical sales_replacement_fulfillments;
                                  A.3 confirmed-fulfillment rows -> 409; A.2 ACTIVE not-fully-fulfilled -> 409;
                                  A.1 / A.4 -> continue Gate-B
Gate-B Downstream Consumption   = strict MOVING_AVERAGE / corrected LOT / SERIAL proof;
                                  pool balance alone is never downstream proof;
                                  strict negative movement after frontier -> 409;
                                  LOT sufficiency + no-negative/dependency fence;
                                  SERIAL provenance/lifecycle/dependency deviation -> 409
Gate-C Original Valuation       = reuse consumeOriginalInboundValue per line;
                                  basis / lot / serial preserved verbatim
Gate-D Exact Original Voucher   = reuse createSystemVoucher(reversalOfId);
                                  direction-swap with exact original cents
Gate-E Optional Finance Credit  = reuse reverseCreditAdjustment;
                                  dependent application/refund consumption -> 409
canonical primitives reused     = consumeOriginalInboundValue, createSystemVoucher(reversalOfId),
                                  reverseCreditAdjustment, applyInventoryMutation, postTrackedMovement,
                                  inventory_valuation_movements (reversal_of_id chain),
                                  idempotency_records
schema delta                     = §30.31 one bounded provenance table + supporting indexes;
                                  zero new reversal tables and zero commercial-source fields
evidence tables reused           = return_reversals, return_reversal_items, credit_reversal_components
idempotency namespace            = SALES_RETURN_REVERSAL_OPTION_C
concurrent races covered         = R-SAL-09 (negative) / R-SAL-10 (Option C clauses appended) /
                                  Option C concurrent reverse × N / Option C vs Replacement /
                                  Option C vs Inventory OUT / Option C vs Credit application-refund
DELIVERY_BACKED contract         = unchanged; reverseOperationalReturn() not modified
Batch A contract                 = unchanged; Option C writes only sales_reversals / return_reversal_items /
                                  credit_reversal_components as separate evidence rows
Purchase Return contract         = unchanged; reverseOperationalReturn(side='PURCHASE') not modified
```

Key Design alignments recorded for traceability:

1. §29.3 canonical writer inventory adds two new rows: `Sales Return Reversal (DELIVERY_BACKED)` (existing handler unchanged) and `Sales Return Reversal (SO_BACKED / NO_SOURCE)` (new bounded adapter per §29.13.11).
2. §29.13.11.1 .. 8 introduces the complete Option C Reverse contract — mode resolver, Gate-A, Gate-B, Gate-C, Gate-D, Gate-E, atomicity/lock-order/idempotency, DELIVERY_BACKED compatibility. No new canonical primitive is invented.
3. §29.14, §29.30 row 7, §29.31.8 API surface, §29.32 lifecycle and §29.41 schema constraints now note the reuse of existing evidence tables and the absence of new schema.
4. §29.30 row 16 explicitly lists the Option C Reversal Evidence edge with all canonical lock identities (return_orders / return_order_items / inventory_valuation_movements / inventory_valuation_balances / accounting_vouchers / financial_credit_adjustments / sales_replacement_fulfillments ↔ return_order_items.id).
5. §29.30.1 direction audit adds the new edge and notes that Option C reversal is itself a new append-only business fact, not a mutation of the source Return.
6. §29.31.8 lists `POST /api/sales-returns/:id/reverse` with mode-aware dispatch body / permission / idempotency contract.
7. §29.32 lifecycle table adds the `Sales Return Reversal Evidence (Option C; append-only; independent of return_orders.status)` row to make explicit that reversal is NOT a state transition of the Return itself.
8. §29.41 schema constraints retains `no new Option-C Sales Return Reverse table`; §30.31 supersedes only the former zero-schema statement with one bounded provenance carrier and supporting indexes.
9. §29.44 R-SAL matrix modifies R-SAL-09 (negative Option C reach check) and R-SAL-10 (Option C clauses + Gate-A controlled serialization). No new Race ID is introduced.
10. §30.8 migration allocation remains historical for the original DR-SAL-05 delta; §30.31 reuses the Wave 6 additive migration file for one bounded provenance table and supporting indexes. Idempotency namespace `SALES_RETURN_REVERSAL_OPTION_C` reuses `idempotency_records`.
11. §30.14 risk matrix Wave 6 row records the Option C Gates' residual risk; §30.31 supersedes the former deferral and requires full independent-session MySQL race evidence before Wave 6 Acceptance.
12. §30.17 Wave contract table Wave 6 row records backend files (new `option_c_branch` adapter inside `sales_return_canonical_writer`, reusing `server/modules/financial-inventory.js` / `server/modules/settlement-core.js` primitives), frontend (returns route reverse endpoint), tests (Gate-A / Gate-B / Gate-C / Gate-D / Gate-E / concurrent / negative scenarios), and acceptance gate (real independent-session MySQL race evidence).

Required Implementation Evidence for DR-SAL-05 (per Wave 6 Implementation gate):

```text
1. SQLite + MySQL parity: same Gate-A/B/C/D/E semantics on both dialects.

2. Wave 6 additive migration MUST synchronize from current draft to the
   approved contract BEFORE apply:
   - current draft `server/migrations/sales-customer-wave6-returns.js:96, 149, 154`
     still declares `state TEXT/VARCHAR NOT NULL DEFAULT 'OPEN' CHECK(state IN
     ('OPEN','IN_PROGRESS','FULFILLED','CANCELLED'))` plus the 4-named CHECK
     `chk_sales_order_replacements_state`.
   - approved contract (§29.14 + §30.8 + §30.29 + §30.30) requires the sole two-value
     header `cancellation_state CHECK ('ACTIVE','CANCELLED')` and a pure read
     projection of OPEN/PARTIAL/FULFILLED/CANCELLED. Implementation must:
       a) recreate or alter `sales_order_replacements` to replace the 4-value
          state column with 2-value `cancellation_state`;
       b) drop any index that targets `state` and create equivalent on
          `cancellation_state` (idx_sales_replacement_return);
       c) refresh SQLite metadata tests (sqlite_master + PRAGMA) and
          MySQL information_schema / KEY_COLUMN_USAGE / CHECK_CONSTRAINTS;
       d) if any database already contains the provisional shape, fail closed
          rather than guess conversion; requires separately controlled
          remediation.

3. Wave 6 additive migration MUST relax two CHECKs for NO_SOURCE Option C
   (§29.13.11.6.b):
   - `return_reversals.amount_cents` from CHECK(amount_cents > 0) to
     CHECK(amount_cents >= 0). DELIVERY_BACKED path writes amount_cents > 0
     (unit_price_cents > 0), so relaxation is no-op for DELIVERY_BACKED.
   - `return_reversal_items.amount_cents` same relaxation. The
     `quantity CHECK(quantity > 0)` constraint is unchanged (Option C full
     reverse quantity is the original Return quantity, always > 0).
   - SQLite needs table recreation (or RENAME + re-CREATE) to alter CHECKs.
   - MySQL uses DROP CHECK + ADD CONSTRAINT.
   - UNIQUE(reversal_no), UNIQUE(reversal_id, original_return_item_id), foreign
     keys, defaults and NOT NULL are unchanged.

4. Positive cases:
   - SO_BACKED full reverse with exact MOVING_AVERAGE pool (no subsequent issuance) -> 200 + paired reversal movement + reversal voucher
   - SO_BACKED full reverse with LOT_SPECIFIC_POOL (current quantity/value sufficient, no negative movement/dependency after frontier; aggregate equality not required) -> 200
   - SO_BACKED full reverse with SPECIFIC_SERIAL (unique frozen outbound provenance; restored unit intact) -> 200
   - NO_SOURCE full reverse with exact MOVING_AVERAGE pool (no subsequent issuance) -> 200 + reversal voucher + return_reversal_items.amount_cents = 0 (canonical zero, accepted by relaxed CHECK)
   - SO_BACKED / NO_SOURCE reverse with no Credit Adjustment -> 200, no Credit Reversal Component written
   - SO_BACKED / NO_SOURCE reverse with real confirmed Credit and zero downstream consumption -> 200 + REVERSED credit
   - DELIVERY_BACKED reverse (regression) -> unchanged behavior, amount_cents > 0 path unaffected
5. Negative cases (HTTP 409, zero side effect, original Return unchanged):
   - Active ACTIVE not-fully-fulfilled Replacement -> 409 (Gate-A.2)
   - Confirmed sales_replacement_fulfillments row exists EVEN if header.cancellation_state = 'CANCELLED' -> 409 (Gate-A.3, locked evidence untouched; A.3 fires before any state-branch logic)
   - Replacement obligation absent (no rows at all) -> proceed to Gate-B
   - Replacement with cancellation_state = 'CANCELLED' AND zero fulfillment rows -> proceed to Gate-B (Gate-A.4 strict)
   - MOVING_AVERAGE with strict_negative_post < 0 -> 409 (Gate-B; canonical quantity_delta < 0 check, not LIKE-based)
   - MOVING_AVERAGE with pool.value_cents / pool.quantity preserved exactly but strict_negative_post = 0 -> pass Gate-B (proceed to canonical primitive)
   - LOT_SPECIFIC_POOL with insufficient balance, any post-frontier negative movement, or dependency conflict -> 409 (Gate-B); OUT then replenishment remains 409
   - SERIAL with any non-(AVAILABLE|HOLD) -> 409 (Gate-B)
   - SERIAL with missing/ambiguous outbound provenance, duplicate active identity, or restored-unit/balance mismatch -> 409 (Gate-B)
   - Already partially reversed (cumulative > 0) -> 409 (Gate-B+M3)
   - Duplicate-reverse guard hit (reversal_of_id already populated) -> 409
   - Credit Adjustment exists but downstream application/refund consumed -> 409 (Gate-E)
   - Marked DELIVERY_BACKED -> routed to existing handler (no Option C branch)
   - Marked UNKNOWN / NULL -> 409 (mode-resolver default)
   - return_orders.status != CONFIRMED -> 409
6. Atomicity: 任一 Gate 失败, 整体回滚; original Return 状态, Inventory, LOT/SERIAL, valuation movement/balance, voucher, AR, Credit Adjustment, success audit, idempotency 零变化.
7. Idempotency: same-key replay returns committed result; same-key different-payload -> 409; no key -> 400 (for Option C).
8. Concurrency (real MySQL, real independent sessions):
   - Two concurrent Option C reverses of same Return id: one wins, second sees prior reversal evidence and hits Gate-B/M3 or idempotency 409
   - Option C reverse vs Sales Delivery confirm of same product/warehouse position: serialized on inventory_valuation_balances FOR UPDATE; exactly-once net effect or 409
   - Option C reverse vs Replacement fulfillment evidence insert: serialized on sales_replacement_fulfillments FOR UPDATE; post-reverse state visible to second writer
   - Option C reverse vs Finance Credit application/refund: serialized on financial_credit_adjustments + parent settlement_unapplied_balances
9. Regression:
   - DELIVERY_BACKED reverse behavior unchanged (Batch A unchanged)
   - Purchase Return reverse behavior unchanged
   - Quotation / SO / SO Change / DN / SD confirm lifecycles unaffected
   - Replacement immutable fulfillment evidence unaffected
   - Option A confirm path unaffected
```

Required code changes scope (Implementation-only; not Phase D design scope):

```text
server/modules/
  sales_return_canonical_writer.js
    -> add option_c_branch() handler (mode resolver + Gates)
       reuse: applyInventoryMutation (server/lib/inventory-mutation.js)
              postTrackedMovement (server/modules/traceability-quality.js)
              consumeOriginalInboundValue (server/modules/financial-inventory.js)
              createSystemVoucher (server/modules/financial-inventory.js)
              reverseCreditAdjustment (server/modules/settlement-core.js)
              reverseOperationalReturn EXISTING unchanged for DELIVERY_BACKED
  sales-returns.js (or app.js)
    -> extend POST /api/sales-returns/:id/reverse route to dispatch by commercial_source_marker
tests/
  server/sales-customer-wave6-option-c-reversal.test.js    NEW focused unit + contract tests
  server/sales-customer-wave6-mysql-option-c-reversal.integration.js  NEW real protected MySQL gate
Frontend
  src/pages/returns.jsx
    -> extend returns route LIST / DETAIL with mode-aware reverse action and 409 reason surfacing
  scripts/testing/test-suites.js
    -> register the new Wave 6 Option C suites under FAST + FULL + HEAVY + protected MySQL
```

Implementation remains paused after this record. Approval of DR-SAL-05 Requirement by the user does not itself approve this corrected Design or authorize Wave 6 code changes; the Design Gate await explicit user approval, after which Wave 6 Implementation may resume.

### 30.31 Wave 6 LOT/SERIAL R1–R4 + Option C Idempotency — bounded superseding Design — 2026-10-17

This section is the active Design for the bounded Requirement correction in `document.md §34.3.10 / §34.5.1 / §34.15`. Where it conflicts with the earlier Option-A/Option-C text in §29.13.7, §29.13.11, §30.29 or §30.30, **this section supersedes only LOT/SERIAL valuation provenance, LOT Gate-B, NO_SOURCE provenance, legacy fail-closed, Option-C idempotency and the directly required schema/test/concurrency statements**. MOVING_AVERAGE's already-valid strict negative-movement rule, DELIVERY_BACKED, Replacement, F5/F6, Batch A and Wave 7+ remain unchanged. The prior LOT aggregate-equality, current positive same-serial-pool authority, `schema delta = 0`, and corresponding positive-test statements are historical and are not active Design.

#### 30.31.1 Requirement-to-Design traceability and decisions

| Requirement | Active Design decision | Acceptance owner |
|---|---|---|
| R1 LOT | Exact Return movement + sufficient current quantity/value + conservative no-negative-movement frontier + explicit dependency proof; aggregate `pool == Return` is forbidden | UAT-S-20/21 LOT cases |
| R2 SERIAL | Unique eligible original outbound valuation/tracking evidence is Confirm authority; exactly one unit/value is restored; Reverse consumes only that restored unit | UAT-S-20/21 SERIAL cases |
| R3 NO_SOURCE | Commercial marker remains `NO_SOURCE`; valuation provenance is an independent Inventory reference and cannot create SO/Delivery commercial evidence | SC56 / SC58 + six-combination matrix |
| R4 Legacy | Only deterministic canonical evidence is eligible; no balance/cost reconstruction, synthetic outbound or migration-time guessing | legacy fail-closed cases |
| Option-C idempotency addendum | Explicit non-empty header, exact scope/fingerprint, replay/409, one atomic result; no random fallback | UAT-S-20/21 Case 21/21a |
| SC57 unknown marker | NULL/unknown marker returns 409 before business mutation; never routes to DELIVERY_BACKED or Option C | legacy marker regression |

No additional Requirement-owner decision is needed by this Design. Implementation remains separately gated.

#### 30.31.2 Existing-link evaluation and bounded provenance carrier

Existing evidence is necessary but not sufficient:

- `tracked_source_allocations` identifies the Return's LOT/SERIAL allocation but has no immutable link to the original outbound valuation movement;
- `tracked_inventory_movements.transaction_id` can pair tracking with an Inventory transaction, and `inventory_valuation_movements.inventory_transaction_id` can pair valuation with it, but neither freezes which outbound was selected for this Return;
- `inventory_serials.created_source_*` describes identity creation, not the later outbound that supplied return value;
- `inventory_valuation_movements.reversal_of_id` means economic reversal and must not be overloaded as Return provenance;
- timestamp/id scans can find candidates, but cannot preserve a unique selection for later Reverse or distinguish an ambiguous legacy history.

Two bounded options were evaluated:

| Option | Shape | Benefit | Limitation / consequence |
|---|---|---|---|
| Nullable immutable reference on one existing row | add `original_outbound_valuation_movement_id` to a Return item or Return valuation movement | smallest column count; simple SERIAL full-unit case | a Return item may contain multiple serial/LOT allocations; partial MA/LOT restoration needs cumulative quantity/value allocation; a single FK cannot represent both without implicit layer logic or lossy JSON |
| Bounded allocation/provenance object | one immutable row per Return valuation allocation, linking the Return movement to original outbound valuation/tracking evidence | represents multiple serials, partial MA/LOT allocations, exact cents and later Reverse without changing commercial source | one new Wave-6 table and indexed cumulative-allocation checks are required |

**Selected:** the bounded object, because it is the smallest carrier that is correct for all six combinations and does not turn a commercial source field into valuation provenance. It is Sales-Return-specific evidence, not a general inventory layer engine.

```text
sales_return_valuation_provenance
  id                                      PK
  return_order_id                         NOT NULL FK return_orders(id)
  return_order_item_id                    NOT NULL FK return_order_items(id)
  return_valuation_movement_id            NOT NULL FK inventory_valuation_movements(id), UNIQUE
  original_outbound_valuation_movement_id NOT NULL FK inventory_valuation_movements(id)
  original_outbound_tracking_movement_id  NULL FK tracked_inventory_movements(id)
  product_id                              NOT NULL FK products(id)
  warehouse_id                            NOT NULL FK warehouses(id)
  lot_id                                  NULL FK inventory_lots(id)
  serial_id                               NULL FK inventory_serials(id)
  quantity                                NOT NULL CHECK(quantity > 0)
  value_cents                             NOT NULL CHECK(value_cents > 0)
  created_at                              NOT NULL

UNIQUE(return_order_item_id, return_valuation_movement_id)
INDEX(original_outbound_valuation_movement_id, id)
INDEX(return_order_id, return_order_item_id, id)
INDEX(product_id, warehouse_id, lot_id, serial_id, id)
```

The row is insert-only: no application UPDATE/DELETE path. Its identity, quantity and cents must equal the referenced positive `SALES_RETURN` movement. For SERIAL, tracking reference is mandatory, `quantity=1`, both outbound movements must identify the same transaction/serial, and locked cumulative active restoration for that outbound must be zero. For NO_SOURCE MA/LOT provenance, tracking is nullable for MA and mandatory for LOT; cumulative provenance quantity/value against the locked outbound cannot exceed its absolute quantity/value. Proportional cents use the existing deterministic allocator; the final eligible allocation receives the exact residual. This bounded allocation is used only when the six-combination matrix permits outbound provenance. It never becomes general issue-layer selection.

Eligible original outbound valuation evidence is deliberately narrow: `status='POSTED'`, `quantity_delta<0`, `value_delta_cents<0`, `source_type='SALES_DELIVERY'`, `movement_type='SALES_DELIVERY_COGS'`, real `inventory_transaction_id`, exact product/warehouse and applicable LOT/SERIAL. SERIAL additionally requires exactly one matching unreversed tracked OUT row with quantity one. Adjustment loss, count shortage, transfer, scrap, production issue, purchase return, `LEGACY_UNVALUED`, standard/current cost and sale price are ineligible. A future outbound type requires a separate Requirement/Design change.

The client may provide only a candidate outbound movement identity, never quantity/value/cost authority. The server resolves and locks canonical evidence. SERIAL may auto-resolve only when exactly one eligible candidate exists; MA/LOT without a unique candidate requires an explicit candidate identity. Zero or multiple candidates return 409.

#### 30.31.3 LOT Confirm and conservative Reverse dependency gate

Confirm locks the exact product/warehouse/LOT position, LOT identity, tracking allocation and valuation balance, then freezes one legal positive-pool plan (or the explicitly allowed NO_SOURCE outbound-provenance plan). It posts physical/tracking IN, a distinct positive Return valuation movement and, when provenance is used, its immutable provenance row. The Return movement identity is therefore `(source_type='SALES_RETURN', source_id=returnId, source_item_id=returnItemId, lot_id, inventory_transaction_id)`.

Reverse calculates unreversed Return quantity/value from the exact movement minus POSTED `reversal_of_id` rows. It requires locked physical position, `inventory_lot_balances` and `inventory_valuation_balances` to each be sufficient, but sufficiency never proves no consumption. The movement frontier rejects every exact-identity negative valuation movement or tracked OUT/MOVE with `created_at > returnMovement.created_at`; a same-timestamp row from another transaction is ambiguous and also rejects. Thus ordering is stable without treating a UUID as time, and OUT-then-replenishment remains rejected.

The dependency set is fail-closed:

- any active exact-position `inventory_locks` row blocks;
- `planning_reservations` has no LOT dimension, so any ACTIVE on-hand reservation for the product/warehouse blocks unless a future canonical fact proves it excludes this LOT;
- any transfer OUT/MOVE, issuance, scrap, adjustment loss or other negative canonical movement after the frontier blocks;
- Return-created HOLD is permitted, but any later `tracked_identity_hold_history` action blocks because ownership of that decision cannot be silently erased;
- missing/mismatched position, tracking, LOT balance, valuation balance, marker, status or unknown movement semantics blocks.

After all reads are revalidated under locks, Reverse posts one exact physical/tracked OUT and exact negative valuation movement per original Return movement, then the exact voucher/Credit/audit effects. No general layer table or aggregate-equality test is introduced.

#### 30.31.4 SERIAL original-value restoration and Reverse

Confirm requires each serial allocation to satisfy all of the following under one transaction:

1. exact serial/product identity, requested quantity exactly one, lifecycle `DELIVERED`, `current_warehouse_id IS NULL`, no active AVAILABLE/HOLD duplicate, and no positive same-serial valuation balance (a stale positive balance is 409, never authority);
2. exactly one eligible original outbound valuation movement and exactly one paired tracked OUT row as defined in §30.31.2;
3. no prior POSTED reversal or active Return restoration consuming that outbound evidence;
4. exact restoration value `-original.value_delta_cents`, never current pool value;
5. one physical/tracked IN, one positive Return valuation movement and one immutable provenance row; post-state is exactly one unit at the Return warehouse (AVAILABLE or the existing Return HOLD policy), with a matching one-unit valuation balance.

Reverse re-locks provenance, outbound evidence, Return movement, serial identity, position/balance and dependencies. It requires the restored unit to be the only active in-stock instance, at the same warehouse/product, quantity one, with no later OUT/MOVE/transfer/hold-history/reservation/lock/reversal evidence. It then removes exactly one unit and exactly the Return movement cents. Current positive same-serial stock, current/standard cost, sale price or a different outbound can never substitute. Ambiguous legacy rows remain readable but non-reversible and return 409.

#### 30.31.5 NO_SOURCE separation and migration/rollback plan

`return_orders.commercial_source_marker='NO_SOURCE'`, NULL SO/Delivery source pairs and the existing zero-or-authoritative commercial amount remain unchanged. `sales_return_valuation_provenance` is Inventory valuation evidence only; API/read models expose it separately and must not synthesize `sales_order_item_id`, `delivery_item_id`, AR, Credit or revenue evidence.

Migration is additive in the existing Wave-6 migration:

- SQLite creates the table, FKs, CHECKs and indexes idempotently; MySQL creates the equivalent InnoDB table with `VARCHAR(128)`, `DECIMAL(24,6)` and `BIGINT` cents plus named constraints;
- add composite read/lock indexes on `inventory_valuation_movements(product_id,warehouse_id,lot_id,serial_id,status,created_at,id)` and `tracked_inventory_movements(product_id,warehouse_id,lot_id,serial_id,direction,created_at,id)`; add the bounded reservation-gate index `(product_id,warehouse_id,status,supply_source_type,id)`;
- fresh, existing-upgrade and replay paths verify exact metadata on both databases; unexpected table/constraint shape fails closed;
- existing rows are not backfilled. Legacy rows without unique deterministic evidence remain 409. No migration scans balances/costs to invent provenance;
- compatibility rollback is application-first: older code ignores the additive table/indexes; populated evidence remains. Dropping it is destructive and requires a future dependency proof and explicit authorization.

F5/F6 remain unchanged. No `STANDARD_COST`, `LEGACY_UNVALUED`, second Return-reversal table or general valuation-layer object is added.

#### 30.31.6 Option C flow, NULL marker and idempotency

After the locked marker selects `SO_BACKED` / `NO_SOURCE` but before any business mutation, the route requires a non-empty `Idempotency-Key` header; missing/blank is HTTP 400 and no random/deterministic fallback is generated. This sequencing preserves DELIVERY_BACKED's unrelated frozen contract while making Option C fail before side effects. Scope is exactly `(operation_type='SALES_RETURN_REVERSAL_OPTION_C', document_id=returnId, idempotency_key=clientKey)`. The canonical fingerprint contains action, normalized business date, normalized reason and every authoritative request field that changes economic effect, excluding transport noise.

Inside one transaction: idempotency conflict/replay check → locked marker/status read → Gate-A → corrected Gate-B → period/RBAC recheck → physical/tracking OUT → exact valuation reversal → exact voucher reversal → optional lawful Credit reversal → append-only reversal/provenance evidence → exactly one success audit → success idempotency record. Same key/equivalent payload replays the stored response with no duplicate effect; same key/conflicting payload returns 409. NULL/unknown marker returns 409 before Gate-A and never falls through to DELIVERY_BACKED. Any rejection or writer error rolls back every listed fact.

#### 30.31.7 Canonical lock order and independent-session concurrency

All participating writers follow §27.18's global order; lists are deduplicated and lexically sorted within each class:

```text
idempotency scope / Return document anchors
-> source/provenance business rows (return lines, replacement evidence)
-> product/reference rows
-> inventory positions (position_key)
-> LOT/SERIAL identities
-> inventory locks + reservation aggregate/range rows + hold history
-> tracked movement exact-identity frontier ranges
-> valuation balances + original/Return valuation movements + provenance rows
-> original voucher
-> optional Credit/settlement rows
-> reversal evidence / audit / idempotency result
```

SQLite uses one encompassing `BEGIN IMMEDIATE` transaction. MySQL uses InnoDB `SELECT ... FOR UPDATE` on existing anchors and indexed exact-identity ranges; absence checks lock the relevant next-key range under the repository transaction isolation so a negative movement/provenance/fulfillment phantom cannot be inserted between proof and commit. Deadlock/lock-timeout uses the existing bounded adapter retry only for the complete transaction; no partial writer-level retry. Exhaustion returns the existing deterministic conflict/service error with rollback.

| Race | Required serialization and legal outcomes |
|---|---|
| Same identity, simultaneous Confirm | same position → LOT/SERIAL identity → balance/outbound evidence locks; both LOT confirms may serialize if each revalidation remains legal; same SERIAL permits exactly one, loser 409 |
| Reverse vs Inventory OUT | same position/identity/frontier/balance locks; Reverse first removes its unit then OUT revalidates remaining stock, or OUT first leaves negative evidence and Reverse 409 |
| Confirm / Reverse / OUT, three sessions | same global order; only a serializable ordering is permitted; no test may share one DB connection |
| Concurrent Reverse of same Return | Return/idempotency anchors serialize; same key replays, different key loser sees committed reversal/provenance and returns 409 |
| Simultaneous SERIAL operations | unique serial identity plus outbound/provenance locks prevent duplicate restoration; exactly one active in-stock unit and one value restoration |

#### 30.31.8 Six-combination design-to-test matrix

| Combination | Positive Confirm / Reverse | Mandatory negative coverage |
|---|---|---|
| SO_BACKED × MOVING_AVERAGE | approved SO commercial evidence; positive MA pool; no later negative movement; exact Return/voucher reverse | capacity/source mismatch, downstream OUT, period/RBAC, rollback |
| SO_BACKED × LOT | exact LOT positive pool; no-consumption Reverse succeeds without aggregate equality | downstream OUT; OUT then replenishment still 409; lock/reservation/transfer/HOLD-history conflict |
| SO_BACKED × SERIAL | unique eligible original outbound; exactly one-unit original-value restore and successful Reverse | duplicate in-stock identity, missing/ambiguous outbound, consumed/transferred serial |
| NO_SOURCE × MOVING_AVERAGE | marker remains NO_SOURCE; positive MA pool or unique explicit bounded outbound provenance; exact Reverse | no provenance/basis, fabricated commercial source, standard/legacy fallback |
| NO_SOURCE × LOT | marker remains NO_SOURCE; exact LOT pool or eligible same-LOT bounded provenance; fence-protected Reverse | wrong/ambiguous provenance, downstream OUT/replenishment, dependencies |
| NO_SOURCE × SERIAL | marker remains NO_SOURCE; unique eligible outbound/tracked pair; one-unit restore/Reverse | missing/ambiguous evidence, duplicate serial, sale-price/current-pool substitution |

Every row additionally tests missing key 400, same-key replay, payload conflict 409, NULL/unknown marker 409, original/reversal audit cardinality, period, permission/SOD, injected writer rollback, exact inventory/traceability/valuation/voucher/optional-Credit effects and zero partial effects. Real MySQL tests use independent connections for all five races; SQLite tests prove equivalent outcomes under its encompassing writer serialization.

#### 30.31.9 Exact implementation impact inventory and regression boundary

Implementation authorization, if later granted, is limited to:

- `server/modules/sales-return-canonical-writer.js`: provenance resolver/freeze, corrected LOT/SERIAL Confirm and Gate-B, explicit-key/unknown-marker enforcement and common lock order;
- `server/modules/financial-inventory.js`: bounded exact-outbound resolver/apply helper and exact Return reversal validation; existing general primitives retain contracts;
- `server/modules/traceability-quality.js` and `server/lib/inventory-mutation.js`: only bounded authoritative preflight/lock helpers needed to preserve canonical physical/tracking writes; no second mutation engine;
- `server/migrations/sales-customer-wave6-returns.js`: one provenance table plus the three supporting indexes and SQLite/MySQL metadata verification;
- existing Wave-6 functional/final-functional/migration tests, a focused Option-C/provenance suite if separation is clearer, MySQL independent-session concurrency registration, and `scripts/testing/test-suites.js` classification;
- the existing Return UI/API request model only to carry an optional outbound movement identity and mandatory Option-C header; no UI redesign.

Regression preserves DELIVERY_BACKED confirm/reverse, Purchase Return, MOVING_AVERAGE validated behavior, Replacement lifecycle/evidence, F5/F6, Quotation/SO/Change/Delivery, Batch A, Inventory generic valuation consumers and all Wave 7+ files/contracts. Required gates after future implementation are focused Wave-6 tests, FAST/FULL, build, diff check, HEAVY, protected MySQL migration/integration and protected independent-session MySQL concurrency. This Design performs none of them.

#### 30.31.10 Remaining risks and Design stop

- Existing legacy rows may remain permanently non-reversible without separately authorized remediation; this is intentional fail-closed behavior.
- Conservative same-timestamp and dimensionless-reservation rules can reject a technically safe reversal; false rejection is preferred to unsupported consumption proof.
- MySQL next-key locking depends on the specified composite indexes and repository isolation; acceptance must prove phantoms are blocked using independent sessions.
- A new eligible customer-outbound type, LOT-specific reservation authority or legacy backfill would reopen Requirement/Design and is not implied here.

This bounded Design is complete for review. No source, schema, migration, test, frontend or database change is authorized by this record. Wave 6 implementation and final acceptance remain unapproved.

#### 30.31.11 Implementation evidence — 2026-10-18 SERIAL valuation pre-state correction

This sub-section records implementation-level corrections aligned with the frozen §30.31.4 items 1 + 4 + 5 contract. The Design itself is unchanged.

**A. SERIAL valuation authority is the eligible original outbound.**
`server/modules/sales-return-canonical-writer.js` `resolveOptionALinePlan` no longer reads `pool.value_cents` for SERIAL allocations. It now:
1. Rejects pre-Confirm SPECIFIC_SERIAL pool with positive quantity or value (item 1 fail-closed).
2. Resolves the authoritative original outbound via `resolveOriginalOutboundEvidence` (narrow `SALES_DELIVERY_COGS` predicate).
3. Sets `valueCents = Math.abs(originalOutbound.value_delta_cents)` (item 4 — never current pool value).
4. Caches `originalOutbound` on the allocation so `freezeProvenance` does not re-resolve.

**B. SERIAL post-Confirm pool state.**
Pre-Confirm pool MUST be 0/absent (rejected above). `receiveValue` adds `+1/+outbound_value` to the absent pool via `writeMovement` → `INSERT … ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity, value_cents=excluded.value_cents`. Post-state pool becomes `quantity=1, value_cents=Math.abs(originalOutbound.value_delta_cents)`. This satisfies item 5 (exactly one unit at the Return warehouse with matching one-unit valuation balance) without unconditional UPSERT that overwrites a conflicting positive legacy balance — the precondition check rejects such states.

**C. LOT frontier FOR UPDATE locking.**
`server/modules/sales-return-canonical-writer.js` `lotGuard` now appends `FOR UPDATE` (MySQL only) to:
- `inventory_valuation_movements` negative-movement frontier query (line 67-73 in current revision).
- `tracked_identity_hold_history` LOT identity temporal check (line 89).

`serialGuard` Reverse-time `tracked_inventory_movements` post-OUT and `tracked_identity_hold_history` post-HOLD checks are also FOR UPDATE-locked. SQLite `BEGIN IMMEDIATE` already serializes the entire transaction so the clause is a no-op hint on SQLite.

**D. Composite frontier index for MySQL InnoDB next-key locking.**
The Wave-6 migration adds `idx_valuation_movements_identity_status_created` on `inventory_valuation_movements(product_id, warehouse_id, lot_id, serial_id, status, created_at, id)` for both SQLite and MySQL paths, conditional on the table existing (so minimal F5-only fixtures do not error). The index supports MySQL InnoDB next-key locking at the `(product_id, warehouse_id, lot_id, serial_id, status, created_at, id)` range so a phantom negative LOT movement cannot be inserted between the Reverse-time frontier read and transaction commit.

**E. Implementation-grade guarantees.**
- Pre-Confirm positive SPECIFIC_SERIAL pool → 409 with zero partial side effects (no `inventory_valuation_movements` SALES_RETURN row, no `inventory_transactions` SALES_RETURN row, no `sales_return_valuation_provenance` row, `return_orders.status` remains DRAFT).
- Pre-Confirm absent SPECIFIC_SERIAL pool → Confirm succeeds, post-state pool is exactly 1 unit at the outbound value, `sales_return_valuation_provenance` immutable row inserted with `value_cents = Math.abs(originalOutbound.value_delta_cents)`.
- LOT Reverse succeeds when no downstream negative movement exists at the exact LOT identity (conservative fence per §30.31.3).
- LOT Reverse fails 409 when any downstream POSTED negative valuation movement exists at the exact LOT identity whose `created_at >= original.created_at` AND from a different transaction; OUT-then-replenishment remains 409.
- All four post-conditions (pre-Confirm / Confirm / Reverse / Negative) are exercised by the Wave 6 focused test suites (`server/sales-customer-wave6-functional.test.js`, `server/sales-customer-wave6-bounded-superseding.test.js`, `server/sales-customer-wave6-final-functional.test.js`, `server/sales-customer-wave6-migration.test.js`).

**F. MySQL independent-session race evidence.**
Real MySQL execution requires `ERP_DB_HOST / ERP_DB_PORT / ERP_DB_NAME / ERP_DB_USER / ERP_DB_PASSWORD` plus `ERP_MYSQL_TEST_ALLOW_RESET=true` and remains `TEST_EVIDENCE_PENDING`. The five race classes from §30.31.7 are exercised by `server/mysql-sales-customer-wave6-concurrency.integration.js` via `scripts/gates/mysql-concurrency-sales-wave6-worker.mjs` once the disposable MySQL target is provisioned.

**G. Frozen contracts preserved.**
DELIVERY_BACKED `reverseOperationalReturn` (`server/modules/financial-controls.js:323-382`), DELIVERY_BACKED `confirmSalesReturn`, Purchase Return `side='PURCHASE'` branch, Batch A frozen contracts, MOVING_AVERAGE strict negative-movement rule (`strictNegativePostCheck`), Replacement lifecycle + immutable fulfillment evidence, F5 `CHECK(amount_cents >= 0)` relaxation, F6 `cancellation_state` migration synchronization, Wave 7+ schema and contracts all remain unchanged.

#### 30.31.12 Implementation evidence — MySQL LOT frontier physical index realization

The logical §30.31.5 index remains `(product_id, warehouse_id, lot_id, serial_id, status, created_at, id)` on both databases. SQLite creates the seven full columns. MySQL retains full persisted `VARCHAR(128)` values and the same logical column order, but its nonunique BTREE uses `status(16)` and `created_at(64)` prefixes while keeping all four identity columns and final `id` full-width. The maximum utf8mb4 key payload is `(4 × 128 + 16 + 64 + 128) × 4 = 2880` bytes, below InnoDB's 3072-byte limit; no stored value, identity dimension, uniqueness rule or query predicate is truncated or removed.

This is a physical compatibility realization, not a Design-semantic change. `status` is constrained to `POSTED / LEGACY_UNVALUED`, and canonical timestamps are ISO strings shorter than the 64-character prefix. Even for an unexpected longer stored value, MySQL evaluates the full row predicate after index lookup; a prefix collision can only conservatively widen the scanned/locked range. The LOT frontier keeps exact product/warehouse/LOT filtering, rejects same-timestamp ambiguity through the full `created_at >= ?` predicate, and retains the full `id` as the final BTREE discriminator. Acceptance still requires a real MySQL `EXPLAIN`/metadata check and the five §30.31.7 independent-session races; static DDL feasibility is not treated as phantom-safety proof.

`server/database/mysql-schema.js` owns the single name-scoped SQLite-snapshot-to-MySQL prefix override so fresh bootstrap and additive index reconciliation emit identical DDL. `server/migrations/sales-customer-wave6-returns.js` reuses that renderer, creates missing Wave-6 indexes idempotently, verifies `NON_UNIQUE / COLUMN_NAME / SEQ_IN_INDEX / SUB_PART`, and fails closed on any same-name conflicting shape. No existing data is rewritten or inferred.

---
