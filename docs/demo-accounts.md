# Modern ERP — Demo / Test Account Guide (Teacher-Facing)

> Status: Post-v1.0.0 Teacher Acceptance — Business Document Integrity Stabilization. 教师可见功能以当前 `src/App.jsx` 与 `server/db.js` 为准；AR/AP/收付款已明确延后，不再作为演示页面。

---

## 0. Five-Role Overview Matrix

The system ships exactly **five (5) seeded roles** in `server/db.js → seedSchema()`. Each test account below is bound to exactly one of these roles; **no new role** is introduced.

| # | Account | Role (code / 中文) | Main Responsibility | Key Capabilities | Key Restrictions |
|---|---|---|---|---|---|
| 1 | `test_admin` | `ADMIN` / 系统管理员 | Full system administration | All modules visible; user / role management; voucher approval; period closing; production order state machine | Cannot bypass backend authorization (admins are full but UI / API still apply business rules such as `creator_id !== approver_id`) |
| 2 | `test_sales` | `SALES` / 销售专员 | Customer & order front-line work | Customers, suppliers, products, sales orders (create / submit), purchase orders (create / submit), inventory, returns, **CRM (Contacts / Follow-ups / Sales Activities)** | No approve / reject authority; no accounting; no production order; no IQC / OQC; no Cost; no system |
| 3 | `test_reviewer` | `REVIEWER` / 销售主管 | Approve / reject submitted orders | Approvals (sales + purchase approve / reject), read-only master data, inventory visibility | No order create; no submit (only approve / reject); no accounting; no production order; no IQC / OQC; no Cost; no CRM; no system |
| 4 | `test_warehouse` | `WAREHOUSE` / 仓库管理员 | Warehouse + inventory ops + IQC / OQC | Warehouses (manage), inventory, purchase receipts, sales deliveries, returns, inventory transfers / checks, **IQC / OQC inspections (read + write)** | No customer / product (master-data) write; no orders; no accounting; no Cost; no CRM; no production order; no system |
| 5 | `test_accounting` | `ACCOUNTING` / 财务专员 | Financial voucher entry, submission, reporting | Manual voucher create / submit / edit (ENTERED + REJECTED); financial reports (Trial Balance / Income Statement / Balance Sheet); cash / bank / bills / fixed assets view; period view (read-only) | **No `VOUCHER_APPROVE`** — cannot post vouchers; cannot close or reopen periods; creator ≠ approver rule applies; **no Cost** (PENDING); no IQC / OQC; no CRM; no system |

> Cross-role permission maps (full enumeration) are derived verbatim from `server/db.js → PERMISSIONS` and `rolePermissions` (`server/db.js:1126-1137`).

---

## 1. Role 1 — `test_admin`

**Username**: `test_admin`

**Role**: `ADMIN` (`role-admin`) / 系统管理员

**Role purpose**: Full single-tenant administrator. Owns user / role management, period management, master-data maintenance, and serves as the independent approver for vouchers and purchase orders when no separate approver role exists.

**Permission registry** — all 93 permissions are registered in `server/db.js → PERMISSIONS`; the role sections below list each account's grants:

Every permission code registered in the system is granted to `role-admin` via `'role-admin': all`. The inventory family includes `INVENTORY_VIEW`, `INVENTORY_CHECK_CREATE`, **`INVENTORY_CHECK_APPROVE`**, `INVENTORY_TRANSFER_CREATE`, and `INVENTORY_TRANSFER_APPROVE`. Stocktake approval is intentionally not granted to creator roles.

**Main accessible modules** (sidebar / `src/App.jsx navGroups`): 工作台, 销售订单, 订单审核, 采购订单, 供应商, 客户, 货品, 仓库, 库存查询, 采购入库, 销售出库, 退货管理, 库存流水, **会计凭证** (full: 凭证 / 报表 / 会计期间), 现金日记账, 银行账户, 票据管理, 固定资产, BOM清单, 生产工单, 标准成本, 费用项目, IQC来料检验, OQC出货检验, 项目立项, 任务管理, 工时记录, 联系人管理, 客户跟进, 销售活动, 通知中心, 审批流, **用户与角色**. AR/AP/收付款不在当前演示导航中。

