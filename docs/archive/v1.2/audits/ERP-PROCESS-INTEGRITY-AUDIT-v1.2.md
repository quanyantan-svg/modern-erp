# ERP Process Integrity Audit Baseline — v1.2.0-rc.2

> Historical V1.2 evidence. This audit describes `v1.2.0-rc.2` and is not the current V1.3 product, requirement, architecture, or release-status source of truth.

## A. Executive summary

| Item | Result |
|---|---|
| Audit target | `v1.2.0-rc.2` / `1fe8e099c55ebcc2d5b7eaa4f0a717324fa6cfdc` |
| Head verification | PASS — tag and HEAD match exactly |
| Audit date | 2026-09-23 (Asia/Shanghai) |
| Scope | Current repository code, SQLite schema/migrations, UI routes/pages, permission seeds, API routes, audit/lifecycle implementation, and automated tests |
| Product code/schema/UI changed | NO |
| External production contacted or modified | NO evidence; no production endpoint or service was contacted |
| Local workspace data modified | **YES — unintended test side effect:** `pnpm test` deleted `data/erp.db`, `data/erp.db-shm`, and `data/erp.db-wal`; see §B.3 and finding P0-01 |
| Build | PASS — Vite 7.3.6, 1,926 modules; bundle-size warning (>500 kB) |
| Test | PASS — 1,291/1,291 tests, 249 suites, 0 failed/skipped/todo, 36.16 s |
| Release recommendation | **BLOCKED** for production/process acceptance; disposable demo/UAT only after isolating the test database |

The implementation has several individually sound controls: canonical approval covers exactly the intended five document families; stock and finance postings are generally wrapped in `BEGIN IMMEDIATE` transactions; sales/purchase settlement allocation uses integer cents and transaction-level caps; inventory-check approval is the sole stock-changing event for that document; creator self-approval is blocked for canonical approvals and manual vouchers.

Those controls do not yet form an end-to-end process-safe ERP. Logistics documents can be created directly or linked only nominally, without enforcing approved source status, party, line, quantity, price, or quality gates. IQC/OQC are observational islands. Production permissions exclude the warehouse role from material issue and finished-goods receipt. Requested/promised dates and commercial terms are missing from core orders. Return/discount settlement is modeled as separate negative subledger rows, so aggregate balances can be zero while the original invoice row remains open. Several screens disagree on whether an entered amount is yuan or cents. Finally, the test suite itself is not isolated from the default workspace database.

## B. Method, evidence, and limitations

### B.1 Method

This is an audit-only baseline. The review traced each major document through UI entry, API authorization and validation, schema, status transition, downstream documents, stock/accounting effect, transaction boundary, audit trail, lifecycle treatment, and tests. Read-only SQL was used on the database that existed at audit start. No corrective migration, seed, product source, permission, or UI change was made.

Primary files inspected include:

- `server/app.js`, `server/db.js`, `server/modules/approvals.js`, `server/modules/planning-documents.js`, `server/modules/production-workflow.js`, `server/modules/settlement.js`, `server/modules/lifecycle.js`, and associated route modules.
- `src/App.jsx`, `src/applicationMetadata.js`, `src/lib/money.js`, and all 19 pages under `src/pages/`.
- 61 test files under `server/`, plus `package.json`, environment/deployment files, and the current audit/refactor documentation.
- Repository inventory: 125 JavaScript/JSX source files, 53 navigation entries, and approximately 253 registered route declarations.

### B.2 Verification commands

| Command/check | Outcome |
|---|---|
| `git rev-parse HEAD` and exact tag check | `1fe8e099...`, exact tag `v1.2.0-rc.2` |
| Read-only SQLite schema/role queries | Completed before test execution |
| `pnpm test` | PASS, 1,291 tests |
| `pnpm build` | PASS; large-chunk warning only |

### B.3 Material audit incident: test database destruction

Before tests, the workspace contained `data/erp.db` (1,490,944 bytes) and its WAL/SHM files. The test at `server/production-safety.test.js:233-249` claims it creates no actual file but executes `node server/reset-data.js` with `NODE_ENV=development` and without an isolated `ERP_DB_PATH`. `server/reset-data.js:11-15` resolves the repository's default `data/erp.db` and removes it plus WAL/SHM. Running the explicitly requested test suite therefore deleted the three local database files.

The files were not recreated, restored, or replaced during this audit. No recoverable copy was found in the repository or its temporary project directory. Recovery, if required, needs an external backup or another authoritative copy. This incident is itself audit evidence and is classified P0-01. It prevents an unconditional `PRODUCTION MODIFIED=NO` statement for the local workspace; it does not show that an external production system was touched.

### B.4 Limitations

