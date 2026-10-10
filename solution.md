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
| Manufacturing & Quality | manufacturing-orders、manufacturing-materials、manufacturing-execution、manufacturing-quality、manufacturing-scan、production-workflow | Dispatch、Transfer、Quality/NC 深化 |
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
| Manufacturing & Quality | `production-orders`, `material-issues`, `production-receipts`, `manufacturing-analytics`, `production-quality`, `production-scan`, `quality-configuration`, `iqc`, `oqc`, `quality-control-points` | — |
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
- `server/database/mysql-schema.js` 从 canonical SQLite snapshot 生成 MySQL DDL，并对已存在 completion marker 的 MySQL schema 对比 `information_schema` 执行 additive table/column/ordinary-index reconciliation；
- migration idempotent：缺表才 `CREATE TABLE IF NOT EXISTS`，缺列才 `ALTER TABLE ... ADD COLUMN`，缺普通索引才 `CREATE INDEX`；不 DROP/不重写业务数据；
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
| Frontend | `engineering-frontend-contract.test.js` + `scripts/acceptance/v17-engineering-frontend.mjs` | Registry/API contract；Edge 320/390/430/680 响应式与 runtime error |
| MySQL schema | `engineering-mysql-schema.test.js`、`mysql-v14-1-hotfix-upgrade-path.integration.js` | 15 张工程表、5 张既有表上的 28 个 additive 列、7 个显式普通索引、metadata alias、existing DB upgrade、数据保留与二次启动幂等性 |

所有 focused tests 纳入 `scripts/testing/test-suites.js`。

#### MySQL parity blocker 实施证据（2026-10-07）

- Root cause：`information_schema.COLUMNS` / `STATISTICS` 查询没有显式 alias，mysql2 返回 driver-native `COLUMN_NAME` / `INDEX_NAME`，而 reconciliation 读取 `row.column_name` / `row.index_name`；existing-column Set 因而得到 `undefined`，将已存在的 `id` 误判为缺失并执行重复 `ALTER TABLE ADD COLUMN id`。
- Fix：`readMySqlColumnNames()` 使用 `COLUMN_NAME AS column_name` 并按 `ORDINAL_POSITION` 排序；`readMySqlIndexNames()` 使用 `INDEX_NAME AS index_name`。bootstrap 统一复用这两个 canonical inspection helper，不增加 `id` 特判、不吞掉 `ER_DUP_FIELDNAME`、不禁用 reconciliation。
- Upgrade path：真实 MySQL 测试先构造 pre-Engineering schema，移除 15 张新表及代表性 additive 列，再连续初始化两次；验证新表/列只补齐一次、既有 Work Center 行与 Engineering permission mapping 不变、table count 恢复且稳定。
- Fresh / second start：fresh bootstrap 的应用表集合与 canonical SQLite snapshot 精确相等，另仅有 2 张 MySQL infrastructure 表；第二次初始化无 duplicate table/column/index 且无数据变更。
- Schema count：当前 snapshot / migration 计算结果为 15 张新表、28 个 additive 列、7 个显式普通索引；不再沿用旧的 174/172 hard-coded table count，MySQL gate 改为与实时权威 snapshot/source 精确比对。

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
- `engineering-substitute` 合并 Substitute + Configurable BOM 工作面，`engineering-change` 为 bounded ECO 工作面；两者均是 master-engineering Launcher 内的 canonical route，不创建第二套 executable screen。

---

**MASTER & ENGINEERING DOMAIN CLOSURE DESIGN — READY FOR AUTHORIZED IMPLEMENTATION**

---

## 24. Manufacturing & Quality Domain Technical Design

> 本节固化 Manufacturing & Quality Domain Closure 的 Design 阶段成果。Requirement 见 `document.md §29`。Manual Evidence Baseline 来自 Prompt §0–§43；本节按 8 个 Implementation Wave (A–H) 展开。
> 不在本 Domain 范围 / 跨域 deferred 一律按 `document.md §29.1` 与 §29.7 处理。

### 24.1 Module Ownership

新增 / 既有 `server/modules/` owner modules：

- **`manufacturing-orders.js`**（NEW，Wave A） — `production_orders` canonical owner；Draft / Submit / Approve / Reject / Release / Start / Complete / Cancel / Source / Lifecycle；保留原 handler 在 `server/app.js` 直至 caller proof 完成逐步迁移。
- **`manufacturing-materials.js`**（NEW，Wave B） — Material Issue / Supplement / Return / Batch Picking canonical owner；保留原 handler 在 `production-workflow.js` 直至 caller proof 完成。
- **`manufacturing-quality.js`**（NEW，Wave E） — Inspection Item / Detection Value / Instrument / Inspection Plan；与现有 IQC/OQC engine 通过 `qualityConfig` + `freezeQualityPolicy` 形成 `when` 关系。
- **`manufacturing-execution.js`**（ENHANCE，Wave C / D） — Operation Plan lifecycle / Forward-Backward Scheduling / Topology / Control Code Snapshot / Internal Handoff；保持现有 quantity / WIP / value / reversal contract。
- **`manufacturing-scan.js`**（NEW，Wave G） — Production Scan 工作面：material / operation lookup + shortcut；不实现完整 B3105。
- **`manufacturing-analytics.js`**（NEW / ENHANCE，Wave H） — Execution Summary / Material Issue Summary；保留既有 WIP / Yield / Capacity / Cost。

保留既有：

- `production-workflow.js`：issue / return / receipt / receipt-reversal handler 保持原状；
- `manufacturing-execution.js`：operation report / reversal / WIP / cost 已有；
- `authoritative-quality.js` / `quality-gates.js` / `traceability-quality.js`：IQC / OQC / QCP / sampling 不破坏；
- `engineering-bom.js` / `engineering-routing-enrichment.js`：canonical BOM/Routing source；本 Domain 是 consumer。

### 24.2 Production Order State Machine

`production_orders.status` 增加 additive enum（不破坏既有数据）：

```text
DRAFT        — created editable, no source executed
PENDING      — submitted, awaiting approval (legacy semantic; == SUBMITTED in B3119 sense)
SUBMITTED    — submitted; awaiting approval
APPROVED     — approved; awaiting release
RELEASED     — released; ready to start
IN_PROGRESS  — started; active execution
COMPLETED    — completed
CANCELLED    — cancelled
REJECTED    — approval rejected (kept distinct from CANCELLED for audit semantics)
```

CHECK 约束扩展：`CHECK(status IN ('DRAFT','PENDING','SUBMITTED','APPROVED','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED','REJECTED'))`。

Transition：

```text
DRAFT      -> SUBMITTED  (allow: PRODUCTION_ORDERS_CREATE)
DRAFT      -> CANCELLED  (allow: PRODUCTION_ORDERS_CREATE)
PENDING    -> SUBMITTED  (legacy path; treated as alias)
SUBMITTED  -> APPROVED   (allow: PRODUCTION_ORDERS_APPROVE; idempotency key; Approval family PRODUCTION_ORDER)
SUBMITTED  -> REJECTED   (allow: PRODUCTION_ORDERS_APPROVE)
APPROVED   -> RELEASED   (allow: PRODUCTION_ORDERS_RELEASE)
APPROVED   -> CANCELLED  (allow: PRODUCTION_ORDERS_APPROVE or CREATE)
RELEASED   -> IN_PROGRESS (allow: PRODUCTION_ORDERS_START; canonical Engineering snapshot taken)
RELEASED   -> CANCELLED  (allow: PRODUCTION_ORDERS_CREATE/START)
IN_PROGRESS -> COMPLETED (allow: PRODUCTION_ORDERS_COMPLETE)
IN_PROGRESS -> CANCELLED (allow: PRODUCTION_ORDERS_CREATE/START; only if zero net issued + zero confirmed report)
```

每个转移：

- 在 transaction 内重新读取权威状态 + 累计执行量；
- 状态检查 + 权限 + 业务不变量；
- audit 写 audit_logs；
- 释放时由 `snapshotProductionOrder` 写 BOM / Routing snapshot；后续 master edit 不得反向污染。

### 24.3 Approval / Release

`PRODUCTION_ORDER` 新 Approval family 在 `server/modules/approvals.js` 注册，沿用现有 Platform Approval 基础设施（applies to: `production_orders`）：

- Submit：创建一条 approval request (status='PENDING')；
- Approve：applies to state `SUBMITTED -> APPROVED`；reject `SUBMITTED -> REJECTED`；
- Release：独立 `RELEASED` 状态机（不同于 Approval），由 `PRODUCTION_ORDERS_RELEASE` 控制；
- 不实现 Generic Workflow / B3122。

`server/db.js` 增加：

```text
INSERT OR IGNORE INTO approval_families(code, label) VALUES ('PRODUCTION_ORDER','生产订单审批');
```

旧 `PENDING` 视为 `SUBMITTED` alias；新写入仍可用旧字符串兼容。

### 24.4 Engineering Resolver Integration

在 production order 创建 / start 路径，由 canonical Engineering resolver 提供 BOM：

- `engineering-bom.resolveEffectiveBomForCaller({ caller: 'PRODUCTION_ORDER_CREATE', productId, purpose: 'SELF_MAKE', atDate })`；
- 若 `bomId` 在 body 给出且通过 resolver 校验，则接受；否则由 resolver 自动选择；
- resolver 校验：purpose + effective_from/effective_to + approval_status = 'APPROVED'；
- 与生产手工 / Instruction 释放路径完全一致。

旧 `boms.status='ACTIVE' ORDER BY ... LIMIT 1` 在生产路径全部替换；Engineering Resolver 是 BOM 选择的唯一 authority。

### 24.5 Material List

`production_order_items` 仍是 canonical frozen BOM line；本次 additive：

- `material_list_status TEXT NOT NULL DEFAULT 'GENERATED'` （`GENERATED / UNDER_REVIEW | CONTROLLED_EDIT / APPROVED / RELEASED`）；
- `material_list_approved_by / approved_at`；
- `material_list_released_by / released_at`；
- 不破坏既有 quantity / quantity_per_unit / scrap_rate_snapshot / bom_item_id。

Material List lifecycle：

- 订单 APPROVED 后 Material List 自动 `GENERATED`（受控编辑 = `CONTROLLED_EDIT`）；
- RELEASED 之前允许 controlled edit（不允许修改 product_id / quantity_per_unit，只允许调整 scrap / remark / additional comment）；
- RELEASED 之后只允许 Supplement 追加。

### 24.6 Issue / Supplement / Return / Batch Picking

- **Issue**：复用 `production-workflow.js::createProductionMaterialIssue` 等。不重写。
- **Supplement**：新建 `server/modules/manufacturing-materials.js::createProductionMaterialSupplement / confirmProductionMaterialSupplement`：
  - 来源：`Production Order` / `Production Material Return`；
  - 必须 explicit 业务原因（`reason_code IN ('SHORTAGE', 'YIELD_LOSS', 'QUALITY_REPLACEMENT', 'OTHER')`）；
  - 走同一 `production_material_issue_items` 模式写入 `production_material_supplements` + `production_material_supplement_items`；
  - Confirm：复用 `adjustInventory` / `postLedger` / `issueSourceValue` / `postWipMovement` / `createSystemVoucher` / `audit` / `assertFinancialPeriodsOpen` / `idempotencyReplay`；
  - `production_material_supplements` 表（FROZEN_RECEIPT ↔ supplement_for_id 关联可选）。
- **Return Reason**：`production_material_returns` 增加 `reason_code`（`MATERIAL_DEFECT / GOOD_RETURN / PROCESS_DEFECT / OTHER`）；与 Inventory 同 taxonomy。
- **Batch Picking**：新建 `production_batch_issues` 头 + `production_batch_issue_orders` 关联 + `production_batch_issue_items` per-order 分配；Confirm 在 transaction 内 for-loop per order；partial failure 全 rollback；保留 per-order source line / WIP / value 归属。

### 24.7 Operation Plan Lifecycle

`production_order_operations` 升级为 Operation Plan execution row；status enum additive：

```text
NOT_STARTED   — generated; not submitted
SUBMITTED     — submitted for approval
APPROVED      — approved
RELEASED      — released for execution (canonical "executable")
IN_PROGRESS   — execution started
COMPLETED     — execution completed
SKIPPED      — skipped by topology rules
```

Operation Plan lifecycle 落地：

- `NOT_STARTED` 自动生成于 `RELEASED` 后（`snapshotManufacturingExecution` 中 `ensureOperationPlanSnapshot`）；
- `SUBMITTED` 由 `submitProductionOperationPlan(orderId)` 进入；
- `APPROVED` 由 `approveProductionOperationPlan(orderId)` 进入（Audit + idempotency）；
- `RELEASED` 由 `releaseProductionOperationPlan(orderId)` 进入；进入 IN_PROGRESS 前必须 RELEASED。

不创建第二套 operation rows。

### 24.8 Forward / Backward Scheduling

新建 `manufacturing-execution.js::scheduleProductionOrder(orderId, mode)`：

- mode ∈ { `FORWARD`, `BACKWARD` }；
- FORWARD：起点 = `planned_start`；依次遍历 operations；每 op 算 `setup_seconds + run_seconds_per_unit * planned_input_quantity`；按 Work Calendar / Shift 跳过非工作时间；写入 `planned_date`；
- BACKWARD：终点 = `planned_finish`；反向遍历；同上去掉非工作时间；
- Calendar 消费：`engineering_work_calendars` + `engineering_shifts` 跳过非工作时段；
- Capacity 警告：`manufacturingCapacityReport` 补 `scheduled_minutes` vs `daily_capacity_minutes`。

不实现完整 APS；只 deterministic 排程。

### 24.9 Calendar / Capacity Consumption

- `engineering_work_calendars.work_date IN ('MON',...,'SUN')`；
- `engineering_shifts.start_time / end_time`；
- `work_centers.daily_capacity_minutes`；
- Capacity overload warning：`manufacturingCapacityReport` 返回 `overloaded = true`。

### 24.10 Control Code Snapshot

`production_order_operations` snapshot fields additive：

- `control_code_id TEXT`（来自 `product_routing_operations.control_code_id`，但由 `engineering_routing_enrichment` 提供）；
- `control_participates_scheduling INTEGER NOT NULL DEFAULT 1`；
- `control_reporting_method TEXT`（`AUTO / MANUAL / BOTH`）；
- `control_inspection_method TEXT`（`NONE / AUTO / ON_REPORT`）；
- `is_outsource INTEGER NOT NULL DEFAULT 0`；
- `quality_policy TEXT`（`NONE / AUTO / ON_REPORT`）；
- `topology TEXT NOT NULL DEFAULT 'LINEAR'`（`LINEAR / NETWORK / PARALLEL / SPLIT / MERGE / ALTERNATE`）；
- `topology_meta TEXT`（JSON）。

master edit 不得修改已 `RELEASED` 的 snapshot（field-level guard）。

### 24.11 Topology Execution

`availableInput()` 对 topology：

- `LINEAR`：上一 op good → 当前 input（已有）；
- `PARALLEL` / `SPLIT` / `MERGE` / `ALTERNATE`：`NOT_STARTED` 时禁止 Confirm 报告；UI / API 提示 `TOPOLOGY_PRECONDITION_NOT_MET`；
- `NETWORK`：fail closed；要求 explicit `network_inputs`；当前实现仅允许 `LINEAR`；其它 metadata 完整保存但不触发。

### 24.12 Operation Report / Internal Handoff / Outsourced Boundary

- Operation Report：保持现有 contract；`confirmOperationReport` 增加 `internal` control code 校验（`is_outsource=1` → 拒绝 confirm + `OUTSOURCING_HANDOFF_REQUIRED`）；
- Internal Handoff：`availableInput()` 保持前工序 good → 当前；
- Outsourced Boundary：`is_outsource=1` operation 在 `completeOperation` 拒绝；只能由 `markOperationOutsourcedHandoff(operationId, supplierId)` 进入 `OUTSOURCED` 状态（deferred 到 Procurement Domain）；
- 跨组织 Operation Transfer：OUT_OF_SCOPE — 单组织基线。

### 24.13 Manufacturing Quality Master（Wave E）

新建表（migration）：

- `inspection_items(id, code, name, category, analysis_method, standard, unit, active)`；
- `inspection_detection_values(id, item_id, label, value, active)`；
- `inspection_instruments(id, code, name, specification, active)`；
- `inspection_plans(id, code, name, target_type, target_id, product_id, active)` （target_type ∈ { `PRODUCT`, `MATERIAL` }）；
- `inspection_plan_items(id, plan_id, sequence, item_id, criterion_name, specification, min_value, max_value, unit, instrument_id)`；

新建 `server/modules/manufacturing-quality.js`：

- CRUD + lifecycle；
- 与 `quality_control_points` 通过 `target_type/target_id` 形成 when / what 关系；
- 抽样规则仍由 `quality_control_points.sampling_mode / sampling_value` 决定，不重复。

### 24.14 Operation & Product Inspection (Wave F)

新建表：

- `production_inspections(id, code, production_order_id, production_operation_id | null, source_type, source_id, plan_id, status, result, business_date, inspector_id, created_at)`；
- `production_inspection_items(id, inspection_id, plan_item_id, criterion_name, specification, result_type, min_value, max_value, unit, instrument_id, numeric_result, text_result, pass_fail_result, passed)`；

`server/modules/manufacturing-quality.js` 新 handler：

- `createProductionInspection` / `completeProductionInspection` / `cancelProductionInspection`；
- `Operation Inspection`：`production_operation_reports.confirmed_report_id` 增加列 `released_quantity`（additive）；`confirmOperationReport` 增加 policy check；
- `Product Inspection`：`production_receipts.quality_state` / `quality_inspection_id` 列；`confirmProductionReceipt` 增加 `assertProductionReceiptQualityGate`；
- `Nonconforming`：`production_receipts.nonconforming` 列 + LOT/SERIAL HOLD 隔离逻辑。

### 24.15 Production Receipt Quality Gate

`production_receipts` 增加列（migration additive）：

- `quality_state TEXT NOT NULL DEFAULT 'NOT_REQUIRED'` （`NOT_REQUIRED / PASS / FAIL / WAIVED / STALE`）；
- `quality_inspection_id TEXT`；
- `quality_plan_id TEXT`；
- `nonconforming INTEGER NOT NULL DEFAULT 0`；
- `nonconforming_reason TEXT`。

`confirmProductionReceipt` 增加 gate：REQUIRED policy → 等待 `quality_state='PASS' / 'WAIVED'`；FAIL → reject（除非 `nonconforming=1` + LOT/SERIAL HOLD）。

### 24.16 Production Scan Execution (Wave G)

新建 `server/modules/manufacturing-scan.js`：

- `POST /api/production-scan/lookup` { token, kind } → returns order / material requirement / operation identity；
- `POST /api/production-scan/issue` { orderToken, requirementLineId, warehouseId, identity, quantity } → 创建 Material Issue 草稿，最终确认继续走 canonical Material Issue handler；
- `POST /api/production-scan/report` { orderToken, operationToken, goodQuantity, scrapQuantity, laborSeconds, machineSeconds } → 创建 Operation Report 草稿，最终确认继续走 canonical Operation Report handler；
- 扫描 shortcut 只负责识别和创建草稿，数量、身份与仓库先行校验；库存、WIP、质量门禁及累计量由 canonical confirm 链路执行；
- 严格 scanner wedge keyboard input 即可；
- 不实现相机 SDK / Barcode rule designer / label printing。

`src/pages/manufacturing-quality.jsx::ProductionScan` 提供单一 Material + Operation 工作面。

### 24.17 Analytics (Wave H)

由 `manufacturing-execution.js` 承载新增分析 handler：

- `GET /api/manufacturing-analytics/execution-summary?from&to`：
  - per order: planned / started / completed / reported good / reported scrap / received / progress / planned vs actual；
- `GET /api/manufacturing-analytics/material-issue-summary?from&to`：
  - per material requirement: required / issued / supplemented / returned / net / theoretical support。

既有：

- `manufacturingWipReport` / `manufacturingYieldReport` / `manufacturingCapacityReport` / `manufacturingCostReport` 保留；
- 新增 `scheduled_minutes` vs `actual_minutes`；
- 不重写。

### 24.18 WIP / Finance Boundary

- Manufacturing 拥有：数量 / 累计执行量 / labor seconds / machine seconds / scrap / yield / 工序级 WIP；
- 不创建新的 Cost Engine；
- Finance Operations 拥有：final valuation / COGS / GL；
- 既有 `production_wip_movements` / `accounting_vouchers` / `production_cost_summaries` 不破坏；
- 保留 `production_cost_baselines` 由 `ensureCostBaseline` 计算；
- `materialSourceValue` / `receiveSourceValue` / `restoreSourceValue` / `consumeOriginalInboundValue` 不破坏。

### 24.19 Migration / Schema

Additive migration：`server/migrations/manufacturing-quality-schema.js`

- 14 张新表（inspection_items / inspection_detection_values / inspection_instruments / inspection_plans / inspection_plan_items / production_inspections / production_inspection_items / production_material_supplements / production_material_supplement_items / production_batch_issues / production_batch_issue_orders / production_batch_issue_items / production_byproducts / production_byproduct_receipts）；
- 既有表 additive columns：
  - `production_orders`：`status` enum additive；`released_by / released_at / approved_by / approved_at / submitted_by / submitted_at / material_list_status / material_list_approved_by / material_list_approved_at / material_list_released_by / material_list_released_at`；
  - `production_order_items`：`material_list_status`（仅 additive）；
  - `production_order_operations`：`plan_status / control_code_id / control_participates_scheduling / control_reporting_method / control_inspection_method / is_outsource / quality_policy / topology / topology_meta / submitted_at / approved_at / released_at`；
  - `production_material_returns`：`reason_code`；
  - `production_receipts`：`quality_state / quality_inspection_id / quality_plan_id / nonconforming / nonconforming_reason`；
  - `production_operation_reports`：`released_quantity / inspection_id`（additive）；
- 6 个普通索引（按 capability target column）。

迁移必须 `try/catch 'duplicate column'` / `try/catch 'duplicate table'`；idempotent。

### 24.20 RBAC / Permission

`server/db.js::PERMISSIONS` 新增：

```text
PRODUCTION_PLAN_VIEW                  PRODUCTION_PLAN_MANAGE
PRODUCTION_SUPPLEMENT_MANAGE         PRODUCTION_RETURN_MANAGE
PRODUCTION_BATCH_ISSUE_MANAGE         PRODUCTION_INSPECTION_VIEW
PRODUCTION_INSPECTION_MANAGE         PRODUCTION_QUALITY_CONFIG_VIEW
PRODUCTION_QUALITY_CONFIG_MANAGE     PRODUCTION_BYPART_MANAGE
PRODUCTION_SCAN_EXECUTE              PRODUCTION_ORDERS_APPROVE
PRODUCTION_ORDERS_RELEASE
```

`role-admin` 继承；其他 5 个 role seed 视需要 extend；按现有 RBAC convention。

### 24.21 Audit / Transaction / State machine

- 所有 Manufacturing mutation 在 transaction 内重读权威状态 + 累计执行量 + 期间状态；
- 失败回滚 inventory / LOT/SERIAL / value / WIP / voucher / audit / idempotency；
- 关键 mutation 写 audit_logs（已存在）；增加：
  - `PRODUCTION_ORDER_SUBMIT / APPROVE / REJECT / RELEASE / COMPLETE / CANCEL`；
  - `PRODUCTION_MATERIAL_SUPPLEMENT_CONFIRM`；
  - `PRODUCTION_MATERIAL_RETURN_CONFIRM`；
  - `PRODUCTION_BATCH_ISSUE_CONFIRM`；
  - `PRODUCTION_OPERATION_PLAN_SUBMIT / APPROVE / RELEASE`；
  - `PRODUCTION_INSPECTION_CREATE / COMPLETE / CANCEL`；
  - `PRODUCTION_SCAN_LOOKUP / ISSUE / REPORT`。

### 24.22 Tests

新增 coherent Manufacturing & Quality acceptance family：

- `server/manufacturing-quality-domain.test.js` — coherent focused family，覆盖订单状态机、补料/退料/合并领料、Operation Plan/排程、质量主数据/检验门禁、扫码、分析与 legacy `production_outputs` 收敛；
- 既有 `manufacturing-stabilization.test.js`、`m6-production-workflow.test.js`、`v13-phase6c-manufacturing-execution.test.js` 保持兼容与回归证据。

集中登记到 `scripts/testing/test-suites.js`。

### 24.23 Canonical Gates

- `pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。

### 24.24 Rollback

- additive migration：所有表 / 列 rollback 由 `try/catch 'duplicate column' / 'duplicate table'` 安全；
- state machine additive enum：DB 约束 CHECK 重建为包含旧 + 新值；旧字符串仍写；
- handler / module 新建文件，整文件删除即可 revert；
- production_outputs legacy 收敛：handler 移除；表保留；不影响历史数据。

### 24.25 Frontend Information Architecture

Launcher `manufacturing-quality` 升级：

```text
production-orders     — 制令单
material-issues       — 用料出库
production-receipts   — 生产入库
production-quality   — 生产质量（new route）
production-scan      — 生产扫码（new route）
quality-configuration — 质量配置（new route）
manufacturing-analytics — 生产执行分析
```

IQC / OQC / quality-control-points 保持当前 sub-stage（contextual）。

Mobile UX：

- Production Order Detail 成为 execution hub（Header → Source & Plan → Material → Operations → Quality → Receipt → Completion）；
- Material Requirement Card：Required / Issued / Supplemented / Returned / Net / Remaining / Stock / Tracking；
- Operation Card：sequence / operation / work center / planned window / state / input / reported good/scrap / downstream release / primary action；
- Quality Execution：Pending Inspection → inspect → enter criteria → PASS / FAIL → disposition；
- Production Scan：scanner wedge input + tabs Material / Operation。

`erp-mobile-taste` Skill 仅用于本次 UI 工作面；不改变 API / schema / permission / state machine。

### 24.26 Implementation Waves 摘要

```text
Wave A — Production Order & Material List Governance
        Draft / Submit / Approve / Reject / Release / Start / Complete / Cancel
        Material List lifecycle
        Engineering Resolver 消费
        legacy production_outputs 收敛

Wave B — Material Execution Closure
        Supplement + Return Reason + Batch Picking

Wave C — Operation Plan & Scheduling
        Operation Plan lifecycle + Forward / Backward + Calendar + Capacity

Wave D — Shop-floor Execution
        Control Code snapshot + Internal Handoff + Topology + Outsourced boundary

Wave E — Manufacturing Quality Master
        Inspection Item / Detection Value / Instrument / Plan

Wave F — Operation & Product Inspection
        Operation Inspection + Product Inspection + Receipt Quality Gate + Nonconforming

Wave G — Production Scan Execution
        Production Scan 工作面 (Material + Operation)

Wave H — Analytics & Integration
        Execution Summary + Material Issue Summary + 既有 Analytics
```

---

**MANUFACTURING & QUALITY DOMAIN CLOSURE DESIGN — READY FOR AUTHORIZED IMPLEMENTATION**

---

## 25. Planning Domain Technical Design

> Requirement：`document.md §30`。本设计按 Waves A–H 连续实施；每 Wave focused PASS 后进入下一 Wave。

### 25.1 Ownership and modules

| Module | Responsibility |
|---|---|
| `server/modules/planning.js` | Forecast、canonical MRP orchestration、immutable run snapshot；保留成熟 net-before-explosion 数学 |
| `server/modules/planning-domain.js` | 参数、物料策略、Scheme、Forecast Consumption、event/read model、Planned Order、Reservation、Workbench/Reports、Cascade |
| `server/modules/planning-documents.js` | Instruction/Requisition bridge；只接收 Planned Order/release contract，不再构造 Production Order |
| `server/modules/manufacturing-orders.js` | 提供唯一 `createProductionOrderCommand`；HTTP manual create 与 Planning conversion 共同调用 |
| `server/modules/planning-reservation.js` | centralized strong-reservation availability/consumption guard；Sales Delivery 与 Production Issue 复用 |
| `server/migrations/planning-domain-schema.js` | Planning Closure additive schema；SQLite/MySQL canonical snapshot source |

`server/app.js` 只做 route facts/dispatch；permission、transaction、audit 保持 handler runtime authority。

### 25.2 Planning parameters and material policy

- `planning_parameters` 使用 singleton key `DEFAULT`，字段 `reservation_enabled`、timestamps、updated_by。
- `planning_material_policies` 以 `product_id` 唯一，字段：`safety_stock`、`reorder_point`、`maximum_stock`、`economic_order_quantity`、`lead_time_days`、`supply_strategy`、timestamps/actor。
- 首次 migration 按 `products.min_stock/reorder_point/max_stock/lead_time_days` 初始化 policy；此后 Planning API 是唯一编辑面。legacy columns 保留为兼容 projection，并由 Planning policy mutation 同事务更新，旧 dashboard 只读查询继续得到一致值；Product API 不提供这些字段的活动写入路径。
- strategy precedence：run-specific approved override（本轮仅 scheme `force_supply_strategy`）> material policy explicit `MAKE/BUY/OUTSOURCE` > `AUTO`。`AUTO` 才允许以 effective Engineering BOM presence 推断 MAKE，否则 BUY。

### 25.3 Planning Scheme

Tables：

- `planning_schemes`：code/name/status(`DRAFT/ACTIVE/INACTIVE`)、horizon_days、default calculation scope、reservation release policy(`KEEP_ALL/RELEASE_WEAK`)、merge policy、release defaults、force strategy nullable、overdue-supply policy；
- `planning_scheme_demand_sources`：scheme/source_type unique，至少 SALES_ORDER/FORECAST/SAFETY_STOCK/BOM_COMPONENT；
- `planning_scheme_supply_sources`：ON_HAND/PURCHASE_ORDER/PRODUCTION_ORDER/PLANNED_ORDER；
- `planning_scheme_warehouses`：scheme_id/warehouse_id/participates；warehouse master 不复制。

只有 ACTIVE scheme 可用于新 run。MRP run 保存 `scheme_id` 和 immutable `scheme_snapshot`；允许显式 horizon override，实际值写回 run snapshot。

### 25.4 Forecast consumption

`forecast_consumptions` 是 run snapshot allocation：`run_id/forecast_item_id/sales_order_id/product_id/sales_need_date/quantity/created_at`，唯一 allocation id，不修改 forecast item。

Bounded rule：

1. 只取同 product、run horizon 内 ACTIVE forecast bucket；按 `need_date, forecast_item_id` 排序；
2. APPROVED SO remaining rows按 `need_date, order_id` 排序；
3. 每个 SO 依次消费尚有余额的 bucket；先 `bucket.need_date <= sales.need_date`，再按日期顺序使用 horizon 内后续 bucket；
4. allocation quantity = `min(sales remaining, forecast remaining)`；不得为负/超 bucket/超 SO；
5. 未消费 Sales 仍是 demand；未消费 Forecast 仍是 demand；最终 top demand = Sales + remaining Forecast，而不是 `MAX(total)` 隐藏关系。

该规则是 Modern ERP bounded implementation，不声称复制金蝶 time-fence 算法。

### 25.5 Time-phased events and source selection

`mrp_run_events` 保存 completed run input/output event snapshot：direction(`DEMAND/SUPPLY`)、source_type/id/line、product、event_date、warehouse、quantity、status、firm、metadata snapshot。`mrp_run_source_selections` 保存显式选择。

- `GLOBAL`：全部 eligible source rows；
- `SELECTED`：以选中 source 涉及的 products 为 operation range，再取这些 products 的 eligible demand；
- `PRECISE_SELECTED`：只取 exact source rows；BOM child demand 仅从所选 top demand 产生。

Opening on-hand 作为 horizon start 的 SUPPLY event；SO/Forecast/Safety/BOM component 是 DEMAND；open PO/production/planned order 是 SUPPLY。事件统一服务 calculation、Workbench、status/summary/detail reports。

### 25.6 Time-phased netting and safety stock

每 product 按 `event_date, demand-before-supply, source identity` 确定性排序：

```text
projected = opening on-hand
for event:
  projected += supply
  projected -= transactional demand
  shortage = max(0, safety_stock - projected)
