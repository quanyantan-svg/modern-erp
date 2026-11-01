# W11-A U2 — Credit Query / Exception History Final Acceptance and Capability Freeze Record

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## W11-A U2 — Credit Query / Exception History Final Acceptance and Capability Freeze Record (2026-10-29)

### 1. Authorization and scope of this record

The user reviewed the W11-A U2 Final Acceptance Evidence Review
(`W11_A_U2_FINAL_ACCEPTANCE_REVIEW_PASS`) and explicitly authorized, under AGENTS.md §4.5:

1. `W11-A U2` Technical Acceptance PASS;
2. the `W11-A U2` Capability Freeze and its acceptance record.

This authorization covers **only**:

- SC101 Credit Exposure Query — the read-only backend;
- SC102 Credit Exception History — the read-only backend;
- the V2 Cross-Engine Hash Contract (Rule Hash / CSP2 / CCHK2) and its V1 historical compatibility;
- the ONE_TIME Special Approval Consumption Correction;
- the additive Schema / Migration, the corresponding tests, and the acceptance evidence.

It does **not** authorize the W11-A U3 mobile / UI unit, does **not** declare the W11-A Package
complete, does **not** freeze any other business domain, does **not** lift the Wave 10 release hold,
and does **not** authorize a release, a deployment, a version change or a release tag. Git Commit /
Push remain separately authorized actions and were **not** performed.

This record does **not** rewrite the W11-SEC-01 Freeze Record, the W11-A U1 Freeze Record, or any
earlier W11-A U2 Requirement / Design / Implementation record. Where an earlier record's statement is
now incomplete, the accurate current state is stated **here** and the earlier record is left untouched.

### 2. The item being closed

`W11-A U2` — SC101 / SC102 Credit Query / Exception History, the V2 cross-engine hash contract, and
the ONE_TIME Special Approval Consumption Correction.

- **Requirement** — `document.md` → `§6.2` / `§6.3` (R101-1..R101-7, R102-1..R102-5);
  `## W11-A U2 — Bounded Requirement Correction after Pre-E3 Semantic Parity Verification (2026-10-28)`
  (D-U2-1, D-U2-2); `## W11-A U2 E3 — Cross-Engine Credit Policy Hash Contract Requirement Correction
  (2026-10-29)` (R-HASH-01..R-HASH-05); `## W11-A U2 — ONE_TIME 特别审批消费与 Replay 语义更正
  Requirement（2026-10-29）` (R-ONE-01..R-ONE-07).
- **Design** — `solution.md` → `§37.54.8`, `§37.54.20`, `§37.54.22`, `§37.54.23`, `§37.54.24`,
  and `§37.54.25` (Frozen Implementation / Evidence Summary).
- **Implementation** — `server/modules/credit-query.js`, `server/modules/credit-rule-payload.js`,
  `server/modules/credit-check.js`, `server/modules/credit-policy.js`,
  `server/migrations/sales-customer-wave11-a-credit-consumption.js`,
  `server/migrations/sales-customer-domain.js`, `server/app.js`; the U2 / U1 / Wave 10 / Wave 0 test
  files, the shared fixture, the suite registration and the protected MySQL gate.
- **Acceptance** — this section.

### 3. Exact baseline and worktree inventory

Read-only verification immediately before this record was written:

| Item | Value | Result |
|---|---|---|
| Branch | `work/sales-waves6-13-recovery-20261025` | as expected |
| HEAD | `d9e5d50a9103612a17070f806312b822281eb6c6` | as expected |
| `package.json` version | `1.6.2` | unchanged |
| Release tag | `v1.6.2` | unchanged, not moved, not created |
| Modified files | **12** | matches expectation |
| Untracked files | **8** | matches expectation |
| Total | **20** | matches expectation |

**Modified (12)** — `document.md`, `log/2026-10-28.md`, `package.json`,
`scripts/sales-customer-wave11-a-primitives.test.js`, `scripts/testing/test-suites.js`,
`server/app.js`, `server/migrations/sales-customer-domain.js`, `server/modules/credit-check.js`,
`server/modules/credit-policy.js`, `server/sales-customer-wave0-migration-runner.test.js`,
`server/sales-customer-wave10-credit-check.test.js`, `solution.md`.

