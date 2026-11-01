# Core Scope Cleanup — Technical Design

> 状态：`ACTIVE`
> Owner：Platform / Core Scope Cleanup
> 权威来源：`solution.md` §21
> 来源：`solution.md` §21（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 21. Core Scope Cleanup Implementation Design

本节固化 Core Scope Cleanup 实施阶段的 Technical Design。Requirement 见 `document.md §26`。本节只规定本阶段实施，未列入的实现属于其它阶段。

### 21.1 总策略

按 `caller proof → canonical owner → cutover → tests` 顺序执行 5 个 Unit。
Unit 间允许合并 git commit，但每 Unit 必须先验证 focused tests 才能进入下一个 Unit。

不允许：

- 整文件删除 `projects-workflow.jsx` / `business.js`；
- 整文件删除前未做 zero-caller proof；
- 引入新 schema / migration；
- `DROP TABLE` / `DELETE FROM` / `TRUNCATE`；
- 修改 `customers.contact` / `suppliers.contact` 等 Core Contact 字段；
- 删除 `PROJECTS_VIEW` / `PROJECTS_MANAGE` / `aux_projects` / `accounting_entries.project_id`；
- 删除 `data-lifecycle.js` 中四条 legacy FK reference；
- 删除 `WORKFLOW_VIEW` / `WORKFLOW_MANAGE` / `notifications` / `approval_workflows`。

### 21.2 Unit A — Frontend Registry / Navigation Cleanup

#### 范围

- `src/navigation/applicationRegistry.js`；
- `src/navigation/applicationMetadata.js`（派生）；
- `src/navigation/presentationMetadata.js`（派生）；
- `src/App.jsx` 中 `launcherIconNames` 数组；
- `src/components/icons.jsx`；
- `src/styles.css`。

#### 删除目标

从 active routes / launcher / desktop group / contextual route / screen definitions / screen-loader references 移除：

- `projects`
- `tasks`
- `timesheets`
- `contacts`
- `followups`
- `activities`

#### 衍生删除

- `utility-extension` 整组 launcher entry（如果删除后变空）；
- `DESKTOP_GROUP_ORDER` 中 `项目管理` 与 `CRM客户关系`；
- `CONTEXTUAL_ROUTES` 中 `tasks`、`timesheets`；
- `SCREEN_DEFINITIONS` 中 6 项；
- `loadScreenModule` switch 中 6 个 case。

#### 保护

- `notifications` Route + mobile `messages` Tab；
- `workflows` DISABLED Route + 已注册的 screen；
- 8 个 active 业务域 route 不受影响；
- 5 个 disabled route 中的 `cash-journals` / `bills` / `fixed-assets` / `data-cleanup` 不受影响。

#### 风险

- `v17-p0-frontend-application-architecture.test.js` 中 53/5 等数字断言需真实重算；
- `MOBILE_COMMON_PRIORITY` 不含 6 项，预期无变化；
- 数字不得全局字符串替换，必须由 Registry 计算。

#### 测试

- `server/v17-p0-frontend-application-architecture.test.js` 中路由数 / contextual 数；
- `server/v16-p8-flow-consistency.test.js` 中 contextual count 与 launcher 检查；
- `server/mobile-application-launcher.test.js` CRM launcher describe；
- `server/mobile-shell.test.js` 应用列表断言；
- `server/v15-d10-final-ux-acceptance.test.js`、`server/v16-p1-mobile-enterprise-foundation.test.js` route 列表。

### 21.3 Unit B — CRM Frontend Removal

#### 范围

- 删除整文件 `src/pages/crm.jsx`（zero-caller proof 后）；
- 删除整文件 `src/components/MobileCrmApplication.jsx`（zero-caller proof 后）。

#### 保护

- `src/components/MobileWorkflowProgress.jsx`（通用 Platform 工作流可视化，与 CRM 完全无关）继续存在。

#### 衍生删除

- `src/components/icons.jsx` 中 `contacts` / `followups` / `activities` 三项；
- `src/styles.css` 中 `.mobile-crm-application__tabs*` 与 `.contacts-v15` 整段（保留 `.notifications-v15`）；
- `applicationRegistry.js` `loadScreenModule` 中 `crm.jsx` / `MobileCrmApplication.jsx` 两个 case。

#### 风险

- `server/crm-stabilization.test.js` 整文件删除；
- `server/v12-premium-visual-round2.test.js` 中 ordinaryFilterPages 列表删除 crm.jsx；
- `server/badge-defect.test.js` 注释与 page list 调整；
- `server/ui-source.test.js` 删除 `crm.jsx` 存在性与相关 `contacts:` defaultScreen 断言；
- `server/v15-d7-master-config-ux.test.js` 删除 contacts subordinate 测试。

### 21.4 Unit C — Project Frontend Mixed-owner Cleanup

#### 范围

`src/pages/projects-workflow.jsx` 中按符号级删除：

