# Accounting & Analytics — Technical Design

> 状态：`ACTIVE`
> Owner：Accounting & Analytics
> 权威来源：`solution.md` §0.1 Domain Design 入口 + 本文件 `§31`
> 来源：新增正文（2026-11-10 建立 Accounting & Analytics Domain Technical Design）。
> 上游合同：`docs/requirements/accounting-analytics.md` `§35`（`APPROVED`，2026-11-10）。
> 审计基线：`docs/audits/accounting-analytics-capability-audit-20261110.md`（`v0.1`，SHA `eee92c2`）。

## 31. Accounting & Analytics Domain Technical Design

> 本节是 Accounting & Analytics 域的**当前有效** Design 正文。
> 追溯链：`Manual → Capability → Target Domain → Current Implementation → Coverage → Gap → Requirement → Design → Implementation → Acceptance`。
> 本节**不含**实现代码；只描述模块责任、调用与数据流、schema / migration、事务、RBAC / SOD、状态机、
> 错误行为、审计、兼容性、测试与回滚。
> 本节签署后按 AGENTS.md §4.3 **HARD STOP**，等待业务所有者批准 Implementation。

### 31.0 设计总览

#### 31.0.1 分层与依赖方向

```text
┌─ Platform（auth / RBAC / audit / lifecycle / notification）───────────────────┐
│    ↓ 只读调用（不反向依赖）                                                    │
├─ 业务域事实源                                                                  │
│  Finance Operations（AR/AP/资金/发票） · Inventory（数量/批次） ·                │
│  Procurement（采购/委外事实） · Manufacturing（WIP/成本）                        │
│    ↓ 事实引用（read-only，经各域 canonical handler）                          │
├─ Accounting & Analytics（本域）                                                │
│  ① accounting-events      会计事件台账（关系层，唯一新增事实入口）            │
│  ② accounting-rules        凭证模板 + 规则平台 + 批量/调度生成                 │
│  ③ accounting-posting      凭证过账与更正（薄层，复用 createSystemVoucher）    │
│  ④ accounting-period-end   期末转账/摊销/计提/损益结转                         │
│  ⑤ accounting-cash-flow    现金流量分类与现金流量表                            │
│  ⑥ accounting-reconciliation 业务↔GL 对账工作台与快照                        │
│  ⑦ accounting-reporting    报表模板 / 实例 / 安全公式引擎                     │
│  ⑧ fixed-assets            固定资产完整生命周期                                │
│  ⑨ inventory-costing       存货核算深化（范围/方法/暂估/费用/调整/关账）       │
│  ⑩ management-accounting   经营会计（账簿/单元/台账/内部结算/分配/损益/关账）   │
│    ↓ 只读投影                                                                   │
├─ Presentation：src/pages/accounting.jsx / accounting-analytics.jsx /            │
│                 fixed-assets.jsx（FixedAssets 自 treasury-cost.jsx 迁出）        │
└─ Reporting：docs/status/CAPABILITY_MATRIX.md / PROJECT_STATUS.md / acceptance   │
```

**依赖方向硬约束**：

- 本域模块**不得** import 业务域的私有实现来写事实；只能调用其 canonical handler / 只读查询。
- 本域**不得**在本域内新增第二套 AR / AP / 库存 / 采购 / 生产事实表。
- 本域模块之间只允许 **① → ② → ③** 的单向依赖；④⑤⑥⑦⑧⑨⑩ 可以依赖 ①②③，但彼此之间只允许通过
  ①②③ 的公开接口交互（例：⑧ 折旧生成凭证 → ③；⑩ 经营台账读取 GL → ⑦ 的只读取数器）。

#### 31.0.2 新增模块清单与责任边界

| 模块 | 单一责任 | 明确不承担 |
|---|---|---|
| `server/modules/accounting-events.js` | 会计事件台账的写入、状态推进、未生成/异常查询、受控修复 | 不生成凭证本体（委托 ② / ③） |
| `server/modules/accounting-rules.js` | 凭证模板与规则绑定的 CRUD、命中解析、批量 / 调度生成编排 | 不做期间状态判定（用既有 `period_closures`） |
| `server/modules/accounting-posting.js` | 凭证过账、出纳复核、冲销 / 补记的统一入口 | 不改变既有 `createSystemVoucher` 语义 |
| `server/modules/accounting-period-end.js` | 期末转账 / 摊销 / 计提定义与执行、损益结转与反结转 | 不做库存月结 |
| `server/modules/accounting-cash-flow.js` | 现金流量分类维护、现金流量表计算与资金对账 | 不做资金结算 |
| `server/modules/accounting-reconciliation.js` | 对账检查执行、结果快照、差异查询 | 不修改业务事实（差异只能由业务域处理） |
| `server/modules/accounting-reporting.js` | 报表模板 / 项目 / 实例、公式解析与求值、生命周期 | 不做取数以外的 GL 写入 |
| `server/modules/accounting-expressions.js` | 受限表达式解析与求值（模板条件 / 金额 / 报表公式） | 不做取数、不做取数以外的写操作 |
| `server/modules/fixed-assets.js` | 资产卡片、变更、拆分合并、借用盘点、折旧计提、处置 | 不拥有采购收货 |
| `server/modules/inventory-costing.js` | 核算范围、计价方法、暂估、费用分摊、成本调整、完工结转、核算关账检查 | 不写库存数量（Inventory 域） |
| `server/modules/management-accounting.js` | 经营账簿 / 单元 / 台账 / 内部结算 / 分配 / 经营损益 / 经营关账 | 不写法定 GL（只读 + 通过 ③ 过账） |

**既有模块的改动边界**：

- `server/modules/financial-inventory.js`：`createSystemVoucher` / `reverseSystemVoucher` **签名与语义不变**；
  仅允许新增 `cashFlow` 维度参数（可选，缺省行为不变）。
- `server/modules/extended.js`：`getPeriodClosureChecklist` 扩展为调用 `accounting-period-end` 的统一检查；
  `closePeriod` / `unclosePeriod` 语义不变，仅增加前置检查项。
- `server/modules/accounting-config.js`：`listVoucherTemplates` 保持原路径与响应形状，新增写入口到
  `accounting-rules.js`（不复用旧 handler，避免两套模板写入口）。
- `server/app.js`：**只做路由注册与薄 dispatch**；本域业务逻辑一律不写进 `server/app.js`
  （对齐 AGENTS.md §8 的长期目标）。

#### 31.0.3 新增前端 surface 与 route

| Route key | Domain | 页面 | 权限 | 曝光 | 对应包 |
|---|---|---|---|---|---|
| `accounting`（既有，扩展） | accounting-analytics | `src/pages/accounting.jsx` | `ACCOUNTING_VIEW` | role-workspace | AA-W1 / AA-W3 |
| `accounting-events`（新） | accounting-analytics | `src/pages/accounting-analytics.jsx` | `ACCOUNTING_EVENTS_VIEW` | launcher | AA-W1 |
| `accounting-reconciliation`（新） | accounting-analytics | `src/pages/accounting-analytics.jsx` | `ACCOUNTING_RECONCILIATION_VIEW` | launcher | AA-W1 |
| `accounting-reports`（新） | accounting-analytics | `src/pages/accounting-analytics.jsx` | `REPORT_TEMPLATE_VIEW` | launcher | AA-W4 |
| `management-accounting`（新） | accounting-analytics | `src/pages/accounting-analytics.jsx` | `MANAGEMENT_ACCOUNTING_VIEW` | launcher | AA-W7 |
| `accounting-costing`（新） | accounting-analytics | `src/pages/accounting-analytics.jsx` | `INVENTORY_COST_VIEW` | launcher | AA-W6 |
| `fixed-assets`（既有，改 enabled） | accounting-analytics | `src/pages/fixed-assets.jsx`（**自 treasury-cost.jsx 迁出**） | `FIXED_ASSETS_VIEW` | launcher | AA-W5 |
| `decision-reports`（既有，不变） | accounting-analytics | `src/pages/decision-reports.jsx` | `REPORT_VIEW` | launcher | 兼容 |