**Untracked (8)** — `log/2026-10-29.md`, `scripts/gates/mysql-sales-wave11-a-gate.mjs`,
`server/migrations/sales-customer-wave11-a-credit-consumption.js`,
`server/modules/credit-query.js`, `server/modules/credit-rule-payload.js`,
`server/mysql-sales-customer-wave11-a-credit-query.integration.js`,
`server/sales-customer-wave11-a-credit-query.test.js`,
`server/test-utils/wave11-a-credit-query-fixture.js`.

**Surface breakdown** (this corrects the count mislabel in the preceding review report, which
labelled a group of eight entries as "6"):

| Surface | Count | Files |
|---|---|---|
| Production runtime modules | 4 | `credit-query.js`, `credit-rule-payload.js`, `credit-check.js`, `credit-policy.js` |
| App wiring | 1 | `server/app.js` (3 route registrations) |
| Schema / Migration | 2 | `sales-customer-domain.js`, `sales-customer-wave11-a-credit-consumption.js` |
| Test files | 5 | `wave11-a-credit-query.test.js`, `mysql-sales-customer-wave11-a-credit-query.integration.js`, `wave10-credit-check.test.js`, `wave0-migration-runner.test.js`, `wave11-a-primitives.test.js` |
| Shared test fixture | 1 | `wave11-a-credit-query-fixture.js` |
| Test-suite manifest | 1 | `scripts/testing/test-suites.js` |
| Protected MySQL gate | 1 | `scripts/gates/mysql-sales-wave11-a-gate.mjs` |
| Package script entry | 1 | `package.json` |
| Canonical documents | 2 | `document.md`, `solution.md` |
| Journal | 2 | `log/2026-10-28.md`, `log/2026-10-29.md` |

**Test & gate surface = 8** (5 test files + 1 shared fixture + 1 suite manifest + 1 protected gate).

No file was cleared, overwritten, reset, stashed or reverted. No `src/` file changed. No Git write
was performed.

### 4. Acceptance evidence by condition and evidence grade

Grades: `E1` static contract, `E2` SQLite, `E3` real MySQL 8.

