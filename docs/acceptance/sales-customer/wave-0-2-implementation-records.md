# Sales & Customer — Wave 0/1/2 Implementation Records

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）
## 31. Sales & Customer Domain Implementation — Wave 0

> Post-freeze implementation record for the externally frozen §29 Design and §30 Wave Plan. This section records repository implementation facts only; it does not modify §29 or §30 semantics.

### 31.1 Scope and zero-DDL boundary

Wave 0 implements only the shared Sales & Customer migration infrastructure:

```text
SC implemented             = 0
NEW Sales business tables  = 0
NEW Sales business fields  = 0
business API               = 0
frontend                   = 0
```

`server/migrations/sales-customer-domain.js` owns the single canonical entrypoint `migrateSalesCustomerDomain(db)` and the bounded test helper `runSalesCustomerMigrations(db, steps)`. The production registry is frozen and empty in Wave 0; no dummy schema or persistent migration journal exists.

### 31.2 Registry and execution contract

Each future registry step has:

```text
id       globally unique non-empty step identity
wave     integer Wave 0..13 ordering key
migrate  migrate(db) implementation
```

Before executing any step, the runner validates the complete registry, rejects duplicate IDs / invalid waves / missing migration functions, and orders steps by `wave ASC, id ASC`. Each step receives the exact caller database object. The runner adds no implicit transaction around the registry because SQLite and MySQL DDL transaction behavior differs.

The runner does not catch migration errors. A known idempotent condition must be handled precisely inside the owning future migration; every unexpected SQL, constraint, or adapter error propagates and fails database initialization closed.

### 31.3 SQLite execution path

```text
createSqliteDatabase(filename)
  → existing canonical schema and frozen domain migrations
  → Finance open-item derived view reconciliation
  → migrateSalesCustomerDomain(sqliteDb)
  → return sqliteDb
```

The Sales entrypoint is additive and placed after its prerequisite frozen domain schema. Existing migrations are not reordered. Fresh SQLite and existing SQLite reopen use the same zero-step Wave 0 registry.

### 31.4 Fresh MySQL bootstrap path

```text
capture migrated SQLite snapshot
  → bootstrapMySql(liveAdapter, snapshot)
  → existing live MySQL reconciliation
  → migrateSalesCustomerDomain(liveAdapter)
  → return liveAdapter
```

The temporary SQLite snapshot passes through the Sales runner before capture. The live MySQL adapter intentionally replays the same registry after bootstrap. Therefore every future Sales migration must be idempotent: on fresh MySQL the live replay is a no-op/reconciliation over snapshot-created schema.

### 31.5 Existing MySQL live-upgrade path

For an already-existing MySQL database, `bootstrapMySql` retains its current lifecycle and `createDatabase` invokes `migrateSalesCustomerDomain` on the returned live `MySqlSyncAdapter`. Future additive Sales migrations therefore reach existing MySQL directly instead of relying only on the fresh SQLite snapshot. The Sales runner owns neither connection creation nor connection lifecycle; if live replay fails, `createDatabase` closes the adapter and propagates the error.

### 31.6 Tests and MySQL gate

- `server/sales-customer-wave0-migration-runner.test.js`: zero-step production registry, deterministic ordering, same-adapter passthrough, exactly-once-per-invocation, validation-before-execution, duplicate rejection, error propagation, fresh/reopened SQLite zero-business-schema, and structural production wiring.
- `server/mysql-sales-customer-wave0.integration.js`: protected disposable MySQL smoke; asserts `MySqlSyncAdapter`, runs a harmless injected `SELECT 1`, verifies continued connection usability, and proves none of the 38 frozen future Sales tables exists.
- `scripts/gates/mysql-gate.mjs`: includes the Wave 0 smoke without changing the existing reset guard, target validation, or cleanup architecture.
- `scripts/testing/test-suites.js`: classifies the focused `*.test.js` in FULL; it is not FAST because it creates/reopens a temporary SQLite database.