```

Safety stock 是 floor；只在首次跌破 floor 时形成补足净需求，不在每个 bucket 重复叠加。现有 aggregate-before-netting/net-before-explosion 继续决定 BOM explosion quantity；time events提供日期与解释，不另建第二套计算器。

### 25.7 Supply source contracts

- on-hand：canonical inventory/LOT/SERIAL available quantity，按 scheme warehouse scope聚合；HOLD/expired identity不计；
- purchase：APPROVED PO remaining = ordered - CONFIRMED receipt，event date 优先 expected_delivery_date；已收货只进入 on-hand，避免双算；
- production：仅 RELEASED/IN_PROGRESS order remaining = order quantity - confirmed receipt，DRAFT/SUBMITTED/APPROVED/REJECTED/CANCELLED 不计 firm supply；
- planned：CONFIRMED 且未 release/close/cancel 的 Planned Order remaining，release 后由 instruction/downstream supply替代，禁止双算。

### 25.8 Engineering resolver and substitute planning

- Planning 不再查询 `boms.status='ACTIVE'`；调用 `resolveEffectiveBomForCaller(db, productId, purpose, businessDate)`（扩展 resolver 接受日期但不复制 eligibility SQL）。MAKE 使用 SELF_MAKE→GENERAL fallback。
- BOM tree仍用已解析 root/child effective BOM；cycle/max-depth/net-before-explosion 保持。
- `findSubstitutes` 提供 effective candidates。MANUAL 仅写 `planning_substitute_suggestions`；MIXED/BATCH/BATCH_MIXED 只在 primary shortage 且 substitute availability positive 时给出保守建议/可用抵扣，任何不明确比例不自动替换。

### 25.9 MRP immutable snapshot and log

`mrp_runs` additive：`scheme_id/scheme_snapshot/calculation_scope_mode/config_snapshot/started_at/failed_at/error_code/error_message/duration_ms`。`mrp_run_logs` 记录 phase、status、counts、warning/error，不含 secret。

执行过程先在内存收集 input；单 transaction 重读 run DRAFT、准备 weak release、写 selections/consumption/events/results/pegging/log，最后更新 COMPLETED。业务校验失败写 FAILED diagnostics 需要独立安全 transaction，不留下 result/event 半成品。completed run禁止 mutation。

### 25.10 Planned Order

Tables：

- `planned_orders`：order_no/source_type(`MRP/MANUAL`)、mrp_run/result、product、quantity、need_date/planned_supply_date、supply_type(`MAKE/BUY/OUTSOURCE`)、status(`DRAFT/CONFIRMED/RELEASED/CLOSED/CANCELLED`)、released_quantity、reservation state、version、actor/timestamps；
- `planned_order_source_links`：order/source_type/source_id/source_line/quantity，保留 split/merge lineage；
- `planned_order_byproducts`：planned order/product/quantity。

MRP materialization 对 `mrp_result_id` 幂等；manual order显式创建。mutation 使用 no-op row update取得 SQLite/MySQL portable write lock并在 transaction 内重读 version/status/released qty。

- split：parent quantity减为保留量，新 child继承 proportion source links，数量总和不变；已 release qty不能被切走；
- merge：仅同 product/type/status/policy/date compatible 且无 released downstream；新/目标 row聚合 source links，原 rows CLOSED with merge target；
- target change：DRAFT/CONFIRMED、released_quantity=0；记录 old/new/reason audit；
- batch：preview token/hash绑定当前 versions；apply重读全部 rows，任一冲突全回滚。

### 25.11 Reservation

`planning_reservations`：reservation_no/type(`STRONG/WEAK/MANUAL`)、demand source type/id/line、supply source type/id/line、product/warehouse、quantity、priority、release_date、status(`ACTIVE/RELEASED/CONSUMED/CANCELLED`)、source run/scheme、actor/timestamps/version。

- transaction 内按稳定 identity 顺序 no-op update supply rows，再计算 ACTIVE reservation sum；positive、demand remaining和supply eligible remaining全部检查；
- weak release policy在 MRP执行开始释放本 scheme/source run 的 WEAK，不影响 STRONG；到期 manual reservation显式 release；
- centralized guard `assertStrongReservationAvailability` 输入 product/warehouse/qty/current demand identity，计算物理可用量减去“属于其它 demand 的 ACTIVE STRONG”；Sales Delivery demand=`SALES_ORDER`，Production Issue demand=`PRODUCTION_ORDER`；
- guard 只限制 execution，不写 inventory balance；真正 inventory/identity/valuation仍由原 handler。

### 25.12 Workbench and reports

`buildPlanningBalanceReadModel(db,{from,to,bucket,schemeId,productId})` 是唯一动态 read model：从当前 SO/Forecast/PO/Production/Inventory/Planned Order/Reservation authority生成 events并投影 projected/shortage/excess/safety/max/exception。

Endpoints复用该 service：

- `/api/planning/workbench`；
- `/api/planning/reports/supply-demand/{status,summary,detail}`；
- `/api/planning/reports/order-supply-demand`；
- `/api/planning/reports/forecast-consumption`；
- `/api/planning/reports/reservations` 与 `/trace`；
- `/api/planning/reports/substitute-suggestions`；
- `/api/planning/reports/mrp-log`。

### 25.13 Cascade adjustment

`planning_cascade_changes` 保存 source、requested qty/date、preview snapshot/hash、status。Preview追踪 demand→Planned Order→Instruction→downstream；blocker包括 released planned order、非 DRAFT instruction、Production RELEASED/IN_PROGRESS/COMPLETED、received purchase、任何 inventory/accounting evidence。Apply验证hash与版本，只修改 Planning DRAFT/CONFIRMED objects，transaction + audit；不做 Generic Change Engine。

### 25.14 Release integration

- Planned Order CONFIRMED 才能 release；row lock后以 `quantity-released_quantity` 限制转换。
- MAKE/BUY生成或追加 Instruction item并写 `planned_order_id` source；Instruction仍是 execution bridge。
- `createProductionOrderCommand(db,{actor,input})` 成为 Manufacturing唯一 constructor：验证 active product、Engineering resolver/explicit BOM、创建 DRAFT order、snapshot BOM/material/routing/control facts、保存 instruction source。HTTP create与Planning conversion共同调用；Planning不得 HTTP self-call。
- OUTSOURCE release创建 `planning_outsource_handoffs`（PENDING）供后续 Domain消费；不创建虚假 Outsourcing Order。

### 25.15 Legacy convergence

对 `/api/mrp/calculate`、`/api/mrp/bom-explode`、`/api/mrp-plans*` 做 repo caller proof。活动 frontend改到 canonical Planning route；旧 endpoints 若仍需测试/兼容则调用 canonical read/calculation service并标记 compatibility response，不再保留独立 BOM/MRP math。historical `mrp_plans*` tables保留且不 DROP。

### 25.16 RBAC / audit / errors

新增：`PLANNING_CONFIG_MANAGE`、`PLANNED_ORDER_RELEASE`、`PLANNING_RESERVATION_MANAGE`；保留 `MRP_VIEW/MRP_MANAGE`。admin继承；现有角色不自动扩大，只有既有 planner/admin路径按当前 seed明确赋予。

关键 audit：parameter/policy/scheme、MRP execute/fail、planned order create/confirm/split/merge/target/release/close/cancel、reservation create/release/consume、cascade apply。业务冲突返回 409，validation 400，permission 403，missing 404；不得吞 lock/deadlock。

### 25.17 Migration / MySQL / rollback

Migration additive、`CREATE TABLE/INDEX IF NOT EXISTS`、缺列才 add；SQLite base snapshot与MySQL reconciliation自动纳入。核心 entity不用 generic JSON；snapshot/log可用JSON text。无 destructive rollback：回退代码后新表保留，旧 route/schema/历史仍可读；不 down-migrate/drop。

MySQL concurrency gate增加：同一 Planned Order并发 release至多一次；同 supply并发 strong reservation总量不超 eligible；split/merge版本冲突一方失败且无半应用。

### 25.18 Frontend information architecture

Planning Launcher保持紧凑：Forecast、MRP、Planned Orders、Planner Workbench、Production Instruction、Purchase Instruction。Configuration/Reservation/Reports作为 Workbench/MRP contextual surface，不新增大量一级入口。

ERP Design Read: Planning daily work; primary task: diagnose shortage and safely release supply; density: 8; main layout issues: historical-run-only views, no traceable allocation or contextual actions; preserve: terminology, API/state/RBAC/source/inventory/accounting contracts.

- 390px：time bucket→exception summary→dense material rows/cards→trace sheet→single contextual primary action；
- Planned Order card：product/type/qty/need/planned/source/reservation/release/exception；
- Reservation明确显示 Demand ← quantity → Supply、Strong/Weak、priority/release/status；
- desktop增强密度但不另建业务 screen；320/390/430/680用现有 Edge/playwright-core验收。

### 25.19 Implementation Waves and gates

1. Wave A：schema、parameters、material policy、scheme/warehouse；
2. Wave B：forecast consumption、events/read model；
3. Wave C：scheme-driven MRP modes、time phase、Engineering resolver、V18 production supply、substitute/log；
4. Wave D：Planned Order lifecycle/split/merge/batch/target/byproduct/release；
5. Wave E：Strong/Weak/Manual Reservation + Sales Delivery/Production Issue guard；
6. Wave F：Workbench/reports/frontend；
7. Wave G：Cascade preview/apply；
8. Wave H：Manufacturing command、Purchase/Outsource handoff、legacy convergence。

每 Wave focused tests；最终运行 FAST/FULL/HEAVY/MySQL/MySQL concurrency/build/diff/browser responsive。MySQL环境缺失时最终状态必须为 `NOT READY — MYSQL VERIFICATION PENDING`。

---

**PLANNING DOMAIN CLOSURE DESIGN — APPROVED BY CONTINUOUS USER AUTHORIZATION FOR IMPLEMENTATION**

---

## 26. Procurement & Outsourcing Domain Technical Design

> 本节固化 Procurement & Outsourcing Domain Closure 的 Design 阶段成果。Requirement 见 `document.md §31`；Audit 见本次会话的 `PROCUREMENT & OUTSOURCING DOMAIN FINAL AUDIT REPORT` + Correction Pass。Manual Evidence Baseline 来自上游已批准的 B3101 / B3121 + B3104 / B3105 / B3106 / B3108 / B3109 / B3119 / B3120。
>
> 本节不进入 Implementation / Migration / API / UI / Test；仅按 §26.1–§26.29 形成可实施技术方案，等待用户 `DESIGN PASS`。

### 26.1 Architecture / Ownership

`server/app.js` 仍承担 HTTP route + auth + thin dispatch。Procurement & Outsourcing Domain 的业务逻辑按 cohesion / caller chain / transaction ownership / source-target identity / testability 拆分到以下模块：

| Module | Responsibility | Wave |
|---|---|---|
| `server/modules/procurement-parameters.js`（NEW） | Procurement Parameters owner：`source_control_enabled`、`quota_enabled`、`default_receipt_billing_mode`、`po_change_enabled`、`receiving_tolerance_policy`、`return_policy`、`requisition_policy`、`numbering`；singleton row，参数变化不反写历史已批准/已执行单据 | A |
| `server/modules/procurement-profiles.js`（NEW） | Supplier Procurement Profile additive columns + 独立 profile/version entity；Buyer / Purchasing Group / Membership / Document snapshot | A |
| `server/modules/procurement-sourcing.js`（NEW） | Source List / Quota (PROPORTIONAL) / Sourcing Decision canonical owner；`resolveEligibleSources` + deterministic allocator + manual override audit | B |
| `server/modules/procurement-pricing.js`（NEW） | Purchase Price List / Pricing UOM 取价 / Procurement Pricing Discount / Price Adjustment (effectivity-dated, no retroactive)；与 Finance `purchase_discounts` 严格隔离 | B |
| `server/modules/procurement-orders.js`（NEW） | PO core lifecycle + Commercial Snapshot + Delivery Schedule + Prepayment Requirement + PO Change (ADD/MODIFY/CANCEL) + canonical PO execution view (`OPEN / PARTIALLY_RECEIVED / FULFILLED-CLOSED / CANCELLED`) | C |
| `server/modules/procurement-receiving.js`（NEW） | Receipt Notice + Purchase Receipt confirm + IQC source-type adapter + Delivery Schedule/Tolerance enforcement；不变更既有 inventory / LOT-SERIAL / valuation / idempotency / period 合同 | D |
| `server/modules/procurement-returns.js`（NEW） | Return Request + Purchase Return four-branch financial refactor：LEGACY_DIRECT → AP credit；SEPARATE unbilled → reverse GRNI；SEPARATE billed → AP credit；partially billed → deterministic split | D |
| `server/modules/procurement-vmi.js`（NEW） | VMI business documents only：VMI Policy / VMI Receipt business fact / Consumption business fact / Consumption Summary / Ownership Transfer business fact / Supplier Bill handoff；**不得**建立第二 inventory ledger；通过 owner-dimension interface 调用 Inventory | E |
| `server/modules/outsourcing.js`（NEW） | Outsourcing Order canonical owner；Source / Header / Lines / Lifecycle（PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED + DRAFT / CANCELLED bounded technical states）；consumes Engineering resolver | F |
| `server/modules/outsourcing-materials.js`（NEW） | Outsourcing Material List snapshot + Issue / Supplement / Return / Backflush + Supplier WIP warehouse binding + LOT/SERIAL provenance；复用 canonical Inventory Transfer primitives | G |
| `server/modules/outsourcing-receiving.js`（NEW） | Completion Receipt Notice + Inspection source adapter + Outsourcing Receipt + Processing Fee AP extension (via canonical Supplier Bill) + Cost Evidence + Finished Return + WIP / Opening / Period reports | H |

保留既有（**不得重写**，仅 EXTEND / INTEGRATE）：

- `server/modules/suppliers.js`：Supplier generic master KEEP；`suppliers` 表新增 additive procurement / outsourcing profile 列；
- `server/modules/purchase-order-status-fix.test.js`、`uat-r4-purchase-source-chain.test.js` 等既有测试 KEEP；
- `server/modules/commercial-golive.js`：`PURCHASE_RECEIPT` → `ensurePayableSource` (LEGACY_DIRECT) / `GRNI CREDIT` (SEPARATE/AUTO_BILL) / `autoBillReceipt` AUTO_BILL 三链；
- `server/modules/settlement-core.js`：`ensureSubledger(AR/AP)`、AP open item；
- `server/modules/financial-inventory.js`：`receiveValue` / `issueValue` / `allocateProportionalCents` / `createSystemVoucher` / `inventoryAccountRole`；
- `server/modules/quality-gates.js` / `authoritative-quality.js` / `manufacturing-quality.js` / `traceability-quality.js`：IQC source-type EXTEND；
- `server/modules/planning-domain.js`：`planning_outsource_handoffs(PENDING)` 仅 upstream record，本 Domain 是 exactly-once consumer；
- `server/modules/engineering-bom.js` / `engineering-configurable-bom.js`：OUTSOURCE BOM resolver；
- `server/modules/planning.js`：MRP 引擎 / canonical `releasePlannedOrder` OUTSOURCE handoff creation；
- `server/lib/stock.js`：canonical inventory mutation；
- `server/lib/payment-terms.js`：payment terms 解析。

### 26.2 Procurement Parameters (PRC-01)

- Singleton table `procurement_parameters` 使用 `id='DEFAULT'`：
  ```text
  source_control_enabled         INTEGER NOT NULL DEFAULT 1
  quota_control_enabled          INTEGER NOT NULL DEFAULT 0
  default_receipt_billing_mode   TEXT    NOT NULL DEFAULT 'SEPARATE'
  po_change_enabled              INTEGER NOT NULL DEFAULT 1
  receiving_tolerance_policy     TEXT    NOT NULL DEFAULT 'STRICT'  -- STRICT | SOFT_BAND
  return_policy                  TEXT    NOT NULL DEFAULT 'STANDARD'
  requisition_policy             TEXT    NOT NULL DEFAULT 'OPEN'
  prepayment_required_default    INTEGER NOT NULL DEFAULT 0
  numbering                      TEXT    NOT NULL DEFAULT 'PERIOD_SEQ'
  updated_by, updated_at
  ```
- 第一次生效：现有业务 `default_receipt_billing_mode` 写入 `'SEPARATE'`；所有 LEGACY_DIRECT 历史记录保持原值不变（**仅新业务默认改**）。
- Parameter mutation 写 `audit(db, ..., 'UPDATE', 'PROCUREMENT_PARAMETER', 'DEFAULT', ...)`；mutation 不反写历史已批准/已执行单据；读路径永远从 `procurement_parameters` 当前行。
- Validation：所有 enum 字段白名单；`default_receipt_billing_mode` ∈ {`SEPARATE`, `LEGACY_DIRECT`, `AUTO_BILL`}；`STRICT` 不允许超收，`SOFT_BAND` 在 tolerance window 内允许。
- `procurement-parameters.js::getActiveParameters(db)` 是唯一读取入口；缓存（无副作用 short-lived in-memory cache by id='DEFAULT'）仅在同一 process 生命周期内。
- API：
  - `GET /api/procurement/parameters` 返回当前 active 参数；
  - `PATCH /api/procurement/parameters` 修改（admin / `PROCUREMENT_CONFIG_MANAGE`）；每次必须 snapshot before/after。
- Failure behavior：参数缺失视为 fail closed（`'SEPARATE'` 是 default；其它关键 enum 在缺失时抛 500 表示需要 bootstrap）。

### 26.3 Supplier Procurement Profile (PRC-02)

- 直接放 `suppliers` 表的 additive 列（避免 entity 爆炸）：
  ```text
  procurement_enabled            INTEGER NOT NULL DEFAULT 1
  outsourcing_enabled            INTEGER NOT NULL DEFAULT 0
  supplier_category              TEXT    NOT NULL DEFAULT 'GENERAL'  -- GENERAL | STRATEGIC | TRANSACTIONAL | OUTSOURCE
  qualification_status            TEXT    NOT NULL DEFAULT 'UNQUALIFIED' -- QUALIFIED | UNQUALIFIED | SUSPENDED | BLACKLIST
  qualification_valid_from        TEXT
  qualification_valid_to          TEXT
  default_payment_terms_days     INTEGER
  default_currency               TEXT    NOT NULL DEFAULT 'CNY'
  supplier_wip_warehouse_id      TEXT    REFERENCES warehouses(id)
  outsourcing_qualification_note TEXT
  ```
- 新增 `supplier_procurement_overrides` 历史版本表（versioned `effective_from` / `effective_to`），用于 audit 时回看；不复制整个 Supplier 实体。
- Qualification 校验：`qualification_status='QUALIFIED'` 且 `qualification_valid_from <= business_date <= qualification_valid_to` 才能用于 sourcing / PO / outsourcing；其它状态在 `procurement-sourcing.js::resolveEligibleSources` 显式 fail。
- Buyer / Purchasing Group：新增 `buyers` / `purchasing_groups` / `buyer_memberships`（buyer_id, purchasing_group_id, role）；PO 文档 additive snapshot `buyer_id` / `purchasing_group_id`，业务校验 server-side。
- Null-group compatibility：现有 PO 不带 group 也必须可读；legacy null-group PO 永远 `purchasing_group_id=NULL`；admin 行为不受 group scope 影响。
- API：`GET /api/suppliers/:id/profile`、`PATCH /api/suppliers/:id/profile`；`/api/buyers*`、`/api/purchasing-groups*`；`/api/suppliers/:id/wip-warehouse`。
- Failure：profile 无效字段（如 qualification 过期）→ 409，PO 创建阻断；不静默回退。

### 26.4 Sourcing — Source List / Quota / Sourcing Decision (PRC-04 / PRC-05 / PRC-06)

#### Tables

- `source_list_entries(id, supplier_id, product_id, source_type('PURCHASE'|'OUTSOURCE'), enabled, effective_from, effective_to, created_by, created_at, version)`；
- `source_list_versions(id, entry_id, version, snapshot_json, effective_from, effective_to, created_by, created_at)`（history；snapshot 不可写回修改）；
- `quota_assignments(id, supplier_id, product_id, source_type, proportion_num, proportion_den, effective_from, effective_to, version)` — `PROPORTIONAL` 表示分子/分母有理数；
- `sourcing_decisions(id, source_type('PR'|'PO'), source_id, status('DRAFT'|'APPLIED'|'OVERRIDDEN'), created_by, created_at, applied_at, hash)`；
- `sourcing_decision_allocations(id, decision_id, source_list_entry_id, supplier_id, product_id, source_quantity_num, source_quantity_den, allocated_quantity_num, allocated_quantity_den, rule_reason)`。

#### Resolver

`procurement-sourcing.js::resolveEligibleSources(db, { productId, sourceType, businessDate })`:

1. Filter `source_list_entries` by `product_id = ? AND source_type = ? AND enabled=1`；
3. 过滤 supplier：`suppliers.procurement_enabled=1` 且 `qualification_status='QUALIFIED'` 且 `qualification_valid_from <= businessDate <= qualification_valid_to`；
4. 过滤 effectivity：`effective_from <= businessDate AND (effective_to IS NULL OR effective_to >= businessDate)`；
5. 返回 list：稳定顺序 `source_list_entry_id ASC`（deterministic）。

#### Quota allocator（PROPORTIONAL only）

`procurement-sourcing.js::allocateByProportionalQuota(db, { eligibleEntries, productId, sourceType, totalDemand })`:

- 每个 eligible supplier 取 `quota_assignments` 当前有效行 `(proportion_num, proportion_den)`，归一化（`gcd` 化简后 `sum(num)/den = 1`）；
- 顺序按 `quota_assignments.id ASC`；quantity 分配 `floor((totalDemand * proportion_num) / proportion_den)`；
- residual `r = totalDemand - sum(allocated)`：按稳定 supplier 顺序 +1 直至 r=0；`r` 必然 `< eligible count`，分配 deterministic；
- 用 `rational()`（已存在于 `commercial-golive.js`）做有理数计算避免浮点授权；写库前 `roundRational`；
- 任何 conflict / overshoot → throw 409；
- Source-line trace：`sourcing_decision_allocations` 记录 `source_quantity` 与 `allocated_quantity`；PR line total 与 sum(allocated) 必须守恒。

#### Sourcing Decision Lifecycle

- `DRAFT`：resolver + allocator 输出 decision + allocations；
- `APPLIED`：单事务应用 — 同时锁定 PR line remaining + 创建 N PO draft 创建；任何一步失败 → release `_no-op update` 释放 row lock，state 不前进；
- `OVERRIDDEN`：手动 override source control 时创建 OVERRIDDEN decision 记录 `permission` (`PROCUREMENT_CONFIG_MANAGE` 或等价 purchasing_group admin)、`reason`、audit；override 不影响后续 source control 启用时其它 PR；
- `applied decision` 不可变；新 PR 必须创建新 decision row；不允许复用同一 decision 覆盖两个 PR。

#### Override Audit

- Permission: `SOURCING_OVERRIDE` (admin / purchasing_group admin)；
- API: `POST /api/procurement/sourcing/override` 必须 `permission + reason + audit`；
- Source control disabled 时 resolver 直接返回所有 supplier，但必须 `permission` + `reason` 才能写入 decision。

### 26.5 Pricing — Price List / Pricing UOM / Pricing Discount / Price Adjustment (PRC-07 / PRC-08 / PRC-09 / PRC-10)

#### Tables

- `purchase_price_list_entries(id, supplier_id, product_id, source_type('PURCHASE'|'OUTSOURCE'), pricing_uom_code, unit_price_cents, status('ACTIVE'|'INACTIVE'), effective_from, effective_to, version)`；
- `purchase_price_list_versions` 入表 `entry_id, snapshot_json, version`（history；user 不写回）；
- `pricing_discount_schemes(id, supplier_id, product_id, source_type, basis('PERCENT'|'FLAT'), value_numerator, denominator, status('ACTIVE'|'INACTIVE'), effective_from, effective_to, version)` — **Procurement Pricing Discount**；
- `purchase_discounts`（既有 Finance table）**严格不修改**；新增表 `pricing_discount_schemes` 是 Procurement 独立能力。

#### Pricing UOM 取价流程（PRC-08）

`procurement-pricing.js::resolvePrice(db, { supplierId, productId, sourceType, pricingUomCode, businessDate })`:

1. 取最近一条 `purchase_price_list_entries`（`status='ACTIVE'` + effectivity by business_date）；
2. 如果 `pricingUomCode` ≠ `base_uom_code`，则调用 `commercial-golive.js::quantitySnapshot` 取得 `pricing_uom -> base_uom` 有理换算（已有 `product_uom_conversions`，无需新建 UOM engine）；
3. unit_price 写为 pricing_uom 单价（PO line 写时再按 `document_uom -> base_uom` 与 `pricing_uom -> base_uom` 计算 money 维度）；
4. 如果不存在有效 price list entry → 抛 409，PO 创建阻断；不静默回退。

#### Pricing Discount

- 仅影响 PO unit price resolution（输入到 `unit_price_cents`）+ PO snapshot 记录 `price_source` / `discount_source`；
- **不得**直接创建 AP 调整；**不得**写 `purchase_discounts` / `account_payables` / `financial_credit_adjustments`；
- ALGORITHM 边界：本 Domain 只实现 PERCENT / FLAT 两类；其它复杂 Kingdee 算法 = `SOURCE_DETAIL_INSUFFICIENT`，留 design extension point（schema 字段预留 `formula_json` 但当前不在 mutation 路径）。

#### Price Adjustment (PRC-10)

- Effectivity-dated：写新 entry / version，旧 entry 失效（`effective_to = today`）但不修改历史 PO / Receipt / Bill / AP；
- 强制 invariant：旧 PO `unit_price_cents` 历史 snapshot 不可修改；Supplier Bill 自动 refund 生成 source 路径走既有 `applyCreditAdjustment`，**不**重新计价；
- Disallow：用户 API 不暴露 `unit_price_cents` retroactive patch；如发现 PRICE 已调整必须新建 PO Change (`MODIFY price`)；不直接 UPDATE 既有表。

#### API

- `GET /api/procurement/price-list`、`POST/PATCH`；
- `GET /api/procurement/pricing-discounts`、`POST/PATCH`（disabled = `SOURCE_DETAIL_INSUFFICIENT` 期间返回 501）；
- `POST /api/procurement/pricing/resolve` 返回 PO line `unit_price_cents` 解析结果 + snapshot fields。

### 26.6 PR / PO Governance (PRC-11 / PRC-12 / PRC-13 / PRC-14)

#### PR Source Trace (PRC-11)

- 既有 `purchase_requisitions` + `purchase_requisition_items` 保留；
- Additive 列 `source_type` ∈ {`MANUAL`, `PLANNING_PURCHASE_INSTRUCTION`, `SALES_ORDER`, `OTHER`}（source=other 不预填）；`source_id`、`source_line_id`；
- 既有 `planning-documents.js` `purchase_instructions` → `purchase_requisition` 路径保留并 EXTEND：在 PI item 写时同时 `pr_line_id` = PR line id；
- Conversion 写 `pr_conversion_log(id, pr_line_id, source_line_id, converted_quantity_num, converted_quantity_den, reversed_quantity, status)`；log 不可写回修改。

#### PR Split / Merge / Supplier Allocation (PRC-12)

- 新增 `pr_split_allocations(id, pr_line_id, source_list_entry_id, supplier_id, product_id, allocated_quantity_num, allocated_quantity_den, version)`；
- Split / Merge 通过 `sourcing_decision` + `sourcing_decision_allocations`；preview → apply 两阶段；
- Apply atomic：单事务 lock 全部 PR line + 全部 source line；任何冲突 → release + write no-AP；
- Apply 后 PR line remaining 与 sum(allocations) 守恒；
- Audit：PR split / merge / allocate / cancel 全部写 audit。

#### Purchase Order (PRC-13)

- 既有 `purchase_orders` / `purchase_order_items` 表 KEEP；不重写 existing approval flow；
- Additive 列：
  ```text
  is_gift_line INTEGER NOT NULL DEFAULT 0
  pricing_discount_scheme_id TEXT  REFERENCES pricing_discount_schemes(id)
  price_source TEXT
  discount_source TEXT
  ```
- `commercial_snapshot` 字段以 JSON text 持久化：`{supplySupplierId, settlementSupplierId, payeeSupplierId, buyerId, purchasingGroupId, supplierContact, supplierPhone, supplierAddress, paymentTermsDays, sourcePriceListVersion, sourceDiscountSchemeVersion, scheduleFingerprint}`；
- PO lifecycle：`DRAFT → SUBMITTED → APPROVED / REJECTED → CLOSED_STYLE`。Execution lifecycle 由 PRC-19 持有。

#### PO Commercial Snapshot (PRC-14)

- 既有 supplier/contact/address/payment_terms 字段 KEEP；
- Additive column `buyer_id`、`purchasing_group_id`、`settlement_supplier_id`、`payee_supplier_id`、`delivery_schedule_fingerprint`；
- 默认关系：
  - `settlement_supplier_id = supply_supplier_id`；
  - `payee_supplier_id = settlement_supplier_id`；
- 不创建第二 payment engine；
- Snapshot 在 PO APPROVED 时冻结；
- API：PO list/detail 暴露 `supplySupplier` / `settlementSupplier` / `payeeSupplier` / `buyer` / `purchaseGroup`；`/api/procurement/po/:id/commercial-snapshot`。

### 26.7 Gift / Free Item (PRC-15)

- PO line `is_gift_line` boolean；`unit_price_cents=0` 当且仅当 `is_gift_line=1`；
- Submit gate：`app.js:2398` `unit_price_cents <= 0` → 替换为：
  - 非 gift：`unit_price_cents > 0`；
  - gift：`is_gift_line=1 AND unit_price_cents=0 AND amount_cents=0`；
- 普通 line 不得借 `is_gift_line` 绕过；商业校验仍要求 positive amount；
- PO detail UI 显示 `🎁 Gift` 标记；不得隐藏 line value。

### 26.8 Delivery Schedule / Quantity Control (PRC-16)

- 新表 `po_delivery_schedule(id, po_line_id, sequence_no, planned_quantity_num, planned_quantity_den, planned_date_from, planned_date_to, upper_tolerance_pct, lower_tolerance_pct, version)`；
- PO line 仍存在 `quantity / received`；新增 column `lower_tolerance_auto_close` 仅 DRAFT 期允许配置；
- Receipt source 优先 PO line + optional `po_delivery_schedule_id`；
- `assertRemainingQuantity` 在 receipt confirm 时同时锁 source line + schedule line（schedule_id 可空）；
- Default policy：`receiving_tolerance_policy='STRICT'`（不超收）；admin 可切 `'SOFT_BAND'` 允许 tolerance window 内超收；
- Lower-tolerance auto-close **不在本 Domain 自动实现**（Requirement 标 `SOURCE_DETAIL_INSUFFICIENT`）；Design 提供 `lower_tolerance_auto_close` 字段供后续 bounded algorithm；当前 PO line 剩余 = `quantity - received`，未达 lower tolerance 不自动 close，留作 operator manual close。

### 26.9 Prepayment Requirement (PRC-17)

- 新表 `prepayment_requirements(id, po_id, sequence_no, prepayment_pct_basis_numerator, prepayment_pct_basis_denominator, due_date, expected_payment_cents, status('DRAFT'|'POSTED'|'CANCELLED'), finance_handoff_id, created_by, created_at)`；
- Procurement owner：CRUD 文档、生成 `finance_handoff_id` (UUID reference)；
- Finance owner：实际 Payment / Allocation 通过 canonical `payment_disbursements` + `payment_disbursement_items`，`source_type='PREPAYMENT_REQUIREMENT'`；
- Finance Handoff：POST prepayment 时由 Procurement 调 `payment-disbursement` API 路径生成 payment；finance 通过 canonical `applyCreditAdjustment` 与 AP 对冲；
- **不得**建立第二 payment engine；
- API：`POST /api/procurement/prepayment-requirements`、`POST /api/procurement/prepayment-requirements/:id/post`。

### 26.10 PO Change (PRC-18)

- 新表 `po_changes(id, po_id, change_no, change_type('ADD'|'MODIFY'|'CANCEL'), status('DRAFT'|'APPROVED'|'APPLIED'|'REJECTED'|'CANCELLED'), requested_by, requested_at, approved_by, approved_at, applied_by, applied_at, snapshot_before_json, snapshot_after_json, approval_audit_json)`；
- 新表 `po_change_items(id, po_change_id, po_line_id, line_no, change_type('ADD'|'MODIFY'|'CANCEL'), requested_qty_delta_num, requested_qty_delta_den, requested_price_cents_delta, requested_date_delta, schedule_change_json)`；
- Lifecycle 与 Platform Approval `PURCHASE_ORDER` 共用 `approvals.js`，复用 `approval_events`；
- Apply 必须单事务：lock PO line + `po_change_items` + `po_delivery_schedule`（如有）+ `assertRemainingQuantity`；`new_qty < already_received + already_notified + already_changed_applied_qty` → 409；
- Applied result 写入 `po_changes.snapshot_after_json` 并冻结（immutable）；
- 历史 PO line `quantity / unit_price` snapshot 不可写回修改；
- 历史 Receipt / Bill / AP 不得引用本 PO Change 进行 retroactive 调价；调价走 Finance `purchase_discounts`（已存在的 AP allowance）或 canonical credit adjustment。

### 26.11 Canonical PO Execution (PRC-19)

- 新 view/service `procurement-orders.js::getPoExecutionView(db, poId)`：
  ```text
  ordered            = po_line.quantity
  notified           = sum(notified_quantity WHERE po_delivery_schedule_id IS NULL OR delivery_id IS NOT NULL?)
  received           = sum(received_quantity FROM confirmed purchase_receipt_items)
  returned           = sum(returned_quantity FROM confirmed purchase_return_items)
  open_remaining     = ordered - received - returned  (always >= 0)
  fulfilled          = (open_remaining == 0)
  status             = 'OPEN' | 'PARTIALLY_RECEIVED' | 'FULFILLED' | 'CANCELLED'
  ```
- **唯一 consumer**：MRP (`planning.js` open supply) / Planner Workbench (`planning-domain.js` buildPlanningBalanceReadModel) / Reservation (`planning-reservation.js` 强预留 available) / Receiving (`procurement-receiving.js` remaining check)。
- MRP 迁移：`migrateMrpToPo` 启动 hook — 把 `MRP remaining` 计算改为 `getPoExecutionView.open_remaining`；删除原有 `purchase_orders.remaining_quantity` 计算；
- Reservation 迁移：`assertStrongReservationAvailability` 输入从 `purchase_orders.approved_quantity` 改为 `getPoExecutionView.open_remaining`；
- Workbench 迁移：`buildPlanningBalanceReadModel` `purchaseSupply` event 用 `getPoExecutionView.open_remaining`，并 freeze event_date = `po.expected_delivery_date`；
- 验证：`pnpm test` + `pnpm test:heavy` + 在受保护 disposable MySQL 环境 `pnpm test:mysql` + `pnpm test:mysql:concurrency`（focused test：并发 release planned vs unconfirmed 时 MRP 与 Reservation 不双算）。

### 26.12 Receipt Notice / Receiving (PRC-20 / PRC-22)

#### Tables

- `receipt_notices(id, notice_no, supplier_id, warehouse_id, business_date, status('DRAFT'|'CONFIRMED'|'CANCELLED'), business_type('STANDARD_PURCHASE'|'OUTSOURCE_PROCESSING') NOT NULL DEFAULT 'STANDARD_PURCHASE', created_by, created_at)`；
- `receipt_notice_items(id, receipt_notice_id, po_line_id, schedule_id NULL, product_id, planned_quantity_num, planned_quantity_den, source_trace_json)` — 允许 N PO lines → 1 notice；
- 既有 Purchase Receipt 不变 schema；新 `outsourcing_completion_notices` 走独立表（参见 §26.20），避免与 Purchase Receipt 共用同一 `receipt_notices`。

#### Receipt Notice Invariants

- **NO Inventory / Valuation / GRNI / AP / Voucher / WIP / future Planning supply** effect；
- 仅写 `receipt_notices` / `receipt_notice_items`；
- Receipt Notice 可被 Purchase Receipt 引用作为 source（`purchase_receipts.source_notice_id` additive）；
- Receipt Notice 不形成第二 Planning supply（不写 `mrp_run_events`）；
- Compatible 多 PO 合并条件：同 supplier + 同 warehouse + 同 `business_type`；schedule/tolerance 由 Receipt 阶段 enforcement。

#### Purchase Receipt (PRC-22) — EXTEND only

- 既有 `purchase_receipts` / `purchase_receipt_items` 表 KEEP；不重写 confirm / lifecycle / IQC / idempotency / period；
- Additive 列：
  ```text
  source_notice_id TEXT REFERENCES receipt_notices(id)
  delivery_schedule_id TEXT REFERENCES po_delivery_schedule(id)
  po_change_id TEXT REFERENCES po_changes(id)
  ```
- **Standard Purchase Receipt 强制 `business_type='STANDARD_PURCHASE'`**：
  - 在 `createPurchaseReceipt` / `confirmPurchaseReceipt` 入口立即断言 `purchase_orders.business_type = 'STANDARD_PURCHASE'`；
  - 否则 `HttpError(409, 'PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE')` — **禁止**用 ordinary Purchase Receipt 接收 `OUTSOURCE_PROCESSING` PO；走 Outsourcing Receipt 路径（§26.20）；
  - 反向断言：Outsourcing Receipt 必须 `business_type='OUTSOURCE_PROCESSING'`，且 `purchase_orders.source_outsourcing_order_id = outsourcing_order.id`（§26.20）。
- Confirm 时：
  - 先 lock `po_changes` 与 `purchase_orders` 与 `po_delivery_schedule`（如有 schedule）；
  - `assertRemainingQuantity` 复用既有 helper，扩展支持 `schedule_id`；
  - `commercial_snapshot` 校验（discount / price / source 不变）；
  - 既有 inventory / LOT-SERIAL / valuation / IQC 调用不变；不重写 inventory mutation；
  - 新业务 `default_receipt_billing_mode` 来自 `procurement_parameters`；LEGACY_DIRECT 数据保持兼容；
  - `po_line.gift = 1` 时 entry 仍按 `unit_price_cents=0` 写入 valuation（carry value = 0）；不影响 inventory qty+。

### 26.13 IQC Integration (PRC-21)

- 既有 `quality-gates.js` / `authoritative-quality.js` KEEP；
- 新增 source-type `OUTSOURCING_RECEIPT`（canonical name 由 Design 决策保留：`OUTSOURCING_RECEIPT`）；
- 不新建 Quality engine；只在 `purchase_receipt_items` 启用 IQC 引用路径；
- Quality policy snapshot 仍走既有 `freezeQualityPolicy`。

### 26.14 Return Financial Refactor — Four-Branch (PRC-24 / PRC-25)

#### Tables

- `return_requests(id, return_request_no, source_type('PO'|'RECEIPT_NOTICE'|'PURCHASE_RECEIPT'|'MANUAL'), source_id, request_type('QUALITY'|'COMMERCIAL'|'STOCK'|'OTHER'), reason_code, reason_text, replenishment_method, status('DRAFT'|'POSTED'|'CANCELLED'), business_date, created_by, created_at)`；
- `return_request_items(id, return_request_id, source_line_id, product_id, quantity_num, quantity_den, line_no)`；
- 既有 `purchase_returns` / `purchase_return_items` KEEP；`purchase_returns.return_request_id` additive 引用；
- 既有 Purchase Return physical/value execution handler 不重写。

#### Return Financial Refactor — Four-Branch Logic

`procurement-returns.js::applyPurchaseReturn(db, { returnId, actor })`:

1. Load `purchase_returns` header + items + source receipts；
2. Load receipt billing mode + 既有 billed reserved quantity = `sum(supplier_bill_items.quantity WHERE receipt_id=receipt_id AND bill.status IN ('DRAFT','WAITING_MATCH','POSTED'))`（与 §26.20 同一 billable reservation 集合；CANCELLED / REVERSED 不计入）；
3. 对每行 return qty 按 deterministic split policy：

   ```text
   unbilled_qty = max(0, receipt_received_qty - billed_qty - already_returned_qty)
   billed_qty   = max(0, return_qty - unbilled_qty)
   ```

   （**billed-first split** — 满足 Spec §34 deterministic fixed order；选择后必须 document + test + audit）

4. **LEGACY_DIRECT branch**（receipt `billing_mode='LEGACY_DIRECT'`）：
   - Inventory reversal (carry value) + AP credit via canonical `applyCreditAdjustment(db, side='AP', target_open_item_id=purchase_receipts.id, source_type='PURCHASE_RETURN', source_id=return_id, amount=-return_amount, ...)`；
5. **SEPARATE unbilled branch**（receipt `billing_mode='SEPARATE'` 且 `billed_qty=0`）：
   - Inventory reversal + system voucher `Dr GRNI / Cr Inventory (carry value + offset)`；**NO AP credit**；Supplier Bill 尚未存在，invariant `billed_qty<0` 抛 409；
6. **SEPARATE billed branch**（receipt `billing_mode='SEPARATE'` 且 `billed_qty>0` 且 `unbilled_qty=0`）：
   - Inventory reversal + AP credit via canonical `applyCreditAdjustment`；
7. **Partially billed branch**（receipt `billing_mode='SEPARATE'` 且 `billed_qty>0` 且 `unbilled_qty>0`）：
   - unbilled portion → `Dr GRNI / Cr Inventory`（no AP）；
   - billed portion → AP credit via canonical `applyCreditAdjustment`；
   - 两笔 voucher 在单事务内创建；
   - audit 记录 split 比例；
8. **CANCELLED** return 不走 voucher；
9. Rollback / 失败 → release row lock + voucher 撤；
10. Audit：`'CONFIRM', 'PURCHASE_RETURN', return_id, return_no`。

#### Unbilled Goods (未入库)

- 不允许建 inventory return；走 Notice rejection / cancel 路径；
- `return_requests.source_type='RECEIPT_NOTICE'` + `return.status='CANCELLED'` 走 Notice 系统路径；
- 真实未入库货物无 Receipt source，`assertRemainingQuantity` 抛 409。

### 26.15 Procurement Scan (PRC-26)

- Bounded：仅 scanner-wedge input，document no / item identity / warehouse / qty / LOT / SERIAL；
- 不做 camera SDK / barcode designer / label printing；
- Scan 后端调用 `procurement-receiving.js::createPurchaseReceiptDraft` 或 `createReceiptNoticeDraft`；
- 前端 Scan 工作面：Source = `PO` or `Receipt Notice`；Step 1：scanner wedge → document lookup；Step 2：identity → line match；Step 3：warehouse + qty + LOT/SERIAL 录入；Step 4：submit 调用 receipt confirm；
- API：`POST /api/procurement/scan/lookup-document`、`POST /api/procurement/scan/draft-receipt`、`POST /api/procurement/scan/draft-notice`。

### 26.16 VMI (VMI-01 ~ VMI-05)

#### Tables

- `vmi_agreements(id, agreement_no, supplier_id, warehouse_id, product_id, business_date_start, business_date_end, replenishment_mode('PULL'|'PUSH'|'MIN_MAX'), min_quantity, max_quantity, ownership_transfer_rule('ON_CONSUME'|'ON_PERIOD_CLOSE'|'ON_TRANSFER'), status, created_by, created_at)`；
- `vmi_receipts(id, vmi_receipt_no, agreement_id, supplier_id, warehouse_id, product_id, quantity_num, quantity_den, business_date, status, idempotency_key, created_by)`；
- `vmi_consumptions(id, vmi_consumption_no, agreement_id, supplier_id, warehouse_id, product_id, source_type, source_id, source_LINE_id, consumed_quantity_num, consumed_quantity_den, business_date, status, idempotency_key, created_by)`；
- `vmi_consumption_summaries(agreement_id, period_key, period_start, period_end, consumed_quantity, pending_settlement_qty, ownership_transferred_qty, last_calculated_at)`；
- `vmi_ownership_transfers(id, transfer_no, agreement_id, supplier_id, warehouse_id, product_id, transfer_quantity_num, transfer_quantity_den, business_date, status('DRAFT'|'CONFIRMED'), settlement_supplier_bill_id, idempotency_key)`。

#### Owner-Dimension Interface (CROSS_DOMAIN_DEPENDENCY)

`inventory-extensions.js::OWNER_DIMENSION_INTERFACE`（契约层 — 不实现）：

```text
receiveOwnedStock({ownerType, ownerId, warehouseId, productId, quantity, lotId, serialId, source_type, source_id, idempotency_key}) -> {transaction_id, ledger_row_id}
consumeOwnedStock({ownerType, ownerId, warehouseId, productId, quantity, lotId, serialId, source_type, source_id, idempotency_key}) -> {transaction_id}
transferStockOwnership({fromOwner, toOwner, warehouseId, productId, quantity, lotId, serialId, source_type, source_id, idempotency_key}) -> {transaction_id}
```

`ownerType` ∈ {`ENTERPRISE`, `SUPPLIER`}；当前 inventory 默认 `owner_type='ENTERPRISE'`。本 Domain 调用方：
- `vmi_receipts.confirm()` → `receiveOwnedStock(ownerType='SUPPLIER', ownerId=supplier_id, ...)`；
- `vmi_consumptions.confirm()` → `consumeOwnedStock(ownerType='SUPPLIER', ownerId=supplier_id, ...)`；
- `vmi_ownership_transfers.confirm()` → `transferStockOwnership(fromOwner={type:SUPPLIER,id:supplier_id}, toOwner={type:ENTERPRISE,id:null}, ...)`。

#### Blocked Behavior

Inventory owner dimension **尚未实现**时（本 Domain 上线初期），`receiveOwnedStock / consumeOwnedStock / transferStockOwnership` 抛 `HttpError(501, 'INVENTORY_OWNER_DIMENSION_UNAVAILABLE')`：
- VMI Policy / Consumption Summary 等不需要物理 mutation 的能力可独立工作；
- 需要 owner-dimensional mutation 的能力（VMI-02 / VMI-03 / VMI-05 physical 部分）返回 409 + 明确 owner-domain-blocker；
- VMI business layer 落地 ≠ Inventory owner-dimensional physical stock 落地；
- 当 Inventory Domain 完成 owner dimension 后，接口替换为真实实现；本 Domain 仅调契约，不直接 SQL 写 inventory。

#### Supplier Bill Handoff

- 仅 VMI-05 Ownership Transfer confirm 后触发 Supplier Bill 自动生成：调用 `createSupplierBill(db, {source_type:'VMI_OWNERSHIP_TRANSFER', source_id:transfer_id, ...})`（canonical Supplier Bill）；
- VMI-02/VMI-03 **不**直接 AP；避免在 supplier-owned 阶段伪造 AP。

### 26.17 Outsourcing Order (OUT-01~OUT-10)

#### Tables

- `outsourcing_orders(id, outsourcing_no, source_type('PLANNING'|'MANUAL'), source_id, supplier_id, product_id, need_date, status('DRAFT'|'PLAN_CONFIRMED'|'RELEASED'|'COMPLETED'|'CLOSED'|'CANCELLED'), planning_handoff_id NULLABLE UNIQUE, processing_po_id NULL, processing_commercial_snapshot_json, bom_version_snapshot, created_by, created_at, version)`；
  - `planning_handoff_id` NULLABLE — NULL 表示 MANUAL Order；non-null 表示 PLANNING source；
  - **`UNIQUE(planning_handoff_id)`** — canonical exactly-once contract；
- `outsourcing_order_lines(id, outsourcing_order_id, line_no, product_id, planned_quantity_num, planned_quantity_den, source_bom_id, source_bom_version)`；
- `planning_outsource_handoffs` 既有 — additive 列 `status` ∈ {`PENDING`, `CONSUMED`}，`target_outsourcing_order_id NULLABLE`，`consumed_at`、`consumed_by`；
- `outsourcing_material_lists(id, outsourcing_order_id, version, bom_id, bom_version, snapshot_json, frozen_at)` — snapshot 不可写回修改；
- `outsourcing_material_list_items(id, outsourcing_material_list_id, component_product_id, per_unit_qty_num, per_unit_qty_den, scrap_bps, required_qty_num, required_qty_den, line_no)` — 每条 item 单独 backflush 计算的 granularity；
- 复用既有 `purchase_orders`（**Option A: 复用 canonical PO**，参见 §26.18）；PO header additive `business_type='STANDARD_PURCHASE'|'OUTSOURCE_PROCESSING'` + `source_outsourcing_order_id`。

#### Order Creation

`outsourcing.js::createOutsourcingOrder(db, {input})`:

1. Validate source：
   - `source_type='PLANNING'` → consume `planning_outsource_handoffs(id)` exactly-once（见下方 `consumePlanningHandoff`）；`outsourcing_orders.planning_handoff_id = handoff.id`；
   - `source_type='MANUAL'` → `outsourcing_orders.planning_handoff_id = NULL`；跳过 handoff；
2. Validate supplier：`supplier_procurement_profiles.outsourcing_enabled=1 AND qualification_status='QUALIFIED'`；
3. Resolve BOM：调用 `engineering-configurable-bom.js::resolveEffectiveBomForCaller(db, productId, 'OUTSOURCE', businessDate)`；无结果 → 409；
4. Snapshot：写 `outsourcing_material_lists(version=1)`；
5. Lifecycle 初始：`DRAFT`；
7. Release → `PLAN_CONFIRMED` → `RELEASED` → Material List 冻结（后续 master BOM 变更不写回）。

#### Planning Handoff Consumption (OUT-05) — Final Design

`outsourcing.js::consumePlanningHandoff(db, {handoffId, actor})`:

Transaction (复用现有 `transaction(db, work)` helper，SQLite `BEGIN IMMEDIATE` / MySQL transaction gate + row lock + retry handling)：

```text
BEGIN