- `Projects`；
- `ProjectModal`；
- `ProjectDetailModal`；
- `ProjectTasks`；
- `TaskModal`；
- `Timesheets`；
- `TimesheetModal`。

#### 保留

- `Notifications`；
- `Workflows`；
- `WorkflowModal`。

#### 不在本阶段

- 重命名 `projects-workflow.jsx`（推迟到 Domain Alignment）。

#### 风险

- `server/project-manager.test.js` 整文件删除；
- `server/phase-d-hfix.test.js` 中 Blocker 1（Project create blank screen）describe 删除；
- `server/v15-d9-extension-system-ux.test.js` 中 `projects` / `project-tasks` / `timesheets` shell class 断言删除；
- `server/ui-source.test.js` 中 `Projects` / `ProjectTasks` / `Timesheets` 三个 export 断言删除（保留 `Notifications` / `Workflows`）。

### 21.5 Unit D — Backend Active API Cleanup

#### `server/modules/business.js`

删除：

- `SALES_ACTIVITY_STATUSES` 常量；
- `text` / `optionalId` / `nonNegativeInteger` / `requireDate` / `optionalDate` helper；
- `salesActivityInput` helper；
- `listContacts` / `createContact` / `updateContact` / `deleteContact`；
- `listFollowups` / `createFollowup` / `updateFollowup`；
- `listSalesActivities` / `createSalesActivity` / `updateSalesActivity` / `deleteSalesActivity`；
- `listProjects` / `createProject` / `updateProject` / `getProjectDetail`；
- `listProjectTasks` / `createProjectTask` / `updateProjectTask`；
- `listTimesheets` / `createTimesheet` / `deleteTimesheet`；
- 上述 handler 真正使用的 import（`HttpError` 等仍保留于 Platform 部分）。

保留：

- `listNotifications` / `markNotificationRead`；
- `listWorkflows` / `createWorkflow`；
- 上述 handler 真正需要的 import（`audit`、`allow` / `allowAny`、`readJson`、`send`）。

文件继续命名 `business.js`；改名属于 Domain Alignment。

#### `server/app.js`

删除：

- 顶部 `import { ... } from './modules/business.js'` 中所有 CRM/Project/Task/Timesheet handler；
- `pathname === '/api/users/lookup'` 路由；
- `listProjectManagerCandidates` 函数定义；
- 相关注释（line 230、line 259-260、line 799、line 900、line 1531-1540、line 4473 等涉及 aux-projects / users/lookup 的注释保留 aux-projects 部分）；
- handleApi dispatch 中：
  - `/api/projects` GET / POST；
  - `/api/projects/:id` GET / PATCH；
  - `/api/project-tasks` GET / POST；
  - `/api/project-tasks/:id` PATCH；
  - `/api/timesheets` GET / POST；
  - `/api/timesheets/:id` DELETE；
  - `/api/contacts` GET / POST；
  - `/api/contacts/:id` PATCH / DELETE；
  - `/api/customer-followups` GET / POST；
  - `/api/customer-followups/:id` PATCH；
  - `/api/sales-activities` GET / POST；
  - `/api/sales-activities/:id` PATCH / DELETE；
- handleApi dispatch 中 `/api/notifications`、`/api/workflows` 保留。

#### 保护

- `/api/aux-projects` GET / POST；
- `/api/notifications` GET；
- `/api/notifications/read` POST；
- `/api/workflows` GET / POST；
- 其它 Core ERP Route 不变；
- `listAuxProjects` / `createAuxProject`（extended.js）；
- `listProjectManagerCandidates` 是 Project-only lookup helper，本阶段删除。

#### 风险

- `server/app.test.js` 中 “扩展业务模块在全新数据库中完成迁移并可查询” describe 中 `/api/contacts`、`/api/projects` 必须移除，保留 `/api/notifications`、`/api/aux-projects`；
- 任何 source-contract 测试中 `/api/users/lookup` 必须改为与 `/api/users` 真实契约一致。

### 21.6 Unit E — Permissions / Lookups / Test Governance / Docs

#### 21.6.1 Permissions

`server/db.js`：

- 从 `PERMISSIONS` 数组删除：
  - `CRM_VIEW`；
  - `CRM_MANAGE`；
  - `PROJECT_VIEW`；
  - `PROJECT_MANAGE`。
- 保留：
  - `PROJECTS_VIEW`；
  - `PROJECTS_MANAGE`；
  - `WORKFLOW_VIEW`；
  - `WORKFLOW_MANAGE`；
  - 所有 Core ERP permission。
- `rolePermissions.role-sales` 数组删除 `CRM_VIEW` / `CRM_MANAGE`。
- 本阶段不修改 `role_permissions` 数据库 destructive cleanup；遗留 rows 仅作为 audit 残留记录，未来 Unit F 决定清理方式。

#### 21.6.2 Lookups

`server/modules/lookups.js`：