**route 约束**（AGENTS.md §7）：

- route key 唯一；`fixed-assets` 由 `enabled:false` 改为 enabled **不新增**第二个固定资产 route；
- 同一 route 不存在两套 active executable screen：`FixedAssets` 组件自 `treasury-cost.jsx` **迁出**到
  `src/pages/fixed-assets.jsx`，`treasury-cost.jsx` 删除该导出（`CashJournals` / `BankAccounts` / `Bills` 保留）；
- launcher 的 accounting-analytics 组由 7 项扩展为 13 项，且必须保持 8 Domain group 投影不变；
- direct URL / refresh / Back / Forward 必须可用；permission exposure 与 launcher 一致。

### 31.1 AA-W1 会计事件台账与对账工作台

#### 31.1.1 数据模型

```sql
-- 会计事件：业务事实 → 凭证的唯一归一关系层
CREATE TABLE accounting_events (
  id                TEXT PRIMARY KEY,
  event_type        TEXT NOT NULL,          -- 业务事件类型，如 SALES_INVOICE_POSTED
  source_type       TEXT NOT NULL,          -- 来源业务单据类型
  source_id         TEXT NOT NULL,          -- 来源业务单据 ID
  source_item_id    TEXT,                   -- 行项目 ID（可空）
  business_date     TEXT NOT NULL,          -- 业务日期（决定会计期间归属）
  period            TEXT NOT NULL,          -- YYYY-MM
  status            TEXT NOT NULL,          -- PENDING | GENERATED | SKIPPED | FAILED | REVERSED
  rule_code         TEXT,                   -- 命中的规则编码
  template_id       TEXT,                   -- 命中的模板
  voucher_id        TEXT,                   -- 已生成的凭证
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_error_code   TEXT,
  last_error_message TEXT,
  skip_reason       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(event_type, source_type, source_id, source_item_id)
);
CREATE TABLE accounting_event_attempts (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  attempt_no   INTEGER NOT NULL,
  outcome      TEXT NOT NULL,               -- SUCCESS | FAILED | SKIPPED
  error_code   TEXT,
  error_message TEXT,
  voucher_id   TEXT,
  created_at   TEXT NOT NULL
);
CREATE TABLE accounting_reconciliation_runs (
  id          TEXT PRIMARY KEY,
  run_key     TEXT NOT NULL UNIQUE,         -- 幂等键
  period      TEXT,
  as_of_date  TEXT NOT NULL,
  status      TEXT NOT NULL,                -- RUNNING | COMPLETED | FAILED
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  created_by  TEXT NOT NULL
);
CREATE TABLE accounting_reconciliation_items (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  check_code    TEXT NOT NULL,
  severity      TEXT NOT NULL,              -- BLOCKING | WARNING | INFO
  status        TEXT NOT NULL,              -- PASS | FAIL
  difference_cents INTEGER NOT NULL DEFAULT 0,
  affected_json TEXT,                       -- 受影响记录标识（脱敏后仍可定位）
  explanation   TEXT NOT NULL,
  UNIQUE(run_id, check_code)
);
CREATE TABLE accounting_close_check_snapshots (
  id           TEXT PRIMARY KEY,
  period       TEXT NOT NULL,
  closure_id   TEXT,
  checklist_json TEXT NOT NULL,
  passed       INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
```

`accounting_subjects` 沿用既有表，新增维护端点（不改表结构，避免破坏既有引用）。

#### 31.1.2 状态机

```text
accounting_events.status
  PENDING ──生成成功──> GENERATED ──冲销──> REVERSED
     │
     ├──生成失败──> FAILED ──重试成功──> GENERATED
     │                  └──重试失败──> FAILED（attempt_count 累加）
     └──显式跳过（需原因 + 权限 + 审计）──> SKIPPED ──恢复──> PENDING
```

不变量：

- `GENERATED` 必须有 `voucher_id`；`FAILED` 必须有 `last_error_code`；`SKIPPED` 必须有 `skip_reason`；
- `REVERSED` 只能由已 `GENERATED` 的事件进入，且必须对应一张冲销凭证；
- 同一 `(event_type, source_type, source_id, source_item_id)` **永不可出现第二条事件**（数据库唯一约束 + 应用层双检）；
- 事件**不得**被物理删除；取消生成只能走 `SKIPPED`。

#### 31.1.3 调用与数据流

```text
业务域 canonical handler（确认 / 过账动作）
  └─> accounting-events.js::recordEvent(...)
        ├─ 唯一性检查（DB UNIQUE + 应用层）
        ├─ 业务日期 → period 判定（复用既有 period 口径）
        └─ status = PENDING
  └─> accounting-rules.js::resolveRule(sourceType, eventType, businessDate)
        ├─ 命中 accounting_rule_bindings（唯一命中，否则 RULE_NOT_FOUND / RULE_AMBIGUOUS）
        └─ 命中 accounting-rules.js::applyTemplate(...)
              └─ accounting-posting.js::postSystemVoucher(...)
                    ├─ 复用 createSystemVoucher（科目按角色解析）
                    ├─ 事务内写入 voucher + entries + 回填 event.voucher_id + event.status=GENERATED
                    └─ 失败 → event.status=FAILED + last_error_code（凭证事务整体回滚，无半张凭证）
```

关键约束：

- 事件写入与凭证生成**不在同一事务**：事件先落库（保证「应生成但未生成」可见），
  生成失败时事件保留为 `FAILED`，凭证事务整体回滚；
- 生成入口必须幂等：以事件 ID 派生幂等键（复用 `financial-controls.js::idempotencyReplay` / `saveIdempotency`）；
- 凭证生成成功后**回填事件**与「生成 + 回填」在同一事务内完成，不允许出现「有凭证无事件」。

#### 31.1.4 事务 / 幂等 / 审计

| 动作 | 事务边界 | 幂等键 | 审计 action |
|---|---|---|---|
| 记录事件 | 单条 insert | `source_type:source_id:event_type` | —（自动派生，不单独审计） |
| 生成凭证 | 单事务：voucher + entries + event 回填 | `event:{eventId}` | `ACCOUNTING_VOUCHER_GENERATED` |
| 事件重试 | 单事务 | `event:{eventId}:attempt:{n}` | `ACCOUNTING_EVENT_REPAIR` |
| 事件跳过 | 单事务 | `event:{eventId}:skip` | `ACCOUNTING_EVENT_SKIP` |
| 事件恢复 | 单事务 | `event:{eventId}:resume` | `ACCOUNTING_EVENT_RESUME` |
| 对账运行 | 写 run + items 单事务 | `recon:{period}:{asOfDate}` | `ACCOUNTING_RECONCILIATION_RUN` |
| 关账检查快照 | 单条 insert | `closecheck:{period}:{date}` | — |
| 科目维护 | 单事务 | — | `ACCOUNTING_SUBJECT_CREATE/UPDATE/DEACTIVATE` |

**审计要求**：修复、跳过、恢复、对账运行必须写审计；生成成功可选审计但必须可由事件表追溯。

#### 31.1.5 错误行为

| 场景 | HTTP | 错误码 |
|---|---|---|
| 权限不足 | 403 | `ACCOUNTING_EVENT_PERMISSION_DENIED` |
| 事件不存在 | 404 | `ACCOUNTING_EVENT_NOT_FOUND` |
| 事件已 GENERATED 再生成 | 409 | `ACCOUNTING_EVENT_ALREADY_GENERATED` |
| 事件已 SKIPPED 再重试 | 409 | `ACCOUNTING_EVENT_SKIPPED` |
| 跳过未填原因 | 400 | `ACCOUNTING_EVENT_SKIP_REASON_REQUIRED` |
| 修复人与原始业务审核人同一 | 403 | `ACCOUNTING_EVENT_REPAIR_SOD_VIOLATION` |
| 模板 / 规则未命中 | 事件 `FAILED` + `RULE_NOT_FOUND` | — |
| 规则命中歧义 | 事件 `FAILED` + `RULE_AMBIGUOUS` | — |

