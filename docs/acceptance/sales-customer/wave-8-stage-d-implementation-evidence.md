# Wave 8 Stage D — Actual Implementation Evidence

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）
## 35.20 Wave 8 Stage D — Actual Implementation Evidence

This section records the implementation of the already approved §35.18/§35.19 design. It does not supersede those contracts or authorize Wave 9–13.

### 35.20.1 Landed modules and call flow

- `server/modules/service-fulfillment.js` owns Service Fulfillment commands, scope, lifecycle, SO capacity, C1 Gate invocation, DIRECT Finance recognition, audit and idempotency.
- `server/modules/consignment.js` owns commercial location/document/line state, immutable Handoff evidence resolution, entitlement FIFO/explicit SERIAL allocation, Settlement OUT, Return MOVE, reporting and API dispatch.
- `server/lib/inventory-position.js` owns Position Snapshot V1 build/parse/recanonicalize/hash verification.
- `server/lib/inventory-mutation.js` owns the Consignment-only evidence/fingerprint/replay branch while preserving legacy V21 caller behavior; runtime DDL is absent.
- `server/modules/traceability-quality.js` supplies transaction-linked strict tracking legs inside the caller transaction.
- `server/modules/finance-recognition.js`, `finance-invoice-cardinality.js` and `commercial-golive.js` implement A3 locks, immutable invoice links, capacity conservation and multi-source Service Credit allocation through the existing Finance writers.
- `server/app.js` remains the HTTP composition point for the contextual routes and mixed Delivery orchestration.

### 35.20.2 Schema and migration realization

`inventory_mutation_log` has exactly the nine nullable §35.19 columns. SQLite and MySQL define the bounded indexes and Consignment completeness/immutability triggers. Fresh install, existing additive upgrade and repeated migration use the canonical Inventory/Wave 8 migration registries. Legacy rows remain nullable; no historical backfill, table rebuild, fifth Wave 8 table, shadow inventory or shadow AR is introduced.

The four Wave 8 business tables remain `service_fulfillments`, `consignment_commercial_locations`, `consignment_commercial_documents` and `consignment_commercial_lines`.

### 35.20.3 Transaction and lock realization

Handoff, Settlement and Return use one caller-owned transaction. Historical snapshots select exact positions; execution re-locks current line capacity and V21 position/tracking/valuation authority. Each partition has a stable mutation idempotency key and exact transaction references. Any tracking, valuation, period, Finance, audit or evidence failure rolls back all layers.

Service CONFIRM and Delivery CONFIRM invoke the parent-first C1 Gate before their business transaction, then re-read their protected authority in the business transaction. A3 invoice/credit operations lock immutable fulfillment/open-item capacity and conserve quantity and cents with BigInt cumulative allocation.

### 35.20.4 Verification realization

- `server/sales-customer-wave8-functional.test.js` covers snapshot tamper detection, evidence replay/conflict, Handoff/Settlement/Return and multi-source Service Credit.
- `server/mysql-sales-customer-wave8-concurrency.integration.js` uses separate MySQL connections plus a control-session overlap gate for R-SAL-20, R-SAL-21, R-SAL-22 and the four A3 races.
- `scripts/testing/test-suites.js` registers Wave 8 in FULL; `scripts/gates/mysql-concurrency-gate.mjs` registers Wave 8 in the protected concurrency gate.
- Existing V21, Wave 6/7, migration, navigation, permission and MySQL suites remain regression gates. Exact final command evidence is append-only in `log/2026-10-20.md`.
- `scripts/acceptance/sales-customer-wave8-acceptance.mjs` mounts both contextual routes in a real headless Edge instance at 320/390/430/680 CSS px and verifies no horizontal overflow, 44px controls and direct/refresh/back/forward navigation.

This is implementation evidence only. Final Acceptance and Freeze remain user-owned.

### 35.21 Wave 8 P0/P1 remediation and acceptance-evidence closure (2026-10-20)

This records the bounded remediation of the independent Wave 8 audit. It implements the already
approved §35.18/§35.19 contracts; it does not reopen them, does not change Wave 6/7 or frozen
Finance/V21 semantics, and does not declare Final Acceptance or Freeze.

#### 35.21.1 P0-1 — positive-amount consignment settlement

§35.18.10.4 makes a zero-price or sub-cent-zero settlement fail-closed. `settleConsignmentLineCommand`
now computes the cumulative BigInt event amount and refuses with `CONSIGNMENT_SETTLEMENT_AMOUNT_NOT_POSITIVE`
before any commercial, inventory, tracking, valuation, Finance or audit effect. The Finance recognition
and settlement voucher become unconditional because the amount is now provably positive. The zero-amount
Service Fulfillment contract is untouched.

§35.18.7 additionally requires the Finance source to carry the same immutable event identity as the V21
mutation. The settlement previously passed the consignment `document_no` as `sourceNo`, and
`ensureSubledger` derives `account_receivables.voucher_no` as `AR-<sourceNo>`, so every settlement after
the first on a document collided on that unique column. The source now carries `CS:<lineId>:<sha256(key)>`.

#### 35.21.2 P0-2 — SO-backed commercial authority

`assertSoBackedConsignmentBasis()` locks and reads the approved SO line and derives the authoritative
net unit price as `amount_cents × 1e6 / orderedBaseMicros`. It refuses with
`CONSIGNMENT_SALES_ORDER_BASIS_MISMATCH` when the submitted price differs, and with
`CONSIGNMENT_COMMERCIAL_BASIS_UNREPRESENTABLE` (carrying a `reason`) when the basis cannot be carried by
the four-table contract: non-1:1 Sales UOM (`SALES_UOM_NOT_ONE_TO_ONE`), a net price that is not an exact
integer number of cents per base unit (`NET_UNIT_PRICE_NOT_INTEGER_CENTS`), or a stored discount snapshot
that disagrees with the source amount. Remaining approved source capacity is enforced separately
(`CONSIGNMENT_SOURCE_CAPACITY_EXCEEDED`). No pricing policy, tax model or currency model is introduced.

