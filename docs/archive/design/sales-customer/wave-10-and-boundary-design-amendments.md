# Sales & Customer — Wave 10 与边界设计修订（历史设计）

> 状态：`SUPERSEDED`
> Owner：Sales & Customer
> 权威来源：历史证据，非当前权威
> 来源：`solution.md` §37.0–§37.53（设计部分）（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## 37. W7-C1 / W7-C2′ Bounded Design Amendment (2026-10-23)

### 37.0 Authorization, scope and supersession map

Authorized stage: **DESIGN AMENDMENT ONLY** (AGENTS.md §4.3), under
`W7_C1_C2_BOUNDED_DESIGN_AMENDMENT`. This section reconciles and completes the
technical Design for the already-approved business Requirement. It changes **no**
approved business semantics, no table, no permission, no state machine, no
monetary unit and no frozen Wave 9 contract.

Explicitly not authorized and not performed here: Requirement changes,
Implementation, test or source code, migration or schema, database access, MySQL
execution, Git write, Wave 9 change, Wave 10/11 implementation.

Supersession map (history is preserved, never rewritten):

| Prior text | Status after this amendment |
|---|---|
| §36.13.3 partial-order proof (steps 3–4) | already invalidated in place by §36.14; remains invalid |
| §36.13.4 W7-C1 change contract | **superseded by §37.2** (same direction, completed and corrected) |
| §36.13.5 / §36.13.6 SO sequences | already marked superseded by §36.14; **replaced by §37.3 / §37.4** |
| §36.14.3 L1–L8 contract | **retained and completed by §37.3** |
| §36.14.5 W7-C2′ boundary | **completed by §37.11** (file-level detail) |
| §36.12.8 M1–M12, §36.14.6 M13–M20 | **retained; evidence design added by §37.10** |
| §36.16 Wave 9 freeze | unchanged and untouched |

### 37.1 Verified baseline facts

Every line reference below was re-verified against the working tree at
`feature/sales-waves6-13@2037cb6`. §36.13/§36.14 were written from analysis; the
following are **code-verified facts** and three of them correct the prior Design.

```text
F1  Gate call sites are exactly two per style.
    authorizeSalesPrepaymentGateForMutation  -> sales-orders.js:639 (SO submit),
                                               sales-reservation-intent.js:282
    discoverSalesPrepaymentGatePlan +
    authorizeSalesPrepaymentGateWithPlan     -> app.js:5709/5711 (SD Confirm),
                                               service-fulfillment.js:149/156
    Therefore Delivery Confirm and Service Confirm ALREADY use the two-phase
    §35.18.6 protocol. W7-C1 and W7-C2′ must not introduce a parallel gate.

F2  *** CORRECTS §36.13.5/§36.14.3 ***
    `salesOrderAction` 'approve' does NOT invoke the prepayment gate.
    Only the submit branch (sales-orders.js:639) does. 'approve' shares the
    :647-649 branch with 'reject' and takes no gate and no Credit check today.
    §36.13.5:20511 ("both are credit-controlled ... and both can reach the gate")
    is inaccurate about today's code. It is accurate about the Wave 10 target
    state. W7-C2′ is therefore specified for the *post-Wave-10* Approve shape,
    and today-only behaviour is preserved (see §37.4).

F3  evaluateSalesPrepaymentGate locks REQUIREMENT before RESULT
    (gate.js:399 before :401), inverting edge E3 as well as E5.
    Both inversions are corrected together in §37.2.

F4  evaluateSalesPrepaymentGate computes the business date TWICE inside the
    transaction — gate.js:396 and gate.js:405-406 each call now() when
    body.businessDate is absent. A midnight rollover between the two produces
    two different business dates for one transaction. Must be bound once.

F5  CONFIRMED MONETARY DEFECT (server/modules/financial-controls.js:194-195):
    createRefund reads `unappliedBalanceSnapshot(...).remainingCents` and
    rejects BEFORE the transaction (:194-195), acquires the canonical parent
    lock at :205, and NEVER re-reads capacity under that lock.
    Contrast applyUnappliedBalance, which DOES re-read at :163-164, and
    reverseSettlementDocument (settlement.js:341 then :345), which also
    re-reads. createRefund is the only PREPAYMENT-reducing Finance path with
    no post-lock authority check. Corrected by §37.6.

F6  The global MySQL transaction gate (db.js:1893,
    `SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE`)
    is taken by `transaction()` BEFORE any business row on every MySQL
    transaction. Consequence for acceptance evidence: production MySQL business
    transactions are serialized at the gate row, so no two production
    transactions can concurrently hold business row locks. Existing Wave 7
    concurrency evidence proves SERIALIZED PRODUCTION OUTCOMES, not row-level
    lock order. See §37.10(F).

F7  transaction(db, work) is db.js:1883-1913. It retries ONLY the work callback,
    bounded by ERP_DB_TX_RETRY_MAX (default 3 -> 4 attempts), matching
    ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT / errno 1213 / 1205 / sqlState
    40001, backoff min(250, 20*2^n). It has NO options parameter, NO
    caller-supplied outer retry and NO nesting guard. Re-executed attempts reuse
    the closure's captured plan. See §37.8.

F8  SD Confirm re-reads rows that the canonical capacity helper already locked.
    app.js:5715 and :5718 use plain SELECT, while
    sales-delivery-source.js:52 and :54 already hold FOR UPDATE on those exact
    rows. Under REPEATABLE READ a plain SELECT returns the transaction snapshot,
    not the latest committed row, so :5716/:5719/:5720 may validate against a
    stale image. The helper already returns the locked rows
    (sales-delivery-source.js:79). Corrected by §37.7.
```

### 37.2 W7-C1 final transaction sequence — `evaluateSalesPrepaymentGate()`

Target: `server/modules/sales-prepayment-gate.js`, `evaluateSalesPrepaymentGate`,
transaction body `:387-434`. Single canonical transaction, twelve ordered stages:

```text
D0  UNLOCKED DISCOVERY (outside the transaction)
    - order already loaded at :374; requirement already looked up at :376
    - bind `asOf` ONCE (fixes F4) and reuse it for every later use
    - plan = discoverSalesPrepaymentGatePlan(db, salesOrderId, asOf)
      -> parentBalanceIds [], because a missing requirement means an empty,
         valid, conservative candidate set (adapter.js:44)
D1  caller-owned transaction(db, work) opens; MySQL gate row L0 acquired
    automatically (db.js:1893). Not modified.
D2  replay probe gate.js:388 — unchanged, no lock, runs before any lock
D3  assertFinancialPeriodsOpen — unchanged, read-only
D4  L1  lockEligiblePrepaymentParents(db, plan.parentBalanceIds)
      SKIPPED ENTIRELY when the set is empty; never an error, never a
      late acquisition
D5  assertPrepaymentParentPlanCurrent(db, {customerId, businessDate: asOf},
      plan.parentBalanceIds)  -> 409 SALES_PREPAYMENT_LOCK_PLAN_STALE
D6  L6  GATE_RESULT  FOR UPDATE   (previous/latest result, gate.js:400-401)
D7  L7  GATE_REQUIREMENT FOR UPDATE (re-read of the requirement, gate.js:213)
      -> also re-validates effective window under the lock
D8  re-read canonical Finance child effects beneath the parent locks via
    resolveEligiblePrepaymentWithParentPlan(..., plan.parentBalanceIds)
    which internally uses lockMode 'NONE' (adapter.js:92-96). MUST NOT call
    resolveEligiblePrepaymentForSalesGate with lockMode 'FOR_UPDATE' here —
    that is the late parent acquisition being removed.
D9  decideGate(...) — byte-identical decision logic, unchanged
D10 INSERT sales_prepayment_gate_results (snapshotKey = appliedSnapshotKey)
D11 audit AUTHORIZE/EVALUATE + override reason/actor handling :419-421 unchanged
D12 COMMIT; on any throw the whole transaction rolls back to zero partial
    effects (no gate row, no audit row, no snapshot).
```

Mandatory edge restored: `PARENT → GATE_RESULT → GATE_REQUIREMENT`, identical to
Path B/B′ (`gate.js:276→278→280`) and satisfying E1, E2, E3 and E5. No newly
discovered parent may be locked after D6/D7; D5 converts that situation into a
409 rather than a late lock.

Required behaviour for every named scenario:

| Scenario | Detection point | Outcome |
|---|---|---|
| Empty parent set | D4 skipped; D5 compares `[]` | normal `NOT_REQUIRED`/PASS/WARN/BLOCK path, no error |
| New parent appears after D0 | D5 set mismatch | 409 `SALES_PREPAYMENT_LOCK_PLAN_STALE`, full rollback |
| Parent disappears | D5 set mismatch | same 409; adapter.js:50 would also raise if already locked |
| Parent closing (`status!='OPEN'`) | adapter.js:51 under the lock | 409 `结算余额已关闭`, full rollback |
| Requirement amount/period changed | D7 re-read vs D0 fingerprint | 409 stale, full rollback |
| Previous Gate Result changed | D6 locking read | read latest committed row; `decideGate` override carry-forward unchanged |
| Concurrent refund | serialized on L1; refund post-lock authority (§37.6) | no lost update, no negative capacity |
| Concurrent application | serialized on L1 (`applyUnappliedBalance:160`) | same |
| Concurrent UNAPPLIED reversal | serialized on L1 (`settlement.js:341`) | same |

`PASS / WARN / BLOCK / OVERRIDE_REQUIRED` semantics, snapshot-key idempotency,
replay, HTTP status codes, override handling and audit payload are unchanged. This
is lock *acquisition order* only. No second monetary authority is introduced: the
Gate continues to read Finance through the single canonical adapter.

### 37.3 W7-C2′ parent-independent total lock order (L1–L8)

L1 is **optional** and skipped entirely when the discovered parent set is empty.
L2–L8 are **total**. L8 last is the load-bearing correction.

| Stage | Row set | Lock | Owner | Condition |
|---|---|---|---|---|
| L0 | `mysql_transaction_gates` gate_id=1 | U | `transaction()` db.js:1893 | MySQL only; unchanged |
| L1 | `settlement_unapplied_balances` PREPAYMENT parents | U, id ASC | Finance adapter `lockEligiblePrepaymentParents` | only when the discovered eligible set is non-empty |
| L2 | Credit `POLICY_SCOPE` anchor | S, anchor_key ASC | Credit (Wave 10) | Credit-controlled action only |
| L3 | Credit `CREDIT_OBJECT_AGGREGATE` anchor | U | Credit (Wave 10) | Credit-controlled action only |
| L4 | Credit `CREDIT_OBJECT_SALESPERSON` anchor | U | Credit (Wave 10) | at most one |
| L5 | `credit_profile` / `credit_check_rules` | U, id ASC | Credit (Wave 10) | Credit-controlled action only |
| L6 | `sales_prepayment_gate_results` latest for stage | U | Gate | always |
| L7 | `sales_prepayment_requirements` effective row | U | Gate | only when a requirement is in effect |
| L8 | `sales_orders`, then `sales_order_items`, delivery/fulfillment/capacity rows | U, stable ascending id | Sales | always, LAST |

**Empty parent set.** L1 is skipped. Crucially, skipping L1 does **not** permit L8
to be reached before L2–L7: the ordering is enforced by *position*, not by the
existence of a physical L1 row lock. A missing parent therefore never authorizes
Sales Order locking ahead of Credit and Gate stages. This is the defect §36.14
identified against the §36.13.5 ordering and it is structurally impossible under
§37.3 because L8 is unconditionally last.

**Wave 10 Credit composition (described, not implemented).** Wave 9 already ships
`ensureCreditLockAnchor` (credit-anchor.js:72-90), which takes exactly one row —
the anchor row for a given `anchor_key` — FOR UPDATE, and takes no other Credit
lock. Wave 10's Credit Check is the first caller that needs L2→L3→L4→L5 in that
order. Composition rule for Wave 10: the Credit Check executes strictly between L1
and L6, acquires anchors in L2/L3/L4 order and profiles/rules at L5, and performs
no Sales or Finance business-row lock. Finance keeps sole ownership of L1;
Sales keeps sole ownership of L8. Wave 9's frozen Credit Foundation is not
modified by this amendment, and no Wave 10 code is introduced here.

### 37.4 Caller-by-caller lock-order graph

```text
MANUAL EVALUATION (evaluateSalesPrepaymentGate)     post W7-C1
  L1? -> L6 -> L7                                        (no Sales row lock)

SALES ORDER SUBMIT                                     post W7-C2'
  L1? -> L6 -> L7 -> L8                                 (Credit L2..L5 inserted by Wave 10
                                                         at the same point)

SALES ORDER APPROVE
  today (F2)   : L8 only, no gate, no Credit
  post Wave 10 : L1? -> L2..L5 -> L6 -> L7 -> L8
                 Approve today invokes no gate, so post-W7-C2' its *current*
                 sequence is unchanged; the future sequence only becomes
                 reachable once Wave 10 inserts Credit. The Design does not
                 introduce a gate call into Approve.

SALES ORDER REJECT / CLOSE / CANCEL                    UNCHANGED
  L8 only. No gate, no Credit, no parent lock.
  close/cancel calls assertNoPendingDeliveryNotice (sales-orders.js:546-553),
  a PLAIN SELECT over delivery_notices. It takes no delivery lock, so the
  SO-then-delivery shape does not invert SD Confirm's delivery-then-SO shape.

SERVICE FULFILLMENT CONFIRM                            unchanged order, tightened validation
  L1? -> L6 -> L7 -> L8(sales_order_items) -> service_fulfillments ->
        Finance recognition/open-item

SALES DELIVERY CONFIRM                                 unchanged order, tightened validation
  L1? -> L6 -> L7 -> L8(sales_deliveries -> sales_orders -> sales_order_items
        -> delivery_notices -> delivery_notice_lines)
        then OQC -> Inventory/valuation/COGS -> AR/vouchers

RESERVATION INTENT REQUEST                             post convergence (§37.5)
  L1? -> L6 -> L7 -> Planning/Inventory rows

FINANCE applyUnappliedBalance                           already conforms
  L1 -> re-read capacity (:163) -> movement

FINANCE createRefund                                   corrected (§37.6)
  L1 -> re-read capacity -> voucher/settlement/refund/idempotency/audit

FINANCE reverseSettlementDocument (UNAPPLIED)          already conforms
  L1 (settlement.js:341) -> re-read capacity (:345)

CREDIT POLICY / PROFILE MUTATION                       unchanged
  L2/L3/L5, no L1, no gate, no L8
```

Reverse-edge check: the only caller that locks a Sales row before an earlier
stage was SO Submit/Approve/Reject/Close/Cancel at `sales-orders.js:620`, where
the Sales Order is locked immediately after the transaction opens. After
W7-C2′, submit/approve lock it at L8; reject/close/cancel legitimately own L8
alone and take no earlier-stage row. `delivery-notices.js:27`,
`sales-order-changes.js:134`, `sales-delivery-source.js:54`,
`sales-orders.js:487` and `sales-orders.js:521` lock `sales_orders` and never call
the gate or Credit, so none can participate in an L1/L6/L7 cycle. **No reverse
business-row edge remains in the proposed graph.**

### 37.5 Reservation Intent parent-plan convergence

Current shape (`sales-reservation-intent.js:276-288`): the transaction opens, then
`authorizeSalesPrepaymentGateForMutation` performs identity discovery **inside**
the transaction (gate.js:189, :196) and locks parents immediately after
(gate.js:197). It therefore locks PARENT before RESULT and REQUIREMENT — already
correct on E1/E2/E3 — but it never validates the candidate set
(`assertPrepaymentParentPlanCurrent` is not on this path), so a parent appearing
between the in-transaction discovery read and the lock is silently absorbed
instead of failing closed.

**Helper reuse decision: reuse, with a bounded ordering refinement. No parallel
gate is created.** `discoverSalesPrepaymentGatePlan` + `authorizeSalesPrepaymentGateWithPlan`
are the already-canonical two-phase helpers, already used by Delivery Confirm and
Service Confirm (F1). The reservation path converges onto them:

```text
OUTSIDE the transaction (after :268-271 duplicate check, before transaction())
  plan = discoverSalesPrepaymentGatePlan(db, salesOrderId, asOf)

INSIDE the transaction, replacing the :282 call
  authorizeSalesPrepaymentGateWithPlan(db, plan, { stage: 'RESERVATION',
    actorId, mutationKey: `ACTION|RESERVATION|REQUEST|${intentId}` })
```

Requirements satisfied:

- No late Finance parent acquisition after Gate locks — the parent lock is inside
  the two-phase helper at gate.js:276, before RESULT (:278) and REQUIREMENT (:280).
- Parent IDs are acquired ascending — adapter.js:77 sorts.
- Current parent-set validation — adapter.js:82-90, raising
  `SALES_PREPAYMENT_LOCK_PLAN_STALE`.
- Stale plan fails closed, whole transaction rolls back.
- Planning / Inventory mutation contract preserved — the `INVENTORY_LOCK`,
  `MANUAL_RESERVATION`, `ON_HAND_RESERVATION` and `EXPECTED_SUPPLY_RESERVATION`
  adapters are untouched; because the gate call happens first in the transaction
  and the adapters run after, a gate rejection leaves no `inventory_locks` row, no
  `planning_reservations` row and no `sales_reservation_intent` row.
- Audit and idempotency unchanged — the gate's own audit and the intent audit are
  as today; `mutationKey` is passed through byte-identically.
- SQLite compatible — `lockSuffix(db)` yields an empty suffix on SQLite, so the
  helper degrades to plain reads exactly as the current path does.

**Declared behavioral difference (deliberate, concurrency-only).** When a
requirement is in effect at discovery but leaves its effective window before the
lock, `authorizeSalesPrepaymentGateForMutation` returns `NOT_REQUIRED`
(gate.js:215) while `authorizeSalesPrepaymentGateWithPlan` throws 409 stale
(gate.js:282). This is reachable **only** under a concurrent requirement change.
For every non-concurrent case the outcomes are identical, because
`discoverSalesPrepaymentGatePlan` filters by `effectiveAtNow` at discovery and
therefore returns `requirementId: null` / fingerprint `NONE` for an out-of-range
requirement, which the helper maps back to `NOT_REQUIRED` at gate.js:273. The
concurrent case is a fail-closed narrowing already mandated by §36.14.6 M17/M18
and by the approved stale-plan contract. If Acceptance judges this narrowing a
business-rule change, it must return to Requirement; it is called out here rather
than absorbed silently.

**Bounded ordering refinement shared with Delivery/Service.** In
`authorizeSalesPrepaymentGateWithPlan` the parent-plan assertion currently runs
via `resolveEligiblePrepaymentWithParentPlan` at gate.js:285, i.e. after the
RESULT and REQUIREMENT locks. The Design moves one assertion earlier — call
`assertPrepaymentParentPlanCurrent` immediately after the parent lock at gate.js:276
— so every gate path shares the identical `PARENT -> assert -> RESULT ->
REQUIREMENT` shape required by §37.2. The later re-assert inside
`resolveEligiblePrepaymentWithParentPlan` is retained unchanged as defence in
depth; it is idempotent and cheap.

### 37.6 Finance Refund post-lock monetary authority

Defect F5 confirmed. The correction is confined to `createRefund`
(`financial-controls.js:188-220`).

```text
UNLOCKED PRECHECK (retained, fast rejection only)
  :192 loadBalance          -> identity only, not capacity authority
  :194-195 amount > available -> 409 fast rejection
  :200 idempotencyReplay    -> unchanged
INSIDE transaction (:201)
  :205 acquireParentBalanceLock(db, balance.id)   <-- canonical lock, L1
  NEW  re-read the locked balance row and re-assert side / party_id
       (the row is already locked; a re-SELECT under the held lock is free)
  NEW  currentAvailable = unappliedBalanceSnapshot(db, balance.id).remainingCents
       -- the SAME canonical formula as the precheck; this post-lock value is
          the ONLY monetary authority for confirmation
  NEW  amount > currentAvailable -> 409, full rollback, zero side effects
  NEW  currentAvailable < 0      -> 409 distinct code, full rollback.
       A negative remaining balance is an existing over-refund defect and must be
       SURFACED, never self-healed (AGENTS.md §6: GET/CHECK must not silently
       repair history).
  :212 voucher, :213 refund row, :215 settlement movement, :216 idempotency
  record, :217 audit -> all unchanged and atomic with the above
```

Authoritative remaining capacity is unchanged and comes from the single canonical
Finance formula (`settlement-core.js:200-210`):

```text
remaining = original_amount_cents
          - SUM(balance_applications.amount_cents   WHERE status='CONFIRMED')
          - SUM(financial_refunds.amount_cents      WHERE status='CONFIRMED')
          - (PREPAYMENT: SUM(settlement_reversal_items.amount_cents
                             WHERE component_type='UNAPPLIED')
                           AND original_component_id = balance.id)
            (CREDIT:    SUM(credit_reversal_components.unapplied_cents
                             WHERE credit_id = balance.source_id))
```

Race outcomes:

1. **Refund vs Refund (different keys).** Both pass the precheck. Both enter the
   transaction and serialize on L1. The second one re-reads under the lock,
   observes the first refund's CONFIRMED row, and rejects if capacity is
   exhausted. Before the fix both would commit and drive remaining negative.
2. **Refund vs Apply.** Both take L1; `applyUnappliedBalance` already re-reads at
   :163. Serialized; one may reject with 409; no over-application.
3. **Refund vs UNAPPLIED reversal.** `reverseSettlementDocument` already locks at
   settlement.js:341 and re-reads at :345. Serialized on the same balance row.
4. **Successful exact replay.** `idempotencyReplay` at :200 returns the stored
   result before the transaction; unchanged. No second voucher, movement, refund
   row or audit row.
5. **Same key, conflicting request.** `idempotencyReplay` raises 409 at
   `financial-controls.js:55`; unchanged.
6. **Rollback and retry exhaustion.** Any throw rolls back voucher, movement,
   refund row, idempotency record and audit together. `transaction()` rethrows a
   deadlocked attempt with `transactionRetryExhausted` after the bounded budget
   (F7); no partial effect survives.

**Non-PREPAYMENT refunds are not silently changed.** `acquireParentBalanceLock`
already takes FOR UPDATE on every balance type (adapter.js:215) and returns null
only as a type test, so the post-lock re-read is correct for CREDIT balances too.
The added checks use the same `unappliedBalanceSnapshot` formula already used by
the precheck, and add no new business condition beyond "re-read under the lock".

**Observed divergence, reported not fixed (§37.13 D1).** For a PREPAYMENT balance,
`unappliedBalanceSnapshot` (settlement-core.js:206) sums UNAPPLIED reversal items
**without** joining `settlement_reversals.status='CONFIRMED'`, while the Gate
adapter's `readReversalCents` (adapter.js:113-118) **does** filter on
`'CONFIRMED'`. A POSTED-but-not-CONFIRMED reversal therefore reduces refund/apply
capacity while not reducing Gate eligibility. Both formulas are frozen and both
are currently in use. Changing either is a Finance-semantics change outside this
Design's authorization, so it is reported as an open item for a separate
Requirement/Design decision, not corrected here.

### 37.7 Delivery Confirm and Service Confirm final fingerprint contract

Both paths already perform unlocked discovery and use the two-phase gate
(F1). The gap is the **final** revalidation: neither path re-verifies its
discovery facts under the Sales row lock it ultimately holds.

Two fingerprints are defined. Both are derived from the existing
`discoverSalesPrepaymentGatePlan` shape; no new table or column is introduced.

```text
DISCOVERY FINGERPRINT (immutable, captured outside the transaction)
  order        : id | customer_id | status | total_cents | sales_group_id
  requirement  : id | required_amount_cents | effective_from | effective_to | NONE
  parents      : ascending eligible PREPAYMENT parent id list
  source-specific additions:
    Delivery   : sales_deliveries.id | customer_id | status | delivery_date |
                 warehouse_id | total_cents
    Service    : service_fulfillments.id | sales_order_id | sales_order_item_id |
                 customer_id | business_date | confirmation_state | version

FINAL-LOCK FINGERPRINT (recomputed under the L8 Sales lock, inside the transaction)
  - the same fields, read with a LOCKING read
  - plus the source-identity set:
    Delivery : every sales_delivery_items.sales_order_item_id must still belong to
               the same order, with identical product_id and unit_price_cents;
               delivery_notice_lines still bound to the same notice and item
    Service  : sales_order_items row unchanged (product, quantity, amount_cents,
               payment_terms_days) and the fulfillment row still PENDING at the
               expected version
```

Required sequence and rules:

1. Initial discovery before the transaction — already satisfied (app.js:5700,
   :5709; service-fulfillment.js:147, :149).
2. Parent-first canonical locking — already satisfied (gate.js:276).
3. Gate Result and Requirement validation — already satisfied (gate.js:278, :280),
   plus the §37.5 ordering refinement.
4. Final Sales/business row locking in the approved order — already satisfied
   (sales-delivery-source.js:52→54→58→65→66; service-fulfillment.js:163→164).
5. **Final authoritative comparison after acquiring the relevant Sales lock** —
   NEW. For Delivery, the comparison must consume the rows already returned by
   `lockAndConsumeSalesDeliveryCapacity` (`{delivery, order}`,
   sales-delivery-source.js:79) instead of the plain re-SELECTs at app.js:5715
   and :5718-5720, which under REPEATABLE READ return the transaction snapshot
   rather than the latest committed image (F8). For Service, the comparison is
   taken from the `sales_order_items` row locked at :163 and the fulfillment row
   locked at :164, replacing reliance on the unlocked `unlocked` snapshot at :160.
6. Customer, status, totals, group, requirement identity and approved source
   identities verified — any mismatch raises 409
   `SALES_PREPAYMENT_LOCK_PLAN_STALE` (or the caller's existing specific code
   where one already exists) and rolls the whole transaction back.
7. Stale or newly appearing parent/source candidates are handled without any late
   inverse lock: the plan assertion converts candidate drift into a 409; no
   additional parent row is ever locked after L6/L7.
8. No downstream posting on a stale plan — OQC, Inventory, valuation, COGS, AR,
   vouchers, capacity writes, audit and idempotency all sit after the final
   comparison and roll back together with it.

Preserved unchanged: OQC gating, Inventory/valuation ownership, COGS, AR
recognition, voucher generation, delivery-capacity tolerance, audit payloads and
idempotency semantics. `SERVICE_FULFILLMENT_VERSION_CONFLICT`,
`SERVICE_FULFILLMENT_STATE_CONFLICT`, `SERVICE_DELIVERY_CAPACITY_EXCEEDED`,
`SALES_PREPAYMENT_GATE_*` and the existing 409 shapes are reused as-is; **no new
business state or status code is introduced**. Stale discovery maps to 409 and is
retryable only through §37.8.

### 37.8 Outer discovery retry model

`transaction(db, work)` retries the callback only, against a captured plan (F7).
Stale-plan recovery therefore requires a **caller-owned outer attempt model**,
with no nesting and no unbounded retries.

```text
OUTER ATTEMPT MODEL (per gate-participating entry point)
  budget = ERP_GATE_ATTEMPTS_MAX, default 3 -> at most 3 OUTER attempts
  for attempt in 1..budget:
      plan = discover...(db, ...)                 # fresh, unlocked, authoritative
      try:
          transaction(db, () => { L1?..L8; validate; mutate; audit; idempotency })
          return success
      catch e:
          if e is business 409 (stale / capacity / state / SOD / gate block):
              RETRY IS NOT PERMITTED unless the error is one of the two
              explicitly re-discoverable classes below
          if e is SALES_PREPAYMENT_LOCK_PLAN_STALE or the §37.7 final-fingerprint
              mismatch:  backoff and re-discover, next outer attempt
          if e is deadlock/lock-wait (1213/1205/ER_LOCK_*): transaction() has
              already retried internally; on exhaustion the OUTER loop may
              re-discover once more, bounded by the same budget
          if budget exhausted: fail closed, HTTP 503 retryable, zero side effects
```

Strict differentiation:

| Class | Inside `transaction()` | Outer loop | Effect |
|---|---|---|---|
| Deadlock / lock-wait | retried up to `ERP_DB_TX_RETRY_MAX` on the same captured plan | may re-discover after exhaustion | ordinary contention |
| Stale plan / final fingerprint | not retried; raised as a 409 | re-discover, then retry | the only re-discovery class besides exhaustion |
| Business 409 (BLOCK, capacity, SOD, state) | not retried | **never retried** | fail closed |
| Idempotent replay | not an error | never re-executed | stored result returned, no duplicate effect |

Guarantees:

- No nested `transaction()` — the outer loop owns discovery, the inner owns one
  attempt; `transaction()` is called exactly once per outer attempt.
- Every failed attempt leaves zero audit row, voucher, Gate Result, Finance
  movement, inventory mutation or idempotency record, because the entire attempt
  body is one transaction.
- Counting: outer attempts are counted per request; inner `transaction()`
  attempts are counted per outer attempt and are reported separately
  (`transactionAttempts`). Exhaustion of either surfaces as 503 retryable.
- Connection lifetime: a deadlock victim connection is rolled back by
  `transaction()` (db.js:1901) and reused; the worker's bounded cleanup contract
  is unchanged. Rediscovered plans do not carry state across connections.
- Final HTTP behaviour: 409 for stale-plan rejection while budget remains, 503
  retryable on exhaustion, original business code otherwise.

`server/db.js` and `mysql_transaction_gates` are **not** modified by this Design.

### 37.9 Deadlock / retry / error matrix

| Condition | Stage | Error | Rollback | Retry |
|---|---|---|---|---|
| Parent set changed | D5 / gate.js:276 | 409 `SALES_PREPAYMENT_LOCK_PLAN_STALE` | whole tx | outer re-discovery |
| Parent closed | adapter.js:51 | 409 `结算余额已关闭` | whole tx | outer re-discovery |
| Requirement out of window under lock | D7 / gate.js:282 | 409 stale | whole tx | outer re-discovery |
| Final fingerprint mismatch | L8 revalidation | 409 stale (or caller code) | whole tx | outer re-discovery |
| Gate BLOCK | decideGate | 409 `SALES_PREPAYMENT_GATE_BLOCKED` | whole tx | never |
| Gate OVERRIDE without reason | assertPermittedGateRow | 409 `..._OVERRIDE_MISSING_REASON` | whole tx | never |
| Refund capacity exhausted post-lock | §37.6 | 409 refund capacity | whole tx | never |
| Negative remaining balance post-lock | §37.6 | 409 distinct code | whole tx | never |
| SOD violation (creator = approver) | L8 revalidation | 409 | whole tx | never |
| Deadlock victim | any | 1213 | whole tx | inner ≤3, then outer re-discovery |
| Lock wait timeout | any | 1205 | whole tx | inner ≤3, then outer re-discovery |
| Retry exhausted | — | 503 retryable | zero effects | no |

Invariant: **retry must never be used to mask an ordering defect.** A cycle that
survives W7-C1/W7-C2′ is a design defect to be fixed, not retried away.

### 37.10 Acceptance evidence design

The approved plan cannot rest on global-gate serialization alone (F6). Evidence
is stratified so that each claim is made only by the layer that can actually
prove it.

```text
A  STATIC SQL / CALL-ORDER ASSERTIONS
   Focused tests asserting, from source, that:
     - evaluateSalesPrepaymentGate acquires parent before RESULT before
       REQUIREMENT and never calls the FOR_UPDATE resolve path
     - no gate-participating path locks sales_orders before its Gate locks
     - createRefund re-reads capacity after acquireParentBalanceLock
     - no lockEligiblePrepaymentParents call appears after a RESULT/REQUIREMENT
       lock in any gate path
   These prove INTENDED ORDER ONLY. They prove nothing about runtime behaviour.

B  REAL PRODUCTION API REGRESSION
   The existing Wave 7 focused/functional/acceptance suites, unchanged in intent,
   re-run after the correction. Proves business outcomes and preserved
   semantics; no deadlock expectation is attached.

C  REAL INDEPENDENT MySQL SESSIONS
   Existing pattern: >=3 distinct CONNECTION_ID()s, real createApp + HTTP login,
   real production entry points (worker actions), control worker holding the gate
   row, overlap proven via information_schema.PROCESSLIST.

D  PROTECTED RAW ROW-LEVEL LOCK CONTENTION  (justified, bounded, separate)
   Because production `transaction()` serialises every MySQL transaction at the
   L0 gate row (F6), C CANNOT observe two sessions contending for a business row.
   Row-level lock-order evidence therefore requires RAW sessions that open their
   own BEGIN and issue explicit SELECT ... FOR UPDATE in the exact L1..L8 order,
   WITHOUT the canonical gate row. Rules:
     - disposable MySQL only, explicit reset guard, never a non-disposable schema
     - raw sessions may assert LOCK ACQUISITION / WAIT ORDER and lock-wait
       behaviour ONLY
     - raw sessions may NOT assert any business outcome, and may NOT be reported
       as production behaviour
     - the production gate is never disabled, bypassed or reconfigured; the raw
       probe simply does not use `transaction()`

E  STRICT SEPARATION
   Reports must label every result as one of: PRODUCTION_SERIALIZED_OUTCOME,
   RAW_ROW_LEVEL_LOCK_ORDER, or STATIC_INTENT. Never merge the three.

F  PRE- vs POST-CORRECTION
   M1/M7-style fixtures must FIRST be shown to deadlock against the pre-fix
   ordering in environment D. A fixture that only passes after the fix has not
   demonstrated that the defect existed, and cannot be reported as a reproducer.

G  FAILURE-SIDE-EFFECT ASSERTIONS
   Every rejection path must assert zero rows in: sales_prepayment_gate_results,
   credit_check_results, financial_refunds, financial_refund_reversals,
   accounting_vouchers, accounting_entries, settlement_account_movements,
   balance_applications, settlement_reversal_items, service_fulfillments,
   sales_deliveries, inventory_transactions, inventory_mutation_log,
   idempotency_records, and no audit row for the rejected decision.

H  SCHEMA PARITY AND SQLite COMPATIBILITY
   No schema change is introduced, so parity is asserted by regression: the
   focused suite passes on SQLite (lockSuffix collapses to a plain read) and the
   same assertions hold on MySQL.
```

M1–M20 mapping, with the evidence layer that can actually prove each:

| # | Case | Layer | Notes |
|---|---|---|---|
| M1 | Manual Eval vs SO Submit, same order | D + F | the W7-C1 reproducer; must deadlock pre-fix |
| M2 | Manual Eval vs Gate Authorization, same order | D | |
| M3 | Manual Eval vs Gate Auth, different orders, same customer | C | parent present |
| M4 | SO Submit vs `applyUnappliedBalance` | D | |
| M5 | SO Submit vs `createRefund` | D + G | post-lock capacity now authoritative |
| M6 | SO Submit vs UNAPPLIED reversal | D | |
| M7 | SO Submit vs SD Confirm, same order | D + F | the W7-C2′ reproducer; must deadlock pre-fix |
| M8 | Reservation Intent vs Prepayment Gate | C + D | convergence target |
| M9 | Credit Check vs SO Submit | D | **Wave 10 only**; not runnable pre-Wave-10, must be reported as blocked, not passed |
| M10 | Two salespersons, one aggregate | D | Wave 10 only; assert §36.8.1 preconditions or the fixture is declared unconstructible |
| M11 | Credit Profile mutation vs active check | D | Wave 10 only |
| M12 | Special Approval vs policy mutation | D | Wave 10 only |
| M13 | **Empty parent: SO Approve vs SD Confirm** | D + F | the §36.14.2 concealed cycle; with an empty parent set L1 is skipped and L8-last still holds |
| M14 | **Empty parent: SO Submit vs SD Confirm** | D + F | |
| M15 | Empty parent, two salespersons, one aggregate | D | Wave 10 only |
| M16 | Non-empty parent: manual eval vs SO Submit | D | must be reported as the parent-locked path, distinct from M13/M14 |
| M17 | Stale discovered parent set | C + G | 409 + zero side effects |
| M18 | Newly created eligible prepayment appears | C + G | must never be silently locked late |
| M19 | No-prepayment Credit Check still fails closed | C | Wave 10 only for the Credit half; the `NOT_REQUIRED` half is testable now |
| M20 | SO state revalidation fails after Gate calculation | C + G | no committed Credit or Gate evidence |
| **M21** | **Refund vs Refund, different keys** | C + D + G | §37.6 scenario 1; asserts remaining never negative |
| **M22** | **Refund vs Apply** | C + D + G | §37.6 scenario 2 |
| **M23** | **Refund vs UNAPPLIED reversal** | C + D + G | §37.6 scenario 3 |
| **M24** | **Exact replay / same-key conflict** | C + G | no duplicate monetary effect |
| **M25** | **Retry exhaustion and deadlock-victim rollback** | C + G | outer budget exhausted → 503, zero effects |

M9–M12, M15 and M19(Credit) require Wave 10 code that does not exist. They are
specified now and **must be reported as BLOCKED, never as PASS**, until Wave 10
exists. Existing Wave 9 concurrency evidence (106/106, per §36.16.3) proves
serialized Credit-anchor outcomes; it does not and cannot prove L2–L5 ordering.

### 37.11 Future implementation file manifest (design only — nothing implemented)

```text
1  server/modules/sales-prepayment-gate.js
   why        : W7-C1 inversion (F3) and the L1->assert->L6->L7 shape
   function   : evaluateSalesPrepaymentGate (:369-436)
   reuse      : discoverSalesPrepaymentGatePlan, lockEligiblePrepaymentParents,
                assertPrepaymentParentPlanCurrent,
                resolveEligiblePrepaymentWithParentPlan, decideGate
   change     : bind asOf once; D0 plan outside; D4/D5 before the RESULT lock;
                reorder RESULT before REQUIREMENT; resolve with lockMode NONE
   preserved  : decision logic, override, snapshot key, audit, HTTP codes, replay
   tests      : static order assertion + M1/M2/M16 stale-plan + replay regression
   compat     : SQLite unaffected (lockSuffix collapses); no schema change
   risk/rollbk: reverting restores the pre-existing E3/E5 inversion only; no
                persisted state changes, so rollback is a pure code revert

2  server/modules/sales-prepayment-gate.js
   why        : §37.5 ordering refinement shared by all gate paths
   function   : authorizeSalesPrepaymentGateWithPlan (:261-300)
   change     : call assertPrepaymentParentPlanCurrent immediately after the
                parent lock at :276; keep the later re-assert unchanged
   preserved  : NOT_REQUIRED outcomes, decision, audit, snapshot key
   risk       : fail-closed earlier; a concurrent requirement change now 409s
                earlier. Behaviour-preserving for all non-concurrent cases.

3  server/modules/sales-orders.js
   why        : W7-C2′ E6 inversion at :620
   function   : salesOrderAction (:609-662)
   reuse      : assertGroupScope, requestFingerprint, idempotencyReplay,
                saveIdempotency
   change     : discovery + fast validation above :619 for submit/approve only;
                L1? parent plan + assertion; L6/L7 gate; move the
                SELECT ... FOR UPDATE to the L8 position; full revalidation of
                status, customer, salesperson, total, group, business date and
                plan identities under L8; re-run :622-638 checks under L8
   preserved  : RBAC (ORDERS_SUBMIT / ORDERS_APPROVE), SOD at :647-649, HTTP
                contracts, idempotency, audit payloads
   unchanged : reject / close / cancel keep the L8-only shape (F2, and the
                approve/reject shared branch must be split so reject is not
                dragged through the Credit/Gate stages)
   tests      : static order assertion + M7/M13/M14/M20 + submit/approve
                functional regression + reject/close/cancel regression
   risk       : status read moves after validations; SOD must be re-verified
                under the L8 re-read

4  server/modules/sales-reservation-intent.js
   why        : in-transaction discovery with no plan-currency assertion
   function   : requestReservationIntent (:228-...)
   reuse      : discoverSalesPrepaymentGatePlan,
                authorizeSalesPrepaymentGateWithPlan (existing canonical pair)
   change     : discover the plan outside the transaction; replace the :282
                authorizeSalesPrepaymentGateForMutation call
   preserved  : all four reservation adapters, duplicate check, audit,
                idempotency, Planning/Inventory ownership, SQLite behavior
   tests      : M8 + M17/M18 on the reservation path; assert no orphan
                inventory_locks / planning_reservations / intent row on failure
   compat     : no schema change; mutationKey byte-identical
   risk       : the declared concurrency-only difference in §37.5

5  server/modules/financial-controls.js
   why        : F5 confirmed monetary defect
   function   : createRefund (:188-220)
   reuse      : acquireParentBalanceLock, unappliedBalanceSnapshot,
                idempotencyReplay, saveIdempotency, recordSettlementMovement
   change     : re-read the locked balance row and post-lock remaining under the
                L1 lock; reject amount > currentAvailable and negative remaining
   preserved  : fast precheck, voucher, movement, refund row, idempotency, audit,
                non-PREPAYMENT semantics, HTTP contracts
   tests      : M21/M22/M23/M24 + static assertion that the re-read follows
                acquireParentBalanceLock + failure-side-effect assertions
   risk       : a previously accepted over-refund would now surface as 409; this
                is the intended fail-closed behaviour, not a regression
   roll back   : code revert only; no persisted state changes

6  server/app.js
   why        : F8 stale plain re-read after the canonical capacity lock
   function   : confirmSalesDelivery (:5698-...)
   change     : consume the rows returned by lockAndConsumeSalesDeliveryCapacity
                instead of the plain re-SELECTs at :5715 and :5718-5720; add the
                final-lock fingerprint comparison
   preserved  : OQC, capacity tolerance, Inventory/valuation/COGS, AR, vouchers,
                idempotency, audit, HTTP contracts
   tests      : Delivery/Service regression + M13/M14 + stale-source 409 + G

7  server/modules/service-fulfillment.js
   why        : final revalidation must use the locked SO item and fulfillment rows
   function   : confirmServiceFulfillmentCommand (:144-205)
   change     : build the final fingerprint from the rows locked at :163/:164
                rather than the unlocked snapshot at :160
   preserved  : §35.18.11.5 lock order, recognition policy, AR/voucher, capacity
                ceiling, idempotency fingerprint, audit

8  tests (Wave 7 focused + concurrency)
   why        : §37.10 strata A-D and G must become executable evidence
   scope      : server/sales-customer-wave7-*.test.js static order assertions;
                server/mysql-sales-customer-wave7-concurrency.integration.js
                production-outcome cases (M21-M25);
                a NEW protected raw row-level probe file for M1/M7/M13/M14
   boundary   : harness-only; no production code change; registered in
                scripts/testing/test-suites.js and the MySQL concurrency gate
   no change  : server/db.js, server/database/, migrations, Wave 9 Credit modules

Explicitly OUT of the manifest: server/db.js, mysql_transaction_gates, schema or
migration files, Wave 9 Credit modules, Wave 10 Credit code, permissions,
frontend, package.json. Nothing in this manifest is implemented by this Design.
```

### 37.12 Compatibility, rollback and idempotency invariants

```text
Preserved:  Wave 9 frozen Credit Foundation (six tables, keys, indexes, anchor
            identity, rating provenance, policy snapshots); Finance canonical
            money truth; Wave 7 gate decisions; permission/RBAC/SOD contracts;
            source identity rules; integer-cent monetary units and rounding;
            Finance period controls; Inventory/Planning ownership; AR, voucher,
            COGS and valuation semantics; historical replay contracts;
            legacy-data compatibility; append-only audit history.
Not added:  physical business tables; shadow PREPAYMENT balances; a second
            Finance ledger; permissions; Wave 10 features; a replacement global
            transaction gate; migrations.
Idempotency: unchanged keys and scopes. Gate snapshot_key semantics unchanged.
            Refund REFUND_CONFIRM / REFUND_REVERSAL scopes unchanged.
            Credit idempotency identities encode no actor and are untouched.
Rollback:   every change above is code-only, additive and reversible by revert.
            No persisted state, no schema, no data migration, so rollback has no
            data step and cannot orphan a reservation, inventory lock, gate
            result, voucher or audit row.
```

### 37.13 Open items — no silent absorption

| # | Item | Disposition |
|---|---|---|
| D1 | PREPAYMENT reversal capacity formula divergence: `settlement-core.js:206` omits `settlement_reversals.status='CONFIRMED'`; adapter.js:113-118 includes it. Affects refund/apply capacity vs Gate eligibility. | **Not corrected.** Finance semantics outside this authorization. Separate Requirement/Design decision required. |
| D2 | §36.13.5:20511 and §36.14.3 describe SO Approve as gate-participating; code (F2) shows it invokes no gate today. | Design records the accurate current state (§37.4). If Wave 10 must make Approve gate-participating, that is a Wave 10 Requirement. |
| D3 | `reverseRefund` (financial-controls.js:222-243) does not take the parent balance lock. It increases rather than reduces remaining capacity, so no cycle arises, but the Gate may read a snapshot that predates the reversal. | Pre-existing read-consistency observation. Out of W7-C1/C2′ scope. |
| D4 | Reservation convergence changes the concurrent out-of-effective-window outcome from `NOT_REQUIRED` to 409 (§37.5). | Declared fail-closed narrowing. If judged a business-rule change, return to Requirement. |
| D5 | M9–M12, M15, M19(Credit) cannot be executed before Wave 10. | Report as BLOCKED, never PASS. |

### 37.14 Boundary

No `document.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, production source, test,
migration, schema, frontend or `package.json` change. No database connection,
migration, reset or test execution. No MySQL gate run. No Git add, commit, push,
merge, tag, release or deploy. Wave 9 frozen contracts are untouched. Wave 10 and
Wave 11 are not started. No new SC, Invariant, UAT, Race or Audit Capability
identifier is created. Historical stage-status text remains valid as history.
`WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` and `LEGACY_DATA_EVIDENCE_PENDING`
are unchanged.

**Status: `W7_C1_C2_BOUNDED_DESIGN_AMENDMENT_COMPLETE — AWAITING_EXTERNAL_DESIGN_REVIEW`.**

---

## 37.15 Design Evidence Correction (2026-10-23)

### 37.15.0 Authorization and scope of this correction

Authorized as one bounded, documentation-only correction under
`W7_C1_C2_FINAL_DESIGN_EVIDENCE_CORRECTION`. **§37.0–§37.14 are preserved
verbatim and remain in force except where this section explicitly supersedes a
named statement.** Nothing in §37.0–§37.14 is rewritten or deleted.

Superseded by this section:

| Superseded statement | Correction |
|---|---|
| §37.1 **F8**, first half — "Under REPEATABLE READ a plain SELECT returns the transaction snapshot, not the latest committed image" | **Wrong.** Production MySQL runs at READ COMMITTED (§37.17). A plain SELECT returns the latest committed row at statement start. |
| §37.7 rationale for consuming the locked rows — "may validate against a stale image" | Corrected rationale in §37.17.4. The *requirement* is retained; the *reason* changes. |
| §37.13 **D1** — classified as a live Finance-semantics divergence needing a separate Requirement/Design decision | **Overstated.** Corrected in §37.16: no reachable valid-data difference. Closed as an observation, not a defect. |
| §37.6's cross-reference to D1 as an open Finance item | Closed by §37.16. |
| §37.10's treatment of M9–M12, M15 and M19 as undifferentiated "Wave 10 only" | Reorganized into independent Gate A / Gate B (§37.18). |

Retained unchanged: §37.2 (W7-C1 sequence), §37.3 (L1–L8), §37.4 (caller graph),
§37.5 (Reservation convergence), §37.6 (Refund post-lock authority, minus the D1
cross-reference), §37.8/§37.9 (retry and error matrix, refined by §37.20), and the
§37.1 F1–F7 facts — **including F6**, which re-verified as correct.

### 37.15.1 Baseline

Re-verified at `feature/sales-waves6-13@2037cb6`, package `1.6.2`, on the
uncommitted working tree already carrying §37 (+784) and `log/2026-10-23.md`
(+101). Both modifications preserved.

### 37.16 D1 — corrected classification: NOT a reachable defect

**Evidence A — the constraint exists and is enforced on both backends.**

```text
SQLite DDL   server/migrations/v13-phase5-settlement-integrity.js:66-78
               status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status='CONFIRMED')
             server/migrations/v13-phase6a-financial-controls.js:21-30
               the partial-reversal rebuild RETAINED
               status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status='CONFIRMED')
               and preserved phase5 rows via INSERT ... SELECT *, so no
               non-conformant row can be introduced by the migration itself.

MySQL DDL    server/database/mysql-schema.js:186
               for (const check of extractChecks(table.sql))
                 definitions.push(`CHECK (${check})`);
             MySQL InnoDB DDL is derived from the SQLite schema, so the
             CHECK is carried across and re-emitted verbatim, under
             ENGINE=InnoDB. MySQL 8.0.16+ enforces CHECK constraints.
             (Recorded server version in §36.16 evidence: 8.0.37.)

SQLite       CHECK constraints are part of the table definition and are enforced
             by node:sqlite on every INSERT/UPDATE.
```

**Evidence B — no application path can produce a non-CONFIRMED row.**

```text
server/modules/finance-settlement-reversal.js:39-41  inserts literal 'CONFIRMED'
server/modules/settlement.js:353-354                 omits status -> DEFAULT
                                                    'CONFIRMED' applies
No UPDATE ... SET status exists against settlement_reversals in server/modules/.
```

**Evidence C — SQL predicate difference vs business-result difference.**

```text
sales-prepayment-finance-adapter.js:113-118  JOINs settlement_reversals and
    filters sr.status='CONFIRMED'.
settlement-core.js:206                       omits the join and the filter.

Because status is constrained to exactly one value and every writer supplies it,
these two queries return IDENTICAL result sets for every reachable row. The
predicate in the adapter is therefore REDUNDANT DEFENCE IN DEPTH, not a
different calculation.
```

**Corrected classification.** D1 is a **SQL predicate difference with no
reachable valid-data business-result difference.** It is *not* a Finance defect,
*not* a monetary divergence, and *not* a Requirement or Design blocker. The
original §37.13 D1 wording overstated it and is superseded.

**Residual scope, precisely bounded.** A divergence would require a
`settlement_reversals` row whose `status <> 'CONFIRMED'`. Reachable only through a
schema that lacks the CHECK, which in turn requires either a hand-created or
pre-v13-phase5 SQLite table that `CREATE TABLE IF NOT EXISTS` did not reconcile
*and* that also lacks the phase5 `UNIQUE(settlement_type, settlement_id)` so that
phase6a's rebuild branch does not fire — or external DBA/file-level tampering.
No such path exists in the canonical migration lifecycle, and even in such a
table no application writer could produce such a row (Evidence B).

**Existing failure policy for such data.** If a malformed row ever existed, the
existing behaviour is *not* silent corruption in the Gate: the Gate adapter
(adapter.js:117) would simply exclude it from eligible prepayment, which is the
conservative direction — a reversal that reduces capacity is ignored rather than
over-credited. Finance apply/refund capacity (settlement-core.js:206) would
continue to count it, which is the conservative direction for a *refundable*
balance. Both outcomes understate available capacity rather than overstate it,
so the failure mode is fail-closed, not unsafe. No corrective action is
authorized here, and none is needed. `LEGACY_DATA_EVIDENCE_PENDING` remains open
and unchanged and remains the correct register for genuinely unknown historical
data.

### 37.17 MySQL isolation correction

**Verified fact.** `server/database/mysql-worker.js:26-31`:

```text
// Application-required session state. Every newly created connection must
// apply these before being published as usable; otherwise a reconnect could
// silently downgrade isolation, lock waits or time zone semantics.
const SESSION_TIMEZONE = '+00:00';
const SESSION_ISOLATION_LEVEL = 'READ COMMITTED';
const SESSION_INNODB_LOCK_WAIT_TIMEOUT = 2;
```

applied by `applySession()` at `:95-98` on **every** connection including
reconnects. `server/database/mysql-adapter.js:38` maps `BEGIN IMMEDIATE` to
`START TRANSACTION`; `server/db.js:1887` issues the former. Therefore **every
production MySQL transaction runs at READ COMMITTED.**

**Consequence.** There is no REPEATABLE READ snapshot anywhere in production
MySQL. Any Design text asserting otherwise is incorrect and is superseded here.
The isolation level is **not** changed by this Design, and `server/db.js` is not
modified.

#### 37.17.1 The five read categories

The corrected basis for final validation, which §37.7 requires:

| # | Category | Semantics at READ COMMITTED | Authority for final validation? |
|---|---|---|---|
| 1 | **Unlocked discovery** | Latest committed value at statement start; no lock; no protection | **No.** Candidate input only. |
| 2 | **Locking read** (`SELECT ... FOR UPDATE`) | Latest committed value, plus an exclusive lock held to COMMIT/ROLLBACK | **Yes**, for the rows it covers. |
| 3 | **Ordinary consistent read** | Latest committed value at statement start; no lock | **No.** |
| 4 | **Current locked source identity** | The row as it exists while the transaction holds its lock | **Yes.** |
| 5 | **Final mutation authority** | The same locked rows the transaction subsequently mutates | **Yes — and it must be the same rows.** |

#### 37.17.2 Why a consistent read is not final authority under READ COMMITTED

The reason is **not** staleness. A plain SELECT under READ COMMITTED always sees a
recent committed image. The reason is **absence of protection**: a non-locking
read takes no lock, so another transaction may commit a change to that row
*after* the validation and *before* the mutation this transaction performs. The
validation is then no longer backed by anything.

`app.js:5715-5716` is the concrete instance:

```text
:5715  SELECT * FROM sales_deliveries WHERE id=?            (plain, NO lock)
:5716  if (locked.status !== 'DRAFT') throw 409             (unprotected check)
:5717  lockAndConsumeSalesDeliveryCapacity(...)             -> takes FOR UPDATE at
        sales-delivery-source.js:52 and validates ONLY source_mode (:53) and the
        ORDER's status/close state (:55). It does NOT re-assert delivery.status.
```

So between :5716 and the lock at :52, a concurrent transaction could confirm the
same delivery; the locked read would then observe `status='CONFIRMED'` and no
later statement re-checks it. Under READ COMMITTED this window is real, not
hypothetical. (Not executed as a race in this stage — no test was run — so this is
a Design-level requirement, not an accepted defect claim.)

#### 37.17.3 Corrected requirement (unchanged conclusion)

§37.7's requirement stands and is now correctly founded: **the final
authoritative comparison must be made against the same locked rows the
transaction subsequently mutates** (categories 4/5), never against an ordinary
consistent read (categories 1/3). Concretely:

- Delivery Confirm must consume the `{delivery, order}` pair returned by
  `lockAndConsumeSalesDeliveryCapacity` (sales-delivery-source.js:79) for the
  `status`, customer and source-identity comparison, instead of the plain
  re-SELECTs at `app.js:5715` and `:5718-5720`.
- Service Confirm must build its final fingerprint from the `sales_order_items`
  row locked at `:163` and the `service_fulfillments` row locked at `:164`,
  not from the unlocked `unlocked` snapshot at `:160`.
- Unlocked discovery remains a fast rejection and a plan input only.

Discovery and final validation are separated by the L1–L8 lock sequence, which is
what makes revalidation meaningful: the discovery fingerprint is re-checked
against rows that are now locked, so any concurrent change between the two is
detected rather than tolerated.

#### 37.17.4 Lock-wait timeout

`SESSION_INNODB_LOCK_WAIT_TIMEOUT = 2` means a contended business row fails fast
with `1205` rather than blocking for the MySQL default. This shortens the
worst-case wait per attempt and is an input to the combined budget in §37.20.

### 37.18 Acceptance split — Gate A (independent) and Gate B (Wave 10)

The prior design left Credit-dependent fixtures undifferentiated from
Wave 7-verifiable ones, which made the Wave 10 blocker read as circular. They
are now separated. **Gate A does not depend on Gate B; Gate B is a downstream
obligation of Wave 10 itself and is never a prerequisite for Gate A.**

#### 37.18.1 Gate A — W7-C1 / W7-C2′ independent acceptance

Executable on today's pre-Wave-10 production code plus the separately authorized
W7 remediation. **No Wave 10 Credit code is required, referenced or simulated.**

```text
A-STATIC   Lock-order intent assertions (§37.10 stratum A), now including the
           post-lock capacity re-read in createRefund.
A-BASE     Full Wave 7 prepayment functional / acceptance / migration regression
           unchanged in intent.
A-MONEY    §37.6 refund authority: post-lock re-read, amount<=available,
           negative remaining refused, voucher/settlement/refund/idempotency/
           audit atomic.
A-STALE    M3, M8, M16, M17, M18, M20 — stale-plan and candidate-drift 409 with
           zero side effects.
A-ORDER    M1, M7, M13, M14 — the W7-C1 and W7-C2' structural reproducers,
           including both empty-parent cases, with pre-fix deadlock proof and
           post-fix no-deadlock proof (§37.10 F).
A-FIN      M4, M5, M6 — SO Submit vs apply / createRefund / UNAPPLIED reversal.
A-REFUND   M21, M22, M23, M24, M25 — refund vs refund / apply / reversal, exact
           replay, same-key conflict, retry exhaustion.
A-GATE     M2 — Manual Eval vs Gate Authorization.
A-GRNR     The non-Credit half of M19: with no prepayment requirement the gate
           returns NOT_REQUIRED and the absence of a parent does not weaken or
           reorder anything. The Credit half is Gate B.
A-PROD     Production MySQL API regression across independent sessions (§37.10 C).
A-RAW      Protected raw row-level lock-order probes for M1/M7/M13/M14 in a
           disposable MySQL, asserting lock/wait ORDER only (§37.10 D/E).
A-SIDE     Failure-side-effect assertions across every rejection path
           (§37.10 G).
A-PARITY   SQLite + MySQL schema/behavior parity (§37.10 H).
```

Gate A passing, plus **explicit user Final Acceptance**, is what satisfies
`WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS`. Until that Final Acceptance the
canonical Wave 10 blocker remains in force exactly as written.

#### 37.18.2 Gate B — Wave 10 Credit integration acceptance

Performed only after Wave 10 is separately authorized and implemented. Until then
every case below is **`BLOCKED_BY_WAVE10`** and must be reported as blocked —
never as PASS, never as skipped-and-green, never as "verified by inspection".

```text
B-COMPOSE  Credit / Gate / Sales lock-order composition — that L2->L3->L4->L5 sits
           between L1 and L6, and that Credit takes no Sales or Finance
           business-row lock.
B-M9       Credit Check vs SO Submit, same order.
B-M10      Two salespersons, one customer aggregate; exactly one commits under
           ONLY_ONE_FITS, with §36.8.1 preconditions asserted or the fixture
           declared unconstructible.
B-M11      Credit Profile mutation vs active Credit Check.
B-M12      Credit Special Approval vs policy mutation.
B-M15      Empty parent set, two salespersons, one customer aggregate.
B-M19C     The Credit half of M19: a genuinely missing mandatory Profile fails
           closed at the pre-lock guard with zero prohibited side effects; §37.39.7 governs.
```

Gate B is **not** weakened, deferred or discharged by Gate A. It remains the
ultimate Credit integration acceptance obligation for Wave 10 and may only be
discharged by executing these fixtures against real Wave 10 code.

### 37.19 D2 / D3 / D4 dispositions

#### 37.19.1 D2 — Sales Order Approve: **resolved, current state recorded**

Re-verified against `server/modules/sales-orders.js:609-662`: `approve` takes
`SALES_ORDER FOR UPDATE` at `:620`, validates at `:647` (status, SOD
`creator_id !== actor.id`) and mutates at `:648`. **It invokes neither the
prepayment gate nor any Credit check.** Only the `submit` branch calls the gate
(`:639`). `approve` shares the `:647-649` branch with `reject`, which likewise
invokes no gate.

Current-state implementation and future Wave 10 participation are therefore kept
strictly separate:

- **Current state (Gate A scope):** `approve` conforms to L8-only and is
  unchanged. W7-C2′ does not add a gate call to `approve`.
- **Wave 10 (Gate B scope):** if Wave 10 makes `approve` credit-controlled, its
  sequence becomes `L1? → L2..L5 → L6 → L7 → L8`. That is a Wave 10 Requirement
  decision, not a W7-C1/W7-C2′ decision.

Implementation note carried forward from §37.11 item 3: the `approve`/`reject`
shared branch must be split during W7-C2′ so `reject` is not dragged through the
Credit and Gate stages. This is a mechanical consequence of the L8 move and
requires no business change.

**No Requirement blocker.** D2 is a documentation-accuracy resolution.

#### 37.19.2 D3 — Reverse Refund: **resolved, no safety contradiction; no scope extension**

Re-verified against `server/modules/financial-controls.js:222-243`:
`reverseRefund` locks **no** settlement parent balance row and re-reads **no**
capacity. It validates `refund.status === 'CONFIRMED'` at `:225`, generates the
reversal voucher at `:235`, inserts `financial_refund_reversals` at `:236`, then
sets `financial_refunds.status='REVERSED'` at `:237`.

Actual lock and state behaviour:

- It takes an exclusive lock only on the refund row it updates, plus whatever
  `generateVoucher` and `recordSettlementMovement` lock internally.
- It **increases** remaining capacity: flipping the refund from CONFIRMED to
  REVERSED removes that row from the `financial_refunds WHERE status='CONFIRMED'`
  sum used by `unappliedBalanceSnapshot` (settlement-core.js:204).
- It never reads or writes a PREPAYMENT-eligible value.

Cycle analysis against the L1–L8 contract: the Gate holds L1 and reads
`financial_refunds` with a non-locking read (category 3), so it never waits on
`reverseRefund`; and `reverseRefund` never requests L1, L6 or L7. **There is no
wait-for cycle in either direction.** The consequence of the missing L1 lock is
read consistency, not lock safety: a Gate evaluation may read a `financial_refunds`
snapshot that predates a concurrent `reverseRefund` commit, under-stating
eligible prepayment and therefore biasing toward WARN/BLOCK — the conservative
direction.

**Disposition:** no present-day safety contradiction within the approved W7
scope; no production change is authorized or proposed; no scope extension. If the
future requires a reversal lock for read-consistency rather than deadlock
avoidance, that is a new business/Design question and would need its own
Requirement. **No Requirement blocker is raised today.**

#### 37.19.3 D4 — Reservation stale-plan: **resolved as an implementation of the existing fail-closed requirement**

The four situations named for distinction:

| # | Situation | Current helper output | After convergence |
|---|---|---|---|
| a | **No requirement at discovery** | `NOT_REQUIRED` — operation proceeds | `NOT_REQUIRED` — identical (plan carries `requirementId: null`, fingerprint `NONE`, empty parent set; helper returns NOT_REQUIRED at gate.js:273) |
| b | **Requirement disappears/changes after discovery** | `NOT_REQUIRED` if it left its effective window (gate.js:215) | **409 retryable stale** |
| c | **Genuine NOT_REQUIRED business behaviour** (never had a requirement) | `NOT_REQUIRED` | `NOT_REQUIRED` — unchanged |
| d | **Retryable stale-plan 409** | not produced on this path | produced; whole transaction rolls back; outer re-discovery |

Rows (a) and (c) are the same condition and are unaffected. The **only** difference
is row (b), and it exists only when a requirement that was in effect at discovery
is no longer in effect when the lock is taken.

Why refusing (b) is an implementation of the existing approved requirement rather
than a new business rule:

1. The approved stale-plan contract already exists and is already enforced on the
   Delivery and Service paths — `assertPrepaymentParentPlanCurrent` raises
   `SALES_PREPAYMENT_LOCK_PLAN_STALE` (adapter.js:82-90), and
   `authorizeSalesPrepaymentGateWithPlan` raises the same code when the requirement
   changes under the lock (gate.js:282). Both are pre-existing, accepted behavior.
2. `document.md §34.3.12` SC64 makes the Gate decision a function of the effective
   requirement at the moment of evaluation. Evaluating against a requirement that
   is no longer effective is not "the gate is not configured"; it is an
   undecidable state.
3. Refusing is **conservative and reversible**: the outer model (§37.20) re-discovers
   and re-evaluates. On the retry, `discoverSalesPrepaymentGatePlan` re-applies
   `effectiveAtNow`, and an out-of-range requirement yields `requirementId: null`,
   producing genuine `NOT_REQUIRED` (row c). No legal business outcome is lost —
   only deferred to the next attempt.
4. The alternative — silently proceeding on the strength of a stale requirement —
   would let a withdrawn requirement authorize a mutation, which contradicts the
   fail-closed posture that SC62–SC65 and §36.14.6 M17/M18 already establish.

**Disposition:** convergence is an implementation of the existing fail-closed
requirement. **No Requirement amendment is needed and none is proposed.** If
Acceptance nonetheless judges the (b) narrowing a business-rule change, the exact
and only amendment that would be required is a single clarifying clause in
`document.md §34.3.12` SC64 stating that a requirement changing between discovery
and authorization is refused as stale and retried, rather than treated as
`NOT_REQUIRED`. That clause is **not** written here.

### 37.20 Combined retry budget and atomicity

Two independent retry mechanisms compose; this section makes their interaction
finite and explicit.

```text
INNER   transaction(db, work) — db.js:1882-1912, UNCHANGED by this Design.
        attempts <= ERP_DB_TX_RETRY_MAX + 1  (default 3 + 1 = 4)
        retriable only: ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT /
                        errno 1213 / 1205 / sqlState 40001
        backoff min(250, 20 * 2^attempt) ms
        on exhaustion: error.transactionRetryExhausted = true,
                       error.transactionAttempts = attempt + 1, then rethrow

OUTER   caller-owned discovery loop — SPECIFIED BY THIS DESIGN, NOT IMPLEMENTED.
        outer attempts <= ERP_GATE_ATTEMPTS_MAX (default 3)
        re-discovers from authoritative current data on every attempt
        re-enters ONLY on: SALES_PREPAYMENT_LOCK_PLAN_STALE, a §37.17 final
        fingerprint mismatch, or inner retry exhaustion on a retriable error
        NEVER re-enters on: a business 409 (gate BLOCK, capacity exhausted,
        SOD violation, state conflict) or an idempotent replay

COMBINED HARD BOUND
        worst case transaction attempts = 3 * 4 = 12
        worst case lock wait          = 12 * innodb_lock_wait_timeout (2 s)
        plus inner + outer backoff
        A cumulative wall-clock budget (ERP_GATE_ATTEMPTS_BUDGET_MS, default
        15000 ms) aborts the outer loop and surfaces 503 retryable. This makes
        the bound finite in wall time, not only in attempt count.
```

Atomicity and duplicate-effect guarantees:

```text
- The ENTIRE body of one outer attempt is exactly one transaction(). Every write
  — gate result, voucher, settlement movement, refund row, inventory mutation,
  idempotency record, audit row — commits with it or rolls back with it.
- An inner retry re-executes work() only AFTER db.exec('ROLLBACK') (db.js:1901),
  so a successful callback can never duplicate a monetary or audit effect: a
  failed attempt leaves nothing behind to duplicate.
- An outer retry re-discovers, then opens a fresh transaction on the same
  connection. The prior attempt is already committed or rolled back; there is no
  partial state to inherit.
- Named idempotency locks are released on BOTH the commit path and the throw path
  (db.js:1896-1908, releaseMySqlIdempotencyLocks), so no GET_LOCK is leaked
  across attempts or across outer retries. The set is cleared each time.
- Idempotency keys and scopes are unchanged by this Design. A retry carrying the
  same key hits idempotencyReplay and returns the stored result with no second
  effect; a retry whose earlier attempt already committed is therefore a replay,
  not a duplicate.
- A successful callback produces exactly one committed gate result and one audit
  row per committed decision, on both the first attempt and any retry.
```

Not implemented by this section; the algorithm above is Design only.

### 37.21 Boundary of this correction

No `document.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, production source, test,
migration, schema, permission, frontend or `package.json` change. No production
Finance correction is authorized. No database connection, migration, reset or test
execution; no MySQL gate run. No isolation-level change; no `server/db.js` change.
No Wave 9 Credit change; no global transaction-gate change. No Git add, commit,
push, merge, tag, release or deploy. §37.0–§37.14 preserved except as explicitly
superseded in §37.15.0. No business semantics changed and no new business
requirement introduced. `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` and
`LEGACY_DATA_EVIDENCE_PENDING` are unchanged, and Gate B remains obligatory.

**Status: `W7_C1_C2_FINAL_DESIGN_EVIDENCE_CORRECTION_COMPLETE — AWAITING_EXTERNAL_DESIGN_REVIEW`.**

---

## 37.22 Design Precision Closure (2026-10-23)

### 37.22.0 Scope and supersession

Authorized as one final, strictly bounded documentation-only clarification.
**§37.0–§37.21 are preserved verbatim** and remain in force except as named below.
Nothing prior is deleted or rewritten.

| Superseded statement | Correction |
|---|---|
| §37.17.2 — "A plain SELECT under READ COMMITTED always sees a recent committed image" and "The reason is **not** staleness" | Overstated as an unconditional guarantee. Corrected in §37.23. |
| §37.20 — "worst case transaction attempts = 3 * 4 = 12" and the 15000 ms "hard bound" | Incomplete and overstated. Corrected in §37.24. |
| §37.19.2 — "**There is no wait-for cycle in either direction**" | Overstated as universal. Bounded to audited paths in §37.25. |

Retained unchanged: §37.16 (D1 corrected classification), §37.17.1 and §37.17.3
(READ COMMITTED fact and the final-lock requirement), §37.17.4, §37.18 (Gate A /
Gate B separation), §37.19.1 (D2), §37.19.3 (D4), and all of §37.2–§37.15.

### 37.23 READ COMMITTED read semantics — corrected

Production MySQL runs at READ COMMITTED (`mysql-worker.js:30`, applied on every
connection at `:95-98`; `mysql-adapter.js:38` maps `BEGIN IMMEDIATE` to
`START TRANSACTION`). Isolation configuration is unchanged by this Design.

The corrected distinction, stated without unconditional guarantees:

```text
1. Each consistent read uses a FRESH STATEMENT-LEVEL snapshot — not a
   transaction-level snapshot, and not necessarily the value current at the moment
   the surrounding transaction began.
2. An ordinary SELECT does NOT lock the business rows it reads. It therefore
   establishes no exclusion against any concurrent writer.
3. Another transaction may commit a relevant change AFTER a consistent read has
   completed. A consistent read offers no protection against that.
4. Therefore an unlocked discovery read is CANDIDATE INPUT ONLY. It is never
   mutation authority, and it is not a statement that no change can occur.
5. Final validation must use the AUTHORITATIVE rows obtained under the approved
   lock order (L1..L8), i.e. the same rows the transaction subsequently mutates.
6. Candidate identity and fingerprint must be revalidated immediately before
   mutation, while those authoritative rows are held.
```

What is **not** claimed: that a consistent read is guaranteed fresh at commit
time, that no change can land between a read and a later mutation, or that any
non-locking read is safe as validation. §37.17.3's requirement — consume the
locked `{delivery, order}` pair returned by `lockAndConsumeSalesDeliveryCapacity`
(sales-delivery-source.js:79), and build the Service fingerprint from the rows
locked at `service-fulfillment.js:163/:164` rather than the unlocked snapshot at
`:160` — is unchanged and remains the governing design.

The §37.17.2 observation at `app.js:5715-5716` (an unprotected `DRAFT` precheck
followed by a locking read that does not re-assert `delivery.status`) is retained
as a Design-level requirement. It remains an unexecuted race observation, not an
accepted defect claim.

### 37.24 Retry budget — corrected and honestly bounded

Verified against `server/db.js:1855-1912` and `server/database/mysql-worker.js`.
`server/db.js` and the global transaction gate are **not** modified.

```text
A. INNER CONFIGURED RETRY LIMIT
   mysqlTransactionRetryLimit()  db.js:1865-1868
     = ERP_DB_TX_RETRY_MAX, default 3, accepted only as a safe integer in [0,10];
       any other value falls back to 3.
   This is CONFIGURABLE. It is not fixed at 3.

B. TOTAL INNER ATTEMPTS = A + 1
   transaction() runs `for (let attempt = 0; ; attempt += 1)` (db.js:1885).
   Default environment: 3 + 1 = 4 attempts.
   Configured maximum environment: 10 + 1 = 11 attempts.
   The Design therefore does NOT assume "<= 4". Any figure below is stated for a
   named configuration.

C. OUTER REDISCOVERY ATTEMPTS: maximum 3
   Specified by this Design; not implemented.

D. MAXIMUM COMBINED CALLBACK EXECUTIONS = C x B
   default environment          : 3 x 4  = 12
   configured maximum environment: 3 x 11 = 33
   Every execution is preceded by a fresh authoritative discovery. Inner re-executions
   within one outer attempt reuse that attempt's already-discovered plan.

E. ELAPSED-TIME RETRY ADMISSION DEADLINE — ADMISSION CONTROL, NOT A HARD BOUND
   An elapsed-time deadline (ERP_GATE_ATTEMPTS_BUDGET_MS) is evaluated ONLY at the
   start of each outer attempt and immediately after an inner retry exhaustion.
   If the deadline has passed, the loop stops and surfaces 503 retryable with zero
   side effects. It gates ADMISSION to further attempts; it does not bound one
   already in flight. The previous "15000 ms hard upper bound" wording is withdrawn:
   the current implementation cannot safely enforce it.

F. LIMITS OF INTERRUPTING A SYNCHRONOUS IN-FLIGHT OPERATION
   - work() is synchronous; db.exec, db.prepare().get/.run and the adapter's
     synchronous request/response bridge all block the Node event loop.
   - waitForTransactionRetry() (db.js:1870-1872) sleeps via
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs) —
     a synchronous main-thread block. It cannot be interrupted or shortened.
   - The inner retry loop in transaction() contains NO elapsed check at all; it
     retries purely on error classification until the limit is consumed.
   - The worker sets only SESSION_INNODB_LOCK_WAIT_TIMEOUT = 2
     (mysql-worker.js:31, applied :97). There is NO connectTimeout, queryTimeout
     or acquireTimeout on the mysql2 connection.
   - Consequence: ONE outer attempt is not bounded by 2 seconds. 2 s applies per
     individual lock wait, and a callback may perform many statements and many
     lock waits.
   - THE ONLY ENFORCEABLE BOUND IS THE ATTEMPT-COUNT BOUND (B, C, D).
     Elapsed time is bounded only in the sense that each attempt is finite.
```

Preserved unchanged: rollback precedes every retry (`db.js:1901`); named
idempotency locks are released on both the commit and throw paths
(`db.js:1896-1908`); stale-plan retry restarts discovery from authoritative
current data; an ordinary business 409 is never retried; retry exhaustion is
explicit and surfaces as 503 retryable with zero side effects; a successful
callback cannot duplicate a monetary or audit effect. Retriable classification is
unchanged and read from `isRetryableMySqlTransactionError()` (`db.js:1856-1863`):
`ER_LOCK_DEADLOCK`, `ER_LOCK_WAIT_TIMEOUT`, errno 1213 / 1205, sqlState 40001.

This is Design only; the algorithm is not implemented.

### 37.25 D3 Reverse Refund — bounded conclusion

Reverse Refund stays **outside** the W7-C1 / W7-C2′ implementation scope. No
established contradiction requires otherwise.

Evidence-scoped conclusion, replacing the universal §37.19.2 wording:

```text
AUDITED PATHS (the conclusion is limited to exactly these)
  - reverseRefund        server/modules/financial-controls.js:222-243
  - the Gate's read of financial_refunds through
    sales-prepayment-finance-adapter.js readAppliedCents / readRefundedCents
    (adapter.js:98-104) and the capacity read in settlement-core.js:200-210
  - the L1..L8 order specified in §37.3

FINDING, SCOPED
  Within these audited current canonical paths, reverseRefund takes no
  settlement parent lock and no Gate/Credit row lock, while the Gate reads
  financial_refunds with a non-locking consistent read. No wait-for cycle is
  identified between them under the specified order. reverseRefund increases
  remaining capacity (it moves the refund from CONFIRMED to REVERSED, removing it
  from the status='CONFIRMED' sum) and never requests L1, L6 or L7.

NOT CLAIMED
  - Not claimed for hypothetical or future writers that take additional locks.
  - Not claimed for a different lock architecture, a modified adapter, or any
    change to the global transaction gate.
  - Not claimed as a general proof that the Finance settlement graph is acyclic.
  - Read consistency is a separate matter: a Gate evaluation may read a snapshot
    predating a concurrent reversal commit, biasing toward the conservative
    WARN/BLOCK direction. This is recorded, not corrected.

DISPOSITION
  No production change authorized or proposed. No scope extension. No Requirement
  blocker. Any future need for a reversal lock for read-consistency rather than
  deadlock avoidance would be a new Design question requiring its own Requirement.
```

### 37.26 Gate A / Gate B — preserved unchanged

§37.18 is confirmed and unchanged. **Gate A** is W7-C1 / W7-C2′ independent
acceptance executable on the available pre-Wave-10 implementation plus the
separately authorized W7 remediation. **Gate B** holds the Credit integration
tests that depend on Wave 10 implementation and remain `BLOCKED_BY_WAVE10`.

Neither gate may fabricate unavailable evidence: a fixture whose preconditions
cannot be constructed asserts that fact rather than passing, and a Gate B case is
reported as blocked — never as PASS, never as skip-and-green, never as verified by
inspection. Gate B is not a prerequisite for Gate A, and Gate A does not discharge
Gate B. `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` is unchanged and is
satisfied only by Gate A plus explicit user Final Acceptance.

### 37.27 Boundary of this closure

No `document.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, production source, test,
migration, schema, permission, frontend or `package.json` change. No MySQL
isolation configuration change. No `server/db.js` change. No global
transaction-gate change. No Wave 9 Credit change. No database connection,
migration, reset or test execution; no MySQL gate run. No Git add, commit, push,
merge, tag, release or deploy. §37.0–§37.21 preserved except as explicitly
superseded in §37.22.0. No new business requirement introduced and no business
semantics changed. Wave 10 is not unblocked and no acceptance is declared.

**Status: `W7_C1_C2_DESIGN_PRECISION_CLOSURE_COMPLETE — AWAITING_EXTERNAL_DESIGN_APPROVAL`.**

---

## 37.28 F1 Manual Gate retry-exhaustion API contract precision (2026-10-23)

### 37.28.0 Authorization and scope

This append-only Design Precision Amendment resolves only the previously missing
public API code and message for `evaluateSalesPrepaymentGate()` outer retry
exhaustion. It does not introduce a new business rule, Gate decision, retry
algorithm, schema, migration, permission, Credit behavior or Finance monetary
semantic. Sections 37.0–37.27 remain intact and continue to govern all other
behavior.

This section is Design only. Production source and tests are not changed in this
stage. In particular, the elapsed-time admission budget remains F2 work and this
contract creates no hard wall-clock execution guarantee.

### 37.28.1 Exact public response

When the final configured outer attempt of `evaluateSalesPrepaymentGate()` ends
with an error already approved as rediscovery-eligible—either a structured
retryable stale-plan condition or exhausted inner transaction concurrency—the
public error contract is exactly:

```text
HTTP status    = 503
code           = SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED
error/message  = 预付款门评估重试次数已耗尽，请稍后重试
details.code   = SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED
details.retryable = true
details.attempts  = actual number of completed outer attempts
details.cause     = stable approved code identifying the final retryable cause
```

The existing `HttpError` and structured serializer remain authoritative: the
same exact message is exposed through both top-level `error` and `message`, and
the exact approved code is exposed through top-level `code` and `details.code`.
`details.cause` must contain only a stable approved error code. It must never
contain raw SQL, an internal stack trace, credentials or unstructured exception
text.

### 37.28.2 Classification and preservation

- Conversion to this 503 is permitted only after the final completed outer
  attempt fails with an already approved rediscovery-eligible error.
- While an outer attempt remains, the existing bounded loop performs fresh
  authoritative discovery and retries according to sections 37.8, 37.20 and
  37.24.
- Ordinary business 409 errors are not retried or converted. Permission,
  validation, Gate BLOCK, genuine missing Requirement and unsupported Parent
  business rejection retain their approved status, code and message.
- The maximum outer attempt count remains three and may be lower through the
  already approved configuration. `details.attempts` reports completed outer
  attempts rather than the configured maximum.
- Request business date, snapshot identity and actor remain stable across
  retries. Every rejected transaction rolls back before rediscovery, and no
  success response is emitted before the successful transaction commits.
- Retry exhaustion leaves zero new Gate Result, audit or idempotency success
  facts. Exact replay and fresh evaluation status semantics remain unchanged.

### 37.28.3 Boundary and status

No `document.md`, `README.md`, production source, test, schema, migration,
permission, package version or database state is changed by this amendment. No
MySQL connection or destructive operation is authorized. F1 production
correction, B-R5 correction, F2, A-RAW, A-PROD and MySQL safety-guard work remain
pending separate approval. Gate A is not passed and Wave 10 is not unblocked.

**Status: `F1_API_CONTRACT_DESIGN_PRECISION_READY_FOR_APPROVAL`.**

---

## 37.29 F2 retry-admission budget Design Precision (2026-10-24)

### 37.29.0 Authorization, scope and relationship to prior Design

This append-only Design Precision Amendment resolves the implementation details
that §37.24 left open for `ERP_GATE_ATTEMPTS_BUDGET_MS`. Sections 37.0–37.28 are
preserved verbatim. In particular, §37.24 remains authoritative that elapsed time
is an **outer-attempt admission control**, not a hard request-duration bound, and
§37.28 remains authoritative for Manual Gate final-attempt exhaustion.

This section is Design only. It changes no production source, test, Requirement,
schema, migration, permission, Gate decision, Finance monetary semantic, Credit
behavior, MySQL isolation setting, global transaction gate or lock order. F2
implementation requires a separate approval.

### 37.29.1 Exact configuration contract

`ERP_GATE_ATTEMPTS_BUDGET_MS` has this complete contract:

```text
default                         15000 milliseconds
minimum                         1000 milliseconds
maximum                         60000 milliseconds
accepted lexical form           ASCII decimal digits only, after trimming
accepted numeric form           canonical positive decimal safe integer
fallback                        15000 milliseconds
```

The lexical form is `^[1-9][0-9]*$`. A leading sign, leading zero, decimal point,
exponent, non-ASCII digit or other character is invalid. Missing, empty,
malformed, unsafe, zero, negative, below-minimum and above-maximum values all
fall back to `15000`.

Configuration is resolved exactly once per logical request, after authorization,
request parsing, required validation and stable request-identity binding, and is
then immutable across every outer attempt. No retry, discovery, rollback or
backoff may re-read the environment. `ERP_GATE_ATTEMPTS_MAX` retains its existing
default-three, safe-integer 1–3 contract. `ERP_DB_TX_RETRY_MAX` retains its
existing default-three, safe-integer 0–10 contract and remains owned by
`transaction()`.

### 37.29.2 Monotonic clock, start point and exact comparison

The elapsed-time source is exactly `process.hrtime.bigint()`. The coordinator
captures one `startedAtNs` immediately before the first outer-attempt discovery
loop, after the entrypoint has completed authorization, request parsing, required
validation, stable business-date/snapshot/fingerprint/idempotency identity
binding and any approved transaction-free exact-replay probe.

The same start value and resolved budget apply for the complete logical request.
They are not reset by outer discovery, transaction rollback, inner MySQL retry,
retry backoff, Requirement or Parent rediscovery, or Order/Delivery/Service
rediscovery. Comparison remains in integer nanoseconds:

```text
elapsedNs = process.hrtime.bigint() - startedAtNs
expired   = elapsedNs >= BigInt(configuredBudgetMs) * 1_000_000n
```

Equality is expired. Admission is checked before attempt 1, before every later
outer attempt, and after a completed failed inner transaction when its error is
rediscovery-eligible and another outer attempt remains available. No discovery
or transaction for a new outer attempt may start after expiration.

An admitted transaction is allowed to finish normally. No asynchronous timer,
forced cancellation, interruption or retrospective rollback is introduced. A
committed success returns its normal success response even when the admission
budget expired while that attempt was in flight. Nothing here promises that an
HTTP request completes within 15000 milliseconds.

### 37.29.3 Attempt counting and deterministic precedence

`details.attempts` is the number of outer attempts actually **started**, excluding
all inner `transaction()` executions. It is an integer from zero through the
configured `ERP_GATE_ATTEMPTS_MAX`:

- deadline refusal before attempt 1: `attempts=0`;
- attempts 1 and 2 ran, deadline refuses attempt 3: `attempts=2`;
- final permitted attempt fails retryably: count exhaustion wins, reports the
  started-attempt count, and retains that attempt's approved retryable cause.

The complete precedence is:

1. A committed attempt returns normal success, including exact replay, even if
   the budget expires while the admitted attempt runs.
2. A non-retryable failure retains its original status, code and message,
   irrespective of elapsed time. This includes ordinary business 409, permission,
   validation, Gate BLOCK, genuine missing Requirement and unsupported Parent.
3. A retryable failure on the final configured outer attempt returns the existing
   endpoint-specific retry-exhaustion response with the final approved retryable
   cause. A later clock reading cannot replace it with the deadline cause.
4. When another outer attempt is count-permitted, rollback has completed and the
   admission deadline has expired, the next attempt is not admitted. The existing
   endpoint-specific 503 retry-exhaustion response is returned with the exact
   deadline cause specified below.
5. Backoff never grants admission: the deadline is checked again at the next
   attempt boundary, and an expired request stops before fresh discovery.

### 37.29.4 Exact deadline cause and endpoint public contracts

The stable deadline cause is exactly:

```text
SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED
```

It is a cause only, never a replacement for an endpoint's top-level exhaustion
code. It may be emitted only when elapsed time prevents an otherwise
count-permitted outer attempt. Raw SQL, driver text, stack traces, credentials and
unstructured exception messages are forbidden in every public cause field.

The following strings and field conventions were copied from the current local
implementation and are frozen for F2:

| Entrypoint | HTTP | Top-level code and `details.code` | Exact `error` / `message` | Cause field on deadline |
|---|---:|---|---|---|
| Manual Gate Evaluation | 503 | `SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED` | `预付款门评估重试次数已耗尽，请稍后重试` | `details.cause = SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED` |
| Sales Order Submit | 503 | `SALES_ORDER_SUBMIT_RETRY_EXHAUSTED` | `销售订单提交重试已耗尽` | `details.causeCode = SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED` |
| Reservation Intent Request | 503 | `SALES_RESERVATION_INTENT_RETRY_EXHAUSTED` | `预留意图请求重试已耗尽` | `details.causeCode = SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED` |
| Sales Delivery Confirm | 503 | `SALES_DELIVERY_CONFIRM_RETRY_EXHAUSTED` | `销售出库确认重试已耗尽` | `details.causeCode = SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED` |
| Service Fulfillment Confirm | 503 | `SERVICE_FULFILLMENT_CONFIRM_RETRY_EXHAUSTED` | `服务履约确认重试已耗尽` | `details.causeCode = SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED` |

Every response also contains `details.retryable=true` and the started outer
attempt count. The existing structured `HttpError` serializer remains
authoritative, so the same code appears at top level and in `details.code`, and
the exact message appears as both `error` and `message`. The four `causeCode`
fields are not renamed. §37.28's Manual Gate cause whitelist is extended only by
the exact deadline cause and only under the admission condition above.

### 37.29.5 Replay, identity, rollback and inner-retry interaction

Existing transaction-free exact-replay probes remain before the admission clock
for Sales Submit, Delivery Confirm and Service Fulfillment Confirm. They return a
previous committed result without entering the attempt loop. Reservation Intent
Request has no exact-replay contract; its existing duplicate-intent business
validation remains unchanged and is never converted to a deadline 503.

Manual Gate currently performs its `snapshot_key` replay probe inside the
transaction. F2 implementation must add a safe, read-only probe for the same
`sales_order_id + stage + snapshot_key` identity before starting the admission
clock, so a previously committed exact replay is not refused by the deadline.
The existing in-transaction replay probe is retained to close the race between
the read-only probe and the admitted transaction. Neither probe mutates business
state or moves a mutation outside the canonical transaction.

The request's actor, business date, snapshot/fingerprint, idempotency key and
generated in-flight identity remain stable across retries. Every rejected
transaction rolls back before admission is reconsidered. Deadline exhaustion
creates no Gate Result, Reservation Intent, Inventory Lock, Planning Reservation,
Sales transition, Delivery/Service confirmation, AR, voucher, audit or
idempotency success record.

The synchronous canonical `transaction()` remains unchanged. The admission
budget does not cancel an inner retry, interrupt `FOR UPDATE`, replace
`innodb_lock_wait_timeout`, alter `ERP_DB_TX_RETRY_MAX`, or count an inner retry
as an outer attempt. After inner retries exhaust and rollback completes, the
outer coordinator checks the count first: if count is exhausted, final-cause
precedence applies; otherwise it checks elapsed time before another attempt.

### 37.29.6 Future helper design and bounded implementation manifest

For a separately approved F2 implementation, add one small domain helper:

```text
new file: server/modules/sales-gate-retry-admission.js

responsibilities:
  parseGateAttemptsBudgetMs(rawValue)
    - trim and validate the exact lexical/range contract
    - return 15000 for every invalid or absent value

  startGateRetryAdmission(rawValue, readMonotonicNs = process.hrtime.bigint)
    - resolve configuration once
    - capture one monotonic startedAtNs
    - retain the injected clock function for deterministic checks

  isGateRetryAdmissionExpired(admission)
    - compare integer nanoseconds using elapsed >= configured budget
    - perform no database access and construct no HTTP error
```

The helper is deterministic under clock injection, owns no database transaction,
lock, retry classification, idempotency identity or HTTP serialization, and does
not read the environment after its one request-scoped construction. Endpoint
owners continue to construct their exact 503 responses.

The complete future production manifest is limited to:

1. New `server/modules/sales-gate-retry-admission.js` — pure parsing, monotonic
   state and expiration evaluation.
2. `server/modules/sales-prepayment-gate.js` — Manual Evaluation only, including
   the safe pre-clock replay probe and Manual `cause` response.
3. `server/modules/sales-orders.js` — Submit branch only; preserve the existing
   pre-clock idempotency replay and `causeCode` response.
4. `server/modules/sales-reservation-intent.js` — `requestReservationIntent()`
   only; preserve duplicate-intent behavior and `causeCode` response.
5. `server/app.js` — `confirmSalesDelivery()` confirm branch only; preserve its
   pre-clock replay and `causeCode` response.
6. `server/modules/service-fulfillment.js` —
   `confirmServiceFulfillmentCommand()` only; preserve its pre-clock replay and
   `causeCode` response.
7. Existing focused Wave 7/Wave 8/Delivery/Finance test files only as required
   for deterministic F2 coverage; any new test file must be separately listed
   and registered under `scripts/testing/test-suites.js` before creation.

Explicitly excluded: the Finance Adapter, Gate lock helper sequence,
`server/db.js`, `server/database/`, `mysql_transaction_gates`, schema, migrations,
permissions, frontend, Wave 9 Credit, Wave 10 Credit and package version.

### 37.29.7 Deterministic future acceptance contract

F2 tests use the injected monotonic clock seam, never timing sleeps or leaked
global clock monkey-patches. They must cover:

1. default `15000`, minimum `1000`, maximum `60000`;
2. whitespace trimming and every missing/empty/malformed/unsafe/out-of-range
   fallback, including signs, leading zeros, decimal and exponent forms;
3. exact `elapsed == budget` expiration and the non-expired value immediately
   below it;
4. first-attempt refusal with `attempts=0`, and admission/refusal of attempts 2/3;
5. one request-wide clock across rollback, discovery, backoff and inner retry;
6. count-exhaustion precedence with the final retryable cause;
7. deadline precedence only while another outer attempt remains;
8. committed success after deadline and non-retryable error preservation;
9. exact five-endpoint HTTP status/code/message/details matrix, including Manual
   `cause` versus the other four endpoints' `causeCode`;
10. stable business date, snapshot, fingerprint, idempotency key and replay;
11. zero duplicate or partial durable effects on every exhaustion path;
12. no post-L7 Parent lock and the unchanged L1–L8/business-row lock graph;
13. all Implementation A–E and F1 regressions.

SQLite/fault-injection tests prove deterministic admission, public contracts and
rollback behavior only. They do not prove independent-session MySQL contention
or a hard wall-clock timeout.

### 37.29.8 Boundary and status

No production source, test, `document.md`, `README.md`, existing §37 text,
schema, migration, permission, package version or database state is changed by
this amendment. No MySQL connection or gate execution, and no Git write,
destructive operation, release or deployment is authorized. F2 implementation,
A-RAW, A-PROD, MySQL Guard and Gate A remain pending. No acceptance or freeze is
declared, and Wave 10 remains blocked.

**Status: `F2_DESIGN_PRECISION_READY_FOR_APPROVAL`.**

---

## 37.30 Transaction-Start Named-Lock Safety Hotfix Design (2026-10-24)

### 37.30.0 Authorization, scope and supersession

- The user approved `document.md §5.4.1 — Transaction-Start Named-Lock Safety
  Requirement` with status
  `TRANSACTION_BEGIN_HOTFIX_REQUIREMENT_PASS`, and authorized **DESIGN ONLY**
  under AGENTS.md §4.3.
- This section is the Design deliverable for that Requirement. It introduces no
  new business rule, no new money semantics, no new lock order, no new retry
  rule and no new schema.
- This section **does not modify §37.0–§37.29** and does not modify
  `document.md §5.4.1`. It is additive.
- Boundary of this Design: no production source, test, schema, migration,
  `README.md`, `package.json` version, database state or Git history is changed
  by this section. No MySQL connection, Gate execution, reset or destructive
  operation is authorized by it.
- Everything below is **design**. The proposed functions, files and tests do not
  exist yet. Gate A remains blocked, retest #2 remains unexecuted, and Wave 10
  remains blocked.

### 37.30.1 Verified baseline facts (read from the local working tree, 2026-10-24)

Baseline identity: `feature/sales-waves6-13@2037cb632e2464477fe9752dc3113dac3c0eacf3`,
package version `1.6.2`, 2 remotes, 2 stashes. All local modifications listed in
§37.0–§37.29 (Implementation A–E, F1/F2, M24/M25 remediation, Gate A
integration infrastructure) are present and preserved.

| # | Fact | Evidence |
|---|---|---|
| B1 | `transaction()` executes `db.exec('BEGIN IMMEDIATE')` **outside** its `try` block | `server/db.js:1883-1913`; the statement is at `:1887`, the `try` opens at `:1888` |
| B2 | The only two `releaseMySqlIdempotencyLocks(db)` call sites are reachable **only after BEGIN succeeded**: one after `COMMIT` (`:1898`), one in the post-BEGIN catch (`:1907`) | `server/db.js:1897-1907` |
| B3 | `releaseMySqlIdempotencyLocks()` swallows every `RELEASE_LOCK` error (`catch {}`), never inspects the returned value, and clears the whole registry unconditionally | `server/db.js:1875-1881` |
| B4 | `idempotencyReplay()` acquires `GET_LOCK(?,10)` and registers the lock in `db._idempotencyLocks`; on a **replay miss** it returns `null` **without** releasing, deliberately, so the transaction lifecycle owns the release | `server/modules/financial-controls.js:32-57` (acquire `:37`, register `:39-40`, miss-return `:51`) |
| B5 | `createRefund` calls `idempotencyReplay()` at `:199` and `transaction()` at `:200` with **no intervening throw** (M24 remediation removed the pre-replay capacity rejection) | `server/modules/financial-controls.js:199-200`; `log/2026-10-24.md` M24 correction |
| B6 | The adapter's `isTransaction` mirror is updated **only** from a successful worker response; a failed or timed-out `exec()` leaves it unchanged | `server/database/mysql-adapter.js:159-175` (`:167-168`) |
| B7 | On request timeout `_request()` abandons the request generation and throws a bare `Error('MySQL <action> timed out after N seconds')` with **no** `code`, `errno` or `sqlState` | `server/database/mysql-adapter.js:117-137` (`:124-127`) |
| B8 | The Worker response slot is **generation-scoped**: a late response for an abandoned generation returns `false` at the first CAS and never writes bytes or metadata | `server/database/mysql-worker-protocol.js:36-59` (`:38`, `:55`) |
| B9 | The Worker's own `inTransaction` flag is **not** generation-scoped: the 'exec' handler sets it after `runExec` resolves and **before** `encodeWorkerResponse` | `server/database/mysql-worker.js:243-255` (`:251`, `:253`) |
| B10 | A recoverable connection error makes the Worker discard the session (socket destroyed) before rethrowing | `server/database/mysql-worker.js:123-138`, `:243-250` |
| B11 | `adapter.close()` performs a blocking `'close'` round-trip bounded by `requestTimeoutMs` (default 60 s) and then calls `void this.worker.terminate()` — **fire-and-forget**, completion not observable | `server/database/mysql-adapter.js:177-183`; `:89`, `:96` |
| B12 | `readTransaction()` has the identical "BEGIN outside try" shape and registers no named lock | `server/db.js:1915-1933` (`:1916`) |
| B13 | `db.isTransaction` is the canonical **nesting guard** in ≥15 production modules; those guards call the body directly instead of `transaction()`, so `transaction()` is never legitimately entered with an open transaction | `commercial-golive.js:50`, `finance-recognition.js:16`, `traceability-quality.js:122`, `finance-ap-open-item.js:94`, `finance-ar-open-item.js:112`, `finance-business-close.js:100`, `finance-counterparty-transfer.js:110`, `finance-due-schedule.js:98`, `finance-parameters.js:65`, `finance-refresh-open-amount.js:71`, `finance-settlement-reversal.js:74`, `finance-settlement-scheme.js:52`, `finance-terms.js:58`, `finance-treasury-movement.js:34`, `finance-unapplied-balance.js:91`, `lib/inventory-mutation.js:456-469` |

### 37.30.2 The exact defect and its reachable trigger

The reachable defect is a **connection-lifecycle leak**, not a business-logic
defect:

```text
createRefund / reverseRefund / actOnWriteOff / reverseOperationalReturn
  : idempotencyReplay(...)   -> GET_LOCK acquired, registered in db._idempotencyLocks
     (replay MISS: lock intentionally retained for the transaction to release)
  : transaction(db, work)
       db.exec('BEGIN IMMEDIATE')     <-- server/db.js:1887, OUTSIDE the try
         ^ THROWS (lock wait timeout on the L0 gate, transport loss, adapter
           request timeout, ...)
       -> the try at :1888 never opens
       -> neither release site (:1898, :1907) is reachable
       -> the MySQL session keeps the named lock
       -> the session is the process-wide adapter and stays REUSABLE
       -> the next process that requests the same idempotency scope blocks on
          GET_LOCK(?,10) until its own 10 s timeout, forever, for that scope
```

Three independent facts make the trigger reachable in production, not
theoretical:

1. M24 remediation (2026-10-24) deliberately removed the application rejection
   that previously stood between `idempotencyReplay()` and `transaction()`, so a
   replay miss now reaches BEGIN immediately (B5).
2. The L0 transaction gate (`SELECT gate_id FROM mysql_transaction_gates WHERE
   gate_id=1 FOR UPDATE`) is acquired by **every** writer, so BEGIN is the exact
   point at which a heavily contended MySQL instance fails (M25 reproduces the
   contention with `ERP_DB_TX_RETRY_MAX=0`).
3. `idempotencyReplay()` acquires the named lock **before** the transaction, so
   the lock is already owned when BEGIN fails (B4).

The objective of this hotfix is therefore stated as:

> **No owned MySQL named idempotency lock may remain on a connection that
> remains reusable after a transaction-start failure.**

### 37.30.3 Transaction ownership model and evidence

Five distinct ownership states are defined. `db.isTransaction` alone is
**never** accepted as proof that the current attempt owns the transaction.

| # | State | Definition | Proof required | Rollback by this attempt |
|---|---|---|---|---|
| O1 | `OWNED_STARTED` | This attempt's BEGIN was acknowledged by the Worker on this session | The successful `exec()` return carrying `inTransaction === true` (B6) — the Worker sets that flag only after the server acknowledged `START TRANSACTION` | **Yes** — but only on the post-BEGIN failure path, exactly as today |
| O2 | `FOREIGN_PREEXISTING` | A transaction was already open on this connection **before** this attempt | The pre-attempt snapshot `db.isTransaction === true` (B13) | **No** — never |
| O3 | `START_FAILED_KNOWN` | BEGIN was rejected by the server on a live session, so no transaction was created by this attempt | The Worker returned a definite error (`status === 2`) and did **not** report `sessionLost` | Not applicable — this attempt owns nothing |
| O4 | `START_FAILED_UNCERTAIN` | The outcome of `START TRANSACTION` on the server is unknown because the synchronous adapter request timed out | The adapter reported a request timeout (B7) | **No** — blind rollback is forbidden |
| O5 | `SESSION_REPLACED` | The original session was abandoned and the adapter will reconnect to a new one | The Worker reported `sessionLost` (B10) | Not applicable — the original session is unreachable |

Two rules follow and are binding:

- **R-O1 — pre-attempt snapshot.** `transaction()` reads
  `db.isTransaction` **before** BEGIN and records it. Because a failed `exec()`
  never updates the mirror (B6), the post-failure value of `db.isTransaction` is
  evidence about the **pre-attempt** state and never about ownership by this
  attempt. After a failed BEGIN, `db.isTransaction === true` therefore proves
  O2, not O1.
- **R-O2 — no blind commit, no blind rollback on the startup-failure path.** The
  startup-failure cleanup path issues **neither** `COMMIT` **nor** `ROLLBACK`.
  It owns no transaction (O3/O4) and must not touch a transaction it cannot
  prove it owns (O2). This satisfies `document.md §5.4.1` bullet 3 without
  changing the nesting contract of B13.

The existing post-BEGIN catch path (`try { if (db.isTransaction) db.exec('ROLLBACK'); } catch {}`,
`server/db.js:1901`) is **unchanged**: there, `db.isTransaction === true` was set
by this attempt's own successful BEGIN (O1), so the rollback is correct.

### 37.30.4 Startup-failure state machine

`BEGIN` is attempted once per retry attempt. On failure the attempt enters the
cleanup boundary below and then rethrows the original exception. The retry
budget is **not** consumed and **not** extended (see §37.30.8).

| Case | Failure | Owning transaction provable? | Rollback permitted? | Named-lock release verifiable? | Connection reusable? | Worker terminated / quarantined? | Error propagated | Proof test |
|---|---|---|---|---|---|---|---|---|
| **A** | BEGIN rejected by the server before any transaction was established, connection healthy | No — nothing was created (O3) | No | **Yes** — `RELEASE_LOCK` on the same live session | **Yes**, after a confirmed release | No | Original BEGIN error | T1, T3, T4 |
| **B** | BEGIN fails because the connection is broken (transport error) | No (O5) | No | Not needed — the Worker already destroyed the session; the server released its locks and rolled back its transaction (B10) | **Yes** — the adapter reconnects to a **new** session that carries no lock | No — the Worker already discarded the session; no second teardown is issued | Original BEGIN error, with `sessionLost` | T1, T2 |
| **C** | BEGIN fails because the synchronous adapter request timed out | **No — unknown (O4)** | **No** | **No** — the Worker may still be executing `START TRANSACTION`; issuing further SQL would be queued behind it on the same session and its result would be ambiguous | **No** | **Yes** — quarantine + `worker.terminate()` | Original timeout error | T15, T16, T17, T18 |
| **D** | BEGIN fails while a transaction may already be active (O2, pre-attempt snapshot `isTransaction === true`) | No — the pre-existing transaction is not ours | **No** — R-O2 | Only the named lock is ours; release is attempted and verified like case A | **No** — the session carries a transaction whose ownership cannot be established; a later `BEGIN` would make MySQL implicitly commit it | **Yes** — quarantine + terminate | Original BEGIN error | T5 |
| **E** | BEGIN fails after the Worker may have executed `START TRANSACTION` but before the caller received confirmation | **No — unknown (O4)** | **No** | **No** — same reasoning as case C | **No** | **Yes** — quarantine + terminate | Original error | T15, T18, T19 |
| **F** | `RELEASE_LOCK` fails with a transport error during cleanup | No | No | **No** | **No** | **Yes** | Original BEGIN error (cleanup failure is diagnostic only) | T6, T7 |
| **G** | `RELEASE_LOCK` returns `1` | No | No | **Yes — proved release on the original session** | **Yes** | No | Original BEGIN error | T3 |
| **H** | `RELEASE_LOCK` returns `0` (lock exists, held by another session) | No | No | **No** — not a confirmed release of *our* lock | **No** | **Yes** | Original BEGIN error | T6, T7 |
| **I** | `RELEASE_LOCK` returns `NULL` (lock does not exist) | No | No | **No** — not a confirmed release of *our* lock | **No** | **Yes** | Original BEGIN error | T6, T7 |
| **J** | Connection quarantine or closure itself fails | No | No | **No** | **No** | Attempted; the failure is recorded, and the adapter stays unusable | Original BEGIN error | T7, T18 |

Classification rules that produce the table:

- **R-F1.** The failure is classified from machine-readable signals only:
  - `sessionLost === true` (Worker-reported) → case B.
  - the adapter's request-timeout marker → case C / E.
  - any other definite Worker error → case A (or D, when the pre-attempt
    snapshot shows O2).
  Message-text pattern matching is **forbidden**.
- **R-F2.** Only `RELEASE_LOCK(...) = 1` is a confirmed release (case G). `0`,
  `NULL`, an unexpected value and a thrown error are all **not confirmed**
  (cases F/H/I) and force quarantine. This is deliberately stricter than the raw
  MySQL return semantics: the Requirement forbids treating a release failure as
  success, and only a `1` proves that *this* session held and released *this*
  lock.
- **R-F3.** In case B the cleanup issues **no** SQL at all. The Worker already
  destroyed the session, so the server released every named lock the session
  held and rolled back any open transaction. This is the Requirement's explicit
  escape clause ("能够确认连接已经失效或锁已经由服务器释放").
- **R-F4.** In cases C and E the cleanup issues **no** SQL at all. The only safe
  action is to destroy the session.
- **R-F5.** Unknown connection state always fails closed. If the cleanup cannot
  prove that the session is free of our named locks, the session is destroyed
  and the adapter is not reused.

### 37.30.5 Verified named-lock release contract

One canonical helper replaces the current void helper. Its contract:

```text
releaseMySqlIdempotencyLocks(db) -> {
  attempted:  number,            // locks examined
  confirmed:  string[],          // locks whose RELEASE_LOCK returned exactly 1
  unconfirmed: [{ outcome, code }] // NOT the lock names
}
```

Rules:

1. **Confirmation.** A lock is confirmed released only when
   `SELECT RELEASE_LOCK(?)` yields exactly `1`. Outcomes `0`, `NULL`,
   unexpected values and thrown errors are recorded as unconfirmed with a
   machine-readable `outcome`
   (`NOT_OWNER` / `LOCK_ABSENT` / `UNEXPECTED_VALUE` / `ERROR`).
2. **Registry retention.** A lock is removed from `db._idempotencyLocks` **only**
   when it is confirmed. Unconfirmed locks stay registered, so the local
   ownership-tracking state is never erased while the release status is unknown
   (`document.md §5.4.1` bullet 4). The registry is cleared only in the
   `sessionLost` case, where the server-side release is independently proven.
3. **Same-session discipline.** A confirmed `1` is only meaningful when it was
   produced by the session that acquired the lock. The cleanup therefore issues
   no SQL at all in cases B, C and E, and in case A/D the session is provably
   the same one (the Worker did not discard it, so no reconnect happened).
4. **Deterministic ordering.** Locks are released in a stable order (the
   registration order of the `Set`) so the diagnostic is reproducible.
5. **Diagnostics contain no sensitive data.** The recorded diagnostic contains
   the lock **count** and per-lock `outcome`/`code` only. Full lock names, SQL
   text, bind parameters, credentials and the idempotency key are never
   recorded. The lock name itself is a hash of the operation/document/key and
   is still treated as sensitive-by-derivation.
6. **The normal path uses the same primitive.** The existing post-`COMMIT`
   (`:1898`) and post-catch (`:1907`) call sites call the same helper. This is
   the bounded correction required by §37.30.12.2.

### 37.30.6 Quarantine and connection teardown semantics

Three teardown outcomes are distinguished, exactly as the Requirement demands.
Quarantine **prevents reuse**; it is never described as proof that the
server-side lock was released.

| Category | Meaning | How it is reached | Connection reusable? |
|---|---|---|---|
| **A — Proved release on the original session** | `RELEASE_LOCK` returned `1` on the session that acquired the lock | Case G | **Yes** |
| **B — Provably destroyed original session** | The Worker destroyed the session (`sessionLost`), or the teardown completed and the Worker thread exited, closing the socket and ending the MySQL session | Case B; case C/E after termination is confirmed | The **new** session is usable; the original is gone |
| **C — Quarantined but not yet provably destroyed** | Reuse is blocked immediately, but the Worker thread has not yet confirmed its exit | Case C/E/D/F/H/I, and case J | **No** |

Mechanism:

1. **Quarantine is immediate and synchronous.** The adapter is marked unusable
   before any other application operation can run. Every subsequent business SQL
   on that adapter is rejected.
2. **The teardown is bounded and does not wait on the Worker.** The teardown is
   `worker.terminate()`, not `adapter.close()`. `adapter.close()` performs a
   blocking `'close'` round-trip bounded by `requestTimeoutMs` (60 s by
   default) — precisely the wrong mechanism when the Worker is stuck executing
   the very statement that timed out (case C/E), and it would burn the request
   thread for up to a minute.
3. **Termination completion is verifiable.** `worker.terminate()` returns a
   promise. The adapter records the teardown state so the outcome is
   *reportable* rather than assumed:

   ```text
   adapter.quarantineState = {
     reason, at,
     state: 'TERMINATION_PENDING' | 'TERMINATION_CONFIRMED' | 'TERMINATION_FAILED',
     termination: Promise
   }
   ```

   `TERMINATION_CONFIRMED` proves the Worker thread exited; its TCP socket was
   therefore closed and the MySQL session was ended by the server, which
   releases the session's named locks and rolls back its open transaction.
   `TERMINATION_FAILED` is recorded as a diagnostic and the adapter remains
   unusable (fail closed).
4. **Automatic reconnect cannot conceal the abandoned session.** After
   quarantine the parent sends no further messages to the Worker, so
   `ensureConnection()` is never reached and the Worker cannot reconnect. The
   Worker thread is additionally terminated, so no late `START TRANSACTION`
   completion can act on a session the adapter still believes it owns.
5. **The original BEGIN exception is the primary failure.** The cleanup never
   replaces, wraps or re-throws a different error. Cleanup outcome is attached
   as a **non-primary** diagnostic property on the original error object and is
   logged structurally. Because `serializeError()` (`server/lib/http.js:35-51`)
   copies only `message`/`code`/`details` for `HttpError` and only `code` for a
   generic error, an extra property cannot leak into an HTTP response.
6. **Reuse prohibition.** A quarantined adapter is terminal for that adapter
   instance. No automatic re-establishment is introduced by this hotfix; the
   re-establishment policy is an open item (§37.30.13, O5). The operational
   consequence is stated plainly: a quarantined adapter requires a process-level
   MySQL re-establishment before further business SQL.

### 37.30.7 Worker timeout and late-completion handling

The nine questions raised by the Requirement are answered against the local
implementation:

1. **What happens when `START TRANSACTION` finishes after the caller times
   out?** The Worker completes the statement, sets its own `inTransaction` flag
   to `true` (B9) and calls `encodeWorkerResponse()`. The parent had already
   called `abandonWorkerRequest()`, so the request generation is no longer
   active and `encodeWorkerResponse()` returns `false` at its first CAS
   (B8). **The response is discarded and never published.**
2. **Can a later response change transaction state unexpectedly?** Not through
   the response slot — it is generation-scoped. **But the Worker's internal
   `inTransaction` flag is not generation-scoped** (B9): it is set before the
   CAS and would be observed by the *next* successful `exec` response. In this
   hotfix this is harmless because the timeout path quarantines and terminates
   the Worker immediately, so no later request can observe it. The residual
   hazard is reported as an open item (§37.30.13, O3) rather than silently
   patched.
3. **How is further SQL prohibited on an uncertain adapter?** Quarantine sets
   the adapter's unusable flag before any other application operation can run;
   every subsequent request is rejected. In addition, the cleanup path issues
   **no** SQL in cases C and E.
4. **How are pending Worker operations prevented from racing with cleanup?**
   They are not raced — they are terminated. The cleanup path issues no SQL in
   cases C/E, so the only concurrent action is `worker.terminate()`, which stops
   the thread.
5. **How is the original MySQL session retired safely?** By destroying it.
   `worker.terminate()` ends the thread; the thread's TCP socket is closed; the
   server ends the session, releasing its named locks and rolling back its open
   transaction. This is the only mechanism that resolves case E without
   guessing.
6. **Is `worker.terminate()`, connection destruction, `adapter.close()` or
   another bounded mechanism required?** `worker.terminate()` is required.
   `adapter.close()` is insufficient and harmful here (blocking round-trip on a
   stuck Worker; unobservable termination). In-Worker connection destruction
   (`discardStaleConnection`) is not reachable from the parent while the Worker
   is busy with the timed-out statement.
7. **Can termination completion be verified?** Yes — `worker.terminate()`
   resolves to the exit code, and the adapter exposes the promise and a
   state machine (`TERMINATION_PENDING` / `CONFIRMED` / `FAILED`).
8. **How is automatic reconnect prevented from hiding a pending operation on
   the previous session?** Quarantine prevents the parent from sending any
   further message, so the Worker's `ensureConnection()` reconnect path is never
   reached; and the Worker thread is terminated, so an in-flight
   `START TRANSACTION` cannot complete on a session the adapter still tracks.
9. **Assumptions explicitly rejected.** Cancelling a `SharedArrayBuffer`
   response does **not** cancel the underlying MySQL statement; a request
   timeout does **not** prove the database operation failed; and no automatic
   retry of an uncertain mutation or transaction start is introduced.

### 37.30.8 Error precedence and retry compatibility

- **Primary error.** The original BEGIN exception object is rethrown unchanged.
  Its `message`, `code`, `errno`, `sqlState`, `sqlMessage` and stack are
  untouched. The cleanup outcome is attached as a non-primary diagnostic.
- **No misleading classification.** A startup failure is never rewritten as a
  business success, an idempotent replay, a business `409`, or a generic
  retryable `503`. A non-`HttpError` failure serializes through the existing
  generic path (`server/lib/http.js:46-49`, `server/app.js:2272-2276`) as HTTP
  500 with the original `code` — the same shape any other unexpected MySQL
  failure already produces today.
- **No new BEGIN retry.** BEGIN remains outside the retry budget. A BEGIN
  failure does not consume, extend or inflate the attempt counter.
- **No transaction-count inflation.** `error.transactionRetryExhausted` and
  `error.transactionAttempts` are set only by the existing post-BEGIN catch
  path for retryable MySQL errors (`ER_LOCK_DEADLOCK`, `ER_LOCK_WAIT_TIMEOUT`,
  errno 1213/1205, sqlState 40001). A BEGIN failure never reaches that path,
  so those properties remain absent for startup failures — exactly as today.
- **Retry classification preserved.** `isRetryableMySqlTransactionError()` and
  `mysqlTransactionRetryLimit()` are unchanged. The inner retry loop, the
  backoff, the retry-exhaustion classification and the F2 retry-admission budget
  (§37.29) are untouched.
- **Successful-path behaviour preserved.** `COMMIT`, `ROLLBACK`, the L0
  transaction gate, the Parent/business lock order, `READ COMMITTED`
  isolation, the idempotency scope/fingerprint/replay contract, the Finance
  monetary authority and the SQLite `BEGIN IMMEDIATE` semantics are all
  unchanged. The only behavioural delta on the success path is the bounded
  correction in §37.30.12.2.

### 37.30.9 Proposed function-level production changes

#### 37.30.9.1 `server/db.js` (the primary change)

| Function | Change | Responsibility |
|---|---|---|
| `releaseMySqlIdempotencyLocks(db)` | **Signature change**: void → result object | Verify each `RELEASE_LOCK`; confirm only on `1`; retain unconfirmed locks in `db._idempotencyLocks`; return `{ attempted, confirmed, unconfirmed }` without lock names, SQL or parameters |
| `mysqlNamedLockReleaseOutcome(value)` | New, module-private | Map a raw `RELEASE_LOCK` result to `RELEASED_CONFIRMED` / `NOT_OWNER` / `LOCK_ABSENT` / `UNEXPECTED_VALUE` |
| `classifyTransactionStartFailure(error)` | New, module-private | Map the failure to `SESSION_LOST` / `UNCERTAIN_TIMEOUT` / `KNOWN_SERVER_ERROR` using machine-readable signals only |
| `quarantineMySqlAdapter(db, reason)` | New, module-private | Invoke the adapter's quarantine entry point; record the outcome; never swallow a failure silently |
| `cleanupAfterFailedTransactionStart(db, error, preAttempt)` | New, module-private | The cleanup boundary: `SESSION_LOST` → no SQL, registry cleared with proof; `UNCERTAIN_TIMEOUT` → no SQL, quarantine; `KNOWN_SERVER_ERROR` → verified release, and quarantine unless every lock is confirmed and the pre-attempt snapshot shows no foreign transaction |
| `transaction(db, work)` | **Restructured, MySQL branch only** | Capture the pre-attempt snapshot; wrap BEGIN in a startup boundary that catches, cleans up and rethrows the original error; the SQLite branch keeps the literal `db.exec('BEGIN IMMEDIATE')` statement outside any new `try` so its behaviour is byte-identical |

The SQLite branch is deliberately left as a literal statement rather than being
folded into the shared `try`, so that `document.md §5.4.1`'s "SQLite
`BEGIN IMMEDIATE` semantics unchanged" is provable by inspection.

#### 37.30.9.2 Why `server/db.js` alone is insufficient

`server/db.js` can implement the verified release, the ownership snapshot and
the error precedence. It **cannot** implement quarantine or a bounded,
observable teardown, because the required capability does not exist in the
adapter today:

- **R1 — no quarantine entry point.** `db.closed = true` is the only reuse
  block the adapter offers (`server/database/mysql-adapter.js:118`, `:178`).
  It prevents further requests from the parent but leaves the Worker thread and
  its MySQL session alive, so the named lock would stay held **server-side
  indefinitely** — the cross-process stall this hotfix exists to remove.
- **R2 — no bounded teardown.** `adapter.close()` performs a blocking `'close'`
  round-trip bounded by `requestTimeoutMs` and then fires
  `void this.worker.terminate()` (B11). In the timeout case the Worker is busy
  with the statement that timed out, so the round-trip can consume the full
  request timeout on the request thread; and the termination is unobservable.
- **R3 — no machine-readable timeout marker.** `_request()` throws a bare
  `Error` whose message carries the only timeout signal (B7). `db.js` would
  have to pattern-match an English message to distinguish "the Worker may still
  be executing" from "the server returned a definite error". That is not an
  acceptable contract and would duplicate knowledge across two modules.
- **R4 — no provable session-loss signal.** Whether the original session was
  destroyed is decided in the Worker by the canonical
  `isRecoverableConnectionError()` / `discardStaleConnection()` pair (B10).
  That decision is not communicated to the parent, and re-deriving it in
  `db.js` would create a second canonical classification — forbidden by
  AGENTS.md §6.
- **R5 — no verifiable teardown outcome.** `worker.terminate()` returns a
  promise, but `close()` discards it, so "session destroyed" cannot be
  distinguished from "destroy pending". The Requirement explicitly requires
  distinguishing those three categories.

#### 37.30.9.3 `server/database/mysql-adapter.js` (narrowly bounded, proposed — not authorized)

| Addition | Why it is necessary | Exact responsibility | Regression proof |
|---|---|---|---|
| `MySqlSyncAdapter.quarantine(reason)` | R1, R2, R5 | Synchronously mark the adapter unusable; start `worker.terminate()`; record `quarantineState` with `TERMINATION_PENDING` → `TERMINATION_CONFIRMED` / `TERMINATION_FAILED`; never perform a blocking Worker round-trip | T7, T17, T18 |
| `_request()` timeout marker | R3 | Attach a machine-readable marker to the timeout error so the caller can classify it without message matching; the HTTP contract is unchanged (the marker is not `code`) | T15, T16 |
| `_request()` unusable-adapter error text | diagnosability | Distinguish "closed" from "quarantined" in the rejection message, and name the reason | T17 |
| `close()` | **no change required** | `quarantine()` sets the same unusable flag that `close()` already tests (`if (this.closed) return;`), so a quarantined adapter is never asked to perform the blocking `'close'` round-trip, and the Worker is already terminated | T17, T18 |

**No normal business connection behaviour changes.** `quarantine()` is reachable
only from the new startup-failure cleanup boundary and from a future explicit
operator action. The timeout marker only adds a property to an error that is
already being thrown. `close()` is untouched. The `_request()` success path, the
`exec()` transaction-mirror update, the `translateSqliteSql` translation layer
and the Worker protocol are all untouched.

#### 37.30.9.4 `server/database/mysql-worker.js` (narrowly bounded, proposed — not authorized)

| Addition | Why it is necessary | Exact responsibility | Regression proof |
|---|---|---|---|
| Session-loss marker on the discarded-session path | R4 | When the Worker discards the session because of a recoverable connection error, mark the error so the parent can prove the original session is gone; the Worker stays the single canonical owner of the recoverable-connection classification | T1, T2, T18, T19 |
| Marker propagation in `serializableError()` | R4 | Carry the marker from the Worker error into the response payload, without SQL text, parameters or credentials | T1, T2 |

The Worker already computes the discard decision in one place
(`discardStaleConnection`), so the marker is set at the discard sites rather
than by re-classifying the error in a second module.

#### 37.30.9.5 `server/database/mysql-worker-protocol.js` — **no change**

The generation-scoped late-response discard (B8) already provides the
guarantee the Requirement asks for: an abandoned request's late response can
never be published as trusted state. The residual hazard is the Worker's
non-generation-scoped `inTransaction` flag (B9), which this hotfix neutralises
by terminating the Worker on the timeout path and which is reported as an open
item (O3) rather than patched here. No protocol change is proposed.

### 37.30.10 Implementation file manifest

Nothing below exists yet. This is the complete future manifest.

**Production files (4):**

| File | Change | Approval needed |
|---|---|---|
| `server/db.js` | Startup-failure boundary, verified release helper, ownership snapshot, cleanup boundary, quarantine invocation | Core — covered by §5.4.1 |
| `server/database/mysql-adapter.js` | `quarantine()` + teardown state, timeout marker, unusable-adapter message | **Proposed — requires explicit approval** |
| `server/database/mysql-worker.js` | Session-loss marker on the discard path | **Proposed — requires explicit approval** |
| `server/database/mysql-worker-protocol.js` | **No change** | — |

**Test files (3 new + 1 modified):**

| File | Kind | Contents |
|---|---|---|
| `server/db-transaction-start-safety.test.js` | New, pure (no DB, no HTTP) → registered in **FAST** and **FULL** | T1–T10, T15, T16, T17, T18 (adapter-side), T20 |
| `server/mysql-transaction-start-safety.integration.js` | New, real MySQL → registered in **HEAVY** | T18 (server-side lock state after teardown), T19 |
| `server/database/test-fixtures/delayed-exec-mysql-worker.js` | New, Worker fixture (not a `*.test.js`, so no registry entry) | Controllable Worker that completes `exec` after a delay, for T15/T16 |
| `scripts/testing/test-suites.js` | Modified — registry only | Add the two new `*.test.js` files to the correct suites |

**Explicitly excluded:** no `document.md` change, no `README.md` change, no
`package.json` version change, no schema or migration, no Finance calculation
change, no Gate lock-order change, no Wave 10 code, no change to
`server/modules/financial-controls.js` (see §37.30.13, O1), no change to
`server/modules/sales-prepayment-finance-adapter.js`.

### 37.30.11 Deterministic test contract T1–T20

All tests use deterministic injected failures and a controllable Worker. **No
real MySQL execution is authorized by this Design**; the HEAVY file requires a
separately authorized disposable MySQL environment, exactly like the existing
Gate A integration suites.

| # | Case | Assertion | Mechanism | File |
|---|---|---|---|---|
| T1 | BEGIN fails before transaction establishment | The original BEGIN error is thrown; no `COMMIT` and no `ROLLBACK` is issued; no named lock remains registered | Fake MySQL db whose `exec('BEGIN IMMEDIATE')` throws | pure |
| T2 | BEGIN failure with an owned `GET_LOCK` | The registered lock is released and confirmed (or the adapter is quarantined); the lock is not left registered when the release is unconfirmed | Fake MySQL db with `db._idempotencyLocks` seeded | pure |
| T3 | Verified `RELEASE_LOCK` result `1` | The lock is confirmed and removed from `db._idempotencyLocks`; the adapter is **not** quarantined; the connection stays reusable | Fake db answering `released: 1` | pure |
| T4 | Original startup exception preserved | The thrown object is the **same instance** as the injected BEGIN error (identity, not just message); `transactionRetryExhausted` and `transactionAttempts` are absent | Fake db | pure |
| T5 | A pre-existing transaction is not rolled back | With `db.isTransaction === true` before the attempt and a failing BEGIN, **no** `ROLLBACK` is issued and the adapter is quarantined | Fake db | pure |
| T6 | `RELEASE_LOCK` returns `0` / `NULL` / throws | Each of the three is classified as unconfirmed; the adapter is quarantined; the registry entry is retained | Fake db answering `0`, `null`, or throwing | pure |
| T7 | Adapter becomes non-reusable when cleanup cannot be verified | After an unverified cleanup the adapter rejects every further business SQL; `quarantineState` is present | Fake db + adapter quarantine | pure |
| T8 | Existing successful `COMMIT` behaviour | The emitted sequence is `BEGIN` → L0 gate → work → `COMMIT`; the result is returned; the lock is released and confirmed | Fake MySQL db | pure |
| T9 | Existing `ROLLBACK` behaviour | When `work()` throws, `ROLLBACK` is issued and the original error is rethrown; the lock is released | Fake MySQL db | pure |
| T10 | Existing transaction retry behaviour | A retryable MySQL error in `work()` retries up to the existing limit, then sets `transactionRetryExhausted` and `transactionAttempts`; a **BEGIN** failure does not consume or inflate the budget | Fake MySQL db, `ERP_DB_TX_RETRY_MAX` controlled | pure |
| T11 | Refund exact replay remains HTTP 200 | Existing coverage retained: exact replay returns `200` with `replayed === true` and the original refund id | **Existing** `server/v13-phase6a-financial-controls.test.js` (M24 durable-state coverage) — re-run, no new file | existing |
| T12 | Refund fingerprint conflict remains HTTP 409 | Existing coverage retained: same key with a different fingerprint returns `409` | **Existing** `server/v13-phase6a-financial-controls.test.js` — re-run | existing |
| T13 | Zero duplicate Finance side effects | Existing coverage retained: no duplicate refund, voucher, entry, movement, audit or idempotency rows | **Existing** `server/v13-phase6a-financial-controls.test.js` — re-run | existing |
| T14 | SQLite behaviour unchanged | A `dialect: 'sqlite'` db takes no new code path: no `RELEASE_LOCK`, no quarantine, no `ROLLBACK` on a BEGIN failure, and the raw BEGIN error propagates; plus the entire unchanged FULL suite stays green on SQLite | Fake SQLite db + existing FULL regression | pure + existing |
| T15 | Worker `START TRANSACTION` completes after the adapter timeout | The adapter throws the timeout error; the Worker later completes the statement; the late response is discarded; the adapter is quarantined | Controllable Worker fixture | pure |
| T16 | A timed-out request cannot publish trusted transaction state | The abandoned generation's late response is not published (the response-slot CAS rejects it) and the adapter's `isTransaction` mirror is not flipped to `true` by the late completion | Controllable Worker fixture | pure |
| T17 | A quarantined adapter rejects further business SQL | Every subsequent `prepare()`/`exec()` on the adapter throws the quarantine error; no SQL reaches the Worker | Fake Worker | pure |
| T18 | Worker/session teardown outcome is accurately reported | `quarantineState.state` reaches `TERMINATION_CONFIRMED` after the Worker exits, and — against real MySQL — the named lock is no longer held (`IS_FREE_LOCK`/`IS_USED_LOCK` on an independent session) and the abandoned session is gone | Fake Worker (adapter-side) + real MySQL (server-side) | pure + HEAVY |
| T19 | An automatic reconnect does not silently reuse or validate the abandoned transaction context | After a quarantine the adapter never reconnects; the new session (if any) carries no transaction and no named lock, and the abandoned context is never reported as validated | Real MySQL | HEAVY |
| T20 | L0 and all existing production lock-order contracts remain unchanged | The L0 gate statement and its position (first inside the transaction, before business rows) are unchanged; the Wave 7 functional/acceptance suites and the M24/M25 fixtures stay green | Static assertion + existing suites | pure + existing |

Additionally, the existing source-contract assertion that `createRefund` calls
`idempotencyReplay()` immediately before `transaction()` with no intervening
throw (`server/v13-phase6a-financial-controls.test.js:432-460`) is re-run
unchanged, so the M24 replay-ordering contract cannot silently regress.

### 37.30.12 Compatibility, rollback and failure handling

**37.30.12.1 Compatibility.** The public HTTP contracts, the Finance monetary
facts, the idempotency scope/fingerprint/replay contract, the lock order, the
isolation level, the retry semantics and the SQLite semantics are unchanged.
The only observable behavioural deltas are:

1. On a transaction-start failure, the connection is now either verifiably
   cleaned (case A/G) or destroyed and unusable (cases B–F, H–J) — instead of
   silently retaining the named lock.
2. On the normal path, an **unconfirmed** `RELEASE_LOCK` no longer results in a
   silent registry clear (§37.30.12.2).

**37.30.12.2 The bounded correction to the normal-path release (flagged for
explicit approval).** The Design has confirmed that the *existing* normal-path
release cannot make safe reuse impossible when the release fails: today
`releaseMySqlIdempotencyLocks()` swallows the error and clears the registry, so
the connection continues to be reused while the server-side named lock may
still be held — the same leak, on the success path, after `COMMIT` or after a
post-BEGIN rollback. The exact necessary correction is:

> The two existing normal-path call sites (`server/db.js:1898` and `:1907`) must
> apply the **same** verified-release primitive and must quarantine the adapter
> when a release is unconfirmed.

Implementation scope: two call sites, one shared helper, **no new API, no new
file, no new SQL, no change to the success path** (a confirmed `1` behaves
exactly as today). The change is not applied to
`server/modules/financial-controls.js` (see O1). This correction is **not**
auto-authorized by §5.4.1's scoping sentence and is presented for a separate
explicit decision.

**37.30.12.3 Rollback of the hotfix itself.** The hotfix is a pure code change
with no schema, no migration and no data change. Reverting the four production
files restores the pre-hotfix behaviour exactly; there is no persistent state to
unwind. A quarantined adapter is not recoverable by reverting the code — it
requires the documented process-level MySQL re-establishment (O5).

**37.30.12.4 Failure handling.** Every cleanup branch is total: no branch may
throw a cleanup error in place of the original startup error, and no branch may
leave the adapter reusable after an unverified cleanup.

### 37.30.13 Open items — reported, not silently absorbed

| # | Item | Status |
|---|---|---|
| **O1** | `server/modules/financial-controls.js:47` and `:53` release the named lock on the pre-transaction paths (replay-found and read-failure) **without verifying** the result and delete the registry entry in a `finally`. The same leak therefore exists outside the transaction-start path. | Out of the §5.4.1 scope (the Requirement covers the startup-failure path). Recommend the same verified-release helper be applied there in a separate, explicitly authorized bounded change. |
| **O2** | A failed `ROLLBACK` or a lost `COMMIT` response leaves `db.isTransaction === true`. The next `transaction()` call then issues `BEGIN` while a transaction is open, which makes MySQL **implicitly commit** the previous, unresolved transaction. | Pre-existing, reachable, and a data-integrity hazard that this hotfix does **not** change (it is on the success path). Recommended as a separate Requirement: detect an unresolved transaction at attempt entry and fail closed instead of implicitly committing it. The startup-failure path already treats this state as non-reusable (case D). |
| **O3** | The Worker's internal `inTransaction` flag is not generation-scoped (B9): a late completion mutates it even though the response is discarded. | Neutralised on the timeout path by quarantine + terminate. Reported for a future protocol-level improvement; no protocol change is proposed here. |
| **O4** | `readTransaction()` has the identical "BEGIN outside the try" shape (`server/db.js:1916`) and therefore the identical uncertain-session exposure, although it registers no named lock. | Out of the §5.4.1 scope. Recommended as a separate bounded Requirement so the connection lifecycle is consistent across both transaction helpers. |
| **O5** | A quarantined adapter is terminal for that instance; no automatic re-establishment is designed here. | Deliberate fail-closed choice. An explicit, audited adapter re-establishment policy is a separate Requirement. |
| **O6** | The teardown's server-side effect (the server ending the session and releasing its locks) is proven asynchronously, after the Worker thread exits. The window between thread exit and the server's session teardown is not observable from the parent. | Accepted. It does not affect the safety invariant, which is stated over *reusable* connections. The HEAVY test asserts the server-side end state. |

### 37.30.14 Acceptance criteria

The hotfix is acceptable only when all of the following hold:

1. T1–T14 and T15–T20 all pass, with T11–T13 and T14 satisfied through the
   retained existing coverage and the unchanged FULL suite.
2. `pnpm test:fast`, `pnpm test`, `pnpm build` and `git diff --check` are clean,
   and the HEAVY suite passes against an authorized disposable MySQL target.
3. `document.md §5.4.1` is satisfied literally: no owned MySQL named idempotency
   lock remains on a reusable connection after a transaction-start failure; the
   original startup exception and its classification are preserved; no new BEGIN
   retry; no commit or rollback of a transaction not proven to belong to the
   attempt; an unverifiable release does not leave the connection reusable.
4. The preserved set is intact: Implementation A–E, F1/F2, M24/M25 remediation,
   the Gate A integration infrastructure, `solution.md §37.0–§37.29`, all
   existing logs and all local modifications.
5. No schema, migration, Finance calculation, Gate lock-order, Wave 10,
   permission or package-version change.
6. The user has explicitly confirmed this Design before any implementation
   begins, and has separately decided §37.30.12.2 (the normal-path correction)
   and O1–O5.

### 37.30.15 Boundary and status

This section is a Design deliverable only. No production source, test, schema,
migration, `document.md`, `README.md`, `package.json`, database state or Git
history is changed by it. No MySQL connection, Gate execution, reset, DROP,
schema recreation, destructive operation, release or deployment is authorized.
Gate A remains blocked, retest #2 remains unexecuted, and Wave 10 remains
blocked. No acceptance or freeze is declared.

**Status: `TRANSACTION_BEGIN_HOTFIX_DESIGN_READY_FOR_APPROVAL`.**

---

## 37.31 Transaction Lifecycle Safety Final Design Amendment (2026-10-24)

### 37.31.0 Authorization, scope and governing constraints

- The user approved `document.md §5.4.2 — Transaction Lifecycle Safety
  Requirement Addendum` with status
  `TRANSACTION_LIFECYCLE_REQUIREMENT_ADDENDUM_PASS`, and authorized **DESIGN
  ONLY** under AGENTS.md §4.3.
- `solution.md §37.30` remains approved in technical direction but
  **conditional**, because it does not yet cover all of R1–R7. This section is
  the single final bounded amendment that closes R1–R7 for the Transaction
  Lifecycle Safety work. R1–R7 are **not** split into separate projects or
  development waves.
- This section is additive. `§37.0–§37.30` are preserved byte-identically.
  `document.md §5.4.1–§5.4.2` are not modified by this section.
- This is a Design deliverable only. No production source, test, schema,
  migration, `README.md`, `package.json`, database state or Git history is
  changed by it. No MySQL connection, Gate execution, reset or destructive
  operation is authorized by it.
- The following previously recorded constraints govern this amendment and are
  honoured verbatim:

| # | Constraint | Source |
|---|---|---|
| C1 | No unverified MySQL server-variable probe (`@@session.in_transaction`, `@@autocommit`, Performance Schema). No local boolean is claimed as independent proof of server state. The admissible evidence chain is the adapter-local Worker-emitted `inTransaction` flag, acknowledged `ROLLBACK`, session-epoch continuity, and one complete canonical `transaction()`. | `log/2026-10-23.md` L58-61, L85-96, L110-111 |
| C2 | No hard wall-clock execution bound is claimed. Only attempt counts are enforceable: inner attempts = `ERP_DB_TX_RETRY_MAX` + 1 (4 default, 11 maximum), outer ≤ 3. The withdrawn "15000 ms hard upper bound" is **not** restated. | `log/2026-10-23.md` L473-484 |
| C3 | Registered named idempotency locks are released on **both** the commit path and the throw path. | `log/2026-10-23.md` L395-396, L484-485 |
| C4 | A pre-BEGIN guard must not re-serialize the raw A-RAW sessions and must not disturb the `mysql_transaction_gates` bypass semantics. | `log/2026-10-22.md` L1800-1803 |
| C5 | `db.isTransaction` must be false after every denial/rollback. Any new adapter flag is **additive** and must not displace `db.isTransaction`. | `log/2026-10-22.md` L1788-1789 |
| C6 | A protected real-MySQL suite fails closed at module load (non-zero exit, UNAVAILABLE diagnostic) and never skips to PASS. All three disposable-target flags are required. A pre-existing environment flag is not authorization. | `log/2026-10-22.md` L1616-1631, L1805-1811; `README.md` L253-257 |
| C7 | Worker teardown is explicit termination with an awaited outcome and a final no-leaked-connection proof via `information_schema.PROCESSLIST`. | `log/2026-10-22.md` L1797-1798 |
| C8 | A recovery path classifies only the expected transient failure, preserves it as failure evidence, recovers each victim **exactly once**, and treats anything unexpected as a hard failure. | `log/2026-10-22.md` L2171-2177 |
| C9 | Canonical write order is authorization → fingerprint → BEGIN → idempotency replay → lock → mutate → audit → save idempotency → COMMIT; the response is emitted only after a durable COMMIT. | `log/2026-10-22.md` L1357-1366; `log/2026-10-23.md` L705-707 |
| C10 | `*.integration.js` files are outside the FAST/FULL/HEAVY manifest by existing rule; `README.md` must not gain hardcoded suite lists or test counts. | `scripts/testing/test-suites.js:617-618`; `README.md` L394 |
| C11 | F2 elapsed-time admission control is **not implemented**; A-RAW / A-PROD / MySQL safety guards remain recorded as pending and are not discharged by this amendment. | `log/2026-10-23.md` L1216, L1255, L1296 |
| C12 | §37.10's statement that the global gate serialises every MySQL transaction before any business row must be reconciled with the new pre-BEGIN guard; row-level lock-order proof is never claimed from gated paths. | `log/2026-10-23.md` L288-293 |

### 37.31.1 Verified baseline facts (read from the local working tree, 2026-10-24)

Baseline identity: `feature/sales-waves6-13@2037cb632e2464477fe9752dc3113dac3c0eacf3`,
package version `1.6.2`, 2 remotes, 2 stashes, 602 protected SQLite artifacts.
All uncommitted work, Implementation A–E, F1/F2, M24/M25 remediation, the Gate A
A-PARITY / A-PROD / A-RAW fixtures and every append-only log are preserved.

| # | Fact | Evidence |
|---|---|---|
| F1 | `transaction()` executes `db.exec('BEGIN IMMEDIATE')` outside its `try` | `server/db.js:1883-1913` (`:1887` vs `:1888`) |
| F2 | The rollback in the catch path is `try { if (db.isTransaction) db.exec('ROLLBACK'); } catch {}` — **the rollback failure is swallowed** | `server/db.js:1901` |
| F3 | The retry loop then issues a fresh BEGIN on the next iteration | `server/db.js:1886-1887`, `:1910` |
| F4 | MySQL `START TRANSACTION` inside an open transaction **commits** that transaction. Therefore F2+F3 can turn a failed attempt's partial writes into a durable commit | MySQL semantics; combined with `server/db.js:1887`, `:1901`, `:1910` |
| F5 | §37.20 already asserts "an inner retry re-executes `work()` only AFTER `db.exec('ROLLBACK')` … so a successful callback can never duplicate a monetary or audit effect". F2+F3 **violate** that already-approved atomicity guarantee | `solution.md` §37.20, added-line block at `:22805-22808` |
| F6 | `releaseMySqlIdempotencyLocks()` swallows every error, never inspects the result and clears the registry unconditionally | `server/db.js:1875-1881` |
| F7 | `idempotencyReplay()` registers a `GET_LOCK` and, on a replay **miss**, deliberately retains it for the transaction lifecycle to release | `server/modules/financial-controls.js:32-57` |
| F8 | `createRefund` calls `idempotencyReplay()` at `:199` and `transaction()` at `:200` with no intervening throw | `server/modules/financial-controls.js:199-200` |
| F9 | `readTransaction()` has the same BEGIN-outside-`try` shape and registers no named lock | `server/db.js:1915-1933` (`:1916`) |
| F10 | The adapter's `isTransaction` is updated only from a successful Worker response | `server/database/mysql-adapter.js:159-175` (`:167-168`) |
| F11 | `_request()` abandons the request generation on timeout and throws a bare `Error` with no machine-readable marker | `server/database/mysql-adapter.js:117-137` (`:124-127`) |
| F12 | The Worker response slot is generation-scoped; a late response for an abandoned generation is discarded | `server/database/mysql-worker-protocol.js:36-59` (`:38`, `:55`) |
| F13 | The Worker's `inTransaction` flag is **not** generation-scoped; it is set before the response CAS | `server/database/mysql-worker.js:243-255` (`:251`, `:253`) |
| F14 | The Worker owns the canonical recoverable-connection classification and discards the session on a recoverable error | `server/database/mysql-worker.js:12-24`, `:33-45`, `:123-138` |
| F15 | The Worker already owns a canonical exec classifier (`BEGIN` / `COMMIT` / `ROLLBACK` / `OTHER`) that the parent does not use | `server/database/mysql-worker.js:59-65` |
| F16 | `adapter.close()` performs a blocking `'close'` round-trip bounded by `requestTimeoutMs` and then fires `void this.worker.terminate()` — unobserved | `server/database/mysql-adapter.js:177-183` |
| F17 | `db.isTransaction` is the canonical nesting guard in ≥15 production modules; those guards call the body directly and never re-enter `transaction()` | `commercial-golive.js:50`, `finance-recognition.js:16`, `traceability-quality.js:122`, `lib/inventory-mutation.js:456-469`, and 12 further modules |
| F18 | The Gate A runner resets before every suite, fails closed on the disposable-target guard, enforces a strict TAP summary, and exits on the first failure | `scripts/gates/mysql-sales-wave7-gate-a.mjs:31-33`, `:49-60`, `:67-93` |
| F19 | The Gate A runner's manifest assertion in `scripts/mysql-sales-wave7-gate-a-runner.test.js:17-25` asserts the suite list contains **exactly** the three approved files | `scripts/mysql-sales-wave7-gate-a-runner.test.js:17-25` |
| F20 | The suite registry auto-discovers only `*.test.js`; `*.integration.js` is outside FAST/FULL/HEAVY by existing rule | `scripts/testing/test-suites.js:617-618`, `:648-672` |
| F21 | `/api/health/ready` already reports `503 not_ready` when a database statement fails | `server/app.js:2285-2290` |
| F22 | A non-`HttpError` serializes through the existing generic contract: status 500, generic message, and `code` copied verbatim when present | `server/lib/http.js:46-49`, `server/app.js:2272-2276` |

### 37.31.2 Supersession map — exactly what §37.31 replaces in §37.30

This section is the **single authoritative** Transaction Lifecycle Safety design.
Where it differs from §37.30, §37.31 wins. Where it is silent, §37.30 remains in
force. No competing manifest survives.

| §37.30 provision | Disposition in §37.31 |
|---|---|
| §37.30.1 baseline facts | **Superseded** by §37.31.1 (additional facts F1-F22; the §37.30 facts remain true) |
| §37.30.2 the exact defect | **Retained and extended** — F4/F5 add the rollback-failure implicit-commit defect (R2) |
| §37.30.3 ownership states O1-O5 | **Retained**, and R1 adds a session-level admission state machine (§37.31.3) |
| §37.30.4 A-J failure matrix | **Superseded** by §37.31.3-§37.31.5, which extend the matrix with the R2 rollback cases A-E and the R3 release taxonomy |
| §37.30.5 verified release contract | **Retained and extended** by §37.31.5 (session-epoch proof, `SESSION_REPLACED` outcome, one authoritative helper) |
| §37.30.6 quarantine and teardown | **Retained and extended** by §37.31.8 (machine-readable timeout and session-loss classification, `SESSION_FRESH/ACTIVE/UNCERTAIN` states) |
| §37.30.7 Worker timeout and late completion | **Retained**, restated as §37.31.8 under R6 |
| §37.30.8 error precedence and retry compatibility | **Retained and extended** by §37.31.4 (rollback failure is a terminal retry boundary) |
| §37.30.9.1 `server/db.js` changes | **Superseded** by §37.31.10 and §§37.31.3-37.31.5 |
| §37.30.9.3-§37.30.9.5 adapter/worker/protocol changes | **Superseded** by §37.31.8; `mysql-worker-protocol.js` remains **unchanged** |
| §37.30.10 implementation file manifest | **Superseded** by §37.31.10. **In particular, §37.30.10's proposal to register `server/mysql-transaction-start-safety.integration.js` in the HEAVY suite is withdrawn**: HEAVY is executed by the unconditional `pnpm test:heavy`, which R7 forbids for real-MySQL integration tests. The file is registered only through the protected Gate A runner (§37.31.9). |
| §37.30.11 T1-T20 contract | **Superseded** by §37.31.11 and §37.31.12 |
| §37.30.12.2 normal-path correction | **Approved in principle by the user** and now **incorporated** into the single cleanup contract (§37.31.5) — no longer a separate decision |
| §37.30.13 open items O1-O6 | **O1 and O4 are now closed by R4 and R5.** O2 is closed by R1. O3 remains open (§37.31.14). O5 and O6 remain open with unchanged disposition (§37.31.14) |
| §37.30.14 acceptance criteria | **Superseded** by §37.31.11-§37.31.13 |
| §37.30.15 boundary and status | **Superseded** by §37.31.15 |

### 37.31.3 R1 — Transaction admission state machine

#### 37.31.3.1 The two-layer state model

Ownership truth is split into two layers so that neither layer has to prove
server state:

```text
LAYER 1 — SESSION STATE (owned by the MySQL adapter, session-scoped)
  IDLE_TRUSTED    the current session has no open transaction, and every
                  transaction-affecting operation on it received a definitive
                  acknowledgement.
  ACTIVE          a transaction is open on the current session.
  UNCERTAIN       an operation left the transaction presence indeterminate.
  FRESH           a connection was established and no transaction-affecting
                  operation has run on it yet.
  QUARANTINED     the adapter is quarantined; no further SQL is permitted.
  TERMINATED      the Worker thread exited; the adapter is permanently unusable.

LAYER 2 — ATTEMPT OWNERSHIP (owned by server/db.js, attempt-scoped)
  NOT_OWNED       this attempt has no acknowledged transaction of its own.
  OWNED           this attempt received a successful acknowledgement for its
                  own BEGIN.
  ENDED           this attempt's transaction was closed by an acknowledged
                  COMMIT or ROLLBACK.
```

**The session state is a conservative permit, not a probe and not a proof.**
It is derived only from acknowledged Worker responses and from the adapter's own
request-outcome classification. It never asserts what the server is doing; it
only asserts what this adapter has *observed and can account for*. It errs
toward refusal. This honours C1 (no server-variable probe, no local boolean
claimed as independent proof of server state) and C5 (`db.isTransaction` stays
the canonical transaction-state mirror and is **not** displaced).

**R1-6 — a stale `db.isTransaction === false` never overrides an uncertain
session.** The session state transitions on the **request outcome**, not on the
boolean. A request timeout moves the session to `UNCERTAIN` even though
`db.isTransaction` may still read `false`.

#### 37.31.3.2 Session-state transitions

Only the adapter can classify the outcome, because only the adapter observes
the timeout and the Worker response.

| Request outcome | Worker classification | Session-loss | New session state |
|---|---|---|---|
| acknowledged | `BEGIN` | — | `ACTIVE` |
| acknowledged | `COMMIT` | — | `IDLE_TRUSTED` |
| acknowledged | `ROLLBACK` | — | `IDLE_TRUSTED` |
| acknowledged | `OTHER` | — | unchanged |
| definite error (Worker answered) | `BEGIN` | no | unchanged (`IDLE_TRUSTED` stays `IDLE_TRUSTED`: the server rejected the statement, so no transaction was created) |
| definite error | `COMMIT` | no | `ACTIVE` (the COMMIT was rejected, so the transaction is still open) |
| definite error | `ROLLBACK` | no | `ACTIVE` (the ROLLBACK was rejected, so the transaction is still open) |
| definite error | `OTHER` | no | unchanged |
| definite error | any | **yes** | `UNCERTAIN` (the session was abandoned; the old session's state is unrecoverable and its locks are released only when the server reaps it) |
| **request timeout** | — | — | `UNCERTAIN` (the Worker may still be executing the statement; its outcome is indeterminate) |
| quarantine | — | — | `QUARANTINED` (terminal) |

The `BEGIN` / `COMMIT` / `ROLLBACK` classification is the Worker's **existing
canonical** `classifyExecStatement()` (F15). The Worker reports it in its
response; the parent never re-derives it. The parent's current ad-hoc
`normalized === 'START TRANSACTION'` comparison in `exec()` is therefore
**replaced** by the Worker-reported classification, which removes the duplicate
classifier rather than adding one.

#### 37.31.3.3 The admission gate

`transaction()` and `readTransaction()` both apply this gate **before** issuing
BEGIN.

```text
ADMISSION GATE (MySQL only)

  state = adapter.sessionState

  IDLE_TRUSTED | FRESH
      -> ADMIT. The attempt may issue BEGIN.

  ACTIVE
      -> REFUSE. A transaction is open on this session and this attempt did not
         start it. Issuing START TRANSACTION would make MySQL implicitly commit
         that transaction (F4), which is forbidden by R1.
         The attempt must NOT roll it back: it cannot prove it owns it.
      -> QUARANTINE the adapter and start bounded teardown, because the session
         carries an unresolved transaction that must never be reused.

  UNCERTAIN
      -> REFUSE. The session state is indeterminate.
      -> QUARANTINE the adapter and start bounded teardown.

  QUARANTINED
      -> REFUSE. The adapter is already unusable. No second teardown.

  TERMINATED
      -> REFUSE. The Worker is gone. The adapter is permanently unusable.
```

**R1-1 / R1-2 / R1-3 satisfied.** BEGIN is refused on a confirmed
pre-existing transaction and on an uncertain adapter; `START TRANSACTION` is
never issued in a state that may implicitly commit prior work.

**R1-4 — existing nested-operation guards are preserved.** The gate is applied
*inside* `transaction()` and *inside* `readTransaction()`. The ≥15 production
nesting guards (F17) call the business body directly when `db.isTransaction`
is true and therefore never enter the gate at all. Their behaviour, their
messages and their semantics are untouched.

**R1-5 satisfied.** The gate never rolls anything back.

**Detection of a latent nested `transaction()` call.** If any production path
were to call `transaction()` while a transaction is open, the gate now refuses
it loudly instead of letting MySQL implicitly commit the outer transaction. This
is the intended fail-closed outcome and it is a *detector*: the refusal raises
an error, so the existing suites surface it immediately rather than silently
committing partial work. The implementation must also expose an
`admissionRefusalCount` on the adapter so the acceptance suite can assert it
is **zero** across all covered production paths.

**C4 / C12-4 reconciliation.** The gate is a **local state inspection**. It
issues no SQL, takes no lock, adds no round trip and therefore does not
change the `mysql_transaction_gates` serialization point (§37.10) or the
L1-L8 lock graph. The A-RAW raw workers open their own `BEGIN` and never call
`transaction()`, so their bypass semantics and their observable contention are
untouched. §37.10's statement that the global gate serializes every MySQL
transaction before any business row remains true, and this amendment claims no
row-level lock-order proof from any gated path.

**SQLite.** The gate is **MySQL-only**. `node:sqlite`'s `DatabaseSync`
`isTransaction` is authoritative, a nested `BEGIN` is rejected natively with a
clean local error, and SQLite has no session-level named lock and no Worker
session to protect. Adding a SQLite admission gate would change SQLite
behaviour, which `document.md §5.4.1`, `§5.4.2` and §3 of this Design all
require to be preserved. The SQLite path of `transaction()` and
`readTransaction()` therefore keeps its literal `db.exec(...)` statement with
no new wrapper.

#### 37.31.3.4 The exception contract

A refused admission raises a **non-`HttpError`** with a stable machine-readable
code, delivered through the **existing** generic 500 contract (F22):

```text
error.code    = 'MYSQL_TRANSACTION_ADMISSION_REFUSED'
error.message = 'MySQL transaction admission refused: <reason>'   (server-side only)
HTTP status   = 500 (existing generic path)
HTTP body     = { error: '服务器内部错误', code: 'MYSQL_TRANSACTION_ADMISSION_REFUSED',
                   message: '服务器内部错误', requestId }
```

Reasons: `SESSION_TRANSACTION_ACTIVE`, `SESSION_STATE_UNCERTAIN`,
`ADAPTER_QUARANTINED`, `ADAPTER_TERMINATED`.

This is deliberately **not** a business `409` and **not** a retryable `503`:
the condition is an infrastructure fault, it is not a business rule, and no
retry is permitted. It introduces a new stable **code value** inside the
existing generic-error contract — no new status, no new body shape, no new
fields. See §37.31.14 for the approval item.

### 37.31.4 R2 — Rollback failure is a terminal retry boundary

#### 37.31.4.1 The defect this closes

Today the catch path is `try { if (db.isTransaction) db.exec('ROLLBACK'); } catch {}`
(`server/db.js:1901`). The rollback failure is swallowed, the retry predicate
is evaluated against the **business** error, and on a retryable business error
the loop issues a fresh BEGIN (`server/db.js:1887`, `:1910`). MySQL commits an
open transaction when `START TRANSACTION` is issued inside one (F4). The failed
attempt's partial writes can therefore become durable — directly violating the
already-approved §37.20 atomicity guarantee (F5) and §37.28's "retry exhaustion
leaves zero new Gate Result, audit or idempotency success facts".

#### 37.31.4.2 The rollback settlement gate

The rollback is no longer a best-effort side effect. It becomes a **gate** that
every retry must pass.

| Case | Rollback outcome | Session state after | Further BEGIN permitted? | Adapter | Primary error |
|---|---|---|---|---|---|
| **A** | acknowledged | `IDLE_TRUSTED` | **Yes**, if and only if the business error is retryable and the attempt budget allows | reusable | business error |
| **B** | definite database error | `ACTIVE` | **No** | **quarantine + bounded teardown** | business error |
| **C** | request timeout | `UNCERTAIN` | **No** | **quarantine + bounded teardown** | business error |
| **D** | connection disappeared during the rollback | `UNCERTAIN` | **No** | **quarantine + bounded teardown** | business error |
| **E** | Worker reports an indeterminate transaction state | `UNCERTAIN` | **No** | **quarantine + bounded teardown** | business error |

Rules:

- **R2-1.** An eligible transaction retry is allowed **only** after an
  acknowledged rollback (case A) **and** a safe session state.
- **R2-2.** A failed or uncertain rollback (cases B-E) prohibits **any**
  subsequent BEGIN. The retry predicate is evaluated **after** the rollback
  gate; a `true` retry predicate cannot override a `false` rollback gate.
- **R2-3.** No silent retry follows an uncertain rollback. The retry loop exits
  immediately and the original error propagates.
- **R2-4.** Cases B-E quarantine the adapter immediately and start the bounded
  teardown (§37.31.8).
- **R2-5.** The primary business/transaction exception is always the propagated
  error. The rollback cleanup failure is recorded **separately** as a
  non-primary diagnostic and a structured log event. The primary error's
  `message`, `code`, `errno`, `sqlState` and stack are untouched.
- **R2-6.** Rollback success is never reported without proof. The proof is the
  acknowledged `ROLLBACK` response plus the resulting `IDLE_TRUSTED` session
  state.
- **R2-7.** Case D (session disappeared) is classified `UNCERTAIN` rather than
  "rolled back". The server ends the session and rolls back with it, but the
  application has no acknowledgement, and R2-1 demands a *confirmed* rollback.
  The classification is therefore uniform and fail-closed. The consequence is
  that a transport failure during a rollback retires the adapter instead of
  silently retrying on a fresh session.

**Effect on the existing retry contract.** The retryable set
(`ER_LOCK_DEADLOCK` / `ER_LOCK_WAIT_TIMEOUT` / errno 1213 / 1205 / sqlState
40001), `ERP_DB_TX_RETRY_MAX`, the backoff, `transactionRetryExhausted` and
`transactionAttempts` are all **unchanged**. The only change is that a retry now
requires a proven-safe connection state in addition to a retryable business
error. Case A is the ordinary path and is byte-for-byte the current behaviour.

**Explicit START TRANSACTION implicit-commit address.** The implicit-commit
risk is closed at three points: (i) the admission gate refuses BEGIN when a
transaction is already open; (ii) the rollback settlement gate forbids BEGIN
after a failed or uncertain rollback; (iii) the adapter's session state
distinguishes `ACTIVE` from `IDLE_TRUSTED`, so a swallowed rollback failure
can no longer be mistaken for a clean connection.

### 37.31.5 R3 — The one authoritative cleanup contract

#### 37.31.5.1 Two layers, one implementation

```text
LAYER 1 — TRANSACTION SETTLEMENT GATE (§37.31.4)
  Proves that the connection may safely start another transaction, or retires it.

LAYER 2 — NAMED-LOCK RELEASE VERIFICATION (§37.31.5.2)
  Proves that each registered MySQL named idempotency lock is no longer owned
  by a session this adapter will reuse.
```

Both layers are implemented **once** in `server/db.js` and are reached from
every context that needs them. There is exactly one implementation of the
release-verification truth; `server/modules/financial-controls.js` calls it
rather than re-implementing it (§37.31.6).

#### 37.31.5.2 Release outcome taxonomy

| Release outcome | Meaning | Session epoch | Classification | Adapter |
|---|---|---|---|---|
| `RELEASE_LOCK` returned `1` | this session held the lock and released it | unchanged | **`VERIFIED_RELEASED`** | reusable |
| `RELEASE_LOCK` returned `0` | the lock exists but is held by another session | unchanged | **`NOT_VERIFIED`** | **quarantine + teardown** |
| `RELEASE_LOCK` returned `NULL` | the named lock does not exist | unchanged | **`NOT_VERIFIED`** | **quarantine + teardown** |
| `RELEASE_LOCK` raised a driver exception (not a session loss) | release status unknown | unchanged | **`NOT_VERIFIED`** | **quarantine + teardown** |
| `RELEASE_LOCK` timed out | release status unknown | unchanged | **`NOT_VERIFIED`** | **quarantine + teardown** |
| the release statement reported a **session loss** | the original session was abandoned; the server reclaims its locks when it reaps the session | changed | **`SESSION_REPLACED`** | reusable (a new session carries no lock) |

**Why only `1` verifies.** `RELEASE_LOCK` returns `1` only when the *executing*
session owned the lock. Because only one session can own a MySQL named lock,
a `1` proves that the executing session **is** the original owner — which is
exactly the "belongs to the current trusted original MySQL session"
requirement, established without any server-variable probe (C1). `0` and
`NULL` prove only that the *current* session does not own the lock; they cannot
distinguish "our lock was released elsewhere" from "we are now talking to a
different session". Those are treated as unverified, as `document.md §5.4.1`
requires.

**Session-epoch proof (R4 bullet 3).** The adapter tracks a monotonic
`sessionEpoch`, incremented by the Worker on every new MySQL connection and
reported in every response. The release helper records the epoch at
acquisition and compares it at release time. If the epoch changed, the original
session no longer exists and the result of a release attempt against the
current session describes the **wrong** session — the helper therefore never
treats a `0`/`NULL` observed on a replacement session as evidence about the
original. This is the concrete mechanism that prevents "reconnect and treat a
new session as the original owner".

#### 37.31.5.3 The helper contract

```text
releaseMySqlIdempotencyLocks(db, { lockNames = null, mode = 'VERIFY' }) -> {
  attempted:   number,
  verified:    string[],     // lock names confirmed released
  unverified:  [{ outcome, code }],   // outcomes only; no lock names, no SQL
  sessionReplaced: boolean,
  quarantined: boolean,
}
```

- A lock is removed from `db._idempotencyLocks` **only** when its outcome is
  `VERIFIED_RELEASED`, or when the outcome is `SESSION_REPLACED` (in which case
  the removal is recorded together with the proof that the owning session is
  gone).
- Unverified locks **stay registered**. The local ownership-tracking state is
  never erased while the release status is unknown.
- The helper performs the quarantine itself, so every caller gets identical
  behaviour by construction and no caller can diverge.
- Diagnostics contain the lock **count** and per-lock `outcome` / `code` only.
  Full lock names, SQL text, bind parameters, the idempotency key and
  credentials are never recorded.
- `mode = 'SESSION_DESTROYED'` performs no SQL at all and is used when the
  session is already provably gone.

#### 37.31.5.4 The four cleanup contexts

| Context | Settlement gate | Release layer | Result |
|---|---|---|---|
| 1. Transaction-start failure | n/a (no transaction was started) | `VERIFY` on a live session; `SESSION_DESTROYED` when the session is provably lost; **no SQL at all** when the outcome is uncertain | verified release → reusable; otherwise quarantine + teardown |
| 2. Successful COMMIT | the transaction is closed by an acknowledged COMMIT | `VERIFY` | verified → reusable; otherwise quarantine + teardown, **committed success still returned** (§37.31.5.5) |
| 3. Final transaction failure after ROLLBACK | the rollback gate has passed or failed | `VERIFY` | verified → reusable; otherwise quarantine + teardown |
| 4. Recovery before a permitted inner transaction retry | **the rollback settlement gate only** | **no release** — the registered named locks are deliberately retained across an inner retry, because they protect the idempotency scope for the whole operation | the retry proceeds only if the gate passed |

Context 4 is the reason the contract has two layers: a retry needs a safe
connection, but it must **not** drop the operation's named lock mid-flight.

#### 37.31.5.5 Successful COMMIT followed by a failed release

This is the case where the business outcome and the infrastructure outcome
diverge, and it is specified explicitly.

```text
BUSINESS OUTCOME
  The transaction is DURABLY COMMITTED. The mutation, the voucher, the
  movement, the refund row, the audit row and the idempotency record are all
  committed atomically. That fact is final and is never undone, re-run or
  re-stated as failed.

HTTP OUTCOME
  The existing success contract is returned unchanged (201 for a first
  confirmation, 200 with replayed:true for an exact replay). No new status, no
  new body field, no new error contract is introduced. This is required by
  document.md §5.4.2 R3 and by the "no new public error contract" constraint.

WHY NOT AN INFRASTRUCTURE ERROR
  Reporting a failure for a durable commit is a lie about durable state, and it
  invites a client retry of an already-applied mutation. The idempotency key
  makes such a retry a replay rather than a duplicate, but the truthful answer
  is still: the operation succeeded.

HOW COMMITTED IDEMPOTENCY FACTS REMAIN AUTHORITATIVE
  The idempotency record was written inside the committed transaction. It is
  durable. A later exact replay reads it and returns the stored result with
  HTTP 200 and replayed:true, exactly as today. Nothing in the cleanup path
  writes to or invalidates it.

WHY THE COMMITTED ACTION IS NEVER AUTOMATICALLY RE-RUN
  This amendment introduces no retry of a committed mutation anywhere. The
  inner retry is gated on a rollback settlement (§37.31.4); after a COMMIT
  there is no rollback and no retry. The named-lock release failure is handled
  by retiring the connection, not by re-running the operation.

HOW THE CONNECTION IS RETIRED SAFELY
  The adapter is quarantined synchronously, the Worker termination is started,
  and the session is destroyed by the server when the socket closes. The
  release of the named lock is delivered by that session teardown, not by a
  release statement.

HOW THE CALLER LEARNS ABOUT THE CLEANUP UNCERTAINTY
  Without any new public contract:
    1. A structured server log event (mysql_session_quarantined) records the
       reason, the outcome taxonomy and the counts.
    2. The adapter exposes quarantineState with the PENDING / CONFIRMED /
       FAILED teardown status, observable in-process and by the integration
       test.
    3. The EXISTING readiness contract already surfaces it: /api/health/ready
       executes a database statement, which fails on a quarantined adapter, so
       the endpoint returns its existing 503 not_ready body (F21).
  No new endpoint, header, status or body field is introduced.
```

### 37.31.6 R4 — Finance idempotency replay cleanup

#### 37.31.6.1 Scope

Only the release handling associated with `idempotencyReplay()` in
`server/modules/financial-controls.js` is in scope. No Finance monetary
calculation, no canonical Parent lock logic
(`server/modules/sales-prepayment-finance-adapter.js` is **not** modified), no
fingerprint algorithm, no scope string and no canonical write order is touched.
C9's ordering is preserved exactly.

#### 37.31.6.2 The replay-path matrix

| Path | Current behaviour | Required behaviour |
|---|---|---|
| Replay **hit** (`row` found, fingerprint matches) | `RELEASE_LOCK` executed, result ignored, registry entry deleted in a `finally` | `releaseMySqlIdempotencyLocks(db, { lockNames: [lockName] })`. Verified → registry entry removed, adapter reusable. Unverified → adapter quarantined, **the 200 replay is still returned**. |
| Replay **miss** (`!row`) | returns `null`, lock deliberately retained for `transaction()` | **Unchanged.** The lock is retained; `transaction()` owns its release. |
| **Fingerprint conflict** | lock released at the hit path, then `HttpError(409)` thrown | Same verified release as the hit path; the **409 remains the primary error** and its status, code and message are unchanged. A cleanup failure never rewrites the 409. |
| **Idempotency lookup exception** | `RELEASE_LOCK` executed, result ignored, original error rethrown | Same verified release; the **original lookup exception** is rethrown unchanged. A cleanup failure is recorded separately. |
| `RELEASE_LOCK` = `1` | ignored | `VERIFIED_RELEASED`; registry entry removed; adapter reusable |
| `RELEASE_LOCK` = `0` | ignored | `NOT_VERIFIED` → quarantine + bounded teardown; registry entry retained |
| `RELEASE_LOCK` = `NULL` | ignored | `NOT_VERIFIED` → quarantine + bounded teardown; registry entry retained |
| `RELEASE_LOCK` throws / times out | ignored | `NOT_VERIFIED` → quarantine + bounded teardown; registry entry retained |

#### 37.31.6.3 No duplicated ownership truth

`idempotencyReplay()` calls the **single** helper exported from
`server/db.js` — the same helper `transaction()` uses — with an explicit
`lockNames` list. The helper performs the quarantine itself. Finance therefore
cannot diverge from the transaction path on what "verified" means, and Finance
never learns the session-epoch or teardown rules. `financial-controls.js`
gains **no** new state machine, only a call.

#### 37.31.6.4 Preservation

| Contract | Status |
|---|---|
| Exact replay → HTTP 200 with `replayed: true` and the original id | preserved |
| First successful refund → HTTP 201 | preserved |
| Fingerprint conflict → HTTP 409 | preserved |
| Canonical idempotency scope `REFUND_CONFIRM` / `${side}:${balance.id}` | preserved |
| Fingerprint algorithm | preserved |
| No duplicate Voucher / Refund / Movement / Audit / Idempotency facts | preserved; the release path writes nothing |
| No pre-authority monetary mutation | preserved; the release path runs before any monetary write, as today |
| No new replay of uncertain transactions | preserved; the helper never re-runs an operation |

### 37.31.7 R5 — readTransaction() startup safety

#### 37.31.7.1 Why readTransaction() needs a narrower entry point

`readTransaction()` registers no named lock and must not gain any. It needs
the **admission gate** and the **startup-failure settlement**, but not the
named-lock release layer. Two narrow, purpose-built entry points are therefore
defined rather than one wide helper:

```text
assertMySqlTransactionAdmission(db)         -> void (throws MYSQL_TRANSACTION_ADMISSION_REFUSED)
settleFailedTransactionStart(db, error)      -> result   (no named-lock release)
releaseMySqlIdempotencyLocks(db, options)   -> result   (§37.31.5.3)
```

`settleFailedTransactionStart()` performs **no** named-lock release: any lock
already registered belongs to an enclosing operation and must not be released
by a read helper. If a read-transaction startup failure leaves the session
uncertain, the adapter is quarantined, and the enclosing operation's later
`transaction()` then fails at the admission gate — which is the correct
fail-closed outcome.

#### 37.31.7.2 The read-transaction safety boundary

| Requirement | Contract |
|---|---|
| Known pre-BEGIN ownership | The same admission gate (§37.31.3.3). A read transaction may not start while a transaction is open. |
| Safe startup-failure handling | `db.exec('BEGIN')` is wrapped in the startup boundary. On failure: no COMMIT, no ROLLBACK of anything (this attempt owns nothing), and the session is settled per §37.31.3.2. |
| No rollback of a foreign transaction | The startup-failure path never issues ROLLBACK at all. |
| Quarantine when the session outcome is unknown | A definite server-side rejection leaves the session `IDLE_TRUSTED` and reusable. A timeout or a session loss leaves it `UNCERTAIN` → quarantine + bounded teardown. |
| No further reads through a quarantined adapter | The quarantine blocks every subsequent request, including reads. |
| L0 shared-lock behaviour preserved | `SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 LOCK IN SHARE MODE` is unchanged and still taken inside the read transaction. |
| READ COMMITTED assumptions preserved | No isolation configuration is touched; `SESSION_ISOLATION_LEVEL = 'READ COMMITTED'` is unchanged. |
| `readTransaction()` return semantics preserved | The work's return value is returned unchanged; `COMMIT` still precedes the response. |
| SQLite preserved | The SQLite path keeps its literal `db.exec('BEGIN')`. |
| No new nested transaction support | The gate refuses a nested read transaction; it does not enable one. |

**Read isolation is not redesigned.** The only change is that the BEGIN sits
inside a startup boundary and is preceded by the admission gate.

### 37.31.8 R6 — Adapter / Worker quarantine and teardown contract

`server/database/mysql-worker-protocol.js` is **not** modified. No unavoidable
contract gap exists: the generation-scoped late-response discard (F12) already
prevents an abandoned request from publishing trusted state, and the residual
Worker's non-generation-scoped `inTransaction` flag (F13) is neutralised by
terminating the Worker on the timeout path. The O3 residual is recorded in
§37.31.14.

#### 37.31.8.1 `server/database/mysql-worker.js` — the response contract

The Worker is the authoritative owner of the connection, so it is the
authoritative source of the classification signals. Three additions to the
response payload:

| Addition | Value | Why |
|---|---|---|
| `classification` | `'BEGIN' \| 'COMMIT' \| 'ROLLBACK' \| 'OTHER'` | The existing canonical `classifyExecStatement()` (F15) becomes the single classifier for both processes. It is reported on **both** the success payload and the error payload for an `exec` action, so the parent can classify a failure. |
| `sessionLost` | `true` when the Worker discarded the session | The canonical recoverable-connection decision (F14) is communicated rather than re-derived. C1 forbids a second classifier. |
| `sessionEpoch` | monotonic counter, incremented on every new connection | Proves session identity for the release verification (§37.31.5.2). It is a **local** counter incremented by the Worker that owns the connection — no server-variable probe (C1). |

`serializableError()` is extended to carry `classification` and `sessionLost`.
No SQL text, parameter, credential or stack is added.

#### 37.31.8.2 `server/database/mysql-adapter.js` — the minimum technical changes

| Addition | Responsibility |
|---|---|
| `sessionState` | The Layer-1 session state of §37.31.3.1. **Additive**: `db.isTransaction` remains the canonical mirror (C5) and is not replaced. |
| `sessionEpoch` | The last epoch observed in a Worker response. |
| `quarantine(reason)` | Synchronous: marks the adapter unusable, starts `worker.terminate()`, records `quarantineState`. Never performs a blocking Worker round-trip. |
| `quarantineState` | `{ reason, at, state: 'TERMINATION_PENDING' \| 'TERMINATION_CONFIRMED' \| 'TERMINATION_FAILED', termination: Promise }`. |
| Timeout marker | The timeout error carries a machine-readable marker so the caller classifies "the Worker may still be executing" without matching an English message. The marker is **not** the error's `code`, so the HTTP contract is unchanged. |
| Unusable-adapter rejection | Every request on a quarantined adapter is rejected with the stable code `MYSQL_SESSION_QUARANTINED`. |
| `exec()` state application | Applies the §37.31.3.2 transitions using the Worker-reported classification. The parent's ad-hoc `normalized === ...` comparison is **removed**, so there is exactly one classifier. |
| `admissionRefusalCount` | A counter of refused admissions, asserted to be zero by the acceptance suite. |
| `close()` | **Unchanged.** `quarantine()` sets the same unusable flag `close()` already tests, so a quarantined adapter never attempts the blocking `'close'` round-trip, and the Worker is already terminated. |

#### 37.31.8.3 The ten R6 behaviours

1. **Machine-readable request-timeout classification.** The timeout error
   carries a dedicated marker. It is distinct from a definite Worker error and
   from a session loss.
2. **Machine-readable recoverable session-loss classification.** The Worker
   reports `sessionLost` on the error it sends after discarding the session.
3. **Immediate synchronous quarantine state.** `quarantine()` marks the adapter
   unusable before it returns, so no application operation can interleave.
4. **Guaranteed rejection of further SQL.** Every subsequent request on the
   adapter throws `MYSQL_SESSION_QUARANTINED`; the Worker receives no further
   message, so `ensureConnection()` is never reached and no reconnect occurs.
5. **Suppression of unsafe reconnect/retry paths.** The quarantine blocks the
   Worker's lazy reconnect. The `readOnly`-retry path in the Worker's `query`
   handler (which replays a read once after a recoverable error) is not
   reachable after a quarantine because no request is dispatched. The adapter's
   `exec()` path never auto-retries.
6. **Bounded Worker teardown initiation.** `worker.terminate()` is initiated
   synchronously and does not wait on a Worker round-trip.
7. **PENDING / CONFIRMED / FAILED teardown status.** `worker.terminate()`
   resolves with the exit code; the adapter records
   `TERMINATION_CONFIRMED`. A rejection records `TERMINATION_FAILED`. While
   pending, `quarantineState.state === 'TERMINATION_PENDING'`.
8. **Late Worker results.** A late `exec` completion for an abandoned
   generation is discarded by the protocol's CAS (F12). The Worker's internal
   `inTransaction` flag is set before that CAS (F13), but the Worker is being
   terminated, so it can neither be observed by a later request nor act on the
   session. The design does **not** assume that discarding a response cancels
   the underlying MySQL statement — the statement may still complete on a
   session that is about to be destroyed, which is exactly why the session is
   destroyed rather than reused.
9. **When termination does not prove server-side session destruction.** The
   adapter reports the truth: `TERMINATION_CONFIRMED` proves the Worker thread
   exited and its socket was closed; it does **not** prove the server has
   already reaped the session and released the named lock. The safety
   invariant is stated over **reusable** connections, so an abandoned session
   that the server has not yet reaped does not violate it. The design never
   describes quarantine or termination as proof of server-side lock release.
10. **Safe non-sensitive diagnostics.** Structured log events carry the
    reason, the outcome taxonomy, the lock count and the teardown state. They
    never carry SQL text, bind parameters, credentials, the idempotency key or
    the full lock names.

**No uncertain operation is silently converted into a retried write.** An
uncertain COMMIT (timeout) yields `UNCERTAIN` → quarantine; the business
result is *not* re-executed, and the caller receives the original error.

### 37.31.9 R7 — Protected real-MySQL test registration

#### 37.31.9.1 The conflict this resolves

§37.30.10 proposed registering `server/mysql-transaction-start-safety.integration.js`
in the **HEAVY** suite. HEAVY is executed by `pnpm test:heavy` =
`node scripts/testing/run-tests.js heavy`, an **unconditional** command
(F20). `document.md §5.4.2` R7 forbids exactly that for a real-MySQL
integration test. **That proposal is withdrawn.** This section is the only
authoritative registration plan; §37.30.10's HEAVY entry must not be
implemented.

#### 37.31.9.2 The two registrations

```text
PURE / FAKE-DATABASE
  server/db-transaction-start-safety.test.js
    -> scripts/testing/test-suites.js  FAST  and  FULL
    -> no real MySQL, no temp SQLite, no HTTP boot -> FAST-eligible
    -> follows the existing pure-suite precedent
       (server/sales-gate-retry-admission.test.js)

REAL MySQL
  server/mysql-transaction-start-safety.integration.js
    -> scripts/gates/mysql-sales-wave7-gate-a.mjs   as suite label 'A-TXLIFE'
    -> NOT registered in FAST, FULL or HEAVY
    -> NOT reachable from `pnpm test:heavy`
    -> .integration.js is outside the ordinary classification manifest by
       existing rule (F20), so no bookkeeping entry is added
```

#### 37.31.9.3 The Gate A runner changes

`scripts/gates/mysql-sales-wave7-gate-a.mjs` gains exactly one suite entry and
nothing else changes:

```text
suites = [
  { label: 'A-PARITY', file: 'server/mysql-sales-customer-wave7.integration.js' },
  { label: 'A-PROD',  file: 'server/mysql-sales-customer-wave7-concurrency.integration.js' },
  { label: 'A-RAW',   file: 'server/mysql-sales-customer-wave7-raw-locks.integration.js' },
  { label: 'A-TXLIFE', file: 'server/mysql-transaction-start-safety.integration.js' },
]
```

The three approved suites' entries, their business coverage, their order and
their reset behaviour are **unchanged**.

| Requirement | How the existing runner already satisfies it | Change needed |
|---|---|---|
| Exact disposable-target guard | `assertAuthorizedDisposableMySqlTarget(resetConfig)` runs before any connection is opened (`:31-33`) | none |
| Explicit authorization | The guard requires all three flags; a pre-existing environment flag is not authorization (C6) | none |
| Accurate suite naming | Each suite carries a distinct label | new label `A-TXLIFE` |
| Strict TAP PASS/FAIL enforcement | `parseTapSummary` + `assertTapSummaryStrict` per suite (`:86-87`) | none |
| Failure propagation | Non-zero exit aborts the campaign immediately; no later suite runs (`:82-85`) | none |
| Authorized reset / cleanup | `resetMySql(label)` runs before each suite and asserts zero remaining tables (`:49-60`) | none |
| No automatic rerun | The runner executes each suite exactly once and exits on the first failure | none |
| Gate B `BLOCKED_BY_WAVE10` preservation | The M1-M25 status board is untouched (`:95-102`) | none |

#### 37.31.9.4 Execution order

**`A-TXLIFE` runs LAST**, after A-PARITY, A-PROD and A-RAW.

Rationale: the runner is fail-fast. If `A-TXLIFE` ran first and failed, the
three approved business-coverage suites would never run and their evidence
would be lost. Running the new safety suite last means the approved coverage
evidence is produced first and is never contingent on the new suite, while the
new suite still runs against a freshly reset target (the runner resets before
every suite). The new suite is independent of the other three's state.

#### 37.31.9.5 The fail-closed module-load contract (C6)

`server/mysql-transaction-start-safety.integration.js` must **throw at module
load** — producing a non-zero exit with an UNAVAILABLE diagnostic — when the
MySQL environment is incomplete or the disposable-target guard is not armed.
It must never skip to a PASS. It must assert `db.dialect === 'mysql'` in its
setup, exactly like the established Wave 7 and Wave 9 protected-suite pattern.

#### 37.31.9.6 The bounded runner-contract test change

`scripts/mysql-sales-wave7-gate-a-runner.test.js:17-25` currently asserts the
manifest contains **exactly** the three approved files (F19). Adding
`A-TXLIFE` would fail that assertion. The test must be updated — narrowly:

- the assertion keeps requiring that A-PARITY, A-PROD and A-RAW are present
  with their **exact existing file paths**, in that relative order;
- it additionally requires the exact `A-TXLIFE` entry with its exact file
  path, and requires it to be **last**;
- it continues to assert that the runner does not reference the legacy
  `mysql-gate.mjs` / `mysql-concurrency-gate.mjs`;
- it continues to assert the guard-before-reset-before-connection ordering and
  the strict TAP assertion;
- it continues to assert the `BLOCKED_BY_WAVE10` entries.

This is a **registration-contract** change only. It changes no business
coverage and no suite behaviour.

#### 37.31.9.7 A pre-existing runner weakness, recorded not fixed

The Gate A runner's M1-M25 status board (`:95-102`) is a **static array**: it
prints `PASS` for every listed case regardless of the actual suite results.
That is a pre-existing property of the approved runner and is **not** changed
by this amendment, because changing it would alter the approved Gate A
evidence contract. It is recorded as an open item in §37.31.14.

### 37.31.10 Final implementation manifest

**ONE** authoritative production manifest. No competing manifest survives
(§37.31.2).

**Production files (4):**

| # | File | Change | Requirement |
|---|---|---|---|
| P1 | `server/db.js` | Admission gate; rollback settlement gate; the one authoritative release-verification helper; quarantine invocation; restructuring of `transaction()` and `readTransaction()`; export of the helper for Finance | R1, R2, R3, R5 |
| P2 | `server/database/mysql-adapter.js` | `sessionState`, `sessionEpoch`, `quarantine()`, `quarantineState`, timeout marker, unusable-adapter rejection, `exec()` state application, `admissionRefusalCount` | R6 |
| P3 | `server/database/mysql-worker.js` | Response contract: `classification`, `sessionLost`, `sessionEpoch` | R6 |
| P4 | `server/modules/financial-controls.js` | **Only** the `idempotencyReplay()` release handling, routed through the shared helper | R4 |

**Unchanged by explicit decision:**

- `server/database/mysql-worker-protocol.js` — no unavoidable contract gap is
  proven (F12). Recorded as an open residual in §37.31.14.
- `server/modules/sales-prepayment-finance-adapter.js` — no Finance monetary
  or Parent-lock change (R4 scope limit).
- `server/app.js`, `server/lib/http.js`, `server/lib/audit.js` — no public
  contract change.
- No schema, no migration, no permission, no package-version change.

**Test, fixture and runner files (6):**

| # | File | Kind | Registration |
|---|---|---|---|
| T1 | `server/db-transaction-start-safety.test.js` | new, pure fault injection | `scripts/testing/test-suites.js` → **FAST** and **FULL** |
| T2 | `server/mysql-transaction-start-safety.integration.js` | new, real MySQL | `scripts/gates/mysql-sales-wave7-gate-a.mjs` → `A-TXLIFE` only. **Not** in FAST/FULL/HEAVY |
| T3 | `server/database/test-fixtures/delayed-exec-mysql-worker.js` | new Worker fixture (not a `*.test.js`, so no registry entry) | used by T1 |
| T4 | `scripts/testing/test-suites.js` | modified — registry only | registers T1 |
| T5 | `scripts/gates/mysql-sales-wave7-gate-a.mjs` | modified — one suite entry | registers T2 |
| T6 | `scripts/mysql-sales-wave7-gate-a-runner.test.js` | modified — manifest assertion only | already in FAST + FULL |

**Existing files that are regression-protected and NOT modified:**
`server/v13-phase6a-financial-controls.test.js` (the M24 durable-state
coverage for replay 200 / conflict 409 / zero duplicate effects),
`server/sales-customer-wave7-functional.test.js`,
`server/sales-customer-wave7-acceptance.test.js`,
`server/sales-customer-wave8-*.test.js`,
`server/mysql-adapter-timeout.test.js`,
`server/mysql-disposable-target-guard.test.js`, and the A-PARITY / A-PROD /
A-RAW fixtures.

**Conditional documentation follow-up (not a code file, requires separate
authorization):** `README.md:344` currently describes `server/db.js` as
"SQLite 基础 schema、seed、transaction 和数据库创建". After P1, `server/db.js`
also owns the MySQL transaction admission gate and the named-lock release
verification. A one-line owner correction would keep the 仓库地图 accurate.
`README.md` must **not** gain a suite list or a test count (C10), and no new
`pnpm` script is introduced, so no 常用命令 row is needed.

**No additional production files are required.** The design deliberately avoids
a new shared module: the Worker already owns the canonical exec classifier and
the canonical recoverable-connection classifier, and the release-verification
truth lives in `server/db.js` where the transaction lifecycle already lives.
Adding a new module file would also require a README owner entry (C11) and
would create a second place where transaction-state truth could diverge.

### 37.31.11 Acceptance contract — pure fault injection (T1)

T1 is registered in **FAST** and **FULL** and uses only fake databases and the
controllable Worker fixture T3. It proves **logic and control flow**. It does
**not** prove InnoDB behaviour, server-side lock release or real contention.

| # | Case | Assertion | Mechanism |
|---|---|---|---|
| A1 | Normal BEGIN | `BEGIN` is issued; the L0 gate follows; the work runs; `COMMIT` follows | fake MySQL db |
| A2 | Foreign / pre-existing transaction admission refusal | with session state `ACTIVE`, **no** `BEGIN` is issued, the adapter is quarantined, and the raised error carries `MYSQL_TRANSACTION_ADMISSION_REFUSED` | fake db + adapter state |
| A3 | BEGIN known failure | the original BEGIN error propagates unchanged; no COMMIT and no ROLLBACK are issued | fake db throwing on BEGIN |
| A4 | BEGIN timeout | the timeout error propagates unchanged; **no SQL is issued on the adapter after the timeout**; the adapter is quarantined | controllable Worker |
| A5 | Owned `GET_LOCK` at startup failure | the registered lock is released and confirmed, or the adapter is quarantined with the registry entry retained | fake db with a seeded registry |
| A6 | Verified release result `1` | outcome `VERIFIED_RELEASED`; the registry entry is removed; the adapter is **not** quarantined | fake db answering `released: 1` |
| A7 | Unverified release `0` / `NULL` | outcome `NOT_VERIFIED`; the adapter is quarantined; the registry entry is retained | fake db answering `0` and `null` |
| A8 | `RELEASE_LOCK` exception | outcome `NOT_VERIFIED`; quarantine; registry retained | fake db throwing |
| A9 | Normal COMMIT and verified release | the emitted sequence is `BEGIN` → L0 gate → work → `COMMIT` → verified release; the result is returned | fake db |
| A10 | COMMIT success followed by cleanup failure | the **committed success is returned** (201 / 200 shape preserved); the adapter is quarantined; no retry of the operation occurs | fake db |
| A11 | Normal rollback and valid retry | a retryable business error triggers exactly one ROLLBACK; on an acknowledged rollback the retry proceeds and BEGIN is issued again; the attempt budget is respected | fake db |
| A12 | Rollback failure with **zero** further BEGIN attempts | the rollback fails; **no further `BEGIN` is issued**; the adapter is quarantined; the primary business error propagates unchanged; `transactionRetryExhausted` is **not** set | fake db |
| A13 | Read-transaction startup failure | `readTransaction()`'s BEGIN failure propagates unchanged; no ROLLBACK of a foreign transaction; the adapter is quarantined when the outcome is unknown; no named lock is released by the read path | fake db |
| A14 | Replay hit / lookup exception / fingerprint conflict | the shared helper is used; verified → the registry entry is removed; unverified → quarantine; the 200 / original exception / 409 are each preserved unchanged | fake db + `idempotencyReplay` |
| A15 | Worker late completion | the late completion is discarded; the adapter's `isTransaction` is not flipped by the abandoned generation | controllable Worker |
| A16 | Quarantined adapter rejects SQL | every subsequent request throws `MYSQL_SESSION_QUARANTINED`; no SQL reaches the Worker | controllable Worker |
| A17 | Bounded teardown states | `TERMINATION_PENDING` → `TERMINATION_CONFIRMED` (or `FAILED`), and the termination promise resolves | controllable Worker |
| A18 | No unintended reconnect | after a quarantine the Worker receives no further message and the adapter never reconnects | controllable Worker |
| A19 | Stable original error identity | the propagated error is the **same object instance** as the injected failure, for BEGIN failure, rollback failure, and the replay paths | fake db |
| A20 | Session-epoch proof | a release attempted after the session epoch changed is classified `SESSION_REPLACED`, never `VERIFIED_RELEASED` | fake db with a forced epoch change |
| A21 | Admission-refusal counter | `admissionRefusalCount === 0` across every covered production path | all existing suites |
| A22 | Unchanged L0 and L1-L8 order | the L0 gate statement and its position are unchanged; the lock graph is unchanged | static source assertion |
| A23 | Unchanged SQLite semantics | the SQLite path issues no release, no quarantine and no ROLLBACK on a BEGIN failure, and propagates the raw error | fake SQLite db |
| A24 | A-E / F1 / F2 / M24 / M25 regression | the existing Wave 7 functional, acceptance, Finance and M24/M25 suites stay green | existing suites, unchanged |

### 37.31.12 Acceptance contract — protected real MySQL (A-TXLIFE)

T2 runs **only** through the protected Gate A runner, under a fresh explicit
exact-target authorization. It proves **real-session** behaviour that pure
fault injection cannot. It is not reachable from `pnpm test:heavy`.

| # | Case | Assertion | Evidence class |
|---|---|---|---|
| M1 | A real named lock is acquired and verified released | `GET_LOCK` returns `1`; after the cleanup, an independent session observes `IS_FREE_LOCK` / `IS_USED_LOCK` showing the lock is no longer held | real InnoDB / server lock state |
| M2 | Session destruction releases the server-side lock | after a quarantine and a confirmed termination, an independent session observes the lock released and the abandoned session gone from `information_schema.PROCESSLIST` | real server state (C7) |
| M3 | A quarantined adapter rejects further SQL | a business statement on the quarantined adapter fails and no new session appears in `PROCESSLIST` | real session list |
| M4 | No leaked Worker connection | the suite ends with a `PROCESSLIST` proof that no adapter connection remains | real session list (C7) |
| M5 | Rollback failure under real contention | a real lock-wait contention that fails the rollback leaves no further transaction attempt and no open transaction on the reused session | real InnoDB |
| M6 | The L0 gate and L1-L8 order are unchanged under real MySQL | the existing A-PARITY / A-PROD / A-RAW fixtures are unchanged and still pass; the new suite does not alter the gate behaviour | real InnoDB |
| M7 | No duplicate monetary facts after the cleanup paths | the refund / voucher / movement / audit / idempotency counts are unchanged by every failure path | real durable state |
| M8 | Exact replay `200` and fingerprint conflict `409` against real MySQL | the real HTTP entry returns `200` with `replayed:true` for an exact replay and `409` for a conflicting fingerprint | real HTTP + real MySQL |

**Every real-MySQL test requires a fresh explicit exact-target authorization.**
No real-MySQL execution is authorized by this Design.

**Evidence stratification.** Pure fault-injection results (T1) and real
InnoDB results (A-TXLIFE) must be reported separately and never merged, in
the same discipline as §37.10's layers A-H. A pure result never proves a
server-side fact, and a real result never substitutes for the pure control-flow
coverage.

### 37.31.13 Compatibility with §37.30 and the frozen contracts

| Frozen contract | Disposition |
|---|---|
| MySQL L0 transaction gate | unchanged; the admission gate takes no lock and adds no round trip |
| L1-L8 business lock order | unchanged |
| Existing Finance monetary authority | unchanged; no Finance calculation is touched |
| Existing valid retry semantics | unchanged, except that a retry now additionally requires a proven-safe connection state (§37.31.4) |
| Existing idempotency behaviour | unchanged; scope, fingerprint and replay semantics are identical |
| SQLite behaviour | unchanged; the admission gate is MySQL-only by design |
| MySQL READ COMMITTED isolation | unchanged; no isolation configuration is touched |
| Existing Wave 7 Gate A cases | unchanged; A-PARITY / A-PROD / A-RAW entries, coverage and order are untouched |
| Gate B / Wave 10 boundary | unchanged; the M1-M25 board is untouched and Gate B stays `BLOCKED_BY_WAVE10` |
| Existing schema and migrations | unchanged |
| §37.20 combined retry budget | preserved, except that its "inner retry re-executes `work()` only AFTER `db.exec('ROLLBACK')`" guarantee is now **enforced** rather than assumed (§37.31.4.1, F5) |
| §37.24 retry budget | preserved; no hard wall-clock bound is restated (C2) |
| §37.28 F1 public exhaustion contract | preserved; `503 SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED` and its details are unchanged. A refused admission and a failed rollback are **not** converted into that contract, because that contract is reserved for the outer rediscovery budget |
| §37.29 F2 admission budget | unchanged and still **not implemented** (C11) |
| §37.30 | superseded only as listed in §37.31.2; everything else remains in force |
| Business HTTP contracts | unchanged. No new status, body field, header or endpoint. The two new stable code values ride the existing generic 500 contract |
| C9 canonical write order | unchanged |

### 37.31.14 Items requiring external approval before implementation

These are the only points where this Design makes a judgement that the user has
not already approved. Each is narrow and explicitly flagged; none is silently
resolved.

| # | Item | Why it needs approval |
|---|---|---|
| **AP1** | Two new stable **code values** — `MYSQL_TRANSACTION_ADMISSION_REFUSED` and `MYSQL_SESSION_QUARANTINED` — become client-visible through the **existing** generic 500 contract (`safe.code = String(error.code)`). No new status, body shape, field or endpoint is introduced. | A new client-visible code value is a small public-contract addition. `document.md §5.4.2` R3 says not to introduce a new public error contract without explicit design approval. The alternative — reusing `INTERNAL_ERROR` — would leave operators unable to distinguish an infrastructure refusal from any other 500. |
| **AP2** | The **admission refusal** is a hard failure. If any production path were found to call `transaction()` while a transaction is open, it would now fail loudly instead of implicitly committing the outer transaction. | The refusal is the correct fail-closed behaviour, but it converts a latent silent-corruption defect into a visible error. The detection mechanism (the existing suites plus `admissionRefusalCount === 0`) is specified, but the user should accept the possibility of a surfaced latent defect during implementation. |
| **AP3** | The **normal-path release correction** (§37.30.12.2) is now folded into the single cleanup contract and therefore changes the post-COMMIT behaviour when a release cannot be verified: the adapter is quarantined while the committed success is still returned. | The user approved this correction "in principle". This amendment specifies its exact behaviour for the first time. |
| **AP4** | A **quarantined adapter is terminal** for that instance; there is no automatic re-establishment. A process-level MySQL re-establishment policy is not designed here (the §37.30 O5 residual). | The operational consequence — the process cannot serve further MySQL business SQL until it is re-established — is a deliberate fail-closed choice. |
| **AP5** | A one-line **`README.md:344`** owner correction for `server/db.js` is a documentation follow-up. `README.md` is not modified in this stage. | `README.md` is listed as protected in this stage's scope. |
| **AP6** | The Gate A runner's **static M1-M25 status board** remains a static array and is not corrected. | Correcting it would alter the approved Gate A evidence contract, which this amendment is forbidden to change. It is recorded, not fixed. |

### 37.31.15 Residual open items (recorded, not silently absorbed)

| # | Item | Status |
|---|---|---|
| R1 | The Worker's internal `inTransaction` flag is not generation-scoped (F13). | Neutralised on the timeout path by quarantine plus termination. `mysql-worker-protocol.js` remains unchanged. A future protocol-level improvement may be raised as a separate Requirement. |
| R2 | The server-side session teardown window between Worker exit and the server's session reap is not observable from the parent. | Accepted. The safety invariant is stated over reusable connections. The A-TXLIFE M2 case asserts the end state. |
| R3 | The Gate A runner's static M1-M25 board (AP6). | Recorded, not fixed. |
| R4 | The quarantined adapter's re-establishment policy (AP4). | Deferred to a separate Requirement. |

### 37.31.16 Boundary and status

This section is a Design deliverable only. No production source, test, schema,
migration, `document.md`, `README.md`, `package.json`, database state or Git
history is changed by it. No MySQL connection, Gate execution, reset, DROP,
schema recreation, destructive operation, release or deployment is authorized.
Gate A remains blocked, retest #2 remains unexecuted, Gate A is not declared
PASS, Wave 7 is not frozen, and Wave 10 remains blocked. No acceptance or
freeze is declared.

**Status: `TRANSACTION_LIFECYCLE_FINAL_DESIGN_READY_FOR_APPROVAL`.**

---

## 37.34 Wave 10 Precondition, Gate B Downstream Contract and §1–#15 Design Status (2026-10-24)

### 37.34.0 Scope and authorization

This is a **bounded status, dependency and acceptance design**. It does not rewrite `§36`, does not
restate or re-decide the Credit Check business specification, does not introduce a new Credit
business rule, and does not modify `§37.0–§37.33`, the frozen Gate A record, the Wave 9 freeze
record, the Stage B closure or any `log/` entry.

Authorization: one Requirement stage followed by this Design stage, under the amended
`AGENTS.md §4.0` consecutive-stage authorization. The Requirement deliverable is
`document.md` "Wave 10 Precondition Requirement Reconciliation (2026-10-24)". **This Design ends in
a HARD STOP before Implementation** (`AGENTS.md §4.0`, `§4.3`).

Nothing in this section is an implementation. No production source, test, schema, migration,
permission, frontend file or `package.json` is changed by it.

### 37.34.1 Canonical state and dependency direction

The Wave 10 → Gate B → Wave 11 sequence is a **one-way state machine**. Each transition has exactly
one predecessor, and no state may be entered by skipping a predecessor.

```text
  [Gate A Final Acceptance + Freeze]      DONE  (2026-10-24, GATE_A_FINAL_ACCEPTANCE_PASS — FROZEN)
            |
            v
  WAVE10_NOT_STARTED                      current
            |  (explicit user Implementation authorization)
            v
  WAVE10_IMPLEMENTATION_AUTHORIZED
            |  (production implementation + its own acceptance)
            v
  WAVE10_IMPLEMENTED_PENDING_ACCEPTANCE
            |  (explicit user Wave 10 Final Acceptance)
            v
  WAVE10_FINAL_ACCEPTANCE_PASS — FROZEN
            |
            v
  GATE_B_BLOCKED_BY_WAVE10                (released only by the state above)
            |  (Gate B runner executed against real Wave 10 code)
            v
  GATE_B_EXECUTED_PENDING_USER_ACCEPTANCE
            |  (explicit user Gate B Final Acceptance)
            v
  GATE_B_FINAL_ACCEPTANCE_PASS — FROZEN
            |
            v
  WAVE11_ELIGIBLE
```

Four invariants bind this machine:

- **I-A — Gate A is frozen and unchanged.** `§37.33` and `document.md` "Gate A Final Acceptance and
  Freeze Record (2026-10-24)" §1–§5 remain in force. This section does not reopen Gate A, does not
  alter its runner, its suite manifest, its suite order, its strict TAP / fail-fast / per-suite
  cleanup rules, its target-identity guard, the canonical named-lock release contract, the MySQL
  `READ COMMITTED` session isolation, the L0 / L1–L8 lock order or its M1–M25 board.
- **I-B — Gate B is never a prerequisite for Wave 10.** `§37.18`, `§37.26` and the Gate A Freeze
  Record §4 already establish this. `WAVE10_NOT_STARTED → WAVE10_IMPLEMENTATION_AUTHORIZED`
  requires **only** an explicit user Implementation authorization. No further technical gate is
  inserted between them.
- **I-C — Gate B is discharged only by real Wave 10 code.** A Gate B case may be reported `PASS`
  only when it executed against the Wave 10 production implementation. `BLOCKED_BY_WAVE10` is not
  `PASS`; a skipped case is not `PASS`; a case verified by inspection is not `PASS`; `NOT_RUN` is
  not `PASS`.
- **I-D — No Gate B-0.** No preparatory, dry-run, stub, simulated or "credit-free" Gate B variant
  may be created to bypass the sequence, and no gate may be renamed or split to pre-empt Wave 10.
  Gate B is a single downstream gate over one fixed case set (§37.34.4).

`WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` is, per `§37.18.1` and `§37.26`, satisfied only by
Gate A passing **plus** explicit user Final Acceptance. Both occurred on 2026-10-24. The label is
therefore **a satisfied historical entry condition, not an active block**. It is retained as the
identifier of the Wave 10 entry gate. Its appearance as "active and unchanged" in dated stage
records is preserved history and is superseded for current status only by this section and by the
Requirement record.

### 37.34.2 Wave 10 entry gate and the boundaries it inherits

**Entry gate.** Wave 10 Implementation may begin when, and only when, the user grants explicit
Implementation authorization under `AGENTS.md §4.4`. At that point the following are in force and
may not be renegotiated by the implementation:

| Frozen input | Source |
|---|---|
| Wave 9 Credit Foundation (six tables, AP1–AP5, SC83–SC89, UAT-S-29/30) | `§36.16`, `document.md` Wave 9 Freeze Record |
| Wave 7 Sales & Customer contracts and the W7-C1 / W7-C2′ boundaries | `§37.0`, `§37.29`, `§37.30`, `§37.31` |
| MySQL L0 transaction gate | `§37.3` L0 row |
| L1–L8 business lock order | `§37.3`, `§36.14.3` |
| Canonical named-lock lifecycle and its single verified release contract | `§37.31.5` |
| Finance monetary authority and post-lock re-read | `§37.6` |
| Effective retry semantics and the retry-admission budget | `§37.8`, `§37.24`, `§37.29` |
| Idempotency and replay contract | `§37.6`, `§37.12` |
| SQLite compatibility behaviour | `§37.10` H, `§36.5` |
| MySQL `READ COMMITTED` session isolation | `§37.17`, `§37.23` |
| The frozen Gate A boundary | `§37.33` |

**Prohibitions that bind the Wave 10 implementation.**

- **P-1 — No engine pre-emption.** The Credit Check engine, `credit_check_results`,
  `credit_special_approval` and the Credit Special Approval workflow belong to Wave 10. They must
  not be implemented earlier under another wave name, and no partial engine may be introduced under
  another wave's label to pre-satisfy Wave 10 scope.
- **P-2 — No fixture-computed exposure.** The exposure used by the Credit Check must be the
  production `evaluateCredit()` computation over authoritative Finance / Planning / Inventory
  sources (`§36.3.2`, PURE_DERIVED). A test fixture that computes its own exposure to make a case
  pass substitutes a fixture truth for the production truth and is not acceptable evidence for any
  Wave 10 or Gate B claim. Fixtures may *seed* facts; they may not *decide* the business outcome.
- **P-3 — No second anchor protocol, no second rating writer, no second effective-profile
  resolver.** Wave 10 consumes `§36.4` anchor provisioning, `§36.7.1` rating ownership and
  `§36.2.2` / `credit-profile.js` effective-date resolution as they exist.
- **P-4 — No lock-order inversion.** The Credit Check takes no row lock on any Sales business row
  (`§36.3.4.1` C-2) and no lock that would place Sales rows ahead of L2–L5 (`§36.14.3`).

### 37.34.3 Wave 10 design traceability

This section **reuses** the approved Credit design. It restates no business rule and introduces no
new one.

| Concern | Authoritative source (unchanged) |
|---|---|
| Wave 10 delivery scope | `§30.17` Wave 10 row — dependencies Wave 9; exactly 2 new tables; `evaluateCredit()` service; credit-special-approval workflow; credit-check evaluate surface; credit-special-approvals new route; new migration file; `UNIQUE (source_credit_check_result_id)`; UAT-S-31…33 and S14/S15/S16 |
| The two Wave 10 tables | `§36.2.7` `credit_check_results` (A-54, plural canonical) and `§36.2.8` `credit_special_approval` (A-53); the deliberate absence of `special_approval_id` on the result row; `UNIQUE (source_credit_check_result_id)` as the structural P13 guarantee |
| Credit Check lock order and calculation flow | `§36.3.4` steps 0–10 (anchor discovery → Finance PREPAYMENT parent `FOR UPDATE` first → POLICY_SCOPE `FOR SHARE` → AGGREGATE → SALESPERSON → profile rows → snapshot insert-only → rule rows → result insert → approval row → commit), and `§36.3.4.1` C-1 / C-2 / C-3 |
| Special Approval contract | `§36.6.6` (and `§36.6.3` runtime sequence, `§36.6.4` decision semantics, `§36.6.5` error and conflict semantics) |
| Capacity preconditions and Wave 10 races | `§36.8.1` (BOTH_FIT / ONLY_ONE_FITS / NEITHER_FITS) and `§36.8.3` W10-R1…W10-R12; `§36.8.5` common side-effect assertions |
| Parent-independent acyclic order | `§36.14.3` L1…L8 with the acyclicity proof |
| L1–L8 lock order and Wave 10 composition | `§37.3` — "the Credit Check executes strictly between L1 and L6, acquires anchors in L2/L3/L4 order and profiles/rules at L5, and performs no Sales or Finance business-row lock" |
| Evidence classification | `§37.10` A–H, and the strict separation rule §37.10 E |
| Gate B downstream contract | `§37.18` and `§37.18.2` |

**Future Wave 10 implementation scope, by reference.** Wave 10 implements, under its own
authorization and acceptance:

- the two tables of `§36.2.7` and `§36.2.8` and their migration, with the `§36.5.5` read-only
  `information_schema` contract assertions appended unconditionally after creation (I-1…I-5, I-7)
  and with `§36.5.4` upgrade-path equivalence proven;
- the `evaluateCredit()` production execution path of `§36.6.3`, including the runtime sequence
  steps 1–10, the fail-closed behaviour at step 1, the idempotent `check_group` resolution at
  step 2, the scope resolution of `§36.3.1`, the anchor provisioning of `§36.4` at step 4, the
  lock chain of `§36.3.4` at step 5, the per-scope effective-profile resolution and exposure
  computation at step 6, the snapshot write at step 7, the one-row-per-scope result write at
  step 8, the audit rows at step 9, and the all-or-nothing commit at step 10;
- PURE_DERIVED exposure computed from authoritative Finance / Planning / Inventory sources
  (`§36.3.2`), with the `UNPROVEN_ATTRIBUTION` rule of W10-R10 honoured;
- the Credit Special Approval workflow (`§36.6.6`) and its per-scope isolation guarantee;
- the authorization integration into Sales Order Submit / Approve and Delivery Confirm, subject to
  `§36.14.3` and `§36.3.4.1` C-2/C-3;
- the corresponding API, UI surface, migration, audit rows, idempotency and replay behaviour,
  transaction boundaries and concurrency tests, classified exactly as `§37.10` requires.

No item above is designed here, and none is implemented by this section.

### 37.34.4 Gate B independent acceptance design

#### 37.34.4.1 Runner independence

Gate B uses **its own** acceptance runner. It must not be carried by the Gate A runner file, and the
Gate A runner, its manifest, its suite order, its strict TAP rules and its M1–M25 board are not
modified, forked in place, or reused as a Gate B carrier.

```text
Gate A runner  scripts/gates/mysql-sales-wave7-gate-a.mjs      FROZEN, unchanged
Gate B runner  scripts/gates/mysql-sales-wave10-gate-b.mjs     NEW, owned by the
                                                            Wave 10 acceptance stage
```

The Gate B runner may reuse genuinely shared, gate-agnostic infrastructure — in particular the
disposable-target guard `server/test-utils/mysql-disposable-target.js` and the shared
`server/test-utils/temp-db.js` MySQL path — because those are common platform facilities, not Gate A
artifacts. It must not import Gate A's suite list, Gate A's static board, or Gate A's per-case
expectations.

**Runner contract (all mandatory):**

1. **Real evidence only.** The M-board is composed from the cases' actual execution results. A hard-
   coded status literal, a static array, or a status that is not derived from an executed assertion
   is forbidden. This is the specific defect recorded in `§37.31.15` R3 for the Gate A board; Gate B
   must not reproduce it.
2. **Strict TAP.** Each suite must satisfy `pass === tests`, `fail === 0`, `skipped === 0`,
   `cancelled === 0`, `todo === 0`. A missing, malformed or unparsable counter fails the run.
3. **Fail fast.** The first nonzero child exit stops the campaign and no later case is reported.
   A stopped campaign is `NOT_RUN` for the remaining cases, never `PASS`.
4. **Protected target.** The exact disposable identity and the exact destructive-operation
   acknowledgement are revalidated before any reset, `SELECT DATABASE()` is verified before every
   reset, and every table identifier is validated — per `AGENTS.md §13` and the existing shared
   guard.
5. **Per-suite isolation and cleanup.** The schema is reset separately before each suite, and each
   suite cleans up the objects it created. A cleanup failure is a failure.
6. **Zero skips.** No Gate B case may be skipped, cancelled or reported as todo.

#### 37.34.4.2 The seven cases

Gate B holds exactly these seven real-execution cases (`§37.18.2`), and each must execute against
the real Wave 10 production code:

```text
B-COMPOSE  Credit / Gate / Sales lock-order composition — that L2→L3→L4→L5 sits
           between L1 and L6, and that Credit takes no Sales or Finance
           business-row lock.
B-M9       Credit Check vs SO Submit, same order.
B-M10      Two salespersons, one customer aggregate; exactly one commits under
           ONLY_ONE_FITS, with §36.8.1 preconditions asserted or the fixture
           declared unconstructible.
B-M11      Credit Profile mutation vs active Credit Check.
B-M12      Credit Special Approval vs policy mutation.
B-M15      Empty parent set, two salespersons, one customer aggregate.
B-M19C     The Credit half of M19: a genuinely missing mandatory Profile fails
           closed at the pre-lock guard with zero prohibited side effects; §37.39.7 governs.
```

#### 37.34.4.3 Evidence classification and its limits

Every Gate B case declares its `§37.10` evidence layer before execution, and every reported result
is labelled with exactly one of `PRODUCTION_SERIALIZED_OUTCOME`, `RAW_ROW_LEVEL_LOCK_ORDER` or
`STATIC_INTENT`. The three are never merged.

- **Raw row-level lock order proves lock mechanics only.** Because production `transaction()`
  serialises every MySQL transaction at the L0 gate row (`§37.10` D), a raw session that opens its
  own `BEGIN` and issues explicit `SELECT … FOR UPDATE` in the L1…L8 order can assert **lock
  acquisition and wait order and lock-wait behaviour only**. It may **not** assert a business
  outcome and it may **not** be reported as production behaviour. The production gate is never
  disabled, bypassed or reconfigured; the raw probe simply does not use `transaction()`.
- **A raw result is never a business result.** "Exactly one committed", "the aggregate was
  enforced", "the exposure did not double-count" are business claims and require
  `PRODUCTION_SERIALIZED_OUTCOME`. A lock-order observation does not establish them.
- **Pre-fix deadlock evidence.** Where the case's subject is a documented deadlock reproducer — the
  confirmed pre-existing Wave 7 deadlock (`§36.12.1`), the concealed empty-parent cycle
  (`§36.14.2`), or the M1 / M7 lineage — the fixture must **first** be shown to deadlock against the
  pre-fix ordering in the RAW layer. A fixture that only passes after the fix has not demonstrated
  that the defect existed and cannot be reported as a reproducer (`§37.10` F). Where no pre-fix
  deadlocking ordering is documented for a case, the case records that explicitly as *pre-fix
  deadlock not established for this ordering*; it must not assert a deadlock it did not observe, and
  *not established* is not `PASS` for that sub-claim.
- **Capacity preconditions are proved, never assumed.** Every capacity race case must first prove
  its own precondition from the **actually computed** `available = credit_limit_cents − E`, where `E`
  is the PURE_DERIVED exposure computed from committed facts **before** the race starts
  (`§36.8.1`). The precondition assertion is independent of which transaction wins:
  `BOTH_FIT` → both commit; `ONLY_ONE_FITS` → exactly one commits and one receives 409 `BLOCK`;
  `NEITHER_FITS` → both receive 409 `BLOCK`. **Only after the `ONLY_ONE_FITS` precondition is proven
  may "exactly one fails" be required.** If the precondition cannot be constructed, the fixture
  declares itself unconstructible and asserts that fact; it does not pass.
- **Rejection paths prove zero side effects.** Every rejection path must assert zero rows in the
  `§37.10` G table set. For Gate B that set additionally includes `credit_check_results` **and**
  `credit_special_approval`, and no audit row may exist for the rejected decision. A rejection that
  leaves a result row is a failure, not a warning.
- **Common race assertions** (`§36.8.5`) apply to every Gate B race: committed exposure never
  exceeds the applicable ceiling, no row exists in a partially applied state, every committed
  decision has its audit rows, an idempotent replay returns the stored result without a second
  effect, and no committed transaction leaves an orphan anchor.

#### 37.34.4.4 Wave 10 not implemented

While Wave 10 is not implemented, **every** Gate B case remains `BLOCKED_BY_WAVE10`. This state is
neither `PASS`, nor a skip, nor a deferred-and-green result. The Gate B runner must be able to
report this state truthfully, and the state may only be released by `§37.34.4.1`'s real-execution
path.

### 37.34.5 §1–#15 Design status correspondence

This table corresponds one-to-one with the Requirement record's matrix. The Design **does not close
any business policy or historical-evidence question that the Requirement did not close.** Where the
Design already satisfies an item, the item is not re-designed.

| # | Design position | Evidence produced in which stage |
|---|---|---|
| 1 | Already satisfied by `§36.2.2` and the Wave 9 migration. No re-design. | Closed; no further evidence required |
| 2 | Already satisfied by `§36.2.2` and the Wave 9 migration CHECK. No re-design. | Closed |
| 3 | Already satisfied by `§36.2.2` / `§36.3.4` step 5 / `§36.6.3` step 6 and `credit-profile.js`. Wave 10 must *consume* this resolver, not re-derive it. | Closed for Wave 9; Wave 10 consumption proven in the Wave 10 implementation and acceptance |
| 4 | Already satisfied by `§36.2.4` and the Wave 9 migration. No re-design. | Closed |
| 5 | Already satisfied by `§36.2.3` and the Wave 9 migration. No re-design. | Closed |
| 6 | Already satisfied for Wave 9 by `§36.5.2` / `§36.2.6` and the migration's FK-free column. The Wave 11 realization is defined by `§36.5.3` / `§36.5.5` I-6. | Closed at Wave 9; I-6 evidence is produced by the Wave 11 protected MySQL gate |
| 7 | Already satisfied by `§36.5.2`'s construction. No re-design. | Closed |
| 8 | Wave 9 metadata convergence is satisfied by `§36.5.5` and the migration's `assertMySql`. The **Wave 10 → Wave 11** ordering obligation is a Wave 10 implementation duty: create `credit_check_results` before the table that references it, and append `§36.5.5`-style assertions unconditionally. | Wave 10 implementation stage, then the protected MySQL gate in that stage |
| 9 | Already satisfied by `§36.4` and `credit-anchor.js`. No re-design. Wave 10 must provision in `POLICY_SCOPE → AGGREGATE → SALESPERSON` order. | Closed |
| 10 | The identity/uniqueness contract is satisfied by `§36.2.5` and the Wave 9 migration. The **writer** is Wave 10 scope (`§36.6.3` step 7). | Closed for the contract; writer proven by the Wave 10 implementation and acceptance |
| 11 | The naming decision is settled by `§36.2.1` and `§36.2.7`. The Wave 10 table is **created** by the Wave 10 implementation exactly as `§36.2.7` specifies. | Wave 10 implementation stage |
| 12 | The Wave 9 `INITIAL_ASSIGNED` ownership is satisfied by `§36.7.1` and `credit-profile.js`. The `EVALUATED` path is SC107, a Wave 11 capability. Wave 10 must not create a second rating writer. | Closed for Wave 9; Wave 11 obligation deferred |
| 13 | The split is deliberate: `§36.8.2` limits Wave 9 to infrastructure-level R-SAL-24; `§36.8.3` W10-R1…W10-R12 are the Wave 10 full business races. Design defines **what evidence closes it**: W10-R1…W10-R12 executed as real independent-session MySQL races with `§36.8.1` preconditions proved, plus the Gate B Credit cases. | Wave 10 implementation + Wave 10 acceptance; the Credit-integration subset closes only through Gate B |
| 14 | See `§37.34.6` — non-destructive compatibility boundary, no claim about unknown external state. | No automatic evidence. Requires a separately authorized read-only external inventory; until then it remains open |
| 15 | See `§37.34.7` — the exact missing cross-database evidence and the protected gate that must produce it. | Wave 10 implementation's protected MySQL gate, and any separately authorized Wave 9-focused protected run |

### 37.34.6 `LEGACY_DATA_EVIDENCE_PENDING` — non-destructive compatibility boundary

The legacy Credit Profile inventory remains an unresolved external-evidence dependency. This
Design defines the **compatibility boundary** that makes that dependency non-blocking, and does
**not** assert anything about the unknown external database.

```text
AUTHORITY   The Wave 9 `credit_profile` table is the single authority for Credit
            Profile state. Wave 10 reads it through the existing effective-date
            resolver and writes nothing into it except through the Wave 9
            canonical writers.

NO INFERENCE Wave 10 must not read, backfill, normalise, repair, deduplicate or
            otherwise interpret any legacy row. It must not infer that a legacy
            row is valid, invalid, duplicated or absent. A row it reads is a row
            the Wave 9 physical contract admits; nothing more is claimed.

NO REPAIR   A row that violates the Wave 9 physical contract — PK form,
            `salesperson_scope_key` normalization, `anchor_id` referential
            integrity, `effective_from`/`effective_to` interval validity, `status`
            domain — must fail closed. Wave 10 must not create a compatibility
            path that silently repairs, skips or reinterprets it.

NO NEW PATH Wave 10 introduces no legacy-shaped table, no legacy import, no
            one-time backfill and no alternate Profile source.

NO CLAIM   This Design does not state that no legacy data exists, does not state
            that legacy data does exist, and does not make a historical
            compatibility claim in either direction.

STILL PENDING The external read-only inventory remains a separately authorized
            operation and remains NOT PERFORMED.
```

Wave 10 is therefore **not blocked** by this item: `§36.5.6` already defines a safe default (the
table is created empty, no backfill, no invented records), and Wave 10 neither depends on nor is
endangered by the legacy inventory.

### 37.34.7 Cross-database evidence gap — what is missing, when, and by which gate

`§36.5.4` / `§36.5.5` obligations that are **not evidenced** for the six Wave 9 tables:

```text
I-3   Explicit orphan check after bootstrap AND after every live upgrade,
      executed with FOREIGN_KEY_CHECKS restored to its session default.
      MISSING — no orphan-check query exists in the Wave 9 migration or in the
      Wave 9 MySQL integration test.

I-4   Row preservation — a row-count snapshot for every pre-existing table
      identical before and after replay and after each upgrade path.
      MISSING — no such comparison exists, and there is no dedicated Wave 9
      migration / upgrade-path test file (unlike the Wave 2 / 6 / 7 equivalents).

I-6   Forward-FK convergence after Wave 11.
      NOT DUE — Wave 11 does not exist.

TYPE  Physical type parity is asserted for four named columns only
      (`credit_lock_anchors.anchor_key`, `credit_profile_ratings.
      evaluation_result_id`, `credit_check_rules.result_payload_json`,
      `credit_policy_snapshots.notes_json`), not for every column of the six
      tables.
```

```text
MISSING EVIDENCE   I-3, I-4, and full column-type parity for the six Wave 9
                   tables, plus the Wave 9 → 10 upgrade-path equivalence.

WHEN              During the Wave 10 implementation stage, in the same protected
                   disposable-MySQL campaign that proves the Wave 10 tables and
                   the Gate B cases. A dedicated Wave 9-focused protected run is
                   an alternative and requires its own explicit authorization.

WHICH GATE        A protected MySQL gate under AGENTS.md §13 disposable-target
                   discipline — the same exact-target / destructive-acknowledgement
                   / SELECT DATABASE() / per-suite-reset / per-suite-cleanup /
                   strict-TAP contract as §37.34.4.1.

NEVER SUBSTITUTED BY
                 - SQLite results. A SQLite pass proves control flow and dialect
                   intent, not real MySQL behaviour.
                 - The Gate A MySQL campaign. That campaign is Wave 7 evidence.
                   It cannot stand in as Wave 9 Credit Foundation MySQL evidence,
                   and it cannot stand in as Wave 10 evidence.
                 - Static source inspection. §37.10 A proves intended order only.
```

Until that evidence exists, item #15 remains **partially closed with the residual named above**, and
no document, report or acceptance statement may describe Wave 9 cross-database parity as verified.

### 37.34.8 The `WAVE11_TABLES` naming item — bounded future change

`server/mysql-sales-customer-wave9-credit.integration.js:52` declares

```js
const WAVE11_TABLES = ['credit_evaluation_result', 'credit_check_results', 'credit_special_approval'];
```

The constant's name is inaccurate: `credit_check_results` (`§36.2.7`) and `credit_special_approval`
(`§36.2.8`) are **Wave 10** tables; only `credit_evaluation_result` (`§36.2.13`) is a Wave 11 table.
The constant is used only to enumerate table names for an `information_schema` lookup (`:239`), so
the name affects readability, not behaviour.

**Future bounded change (not authorized, not performed here):**

```text
CHANGE   Rename the constant to a name that states the actual contents
         (the Wave 10 result and approval tables plus the Wave 11 evaluation
         result table), and update its use sites consistently.

MUST NOT The SET of tables inspected must not change as a result of the rename.
         The rename is a naming correction only; it must not add, remove or
         substitute a table.

MUST NOT The inspection at :239 must continue to cover exactly
         { credit_evaluation_result, credit_check_results, credit_special_approval }.

TEST     A source-contract assertion must pin that exact set, so a future edit
         cannot quietly change which tables the Wave 9 MySQL suite inspects.
         The suite's substantive assertions must be unchanged by the rename.

STAGE    This is a bounded implementation item inside the Wave 10 implementation
         stage (or an independent bounded change). It is not a Requirement
         change and not a Design change to behaviour.
```

### 37.34.9 Historical status wording — scope of this explanation

`§37.33.4` ends with "Wave 10 remains blocked." The `document.md` Wave 9 Freeze Record §4 and the
`document.md` Stage B records likewise carry dated boundary statements. **Those statements are not
modified, reopened or rewritten by this section.** They remain the authoritative record of their own
stages and their own dates.

This section states the **current** status only, as of 2026-10-24:

- Gate A is accepted and frozen (`§37.33`).
- The `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` entry condition is satisfied (§37.34.1).
- Wave 10 has not started; it requires an explicit user Implementation authorization.
- Gate B remains `BLOCKED_BY_WAVE10` and is not discharged, weakened or deferred.
- The residual open items `§37.31.15` R1–R4 remain open.
- The remaining W7-C1 / W7-C2′ follow-up work is not declared complete.

No `log/` entry, no freeze record and no historical stage text is modified by this section.

### 37.34.10 Compatibility, rollback and boundary

- **Compatibility.** No production contract changes. The frozen Wave 9, Wave 7, L0, L1–L8, Finance
  monetary authority, retry, idempotency, SQLite and MySQL isolation contracts of §37.34.2 remain
  in force. The Gate A boundary is unchanged.
- **Rollback.** This section is documentation only and adds no schema, migration or runtime state,
  so it has no rollback surface. A future Wave 10 implementation must carry its own rollback plan
  per `AGENTS.md §4.3`.
- **Not designed here.** The Credit Check business specification, the special-approval policy
  detail, the API/UI shapes, the migration shape and the test classification of the Wave 10
  implementation remain as already approved in `§30.17` / `§36.6` / `§36.9` / `§36.8.3`. This
  section adds none of them.
- **Not implemented here.** No production source, test, schema, migration, permission, frontend file
  or `package.json` is modified. No test, build, MySQL gate, migration, database connection, database
  query, database reset or destructive operation is executed. No Git write operation occurs.

### 37.34.11 Acceptance criteria for this Design

This Design is complete when:

1. `§37.34.1` states one-way, non-skippable state machine with the four invariants.
2. `§37.34.2` names the frozen inputs and the four prohibitions that bind Wave 10.
3. `§37.34.3` traces every Wave 10 concern to an existing approved source and adds no new business
   rule.
4. `§37.34.4` specifies an independent Gate B runner, the seven fixed cases, the three evidence
   classes and their limits, the pre-fix deadlock obligation, the capacity-precondition proof
   obligation, the zero-side-effect obligation, the board-from-real-evidence rule, the strict TAP /
   fail-fast / protected-target / cleanup / zero-skip contract, and the `BLOCKED_BY_WAVE10` state.
5. `§37.34.5` corresponds to the Requirement matrix item by item and closes nothing the Requirement
   did not close.
6. `§37.34.6` defines a non-destructive compatibility boundary without claiming anything about the
   unknown external database.
7. `§37.34.7` names the missing cross-database evidence, when it is produced and by which protected
   gate.
8. `§37.34.8` records the `WAVE11_TABLES` naming correction as a bounded future change with a
   source-contract test requirement.
9. `§37.34.9` limits this section's status statement to current status only.

**HARD STOP.** This Design is complete. Implementation is **not** authorized by it and must not
begin without the user's explicit approval (`AGENTS.md §4.0`, `§4.3`).

**Status: `DESIGN_RECONCILIATION_COMPLETE`.**

## 37.36 Wave 10 B-9 / B-10 / S14 Bounded Remediation Design (2026-10-24)

### 37.36.0 Authorization, scope and evidence

The user explicitly authorized the consecutive `AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION`
closure for B-9, B-10 and S14. The approved Requirement is `document.md` "Wave 10 B-9 / B-10 /
S14 Bounded Requirement Amendment (2026-10-24)". This section is the independent Design record;
it does not declare Acceptance or Freeze and authorizes no MySQL, Gate B, Git write, release or
deployment.

The isolated pre-change reproduction was:

```text
Mode A final AR                         100000
Mode B delivered + invoice AR          200000  (defect; expected 100000)
Mode C provisional                     100000
Mode C converted invoice AR            200000  (defect; expected 100000)
```

### 37.36.1 Files and function responsibilities

| File / function | Bounded responsibility |
|---|---|
| `server/modules/credit-check.js` `resolveApplicableCreditScopes()` | Reject every resolved non-ACTIVE Profile before any enforceable scope can be evaluated; keep `resolveEffectiveCreditProfile()` unchanged and actor-free. |
| `server/modules/credit-check.js` `resolveReceivableSource()` and bounded helpers | Resolve invoice-sourced AR through canonical Finance links and validate customer, source, line, order, salesperson and allocated cents. |
| `server/modules/credit-check.js` `computeCreditExposure()` | Release predecessor buckets by proven invoice allocation exactly once and attribute remaining AR only where Finance/Sales lineage proves it. |
| `server/sales-customer-wave10-credit-check.test.js` | Add B-9, B-10, S14 and Recognition Mode coverage/regression fixtures. |

No schema, migration, Finance writer, permission, route, Wave 9 resolver, Gate A file, exposure
ledger or cache is added or modified. `README.md` needs no change because module ownership and
repository structure do not change.

### 37.36.2 B-9 ACTIVE-only enforceability guard

The consumer-side flow is:

```text
resolveCustomerCreditObject()
  → resolveEffectiveCreditProfile() for aggregate / salesperson (unchanged, actor-free)
  → zero profile: existing CREDIT_PROFILE_MISSING
  → resolved profile status != ACTIVE:
       HTTP 409 / CREDIT_PROFILE_NOT_ENFORCEABLE
       include profile id, scope and status as bounded error evidence
       no scope evaluation, snapshot, result, audit or approval consumption
  → every resolved profile ACTIVE:
       existing aggregate / salesperson scope rules continue
```

All resolved scopes are checked before returning an applicable scope set. Therefore a suspended or
closed salesperson sub-limit cannot fall back to an ACTIVE aggregate, and a suspended or closed
aggregate cannot be bypassed by a salesperson profile. The currently effective version remains the
authority; no earlier ACTIVE row is searched. This guard is evaluated before any Special Approval
lookup, so Special Approval cannot cross the status fence.

`solution.md §36.15.9`'s unfiltered engine contract means no human actor/data-scope predicate is
applied. It does not mean that every resolved status is enforceable. The Wave 9 resolver and its
accepted effective-date identity remain unchanged.

### 37.36.3 B-10 transition-based retention

`readApprovedOrders()` keeps its current business-date predicate and receives no age predicate.
There is no parameter, TTL, scheduler or cleanup implementation.

Regression design:

- an old approved, undelivered and open SO remains fully in A;
- crossing an arbitrary N-day boundary changes nothing;
- a true canonical delivery transfers only the delivered amount A → B/P/C;
- a partial invoice transfers only the allocated amount B/P → C;
- a cancellation/controlled closure releases only an amount the canonical Sales facts actually
  extinguish; residual Delivery/AR remains;
- AR remains until its canonical `open_amount_cents` is reduced by settlement/credit/write-off;
- overdue status never adds another amount to AR open.

### 37.36.4 Canonical invoice-source lineage and validation

For `account_receivables.source_type='SALES_INVOICE'`, resolve:

```text
account_receivables.source_id
  → sales_invoices.id (POSTED/current canonical invoice; customer must match AR)
  → finance_invoice_source_links
       invoice_side = SALES_INVOICE
       source_type = SALES_DELIVERY or another explicitly supported Sales source
       invoiced_amount_cents = authoritative invoiced allocation
  → source row and source_line_id identity
  → sales_delivery_items.sales_order_item_id
  → sales_order_items.order_id
  → sales_orders.customer_id / salesperson_id
```

The first implementation supports the already-written physical-sales source
`SALES_DELIVERY`. Existing direct `SALES_DELIVERY` / `SALES_ORDER` AR behavior stays unchanged.
Other invoice-link source types are not guessed; an invoice AR that cannot be completely proven
fails closed with `CREDIT_EXPOSURE_SOURCE_INCONSISTENT`.

Validation invariants:

```text
IL-1 link invoice_id / invoice_side identify exactly the AR invoice
IL-2 linked Delivery exists and belongs to the AR customer
IL-3 source_line_id exists, belongs to that Delivery and maps to one SO item/order
IL-4 SO customer equals AR customer; cross-customer evidence fails closed
IL-5 invoiced_amount_cents is a non-negative safe integer
IL-6 SUM(link allocation) == AR original amount_cents for the supported invoice source
IL-7 duplicate logical link or conflicting identity fails closed
IL-8 per-order transition release never exceeds its delivered/source obligation
```

Links are read only. The repair does not update Finance rows and introduces no reverse lock
acquisition. The Credit Check continues to take no Sales row lock.

### 37.36.5 Amount conservation and partial settlement

For each invoice AR, link allocations form an immutable transition map. Aggregate exposure applies:

```text
delivered predecessor for order O -= SUM(proven invoice allocations for O)
final AR bucket += account_receivables.open_amount_cents once per AR header
```

This deliberately separates transition amount from remaining amount: a later collection or credit
reduces the Finance-owned AR open header, while the invoiced amount remains the proof that the
predecessor bucket already transitioned. The same link is aggregated once by AR and order, so it
cannot subtract twice.

Salesperson attribution is allowed only when exact:

- if AR open equals original AR amount, link allocations may be attributed by their exact proven
  salesperson amounts;
- after partial settlement/credit, the remaining AR may be attributed in full only when every
  positive linked source resolves to the same salesperson;
- if a partially settled invoice spans multiple salespersons, canonical Finance facts contain no
  source-level remaining allocation. The AR is `ATTRIBUTION_AMBIGUOUS`; a mandatory salesperson
  scope returns `BLOCK / UNPROVEN_ATTRIBUTION`. No proportional, FIFO, equal or residual split is
  invented;
- the customer aggregate still uses the exact Finance header open amount and exact source releases.

Conservation:

```text
AC-1  release(O) <= delivered/source obligation(O)
AC-2  SUM(release by order for invoice) = SUM(authoritative link allocation)
AC-3  aggregate outstanding = untransitioned A/B/P + canonical final AR open
AC-4  each final AR header contributes open_amount_cents exactly once
AC-5  each source allocation releases its predecessor exactly once
```

### 37.36.6 Recognition Mode rule-coverage matrix

| State | Resolver result | Enforcement / API | Result + audit | Status |
|---|---|---|---|---|
| Credit disabled | management false | `enforced=false`, PASS compatibility | none | implemented, preserve |
| Global rule (`recognition_mode NULL`) | applicable | normal limit evaluation | required on committed evaluation | implemented |
| Exact mode rule | applicable only for matching mode | normal evaluation | required | implemented |
| Rule for another mode only | no applicable rule | `enforced=false` | none | approved no-applicability contract |
| No effective rule | no applicable rule | `enforced=false` | none | approved no-applicability contract |
| Applicable WARNING | applicable | WARNING when over limit | required | implemented |
| Applicable BLOCK | applicable, mandatory | backend fail closed | refusal transaction rolls back successful result/audit | implemented |
| Explicit customer/scenario exemption | no physical selector exists | OPEN; do not fabricate | none until separately designed | Requirement/model gap |
| Missing Profile | applicable mandatory rule | 409 `CREDIT_PROFILE_MISSING` | zero successful side effects | implemented |
| Non-ACTIVE Profile | applicable mandatory rule | 409 `CREDIT_PROFILE_NOT_ENFORCEABLE` | zero successful side effects | this remediation |
| Aggregate + salesperson | both resolved | both must pass; no fallback | per-scope evidence on success | implemented + status guard |

No nonmatching rule is converted into a global rule. The explicit-exemption row remains OPEN and
does not block B-9/B-10/S14 because this remediation creates no exemption path.

### 37.36.7 Transaction, error, audit and compatibility

- The caller still owns the transaction. B-9/S14 errors throw HTTP 409 before a successful Credit
  result and roll back snapshots, result rows, audit, approval consumption and caller mutation.
- L0, L1–L8, named-lock release, MySQL READ COMMITTED and the existing retry/idempotency contracts
  are unchanged. New work is bounded read-only source resolution beneath the existing Credit locks;
  it adds no Finance/Sales row lock and no writer.
- Exact replay stays unchanged. A current non-ACTIVE Profile changes the effective-state hash and
  cannot consume a prior approval or replay a successful decision for a new obligation.
- Mode A direct-source behavior remains unchanged. Mode B/C use existing Finance lineage only.
- Unknown, missing, cross-customer, over-allocated or internally inconsistent invoice evidence
  fails closed with `CREDIT_EXPOSURE_SOURCE_INCONSISTENT`; ambiguous multi-salesperson remaining AR
  uses existing `UNPROVEN_ATTRIBUTION` semantics.
- Rollback is source-level: revert only the bounded `credit-check.js` and focused-test changes. No
  data rollback or migration exists.

### 37.36.8 Focused verification matrix

Required SQLite cases include Mode A 100000; Mode B 100000 delivered → 100000 invoice AR = 100000;
Mode C provisional = 100000; Mode C converted = 100000; Mode B partial invoice 40000 = B 60000 +
AR 40000; partial collection with one provable salesperson; one invoice over multiple deliveries;
multi-salesperson partial settlement ambiguity; duplicate/inconsistent links; cross-customer link;
unknown invoice source; credit/reversal-adjusted open amount; ACTIVE/SUSPENDED/CLOSED aggregate and
sub-limit; ACTIVE replacement; Special Approval status fence; global/exact/nonmatching/absent
rules; old unresolved SO; partial delivery; controlled close/cancel evidence; overdue subset.

Safe gates after focused tests: Wave 9 Credit Foundation regression, affected Sales/Delivery/Finance
regressions, `pnpm.cmd test:fast`, `pnpm.cmd test`, `pnpm.cmd test:heavy`, `pnpm.cmd build`, and
`git diff --check`. MySQL and Gate B remain NOT_RUN.

### 37.36.9 Design decision record and boundary

```text
B9_GUARD_AT_WAVE10_CONSUMER
WAVE9_RESOLVER_ACTOR_FREE_UNCHANGED
B10_TRANSITION_RETENTION_REMEDIATION
S14_CANONICAL_INVOICE_LINK_REMEDIATION
NO_SHADOW_EXPOSURE_OR_FINANCE_ALLOCATION
PARTIAL_MULTI_SALESPERSON_REMAINDER_FAILS_CLOSED
EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
```

This Design changes no implementation file. Under the user's explicit consecutive authorization,
the next stage is the bounded Implementation above; Acceptance / Freeze remains prohibited.

## 37.39 Wave 10 MySQL Acceptance Infrastructure Remediation Design (2026-10-25)

### 37.39.0 Authorization, inputs and stop boundary

The user authorized one consecutive `AUDIT -> REQUIREMENT -> DESIGN` documentation stage after the
external result `WAVE10_MYSQL_ACCEPTANCE_AUTHORIZATION_BLOCKED`. The approved Requirement for this
Design is `document.md` "Wave 10 MySQL Acceptance Infrastructure Remediation Requirement
(2026-10-25)", identifiers `W10-AIR-R01` through `W10-AIR-R10`.

This Design changes no implementation. It authorizes no MySQL connection, target probe, reset,
migration, Gate run, production/test/script edit or Git write. Completion of this section is a HARD
STOP pending explicit user approval and a separate Implementation authorization.

The source reconciliation is:

| Finding | Result | Current evidence | Design response |
|---|---|---|---|
| W10-AUD-001 | CONFIRMED | Gate B M9/M10/M11 markers follow source-regex assertions; M15 is RAW-only; M19C proves only missing Profile/result count | §§37.39.5, 37.39.7 |
| W10-AUD-002 | CONFIRMED | URL flags and `SELECT DATABASE()` exist; `CURRENT_USER()`, UUID, version, grants and first-inventory policy do not | §37.39.3 |
| W10-AUD-003 | CONFIRMED | suite child wait has no deadline or process-tree termination | §37.39.4 |
| W10-AUD-004 | CONFIRMED | no deterministic business barrier; R2/R3/R4/R7/R8/R9/R10/R11/R12 assertions do not prove their contracts | §37.39.6 |
| W10-AUD-005 | CONFIRMED | R1/R5/R6 use seed-derived constants rather than computed authoritative exposure | §37.39.6.1 |
| W10-AUD-006 | PARTIALLY_CONFIRMED | final bootstrap minus two tables is not a real upgrade and source parity is handwritten; dynamic I-3 and synthetic row-value I-4 remain useful partial evidence | §37.39.8 |
| W10-AUD-007 | CONFIRMED | current footprint contains four counters and omits Sales/Gate/Finance identities and values | §37.39.10 |
| W10-AUD-008 | CONFIRMED | protected manifest has parity+races only; no complete B-9/B-10/S14/Recognition-Mode MySQL matrix | §37.39.9 |
| W10-AUD-009 | CONFIRMED | shared TAP helper parses summary counters only; local Wave 10 tests are source-regex contracts | §37.39.5, §37.39.11 |

No reconciliation row is a PASS for real MySQL behavior.

### 37.39.1 Design principles and Requirement mapping

```text
D-1 Evidence owns its case.                         W10-AIR-R01
D-2 A destructive lease follows empty-target proof. W10-AIR-R02
D-3 A live child and cleanup never race.             W10-AIR-R03
D-4 Coordination is server-observed, not sleep.      W10-AIR-R04
D-5 Capacity expectations come from canonical E.    W10-AIR-R05
D-6 Upgrade uses bootstrap + ordered registry.       W10-AIR-R06
D-7 Persistence is compared by identity and value.  W10-AIR-R07
D-8 Business modes have their own MySQL suite.       W10-AIR-R08
D-9 Runner behavior is locally executable with fakes.W10-AIR-R09
D-10 Shared/frozen gates retain current behavior.    W10-AIR-R10
```

The implementation must not modify a production handler, transaction primitive, migration or
schema to make an acceptance fixture pass. A newly discovered production defect returns to its own
Requirement/Design stage.

### 37.39.2 Exact future file and module boundary

The following is the complete planned Implementation file set. A file absent from this table is
out of scope unless a newly discovered fact forces a new Requirement/Design stop.

| File | Current responsibility | Planned change | Must not change | Req | Tests |
|---|---|---|---|---|---|
| `scripts/gates/mysql-sales-wave10-manifest.mjs` | Wave 10/Gate B suite and evidence data | add the business-matrix suite; set B-M15 primary level to production; give every case one owner | Gate A/legacy lists | R01/R08/R10 | L-MAN-01, L-ISO-01 |
| `scripts/gates/mysql-wave10-runner-support.mjs` | sequential reset/spawn/TAP/final cleanup | delegate identity lease, bounded process lifecycle, strict transcript and state reducer | command names; sequential suite order | R02/R03/R09 | L-RUN-01..10 |
| `scripts/gates/mysql-sales-wave10-gate-b.mjs` | marker reduction and board output | consume typed case evidence only after all suites and final zero; suppress board on every failure | seven fixed ids | R01/R09 | L-MBR-01..07 |
| `scripts/gates/mysql-sales-wave10-acceptance.mjs` | bounded Wave 10 entry | no behavioral logic expected; continues to consume manifest | no Gate A/legacy import | R08/R10 | L-ISO-01 |
| `scripts/gates/mysql-concurrency-sales-wave10-worker.mjs` | one MySQL session and production/raw actions | non-destructive connected-identity check; READY/GO protocol; bounded trace/observer facts; new exact production actions needed by cases | production handler semantics; raw/production classification | R01/R02/R04/R05 | M-R01..12, M-B01..07 |
| `server/test-utils/mysql-wave10-campaign-target.js` **new** | none | Wave-10-only config+connected identity verifier, grant digest, inventory, in-memory lease and safe report | shared Gate A guard | R02/R10 | L-GRD-01..08 |
| `server/test-utils/mysql-wave10-process-lifecycle.js` **new** | none | injectable clock/process-tree termination and runner state reducer | production process lifecycle | R03/R09 | L-RUN-01..10 |
| `scripts/gates/mysql-wave10-tap-transcript.mjs` **new** | none | Wave-10-only complete TAP transcript parser and assertion | shared `tap-summary.js`, hence Gate A behavior | R01/R09/R10 | L-TAP-01..09 |
| `server/test-utils/temp-db.js` | shared disposable DB handle | add an optional Wave 10 lifecycle callback used only by Wave 10 handles; default path byte-for-behavior unchanged | existing SQLite and Gate A callers | R02/R03/R10 | L-GRD-08, L-ISO-02 |
| `server/test-utils/wave10-mysql-acceptance-fixture.js` | common seed and four-count footprint | authoritative capacity reader; deterministic coordinator; typed projections; business-matrix builders | production facts/owners | R04/R05/R07/R08 | M-R01..12, M-BIZ-01..20 |
| `server/test-utils/wave10-mysql-schema-fixture.js` **new** | none | canonical snapshot capped after Wave 9, normalized cross-dialect metadata and connected row graph | migration implementations | R06 | M-MIG-01..08 |
| `server/mysql-sales-customer-wave10.integration.js` | fresh/parity/simulated upgrade/I-3/I-4 | formal fresh/upgrade/replay/equivalence using schema helper | Wave 9/10 migrations | R06 | M-MIG-01..08 |
| `server/mysql-sales-customer-wave10-concurrency.integration.js` | W10-R1..R12 | replace weak races/assertions with §37.39.6 matrix | production L0/L1-L8 | R04/R05/R07 | M-R01..12 |
| `server/mysql-sales-customer-wave10-gate-b.integration.js` | seven Gate B tests/markers | execute each case owner and emit marker from its typed result only | fixed ids and business contracts | R01/R04/R05/R07 | M-B01..07 |
| `server/mysql-sales-customer-wave10-business-matrix.integration.js` **new** | none | B-9/B-10/S14/Recognition Mode MySQL matrix | exemption gap; Finance authority | R08 | M-BIZ-01..20 |
| `scripts/mysql-sales-wave10-runners.test.js` | six source-contract tests | behavior tests for guard, lifecycle, board and isolation; retain only useful static checks | no MySQL connection | R01/R02/R03/R09/R10 | L-* |
| `scripts/testing/test-suites.js` | unconditional suite registry | no new entry expected: the existing local runner test remains registered | no real-MySQL file registration | R09/R10 | L-ISO-01 |
| `document.md`, `solution.md`, `log/<implementation-date>.md` | canonical records | append actual Implementation and verification evidence after authorization | historical records | R01..R10 | documentation check |

`package.json`, `README.md`, `scripts/gates/tap-summary.js`, every Gate A runner/fixture, production
Credit/Sales/Finance modules, `server/db.js`, `server/database/*`, migrations and schema files are
explicitly **not planned changes**. The three new helpers isolate Wave 10 safety and strictness so
the frozen Gate A execution contract is not silently changed. Existing package commands already
name the required protected entries.

### 37.39.3 Target Guard and destructive lease

#### 37.39.3.1 Future authorization inputs

The existing three destructive acknowledgements remain mandatory. A future separately authorized
preflight additionally supplies values obtained from that target, never guessed in code:

```text
ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID
ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER
ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256
ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY=MYSQL_8
ERP_MYSQL_WAVE10_INITIAL_INVENTORY=EMPTY_ONLY
```

The normalized grant digest sorts canonical `SHOW GRANTS FOR CURRENT_USER()` records before
SHA-256. Raw grants are neither logged nor passed to M-board. The verifier separately confirms the
bounded schema privileges required by bootstrap/reset and rejects an unapproved digest even when
the privileges would be sufficient.

#### 37.39.3.2 Verification order

```text
validate required env and exact password-free configured identity (no connection)
  -> open adapter using that immutable config
  -> SELECT DATABASE(), CURRENT_USER(), @@server_uuid, VERSION()
  -> normalize grants; compare approved digest and required bounded capabilities
  -> inventory TABLES/VIEWS/TRIGGERS/ROUTINES/EVENTS for DATABASE()
  -> require EMPTY_ONLY before the first DROP
  -> issue an in-memory random campaign lease bound to
       config identity + actual identity + UUID + grant digest + campaign id
  -> only then permit the first reset/bootstrap
```

Every later reset/cleanup reopens or uses a connection, repeats actual database/account/UUID/
version checks and verifies the lease binding. Grant digest is rechecked before each destructive
phase. Any mismatch returns a typed refusal and performs no DROP. Object identifiers remain
enumerated from the authorized schema, type-checked and identifier-validated; views precede base
tables, FK checks are restored in `finally`, and the database/schema itself is never dropped.

The initial non-empty case is not auto-recovered. It exits with a password-free inventory summary
and requires a new recovery authorization. After the empty-target lease exists, suite-created
objects are cleanup-eligible. This distinction prevents historical/pre-existing objects from being
silently classified as campaign residue.

#### 37.39.3.3 Child identity

Workers perform the same non-destructive actual-identity comparison before accepting commands.
They receive the authorization values unchanged plus the runner-generated non-secret campaign id;
they cannot grant a destructive lease. Destructive fixture cleanup is routed through the
Wave-10-only lifecycle callback and requires the parent-established lease facts. Secret-bearing
environment objects are never serialized to logs or worker replies.

### 37.39.4 Runner and Cleanup state machine

| State | Entry condition | Permitted next state | PASS allowed |
|---|---|---|---|
| `PREFLIGHT` | static env/config accepted | `IDENTITY_VERIFIED` or terminal refusal | no |
| `IDENTITY_VERIFIED` | connected identity+grants+EMPTY_ONLY confirmed; lease issued | `CLEANUP_RUNNING` for pre-suite reset | no |
| `SUITE_RUNNING` | reset zero and child spawned | `SUITE_PASSED`, `SUITE_FAILED`, `CHILD_TIMEOUT` | no |
| `SUITE_PASSED` | exit 0 + complete strict TAP + suite evidence valid | next pre-suite reset or final cleanup | no |
| `SUITE_FAILED` | spawn/exit/TAP/evidence failure | `CLEANUP_RUNNING` if no live child | no |
| `CHILD_TIMEOUT` | suite deadline elapsed | `CHILD_TERMINATION_PENDING` | no |
| `CHILD_TERMINATION_PENDING` | graceful tree stop requested | `CHILD_TERMINATION_CONFIRMED` or `CHILD_TERMINATION_FAILED` | no |
| `CHILD_TERMINATION_CONFIRMED` | process tree exit observed in bound | `CLEANUP_RUNNING` | no |
| `CHILD_TERMINATION_FAILED` | tree exit cannot be proven | terminal non-zero; cleanup `NOT_ATTEMPTED_CHILD_LIVE` | no |
| `CLEANUP_RUNNING` | identity+lease reverified and no live child | `CLEANUP_CONFIRMED` or `CLEANUP_FAILED` | no |
| `CLEANUP_CONFIRMED` | reset returned and adapter closed | `FINAL_ZERO_OBJECTS_CONFIRMED` after inventory | no |
| `CLEANUP_FAILED` | identity/reset/inventory/close failure | terminal non-zero | no |
| `FINAL_ZERO_OBJECTS_CONFIRMED` | all five object categories zero | board rendering then campaign completion | yes, if all suites passed |

Timeout first requests cooperative shutdown so workers roll back/close. The bounded escalation then
terminates the complete process tree: a POSIX process group when available and a Windows tree-kill
strategy behind the injected lifecycle interface. The runner waits on actual exit events, never a
sleep. If any descendant cannot be proven gone, it does not issue cleanup SQL and does not print a
zero-object or campaign PASS claim.

Only `SUITE_PASSED` advances to another suite. Spawn errors, non-zero exits, invalid TAP and invalid
case evidence fail fast and skip remaining suites, then clean up. Primary and cleanup failures are
preserved together; cleanup failure always produces non-zero exit.

### 37.39.5 Strict TAP and M-board evidence pipeline

#### 37.39.5.1 Wave 10 transcript contract

The new Wave-10-only parser consumes a complete captured transcript after child exit. It requires:

- one supported TAP version and exactly one complete top-level plan;
- each top-level test id appears exactly once and is covered by the plan;
- every `ok/not ok` record is syntactically complete; directives are parsed, not ignored;
- summary counters occur once and equal the parsed records and plan;
- `tests >= 1`, `pass == tests`, and fail/skip/cancelled/todo are zero;
- a finite non-negative duration and no trailing partial TAP record;
- child exit code zero.

The shared `tap-summary.js` remains unchanged to avoid changing frozen Gate A behavior. The Wave 10
runner uses only the stricter transcript object.

#### 37.39.5.2 Typed case evidence

Tests emit a single machine-readable line only after their case assertions finish:

```text
W10_GATE_B_EVIDENCE {"caseId":"B-M10","level":"PRODUCTION_SERIALIZED_OUTCOME",
  "suiteId":"gate-b-production","runId":"<campaign-id>","result":"PASS","digest":"<sha256>"}
```

The digest covers the normalized, secret-free case precondition and postcondition evidence. The
runner accepts only the current campaign id, owning suite and manifest-declared level. One case has
one accepted record. Unknown fields do not create cases; unknown case ids, duplicate ids, wrong
owners, wrong levels, malformed JSON or digest mismatch fail. Human-readable strings and source
regexes are never parsed as evidence.

Board rendering occurs only after all suite transcripts pass, the seven evidence records validate,
all children are confirmed exited, final cleanup succeeds and zero objects are confirmed. The
board itself is a projection of validated records, not a PASS source.

### 37.39.6 W10-R1–R12 concurrency design

#### 37.39.6.1 Common harness and authoritative capacity

Each business race uses Sessions A and B plus Coordinator/Observer C on independent
`CONNECTION_ID()` values. C takes a test-only raw hold on the existing L0 gate before A/B receive
GO. A/B invoke production entrypoints and the observer proves both are pending at the intended
coordination boundary. C releases; A/B then run under unchanged production `transaction()` and L0.
The raw hold is coordination evidence only. Cases needing a specific downstream observation add a
bounded case-specific raw hold without bypassing production L0.

Before C releases, a read-only authoritative evaluator computes for every involved scope:
effective Profile id/status/limit, canonical exposure components and total `E`, business date,
recognition mode, proposed deltas and `available`. The returned values, not seed constants, classify
BOTH_FIT/ONLY_ONE_FITS/NEITHER_FITS. The same cents-safe values are asserted against committed
post-state.

Common postconditions are: ceiling conservation, no partial business state, exact audit and
idempotency cardinality for winners, zero loser delta, replay equality without second effects,
no duplicate check-result scope or approval authority, and case-specific cleanup.

#### 37.39.6.2 Case matrix

| Test | Production A / B | Deterministic observation | Exact result | Projection |
|---|---|---|---|---|
| M-R01 / R-SAL-12 | `salesOrderAction(approve)` on two distinct SUBMITTED SOs, same customer — §37.39.6.3, corrected 2026-10-25; the former `evaluateCreditCheck`-pair contract is superseded | both queued behind C; run BOTH_FIT and ONLY_ONE_FITS subcases | BOTH_FIT=2 authoritative Sales commitments; ONLY_ONE_FITS=1 commitment+1 409 `CREDIT_CHECK_BLOCKED`; committed delta <= available | P-CREDIT, P-SALES, P-AUDIT-IDEM |
| M-R02 / R-SAL-13 | production Special Approval decision / `salesOrderAction(approve)` | both READY; seeded request created through production request entry | exactly one effective authority; the other is explicit conflict; never zero winners | P-CREDIT, P-APPROVAL, P-SALES, P-AUDIT-IDEM |
| M-R03 / R-SAL-14 | production Credit evaluation / Finance AR transition writer | both queued; order of L0 winner recorded | check components equal exact OLD or NEW canonical exposure; final stage counted once | P-CREDIT, P-SALES, P-FINANCE, P-AUDIT-IDEM |
| M-R04 / R-SAL-24 | Credit evaluation / production Profile version create | both queued; winning order recorded | all result rows and snapshot hashes equal one complete OLD or NEW version set | P-CREDIT, P-POLICY, P-AUDIT-IDEM |
| M-R05 | two salesperson SO approvals sharing aggregate | computed aggregate ONLY_ONE_FITS; both queued | exactly one economic commitment; shared aggregate ceiling conserved | P-CREDIT, P-SALES, P-AUDIT-IDEM |
| M-R06 | two same-salesperson SO approvals | computed aggregate BOTH_FIT and sub-limit ONLY_ONE_FITS | exactly one commitment; both ceilings conserved | P-CREDIT, P-SALES, P-AUDIT-IDEM |
| M-R07 | production aggregate-scope Special Approval decision / sub-limit-controlled SO approval | distinct scope rows proven before GO | aggregate authority cannot release mandatory sub-limit; SO path 409 with zero delta | P-CREDIT, P-APPROVAL, P-SALES, P-AUDIT-IDEM |
| M-R08 | dual-scope Credit evaluation / salesperson Profile version create | both queued; OLD/NEW ids+hashes captured | aggregate and salesperson result rows belong to one coherent version set | P-CREDIT, P-POLICY, P-AUDIT-IDEM |
| M-R09 | Credit evaluation of new SO / canonical transition setup already committed before race | fixture proves SO50 is extinguished and final unpaid AR50 exists; new SO20 | aggregate passes; sub-limit exposure=50, proposal=70>60 and blocks | P-CREDIT, P-SALES, P-FINANCE, P-AUDIT-IDEM |
| M-R10 | two production checks over one consolidated/ambiguous AR | ambiguous Finance lineage asserted before GO | aggregate counts full header; mandatory sub-limit is `BLOCK/UNPROVEN_ATTRIBUTION`; no guessed amount | P-CREDIT, P-FINANCE, P-AUDIT-IDEM |
| M-R11 | production prepayment-controlled SO action / Credit Check | C holds eligible Finance parent; observe first business waiter there and second at L0, then release | both settle without cycle; exact allowed outcome recorded; no partial facts | P-CREDIT, P-GATE, P-SALES, P-FINANCE, P-AUDIT-IDEM |
| M-R12 | N>=3 production checks reusing pre-created immutable snapshot | separate raw holder locks snapshot row while checks run after L0 coordination | all BOTH_FIT checks succeed and converge; none waits on/locks existing snapshot row | P-CREDIT, P-AUDIT-IDEM plus lock observation |

R9's SO-to-AR transition is completed through the canonical production lifecycle before the race;
directly inserting an APPROVED SO is insufficient. R10 creates the exact unsupported attribution
shape through canonical Finance/Sales source records. If a necessary canonical writer cannot
construct either shape, Implementation stops for a Design amendment rather than inserting a
counterfeit state.

#### 37.39.6.3 M-R01 Design Precision Correction (2026-10-25)

**Authorization and scope.** The user authorized one Design-only revision of the M-R01 contract
after the source audit recorded in `log/2026-10-25.md` under "Wave 10 Implementation Continuation".
No production code, test, runner, worker, manifest, fixture, schema, migration, package script,
`document.md`, `README.md` or `AGENTS.md` changed. MySQL was not contacted and no Gate ran.

**Superseded contract.** The M-R01 row in §37.39.6.2 previously required **two
`evaluateCreditCheck` calls** over two distinct proposed Sales commitments and expected
"BOTH_FIT=2 commits; ONLY_ONE_FITS=1 commit+1 409". That contract is **superseded** by this
subsection. The original row is preserved in §37.39.6.2 with an explicit supersession pointer. No
historical section, log entry, approved Requirement or prior acceptance record is deleted or
rewritten.

##### A. Why the former contract could not hold, and the audited production entry

The former entry was `evaluateCreditCheck()` — `server/modules/credit-check.js:1060-1104`. It is
the only public HTTP surface of the Credit engine and the only entry that accepts an arbitrary
`proposedDeltaCents`, which is why §36.8.3 W10-R1 was originally written as "Credit Check vs
Credit Check, same customer" — before the Wave 10 implementation made `approve` credit-controlled
(§37.19.1, §37.35.5). Four source facts disqualify it as the M-R01 entry:

| # | Source fact | Consequence |
|---|---|---|
| 1 | `evaluateCreditCheck()` calls only `evaluateCredit()` (`credit-check.js:1076-1090`) and writes `credit_check_results` + `audit_logs` evidence. It mutates no `sales_orders` row. | A successful manual check creates no authoritative Sales commitment. "one commits, one 409" is not expressible as a business outcome. |
| 2 | The authoritative exposure is `computeCreditExposure()` (`credit-check.js:385-494`), whose Sales stage is `readApprovedOrders()` — `SELECT ... FROM sales_orders WHERE customer_id=? AND status='APPROVED'` (`credit-check.js:224-228`). | Prior `credit_check_results` are not exposure. Two serialized manual checks read the same `E`, so both PASS whenever each independent `E + delta` fits, even when `deltaA + deltaB > available`. The required exactly-one commitment is unreachable through this entry. |
| 3 | A Credit Check takes no Sales business row lock (§36.3.4.1 C-2, §36.12). `evaluateCreditCheck` therefore never holds the SC91 transition lock. | R-SAL-12's canonical lock identity is "Credit Profile identity + SC91 transition-lock identity" (`document.md` §34.6). The former entry exercises only the first half. |
| 4 | `evaluateCreditCheck` runs with `consumeApprovals: false` (`credit-check.js:1089`). | It cannot consume a Special Approval, so it is not the full business decision path either. |

The audited entry is `salesOrderAction(db, req, res, actor, orderId, 'approve')` —
`server/modules/sales-orders.js:877-887` — which dispatches to `approveSalesOrder()`
(`sales-orders.js:799-875`). Its production sequence is:

```text
salesOrderAction('approve')
  :879  requireSalesPermission(actor, 'ORDERS_APPROVE')
  :883  Idempotency-Key required; :885 idempotencyReplay()
  :813  discoverSalesOrderApprovePlan()      read-only; status must be 'SUBMITTED',
                                             creator_id !== actor.id, sales-group scope
  :816  transaction(db, ...)                 server/db.js:2089-2130
        :2101  BEGIN IMMEDIATE
        :2121  L0 gate  SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE
        :819   L1     lockCreditPrepaymentParents()          credit-check.js:986-991
        :821   L2..L5 assertCreditAllowsBusinessAction()   credit-check.js:998-1012
                    stage 'SO_APPROVE'; proposedDeltaCents = plan.totalCents;
                    sourceRef { sourceType:'SALES_ORDER', sourceId: orderId }
                    credit-check.js:714-742  L1 skipped (caller holds it) /
                                             L2 POLICY_SCOPE FOR SHARE /
                                             L3 AGGREGATE anchor FOR UPDATE /
                                             L4 SALESPERSON anchor FOR UPDATE /
                                             L5 credit_profile FOR UPDATE
                    credit-check.js:745      the exposure is computed AFTER the locks
        :834   L8     SELECT * FROM sales_orders WHERE id=? FOR UPDATE
        :836-852       revalidate status / SOD / sales-group scope / plan fingerprint
        :854          UPDATE sales_orders SET status='APPROVED', reviewer_id=?, reviewed_at=?
        :856          saveIdempotency('SALES_ORDER_APPROVE')
        :857          audit('APPROVE','SALES_ORDER',orderId)
        :859          send(res, 200, { ok:true, id, action:'approve' })
```

**Why this operation forms and preserves the authoritative Sales commitment.**
`approveSalesOrder` is the operation that creates the commitment the Credit control governs: it
transitions `sales_orders.status` from `SUBMITTED` to `APPROVED` and stamps `reviewer_id` and
`reviewed_at` (`sales-orders.js:854`) — the exact row set that `readApprovedOrders()`
(`credit-check.js:224-228`) reads back as the approved Sales commitment, and the exact set that
`computeCreditExposure()` counts as `approvedSoCommitmentCents` (`credit-check.js:438-456`). It
therefore takes both halves of R-SAL-12's canonical lock identity: the Credit Profile identity
(`credit_profile ... FOR UPDATE`, `credit-check.js:738-742`) and the SC91 transition lock
(`sales_orders ... FOR UPDATE`, `sales-orders.js:834`).

This is the frozen intent of §29.25.2, unchanged by this correction: "whichever wins blocks the
other at the anchor row lock. The blocked transaction reads the updated state (which now includes
the winner's committed Sales source fact) and re-evaluates against it." The correction aligns the
M-R01 case with that intent; it does not change it.

##### B. Real capacity precondition

`available = effective credit limit - canonical current exposure`, computed from committed
authoritative facts **before** the coordinated start and never from seed constants
(W10-AIR-R05, §36.8.1, §37.39.6.1).

| Input | Authoritative source | Note |
|---|---|---|
| Effective Credit Profile | the `credit_profile` row resolved by the Wave 9 effective-date resolver `resolveEffectiveCreditProfile()` (`server/modules/credit-profile.js:44`), for the credit object and scope, `status='ACTIVE'`, `effective_from<=businessDate` | `resolveApplicableCreditScopes()` (`credit-check.js:173-218`) fails closed on a non-ACTIVE row; it never falls back to an older ACTIVE version nor to the aggregate scope (B-9 O2). |
| Effective limit | `credit_profile.credit_limit_cents` | A NULL / unbounded limit is not a bounded-capacity fixture: the case is explicitly unconstructible and must never be converted into PASS (W10-AIR-R05). |
| Canonical exposure `E` | `computeCreditExposure()` (`credit-check.js:385-494`), aggregate components `approvedSoCommitmentCents + deliveredNotSettledCents + arOpenCents - eligiblePrepaymentCents` | Derived inside the check transaction from approved Sales Orders, confirmed Deliveries and open AR. There is no persisted exposure cache (S14, R-SAL-23). |
| Business date | `order.order_date` of the seeded order (`sales-orders.js:785`) | Must satisfy the exposure-window precondition below. |
| Recognition mode | `resolveRecognitionPolicy(db,'AR','SALES_DELIVERY',null,businessDate).mode` (`sales-orders.js:827`) | A rule whose `recognition_mode` does not match does not apply (`credit-check.js:513-516`). |
| `amountA` / `amountB` | `sales_orders.total_cents` of the two SUBMITTED orders | The approve path uses `proposedDeltaCents: plan.totalCents` (`sales-orders.js:826`), so the delta is the order total and never a test-supplied number. |
| Effective rule for stage `SO_APPROVE` | `credit_check_rules WHERE business_stage='SO_APPROVE' AND status='ACTIVE' AND effective_from<=businessDate` (`credit-check.js:508-511`) | A stage with no applicable effective rule is **not credit-controlled** (`credit-check.js:667-675`) and leaves no evidence. Without an effective `SO_APPROVE` rule the M-R01 case is unconstructible, not PASS. |
| Other applicable constraints | mandatory sub-limit scope, ambiguous attribution, overdue-day policy | `UNPROVEN_ATTRIBUTION` and `OVERDUE_POLICY_UNDEFINED` force a mandatory BLOCK for reasons unrelated to capacity (`credit-check.js:813-821`); they are a different race (W10-R10) and are not M-R01's expected refusal. |

The test inputs satisfy:

```text
amountA <= available
amountB <= available
amountA + amountB >  available      (ONLY_ONE_FITS subcase)
amountA + amountB <= available      (BOTH_FIT subcase)
```

These relations hold only while both orders share one credit-control scope, both amounts are
positive, and no third party changes the scope between the computation and the coordinated start.
If the real production rule adds a further restriction, the precondition is adjusted to the real
rule; the outcome is never inferred from the arithmetic alone. When the precondition cannot be
proven from actual data, "exactly one fails" is **not** asserted and the case fails closed.

**Exposure-window precondition (load-bearing).** `readApprovedOrders()` filters
`SUBSTR(reviewed_at,1,10)<=businessDate` (`credit-check.js:225-227`), and the winner's
`reviewed_at` is the wall clock at commit (`sales-orders.js:854`). The winner's freshly created
commitment is therefore visible to the loser's exposure read only when
`date(reviewed_at) <= businessDate = order.order_date`. If the campaign runs on a later calendar
date than the seeded `order_date`, the winner's APPROVED order falls outside the loser's exposure
window and the ONLY_ONE_FITS subcase would observe two commits. The fixture must therefore derive
`order_date` from the actual run date, or assert `order_date >= date(reviewed_at)`, and must not
rely on a fixed date constant.

**Isolation precondition (load-bearing).** The loser's exposure re-read must be a fresh read that
includes the winner's committed commitment. Production MySQL sessions run at
`SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED`
(`server/database/mysql-worker.js:30,107`), so the loser's post-lock `computeCreditExposure()`
statement sees the winner's committed `sales_orders` row. Under REPEATABLE READ the same statement
would use the transaction's earlier consistent snapshot, would not see the winner's commitment, and
the ONLY_ONE_FITS proof would be invalid. §37.17 already declares that "any Design text asserting
otherwise is incorrect and is superseded here"; the "default engine isolation (REPEATABLE READ)"
parenthetical in §36.8 is corrected accordingly.

##### C. Independent sessions and concurrency coordination

- Two independent MySQL sessions, proved by two distinct `CONNECTION_ID()` values registered
  before the race (§37.39.6.1).
- Each session issues **one** real production request through the production handler
  `salesOrderAction(..., 'approve')`, with its own `Idempotency-Key`. Authorization, plan
  discovery, transaction, lock chain, revalidation and commit or refusal are performed by
  production code only.
- Coordinator C takes a test-only raw hold on the existing L0 gate row
  (`mysql_transaction_gates`, `gate_id=1`) and A/B are observed pending at that boundary before C
  releases. The hold is coordination evidence only (§37.39.6.1, W10-AIR-R04); it never substitutes
  for a production business result.
- After the release, the two production transactions serialize on the production L0 gate
  (`server/db.js:2121`) and then on the Credit chain's L3 AGGREGATE anchor, L4 SALESPERSON anchor
  and L5 Credit Profile locks (`credit-check.js:725-742`). The loser therefore re-reads the
  authoritative exposure **after** the winner committed and re-evaluates against it (§29.25.2).
- A raw wait observation on the anchor row may be captured as `RAW_ROW_LEVEL_LOCK_ORDER`
  supplementary lock-behaviour diagnostic only. It is never the case's business outcome and never
  an M-board PASS source.
- Timeout handling: a session that does not return within the bounded deadline fails the case
  with a typed, secret-free diagnostic. It is never downgraded to skip/todo or a warning PASS.
- Prohibited: direct fixture writes that fabricate the commitment, hand-written exposure rows,
  manually released credit capacity, forged responses, or a raw-lock probe used in place of the
  production business result. The two SUBMITTED orders are declared setup reference facts; their
  APPROVED commitment is created only by the production approve path.

##### D. Acceptance results

With the capacity precondition proven and no third-party interference:

1. Exactly one business commitment succeeds. The winner's `sales_orders.status='APPROVED'` with
   `reviewer_id` and `reviewed_at` set is committed, and the response is HTTP 200 with body
   `{ ok: true, id: <orderId>, action: 'approve' }` (`sales-orders.js:855,859`).
2. The other operation is refused by the existing business contract with **HTTP 409** and the
   existing production error contract — `code: 'CREDIT_CHECK_BLOCKED'`, `decision: 'BLOCK'`,
   `reasonCodes` containing `OVER_LIMIT`, together with `checkGroupId` and `scopeResults`
   (`credit-check.js:1002-1011`; the over-limit reason code is produced at
   `credit-check.js:830-837`). No new error code, message or HTTP status is invented.
3. Never two successes that together exceed the ceiling: the committed aggregate commitment delta
   must be `<= available`, and in the ONLY_ONE_FITS subcase the two order totals must together
   exceed `available`.
4. The following are **not** the expected credit-race refusal. They fail the case instead:
   - HTTP 403 from permission, separation-of-duties or sales-group scope (`ORDERS_APPROVE`
     missing, a creator approving their own order, `SALES_GROUP_SCOPE_DENIED`);
   - HTTP 409 `只有待审批订单可以处理` (invalid source state) or `SALES_ORDER_APPROVE_PLAN_STALE`
     (stale plan);
   - HTTP 409 `CREDIT_PROFILE_MISSING`, `CREDIT_PROFILE_NOT_ENFORCEABLE`, `P5_SUB_LIMIT_ONLY`,
     `CREDIT_CREDIT_OBJECT_AMBIGUOUS`;
   - HTTP 409 `CREDIT_EXPOSURE_SOURCE_INCONSISTENT` (broken Sales/Finance lineage);
   - HTTP 503 `SALES_ORDER_APPROVE_RETRY_EXHAUSTED`.
   These are setup, authorization or environment failures and must never be reported as the
   expected credit contention refusal.

##### E. Complete persistence projection

Declared from the real tables and the real production write path (§37.39.10). A table that this
path does not write is stated explicitly as not applicable; no field and no table is invented.

| Family | Tables | Winner (committed) | Refused transaction (rolled back) |
|---|---|---|---|
| P-SALES | `sales_orders`, `sales_order_items` | `status` `SUBMITTED` -> `APPROVED`; `reviewer_id` and `reviewed_at` set; `total_cents`, `salesperson_id`, `commercial_close_state`, `effective_version` unchanged; items unchanged | every field identical to the pre-race snapshot; `status` stays `SUBMITTED`; `reviewer_id` and `reviewed_at` stay NULL |
| P-CREDIT | `credit_check_results` | exactly one row per applicable scope (`CUSTOMER_AGGREGATE`, `SALESPERSON_SUB_LIMIT`), `stage='SO_APPROVE'`, `decision='PASS'`, `sales_order_id` = the winner's order, `proposed_delta_cents` = the order total, `reason_codes_json` containing `WITHIN_LIMIT` | **zero rows** — the result rows are written inside the same transaction (`credit-check.js:913-933`) and roll back with the refusal |
| P-CREDIT | `credit_policy_snapshots` | one snapshot per scope, or the pre-existing identical snapshot reused by insert-or-select | no new snapshot row |
| P-CREDIT | `credit_profile`, `credit_check_rules`, `credit_parameters` | unchanged — this path only reads them (FOR UPDATE without UPDATE) | unchanged |
| P-APPROVAL | `credit_special_approval` | unchanged — the BLOCK path consumes no approval; approval consumption applies only to a `SPECIAL_APPROVAL_REQUIRED` decision (`credit-check.js:883-907`) | unchanged |
| P-GATE | `sales_prepayment_requirements`, `sales_prepayment_gate_results` | **not applicable to this path** — the approve path invokes no Gate phase (`sales-orders.js:817-819`); the Credit Check owns the L1 lock instead (`credit-check.js:714-716`) | not applicable |
| P-FINANCE | `account_receivables`, `payment_collections`, `settlement_unapplied_balances`, `settlement_reversals`, `settlement_reversal_items`, `credit_reversal_components`, `finance_invoice_source_links` | unchanged — this path writes no Finance row. `settlement_unapplied_balances` must be proven to hold **zero** OPEN CUSTOMER/PREPAYMENT rows for the fixture customer, because an eligible prepayment offsets the aggregate exposure (`credit-check.js:749-758`) and would change `available` | unchanged |
| P-AUDIT-IDEM | `audit_logs` | one `EVALUATE`/`CREDIT_CHECK` row for the winning check group (`credit-check.js:936-952`) and one `APPROVE`/`SALES_ORDER` row (`sales-orders.js:857`) | **zero rows** — the Credit `EVALUATE` audit and the `APPROVE` audit are both written inside the rolled-back transaction |
| P-AUDIT-IDEM | `idempotency_records` | exactly one `SALES_ORDER_APPROVE` record for the winner's key and fingerprint | **none** — the refusal is raised before `saveIdempotency` (`sales-orders.js:856`) |

The refused transaction's forbidden delta across the whole declared union must be **empty**, not
merely an unchanged row count (W10-AIR-R07). The winner's delta must be exactly the committed
Sales commitment plus its Credit, audit and idempotency facts. An exact replay of the winner's
`Idempotency-Key` must return the stored result with `replayed: true` and produce no second
effect (`sales-orders.js:885`).

##### F. Evidence level

```text
M-R01 primary evidence level      PRODUCTION_SERIALIZED_OUTCOME
M-R01 supplementary diagnostic    RAW_ROW_LEVEL_LOCK_ORDER (anchor / profile wait detail only)
M-R01 never sufficient            STATIC_INTENT
```

The M-R01 PASS marker is emitted only after the production responses, the committed authoritative
rows and the complete before/after projection have all been asserted (§37.39.5.2). The Gate B
final M-board is generated by real execution evidence and is never hard-coded PASS. This
subsection changes no other M-R case, no Gate B case, no evidence level, no runner, worker,
manifest or fixture ownership, and no Requirement.

**Preserved boundaries.** Gate A's frozen contract, runner and accepted evidence are untouched.
Wave 9's frozen semantics are untouched. B-9 O2, B-10 O1, the S14 Mode B/C bounded repair
contract, the Credit Profile effective-date resolver, permissions, status history and rating
provenance, the Finance `open_amount_cents` authority, L0 and the L1-L8 lock order, MySQL READ
COMMITTED, the existing transaction, idempotency and error contracts, the other six Gate B cases
and their evidence levels, and the Wave 11 / Wave 12 scope boundaries are all unchanged. No new
production business rule, credit reservation or capacity mechanism, database schema, migration or
version change is introduced by this correction.

**Design status: `M_R01_DESIGN_PRECISION_CORRECTION_COMPLETE_AWAITING_IMPLEMENTATION_AUTHORIZATION`.**
**Stop state: `IMPLEMENTATION_NOT_AUTHORIZED`; `MYSQL_ACCEPTANCE_NOT_RUN`; `GATE_A_FROZEN`;
`GATE_B_NOT_RUN`; `WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED`; `WAVE11_NOT_STARTED`;
`WAVE12_NOT_STARTED`; `NO_GIT_WRITE`; `NO_DATABASE_OPERATION`.**

### 37.39.7 Gate B case design

| Test/case | Primary level | Actual entry and precondition | Required result and unique marker point |
|---|---|---|---|
| M-B01 B-COMPOSE | STATIC_INTENT | bounded source/AST contract over production composition | exact L1?->L2->L3->L4->L5->L6/L7->L8 intent; marker after AST assertions only; no runtime claim |
| M-B02 B-M9 | PRODUCTION_SERIALIZED_OUTCOME | manual `evaluateCreditCheck` and `salesOrderAction(submit)` on the same DRAFT order; distinct sessions queued by C | exactly one Sales commitment, submit occurs once, any independent check evidence is coherent/idempotent; no duplicate exposure; marker after persistent projection |
| M-B03 B-M10 | PRODUCTION_SERIALIZED_OUTCOME | two salesperson production approvals; actual aggregate ONLY_ONE_FITS | exactly one commitment and aggregate conservation; marker cannot reuse R5 text/output |
| M-B04 B-M11 | PRODUCTION_SERIALIZED_OUTCOME | production Profile mutation vs active Credit Check | complete OLD or NEW snapshot/version set; marker after both outcomes and rows verified |
| M-B05 B-M12 | PRODUCTION_SERIALIZED_OUTCOME | production Special Approval decision vs policy mutation; request seeded by production path | approval is bound to its source snapshot or explicitly rejected after revalidation; no mixed policy authority |
| M-B06 B-M15 | PRODUCTION_SERIALIZED_OUTCOME | empty eligible prepayment-parent set proven; two salesperson production approvals; computed aggregate ONLY_ONE_FITS | exactly one commits; optional RAW wait detail is supplemental and emits no B-M15 PASS marker |
| M-B07 B-M19C | PRODUCTION_SERIALIZED_OUTCOME | no eligible prepayment parent; real production Credit entry; mandatory Profile genuinely missing | the production entry rejects at the pre-lock missing-Profile guard with the existing `CREDIT_PROFILE_MISSING` contract; a bounded trace confirms that actual stop boundary and makes no L2-L5-reached claim; the complete before/after projection proves zero prohibited persistent effects; marker only after response, trace and projection assertions |

For B-M19C, the production trace is captured by a test-side adapter proxy/worker trace that records
only normalized statement classes and table identities. The real production entry must return
`CREDIT_PROFILE_MISSING`, and the trace must show that execution stopped at the actual missing-
Profile guard before L2-L5. It must not acquire additional L2-L5 locks solely for evidence, change
the production invocation/lock order, fabricate a trace or substitute static source matching for
the runtime result. This trace neither changes production code nor claims RAW row-lock order.

The authoritative before/after projection must prove that the rejection creates no successful
Credit Check result, business mutation, audit fact, Special Approval consumption or approval-state
mutation, or idempotency success fact attributable to a successful Credit Check. It also includes
every additional table/field required by W10-AIR-R07 and the exact production entry point. The
M-board accepts the B-M19C production marker only after the production-path error, persistent-state
projection and truthful pre-lock trace have all passed.

A genuinely missing mandatory Profile remains distinct from an effective but non-`ACTIVE` Profile,
which retains `CREDIT_PROFILE_NOT_ENFORCEABLE`; a Profile that exists but is not applicable retains
its existing fail-closed contract; authorization and other business rejections remain separate.
B-9 SUSPENDED/CLOSED belongs to the business matrix, not a relabeling of B-M19C's approved missing-
Profile contract.

### 37.39.8 Migration, parity and upgrade fixture

#### 37.39.8.1 Canonical shapes

`wave10-mysql-schema-fixture.js` calls `captureSqliteSnapshot()` using a test-only snapshot factory,
then removes exactly the two `SALES_WAVE10_TABLES` definitions and asserts that the remaining Sales
registry shape contains all `SALES_WAVE9_TABLES` and no Wave 10/11 Credit table. This derives the
Wave 9 source metadata from the real canonical SQLite bootstrap rather than handwritten DDL. It
does not alter `createDatabase()`.

The upgrade flow is:

```text
runner EMPTY_ONLY reset and identity lease
  -> capture canonical SQLite snapshot
  -> derive and validate Wave-9-bounded snapshot
  -> bootstrapMySql(adapter, wave9Snapshot) on empty target
  -> seed connected six-table Wave 9 graph
  -> runSalesCustomerMigrations(adapter, registry steps wave<=10)
  -> repeat the same ordered registry
  -> compare rows and normalized metadata
```

Filtering uses the exported canonical registry and runner; migration functions are not copied.
Fresh flow independently calls production `createDatabase(config)` on an empty target. The suite
captures normalized eight-table metadata from both flows and deep-compares it.

#### 37.39.8.2 Metadata normalization and tests

Normalization maps the SQLite logical affinity contract to approved MySQL physical families while
retaining ordered column name, logical family, nullability, normalized default, PK ordinal, FK
target/on-update/on-delete, checks, index uniqueness/order and InnoDB/collation requirements.

```text
M-MIG-01 fresh production bootstrap creates exactly Wave 10's two additions
M-MIG-02 actual SQLite source vs MySQL target full six-table metadata parity
M-MIG-03 Wave-9-bounded snapshot -> formal ordered Wave 10 registry upgrade
M-MIG-04 repeated fresh initialization is idempotent
M-MIG-05 repeated formal registry upgrade is idempotent
M-MIG-06 fresh and upgraded eight-table normalized metadata are equal
M-MIG-07 I-4 connected rows, NULL/boundary values and exact pre/post values survive
M-MIG-08 I-3 dynamically enumerates every actual FK and finds zero orphans
```

Any metadata query failure, unknown mapping or missing constraint fails with a structured diff.
No production history inference is made; `LEGACY_DATA_EVIDENCE_PENDING` stays OPEN.

### 37.39.9 B-9/B-10/S14/Recognition Mode business matrix

The new protected suite is added to `WAVE10_MYSQL_SUITES`, never FAST/FULL/HEAVY:

| Tests | Setup and production assertion |
|---|---|
| M-BIZ-01..04 B-9 | ACTIVE succeeds; SUSPENDED and CLOSED each return `CREDIT_PROFILE_NOT_ENFORCEABLE`; current non-ACTIVE does not fall back to old ACTIVE or aggregate; Special Approval cannot bypass; P-CREDIT/P-SALES zero delta on refusal |
| M-BIZ-05..08 B-10 | unresolved old approved SO remains; arbitrary date advance changes nothing; partial canonical transition releases only transitioned cents; open/overdue AR is counted once until canonical settlement |
| M-BIZ-09..15 S14 Mode B/C | one and partial invoice; partial collection; multiple deliveries; one salesperson exact allocation; multiple-salesperson ambiguous remaining AR; missing/conflicting link fails closed; aggregate conservation and no stage double-count |
| M-BIZ-16..20 Recognition | global rule; exact-mode rule; nonmatching-only -> unenforced/no rows; no rule -> unenforced/no rows; strongest applicable outcome and mandatory BLOCK rollback |

Every setup uses canonical Sales/Finance writers where they exist. Direct fixture DML is allowed
only for immutable reference/setup facts whose production creation is outside the case, and must be
declared. Source lineage is never synthesized by a proportional/FIFO/equal/residual algorithm.
The explicit exemption row asserts only that no selector exists and no exemption is applied; it
does not claim or add support.

### 37.39.10 Persistent projection design

Projection rows are sorted objects with explicit selected fields; volatile timestamps may be
normalized only when the contract does not compare them. Missing tables/columns fail.

| Projection | Tables and minimum fields |
|---|---|
| P-CREDIT | `credit_check_results`: id/group/scope/decision/exposure/proposed/available/snapshot/profile hashes/source; `credit_policy_snapshots`: identity+all hashes; relevant anchor/profile/rule/parameter identities and versions |
| P-APPROVAL | `credit_special_approval`: id/source result+group/scope/snapshot/ceiling/expiry/decision/consumer; no duplicate effective authority |
| P-GATE | `sales_prepayment_requirements` and `sales_prepayment_gate_results`: order/stage/snapshot/decision/required/eligible/applied/refunded/override identities |
| P-SALES | `sales_orders`: id/status/total/salesperson/version/review fields; relevant items and delivery/invoice source identities and amounts |
| P-FINANCE | `account_receivables`: id/source/customer/original/open/status; settlement/application rows; `settlement_unapplied_balances`; `finance_invoice_source_links`: invoice/source/line/allocation |
| P-AUDIT-IDEM | relevant `audit_logs`: id/action/entity/user/detail digest; `idempotency_records`: operation/key/fingerprint/status/result digest |

Each M-R, M-B and rejection-capable M-BIZ row declares the union shown in its test definition.
Snapshot before, winner delta, loser delta, final state and exact replay state are compared
separately. A rejection PASS requires an empty forbidden delta across the complete declared union,
not merely unchanged counts.

### 37.39.11 Local behavior test design

All tests below use fake adapters, fake child processes, injected clocks and pure reducers. They
open no database and remain in the existing registered local test file unless implementation size
requires a separately approved split.

```text
L-GRD-01 missing destructive acknowledgements refused before adapter creation
L-GRD-02 config identity mismatch refused
L-GRD-03 DATABASE/CURRENT_USER/UUID/version/grant mismatch each refused before DROP
L-GRD-04 first non-empty inventory refused and no exec(DROP)
L-GRD-05 exact empty identity issues lease with secret-free report
L-GRD-06 identity drift before reset/cleanup revokes lease
L-GRD-07 identifier/type rejection and views-before-tables/FK restore
L-GRD-08 Wave 10 temp lifecycle uses verifier; default temp-db behavior unchanged

L-RUN-01 success state path reaches final zero then board
L-RUN-02 spawn error -> cleanup -> non-zero
L-RUN-03 child non-zero -> cleanup -> non-zero
L-RUN-04 timeout -> graceful termination confirmed -> cleanup
L-RUN-05 timeout -> forced tree termination confirmed -> cleanup
L-RUN-06 termination unconfirmed -> no cleanup SQL and non-zero
L-RUN-07 cleanup failure blocks board and returns non-zero
L-RUN-08 final inventory non-zero blocks board
L-RUN-09 primary+cleanup errors are both retained
L-RUN-10 remaining suites do not start after first failure

L-TAP-01 valid complete transcript accepted
L-TAP-02..09 missing/duplicate plan, truncated record, counter mismatch, zero tests,
             nonzero fail, skip/cancel/todo and trailing partial record rejected

L-MBR-01 valid seven owned typed records accepted
L-MBR-02..07 missing, duplicate, extra, wrong level, wrong suite/run id and digest mismatch rejected
L-ISO-01 Wave 10 entry graphs contain no Gate A/legacy suite
L-ISO-02 real MySQL suites remain outside FAST/FULL/HEAVY and shared Gate A helpers are unchanged
```

Static source checks may remain for command mapping and forbidden imports, but no source string is
accepted as lifecycle, TAP, cleanup or production outcome evidence.

### 37.39.12 Design acceptance matrix

| Scope | Requirement | Design | Future files | Future tests | OPEN fact | Separate MySQL authorization |
|---|---|---|---|---|---|---|
| W10-AUD-001 | R01 | §§37.39.5, .7 | manifest, Gate B runner/test, worker | L-MBR-*, M-B01..07 | runtime markers/results | yes |
| W10-AUD-002 | R02 | §37.39.3 | new target helper, runner support, worker, temp-db | L-GRD-* | UUID/account/grant/inventory values | yes |
| W10-AUD-003 | R03 | §37.39.4 | runner support, new lifecycle helper | L-RUN-* | platform tree termination behavior | no for local; yes for campaign |
| W10-AUD-004 | R04 | §37.39.6 | concurrency suite, worker, fixture | M-R01..12 | actual waits/outcomes | yes |
| W10-AUD-005 | R05 | §§37.39.6.1, .7 | fixture, concurrency/Gate B suites | M-R01/R05/R06, M-B03/B06 | actual canonical E | yes |
| W10-AUD-006 | R06 | §37.39.8 | migration suite, new schema helper | M-MIG-01..08 | actual MySQL metadata/results | yes |
| W10-AUD-007 | R07 | §37.39.10 | fixture and all business suites | projections in M-R/M-B/M-BIZ | actual persistent deltas | yes |
| W10-AUD-008 | R08 | §37.39.9 | manifest, new business suite, fixture | M-BIZ-01..20 | exemption gap; actual outcomes | yes |
| W10-AUD-009 | R09 | §§37.39.4, .5, .11 | runner support, new TAP/lifecycle helpers, local test | L-RUN/TAP/MBR/ISO | none for local behavior | no for local; yes for campaign |
| Freeze | R10 | §§37.39.1, .2, .13 | no Gate A/Wave 9 production file | L-ISO-* | user Acceptance/Freeze | yes for Wave 10 only |

Design acceptance requires every local L-test to pass after Implementation, every MySQL M-test to
remain protected and NOT_RUN until separately authorized, `git diff --check`, the appropriate
local regression/build gates, and an external read-only re-audit before campaign authorization.

### 37.39.13 Error, compatibility, rollback and hard stop

- Guard, lifecycle, TAP, case evidence, projection and metadata errors are typed, secret-free and
  terminal for the campaign. They never downgrade to skip/todo or a warning PASS.
- Implementation rollback consists only of reverting the bounded test-infrastructure changes; no
  production data rollback or migration rollback is authorized or required by this Design.
- L0, L1-L8, READ COMMITTED, Finance authority, production handlers, schema/migrations,
  permissions, states, audit and idempotency semantics remain untouched.
- Gate A runners, fixtures, evidence and freeze record remain untouched. The shared TAP helper and
  existing disposable-target guard retain their behavior; Wave 10 adds isolated strict layers.
- Wave 9 is read only as a canonical schema source for a test snapshot. Its frozen migration and
  business contracts are not modified.
- `LEGACY_DATA_EVIDENCE_PENDING` and
  `RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN` remain OPEN.
- Wave 11 and Wave 12 remain unstarted. No Acceptance or Freeze follows from Design or local tests.

No external database fact is asserted here. Server UUID, actual account, grant digest, inventory,
lock waits, migration results, persistent outcomes, cleanup and M-board remain
`OPEN — REQUIRES SEPARATE AUTHORIZATION`.

**Design status: `WAVE10_MYSQL_ACCEPTANCE_REMEDIATION_DESIGN_READY_FOR_USER_APPROVAL`.**

**Stop state: `IMPLEMENTATION_NOT_AUTHORIZED`; `MYSQL_ACCEPTANCE_NOT_RUN`; `GATE_A_FROZEN`;
`WAVE11_NOT_STARTED`; `WAVE12_NOT_STARTED`.**

## 37.41 Wave 10 MySQL least-privilege readiness and Finance View parity design (2026-10-25)

### 37.41.1 Authorization and boundaries

This Design implements the approved `document.md` W10-LPR-R01..R04 requirements under the user's
explicit consecutive-stage authorization. Gate A files and behavior, business semantics, schema
tables, Finance authority, Wave 9 and Wave 11/12 remain unchanged. Design completion proceeds to
Implementation solely because that authorization expressly includes it; real MySQL Acceptance is
still a later hard stop.

### 37.41.2 Guard responsibility and verification flow

`server/test-utils/mysql-wave10-campaign-target.js` owns a pure exact-grant validator. Grant lines
are whitespace-normalized and sorted for the existing SHA-256 fingerprint. Validation classifies
each line as: permitted global `USAGE`; exact target-schema privilege set; one of three exact
Performance Schema table reads; or forbidden. `WITH GRANT OPTION`, role/default-role statements,
unknown lines, unrelated objects, `ALL PRIVILEGES`, extra/missing privileges and all other global
static/dynamic authority fail closed. Schema comparison is case-insensitive while the trusted
fingerprint remains an exact normalized-text digest supplied through the existing environment
contract.

The connected verification order remains static disposable-target authorization, identity query,
database/account/UUID/version, independently supplied fingerprint, exact least-privilege contract,
then initial inventory at lease issuance. No current grant is written into trusted configuration.

### 37.41.3 canonical View initialization

`server/modules/finance-open-item-effect-view.js` exports the canonical View name/definition only
for behavior verification and keeps `ensureFinanceOpenItemEffectsView()` as the sole writer. After
dependencies exist, it removes a legacy same-name table defensively, drops an existing View and
recreates the canonical definition. This makes fresh, repeated and stale-definition upgrade paths
convergent on both SQLite and MySQL; any failure is wrapped and propagated so boot closes the
adapter.

`server/db.js#createDatabase()` calls the helper on the live MySQL adapter after snapshot bootstrap
and before the idempotent Sales migration replay. Snapshot capture remains table-only. The existing
cleanup inventory already identifies `VIEW` and drops Views before base tables, so no cleanup
algorithm changes.

### 37.41.4 tests and verification

The existing local Wave 10 runner suite receives injected/fake-adapter behavior cases for exact
grants, every missing privilege, global static/dynamic excess, grant option, roles, unrelated scope,
identity/fingerprint and inventory. A local SQLite behavior test proves View first creation,
repeated convergence, stale replacement, dependency-derived rows and canonical definition; source
contract checks prove the live MySQL call placement and frozen Gate A hash/content remains unchanged.
Existing cleanup-order coverage is retained.

Verification clears all MySQL credentials, reset/destructive/campaign variables in each child
process, then runs syntax, focused Guard/View and related Wave 9/10/Finance suites, FAST, FULL,
build and `git diff --check`. HEAVY and every `test:mysql*` command remain prohibited.

### 37.41.5 dedicated account and read-only preflight

After local PASS, the existing privileged connection is used first only to inspect whether
`modern_erp_wave10@127.0.0.1` exists and has roles/grants. If absent, a cryptographically random
password held only in process memory creates that exact account. If present, remediation proceeds
only when its grants prove it is dedicated. Account statements are restricted to that account:
revoke existing authority if required, grant the exact target-schema set and the three exact
Performance Schema reads, with no delegation. The old account is untouched.

The same process then connects as the dedicated account and performs only identity, grants/digest,
role/excess, Performance Schema reads, own PROCESSLIST, five-category inventory and Guard
verification. It sends no target-schema DDL/DML/bootstrap/migration/reset/cleanup. Credentials are
never printed, logged or committed. If no approved durable secret facility is available, the
ephemeral password is not persisted and this limitation is reported before future Acceptance.

Rollback for this bounded account operation is account-only and requires separate authorization;
there is no product-schema rollback because no product-schema mutation is permitted here.

**Design status: `WAVE10_MYSQL_LEAST_PRIVILEGE_AND_VIEW_PARITY_DESIGN_COMPLETE_IMPLEMENTATION_AUTHORIZED`.**

## 37.43 Wave 10 MySQL Acceptance blocker local remediation (2026-10-25)

### 37.43.0 Authorization and boundary

The user authorized a local, source-level remediation of the failure classes recorded in §37.40.9,
a full local regression and the documentation synchronization. No real MySQL campaign, Gate A,
Gate B or Wave 10 Acceptance execution was authorized, and no DDL/DML, migration, reset, DROP,
cleanup, account or grant change was authorized. The protected contracts are unchanged: the frozen
Gate A contract and runner, the Wave 9 business semantics and frozen Schema, the L0 transaction
gate and the L1–L8 lock order, the Finance monetary authority, the Credit Profile status fence,
the idempotency contract, the MySQL `READ COMMITTED` session isolation, the SQLite behavior, the
seven Gate B cases with their owners, typed markers and evidence levels, and the Wave 11 / Wave 12
scope boundaries. No Wave 11 or Wave 12 work was started, and no Git write operation occurred.

### 37.43.1 Audit — the five failure classes and their root causes

**A. One root cause behind seven of the eight Gate B failures.** The Wave 10 acceptance fixture
never installed the Wave 1 SC01 `sales_parameters` SYSTEM row. `resolveSalesParameters()`
(`server/modules/sales-parameters.js:97`) is fail-closed by the approved Requirement
(document.md §29.4.5, SC01): with no active SYSTEM row it throws
`HttpError(409, 'Sales 系统参数缺失或未启用', { code: 'SALES_PARAMETER_UNAVAILABLE' })`.

- `createSalesOrderCanonical` reaches it through `server/modules/sales-commercial-foundation.js:258`,
  which is why M-R03 and M-R09 failed with the 409 directly.
- `discoverSalesOrderApprovePlan()` (`server/modules/sales-orders.js:766`) resolves the Sales Group
  scope through `assertGroupScope()` → `resolveSalesParameters()` at line 773. That is the
  read-only approve discovery which runs **before** `transaction()`. The approve contender
  therefore never reached the L0 gate and never became pending on it, so
  `waitForWave10Waiters()` could not observe any wait. The bounded timeout then reported
  `WAVE10_WAIT_EVIDENCE_UNAVAILABLE` and masked the real 409 for M-R01, M-R02, M-R05, M-R06 and
  M-R11. The missing wait evidence was therefore **not** a lock-order defect, and the L0 gate and
  the L1–L8 order are unchanged.

The Recognition Mode was **not** the source of the 409. `resolveRecognitionPolicy()`
(`server/modules/finance-recognition-policy.js:23`) is the single canonical resolver and it never
fails closed: it resolves the source-level override, then the legacy document `billing_mode` of the
delivery, then the site-wide row and finally the `DIRECT_BUSINESS_OPEN_ITEM` fallback. The
`SALES_PARAMETER_UNAVAILABLE` contract belongs to the separate Sales Parameters namespace.

**B. M-R07** queried `credit_profile.scope_type`, a column that does not exist on the frozen Wave 9
table. The real scope discriminator is the `salesperson_scope_key` / `salesperson_id` pair with its
bidirectional CHECK: the aggregate scope is `salesperson_scope_key = '*'` with a NULL salesperson,
and the sub-limit scope is the salesperson's own key with that salesperson.

**C. M-MIG-01 / M-MIG-02.** `normalizeCheckClause()` removed backticks, charset introducers and
whitespace but kept the redundant parentheses MySQL adds around a CHECK expression and its AND/OR
operands, and it did not re-space the binary operators. MySQL renders `CHECK (a AND b)` as
`CHECK ((a) AND (b))` and `a='x'` as `a = 'x'`, so the two sides of the same constraint never
compared equal.

**D. M-MIG-06.** The fresh bootstrap materialized the two Wave 10 tables from the canonical SQLite
snapshot through the generic `mysqlType()` heuristic, while the formal upgrade materialized them
from the hand-written Wave 10 MySQL DDL. The generic heuristic produced `LONGTEXT` for the
non-indexed columns and the live migration produced `VARCHAR(128)` / `VARCHAR(64)` / `TEXT` for
the same columns, so thirteen columns of the two Wave 10 tables had a different physical type on
the two paths, and the two table-level UNIQUE constraints had a different index name, because the
Wave 10 migration declares them inline while — unlike the Wave 9 migration — it never creates them
as named indexes.

### 37.43.2 The delivered fixes

**37.43.2.1 The missing Wave 1 Sales Parameter.** `seedWave10AcceptanceBase()` now installs the
SYSTEM row through the canonical writer `upsertSalesParameters()`
(`server/modules/sales-parameters.js:68`) with an actor that holds `SALES_PARAMETERS_MANAGE`. The
fail-closed resolver and its approved error contract are untouched; the fixture no longer reaches a
production handler without a legal effective configuration. The seeded SYSTEM row is a declared
setup fact, not a business result.

**37.43.2.2 The Credit Profile scope discriminator.** M-R07 now reads
`salesperson_scope_key`, `salesperson_id`, `credit_limit_cents` and `status`, and asserts that
exactly one aggregate row (`'*'` with a NULL salesperson) and exactly one salesperson sub-limit
row exist, that they are different authoritative rows, that both are `ACTIVE`, and that no Special
Approval is created. The mandatory salesperson refusal can therefore not be released by an
aggregate-scoped result (P3 / P13 / N8).

**37.43.2.3 The canonical CHECK normalization.** `normalizeCheckClause()` now parses the clause
into its expression tree and re-renders it in one canonical form: the redundant parentheses
disappear, the operator structure and the value set are preserved exactly, and the binary operator
spacing is uniform. String literals are compared case-insensitively because every Wave 9/10 column
on the MySQL target uses the case-insensitive `utf8mb4_0900_ai_ci` collation. A clause that cannot
be parsed keeps a distinct `raw:` form, so it never silently compares equal to a parsed one. The
comparison still decides on the whole constraint set, so a missing or a genuinely different
constraint fails.

**37.43.2.4 The Wave 10 physical column contract.** The canonical live MySQL DDL is the single
authority for the physical type of every Wave 10 column. `WAVE10_MYSQL_COLUMN_TYPES` is exported
by `server/migrations/sales-customer-wave10-credit-check.js` next to the approved `PHYSICAL_TYPES`
list, and the snapshot bootstrap consumes it instead of its generic TEXT heuristic
(`server/database/mysql-schema.js`). Both paths now materialize the same physical schema for the
same logical table. The Wave 9 migration, the Wave 9 frozen Schema and every other table are
untouched; the change is scoped to the two Wave 10 tables.

**37.43.2.5 The index cross-backend contract.** The index comparison follows the contract the Wave
10 migration already declares: a backend-generated index name — an unnamed UNIQUE key is named
after its first column, and a foreign key gets a supporting index named after the child column —
is not part of the contract, so the contract is the uniqueness flag and the ordered column set.
An explicitly named index keeps its name and its definition. A missing index, a changed column
order, a changed uniqueness or a renamed explicit index all fail. A foreign key's supporting index
is derived from the foreign-key set, which is compared separately, so InnoDB's index-reuse choice
is not a schema difference.

**37.43.2.6 The wait-evidence diagnostic path.** `runCoordinatedWave10Race()` releases the
coordinator gate on every path, awaits every contender, and reports the real status, code and
message of each contender when the wait evidence is unavailable. A contender that the production
handler refuses before the gate can therefore no longer be reported as a lock-order fact. The
diagnostic path produces no PASS marker, every exit stays bounded, and the cleanup never runs
concurrently with a live worker.

### 37.43.3 Local verification evidence

The changed files are `server/migrations/sales-customer-wave10-credit-check.js`,
`server/database/mysql-schema.js`, `server/test-utils/wave10-mysql-schema-fixture.js`,
`server/test-utils/wave10-mysql-acceptance-fixture.js`,
`server/mysql-sales-customer-wave10-concurrency.integration.js`,
`server/mysql-sales-customer-wave10.integration.js`,
`server/mysql-sales-customer-wave10-business-matrix.integration.js`,
`server/sales-customer-wave10-mysql-parity.test.js` and `scripts/testing/test-suites.js`.

The new local suite `server/sales-customer-wave10-mysql-parity.test.js` is MySQL-free: it proves
that the canonical SQLite DDL and the canonical live MySQL DDL of all eight Wave 9/10 tables
normalize to one CHECK form, that a genuinely different constraint stays different, that the
Wave 10 physical column contract equals the live MySQL DDL, that the canonical generator produces
the approved physical families, and that the index parity rejects a missing index, a changed
column order, a changed uniqueness and a renamed explicit index.

Every local command was executed with `ERP_DB_*`, `ERP_MYSQL_*`,
`ERP_MYSQL_WAVE10_CAMPAIGN_LEASE`, `ERP_MYSQL_TEST_*`, `ERP_TEST_DB_BACKEND` and `ERP_SEED_DEMO`
removed from the child environment, so no local command could open a MySQL connection or a
destructive gate. The execution graph was inspected first: no real-MySQL suite is registered in
FAST, FULL or HEAVY, and the HEAVY manifest was proven free of a real MySQL path — the only
MySQL-named HEAVY suite drives an in-process fake worker.

```text
node --check (every changed file)                          PASS
server/sales-customer-wave10-mysql-parity.test.js            9/9 PASS
Wave 10 credit check + Wave 9 foundation + new parity       80/80 PASS
Wave 8 functional/remediation/mysql-metadata/mixed/residual
  + Wave 10 runners                                          117/117 PASS
Finance invoice lifecycle / recognition / Wave C invoice     14/14 PASS
pnpm.cmd test:fast                                           436/436 PASS
pnpm.cmd test                                                 2862/2862 PASS
pnpm.cmd test:heavy                                           67/67 PASS
pnpm.cmd build                                                PASS
git diff --check                                             PASS
```

### 37.43.4 Not executed and still pending

```text
MySQL connection, query, reset, DDL, DML, migration, cleanup   NOT_RUN
Gate A                                                           FROZEN, NOT_RERUN
Gate B                                                           NOT_RUN
Wave 10 Acceptance campaign                                     NOT_RUN
M-R01..M-R12 real-session results                               TEST_EVIDENCE_PENDING
M-MIG-01..M-MIG-08 real-server metadata evidence                TEST_EVIDENCE_PENDING
M-BIZ-01..M-BIZ-20                                              NOT_RUN
Gate B seven typed markers and the M-board                      NOT_GENERATED
LEGACY_DATA_EVIDENCE_PENDING                                    OPEN
RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN             OPEN
Wave 10 user Acceptance and Freeze                              OPEN
Wave 11 / Wave 12                                               NOT_STARTED
Git write                                                        NO_GIT_WRITE
```

The local repair proves the comparator logic, the schema construction and the deterministic
helpers. It does not substitute for the real MySQL evidence, and no Wave 10 Acceptance, Gate B
result or M-board is claimed.

**Remediation status: `WAVE10_MYSQL_ACCEPTANCE_BLOCKER_LOCAL_REMEDIATION_PASS`.**
**Stop state: `MYSQL_ACCEPTANCE_RERUN_NOT_AUTHORIZED`; `GATE_A_FROZEN`; `GATE_B_NOT_RUN`;
`WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED`; `WAVE11_NOT_STARTED`; `WAVE12_NOT_STARTED`.**

## 37.44 Wave 10 independent review P1 correction (2026-10-25)

### 37.44.0 Authorization and boundary

An independent code review of the pushed remediation commit `73d1c35` raised two P1 findings in the
Wave 10 acceptance infrastructure. The user authorized a bounded correction of exactly those two
findings, the local regression, the documentation synchronization, one ordinary fix commit and a
non-forced fast-forward push of the same recovery branch to `github` and `origin`.

No real MySQL connection, no Gate A, no Gate B, no Wave 10 Acceptance, no migration, reset or
cleanup was authorized or performed. The frozen contracts are unchanged: the Gate A contract and
runner, the Wave 9 business semantics and frozen Schema, the L0 transaction gate and the L1–L8 lock
order, the Finance monetary authority, the Credit Profile status fence, the idempotency contract,
the MySQL `READ COMMITTED` session isolation, the SQLite behavior, the seven Gate B cases with their
owners, typed markers and evidence levels, and the Wave 11 / Wave 12 scope boundaries. No business
Requirement changed, so `document.md` is deliberately untouched. No new business table, Schema or
acceptance semantic was introduced.

### 37.44.1 REVIEW-P1-01 — M-R03 read a column that does not exist

**Finding.** `server/mysql-sales-customer-wave10-concurrency.integration.js` read
`credit_check_results.exposure_cents`. The Wave 10 migration
(`server/migrations/sales-customer-wave10-credit-check.js`) declares twenty columns for that table
and `exposure_cents` is not one of them, so the M-R03 assertion could never have reached its
comparison: the query fails with `ER_BAD_FIELD_ERROR` / `no such column: exposure_cents`. The
production writer stores the observed exposure inside `component_breakdown_json`
(`server/modules/credit-check.js:922-931`, under the approved contract version
`CREDIT_EXPOSURE_BREAKDOWN_WAVE10_V1`), which is where the fact actually lives.

The same assertion also selected its row with `ORDER BY evaluated_at DESC LIMIT 1`, i.e. the newest
row of any check, instead of the row of the check this race produced. The newest row belongs to
another decision, so even a repaired column could have compared one decision's exposure with
another decision's expectation.

**Bounded audit of the same defect class.** Every SQL literal of the Wave 10 acceptance suites —
`server/mysql-sales-customer-wave10-concurrency.integration.js` (M-R01..M-R12),
`server/mysql-sales-customer-wave10.integration.js` (M-MIG),
`server/mysql-sales-customer-wave10-business-matrix.integration.js` (M-BIZ),
`server/mysql-sales-customer-wave10-gate-b.integration.js` (Gate B) and
`server/test-utils/wave10-mysql-acceptance-fixture.js` — was resolved against the canonical SQLite
schema and every `SELECT`, `INSERT INTO (...)` and `UPDATE ... SET` column reference was checked.
The result is exactly one instance: the M-R03 `exposure_cents` access. No other fictional column
access exists, so no other bounded repair was made.

**Correction.** The observed exposure is now read from the persisted breakdown of the very check
group the production evaluation returned:

- `server/test-utils/wave10-credit-result.js` (new, engine neutral and dependency free) owns the
  read path: `W10_EXPOSURE_BREAKDOWN_CONTRACT`, `selectCreditExposureRow()` — the correlation by
  check group and scope, which rejects a missing and an ambiguous row —
  `parseCreditExposureCents()` — the approved contract version and a legal cents amount, where a
  missing field, a wrong contract version, a non-integer amount and an unreadable document are
  defects and never a silent zero — `readCreditExposureCents()` and `assertObservedExposure()`.
- M-R03 correlates the rows with the `checkGroupId` the Credit evaluation returned, selects the
  `CUSTOMER_AGGREGATE` scope row of that check group, and asserts the observed amount is exactly
  the OLD or exactly the NEW canonical exposure. The two production business actions, the
  concurrent observation and the exposure-conservation assertions are unchanged, and the exposure
  comparison itself was not weakened or removed.

**Deterministic evidence without MySQL.** `server/sales-customer-wave10-credit-check.test.js` runs
the real production `evaluateCredit()` on SQLite and proves that the persisted document and the
assertion read path describe the same fact: the persisted `component_breakdown_json` yields the
same amount the production `computeCreditExposure()` projection reports for that scope, the
database read returns the same amount, and a wrong check group and a wrong amount are both
detected. Pointing the read path back at the fictional column reproduces the original defect
exactly — `no such column: exposure_cents` — which is how the test is proven to detect it.

### 37.44.2 REVIEW-P1-02 — the index parity contract

**Finding.** The index comparison in `server/test-utils/wave10-mysql-schema-fixture.js` had two
defects.

1. `comparableIndexes()` dropped an index when its name looked server-generated and its first
   column was a foreign-key column, without distinguishing UNIQUE from non-UNIQUE. A UNIQUE index
   on a foreign-key column is a uniqueness constraint with business semantics, and dropping it
   from both sides silently removed that constraint from the comparison.
2. `assertIndexParity()` applied the name contract only when neither side's name looked
   server-generated. A declared index that was renamed to a name equal to its first column —
   `ix_credit_check_results_stage_date` renamed to `stage` — therefore escaped the name contract
   entirely, and the renamed index was accepted.

**Correction.** The new contract is explicit and bounded:

- A server-generated foreign-key support index may be ignored only when it is **provably** all of:
  **non-unique**, a **single-column** index on a column that is a **compared foreign key** of that
  table, and **named after that column** the way MySQL names it. Its presence is derived from the
  foreign-key set, which is compared separately, so InnoDB's index-reuse choice is not a schema
  difference. A UNIQUE index is never ignored, and an index with additional business semantics
  keeps its name contract.
- The **two approved Wave 10 table-level UNIQUE constraints** are matched by their explicit
  constraint identity plus the ordered unique column set. The identity is the approved constraint
  name exported by the canonical migration
  (`UNIQUE_CONSTRAINTS` in `server/migrations/sales-customer-wave10-credit-check.js`), so no name is
  hard-coded in the comparison and the rule is bounded to those two constraints.
- **Every other declared index keeps its name contract.** The fact that an actual name happens to
  equal its first column never excuses a rename, and the rule is not generalized into "MySQL index
  names do not matter".
- Strict detection is retained for uniqueness, column order, a missing index, a duplicated index
  and an extra index.
- The SQLite side now surfaces a table-level UNIQUE constraint under its approved constraint
  identity instead of dropping it with the unnamed auto-index, so the declared uniqueness is never
  missing from the comparison.

`compareWave9SourceTarget()` and `assertEquivalentCreditMetadata()` both call the same
`assertIndexParity()`, so the two comparison paths use one identical and strict index contract. The
Wave 9 frozen index contract is untouched: its declared indexes keep their names on both sides.

### 37.44.3 Local verification evidence

The changed files are `server/migrations/sales-customer-wave10-credit-check.js`,
`server/test-utils/wave10-mysql-schema-fixture.js`,
`server/test-utils/wave10-credit-result.js` (new),
`server/mysql-sales-customer-wave10-concurrency.integration.js`,
`server/sales-customer-wave10-mysql-parity.test.js`,
`server/sales-customer-wave10-credit-check.test.js`, `solution.md` and
`log/2026-10-25.md`.

Every local command ran with `ERP_DB_*`, `ERP_MYSQL_*`, `ERP_MYSQL_WAVE10_CAMPAIGN_LEASE`,
`ERP_MYSQL_TEST_*`, `ERP_TEST_DB_BACKEND` and `ERP_SEED_DEMO` removed from the child environment,
so no local command could open a MySQL connection or a destructive gate. The execution graph was
inspected first: no real-MySQL suite is registered in FAST, FULL or HEAVY, and the HEAVY manifest
was re-confirmed to contain no real MySQL path — its only MySQL-named suite drives the in-process
fake worker `server/database/test-fixtures/delayed-mysql-worker.js`.

```text
node --check (every changed and new file)                     PASS
focused (parity + Wave 10 credit check + Wave 9 + Wave 8
  + Wave 10 runners + Finance invoice/recognition)   223/223 PASS
pnpm.cmd test:fast                                           447/447 PASS
pnpm.cmd test                                                2874/2874 PASS
pnpm.cmd test:heavy                                            67/67 PASS
pnpm.cmd build                                                PASS
git diff --check                                             PASS
```

The new negative cases were proven to fail against the pre-review implementation: with the old
filter and the old name rule restored, the three REVIEW-P1-02 cases that describe the defects fail
and the remaining cases keep passing; with the correction in place all of them pass. The
REVIEW-P1-01 end-to-end case was proven the same way.

### 37.44.4 Not executed and still pending

```text
MySQL connection, query, reset, DDL, DML, migration, cleanup   NOT_RUN
Gate A                                                           FROZEN, NOT_RERUN
Gate B                                                           NOT_RUN
Wave 10 Acceptance campaign                                     NOT_RUN
M-R01..M-R12 real-session results                               TEST_EVIDENCE_PENDING
M-MIG-01..M-MIG-08 real-server metadata evidence                TEST_EVIDENCE_PENDING
M-BIZ-01..M-BIZ-20                                              NOT_RUN
Gate B seven typed markers and the M-board                      NOT_GENERATED
LEGACY_DATA_EVIDENCE_PENDING                                    OPEN
RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN             OPEN
Wave 10 user Acceptance and Freeze                              OPEN
Wave 11 / Wave 12                                               NOT_STARTED
```

The correction proves the assertion read path and the index comparator, on SQLite and on pure
parsed data. It does not substitute for the real MySQL evidence, and no Wave 10 Acceptance, Gate B
result or M-board is claimed.

**Status: `WAVE10_INDEPENDENT_REVIEW_P1_LOCAL_FIXED`.**
**Stop state: `MYSQL_ACCEPTANCE_RERUN_NOT_AUTHORIZED`; `GATE_A_FROZEN`; `GATE_B_NOT_RUN`;
`WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED`; `WAVE11_NOT_STARTED`; `WAVE12_NOT_STARTED`.**

## 37.45 Wave 10 independent review follow-up — bounded index contract correction (2026-10-25)

### 37.45.0 Authorization and boundary

An independent code review of the pushed commit `6e596697` raised one further P1 finding about the
Wave 10 acceptance infrastructure. The user authorized a bounded correction of exactly that
finding, the local regression, the documentation synchronization, and **no** Git write operation:
the proposed changes are left unstaged for external review.

No real MySQL connection, no Gate A, no Gate B, no Wave 10 Acceptance, no migration, reset or
cleanup was authorized or performed. The frozen contracts are unchanged: the Gate A contract and
runner, the Wave 9 business semantics and frozen Schema, the Wave 9 and Wave 10 migrations, the
production Credit business logic, the canonical database schema, the L0 transaction gate and the
L1–L8 lock order, the Finance monetary authority, the Credit Profile status fence, the idempotency
contract, the MySQL `READ COMMITTED` session isolation, the SQLite behavior, and the seven Gate B
cases with their owners, typed markers and evidence levels. No business Requirement changed, so
`document.md` and `README.md` are deliberately untouched. No Schema redesign was undertaken.

### 37.45.1 REVIEW-FOLLOWUP-01 — the approved UNIQUE name exception was wider than its contract

**Finding.** In `server/test-utils/wave10-mysql-schema-fixture.js`, `assertIndexParity()` skipped the
name validation entirely for any UNIQUE index whose table and ordered columns matched an entry of
the canonical `UNIQUE_CONSTRAINTS`. The exception therefore accepted an arbitrary, non-generated
alias on either side of the comparison, not only the two legitimate cross-dialect name
representations.

**Reproduction.** With the canonical constraint
`credit_check_results / uq_credit_check_results_group_scope / (check_group_id, scope_type)` on the
expected side and `credit_check_results / unapproved_random_name / (check_group_id, scope_type)` on
the actual side, `assertIndexParity()` raised nothing and the metadata was **accepted**. The same
held with the arbitrary alias on the expected side. All four probe cases — canonical name, backend
generated name, arbitrary actual alias and arbitrary expected alias — were accepted by the
pre-correction implementation.

**Root cause.** The approved exception and its enforcement were not separated. The lookup
(`approvedUniqueConstraint()`) correctly identifies *which* constraint is exempt, but the enforcement
only asked whether a constraint was exempt and never asked whether the presented name was one of
the legitimate representations of that constraint.

**Bounded correction.** The exemption is now bounded by the presented name, and the name rule is
the one already approved for backend-generated index names:

```text
an approved table-level UNIQUE constraint may present EITHER
  - its canonical migration-declared name, OR
  - a demonstrably valid backend-generated name (the first column of the
    constrained ordered column set, with the backend's numeric collision suffix)
```

Both sides are validated against that rule, because `assertEquivalentCreditMetadata()` compares two
MySQL materialization paths rather than SQLite against MySQL, so either side may legitimately carry
the backend-generated name. Every other explicitly named index continues to require exact name
equality. The foreign-key supporting-index exception, the uniqueness flag, the column order, the
missing, duplicated and extra index detection are all unchanged.

The correction stays inside the approved Design. §37.39.8.2 retains "index uniqueness/order" as a
comparison dimension, and the Wave 10 migration already states that the parity assertions compare
the constrained column set for these table-level UNIQUE constraints because SQLite does not
preserve a table-constraint name on its auto-index. The name difference that the exception exists
for is therefore only the canonical name versus a backend-generated one; no approved Requirement or
Design contract had to change, and no separate authorization is required.

### 37.45.2 Deterministic evidence

`server/sales-customer-wave10-mysql-parity.test.js` now carries the complete contract matrix:

| Case | Expected | Result |
|---|---|---|
| Canonical approved UNIQUE name on both sides | PASS | PASS |
| Approved backend-generated UNIQUE name, actual side | PASS | PASS |
| Approved backend-generated UNIQUE name, expected side | PASS | PASS |
| Arbitrary renamed approved UNIQUE, actual side | FAIL | FAIL |
| Arbitrary renamed approved UNIQUE, expected side | FAIL | FAIL |
| Arbitrary alias matching columns and uniqueness | FAIL | FAIL |
| Backend collision suffix `check_group_id_2` | PASS | PASS |
| Foreign-key supporting-index exception | PASS | PASS |
| Explicitly named non-exempt UNIQUE renamed | FAIL | FAIL |
| Missing / extra / duplicated / reordered / de-uniqued | FAIL | FAIL |

The negative cases were proven against the pre-correction implementation: restoring the old rule
drops the suite from 28/28 to 25/28, and exactly the three cases that describe the defect fail
while every other case keeps passing. With the correction in place all 28 pass.

The same correction applies to both comparison paths, because `compareWave9SourceTarget()` and
`assertEquivalentCreditMetadata()` both call the single `assertIndexParity()`. The Wave 9 frozen
index contract is untouched: its declared indexes are not exempt and keep their names on both
sides.

### 37.45.3 Corrected change inventory

The §37.44.3 inventory overstated the changed files of commit `6e596697`: it listed
`server/test-utils/wave10-mysql-acceptance-fixture.js`, which that commit did not change, and it
omitted the two documentation files. The inventory now reads exactly the eight files of
`6e596697`. No other historical record was rewritten.

### 37.45.4 Local verification evidence

The changed files are `server/test-utils/wave10-mysql-schema-fixture.js`,
`server/sales-customer-wave10-mysql-parity.test.js`, `solution.md` and `log/2026-10-25.md`.

Every local command ran with `ERP_DB_*`, `ERP_MYSQL_*`, `ERP_MYSQL_WAVE10_CAMPAIGN_LEASE`,
`ERP_MYSQL_TEST_*`, `ERP_TEST_DB_BACKEND` and `ERP_SEED_DEMO` removed from the child environment.
The execution graph was inspected first: no real-MySQL suite is registered in FAST, FULL or HEAVY,
and the HEAVY manifest contains no real MySQL path — its only MySQL-named suite drives the
in-process fake worker.

```text
node --check (every changed file)                             PASS
node --test server/sales-customer-wave10-mysql-parity.test.js  28/28 PASS (0 skipped)
pnpm.cmd test:fast                                           455/455 PASS (0 skipped)
pnpm.cmd test                                                2882/2882 PASS (0 skipped)
pnpm.cmd test:heavy                                          67/67 PASS (0 skipped)
pnpm.cmd build                                                PASS
git diff --check                                             PASS
```

### 37.45.5 Not executed and still pending

```text
MySQL connection, query, reset, DDL, DML, migration, cleanup   NOT_RUN
Gate A                                                           FROZEN, NOT_RERUN
Gate B                                                           NOT_RUN
Wave 10 Acceptance campaign                                     NOT_RUN
M-R01..M-R12 real-session results                               TEST_EVIDENCE_PENDING
M-MIG-01..M-MIG-08 real-server metadata evidence                TEST_EVIDENCE_PENDING
M-BIZ-01..M-BIZ-20                                              NOT_RUN
Gate B seven typed markers and the M-board                      NOT_GENERATED
LEGACY_DATA_EVIDENCE_PENDING                                    OPEN
RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN             OPEN
Wave 10 user Acceptance and Freeze                              OPEN
Wave 11 / Wave 12                                               NOT_STARTED
Git write                                                       NO_GIT_WRITE
```

The correction proves the index comparator on pure parsed data. It does not substitute for the
real MySQL evidence, and no Wave 10 Acceptance, Gate B result or M-board is claimed.

**Status: `WAVE10_REVIEW_FOLLOWUP_LOCAL_PASS`.**
**Stop state: `MYSQL_ACCEPTANCE_RERUN_NOT_AUTHORIZED`; `GATE_A_FROZEN`; `GATE_B_NOT_RUN`;
`WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED`; `WAVE11_NOT_STARTED`; `WAVE12_NOT_STARTED`;
`NO_GIT_WRITE`.**

## 37.46 Wave 10 Gate B OQC quality-policy fixture design (2026-10-26)

### 37.46.0 Authorization and boundary

The user authorized one consecutive `AUDIT -> REQUIREMENT -> DESIGN` stage for the Wave 10 Gate B OQC
fixture gap, with a mandatory HARD STOP at the end of this Design. The Requirement is
`document.md` §"Wave 10 Gate B OQC quality-policy fixture Requirement (2026-10-26)", clauses
`W10-QCP-R01` through `W10-QCP-R06`.

**No Implementation is authorized by this section.** No production code, no fixture, no test, no suite
registry, no schema, no migration, no runner, no manifest and no package change is made here. No
real MySQL connection, no Gate A, no Gate B, no Wave 10 Acceptance campaign, no destructive database
operation and no Git write is authorized or performed.

Frozen and unchanged by this Design: the production quality-gate semantics and defaults, the
outsourcing quality policy (OUT-18), the quality-control-point schema and migrations, the Sales
Delivery creation and confirmation handlers, the Credit and Finance business semantics, the L0 and
L1–L8 lock order, READ COMMITTED isolation, permissions, status machines, audit and idempotency
contracts, the Gate A contract and freeze, the Wave 9 freeze, the seven Gate B case identities and
evidence levels, the M-board shape, the package version and the release tags.

### 37.46.1 The audited failure chain

```text
POST /api/sales-deliveries                      (production route, worker session)
  createSalesDelivery()            server/app.js:5619
    configureTrackedDraftLines()   server/app.js:4190   <- one call per persisted Delivery line
      freezeQualityPolicy()        server/modules/traceability-quality.js:436
        resolveQualityPolicy()     server/modules/traceability-quality.js:418
          no applicable QCP  ->  { inspectionRequired: true, failSafe: true }   (SALES_DELIVERY)
          ->  snapshot row: inspection_required = 1, qcp_id = NULL, waiver_reason = NULL

POST /api/sales-deliveries/{id} { action: 'confirm' }   (production route, worker session)
  confirmSalesDelivery()           server/app.js:5712
    assertQualityGate(db,'OQC')    server/app.js:5843
      deriveQualityState()         server/modules/quality-gates.js:191
        qualityPolicyAllowsPosting()  server/modules/traceability-quality.js:445
          required = true, no oqc_inspections  ->  NOT_INSPECTED
      ->  HTTP 409  物流单据质量门禁未通过：未检验   (see 37.46.11)
```

`server/test-utils/wave10-mysql-acceptance-fixture.js` contains no `quality_control_points`, no
`logistics_quality_policy_snapshots` and no `oqc_inspections` fact at all, so every Sales Delivery
created by the Wave 10 acceptance suites freezes a fail-safe policy and is refused at confirmation.
The 409 is the **correct** production behaviour; the gap is acceptance-fixture infrastructure.

Two further audited facts shape the design:

- The shipped default control points (`server/migrations/v13-phase6b-traceability-quality.js:216-221`)
  are inserted only when a `user-admin` row exists. The protected Wave 10 MySQL target initializes in
  production mode, so `user-admin` does not exist and `quality_control_points` is **empty** on that
  target. Even where the default row exists it carries `inspection_required = 1` and would produce
  the same refusal.
- `server/mysql-sales-customer-wave10-business-matrix.integration.js:104-126` (the
  `W10-BUSINESS-MATRIX` suite of the Wave 10 Acceptance campaign) uses the **same**
  `seedWave10AcceptanceBase()` and creates *and confirms* Deliveries through the same real HTTP
  route. It is exposed to the same refusal. The remedy therefore has to live in the **shared fixture
  base**, not in the Gate B concurrency suite alone.

### 37.46.2 Option comparison

| Option | Mechanism | Verdict |
|---|---|---|
| **A** | Install a legitimate effective `SALES_DELIVERY` Quality Control Point with `inspection_required = false` and a written reason, then let the existing canonical freeze path snapshot it | **CHOSEN** |
| **B** | Call `freezeQualityPolicy()` again after Delivery creation for each actual Delivery item | Rejected |
| **C** | Create and complete a genuine OQC inspection | Rejected as the primary approach |
| **D** | Directly seed a `logistics_quality_policy_snapshots` row, as the Batch A concurrency test does | Rejected |

**A — chosen.** `createQcp()` (`server/modules/traceability-quality.js:452-470`) is the canonical
production writer for quality control points. It validates the ADMIN actor, requires a written
reason for a waiver, computes the next version for the code, inserts the control point and its
criteria, and writes the canonical `CREATE_VERSION` / `QUALITY_CONTROL_POINT` audit fact. The
existing canonical path then does the rest without any further production change:
`configureTrackedDraftLines()` → `freezeQualityPolicy()` → `resolveQualityPolicy()` finds the
installed control point and freezes `inspection_required = 0` with the control-point id, version and
reason on the **actual** Delivery line. `deriveQualityState()` then returns `WAIVED`, which
`assertQualityGate()` accepts as a passing gate state. No production file is touched, and the
waiver is a real, effective, auditable configuration fact rather than a fabricated row.

**B — rejected.** `freezeQualityPolicy()` is idempotent on `UNIQUE(source_type, source_item_id)` and
returns the already frozen snapshot without re-resolving
(`server/modules/traceability-quality.js:437-438`). The canonical Delivery creation has already
frozen the fail-safe snapshot, so a post-creation call cannot change it. Making B work would require
deleting the frozen snapshot first — that is exactly the hand-crafted policy evidence that
`W10-QCP-R03` forbids, and it discards the canonical resolution record. Option A reaches the same
gate outcome **through** the canonical path, at the correct moment (document creation), with no
deletion and no rewriting.

**C — rejected as the primary approach.** A genuine OQC inspection is legitimate, but it would make
the fixture drive a second acceptance surface inside a Credit/Finance acceptance suite: an
inspection header, inspection items that must match the Delivery line identity, quantity, warehouse
and tracking snapshot, and a PASS completion, for every Delivery in every Wave 10 case. It would also
change what M-R03 and M-R09 actually exercise, because an OQC lifecycle would then sit on the same
confirmation path as the race. The gate accepts two passing states (`PASS` and `WAIVED`), and a
waiver backed by a real control point with a real reason reaches `WAIVED` without any inspection.
Option C would be the right choice only if the agreed business requirement were that outgoing
inspection must actually happen in these cases; that is not the stated requirement, and
`W10-QCP-R03` explicitly requires the waiver to carry a legitimate test-only business reason rather
than a performed inspection.

**D — rejected.** The Batch A row (`server/mysql-sales-customer-batch-a-concurrency.integration.js:169-171`)
carries `qcp_id = NULL`, `qcp_version = NULL` and `waiver_reason = 'CONCURRENCY_FIXTURE'`. It
references no control point, records no resolution and matches no QCP version, so it fails
`W10-QCP-R02` and `W10-QCP-R03`. It is also strictly weaker as evidence: because it bypasses the
policy-resolution contract entirely, a regression in `resolveQualityPolicy()` would not be detected
by the Wave 10 suites at all.

### 37.46.3 Chosen design — the fixture helper

**Location.** `server/test-utils/wave10-mysql-acceptance-fixture.js`, next to the existing
`seedWave10SalesParameters()` precedent, which installs the fail-closed Wave 1 `sales_parameters`
SYSTEM row through the canonical writer `upsertSalesParameters()` for the same reason — a production
prerequisite must be a real configuration fact, not something invented behind the writer.

**New exported helper.**

```text
seedWave10QualityPolicy(db, options) -> { id, version, reason, reused }
```

Responsibilities, in order:

1. **Install through the canonical writer.** Call `createQcp(db, actor, input)` from
   `server/modules/traceability-quality.js`. The fixture supplies only business inputs; the writer
   owns the identity, the version, the audit fact and the transaction.
2. **Write a legitimate test-only reason.** The control point's `remarks` must state that the Wave 10
   acceptance cases exercise the Sales Delivery → Finance → Credit chain and that outgoing-goods
   inspection is outside the subject of those cases. It must not claim that an inspection was
   performed.
3. **Assert the installed fact.** The row exists, is active, carries the intended operation type,
   scope and product, `inspection_required = 0`, a non-empty `remarks` equal to the reason, and a
   version `>= 1`.
4. **Assert the canonical resolution reads it back.** Call `resolveQualityPolicy(db,
   'SALES_DELIVERY', productId, wave10BusinessDate())` and require `inspectionRequired === false`,
   `qcpId === installed.id`, `version === installed.version` and `waiverReason === reason`. This is
   the proof that the fixture reads a real effective policy rather than a hand-made row.
5. **Be idempotent within one database.** If an active control point with the same code, scope and
   product already exists with the same inspection flag, reuse it and return `reused: true` instead
   of creating a second version. The lookup is written with `COALESCE(product_id,'') = ?` so the
   same statement is valid on SQLite and MySQL and also for a `NULL` product on a global scope.

**Control point parameters.**

| Field | Value | Reason |
|---|---|---|
| `operationType` | `SALES_DELIVERY` | The gate under test is the Sales Delivery OQC gate |
| `scope` | `PRODUCT`, bound to the fixture product | See 37.46.6 — a product-scoped rule always outranks a global one in the canonical resolution order, so the fixture is correct on a development database (where the shipped global default with `inspection_required = 1` exists) and on the production-mode MySQL target (where `quality_control_points` is empty) |
| `inspectionRequired` | `false` | The Wave 10 cases are Credit/Finance race cases; outgoing-goods inspection is not their subject |
| `samplingMode` | `FULL` | A waived rule has no sample |
| `effectiveFrom` | a fixed past date (`2020-01-01`) | The rule is effective on every business date the campaign may use, including across a midnight boundary during a long campaign. This deliberately differs from the campaign's `wave10BusinessDate()`, which is derived from the run date because the exposure window depends on it |
| `effectiveTo` | `null` | No expiry |
| `active` | `true` | The rule is effective |
| `remarks` | the test-only reason | `W10-QCP-R03` |

**Actor.** `{ id: 'w10-race-approver', roleCode: 'ADMIN', permissions: [...] }`. `createQcp()`
requires `roleCode === 'ADMIN'`, and `quality_control_points.created_by` references `users(id)`, so
the actor id must be a seeded user — `w10-race-approver` is created by
`seedWave10AcceptanceBase()` before the control point is installed.

**Call site.** Inside `seedWave10AcceptanceBase()`, controlled by an explicit option (default
`true`), placed after the product row and after the user rows and before any business document can
exist:

```text
seedWave10AcceptanceBase(db, options)
  1  users (creator / approver / sales-a / sales-b)          <- role-admin is seeded by seedSchema
  2  customer, salesperson profiles, sales group, memberships
  3  warehouse
  4  product  w10-race-product
  5  >>> createQcp -> the single SALES_DELIVERY PRODUCT-scoped waiver control point <<<
  6  product commercial classification, price list / entries / versions, customer extension
  7  credit parameters, rule, profiles, lock anchors
  8  inventory, cash settlement account, sales parameters (canonical writer)
```

The negative regression calls `seedWave10AcceptanceBase(db, { qualityPolicy: false })` and therefore
skips step 5 entirely, which is exactly the missing-evidence condition.

### 37.46.4 Ordering, identity and version consistency

**Ordering invariant.** The control point must exist **before any Delivery is created**. The policy
snapshot is frozen once, at document creation, by `configureTrackedDraftLines()` inside the
Delivery-creation transaction. A control point installed after a Delivery exists cannot change that
Delivery's snapshot. This is the reason the remedy belongs in the shared base seed and not in a
per-case step.

```text
seed base (incl. control point)
  -> canonical sales order create / submit / approve        (production writers)
  -> POST /api/sales-deliveries                              (production route)
       -> freezeQualityPolicy -> resolveQualityPolicy
          -> snapshot: inspection_required=0, qcp_id=<qcp>, qcp_version=<version>,
                       waiver_reason=<reason>, product_id=<line product>,
                       source_id=<delivery id>, source_item_id=<line id>
  -> POST /api/sales-deliveries/{id} { action:'confirm' }    (production route)
       -> assertQualityGate('OQC') -> WAIVED -> gate passes
       -> inventory OUT, COGS voucher, Finance recognition, audit, idempotency
```

**Identity and version consistency.** The snapshot's identity fields are read from the *persisted*
document by the production code, never supplied by the fixture:

| Snapshot field | Source | Consistency requirement |
|---|---|---|
| `source_type` | the literal `'SALES_DELIVERY'` passed by `configureTrackedDraftLines` | equals the gate's `policySourceType` |
| `source_id` | the real `sales_deliveries.id` produced by the production route | equals the Delivery the case actually created |
| `source_item_id` | the real `sales_delivery_items.id` produced by `replaceLogisticsItems` | equals the line the case actually created; `UNIQUE(source_type, source_item_id)` makes "one frozen policy per line" a database-enforced fact |
| `product_id` | the persisted line's `product_id` | equals the product the installed control point is scoped to |
| `qcp_id` | `resolveQualityPolicy()` | equals the installed control point id |
| `qcp_version` | `resolveQualityPolicy()` | equals the installed control point version |
| `inspection_required` | `resolveQualityPolicy()` | `0` |
| `waiver_reason` | the control point's `remarks` | equals the declared test-only reason |
| `resolved_at` | the freeze timestamp | the freeze time, not the control point's creation time |

**Impact on M-R03 and M-R09.** Neither case's Finance or Credit assertion changes.

- **M-R03 (`R-SAL-14`)** — `canonicalDelivery(..., billingMode: 'SEPARATE')` now confirms instead of
  returning 409. The invoice creation, the OLD exposure read, the coordinated race, the
  `component_breakdown_json` exposure observation and the stage-conservation assertion are
  untouched.
- **M-R09** — `canonicalDelivery(..., billingMode: 'LEGACY_DIRECT')` now confirms, and the final
  unpaid `SALES_DELIVERY`-sourced receivable that the assertion reads is produced by the production
  recognition writer exactly as before.

**Why the Finance and Credit assertions remain unchanged.** `assertQualityGate()` has no return
value that feeds any monetary arithmetic — it either throws or returns, and the returned state is
not read afterwards. The gate is evaluated at `server/app.js:5843`, *before* the financial writes at
`server/app.js:5844`+. Once the gate returns `WAIVED` instead of throwing, the remaining sequence is
byte-identical: `assertFinancialPeriodsOpen`, `authoritativeLogisticsTotal`, the per-line reservation
/ inventory / COGS loop, the `sales_deliveries` status transition, the COGS system voucher,
`recognizeFinanceExposure` (or `autoInvoiceDelivery` for `DIRECT_BILL`), `saveIdempotency` and the
`CONFIRM` audit. The recognition mode, the invoice, the receivable, the exposure projection, the
capacity classification and the zero-side-effect projections are therefore all unchanged. A `WAIVED`
gate and a `PASS` gate are the same passing outcome for every downstream writer.

**Effect on the Wave 10 persistence projection.** The control point adds one row to
`quality_control_points` and one row to `audit_logs` (`CREATE_VERSION` / `QUALITY_CONTROL_POINT`).
Neither perturbs an existing assertion:

- `quality_control_points` is not part of the declared projection families
  (`P-CREDIT`, `P-APPROVAL`, `P-GATE`, `P-SALES`, `P-FINANCE`, `P-AUDIT-IDEM`), and no production
  entry point under test writes it, so it is not a case-scoped mutation surface.
- `audit_logs` **is** inside `P-AUDIT-IDEM`. The creation audit row is written during the base
  seeding, which happens before every `captureWave10PersistenceProjection(before)` in every case, so
  it is present in both the before and the after projection and contributes nothing to any delta.
- Every existing `audit_logs` count assertion in the Wave 10 suites is filtered by `action` and
  `entity_type` (`EVALUATE`/`CREDIT_CHECK`, `APPROVE`/`SALES_ORDER`, `CONSUME`/
  `CREDIT_SPECIAL_APPROVAL`, `SUBMIT`/`SALES_ORDER`), so a `CREATE_VERSION`/`QUALITY_CONTROL_POINT`
  row cannot be counted by any of them.

The projection families are therefore left unchanged; the base seed is not a case-scoped surface.

### 37.46.5 Repeatability, cleanup, idempotency and concurrency

**Repeatability.** Every Wave 10 suite runs against its own freshly reset disposable schema. The
seeded control point has a stable business identity (code `QCP-W10-SALES-DELIVERY`, operation type
`SALES_DELIVERY`, scope `PRODUCT`, bound to the fixture product, `inspection_required = 0`, fixed
past `effective_from`, no expiry). Only the surrogate row id differs between runs, exactly as for
every other fixture reference fact.

**Cleanup.** The control point lives in `quality_control_points`, a table created by the canonical
bootstrap and removed by the per-suite schema reset
(`resetWave10CampaignSchema()` drops every base table, and the final campaign cleanup drops the
schema). It leaves no residue and needs no cleanup exemption. It creates no file, no external
resource and no credential.

**Idempotency.** `seedWave10AcceptanceBase()` runs exactly once per disposable database, and
`seedWave10QualityPolicy()` additionally detects an already-installed, active, matching control
point and reuses it rather than creating a second version, so an accidental second call cannot make
the resolution ambiguous or produce a second `CREATE_VERSION` audit fact.

**Concurrency.** The control point is written on the *parent* connection, inside one transaction,
before any worker session begins a business action, and it is committed before the workers start.
The workers never write `quality_control_points`; they only read it. `resolveQualityPolicy()` is a
plain `SELECT` under READ COMMITTED, so no worker can observe a partially written control point and
no lock cycle is possible. `freezeQualityPolicy()` inserts into
`logistics_quality_policy_snapshots`, whose `UNIQUE(source_type, source_item_id)` key is distinct
per Delivery line, so two concurrent confirmations of two different Deliveries cannot conflict on
that key. The control point introduces **no new lock participant** and therefore does not alter the
L0 / L1–L8 order that the races assert.

### 37.46.6 SQLite / MySQL compatibility

- `createQcp()` and `resolveQualityPolicy()` are dialect-agnostic production functions already
  reachable on both backends (`POST /api/quality-control-points` is registered on both). The helper
  adds no backend-specific SQL beyond a `COALESCE(product_id,'')` predicate that is valid on both.
- `quality_control_points`, `quality_control_criteria` and `logistics_quality_policy_snapshots`
  exist with the same shape on both backends: the MySQL schema is produced by translating the
  canonical SQLite snapshot, so the columns, the `UNIQUE(code, version)` key and the
  `UNIQUE(source_type, source_item_id)` key are the same contract on both.
- **The `PRODUCT` scope is what makes the fixture backend-independent.** The canonical resolution
  orders by `CASE scope WHEN 'PRODUCT' THEN 0 ELSE 1 END, version DESC`, so a product-scoped control
  point always outranks a global one. On a development / demo-seeded SQLite database the shipped
  global default `qcp-global-outgoing-v1` exists with `inspection_required = 1`, and the fixture's
  product-scoped waiver still wins. On the production-mode MySQL target `quality_control_points` is
  empty and the fixture's control point is the only applicable one. The resolved result — required
  `false`, with the fixture's control point id and version — is identical on both backends.
- The fixture's control point does not depend on the campaign's run date, so the same fixture code
  is valid whether the campaign runs before or after midnight in the run date's local time zone.

### 37.46.7 Regression plan

**New deterministic file** `server/sales-customer-wave10-quality-policy.test.js`, engine-neutral
(SQLite), registered in FAST and FULL through `scripts/testing/test-suites.js`. It must not require a
real MySQL campaign to be meaningful.

| Case | Setup | Assertion |
|---|---|---|
| `W10-QCP-T01` — **negative**: missing OQC evidence still blocks | `seedWave10AcceptanceBase(db, { qualityPolicy: false })`, canonical order create/submit/approve, Delivery created through the real HTTP route | the frozen snapshot for the actual Delivery line has `inspection_required = 1`, `qcp_id IS NULL`, `waiver_reason IS NULL`; the real confirmation route returns **HTTP 409** carrying the production refusal raised by `assertQualityGate()` (the production label resolves to `物流单据`, so the refusal text is `物流单据质量门禁未通过：未检验` — see 37.46.11); the Delivery stays `DRAFT`; no inventory transaction, no COGS voucher, no receivable, no `CONFIRM` audit and no idempotency record exist |
| `W10-QCP-T02` — **positive**: the installed policy fact waives the gate | default seeding with the control point installed | `resolveQualityPolicy()` returns `inspectionRequired === false` with the installed `qcpId`, `version` and `waiverReason`; the frozen snapshot for the actual Delivery line carries `source_type='SALES_DELIVERY'`, the actual `source_id`, the actual `source_item_id`, the actual `product_id`, the installed `qcp_id`, the installed `qcp_version`, `inspection_required = 0` and the declared reason; the real confirmation route returns **HTTP 200**; `sales_deliveries.status='CONFIRMED'` with `confirmed_by` set; exactly one inventory transaction, one `CONFIRM` audit and one `SALES_DELIVERY_CONFIRM` idempotency record exist; the cost effect is bound to the issued cost — the fixture product carries no valuation basis, so the production writer issues one `LEGACY_UNVALUED` valuation movement with a zero value and therefore writes no COGS voucher (see 37.46.11) |
| `W10-QCP-T03` — the gate is genuinely consulted | both databases from T01 and T02 | `deriveQualityState(db, 'OQC', deliveryId)` is `NOT_INSPECTED` in T01 and `WAIVED` in T02; deactivating the installed control point (`active = 0`) makes the canonical resolution fail-safe again (`inspectionRequired === true`), proving the waiver is policy-driven and not hard-coded; the production `confirmSalesDelivery` source still contains the `assertQualityGate(db, 'OQC', deliveryId)` call, following the existing source-contract pattern in `server/v16-p2-sales-deliveries.test.js` and `server/sales-customer-wave7-acceptance.test.js` |
| `W10-QCP-T04` — the fixture helper is idempotent and dialect-neutral | one database | a second `seedWave10QualityPolicy()` call returns the same control point id and version with `reused === true`, creates no second version and leaves exactly one `CREATE_VERSION` / `QUALITY_CONTROL_POINT` audit fact; the helper's resolution read-back holds on both backends |

**Campaign-level evidence.** The real MySQL campaign remains the authority for M-R03, M-R09 and the
`W10-BUSINESS-MATRIX` cases; the local suite proves the fixture contract, not the campaign result.
`W10-QCP-T01`–`T04` are a precondition for a campaign rerun, not a substitute for it.

### 37.46.8 Detecting an accidental Quality Gate bypass

1. `W10-QCP-T01` proves the production refusal — the exact production status and message — so a
   weakened or removed fail-safe default fails the local suite.
2. `W10-QCP-T02` asserts the frozen snapshot's *policy-derived* content (`qcp_id`, `qcp_version`,
   `waiver_reason`). A hard-coded or hand-made bypass cannot produce a control-point-backed
   snapshot, so the assertion fails if the fixture stops going through the canonical resolution.
3. `W10-QCP-T03` deactivates the control point and shows the resolution returning to fail-safe, so
   the success in T02 is demonstrably a policy effect rather than a constant.
4. `W10-QCP-T03` re-asserts the production source contract that `confirmSalesDelivery` calls
   `assertQualityGate(db, 'OQC', deliveryId)`.
5. `deriveQualityState()` is exposed on the Delivery read path (`getSalesDelivery` and
   `listSalesDeliveries` return `qualityState`), so a bypass would also surface as a missing or
   incorrect `qualityState` in the Delivery payload; T01/T02 assert the state code directly.
6. The implementation change list is bounded to the fixture, one new test file and the suite
   registry. `server/app.js`, `server/modules/quality-gates.js`,
   `server/modules/traceability-quality.js`, `server/modules/authoritative-quality.js`, every
   migration and every schema file are untouched, so the gate implementation itself cannot drift
   under this Design.

### 37.46.9 Intended implementation file list (not yet modified)

| File | Change | Production behaviour changed |
|---|---|---|
| `server/test-utils/wave10-mysql-acceptance-fixture.js` | Add the `W10_QUALITY_ACTOR` constant and the exported `seedWave10QualityPolicy(db, options)` helper; import `createQcp` and `resolveQualityPolicy` from `server/modules/traceability-quality.js`; add the `qualityPolicy` option (default `true`) to `seedWave10AcceptanceBase()` and call the helper after the product and user rows | no |
| `server/sales-customer-wave10-quality-policy.test.js` | New deterministic SQLite regression implementing `W10-QCP-T01`–`W10-QCP-T04` | no |
| `scripts/testing/test-suites.js` | Register the new test file in FAST and FULL | no |
| `server/mysql-sales-customer-wave10-concurrency.integration.js` | **Evidence only**: inside the existing `canonicalDelivery()` helper, read back the frozen policy snapshot for the produced Delivery line and assert it references the installed control point and requires no inspection. No M-R03/M-R09 assertion, expectation or race semantics changes | no |
| `solution.md` | This section | no |
| `log/2026-10-26.md` | The append-only record | no |

**Explicitly not modified:** `server/app.js`, `server/modules/quality-gates.js`,
`server/modules/traceability-quality.js`, `server/modules/authoritative-quality.js`,
`server/modules/credit-check.js`, `server/modules/sales-orders.js`, every file under
`server/migrations/` and `server/database/`, `server/mysql-sales-customer-wave10-business-matrix.integration.js`
(it inherits the fix through the shared base seed), `server/mysql-sales-customer-wave10-gate-b.integration.js`,
`server/mysql-sales-customer-wave10.integration.js`, every runner, manifest, worker and gate script,
`README.md`, `package.json` and the release tags.

### 37.46.10 Design acceptance, rollback and hard stop

**Acceptance conditions for the future Implementation.**

1. The control point is installed through `createQcp()` and its resolution is read back through
   `resolveQualityPolicy()`; no policy snapshot row is ever hand-written by the fixture.
2. The control point is `PRODUCT`-scoped, `SALES_DELIVERY`, `inspection_required = false`, active,
   effective from a fixed past date with no expiry, and carries the declared test-only reason.
3. It is installed before any Delivery is created, so the canonical freeze path resolves it.
4. Every Delivery in the Wave 10 acceptance suites freezes a snapshot whose `source_id`,
   `source_item_id`, `product_id`, `qcp_id` and `qcp_version` match the actual document and the
   installed control point.
5. The real HTTP confirmation route succeeds in M-R03 and M-R09 and in the business matrix cases,
   with every Finance/Credit assertion unchanged.
6. `W10-QCP-T01`–`T04` pass, and `pnpm test:fast`, `pnpm test`, `pnpm build` and
   `git diff --check` pass with no skipped, todo, cancelled or weakened assertion.
7. The Gate A diff is zero bytes and no frozen contract is touched.

**Rollback.** The change is confined to acceptance-fixture and test files. Rollback is a plain
revert of the four implementation files; no schema, migration, data or external state is involved,
so there is nothing to unwind in a database and no partial-application risk.

**HARD STOP.** This Design is complete and awaits explicit Implementation authorization. No
Implementation, no real MySQL connection, no Gate A, no Gate B, no Wave 10 Acceptance campaign, no
destructive database operation, no Git write, no Wave 11 and no Wave 12 work is authorized or
performed by this stage.

**Status: `WAVE10_GATE_B_FIXTURE_DESIGN_READY_FOR_IMPLEMENTATION_AUTHORIZATION`.**
**Stop state: `IMPLEMENTATION_NOT_AUTHORIZED`; `MYSQL_NOT_CONNECTED`; `GATE_A_FROZEN`;
`GATE_B_NOT_RUN`; `WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED`; `WAVE11_NOT_STARTED`;
`WAVE12_NOT_STARTED`; `NO_GIT_WRITE`.**

### 37.46.11 Implementation-stage factual correction to the expected values (2026-10-26)

The Implementation stage was explicitly authorized under AGENTS.md §4.4. It found three factual
mismatches between the **expected values** predicted in §37.46.1 and §37.46.7 and the behaviour the
production code actually produces on the Wave 10 fixture. None of them changes a Design decision, an
Option verdict, the Requirement clauses `W10-QCP-R01`..`R06`, the intended implementation file list
or any production behaviour. They are corrections of predicted literals, and they were corrected in
this section and in `document.md` A6 because the canonical chain must not state a value the
implementation cannot produce without touching production code, which this Implementation was
forbidden to do.

**C1 — the production refusal label.** §37.46.1 and the `W10-QCP-T01` row predicted the refusal
`销售出库单质量门禁未通过：未检验`. `assertQualityGate()` resolves its label with
`config[kind]?.sourceLabel || config[kind]?.shared?.sourceTypes?.[...]?.sourceLabel || '物流单据'`.
The per-source label `销售出库单` is declared on `config.OQC.sourceTypes.SALES_DELIVERY`, but the
resolution reads `config[kind].shared.sourceTypes`, and `shared` carries no `sourceTypes`. The
resolved label is therefore always the fallback `物流单据`, and the production refusal is
`物流单据质量门禁未通过：未检验`. The rejection does not change: the state is still `NOT_INSPECTED`
(`未检验`) and the status is still HTTP 409. The implementation therefore asserts the HTTP refusal
against the message the production `assertQualityGate()` itself raises, plus the `质量门禁未通过：未检验`
refusal text, instead of hard-coding a label the production code does not emit. The label-resolution
nesting defect is **not** fixed here: it is a production-code change and is out of the authorized
scope. It is reported as an open observation for a future Requirement.

**C2 — the cost effect of the fixture product.** The `W10-QCP-T02` row predicted "exactly one
inventory transaction, one COGS voucher, one `CONFIRM` audit and one `SALES_DELIVERY_CONFIRM`
idempotency record". The fixture product `w10-race-product` carries no valuation basis, so the
production writer `issueSourceValue()` takes the `LEGACY_UNVALUED` path, issues one valuation
movement with `quantity_delta = -1` and `value_delta_cents = 0`, and `confirmSalesDelivery()`
creates a COGS voucher only when `cogsCents > 0`. The production contract is therefore: exactly one
inventory transaction, one `LEGACY_UNVALUED` valuation movement with zero issued cost, and **no** COGS
voucher. The implementation asserts that causal chain instead of a fixed voucher count, which is
strictly stronger than a bare count. Installing a valuation cost for the fixture product was
rejected: it would change the approved inventory and valuation setup, which the Implementation
authorization forbids.

**C3 — the inventory transaction sign.** `inventory_transactions.quantity_change` stores the issued
magnitude together with a separate `direction` column, so an outbound line is `quantity_change = 1`
with `direction = 'OUT'`. The implementation asserts that contract.

**Unchanged by this correction.** §37.46.0 .. §37.46.10 as authored, every Option verdict, the
`W10-QCP-R01`..`R06` clauses, the intended implementation file list, the production quality-gate
semantics, the outsourcing quality policy, the schema and migrations, the Sales Delivery handlers,
the Credit and Finance semantics, the lock order, the permissions, the status machines, the audit and
idempotency contracts, the Gate A freeze, the Gate B case identities and evidence levels, the M-board
shape, the package version and the release tags.

**Status: `WAVE10_GATE_B_FIXTURE_DESIGN_EXPECTED_VALUE_CORRECTION_APPLIED`.**

## 37.47 Wave 10 M-R09 credit-capacity contract design (2026-10-26)

### 37.47.0 Authorization and boundary

The user confirmed the M-R09 acceptance contract contains a verified contradiction and authorized one
consecutive `REQUIREMENT -> DESIGN` stage for it. This section records the Design phase only. The
Requirement phase is `document.md` → "Wave 10 M-R09 Credit capacity contract Requirement (2026-10-26)".
**Implementation is not authorized by this stage.** Real MySQL access, Gate B re-execution, the Wave 10
Acceptance campaign, Git writes, production Credit / Finance / quality-gate code, schema, migrations,
runners, manifests, package files and Wave 11 remain outside this Design. The mandatory HARD STOP
follows this section.

The completed OQC Fixture Implementation is preserved unchanged: `seedWave10QualityPolicy()`,
`readWave10QualityPolicy()`, the `qualityPolicy` option of `seedWave10AcceptanceBase()`, the canonical
quality-policy regression file and the `assertCanonicalDeliveryQualityPolicy()` evidence read-back
inside `canonicalDelivery()`.

### 37.47.1 Design basis — the audited contradiction

The audit facts are recorded in `document.md` → A1–A13. The load-bearing derivation, recomputed from
the source rather than copied from any log:

| Quantity | Value | Source |
|---|---|---|
| salesperson sub-limit | 110000 cents | `...wave10-concurrency.integration.js:494` → `seedProfile()` `w10-profile-a` |
| canonical obligation | 100000 cents | price-list version `unit_price_cents = 100000` × quantity 1 |
| committed salesperson exposure `E` | 100000 cents | `computeCreditExposure()` — SO-commitment and delivered-not-settled stages released, final unpaid AR carries it once, provably attributable |
| `available = limit - E` | 10000 cents | `readAuthoritativeCapacity()` |
| each proposed delta | 20000 cents | `:518`, `:525-526` |
| `classifyCapacity({10000, 20000, 20000})` | **`NEITHER_FITS`** | fixture `:647-655` |

The contradiction is value-independent. `:521` requires `ONLY_ONE_FITS`, which under the
`W10-AIR-R05` algebra means `available >= 20000`; `:522` requires `exposureCents + 20000 >
limitCents`, which means `available < 20000`. The two requirements are mutually exclusive, so the
pair can never hold — for any limit, exposure or delta the fixture could be given.

Three independent facts converge on `NEITHER_FITS` as the correct classification:

1. **The algebra.** `W10-AIR-R05` in `document.md` states the three-way classification table verbatim
   and adds *"The expected winner count follows that computed classification."* M-R09's expected winner
   count is 0 (`:529-534` requires **both** contenders to be refused), and only `NEITHER_FITS` has an
   expected winner count of 0.
2. **The approved case matrix.** `solution.md` §37.39.6.2 describes M-R09 as *"aggregate passes;
   sub-limit exposure=50, proposal=70>60 and blocks"*. The case never claims a winner.
3. **The production refusal path.** `credit-check.js:807` computes `overLimit` from
   `exposureCents + proposedDeltaCents > limitCents`; the salesperson scope emits `OVER_LIMIT`
   (`:830-835`) and never `UNPROVEN_ATTRIBUTION` for a provable attribution (`:813-817`).

`ONLY_ONE_FITS` is the M-R05 / M-R06 serialization semantics — two contenders competing for a
sufficiently large remaining ceiling, one of which must win. M-R05 (`:400`), M-R06 (`:418`),
`B-M10` (gate-b `:117`) and `B-M15` (gate-b `:203`) all start from **zero committed exposure**, so
`available` genuinely exceeds each single delta while their sum exceeds it. M-R09 is the only case in
the repository whose committed exposure makes the remaining capacity smaller than each proposal. The
literal at `:521` is a mis-planted M-R05/M-R06 semantic on a case whose entire purpose is that the
proposal is blocked.

### 37.47.2 Option comparison

**Option A — correct the expected classification literal (CHOSEN).** Replace `'ONLY_ONE_FITS'` with
`'NEITHER_FITS'` in the M-R09 assertion and make the available-capacity precondition explicit. The
test then states the canonical algebra it was already written against.

**Option B — retune the fixture limit or exposure (REJECTED — arithmetically impossible).** To make
`:521` pass, `available` must be at least 20000; `:522` then fails, because `available < 20000` no
longer holds. No fixture value satisfies both. Repairing the pair would require deleting or rewriting
`:522` — the `the proposal must exceed the sub-limit` assertion that carries the case's refusal
intent. That is a test weakening (prohibited by `W10-MR09-R10` and AGENTS.md §10) and it would
delete the very fact M-R09 exists to prove.

**Option C — retune the proposed deltas (REJECTED — changes the tested business fact).** Making one
delta fit and the other not yields `ASYMMETRIC`, the fourth branch of `classifyCapacity`, a case that
does not exist in the approved matrix and one in which exactly one proposal may proceed — the
opposite of M-R09's contract that both are refused. It would also change the two concurrent requests
that `W10-MR09-R05` requires be preserved.

**Option D — relax, skip, comment out or replace the assertion with a hardcoded PASS (REJECTED).**
Prohibited by `W10-MR09-R10`, by `W10-AIR-R05` ("A constant copied from seed input is not proof") and
by AGENTS.md §10. It masks the defect instead of correcting the contract.

**Option E — change the production classification algebra or the Credit refusal (REJECTED).**
`classifyCapacity()` mirrors the `W10-AIR-R05` table verbatim, and the production scope evaluation at
`credit-check.js:807-837` implements the same rule. Changing either would alter the Credit business
semantics and an approved Requirement, which this stage explicitly forbids, and would affect M-R01,
M-R05, M-R06, `B-M10` and `B-M15` as well.

### 37.47.3 Chosen design — the exact assertion correction

The entire Implementation is confined to the single assertion block of the single M-R09 case in
`server/mysql-sales-customer-wave10-concurrency.integration.js`:

1. The expected classification literal becomes `'NEITHER_FITS'`.
2. One explicit available-capacity precondition is inserted immediately before the classification
   assertion, so the expected classification is derivable **at the assertion site** instead of
   requiring the reader to reconstruct the algebra across four lines.

The precondition is `capacity.available < 20000`. For the two deltas of this case (both 20000) that
is exactly the `NEITHER_FITS` condition of `classifyCapacity()` — `da > available AND db > available` —
and it is the same inequality `:522` already states in limit-relative form. It introduces no new
constant and no seed-derived truth: `capacity.available` remains the value computed by
`readAuthoritativeCapacity()` from the effective Profile and the persisted exposure, and `20000` is
the delta literal already used twice in the same block.

**Why the precondition is added rather than the bare literal change.** The root cause of the defect is
structural, not a typo: an opaque classification literal sat next to a contradicting inequality with
no statement of the precondition that determines the classification, so no reviewer could check the
expectation against the case's intent without re-deriving the whole capacity chain. The added line
makes the derivation local and self-evident, and it is **additive evidence** — if the committed
exposure ever changed so that `available >= 20000`, the precondition fails loudly instead of
silently mis-classifying. It changes no test semantics, weakens no assertion and skips nothing.

### 37.47.4 Why this is an assertion correction, not a production behaviour change

1. **No production file is modified.** `server/app.js`, `server/modules/credit-check.js`,
   `server/modules/credit-profile.js`, `server/modules/quality-gates.js` and
   `server/modules/traceability-quality.js` are not in the change list.
2. **The production algebra is unchanged and canonical.** `W10-AIR-R05` states the same three-way
   table that `classifyCapacity()` implements, and the production scope evaluation at
   `credit-check.js:807-837` applies the same `exposure + delta > limit` rule. Nothing about the
   classification is redefined.
3. **The refusal contract asserted after the correction is already the production contract.**
   `evaluateCreditCheck()` raises HTTP 409 `CREDIT_CHECK_BLOCKED` with the production `reasonCodes`
   inside the production transaction (`credit-check.js:1091-1101`), and the salesperson scope takes the
   ordinary capacity branch that emits `OVER_LIMIT` (`:830-835`) while a provable attribution keeps
   `UNPROVEN_ATTRIBUTION` off the reason list (`:813-817`).
4. **The change only makes the test agree with the algebra it was already written against.** No
   business rule, permission, state machine, audit or idempotency contract is defined, redefined,
   relaxed or re-routed.
5. **The change is one literal plus one additive assertion.** Nothing is added to, removed from or
   reordered in the production request path.

### 37.47.5 The preserved M-R09 business and concurrency assertions

The following are preserved **verbatim** and remain in force:

| Assertion | Location | Meaning preserved |
|---|---|---|
| `committed.status === 'APPROVED'` | `:501` | the obligation was created by the canonical approval path |
| `assert.equal(Number(receivable.amount_cents), obligation)` | `:512` | the final AR equals the canonical obligation |
| `assert.equal(Number(receivable.open_amount_cents), obligation, 'the AR must stay unpaid')` | `:513` | the AR is final and unpaid |
| `assert.equal(receivable.item_class, 'SOURCE')` | `:514` | the AR is a source-level receivable |
| `assert.equal(receivable.item_kind, 'FINAL')` | `:515` | the AR is the final recognition |
| `assert.equal(capacity.exposureCents, obligation, ...)` | `:519` | the transition leaves the obligation in the AR stage — exposure conservation |
| `assert.equal(capacity.available, capacity.limitCents - obligation)` | `:520` | available is derived from the effective limit and the actual exposure |
| `assert.ok(capacity.exposureCents + 20000 > capacity.limitCents, 'the proposal must exceed the sub-limit')` | `:522` | each proposal is refused by the sub-limit |
| `assert.ok(waits.length >= 2, ...)` | `:528` | both contenders are observably pending at the L0 coordination boundary |
| `assert.equal(httpStatus(outcome), 409, ...)` | `:530` | the production HTTP refusal contract |
| `assert.equal(outcome.code, 'CREDIT_CHECK_BLOCKED', ...)` | `:531` | the production refusal code |
| `reasonCodes.includes('OVER_LIMIT')` | `:532` | the refusal is the capacity failure |
| `!reasonCodes.includes('UNPROVEN_ATTRIBUTION')` | `:533` | the AR attribution stays provable |
| `assertWave10ProjectionDeltaEmpty(before, after, 'M-R09 blocked evaluations')` | `:536` | zero forbidden persistent delta |
| `assertNoDuplicateEffects(db)` | `:537` | no duplicate check-result group, no duplicate approval authority |

The canonical chain itself is untouched: `canonicalApprovedOrder()` (canonical create → submit →
approve), `canonicalDelivery()` with `billingMode: 'LEGACY_DIRECT'` (real HTTP `POST
/api/sales-deliveries` → confirm), the SUBMITTED proposal `w10-r9-new` of 20000 cents, the two
coordinated `evaluateEndpoint()` requests of 20000 cents each, and the `assertCanonicalDeliveryQualityPolicy()`
evidence read-back inside `canonicalDelivery()`.

### 37.47.6 What this Design does not change

- **M-R01, M-R05, M-R06, `B-M10`, `B-M15`** — their `ONLY_ONE_FITS` expectation is correct and is not
  touched in any way. `server/mysql-sales-customer-wave10-concurrency.integration.js:68`, `:182-184`,
  `:400`, `:418` and `server/mysql-sales-customer-wave10-gate-b.integration.js:117`, `:203` stay
  byte-for-byte identical.
- **The limit, the exposure and the delta values** — 110000, 100000 and 20000/20000 stay as they are.
- **The fixture** — `server/test-utils/wave10-mysql-acceptance-fixture.js` is not modified at all:
  not `classifyCapacity()`, not `readAuthoritativeCapacity()`, not `seedWave10AcceptanceBase()`, not the
  quality-policy helpers.
- **The OQC Fixture Implementation** — preserved as approved.
- **The runners, the manifest, the guard, the lease, the protected target, the case identifiers, the
  evidence levels and the M-board shape** — unchanged. M-R09 is a `GATE-B-PRODUCTION-RACES` case, not one
  of the seven `GATE-B` suite-2 identities, so no evidence record or M-board shape is affected.
- **Schema, migrations, package files, `README.md` and the release tags** — unchanged.

### 37.47.7 Intended implementation file list and the exact intended diff (not yet modified)

| File | Change | Production behaviour change |
|---|---|---|
| `server/mysql-sales-customer-wave10-concurrency.integration.js` | the M-R09 classification expectation, plus one additive available-capacity precondition | none |
| `log/2026-10-26.md` | this Design record (append-only) | none |

**Explicitly not modified:** `server/app.js`, `server/modules/credit-check.js`,
`server/modules/credit-profile.js`, `server/modules/quality-gates.js`,
`server/modules/traceability-quality.js`, `server/modules/sales-orders.js`,
`server/test-utils/wave10-mysql-acceptance-fixture.js`,
`server/mysql-sales-customer-wave10-gate-b.integration.js`,
`server/mysql-sales-customer-wave10-business-matrix.integration.js`,
`server/sales-customer-wave10-quality-policy.test.js`, `scripts/testing/test-suites.js`,
`scripts/gates/**`, `server/migrations/**`, `server/database/**`, `package.json`, `README.md`,
`document.md` (the Requirement phase is already recorded), `AGENTS.md`, `CLAUDE.md`.

The exact intended diff, **not executed**:

```diff
--- a/server/mysql-sales-customer-wave10-concurrency.integration.js
+++ b/server/mysql-sales-customer-wave10-concurrency.integration.js
@@ -518,7 +518,8 @@ test('M-R09 — the canonical SO→AR transition stays in the salesperson exposure an
     const capacity = readAuthoritativeCapacity(db, { salespersonId: 'w10-race-sp-a', deltaA: 20000, deltaB: 20000 });
     assert.equal(capacity.exposureCents, obligation, 'the transition must leave the obligation in the AR stage');
     assert.equal(capacity.available, capacity.limitCents - obligation);
-    assert.equal(capacity.classification, 'ONLY_ONE_FITS', 'the sub-limit classification must be computed from the actual exposure');
+    assert.ok(capacity.available < 20000, 'each proposed delta must exceed the available sub-limit capacity');
+    assert.equal(capacity.classification, 'NEITHER_FITS', 'the sub-limit classification must be computed from the actual exposure');
     assert.ok(capacity.exposureCents + 20000 > capacity.limitCents, 'the proposal must exceed the sub-limit');
     const before = captureWave10PersistenceProjection(db);
     const { outcomes, waits } = await runCoordinatedWave10Race([a, b, c], registrations, [
```

Net effect: one literal corrected, one precondition assertion inserted, no assertion removed, no
message deleted, no other line touched. The assertion message text is preserved verbatim so the
failure text a reader sees for the classification remains the same phrase as before.

### 37.47.8 Regression plan and evidence level

| Gate | Command | Expected |
|---|---|---|
| Shared-fixture regression | `node --test server/sales-customer-wave10-quality-policy.test.js` | 4 tests / 4 pass — unchanged, it shares the fixture module |
| FAST | `pnpm.cmd test:fast` | pass, no skip / todo / cancelled |
| FULL | `pnpm.cmd test` | pass, no skip / todo / cancelled |
| build | `pnpm.cmd build` | PASS |
| whitespace | `git diff --check` | exit 0 |

**Evidence level.** This is a **test-contract** correction. The corrected M-R09 case can only be
evaluated by the protected real-MySQL Gate B campaign, which this stage does not authorize and did not
run. The M-R09 real-MySQL evidence therefore remains `TEST_EVIDENCE_PENDING`; this Design claims no
Gate B PASS, no Wave 10 Acceptance and no Freeze.

**Open observation, not a scope expansion.** `classifyCapacity()` is currently reachable only through
`readAuthoritativeCapacity()` inside the MySQL-gated suites; there is no engine-neutral local
regression over the classification algebra itself. A local SQLite regression over the algebra would
have made this contradiction visible without a MySQL campaign. Adding one is a separate Requirement and
is deliberately **not** part of this authorized Implementation.

### 37.47.9 Rollback, compatibility and hard stop

**Rollback.** The change is confined to one assertion block in one test file. A plain revert of that
file restores the previous state. No schema, migration, data, external system or persistent state is
involved, so there is no database-side rollback and no partially applied state to reconcile.

**Compatibility.** Unchanged: the production Credit engine, the capacity classification algebra, the
exposure projection, the production refusal contract, the Finance recognition writers, the canonical
HTTP routes, the L0 and L1–L8 lock order, READ COMMITTED isolation, permissions, status machines, audit
and idempotency contracts, the Wave 9 freeze, the Gate A freeze, the Gate B case identities and
evidence levels, the M-board shape, the package version and the release tags.

**Hard stop.** Design ends here. Implementation requires a separate explicit authorization under
AGENTS.md §4.4. This stage executed no MySQL connection, no Gate B run, no Git write operation and no
source-code modification.

**Status: `WAVE10_MR09_CONTRACT_DESIGN_READY`.**

## 37.48 Wave 10 CHECK clause parity normalization design (2026-10-26)

### 37.48.0 Authorization and boundary

The user confirmed the gap `WAVE10_PARITY_CHECK_CLAUSE_ESCAPE_NORMALIZATION_ABSENT` and authorized one
consecutive `AUDIT / COVERAGE CONFIRMATION -> REQUIREMENT -> DESIGN` stage with a mandatory HARD STOP
at the end of Design. This section records the Design phase only. The Requirement phase is
`document.md` -> "Wave 10 CHECK clause parity normalization Requirement (2026-10-26)".
**Implementation is not authorized by this stage.** Real MySQL access, any Gate B or Wave 10
Acceptance re-run, Git writes, credential operations, production CHECK definitions, DDL, migrations,
business code, the Gate runner / manifest, the OQC fixture remediation, the `M-R09` assertion and
Wave 11 remain outside this Design.

### 37.48.1 Design basis — what the audit proved and what it did not

The audit facts are recorded in `document.md` -> A1..A18. The load-bearing ones, restated from the
source rather than copied from any log:

| Fact | Consequence for the Design |
|---|---|
| A2, A3 | the MySQL-side text really carries backslash-escaped quote delimiters; the transport is lossless, so the bytes are the server's own |
| A4, A5 | the DDL that created the constraints has plain quoted literals, and the SQLite side of the *same* text parsed cleanly |
| A6 | the tokenizer has no backslash branch; `\` is an unsupported token |
| A7 | the unsupported token falls back to `raw:`, which can never equal a parsed canonical form |
| A8 | the only clause that compared equal is the only one without a string literal |
| A9 | the tokenizer supports the SQL-standard doubled-quote escape and no other literal form |
| A11 | the repository never sets `sql_mode`; the session inherits the server default |
| A13 | no column of the eight compared tables uses a case-sensitive collation, so the case-insensitive literal rule is sound here |
| A15, A17 | the local regression is source-text only and models the server rendering by hand; the live rendering differs from that model **only** in the literal quoting |
| A18 | the semantic equivalence is bounded but not closed: the canonical DDL is mode-independent, the server's *rendering convention* is unobserved |

The single load-bearing conclusion: **the divergence is one representational dimension — how a string
literal's quotes are rendered — and it is confined to the acceptance test contract.**

### 37.48.2 Option comparison

**Option A — restricted, provenance-bound escape recognition in the tokenizer (CHOSEN).**
The tokenizer's string-literal branch gains the ability to read a string literal whose delimiters are
backslash-escaped, and only that. The literal's content is taken verbatim; any backslash inside the
content, any unknown escape, and any unterminated literal are unsupported tokens and therefore
fail closed. The literal dialect is an explicit parameter derived from the input's provenance, never
inferred from the bytes.

**Option B — syntax-aware escape normalization before the tokenizer (REJECTED).**
A pre-pass would have to find the string-literal regions itself in order to unescape them safely,
which is a second lexer in front of the first. Two lexers over the same grammar drift, and the
pre-pass is exactly the shape of the forbidden "unconditional global backslash removal" when its
region detection is imperfect: one missed region silently rewrites a constraint. It also cannot
express the requirement that an *unknown* escape must fail closed, because a pre-pass that does not
recognise an escape has no way to distinguish "escaped" from "literal backslash".

**Option C — a unified semantic model for both legal literal representations at the parser layer
(REJECTED as a structural change; its intent is adopted inside Option A).**
Moving literal decoding into the parser means changing the token shape, the parser and the
renderer. That is the largest change of the three and it puts the escape rules in the layer that
decides *structure* rather than in the layer that decides *where a literal ends*. The intent behind
Option C is nevertheless adopted: Option A produces **one semantic literal model** for the two
representations — the decoded content is the same value in both dialects — and the dialect itself is
an explicit, provenance-derived parameter instead of an implicit guess.

### 37.48.3 Chosen design — the literal dialect

The whole Implementation is confined to the acceptance test contract in
`server/test-utils/wave10-mysql-schema-fixture.js` and its local regression.

**1. An explicit literal dialect.** Two dialects are declared:

- `sql_standard` — the dialect of the canonical SQLite DDL source. Inside a `'...'` literal only the
  SQL-standard doubled quote (`''`) denotes a literal quote. A backslash inside a literal is **not**
  a supported form and is fail-closed, because the two dialects disagree about it and the fixture must
  not silently pick one.
- `mysql_catalog` — the dialect of `information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE`. A string
  literal's **delimiters are themselves backslash-escaped**, exactly as captured in A2. The content
  between the escaped delimiters is taken verbatim. A backslash inside the content is fail-closed,
  because the rendering convention for content escapes is not observed (A18) and guessing it could
  merge two different literals.

**2. The dialect is bound to provenance, never to the bytes.** `normalizedSqliteTable()` keeps
reading the canonical SQLite DDL, so its CHECK clauses are decoded in `sql_standard`.
`readNormalizedMySqlTable()` reads the live catalog, so its CHECK clauses are decoded in
`mysql_catalog`. No caller can obtain a MySQL rendering and have it decoded as a SQLite source, or
the reverse, without changing the dialect explicitly.

**3. The tokenizer's literal branch.** Under `sql_standard` the branch keeps its current behaviour
and additionally rejects a backslash inside a literal. Under `mysql_catalog` the branch reads an
escaped delimiter, keeps the doubled-delimiter rule symmetrically, and rejects a backslash inside
the content. In both dialects an **unterminated literal is now an error**: today the scanner runs to
the end of the text and produces a literal (A9), which is a silent acceptance of malformed input.

**4. A retained diagnostic.** `normalizeCheckClause()` keeps its current return type, so no caller
changes. A new exported `describeCheckClauseNormalization(value, options)` returns
`{ form, dialect, canonical, reason }`, where `reason` is the retained parse failure. This is what
makes an unsupported-syntax fallback distinguishable from a representational one (R05) and gives the
fail-closed path a name.

**5. The comparison stays the safety net.** Because a mis-decoded literal produces a *different*
canonical form, the existing `assert.deepEqual(actual.checks, expected.checks)` already refuses to
call an ambiguously decoded clause equivalent. A literal whose content contains a quote cannot be
decoded unambiguously under `mysql_catalog`; it produces a parse failure or a differing canonical
form, and the comparison fails loudly. No additional equivalence shortcut is introduced.

**6. Fail-closed hardening of the standard dialect.** `sql_standard` rejects a backslash inside a
literal rather than accepting it as an ordinary character. Without this, a SQLite source literal
containing a backslash and a MySQL rendering of the same value would decode to different values and
be reported as different constraints — a false negative that is at least safe, but a backslash in the
SQLite source is also the one input for which the two dialects are genuinely ambiguous, so
rejecting it is the honest behaviour rather than a silent coin flip.

### 37.48.4 Why this is a test-contract correction, not a production behaviour change

1. **No production file is modified.** `server/app.js`, `server/modules/**`, `server/migrations/**`
   and `server/database/**` are not in the change list.
2. **No CHECK definition, DDL or migration changes.** The approved CHECK sets of the eight tables
   and their counts (A12) are untouched.
3. **The comparison is not weakened.** `M-MIG-01` and `M-MIG-02` keep their live-database contract;
   the remediation only changes how a clause is read.
4. **The `raw:` fallback is not disabled.** It is retained, remains distinct from every parsed
   canonical form, and gains a retained reason.
5. **No table, column or literal is special-cased.** The rule is generic over the expression grammar.

### 37.48.5 The preserved contracts

- The 23 approved CHECK constraints of the eight tables keep their counts and their canonical forms.
- `M-MIG-01` (`:117`) and `M-MIG-02` (`:410`) keep their scope, their live `information_schema`
  comparison and their `assert.deepEqual` contract.
- The existing local normalizer regressions (`server/sales-customer-wave10-mysql-parity.test.js:113`,
  `:128`, `:146`) keep their intent and keep passing; the `:128` sample set is re-labelled to state
  which dialect each sample is in, and the samples themselves are not weakened.
- The column, foreign-key, index and physical-type parity contracts, and `assertIndexParity()`, are
  untouched.

### 37.48.6 SQL_MODE and the provenance of the input

`sql_mode` governs how the server **parses input DDL**. The canonical DDL uses plain quoted
literals, which denote the same value under every mode, so the enforced constraint is
mode-independent (A18). The repository does not set `sql_mode` at all, so the session inherits the
server default, and the live comparison's own session inherits it too.

What is *not* established is the server's **rendering convention** when it re-prints a stored
expression into `CHECK_CLAUSE`. The Design therefore:

- selects the literal dialect from the input's **provenance** (SQLite DDL source vs. MySQL catalog),
  never from the byte content;
- reads and records the effective `@@session.sql_mode` and `VERSION()` from the live session the
  campaign already uses, so the equivalence is anchored to observed server state;
- **fails closed with a named diagnostic** if the observed mode disables backslash escapes
  (`NO_BACKSLASH_ESCAPES`), because under that mode the server's own literal handling differs and
  the fixture cannot certify the equivalence;
- treats every rendering form outside the captured convention as unsupported, so a future change in
  the server's printing convention surfaces as a named failure rather than as a silent mismatch.

### 37.48.7 Intended implementation file list and the exact intended diff (not executed)

| File | Change | Production behaviour change |
|---|---|---|
| `server/test-utils/wave10-mysql-schema-fixture.js` | the literal dialect, the restricted tokenizer change, the fail-closed unterminated-literal rule, the retained diagnostic, the live mode/version observation | none |
| `server/sales-customer-wave10-mysql-parity.test.js` | the T01..T08 regression contract, built on the **captured** live rendering | none |
| `server/mysql-sales-customer-wave10.integration.js` | **evidence only**: emit the live capture (the raw `CHECK_CLAUSE` bytes per table, `@@session.sql_mode`, `VERSION()`) and refuse a mode that disables backslash escapes | none |

**Why the third file is required, and why it is not a scope expansion.** The captured rendering must
come from a live server (R10). Only `server/mysql-sales-customer-wave10.integration.js` holds a live
MySQL connection during the protected campaign; the fixture is a library and the local regression
never connects. Without a change in that file the capture is never taken and the R10 evidence
cannot exist. The change in it is strictly additive: it emits evidence and refuses one named mode.
**No `M-MIG-01` / `M-MIG-02` assertion, comparison or expectation is modified there**, and no
existing case is added, removed or skipped.

**Explicitly not modified:** `server/app.js`, `server/modules/**`, `server/migrations/**`,
`server/database/**`, `server/test-utils/wave10-mysql-acceptance-fixture.js`,
`server/mysql-sales-customer-wave10-concurrency.integration.js`,
`server/mysql-sales-customer-wave10-gate-b.integration.js`,
`server/mysql-sales-customer-wave10-business-matrix.integration.js`,
`server/sales-customer-wave10-quality-policy.test.js`, `scripts/gates/**`,
`scripts/testing/test-suites.js`, `package.json`, `README.md`, `document.md` (the Requirement phase is
already recorded), `AGENTS.md`, `CLAUDE.md`.

The intended change in the fixture, **not executed**:

```diff
@@ export function normalizeCheckClause(value) {
-export function normalizeCheckClause(value) {
+export function normalizeCheckClause(value, options = {}) {
+  return describeCheckClauseNormalization(value, options).canonical;
+}
+
+export function describeCheckClauseNormalization(value, options = {}) {
+  const dialect = options.dialect ?? CHECK_LITERAL_DIALECT.SQL_STANDARD;
   const text = String(value || '')
     .replace(/`/g, '')
     .replace(/_utf8mb4|_utf8|_binary/gi, '')
     .replace(/\s+/g, ' ')
     .trim();
-  if (!text) return '';
+  if (!text) return { form: 'empty', dialect, canonical: '', reason: 'empty clause' };
   try {
-    const tokens = tokenizeCheckClause(text);
+    const tokens = tokenizeCheckClause(text, dialect);
     const parser = new CheckClauseParser(tokens);
     const expression = parser.parseExpression();
     if (parser.index !== tokens.length) throw new CheckClauseSyntaxError('trailing tokens');
-    return renderCheckClause(expression);
+    return { form: 'canonical', dialect, canonical: renderCheckClause(expression), reason: null };
   } catch (error) {
     if (!(error instanceof CheckClauseSyntaxError)) throw error;
-    return `raw: ${text.toLowerCase()}`;
+    return { form: 'raw', dialect, canonical: `raw: ${text.toLowerCase()}`, reason: error.message };
   }
 }
@@ function tokenizeCheckClause(text) {
+function tokenizeCheckClause(text, dialect) {
   ...
   if (char === "'") {
+    // the mysql_catalog dialect reads a literal whose delimiters are escaped
+    ...
+    if (dialect === CHECK_LITERAL_DIALECT.MYSQL_CATALOG) { ... }
   }
 }
```

The net effect of the fixture change: one dialect parameter, one restricted literal branch, one
fail-closed rule for an unterminated literal, one retained diagnostic. The `raw:` prefix, the
canonical renderer and every existing caller keep their current behaviour for text that already
parses.

### 37.48.8 Regression contract

| Case | Assertion |
|---|---|
| **T01** | a plain SQLite CHECK and its corresponding MySQL rendering normalize to one identical canonical form (the existing `:128` sample set, re-labelled by dialect) |
| **T02** | the **captured live** MySQL escaped-literal rendering and the canonical SQLite form normalize to one identical canonical form, with every literal value preserved |
| **T03** | CHECKs with different `IN` member sets, different literal values and different operand sets stay different (the existing `:146` set plus captured variants) |
| **T04** | a different comparison operator, `AND` against `OR`, `NOT` against its operand and the presence against the absence of a `NULL` predicate all stay different |
| **T05** | a doubled quote, an escaped quote, a lone backslash, a doubled backslash, an abnormal quote and an illegal escape are never merged: each either decodes to its own distinct value or fails closed, and no two different inputs normalize alike |
| **T06** | an unsupported syntax, an unsupported escape and an unterminated literal each produce the `raw:` form **with a retained reason**, and the `raw:` form never equals a parsed canonical form |
| **T07** | the approved CHECK count of each of the eight tables is unchanged (2 / 2 / 5 / 3 / 1 / 3 / 3 / 4 = 23), and every table's canonical CHECK set is non-empty |
| **T08** | the existing physical parity, index, foreign-key and column-type contracts, and the existing normalizer regressions, are unchanged and still pass |

T02 is only meaningful against the **captured** bytes. The captured rendering is recorded as a
constant in `server/sales-customer-wave10-mysql-parity.test.js`, together with the server version,
the observed `@@session.sql_mode` and the capture date, so the local regression is built on
observed bytes and not on a hand-written model.

### 37.48.9 Conditions that remain to be verified live

These are **not** proven in this stage and must not be reported as proven:

1. the server's exact rendering convention for a string literal whose **content** contains a quote
   or a backslash — no such literal exists in the eight approved tables, so the captured evidence
   cannot decide it; the Design fails closed on it instead of guessing;
2. the effective `@@session.sql_mode` of the acceptance session, which is to be observed and
   recorded during the Implementation;
3. the live `M-MIG-01` / `M-MIG-02` result after the remediation, and the live `W10-RACES` /
   `W10-BUSINESS-MATRIX` results, which remain `TEST_EVIDENCE_PENDING`;
4. that the fixture's canonical form is unchanged for every constraint that already normalizes
   today — this must be shown by the unchanged local regressions, not assumed.

### 37.48.10 Rollback, compatibility and hard stop

**Rollback.** The change is confined to the acceptance test contract in three test-side files. A
plain revert of those files restores the previous state. No schema, migration, data, external system
or persistent state is involved, so there is no database-side rollback and no partially applied state
to reconcile.

**Compatibility.** Unchanged: every production Credit, Finance, Quality and Sales module; every
migration and schema object; the Gate A freeze; the Wave 9 freeze; the Gate B case identities,
evidence levels and M-board shape; the `M-R09` assertion; the OQC fixture remediation; the
package version and the release tags. The canonical CHECK form, the comparison order and the
approved CHECK counts are unchanged for every constraint that already normalizes today.

**Hard stop.** Design ends here. Implementation requires a separate explicit authorization under
AGENTS.md §4.4. This stage executed no MySQL connection, no Gate run, no Git write operation and no
source-code modification.

**Status: `WAVE10_PARITY_CHECK_NORMALIZATION_DESIGN_READY`.**

## 37.49 Wave 10 Final Acceptance blocker consolidated design (2026-10-27)

### 37.49.0 Authorization and boundary

The user reviewed and approved `document.md` -> "Wave 10 Full Acceptance blocker Requirement
(2026-10-27)" §§1–17, including W10-ACC-R09 and W10-ACC-R10, and authorized the **Design** stage
under AGENTS.md §4.3, with CB-1, CB-2 and CB-3 required to form **one** Design and one future
Implementation unit. This section records the Design phase only.

**Not authorized by this stage, and not performed:** Implementation; any test, build, Gate or
campaign execution; any MySQL or DPAPI credential access; any Git write; any change to production
code, schema, migration, manifest, runner or protected case identity; Wave 11; release; deployment.
The Design additionally graded every Coverage Gap and Unverified Risk of the approved Requirement
(§37.49.10) and reported two newly discovered extensions of the CB-2 blast radius (§37.49.3.4).

### 37.49.1 Design basis — what was verified in the source for this Design

| Fact | Source | Consequence for the Design |
|---|---|---|
| The rule-selection predicate | `server/modules/credit-check.js:508-511` — `business_stage=? AND status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`, then the mode filter at `:513-516` | the engine has **no "rule missing" branch**; the only fact it can express is "the rule set offers no rule satisfying (stage ∧ ACTIVE ∧ date-window ∧ mode)" |
| The unenforced outcome | `credit-check.js:667-675` returns `{enforced:false, decision:'PASS', checkGroupId:null, scopeResults:[], reasonCodes:['NO_APPLICABLE_EFFECTIVE_RULE']}` **before** any profile resolution and before any write | the no-rule outcome writes nothing, and the Profile's own attributes are never consulted on that path |
| The switch is a separate, earlier gate | `credit-check.js:650-659` returns `['CREDIT_MANAGEMENT_DISABLED']` | the three unenforced paths are three distinct engine branches |
| The canonical rule contract | `solution.md:26379` — "A stage with no applicable effective rule is **not credit-controlled** (`credit-check.js:667-675`) and leaves no evidence" | the no-rule semantics to preserve are already canonical |
| `credit_check_rules.status` has **no** vocabulary | wave9 migration `:75` (SQLite DDL) and `:170` (MySQL DDL) declare `status` as free text with no CHECK; `credit_parameters.status` is the only credit table with a declared vocabulary (`CHECK(status IN ('DRAFT','ACTIVE','INACTIVE'))`, `:55`/`:160`); no rule-status value set is declared anywhere in `document.md` or `solution.md` | a non-ACTIVE rule status would be an **invented** business value; the effective window is the declared, dated attribute of a versioned rule |
| The referential contract | `credit_profile.rule_id TEXT REFERENCES credit_check_rules(id)` (wave9 `:93`), MySQL DDL `:188`, `ON DELETE NO ACTION` (`mysql-schema.js:202`), enforced (`mysql-schema.js:410`/`:472`) | deleting the rule row is impossible, and SQLite enforces the same FK (`server/db.js:313`) |
| The approval expiry gates | `credit-special-approval.js:169-174` (request) and `:277-282` (decision) compare the expiry against `credit_check_results.business_date`; `credit-check.js:589` compares it again at consumption | the expiry must be **later than the source check's business date**, which is frozen in the result row |
| The production anchor key | `credit-anchor.js:15-23` — `CREDIT_OBJECT|<type>|<id>|CUSTOMER|<customer>|SCOPE:SALESPERSON|<id>` or `|SCOPE:AGGREGATE` | the fixture must not maintain a second format |
| Anchor reuse | `credit-anchor.js:72-90` — insert, catch the duplicate, then `SELECT ... WHERE anchor_key=?` and verify `sameShape` (`:62-70`) | an existing anchor with the canonical key is **reused**, not duplicated |
| Predecessor closure | `credit-profile.js:124-136` — the predecessor is found by `WHERE anchor_id = ?`, and its `effective_to` is set to `previousDate(effectiveFrom)` (`sales-foundation-common.js:36-40`) | the closure operates on the **anchor that actually holds the Profile** |
| Atomicity | `credit-profile.js:148-186` — the anchor resolution, the closure, both INSERTs, the audits and the idempotency record are inside one `transaction()` | "the new version exists" and "the predecessor is closed" are one atomic fact; the ambiguous two-version state is unreachable once the anchor identity is canonical |
| The production Profile writer is already the race actor | `scripts/gates/mysql-concurrency-sales-wave10-worker.mjs:149` — `profile-create` calls `createCreditProfile` | CB-3 needs no new path; only the fixture's anchor identity is wrong |
| The shared fixture is dialect-neutral | the only MySQL-specific code in `server/test-utils/wave10-mysql-acceptance-fixture.js` is the lifecycle factory (`:48`) and the worker helpers (`:174-209`); `seedWave10AcceptanceBase` uses standard SQL and production writers | the fixture's seeding function can be exercised by an engine-neutral local regression |
| The shared fixture already runs on SQLite | `server/sales-customer-wave10-quality-policy.test.js:55-59` builds a SQLite temp DB and calls `seedWave10AcceptanceBase(db, …)` | the R08 local regression has a proven home and pattern |
| The production approval and Profile writers are already covered locally | `server/sales-customer-wave10-credit-check.test.js:170` (`createCreditProfile`), `:988`/`:997` (`requestCreditSpecialApproval` / `decideCreditSpecialApproval`) | the CB-2 and CB-3 local regressions need no new production harness |
| A local "no applicable effective rule" precedent exists | `server/sales-customer-wave10-credit-check.test.js:364` — "S15 — a stage without any effective rule is not credit-controlled" | the engine semantics are already proven locally; the acceptance fixture needs a *richer* expression, and the local regression must cover **both** |
| The approval idempotency contract | `financial-controls.js:44-58` — the same key with a different fingerprint is a 409 | a date-derived body changes the fingerprint; each campaign recreates the schema, and within one run each request is sent once, so no replay conflict arises. Local regressions must use distinct keys per body variant |

### 37.49.2 CB-1 — the `M-BIZ-19` `no-rule` fixture state

#### 37.49.2.1 Option comparison

**Option A — an explicit no-rule seed mode in the shared fixture that produces a legal "no applicable
rule" data relation at database initialization.**

Two sub-forms exist and they are not equivalent.

- **A1 — the rule row is never created** (and the Profile binds no rule). *Rejected.* This is exactly
  what R03 forbids: "The absence of an applicable effective rule must therefore be expressed by the
  rule set not offering one **for this stage on this business date** — never by the rule fact not
  existing." It also destroys the audit trail and would force `credit_profile.rule_id` to NULL,
  degrading the Profile's own rule binding.
- **A2 — the rule row is created complete and real, and its effective window does not cover the case's
  business date.** *Chosen.* The rule stays a real, dated, status-bearing, referenced and auditable
  business object; only the dimension the engine filters on — the effective window — makes the rule
  set offer nothing for this stage on this business date.

**Option B — legally release the reference first, then delete the test rule.** *Rejected.* "Releasing
the reference" is exactly one of the operations R02 prohibits: deleting or nulling the referencing
Profile, or re-pointing it. It also violates R03 ("never by the rule fact not existing") and produces
an unauditable deletion of a business fact. It is the current defect, split into two steps.

**Option C — set the rule to a non-applicable state (inactive).** *Rejected in this form.* It would
satisfy R02, but `credit_check_rules.status` carries **no CHECK constraint and no declared value set**
anywhere in the repository (see §37.49.1). The fixture would have to invent a status value that the
canonical schema does not declare, which is weaker than a declared, dated attribute and directly
invites the "inactive-rule substitutes a missing-rule" objection the user raised.

#### 37.49.2.2 The proof that the chosen state is the same fact, not a substitute

The engine's applicability predicate (`credit-check.js:508-516`) is the conjunction of four
conditions — stage match, `status='ACTIVE'`, the effective window, and the recognition-mode match.
The engine has **no branch for a missing rule**. Its single unenforced-by-rule outcome is
"the rule set offers no rule that satisfies the conjunction", and the reason code names exactly that:
`NO_APPLICABLE_EFFECTIVE_RULE`.

Therefore, for the engine and for every consumer of `evaluateCredit`:

- a rule that does not exist and a rule that exists but fails one conjunct are **the same observable
  fact** — identical return shape, identical reason code, identical zero writes, identical zero
  evidence, identical `checkGroupId: null`;
- the two differ only in their **audit trail**: the absent rule cannot answer "was there a rule for
  this stage, and if so which version and why was it not applied?", while the retained rule can.

There is consequently no "missing-rule state" at the engine boundary for an inactive rule to
substitute. The objection is refuted on the engine's own contract, and the retained-rule form is
strictly the more auditable of the two — which is precisely what R03 requires.

**Why the effective window, and not the stage.** Changing the rule's `business_stage` would make the
Profile's `rule_id` binding incoherent for the stage being checked, and the fixture's `stage`
parameter drives both the rule's stage and the case's check stage, so a second stage parameter would
be needed. The effective window is a declared attribute of every versioned rule, is already how the
engine selects, and requires exactly one changed column.

**Why the effective window, and not an expiry.** `effective_to` would require a second derived date
and would additionally have to satisfy `CHECK(effective_to IS NULL OR effective_to>=effective_from)`.
A future `effective_from` leaves `effective_to` NULL, so the rule is fully in force from a declared
date, and only one column changes.

**Why the horizon is six months and not one day.** The rule's `effective_from` is read when the
fixture seeds it; the check's `business_date` is read later. The largest possible divergence is one
UTC day. A one-day horizon would be unsafe (a midnight crossing would make the rule effective and the
case would fail); the existing six-month convention leaves roughly 180 days of margin, so no
midnight crossing can make the rule effective.

#### 37.49.2.3 Chosen design

1. **One new optional fixture parameter.** `seedWave10AcceptanceBase(db, { …, ruleMode = 'EFFECTIVE' })`
   accepts two values:
   - `'EFFECTIVE'` (the default, and the behaviour of every existing lifecycle): the seeded rule keeps
     `effective_from = '2026-01-01'`. This literal is a **past** date and is therefore calendar-stable
     for every future run — it is deliberately **not** changed to a derived date, because that would
     alter the seeded fact of all 23 lifecycles without removing any risk.
   - `'NOT_YET_EFFECTIVE'`: the seeded rule keeps **every** declared attribute — `rule_code`,
     `business_stage`, `scenario`, `check_timing`, `control_strength`, `credit_item`,
     `recognition_mode`, `status = 'ACTIVE'`, `result_payload_json`, `created_at`, `created_by` — and
     only its `effective_from` moves to `wave10FutureBusinessDateFrom(wave10BusinessDate())`, with
     `effective_to` left NULL.
2. **`M-BIZ-19` changes.** The `no-rule` variant passes `ruleMode: 'NOT_YET_EFFECTIVE'`; the
   `DELETE FROM credit_check_rules WHERE id='w10-race-rule'` statement is **removed**. The `disabled`
   variant keeps the default seed mode, so the two variants differ only in the switch.
3. **The zero-side-effect assertion is preserved unchanged.** The rule row is seeded **before** the
   case captures its `before` projection, and the evaluation writes nothing, so
   `assert.deepEqual(captureWave10PersistenceProjection(db), before)` continues to hold, including for
   the `credit_check_rules` rows that the projection family `P-CREDIT` covers.
4. **The three unenforced paths stay distinguishable, and the distinction becomes machine-checked.**
   The two assertions of the `no-rule` variant are kept verbatim, and the reason code is added to both
   variants: `['CREDIT_MANAGEMENT_DISABLED']` for `disabled` and `['NO_APPLICABLE_EFFECTIVE_RULE']` for
   `no-rule`. This is a **strengthening**, disclosed as such: R04 requires the three facts to be
   distinguishable and named, and the reason code is the engine's own expression of which gate was
   taken. No assertion is removed, weakened, skipped or reclassified, and the case identity, the
   manifest entry, the evidence level and the M-board shape are untouched.
5. **Test-preparation DML versus production business action.** The rule's effective window is a
   *declared reference fact* of the fixture, in the same class as the seeded rule row, the parameter
   row, the Profile rows and the lock anchors — it substitutes no business transition. The case still
   reaches the real resolver: `runCheck` calls the production `evaluateCredit`, which performs the
   real stage/ACTIVE/date/mode selection. Nothing bypasses the Credit Rule Resolver.

#### 37.49.2.4 Compatibility of the chosen design

- **The other 19 business-matrix cases:** unaffected. The default mode is byte-identical to today's
  seed, and the `no-rule` mode is used by exactly one lifecycle.
- **The other 12 race cases and the 7 Gate B cases:** unaffected. Neither suite passes `ruleMode`, and
  the seeded rule keeps `effective_from = '2026-01-01'`.
- **The default fixture and Gate B compatibility:** the default seed mode is unchanged, so
  `server/sales-customer-wave10-quality-policy.test.js`, which calls `seedWave10AcceptanceBase`, sees
  exactly the same data as before.
- **SQLite/MySQL consistency:** the change is one column value in one prepared INSERT. The fixture's
  seeding SQL contains no dialect branch; the date helper is pure calendar arithmetic on a
  `'YYYY-MM-DD'` string.
- **Referential integrity:** the Profile's `rule_id` still resolves to the rule row; no statement in
  the corrected setup deletes, orphans or re-points a referenced row; the FK and its
  `ON DELETE NO ACTION` behaviour are unchanged in the canonical schema and in the migrated schema.
- **Production impact:** none. No production code, schema, migration, constraint, permission, state
  machine, audit or idempotency contract changes.

### 37.49.3 CB-2 — the date-stable Special Approval expiry

#### 37.49.3.1 Chosen design — one controlled business date per case

The governing idea is that **each case owns exactly one controlled business date**, and that date is
the single source for both the credit check and the expiry derivation. The expiry is therefore a
**pure function of a value**, not a second reading of the clock.

1. **One new pure fixture export.**
   `wave10FutureBusinessDateFrom(baseBusinessDate, months = 6)` takes a `'YYYY-MM-DD'` string and
   returns a `'YYYY-MM-DD'` string, using UTC calendar arithmetic only. Its contract is stated as an
   invariant it enforces on itself: the result must be a valid calendar date **strictly later** than
   the base; if it is not, the helper throws rather than returning an unusable value.
2. **`wave10FutureBusinessDate(months = 6)` is replaced** by the pure helper. Zero-caller proof: the
   only two call sites in the repository are `server/mysql-sales-customer-wave10-business-matrix.integration.js:234`
   and `:239`, and both change under this Design. The old helper re-reads the clock, which is exactly
   the property that must be removed.
3. **`M-R02` uses one controlled business date.**
   ```js
   const businessDate = wave10BusinessDate();
   const expiryBusinessDate = wave10FutureBusinessDateFrom(businessDate);
   ```
   `businessDate` is passed into `creditInput({ orderId: 'w10-r2-order', businessDate })` for the
   evaluation, and the **same** `expiryBusinessDate` value goes into the request body (`:292`) and the
   decision body (`:296`). The two fixed `'2026-12-31'` literals disappear.
4. **`B-M12` (Gate B) uses the file's own controlled business date.** The Gate B suite already freezes
   its business date at `'2026-10-25'` (`server/mysql-sales-customer-wave10-gate-b.integration.js:37`).
   The expiry is derived from that same frozen date, so the file's controlled business date, its
   profile effective dates and its approval expiry all stay mutually consistent, and the case's
   business semantics are unchanged. The two fixed `'2026-12-31'` literals at `:172` and `:180`
   disappear.
5. **`M-BIZ-04` computes its expiry once.** The request (`:234`) and the decision (`:239`) currently
   call `wave10FutureBusinessDate()` **twice**, which reads the clock twice; the two calls can
   straddle a UTC month boundary and yield different dates. It now derives one expiry from one
   controlled business date and uses it in both places. This is the refinement of R09 that R09's own
   acceptance condition 4 preserves ("`M-BIZ-04` … already uses the derived form and must keep using
   it"); it is disclosed here because it is a second file touched by CB-2.
6. **Nothing else changes.** The approval amounts (`requestedOverrideCents` 50000,
   `requestedCeilingCents` 100000, the approved equivalents), the authority ceiling, the requester /
   approver separation, the idempotency keys and the whole race structure are untouched. The
   production date validations (`credit-special-approval.js:169-174` and `:277-282`) are **not**
   modified, the expiry stays a bounded, audited business attribute of the approval, and the expiry is
   never made permanent or unbounded.

#### 37.49.3.2 Cross-year analysis

The production gate is `requestedExpiryBusinessDate < result.business_date` — only a **strictly
earlier** expiry is refused, so an expiry equal to the business date is accepted.

| Controlled business date `B` | Derived expiry `E = B + 6 months` (UTC) | `E > B` | The old literal `'2026-12-31'` against `B` |
|---|---|---|---|
| `2026-10-27` | `2027-04-27` | yes | accepted — `2026-12-31 > 2026-10-27` |
| `2026-12-31` | `2027-06-30` (June has 30 days, so the month addition clamps from 31 to 30) | yes | accepted — equal to `B`, and the gate refuses only a **strictly** earlier date |
| `2027-01-01` | `2027-07-01` | yes | **refused** — `2026-12-31 < 2027-01-01` → `CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST` |
| `2028-02-29` | `2028-08-29` (August has 31 days, no clamping) | yes | **refused** — `2026-12-31 < 2028-02-29` |

The cliff therefore starts at `2027-01-01`, exactly as the approved Requirement states, and the
derived expiry is valid on every one of the four required dates and on every date in between. The
month-addition clamping (a 31-day source month clamps to the last day of the target month) never
threatens the invariant: the clamped result is still about five months ahead of the base, so the
helper's own "strictly later" guard can never fail for a legal input.

These four dates are not prose: they are the negative and positive regression cases specified in
§37.49.7 (AC-05, AC-06).

#### 37.49.3.3 UTC and drift analysis

- **No second clock reading.** After the change the expiry does not read the clock at all; it is a pure
  function of the case's controlled business date. The only remaining clock dependence is `B` itself,
  read once per case.
- **No request/decision drift.** The request body and the decision body carry the same computed value,
  so the approval's requested and approved expiry can never disagree — which also removes the
  month-boundary drift that `M-BIZ-04` had and that a naïve "derive from now" implementation would
  reintroduce.
- **No midnight sensitivity at the comparison.** The production gate compares the expiry against
  `credit_check_results.business_date`, which is the **frozen** `B` of the source check. Both sides of
  that comparison are therefore derived from the same `B`, so a campaign that crosses 00:00 UTC
  between the evaluation and the request cannot change the outcome.
- **The consumption path.** `credit-check.js:589` re-compares `approved_expiry_business_date` against
  the consuming check's business date, which is the same `B`; `E > B` holds there as well.
- **The idempotency fingerprint.** A date-derived body changes `requestFingerprint`. A replay of the
  same key with a different body is a 409 (`financial-controls.js:57`). Within one campaign each
  request is sent once, and every campaign recreates the target schema, so no stale
  `idempotency_records` row can collide. The local regressions must use distinct keys per body
  variant.

#### 37.49.3.4 Blast radius of CB-2 — a newly discovered extension

The approved Requirement's CB-2 evidence named `server/mysql-sales-customer-wave10-concurrency.integration.js:292,296`.
A repository-wide search during this Design found **the same fixed `'2026-12-31'` expiry in the Gate B
suite** at `server/mysql-sales-customer-wave10-gate-b.integration.js:172,180` (case `B-M12`), and the
same literal in the **local** credit test at
`server/sales-customer-wave10-credit-check.test.js:993,1001,1058,1066,1093,1101,1122,1167,1193`.

- **`B-M12` is in scope and is fixed.** The Gate B suite is part of the protected acceptance
  infrastructure, it requests and approves a Special Approval expiry, and the user's Design
  instruction is to eliminate the fixed `2026-12-31`. R09's own wording — "**Any** Special Approval
  expiry that the acceptance suite requests or approves must remain valid on every calendar date" —
  already covers it, so no Requirement amendment is required. Note that `B-M12` is not itself a
  calendar cliff, because its source business date is frozen at `'2026-10-25'`; the literal is
  nevertheless removed so that the acceptance infrastructure carries no execution-deadline literal at
  all, and so that the Gate B file's expiry is derived from its own controlled business date.
- **The local credit test is explicitly out of scope and is deferred.** Its business date is frozen at
  `'2026-10-24'`, so its literal is never a cliff; changing fourteen literals there would enlarge the
  diff without removing a risk. It is graded as DEFERRABLE_WITH_JUSTIFICATION in §37.49.10.

### 37.49.4 CB-3 — the canonical Profile anchor and the version chain

#### 37.49.4.1 Chosen design

1. **The fixture stops maintaining a second anchor-key format.** `seedProfile` in
   `server/test-utils/wave10-mysql-acceptance-fixture.js` builds its `credit_lock_anchors.anchor_key`
   with the production `creditObjectAnchorKey()` imported from `server/modules/credit-anchor.js`.
   The fixture already imports production modules (`resolveEffectiveCreditProfile`,
   `computeCreditExposure`, `upsertSalesParameters`, `createQcp`), so this is consistent with
   existing practice and removes the possibility of the two formats drifting again.
2. **Both scopes are checked.**
   - **AGGREGATE:** `creditObjectAnchorKey({ customerId:'w10-race-customer', salespersonId:null,
     creditObjectType:'SALES_ORDER', creditObjectId: W10_OBJECT })` yields
     `CREDIT_OBJECT|SALES_ORDER|W10-RACE-OBJECT|CUSTOMER|w10-race-customer|SCOPE:AGGREGATE` —
     **byte-identical to the fixture's current value**. The aggregate anchor row, the aggregate
     Profile and every aggregate-scope case are therefore completely unchanged.
   - **SALESPERSON:** the same call with `salespersonId:'w10-race-sp-a'` yields
     `…|SCOPE:SALESPERSON|w10-race-sp-a`, where the fixture currently writes `…|SCOPE:w10-race-sp-a`.
     This single string is the whole fix.
3. **The consequence.** `ensureCreditLockAnchor` (`credit-anchor.js:72-90`) now finds the fixture's
   anchor row instead of provisioning a second one, so `closePredecessorAndAssertNoOverlap`
   (`credit-profile.js:124-136`) operates on the anchor that actually holds the seeded Profile, and the
   predecessor **is** closed. `sameShape` (`credit-anchor.js:62-70`) holds, because the fixture's anchor
   row carries exactly the shape the production call derives — anchor type `CREDIT_OBJECT`, the same
   customer, the same salesperson (or NULL for the aggregate scope), the same credit object type and
   id, and NULL policy-scope columns — so no `CREDIT_ANCHOR_SHAPE_CONFLICT` can arise. The insert inside
   `ensureCreditLockAnchor` now hits the UNIQUE `anchor_key` and is handled by that function's own
   duplicate handler before its SELECT fallback resolves the row; this is exactly the path the
   aggregate scope already exercises today, so no new mechanism is introduced.
4. **The anchor row identity and the FK are unchanged.** The anchor rows keep their ids
   (`w10-anchor-agg`, `w10-anchor-a`) and the Profile keeps its `anchor_id` foreign key, so there is
   no schema change, no migration, no new constraint and no FK change. Only the salesperson-scope
   `anchor_key` string changes.

#### 37.49.4.2 The verdict on the existing `2026-12-31` effective date — it must not be moved

`M-R08` creates the new Profile version with `effectiveFrom: '2026-12-31'`
(`server/mysql-sales-customer-wave10-concurrency.integration.js:476`). The answer is that this literal
**stays**:

1. **The atomicity proof removes the ambiguity.** `createCreditProfile` (`credit-profile.js:148-186`)
   performs the anchor resolution, the predecessor closure, the Profile INSERT, the rating INSERT, the
   audits and the idempotency record inside **one** `transaction()`. "The new version exists" and "the
   predecessor is closed" are therefore the same atomic fact. The state "two Profiles qualify for the
   same scope and business date" is unreachable once the anchor identity is canonical — it can only
   arise from a create that never committed, and then the new Profile does not exist either.
2. **The windows are disjoint for every business date.** The predecessor becomes
   `['2026-01-01', '2026-12-30']` and the new version `['2026-12-31', ∞)`, because
   `previousDate('2026-12-31') = '2026-12-30'`. Exactly one of them qualifies on any date, so the case
   is date-stable **without** moving the literal.
3. **The literal is a declared business fact, not an execution deadline.** It is the effective date of
   the version the case creates. Moving it to a derived date would make the case's business content
   depend on the run date — the same anti-pattern R09 forbids for expiries — and would make the
   version boundary unpinnable.
4. **Keeping it keeps the boundary testable.** The local regression can assert the resolution
   *pinned* to the boundary: a business date of `2026-12-30` resolves the old version and `2026-12-31`
   resolves the new one. A moving boundary could not be pinned at all.
5. **Asymmetry, recorded rather than hidden.** Before `2026-12-31` the evaluation resolves the
   predecessor; on and after it, the evaluation resolves the new version, depending on which
   contender commits first. `M-R08` asserts only coherence — one Profile effective-state hash, one
   policy snapshot fingerprint, exactly two scope rows — and both sides satisfy it. The Design does not
   change the asserted behaviour and does not weaken any concurrency-result assertion.
6. **`M-R04` needs no change at all.** It uses the **aggregate** scope, whose anchor key is already
   canonical, so its predecessor is already closed today and its `'2026-12-31'` literal is already
   harmless.

#### 37.49.4.3 Blast radius on the other race cases and on the Gate B suite

The salesperson-scope anchor key changes for the lifecycles that request a salesperson Profile:
`M-R06`, `M-R07`, `M-R08`, `M-R09` and `M-R10`
(`server/mysql-sales-customer-wave10-concurrency.integration.js:413,431,472,494,543`).
`M-R01`, `M-R02`, `M-R03`, `M-R04`, `M-R05`, `M-R11` and `M-R12` are aggregate-only and are
byte-identical.

For the five affected cases the only observable differences are:

- one fewer `credit_lock_anchors` row (the second, non-canonical anchor is no longer provisioned);
  `credit_lock_anchors` is **not** in `PROJECTION_TABLES` and **not** in any
  `WAVE10_PROJECTION_FAMILIES` member, so no asserted projection changes;
- the policy snapshot now references the fixture's anchor id rather than a newly provisioned one, so
  the snapshot fingerprint may differ from the previous run. Every affected case asserts only the
  **equality** of the two scope rows' fingerprints and hashes, never a literal value — `M-R08` at
  `:485-487` and `M-R04` at `:386-388` — so no assertion changes;
- the `M-R09` assertion block is not touched by this Design at all.

The Gate B suite requests **no** salesperson Profile, so its anchor keys and its typed evidence are
unaffected by CB-3; only `B-M12`'s expiry changes under CB-2.

### 37.49.5 Consolidated file whitelist and per-file responsibilities

| # | File | Responsibility | Touch points |
|---|---|---|---|
| 1 | `server/test-utils/wave10-mysql-acceptance-fixture.js` | CB-1: the `ruleMode` seed parameter and the `NOT_YET_EFFECTIVE` rule state. CB-2: the pure `wave10FutureBusinessDateFrom` helper replacing `wave10FutureBusinessDate`. CB-3: the canonical anchor key via the production `creditObjectAnchorKey` | the `seedWave10AcceptanceBase` option list and the `credit_check_rules` INSERT; the date helper block (`:37-41`); the `seedProfile` anchor key (`:504-514`) and its new import |
| 2 | `server/mysql-sales-customer-wave10-business-matrix.integration.js` | CB-1: the `M-BIZ-19` `no-rule` variant — the `ruleMode` option, the removal of the `DELETE`, the reason-code assertions. CB-2: `M-BIZ-04`'s single computed expiry | `:35` (imports), `:199`–`:433` (the two affected cases only) |
| 3 | `server/mysql-sales-customer-wave10-concurrency.integration.js` | CB-2: `M-R02`'s single controlled business date and its single derived expiry, used by the request and the decision | `:292` and `:296` only. **The `M-R09` block and every other case stay byte-identical** |
| 4 | `server/mysql-sales-customer-wave10-gate-b.integration.js` | CB-2: `B-M12`'s expiry derived from the file's own frozen business date | `:172` and `:180` only |
| 5 | `server/sales-customer-wave10-acceptance-contract.test.js` **(new)** | the engine-neutral local regressions for all three fixes, including the negative reproductions of the original defects | new file |
| 6 | `scripts/testing/test-suites.js` | register the new local regression file | the `FAST` and `FULL` arrays, following the existing Wave 10 entries |

**Explicitly outside the whitelist and therefore untouched:** every production module
(`credit-check.js`, `credit-profile.js`, `credit-anchor.js`, `credit-special-approval.js`,
`sales-orders.js`, `commercial-golive.js`); every migration; the schema; the Gate runner and the
manifest (`scripts/gates/mysql-sales-wave10-*.mjs`); the parity suite and the schema fixture
(`server/mysql-sales-customer-wave10.integration.js`,
`server/test-utils/wave10-mysql-schema-fixture.js`); the OQC regression
(`server/sales-customer-wave10-quality-policy.test.js`); the canonical credit regression
(`server/sales-customer-wave10-credit-check.test.js`); `package.json`; `document.md`.

### 37.49.6 Invariants, dialect, transaction, RBAC, audit and idempotency analysis

- **Key invariants the Implementation must preserve.**
  1. `credit_profile.rule_id` always resolves to an existing `credit_check_rules` row.
  2. No statement in any corrected setup deletes, orphans or re-points a referenced row; the foreign
     key and its `ON DELETE NO ACTION` behaviour are unchanged.
  3. `credit_check_rules.status` keeps its canonical value `'ACTIVE'` in every seeded rule; no
     undeclared status vocabulary is introduced.
  4. The seeded rule's effective window never covers the `no-rule` case's business date.
  5. The seeded anchor key equals `creditObjectAnchorKey(...)` for both scopes.
  6. One controlled business date per case; one derived expiry used by both the request and the
     decision; the expiry is strictly later than the source check's business date.
  7. The default seed mode is byte-identical to the pre-Implementation seed.
  8. The 39 protected cases, the suite manifest, the case identifiers, the evidence levels and the
     M-board shape are unchanged.
- **SQLite/MySQL compatibility.** Every change is either a parameter value in an existing prepared
  statement or a pure function of strings. The fixture's seeding path contains no dialect branch; the
  date helper performs UTC calendar arithmetic only and returns the same `'YYYY-MM-DD'` shape on both
  backends; the anchor key is a pure string function of the production module. The canonical FK
  behaviour is identical on both backends (`mysql-schema.js:202` and `server/db.js:313`).
- **Transaction boundaries.** No transaction boundary changes. The CB-1 correction removes one
  autocommit statement; the CB-2 and CB-3 corrections change parameter values only. The production
  `createCreditProfile` transaction and the production approval transactions are untouched.
- **RBAC.** The cases' actors are unchanged: `APPROVER` and `REQUESTER` keep
  `CREDIT_SPECIAL_APPROVE`, and the requester/approver separation asserted by
  `credit-special-approval.js:234-240` continues to hold because the request still goes out as
  `w10-race-creator` and the decision as `w10-race-approver`. No permission, role or scope changes.
- **Audit.** No production audit contract changes. The CB-1 correction removes a raw DML that never
  produced an audit row; the CB-2 and CB-3 corrections change only fixture reference data. The
  production audits written by the Profile creation (`CREATE_VERSION`, `INITIAL_ASSIGNED`) and by the
  approval request/decision are unchanged.
- **Idempotency.** The cases' idempotency keys are unchanged. The date-derived request body changes
  the request fingerprint, which is acceptable because each campaign recreates the target schema and
  each request is issued once per run (§37.49.3.3).

### 37.49.7 Test and negative-regression plan

All local regressions run on the **SQLite** backend, in a bounded, deterministic, environment-independent
way, and must be executed under a backend that cannot resolve to MySQL.

| ID | Target | Assertion | Why it is a real proof |
|---|---|---|---|
| AC-01 | CB-1 negative | with the canonical fixture state, `DELETE FROM credit_check_rules WHERE id='w10-race-rule'` is refused by the database (`SQLITE_CONSTRAINT_FOREIGNKEY`) | reproduces the original defect and proves the referential contract is enforced, so the fix cannot be a deletion |
| AC-02 | CB-1 positive | the `NOT_YET_EFFECTIVE` state yields `enforced === false`, `decision === 'PASS'`, `reasonCodes === ['NO_APPLICABLE_EFFECTIVE_RULE']`, `checkGroupId === null`, and **zero** rows in `credit_check_results`, `credit_policy_snapshots`, `audit_logs` and `idempotency_records` | proves the corrected state produces the engine's non-enforced outcome and zero evidence |
| AC-03 | CB-1 referential | the seeded Profile's `rule_id` resolves to an existing rule row; that row keeps every declared attribute, `status = 'ACTIVE'`, `effective_to IS NULL`, `effective_from > B` | proves the rule fact stays real, dated, status-bearing and auditable (R03) |
| AC-04 | CB-1 path separation | in the `no-rule` state the rule does **not** satisfy (stage ∧ ACTIVE ∧ date-window) at `B`, and in the other-mode state it **does** satisfy that predicate while the requested recognition mode differs from the rule's; the three fixture states (disabled / no-rule / other-mode) differ in their seeded facts and each yields its expected outcome | proves the two rule-absent paths are reached through **different** filters, and that the switch path is a third, earlier gate — this is the machine-checkable form of R04 |
| AC-05 | CB-2 cross-year positive | for `B` in `2026-10-27`, `2026-12-31`, `2027-01-01`, `2028-02-29`: `wave10FutureBusinessDateFrom(B)` is a valid calendar date strictly later than `B`, and the production `requestCreditSpecialApproval` accepts it against a source check whose `business_date` is `B` | proves the derivation is valid on every required date against the **production** gate |
| AC-06 | CB-2 negative | the old literal `'2026-12-31'` is **refused** by the production request gate for `B` in `2027-01-01` and `2028-02-29` with `CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST`, and **accepted** for `B` in `2026-10-27` and `2026-12-31` | reproduces the original defect and proves the fix removes the cause rather than the symptom |
| AC-07 | CB-2 identity | the request body and the decision body carry the same expiry; the stored approval carries that expiry; the approval is consumable at business date `B` | proves the request/decision pair stays coherent and the expiry is still a live, bounded business attribute |
| AC-08 | CB-3 negative | with today's non-canonical anchor key, a production `createCreditProfile` for the same salesperson scope provisions a **second** anchor, the predecessor is **not** closed, and resolving at a date on or after the new version's `effective_from` raises `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` | reproduces the original defect and proves the anchor identity is its cause |
| AC-09 | CB-3 positive | with the canonical anchor key, the production `createCreditProfile` reuses the fixture's anchor (no second anchor row), the predecessor's `effective_to` becomes `previousDate(newEffectiveFrom)`, the resolver returns the **old** version at `2026-12-30` and the **new** version at `2026-12-31`, and `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` is never raised | proves the version chain is genuinely closed and both sides of the boundary resolve correctly (the §5 requirement) |
| AC-10 | CB-3 identity | the fixture's seeded `anchor_key` equals `creditObjectAnchorKey(...)` for the aggregate scope **and** the salesperson scope | proves the fixture no longer maintains a second format |
| AC-11 | invariants | the eight approved Credit tables keep their 23 CHECK constraints (2/2/5/3/1/3/3/4) and the existing parity, index, foreign-key and physical-type contracts are unchanged | asserted by the **unchanged** parity suite `server/sales-customer-wave10-mysql-parity.test.js`, which must still pass as-is |

**Mandatory regression gates after the Implementation** (each under a backend that cannot resolve to
MySQL): the new local file; `server/sales-customer-wave10-quality-policy.test.js` (unchanged, but it
consumes the modified shared fixture); `server/sales-customer-wave10-credit-check.test.js` (unchanged);
`server/sales-customer-wave10-mysql-parity.test.js` (unchanged); then `pnpm test:fast`, `pnpm test`,
`pnpm test:heavy` and `pnpm build`, and `git diff --check`.

### 37.49.8 Protection of the already approved work

- **The OQC fixture remediation** (`server/sales-customer-wave10-quality-policy.test.js` and the
  fixture's `seedWave10QualityPolicy`) is preserved: the fixture's default seed mode keeps
  `effective_from = '2026-01-01'`, so the OQC control point installation and the `qualityPolicy`
  default are untouched, and the eight delivery-creating business-matrix cases keep their shared
  base.
- **The CHECK parity normalization remediation** is preserved byte-for-byte:
  `server/test-utils/wave10-mysql-schema-fixture.js` and
  `server/mysql-sales-customer-wave10.integration.js` are **not** in the whitelist, so
  `M-MIG-01` / `M-MIG-02` keep the normalized comparison and the local parity regression
  (`server/sales-customer-wave10-mysql-parity.test.js`, with its three `raw:`-branch assertions) is
  untouched.
- **The `M-R09` remediation** is preserved: the `M-R09` block of the concurrency suite is not in the
  touch points of §37.49.5; only `M-R02`'s two literals change in that file.
- **The existing PASS evidence** (`WAVE10_GATE_B_PASS`, the parity normalization implementation
  pass, FAST 467/467, FULL 2894/2894, HEAVY 67/67, build PASS) remains valid for the code it was
  produced from. It does **not** remain valid as evidence about the two protected suites and the
  shared fixture that this Implementation changes: see §37.49.11.

### 37.49.9 Rollback

- **Blast radius of the rollback:** the Implementation touches six files, of which five are test
  contracts and one is the suite manifest. No production code, schema, migration or data is involved,
  so there is **no** schema rollback, no data rollback and no production rollback. The protected target
  is recreated by the campaign's own reset, so no database state survives a run.
- **Single-step rollback:** revert the six whitelisted files to their pre-Implementation content. The
  canonical code, the schema and the migrations are untouched by the Implementation, so this restores
  the exact pre-Implementation state, including the pre-existing `WAVE10_MATRIX_M_BIZ_19_NO_RULE_VARIANT_FK_BLOCKED`
  defect — the rollback therefore re-opens CB-1, CB-2 and CB-3 and must be accompanied by a new
  Requirement record.
- **Two-phase rollback** (preferred): phase 1 reverts files 1–4 and 6, restoring the three protected
  suites to their pre-Implementation behaviour while keeping the new local regression in place, so the
  local gate keeps reporting the defect; phase 2 removes file 5 and its two `test-suites.js`
  registrations once the follow-up Requirement is opened.
- **Rollback trigger:** any local gate failure that cannot be attributed to the Implementation, or any
  divergence between the local regressions' expectations and the protected campaign's real behaviour.

### 37.49.10 Final grading of the Coverage Gaps and Unverified Risks

| ID | Subject | Grading | Reason |
|---|---|---|---|
| **UR-3** | fixture anchor key vs. the production anchor identity | **REQUIRED_FOR_CURRENT_ACCEPTANCE** | it is the root cause of the confirmed blocker CB-3; §37.49.4 fixes it by reusing the production `creditObjectAnchorKey` |
| **UR-5** | runner's default per-suite timeout vs. the estimated `W10-BUSINESS-MATRIX` runtime | **REQUIRED_FOR_CURRENT_ACCEPTANCE** | the campaign must carry a timeout above the suite's measured runtime; this is satisfied by the operational precondition already in §15.3 and by §37.49.11, not by code |
| CG-1 | `M-BIZ-03`「does not fall back to a historical ACTIVE」 | **SEPARATE_REQUIREMENT_REQUIRED** | the setup update is a no-op and no historical ACTIVE version exists, so the stated premise is not exercised. Making it real requires a new fixture capability (a historical ACTIVE Profile version) and changes what the case asserts. The case still passes as a CLOSED fail-closed check, so it does not block the Acceptance |
| CG-2 | `M-BIZ-08`「overdue AR」 | **SEPARATE_REQUIREMENT_REQUIRED** | `credit-check.js` selects `due_date` and never uses it, so the overdue premise is inert. Making it real is a **production** behaviour change (an overdue-day policy over AR due dates), which is a product Requirement, not an acceptance-contract fix |
| CG-3 | `M-MIG-01` compares only the CHECK constraints of the two Wave 10 tables | **SEPARATE_REQUIREMENT_REQUIRED** | the residual hole is "live MySQL against the canonical SQLite source" for those two tables' columns, foreign-key mapping and indexes. `M-MIG-06` already compares fresh against upgrade over all eight tables including these two, and `M-MIG-02` compares the canonical source against the live target for the six Wave 9 tables. Strengthening `M-MIG-01` would change a protected case's comparison contract, which R07 forbids without an explicit amendment |
| CG-4 | the hand-written MySQL DDL materialization path of the Wave 9 tables is never exercised | **DEFERRABLE_WITH_JUSTIFICATION** | `credit_lock_anchors.policy_scope_id` is `VARCHAR(128)` through the snapshot path (`mysql-schema.js:114`) and `LONGTEXT` through the migration's own DDL (`wave9:149-150`), but both are the same text family and the column is not a foreign key, is not indexed and is NULL for every anchor the fixture and the production builder create. No acceptance path can produce the divergence, and any future correction would touch a migration, which needs its own Requirement |
| CG-5 | `M-BIZ-16`'s second and third evaluations are exact replays | **DEFERRABLE_WITH_JUSTIFICATION** | the check-group identity excludes the recognition mode (`credit-check.js:873-876`), so the later calls resolve to the same group and suppress the result row and the audit. The mode filter is nevertheless applied on every call (`:666`), so the asserted per-mode decision is recomputed against the requested mode and the stated fact — a global rule applies to every supported mode — is genuinely established. Only three independent persisted evaluations are not produced, and no Acceptance condition depends on them |
| CG-6 | `M-R02`'s "exactly one effective authority" is a disjunction | **DEFERRABLE_WITH_JUSTIFICATION** | the line can only fail when *neither* authority exists, so it proves "at least one". The "exactly one" part is carried by the neighbouring `consumes <= 1` (`:309`), the Sales Order approve-audit count (`:310-311`) and the production consumption semantics (`credit-check.js:884-906`), under which a standard approval can only succeed by consuming an approval. Tightening it would change a Gate B-evidenced race case's assertion, which needs its own Requirement and a Gate B re-run |
| CG-7 | `M-R04`'s Profile-identity assertion is a tautology | **DEFERRABLE_WITH_JUSTIFICATION** | the candidate list is built from the same table the assertion reads, so it can only fail on a deleted Profile. The substantive invariants of the case are proved by the adjacent `profiles.size === 1` / `fingerprints.size === 1` / `hashes.size === 1` assertions (`:386-388`), which are sound |
| UR-1 | `M-BIZ-06` exposure window across a UTC midnight | **DEFERRABLE_WITH_JUSTIFICATION** | a ~1-in-86 400 calendar race, already documented in the fixture (`:25-33`); the fixture derives the business date from the run date precisely to avoid the silent drop. The failure would be loud, not a false PASS. Fixing it means capturing the business date once per case, which is a fixture behaviour change outside the approved Requirement |
| UR-2 | `M-BIZ-12` `sales_delivery_no` same-millisecond collision | **DEFERRABLE_WITH_JUSTIFICATION** | the two deliveries are separated by a full HTTP create-and-confirm round trip including a scrypt login, so the collision probability is negligible; the column is UNIQUE, so a collision would be a loud failure |
| UR-4 | hard-coded date literals in `M-BIZ-05` / `M-BIZ-08` / `M-BIZ-15` / `M-BIZ-20` | **DEFERRABLE_WITH_JUSTIFICATION** | these are declared reference facts that do not enter the derivation of any asserted value; the `M-BIZ-20` rule's `effective_from = '2026-01-01'` is a past date and therefore calendar-stable. They are recorded, not changed, to keep the Implementation minimal |
| UR-6 | `innodb_lock_wait_timeout = 2` against the 15 s gate-admission budget | **DEFERRABLE_WITH_JUSTIFICATION** | a slow first wait-evidence observation makes the contenders abort and retry, opening gaps in the pending window; if the delay exceeded the budget the approval would be refused with HTTP 503, which the suite explicitly rejects. The failure mode is loud, never a false PASS |

**No Coverage Gap or Unverified Risk classified as REQUIRED_FOR_CURRENT_ACCEPTANCE requires a code
change beyond the three confirmed blockers**, so no Requirement amendment is needed to execute this
Design.

### 37.49.11 Future acceptance plan and the suite-timeout question

The sequence below is a plan for **separately authorized** steps; none of it is executed by this
Design.

1. **Focused local SQLite regression** — the new `server/sales-customer-wave10-acceptance-contract.test.js`
   (AC-01…AC-11), plus the three unchanged neighbouring suites, under a backend that cannot resolve to
   MySQL.
2. **`pnpm test:fast`, `pnpm test`, `pnpm test:heavy`, `pnpm build`, `git diff --check`** in the
   isolated SQLite environment. The FULL count will change by the new file's case count; the Design
   does not predict a number, because the Implementation must not be tuned to a number.
3. **Full read-only acceptance contract verification** — re-read the Requirement's acceptance
   conditions §13 (now 11 conditions) against the Implementation's actual diff, item by item.
4. **Protected MySQL preflight** — the read-only identity, grant, inventory, lease and
   `sql_mode` checks, **plus** the confirmation that `ERP_MYSQL_WAVE10_SUITE_TIMEOUT_MS` is present in
   the child environment, and an OS process check that no orphan runner holds the target.
5. **One canonical `pnpm.cmd test:mysql:wave10` campaign** — exactly one run, against the dedicated
   disposable target, with no mid-campaign patching.
6. **Strict TAP, final cleanup and the five-category zero inventory** — the runner's own contract.
7. **A Gate B re-run, then the final Acceptance review.** This step is new and is required: the
   Implementation changes `server/mysql-sales-customer-wave10-concurrency.integration.js` and the shared
   acceptance fixture, and the Gate B suite consumes the shared fixture. The existing
   `WAVE10_GATE_B_PASS` transcript therefore no longer corresponds to the current worktree, and the
   Gate B typed M-board evidence must be regenerated before the Acceptance can rely on it. The Gate B
   campaign is a **separately authorized** step and must precede the final review.

**Is `1800000 ms` sufficient?** The measured per-lifecycle cost is ≈27 s (`W10-PARITY` 193 s over 7
cases; `W10-RACES` 324 s over 12 cases), so `W10-BUSINESS-MATRIX`'s 23 lifecycles estimate to ≈620 s
against a 1800 s budget — roughly 2.9× headroom. That estimate is nevertheless **not evidence**:
`W10-BUSINESS-MATRIX` has never been executed, and its cases are heavier than the parity and race
cases, because they run HTTP logins with scrypt, canonical Delivery and confirmation, invoice posting
and collection settlement, against a freshly rebuilt 324-table schema each time. A per-lifecycle
worst case of ≈78 s would exhaust the budget. **The Design therefore treats `1800000 ms` as a
reasonable but unproven bound and fixes the following principle: if the campaign times out, the run is
INCONCLUSIVE — not a PASS and not a product defect.** The operator must then, in order: (i) record
the observed per-lifecycle duration from the transcript and the suite that timed out; (ii) not patch
anything during or after the run; (iii) re-derive the required budget from the measured duration
before requesting a second, separately authorized run; and (iv) before that run, confirm that no
orphan runner process still holds the target, because the runner's timeout path with an **unconfirmed**
child termination deliberately refuses to reset the target and does not release the campaign lease
(`mysql-wave10-runner-support.mjs:173-181`, `:216`).

### 37.49.12 Disclosed items for the reviewer's attention

These are **not** blockers and the Design does not expand beyond the approved Requirement, but they
must be visible to the reviewer.

1. **CB-2's blast radius is wider than the Requirement's evidence named.** The same fixed
   `'2026-12-31'` expiry exists in the Gate B suite (`B-M12`). It is fixed here under R09's general
   wording and the explicit Design instruction; the Requirement's CB-2 evidence paragraph named only
   the concurrency file. No Requirement amendment is required, but the reviewer should confirm that
   reading.
2. **`M-BIZ-04` is touched by CB-2** for the same reason: it currently computes its expiry twice from
   two clock readings. R09's acceptance condition 4 preserves its derived form; this Design makes the
   derivation single-valued.
3. **One assertion strengthening is proposed.** `M-BIZ-19` gains the engine's reason code in both
   variants (`['CREDIT_MANAGEMENT_DISABLED']` and `['NO_APPLICABLE_EFFECTIVE_RULE']`). It strengthens
   R04's distinguishability requirement into a machine-checked form. No assertion is removed, weakened
   or skipped, and no case identity changes.
4. **The local credit regression keeps its frozen `'2026-12-31'` literals** (§37.49.3.4) — a
   deliberate deferral, recorded in §37.49.10 under UR-4's neighbourhood.

### 37.49.13 Design status

The Design is complete and internally consistent: CB-1, CB-2 and CB-3 form one Implementation unit
over one six-file whitelist, no production code, schema, migration, manifest, runner or protected case
identity is touched, every Coverage Gap and Unverified Risk of the approved Requirement is graded, and
the two newly discovered extensions of the CB-2 blast radius are reported and covered by the approved
Requirement's own wording. **No issue blocks Implementation.**

**Status: `WAVE10_ACCEPTANCE_BLOCKER_DESIGN_READY`.**

## 37.50 Wave 10 Parity Oracle correctness design (2026-10-27)

### 37.50.0 Authorization and boundary

The user authorized, under AGENTS.md §4.0, one consecutive `AUDIT → REQUIREMENT → DESIGN` stage for the
two remaining Wave 10 Full Acceptance parity blockers, with a mandatory HARD STOP at the end of
Design. The Requirement phase is `document.md` → "Wave 10 Parity Oracle Requirement Addendum
(2026-10-27)" and is recorded there.

This section records the **Design** phase only. **Implementation is not authorized by this stage.**
Real MySQL access, any protected campaign re-run, Git writes, credential operations, DDL, DML,
migration execution, production CHECK definitions, production schema, migrations, business code, the
Gate runner / manifest, the `M-R09` assertion, the OQC fixture remediation and Wave 11 all remain
outside this Design.

### 37.50.1 Design basis — the audited facts

The facts are recorded in the Requirement Addendum §3 and are not restated here. The four that carry
the Design:

| Fact | Consequence for the Design |
|---|---|
| **P03** — the fixture already calls the production `mysqlTypeFamily`; there is **no** second type mapping in the repository | the Design must not introduce one, and the correction is confined to the **indexed predicate** that is passed into the shared mapper |
| **P04 / P08** — the predicate difference is observable on exactly **five** foreign-key columns whose names do not end in `_id` | the correction is a **predicate** correction, and it must be proven to change exactly those five and nothing else |
| **P05** — the referenced parent columns are `VARCHAR(128)`, so a `LONGTEXT` foreign-key child column would be refused by InnoDB | the production generator is **provably right**; the acceptance oracle is provably wrong. No production change is admissible |
| **P12 / P13 / P14** — the CHECK comparison compares two differently ordered arrays of the same set, and it breaks `M-MIG-01` **and** two `M-MIG-02` tables | the CHECK correction is **not optional** for `M-MIG-02`, and both corrections belong in one Implementation unit |

### 37.50.2 Option comparison — the CHECK comparison

**Option A — sort the catalogue side by its canonical form (CHOSEN, together with B).**
`readNormalizedMySqlTable()` sorts the normalized canonical forms before it returns them, exactly as
`extractCheckClauses()` already sorts the SQLite side. The two producers of the same set then produce
the same ordered array, and the existing `assert.deepEqual` comparisons keep working unchanged.

**Option B — compare the normalized multiset explicitly (CHOSEN, together with A).**
A named helper compares the two sides as **sorted arrays**: order-insensitive, and sensitive to the
number of occurrences of each constraint, because the comparison uses arrays and not sets. The helper
is the single place where the semantics are stated, and it is the target of the negative regressions.

**Option C — compare the raw clauses before normalization (REJECTED).**
The two sides use different dialects and different rendering conventions, so the raw texts are never
comparable. Comparing them would reintroduce exactly the defect §37.48 removed.

**Option D — compare the CHECK sets as `Set`s (REJECTED).**
A set drops multiplicity, so a constraint that appears twice on one side and once on the other would
compare equal. W10-PAR-R01 requires multiplicity to be preserved, and a duplicated constraint is a real
schema defect.

**Option E — keep the raw catalogue order and sort the SQLite side by the raw key instead (REJECTED).**
The SQLite side has no raw catalogue key. The only portable ordering key is the canonical form itself,
and the catalogue's raw order is a function of the server's rendering, not of the schema.

### 37.50.3 Option comparison — the indexed predicate

**Option A — align the fixture's predicate with the production generator's rule, and pin the two with
a local regression (CHOSEN).**
The fixture's indexed set becomes the index columns ∪ the foreign-key source columns, matching
`mysql-schema.js:184-187`. The type mapping continues to be the production `mysqlTypeFamily`. The
local regression proves, for **all 117 columns** of the eight tables, that the fixture's prediction is
byte-identical to the type the production generator itself emits — so any future drift between the two
is caught by the **local** gate rather than by a protected campaign.

**Option B — export the production predicate and import it in the fixture (REJECTED for this unit).**
This is the strongest single-source-of-truth form, but `server/database/mysql-schema.js` is on the
bootstrap path of **every** MySQL suite, so changing it invalidates the `WAVE10_GATE_B_PASS`
transcript and forces a Gate B re-run before the final review — for a two-line predicate. The
production file also carries two copies of the rule today (`tableDefinition` at `:184-187` and
`columnDefinition` at `:209-212`); consolidating them is a worthwhile **follow-up** (§37.50.11), not a
prerequisite for closing the two blockers.

**Option C — derive the expected type by parsing the production generator's emitted DDL (REJECTED for
this unit).**
It removes the duplication entirely, but it makes the *expected* side depend on a DDL parser, so a
parser defect would silently weaken the expectation. Option A reaches the same guarantee with a
direct, asserted equality against the generator's output and no new parser in the expectation path.

### 37.50.4 Chosen design — the CHECK normalization, sorting and comparison data flow

The data flow, end to end, after the change:

```text
SQLite side                                        MySQL side
-----------                                        ----------
sqlite_master.sql                                  information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE
        |                                                     |
        v                                                     v
extractCheckClauses(ddl, {dialect: sql_standard})   normalizeCheckClause(raw, {dialect: mysql_catalog})
        |                                                     |
        v                                                     v
  canonical form  (parse -> expression tree -> re-render)  canonical form
        |                                                     |
        v                                                     v
  .sort()  <- the SQLite side already sorts            .sort()   <- ADDED: the catalogue side now sorts
        |                                                     |
        +---------------------------+-------------------------+
                                    v
                     assertCheckParity(expected, actual, label)
                    = deepEqual([...actual].sort(), [...expected].sort())
```

Five properties of this flow are load-bearing and are stated here so a later change cannot silently
break them:

1. **The normalizer is not changed.** The grammar, the two literal dialects, the `raw:` fallback and
   the bounded diagnostic of §37.48 stay exactly as they are. The correction is confined to the
   **ordering** of the results and to the **comparison** of the two sets.
2. **The `raw:` fallback is preserved.** A clause that cannot be parsed keeps its distinct `raw:`
   form, which is a normalizable string and therefore sorts and compares like any other form. A
   `raw:` form still never compares equal to a parsed form, because the two canonical strings differ.
   The fallback is neither disabled nor ignored.
3. **Multiplicity is preserved.** Both sides are compared as **sorted arrays**, never as sets. A
   constraint that occurs twice on one side and once on the other is a difference, and it fails.
4. **The comparison is order-insensitive.** The catalogue's order is a function of the server's
   rendering (the parenthesis-depth prefix dominates under `utf8mb4_0900_ai_ci`), not of the schema.
   The evidence collection in `server/mysql-sales-customer-wave10.integration.js:57-71` deliberately
   keeps the **raw** catalogue order, because that order is the ordering-key evidence; it is not the
   compared shape.
5. **The comparison is strictly no weaker than before.** Every difference the old comparison could
   detect — a missing constraint, an extra constraint, a changed expression, a changed multiplicity —
   is still detected. The only difference the old comparison could detect that the new one cannot is
   the *order* of the constraints, which carries no business meaning (P13).

### 37.50.5 Chosen design — the indexed predicate and the reuse of `mysqlTypeFamily`

`mysqlTypeFamily()` **is** reused, unchanged. The fixture already calls it
(`wave10-mysql-schema-fixture.js:407-409`), and this Design adds no second mapping and no
hand-written type table.

The single correction is the **predicate**: "does the production generator consider this column
indexed?" The production generator's answer is

```js
// server/database/mysql-schema.js:184-187
const indexed = new Set([
  ...table.indexes.flatMap((index) => index.columns.filter(isValidColumnName)),
  ...table.foreignKeys.map((foreignKey) => foreignKey.from),
]);
```

The fixture's predicate becomes the same set, with the same validity filter on the index columns:

```js
// server/test-utils/wave10-mysql-schema-fixture.js
function mysqlIndexedColumns(table) {
  return new Set([
    ...table.indexes.flatMap((index) => index.columns.filter(isValidColumnName)),
    ...table.foreignKeys.map((foreignKey) => foreignKey.from),
  ]);
}
```

`isValidColumnName` is a one-line predicate in `mysql-schema.js:21-23` and is **not** exported. The
fixture therefore reproduces it as an inline `typeof column === 'string' && column.length > 0` filter
and says so in a comment that names the production rule. This is the one place where a rule is
written twice, and §37.50.8's PT03/PT05 regressions are what makes the duplication safe: they assert,
column by column for all eight tables, that the fixture's prediction equals the type the production
generator itself emits. A future change to the production rule that the fixture does not follow
therefore fails the **local** gate.

The predicate change alters the prediction for exactly five columns — the five of P08 — and for
nothing else:

| Table | Column | Before | After |
|---|---|---|---|
| `credit_parameters` | `created_by` | `longtext` | `varchar` |
| `credit_check_rules` | `created_by` | `longtext` | `varchar` |
| `credit_profile` | `created_by` | `longtext` | `varchar` |
| `credit_policy_snapshots` | `captured_by` | `longtext` | `varchar` |
| `credit_profile_ratings` | `applied_by` | `longtext` | `varchar` |

The Wave 10 tables are unaffected, because their physical types come from the approved contract
`WAVE10_MYSQL_COLUMN_TYPES`, which the mapper consults before the predicate is ever read (P06).

### 37.50.6 The generic / hand-written DDL verification boundary

The two paths are verified by **different means**, and the boundary is deliberate:

| Path | What it is | How it is verified | What the parity suite compares |
|---|---|---|---|
| **generic snapshot bootstrap** | `mysql-schema.js:183-206` `tableDefinition()` applied to the SQLite snapshot; this is what the acceptance actually runs (P10) | the live `M-MIG-01` / `M-MIG-02` comparison, plus the offline PT03/PT05/PT07 regressions against the generator's own emitted DDL | the live MySQL table against the generator's output for the canonical SQLite source |
| **hand-written migration DDL** | the `mysql(db)` block of each migration (`wave9:142-212`, `wave10:95-146`); **structurally unreachable** in the bootstrap (P11) | the offline PT09 regression, which compares the hand-written declaration against the generic declaration for all 117 columns and requires exactly **one** registered divergence | nothing at runtime — the path cannot run |

The hand-written Wave 10 DDL is additionally covered by the **existing** test "the Wave 10 physical
column contract equals the canonical live MySQL DDL"
(`server/sales-customer-wave10-mysql-parity.test.js:162-172`), which stays unchanged.

**The verification boundary therefore is:** the generic path is compared against the live server; the
hand-written path is compared against the generic path offline. Neither comparison is skipped, and no
production DDL is modified to make either one agree.

### 37.50.7 Source change whitelist — the exact intended diff (not executed)

Three files. **No production code, no migration, no schema, no runner, no manifest.**

| # | File | Change | Touch points |
|---|---|---|---|
| 1 | `server/test-utils/wave10-mysql-schema-fixture.js` | the indexed predicate; the CHECK sort on the catalogue side; the new `assertCheckParity` helper; the two comparison sites use it | `indexedColumns` (`:17-19`) → `mysqlIndexedColumns`; `normalizedSqliteTable` (`:411-443`); `readNormalizedMySqlTable` (`:479-484`); `compareWave9SourceTarget` (`:499-502`); `assertEquivalentCreditMetadata` (`:622-625`); one new exported helper |
| 2 | `server/mysql-sales-customer-wave10.integration.js` | `M-MIG-01`'s CHECK comparison uses the helper | `:184` (one line) |
| 3 | `server/sales-customer-wave10-mysql-parity.test.js` | the new `PT01..PT10` block, a pure source-text reader for the eight tables, and the captured raw-ordering evidence | new block appended; no existing assertion changed |

The intended diff, in shape:

```js
// 1. the predicate
-function indexedColumns(table) {
-  return new Set(table.indexes.flatMap((index) => index.columns).filter(Boolean));
-}
+// §37.50 — the production generator's rule (mysql-schema.js:184-187): a
+// foreign-key source column counts as an indexed column. The narrower
+// index-only rule made the oracle predict a type that InnoDB refuses.
+function mysqlIndexedColumns(table) {
+  return new Set([
+    ...table.indexes.flatMap((index) => index.columns.filter(isValidColumnName)),
+    ...table.foreignKeys.map((foreignKey) => foreignKey.from),
+  ]);
+}

// 2. the canonical CHECK comparison
+export function assertCheckParity(expectedChecks, actualChecks, label) {
+  assert.deepEqual([...actualChecks].sort(), [...expectedChecks].sort(),
+    `${label}: check-constraint parity`);
+}

// 3. the catalogue side sorts its canonical forms
-    .map((row) => normalizeCheckClause(row.check_clause, { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG }));
+    .map((row) => normalizeCheckClause(row.check_clause, { dialect: CHECK_LITERAL_DIALECT.MYSQL_CATALOG }))
+    .sort();

// 4. the comparison sites
-    assert.deepEqual(actual.checks, expected.checks, `${tableName}: check-constraint parity`);
+    assertCheckParity(expected.checks, actual.checks, tableName);
```

**Explicitly outside the whitelist:** `server/database/mysql-schema.js` (and therefore the production
generator, `mysqlType`, `mysqlTypeFamily` and the production DDL), both migrations, the production
schema, `server/db.js`, the Gate runner and manifest, the shared acceptance fixture, the concurrency
suite, the Gate B suite, the business-matrix suite, `package.json`, `document.md` and this section.

**Why the whitelist keeps the Gate B evidence valid.** The Gate B suites import the **acceptance**
fixture (`wave10-mysql-acceptance-fixture.js`), not the schema fixture and not the parity integration
file. The schema fixture is imported by exactly two files: `server/mysql-sales-customer-wave10.integration.js`
and `server/sales-customer-wave10-mysql-parity.test.js`. A change confined to the three whitelisted
files therefore does **not** invalidate the `WAVE10_GATE_B_PASS` transcript, and **no Gate B re-run is
required by this Implementation**. A change to `server/database/mysql-schema.js` would have required
one, which is one of the reasons Option B of §37.50.3 is rejected for this unit.

### 37.50.8 Positive and negative regression plan

The new regressions are added to the **existing** `server/sales-customer-wave10-mysql-parity.test.js`,
which is already registered in `FAST` and `FULL`. **No new test file is created and
`scripts/testing/test-suites.js` is not modified.** The file stays a pure test: it opens no database,
reaches no MySQL server and produces no business result.

**Identifier note.** The file already uses `T01`..`T08` for different tests (the CHECK-normalizer
regressions of §37.48). The new set therefore uses the prefix **`PT01`..`PT10`**, which is mapped to
the requested identifiers in the table below. No existing identifier is reused or renumbered.

| Requested | Identifier | Assertion |
|---|---|---|
| T01 | **PT01** | the **captured live** catalogue order of the three tables whose order differs (`credit_check_results`, `credit_check_rules`, `credit_profile_ratings`) is a permutation of the canonical SQLite CHECK set; `assertCheckParity` **accepts** it, while the raw arrays differ in order |
| T02 | **PT02** | a **missing** CHECK must fail: dropping one canonical form from the actual side makes `assertCheckParity` throw |
| T03 | **PT03** | a differing **multiplicity** must fail: repeating one canonical form on the actual side makes `assertCheckParity` throw |
| T04 | **PT04** | a **changed expression** must fail: replacing one clause with a semantically different one makes `assertCheckParity` throw |
| T05 | **PT05** | the **foreign-key columns** are predicted exactly as the production generator predicts: for all eight tables and **all 117 columns**, the oracle's type family equals the type the production generator itself emits — including the five RC-2 columns, which must be `varchar` |
| T06 | **PT06** | a plain **non-indexed, non-foreign-key** `TEXT` column is still `longtext` (`credit_parameters.value_text`, `credit_check_rules.credit_item`, `credit_profile.initial_state`, …), so the correction does not over-apply |
| T07 | **PT07** | the **complete physical contract** of the six Wave 9 tables: 76 columns, 15 foreign-key edges, 16 CHECK constraints, 10 declared indexes, `id` as the single-column primary key of each table, and the canonical SQLite DDL and the canonical hand-written MySQL DDL declaring the **same column names in the same order** |
| T08 | **PT08** | the **two Wave 10 tables** keep their approved physical contract: the generic generator's output for all **41** columns equals `WAVE10_MYSQL_COLUMN_TYPES`, and the hand-written Wave 10 MySQL DDL still equals the same contract |
| T09 | **PT09** | a **genuine type difference** between the generic path and the hand-written path is still **detected**: `credit_lock_anchors.policy_scope_id` is `varchar` in the generic path and `longtext` in the hand-written path, it is the **only** such divergence among the 117 columns, and a comparison against a hand-written-materialized table still fails |
| T10 | **PT10** | the **existing** regressions all survive: the CHECK-normalizer block, the index-parity block, the physical-contract block, the approved CHECK cardinality block, the foreign-key and migration-idempotency suites and the Wave 10 credit suite are unchanged and pass; the new block adds no `skip`, `todo` or `only`, and removes no assertion |

**The captured-ordering evidence.** PT01 needs the catalogue's raw rendering in its **catalogue
order**. Those bytes exist: they are the `raw` values of the `WAVE10_CHECK_METADATA_EVIDENCE` line of
the 2026-10-27 campaign transcript, for all eight tables. The parity test already embeds a captured
subset in exactly this way (the `CAPTURED_CHECK_RENDERINGS` block of §37.48, with its provenance
recorded). PT01 extends that pattern to the three order-divergent tables and records the same
provenance — server 8.0.37, server UUID `5d3c6a68-b8a5-11f1-8ce6-b025aa71d167`, campaign of
2026-10-27, target `modern_erp_wave10_disposable_test`.

**The pure source-text reader.** PT05, PT07 and PT09 need a snapshot-shaped table object without a
database. The parity test already reads the two migration sources as text and already extracts their
`CREATE TABLE` blocks (`sqliteDdlBlock`, `mysqlDdlBlock`). The new reader extends that with the
column, foreign-key, index and table-level-UNIQUE extraction, and produces the same shape that
`captureSqliteSnapshot()` produces, so that `normalizedSqliteTable()` and the production
`planMySqlAdditiveReconciliation()` can both consume it. PT07's cross-check between the canonical
SQLite DDL and the canonical hand-written MySQL DDL is what makes the reader's fidelity
**machine-checked** rather than assumed: the two are independent declarations of the same eight
tables, and they must agree on the column names and their order.

### 37.50.9 The complete offline physical contract verification of all eight tables

The offline verification is a single, exhaustive pass over the eight tables:

| Table | Columns | Foreign keys | CHECKs | Declared indexes | Auto-indexes | Primary key |
|---|---|---|---|---|---|---|
| `credit_lock_anchors` | 10 | 2 | 2 | 2 | 0 | `id` |
| `credit_parameters` | 12 | 2 | 2 | 2 | 0 | `id` |
| `credit_check_rules` | 14 | 1 | 5 | 2 | 0 | `id` |
| `credit_profile` | 19 | 5 | 3 | 2 | 0 | `id` |
| `credit_policy_snapshots` | 12 | 3 | 1 | 1 | 0 | `id` |
| `credit_profile_ratings` | 9 | 2 | 3 | 1 | 0 | `id` |
| `credit_check_results` | 20 | 6 | 3 | 3 | 1 | `id` |
| `credit_special_approval` | 21 | 4 | 4 | 2 | 1 | `id` |
| **Total** | **117** | **25** | **23** | **15** | **2** | — |

(17 index entries in total: 15 declared indexes plus the 2 SQLite auto-indexes that carry the two
Wave 10 table-level UNIQUE constraints.)

For every column the offline pass asserts: name and ordinal, physical type family (against the
production generator's own emitted DDL), nullability, default, primary-key ordinal, the foreign-key
mapping and action, the index identity / uniqueness / column order, and the CHECK cardinality and
expressions. The foreign-key actions are `NO ACTION` on the SQLite side and `NO ACTION` on the
hand-written MySQL side, so both normalize to `RESTRICT` under the existing
`normalizeReferentialAction()`.

### 37.50.10 Compatibility across the initialization paths

The three paths that can materialize these eight tables on MySQL, and what this Implementation does
to each:

| Path | Reached by | Effect of this Implementation |
|---|---|---|
| **generic snapshot bootstrap**, fresh target | `bootstrapMySql()` with no `mysql_backend_metadata` marker (`mysql-schema.js:414`) | **none** — the production generator is not modified |
| **generic snapshot bootstrap**, additive target | `planMySqlAdditiveReconciliation()` (`:310-323`) | **none** |
| **hand-written migration DDL** | `migrateSalesCustomerWave9CreditFoundation()` / `migrateSalesCustomerWave10CreditCheck()` (`wave9:310`, `wave10:366`) | **none** — the migrations are not modified; the path remains structurally unreachable (P11) |
| **SQLite** | the canonical local backend | **none** — the SQLite DDL is not modified |

The acceptance comparison itself is unchanged in scope: it still compares the canonical SQLite source
against the live MySQL target. What changes is that the **expected** side now states the production
generator's true prediction, and the CHECK comparison becomes order-insensitive. Both changes make the
comparison **stricter or equal**, never weaker.

### 37.50.11 Stop conditions

The Implementation **stops and reports** — it does not fix — if any of the following is observed:

1. The offline pass finds a column whose oracle prediction differs from the production generator's
   output **beyond the five columns of P08**. That would mean the production rule has a third
   dimension this Design did not audit, and the correction is no longer a two-line predicate change.
2. The hand-written path is found to differ from the generic path on **more than the one registered
   column** of RC-3. Any further divergence is a new, unregistered production inconsistency and
   needs its own Requirement.
3. The offline pass finds a divergence between the canonical SQLite DDL and the canonical hand-written
   MySQL DDL in the **column names or their order**. That would mean the two canonical declarations
   of the same table disagree, which is a schema-contract issue, not a test-contract issue.
4. Any existing parity, index-parity, foreign-key, physical-contract or CHECK-parity regression
   fails for a reason that is not one of the two intended corrections. The Implementation does not
   adjust an existing expectation to accommodate an unexplained change.
5. The Implementation would require a change to `server/database/mysql-schema.js`, to a migration, to
   the production schema or to the approved `WAVE10_MYSQL_COLUMN_TYPES` contract. Those are outside
   the whitelist and outside this Requirement.

The **follow-up** items this Design records but does not execute:

- **F1** — consolidate the two copies of the production indexed predicate
  (`mysql-schema.js:184-187` and `:209-212`) into one exported helper, and have the fixture import it
  (Option B of §37.50.3). This removes the last hand-written copy of the rule. It touches a
  production file, so it invalidates the Gate B transcript and needs its own Requirement, Design and
  Gate B re-run.
- **F2** — the RC-3 divergence of `credit_lock_anchors.policy_scope_id` between the generic path and
  the hand-written Wave 9 DDL. Registered as an independent issue under W10-PAR-R10; any correction
  touches a migration and needs its own Requirement and Design.
- **F3** — `CG-3`, the residual hole that `M-MIG-01` compares only the CHECK constraints of the two
  Wave 10 tables. Unchanged by this Design.

### 37.50.12 Rollback and acceptance evidence

**Rollback.** The Implementation touches three files, all of them test contracts. There is no schema
rollback, no data rollback and no production rollback. The rollback is a single-step revert of the
three whitelisted files, which restores the pre-Implementation state — and therefore re-opens both
`M-MIG-01` and `M-MIG-02`, which must be accompanied by a new Requirement record. The rollback
trigger is any local gate failure that cannot be attributed to the two intended corrections, or any
divergence between the local regressions' expectations and the protected campaign's real behaviour.

**Acceptance evidence, in order.** None of it is executed by this Design.

1. The focused local regression — `server/sales-customer-wave10-mysql-parity.test.js` with the new
   `PT01..PT10` block — under a backend that cannot resolve to MySQL.
2. The unchanged neighbouring local suites: `server/sales-customer-wave10-credit-check.test.js`,
   `server/sales-customer-wave10-quality-policy.test.js`,
   `server/sales-customer-wave10-acceptance-contract.test.js`.
3. `pnpm test:fast`, `pnpm test`, `pnpm test:heavy`, `pnpm build`, `git diff --check`.
4. A full read-only re-verification of the Requirement Addendum's §6 acceptance conditions against
   the Implementation's actual diff, item by item.
5. The read-only protected MySQL preflight — identity, grants, inventory, lease, `sql_mode`, plus the
   absence of an orphan runner.
6. Exactly **one** `pnpm.cmd test:mysql:wave10` campaign against the dedicated disposable target, with
   no mid-campaign patching. `W10-PARITY` must reach 7/7, and the `W10-RACES` and
   `W10-BUSINESS-MATRIX` suites must produce their **first** evidence.
7. Strict TAP, the final cleanup confirmation and the five-category zero inventory.
8. **No Gate B re-run is required by this Implementation** (§37.50.7). If the Implementation's actual
   diff turns out to touch anything outside the three whitelisted files, a Gate B re-run becomes
   mandatory again before the final Acceptance review.

### 37.50.13 Design status

The Design is complete and internally consistent: the two confirmed defects are corrected inside the
acceptance test contract only, by aligning the oracle's indexed predicate with the production
generator's rule and by comparing the normalized CHECK sets as multisets; the production generator,
the production schema, both migrations, the approved Wave 10 contract, the CHECK normalizer's grammar
and its `raw:` fallback, the index-parity contract, the protected case identities and the Gate B
evidence all stay untouched; the offline physical contract of all eight tables is verified in full;
the one real production inconsistency found by the audit is registered as an independent issue and is
**not** corrected here; and every negative regression required to prove that a missing, a repeated or
a changed constraint still fails, and that a genuine type divergence is still detected, is specified.

**No issue blocks Implementation.**

**Status: `WAVE10_PARITY_ORACLE_DESIGN_READY`.**

## 37.51 Wave 10 Inventory Fixture canonical seeding design (2026-10-27)

### 37.51.0 Authorization and boundary

The same authorization that authorized the Requirement phase (§4.0 consecutive-stage authorization)
authorizes this Design phase to follow immediately. The Design is recorded here; the Implementation is
**not** authorized.

Not authorized by this Design: any implementation, any test execution, any build, any MySQL
connection, any database query, DDL, DML, migration execution or reset, any Gate B or Full Acceptance
run, any Git write operation, any Freeze, and the start of Wave 11.

This Design covers exactly one production-facing correction — the **shape of the stock that the Wave 10
shared acceptance fixture seeds** — plus the local regression that proves it. It is a **test-contract**
change. No production module, no schema, no migration and no historical business data is touched.

### 37.51.1 Design basis — the audited facts

The Design is bound to the Requirement's `document.md` → "Wave 10 Inventory Fixture Requirement
(2026-10-27)", clauses `W10-INV-R01`..`W10-INV-R13` and acceptance conditions
`AC-INV-01`..`AC-INV-08`, and to the facts `P01`..`P12` established there. The four facts that
constrain the Design are:

- **F1** — the fixture seeds a **legacy-shaped** row: `position_key = NULL` with otherwise canonical
  dimensions (`P01`–`P04`).
- **F2** — the canonical upsert cannot match that row and therefore **inserts a second row carrying
  the movement delta**, i.e. a negative shadow row (`P05`, `P06`).
- **F3** — the availability read is unfiltered and non-deterministic, and on MySQL it returns the
  shadow row first because the canonical row's `randomUUID()` id sorts before `'w10-race-inventory'`
  in the clustered index (`P07`, `P08`, `P11`).
- **F4** — **SQLite does not reproduce the refusal**: its row order returns the legacy row first, so
  the defect is invisible to a business-outcome-only SQLite assertion (`P09`).

F4 is the single most consequential fact for this Design: **the regression must assert the position
identity, the row count and the balance sequence — never "the Delivery succeeded"** — otherwise it
would be green against the defective fixture.

### 37.51.2 Option comparison — how the fixture seeds the canonical stock

| Option | Content | Conclusion |
|---|---|---|
| **A1** | Seed through the production canonical absolute writer `setInventoryQuantity()` (`server/lib/stock.js:126-148`) | **ADOPTED** — the production module owns the identity *and* the absolute write; the fixture owns nothing |
| A2 | Compute the key in the fixture with the production `computePositionKey()` and `INSERT` directly | **REJECTED** — the fixture would own the dimension tuple and the write semantics; two writers for one fact, and the fixture would drift from the production default identity the moment that default changes |
| A3 | Seed the legacy row and then run the migration's legacy backfill over it | **REJECTED** — the backfill is a one-shot schema operation, not a runtime writer; it is not a stable fixture contract, and its own `:rid` / `:fallback` suffix paths emit **non-canonical** keys (`inventory-position-schema.js:270`, `:273`), i.e. it would seed a shape the canonical writer still cannot match |
| A4 | Keep the legacy row and additionally seed a canonical row | **REJECTED** — this is precisely the current defect (F2): the pair would hold a positive legacy row and a canonical row that the canonical writer increments from `-1` |
| A5 | Fix the production availability read to filter by the canonical position | **REJECTED for this unit** — it is a production change and belongs to `W10-INV-RISK-01`'s own Requirement and Design (§37.51.10) |

**Why A1 is the minimum.** `setInventoryQuantity()` is already the production absolute writer for the
four canonical absolute sites (`server/app.js:4083`, `server/modules/financial-controls.js:394`,
`server/modules/lifecycle-engine.js:810`, `server/modules/commercial-golive.js:684`). It composes
`resolveCanonicalPosition()` (`server/lib/stock.js:35-58`), which:

1. refuses a missing or inactive warehouse (`stock.js:36-37`) — the fixture's warehouse is `active=1`;
2. refuses a missing or inactive product (`stock.js:38-40`) — the fixture's product is `active=1`;
3. refuses a **bin-enabled** warehouse (`stock.js:41-43`) — the fixture warehouse carries the column
   default `bin_enabled = 0` (`inventory-position-schema.js:221`);
4. refuses a **LOT- or SERIAL-tracked** product (`stock.js:44-46`) — the fixture product carries the
   column default `tracking_policy = 'NONE'`
   (`server/migrations/v13-phase6b-traceability-quality.js:7`);
5. computes the position key with the production `computePositionKey()`
   (`server/lib/inventory-position.js:113-134`) over the frozen default identity
   `binId=NULL, ownerType='ENTERPRISE', ownerId=NULL, stockStatus='AVAILABLE', lotId=NULL,
   serialId=NULL` (`stock.js:26-33`).

Every one of those five preconditions was **verified against the fixture's actual seed data**, not
assumed. The applicability of A1 is therefore established, not presumed.

### 37.51.3 Chosen design — the new `seedWave10Inventory()` data flow

```
seedWave10AcceptanceBase(db, options)
  ├─ INSERT warehouses  'w10-race-warehouse'  active=1, bin_enabled=0   (unchanged)
  ├─ INSERT products   'w10-race-product'   active=1, tracking_policy='NONE' (unchanged)
  ├─ seedWave10QualityPolicy(db)                                        (unchanged)
  ├─ seedProfile(...) × 1..3                                            (unchanged)
  └─ seedWave10Inventory(db)                            ◄── THE ONLY CHANGED NODE
       │
       ├─ 1. DELETE FROM inventory WHERE warehouse_id=? AND product_id=?
       │      (retained verbatim — guarantees isolation and removes any legacy row)
       │
       └─ 2. setInventoryQuantity(db, warehouseId, productId, 100, now)
              │
              ├─ resolveCanonicalPosition(db, warehouseId, productId)
              │    └─ computePositionKey(...)            ← the single source of truth
              │
              └─ upsert-equivalent absolute write:
                   INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at,
                     position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active)
                   VALUES(?, ?, ?, 100, ts, <canonical key>, NULL, 'ENTERPRISE', NULL, 'AVAILABLE', NULL, NULL, 1)
                   — or UPDATE the existing row when the canonical key is already present
```

The resulting row is **one** row with a canonical `position_key`, `owner_type='ENTERPRISE'`,
`owner_id=NULL`, `stock_status='AVAILABLE'`, `bin_id/lot_id/serial_id=NULL`, `active=1` and an
absolute `quantity=100`.

Two properties of this flow are load-bearing and are stated explicitly:

- **The DELETE stays first.** It is the only thing that guarantees the fixture never leaves a second
  row for the pair, whatever a previous run or a previous shape left behind. The canonical writer's
  own lookup is by `position_key`, so without the DELETE a stale legacy row would survive the seed.
- **The write is absolute, not a delta.** `setInventoryQuantity` sets the balance outright; it does
  not increment. This is what makes the seeded `100` independent of anything that happened before.

### 37.51.4 The single source of truth for the canonical `position_key`

There is exactly **one** place in the entire repository that decides what the canonical default stock
position of a `(product, warehouse)` pair is, and the fixture will use it and nothing else:

| Concern | Owner | Location |
|---|---|---|
| The default identity tuple | `server/lib/stock.js` `DEFAULT_POSITION` (`:26-33`) | frozen by `solution.md §27.2..§27.6` |
| The preconditions (warehouse / product / bin / tracking) | `server/lib/stock.js` `resolveCanonicalPosition` (`:35-58`) | — |
| The key derivation | `server/lib/inventory-position.js` `computePositionKey` (`:113-134`) | `solution.md §27.3`, §27.10 |
| The absolute physical write | `server/lib/stock.js` `setInventoryQuantity` (`:126-148`) | — |

Consequences that this Design **forbids**:

- the fixture must **not** import `computePositionKey` and call it with its own tuple — that would
  duplicate the default-identity decision in the fixture;
- the fixture must **not** hard-code a 64-character hex literal;
- the fixture must **not** branch on `db.dialect`.

The local regression may import `computePositionKey` **for assertion purposes only** — to state the
expected identity independently of the writer — and that is the single place where the test-side
copy of the expectation is legitimate, because it asserts against the production function rather than
replacing it.

### 37.51.5 The invariants — 100 → 99 → 98

| # | Invariant | Held by |
|---|---|---|
| I1 | After seeding, exactly **one** row exists for the fixture pair | the retained DELETE + the single absolute write |
| I2 | **Zero** rows exist with `position_key IS NULL` for the pair | I1 plus the canonical write |
| I3 | The seeded row's `position_key` equals the production `computePositionKey()` of the canonical default identity | §37.51.4 |
| I4 | The seeded `quantity` is `100` (absolute, EA) | the absolute write |
| I5 | After the first canonical confirmation the same row reads `99`; after the second it reads `98` | `adjustInventory` → `upsertByPositionKey` matching the canonical key (`ON DUPLICATE KEY UPDATE`) |
| I6 | The row count for the pair stays `1` across both confirmations | the canonical key matches the seeded row, so the upsert updates instead of inserting |
| I7 | **No** row for the pair ever has a negative quantity | I6 — no row is ever created with the movement delta |
| I8 | The `inventory_transactions` rows carry `quantity_change = 1` and `balance_after = 99` then `98` | the canonical write path (unchanged) |
| I9 | No row outside the canonical position is created, changed or deleted by the fixture | the fixture writes exactly one row |

I5–I8 are the *observable* form of the correction: with the defective fixture the same sequence
produced `100` and a separate `-1` row; with the correction it produces one row at `99` then `98`.

### 37.51.6 SQLite / MySQL consistency

The correction is **dialect-neutral by construction**, and this is a property of the data shape, not
of a conditional:

- The canonical `position_key` is a pure function of the dimension tuple
  (`computePositionKey`), computed identically on both dialects. The tuple contains only the
  warehouse id, the product id and the frozen defaults — no dialect-dependent value.
- The seeded row therefore carries the **same** `position_key` on SQLite and on MySQL, which is the
  precondition for `ON CONFLICT(position_key) DO UPDATE` (SQLite) and `ON DUPLICATE KEY UPDATE`
  (MySQL, produced by `server/database/mysql-adapter.js:60`) to resolve to the same row.
- The MySQL adapter's rewrite of the upsert clause is **already proven** against the live target: the
  protected campaign executed exactly this upsert (`upsertByPositionKey`) and it inserted the
  canonical row — that insert is what created the `-1` shadow row in the first place. The corrected
  fixture reuses the very same statement shape (`setInventoryQuantity`'s INSERT carries the identical
  13-column list) and therefore needs no new MySQL schema compatibility.
- The `inventory` table's MySQL physical form is produced by the generic generator from the SQLite
  snapshot, so `position_key`, `bin_id`, `owner_type`, `owner_id`, `stock_status`, `lot_id`,
  `serial_id` and `active` exist with the same names and the same nullability on both dialects.
  `position_key` is nullable on both (`inventory-position-schema.js:228`, `:304`), so the legacy
  shape remains representable — the correction simply stops **producing** it.
- The only dialect-dependent behaviour anywhere in this area is the **row selection order** of the
  unfiltered availability read (F3), which is exactly the production risk registered as
  `W10-INV-RISK-01`. The correction does not depend on it: with exactly one row for the pair, there
  is nothing to select.

### 37.51.7 Source change whitelist — the exact intended diff (not executed)

**Three files.** Two are modified, one is created, plus one registration file.

| # | File | Change | Size |
|---|---|---|---|
| 1 | `server/test-utils/wave10-mysql-acceptance-fixture.js` | `seedWave10Inventory()`: add the import of the production `setInventoryQuantity` and replace the raw `INSERT INTO inventory(...)` with the canonical absolute write; keep the DELETE; add one fail-closed assertion on the resulting balance | ~8 lines changed |
| 2 | `server/sales-customer-wave10-inventory-fixture.test.js` **(new)** | the local inventory-seed regression, cases `W10-INV-T01`..`W10-INV-T08` (§37.51.8) | new file |
| 3 | `scripts/testing/test-suites.js` | register the new regression in the **`FULL` array only** — **not** in `FAST` — with the same explanatory comment style as the neighbouring Wave 10 entries | ~5 lines |

**Suite classification — `FULL` only, and the expected counts.** The manifest's own `FAST`
classification criterion is that `FAST` "Must not require a temp SQLite or Vite SSR"
(`scripts/testing/test-suites.js:19-20`, `:573-575`). `W10-INV-T01`..`T08` require a real database
state, the canonical inventory position identity and the deduction verification, and `createTempDb()`
(`server/test-utils/temp-db.js:72-162`) is what supplies that state — as a disposable **temp SQLite**.
The new regression therefore belongs to **`FULL` only**. It is **not** registered in `FAST`, and the
fixture does **not** bypass `createTempDb()` in order to qualify for `FAST`. No existing `FAST` /
`FULL` / `HEAVY` classification is changed by this unit — the two pre-existing `FAST` entries that
create a temp SQLite (`sales-customer-wave10-quality-policy.test.js`,
`sales-customer-wave10-acceptance-contract.test.js`) are **left exactly as they are**, and the
pre-existing tension between the manifest's header criterion and those two entries is **not** resolved
here; it is reported as an open item for a separate, authorized decision.

| Manifest counter (`validate().counts`) | Before | After the Implementation |
|---|---|---|
| `onDisk` | 196 | 197 |
| `FAST` | 23 | **23** (unchanged) |
| `FULL` | 192 | **193** |
| `HEAVY` | 7 | **7** (unchanged) |
| `ALL` (`FULL ∪ HEAVY`) | 199 | **200** |

The "Before" column is the manifest's own reading at the current HEAD (`onDisk 196 / FAST 23 /
FULL 192 / HEAVY 7 / ALL 199`, `validate().ok === true`, `errors === []`). `server/test-suite-governance.test.js`
asserts these counters **relatively** (`FAST ⊆ FULL`, `FULL ∩ HEAVY = ∅`, `ALL = FULL + HEAVY`), not
as absolute numbers, so one added `FULL` entry does not break the governance self-test.

**The intended change to `seedWave10Inventory()`**, in substance (not executed by this Design):

```js
import { setInventoryQuantity } from '../lib/stock.js';   // new import

export function seedWave10Inventory(db, {
  warehouseId = 'w10-race-warehouse', productId = 'w10-race-product', quantity = 100,
} = {}) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM inventory WHERE warehouse_id=? AND product_id=?').run(warehouseId, productId);
  const balance = setInventoryQuantity(db, warehouseId, productId, quantity, now);
  assert.equal(balance, quantity, 'the acceptance stock must be seeded at the canonical position');
}
```

**Explicitly outside the whitelist and untouched**: `server/app.js`, `server/lib/stock.js`,
`server/lib/inventory-position.js`, `server/lib/inventory-mutation.js`, every file under
`server/modules/`, every migration, the inventory schema, `server/db.js`,
`server/database/mysql-schema.js`, `server/database/mysql-adapter.js`, the three protected MySQL
suites, the Gate B suite, the concurrency suite, `server/test-utils/wave10-mysql-schema-fixture.js`,
`server/sales-customer-wave10-mysql-parity.test.js`, `server/sales-customer-wave10-credit-check.test.js`,
`server/sales-customer-wave10-quality-policy.test.js`,
`server/sales-customer-wave10-acceptance-contract.test.js`, the runner, the manifest,
`package.json`, `document.md`, `README.md`, `AGENTS.md`, `APPLY_GUIDE.md`.

**Two design decisions inside the whitelist, stated explicitly:**

- **The seeded row's `id` becomes generated.** `setInventoryQuantity` uses the production `id()`
  (`server/db.js:2209-2210`, `randomUUID()`), so the fixture no longer forces `'w10-race-inventory'`.
  A repository-wide search found **zero** references to that literal outside the fixture itself, and
  `seedWave10Inventory()` has exactly **one** caller (`seedWave10AcceptanceBase()`,
  `wave10-mysql-acceptance-fixture.js:515`). There is therefore **no compatibility obligation**, and
  the change breaks no existing test. The alternative — forcing the old id — would require the
  fixture to perform the physical write itself, which is A2 and is rejected.
- **A fail-closed assertion on the resulting balance.** `setInventoryQuantity` returns the balance it
  wrote. The fixture asserts it equals the requested quantity, so a silent refusal to seed (a missing
  warehouse, an inactive product, a refused identity) surfaces immediately at seed time instead of
  surfacing later as a confusing `库存不足` inside an unrelated business case.

### 37.51.8 Positive and negative regression plan

The new file `server/sales-customer-wave10-inventory-fixture.test.js` is a **local, dialect-neutral,
engine-independent** regression: one disposable production-mode SQLite database per case, the real
production Delivery HTTP route, the real production confirmation route, and the real production
inventory writer. It never reaches MySQL, never opens a network connection and never depends on the
calendar.

The helpers it needs — a canonical approved order, a canonical Delivery creation and confirmation —
are modelled on `server/sales-customer-wave10-quality-policy.test.js` (which already proves the same
canonical chain on SQLite), so the new file reuses a **proven** shape rather than inventing one.

| ID | Kind | Assertion | Discriminates the defect? |
|---|---|---|---|
| `W10-INV-T01` | **negative reproduction** | A deliberately seeded legacy row (`position_key IS NULL`, `quantity=100`) plus one canonical confirmation produces **two** rows for the pair — one with `position_key IS NULL` and one canonical row with `quantity = -1`. This is the machine-verifiable proof of F1/F2 and it is constructed by direct DML, so it is dialect-independent and passes in both states. | no (proves the root cause) |
| `W10-INV-T02` | positive | After the corrected seed: exactly **one** row for the pair; `position_key` non-`NULL` and equal to the production `computePositionKey()` of the canonical default identity; `owner_type='ENTERPRISE'`; `owner_id IS NULL`; `stock_status='AVAILABLE'`; `bin_id/lot_id/serial_id IS NULL`; `active=1`; `quantity = 100`. | **yes** — fails against the defective fixture |
| `W10-INV-T03` | positive | Two canonical confirmations leave exactly **one** row for the pair, at `quantity = 99` and then `98`; the `inventory_transactions` rows carry `quantity_change = 1` with `balance_after = 99` and `98`; zero rows with `position_key IS NULL`; zero rows with a negative quantity. | **yes** — fails against the defective fixture |
| `W10-INV-T04` | negative — **missing** | With the canonical row deleted, the canonical Delivery **creation** is refused by the **production** availability check, with the production refusal (the `W10-RACE-P 库存不足` message composed at `server/app.js:5646`), not by a test-local assertion. The missing case must never be mistaken for a PASS. | no (guards the negative) |
| `W10-INV-T05` | negative — **duplicate** | With a legacy row present **beside** the canonical row, one canonical confirmation moves the **canonical** row (`100 → 99`) and leaves the legacy row's quantity **untouched**. The identity, not the row count, decides what is decremented. **Determinism requirement (`W10-INV-R14`):** the legacy row's quantity must be set so that **both** candidate rows satisfy the requested quantity, so the production availability guard passes under **either** row selection of the unfiltered read; the case therefore asserts the **write** outcome only and asserts **nothing** about which row that read selected. A variant in which the two rows differ is a **known-risk reproduction** of `W10-INV-RISK-01` and is **never** evidence that the new Fixture contract holds. | no (guards the negative) |
| `W10-INV-T06` | negative — **wrong identity** | A row carrying a non-canonical `position_key` (and a row carrying a wrong `owner_type` / `stock_status`) is **not** decremented by the canonical writer; its quantity stays unchanged, and the canonical row's balance is unaffected. | no (guards the negative) |
| `W10-INV-T07` | positive | Re-running `seedWave10AcceptanceBase()` on the same database leaves exactly **one** canonical row for the pair, at `quantity = 100`, and zero legacy rows — the seed is idempotent. | **yes** — fails against the defective fixture |
| `W10-INV-T08` | positive | The whole canonical chain still completes: one approved order, one Delivery created and confirmed, exactly one `inventory_transactions` OUT row, exactly one `inventory_valuation_movements` row (`LEGACY_UNVALUED`, zero cost), exactly one receivable — i.e. the correction does not disturb any downstream canonical effect. | no (guards the business chain) |

**Two outcome classes — every case declares one, and the report must label it.**

| Class | Meaning | Cases | Expected state |
|---|---|---|---|
| **A — new Fixture contract** | asserts the canonical position identity, the row count and the balance sequence | `T02`, `T03`, `T07` (discriminating), plus the guards `T04`, `T06`, `T08` | passes on the corrected fixture; the three discriminating cases **fail** on the defective one |
| **B — known-defect / known-risk reproduction** | deliberately reproduces a mechanism that is **not** the new contract | `T01` (the defective-fixture mechanism) and any `T05` variant whose two rows differ (the `W10-INV-RISK-01` mechanism) | passes in **both** states; it proves the mechanism is still reachable and is **never** cited as evidence for class A |

A case that cannot state which class it belongs to is **not admissible**, and a class-B result must
never be reported as a pass of the new Fixture contract. This is the explicit separation between
"reproducing a known risk" and "the new Fixture contract holds" (`W10-INV-R14`).

**Discrimination proof (mandatory, and it must be executed).** Before the fixture correction is
applied, the new file is run against the **defective** fixture and `W10-INV-T02`, `W10-INV-T03` and
`W10-INV-T07` **must fail**; the Implementation then applies the correction and re-runs, and **all
eight** must pass. A run in which the three discriminating cases never failed is not evidence and
must be reported as such. This is the direct answer to F4: the regression never relies on the
business outcome alone.

**Regression execution order after the Implementation** (all on a backend that cannot resolve to
MySQL):

1. the new file, once against the defective fixture (discrimination proof) and once after the
   correction;
2. the unchanged neighbouring consumers of the shared fixture —
   `server/sales-customer-wave10-quality-policy.test.js` (`W10-QCP-T01..T04`),
   `server/sales-customer-wave10-acceptance-contract.test.js` (`AC-01..AC11`),
   `server/sales-customer-wave10-mysql-parity.test.js`, `server/sales-customer-wave10-credit-check.test.js`;
3. `pnpm test:fast`, `pnpm test`, `pnpm test:heavy`, `pnpm build`, `git diff --check` — the new
   regression is executed by **`pnpm test`** (the `FULL` gate) and is deliberately **absent** from
   `pnpm test:fast` (§37.51.7), so a green `pnpm test:fast` is **not** evidence for
   `W10-INV-T01`..`T08`;
4. a full read-only re-verification of the Requirement's `AC-INV-01`..`AC-INV-08` against the actual
   diff, item by item.

The backend isolation defect `WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT` is **not** fixed by this
unit. As the 2026-10-27 campaign did, the local gates are executed in a **controlled child process**
that explicitly strips `ERP_DB_BACKEND`, `ERP_TEST_DB_BACKEND`, `ERP_DB_HOST`, `ERP_DB_PORT`,
`ERP_DB_NAME`, `ERP_DB_USER`, `ERP_DB_PASSWORD`, `ERP_MYSQL_WAVE10_CAMPAIGN_LEASE`,
`ERP_MYSQL_WAVE10_CAMPAIGN_ID`, `ERP_MYSQL_TEST_ALLOW_RESET`, `ERP_MYSQL_TEST_DISPOSABLE_TARGET` and
`ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS`, and the child's absence of those variables is reported.

### 37.51.9 Compatibility — what the correction does and does not change

| Aspect | Effect |
|---|---|
| Fixture public shape | unchanged — `seedWave10AcceptanceBase`, its options and its return values are identical |
| Seeded pair, product, warehouse, quantity | unchanged (`w10-race-warehouse`, `w10-race-product`, `100` EA) |
| Canonical delivery / deduction / valuation / Finance / Credit behaviour | unchanged — no production path is touched |
| Protected case identities, evidence grades, runner, manifest | unchanged |
| The seeded row's `id` | changes from the fixed `'w10-race-inventory'` to a generated UUID — **zero** external references exist (§37.51.7) |
| The seeded row's `position_key` | changes from `NULL` to the canonical key — this **is** the correction |
| The number of rows for the pair during a case | changes from 2 (after the first confirmation) to 1 |

No assertion is deleted, weakened, relaxed or skipped; no amount, delivery count or tolerance is
changed; no case is skipped. The two failing protected cases keep their exact contracts
(`M-BIZ-12`: one approved order, two confirmed Deliveries, one posted invoice, two distinct Delivery
source links, `arOpenCents === 200000`, `deliveredNotSettledCents === 0`; `M-BIZ-14`: two salespersons,
two order → Delivery chains, one cross-salesperson invoice, `200000` cents invoiced, `100000` cents
collected, residual AR `100000`, residual **not** attributed to either salesperson).

### 37.51.10 The production inventory risk — the explicit boundary

`W10-INV-RISK-01` (registered in the Requirement §8) is **not** resolved by this correction and must
not be reported as resolved. The boundary is stated precisely:

- **What this unit fixes** — the *fixture* now seeds a canonical stock row, so the acceptance suites
  traverse the real canonical delivery chain with one canonical position and the balance sequence
  `100 → 99 → 98`.
- **What this unit does not fix** — the production availability read at `server/app.js:5645` and
  `server/app.js:5876` still selects the first row of an unfiltered `(warehouse_id, product_id)` set.
  On a real database that holds a legacy-shaped or otherwise differently-identified row for the same
  pair, the read can still select the wrong row — and the consequence is **not** limited to a false
  out-of-stock report:
  - **Direction A — false refusal.** The selected row's quantity is lower than the canonical
    position's, so the guard refuses a Delivery that the stock could satisfy. This is the failure
    mode actually observed.
  - **Direction B — false allowance, then a negative canonical balance.** The selected row's quantity
    is higher than the canonical position's, so the guard **passes** and the out-bound proceeds even
    though the canonical position cannot cover it. The canonical writer then lands the delta on the
    canonical row and carries **no** negative-balance guard (`server/lib/stock.js:60-89`:
    `quantity = inventory.quantity + excluded.quantity`), so the canonical row can be driven **below
    zero**.
- **Why the two are separable** — the fixture's legacy shape was *manufactured* by the fixture; the
  production read is *unconditional*. Correcting the first removes the manufactured trigger from the
  acceptance evidence; it does not remove the second from production.
- **Consequence for Freeze — no pre-decision.** This Design **does not** decide that `W10-INV-RISK-01`
  blocks, or does not block, the Wave 10 Final Freeze. The attribution of the **observed** acceptance
  failures to the fixture shape is unchanged (§37.51.1, F1–F4), but the defect's own risk boundary is
  wider than that observed failure mode. The **Final Freeze Review** must take an **explicit,
  recorded risk-disposition decision**: either close the risk through its **own** Requirement and
  Design, or **accept** it with a written justification under an **explicit authorization**. Neither a
  silent omission nor a blanket "not a blocker" assertion discharges it.
- **Production prevalence** — `TEST_EVIDENCE_PENDING`. No production dataset was inspected in this
  stage, so this Design makes **no** claim about how many real rows are affected and **no** claim about
  how often either direction would fire in production. Directions A and B are **source-reachable
  conclusions** derived from the read semantics and the known data shapes — the demo seed's
  `position_key = NULL` rows (`server/db.js:1827-1838`) and the migration backfill's `:rid` /
  `:fallback` non-canonical suffixes
  (`server/migrations/inventory-position-schema.js:270`, `:273`).
- **This unit authorizes no production change.** `server/app.js`, `server/lib/stock.js` and the
  inventory schema are outside the whitelist (§37.51.7); `W10-INV-RISK-01` is **not** part of the
  Fixture Implementation's production-code scope.

### 37.51.11 Gate B re-acceptance and the protected Full Acceptance preconditions

**A protected Gate B re-run becomes mandatory.** `server/mysql-sales-customer-wave10-gate-b.integration.js`
imports the shared acceptance fixture (`:10-14`), and `server/mysql-sales-customer-wave10-concurrency.integration.js`
reaches it through `withWave10Race()` → `seedWave10AcceptanceBase()`. The fixture is therefore inside
the Gate B import closure, and the existing `WAVE10_GATE_B_PASS` transcript **no longer corresponds to
the post-correction working tree**. The Gate B typed M-board evidence must be regenerated before the
final Acceptance review.

The protected Full Acceptance (`pnpm.cmd test:mysql:wave10`, suites `W10-PARITY`, `W10-RACES`,
`W10-BUSINESS-MATRIX`) has the same dependency on the corrected fixture and therefore also requires a
fresh run. Its preconditions are:

1. a protected Gate B re-run that reaches **12/12 + 7/7** with a strict TAP transcript, the seven
   typed evidence digests recomputed, and `CLEANUP_CONFIRMED` plus the five-category zero inventory;
2. the between-campaign safety gate: no surviving campaign process, no undecided campaign lease, no
   foreign session on the target, identity / grants / `sql_mode` / foreign-key enforcement unchanged,
   and no repository change between the two campaigns;
3. a fresh read-only preflight against the dedicated disposable target
   (`127.0.0.1:3306 / modern_erp_wave10_disposable_test / wave10_acceptance`), with the destructive
   authorization variables stripped from the preflight child process;
4. `ERP_MYSQL_WAVE10_SUITE_TIMEOUT_MS` set inside the runner's legal range, and the campaign budget
   re-derived from the observed per-case runtime — the `W10-BUSINESS-MATRIX` suite has **never** run to
   completion, so the previous estimate remains an unproven bound, and **a timeout is INCONCLUSIVE**,
   neither a PASS nor a product defect;
5. the already-verified launcher mechanism preserved unchanged: OS-level `Start-Process` with
   separate absolute-path stdout / stderr files and the real process exit code, never
   `$ErrorActionPreference='Stop'` combined with `2>&1 | Tee-Object`;
6. **exactly one** Full Acceptance run, with no mid-campaign patching and no automatic retry.

**Neither the Gate B re-run nor the Full Acceptance is authorized by this Design.** Both require a
separate explicit authorization.

### 37.51.12 Rollback and acceptance evidence

**Rollback.** The Implementation touches three files, all of them test contracts: one fixture, one new
local regression, one suite registration. There is **no** schema rollback, **no** data rollback and
**no** production rollback. The rollback is a single-step revert of the three whitelisted files,
which restores the pre-Implementation state — and therefore re-opens `M-BIZ-12` and `M-BIZ-14` in the
protected Full Acceptance, which must be accompanied by a new Requirement record.

Rollback triggers: any local gate failure that cannot be attributed to the three intended changes;
any divergence between the local regression's expectations and the protected campaign's real
behaviour; any sign that the correction touched a file outside the whitelist; any evidence that the
seeded row's identity differs between SQLite and MySQL.

**Acceptance evidence, in order.** None of it is executed by this Design.

1. the discrimination proof — the new regression **failing** on `W10-INV-T02`, `W10-INV-T03` and
   `W10-INV-T07` against the defective fixture, and **passing** on all eight cases after the
   correction (§37.51.8);
2. the four unchanged neighbouring local suites;
3. `pnpm test:fast`, `pnpm test`, `pnpm test:heavy`, `pnpm build`, `git diff --check`;
4. a full read-only re-verification of `AC-INV-01`..`AC-INV-08` against the actual diff;
5. the protected Gate B re-run, under its own authorization, reaching 12/12 + 7/7;
6. the protected Full Acceptance, under its own authorization, reaching `W10-PARITY` 7/7,
   `W10-RACES` 12/12 and `W10-BUSINESS-MATRIX` **20/20** — the last of these being the first evidence
   that `M-BIZ-12` and `M-BIZ-14` pass on the real MySQL target;
7. strict TAP, the final cleanup confirmation and the five-category zero inventory;
8. the Final Freeze Review, at which point `W10-INV-RISK-01` must be given an **explicit, recorded
   risk-disposition decision**: closed through its own Requirement and Design, or explicitly accepted
   with a written justification under an explicit authorization. This Design records **no**
   pre-decision that the risk is non-blocking.

### 37.51.13 Design status

The Design is complete and internally consistent: the shared root cause of `M-BIZ-12` and `M-BIZ-14`
is established from captured live evidence and from the exact production source paths, not inferred
from the error message; the correction is a single reuse of the production canonical absolute writer,
so the fixture owns no identity decision of its own; the invariants `100 → 99 → 98` on exactly one
canonical row are specified in their observable form; the dialect neutrality is a property of the
data shape; the regression is designed to **discriminate** the defect rather than merely observe a
business outcome, because SQLite's row order masks the MySQL refusal; the compatibility analysis
establishes that no existing test depends on the removed fixed inventory id; the post-stock readiness
audit found no statically discoverable contradiction behind the two failures; the production inventory
risk is registered as an independent item with an explicit boundary against the fixture correction;
and the mandatory Gate B re-run and the protected Full Acceptance preconditions are stated with the
already-verified launcher mechanism preserved.

**No issue blocks Implementation.**

This Design was corrected on 2026-10-27 by the bounded Requirement Addendum Correction → Design
Correction recorded in §37.51.14. The corrections are the **test-suite classification** (`FULL` only,
not `FAST`) and the **`W10-INV-RISK-01` risk boundary** (two directions, and no Freeze pre-decision);
every other Design decision is unchanged.

**Status: `WAVE10_INVENTORY_FIXTURE_DESIGN_CORRECTED`.**

### 37.51.14 Design correction record (2026-10-27)

The user authorized a **bounded** correction of the completed Requirement and Design — two corrections,
**no re-audit** — under AGENTS.md §4.0 (consecutive-stage authorization), with a HARD STOP at the end of
the Design correction. The matching Requirement correction is recorded in `document.md` → §12 of the
"Wave 10 Inventory Fixture Requirement (2026-10-27)". **Implementation is not authorized by this
correction.** No implementation, no test execution, no build, no MySQL connection, no database query,
DDL, DML, migration execution or reset, no Gate B or Full Acceptance run, no Git write operation, no
Freeze and no Wave 11 was performed.

| # | Correction | Before | After |
|---|---|---|---|
| **D1** | **Test-suite classification** | §37.51.7 registered the new regression in the `FAST` **and** the `FULL` arrays; §37.51.8 listed `pnpm test:fast` in the execution order without stating which gate actually runs the new file | §37.51.7 registers it in the **`FULL` array only** (never `FAST`), forbids bypassing `createTempDb()` to qualify for `FAST`, leaves every existing `FAST` / `FULL` / `HEAVY` classification untouched, and states the **expected counts** (`onDisk 196→197`, `FAST 23→23`, `FULL 192→193`, `HEAVY 7→7`, `ALL 199→200`); §37.51.8 states that the new regression is executed by `pnpm test` and is deliberately **absent** from `pnpm test:fast` |
| **D2** | **`W10-INV-RISK-01` risk boundary** | §37.51.10 said the read "can still select the wrong row and refuse a satisfiable Delivery" and pre-decided that the risk "does **not** block the Wave 10 Freeze on its own" | §37.51.10 keeps **both** directions — **A** false refusal, and **B** false allowance followed by a possible **negative canonical balance**, the canonical upsert carrying no negative-balance guard — and replaces the Freeze pre-decision with an explicit requirement that the **Final Freeze Review** record a risk-disposition decision (close through its own Requirement and Design, or accept with a written justification under an explicit authorization) |
| **D3** | **Outcome classes in the regression** | the `T05` row asserted the write outcome but did not say what the case does with the non-deterministic availability read, and no classification separated a risk reproduction from a contract pass | §37.51.8's `T05` row carries a **determinism requirement** (`W10-INV-R14`: both rows satisfy the requested quantity, so the case asserts the write outcome only and asserts nothing about which row the read selected), and a new **two-class table** (class A new Fixture contract / class B known-defect or known-risk reproduction) states that a class-B result is never evidence for class A |

**Contradictions eliminated.**

1. **Test layering.** The manifest's `FAST` criterion ("Must not require a temp SQLite or Vite SSR",
   `scripts/testing/test-suites.js:19-20`, `:573-575`) contradicted the Design's instruction to register a
   `createTempDb()`-backed regression in `FAST`. Resolved by `W10-INV-R13` + §37.51.7: **`FULL` only**.
2. **Risk boundary.** The Requirement's "over-refusal, not a stock corruption" framing and the
   "does not block the Freeze by itself" pre-decision contradicted the source-reachable direction B
   (the unguarded canonical upsert, `server/lib/stock.js:60-89`). Resolved by the dual-direction impact
   statement and the explicit, recorded Final Freeze Review disposition.

**Unchanged by this correction.** The use of the production `setInventoryQuantity()` to establish the
canonical inventory position; the `100 → 99 → 98` balance contract; the `M-BIZ-12` and `M-BIZ-14`
original business assertions; the positive / negative verification goals of `W10-INV-T01`..`T08`; the
SQLite / MySQL isolation requirement; the judgement that the shared-fixture change invalidates the
existing Gate B evidence; the **three-file Implementation whitelist**; and every production Schema,
migration and inventory business implementation.

**Final Implementation whitelist (unchanged, three files).**

| # | File | Change |
|---|---|---|
| 1 | `server/test-utils/wave10-mysql-acceptance-fixture.js` | `seedWave10Inventory()` — production canonical absolute write + retained DELETE + one fail-closed balance assertion |
| 2 | `server/sales-customer-wave10-inventory-fixture.test.js` **(new)** | the local regression `W10-INV-T01`..`T08`, registered in **`FULL` only** |
| 3 | `scripts/testing/test-suites.js` | register the new regression in the **`FULL` array only** |

**Final test layering.** `FAST` 23 (unchanged) · `FULL` 192 → 193 · `HEAVY` 7 (unchanged) ·
`ALL` 199 → 200 · `onDisk` 196 → 197.

**Status: `WAVE10_INVENTORY_FIXTURE_DESIGN_CORRECTED`.**
## 37.53 Package B — Local Test Backend Isolation Design (2026-10-27)

### 37.53.1 Scope, authorization, and the constraints this design must satisfy

This section is the **Design** record for the Package B unit whose Requirement is
`document.md` → `## Package B — Local Test Backend Isolation Requirement (2026-10-27)`.
It is produced under the AGENTS.md §4.0 continuous authorization granted by the user, which
covers **Requirement → Design** only.

**Design-only.** No implementation is performed by this record. The Implementation requires a
separate, explicit authorization.

**Input basis actually read for this design** — `package.json`; `scripts/testing/run-tests.js`
(full, 123 lines); `scripts/testing/test-suites.js` (criteria and editing rules);
`server/test-utils/temp-db.js` (full); `server/db.js` (`createDatabase`, `shouldSeedDemoData`);
`server/database/config.js` (full, 54 lines); `scripts/admin/setup-admin.mjs` (full, 176 lines);
`server/setup-admin.test.js`; `server/phase-e-accounting.test.js`; `server/production-safety.test.js`;
`server/reset-safety.test.js`; `server/mysql-adapter-timeout.test.js`;
`server/database/test-fixtures/delayed-mysql-worker.js`; `server/test-suite-governance.test.js`;
`server/database/mysql-adapter.js`; `server/database/mysql-schema.js`;
`server/test-utils/mysql-disposable-target.js`; `server/test-utils/mysql-wave10-campaign-target.js`;
`server/reset-data.js`; the seven HEAVY suite members; and every `scripts/gates/*` entry point.

**Constraints carried from the Requirement that bind this design:**

| # | Constraint | Design consequence |
|---|---|---|
| C1 | The ordinary child MUST be explicitly SQLite (`PB-ISO-R02`) | a positive pin, not the absence of a competing variable |
| C2 | `ERP_DB_PATH` MUST be **absent**, not redirected (`PB-ISO-R04`) | the sanitized env deletes it; `resolveDatabaseConfig`'s sqlite branch then fails closed for any code path that needs an explicit target |
| C3 | Production resolution MUST NOT change (`PB-ISO-R06`) | `server/db.js` and `server/database/config.js` are **not** in the whitelist |
| C4 | Protected gates MUST be unaffected (`PB-ISO-R07`) | the change is confined to the ordinary launcher and a module only it imports |
| C5 | No MySQL opt-in (`PB-ISO-R12`) | the ordinary launcher exposes no switch that can select MySQL |
| C6 | Fail closed (`PB-ISO-R10`) | the sanitized env is verified after construction; a surviving forbidden name aborts the run |
| C7 | No parent pollution (`PB-ISO-R11`) | the sanitizer returns a new object; it never writes `process.env` |
| C8 | No secret disclosure (`PB-ISO-R09`) | the launcher reports **names** and presence only |

### 37.53.2 Module and function responsibility

Three files, one of them new. The design deliberately separates *policy* (what must not be
inherited) from *mechanism* (how the child is spawned) so the policy is unit-testable as a pure
function.

**`scripts/testing/test-env.js` — NEW. Side-effect-free isolation policy.**

| Export | Responsibility |
|---|---|
| `ISOLATED_TEST_BACKEND` | the single pinned backend value, `'sqlite'` |
| `FORBIDDEN_INHERITED_ENV_NAMES` | the closed list of environment variable names that MUST NOT appear in an ordinary test child. Derived from the code, not from the operating system — see §37.53.4 |
| `buildIsolatedTestEnv(parentEnv)` | **pure.** Returns a **new** environment object for the ordinary test child: a copy of the parent environment, minus every forbidden name, plus the pinned backend. Also returns the list of removed **names** for reporting. Never reads or writes `process.env`; never mutates its argument |
| `assertIsolatedTestEnv(env)` | **pure.** Verifies a candidate environment satisfies the contract: the pinned backend is exactly `ISOLATED_TEST_BACKEND`, and no forbidden name survives (matched case-insensitively). Throws an error naming the offending **variables** — never their values |

The module imports nothing from `server/`, has no side effects at import time, and performs no I/O.

**Why the policy cannot live inside `scripts/testing/run-tests.js`.** `run-tests.js` is a
top-level-effect program: at import it parses `process.argv`, validates the suite manifest,
may `process.exit(2)`, and — absent `--list` — spawns the test runner. A test file that
imported it would execute the whole runner instead of testing it. A separate, side-effect-free
module is therefore the only shape that admits a pure-function regression. This is the "necessary
regression" that justifies exceeding a one-file change.

**`scripts/testing/run-tests.js` — MODIFIED. Mechanism only.**

The launcher keeps every existing responsibility (suite resolution, manifest validation, missing
file check, `--list`, exit-code propagation) **byte-for-byte in behaviour**. The only change is
at the environment-construction site: instead of `const env = { ...process.env }` it constructs
the isolated environment through `buildIsolatedTestEnv(process.env)`, verifies it through
`assertIsolatedTestEnv`, reports the isolation status by name, and hands the verified object to
`spawn` as the child's `env`.

**`server/test-suite-governance.test.js` — MODIFIED. The regression.**

Package B's regression cases are added here. §37.53.10 justifies the placement and states the
alternative that was rejected.

### 37.53.3 Call and data flow

```text
developer shell (may carry ERP_DB_BACKEND=mysql, ERP_DB_PATH, ERP_DB_PASSWORD, …)
        │
        ▼
scripts/testing/run-tests.js  <suite> [--list] [--filter]
        │  1. resolve suite  → 2. validate manifest  → 3. --list? → exit(0)
        │  4. missing-file check → exit(2)
        ▼
  buildIsolatedTestEnv(process.env)      ← pure; returns a NEW object
        │  • copy parent env
        │  • drop every FORBIDDEN name (case-insensitive)
        │  • pin ERP_DB_BACKEND = 'sqlite'
        ▼
  assertIsolatedTestEnv(env)             ← pure; throws on any violation
        │  violation → print offending NAMES → exit(2)   (fail closed, C6)
        ▼
  report isolation status (names only, no values, C8)
        ▼
  spawn(process.execPath, ['--test', …files], { env })      ← the ONLY change of substance
        │
        ▼
  node --test → one child process per test file
        │
        ├─ createTempDb()  → SQLite branch  (ERP_TEST_DB_BACKEND absent)
        ├─ setupAdmin()    → backend resolves to 'sqlite' → createDatabase(dbPath)
        ├─ createDatabase(path)  → SQLite, env irrelevant
        └─ reset-data spawns → ERP_DB_PATH absent → refuses without a target
```

The isolation boundary is the **`spawn` call**. Everything above it runs in the developer's
process and is unaffected; everything below it sees only the sanitized environment.

### 37.53.4 The complete sanitization contract

This is the closed list. Every name is read by code in `server/`, `scripts/` or `src/`; the list
is derived from the code, so it is complete with respect to database-target drift and does not
depend on what happens to be exported in any particular shell.

**A — MUST be absent from the ordinary test child (22 names).**

| Group | Names |
|---|---|
| Backend selector (test-only) | `ERP_TEST_DB_BACKEND` |
| Backend selector (production) | `ERP_DB_BACKEND` — deleted here, then re-pinned (see B) |
| Database path | `ERP_DB_PATH` |
| Connection endpoint & credential | `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_DB_NAME`, `ERP_DB_USER`, `ERP_DB_PASSWORD`, `ERP_DB_SSL`, `ERP_DB_SSL_REJECT_UNAUTHORIZED` |
| Demo seed toggle | `ERP_SEED_DEMO` |
| Destructive-target authorization | `ERP_MYSQL_TEST_ALLOW_RESET`, `ERP_MYSQL_TEST_DISPOSABLE_TARGET`, `ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS` |
| Production reset sentinel | `ERP_RESET_PRODUCTION_OK` |
| Wave 10 campaign identity & lease | `ERP_MYSQL_WAVE10_CAMPAIGN_ID`, `ERP_MYSQL_WAVE10_CAMPAIGN_LEASE`, `ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID`, `ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER`, `ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256`, `ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY`, `ERP_MYSQL_WAVE10_INITIAL_INVENTORY` |

**B — MUST be explicitly set (1 name).**

| Name | Value | Rationale |
|---|---|---|
| `ERP_DB_BACKEND` | `'sqlite'` | satisfies `PB-ISO-R02` by positive selection. `setup-admin.mjs:72` and `config.js:29` then both resolve SQLite, and `config.js:30` would reject any other value |

**C — MUST be preserved (unchanged from the parent environment).**

| Name(s) | Rationale for keeping |
|---|---|
| `NODE_ENV` | Not a target selector. Only the literal `'production'` suppresses the demo seed (`server/db.js:1852`) and blocks `reset-data` (`server/reset-data.js:48`). Changing it would alter existing test semantics, which `PB-ISO-R13` forbids. The isolated environment therefore reproduces the clean-shell behaviour rather than imposing a new value |
| `ERP_DB_TX_RETRY_MAX` | A MySQL transaction-retry ceiling, inert under SQLite. It cannot cause target drift |
| `ERP_GATE_ATTEMPTS_MAX`, `ERP_GATE_ATTEMPTS_BUDGET_MS` | Sales Delivery confirmation retry tuning — business behaviour under test, not target selection. Removing them would change what the delivery-confirm retry cases exercise |
| `NODE_TEST_FLAGS` | Consumed by `run-tests.js:101` to build the child's test-runner flags. Preserving it keeps the existing CI override behaviour |
| All operating-system variables (`PATH`, `SystemRoot`, `COMSPEC`, `PATHEXT`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `LANG`, `LC_ALL`, …) | Required for the child process to start at all on every supported platform |

**D — Explicitly NOT in scope.** `DATABASE_URL` is read nowhere in the repository. It is
included in the forbidden list anyway as a defensive measure so that a future reader cannot
introduce a second backend selector without the isolation catching it.

### 37.53.5 Construction mechanics — the four details that decide correctness

**M1 — The parent environment is never mutated.** `buildIsolatedTestEnv` takes the parent
environment as an *argument*, copies it into a fresh object, and returns that object. It performs
no assignment to `process.env` and no `delete` on it. The launcher then passes the returned
object to `spawn`. `PB-ISO-R11` is satisfied by construction, not by discipline. The design does
not attempt to restore anything afterwards, because nothing is changed.

**M2 — Deletion is case-insensitive.** On Windows `process.env` is a case-insensitive proxy, and
a child resolves `process.env.ERP_DB_BACKEND` case-insensitively. A developer shell that exports
`erp_db_backend=mysql` would therefore still select MySQL in the child if the sanitizer removed
only the exactly-cased key. The sanitizer therefore iterates the parent's keys and drops **every**
key whose upper-cased form is in the forbidden set. On POSIX this is a harmless superset (env
names are case-sensitive there, so `erp_db_backend` was never a selector); on Windows it closes a
real bypass. This is the substance behind `AC-ISO-09` / `T09`.

**M3 — The backend is pinned positively, not left absent.** `ERP_DB_BACKEND` is deleted in the
forbidden pass and then **set** to `'sqlite'`. Setting it explicitly means that the isolation does
not depend on a future default change in `config.js:29` or `setup-admin.mjs:72`, and it satisfies
`PB-ISO-R02`'s "positive, not merely absence" wording.

**M4 — The contract is verified, not assumed.** After construction the launcher calls
`assertIsolatedTestEnv` on the candidate environment. The 22-variable denylist governs
**inherited values**: all 22 denylisted variables MUST be removed from the candidate
environment, and the final child environment MUST then contain exactly one correctly-spelled
`ERP_DB_BACKEND` key whose value is `'sqlite'`. The other 21 denylisted variables MUST be
absent from the final environment, and no additional case-insensitive variant of
`ERP_DB_BACKEND` may be present. Any such variant, or any non-`'sqlite'` value, MUST fail
closed. On failure the launcher prints the **offending variable names** and exits non-zero
(`:2`, matching the runner's existing fail-closed convention for manifest and missing-file
failures). It never falls back to the un-sanitized environment, and never proceeds with a
partially sanitized one — `PB-ISO-R10`. Environment verification reports variable **names**
only; it never emits a variable value or a secret — `PB-ISO-R09`.

*Bounded Design erratum (2026-10-27). The preceding M4 wording is corrected to state the
denylist-versus-pin distinction explicitly: the 22-variable denylist governs inherited
values, while the final child environment carries exactly one canonical `ERP_DB_BACKEND`
key set to `'sqlite'` and none of the other 21 denylisted variables. The correction changes
no Requirement, no implementation rule and no acceptance condition; it aligns the Design
text with the approved and tested `scripts/testing/test-env.js` behaviour as locked by
`PB-ISO-T05`, `PB-ISO-T09` and `PB-ISO-T12`.*

### 37.53.6 `setupAdmin()` and `createTempDb()` compatibility

**`setupAdmin()` — no change to the script, and none is permitted.**

`scripts/admin/setup-admin.mjs:72` derives the `backend` parameter from
`process.env.ERP_DB_BACKEND`. Inside the ordinary test child that variable is pinned to
`'sqlite'`, so the default resolves to `'sqlite'` and `:98-99` takes the SQLite branch:
`createDatabaseFn(dbPath)` → `createSqliteDatabase(dbPath)` → the environment is never consulted
for the path. The caller's `dbPath` is honoured, which is exactly what
`server/setup-admin.test.js:320-333` asserts and what `server/phase-e-accounting.test.js:208-209`
relies on.

Changing `setup-admin.mjs` would be wrong on two counts. First, `:135` and `:93-96` are the
production MySQL administrator bootstrap path — an operator selects MySQL there through the
environment — so altering the default would break that path. Second, `server/setup-admin.test.js:
257-317` injects both `backend: 'mysql'` **and** a fake `createDatabaseFn`, so it needs no live
MySQL and is unaffected by the environment in any case. The script is therefore outside the
Implementation whitelist.

**`createTempDb()` — no change to the helper.** With `ERP_TEST_DB_BACKEND` absent,
`server/test-utils/temp-db.js:78` takes the SQLite branch, and `assertNotRepoPath` (`:28-44`,
applied at `:116`) protects the temporary path from resolving inside the repository. The MySQL
branch (`:79-112`) becomes unreachable from the ordinary suite; its disposable-target guard
(`server/test-utils/mysql-disposable-target.js:17-39`) remains as defence-in-depth for any direct
caller. The helper is outside the Implementation whitelist.

**`createDatabase()` / `resolveDatabaseConfig()` — no change.** `server/db.js:573` keeps the
string form bypassing the environment entirely, and `:574` keeps the object / no-argument form
environment-driven for production. `config.js:33-35` keeps failing closed when a SQLite path is
required and absent — which is precisely why `PB-ISO-R04` demands *absence* rather than a
redirected path: a redirected path would silently select a database, whereas absence makes every
such code path refuse.

### 37.53.7 FAST / FULL / HEAVY / ALL compatibility

`package.json` routes `test`, `test:fast`, `test:heavy`, `test:all` and `test:list` through the
single runner `scripts/testing/run-tests.js`, so **one** boundary covers all four suites
(`PB-ISO-R01`) and the boundary is independent of the suite name.

| Aspect | Effect |
|---|---|
| Suite manifest | **unchanged** — `scripts/testing/test-suites.js` is not modified; no file is added, removed, or reclassified; `FAST ⊆ FULL`, `FULL ∩ HEAVY = ∅` and `ALL = FULL ∪ HEAVY` all continue to hold (`AC-ISO-07`) |
| On-disk discovery | unchanged — `listTestFilesOnDisk` and `validate` are untouched |
| Resolved file list | unchanged — the sanitized environment does not participate in suite resolution |
| `--list` | unchanged — `run-tests.js:76-83` exits before any environment is constructed |
| Exit-code propagation | unchanged — `:111-117` is untouched; `:111-117`'s signal handling and `code === null ? 1 : code` semantics are preserved |
| `NODE_TEST_FLAGS` | preserved (list C), so the CI override still works |

**HEAVY, file by file.** The HEAVY suite has exactly seven members; each was read.

| HEAVY member | Effect of Package B |
|---|---|
| `server/production-safety.test.js` | **Improved, not merely unaffected.** `:19` spawns `reset-data` with `{ ...process.env, ...env }`, and the case at `:276-288` supplies only `NODE_ENV`, relying on `ERP_DB_PATH` being absent from the inherited environment. Today an ambient `ERP_DB_PATH` breaks that case. With the isolated child the variable is always absent, so the case holds deterministically on any developer machine |
| `server/reset-safety.test.js` | **Neutral.** `:92-93` already deletes `ERP_DB_PATH` and `NODE_ENV` from its own process before spawning, and `:151-168` supplies `ERP_RESET_PRODUCTION_OK: 'YES'` **explicitly** in the per-call `env`. The sanitized child removes the sentinel from the ambient, but the test supplies what it needs |
| `server/mysql-adapter-timeout.test.js` | **Unaffected.** It constructs `new MySqlSyncAdapter({}, { workerUrl: './database/test-fixtures/delayed-mysql-worker.js', requestTimeoutMs: 2_000 })` — an empty configuration, a local deliberately-delayed worker fixture, **zero** `process.env` reads, and no `createDatabase` / `createTempDb` call. It never opens a MySQL connection, so there is no database target to drift. Its timeout assertion is unaffected |
| `server/backup-restore.test.js` | **Unaffected** — no `ERP_DB_*` and no `env:` reference |
| `server/systemd.test.js` | **Unaffected** — no `ERP_DB_*` and no `env:` reference |
| `server/nginx.test.js` | **Unaffected** — no `ERP_DB_*` and no `env:` reference |
| `server/uat-r6-linux-build-architecture.test.js` | **Unaffected** — no `ERP_DB_*` and no `env:` reference |

**One honest consequence to be recorded at Implementation time.** The regression cases are added
to a file that is already in FULL, so FULL's **case count** increases (the frozen baseline is
`2923 / 2923`). This is the same shape as the frozen Wave 10 fixture precedent, where
`document.md` §`W10-INV-R13` recorded that "the only count that moves is FULL". The frozen
**file set** and every suite classification are unchanged, which is what keeps the frozen
evidence meaningful.

### 37.53.8 Protected MySQL gate non-interference

The non-interference is **structural**, not merely asserted:

1. `scripts/gates/*` and `scripts/diagnostics/*` never import `scripts/testing/run-tests.js`.
   A repository-wide search for `run-tests` under those directories returns **zero** matches.
2. Each gate selects MySQL in **its own** process and constructs **its own** child environment.
   The Gate A runner is representative: `scripts/gates/mysql-sales-wave7-gate-a.mjs:26` sets
   `process.env.ERP_DB_BACKEND = 'mysql'`, `:35-41` builds an explicit `childEnv`, and `:76-80`
   spawns with `env: childEnv`. `scripts/gates/mysql-wave10-runner-support.mjs:79-82, 119-123,
   151-154`, `scripts/gates/mysql-gate.mjs:26-40`, `scripts/gates/mysql-concurrency-gate.mjs:26-37`
   and `scripts/gates/mysql-finance-concurrency-gate.mjs:39-48` follow the same pattern.
3. The new module `scripts/testing/test-env.js` is imported by exactly two files — the ordinary
   launcher and the regression test. **No gate can load it**, therefore no gate's environment can
   be sanitized by it, and no gate's MySQL selection can be overridden by it.
4. The gates are launched by the operator (or by a protected runner), never by
   `run-tests.js`, so they inherit the developer's environment unchanged — which is exactly what
   they require.

**Consequence:** `pnpm test:mysql`, `pnpm test:mysql:legacy`, `pnpm test:mysql:concurrency`,
`pnpm test:mysql:gate-a`, `pnpm test:mysql:gate-b`, `pnpm test:mysql:wave10`,
`pnpm test:mysql:performance` and `pnpm test:mysql:finance-concurrency` continue to select MySQL
and continue to enforce their own disposable-target, campaign-lease and expected-identity guards.
`AC-ISO-08` is satisfied by this static structure and requires **no** MySQL execution to verify.

### 37.53.9 Cross-platform behaviour

| Concern | Resolution |
|---|---|
| Shell dependence | None. The child environment is a plain JavaScript object handed to Node's `spawn(..., { env })`, which is Node's own cross-platform mechanism. No shell is invoked, no command string is built, and no POSIX-only path form is used |
| Windows variable-name case | Handled by M2 (case-insensitive deletion). Without it, `erp_db_backend=mysql` on Windows would still select MySQL in the child |
| Windows child startup | The sanitizer removes only the enumerated names, so `SystemRoot`, `COMSPEC`, `PATHEXT` and `PATH` are preserved and the child starts normally |
| POSIX child startup | `PATH`, `HOME`, `TMPDIR` and the locale variables are preserved |
| Temporary directory | Unchanged. `server/test-utils/temp-db.js` uses `node:os` `tmpdir()` and `mkdtempSync`; the sanitizer does not touch `TMPDIR`/`TEMP`/`TMP` |
| Line endings | The changed files are JavaScript sources with LF endings already; the change introduces no CRLF/LF mixing |
| Windows vs Linux equivalence of the contract | The forbidden list is the same on every platform; only the *matching* is case-insensitive, which is a superset of POSIX behaviour and therefore never weaker |

`AC-ISO-09` / `T09` is satisfied by M2 plus the fact that no platform-specific API is used.

### 37.53.10 Regression design — where the Package B regression lives, and what it asserts

**Placement decision: extend `server/test-suite-governance.test.js`; do not add a new test file.**

Reasons, in order of weight:

1. **No manifest change is required, and a manifest change is forbidden by this unit.**
   `scripts/testing/test-suites.js:19-33` requires every on-disk `*.test.js` to be classified into
   a suite. A new test file would therefore have to be added to `scripts/testing/test-suites.js`
   — and that file was touched by the frozen Wave 10 commit and is covered by the freeze
   fingerprint. Extending an already-classified file avoids that entirely.
2. **The file is already registered in FAST and FULL** (it self-lists, by design, with an
   explanatory note at its header). The regression therefore runs in both suites with **no**
   change to any existing classification, and `FAST ⊆ FULL` continues to hold.
3. **It already imports from `scripts/testing/`** — the same directory as the new module — so the
   import path follows an established precedent in that very file.
4. **Subject-matter fit.** The file is the suite runner's own contract self-test. The Package B
   contract is the suite runner's environment contract.
5. **FAST eligibility.** The new cases need no temporary SQLite, no Vite SSR and no database.
   They satisfy the documented FAST criterion at `scripts/testing/test-suites.js:29-31` and the
   supplementary statement at `:582-585` ("the fast suite must remain a deterministic regression
   within seconds"). The only child processes involved are a bounded number of trivial `node -e`
   probes.

**The rejected alternative**, recorded so the decision is reviewable: a new file such as
`server/test-runner-env-isolation.test.js`, registered in FAST **and** FULL, would also satisfy
the manifest rules — listing it in both keeps `FAST ⊆ FULL`, and listing it in the manifest
satisfies the "every on-disk test file is classified" invariant, with no `HEAVY` justification
record required because `FULL ∩ HEAVY = ∅` is unaffected. It was rejected because it edits the
frozen suite manifest, changes the FULL **file set**, and therefore moves the frozen FULL
baseline's file count — all in exchange for a file split that the existing placement already
provides.

**Case design.** The cases use three evidence techniques only — a pure function over a
constructed parent environment, a child-process environment probe, and a static contract
assertion. **No case connects to MySQL, and no case uses a real destructive authorization.**

| # | Case | Technique | Asserts |
|---|---|---|---|
| `PB-ISO-T01` | clean parent → SQLite | pure function | the pinned backend is `'sqlite'`; the forbidden set is absent; no forbidden name survives |
| `PB-ISO-T02` | parent carries `ERP_TEST_DB_BACKEND=mysql` | pure function + child probe | the child environment does not contain `ERP_TEST_DB_BACKEND`; the child's resolved backend is SQLite; `createTempDb()` takes its SQLite branch — **asserted without opening a MySQL connection** |
| `PB-ISO-T03` | parent carries `ERP_DB_BACKEND=mysql` | pure function + child probe | the child environment's `ERP_DB_BACKEND` is `'sqlite'`; the child's resolved backend is SQLite |
| `PB-ISO-T04` | parent carries `ERP_DB_PATH` | pure function + child probe | `ERP_DB_PATH` is absent from the child; the existing `production-safety` refusal case continues to hold |
| `PB-ISO-T05` | parent carries credentials, reset authorization, destructive approval, production sentinel and the whole Wave 10 campaign set | pure function | **none** of the enumerated names appears in the child environment; the case iterates the complete forbidden list rather than a hand-picked subset, so a future addition to the list is automatically covered |
| `PB-ISO-T06` | `setupAdmin()` without an explicit `backend` | existing behaviour + explicit assertion | the administrator is persisted in the caller-supplied SQLite path; no MySQL connection is attempted |
| `PB-ISO-T07` | suite semantics | static contract | the manifest, the on-disk discovery, the resolved file lists for FAST/FULL/HEAVY/ALL and the exit-code propagation are unchanged; the launcher exposes no argument that selects a backend |
| `PB-ISO-T08` | protected gates | static contract | every `test:mysql*` entry point still resolves to a gate runner under `scripts/gates/` or `scripts/diagnostics/`, still selects MySQL through its own launcher, and does not import the ordinary launcher |
| `PB-ISO-T09` | cross-platform | pure function | the forbidden-name matching is case-insensitive: a parent key differing only in case is still removed; the preserved set still contains the platform variables the child needs |
| `PB-ISO-T10` | no secret disclosure | static contract | the launcher's reporting surface contains variable **names** only; no environment variable value is interpolated into any output path |
| `PB-ISO-T11` | no parent pollution | in-process assertion | the launcher's own `process.env` is unchanged before and after the run |
| `PB-ISO-T12` | no MySQL opt-in | static contract | the ordinary launcher's argument and environment interface exposes no switch that can cause a MySQL backend to be selected |

**Fail-closed proof.** `PB-ISO-T10`/`T12` are static; in addition, the `assertIsolatedTestEnv`
failure path is covered by a pure-function case that feeds a deliberately contaminated candidate
environment and asserts that the assertion rejects it and names the offending variables — without
spawning anything.

### 37.53.11 Exact future Implementation file whitelist

| # | File | Change |
|---|---|---|
| 1 | `scripts/testing/test-env.js` | **NEW** — the side-effect-free isolation policy and the pure `buildIsolatedTestEnv` / `assertIsolatedTestEnv` functions |
| 2 | `scripts/testing/run-tests.js` | **MODIFIED** — construct, verify, report and pass the isolated environment to `spawn`; nothing else changes |
| 3 | `server/test-suite-governance.test.js` | **MODIFIED** — append the Package B regression cases `PB-ISO-T01..T12` |

**Explicitly NOT in the whitelist**, and unchanged by the Implementation:

`package.json`; `scripts/testing/test-suites.js`; `server/db.js`; `server/database/config.js`;
`server/database/mysql-adapter.js`; `server/database/mysql-schema.js`;
`server/test-utils/temp-db.js`; `server/test-utils/mysql-disposable-target.js`;
`server/test-utils/mysql-wave10-campaign-target.js`; `scripts/admin/setup-admin.mjs`;
`server/reset-data.js`; every file under `scripts/gates/`, `scripts/acceptance/` and
`scripts/diagnostics/`; every `server/*.test.js` other than
`server/test-suite-governance.test.js`; all schema, migration and canonical business modules;
`document.md`; `solution.md`; `AGENTS.md`; `README.md`; `APPLY_GUIDE.md`; and every release tag.

**Verification the future Implementation must execute**, in the isolated environment:

focused regression for `server/test-suite-governance.test.js` → `pnpm test:fast` → `pnpm test`
→ `pnpm test:heavy` → `pnpm build` → `git diff --check`. It **must not** re-run the Wave 10 Full
MySQL Acceptance, and it must not connect to any MySQL instance.

### 37.53.12 State, audit, and compatibility considerations

- **Transactions.** None. The unit touches no database, no schema and no data.
- **Audit.** No business mutation occurs, so no audit row is required. The launcher's isolation
  status line is the operator-visible evidence that the boundary was established.
- **State machines.** None touched.
- **RBAC / SOD.** None touched.
- **Compatibility.** The change is confined to the local test harness. Production behaviour —
  `createDatabase()`, `resolveDatabaseConfig()`, `setup-admin`, `reset-data`, the protected
  gateways — is byte-for-byte unchanged. The isolated child environment is equivalent, for
  database-target purposes, to the clean-shell environment under which the recorded
  `FAST` / `FULL` / `HEAVY` baselines were measured, which is what makes the frozen evidence
  reproducible.
- **Blast radius.** One launcher path plus one new module. The only consumer of the new module is
  the ordinary launcher and the regression test.

### 37.53.13 Failure behaviour and rollback

| Failure | Behaviour |
|---|---|
| `buildIsolatedTestEnv` throws | the launcher prints the reason (variable **names** only) and exits non-zero; it never falls back to the raw environment |
| `assertIsolatedTestEnv` finds a surviving forbidden name or a wrong pinned backend | the launcher prints the offending **names** and exits non-zero (`2`, matching the runner's existing convention at `:57` and `:91`) |
| The child process fails to start | existing behaviour at `:119-122` is preserved unchanged |
| The child exits with a signal | existing behaviour at `:111-115` is preserved unchanged |

**Rollback.** The unit produces no schema, no migration, no data change, no external state and no
database operation, so there is nothing to roll back beyond the three files. Reverting
`scripts/testing/run-tests.js` restores the previous behaviour exactly; the new module becomes
unreferenced and can be deleted; the regression cases are removed with the file change. There is
no ordering constraint between the runner change and the test change — reverting only the runner
would make the regression fail, which is the intended regression-lock behaviour, not a
rollback hazard.

**Design status: `PACKAGE_B_TEST_ISOLATION_DESIGN_APPROVED`.**

---