**Main operations**:
- Create / edit / disable users (`POST /api/users`, `PATCH /api/users/:id`, gated by `USERS_MANAGE`)
- Create / edit roles and assign permissions (`POST /api/roles`, `PATCH /api/roles/:id`, gated by `ROLES_MANAGE`)
- Approve / reject submitted vouchers (`POST /api/accounting-vouchers/:id/approve|reject`)
- Initialize / close / reopen accounting periods (`POST /api/period-closures`, `POST /api/period-closures/:id/close|unclose`)
- Production order state machine (`POST /api/production-orders/:id` action=start|complete|cancel)

**Restricted operations**:
- Backend business invariants still apply: an admin **cannot approve their own voucher** (creator/approver separation, `server/app.js:1610-1627`). Backend rejects with 403.
- An admin **cannot create a voucher in a CLOSED period** (`checkPeriodNotClosedForVoucher` in 6 write entry points).

**Recommended demo scenario** (3–6 steps):
1. Log in with `test_admin`.
2. Open **系统管理 → 用户与角色** and confirm all 5 demo accounts appear.
3. Open **财务资金 → 会计凭证 → 会计期间**, select `2026-09`, verify the 3-row checklist renders.
4. Approve a voucher that `test_accounting` previously submitted (visible in 凭证列表).
5. Close `2026-09` after checklist passes; create a voucher with date `2026-09-15` — observe HTTP 409 (business-level rejection, not 500).
6. Reopen `2026-09`; verify the same voucher can be created again.

**Permission delta vs other roles**:
- vs `test_reviewer`: also gets `*_MANAGE` on master data + everything in 财务 / 生产 / 项目 / CRM / 系统 / OA.
- vs `test_accounting`: also gets `VOUCHER_APPROVE` and `PERIOD_CLOSE_MANAGE` and `USERS_MANAGE` / `ROLES_MANAGE`.
- vs `test_sales` / `test_warehouse`: gets every management capability those roles don't have (approvals, master-data writes, period management, system settings).

---

## 2. Role 2 — `test_sales`

**Username**: `test_sales`

**Role**: `SALES` (`role-sales`) / 销售专员

**Role purpose**: Day-to-day customer-facing work: maintain customers, create and submit sales + purchase orders, watch their own submissions. Cannot approve anything.

**Permission list** (verbatim from `rolePermissions['role-sales']`, `server/db.js:1130`):

`DASHBOARD_VIEW`, `SUPPLIERS_VIEW` / `SUPPLIERS_MANAGE`, `CUSTOMERS_VIEW` / `CUSTOMERS_MANAGE`, `PRODUCTS_VIEW`, `ORDERS_VIEW` / `ORDERS_CREATE` / `ORDERS_SUBMIT`, `PURCHASE_ORDERS_VIEW` / `PURCHASE_ORDERS_CREATE` / `PURCHASE_ORDERS_SUBMIT`, `WAREHOUSES_VIEW`, `INVENTORY_VIEW`, `INVENTORY_CHECK_CREATE`, `INVENTORY_TRANSFER_CREATE`, `PURCHASE_RECEIPTS_VIEW` / `PURCHASE_RECEIPTS_MANAGE`, `SALES_DELIVERIES_VIEW` / `SALES_DELIVERIES_MANAGE`, `RETURNS_VIEW` / `RETURNS_MANAGE`, **`CRM_VIEW` / `CRM_MANAGE`** *(added by `71208cb` CRM Stabilization)*.

**Main accessible modules**: 工作台, 销售订单 (create + submit), 采购订单 (create + submit), 供应商, 客户, 货品, 仓库, 库存查询, 采购入库, 销售出库, 退货管理, 库存流水, **联系人管理, 客户跟进, 销售活动** *(added by `71208cb` CRM Stabilization)*.

**Main operations**:
- Create / submit sales orders (`POST /api/orders`, `POST /api/orders/:id/submit`)
- Create / submit purchase orders (`POST /api/purchase-orders`, `POST /api/purchase-orders/:id/submit`)
- Manage customers (`POST /api/customers`, `PATCH /api/customers/:id`)
- Manage suppliers (`POST /api/suppliers`, `PATCH /api/suppliers/:id`)
- Create purchase receipts, sales deliveries, returns and inventory checks / transfers

