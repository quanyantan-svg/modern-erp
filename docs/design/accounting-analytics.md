# Accounting & Analytics — Technical Design

> 状态：`ACTIVE`
> Owner：Accounting & Analytics
> 权威来源：`solution.md` §0.1 Domain Design 入口 + 本文件 `§31`
> 来源：新增正文（2026-11-10 建立 Accounting & Analytics Domain Technical Design）。
> 上游合同：`docs/requirements/accounting-analytics.md` `§35`（`APPROVED`，2026-11-10）。
> 审计基线：`docs/audits/accounting-analytics-capability-audit-20261110.md`（`v0.1`，SHA `eee92c2`）。
> 2026-11-14：业务所有者批准 Requirement §35.11 与新增 §31.16（Design `APPROVED`）并授权实施；
> 既有域级 Acceptance / Freeze 仅作有界解冻。

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
GET        /api/fixed-assets/:id/disposals     处置单查询（2026-11-14 有界增补，见下）
POST       /api/fixed-assets/disposals/:id/submit
POST       /api/fixed-assets/disposals/:id/approve
```

**有界增补（2026-11-14）**：新增 `GET /api/fixed-assets/:id/disposals` 只读端点。
原表只定义了处置单的**写入**链路（建单 / 提交 / 审核），缺少**读取**端点，
而固定资产操作面（`src/pages/fixed-assets.jsx` 的「处置单」区块）必须读取该资产的处置单列表：
调用此前恒定返回 404，且被前端的 `catch` 吞掉，导致处置单区块**永远为空**。
本次增补只读、不引入 schema / 状态机 / 会计语义变更，响应形状为 `{ disposals: [...] }`
（字段与 `asset_disposals` 表一致），权限为 `FIXED_ASSETS_VIEW` / `FIXED_ASSETS_MANAGE`。
既有 AA-17 能力结论与冻结范围不变。

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
- **委外成本口径**（AA-W6.17～AA-W6.19，业务所有者 2026-11-11 裁定选项 A）：
  委外成本 = 材料成本 + 加工费，其 canonical 实现由 **Procurement & Outsourcing 域**承担
  （材料成本读 `inventory_valuation_movements` 的倒冲材料价值；加工费读
  `outsourcing-gl-policy.js::resolveProcessingFeeAccountingProfile` 解析的会计档案）。
  本域**只读引用**该结果，**不新增**委外成本事实表、口径常量或第二条过账路径；
  `server/modules/accounting-inventory-cost.js` 不含任何 `OUTSOURCE` 取数规则，
  也不得在后续迭代中引入 —— 这条边界由审计台账 §7.3 的逐项复核固定。

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
| Design 状态 | `APPROVED` → 已实施（AA-W1..AA-W7 七个范围包按 §31.14 顺序全部落地） |
| Requirement 状态 | `IMPLEMENTED`（`docs/requirements/accounting-analytics.md` §35，2026-11-10 批准、2026-11-11 实施完毕） |
| Implementation 状态 | `COMPLETE`（提交 `3876bd3` / `e40a015` / `943414c` / `5e6739d` / `bc2035d` / `d9e7319`；前端工作面 `src/pages/accounting-analytics.jsx` 按 §31.0.3 承载 5 个新 route） |
| Domain Acceptance | **已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS`，2026-11-12） |
| Capability Freeze | **已签发**（`ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`） |

**实施偏离登记（按 §31.0.3 执行）**：本域 5 个新 route（`accounting-events` / `accounting-reconciliation` /
`accounting-reports` / `accounting-costing` / `management-accounting`）全部绑定到单一页面
`src/pages/accounting-analytics.jsx` 的 5 个具名导出，每个 route 只有一个 active executable screen；
`fixed-assets` 由 `enabled:false` 改为 enabled 并迁出到 `src/pages/fixed-assets.jsx`，未新增第二套固定资产 route。

---

**ACCOUNTING & ANALYTICS DOMAIN TECHNICAL DESIGN IMPLEMENTED — AWAITING OWNER ACCEPTANCE**

### 31.16 法定与经营期间控制接入设计（R-02）

> 状态：`APPROVED`（业务所有者 2026-11-14 批准）；上游合同：Requirement §35.11；公共 guard 合同：Platform Design §32.15；
> Implementation：已授权（2026-11-14 起实施）。本节是既有域级 Freeze 的有界解冻，不重开 AA-W1..AA-W7 其他能力。

