# Sales & Customer — Wave 8 冻结技术基线

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/design/sales-customer/README.md`
> 来源：`solution.md` §35.22–§35.24、§35.27（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 35.18–35.19 Wave 8 Stage C Final Design Reconciliation + V21 Historical Position Evidence Carrier Design（冻结基线组成部分）

> G0 拆分说明：本节是 `solution.md` §35 H2 块中的 `§35.18` 与 `§35.19` 两个子节。
> §35.27 声明「§35.18–§35.26 构成 Wave 8 最终接受技术基线」，因此这两节属于**当前有效**技术设计，
> 与 §35.22–§35.24、§35.27 合并在本文件；同块的 §35.0–§35.17 已被取代，迁入
> [`docs/archive/design/sales-customer/wave-8-stage-c-design-closure.md`](../../archive/design/sales-customer/wave-8-stage-c-design-closure.md)。
> 原始 §35.18 / §35.19 标题与编号原样保留。

### 35.18 Wave 8 Stage C final design reconciliation (2026-10-19)

> Active status: `WAVE8_STAGE_C_DESIGN_RECONCILED — AWAITING USER ACCEPTANCE`.
>
> The user approved A1–A5, B1–B5 and C1–C2 and accepted C3 in the 2026-10-19 Stage C Final Design Reconciliation authorization. This subsection is the sole active reconciliation layer for Wave 8. It supersedes every conflicting statement in §35.2–§35.17, including all former `REQUIREMENT_DECISION_REQUIRED`, `EXTERNAL_CONTRACT_REQUIRED` and implementation-prohibition rows that referred to those now-approved decisions. Historical text remains evidence. Frozen §28–§30 business semantics are not rewritten, and Stage D remains unauthorized.

#### 35.18.1 Decision register — 12/12 plus C3

| Decision | Active Design disposition |
|---|---|
| A1 | APPROVED — non-zero Service Fulfillment CONFIRM uses explicit `DIRECT_BUSINESS_OPEN_ITEM`; `SERVICE_FULFILLMENT` may never accept `scope='FALLBACK'`. |
| A2 | APPROVED — a zero-value fulfillment may become CONFIRMED with complete operational evidence, no Finance adapter call and no zero AR. |
| A3 | APPROVED BOUNDED EXTENSION — existing `finance_invoice_source_links` carries partial/multiple links; the source AR row is the locked amount-capacity anchor. |
| A4 | APPROVED — only `PENDING → CANCELLED`; CONFIRMED has no cancel/reversal endpoint in Wave 8. |
| A5 | APPROVED SUBJECT TO C1 — every Service CONFIRM is a new entry for the existing DELIVERY-stage Gate policy; later Delivery evaluates the Gate again. |
| B1 | APPROVED — inactive location blocks new instruction/handoff but historical unsettled stock may settle/return from verified V21 evidence; outstanding mapping is immutable. |
| B2 | APPROVED — tax-exclusive, post-discount integer-cent net unit price; representability boundary and BigInt cumulative allocation. |
| B3 | APPROVED — `lot_code_key` is canonical V21 `lot_id`; no Sales normalization identity. |
| B4 | APPROVED — whole DRAFT cancellation before handoff only; no partial cancellation/split. |
| B5 | APPROVED — unsettled return requires explicit enterprise warehouse/bin, strict V21 MOVE and no AR/refund. |
| C1 | APPROVED DESIGN SCOPE — composable PREPAYMENT-parent-first orchestration, stale-plan rollback and independent-session proof. |
| C2 | APPROVED DESIGN SCOPE — three V21 source types, strict valuation/COGS and caller-owned atomicity. |
| C3 | ACCEPTED — successful committed transitions are audited in-transaction; rollback does not leave a business audit row and no failure-audit subsystem is added. |

Resolved former blockers:

| Former §35.17 item | Resolution in this subsection |
|---|---|
| P1-1 Gate/Finance composition | §35.18.6 defines the approved parent-first planning and locking contract and adapts both Service CONFIRM and current Sales Delivery CONFIRM. |
| P1-3 service Finance policy | §35.18.4 fixes DIRECT, zero evidence, invoice capacity and PENDING-only cancellation. |
| P1-5 inactive location/return | §35.18.5 and §35.18.7 fix historical continuity and explicit enterprise return destination. |
| P1-6 amount/LOT | §35.18.3 and §35.18.5 fix the representability boundary, cumulative cents formula and V21 lot identity. |
| Inventory writer | §35.18.7 defines the approved bounded V21 extension without schema change. |
| durable failure audit | C3 closes it: not required. |

#### 35.18.2 Authoritative four-table schema and dialect parity

Exactly four new tables remain authorized. No existing table gains a column, constraint or replacement schema in Wave 8.

##### `service_fulfillments`

| Field group | Active physical contract |
|---|---|
| Identity/source | `id` PK NOT NULL; `fulfillment_no` UNIQUE NOT NULL; `sales_order_id`, `sales_order_item_id`, `product_id`, `customer_id` NOT NULL FKs; `sales_group_id` nullable FK. |
| Quantity/amount | `confirmation_qty_micros` BIGINT-range integer `>0`; `unit_price_cents >=0`; `recognition_amount_cents >=0`; `business_date` required. |
| State | `confirmation_state` exactly `PENDING/CONFIRMED/CANCELLED`; `confirmed_at/by`, `cancelled_at/by`; `version >=1`; actor/timestamp metadata. |
| Finance result | nullable `finance_recognition_mode`, `finance_open_item_id`, `finance_source_type`, `finance_source_id`. |

Static state CHECK:

```text
PENDING:
  confirmation/cancellation evidence NULL
  recognition_amount_cents=0 and all finance_* NULL

CANCELLED:
  cancelled_at/by NOT NULL; confirmed_at/by NULL
  recognition_amount_cents=0 and all finance_* NULL

CONFIRMED ZERO:
  confirmed_at/by NOT NULL; cancelled_at/by NULL
  recognition_amount_cents=0 and all finance_* NULL

CONFIRMED NON-ZERO:
  confirmed_at/by NOT NULL; cancelled_at/by NULL
  recognition_amount_cents>0
  finance_recognition_mode='DIRECT_BUSINESS_OPEN_ITEM'
  finance_open_item_id NOT NULL
  finance_source_type='SERVICE_FULFILLMENT'
  finance_source_id=id
```

This distinguishes a lawful zero economic result from a missing non-zero Finance result without adding a column. Legal transitions, aggregate capacity, Finance-row existence and policy scope remain writer invariants. Indexes remain `sales_order_item_id,confirmation_state,id`; `sales_order_id,id`; and `sales_group_id,business_date,id`.

##### `consignment_commodity_locations`

`id` PK NOT NULL; `location_code` and `customer_id` form the customer-scoped commercial identity; `name/address_text`; explicit `physical_warehouse_id` and nullable `physical_bin_id`; `active` 0/1; effective dates; `version >=1`; actor/timestamps. The mapped bin must belong to the mapped active warehouse. A commercial id is never a V21 position dimension.

##### `consignment_commercial_documents`

`id` PK NOT NULL; `document_no` UNIQUE; `customer_id`, nullable `sales_group_id`, `source_warehouse_id`; instruction/business dates; frozen base `currency_code`; `status` exactly `DRAFT/INSTRUCTED/PARTIAL_SETTLED/SETTLED/RETURNED/CANCELLED`; `version >=1`; confirmation and actor/timestamp evidence. `CANCELLED` is reachable only from DRAFT with no handoff movement. Derived post-handoff states are writer-controlled.

##### `consignment_commercial_lines`

`id` PK NOT NULL; `document_id`, `line_no`; optional truthful `sales_order_item_id`; `product_id`; `consignment_commodity_location_id`; nullable display `lot_code`; required `lot_code_key`; `consigned_qty_micros >0`; non-negative cumulative settled/returned quantities and amounts; `unit_price_cents >=0`; nullable `handoff_movement_group_id` and `last_finance_reference_id`; `version >=1`; actor/timestamps.

```text
UNIQUE(document_id,line_no)
UNIQUE(document_id,product_id,consignment_commodity_location_id,lot_code_key)
settled_qty_micros + returned_qty_micros <= consigned_qty_micros

no LOT: lot_code IS NULL AND lot_code_key=''
with LOT: lot_code IS NOT NULL AND lot_code_key is a validated existing
          inventory_lots.id for the same product
```

`lot_code_key` has SQLite `COLLATE BINARY` and MySQL `VARCHAR(128) COLLATE utf8mb4_0900_bin`; its value is copied exactly from V21 `inventory_lots.id`. The application validates the product relationship under lock. It is intentionally not a nullable FK because the approved empty no-LOT sentinel must remain portable. `lot_code` is the resolved display value only; whitespace, case and Unicode do not define identity.

SQLite uses explicit `TEXT PRIMARY KEY NOT NULL`, INTEGER quantities/money/versions/booleans and BINARY key comparison. MySQL uses explicit `VARCHAR` PK NOT NULL, BIGINT quantities/money, INT version, TINYINT(1) boolean, named CHECK/FK/UNIQUE/index objects and binary collation only on byte-identity keys. Metadata assertions cover column order/type/null/default/PK/FK/CHECK/UNIQUE/index/collation. Migration order and id remain those in §35.6; fresh, upgrade and replay must converge without data repair or destructive DDL.

#### 35.18.3 Quantity, UOM and cents contracts

All arithmetic uses BigInt intermediate values and converts to JavaScript Number only after safe-integer bounds are proven.

Service amount allocation remains:

```text
allocatedAfter  = floor(approved_so_line_amount_cents * confirmedAfterMicros / orderedMicros)
allocatedBefore = floor(approved_so_line_amount_cents * confirmedBeforeMicros / orderedMicros)
thisRecognition = allocatedAfter - allocatedBefore
```

Earlier confirmed rows never change; a full final confirmation receives the remaining cent. The first CONFIRM locks and verifies current approved SO commercial evidence; after any CONFIRMED fulfillment, §35.17.3's SO Change/A-61 immutability guards remain active.

Consignment's approved four-table carrier has no UOM snapshot column. Therefore its supported representability boundary is deliberately narrow:

1. `consigned_qty_micros`, settled quantity and returned quantity are canonical base-UOM micros.
2. `unit_price_cents` is also the tax-exclusive, post-discount net price per one base UOM; Wave 8 accepts it as “sales UOM price” only when the authoritative Sales UOM equals the product base UOM with exact 1:1 conversion.
3. An SO-backed line must prove its approved document UOM is the base UOM and:
   `sales_order_item.amount_cents == floor(unit_price_cents * ordered_micros / 1_000_000)`.
4. A no-SO line requires explicit `unitPriceCents`, `currencyCode` equal to the system base currency, `SALES_MANAGE` plus the Wave 8 manage permission, and the same base-UOM restriction.
5. Non-1:1 Sales UOM, tax-inclusive amount, header discount allocation, fractional-cent price, multi-currency, or any source whose approved net amount fails the equality is rejected as `CONSIGNMENT_COMMERCIAL_BASIS_UNREPRESENTABLE`; no amount is rounded away or silently reinterpreted.

For each settlement command:

```text
targetSettledCents = floor(unit_price_cents * settledAfterMicros / 1_000_000)
eventCents         = targetSettledCents - settled_amount_cents_before
```

The event must be positive for a Finance posting; a settlement command whose calculated delta is zero fails closed with `CONSIGNMENT_SETTLEMENT_AMOUNT_NOT_POSITIVE` and changes no quantity. It may be retried only with a legal quantity whose cumulative delta is positive. The final settlement of the full consigned quantity receives the exact full-line remainder. `returned_amount_cents` is non-financial reporting evidence calculated by the analogous cumulative formula over returned micros; it never creates AR/refund. When settlement plus return closes a mixed line, no unearned remainder is posted. The full instruction amount is not itself a booked receivable.

#### 35.18.4 Service Fulfillment, Gate, Finance and invoice contract

State machine and writer:

```text
CREATE  none → PENDING
CANCEL  PENDING → CANCELLED
CONFIRM PENDING → CONFIRMED
CONFIRMED → any cancel/reverse/edit is not a Wave 8 command
```

Every command requires a non-empty header `Idempotency-Key`; fingerprint covers entity/version, quantity, date and all economic inputs. Same key/fingerprint replays; mismatch is 409. CREATE/CANCEL audit in the same transaction. CONFIRM executes:

1. C1 parent-first Gate plan and DELIVERY-stage authorization;
2. locked SO/service capacity, A-61 and immutable amount evidence checks;
3. amount allocation;
4. if zero, persist the `CONFIRMED ZERO` shape and skip Finance;
5. if non-zero, require an explicit effective Finance policy row resolving to DIRECT with scope `SOURCE` or `SITE`, never `FALLBACK`; call `recognizeFinanceExposure` once with `source_type='SERVICE_FULFILLMENT'`, `source_id=fulfillment.id`; verify FINAL open item, amount, customer and source identity;
6. persist state/result, audit and idempotency result in the same transaction.

Gate PASS/WARN/BLOCK/OVERRIDE_REQUIRED meanings and override authority are unchanged. It never consumes PREPAYMENT. Each partial confirmation evaluates current balance. A later Delivery runs its own current Gate evaluation; a later BLOCK preserves the already-confirmed fulfillment/AR and returns an explainable Delivery block—it never rewrites history.

Sales Delivery uses the §35.8 physical/service partition, as corrected here: C1 Gate parent locks occur before Delivery/SO/capacity locks. Physical lines retain frozen Inventory/OQC/valuation/COGS and `SALES_DELIVERY` recognition. Service lines lock and consume confirmed fulfillment quantity evidence, write no Inventory/valuation/COGS, and are excluded from Delivery Finance recognition. Pure and mixed deliveries commit atomically.

A3 invoice linkage:

> A3 primary-key, replay, writer reachability, `source_line_id`, POST/VOID/Credit and concurrent capacity details are corrected by §35.18.11. Where the bullets below conflict with §35.18.11, §35.18.11 is authoritative.

- Capacity identity is the FINAL `account_receivables` row with `(source_type='SERVICE_FULFILLMENT', source_id=fulfillment.id)` and amount capacity `amount_cents`, not its current unpaid balance.
- Before posting an invoice, Finance locks every referenced source open item in `(source_type,source_id,id)` order, locks the invoice header, and sums `finance_invoice_source_links.invoiced_amount_cents` joined to non-reversed POSTED invoices for each source. The current invoice amount plus the posted cumulative amount must be `<=` source capacity.
- A service link stores `source_type='SERVICE_FULFILLMENT'`, `source_id=fulfillment.id`, `source_line_id=sales_invoice_items.id`, `invoiced_quantity` as service micros and its exact allocated invoice cents. The existing source index supports the locked sum; no new table is needed.
- Link insert, capacity recheck, invoice POST and audit share the Finance-owned transaction. Same invoice/source/line replays through the existing UNIQUE; a different allocation conflicts. Invoice posting never calls recognition for the service amount and never creates another service AR/revenue voucher.
- A service invoice line is still represented by an existing confirmed service Sales Delivery item because current `sales_invoice_items.delivery_id/delivery_item_id` are NOT NULL. Finance links allocate that invoice line across locked confirmed fulfillment sources. Invoice quantity remains bounded by both confirmed service Delivery quantity and unlinked fulfillment quantity.
- One invoice can contain physical and service lines when all recognition sources resolve to DIRECT. `finance_invoice_source_links` represents both and the invoice header may leave `open_item_id` null for multiple source open items, as the current DIRECT adapter already permits.
- A heterogeneous-mode mixed invoice cannot be represented faithfully because the existing invoice header has one `recognition_mode` and current `resolveRecognitionModeForSources()` requires one mode. Such an invoice fails with `MIXED_INVOICE_RECOGNITION_MODE_UNSUPPORTED`; physical sources must be invoiced separately or their policy must already be DIRECT. Supporting heterogeneous modes would require a separately approved Finance contract/schema change and is not claimed COVERED.

Draft invoice cancellation creates no service link because links are written at POST. Posted invoice reversal preserves trace: capacity calculations exclude the reversed invoice only after the canonical reversal commits; links are not deleted. Direct editing of posted links is prohibited.

#### 35.18.5 Consignment business lifecycle

1. CREATE produces DRAFT header/lines after A-61, customer/group, base-UOM representability and commercial-location validation. No physical or Finance effect.
2. CANCEL is whole-document `DRAFT → CANCELLED` only when every line has null `handoff_movement_group_id` and V21 has no matching movement evidence. No partial cancel/split API exists.
3. HANDOFF locks the document/lines/location, requires location active/effective and its warehouse/bin coherent, resolves LOT/SERIAL through V21, then executes strict C2 MOVE. Success sets the immutable movement-group reference and derives INSTRUCTED. No AR/revenue.
4. SETTLE may proceed through an inactive location only for an already handed-off outstanding line. It resolves the historical source position from the stored handoff movement group and current unreversed V21 evidence, never from current location mapping. It locks line capacity and physical positions, performs strict OUT/COGS, creates one Finance event for `eventCents`, updates cumulative quantities/amounts and header state.
5. RETURN of unsettled quantity likewise resolves the historical source position, requires an explicit active destination enterprise warehouse/bin, locks both positions, performs strict MOVE, updates returned quantity/reporting amount and creates no AR/refund.
6. A customer return after settlement is rejected from this API and must use the frozen Sales Return/Finance Reverse chain.
7. Location deactivation and effective-date closure block new documents and handoff. Historical reads always work. Mapping update/deactivation, handoff, settlement and return lock in the common order. Physical mapping update is 409 while any handed-off line has `consigned-settled-returned > 0`; mapping update never relocates stock.

LOT/SERIAL:

- LOT lines use `lot_code_key=inventory_lots.id`; every physical command revalidates product, status and V21 position evidence. The display code is never used for identity comparison.
- The four tables intentionally contain no Sales serial carrier. For `SPECIFIC_SERIAL`, the command supplies canonical V21 serial ids; each serial is locked and mutated as its own canonical position under the same movement group and commercial line source item. `tracked_inventory_movements` and valuation rows persist the exact source identity. Later settlement/return may select only outstanding serials proven by unreversed Handoff minus later Settlement/Return evidence.
- A serial-tracked command without an exact canonical allocation, with quantity other than the sum of legal serial units, or with ambiguous legacy movement evidence fails `CONSIGNMENT_SERIAL_EVIDENCE_REQUIRED`. No planned/free-text serial is fabricated.

#### 35.18.6 C1 composable PREPAYMENT/Finance lock contract

Current-code fact: `authorizeSalesPrepaymentGateForMutation()` currently locks Sales requirement/result facts before `resolveEligiblePrepaymentForSalesGate()` locks PREPAYMENT parents, and `confirmSalesDelivery()` currently holds Delivery/capacity facts before calling it. Those calls are not the target contract and must not be reused unchanged.

The bounded implementation introduces a composable two-phase plan in the existing Wave 7/Finance adapters; names below are responsibilities, not claims that code already exists:

```text
discoverSalesPrepaymentGatePlan(db, salesOrderId, date)
  unlocked read only → customer, effective requirement id/version/fingerprint,
  prior DELIVERY override evidence id, candidate OPEN PREPAYMENT parent ids ASC