**Restricted operations**:
- **No `ORDERS_APPROVE` / `ORDERS_REJECT` / `PURCHASE_ORDERS_APPROVE`** — sales owns creation + submission; another role approves
- No accounting, no production orders, no BOM management, no period closing, no user / role management
- No cash / bank / bills / fixed assets (no `CASH_JOURNALS_*`, no `BANK_ACCOUNTS_*`, no `BILLS_*`, no `FIXED_ASSETS_*`)
- No `INVENTORY_MANAGE` (cannot directly edit inventory rows; can only record receipts / deliveries / transfers / checks through business documents)

**Recommended demo scenario** (3–6 steps):
1. Log in with `test_sales`.
2. Open **销售订单 → 新建**, create a sales order with one line item, save as draft.
3. Click **提交** on the new order; status flips to SUBMITTED.
4. Confirm the sidebar — notice that **订单审核** module does NOT appear (no approval permission).
5. Open **客户**, create a new customer; confirm it appears in the list.
6. Attempt to navigate by URL hash to `approvals`; observe the page resets to the first allowed module (UI side hides it, server side would 403 if forced via API).

**Permission delta vs other roles**:
- vs `test_reviewer`: holds `*_SUBMIT` but not `*_APPROVE` — separation of duties for order approval.
- vs `test_warehouse`: also gets `ORDERS_*` + `PURCHASE_ORDERS_*` + customer/supplier create.
- vs `test_accounting`: covers trade documents; has zero accounting permissions.

---

## 3. Role 3 — `test_reviewer`

**Username**: `test_reviewer`

**Role**: `REVIEWER` (`role-reviewer`) / 销售主管

**Role purpose**: Approval-tier role. Reads orders, approves or rejects submitted sales + purchase orders. Cannot create new orders.

**Permission list** (verbatim from `rolePermissions['role-reviewer']`, `server/db.js:1131`):

`DASHBOARD_VIEW`, `CUSTOMERS_VIEW`, `PRODUCTS_VIEW`, `ORDERS_VIEW` / `ORDERS_APPROVE`, `PURCHASE_ORDERS_VIEW` / `PURCHASE_ORDERS_APPROVE`, `WAREHOUSES_VIEW`, `INVENTORY_VIEW`, `PURCHASE_RECEIPTS_VIEW`, `SALES_DELIVERIES_VIEW`, `RETURNS_VIEW`.

**Main accessible modules**: 工作台, **订单审核** (visible because reviewer holds `ORDERS_APPROVE`), 销售订单 (read-only via `ORDERS_VIEW`), 采购订单 (read-only via `PURCHASE_ORDERS_VIEW`), 客户 (read-only), 货品 (read-only), 仓库, 库存查询, 采购入库 (read-only), 销售出库 (read-only), 退货管理 (read-only).

**Main operations**:
- Approve / reject submitted sales orders (`POST /api/orders/:id` `action=approve|reject`)
- Approve / reject submitted purchase orders (`POST /api/purchase-orders/:id` `action=approve|reject`)
- Read-only access to all trade documents (orders, purchase orders, receipts, deliveries, returns)

**Restricted operations**:
- **No `ORDERS_CREATE` / `ORDERS_SUBMIT` / `PURCHASE_ORDERS_CREATE` / `PURCHASE_ORDERS_SUBMIT`** — reviewer cannot create new orders.
- **No `*_MANAGE` master data writes** (no `CUSTOMERS_MANAGE` / `SUPPLIERS_MANAGE` / `PRODUCTS_MANAGE` / `WAREHOUSES_MANAGE`).
- No accounting, no production orders, no periods.

**Recommended demo scenario** (3–6 steps):
1. Log in with `test_reviewer`.
2. Confirm the **订单审核** module is visible.
3. Pick a sales order that `test_sales` previously submitted (status `SUBMITTED`).
4. Approve it (status flips to APPROVED); on a different order, click **驳回** and supply a reason.
5. Open **销售订单** and confirm the list reflects the new statuses, but the **新建** button is hidden (no `_CREATE`).
6. Try to navigate to **会计凭证**; observe the page falls back to the first permitted module (UI hides the link, backend 403).

**Permission delta vs other roles**:
- vs `test_sales`: trade-off `_SUBMIT` for `_APPROVE`. Same read-only master data; no writes.
- vs `test_accounting` / `test_warehouse`: no accounting, no warehouse writes.
- vs `test_admin`: no master-data writes, no system settings, no period / voucher management.

---

## 4. Role 4 — `test_warehouse`

**Username**: `test_warehouse`

