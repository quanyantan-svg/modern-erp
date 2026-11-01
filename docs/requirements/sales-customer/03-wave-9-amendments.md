# Sales & Customer — Wave 9 Requirement Amendments

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/requirements/sales-customer/README.md`
> 来源：`document.md` Wave 9 修订节（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## Stage B Requirement Applicability Closure — Sales Credit Waves 9–11 (2026-10-22)

### 1. Authorization, scope and frozen protection

This is an additive Requirement applicability closure for the combined Sales Credit scope (Wave 9 + Wave 10 + Wave 11), performed under authorization `STAGE_A_AUDIT_PASS — STAGE_B_REQUIREMENT_ONLY_AUTHORIZED`.

It records only Requirement-level applicability and clarification. It does **not** approve any physical schema, key, constraint, migration shape, transaction boundary or implementation approach, and it does **not** authorize Stage C Design or Stage D Implementation. `solution.md` remains read-only in this stage.

Scope:

```text
Wave 9   SC83..SC89         (7 capabilities)
Wave 10  SC82 + SC90..SC98  (10 capabilities)
Wave 11  SC99..SC107        (9 capabilities)
Total    26 capabilities     (B3103 Credit Management)
```

The following remain frozen and unchanged by this record: all Wave 1–8 contracts; the Wave 8 freeze; every historical Requirement, Design and acceptance record; and all identifier namespaces and counts —

```text
SC total        = 114   (unchanged)
Invariant total = 20    (unchanged; S01..S20)
UAT total       = 44    (unchanged; UAT-S-01..UAT-S-44)
Race total      = 24    (unchanged; R-SAL-01..R-SAL-24)
Audit CAP total = 36    (unchanged)
```

No SC, Invariant, UAT, Race or CAP identifier is added, deleted or renumbered by this record.

Decision classifications used here:

| Classification | Meaning |
|---|---|
| `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` | Existing frozen Requirement already determines the behavior; this record only confirms or disambiguates it. No new business approval is requested. |
| `BOUNDED_CLARIFICATION_ONLY` | The underlying intent is frozen; this record makes an implicit distinction explicit without adding business policy. |
| `REQUIREMENT_DECISION_PENDING` | A genuinely new business decision is required and is **not** answered by this record. Stage C and Implementation are blocked on it until the user decides. |
| `LEGACY_DATA_EVIDENCE_PENDING` | Depends on read-only evidence from an external environment that does not yet exist and has not been authorized. No compatibility claim is made. |

### 2. Baseline verification

Verified read-only before this record was written:

```text
branch  = feature/sales-waves6-13
HEAD    = fb8d3a417882956ccab882a87e2066a140e4d9c4
version = 1.6.2
remote  = github.com/quanyantan-svg/modern-erp
tracked working-tree changes = 0
untracked artifacts = 602, all SQLite / WAL / SHM test artifacts
APPLY_GUIDE.md = present, untouched
```

No baseline difference was found. No branch, commit, tag, push, merge or history operation was performed.

### 3. B-1 — Optional salesperson dimension in Credit Profile

**Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` (confirmed) + `BOUNDED_CLARIFICATION_ONLY` (four-way distinction).**

Frozen text confirmed unchanged — §34.3.20 SC87:

```text
SC87 Credit Profile (credit object + customer + optional salesperson dimension
     where valid)                                                                  [DOMAIN_OWNED]
```

§34.1.1 and §34.8 row 11 confirm Customer identity foundation stays with Master & Engineering and Sales only extends it; no second Customer identity is permitted.

The frozen Requirement already establishes the optional salesperson dimension. This Stage B record makes the four constituent concepts explicit so that no later stage may conflate them:

| Concept | Requirement meaning | Frozen anchor |
|---|---|---|
| **Credit Object identity** | The commercial subject the credit profile governs | SC87 "credit object" |
| **Customer-level Credit Profile** | A profile whose scope is the customer as a whole, with no salesperson dimension | SC87 (customer component; salesperson optional) |
| **Salesperson-specific Credit Profile** | A profile that additionally applies to one salesperson **where valid** | SC87 (explicit "optional salesperson dimension where valid") |
| **Effective-dated Profile version** | A dated version of one of the above, governed by effective dates | SC88 "Credit Profile Effective Dates + Overdue-Day Policy"; S19 |

Explicit constraint adopted from this Stage B record: **the optional salesperson dimension must not be eliminated merely to simplify a database primary key, a UNIQUE constraint or any other physical identity.** SC87 remains the governing Requirement text. If any later stage cannot express both the customer-level and salesperson-specific scope in physical form, that is a physical-design failure to be solved in Stage C — it is **not** grounds to narrow SC87.

**No surrogate primary key, normalized scope key, UNIQUE, CHECK or FK decision is made here.** Those remain Stage C responsibilities and are carried forward in §10.

The precedence question raised by having both scopes is a separate matter and is recorded as `REQUIREMENT_DECISION_PENDING` in §9.

### 4. B-2 — R-SAL-24 business meaning

**Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` (confirmed).**

`DORMANT` in §34.6 is an implementation / coverage status. This is confirmed by the frozen text itself, not by inference: the §34.6 Race Coverage Snapshot states

```text
R-SAL-01..R-SAL-15  → 5 REAL covered today + 10 DORMANT pending capability implementation
```

so `DORMANT` means **pending capability implementation**. It does not mean the race can never be implemented, and it is not a prohibition on scheduling.

The business invariant remains exactly as frozen in §34.6.2:

```text
one credit decision → one coherent effective policy version
```

Valid serialization outcome A: the Credit Check logically precedes the policy mutation and uses the complete OLD effective snapshot.
Valid serialization outcome B: the policy mutation logically precedes the Credit Check and uses the complete NEW effective snapshot.
Forbidden: one Credit Check combining old credit limit + new rule + old overdue policy + new rating/profile state, or any other mixed-version decision.

R-SAL-12 and R-SAL-24 remain distinct and non-subsumable, per §34.6.1 and the explicit prohibition in §34.11 E: *"不允许 subsume R-SAL-24 进入 R-SAL-12"*. R-SAL-12 protects exposure / capacity consumption; R-SAL-24 protects coherent effective policy / profile snapshot consistency. §34.6.1 additionally fixes R-SAL-24's canonical lock identity as **effective policy / profile / limit / rule / overdue / rating-result version identity** — a version identity, which this record does not weaken.

Confirmed constraint: **full R-SAL-24 verification must not be claimed in Wave 9.** R-SAL-24 is defined as a mutation-versus-Credit-Check race, and real Credit Check runtime is planned for Wave 10. Wave 9 may only establish the anchor and lock-order infrastructure that R-SAL-24 depends on. The reconciliation of infrastructure-level versus end-to-end verification timing is a Stage C responsibility and is carried forward in §10.

### 5. B-3 — Legacy Credit Profile compatibility

**Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` (compatibility rules) + `LEGACY_DATA_EVIDENCE_PENDING` (applicability).**

Current evidence does **not** establish whether historical `credit_profile` rows exist in any external target database. Repository inspection confirms no such table exists in this repository: the only occurrences of `credit_profile` outside `solution.md` are negative assertions in `server/sales-customer-wave0-migration-runner.test.js`, `server/mysql-sales-customer-wave0.integration.js` and `server/mysql-sales-customer-wave1-upgrade.integration.js`, all of which assert that the table must **not** yet exist.

Applicability therefore remains **`LEGACY_DATA_EVIDENCE_PENDING`** and no compatibility claim is made in either direction. The legacy bootstrap remains conditional upon a separately authorized, read-only environment inventory.

The Requirement-level compatibility behavior is fixed as follows, applying to any Credit legacy path:

```text
1. Preserve authoritative historical data.
2. Do not invent missing Credit Profile records.
3. Do not fabricate historical credit limits or ratings.
4. Do not silently resolve ambiguous identity.
5. Reject unsafe or nondeterministic migration.
6. Do not claim historical compatibility without evidence.
```

These behaviors are grounded in already-frozen Requirement and governance text and are not new policy: S05 (approved historical execution cannot be silently rewritten), `AGENTS.md` §6 (unknown historical facts must not be fabricated), and `AGENTS.md` §15 (legacy tables must not be dropped in ordinary cleanup).

Explicit constraint: **legacy bootstrap is conditional.** Until the read-only inventory is separately authorized and produces evidence, no stage may assume that a legacy Credit Profile table exists, that it is empty, or that it is compatible.

No database was opened, queried or modified during this Stage B closure.

### 6. B-4 — Rating result and Profile version identity

**Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` (traceability principle) + `BOUNDED_CLARIFICATION_ONLY` (five-identity distinction).**

The governing principle is already frozen: S05 (approved historical execution cannot be silently rewritten) and §34.6.2's race-corollary invariant (where a Credit Check returns a special-approval outcome, the exception request must trace to the exact Credit Check and policy snapshot that produced it, and a later policy mutation must not silently reinterpret an already approved exception). SC107 (Credit Rating Result Application → Credit Profile) and UAT-S-36 ("result → Credit Profile") place rating application on the Credit Profile.

This record makes the five business identities explicit and states that they must not be collapsed:

| Identity | Business responsibility | Must remain distinct from |
|---|---|---|
| **Stable Credit Object / locking identity** | The long-lived credit-control scope and serialization identity | the effective profile version and the evidence snapshot |
| **Effective Credit Profile version** | The effective-dated limit, status, rating and overdue state that applied on a business date | the stable anchor and the decision evidence |
| **Immutable policy snapshot evidence** | The coherent, append-only evidence of the policy state used by one decision | the lock identity |
| **Credit Evaluation result** | The evaluation outcome produced by a scoring sheet and scheme | the profile version it was applied to |
| **Applied rating history** | The dated record that a rating was applied to a specific profile version | the evaluation result that produced it |

Explicit constraint: **historical evidence must remain traceable after a later profile or rating mutation, and these business identities must not be collapsed into a single physical ID merely for implementation convenience.** Any later stage that maps more than one of these identities onto one physical identifier must demonstrate that historical traceability is preserved, or return to Requirement.

### 7. Stage B 26-SC Requirement coverage matrix

All 26 capabilities are mapped to their frozen Requirement text, business invariant, acceptance reference and Stage C carry-forward dependency. Capability status is unchanged by this record.

| Wave | SC | Frozen Requirement anchor | Invariant | Acceptance | Stage C carry-forward |
|---|---|---|---|---|---|
| 9 | SC83 | §34.3.18 Credit Management Enabled/Disabled + Scope | S15 | UAT-S-30 | #10 snapshot identity; #13 race timing |
| 9 | SC84 | §34.3.18 Credit Control Timing + Control Strength | S15 | UAT-S-30 | #5 parameter version uniqueness |
| 9 | SC85 | §34.3.19 Credit Check Rule Model | S15 | UAT-S-30 | #4 rule key; #13 race timing |
| 9 | SC86 | §34.3.19 Credit Rule Result Types (WARNING/BLOCK) | S15 | UAT-S-30 | #4 rule key |
| 9 | SC87 | §34.3.20 Credit Profile (optional salesperson) | S15 | UAT-S-29 | #1, #2, #3, #9, #15 |
| 9 | SC88 | §34.3.20 Effective Dates + Overdue-Day Policy | S19 | UAT-S-29 | #3 overlap / active resolution; #12 rating owner |
| 9 | SC89 | §34.3.20 Initial State + Rating + Applicable Rule + Status | S15 | UAT-S-29 | #12 rating canonical write owner |
| 10 | SC82 | §34.3.17 Credit Exposure Canonical-Fact Invariant | S14 | §34.8 row 12 | #10 |
| 10 | SC90 | §34.3.21 Exposure Component Composition | S14 | UAT-S-31 | — |
| 10 | SC91 | §34.3.21 Exposure Transition Rules | S14 | UAT-S-31 | #13 race timing |
| 10 | SC92 | §34.3.21 Used / Available / Over-Limit Calculation | S14, S15 | UAT-S-31 | #13 capacity preconditions |
| 10 | SC93 | §34.3.22 Credit Check Stage: SO Submit | S15 | UAT-S-32, R-SAL-12 | #9 provisioning boundary |
| 10 | SC94 | §34.3.22 Credit Check Stage: SO Approve + SD Confirm | S15 | UAT-S-32 | #9 |
| 10 | SC95 | §34.3.22 Mandatory BLOCK + Audit | S15 | UAT-S-32 | #9 |
| 10 | SC96 | §34.3.23 Special Approval Request | S16 | UAT-S-33, R-SAL-13 | #9, #10 |
| 10 | SC97 | §34.3.23 Special Approval Decision (bounded authority) | S16 | UAT-S-33, R-SAL-13 | #9 |
| 10 | SC98 | §34.3.23 Special Approval Audit + Linkage | S16 | UAT-S-33, §34.6.2 corollary | #10, #11 |
| 11 | SC99 | §34.3.24 CHECK-only Reconciliation | S17 | UAT-S-34 | — |
| 11 | SC100 | §34.3.24 Deterministic Recalculation | S17 | UAT-S-34, R-SAL-23 | — |
| 11 | SC101 | §34.3.25 Credit Query | — | UAT-S-35 | — |
| 11 | SC102 | §34.3.25 Credit Exception History | S05 | UAT-S-35 | #10 |
| 11 | SC103 | §34.3.26 Credit Indicator | — | UAT-S-36 | — |
| 11 | SC104 | §34.3.26 Credit Rating Scheme | — | UAT-S-36 | — |
| 11 | SC105 | §34.3.26 Model + Indicator Weight + Scoring Sheet | — | UAT-S-36 | #7 |
| 11 | SC106 | §34.3.26 Bounded Multi-Scorer | — | UAT-S-36 | — |
| 11 | SC107 | §34.3.26 Rating Result Application → Credit Profile | S05, S19 | UAT-S-36, R-SAL-24 | #6, #7, #8, #12 |

Sum check: 7 + 10 + 9 = **26** ✓

Cross-cutting Requirement anchors confirmed unchanged and applicable to all 26:

```text
Permissions / SOD   SC111 (Credit View/Manage/Evaluate/Special Approve)
                    SC114 + §34.7 P4 (CREDIT SPECIAL APPROVAL needs bounded authority,
                                       separate from standard approval)
                    UAT-S-44 final permission proof
Finance boundary    §34.8 rows 12/13 (read-only canonical AR / advance / unapplied /
                    refund / write-off) + §34.9 I1 (One AR truth)
No second ledger     SC82 + §34.8 row 12 (不得 second Sales / Finance exposure ledger)
No history mutation  S05 + S17 + §34.8 row 15
```

### 8. Additional Requirement coverage confirmation

Verified against the frozen §34 text. Each item below is **already expressed**; this record adds no new rule for any of them.

| Required behavior | Frozen location | Status |
|---|---|---|
| SC83–SC89 Credit Parameters, Rules, Profile | §34.3.18, §34.3.19, §34.3.20; §34.8 rows 10–11 | Confirmed |
| SC82 + SC90–SC98 PURE_DERIVED Exposure, Check, Special Approval | §34.3.17, §34.3.21, §34.3.22, §34.3.23; §34.8 rows 12–14 | Confirmed |
| SC99–SC107 Reconciliation, Query, Evaluation | §34.3.24, §34.3.25, §34.3.26; §34.8 row 15 | Confirmed |
| S14–S17 | §34.4 (S14 exposure no double-count; S15 mandatory BLOCK fail-closed; S16 bounded exception; S17 recalculation no history rewrite) | Confirmed |
| R-SAL-12 / 13 / 14 / 23 / 24 | §34.6, §34.6.1, §34.6.2 | Confirmed |
| UAT-S-29–36 | §34.5 (UAT-S-29 … UAT-S-36) | Confirmed |
| SC111 / SC114 Credit authorization and SOD | §34.3.27; §34.7 P1–P5 | Confirmed |
| Finance canonical AR / settlement read-only integration | §34.8 rows 12–13; §34.9 I1 | Confirmed |
| No second Credit Exposure ledger | SC82 §34.3.17; §34.8 row 12 | Confirmed |
| No mutation of historical Sales / Finance / Accounting truth | S05, S17; §34.8 row 15 | Confirmed |

Effective-date rule check:

```text
Already expressed:
  - SC88 "Credit Profile Effective Dates + Overdue-Day Policy" names effective
    dating as a Credit Profile capability.
  - UAT-S-29 accepts "Credit Profile 创建 + 生效日期 + overdue-day policy".
  - S19 makes the business date authoritative.

NOT expressed anywhere in frozen §34:
  - a rule that one logical Credit Object cannot hold two conflicting effective
    Credit Profiles on the same business date;
  - a resolution rule for the case where a customer-level profile and a
    salesperson-specific profile both apply on the same business date;
  - any interval-overlap prohibition or deterministic tie-break.

Verified by inspection: the credit Requirement area contains zero occurrences of
precedence, priority, fallback, most-specific or tie-break language. By contrast
§34.1.1 explicitly gives Sales Pricing "effective dates；priority / fallback", so
the omission in the Credit Profile clauses is a genuine gap rather than an
intentional design choice.
```

Because a naive "one profile per customer per date" rule would contradict SC87 by eliminating the optional salesperson dimension recorded in §3, this gap must not be closed by assumption. It is recorded in §9 as `REQUIREMENT_DECISION_PENDING` and no rule is inserted here.

### 9. `REQUIREMENT_DECISION_PENDING` register

One genuinely new business decision is required. It is not answered by this record and no rule has been inserted.

```text
REQUIREMENT_DECISION_PENDING-1

Question:
  When a customer-level Credit Profile and a salesperson-specific Credit Profile
  are both effective on the same business date for the same Credit Object, which
  one governs the credit limit and status used by the Credit Check?

Why it cannot be inferred:
  - SC87 establishes that both scopes may exist; it does not order them.
  - SC88 establishes effective dating; it does not order overlapping scopes.
  - A "one profile per customer per date" reading would eliminate the optional
    salesperson dimension and contradict SC87.
  - "Most specific wins", "customer-level wins" and "aggregate / strictest wins"
    are all commercially defensible and produce materially different limits,
    approvals and audit outcomes.

Blocking effect:
  Wave 9 Implementation of SC87 / SC88 effective-date resolution is blocked on
  this decision. Stage C must not invent an ordering.

Explicitly NOT decided here:
  ordering rule; whether cross-scope overlap is forbidden or resolved by
  tie-break; whether effective-version intervals must be non-overlapping per
  scope; which profile supplies credit_limit_cents for evaluation.
