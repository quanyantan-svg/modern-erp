# W11-SEC-01 — Credit Read Scope Final Acceptance and Capability Freeze Record

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）
## W11-SEC-01 — Credit Read Scope Final Acceptance and Capability Freeze Record (2026-10-28)

### 1. Authorization and scope of this record

The user reviewed the W11-SEC-01 Implementation report, the real-MySQL Gate report
(`W11_SEC_01_MYSQL_GATE_READY_FOR_USER_ACCEPTANCE`), the read-only Acceptance Evidence
Reconciliation and the Documentation & Evidence Closure report, and explicitly authorized,
under AGENTS.md §4.5:

1. `W11-SEC-01` Technical Acceptance PASS;
2. the `W11-SEC-01` Capability Freeze.

This authorization covers **only**:

- the Credit Read Scope security read remediation;
- the W11-SEC SQLite / MySQL acceptance evidence;
- the W11-SEC unified MySQL Gate run configuration;
- the corresponding tests, documentation and audit records.

It does **not** authorize a Wave 11 Freeze, does **not** freeze any other business domain,
does **not** lift the Wave 10 release hold, and does **not** authorize a release, a
deployment, a version change or a release tag. Git Commit / Push remain separately
authorized actions and were **not** performed.

### 2. The item being closed

`W11-SEC-01` — Security Read Scope Remediation (`solution.md` → `§37.54.15.2`).

- **Requirement** — `document.md` → `## Wave 11 — Sales & Customer Credit Evaluation /
  Reconciliation / Query — Stage B Requirement Closure (2026-10-27)`, clauses `R-D2-1`..`R-D2-6`
  and §4.1 `W11-SEC-01`;
- **Design** — `solution.md` → `§37.54.7` (incl. CORRECTION-1), `§37.54.14`, `§37.54.15.1`,
  `§37.54.15.2`, the implementation-period technical synchronization `§37.54.7.13` (unified
  local MySQL target and Gate launcher) and `§37.54.7.13.9` (current database inventory);
- **Implementation** — `server/modules/credit-scope.js`, `server/modules/credit-check.js`,
  `server/modules/credit-special-approval.js`; new `server/sales-customer-wave11-sec-scope.test.js`,
  `server/test-utils/wave11-sec-scope-fixture.js`, `server/mysql-sales-customer-wave11-sec-scope.integration.js`;
  test-suite registration in `scripts/testing/test-suites.js`; `scripts/gates/mysql-sales-wave11-sec-gate.mjs`;
  `scripts/gates/mysql-local-target-contract.mjs`, `mysql-local-preflight.mjs`, `mysql-local-baseline.mjs`,
  `run-mysql-local-gate.ps1`, `setup-mysql-local-gate.ps1`; `package.json` scripts
  `test:mysql:wave11-sec` / `test:mysql:local` / `test:mysql:local:setup`;
- **Acceptance** — this section.

The Freeze Boundary is the one already fixed by CORRECTION-5 in `solution.md` → `§37.54.15.2`
("W11-SEC-01 Freeze Boundary"). This record does **not** redefine it.

### 3. Scope of the closure — and what it explicitly does **not** claim

1. The closure covers **only** the tightening of already-approved over-privileged read
   behaviour: the canonical Credit Read Scope predicate on the Wave 10 read paths, the
   tightening of key visibility, the convergence of paging / totals / stable ordering, and
   the convergence of "out of scope" and "not found" into indistinguishable responses.
2. It does **not** change the Wave 10 credit-check and approval **decision** semantics.
3. It does **not** change the Credit Exposure Algorithm.
4. It does **not** change the Credit Check historical snapshots, nor the Special Approval
   state machine, idempotency or audit paths.
5. It does **not** change the existing business contract or visibility of normally
   authorized subjects (`ADMIN` / `CROSS_GROUP` / `AGGREGATE_ONLY` / a currently valid
   `AGGREGATE_PLUS_SELF` subject).
6. It adds **no** table, **no** migration, **no** new API, **no** new UI, **no** new
   permission code and **no** new role.
7. A read that was **already judged over-privileged** and is now refused is **not** a Wave 10
   incompatibility. The Wave 10 incompatibility criterion is "the existing business contract
   of a normally authorized subject changed", not "an over-privileged read is no longer
   allowed". The CORRECTION-1 self-limit tightening is therefore an **intended tightening**,
   not a regression.
8. It does **not** certify the Inventory Domain, does **not** certify legacy data migration
   compatibility, and does **not** approve a deployment.

### 4. Acceptance evidence by condition and evidence grade

Evidence grades are stated as recorded. A condition whose only possible proof would require a
live MySQL target is recorded as `NOT_RUN` rather than claimed as passed.