**禁止**：静默跳过、吞异常、失败后留半张凭证、把错误只写日志不落库。

#### 31.1.6 RBAC / SOD

- `ACCOUNTING_EVENTS_VIEW`：查看事件与未生成清单；
- `ACCOUNTING_EVENTS_REPAIR`：重试 / 跳过 / 恢复；
- SOD：修复人 ≠ 原始业务单据审核人；ADMIN 可豁免但必须留审计。

#### 31.1.7 端点

```text
GET    /api/accounting/events                     事件列表（status/source_type/period/keyword 过滤）
GET    /api/accounting/events/ungenerated         未生成 / 失败清单（工作台用）
GET    /api/accounting/events/:id                 事件详情（含 attempts 与关联凭证）
POST   /api/accounting/events/:id/retry           受控修复（重试生成）
POST   /api/accounting/events/:id/skip            显式跳过（需 reason）
POST   /api/accounting/events/:id/resume          恢复跳过事件
POST   /api/accounting/events/batch-generate      批量生成（按 period / source_type）
GET    /api/accounting/reconciliation             对账结果（按 period 取最近一次快照）
POST   /api/accounting/reconciliation/run         触发一次对账
GET    /api/accounting/reconciliation/runs        对账快照历史
GET    /api/accounting/close-checklist            统一期末检查（period）
POST   /api/accounting/subjects                   创建科目
PATCH  /api/accounting/subjects/:id               修改科目
POST   /api/accounting/subjects/:id/deactivate    停用科目
```

#### 31.1.8 测试

- 唯一性：同一业务事实重复触发只产生一条事件 + 一张凭证（正例 + 重复触发反例）；
- 未生成可发现：业务单据确认但规则未命中 → 事件 `FAILED` 出现在 `/ungenerated`；
- 修复幂等：重复 retry 只产生一张凭证；
- 跳过必填原因；跳过后不出现在未生成清单；
- SOD：修复人 == 原单审核人 → 403 且无副作用；
- 对账快照：差异为 0 时 `PASS`；注入差异后 `FAIL` 且 `difference_cents` 正确；
- 关账拦截：存在 `FAILED` 事件时 `closePeriod` 返回 409。

### 31.2 AA-W2 凭证模板与规则平台

#### 31.2.1 数据模型

```sql
-- 既有 voucher_templates 扩展：版本、生效区间、条件与金额表达式、维度
ALTER TABLE voucher_templates ADD COLUMN version_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE voucher_templates ADD COLUMN valid_from TEXT;
ALTER TABLE voucher_templates ADD COLUMN valid_to TEXT;
ALTER TABLE voucher_templates ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE voucher_templates ADD COLUMN condition_expr TEXT;
ALTER TABLE voucher_templates ADD COLUMN dimension_json TEXT;
ALTER TABLE voucher_templates ADD COLUMN updated_at TEXT;

-- 规范化模板条目（替代只读 entries_json 的读路径；entries_json 保留兼容读）
CREATE TABLE voucher_template_items (
  id            TEXT PRIMARY KEY,
  template_id   TEXT NOT NULL,
  line_no       INTEGER NOT NULL,
  summary       TEXT NOT NULL,
  accounting_role TEXT NOT NULL,            -- 科目角色，不写死科目编码
  subject_id    TEXT,                       -- 显式科目（与 role 二选一）
  direction     TEXT NOT NULL,              -- DEBIT | CREDIT
  amount_source TEXT NOT NULL,              -- 来源键（如 SOURCE_AMOUNT）
  amount_expr   TEXT,                       -- 受限表达式（无 amount_source 时必填）
  dimension_json TEXT,
  UNIQUE(template_id, line_no)
);

CREATE TABLE accounting_rule_bindings (
  id          TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  template_id TEXT NOT NULL,
  valid_from  TEXT NOT NULL,
  valid_to    TEXT,
  priority    INTEGER NOT NULL DEFAULT 100,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(source_type, event_type, valid_from)
);

CREATE TABLE accounting_generation_runs (
  id           TEXT PRIMARY KEY,
  run_type     TEXT NOT NULL,               -- SCHEDULED | BATCH | MANUAL
  period       TEXT,
  status       TEXT NOT NULL,               -- RUNNING | COMPLETED | FAILED
  total_count  INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  created_by   TEXT NOT NULL
);
```

#### 31.2.2 模板表达式安全合同

- 表达式**不是**任意表达式语言。定义**声明式取值**而非可执行代码：
  - 条件 `condition_expr`：形如 `SOURCE_AMOUNT > 0` 的极简比较式，仅允许
    `SOURCE_AMOUNT` / `SOURCE_TAX` / `SOURCE_COUNT` / `PERIOD` 四个标识符 + `+ - * /` 运算 + 比较符 + `AND`/`OR` + 括号；
  - 金额 `amount_expr`：形如 `SOURCE_AMOUNT - SOURCE_TAX` 的算术式，标识符同上；
- 解析器独立实现于 `server/modules/accounting-expressions.js`（单一安全文法模块）；
- **禁止** `eval` / `Function` / `vm` / `new Function` / `child_process`；
- 长度上限 512 字符，解析深度上限 24，标识符白名单外的记号一律 `INVALID_TOKEN`；
- 错误码：`INVALID_TOKEN` / `UNKNOWN_IDENTIFIER` / `INVALID_EXPRESSION` / `EXCEEDED_LENGTH` / `EXCEEDED_DEPTH` /
  `DIVIDE_BY_ZERO` / `EXPRESSION_RUNTIME_ERROR`；
- 求值失败 → 该分录**不生成**，整张凭证失败并写事件 `FAILED`，**不得**取 0 或跳过该分录。

#### 31.2.3 规则命中

- 命中条件：`source_type` + `event_type` 精确匹配，且 `business_date ∈ [valid_from, valid_to]`；
- 命中唯一性：同 `(source_type, event_type)` 在同一日期下**只允许一条 active 绑定**；
  多条命中 → `RULE_AMBIGUOUS`；无命中 → `RULE_NOT_FOUND`；
- 模板必须 `status='ACTIVE'` 且在有效期内，否则视为未命中；
- 命中结果必须记录 `rule_code` 与 `template_id` 到事件（可追溯）。

#### 31.2.4 事务 / 幂等 / 审计 / 端点

| 动作 | 事务 | 幂等 | 审计 |
|---|---|---|---|
| 模板 CRUD / 停用 | 单事务 | — | `VOUCHER_TEMPLATE_CREATE/UPDATE/DEACTIVATE` |
| 模板版本发布 | 单事务 | `tpl:{id}:ver:{n}` | `VOUCHER_TEMPLATE_PUBLISH` |
| 规则绑定 CRUD / 停用 | 单事务 | — | `ACCOUNTING_RULE_CREATE/UPDATE/DEACTIVATE` |
| 批量生成 | 每事件独立事务 | `event:{id}` | `ACCOUNTING_GENERATION_RUN` |

```text
GET    /api/accounting/voucher-templates            模板列表
POST   /api/accounting/voucher-templates            创建模板
PATCH  /api/accounting/voucher-templates/:id        修改模板（未发布版本）
POST   /api/accounting/voucher-templates/:id/publish 发布新版本
POST   /api/accounting/voucher-templates/:id/deactivate 停用
GET    /api/accounting/voucher-templates/:id/preview   试算（不入账）
GET    /api/accounting/rules                         规则列表
POST   /api/accounting/rules                         创建规则绑定
PATCH  /api/accounting/rules/:id                     修改规则
POST   /api/accounting/rules/:id/deactivate          停用规则
GET    /api/accounting/generation-runs               生成运行记录
```

#### 31.2.5 兼容性与迁移

