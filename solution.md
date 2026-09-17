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
| 生产 | `boms`、`product_routings`、`product_routing_operations`、`production_orders`、`mrp_plans`；旧 `work_centers` / `routing_operations` 保留兼容 |
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

### 7.9 利润表

利润表（Income Statement / Profit & Loss）将凭证审核 + 期间关闭之上形成的 POSTED 数据，按月份聚合成经营成果。

#### Handler

`getIncomeStatement(db, res, actor, url)` 实现于 `server/modules/extended.js`，权限校验 `REPORT_VIEW`（已存在于 `server/db.js:66`）。

#### SQL 聚合

期间过滤使用 `voucher_date` 范围：

```sql
voucher_date >= period + '-01'
AND voucher_date <= LAST_DAY(period)
```

避免依赖 `accounting_vouchers.period` 列（手工凭证可能为 NULL）。

每科目净额（沿用试算平衡表 / 会计余额的方向规则）：

| Subject Type | 净额 |
|--------------|------|
| REVENUE | `credit_cents - debit_cents` |
| EXPENSE | `debit_cents - credit_cents` |
| ASSET / LIABILITY / EQUITY | 利润表不参与 |

凭证状态过滤：

```sql
accounting_vouchers.status = 'POSTED'
```

排除 ENTERED / SUBMITTED / REJECTED。

#### 期间状态

OPEN / CLOSED 期间均允许查询。利润表 handler **不调用** `checkPeriodNotClosed*` 系列写保护函数（只读操作）。

#### API

```
GET /api/reports/income-statement?period=YYYY-MM
```

- `period` 缺失 → 400
- `period` 非 `YYYY-MM` 格式 → 400
- 无 `REPORT_VIEW` → 403
- 合法请求 → 200

#### Response

```json
{
  "period": "2026-08",
  "periodRange": { "startDate": "2026-08-01", "endDate": "2026-08-31" },
  "revenue": 100000,
  "expense": 60000,
  "profit": 40000,
  "sections": [
    {
      "name": "营业收入",
      "type": "REVENUE",
      "subtotal": 100000,
      "subjects": [
        { "code": "6001", "name": "主营业务收入", "amount": 100000 }
      ]
    },
    {
      "name": "营业成本与费用",
      "type": "EXPENSE",
      "subtotal": 60000,
      "subjects": [
        { "code": "6401", "name": "主营业务成本", "amount": 60000 }
      ]
    }
  ]
}
```

- 金额单位:与项目其它报表一致,使用 `cents`(整数分)
- 零发生额科目不返回
- `sections[]` 顺序固定:REVENUE 在前,EXPENSE 在后

#### Schema 限制

当前 `accounting_subjects.type` 仅支持 `ASSET / LIABILITY / EQUITY / REVENUE / EXPENSE`,**没有独立 COST 类型**。`主营业务成本`（subject-007）当前归类为 EXPENSE,因此利润表展示口径合并为「营业成本与费用」,不强行区分成本 / 销售费用 / 管理费用 / 财务费用。

#### 不在本任务范围

- 本年累计 / 同比 / 环比 / 多月对比
- 资产负债表 / 现金流量表
- 年结 / Year-End Carry Forward
- BI / 自定义报表设计器
- 新增 COST / TAX / SELLING_EXPENSE 等科目类型
- 修改 `createAccountingVoucher` 补 `period` 列

#### UI

最小集成于 `src/pages/accounting.jsx` 报表 tab,沿用现有 API 调用与权限风格。前端隐藏菜单由 `REPORT_VIEW` 控制,但 **API 权限仍是最终安全边界**。

### 7.10 资产负债表

资产负债表（Balance Sheet）反映截至指定期间月末的财务状况，是 as-of / period-end 时点报表，与利润表（period-based）的口径不同。

#### Handler

`getBalanceSheet(db, res, actor, url)` 实现于 `server/modules/extended.js`，权限校验 `REPORT_VIEW`。

#### 期间语义

- 入参：`period=YYYY-MM`
- `asOfDate = LAST_DAY(period)`（月末）
- 所有余额按 `voucher_date <= asOfDate` 累计计算
- 不显示「期初余额」列（资产负债表标准形态，仅显示期末时点）

