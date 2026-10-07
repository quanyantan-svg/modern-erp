# Modern ERP 当前技术设计与实现

## 1. 文档职责与设计原则

本文档是 Modern ERP **唯一当前技术设计与实现参考**。
业务需求、目标 Capability 和 Coverage 见 `document.md`；开发与 AI/Vibe Coding 治理见 `AGENTS.md`；运行入口、目录和版本见 `README.md`。

当前已发布基线仍为 `v1.6.2`。本文件同时描述：

- 已落地且应继续保留的技术设计；
- 已确认但尚未全部实现的 8 Domains + Platform 演进设计；
- 后续 Capability Gap 的实现约束。

设计原则：

1. 以真实代码、数据库约束和已批准 Requirement 为权威；
2. 现有经过验证的业务事实优先复用，不进行 big-bang rewrite；
3. HTTP 层负责 request lifecycle / authentication / dispatch；
4. Domain handler 负责业务不变量；
5. transaction 负责原子性；
6. 前端不是权限、金额、库存、会计的最终权威；
7. SQLite 与 MySQL 8 实现相同业务合同；
8. 历史经济事实不可被 GET/CHECK/startup migration 静默修复；
9. 未知历史事实保持未知，不伪造；
10. 业务日期、来源、累计执行量、库存/价值、AR/AP、WIP、GL 和 audit 保持可追溯；
11. 先保证正确性，再优化吞吐和结构。

---

## 2. 运行与部署架构

运行链路：

```text
Browser
  → Nginx :80/:443
  → Node.js 22.23.2 on 127.0.0.1:3001
  → native HTTP application
  → SQLite or MySQL 8
```

前端由 Vite 构建到 `dist/`。生产 Node 进程提供：

- API；
- static assets；
- SPA fallback。

生产部署使用：

- `deploy/systemd/modern-erp.service`
- `/etc/modern-erp/env`
- `deploy/nginx/modern-erp.conf`

项目不使用 Express、Koa、PM2、Docker 或 Redis 作为当前 canonical 运行要求。

数据库后端由 `ERP_DB_BACKEND` 选择：

- `sqlite`：本地开发、测试、兼容运行；
- `mysql`：MySQL 8 一等运行后端。

MySQL 配置不完整时必须在连接前 fail closed。

---

## 3. 仓库结构与责任

| 路径 | 责任 |
|---|---|
| `src/main.jsx` | React 启动入口 |
| `src/App.jsx` | App shell、认证状态和 Screen orchestration |
| `src/navigation/applicationRegistry.js` | Route / access / navigation / Launcher / screen canonical registry |
| `src/navigation/routeLocation.js` | hash RouteLocation parse/serialize/normalize |
| `src/api.js` | Bearer Token、request wrapper、安全错误映射 |
| `src/pages/` | 业务页面 |
| `src/components/` | 共享组件 |
| `src/styles/` | 共享与领域样式 |
| `src/lib/` | presentation / amount / status 等共享纯逻辑 |
| `server/index.js` | DB 创建、HTTP server、graceful shutdown |
| `server/app.js` | HTTP lifecycle、auth dispatch、仍未拆出的 handler |
| `server/db.js` | SQLite schema/seed、transaction、database creation |
| `server/modules/` | Domain services / workflow / reconciliation |
| `server/database/` | MySQL adapter / worker / protocol / schema bootstrap |
| `server/migrations/` | 增量 migration |
| `server/lib/` | HTTP、audit、logger、shared helpers |
| `server/*.test.js` | unit / contract / regression / integration tests |
| `scripts/testing/` | suite manifest、runner、governance |
| `scripts/gates/` | MySQL 与高风险 gate |
| `scripts/admin/` | backup/restore/setup-admin/data tools |
| `scripts/acceptance/` | browser / responsive / release acceptance |
| `deploy/` | Nginx / systemd |
| `docs/operations/` | 当前专项运维 |
| `docs/archive/` | 历史证据 |
| `log/` | append-only 开发记录 |

`server/app.js` 和部分前端页面仍较大，但后续拆分必须由实际 Capability Gap 驱动，不为目录美观整体迁移。

---

## 4. 前端应用架构

### 4.1 applicationRegistry

`src/navigation/applicationRegistry.js` 是最终用户 Route 的唯一前端事实源。

Route 描述：

- key；
- title；
- domain；
- archetype；
- access；
- enabled；
- parentRoute；
- desktop navigation；
- mobile exposure；
- Launcher Entry；
- target contract；
- screen loader；
- aliases；
- responsive mode。

禁止多份冲突 Route inventory。

### 4.2 RouteLocation

`src/navigation/routeLocation.js` 负责：

- `parseRouteLocation`
- `serializeRouteLocation`
- `normalizeRouteLocation`
- alias resolution
- target validation

概念位置：

```js
{
  routeKey,
  params,
  query,
  target
}
```

SPA 继续使用 hash navigation。Direct URL、refresh、Back、Forward 必须工作。

### 4.3 Screen / Access

访问顺序：

```text
hash
→ RouteLocation parse
→ registry resolve
→ enabled
→ frontend access
→ Screen mount
→ API
→ backend authorization
```

frontend access 只负责 exposure，不是安全边界。

### 4.4 MobileShell

MobileShell 保持任务导向的全局入口，不把 8 Domains 直接变成 8 个底部 Tab。

现有全局入口保持：

- messages
- approvals
- apps
- workspace
- profile

### 4.5 Responsive

Mobile-first 基线：

- 390 CSS px 主设计；
- 320 / 430 / 680 验证；
- 核心任务禁止依赖永久横向滚动；
- LIST → DETAIL → EDITOR / WORKFLOW；
- 状态、业务身份、Primary Action 优先；
- legacy page 可以通过 adapter 过渡；
- 新页面优先 native responsive。

---

## 5. HTTP 请求生命周期

`createApp(db, options)` 创建原生 HTTP request handler。

典型流程：

1. 生成/验证 `X-Request-Id`；
2. 设置安全响应头；
3. parse URL/method；
4. 解析 Bearer Token；
5. 加载 session/user/role/permissions；
6. route dispatch；
7. `readJson` / request validation；
8. `allow` / `allowAny`；
9. handler validation；
10. 必要时进入 transaction；
11. mutation + audit；
12. safe response；
13. `HttpError` → controlled business response；
14. unknown error → server log + safe client message + request id。

非 API production GET 可以提供 `dist/` 静态资源和 SPA fallback，但必须防路径越界。

---

## 6. Authentication / RBAC / SOD / Audit

### 6.1 Session / Password

- Token 使用 cryptographically secure random value；
- DB 仅保存 digest；
- password 使用 random salt + scrypt；
- session 有绝对过期时间；
- login failure 有 rate limit / lock；
- logout 删除 session；
- user password/role/active 变化使现有 session 失效；
- logger 必须递归脱敏 Token/Password/Secret/DB Password。

### 6.2 五角色当前模型

当前 canonical roles：

- ADMIN
- SALES
- REVIEWER
- WAREHOUSE
- ACCOUNTING

当前五个 approval families：

- SALES_ORDER
- PURCHASE_ORDER
- PURCHASE_REQUISITION
- INVENTORY_CHECK
- ACCOUNTING_VOUCHER

在 Generic Workflow 完成前继续保留。

### 6.3 Authorization

- frontend hidden 不等于 authorization；
- `allow` / `allowAny` 保持 runtime authority；
- VIEW 不隐式授予 CREATE/MANAGE/APPROVE/POST/REVERSE；
- create/approve 同人等 SOD 规则必须继续在 backend 检查。

### 6.4 Audit

`server/lib/audit.js` 记录：

- actor；
- action；
- entity；
- entity id；
- summary/detail；
- timestamp。

关键 mutation 的 audit 必须与业务 mutation 处于同一事务边界。

---

## 7. Database Abstraction

### 7.1 SQLite

`server/db.js` 负责：

- schema；
- seed；
- compatibility migration；
- transaction；
- `createDatabase`。

SQLite 使用 Node `node:sqlite` / `DatabaseSync`。

事务：

```text
BEGIN IMMEDIATE
→ work
→ COMMIT
```

异常：

