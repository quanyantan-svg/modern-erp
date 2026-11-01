# Wave 10 — Implementation Records

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## 37.35 Wave 10 Implementation Record (2026-10-24)

### 37.35.0 Authorization, scope and status

The user granted an explicit Wave 10 **Implementation** authorization under `AGENTS.md §4.4`.
This section records what was implemented. It does **not** re-decide any Credit business rule,
does not reopen `§36`, `§37.0–§37.34` or the Gate A freeze record, and does not declare
acceptance. `§37.34` is preserved verbatim.

```text
STATUS                     WAVE10_IMPLEMENTATION_READY_FOR_EXTERNAL_REVIEW
IMPLEMENTATION_COMPLETE    authorized implementation + its local verification only
WAVE10_ACCEPTANCE_NOT_DECLARED
GATE_A_FROZEN
GATE_B_NOT_RUN
WAVE11_NOT_STARTED
NO_GIT_WRITE
NO_DATABASE_OPERATION
```

### 37.35.1 Delivered files and their canonical responsibility

| File | Responsibility |
|---|---|
| `server/migrations/sales-customer-wave10-credit-check.js` | The two Wave 10 tables (`credit_check_results` §36.2.7, `credit_special_approval` §36.2.8), their SQLite / MySQL DDL, named indexes, dialect parity assertions and idempotent replay. Registered as `wave-10-credit-check` (wave 10) in `server/migrations/sales-customer-domain.js`. |
| `server/modules/credit-check.js` | `evaluateCredit()` — the `§36.6.3` runtime sequence, `resolveApplicableCreditScopes()` (§36.3.1), `computeCreditExposure()` (§36.3.2), the `§36.3.4` L2–L5 lock chain, the `§36.6.6` Special Approval consumption, the `POST /api/credit/check` and `GET /api/credit/check-results` surfaces. |
| `server/modules/credit-special-approval.js` | Credit Special Approval request / decide / list / detail, the authority ceiling, expiry, scope mode, SOD and idempotency (§36.6.6, §29.26). |
| `server/modules/credit-scope.js` | Added `requireCreditEvaluationAuthority()`, `requireCreditSpecialApprovalRequestAuthority()` and `requireCreditSpecialApprovalDecisionAuthority()` (§36.9.3 SC111, §34.7 P2 / P4). |
| `server/modules/sales-prepayment-gate.js` | `authorizeSalesPrepaymentGateWithPlan()` gained an optional `afterParentLock` callback. It fires after the L1 Finance PREPAYMENT parent lock and **before** the L6 gate-result lock, and also on the `NOT_REQUIRED` branch so that the Credit Check still runs when no prepayment requirement exists (§36.14.5 M19). The gate's own decision logic, evidence rows and error contracts are unchanged. |
| `server/modules/sales-orders.js` | The Credit Check is composed into the reserved L2–L5 window of the submit path, and the `approve` branch is split from `reject` and re-sequenced to `L1? → L2..L5 → L8` (§37.19.1). `reject` / `close` / `cancel` remain L8-only and are unchanged. |
| `server/app.js` | The Credit Check is composed into the L2–L5 window of the Sales Delivery Confirm path; the six Wave 10 routes are registered in `ownedRouteTable`. |
| `server/db.js` | Two new permission codes: `CREDIT_EVALUATE` and `CREDIT_SPECIAL_APPROVE`. The seeded role grants are **not** changed (§15.6); the final role matrix stays a Wave 12 obligation (§30.15.1). |
| `src/pages/credit-check.jsx` | The `credit-check` evaluate surface and the `credit-special-approvals` surface. |
| `src/navigation/applicationRegistry.js` | Two new contextual routes, both parented to `customers`, with no launcher tile (§36.9.5). |
| `server/sales-customer-wave10-credit-check.test.js` | The Wave 10 focused suite (36 cases). |

### 37.35.2 Runtime sequence actually implemented

`evaluateCredit()` executes `§36.6.3` steps 1–10:

```text
1  Credit Management enabled gate. CREDIT_MANAGEMENT_ENABLED is absent -> false -> no
   credit control, no evidence row, no audit row. The stage's effective rule set is
   resolved here; a stage with no applicable effective rule is not credit-controlled.
2  The logical check group is resolved from
   (source_ref, stage, business_date, authorization context, policy snapshot
   fingerprint, evaluated exposure digest). An exact replay resolves the same group and
   returns the stored result without a second row, audit row or effect.
3  Applicable control scopes (§36.3.1) and the credit object identity.
4  Anchors are provisioned and locked in the order POLICY_SCOPE -> AGGREGATE -> SALESPERSON
   (§36.4 integrated provisioning protocol). See B-13 for the position of the provisioning
   relative to the Finance PREPAYMENT parent lock.
5  Lock chain: L1 Finance PREPAYMENT parents (frozen discover -> plan -> lock -> assert),
   L2 POLICY_SCOPE FOR SHARE, L3 AGGREGATE anchor FOR UPDATE, L4 SALESPERSON anchor
   FOR UPDATE, L5 credit_profile FOR UPDATE.
6  PURE_DERIVED exposure per scope, then the control-strength evaluation.
7  credit_policy_snapshots insert-or-select, one row per scope, one shared fingerprint.
8  credit_check_results, one row per scope, one shared check_group_id.
9  Audit rows carrying the fingerprint and the business date.
10 The caller owns the transaction; a refusal rolls the whole chain back.
```

### 37.35.3 Exposure projection (PURE_DERIVED)

Exposure is computed inside the check transaction from canonical Sales and Finance facts only.
No `credit_exposure` table and no physical exposure cache exist.

```text
CUSTOMER AGGREGATE
  approved SO commitment   sales_orders APPROVED, commercial_close_state OPEN,
                           minus the confirmed delivery value of the same order
  delivered-not-settled    confirmed delivery value minus the AR amount that has
                           already transitioned out of that stage
  AR open                  account_receivables open_amount_cents, conversion_state OPEN
  offset                   the eligible PREPAYMENT amount read through the frozen
                           Finance adapter (aggregate only, never a sub-limit)

SALESPERSON SUB-LIMIT
  the same three components, restricted to what is PROVABLY_ATTRIBUTABLE to that
  salesperson, plus the SO stages of that salesperson's own orders
  no prepayment offset: Finance holds no salesperson dimension for advance money
```

A settled AR row (open amount zero) still proves the transition and is therefore never
counted twice. A consolidated AR row with no resolvable Sales source chain is counted in
full in the aggregate and is `ATTRIBUTION_AMBIGUOUS` for every sub-limit.

