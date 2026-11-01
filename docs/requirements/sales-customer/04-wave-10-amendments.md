# Sales & Customer — Wave 10 Requirement Amendments

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/requirements/sales-customer/README.md`
> 来源：`document.md` Wave 10 修订节（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## Wave 10 Precondition Requirement Reconciliation (2026-10-24)

### 1. Authorization, scope and frozen protection

**Authorization.** The user authorized one bounded Requirement stage: reconcile the Wave 10 entry
conditions against the current repository fact, reconcile the Stage C carry-forward register #1–#15
against real implementation and test evidence, and correct a bounded set of document-state
contradictions. Under the amended `AGENTS.md §4.0` the same authorization extends to the
immediately following Design stage, which must HARD STOP before Implementation.

**Scope.** This record is Requirement-only. It introduces no business rule, no permission contract,
no schema, no state transition, no ownership boundary, no lock order, no isolation level and no
acceptance conclusion. It changes no production source, no test, no migration and no
`package.json`.

**Explicitly not modified.** The Gate A Final Acceptance and Freeze Record (2026-10-24); the Wave 9
Final Acceptance and Freeze Record (2026-10-23); the Stage B Requirement Applicability Closure
(2026-10-22) and its §13–§15 amendments; every earlier Stage A/B/C record; `solution.md`;
`README.md`; the frozen Gate A runner, its suite manifest, its suite order, its strict TAP /
fail-fast / per-suite-cleanup rules, the target-identity guard, the named-lock release contract and
the Gate A M1–M25 board.

**Read-only basis.** Every statement below was read from the local working tree and the local Git
state at `feature/sales-waves6-13@2037cb632e2464477fe9752dc3113dac3c0eacf3`, package `1.6.2`. No
database was connected, no test, build, migration, reset or destructive operation was executed, and
no Git write operation was performed.

### 2. Canonical dependency direction

The authoritative dependency direction is fixed and is not re-decided by this record:

```text
Gate A Final Acceptance + Freeze
  → Wave 10 Implementation
  → Gate B Acceptance
  → Gate B Freeze
  → Wave 11
```

- **Gate A is accepted and frozen.** See "Gate A Final Acceptance and Freeze Record (2026-10-24)"
  §1–§3 and `solution.md §37.33`. The accepted evidence is the single authorized real-MySQL
  execution of `pnpm test:mysql` against
  `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`
  (server UUID `5d3c6a68-b8a5-11f1-8ce6-b025aa71d167`, MySQL 8.0.37): A-PARITY 4/4, A-PROD 6/6,
  A-RAW 4/4, A-TXLIFE 8/8, TAP fail/skipped/cancelled/todo 0/0/0/0.
- **Gate B is a downstream obligation of Wave 10, never a prerequisite for it.** This is already the
  canonical position and is confirmed, not changed, here: `solution.md §37.18` ("Gate A does not
  depend on Gate B; Gate B is a downstream obligation of Wave 10 itself and is never a prerequisite
  for Gate A"), `solution.md §37.26` ("Gate B is not a prerequisite for Gate A, and Gate A does not
  discharge Gate B"), and the Gate A Freeze Record §4 ("Gate A is not a prerequisite for Gate B, and
  this freeze does not discharge, weaken or defer Gate B").
- **Gate B must be executed against real Wave 10 production code.** `solution.md §37.18.2` requires
  every Gate B case to be reported `BLOCKED_BY_WAVE10` until Wave 10 is separately authorized and
  implemented, and never as PASS, never as skipped-and-green, never as "verified by inspection".
- **No Gate B-0 exists and none is created.** No preparatory gate may be introduced to bypass this
  order.

### 3. `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` — status reconciliation

The label was defined as a *condition*, not as a permanent state. `solution.md §37.18.1` states:
"Gate A passing, plus **explicit user Final Acceptance**, is what satisfies
`WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS`." `solution.md §37.26` restates it: the label "is
unchanged and is satisfied only by Gate A plus explicit user Final Acceptance."

| Fact | Evidence |
|---|---|
| Gate A campaign PASS | `log/2026-10-24.md` — "authorized Gate A MySQL campaign execution (single run)" |
| Explicit user Final Acceptance granted | `log/2026-10-24.md` — "Gate A — Final Acceptance and Freeze Record (2026-10-24)"; `document.md` Gate A Freeze Record §1 |
| Both limbs of the defining condition are satisfied | 2026-10-24 |

**Current status: the condition named by `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` is
satisfied as of 2026-10-24.** The label remains a valid historical identifier of the Wave 10 entry
gate and is retained as such; it is **not** an active block, and it must no longer be restated as an
unmet current condition.

Historical statements that recorded this label as "active and unchanged" were accurate on their own
record dates and are **preserved as history, not rewritten**: `document.md` §14.9 and §15.11
(2026-10-22); `document.md` "Wave 9 Final Acceptance and Freeze Record" §4 (2026-10-23);
`solution.md` §36.16.4 (2026-10-22); and the `solution.md` §37 stage boundary paragraphs of
2026-10-23 / 2026-10-24. Each of them is superseded **for current status only** by this record and
by the Gate A Freeze Record.

What genuinely remains open is **not** this label. It is:

1. **Gate B acceptance** — a downstream obligation dischargeable only after Wave 10 is implemented
   and the fixtures are executed against it (`solution.md §37.18.2`).
2. **The remaining W7-C1 / W7-C2′ follow-up work** and the residual open items R1–R4 in
   `solution.md §37.31.15` — explicitly not declared complete by the Gate A Freeze Record §4 or by
   `solution.md §37.33.3`.
3. **Wave 10 implementation itself** — not started, not accepted, not authorized.

### 4. Stage C carry-forward register #1–#15 — closure evidence matrix

The register is `document.md` §10 "Stage C Design carry-forward register" (Stage B Requirement
Applicability Closure, 2026-10-22). It was opened at Stage B — before Stage C Design and before any
Wave 9 implementation — and states of itself: "**None is resolved by this Stage B record**." That
statement is correct for 2026-10-22 and is preserved. What was missing is the *current* status,
which is recorded below.

Each item was checked against the current repository, not against the existence of a freeze record.
A freeze record is not evidence that an item is closed, and SQLite-only evidence is not evidence of
real MySQL concurrency.

| # | Carried-forward Design issue | Current status | Wave 10 blocking |
|---|---|---|---|
| 1 | `credit_profile` physical primary key and candidate keys | Closed | Not blocking |
| 2 | Nullable salesperson normalized-scope uniqueness and bidirectional consistency | Closed | Not blocking |
| 3 | Effective-date interval overlap and deterministic active Profile resolution | Closed | Not blocking |
| 4 | `credit_check_rules.id` PK / UNIQUE definition | Closed | Not blocking |
| 5 | `credit_parameters` column UNIQUE versus composite PK conflict | Closed | Not blocking |
| 6 | `credit_profile_ratings` Wave 9 → Wave 11 deferred FK | Closed at Wave 9 | Not blocking; Wave 11 realization deferred |
| 7 | SQLite foreign-key creation versus pre-target DML behavior | Closed by design construction | Not blocking |
| 8 | MySQL FK ordering and idempotent metadata convergence | Partially closed | Not blocking; Wave 10 obligation |
| 9 | Stable Credit Anchor provisioning transaction boundary | Closed | Not blocking |
| 10 | Credit Policy Snapshot fingerprint identity and uniqueness | Closed | Not blocking; Wave 10 runtime writer |
| 11 | Canonical names: `credit_lock_anchors` and `credit_check_results` | Partially closed | Not blocking; Wave 10 deliverable |
| 12 | Credit Profile rating canonical write owner | Closed for the Wave 9 path | Not blocking; Wave 11 `EVALUATED` path deferred |
| 13 | R-SAL-12 / R-SAL-24 infrastructure versus full business-race timing | Open by design | Future acceptance obligation |
| 14 | Read-only legacy inventory and conditional bootstrap | Open — `LEGACY_DATA_EVIDENCE_PENDING` | Not blocking; unresolved evidence |
| 15 | SQLite / MySQL PK, UNIQUE, CHECK, FK and indexed-column type parity | Partially closed — evidence incomplete | Not blocking; cross-database evidence obligation |

#### #1 — `credit_profile` physical primary key and candidate keys

- **Original Requirement:** `document.md` §34.3 SC87–SC89 (Credit Profile identity and effective-dated
  versioning); register §10 #1.
- **Existing Design:** `solution.md §36.2.2` (`credit_profile`, A-51, supersedes §29.22 PK) and
  `§36.5.5` (contract assertion requirement).
- **Implementation evidence:** `server/migrations/sales-customer-wave9-credit-foundation.js:79`
  (`id TEXT PRIMARY KEY NOT NULL`, SQLite) and `:176` (`id VARCHAR(128) NOT NULL PRIMARY KEY`,
  MySQL); candidate key `uq_credit_profile_scope_version` UNIQUE(`anchor_id`,`effective_from`) at
  `:22`; lookup index `ix_credit_profile_customer_scope` at `:23`.
- **Test evidence:** `server/sales-customer-wave9-credit-foundation.test.js` (SQLite focused, in FAST
  and FULL; covered by the accepted Wave 9 `test:fast` 380/380 and `test` 2647/2647) and
  `server/mysql-sales-customer-wave9-credit.integration.js` (real MySQL, accepted 17/17). The
  migration's own `assertSqlite` (`:226`) and `assertMySql` (`:247`) assert column identity/order and
  PK per table and fail closed on drift; both ran in the accepted MySQL execution.
- **Current status:** **Closed.** The key contract is settled by Design, implemented in Wave 9, and
  asserted on both engines.
- **Wave 10 blocking:** **Not blocking.** Wave 10 may not alter this contract.
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract.

#### #2 — Nullable salesperson normalized-scope uniqueness and bidirectional consistency

- **Original Requirement:** `document.md` §34.3 SC87 (optional salesperson dimension; §3 B-1) and the
  register §10 #2.
- **Existing Design:** `solution.md §36.2.2` — `salesperson_scope_key` NOT NULL normalized (`*` for
  aggregate) with a bidirectional consistency CHECK; `§36.3.1` applicable control scope resolution.
- **Implementation evidence:** migration `:82` `salesperson_scope_key TEXT NOT NULL`; the bidirectional
  CHECK at `:92`; `ix_credit_profile_customer_scope` at `:23`; scope derivation in
  `server/modules/credit-profile.js:31`.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC87 aggregate and
  sub-limit identities normalize to distinct scopes on MySQL" (accepted 17/17), whose own comment
  records that "Scope normalization is enforced as a physical MySQL CHECK, not only in code"; plus the
  SQLite focused suite.
- **Current status:** **Closed.**
- **Wave 10 blocking:** **Not blocking.** Wave 10 must consume the same normalized scope key rather
  than derive a second scope representation.
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract and a Wave 10 read constraint.

#### #3 — Effective-date interval overlap and deterministic active Profile resolution

- **Original Requirement:** `document.md` §34.3 SC88 (effective dating); register §10 #3, whose
  cross-scope case was gated by `REQUIREMENT_DECISION_PENDING-1`.
- **Existing Design:** `solution.md §36.2.2`; `§36.3.4` step 5; `§36.6.3` step 6 ("resolve effective
  `credit_profile` at `business_date` (exactly one row, else fail closed)"). The cross-scope ordering
  was resolved by the approved Dual-Limit decision at `document.md` §13 / §9.1 (2026-10-22).
- **Implementation evidence:** `server/modules/credit-profile.js:124`
  `closePredecessorAndAssertNoOverlap` — `:127` same-scope-same-`effective_from` → HTTP 409
  `CREDIT_PROFILE_VERSION_EXISTS`; `:129-130` predecessor closure; `:133` overlap rejection; `:44`
  `resolveEffectiveCreditProfile` with `effective_from<=? AND (effective_to IS NULL OR
  effective_to>=?) ORDER BY effective_from DESC, id`; `:66` the same deterministic predicate in the
  list resolver.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC88 effective-dated
  resolution, predecessor closure, overlap rejection and overdue policy persist on MySQL" (accepted
  17/17); SQLite focused suite.
- **Current status:** **Closed.**
- **Wave 10 blocking:** **Not blocking.** Wave 10 must call this exact resolver and must fail closed
  when the effective row is not unique; it may not re-derive an effective row by its own rule.
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract and a Wave 10 consumption
  constraint.

#### #4 — `credit_check_rules.id` PK / UNIQUE definition

- **Original Requirement:** `document.md` §34.3 SC83–SC86; register §10 #4.
- **Existing Design:** `solution.md §36.2.4` (A-49, supersedes §29.21 missing key).
- **Implementation evidence:** migration `:62` / `:164` primary key; `uq_credit_check_rules_version`
  UNIQUE(`rule_code`,`effective_from`) at `:20`; `ix_credit_check_rules_stage_date` at `:21`.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC83-SC86 control
  scope, timing and both rule strengths round-trip on MySQL" (accepted 17/17); SQLite focused suite;
  metadata PK assertion executed on real MySQL.
- **Current status:** **Closed.**
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract.

#### #5 — `credit_parameters` column UNIQUE versus composite PK conflict

- **Original Requirement:** `document.md` §34.3 SC83–SC84 (configurable Credit Parameters);
  register §10 #5.
- **Existing Design:** `solution.md §36.2.3` (A-48, supersedes §29.21 UNIQUE/PK conflict).
- **Implementation evidence:** migration `:47` / `:156` primary key; `uq_credit_parameters_version`
  UNIQUE(`code`,`effective_from`) at `:18`.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — the three AP5 cases
  (human READ, human WRITE, and "ordinary Sales cannot disable Credit Management or weaken BLOCK to
  WARNING") at accepted 17/17; SQLite focused suite.
- **Current status:** **Closed.** The column-level uniqueness that would have defeated effective
  versioning is not present.
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract.

#### #6 — `credit_profile_ratings` Wave 9 → Wave 11 deferred FK

- **Original Requirement:** `document.md` §34.3 SC89 (initial-rating provenance); register §10 #6.
- **Existing Design:** `solution.md §36.5.2` (the one deferred FK — "no `REFERENCES` clause, either
  engine" in Wave 9); `§36.2.6`; `§36.5.3` (Wave 11 ordering); `§36.5.5` I-6 (forward-FK convergence).
- **Implementation evidence:** migration `:120` `evaluation_result_id TEXT` with **no** `REFERENCES`
  clause in the SQLite DDL and **no** FK to `credit_evaluation_result` in the MySQL DDL block
  (`:203`ff); the provenance CHECK at `:124` enforces `INITIAL_ASSIGNED ⟺ evaluation_result_id IS
  NULL`.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC89 initial rating
  provenance is recorded and rating evidence is append-only on MySQL" (accepted 17/17); the
  `assertMySql` nullability assertion confirms
  `credit_profile_ratings.evaluation_result_id IS_NULLABLE='YES'`, executed on real MySQL.
- **Current status:** **Closed at Wave 9.** The deferred-FK design is implemented exactly as designed.
  The **Wave 11 realization** of the constraint (`fk_credit_profile_ratings_evaluation_result`) is
  future work and is not yet due; `§36.5.2` states that Wave 10 adds no FK on this column.
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close at Wave 9**; carry the Wave 11 realization forward as a Wave 11
  migration obligation.

#### #7 — SQLite foreign-key creation versus pre-target DML behavior

- **Original Requirement:** `document.md` §10 item #7 (cross-dialect fact that Stage C must establish
  and Stage D must prove by test).
- **Existing Design:** `solution.md §36.5.2` — the design deliberately takes the option that depends
  on **no** DDL-tolerance assumption, so that the question has no runtime expression: "MySQL never
  sees a FK to a nonexistent parent, because no `REFERENCES` clause is emitted in Wave 9; SQLite never
  sees an unresolvable reference at DDL time, for the same reason."
- **Implementation evidence:** confirmed for both engines — no `REFERENCES` clause on
  `evaluation_result_id` in the SQLite DDL (`:120`) or the MySQL DDL (`:203`ff); the migration's
  `assertMySql` requires the FK set to equal the declared set exactly (`fks.length !== contract.fks.length`
  → drift), so an added forward FK would fail closed.
- **Test evidence:** the claim is structural and is asserted on real MySQL by the accepted 17/17
  execution of `server/mysql-sales-customer-wave9-credit.integration.js` (which runs the migration
  through the MySQL path); SQLite focused suite.
- **Current status:** **Closed by design construction.** The pre-target DML question was eliminated
  rather than answered by assumption. The separate upgrade-path equivalence obligation is tracked
  under #15.
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close** on the design-construction ground; retain the upgrade-path
  equivalence obligation under #15.

#### #8 — MySQL FK ordering and idempotent metadata convergence

- **Original Requirement:** `document.md` §10 item #8.
- **Existing Design:** `solution.md §36.5.3` (required ordering inside Wave 11) and `§36.5.5`
  (contract assertions I-1 … I-8, "must assert unconditionally after creating tables, so that
  `CREATE TABLE IF NOT EXISTS` cannot silently adopt a drifted pre-existing structure").
- **Implementation evidence:** migration `createIndexes` (`:129`ff) probes
  `information_schema.STATISTICS` on MySQL and only issues the `CREATE INDEX` when absent
  (probe-then-act convergence); `assertMySql` (`:247`) runs unconditionally after table creation
  (`:312`) and fails closed on column-order, PK, FK-target, CHECK-count or index-shape drift, with
  **no repair DDL**.
- **Test evidence:** executed on real MySQL in the accepted `server/mysql-sales-customer-wave9-credit.integration.js`
  run (17/17) and the accepted Wave 9 MySQL Integration 73/73.
- **Current status:** **Partially closed.** The Wave 9 metadata convergence and fail-closed assertion
  are implemented and executed. The **Wave 10 → Wave 11 FK ordering** obligation of `§36.5.4`
  ("Wave 9 → 10 upgrade: 2 tables added; `credit_special_approval` FK target created before the
  referencing table") and `§36.5.5` I-6 cannot exist yet, because the Wave 10 tables do not exist.
- **Wave 10 blocking:** **Not blocking** for Wave 10 to start. It is a **Wave 10 implementation
  obligation**: Wave 10 must create the target before the referencing table and must append its own
  `§36.5.5`-style read-only assertions.
- **Minimal handling:** **Partially close**; carry the Wave 10/11 ordering and assertion obligation
  into the Wave 10 scope. Do not record this item as fully closed.

#### #9 — Stable Credit Anchor provisioning transaction boundary

- **Original Requirement:** `document.md` §10 item #9.
- **Existing Design:** `solution.md §36.4` — the integrated provisioning protocol (five steps:
  pure key derivation → INSERT with duplicate tolerance → **unconditional** re-read and
  `FOR UPDATE` → fail closed → continue), explicitly superseding the self-contradictory §29.21.1;
  "No partial business mutation — the anchor INSERT is in the same transaction as the business
  mutation".
- **Implementation evidence:** `server/modules/credit-anchor.js:72` `ensureCreditLockAnchor` —
  `:85` the MySQL-only ` FOR UPDATE` re-read (SQLite relies on `BEGIN IMMEDIATE` serialization),
  `:87` fail closed `CREDIT_ANCHOR_UNRESOLVABLE`, `:88` `CREDIT_ANCHOR_SHAPE_CONFLICT`. The
  transaction boundary is real: `server/modules/credit-profile.js:148` opens `transaction(db, () => …)`
  and the anchor provisioning (`:152`), overlap check (`:156`), profile insert (`:160`), rating insert
  (`:167`), audit and idempotency all execute inside that one transaction.
- **Test evidence:** `server/mysql-sales-customer-wave9-anchor-concurrency.integration.js` — accepted
  "MySQL Wave 9 Anchor 4/4 PASS" (`document.md` Wave 9 Final Acceptance §3), proving independent
  real-MySQL sessions, genuine same-key contention for both `CREDIT_OBJECT` and `POLICY_SCOPE`,
  deadlock classification, acknowledged rollback and one final logical row; plus
  `server/mysql-sales-customer-wave9-credit.integration.js` "anchor identity stays canonical and
  group-free on MySQL" (accepted 17/17).
- **Current status:** **Closed.**
- **Wave 10 blocking:** **Not blocking.** Wave 10 must provision anchors in the fixed
  `POLICY_SCOPE → AGGREGATE → SALESPERSON` order and must not add a second provisioning protocol.
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract and a Wave 10 composition
  constraint.

#### #10 — Credit Policy Snapshot fingerprint identity and uniqueness

- **Original Requirement:** `document.md` §10 item #10.
- **Existing Design:** `solution.md §36.2.5` (A-50, supersedes §29.21 fingerprint uniqueness) and
  `§36.3.4` step 6 (insert-only; existing rows read with no row lock) and `§36.3.4.3`.
- **Implementation evidence:** migration `:106` `snapshot_fingerprint TEXT NOT NULL`;
  `uq_credit_policy_snapshots_identity` UNIQUE(`credit_lock_anchor_id`,`business_date`,
  `snapshot_fingerprint`) at `:24`; the `credit_policy_snapshots` table at `:102` (SQLite) / `:192`
  (MySQL).
- **Test evidence:** metadata index-shape assertion executed on real MySQL in the accepted 17/17 run;
  SQLite focused suite. **No production writer of `credit_policy_snapshots` exists yet** — the
  snapshot writer belongs to the Wave 10 `evaluateCredit()` runtime (`§36.6.3` step 7).
- **Current status:** **Closed** for the identity/uniqueness contract. The **runtime writer** is a
  Wave 10 deliverable, not a Wave 9 defect.
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close** the contract; record the writer as Wave 10 scope.

#### #11 — Canonical names: `credit_lock_anchors` and `credit_check_results`

- **Original Requirement:** `document.md` §10 item #11.
- **Existing Design:** `solution.md §36.2.1` (`credit_lock_anchors`, A-62, Wave 9) and `§36.2.7`
  (`credit_check_results`, A-54, **plural canonical**, Wave 10, supersedes §29.25.1).
- **Implementation evidence:** `credit_lock_anchors` **exists** — migration `:30` / `:146`, listed in
  `SALES_WAVE9_TABLES` (`:6`ff). `credit_check_results` **does not exist**: no
  `CREATE TABLE ... credit_check_results` and no `CREATE TABLE ... credit_special_approval` exists
  anywhere under `server/`, and no `evaluateCredit` symbol exists in any server module. The Wave 10
  runtime is therefore absent, exactly as the Gate A M-board records.
- **Test evidence:** Wave 9 accepted evidence covers `credit_lock_anchors` only. No Wave 10 table
  evidence exists and none can exist before Wave 10 implementation.
- **Current status:** **Partially closed.** The *naming* question is closed by Design for both names
  (`credit_lock_anchors` shipped; `credit_check_results` plural canonical is fixed for Wave 10). The
  Wave 10 table itself is not implemented.
- **Wave 10 blocking:** **Not blocking.** This is a **Wave 10 deliverable**, not a Wave 10
  precondition.
- **Minimal handling:** **Partially close** the naming question; carry the table creation as Wave 10
  scope. Do not record the Wave 10 table as existing.

#### #12 — Credit Profile rating canonical write owner

- **Original Requirement:** `document.md` §34.3 SC89 (rating provenance) and `§14` (Wave 9
  authorization); register §10 #12.
- **Existing Design:** `solution.md §36.7.1` — "`credit_profile_ratings` is the SOLE canonical owner
  of applied rating state; `credit_profile.rating_grade` / `rating_effective_from` /
  `rating_effective_to` are a DERIVED READ PROJECTION … maintained inside the same transaction as the
  rating application, and never written independently"; `§36.7.2` rating application flow (SC107,
  Wave 11).
- **Implementation evidence:** `server/modules/credit-profile.js:167` writes the
  `INITIAL_ASSIGNED` rating row and `:160` writes the inline projection columns, both inside the
  single `transaction(db, …)` opened at `:148`; the migration CHECK at `:124` enforces the
  `INITIAL_ASSIGNED` / `evaluation_result_id IS NULL` pairing. No second rating writer exists.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC89 initial rating
  provenance is recorded and rating evidence is append-only on MySQL" (accepted 17/17); SQLite
  focused suite.
- **Current status:** **Closed for the Wave 9 `INITIAL_ASSIGNED` path.** The **`EVALUATED`** rating
  application path is SC107, a Wave 11 capability, and does not exist yet.
- **Wave 10 blocking:** **Not blocking.** Wave 10 must not create a second rating writer; the Credit
  Special Approval workflow (`§36.6.6`) must not write rating rows.
- **Minimal handling:** **Close** for Wave 9; carry the `EVALUATED` path forward as a Wave 11
  obligation.

#### #13 — R-SAL-12 / R-SAL-24 infrastructure versus full business-race timing

- **Original Requirement:** `document.md` §10 item #13.
- **Existing Design:** `solution.md §36.8.2` (Wave 9 infrastructure fixtures W9-R1…W9-R7, and the
  explicit limit "R-SAL-24 is **infrastructure-level only** at Wave 9. No Wave 9 fixture may claim
  full R-SAL-24 verification."); `§36.8.3` (Wave 10 full business races W10-R1…W10-R12); `§37.10`
  (M9–M12, M15 and M19-Credit are Wave 10 only and "must be reported as BLOCKED, never as PASS").
- **Implementation evidence:** the Wave 9 infrastructure half exists — `ensureCreditLockAnchor`
  (`server/modules/credit-anchor.js:72`) takes exactly one anchor row `FOR UPDATE` and no other
  Credit lock. The full business-race half cannot exist: `credit_check_results` and
  `credit_special_approval` do not exist and `evaluateCredit` does not exist.
- **Test evidence:** the accepted Wave 9 evidence covers the infrastructure half only —
  "MySQL Wave 9 Credit 17/17 PASS", "MySQL Concurrency 106/106 including Wave 9 Anchor 4/4".
  **No Wave 10 full business-race evidence exists.**
- **Current status:** **Open by design, and correctly split.** Wave 9 covered the infrastructure half
  within its stated limit; the full business-race half is an explicit Wave 10 obligation and, for
  Credit integration, a Gate B obligation.
- **Wave 10 blocking:** **Not a precondition** — it is the **core Wave 10 acceptance obligation**
  (W10-R1…W10-R12) and the downstream Gate B obligation (B-M9, B-M10, B-M11, B-M12, B-M15, B-M19C).
- **Minimal handling:** **Keep open** as a Wave 10 implementation + Gate B acceptance obligation. Do
  not mark PASS; do not let the Wave 9 infrastructure evidence stand in for it.

#### #14 — Read-only legacy inventory and conditional bootstrap

- **Original Requirement:** `document.md` §10 item #14 and the `LEGACY_DATA_EVIDENCE_PENDING`
  classification (`document.md` Stage B §1 classification table; §5 applicability; §9.1 closing note
  that it "remains open by design").
- **Existing Design:** `solution.md §36.5.6` — the legacy bootstrap is **CONDITIONAL** and blocked
  behind `LEGACY_DATA_EVIDENCE_PENDING`: Wave 9 "create the new `credit_profile` table empty; do NOT
  backfill; do NOT invent Credit Profile records; do NOT fabricate historical credit limits or
  ratings; do NOT silently resolve ambiguous legacy identity; do NOT claim historical compatibility".
- **Implementation evidence:** `server/migrations/sales-customer-wave9-credit-foundation.js` contains
  **no** `INSERT INTO credit_profile` — the table is created empty. The safe default is implemented
  as designed.
- **Test evidence:** **none exists, and none can exist without authorization.** No authorized
  read-only external inventory has been performed. `document.md` Wave 9 Final Acceptance §4 keeps
  `LEGACY_DATA_EVIDENCE_PENDING` open and unchanged, and no compatibility claim is made in either
  direction.
- **Current status:** **Open — `LEGACY_DATA_EVIDENCE_PENDING`.** The unresolved fact is preserved: the
  existence of a legacy `credit_profile` table carrying rows in an external environment is **unknown**
  and unproven in either direction. **It is not established that no legacy data exists**, and this
  record does not assert it.
- **Wave 10 blocking:** **Not blocking.** `§36.5.6` defines a safe default (empty table, no backfill),
  so Wave 10 neither depends on nor is endangered by the legacy inventory.
- **Minimal handling:** **Keep open** as an unresolved external-evidence dependency with a
  non-destructive compatibility boundary. Do not close it, do not reclassify it, and do not describe
  it as "verified that no legacy data exists".

#### #15 — SQLite / MySQL PK, UNIQUE, CHECK, FK and indexed-column type parity

- **Original Requirement:** `document.md` §10 item #15.
- **Existing Design:** `solution.md §36.5.4` (migration equivalence proof obligations) and `§36.5.5`
  (contract assertion requirement plus I-1…I-8).
- **Implementation evidence:** the migration implements per-table contract assertions for both
  engines — `assertSqlite` (`:226`) and `assertMySql` (`:247`), invoked unconditionally after table
  creation (`:312`). `assertMySql` covers column identity/order, PK column order, FK set with
  referenced table and column, CHECK count, index shape (column order and uniqueness), the I-5
  nullability parity (`credit_profile.salesperson_scope_key` `NO`; `credit_profile.salesperson_id`
  and `credit_profile_ratings.evaluation_result_id` `YES`) and a bounded physical-type parity set
  (`credit_lock_anchors.anchor_key` `varchar(512)`;
  `credit_profile_ratings.evaluation_result_id` `varchar(128)`;
  `credit_check_rules.result_payload_json` `json`; `credit_policy_snapshots.notes_json` `json`).
- **Test evidence:** the assertions execute on real MySQL as part of the accepted
  `server/mysql-sales-customer-wave9-credit.integration.js` run (17/17) and the accepted Wave 9
  MySQL Integration 73/73.
- **Current status:** **Partially closed — evidence incomplete.** The per-table metadata contract is
  implemented and executed on a real MySQL, but three `§36.5.4` / `§36.5.5` obligations are **not
  evidenced**:
  - **I-3 (explicit orphan check after bootstrap and after every live upgrade, executed with
    `FOREIGN_KEY_CHECKS` restored)** — no orphan-check query exists in the Wave 9 migration or in the
    Wave 9 MySQL integration test.
  - **I-4 (row preservation across replay and each upgrade path)** — no row-count snapshot comparison
    exists for the six Wave 9 tables; and there is **no dedicated Wave 9 migration / upgrade-path
    test file**, unlike the equivalent Wave 2 / Wave 6 / Wave 7 migration tests.
  - **I-6 (forward-FK convergence after Wave 11)** — future by construction; Wave 11 does not exist.
  The physical-type parity assertion also covers only four named columns, not every column type of
  the six tables.
- **Wave 10 blocking:** **Not blocking** for Wave 10 to start. It is a **cross-database evidence
  obligation** that must be discharged by a protected MySQL gate; the SQLite-only evidence must not
  be presented as real MySQL verification, and the Gate A MySQL evidence must not be presented as
  Wave 9 Credit Foundation MySQL evidence.
- **Minimal handling:** **Partially close**; record exactly which real evidence is missing, when it
  must be produced and which protected gate must produce it. Do not describe this item as
  cross-database verified.

### 5. Bounded document-state contradiction corrections

| # | Contradiction | Verified finding | Correction applied in this stage |
|---|---|---|---|
| 1 | `document.md` / `solution.md` wording that describes Wave 10 as still blocked by Gate B | **No such current-state wording exists.** The canonical direction is already correct: `solution.md §37.18`, `§37.26`, `§37.33.3` and the Gate A Freeze Record §4 all state that Gate B is a downstream obligation and never a prerequisite. `document.md` contains no line asserting the reverse. | No historical text rewritten. §2 of this record states the canonical direction explicitly and confirms it against the existing authority. |
| 2 | `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` mechanically restated as an unmet current condition | **The label's own defining condition is met.** `§37.18.1` / `§37.26` define it as "satisfied only by Gate A plus explicit user Final Acceptance"; both occurred on 2026-10-24. | §3 of this record states the current status as satisfied, keeps the label as a historical identifier, and preserves every dated historical statement as history rather than rewriting it. |
| 3 | #1–#15 uniformly recorded as OPEN against later Stage C Design, Wave 9 implementation, SQLite and MySQL evidence and the Gate A freeze | **The uniform-OPEN statement is stale for current status.** 10 items are closed, 3 are partially closed with a precisely named residual, and 2 remain open by design. | §4 of this record adds the per-item closure evidence matrix. The original `§10` register text is preserved verbatim as the 2026-10-22 record. |
| 4 | `server/mysql-sales-customer-wave9-credit.integration.js:52` — `WAVE11_TABLES` contains the Wave 10 tables `credit_check_results` and `credit_special_approval` alongside the Wave 11 table `credit_evaluation_result` | **Confirmed.** The constant name is misleading; the three tables are used at `:239` only as a set of table names to locate `information_schema` rows. The name does not affect behaviour. | **Recorded only.** No source change is made in this stage. Renaming the constant (and any accompanying assertion text) is a bounded future implementation item that must not alter the set of tables inspected. |
| 5 | The Gate A M1–M25 board is a static array, while a future Gate B must be evidenced by real execution | **Confirmed.** `scripts/gates/mysql-sales-wave7-gate-a.mjs:100`–`:107` is a hard-coded literal array of case/status pairs, already recorded as an open item in `solution.md §37.31.15` R3 ("Recorded, not fixed"). | **Recorded only.** The Gate A runner, its board and its frozen conclusions are not modified. The Design stage must require that Gate B use its own runner and generate its board from real execution evidence rather than a literal. |

### 6. Preserved unresolved evidence, real blockers and Wave 10 entry conditions

**Unresolved evidence that is preserved and must not be reported as closed:**

1. `LEGACY_DATA_EVIDENCE_PENDING` (#14) — no authorized read-only external inventory exists. The
   existence of legacy `credit_profile` rows remains unknown and unproven in either direction.
2. #15 — the `§36.5.4` upgrade-path equivalence obligations and `§36.5.5` I-3 (orphan check) and I-4
   (row preservation) are **not evidenced** for the six Wave 9 tables; no dedicated Wave 9
   migration/upgrade-path test file exists.
3. #8 — the Wave 10 → Wave 11 FK ordering and forward-FK convergence obligations cannot exist yet.
4. #13 — the Wave 10 full business races (W10-R1…W10-R12) and the Gate B Credit-integration cases
   (B-COMPOSE, B-M9, B-M10, B-M11, B-M12, B-M15, B-M19C) have **no** execution evidence.
5. #11 — `credit_check_results` and `credit_special_approval` do not exist; no `evaluateCredit`
   production path exists.
6. `solution.md §37.31.15` R1–R4 — recorded, not fixed; not closed by the Gate A freeze.
7. The remaining W7-C1 / W7-C2′ follow-up work, which the Gate A Freeze Record §4 explicitly does
   not declare complete.
8. The disclosed broad global administrative grant on the disposable test account, as recorded in
   `log/2026-10-24.md`.
9. The `WAVE11_TABLES` naming item (§5 #4) and the static Gate A M-board (§5 #5), both recorded as
   bounded future implementation items.

**Real conditions for entering Wave 10:**

- **Authorisation is the only precondition.** Per §2, the canonical dependency direction makes Gate B
  a downstream obligation, and per §3 the `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` condition
  is satisfied. No Gate B-0 exists. The gate that Wave 10 waits on is therefore the explicit user
  authorization to implement, not a further technical gate.
- **Wave 10 must not be pre-empted.** The Credit Check engine, `credit_check_results`,
  `credit_special_approval`, the Special Approval workflow and the SO Submit / Approve / Delivery
  Confirm integration belong to Wave 10 and must not be implemented earlier under another wave
  name, and must not be simulated by fixture-computed exposure.
- **Wave 10 inherits the frozen contracts.** Wave 9 (Credit Foundation), Wave 7 (Sales & Customer),
  the L0 transaction gate, the L1–L8 lock order, the Finance monetary authority, the effective
  retry semantics, the idempotency contract, the SQLite behaviour, the MySQL `READ COMMITTED`
  isolation and the frozen Gate A boundary all remain in force.

### 7. Boundary and status

This record is a Requirement reconciliation only. It modifies `document.md` and the append-only
`log/2026-10-24.md` only. It changes no production source, no test, no schema, no migration, no
`README.md`, no `package.json`, no permission, no lock order and no acceptance conclusion. It does
not reopen, modify or weaken the frozen Gate A record, its runner, its suite manifest, its suite
order, its strict TAP / fail-fast / cleanup rules, its target-identity guard, its named-lock release
contract or its M1–M25 board. It does not close any Requirement that this record does not itself
close, and it does not claim that any Gate, Wave or legacy-data question has been verified beyond
the evidence cited above.

No test, build, MySQL gate, migration, database query, database reset or destructive operation was
executed. No Git add, commit, push, pull, fetch, merge, rebase, reset, restore, clean, stash or tag
was performed. No release or deployment occurred. Wave 10 and Wave 11 remain unstarted.

**Status: `REQUIREMENT_RECONCILIATION_COMPLETE`.**

---

## Wave 10 B-9 / B-10 / S14 Bounded Requirement Amendment (2026-10-24)

### 1. Authorization and bounded reopen

The user explicitly approved the consecutive `AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION`
closure for Wave 10 B-9, B-10 and S14. This subsection records the Requirement phase only. It
does not declare Acceptance or Freeze and does not authorize MySQL, Gate B, Git write, release or
deployment.

The original Wave 9 Final Acceptance and Freeze Record remains authoritative historical evidence.
Only the B-9 Profile-status semantic is reopened, and only to apply the ACTIVE-only enforceability
rule below. Wave 9 schema, migration, anchor identity, policy versioning, rating provenance,
effective-date resolution and permission policy remain frozen. This bounded reopen is not
automatically re-frozen; focused compatibility evidence and explicit user Acceptance remain
required.

### 2. B-9 — O2 ACTIVE-only Credit Profile enforceability

- An effective `ACTIVE` Credit Profile is eligible for mandatory Credit Check. Its limit,
  applicable rule, effective date and authorization continue to determine PASS / WARNING / BLOCK.
- An effective `SUSPENDED` Profile cannot authorize a new controlled credit commitment. Mandatory
  Credit Check fails closed. Suspension is not an exemption and does not disable Credit Management.
- An effective `CLOSED` Profile cannot authorize a new controlled credit commitment. Mandatory
  Credit Check fails closed. Closing a Profile does not settle, cancel, erase or release an existing
  economic obligation.
- Historical Profile, Rating, Sales Order, Delivery, AR, settlement, approval and exposure facts
  remain intact. Eligibility is restored only by a valid effective `ACTIVE` Profile under the
  existing versioning contract.
- A missing required Profile retains `CREDIT_PROFILE_MISSING`. An effective but non-ACTIVE Profile
  is distinct and must fail with `CREDIT_PROFILE_NOT_ENFORCEABLE`. Ambiguous effective Profiles keep
  the existing fail-closed behavior.
- The resolver must not fall back to an earlier ACTIVE version when the currently effective version
  is `SUSPENDED` or `CLOSED`, and a mandatory salesperson sub-limit must not fall back to the
  aggregate Profile as a bypass.
- Special Approval is a bounded ceiling/scope exception only. It cannot override the non-ACTIVE
  status fence and cannot make a suspended or closed Profile ACTIVE.
- Historical exposure remains visible and derived from canonical facts. Refusing a new commitment
  must not delete or release old exposure.
- Exact replay of an already committed operation creates no new side effect. A new economic
  obligation is checked against the currently applicable Profile status.
- Existing explicit Credit Management disable/exemption behavior remains governed by the existing
  contract; Profile status creates no new exemption.

### 3. B-10 — O1 transition-based retention; no age expiry

An unresolved approved Sales Order commitment remains in Credit Exposure until a canonical
business lifecycle transition removes or transfers its outstanding economic obligation. Elapsed
calendar time alone never releases it.

Consequences:

- no exposure-age parameter, expiry default, day-counting algorithm, TTL, scheduler or cleanup path;
- no automatic release of an old but valid undelivered commitment and no age-based removal of open AR;
- delivery, invoice, AR, collection, refund, credit adjustment, cancellation and closure follow
  their canonical business facts;
- cancellation or closure releases only the extinguished amount; any residual Delivery, AR or
  other outstanding obligation remains counted;
- business-date/as-of eligibility remains valid and separate from age expiry;
- `CREDIT_SUB_LIMIT_OVERDUE_DAYS` remains an overdue-AR policy and never becomes an SO commitment
  expiry control;
- overdue AR is a subset of AR open and is never an additional exposure bucket.

This subsection supersedes only the ambiguous "within exposure window" / "age <= window" wording
in `solution.md §29.23.1` and `§36.3.2`. Their historical text is preserved; the operative rule is
transition-based retention with no age expiry.

### 4. S14 — existing-contract remediation

Mode B (`INVOICE_DRIVEN_OPEN_ITEM`) and Mode C (`PROVISIONAL_TO_FINANCIAL`) invoice-sourced final AR
must use authoritative Finance source links and allocation evidence so that one outstanding
economic portion is counted exactly once across SO commitment, delivered/provisional exposure and
final AR.

This is an implementation defect against existing SC90–SC92, S14, `solution.md §29.23.2` and
`§36.3.2.2`; it is not a new business policy. The repair must consume canonical Finance ownership,
including `finance_invoice_source_links.invoiced_amount_cents`, and must not create a second Finance
allocation, Credit Exposure ledger or mutable exposure cache. A source-level amount or remaining-AR
allocation that cannot be proven from canonical facts must fail closed; it must never be guessed,
equally split or proportionally fabricated.

### 5. Recognition Mode rule-coverage boundary

- A rule with `recognition_mode IS NULL` is globally applicable for its stage and effective date.
- A mode-specific rule applies only to its matching Recognition Mode.
- Multiple applicable rules retain the existing strongest-outcome evaluation.
- Credit Management disabled retains the existing explicit bypass.
- When Credit Management is enabled but no effective rule applies to the actual mode, the existing
  Wave 10 contract treats the stage as not credit-controlled: `enforced=false`, no decision row and
  no audit row. A rule for another mode must not be silently promoted to a global rule.
- An applicable mandatory BLOCK rule remains backend fail-closed. WARNING and bounded Special
  Approval retain their existing semantics, subject to the new non-ACTIVE Profile fence.
- The current physical rule model has no explicit customer/scenario exemption discriminator even
  though `solution.md §29.22.1` names explicit exemption as a possible bypass. This is recorded as
  an OPEN contract-to-model gap. This bounded amendment does not invent an exemption, permission,
  default rule or unconditional enforcement policy.

### 6. Requirement decision record

```text
B9_O2_REQUIREMENT_APPROVED
B10_O1_REQUIREMENT_APPROVED
S14_EXISTING_CONTRACT_REMEDIATION_AUTHORIZED
RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED
```

## Wave 10 MySQL Acceptance Infrastructure Remediation Requirement (2026-10-25)

### 1. Authorization, source and bounded status

The user explicitly authorized one consecutive `AUDIT -> REQUIREMENT -> DESIGN` documentation
stage for the Wave 10 MySQL Acceptance Infrastructure remediation. This section records the
Requirement phase only. The immediately following Design phase may proceed without an intervening
approval, but Design completion is a mandatory HARD STOP. Production code, tests, fixtures,
runners, workers, manifests, TAP parsing, package scripts, MySQL access, destructive database
operations and Git writes are not authorized by this stage.

The current source audit reconciled findings `W10-AUD-001` through `W10-AUD-009`. Findings 001,
002, 003, 004, 005, 007, 008 and 009 are `CONFIRMED`. Finding 006 is
`PARTIALLY_CONFIRMED`: the current fixture does not exercise the formal Wave 9 physical upgrade
path or compare actual source and target schema signatures, but its dynamic foreign-key edge
enumeration and value-by-value preservation of its synthetic six-table graph remain valid local
test intentions. No finding is treated as real-MySQL execution evidence.

This remediation does not alter the approved Wave 10 business meaning. It specifies the evidence
infrastructure required before a separately authorized real-MySQL campaign may be requested.

### 2. W10-AIR-R01 — Evidence authenticity and M-board identity

Each fixed Gate B case has exactly one case identity, one primary evidence level, one executable
case owner and one marker emission point. A marker is emitted only after that exact case's
preconditions, production or raw action, persistent postconditions and cleanup obligations have
passed in the current process run.

- `B-COMPOSE` is `STATIC_INTENT`; it proves static composition only and makes no runtime lock or
  business-outcome claim.
- `B-M9`, `B-M10`, `B-M11`, `B-M12`, `B-M15` and `B-M19C` require
  `PRODUCTION_SERIALIZED_OUTCOME` as their primary M-board evidence. A separate raw diagnostic may
  supplement a case, but cannot produce or replace its production marker.
- `B-M15` must prove the real empty-parent, two-salesperson aggregate-capacity business result;
  observing one anchor row wait is insufficient.
- Source text, function names, constant arithmetic, a different R-case, historical logs, SQLite
  output and a prewritten PASS list cannot produce a production marker.
- Missing, duplicate, extra, out-of-order ownership, wrong-level or cross-case marker reuse fails
  the Gate B runner. A failed TAP suite, child-process failure, unconfirmed child termination,
  cleanup failure or missing final-zero confirmation suppresses the M-board entirely.

### 3. W10-AIR-R02 — Destructive-target identity and inventory safety

Before the first destructive statement, the runner must establish one immutable campaign identity
from both approved configuration and the connected server:

1. exact password-free `mysql://user@host:port/database` authorization;
2. exact configured host, port, database and user;
3. actual `SELECT DATABASE()` result;
4. actual `CURRENT_USER()` result;
5. actual server UUID and MySQL 8 version policy;
6. a normalized effective-grant fingerprint and the required bounded schema privileges;
7. an initial object inventory covering tables, views, triggers, routines and events.

