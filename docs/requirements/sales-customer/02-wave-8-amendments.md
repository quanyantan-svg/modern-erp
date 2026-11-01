# Sales & Customer — Wave 8 Requirement Amendments

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/requirements/sales-customer/README.md`
> 来源：`document.md` Wave 8 修订节（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## Wave 8 Stage B — Bounded Business Decisions & Cross-Domain Contract Reopen

### 1. Reopen reason, authority, scope and frozen protection

This additive Requirement record reopens only the business-policy and cross-domain-contract blockers identified by `solution.md §35.17`. It does not approve any option below and does not authorize a new Stage C revision or Stage D implementation. The historical Stage B closure, all historical Design text and all freeze records remain evidence and are not rewritten.

The following remain frozen and unchanged: Wave 6, Wave 7, Finance V22 recognition/settlement semantics, Inventory V21 position and mutation authority, the Sales Order Change contract, A-61 product commercial classification ownership, the four-table Wave 8 limit, and the existing SC / Invariant / UAT / Race / Audit Capability identifiers and counts. Wave 9–13 remain out of scope.

Decision classifications used by this record:

| Classification | Meaning in this Reopen |
|---|---|
| `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` | Existing Requirement and implementation evidence already determine the behavior; no new business approval is requested. |
| `TECHNICAL_DESIGN_CHOICE` | Existing approved policy permits Stage C to choose the implementation detail, once Stage C is separately authorized. |
| `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | The recommendation is only a proposal; the user must explicitly select or revise it. |
| `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED` | The current canonical owner lacks a proven callable contract required by Wave 8; the user must explicitly authorize the bounded extension before Design or implementation. |

Only the first two classifications may become implementation contracts without a further business-policy decision. Every recommendation under the latter two classifications remains unapproved.

### 2. Existing evidence baseline

The decisions below are based on the canonical documents and the actual runtime entry points, not on naming inference:

- Finance: `server/modules/finance-recognition.js` accepts explicit `DIRECT_BUSINESS_OPEN_ITEM`, `INVOICE_DRIVEN_OPEN_ITEM`, or `PROVISIONAL_TO_FINANCIAL`; it rejects a non-positive recognition amount. DIRECT creates the final source open item and later invoice processing links the source without recognizing a second open item. PROVISIONAL conversion currently requires the linked source to be fully invoiced. INVOICE_DRIVEN creates no open item until invoice processing. `server/modules/finance-recognition-policy.js` has a legacy fallback to DIRECT; Wave 8 may not rely on that fallback.
- Invoice linkage: `finance_invoice_source_links` provides stable invoice/source linkage and uniqueness within one invoice, but the inspected contract does not itself prove a locked cumulative cap across multiple invoices for one source.
- Gate and Finance locks: `authorizeSalesPrepaymentGateForMutation()` reads/locks Sales gate facts before its Finance adapter locks PREPAYMENT parent balances. Finance mutations acquire the PREPAYMENT parent lock at transaction start. Frozen `§29.17.7.5` requires PREPAYMENT parent first for the cross-domain composition. Current `confirmSalesDelivery()` obtains Delivery/Sales facts before calling the Gate. Therefore the current helper call graph is not proof of a globally composable parent-first lock order.
- Service/SO authority: current SO Change locks the change and SO/line facts, but does not count future `service_fulfillments`. The A-61 classification writer locks its own product/classification facts, but does not protect open service obligations. `§35.17` already requires both future paths to fail closed around outstanding/confirmed service facts.
- Inventory V21: the canonical position key is product + warehouse + bin + owner + status + `lot_id` + `serial_id`; ENTERPRISE ownership requires null `owner_id`. LOT identity is the canonical `lot_id`, not a newly normalized Sales batch-code namespace. `applyInventoryMutation()` requires immutable source and idempotency identities, locks affected position keys deterministically, and supports caller-owned transactions, but its source allowlist does not currently contain the three Wave 8 consignment sources. Its default valuation path can be best-effort; Wave 8 value-changing consignment operations cannot rely on swallowed valuation failure.
- Audit: the existing writer persists `audit_logs` inside the supplied transaction. A rolled-back transaction does not preserve that audit row. Existing Wave 8 Requirements require audited committed state transitions and zero failed side effects; they do not require a durable audit row for every rejected request.

### 3. Decision Package A — Service Fulfillment

| Item | Classification | Options and material effects | Recommendation (not approval) |
|---|---|---|---|
| A1 Finance recognition mode | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **A1-DIRECT:** CONFIRM creates final AR from the immutable fulfillment source; later invoice only links it. Fits SC70/SC71 recognition timing, but recognizes before invoice and needs the A3 invoice-cap contract. **A1-PROVISIONAL:** CONFIRM creates provisional AR; invoice converts it. Current adapter's full-invoice condition does not support arbitrary partial conversion without extension. **A1-INVOICE-DRIVEN:** CONFIRM records operational fulfillment with no AR until invoice; this changes the current Stage B promise that CONFIRM invokes Finance recognition/economic effect. | Select **A1-DIRECT** with an explicit `SERVICE_FULFILLMENT` policy; forbid policy fallback. It reuses Finance's final-open-item path, avoids a Sales ledger and provides the narrowest single-recognition rule. |
| A2 zero-amount service | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **A2-ZERO-FACT:** allow CONFIRMED operational evidence at exactly zero; store quantity/state and explicit zero business amount on the fulfillment, create no AR/open item, and let Delivery validate that committed evidence. **A2-BLOCK:** reject zero-value confirmation until Finance exposes a zero-effect result contract. Both prohibit a fabricated zero AR. | Select **A2-ZERO-FACT**. Zero is a genuine operational fact with no economic posting. Stage C must express the conditional Finance evidence shape and must not call the positive-amount Finance adapter. |
| A3 sales-invoice linkage | `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED` | **A3-FULL-ONLY:** one fulfillment may link to one full-value invoice; partial/multiple invoicing is rejected. This can remain narrow but reduces business capability. **A3-CUMULATIVE:** Finance locks the immutable fulfillment source/open item and enforces aggregate linked invoice amount not greater than its recognized amount, allowing partial and multiple invoices; opening balance is never recognized twice. | Select **A3-CUMULATIVE**. Use `source_type='SERVICE_FULFILLMENT'`, `source_id=service_fulfillments.id` and the existing `finance_invoice_source_links`; no fifth Wave 8 table. The cumulative, locked cap is the bounded Finance extension requiring approval. |
| A4 confirmed reversal | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **A4-PENDING-ONLY:** CANCELLED is reachable only from PENDING; CONFIRMED is immutable in Wave 8. Existing confirmed Delivery, invoice and AR remain untouched. **A4-CONTROLLED-REVERSAL:** permit CONFIRMED reversal only through Finance's canonical reversal, after Delivery/invoice eligibility checks, with immutable reversal history. This adds policy and cross-domain behavior. | Select **A4-PENDING-ONLY** for Wave 8. SC70/SC71 and S08 require confirmation, evidence and no service inventory movement; they do not promise post-confirmation reversal. CANCELLED remains a real PENDING transition, so no promised capability is silently removed. |
| A5 Wave 7 Gate integration | `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED` | **A5-CONFIRM-GATE:** treat each service CONFIRM as a new entry applying the existing DELIVERY-stage policy before recognition; each partial confirmation evaluates current authoritative PREPAYMENT balance. Later Sales Delivery rechecks the Gate but does not repeat service recognition. **A5-DELIVERY-ONLY:** defer Gate/economic recognition to Delivery, contradicting the current service-confirm recognition timing. Calling the current helper unchanged does not establish equivalent policy or safe lock order. | Select **A5-CONFIRM-GATE**, subject to C1. This reuses the frozen policy meaning but adds a Wave 8 trigger and a composable parent-first lock entry; it does not consume prepayment or rewrite Wave 7 history. |

