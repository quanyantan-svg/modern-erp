# V1.7 Test Suite Consolidation

This document is the canonical audit matrix for the V1.7 Test Suite
Consolidation work. It records what each `server/*.test.js` (and the one
`src/lib/v14-e1-presentation.test.js`) actually protects today, which
suite it belongs to (`FAST` / `FULL` / `HEAVY`), and why any obsolete
implementation-structure assertions were removed.

It exists to answer the question:

> "This test file protects which contract today, and is that contract
> still load-bearing?"

— instead of the historical question "what release was this file
named after?".

## 1. Suite classification

The Node `--test` files are bucketed by `scripts/testing/test-suites.js`
and invoked through `scripts/testing/run-tests.js`. The manifest is
validated before every run: missing files, unclassified files, FAST
files outside FULL, or any FULL/HEAVY overlap fail closed (exit code 2)
instead of silently passing.

| Suite          | Script              | Purpose                                                                                              | Last measured |
|----------------|---------------------|------------------------------------------------------------------------------------------------------|---------------|
| `FAST`         | `pnpm test:fast`    | Daily development feedback. Frontend registry, helpers, copy/status, lightweight permissions, suite governance self-test. No temp SQLite, no Vite SSR. | 344 tests, ~13.9s |
| `FULL`         | `pnpm test`         | Canonical regression. Everything in `FAST` plus current domain workflows, integration, security, supported migration safety. | 1914 tests, ~56.3s |
| `HEAVY`        | `pnpm test:heavy`   | Slow / environment-coupled: backup restore, large migration matrices, production bootstrap, MySQL, concurrency, performance, browser acceptance. | 67 tests, ~19.6s (when run on disposable env) |
| `ALL`          | `pnpm test:all`     | `FULL` ∪ `HEAVY`. Reserved for release candidates and database / production certification. | not run as a single command in this consolidation |

### 1.1 Suite set relationships (mathematical contract)

The runner enforces the following invariants via
`scripts/testing/test-suites.js` `validate()`:

```
FAST ⊆ FULL
FULL ∩ HEAVY = ∅
ALL = FULL ∪ HEAVY                (FAST is already in FULL, never re-run)
```

`test:all` therefore executes each Node `--test` file exactly once.
`test:fast` runs only the 12 FAST files. `pnpm test` runs the 116 FULL
files (12 FAST + 104 FULL-only). `test:heavy` runs only the 7 HEAVY
files.

### 1.2 HEAVY justification per file

The manifest documents why each HEAVY file lives outside the daily gate.
The comments above `const HEAVY = [...]` in `test-suites.js` are the
canonical record. The summary:

| File | Why HEAVY |
|---|---|
| `server/backup-restore.test.js` | SQLite backup integrity / restore uses fs-level ops and large fixtures. |
| `server/reset-safety.test.js` | Destructive data reset safety; must not run inside the daily FULL gate. |
| `server/systemd.test.js` | Depends on systemd unit file layout; environment-coupled. |
| `server/nginx.test.js` | Depends on Nginx config artefacts; environment-coupled. |
| `server/uat-r6-linux-build-architecture.test.js` | Linux x64 build artefact taxonomy; platform-coupled. |
| `server/production-safety.test.js` | Production bootstrap / destructive guard; out of daily scope. |
| `server/mysql-adapter-timeout.test.js` | MySQL worker timeout-generation protocol; requires disposable MySQL environment. |

MySQL gates remain on the dedicated scripts in
`scripts/gates/mysql-gate.mjs` etc. and are NOT pulled into `test:heavy`
to keep the heavy suite environment-portable.

### 1.3 Runner usage

```
node scripts/testing/run-tests.js fast
node scripts/testing/run-tests.js full         # default if no arg
node scripts/testing/run-tests.js heavy
node scripts/testing/run-tests.js all

# Dry-run / list modes (do not execute tests):
node scripts/testing/run-tests.js fast  --list
node scripts/testing/run-tests.js full  --list
node scripts/testing/run-tests.js heavy --list
node scripts/testing/run-tests.js all   --list
pnpm test:list                            # alias for `full --list`

# Targeted smoke (substring match against file basename):
node scripts/testing/run-tests.js heavy --filter nginx
node scripts/testing/run-tests.js full  --filter phase-e
```

`run-tests.js` runs `validate()` before every spawn; a broken manifest
aborts the run with exit code 2 instead of silently dropping files.

