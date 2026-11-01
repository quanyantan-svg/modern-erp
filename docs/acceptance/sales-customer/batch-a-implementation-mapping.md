# Sales & Customer — Batch A (Waves 3–5) Implementation Mapping

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）
## 34. Sales & Customer Domain Implementation — Batch A (Waves 3–5) Mapping

> 本节仅记录已冻结 `§29–§30` 的实施映射，不改变 Requirement、SC、UAT、Race、schema 数量或跨域 ownership。实施基线为 `feature/sales-batch-a@af29569ed838493cca942a52361c9c2b391b93c7`。

### 34.1 Canonical owners and compatibility dispatch

- `server/modules/sales-orders.js` 是 Wave 4 后唯一 Sales Order create/update/lifecycle writer；新 `/api/sales-orders` 与兼容 `/api/orders` 只做同一 handler 的 route alias，报价转换直接调用同一 transaction-aware service，不保留第二套旧写入实现。
- `server/modules/sales-quotations.js` 拥有 Quotation lifecycle、conversion evidence、R-SAL-06 capacity 与 group-scope authorization。
- `server/modules/sales-order-changes.js` 拥有两种 authoring path，并统一调用 `applySalesOrderChange()`；版本 CAS、容量重读、approval、idempotency、audit 在同一 transaction。
- `server/modules/delivery-notices.js` 拥有 DN lifecycle；`server/modules/sales-delivery-source.js` 提供 DIRECT_ORDER / DELIVERY_NOTICE 的公共来源与容量校验，由既有 Sales Delivery handler 调用，库存、LOT/SERIAL、OQC、valuation/COGS 与 Finance writer 不复制。

### 34.2 Derived quantity and identity mapping

- `sales_quotation_conversions` 是 converted quantity 权威证据；`sales_quotation_lines.converted_qty` 仅为同事务维护的可核对缓存。读取时按 evidence 聚合对账并计算 `remainingQty=quantity-converted`，不使用跨表 generated expression。
- `delivery_notice_lines.id` 是稳定 FK / lock identity；`UNIQUE(delivery_notice_id,sales_order_item_id)` 是业务复合唯一性。notified/remaining 由引用该 line 的 Sales Delivery evidence 聚合；缓存字段只在同一 transaction 更新并对账。
- 锁顺序固定为：全局 transaction gate（MySQL runtime）→ document header → 按 ID 排序的 SO line → DN line（若有）→ delivery/change/conversion evidence → idempotency/audit。SQLite 使用 `BEGIN IMMEDIATE`；MySQL 在 transaction gate 后对相同业务 anchor 使用 `FOR UPDATE`。

### 34.3 Wave mapping and deferred gates

- Wave 3：SC09–SC14、UAT-S-01..03、R-SAL-06；三张新表；报价 LIST/DETAIL/EDITOR/CONVERT。
- Wave 4：SC24–SC29、SC31–SC44、UAT-S-10..16/S-39/S-42/S-43、R-SAL-07/08/11；两张新表、SO 13 列、SO item 11 列（含 `price_snapshot_json` / `discount_snapshot_json`）；四模式 change matrix 与 fulfillment/close projection。
- Wave 5：SC08/SC30/SC45–SC53、UAT-S-17..18、R-SAL-01/16/17/18/19；两张新表、Sales Delivery 三个 additive source fields（复用 `billing_mode`）。
- Wave 7 Prepayment/Reservation Intent 与 Wave 9–10 Credit 尚未实现时，不创建 stub 或假 PASS：仅当订单 snapshot/参数要求对应 gate 时返回明确 409；零预付款、`DISABLED` reservation 与未启用 Credit 保持可执行。后续 Wave 的完整 UAT 项仍标记为外部前置，不在 Batch A 声称完成。

### 34.4 Migration, API, UI and verification evidence plan

- Migration registry 严格追加 Wave 3 → 4 → 5。SQLite canonical snapshot 执行 dialect-local DDL；MySQL bootstrap/additive reconciliation 先物化 snapshot，live registry 只校验/补充方言正确 metadata，不重放 SQLite `CREATE TABLE`。
- 新 API 与兼容 alias 均注册到 `ownedRouteTable`，backend permission 分为 quotation view/manage、sales view/create/manage/approve、change direct/document/approve、DN view/manage/approve、delivery view/manage/approve。
- `applicationRegistry.js` 仍是 route canonical source；新增页面沿用现有 LIST → DETAIL → EDITOR/WORKFLOW 模式并验证 320/390/430/680。
- 测试证据按 Wave focused → FAST/FULL/HEAVY/build/diff-check；protected MySQL fresh/upgrade/replay/concurrency 仅在 guard 环境可用时运行，否则记录 NOT RUN。

### 34.5 Remote review R1 remediation implementation record