```

Related but **not** an independent business decision, because it is a physical-design question rather than a policy question: whether effective-version intervals of one scope must be physically non-overlapping is Stage C carry-forward item #3. Its cross-scope case was subject to `REQUIREMENT_DECISION_PENDING-1` and is now governed by the approved decision recorded in §13.

#### 9.1 Resolution — `RESOLVED` (2026-10-22)

`REQUIREMENT_DECISION_PENDING-1` is **RESOLVED** by explicit user approval on 2026-10-22, under authorization `STAGE_A_AUDIT_PASS — STAGE_B_REQUIREMENT_ONLY_AUTHORIZED`.

Approved decision: **Customer-level Credit Limit + Salesperson-level Sub-Limit (Dual-Limit Control)**, recorded in full — policy, acceptance scenarios and boundary rules — in **§13**.

The register entry above is retained **verbatim** as the historical record that this gap existed, that it could not be inferred from frozen Requirement text, and that it was deliberately left unanswered rather than closed by assumption. It has not been erased or rewritten.

Consequences of this resolution:

```text
Blocking effect on Wave 9 SC87 / SC88 effective-date resolution : LIFTED
Stage C carry-forward items #1, #2, #3                         : unblocked at
                                                                    Requirement
                                                                    level; still
                                                                    require Stage C
                                                                    Design
                                                                    reconciliation
Blocking effect on Stage C authorization                        : UNCHANGED —
                                                                    Stage C remains
                                                                    NOT AUTHORIZED
```

No other `REQUIREMENT_DECISION_PENDING` entry exists in §34 or in this Stage B closure. `LEGACY_DATA_EVIDENCE_PENDING` (§5) is an external-evidence dependency, not an undecided Requirement, and remains open by design.

### 10. Stage C Design carry-forward register

The following 15 unresolved Design issues are preserved for Stage C reconciliation. **None is resolved by this Stage B record**, and none may be resolved by modifying `solution.md` during Stage B.

| # | Carried-forward Design issue |
|---|---|
| 1 | `credit_profile` physical primary key and candidate keys |
| 2 | Nullable salesperson normalized-scope uniqueness and bidirectional consistency |
| 3 | Effective-date interval overlap and deterministic active Profile resolution (cross-scope case subject to REQUIREMENT_DECISION_PENDING-1) |
| 4 | `credit_check_rules.id` PK / UNIQUE definition |
| 5 | `credit_parameters` column UNIQUE versus composite PK conflict |
| 6 | `credit_profile_ratings` Wave 9 → Wave 11 deferred FK |
| 7 | SQLite foreign-key creation versus pre-target DML behavior |
| 8 | MySQL FK ordering and idempotent metadata convergence |
| 9 | Stable Credit Anchor provisioning transaction boundary |
| 10 | Credit Policy Snapshot fingerprint identity and uniqueness |
| 11 | Canonical names: `credit_lock_anchors` and `credit_check_results` |
| 12 | Credit Profile rating canonical write owner |
| 13 | R-SAL-12 / R-SAL-24 infrastructure versus full business-race timing |
| 14 | Read-only legacy inventory and conditional bootstrap |
| 15 | SQLite / MySQL PK, UNIQUE, CHECK, FK and indexed-column type parity |

Additional external-review findings carried forward and explicitly bound:

- **Credit Profile normalized-scope consistency and effective-date overlap** → items #2 and #3, gated by REQUIREMENT_DECISION_PENDING-1.
- **`credit_parameters` effective-version uniqueness** → item #5. Frozen Requirement SC83 / SC84 already require configurable Credit Parameters; a column-level uniqueness that defeats effective versioning is a physical defect to reconcile in Stage C, not a new business decision.
- **SQLite FK pre-target DML compatibility** → item #7. Whether SQLite accepts an inline foreign key whose target table does not yet exist, and when such a constraint actually begins to be enforced, is a cross-dialect fact that Stage C must establish and Stage D must prove by test. It is not assumed here.

### 11. Requirement delta

Appended by this Stage B record:

```text
document.md   "Stage B Requirement Applicability Closure — Sales Credit Waves 9–11
              (2026-10-22)" sections 1–12, appended after the Wave 8 Final
              Acceptance and Freeze Record. Additive only; no existing line
              modified, removed or renumbered.
```

Not modified:

```text
§34.1  scope and ownership          unchanged
§34.2  capability catalogue         unchanged
§34.3  SC01..SC114 definitions      unchanged
§34.4  S01..S20 invariants          unchanged
§34.5  UAT-S-01..UAT-S-44           unchanged
§34.6  R-SAL-01..R-SAL-24           unchanged
§34.7  permission / RBAC / SOD      unchanged
§34.8  cross-domain boundary        unchanged
§34.9  compatibility constraints    unchanged
§34.10 out of scope                unchanged
§34.11 acceptance criteria         unchanged
§34.12 hard stop conditions        unchanged
§34.13 coverage validation trace   unchanged
all historical Stage B / Stage D / freeze records   unchanged
solution.md                        unchanged
source / migrations / tests / UI   unchanged
```

For all four mandatory decisions B-1, B-2, B-3 and B-4, the closure confirms already-frozen Requirement intent and adds no new business policy.

`REQUIREMENT_SEMANTICS_UNCHANGED`

with exactly one additive element that introduces **no** new policy: the bounded clarification of already-frozen concepts in §3, §4, §5 and §6, plus the `REQUIREMENT_DECISION_PENDING-1` register in §9, which records a gap and deliberately does not answer it.

**Superseded in part by §13.** The statement above accurately described the delta as of the initial applicability closure, in which B-1 … B-4 were confirmations only. §13 was subsequently appended after explicit user approval and **does** introduce new business policy (Dual-Limit Control), resolving `REQUIREMENT_DECISION_PENDING-1` per §9.1. The full Requirement delta for the current state of this closure is therefore recorded in §13.6 and the §13 status line, not solely in this §11 statement.

### 12. Frozen boundary

This Stage B closure is bounded to Requirement applicability for Sales Credit Waves 9–11. It does not freeze or unfreeze any Wave, does not approve Stage C Design, does not authorize Stage D Implementation, and does not constitute a commit, push, merge, tag, release, deployment, migration or package-version change.

Wave 1–8 frozen contracts remain fully in force. No historical Requirement, Design or acceptance text has been rewritten. `APPLY_GUIDE.md` and all 602 untracked SQLite / WAL / SHM artifacts were preserved untouched.

Stage C Design reconciliation and Stage D Implementation remain **NOT AUTHORIZED** and must not begin until the user explicitly confirms this Requirement closure. As originally recorded, both the `REQUIREMENT_DECISION_PENDING-1` register and the 15-item Stage C carry-forward register were open at this point.

**Status at §12: `STAGE_B_REQUIREMENT_APPLICABILITY_CLOSED — AWAITING_USER_REQUIREMENT_PASS`.**

Superseded in part by §13 and §9.1 below: `REQUIREMENT_DECISION_PENDING-1` was subsequently **RESOLVED** by explicit user approval on 2026-10-22 (§13). The 15-item Stage C carry-forward register remains fully open, and Stage C remains NOT AUTHORIZED.

---

### 13. Approved business decision — Customer-level Credit Limit + Salesperson-level Sub-Limit (Dual-Limit Control)

**Resolution target:** `REQUIREMENT_DECISION_PENDING-1` (§9), resolved per §9.1.
**Authorization:** explicit user approval, 2026-10-22, under `STAGE_A_AUDIT_PASS — STAGE_B_REQUIREMENT_ONLY_AUTHORIZED`.
**Scope:** SC87, SC88, SC90, SC91, SC92, SC93, SC94, SC95.

This is the first and only **new business policy** introduced by this Stage B closure. It adds no physical schema decision, no key definition, no constraint shape and no transaction design. It defines business semantics only.

#### 13.1 Approved policy

```text
P1  A customer-level Credit Profile defines the aggregate credit ceiling for
    the customer.

P2  A salesperson-specific Credit Profile defines an additional sub-limit for
    eligible business attributable to that salesperson.

P3  When both profiles apply, BOTH controls must pass. The salesperson-specific
    profile does not replace or increase the customer-level aggregate ceiling.

P4  When only a customer-level profile applies, use the customer-level control.

P5  When only a salesperson-specific profile applies, use that valid limit only
    if the frozen Credit Policy permits salesperson-level control without a
    mandatory customer-level profile. Otherwise fail closed.

P6  Missing required profiles, ambiguous attribution or invalid effective scope
    must never produce an implicit PASS.

P7  Customer-level exposure includes all applicable customer obligations.
    Salesperson-level exposure contains only source obligations with canonical,
    provable salesperson attribution.

P8  The same economic obligation may participate in both the customer aggregate
    check and its applicable salesperson sub-limit check, but must be counted
    only once within each exposure calculation.

P9  Existing Finance AR or settlement history must never be arbitrarily
    apportioned across salespersons.

P10 Credit decisions must use one authoritative business date and deterministic
    effective-profile resolution.

P11 Overlapping effective-date intervals for the same logical profile scope are
    invalid unless an independently approved explicit version-resolution rule
    exists.