#### 期末余额计算

沿用 `getAccountingBalances` 的方向规则：

| Subject Type | 净额公式 |
|--------------|---------|
| ASSET | `debit_total - credit_total` |
| LIABILITY | `credit_total - debit_total` |
| EQUITY | `credit_total - debit_total` |

聚合 SQL：

```sql
SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_cents ELSE 0 END) AS credit_total,
SUM(CASE WHEN e.direction = 'DEBIT'  THEN e.amount_cents ELSE 0 END) AS debit_total
FROM accounting_entries e
JOIN accounting_vouchers v ON v.id = e.voucher_id
JOIN accounting_subjects s ON s.id = e.subject_id
WHERE v.status = 'POSTED'
  AND v.voucher_date <= ?
  AND s.type IN ('ASSET', 'LIABILITY', 'EQUITY')
GROUP BY s.id
```

#### 未结转损益（Unclosed Accumulated Profit）

当前系统**没有自动损益结转**机制。`本年利润` 或 `利润分配` 之类的 EQUITY 子科目也不存在。为使扩展恒等式成立，资产负债表引入虚拟行「未结转损益」：

```sql
SELECT
  SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END)
  - SUM(CASE WHEN e.direction='DEBIT'  THEN e.amount_cents ELSE 0 END) AS revenue_net
FROM accounting_entries e
JOIN accounting_vouchers v ON v.id = e.voucher_id
JOIN accounting_subjects s ON s.id = e.subject_id
WHERE v.status = 'POSTED'
  AND v.voucher_date <= ?
  AND s.type = 'REVENUE';

-- 同理 expense_net = debit_total - credit_total (EXPENSE)

unclosed_profit = revenue_net - expense_net
```

**统计范围**：所有 `status='POSTED'` 且 `voucher_date <= asOfDate` 的 REVENUE / EXPENSE 分录。**自数据库可见最早起累计**，不假设会计年度起点为 1 月 1 日（当前 schema 无 fiscal year 字段）。

**该虚拟行不写入数据库**，仅为查询展示用。

#### 扩展会计恒等式

由于未结转损益是虚拟行，标准恒等式 `A = L + E` 在当前系统下形式化为：

```
Assets = Liabilities + Posted Equity + Unclosed Profit
```

#### API

```
GET /api/reports/balance-sheet?period=YYYY-MM
```

- `period` 缺失 → 400
- `period` 非 `YYYY-MM` → 400
- 月份超出 01-12 → 400
- 无 `REPORT_VIEW` → 403
- 合法请求 → 200

#### Response

```json
{
  "period": "2026-08",
  "asOfDate": "2026-08-31",
  "assets": {
    "total": 1000000,
    "subjects": [
      { "code": "1001", "name": "库存现金", "amount": 50000 },
      { "code": "1002", "name": "银行存款", "amount": 800000 }
    ]
  },
  "liabilities": {
    "total": 200000,
    "subjects": [
      { "code": "2202", "name": "应付账款", "amount": 200000 }
    ]
  },
  "equity": {
    "postedEquity": 500000,
    "unclosedProfit": 300000,
    "total": 800000,
    "subjects": [
      { "code": "4001", "name": "实收资本", "amount": 500000 }
    ]
  },
  "totalAssets": 1000000,
  "totalLiabilitiesAndEquity": 1000000,
  "difference": 0,
  "equationValid": true
}
```

#### equationValid 规则

```javascript
const totalAssets = assets.total;
const totalLiabilitiesAndEquity = liabilities.total + equity.postedEquity + equity.unclosedProfit;
const difference = totalAssets - totalLiabilitiesAndEquity;
const equationValid = difference === 0;
```

- 使用整数（cents）严格比较，无浮点容差
- `equationValid` 为正式响应字段，每次请求均返回
- UI 必须如实展示 `difference` 与 `equationValid`，不平衡时不隐藏差额，不强制修改数字使等式成立

#### EQUITY 测试数据

当前全局 seed 中无 EQUITY 科目。测试 fixture 在 `before()` 中通过直接 DB 插入：

