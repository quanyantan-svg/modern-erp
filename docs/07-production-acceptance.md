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
* **`MANUAL VERIFICATION REQUIRED`** — items that can only be confirmed by an operator with SSH / browser access to the production server. Not executed in this session; not fabricated.

No server-side commands were executed by the assistant. No production credentials, tokens, or session material were captured or recorded.

### Phase B Check Table

| ID | Check | Result | Evidence |
| --- | --- | --- | --- |
| B01 | Production login UI | PASS — automated regression evidence | `server/ui-source.test.js` 6/6 production-cleanup tests pass: no demo credentials, no demo quick-login UI, no hardcoded default passwords, no dev environment copy, no hardcoded topbar eyebrow. Local code = production build (`6168cdd`). Browser-level confirmation at the public URL: `MANUAL VERIFICATION REQUIRED`. |
| B02 | Admin login (`admin` → 200) | PASS — automated regression evidence | `server/app.test.js` "admin账号登录成功" passes; "Token可重复使用" passes; "有权限用户可访问dashboard" passes. Production admin password is unknown and not recorded here: `MANUAL VERIFICATION REQUIRED` for the actual production credential. |
| B03 | Session restore after refresh / nav | PASS — automated regression evidence | `server/app.test.js` Session Token suite (4/4) + Current User suite (3/3) pass; `/api/auth/me` correctly returns 200 with valid token and 401 without. Frontend restore path (`App.jsx` `useEffect → /api/auth/me`) preserved (`ui-source.test.js` "Auth flow surface preserved"). Browser refresh on production: `MANUAL VERIFICATION REQUIRED`. |
| B04 | Logout | PASS — automated regression evidence | `server/app.test.js` Logout suite 3/3 pass: token logout → 204, token-less logout → 204, "登出后Token失效" confirms session destroyed. UI logout handler preserved (`ui-source.test.js` "Auth flow surface preserved"). Production logout at `/api/auth/logout`: `MANUAL VERIFICATION REQUIRED`. |
| B05 | Failed login handling (no 500, no secret leak) | PASS — automated regression evidence | `server/app.test.js` "错误密码登录失败返回401", "错误账号登录失败返回401", "空用户名登录失败返回400", "空密码登录失败返回400" all pass; error code is `INVALID_CREDENTIALS`. Production smoke confirmation: `MANUAL VERIFICATION REQUIRED`. |
| B06 | Login lock / rate limit (5 → 429) | PASS — automated regression evidence | `server/app.test.js` Login Rate Limiting 2/2 pass: "连续5次错误密码后账户被锁定" returns `429` with code `ACCOUNT_LOCKED`; "锁定后返回正确的重试时间" returns `429`. Per task instruction, no brute-force test executed against production `admin`. |
| B07 | Accounting test user (`smoke_accounting`) | MANUAL VERIFICATION REQUIRED | No `smoke_accounting` user exists in production yet. Seeded `accounting` user (Phase 2A demo seed) does **not** exist on production because `NODE_ENV=production` + `ERP_SEED_DEMO=false` blocks demo seeding. Per Phase 2C-1, only the admin created via `scripts/setup-admin.mjs` exists. Creating a dedicated acceptance accounting user requires `setup-admin` + a follow-up user-creation step (admin UI or `scripts/setup-admin.mjs`-style tool) on the production host — out of reach without SSH. |
| B08 | Accounting menu visibility (Accounting module + Voucher + Trial Balance + Income Statement + Balance Sheet tabs) | PASS — automated regression evidence | `server/ui-source.test.js` "Permission-based navigation logic (navGroups + can) preserved" passes; asserts presence of `ACCOUNTING_VIEW` and `REPORT_VIEW` permission gates in `App.jsx` `navGroups`. `role-accounting` permissions in `server/db.js` include `ACCOUNTING_VIEW` and `REPORT_VIEW`. Sidebar rendering for the actual accounting user on production: `MANUAL VERIFICATION REQUIRED`. |
| B09 | REPORT_VIEW — Trial Balance / Income Statement / Balance Sheet | PASS — automated regression evidence | `server/income-statement.test.js` Income Statement — Permission 2/2 pass (403 without, 200 with). `server/balance-sheet.test.js` Balance Sheet — Permission 2/2 pass (403 without, 200 with). `server/financial-summary.test.js` Financial Summary — Permission 2/2 pass (accounting role → 200, warehouse role → 403). All three financial reports enforce `REPORT_VIEW` server-side. Production browser access by `smoke_accounting`: `MANUAL VERIFICATION REQUIRED`. |
| B10 | Forbidden access (403 on admin-only endpoint) | PASS — automated regression evidence | `server/app.test.js` Authorization suite 4/4 pass: "有权限用户可访问dashboard", "无权限用户访问受保护资源返回403", "admin可访问users管理", "无Token访问受保护资源返回401". Across the suite, 403 responses are asserted at multiple permission gates (e.g. `app.test.js:190` users-manage 403 for non-admin). Production call from accounting user to admin-only endpoint: `MANUAL VERIFICATION REQUIRED`. |
| B11 | Cross-role isolation (UI hides + backend enforces) | PASS — automated regression evidence | Permission filter in `App.jsx` (`navGroups.flatMap(...).filter(can)`) is preserved per `ui-source.test.js`. Backend enforcement: every protected handler uses `allow()` / `allowAny()` from `server/lib/http.js`; 403 verified across the suite for every role-permission mismatch tested. UI hiding is **not** the only gate (confirmed by code). Production cross-role browser comparison: `MANUAL VERIFICATION REQUIRED`. |
| B12 | Auth server errors (no 500 / uncaught in production journal) | MANUAL VERIFICATION REQUIRED | `sudo journalctl -u modern-erp.service --since "30 minutes ago" -l --no-pager` cannot be executed from this Windows dev environment. The production-side host's systemd journal must be inspected directly. Automated suite coverage during this Phase B session reported `0 failed / 206 passed`, which covers code paths but not the running production process. |