This subsection records the bounded remediation implemented after the external review of `feature/sales-batch-a@4b2fd90ad2cad471b15666a85a79f4401f71b6b6`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`.

- P1-01: quotation conversion retains Platform A-21 at request scope, while each immutable conversion row stores a bounded `LINE:<fingerprint(request-key, quotation-line-id)>` key. The existing `(quotation_id,idempotency_key)` uniqueness therefore remains migration-compatible and no longer rejects a valid multi-line request. A request-local set rejects duplicate quotation-line selection before capacity evaluation.
- P1-02: the original `sales_order_items.price_snapshot_json` and `discount_snapshot_json` remain immutable. Each append-only `sales_order_change_lines.after_values_json` now carries `SO_CHANGE_COMMERCIAL_EVIDENCE_V1`, the base/target effective version, quantity/UoM/unit price, the original evidence hash and an ordered `GROSS → LINE → HEADER` effective calculation. Application validates the calculation identity and source hash before CAS; post-application validation replays the latest APPLIED evidence per current line and reconciles the order total. This uses the already frozen JSON evidence carriers, so no Design Reopen or schema addition is required.
- P1-03: an independent actor with `SALES_PRICING_OVERRIDE` obtains a server-generated, line-bound authorization through `POST /api/sales-price-overrides/authorize`. The immutable authorization is stored in the existing Platform audit evidence, binds customer/date/material/UoM/quantity/catalog version/manual price/reason/actor, is consumed once under the canonical transaction lock, and rejects creator self-authorization, forged IDs, mismatched payloads and replay. The SO writer revalidates the stored server snapshot; it never accepts a client actor or client snapshot as authority.
- P1-04: both `/api/orders` and `/api/sales-orders` continue to delegate to the same lifecycle handler. SUBMIT now rechecks order/requested dates and ordering, ship-to contact/phone/address, payment terms, positive normal-line commercial amounts, gift zero-revenue semantics, complete authoritative snapshots and header/line total equality inside the mutation transaction.
- P1-05: fulfillment projection now loads the SO and invokes the same `assertGroupScope` predicate used by SO list/detail before returning quantities. An unmapped salesperson and a different group fail closed; explicit `SALES_CROSS_GROUP` authority remains the only non-admin bypass.
- MySQL race evidence is implemented by `server/mysql-sales-customer-batch-a-concurrency.integration.js` plus an independent-process worker. Three distinct MySQL sessions expose their `CONNECTION_ID()` and process ID. A control session holds the real `mysql_transaction_gates.gate_id=1` row; both business sessions must be observed waiting on that row through `information_schema.PROCESSLIST` before release. R-SAL-06/07/08/16/17/18/19 assert capacity/version/business state, winner/loser rollback and audit cardinality. R-SAL-11 remains in the Wave-2 concurrency suite. Registration is limited to the existing protected disposable-MySQL gate.

### 34.6 Remote review R2 targeted remediation implementation record

This subsection records the bounded R2 remediation continued from `feature/sales-batch-a@a116499494a3c5286840eecce73829e5aa38b6fe`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to the three R2 P1 contract findings below and the R-SAL-17/19 coverage note; no Wave 6+ functionality, no Schema delta and no release/version drift is included.

- R2-P1-01 — Independent Override Evidence Fingerprint: `authorizedOverrideEvidence()` no longer mutates the original `snapshot.evidence`. It returns the audit-bound evidence unchanged and emits a separately fingerprinted `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` payload that carries its own `pricingEvidenceFingerprint` (binding to the immutable price evidence fingerprint) and `authorizedPriceSnapshotHash` (binding to the canonical priced snapshot minus the consumption layer). `validatePriceSnapshot()` and `validateStoredOrderSnapshots()` now re-verify the consumption payload against the live `SALES_PRICE_OVERRIDE_AUTHORIZATION` audit row using the immutable Platform evidence carrier; this covers contract version, fingerprint match, authorised actor, authority code, customer, business date, material, UoM, quantity, evidence fingerprint, original snapshot hash and audit detail identity. No client-supplied actor, snapshot or authorization id is treated as authority; the same audit row cannot be applied twice; cross-customer / cross-material / cross-quantity / forged-id / insufficient-permission requests are rejected with `PRICE_OVERRIDE_AUTHORIZATION_INVALID` or `SALES_PRICE_OVERRIDE_SOD`. The new API test exercises authorize → consume → submit → independent approve, and additionally asserts forged/replay/cross-customer/cross-material/cross-quantity rejection.
- R2-P1-02 — Consecutive SO Change Versions: `applySalesOrderChange()` now flips `sales_order_changes.state='APPLIED'` (and writes approver / applied / idempotency fields) **inside the same transaction and before** `validateEffectiveOrderCommercialEvidence()` runs, so the current target version participates in the authoritative per-line latest-APPLIED replay. Any failure inside validation, CAS update, evidence evaluation or approval bookkeeping rolls the entire transaction back; the order row keeps its previous `effective_version`, every line keeps its previous commercial state, the change stays `SUBMITTED`, and the previously-APPLIED change cannot be re-applied. The new API test asserts a full consecutive 1→2→3 change sequence on the same order line, the original snapshot identity remains untouched, multi-line ADD/MODIFY mixed payloads pass, corrupt / stale / duplicate-apply paths roll back with zero side-effects, and the validator's authoritative replay matches the latest amount evidence for `effective_version=3`.
- R2-P1-03 — Legitimate Zero-Revenue Discount: The SUBMIT gate no longer rejects a non-gift line solely because `amount_cents<=0`. The frozen `§29.7.2` resolver may legitimately yield zero final cents for a normal-priced line under an authoritative 100% discount rule, and that result remains admissibly submitted. Gift lines keep their `amount_cents=0` invariant and any other condition (missing snapshot, mismatched amount, forged snapshot id, gift/amount mismatch) still fails closed under the existing snapshot validation. The new API test creates an ACTIVE 100% LINE scheme, asserts the resulting order line carries the authoritative unit price with `amount_cents=0`, submits it through the canonical lifecycle, then asserts forged amount-0 / missing discount snapshot / mismatched amount / mutated discount snapshot are all rejected.
- R-SAL-17 / R-SAL-19 coverage note: The MySQL independent-session suite still routes R-SAL-17 (two SD capacity consumers vs DN remaining) and R-SAL-19 (SO close vs SD confirmation) through the `consume-delivery-capacity` worker action that invokes `lockAndConsumeSalesDeliveryCapacity()` plus a manual `UPDATE sales_deliveries SET status='CONFIRMED'`. They exercise the canonical capacity / version / audit serialisation path with real `mysql_transaction_gates` waits and observed processlist, but they do **not** invoke the full canonical `confirmSalesDelivery()` handler, so inventory deduction, OQC gate, financial period gate, AR exposure recognition, COGS posting, voucher generation and Sales Delivery audit are not concurrent-tested. These two IDs are therefore not claimed as full Sales Delivery Confirm concurrent acceptance; they are recorded as capacity-and-status serialisation evidence only. No fake PASS or unauthorised MySQL operation was attempted; the live MySQL fresh / upgrade / replay / concurrency gate continues to fail closed with `MYSQL TEST ENVIRONMENT = UNAVAILABLE` until a protected disposable environment supplies the five ERP_DB_* variables.

### 34.7 Remote review R3 targeted remediation implementation record

This subsection records the bounded R3 remediation continued from `feature/sales-batch-a@7d12c3dc91d54a0b9896747ed84f0e607e5d97f6`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to one R3 P1 contract finding; no Wave 6+ functionality, no Schema delta, no table or field addition, and no Git / release / version drift is included.

- R3-P1 — Duplicate consumption of one price override authorization inside a single Sales Order: `authorizedOverrideEvidence()` now accepts an optional request-scoped `consumedAuthorizationIds` Set. A second line in the same request that reuses an already-seen `priceOverrideAuthorizationId` is rejected with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` before any DB write; the new check runs at the top of the function and short-circuits without consuming an audit read or doing a LIKE scan. `buildAuthoritativeSalesLines()` owns the per-call Set and propagates it through every per-line `authorizedOverrideEvidence()` invocation, so two `items[]` rows referencing the same id are stopped before either line is resolved. `normalizedLines()` (controlled-change authoring path) now shares **one** Set across every `ADD` operation inside the same change request so two `ADD` rows referencing the same id are likewise stopped before any change-line row is inserted. The existing MySQL row-lock on the `audit_logs` row, the immutable independently fingerprinted `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` evidence, the cross-document LIKE check that already detects a previously persisted consumption (`PRICE_OVERRIDE_AUTHORIZATION_USED`), creator/override-actor SOD, RBAC, authority code, reason and snapshot integrity are all preserved. Rejection throws `HttpError` so the surrounding `transaction()` rollback leaves zero SO row, zero change-line row, zero idempotency save and zero CREATE audit log; nothing in the audit was expanded. The new focused regression tests cover: two otherwise valid lines referencing the same id rejected with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` and zero `sales_orders` / audit / idempotency side effects; two lines referencing distinct valid ids accepted; failed duplicate request followed by a legitimate single-use of the same id accepted; the same id reused in another order after successful consumption rejected with `PRICE_OVERRIDE_AUTHORIZATION_USED`; the existing authorize → create → submit → independent approve chain remains successful; the canonical `PATCH /api/sales-orders/:id` mutation path also rejects a two-line body that reuses one id; and the controlled-change authoring path with two `ADD` rows that reuse one id is rejected with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` while a subsequent single-`ADD` change request legitimately consumes that same id.