#### 31.16.1 Canonical owner 与迁移边界

新增 `server/modules/accounting-period-control.js`，从 `server/modules/extended.js` 有界迁移法定期间 list/create/
close/reopen/checklist handler 及状态机；完成 caller proof、切换 `ownedRouteTable` dispatch 与 focused tests 后，
删除旧 active implementation，`extended.js` 不保留第二套逻辑。`period_closures` 仍是 Legal 权威表。

`server/modules/management-accounting.js` 继续拥有 `OPERATING(managementBookId)` close/reopen 和归集、分摊、
内部结算；`operating_period_closures` 仍是经营状态权威。`server/app.js` 的手工凭证与所有系统凭证统一调用具名
voucher action，删除本地 `checkPeriodNotClosedForVoucher`。`createSystemVoucher` 不接受通用 bypass boolean；
期末转账/损益结转以注册表中的纯 GL action 明确只要求 `LEGAL_ACCOUNTING`。

#### 31.16.2 Legal 状态机、依赖与顺序

Legal close 必须按会计期间自然顺序执行：只允许最早 OPEN 且前序均 CLOSED 的期间关闭；缺期、重复、重叠或
断裂报 `PERIOD_STATE_INVALID / PERIOD_SEQUENCE_INVALID`。Legal reopen 只允许最新 CLOSED 期间，reason 必填。

close 在一个事务内按 Platform §32.15 rank 锁 Inventory anchor、AR/AP/TREASURY state、Legal anchor，随后重读：

1. Inventory 已关至会计期末；
2. AR、AP、TREASURY 各自已关至会计期末；
3. 目标是最早可关闭 Legal 期间；
4. checklist 的其他会计前置条件仍满足。

任一不满足即零状态变化。Legal reopen 先锁 Legal，再按 bookId 排序锁相关 management book，若该 Legal 期间
覆盖的任一 Operating period 仍为 CLOSED，则报 `PERIOD_DEPENDENCY_NOT_CLOSED`。这形成
Inventory/Finance → Legal → Operating 的关闭顺序和反向重开顺序。

#### 31.16.3 Operating 状态机与危险路径封闭

Operating 状态以 management book + period 唯一，`OPEN → CLOSED → OPEN`；关闭前必须证明对应 Legal period
已 CLOSED。关闭后，下列动作均在同一事务内锁 `management_books` 行并调用 Operating action：成本归集、
分摊执行/重跑、内部结算、经营结果重算及任何改写该期结果的 mutation。查询与报表不被误阻断。

现有「close 后仍可 collect/allocation」路径必须迁移到 guard；不得用页面隐藏代替。重开只允许最新已关闭经营
期间，reason 必填，并在重开后才允许重算；已发布的财务报表/凭证若有独立不可逆状态，仍由其自身合同额外阻断。

#### 31.16.4 事务、RBAC / SOD、错误与审计

voucher/GL mutation 的标准流为：权限 → transaction → 重读凭证/来源日期及状态 → Legal guard → 幂等与借贷
平衡 → 写凭证/分录/余额/审计 → commit。Operating mutation 类似，但只检查具名 Operating axis；跨轴动作使用
registry 并集，不由调用方拼装。

沿用 `PERIOD_CLOSE_VIEW/MANAGE`（Legal）与 `MANAGEMENT_ACCOUNTING_VIEW/MANAGE`（Operating）；Legal reopen
继续要求既有 ADMIN 限制，所有后端 fail closed。Operating closer 不得是目标期间所用 allocation rule/result 的
创建人或执行人，复用已批准 SOD 判定；权限与 SOD 都通过后才可迁移状态。

**经营关账 SOD 的落地设计（2026-11-14 增补，业务所有者裁定「加 `created_by` 列后按原文实现」）**