No Sales permission, role mapping, route, UI, business table, extension field, or `sales_deliveries.billing_mode` convergence is introduced by Wave 0.

---

## 32. Sales & Customer Domain Implementation — Wave 1 Commercial Foundation

> Post-freeze implementation record for the approved `§29` Design and `§30` Wave Plan. This section records the implemented Wave 1 repository facts without changing the frozen plan or authorizing Wave 2+.

### 32.1 Bounded schema and migration

The Wave 0 registry now has one production step, `wave-1-commercial-foundation`, owned by `server/migrations/sales-customer-wave1-foundation.js`. It creates exactly these eight Sales-owned tables:

1. `sales_parameters`
2. `sales_groups`
3. `salesperson_profiles`
4. `salesperson_group_memberships`
5. `customer_commercial_extensions`
6. `customer_material_xref`
7. `sales_sellable_scope_rules`
8. `product_commercial_classification`

Wave 1 adds zero fields to an existing table, zero Master/Platform schema fields, zero forward foreign keys, and no Wave 2+ business table. SQLite executes idempotent index DDL in the migration. MySQL fresh bootstrap and existing-database reconciliation derive the same indexes from the canonical SQLite snapshot; the live migration replay skips SQLite-only `CREATE INDEX IF NOT EXISTS` syntax.

### 32.2 Service ownership and business invariants

- `sales-parameters.js`: bounded SYSTEM / DOCUMENT_TYPE parameters; one full-row winner with DOCUMENT_TYPE precedence; missing effective configuration fails closed.
- `sales-foundation.js`: sales group, salesperson and effective membership maintenance. A salesperson may exist without a login. Transactional lock/recheck preserves at most one effective default membership. The default invariant is **`EXACTLY_ONE DEFAULT`** for every business date that has one or more active memberships — not `AT_MOST_ONE`. Violating memberships roll back the entire save.
- `sales-commercial-foundation.js`: versioned customer commercial extensions, controlled supersession, customer-material mappings, product commercial classification and sellable-scope rules.
- Customer commercial intervals reject overlap; supersession closes the prior version and creates the successor atomically.
- Customer-material resolution never guesses among multiple product candidates.
- Product sales/pricing UoM values must resolve through canonical UoM/conversion truth. The effective-date contract is `effective_from <= authoritative_date <= effective_to` where NULL `effective_to` means "open-ended / still in force"; future-only, expired, inactive, wrong-product and missing-base conversions are all rejected. The check lives in `assertUomCompatibility` (and is reused for `customer_material_xref.commercial_uom_code`); it never copies or rewrites the Master `uoms` / `product_uom_conversions` tables.
- Sellable rules validate their frozen dimension shape, reject overlapping same-effect rules and resolve explicit `DENY` before `ALLOW`.
- Successful mutations and their audit records share one transaction; rejected mutations leave no business or audit side effect.

### 32.3 API, authorization and UI surface

`server/app.js` exposes thin owned routes for parameter, group, salesperson, membership, customer-commercial-extension, customer-material-xref, sellable-rule and product-classification list/mutation operations. The frozen `PATCH /api/customer-commercial-extensions/:id` contract is retained.

Four backend permissions are canonical: `SALES_FOUNDATION_VIEW`, `SALES_PARAMETERS_MANAGE`, `SALES_FOUNDATION_MANAGE`, and `SALES_COMMERCIAL_MANAGE`. Admin receives all four. The Sales role receives view/foundation/commercial maintenance but not global Sales parameter administration. Every handler checks backend permission; frontend visibility is not authorization.

#### Read authorization (commercial data is sales-scoped)

The view list for customer commercial extensions, customer-material xref, sellable-scope rules and product commercial classification is:

```text
SALES_FOUNDATION_VIEW | SALES_FOUNDATION_MANAGE | SALES_COMMERCIAL_MANAGE | USERS_MANAGE
```