The UUID, actual account and grant fingerprint are future preflight outputs requiring separate
authorization; they must never be guessed or committed as unverified constants. The first campaign
run uses `EMPTY_ONLY`: a non-empty initial inventory fails before DROP and requires a separately
authorized recovery decision. Once an empty target and full identity have been confirmed, the
runner may hold an in-memory campaign lease for objects created by that run. Every per-suite reset
and final cleanup must revalidate database, actual account, UUID and version before acting.
Identity drift revokes the lease and fails closed without destructive action.

Passwords, raw grants, full environment dumps, SQL payloads and connection secrets must not appear
in errors, TAP or M-board output. Reports may include only the password-free target identity,
server-UUID digest or approved bounded form, version, account identity, grant digest and inventory
counts.

### 4. W10-AIR-R03 — Bounded child lifecycle and cleanup

Every suite has an explicit wall-clock deadline. Timeout enters `CHILD_TIMEOUT`; the runner must
request graceful termination of the suite process and its workers, wait for bounded exit
confirmation, escalate to a platform-safe process-tree termination, and again wait for bounded
confirmation. Fixed sleeps are not exit evidence.

If termination is confirmed, suite failure proceeds to final cleanup. If termination cannot be
confirmed, cleanup must not race a possibly live database client: the run fails non-zero with
cleanup recorded as `NOT_ATTEMPTED_CHILD_LIVE`. All ordinary suite failures, non-zero exits, spawn
errors, malformed TAP, marker failures and runner exceptions with no live child enter final
cleanup. Identity failure before a destructive lease performs no cleanup. Cleanup identity drift,
reset failure, zero-object failure or adapter-close failure is terminal and prevents PASS.

### 5. W10-AIR-R04 — Deterministic independent-session business races

W10-R1 through W10-R12 must use distinct MySQL connections and the real production handlers or
services named by the approved contract. `Promise.all` alone is not a concurrency barrier. Each
case must provide a deterministic coordinator and, where needed, an observer connection:

- both contenders register distinct `CONNECTION_ID()` values and announce READY;
- a coordinator holds the existing L0 transaction gate or the case's approved raw coordination
  row so both production calls are demonstrably pending before release;
- `performance_schema` observation, bounded query-state observation or another exact server fact
  proves the required wait; inability to observe required evidence fails rather than sleeps to
  PASS;
- raw coordination never becomes the production business result;
- both transaction outcomes, authoritative final rows, amounts, audits and idempotency records are
  asserted after all sessions settle.

The required case meanings remain those in `solution.md §36.8.3`: R1 covers BOTH_FIT and
ONLY_ONE_FITS Credit Checks; R2 allows exactly one effective Special/standard authority, not zero;
R3 proves an exact OLD-or-NEW exposure and no transition double-count; R4 and R8 prove coherent
version sets; R7 races a different-scope approval against a mandatory sub-limit refusal; R9 uses a
real final unpaid AR reached from an SO transition; R10 uses consolidated or otherwise
source-unprovable AR and returns `UNPROVEN_ATTRIBUTION`; R11 proves Finance-parent-first completion
without a cycle; R12 uses N independent production checks and separately proves that reuse of an
existing immutable snapshot takes no snapshot-row lock.

### 6. W10-AIR-R05 — Authoritative capacity preconditions

Every capacity race must calculate its classification from committed authoritative facts before
release of the race barrier. It reads the applicable effective Profile limit, canonical
recognition-mode-aware exposure `E`, business date, scope, cents unit and each proposed delta, then
derives `available = limit - E`.

The fixture records and asserts exactly one of:

```text
BOTH_FIT      da <= available AND db <= available AND da + db <= available
ONLY_ONE_FITS da <= available AND db <= available AND da + db >  available
NEITHER_FITS  da >  available AND db >  available
```

The expected winner count follows that computed classification. A constant copied from seed input
is not proof. NULL/unbounded limits, currency mismatch, unsafe integers, ambiguous attribution or
a precondition that changes before the coordinated start make the fixture explicitly
unconstructible or fail closed; they cannot be converted into PASS.

### 7. W10-AIR-R06 — Formal migration, parity, upgrade and preservation

Fresh initialization must use the production `createDatabase()` MySQL bootstrap path. The upgrade
fixture must begin from an actual canonical SQLite snapshot whose Sales & Customer registry is
bounded through Wave 9, materialize that snapshot through the production MySQL bootstrap, and then
invoke the canonical ordered migration registry through Wave 10. Creating the final schema and
dropping two tables is not an upgrade fixture.

For all six Wave 9 tables, parity compares normalized metadata captured from the actual canonical
SQLite Wave 9 source schema with actual MySQL `information_schema`: complete ordered columns,
logical type mapping, nullability, defaults, primary keys, foreign keys, checks and indexes where
the cross-dialect contract applies. Handwritten type strings may be diagnostic expectations but
cannot be the source side.

The suite must prove:

- fresh bootstrap and Wave 9->10 upgrade produce equivalent normalized metadata for the eight
  Credit tables;
- repeated formal initialization and repeated registry upgrade are idempotent;
- I-4 compares complete pre/post values for a non-empty, referentially connected six-table Wave 9
  graph, including nullable and boundary-value variants, not row counts alone;
- I-3 dynamically enumerates every actual FK edge of the eight tables and finds zero orphans;
- every difference is reported and cleanup remains subject to R02/R03.

`LEGACY_DATA_EVIDENCE_PENDING` remains open. Synthetic fixtures never prove the state of an
external historical database.

### 8. W10-AIR-R07 — Case-complete zero-side-effect projections

Each rejection, loser, rollback and replay case declares its projection before execution and
compares it afterward by stable identity, business status, monetary fields, version/fingerprint and
relationships, not total row count alone. The union includes, where the case can touch them:

- `credit_check_results`, `credit_special_approval`, `credit_policy_snapshots` and Profile/rule/
  parameter version facts;
- `sales_prepayment_requirements`, `sales_prepayment_gate_results` and eligible Finance parent
  balances;
- `sales_orders`, order items and applicable delivery/invoice source facts;
- `account_receivables`, settlement/application facts and `finance_invoice_source_links`;
- relevant `audit_logs` and `idempotency_records` rows, including operation keys and stored result;
- every other table written by the exact production entrypoint under test.

A required table or column that cannot be queried is a fixture failure. No necessary projection is
silently skipped. A winning transaction's expected effects are asserted separately from the
loser's zero-effect delta, and exact replay must create no second economic, audit or idempotency
effect.

### 9. W10-AIR-R08 — Real-MySQL business matrix

The protected Wave 10 campaign must include a separately named business-matrix suite covering:

- B-9 O2: effective ACTIVE allows evaluation; effective SUSPENDED and CLOSED return
  `CREDIT_PROFILE_NOT_ENFORCEABLE`; no fallback to an earlier ACTIVE version or aggregate bypass;
  Special Approval cannot cross the status fence; historical exposure remains intact.
- B-10 O1: an old unresolved approved SO and open AR remain exposed across arbitrary business-date
  distance; only proven lifecycle extinction/transition releases an amount; overdue AR is not an
  extra bucket.
- S14 Mode B/C: authoritative invoice-source links, partial invoice, partial settlement, multiple
  deliveries, multiple salespersons, exact single-source attribution, missing/inconsistent
  lineage and ambiguous remaining allocation. No proportional, FIFO, equal or residual guessing is
  allowed.
- Recognition Mode: global rule, exact-mode rule, nonmatching-only rule, no applicable rule,
  strongest applicable outcome and mandatory BLOCK rollback.

The explicit customer/scenario exemption selector remains
`RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN`. The matrix asserts that no selector or bypass
is fabricated; it does not implement or claim exemption support. SQLite evidence may remain useful
regression evidence but cannot close this MySQL matrix.

### 10. W10-AIR-R09 — Strict TAP, marker grammar and local behavior tests

Strict TAP acceptance requires one complete top-level plan, a valid end-of-stream, internally
consistent test records and summary counters, at least one test, `pass == tests`, and zero fail,
skip, cancelled or todo. Missing, duplicate, extra, illegal, truncated or contradictory records
fail even when the child exit code is zero. A non-zero exit always fails.

The runner orchestration, target verifier, process lifecycle, TAP parser and M-board reducer must
be testable without a database through injected adapters/processes/clocks or pure state reducers.
Local behavioral tests must cover guard refusal, identity mismatch, non-zero exit, hang and both
termination outcomes, malformed/incomplete TAP, cleanup failure, final-zero failure, every marker
cardinality/level error, suppression of PASS and Gate A/legacy execution-graph isolation. Source
regex checks may supplement but cannot replace these tests.

