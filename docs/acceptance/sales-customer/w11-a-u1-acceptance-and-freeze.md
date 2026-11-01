# W11-A U1 — Read Primitives Final Acceptance and Bounded Freeze Record

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## W11-A U1 — Read Primitives Final Acceptance and Bounded Freeze Record (2026-10-28)

### 1. Authorization and scope of this record

The user reviewed the W11-A U1 Implementation report (`W11_A_U1_IMPLEMENTED_READY_FOR_ACCEPTANCE`),
the Test Governance Closure report (`W11_A_U1_ACCEPTANCE_EVIDENCE_COMPLETE`) and the bounded
Design Correction (`solution.md` → `§37.54.15.9`), and explicitly authorized, under AGENTS.md §4.5:

1. `W11-A U1` Technical Acceptance PASS;
2. the `W11-A U1` bounded Capability Freeze and its acceptance record.

This authorization covers **only**:

- the additive named export of the two existing symbols `buildScopeHashes` and
  `CREDIT_CHECK_RESULT_SCOPE` from `server/modules/credit-check.js`;
- the extraction of the single pure `computePolicySnapshotFingerprint` from
  `server/modules/credit-policy.js`;
- the Snapshot Writer equivalence and persistence-behaviour verification;
- the U1 specialized test suite and its FULL registration;
- the corresponding incremental frozen digests, technical notes and acceptance evidence.

It does **not** authorize W11-A U2 / U3 Implementation, does **not** freeze the W11-A package as a
whole, does **not** freeze any other business domain, does **not** lift the Wave 10 release hold,
and does **not** authorize a release, a deployment, a version change or a release tag. Git Commit /
Push remain separately authorized actions and were **not** performed.

### 2. Why the acceptance token is sub-unit scoped

`W11_A_ACCEPTANCE_PASS` is reserved by `solution.md` → `§37.54.15.3` for the **complete W11-A
package** — the three GET endpoints, `credit-query.js`, `credit-query.jsx` and the FULL coverage,
which together constitute U1 + U2 + U3. U2 and U3 have **not** started, so issuing that token now
would over-claim the package.

U1 therefore carries its own sub-unit scoped token, following the convention the Wave 11 security
package already uses (`W11_SEC_01_ACCEPTANCE_PASS` rather than a bare package name):

**`W11_A_U1_ACCEPTANCE_PASS — FROZEN — GIT_CLOSURE_PENDING`**

The `— FROZEN — GIT_CLOSURE_PENDING` suffix is the same two-part state the W11-SEC-01 freeze used
before its Git Journal closure: the capability is frozen while its Git archive is still pending a
separately authorized Commit and dual-remote push.

### 3. What is frozen by U1

| # | Frozen item | Evidence |
|---|---|---|
| F1 | the additive named export of `buildScopeHashes` and `CREDIT_CHECK_RESULT_SCOPE` | the digest of `credit-check.js` minus the appended export block reproduces the W11-SEC-01 frozen digest byte for byte |
| F2 | the single pure `computePolicySnapshotFingerprint` and the delegation of `ensureCreditPolicySnapshot` | golden vectors captured from the ORIGINAL implementation **before** the extraction |
| F3 | the Snapshot Writer's persistence behaviour — first creation, idempotency, uniqueness, no rewrite of history, no write on invalid input | U1 T4 |
| F4 | the U1 specialized suite and its FULL registration | the FULL manifest entry plus the in-run TAP transcript |
| F5 | the incremental frozen digests, the technical notes and this acceptance record | `solution.md` → `§37.54.15.9.7`–`§37.54.15.9.9`, this section, and the day's log |

### 4. Acceptance evidence by condition and evidence grade

