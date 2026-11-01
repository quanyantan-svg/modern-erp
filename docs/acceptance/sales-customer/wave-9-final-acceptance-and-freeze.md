# Wave 9 Final Acceptance and Freeze Record

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）
## Wave 9 Final Acceptance and Freeze Record (2026-10-23)

### 1. Acceptance decision

The user explicitly approved `SALES CREDIT WAVE 9 — FINAL_ACCEPTANCE_PASS / FROZEN` after review of the
complete SQLite, MySQL, concurrency, build and responsive-UI evidence. Wave 9 is therefore accepted and
frozen at the approved Requirement boundary in §13–§15 and the existing SC83–SC89 / UAT-S-29–30 contract.
This record closes Acceptance/Freeze documentation only. It does not rewrite any approved business rule,
permission contract, schema, state transition, ownership boundary or historical stage record.

### 2. Accepted Requirement boundary

The frozen Wave 9 Requirement comprises:

- Credit Parameters and Credit Check Rules with effective-dated history, explicit stage/scenario/timing/item
  semantics, and independently configurable `WARNING` and `BLOCK` strengths (SC83–SC86);
- Customer Aggregate and eligible Salesperson sub-limit Credit Profiles, effective-date resolution,
  predecessor closure, overlap rejection, overdue policy, immutable initial-rating provenance and status
  semantics (SC87–SC89);
- AP1–AP4.1 central ownership, shared aggregate, self-only sub-limit visibility, independent Credit permission
  and cross-group enforcement, and central Profile/Anchor write authority;
- AP5 global-configuration authorization: human READ is `ADMIN OR CREDIT_VIEW`; human WRITE is
  `ADMIN OR (CREDIT_MANAGE AND SALES_CROSS_GROUP)`, with denied writes producing zero business, audit and
  idempotency effects;
- UAT-S-29 and UAT-S-30, including responsive access, direct-route behavior and backend fail-closed parity.

### 3. Final acceptance evidence

The user accepted the following completed evidence as the Wave 9 Final Acceptance basis:

```text
SQLite focused                 21 / 21 PASS
Fast                          380 / 380 PASS
Full                         2647 / 2647 PASS
Heavy                          67 / 67 PASS
MySQL Integration              73 / 73 PASS
MySQL Wave 9 Credit            17 / 17 PASS
MySQL Concurrency             106 / 106 PASS
MySQL Wave 9 Anchor             4 / 4 PASS
Build                                  PASS
Responsive UI                         PASS (320 / 390 / 430 / 680 CSS px)
git diff --check                       PASS
```

The accepted MySQL Anchor evidence covers independent real-MySQL sessions, genuine same-key contention for
both `CREDIT_OBJECT` and `POLICY_SCOPE`, strict deadlock classification when applicable, acknowledged explicit
rollback, same-connection canonical recovery, final one-row identity convergence, production `transaction()`
convergence and zero leaked worker sessions.

### 4. Preserved open dependencies and downstream gate

- `LEGACY_DATA_EVIDENCE_PENDING` remains open and unchanged. No legacy Credit Profile bootstrap,
  compatibility fact or historical value is inferred by this freeze.
- `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` remains active and unchanged; the label also covers the
  approved Design meaning of W7-C2′. This freeze does not implement or accept W7-C1/W7-C2′.
- Wave 10 and Wave 11 are not started or authorized by this record. Their Requirements and Design remain
  future work subject to the existing gate and separate explicit authorization.

### 5. Frozen boundary and change control

The freeze is limited to the accepted Wave 9 Credit Foundation. Any future change to AP1–AP5, SC83–SC89,
UAT-S-29/30, the six Wave 9 table contracts, authorization predicates, effective-date behavior, Anchor
identity, canonical ownership or accepted compatibility semantics must restart the repository's
`AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE` sequence.

This freeze does not freeze the ERP project as a whole and is not a Git commit, tag, release, deployment,
database migration or version change. Git closure remains pending separate user authorization.

**Status: `WAVE9_FINAL_ACCEPTANCE_PASS — FROZEN — GIT_CLOSURE_PENDING`.**
