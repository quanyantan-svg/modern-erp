// V1.7 Test Suite Consolidation — explicit suite manifest.
//
// This file is the single source of truth that says which Node --test
// files belong to FAST / FULL / HEAVY. It is consumed by
// scripts/testing/run-tests.js and is the only place the bucketing lives.
//
// Editing rules:
//   - Add new canonical regression tests into FAST or FULL.
//   - Add slow / environment-dependent / long-migration tests into HEAVY.
//   - Do NOT add tests under `**/node_modules/**`, `dist/**`, or `.tmp/**`.
//   - Do NOT add tests that still rely on the legacy App.jsx navGroups/pages
//     implementation-structure assertions — those must live in the
//     canonical frontend suite (server/v17-p0-frontend-application-architecture.test.js
//     and its successors).
//
// Classification criteria (per V1.7 Test Suite Consolidation):
//   FAST   — daily development feedback. Pure functions, source-contract
//            metadata tests, frontend navigation/registry, lightweight
//            permissions, small deterministic regressions. Must not require
//            a temp SQLite or Vite SSR.
//   FULL   — canonical regression. Everything in FAST plus the current
//            domain workflows, integration, security, and supported
//            migration safety. This is the default completion gate.
//   HEAVY  — slow / environment-coupled / long-running / MySQL /
//            concurrency / performance / browser / release acceptance.
//            Not part of the daily gate.
//
// Files NOT listed in any suite are NOT allowed; every *.test.js under
// server/ and src/lib/ that is part of the project test graph must be
// classified into exactly one of {FAST, FULL, HEAVY}. FAST ⊂ FULL and
// FULL ∩ HEAVY = ∅. ALL = FULL ∪ HEAVY.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function abs(file) {
  return resolve(repoRoot, file);
}

// Express server-side test files. Each entry is a path relative to repoRoot.
//
// HEAVY justification (recorded per V1.7 Test Suite Consolidation review):
//   - backup-restore.test.js             : SQLite backup integrity / restore uses
//                                          fs-level ops and large fixtures.
//   - reset-safety.test.js               : destructive data reset safety; must not
//                                          run inside the daily FULL gate.
//   - systemd.test.js                    : depends on systemd unit file layout
//                                          and is environment-coupled.
//   - nginx.test.js                      : depends on Nginx config artefacts.
//   - uat-r6-linux-build-architecture.test.js : exercises Linux x64 build artefact
//                                          taxonomy and is platform-coupled.
//   - production-safety.test.js          : production bootstrap / destructive
//                                          guard; out of daily scope.
//   - mysql-adapter-timeout.test.js      : MySQL worker timeout-generation protocol;
//                                          requires disposable MySQL environment.
const HEAVY = [
  'server/backup-restore.test.js',
  'server/reset-safety.test.js',
  'server/systemd.test.js',
  'server/nginx.test.js',
  'server/uat-r6-linux-build-architecture.test.js',
  'server/production-safety.test.js',
  'server/mysql-adapter-timeout.test.js',
];