lock planning_outsource_handoffs row WHERE id = handoffId FOR UPDATE

assert handoff.status = 'PENDING'   else 409 (already consumed)

assert no row exists in outsourcing_orders WHERE planning_handoff_id = handoffId
                                          else 409 (already consumed)

insert outsourcing_orders(
  planning_handoff_id = handoffId,
  source_type        = 'PLANNING',
  source_id           = handoffId,
  status              = 'DRAFT',
  ...
)

update planning_outsource_handoffs
   set status                       = 'CONSUMED',
       consumed_at                  = now,
       consumed_by                  = actor.id,
       target_outsourcing_order_id  = <new order id>
 where id = handoffId

COMMIT
```

Exactly-once invariants：

- Canonical cross-SQL identity = `outsourcing_orders.planning_handoff_id` UNIQUE 约束。MySQL / SQLite 同时生效；
- MySQL row lock = `SELECT ... FOR UPDATE` on handoff row；
- SQLite = `BEGIN IMMEDIATE` transaction + `WHERE status='PENDING'` re-check；
- Idempotency key = `OUTSOURCING_PLANNING_HANDOFF_CONSUME:{handoffId}`；二次调用返回同 `outsourcing_order_id` 而非重复 INSERT（replay safety）。

#### Cancellation Rule

- 一旦 handoff 进入 `CONSUMED`，**不**允许重新打开 / 重新消费；
- 即使下游 Outsourcing Order 后来 `CANCELLED`，handoff 保持 `CONSUMED`；
- 新需求必须创建新的 Planned Order → 新的 Planning handoff；保持 Planning 不可变性与 source history；
- `target_outsourcing_order_id` 字段是 audit trace — 即使 Order CANCELLED，handoff 仍指向它，便于追溯源。

#### Lifecycle (OUT-07)

- Source-backed Manual semantics：`PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED`；
- Bounded technical states：`DRAFT / CANCELLED` — Design 决策，不冒充 Manual Evidence；
- 状态机：`DRAFT → PLAN_CONFIRMED → RELEASED → COMPLETED → CLOSED`；`DRAFT / PLAN_CONFIRMED` 可 → `CANCELLED`；`RELEASED` 后 `CANCELLED` 仅允许在无 material issue / 无 receipt / 无 processing bill 时；`COMPLETED / CLOSED` 不可取消；
- 不写入 platform approval 作为必需阶段；如需审批走 Platform Approval `OUTSOURCING_ORDER` (后续 Design bounded)。

#### OUTSOURCE BOM Resolver (OUT-08)

`outsourcing.js::resolveBomForOrder` 调用 `resolveEffectiveBomForCaller(db, productId, 'OUTSOURCE', businessDate)`：
- 禁止 raw SQL `boms.status='ACTIVE' LIMIT 1`；
- 无 BOM → 409；
- BOM 已 expired → 409；
- BOM 已变更但 snapshot 已写 → 不影响 released order（snapshot 冻结）；
- qty 调整必须先 release 之前；release 后调整需走 PO Change（如使用 canonical PO 复用）或显式 SUPERSEDE。

### 26.18 Outsourcing PO (OUT-10) — Option A: 复用 canonical PO

**Design 决策：Option A — 复用 canonical Purchase Order。**

**理由**：
- 商业一致性：Supplier Bill / AP engine 不变；`purchase_discounts` 不变；
- 现有 `purchase_orders` 已支持 APPROVED → Receipt → Bill → AP 链；
- 测试 / migration / RBAC / Period Close 共享基础设施；
- 业务语义单一 owner 收敛。

**Additive schema**：

- `purchase_orders` 新增列：
  ```text
  business_type                TEXT NOT NULL DEFAULT 'STANDARD_PURCHASE'
  source_outsourcing_order_id  TEXT NULLABLE REFERENCES outsourcing_orders(id)
  ```
- `business_type` ∈ {`STANDARD_PURCHASE`, `OUTSOURCE_PROCESSING`}；
- Legacy 行 backfill `DEFAULT 'STANDARD_PURCHASE'` — 历史 PO 全部视为普通采购，语义不变；migration 仅填默认 + 新建列；
- `source_outsourcing_order_id` 仅在 `business_type='OUTSOURCE_PROCESSING'` 时 non-null 且必须引用 `outsourcing_orders.id`。

**Processing Fee Semantics**：
- PO line `unit_price_cents` 仅表示 processing service fee；
- 企业提供材料 **不**作为 PO line value；走 §26.19 material execution；
- PO line `quantity` = processing quantity（按 Outsourced Receipt 完成数量结算）；
- Receipt 时 GRNI：`Dr GRNI / Cr Processing fee only` — **不**包含 material value。

**OUTSOURCE_PROCESSING PO Isolation Matrix**：

| Caller | STANDARD_PURCHASE | OUTSOURCE_PROCESSING | 强制 |
|---|---|---|---|
| Standard Purchase Receipt confirm | ACCEPT | **FAIL CLOSED 409** — 走 Outsourcing Receipt 路径 | server-side `business_type` check before inventory mutation |
| Outsourcing Receipt confirm | **FAIL CLOSED 409** | REQUIRE + validate `po.source_outsourcing_order_id = outsourcing_order.id` | server-side |
| MRP Purchase Supply（`releasePlannedOrder` BUY branch） | INCLUDE | **EXCLUDE** | source list / read model |
| Planner Workbench Purchase Supply | INCLUDE | **EXCLUDE** | read model |
| Reservation Purchase Supply | INCLUDE | **EXCLUDE** | read model |
| Receipt Notice | ACCEPT (`business_type='STANDARD_PURCHASE'` additive) | REQUIRE discriminator `business_type='OUTSOURCE_PROCESSING'`，否则 → Outsourcing Receipt | additive column on `receipt_notices` |
| Purchase Return confirm | ACCEPT | **FAIL CLOSED** — 走 Outsourcing Finished Return | server-side |
| PO Execution Read Model (`getPoExecutionView`) | INCLUDE | INCLUDE but flagged `processing_fee_only` for reports | read model |
| Procurement Reports (PO outstanding / on-time) | INCLUDE with `processing_fee_value` aggregate | INCLUDE separately (never merged into BUY) | read model |
| Supplier Bill Matching | `commercial_source_type='PURCHASE_RECEIPT_ITEM'` | `commercial_source_type='OUTSOURCING_RECEIPT_ITEM'` | see §26.20 |
| PO Change (`ADD` / `MODIFY` / `CANCEL`) | ACCEPT | ACCEPT（仅改 quantity / price / schedule；不改 `business_type` / `source_outsourcing_order_id`） | mutation guard |

禁止任何 caller 静默将 `STANDARD_PURCHASE` 与 `OUTSOURCE_PROCESSING` 当作同语义处理；差异必检。

**Option B 拒绝理由**：建立独立 Outsourcing Processing Order 需建立 second PO engine、第二 Supplier Bill / AP source、第二 Approval / Period Close / Period / RBAC — 与 Requirement / Document §6 / AGENTS.md §6 单一 active canonical implementation 冲突。

### 26.19 Material Execution (OUT-11 / OUT-12 / OUT-13 / OUT-14 / OUT-15 / OUT-16)

#### Tables

- `outsourcing_material_issues(id, issue_no, outsourcing_order_id, source_material_list_item_id, status('DRAFT'|'CONFIRMED'|'CANCELLED'), business_date, created_by)`；
- `outsourcing_material_issue_items(id, issue_id, component_product_id, lot_id, serial_id, quantity_num, quantity_den, source_warehouse_id, target_warehouse_id, line_no, tracking_allocations_json)`；
- `outsourcing_material_supplements` 同结构；reason_code / reason_text；
- `outsourcing_material_returns` 同结构（方向相反 `Supplier WIP → Internal`）；
- `outsourcing_material_positions(outsourcing_order_id, component_product_id, lot_id, serial_id, required_qty_num, required_qty_den, issued_qty_num, issued_qty_den, supplemented_qty_num, supplemented_qty_den, returned_qty_num, returned_qty_den, backflushed_qty_num, backflushed_qty_den, supplier_wip_qty_num, supplier_wip_qty_den, version)` — 由 view 派生，不写库。

#### Inventory Transfer Integration

`outsourcing-materials.js::confirmMaterialIssue(db, {issueId, actor})`:

- 调用 canonical Inventory Transfer service（`server/lib/stock.js::adjustInventory` + `source_tracking_allocations`）；
- `from_warehouse_id` = internal warehouse；`to_warehouse_id` = supplier WIP warehouse (`supplier_wip_warehouse_id` from `suppliers` table)；
- MovementType = `TRANSFER_OUT`；
- `inventory_transactions` source_type = `OUTSOURCING_MATERIAL_ISSUE`；
- `supplier_wip_position` 由 `outsourcing_material_positions` 派生 view 计算（不写库存 truth）；
- LOT/SERIAL provenance：所有 identity 走 canonical `source_tracking_allocations` / `save_tracked_allocations`；
- Returns 反向：movementType=`TRANSFER_IN`。

#### Ownership Invariant

- `OWNER = ENTERPRISE`；`PHYSICAL LOCATION = Supplier WIP Warehouse`；
- **不得**复用 VMI ownership semantics；
- **不得**建立 second owner ledger；
- 缺 `supplier_wip_warehouse_id` → 409 fail closed。

#### Backflush (OUT-16) — Per Material Line Cumulative Model (Single Truth)

**Design 决策 (final)**：backflush 必须按 **Outsourcing Material List Item** 单独计算。**禁止**对不同 material line 跨物料 SUM 形成 authoritative backflush quantity — 不同物料有不同 UOM / different scale，跨 SUM 会产生跨 UOM 数字（PCS + KG 数值相加），违反 business invariant。

**Canonical formula — Per Material Line i**（rational quantity math via `rational()` from `commercial-golive.js`）：

```text
For each Material List Item i (one row in outsourcing_material_list_items
                                 scoped by outsourcing_order_id + component_product_id
                                 + lot_id (where applicable) + serial_id (where applicable)):

  # Snapshot taken from frozen Outsourcing Material List/BOM execution snapshot:
  material_required_qty_i   # snapshot frozen, NOT re-derived from current Master BOM
                             # already encodes: BOM qty * order qty + scrap rule
                             # source of truth: outsourcing_material_list_items.required_qty_i

  order_snapshot_qty        = outsourcing_orders.required_qty   # frozen at order confirm

  # Net supplied to Supplier WIP for this line (cumulative, per-line)
  net_supplied_qty_i
    = issued_qty_i
    + supplemented_qty_i
    - returned_qty_i

  # Already-backflushed for THIS LINE (cumulative)
  already_backflushed_qty_i
    = sum(inventory_valuation_movements.quantity_delta.abs
          WHERE source_type='OUTSOURCING_BACKFLUSH'
            AND source_outsourcing_order_id = order_id
            AND source_material_list_item_id = i.id
            AND (lot_id = i.lot_id OR (i.lot_id IS NULL AND lot_id IS NULL))
            AND (serial_id = i.serial_id OR (i.serial_id IS NULL AND serial_id IS NULL)))

  # Cumulative finished receipt qty (only confirmed Outsourcing Receipt)
  cumulative_finished_receipt_qty
    = sum(outsourcing_receipt_items.quantity
          WHERE outsourcing_order_id = order_id
            AND outsourcing_receipt.status = 'CONFIRMED')

  # Target cumulative consumption for THIS LINE
  # = material_required_qty_i * (cumulative_finished_receipt_qty / order_snapshot_qty)
  target_cumulative_consumption_i
    = material_required_qty_i
      × (cumulative_finished_receipt_qty / order_snapshot_qty)
    # exact rational math (no floating point)

  # Incremental backflush for THIS LINE for THIS receipt
  incremental_backflush_i
    = target_cumulative_consumption_i - already_backflushed_qty_i

  # Guards (FAIL CLOSED if any violation):
  assert incremental_backflush_i >= 0
  assert incremental_backflush_i <= (net_supplied_qty_i - already_backflushed_qty_i)