### 11. W10-AIR-R10 — Freeze, compatibility and authorization boundary

- Gate A remains frozen and is neither imported nor executed by either Wave 10 runner.
- Wave 9 schema, business semantics and freeze history remain unchanged. Wave 9 participation is
  limited to a test-only physical snapshot and compatibility verification required by R06.
- L0, L1-L8, READ COMMITTED, Finance monetary authority, permissions, status, idempotency and
  production transaction semantics are unchanged.
- No shadow ledger, mutable exposure cache, new business feature, Wave 11/12 implementation or
  schema correction may be introduced to make a test pass.
- Real MySQL suites remain outside unconditional FAST/FULL/HEAVY and are reachable only through
  explicit protected commands after separate exact-target authorization.
- Passing local remediation tests authorizes neither MySQL execution nor Acceptance/Freeze.

### 12. Requirement acceptance and OPEN facts

The future Implementation is Requirement-complete only when every `W10-AIR-R01` through
`W10-AIR-R10` mapping has executable tests and no lower evidence class is promoted. The following
facts remain OPEN until their separately authorized phases:

```text
OPEN  actual server UUID, CURRENT_USER and effective-grant fingerprint
OPEN  actual initial object inventory at the future campaign target
OPEN  all real-MySQL migration, race, lock, rollback, cleanup and M-board results
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
```

**Requirement status: `WAVE10_MYSQL_ACCEPTANCE_REMEDIATION_REQUIREMENT_COMPLETE`.**

## Wave 10 MySQL least-privilege readiness and Finance View parity requirement (2026-10-25)

### Authorization, scope and audited gap

The user authorized one consecutive Audit → Requirement → Design → Implementation → local
verification → dedicated-account remediation → read-only preflight sequence, with the hard stop
immediately before any real MySQL Acceptance campaign. The existing Guard is `PARTIAL`: it omits
`TRIGGER` and can admit global DML, dynamic administration, grant delegation or inherited roles.
MySQL initialization is `SEMANTIC_MISMATCH`: unlike SQLite, it does not install the canonical
`finance_open_item_effects` derived View because the SQLite snapshot contains tables only.

### W10-LPR-R01 — exact dedicated-account contract

The campaign account is exactly `modern_erp_wave10@127.0.0.1`, connected only to
`modern_erp_domain_test`. Its target-schema privileges are exactly `SELECT`, `INSERT`, `UPDATE`,
`DELETE`, `CREATE`, `DROP`, `ALTER`, `INDEX`, `REFERENCES`, `TRIGGER` and `CREATE VIEW`. Its only
privileges outside that schema are table-scoped `SELECT` on
`performance_schema.data_locks`, `performance_schema.data_lock_waits` and
`performance_schema.threads`. `USAGE ON *.*` is the sole permitted global grant.

Every other privilege is forbidden, including global DML/DDL, `ALL PRIVILEGES`, `PROCESS`,
`SUPER`, `FILE`, `SHUTDOWN`, reload, account/role/replication administration, every dynamic
administrative privilege, routine/event authority, unrelated-schema authority and `WITH GRANT
OPTION`. No role may be granted, active or default. A global privilege never substitutes for an
explicit target-schema privilege.

### W10-LPR-R02 — fail-closed identity and fingerprint

Before a campaign lease or destructive lifecycle action, the Guard must verify in order: exact
configured host/port/database/user; `DATABASE()`; exact `CURRENT_USER()`; approved server UUID;
MySQL 8 version policy; normalized effective `SHOW GRANTS` fingerprint; the exact privilege and
no-role contract above; and the approved initial five-category object inventory. Missing,
additional, inherited, differently scoped or delegated authority fails closed before mutation.
The trusted grant fingerprint is supplied independently; current grants must never be learned or
promoted automatically as trusted.

### W10-LPR-R03 — canonical Finance View parity

`server/modules/finance-open-item-effect-view.js` remains the single canonical definition of
`finance_open_item_effects`. Fresh SQLite and MySQL initialization, repeated initialization and an
existing-schema upgrade must all leave exactly that derived View available after its dependency
tables exist. Initialization is idempotent, corrects a stale prior View definition, never creates a
materialized/shadow table, and fails closed on dependency or DDL error. Inventory and cleanup must
continue to classify and remove it as a View before base tables. Cross-backend projection semantics
and Finance monetary authority are unchanged.

### W10-LPR-R04 — evidence and boundaries

Local behavior tests must prove: the valid exact grant set; every missing required schema
privilege; global static or dynamic excess; grant delegation; role inheritance/default role;
schema/account/database/UUID/version/fingerprint mismatch; inventory refusal; View first install,
repeat, stale-definition upgrade, canonical definition and dependencies; cleanup View ordering;
and zero Gate A change. Syntax, focused suites, related Wave 9/10/Finance tests, FAST, FULL, build
and `git diff --check` are required with MySQL/destructive environment removed.

This requirement authorizes no Gate A edit or execution, Gate B, Acceptance, target-schema
bootstrap/reset/migration/DDL/DML/cleanup, unrelated account/schema change, Git write, Wave 11 or
Wave 12 work. The only permitted external mutation after local verification is creation or exact
grant remediation of the confirmed-dedicated account named in R01, followed solely by read-only
preflight. Real MySQL Acceptance remains separately authorized.

**Requirement status: `WAVE10_MYSQL_LEAST_PRIVILEGE_AND_VIEW_PARITY_REQUIREMENT_APPROVED_BY_CONSECUTIVE_AUTHORIZATION`.**

## Wave 10 Gate B OQC quality-policy fixture Requirement (2026-10-26)

### 1. Authorization, scope and audited gap

The user explicitly authorized one consecutive `AUDIT -> REQUIREMENT -> DESIGN` stage for the Wave 10
Gate B OQC fixture gap, with a mandatory HARD STOP at the end of Design. This section records the
Requirement phase only. The immediately following Design phase may proceed without an intervening
approval. Implementation, real MySQL access, Gate A, Gate B, the Wave 10 Acceptance campaign,
destructive database operations, production quality-gate semantics and Git writes are **not**
authorized by this stage.

Audited gap classification — `PARTIAL` against the canonical production chain, `MISSING` against the
Wave 10 acceptance fixture:

- `PARTIAL` — the canonical Sales Delivery quality-gate chain is fully implemented in production, but
  the Wave 10 acceptance fixture installs no quality-policy fact of any kind, so the chain cannot be
  traversed by the acceptance suites.
- `MISSING` — the Wave 10 acceptance fixture has no means to reach the canonical Delivery CONFIRM
  transition through the real production HTTP route.

**This is not a production defect.** The HTTP 409 refusal observed in the Gate B run is the correct
production behaviour of the fail-safe default. No production defect and no new cross-domain
Requirement was discovered; the gap is confined to acceptance-fixture infrastructure.

### 2. Audit facts this Requirement is bound to

Each fact below was verified against the actual source at HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6`.

- **A1** — `server/app.js:5658`: `createSalesDelivery()` calls
  `configureTrackedDraftLines({ sourceType: 'SALES_DELIVERY', sourceId: deliveryId, itemTable:
  'sales_delivery_items', foreignKey: 'delivery_id', rawItems: items, businessDate: deliveryDate })`
  inside the Delivery-creation transaction.
- **A2** — `server/app.js:4190-4199`: `configureTrackedDraftLines()` calls `freezeQualityPolicy()`
  exactly once per persisted Delivery line.
- **A3** — `server/modules/traceability-quality.js:418-434`: `resolveQualityPolicy()` selects the
  applicable Quality Control Point. With no applicable control point, `SALES_DELIVERY` resolves to
  `{ qcpId: null, version: null, inspectionRequired: true, samplingMode: 'FULL', samplingValue: null,
  failSafe: true }`. The only default waiver in the codebase is `OUTSOURCING_RECEIPT` (OUT-18), which
  does not apply to Sales Delivery.
- **A4** — `server/modules/traceability-quality.js:436-443`: `freezeQualityPolicy()` writes
  `logistics_quality_policy_snapshots` with `inspection_required = 1`, `qcp_id = NULL` and
  `waiver_reason = NULL` in that case.
- **A5** — `server/app.js:5843`: `confirmSalesDelivery()` calls `assertQualityGate(db, 'OQC',
  deliveryId)` on the confirmation path, before the inventory, COGS and Finance recognition writes.
- **A6** — `server/modules/quality-gates.js:191-238`: `deriveQualityState()` reads
  `qualityPolicyAllowsPosting()`; with a required policy and no matching `oqc_inspections` row the
  state is `NOT_INSPECTED` (`未检验`), and `assertQualityGate()` raises HTTP 409
  `物流单据质量门禁未通过：未检验`. The refusal label is the production fallback of
  `assertQualityGate()`: the per-source label `销售出库单` is declared on
  `config.OQC.sourceTypes.SALES_DELIVERY`, while the label resolution reads
  `config[kind].shared.sourceTypes`, so the resolved label is `物流单据`. The refusal text is
  therefore asserted against the message the production gate actually raises, not against a
  hand-written label. See solution.md §37.46.11.
- **A7** — `server/test-utils/wave10-mysql-acceptance-fixture.js`: the Wave 10 acceptance fixture
  contains **no** `quality_control_points`, **no** `logistics_quality_policy_snapshots` and **no**
  `oqc_inspections` fact of any kind.
- **A8** — `server/migrations/v13-phase6b-traceability-quality.js:216-221`: the shipped default
  control points are inserted only when a `user-admin` row exists. The protected Wave 10 MySQL target
  is initialized in production mode, so the demo seed does not run, `user-admin` does not exist and
  `quality_control_points` is empty on that target. Even where the default row does exist it carries
  `inspection_required = 1` and would produce the same refusal.
- **A9** — `server/mysql-sales-customer-batch-a-concurrency.integration.js:169-171`: the Batch A
  concurrency fixture writes a `logistics_quality_policy_snapshots` row **by hand** with
  `qcp_id = NULL`, `qcp_version = NULL` and `waiver_reason = 'CONCURRENCY_FIXTURE'`. That row
  corresponds to no Quality Control Point and records no resolution. It is not acceptable evidence
  under this Requirement.
- **A10** — `server/test-utils/wave10-mysql-acceptance-fixture.js:278-298`: the fixture already
  installs the fail-closed Wave 1 `sales_parameters` SYSTEM row through the canonical writer
  `upsertSalesParameters()`, for exactly the same reason — a production prerequisite must be present
  as a real configuration fact rather than invented behind the writer. A Quality Control Point is the
  same class of prerequisite.
- **A11** — `server/mysql-sales-customer-wave10-business-matrix.integration.js:104-126`: the
  `W10-BUSINESS-MATRIX` suite of the Wave 10 Acceptance campaign creates **and confirms** Sales
  Deliveries through the same real production HTTP route and the same shared fixture base. It is
  exposed to the same refusal and is therefore in scope of this Requirement, not only the Gate B
  production-races suite.

### 3. W10-QCP-R01 — Production quality-gate semantics are unchanged

- The canonical Sales Delivery **continues to enforce OQC**. `assertQualityGate(db, 'OQC',
  deliveryId)` remains on the confirmation path with unchanged behaviour, ordering, status set and
  error contract.
- **Missing policy evidence remains fail-safe `BLOCKED`.** The absence of an applicable Quality
  Control Point, the absence of a frozen policy snapshot, or a snapshot that requires inspection
  without a matching OQC inspection must continue to refuse the confirmation.
- **No production default changes.** The `SALES_DELIVERY` fail-safe default, the
  `OUTSOURCING_RECEIPT` default waiver (OUT-18), `resolveQualityPolicy()`, `freezeQualityPolicy()`,
  `qualityPolicyAllowsPosting()`, `deriveQualityState()` and `assertQualityGate()` are unchanged.
- **No outsourcing quality policy change.**
- No production quality-control-point default, seed, migration or schema change is introduced.

### 4. W10-QCP-R02 — The fixture establishes valid, auditable test quality-policy facts

- The Wave 10 acceptance fixture must install its quality-policy prerequisite through the **canonical
  quality-control-point writer**, not by hand-writing a policy snapshot row.
- The installed fact must be a real Quality Control Point carrying an operation type of
  `SALES_DELIVERY`, an effective-from date, an effective-to date or its absence, an active flag, a
  sampling mode, a version and a written reason.
- The fact must be **auditable**: the creation must leave a canonical audit record, and the frozen
  per-line policy snapshot must carry the Quality Control Point identity and version that produced
  it.
- The fact must be **test-scoped**: it applies to the Wave 10 acceptance fixture's own scope only and
  must not alter production defaults, other products or other operation types.
- A hand-written `logistics_quality_policy_snapshots` row that references no Quality Control Point
  (A9) is not acceptable fixture evidence.

### 5. W10-QCP-R03 — Waiver justification and evidence identity

- A waiver (inspection not required) requires a **legitimate test-only business reason** written into
  the Quality Control Point. The reason must state that the Wave 10 acceptance cases exercise the
  Sales Delivery → Finance → Credit chain and that outgoing-goods inspection is outside the subject
  of those cases. It must **not** claim that an inspection was performed or that a product passed
  inspection.
- The frozen policy snapshot produced by the canonical path must **match the actual business facts**
  of the document it belongs to: the actual Delivery header id, the actual Delivery line id, the
  actual product id, the Delivery's effective business date, and the Quality Control Point id and
  version.
- The frozen snapshot must be produced by the canonical resolution at document creation. It must not
  be produced by deleting, rewriting or hand-crafting an already frozen snapshot.
- The waiver must be reachable only through the canonical resolution order, so that a more specific
  applicable control point continues to take precedence over a broader one.

### 6. W10-QCP-R04 — M-R03 and M-R09 keep their original Finance/Credit race semantics

- **M-R03 (`R-SAL-14`)** still races the canonical Sales Invoice posting against the Credit
  evaluation and still asserts the exact OLD-or-NEW exposure with no transition double count.
- **M-R09** still races two Credit evaluations against the canonical SO → Delivery → final unpaid AR
  transition and still asserts the mandatory salesperson sub-limit refusal carrying `OVER_LIMIT` and
  not `UNPROVEN_ATTRIBUTION`.
- The quality-policy arrangement changes nothing about the Finance or Credit facts: the recognition
  mode, the invoice, the receivable, the exposure projection, the capacity classification and the
  zero-side-effect projections remain exactly as they are today.
- The Delivery confirmation must still be performed through the **real HTTP confirmation route**.
  The fixture must not bypass, stub, monkey-patch, pre-empt or otherwise intercept the production
  confirmation handler or the production quality gate.

### 7. W10-QCP-R05 — Negative test: missing OQC evidence still blocks

A deterministic, database-local regression must prove both directions against the same fixture base:

- **Negative** — with no applicable quality-policy fact, a Delivery created through the real
  production route receives a frozen policy that requires inspection, and the real confirmation route
  refuses with the **production** HTTP 409 quality-gate refusal. The refusal must be the production
  refusal produced by `assertQualityGate()`, not a test-local message or a test-local status code.
- **Positive** — with the fixture's quality-policy fact installed, a Delivery created through the
  same real production route freezes a policy snapshot that requires no inspection and records the
  control-point identity and version, and the real confirmation route succeeds.
- The negative case must fail if the production fail-safe default is weakened, and it must be
  meaningful without requiring a real MySQL campaign.

### 8. W10-QCP-R06 — No schema, migration, credential or gate-shape change

- No MySQL schema change, no migration, no DDL, no new table and no new column. The existing
  `quality_control_points`, `quality_control_criteria` and `logistics_quality_policy_snapshots`
  structures are sufficient.
- No MySQL account, grant, role or credential change. The credential exposure recorded in
  `log/2026-10-26.md` remains **OPEN** and is an operator action outside this Requirement.
- No change to the protected target, the campaign lease, the guard, the runners, the manifests, the
  case identifiers, the evidence levels or the M-board shape.

### 9. Acceptance conditions

1. Facts A1–A11 remain true in the implementation.
2. The Wave 10 acceptance fixture installs its quality-policy prerequisite through the canonical
   writer and leaves a canonical audit fact.
3. Every Delivery created by the Wave 10 acceptance suites freezes a policy snapshot that references
   the installed control point, carries its version, and matches the actual Delivery id, Delivery
   line id, product id and business date.
4. The real Delivery confirmation route succeeds in M-R03 and M-R09, and the Finance/Credit
   assertions are unchanged.
5. The negative regression proves the production fail-safe refusal, and the positive regression
   proves the waived confirmation.
6. The SQLite and MySQL paths behave identically for the fixture base.
7. The local regression (`pnpm test:fast`, `pnpm test`, `pnpm build`, `git diff --check`) passes with
   no skipped, todo, cancelled or weakened assertion.

### 10. Compatibility boundary

Unchanged: production quality-gate semantics and defaults, the outsourcing quality policy, the
quality-control-point schema and migrations, the Sales Delivery creation and confirmation handlers,
the Credit and Finance business semantics, the L0 and L1–L8 lock order, READ COMMITTED isolation,
permissions, status machines, audit and idempotency contracts, the Gate A contract and its freeze,
the Wave 9 freeze, the seven Gate B case identities and evidence levels, the package version and the
release tags.

Open and unaffected by this Requirement: the MySQL credential exposure (`CREDENTIAL_EXPOSURE_OPEN`
for operator action); real-MySQL evidence (`TEST_EVIDENCE_PENDING` until a separately authorized
campaign); `LEGACY_DATA_EVIDENCE_PENDING`; `RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN`.

**Requirement status: `WAVE10_GATE_B_OQC_FIXTURE_REQUIREMENT_COMPLETE`.**

## Wave 10 M-R09 Credit capacity contract Requirement (2026-10-26)

### 1. Authorization, scope and the audited contradiction

The user confirmed that the M-R09 acceptance contract contains a verified contradiction and explicitly
authorized one consecutive `REQUIREMENT -> DESIGN` stage for it, with a mandatory HARD STOP at the end
of Design. This section records the Requirement phase only; the Design phase may follow without an
intervening approval. Implementation, real MySQL access, Gate B re-execution, the Wave 10 Acceptance
campaign, Git writes and Wave 11 are **not** authorized by this stage.

Audited classification — `SEMANTIC_MISMATCH` in the Wave 10 acceptance **test contract**
(`server/mysql-sales-customer-wave10-concurrency.integration.js`, case `M-R09`).

**This is not a production defect.** The production Credit engine computes the capacity, the
classification and the refusal exactly as the canonical contract requires. The defect is confined to
one expectation literal inside one acceptance assertion. It was latent until the approved
quality-policy fixture remediation made that assertion reachable for the first time.

### 2. Audit facts this Requirement is bound to

Each fact was verified against the actual source at HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6`.

- **A1** — `server/mysql-sales-customer-wave10-concurrency.integration.js:521` asserts
  `capacity.classification === 'ONLY_ONE_FITS'` for M-R09.
- **A2** — `server/test-utils/wave10-mysql-acceptance-fixture.js:647-655` `classifyCapacity()`:
  `BOTH_FIT` iff `da <= available AND db <= available AND da + db <= available`; `ONLY_ONE_FITS` iff
  `da <= available AND db <= available AND da + db > available`; `NEITHER_FITS` iff
  `da > available AND db > available`.
- **A3** — this file, `W10-AIR-R05` in the section "Wave 10 MySQL Acceptance Infrastructure
  Remediation Requirement (2026-10-25)", states the identical algebra verbatim and adds the rule
  *"The expected winner count follows that computed classification."*
- **A4** — the M-R09 race is configured with `salespersonLimit: 110000`
  (`...wave10-concurrency.integration.js:494`); the fixture seeds the salesperson Profile
  `w10-profile-a` with `credit_limit_cents = 110000`
  (`...wave10-mysql-acceptance-fixture.js:478`, `seedProfile()` at `:504-514`).
- **A5** — the canonical obligation is **100000 cents**: the fixture price-list version is
  `unit_price_cents = 100000` (`...wave10-mysql-acceptance-fixture.js:459-460`) and
  `productionOrderBody()` (`...wave10-mysql-acceptance-fixture.js:546-554`) requests quantity 1.
  Both proposed deltas are **20000 cents** (`...wave10-concurrency.integration.js:518`, `:525-526`).
- **A6** — after the canonical confirmation the obligation leaves the SO-commitment stage and the
  delivered-not-settled stage and is represented exactly once by the final unpaid AR
  (`server/modules/credit-check.js:453-456` stage conservation), and that AR is provably attributable
  to the salesperson (`resolveReceivableAttribution()` → `PROVABLY_ATTRIBUTABLE`,
  `server/modules/credit-check.js:378-379`), so it is not attribution-ambiguous.
- **A7** — therefore `exposureCents = 100000`, `available = 110000 - 100000 = 10000`, and both
  proposed deltas (20000) exceed `available`. `classifyCapacity()` returns **`NEITHER_FITS`**.
- **A8** — the two M-R09 classification assertions are mutually exclusive under **every** possible
  fixture value: `:521` (`ONLY_ONE_FITS`) requires `available >= 20000`, while `:522`
  (`exposureCents + 20000 > limitCents`, algebraically `available < 20000`) requires the opposite.
  The pair can never both hold.
- **A9** — M-R09's own refusal contract (`:529-534`) requires **both** contenders to return HTTP 409
  `CREDIT_CHECK_BLOCKED` carrying `OVER_LIMIT` and **not** `UNPROVEN_ATTRIBUTION`. The expected
  winner count is therefore 0, and under `W10-AIR-R05` only `NEITHER_FITS` has an expected winner
  count of 0.
- **A10** — the approved case matrix in `solution.md` §37.39.6.2 describes M-R09 as
  *"aggregate passes; sub-limit exposure=50, proposal=70>60 and blocks"*. The case never claims a
  winner: the abstract proposal exceeds the remaining capacity and is blocked.
- **A11** — the production refusal path is consistent with the corrected classification:
  `server/modules/credit-check.js:807` computes `overLimit` from
  `exposureCents + proposedDeltaCents > limitCents`; the salesperson scope then emits `OVER_LIMIT`
  (`:835`) and, because the attribution is provable and the overdue-day policy is defined, never
  `UNPROVEN_ATTRIBUTION` (`:813-817`). `evaluateCreditCheck()` raises the 409 inside the production
  transaction (`server/modules/credit-check.js:1091-1101`), so a blocked evaluation leaves no
  persistent row.
- **A12** — the observed failure is exactly this contradiction: `actual 'NEITHER_FITS'`,
  `expected 'ONLY_ONE_FITS'` at `...wave10-concurrency.integration.js:521` (`log/2026-10-26.md`,
  "追加：Wave 10 Gate B 单次真实 MySQL 回归"). The assertions at `:519-520` passed, which independently
  confirms `exposureCents = 100000` and `available = 10000`.
- **A13** — `ONLY_ONE_FITS` is **correct** for M-R01 (`...:68`, `:182-184`), M-R05 (`:400`), M-R06
  (`:418`), `B-M10` (`server/mysql-sales-customer-wave10-gate-b.integration.js:117`) and `B-M15`
  (`:203`): each of those races starts from zero committed exposure, so `available` genuinely exceeds
  each single delta while their sum exceeds it. M-R09 is the only case in the repository whose
  committed exposure makes the remaining capacity smaller than each proposal.

### 3. W10-MR09-R01 — The canonical chain is unchanged

M-R09 continues to test the canonical approved Sales Order → confirmed Delivery → final unpaid
Accounts Receivable transition, created and confirmed through the **real production HTTP routes**.
No direct SQL substitute, no stub, no monkey-patch and no interception of the production
confirmation handler, the Credit engine or the Finance recognition writer is permitted.

### 4. W10-MR09-R02 — The salesperson exposure is represented exactly once

The obligation must appear in exactly one exposure stage. The SO-commitment stage and the
delivered-not-settled stage are released by the transition and the final unpaid AR carries the
amount. The obligation must never be counted twice, and the aggregate projection must not count it
in a different stage than the salesperson projection.

### 5. W10-MR09-R03 — Capacity comes from persisted exposure and the effective Profile

The classification must be computed from the actual persisted exposure and the effective Profile
resolved by the production resolver. A seed constant, a hardcoded classification or a copied
expected value is not proof. The limit, the exposure and each proposed delta keep their present
values: limit 110000 cents, exposure 100000 cents, both proposed deltas 20000 cents.

### 6. W10-MR09-R04 — The correct classification is `NEITHER_FITS`

Because the available capacity is 10000 cents and each proposed delta is 20000 cents, both
proposals exceed the available capacity and the correct classification is **`NEITHER_FITS`**. The
expected classification literal in the M-R09 assertion must be corrected from `ONLY_ONE_FITS` to
`NEITHER_FITS`. `ONLY_ONE_FITS` is not a weaker or softer expectation here: it is a different
business statement — that exactly one contender may proceed — and M-R09's own refusal contract
requires that **neither** proceeds.

### 7. W10-MR09-R05 — Both concurrent checks return 409 `CREDIT_CHECK_BLOCKED` with `OVER_LIMIT`

Both coordinated contenders must be refused with the production HTTP 409 contract, the
`CREDIT_CHECK_BLOCKED` code and the `OVER_LIMIT` reason code. The refusal must remain the existing
production refusal contract and must not be replaced by a test-local status, code or message.

### 8. W10-MR09-R06 — The refusal must not be attributed to `UNPROVEN_ATTRIBUTION`

The AR must remain provably attributable to the salesperson. The refusal reason must be the
capacity failure `OVER_LIMIT` and must never be the attribution failure `UNPROVEN_ATTRIBUTION`.
M-R09 remains the contrast case to M-R10, which deliberately constructs an attribution-ambiguous AR.

### 9. W10-MR09-R07 — No unauthorized persistent side effect

The blocked evaluations must leave zero forbidden persistent delta across the declared projection
families: no economic row, no audit row, no idempotency record, no duplicate credit check result
group and no duplicate Special Approval authority. The forbidden-delta assertion and the
duplicate-effect assertion are preserved in full.

### 10. W10-MR09-R08 — No production, schema or migration change

No production Credit, Finance, Sales, quality-gate or HTTP code changes. No MySQL schema change, no
migration, no DDL, no new table and no new column. No change to the protected target, the campaign
lease, the guard, the runners, the manifests, the case identifiers, the evidence levels or the
M-board shape. No account, grant, role or credential change. The canonical HTTP, Finance and Credit
business contracts remain unchanged.

### 11. W10-MR09-R09 — Other cases are untouched

`ONLY_ONE_FITS` remains the correct classification for M-R01, M-R05, M-R06, `B-M10` and `B-M15`, and
those cases are not modified in any way. Only the M-R09 expectation literal changes.

### 12. W10-MR09-R10 — No test weakening

No assertion is deleted, relaxed, skipped, mocked or replaced by a hardcoded PASS. The correction is
a factual correction of one expected classification value, and the available-capacity precondition
it depends on may be made explicit.

### 13. Acceptance conditions

