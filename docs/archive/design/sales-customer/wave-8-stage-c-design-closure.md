# Sales & Customer Wave 8 Stage C Design Closure（历史设计）

> 状态：`SUPERSEDED`
> Owner：Sales & Customer
> 权威来源：历史证据，非当前权威
> 来源：`solution.md` §35（§35.0–§35.17）（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 35. Sales & Customer Wave 8 — Stage C Design Closure (2026-10-19)

> Status: `WAVE8_STAGE_C_DESIGN_DELIVERED — AWAITING USER APPROVAL`.
>
> This section is an additive, bounded Design closure for the user-approved Wave 8 Stage B Requirement Closure. It does not rewrite frozen §29.18 / §29.19 / §29.31 / §29.41 / §29.43 / §29.44 / §30.17 / §30.18 text, does not authorize Implementation, and does not modify Wave 6 / Wave 7. The authoritative business scope remains `document.md` Wave 8 Stage B §A–§M.

### 35.1 Baseline, provenance reconciliation and scope

- Baseline: `feature/sales-waves6-13@25e28b4103367d39c1573485ac05be04f3337924`, package `1.6.2`; Wave 6 and Wave 7 remain FROZEN; Waves 9–13 remain OUT_OF_SCOPE.
- The Stage B §J correction register contains **12 numbered rows**. The current `document.md` and `log/2026-10-19.md` both display all 12. Therefore the task premise “12 corrections versus 11 displayed rows” does not describe the current repository state; no provenance fact error exists and no `document.md` clarification is appended.
- Register rows 1–12 are corrections to the earlier Audit claims. UD-1..UD-5 are later user constraints. DDN-SVC-1/2, DDN-CON-1/2/3 and DDN-MIG-1 are Stage C design questions. These three classes are not merged.
- Files designed for a later Implementation: one Wave 8 migration, `server/modules/service-fulfillment.js`, `server/modules/consignment.js`, a bounded `confirmSalesDelivery()` integration, owned-route registration, exact permissions, two contextual frontend surfaces, focused/acceptance/MySQL suites and gate registration.
- This Design introduces exactly four new tables and zero alteration of existing tables.

### 35.2 Design decisions and blockers

| Decision | Stage C outcome | Authority / effect |
|---|---|---|
| DDN-SVC-1 | `REQUIREMENT_DECISION_REQUIRED` for cancellation after economic recognition. PENDING may be cancelled; CONFIRMED may not transition to CANCELLED until the owner approves the reversal policy. | Existing Finance adapter can create/replay exposure but no frozen service-specific reversal contract exists. Implementation must return 409 `SERVICE_FULFILLMENT_REVERSAL_POLICY_REQUIRED` for post-recognition cancel. |
| DDN-SVC-2 | Explicit non-empty HTTP `Idempotency-Key` is required for CREATE / CONFIRM / CANCEL. | Technical consistency choice under §29.45; existing `idempotency_records` remains the canonical store. Missing key → 400 before mutation/audit. |
| DDN-CON-1 | Layer 1 + Layer 2 are re-read under one transaction; Layer 3 is called and re-read through the Finance canonical adapter in the same transaction. | Commercial capacity alone cannot prove physical availability. Finance remains authoritative for economic effect; Sales does not aggregate a second Finance ledger. |
| DDN-CON-2 | Commercial location must be active on create and on every handoff/settle/return mutation; its explicit warehouse/bin mapping must also be active and coherent. | Validate-on-write plus validate-on-mutation; historical rows remain readable after later deactivation. |
| DDN-CON-3 | `REQUIREMENT_DECISION_REQUIRED`. Stage C does not invent partial cancel/split semantics. DRAFT header may be cancelled only before physical handoff; instructed lines are immutable except settlement/return commands. | Quantity adjustment or partial cancel would create a new commercial policy not frozen in Stage B. |
| DDN-MIG-1 | One additive step: `wave-8-service-fulfillment-and-consignment`, ordered after Wave 7. | One migration owns the four mutually dependent tables; fresh/upgrade/replay share the same entrypoint. |
| Physical consignment writer | `BOUNDED_INTEGRATION_CONTRACT_EXTENSION_REQUIRED`. | Current V21 position can legally represent ENTERPRISE stock at an explicitly mapped warehouse/bin, but `applyInventoryMutation()` has no CONSIGNMENT source type and no commercial-location argument. Implementation is blocked until the bounded Inventory writer contract is separately approved. No shadow inventory is allowed. |

### 35.3 Shared scalar and identity rules

- IDs are application-generated opaque text (`TEXT` SQLite / `VARCHAR(128)` MySQL); timestamps are UTC ISO-8601 text (`TEXT` / `VARCHAR(32)`); business dates are `YYYY-MM-DD` (`TEXT` / `DATE`).
- All money is safe integer cents (`INTEGER` / `BIGINT`) with `>= 0` checks.
- New-table quantities use integer micro-units (`*_qty_micros`, scale 10^6; `INTEGER` / `BIGINT`) and never REAL/DOUBLE/DECIMAL. Conversion from existing `sales_order_items.quantity` uses the existing `quantityToMicros()` contract; API responses may expose display quantity plus authoritative micros.
- `version` starts at 1 and advances by compare-and-swap on mutable lifecycle commands. A stale expected version returns 409.
- Command identity is `(operation_type, entity_id, Idempotency-Key)` in existing `idempotency_records`; fingerprint includes every normalized field affecting business/economic effect and excludes transport noise. Same key/same fingerprint replays; same key/different fingerprint returns 409.
- Audit and idempotency success evidence is written inside the same business transaction. A rollback leaves neither success audit nor committed idempotency result.

### 35.4 `service_fulfillments` physical schema

| Column | SQLite / MySQL | Contract |
|---|---|---|
| `id` | TEXT PK / VARCHAR(128) PK | immutable fulfillment identity |
| `fulfillment_no` | TEXT / VARCHAR(64), UNIQUE NOT NULL | user-visible identity |
| `sales_order_id` | TEXT / VARCHAR(128), FK NOT NULL | authoritative SO header |
| `sales_order_item_id` | TEXT / VARCHAR(128), FK NOT NULL | R-SAL-22 capacity anchor |
| `product_id` | TEXT / VARCHAR(128), FK NOT NULL | immutable source snapshot equality check |
| `customer_id` | TEXT / VARCHAR(128), FK NOT NULL | immutable source/customer scope |
| `sales_group_id` | TEXT / VARCHAR(128), FK NULL | backend data-scope anchor |
| `confirmation_qty_micros` | INTEGER / BIGINT NOT NULL | `> 0`; service quantity |
| `unit_price_cents` | INTEGER / BIGINT NOT NULL | `>= 0`; source SO snapshot |
| `recognition_amount_cents` | INTEGER / BIGINT NOT NULL | exact allocated service amount; `>= 0` |
| `business_date` | TEXT / DATE NOT NULL | Finance/period authority |
| `confirmation_state` | TEXT / VARCHAR(16) NOT NULL | `PENDING / CONFIRMED / CANCELLED` |
| `finance_recognition_mode` | TEXT / VARCHAR(40) NULL | frozen Finance result snapshot |
| `finance_open_item_id` | TEXT / VARCHAR(128) NULL | Finance-owned result reference; no Sales FK ownership claim |
| `finance_source_type` | TEXT / VARCHAR(40) NULL | `SERVICE_FULFILLMENT` when recognized |
| `finance_source_id` | TEXT / VARCHAR(128) NULL | equals this row id when recognized |
| `confirmed_at/by`, `cancelled_at/by` | timestamp/user FK NULL | transition evidence |
| `version` | INTEGER NOT NULL DEFAULT 1 | optimistic command version |
| `created_at/by`, `updated_at/by` | timestamp/user FK | audit-support metadata |