### 37.35.4 Bounded implementation decisions (recorded, not silently absorbed)

These points are not fixed by the approved Requirement and are recorded here as the
implementation's explicit reading.

```text
B-1  Credit object identity. The credit object is resolved from the customer's
     effective credit profiles. Zero effective profiles -> the canonical customer
     credit object ('CUSTOMER', customer_id), so the missing-profile fail-closed path
     is reached deterministically. More than one effective credit object -> fail
     closed with CREDIT_CREDIT_OBJECT_AMBIGUOUS (P6). No new business identifier is
     introduced.

B-2  Authority ceiling. authority_ceiling_cents is frozen at request time from the
     evaluated proposal of the bound check result: the approval can never authorise a
     credit ceiling above the amount that specific proposal required. It is therefore
     structurally incapable of becoming an unlimited or permanent bypass. The
     requested ceiling and the requested override may never exceed it.

B-3  Release boundary. A Special Approval releases a scope whose rule outcome is
     SPECIAL_APPROVAL_REQUIRED. A fail-closed BLOCK (missing profile, P5 not
     permitted, UNPROVEN_ATTRIBUTION, undefined overdue-day policy) is never released
     by an approval.

B-4  Decision authority. The request needs CREDIT_SPECIAL_APPROVE; the decision needs
     CREDIT_MANAGE, which is a different code and satisfies §34.7 P2. The
     requester/approver separation is enforced at decision time by comparing the
     approver with the requester recorded in the request audit row.

B-5  Overdue-day policy. CREDIT_SUB_LIMIT_OVERDUE_DAYS is unset and the profile
     carries no overdue_day_policy -> the policy is undefined and a mandatory
     sub-limit fails closed with OVERDUE_POLICY_UNDEFINED (§36.3.3). When the policy
     is defined, the overdue AR is already inside the AR open amount: overdue is a
     subset of C and is never additive (§29.23.2).

B-6  Stage enforcement. The check runs when the stage has at least one applicable
     effective rule. A stage with no effective rule is not credit-controlled and
     leaves no evidence. A missing or ambiguous enforceable profile fails closed in
     every case, so no scope is ever PASS by omission (§36.6.4).

B-7  Rule strength mapping. Over limit -> the strongest outcome among the applicable
     rules: scenario OVERRIDE_REQUEST -> SPECIAL_APPROVAL_REQUIRED, scenario
     WARNING_ONLY -> WARNING, scenario BLOCK -> BLOCK, scenario STANDARD -> the rule's
     control_strength. check_timing is recorded as evidence; Wave 10 defines a
     single inline BEFORE_WRITE enforcement point and no deferred surface.

B-8  Aggregated AR over count. A consolidated AR with no resolvable source cannot be
     released from an obligation stage, so the aggregate is conservative rather than
     apportioned. The ambiguity is surfaced as UNPROVEN_ATTRIBUTION, which is the
     designed remedy (§36.3.2.4). No amount is ever split or assigned.

B-9  Credit Profile status. §36.3.1 and §36.6.3 resolve a profile by effective date
     and existence. A profile whose status is not ACTIVE still binds its limit, which
     is the fail-closed direction. The business meaning of SUSPENDED / CLOSED is not
     fixed by the approved Requirement and stays an open Requirement question.

B-10 Exposure age window. No exposure-age window parameter exists in the approved
     Requirement and none is introduced: the projection covers every committed open
     obligation of the customer.

B-11 Check group identity. The check group id carries the evaluated exposure digest.
     A changed fact set therefore produces a new decision and a new evidence row
     instead of replaying a stale result.

B-12 Platform approval centre. §29.34 names a CREDIT_SPECIAL_APPROVAL approval family.
     The Platform approval centre mechanism assumes a status column with SUBMITTED
     and cannot carry the decision column of the Wave 10 table without changing the
     shared mechanism. Wave 10 therefore exposes the dedicated credit routes only; the
     Platform family remains a Wave 12 obligation.

B-13 Anchor provisioning position. §36.3.4 step 0 places the idempotent anchor
     provisioning before the Finance PREPAYMENT parent lock. The implementation performs
     the provisioning together with the anchor row lock at steps 3 and 4, that is after
     the Finance parent lock. The committed end state is identical (§36.4 step 2 and step 3
     are one convergent upsert), and the placement keeps the Finance PREPAYMENT parent
     strictly ahead of every Credit-owned row lock, which §36.3.4.1 C-3 requires. Two
     transactions that provision the same anchor therefore serialise on the Finance
     parent instead of forming an insert-intention / parent-lock cycle.
```

### 37.35.5 Lock-order composition

| Entrypoint | Sequence | Note |
|---|---|---|
| Sales Order submit | L1? → L2 → L3 → L4 → L5 → L6 → L7 → **L8** | The Credit Check runs inside the `afterParentLock` window. |
| Sales Order approve | L1? → L2 → L3 → L4 → L5 → **L8** | The approve path invokes no gate phase, so the Credit Check owns the L1 lock. §37.19.1 authorizes this re-sequencing. |
| Sales Order reject / close / cancel | **L8** only | Unchanged; no Credit, no gate. |
| Sales Delivery confirm | L1? → L2 → L3 → L4 → L5 → L6 → L7 → DELIVERY → **L8** | The Credit Check runs inside the `afterParentLock` window. |

The Credit Check takes no row lock on any Sales business row and no lock that would place
Sales rows ahead of L2–L5 (§36.3.4.1 C-2). The Finance PREPAYMENT parent is the first lock
the Credit Check itself takes, and it is always taken through the frozen discover → plan →
lock → assert pattern (§36.3.4.1 C-1).

### 37.35.6 Evidence produced by this implementation

```text
server/sales-customer-wave10-credit-check.test.js   36 cases, all PASS on SQLite
  migration contract, idempotent replay, Wave 11 absence
  S15   Credit Management gate, no-rule stage, missing mandatory profile fail closed
  UAT-S-31  SO commitment / delivered / AR / settled-AR stage transitions
  UAT-S-32  PASS / WARNING / BLOCK / SPECIAL_APPROVAL_REQUIRED, dual-limit control
  UAT-S-33  special approval request, decision, release, expiry, ceiling, duplicate
  S14   exposure never double counts; the sub-limit survives the SO -> AR transition
  S16   per-scope isolation, authority ceiling, expiry, requester/approver separation
  §36.6.1 / §37.19.1   the approve path is credit-controlled and a refusal leaves no evidence
```