| Condition | Evidence | Grade | Result |
|---|---|---|---|
| SC101 exposure equals the canonical Credit Check amount | `wave11-a-credit-query.test.js` UAT-S-35-A1 ×2, CORRECTION T-A ×2 | E2 | PASS |
| SC101 aggregate / sub-limit scopes separated, never double counted | R101-3, UAT-S-35-A7 | E2 | PASS |
| SC101 explicit stage, no implicit fallback | CORRECTION T-B ×3 | E2 | PASS |
| SC101 component breakdown vs. historical snapshot separation | UAT-S-35-A2 ×2 | E2 | PASS |
| SC101 per-scope computed identity, viewer independence | UAT-S-35-A5 ×2, CORRECTION T-C, T-D | E2 | PASS |
| SC101 five-level read scope, negative cases | UAT-S-35-A7 ×2, R101-3, R101-4 ×2, R101-7 | E2 | PASS |
| SC101 zero side effect — static, runtime, repeatable | UAT-S-35-A4 E1 + E2 ×2 | E1 / E2 | PASS |
| SC102 exception history derived from canonical rows | UAT-S-35-A3 ×3, R102-1, R102-3 | E2 | PASS |
| SC102 deterministic pagination and authorized total | UAT-S-35-A6 ×3 | E2 | PASS |
| SC102 detail non-enumerable; scope cannot be bypassed | R102-4 ×2, R102-3 | E2 | PASS |
| SC102 versioned history returned verbatim, unknown prefix fails closed | SC102 identity test | E2 | PASS |
| V2 Rule Hash / CSP2 / CCHK2 independent Golden vectors | `wave11-a-primitives.test.js` T7, T9 | E1 / E2 | PASS |
| V2 identity independent of the engine's physical JSON rendering (M4 defect) | `wave11-a-primitives.test.js` T10 | E2 | PASS |
| V1 historical compatibility — CSP1 / CCHK1 unchanged | `wave11-a-primitives.test.js` T1–T4, T5 chain | E1 / E2 | PASS |
| V1 replay compatibility and legacy ambiguity refusal | `wave10-credit-check.test.js` V2 compatibility cases | E2 | PASS |
| ONE_TIME first legal consumption writes ledger + audit exactly once | T-01 | E2 | PASS |
| ONE_TIME exact replay reuses the conclusion, writes nothing | T-02, T-03 | E2 | PASS |
| ONE_TIME cross-action reuse refused, zero writes | T-04, T-05, T-13b | E2 | PASS |
| ONE_TIME historical CONSUME audit is a valid authority; corrupt detail fails closed | T-13, T-13b, T-14 | E2 | PASS |
| ONE_TIME transaction atomicity and rollback leave zero evidence | T-07, T-08 | E2 | PASS |
| ONE_TIME repeatable scope modes keep their existing semantics | T-16, T16b | E2 | PASS |
| SC101 / SC102 not regressed by the consumption ledger | `§37.54.22.6.3` case | E2 | PASS |
| Migration — column order, nullability, 3 CHECK, 2 FK, UNIQUE, index | `wave0-migration-runner.test.js` + migration self-assertions | E1 / E2 | PASS |
| Combined focused regression | 75 + 38 + 10 + 7 + 14 | E2 | **144 / 144 PASS** |
| FAST suite | `pnpm test:fast` | E2 | **500 / 500 PASS** (37 suites) |
| FULL suite | `pnpm test` | E2 | **3021 / 3021 PASS** (359 suites) |
| Build | `pnpm build` | — | PASS |
| Whitespace | `git diff --check` | — | PASS |
| Real MySQL 8 cross-engine parity, M1–M10 | `w11-a-u2-e3-20261029-161412.tap.log` | **E3** | **10 / 10 PASS** |
| Real MySQL ONE_TIME cross-session single consumption (T-17) | same TAP | **E3** | **PASS** |
| Real MySQL ledger UNIQUE + physical type catalog (T-18) | same TAP | **E3** | **PASS** |
| Fixed MySQL identity and least-privilege contract | TAP grants SHA-256 `bef61617…807e` = fixed baseline | E3 | PASS |
| Five-category cleanup after the gate | `FINAL ZERO OBJECTS = {tables:0, views:0, triggers:0, routines:0, events:0}`, `CLEANUP = CONFIRMED` | E3 | PASS |

**Real MySQL E3 evidence** — `w11-a-u2-e3-20261029-161412.tap.log`:

| Attribute | Value |
|---|---|
| Evidence path | `%LOCALAPPDATA%\ModernERP\mysql-gate\evidence\w11-a-u2-e3-20261029-161412.tap.log` (resolved: `C:\Users\Administrator\AppData\Local\ModernERP\mysql-gate\evidence\…`) |
| Size | 9492 bytes |
| SHA-256 | `52c18b1c02eccfaee447f8e7ed24e6b32eea52f36cbdcec65086f7af8c4a3ac7` |
| Target instance | `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test` |
| Server | MySQL `8.0.37`, uuid `256c7a4e-d275-11f1-885b-b025aa71d167` |
| Grants fingerprint | `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e` |
| Result | `# tests 12 / # pass 12 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`; `GATE_EXIT_CODE=0`; `CLEANUP = CONFIRMED` |

The evidence is stored outside the repository and is **not** committed to Git.

**Earlier failed gate evidence is preserved and was not overwritten:**

| TAP file | Bytes | SHA-256 | Outcome |
|---|---|---|---|
| `w11-a-u2-e3-20261029-074456.tap.log` | 29198 | `3954a77b01ddacf6421aeaf54a30191c78c1d42738a844c1c75c612f004a580e` | 2nd E3 — 7 / 10, M2 / M4 / M9 FAIL |
| `w11-a-u2-e3-20261029-152933.tap.log` | 15304 | `4a8aeb9b5dc69538497939e8c4a0205e9f07aeece5f25689d420d2ccbf2a077f` | 3rd E3 — 10 / 12, T-17 / T-18 FAIL |
| `w11-a-u2-e3-20261029-161412.tap.log` | 9492 | `52c18b1c02eccfaee447f8e7ed24e6b32eea52f36cbdcec65086f7af8c4a3ac7` | 4th E3 — **12 / 12 PASS** |