```text
ROLLBACK
```

### 7.2 MySQL 8

MySQL 是一等运行后端。

当前 adapter 保持既有同步调用合同：

```js
db.prepare(...).run(...)
db.prepare(...).get(...)
db.prepare(...).all(...)
```

内部通过 mysql2 worker / protocol 实现。

必须保持：

- request generation；
- response generation；
- timeout 后旧 response 不污染新 request；
- stale connection recovery；
- SQL dialect compatibility；
- transaction retry / lock semantics。

新 SQL 不得假设任意 SQLite 方言都能自动翻译。

### 7.3 Migration

Migration 原则：

- additive 优先；
- idempotent；
- SQLite/MySQL 双路径；
- 不伪造历史；
- 不在 startup 修复业务余额；
- schema 变化必须先 Requirement + Design；
- rollback / compatibility 明确。

---

## 8. 当前 Domain Module 责任

当前主要 canonical/半 canonical owner 包括：

| 模块 | 主要责任 |
|---|---|
| `approvals.js` | 五类审批查询/标准化 |
| `planning.js` | Forecast、MRP、Demand/Supply、Pegging |
| `planning-documents.js` | Production/Purchase Instruction、Requisition、下游释放 |
| `production-workflow.js` | Production Order、Issue/Return、Receipt、Reverse |
| `manufacturing-execution.js` | Routing snapshot、Operation Report、Yield、WIP/Cost |
| `manufacturing-reference.js` | Work Center / manufacturing reference |
| `product-routing.js` | Product Routing / operations |
| `authoritative-quality.js` | IQC/OQC authoritative record |
| `quality-gates.js` | Quality gate / sampling / waiver |
| `traceability-quality.js` | LOT/SERIAL、HOLD/RELEASE、Traceability/Genealogy |
| `inventory-extensions.js` | Check/Adjustment/Transfer/Scrap |
| `inventory-period-close.js` | Inventory period close |
| `financial-inventory.js` | valuation/WIP/GL reconciliation |
| `settlement-core.js` | AR/AP open-item derivation |
| `settlement.js` | collection/payment/allocation/reversal |
| `financial-controls.js` | prepayment/refund/write-off/idempotency/account movement |
| `discounts.js` | discount/credit contracts |
| `commercial-golive.js` | invoice/bill/tax/UOM/opening/import/export/numbering 等混合能力 |
| `accounting-config.js` | accounting configuration / template 基础 |
| `decision-reports.js` | decision reports |
| `lifecycle-engine.js` | lifecycle policies |
| `data-lifecycle.js` | safe deletion/dependency rules |
| `business.js` / `extended.js` | 仍有 mixed/cross-domain legacy responsibilities |

此表描述当前实现，不等于目标物理目录。

---

## 9. Canonical End-to-End 调用关系

### 9.1 O2C

```text
Sales Order APPROVED
→ Delivery Draft + Source Lines
→ OQC Gate
→ Confirm Delivery
   → Inventory Quantity
   → LOT/SERIAL Identity
   → Valuation
   → COGS
→ Sales Invoice
   → AR
   → Revenue
   → Output Tax
→ Collection / Credit / Refund / Write-off / Reversal
```

### 9.2 P2P

```text
Purchase Requisition APPROVED
→ Purchase Order APPROVED
→ Purchase Receipt Draft + Source Lines
→ IQC Gate
→ Confirm Receipt
   → Inventory
   → Identity
   → Valuation
   → GRNI
→ Supplier Bill + Match
   → AP
   → Input Tax
   → PPV/GRNI settlement
→ Payment / Credit / Refund / Write-off / Reversal
```

### 9.3 Planning / Manufacturing

```text
Forecast + Approved Sales Demand + Inventory/Supply
→ MRP Run
→ MAKE / BUY Results
→ Pegging
→ Production / Purchase Instructions
→ Production Order / Purchase Requisition
```

Production：

```text
Production Order
→ BOM/Routing Snapshot
→ Material List
→ Issue/Return
→ Operation Report/Reversal
→ Production Receipt/Reversal
→ WIP / Variance
```

MRP 本身不得直接产生库存或会计副作用。

### 9.4 Finance

```text
Business Source
→ Accounting Event / Source-Unique Voucher
→ Accounting Entries
→ POSTED-only Reports
```

Settlement：

```text
Sales Invoice / Supplier Bill
→ AR/AP Open Item
→ Collection/Payment/Credit
→ Allocation
→ Refund/Write-off/Reversal
→ Derived Open Amount
```

---

## 10. Transaction / Lock / Idempotency

共享 transaction 原则：

- transaction 内重读权威状态；
- source document / line；
- current cumulative qty；
- inventory balance；
- LOT/SERIAL allocation；
- open AR/AP；
- period state；
- quality/credit gate；
- idempotency state。

失败必须原子回滚。

SQLite：

- `BEGIN IMMEDIATE`

MySQL：

- database transaction；
- lock/retry/advisory idempotency；
- worker generation safety。

同一幂等键：

- 相同语义 → 返回原结果；
- 不同语义 → conflict。

---

## 11. Document Lifecycle / Relation / Conversion

### 11.1 Lifecycle

长期通用语义可以表达：

```text
DRAFT
→ SUBMITTED
→ APPROVED / REJECTED
→ EXECUTING
→ PARTIAL / FULFILLED
→ CLOSED / REVERSED
```

但各 Domain 只使用正确的状态子集，禁止为了“统一状态机”破坏真实业务语义。

### 11.2 Relation

长期 Platform relation 至少表达：

- source document；
- source line；
- target document；
- target line；
- source quantity；
- converted/executed quantity；
- reversed quantity；
- remaining executable quantity；
- lineage/drill-down。

### 11.3 Conversion

目标：

```text
Source
→ Conversion Rule
→ Target
```

可服务：

- Requisition → PO
- PO → Receipt
- SO → Delivery
- MRP Result → Instruction
- Production Instruction → Production Order
- Purchase Instruction → Requisition

但转换引擎不能替代 Domain 自己的：

- permission；
- validation；
- transaction；
- state machine；
- accounting/inventory side effects。

---

## 12. Inventory / LOT / SERIAL / Quality

库存必须区分：

- quantity；
- identity；
- value；
- status；
- owner；
- location。

当前核心已有：

- inventory ledger；
- LOT；
- SERIAL；
- tracked movements；
- source allocation；
- HOLD/RELEASE；
- genealogy；
- IQC/OQC；
- inventory period close。

原则：

- `products.stock_quantity` 不是业务写入权威；
- LOT/SERIAL 历史产生后不能任意关闭 tracking；
- SERIAL 基本单位数量必须整数；
- inventory mutation 与 valuation 必须一致；
- quality gate 不直接等同库存/会计事件；
- transfer 是实物流，不是 approval family。

未来补：

- Bin；
- Stock Status；
- Reservation/Lock；
- Barcode；
- Assembly/Disassembly；
- Form Conversion。

---

## 13. Finance Operations / Accounting

### 13.1 AR/AP

AR/AP 必须基于 immutable source。

Open amount/status 可以缓存，但权威仍来自：

- source；
- credit/refund/write-off；
- confirmed allocation；
- reversal。

### 13.2 Invoice/Bill

物流与商业确认分离：

- Delivery ≠ Sales Invoice
- Receipt ≠ Supplier Bill

Sales Invoice 才建立当前销售商业 AR/Revenue 事实；Supplier Bill 才建立正式采购 AP/Input Tax 等商业事实。

### 13.3 Inventory Cost

数量事实和价值事实分离但关联。

Inventory accounting 负责：

- valuation；
- cost movement；
- COGS；
- GRNI；
- PPV；
- WIP；
- cost adjustment。

未来补完整：

- costing scope；
- multiple valuation methods；
- expense allocation；
- provisional costing；
- outsourcing cost；
- cost period close。

### 13.4 Fixed Assets

当前有部分 backend/schema 基础，但目标需要完整：

```text
Application
→ Procurement/Receipt
→ Asset Card
→ Change
→ Transfer/Borrow/Count
→ Split/Merge
→ Depreciation
→ Disposal
```

### 13.5 Smart Accounting