| 项 | 内容 |
|---|---|
| 归因来源 | 业务行上的权威归属字段：`allocation_rules.created_by`（规则创建人）、`allocation_results.created_by`（分摊执行人）。**不得**用 `audit_logs` 等可变证据作为判定输入 |
| Schema | `server/migrations/management-accounting-schema.js` 对两张表**加列** `created_by TEXT`（可空）+ 索引；既有行按审计证据一次性回填（规则：审计动作 `CREATE` / 实体类型 `ALLOCATION_RULE`；分摊执行人：审计动作 `ALLOCATE` / 实体类型 `MANAGEMENT_ALLOCATION` / 实体 id = 该结果的 `plan_id`）；回填不到的行留空 |
| 新写入 | 建规则写 `actor.id`；跑分摊写 `actor.id`（`allocation_results.created_by`） |
| 判定点 | `closeOperatingPeriod` 的写事务内：法定期间前置通过后、状态写入前，读取目标期 `allocation_results` 及其引用的 `allocation_rules` 的归属 |
| 规则 | 关账人 ∈ 该期分摊结果的执行人，或 ∈ 该期所用规则的创建人 → 拒绝；**归属缺失（NULL）→ 同样拒绝**（fail closed，不得默认放行） |
| 错误 | `409 MANAGEMENT_PERIOD_SOD_VIOLATION`（附 period / book / 冲突角色与归属 id）；`409 MANAGEMENT_PERIOD_SOD_ATTRIBUTION_MISSING`（附缺失归属的行数与 id） |
| 与平台 SOD 引擎的关系 | 经营关账**不是**审批决策点（无 initiator resolver），因此**不复用** `platform-sod.js` 的规则引擎；它只复用 Platform §32.15.5 的错误与审计合同（拒绝证据 exactly-once、结构化阻断字段） |
| 审计 | 拒绝在回滚后由中央 catch 写一次 `PERIOD_CONTROL` 拒绝审计（含 actor / 动作 / 期间 / 阻断原因）；成功关账在同事务记录 period、book、before/after、actor |
| 兼容 | 加列不改既有行语义；关账人若正是该期分摊的参与者则从「可关账」变为「被拒」（收紧）。既有测试夹具须改用**未参与该期分摊**的角色关账 |

错误及 rejection audit 使用 Platform §32.15 合同。成功 close/reopen 同事务记录 period、book、before/after、
reason、actor；409 在回滚后事务外 exactly-once 记录。前端 Accounting Period 与 Management Accounting 的
reopen 操作必须提交 reason（现有空对象调用不再允许），并显示依赖/顺序阻塞；无 MANAGE 权限只读。

#### 31.16.5 Schema / migration、兼容与测试

本域不合并、不 DROP `period_closures`、`operating_period_closures`、`period_end_runs` 等表；后者只作为执行证据，
不能代替期间状态。Platform additive migration 提供 Legal anchor；Operating 复用稳定 `management_books` 行。
历史关闭事实不回填、不重写，GET/CHECK 不修复。

保持现有路由和 period JSON 结构；库存/Finance 依赖通过 preflight 新增只读字段表达。Legal 已关闭错误继续使用
`FINANCIAL_PERIOD_CLOSED`；Operating 使用 `OPERATING_PERIOD_CLOSED`。更严格的顺序和 mutation 阻断是合同修复。

focused tests 覆盖 Legal 顺序/最新期、三类 Finance 与 Inventory 前置、voucher 与 close 竞态、Operating close
后 collect/allocation/internal settlement 全拒绝、reopen 逆序、SOD、reason、零副作用与审计 exactly once。
更新 `period.test.js`、period UI、AA-W7/management accounting suites；真实 MySQL 使用独立 handler/连接验证
Legal close vs voucher/AR/AP，以及 Operating close vs collect/allocation，并提供 snapshot 证据。

**经营关账 SOD 的测试增量（2026-11-14 增补）**：关账人即该期分摊规则创建人 → 409 且期间状态不变；
关账人即该期分摊结果执行人 → 409 且期间状态不变；归属缺失（NULL）→ 409
`MANAGEMENT_PERIOD_SOD_ATTRIBUTION_MISSING`；换用未参与该期分摊的角色 → 关账成功且审计完整；
回填后的历史行归属可核验（规则创建人与分摊执行人均可查到）。

#### 31.16.6 回滚与 HARD STOP

ownership migration 必须逐步完成 caller proof；未切换前旧 owner 可存在，切换后不得保留双 active handler。
回滚按整个 R-02 逻辑单元执行，保留 additive anchor 与全部历史；禁止只恢复 `extended.js` 的旧 gate 或空 reason
调用。整体回退后 R-02 必须重新标记为生产发布 blocker。

本节 Design：`APPROVED`（2026-11-14）；Implementation：已授权并于 2026-11-14 实施。
**2026-11-14 增补**（业务所有者裁定「加 `created_by` 列后按原文实现」）：§31.16.4 / §31.16.5 的经营关账
SOD 归因设计状态为 `APPROVED`，其 **Implementation 尚未授权** —— 按 AGENTS.md §4.3，Design 完成后
HARD STOP，须业务所有者明确批准后方可实施（加列 migration + 归属回填 + 关账判定 + 测试）。
**HARD STOP**：专属 ACK-4 campaign 仍须业务所有者单独批准后方可运行。

