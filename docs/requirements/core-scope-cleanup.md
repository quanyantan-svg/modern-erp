# Core Scope Cleanup — Requirement

> 状态：`ACTIVE`
> Owner：Platform / Core Scope Cleanup
> 权威来源：`document.md` §26
> 来源：`document.md` §26（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 26. Core Scope Cleanup Implementation Acceptance Criteria

本节固化 Core Scope Cleanup 实施阶段的 Requirement Acceptance Criteria。本节必须先于 Implementation 完成；设计见 `solution.md §21`。

### 26.1 Active capability removal

以下 capability 不再是 active product capability：

- `projects`
- `tasks`
- `timesheets`
- `contacts`（CRM extension）
- `followups`
- `activities`

具体删除对象：

- active Route；
- Launcher / navigation / desktop group exposure；
- executable frontend surface（Screen 与 Modal）；
- 6 项 API family（GET / POST / PATCH / DELETE）；
- extension-specific handler；
- extension-specific active permission；
- extension-specific tests；
- stale metadata / source-contract references。

### 26.2 Explicitly protected

以下能力必须保护，禁止误删或破坏：

- **Platform Notification**
  - `notifications` Route；
  - `src/pages/projects-workflow.jsx::Notifications`；
  - 移动端 `messages` Tab；
  - `GET /api/notifications`、`POST /api/notifications/read`；
  - `notifications` 表；
  - `listNotifications` / `markNotificationRead`。
- **Platform Workflow（DISABLED）**
  - `workflows` Route（保持 `enabled: false`）；
  - `src/pages/projects-workflow.jsx::Workflows / WorkflowModal`；
  - `GET /api/workflows`、`POST /api/workflows`；
  - `approval_workflows` 表；
  - `listWorkflows` / `createWorkflow`；
  - `WORKFLOW_VIEW` / `WORKFLOW_MANAGE` permission；
  - 通用 `src/components/MobileWorkflowProgress.jsx` 组件；
  - 本阶段不开放、不重构、不删除 Generic Workflow 仍由 B3122 推进。
- **Core Customer / Supplier Contact**
  - `customers.contact` / `customers.phone` / `customers.address`；
  - `suppliers.contact` / `suppliers.phone` / `suppliers.address` / `suppliers.email`；
  - 当前 `customers` / `suppliers` 表 master contact 字段。
- **Project Accounting（不同于 Project Management）**
  - `PROJECTS_VIEW` / `PROJECTS_MANAGE` permission；
  - `aux_projects` 表；
  - `GET /api/aux-projects`、`POST /api/aux-projects`、`listAuxProjects` / `createAuxProject`；
  - `accounting_entries.project_id` 列。
- **Legacy Tables**
  - `contacts`、`customer_followups`、`sales_activities`、`projects`、`project_tasks`、`project_timesheets` 表继续存在；
  - 历史数据保留；
  - 本阶段禁止 `DROP TABLE` / `DELETE FROM` / `TRUNCATE`；
  - 不迁移、不转换、不清空。
- **Lifecycle Legacy Reference Guards**
  - `server/modules/data-lifecycle.js` 中四条 legacy FK 引用必须保留：
    - `customer.dependencies` 中的 `['contacts','customer_id']`；
    - `customer.dependencies` 中的 `['customer_followups','customer_id']`；
    - `customer.dependencies` 中的 `['projects','customer_id']`；
    - `supplier.dependencies` 中的 `['contacts','supplier_id']`；
  - 理由：表与 FK 仍存在，lifecycle 提前移除会从 `RECORD_REFERENCED` 退化为数据库 FK error。

### 26.3 Expected active route count

当前 Audit 基线：

- enabled routes：53；
- disabled routes：5。

删除 6 项 Extension Route 后，预期 Registry 重新计算结果：

- enabled routes：`53 - 6 = 47`；
- disabled routes：5。

最终数字以 Implementation 时 Registry 真实计算为准，不得使用全局字符串替换 `53 → 47`；任何与预期不符必须先解释差异。

### 26.4 Acceptance Criteria

#### Product

- 6 个 Extension 不再有 active user surface；
- Project / CRM launcher entry 不再出现；
- 不存在空的 `utility-extension` launcher group；
- Project / CRM desktop group 不再暴露；
- 47 enabled + 5 disabled 经 Registry 真实计算确认；
- direct URL / refresh / Back / Forward 对剩余 route 仍正确。

#### Platform

- notifications 桌面端、移动端 `messages` Tab 正常工作；
- workflows 仍保持 `enabled: false`，且其 API/table/permission/symbol 全部保留；
- `MobileWorkflowProgress` 组件继续存在且可被其它业务页面引用。

#### Core

- `customers.contact` / `customers.phone` / `customers.address` 字段保留并被客户列表页展示；
- `suppliers.contact` / `suppliers.phone` / `suppliers.address` / `suppliers.email` 字段保留；
- `aux_projects` 表与 `/api/aux-projects` API 保留；
- `PROJECTS_VIEW` / `PROJECTS_MANAGE` permission 保留；
- `accounting_entries.project_id` 列保留。

#### Backend

- 6 个 Extension API family 不再 active；
- `GET /api/users/lookup` 与 `listProjectManagerCandidates` 不再注册；
- core lookup（`/api/lookup/customers`、`/api/lookup/suppliers` 等）保持；
- `business.js` 仅保留 Platform 部分（`listNotifications` / `markNotificationRead` / `listWorkflows` / `createWorkflow`）；
- 真实 grep 证明无 Project / CRM Extension handler 调用链残存。

#### Data

- 不 DROP table；
- 不删除 legacy rows；
- SQLite/MySQL schema 在本阶段不修改；
- `data-lifecycle.js` 四条 legacy reference 仍存在；
- 数据库 destructive operation 仍受保护。

#### Test

- `scripts/testing/test-suites.js` manifest 不含 stale path；
- 测试集中不存在 `/api/users/lookup` stale continuity assertion；
- route metadata contract 测试真实反映新 registry；
- 14+ 受影响的测试文件已同步更新或删除；
- `pnpm test:fast` PASS；
- `pnpm test` PASS；
- `pnpm build` PASS；
- `git diff --check` PASS；
- `server/test-suite-governance.test.js`（governance self-test）仍 PASS。

### 26.5 Out of Scope（本阶段不实施）

- Unit F Legacy Schema Cleanup（DROP TABLE / 数据迁移 / SQLite/MySQL 双路径 migration）；
- Domain Alignment（`projects-workflow.jsx` 文件改名、logical ownership 重新组织、Frontend 主导航按 8 Domains 重组）；
- B3101–B3122 Capability Closure；
- Generic Workflow 实现；
- 新增任何 CRM / Project / Quotation / Pricing / Credit / Outsourcing 能力；
- 删除既有 release tag。

---

**DOCUMENT REQUIREMENTS BASELINE — CORE SCOPE CLEANUP REQUIREMENT READY FOR DESIGN & IMPLEMENTATION**
