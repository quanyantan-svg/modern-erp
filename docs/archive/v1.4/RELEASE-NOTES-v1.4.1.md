# Modern ERP v1.4.1 Release Notes

> 发布：`v1.4.1`（PATCH over `v1.4.0`）
> 实施 baseline：`ae617b309392e93c9f1740a3563c5f953857099e`
> 测试 fixture 修复：`0dfd0e40a672bdfdaedbf5f2cf016d9cd82e70a9`
> 范围：MySQL existing-database upgrade path hotfix；无新增业务能力、无 API / 前端 / 角色 / 审批族 / schema-intent 变化。

V1.4.1 是一个**严格 PATCH 版本**：不引入新业务对象、新角色、新审批族、新跟踪模型、新期间系统或新 schema intent；只修复 V1.4.0 在既有 MySQL 生产数据库上遗留的真实 wiring 缺口。所有能力仍然依据 `document.md` / `solution.md` §21 已冻结的 V1.4 设计合同；本版本是同一合同下的兼容性补正。

## 1. 修复的真实缺陷

- V1.4.0 部署到已存在的 V1.3 生产 MySQL 后，`bootstrapMySql()` 对每张快照表使用 `CREATE TABLE IF NOT EXISTS`。对已经存在于目标库上的 `inventory_transfers` / `inventory_checks` 而言这是 **no-op**，因此 V1.4-E2 的两条 additive `business_date` 列永远不会写到 live MySQL DDL 上。
- 同时，`bootstrapMySql()` 的 snapshot 行级 `INSERT IGNORE` 循环恰好把 `INVENTORY_TRANSFER_CONFIRM` 权限和对应的 role mapping 灌进老库 —— 这是为什么 v1.4.0 生产上观察到"权限 OK、列缺失"的不对称现象。
- 这是一个 wiring 缺陷，不是迁移实现本身的问题。V1.4-E2 的迁移实现在 fresh bootstrap 路径下完全正确。

## 2. 修复设计

- `server/database/mysql-adapter.js` 的 `createMySqlDatabase()` 在 `bootstrapMySql(adapter, snapshot)` 之后追加一步：直接对 **live adapter** 调用同一份权威 V1.4-E2 迁移实现：
  - `migrateV14E2BusinessDate(adapter)` — additive `business_date` 列；
  - `ensureV14E2ConfirmPermission(adapter)` — `INVENTORY_TRANSFER_CONFIRM` 权限；
  - `ensureV14E2CanonicalRolePermissions(adapter)` — canonical WAREHOUSE role mapping。
- **不复制 SQL、不引入第二套迁移路径**；既有迁移函数自身的 column-existence guard（`PRAGMA table_info`）和 `INSERT OR IGNORE` 已经是幂等的，因此 fresh / V1.3-shaped upgrade / 重复 init 三条路径共用同一份权威代码。
- **不修改 `bootstrapMySql`** 自身，避免把它扩展成不受控的 schema-diff 引擎。
- 完整设计见 `solution.md §21.12.1 [V1.4.1 — DESIGN CLOSURE] MySQL existing-database 升级路径`。

## 3. 交付到既有 MySQL 的两列

- `inventory_transfers.business_date` — nullable TEXT-date；V1.4.1 起在已 bootstrap 的 MySQL 8 数据库上由 live application init 自动落地。
- `inventory_checks.business_date` — 同形、同 nullable 语义。
- 两列在 fresh bootstrap、V1.3-shaped upgrade、重复 init 三条路径下均保持幂等；旧行 `business_date` 保持 `NULL`（"业务日期缺失"），**不回填** `created_at` / `updated_at` / 任何时间戳。

## 4. 权限 / 角色映射（保持不变）

- `INVENTORY_TRANSFER_CONFIRM` 已通过 V1.4.0 snapshot 的 `INSERT IGNORE` 进入生产；V1.4.1 在 production-shaped live adapter 上复用同一权威 seeder，保证 canonical role mapping 在 fresh / upgrade / 重复 init 下都是单一权威结果：
  - `role-warehouse` — 通过 `INVENTORY_TRANSFER_CONFIRM` 获得确认能力；
  - `role-admin` — 通过 canonical 全权限 reconciliation 保留确认能力；
  - `SALES / REVIEWER / ACCOUNTING` — 不获得 `INVENTORY_TRANSFER_CONFIRM`，与 V1.4-E2 / `solution.md §21.8.1` 保持一致。
- 权限 reconciliation 自身是幂等的；第二次 startup 不会产生重复权限或扩大其他角色权限。

## 5. 受限的回归覆盖

新增 `server/mysql-v14-1-hotfix-upgrade-path.integration.js`，注册为受保护 disposable MySQL gate 的首项，共 4 个子测试：

1. V1.3-shaped disposable MySQL 升级路径：`ALTER TABLE ... DROP COLUMN business_date` + 删除 canonical CONFIRM 权限与 role mapping + 插入 legacy DRAFT/SUBMITTED/APPROVED transfer 与 DRAFT check，再 `createDatabase({ backend: 'mysql' })` 一次 —— 验证两列落地且 NULLable、legacy 行保持 NULL、permission 与 `role-admin` / `role-warehouse` 映射正确、SALES/REVIEWER/ACCOUNTING 不扩权、`production_orders.completion_date` / `inventory_transactions.business_date_origin` 不存在、表数量不变。
2. 第二次 `createDatabase({ backend: 'mysql' })` 完全幂等 —— 每张表仍只有一条 `business_date`、`permissions` 计数仍 1、`role_permissions` 仍 2 条、row id multiset 不变、legacy 业务日期仍 NULL、表数量不变。
3. production-shaped safety contract：`upstream_safety` fixture 复现"EXISTING TABLE + ADDITIVE COLUMN + SECOND STARTUP"，验证 `additive_safety` 列不重复、legacy 行 `legacy_value` / `created_at` / `additive_safety=NULL` 在两次 init 后全部保留。
4. fresh MySQL bootstrap 连续 init —— 验证 hotfix 不会扩大成 schema-diff 引擎：连续两次 `createDatabase` 后表数量、列计数、permission 计数保持一致。

