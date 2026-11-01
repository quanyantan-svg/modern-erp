# W11-A U3 — Implementation Evidence

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## W11-A U3 Selector Protected MySQL Gate — Implementation Evidence (2026-10-30)

### 1. Authorization and scope of this record

The user confirmed the Gate Design as READY, kept the customer free-text name case/accent semantics
OPEN, approved the Gate implementation with measurement and disclosure of that difference, and stated
that a Gate PASS does not resolve the business decision and that the U3 Final Freeze stays blocked
until it is resolved.

This record is the implementation evidence of that approval. It does not restate the Requirement
recorded in "W11-A U3 Selector Protected MySQL Gate — Bounded Requirement Amendment (2026-10-30)" and it
does not claim a real MySQL result. The MySQL gate has not been executed.

Not authorized and not performed: a real MySQL connection, a MySQL reset or any schema operation, the
real MySQL gate execution, a change to the production Selector, a new business semantic, the Final
Acceptance or Freeze, and any Git write.

### 2. Coverage of R-U3-GATE-01 by the implemented gate

The implemented gate verifies exactly one production surface, `GET /api/credit/query-options`, through
the real handler and the real Credit Read Scope resolver. It never simulates an authorization decision.
The ten implemented cases cover the fourteen business dimensions of R-U3-GATE-01:

| Requirement item | Implemented case | Business proof |
| --- | --- | --- |
| five-level Credit Read Mode | S02 | the exact option set and scope types of `ALL`, `CROSS_GROUP`, `AGGREGATE_PLUS_SELF`, `AGGREGATE_ONLY` and `DENY`, identically on both engines |
| `CREDIT_VIEW`-only without `CUSTOMERS_VIEW` and `CREDIT_MANAGE` | S02 | the reader's permission set is asserted to be exactly `CREDIT_VIEW` |
| no identity for a denied account | S02 | the denied reader receives HTTP 403 `CREDIT_SCOPE_DENIED` and no body |
| authorized Customer projection | S03 | every returned row carries exactly the seven approved fields and nothing else |
| multiple Credit Objects | S03 | two Credit Objects of one customer stay two logical options |
| effective Profile date logic | S06 | the requested business date selects the effective version while the authorization date stays current |
| revoked self membership | S06 | a historical business date does not restore a revoked membership |
| search | S04 | the defined ASCII probes, the wildcard parity and the authorized-subset invariant |
| grouping | S03 | two Profile versions of one logical object are one option with two scope types |
| COUNT and pagination | S03 | the count equals the logical option count, the pages do not overlap and rebuild the set |
| stable ordering | S10 | the order is stable across reads and pages, and identical across engines for the collation-unambiguous identities |
| ambiguous effective versions | S07 | HTTP 409 `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` on both engines, never a collapsed option |
| SQLite/MySQL parity | S01 to S10 | every defined assertion is made on both engines and compared |
| GET zero-write | S09 | the complete database digest is unchanged around every measured GET |

### 3. Coverage of R-U3-GATE-02 by the implemented gate

The gate runs only through the existing protected launcher. It reuses `runProtectedMySqlCampaign`, so the
target identity preflight, the MySQL 8 version policy, the server UUID, the account and grants
fingerprint, the `EMPTY_ONLY` initial inventory, the protected reset authorization, the machine-wide
exclusive lock, the strict TAP validation, the deterministic cleanup and the five-category zero object
inventory all remain owned by the existing protected machinery. The new runner adds no reset, no
identity check, no cleanup and no TAP parser of its own. The protected target identity, the credentials
and the grant baseline are not modified.

### 4. Coverage of R-U3-GATE-03 by the implemented gate

The implemented suite classifies every compared value and never normalizes a business fact. Only the
stable business key `customerId + creditObjectType + creditObjectId` is compared across engines; a
generated Profile id, an anchor id and a timestamp are never compared. Each engine first satisfies the
complete contract on its own, and only then is the comparison made. The logical option sets are
compared, not only the totals. The COUNT is compared with the union of the pages and with the
unpaginated set. The DTO field set is compared field by field without normalization. A failure is
resolved by a fix, never by a skip, a todo or a weakened assertion; the strict TAP acceptance of the
protected campaign rejects all of them.

The one classification that belongs to the environment class is documented and excluded from the
business assertion: under the case- and accent-insensitive MySQL collation two business identities
that differ only by case or accent cannot be stored at all, so the fixture never seeds such
identities.

### 5. The open business decision remains OPEN

`CUSTOMER_NAME_SEARCH_SEMANTICS_OPEN` is preserved verbatim in the implemented suite, in the evidence
file it writes and in the campaign output.

The implemented gate measures the open dimension on both engines and keeps the difference visible. It
asserts the defined contracts strictly: the ASCII case-insensitive match, the Credit Object identity
match, the authorized-subset invariant, the count agreement and the zero-write guarantee. It does not
assert cross-engine equality on the undefined dimension, it does not normalize the two results into
one, it does not select either engine as the business authority, and it does not change the production
SQL, the schema or a collation.

