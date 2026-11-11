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
  // ----- Sales & Customer Domain — Wave 0 migration infrastructure -----
  // Canonical zero-step registry, deterministic runner, fail-closed errors,
  // SQLite fresh/reopen wiring, and zero future Sales business schema.
  'server/sales-customer-wave0-migration-runner.test.js',
  'server/sales-customer-wave1-foundation.test.js',
  'server/sales-customer-wave2-pricing.test.js',
  'server/sales-customer-wave2-mysql-migration.test.js',
  'server/sales-customer-wave6-migration.test.js',
  'server/sales-customer-wave6-functional.test.js',
  'server/sales-customer-wave6-final-functional.test.js',
  'server/sales-customer-wave6-bounded-superseding.test.js',
  'server/sales-customer-wave7-migration.test.js',
  'server/sales-gate-retry-admission.test.js',
  'server/mysql-disposable-target-guard.test.js',
  'server/mysql-out001-gate-infrastructure.test.js',
  // OUT-001 M3 — uncertain-COMMIT offline regression (COMMIT-withholding
  // proxy, transaction disposition, WIP transfer handler disposition). It
  // owns a temp SQLite for the handler case, so it is not FAST.
  'server/mysql-out001-m3-uncertain-commit.test.js',
  'scripts/mysql-sales-wave7-gate-a-runner.test.js',
  'scripts/mysql-sales-wave10-runners.test.js',
  // Transaction Lifecycle Safety — pure fault injection, no real MySQL.
  // The real-session fixture (server/mysql-transaction-start-safety.integration.js)
  // is registered only through the protected Gate A runner, never here.
  'server/db-transaction-start-safety.test.js',
  'server/sales-customer-wave7-functional.test.js',
  'server/sales-customer-wave7-acceptance.test.js',
  'server/sales-customer-wave8-functional.test.js',
  'server/sales-customer-wave8-remediation.test.js',
  'server/sales-customer-wave8-mysql-metadata.test.js',
  'server/sales-customer-wave8-mixed-delivery.test.js',
  'server/sales-customer-wave8-residual.test.js',
  'server/sales-customer-wave9-credit-foundation.test.js',
  'server/sales-customer-wave10-credit-check.test.js',
  // Wave 11 W11-SEC-01 — Credit Read Scope remediation (document.md §4 D2
  // R-D2-1..R-D2-6, solution.md §37.54.5.3 / §37.54.7). The canonical scope
  // resolver and the four Credit read surfaces it governs: the five-mode
  // authorization matrix, the CORRECTION-1 historical-date regression and
  // the fail-closed behaviour on unattributable relations. Every case owns one
  // disposable temp SQLite and produces its Credit facts through the
  // production writers, so it never asserts against an impossible structure.
  // It is deliberately NOT registered in FAST: each case migrates a fresh
  // database and drives the real Credit writers, which is outside the FAST
  // criterion of a bounded, database-free regression.
  'server/sales-customer-wave11-sec-scope.test.js',
  // Wave 11 W11-A U1 — Credit Read Scope read primitives (solution.md
  // §37.54.5.2 / §37.54.15.3 / §37.54.15.9). The equivalence suite for the
  // bounded U1 amendment: the extracted pure policy-snapshot fingerprint
  // function measured against golden vectors captured from the ORIGINAL
  // implementation before the extraction, the unchanged invalid-input error
  // semantics, the boundary and hash-order sensitivity, the snapshot writer
  // persistence behaviour, and the inertness of the additive named export in
  // credit-check.js. It is deliberately NOT registered in FAST: every case
  // builds a disposable SQLite fixture and verifies snapshot persistence, which
  // is outside the FAST criterion of a bounded, database-free regression.
  'scripts/sales-customer-wave11-a-primitives.test.js',
  // Wave 11 W11-A U2-1 — SC101 Credit Query / SC102 Credit Exception History
  // (solution.md §37.54.8, document.md Stage B §6.2 / §6.3 / §7 / §8). The
  // acceptance suite for the read-only Credit query layer: the canonical
  // exposure amount against the Credit Check, the component breakdown, the
  // exception history with its filters, the stable pagination and the scope
  // total, the five-mode authorization matrix, the separation of the current
  // authorization date from a requested historical business date, the
  // non-enumerability of the detail, and the three-layer zero-side-effect
  // proof. Every case owns one disposable temp SQLite and reuses the W11-SEC
  // fixture, so the facts under test are the canonical ones. It is
  // deliberately NOT registered in FAST: each case migrates a fresh database
  // and drives the real Credit writers, which is outside the FAST criterion of
  // a bounded, database-free regression.
  'server/sales-customer-wave11-a-credit-query.test.js',
  // W11-A U3-A/U3-B — CREDIT_VIEW-only query options and the canonical
  // mobile Credit Query route/screen contract. Disposable SQLite proves the
  // selector authorization/projection/zero-write path; Vite/static UI cases
  // cover registry, deep-link, API mapping and responsive behavior.
  'server/sales-customer-wave11-a-credit-query-ui.test.js',
  // W11-A U3 Search Semantics — the script-aware fold, literal LIKE,
  // additive search-key migration, four writer paths and deterministic
  // Selector ordering. Database-backed and therefore FULL-only.
  'server/sales-customer-wave11-a-search-semantics.test.js',
  // W11-A forward-only OVERDUE evidence amendment. Disposable SQLite proof
  // for prospective immutable AR observation evidence, historical UNKNOWN,
  // five-category server filtering, pagination/scope and replay preservation.
  // It is not FAST because every case runs the production migration chain.
  'server/sales-customer-wave11-a-overdue-evidence.test.js',
  // Wave 10 Gate B OQC quality-policy fixture contract. Deterministic
  // single-connection regression over the real Delivery HTTP route: the
  // canonical control-point writer installs the fixture fact, the production
  // fail-safe still refuses without it, and the waiver is policy-driven.
  'server/sales-customer-wave10-quality-policy.test.js',
  // Wave 10 cross-dialect MySQL parity helpers: the canonical CHECK
  // normalization and the index / physical-type comparison contracts. Pure
  // parsing and comparison; no database connection.
  'server/sales-customer-wave10-mysql-parity.test.js',
  // Wave 10 acceptance-contract regressions (AC-01..AC-11). Engine-neutral
  // local proof of the three corrected acceptance-contract defects: the
  // no-rule fixture state, the date-stable Special Approval expiry and the
  // canonical Credit Profile anchor identity, including the negative
  // reproduction of each original defect. Bounded and deterministic; each
  // case owns one disposable temp SQLite database and never reaches MySQL.
  'server/sales-customer-wave10-acceptance-contract.test.js',
  // Wave 10 inventory-fixture canonical-seeding regressions (W10-INV-T01..T08).
  // The local proof that the shared acceptance fixture seeds exactly one
  // canonical inventory position through the production absolute writer, so
  // the canonical deduction path lands 100 -> 99 -> 98 on that one row
  // instead of creating a negative shadow row. Each case owns one disposable
  // temp SQLite database and never reaches MySQL. It is deliberately NOT
  // registered in FAST: the manifest's FAST criterion excludes temp-SQLite
  // dependency, and these cases require a real database state, the canonical
  // position identity and the deduction verification.
  'server/sales-customer-wave10-inventory-fixture.test.js',
  'server/sales-customer-batch-a.test.js',

  // ----- Procurement & Outsourcing Domain — Wave A foundation -----
  // M1-Core WP-0 source/schema/role contract. Static only: it never opens a
  // database and does not execute the migration whose source it verifies.
  'server/m1c-wp0-infrastructure.test.js',
  // M1C-WP0-R1 schema parity contract: drives the production SQLite→MySQL DDL
  // translation offline with a recording mock adapter. It never connects to
  // MySQL and never claims a dynamic parity Gate PASS.
  'server/m1c-wp0-schema-parity.test.js',
  // M-15 explicit offline migration: isolated in-memory SQLite plus a pure
  // MySQL DDL auto-commit/retry mock. Never opens a MySQL connection.
  'server/m15-tracked-identity-key.test.js',
  // G07 oracle/runner/parity infrastructure contract. Pure source and mock
  // checks; the real MySQL integration file is deliberately outside FULL.
  'server/m1-core-g07-infrastructure.test.js',
  // M1C-WP0-R1 focused regression for the outsourcing GL source-level policy
  // guard and the receiving-effect permission isolation. One disposable
  // isolated SQLite file per run.
  'server/m1c-outsourcing-gl-policy-guard.test.js',
  // M1C-WP-1 focused regression for the receipt notice line level source
  // writer, the business-type scoped capacity resolution, the notice to
  // purchase receipt conversion and the delivery schedule consumption
  // ledger. Every positive case drives the production HTTP API; the only
  // direct SQL is the legacy unproven-source fixture. It is deliberately NOT
  // registered in FAST: each case owns a disposable temp SQLite and runs the
  // real migration chain.
  'server/m1c-wp1-procurement-notice-conversion.test.js',
  // M1C-WP1-R1 focused regression for the delivery schedule consumption
  // ledger and the direct purchase receipt draft PATCH path. It proves the
  // P1 defect first (the PATCH left the schedule consumption describing the
  // previous lines) and then the atomic rebinding: the superseded positive
  // effect is released with an immutable negative effect, the rebuilt lines
  // register their own effect, and both capacity bounds are re-checked
  // against the aggregate state. It is deliberately NOT registered in FAST:
  // each case owns a disposable temp SQLite and drives the real HTTP API.
  'server/m1c-wp1-r1-schedule-patch.test.js',
  // M1C-WP1-R2 focused regression for the fail-closed effect evidence of a
  // historical outsourcing receipt. It proves the defect first (an unfinished
  // or failed quality record used to make an unproven receipt look effective)
  // and then the tightened evidence: only a completed PASS / WAIVED quality
  // decision counts, while real inventory / valuation / cost evidence is never
  // misjudged as unknown. It is deliberately NOT registered in FAST: each case
  // owns a disposable temp SQLite and drives the real HTTP API.
  'server/m1c-wp1-r2-outsourcing-receipt-effect-evidence.test.js',
  // M1C Processing PO R1: explicit outsourcing route, canonical PO draft
  // writer, lifetime source uniqueness, bounded non-creator commercial edit,
  // PO Change rejection and APPROVED PO notice/receipt provenance.
  'server/m1c-processing-po.test.js',
  // M1C WP2-WP5: 委外收货两段式生效、委外材料 canonical Writer 与身份证据、
  // 增量倒冲与成品入库、职责分离与延期危险写入拒绝、来源 UNIQUE 索引。
  // Deliberately NOT registered in FAST: each case owns a disposable temp
  // SQLite and drives the real HTTP API.
  'server/m1c-wp2-wp5-outsourcing.test.js',
  // M1C-WP2–WP6-R1: 委外收货的完工通知行剩余容量（P0-01）与加工费金额输入（P1）。
  // 通知行容量按真实通知行 ID 逐行累计；金额拒绝非法字符串与不安全整数分。
  // Deliberately NOT registered in FAST: each case owns a disposable temp
  // SQLite and drives the real HTTP API.
  'server/m1c-wp2-wp6-r1-notice-line-capacity.test.js',
  // M1C-WP2–WP6-R1: 委外收货生效的重复确认、幂等重放与并发竞争（P0-02）。
  // 覆盖顺序重复、同 Key 重放、同 Key 异内容、换 Key 重复、并发竞争、
  // 拒绝方状态逐字段不变与拒绝审计恰好一条。
  // Deliberately NOT registered in FAST: each case owns a disposable temp
  // SQLite and drives the real HTTP API.
  'server/m1c-wp2-wp6-r1-receipt-effect-idempotency.test.js',
  // M1C-WP7-A 首期 Gate 补证套件：M1C-G03 / G04 / G06 中此前没有断言位的
  // 成功与拒绝断言 —— LOT / SERIAL / NONE 三类身份各自成键、缺仓 / 库存不足 /
  // UOM 不符 / 身份异常四类拒绝分支、幂等与异内容重放、多批次部分完工的增量
  // 倒冲、成品估值 Movement + Balance 双写、材料成本按 canonical 位置口径
  // （非全局平均价）、加工费 provisional 证据，以及来源级拒绝后 AP / 凭证 /
  // 库存 / 估值 / 成本 / 单据逐字段零变化。正向来源全部经生产 HTTP API。
  // Deliberately NOT registered in FAST: each case owns a disposable temp
  // SQLite and drives the real HTTP API.
  'server/m1c-wp7a-gate-acceptance.test.js',
  // M1C-WP7-A-R1: the G03 **L2 canonical inventory primitive** evidence layer
  // required by Active Design §13.1.1 — the same five-field Mutation Key with
  // the same fingerprint replays, with a different fingerprint it is rejected
  // with the exact 409 INVENTORY_MUTATION_UNEXPECTED_REPLAY, and neither the
  // physical legs, the tracking legs, the valuation rows nor the canonical
  // mutation log are partially written. Deliberately NOT registered in FAST:
  // it owns a disposable temp SQLite.
  'server/m1c-wp7a-g03-l2-mutation-key.test.js',
  // M1C-WP7A-R1: the G03 multi-material-row / SERIAL identity leg-count
  // evidence required by Active Design §13.1 — one outsourcing order with LOT,
  // NONE and SERIAL material rows, four independent issues (SERIAL once per
  // serial number, quantity exactly 1), asserting the four business event
  // ids, the identity-key partition, the eight physical legs, the tracking
  // and POSTED valuation linkage, the warehouse quantity conservation, the
  // enterprise ownership and the L1 idempotency replay / conflict contract.
  // Deliberately NOT registered in FAST: it owns a disposable temp SQLite.
  'server/m1c-wp7a-g03-multi-material.test.js',
  // M1C-WP7A-R2: ISSUE / SUPPLEMENT / RETURN must preserve the external
  // idempotency contract when the same key is reused with different content:
  // 409, no G03 business-fact changes, and exactly one REJECT audit.
  // Deliberately NOT registered in FAST: it owns a disposable temp SQLite.
  'server/m1c-wp7a-g03-idempotency-conflict.test.js',
  // M1C-G07 Phase-5 low-cost real-HTTP smoke: drives CR-01..CR-09 setup chains
  // through the real createApp HTTP handler against an isolated disposable
  // SQLite and asserts the pre-race business state. Proves business
  // reachability of the fixed fixture chains; does not simulate MySQL
  // concurrency. Deliberately NOT registered in FAST.
  'server/m1c-g07-sqlite-smoke.test.js',
  'server/procurement-parameters.test.js',
  'server/procurement-profiles.test.js',
  'server/buyers.test.js',

  // ----- Procurement & Outsourcing Domain — Wave B/C/D/E/F/G/H/I + Return Execution -----
  'server/procurement-sourcing-pricing.test.js',
  'server/procurement-orders.test.js',
  'server/procurement-sourcing-capabilities.test.js',
  // 预付款要求（PRC-17）：业务意图层 + Finance handoff，不建第二支付引擎。
  'server/procurement-prepayment.test.js',
  // 委外加工费会计档案维护面与加工费账单只读列表（OUT-20 / C-P02）。
  'server/outsourcing-gl-profile-maintenance.test.js',
  // 委外加工价来源与期初 WIP / 期间关闭接入（OUT-03 / OUT-23）。
  'server/out-03-out-23.test.js',
  // 采购取价证据与采购订单变更合同回归（Active Design §26.36 / §31.16
  // PRC-DLV-01..09）：错误场景、权限分离、幂等、执行下界与失败零副作用。
  'server/procurement-commercial-evidence.test.js',
  'server/procurement-receiving-returns.test.js',
  'server/procurement-vmi.test.js',
  'server/outsourcing.test.js',
  'server/procurement-reports.test.js',
  'server/outsourcing-finance.test.js',
  'server/outsourcing-wip-transfer.test.js',
  'server/procurement-return-execution.test.js',
  'server/procurement-execution-suite.test.js',
  'server/out-final-acceptance.test.js',
  // 委外核心执行工作面（Requirement §31.15；Design §26.35）：订单状态机安全门禁、
  // 供应商资格按业务日期判定、受限读模型与职责分离、OUTSOURCE 通知来源级授权。
  'server/outsourcing-workbench.test.js',

  // ----- V21 Inventory & Warehouse Domain Closure — Wave A foundation -----
  // Pure / contract tests for canonical position identity, owner validation,
  // stock status, warehouse bin, legacy read compatibility, migration safety.
  'server/inventory-position-wave-a.test.js',
  'server/inventory-position-integration.test.js',

  // W11-A U3 — Demo Seed canonical inventory position identity
  // (document.md R-U3-INV-01..08, solution.md §37.54.43 §2 and §5). It owns
  // the physical identity of the inventory rows the Demo Seed creates. It
  // exists because the Domain 5 inventory suites deliberately suppress the
  // Demo Seed (NODE_ENV=production), so no existing suite ever observed a
  // seeded inventory row. Each case creates one disposable temp SQLite and
  // drives the real inventory writers and the real approval HTTP surface, so
  // it is deliberately NOT registered in FAST: it does not meet the FAST
  // criterion of a bounded, database-free regression.
  'server/inventory-demo-seed-position-identity.test.js',

  // ----- V21 Inventory & Warehouse Domain Closure — Wave B mutation contract -----
  // applyInventoryMutation dispatcher + availability model + locks +
  // VMI physical owner dimensional mutation + lock ordering.
  'server/inventory-mutation-wave-b.test.js',

  // ----- V21 Inventory & Warehouse Domain Closure — Wave C native operations -----
  // Opening initialization + Other Receipt/Issue + Stocktake APPROVE.
  'server/inventory-stocktake-wave-c.test.js',

  // ----- V21 Inventory & Warehouse Domain Closure — 14 Domain Race Matrix -----
  // (MySQL concurrency gate re-runs the full race matrix on disposable MySQL.)
  'server/inventory-domain-race.test.js',

  // ----- V21 Inventory & Warehouse Domain Closure — Wave D barcode/container/reports -----
  'server/inventory-wave-d-reports.test.js',

  // ----- V21 Inventory & Warehouse Domain Closure — Wave C extras (lot adjustment + form conversion) -----
  'server/inventory-wave-c-extras.test.js',

  // ----- B3120 Planning Domain Capability Closure -----
  'server/planning-domain-closure.test.js',

  // ----- Domain Alignment — canonical 8 Domains + Platform ownership -----
  'server/v17-domain-alignment.test.js',

  // ----- V17 Master & Engineering Domain Closure — Wave A Engineering Reference -----
  // Pure parser tests for the safe Workshop Formula evaluator
  // (no eval/Function/Function calls; rejects arithmetic-only,
  // divide-by-zero, exceeded length/depth, unknown identifiers).
  'server/engineering-reference.test.js',

  // Live HTTP integration: all 10 master families (shift / shift
  // pattern / calendar template / work calendar / basic activity /
  // workshop formula / resource / equipment / operation / control
  // code) + Work Center PATCH + deactivate + additive migration
  // preservation (legacy tables/columns intact) + engineering
  // permission family gate.
  'server/engineering-reference-integration.test.js',

  // ----- V17 Master & Engineering Domain Closure — Wave B BOM Governance -----
  // Live HTTP integration: BOM lifecycle (create / submit / approve /
  // reject / deactivate), cycle protection, tree expand, where-used,
  // consolidated, compare, cost reference (using existing
  // product_costs, NOT a second source of cost truth), batch preview
  // / apply atomic, resolver contract (effective_from/to + approval),
  // production-order reference guard on deactivate, additive
  // migration preserves legacy BOM table + production_orders
  // .bom_id snapshot column.
  'server/engineering-bom-integration.test.js',

  // ----- V17 Master & Engineering Domain Closure — Wave C Substitute Scheme -----
  'server/engineering-substitute-integration.test.js',

  // ----- V17 Master & Engineering Domain Closure — Wave D Routing Enrichment -----
  // Migration preserves legacy routing_operations + production_labor_records;
  // enrichment update attaches Engineering Operation / Control Code /
  // Activity / Resource / Equipment references and rejects unknown ids;
  // topology link CRUD (PARALLEL / SPLIT / MERGE / ALTERNATE) flips
  // topology_type to NETWORK; legacy /api/routing-operations GET
  // compatibility remains; production order routing snapshot source is
  // canonical product_routings.
  'server/engineering-routing-integration.test.js',

  // ----- V17 Master & Engineering Domain Closure — Wave E Engineering Change -----
  // ECO DRAFT → PENDING → APPROVED → APPLIED lifecycle; impact preview;
  // allowed operations restricted by change type; USE_UP_OLD cleanup log;
  // apply without APPROVED rejected; reject requires reason.
  'server/engineering-change-integration.test.js',

  // ----- V17 Master & Engineering Domain Closure — Wave F Downstream -----
  // Production Order BOM/Routing snapshot preserved when master mutates;
  // production order routing snapshot populated from canonical
  // product_routings; legacy /api/routing-operations GET compatibility;
  // engineering BOM resolver still resolves legacy ACTIVE rows.
  'server/engineering-downstream-integration.test.js',

  // ----- V17 Master & Engineering Domain Closure — frontend contracts -----
  'server/engineering-frontend-contract.test.js',
  'server/engineering-mysql-schema.test.js',

  // ----- V1.7 P0 — canonical frontend application architecture -----
  'server/v17-p0-frontend-application-architecture.test.js',

  // ----- V18 Manufacturing & Quality Domain Closure -----
  // Production Order state machine + Material Supplement + Batch Picking +
  // Operation Plan + Scheduling + Quality masters + Inspection + Scan +
  // Analytics + legacy production_outputs convergence.
  'server/manufacturing-quality-domain.test.js',

  // ----- V2 Stage 3 / Wave 3A + Wave 3B + Wave 3C + Wave 3D + Wave 3E + Wave 3F — backend dispatch ownership architecture -----
  // Architecture tests for server/lib/route-table.js plus the live
  // Wave 3A + Wave 3B + Wave 3C + Wave 3D + Wave 3E + Wave 3F
  // invariants for the migrated warehouse, customer, supplier,
  // role, user-management, and product master-data route families
  // (app.js imports route-table, twenty-two descriptors registered
  // across the six domains with canonical owners, no legacy
  // warehouse / customer / supplier / role / user-management /
  // generic product dispatch branches remain, the tracking-policy
  // route and all tracking / traceability / IQC-OQC routes still
  // fall through to the legacy handleApi chain, single
  // `ownedRouteTable` constructed once with a single `.match()`
  // lookup). Pure-function route-table safety tests live in the
  // same file.
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

  // ----- V2 Stage 3 / Wave 3B — second live customer ownership -----
  // Focused behavior coverage for the migrated /api/customers route
  // family: GET (search / shape / role), POST (validation / audit
  // / 201 / paymentTermsDays 400 message preservation / paymentTermsDays
  // default-to-0 / 403), PATCH (200 / 404 / active Boolean round-trip
  // / paymentTermsDays persistence), DELETE (RECORD_REFERENCED on a
  // referenced customer / 200 + DELETE audit on an unreferenced one),
  // and the canonical deleteMasterRecord lifecycle delegation.
  // Complements — does not duplicate — the existing
  // p2-data-lifecycle coverage of customer DELETE behavior.
  'server/v2-wave3b-customers-ownership.test.js',

  // ----- V2 Stage 3 / Wave 3C — third live supplier ownership -----
  // Focused behavior coverage for the migrated /api/suppliers route
  // family: GET (search code / name / contact / shape / role),
  // POST (validation / email round-trip / paymentTermsDays 400
  // message preservation / paymentTermsDays default-to-0 / 201 /
  // audit), PATCH (200 / 404 / email + paymentTermsDays persistence /
  // active Boolean round-trip / audit), DELETE (RECORD_REFERENCED
  // on a referenced supplier / 200 + DELETE audit on an
  // unreferenced one), and the canonical deleteMasterRecord
  // lifecycle delegation. Complements — does not duplicate — the
  // existing p2-data-lifecycle coverage of referenced-supplier
  // deactivation and the supplier-schema test of column contract.
  'server/v2-wave3c-suppliers-ownership.test.js',

  // ----- V2 Stage 3 / Wave 3D — fourth live role ownership -----
  // Focused behavior coverage for the migrated /api/roles route
  // family: GET (canonical roles + PERMISSIONS catalogue /
  // allowAny USERS_MANAGE or ROLES_MANAGE), POST (201 + audit +
  // permissions persisted + canonical 400 messages for invalid
  // permission shapes / 403), PATCH (200 + audit + permissions
  // persisted / 404 missing role / preserve current permissions
  // when body.permissions is omitted / ADMIN protection when
  // canonical PERMISSIONS entry is dropped). No DELETE /api/roles
  // route exists, and none is exercised.
  'server/v2-wave3d-roles-ownership.test.js',

  // ----- V2 Stage 3 / Wave 3E — fifth live user-management ownership -----
  // Focused behavior coverage for the migrated /api/users route
  // family: GET (canonical users + role join + active Boolean /
  // 403 sales / 401 unauth), POST (lowercase username / roleId +
  // active=1 + password hash persisted / CREATE USER audit /
  // password < 6 / unknown roleId / sales 403), PATCH
  // (displayName / roleId / active Boolean round-trip / password
  // re-hash + session invalidation / 404 / non-boolean active 400 /
  // self-deactivation 400 / unknown roleId 400 / UPDATE USER audit
  // / non-security-sensitive displayName-only update preserves
  // sessions).
  // /api/users/lookup was removed with the Project Management
  // extension in Core Scope Cleanup; the continuity proof no
  // longer applies.
  // No DELETE /api/users route exists, and none is exercised.
  'server/v2-wave3e-users-ownership.test.js',

  // ----- V2 Stage 3 / Wave 3F — sixth live product master-data ownership -----
  // Focused behavior coverage for the migrated /api/products route
  // family: GET (canonical shape + 18-field contract + active
  // Boolean + search filter + PRODUCTS_VIEW reachability +
  // unauthenticated 401), POST (lowercased code NOT — codes are
  // case-sensitive; standardManufacturingCostCents persistence +
  // UOM auto-create + active=1 hard-code + stock_quantity=0 hard-
  // code + CREATE PRODUCT audit / invalid trackingPolicy exact
  // 400 "库存跟踪方式无效" + TRACKING_POLICY_MISMATCH code / invalid
  // standard cost / invalid shelfLifeDays / sales 403), PATCH
  // (display fields + classification + standard cost + baseUom
  // when no inventory_transactions exist + UPDATE PRODUCT audit /
  // 404 missing / stockQuantity + stock_quantity writes rejected
  // with exact 409 "货品库存数量只读…" / baseUom change rejected
  // with exact 409 "已有历史交易的产品不可变更基础单位" once
  // inventory_transactions exist), DELETE (delegation to
  // deleteMasterRecord: 200 + DELETE PRODUCT audit on unreferenced
  // / 409 RECORD_REFERENCED on referenced product), and
  // PATCH /api/products/:id/tracking-policy continuity proof that
  // the route remains on the legacy handleApi branch. The full
  // tracking-policy semantics are owned by
  // server/modules/traceability-quality.js and are preserved by
  // brief §11.
  'server/v2-wave3f-products-ownership.test.js',

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

  // ----- Accounting & Analytics Domain Closure (AA-W1 / AA-W2) -----
  // AA-W1 accounting event ledger / reconciliation workbench / subject
  // maintenance, and AA-W2 voucher template & rule platform. Every case has
  // a positive and a negative assertion.
  'server/accounting-analytics-w1-w2.test.js',

  // AA-W3 总账增强与期末自动化：冲销 / 补记统一路径、出纳复核 SOD、
  // 现金流量表与资金子账对账、期末转账 / 摊销 / 计提、真实损益结转与
  // 关账拦截、反结转留痕。
  'server/accounting-analytics-w3.test.js',
  // Accounting & Analytics AA-W5 固定资产完整生命周期（Requirement §35.4.5 / Design §31.5）。
  'server/accounting-analytics-w5.test.js',
  // Accounting & Analytics AA-W6 存货核算深化（Requirement §35.4.6 / Design §31.6）。
  'server/accounting-analytics-w6.test.js',
  // 路由字面量守卫：正则路由的转义丢失会让应用无法启动。
  'server/route-literal-guard.test.js',

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

  // ----- V2 Stage 3 / Wave 5A — accounting configuration dictionaries ownership -----
  // Focused behavior coverage for the migrated accounting
  // configuration dictionaries route family (currencies / voucher
  // words / voucher templates): GET /api/currencies (admin gate +
  // is_base DESC ordering + baseline shape), GET /api/voucher-words
  // (admin gate + voucherWords array + prefix ordering), POST
  // /api/voucher-words (admin gate + 201 + id returned + current_no
  // persisted as 0 + subsequent GET exposes new word), GET
  // /api/voucher-templates (admin gate + category query filter +
  // entries_json parsed as entries + creator projection preserved),
  // and permission preservation (warehouse role 403 on representative
  // routes). Complements — does not duplicate — the minimal GET-only
  // coverage already present in teacher-acceptance-matrix.test.js.
  'server/v2-wave5a-accounting-config.test.js',

  // ----- V2 Stage 3 / Wave 5B — manufacturing reference data ownership -----
  // Focused behavior coverage for the migrated manufacturing
  // reference-data route family (`/api/work-centers`,
  // `/api/routing-operations` — the legacy BOM-bound
  // `routing_operations` table; distinct from the
  // `product_routings` / `product_routing_operations` owned by
  // server/modules/product-routing.js). Six tests covering: GET
  // /api/work-centers (200 + canonical list ordered by code + full
  // row shape), POST /api/work-centers (201 + { id } + capacity /
  // labor / overhead rate normalization with canonical defaults +
  // CREATE WORK_CENTER audit with `能力 <minutes> 分钟` detail),
  // sales 403 on /api/work-centers GET and POST (no
  // WORK_CENTERS_VIEW / WORK_CENTERS_MANAGE), GET
  // /api/routing-operations (joined work-centre / BOM / product
  // projection + bom_id filter + ordering by bom_id, operation_no),
  // POST /api/routing-operations (201 + { id } + exact INSERT
  // contract + canonical defaults operation_no=1 / time fields=0 /
  // description=""), sales 403 on /api/routing-operations GET and
  // POST (no ROUTING_VIEW / ROUTING_MANAGE). Complements — does not
  // duplicate — the generic teacher-acceptance-matrix reference.
  'server/v2-wave5b-manufacturing-reference.test.js',

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

  // Concurrency lock-observer unit tests. Pure-function coverage of the
  // lock-wait observation contract (idle, Query activity, performance
  // schema wait rows, partial / full downgrades). Lives in server/ so
  // the manifest's `server/` discovery picks it up automatically.
  'server/concurrency-lock-observer.test.js',

  // Gate TAP parser unit tests. Pure-function coverage of the gate's
  // TAP summary parser and strict fail-closed assertion. Lives in
  // scripts/ so it is registered explicitly (the suite manifest's
  // `server/ + src/lib/` discovery does not pick up scripts/).
  'scripts/gate-tap-parser.test.js',
  'scripts/docs/check-doc-consistency.test.js',
  'scripts/git/check-commit-traceability.test.js',
  'scripts/gates/ack4-runtime.test.js',
  'scripts/gates/m1-core-g07-child-lifecycle.test.js',
  'scripts/gates/m1-core-g07-diagnostics.test.js',

  // ----- V22 — Finance Operations Domain Closure -----
  // Wave A foundation: parameters, recognition policy, payment terms,
  // due schedule, settlement schemes, business-close anchors, open-item
  // effect VIEW, refresh / reconcile, manual AR / AP, provisional
  // conversion.
  'server/v22-finance-wave-a-foundation.test.js',
  // Wave B settlement convergence: counterparty transfer, settlement
  // reversal, unapplied balance (advance / application / refund),
  // bad-debt provision.
  'server/v22-finance-wave-b-settlement.test.js',
  // Wave C invoice / recognition convergence: invoice source cardinality,
  // credit_state additive columns, provisional conversion operational entry.
  'server/v22-finance-wave-c-invoice.test.js',
  // Wave D treasury convergence: finance_treasury_movements,
  // applyTreasuryMovement single canonical writer, paired internal transfers,
  // balance reconciliation health.
  'server/v22-finance-wave-d-treasury.test.js',
  // Wave E reporting convergence: AR/AP summaries and aging, Treasury
  // movement/balance projections, and Treasury-to-GL check-only reconcile.
  'server/v22-finance-wave-e-reports.test.js',
  'server/v22-finance-recovery-api.test.js',
  'server/v22-finance-recognition-production.test.js',
  'server/v22-finance-invoice-lifecycle.test.js',
];