- `GET /api/voucher-templates` 保留，返回形状在 `entries` 字段上**保持不变**（由 `entries_json` 归一化而来）；
- 既有模板数据（`entries_json`）在 migration 中**一次性归一化**到 `voucher_template_items`；
  归一化不可解析的既有模板 → 保留原 `entries_json` 并标记 `parse_status='LEGACY_UNRESOLVED'`，
  **不得**静默丢弃数据。

### 31.3 AA-W3 总账增强与期末自动化

#### 31.3.1 数据模型

```sql
ALTER TABLE accounting_vouchers ADD COLUMN cashier_review_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE accounting_vouchers ADD COLUMN cashier_reviewed_by TEXT;
ALTER TABLE accounting_vouchers ADD COLUMN cashier_reviewed_at TEXT;
ALTER TABLE accounting_vouchers ADD COLUMN cashier_review_reason TEXT;
ALTER TABLE accounting_vouchers ADD COLUMN correction_of_id TEXT;      -- 补记/更正关联原凭证

ALTER TABLE accounting_entries ADD COLUMN cash_flow_category TEXT;     -- OPERATING | INVESTING | FINANCING
ALTER TABLE accounting_entries ADD COLUMN cash_flow_item TEXT;
ALTER TABLE accounting_entries ADD COLUMN cash_flow_amount_cents INTEGER;

CREATE TABLE voucher_corrections (
  id                  TEXT PRIMARY KEY,
  original_voucher_id TEXT NOT NULL,
  correction_type     TEXT NOT NULL,        -- REVERSAL | SUPPLEMENT | CORRECTION
  correction_voucher_id TEXT,
  difference_json     TEXT,
  reason              TEXT NOT NULL,
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE period_end_definitions (
  id           TEXT PRIMARY KEY,
  def_type     TEXT NOT NULL,               -- TRANSFER | AMORTIZATION | ACCRUAL
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  source_json  TEXT NOT NULL,               -- 来源定义
  target_role  TEXT NOT NULL,               -- 目标科目角色
  direction    TEXT NOT NULL,
  amount_expr  TEXT NOT NULL,               -- 受限表达式
  valid_from   TEXT,
  valid_to     TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE period_end_runs (
  id           TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL,
  period       TEXT NOT NULL,
  status       TEXT NOT NULL,               -- RUNNING | COMPLETED | FAILED | SKIPPED
  amount_cents INTEGER NOT NULL DEFAULT 0,
  voucher_id   TEXT,
  error_code   TEXT,
  error_message TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE(definition_id, period)
);

CREATE TABLE profit_transfer_runs (
  id            TEXT PRIMARY KEY,
  period        TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL,              -- RUNNING | COMPLETED | FAILED | REVERSED
  voucher_id    TEXT,
  transferred_cents INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  reversed_at   TEXT,
  reversed_by   TEXT
);
```

#### 31.3.2 凭证更正链（AA-27）

- 所有冲销（手工 / 系统）统一走 `accounting-posting.js::reverseVoucher(voucherId, {reason, businessDate})`；
- 底层复用 `reverseSystemVoucher` 的镜像语义（方向反转、金额相等、`reversal_of_id` 唯一）；
- 补记（SUPPLEMENT）与更正（CORRECTION）生成新凭证并通过 `correction_of_id` 关联原凭证，
  同时在 `voucher_corrections` 记录差异摘要；
- 已过账分录**不得**原地编辑（无对应端点）；
- 冲销前置校验：原凭证存在、`status='POSTED'`、未被冲销、目标期间未关账、金额与方向镜像一致。

#### 31.3.3 出纳复核（AA-28）

```text
voucher.cashier_review_status
  NOT_REQUIRED ──(标记需复核)──> PENDING ──复核通过──> APPROVED
                                  └──复核驳回──> REJECTED ──(重新提交)──> PENDING
过账前置：cashier_review_status ∈ { NOT_REQUIRED, APPROVED }，否则 409 VOUCHER_CASHIER_REVIEW_REQUIRED
```

- 标记需复核：来源属于资金 / 银行 / 现金类分录时自动标记，或由模板显式声明；
- SOD：出纳复核人 ≠ 制单人 ≠ 审核人（三者互斥）；
- 复核通过不改变凭证金额，只改变复核状态；过账仍在既有 `approve → POSTED` 链路中完成。

#### 31.3.4 现金流量（AA-29）

- 现金流量分类挂在**分录行**（`accounting_entries.cash_flow_category` / `cash_flow_item` / `cash_flow_amount_cents`）；
- 现金流量表按期间、已过账凭证、分录行聚合为三段（经营 / 投资 / 筹资）+ 分类项 + 合计；
- 现金及现金等价物净增加额必须与资金子账（`settlement_account_movements`）在同一期间同口径对账，
  差异计入「未分类 / 差异」行并在对账中标记 `CASH_FLOW_TO_TREASURY`；
- 未指定分类的分录**必须**在表中以「未分类」显式出现，不得被静默排除；
- 现金流量表只取 `status='POSTED'`，与资产负债表 / 利润表口径一致。

#### 31.3.5 期末转账 / 摊销 / 计提（AA-30）

- 定义（`period_end_definitions`）绑定期间范围、来源（科目集合 / 业务事件 / 政策）、目标科目角色、
  方向与金额表达式；
- 执行（`period_end_runs`）按「定义 × 期间」幂等：同一 `(definition_id, period)` 只允许一条 run，
  重复执行返回既有结果（`already_run`）；
- 生成的凭证走**正常凭证链路**（`ENTERED → SUBMITTED → POSTED`），由模板 / 规则产生，
  不得直接写 `accounting_entries`；
- 未过账的期末凭证在关账检查中体现（AA-W1.12）。

#### 31.3.6 损益结转（AA-32）

- 结转范围：期间内所有损益类科目（`accounting_subjects.type IN ('REVENUE','COST','EXPENSE')`）
  的已过账余额；
- 结转方向：收入类贷方余额 → 贷记权益科目（损益结转科目）；成本费用类借方余额 → 借记权益科目；
- 结转金额 = 净损益；结转后损益类科目余额为 0，权益科目增加净损益；
- 结转生成一张 `source_type='PROFIT_TRANSFER'` 的凭证，进入正常审核 / 过账链路；
- **未结转时禁止关闭会计期间**（关账检查项 `PROFIT_NOT_TRANSFERRED` → BLOCKING）；
- 反结转：`REVERSED` 状态 + 生成反向凭证 + `reversed_at` 留痕 + 限 `ACCOUNTING_PERIOD_END_MANAGE` 且仅 ADMIN；
- 既有 `extended.js:1033` 的「未结转损益虚拟权益行补偿」在结转生效后**必须移除**，
  资产负债表改为读取真实权益科目余额；移除前后必须有一致性对照测试。

#### 31.3.7 端点

```text
POST   /api/accounting/vouchers/:id/cashier-review          标记 / 通过 / 驳回出纳复核
POST   /api/accounting/vouchers/:id/reverse                  统一冲销入口
POST   /api/accounting/vouchers/:id/supplement               补记凭证
GET    /api/accounting/vouchers/:id/corrections              更正链
GET    /api/accounting/period-end/definitions                期末处理定义列表
POST   /api/accounting/period-end/definitions                创建定义
PATCH  /api/accounting/period-end/definitions/:id            修改定义
POST   /api/accounting/period-end/definitions/:id/deactivate 停用定义
POST   /api/accounting/period-end/runs                       执行期末处理（period）
GET    /api/accounting/period-end/runs                       执行记录
POST   /api/accounting/profit-transfer                       损益结转（period）
GET    /api/accounting/profit-transfer                       结转状态
POST   /api/accounting/profit-transfer/reverse               反结转
GET    /api/accounting/cash-flow                             现金流量表（period）
```

#### 31.3.8 审计 / 错误 / SOD