```sql
INSERT OR IGNORE INTO accounting_subjects(id, code, name, type, direction, active)
VALUES ('subject-4001', '4001', '实收资本', 'EQUITY', 'CREDIT', 1)
```

**不修改全局 production demo seed**——除非 `document.md` 明确要求默认系统必须存在 EQUITY 科目。

#### UI

最小集成于 `src/pages/accounting.jsx`，新增 `资产负债表` tab：

- 期间选择器 + 查询按钮
- 三段表格：资产 / 负债 / 权益
- 权益段含「未结转损益」虚拟行（不可编辑、不持久化）
- 顶部显示 `equationValid` 状态与 `difference`
- 平衡时：「资产 = 负债 + 权益」（绿色指示）
- 不平衡时：明显显示差额（如红色横幅 + 差额金额）
- 不通过修改报表数字强行让等式成立

#### Schema 限制

当前 `accounting_subjects` 与 `accounting_vouchers` schema 不包含：
- fiscal_year / 会计年度字段
- opening_balance / 期初余额表
- 本年利润 / 利润分配 EQUITY 子科目
- year-end / 期间结转凭证生成机制

因此资产负债表只能做到「as-of 期间末累计 + 未结转损益虚拟展示」，不能等同于企业级完整资产负债表。

#### 不在本任务范围

- 现金流量表
- 年结 / Year-End Carry Forward / 自动结转
- 损益结转凭证生成
- 独立 opening_balance 表
- 本年累计对比 / 同比 / 环比
- 新增 EQUITY 子类型（本年利润、利润分配等）
- 多组织 / 多账套 / 多币种
- BI / 自定义报表设计器
- 修改 `createAccountingVoucher` period 字段
- 修改全局 demo seed（仅测试 fixture 添加 EQUITY）
评分结果按阈值划分为 A、B、C、D 等级。

### 7.11 财务报表一致性收口

#### 共享 Income Calculation Helper

`calculateIncomeForPeriod(db, period)`（`server/modules/extended.js`）：

- 纯业务 helper，不接收 `res`，不做 HTTP 权限校验，不发送 response
- 入参 `period` 为 `YYYY-MM`，缺省回退当前月；非法格式抛 `Error`
- SQL 使用 `voucher_date` 月份范围 + `status='POSTED'`
- REVENUE = `credit − debit`，EXPENSE = `debit − credit`
- 返回 `{ period, periodRange, revenue, expense, profit }`

#### 修正后的 Financial Summary

`getFinancialSummary()` 调用 `calculateIncomeForPeriod` 获取 income 三项，再加 AR/AP 字段：

```javascript
const income = calculateIncomeForPeriod(db, period);
const ar = ...;  // accounts_receivable（独立语义）
const ap = ...;  // accounts_payable（独立语义）
return { period, revenue, expense, profit, accounts_receivable, accounts_payable };
```

**修正点**:
- ❌ `v.period` 列 → ✅ `voucher_date` 月份范围
- ❌ `SUM(amount_cents)` 忽略方向 → ✅ direction-aware
- ❌ 销售退回虚增收入 → ✅ 正确减收入

**保留字段**:
- `period` / `revenue` / `expense` / `profit`
- `accounts_receivable` / `accounts_payable`（与 Income Statement 独立）

#### 报表权限统一

| 报表 | 权限 |
|------|------|
| Income Statement | `REPORT_VIEW` |
| Balance Sheet | `REPORT_VIEW` |
| Trial Balance | `REPORT_VIEW` |
| Financial Summary | `REPORT_VIEW` |
| 凭证操作 / 余额 / 账簿 | `ACCOUNTING_VIEW` |

**`role-accounting` 调整**:
- + `REPORT_VIEW`
- 保留 `ACCOUNTING_VIEW` / `ORDERS_VIEW` / `PURCHASE_ORDERS_VIEW` / 出纳 / 银行 / 票据 / 固定资产 等原有权限

#### Trial Balance UI

最小集成于 `src/pages/accounting.jsx` `试算平衡表` tab：

