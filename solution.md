# Modern ERP 技术实现文档

## 1. 文档目的

本文档说明 Modern ERP 如何实现，包括系统结构、模块职责、数据迁移、核心业务规则和验证方式。功能范围与验收标准见 [document.md](./document.md)，运行方式见 [README.md](./README.md)。

## 2. 总体架构

```text
React 页面
    │ JSON / HTTP
    ▼
Node.js API 路由与后端权限校验
    │
    ├─ 业务处理器与状态转换
    ├─ 审计记录
    └─ SQLite 事务与迁移
```

前端负责交互和展示，不直接访问数据库，也不作为权限与金额计算的可信来源。后端完成认证、授权、输入校验、业务计算和事务控制。

## 3. 代码结构与职责

### 3.1 前端

| 路径 | 职责 |
| --- | --- |
| `src/main.jsx` | React 应用入口 |
| `src/App.jsx` | 登录态恢复、导航、页面装配和全局提示 |
| `src/api.js` | Token 管理、统一请求和未认证事件 |
| `src/components/ui.jsx` | 表格、弹窗、工具栏、状态和空数据等公共组件 |
| `src/pages/master-data.jsx` | 工作台、基础资料、订单和用户角色页面 |
| `src/pages/logistics-finance.jsx` | 入出库、退货、库存流水和账款页面 |
| `src/pages/accounting.jsx` | 会计凭证页面 |
| `src/pages/treasury-cost.jsx` | 出纳、银行、票据、资产和成本页面 |
| `src/pages/manufacturing.jsx` | BOM、MRP 和生产工单页面 |
| `src/pages/quality.jsx` | IQC 和 OQC 页面 |
| `src/pages/crm.jsx` | 联系人、跟进和销售活动页面 |
| `src/pages/projects-workflow.jsx` | 项目、任务、工时、通知和审批页面 |

页面通过 `api()` 访问后端。权限菜单由用户权限决定，但真正的授权仍由 API 执行。

### 3.2 后端

| 路径 | 职责 |
| --- | --- |
| `server/index.js` | 创建数据库和 HTTP 服务，处理优雅关闭 |
| `server/app.js` | HTTP 应用入口、认证和主要 API 路由装配 |
| `server/lib/http.js` | JSON 解析、响应、安全头、权限辅助和静态资源服务 |
| `server/lib/audit.js` | 统一写入审计日志 |
| `server/modules/business.js` | CRM、项目、任务、工时、通知和工作流处理器 |
| `server/modules/extended.js` | 财务扩展、MRP、质量、OA、预警和报表处理器 |
| `server/db.js` | SQLite 连接、基础表迁移、兼容列升级和种子数据 |
| `server/migrations/extended-schema.js` | 扩展业务表的幂等迁移 |
| `server/reset-data.js` | 删除本地演示数据库 |

`server/app.js` 仍包含部分基础业务处理器。后续继续重构时，应逐步迁移到按领域划分的模块，避免重新形成单文件聚集。

## 4. 请求处理流程

```text
请求进入
  ├─ OPTIONS：直接返回 204
  ├─ /api/auth/login：校验账号密码并签发 Token
  ├─ 其他 /api/*：认证 Token → 构造用户权限 → 分发业务处理器
  └─ 非 API：从 dist/ 提供静态文件或回退到 index.html
```

异常处理规则：

- 业务输入错误返回 400；
- 未认证返回 401；
- 无权限返回 403；
- 资源不存在返回 404；
- 唯一键冲突返回 409；
- 未预期错误记录到服务端并返回 500。

## 5. 认证、权限与审计

### 5.1 密码与会话

- 密码使用 scrypt 和随机盐生成哈希；
- 登录后生成随机 Token，数据库只保存 SHA-256 Token 哈希；
- 每次受保护请求根据 Token 查询用户、角色和权限；
- 退出时删除对应会话记录。

### 5.2 RBAC

```text
用户 → 角色 → 角色权限关联 → 权限代码
```