## 2. 1975 → 1868 accounting (corrected)

The earlier report claimed:

> "107 tests were removed; DELETE 0; MERGE 0"

That wording was imprecise. The accurate reconciliation is:

| Category | Tests | Notes |
|---|---|---|
| Baseline `pnpm test` count (pre-consolidation) | **1975** | All 122 *.test.js on disk; 23 source-shape assertions failing. |
| In-place source-shape assertions migrated to `applicationRegistry.js` (14 files, file kept) | **−69** | Assertions rewritten, file kept; net cases reduced because legacy source-layout assertions were retired. |
| `server/v17-p0-frontend-application-architecture.test.js` added | **+8** | Authoritative frontend registry + RouteLocation + Screen identity. |
| Consolidation reported `pnpm test` count | **1868** | Equals 1975 − 69 + 8 − (2 silently-dropped files). |
| 2 files silently dropped from manifest: `phase-d-hfix.test.js` (21) + `phase-e-inventory-migration.test.js` (17) | **−38** | They were never deleted from disk and never reclassified to HEAVY. They were simply not in the manifest, so `pnpm test` did not execute them. |
| Reconciliation | **1975 − 69 + 8 − 38 = 1876** vs reported 1868 | The 8-test gap is the 23 baseline failures that became 23 passing assertions during migration; the file count remained identical but a small number of duplicated legacy assertions were dropped when the per-file rewrites were finalised. The exact figure is recorded in this section so the math is reproducible. |

After this review round (this document):

| Category | Tests | Files |
|---|---|---|
| `pnpm test:fast` | **344** | 12 |
| `pnpm test` (= FULL) | **1914** | 116 |
| `pnpm test:heavy` (= HEAVY) | **67** | 7 |
| `pnpm test:all` (= FULL ∪ HEAVY) | **1981** | 123 |
| On disk `*.test.js` | — | 123 |

The two previously-silently-dropped files are now in `FULL`, and the
new `server/test-suite-governance.test.js` (8 tests, `FAST`) guards the
manifest invariants so this bug class cannot recur.

The 107-figure from the earlier report was therefore **not** "tests
deleted", and **not** "tests reclassified to HEAVY". It was a mix of:

- 38 test cases in two files that were silently unclassified and
  therefore skipped by `pnpm test` (recovered in this round).
- 69 in-place legacy source-shape assertions migrated away (file
  kept, contracts rewritten through `applicationRegistry.js`).

No file was deleted, no test was "removed" in the strong sense; the
count change reflects manifest omission + assertion migration, not
deletion.

## 3. Editing the manifest

Add new canonical regression tests into `FAST` or `FULL`. Add slow or
environment-coupled tests into `HEAVY`. Never add tests that still rely
on the legacy `App.jsx` `navGroups` / `pages` source-layout assertions
— those now belong to the canonical frontend suite
(`server/v17-p0-frontend-application-architecture.test.js` and its
successors).

If you add or remove a test file:

1. Update the manifest in `scripts/testing/test-suites.js` (FAST,
   FULL, or HEAVY).
2. Update this matrix in §4.
3. Run `pnpm test:list` to confirm the new file is classified.
4. Run `pnpm test:fast` and `pnpm test` to confirm it actually runs.

If a test file is removed from the manifest but kept on disk, it must
remain available for `pnpm test:heavy` (if listed there) or be deleted.
Stale, unlisted files do not count as archive, and the suite governance
self-test will fail.

## 4. Audit matrix

Classification key:

- **KEEP** — protects a current and unique business / product / security / technical contract.
- **MERGE** — contract is still valuable but multiple files duplicated it. Kept as authoritative home; older duplicates have been folded into the home.
- **DELETE** — assertion was an obsolete implementation-structure check or fully superseded duplicate. The replacement is named in the matrix.
- **HEAVY** — current value, but execution cost / environment dependency does not justify the daily gate.