A customer-clerk holding only `CUSTOMERS_VIEW` / `CUSTOMERS_MANAGE` MUST NOT see commercial data. A reviewer (which carries `CUSTOMERS_VIEW`) MUST NOT see commercial data. An accounting role MUST NOT see commercial data. The Customer Detail panel renders an explicit "没有查看商业资料的权限" placeholder when the user lacks the canonical view permission; the launcher button is also hidden for actors outside that scope.

#### Salesperson SoD (self-assignment and self-default)

- A SALES actor (which carries `SALES_FOUNDATION_MANAGE`) MUST NOT bind a salesperson profile to its own login user, nor rebind an existing salesperson to its own login. The check returns `403 SALESPERSON_SELF_ASSIGNMENT_DENIED` and writes no audit row.
- A SALES actor MUST NOT create, change or replace the default membership of a salesperson profile that is bound to its own login user. The check returns `403 SALESPERSON_SELF_DEFAULT_DENIED` and rolls back the entire membership transaction.
- ADMIN (USERS_MANAGE) keeps the full maintenance capability required to provision the initial link between a salesperson profile and a Platform user.

The only Wave 1 frontend addition is a bounded commercial-information panel inside the existing Customer surface. It adds no launcher item or route. The panel presents effective customer commercial records and customer-material mappings, permits authorized creation, remains read-only without manage permission, and fits the 320 / 390 / 430 / 680 acceptance widths without horizontal page overflow.

### 32.4 Verification architecture

- `server/sales-customer-wave1-foundation.test.js`: exact schema boundary, parameter precedence/fail-closed behavior, permission separation, salesperson/login independence, default-membership invariant (`EXACTLY_ONE DEFAULT`), commercial interval/supersession, explicit xref resolution, classification/UoM, DENY precedence, transactional audit, **canonical UoM effective-date contract** (positive BASE / positive ALT / future-only reject / expired reject / inactive reject / wrong-product reject / missing Master base_uom reject), **salesperson SoD** (self-assignment forbidden, self-default forbidden, admin still able to maintain), and **read authorization** (reviewer / accounting 403 across all four commercial view paths, sales 200, denied mutation leaves no business or audit row).
- `server/sales-customer-wave0-migration-runner.test.js`: production registry, fresh/reopen idempotency, exact eight-table inventory and no Wave 2+ schema.
- `server/mysql-sales-customer-wave0.integration.js`: protected real-MySQL fresh/live replay and exact Wave 1 table boundary.
- `server/mysql-sales-customer-wave1-concurrency.integration.js`: real-MySQL **multi-session with control-session lock-wait observation** customer-interval, default-membership and sellable-rule races. Three independent child-process workers (alpha, beta, control) each hold their own `MySqlSyncAdapter` and therefore their own MySQL connection / session; each reports its distinct `CONNECTION_ID()` and processId for an explicit independence proof (`MULTI_SESSION_CONSISTENCY_VERIFIED` is always established). The control worker opens a real `START TRANSACTION` and acquires the canonical `mysql_transaction_gates` row lock (`SELECT … FOR UPDATE`); the two business workers' `transaction(db, work)` invocations are queued at the same row lock until the control worker commits via `release-gate`. The control transaction release is guaranteed by a `try/finally` in `runRace`. If the normal `release-gate` RPC fails (worker crash, IPC timeout), the cleanup path best-effort force-kills the control child process so the worker can never hold a gate row lock again. Worker RPCs have a bounded 15-second timeout. Lock-wait evidence is gathered with a tiered source priority implemented in `server/test-utils/sales-wave1-lock-observer.js` (single canonical implementation imported by both the integration test and the unit test):
    1. `performance_schema.data_lock_waits` — uses THREAD_IDs only. The integration test resolves `CONNECTION_ID()` → `THREAD_ID` via `performance_schema.threads` (the canonical mapping). When any threadId is null the observer skips Tier 1 entirely rather than fabricating a value.
    2. Tier 1 succeeds only when rows for BOTH alpha AND beta appear as waiters with the control as blocker → `LOCK_WAIT_OBSERVED`. A single-waiter row downgrades to `PARTIAL_LOCK_WAIT_OBSERVED` (never `LOCK_WAIT_OBSERVED`).
    3. Tier 2 — `information_schema.PROCESSLIST` uses CONNECTION_IDs only. `AS COMMAND` upper-case aliases match the JS reads (`row.COMMAND` etc.). A non-Sleep PROCESSLIST state yields `QUERY_ACTIVITY_OBSERVED`, never `LOCK_WAIT_OBSERVED`.
    4. When neither source is readable, the helper logs `MULTI_SESSION_CONSISTENCY_VERIFIED` only.
    5. PROCESSLIST polling is bounded — the observer does NOT conclude "no wait" after a single empty sample.