#### 35.21.3 Consignment partition entitlement and handoff identity

Entitlement is now aggregated per `(lineId, to_position_key)` bucket rather than per handoff mutation.
Several source bins may hand off into one destination Position; the bucket's consumption is deducted once,
each contributing mutation stays individually inspectable via `mutationIds`, and LOT/SERIAL/bin identity
stays separated because the bucket key is the full canonical position key. Distinct commercial lines on a
shared Position remain independent because consumption is scoped by `source_item_id`.

Handoff now verifies `fromPosition.warehouseId === document.source_warehouse_id`, that a supplied bin
really belongs to that warehouse, and that a bin-enabled source warehouse supplies one, all before V21 runs.

Because V21 identifies a valuation movement by `(source_type, source_id, source_item_id, lot, serial,
movement_type)`, the partitions of one document collided on `idx_valuation_source_identity`. The canonical
source position now travels in the Wave 8 caller-supplied `movementType`; V21's schema, index and writers
are unchanged.

#### 35.21.4 C1 parent-first lock order

§35.18.6 requires the Finance PREPAYMENT parents to be locked before any Gate requirement/result or Sales
business row. `authorizeSalesPrepaymentGateWithPlan()` and `authorizeSalesPrepaymentGateForMutation()` now
perform unlocked identity discovery, then `lockEligiblePrepaymentParents()` (ids ASC), then the Gate rows,
then the Sales capacity rows. The adapter's global transaction gate serializes MySQL work, so a timing
race cannot evidence lock ORDER; the order is asserted on the literal `FOR UPDATE` statements emitted.

Caller audit: Service CONFIRM (`service-fulfillment.js:149-157`) and Delivery CONFIRM (`app.js:5689-5697`)
both discover unlocked before the transaction and invoke the Gate before taking any Sales row lock, so no
Sales lock is ever held before a Finance parent. `salesOrderAction` submit and Reservation Intent are
frozen Wave 7 callers that hold the SO header before the gate; Finance mutation paths never lock
`sales_orders`, so they form no deadlock cycle. Their business semantics are unchanged.

#### 35.21.5 Four-table MySQL existing-schema fail closed

These four tables are always created by the shared snapshot reconciliation before this migration runs, so
the migration's own MySQL DDL block is a no-op on any real database. A read-only assertion layer now
verifies the live physical contract through `information_schema`: table and column collation, exact column
set and order, data type, nullability, default, length, primary key, every foreign-key target, the exact
CHECK clause set, and each declared UNIQUE/non-unique index with its column identity and order. Constraint
identity is asserted by meaning rather than by name because MySQL auto-names CHECK and FOREIGN KEY
constraints. Drift fails closed with `Wave 8 MySQL schema conflict: ...`; the layer issues no DDL and never
drops, rebuilds, cleans or fabricates history.

`lot_code_key` is a declared byte-identity key that MySQL currently carries with `utf8mb4_0900_ai_ci`
instead of the designed `utf8mb4_0900_bin`. Closing that SQLite/MySQL parity gap is a schema migration and
needs its own Requirement/Design authorization, so it is exported as
`WAVE8_KNOWN_MYSQL_PARITY_GAPS` with status `EXTERNAL_CONTRACT_REQUIRED` rather than asserted as correct.

#### 35.21.6 Mixed Delivery

`createSalesDelivery` demanded physical stock for every line, which made the §35.18.4 service line — which
carries no inventory and consumes confirmed Service Fulfillment evidence — impossible to create. Service
lines are now excluded from the draft stock check; their capacity is enforced by the existing confirm-time
check under the confirm lock. Physical lines keep the canonical OUT, valuation and COGS path unchanged.

#### 35.21.7 RBAC

Read is `SALES_MANAGE OR SALES_VIEW` plus the narrow Wave 8 VIEW permission; write is `SALES_MANAGE` plus
the narrow MANAGE permission. `SALES_VIEW` is new in this wave with approved basis and the total permission
count is unchanged. Scope, permission and the absence of any residue on a refused mutation are proven over
the real HTTP surface.

#### 35.21.8 Items left open

Two audit items are not remediated here and are reported rather than closed:

1. **Credit Note reversal.** `financial_credit_adjustments` has an atomic reversal primitive, but
   `commercial_credit_notes.status='REVERSED'` is unreachable: the only writer is `createCommercialCreditNote`,
   which hard-codes `POSTED`, the only credit route is `POST /api/commercial-credit-notes`, and
   `reverseCreditAdjustment` is never called with `SALES_CREDIT_NOTE`. Building the business transition and
   its policy would invent a reversal contract that the approved Requirement/Design does not contain.
   Status: `EXTERNAL_CONTRACT_REQUIRED`.
2. **A3 invoice lock order.** `postSalesInvoice` never locks the SO line stage that §35.18.11.5 lists first,
   `recordInvoiceLinks` reads the existing link before taking the fulfillment and FINAL AR locks, and
   `voidPostedInvoice` performs no SO-line/fulfillment/FINAL-AR locking at all. Reordering these touches the
   frozen Finance writer, which this remediation is not authorized to rewrite. Status: audited, not
   remediated, not PASS.

This section records implementation and verification evidence only. Final Acceptance and Freeze remain
user-owned.