- This is static/code-path analysis plus the repository's automated suite, not a live production transaction replay.
- The original database could not be queried after the test incident. Schema and role evidence cited here was captured beforehand; subsequent conclusions rely on source and tests.
- Passing tests describe implemented behavior, not necessarily required business behavior. Several tests explicitly codify gaps identified below.
- The runtime is SQLite (`node:sqlite`) despite the project deployment requirement of MySQL 8.0. No MySQL migration execution was available to validate.

## C. System and architecture baseline

| Layer | Observed implementation | Integrity consequence |
|---|---|---|
| Front end | React 19/Vite 7; domain pages, but several large multi-domain pages and duplicate finance entry points | Unit/field semantics differ by screen; navigation permission is not a complete control |
| API | Node 22 native HTTP; large `server/app.js` plus modules | Authorization/validation conventions vary by route family |
| Database | `DatabaseSync` from `node:sqlite`, WAL, `PRAGMA foreign_keys=ON` | Does not meet stated MySQL 8 target; SQLite-specific SQL and locking remain |
| Transactions | Shared helper executes `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` (`server/db.js:1568-1577`) | Strong single-database atomicity where the helper is used; no distributed/outbox protection |
| Schema evolution | Imperative startup `CREATE/ALTER` statements and seed logic | No independently versioned, reversible MySQL migration chain |
| Money | Mostly integer `*_cents`; UI contracts vary | Storage is often correct, but entry/display conversions can be wrong by 100× |
| Audit | `audit_logs`, approval logs, lifecycle logs | Broad coverage, but ordinary cancel/archive and destructive lifecycle cleanup are not equivalent to accounting reversal |
| Idempotency | Status guards and some unique source indexes | No request idempotency keys; duplicate HTTP submissions rely mainly on current status |

## D. Canonical approval boundary

`server/modules/approvals.js` defines exactly these five canonical families:

1. `SALES_ORDER`
2. `PURCHASE_ORDER`
3. `INVENTORY_CHECK`
4. `ACCOUNTING_VOUCHER`
5. `PURCHASE_REQUISITION`

This boundary is correct and should remain narrow. IQC/OQC, delivery/receipt confirmation, material issue/production receipt, returns, discounts, collections/payments, adjustments, transfers, and scrap are operational/posting workflows, not candidates for silently joining the generic approval center. They need explicit domain gates and segregation of duties instead.

The approval detail is incomplete as a decision package: sales and purchase orders have amounts and lines but no requested/promised date because the schema lacks those fields; purchase requisition can carry zero reference price; manual vouchers are visible, but accounting users cannot approve and administrators are the practical approvers.

## E. Role, permission, and segregation-of-duties matrix

Read-only role inspection at audit start found five seeded roles. `ADMIN` has all 113 permissions. The table focuses on process-critical permissions.

| Role | Intended responsibility | Effective critical rights | Missing/excess rights and SOD result |
|---|---|---|---|
| `SALES` | Customer/order creation | Sales order create/submit/view; also delivery and sales-return manage/view; PO, purchase receipt, and inventory-transfer create/submit/manage | **Excessive:** combines commercial entry, procurement, warehouse execution, and returns. **Missing:** PR visibility/management, so instruction→PR flow is inaccessible. |
| `WAREHOUSE` | Physical stock execution | Delivery/receipt/return, IQC/OQC, inventory count/adjust/transfer/scrap, warehouse master | **Missing:** production material issue and production receipt; cannot execute normal production logistics. Same manage permissions can often create and confirm adjustment/scrap/transfer. |
| `REVIEWER` | Independent approval | SO/PO/PR approval and read; supporting master/logistics read | **Missing:** `INVENTORY_CHECK_APPROVE`, so inventory counts route to admin. |
| `ACCOUNTING` | Voucher, AR/AP, treasury | Voucher submit; AR/AP; collection/payment; cash/bank/bills/assets; discounts; reports | Cannot approve vouchers, which is good for SOD, but practical approval defaults to admin. Some write APIs use broad view permissions. |
| `ADMIN` | Administration/emergency | All permissions | Becomes mandatory operator for inventory-check approval, production issue/receipt, lifecycle cleanup, and voucher approval; this is systemic admin dependency. |

Target SOD policy:

| Event | Creator | Independent reviewer/confirming role | Required change |
|---|---|---|---|
| SO/PO/PR approval | Sales/buyer/requester | Reviewer | Preserve self-approval block; split buyer from sales |
| Inventory-check approval | Warehouse count creator | Reviewer | Grant `INVENTORY_CHECK_APPROVE` to reviewer, not creator |
| Voucher posting | Accounting preparer | Accounting reviewer/financial controller | Add non-admin approver role; preserve self-approval block |
| Delivery/receipt/return | Sales/purchasing source owner | Warehouse executor | Remove warehouse execution from sales; enforce approved source |
| Material issue/FG receipt | Production request/planning | Warehouse executor | Grant narrowly scoped execution permissions to warehouse |
| Settlement confirmation | Accounting cashier | Separate treasury/accounting reviewer when above threshold | Add explicit confirmation/reversal authority |
| Lifecycle destructive cleanup | Operational owner requests | Admin + accounting/data-control approval | Restrict to exceptional recovery, not normal cancellation |

## F. End-to-end process maps

### F.1 Sales to cash

`SO DRAFT → SUBMITTED → APPROVED/REJECTED → delivery DRAFT → CONFIRMED → stock out + posted voucher + AR → collection allocation → optional return/discount credits`

- Strong: SO creator/reviewer separation; delivery posting is atomic; status guard prevents double confirmation; collection allocation total and open-balance caps are transactionally checked.
- Broken links: delivery may be unlinked; if linked, approved status, customer identity, source line, cumulative delivered quantity, and approved price are not enforced. OQC is not a gate. A sales return may be unlinked or inconsistent with the delivery and lacks cumulative-return protection.
- Accounting: delivery confirmation posts stock and revenue/AR. Return and discount create separate negative AR rows instead of adjusting/allocating against the original source row.

### F.2 Procure to pay

`MRP/planning instruction → purchase instruction → PR → approval → generated PO → approval → receipt → stock in + posted voucher + AP → payment allocation → optional return/discount credits`

- Strong: PO and PR use canonical approval; receipt posting is atomic; payment allocations are capped in a transaction.
- Broken links: ordinary `SALES` cannot operate the PR step, while admin can. PR reference price defaults to zero and a generated PO copies it. Receipt price is editable raw cents. Receipt source checks do not enforce approved PO, supplier, line, cumulative quantity, or price. IQC is not a receipt gate. Purchase returns have equivalent provenance gaps.
- Accounting: AP due date is created as the business date; no supplier payment terms or computed contractual due date.

### F.3 Plan to produce

`approved SO/forecast → MRP → purchase/production instructions → production order → PENDING → IN_PROGRESS → material issue → production receipt → COMPLETED`

- MRP uses SO `submitted_at || reviewed_at || created_at` as need date because SO lacks a requested-delivery date. This can exclude valid future demand or schedule it incorrectly.
- Production instruction/order creation does not change stock, which is correct.
- Material-issue confirmation requires an in-progress order and posts stock out atomically.
- Finished-goods receipt enforces a cumulative planned-quantity cap and posts stock in atomically, but does not require sufficient component issue or an appropriate order phase.
- Production order can complete without reconciling issued components and received finished goods. Warehouse cannot perform either production posting with its seeded role.

### F.4 Inventory control

- Inventory check: `DRAFT → SUBMITTED → APPROVED`; only approval changes inventory. Approval compares the original system quantity to current quantity, reducing stale-count risk. Reviewer role lacks the permission, however.
- Transfer/adjustment/scrap: domain-specific statuses exist, but creator/confirm authority is insufficiently separated. No canonical approval is required or recommended; a focused warehouse-control confirmation role is preferable.
- Stock ledger and balance update are usually in the same SQLite transaction. No universal unique `(source_type, source_id, line_id)` posting key exists.

### F.5 Record to report

- Automated operational postings create vouchers as posted effects inside the source transaction.
- Manual voucher: `ENTERED → SUBMITTED → POSTED` or `REJECTED → ENTERED`; creator self-post is blocked.
- Manual voucher creation is authorized by `ACCOUNTING_VIEW`, conflating read and write. Line validation uses JavaScript numbers and permits up to a one-cent debit/credit difference; strict positive integer-cent checks are not consistently enforced.
- Period-close checks protect lifecycle cleanup in closed periods, but the project lacks a complete, independently migrated MySQL ledger baseline.

## G. Document and entity integrity matrix

Legend: **A** atomic with its posting; **S** status guard; **U** database uniqueness/source guard; **N** none/insufficient. “Lifecycle” describes current recoverability, not the recommended policy.

