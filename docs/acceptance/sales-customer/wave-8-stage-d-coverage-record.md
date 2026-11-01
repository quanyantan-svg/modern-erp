# Wave 8 Stage D — Implemented Capability Coverage Record

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）
## Wave 8 Stage D — Implemented Capability Coverage Record

> This record describes the implementation produced after the user accepted §35.19 and explicitly resumed Stage D. It does not change the approved Requirement, create a new global SC/Invariant/UAT/Race/CAP identity, or declare Final Acceptance/Freeze.

### Coverage delivered

- Service Fulfillment: `PENDING / CONFIRMED / CANCELLED`, Sales Group scope, SO-line capacity, confirmed immutability, zero-value operational fact, DIRECT Finance recognition, period gate, C1 parent-first Gate, audit and idempotency are implemented.
- Mixed Delivery: physical lines retain V21 OUT/valuation/COGS; service lines require confirmed fulfillment capacity and do not create physical OUT, COGS or duplicate Finance exposure.
- Finance A3: opaque invoice-source-link identity, frozen tuple uniqueness, exact posted-invoice replay, cumulative per-fulfillment quantity/cents capacity, multi-fulfillment invoice allocation, multi-source Service Credit allocation, VOID-aware capacity and weak-writer rejection are implemented without a second AR/Credit engine.
- Consignment: commercial location/document/line lifecycle, Handoff, partial/multiple Settlement, explicit-destination Return, historical continuity, reports, RBAC/scope/audit/idempotency and strict V21 tracking/valuation/COGS/Finance composition are implemented.
- V21 evidence: the approved nine nullable fields are additive on `inventory_mutation_log`; canonical Position Snapshot V1, exact OUT/IN references, request fingerprint, immutable Consignment evidence and fail-closed legacy/malformed evidence behavior are active.
- UI/API: Service Fulfillment and Consignment are contextual routes only; direct URL/refresh/navigation use the canonical registry and no global Launcher tile was added.

### Acceptance evidence boundary

The implementation includes focused SQLite functional coverage, migration/schema parity coverage, full repository gates and protected MySQL independent-session concurrency for R-SAL-20/21/22 and A3 POST/POST, POST/VOID, Credit/Credit and Credit/VOID. R-SAL-15 remains the frozen Wave 7 parent-lock regression in the combined MySQL gate. Exact command outcomes are recorded in `log/2026-10-20.md`.

Implementation evidence is not user acceptance. Wave 8 remains awaiting the user's independent Final Acceptance and must not be labelled FROZEN before that decision.