---

## 31.17 存货与成本科目的手工凭证守卫与 GRNI 检查口径统一设计（F-06 附属，`APPROVED` → `IMPLEMENTED`，2026-11-18）

> 对应 Requirement §35.12（`AA-VAL-01..04`）。授权来源：业务所有者 2026-11-18 指令
> 「F-06 与 GRNI 口径立项走 Requirement → Design → Implementation」与「F-02 一并修好」。

### 31.17.1 手工凭证守卫

`POST /api/accounting-vouchers` 在校验借贷平衡之后、建凭证之前，追加一道守卫：

```text
受控科目集合 = account_role_mappings 中 role_code ∈ {RAW_MATERIAL_INVENTORY, FINISHED_GOODS_INVENTORY,
  OTHER_INVENTORY, WIP, GRNI} 的 subject_id
  → 命中任一 entry.subjectId
      → 409 MANUAL_VOUCHER_CANONICAL_SUBJECT
        resolution: 请通过库存调整单 / 成本调整过账，或对既有凭证做补记 / 冲销
      → 零副作用：不产生 accounting_vouchers / accounting_entries 行
```

> **范围说明**：本守卫只覆盖**存货科目族**。成本与差异科目（`COGS` 等）本轮不纳入 ——
> 自由成本调整同时牵涉损益结转合同（`AA-W3` 真实损益结转），纳入前必须先裁定该合同；
> 应收 / 应付 / 现金 / 税金 / 收入科目同理（属 Finance Operations 与本域的其余合同）。
> 这些科目作为开放项登记在 §35.12 `AA-VAL-01` 的残余登记里。

- 科目集合**由角色码推导**，不硬编码科目号：科目目录调整时守卫自动跟随。
- 既有能力不回退：非受控科目的自由手工凭证仍可创建 / 提交 / 审批（既有 SOD 与期间守卫不变）。
- 不新增权限码、不改 `role_permissions`、不改任何角色的权限集合。

### 31.17.2 GRNI 检查口径统一

平台对在途物资（1407）的记账约定是**贷方口径**：确认收货时贷记、账单结转时借记。
因此「未结转收货金额」= 贷 − 借。三处实现必须同口径：

| 实现 | 子账侧 | 总账侧 | 本节变化 |
|---|---|---|---|
| `server/modules/financial-inventory.js`（AA-W6.15 检查清单 `RECEIPT_GRNI_TO_GL`） | 已确认收货 − 已过账账单冲抵 | 借 − 贷 | 改为**贷 − 借** |
| `server/modules/accounting-reconciliation.js`（AA-W1 对账 `GRNI_TO_GL`） | 误用 `item_kind='FINAL'` | 借 − 贷 | 子账侧改为 **`item_kind='PROVISIONAL'`**；总账侧取**贷 − 借** |
| `server/modules/commercial-golive.js`（既有同口径实现） | 同上 | 贷 − 借 | 不变（作为口径基准） |

### 31.17.3 存货价值对账的两侧同域

`INVENTORY_VALUE_TO_GL` 的价值流水侧覆盖**全部**存货估值池（含在制 / 委外在途仓位），
总账侧因此必须包含在制科目：角色集合由
`['RAW_MATERIAL_INVENTORY','FINISHED_GOODS_INVENTORY','OTHER_INVENTORY']`
改为 `['RAW_MATERIAL_INVENTORY','FINISHED_GOODS_INVENTORY','OTHER_INVENTORY','WIP']`。

### 31.17.4 Schema、事务、状态、审计、错误、兼容

- **Schema / migration**：**无**。
- **事务**：守卫在建凭证之前执行，拒绝时不产生任何写入；既有建凭证事务不变。
- **状态机 / 审批 / 审计**：不涉及（凭证的提交 / 审批 / 审计路径不变）。
- **错误行为**：409 + `MANUAL_VOUCHER_CANONICAL_SUBJECT` + `resolution`；既有错误码不变。
- **兼容性**：既有凭证与历史数据不变；本节只阻止**新的**非法手工凭证。
- **残余登记**：应收 / 应付 / 现金 / 银行 / 税金 / 收入科目本轮不纳入守卫（见 §35.12 `AA-VAL-01`
  的残余登记）；委外库存异动缺总账分录属 Procurement & Outsourcing 域（其 §31.21.4-5），
  本节不实现。