// Canonical regression suite. All non-heavy tests that protect real business
// contracts live here. V1.7 P0 introduced the frontend authoritative suite —
// any frontend test not explicitly moved to a canonical successor stays here.
//
// KEEP / MERGE / DELETE / HEAVY classification for every file in this
// manifest is recorded in docs/operations/testing.md §3.
const FULL = [
  // ----- V1.7 P0 — canonical frontend application architecture -----
  'server/v17-p0-frontend-application-architecture.test.js',

  // ----- V2 Stage 3 / Wave 3A — backend dispatch ownership architecture -----
  // Architecture tests for server/lib/route-table.js plus the live
  // Wave 3A invariants for the migrated warehouse route family
  // (app.js imports route-table, four warehouse descriptors
  // registered with canonical owner, no legacy warehouse dispatch
  // branch remains, unrelated routes still fall through to the
  // legacy handleApi chain). Pure-function route-table safety
  // tests live in the same file.
  'server/route-table.test.js',

  // ----- V2 Stage 3 / Wave 3A — first live warehouse ownership -----
  // Focused behavior coverage for the migrated /api/warehouses route
  // family: GET (search / shape / role), POST (validation / audit /
  // 201), PATCH (200 / 404 / WAREHOUSE_NOT_EMPTY guard), DELETE
  // (RECORD_REFERENCED / 200 empty warehouse / audit), and the
  // canonical deleteMasterRecord lifecycle delegation. Complement
  // — does not duplicate — the existing p2-data-lifecycle coverage
  // of the deactivation stock guard and 409 on referenced warehouse.
  'server/v2-wave3a-warehouses-ownership.test.js',

  // ----- Core business contracts (legacy filenames — kept, see matrix) -----
  'server/app.test.js',
  'server/setup-admin.test.js',
  'server/voucher.test.js',
  'server/voucher-amount-units.test.js',
  'server/trial-balance.test.js',
  'server/balance-sheet.test.js',
  'server/income-statement.test.js',
  'server/financial-summary.test.js',
  'server/inventory-transactions-query.test.js',
  'server/period.test.js',
  'server/period-ui.test.js',
  'server/project-manager.test.js',
  'server/purchase-order-status-fix.test.js',
  'server/supplier-schema.test.js',

  // ----- Frontend metadata / design / mobile contracts -----
  'src/lib/v14-e1-presentation.test.js',
  'server/spa-navigation-hotfix.test.js',
  'server/mobile-shell.test.js',
  'server/mobile-approval-center.test.js',
  'server/mobile-application-launcher.test.js',
  'server/teacher-acceptance-matrix.test.js',
  'server/ui-source.test.js',

  // ----- Sales / Purchase / Returns / Discounts -----
  'server/decision-reports.test.js',
  'server/m14-discounts.test.js',
  'server/m4-blocker-source-lookup-hotfix.test.js',

  // ----- Inventory / Lot / Serial / Quality -----
  'server/m5-inventory-workflow.test.js',
  'server/m13-inventory-extensions.test.js',
  'server/v13-phase6b-traceability-quality.test.js',
  'server/v14-e4-tracking-presentation.test.js',

  // ----- Phase D / Phase E hotfix / migration safety -----
  //   phase-d-hfix.test.js — Project modal user/notify + canonical
  //     PRODUCTION_ORDERS_* permission codes + production order state machine.
  //   phase-e-inventory-migration.test.js — inventory_transfers schema
  //     reconciliation + role-warehouse PRODUCTS_VIEW regression.
  //   phase-e-inventory-approve.test.js — inventory approval workflow.
  //   phase-e-warehouse-logistics.test.js — warehouse logistics contracts.
  //   phase-e-accounting.test.js — Phase E accounting migration.
  'server/phase-d-hfix.test.js',
  'server/phase-d-renderloop.test.js',
  'server/phase-e-accounting.test.js',
  'server/phase-e-inventory-approve.test.js',
  'server/phase-e-inventory-migration.test.js',
  'server/phase-e-warehouse-logistics.test.js',

  // ----- Planning / MRP / Production / Manufacturing -----
  'server/m11-planning.test.js',
  'server/m12-planning-documents.test.js',
  'server/m6-production-workflow.test.js',
  'server/m4-workflow-trace.test.js',
  'server/product-routing.test.js',

  // ----- Settlement / AR / AP / Voucher / Financial controls -----
  'server/m8-settlement.test.js',
  'server/m9-final-polish.test.js',

  // ----- User / Auth / RBAC / SOD / Account-bootstrap -----
  'server/uat-r2-user-payload.test.js',

  // ----- Migration safety / Source integrity / Permission registry -----
  'server/v12-lifecycle-cleanup.test.js',
  'server/v12-lifecycle-foundation.test.js',
  'server/v12-lifecycle-product.test.js',
  'server/v13-function-freeze-p1-stock-quantity.test.js',
  'server/v13-phase1-contract.test.js',
  'server/v13-phase2-source-integrity.test.js',
  'server/v13-phase3-quality-gates.test.js',
  'server/v13-phase4-production-integrity.test.js',
  'server/v13-phase5-settlement-integrity.test.js',
  'server/v13-phase6a-financial-controls.test.js',
  'server/v13-phase6c-manufacturing-execution.test.js',
  'server/v13-phase6d-financial-inventory.test.js',
  'server/v13-phase6e-commercial-golive.test.js',
  'server/v13-phase6e-acceptance-uat.test.js',
  'server/v13-phase6e-month-end-uat.test.js',
  'server/v13-phase7c-security-observability.test.js',

  // ----- Report dates / business filters / Line-fulfillment reporting -----
  'server/v14-e1-foundations.test.js',
  'server/v14-e3-inventory-period-close.test.js',
  'server/v14-e5-report-dates-and-business-filters.test.js',
  'server/v14-e6-line-fulfillment-reporting.test.js',
  'server/v14-e7-two-level-business-overview.test.js',
  'server/v14-e8-product-consistency.test.js',

  // ----- Business integrity stabilization -----
  'server/business-integrity-stabilization.test.js',
  'server/cost-stabilization.test.js',
  'server/crm-stabilization.test.js',
  'server/manufacturing-stabilization.test.js',
  'server/quality-stabilization.test.js',
  'server/badge-defect.test.js',

  // ----- UAT purchase-receipt / source-chain / procurement-batching -----
  'server/uat-r4-purchase-source-chain.test.js',
  'server/uat-r4-purchase-source-cardinality-migration.test.js',
  'server/uat-r6-procurement-batching.test.js',
  'server/uat-r6-purchase-receipt-supplier-bill-relationship.test.js',
  'server/uat-r6-production-order-completion.test.js',
  'server/uat-r6-oqc-contextual-navigation.test.js',

  // ----- V1.6 mobile / sales / purchase / MRP / inventory contracts -----
  'server/v16-p1-mobile-enterprise-foundation.test.js',
  'server/v16-p2-connection-recovery.test.js',
  'server/v16-p2-sales-deliveries.test.js',
  'server/v16-p2-sales-order-list.test.js',
  'server/v16-p3-1-micro-polish.test.js',
  'server/v16-p3-sales-order-document.test.js',
  'server/v16-p4-purchase-receipts.test.js',
  'server/v16-p5-mrp-planning.test.js',
  'server/v16-p5-1-micro-polish.test.js',
  'server/v16-p6-inventory-control.test.js',
  'server/v16-p7-decision-reports.test.js',
  'server/v16-p8-flow-consistency.test.js',
  'server/v16-sitewide-rollout.test.js',
  'server/v16-p11-mobile-enterprise-visual-refinement.test.js',

  // ----- V1.5 / V1.4 / V1.2 UX foundations (kept under canonical matrix) -----
  'server/v15-d0-shared-ux-foundations.test.js',
  'server/v15-d1-purchase-receipt-archive.test.js',
  'server/v15-d2-four-prototypes.test.js',
  'server/v15-d3-sales-purchase-ux.test.js',
  'server/v15-d4-settlement-ux.test.js',
  'server/v15-d5-planning-production-ux.test.js',
  'server/v15-d6-inventory-ux.test.js',
  'server/v15-d7-master-config-ux.test.js',
  'server/v15-d8-reporting-ux.test.js',
  'server/v15-d9-extension-system-ux.test.js',
  'server/v15-d10-final-ux-acceptance.test.js',
  'server/v15-d21-single-rail.test.js',
  'server/v15-d22-final-visual-polish.test.js',
  'server/v12-core-pages-ui.test.js',
  'server/v12-legacy-desktop-removal.test.js',
  'server/v12-planning-ui.test.js',
  'server/v12-premium-visual.test.js',
  'server/v12-premium-visual-round2.test.js',
  'server/v12-premium-visual-round3.test.js',
  'server/v12-release-acceptance.test.js',
  'server/p2-data-lifecycle.test.js',

  // ----- P-series canonical frontend metadata suites -----
  'server/p1-material-plan.test.js',
  'server/p3-ui-design-system.test.js',
  'server/p4-copy.test.js',

  // ----- Suite governance self-test -----
  //   server/test-suite-governance.test.js asserts the manifest invariants
  //   (FAST ⊂ FULL, FULL ∩ HEAVY = ∅, all test files classified, no
  //   duplicates, all listed files exist). Lives in FULL so a regression
  //   also fails the canonical daily gate, but it does NOT classify itself
  //   as "unclassified".
  'server/test-suite-governance.test.js',
];