`allow()` 校验单项权限，`allowAny()` 校验候选权限集合。新增接口必须在处理器内部声明所需权限，不能只依赖前端隐藏菜单。

### 5.3 审计

关键操作通过 `audit()` 写入操作用户、动作、实体类型、实体 ID、说明和时间。审计失败应使相关事务失败，避免业务成功但轨迹缺失。

## 6. 数据库与迁移

### 6.1 初始化顺序

`createDatabase()` 按以下顺序运行：

1. 打开 SQLite 并启用外键；
2. 启用 WAL 日志模式；
3. 执行基础表迁移；
4. 执行 `migrateExtendedSchema()`；
5. 规范化历史成本费率表；
6. 写入权限、角色、用户和基础演示数据；
7. 为已有数据库补充兼容列并回填必要字段。

迁移使用 `CREATE TABLE IF NOT EXISTS` 和受控列升级，保证全新数据库和已有开发数据库均可启动。

### 6.2 主要数据域

| 数据域 | 代表性表 |
| --- | --- |
| 认证权限 | `users`、`roles`、`permissions`、`role_permissions`、`sessions` |
| 基础资料 | `customers`、`suppliers`、`products`、`warehouses` |
| 销售采购 | `sales_orders`、`sales_order_items`、`purchase_orders`、`purchase_order_items` |
| 库存物流 | `inventory`、`inventory_transactions`、入出库与退货相关表 |
| 财务 | `accounting_subjects`、`accounting_vouchers`、`accounting_entries`、应收应付相关表 |
| 辅助核算 | `departments`、`aux_projects`、`currencies`、`voucher_words` |
| 生产 | `boms`、`production_orders`、`mrp_plans`、`work_centers`、`routing_operations` |
| 质量 | `iqc_inspections`、`oqc_inspections`、`supplier_evaluations` |
| 管理扩展 | `contacts`、`projects`、`project_tasks`、`notifications`、OA 与预警相关表 |
| 审计 | `audit_logs` |

项目辅助核算使用 `aux_projects`，项目管理使用 `projects`，两者用途不同，不得混用。

## 7. 核心实现规则

### 7.1 单据与明细事务

订单、入出库和其他包含明细的单据使用事务写入。后端重新读取货品价格或校验提交值，并重新计算总额，避免依赖前端结果。

### 7.2 状态机

销售和采购订单只允许规定的状态转换。状态处理器在修改前读取当前记录，校验状态、权限及驳回原因，并写入审计信息。

### 7.3 库存

库存以仓库和货品组合维护。采购入库增加库存，销售出库减少库存，退货和调拨根据方向写入对应流水。订单审核只表示业务约定，不直接改变实物库存。

### 7.4 会计与金额

金额统一使用整数分保存。会计凭证包含凭证头和多条分录，业务凭证保留来源类型与来源 ID，便于追溯。财务期间由凭证日期派生并用于报表和期间控制。

### 7.5 MRP

MRP 根据需求来源读取销售订单明细，结合现有库存和计划收货计算净需求，生成 `mrp_plan_items`。计划执行时可将待处理建议转化为采购业务数据。

### 7.6 供应商评分

综合评分计算规则：

```text
综合评分 = 质量 × 40% + 交期 × 30% + 价格 × 20% + 服务 × 10%
```


### 7.7 凭证审核流程

凭证审核是财务模块的状态机扩展，确保 creator 和 approver 角色分离。

#### 状态定义

| 状态 | 说明 | 可执行动作 |
|------|------|------------|
| ENTERED | 录入完成 | submit |
| SUBMITTED | 待审核 | approve / reject |
| POSTED | 已审核 | — |
| REJECTED | 已驳回 | edit 然后 ENTERED |

#### 状态转换规则

