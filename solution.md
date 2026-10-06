# solution.md 建议更新内容

## 20. 新版 ERP 8 Domains + Platform 渐进式演进设计

### 20.1 总体策略

新版 ERP 在现有仓库上**渐进式演进，不重写**。

现有经过验证的 canonical 业务事实继续复用，包括但不限于：

- MRP / Forecast / Pegging；
- Purchase / Sales 主链；
- Production Workflow / Manufacturing Execution；
- Inventory Ledger、LOT/SERIAL、Traceability、Genealogy；
- IQC/OQC；
- AR/AP、Settlement、Refund/Write-off/Reversal；
- Inventory Valuation、WIP；
- Voucher、GL、Financial Reports；
- RBAC、Audit、Period Close；
- SQLite/MySQL adapter、transaction、test gates、deployment。

“8 Domains + Platform”首先是**logical ownership / product architecture**，不要求一次性把所有文件搬进新的目录。

禁止：

- Big-bang rewrite；
- 为目录整齐而重写稳定业务；
- 同一业务建立第二套 active implementation；
- 先移动代码再补业务合同；
- 为了完成架构图而新增未确认 Capability。

### 20.2 目标 logical ownership

| Target Domain | 当前主要可复用 owner / surface | 后续方向 |
|---|---|---|
| Master & Engineering | `customers.js`、`suppliers.js`、`products.js`、`warehouses.js`、`manufacturing-reference.js`、`product-routing.js`、BOM 现有实现 | 增加 Organization、Bin、Resource、Calendar、Substitute、ECO；按触及范围继续 ownership extraction |
| Sales & Customer | Sales Order、`sales-deliveries`、returns、`discounts.js`、invoice/AR 关系 | 增加 Quotation、Pricing、Order Change、Credit；移除 CRM extension |
| Planning | `planning.js`、`planning-documents.js` | 扩充计划参数、安全库存/替代策略；保持 MRP 不直接产生库存/财务副作用 |
| Procurement & Outsourcing | Purchase Requisition/PO/Receipt/Return 现有实现 | 补 Sourcing/Quota/VMI；新增 Outsourcing bounded subdomain |
| Manufacturing & Quality | `production-workflow.js`、`manufacturing-execution.js`、`authoritative-quality.js`、`quality-gates.js` | 补 Scheduling/Dispatch/Transfer/更多质量类型；生产/质量仍保持独立业务语义 |
| Inventory & Warehouse | `inventory-extensions.js`、`inventory-period-close.js`、`traceability-quality.js`、现有 inventory handlers | 补 Bin/Status/Barcode/Assembly；扫码只是执行入口，不建立第二套库存事实 |
| Finance Operations | `settlement-core.js`、`settlement.js`、`financial-controls.js`、`commercial-golive.js`、`financial-inventory.js`、现有 bank/cash/bill/fixed-asset handlers | 正式形成 AR/AP/Invoice/Treasury/Inventory Cost/Fixed Asset 子域；现有 disabled 能力经手册验收后再开放 |
| Accounting & Analytics | `accounting-config.js`、现有 voucher/GL/report handlers、`decision-reports.js` | 建 Smart Accounting、Business-GL reconciliation、Cash Flow、Management Accounting |
| Platform | `route-table.js`、`approvals.js`、`lifecycle-engine.js`、`data-lifecycle.js`、RBAC/auth/audit、notifications/workflow 基础 | Generic Workflow、Document Relation/Conversion、Numbering、Org Scope |

`financial-inventory.js`、`commercial-golive.js`、`extended.js`、`business.js` 等现有 mixed/cross-domain 文件不因为表格归属而立即搬迁。只有对应 Capability 被开发时才拆出 coherent owner。

### 20.3 前端迁移设计

`src/navigation/applicationRegistry.js` 继续是最终用户 Route canonical source。

目标调整：