authorizeSalesPrepaymentGateWithPlan(db, plan, mutationContext)
  caller already opened the one transaction but holds no Sales business row lock
  → lock candidate PREPAYMENT parent ids ASC
  → current-read the eligible PREPAYMENT set again
  → if identity set/fingerprint shrank, changed, or contains a missed pre-existing
    candidate: throw retryable SALES_PREPAYMENT_LOCK_PLAN_STALE; outer rollback
  → re-read child application/refund/reversal effects under parent locks
  → lock/re-read Gate requirement, latest result/override and SO authority
  → verify customer/date/policy/requirement fingerprint still matches
  → calculate and persist the ordinary Wave 7 Gate result
  → caller continues to Sales capacity locks
```

An eligible PREPAYMENT row inserted only after the locked current-read can increase, not reduce, eligible value; omission is conservative. It cannot justify an unsafe PASS. All reductions of an existing eligible parent remain serialized because the inspected application/refund/UNAPPLIED-reversal paths acquire that parent first. Any detected candidate or policy change rolls back to the transaction boundary; retry begins from discovery and is bounded by the common retry policy. A retry never acquires an additional Finance parent after a Sales lock.

Global MySQL order for affected paths:

```text
0. unlocked identity discovery only; no decision and no mutation
1. PREPAYMENT parent rows by id ASC
2. Gate requirement + latest result/override + SO header by stable id
3. Service Fulfillment or Delivery header, SO lines/capacity rows by id ASC
4. fulfillment rows by id ASC / consignment document and lines by id ASC
5. V21 position_key ASC, then LOT/SERIAL canonical identities
6. Finance recognition/open-item source rows by (source_type,source_id,id)
7. invoice/settlement event rows, then idempotency result and audit
```

Service CONFIRM uses all relevant steps. Existing Delivery CONFIRM is compatibly reordered: an unlocked Delivery lookup discovers its SO, C1 locks parents, then Delivery/SO/capacity are locked and the source relationship is revalidated before any OQC/Inventory/Finance effect. Frozen Gate decisions and Delivery business results do not change. Finance PREPAYMENT application/refund/reversal already begins with the parent lock and never calls back into a later Sales lock. Finance recognition owns no PREPAYMENT mutation; its source/open-item locks occur only after Sales capacity. No opposite edge remains in the designed Wave 8 paths.

SQLite uses one outer `BEGIN IMMEDIATE` but follows the same logical order. MySQL acceptance uses at least two genuinely independent connections/workers, barriers only as observers, bounded timeout/deadlock diagnostics, and proves Service CONFIRM vs PREPAYMENT application/refund, Delivery CONFIRM vs PREPAYMENT mutation, Service CONFIRM ×2, and Service CONFIRM vs Delivery/SO Change. Deadlock retry is tested as recovery behavior but is not the correctness proof.

#### 35.18.7 C2 Inventory V21 bounded writer and value conservation

The implementation may add only these values to `server/lib/inventory-mutation.js`'s source allowlist:

| Source type | `sourceId` / `sourceItemId` / idempotency | Physical and valuation contract |
|---|---|---|
| `CONSIGNMENT_HANDOFF` | sourceId=document id; sourceItemId=line id; key `CONSIGNMENT_HANDOFF:<lineId>:<client-key>` | MOVE from explicit source warehouse/bin to the mapped destination; ENTERPRISE/null-owner both sides. |
| `CONSIGNMENT_SETTLEMENT` | sourceId=immutable `CS:<lineId>:<sha256(client-key)>`; sourceItemId=line id; same event identity in Finance/idempotency | OUT from verified historical consignment position; strict issue value and applicable COGS voucher. |
| `CONSIGNMENT_RETURN` | sourceId=immutable `CR:<lineId>:<sha256(client-key)>`; sourceItemId=line id | MOVE from verified historical position to explicit active enterprise destination. |

Every call uses canonical product/warehouse/bin/`owner_type='ENTERPRISE'`/null owner/AVAILABLE/lot/serial position keys and locks deduplicated keys ascending. The commercial location id is source/audit context only. The outer consignment writer owns the transaction; `applyInventoryMutation` inherits it and is called with `valuationMode='EXTERNAL'` so its legacy swallowed best-effort branch is never the economic authority.

Strict value sequences:

```text
HANDOFF or RETURN:
  physical MOVE writes OUT+IN inventory transactions
  issueValue(source identity) returns exact negative cents
  receiveValue(destination identity, abs(exact cents))
  sum valuation quantity = 0; sum valuation cents = 0; no COGS voucher

SETTLEMENT:
  physical OUT
  issueValue(historical identity) must succeed for the exact quantity
  create balanced voucher: DR COGS / CR inventory role for exact issued cents
  then Finance DIRECT commercial event for eventCents
```

For LOT/SERIAL, the operation is partitioned by canonical identity; all partitions share one movement group and outer transaction. Quantity moved/issued, tracked evidence quantity and valuation quantity must be equal. A missing pool, LEGACY_UNVALUED ambiguity after valuation activation, serial mismatch, period close, V21 failure, voucher failure, Finance failure or audit failure rolls back Sales cumulative values, inventory, tracking, valuation, voucher, Finance, idempotency and audit together. No best-effort success is legal.

No V21 schema, position-key definition, shadow stock table or Sales inventory balance changes. Existing exported `issueValue`, `receiveValue`, `createSystemVoucher`, position/tracking evidence and caller-owned transaction behavior are sufficient primitives; implementation still must add the three allowlisted source types and the consignment orchestration. If focused implementation proves a required primitive cannot accept the caller transaction or preserve exact value, Stage D must stop with `EXTERNAL_CONTRACT_REQUIRED` rather than bypass V21.

#### 35.18.8 API, RBAC, idempotency, compatibility and file plan

The §35.11 API set remains, with these corrections:

- Service/consignment handlers enforce the existing `SALES_VIEW`/`SALES_MANAGE` gate plus the approved narrow Wave 8 VIEW/MANAGE permission where registered; backend and sales-group scope both fail closed. Finance invoice posting continues to require Finance invoice authority. Existing settled Sales Return continues to require its frozen Return permissions.
- `POST .../service-fulfillments/:id/cancel` accepts only PENDING. CONFIRMED returns `SERVICE_FULFILLMENT_CONFIRMED_IMMUTABLE`; no reversal-policy placeholder remains.
- `POST .../consignment-commercial-lines/:id/return` requires `destinationWarehouseId` and bin when the warehouse is bin-enabled; it is no longer policy-blocked.
- `POST .../instruct` means physical Handoff and is allowed only from DRAFT. Location deactivation does not disable settle/return for historical handoff evidence.
- Every mutation requires header `Idempotency-Key`; body fallback and generated document keys are not accepted for new Wave 8 commands. Fingerprints include normalized destination, identity allocations, quantity, business date, expected version and economic basis.
- Reports join commercial rows to V21 and Finance evidence and expose discrepancies; GET never repairs. `REPORT_QUERY` audit is written only for the committed report-audit transaction and no durable failed-query audit is promised.
- Legacy Wave 8 rows do not yet exist. If later partial/deployed data has unknown lot, UOM, mapping, Finance source or movement evidence, reads label it `UNKNOWN/UNRESOLVED`; every economic mutation fails closed. No GET backfill or inferred history is permitted.
- `upsertInvoiceSourceLink()` is not a registered HTTP route in the current runtime. After Stage D authorization, its module boundary must reject `sourceType='SERVICE_FULFILLMENT'` with `SERVICE_FULFILLMENT_LINK_REQUIRES_INVOICE_POST`; it may not become an independent Service-link API. All Service links are created only by the canonical invoice POST transaction described in §35.18.11.

Implementation file impact after separate Stage D approval:

```text
server/migrations/sales-customer-wave8-service-consignment.js  four new tables only
server/migrations/sales-customer-domain.js                     one ordered Wave 8 entry
server/modules/service-fulfillment.js                          canonical writer/read adapter
server/modules/consignment.js                                  commercial + C2 orchestration
server/modules/sales-prepayment-finance-adapter.js             C1 discovery/parent-lock plan
server/modules/sales-prepayment-gate.js                        planned authorization entry
server/modules/finance-recognition.js                          explicit policy/source locks + A3 cap
server/modules/finance-invoice-cardinality.js                  locked cumulative service linkage
server/lib/inventory-mutation.js                               three source allowlist values only
server/modules/sales-order-changes.js                          fulfillment capacity/history guard
server/modules/sales-commercial-foundation.js                  A-61 protected-obligation guard
server/app.js                                                  owned routes + reordered mixed Delivery
src/api.js / applicationRegistry.js / contextual Wave 8 pages  approved surfaces, no launcher expansion
focused, migration, acceptance, MySQL worker and responsive tests plus suite registration
```

`financial-inventory.js`, position identity and traceability modules are reused unless implementation evidence proves a narrowly missing caller-owned primitive; they are not pre-authorized for unrelated rewrite. No existing schema/table extension is in the file plan.

#### 35.18.9 Acceptance matrix and value/atomicity proofs

| Existing trace | Required future proof after Stage D authorization |
|---|---|
| SC70–71 / S08 / UAT-S-25 | non-zero DIRECT exactly once; zero CONFIRMED without AR; PENDING cancel and CONFIRMED immutable; partial confirmations; Gate recheck; pure service/physical/mixed Delivery; no service Inventory/COGS; invoice partial/multiple cap; same-mode mixed invoice positive and heterogeneous-mode fail-closed. |
| SC72–77 / S18 / UAT-S-26 | four-table instruction, 1:1/base-UOM and amount representability; active mapped handoff; ENTERPRISE ownership; strict value-neutral MOVE; partial/multiple settlement with exact cumulative cents; three-layer report. |
| UAT-S-27 | inactive-location historical settlement/return; explicit destination; no AR/refund for unsettled return; settled return rejected to frozen Sales Return path; LOT and SERIAL V21 evidence. |
| UAT-S-41 | 320/390/430/680 contextual workflows, route/permission parity, clear Gate/inactive-location/unsupported-commercial-basis errors and no launcher expansion. |
| R-SAL-22 | independent Service CONFIRM ×2 and CONFIRM vs SO Change/Delivery; locked aggregate never exceeds order; Finance effect exactly once. |
| R-SAL-20 | two independent settlements share line/position/Finance source order; commercial/physical/amount capacities never exceed authority. |
| R-SAL-21 | one legal settlement and one legal return race through the same line and V21 positions; one/both may commit only within capacity; an always-409 return cannot pass. |
| Wave 7 R-SAL-15 reuse | Service and Delivery versus PREPAYMENT application/refund/reversal with Finance parent first, stale-plan rollback and no circular wait. |
| CAP-25 / CAP-26 | committed service/consignment transitions and report queries are traceable; rollback has zero business side effects and does not claim durable failure audit. |
| SQLite/MySQL parity | all four tables, state/zero/LOT binary constraints, ordered indexes and migration replay; MySQL races use independent sessions. |

A3 acceptance additionally requires: two fulfillment sources allocated to one service invoice item without physical-PK collision; exact five-tuple replay; same tuple with quantity or amount mismatch returning 409; cross-invoice amount and quantity over-cap races under one stable source lock; direct-writer SERVICE bypass rejection; POST-versus-POST and POST-versus-VOID/Credit independent-session proofs; immutable historical links after VOID/Credit; and zero-value fulfillment producing no Finance link. See §35.18.11.8.

Value-conservation acceptance for every successful Handoff/Return requires source valuation delta plus destination valuation delta = 0 cents and 0 net quantity, identity by identity. Settlement requires V21 quantity delta equal commercial settled delta, inventory valuation credit equal COGS debit, and Finance AR amount equal the cumulative event formula. Fault injection at each boundary must leave every layer unchanged.

No new SC, Invariant, UAT, Race or Audit Capability identifier is created; counts remain SC 114, Invariant 20, UAT 44, Race 24 and Audit CAP 36.

#### 35.18.10 Remaining explicit coverage limits and final hard stop

There is no unresolved contradiction inside the approved Wave 8 core design. These scenarios remain intentionally fail-closed rather than falsely COVERED:

1. a single invoice mixing DIRECT service sources with non-DIRECT physical sources (`MIXED_INVOICE_RECOGNITION_MODE_UNSUPPORTED`), because one current invoice header cannot carry heterogeneous recognition modes;
2. consignment pricing requiring non-1:1 Sales UOM, independent tax allocation, non-representable discount/amount, multi-currency or an additional pricing carrier (`CONSIGNMENT_COMMERCIAL_BASIS_UNREPRESENTABLE`);
3. ambiguous legacy LOT/SERIAL/movement/valuation history (`CONSIGNMENT_*_EVIDENCE_REQUIRED`);
4. zero-price or sub-cent-zero consignment settlement (`CONSIGNMENT_SETTLEMENT_AMOUNT_NOT_POSITIVE`); Wave 8 does not infer a giveaway/economic-disposal policy from B2;
5. any future CONFIRMED Service Fulfillment reversal, partial consignment cancel/split, or durable failed-attempt audit, each requiring a new Requirement/Design cycle.

These are declared compatibility/scope boundaries requested by the approved decisions, not permission to add columns, a fifth table or a new ledger. Stage D must stop if implementation discovers a different carrier conflict.

No Implementation, source/migration/test/frontend/config change, test/build/format/migration execution, database connection or Git operation is authorized by this Design reconciliation. User acceptance of this section is the next gate.

**Final status: `WAVE8_STAGE_C_DESIGN_RECONCILED — AWAITING USER ACCEPTANCE`. Hard Stop.**

#### 35.18.11 A3 Finance Invoice Link bounded correction (2026-10-19)

> This is the active A3 correction record. It is Design-only, does not reopen A3-CUMULATIVE, does not change frozen §28.10.3 source-cardinality semantics, and does not authorize Stage D.

##### 35.18.11.1 Confirmed source defects and production reachability

| Writer/entry | Actual reachability and authority | Current safety finding | Active A3 rule |
|---|---|---|---|
| private `recordInvoiceLinks()` in `finance-recognition.js` | Called only by `recognizeFinanceExposure()` when `input.invoice` exists. Sales Invoice POST and Supplier Bill POST call that adapter inside their `atomic()` transaction; HTTP caller has `FINANCE_INVOICE_MANAGE`. | Physical id is `${invoice.id}:${source.sourceLineId || source.sourceId}`. Distinct sources sharing one supplied source-line value collide. Existing five-tuple replay reads only `id` and silently skips without comparing quantity/amount. It has no cumulative lock/cap. | Replace the physical-id and replay behavior through the canonical validated writer below. The five-tuple business UNIQUE remains unchanged. |
| exported `upsertInvoiceSourceLink()` in `finance-invoice-cardinality.js` | No import in `server/app.js`, `server/index.js` or another production module; no HTTP route is registered. Current direct callers are tests only. The function itself checks `FINANCE_INVOICE_MANAGE`. | It accepts arbitrary source types and invoice ids, inserts an opaque id, but does not validate invoice existence/status, source/open item, stable locks, cumulative quantity/amount, or POST atomicity. If registered unchanged it would be a bypass. | At the function boundary, `SERVICE_FULFILLMENT` always fails `409 SERVICE_FULFILLMENT_LINK_REQUIRES_INVOICE_POST`. It is not registered as a Service-link API. Frozen non-Service behavior is otherwise not redesigned by Wave 8. |
| Sales Invoice CREATE | Registered `POST /api/sales-invoices`, `FINANCE_INVOICE_MANAGE`; creates DRAFT header/items only. | Does not write source links. | Remains link-free. Service allocation intent is recomputed and validated at POST from authoritative invoice/source facts. |
| Sales Invoice POST | Registered `POST /api/sales-invoices/:id/post`, `FINANCE_INVOICE_MANAGE`; current production path is `postSalesInvoice()` → `recognizeFinanceExposure()` → `recordInvoiceLinks()`. | This is the only reachable production link writer but lacks A3 validations. | Becomes the sole canonical `SERVICE_FULFILLMENT` link mutation path. All link validation, inserts, invoice state change and audit share its one caller-owned transaction. |
| Sales Invoice CANCEL | Registered on DRAFT only. | Does not write/delete links. | DRAFT must have no Service link. CANCEL never frees or changes a posted link. |
| Sales Invoice VOID | Registered for POSTED; changes header to REVERSED, does not delete links. | Current path does not lock Service sources/links; it can race a capacity user. | For an invoice having Service links, use the same source lock plan as POST before locking/re-reading the invoice. Links remain immutable; REVERSED status removes their amounts/quantities from effective consumed capacity only after the VOID transaction commits. |
| Commercial Credit | Registered `POST /api/commercial-credit-notes`, `FINANCE_INVOICE_MANAGE`; POSTED invoice only; finds linked open items when header `open_item_id` is absent. | Does not write links. It can race VOID because current invoice/source locks are incomplete. | Lock the same Service source set, then the invoice header. Credit never releases invoice-link quantity or amount capacity; link rows remain counted while the invoice is POSTED. VOID remains prohibited while `credit_state!='NONE'`. |
| Test/gate direct SQL inserts | Only test/integration/worker fixtures; not application APIs. | Some use `INSERT IGNORE`, which cannot prove business replay semantics. | They may seed non-Service fixture state, but Wave 8 Service acceptance must call the canonical POST path. `INSERT IGNORE` is forbidden as evidence for A3 idempotency/capacity. |

Repository-wide inspection found no production `UPDATE` or `DELETE` writer for `finance_invoice_source_links`. A3 preserves append-only link history.

##### 35.18.11.2 Physical primary key and five-tuple business identity

The frozen business identity remains exactly:

```text
(invoice_id, invoice_side, source_type, source_id, source_line_id)
```

The physical `id` is not that business identity. For every new link the canonical writer generates one opaque application UUID through the existing `id()` primitive only after proving that the five-tuple does not already exist. The UUID includes neither invoice-item nor source-line concatenation and therefore has no systematic collision when two source rows share an invoice item. A rare physical PK collision is a hard database error that rolls back the transaction; it is never handled by ignore/overwrite. Existing historical link ids are neither recomputed nor updated.

SQLite and MySQL both enforce the physical PK and the existing five-column UNIQUE. Every A3 Service link supplies a non-null, non-empty `source_line_id`, so MySQL/SQLite nullable-UNIQUE differences cannot weaken the Service identity. Stage D adds no table, field, replacement key or migration rewrite.

##### 35.18.11.3 Exact idempotent replay contract

Under the source locks and inside Invoice POST, the canonical writer queries the complete existing row by the five-tuple:

```text
existing quantity == normalized requested quantity
AND existing invoiced_amount_cents == normalized requested cents
  → return existing id with replayed=true; no INSERT/UPDATE/audit duplication

