# W11-A U3 — Freeze Registration

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## W11-A U3 Freeze Registration (2026-10-31)

### 1. The acceptance and the freeze

- **Acceptance**: `PASS`, granted by the business owner on 2026-10-31.
- **Freeze**: `FROZEN`.
- **Acceptance Date**: 2026-10-31.
- **Frozen Implementation Commit**: `ec618eb81684d645707c70a8b69ff9379682fbaa`.
- **Frozen Tree SHA**: `908c10310cd92a509374ada2bd31b5882be580f2`.
- **Frozen Implementation Parent**: `60f3fbd169d7b43bbae3824b10b538edef4aeec1`.
- **Version**: `1.6.2`, unchanged.

The frozen commit is the anchor of the accepted implementation. The freeze journal commit that follows it
carries only this registration and the closure record; it is not the frozen implementation anchor.

### 2. The frozen scope

The frozen capability is strictly bounded to the **W11-A U3 Credit Query Selector / Search Semantics** and
its directly related approved regression fixes:

- the Selector Search Key;
- the Unicode Search Fold;
- the literal `%`, `_` and backslash search semantics;
- the deterministic ordering;
- the pagination;
- the Credit read authorization;
- the Search Key migration;
- the Wave 9 compatibility amendment;
- the U3 browser acceptance;
- the Vite middleware test stability;
- the Demo Inventory canonical position seed regression;
- the independent MySQL Inventory Demo Seed gate.

### 3. The accepted evidence

| Gate | Accepted result |
| --- | --- |
| FAST | 500 of 500 PASS |
| FULL | 3102 of 3102 PASS |
| Build | PASS |
| Edge browser | B01 to B12, 12 of 12 PASS |
| MySQL Selector E3 | S01 to S10, 10 of 10 PASS |
| MySQL Inventory E3 | M-INV-01 to M-INV-08, 8 of 8 PASS |
| Protected MySQL cleanup | CONFIRMED, the five object classes zero |
| Frozen SHA | 15 of the 16 recorded identities unchanged |

### 4. The accepted residual and the deferred requirement

- `R-U3-INV-09 = ACCEPTED_RESIDUAL`. The acceptance covers only the already-measured collation difference of
  the existing Selector Exact Identity Filter of `GET /api/credit/query-options`. It is not extended to any
  other API, handler, writer, query, report or identity policy, it does not widen the production identity
  equality policy and it declares no engine the business authority. A later-observed identity conflict, an
  authorization bypass or a data disclosure is not covered by it and returns to audit.
- `R-U3-INV-10 = DEFERRED_OUT_OF_SCOPE`. The historical inventory position integrity is governed by its own
  independent Requirement. A future deployment target that is detected to hold a genuinely abnormal inventory
  position stays blocked, and this Freeze does not release it automatically.

### 5. The scope exclusions

This Freeze does **not** freeze:

- the entire Sales and Customer domain;
- the entire W11-A package;
- the entire Inventory domain;
- the historical inventory data repair;
- a deployment;
- a release.

### 6. The frozen exception

`package.json` carries the single approved forward amendment: the recorded SHA-256
`43d6ec696d2a54896c6968bc163710341a8a85431bad9efa29cdd44169047dee` moved to
`5ac498f0ef715007a14bb0c0c20d0bf479b94b4f46194edd8b9807136e18a8b1` for exactly one added test script. No other
frozen identity deviates, and the exception does not extend to any other frozen file.

### 7. No Merge, Tag, Release or Deploy

The freeze was closed locally only. No Merge, no Tag, no Release, no Deploy and no Push to any remote were
performed or authorized. A later Push requires its own explicit authorization naming the remote and the target
branch.