| Condition | Evidence | Grade | Result |
|---|---|---|---|
| the extracted pure function reproduces the original implementation byte for byte | 7 valid golden vectors captured from the ORIGINAL implementation before the extraction | E2 | PASS |
| invalid hash inputs keep the original error class, status, message and business code | 10 invalid vectors | E2 | PASS |
| boundary, hash-order sensitivity, determinism, length-prefixed canonical encoding, `CSP1:` prefix | U1 T3 | E2 | PASS |
| Snapshot Writer persistence behaviour unchanged | U1 T4 | E2 | PASS |
| the additive export is inert and introduces no second algorithm or resolver | U1 T5 | E2 | PASS |
| U1 suite total | `scripts/sales-customer-wave11-a-primitives.test.js` — **5 / 5 PASS** | E2 | PASS |
| test-suite governance | `server/test-suite-governance.test.js` — **20 / 20 PASS** | E2 | PASS |
| FULL regression with the U1 file registered and executed | `pnpm test` — **2954 / 2954 PASS**; the file appears in the FULL manifest and its T1..T5 cases appear in that run's transcript | E2 | PASS |
| Wave 9 / Wave 10 / W11-SEC focused regression | 21/21 + 51/51 + 11/11 + **14/14** | E2 | PASS |
| FAST | `pnpm test:fast` — **500 / 500 PASS** (U1 Implementation stage) | E2 | PASS |
| whitespace | `git diff --check` — PASS | E2 | PASS |

**Explicitly `NOT_RUN`** — recorded so that no reader mistakes silence for a pass:

| Item | Why not run | What the closure therefore does not claim |
|---|---|---|
| HEAVY suite | not authorized in this round | no claim that the heavy suite passes |
| real-MySQL gate | not authorized in this round | no claim of any real-MySQL evidence for U1; U1 is SQLite-only and the W11-A real-MySQL gate belongs to U2 |
| browser / mobile acceptance | not authorized in this round | no claim that any UI was accepted in a browser; U1 has no UI |
| Build | not authorized in this round | no claim that a production build was produced in this round |

### 5. Incremental frozen payload manifest

| File | W11-SEC-01 frozen digest | W11-A U1 digest | Nature of the difference |
|---|---|---|---|
| `server/modules/credit-check.js` | `3bf4eb5190f3c8f59c0d7446fe07cd0264992126cffaa8616c1ccbecd7e272f0` | `eceb2f775476caa008769c9040077aaea87a3191e3eb886175cddef67f9e8384` | **the authorized additive export and its explanatory comment only** |
| `scripts/testing/test-suites.js` | `6e75875ac6a4fd697221fa1523f8c25a513b27ced3efc7e88ea78ecfc42cca88` | `b982808f0d74b5d0b3b2207f343c50e4c4a30bb10f005f9e599b2e4a4ce9e01d` | **one FULL registration and its explanatory comment only** |
| `server/modules/credit-policy.js` | not a W11-SEC-01 frozen payload file | `94f2df0a267722ba4d343315668dd82c2c3e5e723dde2363c785a5ecff6aa98b` → `9088a222e58d85e24539500a65a9e2b97a347fb89b0e20544e0c4fc34924fea8` | the pure fingerprint extraction |
| `scripts/sales-customer-wave11-a-primitives.test.js` | — | `37074ad129ca89cdb34e3ac40a95eb03073c2f6912ec65fee0043f269b5f8767` | the U1 specialized suite |

The other **12** W11-SEC-01 frozen payload digests are unchanged. **The W11-SEC-01 original 14
digests and their Git evidence are permanently preserved; nothing was recomputed, overwritten,
redefined or voided, and no W11-SEC-01 re-freeze was performed.**

### 6. Forward maintenance obligation for the T5 digest assertion

U1's T5 recomputes the SHA-256 of `credit-check.js` up to the U1 export marker and requires it to
equal the W11-SEC-01 frozen digest. That assertion is **valid today** and is frozen as part of F1.

The planned W11-D `factDigest` addition lands inside the recomputed prefix (`computeCreditExposure`
returns at byte 22943; the U1 export marker is at byte 52594), so a legitimate W11-D amendment will
make that digest comparison fail. The failure would be a **baseline advance, not a defect**.

