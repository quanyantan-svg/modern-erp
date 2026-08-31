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

## Change Control

* This document was added in commit pending (Phase A acceptance record) — no code, schema, or deployment configuration was modified.
* No release tag was created, moved, or deleted.
* No deployment was performed.