| Document/entity | Create/edit authority | Statuses / transition owner | Source and downstream | Stock/accounting effect | Idempotency & concurrency | Audit/lifecycle/tests |
|---|---|---|---|---|---|---|
| Sales order | Sales create; creator edits/submits; reviewer approves | DRAFT→SUBMITTED→APPROVED/REJECTED | Customer/items → delivery, MRP | None at approval | S; no request key | Audit + canonical approval; draft delete; covered, but dates absent |
| Purchase requisition | Planning/admin path; reviewer approves | DRAFT→SUBMITTED→APPROVED/REJECTED | Purchase instruction → generated PO | None | S | Audit + canonical approval; zero price accepted; role-path gap |
| Purchase order | Sales currently can create/submit; reviewer approves | DRAFT→SUBMITTED→APPROVED/REJECTED | Optional PR → receipt | None at approval | S | Audit + canonical approval; no promised date/tax contract |
| Inventory check | Warehouse creates/submits; admin effectively approves | DRAFT→SUBMITTED→APPROVED | Warehouse/product snapshot | Approval writes stock and ledger | A+S; current-qty recheck | Strong tests; reviewer permission missing |
| Accounting voucher | Accounting prepares/submits; admin posts | ENTERED→SUBMITTED→POSTED/REJECTED | Manual or operational source | Ledger voucher itself | A+S; source uniqueness varies | Audit; delete entered/rejected; numeric validation weak |
| Sales delivery | Sales or warehouse; same manage right confirms | DRAFT→CONFIRMED/CANCELLED | Optional SO → AR/voucher/stock | Confirm: stock−, Dr AR/Cr revenue | A+S; N provenance/idempotency key | Audit; lifecycle cleanup; tests omit source integrity/OQC |
| Sales return | Sales/warehouse | DRAFT→CONFIRMED/CANCELLED | Optional delivery → negative AR/voucher/stock | Confirm: stock+, reversal posting | A+S; N cumulative/source controls | Audit; lifecycle cleanup; tests accept loose source |
| Purchase receipt | Sales or warehouse | DRAFT→CONFIRMED/CANCELLED | Optional PO → AP/voucher/stock | Confirm: stock+, Dr inventory/Cr AP | A+S; N provenance; editable price | Audit; lifecycle cleanup; IQC not gated |
| Purchase return | Sales/warehouse | DRAFT→CONFIRMED/CANCELLED | Optional receipt → negative AP/voucher/stock | Confirm: stock−, reversal posting | A+S; N cumulative/source controls | Audit; lifecycle cleanup |
| IQC | Warehouse/quality permission | DRAFT→COMPLETED/CANCELLED | Free-text receipt id; no enforced downstream | None | S only | Audit; archive; no receipt gate/effect |
| OQC | Warehouse/quality permission | DRAFT→COMPLETED/CANCELLED | Free-text delivery id; no enforced downstream | None | S only | Audit; archive; no delivery gate/effect |
| MRP plan | Planning | calculation/release variants | Approved SO + forecast → instructions | None | Run/status guards only | Audited/tested algorithmically; wrong SO demand date |
| Forecast | Planning | active planning record | Demand input → MRP | None | N business dedupe | CRUD/audit; has period dates |
| Purchase instruction | Planning/admin | DRAFT→RELEASED/CANCELLED | MRP → PR | None | S | Audit; operator-role bottleneck |
| Production instruction | Planning/admin | DRAFT→RELEASED/CANCELLED | MRP → production order | None | S/link field | Audit; generated-order link |
| Production order | Production permission | DRAFT→PENDING→IN_PROGRESS→COMPLETED/CANCELLED | Instruction/BOM → issue/receipt | No direct stock/accounting | S; weak reconciliation guard | Audit; cannot prove complete manufacturing |
| Material issue | Admin with current seeds | DRAFT→CONFIRMED/CANCELLED | Production order/items → stock ledger | Confirm: stock− | A+S; shortage rechecked | Audit/lifecycle; no normal delete; warehouse blocked |
| Production receipt | Admin with current seeds | DRAFT→CONFIRMED/CANCELLED | Production order/product → stock ledger | Confirm: stock+ | A+S; cumulative output cap | Audit/lifecycle; issue prerequisite absent |
| Inventory adjustment | Warehouse | DRAFT/confirmed/cancelled family | Warehouse/product → stock ledger | Confirm changes stock | A+S | Audit/lifecycle; SOD weak |
| Inventory transfer | Warehouse/Sales currently | Draft/execution family | From/to warehouse → two-sided ledger | Confirm moves stock | A+S | Audit/lifecycle; commercial role excess |
| Inventory scrap | Warehouse | DRAFT/confirmed/cancelled family | Warehouse/product → stock ledger | Confirm stock− | A+S | Audit/lifecycle; SOD weak |
| AR/AP subledger row | System reconciliation from confirmed source | OPEN/PARTIAL/SETTLED semantics | Delivery/return/discount or receipt/return/discount | Receivable/payable balance | U for several source pairs; persisted paid total | Reconcile creates missing rows only; does not rebuild allocation truth |
| Collection/payment | Accounting | DRAFT→CONFIRMED/CANCELLED | Party + allocations → AR/AP paid cents | Confirm updates allocations/subledger/cash | A+S; cap rechecked | Audit; confirmed reversal absent; cancelled draft undeletable |
| Sales/purchase discount | Accounting | Confirmed economic credit record | Required positive source AR/AP → negative row | Reduces aggregate net balance | A+S; source link required | UI source selection exists; list displays reason under source column |
| Bank/cash journal | Accounting | CRUD/posting variants | Account → treasury balance | Cash/bank effect | Inconsistent screen contract | Audit/tests do not catch duplicate UI 100× issue |
| Bills/fixed assets | Accounting | Domain lifecycles | Treasury/assets → accounting | Financial effects | Varies | Separate pages/routes; request field names diverge in treasury page |
| Lifecycle cleanup job | Admin (`USERS_MANAGE`) | preview→confirmed cleanup/archive | Registry dependency graph | Can delete effects and rewrite balances | Transactional + reason/confirm + closed-period/dependency guards | Dedicated audit log; destructive recovery, not normal reversal |