1. Facts A1–A13 remain true in the implementation.
2. The M-R09 classification expectation equals `NEITHER_FITS` and is derived from the computed
   capacity, never from a constant.
3. The limit, the exposure, the available capacity and both proposed deltas keep their present
   values, and the exposure conservation assertion is preserved.
4. Both concurrent requests are preserved and still expect HTTP 409 `CREDIT_CHECK_BLOCKED` with
   `OVER_LIMIT` and without `UNPROVEN_ATTRIBUTION`.
5. The forbidden-delta and duplicate-effect assertions are preserved.
6. M-R01, M-R05, M-R06, `B-M10` and `B-M15` are byte-for-byte unchanged.
7. No production file, schema, migration, runner, manifest, package file or release tag changes.
8. The local regression (`pnpm test:fast`, `pnpm test`, `pnpm build`, `git diff --check`) passes with
   no skipped, todo, cancelled or weakened assertion.

### 14. Compatibility boundary

Unchanged: the production Credit engine, the capacity classification algebra, the exposure
projection, the production refusal contract, the Finance recognition writers, the canonical HTTP
routes, the L0 and L1–L8 lock order, READ COMMITTED isolation, permissions, status machines, audit
and idempotency contracts, the Wave 9 freeze, the Gate A freeze, the Gate B case identities and
evidence levels, the M-board shape, the package version and the release tags.

Open and unaffected by this Requirement: the MySQL credential exposure (`CREDENTIAL_EXPOSURE_OPEN`,
operator action); the real-MySQL evidence for M-R09 (`TEST_EVIDENCE_PENDING` until a separately
authorized campaign); `LEGACY_DATA_EVIDENCE_PENDING`;
`RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN`;
`WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN`.

**Requirement status: `WAVE10_MR09_CONTRACT_REQUIREMENT_COMPLETE`.**

## Wave 10 CHECK clause parity normalization Requirement (2026-10-26)

### 1. Authorization, scope and the audited gap

The user confirmed that the Wave 10 Full Acceptance campaign exposed the gap
`WAVE10_PARITY_CHECK_CLAUSE_ESCAPE_NORMALIZATION_ABSENT`, and explicitly authorized one consecutive
`AUDIT / COVERAGE CONFIRMATION -> REQUIREMENT -> DESIGN` stage, with a mandatory HARD STOP at the end
of Design. This section records the Requirement phase only; the Design phase may follow without an
intervening approval. Implementation, real MySQL access, any Gate or Acceptance re-run, Git writes,
credential operations and Wave 11 are **not** authorized by this stage.

Audited classification — `SEMANTIC_MISMATCH` in the Wave 10 acceptance **test contract**
(`server/test-utils/wave10-mysql-schema-fixture.js`), surfaced by the live protected campaign as the
`M-MIG-01` and `M-MIG-02` check-constraint parity failures.

**This is not a production defect on the evidence available.** The production CHECK definitions, the
DDL generation path, the migration set and the business code are unchanged and are out of scope. The
defect is confined to the parity fixture's ability to *read* MySQL's rendering of a CHECK constraint.
Whether the live server's stored constraint is semantically identical to the SQLite source is **not**
asserted by this Requirement; see A18 and `W10-PARITY-CHECK-R09`.

### 2. Audit facts this Requirement is bound to

Every fact was verified against the actual source at HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6`
or against the preserved campaign transcript. No MySQL connection was made in this stage.

- **A1** — the two real failing assertions are `server/mysql-sales-customer-wave10.integration.js:117`
  (`M-MIG-01`, message `credit_check_results: check-constraint parity`) and
  `server/test-utils/wave10-mysql-schema-fixture.js:410` (`M-MIG-02`, message
  `credit_lock_anchors: check-constraint parity`). Both compare the MySQL-side `checks` array with the
  SQLite-side `checks` array with `assert.deepEqual`.
- **A2** — the clause text that reached the normalizer on the MySQL side contained a **literal
  backslash character immediately before every string literal's closing and opening single quotes**,
  for example `(decision in (\'pass\',\'warning\',\'block\',\'special_approval_required\'))`. This is
  read from the preserved campaign transcript byte-for-byte: the transcript stores `\\'`, which is
  node's `util.inspect` encoding of one literal backslash followed by one quote, not a display-only
  escape. The same form appears for `scope_type`, `anchor_type` and the `credit_lock_anchors`
  anchor disjunction.
- **A3** — the backslash was **not** introduced by the repository's transport. The worker response
  path is `JSON.stringify` → UTF-8 → `SharedArrayBuffer` → `JSON.parse`
  (`server/database/mysql-worker-protocol.js:41` and `:29`), which is lossless for backslashes: a
  backslash inside a string value is escaped on the way out and restored byte-identically on the way
  in. The value that reached `normalizeCheckClause()` is therefore byte-identical to the value
  `mysql2` delivered, and that value is byte-identical to what the server returned.
- **A4** — the backslash was **not** present in the SQL that created the constraints. The canonical
  SQLite DDL and the canonical live MySQL DDL of the affected tables use plain quoted literals
  (`server/migrations/sales-customer-wave9-credit-foundation.js:32,55,64-67,88,98,104,118,125,151-152,160,169-172,184-185`;
  `server/migrations/sales-customer-wave10-credit-check.js:43,55,62,68,78,82,88-91,109-111,133-138`),
  and the generic MySQL bootstrap emits the SQLite CHECK body verbatim
  (`server/database/mysql-schema.js:204`).
- **A5** — the SQLite side, read from that **same** DDL text, parsed successfully: its canonical forms
  appear in the failure diff. This independently confirms the source text carries no backslash, so the
  divergence is created between the DDL and the server's metadata rendering, not in the source.
- **A6** — `tokenizeCheckClause()` has **no** backslash branch. A `\` reaches
  `throw new CheckClauseSyntaxError('unsupported token ' + char)`
  (`server/test-utils/wave10-mysql-schema-fixture.js:111`).
- **A7** — `normalizeCheckClause()` catches only `CheckClauseSyntaxError` and returns
  `` `raw: ${text.toLowerCase()}` `` (`:283-285`). A `raw:` form can never equal a parsed canonical
  form, so the two sides are incomparable whenever the MySQL side falls back.
- **A8** — the observation matches the mechanism exactly: the only MySQL-side clause that compared
  equal (`sales_order_id is not null or sales_delivery_id is not null`) contains **no** string
  literal, and every clause that contains one produced a `raw:` form.
- **A9** — the tokenizer's present capabilities are: `'...'` with the SQL-standard doubled-quote
  escape (`''` → `'`), `"..."` and `` `...` `` with doubled delimiters, numeric literals, identifiers,
  the `<` `=` `>` `!` operators (with `!=` normalised to `<>`), and the `()` `,` punctuation
  (`:56-114`). It does **not** support backslash escapes, `N'..'` / `X'..'` / `B'..'` literal
  prefixes, `BETWEEN`, `LIKE`, `IS TRUE` / `IS FALSE`, or arithmetic operators. An unterminated string
  literal currently runs to the end of the text instead of failing.
- **A10** — `normalizeCheckClause()` strips backticks, charset introducers (`_utf8mb4`, `_utf8`,
  `_binary`) and collapses whitespace **before** tokenizing (`:271-275`). The absence of `_utf8mb4`
  from the captured `raw:` text therefore does **not** prove that the live text lacked it.
- **A11** — the repository never sets `sql_mode`: there is no `SET sql_mode` anywhere under `server/`.
  The worker sets only `time_zone`, `SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED` and
  `innodb_lock_wait_timeout` (`server/database/mysql-worker.js:106-108`), so the session inherits the
  server default sql_mode, in which MySQL 8 does **not** include `NO_BACKSLASH_ESCAPES`.
- **A12** — the eight compared tables and their approved CHECK cardinality, which the migrations
  themselves assert on both engines
  (`server/sales-customer-wave10-mysql-parity.test.js:40-49`): `credit_lock_anchors` 2,
  `credit_parameters` 2, `credit_check_rules` 5, `credit_profile` 3, `credit_policy_snapshots` 1,
  `credit_profile_ratings` 3, `credit_check_results` 3, `credit_special_approval` 4 — **23 CHECK
  constraints** in total. Every one of the eight tables carries at least one string-literal CHECK, so
  every table is affected by this gap.
- **A13** — the case-insensitive literal comparison is sound for these eight tables. The only
  case-sensitive columns in the schema (`from_position_key`, `to_position_key`, `request_fingerprint`
  → `ascii_bin`; `from_position_identity_json`, `to_position_identity_json` → `utf8mb4_bin`;
  `lot_code_key` → `utf8mb4_0900_bin`, `server/database/mysql-schema.js:217-225`) appear in **none**
  of the eight credit tables, and all eight are created with the default `utf8mb4_0900_ai_ci`
  (`server/database/mysql-schema.js:205`).
- **A14** — the `raw:` fallback is fail-closed across the parsed/raw boundary (A7) and, between two
  `raw:` forms, equates only byte-identical lowercased texts. Its residual coarseness is the
  case-insensitive and whitespace-only collapse, which A13 bounds to these eight tables. It also
  **discards the parse reason**, so an unsupported-syntax fallback is currently indistinguishable
  from an escaped-literal fallback.
- **A15** — the existing local regression `server/sales-customer-wave10-mysql-parity.test.js` is
  **source-text only**: it reads the two migration sources and never opens a database (`:35-36`,
  `:113-126`). Its "MySQL rendering" samples (`:128-144`) are hand-written models whose string
  literals carry **plain** quotes. No local case covers a backslash-escaped literal, the `raw:`
  branch, or an unterminated literal, which is why the local gate stayed green while the live
  campaign failed.
- **A16** — the parity suite has **never** been green. On 2026-10-25 the live parity suite ran with
  4 pass / 3 fail (`M-MIG-01`, `M-MIG-02`, `M-MIG-06`); `M-MIG-06` was subsequently fixed, and
  `M-MIG-01` / `M-MIG-02` now fail only on the escaped-literal rendering.
- **A17** — the live rendering matches the hand-written model in every respect except the literal
  quoting: the live text wraps the clause in one parenthesis and parenthesises each `AND` / `OR`
  operand, exactly as modelled at `server/sales-customer-wave10-mysql-parity.test.js:138-139`. Only
  the string-literal quoting diverges, which is the narrowest possible characterisation of the gap.
- **A18** — the **semantic** question is bounded but not closed. The constraint was created from
  plain-quoted DDL (A4) under a session that did not disable backslash escapes (A11), so the
  *enforced* constraint holds the literal values `PASS`, `WARNING`, `BLOCK`,
  `SPECIAL_APPROVAL_REQUIRED` and is the same constraint the SQLite source declares. That is a
  conclusion drawn from the DDL and the session configuration, **not** a live observation: the live
  `SHOW CREATE TABLE` rendering and the effective `@@session.sql_mode` could not be read in this
  stage because no MySQL access is authorized. The canonical DDL's plain quoted literals are
  mode-independent — `'PASS'` denotes `PASS` whether or not `NO_BACKSLASH_ESCAPES` is set — so the
  *enforced* constraint is unambiguous under either mode. What remains unproven is the **rendering
  convention** the server uses when it re-prints that constraint into
  `information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE`, and whether the observed convention is stable.
  The equivalence is therefore **conditional on the observed rendering** and must be established
  against a live capture, not assumed.

### 3. W10-PARITY-CHECK-R01 — One canonical form for semantically equivalent CHECK expressions

Two CHECK expressions that denote the same constraint must normalize to one canonical form,
independently of the backend that rendered them. The canonical form is produced by parsing the
expression into its tree and re-rendering it; it must not depend on the incidental shape of the
source text (redundant parentheses, operator spacing, quoting style, identifier quoting, charset
introducers). This applies to the SQLite source side and the MySQL target side of the same
constraint.

### 4. W10-PARITY-CHECK-R02 — The MySQL escaped-literal rendering is recognised, not guessed

The rendering confirmed in A2 — a string literal whose quotes are backslash-escaped — must be
recognised as a *representation* of a string literal and decoded to the literal's semantic value. The
decoder must be restricted to the escape sequences the server actually defines; it must not remove
backslashes, must not remove or add quotes, and must not apply to any byte outside a string literal.
A backslash that appears outside a string literal remains an unsupported token and remains
fail-closed.

### 5. W10-PARITY-CHECK-R03 — The canonical form must not alter the constraint

Column names, comparison operators, `AND` / `OR` / `NOT` structure and precedence, `IN` member sets
and their values, and `IS [NOT] NULL` predicates must survive normalization unchanged. The canonical
form may differ from the source text only in the representational dimensions listed in R01. No
operator, operand, member or value may be added, dropped, reordered or rewritten.

### 6. W10-PARITY-CHECK-R04 — Genuinely different constraints must stay different

Two CHECK expressions that denote different constraints must never normalize to the same canonical
form. This covers at minimum: a different comparison operator; a different operand; a different
column; a different `IN` member set; a different literal value; `AND` against `OR`; `NOT` against
its operand; and the presence against the absence of a `NULL` predicate. A literal whose semantic
value differs between the two backends — including a value that differs only by an escape sequence —
must be classified as different, not as equivalent.

### 7. W10-PARITY-CHECK-R05 — Unsupported or incomplete expressions fail closed

A CHECK expression that cannot be parsed completely — an unsupported token, an unsupported escape, an
unterminated string literal, a truncated expression, trailing tokens after a complete parse, or an
empty expression — must not be treated as equivalent to anything. It must produce a form that is
distinct from every parsed canonical form, and it must be **diagnosable**: the reason for the
fallback must be retained and surfaced, so that an unsupported-syntax fallback can never be confused
with a representational fallback. The existing distinct `raw:` prefix is retained as that
distinguishing marker; the fallback is **not** removed.

### 8. W10-PARITY-CHECK-R06 — No passing by weakening the contract

The remediation must not be achieved by removing or skipping any CHECK assertion, by ignoring or
loosening the approved CHECK cardinality, by skipping or filtering any test, by weakening the
`M-MIG-01` / `M-MIG-02` comparison, by permanently disabling the `raw:` fallback, or by hard-coding
any table name, column name or literal. The approved CHECK counts of the eight tables (A12) remain
the counts the migrations themselves assert on both engines.

### 9. W10-PARITY-CHECK-R07 — M-MIG-01 and M-MIG-02 keep their full structure

`M-MIG-01` and `M-MIG-02` keep their current scope, their real-database validation and their
comparison contract: a fresh production bootstrap and the canonical SQLite source compared against
the live MySQL `information_schema` metadata, with complete column, foreign-key, CHECK and index
parity. The remediation changes only how a CHECK clause is read and normalized; it does not weaken,
replace or bypass the live comparison, and it does not replace the live check with a source-text
comparison.

### 10. W10-PARITY-CHECK-R08 — No production change

No production CHECK definition, DDL, migration, business code, credit or finance implementation,
schema object, permission, state machine, audit or idempotency contract is modified. The
`server/migrations/**`, `server/database/**`, `server/app.js`, `server/modules/**` and the Gate
runner / manifest files are out of scope.

### 11. W10-PARITY-CHECK-R09 — The escape dialect follows input provenance, and the mode is observed

The literal dialect is derived from **where the text came from**, never guessed from its byte
content:

- text read from the canonical SQLite DDL source is decoded in the SQL-standard dialect, in which
  only `''` denotes a literal quote and a backslash is an ordinary character;
- text read from the MySQL catalog rendering is decoded in the MySQL rendering dialect, in which the
  server's own escape convention applies.

`sql_mode` governs how the server **parses input DDL**, not how it re-prints a stored expression.
The canonical DDL uses plain quoted literals, which denote the same value under every mode including
`NO_BACKSLASH_ESCAPES`, so the enforced constraint is mode-independent (A18). The rendering
convention, however, is a server behaviour that is neither documented in this repository nor
observed in this stage, so it must be **observed**: the live comparison must record the effective
`@@session.sql_mode`, the server version and the captured rendering bytes, and a rendering that
cannot be decoded under the declared dialect must fail closed with a named diagnostic instead of
being forced into a canonical form.

The repository's own DDL and session configuration are unchanged by this Requirement; the mode is
read from the live session that the acceptance campaign already uses.

### 12. W10-PARITY-CHECK-R10 — The rendering contract is captured, not modelled

The MySQL rendering that the fixture must read must be **captured from a live server** and recorded
as evidence, not hand-modelled. A hand-written model of the server's rendering is what produced the
current gap (A15, A17). The captured form, the observed `sql_mode`, the server version and the
capture date must be recorded, and the local regression must be built on the captured bytes.

### 13. Acceptance conditions

1. A captured live MySQL CHECK rendering and the corresponding canonical SQLite CHECK source
   normalize to one identical canonical form, with the literal values preserved.
2. The eight approved CHECK counts (A12) are asserted unchanged, per table.
3. Every pair of genuinely different constraints listed in R04 still normalizes to two different
   canonical forms.
4. Unsupported, incomplete, unterminated and malformed inputs fail closed with a retained, inspectable
   reason, and never compare equal to a parsed canonical form.
5. The effective `sql_mode`, the server version and the captured rendering bytes are recorded during
   the live comparison; the literal dialect is selected from the input's provenance, and a rendering
   that cannot be decoded under that dialect fails closed with a named diagnostic (R09).
6. The existing local CHECK normalizer regressions and the existing SQLite/MySQL physical parity,
   index, foreign-key and column-type contracts are unchanged and still pass.
7. No production file, migration, schema object, fixture of the OQC remediation, `M-R09` assertion,
   Finance / Credit production implementation, Gate runner or manifest is modified.

### 14. Error handling, compatibility and rollback boundary

- **Error handling.** A parse failure is never an equivalence. The fallback form stays distinct from
  every parsed canonical form and carries a retained reason. A `sql_mode` that disables backslash
  escapes is reported as a distinct, named condition rather than silently changing the outcome.
- **Compatibility.** The canonical form, the comparison order and the CHECK counts are unchanged for
  every constraint that already normalizes today; no currently passing comparison may change its
  result. The eight credit tables, their migrations, the Gate B identity set, the Gate A freeze, the
  Wave 9 freeze and the M-board shape are unaffected.
- **Rollback.** The change is confined to the acceptance test contract in one fixture file and one
  local regression file. A plain revert restores the previous state; no schema, migration, data,
  external system or persistent state is involved, so there is no database-side rollback and no
  partially applied state to reconcile.
- **Not authorized here.** Implementation, live MySQL access, any Gate or Acceptance re-run, Git
  writes and credential operations remain outside this Requirement.

### 15. OPEN facts

```text
OPEN  the live MySQL CHECK_CLAUSE rendering and the effective session sql_mode
OPEN  the live M-MIG-01 / M-MIG-02 result after the remediation
OPEN  W10-RACES and W10-BUSINESS-MATRIX live results (both suites did not run)
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
```

**Requirement status: `WAVE10_PARITY_CHECK_NORMALIZATION_REQUIREMENT_COMPLETE`.**

## Wave 10 Full Acceptance blocker Requirement (2026-10-27)

### 1. Authorization, scope and the audited gap

The user authorized the AGENTS.md §4 Requirement stage for the remaining Wave 10 Full Acceptance blocker and
the `M-BIZ-19` `no-rule` fixture problem. This section records the Requirement phase only. The Design phase
is **not** authorized and has not been started. No implementation, no test run, no MySQL connection, no
schema or fixture change, and no Git write operation is authorized by this stage.

Audited classification — `SEMANTIC_MISMATCH` in the Wave 10 acceptance **test contract**
(`server/mysql-sales-customer-wave10-business-matrix.integration.js`), exposed as
`WAVE10_MATRIX_M_BIZ_19_NO_RULE_VARIANT_FK_BLOCKED` by the read-only preflight audit of 2026-10-26.

**This is not a production defect.** No production Credit, Finance, Quality or Sales behaviour, no
schema, no migration and no constraint definition is in scope. The defect is confined to how one
acceptance case prepares its own test data.

### 2. Audit coverage and method

The audit covered all 39 top-level cases of the three protected suites against the current source:
`W10-PARITY` (7), `W10-RACES` (12) and `W10-BUSINESS-MATRIX` (20, including the independent database
lifecycles inside `M-BIZ-19` and `M-BIZ-20`). Every raw DML statement in the three suites and in the
shared acceptance fixture was enumerated and checked against the canonical schema contracts; every
capacity and exposure expectation was recomputed from the fixture constants and the production engine
algebra. No MySQL connection, no test execution and no database query was performed in this stage.

### 3. Verified facts this Requirement is bound to

- **A1** — the protected suite has three suites and 39 top-level cases:
  `scripts/gates/mysql-sales-wave10-manifest.mjs:4-8`; the acceptance runner is
  `scripts/gates/mysql-sales-wave10-acceptance.mjs` and the shared runner support is
  `scripts/gates/mysql-wave10-runner-support.mjs`.
- **A2** — `W10-PARITY` and `W10-RACES` have real-MySQL evidence: `M-MIG-03/M-MIG-05`, `M-MIG-04`,
  `M-MIG-06`, `M-MIG-07`, `M-MIG-08` passed in the 2026-10-26 campaign, and all twelve `M-R01`..`M-R12`
  passed in the `WAVE10_GATE_B_PASS` campaign.
- **A3** — that Gate B evidence still corresponds to the current worktree: the Gate B transcript
  (`%TEMP%\w10gateb\gateb-run.txt`) was written at `2026-10-26 22:35:54`, which is **after** the last
  modification of `server/mysql-sales-customer-wave10-concurrency.integration.js` (`21:52:47`) and of
  `server/test-utils/wave10-mysql-acceptance-fixture.js` (`20:14:42`). The two files the Gate B races
  suite exercises are unchanged since that evidence was produced.
- **A4** — `W10-BUSINESS-MATRIX` has **no** real-MySQL evidence. Both campaigns executed to date aborted
  in suite 1, so all twenty cases are `TEST_EVIDENCE_PENDING`.
- **A5** — `W10-BUSINESS-MATRIX` contains exactly 20 top-level cases with no `describe`, no `it`, no
  `test.skip`, no `test.todo`, no `test.only`, no conditional registration and no per-case hook. The only
  module-level gate is the environment check at `:38-39`, which throws at import time and therefore
  aborts the whole file rather than skipping individual cases.
- **A6** — every case builds its own schema through `withMatrix()`
  (`server/mysql-sales-customer-wave10-business-matrix.integration.js:67-74`), which calls
  `createTempDb(wave10MysqlTempOptions(label))`; `wave10MysqlTempOptions()`
  (`server/test-utils/wave10-mysql-acceptance-fixture.js:47-49`) binds every lifecycle to
  `createWave10MysqlLifecycle()`, so each lifecycle re-verifies the protected target identity under the
  campaign lease. `M-BIZ-19` runs two lifecycles and `M-BIZ-20` runs three, so the suite performs
  **23** complete schema rebuilds; each ends in `handle.cleanup()` in a `finally` block.
- **A7** — the fixture always creates the aggregate Credit Profile and binds it to the fixture rule:
  `server/test-utils/wave10-mysql-acceptance-fixture.js:477` calls `seedProfile(...)`, and `:512` writes
  `rule_id = 'w10-race-rule'` into that row. The referenced rule row is created at `:474-476`.
- **A8** — the canonical schema declares the corresponding foreign key without a delete action:
  `server/migrations/sales-customer-wave9-credit-foundation.js:93` declares
  `rule_id TEXT REFERENCES credit_check_rules(id)` and `:218` lists the pair
  `['rule_id','credit_check_rules']` without `on_delete`. Generating the actual canonical snapshot yields
  `on_delete: 'NO ACTION'`, so `server/database/mysql-schema.js:202` emits
  `FOREIGN KEY (rule_id) REFERENCES credit_check_rules (id) ON UPDATE NO ACTION ON DELETE NO ACTION`,
  executed with `ENGINE=InnoDB` at `:314`.
- **A9** — the protected session enforces foreign keys: `@@session.foreign_key_checks = 1` and
  `@@global.foreign_key_checks = 1` were observed on the dedicated account.
- **A10** — the failing statement is
  `server/mysql-sales-customer-wave10-business-matrix.integration.js:426`
  `db.prepare("DELETE FROM credit_check_rules WHERE id='w10-race-rule'").run();`, executed in the
  `no-rule` variant of `M-BIZ-19` (`:421-433`), outside the check's transaction and therefore in
  autocommit.
- **A11** — the engine's rule selection is over **effective** rules, not over existing rows:
  `server/modules/credit-check.js:508-511` selects `credit_check_rules` by
  `business_stage = ? AND status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR
  effective_to>=?)`; `:513-516` then filters by recognition mode; `:666-675` returns
  `{ enforced:false, decision:'PASS', checkGroupId:null, scopeResults:[],
  reasonCodes:['NO_APPLICABLE_EFFECTIVE_RULE'] }` when nothing remains.
- **A12** — the `no-rule` variant's own assertions are `:429`
  (`enforced === false`, `decision === 'PASS'`) and `:430` (the persistence projection is unchanged).
  They are consistent with the engine contract in A11.
- **A13** — the `disabled` variant (`:425`) flips `credit_parameters.value_bool` to `0` and exercises the
  separate early return `CREDIT_MANAGEMENT_DISABLED`; it is not affected by the foreign key.
- **A14** — `M-BIZ-18` (`:410-419`) is the *other-mode-only* path: an effective rule exists for the stage
  but its `recognition_mode` does not match the requested mode, so the mode filter empties the
  applicable set and the engine returns the same `NO_APPLICABLE_EFFECTIVE_RULE` outcome. The two cases
  therefore differ in their **business fact**, not in the engine's return value.
- **A15** — every other raw DML statement in the suite satisfies the canonical schema:
  `:219` (no-op on `effective_from`, see A16), `:241` (`status='SUSPENDED'` is allowed by the
  `credit_profile` status CHECK, and `w10-profile-a` exists because `M-BIZ-04` passes
  `salespersonLimit: 50000`), `:256` and `:297` (no CHECK on the affected columns), `:383` (the
  `sales_invoices` insert satisfies the NOT NULL, UNIQUE, CHECK and FK contracts, and every column added
  later by `v22-finance-wave-c-invoice.js:45-51` is nullable or carries a default), `:404` and `:413`
  (`recognition_mode` carries no CHECK), `:425`, `:438` (the second rule satisfies the
  `credit_check_rules` CHECKs and the `(rule_code, effective_from)` uniqueness), and `:450` (child rows
  are deleted before their parent).
- **A16** — `M-BIZ-03`'s `:219` update writes `effective_from='2026-01-01'`, which the fixture already
  wrote, so it is a no-op; and no historical ACTIVE Profile version is ever seeded, so the premise
  "does not fall back to a historical ACTIVE" is not exercised by that case. It is a **coverage gap**,
  not a failure: the case still passes as a CLOSED fail-closed check.
- **A17** — the runner's terminal behaviour is confirmed by source and by the 2026-10-26 campaign: a
  non-zero suite exit raises `WAVE10_MYSQL_SUITE_FAILED` (`mysql-wave10-runner-support.mjs:188-193`),
  the `finally` block still performs the final protected reset and asserts the zero inventory
  (`:202-213`), the lease is released (`:216-219`), and the campaign transcript of the failed run
  contains `FINAL ZERO OBJECTS = {"tables":0,"views":0,"triggers":0,"routines":0,"events":0}`.
- **A18** — the eight compared Credit tables keep 23 approved CHECK constraints
  (`2/2/5/3/1/3/3/4`), and **none** of them carries a numeric literal, so the known numeric-versus-string
  literal rendering boundary does not affect the approved set.

### 4. W10-ACC-R01 — The `no-rule` variant must express "no applicable effective rule"

The `no-rule` variant of `M-BIZ-19` must establish the business fact that **a Credit Check for this
stage and this business date has no applicable effective rule**. The engine's contract (A11) is that
such a stage carries no Credit control at all. The fixture data must establish that fact as a **state
of the rule set**, and it must establish it in a way that can actually be created.

The current setup expresses the absence by deleting the rule row, which is rejected by the database
before the case can reach its own assertions (A7, A8, A9, A10). That is a setup defect, not a business
statement.

### 5. W10-ACC-R02 — The referential contract must not be broken

The fixture data must not remove, orphan or re-point a row that another row references. Specifically:

- no row referenced by `credit_profile.rule_id` may be deleted while the reference exists;
- the foreign key `credit_profile.rule_id -> credit_check_rules(id)` and its `ON DELETE NO ACTION`
  behaviour must remain exactly as the canonical schema declares it;
- the fix must not be achieved by dropping the foreign key from the migration, by deleting or nulling the
  referencing Profile, by disabling foreign-key enforcement for the session
  (`SET FOREIGN_KEY_CHECKS = 0`), or by any other means that would let a real referential violation
  pass unnoticed.

### 6. W10-ACC-R03 — The rule fact stays real, dated and auditable

A rule is a versioned, dated, status-bearing business object, and the engine selects over **effective**
rules (A11). The absence of an applicable effective rule must therefore be expressed by the rule set
not offering one **for this stage on this business date** — never by the rule fact not existing. The
fixture data must keep the rule a real, persisted, auditable row with its declared business attributes.

### 7. W10-ACC-R04 — The three unenforced paths stay distinct

The suite must keep three distinguishable business facts apart, each with its own fixture state and its
own case identity:

1. **credit management disabled** — the `M-BIZ-19` `disabled` variant: the switch is off, the engine
   returns the `CREDIT_MANAGEMENT_DISABLED` early return;
2. **no applicable effective rule** — the `M-BIZ-19` `no-rule` variant: the stage has no effective rule
   on this business date;
3. **rule effective for the stage but not for the requested recognition mode** — `M-BIZ-18`: a rule
   exists and is effective for the stage, and the mode filter empties the applicable set.

Facts 2 and 3 share the engine's return value (A14); their distinctness is carried by the fixture state
and by the case identity, and each case must keep naming the fact it actually establishes. A correction
must not collapse facts 1 and 2 into one, and must not make fact 2 indistinguishable from fact 3 in the
fixture.

### 8. W10-ACC-R05 — The observable contract of the case is unchanged

The corrected variant must keep the assertions the case exists to make (A12): the evaluation is **not
enforced**, the decision is **PASS**, and the persistence projection is **unchanged** — no
`credit_check_results` row, no `credit_policy_snapshots` row, no audit row, no idempotency record and no
change to any other projected fact. A variant that reaches these assertions by weakening them, by
skipping them or by turning them into a non-failure does not satisfy this Requirement.

### 9. W10-ACC-R06 — No production change

No production Credit, Finance, Quality or Sales code, no schema, no migration, no constraint definition,
no foreign key, no permission, no state machine and no audit or idempotency contract is modified. The
correction is confined to the acceptance test contract.

### 10. W10-ACC-R07 — No weakening of the suite

The correction must not remove, skip, condition or reclassify any of the 39 protected cases; must not
change the suite manifest, the case identifiers, the evidence levels or the M-board shape; must not
change the `M-MIG-01` / `M-MIG-02` live comparison contract; must not change the `M-R09` assertion; and
must not change the shared acceptance fixture's OQC quality-policy installation, which the eight
delivery-creating business-matrix cases depend on.

### 11. W10-ACC-R08 — The corrected fixture data is covered by an engine-neutral local regression

The corrected `no-rule` fixture state must be provable without a live MySQL server, so that the next
failure of this class is caught by the local gate rather than by a protected campaign. The local
regression must assert, at minimum:

1. the corrected fixture state produces the engine's non-enforced outcome (`enforced === false`,
   `decision === 'PASS'`, reason code `NO_APPLICABLE_EFFECTIVE_RULE`) and writes no evidence;
2. the `disabled`, `no-rule` and `other-mode-only` states remain three distinguishable fixture states;
3. the referential contract holds in the corrected state — the Profile's `rule_id` still resolves to an
   existing rule row, and no statement in the corrected setup deletes or orphans a referenced row;
4. the approved CHECK cardinality of the eight tables and the existing parity, index, foreign-key and
   physical-type contracts are unchanged.

### 12. Audit result classification

**CONFIRMED_BLOCKER — three.** CB-2 and CB-3 are calendar-gated: they are confirmed defects of the
acceptance test contract that do **not** block a campaign run on 2026-10-27 but do block any campaign
run on or after the dates stated. They are derived in §17.7 and carry their own Requirements (§17.8).

| # | Subject | Evidence | Impact |
|---|---|---|---|
| CB-1 | `M-BIZ-19` `no-rule` variant | A7, A8, A9, A10, A19–A22 | the variant's setup statement is rejected by the database; the case fails before its assertions; `W10-BUSINESS-MATRIX` fails and the campaign aborts at suite 3 |
| CB-2 | `M-R02` hard-coded approval expiry `'2026-12-31'` | §17.7, `server/mysql-sales-customer-wave10-concurrency.integration.js:292,296` and `server/modules/credit-special-approval.js:169-174` | on or after **2027-01-01** the approval request is refused with `CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST` before the race starts; `W10-RACES` fails and the campaign aborts at suite 2 |
| CB-3 | `M-R08` salesperson-scope Profile predecessor is never closed | §17.7, `wave10-mysql-acceptance-fixture.js:506` vs `server/modules/credit-anchor.js:18-23`, `server/modules/credit-profile.js:124-136` and `:47-54` | on or after **2026-12-31** two salesperson Profiles qualify, the resolver raises `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS`, no evidence is written and `M-R08` fails — order-dependent, roughly a coin flip |

**COVERAGE_GAP — four. None is a failure; none is converted into a Requirement here.**

| # | Subject | Evidence | Note |
|---|---|---|---|
| CG-1 | `M-BIZ-03` "does not fall back to a historical ACTIVE" | A16 | the setup update is a no-op and no historical ACTIVE version exists, so the stated premise is not exercised; the case still passes as a CLOSED fail-closed check |
| CG-2 | `M-BIZ-08` "overdue AR" | A15, and `credit-check.js:236-245` reads no `due_date` filter | the `due_date` update does not influence the exposure read, so the "overdue" premise is not exercised by the asserted outcome; the case still passes |
| CG-6 | `M-R02` "exactly one effective authority" | §17.7, `server/mysql-sales-customer-wave10-concurrency.integration.js:312` | the assertion is a disjunction, and when the special decision wins the gate both predicates hold at once, so the stated invariant is not proven |
| CG-7 | `M-R04` Profile-identity assertion | §17.7, `server/mysql-sales-customer-wave10-concurrency.integration.js:389` | the candidate list is built from the same table the assertion reads, so it can only fail on a deleted Profile, never on a wrong identity |

**UNVERIFIED_RISK — six. Each is recorded with its trigger; none is asserted to be a defect.**

| # | Subject | Trigger | Why it is not a confirmed blocker |
|---|---|---|---|
| UR-1 | `M-BIZ-06` exposure window across a UTC midnight | `wave10BusinessDate()` is read at fixture time, `reviewed_at` is written at approve time; a midnight crossing makes `reviewed_at > businessDate` and drops the order from the exposure read | the fixture already derives the business date from the run date and documents this hazard in `wave10-mysql-acceptance-fixture.js:25-33`; it is a narrow, calendar-bound race, not a contradiction |
| UR-2 | `M-BIZ-12` `sales_delivery_no` collision | `app.js:5650` derives `'SD' + Date.now().toString().slice(-10)` and `server/db.js:661` declares `delivery_no TEXT NOT NULL UNIQUE`; two deliveries in the same millisecond would collide | the two deliveries are separated by a full HTTP create-and-confirm round trip including a scrypt login, so the probability is negligible; the column is unique, so the failure would be loud |
| UR-3 | `M-BIZ-04` Profile anchor key | the fixture writes `SCOPE:w10-race-sp-a` (`wave10-mysql-acceptance-fixture.js:506`) while the production anchor builder computes `SCOPE:SALESPERSON|w10-race-sp-a` | the keys differ, so a second anchor row is inserted; `credit_lock_anchors` is outside the persistence projection, so the asserted projections are unaffected. See CB-3 for the calendar-gated consequence of the same divergence |
| UR-4 | hard-coded date literals | `M-BIZ-05` `:256`, `M-BIZ-08` `:297`, `M-BIZ-15` `:384-386`, `M-BIZ-20` `:440` | none of them enters the derivation of the asserted value; they are declared reference facts |
| UR-5 | runner's default per-suite timeout against the estimated `W10-BUSINESS-MATRIX` runtime | §17.4 | the estimate is extrapolated, not measured, and the override is an available bounded knob; it is a precondition on the protected acceptance stage, recorded in §15.3 |
| UR-6 | `innodb_lock_wait_timeout = 2` against a 15 s gate-admission budget | §17.7, `server/database/mysql-worker.js:31,108` and `server/modules/sales-gate-retry-admission.js:1` | a slow first wait-evidence observation makes the contenders abort and retry, which opens gaps in the pending window; if the delay exceeded the budget the approval would be refused with HTTP 503, which the suite explicitly rejects — the failure mode is loud, not silent |

**NON_BLOCKING — the remaining checks.** The `W10-PARITY` and `W10-RACES` suites keep real-MySQL
evidence that corresponds to the current worktree (A2, A3). The twelve race capacity expectations were
independently recomputed and are mutually consistent, including `M-R09`'s `NEITHER_FITS` with the
`available < 20000` precondition and the deliberately contrasting `M-R10` (`UNPROVEN_ATTRIBUTION`, and
explicitly **not** `OVER_LIMIT`). The seven business-matrix delivery-creating cases depend on the shared
fixture's OQC quality control point, which is installed by the fixture base with `qualityPolicy`
defaulting to `true` and is never overridden per case, and no production quality-gate file is modified.
The strict TAP validator accepts the new `WAVE10_CHECK_METADATA_EVIDENCE` transcript line. The runner's
cleanup ordering and terminal zero-inventory guarantee are confirmed by source and by the failed 2026-10-26
campaign (A17).

### 13. Acceptance conditions

1. The `no-rule` variant of `M-BIZ-19` reaches its own assertions and passes, with the fixture data
   expressing "no applicable effective rule" as a rule-set state.
2. The referential contract holds: the Profile's `rule_id` resolves to an existing rule row and no
   statement in the corrected setup deletes, orphans or re-points a referenced row.
3. The foreign key and its `ON DELETE NO_ACTION` behaviour are unchanged in the canonical schema and in
   the migrated schema.
4. The `disabled`, `no-rule` and `other-mode-only` states remain three distinguishable fixture states
   with their own case identities.
5. The observable contract is unchanged: not enforced, `PASS`, and a byte-identical persistence
   projection before and after the evaluation.
6. The engine-neutral local regression described in R08 passes, and the existing local CHECK normalizer,
   parity, index, foreign-key and physical-type regressions are unchanged and still pass.
7. All 39 protected cases remain present, enabled and unclassified; the suite manifest, case
   identifiers, evidence levels and M-board shape are unchanged.
8. The protected campaign over the dedicated disposable target reaches all three suites and reports the
   final cleanup as confirmed with a five-category inventory of zero.
9. `M-R02` reaches its own assertions and passes on a campaign run whose business date is on or after
   2027-01-01, with the approval expiry derived from the run date rather than from a fixed literal.
10. `M-R08` passes **deterministically** on a campaign run whose business date is on or after 2026-12-31,
    and the seeded salesperson Profile and the Profile created by the case resolve to one anchor and
    therefore one version chain, so the production predecessor closure closes the predecessor.
11. The production `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` guard is still fail-closed: two Profiles that
    genuinely qualify for the same scope and business date are still refused.

### 14. Compatibility boundary and prohibited changes

- **Unchanged:** the production Credit engine and its classification algebra; the exposure projection;
  the production refusal contract; the Finance recognition writers; the canonical HTTP routes; the L0
  and L1-L8 lock order; READ COMMITTED isolation; permissions; state machines; audit and idempotency
  contracts; the Wave 9 and Gate A freezes; the Gate B case identities, evidence levels and M-board
  shape; the `M-R09` assertion; the OQC fixture remediation; the approved CHECK cardinality of the eight
  tables; the package version and the release tags.
- **Prohibited in the future Implementation:** deleting, orphaning or re-pointing a referenced row;
  weakening or dropping a foreign key or a CHECK constraint; disabling foreign-key enforcement for the
  session; disabling the `raw:` fallback of the CHECK normalizer; removing or skipping any of the 39
  cases; weakening the `M-MIG-01` / `M-MIG-02` comparison or the `M-R09` assertion; editing the Gate
  runner, the manifest or the suite registration; changing a protected target, an account or a grant.
- **Prohibited in the future Implementation (added by §17.8 and §17.9):** removing the approval expiry as
  a business attribute, or replacing it with an unbounded value; editing production anchor-key
  construction (`server/modules/credit-anchor.js`) or the production predecessor-closure logic
  (`server/modules/credit-profile.js`) to make the fixture pass; weakening or removing the production
  `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` guard or its trigger; editing the `M-R02` or `M-R08` assertions
  to remove their asserted invariants; making any of the three corrected cases calendar-dependent in a
  different way.

### 15. Staged follow-up conditions

1. **Design** — the mechanism that expresses "no applicable effective rule" while preserving the
   referential contract, the auditable rule fact and the three distinct unenforced paths, together with
   the exact file list and the local regression contract. The Design must additionally cover the two
   calendar-gated cases (R09, R10) and must end in a HARD STOP.
2. **Implementation** — only after a separate explicit authorization; confined to the acceptance test
   contract, with the local, engine-neutral regression executed under a backend that cannot resolve to
   MySQL.
3. **Protected Acceptance** — only after a separate explicit authorization for exactly one
   `pnpm.cmd test:mysql:wave10` run against the dedicated disposable target, with the read-only preflight
   repeated first. The campaign must run with `ERP_MYSQL_WAVE10_SUITE_TIMEOUT_MS` set above the measured
   `W10-BUSINESS-MATRIX` runtime (see UR-5 in §17.4), and the read-only preflight must confirm that value
   in the child environment before the run.

### 16. OPEN facts

```text
OPEN  the real-MySQL result of W10-BUSINESS-MATRIX (20 cases, never executed)
OPEN  the real-MySQL result of M-MIG-01 / M-MIG-02 after the CHECK normalization remediation
OPEN  CREDENTIAL_EXPOSURE_OPEN
OPEN  WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN
OPEN  WAVE10_CLASSIFICATION_ALGEBRA_LOCAL_REGRESSION_ABSENT
OPEN  WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
OPEN  CB-2 — M-R02 hard-coded approval expiry blocks any campaign on or after 2027-01-01
OPEN  CB-3 — M-R08 salesperson Profile predecessor never closed; blocks any campaign on or after 2026-12-31
OPEN  CG-4 — the hand-written MySQL DDL materialization path of the Wave 9 tables is never exercised
OPEN  CG-3 / CG-5 — M-MIG-01 comparison scope and M-BIZ-16 replay semantics
```

**Requirement status: `WAVE10_ACCEPTANCE_BLOCKER_REQUIREMENT_COMPLETE`.**

### 17. Independent re-verification pass (2026-10-27)

A second Requirement-stage pass re-derived every material fact of §3 from the current source and
re-checked the whole 39-case surface. It changed no existing Requirement, corrected one count,
strengthened the blocker evidence, and added **nine** findings the first pass had not recorded —
two of them new confirmed blockers — together with two new Requirements.

#### 17.1 Scope and method

- Same authorization as §1: Requirement stage only. Read-only inspection; **no** test run, build,
  MySQL connection or database query; **no** Git write operation. The only files modified are
  `document.md` (this section and the two amendments noted in §17.5 and §17.6) and the append-only
  development log.
- Method: every raw DML statement in the three protected suites and in the shared acceptance fixture
  was re-enumerated and re-checked against the canonical schema contracts; every capacity and exposure
  expectation was recomputed; the runner, the strict TAP parser, the campaign object inventory and the
  OQC dependency were re-read from source; the `W10-PARITY` and `W10-RACES` suites were additionally
  submitted to two independent read-only audit passes, whose material claims were then re-verified
  against the source by hand.
- The Requirement set **R01–R08 stands unchanged**.

#### 17.2 CB-1 evidence strengthened — the rejection holds on both materialization paths

The first pass established CB-1 through the snapshot-to-MySQL rendering path only. The re-verification
adds the independent live-upgrade path and closes two remaining links.

- **A19 — fresh-bootstrap path.** `server/database/mysql-adapter.js:271` captures the canonical SQLite
  snapshot and `:281` passes it to `bootstrapMySql`; `server/database/mysql-schema.js:414` materializes
  every snapshot table through `tableDefinition()` on a fresh database, and `:314` materializes a missing
  table through the same function on the additive path. `:202` emits the foreign key as
  `FOREIGN KEY (rule_id) REFERENCES credit_check_rules (id) ON UPDATE NO ACTION ON DELETE NO ACTION`,
  and `:205` executes the statement with `ENGINE=InnoDB`. A fresh Wave 10 database therefore carries
  the constraint with an explicit `ON DELETE NO ACTION` delete action.
- **A20 — live-upgrade path, independent of the snapshot.** `server/migrations/sales-customer-wave9-credit-foundation.js:188`
  declares `FOREIGN KEY(rule_id) REFERENCES credit_check_rules(id)` inside the migration's own MySQL
  DDL with **no** `ON DELETE` clause. MySQL's default delete action for an omitted clause is `RESTRICT`,
  which equally rejects the deletion of a referenced parent row. The constraint therefore exists on
  the upgrade path regardless of how the snapshot extractor renders it, and the blocker no longer
  depends on the snapshot rendering behaviour.
- **A21 — every foreign-key-check suspension is paired with a restore.** A repository-wide search finds
  `SET FOREIGN_KEY_CHECKS=0` in exactly two places on the Wave 10 acceptance path, and both restore the
  setting in a `finally` block:
  - `server/database/mysql-schema.js:410` — the bootstrap suspends the checks only while it creates the
    tables and restores them at `:472`. The bootstrap adapter **is** the adapter the acceptance fixture
    uses (`server/test-utils/temp-db.js:90` returns the adapter produced by `createDatabase`, and
    `server/db.js:572-579` dispatches the MySQL backend to `createMySqlDatabase`), so the session that
    later executes the `M-BIZ-19` `DELETE` carries `foreign_key_checks = 1`.
  - `server/test-utils/mysql-wave10-campaign-target.js:267` — the campaign reset, restored at `:276`. It
    runs on the runner's own session, never on the suite child's.

  Every remaining occurrence belongs to a different gate or an unrelated administrative tool, and each of
  those is likewise paired with a restore. The SQLite-local `PRAGMA foreign_keys` toggles
  (`server/migrations/inventory-position-schema.js:296,324` and
  `server/migrations/sales-customer-wave6-returns.js:221,251,323-339`) do not apply to the MySQL backend.
  Nothing on the acceptance path leaves the constraint unenforced while the fixture's own statements run.
- **A22 — the referencing row always exists.** `server/test-utils/wave10-mysql-acceptance-fixture.js:477`
  creates `w10-profile-agg` unconditionally (unlike the salesperson profiles at `:478-479`, which are
  conditional), and `:512` writes `rule_id='w10-race-rule'` into it. `credit_profile.rule_id` is
  nullable, but the fixture populates it, so the parent delete is blocked in every lifecycle.

⇒ **CB-1 is deterministic on both materialization paths.** With A9 (`@@session.foreign_key_checks = 1`
on the dedicated account) the chain is closed: the `M-BIZ-19` `no-rule` variant cannot reach its own
assertions at `:429`/`:430`, `W10-BUSINESS-MATRIX` fails, and the runner aborts the campaign at suite 3.

#### 17.3 New COVERAGE_GAP findings — three, none of them a failure

**CG-3 — `M-MIG-01` compares only CHECK constraints for the two Wave 10 tables.**
`server/mysql-sales-customer-wave10.integration.js:178-185` compares `actual.checks` with
`expected.checks` and nothing else, guarded only by `actual.foreignKeys.length > 0` (`:182`) and
`actual.checks.length > 0` (`:183`), both satisfied by a single foreign key or check. The column set,
the physical types, the NULL/NOT NULL flags, the defaults, the foreign-key column mapping and the index
set of `credit_check_results` and `credit_special_approval` are not compared, although the case title
claims it "creates exactly the approved Wave 10 additions". The contract itself is covered elsewhere:
`M-MIG-06` (`:211-218`) compares fresh against upgrade through `assertEquivalentCreditMetadata`
(`server/test-utils/wave10-mysql-schema-fixture.js:616-627`), which compares columns, foreign keys,
checks and indexes for all eight tables. Not a failure and not converted into a Requirement here; the
finding is that this case's own title overstates its scope.

**CG-4 — the hand-written MySQL DDL materialization path of the Wave 9 tables is never exercised.**
`server/database/mysql-schema.js:114` maps every column whose name ends in `_id` to `VARCHAR(128)`,
so the snapshot path materializes `credit_lock_anchors.policy_scope_id` as `VARCHAR(128)`, while the
Wave 9 migration's own MySQL DDL (`server/migrations/sales-customer-wave9-credit-foundation.js:149-150`)
declares the same column as `LONGTEXT`. Because `bootstrapMySql` always pre-creates the table from the
snapshot and the migration's `CREATE TABLE IF NOT EXISTS` is then a no-op, both the fresh path and the
acceptance's own "upgrade" path (`server/mysql-sales-customer-wave10.integration.js:122-133`, which
bootstraps a Wave 9 bounded snapshot before running the migrations) materialize the column from the
snapshot. The divergence between the two materialization paths is therefore structurally invisible to
the parity suite. Severity is low and the effect is not behavioural: `policy_scope_id` is not a foreign
key, is not indexed, and is NULL for every `CREDIT_OBJECT` anchor that the fixture and the production
anchor builder create. Not a failure.