The gate additionally measures and records the ASCII case, the Unicode case, the accent, the customer
name search, the group-by behaviour, the order and the stable pagination, and the read-only MySQL
collation metadata. The measured divergence is reported as a typed finding with both engine results.

The business decision itself is not taken by the gate. The U3 Final Freeze stays blocked until the
business owner decides the customer-name case and accent semantics.

### 6. Coverage of R-U3-GATE-05 and R-U3-GATE-06

No production file was changed. The Selector DTO, the Selector business semantics, SC101, SC102, the
Credit Check decision, the Credit Scope Resolver, the OVERDUE evidence, the CSP/CCHK identity, the
ONE_TIME approval semantics, the schema and every migration are untouched. A semantic contradiction
found by the gate is recorded as a finding and returned to Requirement and Design; the gate never
repairs production code.

The gate produces cross-engine evidence only. It is not an acceptance of the U3 capability, it freezes
nothing, and the existing U3-C browser acceptance PASS, the original B06 FAIL with its preserved
evidence, the B06 fix evidence, the FAST 500/500 result, the FULL 3046/3046 result and the
1966-module build keep their exact identity. None of them is restated as a real MySQL result.

**Implementation evidence status: `W11_A_U3_MYSQL_SELECTOR_GATE_IMPLEMENTED`.**

## W11-A U3 Search Semantics — Implementation Gate Finding (2026-10-30)

### Authorization and bounded result

The user authorized the complete bounded implementation described by R-U3-SEARCH-01 through
R-U3-SEARCH-12 and solution.md §37.54.39–§37.54.40, with the corrected whitelist count of fourteen
code/test paths plus three append-only documentation paths, seventeen paths in total. The
authorization excluded real MySQL, the protected MySQL gate, Final Acceptance/Freeze and every Git
write.

The Search Fold, the four additive keys, the SQLite migration/backfill, the four production writer
paths, the literal Selector search, the deterministic order and the dedicated SQLite suite were
implemented within that boundary. The focused Search/U3 gate passed 45/45 after the approved U3-A
fixture inserts were made explicit for the additive columns.

### Newly discovered compatibility gap

Stage B found a requirement/design dependency that the approved amendment did not cover. After
`credit_profile` gains the two additive search-key columns, a later idempotent invocation of the
canonical Sales & Customer migration runner re-enters the frozen Wave 9 migration. Its schema guard
requires the original `credit_profile` column identity/order to match exactly and reports
`Wave 9 schema conflict: credit_profile column identity/order drifted` for the approved additive
columns.

This is not a Selector search failure and must not be hidden by weakening or skipping the frozen
regression. Resolving it requires a separately approved Requirement and Design decision for the frozen
migration compatibility rule (or another explicitly approved migration lifecycle), because the
affected owner is outside the seventeen-path implementation whitelist and was explicitly frozen by the
authorization.

**Implementation gate status: `W11_A_U3_SEARCH_SEMANTICS_IMPLEMENTATION_BLOCKED`.**

## W11-A U3 / Wave 9 Exact Additive Schema Compatibility — Implementation Result (2026-10-30)

### Authorized scope and delivered behavior

Implementation stayed inside the approved seven-path whitelist. The Wave 9 base validator now accepts
only the exact `credit_profile` V0/V1/V2 column identities while preserving the original nineteen-column
prefix, the other five tables and all existing PK/FK/CHECK/index guards. The U3 migration remains the
sole owner of the two Search Key columns and now verifies their exact SQLite/MySQL physical definitions
before backfill. SQLite rejects an unverifiable or illegal definition; MySQL may reconcile only the
approved binary collation on an otherwise legal nullable `LONGTEXT` column.

The implementation tests exercise M01–M09, M11 and the local M12 cases through real SQLite migration
entry points. The existing MySQL integration suite contains the prepared M03/M10/M11/M12 evidence, but
no real MySQL connection or DDL execution was authorized or performed.

### Verification result and mandatory stop

- Local M01–M09/M11/M12: 11/11 PASS; M10 remains `NOT_RUN_MYSQL`.
- Exact six prior Stage B failures: 6/6 PASS.
- Complete prior Stage B selection: 103/103 PASS.
- Focused original Wave 9 plus U3 Search/UI selection: 77/77 PASS.
- FAST: 499/500 PASS and 1 FAIL. The run emitted `WebSocket server error: Port 24678 is already in use`;
  the port had no owner when inspected after the run, so the observed collision was transient. This is
  still a gate failure and is not waived by the focused results.
- FULL, build, final `git diff --check` and browser preliminary verification: NOT RUN after the required
  FAST hard stop.
- Real MySQL protected gate: NOT RUN and not authorized.

No eighth path, schema deployment, database write outside disposable SQLite fixtures, Git write,
Acceptance/Freeze, release or deploy occurred. The additive compatibility implementation is locally
closed at focused scope but cannot be accepted while the independent FAST failure remains unresolved.

**Implementation status: `W11_A_U3_SEARCH_SEMANTICS_IMPLEMENTATION_BLOCKED`.**