either value differs
  → 409 FINANCE_INVOICE_SOURCE_LINK_CONFLICT; whole POST rolls back

no row
  → generate opaque id and INSERT exact normalized values
```

Quantity and amount must already be safe integers and must satisfy the source-specific positive/zero rules; the writer never converts an invalid value to zero. It never overwrites a link and never uses `INSERT OR IGNORE`, `INSERT IGNORE`, upsert-update or duplicate-key swallowing as business idempotency. The link checks, Finance recognition/link audit and transition `DRAFT → POSTED` are one transaction. Replaying an already POSTED invoice returns the existing invoice only after verifying that all expected five-tuples and values still match; unexplained missing or mismatched link evidence is `409 FINANCE_INVOICE_SOURCE_LINK_EVIDENCE_MISMATCH`, not silent success.

##### 35.18.11.4 Canonical `source_line_id` semantics

Frozen §28.10.3 semantics are preserved: `source_line_id` identifies the upstream source document's line/capacity unit, not the invoice item. Current Sales behavior proves this by passing `sales_delivery_items.id` while `source_type='SALES_DELIVERY'` and `source_id=sales_deliveries.id`.

The Wave 8 mapping is:

| Identity | Service meaning |
|---|---|
| invoice document | `sales_invoices.id` |
| invoice item | `sales_invoice_items.id`; retains mandatory confirmed service `delivery_item_id` |
| physical/source document | one `service_fulfillments` row, addressed by `source_type='SERVICE_FULFILLMENT'`, `source_id=service_fulfillments.id` |
| source line | the atomic fulfillment has no child table, so its singleton canonical source-line identity is also `service_fulfillments.id`; this is stored in `source_line_id` |
| commercial capacity parent | `service_fulfillments.sales_order_item_id`, locked before fulfillment/open-item rows |

One service invoice item may allocate across multiple fulfillments: it produces one five-tuple/link per fulfillment, each with a different `source_id/source_line_id` and physical UUID. One fulfillment may allocate across multiple invoices because `invoice_id` differs. The link table remains invoice-header-to-source-line cardinality; it does not pretend that `source_line_id` is an invoice-item FK.

Because the existing table has no `invoice_item_id`, exact reconstruction uses a bounded writer invariant: within one invoice there may be at most one service invoice item for each `sales_order_item_id`. The invoice item resolves through its confirmed service Delivery item to that SO line; every allocated fulfillment must reference the same SO line. Multiple service invoice items for one SO line fail `409 SERVICE_INVOICE_ITEM_SOURCE_AMBIGUOUS`. This makes `invoice → unique service item per SO line → fulfillment links` reconstructable without changing frozen source-line meaning or adding a column.

##### 35.18.11.5 Canonical POST allocation and shared capacity locks

The Service subset of Invoice POST performs this deterministic plan in one transaction:

```text
unlocked discovery: invoice items → confirmed service Delivery items → SO line ids
lock/re-read SO lines id ASC
lock/re-read CONFIRMED fulfillment rows by (sales_order_item_id,business_date,id)
lock/re-read FINAL SERVICE_FULFILLMENT AR rows by id ASC
lock/re-read invoice header and items; abort if discovery fingerprint changed
lock/read existing link rows for the selected source identities
allocate each invoice item's base quantity micros FIFO by fulfillment
validate quantity and cents; replay/insert links
complete recognizeFinanceExposure DIRECT linkage and POST/audit
```

This order matches Service CONFIRM (`SO line → fulfillment → Finance source`) and prevents POST from holding a Finance source while waiting for Sales capacity. For each fulfillment `F`:

```text
quantityCapacity(F) = F.confirmation_qty_micros
amountCapacity(F)   = FINAL account_receivables.amount_cents

effectiveLinkedQty(F) = SUM(link.invoiced_quantity)
effectiveLinkedAmt(F) = SUM(link.invoiced_amount_cents)
  for links joined to sales_invoices.status='POSTED'
  plus the exact candidate/replay rows of the current DRAFT invoice being posted

effectiveLinkedQty(F) <= quantityCapacity(F)
effectiveLinkedAmt(F) <= amountCapacity(F)
```

Both dimensions are checked beneath the same SO-line/fulfillment/open-item locks. Allocation uses the invoice item's base-UOM micros and distributes its net source amount with BigInt cumulative difference so each link receives the cents corresponding to its allocated micros; the last allocation receives that item's exact remainder. For A3, Service Invoice posting is bounded to `tax_mode='NO_TAX'`, where invoice item net=gross and the linked total can equal the already-recognized DIRECT AR capacity. A taxed Service invoice cannot be reconciled with the pre-invoice DIRECT AR and current single-mode invoice/voucher carrier without a separate Finance policy; it fails `SERVICE_INVOICE_TAX_MODE_UNSUPPORTED` and is listed as a remaining coverage limit.

The current invoice's links are included once even though its header remains DRAFT until the final update. Other DRAFT/CANCELLED invoices do not consume capacity because they have no canonical links. No amount check uses `open_amount_cents`; collection, write-off or credit does not redefine the original confirmed invoiceable amount.

##### 35.18.11.6 POST, VOID, Credit and reversal history

| Lifecycle event | Link rows | Effective capacity | Required serialization |
|---|---|---|---|
| DRAFT create/cancel | none | none | no Service source capacity mutation |
| POST | append/replay exact links, then header POSTED | consumes exact linked quantity and amount at commit | SO line → fulfillments → FINAL AR → invoice |
| Credit note | unchanged and still counted | does not make the fulfilled quantity or original invoice allocation invoiceable again | same Service source locks → invoice; then existing credit/open-item mutations |
| Credit reversal | link unchanged and counted; frozen credit history controls economic reversal | no A3 capacity change | existing Finance reversal contract; no link writer |
| VOID/REVERSED | rows preserved; never delete/update | links cease to count only when invoice status becomes REVERSED in the same committed transaction | discover source set → SO line → fulfillments → FINAL AR → invoice; re-read set/status before commit |

VOID versus a new POST therefore serializes on the same fulfillment/open-item capacity anchors. Before VOID commits, the old POSTED links remain counted; after it commits, a later POST may reuse released invoice capacity while the original fulfillment AR and immutable VOID/link history remain traceable. Credit and VOID continue to obey the frozen rule that an invoice with active credit state cannot be voided.

Zero-value Service Fulfillment has no FINAL AR and is not a Finance invoice source. It may support Delivery operational evidence, but the canonical A3 writer creates no `finance_invoice_source_links` row for it. It is never represented by a fake zero-capacity open item.

##### 35.18.11.7 Canonical writer boundary and file impact

There is exactly one Service link mutation responsibility: a private validated link writer invoked by Sales Invoice POST through `recognizeFinanceExposure()` on the caller-owned transaction. Whether Stage D locates the private helper in `finance-recognition.js` or delegates its implementation to `finance-invoice-cardinality.js`, it must have one active call path and the complete contract above; two independently callable implementations are prohibited.

Bounded future file impact remains:

```text
server/modules/finance-recognition.js
  replace concatenated physical id; compare replay values; call canonical cap writer

server/modules/finance-invoice-cardinality.js
  host shared private validation only if called exclusively by invoice POST;
  exported independent handler rejects SERVICE_FULFILLMENT

server/modules/commercial-golive.js
  prepare/re-read Service allocation; POST/VOID/Credit source-lock composition

server/modules/service-fulfillment.js
  read-only source quantity/SO-line evidence for the Finance posting plan
```

No route is added for direct Service link mutation. No existing historical id changes. No table/column/index migration is approved by this correction.

##### 35.18.11.8 A3 acceptance and concurrency matrix

| Case | Required proof |
|---|---|
| Multi-source one item | one service invoice item allocated to two CONFIRMED fulfillments creates two rows with distinct opaque PKs and distinct source tuples; totals equal the item. |
| Partial/multiple invoice | one fulfillment links across two POSTED invoices; cumulative quantity/amount equals but never exceeds source capacities. |
| Exact replay | same five-tuple/quantity/amount returns the original row id and does not add audit/economic effect. |
| Replay mismatch | same five-tuple with changed quantity or cents returns `FINANCE_INVOICE_SOURCE_LINK_CONFLICT`; no row/header/audit change. |
| Physical PK regression | historical concatenated ids remain readable; new opaque ids do not rewrite them; SQLite/MySQL PK and five-tuple UNIQUE both reject actual duplicates. |
| Writer bypass | direct `upsertInvoiceSourceLink()` with `SERVICE_FULFILLMENT` fails before insert even for a Finance-authorized actor; no HTTP route exists. |
| Amount race | two independent POST sessions target the last AR cents; source locks allow only cumulative legal commits. |
| Quantity race | two independent POST sessions target the last fulfillment micros; the same locks prevent over-invoice even when cents remain. |
| POST vs VOID | old POSTED capacity is counted until VOID commits; afterward exactly the released capacity is reusable; links/history remain. |
| POST vs Credit | credit does not release A3 capacity; concurrent operations serialize and preserve credit/VOID eligibility. |
| Source-line semantics | physical Delivery continues using `sales_delivery_items.id`; Service uses singleton fulfillment id; no invoice-item id is stored as `source_line_id`. |
| Zero service | no AR and no source link; Delivery evidence remains valid and no zero Finance row is fabricated. |
| Tax boundary | NO_TAX Service invoice succeeds under exact AR cap; taxed Service invoice fails `SERVICE_INVOICE_TAX_MODE_UNSUPPORTED` with zero effects. |

Use focused SQLite contracts plus real MySQL independent sessions for the two cap races and POST-versus-VOID/Credit. Test-only direct SQL and `INSERT IGNORE` cannot satisfy these cases. Existing SC70–71, S08, UAT-S-25, R-SAL-22 and CAP-25/26 identifiers are reused; no new global identifier/count is created.

##### 35.18.11.9 Remaining blocker and hard stop

Blockers A–D are closed at Design level for the approved NO_TAX, same-recognition-mode A3 scope. The remaining explicit Finance coverage gap is taxed Service invoicing and the already-recorded heterogeneous-recognition-mode mixed invoice; both fail closed and require a separate Finance Requirement/Design if later requested. They do not authorize a fifth table, an existing-table extension or a change to frozen non-Service source-line semantics.

**A3 correction status: `WAVE8_STAGE_C_A3_CORRECTION_DELIVERED — AWAITING FINAL USER ACCEPTANCE`. Hard Stop: no Implementation, test/build/migration/database/Git operation is authorized.**

#### 35.18.12 Final A3 conservation verification (2026-10-19)

> This active Design-only addendum closes the two conservation proofs left after §35.18.11. It does not reopen A3-CUMULATIVE, change A1–C2, alter frozen §28 Finance semantics, or authorize Stage D. Where §35.18.4 or §35.18.11 is less explicit, this subsection supplies the required commit-time equality and Credit source-allocation contract.

##### 35.18.12.1 Per-invoice-item allocation conservation

The §35.18.11.4 bounded invariant first identifies exactly one Service invoice item `I` for each `(invoice_id, sales_order_item_id)`. More than one Service invoice item for the same SO line remains `409 SERVICE_INVOICE_ITEM_SOURCE_AMBIGUOUS`; no allocation is attempted. The canonical POST working set retains `invoice_item_id` while it resolves that item to one or more locked CONFIRMED fulfillment sources, even though the persisted Finance link deliberately retains frozen source-line identity and has no `invoice_item_id` column.

For every positive Service invoice item `I`, before any link insert or invoice state transition the writer must prove all of these exact integer equalities:

```text
L(I) = complete candidate/replay link allocation for I

SUM(link.invoiced_quantity_micros for link in L(I))
  = normalizedBaseQuantityMicros(I)

SUM(link.invoiced_amount_cents for link in L(I))
  = I.net_cents

tax_mode = NO_TAX
  => I.net_cents = I.gross_cents
  => SUM(link.invoiced_amount_cents for link in L(I)) = I.gross_cents
```

`L(I)` must be non-empty, must contain each selected fulfillment at most once, and every member must belong to the same customer/SO line and pass the §35.18.11 per-fulfillment quantity and FINAL-AR amount capacities. Both directions are mandatory: per-source capacity prevents over-allocation, while the equalities above prevent an invoice item from being partially, multiply or silently unallocated. A remaining quantity, remaining cent, duplicate source, excess sum, invalid replay or extra candidate link returns `409 SERVICE_INVOICE_ALLOCATION_NOT_CONSERVED` and leaves zero effects.

Quantity is allocated FIFO over the stable fulfillment order. Amount uses BigInt cumulative-difference allocation against the same item quantity; the final member receives the exact item remainder. Therefore many fulfillments may sum to one invoice item, and one fulfillment may contribute to many invoices, but every individual invoice-item allocation still closes to its own quantity and cents. The complete allocation calculation, both item-level equalities, all source-capacity checks, exact replay/insert, Finance link audit and `DRAFT → POSTED` transition execute in the same caller-owned transaction described in §35.18.11.5. No committed prefix of `L(I)` is possible.

##### 35.18.12.2 Multi-source Credit evidence and current-code defect

Current `createCommercialCreditNote()` is not a valid multi-source A3 allocator. When `header.open_item_id` is null it discovers source open items through `finance_invoice_source_links`, orders them by open-item id, then repeatedly applies `min(unapplied, snapshot.openCents)`. That proves only current open-balance availability. It does not prove how much this invoice actually linked to each source, does not subtract prior invoice-specific Credit allocation per source, and can assign a Credit economic effect to the wrong FINAL AR. §35.18.11.6 already requires common source locking and immutable links, but it did not fully specify this per-source Credit conservation calculation.

The existing frozen carriers are sufficient without schema change:

```text
commercial_credit_notes
  = invoice-level Credit source document and total