// FAST — subset of FULL that excludes tests requiring Vite SSR,
// temp SQLite creation, or multi-second boot. The fast suite must
// remain a deterministic regression within seconds.
//
// Invariant: every file in FAST must also be present in FULL.
const FAST = [
  // M1-Core WP-0 static infrastructure contract; no DB, MySQL or migration execution.
  'server/m1c-wp0-infrastructure.test.js',
  'server/m15-tracked-identity-key.test.js',
  'server/m1-core-g07-infrastructure.test.js',
  'scripts/git/check-commit-traceability.test.js',
  'scripts/gates/ack4-runtime.test.js',
  'scripts/gates/m1-core-g07-child-lifecycle.test.js',
  // W7 F2 pure retry-admission parser and injected monotonic-clock contract.
  'server/sales-gate-retry-admission.test.js',
  'server/mysql-disposable-target-guard.test.js',
  'server/mysql-out001-gate-infrastructure.test.js',
  'scripts/mysql-sales-wave7-gate-a-runner.test.js',
  // Wave 10 cross-dialect parity helpers — pure DDL parsing and comparison.
  'server/sales-customer-wave10-mysql-parity.test.js',
  // Wave 10 Gate B OQC quality-policy fixture contract. Unlike the other
  // FAST entries this one creates one disposable temp SQLite per case, because
  // the fixture contract is only observable through the real Delivery HTTP
  // route and the real quality gate. It stays a bounded, deterministic and
  // environment-independent regression (no MySQL, no Vite SSR, no network).
  'server/sales-customer-wave10-quality-policy.test.js',
  // Wave 10 acceptance-contract regressions (AC-01..AC-11). Like the OQC
  // entry above, each case creates one disposable temp SQLite; the fixture
  // state and the anchor identity are only observable through the real Credit
  // writers. Bounded, deterministic and environment-independent (no MySQL, no
  // Vite SSR, no network).
  'server/sales-customer-wave10-acceptance-contract.test.js',
  // Transaction Lifecycle Safety — pure fault injection, no real MySQL.
  'server/db-transaction-start-safety.test.js',

  // Canonical 8 Domains + Platform source-contract; no DB or Vite SSR.
  'server/v17-domain-alignment.test.js',

  // V17 Master & Engineering Domain Closure — Wave A: pure parser
  // tests for Workshop Formula evaluator (no DB, no Vite SSR).
  'server/engineering-reference.test.js',

  // Master & Engineering route/API/responsive source contract.
  'server/engineering-frontend-contract.test.js',

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

  // Gate TAP parser unit tests. Pure-function coverage of the gate's
  // TAP summary parser and strict fail-closed assertion. Runs in
  // milliseconds; lives under scripts/ so it is registered explicitly
  // (the suite manifest's `server/ + src/lib/` discovery does not pick
  // up scripts/).
  'scripts/gate-tap-parser.test.js',
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
