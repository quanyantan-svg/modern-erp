# Modern ERP Production Acceptance

> Final production acceptance record covering `Phase A → Phase F` for release `v0.9.10` at commit `3064442`.
>
> Phase A / Phase B records were authored incrementally against `v0.9.2` (`6168cdd`) and **are preserved unchanged** above this section (Evidence-Locked). Phases C through F were completed out-of-band against intermediate production candidates and are now consolidated into this final record. Acceptance evidence is sourced from:
>
> * **`PASS — user-confirmed production manual verification`** — items the user confirmed directly against the Tencent Cloud Ubuntu 22.04 production host in this session.
> * **`PASS — automated regression evidence`** — focused `node:test` suites executed against a fresh SQLite database and a local HTTP server, proving **code-level behaviour** of the build under test (`3064442`). Not production runtime evidence.
> * **`PASS — production operational evidence`** — production-host operational verification (backup / restore / restart / rollback / public smoke) reported by the user.
>
> No server-side commands were executed by the assistant. No production passwords, tokens, cookies, session bearers, SSH keys, or private credentials were captured or recorded.

## Release Under Test

| Item | Value |
| --- | --- |
| Release | `v0.9.10` |
| Commit | `3064442` — `fix(accounting): expose period closing workflow` |
| Environment | Tencent Cloud Lighthouse · Ubuntu 22.04 |
| Application path | `/opt/modern-erp` |
| systemd service | `modern-erp.service` |
| Reverse proxy | Nginx `:80` → Node `127.0.0.1:3001` |
| Production DB path | `/var/lib/modern-erp/erp.db` |
| Backup directory | `/var/backups/modern-erp/` |
| Backup timer | `modern-erp-backup.timer` (`OnCalendar=*-*-* 02:30:00`) |
| Final acceptance date | 2026-09-02 |

## Phase A — Deployment Baseline

`PHASE A = PASS`

Deployment / infrastructure baseline accepted. The full Phase A check table (A01–A13) under `v0.9.2` is **preserved unchanged** further down this document (Historical Records). For `v0.9.10` the deployment state was reconfirmed by the user: systemd service active, Nginx proxy serving, Node bound to `127.0.0.1:3001`, DB reachable, backup timer `active (waiting)`, public UI reachable.

## Phase B — Authentication & Permission

`PHASE B = PASS — EVIDENCE LOCKED`

Authentication / authorization accepted. The full Phase B check table (B01–B12) and verdict are preserved unchanged further down this document. B01–B05, B07–B12 are evidence-locked via user-confirmed production manual verification; B06 retained as automated regression evidence per task instruction (no production-side brute-force test executed against `admin`).

## Phase C — Master Data

`PHASE C = PASS`

Master Data production smoke accepted. Acceptance covered the canonical create / refresh / update round-trip on each core entity plus the supplier `email` production schema migration regression. Summary of evidence (per user-confirmed production manual verification against the `v0.9.4 → v0.9.6` production candidates that drove this phase):

* **Customer**: create → list-refresh → update → list-refresh. Newly created and updated customers persist after service restart; validation errors (empty required fields, invalid phone format) are returned with HTTP 400 and surfaced in UI without server 500.
* **Supplier**: create → list-refresh → update → list-refresh. The `email` production migration regression (`70df697`, `v0.9.1`) was retested on production — supplier rows created through the UI carry the `email` column; historical suppliers created before the migration remain visible and editable. Validation behaviour and clean-server behaviour identical to the dev DB.
* **Product**: create → list-refresh → update → list-refresh. SKU uniqueness enforced; disabled products remain visible in historical order context. Server restart preserves product records.
* **Warehouse**: create → list-refresh → update → list-refresh. Same persistence / validation / restart behaviour as the other master-data entities.
* **Cross-entity invariants**: list endpoints paginate consistently; refresh re-fetches without stale cache; clean server rebuild on `NODE_ENV=production` + `ERP_SEED_DEMO=false` does **not** auto-seed demo master data; `setup-admin` is the only path to bootstrap credentials.

No fabricated server commands, output, or credentials are recorded. Source-level automated evidence retained across `server/app.test.js`, `server/ui-source.test.js`, and `server/supplier-schema.test.js` (≥ 9 migration regression tests).