| 动作 | 审计 action | 关键错误码 |
|---|---|---|
| 出纳复核 | `VOUCHER_CASHIER_REVIEW` | `VOUCHER_CASHIER_REVIEW_REQUIRED` / `VOUCHER_CASHIER_REVIEW_SOD_VIOLATION` |
| 冲销 | `VOUCHER_REVERSE` | `VOUCHER_ALREADY_REVERSED` / `VOUCHER_NOT_POSTED` / `PERIOD_CLOSED` |
| 补记 | `VOUCHER_SUPPLEMENT` | `VOUCHER_CORRECTION_NOT_ALLOWED` |
| 期末执行 | `PERIOD_END_RUN` | `PERIOD_END_ALREADY_RUN` / `PERIOD_END_EXPRESSION_INVALID` |
| 损益结转 | `PROFIT_TRANSFER` / `PROFIT_TRANSFER_REVERSE` | `PROFIT_TRANSFER_NOT_ALLOWED` / `PROFIT_TRANSFER_ALREADY_DONE` |

SOD：出纳复核人 ≠ 制单人 ≠ 审核人；结转执行人不得是本期凭证审核人；反结转限 ADMIN。

### 31.4 AA-W4 报表平台

#### 31.4.1 数据模型

```sql
CREATE TABLE report_templates (
  id          TEXT PRIMARY KEY,
  template_code TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL DEFAULT 'accounting-analytics',
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT | PUBLISHED | ARCHIVED
  version_no  INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE report_template_items (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL,
  item_code    TEXT NOT NULL,
  name         TEXT NOT NULL,
  level_no     INTEGER NOT NULL DEFAULT 1,
  sort_no      INTEGER NOT NULL,
  source_kind  TEXT NOT NULL,               -- GL_BALANCE | GL_ENTRY_SUM | AUX_BALANCE | BUSINESS_AGGREGATE | TEMPLATE_ITEM
  source_json  TEXT NOT NULL,               -- 数据源参数（科目 / 维度 / 期间口径）
  formula_expr TEXT,                        -- 受限表达式（引用其它 item_code）
  is_total     INTEGER NOT NULL DEFAULT 0,
  unit         TEXT,
  dimension_json TEXT,
  UNIQUE(template_id, item_code)
);
CREATE TABLE report_template_permissions (
  template_id TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  PRIMARY KEY(template_id, permission_code)
);
CREATE TABLE report_instances (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL,
  period       TEXT NOT NULL,
  status       TEXT NOT NULL,               -- DRAFT | SUBMITTED | APPROVED
  version_no   INTEGER NOT NULL DEFAULT 1,
  computed_at  TEXT,
  submitted_at TEXT, submitted_by TEXT,
  approved_at  TEXT, approved_by TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE(template_id, period, version_no)
);
CREATE TABLE report_instance_values (
  id          TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  item_code   TEXT NOT NULL,
  value_cents INTEGER,
  value_text  TEXT,
  formula_text TEXT,
  error_code  TEXT,
  error_message TEXT,
  UNIQUE(instance_id, item_code)
);
```

#### 31.4.2 公式引擎

- 独立实现于 `server/modules/accounting-expressions.js`（**与 `server/lib/formula-evaluator.js` 完全独立**）：
  - 工时公式文法标识符限定 `e_` 前缀、无函数调用、无跨表取数，**保持原样不动**；
  - 报表公式文法扩展标识符集合（`SOURCE_*` 绑定变量 + 其它 `item_code`），但**仍禁止**函数调用与任意代码；
  - 两个文法**不共用同一入口**，也不共用同一标识符命名空间；
- 取数数据源白名单：`GL_BALANCE`（科目期初 / 期末 / 发生额）、`GL_ENTRY_SUM`（分录汇总）、
  `AUX_BALANCE`（辅助项目）、`BUSINESS_AGGREGATE`（业务台账聚合，白名单表与列）；
- 所有取数绑定 `period` 与维度（部门 / 辅助项目 / 经营单元）；
- 求值失败 → 该 item 记 `error_code` / `error_message`，模板整体状态 `COMPUTED_WITH_ERRORS`，
  **不得**静默取 0，实例**不得**进入 `SUBMITTED`。

#### 31.4.3 生命周期

```text
report_instances.status
  DRAFT ──重算──> DRAFT
  DRAFT ──提交──> SUBMITTED ──审核通过──> APPROVED
                     └──审核驳回──> DRAFT
  APPROVED ──重算──> DRAFT（必须显式重开；历史版本保留）
```

- 每次重算生成新 `version_no`，历史实例值保留可回看；
- 提交人 ≠ 审核人（SOD）；`REPORT_INSTANCE_SUBMIT` / `REPORT_INSTANCE_APPROVE` 分离。

#### 31.4.4 端点

```text
GET    /api/accounting/report-templates
POST   /api/accounting/report-templates
PATCH  /api/accounting/report-templates/:id
POST   /api/accounting/report-templates/:id/publish
POST   /api/accounting/report-templates/:id/archive
GET    /api/accounting/report-templates/:id/preview     试算（不入实例）
POST   /api/accounting/report-instances                 实例化（template_id + period）
POST   /api/accounting/report-instances/:id/compute     重算
POST   /api/accounting/report-instances/:id/submit     提交
POST   /api/accounting/report-instances/:id/approve    审核
GET    /api/accounting/report-instances/:id             实例详情与取值
```

#### 31.4.5 兼容性

- 既有 `GET /api/reports/decision/*` 与 `src/pages/decision-reports.jsx` **完全不变**；
- 既有资产负债表 / 利润表 / 试算平衡端点与口径**完全不变**；
- 报表平台是**新增的**可配置报表能力，不替换既有固定报表。

### 31.5 AA-W5 固定资产完整生命周期

#### 31.5.1 数据模型

```sql
CREATE TABLE asset_types (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  useful_life_months INTEGER, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE TABLE asset_locations (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE TABLE depreciation_policies (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  method TEXT NOT NULL,                       -- STRAIGHT_LINE | DOUBLE_DECLINING | WORKLOAD
  useful_life_months INTEGER NOT NULL,
  residual_rate_bp INTEGER NOT NULL DEFAULT 0,   -- 基点，避免浮点
  start_rule TEXT NOT NULL,                   -- FROM_PURCHASE | FROM_TRANSFER | NEXT_PERIOD
  status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);

-- fixed_assets 扩展为资产卡片
ALTER TABLE fixed_assets ADD COLUMN card_no TEXT;
ALTER TABLE fixed_assets ADD COLUMN asset_type_id TEXT;
ALTER TABLE fixed_assets ADD COLUMN location_id TEXT;
ALTER TABLE fixed_assets ADD COLUMN policy_id TEXT;
ALTER TABLE fixed_assets ADD COLUMN card_status TEXT NOT NULL DEFAULT 'DRAFT'; -- DRAFT|ACTIVE|IDLE|DISPOSING|DISPOSED
ALTER TABLE fixed_assets ADD COLUMN custodian_user_id TEXT;
ALTER TABLE fixed_assets ADD COLUMN source_type TEXT;      -- PURCHASE_RECEIPT | MANUAL
ALTER TABLE fixed_assets ADD COLUMN source_id TEXT;
ALTER TABLE fixed_assets ADD COLUMN original_value_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fixed_assets ADD COLUMN book_value_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fixed_assets ADD COLUMN disposed_at TEXT;

CREATE TABLE asset_change_requests (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, request_no TEXT NOT NULL UNIQUE,
  change_type TEXT NOT NULL, status TEXT NOT NULL,   -- DRAFT|SUBMITTED|APPROVED|REJECTED|EFFECTIVE
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, reason TEXT NOT NULL,
  submitted_by TEXT, submitted_at TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE asset_split_merge_records (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, action TEXT NOT NULL,  -- SPLIT | MERGE
  status TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
  before_value_cents INTEGER NOT NULL, after_value_cents INTEGER NOT NULL,
  reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE asset_loans (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, loan_no TEXT NOT NULL UNIQUE, borrower_user_id TEXT,
  status TEXT NOT NULL,   -- OPEN | RETURNED | OVERDUE
  loaned_at TEXT NOT NULL, due_at TEXT, returned_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE asset_stocktakes (
  id TEXT PRIMARY KEY, stocktake_no TEXT NOT NULL UNIQUE, period TEXT NOT NULL,
  status TEXT NOT NULL,   -- DRAFT | COMPLETED
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE asset_stocktake_items (
  id TEXT PRIMARY KEY, stocktake_id TEXT NOT NULL, asset_id TEXT NOT NULL,
  book_location_id TEXT, actual_location_id TEXT, book_custodian_id TEXT, actual_custodian_id TEXT,
  difference_type TEXT, status TEXT NOT NULL, handled_at TEXT, handled_by TEXT);
CREATE TABLE asset_depreciation_runs (
  id TEXT PRIMARY KEY, period TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
  total_cents INTEGER NOT NULL DEFAULT 0, voucher_id TEXT,
  started_at TEXT NOT NULL, finished_at TEXT, created_by TEXT NOT NULL);
CREATE TABLE asset_disposals (
  id TEXT PRIMARY KEY, disposal_no TEXT NOT NULL UNIQUE, asset_id TEXT NOT NULL,
  disposal_type TEXT NOT NULL,   -- SCRAP | SALE | REDUCTION
  status TEXT NOT NULL,          -- DRAFT|SUBMITTED|APPROVED|POSTED|REJECTED
  disposal_date TEXT NOT NULL, proceeds_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL, submitted_by TEXT, submitted_at TEXT, approved_by TEXT, approved_at TEXT,
  voucher_id TEXT, created_at TEXT NOT NULL);
```