**Explicitly `NOT_RUN`** — recorded so that no reader mistakes silence for a pass:

| Item | Why not run | What this closure therefore does not claim |
|---|---|---|
| HEAVY suite | not authorized in this round | no claim that the heavy suite passes; `HEAVY` contains `reset-safety` / `backup-restore` and was not run unbidden |
| browser / mobile acceptance | not authorized in this round | no claim that any UI was accepted in a browser; the W11-A Credit Query UI is **U3** scope and does not exist yet |
| other MySQL gates (`test:mysql`, `test:mysql:concurrency`, `test:mysql:legacy`, `test:mysql:finance-concurrency`, `test:mysql:performance`) | not adapted to the unified target | no claim that any MySQL gate other than the W11-A U2 gate ran against the unified local target |
| MySQL migration as a separate destructive campaign | no destructive MySQL operation was authorized in this round | no claim that a MySQL migration campaign beyond the protected gate's own lifecycle was executed |
| a second MySQL E3 rerun | forbidden; the user's transcript is the accepted evidence | no claim beyond the retained transcript |

### 5. Freeze scope — what is and is not claimed

**Frozen by this record:**

- the SC101 Credit Exposure Query **backend** and the SC102 Credit Exception History **backend**;
- the V2 Cross-Engine Hash Contract (Rule Hash / CSP2 / CCHK2) and the V1 historical compatibility;
- the ONE_TIME Special Approval Consumption Correction and its consumption ledger;
- the additive Schema / Migration and the corresponding tests and acceptance evidence;
- the bounded amendments and their versioned evidence chain.

**Explicitly NOT claimed by this record:**

| Not claimed | Consequence |
|---|---|
| `W11_A_ACCEPTANCE_PASS` | The W11-A **package** token remains reserved and is **not** issued. |
| W11-A Package Freeze | Not granted. |
| U3 Complete | Not granted. W11-A U3 remains responsible for the mobile / UI surface. |
| Wave 11 Complete | Not granted. W11-B / W11-C / W11-D have not started; D-2..D-5 still block W11-B / W11-C. |
| Sales & Customer Domain Complete | Not granted. |
| Production Release Ready | Not granted. |

The W11-A Credit Query **UI** (`src/pages/credit-query.jsx`, the `credit-query` contextual route) does
**not** exist. Design `§37.54.8.6` places it in the W11-A package and `§37.54.20.8` assigns the UI
consumer role to U3; the executed U2-1 round was authorized as **Backend** Implementation. The UI is
therefore **U3** scope, and this U2 freeze must not be worded as if the W11-A package were complete.

### 6. Frozen evidence chain

Every digest below was **recomputed from source** for this record, not copied from an earlier log.
The `EOL` column states the convention that reproduces the recorded value, so each historical link is
re-verifiable against a Git object rather than against one particular checkout.

| Link | SHA-256 | EOL convention | Independent verification |
|---|---|---|---|
| W11-SEC-01 `server/modules/credit-check.js` | `3bf4eb5190f3c8f59c0d7446fe07cd0264992126cffaa8616c1ccbecd7e272f0` | LF blob | `git show 177a8ea:…` — MATCH |
| W11-SEC-01 `server/modules/credit-policy.js` | `94f2df0a267722ba4d343315668dd82c2c3e5e723dde2363c785a5ecff6aa98b` | LF blob | `git show 177a8ea:…` — MATCH |
| W11-SEC-01 `server/modules/credit-scope.js` | `f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc` | LF blob | `git show 177a8ea:…` — MATCH |
| W11-SEC-01 `server/modules/credit-special-approval.js` | `04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4` | LF blob | `git show 177a8ea:…` — MATCH |
| W11-SEC-01 `scripts/testing/test-suites.js` | `6e75875ac6a4fd697221fa1523f8c25a513b27ced3efc7e88ea78ecfc42cca88` | CRLF render of the blob | `git show 177a8ea:…` — MATCH |
| U1 `server/modules/credit-check.js` | `eceb2f775476caa008769c9040077aaea87a3191e3eb886175cddef67f9e8384` | LF blob | `git show ca9811a:…` — MATCH |
| U1 `server/modules/credit-policy.js` | `9088a222e58d85e24539500a65a9e2b97a347fb89b0e20544e0c4fc34924fea8` | LF blob | `git show ca9811a:…` — MATCH |
| U1 `scripts/testing/test-suites.js` | `b982808f0d74b5d0b3b2207f343c50e4c4a30bb10f005f9e599b2e4a4ce9e01d` | CRLF render of the blob | `git show ca9811a:…` — MATCH |
| U1 `scripts/sales-customer-wave11-a-primitives.test.js` | `37074ad129ca89cdb34e3ac40a95eb03073c2f6912ec65fee0043f269b5f8767` | CRLF render of the blob | `git show ca9811a:…` — MATCH |
| U1 `server/sales-customer-wave11-sec-scope.test.js` | `fb12c9e1c715438ff2ff5808109123b32ea902518e1ad16c652f23f7b6e1ba4c` | LF blob | `git show ca9811a:…` — MATCH |
| V2 `server/modules/credit-check.js` | `5c5a5a71aabaae01dc06d60305ca1886b608da0ad524f162a4447f22170e792b` | LF | **no Git blob — documentary only** |
| V2 `server/modules/credit-policy.js` | `5fc76f39b3b82358593d5ea443faeedb6e828610b185be1a9ea235c15cbf96e7` | LF | current worktree — MATCH |
| ONE_TIME `server/modules/credit-check.js` | `1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc` | LF | current worktree — MATCH |