```

**Per-line isolation invariants**：

- 不同 material line 之间 **不**交叉 SUM；
- 不同 `outsourcing_order` 之间 **不**共享 inventory；
- 同 material + 不同 lot/serial 视为不同 line；identity preserved end-to-end via canonical `source_tracking_allocations`；
- 任何 cross-line SUM / aggregate-only-over-multi-material → 视为 owner 漂移 → 拒绝。

#### Scrap / Requirement Snapshot

`material_required_qty_i` 来自 **frozen Outsourcing Material List execution snapshot**（`outsourcing_material_lists.version`）；已 encode BOM qty × order qty × scrap rule；**Backflush 阶段禁止重新读取 Master BOM 重算**。

#### Supplier WIP Remaining — Derived Per Line (NOT input)

```text
supplier_wip_remaining_qty_i
  = issued_qty_i
  + supplemented_qty_i
  - returned_qty_i
  - backflushed_qty_i
```

`supplier_wip_remaining_qty_i` 是 derived execution state，**不**作为 backflush 数学的输入。所有下列页面 / 模块必须消费同一 view（隔离 per line / per lot / per serial）：

- Outsourcing Detail (Material Position widget)；
- Material Execution (Issue / Supplement / Return screens)；
- Procurement Reports (Outsourcing Material Issue Summary)；
- Difference Allocation (Period Close)；
- WIP Transfer (Source/Target position updates)。

任何模块重算此派生 → owner 漂移 → 拒绝。

#### Multiple Material Example (mandatory — 跨 UOM 不可加)

```text
Order finished qty = 100 FG

Material A: required = 2 PCS/unit    → material_required_qty_A = 200 PCS
Material B: required = 0.5 KG/unit   → material_required_qty_B = 50 KG

Confirmed finished qty = 30 FG
cumulative_finished_receipt_qty = 30
order_snapshot_qty = 100

target_cumulative_A = 200 × (30 / 100) = 60 PCS
target_cumulative_B = 50  × (30 / 100) = 15 KG

# Each line computed independently — NEVER:
#   (200 + 50) × 30 / 100  = 75 "unit"   # 跨 UOM 数字 — INVALID
```

#### Multi-Receipt Example (mandatory — 增量回冲)

```text
Order finished qty                = 100
Material A: material_required_qty_A = 200 PCS
order_snapshot_qty              = 100

Receipt 1 confirmed = 30
  cumulative_finished_receipt_qty  = 30
  target_cumulative_A              = 60 PCS
  already_backflushed_A            = 0
  incremental_backflush_A           = 60 PCS

Receipt 2 confirmed = 20
  cumulative_finished_receipt_qty  = 50
  target_cumulative_A              = 100 PCS
  already_backflushed_A            = 60
  incremental_backflush_A           = 40 PCS
```

Receipt 不可重新 backflush 整个 order requirement — 否则 supplier-WIP 出现负数、跨订单污染、material carrying value 失真。

#### Supplement Example (per-line)

```text
required_cumulative_A             = 10
issued_A                          = 10
supplemented_A                    = 2
returned_A                        = 1
already_backflushed_A             = 8

net_supplied_A                    = 10 + 2 - 1 = 11
available_for_further_consumption_A = 11 - 8 = 3

# New target cumulative becomes 10
incremental_backflush_A           = 10 - 8 = 2
supplier_wip_remaining_after_A    = 11 - 8 - 2 = 1
```

Supplement 已正确纳入；supplier-WIP 剩余 1 PCS 留待后续 Receipt / WIP Transfer / Period Difference 处理。

#### Failure Behavior

- 任何 guard 失败 → `HttpError(409, 'BACKFLUSH_INSUFFICIENT_SUPPLY' / 'BACKFLUSH_TARGET_MISMATCH')`；
- **不**从其它 Outsourcing Order / 其它 material line 偷 material；
- **不**写入 raw inventory UPDATE；只通过 canonical `server/lib/stock.js::adjustInventory` + `financial-inventory.js::issueValue`；
- Audit：`'BACKFLUSH', 'OUTSOURCING_ORDER', orderId, receipt_id, material_list_item_id, incremental_cents, material_consumed_value_cents`；
- Idempotency key = `OUTSOURCING_BACKFLUSH:{outsourcing_receipt_id}`；二次调用返回同 effect 不重复扣减。

#### LOT / SERIAL (OUT-15)

- Issue identity 写入 supplier site；
- Return identity 必须同 provenance；
- Backflush 必须按 order-held identity；
- Serial 不得跨 Outsourcing Order 重复消费。

### 26.20 Outsourcing Receiving / Finance Handoff (OUT-17~OUT-23)

#### Tables

- `outsourcing_completion_notices(id, notice_no, outsourcing_order_id, processing_po_id, supplier_id, expected_date, status('DRAFT'|'POSTED'|'CANCELLED'), business_date)`；
- `outsourcing_completion_notice_items(id, notice_id, product_id, planned_qty_num, planned_qty_den, planned_lot_id NULL, planned_serial_id NULL)`；
- `outsourcing_inspections(id, inspection_no, outsourcing_receipt_id, source_type, source_id, policy_snapshot_json, status('DRAFT'|'PASS'|'FAIL'|'WAIVED'), inspected_by, inspected_at)`；
- `outsourcing_receipts(id, receipt_no, outsourcing_order_id, supplier_id, warehouse_id, business_date, status('DRAFT'|'CONFIRMED'|'CANCELLED'), source_notice_id, completion_inspection_id, created_by, version)`；
- `outsourcing_receipt_items(id, outsourcing_receipt_id, product_id, lot_id, serial_id, quantity_num, quantity_den, line_no)`；
- `outsourcing_cost_evidences(id, outsourcing_receipt_id, processing_po_id, material_consumed_value_cents, processing_fee_provisional_cents, processing_fee_actual_cents NULL, variance_cents NULL, basis_status('PROVISIONAL'|'FINAL'), calculated_at)`；
- `outsourcing_finished_returns(id, return_no, outsourcing_receipt_id, business_date, status, reason_code)`；
- `outsourcing_finished_return_items(id, return_id, product_id, lot_id, serial_id, quantity_num, quantity_den)`；
- `outsourcing_wip_transfers(id, transfer_no, source_outsourcing_order_id, target_outsourcing_order_id, product_id, quantity_num, quantity_den, business_date)`；
- `outsourcing_period_closings(period_key, frozen_at, summary_json)`；
- `outsourcing_period_opening_records(id, outsourcing_order_id, opening_remaining_qty_num, opening_remaining_qty_den, opening_supplier_wip_qty_num, opening_supplier_wip_qty_den, opening_processing_fee_cents, marked_OPENING, created_at)`。

#### Completion Receipt Notice (OUT-17)

- 不影响 inventory / valuation / GRNI / AP；
- 复用 Receipt Notice infrastructure（business_type='OUTSOURCE' additive）；
- Source: Outsourcing Order + Processing PO。

#### Outsourcing Inspection (OUT-18)

- 扩展 IQC source-type `OUTSOURCING_RECEIPT`；
- Policy snapshot 走既有 `freezeQualityPolicy`；
- PASS / FAIL / WAIVED；
- Stale detection：inspection date < receipt confirm date → 409。

#### Outsourcing Inbound (OUT-19)

`outsourcing-receiving.js::confirmOutsourcingReceipt(db, {receiptId, actor})` — atomic：

1. Validate: order remaining > 0; quality gate (PASS or WAIVED);
2. **Validate processing PO required `business_type='OUTSOURCE_PROCESSING'`** + `purchase_orders.source_outsourcing_order_id = outsourcing_order.id`；不兼容 → 409（cross-order processing-fee source 阻断）；
3. Validate processing PO line（每 receipt item 必须 trace 到 processing PO line eligible qty，且该 receipt_item `outsourcing_order_id = order.id`）；
4. Backflush materials (call §26.19 Backflush cumulative model);
5. Capture material consumed value via `issueValue` (canonical) → `outsourcing_cost_evidences.material_consumed_value_cents`；
6. Recognize finished inventory: `receiveValue(product_id, warehouse_id, quantity, value_cents=0)` — finished material value 不来自 BOM 标准价，来自 consumed carrying value；
7. Update Outsourcing Order `received_qty` / status：`RELEASED → COMPLETED` (when cumulative finished receipt qty == order.required_qty — 注意是 **cumulative** 而非 single receipt condition);
8. Cost evidence provisional row (basis_status='PROVISIONAL');
9. Schedule processing fee AP bill trigger（idempotent，详见 §26.20 OUT-20）；
10. **Not** Finance — Finance boundary consumes cost evidence for final valuation adjustment.

Processing Fee AP (OUT-20) — Source Cardinality Final (Single Truth)

**Design 决策**：Source relationship belongs at **`supplier_bill_items`**，**不**在 header。Header 没有 authoritative single Receipt FK — 一个 Supplier Bill 可以包含多个 Outsourcing Receipt Items 与 / 或多个 Purchase Receipt Items（兼容）。

**Canonical source identity (generic, item-level)**：

```text
supplier_bill_items
  commercial_source_type        ∈ {PURCHASE_RECEIPT_ITEM, OUTSOURCING_RECEIPT_ITEM, ...}
  commercial_source_id           -- header-level source FK (e.g. receipt_id)
  commercial_source_item_id      -- item-level source FK (e.g. receipt_item_id)  [CANONICAL]
```

Legacy compatibility columns may coexist for existing `purchase_receipt_item_id` FK; **authoritative canonical source identity = `commercial_source_*` trio above**. Legacy-specific FK 列 **不**作为 authoritative rule，不与 `commercial_source_*` 双写 / 双改 — 写入时由 canonical 列驱动 legacy 列做一次性同步（迁移期兼容），读取时只信任 canonical。

**Forbidden designs (must NOT be reintroduced)**：

- ❌ Header-level `supplier_bills.source_outsourcing_receipt_id` FK — 已被移除（multi-receipt 1:1 假设不成立）；
- ❌ 任何 supplier_bill_items `source_type + source_outsourcing_receipt_item_id` UNIQUE（含 partial / conditional variants）— supplier_bill_items.index 不能引用 supplier_bills.status，MySQL 无 portable equivalent，且会错误禁止 partial billing；
- ❌ 任何 `UNIQUE(receipt_item_id)` 替代 partial billing 限制 — 会禁止 partial billing。

#### Processing Fee Partial Billing (canonical)

一个 confirmed Outsourcing Receipt Item **允许** partial bill 多次：

```text
Receipt Item qty = 100

Bill A = 30
Bill B = 20
Bill C = 50
```

只要累计：

```text
SUM(active_billable_reservation_qty for same commercial_source_item_id)
<= eligible_processing_qty
```

无 multi-status column，否则两个 DRAFT 并发各吃完整余量会导致双计。

#### Canonical Billable Quantity Calculation

```text
eligible_processing_qty
  = outsourcing_receipt_items.quantity  (confirmed receipt, source-receipt_item scoped)
    - sum(outsourcing_return_items.confirmed_qty
          WHERE source_outsourcing_receipt_item_id = receipt_item.id
            AND return.status = 'CONFIRMED')
    - any other source-scoped reduction by canonical Finance lifecycle

already_billed_reserved_qty
  = sum(supplier_bill_items.quantity
        WHERE commercial_source_type = 'OUTSOURCING_RECEIPT_ITEM'
          AND commercial_source_item_id = receipt_item.id
          AND bill.status IN ('DRAFT', 'WAITING_MATCH', 'POSTED'))
  # canonical billable reservation statuses = {DRAFT, WAITING_MATCH, POSTED}
  # CANCELLED / REVERSED are NOT counted (released by Finance lifecycle)

remaining_billable_qty
  = eligible_processing_qty - already_billed_reserved_qty

assert requested_qty <= remaining_billable_qty
```

**Why these statuses**: `DRAFT` reserves the qty to prevent two parallel drafts each consuming the full remaining; `WAITING_MATCH` blocks posting-stage double consume; `POSTED` blocks any further bill. `CANCELLED` / `REVERSED` release the reservation per canonical Finance lifecycle.

#### Multi-Receipt Supplier Bill (canonical)

```text
Outsourcing Receipt A item  ──┐
Outsourcing Receipt B item  ──┼─→  one Supplier Bill
Outsourcing Receipt C item  ──┘

约束：
  - 同一 supplier_id
  - 同一 payable 商业上下文（currency, payment_terms_days）
  - 每 line.commercial_source_type ∈ {PURCHASE_RECEIPT_ITEM, OUTSOURCING_RECEIPT_ITEM}
  - 不得 header-level 单 receipt FK 限制 cardinality
  - 不得 cross-PO line 跨 commercial context 混开
  - 不允许 OUTSOURCING 与 STANDARD source 在同一 supplier_bill_item 中混存（line 必须单一 source_type）
```

#### Supplier Bill Transaction (OUTSOURCE source)

Reuse existing `transaction(db, work)` helper (`BEGIN IMMEDIATE` / MySQL transaction gate + row lock + retry). **No new transaction layer.**

```text
BEGIN

lock outsourcing_receipt_items rows WHERE id IN (item_ids) FOR UPDATE

for each item:
  assert receipt.status = 'CONFIRMED'
  assert supplier compatible
  assert processing PO compatible
  assert processing PO.source_outsourcing_order_id = outsourcing_order.id

  read eligible_qty                       (per formula above)
  read already_billed_reserved_qty         (sum over {DRAFT, WAITING_MATCH, POSTED})

  remaining = eligible - already_billed_reserved

  assert requested_processing_qty <= remaining
  else 409 (OVERBILLING)

  insert supplier_bill_items rows
    commercial_source_type        = 'OUTSOURCING_RECEIPT_ITEM'
    commercial_source_id           = receipt.id
    commercial_source_item_id      = item.id
    quantity                       = requested_processing_qty
    (additive audit: source_outsourcing_receipt_item_id, source_outsourcing_po_line_id)

  post via canonical createSupplierBill + ensurePayableSource + applyCreditAdjustment
  (reuse commercial-golive.js / settlement-core.js)

COMMIT
```

SQLite: reuse `transaction(db, work)` + `BEGIN IMMEDIATE` + `WHERE commercial_source_item_id = ?` re-read SUM.
MySQL: reuse transaction gate + `SELECT ... FOR UPDATE` on `outsourcing_receipt_items` row + re-read SUM + retry mechanism.

**Idempotency**: continue reusing existing canonical `saveIdempotency` (`commercial-golive.js`). Processing-fee source key (repo-consistent): `PROCESSING_FEE_BILL:{outsourcing_receipt_item_id}:{quantity}:{fingerprint}`. **不**用 `UNIQUE(receipt_item_id)` 替代 idempotency。

**Receipt-confirm → automatic bill trigger**：

- `confirmOutsourcingReceipt` 完成 → 注册一个 **NOT a synchronous** step；调用 `createProcessingFeeBill({outsourcingReceiptId})` 单事务；
- 同一 receipt confirm 期间不会重复触发（idempotency_key）。

**Invariant**：

- 一个 Supplier Bill 可包含多个 receipt_items；
- 一个 receipt_item 可被多张 Supplier Bill lines 引用（partial billing allowed），累计 active reservation <= eligible；
- 不允许 header-level receipt FK 制造 1:1 假设；
- 不允许 OUTSOURCING source 与 STANDARD purchase source 在同一 `supplier_bill_item` 中混存（line 必须单一）。

#### Finished Return (OUT-22)

- Source: confirmed Outsourcing Receipt；
- Quantity cap = `received_qty - already_returned_qty`；
- 调用 canonical inventory reversal；
- Processing fee / billability handoff 走 canonical `applyCreditAdjustment`；
- **不得**套普通 Purchase Return 的 price semantics（material carrying value 不来自采购价）。

#### Cost Evidence (OUT-21)

`outsourcing-receiving.js::computeCostEvidence(db, {outsourcingReceiptId})`:

- `material_consumed_value_cents` = sum(`inventory_valuation_movements.value_delta_cents` WHERE `source_type='OUTSOURCING_BACKFLUSH'` AND source_id 关联 receipt) — **actual consumed carrying value**；
- 排除 `issued but unused` / `returned` / `supplier-WIP remaining`；
- `processing_fee_provisional_cents` = `processing_po_line.unit_price_cents * received_qty`；
- `processing_fee_actual_cents` = canonical Supplier Bill item `amount_cents` after onboarding；
- `variance_cents` = `processing_fee_actual - processing_fee_provisional`；
- `basis_status='PROVISIONAL'` 直到 final bill POSTED → `FINAL`；
- Finance boundary：final valuation adjustment + variance allocation + month-end costing + accounting voucher — Finance owner owns.

#### Period / WIP / Opening / Reports (OUT-23)

`outsourcing-receiving.js::closeOutsourcingPeriod(db, {period_key, actor})`:

- backflush difference allocation: 实际盘点 supplier WIP vs required - issued - returned → preview → allocate → apply；preview 提供 per-order preview；apply 单事务；generated supplement/return 标记 `system_source='PERIOD_DIFFERENCE'`；
- supplier material balance per agreement per period；
- WIP transfer: source outsourcing order → transit → target outsourcing order；canonical inventory movement；ownership 不变；
- opening: opening records 标记 `OPENING`，不得虚构历史 voucher；
- execution summary / material issue summary / detail reports 复用 §26.21 read model。

### 26.21 Canonical Read Models

`procurement-read-models.js`（NEW）— 单一动态 read model，不允许 per-report 重算：

```text
procurementReadModel({from, to, schemeId, supplierId, productId, businessType?}):
  # PO events (BUY 视角):仅包含 purchase_orders.business_type = 'STANDARD_PURCHASE'
  PO events (STANDARD_PURCHASE only):
    ordered    = sum(po_line.quantity
                     WHERE po.business_type = 'STANDARD_PURCHASE'
                       AND po.status IN ('APPROVED','PARTIALLY_RECEIVED','FULFILLED'))
    notified   = sum(receipt_notice_items.planned_qty
                      JOIN po_line ON po_line.id = receipt_notice_items.po_line_id
                      WHERE po.business_type = 'STANDARD_PURCHASE')
    received   = sum(purchase_receipt_items.confirmed_qty
                      JOIN po_line ON po_line.id = purchase_receipt_items.po_line_id
                      WHERE po.business_type = 'STANDARD_PURCHASE'
                        AND purchase_receipt.status = 'CONFIRMED')
    returned   = sum(purchase_return_items.confirmed_qty
                      JOIN purchase_receipt_items ON ...
                      JOIN po_line ON ...
                      WHERE po.business_type = 'STANDARD_PURCHASE')
    open       = ordered - received - returned
    billing    = AP open_amount (linked to receipt) - credit adjustments
    on_time    = received.expected_date vs po.expected_delivery_date

  outsourcingReadModel({from, to, supplierId, productId}):
    order_qty          = order.required_qty
    processing_po_qty  = po_line.quantity WHERE po.business_type='OUTSOURCE_PROCESSING'
                                            AND po.source_outsourcing_order_id = order.id
    received_qty       = sum(outsourcing_receipt_items.quantity WHERE receipt.status='CONFIRMED')
    # Per material line (NOT cross-material SUM):
    material_required_per_line  = outsourcing_material_list_items.required_qty_i
    issued_per_line             = sum(issue_items.qty WHERE material_list_item_id = i.id)
    supplemented_per_line       = sum(supplement_items.qty WHERE material_list_item_id = i.id)
    returned_per_line           = sum(return_items.qty WHERE material_list_item_id = i.id)
    backflushed_per_line        = sum(backflush_movements.qty WHERE source_material_list_item_id = i.id)
    supplier_wip_remaining_per_line  # DERIVED — see §26.19
      = issued_per_line + supplemented_per_line - returned_per_line - backflushed_per_line
    processing_fee     = cost_evidence.processing_fee_actual_cents
    cost_value         = cost_evidence.material_consumed_value_cents
