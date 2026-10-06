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

**SOLUTION BASELINE — READY FOR AUDIT**