#### A package requirements if the recommendations are approved

1. Each non-zero fulfillment has one immutable Finance source identity. Idempotent retry must return the same recognition result; Sales Delivery must never recognize the same service amount again.
2. Zero-value confirmation remains valid fulfillment evidence with zero Finance side effects. It must be distinguishable from a missing or failed Finance call.
3. Direct recognition establishes the maximum invoice-link amount. Partial/multiple invoice links are serialized and cumulative; an over-link fails with no side effect.
4. PENDING cancellation writes audit; CONFIRMED has no Wave 8 cancel command under A4-PENDING-ONLY.
5. Gate failure, Finance failure, classification conflict, quantity conflict or invoice-link conflict rolls back the whole attempted mutation. Durable rejected-attempt audit is not promised by this package.

### 4. Decision Package B — Consignment

| Item | Classification | Options and material effects | Recommendation (not approval) |
|---|---|---|---|
| B1 location deactivation | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B1-HISTORICAL-CONTINUITY:** inactive location rejects new instruction/handoff, but existing outstanding stock may legally settle or return using its immutable historical physical mapping; mapping cannot change while outstanding quantity exists. **B1-HARD-BLOCK:** inactivity blocks every mutation, stranding stock until reactivation. | Select **B1-HISTORICAL-CONTINUITY**. It preserves Inventory truth and permits disposal of existing stock. Mutation must lock the commercial line/location and affected Inventory positions and re-read active/mapping/outstanding facts. |
| B2 commercial amount authority | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B2-REPRESENTABLE-NET-UNIT:** `consignment_commercial_lines.unit_price_cents` is the immutable, tax-exclusive, post-discount net amount per whole sales UOM in document currency. For an SO source it must exactly equal the approved SO line's effective net-unit result at instruction; otherwise creation fails because the four-table carrier cannot preserve an arbitrary total. Without SO it is the explicitly supplied approved net unit price. Each cumulative settlement target is `floor(unit_price_cents × cumulative_settled_micros / 1,000,000)`; each event posts target minus prior-posted cents, so the final event receives the remainder. Later source-price changes do not alter the instruction. **B2-ARBITRARY-TOTAL:** support any independent line total/discount/tax allocation, which needs an extra field or pricing carrier and is outside the approved zero-extension/four-table boundary. | Select **B2-REPRESENTABLE-NET-UNIT**. It is deterministic with integer cents/micros and makes the existing field the sole amount authority, at the cost of rejecting non-representable source pricing. Tax itself remains outside this Wave 8 settlement amount rather than being invented. |
| B3 LOT canonical identity | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B3-V21-ID:** when LOT is absent, `lot_code` is null and `lot_code_key=''`; blank text is not a valid LOT. When present, input must resolve to one existing canonical Inventory V21 lot and `lot_code_key` stores that immutable lot id; `lot_code` is display evidence only. No trimming/case-folding/Unicode normalization defines identity. SQLite uses binary equality and MySQL must use an explicit binary/case-sensitive comparison for the key. **B3-NEW-CODE-NORMALIZATION:** define Sales-owned normalized batch-code identity, which has no frozen basis and risks dialect/collation divergence. | Select **B3-V21-ID**. Identity follows V21 `lot_id`; it does not invent ASCII-only or case-folding policy. Stage C must correct any earlier text that treated free-form `lot_code` normalization as canonical identity. |
| B4 partial cancel/split | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B4-WHOLE-DRAFT-CANCEL:** DRAFT document may cancel in full; after instruction/handoff, remaining quantity is resolved only by legal settlement or controlled return. Four tables are sufficient and R-SAL-20/21 keep one capacity anchor. **B4-PARTIAL-SPLIT:** add canceled/split quantity, lineage, allocation and concurrency evidence. The approved four tables currently have no sufficient carrier, so this requires a scope/schema reopen. | Select **B4-WHOLE-DRAFT-CANCEL** for Wave 8. Partial cancel/split remains out of scope, not an implied TODO. |
| B5 return destination/economics | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B5-EXPLICIT-DESTINATION:** an unsettled return command names an active enterprise destination warehouse/bin; V21 moves stock from the immutable historical consignment position to that destination. Ownership remains ENTERPRISE and no AR/refund is created. A settled customer sales return follows the existing controlled Sales Return chain, not this command. **B5-HEADER-SOURCE:** always return to an inferred/header source location; this is ambiguous for bin-enabled or relocated operations. | Select **B5-EXPLICIT-DESTINATION**. Lock the commercial line and both position keys in deterministic order; settlement and return serialize on the same line, then re-read remaining quantity. R-SAL-21 must exercise one legal settlement and one legal return concurrently—an endpoint that always responds 409 is not acceptance evidence. |

#### B package requirements if the recommendations are approved

1. Commercial location and physical warehouse/bin remain different identities. The line preserves the historical mapping used by handoff; Inventory V21 remains physical authority.
2. All consigned on-hand remains `owner_type='ENTERPRISE'`, `owner_id=NULL` until settlement/title transfer. No CUSTOMER-owned shortcut and no Sales shadow inventory are permitted.
3. Settlement is an Inventory OUT plus the approved Finance commercial effect. Unsettled return is an Inventory MOVE/return-to-enterprise-location with no AR/refund. Post-settlement sales return uses its existing reverse chain.
4. `consigned_quantity - settled_quantity - returned_quantity` never becomes negative. R-SAL-20 and R-SAL-21 use real legal operations and the same locked commercial line capacity anchor.

### 5. Decision Package C — Cross-Domain Contracts

#### C1. Wave 7 / Finance lock composition

Classification: `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED`.

Observed and proposed lock chains (`→` means later acquisition inside the same logical mutation):

| Path | Current/proposed order and ownership | Finding |
|---|---|---|
| Existing Wave 7 Gate helper | Gate requirement/result read and Sales locks → Sales Order facts → Finance adapter PREPAYMENT parent lock; caller transaction/connection | Not composable with the frozen parent-first rule when the caller already holds Sales locks. |
| Proposed Service Fulfillment CONFIRM | PREPAYMENT parent ids in ascending order → authoritative Gate re-read/evaluation → SO/service capacity line → fulfillment row/range → Finance recognition source/open item → audit; one caller-owned transaction | Required target order; unavailable as a proven current public contract. |
| Existing Sales Delivery CONFIRM | Delivery and line/capacity facts → SO/quality/period facts → Gate helper → Inventory positions/valuation → Finance recognition; caller transaction | The current order cannot itself prove compatibility with PREPAYMENT-parent-first composition. |
| Finance recognition | Source/open-item reads and inserts inside the caller transaction when supplied | No explicit cross-domain `FOR UPDATE` ordering contract was found for the Wave 8 source. |
| Finance PREPAYMENT consume/refund/reversal | PREPAYMENT parent balance lock at the start of the Finance mutation → children/effects | This is the frozen anchor order that Wave 8 must respect. |