```

**OUTSOURCE_PROCESSING 隔离**：MRP Purchase Supply / Planner Workbench Purchase Supply / Reservation Purchase Supply — 全部必须显式 `WHERE po.business_type='STANDARD_PURCHASE'`。OUTSOURCE_PROCESSING PO **不**进入 BUY supply、不进入 procurement reports 的 BUY 视图、不被 Reservation 视为 eligible supply。

**Supplier WIP Remaining** 由 §26.19 单一 view 派生；本 read model 不得重算。

API endpoints reuse the single service.

### 26.22 RBAC / Audit / Errors

新增最小独立 permission 家族（back-end fail closed；最小化 privilege migration + 保留 legacy role 行为）：

- `PROCUREMENT_CONFIG_VIEW` / `PROCUREMENT_CONFIG_MANAGE`：Parameters / Supplier profile / Buyer / Purchasing Group；
- `SOURCING_VIEW` / `SOURCING_MANAGE`：Source List / Quota / Sourcing Decision / Override；
- `PRICING_VIEW` / `PRICING_MANAGE`：Price List / Pricing Discount / Price Adjustment / resolve；
- `PO_CHANGE_VIEW` / `PO_CHANGE_MANAGE`：PO Change apply；
- `RECEIPT_NOTICE_VIEW` / `RECEIPT_NOTICE_MANAGE`：Receipt Notice create / confirm；
- `RETURN_REQUEST_VIEW` / `RETURN_REQUEST_MANAGE`：Return Request create / post（**新增**独立 workflow 权限；
  Purchase Return 自身继续复用既有 `RETURNS_VIEW` / `RETURNS_MANAGE`，**不**新建 `PURCHASE_RETURN_*` family）；
- `VMI_VIEW` / `VMI_MANAGE`：VMI Policy / Receipt / Consumption / Summary / Ownership Transfer；
- `OUTSOURCING_VIEW` / `OUTSOURCING_MANAGE`：Outsourcing Order create / lifecycle；
- `OUTSOURCING_RELEASE`：Outsourcing Order release / complete / close；
- `OUTSOURCING_MATERIAL_EXECUTE`：Issue / Supplement / Return / Backflush；
- `OUTSOURCING_RECEIVING_VIEW` / `OUTSOURCING_RECEIVING_MANAGE`：Completion Notice / Inspection / Receipt / Return；
- `PROCUREMENT_SCAN_EXECUTE`：Procurement Scan 工作面。

兼容：保留既有 `SUPPLIERS_*` / `PURCHASE_REQUISITION_*` / `PURCHASE_ORDERS_*` / `PURCHASE_RECEIPTS_*` / **`RETURNS_VIEW` / `RETURNS_MANAGE`** / `IQC_*` / `AP_*` / `PURCHASE_DISCOUNT_*`；admin 继承；其余角色保持现状。**Purchase Return confirm 4-branch 继续使用 `RETURNS_MANAGE`** — 不新建 `PURCHASE_RETURN_*`，保持权限迁移最小化。

Audit：

- Procurement Parameters / Profile / Buyer / Purchasing Group / Source List / Quota / Sourcing Decision / Override / Price List / Pricing Discount / Price Adjustment；
- PO Change applied；
- Receipt Notice（仅 Formal Invariants，无业务副作用）；
- Purchase Return 4-branch voucher；
- VMI Agreement / Receipt / Consumption / Summary / Ownership Transfer；
- Outsourcing Order lifecycle / BOM snapshot / Material Position update；
- **Planning Handoff Consumption**（含 `target_outsourcing_order_id` 链接）；
- Backflush（含 cumulative target + incremental + idempotency_key）；
- WIP Transfer / Difference Allocation；
- Cost Evidence provisional → final transition；
- Processing Fee Bill（含 source-item 维度 link）。

Errors：400 validation；403 permission；404 missing；409 state / overlap / capacity / stale / not-allowed / `PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE` / `BACKFLUSH_INSUFFICIENT_SUPPLY` / `BACKFLUSH_TARGET_MISMATCH` / `HANDOFF_ALREADY_CONSUMED` / `OVERBILLING`；500 unexpected。锁失败 / deadlock 不吞。

### 26.23 Frontend Information Architecture

Mobile-first 设计目标基线 390 CSS px；同步覆盖 320 / 430 / 680；`document.scrollWidth <= clientWidth + 1`；0 hit-target < 44px；0 非资产 browser error。

> **Design-phase 状态**：本节定义 IA 与响应式设计目标；**实际 functional browser verification 必须等到 Implementation / Acceptance 阶段**。本节**不**声称 Design 阶段已完成 320 / 390 / 430 / 680 真实浏览器验收。
>
> **Design targets**：320 / 390 (primary) / 430 / 680。
> **Actual functional browser verification**：Implementation / Acceptance phase mandatory。

Launcher（8 Domain 严格不变；本 Domain 不爆炸）：Procurement & Outsourcing Group → 7 项：

```text
Suppliers
Purchase Requisitions
Sourcing & Pricing
Purchase Orders
Receiving
Purchase Returns
Outsourcing
```

PO Change / Receipt Notice / Return Request / Procurement Scan：作为 PO / Receiving / Returns 详情的 contextual action 或 workspace sheet；不新增一级 launcher。

VMI：作为 Supplier Detail 或 Receiving Workspace 的 VMI 子工作面（operator task：查 agreement、记 consumption、跑 settlement）。

Outsourcing Materials / Outsourcing Receiving / Backflush：作为 Outsourcing Order Detail 的 contextual surface。

#### Sourcing & Pricing UX

`PR → eligible suppliers → quota → price → allocation → blocker/override → preview PO → apply`；primary action 唯一（Apply）；override 必须 permission + reason。

#### PO UX

PO Detail 顺序：Identity / Lifecycle / Commercial Terms / Source / Schedules / Pricing / Change History / Receiving / Returns / Billing / Trace。PO Change：contextual action。`business_type` 视觉标记：STANDARD_PURCHASE vs OUTSOURCE_PROCESSING；下游 Reports 视图按 business_type 隔离。

#### Receiving UX

统一 `Receipt Notice → IQC → Receipt` 视觉链；明确 `Receipt Notice ≠ Inventory Receipt`；Receipt Notice `business_type='STANDARD_PURCHASE'` 触发 Purchase Receipt，`business_type='OUTSOURCE_PROCESSING'` 触发 Outsourcing Receipt — 永不互相漂移。

#### VMI UX

明确显示 `SUPPLIER OWNED` / `consumed` / `pending settlement` / `ownership transferred` / `billable`；physical mutation fail closed（owner dimension blocker）。

#### Outsourcing UX

`Outsourcing Order Detail` 作为 execution hub：Source / Supplier / Product / Lifecycle / BOM / Material List / Material Position（derived view）/ Issue-Supplement-Return / Processing PO / Receipt / Quality / Backflush / Processing Fee / Cost Evidence / Trace。Material Position widget 显示 `issued + supplemented - returned - backflushed = supplier_wip_remaining`。

#### Mobile widths (Design targets)

每个 workspace 320 / 390 / 430 / 680 显式设计；LIST → DETAIL → EDITOR/WORKFLOW；primary action sticky bottom on mobile；filter sheet（bottom）；dense line-item 处理（plan layout — 不依赖永久横向滚动）。

ERP Design Read: Procurement & Outsourcing daily work; primary task: source / buy / receive / return / outsource / settle; density: 8; main layout issues: mixed-owner large files, multiple owners of purchase orders / receipts / returns / bills; preserve: terminology, API/state/RBAC/source/inventory/accounting contracts.

### 26.24 Schema / Migration / MySQL Parity

#### New Tables

- `procurement_parameters`
- `buyers`、`purchasing_groups`、`buyer_memberships`
- `source_list_entries`、`source_list_versions`
- `quota_assignments`
- `sourcing_decisions`、`sourcing_decision_allocations`
- `purchase_price_list_entries`、`purchase_price_list_versions`
- `pricing_discount_schemes`（**新** Procurement Pricing Discount）
- `prepayment_requirements`
- `po_changes`、`po_change_items`
- `po_delivery_schedule`
- `receipt_notices`、`receipt_notice_items`
- `return_requests`、`return_request_items`
- `vmi_agreements`、`vmi_receipts`、`vmi_consumptions`、`vmi_consumption_summaries`、`vmi_ownership_transfers`
- `outsourcing_orders` (含 `planning_handoff_id NULLABLE UNIQUE`)、`outsourcing_order_lines`
- `outsourcing_material_lists`、`outsourcing_material_list_items`
- `outsourcing_material_issues`、`outsourcing_material_issue_items`
- `outsourcing_material_supplements`、`outsourcing_material_return_items`
- `outsourcing_completion_notices`、`outsourcing_completion_notice_items`
- `outsourcing_inspections`
- `outsourcing_receipts`、`outsourcing_receipt_items`
- `outsourcing_cost_evidences`
- `outsourcing_finished_returns`、`outsourcing_finished_return_items`
- `outsourcing_wip_transfers`
- `outsourcing_period_closings`、`outsourcing_period_opening_records`

#### Additive Columns (existing tables)

- `suppliers`：`procurement_enabled / outsourcing_enabled / supplier_category / qualification_status / qualification_valid_from / qualification_valid_to / default_payment_terms_days / default_currency / supplier_wip_warehouse_id / outsourcing_qualification_note`
- `purchase_orders`：`business_type ('STANDARD_PURCHASE'|'OUTSOURCE_PROCESSING') NOT NULL DEFAULT 'STANDARD_PURCHASE'` / `source_outsourcing_order_id NULLABLE` / `is_gift_default` / `pricing_discount_scheme_id` / `price_source` / `discount_source` / `buyer_id` / `purchasing_group_id` / `settlement_supplier_id` / `payee_supplier_id` / `delivery_schedule_fingerprint`
- `purchase_order_items`：`is_gift_line / pricing_discount_scheme_id / source_price_list_version / schedule_id_default`
- `purchase_receipts`：`source_notice_id / delivery_schedule_id / po_change_id`
- `purchase_returns`：`return_request_id / billing_mode_branch / billed_quantity / unbilled_quantity`
- `receipt_notices`：`business_type ('STANDARD_PURCHASE'|'OUTSOURCE_PROCESSING') NOT NULL DEFAULT 'STANDARD_PURCHASE'`
- `supplier_bills`：**不**新增 header-level `source_outsourcing_receipt_id` FK；header 维持单一 supplier_id + 商业上下文；保留既有列；新增 `commercial_context_json`（contract snapshot，仅 audit）
- `supplier_bill_items`：通用源字段 `source_type` / `source_id` / `source_item_id`（兼容既有 `purchase_receipt_item_id` FK 列）；additive 列 `source_outsourcing_receipt_item_id NULL` + `source_outsourcing_po_line_id NULL`（仅当 `source_type='OUTSOURCING_RECEIPT_ITEM'` 时 non-null）；additive audit 列 `source_outsourcing_receipt_id`
- `warehouses`：`supplier_id NULL` / `is_supplier_wip INTEGER NOT NULL DEFAULT 0` / `outsourcing_use_only INTEGER NOT NULL DEFAULT 0`
- `product_uom_conversions`：保留（无需新增）
- `tax_codes`：保留（无需新增）
- `planning_outsource_handoffs`：保留；新增列 `status ('PENDING'|'CONSUMED')`、`target_outsourcing_order_id NULLABLE` (FK)、`consumed_at`、`consumed_by`

#### Indexes / Unique Constraints

- UNIQUE `procurement_parameters(id='DEFAULT')` — singleton；
- UNIQUE `buyer_memberships(buyer_id, purchasing_group_id)`；
- UNIQUE `source_list_entries(supplier_id, product_id, source_type, version)`；
- UNIQUE `quota_assignments(supplier_id, product_id, source_type, version)`；
- UNIQUE `sourcing_decision_allocations(decision_id, source_list_entry_id)`；
- UNIQUE `purchase_price_list_entries(supplier_id, product_id, source_type, pricing_uom_code, version)`；
- UNIQUE `pricing_discount_schemes(supplier_id, product_id, source_type, version)`；
- UNIQUE `po_delivery_schedule(po_line_id, sequence_no)`；
- UNIQUE `receipt_notice_items(notice_id, po_line_id)`；
- UNIQUE `return_request_items(request_id, source_line_id)`；
- **UNIQUE `outsourcing_orders(planning_handoff_id)`** — canonical exactly-once；
- UNIQUE `outsourcing_orders(outsourcing_no)`；
- UNIQUE `outsourcing_material_lists(outsourcing_order_id, version)`；
- UNIQUE `outsourcing_receipts(outsourcing_no)`；
- INDEX `supplier_bill_items(commercial_source_type, commercial_source_item_id, bill_status)` — 支持 billable reservation SUM 查询（不强制 UNIQUE，因为 partial billing 是合法的；详见 §26.20）；
- INDEX `outsourcing_receipt_items(outsourcing_order_id)` / `outsourcing_material_list_items(outsourcing_order_id, line_no)` / `outsourcing_cost_evidences(outsourcing_receipt_id)` / `planning_outsource_handoffs(status, target_outsourcing_order_id)` / `purchase_orders(business_type)` / `receipt_notices(business_type)` / `vmi_agreements(supplier_id, warehouse_id, product_id, business_date_start)` / `vmi_consumptions(agreement_id, business_date)`。

#### SQLite / MySQL parity

- 所有 migration additive；`CREATE TABLE/INDEX IF NOT EXISTS`；缺列才 add；
- `safeAddColumn` 模式（参考 `engineering-reference-schema.js`）；
- `readMySqlColumnNames` + `readMySqlIndexNames` 复用 §23.15 root cause fix；禁止 driver-native casing 依赖；
- `ALTER TABLE` 重复 idempotent try/catch；
- Snapshot table（`purchase_price_list_versions` / `source_list_versions` / `outsourcing_material_lists`）使用 structured row（不依赖 generic JSON blob）；
- id generation 一律 `randomUUID()` / `genId()`（不混用 driver-native IDENTITY）；
- canonical SQLite snapshot 保持与 MySQL reconciliation 一致；
- 不 DROP legacy table（`purchase_orders` / `purchase_order_items` / `purchase_receipts` / `purchase_returns` / `purchase_discounts` / `planning_outsource_handoffs` 等）。

### 26.25 Transaction / Concurrency / Idempotency

| Operation | Lock Rows | Validate | Write | Side Effects | Commit |
|---|---|---|---|---|---|
| Sourcing apply | PR line + source_list_entry rows + quota_assignment rows | effectivity / qualification / quantity conservation | sourcing_decision + allocations + PR remaining update | none | yes |
| PR→PO convert | PR line + PO line drafts | remaining / pricing / source | PR conversion log + PO draft + PO line items | none | yes |
| PO Change apply | PO line + po_changes row + po_change_items + po_delivery_schedule | not-below-received + commercial | po_changes APPLIED + PO line update + audit | PO snapshot frozen | yes |
| Receipt Notice convert | Notice + Notice items + PO line (schedule if applicable) | not-exceed-notified-remaining | notice status POSTED | none (no inventory/GRNI/AP) | yes |
| Receipt confirm | PO line + receipt_notice_id + po_delivery_schedule + receipt_items | billing mode + remaining + commercial + IQC | receipt POSTED + inventory + valuation + GRNI/AP | inventory/valuation/GRNI/AP per chain | yes |
| Return Request post | source line | source existence + quantity cap | return_requests POSTED | none | yes |
| Purchase Return 4-branch confirm | return header + receipt + supplier_bill_items | billing mode + billed_qty + split | return POSTED + 1-2 vouchers (GRNI/AP) + AP credit + inventory reversal | inventory/valuation/GRNI/AP | yes |
| VMI Receipt confirm | agreement + supplier_id | agreement active + supplier qualified + qty | vmi_receipts POSTED + call `receiveOwnedStock(SUPPLIER)` | owner-dim physical | yes |
| VMI Consumption confirm | agreement + supplier_id + source id | activity + qty | vmi_consumptions POSTED + call `consumeOwnedStock(SUPPLIER)` | owner-dim physical | yes |
| VMI Ownership Transfer confirm | agreement + supplier_id + source qty | pending qty + supplier_bill source status | billing | owner-dim physical + AP credit | yes |
| Planning OUTSOURCE handoff consume | handoff row (`SELECT ... FOR UPDATE`) | status PENDING + no existing `outsourcing_orders.planning_handoff_id = handoff.id` | handoff status='CONSUMED' + handoff.target_outsourcing_order_id = new_order.id + new order DRAFT (planning_handoff_id = handoff.id) | none | yes |
| Outsourcing Material Issue confirm | material_list_id + supplier_wip_warehouse_id + supplier_id | material list frozen + position + LOT/SERIAL | issue POSTED + inventory transfer + position update | inventory (location only) | yes |
| Outsourcing Material Supplement confirm | material_list_id | frozen + reason + qty | supplement POSTED + inventory transfer | inventory (location) | yes |
| Outsourcing Material Return confirm | material_list_id + supplier_id + LOT/SERIAL provenance | not-exceed-issued + provenance | return POSTED + inventory reverse transfer | inventory (location) | yes |
| Outsourcing Backflush (cumulative) | outsourcing_receipt_items + inventory_valuation_movements (read) | incremental_backflush >= 0 AND <= (net_supplied - already_backflushed) | `OUTSOURCING_BACKFLUSH` valuation movements (Supplier WIP → Internal) + cost_evidence row | inventory carrying value transfer | yes |
| Outsourcing Receipt confirm | order + processing_po + quality gate + supplier_id | order remaining + quality + processing PO business_type='OUTSOURCE_PROCESSING' + source_outsourcing_order_id = order.id | receipt POSTED + backflush + cost evidence + finished inventory | inventory + AP extension trigger | yes |
| Processing Fee Bill confirm | outsourcing_receipt_items (lock) | not-double-bill + cumulative billable qty check | supplier_bill_items source link (`source_type='OUTSOURCING_RECEIPT_ITEM'`) + supplier_bill POSTED + AP open item + cost evidence final | AP + cost evidence FINAL | yes |
| Standard Purchase Receipt confirm (re-affirmed) | purchase_orders | `business_type='STANDARD_PURCHASE'` else 409 FAIL CLOSED | receipt POSTED + inventory + valuation + GRNI/AP | inventory/valuation/GRNI/AP | yes |
| Backflush difference allocation preview | source agreement + period | qty conservation | preview_json + hash | none | preview only |
| Backflush difference allocation apply | source + period | hash match + qty conservation + system source | generated supplement/return rows + period summary | inventory (location) | yes |
| Outsourcing WIP Transfer confirm | source order + target order + LOT/SERIAL | source order position + target order compatible | transfer POSTED + inventory transfer + positions | inventory (location) | yes |
| Outsourcing Period Close | period | all orders within period + no pending transfer | period_closings frozen | none | yes |

Idempotency keys (UNIQUE on (source_type, idempotency_key))：

- `PURCHASE_RECEIPT_CONFIRM`
- `PURCHASE_RETURN_CONFIRM`
- `VMI_RECEIPT_CONFIRM`
- `VMI_CONSUMPTION_CONFIRM`
- `VMI_OWNERSHIP_TRANSFER_CONFIRM`
- `OUTSOURCING_PLANNING_HANDOFF_CONSUME`
- `OUTSOURCING_MATERIAL_ISSUE_CONFIRM`
- `OUTSOURCING_MATERIAL_SUPPLEMENT_CONFIRM`
- `OUTSOURCING_MATERIAL_RETURN_CONFIRM`
- `OUTSOURCING_RECEIPT_CONFIRM`
- `OUTSOURCING_PROCESSING_BILL_CONFIRM`
- `OUTSOURCING_WIP_TRANSFER_CONFIRM`
- `BACKFLUSH_DIFFERENCE_APPLY`

#### SQLite vs MySQL — Reuse Existing Transaction Architecture

Repository 已经具备：
- SQLite：`transaction(db, work)` helper（底层 `BEGIN IMMEDIATE`）；
- MySQL：transaction gate + `SELECT ... FOR UPDATE` row lock + retry handling；
- 通用：idempotency table + UNIQUE `(source_type, idempotency_key)`（`saveIdempotency` helper in `commercial-golive.js`）。

**Design 不引入并行 transaction system**。所有 Procurement & Outsourcing mutation 必须直接复用以上 helper；不允许 `BEGIN ... COMMIT` 裸调用与新 helper 平行。

- SQLite：`transaction(db, work)` — `BEGIN IMMEDIATE` 序列化；
- MySQL：
  - `SELECT ... FOR UPDATE` row lock on source line + schedule line + receipt + notice + handoff + agreement + order + supplier_bill_items (source_outsourcing_receipt_item_id = ?) + outsourcing_receipt_items (lock-by-source);
  - `outsourcing_orders.planning_handoff_id` UNIQUE 约束 = SQLite + MySQL 双路径 same exactly-once semantics；
  - `saveIdempotency` 复用 `commercial-golive.js` helper；key = `OUTSOURCING_PLANNING_HANDOFF_CONSUME:{handoffId}` 等；
  - atomic conditional UPDATE：`UPDATE ... WHERE status=? AND version=?`，affected rows=1 才继续；
  - deadlock retry upper bound（business transaction），仍失败 → release + 409；
- 跨后端 contract：所有 `BEGIN`/`COMMIT` 都必须包在 `transaction(db, work)` 内；不允许 client-side 直连 begin/end。

### 26.26 Testing Architecture

#### Focused (per Wave)

| Wave | 测试族 | 关注点 |
|---|---|---|
| A | `procurement-parameters.test.js` / `procurement-profiles.test.js` / `buyers.test.js` | parameter CRUD + supplier profile + buyer/group + legacy null-group |
| B | `procurement-sourcing.test.js` / `procurement-pricing.test.js` | source list / quota PROPORTIONAL / pricing discount / price adjustment no-retroactive |
| C | `procurement-pr-po.test.js` / `procurement-po-change.test.js` | PR split/merge + PO commercial snapshot + PO Change guard |
| D | `procurement-receiving.test.js` / `procurement-returns.test.js` | Receipt Notice no-side-effect + Receipt confirm + Return 4-branch voucher + Return Request |
| E | `procurement-vmi.test.js` | VMI business layer + owner-dim interface mocked fail-closed |
| F | `outsourcing-order.test.js` | handoff exactly-once + OUTSOURCE BOM resolver + lifecycle |
| G | `outsourcing-materials.test.js` | Issue/Supplement/Return/Backflush + LOT/SERIAL provenance |
| H | `outsourcing-receiving.test.js` | Completion Notice + Inspection + Receipt + Processing Fee AP extension + Cost Evidence |
| I | `outsourcing-period.test.js` | backflush diff allocation + WIP transfer + opening |
| J | `procurement-frontend-contract.test.js` / `outsourcing-frontend-contract.test.js` + acceptance scripts | Registry/API contract + 320/390/430/680 responsive |

#### Canonical Gates (per Wave)

- `pnpm test:fast` + `pnpm build` + `git diff --check` (Wave 边界)；
- 跨域 / 架构 / canonical metadata：`pnpm test` + `pnpm build` + `git diff --check`；
- Heavy / DB / MySQL：`pnpm test:heavy` + 受保护 disposable MySQL 环境 `pnpm test:mysql` + `pnpm test:mysql:concurrency`；
- release candidate：`pnpm test:all`。

#### Concurrency Cases (mandatory)

- two sourcing allocations same PR；
- two PR→PO conversions same line；
- PO Change vs Receipt (race)；
- two Notices same remaining PO qty；
- two Receipts same remaining PO qty；
- Receipt return vs billing (race)；
- **two handoff consumers same handoff → exactly one Outsourcing Order (UNIQUE plan_handoff_id + row lock)**；
- **cancel consumed order → handoff remains CONSUMED, target_outsourcing_order_id still set (audit)**；
- two outsource material issues；
- two outsource receipts (same order, different qty)；
- **two processing bills race on same receipt_item → cumulative already_billed_reserved (over {DRAFT, WAITING_MATCH, POSTED}) guards no overbilling (NO partial unique)**；
- **one Supplier Bill containing multiple Outsourcing Receipt Items (A + B + C)** + canonical cumulative billable check；
- two VMI ownership transfers；
- **Backflush cumulative target race — partial receipt × 2**：
  - Receipt 1 confirmed = 30 → cumulative target = 60, incremental 60；
  - Receipt 2 confirmed = 20 → cumulative target = 100, already 60, incremental 40；
  - **Never re-backflush full order requirement**；
- **Backflush supplement + scenario** — verified Supplement correctly counted；
- **Backflush insufficient supplier-WIP** → FAIL CLOSED `BACKFLUSH_INSUFFICIENT_SUPPLY`；
- **Backflush LOT/SERIAL provenance** — identity preserved end-to-end；
- **OUTSOURCE_PROCESSING PO → ordinary Purchase Receipt → BLOCKED (409 `PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE`)**；
- **STANDARD_PURCHASE PO → Outsourcing Receipt → BLOCKED (409)**；
- **OUTSOURCE_PROCESSING PO → Planning BUY supply → EXCLUDED**（MRP / Workbench / Reservation）；
- **OUTSOURCE_PROCESSING PO → cross-order processing fee → BLOCKED**；
- Backflush difference allocation preview/apply race；
- Outsourcing WIP Transfer vs new Issue race；
- Period close vs confirm Receipt race；
- 12 critical sections per `document.md §31.8.E`。

### 26.27 Implementation Waves and Gates

**Wave A — Procurement Foundation** (PRC-01/02/03)：parameters + supplier profile + buyers + purchasing groups；schema + migration + focused tests + RBAC seed update + current route adapter。

**Wave B — Sourcing & Pricing** (PRC-04/05/06/07/08/09/10)：source list + quota allocator + sourcing decision + price list + pricing UOM extension + pricing discount + price adjustment；no retroactive invariant；focused + heavy gates。

**Wave C — PR / PO Governance** (PRC-11/12/13/14)：PR source trace + split/merge + PO commercial snapshot + delivery schedule + prepayment requirement + PO Change；focused + heavy + MySQL。

**Wave D — Receiving / Return** (PRC-15/16/19/20/21/22/24/25/26)：Gift + delivery schedule enforcement + canonical PO execution view (converge MRP/Workbench/Reservation/Receiving) + Receipt Notice + IQC source-type extension + Purchase Receipt 4-branch billing + Return Request + Purchase Return 4-branch voucher refactor + Procurement Scan；focused + heavy + MySQL + MySQL concurrency；本 Wave 是收敛点，所有 consumer 必须切换到 canonical view。

**Wave E — VMI Bounded Business Layer** (VMI-01~05)：VMI business documents + owner-dimension interface mocked fail-closed；policy / summary 独立工作；physical mutation 部分等 Inventory Domain owner dimension；focused + heavy。

**Wave F — Outsourcing Foundation** (OUT-01/02/03/04/05/06/07/08/09)：outsourcing profile + source list + processing price + supplier WIP warehouse + planning handoff consumption (exactly-once) + Outsourcing Order + lifecycle (PLAN_CONFIRMED/RELEASED/COMPLETED/CLOSED + DRAFT/CANCELLED) + OUTSOURCE BOM consumption + material list snapshot；focused + heavy + MySQL。

**Wave G — Outsourcing Materials** (OUT-11/12/13/14/15/16)：Issue / Supplement / Return / Backflush + supplier WIP warehouse binding + LOT/SERIAL provenance；focused + heavy + MySQL + MySQL concurrency。

**Wave H — Outsourcing Receiving / Finance Handoff** (OUT-17/18/19/20/21/22)：Completion Receipt Notice + Inspection + Outsourcing Receipt + Processing Fee AP extension (canonical Supplier Bill source-type) + Cost Evidence (consumed carrying value + processing fee) + Finished Return；focused + heavy + MySQL + MySQL concurrency。

**Wave I — Period / WIP / Opening / Reports** (OUT-23)：backflush difference allocation + WIP transfer + opening + execution summary + material issue summary；focused + heavy。

**Wave J — UI / Convergence** (PRC-26 + UI IA + cross-cutting)：UI 工作面与 launcher 收敛 + 320/390/430/680 验收 + read model + analytics；focused + heavy + MySQL + acceptance scripts。

每 Wave 完成后：

- `pnpm test:fast` + `pnpm build` + `git diff --check`；
- 涉及 MySQL 时 `pnpm test:mysql` + `pnpm test:mysql:concurrency`（受保护 disposable 环境）；
- Wave D 完成后 running `pnpm test` + `pnpm test:heavy` 必须稳定；
- Wave H 完成后 final closure candidate。

### 26.28 Rollback / Deployment Safety

- 所有 migration additive；不 DROP legacy table；不重命名既有 release tag；
- `default_receipt_billing_mode` 默认值变更仅影响新业务；LEGACY_DIRECT 历史 Receipt 保留原值（兼容）；
- 参数变化不反写历史已批准/已执行单据；
- 任何变更触发的 `legacy null` 兼容性必须 fail-closed：缺新字段 → 视为 nullable 旧逻辑 path；
- 不使用 destructive down-migrate；rollback 以应用代码回退 + 新增结构停止写入；
- 不进入 production database 验证；MySQL destructive test 只在显式 disposable/test database + reset guard；
- 不破坏既有 route key / API method/path/request/response；
- 不重写 Inventory / Quality / AP / GL / Period Close backbone。

### 26.29 Explicit Reused Canonical Owners

- Purchase Order core lifecycle：`server/modules/procurement-orders.js` EXTEND 既有；
- Purchase Receipt execution：`server/modules/procurement-receiving.js` EXTEND 既有 + 既有 `commercial-golive.js::autoBillReceipt`；
- IQC：`server/modules/quality-gates.js` + `authoritative-quality.js` + `manufacturing-quality.js` source-type extension；**不**新建 Quality engine；
- LOT / SERIAL：`server/lib/stock.js` + `traceability-quality.js`；**不**新建 tracking engine；
- Inventory mutation：`server/lib/stock.js::adjustInventory` + `financial-inventory.js::receiveValue` / `issueValue`；
- Inventory valuation：`server/modules/financial-inventory.js::allocateProportionalCents` + `createSystemVoucher`；
- Supplier Bill / AP / GRNI：`server/modules/settlement-core.js::ensureSubledger` + `applyCreditAdjustment` + `commercial-golive.js::createSupplierBill`；
- Tax codes / tax snapshot：`server/modules/commercial-golive.js::taxSnapshot`；
- UOM conversion：`server/modules/commercial-golive.js::conversionSnapshot` + `quantitySnapshot` + `rational()`；**不**建立第二 UOM engine；
- Approval：`server/modules/approvals.js`；`PURCHASE_ORDER` family；OUTSOURCE_OUTSOURCING_ORDER optional future family；
- Planning BUY / OUTSOURCE handoff：`server/modules/planning-domain.js::releasePlannedOrder` write `planning_outsource_handoffs`；本 Domain exactly-once consumer；
- Engineering OUTSOURCE BOM：`server/modules/engineering-configurable-bom.js::resolveEffectiveBomForCaller`；
- Production Instruction / Purchase Instruction bridge：`server/modules/planning-documents.js` KEEP；PR 自有 lifecycle 与本 Domain 新模块对接。

### 26.30 Explicitly NOT Implemented

- Multi-Organization；
- Multi-Currency；
- 完整 B3105 PDA / camera SDK / label printing / generic PDA platform；
- Finance engine rewrite（重写 Supplier Bill / AP / GRNI / Payments / Cost）；
- Inventory ledger rewrite（含 invasive owner-dimension 改造）；
- Generic Workflow redesign；
- destructive data rewrite / DROP historical table / database reset；
- 完整 Operation Outsourcing handoff lifecycle（普通产品委外由 OUT-01~23 主线；operation outsource 后续 bounded）；
- retroactive rewrite 历史 approved PO / Receipt / Bill / AP（PRC-10 硬性禁止）；
- Standard Outsourcing 复用 VMI ownership semantics；
- enterprise-supplied material 入 OUT-10 PO line（processing fee only）；
- supplier-owned finished stock 通过 OUT-19 建模为 VMI-style ownership transfer；
- Lower-tolerance auto-close algorithm（`SOURCE_DETAIL_INSUFFICIENT` 留作 extension point）；
- Kingdee complex discount formula（`SOURCE_DETAIL_INSUFFICIENT` 留作 extension point）；
- 跨组织委外 / 跨组织 Supplier（OUT_OF_SCOPE）。

### 26.31 Design Review Checklist

- [x] No second Inventory truth；
- [x] No second AP truth；
- [x] No second Quality truth；
- [x] No second BOM resolver；
- [x] No second MRP engine；
- [x] VMI owner semantics correct（Standard Outsourcing = enterprise owned at supplier WIP location；VMI = supplier owned at enterprise site）；
- [x] Outsourcing ownership correct（enterprise-owned throughout）；
- [x] GRNI direction correct（LEGACY_DIRECT Dr Inventory / Cr AP；SEPARATE Receipt Dr Inventory / Cr GRNI；SEPARATE Bill Dr GRNI (+ Input Tax Receivable) / Cr AP；AUTO_BILL atomic）；
- [x] Purchase Return branching complete（4-branch: LEGACY_DIRECT / SEPARATE unbilled / SEPARATE billed / partially billed deterministic split billed-first）；
- [x] Outsourcing cost = consumed value + processing fee（不把 issued-but-unused / returned / supplier-WIP remaining 计入）；
- [x] PO Reservation supply converged by design（canonical PO execution view = single source）；
- [x] PRC IDs preserved (PRC-01~26)；
- [x] OUT IDs preserved (OUT-01~23)；
- [x] VMI IDs preserved (VMI-01~05)；
- [x] 54-capability trace preserved (49 domain-owned + 5 integration-backed)；
- [x] Cross-domain dependency recorded as metadata, not capability disposition。

---

**PROCUREMENT & OUTSOURCING DOMAIN CLOSURE DESIGN — READY FOR USER REVIEW**

### 26.32 Definitive Final Acceptance Implementation Reconciliation（2026-10-09）

已实现并验证的 Finance handoff：

- `confirmOutsourcingReceipt` 原子写入 `outsourcing_cost_evidences` provisional evidence；材料值只取 receipt-specific backflush consumed carrying value，不包含 issued-but-unused / returned / supplier-WIP remaining；
- `postProcessingFeeBill` 复用 `ensurePayableSource`，按 canonical `supplier_bill_items.commercial_source_*` 聚合 POSTED actual fee，刷新 actual / variance / basis status；
- `createFinishedReturn` 在 transaction 中重读累计退货数量；unbilled 不写 AP credit，billed 按 POSTED bill item 可贷数量确定性分配，并复用 `createCommercialCreditNote` → `applyCreditAdjustment`；`outsourcing_finished_return_credits` 保存 return → bill item → credit note trace；
- Purchase Return 四分支测试直接查询 `accounting_vouchers` / `accounting_entries` / role mapping，固定真实 debit/credit 方向与金额；
- SQLite focused 12 files 48/48 PASS；disposable MySQL 8 integration / concurrency / performance PASS；responsive 28/28 PASS。

Functional Browser UAT 尚有 3 个 Design-to-Implementation gap，故当前 Design acceptance 不得勾选 Freeze：

1. Planning handoff consumer 只依赖 `outsourcing_orders.planning_handoff_id UNIQUE`，未锁定、验证并将 authoritative upstream handoff 从 `PENDING` 转为 accepted/consumed；
2. `outsourcing_completion_notices` 及其 executable route/lifecycle 未落地；
3. canonical Quality owner 尚未暴露 `OUTSOURCING_RECEIPT` inspection create/complete contract。

Final verdict：`NOT READY`。后续修复必须继续遵守本节既有 source/transaction/RBAC/audit/SQLite+MySQL 设计，不得以 ordinary Purchase Receipt/IQC 的假成功替代。

---

## 27. Inventory & Warehouse Domain Technical Design

> 本节固化 Inventory & Warehouse Domain Closure 的 Design 阶段成果。Requirement 见 `document.md §32`；Audit 见本次会话的 `INVENTORY & WAREHOUSE DOMAIN FINAL AUDIT REPORT`（`PASS`）。Manual Evidence Baseline 来自上游已批准的 `B3104 库存管理` + `B3105 条码管理`（Inventory/Warehouse 所属能力）。
>
> 本节不进入 Implementation / Migration / API / UI / Test；仅按 §27.1–§27.28 形成可实施技术方案，等待用户 `DESIGN PASS`。

### 27.1 Architecture / Ownership

`server/app.js` 仍承担 HTTP route + auth + thin dispatch。Inventory & Warehouse Domain 的业务逻辑按 canonical identity / mutation contract / source-target identity / transaction ownership / testability 拆分到以下模块：

```text
server/lib/inventory-position.js       (NEW, Wave A)
  canonical physical position identity;
  position_key deterministic hash;
  legacy warehouse+product read compatibility;