**Role**: `WAREHOUSE` (`role-warehouse`) / 仓库管理员

**Role purpose**: Run the warehouse. Manage warehouses, perform inventory checks / transfers, confirm purchase receipts, ship sales deliveries, process returns.

**Permission list** (verbatim from `rolePermissions['role-warehouse']`, `server/db.js:1132`):

`DASHBOARD_VIEW`, `PRODUCTS_VIEW`, `WAREHOUSES_VIEW` / `WAREHOUSES_MANAGE`, `INVENTORY_VIEW`, `INVENTORY_CHECK_CREATE`, `INVENTORY_TRANSFER_CREATE`, `INVENTORY_TRANSFER_APPROVE`, `PURCHASE_RECEIPTS_VIEW` / `PURCHASE_RECEIPTS_MANAGE`, `SALES_DELIVERIES_VIEW` / `SALES_DELIVERIES_MANAGE`, `RETURNS_VIEW` / `RETURNS_MANAGE`, **`IQC_VIEW` / `IQC_MANAGE` / `OQC_VIEW` / `OQC_MANAGE`** *(added by `939fd15` Quality Stabilization)*.

**Main accessible modules**: 工作台, 仓库 (manage), 库存查询, 库存流水, 采购入库 (manage), 销售出库 (manage), 退货管理, **IQC来料检验, OQC出货检验** *(added by `939fd15` Quality Stabilization)*.

**Main operations**:
- Create / edit warehouses (`POST /api/warehouses`, `PATCH /api/warehouses/:id`)
- Confirm purchase receipts (`POST /api/purchase-receipts/:id`)
- Confirm sales deliveries (`POST /api/sales-deliveries/:id`)
- Confirm returns (purchase / sales returns)
- Create, edit and submit inventory checks; approval is performed by `test_admin` with `INVENTORY_CHECK_APPROVE`
- Create inventory transfers (`POST /api/inventory-transfers`)

**Restricted operations**:
- **No customer / supplier / product master-data writes** (no `*_MANAGE` on master data outside warehouses; `PRODUCTS_VIEW` is read-only).
- No order creation or approval (`ORDERS_*` / `PURCHASE_ORDERS_*` not granted).
- No accounting (`ACCOUNTING_VIEW` / `VOUCHER_*` / `REPORT_VIEW` not granted).
- **No Cost** (`COST_VIEW` / `COST_MANAGE` not granted).
- **No CRM** (`CRM_VIEW` / `CRM_MANAGE` not granted — CRM is owned by `role-sales`).
- No production orders, no period closing, no user / role management.

**Recommended demo scenario** (3–6 steps):
1. Log in with `test_warehouse`.
2. Open **仓库**; confirm the warehouse master list is editable.
3. Open **采购入库**; pick a receipt that `test_sales` (or admin) created and click **确认** to flip it from draft to confirmed.
4. Open **库存查询** or **库存流水**; confirm inventory rows reflect the receipt's quantity change.
5. Open **库存调拨**; create a transfer between two warehouses.
6. Attempt to navigate to **会计凭证**; observe UI hides the link (no `ACCOUNTING_VIEW`).

**Permission delta vs other roles**:
- vs `test_sales`: same warehouse / receipts / deliveries / returns, but lacks customer / supplier / orders / purchases. Holds warehouse create (sales does not); `test_warehouse` also owns IQC / OQC (sales does not).
- vs `test_reviewer` / `test_accounting`: reviewer's not a warehouse account; accounting has zero warehouse role.

---

## 5. Role 5 — `test_accounting`

**Username**: `test_accounting`

**Role**: `ACCOUNTING` (`role-accounting`) / 财务专员

**Role purpose**: Enter financial transactions. Create manual vouchers, submit them for approval, edit / resubmit after rejection, view financial reports. **Cannot approve / post** vouchers; cannot close / reopen periods. The independent approver is the `ADMIN` role.

**Permission list** (verbatim from `rolePermissions['role-accounting']`, `server/db.js:1129`):

`DASHBOARD_VIEW`, `ACCOUNTING_VIEW`, `VOUCHER_SUBMIT`, `REPORT_VIEW`, `ORDERS_VIEW`, `PURCHASE_ORDERS_VIEW`, `CASH_JOURNALS_VIEW` / `CASH_JOURNALS_MANAGE`, `BANK_ACCOUNTS_VIEW` / `BANK_ACCOUNTS_MANAGE`, `BILLS_VIEW` / `BILLS_MANAGE`, `FIXED_ASSETS_VIEW` / `FIXED_ASSETS_MANAGE`.