- `submitAccountingVoucher`：ENTERED / REJECTED → SUBMITTED；需要 `VOUCHER_SUBMIT` 权限；
- `approveAccountingVoucher`：SUBMITTED → POSTED；需要 `VOUCHER_APPROVE` 权限；审核人不得为凭证创建人；
- `rejectAccountingVoucher`：SUBMITTED → REJECTED；需要 `VOUCHER_APPROVE` 权限；驳回原因必填；
- `updateAccountingVoucher`：REJECTED → ENTERED（自动重置）；ENTERED 可正常修改；SUBMITTED / POSTED 拒绝修改；
- `deleteAccountingVoucher`：仅 ENTERED / REJECTED 可删除；SUBMITTED / POSTED 拒绝删除；

#### 权限设计

- `VOUCHER_SUBMIT`：提交凭证；
- `VOUCHER_APPROVE`：审核和驳回凭证；
- 默认情况下录入人和审核人为不同角色；`creator_id` 记录凭证创建人；`submitted_by` 记录提交人；

#### SQLite 迁移

通过 `migrateVoucherWorkflow()` 完成，兼容已有数据库：

1. 通过 `ALTER TABLE` 添加 `rejection_reason`、`submitted_at`、`submitted_by` 列（如不存在）；
2. 检测 `accounting_vouchers` 表的 CHECK 约束是否包含 `'ENTERED'`；
3. 如不包含，重建表并更新 CHECK 约束为 `CHECK(status IN ('ENTERED','SUBMITTED','POSTED','REJECTED'))`；
4. 重建后保留已有数据，缺失状态字段的记录默认填充为 `'POSTED'`（已有凭证视为已审核）；
5. 幂等执行，已迁移的数据库不会重复迁移；

#### 审计日志

- SUBMIT 操作写入动作 `SUBMIT`，说明包含凭证号；
- APPROVE 操作写入动作 `APPROVE`，记录 `approver_id`；
- REJECT 操作写入动作 `REJECT`，记录驳回原因；
- UPDATE 操作在重新提交时写入说明包含 "重新提交后生效"；

#### 报表过滤行为

- `getTrialBalance()` 和财务汇总接口只查询 `status = 'POSTED'` 的凭证；
- 录入中（ENTERED）和待审核（SUBMITTED）的凭证不参与期间汇总；

#### API 路由

- `POST /api/accounting-vouchers/:id/submit` — 提交凭证
- `POST /api/accounting-vouchers/:id/approve` — 审核凭证
- `POST /api/accounting-vouchers/:id/reject` — 驳回凭证（需 `reason` 字段）
- `PATCH /api/accounting-vouchers/:id` — 修改凭证（仅 ENTERED / REJECTED）
- `DELETE /api/accounting-vouchers/:id` — 删除凭证（仅 ENTERED / REJECTED）

### 7.8 期间关闭流程

期间关闭（Period Closing）是凭证审核之上的财务控制层，确保已结期间内的凭证状态稳定。

#### 期间状态

| 状态 | 说明 |
|------|------|
| OPEN | 未结，可正常录入/修改/审核凭证 |
| CLOSED | 已结，期间内凭证操作被后端拒绝（409 冲突） |

#### 期间表

`period_closures` 表（`server/migrations/extended-schema.js`）：

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `period` | 期间标识，格式 `YYYY-MM`，唯一 |
| `period_year` / `period_month` | 年/月 |
| `closure_type` | `MONTH` / 其他；本阶段仅实现月结 |
| `status` | `OPEN` / `CLOSED` |
| `closed_by` / `closed_at` | 结账人与结账时间 |
| `checklist_passed` | 结账前置检查是否通过 |
| `created_at` | 创建时间 |

#### 结账前置检查

`getPeriodClosureChecklist(db, period)` 检查期间内是否存在以下状态的凭证：

- ENTERED（录入中）—— 必须先提交或删除
- SUBMITTED（待审核）—— 必须先审核或驳回
- REJECTED（已驳回）—— 必须修改并重新提交或删除

任一不通过，结账请求被拒绝（400 错误，包含失败项详情）。