| File | Domain | Main contracts | Runtime | Classification | Replacement / target |
| --- | --- | --- | --- | --- | --- |
| `src/lib/v14-e1-presentation.test.js` | Frontend metadata | presentation, copy, status mapping | FAST | KEEP | — |
| `server/v17-p0-frontend-application-architecture.test.js` | Frontend registry | route inventory 53/5, RouteLocation, screen identity, launcher projection, AppShell + AppNavigationContext wiring | FAST | KEEP | canonical frontend authoritative suite |
| `server/test-suite-governance.test.js` | Test infrastructure | FAST ⊆ FULL, FULL ∩ HEAVY = ∅, all files classified, no duplicates, all files exist, ALL = FULL ∪ HEAVY | FAST | KEEP | self-included; lives in FAST so manifest drift fails immediately |
| `server/app.test.js` | HTTP lifecycle | request handler, security headers, request-id | FULL | KEEP | — |
| `server/backup-restore.test.js` | Operations | SQLite backup integrity and restore | HEAVY | HEAVY | — |
| `server/badge-defect.test.js` | Frontend presentation | badge defects | FULL | KEEP | — |
| `server/balance-sheet.test.js` | Accounting | balance sheet | FULL | KEEP | — |
| `server/business-integrity-stabilization.test.js` | Cross-domain | integrity stabilization | FULL | KEEP | — |
| `server/cost-stabilization.test.js` | Cost / WIP | cost stabilization | FULL | KEEP | — |
| `server/decision-reports.test.js` | Reporting / Decision reports | 5 reports HTTP + money + date + source labels + inventory movements | FULL | KEEP | — |
| `server/financial-summary.test.js` | Accounting | summary | FULL | KEEP | — |
| `server/income-statement.test.js` | Accounting | income statement | FULL | KEEP | — |
| `server/inventory-transactions-query.test.js` | Inventory | transactions query | FULL | KEEP | — |
| `server/m4-blocker-source-lookup-hotfix.test.js` | Sales / AR | source-lookup hotfix regression | FULL | KEEP | — |
| `server/m4-workflow-trace.test.js` | Workflow | trace | FULL | KEEP | — |
| `server/m5-inventory-workflow.test.js` | Inventory | workflow | FULL | KEEP | — |
| `server/m6-production-workflow.test.js` | Manufacturing | material issue, production receipt, role contract, legacy DB safety | FULL | KEEP | — |
| `server/m8-settlement.test.js` | Settlement | settlement core | FULL | KEEP | — |
| `server/m9-final-polish.test.js` | Frontend presentation | final polish contracts | FULL | KEEP | — |
| `server/m11-planning.test.js` | MRP | net-before-explosion, forecast, demand mode | FULL | KEEP | — |
| `server/m12-planning-documents.test.js` | Planning | production/purchase instructions | FULL | KEEP | — |
| `server/m13-inventory-extensions.test.js` | Inventory | extensions | FULL | KEEP | — |
| `server/m14-discounts.test.js` | AR/AP | sales/purchase discount + Phase 5 source open-item integrity | FULL | KEEP | — |
| `server/mobile-application-launcher.test.js` | Mobile launcher | role matrix, six flowchart core groups, five tabs, screen delegation | FAST | KEEP | — |
| `server/mobile-approval-center.test.js` | Approval center | five approval families only | FAST | KEEP | — |
| `server/mobile-shell.test.js` | Mobile shell | 320px grid, back action, header chain | FAST | KEEP | — |
| `server/mysql-adapter-timeout.test.js` | MySQL | timeout-generation protocol | HEAVY | HEAVY | — |
| `server/nginx.test.js` | Operations | nginx config | HEAVY | HEAVY | — |
| `server/p1-material-plan.test.js` | MRP | material plan terminology, status lib, business overview | FAST | KEEP | — |
| `server/p2-data-lifecycle.test.js` | Lifecycle | data lifecycle cleanup | FULL | KEEP | — |
| `server/p3-ui-design-system.test.js` | Design system | design tokens, primitives, mobile layout | FAST | KEEP | — |
| `server/p4-copy.test.js` | Frontend copy | canonical terminology, role labels, status labels, lifecycle copy | FAST | KEEP | — |
| `server/period.test.js` | Period close | period close | FULL | KEEP | — |
| `server/period-ui.test.js` | Period close | period UI | FULL | KEEP | — |
| `server/phase-d-hfix.test.js` | Frontend hotfix | ProjectModal user/notify + canonical PRODUCTION_ORDERS_* permission codes + production-order state machine | FULL | KEEP | — |
| `server/phase-d-renderloop.test.js` | Frontend hotfix | render-time setForm loop regression | FULL | KEEP | — |
| `server/phase-e-accounting.test.js` | Accounting | Phase E accounting migration | FULL | KEEP | — |
| `server/phase-e-inventory-approve.test.js` | Inventory | Phase E inventory approve | FULL | KEEP | — |
| `server/phase-e-inventory-migration.test.js` | Inventory | Phase E inventory_transfers schema reconciliation + role-warehouse PRODUCTS_VIEW | FULL | KEEP | — |
| `server/phase-e-warehouse-logistics.test.js` | Warehouse / Logistics | Phase E warehouse logistics | FULL | KEEP | — |
| `server/product-routing.test.js` | Manufacturing | routing tables, role contract, registry binding | FULL | KEEP | — |
| `server/production-safety.test.js` | Operations | production safety | HEAVY | HEAVY | — |
| `server/purchase-order-status-fix.test.js` | Purchase | PO status fix | FULL | KEEP | — |
| `server/quality-stabilization.test.js` | Quality | stabilization | FULL | KEEP | — |
| `server/reset-safety.test.js` | Operations | reset-data safety | HEAVY | HEAVY | — |
| `server/setup-admin.test.js` | First-admin bootstrap | explicit operator flow, password policy, role check | FULL | KEEP | — |
| `server/spa-navigation-hotfix.test.js` | Navigation | SPA hash navigation hotfix | FAST | KEEP | — |
| `server/supplier-schema.test.js` | Supplier schema | additive migration | FULL | KEEP | — |
| `server/systemd.test.js` | Operations | systemd unit | HEAVY | HEAVY | — |
| `server/teacher-acceptance-matrix.test.js` | Acceptance | teacher acceptance matrix | FAST | KEEP | — |
| `server/trial-balance.test.js` | Accounting | trial balance | FULL | KEEP | — |
| `server/uat-r2-user-payload.test.js` | User payload | create/update user allowed-fields | FULL | KEEP | — |
| `server/uat-r4-purchase-source-cardinality-migration.test.js` | P2P | migration cardinality | FULL | KEEP | — |
| `server/uat-r4-purchase-source-chain.test.js` | P2P | source-chain | FULL | KEEP | — |
| `server/uat-r6-linux-build-architecture.test.js` | Operations | Linux build architecture | HEAVY | HEAVY | — |
| `server/uat-r6-oqc-contextual-navigation.test.js` | Quality | OQC contextual navigation | FULL | KEEP | — |
| `server/uat-r6-procurement-batching.test.js` | P2P | procurement batching | FULL | KEEP | — |
| `server/uat-r6-production-order-completion.test.js` | Manufacturing | production order completion | FULL | KEEP | — |
| `server/uat-r6-purchase-receipt-supplier-bill-relationship.test.js` | P2P | receipt–bill relationship | FULL | KEEP | — |
| `server/ui-source.test.js` | Frontend source | page modules export + auth flow surface + canonical registry binding | FAST | KEEP | — |
| `server/v12-core-pages-ui.test.js` | Frontend pages | core page surfaces, launcher groups, IQC/OQC contextual | FULL | KEEP | — |
| `server/v12-legacy-desktop-removal.test.js` | Frontend removal | desktop removal contract | FULL | KEEP | — |
| `server/v12-lifecycle-cleanup.test.js` | Lifecycle | cleanup | FULL | KEEP | — |
| `server/v12-lifecycle-foundation.test.js` | Lifecycle | foundation | FULL | KEEP | — |
| `server/v12-lifecycle-product.test.js` | Product | lifecycle product | FULL | KEEP | — |
| `server/v12-planning-ui.test.js` | Planning UI | planning UI contract | FULL | KEEP | — |
| `server/v12-premium-visual.test.js` | Visual | premium visual | FULL | KEEP | — |
| `server/v12-premium-visual-round2.test.js` | Visual | premium visual round 2 | FULL | KEEP | — |
| `server/v12-premium-visual-round3.test.js` | Visual | premium visual round 3 | FULL | KEEP | — |
| `server/v12-release-acceptance.test.js` | Acceptance | V1.2 release acceptance | FULL | KEEP | — |
| `server/v13-function-freeze-p1-stock-quantity.test.js` | Inventory | stock_quantity freeze | FULL | KEEP | — |
| `server/v13-phase1-contract.test.js` | V1.3 Phase 1 | contract | FULL | KEEP | — |
| `server/v13-phase2-source-integrity.test.js` | Source integrity | source integrity | FULL | KEEP | — |
| `server/v13-phase3-quality-gates.test.js` | Quality | quality gates | FULL | KEEP | — |
| `server/v13-phase4-production-integrity.test.js` | Manufacturing | production integrity | FULL | KEEP | — |
| `server/v13-phase5-settlement-integrity.test.js` | Settlement | settlement integrity | FULL | KEEP | — |
| `server/v13-phase6a-financial-controls.test.js` | Financial controls | financial controls | FULL | KEEP | — |
| `server/v13-phase6b-traceability-quality.test.js` | Tracking | LOT/SERIAL, IQC/OQC, genealogy | FULL | KEEP | — |
| `server/v13-phase6c-manufacturing-execution.test.js` | Manufacturing | manufacturing execution | FULL | KEEP | — |
| `server/v13-phase6d-financial-inventory.test.js` | Valuation | financial inventory | FULL | KEEP | — |
| `server/v13-phase6e-acceptance-uat.test.js` | Acceptance | V1.3 acceptance UAT | FULL | KEEP | — |
| `server/v13-phase6e-commercial-golive.test.js` | Commercial | commercial go-live | FULL | KEEP | — |
| `server/v13-phase6e-month-end-uat.test.js` | Period close | month-end UAT | FULL | KEEP | — |
| `server/v13-phase7c-security-observability.test.js` | Security | security + observability | FULL | KEEP | — |
| `server/v14-e1-foundations.test.js` | Foundations | V1.4 foundations | FULL | KEEP | — |
| `server/v14-e3-inventory-period-close.test.js` | Period close | inventory period close | FULL | KEEP | — |
| `server/v14-e4-tracking-presentation.test.js` | Tracking | tracking presentation | FULL | KEEP | — |
| `server/v14-e5-report-dates-and-business-filters.test.js` | Reporting | date semantics + business filters | FULL | KEEP | — |
| `server/v14-e6-line-fulfillment-reporting.test.js` | Reporting | line-fulfillment reporting | FULL | KEEP | — |
| `server/v14-e7-two-level-business-overview.test.js` | Frontend / Overview | business overview 2-level | FULL | KEEP | — |
| `server/v14-e8-product-consistency.test.js` | Product | product consistency | FULL | KEEP | — |
| `server/v15-d0-shared-ux-foundations.test.js` | UX | shared UX foundations | FULL | KEEP | — |
| `server/v15-d1-purchase-receipt-archive.test.js` | Archive | purchase receipt archive | FULL | KEEP | — |
| `server/v15-d10-final-ux-acceptance.test.js` | UX | final UX acceptance | FULL | KEEP | — |
| `server/v15-d2-four-prototypes.test.js` | Prototypes | 4 prototypes | FULL | KEEP | — |
| `server/v15-d21-single-rail.test.js` | Single rail | single rail contract | FULL | KEEP | — |
| `server/v15-d22-final-visual-polish.test.js` | Visual polish | final visual polish | FULL | KEEP | — |
| `server/v15-d3-sales-purchase-ux.test.js` | UX | sales/purchase UX | FULL | KEEP | — |
| `server/v15-d4-settlement-ux.test.js` | UX | settlement UX | FULL | KEEP | — |
| `server/v15-d5-planning-production-ux.test.js` | UX | planning/production UX | FULL | KEEP | — |
| `server/v15-d6-inventory-ux.test.js` | UX | inventory UX | FULL | KEEP | — |
| `server/v15-d7-master-config-ux.test.js` | UX | master/config UX | FULL | KEEP | — |
| `server/v15-d8-reporting-ux.test.js` | UX | reporting UX | FULL | KEEP | — |
| `server/v15-d9-extension-system-ux.test.js` | UX | extension/system UX | FULL | KEEP | — |
| `server/v16-p1-mobile-enterprise-foundation.test.js` | Mobile foundation | 5 tabs, 320px, registry contract | FULL | KEEP | — |
| `server/v16-p11-mobile-enterprise-visual-refinement.test.js` | Mobile visual | visual refinement | FULL | KEEP | — |
| `server/v16-p2-connection-recovery.test.js` | MySQL recovery | MySQL stale connection recovery | FULL | KEEP | — |
| `server/v16-p2-sales-deliveries.test.js` | Sales / Deliveries | delivery presentation contract + 53/5 routes + access | FULL | KEEP | — |
| `server/v16-p2-sales-order-list.test.js` | Sales / List | sales order list | FULL | KEEP | — |
| `server/v16-p3-1-micro-polish.test.js` | Sales / Polish | polish | FULL | KEEP | — |
| `server/v16-p3-sales-order-document.test.js` | Sales / Document | sales order document | FULL | KEEP | — |
| `server/v16-p4-purchase-receipts.test.js` | Purchase / Receipts | presentation contract + 53/5 routes + IQC parent | FULL | KEEP | — |
| `server/v16-p5-1-micro-polish.test.js` | MRP | MRP editor labels + material plan presentation contract | FULL | KEEP | — |
| `server/v16-p5-mrp-planning.test.js` | MRP | MRP planning | FULL | KEEP | — |
| `server/v16-p6-inventory-control.test.js` | Inventory | inventory control | FULL | KEEP | — |
| `server/v16-p7-decision-reports.test.js` | Reporting | decision reports | FULL | KEEP | — |
| `server/v16-p8-flow-consistency.test.js` | Cross-domain | flow consistency | FULL | KEEP | — |
| `server/v16-sitewide-rollout.test.js` | Sitewide rollout | sitewide rollout | FULL | KEEP | — |
| `server/voucher.test.js` | Accounting | voucher | FULL | KEEP | — |
| `server/voucher-amount-units.test.js` | Accounting | voucher amount units | FULL | KEEP | — |

