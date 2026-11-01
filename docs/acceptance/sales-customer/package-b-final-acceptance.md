# Package B — Local Test Backend Isolation Final Acceptance and Capability Closure

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## Package B — Local Test Backend Isolation Final Acceptance and Capability Closure (2026-10-27)

### 1. Authorization and scope of this record

The user reviewed the Package B Implementation report (`PACKAGE_B_TEST_ISOLATION_IMPLEMENTATION_PASS`)
and the Package B Design Erratum report (`PACKAGE_B_DESIGN_ERRATUM_READY`) and explicitly authorized,
under AGENTS.md §4.5:

1. Package B Final Acceptance;
2. recording the Package B Capability Closure after Acceptance passes;
3. precise staging of exactly the six approved files;
4. one Chinese Git commit;
5. a normal push to both `github` (GitHub) and `origin` (Gitee) on the current recovery branch.

This record is the **Acceptance / Closure decision record**. It does **not** reopen Wave 10, does
**not** alter any production business contract, does **not** authorize a release or a deployment, and
does **not** start Wave 11.

### 2. The item being closed

**`WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT` — disposition: `RESOLVED — LOCAL TEST RUNNER SCOPE`.**

The defect was remediated by an independent, separately authorized Package B implementation:

- **Requirement** — `## Package B — Local Test Backend Isolation Requirement (2026-10-27)`
  (clauses `PB-ISO-R01`..`PB-ISO-R14`, acceptance conditions `AC-ISO-01`..`AC-ISO-12`);
- **Design** — `solution.md` → `## 37.53 Package B — Local Test Backend Isolation Design
  (2026-10-27)`, with a bounded erratum to §37.53.5 M4 that separates the inherited-value denylist
  from the required final pin;
- **Implementation** — three files only: `scripts/testing/test-env.js` (new),
  `scripts/testing/run-tests.js`, `server/test-suite-governance.test.js`;
- **Acceptance** — this section.

**The historical OPEN evidence is not erased.** The original registrations at `document.md:10052`,
`:10690`, `:11044` and `:11175`, and the deferred-item listing inside the frozen Wave 10 Capability
Freeze record, remain exactly as written. This section records a **later, independent disposition**
of that item and does not retroactively edit the Wave 10 record.

### 3. Scope of the fix — and what it explicitly does **not** claim

1. The defect was fixed through an independent Package B implementation. It was not fixed as a side
   effect of any other unit, and no other unit's scope was changed.
2. The isolation covers **only** ordinary test runs started through `scripts/testing/run-tests.js`
   (the `pnpm test`, `pnpm test:fast`, `pnpm test:heavy`, `pnpm test:all` and `pnpm test:list`
   entry points).
3. It does **not** claim that an arbitrary directly executed Node script is isolated. A script run
   outside the ordinary runner still sees the ambient environment, exactly as before.
4. It does **not** claim that any real MySQL gate was re-executed. No MySQL instance was contacted
   and no gate or campaign was run during Package B implementation, acceptance or closure.
5. It does **not** change production database behaviour. `server/db.js`,
   `server/database/config.js`, `server/test-utils/temp-db.js` and `scripts/admin/setup-admin.mjs`
   were not modified. `createDatabase()` and `resolveDatabaseConfig()` keep their production,
   environment-driven, fail-closed semantics, and the `setup-admin` CLI keeps its MySQL bootstrap
   path.

### 4. Acceptance evidence by condition and evidence grade

Evidence grades are stated as recorded, and a condition whose only possible proof would require a
live MySQL target is recorded as `NOT_RUN` rather than claimed as passed.