The **current** authorized baseline of each frozen production payload is listed in §7. The historical
digests above are **permanently preserved**: they were not recomputed, overwritten, redefined or
voided, and **no W11-SEC-01 Re-Freeze and no U1 Re-Freeze was performed**.

The T5 assertion in `scripts/sales-customer-wave11-a-primitives.test.js` now asserts a **seven-link
mutually-distinct chain** plus `contentDigest(current source) === 1f11fbee…29cc`. The current source
is pinned against a **hard-coded literal** that is not generated at test runtime, and the W11-SEC-01
digest survives as link 1 of the chain. The original "stripped-prefix" assertion became structurally
unsatisfiable after the approved behavioural change (recorded in `log/2026-10-29.md`); it was replaced
under the U1 forward-maintenance obligation (`document.md` → U1 Freeze Record §6) with a comparison of
equal or greater strength. **No assertion was weakened, no case was skipped, and no historical digest
was dropped.**

### 7. Freeze file inventory and verified file fingerprints

`LF` is the SHA-256 of the LF-normalized bytes, which equals the digest of the Git blob that a commit
of this worktree would store. `raw` is the SHA-256 of the bytes as they sit in the working tree today.
All values were computed for this record.

| SHA-256 (LF = committed blob) | SHA-256 (raw, current worktree) | EOL | File | Role |
|---|---|---|---|---|
| `10a10e079818cb0edc406758514f5d7a16bfcd536e50e0e888a5152de988b684` | same | LF | `server/modules/credit-query.js` | SC101 / SC102 read-only backend — **new** |
| `195b627ce17d2b5ab44ad3cd10264c5f960ecb3a932bb2d8fd7b1cc704f79020` | same | LF | `server/modules/credit-rule-payload.js` | V2 semantic rule payload — **new** |
| `1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc` | same | LF | `server/modules/credit-check.js` | ONE_TIME consumption state machine — V2 + ONE_TIME amendment |
| `5fc76f39b3b82358593d5ea443faeedb6e828610b185be1a9ea235c15cbf96e7` | same | LF | `server/modules/credit-policy.js` | V2 CSP1 / CSP2 fingerprint — V2 amendment |
| `f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc` | same | LF | `server/modules/credit-scope.js` | frozen, **unchanged** |
| `04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4` | same | LF | `server/modules/credit-special-approval.js` | frozen, **unchanged** |
| `8348456384e1d5bef8962e1078f792d710ecd9cc587734eff84034b63b5c94a5` | same | LF | `server/migrations/sales-customer-wave11-a-credit-consumption.js` | consumption ledger migration — **new** |
| `f82c31fb5b1a6cc5d69550f8f45a1f31ca2e33edb9064d38cea7064742176f37` | `8bd01b0ec8f71623efa6943789ff8c5ada9d51c854bbcf6bb961d5a8408595db` | CRLF | `server/migrations/sales-customer-domain.js` | migration registry (+1 wave-11 step) |
| `8188be82cd92f79f01e18e8bb156e9e4f274534777c6198e63b58c8a41344204` | `5b35e91f2d3cf579d3787ef7c52839d85028c946c4edfe88fcd08b0b53f6f896` | CRLF | `server/app.js` | 3 route registrations |
| `ab6b23e26152b52171adb7f5b28bcdb4ac28572d3bf38af83eed8f9251c45f8c` | same | LF | `server/sales-customer-wave11-a-credit-query.test.js` | U2 SQLite acceptance suite — **new** |
| `d38c4f0028ccd522a1ac7b5c303e54d5602ca64afbda9d36518d70f424096a9f` | same | LF | `server/mysql-sales-customer-wave11-a-credit-query.integration.js` | real-MySQL E3 suite — **new** |
| `e836163df10c54448a70650d85a8b4653c48e9e5dbe17691c5e666933acc8aa5` | same | LF | `server/test-utils/wave11-a-credit-query-fixture.js` | shared production-writer fixture — **new** |
| `b280cb6c758a49b02f60a2fec81c8ea1ec6ff61e641dc96ff571225f42c304af` | same | LF | `server/sales-customer-wave10-credit-check.test.js` | T-01..T-16 ONE_TIME cases |
| `a0929892e7d849b3706ab31217a40e67e55b64a1d26b666dc60a97bb3b51db3e` | `c3228663801f5df18e0bd5563d04d14f22e83046d4bd79c820116e3d504a448f` | CRLF | `server/sales-customer-wave0-migration-runner.test.js` | registry step count and id list |
| `c68d4707eaed7501d9f81e35a928755564ed5b2c97f5430fd708b67d7f73036b` | `79f541579f24fde497f5a661d2132eaac07d26e2112f4d93bcb74c3d2ef73d27` | CRLF | `scripts/sales-customer-wave11-a-primitives.test.js` | T5 seven-link evidence chain + T6..T10 |
| `c3b9b7c6025774d9421d85246fdfb442e115b3c46aca43d6382ec04e67d867e2` | same | LF | `scripts/gates/mysql-sales-wave11-a-gate.mjs` | protected E3 gate — **new** |
| `e9ad0b45c4d673e8bf19ab5dd8a8745e1c5aa3bc4b84bac9d6545ae8e93e9ca1` | `a86d25a2df40c49b19e1623174b4f3f19ceb17162450179ef852ab2d74edb2db` | CRLF | `scripts/testing/test-suites.js` | FULL registration of the U2 suite |
| `22bb3103e51198592b5d4209f73f7dff22992f6d59e937f214dfd1e7ab5cc5e5` | `0f292be3a2504a29865065bfeb64be557a0d8a47502addd940327036b8d021c5` | CRLF | `package.json` | `test:mysql:wave11-a` script entry (+1/-0) |