The evidence level of these results is `STATIC_INTENT` plus single-session business
assertion on SQLite. They are **not** `PRODUCTION_SERIALIZED_OUTCOME` and they are **not**
`RAW_ROW_LEVEL_LOCK_ORDER` (§37.10 A–E).

### 37.35.7 Still open after this implementation

```text
OPEN  W10-R1..W10-R12 and R-SAL-12 / R-SAL-13 / R-SAL-14 remain BLOCKED. They require
      real independent-session MySQL contention and are discharged only by the protected
      Gate B campaign. No SQLite result in this record may be reported as race evidence.
OPEN  Gate B (B-COMPOSE / B-M9 / B-M10 / B-M11 / B-M12 / B-M15 / B-M19C) remains
      BLOCKED_BY_WAVE10 until the user accepts Wave 10 and the protected campaign runs.
OPEN  §36.5.4 / §36.5.5 I-3, I-4 and the full column-type parity for the six Wave 9
      tables are still not evidenced; the Wave 10 -> Wave 11 upgrade-path equivalence is
      likewise unevidenced (§37.34.7).
OPEN  LEGACY_DATA_EVIDENCE_PENDING: the read-only legacy Credit Profile inventory is
      still a separately authorized external operation and was NOT performed (§37.34.6).
OPEN  B-9 (Credit Profile status semantics) and B-10 (exposure age window) are
      Requirement questions that the approved Requirement does not close.
OPEN  The final Credit role matrix (§30.15.1) and the Platform CREDIT_SPECIAL_APPROVAL
      approval family (§29.34) are Wave 12 obligations.
```

### 37.35.8 Boundary

No Git write, no tag, no push, no release, no deploy, no MySQL connection, no Gate
execution, no database reset, no destructive operation and no `document.md` change was
performed by this implementation.

## 37.37 Wave 10 B-9 / B-10 / S14 Bounded Implementation Record (2026-10-24)

### 37.37.0 Authorization and boundary

The user explicitly authorized the consecutive bounded Implementation after the Requirement in
`document.md` and Design in §37.36. This record reports that implementation only. It does not
declare Acceptance or Freeze, does not execute Gate B or MySQL, and performs no Git write,
database migration, reset, release or deployment.

### 37.37.1 Implemented changes

- `resolveApplicableCreditScopes()` now rejects any currently resolved aggregate or salesperson
  Profile whose status is not `ACTIVE`. It returns the specific
  `CREDIT_PROFILE_NOT_ENFORCEABLE` error evidence before scope evaluation or Special Approval
  consumption, without changing the actor-free Wave 9 effective Profile resolver.
- `computeCreditExposure()` retains an approved SO commitment while its canonical
  `commercial_close_state` is `OPEN`; cancellation or controlled closure releases only the
  undelivered A-stage amount. Existing Delivery and AR facts remain independently authoritative.
  No age predicate, TTL, scheduler or cleanup path was added.
- Invoice-sourced AR now resolves through `sales_invoices` and
  `finance_invoice_source_links` to the Sales Delivery line, SO item and SO. The resolver validates
  invoice/customer/source identity, safe integer allocation, complete amount conservation and
  per-order predecessor capacity before releasing the delivered/provisional predecessor.
- The aggregate uses the Finance-owned AR header `open_amount_cents` exactly once. A full-open AR
  may use exact link allocations for salesperson attribution; a partially settled AR is attributed
  only when every positive source belongs to the same salesperson. A multi-salesperson residual is
  left ambiguous and uses the existing `UNPROVEN_ATTRIBUTION` fail-closed behavior.
- Missing, unknown, cross-customer or inconsistent invoice lineage throws
  `CREDIT_EXPOSURE_SOURCE_INCONSISTENT`. No Finance row is written and no guessed allocation or
  shadow exposure store was introduced.

### 37.37.2 Files changed in this bounded closure

```text
document.md
solution.md
log/2026-10-24.md
server/modules/credit-check.js
server/sales-customer-wave10-credit-check.test.js
```

`README.md`, schema, migrations, Finance writers, permissions, routes, Wave 9 resolver, Gate A and
Gate B files are unchanged by this closure.

### 37.37.3 Verification evidence

```text
Focused Wave 10 credit check                         50 / 50 PASS
Wave 9 credit foundation                            21 / 21 PASS
Wave 8 mixed Sales Delivery                          7 /  7 PASS
V2.2 Finance invoice lifecycle                       6 /  6 PASS
V2.2 Finance recognition production                  3 /  3 PASS
pnpm.cmd test:fast                                  427 / 427 PASS
pnpm.cmd test                                      2804 / 2804 PASS
pnpm.cmd test:heavy                                  67 /  67 PASS
pnpm.cmd build                                      PASS (1965 modules transformed)
git diff --check                                    PASS
```

The focused conservation evidence is:

```text
Mode A final AR                                      100000
Mode B before remediation                            200000
Mode B after remediation                             100000
Mode C provisional                                   100000
Mode C converted before remediation                  200000
Mode C converted after remediation                   100000
Mode B partial invoice                     60000 + 40000 = 100000
```

The focused suite also covers SUSPENDED/CLOSED aggregate and salesperson Profiles, ACTIVE
replacement, the Special Approval status fence, old unresolved SO retention, cancel/controlled
close transition behavior, partial collection, multi-salesperson ambiguity, missing/inconsistent
and cross-customer lineage, exact/nonmatching/global Recognition Mode rules and strongest-rule
selection.

### 37.37.4 Preserved open items and stop state

- The explicit customer/scenario exemption representation remains OPEN because the current schema
  has no selector. No exemption policy was invented.
- Real MySQL concurrency/locking, Gate B and the protected M9/M10/M11/M12/M15/M19-CREDIT evidence
  remain NOT_RUN and require separate exact-target authorization.
- Legacy external-data inventory remains outside this closure.
- User Acceptance / Freeze is not authorized and is not declared by this implementation record.

**Implementation state: `IMPLEMENTATION_LOCAL_REGRESSION_PASS — AWAITING_REAL_MYSQL_AUTHORIZATION_AND_USER_ACCEPTANCE`.**

## 37.38 Wave 10 MySQL Acceptance Infrastructure Implementation Record (2026-10-25)

### 37.38.0 Authorization and hard boundary