**CG-5 — `M-BIZ-16`'s second and third evaluations are exact replays of the first.**
The check-group identity is `CCHK1:sha256(sourceType|sourceId|stage|businessDate|authorizationContext|parameterSetHash|ruleSetHash|profileEffectiveStateHash|exposureDigest)`
(`server/modules/credit-check.js:873-876`) and it does **not** include the recognition mode.
`M-BIZ-16` (`server/mysql-sales-customer-wave10-business-matrix.integration.js:392-399`) evaluates the
same order `biz16-order`, the same stage `SO_SUBMIT`, the same business date and the same
`authorizationContext` (`race:biz16-order`,
`server/test-utils/wave10-mysql-acceptance-fixture.js:542`) for all three supported modes, and the
exposure it reads (`sales_orders`, `sales_deliveries`, `account_receivables` —
`server/modules/credit-check.js:226-244`) does not change between the calls. The second and third calls
therefore resolve to the same check group, and `:908` suppresses the `credit_check_results` INSERT and
`:936` the `EVALUATE` audit for a replay. The asserted fact is nevertheless genuinely established:
the mode filter is applied before the check-group identity is built
(`server/modules/credit-check.js:666`), so the decision is recomputed on every call, against a rule
whose `recognition_mode` is NULL
(`server/test-utils/wave10-mysql-acceptance-fixture.js:475`) and therefore applies to every mode. What
the case does not produce is three independent persisted evaluations. Not a failure.

#### 17.4 New UNVERIFIED_RISK — one

**UR-5 — the runner's default per-suite timeout is shorter than the estimated
`W10-BUSINESS-MATRIX` runtime.**
`scripts/gates/mysql-wave10-runner-support.mjs:25` defaults `ERP_MYSQL_WAVE10_SUITE_TIMEOUT_MS` to
`600_000`, with an accepted range of 10000..3600000 (`:26-28`). The 2026-10-26 campaign overrode it to
`1800000` for exactly this reason (`log/2026-10-26.md:1231-1233`), so the override is an already-proven
bounded knob that relaxes no identity, grant, manifest or cleanup guard.
The measured per-lifecycle cost is ≈27 s — `W10-PARITY` 193 s over 7 cases and `W10-RACES` 324 s over
12 cases — and `W10-BUSINESS-MATRIX` performs **23** schema rebuilds (18 single-lifecycle cases plus 2 in
`M-BIZ-19` and 3 in `M-BIZ-20`), i.e. an estimated ≈620 s against a 600 000 ms default.
Trigger: a protected campaign run without the timeout override.
Failure mechanism: the runner raises `WAVE10_MYSQL_SUITE_TIMEOUT`
(`scripts/gates/mysql-wave10-runner-support.mjs:184-186`). If the child's termination is confirmed, the
final protected reset still runs and the target ends at zero objects; if termination is **not**
confirmed, the runner deliberately refuses to touch the target (`:173-181`,
`cleanup = NOT_ATTEMPTED_CHILD_LIVE`) and does not release the campaign lease (`:216`), leaving the
target dirty and the lease held.
Why it is not a confirmed blocker: the runtime is extrapolated, not measured — the suite has never run —
and the override is an available, bounded execution-time knob. It is a precondition on the protected
acceptance stage, recorded in §15.3, and not a defect in any suite.

#### 17.5 Correction to §12 — the delivery-creating case count

The business-matrix cases that create a delivery number **seven**, not eight: `M-BIZ-07`, `M-BIZ-09`,
`M-BIZ-10`, `M-BIZ-11`, `M-BIZ-12`, `M-BIZ-13`, `M-BIZ-14`. `canonicalDelivery` is called directly at
`server/mysql-sales-customer-wave10-business-matrix.integration.js:281` and `:365-366`, and through
`canonicalInvoiceScenario` at `:189` from `:308`, `:318`, `:329`, `:342` and `:354`. `M-BIZ-05`,
`M-BIZ-06` and `M-BIZ-08` create no delivery. The correction changes no conclusion: those seven cases
depend on the shared fixture's OQC quality control point, which the fixture base installs with
`qualityPolicy` defaulting to `true` and which no case overrides.

#### 17.6 Effect on the Requirement set

R01–R08 stand unchanged. None of CG-3, CG-4, CG-5 or UR-5 alters the `no-rule` business fact, the
referential contract, the three distinguishable unenforced paths, the observable contract, the
no-production-change boundary or the no-suite-weakening boundary. §15.3 has been amended with the
protected-acceptance precondition that UR-5 establishes. §12's delivery-creating case count has been
corrected in place, as recorded in §17.5.