长期目标：

```text
Business Document
→ Accounting Event
→ Voucher Template
→ Condition
→ Account Mapping
→ Amount Mapping
→ Dimension Mapping
→ Voucher
```

当前 system voucher / voucher templates / account role mapping 可复用，但不等同完整 Smart Accounting Engine。

---

## 14. Reporting / Reconciliation / Period

### 14.1 Reports

当前已有：

- Trial Balance；
- Income Statement；
- Balance Sheet；
- Sales/Purchase Decision Reports；
- Outstanding Reports；
- Inventory Movement；
- WIP/Manufacturing analytics；
- AR/AP reconciliation 等基础。

报表业务日期必须取权威业务日期，不得用 `created_at` 替代。

### 14.2 System Health / Reconciliation

System Health 默认 CHECK-only：

- inventory qty；
- identity；
- value；
- WIP；
- GRNI；
- AR；
- AP；
- tax；
- COGS；
- cash/bank；
- UOM；
- voucher uniqueness；
- period sequence；
- settlement open items。

不得在启动或 GET 时自动“修复”历史。

### 14.3 Period Close

关闭期间后：

- 禁止普通 mutation 回写；
- correction 使用 reverse/reopen；
- 保留操作员/原因/audit；
- inventory/accounting close 顺序必须明确。

---

## 15. Testing Architecture

测试 suite 由 `scripts/testing/test-suites.js` 集中治理。

集合不变量：

```text
FAST ⊆ FULL
FULL ∩ HEAVY = ∅
ALL = FULL ∪ HEAVY
```

测试层级：

### FAST

日常低风险 feedback。

### FULL

跨域、架构、canonical metadata、release candidate。

### HEAVY

backup/restore、production bootstrap、deployment、systemd/nginx、legacy migration、MySQL adapter/concurrency/performance、filesystem destructive safety。

### MySQL Gates

- `pnpm test:mysql`
- `pnpm test:mysql:concurrency`
- `pnpm test:mysql:performance`

必须有受保护 disposable MySQL 环境。

不得硬编码快速变化的 test count 作为长期设计事实；实时数量以 runner 输出为准。

---

## 16. Backup / Restore / Admin / Deployment

### SQLite

- backup 使用一致快照并校验；
- restore 先验证备份并生成 safety backup；
- production restore 必须维护窗口和明确授权；
- `reset-data` 在 production fail closed。

### MySQL

仓库现有 MySQL schema bootstrap/test/conversion 工具不等于完整生产备份策略。

生产 MySQL：

- backup；
- restore drill；
- upgrade；
- rollback；
- disaster recovery

必须由独立运维方案验证。

### setup-admin

显式 operator 调用：

```bash
pnpm setup-admin -- --username ... --password ...
```

不得由 application startup 自动执行。

---

## 17. Performance / Concurrency

当前正确性优先。

已形成：

- SQLite serialized write semantics；
- MySQL transaction / lock / generation protocol；
- idempotency；
- unique constraints；
- slow query observation；
- 部分 critical indexes。

不得在没有真实 benchmark/query plan/regression 证据时削弱 global correctness gate。

生产容量、百万级数据、所有列表分页和 p95 仍需环境化认证。

---

## 18. 已知技术债与边界

- `server/app.js` 仍大；
- `business.js` / `extended.js` 等 mixed-owner；
- 部分前端页面仍大；
- SQLite base schema + historical migrations + MySQL bootstrap 并存；
- current frontend logical domains 仍需从旧结构对齐到 8 Domains；
- Generic Workflow 未完成；
- 单组织；
- 单本位币；
- MySQL production backup/restore/capacity 仍需环境化验收；
- 部分 disabled routes 不能因为“已有 backend”就宣称产品支持。

技术债不能成为 big-bang rewrite 的理由。

---

## 19. 金蝶 B3101–B3122 Capability 实施模型

### 19.1 输入

`document.md §22` 是手册 Capability Requirement Baseline。

Agent 进入任何模块时必须先做真实代码审计。

### 19.2 Audit 维度

Frontend：

- Registry；
- Route；
- Launcher；
- Screen；
- Deep Link；
- responsive；
- access。

Backend：

- method/path；
- dispatch；
- handler；
- owner；
- authorization；
- validation；
- state；
- transaction；
- audit；
- error contract。

Data：

- schema；
- source snapshot；
- ledger；
- unique/idempotency；
- SQLite/MySQL。

Evidence：

- focused tests；
- regression；
- build；
- responsive/browser；
- MySQL gate（适用）。

### 19.3 Coverage 对应行为

| Coverage | 设计行为 |
|---|---|
| COVERED | 默认不修改 |
| PARTIAL | 只补已批准差额 |
| MISSING | Requirement/Design 后新增 |
| SEMANTIC_MISMATCH | 优先纠正业务语义 |
| OUT_OF_SCOPE | 不实现、不伪装支持 |

### 19.4 Backend 约束

- `server/app.js` 长期 thin dispatch；
- domain owner 唯一；
- route ownership 唯一；
- 不复制 permission/transaction/audit metadata；
- handler runtime authority 不漂移；
- caller proof 后才能删除旧实现；
- 不创建第二套 active implementation；
- 不引入无需求的 DI/controller framework；
- 不为架构图完成度重构无关模块。

### 19.5 Frontend 约束

- Registry / RouteLocation canonical；
- direct URL / refresh / Back / Forward；
- fail-closed；
- generic UI 不掌握业务权限；
- business action semantics 不下沉到纯 presentation layer；
- 只现代化本 Capability 实际触及 surface。

### 19.6 Schema / High Risk

schema 变化必须：

1. document Requirement；
2. solution Design；
3. migration；
4. SQLite/MySQL validation；
5. rollback/compatibility；
6. focused + full；
7. MySQL/heavy（适用）。

### 19.7 Implementation Unit

一个大 Manual 可以拆为 bounded units，但仍属于同一 Manual/Capability，不重新生成全项目 Wave roadmap。

### 19.8 Acceptance

Module/Capability Acceptance 必须基于真实代码和证据，不接受 Agent 自述代替验证。

---

## 20. 新版 ERP 8 Domains + Platform 渐进式演进设计

### 20.1 总体策略

新版 ERP 在现有仓库上**渐进式演进，不重写**。

继续复用：

- MRP / Forecast / Pegging；
- Purchase / Sales 主链；
- Production Workflow / Manufacturing Execution；
- Inventory Ledger；
- LOT/SERIAL / Traceability / Genealogy；
- IQC/OQC；
- AR/AP / Settlement / Refund / Write-off / Reversal；
- Inventory Valuation / WIP；
- Voucher / GL / Financial Reports；
- RBAC / Audit / Period Close；
- SQLite/MySQL adapter；
- transaction；
- test gates；
- deployment。

禁止：

- Big-bang rewrite；
- 为目录整齐重写稳定业务；
- 同一业务建立第二套 active implementation；
- 先移动代码再补业务合同；
- 为了完成架构图新增未确认 Capability。

### 20.2 Target Logical Ownership

| Target Domain | 当前主要可复用 owner/surface | 后续方向 |
|---|---|---|
| Master & Engineering | customers/suppliers/products/warehouses、manufacturing-reference、product-routing、BOM | Organization、Bin、Resource、Calendar、Substitute、ECO |
| Sales & Customer | Sales Order、delivery/return、discounts、customer | Quotation、Pricing、Order Change、Credit；删除 CRM extension |
| Planning | planning、planning-documents | Planning Scheme、Safety Stock、Reservation、Planned Order、Workbench |
| Procurement & Outsourcing | Requisition/PO/Receipt/Return | Sourcing、Quota、VMI、Outsourcing |
| Manufacturing & Quality | production-workflow、manufacturing-execution、quality modules | Scheduling、Dispatch、Transfer、Quality 深化 |
| Inventory & Warehouse | inventory modules、traceability | Bin、Status、Barcode、Assembly、Reservation |
| Finance Operations | settlement、financial-controls、financial-inventory、bank/cash/bill/asset 基础 | Provisional AR/AP、Treasury、Asset、Costing、多币种 |
| Accounting & Analytics | accounting-config、Voucher/GL/report、decision-reports | Smart Accounting、Cash Flow、Report Platform、Management Accounting |
| Platform | route-table、approvals、lifecycle、RBAC/auth/audit、notification/workflow 基础 | Generic Workflow、Document Relation/Conversion、Numbering、Org Scope |