The user explicitly authorized the bounded implementation of real-MySQL acceptance infrastructure
for Wave 10. The authorization covers test code, fixtures, independent runners, package/test
manifests and necessary documentation only. It explicitly excludes every MySQL connection or
query, reset flag, reset/DROP, DDL/DML, migration execution, Gate A/Gate B execution, Git write,
release and deployment. No frozen business contract, production handler, schema, migration,
permission, state transition, Finance authority, L0 or L1-L8 order is changed by this record.

### 37.38.1 Implemented ownership and command surface

```text
scripts/gates/mysql-sales-wave10-manifest.mjs
  fixed Wave 10 suites, W10-R1..R12, R-SAL aliases, seven Gate B cases and evidence levels

scripts/gates/mysql-wave10-runner-support.mjs
  exact disposable-target guard, per-suite reset, sequential strict TAP, fail-fast handling,
  final cleanup and zero tables/views/triggers/routines/events assertion

scripts/gates/mysql-sales-wave10-acceptance.mjs
  pnpm.cmd test:mysql:wave10
  W10-PARITY -> W10-RACES

scripts/gates/mysql-sales-wave10-gate-b.mjs
  pnpm.cmd test:mysql:gate-b
  independent Gate B production-race suite -> seven-case Gate B suite -> execution-derived M-board
```

The Gate B runner parses exactly seven successful execution markers emitted only after the
corresponding assertions complete. Missing, duplicate, extra or evidence-level-mismatched markers
fail the runner. It does not contain a static PASS board. Gate A and its frozen manifest are not
imported or modified.

### 37.38.2 Fixture coverage

- `server/mysql-sales-customer-wave10.integration.js` covers real-MySQL fresh bootstrap, exactly
  two Wave 10 tables, InnoDB and constraint metadata, the complete ordered physical type signature
  of all six Wave 9 tables, simulated existing Wave 9 -> Wave 10 additive upgrade, repeated
  idempotent replay, I-4 pre/post value preservation and dynamic I-3 orphan checks over every
  physical FK edge of the eight Credit tables.
- `server/mysql-sales-customer-wave10-concurrency.integration.js` defines twelve separately named
  W10-R1..W10-R12 cases and the R-SAL-12/13/14 aliases. Each race starts two OS processes, each
  holding a dedicated `MySqlSyncAdapter` connection. Production-result cases call the actual Credit,
  Sales Order, Credit Profile, Credit Policy, Special Approval and Finance AR paths. ONLY_ONE_FITS
  assertions state their capacity inequalities before asserting one winner. Common checks reject
  duplicate result/approval effects and close every worker session in `finally`.
- `scripts/gates/mysql-concurrency-sales-wave10-worker.mjs` is the one-session worker. Raw
  `FOR UPDATE` actions are isolated from production actions and are classified only as
  `RAW_ROW_LEVEL_LOCK_ORDER`.
- `server/mysql-sales-customer-wave10-gate-b.integration.js` owns the seven fixed Gate B case
  assertions and emits their evidence markers. B-COMPOSE remains `STATIC_INTENT`; B-M15 remains
  `RAW_ROW_LEVEL_LOCK_ORDER`; the other five cases remain `PRODUCTION_SERIALIZED_OUTCOME`.
- `server/test-utils/wave10-mysql-acceptance-fixture.js` owns bounded seed data, explicit capacity
  inputs and side-effect projections. It contains no connection configuration and cannot authorize
  a target.
- `scripts/mysql-sales-wave10-runners.test.js` is the only new unconditional suite entry. It is a
  pure source-contract test and proves runner separation, fixed manifests, guard/cleanup/TAP
  wiring, Gate A immutability and package command mapping. Real MySQL files remain outside
  FAST/FULL/HEAVY and are reachable only through the protected runners.

### 37.38.3 Local verification and non-executed evidence

```text
node --check (all ten new JS/MJS files)                         PASS
Runner source-contract                                         6 / 6 PASS
Focused Runner + Wave 10 + Wave 9                              77 / 77 PASS
pnpm.cmd test:fast                                            427 / 427 PASS
pnpm.cmd test                                                2810 / 2810 PASS
pnpm.cmd build                                      PASS (1965 modules transformed)
```

`pnpm.cmd test:heavy` was not run because the repository HEAVY classification contains a
real-MySQL environment test and this authorization prohibited every MySQL connection. Neither
`test:mysql:wave10` nor `test:mysql:gate-b` was executed. Therefore the infrastructure is ready for
external review, but fresh-init/upgrade/parity, independent-session outcomes, Gate B PASS, cleanup
and the M-board remain **test evidence pending**, not accepted facts.

### 37.38.4 Stop state

No Acceptance/Freeze is declared. The next permitted step is external review. A later real-MySQL
campaign requires a new authorization naming the exact disposable identity, exact commands and
destructive operations. Wave 11/12, legacy-data compatibility and the explicit exemption selector
remain outside this implementation.

**Status: `WAVE10_MYSQL_ACCEPTANCE_INFRASTRUCTURE_READY_FOR_EXTERNAL_REVIEW`.**

## 37.40 Wave 10 MySQL Acceptance Infrastructure Remediation Implementation Record (2026-10-25)

### 37.40.0 Authorization and boundary

This section records the implementation of the approved §37.39 Remediation Design
(`document.md` "Wave 10 MySQL Acceptance Infrastructure Remediation Requirement (2026-10-25)",
`W10-AIR-R01`–`W10-AIR-R10`) and of the approved §37.39.6.3 M-R01 Design Precision Correction.
It changes no approved Requirement and no approved Design text; §§37.39 and 37.39.6.3 stand
unchanged.

The stage authorized local implementation and local-only verification only. MySQL access, queries,
resets, DDL, DML, migrations, every `test:mysql*` command, Gate A, Gate B, the Wave 10 Acceptance
campaign, Git writes, version/release/deploy and Wave 11/12 remained prohibited. The destructive
acknowledgement environment was stripped from every child process.

No production business module, migration, schema, permission, status machine, lock order,
transaction primitive, idempotency contract, package version or Gate A file was changed. The only
non-Wave-10-infrastructure file touched is one Wave 10 SQLite test fixture, for the calendar
boundary defect recorded in §37.40.7.

### 37.40.1 Delivered behaviour