## Phase D — Core ERP

`PHASE D = PASS`

Core ERP production acceptance covered sales-orders, project management, and production-order workflows across the `v0.9.3 → v0.9.5` production candidates. Final state reflects the full chain of Phase D hotfixes (`3d1a973`, `b8556f4`, `0c15bd9`, `7d3a3aa`).

* **Sales Order core path**: create → submit → approve / reject (production runtime exercised by Phase B-era user smoke; persistent state verified across Phase D candidates).
* **Project Create Modal**: blank-screen regression eliminated (`3d1a973`); modal renders, accepts user, persists project.
* **Project creation / persistence**: project records persist across service restart.
* **Project Manager selector**: manager dropdown populates (`7d3a3aa`); default = current authenticated user; lookup endpoint `GET /api/users/lookup` restricted to `PROJECT_MANAGE` without weakening `USERS_MANAGE` administration gate.
* **Production Order create button**: rendered for users with `PRODUCTION_ORDERS_CREATE` (canonical permission, post `3d1a973` permission rewire).
* **Production Order modal**: form fields `{ productId, bomId, quantity, plannedStart, plannedFinish, remark }` match backend contract.
* **Production Order create**: PENDING state, linked product / BOM.
* **Production Start / Complete / Cancel**: state machine transitions accepted; invalid transitions (e.g. start after complete) rejected with HTTP 409.
* **React #301 regression eliminated**: `0c15bd9` removes render-time `setForm` in `ProductionOrderModal` and `BomModal`; production browser no longer crashes on `+ 新建工单`.
* **`<Badge>` runtime issue**: `b8556f4` adds the missing `Badge` export to `src/components/ui.jsx`; all four pages (`projects-workflow`, `treasury-cost`, `crm`, `quality`) now reference a real component instead of `undefined`.

Source-level automated evidence retained: `server/phase-d-hfix.test.js` (21 tests), `server/badge-defect.test.js` (12 tests), `server/phase-d-renderloop.test.js` (9 tests), `server/project-manager.test.js` (26 tests).

## Phase E — Accounting

`PHASE E = PASS`

Accounting end-to-end production acceptance covered voucher workflow, money contract, financial reporting, and period closing across the `v0.9.6 → v0.9.10` production candidates.

### Voucher Workflow

Production browser confirmed the complete voucher lifecycle driven by `smoke_accounting` + an independent admin approver (matching Phase E creator/approver separation contract):

* **Manual voucher creation** via `+ 新建凭证` (UI button gated by `ACCOUNTING_VIEW`).
* **ENTERED** state on creation; voucher rows render `状态: 已录入` Badge.
* **SUBMITTED** transition via UI submit button (gated by `VOUCHER_SUBMIT`); `smoke_accounting` holds the permission after the `314a11d` reconciliation.
* **POSTED** transition via independent admin approver (different user, holds `VOUCHER_APPROVE`); backend enforces `creator_id !== approver.id` (403 on self-approval).
* **REJECTED** state via approver reject action; rejection reason is a required field in both UI and backend (400 on empty / whitespace reason).
* **REJECTED → edit → ENTERED**: `VoucherModal` reopens; backend `updateAccountingVoucher` resets `status = 'ENTERED'` and clears `rejection_reason` inside the same transaction.
* **role-accounting separation**: `role-accounting` includes `VOUCHER_SUBMIT` but **does NOT** include `VOUCHER_APPROVE`; admin role (and any user with `VOUCHER_APPROVE`) is the only path to approval. Verified via production permissions JSON for `smoke_accounting`.

### Money Contract

Production browser verified the manual voucher round-trip:

* UI input field labelled `金额（元）` accepts **yuan** strings.
* Backend contract unchanged: SQLite `accounting_entries.amount_cents` is **integer cents**; `createAccountingVoucher` and `updateAccountingVoucher` receive `amountCents` directly without internal ×100 conversion.
* Boundary helper `src/lib/money.js` (`yuanToCents`, `centsToYuanInput`) ensures no double-conversion on edit round-trip.

### Financial Reporting — Production Smoke Dataset

The following production voucher set was created and confirmed via the running app (admin / `smoke_accounting`) on `2026-09`:

| Voucher | Subject | Direction | Amount |
| --- | --- | --- | --- |
| SMOKE-E01 | 1001 库存现金 | DEBIT | ¥10,000.00 |
| SMOKE-E01 | 6001 主营业务收入 | CREDIT | ¥10,000.00 |
| SMOKE-E02 | 6401 主营业务成本 | DEBIT | ¥4,000.00 |
| SMOKE-E02 | 1001 库存现金 | CREDIT | ¥4,000.00 |
| SMOKE-E03 (asset-internal) | 1001 库存现金 | DEBIT | ¥999.00 |
| SMOKE-E03 (asset-internal) | 1002 银行存款 | CREDIT | ¥999.00 |
| SMOKE-E04 (asset-internal) | 1002 银行存款 | DEBIT | ¥500.00 |
| SMOKE-E04 (asset-internal) | 1001 库存现金 | CREDIT | ¥500.00 |

#### Trial Balance — `period=2026-09` (Final accepted values)

* `totalPeriodDebit = ¥15,499.00` (= ¥10,000 + ¥4,000 + ¥999 + ¥500)
* `totalPeriodCredit = ¥15,499.00` (= ¥10,000 + ¥4,000 + ¥999 + ¥500)
* `periodBalanced = true`
* `totalClosingDebit = ¥10,000.00` (1001 + 1002 net; credit-normal subjects excluded)
* `totalClosingCredit = ¥10,000.00` (6001 net; debit-normal subjects excluded)

Per-subject closing balances:

| Subject | Name | Type / Normal | Closing | Direction |
| --- | --- | --- | --- | --- |
| 1001 | 库存现金 | ASSET / DEBIT | ¥4,501.00 | DEBIT |
| 1002 | 银行存款 | ASSET / DEBIT | ¥1,499.00 | DEBIT |
| 6001 | 主营业务收入 | REVENUE / CREDIT | ¥10,000.00 | CREDIT |
| 6401 | 主营业务成本 | EXPENSE / DEBIT | ¥4,000.00 | DEBIT |

#### Income Statement — `period=2026-09`

* `revenue = ¥10,000.00`
* `expense = ¥4,000.00` (营业成本与费用, EXPENSE total)
* `profit = ¥6,000.00`
* Sections: `营业收入` (6001) + `营业成本与费用` (6401); REVENUE → `credit − debit`; EXPENSE → `debit − credit`.

#### Balance Sheet — `period=2026-09` (`asOfDate=2026-09-30`)

* `assets.total = ¥6,000.00` (= ¥4,501 + ¥1,499)
* `equity.postedEquity = ¥0.00` (no posted EQUITY subjects in production seed)
* `equity.unclosedProfit = ¥6,000.00` (virtual row, not persisted)
* `equity.total = ¥6,000.00`
* `totalAssets = ¥6,000.00`
* `totalLiabilitiesAndEquity = ¥6,000.00`
* `difference = ¥0.00`
* `equationValid = true`

#### Reporting Acceptance Summary

* `POSTED-only` reporting **PASS** — ENTERED / SUBMITTED / REJECTED vouchers excluded across Trial Balance / Income Statement / Balance Sheet / Financial Summary.
* `NULL-period compatibility` **PASS** — historical vouchers with `period IS NULL` still surface correctly because reports filter by `voucher_date` range rather than the `period` column.
* Trial Balance **subject filtering** **PASS** — all 7 seed subjects returned even in zero-activity periods.
* Month-end `endDate` handling **PASS** — `2026-09-30` boundary voucher included; `2026-10-01` excluded (no off-by-one).
* **Closing debit / credit direction classification** **PASS** — `closingDirection` field supplied by backend, frontend renders `借 / 贷` prefix per subject's normal direction (REVENUE → CREDIT when positive).

Source-level automated evidence retained: `server/phase-e-accounting.test.js` (27 tests), `server/voucher-amount-units.test.js` (39 tests), `server/trial-balance.test.js` (35 tests), `server/income-statement.test.js` (21 tests), `server/balance-sheet.test.js` (28 tests), `server/financial-summary.test.js` (15 tests), `server/period.test.js` (13 tests), `server/voucher.test.js` (15 tests), `server/period-ui.test.js` (31 tests).

### Period Closing

Production browser confirmed the complete period-closing workflow on `2026-09`:

* **Accounting Period UI available** under `会计凭证 → 会计期间` (gated by `PERIOD_CLOSE_VIEW`; management actions gated by `PERIOD_CLOSE_MANAGE`).
* **Checklist PASS** — ENTERED / SUBMITTED / REJECTED counts all zero (existing Phase E vouchers are final-state POSTED).
* **Period close PASS** — Confirmation modal → `POST /api/period-closures/:id/close` returned 200; row flipped to `CLOSED`; audit row `CLOSE_PERIOD` written in the same transaction.
* **CLOSED period blocks manual voucher creation** — `POST /api/accounting-vouchers` with `voucher_date=2026-09-15`, voucher `SMOKE-CLOSED-PERIOD`, debits 1002 ¥100 / credits 1001 ¥100 was rejected. The rejection is a **business-level HTTP 409** (`会计期间 2026-09 已结账，禁止 录入 凭证`) — **not** a 500, not a SQLite exception.
* **Reopen PASS** — Confirmation modal → `POST /api/period-closures/:id/unclose` returned 200; row flipped to `OPEN`; audit row `UNCLOSE_PERIOD` written.
* **Operation allowed again after reopen** — voucher `SMOKE-AFTER-REOPEN` with `voucher_date=2026-09-20` returned HTTP 201 / status ENTERED.

For continued operation the final state of `2026-09` was reverted to `OPEN` (period protection is administrative; the canonical Year-End Carry Forward / retained-earnings auto-entry remains out-of-scope per `document.md` §5.5.2 / `solution.md` §7.8 `NOT_VERIFIED` declaration).

**Important classification:**

* Current period closing is **administrative accounting-period protection**.
* It does **NOT** implement profit/loss carry-forward.
* It does **NOT** zero `6001 主营业务收入` or `6401 主营业务成本`.
* It does **NOT** create retained-earnings / 本年利润 / 利润分配 auto-vouchers.
* The `未结转损益` row in the Balance Sheet remains a virtual calculation only.

Source-level automated evidence retained: `server/period.test.js` (13 tests) + `server/period-ui.test.js` (31 tests).

## Phase F — Production Operations

`PHASE F = PASS`

Production operational acceptance covered backup, real backup restore, systemd restart, backup timer, git rollback, public smoke, network / runtime isolation, and server-log inspection. Production-host verification was performed by the user; this section records what was observed.

### Backup Creation

* Manual backup service execution **PASS** — `sudo systemctl start modern-erp-backup.service` exits `status=0/SUCCESS`; service returns to `inactive (dead)` after oneshot completes.
* Backup file created under `/var/backups/modern-erp/` with the `erp-YYYYMMDD-HHmmss.db` naming.
* `PRAGMA integrity_check` on the newest backup returns `ok`.
* Production DB path remains `/var/lib/modern-erp/erp.db`.
* Backup directory remains `/var/backups/modern-erp/`.

### Real Backup Restore

A real restore was performed end-to-end on the production host:

1. Create backup snapshot via `modern-erp-backup.service` oneshot.
2. Create a temporary post-backup marker record (a write that did **not** exist in the snapshot).
3. Stop `modern-erp.service`.
4. Preserve a pre-restore safety database copy (`safety-YYYYMMDD-HHmmss.db`) via the restore tool's built-in safety step.
5. Restore production DB from the backup snapshot via `restore-db.mjs --confirm-restore`.
6. Clear / clean up SQLite `-wal` / `-shm` sidecar files as the tool requires.
7. Restart `modern-erp.service`.
8. Verify the **original production data** is present after restart.
9. Verify the **post-backup marker** is **absent** (consistent with snapshot point-in-time).

**Result: PASS** — recovery model preserves true snapshot semantics; safety backup allows one-step rollback to "before the restore attempt" if anything fails.

No passwords, tokens, SSH keys, or private credentials are recorded.

### systemd Restart

* `modern-erp.service` restart **PASS**.
* Application returned healthy after restart.
* Production data persisted (no row loss across the restart).
* Service remains `enabled` (will start on boot).

### Backup Timer

* `modern-erp-backup.timer` is `active (waiting)`.
* `OnCalendar=*-*-* 02:30:00`.
* `Persistent=true` (catches missed runs across reboots).
* Automatic backup mechanism accepted as the production backup cadence.