- 期间选择器 + 查询按钮
- 每科目表格：期初 / 本期借方 / 本期贷方 / 期末
- 顶部本期借贷发生额校验：`totalPeriodDebit === totalPeriodCredit`
- 平衡显示绿色 `借方发生额 = 贷方发生额`，不平衡显示差额
- loading / error / empty 状态

仅做本期借贷发生额校验，**不**与资产负债表的 `Assets = Liabilities + Equity` 混为一谈。

#### Financial Summary UI

**不创建 UI**。保持后端 API 修正即可。不得声称"用户可在浏览器查看 Financial Summary"。

#### Deferred

- `getAccountingLedger`：POSTED 过滤缺失 + 无 API 路由 → 标记 DEFERRED，后续独立处理
- Demo data expansion：0 POSTED vouchers + 0 EQUITY subjects → DEMO READINESS ISSUE，不在本任务范围

### 7.12 Production Safety（Phase 2A）

#### Demo Seed Gating

`createDatabase()` 启动时拆分为两阶段 seed：

- `seedSchema(db)` —— **始终执行**：permissions、roles、role_permissions、accounting_subjects（系统运行必需）
- `seedDemoData(db)` —— **条件执行**：demo 账号（admin/admin123 等弱密码）、demo 业务数据、demo 销售订单

是否执行 demo seed 由 `shouldSeedDemoData()` 决定：

```javascript
function shouldSeedDemoData() {
  if (process.env.ERP_SEED_DEMO === 'true') return true;  // 强制种子（任意环境）
  if (process.env.NODE_ENV === 'production') return false;  // 生产禁止
  return true;  // dev/test 默认（保持现有体验）
```

**生产语义**：`NODE_ENV=production` 时即使数据库为空也**不会**自动创建弱密码账号；如需演示部署可显式 `ERP_SEED_DEMO=true` 覆盖。

#### reset-data 生产保护

`server/reset-data.js` 起始处加入：

```javascript
if (process.env.NODE_ENV === 'production') {
  console.error('错误：生产环境禁止执行 reset-data。');
  process.exit(1);
}
```

删除 SQLite 文件等破坏性操作在生产环境被硬阻断，不依赖交互式确认。

#### 环境变量

`process.env` 直接读取，**不引入 dotenv**。生产环境变量由 systemd `EnvironmentFile` 注入。

实际支持的 env 列表见 `.env.example`：

| 变量 | 用途 | 默认 |
|------|------|------|
| `NODE_ENV` | `development` / `production` | — |
| `PORT` | HTTP 监听端口 | 3001 |
| `ERP_DB_PATH` | SQLite 数据库绝对路径 | `./data/erp.db` |
| `SESSION_HOURS` | 会话有效期（小时） | 12 |
| `LOGIN_MAX_ATTEMPTS` | 登录失败锁定阈值 | 5 |
| `LOGIN_LOCK_MINUTES` | 锁定时长（分钟） | 15 |
| `TOKEN_LENGTH` | Token 字节长度 | 32 |
| `ERP_SEED_DEMO` | demo 种子开关 | dev: `true`；prod: `false` |

#### 生产数据库路径

- 开发：`./data/erp.db`（项目内）
- 生产：`/var/lib/modern-erp/erp.db`（与源代码分离）
- 必须确保父目录存在并由 `erp` 用户拥有

#### 不在本任务范围

- 进程管理（systemd unit 模板）→ Phase 2C
- Nginx 反向代理配置 → Phase 2C
- 备份 / 恢复 → Phase 2B
- 首次管理员初始化流程 → Phase 2C
- HTTPS / 监控 / 安全组

### 7.13 Backup / Restore（Phase 2B）

#### 工具

- `scripts/backup-db.mjs` — 导出 `runBackup({ dbPath, backupDir, retention, now })`
- `scripts/restore-db.mjs` — 导出 `runRestore({ backupPath, dbPath, backupDir, isProduction, confirm })`
- `pnpm backup-db` / `pnpm restore-db` — CLI 入口

#### 一致性策略

Node `node:sqlite` (>= 22.13) 的 `DatabaseSync` **不暴露** C `sqlite3_backup_*` API。本项目使用 SQLite 官方一致的 `VACUUM INTO <path>` 命令：