**Main accessible modules**: 工作台, **会计凭证** (full: 凭证 / 利润表 / 资产负债表 / 试算平衡表 / 会计期间 [read-only — no `PERIOD_CLOSE_MANAGE`]), 现金日记账, 银行账户, 票据管理, 固定资产, 销售订单 (read-only), 采购订单 (read-only). AR/AP/收付款页面已延后。

**Main operations**:
- Create manual voucher (`POST /api/accounting-vouchers`, status ENTERED)
- Edit ENTERED / REJECTED voucher (`PATCH /api/accounting-vouchers/:id` — backend resets REJECTED → ENTERED)
- Submit voucher (`POST /api/accounting-vouchers/:id/submit`, requires `VOUCHER_SUBMIT`)
- Delete ENTERED / REJECTED voucher (`DELETE /api/accounting-vouchers/:id`)
- Manage cash journals (`CASH_JOURNALS_MANAGE`), view / manage bank accounts (`BANK_ACCOUNTS_*`), view / manage bills (`BILLS_*`), view / manage fixed assets (`FIXED_ASSETS_*`)
- Run **Trial Balance / Income Statement / Balance Sheet / Financial Summary** queries (requires `REPORT_VIEW`, granted to this role by the Phase 2C financial-reporting consistency update)

**Restricted operations**:
- **No `VOUCHER_APPROVE`** — `accounting` cannot post its own vouchers; an independent `ADMIN` (or another `VOUCHER_APPROVE`-holding role) must approve. Backend enforces `creator_id !== approver.id` (`server/app.js:1626`), so even if the same human account were reused, an admin cannot approve their own voucher.
- **No `PERIOD_CLOSE_MANAGE`** — period closing is administrative. `accounting` can **view** the 会计期间 tab (because `PERIOD_CLOSE_VIEW` is **not** granted here — the tab itself is hidden for `accounting`) but cannot close / reopen.
- No `ORDERS_CREATE` / `ORDERS_SUBMIT` / `ORDERS_APPROVE` / `PURCHASE_ORDERS_*` writes — orders are read-only via `_VIEW`.
- No `*_MANAGE` on customers / suppliers / products / warehouses.
- No production order, no BOM, no system settings, no user / role management.

**Recommended demo scenario** (3–6 steps):
1. Log in with `test_accounting`.
2. Open **会计凭证 → 凭证列表**; click **＋ 新建凭证**.
3. Fill a balanced voucher (debit 1001 库存现金 ¥10,000 / credit 6001 主营业务收入 ¥10,000); save (status ENTERED).
4. Open the new voucher and click **提交**; status flips to SUBMITTED.
5. Open **会计期间** tab — **note**: the tab is hidden because `accounting` has neither `PERIOD_CLOSE_VIEW` nor `PERIOD_CLOSE_MANAGE`; close-period buttons are not reachable. (If the tab is visible in some scenarios, only read-only state is shown.)
6. Open **试算平衡表 / 利润表 / 资产负债表** with `period=2026-09`; observe the financial reports (Trial Balance, Income Statement, Balance Sheet) render with the new POSTED data once `test_admin` approves the voucher.

**Permission delta vs other roles**:
- vs `test_sales` / `test_reviewer` / `test_warehouse`: owns accounting (`ACCOUNTING_VIEW`, `VOUCHER_SUBMIT`, `REPORT_VIEW`) and treasury (cash / bank / bills / fixed assets); lacks customer/supplier/order/warehouse management.
- vs `test_admin`: lacks `VOUCHER_APPROVE`, `PERIOD_CLOSE_MANAGE`, `USERS_MANAGE`, `ROLES_MANAGE`, master-data `_MANAGE` outside treasury, and production permissions.
- vs `test_reviewer` (closest peer in side-by-side comparison): both have VIEW-only on orders and purchases; the difference is `test_accounting` operates the ledger, `test_reviewer` operates the order approvals.

---

## 6. Permission Differences (Side-by-Side Summary)

