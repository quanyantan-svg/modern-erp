# Gate A Final Acceptance and Freeze Record

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## Gate A Final Acceptance and Freeze Record (2026-10-24)

### 1. Acceptance decision

The user explicitly accepted `GATE_A_MYSQL_CAMPAIGN_PASS` and authorized the Gate A
`FINAL_ACCEPTANCE_PASS / FROZEN` record on the basis of the single authorized real-MySQL
execution of `pnpm test:mysql` against
`mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`
(server UUID `5d3c6a68-b8a5-11f1-8ce6-b025aa71d167`, MySQL 8.0.37).
Gate A is therefore accepted and frozen at the approved Requirement boundary of §37 and the
existing Wave 7 Sales & Customer contract. This record closes Acceptance/Freeze documentation
only. It rewrites no approved business rule, permission contract, schema, state transition,
ownership boundary, lock order, isolation level or historical stage record, and it changes no
production code.

### 2. Accepted Requirement boundary

The frozen Gate A boundary comprises:

- the Wave 7 Sales & Customer capability set exercised by the bounded Gate A campaign
  (A-PARITY, A-PROD, A-RAW, A-TXLIFE);
- the MySQL L0 transaction gate and the L1–L8 business lock order;
- the canonical named-lock lifecycle and its single authoritative release contract, including
  the transaction-start-failure path;
- the existing effective-retry semantics, the existing idempotency contract and the Finance
  monetary authority rules exercised by M19–M25;
- the existing SQLite compatibility behavior and MySQL `READ COMMITTED` session isolation;
- the existing schema, migration and reconciliation contracts, together with the existing
  target-identity guard, authorization checks and fail-fast gate rules.

### 3. Final acceptance evidence

The user accepted the following completed evidence as the Gate A Final Acceptance basis. The
MySQL campaign below was produced by the single authorized execution:

```text
A-PARITY   server/mysql-sales-customer-wave7.integration.js                 4 / 4 PASS
A-PROD     server/mysql-sales-customer-wave7-concurrency.integration.js     6 / 6 PASS
A-RAW      server/mysql-sales-customer-wave7-raw-locks.integration.js       4 / 4 PASS
A-TXLIFE   server/mysql-transaction-start-safety.integration.js             8 / 8 PASS
TAP fail / skipped / cancelled / todo                                     0 / 0 / 0 / 0
GATE A MYSQL CAMPAIGN                                                            PASS
```

The applicable Gate A M-cases are `PASS`: M1–M8, M13, M14, M16–M18, M19-GRNR, M20–M25.
M9, M10, M11, M12, M15 and M19-CREDIT are reported `BLOCKED_BY_WAVE10` by the runner itself
and are not discharged by this record.

The accepted A-TXLIFE real-session evidence covers verified server-side named-lock release,
session destruction with server lock reclamation and retirement from
`information_schema.PROCESSLIST`, the post-quarantine session-identity set equalling the
original set minus exactly the quarantined victim, the absence of any adapter connection leak
beyond the intentionally live primary and observer sessions, and the production
`transaction()` lifecycle releasing the replay-miss lock with both the exact-replay and
fingerprint-conflict reacquired locks released.

Supporting local regression evidence recorded earlier on 2026-10-24 and not re-run in this
freeze stage, per the stage authorization: `test:fast` 427/427 PASS, `test` 2754/2754 PASS,
`test:heavy` 67/67 PASS, `build` PASS (1964 modules transformed), `git diff --check` PASS.
The earlier M24/M25 remediation stage additionally recorded `test:fast` 397/397 PASS and
`test` 2724/2724 PASS on the same baseline.

Post-run read-only inventory of the authorized database returned zero tables, zero views,
zero triggers, zero routines and zero events, with target identity unchanged.

### 4. Preserved open dependencies and downstream gate

- Gate B remains `BLOCKED_BY_WAVE10`. It holds `B-COMPOSE`, `B-M9`, `B-M10`, `B-M11`,
  `B-M12`, `B-M15` and `B-M19C`. Gate A is not a prerequisite for Gate B, and this freeze
  does not discharge, weaken or defer Gate B.
- M9, M10, M11, M12, M15 and M19-CREDIT remain `BLOCKED_BY_WAVE10`.
- The residual open items recorded in `solution.md §37.31.15` (R1–R4) remain open and
  unchanged. They were recorded, not fixed, and this freeze does not close them.
- Wave 10 and Wave 11 are not started, accepted or authorized by this record. Their
  Requirements and Design remain future work subject to the existing gate and a separate
  explicit authorization.
- This record does not declare the remaining W7-C1 / W7-C2′ follow-up work complete. Gate B
  acceptance must still be completed and separately authorized.
- The disclosed operational risk of the broad global administrative grant on the disposable
  test account remains as recorded in `log/2026-10-24.md` and is not changed by this freeze.