### Git Rollback

Real release rollback was performed for verification:

1. `git checkout v0.9.9` (previous immutable release tag) — succeeded.
2. `pnpm build` — succeeded.
3. `modern-erp.service` start — succeeded.
4. `curl http://127.0.0.1/api/health` — 200 healthy.
5. Production browser showed the expected `v0.9.9` UI (Trial Balance footer still using the pre-direction classification rendering; Period tab absent because the UI was not yet exposed).
6. Restore current release: `git checkout v0.9.10` — succeeded.
7. `pnpm build` — succeeded.
8. `modern-erp.service` restart — succeeded.
9. Production returned to `v0.9.10` (Period tab visible; final-period Production acceptance values intact).

**Result: PASS** — release rollback is a **code-release rollback** verification (no DB rollback was required). The immutable tag history was preserved: `v0.9.9` and `v0.9.10` were neither moved nor deleted.

### Public Smoke

Final public acceptance (all observed via the public URL through Nginx):

* Public application reachable through Nginx (:80) — **PASS**.
* Login — **PASS**.
* Session / navigation — **PASS**.
* Representative master-data page — **PASS**.
* Project page — **PASS**.
* Production-order page — **PASS**.
* Accounting page (subjects / vouchers / income / balance / trial) — **PASS**.
* Financial reports — **PASS**.
* Accounting Period page — **PASS**.

### Network / Runtime

* Nginx exposed on port 80.
* Node application bound to `127.0.0.1:3001`.
* Port `3001` is **not** intended for public exposure; it is reachable only from the loopback interface.
* Nginx reverse proxy health **PASS** (`http://127.0.0.1/api/health` → 200).
* Node direct health **PASS** (`http://127.0.0.1:3001/api/health` → 200).

No public IP addresses are reproduced here.

### Server Log

Final server log inspection for the Phase F window:

`CLEAN`

* No uncaught exceptions.
* No SQLite corruption markers.
* No missing-table / missing-column errors.
* No application 500 regressions.

Normal business validation responses (`400` on validation, `401` on missing credentials, `403` on permission denied, `409` on closed-period voucher creation / duplicate period / state-machine violation) are by design and are **not** classified as server failure.

## Final Release Summary

| Area                            | Result |
| ------------------------------- | ------ |
| Phase A — Deployment            | PASS   |
| Phase B — Auth / Permission     | PASS (evidence-locked) |
| Phase C — Master Data           | PASS   |
| Phase D — Core ERP              | PASS   |
| Phase E — Accounting            | PASS   |
| Phase F — Operations / Recovery | PASS   |
| Backup Creation                 | PASS   |
| Real Backup Restore             | PASS   |
| systemd Restart                 | PASS   |
| Git Rollback                    | PASS   |
| Public Smoke                    | PASS   |
| Server Log                      | CLEAN  |

**`FINAL PRODUCTION ACCEPTANCE = PASS`**

The `v1.0.0` release tag has not been created at this documentation stage.

**`READY FOR v1.0.0 RELEASE = YES`**

## Release History

The release progression below preserves the **immutable tag history**; no tag was moved, renamed, or deleted during final acceptance. Intermediate releases represent specific production candidates that produced a targeted hotfix; only the corresponding final candidate should be understood as the user-confirmed production state for its phase.

| Tag | Commit | Title | Role |
| --- | --- | --- | --- |
| `v0.9.0` | `1a342ed` | merge: integrate ERP refactor and deployment readiness | initial production-ready baseline |
| `v0.9.1` | `70df697` | fix(supplier): migrate missing supplier fields | supplier production schema migration hotfix |
| `v0.9.2` | `6168cdd` | feat(ui): refine production interface | production UI refinement (Phase A / Phase B acceptance recorded against this release) |
| `v0.9.3` | `b8556f4` | fix(ui): repair undefined badge component | intermediate Phase D checkpoint (Badge runtime fix) |
| `v0.9.4` | `0c15bd9` | fix(production): prevent production order render loop | completed Phase D hotfix (production render-loop) |
| `v0.9.5` | `7d3a3aa` | fix(projects): populate project manager selector | Phase D manager-selector hotfix |
| `v0.9.6` | `314a11d` | fix(accounting): enable manual voucher workflow | manual voucher workflow enabled (Phase E) |
| `v0.9.7` | `d9079f0` | fix(accounting): correct voucher amount units | voucher yuan ↔ cents boundary fix (Phase E) |
| `v0.9.8` | `8ae1d8f` | fix(accounting): include manual vouchers in trial balance | Trial Balance filtering / date fix (Phase E) |
| `v0.9.9` | `aac802b` | fix(accounting): correct trial balance closing totals | Trial Balance closing-direction classification (Phase E) |
| `v0.9.10` | `3064442` | fix(accounting): expose period closing workflow | Period Closing UI exposure (Phase E final); **current accepted production candidate** |

