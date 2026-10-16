# Sales & Customer Batch A — final acceptance evidence (2026-10-16)

This is an evidence index, not a second Requirement or Design. Authority remains `document.md §34` and `solution.md §§29–30, 34`. The frozen scope is Waves 3–5; user Acceptance and Freeze are not claimed. All tests below were executed on `feature/sales-batch-a` with the working tree left unstaged. `A` = `server/sales-customer-batch-a.test.js` (SQLite API/integration); `M` = `server/mysql-sales-customer-batch-a-concurrency.integration.js` (protected disposable MySQL); `W2` = `server/mysql-sales-customer-wave2-concurrency.integration.js`; `B` = `scripts/acceptance/sales-customer-batch-a-acceptance.mjs` (actual Edge UI on disposable SQLite). A table cell saying MySQL `race` means the named concurrency contract was executed on MySQL, not that every A assertion was independently rerun there. `—` means that modality is not an independent authority for this assertion.

## 15 direct UAT IDs

| UAT | Canonical function / API | Positive assertion | Negative and rollback assertion | SQLite / MySQL / Browser | Evidence / result |
| --- | --- | --- | --- | --- | --- |
| S-01 | quotation service; `POST /api/sales-quotations`, `/:id/effective-publish`, detail | persisted lines, validity and publish | unpublished/expired source cannot enter conversion; no SO | A PASS / MySQL race S-06 / B PASS | A quotation conversion and full quotation suite; B create/publish/detail |
| S-02 | `convertSalesQuotation`; `POST /api/sales-quotations/:id/convert-to-so` | partial quantity creates real SO with source identity | excess capacity rejected with no extra SO | A PASS / M S-06 PASS / B PASS | A multi-line conversion; B partial conversion |
| S-03 | `convertSalesQuotation`; same endpoint | second conversion consumes remaining quantity; exact replay stable | duplicate or over-conversion rejected without double consumption | A PASS / M S-06 PASS / B PASS | A duplicate/replay; B two conversions |
| S-10 | canonical SO create/update; `POST/PATCH /api/sales-orders` | customer and commercial party identities persist | invalid tax-inclusive assumption returns 422 with no SO/audit | A PASS / MySQL structural gate PASS / B SO editor PASS | A commercial parties/tax test |
| S-11 | SO line authoring; `POST/PATCH /api/sales-orders` | gift line keeps catalog evidence and zero revenue | forged zero-price/discount evidence rejected | A PASS / MySQL structural gate PASS / B — | A gift and authoritative discount tests |
| S-12 | SO snapshot writer; same endpoints | commercial tax code/basis and price evidence persist | client-forged price snapshot ignored; invalid tax flag rejected atomically | A PASS / MySQL structural gate PASS / B — | A canonical writer and commercial parties/tax tests |
| S-13 | SO submit; `POST /api/sales-orders/:id/submit` | complete draft submits | missing commercial fields/normal-line amount cannot submit; state unchanged | A PASS / MySQL structural gate PASS / B PASS | A submission completeness; B editor/submit |
| S-14 | SO approval; `POST /api/sales-orders/:id/approve` | reviewer approves and immutable commercial snapshot remains | maker/reviewer SOD and stale authority denied | A PASS / W2 S-11 PASS / B PASS | A approval/CAS; W2 snapshot race; B reviewer approval |
| S-15 | `create/update/actionSalesOrderChange`; `/api/sales-order-changes` and `/:id/{submit,approve,reject,cancel}` | four frozen modes, ADD/MODIFY, draft edit, approve/apply and cancel | requester/group/SOD, corrupt historic evidence and owner mismatch fail closed with zero version/audit/reservation effects | A PASS / M S-07/08/18 PASS / B PASS | A modes/R5–R8 lifecycle; B PATCH/submit/cancel and reviewer approve |
| S-16 | `salesOrderAction`, fulfillment projection; `/api/sales-orders/:id/{close,cancel}` | exact lower bound permits reasoned controlled close; fulfilled distinct from closed | below bound, pending DN or executed cancel rejected; no status/audit drift | A PASS / M S-19 PASS / B — | A controlled-close matrix; M close/confirm |
| S-17 | `deliveryNoticeAction`; `/api/delivery-notices` and `/:id/{confirm,cancel}` | draft create/edit, notice confirm and legal cancellation | over-schedule/invalid state denied; no inventory write on DN confirm | A PASS / M S-16/17/18 PASS / B PASS | A DN source/capacity; B create/PATCH/confirm/cancel |
| S-18 | `createSalesDelivery`, `confirmSalesDelivery`; `/api/sales-deliveries` and `POST /:id` with `action=confirm` | both real source modes, OQC, inventory OUT, value/COGS and billing semantics | bad OQC/stock/period/source/capacity/replay denied with zero economic side effects | A PASS / M S-01/08/17/19 PASS / B PASS | A zero-revenue economic test and prior SD contracts; M complete confirm; B both source UI flows |
| S-39 | SO/Change edit policy; SO and Change PATCH/action APIs | approved SO modified only via allowed controlled change path | forbidden mode/state/owner attempts leave original version intact | A PASS / M S-07/08 PASS / B Change PASS | A four modes, approval/CAS, owner tests |
| S-42 | SO commercial terms writer; SO API | commercial tax/billing terms are snapshots, not statutory invoice truth | invalid tax flag fails; no statutory invoice created by SO alone | A PASS / MySQL structural gate PASS / B — | A commercial parties/tax test; DB assertions |
| S-43 | `confirmSalesDelivery`; `POST /api/sales-deliveries/:id` with `action=confirm` | gift/full-discount zero revenue still posts inventory valuation and COGS once | replay does not duplicate cost; no zero AR/revenue/invoice rows | A PASS / M full economic confirm PASS for valued deliveries / B — | A zero-revenue gift delivery test |