#### 17.7 `W10-RACES` audit — two calendar-gated blockers, both re-derived from source

The re-verification confirmed the twelve race capacity expectations and added two defects that are
gated by the calendar rather than by the current date. Both are defects of the acceptance test
contract; neither touches production code.

**CB-2 — `M-R02` hard-codes an approval expiry that becomes invalid.**
`server/mysql-sales-customer-wave10-concurrency.integration.js:292` and `:296` hard-code
`requestedExpiryBusinessDate` and `approvedExpiryBusinessDate` as `'2026-12-31'`.
`server/modules/credit-special-approval.js:169-174` refuses a request whose expiry is earlier than the
result's business date with HTTP 409 `CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST`, and that business date
is the campaign run date (`creditInput` → `wave10BusinessDate()`).
Trigger: a campaign run on or after **2027-01-01**.
Mechanism: the request is refused before the race begins, `request.body?.approval?.id` is undefined and
`assert.ok(approvalId)` at `:294` fails. The whole `W10-RACES` suite aborts, and with it the
`GATE-B-PRODUCTION-RACES` re-run of the same file
(`scripts/gates/mysql-sales-wave10-manifest.mjs:26-29`).
Status: **CONFIRMED_BLOCKER for any campaign on or after 2027-01-01**. It does **not** block a campaign
run on 2026-10-27, because `'2026-12-31'` is still in the future. The sibling business-matrix case
`M-BIZ-04` already avoids this by using `wave10FutureBusinessDate()`
(`server/mysql-sales-customer-wave10-business-matrix.integration.js:234,239`), so the two suites express
the same requirement in two different ways.

**CB-3 — `M-R08` never closes the salesperson Profile predecessor, so two Profiles overlap from 2026-12-31.**
The fixture writes the salesperson anchor key as `...|SCOPE:w10-race-sp-a`
(`server/test-utils/wave10-mysql-acceptance-fixture.js:506`) while production builds
`...|SCOPE:SALESPERSON|w10-race-sp-a` (`server/modules/credit-anchor.js:18-23`). The two keys differ, so
`ensureCreditLockAnchor` provisions a **second** anchor, and `closePredecessorAndAssertNoOverlap`
(`server/modules/credit-profile.js:124-136`) closes a predecessor by `WHERE anchor_id = ?` — the new
anchor, which has no predecessor. The seeded `w10-profile-a` (`effective_from '2026-01-01'`,
`effective_to NULL`) is therefore never closed. `M-R08` creates a second salesperson Profile with
`effectiveFrom: '2026-12-31'`
(`server/mysql-sales-customer-wave10-concurrency.integration.js:476`).
Trigger: a campaign run on or after **2026-12-31**.
Mechanism: from that date both Profiles satisfy `resolveEffectiveCreditProfile`'s predicate
(`server/modules/credit-profile.js:47-54`: `effective_from <= businessDate AND (effective_to IS NULL OR
effective_to >= businessDate)` over the same `customer_id`, `salesperson_scope_key`,
`credit_object_type` and `credit_object_id`), so the resolver throws HTTP 409
`CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS`; the evaluation writes no `credit_check_results` row and
`assert.ok(groups.length > 0)` at `:483` fails. Whether it fails depends on which contender wins the
gate, so it is order-dependent and roughly a coin flip.
Contrast: `M-R04` uses the **aggregate** scope, whose fixture anchor key `SCOPE:AGGREGATE` matches the
production key exactly, so its predecessor *is* closed to `2026-12-30` (`previousDate`,
`server/modules/sales-foundation-common.js:36-40`) and the case is safe. Only the salesperson scope is
affected.
Relation to UR-3: UR-3 recorded the anchor-key divergence itself and classified it as harmless because
`credit_lock_anchors` is outside the persistence projection. That is true but incomplete — the same
divergence also disables the predecessor closure, and that is what turns it into a date-gated blocker.
Status: **CONFIRMED_BLOCKER for any campaign on or after 2026-12-31**, roughly two months from this
pass. It does **not** block a campaign run on 2026-10-27.

Three lower-severity items were also recorded:

- **CG-6 — `M-R02`'s "exactly one effective authority" assertion is a disjunction, not an exclusion.**
  `:312` asserts `approval.decision === 'APPROVED' || order.status === 'APPROVED'`. When the special
  decision wins the gate first, the later standard approval consumes the approval
  (`server/modules/credit-check.js:884-906`), so both predicates hold simultaneously and the
  disjunction cannot distinguish one authority from two. The load-bearing constraints are the
  neighbouring `consumes <= 1` (`:309`) and the Sales Order approve-audit count (`:310-311`). The stated
  invariant is therefore not proven.
- **CG-7 — `M-R04`'s Profile-identity assertion is a tautology.** `:389` asserts that the group's
  `credit_profile_id` is a member of a candidate list built from `old.id` plus every other row of the
  same `credit_profile` table the assertion itself reads. It can only fail if the referenced Profile was
  deleted; it cannot fail on a wrong Profile identity. The sound identity checks are the neighbouring
  `profiles.size === 1` / `fingerprints.size === 1` / `hashes.size === 1` (`:386-388`).
- **UR-6 — `innodb_lock_wait_timeout = 2` against a 15 s gate-admission budget.**
  `server/database/mysql-worker.js:31,108` sets the session lock-wait timeout to 2 seconds while the
  Sales Order gate-admission budget is 15 000 ms
  (`server/modules/sales-gate-retry-admission.js:1`). Every contender blocks on the L0 gate row
  (`server/db.js:2125`), so a first wait-evidence observation that takes longer than 2 s makes the
  contenders abort with `ER_LOCK_WAIT_TIMEOUT`, roll back and retry, which opens gaps in which a
  contender is not pending; `waitForWave10Waiters` allows 30 s
  (`server/test-utils/wave10-mysql-acceptance-fixture.js:196`). If the observation delay exceeded the
  15 s budget the approval would be refused with HTTP 503, which the suite explicitly rejects. The
  failure mode is loud, not silent.

The re-verification also confirmed, from source, that the twelve capacity expectations are each the
only consistent classification, that every contender runs inside `transaction()` and therefore holds the
exclusive `mysql_transaction_gates` lock for the whole transaction (the contenders are serialized, not
merely interleaved), that **no assertion names an ambiguous winner** (M-R01, M-R05 and M-R06 assert
winner *counts*, M-R07 asserts a refusal, M-R09 and M-R10 assert that both contenders refuse), that the
suite contains no `catch` block, no `test.skip`/`todo`/`only` and no conditional registration, and that
`runCoordinatedWave10Race` releases the coordination gate on **every** path
(`server/test-utils/wave10-mysql-acceptance-fixture.js:245-250`), re-throwing the wait-evidence failure
together with the contenders' real outcomes rather than producing a PASS marker.

#### 17.8 W10-ACC-R09 — An approval expiry must not be a fixed calendar literal

Any Special Approval expiry that the acceptance suite requests or approves must remain valid on every
calendar date on which the campaign may be executed. A hard-coded expiry date is not an acceptable
representation of that requirement, because the suite would then encode an execution deadline as if it
were a business fact.

The corrected setup must express the intent — *the approval is valid beyond the current business date* —
in a way that holds for any run date, and must keep the asserted behaviour unchanged: the approval is
requested and decided through the canonical production writer, and the race between the special decision
and the standard approval still resolves to exactly one effective authority.

Acceptance conditions:

1. `M-R02` reaches its own assertions and passes on a campaign run whose business date is **on or after
   2027-01-01**, without any edit to the case's assertions.
2. The requested and approved expiry remain strictly later than the current business date, derived from
   the run date rather than from a literal.
3. The expiry is still bounded and still audited as a business attribute of the approval; it is not
   removed, and it is not widened to an unbounded value.
4. The fix does not change the `M-BIZ-04` behaviour, which already uses the derived form and must keep
   using it.

#### 17.9 W10-ACC-R10 — A Profile version chain must actually be closed

When the acceptance fixture creates a Profile for a scope, the fixture's own scope identity must be the
identity the production code uses for that scope. Otherwise the production predecessor-closure step
operates on an anchor that holds no predecessor, the seeded Profile is never closed, and two Profiles
later qualify for the same scope and business date.

The corrected setup must make the seeded Profile and the production-created Profile part of **one**
anchor and therefore one version chain, so that the production predecessor closure can and does close the
predecessor. The asserted behaviour stays unchanged: after the mutation, the aggregate and the
salesperson result rows belong to one coherent version set, share one policy snapshot fingerprint and
carry one profile effective-state hash.

Acceptance conditions:

1. The seeded salesperson Profile and the Profile created by `M-R08` resolve to the same anchor, so the
   production predecessor closure closes the predecessor rather than leaving it open.
2. `M-R08` reaches its own assertions and passes on a campaign run whose business date is **on or after
   2026-12-31**, and it passes deterministically — the result must not depend on which contender wins the
   coordination gate.
3. `M-R08` still fails closed, as it must, if two Profiles ever do qualify for the same scope and
   business date; the correction must not remove the production `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS`
   guard or weaken its trigger.
4. The aggregate scope (`M-R04`) keeps its current behaviour and its current predecessor closure.
5. No production code, schema, migration, constraint, permission or state machine is modified; the
   correction is confined to the acceptance fixture's own reference data.

#### 17.10 Amended acceptance conditions and effect on the Requirement set

- §13 is amended: acceptance condition 1 now covers the `M-BIZ-19` `no-rule` variant **and** the two
  calendar-gated cases; a new condition requires `M-R02` to hold on or after 2027-01-01, a new condition
  requires `M-R08` to hold deterministically on or after 2026-12-31, and a new condition requires the
  anchor identity of the fixture to match the production scope identity.
- R01–R08 stand unchanged. R09 and R10 (§17.8, §17.9) are added as independent Requirements for CB-2 and
  CB-3. Neither alters the `M-BIZ-19` business fact, the referential contract, the three distinguishable
  unenforced paths, the observable contract, the no-production-change boundary or the no-suite-weakening
  boundary.
- All three confirmed blockers (CB-1, CB-2, CB-3) are defects of the acceptance test contract. None of
  them is a production defect, and none of them requires a schema, migration, constraint, permission or
  state-machine change.
- **CB-1 blocks the next campaign unconditionally.** CB-2 and CB-3 do not block a campaign run on
  2026-10-27, but they must be closed before any campaign executed on or after 2026-12-31, and CB-3 is
  within roughly two months of this pass. The three are best closed in one Design and one Implementation
  unit, because they share the same file set — the business-matrix suite, the concurrency suite and the
  shared acceptance fixture.
- The staged follow-up conditions of §15 are unchanged in substance, except that §15.3 now carries the
  UR-5 timeout precondition.

## Wave 10 Parity Oracle Requirement Addendum (2026-10-27)

### 1. Authorization, scope and stage boundary

The user authorized, under AGENTS.md §4.0 (Consecutive Stage Authorization), one consecutive
`AUDIT → REQUIREMENT → DESIGN` stage for the two remaining Wave 10 Full Acceptance parity blockers,
with a mandatory HARD STOP at the end of Design.

This section records the **Requirement** phase only. The Design phase is authorized to follow
immediately and is recorded in `solution.md` → §37.50. **Implementation is not authorized by this
stage.** No implementation, no test run, no build, no MySQL connection, no database query, no DDL,
no DML, no migration execution, no schema change and no Git write operation is authorized here.

Scope: the correctness of the **Wave 9/10 Schema Parity Oracle** — the acceptance-side machinery
that decides whether the canonical SQLite source and the live MySQL target are the same physical
schema. Scope does **not** extend to a general ERP database redesign, to any business behaviour, or
to any production schema change.

This Addendum is **bounded**. It does not restate the Wave 10 Requirement, the Design of §37.48 or
§37.49, or the approved CHECK cardinality. It adds the requirements that the two live failures
expose, and it corrects one frozen grading whose justification those failures falsified.

### 2. Audit method and evidence levels

The audit was performed by reading the canonical sources, by re-deriving the production MySQL DDL
through the production generator's own exported entry point
(`planMySqlAdditiveReconciliation`, `server/database/mysql-schema.js:310-323`), and by replaying the
**captured campaign transcript** of the failed 2026-10-27 Full Acceptance run
(`%TEMP%\w10recovery\campaign2-wave10.stdout.txt`, the `WAVE10_CHECK_METADATA_EVIDENCE` line, and the
`M-MIG-02` TAP diagnostic block). No MySQL connection was made, no test was executed, no database was
opened, and no repository file was modified during the audit.

Three evidence levels are used and are never conflated:

| Level | Meaning |
|---|---|
| `LIVE_CAPTURED_EVIDENCE` | bytes captured by the failed 2026-10-27 campaign, read back verbatim from the transcript |
| `SOURCE_DERIVED` | re-derived from the current canonical source by executing the production generator's own exported function |
| `TEST_EVIDENCE_PENDING` | not yet observed on a live MySQL server; must not be claimed as verified |

### 3. Verified facts

- **P01** — the production generic generator's **indexed set** is the union of the table's index
  columns and its foreign-key source columns: `server/database/mysql-schema.js:184-187`
  (`...table.indexes.flatMap((index) => index.columns...)` ∪ `...table.foreignKeys.map((fk) => fk.from)`).
  The same rule is duplicated inline in `columnDefinition` at `:209-212`.
- **P02** — the acceptance fixture's **oracle indexed set** is the index columns **only**:
  `server/test-utils/wave10-mysql-schema-fixture.js:17-19`
  (`new Set(table.indexes.flatMap((index) => index.columns).filter(Boolean))`). It contains no
  foreign-key contribution.
- **P03** — both sides feed the **same** production type mapper. The fixture calls
  `mysqlTypeFamily` directly (`wave10-mysql-schema-fixture.js:407-409`), which is
  `server/database/mysql-schema.js:121-125`, which calls `mysqlType` (`:87-116`). **No second type
  mapping exists** in the repository; the defect is in the *indexed predicate* passed into the shared
  mapper, not in the mapping itself.
- **P04** — `mysql-schema.js:114` maps a column to `VARCHAR(128)` when
  `indexed || column.pk || name === 'id' || name.endsWith('_id')`, and to `LONGTEXT` otherwise. The
  `_id` suffix clause therefore **masks** the P01/P02 difference for every foreign-key column whose
  name ends in `_id`. The difference is observable only on foreign-key columns whose name does **not**
  end in `_id`.
- **P05** — the referenced parent columns are all `VARCHAR(128)` in the generic path
  (`users.id`, `customers.id`, `salesperson_profiles.id`, `sales_orders.id`, `sales_deliveries.id`
  and the six Credit `id` columns). InnoDB requires a foreign-key child column to be type-compatible
  with its parent column, so a `LONGTEXT` child column would make the server **refuse the foreign
  key** (errno 150). The oracle's `longtext` prediction therefore does not describe a schema that
  could exist. This is an independent proof that the production generator is right and the oracle is
  wrong, independent of the live failure.
- **P06** — the two Wave 10 tables' physical types are fixed by the approved contract
  `WAVE10_MYSQL_COLUMN_TYPES` (`server/migrations/sales-customer-wave10-credit-check.js:227-273`),
  which the production mapper consults first (`mysql-schema.js:93`). The indexed predicate is
  therefore **irrelevant** for those two tables, and all 41 of their columns agree across every path.
- **P07** — over the **117 columns** of the eight tables, the generic bootstrap path and the hand-
  written migration DDL path diverge in **exactly one** column:
  `credit_lock_anchors.policy_scope_id` — generic `VARCHAR(128)`
  (`mysql-schema.js:114`, the `_id` suffix clause) versus hand-written `LONGTEXT NULL`
  (`server/migrations/sales-customer-wave9-credit-foundation.js:150`).
- **P08** — over the same 117 columns, the **oracle** and the **generic generator** diverge in
  **exactly five** columns, and they are exactly the five foreign-key columns whose names do not end
  in `_id`:

  | Table | Column | Oracle predicts | Generic generator produces | Hand-written DDL |
  |---|---|---|---|---|
  | `credit_parameters` | `created_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:159`) |
  | `credit_check_rules` | `created_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:168`) |
  | `credit_profile` | `created_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:184`) |
  | `credit_policy_snapshots` | `captured_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:197`) |
  | `credit_profile_ratings` | `applied_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:206`) |

- **P09** — the **oracle** and the **hand-written DDL** diverge in exactly six columns: the five of
  P08 plus `credit_lock_anchors.policy_scope_id` of P07. This reproduces the six-column list of the
  2026-10-27 report, but on a **different axis** than that report claimed (see P15).
- **P10** — the live MySQL Credit tables are materialized by the **generic snapshot bootstrap**, not
  by the hand-written migration DDL. `createDatabase` (`server/db.js:572-592`) calls
  `createMySqlDatabase` (`:576`), which bootstraps every table from the SQLite snapshot
  (`mysql-schema.js:414` for a fresh target, `:314` inside `planMySqlAdditiveReconciliation` for an
  additive target), and only **then** replays the migrations (`server/db.js:589`). The migrations'
  `CREATE TABLE IF NOT EXISTS` (`sales-customer-wave9-credit-foundation.js:310`) is therefore a
  no-op. This is proven by the live evidence itself: `credit_lock_anchors` is the **first** table
  `compareWave9SourceTarget` compares (`wave10-mysql-schema-fixture.js:493-503`) and it **passed** all
  four assertion groups live, which is only possible if `policy_scope_id` was `varchar` — the
  hand-written DDL declares it `LONGTEXT`.
- **P11** — the hand-written Wave 9 MySQL DDL is therefore **structurally unreachable** in the
  production bootstrap: both bootstrap branches use the generic `tableDefinition`. The divergence of
  P07 is real, but it is a divergence between one path that runs and one path that cannot run.
- **P12** — the CHECK comparison is asymmetric by construction. `extractCheckClauses`
  (`wave10-mysql-schema-fixture.js:375-401`) **sorts** the normalized canonical forms (`:400`);
  `readNormalizedMySqlTable` (`:479-484`) orders by the **raw** `cc.CHECK_CLAUSE` text and normalizes
  afterwards, so its array order is the catalogue's order, not the canonical order. Two producers of
  the same set therefore produce two differently ordered arrays.
- **P13** — the live catalogue's raw CHECK order is dominated by the **parenthesis-depth prefix** of
  the rendering, not by the identifier: under `utf8mb4_0900_ai_ci` the sequence `((` sorts before
  `(` followed by a backtick, so an `OR` expression such as
  `((`sales_order_id` is not null) or (`sales_delivery_id` is not null))` sorts before an `IN` list
  such as `(`decision` in (_utf8mb4\'PASS\',...))`. Replaying the captured evidence against the
  canonical SQLite source shows: the CHECK **multiset is identical for all eight tables**, while the
  **array order differs for exactly three** — `credit_check_results` (Wave 10 → `M-MIG-01`),
  `credit_check_rules` and `credit_profile_ratings` (Wave 9 → `M-MIG-02`). For the other five tables
  the two orders happen to coincide, which is why the defect is latent rather than universal.
- **P14** — **correcting only the type prediction would not close `M-MIG-02`.** The column assertion
  is the first assertion of the per-table block (`wave10-mysql-schema-fixture.js:499`), so the CHECK
  assertion at `:501` was never reached for `credit_parameters` and was never reached at all for the
  four tables after it. After the type prediction is corrected, `M-MIG-02` would still fail on
  `credit_check_rules: check-constraint parity` and on `credit_profile_ratings: check-constraint
  parity` under P13.
- **P15** — the 2026-10-27 report's attribution is **falsified**. Its six-column table is labelled
  "hand-written MySQL DDL versus canonical type generator", but for five of those six columns the
  canonical generator's prediction is `varchar` — identical to the hand-written DDL — and only the
  **oracle** predicts `longtext`. The report's separate claim that "Wave 9 runs through the hand-
  written DDL path on MySQL" is also falsified by P10. The six-column list is reproducible only on the
  oracle-versus-hand-written axis (P09), which is not the axis on which the live comparison runs.
- **P16** — **CG-4's observation is confirmed and its justification is falsified.** The observation
  (`credit_lock_anchors.policy_scope_id` is `VARCHAR(128)` through the snapshot path and `LONGTEXT`
  through the migration DDL) is correct, and P11 now **proves** that the hand-written path is never
  exercised. The justification recorded in `solution.md` §37.49.10 — "No acceptance path can produce
  the divergence" — is **falsified as a general claim**: `M-MIG-02` is such an acceptance path and it
  failed. It did not fail because of CG-4's divergence, however; it failed because of P08. The correct
  statement is narrower: *the divergent path is the unreachable one*.
- **P17** — the live evidence covers `credit_lock_anchors` (columns, foreign keys, checks and indexes
  all passed) and `credit_parameters` (columns only, failing on `created_by`). The foreign-key, CHECK
  and index assertion groups of `credit_parameters` and of `credit_check_rules`, `credit_profile`,
  `credit_policy_snapshots` and `credit_profile_ratings` were **never reached**. They are
  `TEST_EVIDENCE_PENDING`.
- **P18** — the static parity inventory of the eight tables, re-derived through the production
  generator's own exported entry point and cross-validated against the migrations' own `CONTRACTS`
  with **zero mismatches**: 8 tables, **117 columns**, **25 foreign-key edges**, **23 CHECK
  constraints** (`2/2/5/3/1/3/3/4`), **15 declared indexes** plus **2 SQLite auto-indexes** for the two
  Wave 10 table-level UNIQUE constraints (17 index entries in total), and `id` as the single-column
  primary key of every table.
  Every foreign key is declared without an action on both sides, so both sides normalize to
  `RESTRICT`.

### 4. Root-cause findings and their classification

| ID | Finding | Classification | Evidence |
|---|---|---|---|
| **RC-1** | the CHECK comparison compares two differently ordered arrays of the same set | `SEMANTIC_MISMATCH` in the acceptance **test contract** | P12, P13 |
| **RC-2** | the acceptance oracle's indexed predicate is narrower than the production generator's, so it mis-predicts five foreign-key columns | `SEMANTIC_MISMATCH` in the acceptance **test contract**; **not** a production defect | P01–P05, P08, P10 |
| **RC-3** | the generic bootstrap path and the hand-written Wave 9 migration DDL declare one column differently | `SEMANTIC_MISMATCH` between **two production declarations**, on a path that is structurally unreachable | P07, P11 |
| **RC-4** | the 2026-10-27 report attributed the six divergences to the wrong axis and to the wrong materialization path | **falsified attribution**, recorded for the audit trail | P09, P10, P15 |

**RC-2 is not a production defect.** The production generator's rule is not a heuristic accident: it
is what makes the schema creatable at all (P05). The hand-written Wave 9 DDL agrees with the
production generator on all five RC-2 columns (P08). The defect is that the acceptance oracle
reimplements the indexed predicate and implements it **narrower** than the generator.

**RC-3 is a real production inconsistency, but it is not what failed.** It must be registered as an
independent issue under R10 and must **not** be corrected by an unauthorized migration edit in this
unit.

### 5. Requirement statements

- **W10-PAR-R01 — the CHECK comparison is over the normalized multiset.** Two CHECK sets are equal
  when their **normalized canonical forms** are equal as a **multiset**: the comparison is
  insensitive to the order of the constraints, and it is **sensitive to the number of occurrences**
  of each constraint. A repeated constraint must remain a repeated constraint on both sides.
- **W10-PAR-R02 — the type prediction uses the production generator's rule.** The acceptance oracle
  must derive "is this column indexed" exactly as the production generator does: an indexed column
  **or** a foreign-key source column counts. The prediction for a foreign-key column must therefore
  be the generator's `VARCHAR(128)`, not `LONGTEXT`.
- **W10-PAR-R03 — the prediction must consume the production mapper.** The physical type family must
  continue to be produced by the production `mysqlTypeFamily`, or by the production generator's own
  emitted DDL. A second, hand-written type mapping in the acceptance layer is prohibited, and a
  hand-written copy of the **indexed predicate** is permitted only if a local regression proves it
  equal to the production generator's rule for every column of all eight tables.
- **W10-PAR-R04 — all eight tables are compared on the complete physical contract.** For every one of
  the six Wave 9 tables and the two Wave 10 tables, the comparison covers: column name and ordinal,
  physical type family, nullability, default, primary key, foreign keys with their actions, index
  identity, index uniqueness and column order, and the CHECK set. The comparison must not stop at the
  first difference; it must be exhaustive.
- **W10-PAR-R05 — the two Wave 10 tables keep their approved physical contract.** The approved
  `WAVE10_MYSQL_COLUMN_TYPES` contract and the hand-written Wave 10 MySQL DDL are unchanged, and the
  two tables' column types are unchanged by this unit.
- **W10-PAR-R06 — both initialization paths are covered.** The **generic snapshot bootstrap** path
  and the **hand-written migration DDL** path are both covered by the local regression, so that a
  divergence between them is detected by the local gate rather than by a protected campaign.
- **W10-PAR-R07 — a real schema divergence must remain detectable.** After the corrections, a genuine
  divergence between the canonical source and the live target must still fail the comparison. This
  includes RC-3: if the live table were materialized from the hand-written DDL, the difference on
  `credit_lock_anchors.policy_scope_id` must still be reported.
- **W10-PAR-R08 — no false-green route.** A PASS must not be obtained by hard-coding an exception for
  the five RC-2 columns, by removing the column-type comparison, by treating `TEXT`, `VARCHAR` and
  `LONGTEXT` as one family, by ignoring foreign-key columns, by dropping or weakening any CHECK, by
  lowering the approved CHECK cardinality, by ignoring the `raw:` fallback of the normalizer, by
  accepting an unparsable expression, by modifying the production MySQL schema, or by adapting the
  production DDL to a wrong test expectation.
- **W10-PAR-R09 — the corrections are covered by an engine-neutral local regression.** The regression
  must reproduce both live failures offline, prove the negative cases still fail, and keep the
  existing parity, index, foreign-key, migration-idempotency and CHECK-parsing regressions intact.
- **W10-PAR-R10 — RC-3 is registered as an independent issue.** The `credit_lock_anchors.policy_scope_id`
  divergence between the generic bootstrap path and the hand-written Wave 9 migration DDL is recorded
  as a separate open issue with its own Requirement. It is **not** corrected by this unit, and the
  Wave 9 migration DDL is **not** modified. Any future correction that touches a migration requires
  its own Requirement and Design.

### 6. Acceptance conditions

1. The eight tables' CHECK sets compare **equal** when the two sides hold the same normalized
   constraints in a different order, and **unequal** when a constraint is missing, when the number of
   occurrences of a constraint differs, or when a constraint's expression differs.
2. The comparison preserves the `raw:` fallback: an unparsable clause keeps its distinct `raw:` form
   and never compares equal to a parsed form.
3. The oracle's predicted physical type family equals the production generator's for **all 117
   columns** of the eight tables, and in particular for the five RC-2 foreign-key columns.