`asset_depreciations` 既有表扩展：`run_id`、`policy_id`、`voucher_id`、`auto_generated`。

#### 31.5.2 状态机与不变量

```text
fixed_assets.card_status
  DRAFT ──生效──> ACTIVE ⇄ IDLE
                      │
                      └──发起处置──> DISPOSING ──处置过账──> DISPOSED
```

- `ACTIVE` 之外不可计提折旧；
- 已计提折旧的资产**不得**直接改原值（必须走变更单，且变更单必须同步调整累计折旧或走处置）；
- 拆分 / 合并**价值守恒**：`Σ after_value_cents == before_value_cents`，累计折旧按原值比例结转；
  不守恒 → 409 `FIXED_ASSET_VALUE_NOT_BALANCED`，事务回滚；
- 折旧自动计提幂等：同一 `(period, asset_id)` 只允许一条折旧记录（`asset_depreciation_runs.period` 唯一 +
  唯一索引），重复执行返回既有 run；
- 折旧金额由政策 + 卡片原值 + 已提折旧计算，**不接受**任意金额；
- 处置必须生成凭证并结转处置损益；处置后卡片不可再计提折旧、不可再变更；
- 采购转固：`source_type='PURCHASE_RECEIPT'` 的来源**唯一**，重复转固 → 409 `FIXED_ASSET_ALREADY_TRANSFERRED`。

#### 31.5.3 调用与数据流

```text
purchase_receipts（采购域，只读）
  └─> fixed-assets.js::transferFromReceipt(receiptId, lines)
        ├─ 权限 + 来源未转固校验
        ├─ 事务：创建 fixed_assets（card_status=DRAFT → ACTIVE）+ source 绑定 + 审计
        └─ 失败 → 整笔回滚

asset_depreciation_runs（按期间）
  └─> fixed-assets.js::runDepreciation(period)
        ├─ 事务 A：创建 run（UNIQUE period）
        ├─ 逐资产计算（按政策）→ 写 asset_depreciations
        └─ 事务 B：生成凭证（voucher_templates / 规则）→ 回填 run.voucher_id
             失败 → run.status=FAILED，卡片不落折旧（幂等重入由 run 唯一性保证）

asset_disposals（处置）
  └─> 审批通过 → 生成凭证（处置损益）→ card_status=DISPOSING → POSTED → DISPOSED
```

#### 31.5.4 端点

```text
GET/POST   /api/fixed-asset-types            资产类别字典
GET/POST   /api/fixed-asset-locations        位置字典
GET/POST   /api/depreciation-policies        折旧政策
PATCH      /api/depreciation-policies/:id
GET        /api/fixed-assets                  资产卡片列表（保留既有响应形状 + 新增字段）
POST       /api/fixed-assets                  建卡（保留既有路径）
PATCH      /api/fixed-assets/:id              修改（仅 DRAFT / 未计提资产可直接改）
POST       /api/fixed-assets/transfer         采购转固
POST       /api/fixed-assets/:id/change-requests        发起变更
POST       /api/fixed-assets/change-requests/:id/submit
POST       /api/fixed-assets/change-requests/:id/approve
POST       /api/fixed-assets/:id/split        拆分
POST       /api/fixed-assets/merge            合并
POST       /api/fixed-assets/:id/loans        借用登记
POST       /api/fixed-assets/loans/:id/return 归还
POST       /api/fixed-assets/stocktakes       盘点建单
POST       /api/fixed-assets/stocktakes/:id/complete  盘点完成
POST       /api/fixed-assets/depreciation     折旧计提（按期间）— 扩展既有端点语义
GET        /api/fixed-assets/:id/depreciations
POST       /api/fixed-assets/:id/disposals     处置单
POST       /api/fixed-assets/disposals/:id/submit
POST       /api/fixed-assets/disposals/:id/approve
```

**兼容**：既有 `GET/POST /api/fixed-assets`、`PATCH /api/fixed-assets/:id`、
`POST /api/fixed-assets/depreciation`、`GET /api/fixed-assets/:id/depreciations` 的**路径保留**；
既有 `POST /api/fixed-assets/depreciation` 的「人工录入折旧金额」语义**废止**，
改为按期间自动计提；原人工录入路径改为受控 `ADJUSTMENT` 类型并留审计（**不得**静默移除能力）。

#### 31.5.5 测试

- 政策驱动的折旧金额正确性 + 与 GL 累计折旧科目对账；
- 折旧幂等：同期间重复计提 → 一次入账；
- 拆分 / 合并价值守恒（正例 + 不守恒反例）；
- 采购转固重复调用 → 409 且无第二张卡；
- 处置后计提折旧 → 409；
- 变更 / 处置 SOD 反例；
- route `fixed-assets` 在 registry 中为 enabled 且 launcher 可见。

### 31.6 AA-W6 存货核算深化

#### 31.6.1 数据模型

```sql
CREATE TABLE accounting_scopes (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  org_scope TEXT NOT NULL, owner_scope TEXT NOT NULL,   -- ORGANIZATION | OWNER | NONE
  status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE TABLE product_costing_profiles (
  id TEXT PRIMARY KEY, product_id TEXT, product_class TEXT,
  accounting_scope_id TEXT NOT NULL, valuation_method TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100, effective_from TEXT, effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE TABLE provisional_receipts (
  id TEXT PRIMARY KEY, receipt_no TEXT NOT NULL UNIQUE, source_receipt_id TEXT NOT NULL,
  scope_id TEXT, estimate_cents INTEGER NOT NULL, basis TEXT NOT NULL,
  status TEXT NOT NULL,   -- OPEN | CONVERTED | ADJUSTED
  converted_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE provisional_receipt_adjustments (
  id TEXT PRIMARY KEY, provisional_receipt_id TEXT NOT NULL, final_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL, voucher_id TEXT, status TEXT NOT NULL,
  reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE purchase_expenses (
  id TEXT PRIMARY KEY, expense_no TEXT NOT NULL UNIQUE, expense_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, incurred_date TEXT NOT NULL, supplier_id TEXT,
  status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE purchase_expense_allocation_rules (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  basis_type TEXT NOT NULL,   -- VALUE | QUANTITY | WEIGHT | EQUAL
  scope_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE TABLE purchase_expense_allocations (
  id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, rule_id TEXT NOT NULL,
  target_product_id TEXT, target_scope_id TEXT, allocated_cents INTEGER NOT NULL,
  voucher_id TEXT, status TEXT NOT NULL,   -- DRAFT | POSTED
  created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE cost_adjustments (
  id TEXT PRIMARY KEY, adjustment_no TEXT NOT NULL UNIQUE, adjustment_type TEXT NOT NULL,
  product_id TEXT, scope_id TEXT, amount_cents INTEGER NOT NULL, reason TEXT NOT NULL,
  voucher_id TEXT, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE production_cost_closings (
  id TEXT PRIMARY KEY, production_order_id TEXT NOT NULL, period TEXT NOT NULL,
  wip_cents INTEGER NOT NULL, product_cost_cents INTEGER NOT NULL, variance_cents INTEGER NOT NULL,
  variance_target TEXT NOT NULL, voucher_id TEXT, status TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(production_order_id, period));
```