Minimal proposed extension, not approved: Finance/Wave 7 exposes a composable prepayment authorization operation that (a) discovers candidate PREPAYMENT parent identities without holding Sales row locks, (b) locks those parent rows in ascending id order on the caller-owned connection, (c) re-reads authoritative balances and Gate inputs after locking, and only then (d) permits the caller to acquire Sales capacity/document locks. Service CONFIRM and any affected Sales Delivery entry must use this composition. Finance recognition must separately declare a deterministic source/open-item lock order after Sales capacity locks. Deadlock retry may handle transient database victims but cannot replace the ordering contract. No frozen policy meaning, balance ownership or Gate result meaning changes.

Potential cycle being removed: Delivery/Service path holding Sales then waiting for PREPAYMENT, while a Finance mutation holds PREPAYMENT then reaches a Sales-related dependency. Until this extension is approved and designed, neither Service CONFIRM nor the affected Delivery composition is implementation-ready.

#### C2. Inventory V21 consignment writer

Classification: `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED`.

Minimal proposed extension, not approved:

| Operation | Immutable source identity | V21 effect |
|---|---|---|
| `CONSIGNMENT_HANDOFF` | source id = consignment document id; source item id = commercial line id; idempotency key bound to operation + line + client key | MOVE from explicit enterprise source warehouse/bin to the line's resolved historical consignment warehouse/bin. |
| `CONSIGNMENT_SETTLEMENT` | source id = immutable settlement event identity derived from line + idempotency key; source item id = commercial line id | OUT from the historical consignment position for only the settled quantity. |
| `CONSIGNMENT_RETURN` | source id = immutable return event identity derived from line + idempotency key; source item id = commercial line id | MOVE from historical consignment position to the explicitly supplied active enterprise destination. |

For all three operations, the canonical position key remains V21 product/warehouse/bin/ENTERPRISE/null-owner/status/`lot_id`/`serial_id`; the commercial location id is never substituted for `warehouse_id`. Source and destination positions are locked in canonical key order. LOT/SERIAL validation and conservation use existing V21 authority. The caller owns one transaction/connection; any commercial, Inventory, valuation or audit failure rolls back the whole mutation. Repeated immutable idempotency identity returns the same effect and mismatched reuse fails closed. Audit records only the committed operation.

Handoff and return must use strict value-preserving movement behavior; settlement must use strict Inventory issue/COGS behavior. A best-effort valuation failure is not acceptable for these operations. The bounded source impact is the V21 mutation source-type contract in `server/lib/inventory-mutation.js` and, only if required to expose strict value-preserving/issue behavior, the existing canonical financial-inventory adapter; the position-key module retains its meaning. No Inventory schema/migration, shadow stock table, Sales stock ledger or fifth Wave 8 table is approved.