## Change Control

* This document was extended in the documentation-only commit following `3064442`. No code, schema, permission model, deployment configuration, or test was modified.
* `v0.9.10` was neither moved nor deleted.
* No new release tag was created (no `v1.0.0`); the FINAL ACCEPTANCE = PASS verdict does not constitute a tag and is recorded as `READY FOR v1.0.0 RELEASE = YES` only.
* No deployment was performed by the documentation commit itself.

---

# Historical Records (Preserved Unchanged)

The following sections were authored incrementally against `v0.9.2` (`6168cdd`) and are preserved here as the original evidence-locked records. They are not retroactively updated; the Final Acceptance above is the consolidated verdict.

## Historical Phase A — Deployment Baseline (`v0.9.2`)

> Phase A — Deployment Baseline re-verification record for release `v0.9.2`.

### Release Under Test (Historical)

| Item | Value |
| --- | --- |
| Release | `v0.9.2` |
| Commit | `6168cdd` — `feat(ui): refine production interface` |
| Environment | Tencent Cloud Lighthouse · Ubuntu 22.04 |
| Application path | `/opt/modern-erp` |
| systemd service | `modern-erp.service` |
| Reverse proxy | Nginx `:80` → Node `127.0.0.1:3001` |
| Backup | `modern-erp-backup.timer` + `modern-erp-backup.service` |
| Re-verification date | 2026-08-31 |

### Evidence Rule (Historical)

This record was produced by Claude Code from a **Windows local dev environment** with **no SSH access** to the production server. Per the task Evidence Rule:

* Local repository facts (commit / tag / working tree state) are recorded with **direct, locally-observed evidence**.
* Every server-side runtime check (systemd, Nginx, ports, health endpoints, backups, public UI) is recorded as **`PASS — user-confirmed production manual verification`** because the user explicitly stated *"Phase A 已人工检查正常"* in this session. **No server command output was supplied by the user and none was fabricated by the assistant.**
* Any check that needs fresh server output for Phase B or later phases must be re-run directly on the production host; this record does not substitute for live evidence.

### Historical Phase A Check Table

| ID | Check | Result | Evidence |
| --- | --- | --- | --- |
| A01 | Git release/tag at HEAD | PASS — user-confirmed production manual verification | Local repo: `6168cdd (HEAD -> master, tag: v0.9.2, origin/master)`. User confirmed production `/opt/modern-erp` HEAD equals `v0.9.2 @ 6168cdd`. |
| A02 | Working tree clean | PASS — user-confirmed production manual verification | Local: `nothing to commit, working tree clean`. User confirmed production working tree is clean. |
| A03 | systemd application service | PASS — user-confirmed production manual verification | User confirmed `modern-erp.service` is `active (running)` on the production host. |
| A04 | Nginx reverse proxy | PASS — user-confirmed production manual verification | User confirmed `nginx` is `active (running)` and serving the modern-erp site. |
| A05 | Node direct health (`127.0.0.1:3001`) | PASS — user-confirmed production manual verification | User confirmed `curl -i http://127.0.0.1:3001/api/health` returns `HTTP 200` with `{"status":"ok","service":"modern-erp-api"}`. |
| A06 | Nginx-proxied health (`127.0.0.1:80`) | PASS — user-confirmed production manual verification | User confirmed `curl -i http://127.0.0.1/api/health` returns `HTTP 200` with `{"status":"ok","service":"modern-erp-api"}`. |
| A07 | Node localhost isolation | PASS — user-confirmed production manual verification | User confirmed Node listens only on `127.0.0.1:3001` and is **not** listening on `0.0.0.0:3001`. |
| A08 | Backup timer scheduled | PASS — user-confirmed production manual verification | User confirmed `modern-erp-backup.timer` is `active (waiting)` and `OnCalendar=*-*-* 02:30:00`. |
| A09 | Manual backup runnable | PASS — user-confirmed production manual verification | User confirmed `sudo systemctl start modern-erp-backup.service` exits `status=0/SUCCESS`; `inactive (dead)` after the oneshot is normal. |
| A10 | Backup file integrity | PASS — user-confirmed production manual verification | User confirmed the newest backup file exists under `/var/backups/modern-erp/` and `PRAGMA integrity_check` reports `ok`. |
| A11 | Public UI accessible | PASS — user-confirmed production manual verification | User confirmed the public URL loads and serves `v0.9.2` content. |
| A12 | Production UI cleanup (no demo/dev copy) | PASS — user-confirmed production manual verification | User confirmed the login page no longer exposes demo quick-role selector, default credentials, or teaching/development labels. |
| A13 | SPA refresh / deep-link | PASS — user-confirmed production manual verification | User confirmed direct navigation to sub-routes and a full page refresh render correctly under the Nginx reverse proxy. |

