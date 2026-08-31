# Modern ERP Production Acceptance

> Phase A — Deployment Baseline re-verification record for release `v0.9.2`.

## Release Under Test

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

## Evidence Rule

This record was produced by Claude Code from a **Windows local dev environment** with **no SSH access** to the production server. Per the task Evidence Rule:

* Local repository facts (commit / tag / working tree state) are recorded with **direct, locally-observed evidence**.
* Every server-side runtime check (systemd, Nginx, ports, health endpoints, backups, public UI) is recorded as **`PASS — user-confirmed production manual verification`** because the user explicitly stated *"Phase A 已人工检查正常"* in this session. **No server command output was supplied by the user and none was fabricated by the assistant.**
* Any check that needs fresh server output for Phase B or later phases must be re-run directly on the production host; this record does not substitute for live evidence.

## Phase A — Deployment Baseline

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

### Items that require re-verification on the production host

The following checks are **not** covered by this record and must be re-executed directly on `/opt/modern-erp` (Ubuntu 22.04) by an operator with SSH access before Phase A can be promoted from "user-confirmed" to "evidence-locked":

* A03 / A04 — capture `systemctl status` output
* A05 / A06 — capture `curl -i` response headers and bodies
* A07 — capture `ss -lntp | grep -E ':80|:3001'`
* A08 — capture `systemctl status modern-erp-backup.timer` with `OnCalendar=` / `NextElapseUSec=` / `Trigger=` lines
* A09 / A10 — capture the newest backup filename + `PRAGMA integrity_check` output

## Phase B (not started)

Next phase per the acceptance plan is:

> **Phase B — Authentication & Permission**

This document is **not** a Phase B record. No Phase B checks have been executed.

## Phase B — Authentication & Permission

> Re-verification of authentication, session, RBAC permission, login lockout, and accounting-role authorization for release `v0.9.2` @ `6168cdd`.

### Evidence Sources Used in Phase B

Phase B reuses the Evidence Rule from above. Categories actually used:

* **`PASS — automated regression evidence`** — focused `node:test` suites executed against a fresh SQLite database and a local HTTP server. These prove **code-level behavior** of the build under test (`6168cdd`). They are **not** production runtime evidence.
* **`PASS — user-confirmed production manual verification (evidence-locked)`** — items that the user confirmed directly against the Tencent Cloud Ubuntu 22.04 production host in this session. No fabricated HTTP / systemctl / journal output; the user's confirmation is the evidence source. No passwords, tokens, cookies, or session material were captured or recorded.

No server-side commands were executed by the assistant. No production credentials, tokens, or session material were captured or recorded.

### Phase B Check Table

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

### Focused Regression Test Counts (Phase B)

| Suite | Tests | Suites | Result |
| --- | --- | --- | --- |
| `server/app.test.js` (Authentication / Login / Rate Limit / Session / Password / Logout / Current User / Authorization) | 40 | 10 | PASS |
| `server/ui-source.test.js` (Login UI cleanup + auth flow surface) | 11 | 3 | PASS |
| `server/income-statement.test.js` (REPORT_VIEW 403 / 200) | 21 (incl. 2 permission) | 8 | PASS |
| `server/balance-sheet.test.js` (REPORT_VIEW 403 / 200) | 28 (incl. 2 permission) | 11 | PASS |
| `server/financial-summary.test.js` (REPORT_VIEW role-based) | 15 (incl. 2 permission) | 6 | PASS |
| Full regression (`pnpm test`) | 206 | 66 | PASS |

### Phase B Verdict

* Automated regression evidence: **PASS** for B01–B06, B10–B11 (covers all 12 items at the code level).
* User-confirmed production runtime evidence (this session): **PASS (evidence-locked)** for B01, B02, B03, B04, B05, B07, B08, B09, B10, B11, B12.
* B06 is intentionally retained as `automated regression evidence` only — no production-side brute-force test was executed against `admin` per task instruction.
* **`PHASE B = PASS — EVIDENCE LOCKED`**.

## Change Control

* This document was added in commit pending (Phase A acceptance record) — no code, schema, or deployment configuration was modified.
* No release tag was created, moved, or deleted.
* No deployment was performed.