server/lib/inventory-mutation.js       (NEW, Wave B)
  single authoritative mutation service contract;
  applyInventoryMutation(...) dispatcher;
  atomic transaction with full validation;

server/lib/inventory-availability.js   (NEW, Wave B)
  ON_HAND / LOCKED / RESERVED / AVAILABLE projection;
  position-level + planning-level;
  reads canonical positions + active locks + active reservations;

server/modules/inventory-parameters.js       (NEW, Wave A)
server/modules/warehouse-master.js           (NEW, Wave A; EXTEND existing warehouse CRUD)
server/modules/warehouse-bin.js              (NEW, Wave A)
server/modules/stock-status.js               (NEW, Wave A)
server/modules/owner-dimension.js            (NEW, Wave A; UNBLOCKS VMI/Outsourcing)
server/modules/inventory-transfer.js         (NEW, Wave B; EXTEND existing transfer)
server/modules/inventory-step-transfer.js    (NEW, Wave B)
server/modules/inventory-lock.js             (NEW, Wave B)
server/modules/inventory-availability.js     (NEW, Wave B; thin wrapper)
server/modules/inventory-opening.js          (NEW, Wave C)
server/modules/inventory-native-document.js (NEW, Wave C; OTHER_RECEIPT/OTHER_ISSUE)
server/modules/inventory-stock-status-mutation.js (NEW, Wave C)
server/modules/inventory-lot-adjustment.js  (NEW, Wave C)
server/modules/inventory-form-conversion.js  (NEW, Wave C)
server/modules/inventory-assembly-disassembly.js (NEW, Wave C; consumes Engineering BOM)
server/modules/inventory-adjustment-scrap.js     (NEW, Wave C; convergence of existing)
server/modules/inventory-stocktake.js        (NEW, Wave C; EXTEND existing inventory_checks)
server/modules/inventory-barcode.js          (NEW, Wave D)
server/modules/inventory-scan-adapter.js     (NEW, Wave D)
server/modules/inventory-container.js        (NEW, Wave D)
server/modules/inventory-reports.js          (NEW, Wave D; aggregates + ledger + aging + alerts)
server/modules/inventory-period-close.js     (EXTEND, Wave D)
```

保留既有（**不得重写**，仅 EXTEND / INTEGRATE）：

- `server/lib/stock.js::adjustInventory` — 在 §27.43.1 Atomic Legacy Cutover 之前，**不得**作为通用 inventory writer；activation gate 之后必须替换为 `applyInventoryMutation` 或降级为 compatibility adapter（仅 ENTERPRISE owner + AVAILABLE + NULL bin + no tracking）；
- `inventory_mutation.js::applyInventoryMutation` — 唯一 canonical inventory writer（§27.6 / §27.8 / §27.43.1）；
- `server/db.js::PERMISSIONS` — additive 扩展 `INVENTORY_*` family（不重命名既有权限）；
- `server/db.js::PERMISSIONS` — additive 扩展 `INVENTORY_*` family（不重命名既有权限）；
- `server/lib/audit.js` — 复用；
- `server/lib/http.js` — 复用；
- `server/lib/payment-terms.js` — 与本 Domain 无关，保留；
- `server/modules/financial-inventory.js::receiveValue / issueValue / allocateProportionalCents / createSystemVoucher / inventoryAccountRole / assertFinancialPeriodsOpen` — 复用为 Finance/Inventory Costing canonical valuation evidence；
- `server/modules/inventory-extensions.js`（Inventory Scrap） — 收敛到 mutation contract；
- `server/modules/inventory-period-close.js` — EXTEND；
- `server/modules/traceability-quality.js` — LOT/SERIAL canonical 不重写；
- `server/modules/procurement-vmi.js` — 删除 `assertInventoryOwnerDimension` 阻断；VMI 物理层改经 `owner-dimension.js`；
- `server/modules/outsourcing-materials.js` — Issue/Supplement/Return/Backflush 改经 `inventory-mutation.js`，保持 canonical Outsourcing Order semantics；
- `server/modules/planning-domain.js` — Reservation 不变；Inventory 通过 `inventory-availability.js` 读 reservation 形成 projection，不复制 reservation engine；
- `server/modules/engineering-bom.js` / `engineering-configurable-bom.js` — INV-17 Assembly/Disassembly 消费 Engineering resolver；
- `server/modules/quality-gates.js` / `authoritative-quality.js` — 触发 stock-status mutation 但不复制 Quality inspection decision。

### 27.43.2 Runtime Writer Convergence (2026-10-10 closing pass)

`server/lib/stock.js::adjustInventory` is the strict-canonical compatibility adapter
for legacy physical writers. It is now:

- bound to the frozen default identity (owner=ENTERPRISE, owner_id=NULL,
  stock_status=AVAILABLE, bin=NULL, lot=NULL, serial=NULL);
- executed as `ON CONFLICT(position_key) DO UPDATE` (never
  `ON CONFLICT(warehouse_id, product_id)`);
- refusing to operate on bin-enabled warehouses or LOT/SERIAL-tracked
  products, returning a clear 400 error instructing the caller to migrate
  to `applyInventoryMutation`.

A sibling `setInventoryQuantity(...)` is the strict-absolute writer for
inventory check approval, lifecycle cleanup, opening batch, and return
reversal — it writes at the same canonical default position and refuses
non-default identities.

All five direct `UPDATE inventory` / `INSERT INTO inventory` writers in
production code are converged:

- `server/app.js:3621` confirmInventoryCheck          → setInventoryQuantity
- `server/modules/financial-controls.js:331-32` reverseSalesOrPurchaseReturn → setInventoryQuantity + SUM read
- `server/modules/lifecycle-engine.js:805` applyInventoryCleanup → setInventoryQuantity
- `server/modules/outsourcing-finance.js:130/274` outsourcing receipt / return → adjustInventory
- `server/modules/commercial-golive.js:269` postOpening → setInventoryQuantity

Read paths in the reversal logic (`server/app.js:3890`) and the outsourcing
finance writes now `SELECT COALESCE(SUM(quantity),0) ... AND active=1` so
that a future bin/lot split cannot silently lose stock.

`server/lib/inventory-mutation.js::applyInventoryMutation` now detects
whether an outer `transaction()` is already open and skips its own
`transaction(...)` wrapper. This unblocks the Wave E owner-dimension flows
(VMI receipt / consumption / ownership transfer) which are routed through
the dispatcher from inside an outer `transaction(...)`.

The single canonical test fixture writer is
`server/test-support/inventory-canonical-fixture.js::upsertCanonicalInventory`.
It writes with `ON CONFLICT(position_key) DO UPDATE` and accepts an
optional `rowId` for tests that query by id. All 11 test files that
inserted inventory rows with raw SQL are migrated to this helper.

The demo seed in `server/db.js::seedDemoData` now writes explicit `id`
values for inventory rows. The `position_key` migration backfill still
populates `position_key` for these rows at first createDatabase run;
the explicit id is required so that subsequent position-key aware
updates can find the row by id (TEXT PRIMARY KEY has no auto-increment).

### 27.2 Canonical Inventory Identity

最终 physical inventory position identity 由以下维度构成：

```text
product_id        (NOT NULL, FK products.id)
warehouse_id      (NOT NULL, FK warehouses.id)
bin_id            (NULLABLE, FK warehouse_bins.id; 仅 bin-enabled warehouse)
owner_type        (NOT NULL, CHECK IN ('ENTERPRISE','SUPPLIER','CUSTOMER'))
owner_id          (NULLABLE if ENTERPRISE singleton; else FK polymorphic)
stock_status      (NOT NULL, FK inventory_stock_statuses.code)
lot_id            (NULLABLE, FK inventory_lots.id; 仅 LOT tracking)
serial_id         (NULLABLE, FK inventory_serials.id; 仅 SERIAL tracking)
```

每维定义：

| 维度 | nullable? | required? | canonical owner | validation source |
|---|---|---|---|---|
| product_id | NO | YES | Master Data | products.active=1 |
| warehouse_id | NO | YES | Inventory (warehouse master) | warehouses.active=1 |
| bin_id | YES | 仅当 `warehouse.bin_enabled=1` | Inventory (warehouse_bin) | warehouse_bins.active=1 AND warehouse_id match |
| owner_type | NO | YES | Inventory (owner_dimension) | enum check |
| owner_id | YES | ENTERPRISE = NULL；SUPPLIER / CUSTOMER = required | Inventory (polymorphic) | suppliers.active=1 / customers.active=1 |
| stock_status | NO | YES，默认 `AVAILABLE` | Inventory (stock_status) | inventory_stock_statuses.active=1 |
| lot_id | YES | 仅当 `product.tracking_policy='LOT'` 或 `'SERIAL'` | Tracking (inventory_lots) | inventory_lots.product_id match |
| serial_id | YES | 仅当 `product.tracking_policy='SERIAL'` | Tracking (inventory_serials) | inventory_serials.product_id match |

Enterprise singleton：owner_type='ENTERPRISE' 时 owner_id 必须为 NULL（不得伪装为 ENTERPRISE+某 id）。

必须支持的 4 种 owner × warehouse 组合：

```text
Enterprise-owned @ Enterprise warehouse
Enterprise-owned @ Supplier-WIP warehouse   (warehouses.is_supplier_wip=1)
Supplier-owned   @ Enterprise warehouse     (VMI)
Customer-owned   @ Enterprise warehouse     (entrusted material)
```

### 27.3 position_key — Portable Unique Identity

不依赖 `UNIQUE(nullable_col_1, nullable_col_2 ...)`。SQLite / MySQL 的 NULL uniqueness 行为不可移植。

采用规范化 position_key：

```text
position_key = SHA-256(
  normalize(product_id)              + '|'
  + normalize(warehouse_id)          + '|'
  + 'BIN:'     + (bin_id     ?? 'NULL') + '|'
  + 'OWNER:'   + owner_type   + ':' + (owner_id ?? 'NULL') + '|'
  + 'STATUS:'  + stock_status + '|'
  + 'LOT:'     + (lot_id     ?? 'NULL') + '|'
  + 'SERIAL:'  + (serial_id  ?? 'NULL')
)
```

规范化：

- 全部维度先 trim、ASCII 小写、长度限制（id ≤ 128 字符）；
- nullable 维度用 sentinel `'NULL'` 替换；
- 所有字符 `|` 不允许出现在 id 内部（canonical id 输入校验）；
- SHA-256 十六进制 64 字符。

约束：

```text
SQLite / MySQL deterministic (同一 tuple → 同一 hash)
collision checked (inventory.position_key UNIQUE)
index length safe (CHAR(64) 上索引；avoid TEXT PRIMARY KEY for hash)
no partial unique-index dependency
```

物理 schema mapping（index-safe）：

```text
SQLite:  position_key TEXT NOT NULL UNIQUE
         (length / lowercase-hex validation in application code)
MySQL:   position_key CHAR(64) NOT NULL UNIQUE
         (不允许 TEXT UNIQUE；CHAR(64) 提供 fixed-length index)
```

实现：`server/lib/inventory-position.js::computePositionKey(productId, warehouseId, binId, ownerType, ownerId, stockStatus, lotId, serialId)` 唯一公开函数。

Owner 输入 application-level referential validation（mutation contract 入口）：

```text
ENTERPRISE  → owner_id MUST be NULL
SUPPLIER    → owner_id MUST reference active supplier (suppliers.active=1)
CUSTOMER    → owner_id MUST reference active customer (customers.active=1)
```

违反任一 → `mutation contract` 入口 reject，不得写 inventory。

### 27.4 Canonical Physical Balance

唯一 canonical physical balance 仍由现有 `inventory` 表承载。演进方案：

- 新增 additive 列：
  ```text
  inventory.position_key       TEXT NOT NULL        (UNIQUE; MySQL CHAR(64))
  inventory.bin_id             TEXT                  (NULLABLE)
  inventory.owner_type         TEXT NOT NULL DEFAULT 'ENTERPRISE'
  inventory.owner_id           TEXT                  (NULLABLE)
  inventory.stock_status       TEXT NOT NULL DEFAULT 'AVAILABLE'
  inventory.lot_id             TEXT                  (NULLABLE)
  inventory.serial_id          TEXT                  (NULLABLE)
  inventory.active             INTEGER NOT NULL DEFAULT 1
  ```
- `inventory` 表**只**保存 physical quantity + dimensions；**不**保存 lock state；
- Lock 唯一 truth = `inventory_locks`（§27.15），与 inventory.position_key 通过 application-level aggregate 关联；
- 既有 `UNIQUE(warehouse_id, product_id)` 演进为 `UNIQUE(position_key)`；
- 既有数据 migration：见 §27.5 Legacy Migration Rules。

不建立第二套 inventory balance 表。`inventory` 仍是唯一 authoritative physical balance。

### 27.5 Legacy Migration Rules

#### NONE tracking 旧库存

```text
warehouse_id + product_id + qty
```

迁移为：

```text
owner_type   = 'ENTERPRISE'
owner_id     = NULL
stock_status = 'AVAILABLE'
bin_id       = NULL  (legacy default)
lot_id       = NULL
serial_id    = NULL
position_key = SHA-256(...)
```

新增 `(warehouse_id, product_id, position_key)` 索引保留 query compatibility。

#### LOT tracking 旧库存

```text
SUM(inventory_lot_balances.quantity)
    WHERE warehouse_id=? AND product_id=?
=
legacy inventory.quantity
```

不一致 → `FAIL CLOSED`，不得自动修平。

#### SERIAL tracking 旧库存

基于当前 `inventory_serials.current_warehouse_id` 派生 position。一条 active serial = 一个 physical unit。

`SUM(serial count)` 与 `inventory.quantity` 不一致 → `FAIL CLOSED`。

#### 历史 records

旧 `inventory_transactions` 若无 `bin / owner / status / lot / serial` 列：

- 展示时显示 `historical dimension unavailable`；
- 不允许 retroactive fabricate dimensions；
- 新 movement 必须保存完整 dimension snapshot（见 §27.6）。

### 27.6 Canonical Inventory Mutation Contract

唯一 mutation dispatcher：

```text
server/lib/inventory-mutation.js::applyInventoryMutation(input)
```

`input` 至少含：

```text
sourceType       TEXT      -- 'PURCHASE_RECEIPT' / 'PRODUCTION_RECEIPT' / 'OUTSOURCING_RECEIPT'
                              / 'SALES_DELIVERY' / 'OTHER_RECEIPT' / 'OTHER_ISSUE'
                              / 'INVENTORY_TRANSFER' / 'INVENTORY_STEP_TRANSFER_IN'
                              / 'INVENTORY_STOCK_STATUS_CHANGE' / 'INVENTORY_LOT_ADJUSTMENT'
                              / 'INVENTORY_FORM_CONVERSION' / 'INVENTORY_ASSEMBLY'
                              / 'INVENTORY_DISASSEMBLY' / 'INVENTORY_ADJUSTMENT'
                              / 'INVENTORY_SCRAP' / 'INVENTORY_STOCKTAKE_DIFF'
                              / 'VMI_RECEIPT' / 'VMI_CONSUMPTION' / 'VMI_OWNERSHIP_TRANSFER'
                              / 'OUTSOURCING_ISSUE' / 'OUTSOURCING_RETURN' / 'OUTSOURCING_RECEIPT'
                              / 'ENTRUSTED_RECEIPT' / 'ENTRUSTED_ISSUE'
                              / 'BARCODE_SCAN_CONFIRM'
sourceId         TEXT
sourceItemId     TEXT
businessDate     TEXT
actor            OBJECT
movementGroup    TEXT       -- correlation id
movementKind     TEXT       -- IN / OUT / MOVE / OWNER_CHANGE / STATUS_CHANGE / LOT_RECLASS / BIN_MOVE / ADJUSTMENT
quantity         REAL
fromPosition     OBJECT     -- {product_id, warehouse_id, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id}
toPosition       OBJECT     -- 同结构；多 destination 时数组形式
tracking         OBJECT     -- {lotAllocations:[], serialAllocations:[]}
idempotencyKey   TEXT       -- UNIQUE
```

返回：

```text
movementId        TEXT
movementGroupId   TEXT
balanceAfter      OBJECT     -- 每个 position_key 的新 on_hand
inventoryTransactions[]  -- 写入的 inventory_transactions rows
trackedMovements[]       -- 写入的 tracked_inventory_movements rows
audit             OBJECT
```

Movement kinds 与对应实现：

| Movement | Source types | 语义 |
|---|---|---|
| IN | PURCHASE_RECEIPT / PRODUCTION_RECEIPT / OUTSOURCING_RECEIPT / OTHER_RECEIPT / VMI_RECEIPT / ENTRUSTED_RECEIPT | toPosition.quantity ↑ |
| OUT | SALES_DELIVERY / PRODUCTION_ISSUE / OUTSOURCING_ISSUE / OTHER_ISSUE / VMI_CONSUMPTION / ENTRUSTED_ISSUE / INVENTORY_SCRAP | fromPosition.quantity ↓ |
| MOVE | INVENTORY_TRANSFER / INVENTORY_STEP_TRANSFER_IN | fromPosition ↓ + toPosition ↑；tracking identity 守恒 |
| OWNER_CHANGE | VMI_OWNERSHIP_TRANSFER / OUTSOURCING_RECEIPT_FG_OWNER | fromPosition ↓ + toPosition ↑；location 不变 |
| STATUS_CHANGE | INVENTORY_STOCK_STATUS_CHANGE | fromPosition ↓ + toPosition ↑；quantity / location / owner 守恒 |
| LOT_RECLASS | INVENTORY_LOT_ADJUSTMENT | fromPosition ↓ + toPosition ↑；total quantity 守恒 |
| BIN_MOVE | INVENTORY_BIN_MOVE | fromPosition ↓ + toPosition ↑；owner / status / lot / serial 守恒 |
| ADJUSTMENT | INVENTORY_ADJUSTMENT / INVENTORY_STOCKTAKE_DIFF | fromPosition 或 newPosition 单边；记录 diff 原因 |

Movement evidence 物理方向强制不变（与既有 `inventory_transactions` / `tracked_inventory_movements.direction` 兼容）：

```text
tracked_inventory_movements.direction    = 'IN'  | 'OUT'    (NOT 'MOVE')

业务 mutation 类型通过：
  tracked_inventory_movements.movement_kind     = IN | OUT | MOVE | OWNER_CHANGE
                                                | STATUS_CHANGE | LOT_RECLASS
                                                | BIN_MOVE | ADJUSTMENT
  tracked_inventory_movements.movement_group_id = G_uuid
```

对 paired mutation（MOVE / BIN_MOVE / OWNER_CHANGE / STATUS_CHANGE / LOT_RECLASS）：

```text
source position row:      direction = OUT   movement_kind = <业务类>   movement_group_id = G_new
destination position row: direction = IN    movement_kind = <业务类>   movement_group_id = G_new
```

同一 transaction 内提交；quantity 守恒；position_key 来自 toPosition / fromPosition。


### 27.7 Mutation Atomicity

一次 mutation transaction 内顺序：

```text
1. assertFinancialPeriodsOpen(businessDate)             -- §27.16
2. validate master dimensions
   - product / warehouse / bin / owner / status / lot / serial 全部存在且 active
3. validate owner reference
   - SUPPLIER → suppliers.active=1
   - CUSTOMER → customers.active=1
   - ENTERPRISE → owner_id must be NULL
4. validate tracking
   - LOT product 必须传 lotAllocations
   - SERIAL product 必须传 serialAllocations
   - NONE product 不得传 tracking
5. lock source position via SELECT ... FOR UPDATE (MySQL) / BEGIN IMMEDIATE (SQLite)
   - 锁顺序见 §27.17
6. validate available physical quantity
   - read current on_hand at fromPosition
   - for OUT / MOVE / OWNER_CHANGE: fromPosition.quantity ≥ requested
   - for IN / status change into new status: toPosition must be valid
   - for OWNER_CHANGE: 必须先 read 当前 owner，确认 requested transition 合法
7. apply canonical inventory
   - per fromPosition: UPDATE inventory SET quantity = quantity - x WHERE position_key = ?
   - per toPosition: UPSERT position_key SET quantity = quantity + x
   - LOT/SERIAL: post tracked_inventory_movements + tracked_source_allocations
   - in-transit: write inventory_step_transfer_in_transit 表
8. write inventory_transactions row(s)
   - business_date / source_type / source_id / source_item_id / direction / balance_after / quantity_change / position_key
9. invoke existing valuation integration
   - financial-inventory.js::receiveValue / issueValue (cents, INTEGER safe)
10. audit
    - audit(actor, 'INVENTORY_MUTATION', sourceType/sourceId, payload)
11. commit
```

任一失败 → `zero side effects`（事务整体 rollback）。

并发安全：

- 同一 `(sourceType, sourceId, sourceItemId, idempotencyKey)` 二次提交 → 返回已有 movementId，不重复写（**portable**：直接 plain UNIQUE on idempotency_key）；
- tracked movement 是 mutation subordinate evidence：
  - 不使用 MySQL-incompatible partial unique index（`WHERE reversed=0`）；
  - 使用普通 composite UNIQUE：`UNIQUE(movement_id, allocation_identity)` 或 `UNIQUE(source_type, source_id, source_item_id, lot_id, serial_id, direction)`（无 `WHERE` 子句）；
  - reversal 通过显式 `reversal_of_movement_id` 关系 + 新的 reversal movement 表达，**不**依赖 partial unique index；
- 同一 position 多次 mutation 由 row-lock 串行化。

### 27.8 No Direct Inventory Writes

Implementation closure 后，新业务代码不得直接 `UPDATE inventory SET quantity = ?`。

只有以下调用方允许写 inventory：

```text
server/lib/inventory-mutation.js::applyInventoryMutation   (唯一入口)
server/lib/stock.js::adjustInventory                        (binary compatible wrapper, 由 migration period 收敛)
server/lib/stock.js 仅作为短时兼容 wrapper 保留，内部调 applyInventoryMutation
```

既有冻结域（Procurement / Sales / Manufacturing / Outsourcing / Planning / Quality）通过 adapter 接入：

```text
Procurement Receipt       → applyInventoryMutation(IN)
Production Receipt        → applyInventoryMutation(IN)
Sales Delivery            → applyInventoryMutation(OUT)
Production Material Issue → applyInventoryMutation(OUT)
Outsourcing Material Issue → applyInventoryMutation(OUT, owner ENTERPRISE, location supplier-WIP)
Outsourcing Receipt       → applyInventoryMutation(IN, owner ENTERPRISE, location enterprise warehouse)
VMI Receipt               → applyInventoryMutation(IN, owner SUPPLIER, location enterprise warehouse)
VMI Consumption           → applyInventoryMutation(OUT, owner SUPPLIER, location enterprise warehouse)
VMI Ownership Transfer    → applyInventoryMutation(OWNER_CHANGE)
Entrusted Receipt         → applyInventoryMutation(IN, owner CUSTOMER, location enterprise warehouse)
Entrusted Issue           → applyInventoryMutation(OUT, owner CUSTOMER)
Inventory Scrap           → applyInventoryMutation(OUT, ADJUSTMENT-like)
Inventory Adjustment      → applyInventoryMutation(ADJUSTMENT)
Stocktake Difference      → applyInventoryMutation(ADJUSTMENT, INVENTORY_STOCKTAKE_DIFF)
Direct Transfer           → applyInventoryMutation(MOVE)
Step Transfer Out         → applyInventoryMutation(OUT, intoStepTransferInTransit=true)
Step Transfer In          → applyInventoryMutation(IN, fromStepTransferInTransit)
Status Change             → applyInventoryMutation(STATUS_CHANGE)
Lot Adjustment            → applyInventoryMutation(LOT_RECLASS)
Bin Move                  → applyInventoryMutation(BIN_MOVE)
Form Conversion           → applyInventoryMutation(MOVE / ADJUSTMENT, by conversion type)
Assembly / Disassembly    → applyInventoryMutation(MOVE) consumed components + produced parent
```

不重写既有的 Procurement / Sales / Production / Outsourcing / Planning / Quality business document。Adapter 只在 mutation contract 接入点替换。

### 27.9 Warehouse / Bin

```text
warehouses 表 EXTEND：
  bin_enabled              INTEGER NOT NULL DEFAULT 0
  is_supplier_wip          INTEGER NOT NULL DEFAULT 0   -- 标识供应商 WIP 仓
  negative_stock_policy    TEXT    NOT NULL DEFAULT 'BLOCK'  -- BLOCK / ALLOW / WARNING
  mrp_participation        INTEGER NOT NULL DEFAULT 1
  inventory_lock_enabled   INTEGER NOT NULL DEFAULT 1

warehouse_bins 表 (NEW)：
  id TEXT PRIMARY KEY
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id)
  code TEXT NOT NULL
  name TEXT NOT NULL
  active INTEGER NOT NULL DEFAULT 1
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  UNIQUE(warehouse_id, code)
```

规则：

```text
bin_enabled=0 warehouse → bin_id 必须 NULL；mutation 接受 NULL bin
bin_enabled=1 warehouse → bin_id 必须 reference active bin 同 warehouse
```

Warehouse deactivation 检查：

```text
SUM(on_hand) > 0                 → reject
open movement (DRAFT / SUBMITTED / APPROVED) → reject
open stocktake (DRAFT / SUBMITTED / APPROVED) → reject
active bin dependencies         → reject
```

### 27.10 Owner Dimension

枚举：

```text
ENTERPRISE    -- owner_id 必须 NULL；本企业所有
SUPPLIER      -- owner_id reference suppliers.active=1
CUSTOMER      -- owner_id reference customers.active=1
```

不复制 Supplier / Customer master。`owner_id` 是 polymorphic FK，application-level referential validation 在 mutation contract 入口做。

VMI SUPPLIER-owned @ Enterprise warehouse 与 Enterprise-owned @ Supplier-WIP warehouse 在位置上是同一个 warehouse 但 owner 不同，必须由 position_key 区分。

`INVENTORY_OWNER_DIMENSION_UNAVAILABLE` 必须替换为真实 mutation。`assertInventoryOwnerDimension` 必须删除。

### 27.11 Stock Status

canonical 表 `inventory_stock_statuses`：

```text
code TEXT PRIMARY KEY     -- 'AVAILABLE' / 'HOLD' / 'BLOCKED' / 'INSPECTION' / 'QUARANTINE' ...
name TEXT NOT NULL
active INTEGER NOT NULL DEFAULT 1
```

至少包含：

```text
AVAILABLE         -- 可预订 / 可发料 / 可发货 / 可调拨
INSPECTION        -- 待检；Quality inspection decision pending
QUARANTINE        -- 隔离；不得 issue / ship / transfer
HOLD              -- 锁定业务用途
BLOCKED           -- 物理禁用
```

每状态必须明确 4 个 flag：

```text
reservable      INTEGER NOT NULL DEFAULT 0   -- AVAILABLE=1，其余 0
issuable        INTEGER NOT NULL DEFAULT 0   -- AVAILABLE=1，其余 0
shippable       INTEGER NOT NULL DEFAULT 0   -- AVAILABLE=1，其余 0
transferable    INTEGER NOT NULL DEFAULT 0   -- AVAILABLE / HOLD 之外需 1，按业务定义
```

默认 seed：

```text
AVAILABLE       reservable=1 issuable=1 shippable=1 transferable=1
INSPECTION      reservable=0 issuable=0 shippable=0 transferable=0
QUARANTINE      reservable=0 issuable=0 shippable=0 transferable=0
HOLD            reservable=0 issuable=0 shippable=0 transferable=1
BLOCKED         reservable=0 issuable=0 shippable=0 transferable=0
```

Quality inspection decision 触发 status change：

```text
PASS → AVAILABLE
FAIL → QUARANTINE
WAIVED → AVAILABLE
PENDING → INSPECTION (default)
```

Inventory 是 stock status canonical owner；Quality 是 inspection decision owner。

### 27.12 LOT / SERIAL Convergence

`inventory_lots.status` (`AVAILABLE / HOLD / CONSUMED / DELIVERED / SCRAPPED`) 与 `inventory_serials.lifecycle_state` (同枚举) 已存在。

不得引入第二个 stock status truth。

明确分层：

```text
canonical stock status        = inventory_stock_statuses.code
  -- 影响 availability / issue / shipment / transfer / reservation
  -- INV-04 / INV-19