P12 Where more than one credit scope must be enforced, the checks must form one
    logically atomic business decision. Stage C owns physical lock identities,
    acquisition order and transaction implementation.

P13 Credit Special Approval must remain bounded to the exact applicable scope,
    authority, ceiling and validity interval. It cannot silently override other
    applicable mandatory credit controls.
```

#### 13.2 Relationship to frozen Requirement

This decision resolves the gap recorded in §8 and §9 without weakening any frozen contract. It is additive to, and subordinate of, existing §34 text:

```text
S14 (exposure no double-count)      P8 scopes the rule PER SCOPE; S14 and the
                                    SC91 stage-transition rule continue to
                                    govern the STAGE dimension. Both hold
                                    simultaneously; P8 does not replace S14.
S15 (mandatory BLOCK fail closed)   reinforced by P5, P6 and P11
S16 (bounded exception)             reinforced by P13
S17 (no history rewrite)            protected by P7 and P9
S19 (business date authoritative)   reinforced by P10
§34.6.2 race corollary              reinforced by P13
§34.8 row 12 / §34.9 I1             reinforced by P9 (One AR truth)
SC87 optional salesperson           PRESERVED — P2 depends on it
SC82 PURE_DERIVED                   UNCHANGED — no second exposure ledger
SC83 / SC84 Credit Policy           P5 delegates the salesperson-only
                                    permission to Credit Policy configuration
```

#### 13.3 Business acceptance matrix

Business-level acceptance only. No physical schema, key, column or index is implied.

**Positive scenarios**

| # | Scenario | Expected business outcome |
|---|---|---|
| A1 | Customer-level profile only; aggregate exposure within ceiling | PASS under customer control |
| A2 | Customer-level + salesperson sub-limit both applicable; both within | PASS under both controls |
| A3 | Salesperson-only profile; Credit Policy permits salesperson-level control; within limit | PASS under salesperson control |
| A4 | One economic obligation subject to both controls | Counted once in the customer calculation and once in the salesperson calculation; never twice within either |
| A5 | Obligation transitions SO exposure → delivered AR exposure | Original SO exposure released/re-declared per SC91; not simultaneously counted with active AR exposure |
| A6 | Credit Special Approval granted for one applicable scope | That scope may proceed within the approved ceiling, authority and validity interval only |

**Negative scenarios**

| # | Scenario | Expected business outcome |
|---|---|---|
| N1 | Customer aggregate exceeded; salesperson sub-limit within | BLOCK on customer control |
| N2 | Salesperson sub-limit exceeded; customer aggregate within | BLOCK on salesperson control |
| N3 | Both controls exceeded | BLOCK |
| N4 | Overlapping effective-date intervals within the same logical scope | INVALID effective scope; fail closed; no implicit PASS |
| N5 | Salesperson-only profile; Credit Policy does NOT permit salesperson-level control without a mandatory customer-level profile | Fail closed; no implicit PASS |
| N6 | A required profile is missing or invalid | Fail closed per §29.22.1 and S15 |
| N7 | Salesperson attribution ambiguous or not provable | Not attributable to any salesperson scope; never recorded as salesperson-scope PASS |
| N8 | Credit Special Approval granted for the customer aggregate, salesperson sub-limit still exceeded | Sub-limit still BLOCK; approval does not leak to another scope |
| N9 | Credit Special Approval granted for a salesperson sub-limit, customer aggregate still exceeded | Aggregate still BLOCK; approval does not leak to another scope |
| N10 | Attempt to apportion Finance AR or settlement history across salespersons | PROHIBITED by P9; no such derivation may exist |

#### 13.4 Boundary — obligations without provable salesperson attribution

`REQUIREMENT_DECISION_PENDING-1` was resolved by the explicitly approved **Dual-Limit Control** policy recorded in §13.1, not by selecting among candidate orderings. One boundary consequence of that policy is recorded explicitly so that no later stage may resolve it by assumption:

```text
sales_orders.salesperson_id is a NULLABLE foreign key added in Wave 4
(server/migrations/sales-customer-wave4-orders.js). Obligations created before
Wave 4, and any obligation without provable salesperson attribution, therefore
carry no salesperson dimension.

Such obligations:
  - DO count fully in customer-level aggregate exposure (P7, first clause);
  - MUST NOT count toward any salesperson sub-limit (P7, second clause);
  - MUST NOT be recorded as salesperson-scope PASS (P6);
  - MUST NOT be apportioned from Finance AR or settlement history (P9).

This is fail-safe rather than an implicit PASS: the customer aggregate ceiling
still binds these obligations. Excluding them from the sub-limit removes a
constraint, but the aggregate ceiling remains in force, so no obligation becomes
uncontrolled.

Stage C must prove this boundary on both the fresh-install and legacy-upgrade
paths, and must not introduce any compensating inference.
```

#### 13.5 Delegated to Credit Policy configuration, not a new Requirement decision

P5 delegates the salesperson-only permission to Credit Policy configuration (SC83 / SC84), defaulting to fail closed per §29.22.1. This is a runtime configuration question and **not** a second pending Requirement decision. Stage C must make that configuration dimension explicit, but no further business policy decision is required from the user.

#### 13.6 Stage C obligations created by this decision

Stage C must demonstrate that the approved policy is implementable consistently, and must **not** assume any particular physical schema is approved:

```text
- customer aggregate and salesperson sub-limit exposure calculations that
  satisfy P7 / P8 / P9 simultaneously
- one logically atomic multi-scope Credit Check (P12) expressed in physical
  terms, with deterministic deadlock-safe anchor lock order
- the deferred Wave 9 -> Wave 11 foreign key, with SQLite / MySQL migration
  equivalence
- immutable policy snapshot identity and uniqueness that can bind a coherent
  multi-scope decision (R-SAL-24)
- independent, separate concurrency evidence for R-SAL-12 and R-SAL-24
- the §13.4 attribution boundary on fresh-install and legacy-upgrade paths
- Credit Policy configuration dimension for P5
```

Stage C authorization is still **NOT GRANTED** by this record.

**Status: `STAGE_B_REQUIREMENT_DUAL_LIMIT_DECISION_APPROVED — AWAITING_USER_REQUIREMENT_PASS`.**

---

## Stage B Requirement Amendment — Sales Credit Profile Authorization Policy (Wave 9) (2026-10-22)

**Authorization:** explicit user approval of the complete Credit Profile authorization policy, under bounded authorization `WAVE9_BOUNDED_REQUIREMENT_CLOSURE`.
**Scope:** SC83..SC89, SC111, SC114; Wave 9 Credit Profile, Credit Lock Anchor and their read/write authorization.
**Classification:** this is a **NEW approved business authorization policy**. It is **not** an existing frozen Requirement that was already fully defined, and it must not be described as prior functionality.

### 14. Resolution target — `REQUIREMENT_DECISION_PENDING-2`

#### 14.0 Historical state of the pending decision (preserved, not rewritten)

```text
RAISED    2026-10-22, log/2026-10-22.md, "Sales Credit Wave 9 — Bounded
          Data-Scope Design Review (W9-P1)"
QUESTION  Frozen Requirement does not determine Credit Profile ownership,
          visibility scope or mutation scope, and no sales-group data scope is
          implemented for Credit. Three commercially defensible policies exist:
          Credit as a central function; ownership via the customer's default
          Sales Group; or aggregate-shared / sub-limit-private.
STATUS    RAISED AND NOT ANSWERED. solution.md was deliberately not modified;
          no remediation was performed. Wave 9 remained IMPLEMENTED /
          ACCEPTANCE_PENDING.
SOURCE    log/2026-10-22.md §"Bounded Data-Scope Design Review (W9-P1)"
```

The raise record above is preserved verbatim in `log/2026-10-22.md` and is not erased or rewritten. `REQUIREMENT_DECISION_PENDING-2` was **not** written into `document.md` at raise time; it existed only in the append-only log. It is registered here so that the Requirement source of truth carries the full pending-decision history.

Verified Requirement evidence that the gap could not be closed by inference:

```text
SC06 (§34.3.1)          scopes backend group data isolation to
                        quotation / SO / report "once they carry sales_group_id";
                        credit_profile carries no sales_group_id.
UAT-S-44 (§34.5)       repeats the same scoping for Quotation / Sales Order /
                        Reports "once they carry sales_group_id".
SC111 (§34.3.27)       defines capability intent only — View / Manage /
                        Evaluate / Special Approve — with no ownership dimension.
§34.7 P1-P5            contain no group-ownership clause.
§34.8 row 11           Credit Profile boundary is "R/W: Sales extends customer /
                        不得 second Customer identity"; no access owner is named.
§13 P1-P13             govern limit semantics and fail-closed evaluation, not
                        visibility or ownership.
```

#### 14.1 Resolution — `RESOLVED` (2026-10-22)

`REQUIREMENT_DECISION_PENDING-2` is **RESOLVED** by explicit user approval on 2026-10-22, under authorization `WAVE9_BOUNDED_REQUIREMENT_CLOSURE`.

```text
Before : REQUIREMENT_DECISION_PENDING-2 = RAISED / NOT ANSWERED
         (registered in log/2026-10-22.md only; Stage C and Implementation
          blocked on it)
After  : REQUIREMENT_DECISION_PENDING-2 = APPROVED / RESOLVED
         (new business authorization policy recorded in §14.2)