mixed owner 文件不因目标表而立即搬迁；只有实际 Capability 开发时才抽出 coherent owner。

### 20.3 前端 Domain Alignment

目标 logical domain：

- `master-engineering`
- `sales-customer`
- `planning`
- `procurement-outsourcing`
- `manufacturing-quality`
- `inventory-warehouse`
- `finance-operations`
- `accounting-analytics`

Platform/System 作为横向 ownership，不额外增加移动底部 Tab。

迁移原则：

1. 初期保持 route key / deep-link；
2. 优先改 metadata/domain/launcher grouping；
3. AR/AP/Invoice/Collection/Payment/Bank 逐步归 Finance Operations；
4. Voucher/GL/Financial Reports/Management Accounting 归 Accounting & Analytics；
5. Project/CRM Extension 从 active Registry 删除；
6. notifications 留 Platform；
7. workflows 在 B3122 完成前不提前开放。

### 20.4 Backend Evolution

继续使用现有 incremental ownership extraction：

- `ownedRouteTable`；
- domain modules；
- thin adapter；
- runtime permission；
- runtime transaction；
- runtime audit。

不一次性迁移全部 legacy routes。

每次：

`caller proof → canonical owner → dispatch cutover → remove old active path → tests`

### 20.5 Core Scope Cleanup

删除对象：

- projects
- tasks
- timesheets
- contacts（CRM extension）
- followups
- activities

执行顺序：

1. dependency inventory；
2. classify KEEP_CORE / KEEP_PLATFORM / REMOVE_EXTENSION / NEEDS_MIGRATION；
3. 提取 mixed-owner 中需要保留的 Platform/Core；
4. frontend cutover；
5. backend cutover；
6. permission/test/lifecycle cleanup；
7. historical data retention；
8. schema cleanup 另立 migration；
9. full regression。

不得简单整块删除：

- `projects-workflow.jsx`
- `server/modules/business.js`

### 20.6 Platform Target

#### Document Lifecycle

统一抽象但不强迫各 Domain 使用错误状态。

#### Document Relation

表达 source/target/line/qty/reversal/remaining/lineage。

#### Conversion

`Source → Rule → Target`

但 Domain validation 仍在 Domain。

#### Workflow

长期由 B3122 驱动：

```text
Definition
→ Version/Publish
→ Binding
→ Instance
→ Node
→ Condition/Assignee
→ Task
→ Action
→ Transition
→ Business Callback
```

现有五 approval families 在完成前继续 canonical。

#### Numbering / Audit / Period

平台提供统一能力，具体业务语义仍由 Domain 决定。

### 20.7 Organization 与 Multi-Currency

当前仍单组织/单本位币。

Organization 采用逐域 additive migration：

1. 定义组织模型；
2. 明确 sales/purchase/stock/production/settlement/accounting org；
3. 为旧数据建立可证明 default organization；
4. 逐 Domain migration；
5. 不一次性给所有表机械加字段。

Multi-currency 同理，至少定义：

- transaction currency；
- exchange rate；
- functional/base currency；
- foreign amount；
- base amount；
- AR/AP；
- payment；
- invoice；
- voucher；
- FX gain/loss。

只增加 `currency_code` 不算支持多币种。

### 20.8 Coverage 持久化

Coverage 继续写入 `document.md`，不新建第二套 canonical requirement 文件。

最终每条：

`Manual → Capability → Target Domain → UI/Route → API → Owner → Schema → State → RBAC → Transaction/Audit → Tests → Coverage → Gap → Requirement Ref → Design Ref → Acceptance Evidence`

### 20.9 后续阶段

```text
Stage A — Core Scope Cleanup
Stage B — Domain Alignment
Stage C — B3101...B3122 Capability Closure
```

跨域 foundation 只有在已确认 Gap 驱动下实施。

### 20.10 Vibe Coding

所有 AI/Claude Code/Codex 会话以 `AGENTS.md` 为治理入口。

每个开发任务：

1. 建立完整文档基线；
2. 阅读相关完整代码/调用链；
3. 文档先行；
4. 用户确认；
5. 按 Design 实现；
6. 测试；
7. 中文 commit；
8. 未经批准不 push/tag/deploy。

`erp-mobile-taste` 只用于明确 UI/Mobile UX/Responsive 设计任务。

---

## 21. 当前设计状态

截至 2026-10-06：

- 旧 v1.6.2 核心实现保留；
- 22 手册 Capability Requirement 已固化在 `document.md §22`；
- 8 Domains + Platform 已确认；
- Core Scope Cleanup 已确认范围，但尚需 Audit/Requirement/Design/Implementation；
- Domain Alignment 尚未实施；
- B3101–B3122 的最终代码级 Coverage 仍需逐项审计；
- 不授权任何未经过 Requirement/Design 的业务代码变更。

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

## 22. Domain Alignment Design（8 Domains + Platform）

### 22.1 Canonical taxonomy and projections

新增 `src/navigation/domainMetadata.js` 作为唯一 taxonomy source，导出 8 个 Business Domain、Platform、domain key set 与 desktop group order。`applicationRegistry.js` 只引用这些常量并继续作为 route、access、screen、launcher 与 target contract 的 canonical source；`applicationMetadata.js`、`presentationMetadata.js` 继续只做 projection。

Canonical keys：

```text
master-engineering      Master & Engineering
sales-customer          Sales & Customer
planning                Planning
procurement-outsourcing Procurement & Outsourcing
manufacturing-quality   Manufacturing & Quality
inventory-warehouse     Inventory & Warehouse
finance-operations      Finance Operations
accounting-analytics    Accounting & Analytics
platform                Platform
```

Business Launcher 只包含前 8 个非空 group。Platform 不进入普通 Business Launcher；其 route 继续通过 global、role workspace、approval tab、messages tab、system settings 或 contextual navigation 暴露。Desktop group label 同样来自 domain metadata，另允许 `系统设置` 作为 Platform presentation group，但它不是 Business Domain。

### 22.2 Route → Target Domain mapping

下表是 47 active + 5 disabled route 的完整 owner 设计；route key、screen identity 与 target contract 不变。

| Target Domain | Active routes | Disabled routes |
|---|---|---|
| Master & Engineering | `products`, `boms`, `product-routings` | — |
| Sales & Customer | `customers`, `orders`, `sales-deliveries`, `returns`, `sales-discounts` | — |
| Planning | `forecasts`, `mrp-runs`, `material-requirements-plan`, `production-instructions`, `purchase-instructions` | — |
| Procurement & Outsourcing | `suppliers`, `purchase-requisitions`, `purchase-orders`, `purchase-receipts`, `purchase-discounts` | — |
| Manufacturing & Quality | `production-orders`, `material-issues`, `production-receipts`, `manufacturing-analytics`, `iqc`, `oqc`, `quality-control-points` | — |
| Inventory & Warehouse | `warehouses`, `inventory`, `inventory-transactions`, `traceability`, `inventory-scraps`, `inventory-month-end` | — |
| Finance Operations | `sales-invoices`, `accounts-receivable`, `payment-collections`, `supplier-bills`, `accounts-payable`, `payment-disbursements`, `bank-accounts`, `product-costs`, `cost-rates` | `cash-journals`, `bills`, `fixed-assets` |
| Accounting & Analytics | `business-overview`, `dashboard`, `accounting`, `decision-reports` | — |
| Platform | `approvals`, `notifications`, `users` | `workflows`, `data-cleanup` |

`returns` 维持单 route 与两个 launcher target：Sales Return 是其 primary presentation owner，Purchase Return 入口仍通过 `documentType: PURCHASE_RETURN` 投影到 Procurement group；后端各自的 `/api/sales-returns` 与 `/api/purchase-returns` 业务事实 owner 不变。`decision-reports` 维持多个 `reportKey` entry。该共享 screen 不产生第二个 mutable fact owner。

### 22.3 Current capability ownership matrix