- `VACUUM INTO` 在内部完成 WAL checkpoint，将所有已提交事务物化到新文件
- 新备份文件**没有** `-wal` / `-shm` 旁路文件，自包含
- 与正在运行的应用连接不冲突(读+写 vs 读+写指向不同文件)

#### 文件命名

`erp-YYYYMMDD-HHmmss.db`（本地时间戳），safety 备份 `safety-YYYYMMDD-HHmmss.db`。

#### 生产恢复保护

`NODE_ENV=production` 必须显式传入 `--confirm-restore`，否则立即拒绝：

```javascript
if (isProduction && !confirm) {
  return { success: false, error: '生产环境必须显式传入 --confirm-restore ...' };
}
```

#### 恢复流程

1. 验证备份文件存在 + 大小 > 0
2. 打开备份执行 `PRAGMA integrity_check`（必须 `ok`）
3. 拒绝 backup 与 target 相同（防止覆盖）
4. 创建 safety 备份（VACUUM INTO safetyPath）
5. 删除 target 的 `-wal` / `-shm`
6. VACUUM INTO `<target>.restore.tmp` 后 rename 到 target
7. 恢复后再次 `PRAGMA integrity_check`
8. 任意验证失败 → 停止恢复 → target 未修改

#### 关键安全保证

- `pnpm backup-db` 失败时**自动清理**备份文件
- `pnpm restore-db` 任何步骤失败**不修改** target DB
- `safety-` 备份保证可回滚到执行恢复前一刻
- 生产恢复不依赖交互式提示，可被 SSH / systemd ExecStart 安全调用

#### 不在本任务范围

- 备份调度（systemd timer / cron）→ Phase 2C
- 备份加密 / 远程上传 → 后续
- 备份保留策略自动化（已包含 retention 默认 30）
- 自动服务启停（恢复后由运维手动重启）

### 7.14 First Admin Bootstrap（Phase 2C-1）

Phase 2A 阻断了生产环境的 demo seed 自动创建,空生产 DB 因此无管理员可登录。`scripts/setup-admin.mjs` 是创建首个管理员的**唯一**显式路径。

#### 用法

```bash
node scripts/setup-admin.mjs --username admin --password 'Strong-Production-Pwd-2026!'
# 或
pnpm setup-admin -- --username admin --password 'Strong-Production-Pwd-2026!'
```

#### 工具设计

导出 `setupAdmin({ dbPath, username, password, displayName, now })` 供测试。CLI 主入口处理 `process.argv` 解析与 isMainModule 检测(跨平台)。

#### 安全规则

| 规则 | 实现 |
|------|------|
| `username` 必填 | `if (!username || !username.trim()) reject` |
| `password` 必填 | `if (!password) reject` |
| 密码长度 ≥ 12 | `if (password.length < 12) reject` |
| 拒绝已知弱密码 | `WEAK_DEMO_PASSWORDS` 黑名单(case-insensitive) |
| 用户已存在拒绝覆盖 | `SELECT id FROM users WHERE username = ?` 检查 |
| admin role 不存在失败 | `SELECT id FROM roles WHERE code='ADMIN'` 检查 |
| 不输出明文密码 | CLI 输出仅 username / userId / role |
| 不写入文件 / 日志 | 工具仅 `INSERT INTO users` |
| 失败返回 non-zero | `process.exit(1)` |

#### 行为约束

- ✅ 允许 `NODE_ENV=production` 下运行 —— 显式生产初始化工具
- ❌ **应用启动绝不自动调用** —— `server/index.js` 不导入此脚本
- ✅ 复用现有 `hashPassword` 函数(无新算法)
- ✅ 使用现有 users / roles schema,userId 固定为 `user-admin-init`
- ✅ 不创建 demo 业务数据 / 其他 demo 用户

#### 完整生产初始化序列

```
deploy → start service (empty DB + schema created)
  → explicit setup-admin → login → use ERP
```

#### 不在本任务范围

- 自动服务启停 → Phase 2C-2A systemd
- 批量用户创建 / 密码重置 → 后续
- 多管理员并行创建 → 后续(当前每次只创建 1 个)
评分结果按阈值划分为 A、B、C、D 等级。

