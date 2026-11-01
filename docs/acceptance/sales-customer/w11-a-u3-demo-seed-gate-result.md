# W11-A U3 — Demo Seed Inventory MySQL Gate Result

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）
## W11-A U3 Demo Seed Inventory MySQL Gate — Implementation Result, Residual Acceptance and Historical Disposition (2026-10-31)

### 1. Authorization, baseline and boundary

The user authorized one stage: the Implementation of the six registered paths of `solution.md §37.54.46.6`, the
acceptance of the Exact Identity Collation residual as an explicit business risk, the registration of the
historical inventory remediation direction, and exactly one protected real-MySQL execution of the new independent
Demo Inventory gate. No Git write, no Acceptance and no Freeze were authorized, and none occurred.

Baseline: branch `review/w11a-u3-fast-blocked-20261030`, HEAD
`60f3fbd169d7b43bbae3824b10b538edef4aeec1`, version `1.6.2`, empty index, the seventeen authorized changed paths
preserved. The completed gate evidence is preserved and is not re-opened, and none of it is reclassified as
failed: FAST 500 of 500, FULL 3102 of 3102, the build, the Edge browser B01 to B12, the MySQL Selector S01 to
S10, the S04 Unicode and literal search, the S10 full ordering and pagination parity, the protected cleanup and
the unchanged frozen SHA set.

### 2. R-U3-INV-09 — The Exact Identity Collation residual is an accepted residual

The Exact Identity Collation difference audited under R-U3-INV-06 is registered as `ACCEPTED_RESIDUAL` by an
explicit business risk acceptance of the business owner.

The acceptance covers exactly and only:

1. the Selector Exact Identity Filter of `GET /api/credit/query-options`;
2. the existing exact identity comparison mechanism, which stays an equality comparison;
3. the measured SQLite/MySQL case-variant difference on the identity columns, which is case-insensitive on
   MySQL and byte-sensitive on SQLite;
4. the measured facts that the difference never widens the authorized set, that no wrong business identity can
   be returned, that a case-variant identity is refused on write by the anchor shape guard, and that the neutral
   response for an unknown and for an unauthorized identity stays byte-identical on both engines.

The acceptance explicitly does not cover and does not change:

- any other API, handler, writer, query or report that compares an identity;
- the approved Unicode Search Fold and the literal search contract;
- the production identity policy, which is not widened to case-insensitive identity equality;
- the declaration of any engine as the business authority;
- any claim that all identity queries are equivalent across the two engines.

No production identity comparison code was modified in order to record this acceptance, and no such modification
is authorized by it.

If a real identity conflict, an authorization bypass or a data disclosure is later observed, this acceptance
does not cover that new fact: the residual returns to audit and the acceptance is void for it. A future change
of the identity policy obliges a new audit of the same subject.

### 3. R-U3-INV-10 — The historical inventory direction is registered and is not implemented

The historical inventory position abnormalities are registered as a separate Requirement direction of their own,
`Inventory Historical Position Integrity`, with the following scope:

- the legacy NULL position keys;
- the duplicated canonical inventory positions;
- the synthetic fallback positions;
- the historical stock facts behind them;
- the reconciliation of the inventory valuation and the inventory ledger;
- the fail-closed detection of an abnormal row;
- the manual repair authorization boundary.

This stage implements none of it. No historical data repair SQL, no migration, no compensating movement and no
accounting adjustment was added, and the frozen Inventory Position migration was not modified.

The Fresh Demo Inventory gate PASS is a fresh-bootstrap result only. It never marks a historical anomaly
`CLOSED` and never replaces the historical remediation requirement.

If such an anomaly is found in a future deployment target, the related data migration or deployment shall be
blocked and the anomaly disposed of independently first.

### 4. The acceptance result

The independent protected MySQL gate `W11-A U3 INVENTORY DEMO SEED MYSQL E3 ACCEPTANCE` executed exactly once on
the live disposable MySQL 8 target and passed:

- the target identity was proven against the pinned baseline before the campaign and the initial object
  inventory was empty;
- the eight acceptance cases M-INV-01 to M-INV-08 passed 8 of 8, with zero fail, zero skip, zero cancelled and
  zero todo;
- the protected runner reported the five-class zero object inventory after the campaign;
- the protected launcher independently confirmed the cleanup on a fresh session: tables 0, views 0, triggers 0,
  routines 0, events 0.

### 5. R-U3-INV-07 restated — the acceptance is not widened

A pass of the Demo Inventory gate is not an Inventory Domain MySQL acceptance, not a historical inventory
remediation result and not a W11-A MySQL acceptance. The remaining MySQL inventory risks stay registered.