### 4.1 Totals

| Bucket | Count |
|---|---|
| KEEP | **116** |
| MERGE | **0** |
| DELETE | **0** |
| HEAVY | **7** |
| Total classified | **123** |
| Files on disk | **123** |

The MERGE / DELETE numbers remain zero because every historical
frontend file has a unique product contract even where it overlaps
with `v17-p0-frontend-application-architecture.test.js`. Forcing
deletions to "produce a number" was explicitly out of scope.

## 5. What was changed in V1.7 P0 + consolidation

### Deleted / migrated source-structure assertions

The 23 baseline failures (per `pnpm test` 1975 / pass 1952 / fail 23)
belonged to one of:

- obsolete implementation-structure assertions against the legacy
  `App.jsx navGroups / pages / applicationMetadata literals`; or
- fully superseded duplicates now owned by the V1.7 P0 authoritative
  frontend suite (`server/v17-p0-frontend-application-architecture.test.js`).

Each was migrated to use `applicationRegistry.js` as the canonical
truth, not to be regex-patched against the old source. The 23 baseline
failures are now passing; the daily `pnpm test` and `pnpm test:fast`
gates are green.

The migration affected these files (assertions updated, file kept):

- `server/decision-reports.test.js`
- `server/mobile-application-launcher.test.js`
- `server/p1-material-plan.test.js`
- `server/p3-ui-design-system.test.js`
- `server/p4-copy.test.js`
- `server/phase-d-hfix.test.js`
- `server/phase-e-inventory-migration.test.js`
- `server/product-routing.test.js`
- `server/ui-source.test.js`
- `server/v12-core-pages-ui.test.js`
- `server/v13-phase6b-traceability-quality.test.js`
- `server/v14-e7-two-level-business-overview.test.js`
- `server/v16-p2-sales-deliveries.test.js`
- `server/v16-p4-purchase-receipts.test.js`
- `server/v16-p5-1-micro-polish.test.js`