4. A plain, non-indexed, non-foreign-key `TEXT` column is still predicted `longtext` — the
   correction must not over-apply.
5. The two Wave 10 tables' approved physical contract is unchanged, and their columns compare equal
   against the generic generator's output.
6. The `credit_lock_anchors.policy_scope_id` divergence between the generic path and the hand-written
   path is **detected** by the local regression.
7. The full inventory — 117 columns, 25 foreign keys, 23 CHECK constraints, the index sets and the
   primary keys of all eight tables — is asserted by the local regression, and it matches the
   migrations' own `CONTRACTS` with zero mismatches.
8. The existing local regressions — the CHECK normalizer suite, the index-parity suite, the
   foreign-key and physical-type contracts, the migration-idempotency suite — are unchanged and
   still pass.
9. The protected suite's case identities, counts, evidence levels and M-board shape are unchanged, and
   no assertion is deleted, skipped, weakened or reclassified.
10. No production code, schema, migration, constraint, permission, state machine, business rule or
    data is modified. The unit is confined to the acceptance test contract and its local regression.
11. The corrected `M-MIG-01` and `M-MIG-02` pass on a protected campaign, and the previously
    unreached foreign-key, CHECK and index assertion groups of the five Wave 9 tables after
    `credit_parameters` obtain their first live evidence.

### 7. Compatibility boundary and prohibited changes

- **Unchanged:** the production MySQL generator and every rule in it; the production DDL of every
  table; the Wave 9 and Wave 10 migrations; the approved `WAVE10_MYSQL_COLUMN_TYPES` contract; the
  approved CHECK cardinality of the eight tables; the CHECK normalizer's grammar, its two literal
  dialects and its `raw:` fallback; the index-parity contract and its backend-generated-name
  exception; the foreign-key support-index exception; the protected suite manifest, case
  identities, evidence levels and M-board shape; the package version and the release tags.
- **Prohibited in the future Implementation:** hard-coding an exception for the five RC-2 columns;
  removing, weakening or skipping the column-type comparison; collapsing `TEXT` / `VARCHAR` /
  `LONGTEXT` into one family; ignoring foreign-key columns in the prediction; deleting or weakening
  any CHECK; lowering the approved CHECK cardinality; ignoring or disabling the `raw:` fallback;
  accepting an unparsable expression as equivalent to a parsed one; modifying the production MySQL
  schema; adapting the production DDL, the hand-written migration DDL or the approved Wave 10
  contract to a wrong test expectation; removing, skipping, weakening or reclassifying any protected
  case; changing the runner, the manifest or the suite registration; touching a protected target, an
  account or a grant.

### 8. Corrected CG-4 classification and the falsified deferral justification

`solution.md` §37.49.10 graded **CG-4** as `DEFERRABLE_WITH_JUSTIFICATION` with the stated reason:
"`credit_lock_anchors.policy_scope_id` is `VARCHAR(128)` through the snapshot path and `LONGTEXT`
through the migration's own DDL, but both are the same text family and the column is not a foreign
key, is not indexed and is NULL for every anchor the fixture and the production builder create.
**No acceptance path can produce the divergence**, and any future correction would touch a
migration, which needs its own Requirement."

This Addendum records the following corrections:

1. **The deferral justification is falsified and must not be carried forward.** `M-MIG-02` **is** an
   acceptance path, and it failed. The clause "no acceptance path can produce the divergence" is
   therefore not a valid basis for deferral and is withdrawn.
2. **The observation stands and is now proven.** The two paths really do declare the column
   differently (P07), and the hand-written path is now proven to be structurally unreachable (P11).
3. **The failure was caused by a different root cause.** `M-MIG-02` failed on the oracle's indexed
   predicate (RC-2), not on CG-4's divergence. CG-4's divergence was never reached, because
   `credit_lock_anchors` compares equal.
4. **The corrected grading** of CG-4 is therefore:
   - the **subject** — "the hand-written MySQL DDL materialization path of the Wave 9 tables is never
     exercised" — is **CONFIRMED** and is now **proven** rather than inferred;
   - the **reason** is restated as: *the divergent declaration lives on the unreachable path, and the
     path that runs is the one the acceptance compares against*;
   - the **latent inconsistency** between the two declarations is registered as an **independent
     open issue** under W10-PAR-R10, and is **not** corrected by this unit;
   - CG-4 is **no longer** deferred on the basis of a falsified justification. It is deferred on the
     basis of the corrected, narrower and now-proven reason, and its residual consequence — one
     column whose declared type differs between a reachable and an unreachable path — is registered
     as an open issue rather than as a justification.
5. `CG-3` (`M-MIG-01` compares only CHECK constraints for the two Wave 10 tables) is **unchanged** and
   remains `SEPARATE_REQUIREMENT_REQUIRED`: this Addendum does not widen `M-MIG-01`'s comparison scope
   to the columns, foreign keys and indexes of the two Wave 10 tables. That remains a separate
   Requirement.

### 9. Staged follow-up conditions

1. **Design** — the mechanism for the order-insensitive, duplicate-preserving CHECK comparison, the
   alignment of the oracle's indexed predicate with the production generator's rule, the exact file
   list, the offline reproduction of both live failures, the negative regressions and the acceptance
   evidence plan, ending in a HARD STOP.
2. **Implementation** — only after a separate explicit authorization, confined to the acceptance test
   contract and its local regression.
3. **Protected Acceptance** — only after a separate explicit authorization for exactly one
   `pnpm.cmd test:mysql:wave10` run against the dedicated disposable target, with the read-only
   preflight repeated first.

### 10. OPEN facts

```text
OPEN  the real-MySQL result of M-MIG-01 / M-MIG-02 after the parity-oracle remediation
OPEN  the real-MySQL result of W10-RACES (12 cases) and W10-BUSINESS-MATRIX (20 cases), never executed
OPEN  the foreign-key / CHECK / index assertion groups of credit_parameters, credit_check_rules,
      credit_profile, credit_policy_snapshots and credit_profile_ratings (TEST_EVIDENCE_PENDING)
OPEN  RC-3 — credit_lock_anchors.policy_scope_id is declared VARCHAR(128) by the generic bootstrap
      path and LONGTEXT by the hand-written Wave 9 migration DDL (independent issue, W10-PAR-R10)
OPEN  CG-3 — M-MIG-01 compares only the CHECK constraints of the two Wave 10 tables
OPEN  CREDENTIAL_EXPOSURE_OPEN
OPEN  WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN
OPEN  WAVE10_CLASSIFICATION_ALGEBRA_LOCAL_REGRESSION_ABSENT
OPEN  WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
```

**Requirement status: `WAVE10_PARITY_ORACLE_REQUIREMENT_COMPLETE`.**

## Wave 10 Inventory Fixture Requirement (2026-10-27)

### 1. Authorization, scope and stage boundary

The user explicitly authorized, under AGENTS.md §4.0 (Consecutive Stage Authorization), one consecutive
`REQUIREMENT → DESIGN` stage for the single shared root cause behind the two remaining Wave 10
Full Acceptance failures (`M-BIZ-12`, `M-BIZ-14`), with a mandatory HARD STOP at the end of Design.

This section records the **Requirement** phase only. The Design phase is authorized to follow
immediately and is recorded in `solution.md` → §37.51. **Implementation is not authorized by this
stage.** No implementation, no test run, no build, no MySQL connection, no database query, no DDL,
no DML, no migration execution, no schema change and no Git write operation is authorized here.

Scope: the **shape of the stock that the Wave 10 shared acceptance fixture seeds**, and the independent
production inventory correctness risk that the same failure exposes. Scope does **not** extend to the
production out-bound availability check, to the inventory schema, to any migration, to the accounting,
valuation or AR/AP semantics, or to any other business behaviour. No production code is modified by
the unit this Requirement authorizes.

### 2. Evidence base and evidence levels