### 34.8 Remote review R4 one-time-authorization completeness implementation record

This subsection records the bounded R4 remediation continued from `feature/sales-batch-a@257ac1dfa11a1d8fa771f5e741df80a263ac28bf`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to one R4 P1 contract finding; no Wave 6+ functionality, no Schema delta, no new table or column, no Git / release / version drift, and no expansion into other business domains.

- R4 chosen existing carrier: the canonical `idempotency_records` table from `server/migrations/v13-phase6a-financial-controls.js:144` carries the DB-level `UNIQUE(operation_type, document_id, idempotency_key)` constraint that is enforced at INSERT time on both SQLite and MySQL. This avoids the R3 LIKE pattern fragility (which depended on the JSON column of `sales_order_items` and could be bypassed by PATCH removal or by a SUBMITTED-but-not-yet-applied Change ADD) and provides a transaction-bound consumption record that participates in the surrounding `transaction()` rollback automatically. No new table, column, index or constraint is introduced.
- R4 contract: `authorizedOverrideEvidence()` now `INSERT`s a consumption row into `idempotency_records` with `operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION'` and `document_id=<authorizationId>` inside the same transaction that resolves the line. A duplicate INSERT fails with the carrier's UNIQUE constraint and is mapped to `PRICE_OVERRIDE_AUTHORIZATION_USED`. The R3 in-request Set still short-circuits same-request duplicates with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` before any DB write. The R3 cross-document LIKE pattern is removed; the DB INSERT is now the only cross-document check, and it survives `PATCH` removal, Change ADD `SUBMITTED` occupancy, external deletion of the consumed `sales_order_items` row, and any later `ROLLBACK` of the same transaction. The consumption row is independent of `sales_order_items` lifetime.
- R4 occupancy vs consumption: the same record serves both. For direct SO create / `PATCH` / Gift Line it is created at line commit time. For `CONTROLLED_DIRECT` and `CONTROLLED_DOCUMENT` Change ADD it is created inside `normalizedLines()` at request time so the auth is reserved against any concurrent business attempt; on `APPLY` the row already exists and the change-line JSON is no longer trusted in isolation. A new `PRICE_OVERRIDE_CONSUMPTION.assertReserved()` helper re-verifies that the consumption row is still in place at apply time before any `sales_order_items` INSERT, CAS bump or APPROVE_AND_APPLY audit fires. If the row is missing the entire apply transaction rolls back with `PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED` and zero side-effects on `sales_orders` / `sales_order_items` / `sales_order_changes` / approval_requests / apply-idempotency / audit.
- R4 cancel / reject release path: `releaseChangeAuthorizationOccupancy()` walks `sales_order_change_lines` for ADD rows, extracts `priceSnapshot.authorizationEvidence.authorizationId` and `DELETE`s the corresponding consumption row inside the same transaction as the state flip. Only ADD rows release — MODIFY/CANCEL rows keep the original line's consumption record untouched. Audit `entity_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION'` carries `CONSUME` on insert and `RELEASE` on delete.
- R4 unified semantics: `createSalesOrder`, `updateSalesOrder`, `addSalesOrderGiftLine`, and the `ADD` path of `CONTROLLED_DIRECT` / `CONTROLLED_DOCUMENT` change authoring all route through the same `buildAuthoritativeSalesLines` → `authorizedOverrideEvidence` → `recordPriceOverrideAuthorizationConsumption` path. RBAC, creator/override-actor SOD, audit-log row lock, the independently fingerprinted `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` evidence, and the original `sales_order_items` snapshot carriers are unchanged.
- R4 acceptance matrix tests in `server/sales-customer-batch-a.test.js`: (a) same-request duplicate rejected with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` (R3); (b) cross-order duplicate rejected with `PRICE_OVERRIDE_AUTHORIZATION_USED` (R3); (c) draft PATCH replacing the consumed line with a non-auth line leaves the consumption record in place and a fresh reuse attempt fails with `PRICE_OVERRIDE_AUTHORIZATION_USED`; a PATCH that tries to reuse the locked auth in a new line also fails closed; (d) SUBMITTED Change ADD reserves the auth, a concurrent SO creation with the same auth fails with `PRICE_OVERRIDE_AUTHORIZATION_USED`, REJECT flips the change to REJECTED, the consumption row is deleted and an additional `RELEASE` audit row is recorded, the same auth can then be re-consumed in a new SO; (e) when the consumption row is externally deleted before apply, apply fails with `PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED` and no `sales_order_items` row is inserted, no `effective_version` bump, no total change, no APPROVE_AND_APPLY audit, no apply-idempotency save, the change stays in `SUBMITTED` and the approval_request status is unchanged; (f) distinct valid authorisations each get their own consumption row (R3); (g) RBAC, SOD, fingerprint and snapshot carriers preserved (R2/R3).

### 34.9 Remote review R5 owner-aware authorization finalization implementation record

This subsection records the bounded R5 remediation continued from `feature/sales-batch-a@8bdafc7a3b73a035f6d768c8caab37b6aa6da89b`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to the two R5 lifecycle gaps; no Wave 6+ functionality, no Schema delta, no new table or column, no Git / release / version drift, and no expansion into other business domains.