#### C3. Platform failure audit

Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT`.

The current audit writer participates in the business transaction, so a rollback also removes its audit insert. Current Wave 8 Requirement demands audit for committed transitions and zero side effects for failed mutations; it does not require durable logging of every rejected attempt. Therefore Wave 8 must not promise a persistent failure audit, and no Platform contract extension or new audit subsystem is needed. If durable rejected-attempt evidence is later required, it is a separate Platform Requirement decision outside this Reopen.

### 6. Traceability and contract impact

| Frozen trace | Impact of this Reopen |
|---|---|
| SC70–SC71, S08 | A1/A2 define recognition and zero-value evidence; A4 preserves service confirmation without Inventory OUT and limits cancel to PENDING if approved; A5/C1 gate every economic confirmation without changing the frozen Gate policy. |
| SC72–SC77, S18 | B1–B5 keep commercial, Inventory and Finance truth separate; enterprise ownership persists until settlement; commercial location never becomes an Inventory dimension. |
| R-SAL-20 | Settlement races serialize on `consignment_commercial_lines.id`; combined settled quantity and financial/physical effects cannot exceed capacity. |
| R-SAL-21 | Legal settlement and legal unsettled return race on the same line, with real V21 effects; combined settled+returned cannot exceed consigned quantity. |
| R-SAL-22 | Service confirmations serialize on the SO service-line capacity anchor and fulfillment evidence while respecting the C1 parent-first boundary. |
| UAT-S-25 / UAT-S-26 / UAT-S-27 / UAT-S-41 | Acceptance must cover explicit service mode/zero/invoice behavior, consignment instruction/handoff/settlement/return, mobile flows already in scope, and real cross-domain failure/rollback behavior. No new UAT id is created. |
| Audit CAP-25 / CAP-26 | Committed Wave 8 transitions remain queryable; failed requests have zero business side effects but no new promise of durable failure audit. |

The four and only four new Wave 8 tables remain `service_fulfillments`, `consignment_commercial_documents`, `consignment_commercial_lines`, and `consignment_commodity_locations`. This Reopen approves neither a fifth table nor an extension of an existing table. B2 deliberately constrains representability to existing `unit_price_cents`; B3 uses canonical V21 `lot_id` as the key value; A3 uses the existing Finance invoice-source-link carrier. API shapes, permissions and error codes remain Stage C technical design work after the policy selections; backend authorization remains fail closed.

### 7. Approved scope versus unapproved decisions

Already governed and therefore not reopened: four-table maximum; no new existing-table columns; no Sales-owned Finance or Inventory ledger; service fulfillment has no Inventory OUT/COGS; consignment stock is ENTERPRISE-owned before settlement; committed transitions are audited transactionally; failures have zero partial business side effects; existing trace identifiers/counts are unchanged.

The following remain explicitly **unapproved** and require user decisions:

1. A1 recognition mode: DIRECT, PROVISIONAL or INVOICE_DRIVEN.
2. A2 zero-value confirmation: operational zero fact or block.
3. A3 invoice policy: full-only or cumulative partial/multiple linkage, including the bounded Finance extension.
4. A4 reversal: PENDING-only cancellation or controlled CONFIRMED reversal.
5. A5 Gate trigger at Service CONFIRM and the bounded C1 composition extension.
6. B1 inactive-location historical continuity or hard block.
7. B2 representable tax-exclusive net-unit authority or a separately reopened amount carrier/scope.
8. B3 canonical V21 lot-id identity or a separately approved normalization policy.
9. B4 whole DRAFT cancel only or a separately reopened partial-cancel/split carrier.
10. B5 explicit return destination or header-source inference.
11. C2 the three-source Inventory V21 bounded writer extension and strict valuation behavior.

C3 requires no decision unless the user adds a new durable-failure-audit Requirement.

### 8. Exact input required for the next Stage C correction

Stage C must not resume until the user supplies explicit selections for A1, A2, A3, A4, A5, B1, B2, B3, B4, B5, C1 and C2 (approval of each recommendation is sufficient; revisions must state the replacement policy). The next authorization must also explicitly permit `solution.md` modification. Once authorized, Stage C must:

1. make the selected policies the active service/consignment contract and supersede only conflicting Wave 8 §35 text;
2. specify the C1 parent-first callable API, transaction ownership, authoritative re-read, deterministic locks and Delivery compatibility;
3. specify A3 invoice cumulative/full-only enforcement without duplicate Finance recognition;
4. specify the C2 source allowlist, immutable identities, exact V21 position mapping and strict valuation rollback;
5. align schema constraints with A2/B2/B3/B4 without adding a table or existing-table column;
6. map the selected behavior to the existing SC70–77, S08/S18, R-SAL-20/21/22, UAT-S-25/26/27/41 and CAP-25/26 only; and
7. retain the implementation hard stop until that corrected Design is separately approved.

### 9. Hard Stop

This record is Requirement decision material, not approval. It changes no historical Requirement, Design, source, migration, test, frontend, configuration, database or Git state. It authorizes no test/build/format/migration/database/Git operation, no Stage C edit, no Stage D implementation and no Wave 9–13 work.

**Final governance status: `WAVE8_STAGE_B_BOUNDED_REOPEN_DELIVERED — AWAITING USER DECISIONS`. Hard Stop.**

---

## Wave 8 Stage B — V21 Historical Position Evidence Amendment

> Authorization: the user's `Wave 8 — Bounded V21 Evidence Carrier Requirement Amendment` instruction dated 2026-10-19. This is a bounded Requirement amendment only. It preserves the Wave 8 Stage D Hard Stop现场, does not amend `solution.md`, does not authorize source/migration/test/frontend/configuration changes, and does not authorize tests, builds, database access or Git writes.

### A. Root-cause verification

The original active Wave 8 contract kept exactly four new Wave 8 business tables and prohibited every existing-table column extension. Stage D inspection proved that this restriction cannot carry the approved B1/B5 historical-position semantics.

1. `applyInventoryMutation()` validates a complete canonical `fromPosition` / `toPosition` tuple at mutation time: product, warehouse, bin, owner type/id, stock status, LOT id and SERIAL id. It derives `position_key` only after those inputs pass V21 master/owner/status/bin/identity validation. A bin-enabled warehouse requires an explicit valid bin.
2. The canonical position key is a lowercase SHA-256 digest of the normalized tuple. It can verify a known tuple by recomputation but is intentionally one-way and cannot reconstruct warehouse/bin/owner/status/LOT/SERIAL values.
3. Current `inventory_transactions` persistence contains transaction id, warehouse, product, quantity/direction/balance, source identity, dates and later LOT/SERIAL/valuation fields, but the active V21 writer does not persist the complete position tuple, position key, bin, owner, stock status, movement group, or its supplied source item in that row.
4. Current `tracked_inventory_movements` contains its own id, `transaction_id`, source/source-item, product, warehouse, direction, quantity, LOT/SERIAL, dates and reversal flag. It does not persist bin, owner, stock status, position key, movement group or movement kind. It therefore narrows identity for LOT/SERIAL but does not reconstruct a complete historical position.
5. Current `inventory_mutation_log` contains one row per `applyInventoryMutation()` call with idempotency key, movement group, source type/id, movement kind, quantity, business date, actor and timestamp. It does not contain `source_item_id`, normalized from/to identity, request fingerprint, or the inventory transaction ids created by that mutation.
6. `inventory` contains the current complete position identity and balance, not an immutable history snapshot. `inventory_lot_balances` and `inventory_serials.current_warehouse_id` are current identity/location projections and likewise cannot prove the original handoff bin/owner/status. Current commercial-location mapping is mutable after outstanding quantity closes and is expressly not historical Inventory authority.
7. Bin-enabled stock makes the gap decisive because neither tracking nor valuation evidence carries the historical bin. LOT evidence retains LOT and warehouse but still loses bin/owner/status. SERIAL evidence retains SERIAL and warehouse but still loses bin/owner/status, and the current SERIAL location can subsequently change.
8. One Handoff line can require multiple V21 mutations: strict LOT/SERIAL processing is partitioned by canonical identity, and multiple SERIAL ids are each independent positions. All partitions may share one `movement_group_id` and commercial `source_item_id`, while each call has its own idempotency key and OUT/IN transaction pair. Therefore `movement_group_id` is a non-unique correlation identity, not a unique movement-row identity.
9. Settlement/Return must start from `consignment_commercial_lines.handoff_movement_group_id`, identify every Handoff mutation row for that commercial line, recover the persisted destination position of each applicable partition, subtract later lawful settlement/return evidence by exact identity, then lock and revalidate the current V21 position. The group alone is insufficient without source-item and per-mutation direction/position evidence.
10. Current V21 replay reads only `movement_group_id` by unique `idempotency_key`. It neither compares the replayed request's source/item/kind/quantity/date/positions/modes nor returns the original transaction/position evidence. Same-key changed semantics can therefore be silently treated as replay by the current primitive; that is insufficient for new Wave 8 commands.
11. Existing persisted evidence was exhaustively considered: current inventory rows, inventory transactions, tracked movements, tracked source allocations, LOT/SERIAL masters and balances, valuation movements, mutation log, audit detail and remark. No existing combination can recover a bin-complete immutable from/to tuple for every legal Handoff. Audit text, remark and client-supplied free text are not physical-position authority.

Coverage classification for this amendment: `SEMANTIC_MISMATCH` — the approved historical-continuity Requirement is valid, but the original zero-extension carrier restriction makes it unrepresentable in the real V21 schema.

### B. Existing-schema evidence matrix

| Carrier | Persisted authority relevant to Wave 8 | Missing for historical Handoff resolution | Permitted use |
|---|---|---|---|
| `inventory` | Current complete canonical position and on-hand | Immutable handoff-time snapshot and event correlation | Re-lock/revalidate current balance after historical identity is resolved; never substitute current state for history. |
| `inventory_transactions` | Physical direction, quantity, warehouse/product, source and valuation linkage | Complete bin/owner/status/position tuple, movement group; active writer omits source item | Physical/valuation evidence only; not sufficient alone. |
| `tracked_inventory_movements` | Source item, transaction id, direction, warehouse/product, LOT/SERIAL | Bin/owner/status/position key and movement group | LOT/SERIAL and transaction corroboration; not sufficient alone. |
| `tracked_source_allocations` | Source-item LOT/SERIAL allocation intent/posting state | From/to location, owner/status, movement group and physical transaction pair | Tracking allocation proof only. |
| `inventory_valuation_movements` | Product/warehouse/LOT/SERIAL value movement and inventory transaction linkage | Bin/owner/status/position key and movement group | Value conservation/COGS proof only. |
| `inventory_mutation_log` | Unique idempotency key, movement group, source, kind, quantity/date | Source item, normalized from/to identities, semantic fingerprint and exact transaction association | Preferred bounded extension point because it already owns mutation idempotency/correlation. |
| audit / remark | Human-readable committed-operation context | Structured canonical identity and enforceable replay equality | Diagnostic only; explicitly prohibited as position authority. |
| commercial location mapping | Current Sales mapping to warehouse/bin | Immutable historical V21 fact | New Handoff validation only; never used to reconstruct an executed Handoff. |

### C. Option 1 amended Requirement contract

The user selects **Option 1 — Minimal Additive Extension to Existing Inventory V21 Evidence Carrier**. The active Wave 8 Requirement is amended as follows:

1. The four Wave 8 business tables remain unchanged in count. No fifth Wave 8 business table, shadow inventory ledger or Sales-owned physical balance is allowed.
2. A minimal additive extension to an existing Inventory V21 evidence table is now permitted solely to preserve mutation-time normalized position evidence required by Consignment Handoff/Settlement/Return. `inventory_mutation_log` is the preferred candidate because it already owns idempotency and movement-group correlation; the final table/field realization remains a Stage C decision.
3. The extension must provide enough immutable evidence to identify one mutation call within a possibly multi-row movement group, associate it with `source_type + source_id + source_item_id`, distinguish source and destination, recover the complete normalized canonical position tuple for each present side, prove its physical inventory transaction association, and validate exact replay semantics.
4. Every saved identity must be produced from V21's actually normalized and validated `fromPosition` / `toPosition` inside the canonical writer. Client JSON, commercial-location mapping, remark or audit text cannot be copied as authority without canonical normalization and revalidation.
5. Handoff evidence and physical mutation must commit in the same caller-owned transaction. Evidence is insert-once/ordinary-edit-prohibited. Any inventory, tracking, valuation, business, audit or evidence failure rolls back all effects.
6. Settlement performs strict canonical V21 OUT; Return performs strict canonical V21 MOVE to an explicit legal enterprise destination. Neither may directly update inventory or bypass `applyInventoryMutation()`.
7. Historical evidence resolves the identity that was handed off; it does not assert that stock is still available. Settlement/Return must recompute/verify the stored tuple, lock current canonical positions in V21 order, and revalidate balance, status, owner, LOT/SERIAL, period, tracking and valuation authority. Missing, malformed, ambiguous or insufficient evidence fails closed.
8. Ownership remains `ENTERPRISE` with null owner id on both sides of Handoff/Return until the approved settlement/title-transfer event. No CUSTOMER-owned proxy is introduced.
9. Idempotency identity remains the existing unique `idempotency_key`. Same key plus exactly equivalent normalized semantics returns the same movement group and historical evidence without new rows or effects. Same key with any material semantic difference returns conflict. Multiple partition keys may share one movement group; the group itself is not made unique.
10. Legacy rows remain readable with new fields null. No guessed backfill, startup fabrication, commercial-map inference or rewriting of historical economic facts is allowed. A mutation requiring historical position truth fails closed when the legacy evidence is incomplete.
11. Inventory & Warehouse continues to own physical position, mutation, tracking, valuation evidence integration and idempotency carrier. Sales & Customer owns the consignment commercial document/capacity and references the Inventory evidence; it does not own or edit that evidence.

This amendment replaces only the conflicting Wave 8 clauses `zero existing-table column extensions` / `no V21 schema extension`. All other A1–C3 decisions, the four-table business model, Wave 6/7 frozen semantics, V21 position identity and canonical-writer ownership remain unchanged.

### D. Candidate-field minimal-sufficiency analysis for Stage C

The following are candidate responsibilities, not an approved physical schema:

| Candidate | Why it may be necessary | Why it is not sufficient alone / Stage C question |
|---|---|---|
| `source_item_id` | Disambiguates the commercial line inside a document and movement group. | Still cannot recover either position or prove the physical transaction pair. |
| `from_position_identity_json` | Can preserve the complete normalized source tuple with fewer additive columns. | Must define canonical key order/version, JSON validation, exact null semantics and SQLite TEXT versus MySQL JSON parity. Hash/key alone is insufficient. |
| `to_position_identity_json` | Preserves the actual Handoff destination and Return destination independent of later mapping changes. | Same serialization/parity requirements; must be null for legitimate single-sided OUT. |
| from/to inventory transaction ids | Directly binds each evidence side to the exact physical ledger row and enables direction/quantity/source verification. | Stage C must decide whether two nullable references are mandatory or whether an equally strong existing relation can be proven for NONE/LOT/SERIAL and multi-partition cases. Mere timestamp/source joins are not sufficient. |
| request fingerprint/digest | Provides constant-time exact semantic replay conflict detection, including normalized positions and execution modes. | Must not replace readable position evidence; Stage C must define the canonical fingerprint payload/version and legacy-null behavior. |
| explicit physical columns | Strong typing and direct SQL predicates/FKs. | Duplicates up to eight dimensions per side, creates a broad nullable-column matrix and is less bounded than two versioned snapshots; Stage C must justify it if selected. |
| `from_position_key` / `to_position_key` only | Compact and useful for current-position lock lookup. | SHA-256 is non-reversible and cannot satisfy historical reconstruction by itself; keys may accompany but cannot replace the tuple snapshots. |
| separate source/destination evidence rows | Natural one-direction-per-row model. | Would require a new carrier/table or change current row cardinality; not approved unless Stage C proves an existing carrier can express it without a fifth table. One mutation-log row with two independently identified sides is the preferred bounded shape. |

Minimum semantic sufficiency therefore requires, regardless of final names: source-item correlation; complete normalized from/to snapshots; unambiguous per-call identity within a non-unique movement group; exact replay comparison; and verifiable association to the physical OUT/IN transactions. Stage C must select the smallest cross-dialect realization and may not omit one of these responsibilities merely because LOT/SERIAL tracking partially duplicates it.

### E. Schema, migration and compatibility requirements

1. SQLite and MySQL 8 must expose equivalent nullability, value domain, identity comparison, JSON/text validation, indexes and replay behavior.
2. Fresh bootstrap, additive upgrade of an existing database, and repeated migration execution must converge without destructive DDL or data repair.
3. New columns must be nullable for historical rows. New Wave 8 writes must satisfy the complete-evidence invariant at the application/constraint boundary selected in Stage C.
4. Existing `idempotency_key` identity and historical values remain unchanged. Existing legal callers retain their business behavior; the extension cannot force fabricated evidence onto old rows or reinterpret their economics.
5. `movement_group_id` remains a many-mutation correlation id. Stage C must define the non-unique lookup index and stable ordering for `(movement_group_id, source_type, source_id, source_item_id, mutation-row-id)` or an equivalent key.
6. New transaction references, if selected, must preserve OUT/IN direction, source, quantity and atomic existence across both dialects. No timestamp-based or remark-based association is acceptable.
7. JSON, if selected, stores only a versioned canonical normalized position object; it is not arbitrary client JSON. Explicit columns, if selected, must remain bounded to the same position contract and cannot redesign V21 identity.
8. No existing economic row is updated to claim new facts; no GET/startup repair is allowed. Rollback retains schema but not partially written mutation/evidence rows.

### F. Traceability and current Stage D work preservation

- R-SAL-20 and R-SAL-21 require settlement/return races to resolve the same immutable Handoff evidence, then serialize on current commercial capacity and V21 positions. The amendment supplies the missing historical correlation; it does not relax capacity or current-balance checks.
- R-SAL-22 is not structurally changed; Service Fulfillment concurrency remains governed by the approved SO-line/fulfillment/Finance locks. It remains in the Wave 8 combined acceptance because the implementation worktree is one bounded Wave.
- UAT-S-26 must prove instruction/Handoff evidence, exact ENTERPRISE destination position, settlement OUT, strict value/Finance conservation and complete trace from commercial line to physical transactions.
- UAT-S-27 must prove inactive-location historical continuity, explicit return destination, exact Handoff-source reconstruction and failure on missing/ambiguous evidence.
- S18 remains the three-truth invariant: commercial location, physical position/ownership and settlement are distinct. This amendment strengthens that separation by prohibiting mapping-based historical inference.
- No new SC, Invariant, UAT, Race or Audit CAP id is created; canonical counts remain unchanged.

The partial Stage D files and edits already present in the worktree are preserved as an unaccepted Hard Stop现场. They are not rolled back, completed, migrated, tested, committed or declared PASS. In particular, the four-table Wave 8 migration, registry entry, permission seeds, Service Fulfillment skeleton, C1 adapter changes, V21 source allowlist and migration-runner changes remain subject to the corrected Stage C Design and later explicit Stage D resumption authorization.

### G. Mandatory Stage C design decisions

Stage C must resolve and receive separate user approval for all of the following before Stage D can resume:

1. Exact existing V21 table selected for the additive carrier and proof that no second canonical writer is created.
2. Exact field list, types, nullability, constraints and index order for SQLite/MySQL; JSON versus explicit-column decision and canonical snapshot version/serialization.
3. Whether from/to inventory transaction ids are mandatory, their FK/application validation, and how tracked/valuation rows corroborate NONE, LOT and SERIAL partitions.
4. Per-mutation identity and stable ordering when multiple rows share one movement group and source item; no uniqueness may incorrectly collapse multiple SERIAL partitions.
5. Canonical request-fingerprint inputs, replay result shape and mismatch error contract, including valuation/tracking modes and legacy-null compatibility.
6. Handoff writer sequence that obtains normalized V21 identities, writes physical OUT/IN and immutable evidence atomically, and returns the complete replayable evidence set.
7. Settlement/Return resolver algorithm from commercial line → movement group → source item → partition evidence → current V21 position, including later Settlement/Return consumption of specific LOT/SERIAL evidence.
8. Lock order for mutation-log evidence, current positions, LOT/SERIAL, valuation and commercial capacity; independent-session proof for R-SAL-20/21.
9. Additive migration strategy and metadata assertions for fresh/upgrade/replay, including old nullable rows and no guessed backfill.
10. Compatibility boundary for existing V21 callers and tests, plus fail-closed error codes for missing, malformed, ambiguous or replay-conflicting evidence.
11. Required focused, regression, heavy and protected MySQL acceptance evidence. This Requirement stage does not execute any of them.

### H. Resume gate and status

Wave 8 Stage D remains stopped. Resume requires, in order: user acceptance of this Requirement amendment; separately authorized Stage C update to `solution.md`; user acceptance of that Design; then explicit authorization to resume Stage D. Until then no source, migration, test, frontend, configuration, database or Git write is authorized beyond this Requirement record and its append-only log.

**Final status: `WAVE8_STAGE_B_V21_EVIDENCE_AMENDMENT_DELIVERED — AWAITING_USER_ACCEPTANCE`. Hard Stop.**

---

## Wave 8 Residual Requirement Amendment — R1/R2/R3 (2026-10-21)

> This is a **Requirement-only** amendment closing the three residual blockers reported in
> `solution.md §35.21.8` / `log/2026-10-20.md`. It is additive to Wave 8 and preserves verbatim every
> approved §35.18/§35.19/§35.21 contract, every frozen §28–§30 Finance/Inventory semantic, and the
> Wave 6/7 freeze baseline. It introduces no new SC / Invariant / UAT / Race / Audit Capability
> identifier; the SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36 counts are unchanged.
> It authorizes **no** source, migration, test, frontend, configuration or database change and no Git
> operation. Final Acceptance and Freeze remain unauthorized.

### R0. Provenance and coverage of the three items

| Item | Coverage before this amendment | Evidence |
|---|---|---|
| R1 Commercial Credit Note reversal | `MISSING` | `commercial_credit_notes.status` already admits `REVERSED` (`server/migrations/v13-phase6e-commercial-golive.js:114`) but the only writer is `createCommercialCreditNote`, which hard-codes `POSTED` (`server/modules/commercial-golive.js:366`); the only credit route is `POST /api/commercial-credit-notes` (`server/modules/commercial-golive.js:568`); `reverseCreditAdjustment` exists but is never invoked with `sourceType='SALES_CREDIT_NOTE'`. |
| R2 A3 Invoice lock order | `SEMANTIC_MISMATCH` | §35.18.11.5 specifies SO line → Fulfillment → FINAL AR → Invoice/Link. `postSalesInvoice` locks no SO-line stage, `recordInvoiceLinks` reads the link before the fulfillment and FINAL AR locks (`server/modules/finance-recognition.js:97` before `:106`/`:107`), and `voidPostedInvoice` performs no source-stage locking at all. |
| R3 MySQL `lot_code_key` collation | `SEMANTIC_MISMATCH` | §35.18.2 requires binary collation on byte-identity keys and SQLite declares `lot_code_key TEXT COLLATE BINARY` (`server/migrations/sales-customer-wave8-service-consignment.js:93`). MySQL realizes it as `utf8mb4_0900_ai_ci`, recorded in `WAVE8_KNOWN_MYSQL_PARITY_GAPS`. |

### R1. Commercial Credit Note Reversal contract

#### R1.1 Scope and carrier reuse

R1 is **entirely implementable on existing carriers. No new business table and no shadow Finance engine
is authorized.** The business document remains `commercial_credit_notes`; the monetary primitive remains
`financial_credit_adjustments` + `settlement_unapplied_balances` + `credit_reversal_components`; the
invoice-side capacity remains `sales_invoices.credited_amount_cents` / `remaining_creditable_amount_cents`
(`server/migrations/v22-finance-wave-c-invoice.js:50-51`); the accounting effect remains the canonical
system-voucher reversal; the audit trail remains `audit_logs`; the retry guard remains `idempotency_records`.
The existing `reverseCreditAdjustment()` (`server/modules/settlement-core.js:165`) is the **only** authorized
monetary reversal primitive.

#### R1.2 State machine

`POSTED → REVERSED` is the only legal transition, and it is terminal.

- `DRAFT` credit notes may not be reversed through this entry point; a draft is cancelled by its own path.
- `REVERSED` is final. No re-post, no re-open, no second reversal.
- Partial reversal is **forbidden**. A reversal always reverses the full posted credit amount.
- Amounts on an existing credit note are immutable in both directions. A reversal never edits `net_cents`,
  `tax_cents`, `gross_cents`, `tax_snapshot_json`, `adjustment_type`, `source_type`, `source_id` or `party_id`.
- Any state outside `POSTED` fails closed with `COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE`.

#### R1.3 Downstream dependency failure-closed

A credit whose monetary footprint can no longer be safely undone must fail closed with
`COMMERCIAL_CREDIT_REVERSAL_BLOCKED` and a machine-readable `reason`. The following are blocking:

1. the derived `CREDIT` settlement balance has any confirmed balance application or confirmed financial refund;
2. any linked `credit_reversal_components` row shows applied or unapplied cents already consumed by a
   downstream return reversal;
3. the target open item has consumed, cash-allocated or written-off amount that the reversal would drive negative;
4. the accounting period covering the credit date is closed, or the period covering the reversal date is closed.

No "reverse anyway", no compensating entry and no best-effort success is legal. The caller must first
reverse the dependent settlement, refund or return reversal through its own canonical path.

#### R1.4 Capacity, history and immutability semantics

On a successful reversal, in the same transaction:

- every `financial_credit_adjustments` row of that credit moves `CONFIRMED → REVERSED` with
  `reversed_cents = amount_cents`, and the derived `CREDIT` balance moves to `REVERSED`;
- the canonical system voucher created by the credit is reversed by the existing voucher reversal, never by
  a hand-written balancing entry;
- the source invoice `credited_amount_cents` is reduced by exactly the reversed gross, and
  `remaining_creditable_amount_cents` is recomputed as `gross_cents − credited_amount_cents`;
- `remaining_creditable_amount_cents` may never be driven below zero;
- the invoice's historical `finance_invoice_source_links` rows are **not** deleted and **not** modified.
  They stop counting only through the credit-status predicate. A reversed credit therefore **frees invoice
  creditable capacity but does not release the invoicing capacity** that a Service Fulfillment source already
  consumed under §35.18.12;
- the reversal is recorded in `audit_logs` with entity type `COMMERCIAL_CREDIT_NOTE`, action `REVERSE`, the
  actor, the reversal date and the reason.

A no-op reversal of an already-reversed credit is legal only through the idempotent replay path below; it
must never be reported as a fresh business reversal.

#### R1.5 API, permission and request contract

- Route: `POST /api/commercial-credit-notes/:id/reverse`.
- Body: `reversalDate` (required, `YYYY-MM-DD`, must be on or after `credit_date`) and `reason`
  (required, non-empty).
- Permission: `FINANCE_INVOICE_MANAGE`, identical to credit creation. **No new permission is introduced.**
- Idempotency: a header `Idempotency-Key` is **mandatory**, scoped to `COMMERCIAL_CREDIT_REVERSAL` and the
  credit note id. An exact replay returns the original result with `replayed: true`. The same key with a
  different reversal date or reason is rejected with `COMMERCIAL_CREDIT_REVERSAL_IDEMPOTENCY_CONFLICT`.
- A repeated reversal carrying a **new** idempotency key against an already-reversed note fails closed with
  `COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE`; it must not silently succeed.

#### R1.6 Lock order and atomicity

The reversal composes with the frozen Finance writers and must not create a reverse edge against the C1
PREPAYMENT parent-first chain of §35.18.6:

```text
0. unlocked identity discovery only (read the credit note, its derived adjustments and balance ids)
1. target FINAL AR / AP open item rows by id ASC
2. the credit's financial_credit_adjustments rows, then the derived CREDIT settlement balance, by id ASC
3. the commercial_credit_notes row, then the source invoice / bill row, by id ASC
4. the accounting voucher reversal, then idempotency result and audit
```

All of it executes inside one caller-owned transaction. A failure at any step rolls back the credit state,
the adjustment reversal, the balance reversal, the voucher reversal, the invoice recomputation, the
idempotency record and the audit together. There is no durable failed-attempt audit promise.

#### R1.7 Period and business-date rules

The reversal is a Finance operation dated by `reversalDate`. Both the credit's `credit_date` and the
`reversalDate` must fall in open accounting periods. Reversing into a period earlier than `credit_date` is
refused.

### R2. A3 Invoice lock order contract

#### R2.1 Target order

Invoice POST, VOID and Credit on Service-bearing invoices must take their locks in the §35.18.11.5
composable order, with no reverse edge against C1 or any frozen Finance path:

```text
0. unlocked identity discovery only — invoice id, its SO item ids, candidate CONFIRMED fulfillment ids,
   FINAL AR open item ids, existing link identities