**Current state of the W11-SEC-01 original 14 frozen payloads.** Re-verified for this record against
the `177a8ea` blobs and against the current worktree: **11 of 14 are still byte-identical**. Three are
superseded by later authorized bounded amendments, and this is the **accurate** current statement:

| Superseded payload | W11-SEC-01 frozen digest | Current baseline | Nature of the difference |
|---|---|---|---|
| `server/modules/credit-check.js` | `3bf4eb51…72f0` | `1f11fbee…29cc` | U1 additive named export → V2 versioned hash → ONE_TIME consumption. Three recorded bounded amendments. |
| `scripts/testing/test-suites.js` | `6e75875a…ca88` | `a86d25a2…2db` (CRLF) | U1 one FULL registration → U2-1 one FULL registration. Both additive comments only. |
| `package.json` | `160d4ab4…0875` | `0f292be3…21c5` (CRLF) | U2-1 one gate script entry `test:mysql:wave11-a` (+1/-0). The `version` field is unchanged at `1.6.2`. |

The W11-SEC-01 original 14 digests remain permanently recorded in `log/2026-10-28.md` §1014-1027 and in
the W11-SEC-01 Freeze Record; they were not recomputed, overwritten or voided.

### 8. Whitelist exception closure

| File | Change | Disposition |
|---|---|---|
| `server/sales-customer-wave0-migration-runner.test.js` | +3 / −3 | **Closed.** Registry step count 10 → 11, the step-id list extended with `wave-11-a-credit-consumption`, and the test title updated. The assertion intent is **strengthened**: the new step must be present. |
| `scripts/sales-customer-wave11-a-primitives.test.js` | +227 / −13 | **Closed.** The T5 baseline was re-pointed to the newly authorized ONE_TIME baseline and T6..T10 were added. T1..T4 are byte-unchanged; no assertion was weakened; no case was skipped. |