financial_credit_adjustments
  = canonical per-open-item economic effects through applyCreditAdjustment()
  = target_open_item_id + amount_cents + status + SALES_CREDIT_NOTE source identity

finance_invoice_source_links
  = immutable proof of this invoice's amount allocated to each FINAL source
```

This preserves the §28.3.0.2 single-path rule and §28.10.1 invoice-level Credit projection. It does not create a fifth economic category, shadow AR, link mutation or second Finance writer.

##### 35.18.12.3 Canonical Service multi-source Credit allocation

For a POSTED Sales Invoice containing `SERVICE_FULFILLMENT` links, Credit creation performs unlocked identity discovery and then acquires the same §35.18.11 Service locks in canonical order: SO lines, fulfillments and FINAL AR rows by stable id, followed by invoice header, immutable invoice links, related POSTED Credit-note rows and their `financial_credit_adjustments`. It re-reads the complete source set after locking; drift or unrecognized evidence is `409 SERVICE_CREDIT_ALLOCATION_EVIDENCE_MISMATCH`. Two Credit transactions and Credit versus POST/VOID therefore serialize on the same source anchors.

For each linked FINAL AR source `S`:

```text
invoiceSourceAmount(S)
  = SUM(finance_invoice_source_links.invoiced_amount_cents
        WHERE invoice_id=current invoice
          AND invoice_side='SALES_INVOICE'
          AND source identity resolves to S)

confirmedRelatedCredit(S)
  = SUM(financial_credit_adjustments.amount_cents
        WHERE side='AR'
          AND source_type='SALES_CREDIT_NOTE'
          AND adjustment belongs to a POSTED commercial_credit_note
              whose source_id=current invoice
          AND target_open_item_id=S
          AND adjustment.status='CONFIRMED')

remainingInvoiceCreditCapacity(S)
  = invoiceSourceAmount(S) - confirmedRelatedCredit(S)
  >= 0
```

Association uses the existing Credit-note identity already carried by each adjustment: one-target Credit uses `source_id=creditNote.id`; multi-target Credit uses the existing deterministic `creditNote.id:<ordinal>` identities and `target_open_item_id`. The writer must resolve these identities exactly, reject duplicate/unknown/orphan adjustments, and never infer allocation from document number or open-item ordering. Reversed adjustments do not count as confirmed related Credit; a header/adjustment reversal-state mismatch fails closed rather than creating new capacity.

The requested Credit gross cents are allocated deterministically over the locked positive `remainingInvoiceCreditCapacity(S)` values using BigInt cumulative-difference proportional allocation; the last source receives the exact remainder. Commit requires:

```text
SUM(candidateCreditAmount(S)) = requested commercial_credit_note.gross_cents

0 <= candidateCreditAmount(S) <= remainingInvoiceCreditCapacity(S)

confirmedRelatedCredit(S) + candidateCreditAmount(S)
  <= invoiceSourceAmount(S)
```

The allocation basis is invoice-specific linked amount, never `open_amount_cents`. `applyCreditAdjustment()` remains the sole economic writer for every non-zero source allocation. Its existing applied/unapplied split may reflect collections or other open-item effects, but that split cannot change the invoice/source entitlement above. Credit-note insert, voucher, every `applyCreditAdjustment()`, invoice credit projection and audit commit in one transaction; any shortage or mismatch rolls all of them back.

Legacy single-source and non-Service Credit behavior is not redesigned. A Service-linked invoice whose historical/mixed links or prior Credit adjustments cannot produce the complete exact mapping above fails `409 SERVICE_CREDIT_ALLOCATION_EVIDENCE_MISMATCH`; it must not fall back to the current open-balance greedy loop. Links are never updated or deleted, Credit does not release A3 invoice quantity/amount capacity, and VOID remains prohibited while active Credit exists.

##### 35.18.12.4 Executable acceptance proof and final boundary

| Proof | Required future assertion after separate Stage D authorization |
|---|---|
| Item quantity conservation | two or more fulfillment allocations sum exactly to each Service invoice item's normalized micros; under/over/extra allocation is 409 with zero effects. |
| Item amount conservation | allocations sum exactly to item net cents and, under NO_TAX, gross cents; BigInt remainder is exact on SQLite/MySQL. |
| Cross-invoice conservation | one fulfillment across multiple invoices satisfies every item equality and the shared fulfillment quantity/FINAL-AR amount caps. |
| SO-line ambiguity | two Service invoice items for one SO line fail before link/audit/header mutation. |
| Credit source cap | each adjustment is no greater than this invoice's linked cents for its target FINAL AR minus prior confirmed related Credit. |
| Credit total conservation | per-source adjustment cents sum exactly to the Credit-note gross cents without using open balance as allocation authority. |
| Credit concurrency | independent multi-source Credit sessions and Credit versus POST/VOID serialize on the common Service source locks; losers roll back without partial note/voucher/adjustment/projection/audit effects. |
| Evidence failure | orphan, duplicate, unknown or non-reconstructable historical source allocation fails closed; no greedy fallback and no link mutation. |

The existing §35.18.11 primary-key, five-tuple, replay, canonical-writer and source-capacity contracts remain unchanged. No frozen Finance Credit business rule is replaced: this addendum preserves `commercial_credit_notes → applyCreditAdjustment() → financial_credit_adjustments`, invoice-level credit-state conservation, and the prohibition on orphan effects. The current carriers can represent the bounded Service allocation, so `EXTERNAL_CONTRACT_REQUIRED` is not raised. If Stage D evidence later proves that exact Credit-note-to-adjustment association or the common lock cannot be implemented on both SQLite and MySQL without schema or frozen-semantic change, implementation must stop and return `EXTERNAL_CONTRACT_REQUIRED` rather than weaken these equations.

**Final conservation status: `WAVE8_STAGE_C_FINAL_ACCEPTANCE_READY`. Hard Stop: no Implementation, test/build/migration/database/Git operation is authorized.**

---

### 35.19 Wave 8 V21 Historical Position Evidence Carrier Design

> Authorization: the user's `WAVE8_STAGE_C_V21_EVIDENCE_CARRIER_DESIGN` instruction dated 2026-10-19, following acceptance of `document.md`'s bounded V21 Historical Position Evidence Amendment. This subsection is Design-only. It does not authorize Implementation, migration execution, tests, builds, database access or Git writes.
>
> Supersession boundary: this subsection supersedes only the conflicting statements in §35.18.2, §35.18.7, §35.18.8 and §35.18.10 that prohibit every existing-table extension or say that no V21 schema extension is required. Exactly four Wave 8 business tables remain. The sole existing-table exception is the additive `inventory_mutation_log` evidence extension defined here. Frozen §27 position identity, V21 writer ownership, Wave 6/7 semantics and all other §35.18 decisions remain active.

#### 35.19.1 Confirmed defect and carrier decision

The V21 mutation-time authority has the complete normalized position tuple, but the committed carriers currently split and lose critical facts:

- `inventory` is current balance, not immutable history;
- `inventory_transactions` proves physical direction and quantity but the active writer does not persist bin/owner/status/position key/source item;
- `tracked_inventory_movements` proves transaction-linked warehouse/LOT/SERIAL tracking but not bin/owner/status or movement group;
- valuation movements prove cost by inventory transaction but valuation pools are warehouse/product and optional LOT/SERIAL, never bin history;
- the current `inventory_mutation_log` owns the unique idempotency key and movement-group correlation but lacks source item, position snapshots, exact transaction references and semantic replay comparison.

`position_key` is a one-way SHA-256 digest. It is suitable for lookup and verification but cannot reconstruct its source tuple. Therefore neither the key alone nor any join over current rows can meet B1/B5. Audit summary, remark and current commercial-location mapping remain non-authoritative.

The final carrier is the existing Inventory-owned `inventory_mutation_log`. It remains one row per `applyInventoryMutation()` call. It is not a stock ledger and carries no independent quantity balance. `movement_group_id` remains a non-unique correlation id; `inventory_mutation_log.id` remains the unique mutation-row identity.

#### 35.19.2 Final additive physical schema

The following nine nullable columns are added to `inventory_mutation_log`; no other existing table receives a Wave 8 evidence column:

| Column | SQLite | MySQL 8 | Meaning |
|---|---|---|---|
| `source_item_id` | `TEXT NULL` | `VARCHAR(128) NULL` | Canonical business source item; for all three Consignment sources this is `consignment_commercial_lines.id`. |
| `from_position_key` | `TEXT NULL` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL` | Recomputed key of the validated source snapshot. |
| `to_position_key` | `TEXT NULL` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL` | Recomputed key of the validated destination snapshot. |
| `from_position_identity_json` | `TEXT NULL` | `LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL` | Canonical UTF-8 V1 source snapshot text. |
| `to_position_identity_json` | `TEXT NULL` | `LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL` | Canonical UTF-8 V1 destination snapshot text. |
| `out_inventory_transaction_id` | `TEXT NULL REFERENCES inventory_transactions(id)` | `VARCHAR(128) NULL`, FK | Exact physical OUT row generated by this mutation. |
| `in_inventory_transaction_id` | `TEXT NULL REFERENCES inventory_transactions(id)` | `VARCHAR(128) NULL`, FK | Exact physical IN row generated by this mutation. |
| `request_fingerprint` | `TEXT NULL` | `CHAR(67) CHARACTER SET ascii COLLATE ascii_bin NULL` | `V1:` followed by 64 lowercase SHA-256 hex characters. |
| `evidence_schema_version` | `INTEGER NULL` | `TINYINT UNSIGNED NULL` | `1` for complete evidence; NULL only for legacy/non-evidence rows. |

Why both keys and JSON are retained: the explicit keys provide bounded indexed resolution/current-position locking; the JSON is the minimum reversible carrier for the complete eight-dimension tuple. Why both transaction ids are retained: timestamp/source joins cannot distinguish multiple calls in one movement group, while the two ids directly identify the physical legs and, through existing `tracked_inventory_movements.transaction_id` and `inventory_valuation_movements.inventory_transaction_id`, their tracking and value evidence.

For a new Consignment row, the evidence shape is all-or-nothing:

```text
common:
  source_item_id, request_fingerprint, evidence_schema_version=1 NOT NULL

HANDOFF / RETURN (MOVE):
  from snapshot/key/out transaction NOT NULL
  to snapshot/key/in transaction NOT NULL

SETTLEMENT (OUT):
  from snapshot/key/out transaction NOT NULL
  to snapshot/key/in transaction NULL
```

New nullable foreign keys use the database default `ON DELETE RESTRICT` behavior. The following additive indexes are exact:

```text
UNIQUE uq_inventory_mutation_log_out_tx(out_inventory_transaction_id)
UNIQUE uq_inventory_mutation_log_in_tx(in_inventory_transaction_id)

INDEX idx_inventory_mutation_log_group_item(
  movement_group_id, source_type, source_id, source_item_id, id
)

INDEX idx_inventory_mutation_log_consumption(
  source_type, source_item_id, from_position_key, business_date, id
)
```

Both engines permit multiple NULL values in the two unique transaction indexes; every non-null transaction id can belong to exactly one mutation row. No uniqueness is placed on `movement_group_id`, source item or position key.

Additive validation/immutability triggers apply only when `source_type IN ('CONSIGNMENT_HANDOFF','CONSIGNMENT_SETTLEMENT','CONSIGNMENT_RETURN')`:

1. BEFORE INSERT enforces the complete shape above, positive quantity, V1 evidence version, valid canonical JSON, key/JSON equality and fingerprint format.
2. BEFORE UPDATE and BEFORE DELETE reject the operation. Consignment evidence is insert-once; there is no ordinary repair route.
3. Application validation additionally parses and canonicalizes the snapshot, recomputes its position key with the frozen §27 algorithm, verifies transaction direction/source/quantity, and rejects unknown JSON fields or versions. DB JSON functions validate structure; SHA-256 recomputation remains in the single V21 application implementation so SQLite/MySQL do not acquire divergent hash logic.

Other historical/current V21 callers may leave all nine fields NULL and retain their existing replay behavior. A partial mixture of evidence fields is never legal for a Consignment row.

#### 35.19.3 Position Snapshot V1 and canonical serialization

Snapshot V1 is an object with exactly these keys in exactly this order:

```json
{"schemaVersion":1,"productId":"P","warehouseId":"W","binId":null,"ownerType":"ENTERPRISE","ownerId":null,"stockStatus":"AVAILABLE","lotId":null,"serialId":null,"positionKey":"64-lowercase-hex"}
```

Canonicalization rules:

1. The writer first resolves and validates product, warehouse, bin, owner, stock status, LOT and SERIAL through V21. Snapshot values come from those authoritative resolved rows, never directly from client JSON.
2. Required IDs are non-empty strings no longer than 128 characters. Nullable dimensions are present with JSON `null`; a missing key, empty-string null substitute or extra key is malformed.
3. `ownerType` and `stockStatus` use their canonical uppercase codes. ENTERPRISE always has `ownerId:null`.
4. Product/warehouse/bin/owner/LOT/SERIAL IDs retain the authoritative database identifier text. The frozen §27 normalizer is applied when recomputing `positionKey`; this subsection does not change its lowercase/sentinel/hash rules.
5. Serialization is UTF-8 `JSON.stringify` over a freshly constructed ordered object, with no insignificant whitespace. Readers never trust database-native JSON rendering: they parse, validate, rebuild the ordered object and reserialize.
6. `positionKey` must equal `computePositionKey()` over the other eight fields. Unknown version, invalid JSON, unknown/extra/missing field, invalid null placement or hash mismatch returns `409 CONSIGNMENT_POSITION_EVIDENCE_INVALID`.
7. Snapshot JSON contains no quantity or money. For the replay payload, base-UOM quantity is represented as a decimal string of safe integer micros; cents are decimal strings of safe integers. No float or localized decimal text enters the fingerprint.

The selected storage is TEXT, not native MySQL JSON. This preserves the canonical bytes written by the application, avoids MySQL JSON key reordering/number rendering differences and gives SQLite/MySQL the same read contract. SQLite uses `json_valid()` and MySQL uses `JSON_VALID()` in the additive insert validation trigger; comparison and hashing always use application-level recanonicalization rather than database text equality.

#### 35.19.4 Versioned request fingerprint and replay

For each Consignment partition the Inventory writer constructs, in this exact order, a V1 canonical payload:

```text
fingerprintVersion
sourceType
sourceId
sourceItemId
movementGroupId
movementKind
quantityMicros                 -- canonical base-UOM integer string
businessDate                   -- YYYY-MM-DD
fromPosition                   -- canonical V1 object or null
toPosition                     -- canonical V1 object or null
trackingMode                   -- CANONICAL_STRICT
valuationMode                  -- EXTERNAL_STRICT
valuationPolicy                -- HANDOFF_VALUE_NEUTRAL_V1 /
                                  SETTLEMENT_COGS_V1 /
                                  RETURN_VALUE_NEUTRAL_V1
commercialAmountCents          -- settlement/return canonical integer string;
                                  null when no commercial amount exists
```

The ordered object is serialized by the same UTF-8/no-whitespace rule and hashed as lowercase SHA-256; persisted form is `V1:<hex>`. `idempotency_key` is not inside the payload because it scopes the lookup; actor, remark, source number, request transport and timestamps are excluded because they do not alter inventory/economic effect. The outer Consignment writer derives micros/cents from locked authoritative commercial facts and passes a typed internal context; arbitrary client context is never fingerprint authority.

Replay sequence occurs inside the caller-owned transaction:

1. lock the row by existing unique `idempotency_key` (`FOR UPDATE` on MySQL; SQLite transaction serialization);
2. if absent, execute once and insert physical/tracking/valuation/evidence atomically;
3. if present and it is a complete Consignment V1 row, recanonicalize stored snapshots, compare every readable source/kind/quantity/date/group/key/transaction invariant, and compare the recomputed request fingerprint;
4. exact equality returns the original mutation id, movement group, snapshots, transaction ids, tracked rows and valuation rows; it writes nothing;
5. any semantic mismatch returns HTTP 409 `INVENTORY_MUTATION_IDEMPOTENCY_CONFLICT`; stored evidence is never overwritten and no second movement is generated.

SHA-256 collision is not treated as permission to replay: any readable-field disagreement with an equal digest is the same 409. A malformed stored payload or a digest that cannot be recomputed is `CONSIGNMENT_MUTATION_EVIDENCE_INVALID`, not a new insert.

Legacy compatibility is intentionally asymmetric:

- a pre-extension row with NULL fingerprint/evidence keeps the historical replay contract for non-Consignment callers;
- a Consignment request that finds a same-key legacy/partial row fails `409 CONSIGNMENT_LEGACY_EVIDENCE_UNAVAILABLE`;
- no fingerprint, snapshot or transaction association is backfilled or guessed;
- existing `idempotency_key` values and uniqueness are unchanged.

#### 35.19.5 Mutation, group, source, physical, tracking and valuation graph

The authoritative graph is:

```text
consignment_commercial_lines.id
  └─ source_item_id
     + consignment line.handoff_movement_group_id
       └─ inventory_mutation_log.id (one row per partition call; many per group)
          ├─ from_position_key + V1 snapshot
          ├─ to_position_key   + V1 snapshot
          ├─ out_inventory_transaction_id
          │   ├─ inventory_transactions(direction='OUT')
          │   ├─ tracked_inventory_movements(transaction_id=OUT id)
          │   └─ inventory_valuation_movements(inventory_transaction_id=OUT id)
          └─ in_inventory_transaction_id
              ├─ inventory_transactions(direction='IN')
              ├─ tracked_inventory_movements(transaction_id=IN id)
              └─ inventory_valuation_movements(inventory_transaction_id=IN id)