1. Primary domain 从现有 7 类逐步对齐：
   - `master-engineering`
   - `sales-customer`
   - `planning`
   - `procurement-outsourcing`
   - `manufacturing-quality`
   - `inventory-warehouse`
   - `finance-operations`
   - `accounting-analytics`
   - Platform/System 作为横向 ownership，不额外增加移动底部 Tab。
2. 初期保持 route key 和 deep-link 合同稳定，优先修改 metadata/domain/launcher grouping，不因领域重命名破坏 URL。
3. `accounts-receivable`、`accounts-payable`、invoice、collection/payment、bank 等从销售/采购/analytics 展示归属逐步转到 Finance Operations。
4. `accounting`、financial reports、management reports 归 Accounting & Analytics。
5. `projects/tasks/timesheets/contacts/followups/activities` 从 active Registry 删除。
6. `notifications` 保留为 Platform；`workflows` 在 B3122 完成前继续保持未支持/disabled，不因架构命名提前开放。
7. MobileShell 仍保持 `messages / approvals / apps / workspace / profile` 五个全局入口，8 个业务域不等于 8 个底部 Tab。
8. `erp-mobile-taste` Skill 仅在用户明确进入 UI/Mobile UX/响应式设计任务时启用；它不得改业务合同。

### 20.4 后端迁移设计

继续使用现有 `ownedRouteTable` / domain module extraction 模式：

- `server/app.js` 长期收敛为 HTTP lifecycle + auth + thin dispatch；
- 新增或触及业务时优先存在明确 domain owner；
- route descriptor 仍只保留 `method/path/handler/owner`，权限、事务、审计继续留在 runtime handler；
- 不一次性把所有 legacy route 迁走；
- 每次迁移先 caller proof，再切换 single owner，再删除旧实现；
- API method/path/request/response 默认保持兼容，只有业务 Gap 明确要求才变更；
- `transaction(db, work)`、`audit(db, ...)`、`HttpError`、source recheck、idempotency 继续作为业务边界。

长期建议允许在领域变大后形成物理目录，例如：

`server/domains/<domain>/...`、`src/domains/<domain>/...`

但**物理目录不是当前阶段强制目标**。只有同一 Domain 已有多个 coherent modules 且迁移收益明确时，才单独设计目录迁移。

### 20.5 非核心扩展删除设计

删除对象：

- Frontend routes/surfaces：projects/tasks/timesheets/contacts/followups/activities；
- Backend handlers/API；
- 仅服务这些能力的 permission/seed/test；
- mixed owner 中对应分支。

执行顺序：

1. `dependency inventory`：列出 route、screen、API、handler、table、permission、test、seed、lifecycle dependency、cross-reference；
2. `classification`：区分“应删除扩展”与“核心能力可复用数据”，尤其是 Customer Contact；
3. `extract core`：从 `projects-workflow.jsx` / `business.js` 中先提取 notifications/workflows 等 Platform 能力；
4. `frontend cutover`：删除 Launcher/route/screen；
5. `backend cutover`：zero-caller proof 后删除 API/handler；
6. `permission/test cleanup`；
7. `data retention`：历史表先标 legacy/unsupported，不自动 DROP；
8. 如用户批准 schema cleanup，再设计 SQLite/MySQL 双路径 migration、备份、数据导出与 rollback；
9. 运行跨域 full gate。

不得用简单的“删除 crm.jsx / projects-workflow.jsx / business.js”实现，因为这些文件当前包含 mixed responsibilities。

### 20.6 Document / Conversion / Workflow Platform 目标

当前已有大量 source→target 关系，但实现仍分散。长期 Platform 需要统一以下概念，但只在已确认 Gap 驱动下逐步抽象：

**Document Lifecycle**

`DRAFT → SUBMITTED → APPROVED/REJECTED → EXECUTING → PARTIAL/FULFILLED → CLOSED/REVERSED`

各 Domain 可以拥有自己的状态子集；不得强迫所有单据共享错误的统一状态。