| Requirement | Delivered behaviour | Primary files |
|---|---|---|
| R01 | One case id, one owner and one manifest-declared evidence level per Gate B case; the typed marker is emitted only after that case's own production actions and persistent postconditions; the reducer rejects missing, duplicate, extra, wrong-level, wrong-owner, wrong-run, digest-mismatched and foreign-suite records; the board is rendered only after every suite, the final cleanup and the zero-object confirmation succeed. | `scripts/gates/mysql-sales-wave10-gate-b.mjs`, `scripts/gates/mysql-sales-wave10-manifest.mjs`, `server/mysql-sales-customer-wave10-gate-b.integration.js` |
| R02 | Exact password-free target identity, verified `SELECT DATABASE()`, `CURRENT_USER()`, `@@server_uuid` and the MySQL 8 version policy, a SHA-256 grant fingerprint, the `EMPTY_ONLY` first-inventory policy, a campaign lease with contention handling and release, revalidation before every reset and cleanup, lease revocation on identity drift, five-category object inventory, identifier and type validation, views before base tables, FK-check restoration, and a bounded secret-free report form. | `server/test-utils/mysql-wave10-campaign-target.js` |
| R03 | A finite per-suite deadline, child-timeout detection, cooperative shutdown followed by a platform process-tree termination, bounded exit confirmation, no cleanup while a child may still be live, truthful exit and signal recording, and a typed terminal result for spawn error, non-zero exit, malformed TAP, cleanup failure and final-inventory failure. The unconfirmed-termination path reports `NOT_ATTEMPTED_CHILD_LIVE`. | `server/test-utils/mysql-wave10-process-lifecycle.js`, `scripts/gates/mysql-wave10-runner-support.mjs` |
| R04 | Every race uses independent `CONNECTION_ID()` sessions and a deterministic coordinator that holds the production L0 gate row while both contenders are observed pending through `performance_schema.data_lock_waits`; the coordinator supports N contenders. | `server/test-utils/wave10-mysql-acceptance-fixture.js`, `server/mysql-sales-customer-wave10-concurrency.integration.js` |
| R05 | The capacity classification is read from the canonical Wave 9 effective-date resolver and the production exposure projection, and every fixture business date is derived from the actual run date because the exposure window reads `SUBSTR(reviewed_at,1,10)<=businessDate`. | `server/test-utils/wave10-mysql-acceptance-fixture.js` |
| R06 | The source side is the actual canonical SQLite snapshot; the normalized comparison now covers column defaults and CHECK clauses in addition to columns, nullability, primary keys, foreign keys and indexes; M-MIG-01 asserts the Wave 10 additions keep their InnoDB, foreign-key and check expectations. | `server/test-utils/wave10-mysql-schema-fixture.js`, `server/mysql-sales-customer-wave10.integration.js` |
| R07 | The projection compares rows by identity and field value; the rejection cases assert an empty forbidden delta across the complete declared union rather than an unchanged row count. | `server/test-utils/wave10-mysql-acceptance-fixture.js` |
| R08 | M-BIZ-01..20 exist and cover B-9 O2, B-10 O1, S14 Mode B/C and Recognition Mode; the B-10 cancellation uses the canonical production `salesOrderAction(..., 'cancel')` writer and every remaining direct DML is declared as a bounded reference fact. | `server/mysql-sales-customer-wave10-business-matrix.integration.js` |
| R09 | The Wave 10 transcript parser requires one TAP version, one complete top-level plan, one syntactically complete record per plan entry with contiguous ids, exactly one occurrence of each summary counter, `tests >= 1`, `pass == tests`, zero fail/skip/cancelled/todo, a finite duration, no bail-out, no malformed record and no trailing partial record; 43 local behavior tests cover the guard, the lifecycle, the transcript, the marker grammar and the isolation. | `scripts/gates/mysql-wave10-tap-transcript.mjs`, `scripts/mysql-sales-wave10-runners.test.js` |
| R10 | Gate A stays frozen, is not imported and is not executed by either Wave 10 runner; the real-MySQL suites stay outside FAST/FULL/HEAVY. | `scripts/gates/mysql-sales-wave10-manifest.mjs`, `scripts/testing/test-suites.js` |

### 37.40.2 The corrected M-R01 contract as implemented

`M-R01` now runs the audited production entry `salesOrderAction(db, req, res, actor, orderId,
'approve')` → `approveSalesOrder()` (`server/modules/sales-orders.js:877` / `:799`) over two
independently identified `SUBMITTED` orders. The two orders are declared setup reference facts and
the `APPROVED` commitment is created only by the production approve path; the superseded
two-`evaluateCreditCheck` contract is not used anywhere.

The capacity precondition is computed before the coordinated start from the effective Credit
Profile limit and the canonical exposure `E`, so `available = limit − E` is a real value. The
BOTH_FIT subcase uses limit 250000 and the ONLY_ONE_FITS subcase limit 150000 against two 100000
orders, which makes `amountA + amountB > available` hold against the actual capacity.

The coordinator holds `mysql_transaction_gates` `gate_id=1` and both contenders must be observably
pending on that row before the release. After the release the two production transactions
serialize on the production L0 gate and then on the L3/L4 anchors and the L5 Credit Profile lock,
so the loser re-reads the exposure after the winner committed under the production `READ COMMITTED`
session isolation.

The asserted outcomes are the existing public contracts only: HTTP 200 `{ ok: true, id, action:
'approve' }` for the winner with `status='APPROVED'`, `reviewer_id` and `reviewed_at` set, and
HTTP 409 `CREDIT_CHECK_BLOCKED` with `decision: 'BLOCK'`, `reasonCodes` containing `OVER_LIMIT`,
`checkGroupId` and `scopeResults` for the refused contender. The assertions additionally reject
the forbidden setup, authorization and environment refusals listed in §37.39.6.3 D.4, the combined
committed commitment is asserted `<= available`, the refused transaction's forbidden delta across
the declared union is asserted empty, the winner's audit and idempotency cardinality is asserted
exactly, the refused order keeps its `SUBMITTED` state, the exposure-window invariant
`date(reviewed_at) <= businessDate` is asserted, and an exact replay of the winner's
`Idempotency-Key` is asserted to return the stored result with `replayed: true` and to create no
second effect.

### 37.40.3 B-M19C as implemented

The real production entry rejects with the existing `CREDIT_PROFILE_MISSING` contract. The bounded
runtime trace proves the actual stop boundary: the Profile resolution is reached, the L2–L5
anchor/Profile lock chain is never entered, no `credit_check_results` row is written and no audit
fact is written. The complete before/after projection is unchanged, and the case records
`reachedL2L5: false`. §37.39.6.3 and §37.39.7 no longer require L2–L5 to be reached and this case
makes no such claim.