// FAST — subset of FULL that excludes tests requiring Vite SSR,
// temp SQLite creation, or multi-second boot. The fast suite must
// remain a deterministic regression within seconds.
//
// Invariant: every file in FAST must also be present in FULL.
const FAST = [
  // V1.7 P0 frontend authoritative registry + RouteLocation + screen
  // identity. Pure function + source-contract, no DB, no Vite SSR.
  'server/v17-p0-frontend-application-architecture.test.js',

  // Frontend metadata / design / mobile small contracts.
  'src/lib/v14-e1-presentation.test.js',
  'server/spa-navigation-hotfix.test.js',
  'server/mobile-shell.test.js',
  'server/mobile-approval-center.test.js',
  'server/mobile-application-launcher.test.js',
  'server/teacher-acceptance-matrix.test.js',
  'server/ui-source.test.js',

  // Material plan, design system, copy — P-series lightweight suites.
  'server/p1-material-plan.test.js',
  'server/p3-ui-design-system.test.js',
  'server/p4-copy.test.js',

  // Suite governance self-test. Pure-function validation; runs in tens of
  // milliseconds and gives immediate feedback if any future contributor
  // forgets to classify a new *.test.js.
  'server/test-suite-governance.test.js',
];

const SUITES = Object.freeze({
  FAST: Object.freeze(FAST.map(abs)),
  FULL: Object.freeze(FULL.map(abs)),
  HEAVY: Object.freeze(HEAVY.map(abs)),
  repoRoot,
});