Constraints and indexes:

```text
UNIQUE (fulfillment_no)
UNIQUE (sales_order_item_id, id)
CHECK (confirmation_qty_micros > 0)
CHECK (unit_price_cents >= 0 AND recognition_amount_cents >= 0)
CHECK (confirmation_state IN ('PENDING','CONFIRMED','CANCELLED'))
CHECK ((confirmation_state='PENDING' AND confirmed_at IS NULL AND confirmed_by IS NULL
        AND cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (confirmation_state='CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL
        AND cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (confirmation_state='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
        AND ((confirmed_at IS NULL AND confirmed_by IS NULL)
          OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL))))
CHECK ((finance_source_id IS NULL AND finance_source_type IS NULL)
    OR (finance_source_id=id AND finance_source_type='SERVICE_FULFILLMENT'))
INDEX idx_service_fulfillment_so_item_state (sales_order_item_id, confirmation_state, id)
INDEX idx_service_fulfillment_order (sales_order_id, id)
INDEX idx_service_fulfillment_group_date (sales_group_id, business_date, id)
```

The writer additionally proves under lock that the SO item belongs to the header/customer/product snapshot, the SO is eligible, A-61 is active/sales-enabled/service-classified, and confirmed capacity plus this command does not exceed `quantityToMicros(sales_order_items.quantity)`.

### 35.5 Consignment physical schema

#### 35.5.1 `consignment_commodity_locations`

| Column | Contract |
|---|---|
| `id` PK, `location_code` UNIQUE | commercial identity only; never a warehouse/bin identifier |
| `customer_id` FK NOT NULL | customer custody context |
| `name`, `address_text` NOT NULL | display/snapshot source |
| `physical_warehouse_id` FK NOT NULL | explicit mapping to existing active Inventory/Master warehouse |
| `physical_bin_id` FK NULL | explicit mapped bin; must belong to mapped warehouse |
| `active` boolean, `effective_from`, `effective_to` | validation window |
| `version`, created/updated actor/timestamp | CAS and evidence |

`UNIQUE(customer_id, location_code)`; date order and active checks are equivalent in both dialects. Mapping is explicit and validated; IDs are never inferred/equated. Deactivation does not rewrite historical mappings.

#### 35.5.2 `consignment_commercial_documents`

| Column | Contract |
|---|---|
| `id` PK, `document_no` UNIQUE | instruction identity |
| `customer_id`, `sales_group_id`, `source_warehouse_id` FKs | commercial/data-scope/source facts |
| `instruction_date`, `business_date` | business dates |
| `status` | `DRAFT / INSTRUCTED / PARTIAL_SETTLED / SETTLED / RETURNED / CANCELLED` |
| `currency_code` | frozen base-currency code only |
| `version`, created/updated/confirmed actor/timestamp | CAS/lifecycle evidence |

The header state is derived/advanced only after all lines are locked and recomputed. `CANCELLED` is permitted only from DRAFT while no physical mutation exists. `PARTIAL_SETTLED`, `SETTLED`, and `RETURNED` are consequences of line totals, not client-writable labels.

#### 35.5.3 `consignment_commercial_lines`

| Column | Contract |
|---|---|
| `id` PK, `document_id` FK, `line_no` | stable line identity; UNIQUE(document_id,line_no) |
| `sales_order_item_id` FK NULL | optional truthful Sales source; NULL never implies fabricated source |
| `product_id`, `consignment_commodity_location_id` FKs | item and commercial location |
| `lot_code` NULL, `lot_code_key` NOT NULL DEFAULT '' | display value plus normalized uniqueness key |
| `consigned_qty_micros` | positive commercial/instructed capacity |
| `settled_qty_micros`, `returned_qty_micros` | non-negative cumulative commercial effects |
| `unit_price_cents`, `settled_amount_cents`, `returned_amount_cents` | integer cents only |
| `handoff_movement_group_id` NULL | canonical V21 movement reference, not a stock balance |
| `last_finance_reference_id` NULL | convenience reference only; Finance rows remain authority |
| `version`, created/updated actor/timestamp | CAS/evidence |

Constraints:

```text
UNIQUE (document_id, line_no)
UNIQUE (document_id, product_id, consignment_commodity_location_id, lot_code_key)
CHECK (consigned_qty_micros > 0)
CHECK (settled_qty_micros >= 0 AND returned_qty_micros >= 0)
CHECK (settled_qty_micros + returned_qty_micros <= consigned_qty_micros)
CHECK (unit_price_cents >= 0 AND settled_amount_cents >= 0 AND returned_amount_cents >= 0)
CHECK ((lot_code IS NULL AND lot_code_key='') OR
       (lot_code IS NOT NULL AND length(trim(lot_code))>0 AND lot_code_key=lower(trim(lot_code))))
INDEX idx_consignment_line_doc (document_id, id)
INDEX idx_consignment_line_location_product (consignment_commodity_location_id, product_id, id)
INDEX idx_consignment_line_source (sales_order_item_id, id)
```

`lot_code_key` solves cross-dialect nullable uniqueness explicitly: NULL normalizes to the non-null empty key; non-null values normalize through the same application function and DB CHECK. The migration metadata tests must prove ordered UNIQUE columns and duplicate rejection on both SQLite and MySQL; ordinary nullable UNIQUE semantics are not relied upon.

### 35.6 SQLite/MySQL DDL and migration convergence

The migration module exports `SALES_WAVE8_TABLES` and `migrateSalesCustomerWave8ServiceConsignment(db)`. SQLite uses `CREATE TABLE IF NOT EXISTS` plus `CREATE INDEX IF NOT EXISTS`; MySQL uses InnoDB/utf8mb4, named FK/CHECK/UNIQUE/index objects and strict `information_schema` assertions. The logical schema above is exact; dialect types follow §35.3.

Migration order:

```text
1. consignment_commodity_locations
2. consignment_commercial_documents
3. consignment_commercial_lines
4. service_fulfillments
5. indexes and named constraints
6. assert table/column/type/null/default/PK/FK/UNIQUE/CHECK/index parity
```

Registry entry:

```text
{ id: 'wave-8-service-fulfillment-and-consignment', wave: 8,
  migrate: migrateSalesCustomerWave8ServiceConsignment }
```

Fresh bootstrap, existing upgrade and second replay must converge without row rewrite. A pre-existing same-name object is accepted only when metadata is compatible; otherwise startup fails closed with the exact object/column mismatch. No DROP/rename/destructive rollback is authorized. Operational rollback disables Wave 8 routes/writers while preserving populated additive evidence; physical removal requires a separate migration/data-retention approval.

#### 35.6.1 Authoritative cross-dialect DDL realization

The tables in §35.4–§35.5 are not illustrative. The migration must emit every listed column and constraint. SQLite uses the following physical scalar realization:

```text
id/reference/text/code/timestamp/business-date  → TEXT
money/quantity/version/boolean                   → INTEGER
PRIMARY KEY                                      → TEXT PRIMARY KEY
foreign key                                      → FOREIGN KEY(column) REFERENCES owner(id)
```

MySQL 8 uses the equivalent realization:

```text
id/reference              → VARCHAR(128)
document/code             → VARCHAR(64)
state                     → VARCHAR(24)
timestamp                 → VARCHAR(32)
business-date             → DATE
money/quantity            → BIGINT
version                   → INT
boolean                   → TINYINT(1)
engine/collation          → ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

For MySQL, every FK/CHECK/UNIQUE is named (`fk_w8_*`, `ck_w8_*`, `uq_w8_*`) and verified through `information_schema.REFERENTIAL_CONSTRAINTS`, `CHECK_CONSTRAINTS`, `KEY_COLUMN_USAGE` and `STATISTICS`. For SQLite, the same logical objects are verified through `PRAGMA table_info`, `foreign_key_list`, `index_list`, `index_info` and normalized `sqlite_master.sql`. Boolean CHECKs restrict values to 0/1. Business-date validation is performed at the API boundary and by dialect date parsing; timestamps remain portable ISO text.

The complete required column sets are:

```text
service_fulfillments(
  id, fulfillment_no, sales_order_id, sales_order_item_id, product_id,
  customer_id, sales_group_id, confirmation_qty_micros, unit_price_cents,
  recognition_amount_cents, business_date, confirmation_state,
  finance_recognition_mode, finance_open_item_id, finance_source_type,
  finance_source_id, confirmed_at, confirmed_by, cancelled_at, cancelled_by,
  version, created_at, created_by, updated_at, updated_by
)

consignment_commodity_locations(
  id, location_code, customer_id, name, address_text, physical_warehouse_id,
  physical_bin_id, active, effective_from, effective_to, version,
  created_at, created_by, updated_at, updated_by
)

consignment_commercial_documents(
  id, document_no, customer_id, sales_group_id, source_warehouse_id,
  instruction_date, business_date, status, currency_code, version,
  confirmed_at, confirmed_by, created_at, created_by, updated_at, updated_by
)

consignment_commercial_lines(
  id, document_id, line_no, sales_order_item_id, product_id,
  consignment_commodity_location_id, lot_code, lot_code_key,
  consigned_qty_micros, settled_qty_micros, returned_qty_micros,
  unit_price_cents, settled_amount_cents, returned_amount_cents,
  handoff_movement_group_id, last_finance_reference_id, version,
  created_at, created_by, updated_at, updated_by
)
```

All non-null/default/FK/CHECK/UNIQUE/index requirements are those enumerated in §35.4–§35.5; the migration metadata test treats any omitted item as failure. This explicit mapping avoids copying SQLite DDL verbatim into MySQL and avoids dialect-specific NULL uniqueness assumptions.

### 35.7 Service Fulfillment canonical writer and state machine

`server/modules/service-fulfillment.js` owns list/detail/create/confirm/cancel and exports a read-only `resolveConfirmedServiceEvidenceForDelivery()` adapter.

```text
CREATE:  none → PENDING
  lock SO header → SO line → active product_commercial_classification
  validate group/customer/product/source and remaining capacity
  insert row + audit + idempotency result

CONFIRM: PENDING → CONFIRMED
  lock SO header → SO line → all confirmed/pending fulfillment rows (id ASC)
  re-read service classification and aggregate confirmed micros
  calculate recognition_amount_cents from the immutable SO line snapshot using
  cumulative integer allocation:
    amount(this) = floor(line_amount_cents * cumulative_confirmed_micros / ordered_micros)
                 - floor(line_amount_cents * prior_confirmed_micros / ordered_micros)
  the final legal fulfillment therefore receives the exact rounding remainder
  invoke Wave 7 authorizeSalesPrepaymentGateForMutation at DELIVERY stage
  using current authoritative SO amount, received prepayment and business date
  call recognizeFinanceExposure(SERVICE_FULFILLMENT, fulfillment.id) exactly once
  persist returned Finance reference → state/version → audit → idempotency result

CANCEL: PENDING → CANCELLED
  allowed before recognition only; no Finance/Inventory effect
  CONFIRMED cancellation → 409 SERVICE_FULFILLMENT_REVERSAL_POLICY_REQUIRED
  until REQUIREMENT_DECISION_REQUIRED is resolved
```

Finance recognition has one source identity per fulfillment. `recognizeFinanceExposure()` remains Finance-owned. Wave 8 must add/verify the policy resolution for `source_type='SERVICE_FULFILLMENT'`; fallback DIRECT must not be silently accepted as policy configuration. No service COGS or Inventory mutation is created.

The fulfillment CONFIRM prepayment call is a reuse of the frozen Wave 7 gate, not a second policy engine. Later Sales Delivery CONFIRM still re-reads current authority and runs the gate again; the earlier pass does not authorize a later delivery. This ensures service Finance Recognition is never earlier than prepayment authorization, while the fulfillment Finance source identity prevents a second economic effect at delivery.

### 35.8 Sales Delivery mixed-line integration

The bounded modification stays inside `confirmSalesDelivery()` after the existing Delivery-stage prepayment authorization and before physical mutation. It builds two immutable plans from locked authoritative lines:

```text
physicalPlan = lines whose active A-61 service_classification = FALSE
servicePlan  = lines whose active A-61 service_classification = TRUE
missing/inactive A-61 = 409 SALES_CLASSIFICATION_REQUIRED (all rows rollback)
```

- Physical plan: existing reservation, OQC, Inventory OUT, tracked movement, valuation, COGS and physical-line Finance recognition remain unchanged.
- Service plan: lock SO line, prior confirmed Sales Delivery lines and confirmed fulfillments; require cumulative confirmed-delivery service micros including this delivery to be `<=` cumulative confirmed-fulfillment micros and `<=` SO capacity. Call `resolveConfirmedServiceEvidenceForDelivery()` to verify the existing Finance recognition references. It writes no Inventory, valuation, COGS or new AR/Revenue, so the same fulfillment cannot be reused beyond its quantity by later deliveries.
- `authoritativeLogisticsTotal()` is partitioned. `physicalRevenueCents` is recognized under `SALES_DELIVERY`; `serviceRevenueCents` must equal already-recognized fulfillment allocations and is excluded from Sales Delivery recognition. This is the single-recognition rule.
- Pure service delivery: no Inventory/valuation/COGS rows; service evidence is verified; delivery becomes CONFIRMED; Sales Delivery revenue/AR effect is zero because the service fulfillment owns it.
- Pure physical delivery: frozen current path.
- Mixed delivery: physical side effects only for physical lines; service references only for service lines; one transaction and one final delivery state.
- Partial/multiple service fulfillment: confirmed aggregate may satisfy a delivery line across multiple fulfillment rows; rows are consumed in `(business_date,id)` order only for evidence allocation and are not rewritten. Delivery quantity may not exceed confirmed service evidence or SO capacity.
- Prepayment Gate always runs first for the whole Delivery and is never bypassed. A failure rolls back both service verification and physical effects.
- Replay uses the existing Delivery command key; same delivery cannot duplicate either physical or service economic effect.

SVC-1 design proposal is therefore: recognition occurs at Service Fulfillment CONFIRM, not again at Delivery CONFIRM. If the owner instead wants recognition at Delivery, Stage B Requirement must be reopened because the current contract explicitly describes fulfillment confirmation as triggering Finance recognition.

### 35.9 Consignment three-truth lifecycle and adapters

Layer owners:

```text
Layer 1 Sales: consignment documents/lines/locations; instruction and commercial capacity
Layer 2 Inventory V21: physical position/movement, ENTERPRISE ownership until settlement
Layer 3 Finance V22: AR, settlement, credit/refund and economic reversal
```

Flow:

1. Create DRAFT instruction and lines; validate active A-61, customer/group scope, active commercial location and explicit warehouse/bin mapping.
2. Confirm instruction (`DRAFT → INSTRUCTED`): lock document/lines, validate mapped source and destination positions, invoke the bounded Inventory adapter to MOVE from `source_warehouse_id` to mapped site position with `owner_type='ENTERPRISE'`; save movement-group reference. No AR/revenue.
3. Settle quantity: lock line, mapped ENTERPRISE position and Finance source identity; remaining = consigned − settled − returned. OUT the settled quantity from enterprise inventory at the site (ownership leaves the ERP inventory ledger), then create/replay Finance AR/revenue. Each partial-settlement command uses immutable event identity `CONSIGNMENT_SETTLEMENT:<lineId>:<Idempotency-Key>` as the Finance source id; the existing `idempotency_records` result stores that event id and Finance reference. This avoids attempting to enlarge an existing Finance open item whose canonical adapter requires immutable source amount. Update cumulative line totals and header derived status; Finance event rows, not `last_finance_reference_id`, are historical economic authority.
4. Commercial return: the frozen Stage B text is ambiguous about whether return only restores commercial capacity at the consignment site or physically moves stock back to an internal warehouse. Stage C does not invent a destination. The endpoint remains 409 `CONSIGNMENT_RETURN_DESTINATION_POLICY_REQUIRED` until `REQUIREMENT_DECISION_REQUIRED` resolves this point. It must never fabricate a return warehouse or CUSTOMER ownership.
5. Reporting joins Layer 1 with V21 movement/position references and Finance source rows. Differences are reported; GET never repairs them.

Inventory adapter extension required before implementation:

```text
source types: CONSIGNMENT_HANDOFF, CONSIGNMENT_SETTLEMENT, CONSIGNMENT_RETURN
input: commercialLocationId as audit/source context only (NOT a position-key dimension)
position: explicit mapped warehouse/bin + ENTERPRISE owner
semantics: HANDOFF=MOVE, SETTLEMENT=OUT, RETURN=bounded MOVE after owner decision
valuation: HANDOFF is a value-preserving location transfer using valuationMode=EXTERNAL
           plus the existing canonical transfer-value adapter; it must not issue value
           twice through the current best-effort per-movement loop