### 37.40.4 Declared setup facts and the one residual gap

`createSalesDelivery` (`server/app.js:5619`) is the canonical confirmed-delivery writer and it is
module-private, so it is not reachable from the approved test file set. The historical delivery,
invoice-lineage and receivable rows, the controlled commercial close of a partially delivered
order, and the Credit Profile reference rows (a Profile status change has no production writer)
are therefore declared direct-DML reference facts in the suite headers. Every decision assertion
still calls the production Credit evaluator, the production exposure resolver, the production
mandatory guard or the production Sales Order writer.

The M-R09 transition creates its `APPROVED` order through the canonical Sales Order creation,
submission and approval path and declares only the delivery and AR rows.

`RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN` and `LEGACY_DATA_EVIDENCE_PENDING` remain
OPEN. No exemption selector was invented and no Wave 10 business semantic was altered.

### 37.40.5 Local verification evidence

```text
node --check on every modified JavaScript/MJS file         PASS
node --test scripts/mysql-sales-wave10-runners.test.js     43 tests, 43 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled
node --test server/sales-customer-wave10-credit-check.test.js   50 tests, 50 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled
pnpm.cmd test:fast                                         exit 0 — 427 tests, 427 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled
pnpm.cmd test  (FULL)                                      exit 0 — 2847 tests, 2847 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled
pnpm.cmd build                                             PASS — 1965 modules transformed
git diff --check                                           exit 0
```

`pnpm.cmd test:heavy` was not run: the HEAVY inventory contains a real-MySQL environment test and
the registry was not altered to make that command appear safe.

### 37.40.6 Not executed and still pending

```text
MySQL connection, query, reset, DDL, DML, migration, cleanup   NOT_RUN
Gate A                                                          FROZEN, NOT_RERUN
Gate B                                                          NOT_RUN
Wave 10 Acceptance campaign                                    NOT_RUN
M-board real execution evidence                                TEST_EVIDENCE_PENDING
Server UUID, CURRENT_USER, grant fingerprint, initial inventory OPEN — REQUIRES SEPARATE AUTHORIZATION
LEGACY_DATA_EVIDENCE_PENDING                                   OPEN
RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN             OPEN
Wave 10 user Acceptance and Freeze                             OPEN
```

### 37.40.7 The repaired pre-existing fixture defect

The first focused run failed five cases in `server/sales-customer-wave10-credit-check.test.js`
(`UAT-S-31` ×2, `B-10 O1`, `S14`, `§36.6.3 step 2`). The cause is a calendar-boundary defect in
that test's own fixture: `seedOrder` stamped `reviewed_at` with the wall clock while the fixture's
business date is the fixed constant `2026-10-24`, so once the clock passed that date the exposure
window `SUBSTR(reviewed_at,1,10)<=businessDate` excluded the seeded approved order and the
approved commitment silently dropped out of every affected projection. The repair places the
approval stamp on the order's own business date, the only business-consistent value. No assertion
was weakened, removed or relaxed and no production module was touched. The same defect class was
removed from the Wave 10 MySQL fixture by deriving the business date from the actual run date.

**Implementation status: `WAVE10_IMPLEMENTATION_COMPLETE_LOCAL_VERIFICATION_PASS_AWAITING_MYSQL_ACCEPTANCE_AUTHORIZATION`.**
**Stop state: `MYSQL_ACCEPTANCE_NOT_RUN`; `GATE_A_FROZEN`; `GATE_B_NOT_RUN`;
`WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED`; `WAVE11_NOT_STARTED`; `WAVE12_NOT_STARTED`;
`NO_GIT_WRITE`; `NO_DATABASE_OPERATION`.**

## 37.42 Wave 10 MySQL least-privilege readiness implementation record (2026-10-25)

Implementation followed §37.41 without changing Gate A or business semantics. The Guard now
accepts only global `USAGE`, the exact eleven target-schema privileges and exact table-level
`SELECT` on the three lock-observation tables; it rejects missing/extra privileges, unrelated
scope, dynamic/global administration, delegation, roles and unknown grant syntax. `TRIGGER` and
`CREATE VIEW` are mandatory. Identity, independently supplied digest and inventory checks remain
in the existing fail-closed lifecycle.

The canonical Finance helper now replaces an existing View definition before recreating it, while
retaining the defensive legacy-table removal. The live MySQL factory calls it after snapshot table
bootstrap and before Sales migration replay. Existing cleanup already drops Views before tables.

Local verification ran with all MySQL and destructive variables removed:

```text
syntax checks                                      PASS
focused Guard/View/Wave9/Wave10/Finance            132 / 132 PASS
FAST                                                427 / 427 PASS
FULL                                               2852 / 2852 PASS
build                                               1965 modules PASS
git diff --check                                    PASS
Gate A scoped diff                                  0 bytes
```

The dedicated account was absent, then was created as
`modern_erp_wave10@127.0.0.1` with a process-memory random password. Its grant digest is
`45e5fb73fa02562efc0828d5fe6feb153a55fbeff742f05fcda50136b872b44c`; server UUID is
`5d3c6a68-b8a5-11f1-8ce6-b025aa71d167`. Read-only preflight proved MySQL 8.0.37, exact identity,
zero roles, Guard PASS, all three Performance Schema reads, own PROCESSLIST visibility and zero
tables/views/triggers/routines/events. The password was not persisted. No target-schema statement,
Gate A/B or Acceptance command ran.

**Implementation status: `WAVE10_MYSQL_PREFLIGHT_READY_AWAITING_ACCEPTANCE_CAMPAIGN_AUTHORIZATION`.**

### 37.40.8 Canonical production writer remediation continuation (2026-10-25)

#### 37.40.8.1 Authorization and scope

The Canonical Delivery Writer Reachability Audit established that the module-private
`createSalesDelivery` (`server/app.js:5619`) is reachable through the registered production route
`POST /api/sales-deliveries` (`server/app.js:2654`) and that the confirmation action is reachable
through `POST /api/sales-deliveries/:id` (`server/app.js:2658`). No production export, new
production service or business semantic is required. This subsection records the implementation that
brings the Wave 10 acceptance fixtures into conformance with the approved canonical-writer
requirement. It adds no Requirement and changes no approved Design text.

Code changes are confined to the four files of the approved §37.39.2 table that carry the Wave 10
acceptance fixtures:

| File | Change |
|---|---|
| `server/test-utils/wave10-mysql-acceptance-fixture.js` | The canonical HTTP adapter (`wave10HttpResponse`, `wave10HttpRequest`, `wave10HttpLogin`), the canonical Delivery request builder, a login-capable fixture account, the initial inventory and cash settlement account reference rows, a quantity parameter on the production order body, and the removal of the two noncanonical substitute writers. |
| `scripts/gates/mysql-concurrency-sales-wave10-worker.mjs` | The `http-request` worker action, which drives the real `createApp(db)` handler after a real `POST /api/auth/login`. |
| `server/mysql-sales-customer-wave10-concurrency.integration.js` | M-R03 and M-R09 now use the canonical Sales Order and Delivery transitions. |
| `server/mysql-sales-customer-wave10-business-matrix.integration.js` | M-BIZ-05..M-BIZ-14 now use the canonical Sales Order, Delivery, invoice and collection transitions. |

#### 37.40.8.2 The canonical Delivery route and its authentication contract

The Delivery transition is exercised over the production HTTP dispatch, not by importing the private
function. `createApp(db)` (`server/app.js:2249`) returns the real application handler; the fixture
supplies a request/response adapter that satisfies the observed application contract — `setHeader`,
`removeHeader` (`server/lib/http.js:171`), `once('finish')` (`server/app.js:2263`) and `end`
(`server/lib/http.js:158`). `readJson` consumes the request as an async byte stream and requires a
`application/json` content type (`server/lib/http.js:82`).

The worker authenticates through `POST /api/auth/login` (`server/app.js:2305`), which verifies the
password with `verifyPassword` (`server/db.js:305`), inserts the `sessions` row
(`server/app.js:3188`) and returns a bearer token. The authenticated request then passes
`authenticate` (`server/app.js:2308`) and `allow(actor, 'SALES_DELIVERIES_MANAGE')`
(`server/app.js:5620`, `:5713`). The fixture accounts use the existing permitted `role-admin` role,
which already carries every permission (`server/db.js:1729`). The credential is a test-only
constant inside the fixture module; it is never printed, logged or persisted in generated evidence.

#### 37.40.8.3 Replaced noncanonical business mutations

| Case | Removed direct mutation | Canonical writer now used |
|---|---|---|
| M-R03 | `INSERT INTO sales_deliveries(status='CONFIRMED')` + `sales_delivery_items`; directly inserted APPROVED order | `createSalesOrder` → `salesOrderAction('submit')` → `salesOrderAction('approve')`; `POST /api/sales-deliveries` → `POST /api/sales-deliveries/:id` (`SEPARATE` billing); the existing canonical invoice create/post worker actions |
| M-R09 | directly inserted CONFIRMED delivery and a directly inserted `SALES_ORDER`-sourced receivable | canonical order lifecycle; `POST /api/sales-deliveries` → confirmation with `LEGACY_DIRECT` billing, whose production recognition writer creates the final AR |
| M-BIZ-05, M-BIZ-06 | directly inserted APPROVED order | canonical order create/submit/approve |
| M-BIZ-07 | directly inserted CONFIRMED delivery; `UPDATE sales_orders SET commercial_close_state='CLOSED'` | canonical delivery create/confirm; canonical `salesOrderAction('close')` |
| M-BIZ-08 | `UPDATE account_receivables SET paid_cents, open_amount_cents, status` | `POST /api/payment-collections` → `POST /api/payment-collections/:id/confirm` |
| M-BIZ-09..M-BIZ-13 | directly inserted CONFIRMED delivery, POSTED invoice, `finance_invoice_source_links` and receivable | canonical delivery create/confirm; canonical `createSalesInvoice` + `postSalesInvoice` |
| M-BIZ-14 | the same, plus two directly inserted `finance_invoice_source_links` rows | canonical deliveries for two salespersons invoiced on one canonical invoice header, then a canonical collection |
| M-BIZ-11 | directly written receivable open amount | canonical collection allocation and its production balance refresh |

The two noncanonical substitute writers `seedConfirmedDelivery` and `seedPostedInvoiceLineage` were
removed from the fixture because no call site remains.

#### 37.40.8.4 Remaining direct DML, classified as intentional reference or negative fixtures

- The Credit Profile, rule, parameter and lock-anchor reference rows, and the `SUSPENDED`/`CLOSED`
  Profile status transitions of M-BIZ-02 and M-BIZ-03 — a Profile status change has no production
  writer.
- The DRAFT Sales Order rows that serve only as the credit check's source reference.
- The historical approval stamp of M-BIZ-05 — no production writer creates a 2010 document.
- The manual receivable and the overdue due date of M-BIZ-08 — a receivable reference fact that is
  settled canonically afterwards.
- The deliberately broken invoice lineage of M-BIZ-15 — the negative fixture that proves an
  inconsistent lineage fails closed.
- The initial inventory row and the cash settlement account — master reference data that the
  canonical writers read. They are never evidence that a business transaction occurred.
- The SUBMITTED reference orders of M-R01 and the M-R09 proposal — a proposal precondition, not the
  transition under acceptance.

#### 37.40.8.5 The canonical side effects the fixtures now produce

The canonical paths create state the former direct-SQL fixtures did not, and the assertions were
recalculated against the real business outcome rather than the synthetic totals:

- `sales_deliveries` and `sales_delivery_items` with the production source mode, billing mode,
  confirmation actor and confirmation timestamp, plus the delivery-scoped
  `finance_recognition_policy` row.
- The on-hand inventory deduction, the `inventory_transactions` rows, the tracked source movements
  and the source-value issuance with the COGS system voucher.
- `finance_invoice_source_links`, one per confirmed delivery line, produced by the production
  recognition writer instead of a direct insert.
- `account_receivables` with `item_class='SOURCE'`, `item_kind='FINAL'`, the invoice or delivery
  source chain and `open_amount_cents` as the authoritative outstanding balance.
- `payment_collections`, `payment_collection_items`, the settlement voucher and the settlement
  movement, with the receivable outstanding balance refreshed by the production settlement writer.
- The delivery, invoice, collection and confirmation `audit_logs` facts and the corresponding
  `idempotency_records`.

The invariants are preserved: no duplicate credit exposure, no double release of a predecessor
obligation, `open_amount_cents` remains the authoritative balance, no speculative allocation, no
prohibited side effect on a rejected operation, and no duplicate audit or idempotency effect on an
exact replay.

#### 37.40.8.6 Local verification