- The companion `server/concurrency-lock-observer.test.js` covers 11 cases via stubbed data: distinct CONNECTION_ID / THREAD_ID, identity-rule dispatch, lowercase-`id` alias not matched, idle (Sleep) not lock-wait, single-waiter downgrade, both-waiter positive, bounded polling recovers from first-empty sample, performance_schema unavailable downgrade, observation timeout does NOT fabricate LOCK_WAIT_OBSERVED, partial threadId downgrade, default poll budget constant.
- `server/mysql-sales-customer-wave1-upgrade.integration.js`: real-MySQL additive upgrade evidence with two phases against the existing protected test database. The test does NOT issue `CREATE DATABASE` / `DROP DATABASE`; it expects the gate to have already reset the protected DB. A SQLite-only preflight runs **before any MySQL connection** — it captures the canonical snapshot via `captureSqliteSnapshot(createDatabase, true)` (the **public** `createDatabase(filename)` factory + demo seed), filters out the eight Wave-1 tables, prints the actual row counts for every required representative and count-preserved table, asserts every required pre-Wave-1 table exists in the snapshot with seeded rows, asserts every Wave-1 table has been filtered out, and asserts every fixed legacy ID (`customer-001` … `customer-003`, `product-001` … `product-005`, `supplier-001` … `supplier-003`, `warehouse-001` / `warehouse-002`, `user-admin` / `user-sales` / `user-reviewer` / `user-warehouse` / `user-accounting`, `role-admin` / `role-sales` / `role-reviewer` / `role-warehouse` / `role-accounting`, `order-demo-001`, `item-demo-001` / `item-demo-002`) appears in the captured rows. Only after the preflight does the test open the first MySQL connection. The pre-check adapter asserts `SELECT DATABASE()` matches the expected target and that the protected DB is empty (`SHOW TABLES` returns zero rows). If any non-empty state is observed, the test stops with `STOP / NO DESTRUCTIVE ACTION` — it never wipes unknown data. The bootstrap adapter applies the filtered snapshot. Phase A invariants assert (i) the eight Wave-1 tables do not exist, (ii) representative pre-Wave-1 tables (`customers`, `products`, `suppliers`, `warehouses`, `sales_orders`, `sales_order_items`, `audit_logs`, `roles`, `permissions`, `role_permissions`, `users`, `inventory`) contain rows, (iii) additional pre-Wave-1 tables preserve their row counts (including legitimately zero — `sales_deliveries`, `purchase_receipts`, etc.), (iv) `mysql_backend_metadata` columns are exactly `[version, completed_at]`, (v) `mysql_transaction_gates.gate_id=1` exists, (vi) stable pre-Wave-1 rows are snapshotted (salesperson identity is intentionally NOT snapshotted here — it is a Wave-1 table and is verified only post-upgrade). **Phase B** invokes the production `createDatabase()` factory on a brand-new session, which runs `bootstrapMySql` with the full snapshot (additive reconciliation: only Wave-1 tables are added), then `migrateSalesCustomerDomain` (idempotent no-op). Post-upgrade invariants assert exact eight Wave-1 tables, no Wave-2+ tables, identical pre-Wave-1 row counts, byte-identical stable rows, FK target identity via `information_schema.KEY_COLUMN_USAGE`, intact UNIQUE / CHECK / transaction gate, and a final migration replay for idempotency.
- `scripts/acceptance/sales-customer-wave1-responsive.mjs`: Customer Detail commercial panel at 320 / 390 / 430 / 680.