- R5 root cause: the R4 record-based reservation could not be edited. `updateSalesOrderChange()` resolved new lines through `normalizedLines` → `authorizedOverrideEvidence` → `recordPriceOverrideAuthorizationConsumption`, and the DB UNIQUE constraint correctly fired on the second INSERT of an already-reserved authorization. The R4 release/assert helpers also lacked owner enforcement, so a misrouted release or apply could silently delete or accept a row owned by another change or a direct-SO consumption.
- R5 DRAFT Change PATCH reconciliation: `updateSalesOrderChange()` now snapshots the ADD-authorisation set currently carried by THIS change (`oldAuthIds`), projects the new ADD-authorisation set (`newAuthIds`), passes the intersection as `previouslyReservedAuthorizationIds` to `normalizedLines` → `buildAuthoritativeSalesLines` → `authorizedOverrideEvidence`. Retained authorizations are not re-inserted but verified through `assertPriceOverrideAuthorizationReserved(..., { expectedOwner: 'SALES_ORDER_CHANGE:<changeId>' })`. Newly added authorizations are inserted via the existing DB UNIQUE-protected path. After `normalizedLines` returns, the function walks `oldAuthIds \ newAuthIds` and calls `releasePriceOverrideAuthorizationConsumption(..., { expectedOwner })` so removed reservations are released atomically with the change-line rewrite. A failed `normalizedLines` throws inside the same `transaction()`, so the prior `sales_order_change_lines`, the prior consumption rows, the `apply_idempotency_key`, the audit cardinality and the order `effective_version` are all rolled back.
- R5 owner-aware `release`: `releasePriceOverrideAuthorizationConsumption()` now requires the caller to pass `expectedOwner` (typically `SALES_ORDER_CHANGE:<changeId>` or omitted for direct-line internal callers). It reads the persisted row, parses `result_json.source`, and rejects with `PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH` when the source does not match. It also refuses to delete when an applied `sales_order_items` row still carries the authorization (`PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS`); the existing `sales_order_items.price_snapshot_json` LIKE check now serves only as a guard for applied-line protection. Both checks run inside the same transaction as the state flip.
- R5 owner-aware `assertReserved`: `assertPriceOverrideAuthorizationReserved()` now accepts `expectedOwner`. Apply-time re-verification in `applySalesOrderChange()` calls it with `expectedOwner: 'SALES_ORDER_CHANGE:<changeId>'`. Cross-owner attempts throw `PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH` and roll the entire apply back; missing-record attempts throw `PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED` (R4 path preserved). The original carrier (`idempotency_records` UNIQUE constraint), the immutable independently fingerprinted `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` evidence, the audit-log row lock, RBAC, creator/override-actor SOD, the original authority and the original fingerprint binding are all preserved.
- R5 reject / cancel path: `releaseChangeAuthorizationOccupancy()` now passes `expectedOwner` to `release()` for every ADD row. Reject/cancel therefore releases only the currently reserved, owned authorisations and cannot delete a direct-SO consumption row or another change's record.
- R5 acceptance matrix tests in `server/sales-customer-batch-a.test.js`: DRAFT Change ADD A → PATCH retaining A → success with record identity preserved; PATCH replacing A with B → A released, B reserved under the same change owner; PATCH removing the ADD entirely (replacing with a MODIFY on the base line) → A released; invalid PATCH that re-uses an already-consumed authorization → 409 `PRICE_OVERRIDE_AUTHORIZATION_USED`, prior change lines and reservations untouched; PATCH replacement followed by Cancel → both old and newly-replaced reservations released, change state `CANCELLED`, no orphan records; cross-owner `release()` attempt on changeB's record with expectedOwner=changeA → throws `PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH` without deleting the changeB record; cross-owner `assertReserved()` attempt → throws and does not advance any state; missing-record apply on changeB → fails with `PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED` leaving changeA's state, audit cardinality and effective_version intact; valid-owner apply on changeA → bumps `effective_version`, appends a new SO line, immutable snapshot and authorization binding preserved; direct-SO permanent consumption protected from any later cross-owner release/assert attempt. All R1–R4 regression tests remain green.
- R5 concurrency note: under the existing protected MySQL runtime (`mysql_transaction_gates`) and SQLite `BEGIN IMMEDIATE`, the new DRAFT-PATCH reconciliation, the owner-aware release, and the apply-time re-verification are serialised inside a single transaction. Real MySQL gate continues to fail closed with `MYSQL TEST ENVIRONMENT = UNAVAILABLE`; no fabricated live PASS.

### 34.10 Remote review R6 P1/P2 bounded remediation implementation record

This subsection records the bounded R6 remediation continued from `feature/sales-batch-a@b7c446d1220a0468a4bf3674bef8167da0212e3e`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to the three R6 lifecycle and contract findings; no Wave 6+ functionality, no Schema delta, no new table or column, no Git / release / version drift, and no expansion into other business domains.

- R6-P1-01 — Sales Order Change state actions enforce requester ownership and sales-group scope: `salesOrderChangeAction()` now loads the change + underlying SO through a new `loadChangeWithScope()` helper that re-asserts `assertGroupScope()` for every mutation. The helper is intentionally narrower than `orderForChange()` so REJECT / CANCEL can still target a SUBMITTED change after the SO has been closed. SUBMIT also requires `change.requested_by === actor.id` (with ADMIN bypass) so a user with `SALES_ORDER_CHANGE_DOCUMENT_MANAGE` cannot submit another user's DRAFT; the new error code is `SALES_ORDER_CHANGE_NOT_REQUESTER`. APPROVE continues to use `orderForChange()` (which additionally checks APPROVED / OPEN), so apply-time scope remains covered by the same predicate as create flows. Reuses the same `transaction()` so a failed access leaves zero side-effects on `sales_order_changes`, `sales_order_change_lines`, `approval_requests`, `idempotency_records`, `audit_logs`, and the order `effective_version`.
- R6-P1-02 — DRAFT PATCH fail-closes on corrupt historic ADD evidence: the silent `try { ... } catch {}` in `updateSalesOrderChange()` is replaced with an explicit `throw new HttpError(409, ..., { code: 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT' })` for both JSON-syntax and missing-`priceSnapshot` cases. For ADD rows that DO carry an authorisation, the captured `authorizationId` is also type-checked. A legitimate ADD without override authorisation still PATCHes successfully because the absence of `authorizationEvidence` is not a corruption signal. The rejection fires inside the same `transaction()`, so prior `sales_order_change_lines`, prior consumption rows, audit cardinality, the order `effective_version`, and the prior `sales_order_changes` row are all rolled back.
- R6-P2-01 — `release()` / `assertReserved()` require `expectedOwner` and reject the `allowAppliedLine` bypass: the default `{ expectedOwner = null }` is removed; both helpers now require an explicit non-empty `expectedOwner` string and throw `PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED` when omitted or empty. The `allowAppliedLine` option is removed (no caller ever used it) so the LIKE-on-`sales_order_items` applied-line guard is always enforced. All Change callers in `sales-order-changes.js` and `authorizedOverrideEvidence` already pass `expectedOwner` explicitly; the helpers do not introduce a second persistence carrier. The DB UNIQUE constraint, the `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` evidence, RBAC, creator/override-actor SOD, the original authority and the original fingerprint binding are preserved.
- R6 acceptance matrix tests in `server/sales-customer-batch-a.test.js`: (P1-01) non-requester SUBMIT of another user's DRAFT rejected with `SALES_ORDER_CHANGE_NOT_REQUESTER` and zero side-effects on change state and audit cardinality; legitimate SUBMIT by requester succeeds; cross-group SUBMIT attempt (SO moved to a different sales group) rejected at `assertGroupScope()`; cross-group REJECT attempt by a no-cross-group reviewer rejected with `SALES_GROUP_SCOPE_DENIED`, change state / approval status / audit cardinality unchanged; cross-group CANCEL attempt rejected with the same scope code; legitimate REJECT by a cross-group-enabled reviewer succeeds and writes the audit row; legitimate CANCEL by the requester succeeds. (P1-02) Case A (corrupt JSON syntax in historic `after_values_json`) → 409 `SALES_ORDER_CHANGE_EVIDENCE_CORRUPT` with prior `sales_order_change_lines` / audit / effective_version / reservation unchanged; Case B (parses but missing `priceSnapshot`) → same error code, same rollback invariants; Case C (legitimate ADD without override authorisation) PATCHes successfully without over-warning; Case D (R5 lifecycle ADD A → retain → replace B → remove ADD → cancel) regression continues to pass. (P2-01) direct `release()` / `assertReserved()` call without `expectedOwner` → throws `PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED` without touching the record; cross-owner release/assert with wrong `expectedOwner` → throws `PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH` without touching the unrelated record; an applied-line authorization cannot be released by its owner (`PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS`); a fresh Change ADD with a fresh authorization can still be cancelled by its owner and the reservation is released.
- R6 concurrency note: under the existing protected MySQL runtime (`mysql_transaction_gates`) and SQLite `BEGIN IMMEDIATE`, the SUBMIT / REJECT / CANCEL scope gate, the PATCH corruption gate, and the tightened owner-required release/assert contract are all serialised inside one transaction. Real MySQL gate continues to fail closed with `MYSQL TEST ENVIRONMENT = UNAVAILABLE`; no fabricated live PASS.