### 31.17.5 测试与状态

- **合同测试**（`server/accounting-canonical-subject-guard.test.js`，登记 FULL）：
  命中受控科目 409 + 零副作用；非受控科目仍可创建并出现在试算平衡；GRNI 三个实现的同口径断言；
  变异对照（清空守卫集合 / 改回借 − 贷）。
- **状态**：Requirement §35.12 `APPROVED`（2026-11-18）；本节 Design `APPROVED`（同日）；
  Implementation **已实施**（2026-11-18）。真实 MySQL 的结构变更、Acceptance / Freeze 签发、
  发布与部署**未授权**。

### 31.18 手工凭证守卫的受控科目族扩展与旁路闭合（`APPROVED` → `IMPLEMENTED`，2026-11-18）

> **授权来源**：业务所有者 2026-11-18「将三项收口 然后将三项残余修复」并就本节两项口径裁定
> （受控族扩展到成本与差异族；一并封住改分录与冲销两个旁路）。对应 Requirement §35.13。
>
> **未授权**：真实 MySQL 的结构变更、Acceptance / Freeze 签发、发布与部署。

#### 31.18.1 单一 canonical 原语

新增 `server/modules/accounting-manual-voucher-guard.js`，作为**唯一**的守卫实现：

```text
MANUAL_VOUCHER_CONTROLLED_ROLES = [
  // 存货族（§35.12 既有）
  'RAW_MATERIAL_INVENTORY', 'FINISHED_GOODS_INVENTORY', 'OTHER_INVENTORY', 'WIP', 'GRNI',
  // 成本与差异族（§35.13 `AA-VAL-05` 新增）
  'COGS', 'INVENTORY_GAIN_LOSS', 'INVENTORY_SCRAP_EXPENSE', 'MATERIAL_PRICE_VARIANCE',
  'MANUFACTURING_VARIANCE', 'PURCHASE_RETURN_VARIANCE', 'PURCHASE_PRICE_VARIANCE',
  'LABOR_ABSORPTION', 'OVERHEAD_ABSORPTION', 'OUTSOURCING_PROCESSING_FEE',
]

manualVoucherControlledSubjectIds(db)   -> Set<subject_id>
assertManualVoucherSubjectsAllowed(db, entries, { action })
```

- 受控科目集合**始终**由 `account_role_mappings.role_code` 推导（`SELECT subject_id ... WHERE
  role_code IN (...)`），**不硬编码科目号**；科目目录调整时守卫自动跟随。
- `assertManualVoucherSubjectsAllowed` 在命中时抛 `HttpError(409, …, { code:
  'MANUAL_VOUCHER_CANONICAL_SUBJECT', resolution })`；错误码与既有合同**完全一致**，
  跨域消费方无需改口径。
- `resolution` 文案随受控范围扩展（受控科目不再只有存货），但**错误码不变**。

#### 31.18.2 三条写路径的接线

| 路径 | 处理器 | 校验对象 | 时点 |
|---|---|---|---|
| 创建 | `server/app.js::createAccountingVoucher` | 请求的**完整**分录集合 | 进入 `transaction()` **之前** |
| 改分录 | `server/app.js::updateAccountingVoucher` | 请求的**完整**分录集合（将要写入的那一份） | 进入 `transaction()` **之前** |
| 冲销 | `server/app.js::reverseManualVoucher` | **原凭证**的既有分录（冲销凭证即其镜像） | 调用 `reverseVoucher()` **之前** |

- 改分录路径校验的是「将要写入的完整分录集合」：处理器会先 `DELETE` 旧分录再整体重写，
  因此不存在「旧分录残留」的问题；请求若只提交部分行，删除旧行后写入的就是请求的那几行。
- 冲销路径只对**手工凭证**生效：系统凭证冲销走 `reverseVoucher` 的 `SYSTEM_REVERSAL` 分支，
  **不**经过本守卫（`AA-VAL-07`）。`reverseVoucher` 本身**不被修改**。
- 提交 `submit` / 审核 `approve` / 删除 `delete` 不新增或删除分录，**不**接入守卫。

#### 31.18.3 事务、错误、审计与兼容