The obligation recorded for the future W11-D round: W11-D must be authorized as its **own**
versioned bounded amendment with its **own** before / after digest record for `credit-check.js`;
the T5 baseline must then be re-pointed at that newly authorized baseline — a recorded digest chain
is acceptable — while the W11-SEC-01 original digest `3bf4eb51…72f0` stays permanently recorded.
**The assertion must not be deleted, skipped or relaxed in advance.** This round did not modify T5.

### 7. Preservation of the Wave 10 freeze and of the remaining OPEN items

- **Wave 10 Capability Freeze remains `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`.** This closure
  does not lift the release hold, does not certify the Inventory Domain, does not certify legacy
  data migration compatibility, and does not approve a deployment.
- **`W10-INV-RISK-01` — `BLOCKS_RELEASE_ONLY`** — unchanged and still blocking production release.
- **`LEGACY_DATA_EVIDENCE_PENDING`** — unchanged.
- **`CREDENTIAL_EXPOSURE_OPEN` — `USER_ACCEPTED / DEFERRED`** — unchanged; the owner accepted and
  deferred the remediation. This closure neither read, compared, exported nor modified any
  credential, and did not modify the DPAPI store or rebuild any identity baseline.
- **W11-A U2 / U3 have not started.** `W11_A_ACCEPTANCE_PASS` remains reserved for the complete
  package. `W11-B` / `W11-C` / `W11-D` remain not started, and D-2..D-5 continue to block W11-B/C.
- **Production release is still not authorized.**
- **Git consolidation still requires separate authorization.** This freeze is a decision record
  only: no `git add`, `commit`, `push`, `tag`, `merge`, `rebase`, `reset`, `restore`, `clean` or
  `stash` was performed, no `package.json` version was changed, and no release tag was created,
  moved or deleted.
- **Status evolution is evidenced by the day's Git Journal entry, not by editing earlier records.**
  The W11-SEC-01 freeze record above still shows `GIT_CLOSURE_PENDING`, the state at its issuance;
  its subsequent Journal closure is recorded in `log/2026-10-28.md`. That earlier record is **not**
  rewritten.

### 8. Closure status

**`W11_A_U1_ACCEPTANCE_PASS`**

**`W11_A_U1_ACCEPTANCE_PASS — FROZEN — GIT_CLOSURE_PENDING`**

- `W11_A_U1_ONLY` — the W11-A package token `W11_A_ACCEPTANCE_PASS` is **not** issued;
- `U1_IMPLEMENTATION_COMPLETE`; `U1_SPECIALIZED_TESTS_5_OF_5`; `FULL_REGISTRATION_CONFIRMED`;
- `GOLDEN_VECTORS_CAPTURED_PRE_CHANGE`; `SNAPSHOT_WRITER_EQUIVALENCE_CONFIRMED`;
- `WAVE9_WAVE10_W11SEC_REGRESSION_NOT_REGRESSED`;
- `W11_SEC_01_FROZEN_DIGESTS_PRESERVED`; `NO_W11_SEC_01_RE_FREEZE`;
- `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED_PRESERVED`;
- `CREDENTIAL_EXPOSURE_OPEN_USER_ACCEPTED_DEFERRED`;
- `W11_A_U2_U3_NOT_STARTED`; `W11_B_C_D_NOT_STARTED`;
- `HEAVY_MYSQL_GATE_BUILD_BROWSER_NOT_RUN`; `NO_PASS_CLAIMED_FOR_THEM`;
- `NO_CODE_CHANGE_IN_THIS_ROUND`; `NO_MYSQL_CONNECTION`; `NO_CREDENTIAL_ACCESS`;
- `NO_GIT_WRITE`; `NO_RELEASE`; `NO_DEPLOY`; `NO_VERSION_CHANGE`; `NO_TAG_CHANGE`.

---