### 34.11 Remote review R7 P1/P2 strictly bounded remediation implementation record

This subsection records the bounded R7 remediation continued from `feature/sales-batch-a@1a4f58c72e2ec3a637f5dd8f72473b6787c1dda7`. It does not change frozen `document.md §34`, the seven-table / two-snapshot-column Batch A schema boundary, SC/UAT/R-SAL allocation, RBAC/SOD, the canonical Sales Order writer, snapshot immutability, CAS, audit/idempotency, or release identity. No Wave 6+ behavior, schema delta, second authorization carrier, automatic history repair, or UI change is included.

- R7-P1-01 — historic ADD evidence and owner-set reconciliation: the R6 object-presence check was insufficient because an empty or partially damaged `priceSnapshot` could lose its authorization reference while the authoritative `idempotency_records` reservation remained. `parseStrictAddAfter()` now validates every persisted ADD payload, its core commercial fields, and its price snapshot through the canonical `validatePriceSnapshot()` contract. `reconcileChangeAuthorizations()` then compares the unique authorization IDs declared by all ADD lines with the exact persisted consumption set whose structured `result_json.source` equals `SALES_ORDER_CHANGE:<changeId>`. Missing, extra, duplicate, malformed, cross-linked, or unreadable evidence fails closed; the code neither guesses nor repairs history. DRAFT PATCH reconciles before retain/replace/remove, REJECT and CANCEL reconcile before release, and APPLY reconciles plus owner-asserts every reservation before economic mutation. All checks remain inside the existing transaction, so failure rolls back line/state/approval/idempotency/audit and order version/amount effects. A legitimate ADD without an override has no declared ID and remains valid when the persisted owner set is also empty.
- R7-P1-02 — structural applied-line protection: `findAppliedAuthorizationLine()` no longer uses JSON text `LIKE`. SQLite compares `json_extract(price_snapshot_json, '$.authorizationEvidence.authorizationId') = ?`; MySQL compares `JSON_UNQUOTE(JSON_EXTRACT(price_snapshot_json, '$.authorizationEvidence.authorizationId')) = ?`. Both retain parameter binding and ignore SQL `NULL` without inventing evidence. Any JSON-query/read failure becomes `PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_CHECK_FAILED` rather than being interpreted as no applied row. `release()` still requires and verifies `expectedOwner` before deletion, and an exact applied match still raises `PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS`.
- R7-P2-01 — real cross-group SUBMIT coverage: the R6 scenario now creates a DRAFT while the actor is in scope, changes the underlying order's effective sales group, calls `POST /api/sales-order-changes/:id/submit`, and verifies 403 plus zero change-state, approval, SUBMIT-audit, reservation, idempotency, and SO-version effects. Restoring the group then proves the same DRAFT can submit normally. The frozen permission model is unchanged.
- Verification evidence: the focused Batch A suite is `28/28 PASS`; FAST is `380/380 PASS` across 37 suites; FULL is `2454/2454 PASS` across 351 suites; HEAVY is `67/67 PASS` across 18 suites; the Vite build passes with 1960 modules. The protected MySQL functional gate passes all 13 registered files. The protected MySQL concurrency gate passes `77/77` across seven groups, including Batch A `8/8` and a real native-JSON structure/order/NULL/unrelated-field test. The Batch A MySQL fixture uses idempotent `INSERT IGNORE` for the already bootstrap-seeded `EA` UOM; this is test setup only and changes no runtime contract. `git diff --check` is run after documentation is appended.
- Remaining boundary: corrupted historic evidence is deliberately not self-healed and requires manual data repair before its lifecycle can proceed. R-SAL-17/R-SAL-19 remain capacity-and-status serialization evidence rather than full `confirmSalesDelivery()` concurrency acceptance. This implementation record is not an Acceptance PASS or Freeze claim.

### 34.12 Batch A Final Acceptance Closure implementation record (2026-10-16)

This is an implementation and verification record for the already frozen Batch A Requirement and Design. It does not alter `document.md §34`, add schema/migrations or Wave 6+ behavior, change the package version, or claim user Acceptance/Freeze.