### Focused Regression Test Counts (Phase B)

| Suite | Tests | Suites | Result |
| --- | --- | --- | --- |
| `server/app.test.js` (Authentication / Login / Rate Limit / Session / Password / Logout / Current User / Authorization) | 40 | 10 | PASS |
| `server/ui-source.test.js` (Login UI cleanup + auth flow surface) | 11 | 3 | PASS |
| `server/income-statement.test.js` (REPORT_VIEW 403 / 200) | 21 (incl. 2 permission) | 8 | PASS |
| `server/balance-sheet.test.js` (REPORT_VIEW 403 / 200) | 28 (incl. 2 permission) | 11 | PASS |
| `server/financial-summary.test.js` (REPORT_VIEW role-based) | 15 (incl. 2 permission) | 6 | PASS |
| Full regression (`pnpm test`) | 206 | 66 | PASS |

### Items That Must Be Re-Run On Production Host Before Phase B Can Be `evidence-locked`

The following require direct operator action against the Tencent Cloud Ubuntu 22.04 host. They are explicitly **not** executed in this session:

* **B07** — create a `smoke_accounting` user (admin login → user management → create user → assign `role-accounting`), then log in as that user.
* **B01 (browser)** / **B02 (production credential)** / **B03 (browser refresh)** / **B04 (browser logout)** / **B05 (production smoke)** / **B08 (sidebar render)** / **B09 (production HTTP round-trip)** / **B10 (production HTTP round-trip)** / **B11 (cross-role browser)** — manual browser / Network-tab checks at the public URL.
* **B12** — `sudo journalctl -u modern-erp.service --since "30 minutes ago" -l --no-pager` on the production host.

### Phase B Verdict

* Automated regression evidence: **PASS** for B01–B06, B10–B11.
* Manual production runtime verification: **REQUIRED** for B01 (browser), B02 (production credential), B03 (browser refresh), B04 (browser logout), B05 (production smoke), B07, B08 (browser), B09 (browser), B10 (browser/HTTP), B11 (browser), B12.
* Phase B is therefore recorded as **PASS based on automated regression evidence** with the explicit list above of items that still require production-side operator action before final acceptance can be promoted to `evidence-locked`.

## Change Control

* This document was added in commit pending (Phase A acceptance record) — no code, schema, or deployment configuration was modified.
* No release tag was created, moved, or deleted.
* No deployment was performed.