Secondary master/support entities reviewed include customers, suppliers, products, warehouses, departments, auxiliary projects, currencies, voucher words/templates, accounting periods, bank accounts/statements/reconciliations, BOMs, work centers, routings, labor records, supplier evaluations, CRM opportunities, projects, leave/expense records, alerts, and system settings. They have CRUD/audit coverage of varying depth, but do not repair the core source-of-truth gaps above. Master-data deletion is generally blocked by references or replaced with active/archive semantics; this is preferable to cascading deletion.

## H. Status, source, and field coverage gaps

| Domain | Missing or weak mandatory fields | Consequence |
|---|---|---|
| Sales order | Order date, requested delivery date, ship-to/contact snapshot, currency/tax terms, payment terms | Approval cannot evaluate commitment; MRP uses workflow timestamp instead of need date |
| Purchase order | Order/promised delivery date, supplier contact/address snapshot, currency/tax/payment/incoterm fields | Receipt and AP timing cannot be contract-derived |
| Delivery/receipt | Enforced approved source line, cumulative quantity, inherited price, lot/batch where applicable | Over-delivery/receipt and repricing are possible |
| Returns | Enforced confirmed source, same party/product, cumulative return quantity, inherited value basis | Unbounded or mispriced reversal possible |
| IQC/OQC | Enforced FK, source status, source lines/sampling, inherited quantities, disposition/effect | Quality completion is disconnected documentation |
| AP/AR | Payment terms, contractual due-date derivation, currency/exchange rate | Aging is operationally misleading; due date defaults to business date |
| Production | Required issue/receipt reconciliation, scrap/yield, lot trace, closure tolerance | Order can complete without material/output integrity |

## I. Money-unit and arithmetic audit

The canonical storage intent is integer cents. `src/lib/money.js` supports yuan↔cent conversion, and SO/PO/master-product screens generally convert yuan input to cents correctly. The contract is not consistent across all pages:

| Surface | Observed contract | Finding |
|---|---|---|
| SO/PO | UI yuan → API cents | Correct |
| Collection/payment | UI yuan → API cents; allocation caps in cents | Correct within settlement module |
| PR/planning | UI explicitly asks for “参考单价（分）”; defaults to 0 | Internally consistent but unsafe/usability-poor; zero propagates to PO |
| Delivery/receipt/returns | Field named/sent `unitPriceCents`, visually labeled merely “单价” | A user entering 2,000 as yuan sends 2,000 cents = ¥20. With quantity 10, total displays ¥200; this explains the reported 2,000→200 anomaly pattern |
| Treasury cash journal page | One page supplies a cents-named value while backend multiplies input by 100 | 100× overstatement path; duplicate accounting page follows a different convention |
| Bank/bill forms in treasury page | Sends `*_cents` names where API expects non-suffixed amount names | Zero/default or validation failure depending route |
| Manual voucher | Numeric totals, tolerance up to 1 cent | Ledger should require positive integer cents and exact equality |

No floating point should cross a posting boundary. The recommended API contract is unambiguous integer cents in JSON (`amountCents`, `unitPriceCents`) with UI components solely responsible for locale-aware yuan parsing; alternatively accept decimal-string yuan, but never both across routes.

## J. Settlement and zero-balance proof

Current per-row open formula is effectively:

`open = amount_cents + adjustment_cents - paid_cents - write_off_cents`

Returns and discounts create separate negative AR/AP rows. This makes party-level netting differ from source-document settlement.

### J.1 Required AR scenario