### 32.5 Final MySQL Acceptance Evidence — 2026-10-14

> Real disposable-MySQL execution recorded against `master@d44ad42db5c67961027e9e21cbc951dd6d94f5ae`. This subsection records the actual executed gate counts only; it does NOT promote the user Acceptance/Freeze decision, and it does NOT extend the eight-table Wave 1 boundary. Prior §32.1–§32.4 implementation facts are unchanged.

#### 32.5.1 Execution target and gate totals

- MySQL target database: `modern_erp_domain_test` (disposable, gated by `ERP_DB_BACKEND=mysql` and the protected whitelist; no production / shared database was touched).
- Functional / migration gate: **PASS — 52 / 52**.
- Generic concurrency gate: **PASS — 13 / 13**.
- Procurement / Outsourcing concurrency gate: **PASS — 12 / 12**.
- Inventory / Warehouse concurrency gate: **PASS — 14 / 14**.
- Sales & Customer Wave 1 concurrency gate: **PASS — 4 / 4**.
- Sales & Customer Wave 1 existing-MySQL additive upgrade gate: **PASS — 18 / 18**.
- **Total: 113 / 113 PASS**; fail / skipped / cancelled / todo are all zero.

The gate-level breakdown (52 / 13 / 12 / 14 / 4 / 18 = 113) is the only execution result recorded for this session. No additional acceptance item is claimed and no unexecuted scenario is reported as PASS.

#### 32.5.2 Race-observation detail (Sales Wave 1 concurrency)

- `R-W1-01` (customer commercial interval overlap): the canonical `mysql_transaction_gates` row lock was observed holding both business transactions. Lock-wait telemetry **was** observed for this race: two transactions were actually seen waiting.
- `R-W1-02` (salesperson default membership) and `R-W1-03` (sellable-scope rule overlap): the domain business concurrency invariants passed (success count, failure-reason, exactly-one default, final row count, atomic audit). Full lock-wait telemetry was **not** observed for these two races — they are recorded as business-invariant PASS only.
- No `LOCK_WAIT_OBSERVED` claim is made for `R-W1-02` or `R-W1-03`. The single-tier and two-tier downgrade contracts from §32.4 are the authoritative lock-wait evidence rule; this subsection does not override them.

#### 32.5.3 Known non-blocking finding

- `mysql2` backend-option warning was emitted during the run. It is recorded as a non-blocking **P2** observation; it did not affect gate exit codes or test counts and is not counted as a fail / skipped / cancelled / todo.

#### 32.5.4 Discipline notes

- No DDL, no `CREATE DATABASE`, no `DROP DATABASE`, no schema/migration change was performed as part of recording this evidence; the disposable target database is owned by the gate.
- No Wave 1 business implementation, route, permission, schema, migration, frontend, test or README change occurred. The eight-table Wave 1 boundary remains exactly as recorded in §32.1.
- No user Acceptance/Freeze claim is made by this subsection; final Freeze remains an explicit user decision recorded separately.

Wave 1 does not implement quotation, pricing, credit, reservation, delivery scheduling/control or order-change execution. It does not claim user Acceptance/Freeze; those remain external decisions after review.

---

## 33. Sales & Customer Domain Implementation — Wave 2 Pricing and Order-Time Discount

> Post-design implementation record for the approved §29.6–§29.7 and §29.31.2–§29.31.3 contracts. This records repository facts only; it does not alter the frozen Requirement/Design or claim user Acceptance/Freeze.

### 33.1 Bounded schema and migration

The Sales registry runs `wave-2-pricing-discount` after Wave 1. `server/migrations/sales-customer-wave2-pricing.js` creates exactly `sales_price_lists`, `sales_price_list_entries`, `sales_price_list_versions`, `sales_discount_schemes`, and `sales_discount_scheme_rules`. It adds only the nullable real FKs `customer_commercial_extensions.default_pricing_list_id` and `default_discount_scheme_id`. No SO/SO-line or Master/Finance/Inventory/Platform schema changes are made.