| Capability / route | API family | Backend canonical owner | Permission family | Primary tests | Action |
|---|---|---|---|---|---|
| Products / `products` | `/api/products*` | `modules/products.js`; tracking policy 暂在 `app.js` | `PRODUCTS_*` | `v2-wave3f`, traceability tests | REALIGN_METADATA |
| BOM / `boms` | `/api/boms*` | `app.js` | `PRODUCTION_ORDERS_*` | manufacturing tests | REALIGN_METADATA |
| Routing / `product-routings` | `/api/product-routings*` | `modules/product-routing.js` | `ROUTING_*` | `product-routing`, route-table | REALIGN_METADATA |
| Customers / `customers` | `/api/customers*` | `modules/customers.js` | `CUSTOMERS_*` | `v2-wave3b` | REALIGN_METADATA |
| Sales orders / `orders` | `/api/orders*` | `app.js` | `ORDERS_*` | app/order/UAT tests | REALIGN_METADATA |
| Sales delivery / `sales-deliveries` | `/api/sales-deliveries*` | `app.js` + quality/value services | `SALES_DELIVERIES_*` | delivery/UAT tests | REALIGN_METADATA |
| Returns / `returns` | `/api/sales-returns*`, `/api/purchase-returns*` | `app.js` + financial controls | `RETURNS_*` | logistics/UAT tests | REALIGN_METADATA |
| Sales discount / `sales-discounts` | `/api/sales-discounts*` | `modules/discounts.js` | `SALES_DISCOUNT_MANAGE` | `m14-discounts` | REALIGN_METADATA |
| Forecast / `forecasts` | `/api/planning/forecasts*` | `modules/planning.js` | `MRP_*` | `m11-planning` | KEEP |
| MRP / `mrp-runs`, `material-requirements-plan` | `/api/planning/mrp-runs*` | `modules/planning.js` | `MRP_*` | `m11-planning`, P1 | KEEP |
| Planning instructions / two instruction routes | `/api/planning/*instructions*` | `modules/planning-documents.js` | instruction permissions | `m12-planning-documents` | REALIGN_METADATA |
| Suppliers / `suppliers` | `/api/suppliers*` | `modules/suppliers.js` | `SUPPLIERS_*` | `v2-wave3c` | REALIGN_METADATA |
| Requisition / `purchase-requisitions` | `/api/planning/purchase-requisitions*` | `modules/planning-documents.js` | `PURCHASE_REQUISITION_*` | `m12-planning-documents` | REALIGN_METADATA |
| Purchase order / `purchase-orders` | `/api/purchase-orders*` | `app.js` | `PURCHASE_ORDERS_*` | app/purchase/UAT tests | REALIGN_METADATA |
| Purchase receipt / `purchase-receipts` | `/api/purchase-receipts*` | `app.js` + quality/value services | `PURCHASE_RECEIPTS_*` | receipt/UAT tests | REALIGN_METADATA |
| Purchase discount / `purchase-discounts` | `/api/purchase-discounts*` | `modules/discounts.js` | `PURCHASE_DISCOUNT_MANAGE` | `m14-discounts` | REALIGN_METADATA |
| Production execution / four production routes | `/api/production-*`, `/api/material-*` | `app.js`, `production-workflow.js`, `manufacturing-execution.js` | `PRODUCTION_*` | production/manufacturing tests | REALIGN_METADATA |
| IQC/OQC/QCP / three quality routes | `/api/iqc*`, `/api/oqc*`, `/api/quality-control-points*` | `authoritative-quality.js`, `quality-gates.js`, `traceability-quality.js` | `IQC_*`, `OQC_*`, `USERS_MANAGE` | quality tests | REALIGN_METADATA |
| Warehouses / `warehouses` | `/api/warehouses*` | `modules/warehouses.js` | `WAREHOUSES_*` | `v2-wave3a` | REALIGN_METADATA |
| Inventory / six inventory routes | `/api/inventory*`, traceability APIs | `app.js`, inventory/traceability/period modules | inventory permissions | inventory/traceability tests | REALIGN_METADATA |
| AR/AP/settlement / four routes | `/api/settlement*`, open-item APIs | `settlement.js`, `settlement-core.js`, `financial-controls.js`, `app.js` | `AR_*`, `AP_*` | `m8-settlement`, financial tests | REALIGN_METADATA |
| Invoice/bill / two routes | `/api/commercial/*` and compatible endpoints | `commercial-golive.js` | `AR_*`, `AP_*`, accounting permissions | commercial UAT | REALIGN_METADATA |
| Treasury/bank / bank route | `/api/bank-accounts*`, reconciliation APIs | `app.js`, `extended.js` | bank/accounting permissions | financial tests | REALIGN_METADATA |
| Cost / two routes | `/api/product-costs*`, `/api/cost-rates*` | `app.js`, manufacturing execution/value services | `COST_*` | cost tests | REALIGN_METADATA |
| Accounting / `accounting` | accounting/voucher/GL APIs | `app.js`, `accounting-config.js`, `financial-inventory.js` | accounting/voucher permissions | voucher/report tests | REALIGN_METADATA |
| Analytics / overview/dashboard/reports | dashboard/report APIs | `decision-reports.js`, `extended.js`, `app.js` | `DASHBOARD_VIEW`, `REPORT_VIEW` | decision/report tests | REALIGN_METADATA |
| Approval / `approvals` | `/api/approvals` | `modules/approvals.js` | approval families | approval tests | KEEP_PLATFORM |
| Notifications / `notifications` | `/api/notifications*` | new `platform-notifications.js` | `DASHBOARD_VIEW` | app + new architecture test | SPLIT_MIXED_OWNER |
| Workflow foundation / `workflows` | `/api/workflows*` | new `platform-workflows.js` | `WORKFLOW_*` | app + new architecture test | SPLIT_MIXED_OWNER |
| Users/Roles / `users` | `/api/users*`, `/api/roles*` | `users.js`, `roles.js` | `USERS_*`, `ROLES_*` | ownership tests | KEEP_PLATFORM |
| Lifecycle / `data-cleanup` | `/api/lifecycle*` | `data-lifecycle.js`, `lifecycle-engine.js` | admin/lifecycle permissions | lifecycle tests | KEEP_PLATFORM |

### 22.4 Backend module → Domain mapping

- Master & Engineering: `products.js`, `product-routing.js`, `manufacturing-reference.js`，以及 `app.js` 内 BOM legacy family；
- Sales & Customer: `customers.js`、Sales Order/Delivery/Return 在 `app.js` 的 legacy families、`discounts.js` 的 Sales side；
- Planning: `planning.js`, `planning-documents.js`；
- Procurement & Outsourcing: `suppliers.js`、Purchase Order/Receipt/Return 在 `app.js` 的 legacy families、`discounts.js` 的 Purchase side；
- Manufacturing & Quality: `production-workflow.js`, `manufacturing-execution.js`, `authoritative-quality.js`, `quality-gates.js`，以及 `traceability-quality.js` 的 quality side；
- Inventory & Warehouse: `warehouses.js`, `inventory-extensions.js`, `inventory-period-close.js`，以及 `traceability-quality.js` 的 identity/trace side；
- Finance Operations: `settlement.js`, `settlement-core.js`, `financial-controls.js`, `commercial-golive.js`, `financial-inventory.js` 的 valuation/WIP service side；
- Accounting & Analytics: `accounting-config.js`, `decision-reports.js`, `financial-inventory.js` 的 GL/reconciliation/report side，`extended.js` 的 auxiliary/period/report side；
- Platform: `approvals.js`, `users.js`, `roles.js`, `data-lifecycle.js`, `lifecycle-engine.js`, new notification/workflow modules；
- `lookups.js` 是受 usage-domain permission 约束的只读 projection service，不成为被查询业务事实 owner。

### 22.5 Platform extraction and dispatch

Frontend SPLIT_NOW：

- `platform-notifications.jsx` 原样承载 `Notifications`；
- `platform-workflows.jsx` 原样承载 `Workflows` 与 file-local `WorkflowModal`；
- Registry loader 改向新文件；zero-caller search 后删除 `projects-workflow.jsx`。