```

Approved decision: **Sales Credit Central Ownership + Shared Customer Aggregate Read Access + Self-Only Salesperson Sub-Limit Visibility + Combined Credit Permission and Cross-Group Scope Enforcement.**

**Naming note.** The external review package labelled the four decisions `P1`–`P4`. They are recorded here as `AP1`–`AP4` / `AP4.1` so that they can never be confused with the already-frozen **Dual-Limit Control** series §13.1 `P1`–`P13`. Content is unchanged by this renaming.

### 14.2 Approved policy

#### AP1 — Central Credit ownership

Credit Profile is centrally owned by the **Sales Credit business domain**.

A Credit Profile is **NOT** owned by:

- a specific Sales Group;
- the customer's default Sales Group;
- the currently logged-in salesperson;
- the creator of the profile;
- the salesperson who last modified it.

Customer-level and salesperson-specific Credit Profiles remain centrally governed Credit business records.

Sales Group membership is an **authorization-context fact, not Credit Profile ownership**.

```text
Do NOT create a duplicate profile per Sales Group.
Do NOT split the existing customer aggregate credit ceiling by Sales Group.
Do NOT alter §13.1 Dual-Limit Control P1-P13.
```

#### AP2 — The customer aggregate is enterprise-shared

The Customer Aggregate Credit Limit belongs to the centrally administered customer credit object. The same customer may legitimately transact through multiple Sales Groups.

1. A customer does **not** require one authoritative Sales Group owner for Credit Profile purposes.
2. A **missing default Sales Group does not invalidate** a centrally administered Customer Aggregate Profile.
3. Multiple active Sales Group relationships do **not** create duplicate aggregate limits.
4. The customer's default Sales Group is a **commercial default, not an authorization ownership key**.
5. Existing customer and salesperson canonical identities remain authoritative.

A qualified central Credit administrator may create and manage a Customer Aggregate Profile even when the customer has no default Sales Group.

```text
Do NOT introduce synthetic ownership rows, assignment rows or surrogate owner keys.
```

#### AP3 — Salesperson sub-limit visibility is self-only

For an ordinary salesperson holding `CREDIT_VIEW`:

| Target | Result |
|---|---|
| Customer Aggregate Profile | readable |
| Own salesperson Sub-Limit Profile | readable — subject to a valid canonical salesperson identity and active applicable membership |
| Any other salesperson's Sub-Limit Profile | **not readable** |

```text
Same Sales Group membership alone does NOT confer permission to read another
salesperson's sub-limit.

Membership in multiple Sales Groups does NOT confer visibility over other
salespersons' profiles.

An unmapped, inactive or otherwise invalid salesperson identity does NOT
qualify for self-scope access.
```

Read restriction applies to **every** read surface, not only the list:

```text
- collection queries
- detail-by-ID queries
- effective-dated profile versions
- historical rating records associated with a restricted profile
- nested or expanded profile responses
- any API projection that would otherwise expose restricted sub-limit data
```

Frontend hiding is **not** a substitute for backend authorization.

Ordinary Sales Group membership must **not** be silently converted into Credit Profile administrator status.

#### AP4 — Credit permission and cross-group scope are separate and must both be enforced

```text
ADMIN
  Global Credit authorization, subject to existing audit, SOD and business
  controls. ADMIN bypass concerns ACCESS SCOPE only; it does not bypass
  business invariants or mandatory audit requirements.

SALES_CROSS_GROUP
  A DATA-SCOPE permission only. It does NOT independently grant:
    - CREDIT_VIEW
    - CREDIT_MANAGE
    - Credit Evaluation authority
    - Credit Special Approval authority
    - any additional Credit mutation authority
```

For non-ADMIN actors:

1. `CREDIT_VIEW` grants applicable Credit read capability.
2. `CREDIT_MANAGE` governs Credit management capability.
3. `SALES_CROSS_GROUP` expands the **data scope of already-authorized** Credit capabilities.
4. A user without an appropriate Credit capability remains denied even when `SALES_CROSS_GROUP` is present.
5. A user possessing `CREDIT_MANAGE` without the required central / cross-group management authorization **cannot** use that permission to raise their own sub-limit or the customer aggregate limit.

```text
Read and write permissions remain DISTINCT.

Use the existing permission registry and actor identity model.
Do NOT invent a new role or permission code.

If an existing permission explicitly implies another permission, preserve that
existing relationship. Do NOT invent an implicit relationship where the
repository does not define one.
```

#### AP4.1 — Central management write authority

Authorized Credit Profile management is restricted to:

1. **ADMIN**, or
2. a **non-ADMIN actor possessing both** the required Credit management authority **AND** `SALES_CROSS_GROUP` scope authority.

```text
Ordinary salesperson membership — including membership in the salesperson's
OWN profile scope — does NOT create Credit Profile write authority.

Consequence: an ordinary salesperson may NOT increase their own sub-limit,
even if the Sales role currently carries CREDIT_MANAGE.

The same restriction applies to customer aggregate limit modifications.

Existing business validation, effective-date rules and historical immutability
are NOT changed by this restriction.
```

### 14.3 Central configuration versus Profile authorization

Central Credit configuration is **not** Sales Group-owned merely because Sales Credit owns its business meaning. However, AP1–AP4 must not be read as granting new mutation rights over Parameters, Rules or Anchors beyond existing canonical permissions.

| # | Category | Determined by this policy, or by the existing frozen contract? |
|---|---|---|
| 1 | Global Credit Parameters | **Existing frozen contract governs** (SC83 / SC84 / §34.7). AP1 clarifies that central ownership ≠ Sales Group ownership. No new mutation right is created or removed. |
| 2 | Global Credit Check Rules | **Existing frozen contract governs** (SC85 / SC86 / §34.7). Same clarification; no new mutation right. |
| 3 | Customer Aggregate Credit Profiles | **Directly determined by this policy** — AP1 + AP2 + AP4 + AP4.1. |
| 4 | Salesperson Sub-Limit Credit Profiles | **Directly determined by this policy** — AP3 (read) + AP4.1 (write). |
| 5 | Credit Lock Anchors | **Partly determined.** AP1: an Anchor is an internal serialization identity derived from the Credit Object and is not a Sales-Group-owned record; its scope follows the centrally governed Credit Object. AP4/AP4.1 govern provisioning authority. Anchor provisioning must not become a route around Profile authorization (see N10). |
| 6 | Immutable Policy Snapshots | **Existing frozen contract governs** (S05, R-SAL-24, §34.6.2). This record creates **no** human-facing access contract for snapshots; they are internal decision evidence consumed by the Credit Check. |

Additional fixed statements:

```text
Internal Credit Check behavior in future Wave 10 is NOT a human-facing profile
read. Restricting what a person may see must NOT weaken what the engine must
evaluate.

The approved Credit Control engine must continue to evaluate ALL mandatory
customer and salesperson scopes, even where the current user is not personally
authorized to view every underlying Profile.

Frontend visibility permissions must NEVER weaken mandatory backend Credit
Checks.

The Wave 10 engine is neither built nor authorized by this record.
```

### 14.4 Authorization matrix

Read and write are separate columns by design (SC114 `VIEW != WRITE`).

| Actor / authority | Customer aggregate READ | Own sub-limit READ | Other sub-limit READ | Credit Profile WRITE |
|---|---|---|---|---|
| ADMIN | ALLOW | ALLOW | ALLOW | ALLOW (audit + business rules still apply) |
| Ordinary salesperson + `CREDIT_VIEW` | ALLOW | ALLOW **if valid own canonical identity + active applicable membership** | **DENY** | **DENY** |
| Reviewer / Accounting + `CREDIT_VIEW` | ALLOW | **DENY** | **DENY** | **DENY** |
| `CREDIT_VIEW` + `SALES_CROSS_GROUP` | ALLOW | ALLOW | ALLOW | **DENY** without management authority |
| `CREDIT_MANAGE` + `SALES_CROSS_GROUP` | per existing Credit read capability contract | per existing Credit read capability contract | per existing Credit read capability contract | **ALLOW** |
| Actor without any Credit capability | **DENY** | **DENY** | **DENY** | **DENY** |

Row constraints:

1. The matrix **must not** automatically grant every holder of `CREDIT_MANAGE` a new read permission. Where the canonical permission registry does not define that implication, Stage C must state the contract explicitly rather than leave it implicit.
2. ADMIN's bypass concerns **access scope only**. It does not bypass business validation, effective-date rules, SOD or mandatory audit.
3. An authorized Credit manager must still satisfy all existing mutation validation, audit and SOD requirements (AP4.1 preserves existing business validation unchanged).

#### 14.4.1 Existing registry / role implication rules, recorded separately

The following are **existing canonical facts** of the repository permission registry, recorded here for traceability and **not** introduced by this policy. They are separate from the new business data-scope rules of AP1–AP4.

```text
server/db.js PERMISSIONS registry defines, among others:
  SALES_CROSS_GROUP   跨销售组访问销售单据
  CREDIT_VIEW         查看信用策略与信用档案
  CREDIT_MANAGE       管理信用策略与信用档案

