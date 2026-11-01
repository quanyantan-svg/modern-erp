# F2 — Implementation-Status Factual Clarification

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## 37.32 F2 Implementation-Status Factual Clarification (2026-10-24)

### 37.32.0 Scope

This is a **factual correction only**. It does not modify `§37.0–§37.31`, does
not reopen, redesign or reimplement F2, and changes no Requirement, Design,
implementation, test or acceptance contract.

### 37.32.1 The correction

`§37.31.0` constraint **C11** and `§37.31.13` state that F2 elapsed-time
admission control is "not implemented", citing `log/2026-10-23.md` L1216,
L1255 and L1296. **That statement is factually incorrect as of 2026-10-24.**

F2 **is** implemented. Verified against the local working tree:

- `server/modules/sales-gate-retry-admission.js` exists and exports
  `parseGateAttemptsBudgetMs()` (the configuration parser: a canonical
  positive decimal, accepted range 1000–60000 ms, default otherwise),
  `startGateRetryAdmission()` (the monotonic `process.hrtime.bigint()` clock)
  and `isGateRetryAdmissionExpired()` (the deadline comparison).
- The default budget is `DEFAULT_GATE_ATTEMPTS_BUDGET_MS = 15_000`.
- All five approved endpoints integrate it:

  | Endpoint | Integration site | Deadline cause |
  |---|---|---|
  | Manual Gate | `server/app.js:5767` | `causeCode` |
  | Sales Order Submit | `server/modules/sales-orders.js:689` | `causeCode` |
  | Manual Prepayment Evaluation | `server/modules/sales-prepayment-gate.js:452` | `cause` |
  | Reservation Intent | `server/modules/sales-reservation-intent.js:342` | `causeCode` |
  | Service Confirm | `server/modules/service-fulfillment.js:210` | `causeCode` |

- `server/sales-gate-retry-admission.test.js` provides the deterministic
  coverage and is registered in both FULL and FAST.
- `log/2026-10-24.md` (the "F2 retry-admission budget bounded implementation"
  entry) records the bounded F2 implementation.

The cited 2026-10-23 lines were accurate **on 2026-10-23**, when F2 was still
designed but not implemented. The F2 implementation landed later and was
recorded in the 2026-10-24 log. The §37.31 statement inherited the older,
already-stale wording without re-verifying it against the current source.

### 37.32.2 Effect on the Transaction Lifecycle Safety work

- This Hotfix **does not reopen, redesign, reimplement or re-test F2**. No F2
  file, constant, endpoint integration or test is modified.
- The correction changes **no behaviour**. No §37.31 design decision depended
  on F2 being absent; the only F2-dependent statements in §37.31 are the two
  factual ones corrected here.
- `§37.31.13`'s "§37.29/F2 unchanged and still not implemented (C11)" must be
  read as "§37.29/F2 unchanged (C11)". The implementation-status clause was
  wrong; the "unchanged" clause was and remains right.
- The remaining C11 obligations are unaffected and still binding: A-RAW,
  A-PROD and the MySQL safety guards remain recorded as **pending**; F2 must
  not be presented as discharging them; and no hard wall-clock execution
  bound is claimed anywhere in this design.

### 37.32.3 Boundary and status

No production source, test, schema, migration, `document.md`, `README.md`,
`package.json`, database state or Git history is changed by this clarification.
No MySQL connection, Gate execution, reset or destructive operation is
authorized by it.

**Status: `F2_IMPLEMENTATION_STATUS_CLARIFIED`.**

---
