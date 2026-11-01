# Wave 8 Stage D — Implementation Verification and P1 Remediation

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## 35.25 Wave 8 Final Bounded Stage D implementation verification record

This section records implementation conformance after the user accepted §35.24 and authorized the final
bounded Stage D. It does not amend the Requirement or Design and does not declare Final Acceptance or
Freeze.

### 35.25.1 SALES reference access implementation

- `server/app.js` dispatches the approved Handoff and Return context-only GET routes to the Consignment
  owner; no generic warehouse-management permission or route was granted to SALES.
- `server/modules/consignment.js` applies the existing joint `SALES_MANAGE` + `CONSIGNMENT_MANAGE` gate,
  Sales Group scope, nested document/line identity, state/capacity checks and bounded response projections.
- Handoff exposes only the authoritative `source_warehouse_id` and its active bins. Return exposes only
  active non-Supplier-WIP enterprise warehouses; a bin-enabled warehouse is omitted when it has no active
  bin. Internal classification and warehouse-management fields are not returned.
- Handoff/Return commands re-read permission, scoped document/line version and status, and lock/revalidate
  submitted warehouse/bin rows inside the caller-owned transaction. Handoff also locks the effective
  commercial-location warehouse/bin mapping. Stale, inactive, Supplier-WIP or mismatched-bin selections
  fail before inventory, commercial, audit or idempotency effects.
- Settlement remains independent of the reference routes and derives its source only from immutable
  historical V21 Handoff evidence.

### 35.25.2 UI and acceptance integration

`src/pages/wave8-sales.jsx` uses the context routes for Handoff and Return selectors. The two workflows no
longer accept raw warehouse/bin ids and a normal SALES actor does not call `/api/warehouses`. Return retains
an explicit destination and supports a qualifying warehouse different from the Handoff source.

The real Edge acceptance driver uses a real `role-sales` session for Handoff, Settlement and Return, checks
the generic warehouse API and Consignment reference denial boundaries, and exercises 320/390/430/680 CSS
px layouts. Admin use is limited to fixture preparation.

### 35.25.3 Credit reversal, lock order and idempotency evidence

- Independent MySQL sessions cover Reversal × Reversal, Reversal × Credit Creation and Reversal × Invoice
  VOID, plus exact replay and changed-payload conflict. Assertions reconcile Credit, Adjustment, Voucher,
  AR and Invoice states/amounts and prove loser zero effects.
- The production lock paths remain composable: Invoice POST/VOID/Credit first acquire the shared
  `SO Line → Fulfillment → FINAL AR` plan; Service CONFIRM uses the same SO Line → Fulfillment order before
  Finance recognition. Credit Reversal uses its separate `Finance open item → adjustment/balance → credit
  note → invoice` order. No reverse acquisition chain was found.
- A real HTTP same-key/different-payload request returns 409. The frozen control layer reports
  `BUSINESS_RULE_BLOCKED`; this is the approved non-blocking compatibility difference and is not rewritten.

### 35.25.4 Final verification evidence

The completed final-state gates are:

- focused Consignment functional 5/5 and Wave 8 residual 11/11;
- `test:fast` 380/380, `test` 2623/2623, `test:heavy` 67/67 and Vite build PASS;
- real Edge acceptance: 36 responsive checks and 16 workflow flows PASS;
- MySQL integration 56/56 PASS;
- MySQL concurrency 102/102 PASS, including Wave 8 15/15 and independent-connection stale Return
  destination deactivation/Supplier-WIP reclassification checks.
- `git diff --check` PASS (exit 0; line-ending notices only, no whitespace error).

No schema/table/permission was added by the SALES reference correction. No production migration,
deployment, release, version change or Git write is part of this record. Final user acceptance and Freeze
remain outside Stage D authority.

**Implementation status: `WAVE8_FINAL_CLOSURE_COMPLETE — READY_FOR_INDEPENDENT_REAUDIT`.**

