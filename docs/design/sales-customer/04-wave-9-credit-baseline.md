# Sales & Customer Credit — Wave 9 冻结技术基线

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/design/sales-customer/README.md`
> 来源：`solution.md` §36、§36.16（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 36. Sales & Customer Credit — Stage C Combined Design Reconciliation (Waves 9–11, 2026-10-22)

### 36.0 Authorization, status and how to read this section

Authorization: `STAGE_B_REQUIREMENT_PASS` + `STAGE_C_COMBINED_DESIGN_AUTHORIZED`. Design only. This section does **not** authorize implementation, migration execution, database mutation, Git commit, push, tag, merge, deployment or release.

This is the **single active Design layer** for Sales Credit Waves 9–11. Where it disagrees with §29 or §30, **this section governs**. Frozen §29 / §30 text is retained verbatim as historical evidence and is not rewritten; the map below states exactly which clause is superseded so that an implementation author never has to guess.

Governing Requirement: `document.md` Stage B closure §13 (Dual-Limit Control P1–P13, binding), §9.1 (`REQUIREMENT_DECISION_PENDING-1` resolved), §13.4 (attribution boundary), §13.6 (Stage C obligations).

Preserved unchanged: 14 planned physical tables · 26 SC (Wave 9 = SC83–SC89, Wave 10 = SC82 + SC90–SC98, Wave 11 = SC99–SC107) · SC total 114 · invariants 20 · UAT 44 · races 24 · Audit CAP 36. No SC / UAT / Race identifier is added, deleted or renumbered.

### 36.1 Supersession map — frozen clause → canonical replacement

| # | Frozen clause | Location | Defect | Canonical replacement |
|---|---|---|---|---|
| 1 | `credit_profile PRIMARY KEY (customer_id, salesperson_id, credit_object_type, credit_object_id, effective_from)` | §29.22, §30.8 | MySQL error 1171 (nullable PK column); SQLite silently enforces nothing (NULLs distinct) | §36.2.2 — `id TEXT PRIMARY KEY` + `UNIQUE (anchor_id, effective_from)` |
| 2 | `credit_profile` "FK: implicit logical reference to credit_control_anchor.id" | §29.22 | Not a physical FK; inconsistent with sibling tables | §36.2.2 — physical `anchor_id TEXT NOT NULL REFERENCES credit_lock_anchors(id)` |
| 3 | `credit_parameters` `code (UNIQUE)` **and** `PRIMARY KEY (code, effective_from)` | §29.21 | Column UNIQUE defeats effective versioning (one version per code, ever) | §36.2.3 — `UNIQUE (code, effective_from)` replaces the column-level UNIQUE |
| 4 | `credit_check_rules` declares no key at all | §29.21 | `credit_profile.rule_id` FK has no candidate key | §36.2.4 — explicit `id TEXT PRIMARY KEY` + `UNIQUE (rule_code, effective_from)` |
| 5 | `credit_profile_ratings` A-50 descriptor "R-SAL-24 lockable anchor row" | A-registry | Contradicts §29.21's DECISION-EVIDENCE-not-lock | §36.2.5 — `credit_policy_snapshots` is decision evidence only; `credit_lock_anchors` is the only lock identity |
| 6 | `credit_check_result` (singular) vs `credit_check_results` (plural) | §29.25.1, §29.26 vs A-registry, §30.2, §30.8, repo harness | Two active physical names | §36.2.7 — **`credit_check_results`** is canonical; `credit_check_result` is retained only as a code-type name |
| 7 | `credit_check_result.special_approval_id (FK)` + `credit_special_approval.source_credit_check_result_id (FK)` | §29.25.1, §29.26 | **Circular FK pair** | §36.2.8 — `special_approval_id` removed from `credit_check_results`; the approval → check-result direction alone is canonical |
| 8 | `snapshot_fingerprint (UNIQUE)` global, composed without credit-object identity | §29.21 | Two credit objects can collide and reuse each other's decision evidence | §36.2.5 — `UNIQUE (credit_lock_anchor_id, business_date, snapshot_fingerprint)`; object identity carried by an explicit column, not by the hash |
| 9 | Anchor provisioning: "SAME DB transaction" **vs** "first-use creation … is forbidden" | §29.21.1 vs §29.21.3–29.21.4 | Self-contradictory; not implementable | §36.4 — integrated provisioning protocol with an unconditional re-read-and-lock |
| 10 | R-SAL-24 first executable MySQL test at Wave 9 | §30.7, §30.12 | R-SAL-24 needs a real Credit Check (Wave 10) | §36.8 — Wave 9 = infrastructure-level proof only; full R-SAL-24 in Wave 10 |
| 11 | Rating stored inline on `credit_profile` **and** in `credit_profile_ratings` | §29.22 | Two competing representations of rating state | §36.7 — `credit_profile_ratings` is the sole canonical owner; inline columns are a derived read projection |
| 12 | Single `credit_check_results` row per check | §29.25.1 | Cannot express P3 (both controls must pass) | §36.2.7 — one row **per applicable scope**, grouped by `check_group_id` |
| 13 | §30.17 Wave 9 "UAT-S-29 + S-30"; deps "Wave 1" | §30.17 | No `S30` invariant exists; DAG mismatch | §36.9.4 — UAT-S-29 + UAT-S-30; Wave 9 depends on Wave 4 |
| 14 | §29.21.1 / §30.8 legacy `credit_profile` bootstrap | §29.21.1, §30.8 | No such table exists in this repository | §36.5.6 — bootstrap stays **conditional** on `LEGACY_DATA_EVIDENCE_PENDING` |
| 15 | `sales_lock_anchor` reference | §29.21 | Dangling; no such table | §36.2.1 — `credit_lock_anchors` is the only anchor table |

### 36.2 C1 — Canonical 14-table physical schema contract

Repo conventions applied throughout: `id TEXT PRIMARY KEY`; `TEXT NOT NULL` explicit; `BIGINT` for cents; `INTEGER` for flags/counts; `REAL` for scores; no `AUTOINCREMENT` anywhere in the Sales domain (verified: zero occurrences across all 8 existing Sales migrations); logical identity expressed as a **named non-null composite UNIQUE**, never as a nullable composite UNIQUE.

#### 36.2.1 `credit_lock_anchors` (A-62) — Wave 9

```sql
CREATE TABLE credit_lock_anchors (
  id                TEXT PRIMARY KEY,
  anchor_key        TEXT NOT NULL,
  anchor_type       TEXT NOT NULL CHECK (anchor_type IN ('CREDIT_OBJECT','POLICY_SCOPE')),
  customer_id       TEXT NULL REFERENCES customers(id),
  salesperson_id    TEXT NULL REFERENCES salesperson_profiles(id),
  credit_object_type TEXT NULL,
  credit_object_id   TEXT NULL,
  policy_scope_type  TEXT NULL,
  policy_scope_id    TEXT NULL,
  created_at        TEXT NOT NULL,
  CONSTRAINT uq_credit_lock_anchors_anchor_key UNIQUE (anchor_key),
  CONSTRAINT ck_credit_lock_anchors_shape CHECK (
       (anchor_type = 'CREDIT_OBJECT'
        AND customer_id IS NOT NULL
        AND credit_object_type IS NOT NULL
        AND credit_object_id IS NOT NULL
        AND policy_scope_type IS NULL
        AND policy_scope_id IS NULL)
    OR (anchor_type = 'POLICY_SCOPE'
        AND policy_scope_type IS NOT NULL
        AND policy_scope_id IS NOT NULL
        AND customer_id IS NULL
        AND salesperson_id IS NULL
        AND credit_object_type IS NULL
        AND credit_object_id IS NULL)
  )
);
```

The two mutually exclusive shape alternatives are therefore enforced in the database itself, not only in application code.

Dual-Limit requires **two distinct CREDIT_OBJECT anchors** per (customer, credit object) — one aggregate, one per salesperson sub-limit. They live in this single table and are distinguished only by `anchor_key`:

```text
CUSTOMER aggregate :
  CREDIT_OBJECT|<object_type>|<object_id>|CUSTOMER|<customer_id>|SCOPE:AGGREGATE

SALESPERSON sub-limit :
  CREDIT_OBJECT|<object_type>|<object_id>|CUSTOMER|<customer_id>|SCOPE:SALESPERSON|<salesperson_id>

POLICY_SCOPE :
  POLICY_SCOPE|<scope_type>|<scope_id or GLOBAL>