Both exceptions were granted under the identities `W11_A_ONE_TIME_REPLAY_CORRECTION_BOUNDED_AMENDMENT`
and `W11_A_ONE_TIME_WHITELIST_EXCEPTION_AMENDMENT`. Neither **redefines** the W11-SEC-01 freeze
baseline. The only deletions in the Wave 10 suite are an import line and a helper signature, both
re-expanded without changing any default or any assertion.

No other unauthorized out-of-scope change was found. The new migration is formally registered in
`SALES_CUSTOMER_MIGRATIONS`; the U2 suite is registered in **FULL** only, and FAST / HEAVY /
`validate()` / the Runner were not altered; no historical file was overwritten; the protected Runner,
Launcher, Preflight and Setup scripts were **not** modified — the new gate reuses the single existing
`runProtectedMySqlCampaign` owner.

### 9. Residual risks

**A. U2 Acceptance blockers — none.**

**B. Disclosed, non-blocking limitations**

- **B-1** T-17 proves single consumption across **independent MySQL sessions**. It does **not** prove
  an arbitrary concurrent interleaving: the MySQL application transaction gate serializes application
  transactions by design (`§37.54.22.7.3`). The database `UNIQUE (approval_id, consumption_key)` is the
  engine-independent backstop. This result must not be restated as a concurrency stress result.
- **B-2** The V2 intermediate digest `5c5a5a71…792b` has **no Git blob**. Every blob in the repository
  was scanned; it exists only as a documentary record. It is a permanent historical link, not
  independently re-verifiable.
- **B-3** (design L-4) SC102 does **not** expose "was this exception released by an approval"; the
  reader must correlate the approval with the ledger. Registered as an open follow-up; the SC101 /
  SC102 response structure was deliberately not changed.
- **B-4** (design L-6) `credit_check_results` has **no `special_approval_id` column** (verified: zero
  occurrences); the release association exists only in `component_breakdown_json.consumedSpecialApprovalId`
  plus the new ledger. This differs from the §29.25.1 A-54 design description. Registered as an open
  follow-up; no table structure was changed.
- **B-5** (design L-5) TIME_BOUNDED / OBJECT_BOUNDED now produce multiple ledger rows, and the
  "object boundary" semantics remain broad for the outbound scope (`source_sales_order_id IS NULL`).
  Their existing consumable semantics were **not** extended in this round.
- **B-6** The W11-A Credit Query **UI** does not exist; it is U3 scope. See §5.
- **B-7** HEAVY suite, browser / mobile acceptance and the other MySQL gates were **not authorized and
  not run**. No claim is made for them.
- **B-8** The T5 historical links are hard-coded constants that an auditor verifies against Git blobs;
  the test itself does not query Git at runtime. That verification was performed for this record and
  passes (§6).
- **B-9** The U2-1 round's frozen-payload increment block (`log/2026-10-28.md` §7 and `solution.md`
  `§37.54.15.10`) states that "the remaining 12 W11-SEC-01 frozen payloads are individually
  unchanged". That statement is **inaccurate for `package.json`**, which the same round changed by one
  line (the `test:mysql:wave11-a` script entry). The change itself was planned and authorized
  (`log/2026-10-28.md` §1425) and is minimal, additive and version-neutral, but it was not itemised in
  that increment block. This record states the accurate current state (**11 of 14** unchanged; three
  superseded with reasons and current baselines). The earlier records are **not** rewritten.

**C. Project-level release risks — unchanged, not U2 Capability Gate failures, and not discharged by
this record**