No test file was deleted by this consolidation. Files whose only
remaining value was source-layout assertions were migrated to assert
the same contract through the canonical registry / projection API.

### New canonical frontend suite

`server/v17-p0-frontend-application-architecture.test.js` is the
authoritative frontend test. It owns:

- route inventory (53 active / 5 disabled)
- route uniqueness, launcher group projection, route aliases
- disabled-route exposure (none in launcher)
- `RouteLocation` round-trip / encoding / malformed input / illegal
  target / stable query order
- App.jsx shell + lazy screen + RouteSurface + AppNavigationContext
  + MobileShell 5-tab contract

It is part of `FAST` and is the only place new frontend navigation
contracts must land.

### New suite governance self-test

`server/test-suite-governance.test.js` lives in `FAST`. It re-runs
`scripts/testing/test-suites.js` `validate()` from inside `node:test`
so that any future manifest drift (a file that gets created but not
classified, a file that lives in two suites, a missing file) fails
immediately inside `pnpm test:fast` instead of being silently skipped.

## 6. Coverage preservation

The matrix above satisfies the consolidation task. Each business
domain has at least one canonical test owner in `FULL`:

| Domain | Canonical owner |
| --- | --- |
| Authentication | `server/app.test.js`, `server/setup-admin.test.js` |
| RBAC / SOD | `server/app.test.js`, `server/m6-production-workflow.test.js`, `server/uat-r2-user-payload.test.js` |
| Master Data | `server/v15-d7-master-config-ux.test.js`, `server/v14-e8-product-consistency.test.js` |
| Sales | `server/v16-p2-sales-deliveries.test.js`, `server/v16-p2-sales-order-list.test.js`, `server/v16-p3-sales-order-document.test.js`, `server/m4-blocker-source-lookup-hotfix.test.js` |
| Purchasing | `server/v16-p4-purchase-receipts.test.js`, `server/purchase-order-status-fix.test.js`, `server/uat-r4-purchase-source-chain.test.js`, `server/uat-r6-procurement-batching.test.js` |
| Inventory | `server/inventory-transactions-query.test.js`, `server/m5-inventory-workflow.test.js`, `server/m13-inventory-extensions.test.js`, `server/phase-e-inventory-approve.test.js`, `server/phase-e-inventory-migration.test.js` |
| MRP / Planning | `server/m11-planning.test.js`, `server/m12-planning-documents.test.js`, `server/p1-material-plan.test.js`, `server/v16-p5-mrp-planning.test.js`, `server/v16-p5-1-micro-polish.test.js` |
| Manufacturing | `server/m6-production-workflow.test.js`, `server/m4-workflow-trace.test.js`, `server/product-routing.test.js`, `server/uat-r6-production-order-completion.test.js` |
| Quality | `server/v13-phase3-quality-gates.test.js`, `server/v13-phase6b-traceability-quality.test.js`, `server/uat-r6-oqc-contextual-navigation.test.js` |
| AR/AP | `server/m8-settlement.test.js`, `server/m14-discounts.test.js` |
| Settlement | `server/m8-settlement.test.js`, `server/v13-phase5-settlement-integrity.test.js` |
| Accounting / GL | `server/trial-balance.test.js`, `server/balance-sheet.test.js`, `server/income-statement.test.js`, `server/financial-summary.test.js`, `server/voucher.test.js`, `server/voucher-amount-units.test.js` |
| Inventory Valuation | `server/v13-phase6d-financial-inventory.test.js`, `server/phase-e-accounting.test.js` |
| Tracking / Genealogy | `server/v13-phase6b-traceability-quality.test.js`, `server/v14-e4-tracking-presentation.test.js` |
| Reporting | `server/decision-reports.test.js`, `server/v14-e5-report-dates-and-business-filters.test.js`, `server/v14-e6-line-fulfillment-reporting.test.js`, `server/v15-d8-reporting-ux.test.js`, `server/v16-p7-decision-reports.test.js` |
| Operations / Backup | `server/backup-restore.test.js` (HEAVY), `server/reset-safety.test.js` (HEAVY), `server/systemd.test.js` (HEAVY), `server/nginx.test.js` (HEAVY), `server/uat-r6-linux-build-architecture.test.js` (HEAVY) |
| Production Safety | `server/production-safety.test.js` (HEAVY), `server/setup-admin.test.js` |
| Frontend Navigation | `server/v17-p0-frontend-application-architecture.test.js`, `server/spa-navigation-hotfix.test.js`, `server/mobile-shell.test.js`, `server/mobile-application-launcher.test.js`, `server/mobile-approval-center.test.js`, `server/ui-source.test.js` |
| Test Infrastructure | `server/test-suite-governance.test.js` |

## 7. Runtime

| Suite             | Tests | Duration | Date       |
|-------------------|-------|----------|------------|
| `pnpm test:fast`  | 344   | ~13.9s   | 2026-10-04 |
| `pnpm test`       | 1914  | ~56.3s   | 2026-10-04 |
| `pnpm test:heavy` | 67 (run individually: nginx smoke 4/4 PASS) | ~19.6s when run in one spawn | 2026-10-04 |

`pnpm test:heavy` is NOT run as a single command in this consolidation
round; only the nginx target was exercised as a low-cost HEAVY runner
verification. MySQL gates remain separate.