Seeded role grants (server/db.js seedDatabase):
  role-admin       : all permissions (includes all three above)
  role-sales       : CREDIT_VIEW, CREDIT_MANAGE
                     — does NOT hold SALES_CROSS_GROUP
  role-reviewer    : CREDIT_VIEW, SALES_CROSS_GROUP
                     — does NOT hold CREDIT_MANAGE
  role-accounting  : CREDIT_VIEW
  role-warehouse   : no Credit permission

The registry is FLAT: no permission-to-permission implication rule exists in
the repository. Whether CREDIT_MANAGE holders may read Credit data is an
IMLEMENTATION arrangement observed in Wave 9 (credit-profile.js / credit-anchor.js
use VIEW = ['CREDIT_VIEW','CREDIT_MANAGE'] for reads), not a registry-defined
implication. Stage C must state the read/write contract explicitly.
```

Consequence under AP4 + AP4.1 for the seeded roles: `role-sales` holds `CREDIT_MANAGE` but **not** `SALES_CROSS_GROUP`, so it is **DENY** on Credit Profile WRITE. This is the intended new policy outcome, not a contradiction of the registry.

### 14.5 Acceptance scenarios

Business-level Requirement acceptance only. **No new SC, Invariant, UAT, Race or CAP identifier is created.** These scenarios attach to the existing Wave 9 and cross-cutting Credit authorization acceptance references.

#### Positive scenarios

| # | Scenario | Expected Requirement outcome |
|---|---|---|
| A1 | ADMIN reads and manages a centrally owned customer aggregate profile | ALLOW; audit and business rules still enforced |
| A2 | Valid salesperson holding `CREDIT_VIEW` reads the customer's shared aggregate profile | ALLOW |
| A3 | Valid salesperson holding `CREDIT_VIEW` reads their own salesperson sub-limit | ALLOW — valid canonical identity + active applicable membership |
| A4 | Customer with **no** default Sales Group has one centrally managed aggregate Credit Profile | ALLOW; no synthetic owner required |
| A5 | One customer transacting through **two** Sales Groups | Exactly **one** authoritative customer aggregate profile; no split, no duplicate |
| A6 | Actor with `CREDIT_VIEW` + `SALES_CROSS_GROUP` views applicable salesperson-specific Credit Profiles across groups | ALLOW |
| A7 | Properly authorized central Credit manager (management authority + `SALES_CROSS_GROUP`, or ADMIN) manages centrally owned profiles | ALLOW; all existing validation, audit and SOD still apply |

#### Negative scenarios

| # | Scenario | Expected Requirement outcome |
|---|---|---|
| N1 | Same-group membership alone used to reveal another salesperson's sub-limit | DENY |
| N2 | Regular salesperson modifies their **own** sub-limit | DENY |
| N3 | Regular salesperson modifies the shared customer aggregate limit merely by holding `CREDIT_MANAGE` | DENY |
| N4 | `SALES_CROSS_GROUP` without any Credit capability calls a Credit API | DENY (fail closed) |
| N5 | `CREDIT_VIEW` without management authority attempts to mutate Profiles | DENY |
| N6 | Unmapped or inactive salesperson identity claims self-scope visibility | DENY |
| N7 | Expired or invalid applicable group membership claims self-scope eligibility | DENY |
| N8 | Direct Profile ID access used to bypass collection filtering | DENY — ID access must apply the same predicate |
| N9 | Historical Profile / Rating endpoint used to reveal another salesperson's restricted information | DENY |
| N10 | Unauthorized Anchor provisioning used to bypass centrally governed Credit scope | DENY |
| N11 | Ordinary salesperson holding memberships in multiple groups tries to read other salespersons' sub-limits | DENY |
| N12 | Any denied mutation above | **Zero** successful business, audit and idempotency side effects |

**Denial versus business-validation failure.** These are distinct outcomes and must be distinguishable:

```text
Permission denial  → an authorization decision. Fails closed. No business
                      mutation, no audit of a business action, no idempotency
                      record, no partial state.
Business validation→ an authorized actor performed the mutation and the
   failure             mutation failed a business rule. Transaction rolls back
                      under the existing contract. SOD/audit semantics unchanged.

A frontend-hidden control is neither of these and must not be reported as a
denial.
```

### 14.6 Compatibility with existing Credit Requirement

Explicitly preserved and **unchanged** by this policy:

```text
- §13.1 Dual-Limit Control business rules P1-P13, in full.
- SC83..SC89 and their frozen meanings.
- SC111 (Credit View / Manage / Evaluate / Special Approve).
- SC114 (VIEW != WRITE; CREATE != APPROVE; bounded special approval authority).
- Existing Sales Group / Salesperson canonical identities.
- One Customer Aggregate Profile per effective scope.
- One Salesperson Sub-Limit Profile per effective customer / salesperson scope.
- Effective-date history (§13.1 P10, P11; SC88; S19).
- Initial rating and immutable rating history (S05, SC89, SC107).
- PURE_DERIVED future Credit Exposure (SC82; §34.8 row 12; One AR truth).
- Future backend mandatory BLOCK behavior (S15; §29.22.1).
- The existing 14-table allocation across Waves 9-11.
- Existing Wave 9 migration and source files.
- §34.7 P1-P5 and the prohibition on Design introducing a new role.
- §13.4 the no-provable-attribution boundary.
```

Explicit prohibitions carried into this policy:

```text
- No new ownership table and no duplicate business ledger is authorized.
- Do NOT add a sales_group_id column to credit_profile merely to enforce access
  scope.
- Do NOT assign the customer's default Sales Group as the profile owner.
- The approved permission policy must NOT change customer credit exposure
  arithmetic or credit-limit resolution.
- LEGACY_DATA_EVIDENCE_PENDING (§5) remains unchanged and open.
- WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS remains unchanged.
```

Identifier namespaces are unchanged: SC total 114, Invariant total 20 (S01..S20), UAT total 44 (UAT-S-01..UAT-S-44), Race total 24 (R-SAL-01..R-SAL-24), Audit CAP total 36.

### 14.7 Explicit supersession of prior Sales-Group data-scope text

Prior text exists that, read alone, implies Credit Profile is governed by Sales Group data scope. It is **superseded** by this policy so that no two competing active business policies remain.

```text
SUPERSEDED (Design-stage assertion):
  solution.md §36.9.3 "Data scope: sales group filtering applied in the backend
  predicate; never delegated to the frontend (§30.15.1)."

  For Credit Profile this assertion is INCOMPLETE AND NOW SUPERSEDED as a
  business policy: it does not define which group owns a Profile, how a
  multi-group customer's aggregate Profile is scoped, or whether sub-limits
  are private. The approved policy is AP1 + AP2 + AP3 + AP4 + AP4.1.

RETAINED, NOT SUPERSEDED (still-frozen Requirement anchors):
  SC06 / UAT-S-44 group data scope for Quotation / Sales Order / Reports that
  carry sales_group_id — those records are unaffected.
  §30.15.1 backend-enforcement principle — retained and reinforced: filtering
  and fail-closed denial belong in the backend predicate, never in the
  frontend.
```

`solution.md §36.9.3` itself is **not modified by this record**. Stage C must reconcile it under a separate authorization (§14.8).

### 14.8 Stage C Design handoff

Stage C remains **NOT AUTHORIZED** by this record. The following are Design obligations created by this policy, to be discharged only under a separately authorized Stage C action:

```text
1. Reconcile solution.md §36.9.3 against AP1-AP4/AP4.1 and remove the
   unqualified sales-group-filtering assertion for Credit Profile.
2. Express the §14.4 authorization matrix as a single fail-closed backend
   predicate applied uniformly to collection, detail-by-ID, effective-dated
   version, nested/expanded and historical rating reads.
3. State explicitly whether CREDIT_MANAGE confers read capability, since the
   registry defines no implication. Do not leave it implicit.
4. Define self-scope eligibility: canonical salesperson identity resolution plus
   active applicable membership validity, with the N6/N7 denial cases.
5. Define central management write authority (AP4.1) as a distinct condition
   from CREDIT_MANAGE alone.
6. Prove Anchor provisioning (category 5, §14.3) cannot bypass Credit scope
   (N10).
7. Keep Wave 10 mandatory backend Credit Check evaluation independent of any
   human-facing visibility restriction.
8. Preserve the 14-table allocation, the existing Wave 9 migration and source
   files, and §13 Dual-Limit semantics. No new ownership table; no
   credit_profile.sales_group_id.
9. Stage C carry-forward register items #1-#15 (§10) all remain OPEN. This
   record closes none of them.
```

### 14.9 Boundary, status and what this record does NOT claim

```text
Wave 9 status        : IMPLEMENTED / ACCEPTANCE_PENDING — UNCHANGED.
Wave 9 freeze        : NOT frozen. NOT self-accepted. NOT ACCEPTANCE_PASS.
Wave 10 / Wave 11    : NOT started. NOT authorized by this record.
W7-C1 / W7-C2'       : untouched. NOT authorized by this record.
Stage C Design       : NOT authorized by this record.
Code remediation     : REQUIRES SEPARATE EXPLICIT AUTHORIZATION. The current
                       Wave 9 implementation does not satisfy AP3/AP4/AP4.1 —
                       it currently allows any CREDIT_VIEW holder to read all
                       profiles and any CREDIT_MANAGE holder to write them
                       (server/modules/credit-profile.js:9,:56,:75,:131). That
                       gap is recorded, NOT fixed here.