```

Every joined physical/tracking/value row must match source type/id/item, product, warehouse, LOT/SERIAL, direction and quantity appropriate to its snapshot. Handoff/Return use distinct OUT and IN valuation movement types so each leg is independently identifiable. The mutation log remains the bin/owner/status history authority; valuation balance must never be interpreted as bin history.

V21's strict Consignment branch must call a transaction-inheriting tracking primitive for each physical leg. That primitive updates canonical LOT balance/SERIAL lifecycle and writes the `tracked_inventory_movements` row carrying the exact inventory transaction id. The current generic `writeTrackedMovement()` evidence-only insert is insufficient by itself because it does not update LOT balance or SERIAL current state. Stage D must converge this branch inside the canonical Inventory writer; Sales must not write tracking tables directly.

#### 35.19.6 Complete multi-partition Handoff example

Example line `CL-10` contains four base units of one SERIAL-tracked product `P-S`. Its serials also carry canonical LOT identity. The commercial line uses its approved SERIAL path; V21 evidence, not a Sales serial table, owns the serial/LOT partitions. Source warehouse `MAIN` is bin-enabled; destination consignment warehouse is `CON-WH`, bin `C-01`.

| Mutation row | Stable key | Source position | Destination position | Qty micros | Physical txs | Tracking/value evidence |
|---|---|---|---|---:|---|---|
| `M1` | `CONSIGNMENT_HANDOFF:CL-10:<client>:001` | MAIN/B-A, LOT-L1, SER-001 | CON-WH/C-01, LOT-L1, SER-001 | 1000000 | `T1-OUT`, `T1-IN` | two transaction-linked tracking rows; strict issue/receive value pair |
| `M2` | `...:002` | MAIN/B-A, LOT-L1, SER-002 | CON-WH/C-01, LOT-L1, SER-002 | 1000000 | `T2-OUT`, `T2-IN` | same pattern, distinct serial/position keys |
| `M3` | `...:003` | MAIN/B-B, LOT-L2, SER-003 | CON-WH/C-01, LOT-L2, SER-003 | 1000000 | `T3-OUT`, `T3-IN` | same pattern |
| `M4` | `...:004` | MAIN/B-B, LOT-L2, SER-004 | CON-WH/C-01, LOT-L2, SER-004 | 1000000 | `T4-OUT`, `T4-IN` | same pattern |

All four rows use `source_type=CONSIGNMENT_HANDOFF`, `source_id=<document-id>`, `source_item_id=CL-10`, the same `movement_group_id=G-HO-10`, `movement_kind=MOVE`, ENTERPRISE/null owner and AVAILABLE status. Each serial is quantity one and has a distinct from/to position key. The line stores only `G-HO-10`; resolution loads all four mutation rows by group/source/item and recovers every destination without reading the current location mapping.

For a LOT product, multiple calls may also share one LOT while differing by source bin. Such calls remain separate mutation rows and transaction pairs. LOT tracking may aggregate at its existing warehouse/LOT balance dimension, but the mutation rows preserve each physical bin leg. Partitions may be merged for entitlement calculation only when `(source_item_id,to_position_key)` is identical; different bin, owner, status, LOT or SERIAL means a different position key and can never merge.

#### 35.19.7 `resolveConsignmentHandoffEvidence` and partition entitlement

`server/modules/consignment.js` owns the Sales orchestration and calls an Inventory-owned read/validation helper; it does not parse arbitrary JSON itself. Responsibility name:

```text
resolveConsignmentHandoffEvidence(db, {
  documentId, lineId, handoffMovementGroupId, requestedMicros,
  selectedLotIds, selectedSerialIds, operation
})
```

Resolution, under the locked commercial line, is:

1. Load all complete `CONSIGNMENT_HANDOFF` mutation rows matching group, document and line, ordered by `(business_date,created_at,id)`; reject none, partial evidence, duplicate transaction references, wrong kind, wrong ownership/status/product or inconsistent snapshots.
2. Verify both transaction legs and their tracking/valuation corroboration. The Handoff destination snapshot is the historical candidate; no commercial-location warehouse/bin field is consulted.
3. Build entitlement buckets keyed by `(lineId,to_position_key)`. Multiple Handoff rows with an identical key may sum; different keys remain separate. SERIAL buckets are necessarily one serial identity and one unit per Handoff mutation.
4. Load committed `CONSIGNMENT_SETTLEMENT` and `CONSIGNMENT_RETURN` mutation rows with the same `source_item_id=lineId`; validate their V1 evidence and group them by `from_position_key`.
5. For each bucket:

```text
handoffMicros(position)
  = SUM(complete Handoff row quantityMicros whose to_position_key=position)

consumedMicros(position)
  = SUM(complete Settlement/Return row quantityMicros
        whose from_position_key=position)

entitlementRemainingMicros(position)
  = handoffMicros(position) - consumedMicros(position)
```

Negative, orphan or over-consumed evidence is `409 CONSIGNMENT_PARTITION_EVIDENCE_MISMATCH`. Commercial remaining quantity is checked independently from the sum of bucket entitlement. Current V21 balance is a third, independent check.

Different Consignment lines that share one physical V21 position never share entitlement: `source_item_id` separates their histories. They still contend on and consume the same current inventory row, so the V21 position lock prevents physical overspend. Other lawful V21 operations may move stock out of that shared position; entitlement is therefore neither reservation nor proof of current availability.

Deterministic allocation:

- explicit SERIAL requests must name exact outstanding serial ids; no serial FIFO substitution is allowed;
- explicit LOT requests are restricted to matching outstanding LOT buckets;
- otherwise eligible buckets sort by `(handoff business_date, handoff created_at, handoff mutation id, to_position_key)` and consume FIFO;
- within one identical-position bucket, immutable Handoff rows use the same order for reconstructed attribution;
- a partial consumption creates one new Settlement/Return mutation row for each selected position portion; its from key identifies the consumed bucket exactly;
- replay returns those same rows through their deterministic partition idempotency keys.

No fifth allocation table is necessary because the immutable Handoff additions and immutable per-position Settlement/Return subtractions reconstruct the entitlement exactly. If Stage D finds any legal command that cannot be mapped to exactly one `from_position_key` per physical mutation, it must stop; it may not fall back to line total or current inventory total.

#### 35.19.8 Current-position revalidation, locks and concurrency

Historical snapshots identify candidates only. Before any new physical mutation the resolver reconstructs and validates every V1 snapshot, then the outer transaction locks/re-reads in this order:

```text
1. consignment document id
2. consignment line ids ASC
3. referenced commercial-location rows ASC (mapping is not history authority)
4. selected inventory_mutation_log rows by (movement_group_id,id) ASC
5. current inventory positions by deduplicated position_key ASC
6. LOT ids / SERIAL ids ASC and tracking balance/lifecycle evidence
7. inventory_locks / reservation and stock-status dependencies
8. valuation balance keys ASC and prior valuation evidence
9. Finance source/open-item locks in the existing Finance-owned order (Settlement only)
10. business state, audit and command-idempotency result
```

Every current source position must exist and be active; match product/bin/owner/status/LOT/SERIAL and the recomputed key; remain ENTERPRISE/null owner and AVAILABLE/issuable/transferable as applicable; have sufficient unlocked physical quantity; pass inventory and accounting period gates; and have complete tracking plus authoritative POSTED valuation balance. SERIAL must be AVAILABLE at the exact warehouse with quantity one and the exact lot when present. LOT must exist, match product, be AVAILABLE/not expired and have sufficient warehouse/LOT balance. Failure is closed before any committed effect.

R-SAL-20 settlement-versus-settlement and R-SAL-21 settlement-versus-return first serialize on the line entitlement, then on identical current position keys. Different lines sharing a position serialize at the position. A generic V21 movement that wins first changes current authority and causes the Consignment operation to re-read or fail; historical entitlement is not consumed unless the new mutation commits. MySQL proof requires real independent connections; SQLite uses the repository's single `BEGIN IMMEDIATE` writer serialization.

#### 35.19.9 Strict tracking, valuation and atomicity

All Consignment partition calls inherit the single outer transaction and database connection. Runtime DDL is forbidden. The existing `ensureLogTable()` path inside `applyInventoryMutation()` must be removed; schema creation/upgrade occurs only in the canonical migration lifecycle.

Handoff and Return, per partition:

```text
physical MOVE: exact OUT tx + exact IN tx
tracking:       transaction-linked OUT + IN; LOT/SERIAL state conserved
valuation OUT: issueValue(source pool, OUT tx) -> exact issued cents
valuation IN:  receiveValue(destination pool, IN tx, same exact cents)
proof:          net physical quantity = 0; net valuation quantity = 0;
                net value cents = 0; owner remains ENTERPRISE
```

Settlement, per partition:

```text
physical OUT + transaction-linked tracking OUT
issueValue(exact historical/current identity, OUT tx)
reject LEGACY_UNVALUED or missing/insufficient pool
balanced voucher DR COGS / CR inventory for exact issued cents
Finance DIRECT event for locked commercial event cents
```

`inventory_valuation_balances` is verified as warehouse/product plus LOT or SERIAL according to the frozen valuation method; it has no bin dimension. For a same-warehouse bin MOVE, OUT and IN use the same valuation pool and exact cents, leaving the pool unchanged after the pair. This is valid value conservation, not evidence of physical bin history. The V1 snapshots and physical transaction ids remain the bin history authority.

The canonical writer must return strict tracking and valuation row ids with its mutation result. The caller verifies every leg before updating commercial cumulative values. Best-effort swallowed valuation is prohibited: Consignment always uses `valuationMode=EXTERNAL_STRICT`; any `LEGACY_UNVALUED`, tracking, valuation, voucher, Finance, audit or evidence failure throws and rolls back physical rows, evidence and all business effects together.

#### 35.19.10 Migration and cross-engine parity

Migration is additive and ordered with Inventory V21 schema reconciliation before Wave 8 business migration use:

1. fresh bootstrap creates the extended table, FKs, indexes and triggers directly;
2. existing databases add each nullable column only when absent, then create missing indexes/triggers and verify exact metadata;
3. repeated execution observes an equivalent object and performs no write; a same-named incompatible column/index/trigger/FK fails closed rather than dropping or replacing it;
4. existing rows remain byte-for-byte unchanged with NULL evidence columns;
5. no table rebuild, DROP, guessed backfill, startup repair or historical economic rewrite is allowed.

SQLite uses TEXT/INTEGER plus `json_valid`, explicit indexes and `RAISE(ABORT,...)` triggers. MySQL uses the types/collations in §35.19.2, InnoDB FKs, `JSON_VALID`, named indexes and `SIGNAL SQLSTATE '45000'` triggers. Metadata assertions cover column type/nullability/collation/order, FK targets, unique/non-unique index order and trigger presence. JSON semantics are proven by application recanonicalization, not engine rendering.

Replay concurrency is protected by the existing unique idempotency key plus the locked lookup. Two first-use sessions may both initially see absence; only one can insert the unique key. The losing transaction must catch the duplicate inside the canonical command boundary, roll back its uncommitted physical work, begin/re-enter the safe replay read as the repository adapter permits, and return the committed row only after exact fingerprint validation. It may never translate a duplicate-key race into a second movement or a generic success.

#### 35.19.11 Acceptance mapping and exact Stage D impact

No new global SC, Invariant, UAT, Race or Audit CAP id is created. Future Stage D must extend the existing R-SAL-20, R-SAL-21, R-SAL-22, UAT-S-26/27, S18 and V21 acceptance evidence with:

| Existing identity | Required proof |
|---|---|
| UAT-S-26 / S18 | single-position Handoff; multi-position/two-bin Handoff; multi-LOT; multi-SERIAL; one group/many mutation rows; historical destination resolution after location change; exact transaction/tracking/value graph. |
| UAT-S-27 / S18 | inactive-location historical settlement/return; explicit return destination; legacy/malformed/hash-mismatch fail closed; no mapping inference; no AR/refund for unsettled return. |
| R-SAL-20 | same line settlement ×2; different lines sharing one V21 position; commercial capacity sufficient but partition entitlement insufficient; current physical balance insufficient. |
| R-SAL-21 | Settlement vs Return consumes one entitlement at most once; deterministic partial/FIFO and explicit SERIAL behavior; all losing paths have zero effects. |
| V21 idempotency | same-key/equal semantic replay returns identical mutation/evidence ids; changed position/quantity/date/mode/policy/amount returns 409; concurrent first use commits once. |
| V21 tracking/value | LOT/SERIAL lifecycle and balances; same-warehouse different-bin value-neutral MOVE; cross-warehouse exact cents; valuation failure rolls back every layer. |
| SQLite/MySQL | fresh, existing additive upgrade, repeated migration, metadata parity, trigger enforcement and protected independent-session concurrency. |
| R-SAL-22 | unchanged Service Fulfillment/Gate/Finance regression within the combined Wave 8 gate. |

Wave 6/7 and all non-Consignment V21 callers require regression proving that nullable evidence columns and the scoped replay branch do not alter their legal behavior. No skipped assertion or test reclassification is permitted.

Exact future file scope after separate Stage D authorization:

```text
server/migrations/inventory-position-schema.js
  additive SQLite columns/FKs/indexes/triggers; remove no history

server/database/mysql-schema.js
  MySQL physical mapping/reconciliation/metadata assertions

server/lib/inventory-position.js
  canonical V1 snapshot build/parse/recanonicalize/key verification

server/lib/inventory-mutation.js
  strict Consignment fingerprint/replay, exact transaction references,
  complete replay result, no transaction-time DDL

server/modules/traceability-quality.js
  transaction-inheriting strict LOT/SERIAL leg primitive used by V21

server/modules/financial-inventory.js
  strict caller-owned issue/receive result and LEGACY_UNVALUED rejection;
  no valuation-method redesign

server/modules/consignment.js
  Handoff orchestration, resolveConsignmentHandoffEvidence,
  partition entitlement/allocation, Settlement/Return atomic workflows

server/migrations/sales-customer-wave8-service-consignment.js
  four business tables remain; only integration assertions if required,
  no fifth table and no evidence columns here

server/migrations/sales-customer-domain.js
server/sales-customer-wave0-migration-runner.test.js
  ordered migration/replay proof