#### 结账 / 反结账事务一致性

`closePeriod` 与 `unclosePeriod` 使用 `transaction(db, ...)` 包装：

1. `UPDATE period_closures SET status=...` —— 状态变更
2. `INSERT INTO audit_logs(...)` —— 写入审计日志（动作 `CLOSE_PERIOD` / `UNCLOSE_PERIOD`）

任意一步失败则整个事务回滚，确保状态变更与审计日志原子。

#### CLOSED 期间凭证保护

凭证的以下操作在执行时调用 `checkPeriodNotClosedForVoucher(db, voucherDate, operation)`：

- `createAccountingVoucher` —— 录入
- `updateAccountingVoucher` —— 修改
- `deleteAccountingVoucher` —— 删除
- `submitAccountingVoucher` —— 提交
- `approveAccountingVoucher` —— 审核
- `rejectAccountingVoucher` —— 驳回

若期间已 CLOSED，操作被拒绝（409 冲突，提示「会计期间 YYYY-MM 已结账，禁止 X 凭证」）。

#### API 路由

- `GET /api/period-closures?year=YYYY` — 列出指定年的期间记录
- `POST /api/period-closures` — 创建期间记录（`year`、`month`）
- `POST /api/period-closures/:id/close` — 结账（执行前置检查 + 状态变更）
- `POST /api/period-closures/:id/unclose` — 反结账
- `GET /api/period-closures/closure-checklist?period=YYYY-MM` — 查询结账前置检查项

#### 报表过滤行为

- 试算平衡表（`getTrialBalance`）、财务汇总（`getFinancialSummary`）、科目余额（`getSubjectLedger`）、日余额（`getDailyBalance`）仅查询 `status = 'POSTED'` 的凭证；
- 已结期间内的 ENTERED / SUBMITTED / REJECTED 凭证不参与期间汇总。

#### 范围限制

- 仅实现月结（`closure_type = 'MONTH'`）；年结 / Year-End Carry Forward NOT_VERIFIED，不在本阶段范围。
评分结果按阈值划分为 A、B、C、D 等级。

## 8. API 设计约定

- 资源列表使用 `GET /api/<resource>`；
- 新建资源使用 `POST /api/<resource>`；
- 局部更新使用 `PATCH /api/<resource>/:id`；
- 状态动作使用 `POST /api/<resource>/:id/<action>`；
- 搜索、状态和日期范围通过查询参数传递；
- 成功响应返回 JSON 对象，错误响应至少包含 `error` 字段。

具体路由以 `server/app.js` 的分发代码为准，文档不重复维护易过期的完整路由表。

## 9. 测试与验证

`server/app.test.js` 使用临时目录和全新 SQLite 数据库启动随机端口服务，当前覆盖：

- 健康检查和生产构建后的静态入口；
- 销售账号登录和工作台访问；
- 普通用户访问管理接口时返回 403；
- CRM、项目、部门、MRP、质量、OA、预警和报表等扩展接口成功迁移并查询。

标准验证命令：

```powershell
pnpm build
pnpm test
```

后续应增加状态机异常、事务回滚、库存不足、凭证平衡、期间关闭和浏览器端到端测试。

## 10. 运维与仓库约定

- `dist/`、`data/`、数据库、日志、备份和 `.env` 不进入 Git；
- 本地数据通过 `pnpm reset-data` 删除并在下次启动时重建；
- 正式环境必须更换演示密码，并补充 HTTPS、密钥管理、备份恢复和监控；
- 代码变化若影响功能范围，应修改 `document.md`；若影响架构或实现，应修改本文档。

## 11. 当前技术边界

- SQLite 和原生 HTTP 服务适合本地验证，正式高并发部署需要重新评估；
- 后端基础业务仍有继续按领域拆分的空间；
- 自动化测试目前以接口冒烟为主，尚未达到完整业务回归覆盖；
- 尚未实现原生产数据迁移和新旧系统总量核对。