- 守卫一律在写事务**之前**执行，命中即 409，**零副作用**（不产生凭证与分录）。
- 审计事件类型与既有手工凭证流程**不变**（`CREATE` / `UPDATE` / 冲销沿用既有事件）。
- 权限码**不变**（`VOUCHER_SUBMIT`）；本节**不**新增权限码，也**不**新增 SOD 决策点。
- Schema：**无变更、无 migration**。受控集合只**读** `account_role_mappings`。
- 兼容性与能力收缩：见 Requirement §35.13 `AA-VAL-12`（历史违规手工凭证不再可冲销 / 改分录）。
  客户环境实测该类凭证数为 0。

#### 31.18.4 测试与状态

- **合同测试**：`server/accounting-manual-voucher-guard.test.js`（新增，登记 FULL）——
  存货族命中 409 + 零副作用；成本与差异族命中 409 + 零副作用；改分录路径命中 409 且原分录未变；
  冲销路径对违规既有凭证拒绝、对合法凭证放行；非受控科目仍可录入；守卫抛出点唯一（静态断言）。
- **变异对照**：清空受控集合 → 命中断言转红；移除改分录路径的守卫调用 → 改分录断言转红；
  移除冲销路径的守卫调用 → 冲销断言转红。
- **状态**：Requirement §35.13 `APPROVED`（2026-11-18）；本节 Design `APPROVED`（同日）；
  Implementation **已实施**（2026-11-18）。真实 MySQL 的结构变更、Acceptance / Freeze 签发、
  发布与部署**未授权**。

### 31.19 `6401 主营业务成本` 对账期望侧覆盖 VMI 结算成本（`ACCEPTED` + `FROZEN`，2026-11-18）

> **授权来源**：业务所有者 2026-11-18「保留 `6401` 作为成本科目，把该检查的期望侧扩展为
> 「销售出库成本 + VMI 结算成本」」，并裁定「期望侧不得放宽差额容忍」「期望侧只计已过账结算
> 账单所覆盖的结算成本」。对应 Requirement §35.14 `AA-COG-01..06`。
> 交叉依赖：Procurement & Outsourcing 域 Requirement §31.24.6 / Design §26.45.11。
>
> **未授权**：真实 MySQL 的结构变更与数据写入、Acceptance / Freeze 签发、发布与部署。
> 本节**不改动** Procurement & Outsourcing 域的任何会计语义。

#### 31.19.1 模块与职责

| 模块 | 职责 | 本轮变更 |
|---|---|---|
| `server/modules/financial-inventory.js` | `systemHealth()` 的 24 项 BLOCKING 检查；`COGS_TO_GL` 的**唯一**实现点 | **修改**：期望侧扩展 |
| `server/modules/procurement-vmi.js` | VMI 结算链（**不修改**）：结算凭证与分配事实在同一事务内写入 | 无 |
| `server/modules/vmi-settlement.js` | 结算链的 canonical 业务计算（**不修改**） | 无 |
| `server/database/mysql-adapter.js` | SQLite SQL → MySQL SQL 翻译（**不修改**）：`CAST(... AS INTEGER)` → `CAST(... AS SIGNED)` | 无 |

- `COGS_TO_GL` 全仓**只有一处**实现（`financial-inventory.js::systemHealth`）。
  `accounting-reconciliation.js` 与 `commercial-golive.js` **没有** COGS 检查，
  本节**不**为对称而新增第二处实现（Requirement `AA-COG-05`）。

#### 31.19.2 期望侧口径与「两侧同时移动」的实现保证

```text
COGS_TO_GL = GL(6401 借 − 贷，business_date <= asOfDate)
           − 销售出库成本（既有口径：SALES_DELIVERY_COGS / SALES_RETURN_COGS_REVERSAL）
           − VMI 结算成本（本节新增）
             = SUM over 已出账结算账单所覆盖的结算行 of (settled_qty × unit_price_cents)
```

- **权威脊柱 = 分配事实** `vmi_settlement_bill_allocations`。Procurement Requirement §31.24
  `VMI-SET-10` 规定「权威关系只在分配表」（`vmi_settlement_lines.bill_id` 是兼容派生字段），
  因此期望侧的连接顺序是
  `vmi_settlement_bill_allocations` → `vmi_settlement_lines`（结算行）
  → `supplier_bills`（账单日期口径）。