| Event | Aggregate AR movement | Original positive AR row |
|---|---:|---:|
| Sale | +100,000 | amount 100,000; open 100,000 |
| Return | −2,000 separate row | unchanged |
| Discount | −3,000 separate row | unchanged |
| Collection allocated | −95,000 payment against positive row | paid 95,000; **open 5,000** |
| Aggregate result | **0** | **source row is not zero** |

### J.2 Required AP scenario

| Event | Aggregate AP movement | Original positive AP row |
|---|---:|---:|
| Purchase | +14,000 | amount 14,000; open 14,000 |
| Discount | −1,000 separate row | unchanged |
| Payment allocated | −13,000 against positive row | paid 13,000; **open 1,000** |
| Aggregate result | **0** | **source row is not zero** |

Therefore the target statement “source open = invoice − return − discount − cash = 0” is **not satisfied**. Tests deliberately accept post-settlement credit balances (for example, fully settle then add a discount), showing that future-offset credit behavior is intentional in current code. That behavior needs explicit unapplied-credit/prepayment documents and allocation, not implicit party-level netting.

`paid_cents` and allocation-item sums are redundant truths. Startup reconciliation creates missing AR/AP rows from confirmed documents but does not recompute paid totals/statuses from allocations. A controlled invariant check and repair tool is required.

## K. Quality-control integrity

IQC and OQC exist as documents but are disconnected from the warehouse source of truth:

- `receipt_id`/`delivery_id` is accepted as text without a database FK or authoritative existence/status/party check.
- Lines/quantities/results are re-entered rather than inherited and bounded by source lines.
- Completion accepts result and quantity values but does not place accepted stock into a controlled state, quarantine rejected quantity, block receipt/delivery confirmation, or create a disposition task.
- A failed inspection has no stock, fulfillment, accounting, or workflow effect.

Recommended state model:

- Purchase: PO-approved → receipt recorded into `QUARANTINE` → IQC pass releases accepted quantity to available stock; fail/reject creates disposition/return path.
- Sales: approved SO → pick/reserve → OQC pass permits delivery confirmation; fail returns lines to hold/rework.
- Quality records must inherit immutable source party/product/lot/quantity snapshots and enforce cumulative inspected quantity.

## L. Lifecycle, cancellation, archive, reversal, and cleanup

The lifecycle engine has useful preview, dependency graph, confirmation, reason, closed-period checks, transactional execution, and audit. Its classes include safe delete, chain cleanup, reversal cleanup, archive only, and blocked. However, physical cleanup of confirmed documents can remove stock/finance effects and rewrite balances; that is emergency data repair, not ordinary business reversal.

Target policy:

| State/effect | Allowed normal action | Required invariant |
|---|---|---|
| Draft, no downstream/effect | Hard delete | Creator/authorized owner; audit delete |
| Submitted/rejected, no effect | Withdraw/cancel/archive; optional delete by policy | No downstream references |
| Cancelled, no effect | Archive by default | Searchable history retained |
| Confirmed/posted, open period | Explicit reversal document | Original immutable; equal-and-opposite stock/ledger; links preserved |
| Confirmed/posted, closed period | Current-period reversal with controller approval | Never rewrite closed-period history |
| Corrupt/invalid data | Exceptional lifecycle repair | Preview, backup, dual authorization, audit, invariant verification |

Current gaps include no normal reversal for confirmed collection/payment; cancelled draft settlement records cannot be deleted through the ordinary workflow; material issue/production receipt lack normal draft delete; broad admin cleanup risks erasing evidence; and lifecycle coverage is not universal across quality and extended-domain documents.

## M. Database integrity, transaction safety, and auditability

### Strengths

- Foreign keys are enabled in SQLite.
- Posting routines commonly wrap status check, stock check, stock/subledger/voucher writes, and audit in one `BEGIN IMMEDIATE` transaction.
- Several AR/AP source combinations have uniqueness constraints.
- Inventory-check approval rechecks current stock.
- Approval and lifecycle actions write dedicated audit records.

### Gaps

- Core item/source relationships and IQC/OQC references are not uniformly protected by FKs.
- Business constraints—approved source, same party, matching lines, remaining quantity/value—are mostly absent at the database and service layers.
- No universal posting-key uniqueness prevents duplicate ledger rows independently of mutable status.
- No API idempotency key protects client retries.
- Audit logs do not substitute for immutable reversal chains.
- SQLite `BEGIN IMMEDIATE` behavior and SQL cannot be assumed equivalent to MySQL 8 isolation/locking.
- Startup imperative schema mutation is not an auditable production migration ledger.

Recommended database invariants include unique posting-source keys; FK-backed source IDs; nonnegative integer-cent/quantity checks; source-line references on logistics/returns/quality; allocation-sum reconciliation; optimistic version or guarded `UPDATE ... WHERE status=?`; and MySQL transaction/concurrency tests using the deployment engine.