**Document Relation**

至少能表达：

- source document / source line；
- target document / target line；
- converted quantity；
- reversed quantity；
- remaining executable quantity；
- lineage / drill-down。

**Conversion**

`Source → Conversion Rule → Target`

可以服务请购→PO、PO→Receipt、SO→Delivery、MRP Result→Instruction、Instruction→Production Order 等，但不能牺牲各 Domain 的校验、权限和事务规则。

**Workflow**

长期由 B3122 驱动：

`Definition → Instance → Node → Condition/Assignee → Action → Transition → Business Callback`

现有五类 approval family 在 generic workflow 完成前继续是 canonical，不提前用半成品 Workflow 替换。

**Numbering / Audit / Period**

保持统一平台能力，但具体单据编号、会计期间与业务期间仍遵循各 Domain 规则。

### 20.7 数据架构演进

当前数据事实仍为单组织/单本位币。后续采用 additive、可迁移策略：

- 新 Organization/Org Scope 不通过“给所有表一次性加字段”完成；
- 先定义组织模型与各单据 owning/stock/settlement/accounting org 语义；
- 再按 Domain 迁移；
- 旧单组织数据必须有可证明的默认组织映射；
- 未知历史事实不得伪造。

多币种同理：

- Transaction Currency；
- Exchange Rate；
- Functional/Base Currency；
- Foreign Amount / Base Amount；
- AR/AP/Payment/Invoice/Voucher/FX Gain-Loss。

在正式设计前继续保持单本位币行为，不允许只加 `currency_code` 字段就宣称支持多币种。

仓位、库存状态、替代料、ECO 等均使用相同原则：先业务语义、再 schema、再 migration、再 UI。

### 20.8 22 手册 Capability Coverage 的持久化方式

不新增第二套 canonical 规格文件。Coverage 继续写入 `document.md` 对应手册章节/表格。

每条至少记录：

`Manual ID → Capability → Target Domain → Existing Route/API/Owner/Schema → Coverage → Gap → Requirement Ref → Design Ref → Acceptance Evidence`

Coverage 值固定：

`COVERED / PARTIAL / MISSING / SEMANTIC_MISMATCH / OUT_OF_SCOPE`

领域级百分比只能作为规划估计，不能作为验收依据。

### 20.9 后续执行阶段

本次文档批准后：

**Stage A — Core Scope Cleanup**

先审计并移除非核心 Project/CRM extension；属于跨域/架构变更，执行 `pnpm test + pnpm build + git diff --check`，若涉及 schema 再升级到 heavy/MySQL gate。

**Stage B — Domain Alignment**

调整 Registry/domain/launcher logical ownership；原则上不修改 ERP 业务行为与数据库事实。

**Stage C — Manual Capability Closure**

从 B3101 起逐项：
`Extraction → Audit → Coverage → Requirement → Design → Implementation → Acceptance/Freeze`

若某个手册 Gap 需要跨域 foundation，则 foundation 作为该 Gap 的 implementation unit，不重新形成独立 Wave roadmap。

### 20.10 Vibe Coding 工作方式

所有 AI/Claude Code/Codex 会话以 `AGENTS.md` 为治理入口。

每个开发任务开始前：

1. 完整阅读 README.md、document.md、solution.md；
2. 完整阅读最近 3 个实际存在日期的 log；
3. 读取 AGENTS.md 与当前工具入口规则；
4. 修改代码前完整阅读本次受影响的领域代码与完整调用链；
5. 文档先行，用户确认 Requirement/Design 后再实现；
6. 新功能必须有测试；
7. 完成后运行任务等级要求的全套 gate；
8. 使用本地 Git，中文 commit；
9. 未经用户明确批准不 push/tag/deploy。

`erp-mobile-taste` 只在 UI Design / Layout / Mobile UX / Responsive 任务中加载，且必须保持 API、数据、权限、状态机、审批/确认、上下游关系不变。