- **两侧同时移动的保证**：分配事实与结算凭证（`VMI_SETTLEMENT_LINE`）在
  `createVmiSettlementBill` 的**同一事务、同一次循环**内相邻写入
  （`server/modules/procurement-vmi.js:632-650`）。因此「有分配事实」与「有 6401 成本凭证」
  是**同一时刻**成立的事实，期望侧与总账侧**不可能**错位：
  - 消耗已发生、结算未出账 → 无分配事实、无成本凭证 → 期望侧 0、总账侧 0 → 差 0；
  - 结算已出账 → 分配事实与成本凭证同时存在 → 期望侧 = 已出账结算成本、
    总账侧 = 同额 → 差 0。
- **为什么不用「VMI 消耗的价值流水」**：消耗腿（`Dr 应付 / Cr 存货`）在**消耗时**就减了存货
  价值，而 `Dr 6401` 的成本凭证在**结算出账时**才记。若期望侧计入消耗，「消耗已发生、结算
  未出账」的窗口里期望侧会多算而总账侧还是 0 —— 一个**新的瞬时失配**
  （Requirement `AA-COG-03`）。
- **为什么不用 `supplier_bills.status='POSTED'` 作为过滤条件**：结算账单的过账
  （`postSupplierBill`）在结算事务**之后**执行，且结算账单的作废（`REVERSED`）**不**冲销
  `VMI_SETTLEMENT_LINE` 的成本凭证（既有实现事实，Requirement §35.14.5 第 2 项）。以账单状态
  过滤会在「凭证已记、账单尚未过账」与「账单已作废、成本凭证仍在」两种状态下与总账侧错位。
  以**分配事实**为脊柱则两种状态下都与总账侧一致。
- **金额口径**：结算行已结算数量 × 协议单价。结算凭证的金额来源是账单行金额
  （= 协议单价 × 数量，`NO_TAX` 下 gross = net），两者同源同值；账单行金额本身由 canonical 的
  `roundRational`（BigInt 有理数）算出，不是浮点近似。

#### 31.19.3 SQL 形态与双引擎

期望侧必须同时在 SQLite 与 MySQL 8 上给出**同一整数分**。两处引擎差异与处理：

| 差异 | 处理 |
|---|---|
| `settled_qty` 的物理类型 | SQLite `REAL`（float64） vs MySQL `DECIMAL(24,6)` |
| `ROUND` 语义 | 两端均为**四舍五入远离零**（SQLite `ROUND`、MySQL `ROUND`），一致 |
| `CAST(... AS INTEGER)` | SQLite 接受；**MySQL 8 不接受该类型名**。适配器 `translateSqliteSql()` 用正则 `/CAST\s*\(([^)]+)\s+AS\s+INTEGER\s*\)/gi` 翻译为 `CAST(... AS SIGNED)`，但该正则**不容许嵌套括号** |

因此期望侧的 SQL **必须**把 `ROUND(...)` 放进派生表，让 `CAST` 的参数保持**无嵌套括号**：

```sql
SELECT COALESCE(SUM(CAST(r.settled_cents AS INTEGER)),0) n FROM (
  SELECT ROUND(l.settled_qty * l.unit_price_cents) settled_cents
  FROM vmi_settlement_bill_allocations a
  JOIN vmi_settlement_lines l ON l.id=a.settlement_line_id
  JOIN supplier_bills b ON b.id=a.supplier_bill_id
  WHERE b.bill_date<=?
) r
```

翻译后为 `SUM(CAST(r.settled_cents AS SIGNED))` —— MySQL 8 可执行。派生表内 `ROUND` 的结果
在 SQLite 是 `REAL`（如 `4800.0`），在 MySQL 是 `DECIMAL(.,0)`；两端的 `CAST` 分别按
「截断到整数」与「四舍五入到整数」处理，但输入**已是整数值**，因此两端结果**相同**。
金额单位为**分**（整数），`COALESCE(...,0)` 保证无结算事实时贡献 0。

**日期口径**：`b.bill_date <= asOfDate`，与总账侧的
`COALESCE(v.business_date, v.voucher_date) <= asOfDate` 对齐 —— 结算凭证的
`business_date` 就是结算账单的 `bill_date`（同一 `billDate` 变量，
`server/modules/procurement-vmi.js`）。

#### 31.19.4 事务、幂等、状态机、RBAC / SOD、审计、错误

- **事务**：本节**不引入**任何写路径 —— 期望侧是**只读**聚合查询，运行在 `systemHealth()`
  的既有只读语义内，不开启事务、不加锁、不写任何行。