Backend SPLIT_NOW：

- `platform-notifications.js` 原样承载 `listNotifications`、`markNotificationRead`；
- `platform-workflows.js` 原样承载 `listWorkflows`、`createWorkflow`；
- 四条 method/path 通过 `ownedRouteTable` 注册，owner 分别指向新 module；权限、body、SQL、response、audit 原样保留；
- 删除 legacy direct branches 与 `business.js`，确保 single canonical dispatch owner。

### 22.6 Conditional mixed-owner decisions

SPLIT_NOW 仅限上述前后端 Platform owner。其余决定：

- `extended.js` — KEEP_TEMPORARY_WITH_DEBT：包含 Accounting auxiliary/close/report、Finance treasury、Planning MRP、Manufacturing labor/quality、Procurement supplier evaluation、Platform alerts/OA。虽然逻辑可辨识，但一次拆分会同时改变大量 app imports 与多个回归面；后续由相应 Capability Closure 逐 family 迁移。
- `commercial-golive.js` — KEEP_TEMPORARY_WITH_DEBT：primary owner 为 Finance Operations，但税/UOM snapshot、invoice/bill/credit、valuation/GL/open-item 原子流程高度耦合；拆开会跨事务边界，留待 Finance Operations closure。
- `financial-inventory.js` — KEEP_TEMPORARY_WITH_DEBT：primary service owner 为 Finance Operations，同时为 Accounting & Analytics 提供 GL/reconciliation projection；valuation/WIP/GL 原子不在 metadata alignment 中拆分。
- `traceability-quality.js` — KEEP_TEMPORARY_WITH_DEBT：Inventory identity 与 Quality policy 共用 LOT/SERIAL movement authority；留待两域接口边界被专项 acceptance 覆盖后拆分。
- `discounts.js` — KEEP_TEMPORARY_WITH_DEBT：Sales/Purchase 两侧复用同一 financial adjustment primitive，保持当前对称模块。
- `server/app.js` — KEEP_TEMPORARY_WITH_DEBT：仍含多域 legacy families；只有已有 coherent module 与完整 caller/test proof 的小 family 才逐波迁移，本轮不以行数为目标。

所有 debt 都有 primary logical owner，不允许 UNKNOWN 或 DUAL_OWNER；共享 service 不等于 mutable fact 双 owner。

### 22.7 Compatibility, error and rollback

- 不 rename route/API/table/column，不增 migration；
- screen component body 与 backend handler body 原样移动；
- permission gate、transaction、idempotency、audit、status/error response 原样保留；
- `ownedRouteTable` 仍在 authentication 后 dispatch，Platform handler 保留 runtime authorization；
- rollback 无数据动作：revert Domain Alignment commit 即可；不需要数据恢复或 migration rollback。

### 22.8 Test strategy

新增 `server/v17-domain-alignment.test.js` pure source/module contract suite，加入 FAST + FULL，验证 canonical set、47/5 inventory、8 个非空 Business Launcher groups、Platform exclusion、代表 route 边界、removed extension routes、new/old owner file contract 与 owned route descriptors。同步旧 V1.5/V1.6 tests 中已经被新 Requirement 替代的 6/7-domain literal，保留所有行为回归。focused tests 包含新 suite、frontend registry/launcher/mobile shell、route-table、UI source、notification/workflow API；最终运行 `pnpm test:fast`、`pnpm test`、`pnpm build`、`git diff --check`。

### 22.9 Placement rule for future capabilities

Quotation/Credit → Sales & Customer；Sourcing/Outsourcing Order → Procurement & Outsourcing；Barcode → Inventory & Warehouse；ECO → Master & Engineering；Scheduling/Dispatch → Manufacturing & Quality；Smart Accounting → Accounting & Analytics；Generic Workflow → Platform。任何新增能力仍须先走 Audit → Requirement → Design，不能把此映射当成开发授权。

---

**SOLUTION BASELINE — DOMAIN ALIGNMENT DESIGN APPROVED FOR AUTHORIZED IMPLEMENTATION**

---

## 23. Master & Engineering Domain Technical Design

> 本节固化 Master & Engineering Domain Closure 的 Design 阶段成果。
> Requirement 见 `document.md §28`；Wave 实施策略见 §23.11。
> 本节明确工程数据如何作为 Planning / Manufacturing / Outsourcing 的 stable authoritative source。

### 23.1 Module Ownership

| Owner module | 主要 API family | 备注 |
|---|---|---|
| `server/modules/engineering-reference.js` | `/api/engineering/shifts*` `/api/engineering/shift-patterns*` `/api/engineering/calendar-templates*` `/api/engineering/work-calendars*` `/api/engineering/basic-activities*` `/api/engineering/workshop-formulas*` `/api/engineering/resources*` `/api/engineering/equipment*` `/api/engineering/operations*` `/api/engineering/control-codes*` | Wave A |
| `server/modules/engineering-work-center.js` | `/api/work-centers*`（additive update + deactivate + calendar linkage） | Wave A；保留现有 `manufacturing-reference` 的 GET/POST 不变 |
| `server/modules/engineering-bom.js` | `/api/boms*` `/api/bom-items*`（additive: purpose / effective lifecycle / tree / batch / analysis） | Wave B；保留既有 `listBoms/getBom/createBom/updateBom` request/response 关键字段 |
| `server/modules/engineering-substitute.js` | `/api/engineering/substitutes*` `/api/engineering/substitute-schemes*` | Wave C |
| `server/modules/engineering-configurable-bom.js` | `/api/engineering/configurable-boms*` | Wave C |
| `server/modules/engineering-change.js` | `/api/engineering/changes*` `/api/engineering/changes/:id/apply` `/api/engineering/changes/:id/impact-preview` | Wave E |
| `server/modules/engineering-routing-enrichment.js` | `/api/engineering/product-routings/:id/topology` `/api/engineering/product-routings/:id/enrichment` | Wave D |
| `server/modules/product-routing.js` | `/api/product-routings*`（canonical owner already） | 保持；WAVE D 加 enrichment 入口与 topology 字段 |
| `server/modules/manufacturing-reference.js` | `/api/work-centers*` GET/POST 已有 owner；`/api/routing-operations*` legacy owner | Wave A 增强；Wave D legacy convergence |

### 23.2 Engineering Reference Data Model

所有 Reference master 强制字段：

- `id` (TEXT PK)、`code` (唯一 CODE，匹配 `[A-Z0-9._-]{1,40}`)、`name` (≤ 100)、`active` (1/0)、`created_at` / `updated_at`、`notes` (≤ 500)；
- 部分字段：`calendar_id`（Shift Pattern / Work Center 引用）、`work_center_id`（Calendar / Resource / Equipment 关联）、`category`（Resource 类型 enum）；
- Reference master 必须有 lifecycle `active` 而非硬删除；
- 历史引用通过 `active=0` 软停用而非 DELETE。

#### Wave A 新增表

- `engineering_shifts`：班次（time-window-based；`start_time`/`end_time` 必须早于该 window 边界）；
- `engineering_shift_patterns`：班制（每日班次数 + shift 顺序）；
- `engineering_calendar_templates`：工作日规则（每周工作日）；
- `engineering_work_calendars`：实际工作日历（关联 calendar template + shift pattern + 适用日期范围）；
- `engineering_basic_activities`：基础活动（code/name/unit/default_qty）；
- `engineering_workshop_formulas`：车间公式（受限 grammar string + version）；
- `engineering_resources`：资源（type enum: MACHINE/TOOL/PERSON/MATERIAL；capacity_uom）；
- `engineering_equipment`：设备（model/serial/spec）；
- `engineering_operations`：作业 master（code/name/standard_minutes/activity_id）；
- `engineering_control_codes`：工序控制码（type enum: SCHEDULING/PROCESSING/REPORT/INSPECTION/OUTSOURCE；policy references）。

#### Work Center 增强字段（additive migration）

- `work_centers` 表 additive：增加 `calendar_id`（FK engineering_work_calendars）/ `default_efficiency_pct` / `is_outsource` / `notes` / `updated_at`；
- 既有字段保持：id/code/name/type/capacity_hours/efficiency/unit_cost_cents/active/created_at。