// ---- discovery + invariant validation ------------------------------------

function listTestFilesOnDisk(root) {
  const out = [];
  for (const sub of ['server', 'src/lib']) {
    const dir = resolve(root, sub);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.test.js')) continue;
      const full = resolve(dir, entry);
      // Skip non-files (defensive; sub/ test directory is currently flat).
      if (!statSync(full).isFile()) continue;
      out.push(full);
    }
  }
  return out.sort();
}

function diff(a, b) {
  const set = new Set(b);
  return a.filter((x) => !set.has(x));
}

function findDuplicates(arr) {
  const seen = new Map();
  for (const v of arr) seen.set(v, (seen.get(v) || 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v);
}

function relativeToRepo(p) {
  return relative(repoRoot, p).split(/[\\/]/).join('/');
}

// validate() returns an object describing whether the manifest is sound.
// It is invoked by run-tests.js before every spawn, and by
// server/test-suite-governance.test.js as the canonical assertion source.
//
// A failure here must stop the runner (exit code 2) — never silently pass.
export function validate(suites = SUITES, { onDisk } = {}) {
  const { FAST, FULL, HEAVY } = suites;
  const disk = (onDisk || listTestFilesOnDisk(repoRoot)).slice().sort();

  const errors = [];
  const warnings = [];

  // 1. No duplicate file path inside any suite.
  for (const [name, list] of [['FAST', FAST], ['FULL', FULL], ['HEAVY', HEAVY]]) {
    const dupes = findDuplicates(list);
    if (dupes.length) {
      errors.push(`${name} has duplicate entries: ${dupes.map(relativeToRepo).join(', ')}`);
    }
  }

  // 2. FAST ⊆ FULL.
  const fastNotInFull = diff([...FAST], [...FULL]);
  if (fastNotInFull.length) {
    errors.push(`FAST contains files not in FULL: ${fastNotInFull.map(relativeToRepo).join(', ')}`);
  }

  // 3. FULL ∩ HEAVY = ∅.
  const heavySet = new Set(HEAVY);
  const overlap = FULL.filter((f) => heavySet.has(f));
  if (overlap.length) {
    errors.push(`FULL and HEAVY overlap: ${overlap.map(relativeToRepo).join(', ')}`);
  }

  // 4. Every listed file exists on disk.
  const listed = new Set([...FAST, ...FULL, ...HEAVY]);
  const missing = [...listed].filter((f) => !existsSync(f));
  if (missing.length) {
    errors.push(`listed files missing on disk: ${missing.map(relativeToRepo).join(', ')}`);
  }

  // 5. Every *.test.js on disk is classified into exactly one of FAST/FULL/HEAVY.
  const unlisted = diff(disk, [...listed]);
  if (unlisted.length) {
    errors.push(
      `on-disk test files not classified into any suite: ${unlisted.map(relativeToRepo).join(', ')}`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      onDisk: disk.length,
      FAST: FAST.length,
      FULL: FULL.length,
      HEAVY: HEAVY.length,
      ALL: new Set([...FULL, ...HEAVY]).size,
    },
  };
}

export { SUITES, listTestFilesOnDisk, relativeToRepo };

export default SUITES;