- **幂等**：只读查询天然幂等；重复调用产生同一结果。
- **状态机**：**不涉及**。本节**不改动**结算期 / 结算账单 / 凭证的任何状态流转。
- **RBAC / SOD**：**不涉及**。`systemHealth` 的既有权限（`ACCOUNTING_VIEW` /
  `PERIOD_CLOSE_MANAGE`）与 SOD 决策点**不变**；本节**不**新增权限码。
- **审计**：**不涉及**（只读检查）。既有审计事件**不变**。
- **错误**：本节**不新增错误码**。期望侧读到**缺价**的结算行（`unit_price_cents IS NULL`）时，
  该行的乘积为 `NULL`，被 `SUM` 跳过 → 期望侧偏小 → 检查 **FAIL**（**响亮失败**，
  fail closed），**不得**用 `COALESCE(...,0)` 把缺价静默补 0。可达路径上缺价不可达
  （结算账单生成前 `assertVmiAgreementPrice` 已 fail closed），该守卫是防御性的。

#### 31.19.5 兼容与迁移策略

- **Schema**：**无变更、无 migration**。本节只**读** `vmi_settlement_bill_allocations` /
  `vmi_settlement_lines` / `supplier_bills`（均为 v28 迁移已存在的表）。
- **数据**：**不回填、不改写**任何历史行。
- **行为兼容性**：
  - **无 VMI 结算的环境**：期望侧的 VMI 项恒为 0，行为与修订前**完全一致**
    （Requirement `AA-COG-AC-03`）；
  - **有 VMI 结算的环境**：期望侧新增「已出账结算成本」，把原本恒定 BLOCKING 的
    `COGS_TO_GL` 修正为可归零；**不放宽**任何其它检查的判定。
- **升级路径**：纯代码变更，无数据迁移，幂等。
- **回滚**：回滚 = 还原 `financial-inventory.js` 的期望侧一行；无数据残留、无迁移回滚。
- **跨域依赖**：本检查消费 Procurement & Outsourcing 域的 VMI 结算事实（分配事实、结算行、
  供应商账单），该依赖在 Procurement Requirement §31.24.6 与 Design §26.45.11 **交叉登记**。
  既有跨域读取先例：`RECEIPT_GRNI_TO_GL` 同文件内跨域读 `purchase_receipts` /
  `supplier_bills`。

#### 31.19.6 测试矩阵

| 合同 | 测试点 | 文件 |
|---|---|---|
| `AA-COG-AC-01` | 结算过账后 `COGS_TO_GL` 差额 0；期望侧金额精确到分（结算行已结算数量 × 协议单价） | `server/accounting-cogs-check-vmi-settlement.test.js` |
| `AA-COG-AC-02` | **陷阱用例**：消耗已发生、结算未出账 → 差额仍 0；并断言消耗已产生价值流水（前提承重） | 同上 |
| `AA-COG-AC-03` | 无 VMI 结算时差额 0；销售出库成本口径的静态断言不被改动 | 同上 |
| `AA-COG-AC-04` | 变异对照：① 总账侧篡改 1 分 → FAIL 且差额精确为 1；② 期望侧误取消耗价值流水 → 整套转红；③ 去掉 VMI 项 → `AA-COG-AC-01` 转红 | 同上 |
| `AA-COG-AC-05` | 期望侧 SQL 经 `translateSqliteSql()` 翻译后不含 `AS INTEGER`，且含 `CAST(r.settled_cents AS SIGNED)` | 同上 |
| `AA-COG-AC-06` | 结算链端到端跑完后 `COGS_TO_GL` 差额 0 | `server/vmi-settlement.test.js` |

- **合同测试文件**：`server/accounting-cogs-check-vmi-settlement.test.js`（**新增**，登记 FULL）。
- **既有测试调整**：**无**。既有断言**不删除、不降级**；`server/vmi-settlement.test.js`
  只**追加**一条端到端断言。

#### 31.19.7 状态

- Requirement §35.14 `ACCEPTED` + `FROZEN`（2026-11-18，业务所有者签发 Acceptance 与 Capability
  Freeze，并裁定口径；验收记录 `docs/acceptance/vmi-settlement-acceptance-freeze-20261118.md`）。
- 本节 Design `ACCEPTED` + `FROZEN`（同日）；Implementation **已实施**（2026-11-18）。
- 真实 MySQL 复核、Acceptance / Freeze 签发、发布与部署**待执行**。