- `listSupplierLookup` 的 `allowAny` 中删除 `CRM_VIEW`、`CRM_MANAGE`；
- `listCustomerLookup` 的 `allowAny` 中删除 `CRM_VIEW`、`CRM_MANAGE`；
- 保留 `PURCHASE_RECEIPTS_MANAGE` / `RETURNS_MANAGE` / `SALES_DELIVERIES_MANAGE` / `ORDERS_CREATE`。

#### 21.6.3 Lifecycle

`server/modules/data-lifecycle.js`：

- **NO CHANGE**（保留四条 legacy reference guard）。

#### 21.6.4 Tests 删除

整文件删除：

- `server/project-manager.test.js`（417 行，仅服务 Projects）；
- `server/crm-stabilization.test.js`（352 行，仅服务 CRM Extension）。

#### 21.6.5 Tests 修改

- `server/phase-d-hfix.test.js`：删除 Blocker 1（lines 72–134）describe；保留 Blocker 2 与 Production Order 测试；
- `server/v17-p0-frontend-application-architecture.test.js`：删除 6 项 route 相关字符串，重算 enabled 数；
- `server/v16-p8-flow-consistency.test.js`：删除 6 项 launcher route，调整 contextual count 与注释；
- `server/v15-d9-extension-system-ux.test.js`：调整 projects / project-tasks / timesheets shell class 断言（保留 notifications / followups / sales-activities 待其它 unit 完成后删除）；
- `server/teacher-acceptance-matrix.test.js`：删除 CRM workflow 三测试 + 多个黑名单引用；
- `server/mobile-shell.test.js`：从应用列表删除 6 项，保留 notifications / workflows；
- `server/mobile-application-launcher.test.js`：删除 CRM launcher items describe；
- `server/v15-d7-master-config-ux.test.js`：删除 contacts subordinate 测试；
- `server/v15-d10-final-ux-acceptance.test.js`：删除 6 项 route 列表引用；
- `server/v16-p1-mobile-enterprise-foundation.test.js`：删除 6 项 route 列表引用；
- `server/ui-source.test.js`：删除 Projects / ProjectTasks / Timesheets export 断言、`contacts:` defaultScreen 断言、`pages/crm.jsx` 存在性断言；
- `server/v12-premium-visual-round2.test.js`：删除 crm.jsx 引用；
- `server/badge-defect.test.js`：删除 projects-workflow.jsx 引用；
- `server/app.test.js`：扩展业务模块 API 列表删除 `/api/contacts`、`/api/projects`；
- `server/v2-wave3e-users-ownership.test.js`：删除或修改 `/api/users/lookup` continuity 断言；
- `server/route-table.test.js`：删除 `/api/users/lookup` legacy continuity 注释与断言；
- `server/phase-e-inventory-migration.test.js`：删除注释中 projects / CRM 引用；
- `server/decision-reports.test.js` 等无 Extension 引用：核实无影响。

#### 21.6.6 Test Suite Manifest

`scripts/testing/test-suites.js`：

- 删除 manifest 中 `server/project-manager.test.js`；
- 删除 manifest 中 `server/crm-stabilization.test.js`；
- 保持 `FAST ⊆ FULL`、`FULL ∩ HEAVY = ∅`、`ALL = FULL ∪ HEAVY`；
- `server/test-suite-governance.test.js`（FAST self-test）无需修改逻辑，但运行时通过 `validate()` 自动重算。

#### 21.6.7 运维文档

`docs/operations/testing.md`：

- 在 testing matrix 中删除 `project-manager.test.js` 与 `crm-stabilization.test.js` 的 KEEP/FULL 登记；
- 其它 manifest 数量根据真实 registry / file count 重算；
- 不得修改 `docs/archive/*`。

### 21.7 实施顺序与回归 gate

实施按 Unit A → B → C → D → E 顺序：

```text
1. Requirement (document.md §26)
2. Design (solution.md §21)
3. Unit A: frontend registry
4. Unit B: CRM frontend removal
5. Unit C: projects-workflow.jsx extraction
6. Unit D: business.js + app.js cutover
7. Unit E: permissions + lookups + tests + docs
8. Focused tests
9. Full regression
10. pnpm build
11. git diff --check
12. Acceptance self-audit
13. log append
14. local Chinese commit
```

最低回归 gate（跨域 / canonical metadata 变更）：

```bash
pnpm test
pnpm build
git diff --check
```

### 21.8 Out of Scope（本阶段不实施）

- Unit F Legacy Schema Cleanup（DROP TABLE / SQLite + MySQL 双路径 migration / 数据保留与导出）；
- Domain Alignment（`projects-workflow.jsx` 改名、前端 logical ownership 按 8 Domains 重组、Frontend 主导航重新组织）；
- B3101–B3122 Capability Closure；
- Generic Workflow；
- 新增任何 Quotation / Pricing / Credit / Outsourcing 能力；
- 删除既有 release tag；
- 任何 push / tag / deploy。

---

**SOLUTION BASELINE — CORE SCOPE CLEANUP DESIGN READY FOR IMPLEMENTATION**