### 23.3 Workshop Formula Engine（受限 grammar）

**安全要求（强制）：**

- 禁止 `eval()` / `Function()` / `vm` / `exec` / `subprocess`；
- 实现方式：手写 recursive descent parser（变量/数字字面量/运算符 + - * / ^ / 括号）；
- 允许的 token：标识符（白名单前缀 `e_`）、数字字面量（IEEE 754 安全整数/有限 double）、运算符（+ - * / ^）、括号；
- 防御：禁止 `--` 语句；禁止 length > 256；禁止 parse depth > 32；除零返回明确 `DIVIDE_BY_ZERO`；未识别标识符返回 `UNKNOWN_IDENTIFIER`；
- 表达式编译结果仅作为简单 AST 求值器；不引入第三方表达式引擎；
- 公式可绑定变量（如 `qty`/`setup_time`/`run_time`），由调用方传值；解析阶段给出 `value × formula` 结果。

#### Schema（SQLite/MySQL）

`engineering_workshop_formulas(id, code UNIQUE, name, formula TEXT, version, active, created_at, updated_at)`。

### 23.4 BOM 生命周期 & Purpose

`boms` 表 additive 新字段：

- `purpose` TEXT default `'GENERAL'` CHECK IN (`GENERAL`,`SELF_MAKE`,`OUTSOURCE`)；
- `effective_from` TEXT nullable；
- `effective_to` TEXT nullable；
- `approval_status` TEXT default `'DRAFT'` CHECK IN (`DRAFT`,`PENDING`,`APPROVED`,`REJECTED`,`WITHDRAWN`)；
- `approved_by` TEXT nullable；`approved_at` TEXT nullable；
- `change_request_id` TEXT nullable（ECO 来源）；
- 既有 `version` TEXT 不变；既有 `status` (`ACTIVE`/`DISCONTINUED`) 不变；既有 `remark` 不变。

约束：

- `purpose=GENERAL/SELF_MAKE/OUTSOURCE` 与 `approval_status` 解耦；
- 仅 `status='ACTIVE' AND approval_status='APPROVED'` 进入生产/MRP/委外 resolver；
- 同一 `(product, purpose)` 下允许多 ACTIVE 版本（按 effective_from/effective_to 决定）；
- 既有 ACTIVE/DISCONTINUED 数据回填时 `purpose='GENERAL'`, `approval_status='APPROVED'`, `effective_from=created_at`。

#### Resolver contract（供下游使用）

```text
resolveEffectiveBom({ productId, businessDate, purpose })
  -> { id, version, approvalStatus, ... } | null
```

实现根据 `(product_id, purpose, status='ACTIVE', approval_status='APPROVED')` 选择：

1. 若仅一条命中 → 返回；
2. 若多条（effective range 重叠）→ 选择 `effective_from` 最近的；
4. 若无 ACTIVE/APPROVED → 返回 null（由调用方降级到旧单一 ACTIVE BOM）。

### 23.5 BOM Tree & Cycle

#### Tree 展开（forward multi-level）

```
expandBomTree(bomId, levels=∞)  →  { id, items: [{ id, childBom: expandBomTree(...) }] }
```

每次展开通过 `bom_items.product_id → boms.id`（purpose=GENERAL/SELF_MAKE active+approved）。

#### Cycle Detection

- direct self-ref：已在 `validateBomPayload` 检查；
- multi-level cycle：使用 DFS 着色 (`WHITE/GRAY/BLACK`) 在 `INSERT/UPDATE` 时拒绝形成环；返回 `BOM_CYCLE`。

#### Where-Used

```
whereUsedBy(componentProductId, levels=∞)  →  [{ parentProductId, parentProductCode, bomId, purpose, version, ... }]
```

按 `bom_items.product_id = componentProductId` 向上递归。

### 23.6 BOM Batch Maintenance

按 Capability ME-17：

- `POST /api/operations/boms/batch-add`（preview/apply mode）；
- `POST /api/operations/boms/batch-modify`（preview/apply mode）；
- `POST /api/operations/boms/batch-remove`（preview/apply mode）；
- `POST /api/operations/boms/batch-replace`（preview/apply mode）。

请求格式：

```json
{
  "mode": "preview",
  "filter": { "productIds": [...], "purpose": "GENERAL" },
  "changes": [{ "type": "add", "componentProductId": "...", "quantity": 1, "scrapRate": 0 }, ...]
}
```

`preview` 模式：

- 不写任何 mutation；
- 返回 `{ affectedBoms: [...], diff: [{ bomId, before, after }], conflicts: [...] }`。

`apply` 模式：

- atomic transaction；
- 任一 BOM 失败 → 全部回滚；
- 写 audit；
- 返回 `{ appliedCount, auditId }`。

### 23.7 BOM Engineering Analysis

API：

- `POST /api/analysis/boms/forward`（multi-level expand + qty × level）；
- `POST /api/analysis/boms/where-used`（reverse，component → parents）；
- `POST /api/analysis/boms/consolidated`（按 component 汇总 cross-level）；
- `POST /api/analysis/boms/compare`（两个 BOM 版本/对节点 → diff line items）；
- `POST /api/analysis/boms/cost`（按 BOM 层级 × 标准成本，**仅读** `product_costs`，不创建第二套成本事实）。

返回结构化 diff + numeric aggregation；不做第二套成本事实。

### 23.8 Substitute Scheme

Schema：

- `engineering_substitute_schemes(id, code UNIQUE, name, strategy CHECK IN ('MIXED','MANUAL','BATCH','BATCH_MIXED'), method CHECK IN ('REPLACE','SUPERSEDE','PROPORTION'), active, created_at, updated_at)`；
- `engineering_substitutes(id, scheme_id, primary_product_id, substitute_product_id, priority INTEGER, ratio NUMERIC, effective_from TEXT, effective_to TEXT, active, created_at, updated_at)`。

约束：

- primary != substitute；
- priority 唯一（同一 scheme 内）；
- effective_from < effective_to（如 both）；
- `strategy=PROPORTION` → 必须 ratio > 0；
- 周期内 deterministic resolver：`findSubstitutes({ primaryProductId, businessDate })` 按 priority 升序、active=1、effective range 命中。

### 23.9 Configurable BOM

Schema（在 `bom_items` 上 additive 标志）：

- `bom_items.is_selectable` (0/1)：可选料件；
- `bom_items.is_replaceable` (0/1)：可替换料件；
- `bom_items.is_modifiable` (0/1)：可调整料件；
- `bom_items.config_group` TEXT NULL：可选/替换组（同一 group 互斥或可互替）；
- `bom_items.config_constraint` （附加 JSON 字符串，可选）；

API：

- `POST /api/engineering/configurable-boms/preview`：根据一组 choices 预览最终 BOM；
- `POST /api/engineering/configurable-boms/validate`：校验所选 choices 是否满足所有 `is_required` / `is_mutually_exclusive` 规则；

不创建 `sales_order_bom` 或类似组件；订单侧配置留给 Sales & Customer Domain。

### 23.10 Routing Canonical Convergence & Enrichment

#### Legacy convergence

- `routing_operations` (legacy) 与 `production_labor_records.operation_id` FK 保持；
- `manufacturing-reference.js` 的 GET/POST 仍注册为 legacy API owner（**Wave A 不变**）；
- `product_routings` / `product_routing_operations` 是 canonical；
- 添加 server-side static assertion test 验证：**当前 active mutation path 不再新增 legacy `routing_operations`**；legacy 列表 GET 标注 `LEGACY_HISTORICAL` 标记，前端继续禁用新增 UI（已无 UI）。

#### Enrichment fields（additive migration）

- `product_routing_operations` 新增：`operation_id` (FK engineering_operations) / `control_code_id` (FK engineering_control_codes) / `activity_id` (FK engineering_basic_activities) / `resource_id` (FK engineering_resources) / `equipment_id` (FK engineering_equipment) / `is_outsource` (0/1) / `quality_policy` TEXT；
- `product_routings` 新增：`topology_type` (DEFAULT `LINEAR` CHECK IN (`LINEAR`,`NETWORK`))；
- `product_routing_operation_links`：拓扑关联（parent_operation_id, child_operation_id, type CHECK IN (`PARALLEL`,`SPLIT`,`MERGE`,`ALTERNATE`)，sequence_no）。