Price-entry business uniqueness is the four-column database UNIQUE `(price_list_id, material_identity_key, customer_scope_key, pricing_identity_key)`. The independent entry UUID remains the PK and version rows reference it. Backend and the exactly named before-insert/before-update triggers derive and verify uppercase UTF-8 hexadecimal identity keys byte-for-byte, enforce component limits without truncation, case-folding or digest fallback, and reject identity-field updates. SQLite fresh/reopen and MySQL fresh/live replay share the registry; live MySQL replay adds/verifies the two named customer-default FKs and trigger metadata without changing the global adapter.

### 33.2 Canonical services and API ownership

`server/modules/sales-pricing.js` owns all §29.31.2/§29.31.3 routes. DRAFT writes lock/re-read the owner, validate references/ranges/UoM truth, and write audit in the same transaction. Price and discount rule versions append only. Activation validates completeness, fallback chains and canonical UoM evidence before freezing; retirement is `ACTIVE → RETIRED`. Both transitions reuse Platform idempotency: exact replay has zero additional state/audit effect and changed payload under the same key is rejected.

The price resolver applies explicit roots, the effective customer default, depth-first fallback, customer-before-all scope, integer quantity micros, Master rational conversions and the greatest immutable price version. It never reads `products.price_cents`. The discount resolver re-runs canonical pricing for every line; client expected evidence is an exact-match assertion only. LINE rules can filter material/customer/UoM/quantity/date. HEADER rules are database- and backend-constrained to order scope and use the post-LINE subtotal. Greatest effective rule version wins; disabled or expired current history cannot resurrect an older version. Integer cents/bps, HALF_UP and largest-remainder allocation remain authoritative.

Both resolver POSTs require view authority and write no business/audit/idempotency state. Manual price or MANUAL discount additionally requires override authority and a reason. No override log, sixth table or M14 write exists.

### 33.3 Authorization, UI and verification

The independent permissions are `SALES_PRICING_VIEW`, `SALES_PRICING_MANAGE`, and `SALES_PRICING_OVERRIDE`: Admin all; Sales view/manage; Reviewer view/override; Warehouse none; Accounting view. Every endpoint checks its exact authority.

`sales-pricing` is a contextual child route of the existing Sales & Customer customer surface and is absent from launcher groups. `src/pages/sales-pricing.jsx` supplies the bounded responsive list/configuration entry surface without a new top-level application.

### 33.4 Implementation self-review closure

The final implementation review preserves immutable pricing history: a DRAFT entry with any version, and a DRAFT list containing entries, cannot be hard-deleted. Identity replacement therefore creates a new entry while retaining prior version evidence. Resolver HTTP handlers execute their complete canonical read path in one read transaction and remain zero-write. Activation validates the complete fallback interval, acquires MySQL fallback locks in deterministic ascending ID order, and uses the full action plus request body as its idempotency fingerprint. Customer defaults must be ACTIVE and applicable on the commercial-extension effective date.

The MySQL contracts assert exact nullable column metadata, exact FK names/columns/targets, exact ordered four-column UNIQUE metadata, and exact BEFORE INSERT/UPDATE identity-trigger metadata and bytewise action signatures for fresh and existing-upgrade paths. Responsive acceptance exercises 320 / 390 / 430 / 680 CSS px, verifies no page overflow, and verifies a 44 px minimum interactive target. These are implementation/verification facts only; user Acceptance/Freeze remains external.

Verification ownership: `server/sales-customer-wave2-pricing.test.js` covers SQLite schema/FK/UNIQUE/triggers, five-role RBAC, identity immutability, versions, replay, pure resolvers, HEADER constraints, LINE→HEADER arithmetic and evidence mismatch; the migration-runner test covers fresh/reopen; the protected MySQL fresh and existing-upgrade suites cover fresh/live replay/second initialization. Wave 2 returns evidence only; SO persistence and final R-SAL-11 remain Wave 4.

