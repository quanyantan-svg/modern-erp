# Domain Alignment — Requirement

> 状态：`ACTIVE`
> Owner：Platform / Domain Alignment
> 权威来源：`document.md` §27
> 来源：`document.md` §27（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## 27. Domain Alignment Requirement（8 Domains + Platform）

### 27.1 Audit baseline and coverage decision

本阶段以 Core Scope Cleanup 冻结后的真实仓库为基线：47 条 enabled route、5 条 disabled route、现有 API/schema/state/permission/transaction/audit 合同均为兼容边界。审计发现当前业务能力已存在，但 Registry 仍以 `master-data / sales / production / purchasing / inventory / analytics` 及若干 cross-domain 变体表达旧产品归属；Launcher 仍是 6 个业务组加 utility 组；`projects-workflow.jsx` 与 `server/modules/business.js` 的文件名已不能表达其仅剩的 Platform 职责。

本阶段 Coverage 为现有能力的 ownership alignment，不改变 `document.md §22` 的 22 本手册 Coverage 结论：

- Registry / Launcher / Desktop taxonomy：`SEMANTIC_MISMATCH`，需对齐 8 Domains + Platform；
- Notifications / Workflow 前后端 owner：`SEMANTIC_MISMATCH`，需拆入明确 Platform owner；
- `extended.js` / `commercial-golive.js` / `financial-inventory.js` / `server/app.js`：`PARTIAL` ownership，只有无需解释业务合同的安全边界才允许本轮移动，其余必须登记技术债；
- 新 ERP Capability：`OUT_OF_SCOPE`。

### 27.2 Product architecture

Canonical product architecture 固定为：

1. `master-engineering` — Master & Engineering；
2. `sales-customer` — Sales & Customer；
3. `planning` — Planning；
4. `procurement-outsourcing` — Procurement & Outsourcing；
5. `manufacturing-quality` — Manufacturing & Quality；
6. `inventory-warehouse` — Inventory & Warehouse；
7. `finance-operations` — Finance Operations；
8. `accounting-analytics` — Accounting & Analytics；
9. `platform` — Platform 横向能力，不作为第九个普通 Business Launcher group。

### 27.3 Ownership principles

- 每个 active capability 与 route 必须只有一个 primary Target Domain；
- Platform 可提供 auth、RBAC、approval、notification、workflow foundation、lifecycle、audit、numbering、error/request contract 等横向服务，但不拥有 Sales Order、Purchase Order、Inventory Movement、Voucher Posting 等业务事实；
- 同一 mutable business fact 不允许两个 Domain 同时成为 active canonical owner；
- Customer 归 Sales & Customer，Supplier 归 Procurement & Outsourcing，Warehouse 归 Inventory & Warehouse；
- BOM/Routing/Work Center 表达“如何生产”，归 Master & Engineering；Forecast/MRP/Instruction 表达“生产/采购什么、何时”，归 Planning；Production Order/Issue/Receipt/Inspection 表达执行，归 Manufacturing & Quality；
- Sales Invoice/AR/Collection/Supplier Bill/AP/Payment/Treasury/Cost 归 Finance Operations；Voucher/GL/Statements/Decision Reports/Auxiliary Accounting 归 Accounting & Analytics；
- owner alignment 不等于 Manual capability coverage closure，不得据此把任何 `MISSING` 改为 `COVERED`。

### 27.4 Compatibility requirement

本阶段必须保持：

- 47 enabled + 5 disabled route inventory 与全部 route key；
- direct URL、refresh、Back/Forward 与既有 target/query contract；
- 全部 HTTP method/path、request/response/status/error contract；
- SQLite/MySQL schema、table/column/FK，不新增 migration；
- permission、RBAC/SOD、state machine、transaction、idempotency 与 audit 语义；
- MobileShell 现有 5 个 global tab；
- workflows `enabled: false`；
- Core Scope Cleanup 删除结果，不恢复 projects/tasks/timesheets/CRM contacts/followups/activities。

### 27.5 Information architecture requirement

- Business Launcher 恰好投影 8 个非空 Domain group；disabled route 不得进入 active launcher；
- Platform route 只通过 global、profile/system、messages、approvals 或 contextual surface 暴露；
- 同一 route 的多入口 target（例如 Sales Return / Purchase Return、Decision Reports）保持；
- Desktop navigation 使用同一 canonical taxonomy 投影，不维护第二套 ownership source；
- canonical domain constants 必须 single-source、exported、testable。

### 27.6 Required ownership cleanup

- 前端将 Notifications 与 Workflows 从误导性的 `projects-workflow.jsx` 拆入 coherent Platform page module；
- 后端将四个通知/工作流 handler 从误导性的 `business.js` 拆入 coherent Platform module，并建立单一 dispatch owner；
- `extended.js`、`commercial-golive.js`、`financial-inventory.js` 与 `server/app.js` 的未拆责任必须有明确 Target Domain 和 `KEEP_TEMPORARY_WITH_DEBT` 原因，禁止标为 UNKNOWN；
- 不为填满 Domain 创建空目录，不进行 `server/domains/*` big-bang migration。

### 27.7 Completion and acceptance

- 所有 active/disabled routes 的 domain 都属于 canonical set；active Registry 不再使用旧 taxonomy 或 cross-domain 变体；
- 每项当前 active capability 都能追溯到 Target Domain、frontend route、API family、backend owner、permission family 与 primary tests；
- Finance/Accounting、Engineering/Planning/Manufacturing、Platform/business fact 边界清楚；
- 新增 pure source-contract architecture tests，并纳入 FAST + FULL；
- `pnpm test:fast`、`pnpm test`、`pnpm build`、`git diff --check` 全部通过；
- 只有用户最终 Acceptance PASS 后，本 Domain Alignment 才能 Freeze 并进入 B3101。

### 27.8 Explicit non-goals

本阶段不新增 B3101–B3122 缺失能力，不实施 Quotation、Credit、Pricing、Sourcing、Outsourcing、Barcode/PDA、ECO、Advanced Scheduling、Generic Workflow、Smart Accounting、Management Accounting、Multi-Organization、Multi-Currency；不修改 schema/migration，不执行 Unit F，不 push/tag/deploy。

---

**DOCUMENT BASELINE — DOMAIN ALIGNMENT REQUIREMENT APPROVED FOR AUTHORIZED DESIGN & IMPLEMENTATION**

---