### 7.15 systemd Service + Backup Timer（Phase 2C-2A）

本阶段新增最小生产 systemd 文件,不引入 PM2 / Docker / Nginx / HTTPS。

#### 主应用服务

`deploy/systemd/modern-erp.service`:

- `User=modern-erp` / `Group=modern-erp`;
- `WorkingDirectory=/opt/modern-erp`;
- `EnvironmentFile=/etc/modern-erp/env`;
- `ExecStart=/usr/bin/node server/index.js`(等价于当前 `pnpm start` 的 Node production 启动入口);
- `Restart=on-failure`, `RestartSec=5s`;
- `KillSignal=SIGTERM`,与 `server/index.js` 当前 SIGTERM graceful shutdown 兼容;
- 不设置 `HOST`,Node 继续绑定 `127.0.0.1:3001`。

#### 备份服务与 timer

`deploy/systemd/modern-erp-backup.service` 为 `Type=oneshot`,使用同一 `modern-erp` 用户和 `/etc/modern-erp/env`,仅调用:

```text
/usr/bin/node scripts/backup-db.mjs
```

不调用 restore,不停止主应用服务。

`deploy/systemd/modern-erp-backup.timer`:

- `OnCalendar=*-*-* 02:30:00`;
- `Persistent=true`;
- `Unit=modern-erp-backup.service`。

#### 生产目录假设

- Application: `/opt/modern-erp`;
- Database: `/var/lib/modern-erp/erp.db`;
- Backups: `/var/backups/modern-erp`;
- Environment: `/etc/modern-erp/env`;
- Service user: `modern-erp`。

`/etc/modern-erp/env` 至少包含 `NODE_ENV=production`, `PORT=3001`, `ERP_DB_PATH=/var/lib/modern-erp/erp.db`, `ERP_BACKUP_DIR=/var/backups/modern-erp` 和当前 session/login 配置。

#### 验证

新增 `server/systemd.test.js` 静态验证 unit 文件结构、路径、`ExecStart`、`EnvironmentFile`、`User/Group`、timer 到 service 的映射、backup script 存在且 backup service 不调用 restore。Windows 环境不运行 `systemctl`;Ubuntu 上线前仍需执行 `systemd-analyze verify`。

### 7.16 Nginx Reverse Proxy（Phase 2C-2B）

本阶段新增最小 HTTP reverse proxy 配置,不配置 HTTPS / Certbot / 域名 / Tencent Cloud 操作。

#### 架构

```text
Browser → Nginx :80 → http://127.0.0.1:3001 → Node ERP
```

Node 仍然负责 API、production `dist` 和 React SPA fallback。Nginx 不直接 serve `dist/`,也不为 `/api`、`/assets` 或 SPA routes 创建第二套路由。

#### 配置

`deploy/nginx/modern-erp.conf` 只包含一个 server block 和一个 `location /`:

- `listen 80`;
- `listen [::]:80`;
- `server_name _`;
- `client_max_body_size 1m`;
- `proxy_pass http://127.0.0.1:3001`;
- proxy headers:`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`;
- timeout:`proxy_connect_timeout 10s`, `proxy_send_timeout 60s`, `proxy_read_timeout 60s`。

不添加复杂缓存规则,不添加 websocket 配置,不开放 Node 的 `3001` 公网访问。

#### 验证

新增 `server/nginx.test.js` 静态验证 Nginx 配置文件存在、HTTP listen、单一 `location /`、统一 proxy、必要 headers、body size、timeout,并防止出现 `root` / `alias` / `try_files` / `/api` 分流 / HTTPS / websocket 相关配置。Windows 环境不运行 `nginx -t`;Ubuntu 上线前仍需执行 `nginx -t` 并分别检查:

```text
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1/api/health
```

### 7.17 Warehouse & Logistics Stabilization（v1.0.1 candidate）