### 5. Frozen boundary and change control

The freeze is limited to the accepted Gate A campaign boundary. Any future change to the
Gate A M-case set, the runner manifest or its suite order, the strict TAP / fail-fast /
cleanup rules, the target-identity guard, the canonical named-lock release contract, the
MySQL session isolation level, the L0 / L1–L8 lock order or the accepted A-TXLIFE fixture
semantics must restart the repository's
`AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE` sequence.

This freeze does not freeze the ERP project as a whole and is not a Git commit, tag,
release, deployment, database migration or version change. Git closure remains pending
separate user authorization.

**Status: `GATE_A_FINAL_ACCEPTANCE_PASS — FROZEN`.**

---

## 37.33 Gate A Final Acceptance and Freeze Record (2026-10-24)

### 37.33.0 Scope

This is an Acceptance/Freeze record only. It does not modify `§37.0–§37.32`, does not
reopen, redesign or reimplement any Design element, and changes no Requirement, production
source, test, schema, migration, `package.json`, database state or Git history. No MySQL
connection, Gate execution, reset or destructive operation was performed in this stage.

### 37.33.1 Accepted evidence

The user accepted `GATE_A_MYSQL_CAMPAIGN_PASS` on the basis of the single authorized
execution of `pnpm test:mysql` against
`mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`
(server UUID `5d3c6a68-b8a5-11f1-8ce6-b025aa71d167`, MySQL 8.0.37):

```text
A-PARITY   server/mysql-sales-customer-wave7.integration.js                 4 / 4 PASS
A-PROD     server/mysql-sales-customer-wave7-concurrency.integration.js     6 / 6 PASS
A-RAW      server/mysql-sales-customer-wave7-raw-locks.integration.js       4 / 4 PASS
A-TXLIFE   server/mysql-transaction-start-safety.integration.js             8 / 8 PASS
TAP fail / skipped / cancelled / todo                                     0 / 0 / 0 / 0
GATE A MYSQL CAMPAIGN                                                            PASS
```

The runner's own M1–M25 board reports `PASS` for M1–M8, M13, M14, M16–M18, M19-GRNR and
M20–M25, and `BLOCKED_BY_WAVE10` for M9, M10, M11, M12, M15 and M19-CREDIT. The bounded
runner, its suite order (A-PARITY → A-PROD → A-RAW → A-TXLIFE), the strict TAP assertion,
the fail-fast behavior, the per-suite reset and the final cleanup check are unchanged.

### 37.33.2 The A-TXLIFE acceptance contract is discharged

`§37.31.12` defined the A-TXLIFE acceptance contract as pending real-MySQL evidence. That
evidence now exists:

| Case | Accepted real-server evidence |
|---|---|
| M1 | A named lock acquired on the primary session is released server-side; an independent observer confirms no owner remains and the verified release contract reports one confirmed and zero unverified releases. |
| M2 | Session destruction releases the server-side lock and retires the session; the observer confirms the lock is free and the session is gone from `information_schema.PROCESSLIST`. |
| M3 | A quarantined adapter rejects further SQL with `MYSQL_SESSION_QUARANTINED`, and the post-teardown session-identity set equals the original set minus exactly the quarantined victim. |
| M4 | No adapter connection is left behind beyond the intentionally live primary and the observer. |
| M5 | A contended transaction leaves no open transaction and no further attempt. |
| M6 | The L0 transaction gate row and the production transaction path are unchanged. |
| M7 | The cleanup paths leave zero duplicate durable facts. |
| M8 | The production `transaction()` lifecycle releases the replay-miss named lock, and both the exact-replay and fingerprint-conflict reacquired locks are released; each release is proved by an independent observer. |

`§37.31.15` R2 is accepted as stated: the server-side session teardown window is not
observable from the parent, and the M2 case asserts the end state.

### 37.33.3 Preserved open dependencies

- Gate B remains `BLOCKED_BY_WAVE10` (`B-COMPOSE`, `B-M9`, `B-M10`, `B-M11`, `B-M12`,
  `B-M15`, `B-M19C`) and is not discharged, weakened or deferred. Wave 10 and Wave 11 are
  not started.
- `§37.31.15` R1–R4 remain open and unchanged.
- The remaining W7-C1 / W7-C2′ follow-up work is not declared complete. Gate B acceptance
  must still be completed and separately authorized.
- The broad global administrative grant on the disposable test account remains a disclosed
  operational risk.

### 37.33.4 Boundary and status

The freeze is limited to the accepted Gate A campaign boundary described in `document.md`
"Gate A Final Acceptance and Freeze Record (2026-10-24)". It is not a Git commit, tag,
release, deployment, migration or version change; Git closure remains pending separate user
authorization. Wave 10 remains blocked.

**Status: `GATE_A_FINAL_ACCEPTANCE_PASS — FROZEN`.**

---