same outer transaction, period/tracking/valuation/audit/idempotency contracts retained
```

This is a bounded extension to the canonical writer, not a new table or shadow stock ledger.

### 35.10 Concurrency and unified lock order

All Wave 8 writes use one caller-owned transaction. SQLite uses `BEGIN IMMEDIATE`. MySQL uses indexed `FOR UPDATE` reads in this global order:

```text
1. Sales document header (SO or consignment document), ascending id
2. Sales capacity line (sales_order_items or consignment_commercial_lines), ascending id
3. Wave 8 child rows (service fulfillments / consignment lines), ascending id
4. Inventory V21 positions by position_key ASC, then LOT/SERIAL identities and locks
5. Finance canonical source/open-item/settlement identity in the Finance adapter's order
6. idempotency result, then append-only audit
```

- R-SAL-22: two confirmations lock the same SO line before aggregate; combined confirmed micros cannot exceed order micros. One/both may succeed only within remaining capacity.
- R-SAL-20: two settlements lock the same consignment line, then the same position and Finance identity; combined settled+returned cannot exceed consigned or physical ENTERPRISE quantity.
- R-SAL-21: settlement and return use the same line lock and order. Until return destination policy is approved, return fails closed before Inventory/Finance mutation; after approval, exactly one legal serialized result is allowed.
- No path checks only Layer 1. Inventory and Finance failures roll the entire caller transaction back.
- Real MySQL evidence uses independent worker processes/connections and `mysql_transaction_gates.gate_id=1` only as a synchronization observer, never as the business lock.

### 35.11 API, RBAC, data scope, audit and idempotency matrix

| API | Permission | Data scope / locked authority | Audit | Idempotency |
|---|---|---|---|---|
| `GET /api/service-fulfillments` / `:id` | `SERVICE_SALES_VIEW` | actor sales-group scope; ADMIN explicit bypass | read access log only, no business audit | n/a |
| `POST /api/service-fulfillments` | `SERVICE_SALES_MANAGE` | SO/customer/group/line/A-61 | CREATE | required header |
| `POST /api/service-fulfillments/:id/confirm` | `SERVICE_SALES_MANAGE` | SO line + fulfillment aggregate + Finance source | CONFIRM | required header |
| `POST /api/service-fulfillments/:id/cancel` | `SERVICE_SALES_MANAGE` | fulfillment row/version | CANCEL; confirmed path blocked | required header |
| `GET /api/consignment-commercial-documents` / `:id` / `:id/remaining` | `CONSIGNMENT_VIEW` | customer + sales-group scope | no business mutation audit | n/a |
| `GET /api/consignment-commercial-report` | `CONSIGNMENT_VIEW` | scoped filters + authoritative three-layer projection | REPORT_QUERY with filter digest/result count; no sensitive result detail | n/a |
| `GET/POST/PATCH /api/consignment-commodity-locations` | VIEW / `CONSIGNMENT_MANAGE` | customer scope + warehouse/bin reference validation | CREATE/UPDATE/DEACTIVATE | write header required |
| `POST /api/consignment-commercial-documents` | `CONSIGNMENT_MANAGE` | customer/group/location/source refs | CREATE | required header |
| `PATCH /api/consignment-commercial-documents/:id` | `CONSIGNMENT_MANAGE` | DRAFT + expected version only | UPDATE | required header |
| `POST /api/consignment-commercial-documents/:id/instruct` | `CONSIGNMENT_MANAGE` | doc/lines + mapped V21 positions | INSTRUCT | required header |
| `POST /api/consignment-commercial-lines/:id/settle` | `CONSIGNMENT_MANAGE` | line + V21 + Finance | SETTLE | required header |
| `POST /api/consignment-commercial-lines/:id/return` | `CONSIGNMENT_MANAGE` | blocked pending return policy; later line+V21+Finance | RETURN | required header |
| `POST /api/consignment-commercial-documents/:id/cancel` | `CONSIGNMENT_MANAGE` | DRAFT/no movement only | CANCEL | required header |

Exact uppercase permissions are registered in Platform and mapped without widening the five-role baseline: ADMIN receives all; SALES receives VIEW+MANAGE; REVIEWER receives VIEW only; WAREHOUSE/ACCOUNTING receive no Wave 8 write authority. Wave 8 permissions narrow rather than replace the frozen Sales permissions: every write requires both `SALES_MANAGE` and the matching Wave 8 `*_MANAGE`; every read requires (`SALES_VIEW` or `SALES_MANAGE`) and the matching Wave 8 (`*_VIEW` or `*_MANAGE`). Frontend route visibility consumes VIEW/MANAGE, but every handler independently enforces backend permission and group scope. Denial is 403 and produces no success audit/idempotency record. The consignment report is the Stage B exception to ordinary read-only audit behavior: each success or failure writes one `REPORT_QUERY` audit row through the common audit writer, without storing sensitive result rows.

### 35.12 Frontend and route design

- `consignment` is a contextual route under existing `orders`, not a launcher primary entry. Screen owner: `src/pages/consignment.jsx`.
- `service-fulfillments` is a contextual Sales Order sub-page under `orders`, opened with whitelisted `salesOrderId` and optional `salesOrderItemId`; screen may live in the same Wave 8 page module or a dedicated bounded component, but only one active route/screen exists.
- Registry permissions are `CONSIGNMENT_VIEW/MANAGE` and `SERVICE_SALES_VIEW/MANAGE`; direct URL, refresh, Back and Forward use RouteLocation.
- LIST → DETAIL → WORKFLOW; 320/390/430/680 CSS px; no permanent horizontal scroll; status/source/remaining/primary action precede secondary metadata. No global IA redesign and no new launcher entry.

### 35.13 Acceptance and test architecture

| Trace | Required evidence |
|---|---|
| SC70/71, S08, UAT-S-25 | pure service, physical, mixed delivery; partial/multiple fulfillment; insufficient evidence; missing A-61; prepayment gate pass/block; single AR/revenue; zero service Inventory/COGS; rollback/replay |
| SC72–77, S18, UAT-S-26/27/41 | instruction, explicit location mapping, ENTERPRISE handoff, settlement, physical/Finance failure rollback, reporting trace; return remains blocked until owner policy + V21 extension approval |
| service/prepayment relation | fulfillment CONFIRM passes Wave 7 DELIVERY gate before Finance; later delivery rechecks current authority without duplicate economics |
| reporting audit | every consignment report query writes one scoped REPORT_QUERY audit row without persisting sensitive result detail |
| R-SAL-22 | two independent sessions against one service line; combined micros ≤ capacity; no duplicate Finance effect |
| R-SAL-20 | two settlement sessions; combined settled ≤ commercial and physical remaining; one Finance effect per command |
| R-SAL-21 | settle-vs-return independent sessions after policy approval; before approval return deterministically fails closed |
| CAP-25/26 | only transition MISSING→COVERED at final Freeze after all evidence passes |

Planned files:

```text
server/sales-customer-wave8-migration.test.js
server/sales-customer-wave8-functional.test.js
server/sales-customer-wave8-acceptance.test.js
server/mysql-sales-customer-wave8.integration.js
server/mysql-sales-customer-wave8-concurrency.integration.js
scripts/gates/mysql-concurrency-sales-wave8-worker.mjs
scripts/acceptance/sales-customer-wave8-responsive.mjs
```

Register focused suites in `scripts/testing/test-suites.js` preserving `FAST ⊆ FULL`, `FULL ∩ HEAVY = ∅`. Register MySQL metadata and concurrency suites in the existing gates. Archive complete raw TAP for both real-MySQL gates under dated `.tmp/` artifacts before Final Acceptance. Wave 8's first real independent-session proof cannot be replaced by Wave 13.

No test/build/database command is executed in Stage C.

### 35.14 Implementation file plan and bounded gates

1. `server/migrations/sales-customer-wave8-service-consignment.js` — four-table SQLite/MySQL additive migration and strict metadata assertions.
2. `server/migrations/sales-customer-domain.js` — append the one Wave 8 step.
3. `server/modules/service-fulfillment.js` — canonical writer/read adapter.
4. `server/modules/consignment.js` — commercial writer; physical commands remain blocked until V21 extension approval.
5. `server/lib/inventory-mutation.js` — only after separate bounded integration approval, add the three source types/context without changing position identity.
6. `server/app.js` — owned-route imports/registration plus bounded mixed-line `confirmSalesDelivery()` integration.
7. Platform permission seed/reconciliation owner — add exact four permissions and role mappings.
8. `src/api.js`, `src/navigation/applicationRegistry.js`, `src/pages/consignment.jsx`, contextual Service Fulfillment surface — no launcher expansion.
9. Focused/acceptance/MySQL/worker/responsive files from §35.13 and exact suite/gate registration.

Implementation may not start until the user approves this Design and separately resolves/authorizes:

- `REQUIREMENT_DECISION_REQUIRED`: confirmed Service Fulfillment reversal/cancellation policy;
- `REQUIREMENT_DECISION_REQUIRED`: consignment partial cancel/split policy;
- `REQUIREMENT_DECISION_REQUIRED`: physical destination/economic semantics of consignment commercial return;
- `BOUNDED_INTEGRATION_CONTRACT_EXTENSION_REQUIRED`: Inventory V21 consignment writer source contract.

### 35.15 Dependency reconciliation

| Dependency class | Wave 8 dependency |
|---|---|
| Schema | Wave 1 A-61 product classification; Wave 3–5 SO/Delivery source rows; four new Wave 8 tables; no Wave 7 FK |
| Business | approved SO/service line; Wave 7 prepayment policy remains applicable at Delivery; Inventory ownership and Finance recognition contracts |
| Runtime | `confirmSalesDelivery()` already invokes `authorizeSalesPrepaymentGateForMutation()`; Wave 8 must preserve it and then perform mixed-line planning |
| Execution order | Wave 7 is a satisfied prerequisite of Wave 8 because the runtime path is already installed; Wave 6 remains an earlier frozen prerequisite |

Recommended future clarification (not a historical rewrite): §30.17 Wave 8 dependency stays “Wave 7”; §30.18's DAG should show `Wave 5 → Wave 6 → Wave 7 → Wave 8` for project execution, while schema edges remain independently documented. This new §35 is the active reconciliation; frozen §30.17/§30.18 text is untouched.

### 35.16 Conflicts, remaining blockers and hard stop

1. Stage B provenance is internally 12/12; no document correction required.
2. Frozen §29.18 is under-specified for quantity precision, versioning, full API/RBAC and single-recognition integration; this §35 supplies the technical design without rewriting it.
3. Frozen §29.19 text suggests a commercial location can be used as an Inventory location, but the real V21 position key has no such dimension. The explicit warehouse/bin mapping plus bounded writer extension is the only legal path found. No CUSTOMER-owned proxy and no shadow stock ledger are allowed.
4. Current `confirmSalesDelivery()` recognizes the whole Delivery after performing Inventory/COGS for every line. Implementation must apply the partitioned plan in §35.8 atomically; a cosmetic pre-check is insufficient.
5. Post-recognition service cancellation, consignment partial cancel/split, and physical consignment return destination are unresolved business semantics. They are not silently approved by this Design.

**Final status: `WAVE8_STAGE_C_DESIGN_DELIVERED — AWAITING USER APPROVAL`. Hard Stop: no Implementation, test, build, migration execution, database action, or Git write is authorized.**

### 35.17 Wave 8 Stage C bounded design correction (2026-10-19)

> This sub-section is the active correction layer for §35.2–§35.16. Where a rule below conflicts with an earlier §35 rule, this sub-section supersedes that earlier Wave 8 rule only. Frozen §28–§30 and the Stage B Requirement record are not changed. No runtime claim is made and no Implementation is authorized.

#### 35.17.1 Correction disposition

| Blocker | Corrected sections | Disposition | Evidence boundary |
|---|---|---|---|
| P1-1 | §35.7–§35.10, §35.13–§35.16 | `EXTERNAL_CONTRACT_REQUIRED` | Frozen §29.17.7.5 requires Finance PREPAYMENT parent locks before Sales canonical locks. Current `authorizeSalesPrepaymentGateForMutation()` locks/reads Sales gate facts before its Finance adapter, while current Delivery also locks Delivery/capacity/SO facts before calling it. Wave 8 cannot rewrite this frozen Wave 7 contract. |
| P1-2 | §35.7–§35.10, §35.13 | `RESOLVED_WITH_DESIGN_EVIDENCE` for fail-closed protection; historical legacy ambiguity remains explicitly unknown | A-61 is one mutable current row; `audit_logs` is not a reconstructable classification snapshot. `applySalesOrderChange()` currently protects delivered/notified quantity but not Service Fulfillment. The correction adds shared anchors and forbids reinterpretation. |
| P1-3 | §35.4, §35.7–§35.8, §35.13–§35.16 | `REQUIREMENT_REOPEN_REQUIRED` | Stage B requires Finance recognition but does not choose DIRECT, INVOICE_DRIVEN or PROVISIONAL for `SERVICE_FULFILLMENT`; the Finance resolver currently falls back to DIRECT when policy is absent. Zero-amount service and invoice association are also undecided. |
| P1-4 | §35.4, §35.6 | `RESOLVED_WITH_DESIGN_EVIDENCE` for static state combinations, conditional on P1-3 | The corrected CHECK contract excludes confirmed evidence from CANCELLED and distinguishes DB-static constraints from transactional invariants. A legal CONFIRMED Finance evidence shape cannot be finalized until the recognition mode decision exists. |
| P1-5 | §35.5, §35.9–§35.10, §35.13–§35.16 | mapping protection `RESOLVED_WITH_DESIGN_EVIDENCE`; deactivation behavior `REQUIREMENT_REOPEN_REQUIRED` | A line stores only the commercial-location FK, not a warehouse/bin snapshot. Therefore mapped warehouse/bin is immutable while any handed-off quantity remains unsettled/unreturned. Stage B does not decide whether deactivation blocks settlement of historical stock. |
| P1-6 | §35.5–§35.6, §35.9, §35.11, §35.13–§35.16 | parity/audit distinction `RESOLVED_WITH_DESIGN_EVIDENCE`; amount and lot identity `REQUIREMENT_REOPEN_REQUIRED` | The four-table line has unit price and cumulative amount but no immutable net line-amount/version source. The repository has no canonical lot-code normalization algorithm; V21 keys by opaque `lot_id`, not normalized display code. |

#### 35.17.2 P1-1 — cross-domain transaction and lock contract

The earlier §35.7 statement “lock SO, line and fulfillment, then invoke the Gate” and the generic §35.10 order “Sales → Inventory → Finance” are withdrawn. They conflict with the frozen Wave 7 order and must not be implemented.

Required external closure:

```text
EXTERNAL CONTRACT: W8-W7-LOCK-ORCHESTRATOR