| Capability (derived from real code) | test_admin | test_sales | test_reviewer | test_warehouse | test_accounting |
|---|---|---|---|---|---|
| Order create | ✓ | ✓ | — | — | — |
| Order submit | ✓ | ✓ | — | — | — |
| Order approve / reject | ✓ | — | ✓ | — | — |
| Customer create / edit | ✓ | ✓ | — | — | — |
| Supplier create / edit | ✓ | ✓ | — | — | — |
| Warehouse create / edit | ✓ | — | — | ✓ | — |
| Confirm purchase receipts | ✓ | ✓ | — | ✓ | — |
| Create / submit inventory checks | ✓ | ✓ | — | ✓ | — |
| Approve submitted inventory checks | ✓ | — | — | — | — |
| Production order create / start / complete | ✓ | — | — | — | — |
| IQC / OQC inspection (create + edit + complete) | ✓ | — | — | ✓ | — |
| CRM (Contacts / Follow-ups / Sales Activities) | ✓ | ✓ | — | — | — |
| Manual voucher create / submit | ✓ | — | — | — | ✓ |
| Voucher approve (`VOUCHER_APPROVE`) | ✓ | — | — | — | — |
| Period close / reopen | ✓ | — | — | — | — |
| Trial Balance / Income Statement / Balance Sheet | ✓ | — | — | — | ✓ |
| Cash / bank / bills / fixed assets | ✓ | — | — | — | ✓ |
| User / role management | ✓ | — | — | — | — |
| Standard Cost / Cost Rate manage | ✓ | — | — | — | — |

---

## 7. Recommended Demo Flow (End-to-End)

If the teacher / reviewer wants a single demonstrative path that exercises all five roles in order, the simplest sequence is:

1. **Login as `test_sales`** → create customer, create + submit sales order.
2. **Login as `test_reviewer`** → approve the order from step 1 (rejection flow also possible).
3. **Login as `test_warehouse`** → confirm the corresponding purchase receipt / sales delivery in the receiving module.
4. **Login as `test_accounting`** → create a manual voucher tied to the trade document, submit it.
5. **Login as `test_admin`** → independently approve the voucher (creator ≠ approver); open 会计期间 and close / reopen the period to demonstrate the period protection workflow.

This sequence shows the **separation of duties** at every layer (order approval, voucher approval, period closing) plus a full trade-to-accounting-voucher trace.

---

## 8. Testing Notes

- The five demo accounts above are used **only for acceptance review and teacher-side verification**. They are **not** production users; production access is via `setup-admin.mjs` + the existing `admin` account seeded by the project's bootstrap sequence.
- Different accounts deliberately show **different menus and different action buttons**. This is the intended RBAC behaviour:
  - `test_admin` sees every module and every write button.
  - `test_sales` has no **订单审核** module in the sidebar (no `_APPROVE`).
  - `test_reviewer's` sidebar hides **新建销售订单** (no `_CREATE`).
  - `test_warehouse` has no **客户** / **会计凭证** in the sidebar.
  - `test_accounting` has no **订单审核**, **会计期间 close/reopen**, or **系统管理** module.
- Front-end UI hiding is **convenience only**. The backend re-checks every permission through `allow(actor, ...)` / `allowAny(actor, [...])` — `server/lib/http.js:12-20`. Hand-typed API calls against a forbidden endpoint return HTTP 403 even if the UI hides the link.
- Demo passwords are **provided separately by the project owner** (out of band) and are **never** stored in this repository, in `setup-admin.mjs`, in production database files, or in any deployed artefact. Do not paste real passwords into this guide.
- Demo accounts are intended for read-and-correct acceptance tests. The accounts do not include destructive operations beyond what their roles permit (no plan to delete master data, no plan to overwrite the `admin` user, no plan to alter role / permission tables).

---

## 9. Security

- This document intentionally contains **no plaintext password**, no password hash, no token, no API key, no SSH key, no production secret, and no private-credential value. Any password used during acceptance review is communicated by the project owner through a separate channel.
- Password storage in the system uses **scrypt + 16-byte random salt** (`server/db.js:101-104` `hashPassword`). Plaintext passwords are never persisted; the existing demo `admin / admin123` etc. were seeded only in **dev / test** environments (the `seedDemoData()` path is gated by `shouldSeedDemoData()` in `server/db.js:1210-1214`, which is **disabled** under `NODE_ENV=production`).
- The five `test_*` accounts must each hold a **strong password (≥ 12 characters)** distinct from any of the weak demo passwords listed in `scripts/setup-admin.mjs → WEAK_DEMO_PASSWORDS`. The project owner retains sole knowledge of these passwords.