| Condition | Evidence | Grade | Result |
|---|---|---|---|
| Canonical Scope contract on SQLite (five-mode matrix, fail-closed, non-enumerable) | `server/sales-customer-wave11-sec-scope.test.js` — 14 / 14 PASS | E2 SQLite | PASS |
| Canonical Scope contract on a **real MySQL 8** session (same fixture, same production writers) | `server/mysql-sales-customer-wave11-sec-scope.integration.js` — W11-SEC-M1..M9 **9 / 9 PASS** | E3 Real MySQL | PASS |
| SQLite ↔ MySQL authorized id sets and their order are identical | W11-SEC-M3 / M4 | E3 | PASS |
| Historical / future `businessDate` cannot restore a lapsed self-limit scope | W11-SEC-M5 | E3 | PASS |
| Single-object bypass closed; out-of-scope detail indistinguishable from absent | W11-SEC-M6 | E3 | PASS |
| Unattributable rows (`credit_profile_id IS NULL`) fail closed under restricted modes | W11-SEC-M7 | E3 | PASS |
| An approval is visible only through its trusted source check result | W11-SEC-M8 | E3 | PASS |
| The remediation writes no Credit fact | W11-SEC-M9 | E3 | PASS |
| Wave 9 / Wave 10 regression | `sales-customer-wave9-credit-foundation.test.js`, `sales-customer-wave10-credit-check.test.js`, `sales-customer-wave10-acceptance-contract.test.js` | E2 | PASS |
| FAST suite | `pnpm test:fast` — **500 / 500 PASS** | E2 | PASS |
| FULL suite | `pnpm test` — **2949 / 2949 PASS** | E2 | PASS |
| Build | `pnpm build` — PASS | E2 | PASS |
| Test-suite governance | `server/test-suite-governance.test.js` — **20 / 20 PASS** | E2 | PASS |
| Whitespace | `git diff --check` — PASS | E2 | PASS |
| Fixed MySQL identity and least-privilege contract | `scripts/gates/mysql-local-preflight.mjs` — `drift = []`, grants SHA-256 `bef61617…807e` equals the fixed baseline | E3 | PASS |
| Five-category cleanup after the gate | `FINAL ZERO OBJECTS = {tables:0, views:0, triggers:0, routines:0, events:0}`, confirmed twice and independently (protected runner final reset, plus a **fresh session** after the destructive authorization variables were removed) | E3 | PASS |

**Explicitly `NOT_RUN`** — recorded so that no reader mistakes silence for a pass:

| Item | Why not run | What the closure therefore does not claim |
|---|---|---|
| HEAVY suite | not authorized | no claim that the heavy suite passes |
| browser / mobile acceptance | not authorized | no claim that the frontend credit-check / special-approval lists were accepted in a browser; the reduced row count for restricted subjects is an **intended** consequence of refused over-privileged reads and was not browser-verified |
| Wave 10 acceptance re-run | out of scope and prohibited | no claim that the Wave 10 campaign was re-executed; the existing 39 / 39 Wave 10 MySQL acceptance evidence is unchanged |
| other MySQL gates (`test:mysql` / `test:mysql:concurrency` / `test:mysql:legacy` / `test:mysql:finance-concurrency` / `test:mysql:performance`) | not adapted to the unified target | no claim that any MySQL gate other than W11-SEC is adapted to the unified local target |
| MySQL migration | no schema or migration change was made | no claim that a MySQL migration was executed or validated |

### 5. Preservation of the Wave 10 freeze and of the remaining OPEN items

- **Wave 10 Capability Freeze remains `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`.** This
  closure does not lift the release hold, does not certify the Inventory Domain, does not
  certify legacy data migration compatibility, and does not approve a deployment.
- **`W10-INV-RISK-01` — `BLOCKS_RELEASE_ONLY`** — unchanged and still blocking production release.
- **`CREDENTIAL_EXPOSURE_OPEN` — `USER_ACCEPTED / DEFERRED`.** The owner was informed and
  chose to defer the remediation. This closure does **not** read, compare, export, rotate or
  otherwise touch any credential, does not modify the DPAPI store and does not rebuild the
  identity baseline. The deferral is an accepted-and-pending disposition, **not** an
  elimination of the risk.
- **`LEGACY_DATA_EVIDENCE_PENDING`** — unchanged; the external historical inventory was not
  authorized and not executed, so this closure does not claim the historical data was verified.
- **Wave 11 `W11-A` / `W11-B` / `W11-C` / `W11-D` are NOT started.** The `W11-SEC must pass
  first` dependency recorded in `solution.md` → `§37.54.15.3` is now satisfied **for that
  dependency only**; it does not authorize any of their Implementations.
- **D-2 / D-3 / D-4 / D-5** remain open and continue to block W11-B / W11-C.
- **Production release is still not authorized.** The system as a whole is **not** declared
  ready for production release.
- **Git consolidation still requires separate authorization.** This freeze is a decision record
  only: no `git add`, `commit`, `push`, `tag`, `merge`, `rebase`, `reset`, `restore`, `clean`
  or `stash` was performed, no `package.json` version was changed, and no release tag was
  created, moved or deleted. Committing and pushing the frozen tree is a separate, explicitly
  authorized action.

### 6. Closure status

**`W11_SEC_01_ACCEPTANCE_PASS`**

**`W11_SEC_01_ACCEPTANCE_PASS — FROZEN — GIT_CLOSURE_PENDING`**

- `WAVE11_STAGE_A_AUDIT_READY` preserved; `WAVE11_STAGE_B_REQUIREMENT_READY` preserved;
  `WAVE11_STAGE_C_DESIGN_READY` preserved;
- `SQLITE_AND_MYSQL_EVIDENCE_BOTH_OBTAINED` — the CORRECTION-5 evidence-state rule is satisfied;
- `FREEZE_SCOPE_EXACTLY_W11_SEC_01` — no other business domain is frozen;
- `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED_PRESERVED`;
- `CREDENTIAL_EXPOSURE_OPEN_USER_ACCEPTED_DEFERRED`;
- `W11_A_B_C_D_NOT_STARTED`;
- `NO_GIT_WRITE`; `NO_RELEASE`; `NO_DEPLOY`; `NO_VERSION_CHANGE`; `NO_TAG_CHANGE`.

---