| Condition | Requirement | Evidence | Grade |
|---|---|---|---|
| `AC-ISO-01` | clean environment ⇒ SQLite | `PB-ISO-T01` (pure) | `LOCAL_TEST_PROVEN` |
| `AC-ISO-02` | `ERP_TEST_DB_BACKEND=mysql` contamination removed | `PB-ISO-T02` (**real child process** reports the environment it sees) | `LOCAL_TEST_PROVEN` |
| `AC-ISO-03` | `ERP_DB_BACKEND=mysql` contamination removed | `PB-ISO-T03` (**real child process**) | `LOCAL_TEST_PROVEN` |
| `AC-ISO-04` | `ERP_DB_PATH` contamination removed | `PB-ISO-T04` (**real child process**) | `LOCAL_TEST_PROVEN` |
| `AC-ISO-05` | the complete 22-name denylist is removed | `PB-ISO-T05` (pure; iterates the whole list) | `LOCAL_TEST_PROVEN` |
| `AC-ISO-06` | `setupAdmin()` uses the caller SQLite path | `PB-ISO-T06` (pure; stubbed factory, no database opened) | `LOCAL_TEST_PROVEN` |
| `AC-ISO-07` | FAST / FULL / HEAVY / ALL semantics and exit-code propagation unchanged | `PB-ISO-T07` (static contract + **real child process** exit codes) plus the full FAST / FULL / HEAVY runs below | `LOCAL_TEST_PROVEN` |
| `AC-ISO-08` | the protected MySQL gateways are unaffected | `PB-ISO-T08` (static dependency contract: no gateway imports the ordinary runner or the isolation module; the isolation module's importers are exactly two files) | `STATIC_VERIFIED` |
| `AC-ISO-09` | Windows case-insensitive spellings cannot bypass the isolation | `PB-ISO-T09` (pure) | `LOCAL_TEST_PROVEN` |
| `AC-ISO-10` | variable names observable, secret values never carried or printed | `PB-ISO-T10` (pure + static) | `LOCAL_TEST_PROVEN` + `STATIC_VERIFIED` |
| `AC-ISO-11` | the parent environment is never mutated | `PB-ISO-T11` (pure) | `LOCAL_TEST_PROVEN` |
| `AC-ISO-12` | no MySQL opt-in; a contaminated environment is refused | `PB-ISO-T12` (pure + static) | `LOCAL_TEST_PROVEN` + `STATIC_VERIFIED` |

**Local gate evidence on the accepted tree** (the three implementation files are byte-identical to
the state in which these results were produced, and only the approved M4 documentation erratum
followed, so the results are reused rather than re-run):

| Gate | Result |
|---|---|
| focused — `server/test-suite-governance.test.js` | **20 / 20 PASS** (0 fail / 0 cancelled / 0 skipped / 0 todo) |
| `pnpm test:fast` | **500 / 500 PASS** |
| `pnpm test` | **2935 / 2935 PASS** |
| `pnpm test:heavy` | **67 / 67 PASS** |
| `pnpm build` | **PASS** |
| `git diff --check` | **PASS** |

**Explicitly `NOT_RUN`** — recorded so that no reader mistakes silence for a pass:

| Item | Why not run | What the closure therefore does not claim |
|---|---|---|
| real-MySQL connection isolation | no MySQL instance was contacted; Package B never connects to one | no claim that the isolation was exercised against a live MySQL target |
| MySQL destructive-reset refusal under the ordinary runner | running it would require a real destructive authorization, which was never granted | no claim that a MySQL reset was attempted and refused by the ordinary launcher |

Both items are out of scope for `AC-ISO-01`..`AC-ISO-12`: the isolation boundary under test is the
ordinary launcher, and the destructive reset path lives in the protected gateways, which keep their
own guards and are covered by `AC-ISO-08`'s static contract.

### 5. Preservation of the Wave 10 freeze and of the remaining OPEN items

- **Wave 10 Capability Freeze remains `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`.** This closure
  does not lift the release hold, does not certify the Inventory Domain, does not certify legacy
  data migration compatibility, and does not approve a deployment.
- **`W10-INV-RISK-01` — `BLOCKS_RELEASE_ONLY`** — unchanged and still blocking production release.
  Package B did not touch the Inventory domain, the canonical stock read/write path, or the
  negative-balance risk.
- **`CREDENTIAL_EXPOSURE_OPEN` — `REQUIRES_OWNER_DECISION`** — unchanged. Package B neither read,
  recorded, rotated nor accepted any credential; the residual local exposure remains an owner
  decision that this record does not make on the owner's behalf.
- The remaining deferred OPEN items keep their own deferral justification and boundary. This
  closure changes **one** item only.
- **Production release is still not authorized.** The system as a whole is **not** declared ready
  for production release.

### 6. Closure status

**`PACKAGE_B_TEST_ISOLATION_ACCEPTANCE_PASS`**

**`WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT` — `RESOLVED — LOCAL TEST RUNNER SCOPE`**

---