Test-evidence gaps   : NONE resolved by this record. Specifically the SC83-SC86
                       credit_parameters / credit_check_rules effective-version
                       and key questions (Stage C carry-forward #4, #5) and the
                       SC88 / SC89 rating-owner and overlap questions
                       (carry-forward #3, #12) remain OPEN and are NOT falsely
                       marked resolved.
Solution.md / README / AGENTS.md / CLAUDE.md / APPLY_GUIDE : untouched.
Source / migrations / tests / scripts / UI / package.json : untouched.
Database               : not opened, queried or modified.
```

**Status: `SALES CREDIT WAVE 9 — REQUIREMENT DECISION 2 CLOSURE READY FOR EXTERNAL REVIEW — AWAITING_USER_REQUIREMENT_PASS`.**

---

## Stage B Requirement Amendment — Global Credit Configuration Authority (Wave 9) (2026-10-22)

**Authorization:** explicit user approval of `W9-CREDIT_GLOBAL_CONFIG_AUTHORITY_DECISION`, under bounded authorization `WAVE9_BOUNDED_REQUIREMENT_DECISION_3_CLOSURE` (AGENTS.md §4.2).
**Scope:** SC83, SC84, SC85, SC86, SC111, SC114; UAT-S-30; S15 — the human read/write authorization of **globally effective** Credit Parameters and Credit Check Rules.
**Classification:** **AP5 is a NEW approved business Requirement.** It is **not** existing functionality and must not be described as pre-existing behavior. It is an extension of the approved Sales Credit authorization policy §14 (AP1–AP4.1).

### 15.0 Decision identity

```text
Decision id      : AP5
Title            : Centralized Global Credit Configuration Authority
Extends          : §14 AP1-AP4.1 (Sales Credit authorization policy)
Does NOT reuse   : §13.1 Dual-Limit P1-P13
                   §14 AP1-AP4.1 identifiers
                   SC / UAT / R-SAL / S01-S20 identifiers
Resolution target: REQUIREMENT_DECISION_PENDING-3
```

### 15.1 Historical raise record (preserved, not rewritten)

```text
RAISED    2026-10-22, during bounded Stage C Data-Scope Design
QUESTION  Must globally effective Credit Parameters and Credit Check Rules also
          require central management authority (ADMIN, or CREDIT_MANAGE +
          SALES_CROSS_GROUP), or is CREDIT_MANAGE alone intentionally
          sufficient for global Credit configuration?
STATUS    RAISED AND NOT ANSWERED. Recorded as an open business-security risk
          so that no stage could silently close it.
SOURCE    solution.md §36.15.12  "W9-CREDIT_GLOBAL_CONFIG_AUTHORITY_DECISION"
          log/2026-10-22.md, "Final Data-Scope Design Clarification"
WHY IT COULD NOT BE INFERRED (verified against frozen Requirement)
  - §14.3 categories 1-2 explicitly declined to decide the global-configuration
    mutation right.
  - §34.7 P1-P5 contain no central-authority or group-ownership clause, and
    forbid Design from introducing a new role.
  - SC83 / SC84 make Credit Management configurable but fix no authority rule.
  - §34.3.27 states Requirement defines capability-level intent only.
  - Both answers are commercially defensible and materially different, because
    the same role can disable the fail-closed gate that S15 depends on.
VERIFIED IMPACT AT RAISE TIME (read-only)
  server/modules/credit-policy.js:108  createCreditParameter -> allow('CREDIT_MANAGE')
  server/modules/credit-policy.js:152  createCreditRule     -> allow('CREDIT_MANAGE')
  server/modules/credit-policy.js:9    const VIEW = ['CREDIT_VIEW','CREDIT_MANAGE']
  role-sales holds CREDIT_MANAGE without SALES_CROSS_GROUP
```

This raise record is retained verbatim. It is **not** erased and **not** rewritten.

### 15.2 Resolution — `APPROVED / RESOLVED` (2026-10-22)

```text
Before : REQUIREMENT_DECISION_PENDING-3 = RAISED / NOT ANSWERED
         (open business-security risk; global configuration writable by
          CREDIT_MANAGE alone)
After  : REQUIREMENT_DECISION_PENDING-3 = APPROVED / RESOLVED
         (new business policy AP5, recorded below)
```

Approved policy: **Global Credit Parameters and Credit Check Rules shall use centralized management write authority.**

### 15.3 AP5 — Centralized Global Credit Configuration Authority

AP5 governs the human-facing read and write authorization of **globally effective** Credit Parameters and Credit Check Rules. It adds no new business semantics to Credit: the *meaning* of enabled/disabled, scope, timing, strength and rule applicability is unchanged. Only **who may read and who may write** is newly determined.

#### 15.3.1 Read contract

```text
READ  =  ADMIN   OR   CREDIT_VIEW
DENY  =  actor without CREDIT_VIEW and without ADMIN authority
DENY  =  actor with SALES_CROSS_GROUP but not CREDIT_VIEW
DENY  =  actor with CREDIT_MANAGE but not CREDIT_VIEW, unless ADMIN
```

```text
CREDIT_MANAGE    does NOT automatically grant CREDIT_VIEW.
SALES_CROSS_GROUP does NOT automatically grant CREDIT_VIEW.
READ access to global configuration does NOT grant WRITE access.

No permission-to-permission implication may be invented. The canonical
permission registry is flat and defines no implication; this Requirement does
not create one.
```

#### 15.3.2 Write contract

```text
WRITE =  ADMIN
     OR ( CREDIT_MANAGE  AND  SALES_CROSS_GROUP )     <- logical AND, not OR
otherwise DENY
```

The authorized writer must still satisfy **all** existing requirements, unchanged:

```text
effective-date constraints (assertDateRange, effective_from / effective_to)
version ownership (predecessor closing, overlap rejection)
transaction integrity
idempotency
audit (§34.7 P5)
business validation
```

Authorization must be enforced by the backend, independently of frontend visibility.

#### 15.3.3 Scope of the write restriction

The restriction applies to **every** mutation that changes the effective meaning of global Credit configuration, including but not limited to:

```text
- creating a Parameter configuration
- creating a new effective Parameter version
- creating a Credit Rule
- creating a new effective Rule version
- changing configuration scope
- changing control timing
- changing control strength
- changing the credit item or rule applicability
- disabling Credit Management (CREDIT_MANAGEMENT_ENABLED)
- downgrading BLOCK to WARNING
```

AP5 introduces **no** separate approval workflow, **no** new permission code and **no** additional business condition beyond the approved authorization policy.

### 15.4 Authorization matrix

READ and WRITE are **independent** columns. READ is not inferred from WRITE, and WRITE is not inferred from READ.

| Actor | READ | WRITE |
|---|---|---|
| ADMIN | ALLOW | ALLOW |
| `CREDIT_VIEW` only | ALLOW | DENY |
| `CREDIT_MANAGE` only | DENY | DENY |
| `CREDIT_VIEW` + `CREDIT_MANAGE` | ALLOW | DENY |
| `CREDIT_VIEW` + `SALES_CROSS_GROUP` | ALLOW | DENY |
| `CREDIT_MANAGE` + `SALES_CROSS_GROUP`, **without** `CREDIT_VIEW` | **DENY** | **ALLOW** |
| `CREDIT_VIEW` + `CREDIT_MANAGE` + `SALES_CROSS_GROUP` | ALLOW | ALLOW |
| `SALES_CROSS_GROUP` only | DENY | DENY |
| No Credit permissions | DENY | DENY |

The sixth row is deliberate and is **not** a defect. A dedicated configuration administrator may hold management plus cross-group authority without needing business read visibility; READ and WRITE remain genuinely independent capabilities, consistent with SC114 `VIEW != WRITE` and §34.7 P1. Where a role currently carries both permissions, the actual distinction must be preserved at the API boundary — it must not be collapsed into one permission.

### 15.5 Internal Credit engine exception

```text
resolveCreditParameter() and resolveCreditRule() are the internal effective
configuration resolvers consumed by mandatory backend Credit enforcement.

They are NOT human-facing GET endpoints and must NOT acquire the §15.3.1
human read predicate.

A human actor's Credit read scope must never decide which rules or parameters
apply to a mandatory backend Credit Check (S15, §29.22.1).

Reading global configuration must never weaken future Wave 10 enforcement.
```

### 15.6 Existing role consequences

Seeded role grants verified read-only from `server/db.js` (registry **unchanged** by this record):

| Role | `CREDIT_VIEW` | `CREDIT_MANAGE` | `SALES_CROSS_GROUP` | Global config READ | Global config WRITE |
|---|---|---|---|---|---|
| ADMIN | yes | yes | yes (via `all`) | **ALLOW** | **ALLOW** |
| SALES | yes | yes | **no** | **ALLOW** | **DENY** |
| REVIEWER | yes | no | yes (`db.js:1761`) | **ALLOW** | **DENY** |
| ACCOUNTING | yes | no | no | **ALLOW** | **DENY** |
| WAREHOUSE | no | no | no | DENY | DENY |

Consequences, recorded as intended outcomes rather than regressions:

1. `role-sales` **retains** authorized global Credit Parameter / Rule **READ** access.
2. `role-sales` **loses** global Credit Parameter / Rule **WRITE** access under AP5.
3. That loss is **intentional business policy, not a regression**, and must not be bypassed by any alternative endpoint, payload variant or role workaround.
4. A privileged actor holding centrally authorized management permissions can administer the configuration. Under the seeded roles this is currently ADMIN; granting `SALES_CROSS_GROUP` to an existing role is a **separate, explicitly authorized operational decision**, not something this Requirement performs.

Explicit prohibitions for this stage:

```text
Do NOT alter seeded role permissions during Requirement closure.
Do NOT silently grant SALES_CROSS_GROUP to ordinary sales users to preserve
     the previous behavior.
Do NOT create a replacement role.
Do NOT create a new permission.
```

`role-reviewer` and `role-accounting` remain subject to their actual permission sets, as recorded in the table.

### 15.7 Mandatory backend security semantics

The following are Requirement-level guarantees for global Credit configuration:

```text
1.  Backend authorization is mandatory on EVERY global Credit configuration
    mutation.
2.  Frontend visibility is NOT an authorization boundary (S15, SC114).
3.  Unauthorized mutation attempts produce an explicit permission denial.
4.  Unauthorized attempts do NOT create Parameter versions.
5.  Unauthorized attempts do NOT create Rule versions.
6.  Unauthorized attempts do NOT close or replace previous effective versions.
7.  Unauthorized attempts do NOT create successful business audit entries.
8.  Unauthorized attempts do NOT consume or create successful idempotency
    records.
9.  Unauthorized attempts produce NO partial business state.
10. Internal Credit enforcement does NOT use the current human actor's read
    scope to decide which rules apply (§15.5).
```

Points 4-9 together define the **no-side-effect authorization invariant**: a denied mutation must be a complete no-op across business rows, version closure, audit and idempotency.

AP5 introduces **no** new Credit Exposure ledger and does **not** alter the approved Dual-Limit calculation.

### 15.8 Acceptance scenarios

Business-level Requirement acceptance. **No new SC, Invariant, UAT, Race or CAP identifier is created.** These scenarios attach to the existing Credit authorization and **UAT-S-30** traceability.

#### Positive scenarios

| # | Scenario | Expected outcome |
|---|---|---|
| P1 | ADMIN reads and creates Parameter versions | ALLOW |
| P2 | ADMIN reads and creates Rule versions | ALLOW |
| P3 | `CREDIT_VIEW`-only actor reads global configuration | ALLOW |
| P4 | `CREDIT_MANAGE` + `SALES_CROSS_GROUP` actor creates a valid effective-dated Parameter | ALLOW |
| P5 | `CREDIT_MANAGE` + `SALES_CROSS_GROUP` actor creates a valid effective-dated Rule | ALLOW |
| P6 | Authorized central manager modifies the effective enabled/disabled configuration | ALLOW |
| P7 | Authorized central manager creates a WARNING rule **or** a BLOCK rule | ALLOW |
| P8 | Internal Credit resolution still consumes authoritative effective configuration regardless of a human actor's Credit read scope | ALLOW; engine unaffected by §15.3.1 |

#### Negative scenarios

| # | Scenario | Expected outcome |
|---|---|---|
| N1 | Ordinary `role-sales` disables Credit Management | DENY |
| N2 | Ordinary `role-sales` weakens a BLOCK rule | DENY |
| N3 | `CREDIT_MANAGE` without `SALES_CROSS_GROUP` writes | DENY |
| N4 | `SALES_CROSS_GROUP` without `CREDIT_MANAGE` writes | DENY |
| N5 | `CREDIT_VIEW`-only actor writes | DENY |
| N6 | `CREDIT_MANAGE`-only actor calls a human GET endpoint without `CREDIT_VIEW` | DENY |
| N7 | Unauthorized POST creates a new effective version | DENY; no version created |
| N8 | Unauthorized POST closes a predecessor version | DENY; predecessor untouched |
| N9 | Unauthorized POST | DENY; zero successful business audit entries and zero successful idempotency records |
| N10 | Frontend exposure used to bypass backend authorization | DENY; frontend is not a boundary |

Every scenario must be **independently testable** in the subsequent Implementation stage. Each is stated so that a single focused assertion can prove it. Permission denial must remain distinguishable from ordinary business-validation failure.

### 15.9 Compatibility and non-goals

Preserved unchanged:

```text
- §13.1 Dual-Limit P1-P13
- §14 AP1-AP4.1 (central ownership, shared aggregate, self-only sub-limit,
  credit permission x cross-group, central Profile write authority)
- SC83-SC89 and their frozen meanings
- SC111 (Credit View / Manage / Evaluate / Special Approve)
- SC114 (VIEW != WRITE; CREATE != APPROVE; bounded special approval)
- UAT-S-29 and UAT-S-30
- S15 mandatory backend fail-closed behavior
- effective-dated Parameter and Rule history
- Credit Policy Snapshot immutability
- the 14-table Waves 9-11 allocation
- Wave 9 physical migration and source files
- existing Wave 10 / Wave 11 Design
- W7-C1 / W7-C2' remediation boundaries
- LEGACY_DATA_EVIDENCE_PENDING
- WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS
```

Non-goals — AP5 governs **only** global Credit Parameters and Credit Check Rules:

```text
It does NOT automatically change unrelated Sales parameters, pricing rules,
Finance policies, customer master data or generic system configuration.

No new physical schema is authorized.
No new permission is authorized.
No new workflow is authorized.
No global Credit business semantics change beyond human read/write
authorization.
```

Identifier namespaces remain unchanged: SC total 114, Invariant total 20 (S01..S20), UAT total 44 (UAT-S-01..UAT-S-44), Race total 24 (R-SAL-01..R-SAL-24), Audit CAP total 36.

### 15.10 Explicit supersession

```text
SUPERSEDED:
  document.md §14.3 categories 1 and 2 stated that global Credit Parameters and
  Credit Check Rules are governed by the EXISTING FROZEN CONTRACT and that
  §14 "creates no new mutation right" over them.

  Under that position, combined with the implemented
  allow(actor,'CREDIT_MANAGE') at credit-policy.js:108 and :152, global
  configuration was writable by CREDIT_MANAGE alone. AP5 REMOVES that mutation
  right for actors lacking central authority.

  §14.3 is therefore superseded in part for categories 1 and 2 ONLY, as to the
  human WRITE authorization of global Credit configuration. It is NOT superseded
  for any other purpose, and specifically NOT superseded as to:
    - Credit central ownership (AP1)
    - shared Customer Aggregate (AP2)
    - self-only sub-limit visibility (AP3)
    - credit permission x cross-group enforcement (AP4)
    - central Profile management write authority (AP4.1)
    - the statement that central configuration is not Sales Group-owned
    - the frozen contract that still governs Parameters and Rules business
      SEMANTICS (SC83-SC86)

RETAINED VERBATIM:
  §14.0, §14.1, §14.2 (AP1-AP4.1), §14.4, §14.4.1, §14.5, §14.6, §14.7, §14.8,
  §14.9 and §13 unchanged.

  §14.4.1's registry facts (the flat registry and the seeded role grants) remain
  accurate and unchanged; only their WRITE consequence for global
  configuration is extended by AP5.
```

### 15.11 Stage C Design handoff

Stage C is **NOT AUTHORIZED** by this record. Obligations created for a separately authorized Stage C reconciliation:

```text
1. Reconcile solution.md §36.15.7 rows 2 and 4, which currently specify
   CREDIT_MANAGE alone for Parameter and Rule writes.
2. Reconcile solution.md §36.15.12, which recorded this risk as OPEN; it must
   be updated to record the approved resolution without erasing the raise.
3. Express the §15.4 matrix as one fail-closed backend predicate, with READ and
   WRITE resolved independently.
4. Remove the CREDIT_MANAGE-as-read-fallback in the Parameter and Rule READERS
   (credit-policy.js:9, :98, :142), since §15.3.1 forbids the implication.
5. Express the §15.7 no-side-effect invariant in terms of the existing
   transaction, audit and idempotency structure.
6. Preserve §15.5: the internal resolvers stay actor-free and unfiltered.
7. Preserve the existing Wave 9 migration, source files, effective-date and
   overlap handling, and the 14-table allocation.
8. Stage C carry-forward register items #1-#15 (§10) all remain OPEN. This
   record closes none of them.
```

### 15.12 Boundary and status

```text
Wave 9 status        : IMPLEMENTED / ACCEPTANCE_PENDING — UNCHANGED.
Wave 9 freeze        : NOT frozen. NOT self-accepted. NOT ACCEPTANCE_PASS.
Stage C Design       : NOT authorized by this record.
Implementation       : AP5 is NOT implemented by this record. Any code change
                       requires separate explicit authorization.
Wave 10 / Wave 11    : NOT started. NOT authorized.
W7-C1 / W7-C2'       : untouched. NOT authorized.
solution.md / README / AGENTS.md / CLAUDE.md / APPLY_GUIDE : untouched.
Source / migrations / tests / scripts / UI / package.json  : untouched.
Database               : not opened, queried or modified.
Test / build           : not executed.
Test-evidence gaps     : NONE resolved. Stage C carry-forward #1-#15 remain OPEN.
```

**Status: `SALES CREDIT WAVE 9 — REQUIREMENT DECISION 3 CLOSURE READY FOR EXTERNAL REVIEW — AWAITING_USER_REQUIREMENT_PASS`.**

---