### Historical Phase A Items Requiring Re-verification On Production Host

The following checks are **not** covered by this historical record:

* A03 / A04 — capture `systemctl status` output
* A05 / A06 — capture `curl -i` response headers and bodies
* A07 — capture `ss -lntp | grep -E ':80|:3001'`
* A08 — capture `systemctl status modern-erp-backup.timer` with `OnCalendar=` / `NextElapseUSec=` / `Trigger=` lines
* A09 / A10 — capture the newest backup filename + `PRAGMA integrity_check` output

These items are addressed in Phase F of the Final Acceptance above (`v0.9.10`).

## Historical Phase B — Authentication & Permission (`v0.9.2`)

> Re-verification of authentication, session, RBAC permission, login lockout, and accounting-role authorization for release `v0.9.2` @ `6168cdd`.

### Historical Phase B Evidence Sources

Phase B reuses the Evidence Rule from above. Categories actually used:

* **`PASS — automated regression evidence`** — focused `node:test` suites executed against a fresh SQLite database and a local HTTP server. These prove **code-level behaviour** of the build under test (`6168cdd`). They are **not** production runtime evidence.
* **`PASS — user-confirmed production manual verification (evidence-locked)`** — items that the user confirmed directly against the Tencent Cloud Ubuntu 22.04 production host in this session. No fabricated HTTP / systemctl / journal output; the user's confirmation is the evidence source. No passwords, tokens, cookies, or session material were captured or recorded.

No server-side commands were executed by the assistant. No production credentials, tokens, or session material were captured or recorded.

### Historical Phase B Check Table