#### 31.6.2 关键算法与不变量

- **计价方法优先级**：属性级（`product_id`）> 类别级（`product_class`）> 默认；
  同级多条命中 → 取 `priority` 最小者，仍并列 → 409 `COSTING_PROFILE_AMBIGUOUS`；
- 计价方法与追踪策略的既有兼容性校验**保留**（`financial-inventory.js::valuationMethod`），
  本域只负责**选择**方法，不改写既有校验语义；
- 已有估值移动的物料改计价方法 → 409 `COSTING_METHOD_CHANGE_NOT_ALLOWED`（与既有
  `changeValuationMethod` 语义一致，不新增第二套规则）；
- **暂估差异**：差异 = 正式金额 − 暂估金额；差异必须通过 `provisional_receipt_adjustments`
  生成调整凭证，**不得**改写 `provisional_receipts.estimate_cents`；
- **费用分摊**：分摊基数与权重必须可重算一致；分摊金额必须写入
  `inventory_valuation_movements`（权威价值流水）并生成凭证；
  分摊总额 ≠ 费用总额 → 409 `PURCHASE_EXPENSE_ALLOCATION_NOT_BALANCED`；
- **完工成本结转**：`product_cost_cents + variance_cents == wip_cents`；差异去向必须显式
  （`variance_target` ∈ `SCRAP` / `ABSORBED` / `GOOD_UNIT`）；
- **成本调整**：每次调整必须生成凭证并可追溯到原因与授权人；
- **核算关账检查清单**（AA-W6.15）：估值 ↔ GL 差异、未估值历史移动（`LEGACY_UNVALUED`）、
  负库存 / 残值、暂估未结转、成本调整未过账 —— 全部为 `BLOCKING` 或 `WARNING`，
  与 `systemHealth` 现有检查**合并展示**而非重复实现。

#### 31.6.3 端点

```text
GET/POST /api/accounting/scopes                        核算范围
GET/POST /api/accounting/costing-profiles               计价配置
POST   /api/accounting/provisional-receipts             暂估入库单
POST   /api/accounting/provisional-receipts/:id/adjust  暂估差异调整
GET/POST /api/purchase-expenses                         采购费用登记
GET/POST /api/purchase-expense-allocation-rules         分摊规则
POST   /api/purchase-expenses/:id/allocate              执行分摊
GET    /api/accounting/costing-close-checklist          核算关账异常清单
POST   /api/accounting/cost-adjustments                 成本调整
POST   /api/accounting/production-cost-closings         完工成本结转
```

### 31.7 AA-W7 经营会计

#### 31.7.1 数据模型

```sql
CREATE TABLE management_books (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  legal_entity TEXT NOT NULL, base_currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL);
CREATE TABLE profit_centers (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  management_book_id TEXT NOT NULL, org_unit TEXT, owner_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE TABLE internal_settlement_prices (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, from_profit_center_id TEXT, to_profit_center_id TEXT,
  price_cents INTEGER NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE TABLE operating_ledger_entries (
  id TEXT PRIMARY KEY, management_book_id TEXT NOT NULL, profit_center_id TEXT,
  period TEXT NOT NULL, business_date TEXT NOT NULL,
  source_kind TEXT NOT NULL,   -- GL | BUSINESS
  source_id TEXT, account_code TEXT NOT NULL,
  debit_cents INTEGER NOT NULL DEFAULT 0, credit_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT, created_at TEXT NOT NULL);
CREATE TABLE cost_collection_plans (
  id TEXT PRIMARY KEY, management_book_id TEXT NOT NULL, period TEXT NOT NULL,
  source_json TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE allocation_rules (
  id TEXT PRIMARY KEY, management_book_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  basis_type TEXT NOT NULL, driver_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE TABLE allocation_results (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, rule_id TEXT NOT NULL,
  source_json TEXT NOT NULL, target_profit_center_id TEXT NOT NULL,
  allocated_cents INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE internal_settlements (
  id TEXT PRIMARY KEY, management_book_id TEXT NOT NULL, period TEXT NOT NULL,
  from_profit_center_id TEXT NOT NULL, to_profit_center_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE operating_period_closures (
  id TEXT PRIMARY KEY, management_book_id TEXT NOT NULL, period TEXT NOT NULL,
  status TEXT NOT NULL,   -- OPEN | CLOSED
  closed_by TEXT, closed_at TEXT, reopen_reason TEXT, reopened_by TEXT, reopened_at TEXT,
  UNIQUE(management_book_id, period));
```

#### 31.7.2 经营台账与勾稽

- `operating_ledger_entries` 只取**已过账**事实；`source_kind='GL'` 时 `source_id` 指向凭证分录，
  `source_kind='BUSINESS'` 时指向业务单据；
- 经营台账归集是**幂等**的：同一来源重复归集不得重复入账（以来源键唯一约束）；
- 经营损益 = 经营收入 − 内部转移价成本 − 分摊费用；
- **勾稽要求**：经营损益汇总与法定损益的差额必须能由「未分配 / 内部交易抵消 / 口径差异」解释，
  差异必须显式列出，不得出现无法解释的差额。

#### 31.7.3 端点

```text
GET/POST /api/management/books                     经营账簿
GET/POST /api/management/profit-centers             经营单元
GET/POST /api/management/internal-prices            内部结算价格
GET     /api/management/ledger?period=              经营台账
POST    /api/management/collect                     归集（period）
GET/POST /api/management/collection-plans           归集计划
GET/POST /api/management/allocation-rules           分摊规则
POST    /api/management/allocation-runs             执行分摊（period）
GET     /api/management/profit-loss?period=         经营损益
POST    /api/management/period-closures             经营关账
POST    /api/management/period-closures/:id/reopen  经营反关账
```

### 31.8 迁移与 Schema 策略

#### 31.8.1 迁移文件

| 文件 | 内容 |
|---|---|
| `server/migrations/accounting-events-schema.js` | `accounting_events` / `accounting_event_attempts` / `accounting_reconciliation_runs` / `accounting_reconciliation_items` / `accounting_close_check_snapshots` |
| `server/migrations/accounting-rules-schema.js` | `voucher_templates` 扩展 + `voucher_template_items` + `accounting_rule_bindings` + `accounting_generation_runs` |
| `server/migrations/accounting-period-end-schema.js` | 凭证 / 分录扩展 + `voucher_corrections` / `period_end_definitions` / `period_end_runs` / `profit_transfer_runs` |
| `server/migrations/accounting-reporting-schema.js` | `report_templates` / `report_template_items` / `report_template_permissions` / `report_instances` / `report_instance_values` |
| `server/migrations/fixed-assets-schema.js` | 资产字典与政策 + `fixed_assets` 扩展 + 变更 / 拆并 / 借用 / 盘点 / 折旧 / 处置表 |
| `server/migrations/inventory-costing-schema.js` | 核算范围 / 计价配置 / 暂估 / 费用分摊 / 成本调整 / 完工结转表 |
| `server/migrations/management-accounting-schema.js` | 经营会计全部表 |

#### 31.8.2 迁移纪律

- **SQLite 与 MySQL 双路径**：使用仓库既有 `addColumn` / `CREATE TABLE IF NOT EXISTS` 辅助，
  禁止使用 MySQL 专有语法；`TEXT` 类型承载 JSON；