```

`anchor_key` is `NOT NULL UNIQUE`, so uniqueness holds identically on both engines. Index: `UNIQUE (anchor_key)` is itself the lookup index; add `INDEX ix_credit_lock_anchors_lookup (anchor_type, customer_id, credit_object_type, credit_object_id)` for scope enumeration.

#### 36.2.2 `credit_profile` (A-51) — Wave 9 — **supersedes §29.22 PK**

```sql
CREATE TABLE credit_profile (
  id                     TEXT PRIMARY KEY,
  anchor_id              TEXT NOT NULL REFERENCES credit_lock_anchors(id),
  customer_id            TEXT NOT NULL REFERENCES customers(id),
  salesperson_scope_key  TEXT NOT NULL,
  salesperson_id         TEXT NULL REFERENCES salesperson_profiles(id),
  credit_object_type     TEXT NOT NULL,
  credit_object_id       TEXT NOT NULL,
  credit_limit_cents     BIGINT NULL,
  initial_state          TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  rating_grade           TEXT NULL,
  rating_effective_from  TEXT NULL,
  rating_effective_to    TEXT NULL,
  overdue_day_policy     TEXT NULL,
  rule_id                TEXT NULL REFERENCES credit_check_rules(id),
  effective_from         TEXT NOT NULL,
  effective_to           TEXT NULL,
  created_at             TEXT NOT NULL,
  created_by             TEXT NULL REFERENCES users(id),
  CONSTRAINT uq_credit_profile_scope_version UNIQUE (anchor_id, effective_from),
  CONSTRAINT ck_credit_profile_scope_shape CHECK (
       (salesperson_scope_key = '*'  AND salesperson_id IS NULL)
    OR (salesperson_scope_key <> '*' AND salesperson_id IS NOT NULL
        AND salesperson_scope_key = salesperson_id)
  ),
  CONSTRAINT ck_credit_profile_interval CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
```

**Why this resolves the P0 defect.** `id` becomes a real `TEXT PRIMARY KEY`, so it is a valid candidate key for every referencing FK. `salesperson_scope_key` is `NOT NULL` — the normalized non-null scope identity (`'*'` = aggregate / all salespersons). The version-uniqueness constraint is on `anchor_id`, which is `NOT NULL`, so it is **not** a nullable composite UNIQUE and behaves identically on SQLite and MySQL. This mirrors the already-frozen `anchor_key` decision in §29.21.

**Bidirectional scope invariant (both directions).** Exactly one of two valid states:

```text
AGGREGATE  : salesperson_scope_key = '*'  AND salesperson_id IS NULL
SUB-LIMIT  : salesperson_scope_key = <salesperson_profiles.id>
             AND salesperson_id IS NOT NULL AND salesperson_scope_key = salesperson_id
```

The CHECK enforces it in the database. The application additionally enforces it, because the CHECK alone cannot prove that a non-`'*'` `salesperson_scope_key` really exists in `salesperson_profiles`; the `salesperson_id` FK does that, and the equality CHECK binds the two columns. `salesperson_scope_key` is therefore **never independently authoritative** — it exists only to make scope uniqueness non-null.

**Effective-interval authority (P11).** `UNIQUE (anchor_id, effective_from)` forbids two versions of the same scope starting on the same date. It does **not** by itself forbid overlapping intervals with different starts, so the canonical writer enforces, under the scope anchor lock (§36.3.3):

```text
On insert of a new effective version for one scope:
  1. acquire the scope anchor FOR UPDATE (§36.3 lock order)
  2. close the predecessor: set its effective_to = new.effective_from - 1 day
     when predecessor.effective_to IS NULL OR predecessor.effective_to >= new.effective_from
  3. reject the write when any OTHER interval overlaps [new.effective_from, new.effective_to]
  4. reject when effective_from <= effective_to is violated
Any failure -> full rollback; no partial version is ever authoritative.
```

So two records for the same logical scope can never simultaneously be authoritative. Deterministic active resolution at a business date `d`:

```text
the unique row for (anchor_id) where effective_from <= d
  AND (effective_to IS NULL OR effective_to >= d)
zero rows  -> profile missing  -> §29.22.1 fail-closed (S15)
more than 1 -> invariant breach -> fail-closed, raise, never silently pick one
```

**Concurrent profile insert/update.** All writers acquire the scope anchor FOR UPDATE before touching `credit_profile`, so concurrent writers to one scope serialize. Writers to different scopes never block each other. A duplicate `(anchor_id, effective_from)` raises the engine UNIQUE violation and is mapped to HTTP 409, not to a silent overwrite. Interval-overlap detection failure rolls the whole transaction back, leaving the previously effective version untouched.

**Rating columns are derived, not authoritative** — see §36.7.

#### 36.2.3 `credit_parameters` (A-48) — Wave 9 — **supersedes §29.21 UNIQUE/PK conflict**

```sql
CREATE TABLE credit_parameters (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL,
  value_text       TEXT NULL,
  value_int        BIGINT NULL,
  value_bool       INTEGER NULL,
  value_date       TEXT NULL,
  effective_from   TEXT NOT NULL,
  effective_to     TEXT NULL,
  status           TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
  created_at       TEXT NOT NULL,
  created_by       TEXT NULL REFERENCES users(id),
  superseded_by_id TEXT NULL REFERENCES credit_parameters(id),
  CONSTRAINT uq_credit_parameters_version UNIQUE (code, effective_from),
  CONSTRAINT ck_credit_parameters_interval CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
```

The column-level `UNIQUE (code)` is **removed**; it permitted exactly one version per code for the lifetime of the table, which is incompatible with the effective-dated model the same clause declares. `UNIQUE (code, effective_from)` preserves multiple effective versions of one parameter while forbidding two versions starting on the same day.

Deterministic effective lookup at business date `d`:

```text
SELECT ... WHERE code = ? AND effective_from <= d
  AND (effective_to IS NULL OR effective_to >= d)
  AND status = 'ACTIVE'
must return exactly 1 row.
0 rows -> policy value absent -> fail-closed per the owning capability
>1 row -> ambiguous effective interval -> fail-closed, raise
```

Interval overlap for a given `code` is enforced by the canonical writer under a policy-scope anchor lock, identically to §36.2.2. Index: `INDEX ix_credit_parameters_code_date (code, effective_from)`.

#### 36.2.4 `credit_check_rules` (A-49) — Wave 9 — **supersedes §29.21 missing key**

```sql
CREATE TABLE credit_check_rules (
  id                  TEXT PRIMARY KEY,
  rule_code           TEXT NOT NULL,
  business_stage      TEXT NOT NULL CHECK (business_stage IN ('SO_SUBMIT','SO_APPROVE','SALES_DELIVERY_CONFIRM')),
  scenario            TEXT NOT NULL CHECK (scenario IN ('STANDARD','OVERRIDE_REQUEST','WARNING_ONLY','BLOCK')),
  check_timing        TEXT NOT NULL CHECK (check_timing IN ('BEFORE_WRITE','AFTER_WRITE_DEFERRED')),
  control_strength    TEXT NOT NULL CHECK (control_strength IN ('WARNING','BLOCK')),
  credit_item         TEXT NOT NULL,
  recognition_mode    TEXT NULL,
  effective_from      TEXT NOT NULL,
  effective_to        TEXT NULL,
  status              TEXT NOT NULL,
  result_payload_json TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  created_by          TEXT NULL REFERENCES users(id),
  CONSTRAINT uq_credit_check_rules_version UNIQUE (rule_code, effective_from),
  CONSTRAINT ck_credit_check_rules_interval CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
```

`id` is now an explicit primary key, so `credit_profile.rule_id` has a valid candidate key.

#### 36.2.5 `credit_policy_snapshots` (A-50) — Wave 9 — **supersedes §29.21 fingerprint uniqueness**

```sql
CREATE TABLE credit_policy_snapshots (
  id                            TEXT PRIMARY KEY,
  credit_lock_anchor_id         TEXT NOT NULL REFERENCES credit_lock_anchors(id),
  scope_type                    TEXT NOT NULL CHECK (scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
  credit_profile_id             TEXT NULL REFERENCES credit_profile(id),
  snapshot_fingerprint          TEXT NOT NULL,
  business_date                 TEXT NOT NULL,
  parameter_set_hash            TEXT NOT NULL,
  rule_set_hash                 TEXT NOT NULL,
  profile_effective_state_hash  TEXT NOT NULL,
  captured_at                   TEXT NOT NULL,
  captured_by                   TEXT NULL REFERENCES users(id),
  notes_json                    TEXT NULL,
  CONSTRAINT uq_credit_policy_snapshots_identity
    UNIQUE (credit_lock_anchor_id, business_date, snapshot_fingerprint)
);
```

This is **decision evidence**, append-only, never a lock target. `credit_lock_anchors` is the only lock identity in the Credit model.

**Fingerprint definition.** `snapshot_fingerprint = 'CSP1:' || sha256(canonical)` where `canonical` is a length-prefixed, order-stable serialization of exactly three members in fixed order:

```text
parameter_set_hash           (32-byte lowercase hex, from the resolved effective parameters)
rule_set_hash                (32-byte lowercase hex, from the resolved effective rules)
profile_effective_state_hash (32-byte lowercase hex, from the resolved effective profile state)
```

Every member is already a digest, so the concatenation is unambiguous and no delimiter-injection is possible. The credit-object identity is deliberately **not** inside the digest: it is carried by the `credit_lock_anchor_id` and `business_date` columns of the UNIQUE constraint. Consequences:

- two different credit objects may legitimately carry the same fingerprint value without collision, because their `credit_lock_anchor_id` differs — one object's evidence can never be silently reused as another's;
- repeated checks of the same scope, business date and effective state produce the same fingerprint and therefore **reuse the existing immutable row**, which is the intended behaviour;
- a policy/profile mutation changes a digest member, changes the fingerprint, and therefore creates a new row rather than mutating an existing one.

Append-only is enforced by never issuing `UPDATE` against this table; the only writer path is insert-or-select-by-unique-key.

#### 36.2.6 `credit_profile_ratings` (A-52) — Wave 9 — **amended 2026-10-22 (see §36.11.2)**

```sql
CREATE TABLE credit_profile_ratings (
  id                   TEXT PRIMARY KEY,
  credit_profile_id    TEXT NOT NULL REFERENCES credit_profile(id),
  rating_source_type   TEXT NOT NULL CHECK (rating_source_type IN ('INITIAL_ASSIGNED','EVALUATED')),
  rating_source_key    TEXT NOT NULL,
  evaluation_result_id TEXT NULL,
  rating_grade         TEXT NOT NULL,
  applied_at           TEXT NOT NULL,
  applied_by           TEXT NOT NULL REFERENCES users(id),
  superseded_at        TEXT NULL,
  CONSTRAINT uq_credit_profile_ratings_application UNIQUE (credit_profile_id, rating_source_key),
  CONSTRAINT ck_credit_profile_ratings_provenance CHECK (
       (rating_source_type = 'INITIAL_ASSIGNED' AND rating_source_key = 'INITIAL_ASSIGNED'
        AND evaluation_result_id IS NULL)
    OR (rating_source_type = 'EVALUATED' AND evaluation_result_id IS NOT NULL
        AND rating_source_key = evaluation_result_id)
  ),
  CONSTRAINT ck_credit_profile_ratings_no_self_supersede CHECK (superseded_at IS NULL OR superseded_at >= applied_at)
);
```

**Why `evaluation_result_id` is nullable.** SC89 ("Credit Profile Initial State + Rating + Applicable Rule + Status") is a **Wave 9** capability and requires a rating to exist on a newly created profile. `credit_evaluation_result` does not exist until Wave 11. The previous revision declared `evaluation_result_id NOT NULL`, which made **any** rating row uninsertable during Wave 9 and therefore made SC89 unimplementable in its own wave — while §36.7.1 simultaneously declared `credit_profile_ratings` the sole canonical rating writer, leaving the inline projection with no writer at all until Wave 11.

**Rating provenance model.** Two authoritative sources are distinguished, never merged:

```text
INITIAL_ASSIGNED  Wave 9, SC89
                  Provenance = the authorized profile-creation / profile-version
                  actor. evaluation_result_id IS NULL.
                  rating_source_key = the literal 'INITIAL_ASSIGNED'.
                  At most one per credit_profile_id, enforced by
                  UNIQUE (credit_profile_id, rating_source_key).

EVALUATED         Wave 11, SC107
                  Provenance = a real credit_evaluation_result row.
                  rating_source_key = evaluation_result_id (CHECK-enforced
                  equality, so the key can never drift from the FK).
```

`UNIQUE (credit_profile_id, rating_source_key)` is non-null on both members, so it enforces exactly one INITIAL_ASSIGNED row per profile version **and** exactly one application per evaluation result, with no NULL-distinct hazard on either engine and no partial/filtered index (which MySQL 8 does not support).

**No synthetic evaluation result is created.** An initial rating is represented by `evaluation_result_id IS NULL`, not by fabricating a Wave 11 row.

**Version identity preserved.** `credit_profile_id` references the **effective Profile version** that received the rating, never the stable anchor — the structural guarantee for `document.md` §6 (B-4). A later profile version receives its own rating rows; history is never collapsed onto anchor identity.

**Wave 11 FK addition.** Wave 11 adds `FOREIGN KEY (evaluation_result_id) REFERENCES credit_evaluation_result(id)`. Because the column is nullable, existing `INITIAL_ASSIGNED` rows with `NULL` satisfy that FK on both engines — MySQL and SQLite both permit a NULL foreign key value. The deferred-FK mechanics are otherwise exactly those of §36.5.2, and the §36.2.15 matrix entry for this column is updated accordingly.

**Migration idempotency.** The nullable column requires no data rewrite at Wave 11, so the Wave 11 constraint addition is a pure metadata operation that is safe to replay.

#### 36.2.7 `credit_check_results` (A-54, **plural canonical**) — Wave 10 — **supersedes §29.25.1**

```sql
CREATE TABLE credit_check_results (
  id                              TEXT PRIMARY KEY,
  check_group_id                  TEXT NOT NULL,
  scope_type                      TEXT NOT NULL CHECK (scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
  credit_lock_anchor_id           TEXT NOT NULL REFERENCES credit_lock_anchors(id),
  credit_profile_id               TEXT NULL REFERENCES credit_profile(id),
  credit_policy_snapshot_id       TEXT NOT NULL REFERENCES credit_policy_snapshots(id),
  policy_snapshot_fingerprint     TEXT NOT NULL,
  profile_effective_state_hash    TEXT NOT NULL,
  sales_order_id                  TEXT NULL REFERENCES sales_orders(id),
  sales_delivery_id               TEXT NULL REFERENCES sales_deliveries(id),
  stage                           TEXT NOT NULL,
  business_date                   TEXT NOT NULL,
  proposed_delta_cents            BIGINT NOT NULL,
  recognition_mode                TEXT NOT NULL,
  decision                        TEXT NOT NULL CHECK (decision IN ('PASS','WARNING','BLOCK','SPECIAL_APPROVAL_REQUIRED')),
  reason_codes_json               TEXT NOT NULL,
  component_breakdown_json        TEXT NOT NULL,
  eligible_prepayment_source_identity TEXT NULL,
  evaluated_at                    TEXT NOT NULL,
  evaluated_by                    TEXT NULL REFERENCES users(id),
  CONSTRAINT uq_credit_check_results_group_scope UNIQUE (check_group_id, scope_type),
  CONSTRAINT ck_credit_check_results_source CHECK (sales_order_id IS NOT NULL OR sales_delivery_id IS NOT NULL)
);
```

**One logical Credit Check produces one row per applicable scope.** `check_group_id` binds the scope rows into a single atomic business decision (P12); `UNIQUE (check_group_id, scope_type)` is non-null on both members, so it is safe on both engines. This is what makes P3 expressible: the aggregate control and the sub-limit control are separately recorded, separately decided, and separately approvable.

`special_approval_id` is deliberately **absent** — see §36.1 item 7. The relationship is navigable from `credit_special_approval.source_credit_check_result_id`, which eliminates the circular FK pair and therefore removes a real MySQL `ADD CONSTRAINT` ordering hazard.

#### 36.2.8 `credit_special_approval` (A-53) — Wave 10

```sql
CREATE TABLE credit_special_approval (
  id                            TEXT PRIMARY KEY,
  source_credit_check_result_id TEXT NOT NULL,
  source_check_group_id         TEXT NOT NULL,
  scope_type                    TEXT NOT NULL CHECK (scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
  source_credit_policy_snapshot_id TEXT NOT NULL REFERENCES credit_policy_snapshots(id),
  source_policy_snapshot_fingerprint  TEXT NOT NULL,
  source_profile_effective_state_hash TEXT NOT NULL,
  source_sales_order_id         TEXT NULL REFERENCES sales_orders(id),
  reason                        TEXT NOT NULL,
  requested_override_cents      BIGINT NOT NULL,
  requested_expiry_business_date TEXT NOT NULL,
  requested_ceiling_cents       BIGINT NOT NULL,
  authority_ceiling_cents       BIGINT NOT NULL,
  decision                      TEXT NOT NULL CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
  approved_override_cents       BIGINT NULL,
  approved_ceiling_cents        BIGINT NULL,
  approved_expiry_business_date TEXT NULL,
  scope_mode                    TEXT NOT NULL CHECK (scope_mode IN ('ONE_TIME','TIME_BOUNDED','OBJECT_BOUNDED')),
  approver_id                   TEXT NULL REFERENCES users(id),
  decided_at                    TEXT NULL,
  audit_id                      TEXT NULL,
  CONSTRAINT uq_credit_special_approval_source UNIQUE (source_credit_check_result_id),
  CONSTRAINT ck_credit_special_approval_decided CHECK (
    (decision = 'PENDING'  AND decided_at IS NULL     AND approver_id IS NULL)
    OR (decision <> 'PENDING' AND decided_at IS NOT NULL AND approver_id IS NOT NULL)
  )
);
CONSTRAINT fk_credit_special_approval_check
  FOREIGN KEY (source_credit_check_result_id) REFERENCES credit_check_results(id);
```

`UNIQUE (source_credit_check_result_id)` gives the structural guarantee for P13: because each logical check emits one row per scope, and each approval binds to exactly one of those rows, **an approval granted against one scope can never release another applicable mandatory control**. This is enforced by the schema, not by convention.

#### 36.2.9 `credit_evaluation_indicator` (A-55) — Wave 11

```sql
CREATE TABLE credit_evaluation_indicator (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('QUALITATIVE','QUANTITATIVE')),
  description TEXT NOT NULL,
  max_score   REAL NOT NULL,
  CONSTRAINT uq_credit_evaluation_indicator_code UNIQUE (code),
  CONSTRAINT ck_credit_evaluation_indicator_score CHECK (max_score > 0)
);
```

#### 36.2.10 `credit_evaluation_scheme` (A-56) — Wave 11

```sql
CREATE TABLE credit_evaluation_scheme (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  rating_grades_json TEXT NOT NULL,
  CONSTRAINT uq_credit_evaluation_scheme_code UNIQUE (code)
);
```

#### 36.2.11 `credit_evaluation_model` (A-57) — Wave 11

```sql
CREATE TABLE credit_evaluation_model (
  id                          TEXT PRIMARY KEY,
  scheme_id                   TEXT NOT NULL REFERENCES credit_evaluation_scheme(id),
  name                        TEXT NOT NULL,
  applicable_from             TEXT NOT NULL,
  applicable_to               TEXT NULL,
  indicator_weights_json      TEXT NOT NULL,
  scoring_sheet_template_json TEXT NOT NULL,
  CONSTRAINT ck_credit_evaluation_model_interval
    CHECK (applicable_to IS NULL OR applicable_to >= applicable_from)
);
```

#### 36.2.12 `credit_evaluation_scoring_sheet` (A-58) — Wave 11

```sql
CREATE TABLE credit_evaluation_scoring_sheet (
  id                   TEXT PRIMARY KEY,
  model_id             TEXT NOT NULL REFERENCES credit_evaluation_model(id),
  customer_id          TEXT NOT NULL REFERENCES customers(id),
  salesperson_id       TEXT NULL REFERENCES salesperson_profiles(id),
  credit_profile_id    TEXT NOT NULL REFERENCES credit_profile(id),
  profile_state_hash   TEXT NOT NULL,
  sheet_data_json      TEXT NOT NULL,
  submitted_at         TEXT NULL,
  finalized_at         TEXT NULL,
  CONSTRAINT ck_credit_evaluation_scoring_sheet_finalized
    CHECK (finalized_at IS NULL OR submitted_at IS NOT NULL)
);
```

§29.27's opaque `profile_snapshot_identity` is replaced by a real `credit_profile_id` FK (structural traceability, `document.md` §6 B-4) plus `profile_state_hash` (content snapshot). `salesperson_id` mirrors the profile scope so a sub-limit evaluation is scoped identically to the control it will feed.

#### 36.2.13 `credit_evaluation_result` (A-59) — Wave 11

```sql
CREATE TABLE credit_evaluation_result (
  id                   TEXT PRIMARY KEY,
  sheet_id             TEXT NOT NULL REFERENCES credit_evaluation_scoring_sheet(id),
  scheme_id            TEXT NOT NULL REFERENCES credit_evaluation_scheme(id),
  total_score          REAL NOT NULL,
  rating_grade         TEXT NOT NULL,
  evaluator_count      INTEGER NOT NULL,
  applied_at           TEXT NULL,
  applied_by           TEXT NULL REFERENCES users(id),
  applied_to_profile_id TEXT NULL REFERENCES credit_profile(id),
  CONSTRAINT uq_credit_evaluation_result_sheet UNIQUE (sheet_id),
  CONSTRAINT ck_credit_evaluation_result_evaluators CHECK (evaluator_count >= 1),
  CONSTRAINT ck_credit_evaluation_result_applied
    CHECK ((applied_at IS NULL AND applied_by IS NULL AND applied_to_profile_id IS NULL)
        OR (applied_at IS NOT NULL AND applied_by IS NOT NULL AND applied_to_profile_id IS NOT NULL))
);
```

`credit_evaluation_result` is the **aggregated** sheet outcome (one row per sheet, `evaluator_count` recording the bounded multi-scorer cardinality); per-evaluator entries live inside `sheet_data_json`, which is what SC106's "within one scoring sheet instance" requires. `applied_to_profile_id` references the **effective Profile version**, never the anchor.

#### 36.2.14 `credit_recalculation_history` (A-60) — Wave 11

```sql
CREATE TABLE credit_recalculation_history (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN ('CHECK_ONLY','DETERMINISTIC_REBUILD')),
  triggered_by        TEXT NOT NULL REFERENCES users(id),
  triggered_at        TEXT NOT NULL,
  source_snapshot_window TEXT NULL,
  scope_filter_json   TEXT NOT NULL,
  result_summary      TEXT NOT NULL,
  duration_ms         INTEGER NOT NULL,
  inconsistency_count INTEGER NOT NULL,
  drift_detected      INTEGER NOT NULL CHECK (drift_detected IN (0,1))
);
```

Audit trail only. Stores no derived exposure and creates no second ledger.

#### 36.2.15 Final FK target matrix — no dangling references

| Referencing column | → Target | Target candidate key | Wave order |
|---|---|---|---|
| `credit_lock_anchors.customer_id` | `customers` | `id` PK | pre-existing |
| `credit_lock_anchors.salesperson_id` | `salesperson_profiles` | `id` PK | W1 |
| `credit_profile.anchor_id` | `credit_lock_anchors` | `id` PK | W9 (same wave, target-first) |
| `credit_profile.customer_id` | `customers` | `id` PK | pre-existing |
| `credit_profile.salesperson_id` | `salesperson_profiles` | `id` PK | W1 |
| `credit_profile.rule_id` | `credit_check_rules` | `id` PK | W9 (same wave, target-first) |
| `credit_profile.created_by` | `users` | `id` PK | pre-existing |
| `credit_policy_snapshots.credit_lock_anchor_id` | `credit_lock_anchors` | `id` PK | W9 (same wave, target-first) |
| `credit_policy_snapshots.credit_profile_id` | `credit_profile` | `id` PK | W9 (same wave, target-first) |
| `credit_policy_snapshots.captured_by` | `users` | `id` PK | pre-existing |
| `credit_profile_ratings.credit_profile_id` | `credit_profile` | `id` PK | W9 (same wave, target-first) |
| `credit_profile_ratings.evaluation_result_id` | `credit_evaluation_result` | `id` PK | **W11 — deferred and NULLABLE; `INITIAL_ASSIGNED` rows carry NULL and satisfy the FK on both engines, see §36.2.6 / §36.5.2** |
| `credit_profile_ratings.applied_by` | `users` | `id` PK | pre-existing |
| `credit_check_results.credit_lock_anchor_id` | `credit_lock_anchors` | `id` PK | W10 |
| `credit_check_results.credit_profile_id` | `credit_profile` | `id` PK | W10 |
| `credit_check_results.credit_policy_snapshot_id` | `credit_policy_snapshots` | `id` PK | W10 |
| `credit_check_results.sales_order_id` | `sales_orders` | `id` PK | W4 |
| `credit_check_results.sales_delivery_id` | `sales_deliveries` | `id` PK | W5 |
| `credit_special_approval.source_credit_check_result_id` | `credit_check_results` | `id` PK | W10 (same wave, target-first) |
| `credit_special_approval.source_credit_policy_snapshot_id` | `credit_policy_snapshots` | `id` PK | W10 |
| `credit_evaluation_model.scheme_id` | `credit_evaluation_scheme` | `id` PK | W11 (target-first) |
| `credit_evaluation_scoring_sheet.model_id` | `credit_evaluation_model` | `id` PK | W11 |
| `credit_evaluation_scoring_sheet.customer_id` | `customers` | `id` PK | pre-existing |
| `credit_evaluation_scoring_sheet.salesperson_id` | `salesperson_profiles` | `id` PK | W1 |
| `credit_evaluation_scoring_sheet.credit_profile_id` | `credit_profile` | `id` PK | W11 |
| `credit_evaluation_result.sheet_id` | `credit_evaluation_scoring_sheet` | `id` PK | W11 |
| `credit_evaluation_result.scheme_id` | `credit_evaluation_scheme` | `id` PK | W11 |
| `credit_evaluation_result.applied_to_profile_id` | `credit_profile` | `id` PK | W11 |
| `credit_evaluation_result.applied_by` | `users` | `id` PK | pre-existing |
| `credit_recalculation_history.triggered_by` | `users` | `id` PK | pre-existing |

Within each wave, every same-wave FK target is created **before** the referencing table. The only cross-wave forward reference is the single deferred FK handled in §36.5.

**Historical reference vs lock identity.** `credit_profile_ratings.credit_profile_id`, `credit_policy_snapshots.credit_profile_id`, `credit_check_results.credit_profile_id`, `credit_evaluation_scoring_sheet.credit_profile_id` and `credit_evaluation_result.applied_to_profile_id` all reference the **effective Profile version** (`credit_profile.id`). Only `credit_lock_anchors.id` and the `credit_lock_anchor_id` columns are used for `FOR UPDATE`. No lock identity is ever substituted for a version reference, and no version reference is ever used as a lock.

### 36.3 C2 — Dual-Limit Control: scope resolution, exposure, atomicity

#### 36.3.1 Applicable control scope resolution

`resolveApplicableCreditScopes(input)` is a pure function of `(customer_id, salesperson_id, credit_object_type, credit_object_id, business_date)` and the Credit Policy configuration. It returns an ordered, non-empty list of scopes; it performs no I/O against mutable state and no locking.

```text
1. aggregate scope applies  iff a credit_profile exists for
   anchor_key = ...|SCOPE:AGGREGATE effective at business_date
2. sub-limit scope applies  iff salesperson_id IS NOT NULL AND a credit_profile
   exists for anchor_key = ...|SCOPE:SALESPERSON|<salesperson_id>
   effective at business_date
3. salespersons with no effective sub-limit profile contribute NO sub-limit scope
   (this is the normal case, not a failure)
```

Outcomes against P1–P6:

| Situation | Scopes enforced | Behaviour |
|---|---|---|
| Aggregate + sub-limit both effective (P3) | both | **both must PASS**; sub-limit never raises the aggregate ceiling |
| Aggregate only (P4) | aggregate | aggregate control alone |
| Sub-limit only, Policy permits salesperson-only (P5) | sub-limit | sub-limit control alone |
| Sub-limit only, Policy does **not** permit (P5) | none enforceable | **fail closed** — BLOCK, never PASS |
| Neither scope effective | none | §29.22.1 fail-closed (S15); Credit disabled or customer/scenario exempt by rule are the only bypasses, and both are explicit |
| Ambiguous attribution or invalid effective scope (P6) | — | **fail closed**; never an implicit PASS |

The `salesperson_id IS NULL` case (an SO with no salesperson) yields aggregate-only, and per `document.md` §13.4 the obligation still counts **fully** in the customer aggregate.

#### 36.3.2 PURE_DERIVED per-scope exposure projection

No `credit_exposure` table exists and none is introduced. Exposure is computed per scope from canonical facts inside the check transaction.

**Canonical facts and Finance direction.** Sales reads Finance exclusively through the frozen adapters; it never writes AR, advance, unapplied, collection, refund, write-off, invoice, treasury, voucher or GL (§29.20, §34.8 rows 12–13).

| Bucket | Source | Customer aggregate | Salesperson sub-limit |
|---|---|---|---|
| Approved SO commitment | `sales_orders` approved, in exposure window | all of the customer's | `PROVABLY_ATTRIBUTABLE` to this salesperson only |
| Delivered-not-yet-settled | `sales_deliveries` / `sales_delivery_items` | all of the customer's | `PROVABLY_ATTRIBUTABLE` only |
| Finance AR open | `financeAdapter.resolveCreditExposureComponents(...)` | yes | **PROVABLY_ATTRIBUTABLE only** — see §36.3.2.1 |
| Eligible prepayment | `financeAdapter` PREPAYMENT locked read | yes, as an offset | **no** — Finance holds no salesperson dimension for advance money |
| Refund / write-off / collection | Finance canonical adapter | yes, as a release | against a `PROVABLY_ATTRIBUTABLE` parent only |

**SUPERSEDED 2026-10-22 — see §36.11.1.** The rationale that excluded Finance AR from the sub-limit on the grounds that "AR recognition happens later, during invoicing" is **incorrect**. `DIRECT_BUSINESS_OPEN_ITEM` creates the final AR open item at business execution, so a Credit Check can observe AR before any invoice exists. A salesperson sub-limit must remain binding on an outstanding economic obligation across recognition stages. The operative rule is §36.3.2.1 below.

**SC91 stage transition (S14).** For each obligation the projection holds a single canonical stage and asserts the transition, never both:

```text
SO commitment present  AND  AR for the same obligation present
  -> forbidden combination
  -> the SO commitment component is released / re-declared at the transition
  -> SC91 violation if both are simultaneously counted
```

##### 36.3.2.1 Salesperson attribution evidence policy

```text
PROVABLY_ATTRIBUTABLE
  item_class = 'SOURCE'
  AND source_type / source_id resolve to a real Sales source record
  AND that record's chain to sales_orders.salesperson_id is unbroken
  AND yields exactly one salesperson
  -> that salesperson's sub-limit counts the AR amount IN FULL

PROVABLY_NOT_MINE
  chain resolves to a different salesperson
  -> excluded from this sub-limit; counted in that salesperson's sub-limit
     and in the customer aggregate

ATTRIBUTION_AMBIGUOUS
  item_class <> 'SOURCE'                (consolidated / aggregated AR)
  OR broken or absent source chain
  OR the chain spans more than one salesperson
  OR sales_orders.salesperson_id IS NULL
  -> the obligation cannot be proven absent from ANY sub-limit scope
```

**Mandatory sub-limit with ambiguous exposure fails closed (P6).** When a salesperson sub-limit scope applies and its effective rule is `BLOCK`, and any `ATTRIBUTION_AMBIGUOUS` AR exists for that customer in the exposure window, the sub-limit scope **cannot prove it passes** and therefore returns `BLOCK` with reason code `UNPROVEN_ATTRIBUTION`. It never returns PASS. This is neither an implicit pass (P6) nor an apportionment (P9): the ambiguous amount is never split and never assigned to anyone — it simply cannot be discharged from the control.

The customer aggregate is never weakened by this rule: it counts **all** AR of the customer regardless of attribution, so the aggregate ceiling always binds.

Prepayment remains customer-level in both scopes: Finance holds no salesperson dimension for advance money, so it is an aggregate-only offset and never a sub-limit component.

##### 36.3.2.2 Amount-level stage transitions (SC91 / S14)

Each obligation occupies exactly one canonical stage at a time. A transition releases the predecessor's amount and declares the successor's amount for the **same obligation identity**, so the two are never simultaneously counted.

```text
A (SO commitment)
  -> B (delivered, not yet settled)   on SD confirm; A reduced by the delivered portion
  -> C (final AR open)                DIRECT_BUSINESS_OPEN_ITEM at business execution;
                                      B is never created on that path
  -> B then C                         INVOICE_DRIVEN_OPEN_ITEM; B fully released on AR

B (delivered, not yet settled)
  -> P (provisional AR)               PROVISIONAL_TO_FINANCIAL; B fully released
  -> C (final AR)                     B fully released

P (provisional)
  -> C (final)                        on conversion to financial; P fully released
  -> released                         on cancellation / reversal

C (final)
  -> partial release                  open_amount_cents reduced by the settled portion
  -> full release                     open_amount_cents = 0
```

```text
TI-1  exactly one stage per obligation identity per scope   -> proves no double count
TI-2  a release is amount-exact: released == declared for the same obligation
TI-3  an obligation that has entered C never re-enters A or B (no resurrection)
TI-4  per-scope total == sum of that scope's per-obligation stage amounts
```

**Direct recognition is explicitly covered.** `DIRECT_BUSINESS_OPEN_ITEM` creates the final AR open item at business execution rather than at invoicing (`finance-ar-open-item.js` / `finance-ar-init.js` insert with `item_kind='FINAL'`). A Credit Check therefore **can** observe AR that predates the next invoice — precisely the case the previous revision assumed away.

##### 36.3.2.3 Mandatory worked counterexample

```text
Customer aggregate limit                  100000
Salesperson A sub-limit                    60000
Salesperson A prior obligation              50000   -> transitioned to final AR, unpaid
New SO proposed delta                      20000

Salesperson A sub-limit exposure   =  50000   (AR is PROVABLY_ATTRIBUTABLE)
  proposed_total                   =  70000  >  60000   -> BLOCK
Customer aggregate exposure        =  50000
  proposed_total                   =  70000  <= 100000  -> PASS
Overall decision                   =  BLOCK                (P3: both must pass)
```

Under the previous revision the sub-limit saw exposure 0 and passed, letting A's true outstanding exceed the sub-limit — a S14 / P3 breach. Had the 50000-cent AR instead been consolidated or broken-chained, it would be `ATTRIBUTION_AMBIGUOUS`: the aggregate would count it in full, and the mandatory sub-limit would return `BLOCK / UNPROVEN_ATTRIBUTION` rather than PASS.

##### 36.3.2.4 Required scenario coverage

| Scenario | Customer aggregate | Salesperson sub-limit |
|---|---|---|
| New SO after a prior SO became AR | counts prior AR + new delta | counts prior AR (if attributable) + new delta |
| Partial settlement | `open_amount_cents` reduced | same release applied to the attributable parent |
| Partial delivery | A split into delivered B + undelivered A remainder | same split, attributable only |
| Return / credit adjustment | released against the original obligation | released against the attributable original |
| Source consolidation (merged AR) | full amount | `ATTRIBUTION_AMBIGUOUS` -> mandatory sub-limit BLOCKS |
| Missing salesperson provenance on the SO | full amount | `ATTRIBUTION_AMBIGUOUS` -> mandatory sub-limit BLOCKS |

**§13.4 attribution boundary, restated under the corrected rule.** `sales_orders.salesperson_id` is a nullable FK added in Wave 4, so pre-Wave-4 or otherwise unattributable obligations yield `ATTRIBUTION_AMBIGUOUS`. They always count in full in the customer aggregate and — unlike the previous revision — they **block** a mandatory salesperson sub-limit instead of being silently excluded from it. This is stricter, not weaker: no obligation escapes a control by lacking provenance. Non-blocking legacy-compatibility behaviour applies only to scopes that are **not** mandatory.

**P8 counting rule and P9 prohibition.**

```text
P8-1  Within one scope an obligation identity appears at most once (TI-1).
P8-2  Across scopes an obligation MAY appear once in the aggregate and once in
      its attributable sub-limit; that is two scopes, never a duplicate in one.
P3-1  A sub-limit can only tighten. Its result is computed independently and
      combined by AND; it never raises the aggregate ceiling.
P3-2  Overall = BLOCK if any applicable mandatory scope blocks.
P9-1  No code path splits, apportions or proportionally infers any Finance AR or
      settlement amount across salespersons. Ambiguity produces a BLOCK, never a
      fabricated salesperson assignment.
P9-2  Finance remains the sole owner of AR. The Credit projection is read-only
      and PURE_DERIVED; it creates no ledger and no cache.
```

**SUPERSEDED 2026-10-22 — replaced by §36.3.2.1–§36.3.2.4 above.** The three paragraphs that previously stood here (P8 counting rule; P9 hard prohibition; §13.4 attribution boundary) stated that unattributable obligations are simply excluded from the sub-limit. That was insufficient: exclusion allowed a salesperson to escape a mandatory control by lacking provenance. The operative rule now **blocks** the mandatory sub-limit with reason `UNPROVEN_ATTRIBUTION` instead.

#### 36.3.3 P5 policy configuration (no new business default introduced)

P5 is expressed through the existing `credit_parameters` / `credit_check_rules` mechanism, using bounded, effective-dated parameters. No new table, no new capability and no new default business value is introduced.

```text
Parameter codes owned by Wave 9 (Credit Policy, SC83 / SC84):
  CREDIT_MANAGEMENT_ENABLED              boolean   fail-closed false
  CREDIT_SUB_LIMIT_ONLY_ALLOWED          boolean   fail-closed FALSE  <-- the safe default
  CREDIT_SUB_LIMIT_MANDATORY             boolean   fail-closed false
  CREDIT_SUB_LIMIT_OVERDUE_DAYS          integer   fail-closed unset -> overdue policy undefined -> fail-closed
```

`CREDIT_SUB_LIMIT_ONLY_ALLOWED` defaults to `FALSE`. That is not a new business decision — it is the direct consequence of the already-frozen §29.22.1 rule that a missing mandatory profile must fail closed, and it preserves the P5 "otherwise fail closed" branch as the default. Enabling salesperson-only control is therefore an explicit, audited Credit Policy configuration change, not an emergent behaviour.

All four are ordinary effective-dated `credit_parameters` rows and inherit the version and interval rules of §36.2.3.

#### 36.3.4 Canonical multi-scope lock acquisition order

This order is global, deterministic and identical in every transaction. It is the complete deadlock-avoidance contract. **Amended 2026-10-22 — see §36.11.3**, which reorders the Finance PREPAYMENT parent lock to first position and removes row locks from `credit_policy_snapshots`.

| Step | Lock target | Mode | Ordering rule |
|---|---|---|---|
| 0 | ensure scope anchors exist (§36.4) | **no row lock** | lock-free discovery + idempotent provision (§36.4) |
| 1 | **Finance PREPAYMENT parent balances** (`settlement_unapplied_balances`) | `FOR UPDATE` via the frozen lock-plan pattern | **first lock taken by the Credit Check itself**, and it must precede every gate RESULT/REQUIREMENT lock in the enclosing transaction — see §36.12 for the caller-context qualification and the complete entrypoint matrix |
| 2 | all applicable `POLICY_SCOPE` anchors | `FOR SHARE` | `anchor_key ASC` — never a cross-order deadlock |
| 3 | `CREDIT_OBJECT` anchor, **SCOPE:AGGREGATE** | `FOR UPDATE` | always before any sub-limit |
| 4 | `CREDIT_OBJECT` anchor, `SCOPE:SALESPERSON:<id>` | `FOR UPDATE` | at most one per check; always after step 3 |
| 5 | `credit_profile` effective rows | `FOR UPDATE` | `id ASC` (aggregate row, then sub-limit row) |
| 6 | `credit_policy_snapshots` | **insert-only; existing rows read with no row lock** | insert-or-select by `UNIQUE (credit_lock_anchor_id, business_date, snapshot_fingerprint)` |
| 7 | `credit_check_rules` effective rows | `FOR UPDATE` | `id ASC` |
| 8 | `credit_check_results` (one row per scope) | insert | append-only |
| 9 | `credit_special_approval` | `FOR UPDATE` / insert | only when a SPECIAL_APPROVAL_REQUIRED outcome is being consumed |
| 10 | commit | — | releases every lock atomically |

##### 36.3.4.1 Why the Finance PREPAYMENT parent lock is first

`server/modules/sales-prepayment-finance-adapter.js:71-75` states a hard contract:

```text
lockEligiblePrepaymentParents must be the FIRST row lock any Sales gate path
takes: Finance PREPAYMENT parents are locked before any Gate requirement/result
or Sales business row.
```

reinforced at the call site in `sales-prepayment-gate.js:193-195`, and matching `solution.md` §29.17.7.5 (Finance parent first, then Sales/Inventory/Planning, then Sales intent rows) and §35.21.4.

The previous revision of this table placed the Finance parent lock at **step 7**, after the Credit anchors. That violated the frozen Wave 7 contract. It is corrected here to step 1. **Wave 7 is not modified, weakened or superseded** — the Credit path is brought into line with the existing contract instead.

Two further obligations follow from the contract:

```text
C-1  Use the frozen phase-1/phase-2 pattern
     discoverEligiblePrepaymentParents() -> resolveEligiblePrepaymentWithParentPlan()
     -> lockEligiblePrepaymentParents(plan)
     A bare resolveEligiblePrepaymentForSalesGate(..., lockMode:'FOR_UPDATE') call
     from the Credit Check is NOT permitted; it bypasses the split that makes the
     parent-first rule enforceable.

C-2  A Credit Check takes NO row lock on any Sales business row
     (sales_orders, sales_order_items, sales_deliveries, delivery_notices).
     Sales business rows are READ as canonical facts, exactly as Finance AR is
     read. Row-level serialization of credit is provided by the Credit anchors,
     which is where R-SAL-12's serialization requirement is actually met.

C-3  CALLER-CONTEXT QUALIFICATION (added 2026-10-22, see §36.12)
     "First lock" means first among the locks the Credit Check itself acquires.
     A Credit Check invoked from inside a caller that has ALREADY taken a row
     lock (SO submit / SO approve hold sales_orders) does not and cannot make
     the Finance parent the transaction's first row lock. What the contract
     actually requires is weaker but sufficient and verifiable:
         the Finance PREPAYMENT parent must precede EVERY Credit-owned lock and
         EVERY gate RESULT / REQUIREMENT lock in the enclosing transaction.
     §36.12 proves this holds for all thirteen mapped entrypoints once the two
     identified Wave 7 caller corrections are made.
```

C-2 is what closes the last potential cycle. `sales-orders.js:622` locks `sales_orders.id` *before* invoking the Wave 7 gate, so the SO-submit path is `sales_orders -> Finance parent`. If a Credit Check held the Finance parent and then wanted `sales_orders FOR UPDATE`, the two would form a cycle. Because the Credit Check never locks Sales business rows, the SO-submit path stays `sales_orders -> Finance parent -> ...` while the Credit path is `Finance parent -> Credit anchors -> ...`, and no cycle exists. §35.21.4 already relied on the same asymmetry for Finance mutation paths.

##### 36.3.4.2 Combined wait-for / dependency graph

```text
Finance mutation (applyUnappliedBalance / createRefund /
reverseSettlementDocument)
    -> acq PREPAYMENT parent                      (§35.18.6)

Wave 7 Prepayment Gate (SD confirm, service confirm)
    -> acq PREPAYMENT parent                      (gate.js:276)
    -> acq sales_prepayment_gate_results          (gate.js:278)
    -> acq sales_prepayment_requirements          (gate.js:280)
    -> caller capacity rows

Wave 7 SO submit / Reservation Intent  [frozen exception, §35.21.4]
    -> acq sales_orders.id                        (sales-orders.js:622)
    -> acq PREPAYMENT parent                      (gate.js:197)
    -> acq gate result / requirement

Credit Check (Wave 10)
    -> acq PREPAYMENT parent                      (§36.3.4 step 1)
    -> acq POLICY_SCOPE anchors   FOR SHARE       (step 2)
    -> acq AGGREGATE anchor      FOR UPDATE       (step 3)
    -> acq SALESPERSON anchor    FOR UPDATE       (step 4, optional)
    -> acq credit_profile rows   FOR UPDATE       (step 5)
    -> insert-or-select snapshot (no row lock)    (step 6)
    -> acq credit_check_rules    FOR UPDATE       (step 7)
    -> reads (NO lock): sales_orders, sales_deliveries, account_receivables
    -> insert credit_check_results
```

Inversion analysis: every path that touches the Finance PREPAYMENT parent takes it first. No path takes a Credit anchor before a Finance parent. No path takes a Sales business row before the Finance parent except the two frozen Wave 7 callers that §35.21.4 already analysed and that Finance never traverses. Therefore **no wait-for cycle exists** for any supported combination.

##### 36.3.4.3 Snapshot lock semantics (immutability preserved)

```text
Serialization identity   = credit_lock_anchors.id   (the ONLY lock identity)
Historical evidence      = credit_policy_snapshots.id + snapshot_fingerprint
```

A `credit_policy_snapshots` row is immutable, append-only decision evidence. It is **never** used as a serialization target:

```text
- New snapshot  : plain INSERT inside the check transaction. No explicit row lock
                  is taken; uniqueness is enforced by the named UNIQUE key.
- Existing row  : reused by a plain read. NO row lock of any kind is taken.
                  FOR UPDATE is explicitly forbidden here.
```

Taking `FOR UPDATE` on an existing snapshot row — as the previous revision of this table specified — would serialize every concurrent check that legitimately shares one immutable evidence row. That is pure contention with no correctness benefit: the anchors already guarantee that any check reusing a snapshot is holding the aggregate anchor. An append-only evidence row is never an alternative primary serialization anchor.

R-SAL-24 coherence is unaffected. Steps 2, 3, 5 and 7 hold `POLICY_SCOPE`, the anchors, the profile rows and the rule rows, so a policy or profile mutation cannot interleave with a check. The snapshot written afterwards is consistent with state observed under those locks. Because steps 5 and 6 execute once per logical check, all applicable scope rows share one coherent policy/profile version set.

**Why two different salespersons cannot both exceed the customer aggregate.** Step 3 is unconditional: **every** credit-controlled transaction acquires the SCOPE:AGGREGATE anchor of its customer `FOR UPDATE`, regardless of which salesperson authored the order and regardless of whether a sub-limit scope applies. Two salespersons on the same customer therefore contend on **one shared row**. The second transaction blocks at step 3 until the first commits; on acquiring the lock it re-reads the canonical facts, which now include the winner's committed obligation, and re-evaluates against that updated state. This is R-SAL-12's serialization requirement, satisfied by the aggregate anchor rather than by a non-existent exposure balance row.

**Write skew is excluded** because the aggregate anchor is held `FOR UPDATE` continuously from step 3 through commit — there is no window in which two transactions can both observe the same pre-commit aggregate.

**Two independent salesperson anchors do not protect the shared aggregate**, and the design never assumes they do. They serialize sub-limit consumption *within* one salesperson only; the aggregate is serialized solely by the aggregate anchor.

**Cross-customer independence.** Two different customers touch disjoint anchor sets and disjoint profile rows, so neither blocks nor deadlocks the other. Cross-customer contention only arises through step 1, which is a shared `FOR SHARE` policy read that does not conflict with itself.

**Deadlock freedom.** Every transaction acquires in exactly this order. A cycle would require two transactions to order a pair of resources differently, which this contract forbids. The `ASC` orderings at steps 1, 4 and 6 additionally remove ordering ambiguity within a class.

**Snapshot identity.** Steps 4–6 are executed **once per logical check** and the resulting `credit_policy_snapshots.id` + fingerprint is reused across every scope row of that check, so all applicable scope decisions are bound to one coherent policy/profile version set. That is R-SAL-24's invariant, structurally.

#### 36.3.5 One atomic multi-scope decision (P12)

```text
evaluateCredit() opens ONE transaction.
  -> resolves applicable scopes (§36.3.1)
  -> acquires the full lock chain once (§36.3.4)
  -> computes exposure per scope (§36.3.2)
  -> evaluates every applicable scope
  -> writes N credit_check_results rows sharing ONE check_group_id
  -> overall decision =
       BLOCK                                if ANY applicable mandatory scope is BLOCK
       WARNING                              else if any applicable scope is WARNING, none BLOCK
       SPECIAL_APPROVAL_REQUIRED            else if any scope requires it
       PASS                                 otherwise
  -> commits once, or rolls back everything
```

There is no partial outcome: a customer aggregate BLOCK cannot be committed while a sub-limit PASS is persisted, or vice versa. `check_group_id` makes the group addressable for audit, for Special-Approval scoping, and for tests that assert atomicity.

### 36.4 C3 — Canonical anchor provisioning protocol

This section **supersedes** §29.21.1, which was self-contradictory: it stated both that anchor creation happens in the "SAME DB transaction as the first authorized credit-controlled read/write" and that "a first-use anchor creation INSIDE the first credit-controlled transaction without a separate provisioning step is forbidden", while §29.21.3–§29.21.4 mandate an insert-or-converge protocol inside the controlled path.

**Decision: integrated provisioning protocol.** Selected because (a) it is the protocol the majority of the frozen text describes (§29.21.3 steps 2–6 and §29.21.4), (b) a separate committed transaction would leave a window between provisioning commit and business lock acquisition that a concurrent first-use transaction could exploit, and (c) the first-use race is closed by the unconditional re-read-and-lock at step 3, so a separate transaction is not required for correctness. The "distinct transaction" clause of §29.21.1 is therefore the superseded minority clause.

```text
ensureCreditLockAnchor(anchor_key, shape) — runs INSIDE the caller's transaction

  Step 1  Derive anchor_key as a pure function of the scope components.
          No I/O, no locking, fully deterministic.

  Step 2  Attempt INSERT.
          MySQL   : plain INSERT. On ER_DUP_ENTRY (1062) the statement is rolled
                    back; the transaction SURVIVES because InnoDB rolls back the
                    offending statement, not the transaction. Catch and continue.
          SQLite  : BEGIN IMMEDIATE already holds the database write lock, so the
                    insert is serialized against every other writer. On conflict,
                    continue (same statement-level semantics).

  Step 3  UNCONDITIONAL re-read and lock:
              SELECT id FROM credit_lock_anchors
               WHERE anchor_key = ? FOR UPDATE
          This runs for the inserter AND for the loser. The FOR UPDATE lock — not
          the insert — is the serialization authority. This is what closes the
          first-use race described in §29.21.3.

  Step 4  If step 3 yields no row -> ROLLBACK and FAIL CLOSED (P6 / S15).
          Never continue without the canonical anchor row.

  Step 5  Use the returned id as credit_lock_anchor_id and continue into the
          §36.3.4 lock order.
```

| Required property | How the protocol satisfies it |
|---|---|
| `UNIQUE(anchor_key)` | Column-level `NOT NULL UNIQUE` (§36.2.1); identical on both engines |
| Exactly one stable anchor | Convergent upsert keyed on the deterministic `anchor_key` |
| First-use concurrency | Two concurrent first uses collide on `UNIQUE`; both then execute step 3 and contend on the same `FOR UPDATE` row |
| Missing-anchor fail-closed | Step 4 |
| MySQL lock ordering | The aggregate anchor is always acquired (step 2 of §36.3.4) after all `POLICY_SCOPE` anchors; provisioning at step 2 here happens before either and therefore cannot invert the order |
| SQLite `BEGIN IMMEDIATE` compatibility | The caller already holds the write lock; provisioning participates in the same serialization |
| No partial business mutation | The anchor INSERT is in the same transaction as the business mutation, so any failure rolls both back |
| Idempotent retry | Anchors are derived from scope components, so a retry re-derives the same key and converges on the same row |

**Dual-scope compatibility.** Under the approved Dual-Limit policy a check may need up to three anchors: the applicable `POLICY_SCOPE` anchors, the SCOPE:AGGREGATE anchor, and the `SCOPE:SALESPERSON` anchor. The protocol provisions them in the fixed order `POLICY_SCOPE → AGGREGATE → SALESPERSON`, each fully provisioned and locked before the next is touched, so provisioning order and lock order can never diverge.

**POLICY_SCOPE anchors.** Provisioned at system install or by deterministic bootstrap migration, and therefore expected to exist. If a `POLICY_SCOPE` anchor is unexpectedly missing, step 4 fails closed — Credit is disabled entirely rather than silently running without a coherent policy scope.

**Persistence note.** Because provisioning is integrated, an anchor created during a transaction that later rolls back does not survive. That is correct and intentional: the anchor is a pure function of the scope, so the next attempt re-derives and re-provisions it. No orphan identity and no partial business effect can result.

### 36.5 C4 — Wave 9 → 10 → 11 migration DAG and dialect parity

#### 36.5.1 Actual repository migration architecture

Verified, not assumed:

```text
server/migrations/sales-customer-domain.js
  :21-38   frozen [{ id, wave, migrate }] registry
  :40-45   ordering derived by sort on (wave, id)
  :60-62   wave must be an integer within 0..13   -> Wave 9/10/11 fit unchanged
  :78-88   synchronous loop, NO applied-step persistence
  :6-10    idempotency is entirely per-step internal

SQLite -> MySQL bootstrap: a fresh MySQL database is built from an already-
migrated SQLite snapshot, then the same registry is replayed on the live MySQL
adapter. An existing MySQL database runs the live replay as its additive upgrade.

server/database/mysql-schema.js
  :159-182 tableDefinition  emits FK / UNIQUE / CHECK inline for CREATED tables
  :286-299 planMySqlAdditiveReconciliation emits CREATE TABLE + ADD COLUMN only;
                          it NEVER adds an FK to an existing MySQL table
  :184-203 columnDefinition emits AUTO_INCREMENT only when the SQLite DDL carries
                          AUTOINCREMENT (never true for the Sales domain)

Precedent for a nullable FK — server/migrations/sales-customer-wave2-pricing.js
  :93-133 ensureCustomerDefaults
         SQLite : ALTER TABLE ... ADD COLUMN <col> TEXT REFERENCES <target>(id)
         MySQL  : probe information_schema.KEY_COLUMN_USAGE
                  absent            -> ALTER TABLE ... ADD CONSTRAINT ...
                  single wrong name -> DROP FOREIGN KEY + re-ADD when provably
                                       equivalent (:115-122)
                  any other shape   -> throw, fail closed (:123-126)
                  then assert IS_NULLABLE = 'YES' (:127-131)

SQLite has NO ALTER TABLE ... ADD CONSTRAINT anywhere in this repository.
The established SQLite escalation is table rebuild —
  server/migrations/sales-customer-wave6-returns.js:289-343
  read sqlite_master.sql -> snapshot inbound FKs via PRAGMA foreign_key_list ->
  PRAGMA foreign_keys=OFF + legacy_alter_table=ON ->
  RENAME old / CREATE new / INSERT..SELECT copy / DROP old ->
  replay index DDL -> restore pragmas -> PRAGMA foreign_key_check fail-closed (:341-342)

Wave 8 supplies the reusable assertion template —
  server/migrations/sales-customer-wave8-service-consignment.js
  assertColumnContracts :386 | assertPrimaryKey :418 | assertForeignKeys :425
  assertChecks :441      | assertIndexShape :457  | unconditional invoke :493-504
```

#### 36.5.2 The one deferred FK — safe design, no unverified assumption

```text
credit_profile_ratings.evaluation_result_id  ->  credit_evaluation_result.id
creator wave = 9      target wave = 11
```

`document.md` §10 does not permit relying on whether SQLite accepts an inline FK to a not-yet-created table, nor on when such a constraint begins to be enforced. The design therefore takes the option that depends on **no** such assumption and is symmetric across engines:

```text
Wave 9  create credit_profile_ratings with
        evaluation_result_id TEXT NULL          <-- NO REFERENCES clause, either engine
        (nullable so SC89 initial ratings are insertable in Wave 9; see §36.2.6)
Wave 10 create no FK; touch nothing on this column
Wave 11 after credit_evaluation_result exists, add the constraint:
          MySQL   ALTER TABLE credit_profile_ratings
                  ADD CONSTRAINT fk_credit_profile_ratings_evaluation_result
                  FOREIGN KEY (evaluation_result_id) REFERENCES credit_evaluation_result(id)
          SQLite  table rebuild per sales-customer-wave6-returns.js:289-343,
                  preserving every row of credit_profile_ratings
```

Because no rating row can be written before Wave 11 (rating application is SC107, a Wave 11 capability), the column is empty when the constraint is added, so the SQLite rebuild copy is a no-op on the first pass while still being written to preserve rows correctly on replay and on any database that already carries rows.

**Why this is safe without relying on DDL-tolerance assumptions:**

- MySQL never sees a FK to a nonexistent parent, because no `REFERENCES` clause is emitted in Wave 9;
- SQLite never sees an unresolvable reference at DDL time, for the same reason;
- SQLite never needs `ALTER TABLE ... ADD CONSTRAINT`, which it does not support;
- the MySQL live-additive path is explicitly out of scope for `planMySqlAdditiveReconciliation`, so the Wave 11 step writes its own probe-and-`ADD CONSTRAINT`, exactly as Wave 2 does.

#### 36.5.3 Required ordering inside Wave 11

The order matters for the SQLite-to-MySQL bootstrap, because `tableDefinition` emits FKs inline for tables it creates. Within Wave 11:

```text
1. create the five other Wave 11 tables, target-first:
     credit_evaluation_scheme -> credit_evaluation_model ->
     credit_evaluation_scoring_sheet -> credit_evaluation_result
2. add the deferred FK to credit_profile_ratings
     (target credit_evaluation_result now exists on BOTH engines)
3. create credit_recalculation_history
4. run the Wave 8 style contract assertions for all Wave 11 tables
```

Because step 2 runs after `credit_evaluation_result` exists, the SQLite snapshot handed to the MySQL bootstrap carries a `credit_profile_ratings` DDL whose inline FK target is already present, so MySQL `tableDefinition` emits a valid constraint.

#### 36.5.4 Migration equivalence proof obligations (Stage D, not executed in Stage C)

| Path | Obligation |
|---|---|
| Fresh SQLite init | registry replay from wave 1 through 11 creates all 14 tables with the §36.2 contract |
| Wave 8 → 9 upgrade | 6 tables added; Wave 1–8 tables and rows untouched |
| Wave 9 → 10 upgrade | 2 tables added; `credit_special_approval` FK target created before the referencing table |
| Wave 10 → 11 upgrade | 6 tables added; deferred FK realised; SQLite rebuild row-preserving |
| Fresh MySQL init | SQLite snapshot → MySQL → registry replay yields the same PK/UNIQUE/FK/CHECK shape |
| Live MySQL sequential upgrade | same, applied incrementally against a live adapter |
| Repeated replay | every step is probe-then-act; a second full replay is a verified no-op |
| FK metadata equivalence | `information_schema.KEY_COLUMN_USAGE` matches the declared graph, including `fk_credit_profile_ratings_evaluation_result` |
| CHECK/UNIQUE/PK parity | named constraints present on both engines with equivalent semantics |
| Row preservation | every upgrade path preserves pre-existing rows in pre-existing tables |

`LEGACY_DATA_EVIDENCE_PENDING` applies to §36.5.6 only and does not affect any path above.

#### 36.5.5 Contract assertion requirement — **amended 2026-10-22 (see §36.11.5)**

Every Wave 9/10/11 migration step must append read-only `information_schema` assertions in the Wave 8 style — columns, nullability, defaults, PK column order, named FK set and targets, named UNIQUE groups including column order, CHECK count and index shape — and must **assert unconditionally after creating tables**, so that `CREATE TABLE IF NOT EXISTS` cannot silently adopt a drifted pre-existing structure. Any mismatch fails closed with no repair DDL. This is what makes the NULLability of `salesperson_scope_key` and the nullability of `credit_profile_ratings.evaluation_result_id` machine-verified rather than assumed.

**Added obligation — successful DDL is not evidence of referential integrity.** `server/database/mysql-schema.js:386` runs `SET FOREIGN_KEY_CHECKS=0` for the whole DDL/DML construction window and only restores it at `:448`. Any reference violation introduced inside that window is therefore silently accepted, and `CREATE TABLE` succeeding proves nothing about the data. Consequently, the following are additional mandatory Stage D acceptance obligations, beyond metadata shape:

```text
I-1  Named-FK existence: every FK in the §36.2.15 matrix must appear in
     information_schema.KEY_COLUMN_USAGE with the expected constraint name,
     column, referenced table and referenced column.
I-2  Referenced candidate keys: each FK target must be the leftmost prefix of a
     PRIMARY KEY or named UNIQUE on the target table.
I-3  Explicit orphan check after bootstrap AND after every live upgrade:
       SELECT COUNT(*) FROM child c
         LEFT JOIN parent p ON p.id = c.<fk>
        WHERE c.<fk> IS NOT NULL AND p.id IS NULL
     must return 0 for every FK in the matrix, executed with
     FOREIGN_KEY_CHECKS restored to its session default.
I-4  Row preservation: a snapshot of row counts for every pre-existing table
     must be identical before and after replay and after each upgrade path.
I-5  Cross-dialect nullable semantics: a column that is NULL-bearing in SQLite
     must be NULL-bearing in MySQL and vice versa. Specifically
     credit_profile.salesperson_id and credit_profile_ratings.evaluation_result_id
     must both be IS_NULLABLE='YES' on MySQL, and
     credit_profile.salesperson_scope_key must be IS_NULLABLE='NO'.
I-6  Forward-FK convergence: after Wave 11, fk_credit_profile_ratings_
     evaluation_result must exist and the I-3 orphan check must return 0.
I-7  Unexpected pre-existing shapes must fail closed, never be silently
     adopted or auto-repaired.
I-8  Real MySQL integration evidence at Implementation time, on a disposable
     guarded database, per AGENTS.md §13.
```

The existing bootstrap architecture (`FOREIGN_KEY_CHECKS` window, snapshot-driven `tableDefinition`, live additive replay) is preserved unchanged. The correction is to the **evidence obligations**, not to the bootstrap mechanism.

#### 36.5.6 Legacy Credit Profile bootstrap — conditional

No `credit_profile` table exists in this repository; the only occurrences are negative assertions that it must not yet exist. Therefore:

```text
The legacy bootstrap described in superseded §29.21.1 / §30.8 is CONDITIONAL and
remains blocked behind LEGACY_DATA_EVIDENCE_PENDING.

Wave 9 migration behaviour today:
  - create the new credit_profile table empty
  - do NOT backfill
  - do NOT invent Credit Profile records
  - do NOT fabricate historical credit limits or ratings
  - do NOT silently resolve ambiguous legacy identity
  - do NOT claim historical compatibility

If a separately authorized read-only inventory later proves a legacy
credit_profile table with rows, that is a separate approved migration decision,
not a Wave 9 default.
```

### 36.6 C5 — `evaluateCredit()` and Credit Special Approval contracts

#### 36.6.1 Canonical call sites

| Call site | Stage | Source capability | Required scopes |
|---|---|---|---|
| Sales Order submit | `SO_SUBMIT` | SC93 | all applicable |
| Sales Order approve | `SO_APPROVE` | SC94 | all applicable |
| Sales Delivery confirm | `SALES_DELIVERY_CONFIRM` | SC94 | all applicable |

No other stage is a canonical call site. A stage is enforced only when an effective `credit_check_rules` row with that `business_stage` and `control_strength='BLOCK'` exists; the frozen Requirement requires no additional stage.

#### 36.6.2 Input and output contracts

```text
INPUT
  customer_id            TEXT   NOT NULL
  salesperson_id         TEXT   NULL
  credit_object_type     TEXT   NOT NULL
  credit_object_id       TEXT   NOT NULL
  stage                  TEXT   NOT NULL
  business_date          TEXT   NOT NULL   -- authoritative (S19 / P10)
  proposed_delta_cents   BIGINT NOT NULL   -- may be negative (release)
  recognition_mode       TEXT   NOT NULL   -- one of the frozen V22 modes
  source_ref             { sales_order_id | sales_delivery_id }  NOT NULL

OUTPUT
  check_group_id             TEXT
  decision                   PASS | WARNING | BLOCK | SPECIAL_APPROVAL_REQUIRED
  scope_results[]            one entry per applicable scope:
      scope_type, credit_lock_anchor_id, credit_profile_id,
      credit_policy_snapshot_id, policy_snapshot_fingerprint,
      available_cents, exposure_cents, proposed_total_cents,
      decision, reason_codes[]
  consumed_special_approval_id TEXT NULL
  http_status                 200 | 409
```

`business_date` is taken from the canonical Sales business date of the source document, never from `created_at` or wall-clock time.

#### 36.6.3 Runtime sequence

```text
 1  RBAC + Credit Management enabled gate; missing profile -> FAIL CLOSED (S15)
 2  Idempotency: resolve any existing check_group for (source_ref, stage,
    business_date, authorization context). Replay returns the stored result.
 3  resolveApplicableCreditScopes(...)                              §36.3.1
 4  ensureCreditLockAnchor for POLICY_SCOPE -> AGGREGATE -> SALESPERSON §36.4
 5  acquire lock chain §36.3.4 steps 1-7 in order. Step 1 is the Finance
    PREPAYMENT parent balance FOR UPDATE via the frozen phase-1/phase-2
    discover -> plan -> lock pattern (never a bare locked-read); steps 2-7 are
    the Credit locks. Sales business rows are read WITHOUT any row lock (§36.3.4.1 C-2).
 6  for each applicable scope:
      resolve effective credit_profile at business_date (exactly one row,
        else fail closed)
      compute scope exposure                                   §36.3.2
      proposed_total = exposure + proposed_delta_cents
      evaluate control strength against effective credit_check_rules
 7  insert-or-select one credit_policy_snapshots row per scope, sharing one
    coherent fingerprint across the whole check                §36.2.5
 8  write one credit_check_results row per scope, one shared check_group_id
 9  write audit rows carrying fingerprint + business_date
10  COMMIT, or ROLLBACK the entire chain on any failure
```

`credit_policy_snapshots` is created or selected **before** the decision is written, so the evidence always precedes the artifact that cites it.

#### 36.6.4 Decision semantics

```text
overall = BLOCK if any applicable mandatory scope is BLOCK
          else WARNING if any scope is WARNING
          else SPECIAL_APPROVAL_REQUIRED if any scope requires an exception
          else PASS

A scope with no matching effective rule and no enforceable profile is never
PASS by omission: it is FAIL CLOSED unless Credit Management is disabled or the
customer/scenario is exempt by an explicit rule (§29.22.1, P6).
```

#### 36.6.5 Error and conflict semantics

| Condition | Status | Body |
|---|---|---|
| Any applicable scope BLOCK, no approval | 409 | decision, per-scope reason codes |
| Mandatory profile missing/invalid/ambiguous | 409 | fail-closed reason; never 200/PASS |
| Overlapping effective profile intervals detected | 409 | invariant breach, fail closed |
| Concurrent duplicate idempotency key | 409 | replay-safe, returns the stored result |
| Source already approved/confirmed | 409 | state conflict, no second decision |
| Anchor unresolvable after provisioning | 500 | fail closed, transaction rolled back |
| Finance adapter unavailable | 503 | fail closed, never degrade to PASS |

#### 36.6.6 Credit Special Approval contract

```text
Authority ceiling : frozen from the approver's role at request time into
                    authority_ceiling_cents. Requested ceiling may never exceed it.
SOD              : requester_id <> approver_id; enforced backend (SC114 / §34.7
                    P2 and P4). Frontend visibility is not authorization.
Scope             : ONE_TIME | TIME_BOUNDED | OBJECT_BOUNDED, bound to the exact
                    source_credit_check_result_id, which is scope-specific.
Expiry           : approved_expiry_business_date >= business_date; never in the past.
Snapshot binding : source_credit_policy_snapshot_id + fingerprint must equal the
                    check result's snapshot identity (§34.6.2 corollary).
```

**Dual-Limit consequences (P13, enforced structurally by §36.2.8).**

```text
- An approval binds to ONE scope of ONE logical check.
- The overall decision is satisfied only when EVERY applicable mandatory scope
  is individually satisfied. A SPECIAL_APPROVAL_REQUIRED on one scope does not
  release another scope's BLOCK.
- Approving the customer aggregate never releases a salesperson sub-limit BLOCK,
  and approving a salesperson sub-limit never releases an aggregate BLOCK.
- Each required approval is a separate request against a separate
  source_credit_check_result_id, therefore requires separate authority.
- scope_mode TIME_BOUNDED / OBJECT_BOUNDED may never silently widen to a second
  scope; widening requires a fresh credit check and fresh approvals.
```

**Revalidation after policy mutation.** An approval is bound to one snapshot fingerprint. If the effective policy/profile later changes such that the fingerprint differs, the stored approval can no longer satisfy a new check; the caller must run a fresh `evaluateCredit` and obtain fresh approval (§29.26, §34.6.2).

**Replay and duplicates.** `UNIQUE (source_credit_check_result_id)` makes a duplicate request for the same check result impossible; a second POST returns 409. Idempotent replay of the *same* request returns the existing row.

Platform's generic workflow/approval mechanics are reused unchanged; no new workflow engine is introduced.

### 36.7 C6 — Credit Evaluation and Reconciliation

#### 36.7.1 Canonical rating write owner — **supersedes §29.22 inline columns**

```text
SOLE canonical owner of applied rating state = credit_profile_ratings
credit_profile.rating_grade / rating_effective_from / rating_effective_to
  are a DERIVED READ PROJECTION of the current credit_profile_ratings row for
  that profile version, maintained inside the same transaction as the rating
  application, and never written independently.
```

This removes the dual representation that §29.22 created. The inline columns remain physically present for query efficiency and for compatibility with any reader that expects them, but they have exactly one writer — the rating-application transaction — and that writer derives them from `credit_profile_ratings`. No other path may write them.

#### 36.7.2 Rating application flow

```text
INITIAL_ASSIGNED  (Wave 9, SC89) — profile creation / new profile version
1  RBAC: SC111 manage authority
2  lock order §36.3.4 steps 1-5 for the profile's scopes
3  resolve the target credit_profile version
4  insert credit_profile_ratings with
     rating_source_type = 'INITIAL_ASSIGNED'
     rating_source_key  = 'INITIAL_ASSIGNED'
     evaluation_result_id = NULL
5  update the profile version's inline projection columns from step 4
6  COMMIT

EVALUATED  (Wave 11, SC107) — rating derived from an evaluation
1  RBAC: SC111 evaluate authority
2  lock order §36.3.4 steps 1-5 for the profile's scopes
3  resolve the target credit_profile version (the one effective at business_date)
4  credit_evaluation_result.applied_to_profile_id is bound to that VERSION,
   never to the anchor
5  insert credit_profile_ratings with
     rating_source_type = 'EVALUATED'
     rating_source_key  = the evaluation_result_id
     evaluation_result_id = that same id (CHECK-enforced equality)
6  update the profile version's inline projection columns from step 5
7  update credit_evaluation_result.applied_at / applied_by
8  COMMIT
```

**There is exactly one rating writer.** Both paths write `credit_profile_ratings`; neither writes `credit_profile.rating_*` independently — the inline columns are always derived from the row inserted by the active path (§36.7.1).

`UNIQUE (credit_profile_id, rating_source_key)` prevents re-applying one evaluation to one profile version, and permits exactly one INITIAL_ASSIGNED rating per profile version. A later EVALUATED rating does not overwrite the initial one; both rows exist, ordered by `applied_at`, and `superseded_at` records the transition — so historical rating traceability is preserved rather than collapsed.

`credit_profile.rating_grade` therefore always reflects the **most recent non-superseded** rating for that profile version, whatever its source.

#### 36.7.3 R-SAL-24 rating / check concurrency

A rating application changes `profile_effective_state_hash`, which changes the `credit_policy_snapshots` fingerprint. Because the rating path takes the same aggregate anchor `FOR UPDATE` (§36.3.4 step 3) and the same profile row lock (step 5) as a concurrent Credit Check, the two serialize. The loser re-reads and either computes against the new state or is blocked — so a Credit Check never mixes a pre-rating profile with a post-rating rule set.

#### 36.7.4 Bounded multi-scorer (SC106)

Multi-scorer aggregation is confined to one `credit_evaluation_scoring_sheet`. Per-evaluator entries live in `sheet_data_json`; `credit_evaluation_result` is the single aggregate with `evaluator_count`. There is no enterprise-wide open-scorer pool and no cross-sheet aggregation. Finalization locks the sheet row `FOR UPDATE`, so two concurrent finalizations cannot both write the aggregate.

#### 36.7.5 CHECK-only reconciliation and R-SAL-23

`credit_recalculation_history.kind = 'CHECK_ONLY'` is the default and the only kind exercised in this baseline. `DETERMINISTIC_REBUILD` remains defined but unexercised, because §29.24.1 froze `PURE_DERIVED`.

R-SAL-23 is therefore a **structural assertion**, not a materialized race:

```text
ASSERT: no persisted mutable Credit Exposure cache table exists
ASSERT: no Credit writer updates a materialized exposure balance
ASSERT: exposure is recomputed from canonical facts inside each check
=> a stale cache rebuild cannot overwrite newer exposure state, because no
   such state exists to overwrite
```

Introducing any persisted Credit Exposure cache remains a REQUIREMENT_REOPEN / DESIGN_REOPEN stop condition (§29.24.2, §30.7).

#### 36.7.6 Query and exception history

`credit_query_snapshot` and `credit_exposure_view` remain **DERIVED query layers, not tables**. Exception history is read from `credit_check_results` joined to `credit_special_approval` and the source SO/SD. No physical table is created for either.

### 36.8 C7 — Real MySQL race acceptance fixtures

All fixtures use **independent MySQL connections**, the production session isolation (READ COMMITTED, §37.17 — the former "default engine isolation (REPEATABLE READ)" wording was corrected on 2026-10-25), explicit transaction control, and no shared session state. No race is reported PASS on the basis of an intra-session simulation. Wave 13 remains the final cross-wave replay.

#### 36.8.1 Capacity precondition fixture — mandatory for every over-limit race

No fixture may assert "exactly one fails" without first proving its capacity precondition. With `available = credit_limit_cents − E` (E = PURE_DERIVED exposure at the business date, computed from committed facts before the race starts):

```text
CASE BOTH_FIT       : da <= available AND db <= available AND da + db <= available
                     expected: BOTH commit

CASE ONLY_ONE_FITS  : da <= available AND db <= available AND da + db > available
                     expected: exactly one commits, one receives 409 BLOCK

CASE NEITHER_FITS   : da >  available AND db >  available
                     expected: BOTH receive 409 BLOCK
```

Each fixture asserts its own precondition as a setup assertion, derived from the actual computed `available`, and the assertion is independent of which transaction wins. `ONLY_ONE_FITS` is the only case in which "exactly one fails" is a legitimate expectation, and only after its precondition is proven.

#### 36.8.2 Wave 9 — infrastructure-level

| Fixture | Competing transactions | Locks | Assertion |
|---|---|---|---|
| W9-R1 anchor provisioning | two concurrent first-use `ensureCreditLockAnchor` for the same `anchor_key` | step 2/3 of §36.4 | exactly one anchor row exists; both callers converge on the same id; no duplicate |
| W9-R2 dual-anchor lock order | one check needing AGGREGATE + SALESPERSON, one policy/profile mutation | §36.3.4 steps 1-3 | POLICY_SCOPE acquired before AGGREGATE before SALESPERSON in both traces |
| W9-R3 profile effective-date uniqueness | two concurrent inserts, same `(anchor_id, effective_from)` | AGGREGATE/SALESPERSON anchor | exactly one succeeds; other is HTTP 409; no partial version |
| W9-R4 policy version coexistence | two concurrent parameter versions for one `code` | POLICY_SCOPE anchor | both versions persist; effective lookup at a given date returns exactly one |
| W9-R5 cross-customer independence | concurrent first use on two different customers | disjoint anchors | neither blocks the other |
| W9-R6 **initial rating provenance (SC89)** | profile creation writes an INITIAL_ASSIGNED rating in Wave 9 | §36.3.4 steps 1-5 | row inserts with `evaluation_result_id IS NULL` while `credit_evaluation_result` does not yet exist; `UNIQUE (credit_profile_id, 'INITIAL_ASSIGNED')` admits exactly one |
| W9-R7 snapshot append-only | policy mutation vs concurrent check needing the same fingerprint | anchors | snapshot rows are never UPDATEd; existing rows take no row lock |

R-SAL-24 is **infrastructure-level only** at Wave 9. No Wave 9 fixture may claim full R-SAL-24 verification.

#### 36.8.3 Wave 10 — full business races

| Fixture | Race | Locks | Expected |
|---|---|---|---|
| W10-R1 R-SAL-12 full | `salesOrderAction(approve)` on two distinct SUBMITTED SOs, same customer (§37.39.6.3, corrected 2026-10-25) | AGGREGATE anchor | `BOTH_FIT` → both commit; `ONLY_ONE_FITS` → one commits, one 409; combined committed ≤ limit |
| W10-R2 R-SAL-13 full | Special Approval vs Order Approval | check-result row + approval row (UNIQUE source) | exactly one of approval/standard approval wins; never both silently |
| W10-R3 R-SAL-14 full | Credit release vs Finance canonical state | AGGREGATE anchor + Finance adapter lock | release uses the transition rule; exposure never double-counted |
| W10-R4 **R-SAL-24 full** | Policy/Profile mutation vs real Credit Check | POLICY_SCOPE FOR UPDATE vs check's POLICY_SCOPE FOR SHARE | exactly one coherent OLD or NEW snapshot; never mixed-version |
| W10-R5 **cross-salesperson aggregate** | salesperson A and salesperson B, same customer, `ONLY_ONE_FITS` | shared AGGREGATE anchor | **exactly one commits** — proves the aggregate anchor, not the two salesperson anchors, serializes the shared capacity |
| W10-R6 same-salesperson sub-limit | two concurrent orders by salesperson A against A's sub-limit | AGGREGATE + SALESPERSON anchors | `ONLY_ONE_FITS` on the sub-limit → one commits |
| W10-R7 different-scope approvals | approval on aggregate scope concurrent with sub-limit BLOCK | per-scope check-result rows | sub-limit stays BLOCK; approval does not leak (§36.6.6) |
| W10-R8 profile/policy mutation vs multi-scope check | profile mutation vs dual-scope Credit Check | §36.3.4 steps 1-5 | both scope rows use one coherent version set |
| W10-R9 **sub-limit survives SO→AR transition** | prior SO 50000 already transitioned to final AR unpaid; new SO 20000; sub-limit 60000, aggregate 100000 | §36.3.4 steps 1-5 | sub-limit exposure = 50000 → proposed 70000 > 60000 → **BLOCK**; aggregate PASS; overall BLOCK. Must FAIL if the sub-limit reports exposure 0. |
| W10-R10 **unproven attribution blocks sub-limit** | consolidated AR (`item_class <> 'SOURCE'`) present; mandatory sub-limit active | §36.3.4 steps 1-5 | sub-limit returns `BLOCK / UNPROVEN_ATTRIBUTION`; aggregate counts the ambiguous amount in full |
| W10-R11 **Wave 7 + Credit lock-order parity** | Wave 7 prepayment gate on one session vs Credit Check on another, same customer | §36.3.4 step 1 Finance-parent-first | both take the PREPAYMENT parent first; no circular wait; both complete or one blocks and completes |
| W10-R12 **snapshot reuse causes no contention** | N concurrent checks sharing one immutable snapshot | §36.3.4 step 6 | all succeed; existing snapshot rows take NO row lock (§36.3.4.3) |

W10-R5 is the fixture that directly answers "two salespersons cannot both exceed the customer aggregate capacity": it must fail if the implementation ever relied on salesperson anchors alone.

#### 36.8.4 Wave 11

| Fixture | Competing transactions | Locks | Expected |
|---|---|---|---|
| W11-R1 rating vs Credit Check | rating application vs Credit Check | AGGREGATE anchor + profile row | serialize; check never mixes pre- and post-rating state |
| W11-R2 bounded multi-scorer finalization | two concurrent sheet finalizations | sheet row FOR UPDATE | exactly one aggregate result; `evaluator_count` correct |
| W11-R3 CHECK-only reconciliation | recalculation vs concurrent credit-consuming transaction | read-only canonical scan | no canonical Sales/Inventory/Finance/Accounting row mutated (S17) |
| W11-R4 R-SAL-23 structural | n/a — static assertion | n/a | no persisted exposure cache exists; assertion holds |

#### 36.8.5 Common side-effect assertions

For every race fixture: committed exposure never exceeds the applicable ceiling; no row exists in a partially applied state; audit rows exist for each committed decision; idempotency replay returns the stored result without a second effect; no committed transaction leaves an orphan anchor.

### 36.9 C8 — Module, API, UI, permission and compatibility contracts

#### 36.9.1 Canonical module responsibility

```text
server/modules/credit-anchor.js        ensureCreditLockAnchor; anchor_key derivation;
                                       anchor enumeration per scope
server/modules/credit-policy.js        credit_parameters / credit_check_rules CRUD;
                                       effective-version resolution (§36.2.3)
server/modules/credit-profile.js       credit_profile CRUD; interval authority (§36.2.2);
                                       effective-profile resolution
server/modules/credit-check.js         evaluateCredit(); lock chain §36.3.4;
                                       exposure projection §36.3.2; snapshot binding
server/modules/credit-special-approval.js  request/decide; ceiling; scope; expiry
server/modules/credit-evaluation.js    indicators/schemes/models/sheets/results;
                                       rating application (§36.7.2)
server/modules/credit-reconciliation.js    CHECK-only reconciliation
server/modules/credit-query.js         DERIVED query + exception history (no tables)
```

No mixed-owner file is introduced; `server/app.js` keeps HTTP lifecycle + auth + thin dispatch (§8).

#### 36.9.2 API inventory

```text
GET    /api/credit/policy/parameters            effective resolution at business_date
POST   /api/credit/policy/parameters            new effective version
GET    /api/credit/policy/rules                 effective rules at business_date
POST   /api/credit/policy/rules                 new effective rule version
GET    /api/credit/anchors                      anchor inventory (admin)
POST   /api/credit/anchors/provision            deterministic provisioning (admin)
GET    /api/credit/profiles                     by customer / object / salesperson
POST   /api/credit/profiles                     new effective version
GET    /api/credit/profiles/:id                 profile version detail
POST   /api/credit/check                        evaluateCredit -> decision + scopes
GET    /api/credit/check-results                history by source / stage / scope
POST   /api/credit/special-approvals            request (per scope)
GET    /api/credit/special-approvals            list / filter
POST   /api/credit/special-approvals/:id/decide decide (bounded authority + SOD)
GET    /api/credit/exposure                     DERIVED component breakdown
GET    /api/credit/exceptions                   DERIVED exception history
GET    /api/credit/evaluation/indicators|schemes|models
POST   /api/credit/evaluation/sheets            create sheet bound to a profile version
POST   /api/credit/evaluation/sheets/:id/submit
POST   /api/credit/evaluation/sheets/:id/finalize
POST   /api/credit/evaluation/results/:id/apply apply rating to a profile version
POST   /api/credit/reconciliation/run           CHECK-only
```

Every mutating endpoint carries backend permission + SOD + a negative authorization test in the same wave that introduces it (§30.15.1). Frontend-hidden-only is forbidden.

#### 36.9.3 Permission and data scope

```text
SC111  Credit View / Manage / Evaluate / Special Approve
       read          -> CREDIT_VIEW
       policy/profile write        -> CREDIT_MANAGE
       check evaluate             -> CREDIT_EVALUATE
       special approval request   -> CREDIT_SPECIAL_APPROVE
SC114  SOD: VIEW != WRITE; CREATE != APPROVE; CREDIT SPECIAL APPROVAL requires
       bounded authority separate from standard approval (§34.7 P1-P5)
       requester_id != approver_id on every approval
Data scope: sales group filtering applied in the backend predicate; never
       delegated to the frontend (§30.15.1).
```

Permission codes are named inside the frozen permission registry at Implementation time; Stage C fixes the capability intent only, consistent with §34.3.27.

> **SUPERSEDED IN PART — 2026-10-22.** The line *"Data scope: sales group filtering applied in the backend predicate"* above is **no longer the active Credit Profile authorization contract**. Approved `document.md §14` (AP1–AP4/AP4.1) establishes Sales Credit **central ownership** with no Sales-Group ownership of Credit Profile. The historical text above is retained verbatim as evidence of what was originally designed; the single authoritative contract is now **§36.15**. The SC111 / SC114 permission-intent lines above are **not** superseded.

#### 36.9.4 Wave-aligned acceptance

```text
Wave 9  UAT-S-29 (Credit Profile creation + effective dates + overdue policy)
             + UAT-S-30 (Credit Parameters + Credit Rules)
        deps: Wave 4  (supersedes the §30.17 "Wave 1" typo)
Wave 10 UAT-S-31 + UAT-S-32 + UAT-S-33
Wave 11 UAT-S-34 + UAT-S-35 + UAT-S-36
Wave 12 UAT-S-44 final permission proof + launcher + responsive matrix
```

#### 36.9.5 UI contract

```text
Wave 9   admin / setup only; no new top-level route, no launcher tile
Wave 10  credit-check evaluate surface; credit-special-approvals route
Wave 11  credit-evaluation route
Wave 12  consolidated launcher (<= 6 primary entries); responsive convergence

Widths 320 / 390 / 430 / 680 CSS px, 390 primary; touch targets >= 44 CSS px;
LIST -> DETAIL -> EDITOR/WORKFLOW; no core task depends on permanent horizontal
scroll. The existing Sales launcher and navigation are preserved; Credit adds no
primary top-level entry in Waves 9-11.

Error states: BLOCK shows the failing scope(s) and reason codes; FAIL-CLOSED
states must be visibly distinct from PASS; empty states must state that no
profile is configured rather than implying a zero limit.
```

#### 36.9.6 Compatibility and rollback

```text
Backward compatibility : all Wave 9-11 tables are new; no pre-existing table
                         changes shape. Existing Sales Order / Delivery /
                         Finance rows are read-only inputs.
LEGACY_DATA_EVIDENCE_PENDING : no legacy credit_profile bootstrap in this
                         baseline (§36.5.6).
Rollback (compatibility-first, per §30.8): disable new Credit writers and the
                         Credit gates; leave created tables and nullable evidence
                         in place. Destructive DROP after data exists requires
                         separate approval plus dependency proof.
Forward recovery : every step is probe-then-act and idempotent, so re-running the
                         registry converges rather than duplicating.
```

### 36.10 Stage C boundary and Stage D obligations

This section is **Design only**. No migration file, module, test or UI asset was created or modified; no database was accessed; no Git write was performed; `document.md` was not modified in Stage C.

Frozen and preserved: Wave 1–8 requirements and design; §29/§30 historical text as evidence; the 14-table allocation; the 26 SC allocation; SC total 114, invariants 20, UAT 44, races 24, Audit CAP 36.

Stage D obligations created by this Design:

```text
- Prove Dual-Limit Control on both engines, including the §13.4 attribution
  boundary on fresh-install and legacy-upgrade paths.
- Prove the §36.3.4 lock order is deadlock-free under W10-R5 cross-salesperson
  contention.
- Prove every §36.5.4 equivalence path, including SQLite rebuild row preservation.
- Prove every §36.8 race fixture on real MySQL with independent connections.
- Prove the contract assertions in §36.5.5 fail closed on drifted structures.
- Do not introduce any persisted Credit Exposure cache (R-SAL-23 stop condition).
```

**Status: `STAGE_C_CREDIT_COMBINED_DESIGN_RECORDED — AWAITING_USER_DESIGN_PASS`.**

---

### 36.11 Stage C bounded remediation record (2026-10-22)

External review raised three potential blocking contradictions and two consistency concerns against this Design layer. All five were verified against the actual `solution.md §36` text and the actual repository code. Three were real defects in this Design and have been corrected in place; two are clarifications that have been made operative. **No Requirement change was required and none was made.** `document.md` was not modified.

Corrections are applied **in place** in the clauses above rather than as a parallel competing definition, so that §36 never contains two active statements of the same rule. This record preserves the audit trail.

#### 36.11.1 Correction — salesperson sub-limit must survive the SO → AR transition

**Finding: CONFIRMED. The Design was wrong.**

§36.3.2 previously excluded all Finance AR and prepayment from salesperson sub-limit exposure, justified by the claim that "Finance AR recognition happens later, during invoicing, after every credit-controlled stage has already run."

That justification is **factually wrong**. `DIRECT_BUSINESS_OPEN_ITEM` creates the final AR open item at business execution, not at invoicing (`server/modules/finance-ar-open-item.js`, `server/modules/finance-ar-init.js` — `item_kind='FINAL'`). A Credit Check can therefore observe AR that predates the next invoice.

The consequence was a live S14 / P3 breach, reproducible with the reviewer's counterexample: with an aggregate limit of 100000, a sub-limit of 60000, a prior 50000 obligation already transitioned to unpaid AR, and a new 20000 proposal, the sub-limit reported exposure 0 and passed while the salesperson's true outstanding became 70000.

**Correction.** §36.3.2 now carries a source-identity map, an attribution classification (`PROVABLY_ATTRIBUTABLE` / `PROVABLY_NOT_MINE` / `ATTRIBUTION_AMBIGUOUS`), a corrected per-scope matrix in which AR is included when provably attributable, amount-level A/B/P/C stage transitions with invariants TI-1..TI-4, the mandatory worked counterexample, and the six required scenarios.

The decisive enabling fact is that `account_receivables` carries `source_type`, `source_id` and `item_class='SOURCE'`, so AR attribution is **provable** through the canonical chain. P9's prohibition on apportionment is untouched: nothing is split, inferred or proportionally allocated.

**Behavioural tightening.** Where attribution is genuinely ambiguous (consolidated AR, broken chain, missing `salesperson_id`), a **mandatory** sub-limit now returns `BLOCK / UNPROVEN_ATTRIBUTION` rather than silently excluding the amount. Excluding it allowed a salesperson to escape a mandatory control by lacking provenance. The customer aggregate still counts ambiguous amounts in full, so the aggregate ceiling is never weakened. This is stricter than the previous rule, never weaker, and it is the conservative fail-closed result that approved P6 requires.

**Scope preserved.** No persisted Credit Exposure ledger, no cache, no fabricated salesperson assignment, no new table. The projection remains read-only and PURE_DERIVED with Finance as sole AR owner.

#### 36.11.2 Correction — Wave 9 initial rating vs Wave 11 evaluation result

**Finding: CONFIRMED. The Design was internally contradictory and made SC89 unimplementable.**

`credit_profile_ratings.evaluation_result_id` was declared `NOT NULL` in Wave 9 while its target `credit_evaluation_result` does not exist until Wave 11. No rating row of any kind could be inserted during Wave 9, so **SC89** ("Credit Profile Initial State + Rating + Applicable Rule + Status"), a Wave 9 capability, could not be implemented in its own wave. Simultaneously §36.7.1 declared `credit_profile_ratings` the *sole* canonical rating writer, which left `credit_profile.rating_*` with no writer at all until Wave 11.

**Correction.** §36.2.6 now carries an explicit two-source provenance model distinguished by `rating_source_type`:

```text
INITIAL_ASSIGNED  Wave 9, SC89  -> evaluation_result_id IS NULL,
                                     rating_source_key = 'INITIAL_ASSIGNED'
                                     provenance = the authorized profile actor
EVALUATED         Wave 11, SC107 -> evaluation_result_id NOT NULL,
                                     rating_source_key = evaluation_result_id
                                     provenance = a real evaluation result
```

`UNIQUE (credit_profile_id, rating_source_key)` is non-null on both members and simultaneously enforces "exactly one initial rating per profile version" and "at most one application per evaluation result", with no NULL-distinct hazard and no partial index (which MySQL 8 lacks). The CHECK binds `rating_source_key` to `evaluation_result_id` for `EVALUATED` rows, so the key cannot drift from the FK.

No synthetic evaluation result is created; an initial rating is represented by `evaluation_result_id IS NULL`. The nullable column satisfies the Wave 11 FK on both engines, so the deferred-FK migration remains metadata-only and replay-safe. Fourteen tables are preserved. There is exactly one rating writer — both paths write `credit_profile_ratings`, and the inline `credit_profile.rating_*` columns are always derived (§36.7.1, §36.7.2).

Historical traceability is preserved rather than collapsed: an `EVALUATED` rating does not overwrite the `INITIAL_ASSIGNED` row; both exist, ordered by `applied_at`, with `superseded_at` recording the transition.

#### 36.11.3 Correction — global lock order vs the frozen Wave 7 contract

**Finding: CONFIRMED. The Design violated a frozen cross-Wave contract.**

`server/modules/sales-prepayment-finance-adapter.js:71-75` states a hard requirement, restated at the call site in `sales-prepayment-gate.js:193-195`:

```text
lockEligiblePrepaymentParents must be the FIRST row lock any Sales gate path takes
```

matching `solution.md` §29.17.7.5 and §35.21.4. The previous §36.3.4 table placed the Finance PREPAYMENT parent lock at **step 7**, after the Credit anchors — an inversion of the frozen order.

**Correction.** The Finance PREPAYMENT parent lock is now **step 1**, the first row lock taken by any Credit Check. **Wave 7 is not modified, weakened or superseded**; the Credit path is brought into line with the existing contract. Two obligations follow, recorded as §36.3.4.1 C-1 and C-2:

- **C-1** the Credit Check must use the frozen phase-1/phase-2 pattern (`discoverEligiblePrepaymentParents` → `resolveEligiblePrepaymentWithParentPlan` → `lockEligiblePrepaymentParents`). A bare `resolveEligiblePrepaymentForSalesGate(..., lockMode:'FOR_UPDATE')` call is not permitted, because it bypasses the split that makes parent-first enforceable.
- **C-2** the Credit Check takes **no row lock on any Sales business row**. Sales business rows are read as canonical facts, exactly as Finance AR is read.

C-2 closes the one remaining cycle. `sales-orders.js:622` locks `sales_orders.id` *before* the Wave 7 gate, so the SO-submit path is `sales_orders -> Finance parent`. Had the Credit Check taken the Finance parent and then wanted `sales_orders FOR UPDATE`, a cycle would form. Because it never locks Sales business rows, the SO-submit path remains `sales_orders -> Finance parent -> ...` while the Credit path is `Finance parent -> Credit anchors -> ...`.

§36.3.4.2 records the combined wait-for/dependency graph across Finance mutation, the Wave 7 Gate, the two frozen Wave 7 exceptions and the Credit Check, with the inversion analysis. Cross-salesperson serialization on the customer aggregate anchor (now step 3) is unaffected — it remains unconditional and is now reached only after the Finance parent.

**No frozen implementation change is required.** No Wave 1–8 code is touched.

#### 36.11.4 Clarification — snapshot immutability and lock semantics

**Finding: CONFIRMED as an over-specification.**

The previous §36.3.4 table specified `credit_policy_snapshots FOR UPDATE` on insert-or-select. An append-only immutable evidence row is not a serialization target, and locking a shared evidence row would serialize every concurrent check that legitimately reuses one snapshot — contention with no correctness benefit, because the anchors already guarantee that a check reusing a snapshot holds the aggregate anchor.

§36.3.4.3 now states explicitly: serialization identity is `credit_lock_anchors.id` only; a new snapshot is a plain `INSERT`; an existing snapshot is reused by a **plain read with no row lock**; `FOR UPDATE` on an existing snapshot row is forbidden. R-SAL-24 coherence is unaffected because `POLICY_SCOPE`, the anchors, the profile rows and the rule rows are all locked at steps 2, 3, 5 and 7.

#### 36.11.5 Clarification — MySQL bootstrap and FK integrity

**Finding: CONFIRMED. The acceptance obligations were insufficient.**

`server/database/mysql-schema.js:386` runs `SET FOREIGN_KEY_CHECKS=0` for the entire DDL/DML construction window, restored only at `:448`. Any reference violation introduced inside that window is silently accepted, so successful DDL is **not** evidence of referential integrity.

§36.5.5 now adds obligations I-1..I-8: named-FK existence, referenced candidate keys, an explicit orphan-reference check executed with `FOREIGN_KEY_CHECKS` at its session default after bootstrap **and** after every live upgrade, row-preservation counts, cross-dialect nullable/non-null parity (specifically that `salesperson_id` and `evaluation_result_id` are `IS_NULLABLE='YES'` while `salesperson_scope_key` is `IS_NULLABLE='NO'`), forward-FK convergence after Wave 11, fail-closed on unexpected pre-existing shapes, and real disposable-MySQL integration evidence at Implementation time.

The existing bootstrap architecture is **preserved unchanged**; the correction is to the evidence obligations, not to the mechanism.

#### 36.11.6 Stage C boundary after remediation

No `document.md` modification. No source, migration, test or UI change. No database accessed. No Git write. No new table beyond the approved 14. No SC / UAT / Race identifier added, deleted or renumbered. Wave 1–8 frozen material untouched. Stage D not begun. No test or DB gate has been executed or is claimed to have passed.

**Remaining unresolved item: `LEGACY_DATA_EVIDENCE_PENDING`** (§36.5.6), unchanged and still requiring separate authorization.

**Status: `STAGE_C_CREDIT_DESIGN_REMEDIATED — AWAITING_EXTERNAL_DESIGN_REVIEW`.**

---

### 36.12 Final lock-order closure (2026-10-22)

External review correctly identified that the §36.11.3 deadlock-freedom claim was **incomplete**: it reasoned only about Credit-versus-Wave-7 interactions and assumed Wave 7 was internally consistent. It is not. This section maps every real transaction entrypoint from the actual source, reports the pre-existing Wave 7 defect without concealing it, and defines the unified protocol.

#### 36.12.1 CONFIRMED pre-existing Wave 7 deadlock — not Credit-introduced

Verified by reading the code, not the comments:

```text
evaluateSalesPrepaymentGate()            server/modules/sales-prepayment-gate.js
  transaction begins                                :387
  replay probe (no lock)                            :388-389
  assertFinancialPeriodsOpen                        :396
  SELECT id FROM sales_prepayment_requirements FOR UPDATE     :399   <-- REQUIREMENT
  SELECT * FROM sales_prepayment_gate_results FOR UPDATE       :401   <-- RESULT
  resolveEligiblePrepaymentForSalesGate(lockMode:'FOR_UPDATE') :404  <-- FINANCE PARENT

authorizeSalesPrepaymentGateForMutation()   same file :180
  lookupRequirementForOrder()   plain SELECT, NO lock       :189
  loadOrder()                   plain SELECT, NO lock       :196
  lockEligiblePrepaymentParents()                            :197   <-- FINANCE PARENT
  SELECT ... sales_prepayment_gate_results FOR UPDATE        :202   <-- RESULT
  SELECT ... sales_prepayment_requirements FOR UPDATE        :213   <-- REQUIREMENT

authorizeSalesPrepaymentGateWithPlan()       same file :261
  order/requirement fingerprint validation -> 409 STALE      :266-272
  lockEligiblePrepaymentParents()                            :276   <-- FINANCE PARENT
  gate_results FOR UPDATE                                    :278   <-- RESULT
  gate_requirements FOR UPDATE                               :280   <-- REQUIREMENT
```

**Actual orders:**

```text
Path A  evaluateSalesPrepaymentGate          REQUIREMENT -> RESULT -> PARENT
Path B  authorizeSalesPrepaymentGateForMut    PARENT -> RESULT -> REQUIREMENT
Path B' authorizeSalesPrepaymentGateWithPlan PARENT -> RESULT -> REQUIREMENT
```

Path A is the **exact inverse** of Path B/B'. The adapter's own contract at `sales-prepayment-finance-adapter.js:71-75` states the parent must be locked *"before any Gate requirement/result or Sales business row"*. **Path A violates the contract its own module documents.**

**The cycle (same Sales Order, concurrent):**

```text
T1 Path A : holds REQUIREMENT(X) -> wants RESULT(X) -> wants PARENT(C)
T2 Path B : holds PARENT(C)     -> wants RESULT(X) -> wants REQUIREMENT(X)

T1 blocks on RESULT(X) held by T2;  T2 blocks on REQUIREMENT(X) held by T1.
=> ER_LOCK_DEADLOCK. Two inverted resource pairs are involved:
   (RESULT, PARENT) and (REQUIREMENT, PARENT).
```

Reachability: `evaluateSalesPrepaymentGate` is a live HTTP handler while `salesOrderAction` submit/approve and `confirmSalesDelivery` run the authorization paths. Two operators (or a retrying client and an operator) acting on the same order in the same stage is ordinary traffic.

**Scope honesty — this is narrower than "any concurrency":**

```text
Path A vs Path B, DIFFERENT orders of the same customer:
  T1 holds REQ(X), wants PARENT(C);  T2 holds PARENT(C), wants RESULT(Y),REQ(Y).
  T1 simply waits for PARENT; T2 never needs REQ(X) or RESULT(X).
  -> serialization, NOT deadlock.

Path A vs Path A, same order: both contend on REQUIREMENT(X) first -> serialized.
Path A vs Path A, different orders: both contend on PARENT(C) -> serialized.

=> The cycle requires Path A concurrent with Path B/B' on the SAME order.
   That is real and reachable, but it is NOT a general same-customer collapse.
```

#### 36.12.2 Complete cross-entrypoint lock acquisition matrix

`read` = non-locking read. `U` = `FOR UPDATE`. Implicit locks from `INSERT`/`UPDATE`/FK are noted. All rows below are read from the actual source.

| # | Entrypoint | File:line | Tx owner begins | Pre-tx discovery | Explicit lock sequence | Implicit |
|---|---|---|---|---|---|---|
| 1 | **Manual Gate Evaluation** | `sales-prepayment-gate.js:370/387` | gate `:387` | `loadOrder` `:374`, `lookupRequirementForOrder` `:376` (read) | **REQ U `:399` → RESULT U `:401` → PARENT U `:404`** | INSERT result `:423` |
| 2 | **SO Submit** | `sales-orders.js:609/619` | orders `:619` | `idempotencyReplay` `:617` (read) | **SO U `:620` → PARENT `:197` → RESULT `:202` → REQ `:213`** | `UPDATE sales_orders` `:646`; `sales_prepayment_gate_results` INSERT `:232` |
| 3 | **SO Approve** | `sales-orders.js:647` | orders `:619` | same | **SO U `:620`** — no gate | `UPDATE sales_orders` `:648` |
| 4 | **SO Reject** | `sales-orders.js:649` | orders `:619` | same | **SO U `:620`** | `UPDATE` `:649` |
| 5 | **SO Close / Cancel** | `sales-orders.js:650` | orders `:619` | same | **SO U `:620`** | `UPDATE` `:656` |
| 6 | **Reservation Intent** | `sales-reservation-intent.js:277` | reservation `:277` | none | **PARENT `:197` → RESULT `:202` → REQ `:213` → Inventory `:290+` → Planning `:290+`** | INSERT intent |
| 7 | **SD Confirm** | `app.js:5696/5698` | app `:5698` | `discoverSalesPrepaymentGatePlan` `:5697` (read, outside tx) | **PARENT `:276` → RESULT `:278` → REQ `:280` → SD read `:5702` (NO lock) → SO U via `sales-delivery-source.js:54`** | Inventory/Planning/OQC writers |
| 8 | **Service Confirm** | `service-fulfillment.js:149/152` | `:152` | `discoverSalesPrepaymentGatePlan` `:149` | **PARENT → RESULT → REQ** | fulfillment write |
| 9 | **Gate Override** | `sales-prepayment-gate.js:459/469` | gate `:469` | `loadOrder` `:467` (read) | RESULT `UPDATE` `:473` — **no PARENT lock** | — |
| 10 | **Requirement Update** | `sales-prepayment-gate.js:360` | gate `:360` | — | REQ `UPDATE` `:361` — **no PARENT lock** | — |
| 11 | **Finance applyUnappliedBalance** | `financial-controls.js:~157` | finance | none | **PARENT `:160`** then open-item reads | `balance_applications` INSERT |
| 12 | **Finance createRefund** | `financial-controls.js:~202` | finance | none | **PARENT `:205`** then voucher | `financial_refunds` INSERT |
| 13 | **Settlement reversal** | `settlement.js:~341` | settlement | none | **PARENT per UNAPPLIED component `:341`** | reversal + voucher |

Lock-owning callers **without** a gate call (so they never want PARENT, and therefore cannot participate in a PARENT cycle): `delivery-notices.js:27`, `sales-order-changes.js:134`, `sales-delivery-source.js:54`. Verified: zero `PrepaymentGate` references in those three files.

Entrypoints #9 and #10 take a single row lock each and request nothing else, so they can only ever *wait*, never close a cycle.

#### 36.12.3 Actual wait-for graph (pre-correction)

```text
   Path A                Path B/B'              Finance mutations
   (manual eval)         (SO submit, SD,        (apply/refund/reversal)
                          reservation, service)
      |                       |                          |
   REQ(X) U              PARENT(C) U                PARENT(C) U
      |                       |                          |
   RESULT(X) U            RESULT(Y) U                     |
      |                       |                          |
   PARENT(C) U -------------+                          |
      |                      REQ(Y) U                    |
      +--- CYCLE (same order X):                            |
          T1 holds REQ(X) wants RESULT(X);                    |
          T2 holds PARENT(C) wants RESULT(X) then REQ(X)      |

   SALES_ORDER inversion (same order only):
      SO Submit : SO(X) U -> PARENT(C) U
      SD Confirm: PARENT(C) U -> ... -> SO(X) U
      -> cycle would exist on {SO, PARENT}, but SO Submit requires
         status in (DRAFT, REJECTED) while SD Confirm requires an approved,
         delivered order -> states are mutually exclusive, so it is
         unreachable TODAY. It is state-machine luck, not lock-order safety.
```

#### 36.12.4 Corrected unified order — **R1/R2 WERE INVERTED, see §36.13.1**

```text
*** SUPERSEDED 2026-10-22 by §36.13. The R1/R2 assignment below was WRONG: ***

*** it placed SALES_ORDER before FINANCE_PREPAYMENT_PARENT, which directly ***

*** contradicts the W7-C2 remediation (PARENT before SALES_ORDER) and the ***

*** frozen adapter contract. The authoritative order is PARENT first. ***

R1  SALES_ORDER                U   ** WRONG — superseded **
R2  FINANCE_PREPAYMENT_PARENT  U   ** WRONG — this is actually R1 **
R3  POLICY_SCOPE               S   Credit only, anchor_key ASC
R4  CREDIT_OBJECT_AGGREGATE    U   Credit only
R5  CREDIT_OBJECT_SALESPERSON  U   Credit only, at most one
R6  CREDIT_PROFILE / CREDIT_RULE U  Credit only, id ASC
R7  GATE_RESULT                U
R8  GATE_REQUIREMENT           U
```

**How the Requirement→Parent vs Parent→Requirement inversion is resolved:** by making entrypoint #1 (`evaluateSalesPrepaymentGate`) obey the order its own module already documents. Requirement and Result move *after* the parent. No Requirement changes — Path A is brought into compliance with §29.16 / §35.18.6 / §35.21.4.

**R1 before R2:** `sales_orders` is locked by six call sites, but only SO submit/approve/reject/close (`sales-orders.js:487/521/620`) can subsequently want PARENT. `delivery-notices.js:27`, `sales-order-changes.js:134` and `sales-delivery-source.js:54` take it without ever requesting PARENT (verified: zero gate references), so they cannot participate in a PARENT cycle. After W7-C2, SO submit takes PARENT before SO, so SD Confirm's `PARENT → SO` also agrees with the total order.

#### 36.12.5 Selected canonical Credit ⇄ Prepayment integration protocol

```text
PHASE 0  DISCOVERY (outside any transaction, non-locking reads only)
  - read the Sales document and its customer (plain SELECT)
  - discover eligible PREPAYMENT parent ids for (customer, business_date)
  - capture an order/requirement fingerprint for stale detection
  Discovery never takes a row lock and never mutates.

PHASE 1  ENTER THE CALLER'S TRANSACTION (the caller owns it)
  - caller locks its own business row if it legitimately owns one (R1)
  - Credit Check is invoked at the point defined in PHASE 2; it does NOT open
    its own transaction and does NOT own the commit.

PHASE 2  PARENT-FIRST, THEN CREDIT, THEN GATE
  R2 lock the planned PREPAYMENT parents (frozen discover -> plan -> lock pattern)
  R2b re-validate the plan against the live eligible set; a mismatch is a
     STALE PLAN, not a silent re-lock of a newly appeared parent
  R3..R6 Credit-owned locks, in order
  R7..R8 gate RESULT then REQUIREMENT

PHASE 3  EVALUATE AND DECIDE
  - exposure projection is computed from facts re-read beneath R2..R6
  - every applicable scope decision is written to credit_check_results under one
    check_group_id, bound to one coherent snapshot
  - prepayment gate authorization runs afterwards at R7/R8

PHASE 4  COMMIT OR ROLLBACK — the caller's transaction, atomically
  No partial economic effect: Credit rows, gate rows, the caller mutation and
  the audit trail all commit or all roll back together.
```

**Invocation placement (binding):**

| Caller | Credit Check invoked |
|---|---|
| SO submit | after R1, before R7/R8 — i.e. before `authorizeSalesPrepaymentGateForMutation` |
| SO approve | after R1 (no gate) |
| SD confirm | before `authorizeSalesPrepaymentGateWithPlan`, inside the existing transaction |
| Service confirm | same as SD confirm |
| Reservation intent | not a Credit call site in this baseline |

Credit must **never** be invoked between R7/R8 and R2 — that inversion is unreachable in the current code and would be a defect.

#### 36.12.6 Frozen Wave 7 touchpoints — required future changes

These are **identified, not applied**. Wave 7 source is not modified in this Stage.

```text
W7-C1  REQUIRED
  file/function : server/modules/sales-prepayment-gate.js
                  evaluateSalesPrepaymentGate(), transaction body :387-412
  why unsafe     : locks REQUIREMENT (:399) and RESULT (:401) before PARENT (:404),
                   inverting Path B/B' and violating the module's own documented
                   contract at sales-prepayment-finance-adapter.js:71-75
  preserves Req  : YES — this is a lock-ACQUISITION-ORDER change only. No gate
                   decision, amount, ratio basis, snapshot key, audit payload or
                   HTTP contract changes. Path A simply acquires in the order
                   §29.16/§35.18.6 already mandate.
  smallest delta : hoist discoverEligiblePrepaymentParents() +
                   lockEligiblePrepaymentParents() to immediately after the
                   replay probe (:395), before the requirement lock (:399);
                   replace the adapter call at :404 with
                   resolveEligiblePrepaymentWithParentPlan(...) using that plan.
                   Roughly 6 lines moved within one function.
  regression     : all existing Wave 7 prepayment gate tests must pass unchanged;
                   add a test asserting the manual-evaluate path locks PARENT
                   before REQUIREMENT/RESULT.
  authorization  : REQUIRED. This touches frozen Wave 7 implementation and needs
                   explicit user approval before Stage D.

W7-C2  REQUIRED for a strict total order
  file/function : server/modules/sales-orders.js
                  salesOrderAction(), submit branch around :620
  why unsafe     : SO row is locked at :620 before PARENT (:197), inverting
                   SD Confirm's PARENT -> SO. Currently unreachable only because
                   submit (DRAFT/REJECTED) and SD confirm (approved order) are
                   mutually exclusive states — state-machine luck, not lock-order
                   safety. Any new entrypoint could expose it.
  preserves Req  : YES — orderly becomes: non-locking discovery read ->
                   discoverSalesPrepaymentGatePlan -> lockEligiblePrepaymentParents
                   -> SELECT ... FOR UPDATE. This mirrors the pattern SD Confirm
                   already uses at app.js:5697 and changes no business outcome.
  smallest delta : replace one locking read with a discovery read plus the
                   existing plan/lock helpers; ~4 lines.
  regression     : existing SO submit tests; add a test that a concurrent SD
                   confirm on the same order cannot invert the order.
  authorization  : REQUIRED, same approval as W7-C1.

NOT REQUIRED
  delivery-notices.js:27, sales-order-changes.js:134,
  sales-delivery-source.js:54  — these lock sales_orders but never request the
  Finance parent, so they cannot participate in a PARENT cycle. No change.
```

No new business Requirement arises from either change; both are corrections bringing existing callers into line with already-frozen design. Per `AGENTS.md` §16, a proven safety defect may not be left in place merely because a freeze exists — but it may also not be fixed silently. It is escalated here for explicit approval.

#### 36.12.7 Deterministic retry and idempotency

```text
STALE PLAN (SALES_PREPAYMENT_LOCK_PLAN_STALE, gate.js:271/:282,
            assertPrepaymentParentPlanCurrent)
  - deterministic business conflict, not a database fault
  - transaction rolls back whole; HTTP 409; client re-discovers and re-submits
  - already implemented in the frozen adapter; unchanged

DATABASE DEADLOCK / LOCK TIMEOUT (ER_LOCK_DEADLOCK 1213, ER_LOCK_WAIT_TIMEOUT 1205)
  - after W7-C1/W7-C2 these are ordinary contention, not a structural cycle
  - bounded retry: at most 3 attempts, exponential backoff with jitter
  - the WHOLE transaction is retried from PHASE 0, never resumed mid-way
  - every mutating endpoint is idempotent-keyed, so a retry cannot duplicate
    a credit_check_results row, a gate result, an audit entry or an economic effect
  - after 3 failed attempts: HTTP 503 with a retryable code; no partial state

Distinction, stated explicitly:
  a bounded retriable ER_LOCK_DEADLOCK is NORMAL CONTENTENTION and is retried;
  a permanently unsafe lock-order cycle is a DESIGN DEFECT.
  The pre-correction Path A/Path B inversion is the second kind and is fixed by
  W7-C1, not by retry. Retry must never be used to paper over an ordering defect.
```

#### 36.12.8 Mandatory real-MySQL concurrency fixtures

All fixtures use independent MySQL connections, `REPEATABLE READ`, explicit barriers. **None has been executed; no PASS is claimed.**

| # | Fixture | Canonical rows locked | Interleave | Expected serialization | Retry contract |
|---|---|---|---|---|---|
| M1 | Manual Prepayment Eval vs SO Submit, **same order** | PARENT, RESULT, REQ | T1 reaches REQ lock; T2 reaches PARENT lock; release both barriers | one completes, the other proceeds after commit — **no deadlock** post W7-C1 | any residual 1213 retries ≤3 |
| M2 | Manual Eval vs another Gate Authorization, **same order** | same | same | same | same |
| M3 | Manual Eval vs Gate Authorization, **different orders same customer** | PARENT shared | both request PARENT | serialized on PARENT; no deadlock | n/a |
| M4 | SO Submit vs Finance `applyUnappliedBalance` | SO, PARENT | both request PARENT | serialized on PARENT | ≤3 retries |
| M5 | SO Submit vs Finance `createRefund` | SO, PARENT | both request PARENT | serialized on PARENT | ≤3 retries |
| M6 | SO Submit vs Settlement reversal (UNAPPLIED) | SO, PARENT | both request PARENT | serialized on PARENT | ≤3 retries |
| M7 | SO Submit vs SD Confirm, **same order** | SO, PARENT | force both past R1 | one blocks at PARENT; **no deadlock** post W7-C2 (today: state-machine unreachable) | ≤3 retries |
| M8 | Reservation Intent vs Prepayment Gate, same order | PARENT, RESULT, REQ | both request PARENT | serialized on PARENT | n/a |
| M9 | Credit Check vs SO Submit, same order | SO, PARENT, CREDIT_* | Credit invoked after R1 before R7/R8 | single transaction; one commit | ≤3 retries |
| M10 | Two salespersons, one customer aggregate limit | PARENT, AGGREGATE anchor | both request PARENT then AGGREGATE | **exactly one commits** under ONLY_ONE_FITS | capacity preconditions per §36.8.1 |
| M11 | Credit Profile mutation vs active Credit Check | POLICY_SCOPE, ANCHOR, PROFILE | both request POLICY_SCOPE | one coherent OLD or NEW version set; never mixed | n/a |
| M12 | Credit Special Approval vs policy mutation | CHECK_RESULT, POLICY_SCOPE, APPROVAL | both request POLICY_SCOPE | approval bound to its snapshot; mutation forces revalidation | n/a |

Common post-conditions for every fixture: no partial economic effect; exactly one audit trail per committed decision; idempotent replay returns the stored result without a second effect; committed exposure never exceeds the applicable ceiling.

#### 36.12.9 Wave 9 vs Wave 10 implementation implications

```text
Wave 9  ships credit_lock_anchors / credit_profile / credit_parameters /
        credit_check_rules / credit_policy_snapshots / credit_profile_ratings.
        NO Finance adapter call and NO gate call -> W9 cannot deadlock against
        Wave 7. Wave 9 fixtures M1-M8 are not applicable to Wave 9 code.
        Wave 9 delivers W9-R1..R7 only.

Wave 10 introduces the first caller that touches the Finance adapter and the
        gate inside one transaction. W7-C1 and W7-C2 MUST land in or before
        Wave 10; landing them later would ship a Credit Check into a known
        inversion. Recommended: land both corrections in the Wave 9 migration /
        Integration prerequisite step so Wave 10 inherits a safe baseline.

Hard stop: if W7-C1/W7-C2 are not authorized, Wave 10 must NOT be started.
        This is a DESIGN_REOPEN_REQUIRED-equivalent stop condition per §30.15.
```

#### 36.12.10 Stage C boundary

No `document.md` change. No source, migration, test or UI change. No database access. No test executed — **no MySQL or other gate PASS is claimed**. No Git write. Wave 1–8 frozen code untouched; the two Wave 7 corrections are specified for future Implementation under separate user approval. No new table, no SC/UAT/Race identifier change. Stage D not begun.

`LEGACY_DATA_EVIDENCE_PENDING` remains the only open evidence dependency, unchanged.

**Status: `STAGE_C_FINAL_LOCK_ORDER_DESIGN_CLOSED — AWAITING_EXTERNAL_DESIGN_REVIEW`.**

---

### 36.13 Final lock contract correction (2026-10-22)

#### 36.13.1 The contradiction, stated plainly, and its resolution

§36.12.4 declared `R1 SALES_ORDER` then `R2 FINANCE_PREPAYMENT_PARENT`, and §36.12.5 instructed callers to take R1 before R2. W7-C2 specifies that SO submit must *discover, then lock the Finance parent, then lock the Sales Order FOR UPDATE*. **These are mutually inconsistent for a single transaction.** The external review is correct; the Design as written contradicted its own remediation.

Resolution, derived from the frozen adapter contract rather than preference:

```text
server/modules/sales-prepayment-finance-adapter.js:71-75
  "lockEligiblePrepaymentParents must be the FIRST row lock any Sales gate path
   takes: Finance PREPAYMENT parents are locked before any Gate
   requirement/result **or Sales business row**."
```

The adapter states parent-before-Sales-row explicitly. W7-C2 aligns SO submit with that contract; the §36.12.4 ordering did not. **`FINANCE_PREPAYMENT_PARENT` is R1. `SALES_ORDER` follows it.** §36.12.4 is superseded in full by §36.13.3.

#### 36.13.2 Mandatory edges, with source evidence

| # | Edge | Source evidence | Status |
|---|---|---|---|
| E1 | `PARENT < GATE_RESULT` | `gate.js:197→202`; `gate.js:276→278` | holds today |
| E2 | `PARENT < GATE_REQUIREMENT` | `gate.js:197→213`; `gate.js:276→280` | holds today |
| E3 | `GATE_RESULT < GATE_REQUIREMENT` | `gate.js:202→213`; `gate.js:278→280` | holds today |
| E4 | `PARENT` is first Finance lock for Finance mutations | `financial-controls.js:160`, `:205`; `settlement.js:341` | holds today |
| E5 | `PARENT < any Sales business row` | adapter `:71-75` | **VIOLATED** by `evaluateSalesPrepaymentGate` (`:399` before `:404`) → W7-C1 |
| E6 | `PARENT < SALES_ORDER` for gate-participating actions | adapter `:71-75` | **VIOLATED** by `salesOrderAction` submit (`:620` before `:197`) → W7-C2 |
| E7 | `POLICY_SCOPE < AGGREGATE < SALESPERSON < PROFILE/RULE` | §36.3.4 | Design |
| E8 | Credit locks `< GATE_RESULT < GATE_REQUIREMENT` | Credit evaluates before gate authorization | Design |
| E9 | `PARENT < POLICY_SCOPE` | Credit cannot compute prepayment offsets before the canonical locked read | Design |

E5 and E6 are the two inversions. Both are corrected by W7-C1 and W7-C2 respectively.

Additional source facts established for this analysis:

```text
- loadOrder() / lookupRequirementForOrder() are plain SELECTs, no locks
  (sales-prepayment-gate.js:54-71). This is why Path B can legally discover
  before locking.
- assertGroupScope() is read-only (sales-scope.js:16-30); it holds no lock, so
  nothing intervenes between the SO row lock and the gate call in
  salesOrderAction.
- sales-orders.js:487 updateSalesOrder and :521 addSalesOrderGiftLine lock
  sales_orders but never call the gate (only :639 does). They can therefore only
  ever WAIT for SALES_ORDER; they never hold it and then request PARENT, so they
  cannot participate in a PARENT cycle.
- delivery-notices.js:27, sales-order-changes.js:134,
  sales-delivery-source.js:54 lock sales_orders and never call the gate
  (verified: zero PrepaymentGate references).
```

#### 36.13.3 The canonical contract is a partial order, formally justified

A **total** order over every row is neither achievable nor necessary, because `SALES_ORDER` is genuinely taken at different depths by different legitimate callers. What is required is a partial order with no cyclic dependency. It is:

```text
ROOT (mandatory first lock, every gate-participating transaction)
  R1  FINANCE_PREPAYMENT_PARENT          U

  Then, in ANY mutually non-conflicting order, but with these mandatory edges:
  R2  SALES_ORDER                       U   caller-owned actions only
  R3  POLICY_SCOPE                      S   Credit only, anchor_key ASC
  R4  CREDIT_OBJECT_AGGREGATE           U   Credit only, unconditional
  R5  CREDIT_OBJECT_SALESPERSON         U   Credit only, at most one
  R6  CREDIT_PROFILE / CREDIT_RULE      U   Credit only, id ASC
  R7  GATE_RESULT                       U
  R8  GATE_REQUIREMENT                  U

  Mandatory edges:  R1 < R2, R1 < R3, R1 < R7, R1 < R8,
                    R3 < R4 < R5 < R6,  R7 < R8,  R2 < R7 (gate-participating
                    callers), R6 < R7.
```

**Why a partial order is sufficient — acyclicity argument.**

```text
*** INVALIDATED 2026-10-22 — see §36.14. Steps (3) and (4) below assume a      ***
*** PHYSICALLY HELD parent row. lockParentBalances() returns immediately when   ***
*** the parent set is empty (sales-prepayment-finance-adapter.js:44            ***
*** `if (!balanceIds.length) return;`), so no shared lock exists and step (3)  ***
*** does not hold. With an empty parent set, SALES_ORDER-before-AGGREGATE in   ***
*** SO Approve inverts AGGREGATE-before-SALES_ORDER in SD Confirm and a real   ***
*** deadlock exists. The corrected, parent-INDEPENDENT contract is §36.13.3 -> ***
*** §36.14.3. This argument is retained only as the record of the defect.      ***

(1) PARENT is keyed by customer (party_id).
(2) Every gate-participating transaction acquires PARENT(customer) as its FIRST
    lock (E1, E2, E4, E5-after-W7-C1, E6-after-W7-C2).
(3) [FALSE when the parent set is empty — no physical row lock is taken]
(4) [Holds only when (3) is true]
(5) For DIFFERENT customers, downstream lock sets are disjoint: SALES_ORDER,
    GATE_RESULT and GATE_REQUIREMENT are per-order/per-delivery; CREDIT_OBJECT
    anchors and CREDIT_PROFILE are per-customer.
(6) The only globally shared downstream rows are CREDIT_RULE effective versions
    and POLICY_SCOPE. Two different-customer checks may contend on the same
    CREDIT_RULE row FOR UPDATE, but neither holds anything the other needs, so
    this is bounded contention, not a cycle.
```

The single most important property is (2)-(4): **parent-first per customer serialises the entire downstream lock set.** That is why SALES_ORDER may legitimately sit at different depths in different callers.

#### 36.13.4 W7-C1 exact change contract — `evaluateSalesPrepaymentGate()`

Target: `server/modules/sales-prepayment-gate.js`, function `evaluateSalesPrepaymentGate`, transaction body `:387-434`.

```text
BEFORE
  :387 transaction begin
  :388 replay probe                       (no lock)
  :396 assertFinancialPeriodsOpen
  :399 REQ      FOR UPDATE     <-- E5 VIOLATION
  :401 RESULT   FOR UPDATE
  :404 adapter lockMode 'FOR_UPDATE' -> PARENT

AFTER
  :387 transaction begin
  :388 replay probe                       (no lock)          [unchanged]
  :0n PARENT discovery must happen OUTSIDE the transaction, before :387,
       using the caller's already-loaded `order.customer_id` (:374)
  :0n lockEligiblePrepaymentParents(discoveredPlan)           <-- R1, FIRST lock
  :0n assertPrepaymentParentPlanCurrent(...)  -> 409 STALE    [reuse adapter helper]
  :396 assertFinancialPeriodsOpen                              [unchanged]
  :401 RESULT  FOR UPDATE                   <-- after PARENT
  :403 REQ     FOR UPDATE                   <-- after RESULT, matching Path B/B'
  :0n resolveEligiblePrepaymentWithParentPlan(..., plan) with lockMode NONE
       [reuse the Phase-2 helper; do not call lockMode:'FOR_UPDATE']
  :423 INSERT result                        [unchanged]
  :431 audit                                [unchanged]
```

**Does Result or Requirement have to be locked first to match the other gate paths?** **Yes, and the required relative order is `RESULT` before `REQUIREMENT`** — matching `gate.js:202→213` and `gate.js:278→280` exactly (edge E3). The current Path A locks REQ (`:399`) before RESULT (`:401`), which also violates E3 in isolation. The corrected order is therefore `PARENT → RESULT → REQUIREMENT`, identical to Path B and B'.

**Explicitly not changed:** gate decision logic (`decideGate`), override handling (`:419-421`), snapshot key construction, audit payload, HTTP status codes, replay semantics, and the no-requirement 409. Only lock *acquisition order* changes; every computed amount and decision is byte-identical.

This is **not** "move six lines": it requires relocating discovery outside the transaction, adding a plan-current assertion, switching to the Phase-2 adapter helper, and reordering two locks.

#### 36.13.5 W7-C2 exact change contract — `salesOrderAction()` — **SUPERSEDED, see §36.14.5**

***The "PARENT → SO → Credit" ordering specified below is UNSAFE when the parent set is empty. It places SALES_ORDER ahead of CREDIT_OBJECT_AGGREGATE, which inverts the SD Confirm order AGGREGATE → SALES_ORDER and permits a real deadlock. The corrected scope moves SALES_ORDER to the LAST position — §36.14.5. The text below is retained as the record of the defect. ***

Target: `server/modules/sales-orders.js`, function `salesOrderAction`, submit branch `:620-645`.

Target: `server/modules/sales-orders.js`, function `salesOrderAction`, submit branch `:620-645`.

```text
BEFORE
  :619 transaction begin
  :620 SELECT * FROM sales_orders WHERE id=? FOR UPDATE     <-- E6 VIOLATION
  :621 assertGroupScope                (read-only)
  :622-638 submit validations          (read-only)
  :639 authorizeSalesPrepaymentGateForMutation -> PARENT first (:197)

AFTER
  DISCOVERY PHASE, OUTSIDE the transaction, only for actions that participate:
    - plain SELECT the order (customer_id, status, order_date,
      required_prepayment_cents, sales_group_id)
    - build plan = discoverSalesPrepaymentGatePlan(db, orderId, businessDate)
      which is read-only and returns { orderFingerprint, requirementFingerprint,
      parentBalanceIds }  (gate.js:248-259)
    - if no prepayment requirement exists -> parentBalanceIds = [] and the
      customer-level Credit offset set is empty; this is a valid NOT_REQUIRED
      case and must NOT weaken the mandatory Credit Check

  INSIDE the transaction, for action in (submit, approve):
    - lockEligiblePrepaymentParents(plan.parentBalanceIds)     <-- R1, FIRST lock
    - assertPrepaymentParentPlanCurrent(...) -> 409 STALE if the eligible set moved
    - SELECT * FROM sales_orders WHERE id=? FOR UPDATE        <-- R2, re-read
    - compare the re-read order against plan.orderFingerprint
      (id | customer_id | status | total_cents | sales_group_id);
      mismatch -> 409 STALE, roll back whole
    - Credit Check (if the action is credit-controlled) -> R3..R6
    - authorizeSalesPrepaymentGateForMutation -> reuses the SAME parent locks
      -> RESULT -> REQUIREMENT
    - submit validations (:622-638), status mutation (:646), idempotency save
      and audit (:659) all UNCHANGED
```

**Which actions receive the plan:** `submit` and `approve` only — both are credit-controlled (SC93/SC94) and both can reach the gate. `reject`, `close`, `cancel` neither invoke the gate nor a Credit Check, receive no plan, and lock `SALES_ORDER` at `:620` exactly as today. **Their semantics are not changed.**

**Discovery outside the transaction is safe** because the fingerprint plus the parent-plan assertion re-validate every fact that mattered. `assertPrepaymentParentPlanCurrent` already exists in the frozen adapter (`sales-prepayment-finance-adapter.js:82-89`) and is reused unchanged — this is the mechanism SD Confirm already relies on at `app.js:5697`.

**No-prepayment case:** when `plan.requirementId` is null the parent set is empty, `authorizeSalesPrepaymentGateForMutation` returns `NOT_REQUIRED` at `gate.js:190`, and Credit still runs and still fails closed per §29.22.1 when a mandatory profile is missing. The Credit gate is not weakened by the absence of prepayment.

#### 36.13.6 Final transaction sequences — **SO SEQUENCE SUPERSEDED, see §36.14.4**

***The SO Submit sequence below places `R2 SALES_ORDER` immediately after the parent lock. That is UNSAFE when the parent set is empty, because SO then precedes CREDIT_OBJECT_AGGREGATE while SD Confirm has AGGREGATE precede SO. SALES_ORDER moves to the LAST position — §36.14.4. The SD Confirm shape below remains valid and is retained. ***

**SO Submit (post W7-C2) — SUPERSEDED:**

**SO Submit (post W7-C2):**

```text
discovery (no tx)  read order -> discoverSalesPrepaymentGatePlan
transaction begin
  R1 PARENT (plan, id ASC) + plan-current assertion
  R2 SALES_ORDER FOR UPDATE  + order-fingerprint revalidation
  R3 POLICY_SCOPE FOR SHARE
  R4 CREDIT_OBJECT AGGREGATE FOR UPDATE
  R5 CREDIT_OBJECT SALESPERSON FOR UPDATE      (if applicable)
  R6 CREDIT_PROFILE / CREDIT_RULE FOR UPDATE
  R7 GATE_RESULT FOR UPDATE
  R8 GATE_REQUIREMENT FOR UPDATE
  write credit_check_results (one row per scope, one check_group_id)
  write gate result; submit validations; UPDATE status='SUBMITTED'
  audit + idempotency save
COMMIT (atomic; all rows or none)
```

**SD Confirm (unchanged shape, Credit inserted):**

```text
discovery (no tx)  discoverSalesPrepaymentGatePlan        [existing, app.js:5697]
transaction begin
  R1 PARENT (plan) + plan-current assertion                [existing, gate.js:276]
  R3 POLICY_SCOPE / R4 AGGREGATE / R5 SALESPERSON / R6 PROFILE+RULE   (Credit)
  R7 GATE_RESULT / R8 GATE_REQUIREMENT                      [existing]
  write credit_check_results
  delivery read (:5702, no lock); capacity path
  R2 SALES_ORDER FOR UPDATE via sales-delivery-source.js:54  [existing, later depth]
  Inventory / Planning / OQC writers
COMMIT
```

The differing depth of R2 is safe by the acyclicity argument in §36.13.3(3)-(4): both transactions serialise on the same customer's R1 before reaching any downstream lock.

#### 36.13.7 Two-session interleaving proving the inversions are removed

```text
=== Fixture M1: manual Gate Evaluation (T1) vs SO Submit (T2), SAME order X ===
PRECONDITION: order X is SUBMITTED/APPROVED so the submit gate path is reachable;
             customer C has an eligible PREPAYMENT balance.

BEFORE (current code):
  T1 gate.js:399  REQ(X)      U  -> ACQUIRED
  T2 sales-orders.js:620 SO(X) U -> ACQUIRED
  T1 gate.js:401  RESULT(X)   U -> ACQUIRED
  T2 gate.js:197   PARENT(C)  U -> BLOCKED (held by T1 at :404)
  T1 gate.js:404   PARENT(C)  U -> BLOCKED (held by T2)
  ==> ER_LOCK_DEADLOCK after innodb_lock_wait_timeout

AFTER (W7-C1 + W7-C2):
  T1 discovery (no lock); T2 discovery (no lock)
  T1 PARENT(C) U -> ACQUIRED
  T2 PARENT(C) U -> BLOCKED (held by T1)
  T1 RESULT(X) U -> ACQUIRED ; T1 REQ(X) U -> ACQUIRED
  T1 evaluates, commits, releases PARENT + RESULT + REQ
  T2 PARENT(C) U -> ACQUIRED ; plan-current assertion passes
  T2 SO(X) U -> ACQUIRED ; order fingerprint unchanged
  T2 RESULT(X) U -> ACQUIRED ; T2 REQ(X) U -> ACQUIRED ; submits
  ==> both complete in order; no deadlock; no lost update
```

```text
=== Fixture M7: SO Submit (T1) vs SD Confirm (T2), SAME order X ===
BEFORE (current code):
  T1 sales-orders.js:620 SO(X) U -> ACQUIRED
  T2 gate.js:276 PARENT(C) U     -> ACQUIRED
  T1 gate.js:197  PARENT(C) U     -> BLOCKED (held by T2)
  T2 sales-delivery-source.js:54 SO(X) U -> BLOCKED (held by T1)
  ==> ER_LOCK_DEADLOCK

AFTER (W7-C2 alone; W7-C1 not needed for this pair):
  T1 PARENT(C) U -> ACQUIRED (before SO)
  T2 PARENT(C) U -> BLOCKED (held by T1)
  T1 SO(X) U -> ACQUIRED ; ... ; T1 commits
  T2 PARENT(C) U -> ACQUIRED ; ... ; T2 SO(X) U -> ACQUIRED
  ==> no deadlock
```

#### 36.13.8 Regression fixture for the original failure

The fixture must **fail under the old ordering and pass under the new one**, otherwise it proves nothing. Barriers, not sleeps:

```text
M1  T1 = evaluateSalesPrepaymentGate(order X)
    T2 = salesOrderAction('submit', order X)
    barrier A: T1 signals "about to lock REQUIREMENT" (or, post-fix, "about to
               lock PARENT"); T2 signals "about to lock SALES_ORDER"
    release both simultaneously
    assert: no ER_LOCK_DEADLOCK within innodb_lock_wait_timeout
    assert: exactly one commits; the loser either retries or re-runs cleanly
    assert: committed gate result count == number of commits
    assert: no duplicate audit rows for the committed decision

    Under the OLD ordering this fixture MUST observe ER_LOCK_DEADLOCK.
    Stage D runs it against the pre-fix code first to prove it is a real
    reproducer, then against the fixed code to prove the fix.
```

This "prove it fails first" step is mandatory. A fixture that only passes post-fix does not establish that the defect existed.

#### 36.13.9 Stale plan, retry, idempotency

```text
STALE PLAN
  - assertPrepaymentParentPlanCurrent (adapter :82-89) and the gate's own
    SALES_PREPAYMENT_LOCK_PLAN_STALE (gate.js:271, :282) are reused unchanged.
  - additionally, W7-C2 revalidates the ORDER fingerprint (customer, status,
    total, group) so a Sales Order that changed between discovery and lock is
    rejected rather than gated against stale facts.
  - stale -> whole transaction rolls back -> HTTP 409 -> client re-discovers
    and re-submits. No partial state: no credit row, no gate row, no status
    change, no audit row survives a stale rejection.

DATABASE CONTENTION (1213 / 1205)
  - after W7-C1/W7-C2 these are ordinary contention, not a structural cycle
  - at most 3 attempts, exponential backoff with jitter
  - the WHOLE transaction restarts from the discovery phase
  - Idempotency-Key on every mutating route makes replay safe: no duplicate
    credit_check_results row, gate result, audit entry or economic effect
  - after 3 failures -> HTTP 503 retryable; no partial state

  A bounded retriable deadlock is CONTENTENTION and is retried.
  A permanently unsafe lock-order cycle is a DESIGN DEFECT (M1, M7) and is
  fixed by W7-C1/W7-C2. Retry must never be used to mask an ordering defect.
```

#### 36.13.10 Wave 9 independence and the Wave 10 precondition

```text
Wave 9 CAN be implemented independently.
  It creates credit_lock_anchors, credit_profile, credit_parameters,
  credit_check_rules, credit_policy_snapshots and credit_profile_ratings.
  It makes NO Finance adapter call and NO prepayment gate call, so it cannot
  deadlock against Wave 7. Wave 9 delivers W9-R1..R9-R7 only.

Wave 10 CANNOT begin until the following gate label passes:

  W7_C1_C2_ACCEPTANCE_PASS

  This is a GATE LABEL, not permission to implement. It is satisfied only when:
    1. the user has explicitly authorized W7-C1 and W7-C2;
    2. both changes are implemented in a Stage D step;
    3. fixtures M1 and M7 are proven to deadlock on the pre-fix code and to
       pass on the fixed code;
    4. the full Wave 7 prepayment regression suite passes unchanged;
    5. M1..M12 (§36.12.8) show no circular wait.

Wave 10 is the first wave that calls the Finance adapter and the gate inside one
transaction. Starting it before this gate would ship a Credit Check directly
into a known inversion.

UPDATE 2026-10-22 (§36.14): this label now also covers **W7-C2′**, whose scope is
larger than W7-C2 — SALES_ORDER moves to the LAST lock position rather than to
position 2. W7-C1 is unaffected. The label remains a gate, not permission.
```

#### 36.13.11 Boundary

No `document.md`, `AGENTS.md`, Wave 7 source, migration, Credit module, test or UI change. No database access. No test executed — **no MySQL or other gate PASS is claimed anywhere in this Design.** No Git write. W7-C1 and W7-C2 are specified as future Implementation candidates requiring explicit user authorization; they are **not** applied. No new table, no SC/UAT/Race identifier change. `LEGACY_DATA_EVIDENCE_PENDING` unchanged.

**Status: `STAGE_C_FINAL_LOCK_CONTRACT_CORRECTED — AWAITING_EXTERNAL_DESIGN_REVIEW`.**

---

### 36.14 Empty-parent lock closure (2026-10-22)

#### 36.14.1 Verified empty-parent lock behavior

`server/modules/sales-prepayment-finance-adapter.js:44`:

```js
function lockParentBalances(db, balanceIds) {
  if (!balanceIds.length) return;      // <-- NO physical row lock is taken
  ...
}
```

**Confirmed:** acquiring the parent-lock phase does **not** imply a physical shared lock always exists. Five distinct states must be handled separately:

| # | State | Physical PARENT lock? | Effect on the ordering contract |
|---|---|---|---|
| 1 | Prepayment requirement absent (`plan.requirementId === null`) | **No** — `parentBalanceIds = []` | Contract must be parent-INDEPENDENT |
| 2 | Requirement present, eligible balance set empty | **No** — array empty | same |
| 3 | One or more eligible balances | **Yes**, `id ASC` | parent-first serialization available |
| 4 | Parent set changed after discovery | **No new lock**; `assertPrepaymentParentPlanCurrent` throws 409 STALE | transaction rolls back whole |
| 5 | Credit Check required **independently** of the Prepayment Gate | **No** (Credit never depends on a parent row existing) | Credit locks must stand alone |

States 1, 2 and 5 are ordinary production conditions, not edge cases. Any ordering proof that depends on a held parent row is therefore invalid.

#### 36.14.2 The invalidated proof, and the real cycle it concealed

§36.13.3 argued that every same-customer transaction serialises on `FINANCE_PREPAYMENT_PARENT` before any downstream lock. That is **false when the parent set is empty**. The inversion it concealed:

```text
SO Approve (post-Design, empty parent set)
  sales-orders.js:620   SELECT * FROM sales_orders WHERE id=? FOR UPDATE   -> holds SO(X)
  sales-orders.js:647   status check
  Credit Check          POLICY_SCOPE -> CREDIT_OBJECT AGGREGATE            -> wants AGG(C)

SD Confirm (post-Design, empty parent set)
  app.js:5699           gate: no parent lock (empty set) -> RESULT -> REQ
  Credit Check (inserted before the gate)                                  -> holds AGG(C)
  app.js:5703           lockAndConsumeSalesDeliveryCapacity
  sales-delivery-source.js:51   SELECT * FROM sales_deliveries FOR UPDATE
  sales-delivery-source.js:54   SELECT * FROM sales_orders FOR UPDATE      -> wants SO(X)

T1 holds SO(X), wants AGG(C)
T2 holds AGG(C), wants SO(X)
=> ER_LOCK_DEADLOCK
```

This is **not** dismissed on state-machine grounds. `sales-delivery-source.js:55` validates `order.status !== 'APPROVED'` only *after* the SO row lock at `:54`, and `app.js:5707` re-reads the SO after that. A transaction that will ultimately be rejected still participates in lock waits before reaching validation. Whether a DRAFT delivery can exist against a non-APPROVED order changes only *how likely* the interleaving is, not whether the cycle exists.

**Reachable today** for the SO-first half? Not yet — Credit does not exist. This is a cycle that the Wave 10 implementation would *introduce* if the §36.13.5 ordering were followed. Correcting it now is the entire point.

#### 36.14.3 Final parent-independent acyclic lock contract

```text
L1  FINANCE_PREPAYMENT_PARENT   U   OPTIONAL — only when the discovered parent
                                    set is non-empty; skipped entirely otherwise
L2  POLICY_SCOPE                S   Credit only, anchor_key ASC
L3  CREDIT_OBJECT_AGGREGATE     U   Credit only, unconditional
L4  CREDIT_OBJECT_SALESPERSON   U   Credit only, at most one
L5  CREDIT_PROFILE / CREDIT_RULE U  Credit only, id ASC
L6  GATE_RESULT                 U
L7  GATE_REQUIREMENT            U
L8  SALES_ORDER                 U   + all subsequent capacity / business rows
```

**L1 is now optional and the order is TOTAL across L2..L8.** L8 being last is the load-bearing correction.

Verified against every entrypoint:

| Entrypoint | Lock sequence | Conforms? |
|---|---|---|
| SO Submit / Approve (post W7-C2′) | L1? → L2 → L3 → L4 → L5 → L6 → L7 → **L8** | requires W7-C2′ |
| SO Reject / Close / Cancel | L8 only | trivially conforms; no Credit, no gate |
| SD Confirm | L1? → L2 → L3 → L4 → L5 → L6 → L7 → DELIVERY → **L8** | **already conforms**; only Credit is inserted before L6 |
| Manual Prepayment Evaluation (post W7-C1) | L1? → L6 → L7 | already conforms |
| Reservation Intent | L1? → L6 → L7 → Planning → Inventory | **already conforms** — verified `sales-reservation-intent.js:66` reads `sales_orders` **without** `FOR UPDATE` |
| Finance apply / refund / reversal | L1 → … | already conforms |
| Credit Policy / Profile mutation | L2(U) → L3 → L5; no L1 | conforms |
| Credit Special Approval | consumed inside a check: L3 → L6/L7 → approval row | conforms |

**Acyclicity proof (no parent assumption).**

```text
(A) L2..L8 form a TOTAL order.
(B) Two transactions on DIFFERENT customers share no L8/L6/L7/L3/L4 rows.
    The only globally shared rows are POLICY_SCOPE (L2, FOR SHARE — compatible
    with itself and with a FOR UPDATE only by waiting) and CREDIT_RULE (L5,
    FOR UPDATE — pure contention, since neither holds anything the other needs).
(C) Two transactions on the SAME order share L8; they serialise there. But
    neither can reach L8 while the other still holds an earlier L-row, because
    L-rows strictly precede L8 in the total order.
=> No cycle exists in any interleaving, for any parent-set state (1..5).
```

Key point: the proof no longer uses the parent at all. Removing L1 changes nothing, which is precisely why the contract is parent-independent.

#### 36.14.4 Final transaction sequences

**SO Submit / Approve (post W7-C2′):**

```text
DISCOVERY (no transaction, read-only)
  read SO + order items snapshot: customer_id, status, total_cents,
  salesperson_id, sales_group_id, order_date, requested_delivery_date,
  ship_to_*, payment_terms
  build plan = discoverSalesPrepaymentGatePlan(db, orderId, businessDate)

FAST VALIDATION (still no transaction, still read-only)
  fail fast on missing order_date / requested_delivery_date / ship_to /
  payment_terms / line snapshot absence, exactly as :622-638 does today.
  No business mutation has occurred and no lock has been taken.

TRANSACTION
  L1  if plan.parentBalanceIds.length -> lockEligiblePrepaymentParents + assert
      PrepaymentParentPlanCurrent (else SKIP entirely — not an error)
  L2..L5  Credit Check (POLICY_SCOPE -> AGGREGATE -> SALESPERSON -> PROFILE/RULE)
  L6  GATE_RESULT        L7 GATE_REQUIREMENT
  L8  SELECT * FROM sales_orders WHERE id=? FOR UPDATE
  REVALIDATION under L8, every one of these, against the discovery snapshot:
      status, customer_id, salesperson_id, total_cents, sales_group_id,
      business date (order_date), and the plan identities
      (orderFingerprint | requirementFingerprint | parentBalanceIds)
      any mismatch -> 409 STALE, whole transaction rolls back
  authoritative line re-checks (:630-635) re-run under L8
  Credit + Gate evidence is written only AFTER revalidation passes
  status mutation (:646 / :648), audit, idempotency save -> single COMMIT
```

**SD Confirm (shape unchanged; only Credit is inserted):**

```text
DISCOVERY  discoverSalesPrepaymentGatePlan  [existing, app.js:5697]
TRANSACTION
  L1? parent plan + assertion              [existing]
  L2..L5 Credit Check                      (new, inserted here)
  L6 GATE_RESULT   L7 GATE_REQUIREMENT     [existing, gate.js:278/280]
  DELIVERY U (sales-delivery-source.js:51)
  L8  SALES_ORDER U + SO_ITEMS U + DN rows [existing, sales-delivery-source.js:54]
  OQC, financial periods, Inventory / valuation / COGS
  COMMIT
```

#### 36.14.5 Corrected W7-C2 implementation boundary

§36.13.5 is superseded. The corrected scope moves `SALES_ORDER` from position 2 to the **last** position.

```text
W7-C2'  (supersedes W7-C2)
  file/function : server/modules/sales-orders.js — salesOrderAction()
  change class  : SALES_ORDER moves from :620 (immediately after transaction
                  begin) to AFTER the Credit and Gate phases.
  required      : (a) discovery + fast validation moved above :619, read-only
                  (b) L1 parent plan + assertion, optional when empty
                  (c) L2..L5 Credit, then L6/L7 gate
                  (d) SELECT sales_orders FOR UPDATE at the L8 position
                  (e) full revalidation of status, customer, salesperson, total,
                      business date and plan identities -> 409 STALE + rollback
                  (f) re-run :622-638 authoritative checks under the L8 lock
                  (g) status mutation, audit, idempotency unchanged
  unchanged     : RBAC (ORDERS_SUBMIT / ORDERS_APPROVE), SOD
                  (creator != approver at :648), HTTP contracts, idempotency
                  semantics, audit payloads
  reject/close/cancel : UNCHANGED — no Credit, no gate, still L8 only
  RBAC/SOD note  : authority checks remain exactly where they are; only lock
                  placement moves. No authority decision is deferred.
  preserves Req  : YES — lock placement only; every validation, status rule and
                  economic outcome is unchanged
  net effect     : no partial Credit or Gate evidence can survive a failed SO
                  mutation, because both are written after revalidation and
                  both roll back with the transaction
```

`W7-C1` is **not** affected — manual evaluation already conforms once parent-first is applied, since it takes neither Credit locks nor a Sales row lock.

#### 36.14.6 Updated race specifications

Fixtures M1–M12 from §36.12.8 stand. These additions target the parent-empty class specifically. **None executed; no PASS claimed.**

| # | Case | Barriers | Expected | Rollback / invariants |
|---|---|---|---|---|
| **M13** | **Empty parent set: SO Approve vs SD Confirm, same order** | T1 reaches L8; T2 reaches L3 | **under §36.13.5 ordering this MUST deadlock** — that is the point of the fixture. Under §36.14.3 both serialise on L2..L5 first | no deadlock; no committed Credit/Gate evidence from the loser |
| **M14** | **Empty parent set: SO Submit vs SD Confirm, same order** | same | same | same |
| **M15** | **Empty parent set: two salespersons, one customer aggregate** | both reach L3 | exactly one commits under `ONLY_ONE_FITS` (§36.8.1 preconditions) | capacity preconditions asserted before the race |
| **M16** | **Non-empty parent set: manual evaluation vs SO Submit, same order** | T1 at L1, T2 at L1 | serialised on L1 | no deadlock; one commit |
| **M17** | **Stale discovered parent set** | balance appears/closes between discovery and lock | 409 `SALES_PREPAYMENT_LOCK_PLAN_STALE` | whole tx rolls back; zero Credit rows, gate rows, audit rows |
| **M18** | **Concurrent newly created eligible prepayment** | balance inserted after discovery | `assertPrepaymentParentPlanCurrent` rejects; never silently locks a parent that appeared | no partial state |
| **M19** | **No-prepayment-required Credit Check** | no parent, no requirement | Credit reaches mandatory Profile resolution; a missing Profile fails closed at the pre-lock guard per §29.22.1, while an applicable Profile continues through the unchanged L2..L5 path | gate returns `NOT_REQUIRED` (`gate.js:190`); Credit gate NOT weakened |
| **M20** | **SO state revalidation fails after Credit/Gate calculation** | mutate SO between discovery and L8 | 409 STALE | **no committed Credit or Gate evidence**; no status change; no audit row |

Preconditions that make a reproduction impossible are stated rather than fabricated:

```text
- M15 REQUIRES a non-null credit limit on both scopes; if the aggregate limit is
  NULL (unbounded) the fixture cannot be constructed and must assert that
  instead of silently passing.
- M16/M1 REQUIRE a non-empty eligible parent set; with an empty set they
  degenerate to the M13/M14 class and must be reported as such rather than
  counted as coverage of the parent-locked path.
- M13/M14 REQUIRE that a delivery exists whose sales_order_id is the same order,
  because sales-delivery-source.js:54 locks the delivery's order.
```

#### 36.14.7 Boundary

No `document.md`, `AGENTS.md`, Wave 7 source, migration, Credit module, test or UI change. No database access. **No test executed; no MySQL or other gate PASS is claimed.** No Git write. W7-C1 and W7-C2′ remain future Implementation candidates requiring explicit user authorization; neither is applied. The 14-table schema, Dual-Limit Requirement, AR attribution, initial-rating provenance, migration DAG and MySQL FK-integrity contract are untouched by this closure. `W7_C1_C2_ACCEPTANCE_PASS` remains the Wave 10 prerequisite and now also covers W7-C2′.

**Status: `STAGE_C_EMPTY_PARENT_LOCK_CLOSED — AWAITING_EXTERNAL_DESIGN_REVIEW`.**

---

### 36.15 Credit Profile authorization data-scope reconciliation (2026-10-22)

#### 36.15.1 Authorization, scope and frozen protection

This section reconciles the Stage C Design to the approved Requirement `document.md §14.0–§14.9` under authorization `WAVE9_STAGE_C_BOUNDED_DATA_SCOPE_DESIGN` (AGENTS.md §4.3).

**Design only.** No source file, migration, test, UI asset or database was created or modified in this closure. `document.md` was not modified. No test, build or migration was executed. No Git write.

Preserved unchanged and explicitly **not** reopened: §13 Dual-Limit P1–P13; the 14-table physical allocation; the Wave 9 migration DAG and all six Wave 9 tables; initial-rating provenance; Finance AR attribution; policy snapshots; the §36.12–§36.14 lock-order remediation and the parent-independent lock contract; §36.14.5 W7-C2′ boundary. `LEGACY_DATA_EVIDENCE_PENDING` and `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` are unchanged.

**No new physical table, no `sales_group_id` column, no new role and no new permission code is authorized or proposed by this Design.**

Design vocabulary, defined once and used by every clause below:

```text
actor            the authenticated principal produced by app.js actorFromRow():
                 { id, username, displayName, roleId, roleName, roleCode, permissions }
actorHas(p)      sales-scope.js:4 — actor.roleCode === 'ADMIN' || actor.permissions.includes(p)
                 REUSED, not re-invented
```

#### 36.15.2 Requirement mapping AP1–AP4.1 → Design

| Requirement | Design element |
|---|---|
| **AP1** central Sales Credit ownership | §36.15.6 predicate is keyed on `salesperson_scope_key` only; no group key participates in any Credit authorization decision. Anchor identity (`creditObjectAnchorKey`) already encodes `CUSTOMER` + `SCOPE:AGGREGATE\|SCOPE:SALESPERSON` and never a sales group — §36.15.2.1 confirms it needs no change. |
| **AP2** enterprise-shared customer aggregate | §36.15.6 aggregate predicate is unconditional for any actor holding Credit read capability; `customer_commercial_extensions.default_sales_group_id` is **not consulted anywhere** in Credit authorization — §36.15.2.2. |
| **AP3** self-only sub-limit visibility | §36.15.4 modes `AGGREGATE_PLUS_SELF` / `AGGREGATE_ONLY` / `CROSS_GROUP` / `ALL`; §36.15.6 per-mode predicate applied to every read surface including detail-by-ID, nested ratings and effective-dated versions. Aggregate read is unconditional for `CREDIT_VIEW`; ineligibility yields `AGGREGATE_ONLY`, never a denial (§36.15.3 correction). |
| **AP4** Credit permission × cross-group scope | §36.15.4 read capability requires `CREDIT_VIEW`; `SALES_CROSS_GROUP` alone grants nothing and never implies `CREDIT_VIEW`. §36.15.4.2 records the `CREDIT_MANAGE`-as-read-fallback compatibility impact. |
| **AP4.1** central management write authority | §36.15.5 `requireCreditProfileManagement` — ADMIN **or** (`CREDIT_MANAGE` **and** `SALES_CROSS_GROUP`). Applied identically to Customer Aggregate and Salesperson Sub-Limit creation. |

##### 36.15.2.1 Anchor identity already satisfies AP1

`creditObjectAnchorKey()` (`credit-anchor.js:15`) builds
`CREDIT_OBJECT|{objectType}|{objectId}|CUSTOMER|{customer}|SCOPE:AGGREGATE` or
`...|SCOPE:SALESPERSON|{salespersonId}`.

It contains **no sales-group component**, and the unique key `uq_credit_lock_anchors_anchor_key` is therefore already group-free. **No anchor re-keying is required or authorized.** AP1 is satisfied by construction, not by a new index or column.

##### 36.15.2.2 The customer default Sales Group must not enter Credit authorization

`customer_commercial_extensions.default_sales_group_id` is nullable and effective-dated (`sales-customer-wave1-foundation.js:87`). Under AP2 clause 4 it is a commercial default, not an authorization ownership key.

**Design rule:** no Credit read or write predicate may JOIN `customer_commercial_extensions`, `salesperson_group_memberships` or `sales_groups` to decide *which customer* is in scope. Membership is consulted for **actor self-scope eligibility only** (§36.15.3), never to partition the customer set. Consequences:

- A customer with **no** default group is fully readable and administrable (A4).
- A customer shared across **two** groups yields exactly **one** aggregate profile, read identically by every authorized actor (A5).
- The aggregate ceiling is never split by group (§13.1 P1 intact).

##### 36.15.2.3 `sales_group_data_scope_enabled` must NOT gate Credit

`sales_parameters.sales_group_data_scope_enabled` (`sales-customer-wave1-foundation.js:45`) governs Quotation / SO / report scope under SC06. `assertGroupScope` (`sales-scope.js:21`) fails closed with `SALES_GROUP_SCOPE_DISABLED` when it is false.

**Design rule:** the Credit resolvers **must not** read that parameter. If Credit inherited it, `FALSE` would deny every salesperson self-scope (wrong) and any future "FALSE = cross-visible" reading would expose every sub-limit (catastrophic). Credit self-scope depends only on `CREDIT_VIEW`, a valid active salesperson, an active effective membership and `SALES_CROSS_GROUP`.

#### 36.15.3 Canonical identity chain and effective-membership semantics

```text
actor.user_id
  -> salesperson_profiles.user_id = actor.id            (UNIQUE, nullable)
  -> salesperson_profiles.active = 1                   (inactive => unmapped)
  -> salesperson_profiles.id = :selfSalespersonId
  -> salesperson_group_memberships.salesperson_id = :selfSalespersonId
       AND active = 1
       AND effective_from <= :businessDate
       AND (effective_to IS NULL OR effective_to >= :businessDate)
     joined sales_groups.active = 1
```

| Condition | Self-scope eligibility | Design outcome |
|---|---|---|
| No `salesperson_profiles` row for `actor.id` | **ineligible** | resolve mode `AGGREGATE_ONLY`; self sub-limit **not** in scope (N6) |
| `salesperson_profiles.active = 0` | **ineligible** | resolve mode `AGGREGATE_ONLY`; self sub-limit **not** in scope (N6) |
| Membership row exists but `active = 0` | **ineligible** | resolve mode `AGGREGATE_ONLY`; self sub-limit **not** in scope (N7) |
| Membership `effective_to` < business date | **ineligible** | resolve mode `AGGREGATE_ONLY`; self sub-limit **not** in scope (N7) |
| Membership `effective_from` > business date | **ineligible** | resolve mode `AGGREGATE_ONLY`; self sub-limit **not** in scope (N7) |
| Joined `sales_groups.active = 0` | **ineligible** | resolve mode `AGGREGATE_ONLY`; self sub-limit **not** in scope (N7) |
| **Multiple** valid memberships | **eligible** | mode `AGGREGATE_PLUS_SELF`; self-scope granted **once**. Membership count does **not** multiply visibility (N11, AP3). |
| Zero memberships | **ineligible** | resolve mode `AGGREGATE_ONLY` |
| Customer has no default Sales Group | **irrelevant** | aggregate remains readable and administrable (A4, AP2) |

> **CORRECTED 2026-10-22 — the original text of this table is superseded.** External review found that the first version of this table mapped self-scope ineligibility to a **global `403 CREDIT_ACTOR_UNMAPPED` / `CREDIT_ACTOR_MEMBERSHIP_INVALID` denial of the whole request**. That was **incorrect** and is recorded here rather than erased, because it demonstrates the exact failure mode the correction exists to prevent:
>
> ```text
> BROKEN (superseded):
>   no valid salesperson identity -> 403 the entire read
>
> CORRECT (active):
>   no valid salesperson identity -> mode AGGREGATE_ONLY
>                                     aggregate still readable
>                                     self sub-limit simply not in scope
> ```
>
> Authority for the correction, from the approved Requirement:
>
> - `document.md §14.4` row 3 — "Reviewer / Accounting + `CREDIT_VIEW`" is **ALLOW** for *Customer aggregate READ* and **DENY** only for *Own sub-limit READ*.
> - `document.md §14.4` row 6 — the **only** actor whose aggregate read is DENY is "Actor without any Credit capability".
> - `document.md §14.5` N6 / N7 — the DENY attaches to what the actor *"claims"*: "Unmapped or inactive salesperson identity **claims self-scope visibility** | DENY" and "Expired or invalid applicable group membership **claims self-scope eligibility** | DENY". Both deny a **self-scope claim**, not the already-authorized aggregate privilege.
> - `document.md §14.2` AP3 — for `CREDIT_VIEW` the first table row is "Customer Aggregate Profile | **readable**", stated without any identity precondition.
> - `document.md §14.8` item 4 required Stage C to "define self-scope **eligibility**" — eligibility, not request authorization.
>
> The superseded reading also contradicted this Design's own §36.15.8, which already stated that an unmapped actor "sees aggregate rows only". §36.15.3 and §36.15.4 were the defective clauses; §36.15.8 was correct and is now consistent with them.

**Ineligibility never denies the request.** It removes exactly one privilege: the actor's own Salesperson Sub-Limit. The Customer Aggregate privilege is granted by `CREDIT_VIEW` alone and is unaffected by the actor's salesperson identity, membership or the customer's default Sales Group.

**No substitution is permitted.** When ineligible, the resolver binds **no** salesperson identity. It must not fall back to the customer's default Salesperson, to the row creator, to the last modifier, to a single arbitrary membership, or to any sentinel value. `document.md §14.2` AP1 forbids exactly these ownership substitutions.

`is_default` is deliberately **not** consulted. Membership is an authorization-context fact under AP1, never an ownership marker.

**Business-date semantics for reads.** Membership is evaluated at `businessDate` when the caller supplies one (already an accepted query parameter on `GET /api/credit/profiles`), otherwise at the current server date. This is **not** an authorization bypass: a caller can only shift the window under which *their own* self-scope is evaluated, and self-scope only ever grants access to that caller's own sub-limit, which AP3 grants unconditionally to a valid identity. The aggregate predicate is date-independent.

**Engine functions are exempt.** `resolveEffectiveCreditProfile()` (`credit-profile.js:44`), `resolveCreditParameter()`, `resolveCreditRule()` and `ensureCreditPolicySnapshot()` take no `actor` and **must not** acquire the read predicate. Per `document.md §14.3` the future Credit Control engine must evaluate **all** mandatory customer and salesperson scopes regardless of who is asking. A human's read permission may never weaken a mandatory backend Credit Check.

#### 36.15.4 Canonical read-scope resolver

One resolver, one predicate fragment per mode, every read surface. Signature:

```text
resolveCreditProfileReadScope(db, actor, { businessDate })
  -> { mode, selfSalespersonId | null, predicateSql, predicateArgs }
```

**Five** modes. The four-mode resolver of the first draft **cannot** express the approved contract safely: it had no result for "`CREDIT_VIEW` present but self-scope ineligible", and the draft answered that state with a global 403. `AGGREGATE_ONLY` is therefore added as an explicitly defined result mode.

| # | Mode | Condition (evaluated strictly in order) | Predicate | HTTP |
|---|---|---|---|---|
| 1 | `ALL` | `actor.roleCode === 'ADMIN'` | **none** — bypass data scope only | 200 |
| 2 | `DENY` | not `actorHas(actor, 'CREDIT_VIEW')` | — | **403 `CREDIT_SCOPE_DENIED`** (N4) |
| 3 | `CROSS_GROUP` | `CREDIT_VIEW` **and** `actorHas(actor, 'SALES_CROSS_GROUP')` | **none** — cross-group read (A6) | 200 |
| 4 | `AGGREGATE_PLUS_SELF` | `CREDIT_VIEW`, no `SALES_CROSS_GROUP`, **self-scope eligible** (§36.15.3) | `(cp.salesperson_scope_key='*' OR cp.salesperson_scope_key=:selfSalespersonId)` | 200 |
| 5 | `AGGREGATE_ONLY` | `CREDIT_VIEW`, no `SALES_CROSS_GROUP`, **self-scope ineligible** | `cp.salesperson_scope_key='*'` | 200 |

**Mode 2 is the only global denial in the read path.** Every other mode returns `200` with a filtered result set. This is the corrected contract required by `document.md §14.4` row 3 and rows 5-6.

Order is load-bearing:

1. `ALL` is evaluated **first**, so ADMIN is never denied for lacking a literal `CREDIT_VIEW`.
2. `DENY` is evaluated **before** `CROSS_GROUP`, so `SALES_CROSS_GROUP` can never lift an actor without a Credit capability (AP4, N4).
3. `AGGREGATE_ONLY` is the **terminal fallback** for any `CREDIT_VIEW` holder that reaches modes 3 and 4 — it is never an error path.

##### 36.15.4.0 Superseded four-mode table

The superseded table is preserved verbatim below as evidence of the defect. It is **not** the active contract.

```text
| Mode | Condition (evaluated in order) | Predicate |
| ALL       | CREDIT_VIEW false and roleCode ADMIN          | none |
| DENY      | not CREDIT_VIEW                              | 403 CREDIT_SCOPE_DENIED (N4) |
| CROSS_GROUP | CREDIT_VIEW and SALES_CROSS_GROUP           | none (A6) |
| AGGREGATE_PLUS_SELF | CREDIT_VIEW, no SALES_CROSS_GROUP |
              (cp.salesperson_scope_key='*' OR ... =:self) AFTER §36.15.3 ELIGIBILITY |
```

Failure: `AGGREGATE_PLUS_SELF` was the only non-admin, non-cross-group mode, and its eligibility precondition threw. An unmapped, inactive or expired-membership actor therefore received **403 for the whole request**, losing the Customer Aggregate read that `document.md §14.4` row 3 grants.

##### 36.15.4.1 ADMIN bypass boundary

`ALL` skips **data-scope filtering only**. It does not skip: effective-date validation, version-uniqueness and overlap rejection (`closePredecessorAndAssertNoOverlap`), rating provenance, transaction integrity, idempotency, audit, or SOD. ADMIN write additionally requires `requireCreditProfileManagement` (§36.15.5), which ADMIN satisfies.

##### 36.15.4.2 `CREDIT_MANAGE`-as-read-fallback: compatibility impact

All three Wave 9 modules currently declare `const VIEW = ['CREDIT_VIEW', 'CREDIT_MANAGE']` (`credit-profile.js:9`, `credit-anchor.js:7`, `credit-policy.js:9`) and admit reads with `allowAny(actor, VIEW)`. The canonical registry (`server/db.js`) is **flat** and defines **no** permission-to-permission implication, so this is an implementation arrangement, not a registry fact.

`document.md §14.4` constraint 1 forbids the matrix from silently granting read to `CREDIT_MANAGE` holders. **The correction is therefore to stop treating `CREDIT_MANAGE` as a read fallback in the Credit Profile, Anchor, Parameter and Rule readers.**

**Compatibility impact, verified against the seeded roles:**

| Role | Permissions of interest | Read before | Read after | Change |
|---|---|---|---|---|
| `role-admin` | all, incl. `CREDIT_VIEW` | allow | allow (`ALL`) | none |
| `role-sales` | `CREDIT_VIEW`, `CREDIT_MANAGE` | allow | allow (`AGGREGATE_PLUS_SELF`) | none for read; **narrows** to aggregate + self |
| `role-reviewer` | `CREDIT_VIEW`, `SALES_CROSS_GROUP` | allow | allow (`CROSS_GROUP`) | none |
| `role-accounting` | `CREDIT_VIEW` | allow | allow (`AGGREGATE_PLUS_SELF`) | **narrows** — reviewer/accounting have no salesperson mapping, so they cannot self-scope and see aggregate only |
| `role-warehouse` | none | 403 | 403 | none |

**No seeded role loses Credit read access**, because every seeded role holding `CREDIT_MANAGE` also holds `CREDIT_VIEW`. The Parameter and Rule readers may keep their existing capability set if Stage D prefers a strictly smaller diff; the Profile and Anchor readers are the ones `document.md §14` binds. The Design requires the Profile and Anchor readers to drop the `CREDIT_MANAGE` fallback and leaves the Parameter/Rule readers explicitly unchanged (§36.15.7) so that no unrelated endpoint is silently tightened.

#### 36.15.5 Canonical write-authority resolver

```text
requireCreditManagementAuthority(actor, { surface })
  1. actor.roleCode === 'ADMIN'                      -> ALLOW
  2. actorHas(actor,'CREDIT_MANAGE')
     && actorHas(actor,'SALES_CROSS_GROUP')          -> ALLOW
  3. otherwise                                      -> 403 CREDIT_MANAGEMENT_DENIED
```

> **SUPERSEDED IN PART 2026-10-22.** This resolver was first specified as `requireCreditProfileManagement(db, actor)` for Profile and Anchor surfaces only. Approved `document.md §15` **AP5** states the **identical** condition for global Parameter and Rule writes, so a **single** helper now serves all four write surfaces and the unused `db` parameter is dropped. The condition itself is unchanged; see §36.15.7.2.

| Actor | Result | Requirement |
|---|---|---|
| ADMIN | ALLOW | §14.4 row 1 |
| `CREDIT_MANAGE` + `SALES_CROSS_GROUP` | ALLOW | §14.4 row 5, A7 |
| `CREDIT_MANAGE` only (e.g. `role-sales`) | **DENY** | AP4.1, N3 |
| `CREDIT_VIEW` only (`role-reviewer`, `role-accounting`) | **DENY** | N5 |
| `SALES_CROSS_GROUP` without `CREDIT_MANAGE` | **DENY** | AP4, N4 |
| Unauthenticated / not a valid actor | **DENY** — `authenticate()` already throws 401 before dispatch | AP4 |

**Same decision for both scopes.** `POST /api/credit/profiles` applies this resolver **before** reading the body, so the `salespersonId` in the payload is irrelevant to the write-authority decision. There is no separate "self-profile" write path: an ordinary salesperson has **no** endpoint, alternative route or payload variant that raises their own sub-limit (AP4.1, N2). `POST /api/credit/anchors/provision` uses the same resolver (N10).

The authorized writer still satisfies, unchanged: `assertDateRange`; `closePredecessorAndAssertNoOverlap` version and overlap rejection; `assertReferences`; `INITIAL_ASSIGNED` rating provenance; `transaction()`; `idempotencyReplay` / `saveIdempotency`; `audit`; and the §36.14.3 lock order (L2→L3→L5).

**Operational consequence to record for the reviewer.** Among seeded roles only `role-admin` holds `CREDIT_MANAGE` **and** `SALES_CROSS_GROUP`. After this Design is implemented, `role-sales` is **DENY** on Profile write and Anchor provisioning. That is the intended AP4.1 outcome, not an incidental regression; a production role eligible for centralized Credit Profile administration must be granted both permissions.

#### 36.15.6 Data-scope predicate contract

Predicate fragment per mode, applied as an **additional** conjunct to every Profile read:

```sql
-- ALL           (ADMIN)                          : no fragment
-- CROSS_GROUP                               (3)  : no fragment
-- AGGREGATE_ONLY                            (5)  : AND cp.salesperson_scope_key = '*'
-- AGGREGATE_PLUS_SELF                      (4)  : AND ( cp.salesperson_scope_key = '*'
--                                                   OR cp.salesperson_scope_key = :selfSalespersonId )
```

`salesperson_scope_key` is the correct key because the `credit_profile` DDL CHECK (`sales-customer-wave9-credit-foundation.js:96`) constrains
`(salesperson_scope_key='*' AND salesperson_id IS NULL) OR (salesperson_scope_key<>'*' AND salesperson_id IS NOT NULL AND salesperson_scope_key=salesperson_id)`,
so `salesperson_scope_key='*'` is **exactly** the Customer Aggregate scope. Both fragments are precise, index-friendly expressions and are served by `ix_credit_profile_customer_scope(customer_id, salesperson_scope_key, effective_from)`.

##### 36.15.6.1 No value can broaden the scope (structural guarantee)

The risk in `AGGREGATE_ONLY` is that a placeholder is supplied with no valid value and silently widens visibility. The Design forecloses this structurally rather than by convention:

```text
1. AGGREGATE_ONLY emits a CONSTANT fragment containing NO bind parameter at all.
   There is no :selfSalespersonId to fill incorrectly, so no substitution can
   broaden it.

2. The fragment and its args are produced by resolveCreditProfileReadScope as a
   matched pair. predicateArgs is [] for ALL / CROSS_GROUP / AGGREGATE_ONLY and
   exactly [selfSalespersonId] for AGGREGATE_PLUS_SELF. A fragment/args mismatch
   is a programming error and must throw, not degrade.

3. :selfSalespersonId MUST be a non-empty string drawn from
   salesperson_profiles.id and MUST NOT equal '*'. Binding '*' would collapse
   AGGREGATE_PLUS_SELF into AGGREGATE_ONLY; binding NULL would make the second
   disjunct evaluate to NULL (never true) and silently narrow. Both are asserted
   at resolve time.

4. Unresolved identity MUST NOT fall back to the customer's default salesperson,
   the row creator, the last modifier, or any other salesperson. When identity is
   ineligible the resolver emits AGGREGATE_ONLY (AP1).

5. The customer default Sales Group is never consulted for authorization
   (§36.15.2.2), so it cannot become an implicit :selfSalespersonId.
```

Note on SQL three-valued logic, recorded because it is the trap this guard exists for: a NULL bound to `salesperson_scope_key = :self` yields `NULL`, not `TRUE`, so that disjunct contributes nothing and the row set **narrows**. The genuinely dangerous direction is therefore a **sentinel `'*'`**, which would make the disjunct `salesperson_scope_key='*'` and, combined with any negated form, could expose every sub-limit. Guard 3 forbids it explicitly.

| Read surface | Current code | Required predicate placement | Requirement |
|---|---|---|---|
| Collection `GET /api/credit/profiles` | `credit-profile.js:69` — **no scope** | append to the same `filters` array before `prepare`, so caller filters **and** scope apply in one statement | A2, A3, N1 |
| Detail by ID `GET /api/credit/profiles/:id` | `credit-profile.js:76` — `WHERE id=?` only | `WHERE id=?` **AND** scope predicate, single statement | N8 |
| Effective-dated version lookup | `credit-profile.js:63-67` | caller `businessDate` filter and scope predicate are **independent conjuncts**; neither replaces the other | A2/A3 on a given date |
| Nested rating history | `credit-profile.js:78` | ratings are reachable **only** through a profile that already passed the predicate; no independent rating route exists in Wave 9 | N9 |
| `resolveEffectiveCreditProfile()` | `credit-profile.js:44` | **no predicate — by design** (engine, §36.15.3) | §14.3 Wave 10 mandatory evaluation |

**Direct-ID enumeration defence (N8).** A restricted row and a non-existent row must be **indistinguishable**. The Design mandates:

```text
row returned            -> 200 with the projected profile
row exists, restricted  -> 404 CREDIT_PROFILE_NOT_FOUND
row does not exist      -> 404 CREDIT_PROFILE_NOT_FOUND
```

Not `403`. Returning `403` for restricted-but-present would confirm existence and turn the detail endpoint into an enumeration oracle; that is exactly the outcome `document.md §14.5` N8 forbids. The message body is a fixed string and never echoes the restricted row's customer, salesperson, limit, rating or date.

**List/detail parity.** The predicate fragment is a single shared constant produced by `resolveCreditProfileReadScope`. Collection and detail call the same resolver and interpolate the same fragment, so a row that the collection would hide is unreachable by ID by construction rather than by two parallel implementations that could drift.

**Filter interaction.** A caller supplying `salespersonId=<other>` receives an empty set under **every** mode, not a `403` and not the other row: the caller filter and the scope predicate intersect. Under `AGGREGATE_ONLY` a `salespersonId` filter can never match, because the mode's fragment admits only `'*'`. This keeps query semantics stable across roles and leaks nothing.

#### 36.15.7 Cross-endpoint authorization matrix

Nine existing Wave 9 foundation routes (`app.js:581-589`), plus the Wave 10 reserved surface.

| # | Route | Category | Read | Write | Predicate / resolver |
|---|---|---|---|---|---|
| 1 | `GET /api/credit/policy/parameters` | **1. Global configuration** | `requireCreditConfigurationRead` (ADMIN or `CREDIT_VIEW`) | — | §36.15.7.2 |
| 2 | `POST /api/credit/policy/parameters` | **1. Global configuration** | — | `requireCreditManagementAuthority` (ADMIN or `CREDIT_MANAGE` **and** `SALES_CROSS_GROUP`) | §36.15.7.2, §36.15.7.3 |
| 3 | `GET /api/credit/policy/rules` | **1. Global configuration** | `requireCreditConfigurationRead` (ADMIN or `CREDIT_VIEW`) | — | §36.15.7.2 |
| 4 | `POST /api/credit/policy/rules` | **1. Global configuration** | — | `requireCreditManagementAuthority` (ADMIN or `CREDIT_MANAGE` **and** `SALES_CROSS_GROUP`) | §36.15.7.2, §36.15.7.3 |
| 5 | `GET /api/credit/anchors` | **3. Sensitive anchor identity** | `CREDIT_VIEW` **and** `SALES_CROSS_GROUP` (+ADMIN) | — | full denial for ordinary salespersons, **not** a narrowed list — §36.15.7.1 |
| 6 | `POST /api/credit/anchors/provision` | **3. Sensitive anchor identity** | — | `requireCreditManagementAuthority` | N10 |
| 7 | `GET /api/credit/profiles` | **4. User-facing Profile read** | `resolveCreditProfileReadScope` | — | §36.15.6 |
| 8 | `POST /api/credit/profiles` | **2. Central Profile administration** | — | `requireCreditManagementAuthority` | A7, N2, N3 |
| 9 | `GET /api/credit/profiles/:id` | **4. User-facing Profile read** | `resolveCreditProfileReadScope` | — | predicate in the ID statement; 404 parity, N8, N9 |
| 10 | `POST /api/credit/check` *(Wave 10, reserved)* | **5. Internal Credit Check service** | **no human read scope** | — | engine evaluates **all** mandatory scopes, §36.15.3 |

> **ROWS 1-4 SUPERSEDED 2026-10-22.** The prior text specified `CREDIT_MANAGE` (+ADMIN) for rows 2 and 4, justified by `document.md §14.3` categories 1 and 2. Approved **`document.md §15` AP5** supersedes that basis; see §36.15.7.2 for the authoritative contract and §36.15.12 for the resolution record. The superseded text is preserved verbatim in §36.15.7.5.

##### 36.15.7.1 Why anchors escalate rather than filter

`credit_lock_anchors` rows carry `customer_id` and `salesperson_id`. Under AP3 an ordinary salesperson must not learn other salespersons' sub-limit identities, and AP1 forbids deriving any Credit visibility rule from group membership. A "show only anchors in my group" rule would therefore require **the group-ownership model AP1 rejects**. The Design therefore escalates the whole endpoint:

```text
GET /api/credit/anchors   requires CREDIT_VIEW and SALES_CROSS_GROUP (ADMIN exempt)
                         ordinary salesperson -> 403 CREDIT_SCOPE_DENIED
                         the endpoint is not narrowed to a subset for them
```

Cross-group anchor inventory is an administrative inventory concern, consistent with §36.9.2's existing "`anchor inventory (admin)`" annotation. Provisioning is additionally central-only, so `CREDIT_MANAGE` alone can no longer create or probe anchors for another group's customer (N10).

##### 36.15.7.2 Canonical global-configuration authorization contract (AP5)

Approved Requirement: `document.md §15` — AP5 Centralized Global Credit Configuration Authority.

**READ — one rule, both GET surfaces:**

```text
requireCreditConfigurationRead(actor)
  ALLOW if  actor.roleCode === 'ADMIN'  OR  actorHas(actor, 'CREDIT_VIEW')
  otherwise  403 CREDIT_PERMISSION_DENIED
```

```text
CREDIT_MANAGE alone            MUST NOT grant READ.
SALES_CROSS_GROUP alone        MUST NOT grant READ.
CREDIT_MANAGE + SALES_CROSS_GROUP without CREDIT_VIEW   MUST NOT grant READ.
ADMIN remains authorized.
CREDIT_VIEW-only actors may read.

READ and WRITE are independent. READ is not inferred from WRITE and WRITE is
not inferred from READ. No permission-to-permission implication is created.
```

**WRITE — one rule, both POST surfaces:**

```text
requireCreditManagementAuthority(actor, { surface })
  ALLOW if  actor.roleCode === 'ADMIN'
        OR ( actorHas(actor,'CREDIT_MANAGE') AND actorHas(actor,'SALES_CROSS_GROUP') )
  otherwise  403 CREDIT_MANAGEMENT_DENIED
```

The condition is a logical **AND**, not OR. It applies to every mutation that changes the effective meaning of global Credit configuration:

```text
- creating a Parameter configuration or a new effective Parameter version
- creating a Credit Rule or a new effective Rule version
- Credit Management enabled / disabled changes (CREDIT_MANAGEMENT_ENABLED)
- control timing changes        - control strength changes
- BLOCK <-> WARNING changes     - rule stage / scenario / credit item changes
- any other mutation of globally effective Credit configuration
```

`CREDIT_MANAGE` alone **must not** mutate global configuration. `SALES_CROSS_GROUP` must **not** be silently added to the Sales role to preserve prior behavior. No new permission and no new role is created.

**One helper, not duplicated conditionals.** AP4.1 (Profile and Anchor) and AP5 (Parameters and Rules) state the **identical** condition. A single `requireCreditManagementAuthority(actor, { surface })` in `server/modules/credit-scope.js` serves all four write surfaces, replacing the previously proposed `requireCreditProfileManagement`. The `surface` label only selects the error code; it keeps the two Requirement provenances (AP4.1 vs AP5) explicit so a later Requirement change to one does not silently alter the other.

**Effective authorization matrix for rows 1-4** (from `document.md §15.4`):

| Actor | READ (1, 3) | WRITE (2, 4) |
|---|---|---|
| ADMIN | ALLOW | ALLOW |
| `CREDIT_VIEW` only | ALLOW | DENY |
| `CREDIT_MANAGE` only | DENY | DENY |
| `CREDIT_VIEW` + `CREDIT_MANAGE` | ALLOW | DENY |
| `CREDIT_VIEW` + `SALES_CROSS_GROUP` | ALLOW | DENY |
| `CREDIT_MANAGE` + `SALES_CROSS_GROUP`, without `CREDIT_VIEW` | **DENY** | **ALLOW** |
| all three | ALLOW | ALLOW |
| `SALES_CROSS_GROUP` only | DENY | DENY |
| no Credit permissions | DENY | DENY |

**Compatibility note.** Dropping the `CREDIT_MANAGE` read fallback is **non-regressive for every seeded role**: in `server/db.js`, every role holding `CREDIT_MANAGE` (`role-sales`, `role-admin`) also holds `CREDIT_VIEW`. `role-sales` **keeps** configuration READ and **loses** configuration WRITE. `role-reviewer` keeps READ. `role-accounting` keeps READ. Only `role-admin` among seeded roles can write.

**Profile isolation.** AP5 touches rows 1-4 only. It does **not** alter the AP1–AP4.1 Profile ownership model, the five read-scope modes of §36.15.4, or the direct-ID 404 non-enumeration contract of §36.15.6. No Profile predicate changes.

##### 36.15.7.3 Authorization before side effects

**Verified in the current source:** both writers already authorize *before* every side effect.

```text
createCreditParameter  credit-policy.js:108  allow(actor,'CREDIT_MANAGE')
  :109  readJson                       :117  idempotency key
  :110  assertAllowedFields            :118  request fingerprint
  :111-116 validation                  :121  transaction( begin
  :122  idempotencyReplay   <- CONSUMED :124  lockGlobalPolicy
  :125  closePredecessorAndAssertRange <- PREDECESSOR MUTATED
  :127-132 INSERT + superseded_by_id   :134  audit  :135  saveIdempotency

createCreditRule       credit-policy.js:152  allow(actor,'CREDIT_MANAGE')
  :153  readJson                       :169  idempotency key
  :154  assertAllowedFields            :170  request fingerprint
  :155-168 validation                  :173  transaction( begin
  :174  idempotencyReplay   <- CONSUMED :176  lockGlobalPolicy
  :177  closePredecessorAndAssertRange <- PREDECESSOR MUTATED
  :179-183 INSERT                      :185  audit  :186  saveIdempotency
```

The AP5 correction therefore requires **no reordering**. It is a predicate substitution at the existing first line of each writer. The required guarantee already holds structurally:

```text
denied POST  ->  explicit 403
             ->  ZERO Parameter / Rule changes
             ->  ZERO predecessor-version changes (nothing was reached)
             ->  ZERO successful business audit rows
             ->  ZERO successful idempotency records (replay never reached)
             ->  NO partial state, no transaction opened, no lock taken
```

The check **must stay above `readJson`**: rejecting before body parsing keeps the denial independent of payload validity, so a malformed body from an unauthorized actor still returns a permission denial rather than a validation error.

For **authorized** requests nothing changes: effective-date validation, predecessor closing, overlap rejection, transaction integrity, `audit` and `saveIdempotency` all execute exactly as today. No Credit business calculation changes.

##### 36.15.7.4 Internal Credit resolver independence

```text
resolveCreditParameter()   credit-policy.js:89
resolveCreditRule()        credit-policy.js:93
effectiveRows()            credit-policy.js:82
ensureCreditPolicySnapshot() credit-policy.js:192
```

All four take **no `actor` parameter** and must remain so. They are internal authoritative-configuration resolvers, not human-facing GET endpoints.

```text
Future Wave 10 Credit Check MUST evaluate mandatory Credit controls
regardless of any human actor's permission to read configuration.

No actor-specific visibility filtering may be added to these functions.

Wave 10 is neither implemented nor authorized by this Design.
```

A human's READ denial on `GET /api/credit/policy/rules` must never make a mandatory BLOCK rule inapplicable. S15 and §29.22.1 depend on that separation.

##### 36.15.7.5 Superseded rows 1-4 (preserved verbatim)

```text
| 1 | GET /api/credit/policy/parameters | 1. Global configuration | CREDIT_VIEW (+ADMIN) | — |
      none - §14.3 cat. 1 "existing frozen contract governs" |
| 2 | POST /api/credit/policy/parameters | 1. Global configuration | — | CREDIT_MANAGE (+ADMIN) |
      unchanged - Profile scope deliberately not applied |
| 3 | GET /api/credit/policy/rules | 1. Global configuration | CREDIT_VIEW (+ADMIN) | — | none |
| 4 | POST /api/credit/policy/rules | 1. Global configuration | — | CREDIT_MANAGE (+ADMIN) | unchanged |

"Rules 4 and 2 are deliberately not tightened: document.md §14.3 categories 1 and 2
 record that the existing frozen contract governs Parameters and Rules and that
 this policy creates no new mutation right over them. Applying Profile data-scope
 to global configuration would be an unauthorized scope expansion."
```

This text is retained as the historical record of the position taken **while AP5 was still undecided**. It is no longer active. The underlying reasoning was correct at the time: Design may not create business policy, and `document.md §14.3` genuinely declined to decide this question. The decision has since been made at Requirement stage by the user.

#### 36.15.8 Sensitive-data and leak-surface contract

| Surface | Contract |
|---|---|
| Rating history | Reachable only via a Profile that passed the predicate. `credit_profile_ratings` has **no** independent Wave 9 route. When Wave 11 adds evaluation routes, any rating projection must re-acquire §36.15.4 rather than assume the parent gate still holds. |
| Evaluation references | `credit_profile_ratings.evaluation_result_id` is Wave 9 `NULL` and Wave 11 territory; inherits the parent gate. |
| Anchor metadata | Escalated per §36.15.7.1. `anchor_key` embeds `CUSTOMER|{customerId}|SCOPE:SALESPERSON|{salespersonId}` and is therefore itself restricted data. |
| Error messages | Authorization denials return a fixed message plus a stable `code`. Denials never echo customer id, salesperson id, limit, rating or effective dates of a restricted row. `CREDIT_PROFILE_NOT_FOUND` carries no detail. |
| Expanded / nested payloads | `present()` (`credit-profile.js:28`) is reached only after the predicate. Any future field addition must not re-derive scope from the payload. |
| Direct object-ID | 404 parity, §36.15.6. |
| Frontend | `credit-foundation.jsx` has **no** permission gating: all three tabs and their create forms render unconditionally. Hiding them is a UX correctness obligation, **never** a security boundary (`document.md §14.2` AP3, `§34.7` SC114 "frontend hidden is NOT authorization"). |

**Non-enumeration is preserved for `role-accounting` and any unmapped actor:** an actor that cannot self-scope resolves to mode `AGGREGATE_ONLY`, sees aggregate rows only, and receives `404` — not `403` — for another salesperson's sub-limit detail, so it cannot probe which customer/salesperson pairs exist. **This clause was correct in the first draft and is the reason §36.15.3 / §36.15.4 have been corrected to match it**; the two sections were internally inconsistent until this correction.

#### 36.15.9 Compatibility with current Wave 9 and future Wave 10/11

**Preserved by this Design:** six Wave 9 tables and every index; `salesperson_scope_key` normalized scope and its CHECK; `creditObjectAnchorKey` format and `uq_credit_lock_anchors_anchor_key`; effective-date versioning, predecessor closing and overlap rejection; `INITIAL_ASSIGNED` rating provenance and immutable rating rows; policy snapshot fingerprint and reuse; the §36.14.3 lock order and §36.14.5 W7-C2′ boundary; idempotency document identities (`CREDIT_PROFILE_CREATE`, `CREDIT_ANCHOR_PROVISION`) — none of which encode an actor, so no idempotency key changes.

**Authorized reads/writes remain compatible with versioning and transactions** because authorization is evaluated **before** `transaction()` in every mutating path, and the resolver issues no write and takes no lock. Inside the transaction the existing sequence L2 → L3 → L5, overlap rejection, rating insert, audit and `saveIdempotency` are untouched. A denial happens before any lock is acquired, so a denied mutation holds no row, leaves no partial state and needs no compensating rollback (N12).

**Wave 10 impact — contract fixed now, engine built later:** `resolveEffectiveCreditProfile()` stays actor-free and unfiltered, so the Wave 10 engine continues to evaluate every mandatory customer and salesperson scope. `POST /api/credit/check` is categorized as an internal service surface, **not** a human-facing Profile read; it is not authorized by this Design and no code for it is created. Wave 10 may not use the human read predicate to decide which scopes a Credit Check evaluates.

**Wave 11 impact:** rating and evaluation projections inherit the parent predicate and must re-acquire §36.15.4 at their own surface.

**Regression surface to expect at Stage D:** `sales-customer-wave9-credit-foundation.test.js` uses
`MANAGER = { id:'user-admin', permissions:['CREDIT_VIEW','CREDIT_MANAGE'] }` (line 14) with **no `roleCode`** and **no `SALES_CROSS_GROUP`**. Under §36.15.5 that actor is **DENY** on every write, so the existing write-path tests will fail until the fixture is corrected to a genuinely authorized administrator. This is an intended consequence of AP4.1, recorded here so Stage D does not mistake it for a product defect.

#### 36.15.10 Stage D implementation handoff map

Not implemented by this record. Smallest required source modifications:

| Area | Existing function / file | Required behavior | Future bounded change | Tests |
|---|---|---|---|---|
| Scope resolver | **new** `server/modules/credit-scope.js` | `resolveCreditProfileReadScope`; `requireCreditConfigurationRead`; **one** `requireCreditManagementAuthority(actor,{surface})` shared by all four write surfaces (replaces the proposed `requireCreditProfileManagement`); reuse `actorHas` from `sales-scope.js:4` | **New file, ~85 lines.** No new table, column, role or permission code | T-P1..T-P6, T-G* |
| Config read helper | `credit-policy.js:9` `const VIEW=['CREDIT_VIEW','CREDIT_MANAGE']` | delete the read-fallback constant; reads are gated by `requireCreditConfigurationRead` | remove line | T-G3, T-G4, T-G8 |
| Parameters GET | `listCreditParameters` `credit-policy.js:97` | `:98` `allowAny(actor, VIEW)` → `requireCreditConfigurationRead(actor)` | 1 line | T-G1..T-G5, T-G8, T-G12 |
| Rules GET | `listCreditRules` `credit-policy.js:141` | `:142` `allowAny(actor, VIEW)` → `requireCreditConfigurationRead(actor)` | 1 line | T-G1..T-G5, T-G8, T-G12 |
| Parameters POST | `createCreditParameter` `credit-policy.js:107` | `:108` `allow(actor,'CREDIT_MANAGE')` → `requireCreditManagementAuthority(actor,{surface:'CREDIT_CONFIGURATION'})`, **staying above `readJson` at :109** | 1 line, no reordering (§36.15.7.3) | T-G1, T-G5, T-G6, T-G7, T-G10, T-G13, T-G14 |
| Rules POST | `createCreditRule` `credit-policy.js:151` | `:152` same substitution, **staying above `readJson` at :153** | 1 line, no reordering | T-G2, T-G11, T-G13, T-G14 |
| Profile read | `listCreditProfiles` `credit-profile.js:55` | `allowAny(actor, VIEW)` → resolver; drop `CREDIT_MANAGE` fallback; append predicate to `filters` | ~8 lines | T-P2, T-P4, T-P9, T-P13 |
| Profile detail | `getCreditProfile` `credit-profile.js:74` | predicate inside the ID statement; 404 parity for absent **and** restricted | ~6 lines | T-P4, T-P12, T-P13 |
| Profile write | `createCreditProfile` `credit-profile.js:130` | `allow(actor,'CREDIT_MANAGE')` → `requireCreditManagementAuthority`, evaluated **before** `readJson` | 1 line | T-P7, T-P8, T-P16 |
| Anchor read | `listCreditAnchors` `credit-anchor.js:102` | require `CREDIT_VIEW` **and** `SALES_CROSS_GROUP`; ADMIN exempt | ~4 lines | T-P9, T-P15 |
| Anchor write | `provisionCreditAnchor` `credit-anchor.js:114` | `requireCreditManagementAuthority` before `readJson` | 1 line | T-P15 |
| Internal resolvers | `credit-profile.js:44`, `credit-policy.js:82,89,93,192` | **unchanged** — must stay actor-free and unfiltered | none | T-P14, T-G16 |
| Dispatch | `app.js:581-589` | **unchanged** — owner table and handlers stay as-is; no alternate HTTP route bypasses the central authorization | none | direct-HTTP negative |
| Seeded roles | `server/db.js:1727-1763` | **unchanged** — do not add `SALES_CROSS_GROUP` to `role-sales` | none | T-G10, T-G11, T-G12 |
| UI | `src/pages/credit-foundation.jsx` | hide Profile / Anchor / Parameter / Rule write controls without central management authority; **UX only, never a security boundary** | optional, separate UI change | acceptance script |
| Test fixture | `sales-customer-wave9-credit-foundation.test.js:14` | `MANAGER` must carry `roleCode:'ADMIN'` or `SALES_CROSS_GROUP` | 1 line | all write tests |
| Focused tests | `server/sales-customer-wave9-credit-foundation.test.js` | add §36.15.11 and §36.15.11.1 matrices | new cases, no new identifiers | §36.15.11, §36.15.11.1 |
| Suite registry | `scripts/testing/test-suites.js` | unchanged — the suite already exists | none | — |

**Route-bypass check.** All nine Wave 9 Credit routes are registered once in `app.js:581-589` and owned by three modules. There is **no alternate HTTP route**, admin route, bulk route or internal dispatch path that reaches `createCreditParameter`, `createCreditRule` or the readers. `credit-policy.js` has no second entry point. The AP5 correction at the handler therefore covers every human-facing surface.

**SQLite / MySQL parity.** Both the Profile predicate and the AP5 checks are pure, dialect-neutral logic: the predicate is a `WHERE` conjunct over existing columns bound through `db.prepare`, and the AP5 checks read only `actor.roleCode` / `actor.permissions`, which never touch the database. No new dialect-specific syntax, no `FOR UPDATE`, no backend-specific function. The only dialect branch in the affected code stays `lockSuffix(db)` / `db.dialect === 'mysql'`, untouched by AP5. Authorization therefore executes identically on both dialects, and the same authorization assertions — including the negative ones — belong in both the SQLite focused suite and the MySQL integration suite.

#### 36.15.11 Focused security test contract

Cases reuse approved `document.md §14.5` A1–A7 / N1–N12. **No new SC, UAT, Race or CAP identifier is created.** Test-local labels `T-P*` only. T-P9 through T-P12 are **corrected** from the first draft, which wrongly expected a global `403` for an ineligible actor; every one of them now asserts that aggregate read **succeeds**.

| # | Case | Mode | Requirement | Expected |
|---|---|---|---|---|
| T-P1 | ADMIN reads and writes profiles | `ALL` | A1, A7 | 200 / 201 |
| T-P2 | Ordinary salesperson reads customer aggregate | `AGGREGATE_PLUS_SELF` | A2 | 200, aggregate rows present |
| T-P3 | Ordinary salesperson reads **own** sub-limit | `AGGREGATE_PLUS_SELF` | A3 | 200 |
| T-P4 | Same-group salesperson reads **another** salesperson's sub-limit (collection and by ID) | `AGGREGATE_PLUS_SELF` | N1, N8 | collection omits the row; detail returns 404 |
| T-P5 | Actor with `SALES_CROSS_GROUP` but no `CREDIT_VIEW` | `DENY` | N4 | **403 `CREDIT_SCOPE_DENIED`** on every Credit read |
| T-P6 | `CREDIT_MANAGE` without `SALES_CROSS_GROUP` writes a profile | write | N3 | 403 `CREDIT_MANAGEMENT_DENIED` |
| T-P7 | `CREDIT_VIEW` + `SALES_CROSS_GROUP` reads cross-group sub-limits | `CROSS_GROUP` | A6 | 200 |
| T-P8 | `CREDIT_MANAGE` + `SALES_CROSS_GROUP` writes a profile | write | A7 | 201 |
| T-P9 | **Accounting**, `CREDIT_VIEW`, no salesperson mapping | `AGGREGATE_ONLY` | §14.4 row 3 | **aggregate 200**; own sub-limit absent from collection; sub-limit by ID **404**; write 403 |
| T-P9b | **Reviewer**, `CREDIT_VIEW`, **no** `SALES_CROSS_GROUP` | `AGGREGATE_ONLY` | §14.4 row 3 | **aggregate 200**; no sub-limit anywhere; write 403 |
| T-P10 | **Unmapped** sales actor, `CREDIT_VIEW` | `AGGREGATE_ONLY` | N6 | **aggregate 200**; self sub-limit absent; by ID 404 |
| T-P10b | **Inactive** salesperson profile | `AGGREGATE_ONLY` | N6 | **aggregate 200**; self sub-limit absent; by ID 404 |
| T-P11 | **Expired** membership / inactive membership / inactive group | `AGGREGATE_ONLY` | N7 | **aggregate 200**; self sub-limit absent; by ID 404 |
| T-P11b | Valid own membership (active, date-applicable) | `AGGREGATE_PLUS_SELF` | A3 | **aggregate 200 AND own sub-limit 200** — the positive counterpart to T-P10/T-P11 |
| T-P12 | Customer with no default Sales Group; customer shared by two groups | either | A4, A5 | aggregate creatable and readable by every `CREDIT_VIEW` actor; exactly one aggregate profile; no duplicate |
| T-P13 | Nested rating history and expanded payload cannot leak a restricted profile | any | N9 | restricted profile returns 404 with no rating body |
| T-P14 | Engine function still resolves restricted scopes | — | §14.3 | `resolveEffectiveCreditProfile` unfiltered and unaffected |
| T-P15 | Ordinary salesperson provisions an anchor / lists anchors | — | N10 | 403 |
| T-P16 | Every denied write | — | N12 | zero rows in `credit_profile`, `credit_profile_ratings`, `credit_policy_snapshots`, `credit_lock_anchors`, audit and idempotency stores |
| **T-P17** | **Collection / detail equivalence across all five modes** | all | N8, §36.15.6 | for every mode, the set of profile IDs reachable by direct ID is **exactly** the set returned by the collection; a profile hidden from the collection is unreachable by ID, and an aggregate profile hidden from neither is reachable by both |
| **T-P18** | **`AGGREGATE_ONLY` cannot be widened by a bad identity value** | `AGGREGATE_ONLY` | §36.15.6.1 | resolver with an unmapped actor emits a fragment with **no bind parameter**; supplying `'*'`, `NULL` or `''` as `:selfSalespersonId` throws at resolve time rather than returning rows |

**Assertion discipline for the corrected cases.** T-P9…T-P11 must assert a **`200` with aggregate rows present**, not merely the absence of a sub-limit. A test that only checked "no sub-limit returned" would pass against the broken global-403 behavior being corrected here, so each must pin the status code and assert at least one aggregate row is returned.

##### 36.15.11.1 AP5 global-configuration security tests

Design-local labels `T-G*`. **No new SC, Invariant, UAT, Race or CAP identifier is created.** These map to approved `document.md §15.8` scenarios and to existing SC83–SC86, SC111, SC114 and **UAT-S-30**.

| # | Case | Req / SC / UAT | Expected |
|---|---|---|---|
| T-G1 | ADMIN reads and writes Parameters | P1 · SC83/SC84 · UAT-S-30 | 200 / 201 |
| T-G2 | ADMIN reads and writes Rules | P2 · SC85/SC86 · UAT-S-30 | 200 / 201 |
| T-G3 | `CREDIT_VIEW`-only actor reads both | P3 · SC111 | 200 / 200 |
| T-G4 | `CREDIT_MANAGE`-only actor GET | §15.4 row 3 · SC114 `VIEW != WRITE` | **403 `CREDIT_PERMISSION_DENIED`** |
| T-G5 | `CREDIT_MANAGE`-only actor POST | §15.4 row 3 | **403 `CREDIT_MANAGEMENT_DENIED`** |
| T-G6 | `CREDIT_VIEW` + `CREDIT_MANAGE` (no `SALES_CROSS_GROUP`) POST | §15.4 row 4 · N3 | **403 `CREDIT_MANAGEMENT_DENIED`** |
| T-G7 | `CREDIT_VIEW` + `SALES_CROSS_GROUP` POST | §15.4 row 5 · N4 | **403 `CREDIT_MANAGEMENT_DENIED`** |
| T-G8 | `CREDIT_MANAGE` + `SALES_CROSS_GROUP` without `CREDIT_VIEW` | §15.4 row 6 · P4 | POST **201**; GET **403 `CREDIT_PERMISSION_DENIED`** |
| T-G9 | All three permissions | §15.4 row 7 · P4, P5 | GET 200; POST 201 |
| T-G10 | Seeded `role-sales` attempts to disable Credit Management | N1 · SC83 | **403**; `CREDIT_MANAGEMENT_ENABLED` value unchanged |
| T-G11 | Seeded `role-sales` attempts BLOCK → WARNING | N2 · SC86 | **403**; `control_strength` unchanged |
| T-G12 | Seeded `role-reviewer` / `role-accounting` | §15.6 | READ 200; WRITE 403 |
| T-G13 | Denied POST does not close an existing effective version | N8 | predecessor `effective_to` / `superseded_by_id` unchanged |
| T-G14 | Denied POST creates no business row, audit or idempotency record | N9 · §15.7 | zero rows in `credit_parameters` / `credit_check_rules`, zero audit, zero idempotency |
| T-G15 | Authorized effective-version creation retains all original invariants | P6 · S15 | 201; predecessor closed; overlap rejected; audit and idempotency written; `lockGlobalPolicy` held |
| T-G16 | Internal resolvers work with no human actor | P8 · S15 · §36.15.7.4 | `resolveCreditParameter` / `resolveCreditRule` return authoritative effective rows without any `actor` |

T-G8 is the case that proves READ and WRITE are genuinely independent; T-G4/T-G5 prove `CREDIT_MANAGE` implies neither. T-G10 and T-G11 are the specific attacks the AP5 risk register was raised to close. T-G13/T-G14 are the `document.md §15.7` no-side-effect invariant. **None executed; no PASS claimed.**

Mandatory per-case assertions for T-P16: denied response, **and** unchanged row counts in all six Wave 9 tables, **and** zero audit rows, **and** zero idempotency records. Permission denial must be distinguishable from business-validation failure (`CREDIT_PROFILE_EFFECTIVE_OVERLAP` etc.), which is a `409` after an authorized actor entered the transaction.

#### 36.15.12 Global Credit configuration authority — `APPROVED / RESOLVED` (was: open business-security risk)

```text
RISK ID : W9-CREDIT_GLOBAL_CONFIG_AUTHORITY_DECISION
STATUS  : RESOLVED — APPROVED at Requirement stage 2026-10-22 as document.md §15
          AP5 (REQUIREMENT_DECISION_PENDING-3). Design reconciled in §36.15.7.2.
CLASS   : independent business-security risk, distinct from the AP1-AP4.1
          profile-authorization policy — resolved by its own Requirement, not by
          extending AP4.1
```

> **EVERYTHING BETWEEN THIS BANNER AND THE RESOLUTION QUOTE BELOW IS THE PRESERVED RAISE RECORD — HISTORICAL EVIDENCE, NOT ACTIVE DESIGN.** It is retained verbatim so the audit trail shows that this gap existed, was verified against source, and was deliberately left unresolved rather than quietly fixed. Statements inside it that read as present-tense design decisions ("Therefore no change is made…", "this Design does not extend it") describe the position **while the question was open** and are **superseded by `document.md §15` AP5**. The active contract is **§36.15.7.2**.

**The risk, verified against source.** `createCreditParameter` (`credit-policy.js:108`) and `createCreditRule` (`credit-policy.js:152`) both authorize with `allow(actor, 'CREDIT_MANAGE')` alone. Per the seeded role grants in `server/db.js`, `role-sales` holds `CREDIT_MANAGE` and does **not** hold `SALES_CROSS_GROUP`. Therefore, under the current code and the current Design:

```text
an ordinary salesperson can create a new effective version of ANY globally
effective Credit Parameter and ANY Credit Check Rule, including
CREDIT_MANAGEMENT_ENABLED - the master switch that §29.22.1 and S15 make the
fail-closed gate depend on - and including downgrading a BLOCK rule to WARNING.
```

**Why this is out of scope for §36.15 and must not be "fixed" here.**

| Constraint | Consequence |
|---|---|
| `document.md §14.3` categories 1 and 2 record that the **existing frozen contract governs** Parameters and Rules, and that this policy creates **no new mutation right** over them | Extending AP4.1 to global configuration would be **new business policy** |
| The approved Requirement grants this Design authority to reconcile the Credit **Profile** authorization contract only | Changing Parameter/Rule authorization here would exceed the authorization scope |
| AGENTS.md §4.3 forbids Design from introducing business policy | Silently tightening `createCreditParameter` / `createCreditRule` would self-authorize policy |

**Therefore no change is made.** Parameters and Rules remain `CREDIT_MANAGE`, exactly as §36.15.7 rows 2 and 4 state. This risk is **recorded, not mitigated**.

**Relationship to the Profile rule.** AP4.1's restriction is *narrower* than "only an administrator may manage Credit". It restricts management of the **customer- and salesperson-scoped Credit Profile** to ADMIN or (`CREDIT_MANAGE` + `SALES_CROSS_GROUP`). It says nothing about **globally effective** Parameters and Rules, and this Design does not extend it. Whether that asymmetry is commercially intended is precisely the open question.

**Recommended separate Requirement decision (not authored here).** A new `REQUIREMENT_DECISION_PENDING-3` candidate for the user to decide:

```text
Question:
  Must globally effective Credit Parameters and Credit Check Rules also require
  central management authority (ADMIN, or CREDIT_MANAGE + SALES_CROSS_GROUP),
  or is CREDIT_MANAGE alone intentionally sufficient for global Credit
  configuration?

Why it cannot be inferred:
  - document.md §14.3 explicitly declines to decide the global-configuration
    mutation right.
  - §34.7 P1-P5 define no group or central-authority clause for it.
  - SC83/SC84 make Credit Management configurable but fix no authority rule.
  - Both answers are commercially defensible: a small installation may
    deliberately let the sales role own Credit configuration, while an
    enterprise installation almost certainly should not - and the difference is
    material because the same role can disable the fail-closed gate.

Until this is decided and a Requirement is approved, Stage D must implement
Parameters and Rules exactly as §36.15.7 rows 2 and 4 specify, and the risk
above remains open and must not be silently closed.
```

> **The raise text above is preserved verbatim as historical evidence.** It was written
> when no Requirement decision existed, and the reasoning recorded in it — that Design
> must not create business policy, and that `document.md §14.3` genuinely declined the
> question — was correct at the time and is **not** retracted. It is superseded **only**
> in its conclusion, because the user has now answered the question at Requirement stage.
>
> **Resolution.** The user approved `REQUIREMENT_DECISION_3_PASS` and `document.md §15`
> AP5 — *Global Credit Parameters and Credit Check Rules shall use centralized management
> write authority*:
>
> ```text
> READ  =  ADMIN  OR  CREDIT_VIEW
> WRITE =  ADMIN  OR ( CREDIT_MANAGE  AND  SALES_CROSS_GROUP )
> ```
>
> The active Design contract is now **§36.15.7.2**. Stage D must implement Parameters and
> Rules per that section, **not** per the superseded rows preserved in §36.15.7.5.
>
> **The two constraints above no longer apply** and are retained only to show why the
> earlier Design could not have made this change itself:
> - "`document.md §14.3` … creates no new mutation right over them" — `document.md §15.10`
>   supersedes `§14.3` categories 1 and 2 for **human WRITE authorization only**.
> - "changing Parameter/Rule authorization here would exceed the authorization scope" —
>   the authorized scope is now `WAVE9_STAGE_C_AP5_DESIGN_RECONCILIATION`.
>
> **What is not superseded:** AP1–AP4.1, the five Profile read-scope modes, the direct-ID
> 404 contract, the statement that central configuration is not Sales-Group-owned, and the
> frozen contract that still governs Parameter and Rule business **semantics** (SC83–SC86).

#### 36.15.13 Boundary and status

```text
Modified by this closure : solution.md §36.15.5, §36.15.7 (rows 1-4 + §36.15.7.2
                           -§36.15.7.5), §36.15.10, §36.15.11.1, §36.15.12
                           (resolution), §36.15.13; log/YYYY-MM-DD.md append-only
NOT modified              : document.md, README.md, AGENTS.md, CLAUDE.md, APPLY_GUIDE.md,
                           server/**, src/**, scripts/**, migrations, tests, package.json,
                           any database
Not executed              : tests, build, migrations, MySQL gates, any DB operation
Not performed             : Git add / commit / push / merge / tag / deploy
Not begun                 : Wave 9 implementation remediation, Wave 10, Wave 11,
                           W7-C1, W7-C2'
Wave 9 status             : IMPLEMENTED / ACCEPTANCE_PENDING — unchanged, not frozen
Design PASS               : NOT self-declared
```

**Status: `SALES CREDIT WAVE 9 — AP5 BOUNDED DESIGN READY FOR EXTERNAL REVIEW`.**

## 36.16 Wave 9 final accepted technical baseline and freeze (2026-10-23)

### 36.16.1 Acceptance decision and scope

The user explicitly approved `SALES CREDIT WAVE 9 — FINAL_ACCEPTANCE_PASS / FROZEN`. Sections §36.0–§36.15,
including their explicit supersession and AP5 resolution rules, now form the frozen Wave 9 technical baseline
for the implemented Credit Foundation. This section records that acceptance and introduces no production,
schema, API, permission, migration, UI or test behavior change.

### 36.16.2 Frozen implementation baseline

- The six Wave 9 tables remain `credit_lock_anchors`, `credit_profile`, `credit_parameters`,
  `credit_check_rules`, `credit_policy_snapshots` and `credit_profile_ratings`, with their accepted keys,
  indexes, checks, effective-date and forward-FK/nullability contracts unchanged.
- `server/modules/credit-scope.js` remains the single authorization-scope owner for AP1–AP5. Profile reads
  retain the five-mode predicate and direct-ID non-enumeration; global configuration READ and WRITE remain
  independent; all four human write surfaces retain central management authority.
- `server/modules/credit-policy.js`, `credit-profile.js` and `credit-anchor.js` remain the canonical Wave 9
  runtime owners. Internal policy/profile resolvers remain actor-free and are not widened by human-route
  authorization rules.
- `credit_lock_anchors.id` remains the serialization identity. `creditObjectAnchorKey` and the
  `uq_credit_lock_anchors_anchor_key` contract remain group-free; policy snapshots remain immutable evidence,
  not a second lock identity.
- Effective-version predecessor closure, overlap rejection, `INITIAL_ASSIGNED` rating provenance, immutable
  rating history, audit/idempotency behavior and SQLite/MySQL parity remain as accepted. No second Credit
  exposure ledger, Customer identity, rating writer or permission registry is introduced.

### 36.16.3 Accepted verification evidence

The accepted final gate set is: Wave 9 focused SQLite 21/21, fast 380/380, full 2647/2647, heavy 67/67,
MySQL Integration 73/73, MySQL Wave 9 Credit 17/17, MySQL Concurrency 106/106 including Wave 9 Anchor 4/4,
Vite build PASS, responsive UI PASS at 320/390/430/680 CSS px, and `git diff --check` PASS. AP1–AP5,
SC83–SC89 and UAT-S-29/30 are included in the accepted evidence.

The Wave 9 Anchor suite proves real-MySQL independent sessions, actual same-key contention for both Anchor
dimensions, exact deadlock-victim classification when applicable, explicit acknowledged rollback,
same-connection bounded canonical recovery, one final logical row, canonical `transaction()` convergence and
worker/session cleanup. The standard MySQL Integration result remains applicable because the bounded fixture
and observability corrections changed no production implementation.

### 36.16.4 Preserved carry-forward and downstream block

`LEGACY_DATA_EVIDENCE_PENDING` remains open and unchanged; no legacy bootstrap or historical value is
invented. `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` remains active and continues to cover W7-C2′ as
defined in §36.14.5. Neither W7-C1 nor W7-C2′ is implemented or accepted by this freeze, and Wave 10/11 is
not started or authorized.

### 36.16.5 Freeze and Git boundary

Wave 9 Requirement, Design and implementation are accepted and frozen. Any future change to its business
behavior, schema, API, authorization, lock identity/order, canonical ownership or compatibility contract must
restart `AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE`. Historical stage-status text remains
valid as history and is superseded for current status only by this final record.

This documentation closure is not a Git add, commit, push, merge, tag, release, deployment, database operation
or package-version change. Git closure remains pending separate user authorization.

**Status: `WAVE9_FINAL_ACCEPTANCE_PASS — FROZEN — GIT_CLOSURE_PENDING`.**

---