provide one transaction-inheriting orchestration contract which:
1. identifies eligible PREPAYMENT parent ids using non-authoritative read-only discovery;
2. acquires settlement_unapplied_balances.id FOR UPDATE in id ASC order first;
3. re-reads requirement, child effects and gate authority beneath those locks;
4. then acquires Sales/Inventory/Finance-recognition locks in the path order below;
5. never treats the discovery read as authorization;
6. uses one connection and one commit/rollback boundary;
7. documents the internal locks taken by recognizeFinanceExposure().
```

Until Finance/Wave 7 owns and approves that composable contract, Service Fulfillment CONFIRM and the Wave 8 mixed-Delivery modification are blocked. Calling the existing Gate after Sales locks, or adding an unlocked precheck before the transaction, does not close P1-1.

Path lock plans after that external contract is available:

| Path | Read-only checks before locks | Deterministic lock acquisition | Same transaction/connection and atomic boundary |
|---|---|---|---|
| Service Fulfillment CONFIRM | parse/auth/key/fingerprint; discover SO/customer/requirement and candidate PREPAYMENT ids only | PREPAYMENT parents id ASC → effective Gate requirement/result → SO header → SO line id → fulfillments id ASC → A-61 row → Finance recognition source/open-item locks in Finance-owned order → idempotency/audit | Gate evidence, fulfillment state, Finance result, success audit and idempotency commit or roll back together |
| Sales Delivery CONFIRM | parse/auth/replay; discover source SO and PREPAYMENT candidates only | PREPAYMENT parents id ASC → Gate facts → Delivery header/source-capacity anchors in frozen Wave 5 order → SO header/lines id ASC → fulfillments id ASC for service evidence → Inventory positions position_key ASC and tracking locks → Finance recognition locks → idempotency/audit | pure/mixed plan, all physical and economic effects, Gate evidence and Delivery state are one atomic unit |
| Consignment Handoff | parse/auth/key; validate identifiers without accepting them as authority | commercial document → lines id ASC → location rows id ASC → mapped warehouse/bin references id ASC → Inventory source/destination position_key ASC → tracking/valuation locks → idempotency/audit | Layer 1 instruction and V21 handoff either both commit or both remain absent; canonical Inventory adapter inherits caller transaction |
| Consignment Settlement | parse/auth/key; discover Finance policy/source only | document → commercial line → location → mapped position_key ASC → tracking/valuation locks → Finance recognition source/open-item locks in Finance-owned order → idempotency/audit | physical OUT, cumulative commercial settlement, Finance effect and audit are one atomic unit |
| Consignment Return | fail with `CONSIGNMENT_RETURN_DESTINATION_POLICY_REQUIRED` before mutation while policy is unresolved | no business locks beyond the minimal authoritative read needed to establish the block | zero Inventory/Finance/commercial success effects |
| Location mapping update/deactivation | parse/auth/version; read candidate dependent line ids without deciding from the unlocked read | affected commercial documents id ASC → lines id ASC → location row → current and proposed warehouse/bin references → any outstanding V21 position_key ASC | mapping/version/audit commit together; mapping change fails if handed-off outstanding quantity exists |
| A-61 classification update | parse/auth; discover affected non-terminal SO ids only | affected SO headers id ASC → SO lines id ASC → fulfillments id ASC → A-61 row/product reference | classification change and audit commit together; any protected obligation/fact blocks the change |
| SO Change application | existing change evidence checks | existing change/order order → affected SO lines id ASC → fulfillments id ASC → existing downstream anchors | change/version/evidence/audit remain one atomic unit; Service floors are re-read under lock |

Known cycle analysis:

- Gate versus PREPAYMENT consumption is closed only by W8-W7-LOCK-ORCHESTRATOR; without it P1-1 remains external.
- Service CONFIRM versus SO Change shares `sales_order_items.id`, then locks fulfillment rows id ASC; one sees the other's committed capacity or waits.
- Service CONFIRM versus mixed Delivery shares SO line then fulfillment rows; Delivery consumes evidence only after the same ordered locks.
- Settlement versus Return shares commercial line then the same mapped Inventory positions; Return remains fail-closed before mutation pending its Requirement decision.
- Mapping update versus handoff/settlement shares document/line/location before Inventory positions. Mapping updater may not lock location first and later seek a line lock.
- `recognizeFinanceExposure()` is transaction-inheriting, but its current source/open-item reads do not expose a complete public FOR UPDATE order. Consignment Settlement therefore also requires a Finance-owned composable recognition-lock contract before Implementation: `EXTERNAL_CONTRACT_REQUIRED`.

#### 35.17.3 P1-2 — A-61 meaning and Service capacity

A-61 is current configuration, not historical truth. The active rules are:

1. Missing/inactive/ambiguous A-61 always fails closed for new Service Fulfillment, Handoff and Delivery confirmation. Absence is never physical classification.
2. A change of `service_classification`, `sales_enabled` or `active` is rejected while the product appears on any SUBMITTED/APPROVED commercially open SO line, PENDING/CONFIRMED Service Fulfillment, DRAFT/INSTRUCTED/partially settled consignment line, or unconsumed Delivery evidence. This is a writer guard, not an assumption about current code.
3. Previously executed facts are classified by their immutable effects: Service Fulfillment evidence identifies service execution; Inventory/tracked/valuation evidence identifies physical execution. Reports must not reclassify those facts by joining the current A-61 value.
4. Legacy history without either authoritative effect set is displayed as unknown and cannot be newly confirmed or converted. `audit_logs` is not used to fabricate a former A-61 value.
5. Service CONFIRM and mixed Delivery re-read A-61 only after locking the source line; classification update locks the same affected lines before A-61. This prevents a concurrent flip from changing the meaning mid-command.

SO Change correction:

- `applySalesOrderChange(...)` remains the only approved application entry.
- Under the affected SO-line lock it also locks all Service Fulfillment rows by id and computes PENDING, CONFIRMED and remaining separately.
- New quantity may not be below confirmed + pending micros. A PENDING row may be explicitly cancelled first; the SO Change does not cancel it implicitly.
- Once any CONFIRMED Service Fulfillment exists, quantity, price, discount and amount changes for that line fail closed with `SERVICE_FULFILLMENT_IMMUTABLE_COMMERCIAL_BASIS`. Existing recognized amount/history is never recalculated. ADD of unrelated lines remains governed by the frozen SO Change contract.
- With PENDING-only rows, quantity may change only above their aggregate and the pending rows retain quantities but no recognized amount. A classification flip is still prohibited.

This conservative boundary closes capacity/history protection without adding a snapshot column. A future desire to reprice or resize a partially confirmed service obligation is a new business policy and requires Requirement reopen.

#### 35.17.4 P1-3 — Service Finance contract remains Requirement-blocked

The following facts are established:

- canonical identity is `source_type='SERVICE_FULFILLMENT'`, `source_id=service_fulfillments.id`, with one immutable source per fulfillment;
- Sales may call only `recognizeFinanceExposure()` and may not resolve policy itself or write Finance tables;
- missing `SERVICE_FULFILLMENT` policy must fail with `SERVICE_FINANCE_RECOGNITION_POLICY_REQUIRED`; the resolver's current `scope='FALLBACK'` DIRECT result is forbidden for this source;
- the amount basis is the SO line's current approved effective commercial evidence (`amount_cents` plus validated price/discount evidence), read under its version/line lock before the first confirmed fulfillment; after first confirmation §35.17.3 freezes that commercial basis;
- quantity uses micros and amount allocation uses BigInt intermediate arithmetic:
  `floor(line_amount_cents*cumulative_micros/ordered_micros) - floor(line_amount_cents*prior_micros/ordered_micros)`;
- operands must be non-negative safe integers at API/DB boundaries, denominator > 0, cumulative ≤ ordered, and the BigInt result must fit the project's safe-integer cents boundary before adapter invocation;
- each CONFIRMED row stores its immutable allocated cents; later confirmations never rewrite earlier rows; final legal confirmation receives the exact remainder;
- Delivery only locks, validates and consumes aggregate confirmed service evidence in deterministic order. It creates no second Finance exposure.

Stage B does not authorize the one legal recognition mode, the zero-amount gift/free-service treatment, or how a later Sales Invoice links/converts the Service source. DIRECT, INVOICE_DRIVEN and PROVISIONAL have materially different open-item and invoice behavior in §28.2.3. Therefore no mode is selected here and Service CONFIRM remains blocked by `REQUIREMENT_REOPEN_REQUIRED`. The owner must decide:

1. the permitted recognition mode(s) for `SERVICE_FULFILLMENT` and effective-policy governance;
2. whether zero-amount service may CONFIRM without an open item and what constitutes its Finance evidence;
3. the canonical invoice-source/link and provisional-conversion behavior;
4. confirmed cancellation/reversal policy already identified by DDN-SVC-1.

#### 35.17.5 P1-4 — corrected Service Fulfillment constraint model

The earlier §35.4 state CHECK allowing a CANCELLED row to retain confirmation fields is superseded. The physical contract is:

```text
id TEXT PRIMARY KEY NOT NULL (SQLite explicit) / VARCHAR(128) NOT NULL PRIMARY KEY (MySQL)
all other required IDs explicitly NOT NULL; version >= 1
confirmation_qty_micros > 0
unit_price_cents >= 0
recognition_amount_cents >= 0