1. SO line rows by id ASC
2. CONFIRMED service fulfillment rows by id ASC
3. FINAL AR open item rows by id ASC
4. invoice header row, then finance_invoice_source_links read and write
```

Non-Service invoices keep their existing behavior unchanged; the SO-line and Fulfillment stages are simply
empty for them and must not introduce a lock where none is needed.

#### R2.2 Re-read and retry

After stage 4 the authority is re-read beneath its own locks and the existing five-tuple replay contract and
capacity equalities of §35.18.11.3 / §35.18.12 are enforced unchanged. If a candidate set discovered at
stage 0 grew, the invoice is refused with a retryable `A3_INVOICE_SOURCE_PLAN_STALE` and the caller rolls
back and retries from discovery. A newly inserted candidate may only **increase** capacity-consumption
opportunity; omission is conservative and must never justify an over-allocation.

A retry must never acquire an additional Finance parent after a Sales lock, and must never add a link or a
source lock that was not in the discovered candidate set.

#### R2.3 VOID and Credit

- VOID must lock the same stages as POST before reversing anything, so a concurrent POST cannot interleave
  between source locking and voucher reversal. VOID leaves historical `finance_invoice_source_links` rows in
  place and immutable.
- Credit must lock the same stages, then apply the §35.18.12 multi-source allocation rules unchanged.
- R1 Credit reversal composes after R2: it locks the credit's own adjustments and balance, never re-entering
  the SO-line or Fulfillment stages, so it cannot invert the POST order.

#### R2.4 Prohibited shortcuts

The following are forbidden and must not be used to satisfy R2: relying on the MySQL adapter's global
transaction gate as the correctness proof; reordering only one local `FOR UPDATE` without auditing its
callers; introducing a shadow lock table; weakening the §35.18.11.3 replay or §35.18.12 conservation checks;
or treating an unlocked capacity `SUM` as if it were locked.

### R3. MySQL `lot_code_key` binary collation contract

#### R3.1 Identity semantics unchanged

R3 changes **only** the MySQL comparison semantics of the existing LOT canonical identity key. It does not
change LOT business meaning, does not introduce a new LOT code model, does not change `inventory_lots`,
`tracked_source_allocations` or any V21 position key, and does not create a fifth Wave 8 table. SQLite keeps
`COLLATE BINARY`; MySQL must reach binary parity.

#### R3.2 Target state

`consignment_commercial_lines.lot_code_key` is `VARCHAR(128) NOT NULL DEFAULT ''` with
`CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin` on MySQL, matching the approved byte-identity rule of
§35.18.2.

Two effective generation points must both be corrected, because the table is materialized by the shared
MySQL snapshot reconciliation **before** the Wave 8 migration runs:

1. the column generator, so a fresh MySQL database is created directly at the binary collation;
2. an additive, idempotent upgrade step, so an existing MySQL database is corrected without a rebuild.

#### R3.3 Pre-change safety

Before any collation change the upgrade must prove the existing data is safe to compare byte-exactly:

- the number of `lot_code_key` values that are equal under the case/accent-insensitive collation but
  **different** under binary comparison must be zero for every identity group participating in
  `uq_consignment_lines_identity`;
- otherwise the upgrade must fail closed with `WAVE8_LOT_KEY_COLLATION_AMBIGUOUS` and report the offending
  identity groups.

No automatic merge, coalesce, delete, rewrite, case-folding or LOT re-identification is permitted under any
condition. Ambiguity is an operator decision.

#### R3.4 Convergence and compatibility

- Fresh install, existing-database upgrade and repeated startup must all converge to the same binary
  collation without data repair and without destructive DDL.
- The Wave 8 MySQL physical-contract assertion must compare `lot_code_key`'s real collation, and
  `WAVE8_KNOWN_MYSQL_PARITY_GAPS` must no longer list R3 once the correction lands.
- All existing consignment LOT behavior — `chk_consignment_line_lot` pairing, FIFO entitlement, SERIAL exact
  identity, immutable handoff evidence — must be unchanged.

#### R3.5 Acceptance obligations

Fresh, upgrade and repeated migration on both backends; a metadata assertion proving the binary collation; an
ambiguity-detection test proving fail-closed; and SQLite/MySQL parity tests proving identical LOT identity
resolution for case-differing inputs.

### R4. Wave 8 Mobile workflow — remaining Stage D items (no new Requirement)

Mobile Workflow remains under the existing Stage D authorization; R1–R3 add nothing to it. The outstanding
implementation-only items, to be delivered in Stage D and not re-specified here, are:

1. remove the remaining raw id/JSON `window.prompt` inputs;
2. implement real business forms and selectors for warehouse, bin, position, LOT and SERIAL;
3. complete success, failure, permission-denied and business-conflict states for Service and Consignment;
4. execute the real-browser business-flow acceptance at 320 / 390 / 430 / 680 CSS px.

Route-width and mount checks must continue to be reported separately from real workflow acceptance.

### R5. Authorization boundary of this amendment

This amendment authorizes documentation only. No source, migration, test, frontend or configuration change,
no database operation, no test or build execution, and no Git operation is authorized by this Record.
Stage D is **not** resumed by this Record. `AGENTS.md §4.2` requires an explicit user confirmation after the
Requirement stage and before any Design stage.

---

## Wave 8 Final Closure — SALES Warehouse/Bin Reference Access Requirement Amendment (2026-10-21)

> This is a bounded **Requirement-only** amendment created after the final-closure audit proved that the
> current warehouse and bin master APIs cannot safely satisfy the Consignment workflow for a normal SALES
> actor. It preserves all approved Wave 8 business, Finance, Inventory, V21 evidence, schema and R1–R4
> contracts. It introduces no new SC / Invariant / UAT / Race / Audit Capability identifier and does not
> change the canonical counts. Design and Implementation remain stopped pending the governance gates below.

### A. Verified gap and coverage

The current implementation does not provide a legitimate SALES reference-data path:

- `GET /api/warehouses` is guarded by `WAREHOUSES_VIEW OR WAREHOUSES_MANAGE` and returns the warehouse
  master payload, including `address`, `manager`, `createdAt` and `updatedAt`. The standard SALES role has
  neither warehouse permission and receives 403.
- `GET /api/warehouse-bins` is guarded by `WAREHOUSE_BIN_VIEW OR WAREHOUSE_BIN_MANAGE`, returns bin-master
  lifecycle data, and is likewise unavailable to the standard SALES role.
- The current Wave 8 page catches the warehouse 403 and leaves the selector empty. That is graceful
  rendering, not a Handoff/Return business-flow closure. Handoff still accepts a raw optional bin id and
  Return still accepts a raw destination bin id, so the approved selector requirement is not fulfilled.

Coverage is therefore `MISSING` for a narrow, business-context-bound SALES warehouse/bin reference read.
Granting `WAREHOUSES_VIEW`, `WAREHOUSES_MANAGE`, `WAREHOUSE_BIN_VIEW` or `WAREHOUSE_BIN_MANAGE` to SALES is
not an acceptable remedy because those capabilities belong to Inventory/Warehouse master-data ownership.

### B. Approved business access contract

A user may read warehouse/bin candidates for Wave 8 Consignment only when the user already has the
applicable legitimate Consignment access. Read access is operational reference access, not warehouse
master access and not inventory visibility.

1. The read path must require the narrow Consignment permission appropriate to the operation. A user with
   no Consignment access receives 403; authentication failure retains the platform's existing behavior.
2. The read path must be bound to an accessible Consignment business context rather than expose an
   unrestricted warehouse directory. The server must re-check the document/line scope and Sales Group
   authority before returning candidates.
3. Handoff source candidates are restricted to the document's immutable source warehouse; if that
   warehouse uses bins, only active bins belonging to that warehouse may be returned.
4. Return destination candidates include only active, legally selectable enterprise warehouses and, after
   a warehouse is selected, only active bins belonging to it. The exact allowed-destination scope rule is
   reserved for Stage C, but it must fail closed and may not be inferred solely by the client.
5. Inactive warehouses/bins are never offered as candidates. A mutation must revalidate active state,
   parent-child membership, bin-enabled rules and business scope inside its transaction; a prior reference
   response is never mutation authority.
6. Settlement does not choose a warehouse/bin. It continues to resolve immutable historical Handoff
   evidence and re-lock the current V21 position under the existing contract.

### C. Minimum disclosure and ownership

The response may disclose only the stable fields required to label and submit a choice:

- warehouse: `id`, `code`, `name`, and the minimum bin-enabled indicator needed to drive the selector;
- bin: `id`, `warehouseId`, `code`, `name`.

It must not disclose warehouse address, manager, audit timestamps, inventory quantity, valuation, cost,
LOT/SERIAL balances, stock-status administration, owner-dimension administration or warehouse configuration.
It must not provide create/update/deactivate/delete behavior.

Inventory/Warehouse remains the owner of warehouse/bin master data and V21 Position validation. Sales owns
only the contextual read orchestration and its Consignment business scope. No warehouse-management
permission is granted to SALES, no inventory canonical writer changes ownership, and no shadow inventory or
fifth Wave 8 business table is introduced.

### D. Compatibility and security constraints

- Prefer a safe existing reference primitive only if Stage C proves it has the exact narrow response and
  context-bound authorization above. Otherwise Stage C must specify one minimal read-only endpoint family.
- Existing `/api/warehouses` and `/api/warehouse-bins` management/read contracts and their Inventory role
  permissions remain unchanged; this amendment does not broaden them and does not change the global role
  seed by granting warehouse permissions to SALES.
- The reference path is read-only and requires no schema or migration change. SQLite/MySQL must return the
  same candidate semantics and field shape.
- Direct endpoint access without the required Consignment permission or outside the actor's Sales Group
  scope fails with 403 and returns no candidate data. Unknown, inaccessible or mismatched context fails
  closed without revealing whether the foreign record exists.
- Existing V21 mutation, evidence, idempotency, atomicity, ownership, tracking and valuation contracts remain
  authoritative. Client-submitted ids are untrusted and are revalidated by the mutation path.

### E. Workflow and acceptance obligations

After separately approved Design and Implementation, acceptance must prove with real HTTP requests and a
real standard SALES account that:

1. Handoff can select its permitted source warehouse and, where applicable, an active source bin and then
   complete without a warehouse-master permission grant.
2. Settlement completes from historical Handoff evidence without current-location inference or a location
   selector.
3. Return can select a permitted active destination warehouse/bin and complete at 320 / 390 / 430 / 680
   CSS px without raw warehouse/bin id entry.
4. A user lacking the applicable Consignment permission receives 403 from the new/narrow read path, and the
   SALES user continues to receive 403 from warehouse/bin management operations.
5. Stale, inactive, cross-warehouse, cross-scope and foreign-document candidate submissions fail closed with
   zero inventory, commercial, Finance, evidence, audit and idempotency side effects.

The R1 idempotency HTTP check, R2 call-chain/lock-order audit, independent-connection MySQL reversal races,
full regression, protected MySQL gates and browser workflow remain required by the user's final-closure
authorization. They are not executed in this Requirement stage.

### F. Stage C decisions required

Stage C must decide and document, without changing this business contract:

1. reuse versus a dedicated contextual endpoint, exact route(s), parameters and response schema;
2. the precise permission OR/AND expression for Handoff and Return reference reads;
3. how document/line Sales Group scope is loaded and how not-found versus forbidden is normalized;
4. the permitted Return destination scope and whether warehouse and bin lookup is one response or two;
5. active/bin-enabled filtering, stable ordering, empty-result behavior and stale-selection revalidation;
6. frontend loading/empty/error/403 behavior and removal of the remaining raw bin-id inputs;
7. focused authorization, disclosure, scope, SQLite/MySQL parity and real-browser tests.

### G. Preservation and resume gate

All existing dirty-worktree changes, completed R1–R4 implementation, untracked SQLite/WAL/SHM artifacts and
`APPLY_GUIDE.md` are preserved. This amendment neither accepts nor reverts any implementation and does not
declare Final Acceptance or Freeze.

Per `AGENTS.md §4.2`, the next step requires explicit user acceptance of this Requirement amendment. Only
then may a separately authorized Stage C append the bounded technical design to `solution.md`. Source,
migration, test, frontend, database and build work remains stopped until that Design is accepted and Stage D
is explicitly resumed for this amendment.

**Status: `WAVE8_SALES_REFERENCE_REQUIREMENT_DELIVERED — AWAITING_USER_ACCEPTANCE`. Hard Stop.**

---