### 33.5 Remote review remediation R1

The Wave 2 implementation closes three review defects without changing the frozen schema or API surface:

- Price-entry creation and price-list activation reuse the Sales-owned `assertSalesClassifiedProduct` primitive. Price and discount resolution reuse the full `assertSellableProduct` path, including effective sellable-scope rules. Missing, inactive or sales-disabled classification and an applicable scope denial therefore fail before any pricing evidence is returned; failed mutations roll back business, audit and idempotency state.
- MySQL resolver reads remain at the existing session isolation level. `readTransaction` acquires `LOCK IN SHARE MODE` on the existing `mysql_transaction_gates.gate_id=1` row before canonical reads. Every canonical writer already acquires `FOR UPDATE` on that same row, so multiple readers may coexist while activation, retirement, version and customer-default mutations wait until the complete resolver snapshot commits. SQLite keeps its existing `BEGIN` snapshot path, and the resolver performs no persistent write.
- Fallback cycle detection is scoped to the current root path. A shared descendant reached from `A → C` and `B → C`, or a customer default already reachable from an explicit root, is valid and follows the frozen root precedence. Re-entering a node on one path remains `FALLBACK_CYCLE`; duplicate explicit roots remain `DUPLICATE_ROOT`.

`server/mysql-sales-customer-wave2-concurrency.integration.js` and its independent-session worker are registered in the protected MySQL concurrency gate. The bounded suite verifies resolver/retirement and resolver/customer-default exclusion with observed gate waits, version/activation serialization, competing activation/retirement, coherent before/after evidence, shared fallback semantics, and atomic audit/business outcomes. It may run only against the already protected disposable MySQL environment.

### 33.6 Real MySQL migration runtime remediation R2

The Wave 2 live registry is dialect-dispatched without changing the frozen five-table schema. SQLite remains the canonical DDL source and continues to execute the existing `CREATE TABLE IF NOT EXISTS` block, nullable customer-default additions, identity triggers and indexes. MySQL continues to obtain physical tables and missing columns only from `captureSqliteSnapshot` plus `bootstrapMySql` additive reconciliation; the later `migrateSalesCustomerDomain` registry pass no longer submits SQLite table DDL to MySQL.

On MySQL, `migrateSalesCustomerWave2Pricing` now fails closed unless all five Wave 2 tables already exist and their primary keys, complete foreign-key targets, unique-key column order and CHECK-constraint counts match the canonical snapshot. The two customer-default columns must already have been supplied by bootstrap/additive reconciliation and must remain nullable; the registry never issues `ADD COLUMN ... TEXT REFERENCES` on MySQL. A missing FK is added with its canonical name. The one expected fresh-bootstrap shape—one target-equivalent FK with a MySQL-generated name—is reconciled by dropping only that identified constraint and adding the canonical named constraint. Duplicate, wrong-target, wrong-column or otherwise unexpected FK metadata is rejected.

The existing `trg_sales_price_entries_identity_bi` and `trg_sales_price_entries_identity_bu` creation statements remain the only MySQL identity-trigger implementation. The registry creates a missing trigger through the existing worker, then validates timing, event, owner table and bytewise identity fragments through `information_schema.TRIGGERS`; replay validates existing triggers without recreating them. No global MySQL adapter, isolation, business route, table inventory, historical row or Wave 3+ contract changes are part of this remediation.

`server/sales-customer-wave2-mysql-migration.test.js` supplies executable adapter-level dispatch coverage: MySQL receives no raw Wave 2 `CREATE TABLE` or SQLite-style `ADD COLUMN`, expected bootstrap-generated FK names reconcile once, replay is idempotent, and missing table/column or unexpected FK/PK metadata fails closed. The protected real-MySQL fresh suite remains `server/mysql-sales-customer-wave0.integration.js`; the existing-schema additive/replay suite remains `server/mysql-sales-customer-wave1-upgrade.integration.js`; Wave 2 multi-session behavior remains in `server/mysql-sales-customer-wave2-concurrency.integration.js`.

---