The Requirement was derived from the real code at HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6` and
from the **captured** transcript of the failed 2026-10-27 protected Full Acceptance campaign
(`%TEMP%\w10final\final-acceptance.stdout.txt`, 19473 bytes, process exit code `1`). No database was
opened, no test was executed and no repository file was modified while the facts below were
established.

| Level | Meaning |
|---|---|
| `LIVE_CAPTURED_EVIDENCE` | bytes captured by the failed 2026-10-27 protected campaign, read back verbatim from the transcript |
| `SOURCE_DERIVED` | re-derived from the current canonical source by reading the exact production writer, schema and adapter code paths |
| `TEST_EVIDENCE_PENDING` | not yet observed on a live MySQL server; must not be claimed as verified |

### 3. Verified facts — the shared root cause

- **P01** — `server/test-utils/wave10-mysql-acceptance-fixture.js:523-530` — `seedWave10Inventory()`
  seeds the Wave 10 acceptance stock with
  `INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at) VALUES(?,?,?,?,?)`,
  i.e. **without** `position_key`.
- **P02** — `server/migrations/inventory-position-schema.js:228` and `:304` — `inventory.position_key` is
  a **nullable** `TEXT` column, and the legacy `UNIQUE(warehouse_id, product_id)` is dropped by the
  table rebuild at `:295-325`. A row may therefore legally exist with `position_key = NULL`.
- **P03** — the fixture runs **after** the schema migration:
  `server/mysql-sales-customer-wave10-business-matrix.integration.js:68-73` calls `createTempDb(...)`
  and then `seedWave10AcceptanceBase(...)`, and `seedWave10AcceptanceBase` calls
  `seedWave10Inventory(db)` at `wave10-mysql-acceptance-fixture.js:515`. The migration's legacy
  backfill (`inventory-position-schema.js:237-276`) therefore **never observes the fixture row**; the
  row is born with `position_key = NULL` and stays that way for the whole case.
- **P04** — the legacy row's remaining dimension columns take their column defaults:
  `owner_type = 'ENTERPRISE'` (`inventory-position-schema.js:230`), `stock_status = 'AVAILABLE'`
  (`:232`), `bin_id / lot_id / serial_id = NULL` (`:229 / :233 / :234`), `active = 1` (`:235`).
  The seeded row therefore already carries the **canonical default dimensions** and differs from a
  canonical row **only** in `position_key`.
- **P05** — the canonical physical write path is `adjustInventory()` → `resolveCanonicalPosition()` →
  `upsertByPositionKey()` (`server/lib/stock.js:83-89`, `:35-58`, `:60-89`). The upsert executes
  `INSERT INTO inventory(...) ON CONFLICT(position_key) DO UPDATE SET quantity = inventory.quantity + excluded.quantity`.
- **P06** — the MySQL adapter rewrites that clause into `ON DUPLICATE KEY UPDATE`
  (`server/database/mysql-adapter.js:60`). A `NULL` value never conflicts in a `UNIQUE` index, so the
  legacy row's `position_key = NULL` **cannot** match `uq_inventory_position_key`. The upsert
  consequently **inserts a second row**, and because the insert path carries the *delta* of the
  movement, that new row's `quantity` is **-1**, not the resulting balance. A negative shadow row is
  born by the first confirmed Delivery.
- **P07** — the availability pre-check reads
  `SELECT quantity FROM inventory WHERE warehouse_id = ? AND product_id = ?` with **no** `position_key`,
  `owner_type`, `owner_id` or `stock_status` filter and **no** deterministic row selection
  (`server/app.js:5645` — creation path; `server/app.js:5876` — confirmation path).
- **P08** — `inventory.id` is the MySQL `VARCHAR(128)` PRIMARY KEY
  (`server/database/mysql-schema.js:114` and `:191`), i.e. the clustered index. The canonical row's id
  is `randomUUID()` (`server/db.js:2209-2210`); every hexadecimal character of a UUID sorts **below**
  `'w'` (0x77), so the canonical row sorts **before** the fixture row `'w10-race-inventory'` in every
  id-ordered scan. The read therefore returns the canonical row with `quantity = -1` first.
- **P09 — dialect divergence (load-bearing for the regression design).** On SQLite the same read is
  served by `idx_inventory_product_wh_status` (`inventory-position-schema.js:280`), on which the two
  rows tie on `(product_id, warehouse_id, stock_status)`; SQLite breaks the tie by `rowid`, and the
  legacy row has the smaller rowid. The read therefore returns `quantity = 100` on SQLite and
  `quantity = -1` on MySQL. **The defect is consequently not reproducible on SQLite by asserting that
  the Delivery is refused.** It is proven today by the existing local regression
  `server/sales-customer-wave10-quality-policy.test.js` → `W10-QCP-T02`, which confirms a complete
  canonical Delivery on SQLite **with the defective fixture still in place**.
- **P10** — `LIVE_CAPTURED_EVIDENCE` — the protected transcript contains, verbatim:
  `not ok 12 - M-BIZ-12 S14 multiple delivery links conserve one invoice header` with
  `error: 'canonical delivery creation failed: 400 {"error":"W10-RACE-P 库存不足","code":"VALIDATION","message":"W10-RACE-P 库存不足","requestId":"b9c0b0b7-1e95-4934-a3c3-a8f25d88a417","status":400}'`
  and `not ok 14 - M-BIZ-14 S14 multi-salesperson residual is not guessed` with
  `error: 'canonical delivery creation failed: 400 {"error":"W10-RACE-P 库存不足", …}'`.
  Both stacks carry the frame `canonicalDelivery (…/business-matrix.integration.js:113:11)`.
- **P11** — the captured message identifies the **creation** path and not the confirmation path:
  `createSalesDelivery` composes the message as `(product?.code || item.productId) + ' 库存不足'`
  (`server/app.js:5646`), so the product code `W10-RACE-P` is present, whereas the confirmation path
  throws the bare `'库存不足'` (`server/app.js:5877`). The captured message contains `W10-RACE-P`,
  therefore **the refusal happened in `createSalesDelivery`**, on the *second* Delivery.
- **P12** — `M-BIZ-13`, the same chain with **one** Delivery, **passed** in the same campaign, which
  isolates the defect to the second Delivery of the same `(warehouse_id, product_id)` pair.

**Shared root cause — established.** `M-BIZ-12` and `M-BIZ-14` both reach the stock through
`seedWave10AcceptanceBase()` → `seedWave10Inventory()` → the same
`(w10-race-warehouse, w10-race-product)` pair, and both fail at the **creation of their second
Delivery**. The two failures therefore share one root cause: the acceptance fixture seeds a
**legacy-shaped** inventory row (P01–P04) that the canonical write path cannot match (P05–P06), and
the production availability read then selects the resulting negative shadow row (P07–P08, P11).
It is a **test-fixture defect**, not a production behaviour defect of the Delivery chain.

### 4. The complete inventory state-transition tables

#### 4.1 The current (defective) path — `M-BIZ-12` and `M-BIZ-14`

| # | Event | Rows for `(w10-race-warehouse, w10-race-product)` | Available read | Result |
|---|---|---|---|---|
| 0 | schema migration applied | *(table empty)* | — | — |
| 1 | `seedWave10Inventory()` (P01–P04) | `id='w10-race-inventory'`, `quantity=100`, **`position_key=NULL`**, `owner_type='ENTERPRISE'`, `owner_id=NULL`, `stock_status='AVAILABLE'`, `bin_id/lot_id/serial_id=NULL`, `active=1` | — | seeded in legacy shape |
| 2 | Delivery #1 **creation** (`app.js:5645`) | unchanged | `100` (single row) | `100 ≥ 1` ⇒ **201** |
| 3 | Delivery #1 **confirmation** (`app.js:5876`) | unchanged | `100` | `100 ≥ 1` ⇒ passes |
| 4 | Delivery #1 **deduction** (`adjustInventory` → P05/P06) | **two** rows now exist: `w10-race-inventory` (`quantity=100`, `position_key=NULL`) **and** a canonical row (`quantity=-1`, canonical `position_key`, `id=randomUUID()`) | — | **negative shadow row created** |
| 5 | Delivery #2 **creation** (`app.js:5645`) | two rows | MySQL returns the canonical row first (P08) → **`-1`** | `-1 < 1` ⇒ **HTTP 400 `W10-RACE-P 库存不足`** |
| 6 | Delivery #2 **confirmation** | — | — | **never reached** |

Both captured failures stop at step 5 (P10, P11). The legacy row is never decremented; the canonical
row is created already negative; no row ever reaches `quantity = 99` or `98`.

#### 4.2 The required path after the fixture correction

| # | Event | Rows for the pair | Canonical row `quantity` | Result |
|---|---|---|---|---|
| 0 | schema migration applied | *(table empty)* | — | — |
| 1 | fixture seeds through the canonical absolute writer | **one** row, `position_key` = production `computePositionKey(...)`, `owner_type='ENTERPRISE'`, `owner_id=NULL`, `stock_status='AVAILABLE'`, `bin_id/lot_id/serial_id=NULL`, `active=1` | **100** | one canonical position established |
| 2 | Delivery #1 creation | one row | `100` | `100 ≥ 1` ⇒ **201** |
| 3 | Delivery #1 confirmation + deduction | **one** row (the same row, matched by `ON DUPLICATE KEY UPDATE`) | **99** | balance `99` |
| 4 | Delivery #2 creation | one row | `99` | `99 ≥ 1` ⇒ **201** |
| 5 | Delivery #2 confirmation + deduction | **one** row | **98** | balance `98` |

Invariants that must hold at every step: exactly **one** row for the pair; **zero** rows with
`position_key IS NULL`; **zero** rows with a negative quantity; the `quantity` sequence
`100 → 99 → 98`; the `inventory_transactions.balance_after` sequence `99 → 98`.

### 5. Requirement clauses

- **W10-INV-R01** — the acceptance fixture must seed the Wave 10 stock through the **production
  canonical absolute writer** `setInventoryQuantity(db, warehouseId, productId, quantity, now)`
  (`server/lib/stock.js:126-148`), and never through a raw `INSERT INTO inventory`.
- **W10-INV-R02** — the canonical position identity of the seeded row must be produced by the
  **production** identity functions `resolveCanonicalPosition()` (`server/lib/stock.js:35-58`) and
  `computePositionKey()` (`server/lib/inventory-position.js:113-134`). The fixture must not maintain
  a second position-key format, a second dimension tuple, or a hand-written hash.
- **W10-INV-R03** — the seeded row must carry `owner_type = 'ENTERPRISE'`, `owner_id = NULL`,
  `stock_status = 'AVAILABLE'`, `bin_id = NULL`, `lot_id = NULL`, `serial_id = NULL`, `active = 1`,
  and an **absolute** `quantity = 100` EA.
- **W10-INV-R04** — after seeding, exactly **one** inventory row may exist for the fixture
  `(warehouse_id, product_id)` pair, and **zero** rows may carry `position_key IS NULL`.
- **W10-INV-R05** — the first canonical Delivery confirmation must leave that row at `quantity = 99`
  and the second at `quantity = 98`, with the row count for the pair unchanged at one and no negative
  row created at any point.
- **W10-INV-R06** — the existing `DELETE FROM inventory WHERE warehouse_id=? AND product_id=?` in
  `seedWave10Inventory()` must be retained and must execute **before** the canonical write, so that
  re-running the seed can never leave a second row behind.
- **W10-INV-R07** — the fixture must remain idempotent: a second invocation of
  `seedWave10AcceptanceBase()` on the same database must leave exactly one canonical row for the
  pair.
- **W10-INV-R08** — **no production code path may change.** The formal out-bound delivery, the
  inventory deduction, the inventory transaction, the valuation movement, the Finance recognition,
  the AR/AP settlement and the state machines stay exactly as they are. No schema, no migration, no
  index and no historical business data may change.
- **W10-INV-R09** — the correction must be dialect-neutral: the same canonical identity and the same
  `100 → 99 → 98` sequence must result on SQLite and on MySQL, and the fixture must not branch on the
  dialect.
- **W10-INV-R10** — every existing consumer of the shared acceptance fixture must remain green:
  `server/sales-customer-wave10-quality-policy.test.js` (`W10-QCP-T01..T04`),
  `server/sales-customer-wave10-acceptance-contract.test.js` (`AC-01..AC-11`),
  `server/sales-customer-wave10-mysql-parity.test.js`, `server/sales-customer-wave10-credit-check.test.js`,
  and the protected Gate B and Business Matrix suites.
- **W10-INV-R11** — the seeded inventory row's `id` must not be depended upon by any test. The
  correction replaces the fixed id `'w10-race-inventory'` with the production writer's generated id;
  a repository-wide search found **zero** references to `'w10-race-inventory'` outside the fixture
  itself, and `seedWave10Inventory()` has exactly **one** caller
  (`seedWave10AcceptanceBase()`, `wave10-mysql-acceptance-fixture.js:515`). There is therefore no
  compatibility obligation to preserve the old id, and no existing test may be broken by its removal.
- **W10-INV-R12** — the local regression must assert the **position identity, the row count and the
  balance sequence**, and must not be satisfied by "the Delivery succeeded". Because of P09 the
  SQLite row order masks the MySQL refusal, so a regression that only asserts the business outcome
  would be green against the defective fixture and would prove nothing.
- **W10-INV-R13** — the new local regression `server/sales-customer-wave10-inventory-fixture.test.js`
  must be registered in the **`FULL`** suite **only**, and must **not** be registered in `FAST`. The
  manifest's own `FAST` classification criterion is that `FAST` "Must not require a temp SQLite or
  Vite SSR" (`scripts/testing/test-suites.js:19-20` and `:573-575`), while `W10-INV-T01`..`T08` need a
  real database state, the canonical inventory position identity and the deduction verification, and
  `createTempDb()` (`server/test-utils/temp-db.js:72`) is what supplies that state — as a disposable
  temp SQLite. The fixture must **not** bypass `createTempDb()` in order to qualify for `FAST`. This
  unit changes **no** existing `FAST` / `FULL` / `HEAVY` classification; the only count that moves is
  `FULL`, by the new file's single entry.
- **W10-INV-R14** — the regression must distinguish, per case and in the report, a **reproduction of a
  known defect** from a **pass of the new Fixture contract**, and must never present the one as the
  other. In particular the duplicate-row case `W10-INV-T05` must be made **deterministic by
  construction**: the legacy row's quantity must satisfy the requested quantity under **either** row
  selection of the unfiltered availability read, so the case asserts the **write** outcome (the
  canonical row moves, the legacy row does not) and asserts **nothing** about which row that read
  selected. A variant in which the two rows differ is a **known-risk reproduction** of
  `W10-INV-RISK-01` and is **never** evidence that the new Fixture contract holds.

### 6. Acceptance conditions

- **AC-INV-01** — with the corrected fixture, the pair `(w10-race-warehouse, w10-race-product)`
  carries exactly one inventory row after seeding, its `position_key` is non-`NULL` and equals the
  production `computePositionKey()` of the canonical default identity, and its `quantity` is `100`.
- **AC-INV-02** — the negative reproduction is retained: a deliberately seeded legacy row
  (`position_key IS NULL`, `quantity = 100`) must be proven to produce, after one canonical
  confirmation, **two** rows for the pair — one with `position_key IS NULL` and one canonical row
  with `quantity = -1`. This is the machine-verifiable proof of the root cause.
- **AC-INV-03** — two canonical confirmations against the corrected fixture leave exactly one row
  for the pair with `quantity = 99` and then `98`; the `inventory_transactions` rows carry
  `quantity_change = 1` and `balance_after = 99` and `98`.
- **AC-INV-04** — the **missing** case is not a PASS: with the canonical row absent, the canonical
  Delivery creation must be refused by the production availability check (the production refusal,
  not a test-local assertion).
- **AC-INV-05** — the **duplicate** case is not a PASS: with a legacy row present beside the
  canonical row, the canonical deduction must move the **canonical** row and must leave the legacy
  row's quantity untouched.
- **AC-INV-06** — the **wrong identity** case is not a PASS: a row carrying a non-canonical
  `position_key` (or a wrong `owner_type` / `stock_status`) must not be decremented by the canonical
  writer; its quantity must remain unchanged.
- **AC-INV-07** — the negative regressions must fail against the **defective** fixture and pass
  against the corrected one, and must be executed on a backend that cannot resolve to MySQL.
- **AC-INV-08** — `pnpm test:fast`, `pnpm test`, `pnpm test:heavy`, `pnpm build` and
  `git diff --check` must all pass, and the local test backend must be isolated from MySQL. The new
  regression of `W10-INV-R13` is executed by the **`FULL`** gate (`pnpm test`) and is deliberately
  **absent** from `FAST`; a green `pnpm test:fast` is therefore **not** evidence for
  `W10-INV-T01`..`T08` and must not be reported as such.

### 7. Compatibility and forbidden changes

- **Compatible by construction**: the fixture's public shape (`seedWave10AcceptanceBase`, its options,
  its returned objects) does not change; the seeded pair, the product, the warehouse and the
  quantity are unchanged; the canonical delivery, valuation, Finance and Credit behaviour is
  unchanged; the protected case identities, the manifest, the runner and the evidence grades are
  unchanged.
- **Forbidden in this unit**: any change to `server/app.js`, `server/lib/stock.js`,
  `server/lib/inventory-position.js`, `server/modules/*`, the inventory schema, any migration, the
  protected suite assertions, the runner, the manifest, `package.json`, `AGENTS.md`, `README.md`,
  `APPLY_GUIDE.md`, and any historical business data.
- **Forbidden outcome**: the two failures must not be made to disappear by weakening an assertion,
  by changing an amount, by changing a delivery count, by relaxing a tolerance or by skipping a case.

### 8. Independent production inventory correctness risk — `W10-INV-RISK-01`

The failure exposed a production-side robustness gap that **the fixture correction does not resolve**
and that must not be reported as resolved.

- **Subject** — `createSalesDelivery()` (`server/app.js:5645`) and `confirmSalesDelivery()`
  (`server/app.js:5876`) read the available stock with
  `SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?` and take **the first row**
  returned. The read carries **no** `position_key`, `owner_type`, `owner_id` or `stock_status` filter
  and **no** deterministic row selection, while the physical identity of a stock row is the
  multidimensional `position_key` (`server/lib/inventory-position.js:1-21`).
- **Reachability** — the read mis-selects whenever **more than one active row exists for the same
  `(warehouse_id, product_id)` with different canonical identities**. Such a state is reachable in
  production: the demo seed writes `position_key = NULL` rows (`server/db.js:1827-1838`), and the
  migration's legacy backfill can itself emit a **non-canonical** key — the `:rid` suffix path at
  `server/migrations/inventory-position-schema.js:270` and the `:fallback` path at `:273` produce
  `position_key` values that are **not** equal to `computePositionKey(...)`. A row written after a
  migration, or a backfilled row carrying a suffix, therefore coexists with a canonical row.
- **Possible impact — two directions, both reachable from the source.** The attribution of the
  **observed** acceptance failures to the fixture shape (§4.1) is unchanged, but the **defect's own**
  risk boundary is wider than that observed failure mode and must **not** be described as "only a
  possible false out-of-stock report":
  - **Direction A — false refusal.** The read selects a row whose quantity is lower than the
    canonical position's, so the production guard (`server/app.js:5646`, `server/app.js:5877`)
    refuses a Delivery that the stock could satisfy. This is the failure mode actually observed
    (`P08`, `P10`, `P11`).
  - **Direction B — false allowance, then a negative canonical balance.** The read selects a
    legacy-shaped or otherwise differently-identified row whose quantity is **higher** than the
    canonical position's, so the guard **passes** and the out-bound proceeds although the canonical
    position cannot cover it. The write path is canonical — the delta always lands on the canonical
    row — but the canonical upsert carries **no** negative-balance guard
    (`server/lib/stock.js:60-89`: `quantity = inventory.quantity + excluded.quantity`), so the
    canonical row can be driven **below zero**.
  - Both directions are `SOURCE_DERIVED` conclusions from the read semantics and the known data
    shapes; only direction A was observed.
- **Evidence grade** — `LIVE_CAPTURED_EVIDENCE` for the *read semantics* (the protected campaign
  proved that the read returns the shadow row and refuses), `SOURCE_DERIVED` for the code path.
  For **real production data** the grade is `TEST_EVIDENCE_PENDING`: no production dataset was
  inspected in this stage, so the **prevalence** of legacy-shaped rows in production is **not**
  established and must not be asserted.
- **Freeze impact — no pre-decision.** This Requirement **does not** decide that `W10-INV-RISK-01`
  blocks, or does not block, the Wave 10 Final Freeze. What broke the acceptance is the **fixture's**
  legacy shape and the fixture correction removes that manufactured trigger; the production read
  defect is independent of it, and direction B above is a reachability conclusion this unit does not
  close. The **Final Freeze Review** must therefore take an **explicit, recorded risk-disposition
  decision**: either close the risk through its **own** Requirement and Design, or **accept** it with
  a written justification under an **explicit authorization**. A silent omission, or a blanket
  "not a blocker" assertion carried over from this section, does **not** discharge it.
- **Boundary of this unit** — the production read is **not** modified here, and `W10-INV-RISK-01` is
  **not** part of the Fixture Implementation's production-code scope. This unit authorizes the fixture
  correction and the registration of this risk only. Any correction of the production read needs its
  own Requirement, its own Design and its own acceptance.

### 9. Post-stock readiness assessment

The two failing cases were audited **after** the second Delivery would succeed, so that the stock
defect does not merely expose the next statically discoverable failure. Each item below was checked
against the real source.

| # | Item | Finding | Grade |
|---|---|---|---|
| 1 | `sales_delivery_no` millisecond collision | `'SD' + Date.now().toString().slice(-10)` (`server/app.js:5650`) and `delivery_no TEXT NOT NULL UNIQUE` (`server/db.js:1220`). Two Deliveries created in the same millisecond collide, and the collision is an **explicit UNIQUE constraint failure**, never a silent overwrite. The two Deliveries of `M-BIZ-12` are separated by a full canonical confirmation (credit check, lock sequence, valuation movement, vouchers) plus a fresh scrypt login, so the collision is not reachable here. | `SOURCE_DERIVED`, not a blocker |
| 2 | Sales Order remaining deliverable capacity | The order line's `upper_delivery_tolerance_bps` is copied from the product classification (`server/modules/sales-orders.js:361`) and is `0` in the fixture, so the upper capacity is exactly `2.000000` EA for `M-BIZ-12` (`toleranceBoundsMicros`, `server/modules/sales-delivery-source.js:10-15`). The check at `server/app.js:5639` sees `1 + 1 ≤ 2` on the second Delivery and passes. | `SOURCE_DERIVED`, passes |
| 3 | OQC gate and approved-order state | The fixture installs one real `SALES_DELIVERY` control point through the canonical writer **before** any Delivery exists (`wave10-mysql-acceptance-fixture.js:465` → `seedWave10QualityPolicy`), and the creation path freezes the policy at document creation. `assertQualityGate(db, 'OQC', deliveryId)` (`server/app.js:5843`) therefore passes. Proven today on SQLite by `W10-QCP-T02`. | `SOURCE_DERIVED` + existing local proof |
| 4 | Finance invoice source linkage | `prepareSalesLines` (`server/modules/commercial-golive.js:99-114`) requires a **CONFIRMED** Delivery of the same customer and enforces `billed + qty ≤ source.quantity`; `finance_invoice_source_links` is `UNIQUE(invoice_id, invoice_side, source_type, source_id, source_line_id)` (`server/migrations/v22-finance-wave-c-invoice.js:34`), so two different Delivery ids yield **exactly two** rows, satisfying `M-BIZ-12`'s `links.length === 2` and the two-distinct-`source_id` assertion. | `SOURCE_DERIVED`, passes |
| 5 | One invoice over multiple Deliveries — quantity and amount | Each Delivery line carries quantity `1` and unit price `100000`; the invoice line defaults to the Delivery line's unit price (`commercial-golive.js:110`). Two lines ⇒ `200000` cents, matching `M-BIZ-12`'s `arOpenCents === 200000` and `M-BIZ-14`'s `receivable.amount_cents === 200000`. | `SOURCE_DERIVED`, passes |
| 6 | Cross-salesperson AR attribution | `M-BIZ-14`'s two Deliveries come from two different orders with two different `salesperson_id`s; the production exposure projection attributes the residual to `ambiguousAttributionCents` and never to one of them. The invoice and AR facts are **unchanged** by the stock correction. | `SOURCE_DERIVED`, unchanged by this unit |
| 7 | Inventory valuation preconditions | `issueSourceValue` → `getBalance` reads `inventory_valuation_balances` — a **separate** table keyed `NONE:${warehouseId}:${productId}` (`server/modules/financial-inventory.js:60-76`) — and **not** the `inventory` table. With no valuation balance and `valuation_activated_at` NULL, the writer emits a `LEGACY_UNVALUED` movement with zero cost, so `cogsCents = 0` and **no COGS voucher** is written. This is **identical before and after** the stock correction. | `SOURCE_DERIVED`, unchanged by this unit |
| 8 | Strong-reservation availability | `assertStrongReservationAvailability` (`server/modules/planning-domain.js:662-671`) reads on-hand stock as `SUM(quantity)` over the pair (`server/modules/planning-domain.js:506-510`). Before the correction the sum after the first Delivery is `100 + (-1) = 99`; after the correction it is a single row of `99`. **Identical** ⇒ the correction introduces no new reservation pressure. | `SOURCE_DERIVED`, unchanged by this unit |
| 9 | Fixture cleanup and case isolation | `withMatrix` (`business-matrix.integration.js:67-74`) gives every case its own disposable schema through `createWave10MysqlLifecycle()`, and `handle.cleanup()` drops every object via `resetWave10CampaignSchema` (`server/test-utils/mysql-wave10-campaign-target.js:254-279`). No stock state leaks between cases; `M-BIZ-13` passing between the two failures corroborates it. | `SOURCE_DERIVED`, isolated |

**No statically discoverable contradiction remains after the stock correction.** Items 1–9 are either
unreachable, explicitly fail-loud, unchanged by the correction, or verified to pass.

### 10. Staged follow-up conditions

1. **Design** — the exact file whitelist, the new `seedWave10Inventory()` data flow, the single source
   of truth for the canonical `position_key`, the invariants, the SQLite/MySQL consistency argument,
   the negative and positive regression plan, the necessity of a protected Gate B re-run, the
   preconditions of the protected Full Acceptance, the explicit boundary between the fixture
   correction and the production risk, and the rollback — ending in a HARD STOP.
2. **Implementation** — only after a separate explicit authorization, confined to the fixture
   correction and its local regression.
3. **Protected Gate B** — only after a separate explicit authorization. The shared acceptance fixture
   **is** in the Gate B import closure, so the existing `WAVE10_GATE_B_PASS` transcript no longer
   covers the post-correction state and a Gate B re-run becomes **mandatory** before the final
   Acceptance review.
4. **Protected Full Acceptance** — only after the Gate B re-run passes and after a separate explicit
   authorization for exactly one `pnpm.cmd test:mysql:wave10` run against the dedicated disposable
   target, with the read-only preflight repeated first.

### 11. OPEN facts

```text
OPEN  the real-MySQL result of M-BIZ-12 and M-BIZ-14 after the fixture correction
OPEN  W10-INV-RISK-01 — the production out-bound availability read has no canonical
      position_key / owner / status filter and no deterministic row selection; both a false
      refusal (direction A) and a false allowance with a possible negative canonical balance
      (direction B) are source-reachable; it is NOT in this Fixture Implementation's
      production-code scope; the Final Freeze Review must close it or explicitly accept it
      under authorization; its production prevalence is TEST_EVIDENCE_PENDING
OPEN  RC-3 — credit_lock_anchors.policy_scope_id is declared VARCHAR(128) by the generic
      bootstrap path and LONGTEXT by the hand-written Wave 9 migration DDL (W10-PAR-R10)
OPEN  CG-3 — M-MIG-01 compares only the CHECK constraints of the two Wave 10 tables
OPEN  CREDENTIAL_EXPOSURE_OPEN
OPEN  WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN
OPEN  WAVE10_CLASSIFICATION_ALGEBRA_LOCAL_REGRESSION_ABSENT
OPEN  WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
```

### 12. Requirement addendum correction (2026-10-27)

The user authorized a **bounded** correction of this Requirement only — two corrections, no re-audit.
The correction is recorded here; the matching Design correction is recorded in
`solution.md` → §37.51.14. **Implementation remains unauthorized.**

| # | Correction | Before | After |
|---|---|---|---|
| C1 | **Test-suite layering** | the Requirement was silent on the suite registration, and the Design registered the new regression in `FAST` **and** `FULL` — against the manifest's own `FAST` criterion ("Must not require a temp SQLite or Vite SSR", `scripts/testing/test-suites.js:19-20`, `:573-575`), while `W10-INV-T01`..`T08` need the real database state, the canonical position identity and the deduction verification that `createTempDb()` supplies | **`W10-INV-R13`** fixes the classification to **`FULL` only**, forbids bypassing `createTempDb()` to qualify for `FAST`, and forbids changing any existing `FAST` / `FULL` / `HEAVY` classification; **`AC-INV-08`** states that the new regression is executed by `pnpm test` and is deliberately absent from `pnpm test:fast` |
| C2 | **`W10-INV-RISK-01` risk boundary** | the impact was described as "a false `库存不足` refusal … or an understated available quantity", and the write path was called "canonical and correct … so the observed failure mode is an over-refusal, not a stock corruption"; the Freeze impact pre-decided that the risk "does **not** block the Wave 10 Freeze by itself" | the impact now states **two directions** — **A** false refusal, and **B** false allowance followed by a possible negative canonical balance, the canonical upsert carrying no negative-balance guard (`server/lib/stock.js:60-89`); the Freeze impact now **pre-decides nothing** and requires the **Final Freeze Review** to record an explicit risk-disposition decision — closed through its own Requirement and Design, or explicitly accepted with a written justification under an explicit authorization |
| C3 | **Outcome classes in the regression** | the Requirement required discrimination (R12) but did not forbid presenting a known-risk reproduction as a pass of the new Fixture contract | **`W10-INV-R14`** requires the two classes to be distinguished per case and in the report, and makes the duplicate-row case `W10-INV-T05` deterministic by construction |

**Unchanged by this correction**: the shared-root-cause attribution (§3–§4, facts `P01`..`P12`); clauses
`W10-INV-R01`..`W10-INV-R12`; acceptance conditions `AC-INV-01`..`AC-INV-07`; the compatibility and
forbidden-change boundary (§7); the nine-item post-stock readiness audit (§9); the staged follow-up
conditions (§10); and the production Schema, migrations and inventory business implementation, none of
which are in scope for this unit.

**Requirement status: `WAVE10_INVENTORY_FIXTURE_REQUIREMENT_CORRECTED`.**
## Package B — Local Test Backend Isolation Requirement (2026-10-27)

### 1. Authorization, scope, and what this Requirement is not

The user confirmed the Inventory Correctness Audit (`INVENTORY_CORRECTNESS_AUDIT_READY`) and
approved exactly one Capability Gap to enter the governance flow:

`WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT`

Under AGENTS.md §4.0 the user granted one continuous authorization covering **Requirement →
Design** for this unit only. This section is the **Requirement** record. The matching **Design**
record is appended to `solution.md` as `§37.53`.

Explicitly **not** authorized by this unit, and **not** performed while producing this record:

- Implementation of any kind;
- any real MySQL connection, campaign, gate, or destructive operation;
- Git `add` / `commit` / `push` / `tag` / `merge` / `rebase` / `reset` / `restore` / `clean` /
  `stash`;
- any change to `package.json`, `APPLY_GUIDE.md`, an existing release tag, a frozen Wave 10
  business contract, a Credit / Inventory production module, the MySQL schema or any migration,
  or a Gate B / Wave 10 manifest;
- Wave 11 implementation, production release, deployment, or a Freeze.

The historical sections of this document that already record
`WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT` (`:10052`, `:10690`, `:11044`, `:11175`) are **not
modified**. Per AGENTS.md §12 and §5, this unit appends a new record and leaves history intact.

### 2. Confirmed problem statement

The ordinary test launcher does not isolate its child process from the developer's ambient
environment. The defect is confirmed by direct source reading, not by inference from a failure.

**Path A — `ERP_TEST_DB_BACKEND` selects a real MySQL target.**
`server/test-utils/temp-db.js:78` reads `process.env.ERP_TEST_DB_BACKEND` and, when it equals
`mysql`, resolves a MySQL configuration and opens a live MySQL database instead of a disposable
temporary SQLite database. The path is guarded by the disposable-target authorization
(`server/test-utils/mysql-disposable-target.js:17-39`), so it fails closed when the authorization
variables are absent — but the authorization variables are themselves ambient.

**Path B — `ERP_DB_BACKEND` makes `setupAdmin()` abandon the SQLite path it was given.**
`scripts/admin/setup-admin.mjs:72` derives the `backend` parameter from
`process.env.ERP_DB_BACKEND`, and `:93-100` branches on it: on `mysql` it calls
`createDatabaseFn()` with **no path**, so `server/db.js:574` resolves the configuration from the
environment and the caller-supplied `dbPath` is **discarded**. `server/setup-admin.test.js:76-84`
and `server/phase-e-accounting.test.js:208-209` call `setupAdmin()` without an explicit `backend`,
so an ambient `ERP_DB_BACKEND=mysql` sends the FULL suite's administrator creation to an ambient
MySQL target.

**Path C — an ambient `ERP_DB_PATH` breaks an existing passing test.**
`server/production-safety.test.js:19` spawns `reset-data` with `{ ...process.env, ...env }`. The
case *"development: NO ERP_DB_PATH → REFUSE (no default-repo fallback)"* (`:276-288`) supplies
only `NODE_ENV` and relies on `ERP_DB_PATH` being **absent** from the inherited environment. An
ambient `ERP_DB_PATH` makes that case target the ambient database instead of refusing.

**Path D — an ambient `ERP_DB_BACKEND` breaks an existing passing test.**
`server/setup-admin.test.js:320-333` asserts that `setupAdmin()` with `backend` omitted uses the
SQLite path and persists the user in SQLite. Under an ambient `ERP_DB_BACKEND=mysql` the default
becomes `mysql` and the assertion does not hold.

Paths C and D are significant beyond the reported defect: they mean an ordinary `pnpm test` on an
environment with a configured database can **fail**, and a failure of the isolation guard is
indistinguishable from a product regression.

**The ambient variables that can cause target drift are enumerable and closed.** Every
database-target-relevant environment variable read anywhere in `server/`, `scripts/` or `src/` is:
`ERP_DB_BACKEND`, `ERP_TEST_DB_BACKEND`, `ERP_DB_PATH`, `ERP_DB_HOST`, `ERP_DB_PORT`,
`ERP_DB_NAME`, `ERP_DB_USER`, `ERP_DB_PASSWORD`, `ERP_DB_SSL`,
`ERP_DB_SSL_REJECT_UNAUTHORIZED`, `ERP_SEED_DEMO`, `ERP_MYSQL_TEST_ALLOW_RESET`,
`ERP_MYSQL_TEST_DISPOSABLE_TARGET`, `ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS`,
`ERP_MYSQL_WAVE10_CAMPAIGN_ID`, `ERP_MYSQL_WAVE10_CAMPAIGN_LEASE`,
`ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID`, `ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER`,
`ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256`, `ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY`,
`ERP_MYSQL_WAVE10_INITIAL_INVENTORY`, and `ERP_RESET_PRODUCTION_OK`.

Three further variables are read by the code and are **not** database-target selectors:
`ERP_DB_TX_RETRY_MAX` (MySQL transaction retry ceiling — inert under SQLite),
`ERP_GATE_ATTEMPTS_MAX` and `ERP_GATE_ATTEMPTS_BUDGET_MS` (Sales Delivery confirmation retry
tuning — business behaviour, not target selection). They are outside the isolation boundary.

`NODE_ENV` is also read (`server/db.js:1852`, `server/reset-data.js:48`). It is not a target
selector: only the literal value `production` suppresses the demo seed. It is therefore **not**
part of the isolation boundary, and the isolated environment must reproduce the behaviour of the
known-good clean shell rather than impose a new `NODE_ENV` value.

### 3. Requirement clauses

**PB-ISO-R01 — One isolation boundary for every ordinary suite.**
The ordinary test launcher MUST establish a single, suite-independent environment boundary for
`FAST`, `FULL`, `HEAVY` and `ALL`. The boundary MUST NOT vary with the requested suite name, with
the resolved file list, or with the presence of `--filter` / `--list`.

**PB-ISO-R02 — The ordinary test child MUST be explicitly SQLite.**
Every ordinary test child MUST run with the SQLite backend explicitly selected. No ordinary test
may resolve a MySQL backend from ambient environment state. The selection MUST be explicit and
positive, not merely the absence of a competing variable.

**PB-ISO-R03 — Credentials, destructive authorization, and campaign identity MUST NOT be inherited.**
The ordinary test child MUST NOT inherit any MySQL connection credential or endpoint variable,
the disposable-target reset authorization, the destructive-operation approval, the production
reset sentinel, or any Wave 10 campaign lease or expected-identity variable. The complete list is
enumerated in §2 and is closed: it is derived from the code, not from the operating system.

**PB-ISO-R04 — `ERP_DB_PATH` MUST be absent from the ordinary test child.**
The ordinary test child MUST NOT inherit a database path, and specifically MUST NOT be able to
point at the repository default database or at any persistent user database. The variable MUST be
**absent**, not redirected: absence is what makes every code path that requires an explicit
database target fail closed rather than silently select one, and it is what the existing
`production-safety` case at `server/production-safety.test.js:276-288` already requires.

**PB-ISO-R05 — `setupAdmin()` MUST NOT drift to MySQL in the ordinary test environment.**
`setupAdmin()` invoked without an explicit `backend` MUST use the SQLite path supplied by its
caller. The requirement is satisfied by the isolated environment alone; the production CLI
behaviour of `scripts/admin/setup-admin.mjs` — where an operator selects MySQL through the
environment — MUST remain unchanged.

**PB-ISO-R06 — Production database resolution MUST NOT change.**
The isolation MUST NOT be achieved by altering the default behaviour of `createDatabase()` or
`resolveDatabaseConfig()`. Production backend and path resolution remains environment-driven and
fail-closed. The ordinary launcher is the only place where isolation is established.

**PB-ISO-R07 — The protected MySQL gates MUST be unaffected.**
The protected MySQL commands — `pnpm test:mysql`, `pnpm test:mysql:legacy`,
`pnpm test:mysql:concurrency`, `pnpm test:mysql:gate-a`, `pnpm test:mysql:gate-b`,
`pnpm test:mysql:wave10`, `pnpm test:mysql:performance`,
`pnpm test:mysql:finance-concurrency` — MUST keep their own launchers and their own explicitly
constructed child environments. They MUST continue to select MySQL and MUST continue to enforce
their own destructive-target and campaign-identity guards. The ordinary launcher's isolation MUST
NOT be inherited by them, and MUST NOT weaken them.

**PB-ISO-R08 — Suite semantics MUST be unchanged.**
The suite manifest classification, the on-disk test discovery, the file list handed to the test
runner, the `--list` behaviour, and the exit-code propagation from the test runner to the shell
MUST remain exactly as they are today. No existing `FAST` / `FULL` / `HEAVY` classification may
change, and no existing test file may move between suites.

**PB-ISO-R09 — No secret may be disclosed.**
The ordinary launcher MAY report which variables were removed or pinned, by **name and presence
only**. It MUST NOT print, log, echo, or encode the value of any environment variable — in
particular no password, no connection string, and no campaign lease.

**PB-ISO-R10 — Isolation failure MUST fail closed.**
If the isolated environment cannot be constructed, or if any variable named in §2 that MUST be
absent is found present in the constructed child environment, the launcher MUST abort the run with
a non-zero exit code and a diagnostic that names the offending **variable names** only. It MUST
NOT continue with a partially sanitized environment.

**PB-ISO-R11 — The parent process environment MUST NOT be mutated.**
The launcher MUST construct the isolated environment as a child-only artifact. It MUST NOT add,
delete, or overwrite any variable in its own `process.env`. This holds both for the ordinary test
child and for any in-process assertion the launcher performs.

**PB-ISO-R12 — No MySQL opt-in in the ordinary launcher.**
The ordinary launcher MUST NOT provide a switch, flag, or environment variable that re-enables
MySQL for the ordinary suites. Real MySQL execution continues to require the existing protected
commands, which carry their own explicit authorization. A contributor running `pnpm test` MUST NOT
be able to reach a real MySQL target by any means short of invoking a protected command.

**PB-ISO-R13 — The isolated environment MUST reproduce the known-good baseline.**
The isolated environment MUST be equivalent, for database-target purposes, to the clean-shell
environment under which the recorded `FAST` / `FULL` / `HEAVY` baselines were measured: SQLite
explicitly selected, no database path, no MySQL credential, no destructive authorization, and no
campaign identity. Existing test semantics — including the demo-seed decision, the
`reset-data` refusals, and the `setupAdmin()` default — MUST remain unchanged.

**PB-ISO-R14 — Cross-platform equivalence.**
The isolation MUST behave identically on Windows (PowerShell, `cmd`) and on Linux / macOS. It MUST
NOT depend on a shell, on a POSIX-only path form, or on the presence of any particular operating
system variable. The only operating-system variables it depends on are those the child process
inherits unchanged.

### 4. Acceptance conditions

The future Implementation MUST be verifiable against the following conditions. Each condition
names the evidence class it requires.

- **AC-ISO-01 (T01)** — Under a clean environment, an ordinary test child resolves the SQLite
  backend and reports the isolated backend status. *Pure-function / child-process probe.*
- **AC-ISO-02 (T02)** — With `ERP_TEST_DB_BACKEND=mysql` present in the parent environment, the
  ordinary test child still resolves SQLite, and the temporary-database helper takes its SQLite
  branch. *Child-process probe; **must not** open a MySQL connection.*
- **AC-ISO-03 (T03)** — With `ERP_DB_BACKEND=mysql` present in the parent environment, the
  ordinary test child still resolves SQLite. *Child-process probe.*
- **AC-ISO-04 (T04)** — With `ERP_DB_PATH` present in the parent environment, the ordinary test
  child does not carry it, and the existing `production-safety` case *"development: NO
  ERP_DB_PATH → REFUSE"* continues to hold. *Existing-test preservation plus child-process probe.*
- **AC-ISO-05 (T05)** — With MySQL credentials, the disposable-target authorization, the
  destructive-operation approval, the production reset sentinel, and the Wave 10 campaign lease
  and expected-identity variables all present in the parent environment, none of them is present
  in the ordinary test child. *Pure-function assertion over the complete §2 list.*
- **AC-ISO-06 (T06)** — `setupAdmin()` invoked without an explicit `backend` inside the ordinary
  test environment persists the administrator in the caller-supplied SQLite path and does not
  contact MySQL. *Existing-test preservation plus an explicit assertion.*
- **AC-ISO-07 (T07)** — The suite manifest, the on-disk discovery result, the resolved file list
  for `FAST` / `FULL` / `HEAVY` / `ALL`, and the exit-code propagation are unchanged. *Assertion
  over the manifest contract plus a non-zero-exit propagation check.*
- **AC-ISO-08 (T08)** — Every protected MySQL command entry point is unmodified and still
  selects MySQL through its own launcher. *Static contract assertion; **no** MySQL execution.*
- **AC-ISO-09 (T09)** — The isolation holds on Windows and on Linux / macOS, and depends on no
  shell-specific behaviour. *Static contract assertion over the child-environment construction.*
- **AC-ISO-10 (T10)** — The launcher reports the isolation status by variable **name** only; no
  environment variable value appears in its output. *Static assertion over the launcher's own
  reporting surface.*
- **AC-ISO-11 (T11)** — The launcher's own `process.env` is unchanged before and after the run.
  *In-process assertion.*
- **AC-ISO-12 (T12)** — The ordinary launcher exposes no MySQL opt-in: no flag, argument, or
  environment variable in its interface can cause a MySQL backend to be selected. *Static
  contract assertion.*

### 5. Compatibility and forbidden changes

**Compatible by construction.** The suite manifest is unchanged; no test file is added, removed,
or reclassified; `package.json` is unchanged; the production database resolution contract in
`server/db.js` and `server/database/config.js` is unchanged; `scripts/admin/setup-admin.mjs`
production CLI behaviour is unchanged; the protected MySQL launchers are unchanged; the recorded
`FAST` / `FULL` / `HEAVY` / build evidence remains the reference baseline.

**Forbidden in this unit.** Any change to `package.json`, `APPLY_GUIDE.md`, `AGENTS.md`,
`README.md`, the frozen Wave 10 business contracts, the Credit or Inventory production modules,
the MySQL schema or any migration, `scripts/testing/test-suites.js`, and any Gate B or Wave 10
manifest.

**Forbidden outcome.** The isolation must not be achieved by weakening an existing assertion, by
deleting a test, by reclassifying a suite, by skipping a case, by changing the production meaning
of `ERP_DB_BACKEND`, or by introducing an opt-in that lets the ordinary launcher reach MySQL.

### 6. Boundary, evidence class, and the disposition of this OPEN item

- **Evidence class.** Every statement in §2 is `SOURCE_DERIVED` from direct source reading, and
  is corroborated by two existing test cases that an ambient environment breaks
  (`server/production-safety.test.js:276-288` and `server/setup-admin.test.js:320-333`). No
  database was connected and no test suite was executed while producing this Requirement.
- **`WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT` remains OPEN.** This Requirement **registers the
  defect and its acceptance contract**; it does **not** close the item. The item may be closed
  only by an Implementation that satisfies §4 and an Acceptance that records the evidence.
- **No relation to `W10-INV-RISK-01`.** The inventory correctness risk is untouched by this unit;
  its `BLOCKS_RELEASE_ONLY` classification stands.
- **Relation to Wave 11.** Wave 11 local regression evidence must be produced in an environment
  this contract makes trustworthy. Package B is therefore a **recommended precondition** for Wave
  11 local acceptance, but it is **not** a Wave 11 development dependency and **not** a release
  blocker on its own.

**Requirement status: `PACKAGE_B_TEST_ISOLATION_REQUIREMENT_APPROVED`.**