The MySQL functional gate covers fresh bootstrap, legacy upgrade, replay convergence, constraints/JSON dialect and existing domain contracts; it does **not** independently replay every A-only business assertion. The SQLite A suite is the detailed Batch A UAT authority. The browser runner is the UI authority where applicable. `UAT-S-28` is covered only for the Batch A commercial/source intersection, and `UAT-S-44` only for the implemented RBAC/SOD paths; neither implies later-Wave closure.

## Nine associated races

| Race | Authority / serialized fact | Result |
| --- | --- | --- |
| R-SAL-01 | M: two full direct SD confirms on one SO line; inventory, valuation, COGS and source quantity once | PASS |
| R-SAL-06 | M: competing quotation conversions; one capacity winner, loser fully rolled back | PASS |
| R-SAL-07 | M: competing SO Change applies; one effective version and audit | PASS |
| R-SAL-08 | M: Change versus full direct SD confirm; version and economic effects serialize | PASS |
| R-SAL-11 | W2: SO approval versus pricing retirement preserves immutable snapshot | PASS (authoritative inherited Wave 2 test rerun by protected gate) |
| R-SAL-16 | M: two DN confirms cannot over-schedule SO line | PASS |
| R-SAL-17 | M: two complete SD confirms on one DN line; no duplicate inventory/value/COGS | PASS |
| R-SAL-18 | M: Change versus DN confirm retains executed floor/capacity | PASS |
| R-SAL-19 | M: SO close versus complete SD confirm; no confirm after close | PASS |

The four complete-confirm races above invoke the exported canonical `confirmSalesDelivery()` handler, not a capacity-only stub or manual status update. Each has independent MySQL sessions and the existing lock-wait observation. Existing capacity-only tests remain classified as capacity serialization.

## Browser and gate artifacts

`browser-acceptance.json` contains the 24 route/width measurements (quotation, order, change, notice, delivery and OQC at 320/390/430/680), navigation assertions, and resulting functional IDs/states. `responsive-320.png`, `responsive-390.png`, `responsive-430.png`, `responsive-680.png`, and `functional-final-390.png` are sanitized screenshots. The runner waits for the lazy route to finish loading, then asserts no permanent page overflow, visible controls at least 44 CSS px, no browser errors, direct route/refresh/Back/Forward, and actual UI-triggered mutations. The first loading-shell-only screenshot exposed a false-positive probe and was superseded; the corrected probe then found 30px SO filter controls, fixed in the scoped existing sales-order CSS and rerun successfully. API tests independently enforce permission/negative cases; hiding an action in UI is not treated as authorization.

The test command results and Git/database declaration are recorded in `log/2026-10-16.md`. No production database was connected. The protected MySQL commands operated only on their expressly disposable test database. Credit, Prepayment and Reservation future-Wave capabilities remain deferred and are not counted as PASS. Remaining approval: user review, manual Git operations, and explicit user Acceptance/Freeze decision.

## Formal User Approval & Freeze Decision (2026-10-16)

On 2026-10-16, the project owner explicitly approved the final Acceptance and Freeze of Sales & Customer Batch A (Waves 3–5). The user approval supersedes the earlier `Awaiting User Approval` text above: the implementation has now been formally accepted and the implementation code identified by `41857ce2740163868aef0687a7b0ed4536354fe1` is frozen.

- Accepted Code SHA: `41857ce2740163868aef0687a7b0ed4536354fe1`
- User Approval Date: 2026-10-16
- Final Independent Remote Review: PASS
- Acceptance: PASS
- Freeze: FROZEN
- Scope: Batch A Waves 3–5 only (Sales Quotation, Canonical Sales Order, Controlled Order Change, Delivery Notice, Sales Delivery with DIRECT_ORDER / DELIVERY_NOTICE sources)
- Boundary: future Waves 6–13, Credit, Prepayment, Reservation, Return / Replacement new modes, Service, Consignment and later Sales Reporting remain outside this acceptance and unfrozen.
- Earlier test counts, screenshots, browser JSON, MySQL functional / concurrency results and `git diff --check` results quoted above are the historical evidence at the time of the last staged commit and are not regenerated by this acceptance record.
- The Freeze Record Commit is a documentation-only addition; it does not modify the accepted implementation SHA. Integrating the accepted branch into `master` is a separate Git step (local fast-forward only); it does not constitute a Product Release, Tag, deployment, version change, or Batch B start.