## N. Disposition of the 13 reported defects

| # | Reported defect | Disposition | Evidence/conclusion |
|---:|---|---|---|
| 1 | SO/approval missing order/delivery date | **VERIFIED** | Schema/UI/approval omit requested delivery date; MRP substitutes workflow timestamp |
| 2 | Purchase instruction→PR/PO admin-only, zero amount, 2,000→200 | **PARTIALLY VERIFIED** | Sales lacks PR path; PR defaults price to zero; generated PO copies it. Raw-cent receipt entry reproduces ¥2,000 interpreted as 2,000 cents and quantity 10 totaling ¥200 |
| 3 | IQC disconnected | **VERIFIED** | No authoritative FK/source validation, inheritance, gate, or stock effect |
| 4 | AP has no terms/due date | **PARTIALLY VERIFIED** | `due_date` exists, but is set to business date; no contractual payment terms |
| 5 | Warehouse cannot issue; invalid/scrapped records cannot be cleaned | **VERIFIED** | Warehouse lacks production-issue permission; cancel is draft-only; normal delete absent; lifecycle is archive/destructive admin repair rather than business reversal |
| 6 | Production receipt is admin-only | **VERIFIED** | Permission exists but is not seeded to warehouse |
| 7 | OQC disconnected | **VERIFIED** | Symmetric to IQC; no delivery gate/effect |
| 8 | Sales discount cannot select source | **NOT REPRODUCED at expected HEAD** | UI filters AR by customer and provides source dropdown; backend requires source. Separate UI defect: source column renders reason |
| 9 | Cancelled collection cannot be removed; return changes overall balance but not allocation detail | **VERIFIED** | No ordinary delete; return is separate negative AR and does not alter original allocation/source open |
| 10 | Purchase discount cannot select source AP | **NOT REPRODUCED at expected HEAD** | UI source dropdown and backend link exist; source column likewise renders reason |
| 11 | Payment amount wrong | **PARTIALLY VERIFIED** | Settlement arithmetic is cent-exact, but upstream zero PR price and raw-cent warehouse entry can create wrong AP; duplicate treasury conversion has a 100× defect |
| 12 | Warehouse inventory check routes to admin approval | **VERIFIED** | Reviewer lacks `INVENTORY_CHECK_APPROVE`; admin has it |
| 13 | Accounting voucher missing launcher | **NOT REPRODUCED at expected HEAD** | `accounting` nav/page/API exist and accounting role has `ACCOUNTING_VIEW`; stale session/older build is plausible. Accounting role still lacks approver permission by design/current seed |

## O. Prioritized remediation backlog

### P0 — release blockers (14)

| ID | Remediation | Acceptance evidence |
|---|---|---|
| P0-01 | Isolate every test in a temporary database; forbid reset script from default DB in tests; add sentinel regression | Full suite preserves pre-existing DB byte-for-byte |
| P0-02 | Redesign role seeds: remove procurement/warehouse execution from sales; add warehouse production execution | Role matrix tests and real API authorization tests |
| P0-03 | Grant inventory-check approval to reviewer and enforce creator≠approver | Reviewer scenario passes; admin no longer required |
| P0-04 | Add SO/PO order and requested/promised dates plus contact/address snapshots and terms | Approval detail and MRP use contractual dates |
| P0-05 | Eliminate zero-price propagation and warehouse repricing; inherit approved source price | PR→PO→receipt amount invariant tests |
| P0-06 | Enforce approved source, party, line, cumulative quantity, and price on delivery/receipt/returns | Negative integration tests for every mismatch/overage |
| P0-07 | Connect IQC/OQC to source lines and stock/confirmation gates | Failed inspection blocks release/confirmation |
| P0-08 | Define source-level credit allocation for returns/discounts; one canonical open-balance truth | Required AR/AP scenarios end with both aggregate and source open = 0 |
| P0-09 | Add confirmed settlement reversal; confine physical lifecycle cleanup to emergency repair | Equal/opposite linked reversal with immutable original |
| P0-10 | Standardize API/UI monetary units; remove duplicate contradictory forms | Cross-page contract tests, integer cents only at API boundary |
| P0-11 | Gate production completion/FG receipt on issue/output reconciliation and tolerances | Under-issued/over-received/early-complete cases rejected |
| P0-12 | Prohibit unlinked direct logistics postings or formalize separately authorized adjustment documents | Every AR/AP/stock effect has an approved provenance |
| P0-13 | Require positive integer cents and exact voucher balance; split voucher create/view permissions | Property and API tests reject fractional/unbalanced entries |
| P0-14 | Deliver versioned MySQL 8 migrations and execute full concurrency/integration suite on MySQL | Clean install/upgrade/rollback evidence on target engine |