- 所有新增金额字段为**安全整数分**，禁止 REAL / FLOAT；
- 迁移**幂等**：`IF NOT EXISTS` / `addColumn` 幂等包装，重复执行不报错；
- 迁移必须注册进既有 migration runner 顺序，且**不得**在既有 migration 文件中插入新语句
  （保持历史 migration 逐字不变，见 AGENTS.md §2.5）；
- `voucher_templates.entries_json` → `voucher_template_items` 的归一化必须**可逆**：
  原 `entries_json` 保留不删；不可解析项记 `parse_status='LEGACY_UNRESOLVED'` 并在模板列表中显式标记；
- **回滚策略**：全部新增表可 `DROP TABLE` 回滚；`ALTER TABLE ADD COLUMN` 回滚在 SQLite 上通过
  表重建、在 MySQL 上通过 `DROP COLUMN`（目标 MySQL ≥ 8.0），回滚脚本随 migration 一并提供；
  `ALTER TABLE` 新增列均为**可空或有默认值**，因此不破坏既有读写路径。

### 31.9 事务、并发与幂等总则

- 所有 mutation 必须在 `transaction(db, ...)` 内完成，且**在事务内重读权威状态**（AGENTS.md §6）；
- 高并发写（生成凭证、折旧计提、费用分摊、归集与分摊）必须使用既有锁原语：
  - MySQL：`acquireParentBalanceLock` / `GET_LOCK`（`financial-controls.js`）；
  - 依赖唯一约束实现最终一致（事件唯一键、折旧 run 期间唯一键、分摊幂等键）；
- 幂等键统一由 `financial-controls.js::idempotencyReplay` / `saveIdempotency` 管理，
  指纹不一致 → 409 `IDEMPOTENCY_KEY_CONFLICT`；
- 失败副作用必须为零：任何写操作失败时不得留下半张凭证、半个 run、错位的卡片状态。

### 31.10 错误码总则

| 类别 | HTTP | 约定 |
|---|---|---|
| 输入 / 表达式非法 | 400 | `INVALID_*` / `EXPRESSION_*` / `*_REQUIRED` |
| 权限 / SOD | 403 | `*_PERMISSION_DENIED` / `*_SOD_VIOLATION` |
| 对象不存在 | 404 | `*_NOT_FOUND` |
| 状态 / 期间 / 幂等 / 守恒冲突 | 409 | `*_NOT_ALLOWED` / `*_ALREADY_*` / `*_REQUIRED` / `*_NOT_BALANCED` |
| 引用保护 | 409 | `*_IN_USE` / `*_HAS_REFERENCES` |

所有错误必须带**稳定错误码**（前端与测试依赖），不得只返回自由文本。

### 31.11 审计总则

| 域 | 审计 action 前缀 |
|---|---|
| 会计事件 | `ACCOUNTING_EVENT_*` |
| 模板 / 规则 | `VOUCHER_TEMPLATE_*` / `ACCOUNTING_RULE_*` / `ACCOUNTING_GENERATION_RUN` |
| 凭证 | `VOUCHER_CASHIER_REVIEW` / `VOUCHER_REVERSE` / `VOUCHER_SUPPLEMENT` |
| 期末 | `PERIOD_END_RUN` / `PROFIT_TRANSFER` / `PROFIT_TRANSFER_REVERSE` |
| 对账 | `ACCOUNTING_RECONCILIATION_RUN` |
| 报表 | `REPORT_TEMPLATE_*` / `REPORT_INSTANCE_SUBMIT` / `REPORT_INSTANCE_APPROVE` |
| 固定资产 | `FIXED_ASSET_*` |
| 存货核算 | `COSTING_*` / `PROVISIONAL_*` / `PURCHASE_EXPENSE_*` / `PRODUCTION_COST_CLOSE` |
| 经营会计 | `MANAGEMENT_*` |

审计记录必须包含：actor、目标对象、前后值摘要、原因（要求时）、时间。

### 31.12 兼容性回归清单

实施期间下列既有行为**必须**保持，并由回归测试固定：

1. `POST /api/accounting-vouchers` 录入 → 提交 → 审核 → 过账链路与状态机；
2. 报表 POSTED-only 口径与期间 / 业务日期口径；
3. `createSystemVoucher` / `reverseSystemVoucher` 对既有调用方的行为（含采购委外加工费过账路径）；
4. `systemHealth` 全部既有 check 的 code 与差异计算；
5. 库存估值权威流水 / 派生缓存关系与 `LEGACY_UNVALUED` 阻断；
6. 库存月结先于会计期间结账的顺序约束；
7. 反结账的 ADMIN 限制、原因必填与 `period_reopen_history` 留痕；
8. 既有 5 张执行报表（decision reports）的口径与入口；
9. `GET /api/voucher-templates` 的路径与响应形状；
10. `GET/POST/PATCH /api/fixed-assets` 既有路径与字段；
11. `applicationRegistry` 的 route key 唯一与 launcher / permission exposure 一致；
12. 既有 Finance / Inventory / Procurement / Manufacturing 模块的全部行为。

### 31.13 测试策略

| 层级 | 范围 | 归属包 |
|---|---|---|
| 单元 | 表达式解析、计价优先级、折旧计算、分摊守恒、结转金额 | AA-W2 / W4 / W5 / W6 / W7 |
| 合同 | 每个新端点的权限、SOD、状态机、幂等、错误码 | 全部 |
| 集成 | 业务域 → 会计事件 → 凭证 → GL → 报表 → 对账 → 关账 | AA-W1 / W2 / W3 |
| 回归 | §31.12 全清单 | 全部 |
| 数据库 | SQLite 与 MySQL 双路径的 schema 与行为一致 | 全部（含 migration） |
| 并发 | 事件生成、折旧计提、费用分摊、归集分摊的并发写 | AA-W1 / W5 / W6 / W7 |
| 浏览器 | 320 / 390 / 430 / 680 四档工作面 | 新增 / 改造工作面 |

- 新增测试文件必须登记进 `scripts/testing/test-suites.js`（FAST / FULL / HEAVY 语义保持）；
- 每项新能力至少 1 个正例 + 1 个反例；高风险域（估值、成本、结账、经营分配）至少 1 个反例；
- 禁止 `skip`、禁止删断言、禁止降级分类。

### 31.14 实施顺序与 Gate

```text
AA-W1 → AA-W2 → AA-W5 → AA-W3 → AA-W6 → AA-W4 → AA-W7 → 整域 Acceptance
```

| 序 | 包 | 前置 | Gate |
|---|---|---|---|
| 1 | AA-W1 | 无 | FAST + FULL + 文档一致性 |
| 2 | AA-W2 | W1 | FAST + FULL |
| 3 | AA-W5 | W1 | FAST + FULL + HEAVY（migration） |
| 4 | AA-W3 | W1、W2 | FAST + FULL + HEAVY |
| 5 | AA-W6 | W1、W3 | FAST + FULL + HEAVY |
| 6 | AA-W4 | W1、W3 | FAST + FULL + HEAVY |
| 7 | AA-W7 | W3、W4 | FAST + FULL + HEAVY |
| 8 | 整域 | 1–7 | FULL + HEAVY + MySQL parity / concurrency + 浏览器四档 + 域级 Acceptance（业务所有者签发） |

**回滚**：每包独立提交（精确暂存），任一包验收失败可按包回退；migration 回滚脚本随包提供；
回滚不得回退已验收的前序包。

### 31.15 设计状态

| 项 | 值 |
|---|---|
| Design 状态 | `APPROVED_FOR_IMPLEMENTATION_PENDING_OWNER_CONFIRMATION` |
| Requirement 状态 | `APPROVED`（`docs/requirements/accounting-analytics.md` §35，2026-11-10） |
| Implementation 状态 | `NOT_AUTHORIZED` |
| Domain Acceptance | 未签发 |
| Capability Freeze | 未签发 |

---

**ACCOUNTING & ANALYTICS DOMAIN TECHNICAL DESIGN COMPLETE — HARD STOP, AWAITING IMPLEMENTATION APPROVAL**