#### Topology metadata

允许为同一 Routing，路由配上 `LINEAR` 或 `NETWORK`：

- LINEAR：保持现状（sequence_no 单链）；
- NETWORK：通过 `product_routing_operation_links` 表达并行/分割/合并/替代；
- 不实现 APS 求解；只建立数据模型与可视化。

### 23.11 Implementation Waves

每个 Wave 必须 focused tests PASS；canonical gate 见 §23.16。

#### Wave A — Engineering Reference Foundation

- 新增 `engineering_shifts` 等 9 张表 + additive `work_centers` 字段；
- 新增 `server/modules/engineering-reference.js` + `server/modules/engineering-work-center.js`；
- 注册到 `ownedRouteTable`（owner = `server/modules/engineering-reference.js` 等）；
- mobile UI：单一 Engineering Reference 工作面（含 9 类 master 入口 + Work Center 增强入口）；加载 `erp-mobile-taste` Skill 仅用于此 UI。
- DB migration：SQLite + MySQL 8 parity；`idempotent`；
- 新 permission：12 个 `ENGINEERING_*`；
- 测试：`server/engineering-reference.test.js`。

#### Wave B — BOM Governance & Productivity

- 新增 BOM additive 字段（purpose/effective/approval/change_request_id）；
- 新增 `server/modules/engineering-bom.js`：保有现有 `listBoms/getBom/createBom/updateBom` 行为 + 新增：
  - purpose / effective / approval lifecycle；
  - tree expand + cycle detection；
  - batch maintenance preview/apply；
  - engineering analysis（forward/where-used/consolidated/compare/cost）。
- DB migration additive；
- resolver contract 文档化；
- mobile UI：BOM list → detail → modal 改造（list → detail → editor/workbench 风格）。
- 测试：`server/engineering-bom.test.js`。

#### Wave C — Substitute & Configurable BOM

- 新增 `engineering_substitute_schemes` / `engineering_substitutes` 表；
- 新增 `bom_items` additive config flags（is_selectable / is_replaceable / is_modifiable / config_group）；
- 新增 `server/modules/engineering-substitute.js` + `server/modules/engineering-configurable-bom.js`；
- deterministic resolver；
- mobile UI：substitute list / detail / schema editor；configurable BOM preview/validate。
- 测试：`server/engineering-substitute.test.js` + `server/engineering-configurable-bom.test.js`。

#### Wave D — Routing Consolidation & Enrichment

- 收敛 legacy `routing_operations` mutation path（保留 table + FK；不再 active mutate）；
- additive enrichment `product_routings` / `product_routing_operations` 字段 + `product_routing_operation_links` 表；
- 新增 `server/modules/engineering-routing-enrichment.js`：topology metadata + operation refs validation；
- mobile UI：Routing detail 视图加 topology 视图与 enrichment 字段。
- 测试：`server/engineering-routing.test.js`。

#### Wave E — Engineering Change

- 新增 `engineering_change_orders` 表（id/doc_no/change_type/effective_date/approval_status/created_by/created_at/notes）；
- 新增 `engineering_change_items` 表（id/change_order_id/op_type/...）；
- 新增 `server/modules/engineering-change.js`：impact preview / apply / atomic transaction / audit；
- Change Type 支持 `IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD`；
- Allowed operations 按 change type 受限：
  - IMMEDIATE：ADD / MODIFY / DELETE / INVALIDATE / MODIFY_HEADER；
  - EFFECTIVE_DATE：ADD / MODIFY / INVALIDATE / MODIFY_HEADER；
  - USE_UP_OLD：MODIFY / MODIFY_HEADER + old/new material substitution relation；
- atomic apply，失败回滚，写 audit，历史 snapshot 不可被反向污染。
- mobile UI：ECO list → detail → create。
- 测试：`server/engineering-change.test.js`。

#### Wave F — Downstream Contract Stabilization

- 验证 Production Order / BOM snapshot / Routing snapshot / Material Issue 仍正常；
- 验证现有 MRP explosion 仍能读取 canonical effective BOM；
- 验证 Outsourcing `purpose=OUTSOURCE` BOM resolver contract 提供稳定合同；
- 不实现完整 MRP substitute planning / 完整 Outsourcing；
- 测试：`server/engineering-downstream.test.js`。

### 23.12 Migration / Schema / MySQL parity

- 所有新表 / 新字段 additive；
- `addColumn` helper 复用既有 `v13-phase*.js` 模式；
- `server/database/mysql-schema.js` 同步加入新表/新字段 DDL；
- migration idempotent：`CREATE TABLE IF NOT EXISTS` / `addColumn` with check；
- 测试覆盖 SQLite + 具备 MySQL 受保护 disposable 测试库时 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。

### 23.13 Permission / RBAC

新增最少 Engineering permission 12 个（§28.5 列表）；保留既有 5 个角色 seed 与 BOM 用 `PRODUCTION_ORDERS_*` 兼容。

### 23.14 Audit / Transaction / State machine

- 所有 BOM/Routing/ECO/Substitute mutation：`transaction(db, work)` + `audit(db, ...)`；
- 历史 snapshot（production_order_*_snapshots）**不可写回修改**；
- Reference master lifecycle：`active=0` 而非 DELETE；
- 关键 cycle：DB mutation → re-read → check state → if conflicted throw。

### 23.15 Test Strategy

| Wave | 测试族 | 关注合同 |
|---|---|---|
| A | `engineering-reference.test.js` `engineering-work-center.test.js` | reference CRUD、formula grammar、calendar validation、work center reference guard |
| B | `engineering-bom.test.js` | lifecycle / purpose / version / cycle / tree / batch / snapshot immutability / analysis |
| C | `engineering-substitute.test.js` `engineering-configurable-bom.test.js` | substitute validation / priority / date / ratio / resolver；configurable preview/validate |
| D | `engineering-routing.test.js` | canonical convergence / operation refs / topology metadata / snapshot preservation |
| E | `engineering-change.test.js` | transition / allowed operations by change type / impact preview / apply atomic / audit / rollback / use-up-old boundary |
| F | `engineering-downstream.test.js` | production consumer stability / MRP consumer stability / outsource resolver contract

所有 focused tests 纳入 `scripts/testing/test-suites.js`。

### 23.16 Canonical Gates

按 AGENTS.md §10：

- 跨域 / 架构 / canonical metadata 阶段：`pnpm test` + `pnpm build` + `git diff --check`；
- 触及 high-risk schema 时：`pnpm test:heavy`；
- 具备受保护 disposable MySQL 环境时：`pnpm test:mysql` + `pnpm test:mysql:concurrency`；
- 每个 Wave 必须先 focused tests PASS 才进入下一 Wave。

### 23.17 Rollback

按 AGENTS.md §13：

- 所有 migration additive；无 destructive rewrite；
- 任何新 permission 未应用时，旧 `PRODUCTION_ORDERS_*` 隐含路径仍工作；
- 历史 Production snapshot 永不修改；
- legacy `routing_operations` 表 + FK 保留，停止 active mutation 可立即回滚（重新开启 mutation path）。
- Out-of-Scope 标记（Multi-Org / Mold / Mold Combination / Auxiliary / full MRP substitute consumption / full Outsourcing / full APS）不通过本 Domain Closure 提交。

### 23.18 Frontend Information Architecture

- 既有 master-engineering Launcher 不爆炸；
- 8 Domain Launcher 保持当前 8 Domain；
- `master-engineering` Launcher 改造：现有 3 项（products / boms / product-routings）保持 + 新增：
  - `engineering-reference` 工作面（9 类 master 入口 + Work Center 增强入口）以 single page + sheet 实现；
- `engineering-change`、`engineering-substitute`、`engineering-configurable-boms` 通过 master-engineering Launcher 的 contextual 入口呈现；不再额外添加顶级 tile。

---

**MASTER & ENGINEERING DOMAIN CLOSURE DESIGN — READY FOR AUTHORIZED IMPLEMENTATION**