PENDING:
  confirmed_at/by, cancelled_at/by and all finance_* fields are NULL
  recognition_amount_cents = 0

CONFIRMED:
  confirmed_at/by NOT NULL; cancelled_at/by NULL
  finance_recognition_mode, finance_source_type, finance_source_id NOT NULL
  finance_source_type='SERVICE_FULFILLMENT' AND finance_source_id=id
  recognition_amount_cents follows the approved P1-3 zero/non-zero policy
  finance_open_item_id nullability follows the approved recognition mode

CANCELLED:
  cancelled_at/by NOT NULL; confirmed_at/by NULL
  all finance_* fields NULL
  recognition_amount_cents = 0
```

DB CHECK can guarantee these static field combinations, state enumeration, numeric ranges and self source identity. FK/UNIQUE can guarantee source references and identities. DB CHECK cannot guarantee legal transition direction, aggregate capacity, current A-61 meaning, Finance row existence across polymorphic source types, policy effectiveness, idempotent adapter execution or lock order. Those are transaction-writer invariants. `PENDING → CONFIRMED` and `PENDING → CANCELLED` are the only current transitions; CONFIRMED cancellation stays blocked.

SQLite `TEXT PRIMARY KEY` is not treated as sufficient nullability evidence: every primary and required reference declares `NOT NULL` explicitly. MySQL uses named CHECK/FK/UNIQUE objects with equivalent predicates.

#### 35.17.6 P1-5 — Consignment Location lifecycle

- New document creation and Handoff require an active/effective commercial location and active/coherent mapped warehouse/bin.
- Physical mapping may change only when no line referencing that location has a non-null handoff movement with `consigned_qty_micros - settled_qty_micros - returned_qty_micros > 0`. The guard is re-read under the lock plan in §35.17.2.
- A mapping change never relocates stock and never changes the meaning of a prior movement. If physical stock remains, the change is 409 `CONSIGNMENT_LOCATION_MAPPING_IN_USE`.
- DRAFT lines without handoff may resolve the new mapping when later instructed. Historical movement queries use `handoff_movement_group_id` and V21 movement/position evidence, never the location's current mapping.
- Deactivation always blocks new documents and new Handoff. Stage B does not decide whether historical outstanding stock may still settle after location deactivation. Settlement/deactivation behavior is therefore `REQUIREMENT_REOPEN_REQUIRED`; neither “block all” nor “allow all” is approved here.
- Return remains blocked by `CONSIGNMENT_RETURN_DESTINATION_POLICY_REQUIRED`; no current mapping is used to fabricate a destination.

#### 35.17.7 P1-6 — amount, parity, lot identity and audit

Consignment amount:

- quantity authority is the locked commercial line plus the matching ENTERPRISE-owned V21 position; `remaining = consigned - settled - returned`;
- each command has identity `CONSIGNMENT_SETTLEMENT:<lineId>:<Idempotency-Key>` and replays its persisted canonical result; a different fingerprint conflicts;
- no prior settled amount is rewritten to absorb rounding;
- the intended cumulative formula mirrors Service allocation, but the current four-table line has no immutable net commercial line amount/version and `unit_price_cents` alone cannot prove discounts, tax assumptions or gift semantics. Therefore partial-settlement Finance amount remains `REQUIREMENT_REOPEN_REQUIRED`. No fifth table or hidden balance is introduced.

Cross-dialect constraint correction:

- every PK and required ID is explicitly `NOT NULL`; booleans are 0/1; versions are `>=1`; quantities/amounts use BIGINT-range integer contracts and application safe-integer checks;
- all status enums are complete CHECK lists; all FK/UNIQUE/index column orders are named and asserted;
- nullable composite uniqueness is not delegated to engine NULL behavior;
- defaults are compared by normalized metadata representation, following the frozen Wave 7 charset-prefix/parentheses rules; MySQL columns use project `utf8mb4_0900_ai_ci`, while business keys that require byte identity must use an explicit binary/case contract rather than inheriting collation accidentally;
- migration creates parent tables before child FKs and validates fresh/upgrade/replay without destructive repair.

Lot identity correction:

The earlier `lower(trim(lot_code))` rule and DB CHECK are withdrawn. The repository provides no authoritative business normalization for lot display codes; V21 uses opaque `lot_id`. Until the business owner chooses case/Unicode/whitespace identity, `lot_code_key` cannot be generated safely. This is `REQUIREMENT_REOPEN_REQUIRED`; Handoff/Settlement using a free-text lot code remains blocked. An approved solution should preferably reference the canonical V21 lot identity through the existing allowed column set only if that interpretation is explicitly accepted; Stage C does not rename or repurpose the column itself.

Audit correction:

- successful state transitions and REPORT_QUERY audit rows are written in the business transaction and commit with it;
- a business failure rolls back its transactional audit and success idempotency record, preserving zero partial side effects;
- current `audit()` only inserts through the supplied transaction. It cannot guarantee an independently durable failure-attempt record after rollback;
- authentication/authorization/request logging may provide operational security logs, but is not claimed as `audit_logs` business evidence. A requirement for durable rejected-attempt audit needs an approved Platform audit contract (`EXTERNAL_CONTRACT_REQUIRED`), not a second Wave 8 audit table.

#### 35.17.8 Mixed Delivery correction

§35.8 remains valid only after P1-1 and P1-3 close. The active invariants remain: Delivery-stage Gate is preserved; missing A-61 fails closed; physical lines keep frozen Inventory/OQC/valuation/COGS/Finance behavior; service lines consume locked CONFIRMED fulfillment evidence without Inventory/COGS or repeated Finance recognition; one Delivery idempotency key covers the whole command; one transaction rolls back every business side effect. Confirmed fulfillment quantity may be consumed by multiple Deliveries only up to its aggregate micros; Delivery acquires the same SO-line/fulfillment locks as Service CONFIRM. No current §35 statement authorizes implementation before the external Gate orchestration and Service Finance policy decisions exist.

#### 35.17.9 Future acceptance contract — not executed

| Scenario / existing mechanism | Competing operations and shared authority | Required lock order | Expected result, invariant and idempotency |
|---|---|---|---|
| 1. R-SAL-22 / UAT-S-25 | Service CONFIRM ×2; SO line + fulfillment aggregate | external Gate locks → SO → line → fulfillments id ASC → Finance | combined confirmed ≤ ordered; at most legal commands commit; same key replays; different fingerprint 409 |
| 2. R-SAL-15 + R-SAL-22 | Service CONFIRM vs PREPAYMENT application/refund | PREPAYMENT parent id ASC first, then Sales anchors | either fresh Gate authorizes full atomic confirm or Finance wins and confirm blocks with zero effects |
| 3. R-SAL-22 + frozen SO Change acceptance | Service CONFIRM vs `applySalesOrderChange` | SO → affected line → fulfillments | change sees confirmed/pending floor or confirm sees new version; confirmed commercial basis immutable |
| 4. UAT-S-25 / CAP-26 | A-61 change vs open Service SO | affected SOs/lines → fulfillments → A-61 | classification flip blocks while protected obligation/fact exists; no history reinterpretation |
| 5. UAT-S-25 / R-SAL-22 | Service CONFIRM vs mixed Delivery | external Gate → SO → lines → fulfillments | Delivery cannot consume uncommitted evidence; confirmed micros consumed once; no service Inventory/COGS |
| 6. R-SAL-20 / UAT-S-26 | Settlement ×2 | document → line → location → position → Finance | combined settled ≤ commercial and physical remaining; each command event exact once |
| 7. R-SAL-21 / UAT-S-27 | Settlement vs Return | document → line → location → position → Finance | Return currently fails closed; after Requirement approval only one serialized legal result |
| 8. R-SAL-20 / UAT-S-26 | Mapping update vs Handoff/Settlement | documents/lines → location → position | outstanding handed-off stock blocks mapping change; no movement reinterpretation |
| 9. UAT-S-26/27/41 | deactivation vs outstanding stock | documents/lines → location | new instruction blocked; historical settlement expected result remains Requirement-blocked |
| 10. UAT-S-25 | multiple partial Service confirmations | external Gate → line → fulfillments → Finance | BigInt cumulative cents conserve approved amount; previous rows immutable; exact final remainder |
| 11. UAT-S-26 | multiple partial Consignment settlements | line → position → Finance | quantity serialized; amount test remains blocked until immutable amount authority is approved |
| 12. UAT-S-25 / CAP-26 | missing/illegal Finance policy, duplicate source | source policy/source identity | no fallback DIRECT; controlled policy error; same source/same amount replay, mismatch conflict; zero duplicate economics |
| 13. existing migration/parity gates | SQLite vs MySQL four-table metadata and idempotency | migration registry order only | equivalent NOT NULL/FK/UNIQUE/CHECK/index/default semantics; no nullable-unique or collation accident |
| 14. CAP-25/26 | any Inventory/Finance/audit failure | path-specific order above | full transaction rollback; no success audit/idempotency; durable failure audit is not claimed without Platform contract |

Each race must use the existing R-SAL-20/21/22 or related frozen acceptance identity and real independent MySQL sessions where already required. No new SC, Invariant, UAT, Race or Audit Capability ID is created. These are future contracts, not executed results.

#### 35.17.10 Unresolved decision register and implementation prohibition

| ID | Status | Decision/contract owner needed | Prohibited until closure |
|---|---|---|---|
| P1-1 | `EXTERNAL_CONTRACT_REQUIRED` | Wave 7/Finance approve composable PREPAYMENT-first Gate orchestration; Finance documents recognition lock order | Service CONFIRM, mixed Delivery integration, and settlement Finance implementation |
| P1-3a | `REQUIREMENT_REOPEN_REQUIRED` | Sales + Finance choose Service recognition mode and policy fallback behavior | CONFIRMED Service state and Finance invocation |
| P1-3b | `REQUIREMENT_REOPEN_REQUIRED` | Sales + Finance decide zero-amount service, invoice linking/conversion and confirmed reversal | zero/free service confirm, invoice integration, confirmed cancellation |
| P1-5 | `REQUIREMENT_REOPEN_REQUIRED` | Sales owner decides settlement/return treatment after location deactivation | settlement through inactive location and any return |
| P1-6a | `REQUIREMENT_REOPEN_REQUIRED` | Sales + Finance approve immutable consignment net amount authority within four-table limit | partial settlement Finance recognition |
| P1-6b | `REQUIREMENT_REOPEN_REQUIRED` | Inventory/Sales owner defines lot-code identity or approves canonical lot reference interpretation | lot-tracked Handoff/Settlement/Return |
| Inventory writer | `EXTERNAL_CONTRACT_REQUIRED` | Inventory V21 approves bounded consignment source/context and strict value-preserving transfer adapter | every physical Consignment mutation |
| durable failure audit | `EXTERNAL_CONTRACT_REQUIRED` only if required | Platform Audit owner defines an independently durable rejection mechanism | claiming failed attempts persist in `audit_logs` |
| DDN-CON-3 / Return destination | `REQUIREMENT_REOPEN_REQUIRED` | Sales owner decides partial cancel/split and return destination/economics | partial cancel/split and Consignment Return |

The earlier §35.14 statement listing a small set of decisions before Implementation is superseded by this complete register. The earlier §35.16 status is historical within the same active draft and is superseded below.

**Final status: `WAVE8_STAGE_C_BLOCKED_PENDING_REQUIREMENT_DECISION`. Hard Stop: Stage D, source/test/migration/frontend changes, test/build execution, database access and Git operations are not authorized.**

> **G0 拆分说明**：本文件保留 `§35.0–§35.17`（被 §35.27 取代的早期修订轮次）。
> `§35.18–§35.19` 是 §35.27 声明的 Wave 8 冻结技术基线组成部分，已移入
> [`docs/design/sales-customer/03-wave-8-baseline.md`](../../../design/sales-customer/03-wave-8-baseline.md)。