focused Wave 8/V21 migration, functional, rollback and replay tests
protected MySQL integration/concurrency workers and suite registration
```

The existing Stage D worktree is preserved but incomplete against this design. In particular, the current source allowlist is only a partial C2 step; the current mutation-log row/replay result, transaction-time DDL, evidence-only tracking insert and swallowed valuation branch do not satisfy this contract. They must be amended, not treated as PASS.

#### 35.19.12 Remaining limits, rollback and resume gate

The selected carrier accurately expresses every required historical position, transaction, replay and per-position entitlement responsibility. No new schema blocker remains for the approved Wave 8 core.

Declared fail-closed limits remain:

- legacy/partial Consignment evidence;
- unknown snapshot/fingerprint version or noncanonical JSON;
- missing/ambiguous transaction/tracking/valuation joins;
- an operation that cannot identify an exact historical `from_position_key`;
- current stock/tracking/valuation no longer available despite remaining commercial entitlement;
- tax/UOM/economic scenarios already excluded by §35.18.

Schema rollback means application rollback while retaining nullable additive columns/indexes/triggers and any committed evidence; destructive down-migration or deletion is not authorized. No historical fact is rewritten.

Stage D may resume only after explicit user acceptance of this §35.19 Design and a separate Implementation authorization. This Design does not execute or validate the implementation and does not alter the current Hard Stop.

**Final status: `WAVE8_STAGE_C_V21_EVIDENCE_DESIGN_DELIVERED — AWAITING_USER_ACCEPTANCE`. Hard Stop.**

---

## 35.22 Wave 8 Residual Stage C Technical Design (2026-10-21)

> This section is the executable Technical Design for the accepted `document.md` Wave 8 Residual
> Requirement Amendment R1/R2/R3 (2026-10-21). It implements that amendment; it does not reopen it and
> does not change any approved §35.18/§35.19/§35.21 contract, any frozen §28–§30 Finance/Inventory
> semantic, or the Wave 6/7 freeze baseline. **Zero new tables and zero new columns** are introduced.
> R3 does include the bounded collation DDL that R3.2 authorized. This section authorizes no source,
> migration, test, frontend, configuration or database change and no Git operation; Stage D is not
> resumed.

### 35.22.1 Design inputs verified against the current code

| Fact | Location | Design consequence |
|---|---|---|
| `reverseCreditAdjustment()` exists and already fails closed on dependent applications/refunds | `server/modules/settlement-core.js:165-181` | R1 reuses it as the **only** monetary reversal primitive. No new reversal logic. |
| It resolves one credit by exact `(side, source_type, source_id)` and throws a plain `Error`, not `HttpError` | `settlement-core.js:166-168` | R1 must discover the adjustment ids first and pre-validate state to emit the correct `HttpError` codes. |
| A multi-target Service credit writes adjustment `source_id` as `noteId` or `noteId:<n>` | `commercial-golive.js` `applyCreditAdjustment(... sourceId: targets.length === 1 ? id : \`${id}:${index + 1}\`)`; the matching read pattern already exists at `commercial-golive.js:325` | R1 uses the same `source_id = ? OR source_id LIKE ?` convention. No new identity scheme. |
| `reverseSystemVoucher()` reverses by `(originalSourceType, originalSourceId)` and is a no-op when absent | `server/modules/financial-inventory.js:275-288` | R1 reverses `SALES_CREDIT_NOTE` / `SUPPLIER_CREDIT_NOTE` by note id. |
| Invoice credit capacity lives on `credited_amount_cents` / `remaining_creditable_amount_cents`, `credit_state ∈ {NONE,PARTIAL,FULL}` | `server/migrations/v22-finance-wave-c-invoice.js:49-51`; write at `commercial-golive.js` end of `createCommercialCreditNote` | R1 recomputes all three; no new capacity carrier. |
| `voidPostedInvoice` refuses while `credit_state !== 'NONE'` | `commercial-golive.js:430` | R1 must drive `credit_state` back to `NONE` when the last credit is reversed, otherwise invoices become permanently un-voidable. |
| `postSalesInvoice` never locks the SO-line stage; `recordInvoiceLinks` reads the link at `finance-recognition.js:97` before the fulfillment (`:106`) and FINAL AR (`:107`) locks | `server/modules/commercial-golive.js`, `server/modules/finance-recognition.js` | R2 closes the gap with one composable plan, not local reordering. |
| `voidPostedInvoice` performs no SO-line / Fulfillment / FINAL-AR locking | `commercial-golive.js:424-460` | R2 composes the same plan into VOID. |
| MySQL column emission has a per-column charset/collation allowlist keyed by lowercase column name | `server/database/mysql-schema.js:183-196` (`columnDefinition`) | R3's fresh-install fix is a single-line allowlist entry. |
| The four Wave 8 tables are materialized by the shared snapshot reconciliation **before** the Wave 8 migration runs | observed in real MySQL; see `solution.md §35.21.5` | R3 needs a generator fix **and** an additive upgrade, not one or the other. |

### 35.22.2 R1 — Commercial Credit Note Reversal

#### 35.22.2.1 File plan

```text
server/modules/commercial-golive.js   reverseCommercialCreditNote()   new export
server/modules/commercial-golive.js   commercialApiHandler()          one new route branch
server/modules/commercial-golive.js   postSalesInvoice / voidPostedInvoice / createCommercialCreditNote
                                                            R2 plan parameter threading only
server/finance / migration / schema    untouched — no new table, no new column
```

`reverseCommercialCreditNote` reuses only existing exports: `reverseCreditAdjustment`, `reverseSystemVoucher`,
`openItemSnapshot`, `atomic`, `assertFinanceBusinessDateOpen`, `assertFinancialPeriodsOpen`, `idempotencyReplay`,
`saveIdempotency`, `requestFingerprint`, `audit`. It introduces no new Finance primitive.

#### 35.22.2.2 State transition

```text
function reverseCommercialCreditNote(db, input)   // input: { id, reversalDate, reason, actorId }
```

1. Validate `reversalDate` (`YYYY-MM-DD`, on or after the note's `credit_date`) and a non-empty `reason`.
2. Reject a duplicate `idempotency_key` on `commercial_credit_notes` — a reversal is a distinct command
   and must not collide with the note's own creation key.
3. Read the note. Missing → `404 COMMERCIAL_CREDIT_NOTE_NOT_FOUND`.
   `status !== 'POSTED'` → `409 COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE`.
4. Discover every adjustment of the note using the established identity convention:
   `source_type = 'SALES_CREDIT_NOTE'|'SUPPLIER_CREDIT_NOTE' AND (source_id = ? OR source_id LIKE ?)`
   with the note's exact `${id}:%` suffix.
5. Require the adjustment set to be non-empty and to sum to `note.gross_cents`
   (the same conservation `serviceCreditTargets` already asserts). Otherwise
   `409 COMMERCIAL_CREDIT_REVERSAL_EVIDENCE_MISMATCH`.
6. Require every adjustment to be `CONFIRMED`. A `REVERSED` adjustment is
   `409 COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE`, never a silent success.

#### 35.22.2.3 Dependency pre-validation

Before any state is written, and beneath the stage-1/2 locks, verify each blocking condition from R1.3 and
report it as `409 COMMERCIAL_CREDIT_REVERSAL_BLOCKED` with a `reason`:

| Reason | Probe |
|---|---|
| `BALANCE_APPLICATION_OR_REFUND` | For the derived `CREDIT` balance of each adjustment, any `balance_applications` or `financial_refunds` row with `status='CONFIRMED'`. `reverseCreditAdjustment` re-checks this itself; R1 surfaces it first with the right code. |
| `RETURN_REVERSAL_CONSUMED` | Any `credit_reversal_components` row for the adjustment with `applied_cents > 0` or `unapplied_cents > 0`. |
| `OPEN_ITEM_WOULD_GO_NEGATIVE` | After the reversal, `openItemSnapshot(side, target_open_item_id).openCents` must be `>= 0`. |
| `PERIOD_CLOSED` | `assertFinanceBusinessDateOpen` + `assertFinancialPeriodsOpen` for both `credit_date` and `reversalDate`. |

#### 35.22.2.4 Lock order and transaction shape

The caller owns one transaction. `reverseCommercialCreditNote` uses `atomic(db, ...)` so it composes both
as a standalone command and as an inner step.

```text
0. plan = discoverCreditReversalPlan(db, input.id)      // unlocked, no decision, no mutation
1. SELECT id FROM account_receivables|account_payables WHERE id IN (...) ORDER BY id FOR UPDATE
2. SELECT * FROM financial_credit_adjustments WHERE ... ORDER BY id FOR UPDATE
   SELECT * FROM settlement_unapplied_balances WHERE balance_type='CREDIT' AND source_id IN (...) ORDER BY id FOR UPDATE
3. SELECT * FROM commercial_credit_notes WHERE id=? FOR UPDATE
   SELECT * FROM sales_invoices|supplier_bills WHERE id=? FOR UPDATE
4. reverseSystemVoucher -> adjustments -> invoice recompute -> idempotency -> audit
```

`discoverCreditReversalPlan` mirrors the existing `discoverSalesPrepaymentGatePlan` shape and returns
`{ noteId, side, sourceId, invoiceId, grossCents, openItemIds, adjustmentIds, balanceIds }`. It is a pure
read; it decides nothing.

Ordering rationale against §35.18.6: the Finance-owned open-item and settlement-balance rows are taken
before the Sales-owned invoice and the Finance credit document, matching the frozen "Finance parents first"
direction. `reverseCreditAdjustment` internally calls `refreshOpenItem` on the target open item, which the
stage-1 lock already owns, so the primitive never acquires an unlocked row.

#### 35.22.2.5 Mutation sequence

Inside the transaction, after the locks and after the dependency probe passes:

1. `reverseSystemVoucher({ originalSourceType: 'SALES_CREDIT_NOTE'|'SUPPLIER_CREDIT_NOTE', originalSourceId: note.id, reversalSourceType: 'SALES_CREDIT_NOTE_REVERSAL'|'SUPPLIER_CREDIT_NOTE_REVERSAL', reversalSourceId: note.id, businessDate: reversalDate, actorId, reason })`.
2. For each discovered adjustment, in id ASC order:
   `reverseCreditAdjustment(db, side, 'SALES_CREDIT_NOTE'|'SUPPLIER_CREDIT_NOTE', adjustment.source_id, actorId, reversalDate, reason)`.
   The derived `CREDIT` balance and `refreshOpenItem` follow inside the primitive.
3. `UPDATE commercial_credit_notes SET status='REVERSED' WHERE id=? AND status='POSTED'`. The status guard
   makes the transition a compare-and-set; a concurrent second reversal affects zero rows and is detected.
4. Recompute the source document:
   `credited = current − note.gross_cents`, `remaining_creditable = gross_cents − credited`,
   `credit_state = credited === 0 ? 'NONE' : (credited === gross_cents ? 'FULL' : 'PARTIAL')`.
   Both amounts must stay `>= 0`, else `409 COMMERCIAL_CREDIT_REVERSAL_BLOCKED` reason
   `INVOICE_CAPACITY_UNDERFLOW`. Recomputing from the *current* stored value rather than from a running
   total keeps the result correct under any prior credit/reversal combination.
5. `saveIdempotency(db, 'COMMERCIAL_CREDIT_REVERSAL', note.id, key, fingerprint, result)` then
   `audit(db, actorId, 'REVERSE', 'COMMERCIAL_CREDIT_NOTE', note.id, reason)`.

Nothing in step 2–5 touches `finance_invoice_source_links`. Historical links stay immutable; they stop
counting only through the credit-status predicate.

Atomicity: any throw rolls back voucher, adjustments, balances, open items, credit note, invoice and audit
together. A durable failed-attempt audit is not promised.

#### 35.22.2.6 API surface

```js
if ((match = path.match(/^\/api\/commercial-credit-notes\/([^/]+)\/reverse$/)) && req.method === 'POST') {
  allow(actor, 'FINANCE_INVOICE_MANAGE');
  return send(res, 200, reverseCommercialCreditNote(db, {
    id: match[1], reversalDate: body.reversalDate ?? body.reversal_date,
    reason: body.reason, actorId: actor.id, idempotencyKey: String(req.headers['idempotency-key'] || '').trim(),
  }));
}
```

Permission is identical to credit creation; **no new permission and no permission-count change**.
`Idempotency-Key` is mandatory — an absent key is `422`.

Error codes: `COMMERCIAL_CREDIT_NOTE_NOT_FOUND`, `COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE`,
`COMMERCIAL_CREDIT_REVERSAL_EVIDENCE_MISMATCH`, `COMMERCIAL_CREDIT_REVERSAL_BLOCKED` (+`reason`),
`COMMERCIAL_CREDIT_REVERSAL_IDEMPOTENCY_CONFLICT`.

#### 35.22.2.7 Idempotency semantics

`idempotencyReplay(db, 'COMMERCIAL_CREDIT_REVERSAL', noteId, key, fingerprint)` runs before the
transaction, exactly as the Wave 8 consignment commands do. An exact replay returns the stored result with
`replayed: true` and performs no mutation. The fingerprint covers `{ reversalDate, reason }`, so the same key
with different content is rejected. Because replay is checked before the state read, a repeated reversal with
a *new* key falls through to step 3 and fails closed as `COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE` — it is never
reported as a fresh reversal.

### 35.22.3 R2 — A3 Invoice Lock Order

#### 35.22.3.1 File plan

```text
server/modules/finance-recognition.js   discoverInvoiceSourcePlan()   new export, unlocked
server/modules/finance-recognition.js   lockInvoiceSourcePlan()       new export, locked, first statement
server/modules/commercial-golive.js     postSalesInvoice / voidPostedInvoice / createCommercialCreditNote
                                                            discover before atomic(), lock as the first inner step
```

`finance-recognition.js` is the canonical A3 linkage owner (`recordInvoiceLinks` already lives there), so
both new functions live beside it. No Finance Engine rewrite; only two additive functions plus three
call-site insertions.

#### 35.22.3.2 Plan shape and discovery

```js
discoverInvoiceSourcePlan(db, invoiceId) => ({
  invoiceId,
  salesOrderItemIds: string[],   // distinct sales_order_items.sales_order_item_id of service-classified invoice items
  fulfillmentIds:    string[],   // distinct CONFIRMED service_fulfillments.id for those SO lines
  finalArIds:        string[],   // distinct FINAL account_receivables.id for those fulfillments
  existingLinkKeys:  string[],   // existing finance_invoice_source_links five-tuples for replay
})
```

Discovery is a pure unlocked read. It runs **before** `atomic(...)` in each entry point and decides nothing:
the plan is used only to decide *what to lock*, never to compute capacity.

#### 35.22.3.3 Lock function

`lockInvoiceSourcePlan(db, invoiceId, plan)` is the first inner statement of the caller-owned transaction,
before any other row is touched:

```text
1. SELECT * FROM sales_order_items       WHERE id IN (plan.salesOrderItemIds) ORDER BY id FOR UPDATE
2. SELECT * FROM service_fulfillments    WHERE id IN (plan.fulfillmentIds)    ORDER BY id FOR UPDATE
3. SELECT * FROM account_receivables     WHERE id IN (plan.finalArIds)        ORDER BY id FOR UPDATE
```

Empty sets issue no SQL, so a non-Service invoice pays nothing and behaves exactly as before.

Then re-read the current candidate set with the same unlocked query used for discovery and compare:

| Relation | Meaning | Action |
|---|---|---|
| current ⊋ planned | a new SO line / CONFIRMED fulfillment / FINAL AR appeared after discovery | throw retryable `409 A3_INVOICE_SOURCE_PLAN_STALE`; the caller rolls back and retries from discovery. The un-locked new candidate is never allowed to proceed. |
| current ⊊ planned | a planned row no longer qualifies | proceed. Capacity is recomputed by the existing unlocked-then-locked `SUM` joins, never from the plan, so under-locking here cannot over-allocate. |
| equal | — | proceed. |

Growth is the practically expected direction because `confirmServiceFulfillmentCommand` takes the same
Fulfillment lock and can commit between discovery and lock.

#### 35.22.3.4 Composition into POST / VOID / Credit

```js
export function postSalesInvoice(db, invoiceId, actorId) {
  const plan = discoverInvoiceSourcePlan(db, invoiceId);          // unlocked
  return atomic(db, () => {
    lockInvoiceSourcePlan(db, invoiceId, plan);                   // FIRST lock
    ... existing body unchanged ...
  });
}
```

Identical threading for `voidPostedInvoice` and `createCommercialCreditNote`. `recordInvoiceLinks` keeps
its current body; because the fulfillment and FINAL AR locks are already held by the caller, its inner
`FOR UPDATE` statements become no-ops rather than a new edge, and its link read at `:97` is now performed
under the invoice lock taken at stage 4 of the plan.

Retry discipline: the caller retries from discovery only. A retry never adds a Finance lock that was absent
from the plan, never acquires an invoice/link lock before the Sales-stage locks, and is bounded by the
existing `mysqlTransactionRetryLimit`.

#### 35.22.3.5 C1 compatibility proof

| Path | Order | Edge? |
|---|---|---|
| Service CONFIRM | C1 parents (§35.18.6 step 1) → Fulfillment → SO line → FINAL AR | Fulfillment before SO line. R2's plan also locks SO line before Fulfillment — see below. |
| Invoice POST | SO line → Fulfillment → FINAL AR → Invoice/Link | no Finance-parent edge; §35.18.6 step 1 is untouched. |
| Credit | SO line → Fulfillment → FINAL AR → credit adjustments → notes → invoice | nested inside the same order. |
| Credit reversal (R1) | FINAL AR → adjustments/balance → credit note → invoice | never re-enters the SO-line or Fulfillment stages, so it cannot invert POST. |
| Finance PREPAYMENT apply/refund/reversal | PREPAYMENT parent → own children | never locks `sales_order_items`/`service_fulfillments`. No cycle. |

**Conflict to resolve.** `confirmServiceFulfillmentCommand` (`service-fulfillment.js:157-160`) currently
takes the Fulfillment lock and *then* the SO-line lock, which is the reverse of R2's stage 1→2. Both orders
are internally consistent, but two paths locking the same pair in opposite orders is a genuine deadlock
risk. §35.18.11.5 and §35.18.4 both name the SO line as the first capacity lock, so the bounded correction
is to move Service CONFIRM's `sourceRow(db, ..., true)` (SO line) ahead of
`getServiceFulfillmentRow(db, actor, id, { forUpdate: true })`. The business assertions, capacity
arithmetic and Finance recognition in that function are untouched.

#### 35.22.3.6 Concurrency acceptance

Real MySQL, ≥2 independent connections, with a control-session barrier used only as an observer:

- POST vs POST on one invoice — one POSTED result, one immutable link set;
- POST vs VOID — exactly one legal terminal state, links immutable either way;
- POST vs Credit — invoice capacity never exceeded, links immutable;
- Credit vs Credit — §35.18.12 allocation conserved, never over-linked;
- Service CONFIRM ×2, and Service CONFIRM vs Invoice POST — one source lock serializes both;
- the C1 regression R-SAL-15 (Service/Delivery vs PREPAYMENT apply/refund/reversal) must stay green.

Explicitly forbidden as proof: the adapter's global transaction gate, and an assertion that only checks that
one request returned 200. Each race must additionally assert commercial remaining, physical balance, audit
and idempotency for the losing side.

### 35.22.4 R3 — MySQL `lot_code_key` binary collation

#### 35.22.4.1 File plan

```text
server/database/mysql-schema.js                              columnDefinition() allowlist entry
server/migrations/sales-customer-wave8-service-consignment.js  ambiguity probe + idempotent ALTER + contract update
server/sales-customer-wave8-mysql-metadata.test.js          fixture + drift coverage
```

Zero new tables, zero new columns. The only DDL is `MODIFY COLUMN ... COLLATE`, which R3.2 authorized.

#### 35.22.4.2 Fresh-install entry point

`columnDefinition()` already emits a per-column suffix for byte-identity keys. Add `lot_code_key` to the
existing `CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin` branch so a fresh MySQL database is created
directly at the target collation and the snapshot reconciliation needs no follow-up DDL.

`utf8mb4_0900_bin` is `NO PAD`, which is the correct MySQL match for SQLite `COLLATE BINARY` byte-exact
comparison — `utf8mb4_bin` is `PAD SPACE` and would treat trailing spaces as equal.

#### 35.22.4.3 Existing-database additive upgrade

Because the table already exists on every real database, `migrateSalesCustomerWave8ServiceConsignment`
must reconcile it before asserting the contract:

```text
0. read information_schema.COLUMNS.COLLATION_NAME for consignment_commercial_lines.lot_code_key
   already utf8mb4_0900_bin  -> no-op (idempotent, repeated startup safe)
   otherwise                 -> ambiguity probe, then MODIFY COLUMN
```

```sql
-- ambiguity probe: values that the current ai_ci collation folds together but binary separates
SELECT document_id, product_id, consignment_commodity_location_id,
       COUNT(DISTINCT lot_code_key)         AS ai_distinct,
       COUNT(DISTINCT BINARY lot_code_key)  AS binary_distinct
FROM consignment_commercial_lines
GROUP BY document_id, product_id, consignment_commodity_location_id
HAVING ai_distinct <> binary_distinct
```

A non-empty result throws `WAVE8_LOT_KEY_COLLATION_AMBIGUOUS` listing the offending identity groups, and
**no DDL runs**. The probe is read-only and safe on any database. If it passes:

```sql
ALTER TABLE consignment_commercial_lines
  MODIFY COLUMN lot_code_key VARCHAR(128)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ''
```

MySQL rebuilds `uq_consignment_lines_identity` automatically. The probe has already proven no group becomes
duplicated, so the rebuild cannot fail on data. No merge, coalesce, delete, case-folding or LOT
re-identification is ever performed; ambiguity is always an operator decision.

#### 35.22.4.4 Contract and parity updates

- `MYSQL_TABLE_CONTRACTS.consignment_commercial_lines.columnCollations.lot_code_key` becomes
  `utf8mb4_0900_bin`, and the assertion stops accepting the recorded deviation.
- `WAVE8_KNOWN_MYSQL_PARITY_GAPS` no longer lists R3. The export is retained only if other gaps remain;
  otherwise it is removed rather than left as an empty lie.
- SQLite is unchanged: it already declares `lot_code_key TEXT COLLATE BINARY`.
- LOT business semantics are untouched: `chk_consignment_line_lot` pairing, FIFO entitlement, SERIAL exact
  identity and immutable handoff evidence all keep their current behavior.

#### 35.22.4.5 Acceptance obligations

1. Fresh MySQL install asserts `lot_code_key` at `utf8mb4_0900_bin` directly from the generator.
2. Existing-database upgrade converges to `utf8mb4_0900_bin` with no data repair and no destructive DDL.
3. Repeated startup is a verified no-op.
4. Ambiguity detection fails closed on seeded case-differing LOT keys and leaves the column unchanged.
5. SQLite/MySQL parity: the same case-differing `lot_code_key` inputs resolve identically on both backends.
6. `pnpm test:mysql` and `pnpm test:mysql:concurrency` stay green; the Wave 8 metadata fixture gains the
   binary-collation drift case.

### 35.22.5 Cross-domain compatibility

| Domain | Effect |
|---|---|
| Frozen §28 Finance | R1 adds a reversal command using only the existing adjustment/balance/voucher primitives. `commercial_credit_notes` gains no column; Finance semantics are unchanged. |
| Frozen §30 Accounting | R1 reverses through `reverseSystemVoucher`, so the reversal voucher is a canonical system voucher with `reversal_of_id`, not a hand-built balancing entry. |
| C1 / §35.18.6 PREPAYMENT | Unaffected. R1 and R2 never take a PREPAYMENT parent, and Finance PREPAYMENT paths never take a Sales or invoice lock. |
| Inventory V21 / §35.19 | Untouched. R3 changes only MySQL comparison semantics of one column; no position key, movement log or evidence column changes. |
| Wave 6/7 frozen contracts | Untouched. R1 creates a new Credit reversal command; it does not alter Settlement, Payment, Write-off or Reservation semantics. |
| Sales Delivery / §35.18.4 | Unaffected except for the Service CONFIRM lock reorder in §35.22.3.5, which changes only lock acquisition order, not business semantics. |

### 35.22.6 Remaining blockers

None inside the approved Requirement. Implementing R1/R2/R3 requires Stage D authorization, which this
section does not grant. R4 (Mobile workflow) remains an unfinished Stage D implementation item and is not
re-designed here.

This section records design only. Stage D is not resumed and no Final Acceptance or Freeze is declared.

## 35.23 Wave 8 SALES Warehouse/Bin Reference Access — Bounded Stage C Design (2026-10-21)

> Requirement authority: `document.md` “Wave 8 Final Closure — SALES Warehouse/Bin Reference Access
> Requirement Amendment”, explicitly accepted by the user as
> `WAVE8_SALES_REFERENCE_REQUIREMENT_ACCEPTED`. This section designs only that bounded amendment. It does
> not authorize implementation, add a permission/table/column, change Inventory V21 identity or ownership,
> or reopen any frozen Wave 6/7 or approved Wave 8 economic semantic.

### 35.23.1 Verified inputs and carrier decision

The current generic master endpoints are not reusable as the browser contract:

| Existing endpoint | Guard | Excess/defect for this use |
|---|---|---|
| `GET /api/warehouses` | `WAREHOUSES_VIEW OR WAREHOUSES_MANAGE` | exposes address, manager and timestamps; standard SALES receives 403 |
| `GET /api/warehouse-bins` | `WAREHOUSE_BIN_VIEW OR WAREHOUSE_BIN_MANAGE` | exposes the generic bin-master lifecycle and is not Consignment-context scoped |

Their handlers, payloads and permission contracts remain unchanged. SALES receives neither warehouse
permission. A dedicated read-only pair owned by `server/modules/consignment.js` is the minimal safe design.
Both routes are bound to an already-addressed business object, return one authoritative warehouse rather
than a warehouse directory, and use only the existing Consignment/Sales authorization model.

No schema carrier is required. `consignment_commercial_documents.source_warehouse_id` is already the
immutable source authority, a line already belongs to one document, `warehouses` already carries active and
bin-enabled state, and `warehouse_bins` already carries active parent-child identity.

### 35.23.2 Exact API surface

Two explicit `GET` routes are added to `ownedRouteTable`:

```text
GET /api/consignment-commercial-documents/:documentId/handoff-position-references
GET /api/consignment-commercial-documents/:documentId/lines/:lineId/return-position-references
```

There is deliberately no `warehouseId` query parameter and no free-standing SALES warehouse search. The
server derives the sole warehouse from the authorized document. The nested Return route prevents a line id
from being silently rebound to a different document.

Handoff response:

```json
{
  "purpose": "HANDOFF",
  "context": {
    "documentId": "...",
    "documentVersion": 1,
    "documentStatus": "DRAFT"
  },
  "warehouse": {
    "id": "...",
    "code": "...",
    "name": "...",
    "binEnabled": true
  },
  "bins": [
    { "id": "...", "warehouseId": "...", "code": "...", "name": "..." }
  ]
}
```

Return response has the same warehouse/bin shape and this context:

```json
{
  "purpose": "RETURN",
  "context": {
    "documentId": "...",
    "documentVersion": 3,
    "documentStatus": "INSTRUCTED",
    "lineId": "...",
    "lineVersion": 2
  },
  "warehouse": { "id": "...", "code": "...", "name": "...", "binEnabled": false },
  "bins": []
}
```

Only active bins are returned, ordered by `code,id`. `bins=[]` is valid when `binEnabled=false`. A
bin-enabled warehouse with no active bin is not an empty successful choice: it returns 409
`CONSIGNMENT_REFERENCE_BINS_UNAVAILABLE`. Neither response includes address, manager, timestamps, stock,
availability, owner/status administration, LOT/SERIAL balance, valuation, cost or configuration fields.
The platform's existing `Cache-Control: no-store` API behavior applies. A reference read writes no business
audit row; the eventual Handoff/Return mutation retains its existing in-transaction audit.

Settlement has no reference endpoint. It continues to resolve `inventory_mutation_log` Position Snapshot
V1 through `resolveConsignmentHandoffEvidence()` and never consults either reference response or a current
commercial-location mapping.

### 35.23.3 Permission and non-enumeration sequence

Both endpoints serve executable mutation forms, so they use the same narrow write authority as those
mutations, not warehouse permissions and not the broader Consignment read permission:

```text
SALES_MANAGE AND CONSIGNMENT_MANAGE
```

`requireWrite(actor)` remains the single expression for this check. `ADMIN` retains the existing
`actorHas` compatibility. `SALES_VIEW`, `CONSIGNMENT_VIEW`, `WAREHOUSES_VIEW` or `WAREHOUSE_BIN_VIEW` alone
does not authorize these routes.

The handler sequence is fixed:

1. platform authentication;
2. `requireWrite(actor)` before any Consignment/warehouse query;
3. load the addressed document; apply `scope(db, actor, document, true)` using the document's saved
   `sales_group_id` and `business_date`;
4. for Return, load the line by both `line.id` and `line.document_id=documentId`;
5. validate workflow state and derive the authoritative warehouse;
6. return only the minimal projection.

No list query is executed before steps 1–4, so cross-group callers cannot enumerate warehouse rows or lines.
The HTTP/error contract is:

| Status | Meaning |
|---|---|
| 401 | missing/expired authentication, using the platform's existing authentication response |
| 403 | missing Sales/Consignment manage permission, unmapped salesperson, disabled group scope or document Sales Group outside the actor's live scope; response contains no warehouse/bin data |
| 404 | document id does not exist after permission validation, or the nested line does not exist on the already-addressed document; generic `CONSIGNMENT_REFERENCE_CONTEXT_NOT_FOUND` |
| 409 | accessible context exists but cannot currently execute the purpose: wrong document state, no remaining line capacity/evidence, inactive warehouse, required active bins unavailable, or inconsistent warehouse/bin master state |

403 bodies remain generic and must not echo the foreign group, customer, warehouse or document identity.
404 never falls back to a global line lookup. The endpoints accept no body and create no idempotency record.

### 35.23.4 Authoritative candidate rules

#### Handoff

The document must be `DRAFT`. The only returned warehouse is the document's saved
`source_warehouse_id`. It must currently exist and be active. If `bin_enabled=1`, only active bins whose
`warehouse_id` equals that source warehouse are returned; at least one must exist. If `bin_enabled=0`, no
bin is returned or accepted.

The response does not promise stock availability. Product, LOT/SERIAL, owner `ENTERPRISE`, owner id NULL,
stock status `AVAILABLE`, locks, quantity and valuation remain V21 mutation-time authority.

#### Return

The document must be `INSTRUCTED` or `PARTIAL_SETTLED`; the addressed line must have positive commercial
remaining quantity and complete Handoff evidence. The only legal Return target warehouse is the same
document's saved `source_warehouse_id`.

This is the authoritative bounded filter: it returns consigned inventory to the enterprise origin recorded
on the business document. Merely selecting every `warehouses.active=1` row, or excluding only
`is_supplier_wip`, would invent a warehouse-purpose model that the current schema does not carry. Supporting
an alternate enterprise return destination would therefore require a future Requirement/schema authority
and is not inferred here.

The source warehouse must still be active. Its bin rules are identical to Handoff. The eventual V21 MOVE
keeps the historical partition's product/LOT/SERIAL, forces `ownerType='ENTERPRISE'`, `ownerId=null` and
`stockStatus='AVAILABLE'`, and replaces only warehouse/bin with this authoritative destination. The
reference route exposes neither the historical source Position nor current physical quantity.

### 35.23.5 Backend functions and mutation-time revalidation

`server/modules/consignment.js` gains two HTTP handlers and bounded private helpers:

```text
getConsignmentHandoffPositionReferences(db,res,actor,documentId)
getConsignmentReturnPositionReferences(db,res,actor,documentId,lineId)
loadConsignmentReferenceContext(...)
projectConsignmentWarehouseReference(...)
lockAndValidateConsignmentPositionReferences(...)
```

The GET helper uses explicit projections only; it must not reuse `listWarehouses` or `listWarehouseBins`
and then trim their response. The same predicate builder is reused by reference reads and mutation
validation so candidate and command semantics cannot drift.

Reference responses are hints, never capabilities. Handoff and Return retain their caller-owned
transactions and revalidate after authoritative rows are locked:

```text
Handoff:
  requireWrite(actor) again inside transaction
  document FOR UPDATE -> scope(write=true) -> state/version
  lines by id ASC FOR UPDATE -> effective commercial locations
  discover authoritative source/destination warehouse+bin ids
  warehouses by id ASC FOR UPDATE -> bins by id ASC FOR UPDATE
  re-check active/bin-enabled/parent membership and request source equality
  V21 mutation/evidence/tracking/valuation -> document/line state -> idempotency/audit

Return:
  requireWrite(actor) again inside transaction
  line+document FOR UPDATE -> scope(write=true) -> state/version/remaining
  authoritative document source warehouse FOR UPDATE -> submitted bin FOR UPDATE
  re-check active/bin-enabled/parent membership and exact target equality
  resolve immutable Handoff evidence -> lock/revalidate current V21 positions
  V21 MOVE/evidence/tracking/valuation -> commercial state -> idempotency/audit
```

`requireWrite(actor)` reasserts the authenticated request authority; `scope(..., true)` re-reads live
salesperson/group membership within the transaction. This bounded work does not create a second global auth
or session-revocation model. Warehouse and bin locks are ordered by id so Handoff partitions cannot reverse
their order. Every value is re-read under those locks; the GET response, `documentVersion` and `lineVersion`
are not trusted as warehouse authority.

The mutation error codes are made explicit without changing success semantics:

```text
CONSIGNMENT_SOURCE_WAREHOUSE_INVALID
CONSIGNMENT_SOURCE_WAREHOUSE_MISMATCH
CONSIGNMENT_SOURCE_BIN_REQUIRED
CONSIGNMENT_SOURCE_BIN_INVALID
CONSIGNMENT_RETURN_DESTINATION_INVALID
CONSIGNMENT_RETURN_DESTINATION_MISMATCH
CONSIGNMENT_RETURN_DESTINATION_BIN_REQUIRED
CONSIGNMENT_RETURN_DESTINATION_BIN_INVALID
```

Any authorization, state, active-flag, parent-membership, evidence, capacity or V21 failure rolls back the
business mutation, evidence, tracking, valuation, Finance, audit and idempotency result together. A GET that
succeeded immediately before such a failure does not weaken the failure.

### 35.23.6 Frontend integration

`src/pages/wave8-sales.jsx` stops requesting `/api/warehouses` for Consignment and removes both remaining
raw bin-id fields.

- Opening a DRAFT document requests its Handoff reference route. The sole warehouse is rendered as a
  labelled fixed choice; a bin select is required only when `binEnabled=true`.
- Opening Return for a line requests the nested Return reference route. The sole origin warehouse is shown
  and the active-bin select follows the same rule.
- Settlement performs no warehouse/bin request and keeps the historical-evidence flow unchanged.
- Context reference state is separate from document list state: loading, empty/impossible 409, 403, stale
  conflict and retry are rendered explicitly. References are cleared whenever document/line/version changes
  and reloaded after every successful mutation.
- The mutation payload remains the current minimal shape. The browser submits the selected ids, but the
  backend derives and verifies their meaning again.

There is no fallback to the generic warehouse APIs, no hidden raw-id input and no client-side expansion to
all warehouses when a reference call fails.

### 35.23.7 Exact implementation file plan

| File | Bounded Stage D change |
|---|---|
| `server/modules/consignment.js` | two reference handlers, minimal projection helper, shared candidate predicate, transaction-time warehouse/bin locks and exact Return-to-origin validation |
| `server/app.js` | import the two handlers and register the two GET routes in `ownedRouteTable` |
| `src/pages/wave8-sales.jsx` | replace generic warehouse loading/raw bin ids with context reference loading and selects |
| `server/sales-customer-wave8-residual.test.js` | focused API/RBAC/field/state/mutation revalidation contracts using real HTTP actors |
| `server/mysql-sales-customer-wave8-concurrency.integration.js` and `scripts/gates/mysql-concurrency-sales-wave8-worker.mjs` | independent-connection stale-reference/state-change race and zero-side-effect assertions |
| `scripts/acceptance/sales-customer-wave8-acceptance.mjs` | real standard SALES Handoff/Settlement/Return browser flow and denied-user flow at four widths |

No migration, schema mapper, permission seed, `server/modules/warehouses.js`,
`server/modules/warehouse-bin.js`, application registry, package or release file changes are designed.
Existing test files are extended, so `scripts/testing/test-suites.js` needs no new suite registration.

### 35.23.8 Minimum acceptance matrix

Focused SQLite/HTTP coverage:

1. real standard `role-sales` with `SALES_MANAGE` + `CONSIGNMENT_MANAGE` receives exactly the documented
   fields; `/api/warehouses`, `/api/warehouse-bins` and their mutations remain 403;
2. view-only, unauthenticated, cross-group, unknown document and mismatched nested line cases produce the
   specified 401/403/404 results with no reference-data leakage;
3. Handoff returns only the document source warehouse and its active bins; inactive/cross-warehouse/raw ids
   fail closed;
4. Return returns only that same origin warehouse, requires valid active bins where applicable, and refuses
   DRAFT/terminal/no-capacity/missing-evidence contexts with 409;
5. response key-set assertions prove address, manager, timestamps, stock, LOT/SERIAL balance, valuation and
   cost are absent;
6. after a successful reference read, warehouse/bin or document/line state change before POST is re-read by
   the mutation and produces zero physical/commercial/Finance/evidence/audit/idempotency side effects;
7. Settlement succeeds without calling either reference endpoint and still resolves only historical V21
   Handoff evidence.

Protected MySQL coverage uses independent connections and an observer barrier that does not replace the
production transaction adapter: Return versus origin-warehouse deactivation/state change and Return versus
competing line mutation must serialize or reject one participant. The losing participant has zero changes
across line/document versions and quantities, inventory positions/transactions, tracked movements,
valuation, vouchers/AR, audit and idempotency. SQLite/MySQL response projections and status rules must match.

Real-browser acceptance logs in as the standard SALES role and completes Handoff, Settlement and Return at
320 / 390 / 430 / 680 CSS px. Return must be completed through visible warehouse/bin controls with no raw id,
no horizontal overflow and no warehouse master permission. A separate actor lacking manage permission must
observe the 403 state. Direct URL, refresh, Back and Forward remain part of the existing Wave 8 browser gate.

After focused checks, the authorized future Stage D gate remains: full regression, build,
`git diff --check`, protected `pnpm test:mysql`, protected independent-connection
`pnpm test:mysql:concurrency`, and the Wave 8 browser acceptance. This Design stage executes none of them.

### 35.23.9 Compatibility, rollback and Hard Stop

- SQLite/MySQL use the same SELECT predicates, stable ordering and response projection; there is no DDL.
- Existing generic warehouse/bin APIs, role grants and Inventory ownership are byte-for-byte behavioral
  contracts outside this addition.
- Existing Consignment ids, states, economic facts, historical V21 evidence, idempotency identities and
  settlement logic are unchanged.
- Code rollback is removal of the two route registrations/handlers and frontend calls. No data rollback or
  repair exists because the feature writes no new storage.
- Alternate Return warehouses, warehouse-purpose classification, new permissions and reference caching are
  outside scope and require a future Requirement before Design.

No unresolved Design blocker remains inside the accepted bounded Requirement. Per `AGENTS.md §4.3`, Stage D
remains stopped until the user explicitly accepts this Design and separately authorizes implementation.

**Status: `WAVE8_SALES_REFERENCE_DESIGN_DELIVERED — AWAITING_USER_ACCEPTANCE`. Hard Stop.**

## 35.24 Wave 8 B5 Return Reference Conflict — Bounded Stage C Correction (2026-10-21)

> User decision: preserve the previously approved `B5-EXPLICIT-DESTINATION`; do not adopt
> Return-to-origin. This subsection is the active correction layer for §35.23. It supersedes only the
> clauses in §35.23 that made `consignment_commercial_documents.source_warehouse_id` the sole Return
> destination. Every other §35.23 API, permission, Sales Group, disclosure, revalidation, frontend and test
> rule remains active. This is Design-only and does not authorize Stage D.

### 35.24.1 Requirement consistency finding

No `document.md` correction is required. The accepted SALES Reference Amendment says that Return candidates
are active, legally selectable enterprise warehouses and explicitly reserves the exact destination-scope
rule for Stage C. It neither requires Return-to-origin nor contradicts B5.

The conflict was confined to §35.23.4: its single-source-warehouse rule contradicted all three older active
authorities:

- `document.md` selected `B5-EXPLICIT-DESTINATION` over header-source inference;
- §35.18.5 requires an explicit active destination enterprise warehouse/bin;
- §35.18.8 keeps caller-supplied `destinationWarehouseId` and the required bin.

Accordingly, §35.23's Handoff source rule remains valid, while its Return-to-origin rule is withdrawn.

### 35.24.2 Existing authority for an enterprise warehouse

The correction does not invent a warehouse-purpose policy. It composes existing Inventory V21 facts:

1. §27.2 explicitly distinguishes `Enterprise-owned @ Enterprise warehouse` from
   `Enterprise-owned @ Supplier-WIP warehouse`.
2. §27.9 persists that distinction as `warehouses.is_supplier_wip`; §27.22 reserves
   `is_supplier_wip=1` for the outsourcing Supplier-WIP location flow.
3. V21 already requires `warehouses.active=1` and, for a bin-enabled warehouse, an active bin belonging to
   that warehouse.
4. B5 fixes the destination ownership/status as `ENTERPRISE` / null owner / `AVAILABLE`; product and
   LOT/SERIAL remain copied from the historical Handoff partition and revalidated by V21.

Therefore the complete Return warehouse eligibility predicate is exactly:

```sql
w.active = 1
AND COALESCE(w.is_supplier_wip, 0) = 0
```

For `bin_enabled=0`, the only legal bin value is NULL. For `bin_enabled=1`, the candidate contains only
`warehouse_bins.active=1 AND warehouse_bins.warehouse_id=w.id`; a bin-enabled warehouse with no active bin
does not produce a legal selectable destination.

No filter is added for `mrp_participation`, `negative_stock_policy` or `inventory_lock_enabled`: none of
those fields classifies an enterprise Return destination. No inference is made from current
`consignment_commodity_locations`, because S18 says commercial location is distinct from physical warehouse
and ownership. No inventory quantity, availability, valuation or cost predicate is used to populate the
reference list; those remain mutation-time V21 checks.

This predicate intentionally allows the saved Handoff source warehouse when it qualifies, but does not
privilege it and permits any other qualifying enterprise warehouse/bin. A Supplier-WIP warehouse is not a
B5 enterprise destination even though V21 can legally represent ENTERPRISE-owned stock there for the
separate outsourcing flow.

### 35.24.3 Corrected Return Reference API response

The route remains:

```text
GET /api/consignment-commercial-documents/:documentId/lines/:lineId/return-position-references
```

Authentication, `SALES_MANAGE AND CONSIGNMENT_MANAGE`, document Sales Group scope, nested line identity,
`INSTRUCTED/PARTIAL_SETTLED` state, positive remaining quantity and complete Handoff evidence checks remain
as designed in §35.23. The response changes from one `warehouse` to a bounded array:

```json
{
  "purpose": "RETURN",
  "context": {
    "documentId": "...",
    "documentVersion": 3,
    "documentStatus": "INSTRUCTED",
    "lineId": "...",
    "lineVersion": 2
  },
  "warehouses": [
    {
      "id": "...",
      "code": "...",
      "name": "...",
      "binEnabled": true,
      "bins": [
        { "id": "...", "warehouseId": "...", "code": "...", "name": "..." }
      ]
    }
  ]
}
```

Warehouses are ordered by `code,id`; nested bins by `code,id`. The projection remains limited to the exact
fields shown. No address, manager, timestamp, purpose flag, stock, LOT/SERIAL balance, valuation, cost or
configuration data crosses the API boundary. Returning `is_supplier_wip` is unnecessary because the server
uses it only as an internal eligibility predicate.

If the accessible line is otherwise Return-eligible but the candidate set is empty, the route returns 409
`CONSIGNMENT_RETURN_DESTINATION_UNAVAILABLE`. The §35.23 401/403/404 rules and generic cross-group response
remain unchanged. The route has no body, no warehouse search input and no pagination because it returns the
already-filtered legal set, not warehouse master access.

### 35.24.4 Corrected mutation-time authority and locks

The browser's array and selected ids remain hints only. Inside `returnConsignmentLineCommand()`'s existing
caller-owned transaction, after line/document scope/state/version/capacity are locked and re-read:

```text
1. require destinationWarehouseId explicitly; no header fallback
2. lock the submitted warehouse row
3. require active=1 AND is_supplier_wip=0
4. if bin_enabled=0, require destinationBinId=NULL
5. if bin_enabled=1, lock the submitted bin and require active=1 + same warehouse
6. resolve immutable historical Handoff evidence and lock/revalidate current V21 source positions
7. V21 MOVE to the explicit destination with ENTERPRISE/null/AVAILABLE and preserved product/LOT/SERIAL
```

The destination warehouse/bin locks participate in the existing canonical position-key ordering before
physical mutation. A selected warehouse deactivated or reclassified as Supplier-WIP after the GET, an
inactive/moved bin, a missing required bin, a bin supplied to a non-bin warehouse, or a destination not in
the qualifying set fails 409 before any V21/commercial/Finance/audit/idempotency effect.

Corrected error mapping:

```text
CONSIGNMENT_RETURN_DESTINATION_REQUIRED
CONSIGNMENT_RETURN_DESTINATION_INVALID
CONSIGNMENT_RETURN_DESTINATION_BIN_REQUIRED
CONSIGNMENT_RETURN_DESTINATION_BIN_INVALID
CONSIGNMENT_RETURN_DESTINATION_UNAVAILABLE       // GET candidate set empty
```

`CONSIGNMENT_RETURN_DESTINATION_MISMATCH` from §35.23 is removed because cross-enterprise-warehouse Return
is legal and there is no header warehouse equality rule.

Handoff remains unchanged: its reference response contains only the document's `source_warehouse_id`, and
the Handoff mutation requires exact equality. Settlement remains unchanged and reads only historical V21
Handoff evidence.

### 35.24.5 Frontend, file plan and acceptance correction

The §35.23 file list remains exact. Only its Return behavior is corrected:

- `src/pages/wave8-sales.jsx` renders the returned `warehouses[]` as an explicit enterprise destination
  select and renders bins from the selected warehouse; it never defaults the target from the header and
  never calls generic warehouse/bin APIs.
- `server/modules/consignment.js` owns the shared `active && !is_supplier_wip` candidate predicate and uses
  the same predicate in the GET and transaction-time command validation.
- No change is made to `server/modules/warehouses.js`, `server/modules/warehouse-bin.js`, permission seeds,
  schema, migrations or V21.

Focused acceptance must additionally prove:

1. two qualifying active non-WIP warehouses are both returned and Return can legally target the one that
   differs from `source_warehouse_id`;
2. inactive and `is_supplier_wip=1` warehouses are absent; bin-disabled and bin-enabled shapes follow §27.9;
3. direct submission of inactive/Supplier-WIP/cross-warehouse-bin/stale candidates is 409 with zero effects;
4. Handoff still exposes and accepts only `source_warehouse_id`;
5. response key-set tests prove the internal `is_supplier_wip` classifier and all other forbidden fields are
   not disclosed;
6. independent-connection MySQL tests cover candidate GET followed by warehouse deactivation or
   Supplier-WIP reclassification before Return, plus Return racing another line mutation; one legal result
   commits and every loser has zero side effects;
7. real SALES browser acceptance chooses a non-source qualifying warehouse and its bin for Return at
   320/390/430/680 CSS px.

### 35.24.6 Resolution and Hard Stop

The B5 reference conflict is resolved at Design level with no Requirement, schema, permission or frozen
semantic change. No unresolved blocker remains inside this correction.

Per `AGENTS.md §4.3`, implementation remains stopped until the user explicitly accepts this corrected
Design and separately authorizes Stage D resumption. The prior Stage D authorization cannot be reused across
this conflict correction.

**Status: `WAVE8_B5_REFERENCE_DESIGN_CORRECTED — AWAITING_USER_ACCEPTANCE`. Hard Stop.**

## 35.27 Wave 8 final accepted technical baseline and freeze

The user accepted the targeted independent re-audit and explicitly declared
`WAVE8_FINAL_ACCEPTANCE_PASS`. Sections §35.18–§35.26, including their explicit supersession rules, now form
the frozen Wave 8 technical baseline. This section records that acceptance; it introduces no implementation,
schema, API, permission, migration or test change.

### 35.27.1 Canonical implementation baseline

- Inventory V21 remains the sole physical mutation owner. `inventory_mutation_log` carries the approved nine
  nullable evidence fields, populated atomically from mutation-time normalized Position identities. Legacy
  rows remain nullable and are never guessed or startup-backfilled.
- Consignment retains exactly four Wave 8 business tables. Handoff is a V21 MOVE from the document's
  authoritative source warehouse; Settlement is a strict OUT resolved only from immutable Handoff evidence;
  Return is a strict MOVE to an explicit eligible enterprise destination. Every command re-locks and
  revalidates current V21 balance, tracking, valuation, state, version and warehouse/bin authority.
- Service Fulfillment keeps `PENDING / CONFIRMED / CANCELLED`, DIRECT Finance recognition and the approved
  Service-aware Delivery behavior. Mixed physical/Service Delivery remains one atomic business operation.
- Finance A3 preserves exact invoice-item conservation and immutable five-tuple source links. POST, VOID,
  Credit creation and Credit Reversal use the common stable lock prefix
  `SO Line -> Fulfillment -> FINAL AR -> Invoice -> Existing Links`. The Invoice row serializes creation of a
  previously absent Link, the database unique tuple guards insert collisions, and locked authoritative
  re-read rejects drift. A stale plan rolls back the complete attempt and may be rediscovered only once in a
  new transaction; caller-owned transactions are never internally retried.
- Service CONFIRM retains Finance PREPAYMENT parent-first composition followed by SO Line, Fulfillment and
  FINAL AR. No accepted path introduces a reverse edge against the A3 prefix. The MySQL transaction gate is
  not part of the row-lock correctness proof.
- The two Consignment reference GET routes remain contextual and read-only. They require
  `SALES_MANAGE AND CONSIGNMENT_MANAGE`, enforce Sales Group/document/line scope and expose only approved
  label fields. Handoff returns the source warehouse only; B5 Return permits all and only active,
  non-Supplier-WIP enterprise warehouses, omitting a bin-enabled warehouse with no active bin. Mutation-time
  checks, not selector responses, remain authoritative.

### 35.27.2 Schema, migration and compatibility baseline

- SQLite and MySQL 8 use the canonical migration lifecycle for fresh installation, additive upgrade and
  repeated startup. No destructive DDL or speculative data repair belongs to Wave 8.
- MySQL snapshot reconciliation and the Wave 8 physical-contract assertion cover columns, defaults,
  nullability, checks, foreign keys, unique/index order and collation. `lot_code_key` is byte-identical under
  binary collation; pre-change ambiguous identities fail closed before DDL.
- Existing V21 idempotency identity, historical economic facts, Wave 6/7 semantics, Inventory ownership and
  non-Service Finance behavior remain unchanged.

### 35.27.3 Accepted verification evidence

The final completed Stage D gates were: Wave 8 focused 64/64, fast 380/380, full 2626/2626, heavy 67/67,
Vite build PASS with 1963 modules, MySQL integration 56/56, MySQL concurrency 102/102 with Wave 8 15/15,
and Edge acceptance with 36 responsive checks and 16 workflows at 320/390/430/680 CSS px.

The final targeted independent re-audit did not repeat every broad gate. It re-ran the residual/reference
pair at 20/20 and the five-file Wave 8 focused gate at 64/64, inspected the registered HTTP/auth/RBAC/scope
chain and production lock call graph, and confirmed no remaining P0/P1. The broader figures above remain
the actual same-day Stage D results recorded in §35.26 and the development log.

### 35.27.4 Freeze and change control

Wave 8 Design and implementation are accepted and frozen. Any future change to its business behavior,
schema, API scope, permissions, lock graph, canonical-writer ownership or compatibility contract must restart
the repository's AUDIT -> REQUIREMENT -> DESIGN -> IMPLEMENTATION -> ACCEPTANCE sequence. The freeze is
limited to Wave 8; it neither freezes the whole ERP project nor authorizes Wave 9–13.

This documentation closure is pending the user's manual Git commit. It is not itself a commit, tag, release,
deployment, production migration or version change.

**Status: `WAVE8_FINAL_ACCEPTANCE_PASS — FREEZE_DOCUMENTED_PENDING_COMMIT`.**

---