```text
node --check on the four modified files                      PASS
node /tmp/w10-http-smoke.mjs (adapter contract, no database) PASS
node --test scripts/mysql-sales-wave10-runners.test.js
  server/sales-customer-wave9-credit-foundation.test.js
  server/sales-customer-wave10-credit-check.test.js         114 tests, 114 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled
pnpm.cmd test:fast                                           exit 0 — 427 tests, 427 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled
pnpm.cmd test (FULL)                                         exit 0 — 2847 tests, 2847 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled
pnpm.cmd build                                               PASS — 1965 modules transformed
git diff --check                                             exit 0
```

The canonical Delivery, invoice, collection and race suites are protected real-MySQL files. They are
not registered in FAST, FULL or HEAVY and cannot be executed in this stage, so their behaviour is
code-verified only. `pnpm.cmd test:heavy`, every `test:mysql*` command and every Gate campaign were
not run.

#### 37.40.8.7 Remaining MySQL-only evidence gaps

```text
Canonical Delivery create/confirm over the real route          TEST_EVIDENCE_PENDING
Canonical invoice posting, source links and AR recognition     TEST_EVIDENCE_PENDING
Canonical collection settlement and balance refresh            TEST_EVIDENCE_PENDING
Canonical close, cancel and the resulting exposure arithmetic  TEST_EVIDENCE_PENDING
All W10-R1..R12 races, Gate B markers and the M-board           TEST_EVIDENCE_PENDING
Server UUID, CURRENT_USER, grant fingerprint, initial inventory OPEN — REQUIRES SEPARATE AUTHORIZATION
LEGACY_DATA_EVIDENCE_PENDING                                   OPEN
RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN             OPEN
Wave 10 user Acceptance and Freeze                             OPEN
```

**Continuation status: `WAVE10_CANONICAL_WRITER_REMEDIATION_LOCAL_VERIFICATION_COMPLETE_AWAITING_MYSQL_ACCEPTANCE_AUTHORIZATION`.**
**Stop state: `MYSQL_ACCEPTANCE_NOT_AUTHORIZED`; `GATE_A_FROZEN`; `GATE_B_NOT_RUN`;
`WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED`; `WAVE11_NOT_STARTED`; `WAVE12_NOT_STARTED`;
`NO_GIT_WRITE`; `NO_DATABASE_OPERATION`.**

### 37.40.9 Real MySQL Acceptance campaign result (2026-10-25)

The user authorized one controlled campaign against only
`modern_erp_domain_test` through `modern_erp_wave10@127.0.0.1`. Each executable round rotated an
ephemeral in-process password, re-ran the fail-closed target Guard, used the canonical reset and
cleanup lifecycle, and independently proved zero tables, views, triggers, routines and events after
both commands. The observed target identity remained MySQL 8.0.37, server UUID
`5d3c6a68-b8a5-11f1-8ce6-b025aa71d167`, with normalized grant digest
`45e5fb73fa02562efc0828d5fe6feb153a55fbeff742f05fcda50136b872b44c`.

Three bounded remediation rounds corrected defects exposed only by the real MySQL path:

- the canonical finance open-item View replacement now drops the old View and uses valid MySQL
  `CREATE VIEW` syntax;
- Wave 10 unique-key parity compares ordered unique column sets instead of backend-generated
  constraint names;
- fresh MySQL bootstrap maps `credit_special_approval.scope_mode` to the approved `VARCHAR(128)`
  physical contract;
- the Acceptance fixture consumes the canonical Wave 9 global policy anchor instead of inserting a
  duplicate; and
- foreign-key metadata queries qualify every joined Information Schema column.

After each remediation round, the affected focused suite and the required local gates passed. The
final local evidence is focused 133/133, FAST 428/428, FULL 2853/2853, build 1965 modules and
`git diff --check` PASS.

The final real-MySQL round remains blocked:

```text
pnpm.cmd test:mysql:gate-b   exit 1
  W10 production races      12 total, 4 pass, 8 fail
  PASS                      M-R04, M-R08, M-R10, M-R12
  FAIL                      M-R01, M-R02, M-R05, M-R06, M-R11
                            WAVE10_WAIT_EVIDENCE_UNAVAILABLE: mysql_transaction_gates
  FAIL                      M-R03, M-R09
                            canonical order path returned 409 SALES_PARAMETER_UNAVAILABLE
  FAIL                      M-R07
                            ER_BAD_FIELD_ERROR: unknown column scope_type
  Gate B cases/markers      NOT_RUN — prerequisite production-races suite failed
  M-board                   NOT_GENERATED

pnpm.cmd test:mysql:wave10  exit 1
  W10 parity                7 total, 4 pass, 3 fail
  PASS                      M-MIG-03, M-MIG-04, M-MIG-05, M-MIG-07, M-MIG-08
  FAIL                      M-MIG-01, M-MIG-02 — CHECK expression normalization mismatch
  FAIL                      M-MIG-06 — fresh/upgrade physical type and index-name drift
  W10 races/business matrix NOT_RUN — prerequisite parity suite failed
  M-BIZ-01..M-BIZ-20        NOT_RUN
  PASS marker/M-board       NOT_GENERATED
```

The campaign included four actual executions of each authorized command. One additional Gate B
launcher invocation terminated before suite execution because Windows PowerShell classified native
stderr as a terminating error; an earlier orchestration attempt failed before either command while
creating the in-memory credential. Neither orchestration-only failure performed target-schema work.
Every actual command ended with `CLEANUP_CONFIRMED`, followed by an independent zero-inventory
proof. The final stdout transcripts are:

- `C:\Users\Administrator\AppData\Local\Temp\modern-erp-wave10-gate-b-final-out-68682b7507c3461195b589617032ebaf.log`;
- `C:\Users\Administrator\AppData\Local\Temp\modern-erp-wave10-acceptance-final-out-c6f77c820af341ecba8c78dfb6f2cfd4.log`.

The 602 protected local database/WAL/SHM files retained manifest digest
`b2a388519fa768bfd2e07e18a2a0539f16a5b9f85905ed2e6e6cb9796c55054d`; Gate A stayed frozen,
Wave 11 and Wave 12 were not started, and no Git write, release or deployment occurred.

**Campaign status: `WAVE10_MYSQL_ACCEPTANCE_BLOCKED`.**
**Stop state: `GATE_A_FROZEN`; `GATE_B_FAILED`; `WAVE10_PARITY_FAILED`;
`WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED`; `WAVE10_NOT_FROZEN`; `WAVE11_NOT_STARTED`;
`WAVE12_NOT_STARTED`; `NO_GIT_WRITE`.**