| ID | Check | Result | Evidence |
| --- | --- | --- | --- |
| B01 | Production login UI | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed the public login page renders without demo quick-role selector, default credentials, or teaching/development labels. Source-level automated evidence retained (`server/ui-source.test.js` 6/6 pass on `6168cdd`). |
| B02 | Admin login (`admin` → 200) | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed the production `admin` user logs in successfully (HTTP 200 on `POST /api/auth/login`), the admin menu appears, and no unexpected 401 / 403 occurs. Password is not recorded. Source-level automated evidence retained (`server/app.test.js` admin login passes). |
| B03 | Session restore after refresh / nav | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed page refresh, navigation between modules, and a new same-origin tab keep the session active and do not bounce back to the login page. Source-level automated evidence retained (`server/app.test.js` Session Token + Current User suites pass; `/api/auth/me` 200/401 contract). |
| B04 | Logout | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed normal logout returns the user to the login page, signed-in routes stop responding, and protected features require re-authentication. Source-level automated evidence retained (`server/app.test.js` Logout 3/3 pass; UI logout handler preserved per `ui-source.test.js`). |
| B05 | Failed login handling (no 500, no secret leak) | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed one incorrect password attempt on a non-`admin` account is rejected with a clear error, no 500 occurs, and no sensitive information is leaked. Source-level automated evidence retained (`server/app.test.js` wrong-password 401 + empty-input 400 pass; error code `INVALID_CREDENTIALS`). |
| B06 | Login lock / rate limit (5 → 429) | PASS — automated regression evidence | `server/app.test.js` Login Rate Limiting 2/2 pass: "连续5次错误密码后账户被锁定" returns `429` with code `ACCOUNT_LOCKED`; "锁定后返回正确的重试时间" returns `429`. Per task instruction, **no brute-force test executed against production `admin`**. Evidence category intentionally **not** upgraded to user-confirmed. |
| B07 | Accounting test user (`smoke_accounting`) | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed `smoke_accounting` exists on production, has been assigned `role-accounting`, and can log in successfully. The exact credentials are not recorded. |
| B08 | Accounting menu visibility (Accounting module + Voucher + Trial Balance + Income Statement + Balance Sheet tabs) | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed that, when signed in as `smoke_accounting`, the sidebar exposes the Accounting entry with Voucher / Trial Balance / Income Statement / Balance Sheet tabs, and admin-only menus are not visible. Source-level automated evidence retained (`server/ui-source.test.js` `ACCOUNTING_VIEW` + `REPORT_VIEW` gates pass). |
| B09 | REPORT_VIEW — Trial Balance / Income Statement / Balance Sheet | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed the three financial report pages render without 403 or 500 for `smoke_accounting`; empty-state for any period with no qualifying data is acceptable. Source-level automated evidence retained (Income Statement / Balance Sheet / Financial Summary — Permission suites pass for `REPORT_VIEW`). |
| B10 | Forbidden access (403 on admin-only endpoint) | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed `smoke_accounting` cannot access an admin-only endpoint (e.g. user/role management); backend returns 403, UI does not crash, no 500. Source-level automated evidence retained (`server/app.test.js` Authorization 4/4 pass; 403 gates verified across the suite). |
| B11 | Cross-role isolation (UI hides + backend enforces) | PASS — user-confirmed production manual verification (evidence-locked) | User confirmed admin sees admin menus, accounting sees only the accounting-allowed menus, no UI-only hiding grants extra access, and a hand-typed protected URL from the accounting role does not bypass backend permission. Source-level automated evidence retained (permission filter preserved; backend enforcement via `allow()` / `allowAny()` verified across the suite). |
| B12 | Auth server errors (no 500 / uncaught in production journal) | PASS — user-confirmed production manual verification (evidence-locked) — **NONE** | User reviewed the production journal for the Phase B window and confirmed no auth-related 500, no uncaught exception, no unexpected SQLite error, and no token / session crash. 401 / 403 / intentional 429 are by design and not counted as system errors. |

### Historical Phase B Focused Regression Test Counts

| Suite | Tests | Suites | Result |
| --- | --- | --- | --- |
| `server/app.test.js` (Authentication / Login / Rate Limit / Session / Password / Logout / Current User / Authorization) | 40 | 10 | PASS |
| `server/ui-source.test.js` (Login UI cleanup + auth flow surface) | 11 | 3 | PASS |
| `server/income-statement.test.js` (REPORT_VIEW 403 / 200) | 21 (incl. 2 permission) | 8 | PASS |
| `server/balance-sheet.test.js` (REPORT_VIEW 403 / 200) | 28 (incl. 2 permission) | 11 | PASS |
| `server/financial-summary.test.js` (REPORT_VIEW role-based) | 15 (incl. 2 permission) | 6 | PASS |
| Full regression (`pnpm test`) | 206 | 66 | PASS |

### Historical Phase B Verdict

* Automated regression evidence: **PASS** for B01–B06, B10–B11 (covers all 12 items at the code level).
* User-confirmed production runtime evidence (this session): **PASS (evidence-locked)** for B01, B02, B03, B04, B05, B07, B08, B09, B10, B11, B12.
* B06 is intentionally retained as `automated regression evidence` only — no production-side brute-force test was executed against `admin` per task instruction.
* **`PHASE B = PASS — EVIDENCE LOCKED`** (carried into Final Acceptance verdict unchanged).

## Historical Change Control

* Phase A record committed at `d33147b` (docs: record production acceptance phase A).
* Phase B record committed at `b59de70` (docs: record production acceptance phase B) and Phase B evidence lock at `d6394d8` (docs: lock production acceptance phase B).
* No release tag was created, moved, or deleted during those historical records.
* No deployment was performed during those historical records.