tracking identity lifecycle   = inventory_lots.status / inventory_serials.lifecycle_state
  -- 表示该 LOT / SERIAL identity 自身是否还存在
  -- 由 canonical tracking lifecycle rules 推导（不是仅由 balance 归零）
```

禁止将 `inventory_lots.status` 与 `inventory_stock_statuses.code` 合并为同一字段。两者语义不同。

#### Position 归零 ≠ identity 终结

LOT 可能跨多个 warehouse / position 存在，因此某一 position 归零**不代表**整个 LOT identity 已结束。

SERIAL 的业务 disposition 也必须根据真实 movement / source 判断，而不是统一写 `DELIVERED`。

明确规则：

```text
physical depletion (某 position 数量归零)
  → balance quantity changes
  → tracked_inventory_movements / inventory_transactions 记录

tracking identity lifecycle 变化
  → 仅通过 canonical tracking lifecycle rules 触发
  → 必须基于真实 movement / source 推导
  → 不能因为某个 position 的 quantity 归零而自动设 DELIVERED / CONSUMED / SCRAPPED

LOT 全部消耗
  → 仅当 inventory_lot_balances 中该 lot_id 在所有 warehouse × product 维度下 sum 为 0
     且最近一次 movement 是真实 consumption / scrap
     才能由 tracking lifecycle rules 推进到 DELIVERED / CONSUMED / SCRAPPED

SERIAL 终结
  → 仅当 inventory_serials.lifecycle_state 由真实 consumption / scrap / ownership-transfer movement 推导
  → 不能简单因为 current_warehouse_id 清空 或 quantity 归零 而设 DELIVERED
```

#### Domain 5 不重写 Domain 2 冻结的 tracking lifecycle

Domain 5（Inventory & Warehouse）必须**不**重新定义 Domain 2（Manufacturing & Quality）已冻结的 `inventory_lots.status` / `inventory_serials.lifecycle_state` 状态机：

- `inventory_lots.status` 状态机 / transition 规则 / event 由 Master & Engineering 或 Manufacturing & Quality Domain 拥有；
- `inventory_serials.lifecycle_state` 同上；
- Inventory 仅**消费**已发布的 tracking identity 状态作 availability / issue / shipment 校验；
- 任何 Inventory mutation 触发的 lifecycle transition 必须走既有 tracking rules（Master & Engineering / Manufacturing & Quality 暴露的 helper 或 transition），不得绕过。

Domain 2 现有 consumer 仍读 `inventory_lots.status` 用于 LOT 主数据查询；新增 availability / issue / shipment 检查从 `inventory_stock_statuses.code`。

### 27.13 Availability Model

#### Position-level

```text
position_eligible_on_hand   = SUM(inventory.quantity)
                              WHERE position_key = ? AND active=1
                              AND stock_status='AVAILABLE'
                              AND (expiry_date IS NULL OR expiry_date > today)

active_locks                = SUM(inventory_locks.remaining_qty)
                              WHERE position_key = ? AND status='ACTIVE'

position_free_physical      = position_eligible_on_hand - active_locks
```

`position_free_physical` 是该 position 当前真实可用的 physical quantity（不包含 lock 占用的部分）。

#### Planning-level（与 Planning frozen reservation types 一致）

Planning reservation 三种 frozen types：

```text
STRONG   -- frozen by Planning；MRP/人工建立；firm supply 不能覆盖
WEAK     -- frozen by Planning；MRP 建立；可按 Planning policy 释放
MANUAL   -- frozen by Planning；人工建立；无现存 supply 时指定 expected supply + release date
```

基于这三类，规划层 availability 显式拆为三个聚合量：

```text
active_reserved_total   = SUM(planning_reservations.quantity)
                          WHERE status='ACTIVE'
                          AND reservation_type IN ('STRONG','WEAK','MANUAL')

hard_reserved           = SUM(planning_reservations.quantity)
                          WHERE status='ACTIVE'
                          AND reservation_type IN ('STRONG','MANUAL')

soft_reserved           = SUM(planning_reservations.quantity)
                          WHERE status='ACTIVE'
                          AND reservation_type = 'WEAK'
```

进一步得到：

```text
warehouse/product eligible physical stock
  = SUM(position_free_physical)
    WHERE product_id = ? AND warehouse_id IN (scheme.warehouses)
    AND owner_type IN ('ENTERPRISE', scheme-eligible SUPPLIER)

physical_free                       = warehouse/product eligible physical stock

available_for_new_reservation       = physical_free - active_reserved_total
                                    -- 新建 reservation 时可用预算

available_for_unrelated_execution   = physical_free - hard_reserved
                                    -- 不属于该 reservation 的业务 execution
                                    -- (e.g. Sales Delivery / Production Issue) 可用预算
                                    -- WEAK reservation 不会阻塞 unrelated execution
```

不制造 LOT 级虚拟 reservation。Planning reservation 不强行分摊到 LOT / Bin / Serial。

WEAK reservation 可按 frozen Planning policy 在新 run preparation 时释放；STRONG 不被该策略释放；MANUAL 在 release_date 到期时显式 RELEASED。

### 27.14 Reservation Boundary

`planning_reservations.status` 取值：

```text
ACTIVE          -- 计入 reserved quantity (active_reserved_total / hard_reserved / soft_reserved)
CANCELLED       -- 不计入
EXPIRED         -- 不计入
CONSUMED        -- 不计入（已由实际出库 consume）
RELEASED        -- 不计入
```

Inventory 只读 ACTIVE reservation 形成 availability projection。

Inventory 不创建 / 不修改 planning_reservations。Planning domain 仍为 reservation document 的 canonical owner；STRONG / WEAK / MANUAL 三类 lifecycle 完全由 Planning 拥有。

Inventory availability projection 严格只读上述三个聚合量（active_reserved_total / hard_reserved / soft_reserved），不复制 Planning reservation engine；不参与 reservation state 转换。

### 27.15 Lock / Unlock

Lock 唯一 truth：

```text
inventory_locks 表（canonical）：
  id TEXT PRIMARY KEY
  product_id TEXT NOT NULL
  warehouse_id TEXT NOT NULL
  position_key TEXT                  -- 可选；若 NULL 表示 product/warehouse-level lock
  quantity REAL NOT NULL CHECK(quantity > 0)
  reason TEXT NOT NULL
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','RELEASED'))
  locked_by TEXT NOT NULL REFERENCES users(id)
  locked_at TEXT NOT NULL
  released_by TEXT REFERENCES users(id)
  released_at TEXT
  source_type TEXT NOT NULL           -- 'INVENTORY_LOCK' / 'OUTSOURCING_HOLD' / 'STOCKTAKE_HOLD'
  source_id TEXT NOT NULL
```

`inventory` balance 不保存 lock state；**MUST NOT** 拥有 `is_locked` Boolean。lock 唯一来源 = `inventory_locks`。

派生：

```text
active_locked_qty    = SUM(inventory_locks.quantity)
                      WHERE position_key = ? AND status='ACTIVE'

free_physical_qty    = position_eligible_on_hand - active_locked_qty
```

规则：

```text
lock_qty             ≤ current lockable_on_hand at position
locked stock not available (subtracted from available projection)
unlock_qty           ≤ ACTIVE remaining lock_qty (cannot over-release)
audit required (INVENTORY_LOCK_CREATE / INVENTORY_LOCK_RELEASE)
Lock 不直接 mutate `inventory.quantity` —— Lock 是独立账本
Lock 显式 ACTIVE / RELEASED 两态
```

不直接 mutate `inventory.quantity`。Lock 单独账本，独立于 inventory balance。

### 27.16 Inventory Period

复用既有 `inventory_period_closures` 表（CLOSED / REOPENED）。所有实际 mutation 入口先 `assertFinancialPeriodsOpen(businessDate)`。

Closed inventory period：拒绝 mutation。`step-transfer destination receipt` 使用其目标业务日期。

`financial-inventory.js::assertFinancialPeriodsOpen` 已覆盖：inventory cutoff + accounting cutoff 双重校验。

### 27.17 SQLite / MySQL Concurrency

#### SQLite

```text
BEGIN IMMEDIATE
transaction(db, work)        -- 既有 helper
```

#### MySQL

```text
START TRANSACTION
SELECT ... FOR UPDATE          -- row lock on inventory by position_key
deterministic lock order        -- §27.18
retry existing deadlock/lock-timeout policy
```

锁对象至少覆盖：

```text
inventory position (by position_key)
document source item
inventory_locks aggregate
inventory_lot_balances (per warehouse + lot)
inventory_serials (current_warehouse_id + serial_number)
inventory_step_transfer_in_transit aggregate
```

### 27.18 Lock Ordering

为避免 deadlock，所有 mutation 必须遵循唯一 canonical lock order：

```text
1. 收集本次 transaction 涉及的全部 inventory position_key
   - fromPosition.position_key
   - toPosition.position_key (single destination 或 paired destinations)
   - paired mutation 上下文中所有 destinations
   - in-transit execution rows 的相关 position_key
   - deduplicate
2. 将 position_key 集合按字典序 ascending 排序
3. 严格按排序结果依次加锁

禁止：

- always-from-first（两个相反方向 transfer 会死锁）
- always-to-first（同上）
- 部分 sorted（半序加锁同样存在反向 deadlock 风险）
```

完整 mutation lock sequence：

```text
1. business / source document rows              (按 source_type, source_id 字典序)
2. product / reference rows                     (product_id 字典序)
3. inventory positions                          (position_key 字典序 ascending, deduplicated)
4. LOT / SERIAL identities                      (warehouse_id + lot_id / product_id + serial_number 字典序)
5. lock / reservation aggregate rows            (position_key 字典序)
6. transfer execution rows                      (source_transfer_id + product_id 字典序)
7. financial evidence rows                      (balance_key 字典序)
```

具体顺序可微调（同一类型内再排字典序），但只允许一个 canonical order；position 阶段是唯一 inventory 加锁面。

SQLite: `BEGIN IMMEDIATE` 即取得 reserved lock + 序列化写。

MySQL: `SELECT ... FOR UPDATE` 按上述排序结果加锁；retry 既有 deadlock / lock-timeout 策略（次数上限由 `server/database/mysql-adapter.js` 既有 helper 决定）。

### 27.19 Direct Transfer

收敛到 mutation contract：

```text
source position.quantity ↓
destination position.quantity ↑
owner_type / owner_id 不变
stock_status 不变（除非显式 STATUS_CHANGE）
lot_id / serial_id 不变（同 identity 移动，不重写）
```

LOT/SERIAL transfer：

```text
inventory_lots.id 与 inventory_serials.id 保持
inventory_lot_balances(warehouse_id) 切换
inventory_serials.current_warehouse_id 切换
```

不重建 LOT/SERIAL identity。Direct Transfer 在 movement evidence 上表达为：

```text
movement_group_id  = G_new (per group)
movement_kind      = MOVE

source position row:      direction = OUT   movement_kind = MOVE   movement_group_id = G_new
destination position row: direction = IN    movement_kind = MOVE   movement_group_id = G_new
```

`tracked_inventory_movements.direction` 物理方向仅保留 `IN / OUT`；业务 mutation 类型由 `movement_kind` + `movement_group_id` 表达。同理：

- `BIN_MOVE`         → paired OUT + IN，movement_kind=BIN_MOVE，movement_group_id 相同
- `OWNER_CHANGE`     → paired OUT + IN，movement_kind=OWNER_CHANGE，movement_group_id 相同
- `STATUS_CHANGE`    → paired OUT + IN，movement_kind=STATUS_CHANGE，movement_group_id 相同
- `LOT_RECLASS`      → paired OUT + IN，movement_kind=LOT_RECLASS，movement_group_id 相同
- `MOVE`             → paired OUT + IN，movement_kind=MOVE，movement_group_id 相同
- `IN`               → single IN，movement_kind=IN
- `OUT`              → single OUT，movement_kind=OUT
- `ADJUSTMENT`       → single IN 或 OUT，movement_kind=ADJUSTMENT

paired mutation 在同一 transaction 内提交；quantity 守恒；position_key 来自 toPosition / fromPosition。

### 27.20 Step Transfer / In-Transit

不建立第二库存余额。In-transit 仅由 step-transfer execution facts 派生。

`inventory_step_transfer_in_transit` 表**只**保存 execution facts：

```text
inventory_step_transfer_in_transit 表：
  id TEXT PRIMARY KEY
  source_transfer_id TEXT NOT NULL          -- inventory_transfers.id
  product_id TEXT NOT NULL
  warehouse_id_source TEXT NOT NULL
  warehouse_id_destination TEXT NOT NULL
  issued_qty REAL NOT NULL                  -- 累计已 Transfer Out 数量
  received_qty REAL NOT NULL DEFAULT 0      -- 累计已 Transfer In 数量
  returned_qty REAL NOT NULL DEFAULT 0      -- 累计 return to source 数量
  cancelled_qty REAL NOT NULL DEFAULT 0     -- 累计 cancel remaining 数量
  status TEXT NOT NULL CHECK(status IN ('IN_TRANSIT','CLOSED','CANCELLED'))
  created_at TEXT NOT NULL
  closed_at TEXT
```

Canonical derivation（**唯一** in-transit 计算路径）：

```text
in_transit_qty = issued_qty
               - received_qty
               - returned_qty
               - cancelled_qty
```

in_transit_qty 由 execution facts 计算，**不是** inventory 第二库存余额。

语义：

```text
Transfer Out    → applyInventoryMutation(OUT, intoStepTransferInTransit=true)
                 → 增加 inventory_step_transfer_in_transit.issued_qty
                 → 不写入任何 inventory.position_key
Transfer In     → applyInventoryMutation(IN, fromStepTransferInTransit=true)
                 → 增加 received_qty
                 → 增加 destination position.quantity
partial receipt → received_qty 累加；剩余 in_transit_qty 继续 in-transit
cancel remaining → 关闭 step transfer，cancelled_qty 累加
return to source → applyInventoryMutation(MOVE) from in-transit 到 source warehouse；returned_qty 累加
```

In-transit quantity：

- **不得** 成为 source warehouse 的 on_hand；
- **不得** 成为 destination warehouse 的 on_hand；
- **只能** 从 execution facts reconciliation 得出。

任何 report / availability / lot trace 必须从 execution facts 派生 in_transit_qty，不得通过 SELECT ... FROM inventory 查询任何 in-transit "balance"。

### 27.21 Ownership Transfer

必须与 warehouse transfer 分开。

```text
OWNER_CHANGE mutation:
  fromPosition.owner_type  → toPosition.owner_type
  fromPosition.warehouse_id == toPosition.warehouse_id
  fromPosition.product_id  == toPosition.product_id
  fromPosition.stock_status == toPosition.stock_status
  fromPosition.lot_id      == toPosition.lot_id
  fromPosition.serial_id   == toPosition.serial_id
  quantity 守恒
```

VMI ownership transfer：

```text
before:  position_key(SUPPLIER, supplier_id, ...)  @ WH-A
after:   position_key(ENTERPRISE, NULL, ...)       @ WH-A
```

解除 Domain 4 当前 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE`。删除 `procurement-vmi.js::assertInventoryOwnerDimension`。VMI business document 触发 mutation OWNER_CHANGE。

Finance effect：Inventory 只生成 physical ownership fact；Finance adapter 决定 valuation / accounting consequence。

### 27.22 Outsourcing Supplier-WIP

Enterprise-owned @ Supplier-WIP warehouse 保持。

```text
Outsourcing Issue
  fromPosition: enterprise warehouse (owner=ENTERPRISE)
  toPosition:   supplier-WIP warehouse (owner=ENTERPRISE)
  quantity 守恒
```

```text
Outsourcing Return
  reverse direction
```

Supplier WIP remaining 由 `inventory_step_transfer_in_transit` 风格表或 `inventory.quantity` 在 supplier-WIP warehouse 位置直接聚合得出。

不改 Outsourcing Order / Issue / Supplement / Return / Backflush business semantics；仅替换物理 mutation 入点。

### 27.23 Entrusted Material

INV-12 / INV-25：

```text
Entrusted Receipt
  owner_type = CUSTOMER
  owner_id   = customers.active=1
  warehouse  = enterprise warehouse
  stock_status = AVAILABLE (或 HOLD by 业务选择)

Entrusted Issue
  same owner_type / owner_id
  反向 movement
```

不得进入 enterprise-owned available stock。`planning_available` 仅取 owner_type='ENTERPRISE' 或 scheme-eligible SUPPLIER；CUSTOMER 不进入 planning-available。

消费 / 退回时保持 customer ownership，除非有显式 OWNER_CHANGE business event（不属于 INV-12）。

### 27.24 Opening Inventory

新表：

```text
inventory_initialization 表：
  id TEXT PRIMARY KEY
  status TEXT NOT NULL CHECK(status IN ('NOT_STARTED','OPEN','CLOSED'))
  enabled_at TEXT            -- inventory enable date
  opened_by TEXT REFERENCES users(id)
  opened_at TEXT
  closed_by TEXT REFERENCES users(id)
  closed_at TEXT
  notes TEXT NOT NULL DEFAULT ''
  reopen_count INTEGER NOT NULL DEFAULT 0

opening_inventory_documents 表：
  id TEXT PRIMARY KEY
  initialization_id TEXT NOT NULL REFERENCES inventory_initialization(id)
  doc_no TEXT NOT NULL UNIQUE
  business_date TEXT NOT NULL
  status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED'))
  creator_id TEXT NOT NULL REFERENCES users(id)
  confirmed_by TEXT REFERENCES users(id)
  created_at TEXT NOT NULL
  confirmed_at TEXT
  notes TEXT NOT NULL DEFAULT ''

opening_inventory_items 表：
  id TEXT PRIMARY KEY
  document_id TEXT NOT NULL REFERENCES opening_inventory_documents(id)
  product_id TEXT NOT NULL REFERENCES products(id)
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id)
  bin_id TEXT                 -- nullable
  owner_type TEXT NOT NULL DEFAULT 'ENTERPRISE'
  owner_id TEXT
  stock_status TEXT NOT NULL DEFAULT 'AVAILABLE'
  lot_id TEXT                 -- nullable
  serial_id TEXT              -- nullable
  quantity REAL NOT NULL CHECK(quantity > 0)
  position_key TEXT NOT NULL
  UNIQUE(position_key)
```

Lifecycle：

```text
NOT_STARTED
  -- 库存未启用
  -- 全部 mutation reject (除 initialization CRUD)

OPEN
  -- 允许 opening_inventory_documents CONFIRM
  -- 允许普通 inventory mutation

CLOSED
  -- 普通编辑 opening document reject
  -- 只允许 governed correction / reopen
  -- 不允许 retroactive fabricate 历史凭证
```

Controlled reopen：

```text
CLOSED → OPEN
  -- 必须 inventory_initialization.reopen_count++
  -- 必须 audit
  -- 必须 support reason
```

启用日期 = `enabled_at`，由 initialization OPEN 一次性写入。Closed inventory period 拒绝后期 mutation。

### 27.25 Other Receipt / Other Issue

库存原生 document family：

```text
inventory_native_documents 表：
  id TEXT PRIMARY KEY
  doc_no TEXT NOT NULL UNIQUE
  doc_kind TEXT NOT NULL CHECK(doc_kind IN ('OTHER_RECEIPT','OTHER_ISSUE'))
  business_date TEXT NOT NULL
  status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED'))
  reason TEXT NOT NULL DEFAULT ''
  creator_id TEXT NOT NULL REFERENCES users(id)
  confirmed_by TEXT REFERENCES users(id)
  created_at TEXT NOT NULL
  confirmed_at TEXT
  notes TEXT NOT NULL DEFAULT ''
```

Lifecycle：

```text
DRAFT → CONFIRMED       (产生 inventory mutation)
DRAFT → CANCELLED
```

CONFIRMED 后：

```text
OTHER_RECEIPT → applyInventoryMutation(IN, inventory_native_documents row)
OTHER_ISSUE   → applyInventoryMutation(OUT, inventory_native_documents row)
```

不得伪装成 PURCHASE_RECEIPT / SALES_DELIVERY / PRODUCTION_RECEIPT / OUTSOURCING_RECEIPT。`source_type` 必须是 `OTHER_RECEIPT` / `OTHER_ISSUE`。

### 27.26 Stock Status Adjustment / Lot Adjustment / Form Conversion / Bin Move

#### Stock Status Adjustment

```text
same product_id, warehouse_id, bin_id, owner_type, owner_id, lot_id, serial_id
quantity 守恒
stock_status: A → B
movement_kind: STATUS_CHANGE
```

#### Lot Adjustment

```text
split  → 1 fromPosition.quantity - x → 2 toPosition（不同 lot_id）
merge  → N fromPosition → 1 toPosition
rename → identity_id 不变，lot_code 变更（受 governance）
quantity 守恒；tracking identity trace 不丢
禁止用于 SERIAL
```

#### Form Conversion

```text
产品形态 / 包装 / 辅助属性改变
quantity 守恒
master data owner：Master Data (辅助属性) / Engineering (变更正本)
Inventory 不复制 BOM / auxiliary attribute truth
```

#### Bin Move

```text
fromPosition.bin_id → toPosition.bin_id
其它维度全部守恒
movement_kind: BIN_MOVE
```

### 27.27 Assembly / Disassembly

INV-17 (Integration-Backed — Engineering BOM)：

```text
Assembly:
  1. 取 canonical Engineering BOM resolver 输出 components
     resolveEffectiveBomForCaller('INVENTORY_ASSEMBLY', productId, businessDate)
  2. applyInventoryMutation(MOVE) for each component
     fromPosition: component bin/lot 减少
     toPosition:   intermediate warehouse bin 减少（or 直接）
  3. applyInventoryMutation(IN) for parent
     toPosition: parent warehouse bin 增加
  4. snapshot BOM version + qty base + scrap factor
  6. valuation movement via financial-inventory.js
  7. audit

Disassembly:
  reverse
```

Engineering / BOM 是结构来源；Inventory owns physical consume / produce movement。

不创建第二 BOM engine。最终成本分摊仍归 Finance / Inventory Costing。

### 27.28 Inventory Adjustment & Scrap

保留既有 `inventory_adjustments` / `inventory_scraps`，收敛到 mutation contract：

```text
INVENTORY_ADJUSTMENT   → applyInventoryMutation(ADJUSTMENT, signed qty)
INVENTORY_SCRAP        → applyInventoryMutation(ADJUSTMENT, OUT with source 'INVENTORY_SCRAP')
```

不重写 lifecycle。仅 mutation 入点替换。

### 27.29 Stocktake

```text
inventory_checks           (DRAFT / SUBMITTED / APPROVED)  -- 既有
inventory_check_items      -- 既有
```

扩展为 canonical stocktake：

```text
inventory_checks 表 EXTEND：
  check_kind TEXT NOT NULL DEFAULT 'REGULAR' CHECK(check_kind IN ('REGULAR','CYCLE'))
  scope_strategy TEXT NOT NULL DEFAULT 'ALL'  -- 'ALL' / 'BY_ABC' / 'BY_PRODUCT' / 'BY_LOCATION'
  abc_classification TEXT                      -- 'A' / 'B' / 'C' (when scope_strategy='BY_ABC')
  cycle_period_key TEXT                          -- 'YYYY-MM' (when check_kind='CYCLE')
  snapshot_at TEXT NOT NULL                      -- 快照时间

inventory_check_items EXTEND：
  position_key TEXT NOT NULL
  bin_id TEXT
  owner_type TEXT NOT NULL
  owner_id TEXT
  stock_status TEXT NOT NULL
  lot_id TEXT
  serial_id TEXT
  book_quantity REAL NOT NULL
  physical_quantity REAL NOT NULL
  diff_quantity REAL NOT NULL
  snapshot_book_quantity REAL NOT NULL           -- 快照时刻的账存
```

Snapshot 语义：

```text
snapshot_at = timestamp captured at SUBMIT
snapshot_book_quantity = quantity at position_key at snapshot_at
后续 movement 不影响 snapshot_book_quantity
physical_quantity = 实际盘点时录入
diff_quantity = physical_quantity - snapshot_book_quantity
```

Confirm 策略：

```text
CONFIRM APPROVED → applyInventoryMutation(ADJUSTMENT, signed diff)
  sourceType = 'INVENTORY_STOCKTAKE_DIFF'
  quantity = diff_quantity
  reason = inventory_check.check_no
```

不得在 confirm 时偷偷重新取 current balance，必须使用 snapshot_book_quantity。

### 27.30 Stocktake vs Mutation Conflict Reconciliation

```text
snapshot_at 前 movement 已写
snapshot_at 后 movement 又写
physical_quantity 录入时基于 snapshot_at 的账存
diff_quantity = physical_quantity - snapshot_book_quantity
confirm 时按 diff_quantity apply mutation
期间 mutation 不阻断 confirm（账实差异是合法结果）
```

新增 conflict guard：confirm 时如果 `now - snapshot_at > stocktake_window_days` (parameter, default 30)，要求 controlled reopen / re-snapshot。

### 27.31 ABC Classification

canonical 表：

```text
inventory_abc_classifications 表：
  id TEXT PRIMARY KEY
  product_id TEXT NOT NULL REFERENCES products(id)
  abc_class TEXT NOT NULL CHECK(abc_class IN ('A','B','C'))
  effective_from TEXT NOT NULL
  effective_to TEXT
  basis TEXT NOT NULL DEFAULT 'VALUE'  -- 'VALUE' / 'USAGE'
  finance_valuation_snapshot_id TEXT   -- basis 引用
  created_by TEXT NOT NULL REFERENCES users(id)
  created_at TEXT NOT NULL
  UNIQUE(product_id, effective_from)
```

ABC 只生成 classification / stocktake strategy。basis='VALUE' 必须引用 Finance valuation snapshot。Inventory 不复制 valuation engine。

Cycle stocktake scope：`scope_strategy='BY_ABC'` 时按当前 ABC class 选 product。

### 27.32 Reports (INV-27 / 33-38)

```text
inventory_reports.js

读 canonical：
    inventory + inventory_transactions + tracked_inventory_movements
    inventory_lots / inventory_serials / inventory_lot_balances
    inventory_locks
    planning_reservations (read-only for availability)
    inventory_valuation_balances (read-only Finance evidence)

输出：
    Instant Inventory       -- by product / warehouse / bin / owner / stock_status / lot / serial
    Receipt/Issue Summary   -- by product / period / source_type
    Receipt/Issue Detail    -- by product / period / source_type / source_id
    Inventory Ledger        -- opening + receipts - issues = closing
    Inventory Aging         -- by receipt_date / expiry_date buckets
    Slow-Moving             -- no movement > N days; receipt-only-no-issue
    Inventory Alerts        -- min / max / safety / reorder / expiry / negative anomaly
    ABC Analysis            -- current ABC class per product
    Serial Master / Current State / Trace Lookup
```

Report 不允许拥有独立 quantity truth。必须从 canonical inventory + movements 派生。

### 27.33 Inventory Ledger

```text
opening_quantity  = SUM(inventory.quantity) AT initialization
                    OR inventory_period_snapshots.closing_quantity (历史区间)
receipts         = SUM(inventory_transactions.quantity_change)
                    WHERE direction='IN' AND business_date IN period
issues           = SUM(inventory_transactions.quantity_change)
                    WHERE direction='OUT' AND business_date IN period
closing_quantity = opening_quantity + receipts - issues
```

来自 canonical inventory_transactions + canonical inventory。不是第二套 ledger。

INV-34 read model 必须从 canonical balances + movements 派生。

### 27.34 Alerts

```text
INVENTORY_ALERT_THRESHOLDS 表 (NEW, 参数化):
  product_id TEXT NOT NULL
  warehouse_id TEXT NOT NULL
  min_stock REAL
  max_stock REAL
  safety_stock REAL
  reorder_point REAL
  expiry_warn_days INTEGER NOT NULL DEFAULT 30
  PRIMARY KEY(product_id, warehouse_id)

触发：
  available_quantity < min_stock           → MIN_STOCK_ALERT
  available_quantity > max_stock           → MAX_STOCK_ALERT
  available_quantity < safety_stock        → SAFETY_STOCK_ALERT
  available_quantity < reorder_point       → REORDER_ALERT
  expiry_date < today + warn_days          → EXPIRY_ALERT
  current_quantity < 0 (fallback)         → NEGATIVE_BALANCE_ANOMALY
```

不得使用 stale `products.stock_quantity` 作为事实。必须从 `inventory_reports.js::readAvailableQuantity()` 派生。

### 27.35 Barcode Foundation (INV-39)

Bounded barcode foundation：