## 35.26 Wave 8 Two-P1 bounded remediation implementation record

This section records the implementation evidence for the two P1 findings accepted for bounded remediation.
It does not change the approved Requirement, schema, V21 authority, or frozen non-Service Finance behavior,
and it does not declare Final Acceptance or Freeze.

### 35.26.1 A3 Invoice/Link lock-chain closure

`server/modules/finance-recognition.js` now discovers the complete Service invoice source plan outside the
transaction and locks it inside the transaction in the fixed order:

`SO Line -> Fulfillment -> FINAL AR -> Invoice -> Existing Links`.

All sets are ordered by stable ids and the MySQL path issues real `FOR UPDATE` reads for each non-empty
stage. The Invoice row is the serialization authority for both lifecycle state and a not-yet-existing Link;
an empty Link result is not treated as a gap lock. Existing Links are locked after the Invoice, and the
persisted unique tuple remains the insert-time collision guard. After the five stages, the plan is
authoritatively re-read; candidate, Invoice snapshot, or persisted-Link drift raises
`A3_INVOICE_SOURCE_PLAN_STALE` before any effect.

`server/modules/commercial-golive.js` composes the same prefix for Sales Invoice POST, VOID, Credit creation,
and Credit Reversal. When an independently discovered plan becomes stale while waiting for the prefix, the
owner rolls back the complete attempt and performs one bounded rediscovery in a new transaction. It never
retries inside a caller-owned transaction, never retries another business error, and a second drift remains
a controlled 409. This preserves exact POST replay and the legal Reversal x Credit composition without
weakening locked authoritative re-reads. Service CONFIRM retains its approved parent-first prefix and never
acquires Invoice/Link or Credit-child rows in reverse order.

Focused probes prove that all five MySQL lock statements execute in order, that Invoice/Link snapshot drift
fails closed, that a newly appearing upstream candidate is rejected as stale, and that an empty Link set is
protected by the Invoice authority rather than an empty-row-lock assumption. Independent-connection MySQL
races separately prove the resulting economic outcomes; the adapter's global transaction gate is not used
as proof of the five-stage row-lock order.

### 35.26.2 Reference API HTTP negative matrix closure

`server/sales-customer-wave8-mixed-delivery.test.js` calls both registered HTTP routes through the real app,
login, authentication, RBAC, and Sales Group scope chain:

- Handoff and Return without authentication return 401;
- an authenticated actor without the joint business permissions returns 403;
- a SALES actor outside the document Sales Group returns 403;
- an unknown document returns 404;
- a Return line not belonging to the document returns 404.

Every refusal body is checked against document, warehouse, bin, commercial-location, source-warehouse, and
cross-group sentinel values. Existing route behavior already satisfied the contract, so no Reference API
production code change was required for this finding.

### 35.26.3 Final verification and compatibility

- Wave 8 focused: 64/64 PASS; fast: 380/380 PASS; full: 2626/2626 PASS; heavy: 67/67 PASS.
- Vite production build: PASS, 1963 modules transformed.
- MySQL integration: 56/56 PASS and `MYSQL TESTS = PASS`.
- MySQL concurrency: 102/102 PASS, including Wave 8 15/15 for POST/POST, POST/VOID, Credit/Credit,
  Credit/VOID, Reversal/Reversal, Reversal/Credit Creation, Reversal/Invoice VOID, exact replay and conflict.
- Real Edge acceptance: 36 responsive checks and 16 workflows PASS at 320/390/430/680 CSS px, including a
  real SALES Handoff, Settlement, cross-warehouse Return, conflict, denial, and navigation lifecycle.

No table, column, migration, permission, route, release version, or deployment contract changed. README and
`document.md` require no edit because project structure/commands/release identity and approved Requirements
did not change. Final user acceptance and Freeze remain outside this remediation authority.

**Remediation status: `WAVE8_FINAL_TWO_P1_REMEDIATED — READY_FOR_TARGETED_REAUDIT`.**