仓储新增弹窗不再在 render path 同步调用 `setForm`；详情到达后由独立 effect 初始化表单。供应商与客户选择器分别使用 `/api/lookup/suppliers` 和 `/api/lookup/customers`，只返回 `id/code/name`，并由对应入库、出库或退货管理权限守卫，不授予仓库角色完整客户/供应商模块权限。各依赖请求独立捕获错误并通过 `notify` 呈现。

`createDatabase()` 的幂等迁移统一 `purchase_receipts`、`sales_deliveries`、`return_orders`、`purchase_returns`、`inventory_transfers` 与 `inventory_transactions` 的运行时列和状态约束。旧 `SUBMITTED` 物流草稿迁移为可操作的 `DRAFT`；旧库存流水的 `type/quantity` 转换为 `direction/quantity_change`，原记录保留。确认动作使用库存 upsert、写入余额后的库存流水，并在事务内重新校验出库数量。

实际创建依赖如下：采购入库需要供应商、仓库、货品（采购订单链接可选）；销售出库需要客户、仓库、货品（销售订单链接可选）；销售/采购退货需要对应往来单位、仓库、货品（来源出库/入库链接可选）；库存调拨需要源仓、目标仓、货品和源仓库存。仓库角色通过窄查询端点闭合这些依赖，仍不持有客户、供应商、订单、会计、期间、用户、角色或生产管理权限。

App 对无权访问的陈旧 hash 使用 `current.key` 渲染首个可见页面，避免短暂挂载 `UsersRoles` 等不可访问组件并触发 `/api/users`、`/api/roles` 请求。

### 7.18 Cost P0 Containment（Post-v1.0.0 Teacher Acceptance）

Standard Cost 的唯一公共请求/响应契约使用 camelCase：`productId`、`materialCostCents`、`laborCostCents`、`overheadCostCents`、`standardCostCents`、`effectiveDate`、`remark`。四个金额字段都是非负安全整数分，`standardCostCents` 必须严格等于三个组成项之和；缺失、负数、非整数、非有限值、无效日期或不一致总额返回正常 400，不进行默认补零或元/分二次换算。前端只在元输入边界用精确字符串解析生成整数分，例如 `153.45` 元严格生成 `15345` 分。

新标准成本版本在仓库统一的 `BEGIN IMMEDIATE` 事务中完成：验证字段与产品、将旧 ACTIVE 版本改为 HISTORICAL、插入新 ACTIVE 版本、写审计记录并提交。任一步骤失败均回滚。标准成本与 `products.price_cents`（产品销售价）完全解耦；成本写入不得修改销售价。列表筛选的唯一查询参数为 `productId`。产品选择器使用 `GET /api/product-costs/products`，只返回 `id/code/name`。

Cost Rate 公共契约使用 `rateType`、`rateValue`、`unit`、`effectiveDate`、`remark`，映射到 canonical SQLite 列 `rate_type`、`rate_value`、`unit`、`effective_date`、`remark`。允许的类型为 `MATERIAL_RATE`、`LABOR_RATE`、`OVERHEAD_RATE`。旧 `code/name/category/rate_cents_per_hour/active` 布局只在启动迁移时读取；迁移保留有意义的行，将旧分值除以 100 转为规范费率值，并将旧类别映射为 `*_RATE`。迁移后 GET/POST/PATCH 不再查询旧列，重复启动幂等。

成本资源 GET 需要 `COST_VIEW` 或 `COST_MANAGE`，POST/PATCH 需要 `COST_MANAGE`；`PRODUCTS_VIEW` 和 `ACCOUNTING_VIEW` 都不是 Cost API 的替代授权。当前 `role-accounting` 没有 `COST_VIEW/COST_MANAGE`，本阶段不扩权，角色归属决策保持 PENDING。已有但未路由、未验证的 Production Cost 计算继续延后到 Manufacturing/Cost Integration，本阶段不暴露。

### 7.19 Manufacturing Stabilization（Post-v1.0.0 Teacher Acceptance）

制造域的 v1.0.1 支持面明确收口：浏览器教师验收只承诺 BOM 与 Production Orders；API-only 仅保留现有 routed 基础合同（MRP plan list/create/generate、legacy MRP calculate/bom-explode、work centers、routing operations、labor records）。Production Output、Production Cost、未挂载的 MRP Calculator UI、未路由的 MRP detail/update/execute lifecycle 均为 DEFERRED，不作为 teacher-ready 功能。