### P1 — required for controlled operational use (12)

| ID | Remediation |
|---|---|
| P1-01 | Supplier/customer payment terms and calculated due dates |
| P1-02 | Currency, exchange-rate, tax, freight, and landed-cost policy |
| P1-03 | Lot/batch/serial and quality disposition traceability |
| P1-04 | Partial delivery/receipt/return statuses and remaining-quantity display |
| P1-05 | Idempotency keys and universal posting-source unique constraints |
| P1-06 | Allocation-vs-paid invariant monitor and controlled repair |
| P1-07 | Dedicated non-admin accounting approver/controller role |
| P1-08 | Separate create/confirm permissions for transfer/adjustment/scrap and settlement |
| P1-09 | Closed-period reversal policy and period-aware automated postings |
| P1-10 | Lifecycle coverage for quality and extended-domain documents |
| P1-11 | Immutable source snapshots and change/version policy after approval |
| P1-12 | End-to-end browser/API tests for sales, purchase, production, inventory, and accounting chains |

### P2 — usability, observability, and maintainability (8)

| ID | Remediation |
|---|---|
| P2-01 | Fix discount list “source” columns currently showing reason |
| P2-02 | Consolidate duplicate accounting/treasury forms and shared money/date components |
| P2-03 | Split `server/app.js` and large pages by business domain |
| P2-04 | Surface source status, remaining quantity/value, quality state, and due date in selectors |
| P2-05 | Add reconciliation dashboards and invariant alerts |
| P2-06 | Add stable pagination/filter/export behavior for audit and lifecycle logs |
| P2-07 | Resolve Vite chunk warning with route-level code splitting |
| P2-08 | Document emergency data-repair runbook, backup proof, and dual-control approvals |

## P. Test-gap map and release recommendation

### Existing coverage that is meaningful

- Status-transition and self-approval checks for canonical approvals.
- Atomic rollback/stock-shortage paths for several inventory postings.
- Settlement cap and party-net safety checks.
- Inventory-count stale-quantity approval check.
- Production quantity and workflow status checks.
- Navigation/permission visibility and production-environment reset guard.

### False-confidence and missing coverage

| Gap | Why current green suite is insufficient |
|---|---|
| Test DB isolation | A test comment says no file is created, but it deletes the default DB; no sentinel asserts preservation |
| Role correctness | Tests freeze the current five-role contract, including excessive sales logistics rights and missing warehouse production rights |
| Source integrity | No full negative matrix for unapproved source, wrong party/product, overquantity, changed price, or duplicate posting |
| Quality gates | IQC/OQC field/status tests do not prove warehouse blocking or disposition effects |
| Settlement truth | Tests explicitly accept post-settlement negative credits; they do not prove source-level zero for required scenarios |
| Money semantics | No cross-page UI→API→DB→display round trip for the same amount |
| Dates/terms | No tests because core fields do not exist |
| Production closure | No end-to-end reconciliation of BOM issue, yield/scrap, FG receipt, and completion |
| Target DB | All tests run on SQLite, not deployment-target MySQL 8 |
| Browser workflow | Many tests inspect source text, render/nav metadata, or isolated handlers rather than a multi-role transaction chain |

### Required release gate

Production release is **BLOCKED**. A release candidate can be called process-safe only after all P0 items pass on a clean MySQL 8 environment, the two required zero-balance scenarios reconcile at both source and aggregate levels, warehouse/reviewer/accounting SOD tests pass with non-admin users, quality failures block their physical process, and the full test suite demonstrably preserves any pre-existing database.

Until then, use is limited to a disposable, isolated demo/UAT environment with synthetic data and explicit notice that logistics provenance, QC gates, settlement detail, and role separation are incomplete.

---

### Final audit stats

- `HEAD MATCH = YES`
- `AUDIT REPORT = docs/archive/v1.2/audits/ERP-PROCESS-INTEGRITY-AUDIT-v1.2.md`
- `PRODUCT CODE MODIFIED = NO`
- `SCHEMA MODIFIED = NO`
- `PERMISSIONS MODIFIED = NO`
- `EXTERNAL PRODUCTION MODIFIED = NO EVIDENCE / NOT CONTACTED`
- `LOCAL WORKSPACE DATA MODIFIED = YES — default SQLite DB/WAL/SHM deleted by repository test`
- `BUILD = PASS (large-chunk warning)`
- `TEST = PASS (1,291/1,291)`
- `P0 = 14`
- `P1 = 12`
- `P2 = 8`
- `RELEASE = BLOCKED`