## 6. 受保护 disposable MySQL gate 验证

针对本版本新增的 V1.3-shaped upgrade 路径，受保护 disposable gate（`127.0.0.1:3306/modern_erp_e2_test`，reset opt-in `true`）的最终证据：

- focused upgrade-path：`node --test server/mysql-v14-1-hotfix-upgrade-path.integration.js` → 4 / 4 PASS。
- `pnpm test:mysql` → `MYSQL TESTS = PASS`；新增 V1.4.1 upgrade-path 4 / 4 通过；完整 gate 49 / 49 PASS（11 suites）。
- `pnpm test:mysql:concurrency` → 13 / 13 PASS；含
  - 跨进程 E2 transfer confirmation single-effect；
  - concurrent E3 period close 幂等；
  - 40 parallel document allocations unique + idempotent；
  - post-stress invariants 与 canonical `/api/system-health` 在 disposable MySQL 上保持 GREEN without repair。
- 默认 / SQLite：`pnpm test` → **1523 / 1523 PASS**，0 failed / 0 cancelled / 0 skipped / 0 todo；在 **clean environment**（不继承 `ERP_DB_BACKEND=mysql` 等 MySQL integration 变量）下两次重复执行均确认绿色。继承 MySQL integration 变量时 `server/setup-admin.test.js` 出现 8 个失败是 test execution environment contamination（`setup-admin.mjs:72` 从 `process.env.ERP_DB_BACKEND` 推断 backend，污染环境会绕过 `dbPath` 派发到 MySQL），与本次 hotfix 无关，亦在原始 hotfix commit `ae617b3` 上同样出现，已分类为环境问题、不属于产品缺陷。
- `pnpm build` → PASS。
- `git diff --check` → 无输出。

## 7. 显式 NOT-CHANGED 清单

V1.4.1 明确**不**修改下列任何合同：

- **无 ERP 功能新增**；不增加业务对象、不增加新角色、不增加新审批族。
- **无 API 变化**；`POST /api/inventory-transfers/:id/transfer` 仍是唯一 canonical action path；handler / 载荷 / 错误合同 / 权限字符串与 V1.4.0 完全一致。
- **无前端变化**；不修改任何 React 组件、CSS 选择器、路由、导航、状态/动作词或空错载入形态。
- **无角色变化**；五角色 RBAC 不变，`role-reviewer` 内部代码不变。
- **无审批族变化**；审批中心仍只包含 V1.4-C 冻结的五类授权事件。
- **无 schema-intent 变化**；迁移范围仍严格限于 `inventory_transfers.business_date`、`inventory_checks.business_date`、`INVENTORY_TRANSFER_CONFIRM` 权限与 canonical role mapping；不新增 `production_orders.completion_date`、不新增 `inventory_transactions.business_date_origin`、不预建索引。
- **无业务行为变化**；期间关账、跟踪分配、估值、业务日期 resolver、调拨执行语义、销售/采购逐行履约、报表口径均与 V1.4.0 一致。
- **无依赖变化**；不升级、不引入、不删除任何 `dependencies` / `devDependencies` / `optionalDependencies`。

## 8. 升级路径与回滚

- **升级路径**：`git fetch` → 校验 annotated `v1.4.1` tag 与 dereferenced commit → checkout → `pnpm install --frozen-lockfile` → `pnpm build` → 重启 systemd 服务。应用重启时，`createMySqlDatabase()` 自动在 live MySQL adapter 上调用权威 V1.4-E2 迁移实现，无需任何手动 `ALTER TABLE` / `INSERT`。运行 `SELECT business_date FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('inventory_transfers','inventory_checks') AND COLUMN_NAME='business_date'` 与 `SELECT code FROM permissions WHERE code='INVENTORY_TRANSFER_CONFIRM'` 验证落地。
- **回滚路径**：回到 v1.4.0 commit / tag 即可；additive nullable 列与新权限行可保留，无需 `DROP COLUMN` / `DELETE FROM permissions` / 任何破坏性数据库操作；验证过的 pre-upgrade 备份仍可用于极端灾难恢复。

## 9. 关联文档

- 设计：`solution.md` §21.12.1 [V1.4.1 — DESIGN CLOSURE] MySQL existing-database 升级路径。
- 权威迁移实现：`server/migrations/v14-e2-business-date.js`（`migrateV14E2BusinessDate` / `ensureV14E2ConfirmPermission` / `ensureV14E2CanonicalRolePermissions`）。
- Hotfix 接线：`server/database/mysql-adapter.js` `createMySqlDatabase()`。
- 回归覆盖：`server/mysql-v14-1-hotfix-upgrade-path.integration.js`，受 `scripts/gates/mysql-gate.mjs` 列表首项注册。
- 当日日志：`log/2026-09-28.md` V1.4.1 — MySQL V1.3 → V1.4 schema upgrade-path hotfix + 子测试 3 fixture 可移植性修复 段落。
- 历史 release：`docs/archive/v1.4/RELEASE-NOTES.md`（V1.4.0 发布说明，未变动）。