---

## 10. Account Creation

> **No production-side change is performed by this guide.** The canonical account-creation method for non-admin roles is described below for the project owner / operator. Creation must occur against the agreed-upon target environment (production or staging) by an account that already holds `USERS_MANAGE` (i.e. `admin`, or another operator-level user specifically created for this purpose).

### Method A — Production-staging UI (preferred for non-admins)

1. As `admin`, navigate to **系统管理 → 用户与角色**.
2. Click **新建用户**.
3. Fill the form:
   - **登录账号**: `test_admin` / `test_sales` / `test_reviewer` / `test_warehouse` / `test_accounting` (lowercase, ASCII letters and digits only — enforced by `requiredCode` in `server/lib/http.js:51-57`).
   - **用户姓名**: e.g. `测试 - 系统管理员`, `测试 - 销售专员`, `测试 - 销售主管`, `测试 - 仓库管理员`, `测试 - 财务专员`.
   - **初始密码**: a strong password supplied by the project owner (≥ 12 chars, not in `WEAK_DEMO_PASSWORDS`).
   - **角色**: pick the corresponding existing role from the dropdown — **do not create a new role** (the dropdown only shows existing seeded roles; that is by design).
4. Click 保存. Backend handler is `POST /api/users` (`server/app.js:589-603`), gated by `USERS_MANAGE`.

### Method B — Canonical HTTP API (for scripted provisioning)

Equivalent to Method A; both routes go through the same `createUser` handler. Run from the production host against the running service (`http://127.0.0.1:3001` directly, or via the public Nginx URL).

* `POST /api/users` with `Authorization: Bearer <admin-token>` and JSON body:
  ```json
  {
    "username": "test_sales",
    "displayName": "测试 - 销售专员",
    "password": "<provided-by-project-owner>",
    "roleId": "role-sales"
  }
  ```
* Repeat for each of the 5 roles, swapping `username`, `displayName`, and `roleId`. Expected response: `HTTP 201 { "id": "user-..." }`. Audit row `CREATE / USER / <userId>` is written into `audit_logs` (`server/app.js:601`).
* Backend validation (`server/app.js:589-603` + `server/lib/http.js:51-66`):
  * `username` must match `^[A-Za-z0-9_-]+$` (digits / letters / `_` / `-`).
  * `password` ≥ 6 chars (UI / API contract — **but the project owner's chosen password must additionally be ≥ 12 chars**, not in the weak set, per § 9 Security).
  * `roleId` must exist in `roles` table (`ensureRole()`).
  * Existing usernames are rejected by the primary-key / unique constraint on `users.username`.

### Method C — First administrator only

* For **initial production bootstrap**, the project uses `node scripts/setup-admin.mjs --username admin --password <secret>` (`scripts/setup-admin.mjs`). This tool is intentionally scoped to the **ADMIN** role only and to **first-admin** use; it is **not** suitable for creating `test_sales` / `test_reviewer` / `test_warehouse` / `test_accounting`. Use Method A or B for those.

### Production Effect Summary

- **No new role** is added. The 5 seeded roles in `server/db.js → seedSchema()` are reused as-is.
- **No permission** is added / removed / renamed. The `rolePermissions` map is unchanged.
- **No schema change**. The `users`, `roles`, `role_permissions` tables are unchanged.
- **The existing production `admin` account is not modified, disabled, or password-reset**.
- The five `test_*` accounts are pure additions with `active = 1`. They live alongside any existing admin / production accounts without interfering with them.

> After the project owner runs Method A or B against the target environment, `test_admin` / `test_sales` / `test_reviewer` / `test_warehouse` / `test_accounting` can immediately log in through the production URL with their assigned passwords (provided separately).

---

## 11. Scope and Change Control

* This document is the **only** artefact produced by this work item. It modifies no business code, no permission code, no role definition, no schema, no migration, no test, no Nginx / systemd / backup config, no styles. It introduces no new permission and no new role.
* `v0.9.10` / `v1.0.0` release tags remain in their original positions on the immutable git history.
* The canonical accept-loop approval evidence — `docs/07-production-acceptance.md` and `docs/00-project-status.md` — is **not** altered by the publication of this guide. If the project owner subsequently decides to record demo-account acceptance in the project status log, that addition is handled in a dedicated commit.