```text
inventory_barcode_rules 表：
  id TEXT PRIMARY KEY
  code TEXT NOT NULL UNIQUE
  pattern TEXT NOT NULL              -- regex / template
  fields JSON                        -- parsed fields map
  active INTEGER NOT NULL DEFAULT 1

inventory_barcode_bindings 表：
  id TEXT PRIMARY KEY
  rule_id TEXT NOT NULL REFERENCES inventory_barcode_rules(id)
  entity_type TEXT NOT NULL          -- 'PRODUCT' / 'WAREHOUSE' / 'BIN' / 'LOT' / 'SERIAL' / 'CONTAINER'
  entity_id TEXT NOT NULL
  barcode TEXT NOT NULL
  UNIQUE(rule_id, entity_type, entity_id)

inventory_barcode_resolution_log 表：
  id TEXT PRIMARY KEY
  barcode TEXT NOT NULL
  resolution_json TEXT
  resolved_at TEXT NOT NULL
  resolved_by TEXT REFERENCES users(id)
  source TEXT NOT NULL               -- 'STOCK_QUERY' / 'STOCKTAKE' / 'SCAN_VALIDATE' / 'SCAN_ADAPTER'
```

Parser 输出：

```text
product_id        (nullable)
warehouse_id      (nullable)
bin_id            (nullable)
lot_id            (nullable)
serial_id         (nullable)
quantity          (default 1)
container_id      (nullable)
```

不设计打印平台 / 设备地址管理。

### 27.36 Scan Adapter (INV-40 / INV-41)

Scan engine：

```text
server/modules/inventory-scan-adapter.js::resolveScan(barcode, actor)

input:  barcode TEXT, context { sourceType?, sourceId?, operationType? }
output: {
  barcodeRuleId, resolvedFields { product_id, warehouse_id, bin_id, lot_id, serial_id, quantity, container_id },
  validation: { inventoryEligible, stockStatusOk, lotSerialMatch, expiryOk, qtyNonNegative, ... },
  draftDocument: { targetBusinessDocument?, fieldsForTargetDocument? },
  duplicate: boolean,
  replayProtectionKey: TEXT
}
```

按业务 context：

```text
'PURCHASE_RECEIPT'  context     → 解析 → 校验 PO source item → 返回 Purchase Receipt draft payload
                                          → Business Domain (Procurement) 决定 confirm
'SALES_DELIV'       context     → 解析 → 校验 SO/Delivery → 返回 outbound validation
'OTHER_RECEIPT'     context     → 解析 → 直接产生 inventory-native document draft
'INVENTORY_STOCKTAKE' context   → 解析 → 返回 stocktake line
'INVENTORY_INSTANT_QUERY'        → 解析 → 返回 instant query

NOT supply business document creation
```

不得让 scan engine 直接创建 Purchase Receipt / Sales Delivery / Production Order。target business document 由对应 Domain 决定。

INV-40 / INV-41 Integration-Backed，明确 adapter contract。

### 27.37 Duplicate Scan / Idempotency

```text
allowed quantity accumulation   -- OTHER_RECEIPT / OTHER_ISSUE 多 scan 累加
                                 通过 inventory_native_documents 同 doc_id 多次 confirm
duplicate serial forbidden    -- SERIAL scan 二次进入同 source → reject
network replay idempotency    -- (source_type, source_id, source_item_id, idempotency_key) UNIQUE
                                 existing inventory_native_documents.idempotency_key /
                                 inventory_barcode_resolution_log.replayProtectionKey
```

实现：

```text
serial duplicate check:
  SELECT 1 FROM inventory_barcode_resolution_log
   WHERE barcode=? AND resolved_at > now - idempotency_window
     AND resolution_json LIKE '%serial_id%' AND source='SCAN_VALIDATE'
  → if exists: 409 'duplicate serial scan'

qty accumulation:
  inventory_native_documents.idempotency_key 可包含多 barcode resolution
  confirm 时累加 quantity 但每 (source, serial) 仍唯一
```

### 27.38 Stocktake Scan / Instant Query (INV-42 / INV-43)

```text
INVENTORY_STOCKTAKE context scan
  → inventory-check-items insert (DRAFT)
  → 不创建独立 scan inventory tables

INVENTORY_INSTANT_QUERY context scan
  → 读 canonical inventory by (product_id, warehouse_id, bin_id?, lot_id?, serial_id?)
  → 返回 instant query result
```

### 27.39 Packing / Container (INV-44)

```text
inventory_containers 表：
  id TEXT PRIMARY KEY
  container_no TEXT NOT NULL UNIQUE
  container_type TEXT NOT NULL       -- 'PALLET' / 'CASE' / 'BOX' / 'BAG' / ...
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id)
  status TEXT NOT NULL CHECK(status IN ('OPEN','SEALED','DISPATCHED','DESTROYED'))
  parent_container_id TEXT          -- 支持 nested
  created_by TEXT NOT NULL REFERENCES users(id)
  created_at TEXT NOT NULL

inventory_container_items 表：
  id TEXT PRIMARY KEY
  container_id TEXT NOT NULL REFERENCES inventory_containers(id)
  product_id TEXT NOT NULL REFERENCES products(id)
  lot_id TEXT
  serial_id TEXT
  quantity REAL NOT NULL CHECK(quantity > 0)
  bin_id TEXT
  position_key TEXT                 -- 引用 inventory.position_key（不是 quantity truth）

UNIQUE(container_id, product_id, lot_id, serial_id, bin_id)
```

不得取代 inventory mutation。

```text
pack      → inventory_container_items insert；不写 inventory.quantity
unpack    → inventory_container_items delete；不写 inventory.quantity
whole-container transfer
  → applyInventoryMutation(MOVE) by container 内 (product, lot, serial, bin) 全部 sum
     then seal status='DISPATCHED' / unpack at destination
partial-container transfer
  → applyInventoryMutation(MOVE) by 选定 partial subset；
     remaining container_items 不动；
     container.status='OPEN'
container content inquiry
  → 读 inventory_container_items JOIN inventory
```

Container 不成为第二库存余额。真实库存仍以 canonical inventory identity (position_key) 为准。

### 27.40 Valuation Boundary

`financial-inventory.js` 继续作为 Finance/Inventory Costing canonical valuation evidence。`inventory_valuation_balances` / `inventory_valuation_movements` 不重写。

| mutation | 是否影响 value |
|---|---|
| BIN_MOVE | NO（bin 改变 total value conserved） |
| STOCK_STATUS_CHANGE | NO（status 改变 total value conserved） |
| Direct Transfer (MOVE) | NO（location 改变 total value conserved） |
| LOT_RECLASS | NO（lot identity 改变 total value conserved） |
| OWNER_CHANGE | 可能（Inventory 只生成 physical ownership fact；Finance adapter 决定 valuation consequence） |
| IN / OUT / ADJUSTMENT | YES（quantity delta → financial-inventory.js::receiveValue / issueValue） |
| Assembly / Disassembly | YES（consume carrying value + produce carrying value） |

Inventory 不写新 costing engine。所有 IN / OUT / ADJUSTMENT 在 mutation contract 内调用既有 `financial-inventory.js::receiveValue / issueValue` (cents-based INTEGER safe)。

### 27.41 Closed Period

实际 physical mutation 入口先 `assertFinancialPeriodsOpen(businessDate)`。

Closed inventory period：reject mutation。

Step-transfer destination receipt 使用其目标业务日期（destination date），确保不会被 source 期间关闭阻断。

### 27.42 Mandatory Domain Race Matrix (14)

Implementation 期间必须真实覆盖：

```text
RACE-01  two outbound mutations against same position         (同一 position 两个 OUT)
RACE-02  direct transfer vs outbound                          (MOVE vs OUT 同一 position)
RACE-03  step-transfer receive twice                          (Transfer In 二次)
RACE-04  stocktake confirm vs outbound                        (Stocktake diff apply vs OUT)
RACE-05  lock vs outbound                                     (Lock create vs OUT)
RACE-06  Planning reservation vs availability-consuming mutation
                                                           (reservation vs OUT)
RACE-07  VMI owner transfer twice                             (OWNER_CHANGE 二次)
RACE-08  stock-status adjustment vs outbound                  (STATUS_CHANGE vs OUT)
RACE-09  lot split/merge vs lot outbound                      (LOT_RECLASS vs OUT 同一 lot)
RACE-10  same SERIAL consumed twice                           (SERIAL 二维扫描 / 二次 issue)
RACE-11  bin move vs outbound                                 (BIN_MOVE vs OUT 同一 position)
RACE-12  period close vs stock mutation                       (assertFinancialPeriodsOpen 并发)
RACE-13  opening initialization close vs opening write        (CLOSED 状态并发)
RACE-14  duplicate barcode serial scan / confirm              (SERIAL 重复 scan)
```

Implementation 结束后不允许再补 race list。最终 MySQL concurrency 必须真实覆盖全部 14。

### 27.43 Migration Safety

```text
inventory 表 additive：
  - 既有 UNIQUE(warehouse_id, product_id) 保留作 legacy compatibility（仅 read）
  - 新增 position_key 列 (CHAR(64) NOT NULL for MySQL; TEXT for SQLite)
  - additive migration 在 transaction 内完成

bin / owner / status / lot / serial 既有数据：
  - NONE → ENTERPRISE owner + AVAILABLE status + NULL others
  - LOT/SERIAL 已存在 inventory_lots / inventory_serials 中
  - 派生 SUM 校验 fail-closed

历史 inventory_transactions：
  - 既有列保留
  - 新 mutation 写 position_key 与 bin/owner/status/lot/serial snapshot
  - 旧 movement display 'historical dimension unavailable'

constraints / indexes：
  - UNIQUE(position_key) additive
  - INDEX(position_key), INDEX(product_id, warehouse_id, stock_status), INDEX(owner_type, owner_id)
  - data-preserving constraint / index reconstruction

idempotent migration
SQLite / MySQL parity (per server/database/mysql-schema.js 既有 alias strategy)
no production reset
no history deletion
before / after row reconciliation
quantity reconciliation
tracked identity reconciliation
fail-closed on mismatch

rollback strategy：
  - 停止新代码路径
  - 应用代码回退
  - additive 列保留（旧 schema 仍能读）
  - 不 destructive down-migrate
```

### 27.43.1 Atomic Legacy Cutover（activation gate）

现有 legacy primitive `adjustInventory(warehouseId, productId, quantityChange)` 依赖 `UNIQUE(warehouse_id, product_id)`，并隐式假设 `ENTERPRISE owner + AVAILABLE status + NULL bin + NULL lot/serial`。

一旦 canonical inventory 允许：

```text
same warehouse + same product
+ different owner / bin / status / lot / serial
```

旧 helper **不能**继续作为通用 inventory writer。Design 锁定如下 cutover contract：

#### A. 所有 physical inventory WRITE paths 必须完成 convergence

Activation gate 之前（下列每一项满足前，非-default dimensions 不得 writable）：

```text
1. 全部 physical mutation callers 已迁移到 applyInventoryMutation 入口
2. 无任何业务代码继续直接 `UPDATE inventory SET quantity = ?`
3. 旧 helper `adjustInventory` 已替换或降级为 compatibility adapter
```

#### B. Legacy Reads

旧接口若只要求 `warehouse + product quantity`，必须经 compatibility read adapter：

```text
inventory_compatibility_view (read-only):
  SELECT
    legacy.warehouse_id, legacy.product_id,
    SUM(legacy.quantity)                                  AS total_quantity,
    SUM(CASE WHEN legacy.stock_status='AVAILABLE' THEN legacy.quantity ELSE 0 END)
                                                           AS available_quantity,
    SUM(CASE WHEN legacy.owner_type='ENTERPRISE' THEN legacy.quantity ELSE 0 END)
                                                           AS enterprise_owned_quantity
  FROM inventory legacy
  WHERE legacy.active=1
  GROUP BY legacy.warehouse_id, legacy.product_id
```

**禁止**：

```text
SELECT one arbitrary inventory row WHERE warehouse_id=? AND product_id=?
```

#### C. Legacy Writes — adjustInventory() 处理

`adjustInventory()` 最终只能：

- **C-1**：被替换为 canonical mutation primitive（首选）；
- **C-2**：或明确降级为 compatibility adapter，仅允许：

```text
ENTERPRISE owner
AVAILABLE status
NULL / default bin
no LOT / SERIAL special identity
```

owner-aware / status-aware / bin-aware / tracking-aware 路径 **禁止** 调用 `adjustInventory()`。

#### D. Activation Gate

在下列 non-default dimensions 正式可写之前：

```text
SUPPLIER owner
CUSTOMER owner
non-default bin
non-AVAILABLE stock status
```

必须证明：

```text
全部 physical mutation callers 已经完成 convergence（§27.43.1 A）
adjustInventory() 已替换或降级（§27.43.1 C）
legacy read path 走 compatibility view（§27.43.1 B）
```

不得依赖"以后逐步迁移"。Activation gate 是 Domain 5 Implementation 阶段 mandatory check。

### 27.44 Compatibility Read Contract

既有 frozen domains 仍可能按 `inventory(warehouse_id, product_id)` 读取。Design 提供 compatibility read：

```text
inventory_compatibility_view (read-only):
  SELECT
    legacy.warehouse_id, legacy.product_id,
    SUM(legacy.quantity)                                  AS total_quantity,
    SUM(CASE WHEN legacy.stock_status='AVAILABLE' THEN legacy.quantity ELSE 0 END)
                                                         AS available_quantity,
    SUM(CASE WHEN legacy.owner_type='ENTERPRISE' THEN legacy.quantity ELSE 0 END)
                                                         AS enterprise_owned_quantity
  FROM inventory legacy
  WHERE legacy.active=1
  GROUP BY legacy.warehouse_id, legacy.product_id
```

不得要求前四域一次全部重写 UI / API。但所有新的 physical writes 必须走 canonical mutation contract（§27.8）。

**禁止** legacy code 直接 `SELECT one arbitrary inventory row WHERE warehouse_id=? AND product_id=?`。所有 read 必须 aggregate 全部 canonical positions。

### 27.45 RBAC / Permission

新增最小 permission family：

```text
INVENTORY_PARAMETERS_VIEW / MANAGE
WAREHOUSE_VIEW / MANAGE
WAREHOUSE_BIN_VIEW / MANAGE
STOCK_STATUS_VIEW / MANAGE
OWNER_DIMENSION_VIEW
INVENTORY_TRANSFER_VIEW / MANAGE
INVENTORY_STEP_TRANSFER_VIEW / MANAGE
INVENTORY_LOCK_VIEW / MANAGE
INVENTORY_OPENING_VIEW / MANAGE
INVENTORY_NATIVE_DOCUMENT_VIEW / MANAGE
INVENTORY_STOCKTAKE_VIEW / MANAGE
INVENTORY_ADJUSTMENT_VIEW / MANAGE
INVENTORY_SCRAP_VIEW / MANAGE          -- 既有 KEEP
INVENTORY_LOT_ADJUSTMENT_VIEW / MANAGE
INVENTORY_FORM_CONVERSION_VIEW / MANAGE
INVENTORY_ASSEMBLY_VIEW / MANAGE
INVENTORY_BARCODE_RULE_VIEW / MANAGE
INVENTORY_CONTAINER_VIEW / MANAGE
INVENTORY_REPORT_VIEW
```

既有 `INVENTORY_SCRAP_*` / `INVENTORY_CHECK_*` / `INVENTORY_TRANSFER_*` / `INVENTORY_ADJUSTMENT_*` 保留，不重命名。

最小新增数 ≈ 32；最终 PERMISSIONS 数量由 Implementation 实际登记决定。

### 27.46 Audit / Transaction / State machine

- 所有 mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- audit 写入关键 mutation：IN / OUT / MOVE / OWNER_CHANGE / STATUS_CHANGE / LOT_RECLASS / BIN_MOVE / ADJUSTMENT / SCRAP / VMI_* / OUTSOURCING_* / ENTRUSTED_* / LOCK / UNLOCK / PERIOD CLOSE / REOPEN / OPENING CLOSE；
- 既有 `audit(actor, action, entity, id, payload)` 复用；
- 既有的 5 个 role seed 保留；
- 既有的 `INVENTORY_SCRAP_*` / `INVENTORY_CHECK_*` / `INVENTORY_TRANSFER_*` / `INVENTORY_ADJUSTMENT_*` permission 不破坏；
- 不绕过 mutation contract；
- 不引入 second ledger / second mutation engine。

### 27.47 UI Information Architecture

Mobile Inventory & Warehouse 至少规划：

```text
1. Inventory Overview / Instant Stock      (hub)
2. Warehouses & Bins                      (master + bin mgmt)
3. Transfers                              (direct + step + in-transit)
4. Native Receipt / Issue                 (other receipt / issue)
5. Stocktake                              (regular + cycle)
6. Adjustment / Scrap / Status            (adjustment / scrap / status)
7. Tracking / Owner / Locks               (LOT / SERIAL / expiry / owner / lock)
8. Barcode / Scan                         (barcode rules + scan adapter)
9. Reports                                (instant / ledger / aging / alerts)
10. Period Close                          (period close / reopen)
```

合并为较少 route / hub。建议：

```text
inventory-overview       (1 + 9 部分入口)
inventory-transfer       (3)
inventory-stocktake      (5)
inventory-adjustment     (6)
inventory-tracking       (7)
inventory-barcode        (8)
inventory-period         (10)
inventory-master         (2 + 4)
```

实际 route 数 ≤ 8；launcher 数 ≤ 6（Hub + Transfers + Stocktake + Adjustment + Tracking + Barcode）。

Mobile-first：390 CSS px primary；同时验证 320 / 430 / 680。

LIST → DETAIL → EDITOR / WORKFLOW。

仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`。

不得修改业务术语、API、permission、state machine、source / downstream、inventory / accounting facts。

### 27.48 Final Functional UAT Contract (28)

```text
UAT-01  warehouse / bin maintenance
UAT-02  enterprise-owned stock query
UAT-03  supplier-owned VMI stock
UAT-04  customer-owned entrusted stock
UAT-05  direct transfer
UAT-06  step transfer out / in-transit / in
UAT-07  inventory lock / unlock
UAT-08  stock-status change
UAT-09  LOT movement
UAT-10  SERIAL movement
UAT-11  expiry block
UAT-12  other receipt
UAT-13  other issue
UAT-14  opening inventory + close initialization
UAT-15  regular stocktake
UAT-16  cycle stocktake
UAT-17  stocktake gain / loss
UAT-18  adjustment
UAT-19  scrap
UAT-20  VMI ownership transfer
UAT-21  outsourcing supplier-WIP position
UAT-22  barcode stock query
UAT-23  barcode stocktake
UAT-24  scan validation
UAT-25  container pack / unpack
UAT-26  inventory reports
UAT-27  inventory period close / reopen
UAT-28  available = physical - locks - reservations
```

最终目标：`28 / 28 PASS`。

### 27.49 Responsive Contract

```text
Widths:  320 / 390 / 430 / 680
Checks:  no document overflow
         no clipped action
         touch target >= 44px
         no inaccessible sheet / dialog
         no console / pageerror
```

### 27.50 Final Automated Gates

Implementation 最终必须一次提供：

```text
pnpm test:fast
pnpm test
pnpm test:heavy
pnpm test:mysql
pnpm test:mysql:concurrency
pnpm test:mysql:performance
pnpm build
git diff --check
Functional UAT  28 / 28 PASS
Responsive UAT  (per §27.49)
```

不允许 Implementation Report 再写：`MySQL later` / `Browser UAT later` / `Concurrency later`。

### 27.51 Implementation Waves — 5 Waves

```text
Wave A
  Canonical Identity / Owner / Bin / Status / Migration
  - inventory-position.js (position_key)
  - inventory-parameters.js
  - warehouse-master.js (EXTEND)
  - warehouse-bin.js
  - stock-status.js
  - owner-dimension.js
  - inventory schema migration (additive)
  - inventory-extensions.js convergence (initial)

Wave B
  Mutation Contract / Availability / Lock / Transfer / VMI convergence
  - inventory-mutation.js (applyInventoryMutation dispatcher)
  - inventory-availability.js (ON_HAND/LOCKED/RESERVED/AVAILABLE)
  - inventory-lock.js
  - inventory-transfer.js (EXTEND)
  - inventory-step-transfer.js
  - 删除 procurement-vmi.js::assertInventoryOwnerDimension
  - VMI 物理 OWNER_CHANGE / IN(SUPPLIER) / OUT(SUPPLIER) 真实接入
  - Outsourcing Issue/Return/Backflush 物理 mutation 接入
  - Entrusted Receipt/Issue 真实接入

Wave C
  Opening / Native Documents / Stocktake / Conversion
  - inventory-opening.js (initialization / opening docs / close / reopen)
  - inventory-native-document.js (OTHER_RECEIPT / OTHER_ISSUE)
  - inventory-stock-status-mutation.js
  - inventory-lot-adjustment.js
  - inventory-form-conversion.js
  - inventory-assembly-disassembly.js (consume Engineering BOM)
  - inventory-adjustment-scrap.js convergence
  - inventory-stocktake.js (REGULAR / CYCLE / snapshot / diff)
  - inventory-abc-classifications.js
  - 14 个 race focused tests

Wave D
  Barcode / Container / Reports / Alerts
  - inventory-barcode.js (rule / binding / parse / resolution log)
  - inventory-scan-adapter.js (resolveScan + idempotency + duplicate)
  - inventory-container.js (container / pack / unpack / transfer / inquiry)
  - inventory-reports.js (instant / ledger / aging / slow-moving / alerts / ABC / serial)
  - inventory-period-close.js EXTEND (close / reopen / snapshot / mutation block)
  - 5 个 UAT batch 集成测试

Wave E
  Mobile UI / Cross-domain convergence / Acceptance
  - src/pages/inventory-overview / inventory-transfer / inventory-stocktake
    / inventory-adjustment / inventory-tracking / inventory-barcode
  - applicationRegistry 新 routes / launcher
  - 28 Functional UAT + Responsive UAT
  - final canonical gates
```

后续不得再膨胀成 A-J。Wave 数固定 5。

### 27.52 Capability Trace (44 / 44)

```text
INV-01..INV-08     Foundation & Physical Stock        (8)
INV-09..INV-14     Initialization & Native Documents (6)
INV-15..INV-21     Movement & Conversion             (7)
INV-22..INV-28     Tracking & Inventory Control      (7)
INV-29..INV-32     Stocktake & Period Control        (4)
INV-33..INV-38     Reports & Alerts                  (6)
INV-39..INV-44     Barcode / Warehouse Scan Core     (6)

TOTAL = 44

Domain-Owned      = 40
Integration-Backed = 4
  INV-08  Planning Reservation
  INV-17  Engineering BOM
  INV-40  Business Document Scan Adapter
  INV-41  Business Document Validation
```

每项 Requirement ID → Design owner / schema / service / integration / acceptance evidence（Design 仅做映射，不复制 Requirement 文本）：

| ID | Design owner module / service | schema / integration | acceptance evidence (placeholder for Implementation) |
|---|---|---|---|
| INV-01 | `inventory-parameters.js` | `inventory_parameters` | focused + UAT-14 |
| INV-02 | `warehouse-master.js` | `warehouses` EXTEND | focused + UAT-01 |
| INV-03 | `warehouse-bin.js` | `warehouse_bins` NEW | focused + UAT-01 |
| INV-04 | `stock-status.js` | `inventory_stock_statuses` NEW | focused + UAT-08 |
| INV-05 | `owner-dimension.js` | `inventory.owner_type / owner_id` | focused + UAT-03 / UAT-04 / UAT-20 |
| INV-06 | `inventory-position.js` | `inventory.position_key` UNIQUE | focused + UAT-02 / UAT-21 |
| INV-07 | `inventory-mutation.js` | `inventory + inventory_transactions + tracked_inventory_movements` | focused + all UAT + 14 race |
| INV-08 | `inventory-availability.js` | reads `planning_reservations` | Integration-Backed — Planning; UAT-28 |
| INV-09 | `inventory-opening.js` | `inventory_initialization.enabled_at` | focused + UAT-14 |
| INV-10 | `inventory-opening.js` | `opening_inventory_documents / items` | focused + UAT-14 |
| INV-11 | `inventory-opening.js` | `inventory_initialization.status` lifecycle | focused + UAT-14 |
| INV-12 | `inventory-mutation.js` via Entrusted Receipt path | `inventory.owner_type='CUSTOMER'` | focused + UAT-04 |
| INV-13 | `inventory-native-document.js` | `inventory_native_documents` | focused + UAT-12 |
| INV-14 | `inventory-native-document.js` | `inventory_native_documents` | focused + UAT-13 |
| INV-15 | `inventory-transfer.js` | `inventory_transfers` EXTEND + `inventory` MOVE | focused + UAT-05 |
| INV-16 | `inventory-step-transfer.js` | `inventory_step_transfer_in_transit` NEW | focused + UAT-06 |
| INV-17 | `inventory-assembly-disassembly.js` | consumes `engineering-bom.js` resolver | Integration-Backed — Engineering BOM; focused |
| INV-18 | `inventory-lot-adjustment.js` | `inventory_lots` + `inventory_lot_balances` | focused + UAT-09 |
| INV-19 | `inventory-stock-status-mutation.js` | `inventory_stock_statuses` | focused + UAT-08 |
| INV-20 | `inventory-form-conversion.js` | consumes Master Data / Engineering | focused |
| INV-21 | `inventory-adjustment-scrap.js` | `inventory_adjustments` + `inventory_scraps` EXTEND | focused + UAT-18 / UAT-19 |
| INV-22 | `traceability-quality.js` EXTEND | `inventory_lots / inventory_lot_balances` | focused + UAT-09 |
| INV-23 | `traceability-quality.js` EXTEND | `inventory_lots.expiry_date / manufacture_date` | focused + UAT-11 |
| INV-24 | `traceability-quality.js` EXTEND | `inventory_serials` | focused + UAT-10 |
| INV-25 | `inventory-parameters.js` + product additive | `inventory.aux_*` (optional) | focused |
| INV-26 | `inventory-abc-classifications.js` | `inventory_abc_classifications` NEW | focused + UAT-16 |
| INV-27 | `inventory-reports.js` | reads canonical | focused + UAT-26 |
| INV-28 | `inventory-lock.js` | `inventory_locks` NEW | focused + UAT-07 |
| INV-29 | `inventory-stocktake.js` | `inventory_checks` EXTEND (`check_kind='REGULAR'`) | focused + UAT-15 |
| INV-30 | `inventory-stocktake.js` | `inventory_checks` EXTEND (`check_kind='CYCLE'`) | focused + UAT-16 |
| INV-31 | `inventory-stocktake.js` confirm | applyInventoryMutation(ADJUSTMENT, diff) | focused + UAT-17 |
| INV-32 | `inventory-period-close.js` EXTEND | `inventory_period_closures / snapshots` | focused + UAT-27 |
| INV-33 | `inventory-reports.js` | reads canonical movements | focused + UAT-26 |
| INV-34 | `inventory-reports.js` | reads canonical balances + movements | focused + UAT-26 |
| INV-35 | `inventory-reports.js` | reads canonical balances + Finance valuation evidence | focused + UAT-26 |
| INV-36 | `inventory-reports.js` | reads canonical movements (movement age) | focused + UAT-26 |
| INV-37 | `inventory-reports.js` + `inventory_alert_thresholds` | reads canonical + threshold params | focused + UAT-26 |
| INV-38 | `inventory-reports.js` | reads ABC + SERIAL canonical | focused + UAT-26 |
| INV-39 | `inventory-barcode.js` | `inventory_barcode_rules / bindings / resolution_log` | focused + UAT-22 |
| INV-40 | `inventory-scan-adapter.js` | adapter contract only | Integration-Backed — Business Domains; UAT-24 |
| INV-41 | `inventory-scan-adapter.js` | physical validation helper | Integration-Backed — Business Domains; UAT-24 |
| INV-42 | `inventory-scan-adapter.js` + `inventory-stocktake.js` | `inventory_check_items` insert | focused + UAT-23 |
| INV-43 | `inventory-reports.js` scan query | reads canonical inventory | focused + UAT-22 |
| INV-44 | `inventory-container.js` | `inventory_containers / items` | focused + UAT-25 |

```text
44 / 44 mapped
40 Domain-Owned
4 Integration-Backed
```

### 27.53 Rollback Strategy

- 应用代码回退到既有 mutation path（既有 `adjustInventory` 暂时兼容 wrapper）；
- additive 列保留（旧 schema 仍能读）；
- 不 destructive down-migrate；
- 既有 release tag `v1.6.2` 不破坏；
- MySQL migration 出现 mismatch 时 fail-closed，不自动 fix；
- 关闭 WAVE E 前的任何中间态都允许 rollback 至上一 Wave 完成态。

### 27.54 Final Acceptance

- focused tests：Wave A-E focused suites（每 Wave 5+ focused tests）；
- canonical：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- MySQL（受保护 disposable MySQL 8 环境）：`pnpm test:mysql` + `pnpm test:mysql:concurrency`（14 race）+ `pnpm test:mysql:performance` 全 PASS；
- Functional UAT 28 / 28 PASS；
- Responsive UAT 6 surfaces × 4 widths = 24 / 24 PASS；
- 兼容性 contract：既有 frozen domains 通过 compatibility view 仍可读 `(warehouse_id, product_id)` aggregate；
- 既有 5 role seed 不破坏；既有 `INVENTORY_*` / `INVENTORY_SCRAP_*` / `INVENTORY_CHECK_*` permission 不破坏；
- 最终用户 PASS 后方可 Freeze。

Final verdict（本节 Design）：`READY FOR USER REVIEW`。后续 Implementation 严禁扩张 5 Wave，不得补充 race list 之外的 concurrency case，不得修改 capability IDs 与 owner accounting。