- Source and quantity contract: `SalesDeliveryModal()` now explicitly selects `DIRECT_ORDER` or `DELIVERY_NOTICE`, loads real approved SO/DN lines, sends the actual source IDs, shows DN remaining quantity and preserves DRAFT source identity; `LEGACY_UNCLASSIFIED` remains read-only. `validateSalesDeliverySource()` and `lockAndConsumeSalesDeliveryCapacity()` retain backend authority. `quantityToMicros()` and `toleranceBoundsMicros()` compare upper/lower capacity with integer micros and BigInt bps boundaries in SO, DN and SD paths. SO close requires the exact lower bound, no pending DN, a reason, and audit before/after evidence; cancel rejects executed delivery. Closed SO is excluded from new SD source lookup and rejected at create/confirm. Failure remains transaction atomic.
- Commercial and mobile workflow: Quotation conversion presents editable per-line remaining quantity and does not hide zero-amount or full-discount lines. DN DRAFT edit now calls canonical PATCH with immutable source/warehouse and an upper-tolerance presentation bound; confirmed DN cancellation stays an explicit legal action. Change DRAFT edit calls canonical PATCH, while requester cancel and reviewer approval remain explicit actions. Existing Quotation, DN and Change detail refresh Effects no longer return Promises as React cleanup functions. The established route/UI surface and backend RBAC/SOD remain canonical. SO header/line `taxInclusive` accepts only boolean or integer 0/1 and persists the canonical integer assumption in both SQLite and MySQL; an invalid value fails with 422 before economic mutation, while commercial tax-basis evidence creates no statutory invoice truth.
- Economic confirm: the test entry calls the exported existing `confirmSalesDelivery()` handler. It exercises SO/DN capacity, OQC, reservation and period gates, tracking when applicable, inventory OUT, valuation, COGS system voucher, billing-mode-specific Finance recognition, idempotency and audit. Zero-revenue gift/full-discount delivery still issues inventory value and COGS but omits zero-value revenue/AR exposure. All failed confirm branches roll back DN consumption and the economic writes in the existing `transaction()`.
- R8 closure: Pretty JSON evidence tests preserve all original top-level fields while changing only formatting/order. `parseStrictAddAfter()` binds historical ADD commercial evidence to the independent `order.order_date`; corrupt/mismatched date fails with zero mutation and no history rewrite.
- MySQL: three independent sessions and `information_schema.PROCESSLIST` lock-wait observation remain the concurrency proof. R-SAL-01/08/17/19 now invoke the complete canonical SD confirm handler; R-SAL-06/07/16/18 retain their canonical capacity/version paths. The fixture uses integral base quantities and coherent valuation/OQC waiver evidence. Each winning confirmation is checked for exactly one inventory transaction, valuation movement, COGS voucher and CONFIRM audit; losing transactions leave none. Protected disposable MySQL fresh, upgrade, replay and concurrency gates passed on 2026-10-16.
- Browser: `scripts/acceptance/sales-customer-batch-a-acceptance.mjs` starts the production build on disposable SQLite, logs in as explicit admin/reviewer roles and drives actual Edge UI requests. It covers Quotation create/publish/partial and remaining conversion, SO editor/submit/reviewer approval, DN create/edit/confirm/cancel, Change create/PATCH/submit/cancel and reviewer approval, both SD source modes and OQC/confirm, plus direct route/refresh/Back/Forward and 6 routes × 320/390/430/680 layout checks. The runner waits for the lazy route to leave its loading state before measuring or capturing, so the evidence represents the actual work surface. That check exposed 30px Sales Order filter targets; the existing scoped sales-order CSS now gives filter and menu actions a 44px target without changing route or business semantics. It stores sanitized screenshots and JSON under `docs/evidence/sales-customer-batch-a/`. Tests remain separately authoritative for negative cases, rollback and RBAC/SOD.
- Evidence and boundary: `docs/evidence/sales-customer-batch-a/final-acceptance.md` maps the 15 direct UAT IDs and 9 Race IDs to canonical owners, API, assertions, dialect and browser applicability. Future Credit, Prepayment and Reservation capabilities retain their frozen deferred ownership and fail-closed current behavior. Final user Acceptance and Freeze remain pending.

### 34.13 Sales & Customer Batch A — Formal User Acceptance & Freeze Record (2026-10-16)

**Decision: ACCEPTANCE PASS / FROZEN**

#### 1. User Approval

On 2026-10-16, the project owner explicitly approved the final Acceptance and Freeze of Sales & Customer Batch A (Waves 3–5).

This is an explicit user decision following the final independent remote review. It supersedes the earlier `AWAITING USER ACCEPTANCE` status for Batch A only.

#### 2. Immutable Acceptance Baseline

- Repository: `quanyantan-svg/modern-erp`
- Accepted branch: `feature/sales-batch-a`
- Frozen implementation SHA: `41857ce2740163868aef0687a7b0ed4536354fe1`
- Package version: `1.6.2`
- Existing release identity: `v1.6.2` (unchanged)
- Scope: Sales & Customer Batch A, Waves 3–5 only

Subsequent documentation-only acceptance records do not change the accepted implementation SHA.

#### 3. Accepted Scope

- Wave 3: Sales Quotation lifecycle and repeated/partial Sales Order conversion.
- Wave 4: Canonical Sales Order, immutable commercial evidence, approval, controlled order changes, effective-version CAS and controlled close.
- Wave 5: Delivery Notice, DIRECT_ORDER and DELIVERY_NOTICE source modes, Sales Delivery confirmation and capacity control.

The accepted scope includes the associated authorization, audit, idempotency, economic consistency, concurrency and mobile browser contracts.

#### 4. Acceptance Evidence

Primary evidence index:

`docs/evidence/sales-customer-batch-a/final-acceptance.md`

Browser evidence:

`docs/evidence/sales-customer-batch-a/browser-acceptance.json`

Supporting evidence includes:

- 15 direct Batch A UAT IDs with traceability records.
- 9 associated Race IDs with execution evidence.
- Focused: 31/31 PASS.
- FAST: 380/380 PASS.
- FULL: 2457/2457 PASS.
- HEAVY: 67/67 PASS.
- Protected MySQL functional gate: reported PASS.
- MySQL concurrency: 78/78 PASS, including Batch A 9/9.
- Browser: 24 responsive route-width checks and recorded end-to-end functional workflows.
- Build and diff verification: reported PASS.

These runtime results are recorded in the committed test evidence and development log. The final independent remote review verified the implementation and evidence paths without independently rerunning the runtime gates.

#### 5. Freeze Boundary

Only Sales & Customer Batch A (Waves 3–5) is frozen.

The following remain outside this Acceptance:

- Future Sales & Customer Waves 6–13.
- Deferred Credit, Prepayment and Reservation capabilities.
- Full Sales domain Acceptance.
- Production deployment and release certification.

`document.md §34` and approved Schema/Design remain authoritative. Any future change to an accepted Batch A business invariant must follow the project's controlled reopen and change-governance process.

#### 6. Git Integration Decision

The project owner authorized merging the accepted Batch A work into `master`.

The authorized Git scope is:

- Commit documentation-only Freeze records.
- Integrate the accepted branch into `master`.
- Prefer a fast-forward merge preserving the accepted commit history.

Not authorized:

- Creating or modifying Git tags.
- Package-version or release changes.
- Deployment.
- Production database operations.
- Starting Batch B automatically.

The freeze-record commit and resulting `master` HEAD may differ from the frozen implementation SHA because they contain subsequent governance documentation.

**Final governance status: BATCH_A_ACCEPTANCE_PASS / FROZEN — USER APPROVED.**

### 34.14 Sales & Customer Wave 6 — Final User Acceptance & Freeze Record (2026-10-18)

**Decision: ACCEPTANCE PASS / FROZEN — `WAVE6_FINAL_ACCEPTANCE_PASS — FROZEN`**

#### 1. User Approval

On 2026-10-18, the project owner explicitly approved Wave 6 Final Acceptance and Freeze and attested to a manual regression pass on the current dirty working tree:

- `USER_ATTESTED_MANUAL_REGRESSION_PASS` recorded in `log/2026-10-18.md` Final Acceptance Record. Detailed pass counts and exit codes were intentionally not archived in this audit transcript; the user attestation is retained and the gap is non-blocking under AGENTS.md §10/§11 because the same working tree was previously covered by the protected MySQL gate (see §3 below).
- File-organization decision formally accepted: `applicationRegistry.js → src/pages/logistics-finance.jsx → Returns` is the canonical Returns UI implementation location for Wave 6. No separate `src/pages/returns.jsx` will be created.

#### 2. Immutable Acceptance Baseline

- Repository: `quanyantan-svg/modern-erp`
- Accepted branch: `feature/sales-waves6-13`
- Accepted working-tree HEAD: `aee1e0c13d26dd840ae4b596340212eef03479c0` (unchanged from prior gates)
- Package version: `1.6.2` (unchanged)
- Existing release identity: `v1.6.2` (unchanged)
- Scope: Sales & Customer Wave 6 (Returns + Replacement) only
- Pre-existing DR-SAL-04 (Option A Confirm) and DR-SAL-05 (Option C Restricted Economic Reversal) decisions are independently frozen at `document.md §34.15` and remain authoritative.

The working tree at this acceptance is unstaged and uncommitted per AGENTS.md §11 and §5 (Git & Database Protection); the user explicitly did not authorize any commit, push, merge, tag, release, or production DDL in this Freeze record.

#### 3. Accepted Scope

- Sales Return Confirmation (DR-SAL-04 Option A) for `SO_BACKED` and `NO_SOURCE` modes.
- Sales Return Restricted Economic Reversal (DR-SAL-05 Option C) for confirmed `SO_BACKED` and `NO_SOURCE` Returns, full-return only.
- LOT conservative no-subsequent-negative-movement fence (R1).
- SERIAL outbound provenance authority (R2) + immutable provenance carrier `sales_return_valuation_provenance` (R3) + legacy fail-closed (R4).
- Mandatory explicit client-supplied `Idempotency-Key` for Option C reverse (no body / random / server fallback; missing → 400).
- Replacement lifecycle: Create / List / Detail / Partial / Multi-Delivery / Cancel / Fulfill with immutable fulfillment evidence and pure-derived OPEN/PARTIAL/FULFILLED/CANCELLED state.
- Three-mode commercial source distinction (DELIVERY_BACKED / SO_BACKED / NO_SOURCE) with NULL / unknown marker returning 409 `SALES_RETURN_MARKER_UNKNOWN` and never falling through to the legacy DELIVERY_BACKED reversal path.
- F5 schema relaxation: `return_reversals.amount_cents` and `return_reversal_items.amount_cents` `CHECK(amount_cents > 0)` → `CHECK(amount_cents >= 0)` for NO_SOURCE Option C compatibility.
- F6 `sales_order_replacements.state` (4-value) synchronised to `sales_order_replacements.cancellation_state` (2-value ACTIVE/CANCELLED).
- Wave 6 additive migration additive carrier `sales_return_valuation_provenance` with FK / CHECK / UNIQUE / supporting indexes on `inventory_valuation_movements`, `sales_return_valuation_provenance`, `sales_order_replacements`, `sales_order_replacement_lines`, `sales_replacement_fulfillments`.
- DELIVERY_BACKED `reverseOperationalReturn` and `confirmSalesReturn` frozen; Batch A contracts unchanged; MOVING_AVERAGE strict negative-movement rule preserved.

The accepted scope includes the associated authorization, audit, idempotency, economic consistency, concurrency and mobile browser contracts.

#### 4. Acceptance Evidence

Focused evidence:

- `server/sales-customer-wave6-functional.test.js`: 9 functional cases covering MA/LOT/SERIAL positive matrix, pool/stale-pool 409, LOT conservative fence pass/fail, SO_BACKED remaining capacity, standard-cost reject, Option C full reverse + replay + payload conflict 409, Replacement partial/multi-delivery/cancel/reverse-block, RBAC 403.
- `server/sales-customer-wave6-bounded-superseding.test.js`: 18 cases covering six-combination SO_BACKED/NO_SOURCE × MA/LOT/SERIAL positive matrix, LOT/SERIAL negative cases (subsequent OUT, replenishment, duplicate, ambiguous provenance), legacy ambiguity fail-closed, Option C mandatory idempotency-key (400/409/200), NULL/unknown marker 409, stale Confirm/Reverse, period/RBAC/dependency failures, zero partial side effects.
- `server/sales-customer-wave6-final-functional.test.js`: 5 functional closure cases.
- `server/sales-customer-wave6-migration.test.js`: 8 cases including the Wave 6 composite-index `inventory_valuation_movements(product_id, warehouse_id, lot_id, serial_id, status, created_at, id)` fresh/upgrade/replay and minimal-fixture skip paths.
- `server/mysql-sales-customer-wave6-concurrency.integration.js`: 5 race-class harness (same-identity Confirm, Reverse vs LOT OUT, three-session Confirm/Reverse/OUT, concurrent Reverse, concurrent SERIAL restoration) registered as the 8th suite in `scripts/gates/mysql-concurrency-gate.mjs`.
- `scripts/acceptance/sales-customer-wave6-responsive.mjs`: Browser / responsive UAT at 320 / 390 / 430 / 680 CSS px covering mode picker, Option C reverse, replacement creation and FULFILLED state.
- Browser evidence: `docs/evidence/sales-customer-wave6/return-create-320.png`, `return-create-390.png`, `return-create-430.png`, `return-create-680.png`, `replacement-fulfilled-390.png`.

Protected disposable MySQL evidence (recorded in `log/2026-10-18.md` §Wave 6 real MySQL acceptance gate, on the same HEAD `aee1e0c`):