- **`W10-INV-RISK-01` — `BLOCKS_RELEASE_ONLY`** — unchanged and still blocking production release.
- **`CREDENTIAL_EXPOSURE_OPEN` — `USER_ACCEPTED / DEFERRED`** — unchanged. The owner accepted and
  deferred the remediation. This closure neither read, compared, exported nor modified any credential,
  did not modify the DPAPI store, and did not rebuild the identity baseline.
- **`LEGACY_DATA_EVIDENCE_PENDING`** — unchanged; the external historical inventory was not authorized
  and not executed.
- **`WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`** — unchanged. This closure does not lift the release
  hold and does not approve a deployment.
- **D-2..D-5** remain open and continue to block W11-B / W11-C.
- **Production release is still not authorized.** The system as a whole is **not** declared ready for
  production release.

### 10. Preservation of the Wave 10 freeze and of the remaining OPEN items

- **Wave 10 Capability Freeze remains `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`.**
- **`W11-SEC-01` Freeze Record, `W11-A U1` Freeze Record and every earlier W11-A U2 Requirement /
  Design / Implementation record are preserved verbatim.** They are **not** rewritten, recomputed,
  overwritten or voided by this record. The W11-SEC-01 original 14 digests and the U1 digests remain
  permanently recorded.
- **`W11_A_ACCEPTANCE_PASS` is not issued** and remains reserved for the complete W11-A package.
- **W11-A U3 / W11-B / W11-C / W11-D have not started.** This freeze authorizes none of their
  Implementations.
- **Git consolidation still requires separate authorization.** This freeze is a decision record only: no
  `git add`, `commit`, `push`, `tag`, `merge`, `rebase`, `reset`, `restore`, `clean` or `stash` was
  performed, no `package.json` version was changed, and no release tag was created, moved or deleted.
  The working tree remains uncommitted; the timing and content of any commit are the user's decision.

### 11. Closure status

**`W11_A_U2_FINAL_ACCEPTANCE_PASS`**

**`W11_A_U2_FINAL_ACCEPTANCE_PASS — FROZEN`**

- `W11_A_U2_ONLY` — the W11-A package token `W11_A_ACCEPTANCE_PASS` is **not** issued;
- `SC101_BACKEND_ACCEPTED`; `SC102_BACKEND_ACCEPTED`;
- `V2_HASH_CONTRACT_ACCEPTED`; `V1_HISTORY_COMPATIBILITY_PRESERVED`;
- `ONE_TIME_SINGLE_CONSUMPTION_PROVABLE`;
- `REAL_MYSQL_E3_12_OF_12_PASS` — `GATE_EXIT_CODE=0`, `CLEANUP_CONFIRMED`, five-category final zero
  objects, TAP SHA-256 `52c18b1c02eccfaee447f8e7ed24e6b32eea52f36cbdcec65086f7af8c4a3ac7`;
- `FOCUSED_144_OF_144`; `FAST_500_OF_500`; `FULL_3021_OF_3021`; `BUILD_PASS`; `DIFF_CHECK_PASS`;
- `W11_SEC_01_FROZEN_DIGESTS_PRESERVED` — 11 of 14 still byte-identical, 3 superseded by recorded
  bounded amendments; `NO_W11_SEC_01_RE_FREEZE`; `NO_U1_RE_FREEZE`;
- `WHITELIST_EXCEPTIONS_CLOSED`;
- `B1_TO_B9_DISCLOSED_NON_BLOCKING`;
- `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED_PRESERVED`;
- `W10_INV_RISK_01_BLOCKS_RELEASE_ONLY_PRESERVED`;
- `CREDENTIAL_EXPOSURE_OPEN_USER_ACCEPTED_DEFERRED_PRESERVED`;
- `LEGACY_DATA_EVIDENCE_PENDING_PRESERVED`;
- `W11_A_U3_NOT_STARTED`; `W11_B_C_D_NOT_STARTED`; `D2_TO_D5_BLOCK_W11_B_C_PRESERVED`;
- `HEAVY_MYSQL_GATE_BROWSER_NOT_RUN` — `NO_PASS_CLAIMED_FOR_THEM`;
- `NO_GIT_WRITE`; `NO_RELEASE`; `NO_DEPLOY`; `NO_VERSION_CHANGE`; `NO_TAG_CHANGE`.

---