BOM 使用生产工单 canonical 权限，不引入 `BOM_MANAGE`：列表/详情为 `PRODUCTION_ORDERS_VIEW`，创建/编辑/停用为 `PRODUCTION_ORDERS_CREATE`。BOM 状态只允许 `ACTIVE` 与 `DISCONTINUED`。创建新 BOM 时事务内停用同产品旧 ACTIVE BOM、插入 header 与全部 items，并写审计；编辑时事务内替换 items，避免重复行或半写。DISCONTINUED BOM 不可编辑。校验覆盖父项产品、至少一条组件、组件产品存在且启用、数量大于 0、损耗率 0..1、重复组件和自引用。

Production Order Core 保留历史状态机：`PENDING → IN_PROGRESS → COMPLETED`，取消仍只允许非 COMPLETED 工单。`complete` 表示流程完工，不自动产生 finished-goods inventory receipt。生产入库/领料类库存影响继续延后到 Production Output 安全重设计。新增的 hardening 仅限输入校验、BOM 与产品匹配校验、未知 action 返回 400、非法重复转换返回 409、重复 cancel 返回已取消。

MRP canonical contract：`/api/mrp-plans/generate` 输入为 `plan_id + demand_type=SALES_ORDER + demand_source_id`；需求来源为销售订单明细；BOM 来源为最新 `ACTIVE` BOM 并递归展开，`DISCONTINUED` BOM 不参与；当前库存来源为 `inventory` 按产品汇总；在途来源为 `purchase_receipts` header 与 `purchase_receipt_items` 明细 join 后按 `pri.product_id` 汇总；输出写入 `mrp_plan_items.gross_requirement/on_hand/scheduled_receipt/planned_order_quantity`。生成过程在事务中删除同计划旧明细并重建，避免旧结果叠加。

Routing list 不再引用不存在的 `b.bom_code`，改返回 BOM version 与产品 code/name。Production Output 不注册 `PRODUCTION_OUTPUT`，且 `/api/production-outputs` 不再 routed；当前 unsafe handler 留作内部 deferred 代码，不进入公开 mutation surface。Production Cost 仍未路由/未接 UI，继续延后，不修改 Standard Cost / Cost Rate 合同。

### 7.20 Product Routing Standard（M10 / v1.1）

`product_routings` 是产品级路线头，字段包含产品、路线编码/名称、版本、`ACTIVE/INACTIVE`、备注及创建/更新时间；SQLite partial unique index 保证同一产品最多一条 `ACTIVE` 路线。产品没有路线仍然合法。

`product_routing_operations` 是路线工序明细，`sequence_no` 必须是正整数且路线内唯一，查询始终显式按 `sequence_no` 排序。工序保存编码、名称、简单工作中心文本、非负准备时间和非负单位运行时间；这些时间仅供规划，不生成成本或执行记录。

旧 `routing_operations` 以 BOM 为父级并强制引用 `work_centers`，与产品级路线头不兼容，因此被归类为 `LEGACY / HIDDEN`。启动迁移按旧 BOM 分组生成停用历史 `product_routings`，并将旧工时和工作中心名称复制到新明细；旧表继续保留以维持 v1.0 API 与 `production_labor_records` 外键。迁移使用确定性 ID 和 `INSERT OR IGNORE`，重复启动不重复数据。

公开 API 使用 `/api/product-routings`，覆盖列表/详情/创建/修改、启用/停用和工序增删改；读取需要 `ROUTING_VIEW` 或 `ROUTING_MANAGE`，写入需要 `ROUTING_MANAGE`。现有五角色中 admin 通过 all-permissions 获得全部能力，其他四角色不获授权，注册权限数保持 100。

制品工序标准与 BOM 是同级主数据。它不修改库存、不生成会计凭证、不进入 Approval Center，也不改变 `PENDING → IN_PROGRESS → COMPLETED / CANCELLED` 的制令单状态机。制令单详情仅只读显示产品当前启用路线；工序级执行、报工、设备、产能和成本均延期。

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