- Protected preflight: `127.0.0.1:3306 / modern_erp_domain_test`, MySQL 8.0.37, InnoDB 16 KiB pages, Dynamic row format, application `READ COMMITTED`.
- `pnpm.cmd test:mysql` PASS: fresh bootstrap Waves 1–6, compatible upgrade, replay, legacy-row preservation, FK / UNIQUE / CHECK metadata, provenance schema, exact Wave 6 composite-index metadata, zero skipped tests.
- `pnpm.cmd test:mysql:concurrency` PASS across 8 suites, 84/84 tests, zero failures / skips / cancellations / todos; Wave 6 5/5 PASS via independent sessions with observed overlap at `mysql_transaction_gates.gate_id=1`.
- Optimizer evidence: the unforced LOT query selected `lot_id`; the bounded query forced `idx_valuation_movements_identity_status_created` with EXPLAIN-confirmed `ref` access, key length 1543; under `READ COMMITTED`, phantom safety is supplied by canonical `mysql_transaction_gates` writer serialization.

#### 5. Implementation Location & Final Technical Mapping

The Wave 6 Returns + Replacement UI is implemented inside the existing Returns component of `src/pages/logistics-finance.jsx`, registered in `src/navigation/applicationRegistry.js` as the route `returns`:

| Concern | File | Authoritative scope |
|---|---|---|
| Returns route registration | `src/navigation/applicationRegistry.js` line 164 | `returns: named('../pages/logistics-finance.jsx','Returns')` |
| Returns UI + Wave 6 mode picker + Option C reverse + Replacement lifecycle | `src/pages/logistics-finance.jsx` `Returns` component (lines ~2169+) | Three modes DELIVERY_BACKED / SO_BACKED / NO_SOURCE; surface toggle `returns / replacements`; `ReplacementModal` for create / fulfill / cancel; inline error surfaces for 409 |
| Returns UI styles | `src/styles.css` | `.wave6-mode-picker`, `.wave6-return-detail`, `.wave6-object-head`, `.wave6-line-list`, `.wave6-inline-error`, `.wave6-workflows`, `.wave6-inline-workflow`, `.wave6-replacement-line`, `.wave6-progress` and ≤520px mobile fallback |
| Sales Return canonical writer (Option A Confirm + Option C Reverse + Replacement CRUD) | `server/modules/sales-return-canonical-writer.js` | All §29.13.11 / §30.31 / §30.31.11 primitives; LOT/SERIAL guards; provenance freeze; idempotency-key handling |
| Sales Return + Replacement HTTP dispatch | `server/app.js` lines 2575–2614 (returns) and 2614–2621 (replacements) | Mode-aware route table; NULL / unknown marker → 409 `SALES_RETURN_MARKER_UNKNOWN` before any business mutation |
| Sales Return additive migration (F5 + F6 + provenance carrier) | `server/migrations/sales-customer-wave6-returns.js` | SQLite + MySQL; idempotent fresh / upgrade / replay |
| Sales Return value-bounded adapter (MA / LOT / SERIAL fail-closed) | `server/modules/financial-inventory.js` `applyWave6SalesReturnPoolValue` | NO `standard-cost` fallback; NO `LEGACY_UNVALUED`; positive pool required |
| Tracking / inventory mutation source-type | `server/lib/inventory-mutation.js` and `server/modules/traceability-quality.js` | Wave 6 source-type set + tracking write integration |
| MySQL plan rendering | `server/database/mysql-schema.js` `MYSQL_INDEX_PREFIX_LENGTHS` and `mysqlIndexColumnList` | `status(16)`, `created_at(64)` prefix realisation for the Wave 6 composite index under InnoDB 3072-byte key limit |
| Functional / regression tests | `server/sales-customer-wave6-*.test.js` (4 files) + `server/mysql-sales-customer-wave6-concurrency.integration.js` | Registered in `scripts/testing/test-suites.js` lines 84–87 and `scripts/gates/mysql-concurrency-gate.mjs` 8th suite entry |
| Mobile / responsive UAT | `scripts/acceptance/sales-customer-wave6-responsive.mjs` + `docs/evidence/sales-customer-wave6/*.png` | 320 / 390 / 430 / 680 CSS px; 44 px minimum control height; no horizontal overflow |

A future developer who searches for `src/pages/returns.jsx` should consult this section and `applicationRegistry.js`; no separate Returns screen file is created, by user acceptance on 2026-10-18. This is a technical implementation convergence, not a business Requirement change.

#### 6. Remaining Non-blocking Backlog

The following items are non-blocking for Wave 6 Freeze and are tracked as future work (each is independent of the accepted Wave 6 contract):

- Real MySQL independent-session concurrency re-run on the current dirty working tree is **not required** because `log/2026-10-18.md` §Wave 6 real MySQL acceptance gate already executed the gate on the same HEAD `aee1e0c` and covered every Wave 6 + Wave 0–2 + Batch A + generic + procurement + inventory schema / migration / DDL change. The §5 final regression was executed manually by the user and attested as PASS; detailed counts were not archived.
- Deferred Sales capabilities: Credit (Chapter 32), Prepayment (Chapter 32), Reservation (Chapter 33), Waves 7–13 — remain outside this Freeze.
- Wave 9 documentation cleanup: stale `credit_control_anchor` singular references in `solution.md §29.20 / §29.22 / §29.25 / §29.30 row 14 / §29.44 R-SAL-12/24` (per `log/2026-10-17.md` Phase 4 audit). Future documentation pass; non-blocking.
- Subsequent Drift Triages A–E from `document.md §34.15` R1–R4 record remain authoritative historical notes; none is a Freeze blocker.

#### 7. Freeze Boundary

Only Sales & Customer Wave 6 (Returns + Replacement, including DR-SAL-04 Option A and DR-SAL-05 Option C) is frozen by this record.

The following remain outside this Acceptance:

- Future Sales & Customer Waves 7–13.
- Deferred Credit, Prepayment and Reservation capabilities.
- Production deployment, release certification, and any tag / release / publish / push action.

`document.md §34.15 DR-SAL-04 / DR-SAL-05 / R1–R4` records, approved schema, and the `solution.md §30.31` bounded superseding Design remain authoritative. Any future change to an accepted Wave 6 business invariant must follow the project's controlled reopen and change-governance process.

#### 8. Git & Database Operations

No `git add`, `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git clean`, `git stash`, `git tag`, `git push --tags`, `release`, `deploy`, or `package.json` change was authorized by this record. No production / non-disposable database reset, DDL, DML, query, or schema mutation was authorized by this record. The accepted working tree at HEAD `aee1e0c` remains unstaged and uncommitted, awaiting the user's separate manual Git handling. `APPLY_GUIDE.md` is preserved verbatim.

**Final governance status: WAVE6_FINAL_ACCEPTANCE_PASS — FROZEN — USER APPROVED.**

---
