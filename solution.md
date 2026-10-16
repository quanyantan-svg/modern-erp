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

> **历史 high-level 流向描述。canonical Finance Operations technical design 见 `§28`（包含 recognition policy、canonical open item、due schedule、settlement、treasury movement、business close、API、permission、waves、UAT / RACE trace）。本节不再作为实现入口。**

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

实现层必须经 `recognizeFinanceExposure`（§28.2.3）+ `applyTreasuryMovement`（§28.11.4）；不得散落到各 Domain handler。

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

> **历史 high-level 描述。canonical Finance Operations technical design 见 `§28`，包含 recognition policy、open-item canonical equation、due schedule、provisional / final state、settlement allocation、treasury movement、bank reconciliation、business close、API、permission、waves、UAT / RACE trace。**
>
> **B3106 存货核算 / B3107 固定资产 / B3114 智能会计平台 已归 `Accounting & Analytics`，本节 §13.3 / §13.4 / §13.5 仅作为 cross-domain boundary 提示，不在 Finance Operations canonical 范围。**

### 13.1 AR/AP

AR/AP 必须基于 immutable source。canonical equation / status / effects ledger / reconciliation 见 §28.3。

Open amount/status 可以缓存，但权威仍来自：

- source；
- credit/refund/write-off；
- confirmed allocation；
- reversal。

### 13.2 Invoice/Bill

物流与商业确认分离：

- Delivery ≠ Sales Invoice
- Receipt ≠ Supplier Bill

Sales Invoice 才建立当前销售商业 AR/Revenue 事实；Supplier Bill 才建立正式采购 AP/Input Tax 等商业事实。canonical invoice model / source cardinality / credit-void 见 §28.10。

### 13.3 Inventory Cost

> **归属 Accounting & Analytics（B3106）。**本节保留作为 cross-domain boundary 描述，canonical cost engine / valuation / GRNI / WIP 由 Accounting & Analytics 接管；Finance Operations 仅 consume `getFinancialSourceFacts` (FO57) 与 `emitAccountingEvent` (FO58) 接口。

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

> **归属 Accounting & Analytics（B3107）。**本节保留作为 cross-domain boundary 描述；canonical asset card / change / split-merge / depreciation / disposal 由 Accounting & Analytics 接管。

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

> **归属 Accounting & Analytics（B3114）。**本节保留作为 cross-domain boundary 描述；canonical Smart Accounting Engine / Voucher Template / Condition / Account Mapping 由 Accounting & Analytics 接管。Finance Operations 通过 FO58 `emitAccountingEvent` 调用既有 voucher adapter。

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

### 27.55 Final MySQL Verification Technical Corrections（2026-10-10）

本节只记录 Final Verification 中确认的实现事实，不改变 44 capability、40 + 4 accounting、14 race、28 UAT 或 5 Waves。

- `financial-inventory.js::systemHealth` 的 LOT / SERIAL reconciliation 分别从 canonical `inventory` 聚合与 tracking 派生子查询取数，避免多维库存 join multiplication，并兼容 MySQL `ONLY_FULL_GROUP_BY`。
- legacy inventory transfer 在 LOT / SERIAL allocation 已解析时，按明确的 `lot_id / serial_id` canonical position 更新源与目标；NONE 路径仍使用受限 default-position compatibility adapter。调拨前后余额均按 active positions 聚合，不读取任意单行。
- `inventory_mutation_log` 与 `inventory_step_transfer_in_transit` 由 `migrateInventoryPositionSchema` 在启动/升级阶段创建。业务事务不再把这两张表的首次 DDL 当作正常写路径，避免 MySQL DDL implicit commit 破坏原子性。
- `applyInventoryMutation` 对涉及的 `position_key` 去重、按字典序 ASC 排序，并在 MySQL 使用 `FOR UPDATE`；idempotency evidence 在 MySQL 同样锁定后读取。
- `test:mysql:concurrency` 依次运行 Generic Phase 7B、Procurement/Outsourcing 与 Inventory/Warehouse 三套真实 MySQL suite。Inventory suite 使用独立进程/连接并在启动时 positive assert `db.dialect === 'mysql'`，覆盖冻结的 RACE-01..RACE-14，不以 SQLite race 替代 MySQL 证据。
- canonical test fixtures 使用 `UNIQUE(position_key)` 对应的 canonical helper；不恢复 `UNIQUE(warehouse_id, product_id)`，不削弱 owner/bin/status/lot/serial identity。

Final verification evidence：`pnpm test:mysql`、`pnpm test:mysql:concurrency`（Inventory 14 / 14 on MySQL）、`pnpm test:mysql:performance`（all writer levels errors=0）、`pnpm test:fast`、`pnpm test`（2309 / 2309；fail/cancelled/skipped/todo=0）、`pnpm test:heavy`、`pnpm build` 与 `git diff --check` 全部作为最终 acceptance gate 保存于当日开发日志；`.tmp/*.log` 仅为未提交诊断证据。

---

# 28. Finance Operations Domain Closure Technical Design

> 本节为 **canonical technical design** for Finance Operations Domain Closure。
> 需求合同见 `document.md §33`（58 capability = 55 Domain-Owned + 3 Integration-Backed，14 invariant F1–F14，32 UAT，15 MySQL RACE，3 Canonical Recognition Models）。
> 早期 Finance technical 内容（§9.4 / §13）保留为 historical context；以本节为唯一权威。
> 本节实现后取代 `solution.md §13.1 / §13.2` 中关于 AR / AP / Invoice 的旧描述；`§13.3 / §13.4 / §13.5` 已由 `document.md §33.1.3` normalization 明确归属 Accounting & Analytics，本节不重复。
> Implementation 阶段严禁新增 capability ID、UAT、RACE；不得绕开 §28 引入第二 AR/AP ledger 或第二 Treasury movement engine。

## 28.0 Scope of This Section

A–S outputs as required by `document.md §33.5 / §33.39 / §33.40` and the Phase §6 Design Principles:

```text
A.  Finance domain architecture & ownership
B.  Recognition state model
C.  Canonical AR/AP open-item model
D.  Due-schedule model
E.  Provisional model
F.  Settlement/allocation model
G.  Treasury movement model
H.  Invoice model
I.  Bank statement/reconciliation model
J.  Business close model
K.  Integration adapters
L.  Permission model
M.  API/route architecture
N.  Mobile information architecture
O.  Migration / convergence strategy
P.  Transaction / locking model
Q.  MySQL race design (15)
R.  UAT traceability (32)
S.  Implementation waves (5)
```

Capability / UAT / RACE / Wave 计数不变（58 / 32 / 15 / ≤5）。

## 28.1 Architecture & Ownership

### 28.1.1 Canonical Service Ownership & Module Responsibility Map

按 `document.md §33.1` ownership，Finance Operations Domain 形成如下 canonical service ownership（命名空间冻结；后续 Implementation 不得新增第二引擎）：

> **本节不冻结 source-file count**。下表为 canonical service ownership / writer responsibility / domain module responsibility map；物理文件数量可在 Implementation 阶段自由调整（如拆分 helper module、合并 co-located route + service、引入 internal lib）而**不重开 Design**。

```text
Finance Operations Canonical Services
  finance-recognition-policy        (FO01 / FO02)
  finance-parameters                (FO01)
  finance-terms                     (FO03)
  finance-due-schedule              (FO04)
  finance-settlement-scheme         (FO05)

  finance-ar-init                   (FO06)
  finance-ap-init                   (FO07)
  finance-treasury-init             (FO08)

  finance-ar-open-item              (FO09 / FO11)
  finance-ap-open-item              (FO10 / FO12)
  finance-provisional-conversion    (FO13)
  finance-manual-ar-ap              (FO14)
  finance-counterparty-transfer     (FO15)

  finance-collection                (FO16)
  finance-payment                   (FO17)
  finance-allocation                (FO18)
  finance-reconciliation            (FO19 / FO20 / FO21)
  finance-settlement-reversal       (FO22)
  finance-unapplied-balance         (FO23 / FO24 / FO25 / FO26)

  finance-write-off                 (FO27)
  finance-bad-debt-provision        (FO28)

  finance-sales-invoice             (FO29 / FO31 / FO32 / FO33 / FO34 / FO36)
  finance-purchase-invoice          (FO30 / FO31 / FO35 / FO36)

  finance-settlement-account        (FO37 / FO38)  ← extends bank_accounts (§28.11.1)
  finance-treasury-movement         (FO39)
  finance-treasury-cash             (FO40)
  finance-treasury-bank-transfer    (FO41)
  finance-notes                     (FO42 / FO43)
  finance-payment-request           (FO44)
  finance-cash-count                (FO45)

  finance-bank-statement            (FO46)
  finance-bank-import               (FO47)
  finance-bank-reconciliation       (FO48 / FO49)

  finance-business-close            (FO51 / FO52 / FO53)

  finance-reports                   (FO54 / FO55 / FO56)

Integration-Backed Services
  finance-source-adapter            (FO57)  [INTEGRATION-BACKED]
  finance-accounting-adapter        (FO58)  [INTEGRATION-BACKED]
  finance-gl-reconcile              (FO50)  [INTEGRATION-BACKED]

Converged Existing Canonical Implementations
  settlement-core  ← used by FO16 / FO17 / FO18
  settlement       ← FO21 records & trace
  financial-controls ← FO22 / FO23–FO26 / FO27
  discounts        ← FO26 / sales-discount finance effect
  commercial-golive ← FO06 / FO07 / FO08 initialization
```

禁止命名（document.md §33.43）：

```text
settlement-v2
treasury-v2
new_ar_ledger
new_ap_ledger
finance-recognition-policy-v2
finance-treasury-movement-v2
```

Canonical Writers（implementation 阶段必须由以下唯一入口承载；其它任何代码路径不得直接写入对应表）：

```text
recognizeFinanceExposure              → account_receivables / account_payables (canonical open-item header; refreshOpenAmount rebuilds finance_open_item_effects VIEW projection)
applyTreasuryMovement                 → finance_treasury_movements + bank_accounts.balance_cents cache
convertProvisionalToFinancial         → account_receivables / account_payables (canonical header; conversion_state + converted_open_item_id)
executeCounterpartyTransfer           → account_receivables / account_payables (canonical header; provisional_origin_id / converted_open_item_id lineage)
assertFinanceBusinessDateOpen         → finance_business_close_state (FOR UPDATE)
refreshOpenAmount(openItemId)         → reads finance_open_item_effects VIEW only (chain: source facts → VIEW → equation → cached open_amount_cents; §28.3.2.1)
refreshSettlementAccountBalance(id)   → derived projection from finance_treasury_movements (§28.11.3)
emitAccountingEvent                   → Accounting & Analytics existing voucher adapter (§28.14.2)
```

`finance_open_item_effects` 是 DERIVED SQL VIEW（§28.3.4），不归入任何 writer；任何路径均不 INSERT / UPDATE / DELETE 该 view（view 不允许）。

### 28.1.2 Canonical Table Inventory (Exact)

下表是 Finance Operations Domain 唯一权威 table inventory；每一个 distinct physical relation 单独列出（header 与 line table 各自计数）。

#### 28.1.2.1 EXISTING_CONVERGE（已存在 / additive 扩展；非 NEW）

| Table | Owner | Purpose | PK | Critical Unique |
|---|---|---|---|---|
| `account_receivables` | finance-ar-open-item | canonical open-item header AR | `id TEXT` | `voucher_no TEXT UNIQUE` |
| `account_payables` | finance-ap-open-item | canonical open-item header AP | `id TEXT` | `voucher_no TEXT UNIQUE` |
| `payment_collections` | finance-collection | collection document | `id TEXT` | `collection_no TEXT UNIQUE` |
| `payment_disbursements` | finance-payment | payment document | `id TEXT` | `disbursement_no TEXT UNIQUE` |
| `payment_collection_items` | finance-allocation | collection allocation line | `id TEXT` | `(payment_collection_id, open_item_id)` composite unique |
| `payment_disbursement_items` | finance-allocation | payment allocation line | `id TEXT` | `(payment_disbursement_id, open_item_id)` composite unique |
| `financial_credit_adjustments` | financial-controls | commercial credit adjustment history | `id TEXT` | per-row |
| `settlement_unapplied_balances` | finance-unapplied-balance | unapplied PREPAYMENT / CREDIT | `id TEXT` | `(source_type, source_id) UNIQUE` |
| `balance_applications` | finance-unapplied-balance | unapplied → open-item application | `id TEXT` | `application_no TEXT UNIQUE` |
| `financial_refunds` | finance-unapplied-balance | unapplied balance refund | `id TEXT` | `refund_no TEXT UNIQUE` |
| `financial_refund_reversals` | finance-unapplied-balance | refund reversal | `id TEXT` | `refund_id TEXT UNIQUE` |
| `settlement_reversals` | finance-settlement-reversal | settlement reversal header | `id TEXT` | `reversal_no TEXT UNIQUE` |
| `settlement_reversal_items` | finance-settlement-reversal | reversal component line | `id TEXT` | `(reversal_id, component_type, original_component_id) UNIQUE` |
| `financial_write_offs` | finance-write-off | write-off header | `id TEXT` | `write_off_no TEXT UNIQUE` |
| `financial_write_off_reversals` | finance-write-off | write-off reversal | `id TEXT` | `write_off_id TEXT UNIQUE` |
| `bank_statements` | finance-bank-statement | bank statement header | `id TEXT` | per-row |
| `bank_statement_items` | finance-bank-statement | bank statement line | `id TEXT` | `import_fingerprint TEXT UNIQUE` |
| `bank_accounts` | finance-settlement-account | **canonical operational settlement account master (FO37)**; additive extend CASH/BANK + opening_balance_cents + accounting_subject_id; `balance_cents` = derived cache | `id TEXT` | `code TEXT UNIQUE` (after additive extend) |
| `sales_invoices` | finance-sales-invoice | sales invoice document | `id TEXT` | `invoice_no TEXT UNIQUE` |
| `supplier_bills` | finance-purchase-invoice | purchase invoice document | `id TEXT` | `bill_no TEXT UNIQUE` |
| `commercial_credit_notes` | finance-sales-invoice | credit/red note document | `id TEXT` | `note_no TEXT UNIQUE` |

#### 28.1.2.2 NEW（Implementation 阶段 additive 新建）

| # | Table | Owner | Purpose | PK | Critical Unique |
|---|---|---|---|---|---|
| 1 | `finance_parameters` | finance-parameters | FO01 finance parameters singleton | `id TEXT` | `code TEXT UNIQUE` |
| 2 | `finance_recognition_policy` | finance-recognition-policy | FO02 recognition policy per (side, source_type, source_id) | `id TEXT` | `(side, source_type, source_id, effective_date) UNIQUE` |
| 3 | `finance_payment_terms` | finance-terms | FO03 collection/payment terms master | `id TEXT` | `code TEXT UNIQUE` |
| 4 | `finance_due_schedule_lines` | finance-due-schedule | FO04 multi-due-date schedule line | `id TEXT` | `(side, open_item_id, sequence) UNIQUE` |
| 5 | `finance_settlement_schemes` | finance-settlement-scheme | FO05 reconciliation scheme config | `id TEXT` | `(side, scheme_code) UNIQUE` |
| 6 | `finance_counterparty_transfers` | finance-counterparty-transfer | FO15 transfer header | `id TEXT` | `transfer_no TEXT UNIQUE` |
| 7 | `finance_counterparty_transfer_lines` | finance-counterparty-transfer | FO15 transfer line | `id TEXT` | `(transfer_id, source_open_item_id, side) UNIQUE` |
| 8 | `finance_bad_debt_provisions` | finance-bad-debt-provision | FO28 bad-debt provision header | `id TEXT` | `provision_no TEXT UNIQUE` |
| 9 | `finance_invoice_source_links` | finance-invoice-cardinality | FO31 invoice source cardinality | `id TEXT` | `(invoice_id, invoice_side, source_type, source_id, source_line_id) UNIQUE` |
| 10 | `finance_treasury_movements` | finance-treasury-movement | FO39 canonical treasury movement | `id TEXT` | `idempotency_key TEXT UNIQUE` |
| 11 | `finance_notes` | finance-notes | FO42/FO43 notes receivable/payable | `id TEXT` | `note_no TEXT UNIQUE` |
| 12 | `finance_payment_requests` | finance-payment-request | FO44 payment request | `id TEXT` | `request_no TEXT UNIQUE` |
| 13 | `finance_cash_counts` | finance-cash-count | FO45 cash count header | `id TEXT` | `count_no TEXT UNIQUE` |
| 14 | `finance_cash_count_lines` | finance-cash-count | FO45 cash count denomination line | `id TEXT` | `(count_id, denomination) UNIQUE` |
| 15 | `finance_bank_statement_imports` | finance-bank-import | FO47 bank statement import batch | `id TEXT` | `(file_name, fingerprint) UNIQUE` |
| 16 | `finance_bank_reconciliations` | finance-bank-reconciliation | FO48 reconciliation header (canonical) | `id TEXT` | `(settlement_account_id, statement_id) UNIQUE` |
| 17 | `finance_bank_reconciliation_matches` | finance-bank-reconciliation | FO48 reconciliation match line | `id TEXT` | `(reconciliation_id, statement_line_id, treasury_movement_id) UNIQUE` |
| 18 | `finance_business_close_state` | finance-business-close | **stable control anchor** (FO51/FO52/FO53 RACE-15 lock target; seeded with exactly 3 rows: AR / AP / TREASURY) | `close_type TEXT` | `close_type PRIMARY KEY` |
| 19 | `finance_business_closures` | finance-business-close | FO51/FO52/FO53 close / reopen history rows | `id TEXT` | `(close_type, closed_through_date) UNIQUE` |

#### 28.1.2.3 COMPATIBILITY（仅 read 投影 / 兼容层；不得作为 active canonical master）

> **分类互斥**：每张物理表**恰好**归入 EXISTING_CONVERGE / NEW / COMPATIBILITY 之一；不得重复列出。

| Table | Status | Purpose |
|---|---|---|
| `cash_journals` | COMPATIBILITY document/read model | §28.11.4 — write path 迁移至 `applyTreasuryMovement`；保留为 read projection / report |
| `bills` | COMPATIBILITY legacy | legacy notes; migration 到 `finance_notes` 后 read-only |
| `bank_reconciliations` | COMPATIBILITY legacy | legacy reconciliation header; canonical 由 `finance_bank_reconciliations` 接管；legacy 路径 read-only |
| `period_closures` | COMPATIBILITY / Accounting & Analytics | accounting period close 由 Accounting & Analytics 拥有；Finance Operations 不写 |

#### 28.1.2.4 DERIVED_VIEW（DERIVED SQL VIEW，非物理表）

| # | View | Owner | Purpose | Logical Uniqueness |
|---|---|---|---|---|
| 1 | `finance_open_item_effects` | finance-open-item-effect | DERIVED SQL VIEW 投影 4 canonical effect categories（§28.3.4）；non-authoritative / non-persisted / rebuild-free；no INSERT / UPDATE / DELETE permitted | `(source_table, source_effect_id)` |

> **此 view 是唯一 Finance Operations 派生 SQL VIEW**；任何其它对象不归入 DERIVED_VIEW。

#### 28.1.2.5 Exact Counts

```text
physical EXISTING_CONVERGE tables = 21
physical NEW tables                = 19  (header + line 分计)
physical COMPATIBILITY tables      = 4
derived SQL views                  = 1

分类互斥：每张物理表恰好归入 EXISTING_CONVERGE / NEW / COMPATIBILITY 之一；
view 单独归入 DERIVED_VIEW；无重复列出。
```

EXISTING_CONVERGE（21）：

```text
account_receivables
account_payables
payment_collections
payment_disbursements
payment_collection_items
payment_disbursement_items
financial_credit_adjustments
settlement_unapplied_balances
balance_applications
financial_refunds
financial_refund_reversals
settlement_reversals
settlement_reversal_items
financial_write_offs
financial_write_off_reversals
bank_statements
bank_statement_items
bank_accounts                          ← canonical settlement account master (§28.11.1)
sales_invoices
supplier_bills
commercial_credit_notes
```

COMPATIBILITY（4）：

```text
cash_journals              (read projection; §28.11.4)
bills                      (legacy → finance_notes migration)
bank_reconciliations       (legacy → finance_bank_reconciliations canonical)
period_closures            (Accounting & Analytics compatibility)
```

DERIVED_VIEW（1）：

```text
finance_open_item_effects  (DERIVED SQL VIEW over canonical source facts; §28.3.4)
```

NEW 表 #1..#19 物理表清单：

```text
  1  finance_parameters
  2  finance_recognition_policy
  3  finance_payment_terms
  4  finance_due_schedule_lines
  5  finance_settlement_schemes
  6  finance_counterparty_transfers
  7  finance_counterparty_transfer_lines
  8  finance_bad_debt_provisions
  9  finance_invoice_source_links
  10 finance_treasury_movements
  11 finance_notes
  12 finance_payment_requests
  13 finance_cash_counts
  14 finance_cash_count_lines
  15 finance_bank_statement_imports
  16 finance_bank_reconciliations
  17 finance_bank_reconciliation_matches
  18 finance_business_close_state       ← stable anchor (3 seeded rows)
  19 finance_business_closures
```

精确 NEW 表数 = **19**（header + line 分计；唯一权威 inventory）。

本表为唯一权威 inventory；后续 Implementation 不得新建额外 canonical 表 / view（仅允许 additive migration / index）。

`bank_accounts` 归入 EXISTING_CONVERGE（canonical master）。`finance_open_item_effects` 是 DERIVED VIEW，**不**是 NEW 物理表。`bank_reconciliations` 与 `period_closures` 归入 COMPATIBILITY（不归 EXISTING_CONVERGE）。



### 28.1.2 Canonical HTTP Dispatch

`server/app.js` 是 **only** HTTP lifecycle + auth + thin dispatch 层。

每条 finance route 必须：

```text
1. 路由 descriptor 仅声明 route facts（method, path, owner, permission, idempotencyKey）
2. handler = server/modules/<owner>.js 中 exports.fn
3. permission 后端 fail closed（§28.12）
4. transaction 由 owner module 负责（§28.16）
5. audit 由 owner module 负责
```

`ownedRouteTable` 由 `server/modules/finance-routes.js`（或现有 `app.js` route-table 段）单一承载，§28.13 详述。

### 28.1.3 Frontend Domain Mapping

`src/navigation/domainMetadata.js` 中 `finance-operations` taxonomy 已存在；本 Domain Closure 不得破坏既有 `finance-operations` metadata，但 sub-functions 通过 §28.14 mobile IA 收敛。

历史 frozen page 仍可保留 disabled / contextual route，**不得**复活 `cash-journals` / `bills` / `fixed-assets` 作为 active launcher。

## 28.2 Recognition State Model

### 28.2.1 Three Canonical Models

```text
DIRECT_BUSINESS_OPEN_ITEM
INVOICE_DRIVEN_OPEN_ITEM
PROVISIONAL_TO_FINANCIAL
```

#### 28.2.1.1 DIRECT_BUSINESS_OPEN_ITEM

- Confirmed business event（`SALES_DELIVERY` confirm / `PURCHASE_RECEIPT` confirm）→ exactly one final open item created at confirmation time。
- Later invoice / bill 仅 link，不创建 second final open item，不增加 open exposure。
- Source identity 在 invoice post 时仍可识别；`open_item.invoice_id` / `open_item.invoice_line_id` 为 additive reference column。

#### 28.2.1.2 INVOICE_DRIVEN_OPEN_ITEM

- Delivery / receipt 仅产生 operational evidence；**不**创建 AR / AP open item。
- Posted sales invoice → one final AR open item。
- Posted supplier bill / purchase invoice → one final AP open item。
- Source cardinality preserved（§28.10）。

#### 28.2.1.3 PROVISIONAL_TO_FINANCIAL

- `PURCHASE_RECEIPT` confirm 在该 mode 下创建 PROVISIONAL AP open item。
- Posted supplier bill 通过 `convertProvisionalToFinancial`：
  - 必须 reverse PROVISIONAL open item（保留 `provisional_conversion.provisional_open_item_id` + reversal movement evidence）。
  - 必须 create FINAL open item with `source_type = 'SUPPLIER_BILL'` / `source_id = <bill_id>`。
- provisional 与 final 暴露不得 double-count；Settlement 仅 final 参与 `payment_disbursements` allocation（除非 future Requirement 显式放宽）。
- AR 等价 semantics：`SALES_DELIVERY` → PROVISIONAL AR → posted sales invoice → reverse + create FINAL。

### 28.2.2 Recognition Policy (FO01 / FO02)

新增 `finance_recognition_policy` 表 / owner module：

```sql
CREATE TABLE IF NOT EXISTS finance_recognition_policy (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL CHECK(side IN ('AR','AP')),
  recognition_mode TEXT NOT NULL CHECK(recognition_mode IN ('DIRECT_BUSINESS_OPEN_ITEM','INVOICE_DRIVEN_OPEN_ITEM','PROVISIONAL_TO_FINANCIAL')),
  source_type TEXT NOT NULL,        -- e.g. SALES_DELIVERY / PURCHASE_RECEIPT / SALES_INVOICE / SUPPLIER_BILL
  source_id TEXT,                   -- nullable for site-wide default
  effective_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recognition_policy_lookup ON finance_recognition_policy(side, source_type, active, effective_date);
```

- effective default = site-wide row（`source_id IS NULL`），可在 effective_date 之后替换。
- lookup algorithm：`active=1 AND effective_date <= business_date ORDER BY effective_date DESC, id ASC LIMIT 1`；优先 site-wide，再按 source-level override。
- `finance-recognition-policy.js::resolveRecognitionPolicy(side, sourceType, sourceId, businessDate)` 是唯一 policy resolver；其他 handler 不得重新实现选择逻辑。

### 28.2.3 Recognition Adapter (FO23 / §28.4)

唯一 entry：

```text
recognizeFinanceExposure(input: {
  side: 'AR' | 'AP',
  recognitionMode,
  source: { sourceType, sourceId, sourceNo, sourceLineId? },
  invoice: { id?, no?, businessDate } | null,
  amountCents,
  businessDate
}) -> { openItemId, itemKind: 'FINAL' | 'PROVISIONAL', recognizedCents, links }
```

各 Domain handler 仅调用此 adapter：

```text
SALES_DELIVERY.confirm      → recognizeFinanceExposure(DIRECT_BUSINESS_OPEN_ITEM)
PURCHASE_RECEIPT.confirm    → recognizeFinanceExposure(per policy)
SALES_INVOICE.post          → recognizeFinanceExposure(INVOICE_DRIVEN_OPEN_ITEM)
SUPPLIER_BILL.post          → recognizeFinanceExposure(per policy)
```

禁止在 purchase receipt / sales delivery / supplier bill / sales invoice handler 中硬编码 open item 创建；必须经 adapter。

## 28.3 Canonical AR / AP Open-Item Model (MODEL B — Canonical Source Facts)

### 28.3.0 Effect Authority Decision — MODEL B + 4 Canonical Categories

**本 Domain Closure 显式选择 MODEL B：Canonical Source Facts。**

```text
MODEL B — Canonical Source Facts

existing authoritative business / effect tables
  payment_collection_items
  payment_disbursement_items
  financial_credit_adjustments
  balance_applications
  financial_refunds
  settlement_reversal_items       (component_type='ALLOCATION' only contributes to AR/AP)
  financial_write_offs
  financial_write_off_reversals
  commercial_credit_notes         (source-document evidence; financial effect
                                    materializes via financial_credit_adjustments)
  sales_discounts / purchase_discounts (chain via financial_credit_adjustments)
  return effects (chain via financial_credit_adjustments)
= canonical economic facts

refreshOpenAmount()
  reads the finance_open_item_effects VIEW only (DERIVED SQL VIEW; non-persisted)

finance_open_item_effects (DERIVED SQL VIEW)
  = non-authoritative
  = non-persisted
  = rebuild-free
  = NOT a physical table
  = NOT a materialized/cache table
  MUST NEVER be independently written as economic truth
  MUST NEVER be summed in the equation alongside its source facts
  No INSERT / UPDATE / DELETE permitted against it (view disallows).
```

#### 28.3.0.1 Frozen 4 Open-Item Effect Categories

AR / AP open-item remaining amount 由 **exactly 4** canonical categories 构成；不允许第 5 个独立 economic category 除非 Requirement 重开。

| Category | Canonical Source Table | Net-of-Reversal Source | Notes |
|---|---|---|---|
| **A. SETTLEMENT_ALLOCATION** | `payment_collection_items` (AR side) + `payment_disbursement_items` (AP side) | minus `settlement_reversal_items` rows where `component_type='ALLOCATION'` AND the reversed allocation targets this open item | only confirmed effective allocation amount |
| **B. UNAPPLIED_APPLICATION** | `balance_applications` | minus REVERSED applications | only CONFIRMED/effective applications; REVERSED contributes zero |
| **C. CREDIT_ADJUSTMENT** | `financial_credit_adjustments` | net of canonical reversal (status='CONFIRMED' minus REVERSED rows) | typed effects: `RETURN` / `DISCOUNT` / `COMMERCIAL_CREDIT` / `OTHER`; chain: `commercial_credit_notes` / `sales_discounts` / `purchase_discounts` / return source documents → `applyCreditAdjustment` → `financial_credit_adjustments` |
| **D. WRITE_OFF** | `financial_write_offs` | minus `financial_write_off_reversals` | only CONFIRMED amount |

No fifth independent economic category is allowed.

#### 28.3.0.2 Commercial-Credit / Discount / Return Single-Path Rule

Current runtime chain:

```text
commercial_credit_notes
→ applyCreditAdjustment(...)
→ financial_credit_adjustments
```

Therefore:

```text
commercial_credit_notes
= commercial / source-document evidence (audit / trace only)

financial_credit_adjustments
= canonical open-item financial effect
```

Effect path is exactly once via `financial_credit_adjustments`. `refreshOpenAmount()` MUST NOT independently re-sum:

```text
commercial_credit_notes
sales_discounts
purchase_discounts
sales_returns / purchase_returns
```

after their financial effect has materialized into `financial_credit_adjustments`. Those source documents remain trace / audit evidence only.

#### 28.3.0.3 Settlement Reversal Mapping

`settlement_reversal_items` carries `component_type IN ('ALLOCATION', 'UNAPPLIED')`.

```text
component_type = 'ALLOCATION'
  → may reopen an AR / AP open item
  → effective_settlement_allocations(§A) deducts this reversal amount

component_type = 'UNAPPLIED'
  → only affects unapplied-balance lifecycle
  → MUST NOT directly alter AR / AP open item remaining amount
  → §B (UNAPPLIED_APPLICATION) is reduced only via balance_applications.REVERSED rows
     (not via settlement_reversal_items.UNAPPLIED)
```

#### 28.3.0.4 Refund / Reversal Boundary

```text
financial_refunds
financial_refund_reversals
= belong to unapplied-balance truth + treasury truth
= do NOT directly contribute to AR / AP open-item remaining amount
= removed from the open-item equation entirely
```

This preserves the frozen Requirement invariant:

```text
FO22 Settlement Reversal
!=
FO26 Unapplied-Balance Refund
```

#### 28.3.0.5 Conversion / Re-allocation

`CONVERSION (PROVISIONAL → FINAL)` 不改变 total exposure；通过 `account_receivables.conversion_state='CONVERTED'` + `provisional_origin_id` / `converted_open_item_id` 表达；不进入 open-item equation。

#### 28.3.0.6 Forbidden Double-Adjustment

```text
source fact contributes to balance
+
finance_open_item_effects contributes again
for the same economic effect
```

Implementation 阶段必须 fail closed if 任何 mutation 路径绕过 canonical source 表直接 mutate `account_receivables.open_amount_cents` 或 `account_payables.open_amount_cents` 而不经过 source 表 + `refreshOpenAmount()`。

### 28.3.1 Identity & Schema (Canonical Headers)

**确认：`account_receivables` / `account_payables` 仍是 Finance Operations canonical open-item header 表。**

```text
finance_open_item_effects（DERIVED SQL VIEW）
= effects projection (NOT a second open-item header ledger)
= non-authoritative / non-persisted / rebuild-free
= 唯一 Finance canonical 派生 SQL VIEW（§28.1.2.4）
```

保留并 additive 扩展现有 `account_receivables` / `account_payables`（converge 策略见 §28.18）。

最小字段：

```text
id
side                  AR | AP
voucher_no
party_type             CUSTOMER | SUPPLIER
party_id
recognition_mode       DIRECT_BUSINESS_OPEN_ITEM | INVOICE_DRIVEN_OPEN_ITEM | PROVISIONAL_TO_FINANCIAL
item_kind              FINAL | PROVISIONAL
conversion_state       OPEN | CONVERTED  (PROVISIONAL → FINAL 状态；FINAL 行为 OPEN)
source_type
source_id
source_no
business_date
original_amount_cents
open_amount_cents      cache projection (derived from refreshOpenAmount)
paid_cents             cache projection
write_off_cents        cache projection
status                 OPEN | PARTIAL | SETTLED | WRITTEN_OFF
due_date               primary due (legacy; §28.4 introduces lines)
provisional_origin_id  null for FINAL/PROVISIONAL non-converted; for CONVERTED FINAL, link to original PROVISIONAL
converted_open_item_id null for FINAL/PROVISIONAL non-converted; for CONVERTED PROVISIONAL, link to final created
settlement_account_id   nullable
created_by
created_at
updated_at
```

Additive migration 添加列（不得破坏既有 check / index）：

```sql
ALTER TABLE account_receivables ADD COLUMN recognition_mode TEXT
  CHECK(recognition_mode IN ('DIRECT_BUSINESS_OPEN_ITEM','INVOICE_DRIVEN_OPEN_ITEM','PROVISIONAL_TO_FINANCIAL'));
ALTER TABLE account_receivables ADD COLUMN item_kind TEXT
  CHECK(item_kind IN ('FINAL','PROVISIONAL'));
ALTER TABLE account_receivables ADD COLUMN conversion_state TEXT
  CHECK(conversion_state IN ('OPEN','CONVERTED')) DEFAULT 'OPEN';
ALTER TABLE account_receivables ADD COLUMN provisional_origin_id TEXT REFERENCES account_receivables(id);
ALTER TABLE account_receivables ADD COLUMN converted_open_item_id TEXT REFERENCES account_receivables(id);
ALTER TABLE account_receivables ADD COLUMN settlement_account_id TEXT REFERENCES bank_accounts(id);

ALTER TABLE account_payables ADD COLUMN recognition_mode TEXT
  CHECK(recognition_mode IN ('DIRECT_BUSINESS_OPEN_ITEM','INVOICE_DRIVEN_OPEN_ITEM','PROVISIONAL_TO_FINANCIAL'));
ALTER TABLE account_payables ADD COLUMN item_kind TEXT
  CHECK(item_kind IN ('FINAL','PROVISIONAL'));
ALTER TABLE account_payables ADD COLUMN conversion_state TEXT
  CHECK(conversion_state IN ('OPEN','CONVERTED')) DEFAULT 'OPEN';
ALTER TABLE account_payables ADD COLUMN provisional_origin_id TEXT REFERENCES account_payables(id);
ALTER TABLE account_payables ADD COLUMN converted_open_item_id TEXT REFERENCES account_payables(id);
ALTER TABLE account_payables ADD COLUMN settlement_account_id TEXT REFERENCES bank_accounts(id);
```

注：`account_receivables.party_type='CUSTOMER'`；`account_payables.party_type='SUPPLIER'`。

### 28.3.2 Canonical Equation (F1 / §33.3) — 4 Categories

> **每个 `effective_*` 已经 net of its own valid reversal state/evidence；不再额外加 generic reversal。避免 "subtract source → add reversal → exclude reversed source" 三重调整。**

```text
open_amount
=
original_amount
- effective_settlement_allocations
- effective_unapplied_applications
- effective_credit_adjustments
- effective_write_offs
```

Each component is defined as:

```text
effective_settlement_allocations(open_item_id, side)
  = SUM(payment_collection_items.amount_cents
        WHERE open_item_id = ? AND side = 'AR' AND status = 'CONFIRMED')
  + SUM(payment_disbursement_items.amount_cents
        WHERE open_item_id = ? AND side = 'AP' AND status = 'CONFIRMED')
  - SUM(settlement_reversal_items.amount_cents
        WHERE component_type = 'ALLOCATION'
          AND original_component_id IN (
              SELECT id FROM payment_collection_items WHERE open_item_id = ?
              UNION
              SELECT id FROM payment_disbursement_items WHERE open_item_id = ?
            ))

effective_unapplied_applications(open_item_id, side)
  = SUM(balance_applications.amount_cents
        WHERE target_open_item_id = ? AND side = ? AND status = 'CONFIRMED')
  - 0    -- REVERSED applications contribute zero (filtered by status='CONFIRMED' above)

effective_credit_adjustments(open_item_id, side)
  = SUM(financial_credit_adjustments.effect_cents
        WHERE open_item_id = ? AND side = ? AND status = 'CONFIRMED')
  - SUM(financial_credit_adjustments.effect_cents
        WHERE open_item_id = ? AND side = ? AND status = 'REVERSED')
  -- effect_type IN ('RETURN','DISCOUNT','COMMERCIAL_CREDIT','OTHER')
  -- commercial_credit_notes / sales_discounts / purchase_discounts / returns
  --    already materialized via financial_credit_adjustments; do NOT re-sum.

effective_write_offs(open_item_id, side)
  = SUM(financial_write_offs.amount_cents
        WHERE open_item_id = ? AND side = ? AND status = 'CONFIRMED')
  - SUM(financial_write_off_reversals.amount_cents
        WHERE reverses_write_off_id IN (
            SELECT id FROM financial_write_offs WHERE open_item_id = ? AND side = ?
          ))
```

**Excluded from the equation (intentional):**

```text
financial_refunds           -- belongs to unapplied-balance truth + treasury truth
financial_refund_reversals   -- belongs to unapplied-balance truth + treasury truth
commercial_credit_notes     -- source-document evidence only;
                              -- financial effect materialized via financial_credit_adjustments
sales_discounts             -- source-document evidence only;
                              -- financial effect materialized via financial_credit_adjustments
purchase_discounts          -- same
sales_returns / purchase_returns  -- source-document evidence only;
                                    -- financial effect materialized via financial_credit_adjustments
settlement_reversal_items.UNAPPLIED  -- only affects unapplied-balance lifecycle
```

`paid_cents` / `write_off_cents` / `open_amount_cents` 是 cache projection，由 `refreshOpenAmount(openItemId)` 在每个 mutation 末尾统一更新。

#### 28.3.2.1 refreshOpenAmount() — Reads VIEW Only

```text
refreshOpenAmount(openItemId):
  side = lookup_by_id(openItemId).side

  -- single dependency: finance_open_item_effects VIEW
  effective = SUM(effective_amount_cents)
              FROM finance_open_item_effects
              WHERE side = ? AND open_item_id = ?

  remaining = original_amount_cents - effective
  UPDATE account_receivables / account_payables
    SET open_amount_cents = remaining,
        status = derived_status(remaining, write_off_cents)
```

`refreshOpenAmount` reads **`finance_open_item_effects` VIEW only**。Chain：

```text
canonical source facts
→ finance_open_item_effects VIEW  (DERIVED SQL VIEW; non-persisted; rebuild-free)
→ canonical equation
→ cached account_receivables / account_payables.open_amount_cents
```

Never：

```text
source facts
+
view
```

in the same equation.

#### 28.3.2.2 assertOpenAmountReconciled()

```text
canonical = canonical_equation(openItemId, side)
            -- canonical_equation reads finance_open_item_effects VIEW only
cached    = lookup.open_amount_cents
if canonical != cached:
  throw HttpError(500, 'open amount cache mismatch — fail closed', { open_item_id, canonical, cached })
```

`assertOpenAmountReconciled` independently recomputes through the same VIEW contract and compares the cached header value. Reader path / health check / close pre-check 可独立调用。

禁止 `refreshOpenAmount` 直接被 reader 路径调用；只允许 canonical writer 末尾。

### 28.3.3 Status Lifecycle

```text
OPEN     --  remaining > 0 且未 settle
PARTIAL  --  remaining > 0 且已部分 allocated
SETTLED  --  remaining == 0 且全部 effect CONFIRMED
WRITTEN_OFF   --  write-off CONFIRMED; remaining == 0
```

`CONVERTED` 不作为 `status`；改由 `account_receivables.conversion_state='CONVERTED'` / `account_payables.conversion_state='CONVERTED'` 表达（PROVISIONAL → FINAL 转换后原行）。

不允许 `OPEN / PARTIAL / SETTLED / WRITTEN_OFF` 之外的临时 status；不允许混用 document status 与 settlement status。

### 28.3.4 finance_open_item_effects (DERIVED SQL VIEW — Contract)

> **`finance_open_item_effects` 是 DERIVED SQL VIEW，NOT a physical table。**
>
> - **non-authoritative**
> - **non-persisted**
> - **rebuild-free**
> - **NOT a physical table**
> - **NOT a materialized/cache table**
> - No INSERT / UPDATE / DELETE is permitted against it (view disallows).

View 投影 exactly 4 frozen effect categories，每类已经 net of its own reversal semantics：

```text
SETTLEMENT_ALLOCATION
UNAPPLIED_APPLICATION
CREDIT_ADJUSTMENT
WRITE_OFF
```

#### 28.3.4.1 View Definition (Portable SQL)

```sql
CREATE VIEW IF NOT EXISTS finance_open_item_effects AS
  -- ============================================================
  -- A. SETTLEMENT_ALLOCATION
  --    payment_collection_items (AR) ∪ payment_disbursement_items (AP)
  --    net of settlement_reversal_items WHERE component_type='ALLOCATION'
  -- ============================================================
  SELECT
    'AR' AS side,
    pci.open_item_id AS open_item_id,
    'SETTLEMENT_ALLOCATION' AS effect_type,
    'payment_collection_items' AS source_table,
    pci.payment_collection_id AS source_id,
    pci.id AS source_effect_id,
    pci.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pci.id
    ), 0) AS reversed_amount_cents,
    pci.amount_cents - COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pci.id
    ), 0) AS effective_amount_cents,
    pci.business_date AS business_date
  FROM payment_collection_items pci
  WHERE pci.status = 'CONFIRMED'
  UNION ALL
  SELECT
    'AP' AS side,
    pdi.open_item_id AS open_item_id,
    'SETTLEMENT_ALLOCATION' AS effect_type,
    'payment_disbursement_items' AS source_table,
    pdi.payment_disbursement_id AS source_id,
    pdi.id AS source_effect_id,
    pdi.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pdi.id
    ), 0) AS reversed_amount_cents,
    pdi.amount_cents - COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pdi.id
    ), 0) AS effective_amount_cents,
    pdi.business_date AS business_date
  FROM payment_disbursement_items pdi
  WHERE pdi.status = 'CONFIRMED'

  UNION ALL

  -- ============================================================
  -- B. UNAPPLIED_APPLICATION
  --    balance_applications WHERE status='CONFIRMED'
  --    REVERSED applications contribute zero (filtered)
  -- ============================================================
  SELECT
    ba.side AS side,
    ba.target_open_item_id AS open_item_id,
    'UNAPPLIED_APPLICATION' AS effect_type,
    'balance_applications' AS source_table,
    ba.balance_id AS source_id,
    ba.id AS source_effect_id,
    ba.amount_cents AS gross_amount_cents,
    0 AS reversed_amount_cents,
    ba.amount_cents AS effective_amount_cents,
    ba.business_date AS business_date
  FROM balance_applications ba
  WHERE ba.status = 'CONFIRMED'

  UNION ALL

  -- ============================================================
  -- C. CREDIT_ADJUSTMENT
  --    financial_credit_adjustments WHERE status='CONFIRMED'
  --    net of REVERSED rows; typed RETURN/DISCOUNT/COMMERCIAL_CREDIT/OTHER
  --    commercial_credit_notes / sales_discounts / purchase_discounts / returns
  --    already materialize via financial_credit_adjustments; do NOT re-sum.
  -- ============================================================
  SELECT
    fca.side AS side,
    fca.open_item_id AS open_item_id,
    'CREDIT_ADJUSTMENT' AS effect_type,
    'financial_credit_adjustments' AS source_table,
    fca.source_id AS source_id,
    fca.id AS source_effect_id,
    fca.effect_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(fca2.effect_cents)
      FROM financial_credit_adjustments fca2
      WHERE fca2.status = 'REVERSED'
        AND fca2.source_id = fca.id
    ), 0) AS reversed_amount_cents,
    fca.effect_cents - COALESCE((
      SELECT SUM(fca2.effect_cents)
      FROM financial_credit_adjustments fca2
      WHERE fca2.status = 'REVERSED'
        AND fca2.source_id = fca.id
    ), 0) AS effective_amount_cents,
    fca.business_date AS business_date
  FROM financial_credit_adjustments fca
  WHERE fca.status = 'CONFIRMED'

  UNION ALL

  -- ============================================================
  -- D. WRITE_OFF
  --    financial_write_offs WHERE status='CONFIRMED'
  --    net of financial_write_off_reversals
  -- ============================================================
  SELECT
    fwo.side AS side,
    fwo.open_item_id AS open_item_id,
    'WRITE_OFF' AS effect_type,
    'financial_write_offs' AS source_table,
    fwo.id AS source_id,
    fwo.id AS source_effect_id,
    fwo.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(fwor.amount_cents)
      FROM financial_write_off_reversals fwor
      WHERE fwor.write_off_id = fwo.id
    ), 0) AS reversed_amount_cents,
    fwo.amount_cents - COALESCE((
      SELECT SUM(fwor.amount_cents)
      FROM financial_write_off_reversals fwor
      WHERE fwor.write_off_id = fwo.id
    ), 0) AS effective_amount_cents,
    fwo.business_date AS business_date
  FROM financial_write_offs fwo
  WHERE fwo.status = 'CONFIRMED';
```

> **Excluded from the view (intentional, per §28.3.0.2 / §28.3.0.3 / §28.3.0.4 / §28.3.0.5):**
>
> - `financial_refunds` / `financial_refund_reversals` (unapplied-balance truth + treasury truth)
> - `commercial_credit_notes` (source-document evidence; financial effect materialized via `financial_credit_adjustments`)
> - `sales_discounts` / `purchase_discounts` (source-document evidence; financial effect materialized via `financial_credit_adjustments`)
> - `sales_returns` / `purchase_returns` (source-document evidence; financial effect materialized via `financial_credit_adjustments`)
> - `settlement_reversal_items` rows with `component_type='UNAPPLIED'` (only affects unapplied-balance lifecycle)

#### 28.3.4.2 Logical Uniqueness

```text
(source_table, source_effect_id)
```

是 view 的逻辑唯一键。view 自身不支持 UNIQUE 约束；测试必须 assert 投影无重复 identity。

#### 28.3.4.3 No Physical Persistence

```text
finance_open_item_effects 是 VIEW；
无 CREATE TABLE finance_open_item_effects；
无 materialized / cache 表；
无 rebuild 步骤（每次 query 重新计算）。
```

Authoritative writes never target this view（view 不允许 DML）。

## 28.4 Due-Schedule Model (FO04)

### 28.4.1 Schema (side + open_item_id portable identity)

`finance_due_schedule_lines` 是 additive child table，**不允许**仅以单一 `due_date` 列表达 multi-due terms。

为了避免 shared child table 跨 side 引用歧义，使用 `(side, open_item_id)` portable identity：

```sql
CREATE TABLE IF NOT EXISTS finance_due_schedule_lines (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL CHECK(side IN ('AR','AP')),
  open_item_id TEXT NOT NULL,
  ar_open_item_id TEXT,  -- nullable; non-null iff side='AR'
  ap_open_item_id TEXT,  -- nullable; non-null iff side='AP'
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  due_date TEXT NOT NULL,
  scheduled_amount_cents INTEGER NOT NULL CHECK(scheduled_amount_cents > 0),
  settled_amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','SETTLED','REVERSED')),
  created_at TEXT NOT NULL,
  CHECK (
    (side = 'AR' AND ar_open_item_id IS NOT NULL AND ap_open_item_id IS NULL) OR
    (side = 'AP' AND ap_open_item_id IS NOT NULL AND ar_open_item_id IS NULL)
  ),
  FOREIGN KEY (ar_open_item_id) REFERENCES account_receivables(id),
  FOREIGN KEY (ap_open_item_id) REFERENCES account_payables(id),
  UNIQUE(side, open_item_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_due_schedule_item ON finance_due_schedule_lines(side, open_item_id, sequence);
CREATE INDEX IF NOT EXISTS idx_due_schedule_due ON finance_due_schedule_lines(due_date, status);
```

应用层 invariant 守卫：

```text
assertOpenItemSide(openItemId):
  if side='AR': exists in account_receivables where id=openItemId
  if side='AP': exists in account_payables where id=openItemId
  else: throw HttpError(400, 'cross-side reference rejected', { side, open_item_id })
```

避免 SQLite / MySQL FK 跨边限制差异；CHECK 约束保证 column-level，application assert 保证 row-level。

### 28.4.2 Invariant

```text
SUM(scheduled_amount_cents) = original_amount_cents
```

检查时机：open item create / amount edit（仅 DRAFT） / schedule amendment。

### 28.4.3 Default Schedule

Legacy single `due_date` 在 migration 阶段迁移为一条 schedule line：

```text
sequence = 1
scheduled_amount_cents = original_amount_cents
due_date = legacy.due_date
```

未知 / 缺 legacy terms 的 open item 保留为一条 default schedule，不得 fabricate multi-line。

### 28.4.4 Allocation Priority

默认策略：

```text
ORDER BY due_date ASC, business_date ASC, open_item_id ASC
```

explicit user allocation 必须记录 `payment_collection_items.user_allocated=1`；不得 silently override。

## 28.5 Provisional Model (FO11 / FO12 / FO13)

### 28.5.1 First-Class Identity

PROVISIONAL 是 first-class `item_kind`，**不**仅靠 `source_type='PURCHASE_RECEIPT'` 隐式标记。

```text
item_kind = 'PROVISIONAL'
recognition_mode = 'PROVISIONAL_TO_FINANCIAL'
```

后续 Invoice post → `convertProvisionalToFinancial`（§28.5.3）。

### 28.5.2 Provisional Open Items

- 由 `recognizeFinanceExposure` 在 PROVISIONAL_TO_FINANCIAL policy 下创建。
- 允许在 conversion 前完成 payment / allocation？**否**。仅 final 可付款；provisional open item 显式拒绝 `payment_disbursements` allocation（除非 future Requirement 显式放宽）。
- migration 不允许把所有 `PURCHASE_RECEIPT` AR/AP auto-label 为 PROVISIONAL；只有 policy evidence 允许的才迁移。

### 28.5.3 Conversion / Reversal

`finance-provisional-conversion.js::convertProvisionalToFinancial`：

```text
input: { provisionalOpenItemId, finalOpenItemId, supplierBillId, businessDate, amountCents, actor }
1. lock provisionalOpenItemId FOR UPDATE
2. assert provisionalOpenItemId.item_kind='PROVISIONAL' 且未 converted
3. set provisional.conversion_state='CONVERTED' + provisional.converted_open_item_id=finalOpenItemId
4. finalOpenItem 已由 recognizeFinanceExposure 在同一事务内创建（INVOICE_DRIVEN_OPEN_ITEM 路径）
5. audit

Note: finance_open_item_effects 是 DERIVED SQL VIEW；no INSERT against it.
       conversion 由 account_receivables / account_payables 头上的 conversion_state
       + converted_open_item_id 表达；view 自动反映。
```

Reversal path 同 reverseSettlementReversal 模式（§28.8）；不 hard-delete provisional。

### 28.5.4 AR Equivalence

AR PROVISIONAL → SALES_INVOICE.post → `reverseProvisionalAndCreateFinal`；reference 见 §28.5.3 镜像实现。

## 28.6 Settlement / Allocation Model (FO16–FO22)

### 28.6.1 Documents

保留并扩展 `payment_collections` / `payment_disbursements`（converge 策略见 §28.15）。

Lifecycle：

```text
DRAFT → CONFIRMED → (PARTIAL_REVERSAL | FULL_REVERSAL | CANCELLED)
```

`CANCELLED` 仅允许 `status='DRAFT'` 的零效应 cancellation；CONFIRMED 之后必须走 reversal（§28.8）。

### 28.6.2 Allocation Items

保留 `payment_collection_items` / `payment_disbursement_items`（converge）。

新增 evidence：

```text
allocation_id
open_item_id (linkage; canonical source table for §A SETTLEMENT_ALLOCATION effect via finance_open_item_effects VIEW projection)
amount_cents
open_before_cents
open_after_cents
reversal_of_allocation_id (nullable)
reversed_amount_cents (nullable; default 0)
created_by
created_at
```

Allocation priority 默认 `due_date ASC, business_date ASC, open_item_id ASC`；explicit user override 必须 persist `user_allocated=1`。

### 28.6.3 Settlement Reversal (FO22)

保留 `settlement_reversals` / `settlement_reversal_items`（v13-phase6a 已扩展 component_type）。

component_type：

```text
ALLOCATION    -- 撤销 cash allocation
UNAPPLIED     -- 撤销 unapplied balance application
```

Partial reversal 允许；remaining reversible amount = sum(component.cents) - sum(component.reversed_cents)。

### 28.6.4 Multi-Item / Partial

- `n settlements → 1 open item`：`payment_collection_items` 允许多行同 `open_item_id`。
- `1 settlement → n open items`：同上，单 `payment_collection_id` 多 `payment_collection_items`。
- 不允许 over-application：confirm 前必须重算 remaining 并 fail closed。

## 28.7 Unapplied Balance Model (FO23–FO26)

### 28.7.1 Canonical Model

保留 `settlement_unapplied_balances` / `balance_applications` / `financial_refunds` / `financial_refund_reversals`（v13-phase6a 已建立）。

Invariant：

```text
remaining = original - applications - refunds - reversals
remaining >= 0
```

balance_type：

```text
PREPAYMENT    --  advance receipt / prepayment
CREDIT        --  commercial credit adjustment
```

### 28.7.2 Refund (FO26)

- 仅指向 `settlement_unapplied_balances`（FO26 ≠ FO22）。
- side：`CUSTOMER | SUPPLIER`。
- 必须同时形成 treasury movement（§28.9）+ accounting adapter event（§28.11）。
- 双方向 evidence（UAT-18）：customer-side / supplier-side 各自独立 reconciliation test。

### 28.7.3 Application (FO25)

`balance_applications` 已建立；同一 transaction 内：

```text
1. lock balance_id FOR UPDATE
2. lock target_open_item_id FOR UPDATE
3. assert balance.remaining >= amount
4. assert target_open_item.remaining >= amount
5. insert balance_applications row (CONFIRMED)   -- canonical source for §B UNAPPLIED_APPLICATION
6. emit treasury movement (null; balance 转换不产生现金动作)
7. emit accounting adapter event
8. refresh canonical balance / open item        -- refreshOpenAmount reads VIEW; no separate INSERT

Note: finance_open_item_effects 是 DERIVED SQL VIEW；no INSERT against it.
       balance_applications 是 §B canonical source.
```

## 28.8 Write-Off / Bad Debt (FO27 / FO28)

### 28.8.1 Write-Off Lifecycle

保留 `financial_write_offs` / `financial_write_off_reversals`。

```text
DRAFT → SUBMITTED → CONFIRMED → REVERSED
       ↘ REJECTED
```

`REVERSED` 通过 `financial_write_off_reversals` evidence；不得 hard delete CONFIRMED。

### 28.8.2 Bad-Debt Provision (FO28)

`finance_bad_debt_provisions` 表 + lifecycle：

```text
DRAFT → SUBMITTED → CONFIRMED → REVERSED
       ↘ REJECTED
```

字段：

```text
id
provision_no
side                AR | AP
method              AGING | INDIVIDUAL
open_item_id        (null for AGING batch)
amount_cents        CHECK(amount_cents > 0)
business_date
reason
status
creator_id
confirmer_id
created_at
confirmed_at
reversed_by
reversed_at
```

**不得**实现 IFRS / ECL engine；只 AGING bucket 或 INDIVIDUAL single-item 评估。

## 28.9 Counterparty Transfer (FO15)

### 28.9.1 Document

`finance_counterparty_transfers` 表（first-class）：

```text
id
transfer_no
side                AR | AP
source_party_id
target_party_id
business_date
reason
status              DRAFT | CONFIRMED | REVERSED
creator_id
confirmer_id
created_at
confirmed_at
```

### 28.9.2 Lines

`finance_counterparty_transfer_lines`：

```text
id
transfer_id
source_open_item_id
amount_cents
```

### 28.9.3 Execution

确认事务：

```text
1. lock source_open_items FOR UPDATE (sort ASC)
2. assert sum(lines.amount_cents) == 0
3. 创建 target_party 的新 final open item（FINAL，recognition_mode=DIRECT_BUSINESS_OPEN_ITEM，source_type=FINANCE_TRANSFER，source_id=transfer_id）
4. 写 accounting adapter event
5. audit

Note: finance_open_item_effects 是 DERIVED SQL VIEW；no INSERT against it.
       total exposure conserved 由 canonical equation (refreshOpenAmount → VIEW) 体现。
       不得写 treasury movement (FO15 = AR/AP counterparty transfer; 无现金动作).
```

total exposure conserved：`SUM(source_open_item.effect) + SUM(target_open_item.effect) == 0`。

不得 `UPDATE account_receivables.party_id = ?` 原 counterparty；必须创建 evidence 行。

## 28.10 Invoice Model (FO29–FO36)

### 28.10.1 Document Lifecycle vs Credit Exposure (Separated)

> **不再把 `CREDITED` / `VOIDED` / `CANCELLED` 与 `DRAFT → POSTED` 混为单线 terminal state。明确分离两个独立维度：**
>
> ```text
> (A) Document Lifecycle      (DRAFT / POSTED / VOIDED / CANCELLED)
> (B) Credit Exposure State   (credit_state + credited_amount + remaining_creditable_amount)
> ```
>
> `CREDITED` 不作为单一 terminal document state。Credit / red notes 是独立 economic documents；原 invoice 仅在 credit_state projection 上积累。

保留 `sales_invoices` / `supplier_bills` / `commercial_credit_notes`（converge 策略见 §28.18）。

**Document Lifecycle（独立）：**

```text
DRAFT
  ↓ post
POSTED
  ↓ allow (under conditions below)
  ↘ VOIDED            -- only when all dependent effects atomically reversed or absent
  ↘ CANCELLED         -- only from DRAFT (zero effect)
```

```sql
-- sales_invoices.status, supplier_bills.status:
--   IN ('DRAFT','POSTED','VOIDED','CANCELLED')
-- (legacy 'CREDITED' status value is REMOVED; replaced by credit_state column below)
```

**Credit Exposure State（独立 projection on POSTED invoice）：**

```sql
ALTER TABLE sales_invoices ADD COLUMN credit_state TEXT NOT NULL DEFAULT 'NONE'
  CHECK(credit_state IN ('NONE','PARTIAL','FULL'));
ALTER TABLE sales_invoices ADD COLUMN credited_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_invoices ADD COLUMN remaining_creditable_amount_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE supplier_bills ADD COLUMN credit_state TEXT NOT NULL DEFAULT 'NONE'
  CHECK(credit_state IN ('NONE','PARTIAL','FULL'));
ALTER TABLE supplier_bills ADD COLUMN credited_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_bills ADD COLUMN remaining_creditable_amount_cents INTEGER NOT NULL DEFAULT 0;
```

Invariant：

```text
SUM(commercial_credit_notes.amount_cents WHERE invoice_id=? AND side=? AND status='POSTED' AND NOT reversed)
  = sales_invoices.credited_amount_cents
  = sales_invoices.total_amount_cents - sales_invoices.remaining_creditable_amount_cents

credit_state:
  NONE   -- credited_amount_cents == 0
  PARTIAL -- 0 < credited_amount_cents < total_amount_cents
  FULL   -- credited_amount_cents == total_amount_cents
```

`commercial_credit_notes` 是独立 economic document 类型：

```text
id
note_no
invoice_id
invoice_side                  SALES_INVOICE | SUPPLIER_BILL
amount_cents                  CHECK(amount_cents > 0)
business_date
status                        DRAFT | POSTED | VOIDED
reference                     reason / external
created_by
created_at
UNIQUE(invoice_id, note_no)
```

允许：

```text
1 张原 invoice → N 张 partial credit notes
```

`FULL` credit 不 hard-delete 原 invoice；原 invoice 仍存在，`credit_state='FULL'`，`remaining_creditable_amount_cents=0`。

**VOID 语义：**

```text
POSTED invoice may be VOIDED only when:
  (a) business / legal rules permit, AND
  (b) all dependent economic effects are absent
      OR
      atomically reversed in same transaction

atomic-reversal scope:
  open_item           → reverseFinanceExposure (mirror recognizeFinanceExposure reverse path)
  credit_notes posted against this invoice → reverse all (status='VOIDED')
  treasury movements  → applyTreasuryMovement (reversal via reversal_of_movement_id)
  accounting events   → reverseAccountingEvent (FO58)
  voucher             → Accounting & Analytics reversal
  tax snapshot        → reverse

VOID 失败 → transaction 回滚 → invoice 保持 POSTED + 全部 effect 存在。
```

禁止混淆：

```text
CANCELLED    -- DRAFT → CANCELLED, no economic effect ever existed
VOIDED       -- POSTED → VOIDED, all economic effects atomically reversed
PARTIALLY_CREDITED   -- credit_state = 'PARTIAL'
FULLY_CREDITED       -- credit_state = 'FULL'
```

### 28.10.2 Schemas

新增 additive 列：

```text
sales_invoices / supplier_bills
  recognition_mode          -- 接 §28.2 policy
  open_item_id              -- nullable; post 后填
  provisional_origin_id     -- nullable
  credit_state              -- NONE / PARTIAL / FULL  (above)
  credited_amount_cents
  remaining_creditable_amount_cents
  verification_state        -- UNVERIFIED / VERIFIED / CERTIFIED / REJECTED (supplier_bills only; FO35)
  posted_at
  posted_by
```

### 28.10.3 Source Cardinality (FO31)

`finance_invoice_source_links`：

```text
id
invoice_id
invoice_side                  SALES_INVOICE | SUPPLIER_BILL
source_type
source_id
source_line_id
invoiced_quantity
invoiced_amount_cents
UNIQUE(invoice_id, invoice_side, source_type, source_id, source_line_id)
```

Invariants：

```text
SUM(invoice_lines.invoiced_quantity) <= source_line.quantity - source_line.reversed_quantity
SUM(invoice_lines.invoiced_amount_cents) <= source_line.amount - source_line.reversed_amount
```

不得 over-invoice。

### 28.10.4 Credit / Red / Void (FO33 / FO34)

- Posted invoice 纠错通过 `commercial_credit_notes`（FO33），独立 economic document；原 invoice 仅累积 credit_state。
- `VOID / CANCEL` 仅在 lifecycle 条件满足时允许（§28.10.1）。
- 不得留 orphan AR/AP / settlement / voucher / tax effects。

### 28.10.5 Invoice Recognition Adapter

唯一入口 `recognizeFinanceExposure`（§28.2.3）。

路径：

```text
INVOICE_DRIVEN_OPEN_ITEM:
  posted invoice
  → recognizeFinanceExposure({...})
  → open_item created

DIRECT_BUSINESS_OPEN_ITEM:
  posted invoice is link only
  → link invoice.id to existing open_item.id
  → no new open item, no exposure change

PROVISIONAL_TO_FINANCIAL:
  posted invoice (supplier_bill)
  → reverse provisional open item (CONVERSION)
  → create final open item (FINAL)
```

不得散落到各 Domain handler。

### 28.10.6 Input Invoice Verification (FO35)

`supplier_bills.verification_state` lifecycle：

```text
UNVERIFIED → VERIFIED → CERTIFIED
            ↘ REJECTED
```

外部 government certification 保持 OUT_OF_SCOPE（document.md §33.44）。

## 28.11 Treasury Movement Model (FO37–FO45)

### 28.11.1 Settlement Account Master (FO37) — bank_accounts is EXISTING_CONVERGE Canonical

**本 Domain Closure 显式选择：扩展 `bank_accounts` 为 canonical operational CASH/BANK account master；不新建第二 master。**

```text
bank_accounts
  = canonical operational CASH/BANK settlement account master
  = the ONLY authoritative operational account identity
  = EXISTING_CONVERGE in canonical table inventory (§28.1.2.1)
  = NO competing finance_settlement_accounts master

finance_settlement_accounts
  = REMOVED from canonical design
  = not a separate master; not a competing active table
  (per "Do not introduce second active master" in document.md §33.43)
```

Additive migration 在 `bank_accounts` 上扩展：

```sql
-- existing bank_accounts columns preserved
-- ADDITIVE columns only:

ALTER TABLE bank_accounts ADD COLUMN code TEXT;
ALTER TABLE bank_accounts ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bank_accounts ADD COLUMN accounting_role TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_accounts ADD COLUMN accounting_subject_id TEXT;

-- balance_cents remains; converted from authoritative balance to derived cache projection

-- CASH / BANK union support
-- existing account_type default 'CHECKING' is preserved; additive allow:
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_type_check
  CHECK(account_type IN ('CASH','BANK','CHECKING','SAVINGS','OTHER') OR account_type IS NULL);

-- code unique after backfill (one-time migration backfills code = id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_code ON bank_accounts(code) WHERE code IS NOT NULL;
```

CASH account representation（不通过会计 subject `1001` 隐式表达）：

```text
CASH accounts are bank_accounts rows with account_type='CASH' and code/name distinct from BANK accounts.
operational identity = bank_accounts.id (canonical).
accounting_subject_id nullable: optional downstream mapping to GL subject 1001 only as a reference,
not as the operational account identity.
```

`bank_accounts.balance_cents` 保留为 derived cache projection；canonical truth = `finance_treasury_movements` aggregate per `settlement_account_id`。

禁止：

```text
1. CREATE TABLE finance_settlement_accounts  -- never created as canonical master
2. Independent bank_accounts writes  outside applyTreasuryMovement
3. UPDATE bank_accounts.balance_cents  outside refreshSettlementAccountBalance
```

Legacy `/api/bank-accounts` route 全部走 canonical settlement-account service（finance-settlement-account）。`bank_accounts.balance_cents` 兼容性 cache 仅在 migration 过渡期保留。

### 28.11.2 Canonical Treasury Movement (FO39)

```sql
CREATE TABLE IF NOT EXISTS finance_treasury_movements (
  id TEXT PRIMARY KEY,
  settlement_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  business_date TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  counterparty_type TEXT NOT NULL DEFAULT '',
  counterparty_id TEXT NOT NULL DEFAULT '',
  external_reference TEXT NOT NULL DEFAULT '',
  reversal_of_movement_id TEXT,
  movement_group_id TEXT NOT NULL,
  accounting_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','REVERSED')),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_movement_idem ON finance_treasury_movements(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_treasury_movement_account ON finance_treasury_movements(settlement_account_id, business_date);
CREATE INDEX IF NOT EXISTS idx_treasury_movement_group ON finance_treasury_movements(movement_group_id);
```

#### 28.11.2.1 Idempotency Examples

```text
COLLECTION_CONFIRM:{collection_id}
PAYMENT_CONFIRM:{disbursement_id}
REFUND_CONFIRM:{refund_id}
SETTLEMENT_REVERSAL:{reversal_id}
TREASURY_TRANSFER:{transfer_id}
CASH_DEPOSIT:{deposit_id}
CASH_WITHDRAWAL:{withdrawal_id}
NOTE_SETTLEMENT:{note_settlement_id}
```

同 key 不同 payload → 409；同 key 同 payload → 幂等返回。

### 28.11.3 Canonical Balance

```text
opening_balance_cents
+ SUM(IN confirmed movements) - SUM(OUT confirmed movements)
= canonical balance
```

Reconciliation invariant：

```text
finance_settlement_accounts.cached_balance_cents (derived) == canonical
```

Mismatch → `finance-treasury-movement.js::assertBalanceReconciled` fail closed。

### 28.11.4 cash_journals 处置 (F8 / §33.24)

`cash_journals` 必须 converge / retire：

```text
A. 现金日记账作为读模型 / 兼容 projection 保留（cash_journals 表 + 列保留）
B. 所有写路径迁移到 applyTreasuryMovement(input)
C. 不得 UPDATE bank_accounts.balance_cents 绕过 applyTreasuryMovement
D. applyTreasuryMovement 是 finance-treasury-movement.js 唯一公开 API
```

`applyTreasuryMovement` 内部：

```text
1. lock settlement_account_id FOR UPDATE
2. assert account active
3. insert finance_treasury_movements row
4. update settlement_account.cached_balance_cents (derived)
5. emit accounting event
6. audit
```

### 28.11.5 Cash Deposit / Withdrawal (FO40)

`Cash → Bank` / `Bank → Cash`：

```text
applyTreasuryMovement(IN, account_id=cash, amount, ...)   // cash side down (if withdraw)
applyTreasuryMovement(OUT, account_id=bank, amount, ...)  // bank side down
```

或 `IN bank + OUT cash`，paired movement_group_id。

禁止 one-sided manual journal 当两边都是 internal account。

### 28.11.6 Internal Bank Transfer (FO41)

```text
applyTreasuryMovement(OUT, account_A, amount, group=transfer_id, ...)
applyTreasuryMovement(IN,  account_B, amount, group=transfer_id, ...)
```

Total organization cash 不变。Lock ordering: 字典序 ASC。

### 28.11.7 Notes (FO42 / FO43)

`finance_notes` 表 + lifecycle：

```text
REGISTERED → HELD → (ENDORSED | DISCOUNTED) → SETTLED
            ↘ CANCELLED
```

direction：`RECEIVABLE | PAYABLE`。财务 effect 走 AR/AP adapter + treasury adapter。

### 28.11.8 Payment Request (FO44)

`finance_payment_requests`：

```text
DRAFT → SUBMITTED → (APPROVED | REJECTED) → EXECUTED → CANCELLED
```

`APPROVED != cash movement`。Execution 才走 `applyTreasuryMovement`。Workflow approval 可走 Platform workflow。

### 28.11.9 Cash Count (FO45)

`finance_cash_counts` (header) + `finance_cash_count_lines`：

```text
header:
  id, count_no, settlement_account_id, business_date, book_amount_cents,
  physical_amount_cents, difference_cents, status, ...

lines:
  id, count_id, denomination, count_quantity, total_cents
```

Count confirm 不得 silent-overwrite balance；difference 走 explicit adjustment evidence（adapter 决定）。

## 28.12 Bank Statement / Reconciliation (FO46–FO49)

### 28.12.1 Statement Header / Lines (FO46)

保留 `bank_statements` / `bank_statement_items`（v13 + extended-schema 已建立）。

Lines 必须包含：

```text
id
statement_id
external_transaction_date
value_date
amount_cents
direction            IN | OUT
counterparty
bank_reference
description
import_fingerprint    UNIQUE
```

### 28.12.2 Import (FO47)

`finance_bank_statement_imports`：

```text
id
file_name
fingerprint
status              PENDING | IMPORTED | FAILED
imported_at
```

Import 通过 `import_fingerprint` UNIQUE idempotent；相同 fingerprint + 不同 payload → conflict；不同 payload 完全 idempotent。

### 28.12.3 Reconciliation (FO48)

`finance_bank_reconciliations` + `finance_bank_reconciliation_matches`：

```text
matches:
  id
  reconciliation_id
  statement_line_id
  treasury_movement_id
  matched_amount_cents
  match_method         AUTO | MANUAL
  matched_by
  matched_at
```

支持：

```text
1 ↔ 1
1 ↔ n
n ↔ 1
```

Invariant：

```text
SUM(matched_amount_cents) <= statement_line.remaining_amount_cents
SUM(matched_amount_cents) <= treasury_movement.remaining_amount_cents
```

reconciliation **不得**写 treasury movement。

### 28.12.4 Unmatched Items (FO49)

不创建 duplicate ledger。Report 派生：

```text
statement_line.remaining_amount_cents = amount_cents - SUM(matches.matched_amount_cents)
treasury_movement.unmatched_amount_cents = amount_cents - SUM(matches.matched_amount_cents)
```

## 28.13 Business Close (FO51 / FO52 / FO53)

### 28.13.1 Stable Lock Anchors — finance_business_close_state (NEW table #18)

**RACE-15 设计决策：稳定可锁定的 3 个 control anchor rows（per close_type），必须在普通 finance transactions 运行前存在；不得依赖 `SELECT latest closure row FOR UPDATE` 在 absence-row 上的 race。**

```sql
CREATE TABLE IF NOT EXISTS finance_business_close_state (
  close_type TEXT PRIMARY KEY CHECK(close_type IN ('AR','AP','TREASURY')),
  closed_through_date TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

-- 必装 3 rows by migration seed
INSERT OR IGNORE INTO finance_business_close_state(close_type, closed_through_date, updated_at, updated_by)
VALUES ('AR', '', datetime('now'), 'system'),
       ('AP', '', datetime('now'), 'system'),
       ('TREASURY', '', datetime('now'), 'system');
```

事务流：

```text
ordinary finance transaction (e.g. collection confirm):
  1. assertFinanceBusinessDateOpen('AR', businessDate)
       1.1. SELECT * FROM finance_business_close_state WHERE close_type='AR' FOR UPDATE
       1.2. assert closed_through_date == '' OR businessDate > closed_through_date
       1.3. proceed with canonical writer
  2. ... economic write ...
  3. COMMIT

finance close handler:
  1. SELECT * FROM finance_business_close_state WHERE close_type=? FOR UPDATE
  2. pre-close inspection
  3. UPDATE finance_business_close_state SET closed_through_date=newDate WHERE close_type=?
  4. INSERT INTO finance_business_closures (...) -- history row
  5. COMMIT

finance reopen handler:
  1. SELECT * FROM finance_business_close_state WHERE close_type=? FOR UPDATE
  2. assert closed_through_date != ''
  3. UPDATE finance_business_close_state SET closed_through_date='' WHERE close_type=?
  4. INSERT INTO finance_business_closures (status='REOPENED', reopened_by=?, reopened_at=?)
  5. COMMIT
```

Invariant：3 个 anchor row 在 migration 完成时已存在；任何 absence-row race 不可能发生。

### 28.13.2 History Rows — finance_business_closures (NEW table #19)

`finance_business_closures` 是 history / event 投影；仅记录 close / reopen 事件，不作为 lock target：

```sql
CREATE TABLE IF NOT EXISTS finance_business_closures (
  id TEXT PRIMARY KEY,
  close_type TEXT NOT NULL CHECK(close_type IN ('AR','AP','TREASURY')),
  closed_through_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED','REOPENED')),
  closed_by TEXT,
  closed_at TEXT,
  reopened_by TEXT,
  reopened_at TEXT,
  reopen_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(close_type, closed_through_date, status)
);
CREATE INDEX IF NOT EXISTS idx_business_closures_type ON finance_business_closures(close_type, status);
```

读模型（history）使用本表；写模型（lock target）使用 `finance_business_close_state`。

### 28.13.3 Guard

唯一入口：

```text
assertFinanceBusinessDateOpen(closeType: 'AR' | 'AP' | 'TREASURY', businessDate)
  1. SELECT * FROM finance_business_close_state WHERE close_type=? FOR UPDATE
  2. assert closed_through_date == '' OR businessDate > closed_through_date
```

每次 mutation 入口必声明：

```text
AR:    invoice recognition, collection, write-off, AR transfer, credit-note AR effect
AP:    supplier-bill recognition, payment, write-off, AP transfer, credit-note AP effect
TREASURY: applyTreasuryMovement, bank transfer, refund (treasury side), cash op, bank rec match
```

Transaction 可能要求多个 guard（如 AP write-off 同时要求 AP + TREASURY guard）。

### 28.13.4 Close Ordering

Document.md §33.31 不强制顺序。Design 推荐：

```text
AR  →  AP  →  TREASURY
```

各 close 仍独立（不同 `close_type`）；但 lock 顺序按字典序 ASC（§28.19）。

### 28.13.5 Reopen

Reopen 必须：

```text
1. 选定 close_type 的 finance_business_close_state row FOR UPDATE
2. UPDATE closed_through_date='' (或 new future date)
3. INSERT finance_business_closures REOPENED history row
4. 不允许 silent-reset; 不允许 DROP finance_business_closures history
```

### 28.13.6 Accounting Period Close

`finance_business_close_state` 与 Accounting & Analytics period close 独立：

```text
assertAccountingPeriodOpen  ←  Accounting & Analytics
assertFinanceBusinessDateOpen  ←  Finance Operations
```

两者并存，互不重写。

## 28.14 Integration Adapters

### 28.14.1 FO57 — Source Business Document Adapter

```text
getFinancialSourceFacts(sourceType, sourceId) -> {
  party: { type, id },
  business_date,
  source_lines: [{ line_id, quantity, amount_cents, currency, tax_snapshot }],
  source_status,
  source_no,
  billing_mode,
  approval_state,
}
```

消费 frozen domain source（Sales / Procurement / Outsourcing）；Finance Operations **不得** rewrite source。

### 28.14.2 FO58 — Accounting Event / Voucher Adapter

唯一 emit 入口：

```text
emitAccountingEvent(input: {
  source_type, source_id, source_no,
  business_date,
  event_type: 'AR_RECOGNITION' | 'AP_RECOGNITION' | 'COLLECTION' | 'PAYMENT' |
              'REFUND' | 'SETTLEMENT_REVERSAL' | 'WRITE_OFF' | 'TRANSFER' |
              'TREASURY_MOVEMENT' | 'PROVISIONAL_CONVERSION' | ...,
  amount_cents,
  debit_subjects: [...],
  credit_subjects: [...],
  idempotency_key,
}) -> { accounting_event_id, voucher_id? }
```

复用既有 canonical voucher adapter（createSystemVoucher / voucher-templates）；**不得**新建第二 voucher engine。

### 28.14.3 FO50 — Treasury ↔ GL Reconciliation

```text
compareTreasuryToGL(settlementAccountId, businessDate) -> {
  treasury_balance_cents,
  gl_balance_cents,
  delta_cents,
  status: 'PASS' | 'MISMATCH',
}
```

CHECK-only。Mismatch 仅生成 reconciliation evidence，**不得** auto repair GL。

## 28.15 Permission Model

### 28.15.0 Capability Boundary — NOT Finance Operations Capabilities

**明确划清：以下 permission codes 不是 Finance Operations capability permissions。它们属于 Accounting & Analytics / Master & Engineering。Finance Operations Design 不将其计入 FINANCE_* family，亦不基于 `role-accounting` 历史 seed 持有而扩展为 Finance capability。**

```text
FIXED_ASSETS_VIEW / MANAGE         ← Accounting & Analytics (B3107 固定资产)
COST_*                             ← Accounting & Analytics (B3106 存货核算 + B3117 经营会计)
VOUCHER_SUBMIT                     ← Accounting & Analytics (B3114 智能会计平台)
VOUCHER_*                          ← Accounting & Analytics
ACCOUNTING_VIEW                    ← Accounting & Analytics (B3115 总账)
PRODUCT_COSTS_*                    ← Accounting & Analytics
```

本节兼容性 §28.15.1 中保留这些 codes（因为 `role-accounting` 历史 seed 已持有），但仅作为 **compatibility retention**，**不**作为 Finance Operations capability。

### 28.15.1 兼容策略

保留现有（其中 FIXED_ASSETS_* / VOUCHER_SUBMIT / ACCOUNTING_VIEW 保留为 compatibility retention per §28.15.0；不属于 Finance capability）：

```text
AR_VIEW                 COLLECTION_MANAGE
AP_VIEW                 PAYMENT_MANAGE
CASH_JOURNALS_VIEW/MANAGE
BANK_ACCOUNTS_VIEW/MANAGE
BILLS_VIEW/MANAGE
BANK_RECONCILE_VIEW/MANAGE
SALES_DISCOUNT_MANAGE   PURCHASE_DISCOUNT_MANAGE
(FIXED_ASSETS_VIEW/MANAGE  -- Compatibility retention; NOT Finance Operations capability)
(VOUCHER_SUBMIT           -- Compatibility retention; NOT Finance Operations capability)
(ACCOUNTING_VIEW          -- Compatibility retention; NOT Finance Operations capability)
REPORT_VIEW
```

Finance Operations 新增 bounded family（admin 继承；其它角色按 Design 默认 deny）：

```text
FINANCE_RECOGNITION_POLICY_VIEW / MANAGE
FINANCE_AR_VIEW                 (alias AR_VIEW; additive)
FINANCE_AP_VIEW                 (alias AP_VIEW; additive)
FINANCE_INVOICE_VIEW / MANAGE
FINANCE_TREASURY_VIEW / MANAGE
FINANCE_SETTLEMENT_ACCOUNT_VIEW / MANAGE  (over bank_accounts master)
FINANCE_TRANSFER_MANAGE         (FO15)
FINANCE_WRITE_OFF_MANAGE        (FO27)
FINANCE_BAD_DEBT_MANAGE         (FO28)
FINANCE_NOTES_MANAGE            (FO42 / FO43)
FINANCE_PAYMENT_REQUEST_MANAGE  (FO44)
FINANCE_CASH_COUNT_MANAGE       (FO45)
FINANCE_BANK_STATEMENT_IMPORT   (FO47)
FINANCE_RECONCILE_MANAGE        (FO48)
FINANCE_CLOSE_VIEW / MANAGE     (FO51 / FO52 / FO53)
```

5 个 role seed：`admin / sales / warehouse / reviewer / accounting` 默认值保持现状；`admin` 继承全部新增（含 FINANCE_*）；`role-accounting` 增加：

```text
FINANCE_RECOGNITION_POLICY_MANAGE
FINANCE_INVOICE_MANAGE
FINANCE_TREASURY_MANAGE
FINANCE_SETTLEMENT_ACCOUNT_MANAGE
FINANCE_TRANSFER_MANAGE
FINANCE_WRITE_OFF_MANAGE
FINANCE_BAD_DEBT_MANAGE
FINANCE_NOTES_MANAGE
FINANCE_PAYMENT_REQUEST_MANAGE
FINANCE_CASH_COUNT_MANAGE
FINANCE_BANK_STATEMENT_IMPORT
FINANCE_RECONCILE_MANAGE
FINANCE_CLOSE_MANAGE
```

注：`role-accounting` 历史持有的 `FIXED_ASSETS_*` / `VOUCHER_SUBMIT` / `ACCOUNTING_VIEW` 不被本 Design 重分类为 Finance capability；保留为 compatibility retention（其 canonical owner 由 Accounting & Analytics Domain Closure 决定）。

其它角色（`sales` / `warehouse` / `reviewer`）默认 deny finance permission（除非 future Requirement 显式放宽）。

### 28.15.2 Backend Fail Closed

每个 mutation handler 必须 `allow(actor, 'FINANCE_*')`；前端 hidden 不等于授权；VIEW 不隐含 MANAGE。

`role-accounting` 历史持有 `FIXED_ASSETS_*` 不构成 Finance Operations 写权限 — 例如 `updateFixedAsset` handler 不允许由 FINANCE_* MANAGE 通过；必须由 Accounting & Analytics capability 鉴权（即便未来实现尚未启动）。

## 28.16 API / Route Architecture

### 28.16.1 Endpoint Family（命名空间）

保留兼容 + additive：

```text
GET/POST/PATCH /api/finance/parameters
GET/POST/PATCH /api/finance/recognition-policy

GET/POST/PATCH /api/finance/due-schedules

GET/POST/PATCH /api/accounts-receivable
GET/POST/PATCH /api/accounts-payable

GET/POST/PATCH /api/payment-collections
GET/POST/PATCH /api/payment-disbursements

GET/POST/PATCH /api/finance/unapplied-balances
GET/POST/PATCH /api/finance/refunds
GET/POST/PATCH /api/finance/write-offs
GET/POST/PATCH /api/finance/bad-debt-provisions
GET/POST/PATCH /api/finance/transfers

GET/POST/PATCH /api/sales-invoices
GET/POST/PATCH /api/supplier-bills
GET/POST/PATCH /api/commercial-credit-notes

GET/POST/PATCH /api/finance/settlement-accounts
GET       /api/finance/treasury-movements
POST      /api/finance/treasury-transfers
POST      /api/finance/treasury/cash-deposit
POST      /api/finance/treasury/cash-withdrawal
GET/POST/PATCH /api/finance/notes
GET/POST/PATCH /api/finance/payment-requests
GET/POST/PATCH /api/finance/cash-counts

GET/POST/PATCH /api/finance/bank-statements
POST      /api/finance/bank-statements/import
GET/POST/PATCH /api/finance/bank-reconciliations

POST      /api/finance/business-close/{ar|ap|treasury}/close
POST      /api/finance/business-close/{ar|ap|treasury}/reopen
GET       /api/finance/business-close

GET       /api/finance/reports/{ar|ap|treasury}/{summary|detail|aging|due|tracking|uninvoiced|reconciliation}

POST      /api/finance/source-facts          (FO57 read-only)
POST      /api/finance/accounting-events     (FO58 emit)
```

`/api/finance/*` 是命名空间；legacy 路径保留为 alias。

### 28.16.2 Compatibility / 410 Strategy

不 flag-day rewrite：

```text
legacy endpoint
  → canonical finance module
  → 旧业务逻辑禁止散落；仅保留 dispatch + adapter
```

Deprecated routes 在 caller migration 完成后返回 410：

```text
/api/cash-journals  → 410 after migration
/api/bills          → 410 after migration
/api/fixed-assets   → 410 after migration (B3107 → Accounting & Analytics)
/api/bank-accounts  → /api/finance/settlement-accounts alias 保留至 migration 完
```

## 28.17 Mobile Information Architecture

### 28.17.1 Launcher Strategy

≤ 6 Finance Operations primary launcher entries（document.md §33.41）：

```text
Receivables     (FO09 / FO11 / FO15 / FO22 / FO26 / FO27 / FO28)
Collections     (FO16 / FO18 / FO19 / FO20)
Payables        (FO10 / FO12 / FO15)
Payments        (FO17 / FO18 / FO25 / FO26)
Invoices        (FO29 / FO30 / FO31 / FO33 / FO34 / FO35)
Treasury        (FO37 / FO39 / FO40 / FO41 / FO45 / FO48 / FO53)
```

Sub-functions（refund / write-off / bad-debt / close / bank reconciliation / cash count / notes / payment request / AR-AP transfer）通过 hub / contextual navigation。

### 28.17.2 Responsive Contract

```text
320 / 390 / 430 / 680 CSS px
no horizontal document overflow
touch targets ≥ 44px
LIST → DETAIL → EDITOR / WORKFLOW
```

### 28.17.3 Domain Alignment Migration

B3106 (`product-costs` / `cost-rates`) 与 B3107 (`fixed-assets`) 当前 `domain='finance-operations'` 保留为 architectural debt。本 Domain Closure 不实施 route 移动；后续 Domain Alignment 单独调整。

### 28.17.4 Discount UI

- sales-discounts：commercial UI owner = Sales & Customer；finance effect = Finance Operations（FO26 经 credit-adjustment）。
- purchase-discounts：contextual Finance Operations；finance effect = Finance Operations。
- 不得仅因视觉对称 move routes。

## 28.18 Migration / Convergence Strategy

### 28.18.1 既有 canonical 保留（converge）

保留并扩展：

```text
account_receivables            (FO09 / FO11; canonical open-item header AR with additive recognition_mode / item_kind / conversion_state / provisional_origin_id / converted_open_item_id / settlement_account_id)
account_payables               (FO10 / FO12; canonical open-item header AP same additive)
payment_collections            (FO16)
payment_disbursements          (FO17)
payment_collection_items       (FO18; canonical source for ALLOCATION)
payment_disbursement_items     (FO18; canonical source for ALLOCATION)
financial_credit_adjustments   (CREDIT canonical source)
settlement_unapplied_balances  (PREPAYMENT / CREDIT canonical source)
balance_applications           (UNAPPLIED_APPLICATION canonical source)
financial_refunds              (FO26)
financial_refund_reversals     (REFUND reversal canonical source)
settlement_reversals           (FO22 header)
settlement_reversal_items      (FO22 component-level reversal; ALLOCATION + UNAPPLIED)
financial_write_offs           (FO27; WRITE_OFF canonical source)
financial_write_off_reversals  (WRITE_OFF reversal canonical source)
bank_statements / items        (FO46)
bank_reconciliations           (legacy compat projection; canonical 由 finance_bank_reconciliations 接管)
cash_journals                  (FO39 read projection; write path 全部迁移至 applyTreasuryMovement)
bills                          (FO42 / FO43 legacy; migrate to finance_notes)
sales_invoices / supplier_bills / commercial_credit_notes  (FO29 / FO30 / FO33)
```

`bank_accounts` 现归 EXISTING_CONVERGE（canonical master，见 §28.1.2.1）。`bank_reconciliations` / `period_closures` 归 COMPATIBILITY（§28.1.2.3）。

MODEL B 决定：

```text
existing source tables = canonical economic facts
finance_open_item_effects = DERIVED SQL VIEW (non-authoritative / non-persisted / rebuild-free)
refreshOpenAmount() reads the VIEW only; chain: source facts → VIEW → equation → cached open_amount_cents
```

不得新建第二 engine；finance_settlement_accounts master **不创建**（bank_accounts 单 master）。

### 28.18.2 Additive / Idempotent Migration

每个 finance migration 必须：

```text
1. ADD COLUMN / CREATE TABLE IF NOT EXISTS
2. idempotent（重跑 OK）
3. 不 DROP historical finance table
4. 不 UPDATE 历史已确认 financial facts
5. before / after reconciliation check
6. fail-closed on mismatch
7. rollback aware
```

### 28.18.3 AR / AP Double Recognition Detection

启用新 recognition engine 前：

```sql
SELECT * FROM account_receivables a
WHERE EXISTS (
  SELECT 1 FROM sales_invoices si WHERE si.id = a.source_id AND si.source_type='SALES_INVOICE'
)
```

分类：

```text
SAFE_LINK          -- invoice.post 显式 link 既有 AR
DUPLICATE_EXPOSURE  -- AR 已有 + invoice post 又创建新 AR
AMBIGUOUS          -- 无法判定 → migration abort + report
```

ambiguous → 不启用；要求 user intervention。

### 28.18.4 Treasury Reconciliation

```text
bank_accounts.balance_cents  vs  SUM(finance_treasury_movements by account)
cash_journals                 →  classify already_represented / needs_migration / ambiguous
```

不得 double import。convergence 后只 `applyTreasuryMovement` 一个 active writer。

### 28.18.5 Due Schedule

```text
INSERT INTO finance_due_schedule_lines(open_item_id, sequence=1, due_date=ar.due_date, scheduled_amount_cents=ar.original_amount_cents)
```

未知 / 缺 legacy terms：保留 single-line default。

### 28.18.6 Provisional Migration

只 migrate policy evidence 允许的；其他保留 legacy final/open facts。

### 28.18.7 Health Checks

```text
duplicate exposure
negative open amount
open cache mismatch
orphan allocation
negative unapplied balance
treasury balance mismatch
orphan treasury movement
invoice recognition mismatch
provisional conversion mismatch
bank match over-allocation
business-close violation
```

Blocking mismatch → health FAIL。

## 28.19 Transaction / Locking Model

### 28.19.1 Transaction Boundaries

每个 economic write 必须 transaction boundary：

```text
open-item recognition           → transaction
allocation confirm              → transaction
reversal                        → transaction
refund                          → transaction
write-off                       → transaction
transfer                        → transaction
provisional conversion          → transaction
invoice post                    → transaction
treasury movement               → transaction (applyTreasuryMovement)
bank transfer                   → transaction
business close                  → transaction
bank reconciliation match       → transaction (no cash mutation)
```

不允许 partial economic commit。

### 28.19.2 Lock Ordering

Open item 锁定顺序：

```text
1. collect open_item IDs
2. deduplicate
3. sort lexicographic ASC
4. lock ASC (FOR UPDATE on MySQL; BEGIN IMMEDIATE on SQLite)
```

Settlement account：

```text
1. collect account IDs
2. deduplicate
3. sort ASC
4. lock ASC
```

Bank reconciliation match：

```text
1. statement_line IDs
2. treasury_movement IDs
3. combined sort ASC
```

不得基于业务方向加锁（避免反向 transfer deadlock）。

### 28.19.3 SQLite vs MySQL

SQLite：`BEGIN IMMEDIATE` 序列化写。

MySQL：`SELECT ... FOR UPDATE` 锁存在行；absence / uniqueness race 走：

```text
UNIQUE keys
idempotency keys
transaction retry (复用既有 retry infrastructure)
```

`finance_treasury_movements.idempotency_key` UNIQUE 与 `finance_bank_statement_items.import_fingerprint` UNIQUE 是 absence-race 的兜底。`finance_open_item_effects` 是 DERIVED SQL VIEW（无 UNIQUE 约束）；absence-race 兜底由 underlying source tables 提供。

## 28.20 MySQL Race Design (15)

每个 race 真实 MySQL 实证；SQLite-only 不计入。

### 28.20.1 Race Matrix

| Race | Conflicting Ops | Rows Locked | Lock Order | Idempotency | Expected Outcome |
|---|---|---|---|---|---|
| RACE-01 | Collection vs Collection on same AR | target AR open items (sorted) + both collections' allocations | AR open_item_ids ASC | COLLECTION_CONFIRM:{collection_id} UNIQUE | exactly-one total allocation succeeds; no negative open |
| RACE-02 | Payment vs Payment on same AP | target AP open items + both disbursements' allocations | AP open_item_ids ASC | PAYMENT_CONFIRM:{disbursement_id} UNIQUE | exactly-one total allocation succeeds |
| RACE-03 | Collection confirm vs settlement reversal | collection + allocations + affected open items | settlement id ASC then open_item id ASC | COLLECTION_CONFIRM + SETTLEMENT_REVERSAL both UNIQUE | either both committed or no cash reversal without allocation reversal |
| RACE-04 | Payment confirm vs settlement reversal | disbursement + allocations + open items | same as RACE-03 | same | same invariant |
| RACE-05 | Same prepayment / advance application twice | unapplied_balance + target_open_item | balance_id then target_open_item_id ASC | BALANCE_APPLY:{balance_id}:{target_id}:{amount} UNIQUE | remaining unapplied cannot go negative |
| RACE-06 | Refund vs balance application | balance_id + target_open_item | balance_id then target_open_item_id ASC | REFUND_CONFIRM + BALANCE_APPLY UNIQUE | only remaining consumed |
| RACE-07 | Write-off vs settlement | open_item_id + write_off + settlement allocation | open_item_id ASC | WRITE_OFF_CONFIRM + COLLECTION_CONFIRM UNIQUE | combined effect cannot exceed open amount |
| RACE-08 | AR transfer vs collection | source_open_item + transfer + target open item | open_item_ids ASC | TRANSFER_CONFIRM + COLLECTION_CONFIRM UNIQUE | total exposure conserved |
| RACE-09 | AP transfer vs payment | same as RACE-08 for AP side | same | same | same |
| RACE-10 | Same sales invoice post twice | invoice + invoice_source_links + recognizeFinanceExposure | invoice.id ASC | INVOICE_POST:{invoice_id} UNIQUE | idempotent repeat → same result or controlled 409 |
| RACE-11 | Supplier Bill Match / Post / Double-Post | supplier_bill + receipt lines + invoice_source_links + recognizeFinanceExposure | bill.id then source line ids ASC | SUPPLIER_BILL_MATCH + SUPPLIER_BILL_POST UNIQUE | A match vs post protected; B post vs post protected |
| RACE-12 | Provisional conversion vs ordinary settlement | provisional_open_item + conversion + target final open item + payment | open_item_ids ASC | PROVISIONAL_CONVERT:{bill_id} UNIQUE | conversion locks provisional before payment can target final |
| RACE-13 | Same treasury transfer execute twice | **both bank_accounts canonical settlement accounts** + finance_treasury_movements | **both settlement_account_ids ASC (deterministic ordering across two accounts)** | TREASURY_TRANSFER:{transfer_id} UNIQUE | exactly one OUT + IN pair; lock order ASC over the two bank_accounts rows |
| RACE-14 | Same bank statement line reconcile twice | statement_line + treasury_movement + reconciliation_match | statement_line ASC then movement ASC | BANK_MATCH:{statement_id}:{movement_id}:{amount} UNIQUE | remaining cannot go negative |
| RACE-15 | Business close vs dated financial transaction | **finance_business_close_state row (3 seeded anchors)** + any dated transaction | **stable anchor FOR UPDATE** in `finance_business_close_state(close_type=?)` | assertFinanceBusinessDateOpen locks same row as close handler; **no absence-row race** | either transaction commits before close or close commits first and transaction rejects; never both inconsistent |

### 28.20.2 Future Gate

```text
pnpm test:mysql:finance-concurrency
  → FINANCE RACE DIALECT = mysql
  → RACE-01..15 = PASS
```

必须真实 MySQL；不得复用 Inventory race list。

## 28.21 UAT Traceability (32)

| UAT | Capability | Service | Table | Endpoint | Evidence |
|---|---|---|---|---|---|
| UAT-01 AR initialization | FO06 | finance-ar-init.js | account_receivables (opening) + finance_due_schedule_lines | /api/finance/parameters + opening handler | opening AR + opening_other_AR; no fake daily history |
| UAT-02 AP initialization | FO07 | finance-ap-init.js | account_payables + finance_due_schedule_lines | same | same |
| UAT-03 Treasury initialization | FO08 | finance-treasury-init.js | **bank_accounts (canonical settlement account master via additive extend)** + finance_treasury_movements (opening) | /api/finance/settlement-accounts POST | opening cash + bank + enterprise outstanding |
| UAT-04 DIRECT_BUSINESS AR | FO09 + FO02 | recognizeFinanceExposure | account_receivables (canonical header); finance_open_item_effects (DERIVED VIEW projection) | sales-deliveries confirm + /api/accounts-receivable | one final AR; later invoice link only |
| UAT-05 INVOICE_DRIVEN AR | FO09 + FO02 | recognizeFinanceExposure | account_receivables | sales-invoices post | one final AR; no delivery AR |
| UAT-06 PROVISIONAL_TO_FINANCIAL AR | FO11 + FO13 | recognizeFinanceExposure + reverseProvisionalAndCreateFinal | account_receivables (conversion_state + converted_open_item_id); finance_open_item_effects (DERIVED VIEW projection) | /api/sales-invoices post | provisional reverse + final create |
| UAT-07 DIRECT_BUSINESS AP | FO10 + FO02 | recognizeFinanceExposure | account_payables | purchase-receipts confirm | one final AP |
| UAT-08 INVOICE_DRIVEN AP | FO10 + FO02 | recognizeFinanceExposure | account_payables | supplier-bills post | one final AP |
| UAT-09 PROVISIONAL_TO_FINANCIAL AP | FO12 + FO13 | recognizeFinanceExposure + convertProvisionalToFinancial | account_payables (conversion_state + converted_open_item_id); finance_open_item_effects (DERIVED VIEW projection) | /api/supplier-bills post | provisional reverse + final create |
| UAT-10 Multi-due-date Schedule | FO04 | finance-due-schedule.js | finance_due_schedule_lines (side+open_item_id portable identity) | /api/finance/due-schedules | sum=original; partial allocation tracks due_date ASC |
| UAT-11 Partial collection | FO16 + FO18 | payment_collections + payment_collection_items | payment_collections + payment_collection_items (canonical source) | /api/payment-collections POST | partial open → PARTIAL; no over-application |
| UAT-12 Partial payment | FO17 + FO18 | payment_disbursements + payment_disbursement_items | payment_disbursements + payment_disbursement_items (canonical source) | /api/payment-disbursements POST | partial open → PARTIAL |
| UAT-13 Multi-open-item allocation | FO18 | payment_*_items | payment_*_items (canonical source) | multi-line allocation | one settlement → many items; many → one |
| UAT-14 Automatic / manual reconciliation | FO19 + FO20 | finance-reconciliation.js | payment_*_items (auto) + manual allocation | /api/finance/reconciliation run + manual | single AR/AP truth |
| UAT-15 Advance receipt | FO23 | finance-unapplied-balance.js | settlement_unapplied_balances (PREPAYMENT, canonical source) | /api/payment-collections w/ explicit_unapplied | balance created; not allocation |
| UAT-16 Supplier prepayment | FO23 | finance-unapplied-balance.js | settlement_unapplied_balances (PREPAYMENT, SUPPLIER) | /api/payment-disbursements w/ explicit_unapplied | balance created |
| UAT-17 Unapplied balance application | FO25 | balance_applications | balance_applications (canonical source) | /api/finance/unapplied-balances apply | balance remaining → 0; target open_item down |
| UAT-18 Unapplied-Balance Refund | FO26 | financial_refunds + applyTreasuryMovement | financial_refunds + finance_treasury_movements | /api/finance/refunds POST | customer-side + supplier-side both PASS |
| UAT-19 Settlement reversal | FO22 | settlement_reversals + settlement_reversal_items | settlement_reversals + settlement_reversal_items (canonical source) | /api/finance/settlements/{id}/reverse | ALLOCATION + UNAPPLIED component reversal |
| UAT-20 Write-off + reversal | FO27 | financial_write_offs + reversals | financial_write_offs + financial_write_off_reversals (canonical source) | /api/finance/write-offs + reverse | DRAFT → CONFIRMED → REVERSED; accounting event |
| UAT-21 Bad-Debt Provision | FO28 | finance_bad_debt_provisions | finance_bad_debt_provisions | /api/finance/bad-debt-provisions | AGING + INDIVIDUAL; reversal evidence |
| UAT-22 AR counterparty transfer | FO15 | finance-counterparty-transfer | finance_counterparty_transfers + finance_counterparty_transfer_lines | /api/finance/transfers | source down + target up; total conserved |
| UAT-23 AP counterparty transfer | FO15 | same AP | same | /api/finance/transfers | same invariant |
| UAT-24 Sales invoice partial / source / credit / void | FO29 + FO31 + FO33 + FO34 | finance-sales-invoice.js | sales_invoices (lifecycle + credit_state) + finance_invoice_source_links + commercial_credit_notes | /api/sales-invoices POST + patch | partial invoicing + credit_state NONE/PARTIAL/FULL; void only with atomic reversal |
| UAT-25 Purchase invoice matching / verification / credit | FO30 + FO31 + FO35 | finance-purchase-invoice.js | supplier_bills + finance_invoice_source_links + verification_state | /api/supplier-bills POST + verify | 3-way match; UNVERIFIED→VERIFIED→CERTIFIED/REJECTED |
| UAT-26 Cash / Bank settlement account | FO37 + FO38 | finance-settlement-account | **bank_accounts (canonical, additive extended with CASH/BANK/code/opening_balance_cents/accounting_role)** | /api/finance/settlement-accounts | CASH + BANK rows in single master; opening + accounting_role + accounting_subject_id; finance_settlement_accounts master NOT created |
| UAT-27 Cash deposit / withdrawal + internal transfer | FO40 + FO41 | finance-treasury-cash + finance-treasury-bank-transfer | finance_treasury_movements (paired, movement_group_id) + bank_accounts.balance_cents cache | /api/finance/treasury/cash-deposit + treasury-transfers | paired IN/OUT; total conserved; balance cache reconciles to canonical movements |
| UAT-28 Notes receivable / payable + payment request | FO42 + FO43 + FO44 | finance-notes + finance-payment-request | finance_notes + finance_payment_requests | /api/finance/notes + /api/finance/payment-requests | REGISTERED→HELD→SETTLED; APPROVED!=movement |
| UAT-29 Cash count | FO45 | finance-cash-count | finance_cash_counts + finance_cash_count_lines | /api/finance/cash-counts POST | book vs physical; difference explicit; no silent overwrite |
| UAT-30 Bank statement import + reconciliation + unmatched items | FO46 + FO47 + FO48 + FO49 | finance-bank-statement + finance-bank-import + finance-bank-reconciliation | bank_statements + bank_statement_items + **finance_bank_statement_imports** + **finance_bank_reconciliations** + **finance_bank_reconciliation_matches** | /api/finance/bank-statements/import + reconciliations | idempotent import (fingerprint); 1↔1 / 1↔n / n↔1 matches; unmatched projection; no treasury mutation from recon |
| UAT-31 AR / AP / Treasury close + reopen | FO51 + FO52 + FO53 | finance-business-close | **finance_business_close_state (stable 3-seeded anchor, lock target)** + finance_business_closures (history rows) | /api/finance/business-close/{ar\|ap\|treasury}/{close\|reopen} | composite: three independent closes each PASS; absence-row race eliminated by seeded anchors |
| UAT-32 AR / AP / Treasury reports + Treasury ↔ GL reconciliation | FO54 + FO55 + FO56 + FO50 | finance-reports + finance-gl-reconcile | report projections + comparison result | /api/finance/reports/* + /api/finance/gl-reconcile | POSTED-only fact projections; PASS/MISMATCH |

Final Acceptance 必须 `32 / 32 PASS`；不得 defer。

### 28.21.1 UAT-18 双方向必证

UAT-18 必须独立两个 test：

```text
UAT-18a Customer-side refund PASS
UAT-18b Supplier-side refund PASS
```

UAT-19 不得替代 UAT-18。

### 28.21.2 UAT-31 三独立业务关账

UAT-31 是 composite：

```text
UAT-31a AR close + reopen PASS
UAT-31b AP close + reopen PASS
UAT-31c Treasury close + reopen PASS
UAT-31d AR close != AP close != Treasury close
UAT-31e 三者均 != Accounting & Analytics accounting-period close
```

## 28.22 Capability Traceability (58)

| ID | Domain / Integration | Status | Service | Schema / Module |
|---|---|---|---|---|
| FO01 | Domain-Owned | EXISTING_REUSE | finance-parameters | finance_parameters (NEW table #1) |
| FO02 | Domain-Owned | NEW | finance-recognition-policy | finance_recognition_policy (NEW table #2) |
| FO03 | Domain-Owned | NEW | finance-terms | finance_payment_terms (NEW table #3) |
| FO04 | Domain-Owned | NEW | finance-due-schedule | finance_due_schedule_lines (NEW table #4; side+open_item_id portable identity) |
| FO05 | Domain-Owned | NEW | finance-settlement-scheme | finance_settlement_schemes (NEW table #5) |
| FO06 | Domain-Owned | CONVERGE | finance-ar-init + commercial-golive | account_receivables (canonical header; additive cols) + finance_due_schedule_lines (opening migration) |
| FO07 | Domain-Owned | CONVERGE | finance-ap-init + commercial-golive | account_payables (canonical header; additive cols) + finance_due_schedule_lines |
| FO08 | Domain-Owned | CONVERGE | finance-treasury-init | bank_accounts (canonical master additive extend) + finance_treasury_movements (opening) |
| FO09 | Domain-Owned | CONVERGE | finance-ar-open-item | account_receivables (canonical header); finance_open_item_effects (DERIVED VIEW projection) |
| FO10 | Domain-Owned | CONVERGE | finance-ap-open-item | account_payables (canonical header); finance_open_item_effects (DERIVED VIEW projection) |
| FO11 | Domain-Owned | NEW | finance-ar-open-item (PROVISIONAL) | item_kind='PROVISIONAL' on account_receivables |
| FO12 | Domain-Owned | NEW | finance-ap-open-item (PROVISIONAL) | item_kind='PROVISIONAL' on account_payables |
| FO13 | Domain-Owned | NEW | finance-provisional-conversion | conversion_state / converted_open_item_id on account_receivables / account_payables |
| FO14 | Domain-Owned | NEW | finance-manual-ar-ap | account_receivables / account_payables (manual) |
| FO15 | Domain-Owned | NEW | finance-counterparty-transfer | finance_counterparty_transfers (NEW #6) + finance_counterparty_transfer_lines (NEW #7) |
| FO16 | Domain-Owned | EXISTING_REUSE | finance-collection | payment_collections (EXISTING_CONVERGE) |
| FO17 | Domain-Owned | EXISTING_REUSE | finance-payment | payment_disbursements (EXISTING_CONVERGE) |
| FO18 | Domain-Owned | EXISTING_REUSE | finance-allocation | payment_collection_items / payment_disbursement_items (canonical source for ALLOCATION) |
| FO19 | Domain-Owned | NEW | finance-reconciliation (auto) | finance_settlement_schemes (NEW #5) rule rows |
| FO20 | Domain-Owned | NEW | finance-reconciliation (manual) | manual allocation path |
| FO21 | Domain-Owned | EXISTING_REUSE | settlement | audit / trace evidence |
| FO22 | Domain-Owned | EXISTING_REUSE | finance-settlement-reversal | settlement_reversals + settlement_reversal_items (canonical source for REVERSAL) |
| FO23 | Domain-Owned | EXISTING_REUSE | finance-unapplied-balance (PREPAYMENT) | settlement_unapplied_balances (canonical source) |
| FO24 | Domain-Owned | EXISTING_REUSE | finance-unapplied-balance (CREDIT) | settlement_unapplied_balances (canonical source) |
| FO25 | Domain-Owned | EXISTING_REUSE | finance-unapplied-balance (apply) | balance_applications (canonical source for UNAPPLIED_APPLICATION) |
| FO26 | Domain-Owned | EXISTING_REUSE | finance-unapplied-balance (refund) | financial_refunds + applyTreasuryMovement |
| FO27 | Domain-Owned | EXISTING_REUSE | finance-write-off | financial_write_offs (canonical source for WRITE_OFF) |
| FO28 | Domain-Owned | NEW | finance-bad-debt-provision | finance_bad_debt_provisions (NEW #8) |
| FO29 | Domain-Owned | CONVERGE | finance-sales-invoice | sales_invoices (additive cols incl. credit_state / credited_amount_cents / remaining_creditable_amount_cents) |
| FO30 | Domain-Owned | CONVERGE | finance-purchase-invoice | supplier_bills (additive cols incl. credit_state etc.) |
| FO31 | Domain-Owned | NEW | finance-invoice-cardinality | finance_invoice_source_links (NEW #9) |
| FO32 | Domain-Owned | NEW | finance-invoice-arap-reconcile | invoice ↔ open_item links |
| FO33 | Domain-Owned | EXISTING_REUSE | finance-sales-invoice (credit) | commercial_credit_notes (canonical source for COMMERCIAL_CREDIT) |
| FO34 | Domain-Owned | CONVERGE | finance-sales-invoice (void) | sales_invoices.status=VOIDED/CANCELLED (atomic-reversal scope) |
| FO35 | Domain-Owned | NEW | finance-purchase-invoice (verification) | supplier_bills.verification_state |
| FO36 | Domain-Owned | NEW | finance-reports | invoice operational reports (report projection) |
| FO37 | Domain-Owned | NEW | finance-settlement-account | **bank_accounts (canonical master, additive extend — no finance_settlement_accounts table)** |
| FO38 | Domain-Owned | NEW | finance-settlement-method | bank_accounts.account_type / accounting_role additive cols |
| FO39 | Domain-Owned | NEW | finance-treasury-movement | finance_treasury_movements (NEW #10) + applyTreasuryMovement |
| FO40 | Domain-Owned | NEW | finance-treasury-cash | paired movements via applyTreasuryMovement |
| FO41 | Domain-Owned | NEW | finance-treasury-bank-transfer | paired movements via applyTreasuryMovement (bank_accounts lock ASC) |
| FO42 | Domain-Owned | NEW | finance-notes (RECEIVABLE) | finance_notes (NEW #11) |
| FO43 | Domain-Owned | NEW | finance-notes (PAYABLE) | finance_notes (NEW #11) |
| FO44 | Domain-Owned | NEW | finance-payment-request | finance_payment_requests (NEW #12) |
| FO45 | Domain-Owned | NEW | finance-cash-count | finance_cash_counts (NEW #13) + finance_cash_count_lines (NEW #14) |
| FO46 | Domain-Owned | EXISTING_REUSE | finance-bank-statement | bank_statements + items |
| FO47 | Domain-Owned | NEW | finance-bank-import | finance_bank_statement_imports (NEW #15) |
| FO48 | Domain-Owned | NEW | finance-bank-reconciliation | finance_bank_reconciliations (NEW #16) + finance_bank_reconciliation_matches (NEW #17) |
| FO49 | Domain-Owned | NEW | finance-bank-reconciliation (unmatched) | unmatched projections (read model) |
| FO50 | Integration-Backed | INTEGRATION | finance-gl-reconcile | comparison evidence (no GL mutation) |
| FO51 | Domain-Owned | NEW | finance-business-close (AR) | finance_business_close_state (NEW #18; AR seed) + finance_business_closures (NEW #19; history) |
| FO52 | Domain-Owned | NEW | finance-business-close (AP) | finance_business_close_state (NEW #18; AP seed) + finance_business_closures (NEW #19; history) |
| FO53 | Domain-Owned | NEW | finance-business-close (TREASURY) | finance_business_close_state (NEW #18; TREASURY seed) + finance_business_closures (NEW #19; history) |
| FO54 | Domain-Owned | NEW | finance-reports (AR) | AR reports |
| FO55 | Domain-Owned | NEW | finance-reports (AP) | AP reports |
| FO56 | Domain-Owned | NEW | finance-reports (Treasury) | Treasury reports |
| FO57 | Integration-Backed | INTEGRATION | finance-source-adapter | getFinancialSourceFacts (read only) |
| FO58 | Integration-Backed | INTEGRATION | finance-accounting-adapter | emitAccountingEvent (use existing voucher adapter) |

合计 `58 = 55 Domain-Owned + 3 Integration-Backed`。每 ID 显式标注 status；后续 Implementation 不得变更。

## 28.23 Implementation Waves (5, fixed)

不得扩展至 Wave F+。

### 28.23.0 Primary Wave Ownership — Exactly One Per Capability

每个 FO01..FO58 显式拥有唯一 primary Wave；其它 Wave 仅能以 dependency / integration / acceptance reuse 引用。

| FO | Primary Wave | Role in Other Waves |
|---|---|---|
| FO01 | **Wave A** | A 主；B/C/D/E 仅读取参数 |
| FO02 | **Wave A** | A 主；B/C 消费 policy |
| FO03 | **Wave A** | A 主；B 消费 terms 生成 allocation priority |
| FO04 | **Wave A** | A 主；B 在 allocation 时消费 schedule lines |
| FO05 | **Wave B** | B 主；A 仅占位 schema |
| FO06 | **Wave A** | A 主；E 关闭 compatibility 报告 |
| FO07 | **Wave A** | A 主；E 关闭 compatibility 报告 |
| FO08 | **Wave A** | A 主；D 消费 opening movements |
| FO09 | **Wave A** | A 主；B 写入 allocation；C 写入 invoice recognition |
| FO10 | **Wave A** | A 主；B 写入 allocation；C 写入 invoice recognition |
| FO11 | **Wave A** | A 主；C 触发 conversion |
| FO12 | **Wave A** | A 主；C 触发 conversion |
| FO13 | **Wave A** | A 主；C 调用 conversion；E 验证 acceptance |
| FO14 | **Wave A** | A 主（手动 AR / AP 在 truth foundation 建立后即可工作；C 仅消费） |
| FO15 | **Wave B** | B 主；E 仅依赖 transfer 路径 |
| FO16 | **Wave B** | B 主 |
| FO17 | **Wave B** | B 主 |
| FO18 | **Wave B** | B 主 |
| FO19 | **Wave B** | B 主 |
| FO20 | **Wave B** | B 主 |
| FO21 | **Wave B** | B 主；E 复用 records & trace |
| FO22 | **Wave B** | B 主 |
| FO23 | **Wave B** | B 主 |
| FO24 | **Wave B** | B 主 |
| FO25 | **Wave B** | B 主 |
| FO26 | **Wave B** | B 主（依赖 D 写 treasury movement） |
| FO27 | **Wave B** | B 主 |
| FO28 | **Wave B** | B 主 |
| FO29 | **Wave C** | C 主；B 不消费；E 仅报表 |
| FO30 | **Wave C** | C 主；B 不消费；E 仅报表 |
| FO31 | **Wave C** | C 主 |
| FO32 | **Wave C** | C 主 |
| FO33 | **Wave C** | C 主；B 不消费；E 验证 credit_state |
| FO34 | **Wave C** | C 主 |
| FO35 | **Wave C** | C 主 |
| FO36 | **Wave E** | E 主（invoice operational reports 是 reporting concern） |
| FO37 | **Wave D** | D 主；A 仅占位 schema |
| FO38 | **Wave D** | D 主 |
| FO39 | **Wave D** | D 主；B 调用以写 cash allocation；E 验证 |
| FO40 | **Wave D** | D 主 |
| FO41 | **Wave D** | D 主 |
| FO42 | **Wave D** | D 主 |
| FO43 | **Wave D** | D 主 |
| FO44 | **Wave D** | D 主 |
| FO45 | **Wave D** | D 主 |
| FO46 | **Wave D** | D 主 |
| FO47 | **Wave D** | D 主 |
| FO48 | **Wave D** | D 主 |
| FO49 | **Wave D** | D 主 |
| FO50 | **Wave E** | E 主（GL reconcile 是 reporting concern） |
| FO51 | **Wave A** | A 主；B/C/D 调用 guard |
| FO52 | **Wave A** | A 主；B/C/D 调用 guard |
| FO53 | **Wave A** | A 主；B/C/D 调用 guard |
| FO54 | **Wave E** | E 主 |
| FO55 | **Wave E** | E 主 |
| FO56 | **Wave E** | E 主 |
| FO57 | **Wave E** | E 主（source adapter finalize） |
| FO58 | **Wave E** | E 主（accounting adapter finalize） |

每 Wave 主 ownership 计数：

```text
Wave A: FO01, FO02, FO03, FO04, FO06, FO07, FO08, FO09, FO10, FO11, FO12, FO13, FO14, FO51, FO52, FO53  = 16
Wave B: FO05, FO15, FO16, FO17, FO18, FO19, FO20, FO21, FO22, FO23, FO24, FO25, FO26, FO27, FO28          = 15
Wave C: FO29, FO30, FO31, FO32, FO33, FO34, FO35                                                          = 7
Wave D: FO37, FO38, FO39, FO40, FO41, FO42, FO43, FO44, FO45, FO46, FO47, FO48, FO49                       = 13
Wave E: FO36, FO50, FO54, FO55, FO56, FO57, FO58                                                           = 7
```

合计 `16 + 15 + 7 + 13 + 7 = 58` ✓。每个 FO 恰好一个 primary Wave；其余 Wave 仅以 dependency / integration / acceptance reuse 引用。

### 28.23.1 Wave A — Finance Truth Foundation

```text
FO01 / FO02  recognition policy
FO03 / FO04  terms + due schedule
FO06 / FO07 / FO08  initialization
FO09 / FO10  final open items
FO11 / FO12 / FO13  provisional + conversion
FO14        manual AR / AP
FO51 / FO52 / FO53  business-close foundation (stable anchor seeded)
O. migration / reconciliation
P. transaction / locking (sqlite / mysql parity)
Q. RACE-15 (close vs dated; locks finance_business_close_state)
```

Exit gates：

```text
5+ focused tests
pnpm test:fast PASS
sqlite BEGIN IMMEDIATE + mysql FOR UPDATE 已贯通
finance_business_close_state 已 seed 3 行
```

### 28.23.2 Wave B — Settlement Convergence

```text
FO05        settlement / reconciliation scheme
FO15        AR/AP counterparty transfer
FO16 / FO17  collection / payment
FO18        allocation
FO19 / FO20 / FO21  reconciliation
FO22        reversal
FO23 / FO24 / FO25 / FO26  unapplied + refund
FO27 / FO28  write-off + bad debt
Q. RACE-01..09
```

Exit gates：

```text
5+ focused tests
pnpm test:fast + test:heavy PASS
mysql RACE-01..09 (real MySQL)
```

### 28.23.3 Wave C — Invoice / Recognition Convergence

```text
FO29 / FO30  sales / purchase invoice
FO31 / FO32  cardinality + recon
FO33 / FO34  credit / void
FO35        verification
Q. RACE-10 / RACE-11 / RACE-12
```

Exit gates：

```text
5+ focused tests
duplicate-exposure detection PASS
no orphan AR/AP after credit / void / VOIDED
mysql RACE-10/11/12
```

### 28.23.4 Wave D — Treasury Convergence

```text
FO37 / FO38  settlement accounts (bank_accounts additive extend)
FO39        canonical treasury movement
FO40 / FO41  cash / bank transfer
FO42 / FO43  notes
FO44        payment request
FO45        cash count
FO46 / FO47  bank statement + import
FO48 / FO49  reconciliation + unmatched
Q. RACE-13 / RACE-14
```

Exit gates：

```text
5+ focused tests
cash_journals → applyTreasuryMovement migrate PASS
bank_accounts additive extend (CASH / BANK / accounting_role / opening_balance_cents) PASS
mysql RACE-13/14
```

### 28.23.5 Wave E — Reporting / Compatibility / Final Convergence

```text
FO36        invoice operational reports
FO50        Treasury ↔ GL reconcile
FO54 / FO55 / FO56  reports
FO57 / FO58  source / accounting adapter finalize
N. mobile IA (≤ 6 launchers)
legacy route convergence (cash-journals / bills / fixed-assets → 410 后置)
M. permission finalize (FINANCE_*)
32 UAT harness + 15 RACE harness finalize
D. responsive 320/390/430/680
```

Exit gates：

```text
pnpm test / test:heavy / test:mysql / test:mysql:concurrency (15 finance races) / test:mysql:performance
pnpm build
git diff --check
32/32 UAT PASS
6/6 launchers × 4 widths responsive
```

## 28.24 Compatibility / Normalization vs Older Sections

### 28.24.1 `solution.md §9.4 Finance` Normalization

`solution.md §9.4` 早期 finance flow 描述保留作为 historical context；本 Domain Closure 的 canonical 入口与所有权映射以 §28.1.1 为准。`Sales Invoice / Supplier Bill → AR/AP Open Item → Collection/Payment/Credit → Allocation → Refund/Write-off/Reversal` 仍是有用主线，但必须经 `recognizeFinanceExposure`（§28.2.3）与 `applyTreasuryMovement`（§28.11.4）。

### 28.24.2 `solution.md §13` Normalization

- `§13.1 AR/AP` → 已被 §28.3 / §28.6 取代；
- `§13.2 Invoice/Bill` → 已被 §28.10 取代；
- `§13.3 Inventory Cost` → 归属 Accounting & Analytics（B3106），本 Domain 不承接；
- `§13.4 Fixed Assets` → 归属 Accounting & Analytics（B3107），本 Domain 不承接；
- `§13.5 Smart Accounting` → 归属 Accounting & Analytics（B3114），本 Domain 不承接。

`solution.md §13.1 / §13.2` 仍保留文字，但不再作为 Finance Operations canonical 实现入口；本节为唯一权威。

### 28.24.3 Frozen Domain Boundaries

本节不重写：

```text
Master & Engineering §28  (Engineering / BOM)
Manufacturing & Quality §24  (Production / Quality)
Planning §25                 (MRP / Reservation)
Procurement & Outsourcing §26 (Sourcing / VMI / Outsourcing)
Inventory & Warehouse §27    (Canonical position_key / applyInventoryMutation)
```

Finance Operations 仅 consume 这些 frozen domains 的 source facts 与 inventory adapter，不重写。

## 28.25 Testing Strategy

### 28.25.1 Suite Membership

新增 finance focused suite 入 `scripts/testing/test-suites.js`：

```text
finance-recognition-policy.test.js   (Wave A)
finance-due-schedule.test.js          (Wave A)
finance-open-item.test.js             (Wave A)
finance-provisional-conversion.test.js (Wave A)
finance-business-close.test.js        (Wave A)
finance-settlement.test.js            (Wave B)
finance-reversal.test.js              (Wave B)
finance-unapplied-balance.test.js     (Wave B)
finance-refund.test.js                (Wave B)
finance-write-off.test.js             (Wave B)
finance-bad-debt.test.js              (Wave B)
finance-counterparty-transfer.test.js (Wave B)
finance-sales-invoice.test.js         (Wave C)
finance-purchase-invoice.test.js      (Wave C)
finance-invoice-cardinality.test.js   (Wave C)
finance-invoice-credit-void.test.js   (Wave C)
finance-verification.test.js          (Wave C)
finance-settlement-account.test.js    (Wave D)
finance-treasury-movement.test.js     (Wave D)
finance-cash-deposit-withdrawal.test.js (Wave D)
finance-bank-transfer.test.js         (Wave D)
finance-notes.test.js                 (Wave D)
finance-payment-request.test.js       (Wave D)
finance-cash-count.test.js            (Wave D)
finance-bank-statement.test.js        (Wave D)
finance-bank-import.test.js           (Wave D)
finance-bank-reconciliation.test.js   (Wave D)
finance-unmatched-items.test.js       (Wave D)
finance-reports.test.js               (Wave E)
finance-gl-reconcile.test.js          (Wave E)
finance-source-adapter.test.js        (Wave E)
finance-accounting-adapter.test.js    (Wave E)
finance-route-architecture.test.js    (Wave E)
finance-domain-race.test.js           (15 races, all waves)
```

### 28.25.2 Gates

```text
pnpm test:fast
pnpm test
pnpm test:heavy
pnpm test:mysql
pnpm test:mysql:concurrency
pnpm test:mysql:finance-concurrency  (NEW; RACE-01..15)
pnpm test:mysql:performance
pnpm build
git diff --check
```

## 28.26 Audit / Transaction / Error

每个 mutation：

```text
1. 后端 allow(actor, 'FINANCE_*')
2. assertFinanceBusinessDateOpen (按 close type)
3. transaction { ... }
4. 重读权威状态 (open item remaining / balance remaining / account active)
5. idempotency check (UNIQUE on source table)
6. 写 canonical source tables (e.g. payment_*_items / balance_applications / financial_credit_adjustments / financial_write_offs / finance_treasury_movements)
7. refresh canonical balance / status — refreshOpenAmount reads finance_open_item_effects VIEW
8. emitAccountingEvent (FO58)
9. audit (CREATE / UPDATE / REVERSE / CLOSE / REOPEN)
10. fail closed on any mismatch
```

不得 silent-fallback。`systemHealth` 默认 CHECK-only（参考 §14.2）；新增 health probes：

```text
duplicate AR/AP exposure
open cache mismatch
treasury balance mismatch
orphan allocation
bank match over-allocation
business-close violation
```

## 28.27 Rollback Strategy

每个 finance migration：

```text
1. additive column / CREATE TABLE IF NOT EXISTS
2. 启用 finance_recognition_policy 双读模式（canonical + legacy projection）
3. 切换前 reconciliation health check
4. 切换 canonical writer
5. 监控 reconciliation 失败 → 切回 legacy
6. 旧 legacy 路径 410 后置
```

`cash_journals` 旧 write 路径保留 30 天兼容性，30 天后逐步 410。

## 28.28 Final Acceptance

- focused tests（每 Wave ≥ 5）；
- `pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 受保护 disposable MySQL 8 环境：`pnpm test:mysql` + `pnpm test:mysql:concurrency` + `pnpm test:mysql:finance-concurrency` 全 PASS（15 finance races）；
- 32 / 32 UAT PASS（不得 defer）；
- 6 launcher × 4 width responsive PASS（320 / 390 / 430 / 680）；
- 既 frozen domains（Master & Engineering / Manufacturing / Planning / Procurement / Inventory）gates 保持 green；
- 既 5 角色（admin / sales / warehouse / reviewer / accounting）不被破坏；
- release tag 不动；package.json version 不变。

Final verdict（本 Design）：`READY FOR USER REVIEW`。

后续 Implementation 严禁：

```text
1. 新增 capability ID / UAT / RACE / Wave
2. 引入第二 AR/AP ledger / Treasury movement engine / Voucher engine
3. UPDATE 历史已确认 finance facts
4. DROP historical finance table
5. 移动 B3106 / B3107 路由至 Finance Operations
6. 绕过 recognizeFinanceExposure 或 applyTreasuryMovement
```

## 28.29 Cross-References

| Topic | Section |
|---|---|
| Architecture / Ownership | §28.1 |
| Recognition Models | §28.2 |
| Open-Item / Provisional | §28.3 / §28.5 |
| Due Schedule | §28.4 |
| Settlement / Allocation | §28.6 |
| Unapplied / Refund | §28.7 |
| Write-Off / Bad Debt | §28.8 |
| Counterparty Transfer | §28.9 |
| Invoice | §28.10 |
| Treasury | §28.11 |
| Bank Statement / Recon | §28.12 |
| Business Close | §28.13 |
| Integration Adapters | §28.14 |
| Permission | §28.15 |
| API / Route | §28.16 |
| Mobile IA | §28.17 |
| Migration | §28.18 |
| Transaction / Lock | §28.19 |
| MySQL Races (15) | §28.20 |
| UAT Trace (32) | §28.21 |
| Capability Trace (58) | §28.22 |
| Implementation Waves (5) | §28.23 |
| Older Section Normalization | §28.24 |
| Tests | §28.25 |
| Audit / Error | §28.26 |
| Rollback | §28.27 |
| Final Acceptance | §28.28 |

---

## 29. Sales & Customer Domain Technical Design

> 本节原冻结 Sales & Customer Domain Closure 的 Technical Design 阶段成果；2026-10-13 远端外部评审进一步发现订单变更、预留、直出、sellable scope、物理计数与 Sales-group isolation 缺口，故 Requirement 与 Design 被再次有限重开。本次修正 §29 / §30 的有界物理模型、执行合同、验收追溯与计数；DR-SAL-01 Option A 已获用户批准并完成设计闭环。2026-10-14 外部独立评审对 Requirement / Technical Design / Implementation Wave Plan 均返回 PASS，用户已明确批准正式 Freeze；冻结内容基线为 `5469891b78acb5b03940944698e5c51a38cf5491`。

```text
AUDIT                         PASS / FROZEN
REQUIREMENT                   PASS / FROZEN
TECHNICAL DESIGN              PASS / FROZEN
IMPLEMENTATION WAVE PLAN      PASS / FROZEN
WAVE 0                        PASS / FROZEN
WAVES 1–13                    NOT IMPLEMENTED / NOT ACCEPTED
```
> Manual Evidence Baseline：B3102 销售管理 + B3103 信用管理（同时遵守已 frozen 的 Master & Engineering / Planning / Procurement & Outsourcing / Manufacturing & Quality / Inventory & Warehouse / Finance Operations 等其它 domain 的边界）。
> 本节 Coverage 以 Sales & Customer Domain Requirement（`document.md §34`，commit `414f2bb603fb1e9966d61811787b81f79103ecba`）为准：
>
> ```text
>   Sales Capabilities           = 114   (SC01..SC114)
>   DOMAIN_OWNED                = 100
>   INTEGRATION_BACKED          =   3   (SC51, SC58, SC71)
>   EXISTING_REUSE              =  11   (SC24, SC25, SC33, SC34, SC35, SC36,
>                                       SC49, SC52, SC53, SC54, SC79)
>   OUT_OF_SCOPE                =   0
>
>   Business Invariants         = 20    (S01..S20)
>   Functional UAT              = 44    (UAT-S-01..UAT-S-44)
>   MySQL Races                 = 24    (R-SAL-01..R-SAL-24)
>   Cross-Domain Boundary Fam   = 15
>
>   Audit CAP Trace             = 36/36 (CAP-1..CAP-36)
>   SC Acceptance Coverage      = 114/114
> ```
>
> 本节不进入 Implementation / Migration / Code / Schema / Test 任一阶段。Design 阶段成果再经外部 Review 后方进入 Implementation。
> 本节不重写已 frozen 的 Master & Engineering / Planning / Procurement & Outsourcing / Manufacturing & Quality / Inventory & Warehouse / Finance Operations 中的任何 capability 或 canonical fact。Sales & Customer 通过消费这些 frozen canonical truth 完成自身业务，不允许 second-truth / shadow ledger。

### 29.1 范围与 Architecture

#### 29.1.1 Sales & Customer 拥有

Sales & Customer 是以下能力的唯一 canonical business owner：

- **商业 Sales Truth**：Customer Commercial Extensions / Quotation / Sales Order / Sales Order Change / Delivery Notice / Sales Delivery / Sales Return / Replacement & Replenishment / Service Item Sales / Consignment 商业 lifecycle / Prepayment Gate 商业规则 / Sales Pricing / Order-Time Discount / Sales Reporting projections / Sales Reservation Intent。
- **Credit 商业语义全部 9 capability**：Credit Parameters / Rules / Profile / Occupancy / Check / Special Approval / Recalculation / Query / Evaluation。

#### 29.1.2 Sales & Customer 不拥有

- Customer 身份 foundation（Master & Engineering）
- Product / Material identity 与 UoM foundation（Master & Engineering）
- Warehouse identity / layout（Master & Engineering）
- Physical inventory truth / on-hand / locks / LOT-SERIAL / location / ownership dimension（Inventory & Warehouse）
- Reservation canonical truth / MRP / demand planning（Planning）
- OQC / Quality 引擎（Manufacturing & Quality）
- AR / AP open-item truth（Finance Operations）
- Advance Receipt / Unapplied Balance / Refund / Write-off / Collection / Invoice operational truth / Treasury（Finance Operations）
- Voucher / GL / Period close / Financial reports（Accounting & Analytics）
- RBAC / Workflow mechanics / Audit notification / Numbering / generic mechanics / document relation-conversion（Platform）；Sales parameter namespace、bounded codes、validation、storage 与 business semantics 不因使用 Platform mechanics 而转移 ownership

#### 29.1.3 Architecture 原则

```text
商业-物理-truth 分离  : Sales commercial truth ≠ Inventory/Finance/Reservation
                                      canonical truth
派生真理原则        : 优先 derived / projected truth；不建立 second mutable ledger
frozen-domain 适配器: 物理 mutation 永远走 frozen Domain canonical writer
Audit 强制          : 关键 mutation 与 audit 共享 transaction boundary
Effective snapshot  : Credit Check 使用一个 coherent effective policy snapshot
                                              (R-SAL-24 business-snapshot invariant)
Backend fail-closed : mandatory BLOCK 必 backend fail closed；前端 hidden !== 控制
Source-identity 保持 : Quotation → SO → Delivery Notice → Sales Delivery → Return
                                      → Finance AR adapter 链路全程保留
```

### 29.2 Physical Model Inventory（machine-checkable）

#### 29.2.0 Wave 1 Design Reopen contradiction evidence

| Evidence | Original frozen reference | Contradiction confirmed |
|---|---|---|
| A | 原 §29.4.2 | `users.salesperson_code` assigned to Wave 1 |
| B | 原 §29.4.2 | `users.sales_group_code` assigned to Wave 1 |
| C | 原 §29.4.2 | a separate `sales_group` physical table was required but absent from the physical inventory |
| D | 原 §30.2 / §30.8 / §30.17 | Wave 1 declared only 3 NEW tables |
| E | 原 Wave 1 implementation authorization | Wave 1 required 0 existing-table extension fields, while §30 assigned two `users` fields |
| F | 原 §29.4.1 | `customer_commercial_extensions.default_pricing_list_id` referenced `sales_price_lists` |
| G | 原 §30.2 / §30.8 | `sales_price_lists` is created only in Wave 2 |
| H | 原 §29.4.1 | `commercial_defaults_snapshot_id` had no canonical physical target anywhere in §29 inventory |

Correction decisions below supersede these contradictory physical allocations and the later remote-review defects recorded in `document.md §34` (SC01 / SC08 / SC30 semantics and acceptance). SC / Invariant / UAT / Race counts remain unchanged.

```text
Classification dimensions:
  TABLES:
    EXISTING_CONVERGE          → 已存在并将由本 Domain 继续使用，不修改语义
    NEW                        → 本 Design 新增的物理表（additive migration only）
    DEPRECATED_NO_NEW_WRITES   → 保留读取能力；禁止新写入；迁移期间兼容

  COLUMN EXTENSIONS (separate inventory, see B):
    additive migration; not table count

  DERIVED VIEWS (separate inventory, see C):
    query-layer projection only; no physical table

  COMPATIBILITY BEHAVIORS (separate inventory, see D):
    legacy read path; no new writes; not a table

  DEPRECATED FIELDS (separate inventory, see E):
    single physical classification; distinct from COMPATIBILITY
```

#### A. Physical Tables

A physical TABLE = a single SQL relation; columns are NOT counted as tables.

| # | Table | Classification | Migration Source / Origin | Owner Domain |
|---|---|---|---|---|
| A-01 | `customers` | EXISTING_CONVERGE | db.js:934 | Master & Engineering |
| A-02 | `sales_orders` | EXISTING_CONVERGE | db.js:972 (additive cols in §29.8.2) | Sales & Customer |
| A-03 | `sales_order_items` | EXISTING_CONVERGE | db.js:991 (additive cols in §29.8.2) | Sales & Customer |
| A-04 | `sales_deliveries` | EXISTING_CONVERGE | db.js:1175 | Sales & Customer |
| A-05 | `sales_delivery_items` | EXISTING_CONVERGE | db.js:1198 | Sales & Customer |
| A-06 | `return_orders` | EXISTING_CONVERGE | db.js:1208 (additive col: commercial_source_marker) | Sales & Customer / Procurement & Outsourcing (shared) |
| A-07 | `return_order_items` | EXISTING_CONVERGE | db.js:1232 | Sales & Customer / Procurement & Outsourcing (shared) |
| A-08 | `sales_discounts` | EXISTING_CONVERGE | discounts-schema.js:28 | Sales & Customer (route-table owned) — M14 post-delivery finance adjustment |
| A-09 | `sales_invoices` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:70 | Finance Operations |
| A-10 | `sales_invoice_items` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:78 | Finance Operations |
| A-11 | `commercial_credit_notes` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:111 | Finance Operations |
| A-12 | `document_sequences` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:63 | Platform (numbering) |
| A-13 | `document_number_allocations` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:67 | Platform (numbering) |
| A-14 | `tax_codes` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:57 | Finance Operations |
| A-15 | `uoms` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:46 | Master & Engineering |
| A-16 | `product_uom_conversions` | EXISTING_CONVERGE | v13-phase6e-commercial-golive.js:50 | Master & Engineering |
| A-17 | `planning_reservations` | EXISTING_CONVERGE (frozen) | planning-domain-schema.js | Planning |
| A-18 | `inventory` | EXISTING_CONVERGE (frozen) | db.js + inventory-position-schema.js | Inventory & Warehouse |
| A-19 | `account_receivables` | EXISTING_CONVERGE (frozen) | v22 migrations | Finance Operations |
| A-20 | `account_role_mappings` | EXISTING_CONVERGE (frozen) | v13-phase6d-financial-inventory.js | Finance Operations |
| A-21 | `idempotency_records` | EXISTING_CONVERGE | v13-phase6a-financial-controls.js:144 | **Platform / shared** infrastructure; Sales uses it for Sales command identities (semantic namespaces: quotation conversion / DN confirm / service fulfillment / etc.) — Sales owns the namespace meaning, not the storage infrastructure |
| A-22 | `audit_logs` | EXISTING_CONVERGE (frozen) | db.js | Platform |
| A-23 | `lifecycle_archives` | EXISTING_CONVERGE | lifecycle-schema.js | Platform |
| A-24 | `approval_requests` | EXISTING_CONVERGE (frozen for SALES_ORDER family) | db.js:1030 | Platform |
| A-25 | `sales_quotations` | NEW | §29.5 | Sales & Customer |
| A-26 | `sales_quotation_lines` | NEW | §29.5 | Sales & Customer |
| A-27 | `sales_quotation_conversions` | NEW | §29.5.3 | Sales & Customer — explicit conversion evidence |
| A-28 | `sales_price_lists` | NEW | §29.6 | Sales & Customer |
| A-29 | `sales_price_list_entries` | NEW | §29.6 | Sales & Customer |
| A-30 | `sales_price_list_versions` | NEW | §29.6 | Sales & Customer |
| A-31 | `sales_discount_schemes` | NEW | §29.7 | Sales & Customer |
| A-32 | `sales_discount_scheme_rules` | NEW | §29.7 | Sales & Customer |
| A-33 | `sales_order_changes` | NEW | §29.9 | Sales & Customer |
| A-34 | `sales_order_change_lines` | NEW | §29.9 | Sales & Customer |
| A-35 | `delivery_notices` | NEW | §29.11 | Sales & Customer |
| A-36 | `delivery_notice_lines` | NEW | §29.11 | Sales & Customer |
| A-37 | `sales_order_replacements` | NEW (header) | §29.14 | Sales & Customer |
| A-38 | `sales_order_replacement_lines` | NEW (line) | §29.14 | Sales & Customer |
| A-39 | `customer_commercial_extensions` | NEW | §29.4 | Sales & Customer (extends Master customer identity) |
| A-40 | `customer_material_xref` | NEW | §29.4 | Sales & Customer |
| A-41 | `sales_prepayment_requirements` | NEW | §29.16 | Sales & Customer |
| A-42 | `sales_prepayment_gate_results` | NEW | §29.16 | Sales & Customer |
| A-43 | `sales_reservation_intent` | NEW | §29.17 | Sales & Customer (intent state only; canonical reserved qty in `planning_reservations`) |
| A-44 | `service_fulfillments` | NEW | §29.18 | Sales & Customer |
| A-45 | `consignment_commercial_documents` | NEW | §29.19 | Sales & Customer (commercial layer; physical layer is Inventory) |
| A-46 | `consignment_commercial_lines` | NEW | §29.19 | Sales & Customer (commercial layer) |
| A-47 | `consignment_commodity_locations` | NEW (commercial) | §29.19 | Sales & Customer (commercial consignment location identity, ≠ physical warehouse) |
| A-48 | `credit_parameters` | NEW | §29.21 | Sales & Customer |
| A-49 | `credit_check_rules` | NEW | §29.21 | Sales & Customer |
| A-50 | `credit_policy_snapshots` | NEW (R-SAL-24 lockable anchor row) | §29.21 | Sales & Customer |
| A-51 | `credit_profile` | NEW | §29.22 | Sales & Customer (extends customer identity) |
| A-52 | `credit_profile_ratings` | NEW | §29.22 | Sales & Customer |
| A-53 | `credit_special_approval` | NEW | §29.26 | Sales & Customer |
| A-54 | `credit_check_results` | NEW | §29.25 | Sales & Customer (decision artifact, not exposure ledger) |
| A-55 | `credit_evaluation_indicator` | NEW | §29.27 | Sales & Customer |
| A-56 | `credit_evaluation_scheme` | NEW | §29.27 | Sales & Customer |
| A-57 | `credit_evaluation_model` | NEW | §29.27 | Sales & Customer |
| A-58 | `credit_evaluation_scoring_sheet` | NEW | §29.27 | Sales & Customer |
| A-59 | `credit_evaluation_result` | NEW | §29.27 | Sales & Customer |
| A-60 | `credit_recalculation_history` | NEW | §29.28 | Sales & Customer |
| A-61 | `product_commercial_classification` | NEW (Sales-owned extension table) | §29.18 — Service Item boundary | Sales & Customer (extends Master product identity at commercial level) |
| A-62 | `credit_lock_anchors` (REFINED; replaces original A-62 design) | NEW (stable long-lived lock identity; one generic table; anchor_type ∈ {CREDIT_OBJECT, POLICY_SCOPE}) | §29.20 / §29.21 / §29.25.2-3 — stable Credit-control anchor (CREDIT_OBJECT + POLICY_SCOPE) | Sales & Customer |
| A-63 | `sales_groups` | NEW | §29.4.2 — canonical Sales group identity | Sales & Customer |
| A-64 | `salesperson_profiles` | NEW | §29.4.2 — canonical Sales salesperson identity; optional login link | Sales & Customer |
| A-65 | `sales_parameters` | NEW | §29.4.5 — bounded SYSTEM / DOCUMENT_TYPE Sales configuration | Sales & Customer |
| A-66 | `salesperson_group_memberships` | NEW | §29.4.2 — multi-group membership + one default group | Sales & Customer |
| A-67 | `account_payables` | EXISTING_CONVERGE (frozen) | v22 migrations | Finance Operations |
| A-68 | `sales_replacement_fulfillments` | NEW | §29.14.1 — confirmed replacement-delivery line evidence | Sales & Customer |
| A-69 | `sales_sellable_scope_rules` | NEW | §29.4.3 — customer/material, salesperson/material, salesperson/customer allow/deny | Sales & Customer |

Counts:

```text
Physical tables total                                  = 69
  EXISTING_CONVERGE  (incl. frozen)                   = 25  (A-01..A-24 + A-67)
  NEW (physical tables in §29 Domain closure)         = 44  (A-25..A-66 + A-68..A-69)
  DEPRECATED_NO_NEW_WRITES (tables)                   =  0
```

#### B. Existing-Table Extensions (column additions; do NOT count as tables)

| Existing Table | New logical field(s) | Business purpose | Owner | Compatibility rule |
|---|---|---|---|---|
| A-02 `sales_orders` | `salesperson_id`, `sales_group_id`, `settlement_party_id`, `payer_id`, `customer_material_xref_id`, `commercial_tax_code`, `tax_inclusive`, `required_prepayment_cents`, `reservation_intent_state`, `commercial_close_state`, `gift_summary_cents`, `commercial_pricing_uom_code`, `effective_version` | SO commercial extension, lifecycle / closure and monotonic controlled-change concurrency anchor (§29.8 / §29.9 / §29.10) | Sales & Customer | nullable commercial fields on legacy rows display `(legacy)` without fabrication; `effective_version` is `INTEGER NOT NULL DEFAULT 1`, and migration backfills legacy rows to compatibility baseline `1` without inventing prior versions |
| A-03 `sales_order_items` | `is_gift_line`, `commercial_tax_basis`, `tax_inclusive_assumption`, `pricing_uom_code_applied`, `qty_break_applied_min`, `qty_break_applied_max`, `planned_delivery_date`, `upper_delivery_tolerance_bps`, `lower_delivery_tolerance_bps`, `price_snapshot_json`, `discount_snapshot_json` | Line-level commercial snapshot; authoritative price/version/UoM and discount-stage evidence; gift line marker; bounded one-schedule-per-line delivery plan/tolerance snapshot | Sales & Customer | both JSON columns remain nullable for legacy rows and display `(legacy)`; every Batch A canonical new line requires valid non-empty server-generated evidence; legacy tolerance does not get reinterpreted from later defaults |
| A-04 `sales_deliveries` | `delivery_notice_id`, `source_mode`, `billing_mode` (existing) | truthful DIRECT_ORDER / DELIVERY_NOTICE source discriminator; preserved billing mode | Sales & Customer | legacy rows: `source_mode=LEGACY_UNCLASSIFIED`; no fabricated DN |
| A-05 `sales_delivery_items` | `delivery_notice_line_id` | DN line capacity anchor (§29.11 / §29.17) | Sales & Customer | legacy rows: NULL `delivery_notice_line_id` allowed (legacy path) |
| A-06 `return_orders` | `commercial_source_marker` (CHECK: DELIVERY_BACKED / ORDER_BACKED / NO_SOURCE) | Three-mode explicit | Sales & Customer | legacy rows: NULL → treat as DELIVERY_BACKED |
| A-39 `customer_commercial_extensions` | `default_pricing_list_id`, `default_discount_scheme_id` | Wave 2 adds FKs only after A-28 `sales_price_lists` and A-31 `sales_discount_schemes` exist; B3102 customer default semantics retained without dangling Wave 1 pseudo-FKs | Sales & Customer | Wave 1 rows remain valid with fields absent; Wave 2 adds nullable FKs without fabricating defaults |
| A-19 `account_receivables` | (none this closure) | AR canonical owner = Finance; Sales reads only | Finance Operations | n/a |

Counts:

```text
Existing-table extensions                                  = 6  (five pre-existing tables + A-39 extended in Wave 2)
New logical fields across extensions                       = 31
(no new physical tables created from this sub-class)
```

#### C. Derived Views / Projections

| # | Derived object | Canonical source facts | Persisted? | Rebuild semantics |
|---|---|---|---|---|
| C-01 | `credit_exposure_view` | approved SO commitment + delivered-not-settled + Finance AR open + overdue state + eligible advance / unapplied + returns / credits + collections + write-offs (per §29.23) | NO (DERIVED projection; §29.24 default) | PURE_DERIVED; not stored; computed on read |
| C-02 | `credit_query_snapshot` | credit_profile + effective credit_policy_snapshots + finance adapter response | NO | query at access time |
| C-03 | `customer_open_exposure_summary` | C-01 per customer_id | NO | per query |
| C-04 | `sales_outstanding_projection` | sales_orders × sales_deliveries (per Requirement §34.5 UAT-S-37 / UAT-S-38) | NO | existing decision-reports; extended |
| C-05 | `sales_order_fulfillment_projection` | sales_orders.commercial_close_state + derived (deliveries, returns) | CONTROLLED HYBRID (§29.10): commercial_close_state PERSISTED; partial fulfillment DERIVED | at read time |

Counts:

```text
Derived views / projections                                = 4 pure-no + 1 controlled-hybrid = 5 logical objects
  persisted? YES                                           = 0
  persisted? NO                                            = 5
```

C-06 removed: `idempotency_records` is already counted as physical table A-21; reading the same object via two categories is double-count. Sales semantic idempotency namespaces (quotation conversion, delivery notice confirm, service fulfillment confirm, etc.) are explained in §29.45 (Idempotency Design) — they USE A-21 as the shared storage; they do not create a new derived object.

#### D. Compatibility Behaviors (separate dimension; not a table)

| # | Legacy path | New write allowed? | New read allowed? | Notes |
|---|---|---|---|---|
| D-01 | Legacy Sales Delivery without source discriminator (`source_mode = LEGACY_UNCLASSIFIED`) | NO for new writes; legacy rows retained | YES (read) | new writes explicitly choose DIRECT_ORDER or DELIVERY_NOTICE; no historical reinterpretation |
| D-02 | Legacy Sales Order without commercial parties / tax-basis / prepayment / reservation_intent columns | NO for new normal flow | YES (display `(legacy)`) | legacy rows remain valid; no fabrication |
| D-03 | Legacy Sales Return without `commercial_source_marker` | NO (must set marker on new entry) | YES (treat NULL as DELIVERY_BACKED) | full backward compatible read |
| D-04 | Legacy Customer without commercial extensions | NO (new entries must record extension) | YES (display `(none)`) | backward compatible |
| D-05 | Legacy Credit Profile missing | policy-dependent; §29.27 + §29.12 fail-closed rule | YES (display `(none)`) | missing required profile must trigger config BLOCK, NOT silent PASS |
| D-06 | Legacy Product without A-61 commercial classification | NO for any new commercial write | YES (display `(unclassified legacy)`) | missing/inactive row never implies `sales_enabled=TRUE` or non-service |
Counts:

```text
Compatibility behaviors                                    = 6
  new write through legacy bypass                          = 0 (ALL legacy paths disabled for new writes)
  legacy correction (bounded)                              = pending case-by-case policy
  legacy read                                              = 6 (all legacy reads allowed)
```

#### E. Deprecated Fields / No-New-Write Surfaces (single physical classification)

| # | Deprecated field / object | Physical classification | Compatibility behavior | Notes |
|---|---|---|---|---|
| E-01 | `products.price_cents` | **DEPRECATED_NO_NEW_WRITES** | may be READ as legacy pricing fallback (5th in §29.6.2 resolver priority chain); must NOT be treated as canonical new Sales Pricing truth | single classification; distinct from COMPATIBILITY behavior dimension |

Counts:

```text
Deprecated-no-new-write fields/tables                     = 1
```

#### F. Service Item classification storage

Per §29.18 + Micro-Closure §8: prefer Sales-owned commercial product extension over adding column to frozen Master `products` table.

```text
Chosen: Option A  Sales-owned commercial product extension table
  object: product_commercial_classification (A-61)
  product_id: FK to products.id (Master-owned identity; Sales only reads)
  sales_enabled + Sales/Pricing UoM references + upper/lower tolerance defaults
  service_classification (bool)
  one current row per product; transactional audit history
  no write to products table; no Master-frozen-column alteration
```

If frozen Domain (Master & Engineering) implements an additive `products.is_service` column at a later date, Sales will switch to read that attribute via cross-domain contract; this Domain closure does NOT depend on it.

#### G. Consignment location-vs-ownership inventory clarification

This Domain closure requires the seller retain inventory ownership at consignment shipment. Settlement/title-transfer moves ownership out of the seller position; consignment return retains/restores seller ownership. The current Inventory V21 model carries customer-owned positions for genuinely customer-owned / entrusted stock, which is a DIFFERENT business meaning and must not be conflated with sales consignment.

Per §29.19 corrected design (rebuild in this §29 of the corrected micro-closure) consignment makes seller retention explicit; no fake CUSTOMER-owned position is created for consigned stock.

**Frozen-domain integration contract status: NO CHANGE required for design.** The seller-ownership retention on consignment is expressed entirely in the new consignment commercial documents + inventory transfer with seller ownership marker; existing Inventory V21 canonical `inventory` position already records warehouse_id + owner_type / owner_id, and Sales only requests transfers with `owner_type = ENTERPRISE` (seller) during consignment shipment. The owner attribute in V21 already distinguishes ENTERPRISE from CUSTOMER at the position-key level. No `BOUNDED INTEGRATION CONTRACT EXTENSION` is required for §29.19 given this interpretation; if a future Implementation evidence shows seller-ownership cannot currently be represented on consignment transfer through Inventory V21, then `BOUNDED INTEGRATION CONTRACT EXTENSION` is filed and the model is revised before Implementation. (No silent CUSTOMER-owned redefinition.)

#### 29.2.1 Recalculated counts (Micro-Closure)

```text
A  Physical tables total                     = 69
     EXISTING_CONVERGE                       = 25  (A-01..A-24 + A-67)
     NEW                                     = 44  (A-25..A-66 + A-68..A-69)
     DEPRECATED_NO_NEW_WRITES (tables)      =  0

B  Existing-table extensions                = 6  covered tables across the wave sequence
                                                 (6 extensions, 31 logical fields;
                                                  30 ADD + 1 existing reused field)

C  Derived views / projections               = 5  logical objects
     persisted? YES                         = 0
     persisted? NO                          = 5

D  Compatibility behaviors                  = 6  legacy read = YES; new write through legacy bypass = NO

E  Deprecated fields (no-new-write)         = 1  (products.price_cents; single classification)

Sum check:
  A tables:  25 + 44 + 0 = 69 ✓
  Sub-categories are disjoint (every table belongs to exactly one of A classifications)
  Columns are NEVER counted as tables (see B for column extensions)


### 29.3 Canonical Writer Inventory

下表列出关键 business fact 的 canonical writer / service owner 与 Sales direct-write 权限：

| Business fact | Canonical writer / owner | Sales may write directly? | Adapter | Transaction boundary | Audit owner |
|---|---|---|---|---|---|
| Sales Order (header + lines) | Sales `sales_order_canonical_writer` | YES (own commercial) | n/a | one transaction: SO + items + commercial snapshot | audit_logs |
| Quotation (header + lines) | Sales `quotation_canonical_writer` | YES | n/a | one transaction | audit_logs |
| Pricing snapshot | Sales `pricing_canonical_writer` (resolveSalesPrice + persist) | YES | n/a | one transaction with SO creation | audit_logs |
| Order-Time Discount snapshot | Sales `discount_canonical_writer` | YES | n/a | one transaction with SO creation | audit_logs |
| Delivery Notice | Sales `delivery_notice_canonical_writer` | YES | n/a | one transaction | audit_logs |
| Sales Delivery | Sales `sales_delivery_canonical_writer` (Phase 6E) | YES (commercial) | invokes Inventory V21 `applyInventoryMutation` + OQC + Finance recognition | one transaction: SO inventory + AR recognition + COGS | audit_logs |
| Sales Return (DELIVERY_BACKED) | Sales `sales_return_canonical_writer` | YES | invokes Inventory V21 restoreSourceValue + Finance credit adjustment | one transaction | audit_logs |
| Sales Return (ORDER_BACKED / NO_SOURCE) | Sales `sales_return_canonical_writer` (new mode) | YES (commercial only) | Finance credit 边界 by source availability | one transaction with explicit source marker | audit_logs |
| Replacement obligation | Sales `replacement_canonical_writer` | YES | no inventory/finance bypass; via replacement_delivery_link | one transaction | audit_logs |
| Reservation Intent | Sales `reservation_intent_writer` | YES (intent only) | Planning reservation canonical reader | one transaction intent-state write | audit_logs |
| Prepayment Gate evaluation | Sales `prepayment_gate_evaluator` (uses Finance canon) | YES (rule only) | reads Finance `settlement_unapplied_balances` / advance receipts | one transaction (gate decision) | audit_logs |
| Consignment commercial doc | Sales `consignment_commercial_writer` | YES (commercial layer only) | requests Inventory ENTERPRISE-owned position at customer/consignment location; writes Finance settlement ref | one transaction per layer | audit_logs |
| Service fulfillment confirmation | Sales `service_fulfillment_writer` | YES | invokes Finance recognition; no inventory OUT | one transaction | audit_logs |
| Credit Parameters / Rules | Sales `credit_policy_writer` (Platform parameter infra) | YES (semantic) | Platform parameter storage | one transaction | audit_logs |
| Credit Profile (rating applied) | Sales `credit_profile_writer` | YES | n/a | one transaction | audit_logs |
| Credit Check decision | Sales `credit_check_evaluator` | YES | reads Finance AR + Planning exposure | one transaction; fail-closed BLOCK | audit_logs + credit_policy_snapshot_ref |
| Credit Special Approval | Sales (semantic) + Platform (workflow infra) | YES (semantic) | Platform workflow infra; bounded authority | one transaction; **preserves check + snapshot identity** | audit_logs |
| Credit Recalculation | Sales (rebuild logic) | YES (pure CHECK-only by default; cache optional per §29.24) | Finance AR canonical | rebuild tx; cannot mutate historical canonical | audit_logs |
| Credit Evaluation Indicators/Scheme/Model/Sheet/Result | Sales `credit_evaluation_writer` | YES | NO external bureau / AI / ML | one transaction per artifact | audit_logs |
| Customer identity | Master & Engineering | NO | n/a (read-only via canonical adapter) | n/a | n/a |
| Material identity + UOM | Master & Engineering | NO | n/a | n/a | n/a |
| Warehouse identity | Master & Engineering | NO | n/a | n/a | n/a |
| Physical inventory truth | Inventory & Warehouse (V21) | NO | `applyInventoryMutation` adapter | one tx on Inventory side | n/a |
| LOT / SERIAL | Inventory & Warehouse | NO | postTrackedMovement adapter | n/a | n/a |
| Inventory Locks | Inventory & Warehouse | NO | n/a | n/a | n/a |
| Reservation canonical quantity | Planning (V19) | NO | `assertStrongReservationAvailability` reader | n/a | n/a |
| OQC | Manufacturing & Quality (V18) | NO | quality gate adapter | one tx | n/a |
| AR open amount | Finance Operations (V22) | NO | `recognizeFinanceExposure` / `applyCreditAdjustment` | one tx | n/a |
| Advance Receipt / Unapplied | Finance Operations | NO | read | n/a | n/a |
| Collection / Refund / Write-off | Finance Operations | NO | write via canonical adapter | one tx | n/a |
| Invoice operational finance truth | Finance Operations | NO | postSalesInvoice / postSupplierBill | one tx | n/a |
| Treasury | Finance Operations | NO | applyTreasuryMovement | one tx | n/a |
| Voucher / GL | Accounting & Analytics | NO | n/a | n/a | n/a |
| RBAC / Audit notification / Numbering | Platform | NO | Platform parameters / generic services | per Platform | Platform |

> Audit 必须 与 mutation 共享 transaction boundary；不允许 mutation 提交后 audit 才写。

### 29.4 Sales Commercial Foundation

#### 29.4.1 Customer Commercial Extensions

Customer identity foundation = Master & Engineering。Sales 通过 `customer_commercial_extensions`（A-39）扩展 customer identity；该表只保存 commercial facets，不复制 customer code / name 等 Master truth。

```text
customer_id                    (FK customers.id, NOT NULL)
effective_from                 (DATE, NOT NULL)
settlement_party_customer_id   (FK customers.id, NULL)
payer_customer_id              (FK customers.id, NULL)
default_salesperson_id         (FK salesperson_profiles.id, NULL)
default_sales_group_id         (FK sales_groups.id, NULL)
default_payment_terms_days     (INTEGER, NULL, CHECK >= 0)
default_settlement_method      (TEXT, NULL)
sellable_scope_mode            (TEXT, NOT NULL, CHECK IN 'ALL_SALES_ENABLED','RULE_CONTROLLED')
effective_to                   (DATE, NULL; CHECK effective_to >= effective_from)
created_at / updated_at        (NOT NULL audit timestamps)
created_by / updated_by        (FK users.id, NULL; audit actor only, not salesperson identity)
PRIMARY KEY (customer_id, effective_from)
```

Notes:
- Ship-to / Settlement Party / Payer 不必自有 Customer row；可以引用同一 Customer（self）。
- 主键：`PRIMARY KEY (customer_id, effective_from)` 仅定位一条版本，**不**被误认为能够阻止区间重叠。
- Hard invariant：对同一 `customer_id` 与任一 `business_date`，至多一条 extension row 满足 `effective_from <= business_date AND (effective_to IS NULL OR business_date <= effective_to)`；同一 customer 的两个有效区间不得重叠。
- Cross-dialect mutation：SQLite 使用 `BEGIN IMMEDIATE`；MySQL 在同一 transaction 中先 `SELECT customers.id ... FOR UPDATE`，以 Master customer identity row 作为稳定的 customer-scoped serialization anchor，再重读全部相关 effective rows。发现 overlap 时明确拒绝；仅显式的 controlled supersession 可先把上一行 `effective_to` 设为新行前一业务日，然后写新行与 audit，最后 commit。读取 Master row 的锁不会转移 customer identity ownership，且不得修改 Master row。
- `effective_to IS NULL` 表示 open-ended effective record；effective row 本身即版本身份，不增加另一套 mutable `version` truth。
- Frozen `customers.payment_terms_days` 保留（legacy compatibility）；不在 Wave 1 修改 `customers`。Extension 中的 nullable default 不反写 Master row，也不为历史 customer fabrication。
- `credit_limit` 不在本表重复定义；属于 `credit_profile`（§29.22）。SC1 在 §34.1 中明示 `credit_limit` 不归 Customer commercial master（避免 double-counting）。
- `default_pricing_list_id` / `default_discount_scheme_id` 保留 B3102 customer-default 语义，但归 Wave 2：A-28 `sales_price_lists` / A-31 `sales_discount_schemes` 创建后才向 A-39 增加 nullable FK。Wave 1 不创建字段、不创建 TEXT pseudo-FK、不提前创建 target table。
- `commercial_defaults_snapshot_id` 从 target physical design 删除：Requirement 未要求 customer-default snapshot identity，且无 canonical target。变更历史由 A-22 `audit_logs`；交易时不可变事实由后续 Sales document snapshot 保存。

Wave 1 field disposition（no TBD）：

| Field | Disposition | Reason |
|---|---|---|
| `customer_id`, `effective_from`, `effective_to` | `WAVE_1_PHYSICAL` | Master FK + effective-dated identity |
| `settlement_party_customer_id`, `payer_customer_id` | `WAVE_1_PHYSICAL` | SC03 / SC04; canonical customer references |
| `default_salesperson_id`, `default_sales_group_id` | `WAVE_1_PHYSICAL` | SC05 / SC06; canonical Sales-owned references |
| `default_payment_terms_days`, `default_settlement_method`, `sellable_scope_mode` | `WAVE_1_PHYSICAL` | nullable commercial defaults + coherent customer-level sellable policy; no Master rewrite |
| `created_at`, `updated_at`, `created_by`, `updated_by` | `WAVE_1_PHYSICAL` | audit metadata; actor identity is not salesperson identity |
| `default_pricing_list_id` | `DEFER_TO_WAVE_2` | A-28 target does not exist before Wave 2; SC08 final completion remains Wave 5 after tolerance execution |
| `default_discount_scheme_id` | `DEFER_TO_WAVE_2` | A-31 target does not exist before Wave 2; nullable customer discount-table default, no fabrication |
| any prepayment / reservation / credit default | `DEFER_TO_LATER_WAVE` | owned by Waves 7 / 9+; not introduced in Wave 1 |
| `commercial_defaults_snapshot_id` | `REMOVED_AS_INVALID_DESIGN` | no Requirement mandate and no canonical physical target |

#### 29.4.2 Salesperson / Sales Group

Salesperson 是 Sales business identity，不是 Platform login identity。Wave 1 不修改 `users`。

```text
sales_groups (A-63):
  id                    (PK)
  group_code            (TEXT, NOT NULL, UNIQUE)
  name                  (TEXT, NOT NULL)
  description           (TEXT, NULL)
  active                (BOOLEAN, NOT NULL, DEFAULT TRUE)
  created_at / updated_at (NOT NULL)

salesperson_profiles (A-64):
  id                    (PK; canonical Sales salesperson identity)
  salesperson_code      (TEXT, NOT NULL, UNIQUE)
  name                  (TEXT, NOT NULL)
  user_id               (FK users.id, NULL, UNIQUE)
  active                (BOOLEAN, NOT NULL, DEFAULT TRUE)
  created_at / updated_at (NOT NULL)

salesperson_group_memberships (A-66):
  id                    (PK)
  salesperson_id        (FK salesperson_profiles.id, NOT NULL)
  sales_group_id        (FK sales_groups.id, NOT NULL)
  is_default            (BOOLEAN, NOT NULL, DEFAULT FALSE)
  active                (BOOLEAN, NOT NULL, DEFAULT TRUE)
  effective_from        (DATE, NOT NULL)
  effective_to          (DATE, NULL; CHECK effective_to >= effective_from)
  created_at / updated_at / created_by / updated_by
  UNIQUE (salesperson_id, sales_group_id, effective_from)
```

- `user_id IS NULL` 合法：salesperson 可以没有 ERP login；login user 不自动成为 salesperson。
- `users.id` 只作为可选 login link / audit actor；`salesperson_profiles.id` 是唯一 Sales salesperson identity。
- `sales_groups.id` 是唯一 group identity；Customer default、Quotation、SO 与后续 Credit salesperson dimension 均引用 ID，不存 canonical group free text。
- 默认组是日期有效业务不变量：零个 active membership 时允许零 default，但该 salesperson 不得参与新的 group-scoped document；恰有一个 active membership 时必须 `EXACTLY_ONE` 且就是该 membership；多个 active memberships 时也必须 `EXACTLY_ONE`。`AT_MOST_ONE` 仅是写入过程始终成立的唯一性下界，不能替代非空 active set 的 exactly-one 合同。默认 membership 到期/停用、group inactive 或 salesperson inactive 时解析 fail closed，必须受控重选，不能静默挑选另一组。历史 Quotation/SO snapshot 不回写。
- membership/default mutation 以 `salesperson_profiles.id` 为稳定锁锚：SQLite `BEGIN IMMEDIATE`；MySQL `SELECT salesperson_profiles.id ... FOR UPDATE`，锁内重读 memberships/groups 后执行相同日期区间与 exactly-one 校验，再与 audit 同 transaction 写入。单列 UNIQUE 不能表达跨日期合同。
- Quotation（Wave 3）与 Sales Order（Wave 4）写入时 snapshot `sales_group_id`；从 Wave 3 起统一 backend predicate 按 login → `salesperson_profiles.user_id` → effective active memberships/groups 授权读取、写入、审批、导出。`sales_group_data_scope_enabled=TRUE` 启用 membership scope；`FALSE` 对普通用户 fail closed，只允许显式 `sales:cross-group` 权限绕过并 audit，绝不解释为全员可见。无 login link、无 membership、membership expired、group inactive 均 fail closed。Report（Wave 12）复用既有 predicate并完成综合验证，不负责首次补授权。SC06 final-completion 仍为 Wave 12。
- 历史 row 缺 salesperson / group 时显示 `(unassigned)`，不 fabrication 商业事实。
- Wave 1 对 `users` / `customers` / `products` / `sales_orders` / `sales_order_items` 的 schema extension 均为 0；A-65 / A-66 均为 Sales-owned 新表。

#### 29.4.3 Customer-Material Cross Reference

`customer_material_xref`（A-40）：

```text
id                         (PK)
customer_id                (FK customers.id, NOT NULL)
product_id                 (FK products.id, NOT NULL)
customer_material_code     (TEXT, NULL)
customer_material_name     (TEXT, NULL; customer-facing identity only)
commercial_uom_code        (TEXT, NULL; FK/contract to existing canonical UOM)
effective_from             (DATE, NOT NULL)
effective_to               (DATE, NULL; CHECK effective_to >= effective_from)
active                     (BOOLEAN, NOT NULL, DEFAULT TRUE)
created_at / updated_at    (NOT NULL)
UNIQUE (customer_id, product_id, effective_from)
```

- `customer_material_code` / `customer_material_name` = customer-specific mapping；canonical product identity 始终是 `products.id`，不复制 product code / name / base UOM truth。
- xref row 只表达 customer code/name ↔ internal `product_id` 翻译，不承载 Sellable Scope。相同 `(customer_id, customer_material_code, business_date)` 可有多个 internal-product 候选；resolver 不自动猜测，必须接收显式 `product_id` 并验证 effective xref，未选择、无匹配或选择后仍歧义均 BLOCK。唯一性只保持 `(customer_id, product_id, effective_from)` row identity。
- `sales_sellable_scope_rules`（A-69）独立存储可销范围：`id`、`scope_dimension` (`CUSTOMER_PRODUCT|SALESPERSON_PRODUCT|SALESPERSON_CUSTOMER`)、按 dimension 必填的 `customer_id/salesperson_id/product_id`、`effect` (`ALLOW|DENY`)、`effective_from/effective_to`、active 与 audit metadata。业务日期上显式 DENY 优先；启用 sellable control 时，各启用维度必须命中 ALLOW 且不得命中 DENY。A-61 `sales_enabled=TRUE` 是所有模式的先决条件，参数关闭不能绕过。
- xref mutation 与 A-39 共用 customer anchor；sellable rule mutation 按 customer 或 salesperson canonical anchor。SQLite `BEGIN IMMEDIATE`；MySQL 对对应 anchor `FOR UPDATE`，锁内重读 effective intervals、防止相同 rule key/effect 冲突，再与 audit 同 transaction 写入。
- `effective_to IS NULL` 表示 open-ended current candidate；实际 effective row 必须以传入的 authoritative `business_date` 解析。

#### 29.4.4 Order-time Frozen Commercial Defaults

SO create-time 形如：

```text
SO_id  →  stored: (ship_to_contact / ship_to_phone / ship_to_address /
                   salesperson_id / sales_group_id /
                   settlement_party_id / payer_id / customer_material_xref_id /
                   commercial_tax_code / tax_inclusive_flag /
                   commercial_pricing_uom_code)
```

Snapshot columns 是 additive；不改写 existing historical orders（FROZEN）。

#### 29.4.5 Sales Parameters (SC01)

实际仓库复核结论：现有 `inventory_parameters`、`planning_parameters`、`procurement_parameters`、`finance_parameters` 与 accounting config 都是各领域自有的显式 schema/module；仓库没有可安全承载 Sales-owned SYSTEM / DOCUMENT_TYPE 参数语义的 canonical generic Platform parameter storage。A-21 `idempotency_records` 等 Platform shared mechanics 也不是参数存储。因此采用 Sales-owned bounded table A-65，而不创建 uncontrolled generic key/value store，也不复用 Wave 9 `credit_parameters`。

```text
sales_parameters (A-65):
  scope_key                         (PK; 'SYSTEM' or 'DOCUMENT_TYPE:<bounded-code>')
  scope_type                        (CHECK IN 'SYSTEM','DOCUMENT_TYPE')
  document_type                     (NULL for SYSTEM; bounded code for DOCUMENT_TYPE)
  sellable_control_enabled          (BOOLEAN NOT NULL)
  customer_material_xref_enabled    (BOOLEAN NOT NULL)
  sales_group_data_scope_enabled    (BOOLEAN NOT NULL)
  delivery_schedule_enabled         (BOOLEAN NOT NULL)
  delivery_quantity_control_enabled (BOOLEAN NOT NULL)
  order_change_mode                 (CHECK IN 'DISABLED','CONTROLLED_DIRECT',
                                     'CONTROLLED_DOCUMENT','BOTH')
  reservation_behavior              (CHECK IN 'DISABLED','INVENTORY_LOCK',
                                     'MANUAL_RESERVATION','ON_HAND_RESERVATION',
                                     'EXPECTED_SUPPLY_RESERVATION')
  active / created_at / updated_at / created_by / updated_by
```

- `scope_type='SYSTEM'` 时 `document_type IS NULL`；`DOCUMENT_TYPE` 时必须为 Sales registry 中的 bounded document type。所有 code 均由 Sales validator 白名单校验，不接受任意 key/value。
- resolution deterministic：先读取 exact active `DOCUMENT_TYPE:<code>` row；存在时该完整控制行覆盖 SYSTEM，否则使用唯一 active SYSTEM row；缺少 SYSTEM row 或 code 非法时 backend fail closed。Platform 只提供 transaction/audit/RBAC 等通用 mechanics，不拥有 parameter namespace/code/validation/business meaning。
- `order_change_mode` 语义固定：`DISABLED` 两条 APPROVED-order change path 均拒绝；`CONTROLLED_DIRECT` 只允许受控直接入口；`CONTROLLED_DOCUMENT` 只允许正式变更单入口；`BOTH` 同时开放两个入口但每个入口仍执行其自身权限与同一 approval/application contract。变更申请保存 resolved parameter scope、row identity/hash 与 mode snapshot；参数后续变化不得改写 APPLIED history。尚未应用的 request 在 approval/application transaction 中重读当前 effective parameter；若该 path 已被禁用则 fail closed，必须取消或重新申请。
- feature enable 与业务事实分离：`customer_material_xref_enabled` 只决定 A-40 翻译是否可用；`sellable_control_enabled` 决定是否执行 A-69 可销范围。A-39 `sellable_scope_mode` 是 customer-level applicability selector，不再把 xref 当作 sellable rule。所有模式都先要求 active A-61 且 `sales_enabled=TRUE`；所有检查在 backend 执行，frontend hidden 不是 authorization。
- 后续能力依赖：Wave 4 执行 `order_change_mode`；Wave 5 执行 delivery schedule/quantity controls；Wave 7 执行 `reservation_behavior`。A-65 从 Wave 1 一次建立完整 bounded columns，但 SC01 的 primary/final-completion wave 是 Wave 7。

### 29.5 Quotation Technical Design

#### 29.5.1 Lifecycle

```text
DRAFT
EFFECTIVE        (i.e. ACTIVE; frozen as 'EFFECTIVE' = APPROVED if Quotation needs approval per policy)
EXPIRED          (validity < business_date; auto-transition by trigger / runtime check)
CLOSED           (cancelled by user; partial-conversion preserved)
FULLY_CONVERTED  (when converted qty = qty aggregate; remains in history)
```

> 本 Design 不强制 Quotation approval。Approval 是 policy 选项；若启用则 state `EFFECTIVE` 是 approval 的产物。

#### 29.5.2 物理对象

`sales_quotations` (NEW #22) + `sales_quotation_lines` (NEW #23)：

```text
sales_quotations:
  id, quotation_no (UNIQUE), customer_id (FK),
  salesperson_id (FK salesperson_profiles.id, nullable),
  sales_group_id (FK sales_groups.id, nullable),
  status (CHECK IN 'DRAFT', 'EFFECTIVE', 'EXPIRED', 'CLOSED', 'FULLY_CONVERTED'),
  currency_code (single base currency only; NOT multi-currency),
  valid_from, valid_to,
  payment_terms, payment_terms_days,
  commercial_tax_code (or NULL), tax_inclusive (bool or NULL),
  total_cents (computed),
  converted_total_cents (computed),
  created_at / updated_at, creator_id, reviewer_id,
  remarks

sales_quotation_lines:
  id, quotation_id (FK), line_no,
  material_id (FK), commercial_uom_code,
  quantity (REAL), unit_price_cents, amount_cents,
  converted_qty (REAL; SUM of all SO lines sourced from this quotation line),
  remaining_qty (generated column from quantity - converted_qty),
  discount_snapshot (see §29.7),
  tax_basis_assumption (commercial; not statutory),
  remarks
```

#### 29.5.3 Conversion → Sales Order (canonical choice)

This Domain keeps `sales_quotation_conversions` as an EXPLICIT physical conversion-evidence table (chosen canonical option; no duplicate conversion truth via Platform relation infra).

`sales_quotation_conversions` (NEW, physical table — see §29.2 A-27):

```text
sales_quotation_conversions:
  id                              (PK)
  quotation_id                   (FK sales_quotations.id)
  quotation_line_id              (FK sales_quotation_lines.id)
  sales_order_id                 (FK sales_orders.id)
  sales_order_item_id            (FK sales_order_items.id)
  converted_qty                  (REAL; signed positive for normal conversion;
                                   conversion CANNOT exceed remaining)
  converted_unit_price_cents      (snapshot at conversion time; required)
  converted_amount_cents         (snapshot; required for audit)
  converted_uom_code             (snapshot UoM; nullable if UoM is the same)
  business_date                  (date of conversion)
  converted_at                   (timestamp; audit)
  converted_by                   (FK users.id; audit)
  idempotency_key                (UNIQUE with sales_quotation_conversions.id)
  PR UNIQUE (quotation_line_id, sales_order_item_id)
```

Constraints:

- `converted_qty ≤ SO item quantity` per conversion row.
- Per quotation_line: `SUM(converted_qty) ≤ sales_quotation_lines.quantity`.
- Repeated conversion (Requirement SC14): allowed only when:
  - `quotations.status = 'EFFECTIVE'`
  - `quotation.valid_to >= business_date`
  - `SUM(converted_qty for this quotation_line) < quotation_line.quantity`
- Each conversion commits as ONE tx: insert + capacity re-read + check + audit.

#### 29.5.4 Capacity Trace & Audit

- `sales_quotation_lines.remaining_qty` is computed as `quantity - SUM(sales_quotation_conversions.converted_qty for this quotation_line_id)`. Generated column at SQL layer.
- Each conversion writes audit `entity_type = 'SALES_QUOTATION_CONVERSION'`, `detail = {quotation_id, quotation_line_id, sales_order_id, sales_order_item_id, converted_qty, business_date}`.
- Capacity anchor for R-SAL-06: `sales_quotation_lines.id` (FOR UPDATE on this row when converting); secondary FOR UPDATE on `sales_order_items.id` at SO item side to prevent post-submit frozen-line mutation.

### 29.6 Sales Pricing Technical Design

Wave 2 dependency order is fixed: create A-28 `sales_price_lists` and A-31 `sales_discount_schemes`, then add nullable `customer_commercial_extensions.default_pricing_list_id` / `default_discount_scheme_id` with FKs to those targets. Wave 1 contains neither column nor any unvalidated placeholder.

#### 29.6.1 物理对象

`sales_price_lists` (NEW #24) + `sales_price_list_entries` (NEW #25) + `sales_price_list_versions` (NEW #26)：

```text
sales_price_lists:
  id (TEXT PK), price_list_code (UNIQUE NOT NULL), name, currency_code (single base),
  priority (int; lower = higher priority), fallback_price_list_id (FK self),
  effective_from, effective_to,
  status (CHECK IN 'DRAFT', 'ACTIVE', 'RETIRED'),
  activated_at/by, retired_at/by, created_at/by, updated_at/by

sales_price_list_entries:
  id (TEXT PK), price_list_id (FK), material_id (FK products.id),
  customer_id (FK customers.id; NULL = all customers),
  customer_scope_type (NOT NULL; 'ALL' | 'CUSTOMER'),
  material_identity_key (NOT NULL; canonical ASCII, length <= 128),
  customer_scope_key (NOT NULL; canonical ASCII, length <= 128),
  pricing_uom_code (FK uoms.code),
  pricing_identity_key (NOT NULL; canonical ASCII, length <= 128),
  qty_break_min_micros (safe integer; inclusive),
  qty_break_max_micros (safe integer nullable; inclusive; NULL = unbounded),
  effective_from, effective_to,
  created_at, created_by,
  UNIQUE (price_list_id, material_identity_key,
          customer_scope_key, pricing_identity_key)

sales_price_list_versions:  -- snapshot history (append-only)
  id (TEXT PK), entry_id (FK sales_price_list_entries.id),
  version (safe integer >= 1), unit_price_cents (safe integer >= 0),
  snapshot_json,
  created_at, created_by
  UNIQUE (entry_id, version)
```

Identity / constraint contract:

- `sales_price_list_entries.id` is the sole row PK on both engines. `sales_price_list_versions.entry_id` therefore references an actually unique target. No nullable column participates in a PK.
- `sales_price_lists.id` is a service-generated lower-case RFC-4122 UUID (36 ASCII characters) and is immutable. The three non-null normalized identity keys use the following exact, case-stable encoding over UTF-8 bytes; upper-case hexadecimal means two ASCII hex characters per byte and no delimiter appears inside an encoded component:
  - `material_identity_key = 'M:' + HEX(material_id)`; `material_id` must encode to 1..63 UTF-8 bytes, so the key is 4..128 ASCII characters.
  - `customer_scope_key = 'A'` when `(customer_scope_type='ALL', customer_id IS NULL)`; otherwise `customer_scope_key = 'C:' + HEX(customer_id)` when `(customer_scope_type='CUSTOMER', customer_id IS NOT NULL)`. A customer id used by pricing must encode to 1..63 UTF-8 bytes. `A` cannot collide with any `C:` identity.
  - `pricing_identity_key = 'U:' + HEX(pricing_uom_code) + '|Q:' + PAD16(qty_break_min_micros) + '|D:' + YYYYMMDD(effective_from)`. Pricing UoM codes are limited to 1..32 UTF-8 bytes; quantity minimum is a non-negative safe integer rendered as exactly 16 decimal digits; date is a validated ISO date with hyphens removed. The maximum key length is 96 ASCII characters.
- Inputs exceeding these bounds fail with `PRICE_IDENTITY_COMPONENT_TOO_LONG`; the service never truncates, case-folds, hashes, or substitutes them. It re-derives all three keys and compares exact equality before INSERT. Identity-bearing fields and keys cannot be updated in place, even in DRAFT: a DRAFT identity change deletes/recreates the entry with a new `id`; price changes append only a version. This removes key-drift update paths.
- Database CHECKs enforce the list UUID/identity-key non-null and length bounds plus the ALL/CUSTOMER nullability/prefix shape. Wave-2 migration also installs exactly two dialect-local, metadata-checked guards: `trg_sales_price_entries_identity_bi` (`BEFORE INSERT`) and `trg_sales_price_entries_identity_bu` (`BEFORE UPDATE`). SQLite compares against its native `hex()` encoding; MySQL live registry replay compares against `HEX()`/`CONCAT()` encoding. They reject any byte-for-byte derivation mismatch and any in-place identity-field/key update. Trigger creation is idempotent through `sqlite_master` / `information_schema.TRIGGERS` inspection and requires no global Adapter change. The backend performs the same derivation before SQL.
- Trigger derivation is exact, not implementation-defined: SQLite uses `'M:' || hex(material_id)`, `CASE ... 'A' ... 'C:' || hex(customer_id)`, and `'U:' || hex(pricing_uom_code) || '|Q:' || printf('%016d', qty_break_min_micros) || '|D:' || replace(effective_from,'-','')`; MySQL uses the equivalent `CONCAT`, `HEX`, `LPAD(CAST(... AS CHAR),16,'0')`, and `REPLACE`. Component bounds use SQLite BLOB byte length and MySQL `OCTET_LENGTH`, so multibyte input has identical acceptance. The canonical uppercase hex output is compared byte-for-byte under both databases.
- The plain four-column UNIQUE is the database business-uniqueness authority on both engines, while the guard triggers prevent alternate-key bypass. No partial, expression, seven-column, or generated SHA/digest index is permitted.
- Current `mysqlType()` maps every indexed TEXT component to `VARCHAR(128)`. The four-column utf8mb4 worst-case key budget is `4 × 128 × 4 = 2048` bytes, below InnoDB's 3072-byte limit; therefore neither prefix indexing nor digest fallback is needed.
- `effective_to IS NULL` means open-ended and every date range is inclusive. `effective_to < effective_from`, negative breaks, or `max < min` is rejected.
- For the same list/material/customer scope/UoM, quantity-break rectangles must not overlap when their inclusive business-date ranges overlap. Adjacent breaks therefore require `previous.max < next.min`; equality is an overlap. The service enforces this after locking the owning list row and re-reading all peers in the same transaction.
- Entry identity/range fields are mutable only while the owning list is `DRAFT`. A version row is never updated or deleted. Editing a draft price appends `version=max+1`; activation freezes the list, all entries, and all versions. A commercial change after activation requires a new list identity; retirement only changes the list lifecycle fields and never rewrites history.
- FK targets, CHECKs, the ordered four-column UNIQUE, safe-integer bounds, normalized-key derivation, and immutability guards have identical SQLite/MySQL acceptance tests. Application validation supplements rather than replaces DB constraints.

#### 29.6.2 Canonical UoM and quantity normalization

- Wave 2 creates no conversion column or conversion table. `base_uom_code`, `conversion_factor`, floating quantity breaks, and any Sales-owned UoM truth are forbidden.
- The frozen inventory label at §29.2 E-01 uses “legacy pricing fallback” only for historical-document/reference display. This bounded correction removes the former fifth resolver fallback; no new pricing decision may read `products.price_cents`.
- Given `material_id`, `pricing_uom_code`, and `business_date`, resolve exactly one active Master-owned A-16 `product_uom_conversions` row satisfying `effective_from <= business_date <= effective_to` (NULL end = open) and whose `base_uom_code` equals the product base UoM. Base-UoM pricing uses evidence `(uom_code=base, numerator=1, denominator=1, version=0)` without inserting a conversion row.
- Direction is frozen as `base quantity = document/pricing quantity × numerator ÷ denominator`, matching the canonical Master service. The resolver never inverts this ratio implicitly.
- API quantities are decimal strings with at most six fractional digits, parsed to safe integer micro-units (`1 unit = 1,000,000 micros`). Convert the requested document quantity to base rational quantity, then into the candidate entry's pricing UoM by the candidate's effective conversion. Round exactly once to pricing-UoM micros using non-negative `HALF_UP`; compare the resulting integer against inclusive break bounds. Money is not rounded during this normalization.
- Missing, inactive, future-only, expired, wrong-product, wrong-base, ambiguous, non-positive, unsafe-integer, or zero-denominator conversion evidence fails closed with 409. No legacy factor or `products.price_cents` can repair that failure.
- Resolver evidence includes requested UoM/quantity micros plus both conversion identities and immutable `{id, numerator, denominator, version, effective_from, effective_to}` values. It is an output evidence envelope in Wave 2; Wave 4 persists it on the SO line. Later Master conversion changes must not reinterpret persisted evidence.

#### 29.6.3 Resolver Service

`resolveSalesPrice(context)` 商业 signature（伪）：

```text
INPUT:
  customer_id
  material_id
  pricing_uom_code
  quantity_decimal
  business_date
  explicit_price_list_ids[]  (optional; caller order is significant)
  manual_price_cents         (optional)
  override_reason            (required with manual price)

OUTPUT:
  resolved_price_cents   (bigint)
  source_rule_identity   (list id + entry id + version row id/version)
  effective_range        (date range applied)
  uom_evidence           (requested + candidate canonical rational snapshots)
  qty_break_applied      (integer micros min/max + normalized quantity)
  override_state         ('NONE' | 'OVERRIDDEN'; unauthorized requests are errors)
  snapshot_evidence      (immutable output envelope; no Wave-2 SO persistence)

PRECONDITIONS:
  - one base currency only
  - all candidate lists are ACTIVE and list/entry dates include business_date
  - list currency equals the configured base currency; no FX conversion
  - canonical UoM evidence satisfies §29.6.2

OVERRIDE:
  - manual price must be a non-negative safe integer and requires
    pricing:override plus a trimmed non-empty reason
  - resolver returns override evidence but performs zero DB mutation
  - no sales_pricing_override_log and no override_reason_id table/FK exist
```

Exact candidate order:

1. Normalize and de-duplicate `explicit_price_list_ids` preserving caller order; each explicit id must be visible and applicable or the request fails closed (it is never silently skipped).
2. Append the customer's effective `default_pricing_list_id` if non-null and not already present. A missing/inactive/out-of-date configured default fails closed.
3. If neither source produces a root list, return `PRICE_NOT_CONFIGURED`; do not scan arbitrary ACTIVE lists.
4. Resolve each root completely before the next root. Within one list, customer-specific entries precede list-wide entries. Within the same scope, choose the matching break with greatest `qty_break_min_micros`, then latest `effective_from`, then lexicographically smallest `entry.id`; choose that entry's greatest version, then smallest version-row id. If supposedly unique state leaves another tie, fail closed as corrupted metadata.
5. When a list has no matching entry, follow its `fallback_price_list_id` chain depth-first. A fallback target must be ACTIVE, effective, same currency, and not previously visited. Activation validates the full chain under deterministic list-id locks; self-reference, cycle, missing target, or repeated node is rejected. Runtime repeats the visited-set guard and fails closed on corrupted chains.
6. List `priority` is not an invitation to scan globally. It is used only to order multiple customer defaults if legacy data temporarily exposes more than one effective extension (`priority`, then list id); current Wave-1 authority should yield one. Explicit caller order always wins. No unspecified “next higher-priority list” exists.
7. `products.price_cents` is excluded from all new resolver/write paths. It remains display/read compatibility for historical documents only (§29.40); `PRICE_NOT_CONFIGURED` is returned instead of bypassing the engine.

Decision examples:

| Situation | Deterministic result |
|---|---|
| Explicit L2 then L1; L2 has list-wide match and L1 has customer match | L2 list-wide wins: root order precedes customer scope across roots |
| Root L1 has customer and list-wide matches | L1 customer match wins |
| L1 has no match and falls back to L3; L2 is next explicit root | L3 is evaluated before L2 |
| Two matching breaks start at 10.000000 and 20.000000 pricing units | greatest qualifying minimum (20.000000) wins; boundaries are inclusive |
| No explicit/default root, but product has legacy price | `PRICE_NOT_CONFIGURED`; legacy price is not returned |
| Fallback L1 → L2 → L1 | activation and runtime both reject the cycle |

#### 29.6.4 Lifecycle, locking, and evidence boundary

- Create/update/delete-entry/version operations require `pricing:manage` and a locked `DRAFT` list. Activation and retirement require `Idempotency-Key`; exact replay returns the stored result from existing Platform A-21 mechanics, while key/payload mismatch is 409.
- Activation locks the root and reachable fallback lists in ascending id order, re-reads all entries/versions and canonical effective UoM evidence, validates uniqueness/range/cycle/currency, then writes `ACTIVE` plus `audit_logs` in one transaction. An empty list or entry without a version cannot activate. Retirement locks and transitions only `ACTIVE → RETIRED`; repeated same-key replay is stable, while direct replay with a different key against an already retired list is 409.
- `POST /api/sales-pricing/resolve` is pure: read-only transaction, zero writes to the five Wave-2 tables, `audit_logs`, or idempotency state. Its result is preview/decision evidence, not an approved-order snapshot.
- Wave 2 does **not** add or mutate `sales_orders` / `sales_order_items`. The output evidence contract contains resolved cents, list/entry/version identities, date/break/UoM evidence, override actor/reason when applicable, and resolver contract version `SALES_PRICE_V1`. Wave 4 owns actual SO create persistence and approved-order immutability. Therefore UAT-S-08 resolver evidence is executable in Wave 2, while the approved-SO half of R-SAL-11 is not complete before Wave 4.
- Approved Limited Design Reopen mapping: the Wave-4 canonical writer re-runs this resolver inside its transaction and serializes the complete versioned envelope into `sales_order_items.price_snapshot_json`. The JSON includes contract version, business date, request fingerprint, price-list/entry/version identities, immutable version/catalog unit cents separately from resolved unit cents, requested and pricing UoM rational evidence, quantity evidence, gross line cents, and any authorized manual-override actor/`SALES_PRICING_OVERRIDE` authority/reason. Client JSON is never authoritative; the writer and approval path recompute the evidence fingerprint and cross-check version/catalog price, resolved order price, UoM, quantity and gross amount.

### 29.7 Order-Time Discount Technical Design

#### 29.7.1 物理对象

`sales_discount_schemes` (NEW #27) + `sales_discount_scheme_rules` (NEW #28). Wave 2 adds no SO snapshot table or SO columns：

```text
sales_discount_schemes:
  id (TEXT PK), scheme_code (UNIQUE NOT NULL), name, currency_code,
  priority (int; lower = higher priority), fallback_scheme_id (FK self nullable),
  effective_from, effective_to, version (safe integer >= 1),
  status ('DRAFT'|'ACTIVE'|'RETIRED'),
  activated_at/by, retired_at/by, created_at/by, updated_at/by

sales_discount_scheme_rules:
  id (TEXT PK), scheme_id (FK), rule_key (NOT NULL), rule_version (safe integer >= 1),
  enabled (0|1; NOT NULL DEFAULT 1),
  material_id (FK nullable), customer_id (FK nullable),
  customer_scope_type ('ALL'|'CUSTOMER'), customer_scope_key (NOT NULL),
  pricing_uom_code (FK uoms.code nullable),
  line_scope ('LINE'|'HEADER'), application_mode ('AUTOMATIC'|'MANUAL'),
  discount_kind ('PERCENT'|'AMOUNT'),
  discount_bps (safe integer nullable; 0..10000),
  discount_amount_cents (safe integer nullable; >= 0),
  priority (int; lower first),
  qty_break_min_micros (safe integer NOT NULL DEFAULT 0),
  qty_break_max_micros (safe integer nullable),
  effective_from, effective_to, created_at, created_by,
  UNIQUE (scheme_id, rule_key, rule_version)
```

- PERCENT requires only `discount_bps`; AMOUNT requires only `discount_amount_cents`. `REAL`, fraction-valued percent, per-unit fixed amount, and dual-populated value columns are forbidden. An AMOUNT rule means one total discount amount for the matched line or header, never cents-per-unit.
- LINE applicability may use `material_id`, customer scope, `pricing_uom_code`, quantity break, and inclusive business-date range. Nullable material/UoM means any value; minimum 0 + NULL maximum means any non-negative quantity.
- HEADER applicability is order-level only. Its database CHECK requires `material_id IS NULL`, `pricing_uom_code IS NULL`, `qty_break_min_micros = 0`, and `qty_break_max_micros IS NULL`; backend create/append/activate validation repeats the same rule and returns 422 for any violation. HEADER still uses customer scope, inclusive business date, priority, scheme fallback, AUTOMATIC/MANUAL ordering, override authority, and reason. Its calculation base is the whole order subtotal after every LINE stage.
- Customer scope normalization, date/break validity, canonical UoM lookup for LINE only, safe-integer rules, ACTIVE immutability, fallback-cycle checks, scheme-row locking, activation/retirement replay, and audit transaction follow §29.6.
- Each rule-version row is append-only from creation. A DRAFT edit appends `rule_version=max+1` under the locked scheme; it does not PATCH or delete the prior version. Logical removal appends a later version with `enabled=0` and its intended `effective_from`. For a business date, group rows by `(scheme_id, rule_key)`, restrict to versions with `effective_from <= business_date`, then choose exactly the greatest `rule_version`. If that chosen version is disabled or its `effective_to < business_date`, the rule_key contributes nothing; an older version never revives as fallback. Activation requires versions to be positive, unique, gap-free, and non-decreasing by `effective_from`; ACTIVE schemes freeze every version. Later terms require a cloned DRAFT scheme/version.
- `UNIQUE (scheme_id, rule_key, rule_version)` is a three-column Bootstrap-supported database constraint; the greatest-version rule is the single current logical version. Scheme `version` plus selected rule `id/rule_key/rule_version` is returned as immutable evidence. No sixth history/snapshot/override table is created.

#### 29.7.2 解析

`resolveOrderTimeDiscount(context)`：

```text
INPUT: customer_id, business_date, explicit_scheme_ids[],
       lines[{line_id, line_no, material_id, requested_uom_code,
              quantity_decimal, explicit_price_list_ids[],
              expected_pricing_evidence?}],
       manual_rule_selections[{rule_id, line_id nullable}], override_reason
OUTPUT:
  line_discount_cents_by_line
  header_discount_cents_total + header_allocation_cents_by_line
  total_discount_cents
  applied_rule_evidence[] (scheme id/version + rule id/key/version + order)
  rounding_evidence ('HALF_UP_CENT_V1' + allocation trace)
```

Scheme roots use explicit caller order, then the one effective customer default, then each root's validated fallback chain; no global ACTIVE scan occurs. Before applicability ranking, each `(scheme_id, rule_key)` contributes only the current business-date version selected by the preceding contract; a disabled/expired current version contributes nothing and a requested historical manual `rule_id` is rejected. Among enabled current versions, customer-specific precedes list-wide, lower rule priority precedes higher, greatest qualifying break minimum precedes lower for LINE only, latest effective start precedes earlier, and lexicographically smallest rule id is the final stable tie-break. Ambiguous corrupted state fails closed.

Pricing authority boundary:

- The discount resolver does not accept client-supplied unit price, normalized quantity, or pricing evidence as authority. For every line it invokes the canonical §29.6 price resolver server-side under the same read snapshot using customer/material/requested UoM/quantity/business date/explicit-list context; manual price follows the existing `pricing:override` + reason contract.
- `expected_pricing_evidence`, when present, is only an optimistic assertion. Its price, list/entry/version, UoM conversion identities, normalized quantity, effective range, and fingerprint must exactly match the server result or the request fails 409. The server calculation always uses its own result.
- Consequently Wave-2 output remains a zero-write preview but is based on canonical server facts and is safe for later Wave-4 reuse. No authoritative SO writer may persist a client-provided preview without re-resolving/revalidating inside that writer's transaction.

Calculation pipeline (all operands safe integers):

1. For each line, use the server-resolved price and normalized pricing quantity to compute `gross_line_cents = floor((resolved_unit_price_cents × normalized_pricing_quantity_micros + 500000) / 1000000)`. This is the single non-negative HALF_UP rounding from price × pricing-UoM quantity to line cents; unsafe multiplication or an expected-evidence mismatch fails closed.
2. Select at most one current AUTOMATIC LINE rule per line using material/customer/UoM/quantity/date applicability. If the caller supplies one current applicable MANUAL LINE rule for that line, apply it second to the remaining line amount. Each manual rule requires `pricing:override` and the same non-empty `override_reason`; no permission or reason means 403/422, not silent omission. More than one manual rule per line/scope is rejected.
3. PERCENT amount is `floor((current_base_cents × discount_bps + 5000) / 10000)` (non-negative HALF_UP to one cent). AMOUNT uses the exact stored total cents. If a stage discount exceeds its current base, reject the entire request with 409; do not cap. A result of exactly zero is valid, never negative.
4. Sum all post-LINE amounts into the order discounted subtotal. Select at most one current AUTOMATIC HEADER rule using only customer/date/priority/fallback applicability, then at most one current authorized MANUAL HEADER rule, each applied to the remaining order subtotal. HEADER never evaluates material, UoM, or quantity break. Thus all LINE stages precede all HEADER stages; AUTOMATIC precedes MANUAL within each scope.
5. Allocate each header-stage total across lines proportional to the line amounts entering that header stage. First assign floor shares; distribute remainder cents by descending fractional remainder, then ascending `line_no`, then lexicographically ascending `line_id`. Zero-base lines receive zero. Allocation sum must equal the header discount exactly. Each later header stage uses the amounts remaining after the earlier allocated stage.
6. Verify every line and order result remains `>= 0`, all sums are safe integers, and `total_discount = sum(line discounts) + sum(header allocations)`. Any violation fails atomically with zero side effects.

Integer-cents worked examples:

| Case | Calculation | Result |
|---|---|---|
| Line auto then manual | `1000 cents × 3,000,000 micros / 1,000,000 = 3000`; auto `1250 bps` gives `floor((3000×1250+5000)/10000)=375`; manual fixed `125` applies to remaining `2625` | line discount `500`; final line `2500` cents |
| Header percent + remainder | post-line amounts are line 1=`1001`, line 2=`2000`; subtotal `3001`; `1000 bps` gives `floor((3001×1000+5000)/10000)=300`; floor proportional shares are `100` and `199`, with one remainder cent | fractions rank line 2 first, so allocations are `100` and `200`; exact total `300` |
| Half-cent edge | current base `1` cent, `5000 bps` | `(1×5000+5000)/10000 = 1` cent under HALF_UP; final amount `0` is valid |
| Over-discount | current base `100` cents, fixed discount `101` | reject 409 with zero output mutation; never cap to `100` |

#### 29.7.3 与 pricing / 商业 amount 区分

```text
gross line amount       : resolved price × quantity, rounded by the commercial
                          amount contract before discount resolution
post-line subtotal      : gross line amount - automatic line - manual line
final commercial amount : post-line subtotal - allocated automatic header
                          - allocated manual header
```

No “final unit price” is reverse-derived from allocated cents. UAT-S-09 freezes calculation/evidence at amount level with this ordering, cent rounding, allocation, and zero-floor contract.

#### 29.7.4 与 M14 Sales Discount 区分

M14 (`sales_discounts`) = post-delivery finance adjustment integration。Finance canonical adapter 写入。本 Design 不让 order-time discount 进入 M14 path；M14 与 order-time discount 是 distinct canonical truth tables。

#### 29.7.5 Evidence / cross-wave boundary

- `POST /api/sales-discounts/resolve` is read-only and writes neither pricing tables nor `audit_logs`. It returns the complete calculation envelope: input fingerprint, scheme/rule versions, ordered stages, bases, bps/fixed cents, per-stage discount, header allocation trace, final line totals, actor id for manual selection, reason text, and contract version `ORDER_DISCOUNT_V1`.
- Wave 2 owns executable UAT-S-04..S-07 configuration/lifecycle/authorization behavior, UAT-S-08 price resolver evidence, and UAT-S-09 discount calculation/evidence. It does not claim actual SO persistence.
- Wave 4 persists the price and discount evidence on SO create and enforces write-once approved-order history for S19/S20/R-SAL-11. No Wave-4 column or handler is introduced by Wave 2, and R-SAL-11 remains incomplete until its approved-SO concurrency test passes.
- The approved Wave-4 persistence target is `sales_order_items.discount_snapshot_json`. Its versioned envelope contains `ORDER_DISCOUNT_V1`, request fingerprint, selected scheme/rule identities and versions, ordered LINE/HEADER stages, exact cents and HEADER allocation, rounding evidence, final commercial amount, explicit zero-discount evidence when no rule applies, and manual override actor/reason when present. The canonical writer re-resolves and verifies this evidence against `amount_cents`, line/order totals and the paired price snapshot before INSERT.

#### 29.7.6 Bounded design-reopen trace and implementation gate

| Original finding | Frozen source | Resolution | Updated section | Binding implementation rule | Required test |
|---|---|---|---|---|---|
| F1 — entry identity / nullable PK / version FK | SC15..SC20; S19/S20 | independent entry PK; bounded canonical material/customer/pricing identity keys; Bootstrap-supported four-column business UNIQUE; version FK to unique id; overlap rejection and append-only versions | §29.6.1, §29.41–43 | no nullable/7-column/hash identity; derive keys exactly; key fields never update in place; ACTIVE rows immutable | SQLite/MySQL fresh + existing-upgrade + second-init ordered-index metadata; duplicate probes; encoding bounds; boundary overlap; immutability |
| F2 — duplicate UoM truth | SC16/SC17; UAT-S-05/06 | Master A-16 rational lookup by business date; direction, micros precision, HALF_UP point and evidence frozen; no Sales factor | §29.6.2, §29.42 | read canonical numerator/denominator only; missing/ambiguous/unsafe conversion 409 | base/non-base/effective-date/direction/rounding/fail-closed cases on both DBs |
| F3 — ambiguous price precedence / legacy bypass | SC15..SC20; UAT-S-04..08 | explicit roots → effective customer default; customer before list-wide inside root; depth-first fallback; stable tie-break; cycle reject; no global scan or legacy fallback | §29.6.3, §29.40 | implement decision table literally; unresolved is `PRICE_NOT_CONFIGURED` | every decision-table row; fallback cycle; corrupted tie; product legacy price cannot rescue new resolve |
| F4 — floating/ambiguous discount | SC21..SC23; UAT-S-09 | bps/cents only; LINE filters separated from order-level HEADER; greatest rule version only; server-canonical pricing input; unchanged HALF_UP/largest-remainder algorithm | §29.7.1–5 | HEADER has no material/UoM/break; no historical-version fallback; client price evidence is assertion only | DB/backend HEADER rejection; current/disabled/inapplicable-version cases; canonical price mismatch; percent/fixed, allocation, edge and override cases |
| F5 — API / permission / audit ambiguity | SC19/SC109/SC114; P1/P3/P5 | POST-only zero-write resolvers; exact three-permission five-role matrix; atomic lifecycle audit; A-21 replay; no override log | §29.31.2–3, §29.33, §29.35 | exact endpoint/method and authority; manage/override independent; preview never writes | positive/negative matrix for five roles; resolver DB diff = zero; activate/retire audit rollback/replay/payload mismatch |
| F6 — MySQL additive reconciliation gap | S19/S20; SQLite/MySQL acceptance | target-first five-table creation; <=4-column inline entry UNIQUE; two nullable fields and named real MySQL FKs; preserve rows; mismatch fail-closed | §29.41–43, §30.8, §30.12 | fresh/upgrade/repeat converge without Adapter or generated-index changes | SQLite PRAGMA + MySQL information_schema ordered UNIQUE/FK/CHECK assertions; no `__partial_*`; duplicate probes and row-count preservation |
| F7 — Wave-plan/UI/acceptance inconsistency | mobile-first governance; UAT-S-04..09; S19/S20; R-SAL-11 | contextual sub-page/no top-level route/four-width matrix; Wave 2 proves config/resolvers/evidence while Wave 4 persists SO snapshot and completes race proof | §29.6.4, §29.7.5, §29.43 R-SAL-11, §30.2/11/17 | no UI implementation or SO schema/writer in Wave 2; no premature R-SAL-11 PASS | route/launcher/four-width acceptance later; Wave-2 UAT-S-04..09 + structural R-SAL-11; Wave-4 persistence/write-once/concurrency test |

Closure count for this reopen: original findings `7/7` resolved; authorized correction workstreams A–H `8/8` covered; Wave-2 new tables `5/5`; existing-table fields `2/2`; permission codes `3/3`; frozen roles mapped `5/5`; UAT allocated `6/6` (`UAT-S-04..09`); unresolved design decisions `0`; `TBD = 0`. This is a design gate only: implementation remains prohibited until external approval.

### 29.8 Sales Order Canonical Model

#### 29.8.1 Lifecycle

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
+ 设计上叠加 (controlled hybrid) 商业 fulfillment projection:
  REMAINING_OBLIGATION_PARTIAL (no persisted state; derived)
  REMAINING_OBLIGATION_FULL_DONE (no persisted state; derived)
  CLOSED_COMMERCIALLY (persisted via SC43, requires explicit close action)
  CANCELLED_COMMERCIALLY (persisted via SC44, requires explicit cancel)
```

> `CLOSED_COMMERCIALLY` 与 `CANCELLED_COMMERCIALLY` 是 persisted state in `sales_orders.commercial_status`；FROZEN lifecycle status (DRAFT/SUBMITTED/APPROVED/REJECTED) 与商业 close state 是两个 orthogonal dimensions（不 mix）。

#### 29.8.2 Schema Additive

`sales_orders` 新 additive columns：

```text
order_date                       (date — already from v13-phase1)
requested_delivery_date          (date — already)
payment_terms, payment_terms_days (already)
ship_to_contact_name, ship_to_phone, ship_to_address (already)
salesperson_id                    (NEW — FK salesperson_profiles.id nullable)
sales_group_id                    (NEW — FK sales_groups.id nullable)
settlement_party_id              (NEW — FK customers nullable)
payer_id                         (NEW — FK customers nullable)
customer_material_xref_id        (NEW — FK customer_material_xref nullable)
commercial_pricing_uom_code      (NEW — resolved commercial pricing UoM snapshot)
commercial_tax_code              (NEW — derived from extension)
tax_inclusive                    (NEW — bool nullable)
required_prepayment_cents         (NEW — int nullable, 0 means none)
reservation_intent_state         (NEW — enum: 'NONE'|'REQUESTED'|'GRANTED'|'RELEASED')
gift_summary_cents                (NEW — sum of is_gift_line amount_cents)
commercial_close_state           (NEW — 'OPEN'|'PARTIAL_DONE'|'CLOSED'|'CANCELLED')
```

`sales_order_items` 新 additive columns：

```text
is_gift_line                   (NEW — bool default false)
commercial_tax_basis           (NEW — varchar code nullable; commercial only,
                                not statutory invoice tax)
tax_inclusive_assumption       (NEW — bool nullable)
pricing_uom_code_applied       (NEW)
qty_break_applied_min           (NEW REAL nullable)
qty_break_applied_max           (NEW REAL nullable)
planned_delivery_date           (NEW DATE nullable; one-schedule-per-line identity = sales_order_items.id)
upper_delivery_tolerance_bps    (NEW INTEGER nullable; CHECK >= 0)
lower_delivery_tolerance_bps    (NEW INTEGER nullable; CHECK 0..10000)
price_snapshot_json             (NEW TEXT/JSON nullable for legacy; mandatory non-empty canonical evidence for Batch A new lines)
discount_snapshot_json          (NEW TEXT/JSON nullable for legacy; mandatory non-empty canonical evidence, including explicit zero discount)
```

> 不破坏 existing rows；legacy rows 缺新字段为 NULL，行为为 PARTIAL compatibility。

#### 29.8.3 Commercial Party Snapshot

SO create 时将 `customer_commercial_extensions` 当前 effective record 冻结进 SO header snapshot columns（per §29.4.4）。Effective dating 通过 `effective_from / effective_to` 在 `customer_commercial_extensions` 表本身表达；SO 时序上不再 re-evaluate。

#### 29.8.3.1 SC30 Delivery Schedule + SC08 Tolerance Snapshot

现有 B3102 可读证据只证明交货计划/交货日期与超交、欠交控制，未证明一个 SO line 必须支持多个 schedule。bounded baseline 因而采用 **line-level single schedule snapshot**，不虚构 dedicated `sales_order_delivery_schedules` relation：`sales_order_items.id` 同时是 source-line identity 与该行唯一 schedule identity；`planned_delivery_date` 可由 header `requested_delivery_date` 默认，但最终逐行存储。

在 SO create/approval（以首次形成 APPROVED immutable obligation 为最终冻结点）从 A-61 默认值解析并写入 line snapshot；审批后不得由 later master/default change 重算。只有 SC37–SC40 controlled SO Change 可对**未执行剩余量**产生新 effective version，且保留 before/after/reason/audit；已经 notified/delivered 的历史不改写。

```text
base_qty                = sales_order_items.quantity in Sales UoM
upper_tolerated_qty     = base_qty × (10000 + upper_delivery_tolerance_bps) / 10000
lower_tolerated_qty     = base_qty × (10000 - lower_delivery_tolerance_bps) / 10000
```

quantity 使用现有 deterministic decimal/quantity convention 做整数刻度或数据库精确十进制运算，统一舍入规则后比较；禁止 binary-float 临界比较。Sales/Pricing UoM 不同则先通过 canonical `product_uom_conversions` 归一至 Sales UoM；缺 conversion 时 backend BLOCK。

- Delivery Notice（Wave 5）在 source-line lock 内重读 `SUM(active notified qty)`，新累计值超过 `upper_tolerated_qty` 时 BLOCK，失败副作用为零。
- Sales Delivery（Wave 5）在同一 transaction 内重读 DN/SO source capacity，`SUM(confirmed delivered qty)` 超 upper bound 时 BLOCK，失败副作用为零。
- 正常完成点仍是 ordered `base_qty`。若 delivered qty 已达到 lower bound，可通过显式 controlled close 豁免 remainder，必须记录 reason、actor、before/after 与 audit；低于 lower bound 不得标记 fulfilled，必须用 controlled change/cancel 处理剩余义务。
- `delivery_schedule_enabled` / `delivery_quantity_control_enabled` 按 A-65 SYSTEM/DOCUMENT_TYPE resolution 执行；配置关闭不删除已批准快照，也不重写历史。

#### 29.8.4 Commercial Tax-Basis Assumption Snapshot

Requirement SC27 / SC28 / RC-24:

```text
SO Header column commercial_tax_code  — commercial tax code (nullable)
SO Header column tax_inclusive         — bool (nullable)
SO Item column commercial_tax_basis    — commercial tax-basis assumption per item
SO Item column tax_inclusive_assumption
```

> Tax Snapshot 是 commercial assumption 持久化；statutory invoice tax truth 仍归 Finance Operations canonical `sales_invoices` + `account_role_mappings`。Sales 不 mirror statutory tax ledger；Sales 不 compute invoice tax。

#### 29.8.5 Compatibility

- Legacy Sales Orders without commercial parties / tax-basis / prepayment / reservation_intent: SO business 显示 `(legacy)` 标记；不 fabrication 商业事实。
- 任何 historical modification：禁止 retro-rewrite；只允许 forward-only SO Change (SC37..SC40)。

### 29.9 Sales Order Change Technical Design

#### 29.9.1 物理对象

`sales_order_changes` (NEW #29) + `sales_order_change_lines` (NEW #30) + `sales_order_change_state_machine`：

```text
sales_order_changes:
  id, change_no (UNIQUE), sales_order_id (FK),
  change_path (CHECK IN 'CONTROLLED_DIRECT','CONTROLLED_DOCUMENT'),
  state (CHECK IN 'DRAFT','SUBMITTED','REJECTED','CANCELLED','APPLIED'),
  reason_code (enum), reason_text,
  before_snapshot_hash, after_snapshot_hash,
  base_effective_version, target_effective_version,
  parameter_scope_key, parameter_snapshot_hash, order_change_mode_snapshot,
  request_idempotency_key, application_idempotency_key,
  requested_by, requested_at,
  approver_id, approved_at, applied_by, applied_at,
  created_at

sales_order_change_lines:
  id, change_id (FK), line_no,
  op ('ADD','MODIFY','CANCEL'),
  sales_order_item_id (FK; NULL for ADD),
  before_values_json, after_values_json, qty_delta, amount_delta,
  delivered_before_qty, delivered_after_qty,
  constraint_check_result
```

#### 29.9.2 约束 (R-SAL-07 / R-SAL-08 + SC40 invariant)

```text
applied rule:
- both paths call the same canonical `applySalesOrderChange(change_id, expected_base_version, idempotency_key, actor)` service
- no field may be changed below an already executed/notified/reserved/recognized fact
- qty cannot be reduced below SUM(sales_delivery_items.qty for so_item)
- planned delivery schedule 不能 reduce below already-notified Delivery Notice
- prepayment requirement 边界 由 prepayment_gate re-evaluation (§29.16)
- credit 边界 by SC95 + R-SAL-24 (re-evaluate against current policy snapshot)
- pricing snapshot 不变 (R-SAL-11)
- historic price/discount 字段 never overwritten (SC40)
- executed inventory/finance history NOT touched; reversal/credit mechanisms
  走 frozen-domain adapters
- source customer/quotation/SO/line identity cannot be reassigned; ADD lines receive new identity
- `BOTH` only enables both request entry paths; it never changes authorization, approval, validation or lock rules
```

#### 29.9.3 Effective Versioning

`sales_orders` 增加物理列 `effective_version INTEGER NOT NULL DEFAULT 1 CHECK (effective_version >= 1)`（MySQL 使用等价 `INT` 约束）。新建 SO 初始化为 `1`；Wave 4 additive migration 将全部 legacy SO（包括既有 APPROVED / 已履约订单）回填为兼容基线 `1`。该回填只建立未来并发锚点，不声称重建未知历史版本，也不生成虚假 change evidence。

SO header 的 `effective_version` 表示当前生效商业版本；A-33 的 `base_effective_version` 必须等于 request transaction 读取的当前值，`target_effective_version` 固定为 `base + 1`。既有 APPROVED 版本及其 before/after snapshot、A-33/A-34 evidence 均为只读历史；当前 SO 投影只能由 canonical `applySalesOrderChange` 推进，普通 create/edit/PATCH allow-list 不接受客户端写入 `effective_version`，也不得静默覆盖 APPROVED 历史。

每次成功 application 在同一 transaction 内重读并校验 `base_effective_version == sales_orders.effective_version`，且以 `UPDATE sales_orders ... WHERE id = ? AND effective_version = ?` 执行 compare-and-swap；affected row 必须恰为 `1`，否则以 409 stale 冲突回滚且零副作用。成功时 `effective_version` 恰好递增一次；拒绝、取消、失败和同一 idempotency key 的重放均不得递增。SQLite 使用 `BEGIN IMMEDIATE` 后执行相同 CAS；MySQL 先 `SELECT ... FOR UPDATE` 锁 SO header，再按既定顺序锁 change、affected lines 与 source-capacity anchors，并仍以 CAS 作为最终 stale guard。

版本 CAS、未执行 remainder 更新、A-33/A-34 APPLIED append-only evidence、approval decision、idempotency record 与 audit 必须在同一 application transaction 原子提交。任一步失败全部回滚。已通知/已交付/已保留/已确认收入数量，以及既有 Inventory、Finance 和 source relations 只读受保护，不随版本推进而改写；参数改变也不得重解释或追溯改写历史 APPLIED evidence。

#### 29.9.4 Approval workflow

SO Change belongs to SALES_ORDER approval family (current Platform)。两条路径差异只在 authoring surface：

- `CONTROLLED_DIRECT`：从 APPROVED SO 发起；不提供可长期编辑的独立变更单 UI，但在 request transaction 中立即创建 A-33/A-34 immutable draft evidence，并创建 Platform approval request。
- `CONTROLLED_DOCUMENT`：先创建可编辑的 DRAFT change document，submit 后冻结内容并创建 Platform approval request。
- `BOTH`：允许上述两种 request；direct permission 不能调用 document-only command，document permission 也不能调用 direct-only command。requester 不能批准自己的 request；只有独立 approval authority 可进入 canonical application。

State machine：

```text
CONTROLLED_DIRECT:   SUBMITTED → APPLIED
                              ↘ REJECTED / CANCELLED
CONTROLLED_DOCUMENT: DRAFT → SUBMITTED → APPLIED
                                      ↘ REJECTED / CANCELLED
```

Request transaction：resolve mode + RBAC，读取当前 SO/version，canonicalize before/after，写 A-33/A-34、parameter snapshot、request idempotency evidence、approval request 与 audit；不改变 SO。

Approval/application transaction：

1. RBAC/SOD 校验独立 approver；lock approval request、SO header、change row，再按 ID 排序 lock affected SO lines/source-capacity anchors；
2. 重读 SO effective version、delivered/notified/reserved facts、Inventory/Finance source relations、当前 effective parameter 与 credit/prepayment constraints；
3. 校验 path 在 request snapshot 与当前 mode 中均允许，且 before hash / base version 未 stale；
4. 以 application key `SO_CHANGE_APPLY:<change_id>:<target_version>` 写 A-21 idempotency guard；
5. 调用唯一 `applySalesOrderChange`，仅更新未执行 remainder；同步写 version、APPLIED evidence、approval decision 与 audit；
6. commit 后新版本生效。任一校验/adapter/audit 失败则整笔 rollback，approval 不得独立变成成功。

SQLite 使用 `BEGIN IMMEDIATE`；MySQL 使用上述 deterministic `SELECT ... FOR UPDATE` 顺序。R-SAL-07 覆盖 approve/change 序列化，R-SAL-08 覆盖 Change vs direct Sales Delivery，R-SAL-18 覆盖 Change vs Delivery Notice；既有三个 Race ID 已覆盖本决策，不新增 Race ID。

若 SO Change 涉及 credit / prepayment / reservation，additional gate evidence 必须由 §29.16 + §29.17 + §29.25 提供并纳入同一 application transaction。

#### 29.9.5 DR-SAL-01 approved mode boundary

DR-SAL-01 Option A 已由用户正式批准：

- `DISABLED`：两条路径均 backend BLOCK；
- `CONTROLLED_DIRECT`：只接受 direct request；
- `CONTROLLED_DOCUMENT`：只接受 formal change document；
- `BOTH`：接受两条路径，但不能借另一入口绕过 permission/approval/SOD。

两条路径共享 A-33/A-34 evidence、canonical application service、lock order、idempotency namespace、audit 与 version rules；四模式决策不新增物理表，但 canonical version contract 要求在既有 A-02 增加一个 `effective_version` 字段。SC37..SC40 / UAT-S-15 的设计决策缺口已闭合；外部评审已 PASS，用户 Freeze approval 已确认，本 Technical Design 正式 `PASS / FROZEN`。

### 29.10 Sales Order Fulfillment / Close Lifecycle

#### 29.10.1 Design 决定（controlled hybrid）

本 Design 采用 **controlled hybrid**：

```text
A. PERSIST commercial_close_state (列) ONLY on completion:
     OPEN → COMMERCIALLY_CLOSED
     OPEN → COMMERCIALLY_CANCELLED
   (semantic state change requires explicit user action; partial fulfillment
    does not persist state transitions)
B. PARTIAL fulfillment state is DERIVED from:
     sales_deliveries.sales_order_id × sales_order_items.quantity
     vs sales_deliveries 聚合
     (no persisted 'partially fulfilled' bit)
C. REMAINING_OBLIGATION_FROZEN: never overwritten in place; period close and
   finance close NEVER depend on SO closure. SO closure is a Sales-side
   projection only.
```

#### 29.10.2 Effective Identity

```text
Sales commercial close_state = persisted in sales_orders.commercial_close_state
                                   ('OPEN' | 'PARTIAL_DONE' | 'CLOSED' | 'CANCELLED')
PARTIAL_DONE = derived (no persisted bit); triggers if
              SUM(deliveries.confirmed) > 0 AND SUM(deliveries.confirmed) < ordered_qty
CLOSED = persisted via explicit action + completed check
CANCELLED = persisted via explicit action + reason + audit
```

### 29.11 Delivery Notice Technical Design

#### 29.11.1 物理对象

`delivery_notices` (NEW #31) + `delivery_notice_lines` (NEW #32)：

```text
delivery_notices:
  id, notice_no (UNIQUE), sales_order_id (FK),
  state ('DRAFT','CONFIRMED','CANCELLED','CLOSED'),
  warehouse_id (FK), ship_to_snapshot_json,
  planned_delivery_date, business_date,
  customer_id, customer_snapshot,
  creator_id, created_at,
  confirmed_at, confirmed_by

delivery_notice_lines:
  id, delivery_notice_id (FK), sales_order_item_id (FK),
  scheduled_qty (REAL),
  notified_qty (REAL; sum of all confirmed Sales Delivery referenced),
  cancelled_notified_qty (REAL; cancelled or reversed notice qty),
  remaining_notified_qty (GENERATED: scheduled - notified)
  PRIMARY KEY (delivery_notice_id, sales_order_item_id)
```

#### 29.11.2 链

```text
Sales Order
→ Delivery Notice (商业指令；不 mutate stock)
→ Sales Delivery (实际执行；consumes Delivery Notice remaining)
→ Inventory physical outbound (canonical V21)
```

#### 29.11.3 多 Sales Delivery 对同一 Delivery Notice

允许：同一 Delivery Notice 的同一 line 可以由多个 Sales Delivery 消费，按 `sales_delivery_items.delivery_notice_line_id` 加 references 累加 notified_qty。

#### 29.11.4 不 mutate inventory

Delivery Notice CONFIRM 不写 inventory；只写 delivery_notice_lines 自身 rows。

#### 29.11.5 容量 invariant (R-SAL-16 / R-SAL-17)

```text
scheduled_qty ≤ SO line qty (audit snapshot)
remaining_notified_qty = scheduled_qty - notified_qty (GENERATED)
delivery_notified_qty ≤ scheduled_qty
sales_delivery_items (for this DN line) qty ≤ remaining_notified_qty
```

Locking: Sales-Delivery confirm 必 lock both:
1. `sales_delivery_items source_line_identity` (for SDD capacity)
2. `delivery_notice_lines remaining_notified_qty` (for DN capacity)

→ SQLite `BEGIN IMMEDIATE`; MySQL `SELECT … FOR UPDATE` on both targets before compute and write.

### 29.12 Sales Delivery Convergence

#### 29.12.0 Two truthful source paths for new Sales Delivery

Frozen Requirement permits both chains:

```text
Sales Order → Sales Delivery → Inventory physical outbound
Sales Order → Delivery Notice → Sales Delivery → Inventory physical outbound
```

Compatibility boundary:

| Compliance path | Legacy read | Legacy mutate (correction) | New write through legacy bypass |
|---|---|---|---|
| Legacy Sales Delivery (`source_mode` absent/backfilled `LEGACY_UNCLASSIFIED`) | YES | bounded (Policy §29.45 correction) | NO |
| New direct-order Sales Delivery | n/a | n/a | `source_mode=DIRECT_ORDER`; DN refs NULL; SO header/line refs mandatory |
| New notice-backed Sales Delivery | n/a | n/a | `source_mode=DELIVERY_NOTICE`; DN header/line refs mandatory |

Therefore the canonical new-flow invariant:

```text
NEW Sales Delivery after domain cutover MUST explicitly choose one source_mode.
DIRECT_ORDER uses existing sales_deliveries.sales_order_id and
sales_delivery_items.sales_order_item_id; DELIVERY_NOTICE additionally requires
delivery_notice_id + delivery_notice_line_id. Mixed modes in one SD are forbidden.
```

Direct delivery never creates a fake DN. Both paths lock the canonical SO line, recompute cumulative confirmed delivery against tolerance, execute credit/prepayment/reservation/OQC gates, call Inventory and Finance canonical adapters in the caller transaction, use the same confirm idempotency key, and write audit. Notice-backed flow additionally locks DN line capacity.

#### 29.12.1 Compatibility Design (legacy SDs read-only preserved)

```text
legacy SD row pre-cutover:
  source_mode = LEGACY_UNCLASSIFIED
  → read path allowed
  → correction path governed by Policy §29.45 only (no automatic fill-in)
  → no automatic source reinterpretation
new SD after cutover:
  source_mode IN (DIRECT_ORDER, DELIVERY_NOTICE), never LEGACY_UNCLASSIFIED
```

#### 29.12.2 Existing Invariants preserved

```text
- OQC gate (assertQualityGate 'OQC')
- Inventory canonical writer (applyInventoryMutation, postTrackedMovement)
- LOT/SERIAL tracking
- valuation / COGS (issueSourceValue)
- Finance recognition adapter (recognizeFinanceExposure auto Invoice if
  billing_mode = DIRECT_BILL; or post AR if LEGACY_DIRECT)
- Idempotency (idempotency-key on confirm)
- Audit (audit_logs entity_type='SALES_DELIVERY')
```

### 29.13 Sales Return Technical Design

#### 29.13.1 物理对象

`return_orders.source_type` 已存在 'PURCHASE' | 'SALES'；新增 commercial_source_marker column：

```text
return_orders.commercial_source_marker  -- NEW
  CHECK IN ('DELIVERY_BACKED', 'ORDER_BACKED', 'NO_SOURCE')
```

(DESIGN alternative): 新建 `return_modes` 表；本 Design 选 column-additive 保持最小 invasive.

#### 29.13.2 三种 mode

| Mode | Required source | Inventory effect | Finance effect | Audit |
|---|---|---|---|---|
| DELIVERY_BACKED (SC54) | `sales_delivery_items.id` | IN (applyInventoryMutation) | applyCreditAdjustment (DR AR / CR Sales Revenue voucher) | full audit |
| ORDER_BACKED (SC55) | `sales_order_items.id` + `sales_deliveries.delivery_id IS NULL for that item`（NO delivery was done）| based on §29.19 / source evidence availability | applyCreditAdjustment bounded by source evidence | full audit + explicit source marker |
| NO_SOURCE (SC56) | no source sales row | IN (inventory receipts) | 仅 当 Finance-side 具备有效 basis 时才生成 credit; 否则 only inventory + audit | full audit + explicit `NO_SOURCE` marker |

#### 29.13.3 容量 invariant

```text
return_qty ≤ source_line_remaining_qty
R-SAL-03 source-line remaining holds
```

#### 29.13.4 ORDER_BACKED guardrail

A `ORDER_BACKED` return must NOT automatically imply:

```text
- a fake Delivery
- a fake Invoice
- a fake AR row
```

It may record the document; any Inventory IN effect is conditional on actual warehouse movement (manual acceptance); any Finance credit is conditional on Finance-side basis.

#### 29.13.5 NO_SOURCE guardrail

```text
return_orders.commercial_source_marker = 'NO_SOURCE'
+ mandatory fields: customer_id, material_id, quantity, warehouse_id,
  reason_code, business_date, authorization_role.
+ NO automatic Finance credit; only inventory receipt + audit.
+ visible in Sales UI as "无来源销售退货" separate from DELIVERY_BACKED and
  ORDER_BACKED; not mergeable.
```

### 29.14 Replacement / Replenishment Technical Design

#### 29.14.1 物理对象（header + line）

Replacement is LINE-CAPACITY based. Identity anchor:

```text
Source return line = return_order_items.id  (preferred; matches source-capacity unit)
  Header object     = sales_order_replacements          (NEW A-37 header; line-aggregate)
  Line object       = sales_order_replacement_lines     (NEW A-38 line; per material / qty)
```

`sales_order_replacements` (NEW A-37 header):

```text
sales_order_replacements:
  id, replacement_no (UNIQUE),
  source_return_id (FK return_orders.id, NOT NULL),
  state ('OPEN','IN_PROGRESS','FULFILLED','CANCELLED'),
  replacement_quantity (header roll-up; computed from lines),
  fulfilled_quantity   (header roll-up; computed from lines),
  remaining_quantity   (header roll-up; computed from lines),
  delivery_link_id (FK sales_deliveries.id nullable),
  created_at, creator_id, closed_at, closed_by
```

`sales_order_replacement_lines` (NEW A-38 line):

```text
sales_order_replacement_lines:
  id, replacement_id (FK sales_order_replacements.id),
  line_no,
  source_return_item_id (FK return_order_items.id, NOT NULL),
  replacement_material_id (FK products.id),
  replacement_quantity (REAL),
  fulfilled_quantity (REAL, GENERATED = SUM(sales_replacement_fulfillments where confirmed))
  remaining_quantity (REAL, GENERATED = replacement_quantity - fulfilled_quantity)
  replacement_uom_code
  business_date
  created_at
```

`sales_replacement_fulfillments` (NEW link table; one-row per confirmed replacement_delivery item):

```text
sales_replacement_fulfillments:
  id, replacement_line_id (FK sales_order_replacement_lines.id),
  sales_delivery_id (FK sales_deliveries.id),
  sales_delivery_item_id (FK sales_delivery_items.id),
  fulfilled_qty, business_date
```

#### 29.14.2 Constraints

```text
- replacement_quantity (header) = SUM(sales_order_replacement_lines.replacement_quantity)
- fulfilled_quantity (header)   = SUM(sales_order_replacement_lines.fulfilled_quantity)
- remaining_quantity            = SUM(remaining across lines)
- replacement_quantity per line ≤ source_return_item.quantity (R-SAL-10 lock anchor)
- 不 reopen 原 SO 的 executed history；replacement 是一个新商业 obligation
- inventory effect 仅 when replacement_delivery confirm (canonical Inventory V21)
- finance effect 仅 when replacement delivery confirm + canonical AR adapter
- no second inventory ledger; no second AR ledger
```

#### 29.14.3 与 Quotation / SO / Delivery / Prepayment 互动

- Replacement 可以触发新的 Quotation（policy-dependent）；不是 mandatory.
- Replacement 可以触发 Prepayment Gate（policy-dependent）。
- Replacement fulfillment 走 new Sales Delivery + Inventory physical outbound.
- Replacement delivery source line integrity: `sales_delivery_items.delivery_notice_id` MAY reference a Delivery Notice created for the replacement, or NO Delivery Notice if replacement is a one-shot direct delivery (subject to Product Domain rule at implementation evidence).

#### 29.14.4 Capacity anchor (R-SAL-10)

For R-SAL-10 lock matrix:

```text
canonical lock identity = return_order_items.id (line-level)
secondary lock for confirmation = sales_order_replacement_lines.id (line-level)
delivery consume lock = sales_delivery_items.id (already established)
```

Frozen-domain integrity: replacement creation does NOT silently rewrite `return_orders` or `sales_delivery_items`; replacement is a new obligation that DELIBERATELY references the source return line by FK.

### 29.15 Gift Line Technical Design

#### 29.15.1 标识

`sales_order_items.is_gift_line` (NEW bool default false).

#### 29.15.2 语义

```text
selling price = 0 (unit_price_cents = 0; amount_cents = 0)
commercial amount = 0
commercial tax basis = 0 (regardless of tax-inclusive flag)
inventory / reservation / OQC / COGS / source-line trace continue normally
COGS continues; revenue 0
```

#### 29.15.3 链

```text
SO (is_gift_line true)
→ Delivery Notice (line carries gift marker)
→ Sales Delivery (line executes inventory OUT normally)
→ Sales Invoice or M14 economics
  (commercial amount = 0; COGS still booked; gift cost retention per Finance
   adapter decision; SC29 + S07 invariant)
```

#### 29.15.4 Audit

Gift line on SO 触发 audit `entity_type=SALES_ORDER, action=GIFT_LINE_ADDED, detail=line_no`.

### 29.16 Prepayment Gate Technical Design

#### 29.16.1 物理对象

`sales_prepayment_requirements` (NEW #37) + `sales_prepayment_gate_results` (NEW #38)：

```text
sales_prepayment_requirements:
  id, sales_order_id, line_no,
  required_amount_cents, ratio_basis ('LINE_VALUE'|'ORDER_VALUE'),
  effective_from, effective_to,
  created_at, created_by
  PRIMARY KEY (sales_order_id, line_no)

sales_prepayment_gate_results:
  id, sales_order_id (FK),
  stage ('PLANNING_RELEASE','RESERVATION','DELIVERY'),
  eligible_advance_cents (from Finance advance/unapplied reads; bounded),
  remaining_required_cents (GENERATED: required_amount - advance_applied),
  decision ('PASS','WARN','BLOCK','OVERRIDE_REQUIRED'),
  override_reason, overridden_by,
  evaluated_at, evaluated_by,
  snapshot_key (idempotency / replay)
  PRIMARY KEY (sales_order_id, stage, snapshot_key)
```

#### 29.16.2 Evaluator (one canonical Finance-side value with shared lock)

```text
Chosen Design: Sales calls a Sales-owned Finance adapter that reads ONE canonical
Finance-side eligible prepayment value AND acquires the canonical Finance
balance locks in the SAME database connection/transaction as the Sales gate
mutation.

Sales does NOT independently SUM:
  advance_receipts + settlement_unapplied_balances + applied_applications;
  those are NOT proven disjoint in the frozen Finance domain.

Sales calls:
  financeAdapter.resolveEligiblePrepaymentForSalesGate(
    customer_id, business_date, gate_stage, sales_order_id,
    remaining_required_cents,
    lockMode = FOR_UPDATE         ← locks the canonical Finance balance rows
  )
  → returns:
    eligible_amount_cents             (single canonical value)
    source_balance_identities         (ref to balance rows consumed in this read)
    already_applied_amount_cents       (applied by previous gates / refunds)
    refunded_amount_cents             (refunded portion reducing remaining)
    remaining_eligible_cents           (eligible_amount - already_applied)
    decision_hint                     (Finance hint: OK / WATCH / NOT-OK)
    business_date
    contract_version                  (frozen Finance contract snapshot)
```

The adapter must:

```text
identify all canonical Finance balance rows that contribute to eligible
eligible prepayment (customer's unapplied + advance + applied + refunded
pool), lock them in deterministic order, re-read eligible / applied /
refunded / remaining, return the decision evidence to Sales.
```

Sales gate logic (consumer, in same connection/transaction):

```text
evaluateSalesPrepaymentGate(sales_order_id, stage):
  1. lock sales_prepayment_requirements for sales_order_id
  2. call financeAdapter.resolveEligiblePrepaymentForSalesGate(
       ..., lockMode = FOR_UPDATE
     )  → acquires canonical Finance balance locks in this transaction
  3. compute remaining_required_cents
  4. compare Finance remaining_eligible_cents vs required remaining
  5. emit decision (PASS / WARN / BLOCK / OVERRIDE_REQUIRED)
  6. write sales_prepayment_gate_results row in same transaction
     with source_balance_identities captured (audit trace)
  7. write audit
  8. COMMIT
```

R-SAL-15 serialization (Final Closure design):

```text
The Sales gate + Finance refund/Application serialize on the SAME canonical
Finance balance locks acquired inside the SAME transaction/connection by
the financeAdapter.

Sales gate wins first:
  financeAdapter locks canonical Finance balances FOR UPDATE
  gate reads locked eligible balance
  sales_prepayment_gate_results inserted
  COMMIT
  then Finance refund / Application proceeds (must acquire SAME locks)

Finance mutation wins first:
  financeAdapter locks canonical Finance balances FOR UPDATE
  eligible balance changes
  Finance mutation commits
  Sales gate acquires the same locks
  re-reads reduced balance
  PASS / BLOCK is decided from new state
```

Forbidden:

```text
Sales passes from a stale eligible amount
while a concurrent Finance mutation has already consumed / refunded it.
```

#### 29.16.3 Frozen-domain contract status for R-SAL-15 (Final Closure)

Canonical V22 identities and locked set (Final Closure implementation-ready):

```text
which canonical Finance row identities are locked
  (per V22 §33 frozen accounting settlement / prepayment flow):

  settlement_unapplied_balances       (the unapplied credit memo / unapplied balance
                                       pool that contributes to "eligible prepayment")
  payment_collections                  (customer prepayments / advance receipts applied
                                       by collection; reduces remaining available)
  financial_credit_adjustments         (refund / write-off / credit adjustment operations
                                       that reduce remaining eligible)

  These are the actual V22 canonical objects used by the Prepayment Gate
  eligible-amount computation. NO new Finance balance is invented.
```

```text
deterministic Finance lock order
  (must match the order used by Finance refund / Application path):

  1. settlement_unapplied_balances FOR UPDATE
       (per customer, per business_date)
  2. payment_collections FOR UPDATE
       (per customer, per business_date)
  3. financial_credit_adjustments FOR UPDATE
       (per customer, per business_date)
```

```text
which Finance refund / application paths already use those locks
  (existing V22 §33.39 / §28 Finance-specific concurrency requires):

  Yes — Finance refund paths in v22 Financial Controls already
  acquire these canonical Finance balance locks when reducing
  eligible amount. Sales does NOT introduce new Finance locking.
```

```text
which paths need the bounded contract extension
  (the missing piece from current V22):

  The locked-READ contract variant (lockMode = FOR UPDATE on the
  SAME canonical Finance balance set, returning the same evidence
  to the caller) is not yet exposed. Current V22 returns the
  eligible value but does not acquire FOR UPDATE on the balance
  set as part of the read. This read-then-acquire pattern is the
  missing piece required by R-SAL-15. Bounded contract extension only.
```

The shared contract:

```text
Sales gate locked-read
and
Finance balance-reducing mutation
serialize on the SAME Finance economic balance identity.
```

#### 29.16.3.1 Canonical Finance parent balance lock identity (Final Two-Point Closure)

The canonical economic balance identity for Sales Prepayment Gate is:

```text
settlement_unapplied_balances.id
(where balance_type = 'PREPAYMENT')
```

This is the PRIMARY cross-domain lock identity for R-SAL-15. Child facts read
beneath the parent balance lock (NOT primary locks themselves):

```text
balance_applications         (consumes PREPAYMENT balance)
financial_refunds            (refunds PREPAYMENT balance)
applicable reversal effects (e.g. settlement_unapplied_balances reversal rows
                             that reduce the eligible prepayment pool)
```

`payment_collections` is a SOURCE DOCUMENT (the customer advance that originally
created the PREPAYMENT balance) — it is NOT the primary balance serialization
lock. The canonical R-SAL-15 lock set is the parent balance row.

#### 29.16.3.2 Canonical remaining-prepayment formula (per eligible balance)

For each eligible Finance PREPAYMENT balance row (locked FOR UPDATE):

```text
remaining

=
  settlement_unapplied_balances.original_amount_cents

- confirmed balance_applications                   (consumed portion)

- confirmed financial_refunds                      (refunded portion)

- applicable unapplied-balance reversal effects    (reversal portion)
```

Use the exact existing V22 canonical reversal semantics. Do NOT invent another
balance or another decrement field. The financeAdapter returns the remaining
eligible amount per eligible balance and the source identities for audit.

#### 29.16.3.3 Frozen-domain contract status for R-SAL-15 (Final Two-Point Closure)

```text
Finance business semantics                            NO CHANGE
Finance canonical balance (settlement_unapplied_balances)  NO CHANGE
sales locked-read adapter for R-SAL-15              BOUNDED INTEGRATION CONTRACT EXTENSION
Finance mutation path that reduces remaining     NO CHANGE if it already
  eligible prepayment                                  locks settlement_unapplied_balances.id;
                                                       otherwise BOUNDED INTEGRATION
                                                       CONTRACT EXTENSION
```

`payment_collections` and `financial_credit_adjustments` are NOT the primary lock
set; they are source documents / economic evidence respectively. They are not
re-defined in this Design.

If V22 later exposes a similar locked-read contract on the parent balance
row, the extension collapses to a no-op without semantics change.

#### 29.16.3.4 Required adapter contract (Sales locked-read)

```text
financeAdapter.resolveEligiblePrepaymentForSalesGate(
  customer_id, business_date, gate_stage, sales_order_id,
  remaining_required_cents, lockMode = FOR_UPDATE,
  db_transaction_context
)
  1. identify eligible PREPAYMENT settlement_unapplied_balances rows
  2. order their IDs deterministically (lexicographic by balance id)
  3. SELECT those balance rows FOR UPDATE
  4. under those locks re-read canonical child effects:
       balance_applications
       financial_refunds
       applicable reversal effects
  5. calculate remaining eligible prepayment per balance per §29.16.3.2 formula
  6. return evidence to Sales (eligible_amount_cents, source_balance_locked
     identities, already_applied, refunded, remaining_eligible, decision_hint,
     business_date, contract_version)
  7. keep locks until caller transaction commits / rolls back
```

If multiple balance rows contribute:

```text
lock all eligible balance rows
in one deterministic order
```

#### 29.16.3.5 Finance mutation paths MUST acquire the same parent balance lock

Any Finance operation that REDUCES remaining eligible prepayment must first
serialize on:

```text
settlement_unapplied_balances.id FOR UPDATE
```

before re-reading remaining balance and writing its child effect.

At minimum verify / design this contract for:

```text
Balance Application
Unapplied-Balance Refund
any reversal / mutation that reduces the currently eligible prepayment amount
```

The child rows:

```text
balance_applications
financial_refunds
settlement_reversal_items
```

are economic evidence / effects. They are NOT the primary cross-domain lock
identity.

#### 29.16.3.6 R-SAL-15 serialization

```text
Sales Gate wins:
  Sales locks PREPAYMENT balance row(s) FOR UPDATE
  recomputes remaining eligible amount
  evaluates gate
  writes gated Sales mutation
  COMMIT
  Finance Application / Refund then acquires the balance lock
  and sees post-Sales state

Finance mutation wins:
  Finance locks PREPAYMENT balance row FOR UPDATE
  writes Application / Refund / relevant effect
  COMMIT
  Sales later acquires balance row lock
  recomputes lower remaining amount
  PASS / BLOCK uses new state
```

Forbidden:

```text
Sales PASS based on stale prepayment balance
while Finance concurrently consumes / refunds the same balance
```

#### 29.16.3.7 Exact bounded-extension classification against actual V22

Inspect current V22 implementation. The required lock contract is:

```text
Finance owned lock (settlement_unapplied_balances.id)
+ Sales locked-read adapter that returns the same evidence to caller
+ Finance mutation path that acquires the same lock before reducing balance
```

The bounded extension is the missing SALES-side locked-READ adapter contract.
Finance business semantics are unchanged. Finance canonical balance is unchanged.
Finance mutation paths that ALREADY acquire the parent balance lock are
unchanged. Only the SALES-side locked-READ adapter requires the extension.

If a V22 mutation path that reduces remaining eligible prepayment does not yet
acquire the parent balance lock, that path is also BOUNDED INTEGRATION
CONTRACT EXTENSION (Finance-owned change; same contract target).

#### 29.16.3.8 Frozen-domain contract summary (Repository-Evidence Final Closure; no conditional)

```text
CURRENT V22 DOES NOT YET PROVIDE
THE REQUIRED MYSQL PARENT-BALANCE ROW LOCK
ON ALL R-SAL-15 BALANCE-REDUCING PATHS.
```

| Component | Classification |
|---|---|
| Finance business semantics | **NO CHANGE** |
| Finance canonical balance (`settlement_unapplied_balances`) | **NO CHANGE** |
| Sales locked-read adapter for R-SAL-15 (`resolveEligiblePrepaymentForSalesGate`) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** |
| Finance mutation `applyUnappliedBalance` (acquires `settlement_unapplied_balances.id FOR UPDATE` before re-read/validation) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** |
| Finance mutation `createRefund` (acquires parent balance `FOR UPDATE` before capacity decision) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** |
| Finance mutation `reverseSettlementDocument` for PREPAYMENT / UNAPPLIED reduction (acquires parent balance `FOR UPDATE` before remaining / validation / reversal mutation) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** (only the PREPAYMENT / eligible-unapplied reduction semantics relevant to R-SAL-15; do NOT redesign unrelated reversal behavior) |
| Finance increasing-balance reversals (reverse Balance Application, reverse Refund) | **NO CHANGE** (they restore eligible prepayment; conservative temporary BLOCK on the next Sales risk-increasing evaluation is acceptable; they may use the same parent-lock helper if that simplifies Finance concurrency, but that is an implementation choice, not a Requirement change) |
| Source document linkage `payment_collections` | **NO CHANGE** (not the primary lock) |

The Finance Operations bounded extension is **ONE bounded Finance integration contract extension**, scoped to:

```text
A. Add transactional locked-read contract:
   resolveEligiblePrepaymentForSalesGate(...)
B. Locked-read accepts caller DB transaction/context.
C. It locks eligible PREPAYMENT settlement_unapplied_balances.id FOR UPDATE
   inside the same connection/transaction.
D. applyUnappliedBalance acquires the same parent lock before
   remaining-capacity validation.
E. createRefund acquires the same parent lock before
   remaining-capacity validation.
F. PREPAYMENT / UNAPPLIED balance-reducing reverseSettlementDocument
   acquires the same parent lock before remaining / validation /
   settlement_reversal_items mutation.
```

This is **NOT**:

```text
Finance semantic redesign
new Finance ledger
new balance truth
new recognition model
```

#### 29.16.4 Invariant: no double-count

```text
one advance / prepayment economic amount
must never satisfy the Prepayment Gate twice;
the canonical eligible amount + applied amount + refunded amount accounting
is Finance-owned; Sales reads once per gate evaluation via the adapter;
the same Finance-side canonical locks serialize Sales gate and Finance
refund / Application.
```

#### 29.16.5 R-SAL-15 transaction-context contract (Final Closure)

The application architecture required to safely share canonical Finance locks is:

```text
ONE DB TRANSACTION / ONE CONNECTION
shared by:
  1. Sales Prepayment Gate evaluation (lock sales_prepayment_requirements;
     call financeAdapter)
  2. financeAdapter locked-READ on canonical Finance balance set
     (settlement_unapplied_balances + payment_collections +
      financial_credit_adjustments) FOR UPDATE
  3. Sales gated mutation (e.g. write sales_prepayment_gate_results;
     possibly update Sales source fact inside the same gate result)
  4. COMMIT (atomic)
```

If the existing `financeAdapter` implementation starts its OWN transaction, the
Design requires the adapter to accept the CALLER's transaction / connection /
context instead of opening a new one. Concretely:

```text
financeAdapter.resolveEligiblePrepaymentForSalesGate(
  customer_id, business_date, gate_stage, sales_order_id,
  remaining_required_cents, lockMode = FOR_UPDATE,
  db_transaction_context              ← caller provides the same tx
) → returns the same evidence as today, but acquired under the caller's
   transaction; Sales gate and Sales gated mutation are atomic with the
   Finance locked-READ.

financeAdapter MUST NOT open a new db transaction independently when the
caller provides a transaction context.
```

If at the time of Implementation the existing `financeAdapter` is found to
require its own transaction (not callable within the caller's tx), the
bounded contract extension above includes the migration of the adapter to
"inherits caller transaction" semantics. No Finance semantic redesign.

The required outcome at runtime is exactly:

```text
one DB transaction
one connection
shared canonical Finance locks
Sales decision + gated Sales mutation
```

where the gated operation requires atomic protection.

### 29.17 Reservation Intent Design

#### 29.17.1 物理对象

`sales_reservation_intent` (NEW #57)：

```text
sales_reservation_intent:
  id, sales_order_id (FK), sales_order_item_id (FK), product_id, warehouse_id,
  intent_state ('NONE','REQUESTED','GRANTED','RELEASED','CONSUMED'),
  requested_at, released_at,
  planning_reservation_id (FK nullable to planning_reservations.id),
  consumer_event (e.g. 'DELIVERY_CONFIRMED', 'SO_CHANGED', 'CANCELLED')
```

Rules:
- `INVENTORY_LOCK`：Sales intent calls Inventory canonical lock adapter with SO-line source identity；truth stays in `inventory_locks`。
- `MANUAL_RESERVATION`：calls Planning reservation with `reservation_type=MANUAL`。
- `ON_HAND_RESERVATION`：calls Planning with strong on-hand semantics (`STRONG + ON_HAND`)；Sales 写 intent only。
- `EXPECTED_SUPPLY_RESERVATION`：calls Planning with expected-supply identity；当前 `EXPECTED` 返回无限容量且没有有限权威供给校验，故标记 `BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED`。扩展完成前该 mode fail closed，不能把无限占位当完成。
- Sales 读取 Planning canonical reservation / Inventory canonical lock；delivery confirmed 后通过 owner adapter consume/release，并只更新 intent evidence。

R-SAL-02: Sales Delivery × 2 against same reservation 已 covered by Planning's `assertStrongReservationAvailability`; Sales 引用 its result via the same identity.

Manual-to-adapter closure matrix：

| Manual behavior | Sales intent | Existing canonical adapter / truth | Gap | Decision |
|---|---|---|---|---|
| 未启用预留时库存锁定 | `INVENTORY_LOCK` with SO/line source | Inventory `inventory_locks`; lock/unlock owner API | current API requires Inventory permission and lacks a frozen Sales service contract | bounded adapter contract; Inventory remains writer |
| 手工预留 | `MANUAL_RESERVATION` | Planning `planning_reservations` type `MANUAL` | Sales source-linked adjust/consume contract not frozen | bounded adapter contract |
| 库存量预留 | `ON_HAND_RESERVATION` | Planning `STRONG + ON_HAND`; `assertStrongReservationAvailability` | consumption/release must be source-linked and atomic with delivery | bounded adapter contract |
| 预计量预留 | `EXPECTED_SUPPLY_RESERVATION` | Planning source type `EXPECTED` | current `physicalSupplyQuantity(EXPECTED)` is infinite; no authoritative finite capacity | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED**; fail closed until delivered |
| 调整/释放 | `ADJUST/RELEASE` event on existing intent | Planning release + Inventory unlock exist separately | no unified source-line adjust/consume contract | owner-specific adapter; deterministic lock order + audit |

The extension may add adapter behavior but may not add a Sales reservation balance, mutate frozen owner tables directly, or silently reinterpret existing Planning records.

#### 29.17.2 React to events

```text
SO Change       → lock source line; adjust/release and re-request delta through the same owner adapter
SO Cancel/Close → release remaining canonical lock/reservation
Delivery        → consume or release delivered portion; never exceed canonical grant
Return          → no automatic recreation; explicit policy may re-request against reopened obligation
Replacement     → new source-linked intent; does not reopen original intent silently
```

### 29.18 Service Item Sales Technical Design

#### 29.18.0 Frozen-Master boundary decision

This Domain closure adopts **Option A** from the Micro-Closure menu: Sales-owned commercial product extension table `product_commercial_classification` (NEW A-61). Sales does NOT silently add columns to frozen-Master-owned `products` table.

```text
Business owner      : Sales & Customer (commercial classification is a Sales business concept)
Physical owner      : Sales & Customer — a NEW Sales-owned table keyed by product_id
Read direction      : Sales reads `products` (Master identity) only as FK target
Write direction     : Sales writes ONLY to `product_commercial_classification`
                     NO writes to `products` table
Compatibility behavior: legacy reads may show an unclassified product; every new
                       commercial write requires an active A-61 row and never
                       infers sales-enabled/non-service from absence.
```

`product_commercial_classification` (NEW A-61):

```text
product_commercial_classification:
  id
  product_id (FK products.id, NOT NULL; UNIQUE per product)
  sales_enabled (bool NOT NULL; explicit provisioning, no missing-row default)
  sales_uom_code (FK uoms.code, nullable; NULL means canonical product/base UoM)
  pricing_uom_code (FK uoms.code, nullable)
  default_upper_delivery_tolerance_bps (INTEGER NOT NULL default 0; CHECK >= 0)
  default_lower_delivery_tolerance_bps (INTEGER NOT NULL default 0; CHECK 0..10000)
  service_classification (bool default false)
  service_kind (text nullable; bounded Sales code when service_classification=true)
  active (bool default true)
  created_at, updated_at, created_by, updated_by
```

此表是每个 product 一条 current Sales commercial classification；变更历史由 transactional `audit_logs` 保存，不同时维护 contradictory effective intervals。UoM identity 与 conversion truth 始终来自 Master-owned A-15 `uoms` / A-16 `product_uom_conversions`，本表只引用 Sales 使用/计价 UoM，不复制 conversion。两 UoM 不同时必须存在 canonical conversion，否则报价/订单解析 fail closed。tolerance 是 SC08 默认值，进入 SO line 后以 §29.8.3.1 snapshot 为执行真理；后续默认变化不得重解释已批准订单。

Missing/inactive contract：历史 row 可 read-only 显示 `(unclassified legacy)`；新 quotation、pricing、SO、reservation、DN/SD write 必须命中 active A-61 且 `sales_enabled=TRUE`。nullable Sales/Pricing UoM 只在 Master product 有 active canonical base UoM 时回退；缺 base UoM、缺 conversion 或缺 required tolerance defaults 均 BLOCK。缺 A-61 不得被解释为 `sales_enabled=TRUE` 或 `service_classification=FALSE`。

#### 29.18.1 物理对象

```text
service_fulfillments (NEW A-44):
  id, sales_order_id (FK), sales_order_item_id (FK),
  confirmation_state ('PENDING','CONFIRMED','CANCELLED'),
  confirmation_qty (REAL; remaining = SO line qty - SUM(confirmation_qty)),
  confirmation_at, confirmed_by,
  finance_recognition_id (FK nullable to Finance adapter result)
```

#### 29.18.2 决策点

Sales Delivery confirm path:

```text
if JOIN product_commercial_classification → service_classification = TRUE for this
   sales_order_item_id.product_id:
   if confirmation exists in service_fulfillments for that line: do inventory OUT 0
   else: BLOCK (cannot confirm; service not confirmed)
else:
   proceed with inventory OUT (current path)
```

#### 29.18.3 Frozen Master & Engineering boundary

```text
- products table is frozen-Master-owned; Sales does NOT add is_service column
- Sales-owned commercial classification in product_commercial_classification
- Read cross-domain contract:
    Sales uses products.id (FK only)
    NO write back to products
- Compatibility fallback: if Master later canonicalizes is_service at frozen
    product level, Sales switches to that contract path; this Domain closure does
    NOT block on that
```

### 29.19 Consignment Three-Truth Design

#### 29.19.0 Critical ownership correction (Micro-Closure)

The previous draft mapped Sales Consignment physical truth to `inventory V21 CUSTOMER-owned` position. This is **wrong** by §7 corrected semantics:

```text
WRONG:  physical ownership at consignment = CUSTOMER-owned
RIGHT:  physical ownership at consignment = seller/our organization (ENTERPRISE-owned
       in Inventory V21 position-key); until settlement / ownership-transfer event.
       CUSTOMER-owned position represents a DIFFERENT business meaning
       (entrusted stock / customer-owned material), NOT consignment.
```

Sales Consignment at Layer 2 (Inventory) MUST keep ownership = `owner_type='ENTERPRISE'` with location = customer / consignment site. Settlement / return triggers ownership transfer (Layout-2 → Layout-3 → finance).

#### 29.19.1 Three truth layers (corrected)

```text
Layer 1 : Sales & Customer commercial layer
         consignment_commercial_documents (NEW A-45)
         consignment_commercial_lines (NEW A-46)
         consignment_commodity_locations (NEW A-47; commercial location identity)
         consigned_quantity, settled_quantity, returned_quantity,
         remaining_consigned_quantity

Layer 2 : Inventory & Warehouse physical layer
         inventory_v21 canonical position (owner_type = ENTERPRISE during consignment;
                                            location = consignment_commodity_location FK or
                                            warehouse_id; no CUSTOMER-owner assignment
                                            for consignment)
         tracked_inventory_movements / inventory_v21 carrier types

Layer 3 : Finance Operations settlement layer
         account_receivables (settlement vs AR)
         financial_credit_adjustments (settlement reversal / return)
```

Ownership transition (canonical):

```text
Settlement (SALES decision):
  Layer 1 settlement confirmation → ownership at Layer 2 transfers:
    Layer 2 position.ENTERPRISE → Layer 2 position.CUSTOMER-owned OR out
    of layer 2 inventory (depending on settlement = sale or = return)
  Layer 3 AR adapter writes corresponding Finance economic effect.

Return (SALES decision):
  Layer 1 commercial return → Layer 2 inventory restore with same Layer 2 owner
  identity (ENTERPRISE). No second physical ledger.
```

#### 29.19.2 Chain (corrected)

```text
Consignment Instruction
  → Sales-only commercial document
  → Inventory physical transfer (canonical writer applyInventoryMutation;
     owner_type = ENTERPRISE; location = consignment_commodity_location)
  → Customer Settlement Confirmation (Sales business process; triggers Finance
     settlement + ownership transfer at Layer 2)
  → Consignment Commercial Return (Sales business process; Layer 2 inventory
     restore with ENTERPRISE ownership; Layer 3 refund)
```

#### 29.19.3 Capacity (corrected)

```text
Layer 1 capacity     = SUM(consignment_commercial_lines.consigned_quantity) -
                       SUM(consignment_commercial_lines.settled_quantity) -
                       SUM(consignment_commercial_lines.returned_quantity)
Layer 2 capacity     = Inventory ENTERPRISE-owned position at
                       consignment_commodity_location
                       (must equal Layer 1 capacity modulo settlement timing lag)
Layer 3 settlement    = sum(amount) in finance settlement subledger
                       (must equal Layer 1 settled total modulo refund lag)

R-SAL-20 / R-SAL-21: Layer 1 + Layer 3 must serialize on Layer 1
   remaining_consigned_capacity (canonical lock identity = consignment_commercial_lines.id).
   Layer 2 mutations triggered by Layer 1 must be audited cross-layer.
   Layer 2 owner always = ENTERPRISE during consignment; settlement → ownership
   transfer event.
```

#### 29.19.4 Frozen-domain integration contract status

```text
Inventory V21 (canonical_position): owner_type / owner_id attributes at position-key
  level ALREADY distinguish ENTERPRISE / CUSTOMER ownership.
  This Domain closure uses ENTERPRISE for consignment; no BOUNDED INTEGRATION
  CONTRACT EXTENSION is required FOR §29.19 given this interpretation.

IF Implementation phase discovers Inventory V21 cannot currently express
ENTERPRISE-owned at consignment_commodity_location, then file:

  FROZEN_DOMAIN_INTEGRATION_CONTRACT_EXTENSION_REQUIRED

and revise this §29.19 before Implementation begins. Do NOT silently redefine
CUSTOMER-owned as a proxy.
```

#### 29.19.5 Distinction from CUSTOMER-owned (entrusted material)

```text
Customs Customer-owned (entrusted material):
  meaning       = customer-owned stock physically at our warehouse
                 OUR organization may sell/use it only per entrusted rule
  Layer 2 owner = CUSTOMER (different from consignment!)
  Layer 1       = Inventory V21 canonical_CUSTOMER-owned_entrusted flow

Consignment:
  meaning       = seller-owned stock physically at customer / consignment site
  Layer 2 owner = ENTERPRISE (seller)
  Layer 1       = consignment_commercial_documents (this Design)

These are TWO DIFFERENT business meanings.
They MUST NOT share identifier.
```

### 29.20 Credit Architecture Overview

```text
Layer A: Credit Policy       (parameters + rules; effective-dated, with
                                lockable snapshot anchor)
Layer B: Credit Profile      (per-customer limit; rating; overdue policy;
                                effective-dated, lockable against mutations)
Layer C: Credit Exposure     (PURE_DERIVED; never a mutable second ledger;
                                consumed from Finance + Sales canonical facts)
Layer D: Credit Decision     (credit_check_result; with policy + profile
                                snapshot identity; R-SAL-24 + R-SAL-12)
Layer E: Credit Exception    (credit_special_approval; bounded authority;
                                §29.26; snapshot-locked)
Layer F: Credit Evaluation   (indicator / scheme / model / scoring sheet /
                                result / rating applied to profile)

Recognition-mode aware:
  Credit Exposure MUST consume the same Finance recognition-mode contracts
  as V22 §28.2 (DIRECT_BUSINESS_OPEN_ITEM, INVOICE_DRIVEN_OPEN_ITEM,
  PROVISIONAL_TO_FINANCIAL). Bucket transitions differ by mode.

Sales never writes:
  AR open items
  Advance Receipt / Unapplied
  Collection / Refund / Write-off
  Invoice / Treasury / Voucher / GL

Sales reads via:
  financeAdapter.resolveCreditExposureComponents(...) (§29.23)
  financeAdapter.resolveEligiblePrepaymentForSalesGate(...) (§29.16)
  financeAdapter.resolveARForCustomerSalesContext(...) (§29.23)
  assertStrongReservationAvailability (Planning, §29.17)
  applyInventoryMutation / postTrackedMovement (Inventory V21, on SD confirm)
  OQC adapter (M&Q V18, on SD confirm)
```

### 29.21 Credit Policy / Version / Effective Snapshot

Stable long-lived lock identity (Lock-Anchor Final Closure decision):

```text
credit_lock_anchors (REFINED; replaces A-62):
  id (PK; stable, never replaced)
  anchor_key           (NOT NULL, UNIQUE; canonical non-null uniqueness identity)
  anchor_type          (CHECK IN ('CREDIT_OBJECT','POLICY_SCOPE'))
  customer_id          (FK customers.id, nullable)
  salesperson_id         (FK salesperson_profiles.id, nullable)
  credit_object_type   (text, nullable; CREDIT_OBJECT anchor only)
  credit_object_id     (text, nullable; CREDIT_OBJECT anchor only)
  policy_scope_type    (text, nullable; POLICY_SCOPE anchor only;
                        e.g. 'GLOBAL', 'SALES_ORG', etc.)
  policy_scope_id      (text, nullable; POLICY_SCOPE anchor only)
  created_at
```

Why `anchor_key` is the canonical uniqueness (not nullable composite UNIQUE):

```text
- sales_lock_anchor (decomposed nullable columns) is permitted to have
  multiple rows where any nullable component is NULL under MySQL (and
  would also behave inconsistently under partial-index MySQL semantics
  vs SQLite).
- anchor_key is a NOT NULL deterministic string built at provisioning,
  e.g. for CREDIT_OBJECT:
      CUSTOMER:<customer-id>:SALESPERSON:<id-or-ALL>:OBJECT:<type>:<id>
  e.g. for POLICY_SCOPE:
      POLICY_SCOPE:<scope_type>:<scope_id-or-GLOBAL>
- UNIQUE(anchor_key) provides reliable cross-dialect (SQLite + MySQL) uniqueness.
- Decomposed nullable columns (customer_id / salesperson_id / policy_scope_*) are
  retained for FK + query convenience; they are NOT the sole uniqueness
  guarantee.

This anchor row is the PRIMARY long-lived lock identity for ALL Credit-control
serialization (R-SAL-12, R-SAL-24, R-SAL-13). It is created once per logical
scope and never replaced when profile / policy / snapshot versions change. New
profile effective rows or new policy snapshot rows are added beneath this
stable anchor.

#### 29.21.1 Anchor provisioning lifecycle (Final Closure)

Preferred rule:

```text
credit-lock anchor is provisioned
BEFORE any credit-consuming transaction can execute.
```

Provisioning paths:

```text
CREDIT_OBJECT anchor:
  - new customer: provisioned at customer creation OR on first
    credit-controlled transaction; creation is the SAME DB transaction
    as the first authorized credit-controlled read/write
  - new salesperson-specific credit object: provisioned at first
    credit-controlled transaction on that salesperson+customer combination
  - legacy customer backfill: deterministic bootstrap at domain cutover
    (one-time migration) over existing customers with credit_profile;
    creates anchor_key for each (customer, salesperson, credit_object_type,
    credit_object_id) tuple present in legacy credit_profile rows

POLICY_SCOPE anchor:
  - GLOBAL: provisioned at system install (or one-time bootstrap migration)
  - additional policy scope: provisioned at first policy scope creation
  - always present; if missing unexpectedly → FAIL CLOSED
```

Mandatory Credit Check must NEVER behave as:

```text
anchor missing
→ skip credit control
```

The rule is:

```text
anchor missing unexpectedly
→ FAIL CLOSED
until safely provisioned.
```

A first-use anchor creation INSIDE the first credit-controlled transaction
without a separate provisioning step is forbidden; it would create a
definition-vs-first-use race. The provisioning step is a distinct transaction
(or part of a system-init migration) that completes before any credit
consumption can race.

#### 29.21.2 Two anchor types — separation (Final Closure)

There are two different concurrency identities, kept separate:

```text
A. CREDIT_OBJECT anchor (one row per credit object):
   protects customer/salesperson credit capacity + profile-effective state
   + risk-increasing Sales transactions
   used by R-SAL-12 + Profile mutation + rating-result application

B. POLICY_SCOPE anchor (one row per policy scope):
   protects effective Credit Parameters + Credit Rules + scope-wide policy
   policy scope may be: GLOBAL, organization, sales org, other frozen
     Requirement-supported scope
   used by R-SAL-24 (policy/rule mutation path) + shared read of
     Credit Check (FOR SHARE under MySQL; same-tx serial under SQLite)
```

A single logical operation that legitimately touches BOTH (combined
mutation) acquires both anchors in a single deterministic order — see §29.25.3.

#### 29.21.3 Anchor first-use concurrency protocol (Final Two-Point Closure)

Two concurrent Credit Checks must not both observe:

```text
anchor does not yet exist
```

before either obtains the stable row lock. Therefore, every Credit-controlled
path begins with one canonical provisioning concept (name not design-finalizing):

```text
ensureCreditLockAnchor(anchor_type, anchor_key_components)
  → returns the canonical credit_lock_anchors.id FOR that anchor_key
```

Required semantics:

```text
1. derive deterministic non-null anchor_key from input components
   (CREDIT_OBJECT or POLICY_SCOPE)
2. attempt to provision the anchor (INSERT)
3. if INSERT succeeds:
     use the inserted row
4. if concurrent INSERT wins and this INSERT hits UNIQUE(anchor_key):
     re-read the already-created canonical row
     do NOT fail the business operation merely because another
     transaction provisioned it
5. acquire the canonical anchor row using the required lock mode
   (FOR UPDATE for the mutating path; FOR SHARE for the read-only path
   on POLICY_SCOPE; see §29.25.2-3)
6. only after the lock is acquired may Credit Check / mutation continue
```

The required invariant:

```text
one logical credit-control scope
→ exactly one canonical anchor
→ all contenders converge on that same row
```

Anchors are provisioned:

```text
CREDIT_OBJECT:
  - at customer creation (or first credit-controlled transaction)
  - via deterministic bootstrap migration for legacy customers
POLICY_SCOPE:
  - at system install (GLOBAL anchor)
  - via deterministic bootstrap migration for additional policy scopes
```

If an expected anchor is missing unexpectedly at the start of a mandatory
Credit Check / mutation, the only allowed behavior is:

```text
attempt safe deterministic provisioning once;
if it still cannot resolve the canonical row → FAIL CLOSED
```

Forbidden:

```text
anchor missing
→ continue without lock
```

#### 29.21.4 Cross-dialect provisioning semantics

```text
SQLite (BEGIN IMMEDIATE):
  anchor provisioning occurs inside BEGIN IMMEDIATE before the protected
  Credit decision / mutation proceeds. The serialized write discipline
  matches the rest of the Sales mutex model; first-write wins, follow-on
  reads see the canonical row.

MySQL 8 (deterministic anchor_key + UNIQUE):
  concurrent INSERTs of the same anchor_key collide on UNIQUE;
  the loser catches the duplicate-key error and re-reads the canonical row.
  The pattern is:
    INSERT credit_lock_anchors (...)  →  on UNIQUE violation → SELECT
    the canonical row by anchor_key (FOR UPDATE / FOR SHARE as
    appropriate).
  Do NOT continue the Credit decision without re-acquiring the
  canonical row's lock; that is the first-use race this protocol prevents.
```

The protocol is the first-line guard against first-use race; FOR UPDATE / FOR
SHARE on the canonical row is the second-line guard.

物理对象 (versioned records, NOT the lock anchor):

```text
credit_parameters (NEW A-48):
  id, code (UNIQUE), value_text, value_int, value_bool, value_date,
  effective_from, effective_to,
  status ('DRAFT','ACTIVE','INACTIVE'),
  created_at, created_by, superseded_by_id (nullable)
  PRIMARY KEY (code, effective_from)

credit_check_rules (NEW A-49):
  id, rule_code, business_stage ('SO_SUBMIT','SO_APPROVE','SALES_DELIVERY_CONFIRM'),
  scenario ('STANDARD','OVERRIDE_REQUEST','WARNING_ONLY','BLOCK'),
  check_timing ('BEFORE_WRITE','AFTER_WRITE_DEFERRED'),
  control_strength ('WARNING','BLOCK'),
  credit_item (enum; L | D | ...; referenced entity),
  recognition_mode (CHECK IN recognized V22 modes;
                    NULL means applies to all modes),
  effective_from, effective_to, status,
  result_payload_json
```

```text
credit_policy_snapshots (NEW A-50; DECISION EVIDENCE identity, NOT primary lock):
  id (PK)
  snapshot_fingerprint (UNIQUE; computed from parameter_set + rule_set
                         + profile_effective_state + business_date)
  captured_at (timestamp)
  captured_by (FK users.id)
  credit_control_anchor_id (FK A-62; the stable lock anchor)
  parameter_set_hash (text)
  rule_set_hash (text)
  profile_effective_state_hash (text)
  business_date (DATE)
  notes_json (text nullable)
```

Lock identity (Final Closure decision):

```text
PRIMARY long-lived lock identity:
  credit_control_anchor.id (NEW A-62)
  - one stable row per (customer, salesperson, credit_object_type, credit_object_id)
  - UNIQUE
  - never replaced when profile / policy / snapshot versions change
  - acquired FOR UPDATE at the start of every Credit Check + every Credit
    mutation path

DECISION EVIDENCE identity (separately retained):
  credit_policy_snapshots.id (NEW A-50)
  - append-only by fingerprint
  - bound to credit_check_result row + credit_special_approval row
  - historical evidence, not the lock anchor itself
```

Lock acquisition order (Final Closure):

```text
1. credit_control_anchor (stable) FOR UPDATE  ← PRIMARY LOCK
2. credit_profile (effective row at business_date) FOR UPDATE
3. credit_policy_snapshots (NEW or matched by fingerprint) FOR UPDATE
4. credit_check_rules (effective) FOR UPDATE
5. effective version reads (parameters, rules) under those locks
```

Lock identity and decision-evidence identity are distinct (§29.5):

```text
lock identity       = credit_control_anchor.id   (stable; used for FOR UPDATE)
decision evidence  = credit_policy_snapshots.id + snapshot_fingerprint
                       (append-only; bound to credit_check_result row)
```

R-SAL-24 invariant enforced (Final Closure):

```text
Inside one Credit Check evaluation, all parameters and rules MUST come from
ONE snapshot identity (one credit_policy_snapshots row).
After evaluation, snapshot_identity (credit_policy_snapshots.id + fingerprint)
binds to credit_check_result row.
Later policy mutation CANNOT reinterpret this decision's outcome; if
revalidation required by policy, a NEW credit_policy_snapshots row + NEW
credit_check_result must be produced.
```

### 29.22 Credit Profile

`credit_profile` (NEW A-51) + `credit_profile_ratings` (NEW A-52)：

```text
credit_profile:
  id, customer_id (FK), salesperson_id (FK salesperson_profiles.id nullable),
  credit_object_type, credit_object_id,
  credit_limit_cents (BIGINT NULL = unbounded),
  initial_state (enum), status ('ACTIVE','SUSPENDED','CLOSED'),
  rating_grade, rating_effective_from, rating_effective_to,
  rule_id (FK credit_check_rules.id),
  effective_from, effective_to,
  created_at, created_by,
  PRIMARY KEY (customer_id, salesperson_id, credit_object_type, credit_object_id, effective_from)
  FK: implicit logical reference to credit_control_anchor.id (A-62) for the
     same (customer_id, salesperson_id, credit_object_type, credit_object_id)
```

`credit_profile_ratings`:
  id, credit_profile_id (FK), evaluation_result_id (FK credit_evaluation_result.id),
  applied_at, applied_by,
  superseded_at (nullable)

Effective-dating via `effective_from / effective_to`. SO Check at SO_SUBMIT reads effective profile at business_date; the effective row is locked FOR UPDATE during evaluation. Profile mutation FOR UPDATE acquires the same stable `credit_control_anchor.id` (A-62) lock before new profile rows may take effect, until in-flight checks complete.

Customer identity (Master & Engineering) remains in the composite primary key (`customer_id`); Sales extends.
Salesperson identity uses A-64 `salesperson_profiles.id`; optional A-64 `user_id` is never substituted as the Credit salesperson object.

#### 29.22.1 Credit missing-profile compatibility (fail-closed rule)

```text
Credit Management disabled              → no credit enforcement (gate bypassed)
Customer / scenario exempt by rule      → no credit enforcement (explicit rule)
Credit Management enabled
  AND mandatory rule applies            → credit_profile required; if missing/invalid
                                          → FAIL CLOSED (config / credit-control BLOCK)
```

A missing required Credit Profile MUST never silently turn mandatory Credit Control off. Legacy compatibility cannot weaken mandatory BLOCK fail-closed.

Customer-readable display for missing-profile cases: `Credit profile required` + admin action item; never PASS without evaluation.

### 29.23 Credit Occupancy / Exposure Model

#### 29.23.1 设计：PURE_DERIVED 投影 (not persisted mutable)

```text
Credit exposure = DERIVED computation over canonical facts.
No physical `credit_exposure` table.

Source canonical facts:
  Sales: sales_orders.approved exposure (total_cents of APPROVED SO within exposure window)
  Sales: sales_deliveries.delivered-not-yet-settled exposure
  Finance: account_receivables.open amount
  Finance: settlement_unapplied_balances (eligible advance offsets)
  Finance: financial_credit_adjustments (returns / discounts / write-offs)
  Finance: payment_collections (collection reductions)

Equation (transition-aware):

E = SUM(approved SO commitment, age <= window or until delivered)
  + SUM(delivered-not-settled)
  + SUM(AR open by source SO item)
  + SUM(overdue AR)
  - SUM(eligible advance / unapplied applied)
  - SUM(returns / credits applied)
  - SUM(collections applied)
  - SUM(write-offs)
```

#### 29.23.2 Recognition-mode-aware bucket transition (Final Closure exact matrix)

For the same economic amount X (or any sub-amount), the bucket transitions are
mutually exclusive. The same amount X is in exactly one of A / B / C / P / E /
D-overdue (where D is a subset of C) at any instant.

```text
Mode 1: DIRECT_BUSINESS_OPEN_ITEM (LEGACY_DIRECT semantic)
  Before delivery of X:
    A (approved SO commitment) = X
    B (delivered-not-settled)  = 0
    C (final AR open)         = 0
    P (provisional)           = 0
  On Sales Delivery confirm, Finance creates final AR in the canonical
  Sales+Finance transition. For quantity/value X committed in the SO:
    A -= X
    C += X
  (atomic / logically as one transition; no separately additive B for the
  same portion after final AR exists. Any internal transient calculation
  is NEVER separately countable exposure.)

Mode 2: INVOICE_DRIVEN_OPEN_ITEM (SEPARATE semantic)
  Before delivery of X:
    A = X; B = C = P = 0
  At Sales Delivery confirm:
    A -= X
    B += X              ← operational evidence; no AR yet
  At Sales Invoice post:
    B -= X
    C += X              ← final AR open

Mode 3: PROVISIONAL_TO_FINANCIAL (AUTO_BILL semantic)
  Before delivery of X:
    A = X; B = C = P = 0
  At source / delivery recognition:
    A -= X
    P += X              ← provisional exposure
  At provisional → final conversion (Sales Invoice / final receipt post):
    P -= X
    C += X              ← final AR open
  No ordinary settlement against P; no P + C coexistence for same X.
```

Partial-quantity / partial-value transitions example (per task §7):

```text
SO value = 100

deliver 40  (Mode 2):
  A = 60
  B = 40
  C = 0

Invoice 25:
  A = 60
  B = 15
  C = 25

Collection 10:
  A = 60
  B = 15
  C = 15
```

Mode 1 / Mode 3 follow the same partial arithmetic over the corresponding
buckets. The exact exposure formula must make it impossible for one economic
amount to occupy two incompatible stages simultaneously.

Overdue (D): NOT a separate additive exposure bucket. D is a subset of C
(AR open) per the V22 frozen overdue / provisioning_status semantic.
Therefore:

  used credit
  must NOT add:  C + overdue(C)
  (unless the frozen Requirement explicitly defines an extra risk multiplier,
   which it did not)
```

#### 29.23.3 Forbidden double-count (recognition-mode aware)

```text
For mode 1:  SO commitment + delivered-not-settled + AR open CANNOT count the
            same economic amount twice; Bucket A reduces as B grows; B reduces
            as C grows; C reduces as E grows.
For mode 2:  A → B is non-AR; B → C is AR at invoice post; no other overlap.
For mode 3:  A0 → P (Provisional) at receipt; P → C at final; A0 does NOT
            become C directly; P is NOT in approved SO commitment E.
            Provisional + AR open cannot both count.
required invariant:
  one economic customer exposure
  must occupy exactly the intended credit-risk bucket(s)
  under the active recognition mode
```

#### 29.23.4 Eligibility & R-SAL-15 (Prepayment Gate)

The Prepayment Gate reads ONE canonical Finance-side eligible prepayment value via `financeAdapter.resolveEligiblePrepaymentForSalesGate(...)` (see §29.16); no SUM of disjoint balance rows. The eligible amount is per (customer, business_date, gate_stage, sales_order_id, remaining_required_cents). Sales records the gate decision in `sales_prepayment_gate_results` with the source balance identities captured (audit trace).

#### 29.23.5 Sales cannot reconstruct AR truth

```text
Sales MUST NOT:
  reconstruct AR truth independently
  reinterpret provisional/final Finance recognition
  mutate Finance open items

Sales MUST use:
  frozen Finance recognition / source adapter or canonical query contract;
  if a new read adapter needed, define the integration contract (NOT a second
  Sales ledger).
```

#### 29.23.6 Forbidden

```text
no second mutable Sales/Finance credit exposure ledger
no SUM that silently double-counts SO + delivered + AR + overdue (per mode)
no static copy of canonical figures into Sales tables
no single static pre-computed credit_exposure row anywhere
```

#### 29.23.7 Amount-delta clarification (Final Closure)

`X` in §29.23.2 transitions means **matched economic credit-risk amount** (matched
at Sales side), not blindly the SO line quantity. If the downstream final AR differs
from the upstream commercial exposure due to legitimate:

```text
tax assumption → invoice tax truth
rounding (cents)
bounded invoice adjustment
```

then the transition is conceptually:

```text
release upstream commercial exposure amount U (from Sales side)
add canonical downstream exposure amount F (from Finance AR)
```

rather than assuming `U == F`. The delta is `F - U`; it is explicit, non-duplicative,
and reconciled by canonical Finance AR truth. Still never count the same economic
component in two incompatible stages simultaneously. Do NOT redesign Finance
recognition; this only reconciles the Sales-side exposure component with the
Finance-side AR component per bucket transition.

### 29.24 Credit Projection / Cache Decision

#### 29.24.1 Decision: PURE_DERIVED (default baseline)

```text
chosen: PURE_DERIVED
evidence: frozen §33 Finance V22 + V21 Inventory + V19 Planning canonical
         provide all source facts; query-layer projection is sufficient for
         current scale.

implication:
  R-SAL-23 = structurally NON_MATERIALIZED (no rebuild cache to protect).
  R-SAL-23 remains in this Requirement set as conditional for transparency but
  does NOT need an executable Materialize gate under this choice.
```

#### 29.24.2 If a future scope requires persisted cache

```text
would require: source facts remain canonical;
              rebuild deterministic;
              CHECK reconciliation available;
              drift detectable;
              rebuild must never overwrite newer exposure state
              (the one economic amount invariant);
              R-SAL-23 becomes mandatory executable concurrency acceptance.
```

Decision: stay PURE_DERIVED for this baseline; if future Implementation evidence changes, re-open Requirement.

### 29.25 Credit Check Technical Design

`evaluateCredit(input)`:

```text
INPUT:
  customer_id
  salesperson_id (nullable)
  sales_order_id / sales_delivery_id (which stage)
  business_date
  proposed_exposure_delta_cents
  recognition_mode                       (one of V22 §28.2 modes; defaulted
                                          from sales_delivery.billing_mode or
                                          financeAdapter.active_mode)

PROCESS (canonical lock order; see §29.43; Lock-Anchor Final Closure):
  0a. acquire POLICY_SCOPE anchor (NEW A-62 row WHERE anchor_type='POLICY_SCOPE')
      FOR SHARE  (MySQL; read of shared policy) — multiple Credit Checks may
                share-policy-read concurrently
      [SQLite: BEGIN IMMEDIATE serializes writers; same effective result]
  0b. acquire CREDIT_OBJECT anchor (NEW A-62 row WHERE anchor_type='CREDIT_OBJECT'
      AND anchor_key matches the credit object) FOR UPDATE
  1. read financeAdapter.resolveCreditExposureComponents(...) including:
     - current approved SO commitment (per mode)
     - delivered-not-settled (per mode)
     - Finance AR open amount (per mode)
     - eligible prepayment via
       financeAdapter.resolveEligiblePrepaymentForSalesGate(..., lockMode=FOR_UPDATE)
       (one canonical Finance value + same-tx shared lock; see §29.16)
     - already applied via earlier gates / refunds / write-offs
     (every component carries its source identity for audit)
  2. acquire remaining locks in canonical order:
     a. credit_profile effective row FOR UPDATE
     b. credit_policy_snapshots FOR UPDATE (create or select by fingerprint)
     c. credit_check_rules effective rows FOR UPDATE
  3. read effective policy snapshot identity
     (= credit_policy_snapshots.snapshot_fingerprint)
  4. compute current exposure E per §29.23.2 (recognition-mode aware)
  5. proposed_total = E + proposed_exposure_delta_cents
     (also accounting for any offset consumed by this Prepayment Gate application)
  6. available_buffer = credit_limit - E (effective profile)
  7. decision:
     if rule STRENGTH = BLOCK and proposed_total > credit_limit:
       decision = 'BLOCK'  (mandatory; backend fail-closed)
     elif rule STRENGTH = WARNING and ... :
       decision = 'WARNING'
     if special_approval_available and approved_authority(scope):
       decision = 'SPECIAL_APPROVAL_REQUIRED'
     else (no configured rule / no matching):
       decision = 'PASS'
  8. capture credit_policy_snapshots.id + fingerprint in result record
     (decision evidence; NOT the primary lock — see §29.21)
  9. write credit_check_result (NEW A-54) in same tx (commit-or-rollback)
 10. write audit with policy_snapshot_fingerprint + business_date
 11. COMMIT (releases credit_control_anchor lock)
```

#### 29.25.1 credit_check_result (NEW A-54)

```text
credit_check_result:
  id (PK),
  sales_order_id (FK), sales_delivery_id (FK nullable),
  stage, proposed_delta_cents,
  credit_control_anchor_id (FK A-62; the stable lock anchor),
  credit_policy_snapshots_id (FK; DECISION EVIDENCE identity),
  policy_snapshot_fingerprint (text),
  profile_effective_state_hash (text),
  recognition_mode (text),
  decision ('PASS','WARNING','BLOCK','SPECIAL_APPROVAL_REQUIRED'),
  reason_codes_json,
  component_breakdown_json (per bucket, recognition-mode aware),
  eligible_prepayment_source_identity (text),
  special_approval_id (FK nullable; must equal the credit_special_approval.id
                        bound on success),
  evaluated_at, evaluated_by
```

Decision artifact; NOT a second exposure ledger. Source-of-truth for `Special Approval`
must point back at the exact `(credit_policy_snapshots_id, fingerprint)` pair that
produced the `SPECIAL_APPROVAL_REQUIRED` decision.

#### 29.25.2 R-SAL-12 anchor (PURE_DERIVED exposure; credit consumption serialization)

Credit Exposure has no persisted mutable row; therefore R-SAL-12 must serialize on a
Sales-owned ANCHOR — not on a nonexistent exposure balance row.

```text
PRIMARY long-lived lock identity for R-SAL-12 =
    credit_lock_anchors.id  (REFINED, replaces A-62;
                              anchor_type = 'CREDIT_OBJECT';
                              UNIQUE on anchor_key)
    FOR UPDATE on the credit-object anchor row
```

For two concurrent risk-increasing Sales transactions (e.g. two SO submits, two SD
confirms, or SO submit + SD confirm with overlapping risk-increasing delta), both must
acquire the credit-object anchor row FOR UPDATE in the SAME canonical order; whichever
wins blocks the other at the anchor row lock. The blocked transaction reads the updated
state (which now includes the winner's committed Sales source fact) and re-evaluates
against it.

```text
risk-increasing transaction A  vs  risk-increasing transaction B
  → serialize on credit_lock_anchors.id
    (anchor_type='CREDIT_OBJECT', anchor_key matches this credit object)
    FOR UPDATE
  → POLICY_SCOPE anchor FOR SHARE already acquired (allows multiple
    concurrent policy reads during this credit check)
  → credit_profile effective row + credit_policy_snapshots + rules
    are acquired beneath the anchor
  → one wins; the loser re-reads and re-evaluates
  → combined committing commitments ≤ available credit capacity
```

The decision does NOT lock any non-existent Credit Exposure balance row; it uses
the stable credit-object anchor as the serialization identity.

Risk-releasing Finance event
(collection, refund, write-off, overdue transition)
  → Finance-owned; visible to Sales via Finance canonical source adapter
  → if visibility lag → conservative temporary BLOCK on the next Sales
    risk-increasing evaluation is acceptable (mandatory BLOCK fail-closed)
  → never causes over-credit approval

Distinction between risk-increasing and risk-releasing events is essential. Sales-owned
anchors do not require frozen Finance mutations to acquire new locks; only Sales-owned
readers acquire them.

#### 29.25.3 R-SAL-24 (coherent effective policy snapshot; two anchor types; lock order)

R-SAL-24 protects two independent mutation classes against a Credit Check; the final
model distinguishes them.

```text
CREDIT_CHECK path (consumer of policy):
  1. acquire POLICY_SCOPE anchor FOR SHARE  (multiple checks may share
                                              policy reads concurrently;
                                              FOR SHARE under MySQL; same-tx
                                              serial under SQLite BEGIN IMMEDIATE)
  2. acquire CREDIT_OBJECT anchor FOR UPDATE
  3. resolve effective: parameters / rules / profile / limit / overdue / rating
  4. construct one immutable decision snapshot (credit_policy_snapshots insert
     or select by fingerprint; record fingerprint + anchor identity)
  5. evaluate decision; bind to credit_check_result
  6. commit

POLICY / RULE MUTATION path:
  1. acquire POLICY_SCOPE anchor FOR UPDATE  (exclusive on policy scope)
  2. apply new effective version(s) of credit_parameters / credit_check_rules
  3. effective rows that change in the window may produce a new
     credit_policy_snapshots fingerprint on subsequent Credit Check
  4. commit

PROFILE / LIMIT / RATING MUTATION path:
  1. acquire CREDIT_OBJECT anchor FOR UPDATE
  2. apply new effective version of credit_profile (or rating_result application)
  3. commit

COMBINED POLICY + PROFILE MUTATION (one operation legitimately touches both):
  1. acquire POLICY_SCOPE anchor FOR UPDATE  (FIRST)
  2. acquire CREDIT_OBJECT anchor FOR UPDATE  (SECOND)
  Never reverse this order in another mutation path.
```

Immutable / append-only semantic for snapshots (Final Closure clarification):

```text
credit_policy_snapshots is IMMUTABLE / APPEND-ONLY.

A policy / profile mutation:
  1. acquires the appropriate anchor FOR UPDATE (POLICY_SCOPE and / or
     CREDIT_OBJECT)
  2. changes the EFFECTIVE source records (credit_parameters / credit_check_rules
     / credit_profile / rating application) under the lock
  3. commits; the existing credit_policy_snapshots rows are NOT modified
  4. a subsequent Credit Check observes a DIFFERENT fingerprint and either
     picks the existing matching row (fingerprint unchanged) or inserts a NEW
     credit_policy_snapshots row (fingerprint changed)

No mutation ever "updates" an existing credit_policy_snapshots row.
The row, once written, is historical evidence — append-only by definition.
```

```text
Credit Check path
  → acquire POLICY_SCOPE anchor FOR SHARE
  → acquire CREDIT_OBJECT anchor FOR UPDATE
  → create or select credit_policy_snapshots row by fingerprint
    (FOR UPDATE on the existing row if fingerprint matches; new INSERT
     if fingerprint does not match any existing row)
  → read effective parameters / rules / profile / limit / overdue / rating
  → evaluate decision; bind decision to credit_check_result row
  → commit

Allowed outcome per single Credit Check:
  complete OLD snapshot
  or
  complete NEW snapshot

Forbidden:
  mixed OLD/NEW components

`credit_policy_snapshots.id` is the decision evidence / version identity;
it is NOT the primary stable serialization anchor (that is
credit_lock_anchors.id where anchor_type='CREDIT_OBJECT' or 'POLICY_SCOPE').
```

`credit_lock_anchors.id` is the SERIALIZATION identity (lock).
`credit_policy_snapshots.id` is the DECISION EVIDENCE identity (append-only history).
The two are distinct; do NOT conflate.

#### 29.25.4 Special Approval snapshot identity (preserved)

```text
Credit Special Approval row carries:
  source_credit_check_result_id (FK credit_check_result.id; UNIQUE)
  source_credit_policy_snapshots_id (FK; same snapshot row as the check)
  source_policy_snapshot_fingerprint (text)
  source_profile_effective_state_hash (text)
```

The Special Approval row is bound to the exact `(credit_policy_snapshots.id,
fingerprint)` pair that produced the `SPECIAL_APPROVAL_REQUIRED` decision. The
stable `credit_control_anchor.id` is for SERIALIZATION only; the snapshot is for
HISTORICAL EVIDENCE only. They are distinct identities; do NOT conflate.

### 29.26 Credit Special Approval Technical Design

`credit_special_approval` (NEW A-53)：

```text
credit_special_approval:
  id, source_credit_check_result_id (FK credit_check_result.id; UNIQUE),
  source_sales_order_id (FK),
  source_credit_policy_snapshots_id (FK; same snapshot row as the check; NOT NULL),
  source_policy_snapshot_fingerprint, source_profile_effective_state_hash,
  reason, requested_override_cents, requested_expiry_business_date,
  requested_ceiling_cents,
  authority_ceiling_cents (snapshot from user.role at request time),
  decision ('PENDING','APPROVED','REJECTED'),
  approved_override_cents, approved_ceiling_cents, approved_expiry_business_date,
  scope ('ONE_TIME','TIME_BOUNDED','OBJECT_BOUNDED'),
  approver_id, decided_at,
  audit_id
  PRIMARY KEY (source_credit_check_result_id)
```

Constraints:
- approved_override_cents ≤ requested_override_cents ≤ authority_ceiling_cents at request time
- approved_expiry ≥ business_date; not in the past
- snapshot identity MUST match source_credit_check_result's snapshot identity
  (matched via source_credit_policy_snapshots_id + fingerprint)
- A later policy mutation CANNOT reinterpret this approval; if revalidation required by policy (e.g. rating downgrade), it must produce a NEW credit_check_result and NEW approval request — the old approval is read-only history

R-SAL-13 + R-SAL-24 interplay:
- Special Approval consumes R-SAL-13 with the `credit_special_approval` row lock
  (UNIQUE on source_credit_check_result_id) + the snapshot row lock
- The check that produced SPECIAL_APPROVAL_REQUIRED was bound to one snapshot
  (source_credit_policy_snapshots_id)
- The approval row carries the same snapshot identity
- A different credit check (different snapshot, e.g. next SO) gets a new approval flow

### 29.27 Credit Evaluation

`credit_evaluation_indicator` (NEW #47) + `credit_evaluation_scheme` (NEW #48) + `credit_evaluation_model` (NEW #49) + `credit_evaluation_scoring_sheet` (NEW #50) + `credit_evaluation_result` (NEW #51)。

Per-evaluator bounded. NO external bureau / AI / ML / complex corporate-risk analytics.

```text
credit_evaluation_indicator:
  id, code (UNIQUE), kind ('QUALITATIVE'|'QUANTITATIVE'),
  description, max_score (REAL)

credit_evaluation_scheme:
  id, code (UNIQUE), name, rating_grades_json

credit_evaluation_model:
  id, scheme_id (FK), name,
  applicable_from, applicable_to,
  indicator_weights_json,  -- [{indicator_id, weight}]
  scoring_sheet_template_json

credit_evaluation_scoring_sheet:
  id, model_id (FK), evaluator_id (FK users.id),
  customer_id (FK), profile_snapshot_identity,
  sheet_data_json,
  submitted_at, finalized_at

credit_evaluation_result:
  id, sheet_id (FK), scheme_id (FK),
  total_score, rating_grade,
  applied_at, applied_by,
  applied_to_profile_id (FK credit_profile.id)
  -- can apply update via credit_profile_ratings
```

Bounded multi-scorer via SC106: aggregation restricted to within one scoring_sheet instance with multiple evaluator entries; no global open-scorer pool.

### 29.28 Credit Recalculation

`credit_recalculation_history` (NEW #52)：

```text
credit_recalculation_history:
  id, kind ('CHECK_ONLY','DETERMINISTIC_REBUILD'),
  triggered_by, triggered_at,
  source_snapshot_window, scope_filter_json,
  result_summary, duration_ms,
  inconsistency_count, drift_detected
```

This history table is ONLY for human audit trail of when reconciliations ran; it does NOT store any derived/exposure data that would create a second ledger.

R-SAL-23 conditional semantics preserved (see §29.24). Pure CHECK-only is default; deterministic rebuild NOT exercised against any materialized cache in this baseline.

### 29.29 Credit Query / Exception History (DERIVED)

Layer 4 read-side:

```text
credit_query_snapshot -- DERIVED view only; not a table
exception_history -- READ from credit_check_result + credit_special_approval
                     joined with source SO / SD
```

No physical table for these results; constructed by query at the time of access.

### 29.30 Source / Capacity Model (canonical edge table, Micro-Closure corrected)

For every edge: source identity / target identity / original capacity / executed or converted / reversed or cancelled / remaining / canonical lock anchor.
For non-quantity edges: `capacity = N/A`.

| # | Source | Target | Source identity | Source line | Original capacity | Executed / Converted | Reversed / Cancelled | Remaining | Canonical lock anchor |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Quotation line | Sales Order line | sales_quotation_lines.id | sales_order_items.id | sales_quotation_lines.quantity | sales_quotation_conversions.converted_qty | (R-SAL-06; none today) | quantity − SUM(converted_qty) | sales_quotation_lines.id (R-SAL-06) |
| 2 | Sales Order line | Delivery Notice line | sales_order_items.id | sales_order_items.id | sales_order_items.quantity | SUM(delivery_notice_lines.scheduled_qty) | delivery_notice_lines.cancelled_notified_qty | SO quantity − SUM(scheduled) | sales_order_items.id (R-SAL-16) |
| 3 | Delivery Notice line | Sales Delivery line | delivery_notice_lines.id | sales_delivery_items.delivery_notice_line_id (= DN line id) | scheduled_qty − notified_qty | sales_delivery_items.delivery_notice_line → SD item qty | (none) | scheduled − confirmed − claimed | delivery_notice_lines.id (R-SAL-17) |
| 4 | Sales Delivery line | Delivery-backed Return line | sales_delivery_items.id (with `commercial_source_marker = 'DELIVERY_BACKED'`) | return_order_items.delivery_item_id | sales_delivery_items.quantity | SUM(return_order_items.qty where delivery_item_id = this SD item) | (per return reversal) | SD item qty − returned qty | sales_delivery_items.id (R-SAL-03) |
| 5 | Sales Order line | Order-backed Return line | sales_order_items.id (with `commercial_source_marker = 'ORDER_BACKED'` and NO corresponding SD for that line) | return_order_items.sales_order_item_id | sales_order_items.quantity | SUM(return_order_items.qty where so_item_id = this line) | (per return reversal) | SO line qty − returned qty | sales_order_items.id (R-SAL-18 / Capacity edge) |
| 6 | No-source Return | (explicit NO_SOURCE capacity policy) | n/a | return_order_items.id where `commercial_source_marker='NO_SOURCE'` | capacity = N/A (consignment-inventory economics not derived from any SO/SD/return aggregate) | n/a | n/a | n/a | n/a |
| 7 | Return line | Replacement obligation | return_order_items.id | sales_order_replacement_lines.source_return_item_id | return_order_items.qty (return_qty) | sales_order_replacement_lines.replacement_quantity + sales_replacement_fulfillments.fulfilled_qty | (per cancel/return) | replacement quantity − fulfilled | return_order_items.id (R-SAL-10) + sales_order_replacement_lines.id |
| 8 | Sales Order / line | Sales Order Change | sales_orders.id + sales_order_items.id | sales_order_changes.id + sales_order_change_lines.id | capacity = N/A (not a quantity edge; evidence exists for both direct/document paths) | canonical apply uses line op ∈ {ADD,MODIFY,CANCEL} on remaining obligation | REJECTED/CANCELLED evidence | remaining-not-yet-executed after APPLIED version | sales_order_changes.id + sales_order_items.id (R-SAL-07 / 08 / 18) |
| 9 | Sales Order line | Reservation Intent | sales_order_items.id | sales_reservation_intent.id | sales_order_items.quantity | requested_qty (intent) + Planning canonical consumed | released / canceled | qty − Planning consumed (canonical in Planning) | sales_order_items.id (consume-side) + sales_reservation_intent.id (intent-side) |
| 10 | Sales Order | Prepayment Gate evaluation | sales_orders.id | sales_prepayment_requirements.id | required_prepayment_cents | eligible_prepayment_cents (per gate evaluation; from Finance adapter) | (none) | required − applied (cumulative gate-eligible) | **V22 Finance parent balance lock**: `settlement_unapplied_balances.id` (balance_type='PREPAYMENT') FOR UPDATE inside SAME connection/transaction via financeAdapter (R-SAL-15 primary lock; per §29.16.3.1); sales_prepayment_requirements.id + sales_prepayment_gate_results.snapshot_key as Sales-owned record/audit identity |
| 11 | SO service line | Service Fulfillment | sales_order_items.id (with `product_commercial_classification.service_classification = TRUE`) | service_fulfillments.sales_order_item_id | sales_order_items.quantity | service_fulfillments.confirmation_qty | (per cancel) | qty − confirmed | sales_order_items.id (capacity anchor) + service_fulfillments.id (R-SAL-22) |
| 12 | Consignment line | Settlement | consignment_commercial_lines.id (where `commercial_source_marker` indicates commercial settlement path) | (settlement row in finance canonical AR) | consigned_quantity | settled qty (per settlement event) | (per settlement reversal) | consigned − settled | consignment_commercial_lines.id (R-SAL-20) |
| 13 | Consignment line | Consignment Return | consignment_commercial_lines.id | (return row in finance canonical refund) | consigned_quantity | returned qty | (per return reversal) | consigned − settled − returned | consignment_commercial_lines.id (R-SAL-21) |
| 14 | Sales / Finance canonical facts | Credit Exposure (DERIVED) | sales_orders / sales_deliveries / Finance canonical rows | sales_orders / sales_deliveries / account_receivables etc. | proposed_exposure_delta (input) | credit_check_result.decision consumed | (none; DERIVED) | E = computed per §29.23 (PURE_DERIVED) | **credit_control_anchor.id** (NEW A-62; PRIMARY long-lived lock); secondary: credit_profile effective row + credit_policy_snapshots (R-SAL-12 / 24, see §29.25.2-3) |
| 15 | Credit Check Result | Credit Special Approval | credit_check_result.id (where decision = 'SPECIAL_APPROVAL_REQUIRED') | credit_special_approval.source_credit_check_result_id | capacity = N/A (not a quantity edge; approval is a bounded exception request) | approved_override_cents (per decision) | REJECTED approval | n/a (bounded authority check, not running total) | credit_special_approval.id (UNIQUE on source_credit_check_result_id) + credit_policy_snapshots.id (R-SAL-13) |

#### 29.30.1 Direction audit (sources of edge)

```text
Quotation → SO  ✓  source: quotation line; target: SO line
SO → Delivery Notice  ✓  source: SO line; target: DN line
Delivery Notice → SD  ✓  source: DN line; target: SD line
SD → Return (DELIVERY_BACKED)  ✓  source: SD line; target: delivery_item_id on return line
SO → Return (ORDER_BACKED)  ✓  source: SO line; target: so_item_id on return line
NO_SOURCE Return  ✓  source: explicit NO_SOURCE marker; no upstream capacity edge
Return → Replacement  ✓  source: return line; target: replacement line
SO → SO Change  ✓  source: SO; target: append-only change evidence for direct/document path (NOT vice-versa)
SO → Reservation Intent  ✓  source: SO line; target: intent row
SO → Prepayment Gate  ✓  source: SO; target: gate evaluation
SO service line → Service Fulfillment  ✓  source: SO line; target: fulfillment
Consignment line → Settlement / Return  ✓  source: commercial line; target: settlement/return financial row
Sales / Finance facts → Credit Exposure  ✓  source: canonical facts; target: DERIVED
Credit Check Result → Credit Special Approval  ✓  source: check result; target: approval
```

No edge direction is reversed in this table.

### 29.31 API Inventory

> 每个 API 在 design 上明确 method / path / purpose / permission / identity / source-cap / idempotency / tx。本节不写 handler 代码。

#### 29.31.1 Quotation API surface

```text
GET    /api/sales-quotations              list (status filter)
GET    /api/sales-quotations/:id          detail (with lines + remaining)
POST   /api/sales-quotations              create (DRAFT)
PATCH  /api/sales-quotations/:id          mutate (DRAFT only)
POST   /api/sales-quotations/:id/effective-publish  DRAFT→EFFECTIVE (if approval policy)
POST   /api/sales-quotations/:id/cancel   DRAFT/EFFECTIVE→CLOSED (with reason)
POST   /api/sales-quotations/:id/convert-to-so
       body: {line_selections, qty_per_line}
       converts to SO via canonical sales_order_canonical_writer
       idempotency: (idempotency-key) → lock + check + insert conversions
```

#### 29.31.2 Sales Pricing API surface

```text
GET    /api/sales-price-lists                list
POST   /api/sales-price-lists                create DRAFT
GET    /api/sales-price-lists/:id            detail + entries + versions
PATCH  /api/sales-price-lists/:id            update DRAFT header only
DELETE /api/sales-price-lists/:id            delete never-activated DRAFT only
POST   /api/sales-price-lists/:id/entries    create DRAFT entry + version 1
PATCH  /api/sales-price-lists/:id/entries/:entryId
                                               update DRAFT non-key range fields only;
                                               identity change = delete/recreate
POST   /api/sales-price-lists/:id/entries/:entryId/versions
                                               append immutable DRAFT price version
DELETE /api/sales-price-lists/:id/entries/:entryId
                                               delete DRAFT entry only
POST   /api/sales-price-lists/:id/activate   ACTIVATE (frozen effective window)
POST   /api/sales-price-lists/:id/retire     ACTIVE → RETIRED
POST   /api/sales-pricing/resolve            body input → resolved price/evidence
                                              (read-only; zero DB mutation)
```

All reads/resolution require `pricing:view`; configuration mutations require `pricing:manage`; manual price requires `pricing:override`. Activation/retirement require `Idempotency-Key` and the atomic validation/audit contract in §29.6.4. There is no GET-with-body resolver and no pricing override log endpoint.

#### 29.31.3 Order-Time Discount API surface

```text
GET    /api/sales-discount-schemes
POST   /api/sales-discount-schemes            create DRAFT
GET    /api/sales-discount-schemes/:id        detail + immutable rule versions
PATCH  /api/sales-discount-schemes/:id        update DRAFT header only
DELETE /api/sales-discount-schemes/:id        delete never-activated DRAFT only
POST   /api/sales-discount-schemes/:id/rules  create DRAFT rule
POST   /api/sales-discount-schemes/:id/rules/:ruleKey/versions
                                                append DRAFT rule version;
                                                enabled=0 is logical removal
POST   /api/sales-discount-schemes/:id/activate
POST   /api/sales-discount-schemes/:id/retire
POST   /api/sales-discounts/resolve            body input → calculation/evidence
                                                (read-only; zero DB mutation)
```

The same `pricing:view` / `pricing:manage` split applies. Supplying any MANUAL rule additionally requires `pricing:override` plus reason; `pricing:manage` never implies override and `pricing:override` never implies manage. No Wave-4 writer is required to implement or test Wave-2 preview authorization.

#### 29.31.4 Sales Order API surface (canonical)

```text
GET    /api/sales-orders                    list
GET    /api/sales-orders/:id                detail (commercial party snap, snapshot, lines)
POST   /api/sales-orders                    create (commercial party default snapshot)
PATCH  /api/sales-orders/:id                update (DRAFT/REJECTED only)
POST   /api/sales-orders/:id/submit          DRAFT→SUBMITTED
POST   /api/sales-orders/:id/approve         SUBMITTED→APPROVED  (SOD; SALES_ORDER family)
POST   /api/sales-orders/:id/reject          SUBMITTED→REJECTED  (with reason)
POST   /api/sales-orders/:id/close           commercial close (SC43) — explicit action
POST   /api/sales-orders/:id/cancel          commercial cancel (SC44) — explicit action
POST   /api/sales-orders/:id/gift-line       add gift line (SC29) — additive
GET    /api/sales-orders/:id/fulfillment     DERIVED projection (partial/full/etc)
```

#### 29.31.5 Sales Order Change API surface

```text
POST   /api/sales-orders/:id/controlled-change create CONTROLLED_DIRECT evidence
                                                 (SUBMITTED + approval request;
                                                  Idempotency-Key required)
POST   /api/sales-order-changes               create CONTROLLED_DOCUMENT (DRAFT)
PATCH  /api/sales-order-changes/:id          change lines
POST   /api/sales-order-changes/:id/submit    DRAFT→SUBMITTED (platform approval create)
POST   /api/sales-order-changes/:id/approve   SUBMITTED→APPLIED via canonical
                                                 applySalesOrderChange;
                                                 Idempotency-Key required
POST   /api/sales-order-changes/:id/reject    SUBMITTED→REJECTED
POST   /api/sales-order-changes/:id/cancel    DRAFT→CANCELLED (no SO state change)
```

#### 29.31.6 Delivery Notice API surface

```text
GET    /api/delivery-notices                 list
GET    /api/delivery-notices/:id             detail (lines + remaining)
POST   /api/delivery-notices                 create (DRAFT)
PATCH  /api/delivery-notices/:id             lines
POST   /api/delivery-notices/:id/confirm     DRAFT→CONFIRMED
POST   /api/delivery-notices/:id/cancel       DRAFT/CONFIRMED→CANCELLED
```

#### 29.31.7 Sales Delivery (existing) — converged

```text
GET    /api/sales-deliveries                (existing)
POST   /api/sales-deliveries                (existing) — explicit sourceMode;
                                                 deliveryNoticeId required only for
                                                 DELIVERY_NOTICE, forbidden for DIRECT_ORDER
PATCH  /api/sales-deliveries/:id            (existing)
POST   /api/sales-deliveries/:id/confirm    (existing) — extended: also locks
                                                  delivery_notice remaining + uses
                                                  applyInventoryMutation + OQC + Finance
                                                  recognition. Delivery Notice lock identity
                                                  becomes part of the confirm path. Service
                                                  items require service_fulfillments pre-check.
```

#### 29.31.8 Sales Return (existing) — extended

```text
GET    /api/sales-returns                   (existing)
POST   /api/sales-returns                   (existing; must specify
                                              commercialSourceMarker ∈
                                              {DELIVERY_BACKED, ORDER_BACKED, NO_SOURCE})
PATCH  /api/sales-returns/:id               (existing)
POST   /api/sales-returns/:id/confirm       (existing; with mode-specific behavior)
```

#### 29.31.9 Replacement API surface

```text
GET    /api/sales-order-replacements
POST   /api/sales-order-replacements         create from return
PATCH  /api/sales-order-replacements/:id    update state
POST   /api/sales-order-replacements/:id/fulfill  create replacement_delivery_link
```

#### 29.31.10 Prepayment Gate API surface

```text
GET    /api/sales-prepayment-requirements
POST   /api/sales-prepayment-gate/evaluate
       body: {sales_order_id, stage}
       → returns {decision, eligible_advance_cents, remaining_required_cents}
```

#### 29.31.11 Reservation Intent API surface

```text
POST   /api/sales-reservation-intent/request       create intent request
POST   /api/sales-reservation-intent/release       release intent
GET    /api/sales-reservation-intent                  list (by SO)
```

#### 29.31.12 Service Fulfillment API surface

```text
POST   /api/service-fulfillments                   create PENDING (per SO line)
POST   /api/service-fulfillments/:id/confirm       → CONFIRMED (triggers Finance recognition)
POST   /api/service-fulfillments/:id/cancel
```

#### 29.31.13 Consignment Commercial API surface

```text
GET    /api/consignment-commercial-documents
POST   /api/consignment-commercial-documents         create instruction
PATCH  /api/consignment-commercial-documents/:id
POST   /api/consignment-commercial-documents/:id/settle      settlement confirmation (→ Finance)
POST   /api/consignment-commercial-documents/:id/return       commercial return (→ Inventory + Finance)
GET    /api/consignment-commercial-documents/:id/remaining    remaining capacity
```

#### 29.31.14 Credit API surface

```text
GET    /api/credit-parameters              (active effective at business_date)
GET    /api/credit-check-rules
POST   /api/credit-parameters              create (DRAFT)
POST   /api/credit-parameters/:id/activate set effective_from
POST   /api/credit-check-rules/:id/activate

GET    /api/credit-profile                 per customer (effective at business_date)
POST   /api/credit-profile                 create / update (effective-dated)
GET    /api/credit-profile/:id/ratings

POST   /api/credit-check/evaluate
       body: {customer_id, salesperson_id, sales_order_id/sales_delivery_id,
              stage, business_date, proposed_exposure_delta}
       → returns {decision, component_breakdown, snapshot_identity,
                   special_approval_requirement}
       idempotency: (idempotency-key) required

POST   /api/credit-special-approval       request with reason + requested override
POST   /api/credit-special-approval/:id/decide    decision (bounded authority check)

POST   /api/credit-evaluation/indicator   create indicator
POST   /api/credit-evaluation/scheme
POST   /api/credit-evaluation/model
POST   /api/credit-evaluation/scoring-sheets    create sheet (bound evaluators)
POST   /api/credit-evaluation/scoring-sheets/:id/finalize
POST   /api/credit-evaluation/scoring-sheets/:id/apply-to-profile
POST   /api/credit-recalculation/run              CHECK_ONLY by default
GET    /api/credit-query                    limit / used / remaining / components
GET    /api/credit-exceptions               exception history (DERIVED query)
```

#### 29.31.15 Customer Commercial Extensions API surface

```text
GET    /api/customer-commercial-extensions
POST   /api/customer-commercial-extensions     create effective-dated
PATCH  /api/customer-commercial-extensions/:id
GET    /api/customer-material-xref
POST   /api/customer-material-xref
```

#### 29.31.16 Permission Intents (SC108..SC114)

```text
sales:view
sales:create
sales:manage
sales:approve
sales-order-change:direct-request
sales-order-change:document-manage
sales-order-change:approve

pricing:view
pricing:manage
pricing:override                 (SC109; PRICE OVERRIDE separate authority)

quotation:manage
return:manage
consignment:manage
service-sales:manage
replacement:manage

credit:view
credit:manage
credit:evaluate
credit:special-approve            (SC111; bounded authority)
```

### 29.32 Lifecycle Inventory

| State Machine | States |
|---|---|
| Quotation (§29.5.1) | DRAFT → EFFECTIVE → (CLOSE_CANCELLED) ∨ FULLY_CONVERTED ∨ EXPIRED |
| Sales Order (frozen) | DRAFT → SUBMITTED → APPROVED → REJECTED |
| Sales Order (commercial close; §29.10) | overlay: OPEN → CLOSED_COMMERCIALLY / CANCELLED_COMMERCIALLY |
| Sales Order Change — controlled direct (§29.9) | SUBMITTED → APPLIED ∨ REJECTED ∨ CANCELLED |
| Sales Order Change — formal document (§29.9) | DRAFT → SUBMITTED → APPLIED ∨ REJECTED ∨ CANCELLED |
| Delivery Notice (§29.11.1) | DRAFT → CONFIRMED → CANCELLED / CLOSED (by exhaustion) |
| Sales Delivery (frozen) | DRAFT → CONFIRMED → CANCELLED |
| Sales Return (frozen + commercial_marker) | DRAFT → CONFIRMED → CANCELLED with marker |
| Replacement (§29.14.1) | OPEN → IN_PROGRESS → FULFILLED / CANCELLED |
| Service Fulfillment (§29.18.1) | PENDING → CONFIRMED → CANCELLED |
| Consignment Commercial (§29.19.2) | DRAFT → INSTRUCTION → PARTIAL_SETTLED → SETTLED ∨ RETURNED ∨ CANCELLED |
| Prepayment Gate (§29.16.2) | PASS / WARN / BLOCK / OVERRIDE_REQUIRED (per stage) |
| Credit Special Approval (§29.26) | PENDING → APPROVED / REJECTED |
| Credit Evaluation Sheet (§29.27) | DRAFT → SUBMITTED → FINALIZED → APPLIED (to profile) |

### 29.33 RBAC / SOD Design

目标：映射 SC108..SC114 与 §34.7 P1..P5 至现行 Platform permission registry。

```text
Backend authorization (FAIL-CLOSED):
- VIEW      ≠ WRITE       (P1)
- CREATE    ≠ APPROVE    (P2)
- PRICE_OVERRIDE separate authority
             (P3 — sales:create / pricing:override 不能 same user)
- CREDIT_SPECIAL_APPROVE bounded authority
             (P4 — credit:special-approve 受 user.role ceiling 制约)
- AUDIT 不可跳过
             (P5 — critical mutation 与 audit_logs 共 tx)

SOD on Sales Order approval:
- creator_id ≠ reviewer_id (frozen in M3R)

SOD on Sales Order Change:
- requester_id ≠ approver_id for both CONTROLLED_DIRECT and CONTROLLED_DOCUMENT
- direct-request / document-manage / approve are separate backend authorities
- BOTH never aliases these permissions and never authorizes self-approval

Frontend visibility is NOT authorization.
hidden field != bypass; 必须 backend allow 拒绝。
```

#### 29.33.1 Existing Permission Codes (重用 + 冻结扩展)

Reuse (frozen):
```text
SALES_ORDER (family): sales:view / sales:create / sales:approve / sales:reject
                      (current per-platform mapping for SALES_ORDER approval family)

Standard 5-role baseline (frozen):
  role-sales, role-reviewer, role-warehouse, role-accounting, role-admin
  (frozen §34.7)
```

New (additive, business-meaning from §34.7):
```text
sales:manage (SC108)
sales-order-change:direct-request / sales-order-change:document-manage /
sales-order-change:approve (SC37..SC40; separate request/document/approve authorities)
pricing:view / pricing:manage / pricing:override (SC109)
quotation:manage (SC110)
return:manage (SC110)
consignment:manage (SC110, SC113)
service-sales:manage (SC110, SC113)
replacement:manage (SC112)
credit:view / credit:manage / credit:evaluate / credit:special-approve (SC111)
```

#### 29.33.2 Backend Authorization Ownership

Every Sales-owned write API has:

```text
checkPermissionOrForbid(actor, permissionCode, resourceType, resourceId)
```

writes audit `entity_type=SOMETHING, action=AUTH_DENIED` for fail-closed cases.

#### 29.33.3 Wave-2 exact pricing matrix

Permission codes are frozen for Wave 2 as three independent authorities:

| Role | `pricing:view` | `pricing:manage` | `pricing:override` |
|---|---:|---:|---:|
| `role-admin` | YES | YES | YES |
| `role-sales` | YES | YES | NO |
| `role-reviewer` | YES | NO | YES |
| `role-warehouse` | NO | NO | NO |
| `role-accounting` | YES | NO | NO |

- `pricing:manage` does not imply `pricing:override`; `pricing:override` does not imply `pricing:manage`. Every endpoint checks the exact authority even when the actor has another pricing authority.
- `pricing:view` covers list/scheme reads and both pure resolver previews. `pricing:manage` covers DRAFT configuration plus activate/retire. `pricing:override` is additionally required when a price or MANUAL discount rule is supplied.
- Manual preview requires the override actor and non-empty reason in the returned evidence. The resolver has no Sales-document creator context and remains zero-write, so Wave 2 tests permission/reason decisions without a Wave-4 writer. Wave 4 must persist actual override actor/reason and enforce `sales:create` actor ≠ override actor for the SO mutation, including an admin who owns both permissions.
- Denied configuration mutations write `AUTH_DENIED` through the existing audit service. Denied or successful pure resolver previews write no `audit_logs` row; HTTP security/access observability is not a business mutation audit. No endpoint may create a pricing-specific override log.

### 29.34 Approval / Workflow Boundary

Current Platform approval family `SALES_ORDER` must remain working.

New approval needs:

```text
Sales Order Change         :  SALES_ORDER family; both change paths require reason,
                              independent approver, parameter/path snapshot,
                              pre-effect-version check and atomic approve+apply
Credit Special Approval    :  new approval family = 'CREDIT_SPECIAL_APPROVAL';
                              bounded authority; ceiling; expiry; scope
Quotation approval (optional policy): new family = 'QUOTATION_APPROVAL' (optional,
                                     policy-dependent; off by default)
Delivery Notice approval   :  not required; CONFIRM is direct by Sales user
Replacement approval       :  policy-dependent; default = none;
                              SALES_ORDER family for replacement delivery link
Service Fulfillment approval: not required; CONFIRM is direct by Sales user
```

Generic Workflow itself remains Platform-scope (OUT_OF_SCOPE §34.10).

Use bounded existing Platform approval mechanics (SALES_ORDER family + new CREDIT_SPECIAL_APPROVAL family) where possible; do NOT implement Generic Workflow engine.

### 29.35 Audit Design

Critical mutations require audit; mutation + audit shared transaction boundary where possible.

```text
entity_type                  audited actions (action label)
sales_quotation              CREATE / UPDATE / STATE_TRANSITION / CONVERT_TO_SO
sales_price_list            CREATE / UPDATE / DELETE_DRAFT / ACTIVATE / RETIRE
sales_price_list_entry      CREATE / UPDATE_DRAFT / DELETE_DRAFT /
                            APPEND_VERSION (append-only version evidence)
sales_discount_scheme       CREATE / UPDATE / DELETE_DRAFT / ACTIVATE / RETIRE
sales_discount_scheme_rule  CREATE / UPDATE_DRAFT / DELETE_DRAFT
sales_order                 CREATE / UPDATE / SUBMIT / APPROVE / REJECT / GIFT_LINE_ADDED
                            CLOSE_COMMERCIALLY / CANCEL_COMMERCIALLY
sales_order_change          CREATE_DIRECT_REQUEST / CREATE_DOCUMENT / SUBMIT /
                            APPROVE_AND_APPLY / REJECT / CANCEL / IDEMPOTENT_REPLAY
                            (records path, parameter snapshot, base/target version,
                             requester, approver and application actor)
sales_order_change_line     ADD / MODIFY / CANCEL (before/after per-line evidence;
                            append-only after APPLIED)
delivery_notice             CREATE / CONFIRM / CANCEL
sales_delivery              CREATE / UPDATE / CONFIRM / CANCEL (existing)
sales_return                CREATE / UPDATE / CONFIRM / CANCEL (existing; +mode)
sales_order_replacement     CREATE / UPDATE / FULFILL / CANCEL
sales_reservation_intent    REQUEST / RELEASE / CONSUME
sales_prepayment_requirement CREATE / UPDATE
sales_prepayment_gate_result EVALUATE
service_fulfillment         CREATE / CONFIRM / CANCEL
consignment_commercial_doc  CREATE / SETTLE / RETURN / CANCEL
consignment_commercial_line UPDATE
credit_parameters          CREATE / ACTIVATE
credit_check_rules          CREATE / ACTIVATE
credit_profile              CREATE / UPDATE / EFFECTIVE_SET
credit_profile_ratings      APPLY
credit_check_result         EVALUATE
credit_special_approval     REQUEST / DECIDE
credit_evaluation_indicator CREATE
credit_evaluation_scheme     CREATE
credit_evaluation_model     CREATE
credit_evaluation_scoring_sheet CREATE / SUBMIT / FINALIZE / APPLY
credit_recalculation_history RUN
```

Audit entity values MUST reference `policy_snapshot_identity` for any credit-related audit row (per R-SAL-24 design enforcement).

Wave-2 pricing/scheme activation and retirement validate state and write the business row plus exactly one action audit in one transaction. Exact `Idempotency-Key` replay returns the stored original response with zero business/audit mutation; payload mismatch fails 409. `POST .../resolve` never appears as a business audit action because both resolvers are strictly zero-mutation. Actual order-time manual override audit belongs to the future Wave-4 SO writer and reuses `audit_logs`; no sixth Wave-2 business table is allocated.

### 29.36 Mobile IA Design

Sales & Customer launcher goal: ≤ 6 primary entries.

Design proposal:

```text
Sales & Customer launcher:
  Customers           (SC02..SC07; existing route customers)
  Quotations          (SC09..SC14; new route quotations/primary)
  Orders              (SC24..SC44; existing route orders)
  Fulfillment         (SC45..SC58; combined entry: Delivery Notice + Sales Delivery + Return)
                      (Navigation: notice/delivery/return contextual tabs)
  Returns / Replacements (SC54..SC61; existing route returns with new tab: replacement)
  Credit              (SC82..SC107; new route credit/workspace)
```

Total primary launcher entries = 6.

Contextual surfaces (not in launcher):

```text
Pricing             → pricing sub-page accessible from Orders
Quotation detail    → route quotations/:id
Discount            → route sales-discounts (existing; AR/parent chain)
Consignment         → route consignment accessible from Customers OR a contextual detail tab
Service sales       → conditional; standard SO item type is service when product.is_service_classification
```

### 29.37 Route Design

`applicationRegistry.js` remains canonical front-end route truth.

```text
Existing routes (frozen compatibility):
  customers
  orders (sales order list / detail / editor)
  sales-deliveries
  returns (sales returns AND purchase returns)
  sales-discounts
  sales-invoices

New routes (NEW):
  quotations                  → list / detail / editor / conversion-to-SO
  delivery-notices            → list / detail / editor
  sales-orders-change         → list / detail / editor  (route id: 'sales-order-changes')
  sales-order-replacements    → list / detail / editor (under returns parentRoute)
  service-fulfillments        → list / detail (under orders parentRoute)
  consignment-commercial      → list / detail / editor (under customers parentRoute)
  customer-commercial-extensions  → detail within customer profile (NOT a primary route)
  customer-material-xref      → detail within customer profile (NOT a primary route)
  prepayment-gate             → embedded in order / delivery flows (NOT a primary route)
  credit-parameters           → settings under credit workspace
  credit-profile              → list under credit workspace
  credit-check-rules          → settings under credit workspace
  credit-check-evaluate       → embedded in SO/SD checkout
  credit-special-approvals     → list under credit workspace
  credit-evaluation            → list under credit workspace
  credit-query                 → query surface under credit workspace
  credit-exceptions            → query surface under credit workspace

Aliases (compat):
  none mandatory; existing routes retained
```

domain assignment:
all new routes → `sales-customer`.

access RBAC: per SC108..SC114 / §34.7.

mobile exposure per:
```text
  primary (launcher ≤ 6 entries):  customers, quotations, orders, fulfillment, returns-replacements, credit
  contextual (never in launcher): pricing, quotation-detail, discount, consignment, service-sales, prepayment, all credit sub-routes
  workflow (mobile-first editor): orders-editor, quotation-editor, delivery-notice-editor, credit-special-approvals-detail
  report (mobile-tolerant):  sales-summary, sales-outstanding (existing decision-reports entry points)
```

### 29.38 Responsive Design

```text
widths        : 320 / 390 / 430 / 680
primary      : 390
touch target : ≥ 44 CSS px
horizontal   : permanent horizontal scroll NOT for core tasks
core pattern : LIST → DETAIL → EDITOR / WORKFLOW
```

Each new workflow specifies:

```text
LIST    : customer / quotation / order / DN / replacement / credit list views
DETAIL  : detail of each entity with sectioned (commercial / finance / inventory / audit)
EDITOR  : for create / update / state transitions; modal or full-page per §34.7
WORKFLOW: for state machine-driven flows (DRAFT→EFFECTIVE→CONVERT; CREDIT→CHECK→SPECIAL_APPROVE)
```

### 29.39 Reporting Design

Existing decision-reports sales-summary / sales-outstanding extended; new projections:

```text
Quotation execution         : SC78 ← decision-reports sales-quotation-summary
Sales Order execution       : SC78 ← decision-reports sales-summary (existing extended)
Delivery Notice execution   : SC78 ← new sales-delivery-notice-execution
Sales Delivery execution     : SC78 ← decision-reports sales-outstanding (existing extended)
Return execution            : SC78 ← new sales-return-execution (3 modes split)
Replacement execution       : SC78 ← new sales-replacement-execution
Consignment execution       : SC78 ← new consignment-execution (3-layer split)
Credit exceptions            : SC78 ← new credit-exception-list

Sales Outstanding            : SC79 ← decision-reports sales-outstanding (existing)
Sales Gross Profit           : SC80 ← existing; consumes canonical valuation evidence
Sales Ranking                 : SC81 ← new sales-ranking by (customer, material, salesperson, sales_group)
                             dimensions
```

Reports use canonical business dates (§34.4 S19 invariant).

No shadow ledger for Sales cost: gross profit consumes canonical cost from Inventory V21 + Finance V22.

### 29.40 Historical Compatibility (new-flow enforcement + fail-closed)

| Existing concept | Row without new field | Legacy read | Legacy mutate (correction) | New write through legacy bypass |
|---|---|---|---|---|
| Legacy SO without tax_basis snapshot | NULL commercial_tax_code column | YES (display `(legacy)`) | bounded (Policy §29.45) | NO (new normal flow requires commercial snapshot) |
| Legacy SO without `effective_version` | Wave 4 migration backfills `1` as a forward-only compatibility baseline | YES; existing APPROVED/history remains read-only | only canonical SO Change may advance `1 → 2...`; no reconstructed history | NO; create initializes `1`, normal edit cannot write version |
| Legacy SD without source discriminator | source_mode absent / LEGACY_UNCLASSIFIED | YES (read) | bounded (Policy §29.45; no auto-classification) | NO; new writes require DIRECT_ORDER or DELIVERY_NOTICE (§29.12.0) |
| Legacy Order without commercial parties | NULL salesperson / sales_group / settlement_party / payer | YES (display `(legacy)`) | bounded | NO |
| Legacy Returns without `commercial_source_marker` | NULL → treat as DELIVERY_BACKED | YES | bounded | NO (new entries must set marker) |
| Legacy Customers without commercial extensions | NULL | YES (display `(none)`) | bounded | NO |
| Legacy Credit Profile missing | NULL credit_profile row | YES (display `(none)`) | per §29.22.1 rule (FAIL CLOSED if Credit Management enabled + mandatory rule) | per §29.22.1; no new write allows "no profile" exception to silent PASS |
| Legacy tax basis | NULL | YES (treat as no commercial tax snapshot) | bounded | NO |
| Legacy product reference price (`products.price_cents`) | DEPRECATED_NO_NEW_WRITES; historical display/read only, never returned by §29.6 resolver | YES (legacy document/reference read) | n/a | NO (new preview/write requires the Sales Pricing engine and returns `PRICE_NOT_CONFIGURED` when unresolved) |

> Default rule: legacy read = YES, legacy correction (bounded) = policy-defined, new write through legacy bypass = NO.
> Compatibility must not become a permanent bypass around new canonical contracts.
> 禁止 retroactive rewrite of historical rows; 只 forward-only SO Change 允许。

### 29.41 Schema Constraints (proposed; no migration code)

| Constraint | Enforces |
|---|---|
| `customers.id` PK | identity foundation invariant (Master & Engineering) |
| `sales_groups.group_code UNIQUE NOT NULL` | one canonical Sales group code |
| `salesperson_profiles.salesperson_code UNIQUE NOT NULL` | one canonical Sales salesperson code |
| `salesperson_profiles.user_id UNIQUE NULLABLE FK users.id` | optional one-to-one login link; salesperson may exist without login |
| `salesperson_group_memberships UNIQUE (salesperson_id, sales_group_id, effective_from)` | multi-group membership identity; one effective default is transactionally enforced under salesperson anchor lock |
| `sales_parameters.scope_key PK` + bounded scope/code CHECK | one explicit SYSTEM row or document-type override; no arbitrary KV |
| `sales_parameters.order_change_mode CHECK` | `DISABLED / CONTROLLED_DIRECT / CONTROLLED_DOCUMENT / BOTH` only |
| `customer_commercial_extensions PK (customer_id, effective_from)` | version identity only; no-overlap is transactionally enforced under customer anchor lock |
| `customer_commercial_extensions` party / salesperson / group FKs | no orphan Master or Sales commercial references |
| `customer_material_xref UNIQUE (customer_id, product_id, effective_from)` | one effective mapping identity per customer / product / start date |
| no UNIQUE on `(customer_id, customer_material_code, effective_from)` alone | preserves approved multi-product candidates; explicit product selection + effective validation resolves ambiguity |
| `customer_commercial_extensions.sellable_scope_mode CHECK` | coherent customer-level `ALL_SALES_ENABLED / RULE_CONTROLLED`; xref remains translation only, A-69 owns allow/deny scope |
| `product_commercial_classification.product_id UNIQUE FK products.id` | one current Sales commercial classification/default set per Master product; no `products` mutation |
| `sales_price_lists.id PK`; `price_list_code UNIQUE`; lifecycle/date/currency CHECKs | stable list identity; one base currency; DRAFT → ACTIVE → RETIRED only |
| `sales_price_list_entries.id PK` + four-column business UNIQUE | version FK has a real unique target; `(price_list_id, material_identity_key, customer_scope_key, pricing_identity_key)` is directly materialized by current MySQL Bootstrap (`<=4` columns) and SQLite |
| price entry normalized-key CHECK / service derivation | bounded ASCII material/customer/pricing keys encode the complete semantic identity without nullable columns, delimiter ambiguity, truncation, case-folding, or generated hash index |
| price entry quantity/date CHECK + transactional overlap rejection | integer-micro inclusive breaks and inclusive effective dates never overlap for the same business scope |
| `sales_price_list_versions UNIQUE(entry_id, version)` + integer cents CHECK | append-only exact price version; no floating money |
| `sales_discount_schemes.id PK`; `scheme_code UNIQUE`; lifecycle/date/currency CHECKs | stable scheme/version identity and deterministic fallback root |
| `sales_discount_scheme_rules UNIQUE(scheme_id, rule_key, rule_version)` | immutable rule-version evidence without a sixth table |
| discount kind/value CHECK | PERCENT has integer 0..10000 bps only; AMOUNT has non-negative integer cents only; exactly one value populated |
| discount LINE/HEADER applicability CHECK | HEADER requires material/UoM NULL and break `[0, unbounded]`; LINE alone may filter material/UoM/quantity |
| discount greatest-version selection under scheme lock | one current version per rule_key; disabled/inapplicable greatest version never falls back to history |
| Wave-2 target-first FKs + A-39 nullable default FKs | five targets are created first; both customer defaults are real FKs with no fabricated value |
| `sales_order_items` tolerance snapshot CHECK | upper bps >= 0; lower bps 0..10000; immutable approved execution baseline |
| `sales_order_items.price_snapshot_json` / `discount_snapshot_json` | nullable physical compatibility for legacy rows; canonical Batch A writer requires valid non-empty versioned server evidence and rejects forged/missing/mismatched snapshots; approved history is write-once |
| `sales_orders.order_no UNIQUE` | no duplicate order |
| `sales_orders.effective_version INTEGER NOT NULL DEFAULT 1 CHECK (effective_version >= 1)` | one monotonic current-version anchor; application also requires locked-read + conditional CAS update |
| `sales_order_changes.change_no UNIQUE` + `application_idempotency_key UNIQUE` | one evidence identity and exact-once application |
| `sales_order_changes` path/mode/version CHECK | approved direct/document path; base < target; APPLIED evidence immutable |
| `sales_deliveries.delivery_no UNIQUE` | R-SAL-01 anchor |
| `sales_deliveries.sales_order_id` FK (existing) | no orphan |
| `sales_delivery_items.sales_order_item_id` FK | source-line identity |
| `sales_delivery_items.delivery_notice_line_id` FK (NEW nullable) | R-SAL-17 anchor; legacy NULL allowed |
| `return_orders.source_type CHECK` (existing) | source-type invariant |
| `return_orders.commercial_source_marker CHECK` (NEW) | 3-modes invariant |
| `sales_quotation_lines PK (quotation_id, line_no)` | canonical line |
| `sales_quotation_conversions PK (quotation_id, sales_order_line_id)` | source-line conversion uniqueness |
| `delivery_notices.notice_no UNIQUE` | identity |
| `delivery_notice_lines PK (delivery_notice_id, sales_order_item_id)` | capacity invariant |
| `sales_order_changes.change_no UNIQUE` | identity |
| `sales_order_replacements.replacement_no UNIQUE` | identity |
| `sales_order_replacements.source_return_id FK` | replacement ↔ return |
| `credit_parameters PK (code, effective_from)` | effective-dated uniqueness |
| `credit_check_rules.rule_code UNIQUE per effective_from` | effective-dated uniqueness |
| `credit_profile PK (customer_id, salesperson_id, credit_object_type, credit_object_id, effective_from)` | effective-dated uniqueness |
| `credit_special_approval PK (source_credit_check_result_id)` | one-time-only approval per check |
| `consignment_commercial_lines PK (doc_id, material_id, lot_code effective)` | consignment stream integrity |
| `idempotency_records PK (entity_type, entity_id, idempotency_key)` | command idempotency |

### 29.42 SQLite / MySQL Parity

Hardening surface checklist (anticipated hazards):

```text
- partial-index: ensure no UNIQUE … WHERE clauses; use plain UNIQUE
  on (effective_from) composite keys.
- UPSERT: avoid SQLite-only ON CONFLICT syntax that has no MySQL 8
  direct equivalent. Use INSERT-or-check-then-UPDATE; or use INSERT IGNORE
  with care for InnoDB semantics.
- concurrent UPDATE: avoid SQLite-only UPSERT / DO NOTHING that bypasses
  row-lock in MySQL. For capacity updates use explicit
  SELECT ... FOR UPDATE then UPDATE; never rely on conditional UPDATE.
- JSON: store JSON in TEXT / JSON columns using universal JSON1 / MySQL JSON
  document with same content semantics.
- Sales line snapshot JSON follows the existing Bootstrap type mapping: canonical SQLite `TEXT` is reconciled to the adapter-supported MySQL JSON/text representation without raw SQLite DDL replay. Application validation is authoritative for the versioned envelope, safe integers and cross-field equality on both engines.
- AUTOINCREMENT: rely on explicit id generation; do not assume auto-assigned
  values exist on both engines identically. Use TEXT IDs consistent with
  current implementation.
- date / time: store ISO date (YYYY-MM-DD) for business_date; full ISO 8601
  for timestamp columns. Timezone normalize at app boundary.
- defaults: every column with default has explicit default; not engine-specific.
- nullable identity: never use nullable `customer_id` in PK/UNIQUE semantics.
  Price entry uniqueness is the ordered four-column plain UNIQUE on list id plus
  three bounded canonical ASCII keys; it is not a seven-column SQLite autoindex
  and does not use `generatedPartialIndex()` / SHA digest behavior.
- quantity/money: no REAL/FLOAT for quantity breaks, percentages, or cents;
  micro-quantity, basis points, and cents are safe integers at API/service/DB boundaries.
- FK upgrade: SQLite must expose the two A-39 defaults through
  `PRAGMA foreign_key_list`; MySQL must add named `ALTER TABLE ... ADD CONSTRAINT`
  FKs and verify them through `information_schema.REFERENTIAL_CONSTRAINTS` /
  `KEY_COLUMN_USAGE`. A column-shaped match without its FK is not success.
- metadata reconciliation: fresh init, upgrade from exact Wave-1 baseline, and
  repeated init must converge to exactly five new tables + two nullable fields.
  Expected missing objects are added; compatible existing objects are retained;
  any unexpected type/nullability/default/PK/UNIQUE/CHECK/FK/index mismatch fails
  closed before business handlers are enabled. Existing rows are never rewritten.
- price-entry UNIQUE acceptance is path-specific and mandatory:
  SQLite fresh: PRAGMA index_list/index_info reports one UNIQUE with ordered
    columns (price_list_id, material_identity_key, customer_scope_key,
    pricing_identity_key); sqlite_master reports both identity guard triggers;
    duplicate canonical, forged-key INSERT, and identity UPDATE are rejected.
  MySQL fresh: information_schema.STATISTICS reports NON_UNIQUE=0 with the same
    four SEQ_IN_INDEX columns; this is emitted inline by tableDefinition().
    The subsequent canonical Sales registry replay installs exactly the two
    MySQL guard triggers, verified through information_schema.TRIGGERS.
  Existing MySQL upgrade: when the complete pre-Wave-2 database lacks the table,
    tableDefinition() creates it with the same inline <=4-column UNIQUE; the
    design does not depend on planMySqlIndexReconciliation(), which skips
    origin='u', or on generatedPartialIndex(). Live Wave-2 registry replay then
    installs/verifies the guards. A pre-existing incompatible table/index/trigger
    is an unexpected mismatch and startup fails closed.
  Second initialization: exactly one equivalent UNIQUE remains, duplicate
    canonical/forged-key/identity-update probes still fail, exactly two guards
    remain, table/row/index counts are unchanged, and no generated __partial_*
    column/index exists.

Tests:
  SQLite parity = node --test that runs both engines on the same SQL.
  Real MySQL = pnpm test:mysql / pnpm test:mysql:concurrency per §34.6 races.
```

### 29.43 Transaction Model

The canonical SO writer re-runs Pricing and Discount resolution after acquiring its transaction gate and before inserting any SO row. It serializes only the resulting server envelopes into `price_snapshot_json` / `discount_snapshot_json`, verifies unit price, gross/final line cents, UoM evidence, header allocation and order total, and commits the two snapshots with the line/header/audit/idempotency facts. A supplied client snapshot is only an optimistic assertion and any mismatch rolls back with zero side effects. Ordinary PATCH never accepts either snapshot for an approved SO.

#### 29.43.1 SQLite strategy

```text
WRITE tx:
  BEGIN IMMEDIATE   (whole DB write lock to serialize concurrent writers; freezer-friendly)
  SELECT ... FOR UPDATE (MySQL only; not used on SQLite; SQLite serializes via BEGIN IMMEDIATE)
  capacity read + check
  capacity write
  audit write
  COMMIT

  Wave-2 list/scheme mutation:
    BEGIN IMMEDIATE → read owning list/scheme + peers → validate state, overlaps,
    fallback graph, versions and canonical UoM → mutate → audit → COMMIT.
    Resolver preview uses READ tx only and writes nothing.

READ tx:
  BEGIN DEFERRED   (default; let SQLite upgrade to IMMEDIATE if writer pending)
```

#### 29.43.2 MySQL strategy

```text
WRITE tx:
  START TRANSACTION
  SELECT … FOR UPDATE on
    source line identity (sales_order_items.id / sales_delivery_items.id /
                          delivery_notice_lines.id / return_orders.id / etc.)
    Credit Profile identity (credit_profile.id)
    credit_special_approval source (credit_special_approval.source_credit_check_result_id)
  computed capacity check INSIDE transaction
  capacity write
  audit write
  COMMIT

  Wave-2 list/scheme mutation:
    lock all affected sales_price_lists or sales_discount_schemes rows in
    ascending id order; then lock entry/rule/version rows in ascending id order;
    re-read overlap/fallback/UoM authority; mutate + audit atomically. Activation
    of a fallback graph locks every reachable header before validation. Resolver
    preview is a non-locking consistent read and performs zero DB mutation.

READ tx:
  SELECT … (no lock; READ COMMITTED default)

Lock ordering (canonical, Micro-Closure corrected):
  Acquire lock identities in one deterministic order:
    1. Sales-owned business / capacity anchor (preferred)
       (sales_order_items.id / sales_delivery_items.id /
        delivery_notice_lines.id / return_order_items.id /
        sales_order_replacement_lines.id / service_fulfillments.id /
         consignment_commercial_lines.id / sales_quotation_lines.id /
         sales_price_lists.id / sales_discount_schemes.id)
    2. Sales-owned Credit anchors (R-SAL-12 / 24):
       - credit_profile (effective row) FOR UPDATE
       - credit_policy_snapshots FOR UPDATE
       - credit_check_rules (effective) FOR UPDATE
    3. Sales-owned Prepayment anchor (R-SAL-15):
       - sales_prepayment_requirements / sales_prepayment_gate_results (snapshot_key)
    4. Cross-domain read rows that the frozen integration contract requires
       (acquire only if necessary):
       - approval_requests (frozen Platform) FOR UPDATE
       - planning_reservations FOR UPDATE (consume-side, R-SAL-02)
       - account_receivables / settlement_unapplied_balances via canonical
         Finance read adapter; NOT a Sales-owned lock; not a FOR UPDATE
         on Finance rows unless the frozen Finance contract specifies it
    5. audit_logs (no lock; append-only)

  Do NOT acquire the same lock classes in reverse order in another mutation
  path.

  Commit / rollback releases transaction locks atomically.

  Cross-domain read rows are NOT locked by default; Sales reads use canonical
  read adapters; only acquire the cross-domain FOR UPDATE if the frozen
  contract specifies it (rare).

Lock order rule: never read a row without FOR UPDATE first then update; never
rely on timeouts/sleeps.

### 29.44 R-SAL-01..24 Lock Matrix

| Race | Op A | Op B | Lock identity | Lock acquisition order | Allowed serialization | Forbidden final state | Required invariants | SQLite | MySQL | Acceptance plan |
|---|---|---|---|---|---|---|---|---|---|---|
| R-SAL-01 | SD confirm × 2 vs same SO line | — | sales_delivery_items source line | SD item → SO item | One wins; second re-reads remaining ≥ 0 | over-delivered (SO line remaining) | S05, S06 | source-line identity FOR UPDATE; remaining compute before write | source-line FOR UPDATE | R-SAL-01 test |
| R-SAL-02 | SD confirm × 2 vs same Planning reservation | — | planning_reservations.id | Planning reservation FIRST, then SD item | One wins; partial consumption serialized through Planning | reservation overstep | S12 | Planning canonical FOR UPDATE on its row; SD reads via assertStrongReservationAvailability | planning + SD FOR UPDATE | R-SAL-02 test |
| R-SAL-03 | SR confirm × 2 vs same delivery_item | — | return_order_items.delivery_item_id | delivery item → return item → AR adapter | One wins; second sees reduced remaining | over-return (> delivery qty) | S06, S10 | delivery_item FOR UPDATE; remaining compute before write | FOR UPDATE both | R-SAL-03 test |
| R-SAL-04 | M14 sales discount confirm × 2 vs same source AR | — | M14 sales_discounts.source_receivable_id → AR.id | AR row → discount row | One wins; second sees reduced remaining | over-discount (remaining ≤ 0) | S13 | AR FOR UPDATE then discount insert | FOR UPDATE both | R-SAL-04 test (M14 existing) |
| R-SAL-05 | SD confirm vs SR confirm (same physical race) | — | Inventory V21 canonical position (position_key) | inventory canonical → SD/SR line | exact-once net effect | net negative inventory | S01, Inventory frozen writer | inventory FOR UPDATE on position_key | FOR UPDATE position | R-SAL-05 test |
| R-SAL-06 | Quotation convert × 2 vs same Q line | — | sales_quotation_lines.id | quotation line → SO item → conversions insert | combined ≤ line qty | over-conversion | S04, S06 | quotation line FOR UPDATE; remaining compute | FOR UPDATE | R-SAL-06 test |
| R-SAL-07 | SO approve/application vs another SO change | direct + document | approval request + sales_orders.id effective_version + sales_order_changes.id | approval → SO header → change → affected lines | one application wins; loser is stale; version monotonic | silent rewrite or two changes applying same base version | S05 | conditional base-version update + application idempotency | same order for both paths | R-SAL-07 test |
| R-SAL-08 | SO change application vs direct/notice-backed Delivery create/confirm | direct + document | sales_orders.id + affected sales_order_items.id + SD source-line identity | SO header → affected SO lines → DN line when present → SD item | change sees executed quantity or delivery sees new version; only one valid serialization | change reduces/reassigns already shipping line | S05, S06 | both paths share apply service; delivery re-reads effective version/capacity | same source lock order | R-SAL-08 test |
| R-SAL-09 | Delivery vs Return/Reopen | — | delivery_items → return_items → AR update | both FOR UPDATE | one wins; reopen explicit | silent relive of cleared | S05, S10 | idempotent return + reopen | FOR UPDATE both | R-SAL-09 test |
| R-SAL-10 | Return vs Replacement fulfillment | — | return_order_items.id (line) + sales_order_replacement_lines.id (line) | return-line FOR UPDATE → replacement-line FOR UPDATE | state machine consistent; combined fulfilled ≤ return_qty | inconsistent state | S10, S61 | replacement fulfillment rejects if remaining < qty; line-level anchor | FOR UPDATE both | R-SAL-10 test |
| R-SAL-11 | Pricing update vs Order approval | — | Wave-2 list/version identity + immutable identity properties inside Wave-4 `sales_order_items.price_snapshot_json` | Wave 2 freezes ACTIVE pricing versions; Wave 4 locks SO item on create/approve and persists the server-generated evidence | resolver evidence is immutable by version; future approved SO snapshot remains unchanged | price change rewrites approved SO price | S20 | Wave-2 structural/version test now; Wave-4 snapshot write-once + concurrent approval test later | same two-wave boundary; no Wave-2 SO schema | Wave-2 partial evidence + Wave-4 final R-SAL-11 test |
| R-SAL-12 | Credit Check × 2 vs same credit object (PURE_DERIVED exposure) | — | **credit_lock_anchors.id** (REFINED A-62; anchor_type='CREDIT_OBJECT'; UNIQUE on anchor_key) | 1) POLICY_SCOPE anchor FOR SHARE; 2) CREDIT_OBJECT anchor FOR UPDATE; 3) credit_profile effective row FOR UPDATE; 4) credit_policy_snapshots create-or-select FOR UPDATE; 5) credit_check_rules effective rows FOR UPDATE | one wins; the loser re-reads and re-evaluates against updated state; multiple concurrent Credit Checks may share the same policy read (FOR SHARE) but serialize per credit object; combined committing commitments ≤ available credit | combined committing commitments > available credit; or check reads from stale eligible balance while concurrent Finance mutation has already consumed/refunded it | S14, S15 | PRIMARY long-lived lock identity = CREDIT_OBJECT anchor; Prepayment Gate acquires same Finance canonical locks via financeAdapter (see R-SAL-15); risk-releasing Finance events do not need to acquire Sales anchor; visibility lag → conservative temporary BLOCK acceptable, never over-credit approval | FOR UPDATE anchor (CREDIT_OBJECT) → profile → snapshot → rules; FOR SHARE on POLICY_SCOPE | R-SAL-12 test |
| R-SAL-13 | Credit Special Approval vs Order approval | — | credit_special_approval.source_credit_check_result_id (PK) + credit_policy_snapshots.id + sales_orders.id (effective_version) | approval FOR UPDATE → snapshot FOR UPDATE → SO FOR UPDATE | either special-approve or standard approval wins; never both silently | both silently | S16 | approval + SO tx; check + approval PK link | FOR UPDATE all three | R-SAL-13 test |
| R-SAL-14 | Credit release vs Collection / Return | — | credit_exposure_view (DERIVED) over Finance canonical AR / settlement_unapplied / financial_credit_adjustments | collection/return FOR UPDATE (Finance-owned rows) | transition rule prevents double-count | double-count | S14 | OCCUPANCY transition rule (per §29.23.2) at write; recognition-mode aware | FOR UPDATE on Finance-side rows | R-SAL-14 test |
| R-SAL-15 | Prepayment Gate vs Refund / Application | — | **canonical V22 Finance parent balance lock**: `settlement_unapplied_balances.id` (balance_type = 'PREPAYMENT') inside SAME connection/transaction via financeAdapter (lockMode = FOR UPDATE); child facts read beneath the parent lock (balance_applications, financial_refunds, applicable reversal effects); `payment_collections` is source document, NOT primary lock | financeAdapter resolves eligible prepayment and acquires FOR UPDATE on the parent balance rows in deterministic id order; reads child effects beneath; remaining = original_amount - confirmed balance_applications - confirmed financial_refunds - applicable reversal effects (per §29.16.3.2); Sales gate + Finance mutation serialize on SAME parent balance lock | one wins; either Sales gate first then Finance mutation, or Finance mutation first then Sales gate re-reads reduced balance; same economic amount never satisfies gate twice | Sales gate passes from stale eligible balance while concurrent Finance mutation has already consumed/refunded it | S13 | shared contract: financeAdapter.resolveEligiblePrepaymentForSalesGate(..., lockMode = FOR UPDATE) acquires FOR UPDATE on canonical V22 settlement_unapplied_balances rows; inherited caller transaction per §29.16.5; Finance business semantics unchanged; canonical balance unchanged; only the Sales locked-read adapter requires extension; if a V22 mutation path does not yet acquire the parent balance lock, that path also requires extension → BOUNDED INTEGRATION CONTRACT EXTENSION (see §29.16.3.1-7) | FOR UPDATE on `settlement_unapplied_balances.id` (PREPAYMENT) via financeAdapter | R-SAL-15 test |
| R-SAL-16 | DN create × 2 vs same SO line | — | sales_order_items.id (line) | SO item FOR UPDATE (first) | combined scheduled_qty ≤ SO line qty | over-scheduled | S04, S06 | SO item FOR UPDATE before aggregate | FOR UPDATE SO item | R-SAL-16 test |
| R-SAL-17 | SD confirm × 2 vs same DN remaining | — | delivery_notice_lines.id (line) | DN line FOR UPDATE (first) | combined delivered_qty ≤ DN remaining | over-delivered | S09, S06 | DN line FOR UPDATE before aggregate; legacy SD allowed (delivery_notice_id IS NULL) with SO line FOR UPDATE | FOR UPDATE DN line | R-SAL-17 test |
| R-SAL-18 | SO Change vs DN create/confirm | direct + document | sales_orders.id + affected sales_order_items.id + delivery_notice_lines.id | SO header → SO lines → DN lines | change applies to remaining obligation only | change after concurrent DN confirm | S05, S09 | shared apply service + effective_version + DN remaining recompute | same order for both paths | R-SAL-18 test |
| R-SAL-19 | SO Close/Cancel vs DN/SD confirm | — | sales_orders.id (commercial_close_state) + DN/SD | SO header FOR UPDATE → DN/SD FOR UPDATE | one wins; close does not silently coerce | silent coercion | S05, S09 | close_action + pending-DN check | FOR UPDATE both | R-SAL-19 test |
| R-SAL-20 | Consignment settlement × 2 vs same unsettled consigned quantity | — | consignment_commercial_lines.id (commercial line; seller ownership at Layer 2 per §29.19) | commercial line FOR UPDATE | combined settled ≤ consigned (seller ownership, not CUSTOMER-owned) | over-settled (seller ownership preserved until settlement event) | S18, §29.19 ownership correction | commercial line FOR UPDATE before aggregate; Inventory V21 position remains ENTERPRISE-owned during consignment | FOR UPDATE commercial line | R-SAL-20 test |
| R-SAL-21 | Consignment settlement vs consignment return | — | consignment_commercial_lines.id | commercial line FOR UPDATE | settlement or return commits; combined ≤ consigned; seller ownership preserved until settlement event | over-settled + returned; silent CUSTOMER-owner redefinition | S18, §29.19 | settlement + return serialized on same line; Layer 2 owner remains ENTERPRISE until settlement | FOR UPDATE commercial line | R-SAL-21 test |
| R-SAL-22 | Service fulfillment × 2 vs same Service order remaining | — | sales_order_items.id (service line) | SO service line FOR UPDATE (first) | combined confirmation_qty ≤ service line qty | over-confirmed | S08 | no inventory OUT path; service-only; service_classification = TRUE precondition | FOR UPDATE SO line + service_fulfillments | R-SAL-22 test |
| R-SAL-23 | Credit Recalculation vs new credit-consuming SO tx (CONDITIONAL — materializes only if §29.24 deviates from PURE_DERIVED) | — | N/A under PURE_DERIVED choice (§29.24) | N/A | N/A (rebuild is non-mutating) | stale rebuild overwrite of newer state | S14, S17, SC100 | under PURE_DERIVED: R-SAL-23 = structurally non-materialized | FOR UPDATE under materialized mode | none needed today; documented for future |
| R-SAL-24 | Credit Policy / Profile Mutation vs Credit Check | — | **credit_lock_anchors.id** (REFINED A-62); two anchor types distinguished: POLICY_SCOPE (for policy/rule mutation + shared read) and CREDIT_OBJECT (for profile mutation + shared read); secondary: credit_policy_snapshots.id (decision evidence identity; append-only by fingerprint) | Credit Check: 1) POLICY_SCOPE FOR SHARE; 2) CREDIT_OBJECT FOR UPDATE; 3) effective policy / profile / limit / overdue / rating read; 4) snapshot create-or-select FOR UPDATE; 5) evaluate. Policy/Rule Mutation: 1) POLICY_SCOPE FOR UPDATE; 2) apply new effective version; 3) commit (snapshot fingerprint may change on next read). Profile/Limit/Rating Mutation: 1) CREDIT_OBJECT FOR UPDATE; 2) apply new effective version; 3) commit. Combined Policy+Profile Mutation: 1) POLICY_SCOPE FOR UPDATE; 2) CREDIT_OBJECT FOR UPDATE; never reverse order. | one wins; check uses complete OLD or complete NEW snapshot; mutation appends new snapshot (immutable); if check was in-flight, it blocks on anchor until mutation completes, then re-reads | mixed OLD/NEW values inside one check evaluation | R-SAL-24 invariant (one credit decision = one coherent effective policy version) | both paths acquire the appropriate anchor (CREDIT_OBJECT and/or POLICY_SCOPE) FOR UPDATE first; snapshot is decision evidence, NOT the lock; if V22 changes effective rows, new credit_policy_snapshots row inserted as append-only; stable non-null canonical anchor_key is the lock identity (Final Closure decision) | FOR UPDATE / FOR SHARE on appropriate anchor; snapshot create-or-select FOR UPDATE | R-SAL-24 test |

### 29.45 Idempotency Design

```text
Command idempotency required for (at minimum):

- POST /api/sales-quotations/:id/convert-to-so
- POST /api/sales-orders/:id/submit
- POST /api/sales-orders/:id/approve
- POST /api/sales-orders/:id/reject
- POST /api/sales-orders/:id/close
- POST /api/sales-orders/:id/cancel
- POST /api/sales-orders/:id/controlled-change
- POST /api/sales-order-changes/:id/submit
- POST /api/sales-order-changes/:id/approve
- POST /api/delivery-notices/:id/confirm
- POST /api/sales-deliveries/:id/confirm
- POST /api/sales-returns/:id/confirm
- POST /api/sales-order-replacements/:id/fulfill
- POST /api/service-fulfillments/:id/confirm
- POST /api/consignment-commercial-documents/:id/settle
- POST /api/consignment-commercial-documents/:id/return
- POST /api/credit-check/evaluate
- POST /api/credit-special-approval/:id/decide
- POST /api/credit-evaluation/scoring-sheets/:id/finalize
- POST /api/credit-evaluation/scoring-sheets/:id/apply-to-profile
```

Idempotency key: client-provided `Idempotency-Key` HTTP header OR deterministic body key.

```text
same key + same payload  → replay (return existing result)
same key + diff payload  → 409 Conflict (per existing M14 / V22 pattern)
no key                   → 400 Bad Request (require key on these)
```

Persisted via `idempotency_records` (existing).

SO Change uses separate namespaces: request/submit keys deduplicate evidence creation, while `SO_CHANGE_APPLY:<change_id>:<target_version>` deduplicates approval/application. A replay with the same key and payload returns the existing APPLIED version; reuse against another payload/version is 409. `BOTH` cannot reuse a key across direct and document paths.

### 29.46 Implementation Waves

```text
Wave A  Foundation / Commercial Extensions / Pricing / Quotation
  - M3R-style foundation: sales_groups, salesperson_profiles,
    customer_commercial_extensions, customer_material_xref,
    product_commercial_classification
  - Pricing engine + price list + override authority
  - Quotation document lifecycle + conversion

Wave B  Sales Order Enrichment / Change / Lifecycle
  - SO commercial parties, tax-basis snapshot, prepayment requirement,
    reservation intent field, gift line flag, fulfillment projection
  - SO Change document

Wave C  Delivery Notice / Return / Replacement
  - Delivery Notice doc + capacity invariants
  - Sales Return 3-mode (DELIVERY_BACKED / ORDER_BACKED / NO_SOURCE)
  - Replacement obligation + state machine
  - Sales Delivery convergence (DN ref + delivery_notice_id column)

Wave D  Prepayment / Reservation Intent / Service Item Sales / Consignment
  - Prepayment Gate evaluator
  - Reservation intent writer + Planning integration
  - Service Item classification + confirmation
  - Consignment commercial document (3-layer)

Wave E  Credit Foundation / Exposure / Check / Approval / Evaluation
  - credit_parameters + credit_check_rules (effective-dated)
  - credit_profile + credit_profile_ratings + credit_evaluation*
  - credit_check_result + credit_special_approval
  - credit_recalculation_history (CHECK-only)
  - credit_query / exception DERIVED surfaces

Wave F  Mobile IA / Reporting / Compatibility Convergence
  - new routes (quotations, delivery-notices, sales-order-changes,
    replacements, service-fulfillments, consignment-commercial, credit)
  - launcher converge (≤ 6 primary entries)
  - extended decision-reports (sales-quotation-summary, sales-delivery-notice-
    execution, sales-replacement-execution, sales-ranking, credit-exceptions)
  - legacy compatibility behavior

Wave G  Concurrency / MySQL Hardening / Final Acceptance
  - R-SAL-01..24 evidence
  - 36 / 36 audit + 24 / 24 race + 44 / 44 UAT evidence
  - real MySQL functional + concurrency + performance gates
  - build, git diff --check, gates
```

### 29.47 SC Design Traceability

```text
SC01..SC114 expected = 114
SC01..SC114 designed  = 114
missing              = 0
```

Per-SC trace table is finalized in `document.md §34.13` (Manual → Audit CAP → Coverage → Gap → RC → SC family). This §29 Design contributes the per-SC physical mapping as below.

Per-SC trace conventions:

| Field | Source |
|---|---|
| SC ID | §34.3 |
| Requirement family | §34.3 (SC name) + §34.2 (scope status) |
| Physical model | this §29.2 + §29.4-29.27 |
| Service/owner | this §29.3 |
| API | this §29.31 |
| Permission | this §29.33 |
| Transaction | this §29.43 |
| Audit | this §29.35 |
| UAT refs | this §29.39 |
| Race refs | this §29.44 |
| Implementation wave | this §29.46 |

(No orphan SC; capability 1=physical 1-or-more rows is NOT required; classification per §29.2.1.)

### 29.48 Invariant Traceability

```text
S01..S20 expected = 20
S01..S20 designed = 20
missing          = 0
```

Per-invariant mechanism map:

| ID | Invariant | Design mechanism | Physical constraint | Transaction check |
|---|---|---|---|---|
| S01 | Sales commercial ≠ Inventory physical truth | 商业 fields never write to inventory_* | inventory_* columns immutable to Sales | never OUT_OF_SCOPE code path writes inventory directly |
| S02 | Sales commercial ≠ Finance open-item truth | AR / advance written only via Finance adapter | n/a (Sales has no AR table write) | Finance adapter enforces |
| S03 | Sales commercial ≠ GL truth | voucher engine is Accounting & Analytics | n/a | n/a |
| S04 | Quotation conversion preserves source trace | sales_quotation_conversions table | PK on (quotation_id, sales_order_line_id) | verified in convert-to-so |
| S05 | Approved history cannot be silently rewritten | both paths → shared SO Change evidence/application + effective_version + READ-ONLY past snapshot | sales_order_items historical snapshot immutable; only unexecuted remainder receives next version | idempotency + FOR UPDATE + state machine |
| S06 | Source-line capacity cannot be over-executed | sales_delivery_items / return_order_items / delivery_notice_lines capacity checks | FK + capacity check | FOR UPDATE on line + capacity compute |
| S07 | Gift revenue 0 ≠ inventory/cost 0 | is_gift_line + commercial amount 0; COGS continues | flag column | confirmed at confirm path |
| S08 | Service fulfillment ≠ inventory movement | service_fulfillments + products.is_service_classification gate | service lines block SD confirm | pre-check at SD confirm |
| S09 | Delivery Notice ≠ Sales Delivery ≠ Inventory Movement | three distinct tables; not collapsed | PK + FK on their own paths | separate FOR UPDATE |
| S10 | Return ≠ Delete; Replacement ≠ Return; NO_SOURCE ≠ fake sale | explicit commercial_source_marker; replacement FK to return | CHECK constraint | FOR UPDATE on mode-specific source |
| S11 | No-Source Return must visibly remain NO_SOURCE | commercial_source_marker = 'NO_SOURCE' | check constraint | explicit marker on every read |
| S12 | Reservation intent ≠ canonical reservation truth | sales_reservation_intent + planning_reservations | n/a (Sales has no canonical reserved qty) | intent does not write reserved qty |
| S13 | Prepayment Gate ≠ Advance-Receipt truth | Sales owns gate decision; Finance owns money truth | n/a (Finance balance canonical) | gate reads only, writes only result |
| S14 | Credit exposure must not double-count stages | bucket transition model §29.23 | n/a (DERIVED) | transition rule at every credit-touching write |
| S15 | Credit Check mandatory BLOCK must fail closed | evaluateCredit MUST return BLOCK on over-limit; backend enforces | n/a | fail-closed enforced in backend authorization |
| S16 | Credit exception is bounded | credit_special_approval ceiling/expiry/scope | scope + ceiling columns | FOR UPDATE on approval PK |
| S17 | Credit Recalculation must not rewrite historical truth | credit_recalculation_history records but never mutates canonical | n/a | CHECK-only / cache-optional |
| S18 | Consignment location ≠ ownership ≠ settlement | three-layer separation; Sales requests Inventory ENTERPRISE-owned position until settlement/title transfer | n/a (Sales has no own physical ledger) | settlement serialized on commercial line |
| S19 | Business dates are authoritative | ISO YYYY-MM-DD business_date columns throughout | date columns | validated at API entry |
| S20 | Same base currency baseline; multi-currency OUT_OF_SCOPE | currency_code column is single base; multi-currency out-of-scope per §34.10 | n/a (single currency enforced) | API rejects non-base |

### 29.49 Acceptance Architecture

Design target gates:

```text
focused unit/integration      : per SC capability (Wave A..F)
Functional Sales UAT         : 44 scenarios (§34.5; UAT-S-01..44)
Responsive browser matrix    : 320 / 390 / 430 / 680 (Wave F)
FAST                         : pnpm test:fast
FULL                         : pnpm test (canonical FULL regression)
HEAVY                        : pnpm test:heavy
build                        : pnpm build
git diff --check             : clean (no semantic / whitespace error)
SQLite compatibility          : node --test with both engines (per §29.42)
real MySQL functional        : pnpm test:mysql
generic MySQL concurrency    : pnpm test:mysql:concurrency
Sales MySQL concurrency      : R-SAL-01..24 evidence plan (§29.44)
MySQL performance (if applies): pnpm test:mysql:performance (only if scale requires)
```

These gates must pass before Implementation is frozen.

### 29.50 Final Design State

```text
Sales & Customer Domain Design contains:
  - 1 architectural scope statement (§29.1)
  - 1 physical-model inventory (§29.2; 5 sub-categories A..E)
  - 1 canonical-writer inventory (§29.3)
  - 1 commercial foundation design (§29.4)
  - 11 capability-family designs (§29.5-29.16 / 29.17-29.18 / 29.19 / 29.20-29.29)
  - 1 source-capacity edge table (§29.30; 15 edges)
  - 1 API inventory (§29.31)
  - 1 lifecycle inventory (§29.32)
  - 1 RBAC/SOD design (§29.33)
  - 1 approval boundary (§29.34)
  - 1 audit design (§29.35)
  - 1 Mobile IA design (§29.36)
  - 1 route design (§29.37)
  - 1 responsive design (§29.38)
  - 1 reporting design (§29.39)
  - 1 historical compatibility matrix (§29.40; legacy-bypass-default-NO)
  - 1 schema constraints table (§29.41)
  - 1 SQLite/MySQL parity checklist (§29.42)
  - 1 transaction model (§29.43; canonical lock order)
  - 1 R-SAL-01..24 lock matrix (§29.44; with corrected lockable anchors)
  - 1 idempotency design (§29.45)
  - 1 implementation waves (§29.46)
  - 1 SC design traceability commitment (§29.47)
  - 1 invariant traceability (§29.48)
  - 1 acceptance architecture (§29.49)

Physical model counts (post-remote-review rebuild):
  A tables total                  = 69
    EXISTING_CONVERGE              = 25
    NEW                            = 44   (A-25..A-66 + A-68..A-69)
    DEPRECATED_NO_NEW_WRITES (tbl) =  0
  B existing-table extensions      =  6 (31 logical fields; 30 ADD + 1 reused)
  C derived views / projections   =  5 (4 pure-no + 1 controlled-hybrid; C-06 removed)
  D compatibility behaviors        =  6 (legacy read=YES; new write through bypass=NO)
  E deprecated-no-new-write fields =  1 (products.price_cents; single classification)

Sum check:
  A tables: 25 + 44 + 0 = 69 ✓
  Sub-categories are disjoint (every table belongs to exactly one of A classifications)
  Columns are NEVER counted as tables (see B for column extensions)

Sum checks (structural trace complete; product decisions frozen):
  114 SC  : 114 designed 0 orphan
   20 S##  : 20 designed 0 missing
   44 UAT  : 44 designed 0 missing
   24 RACE : 24 designed 0 missing 0 TBD
   36 CAP  : trace preserved; Requirement PASS / FROZEN
   15 Cross-Domain Boundary families  : 1:1 with §34.8

Frozen Dependency Discipline:
  - Customer identity  → Master & Engineering
  - Material identity  → Master & Engineering
  - Login/user identity → Platform (optional link only)
  - Salesperson identity → Sales & Customer (`salesperson_profiles.id`)
  - Sales-group identity → Sales & Customer (`sales_groups.id`)
  - Physical inventory → Inventory & Warehouse (V21 §32)
  - Reservation        → Planning (V19 §30)
  - OQC                → Manufacturing & Quality (V18 §29)
  - AR / Advance / Refund / Write-off / Invoice / Treasury → Finance Operations (V22 §33)
  - Voucher / GL       → Accounting & Analytics
  - RBAC / Workflow / Audit notification / Numbering → Platform

Sales never writes second ledger:
  - no Sales-side inventory table write
  - no Sales-side AR write
  - no Sales-side reservation qty write
  - no Sales-side voucher write
  - no Sales-side credit exposure mutable ledger
  - credit exposure = DERIVED (§29.24 default)

DR-SAL-01 Option A is approved: A-65 carries all four modes, both paths use the shared application service, and SC37..SC40 / UAT-S-15 / Wave 4 are internally aligned. External review returned PASS and user Freeze approval is confirmed; this Technical Design is `PASS / FROZEN` at content baseline `5469891b78acb5b03940944698e5c51a38cf5491`.

#### 29.50.1 Frozen-domain boundary matrix (task §21)

| Frozen Domain | Canonical truth consumed by Sales | Sales write allowed? | Adapter / contract | Design change required to frozen domain? |
|---|---|---|---|---|
| Master & Engineering (V17) | customer identity; product identity; warehouse identity; UoM foundation; service classification (via own table `product_commercial_classification`, NOT by adding column to products) | NO (NO CHANGE) | Customer/Product/Warehouse UoM as FK target; Service classification via Sales-owned extension | NO CHANGE — Sales does not add column to products |
| Planning (V19) | reservation canonical quantity (read-only) | NO direct write | canonical reservation adapter / `assertStrongReservationAvailability` | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** for finite EXPECTED-supply capacity + adjust/consume contract; no second balance |
| Manufacturing & Quality (V18) | OQC outcome | NO (NO CHANGE) | `assertQualityGate('OQC', deliveryId)` reader | NO CHANGE |
| Inventory & Warehouse (V21) | physical inventory truth; on-hand; locks; owner_type; consignment-position (ENTERPRISE-owned during consignment, see §29.19) | NO direct write (NO CHANGE) | `applyInventoryMutation`, `postTrackedMovement` adapters | **NO CHANGE** — V21 canonical position supports `owner_type = ENTERPRISE` at any position; consignment_commodity_location is modeled as a warehouse_id; consignment uses existing ENTERPRISE owner marker; no schema change required (see §29.19.4); do NOT silently redefine CUSTOMER-owned |
| Finance Operations (V22) | AR open amount; advance / unapplied / refund / write-off; collection; invoice; treasury; provisional / financial recognition; eligible prepayment (per §29.16); `settlement_unapplied_balances` (PREPAYMENT parent balance row) | NO (NO CHANGE) | `recognizeFinanceExposure` / `applyCreditAdjustment` / `generateVoucher` / `createSystemVoucher`; `financeAdapter.resolveCreditExposureComponents`, `financeAdapter.resolveARForCustomerSalesContext`; **`financeAdapter.resolveEligiblePrepaymentForSalesGate(..., lockMode = FOR_UPDATE)`** for R-SAL-15; **Finance mutations `applyUnappliedBalance` / `createRefund` / `reverseSettlementDocument` (PREPAYMENT/UNAPPLIED reduction)** must acquire `settlement_unapplied_balances.id FOR UPDATE` | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** (Repository-Evidence Final Closure; no conditional wording) for the canonical `lockMode = FOR_UPDATE` parent-balance row contract; see §29.16.3.8; other reads are NO CHANGE — Sales reads via adapter only; never reconstructs AR truth |
| Accounting & Analytics | voucher / GL | NO (NO CHANGE) | n/a | NO CHANGE |
| Platform | login/user identity; RBAC; workflow mechanics; audit notification; numbering; generic mechanics; document relation-conversion; **shared canonical idempotency_records (A-21)** | limited writes (ApprovalRequests for SALES_ORDER family); A-64 may hold a nullable FK to `users.id` but never writes Platform user business fields | Platform provides mechanics only; actual repo has no suitable generic parameter storage, so A-65 storage + namespace/codes/validation/business semantics remain Sales-owned; Sales uses A-21 for command identities | **NO CHANGE** — no Sales columns on `users` and no new Platform schema; Platform owns login/mechanics, Sales owns salesperson identity and Sales parameter semantics |

Required Sales Design change to a frozen domain = **NO CHANGE for most frozen domains** EXCEPT:

- **Inventory & Warehouse (V21) / Consignment**: **NO CHANGE** (V21 canonical position supports `owner_type = ENTERPRISE` at any position; consignment_commodity_location is modeled as a warehouse_id; no schema change required; see §29.19.4).
- **Finance Operations (V22) / Prepayment Gate (R-SAL-15)**: **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** (Repository-Evidence Final Closure decision; no conditional wording).
  Sales requires `financeAdapter.resolveEligiblePrepaymentForSalesGate(..., lockMode = FOR_UPDATE)` to acquire canonical Finance `settlement_unapplied_balances.id` (PREPAYMENT) FOR UPDATE in the same transaction.
  Current V22 does NOT yet provide the required MySQL parent-balance row lock on all R-SAL-15 balance-reducing paths; therefore the bounded extension covers:
    - Sales transactional locked-read adapter
    - Finance `applyUnappliedBalance` (acquire parent balance FOR UPDATE before re-read/validation)
    - Finance `createRefund` (acquire parent balance FOR UPDATE before capacity decision)
    - Finance `reverseSettlementDocument` for PREPAYMENT / UNAPPLIED reduction (acquire parent balance FOR UPDATE before remaining / validation / `settlement_reversal_items` mutation)
  Business semantics: UNCHANGED; canonical balance: `settlement_unapplied_balances` (NO CHANGE); duplicate truth: NONE.
  See §29.16.3.
- **Platform / shared / Idempotency (A-21 idempotency_records)**: **NO CHANGE**. A-21 is shared Platform infrastructure. Sales uses it for Sales command identities (semantic namespaces: quotation conversion, DN confirm, service fulfillment confirm, etc.). Sales owns the namespace meaning, not the storage infrastructure. See §29.16.2 / §29.45.

The 18 sales credits / 9 credit capability business semantics remain entirely within Sales-owned tables (sales_credit_parameters, sales_credit_check_rules, sales_credit_policy_snapshots, sales_credit_profile, sales_credit_check_result, sales_credit_special_approval, sales_credit_evaluation_*, sales_credit_recalculation_history) and consume Finance + Planning + Inventory canonical facts via existing adapters.

If Implementation evidence shows any of these require a frozen-domain schema change, then file:

  FROZEN_DOMAIN_INTEGRATION_DEFECT  (not a silent change)

or:

  BOUNDED INTEGRATION CONTRACT EXTENSION  (documented, scoped, auditable)

and revise this §29.50.1 before Implementation. Do NOT silently alter a frozen Domain schema.

Out of Design scope (per §34.10; not in this Domain closure):
  - multi-currency
  - external credit bureau / AI / ML / complex corporate-risk analytics
  - CRM extension
  - Generic Workflow engine
  - mobile IA wider than launcher ≤ 6 primary entries
  - schema migration code (Implementation)

External Review Result — PASS:
  - per §34.13 36/36 CAP trace
  - per §34.13.1 114/114 SC acceptance coverage
  - per §34.5 44 UAT-IDs
  - per §34.6 24 race IDs (no TBD)
  - per §34.4 20 invariants

Technical Design: PASS / FROZEN.
User Freeze approval: CONFIRMED.
```

---

### 29.51 Cross-References (§29 only)

| Topic | Section |
|---|---|
| Architecture / Ownership | §29.1 |
| Physical Model Inventory | §29.2 |
| Canonical Writer Inventory | §29.3 |
| Sales Commercial Foundation | §29.4 |
| Quotation Design | §29.5 |
| Sales Pricing Design | §29.6 |
| Order-Time Discount Design | §29.7 |
| Sales Order Canonical Model | §29.8 |
| Sales Order Change Design | §29.9 |
| Sales Order Fulfillment / Close Lifecycle | §29.10 |
| Delivery Notice Design | §29.11 |
| Sales Delivery Convergence | §29.12 |
| Sales Return Design | §29.13 |
| Replacement / Replenishment Design | §29.14 |
| Gift Line Design | §29.15 |
| Prepayment Gate Design | §29.16 |
| Reservation Intent Design | §29.17 |
| Service Item Sales Design | §29.18 |
| Consignment Three-Truth Design | §29.19 |
| Credit Architecture Overview | §29.20 |
| Credit Policy / Version / Effective Snapshot | §29.21 |
| Credit Profile | §29.22 |
| Credit Occupancy / Exposure Model | §29.23 |
| Credit Projection / Cache Decision | §29.24 |
| Credit Check Design | §29.25 |
| Credit Special Approval Design | §29.26 |
| Credit Evaluation | §29.27 |
| Credit Recalculation | §29.28 |
| Credit Query / Exception History | §29.29 |
| Source / Capacity Model | §29.30 |
| API Inventory | §29.31 |
| Lifecycle Inventory | §29.32 |
| RBAC / SOD Design | §29.33 |
| Approval / Workflow Boundary | §29.34 |
| Audit Design | §29.35 |
| Mobile IA Design | §29.36 |
| Route Design | §29.37 |
| Responsive Design | §29.38 |
| Reporting Design | §29.39 |
| Historical Compatibility | §29.40 |
| Schema Constraints | §29.41 |
| SQLite / MySQL Parity | §29.42 |
| Transaction Model | §29.43 |
| R-SAL-01..24 Lock Matrix | §29.44 |
| Idempotency Design | §29.45 |
| Implementation Waves | §29.46 |
| SC Design Traceability | §29.47 |
| Invariant Traceability | §29.48 |
| Acceptance Architecture | §29.49 |
| Final Design State | §29.50 |
| Cross-References | §29.51 |

---

## 30. Sales & Customer Domain Implementation Wave Plan

> This is the Implementation Sequencing Plan only. It was limitedly reopened on 2026-10-13 together with §29 to close the remote-review Requirement / Design defects. External review returned PASS and user Freeze approval is confirmed; the plan is now `PASS / FROZEN`. Waves 1–13 remain `NOT IMPLEMENTED / NOT ACCEPTED`.
> Plan-only output: no code, no migrations, no schema, no tests, no stages, no commits, no pushes, no tag, no version bump.

### 30.1 Total final wave count

```text
14 implementation waves (Wave 0 through Wave 13)
```

Each wave is small enough that one engineer / coding agent can implement, test, review the diff, and reason about its invariants as one coherent checkpoint. Regrouping / splitting is permitted if Implementation evidence demands it; this plan is the baseline.

### 30.2 Wave summary table

| Wave | One-line business objective | Primary SC IDs (count) | Primary new physical tables | Primary file changes (planned; not yet executed) |
|---|---|---|---|---|
| 0 | Schema / shared Sales infrastructure + migration runner readiness | n/a (foundation) | 0 | server/migrations/* (infrastructure; no new tables yet); existing migration files remain untouched |
| 1 | Sales parameters + Sales Groups / multi-membership + Customer commercial extension/xref + sellable rules + product commercial classification foundation | 6 (SC02..SC05, SC07, SC69) | 8 (`sales_parameters`, `sales_groups`, `salesperson_profiles`, `salesperson_group_memberships`, `customer_commercial_extensions`, `customer_material_xref`, `sales_sellable_scope_rules`, `product_commercial_classification`) | Sales-owned foundation modules + customer detail integration; no `users` / Master schema extension |
| 2 | Pricing engine + Order-Time Discount + customer price-list/discount-table defaults | 9 (SC15..SC23) | 5 (`sales_price_lists`, `sales_price_list_entries`, `sales_price_list_versions`, `sales_discount_schemes`, `sales_discount_scheme_rules`) | add exactly two A-39 nullable default FKs only after A-28/A-31 exist; contextual pricing/discount sub-page under existing Sales & Customer navigation; no top-level route |
| 3 | Quotation + Quotation conversion | 6 (SC09..SC14) | 3 (sales_quotations, sales_quotation_lines, sales_quotation_conversions) | server/modules/quotation.js (new); src/pages/quotations.jsx (new route); conversion API with idempotency |
| 4 | Sales Order enrichment + lifecycle + two-path Change + line schedule snapshot | 20 (SC24..SC29, SC31..SC44) | 2 (sales_order_changes, sales_order_change_lines) | shared canonical change application service; direct/document request handlers; additive SO/line snapshots; approval/version/audit concurrency contract |
| 5 | Delivery Notice + direct/notice-backed Sales Delivery convergence + tolerance execution | 11 (SC08, SC30, SC45..SC53) | 2 (delivery_notices, delivery_notice_lines) | truthful DIRECT_ORDER / DELIVERY_NOTICE source identity; shared SO capacity/gates plus DN capacity where applicable |
| 6 | Returns + Replacement | 8 (SC54..SC61) | 3 (sales_order_replacements, sales_order_replacement_lines, sales_replacement_fulfillments) | server/app.js SR handlers extended; return_orders.commercial_source_marker additive col; src/pages/returns.jsx extended with replacement tab |
| 7 | Finance V22 R-SAL-15 bounded extension + Prepayment Gate + Reservation Intent | 8 (SC01, SC62..SC68) | 3 (sales_prepayment_requirements, sales_prepayment_gate_results, sales_reservation_intent) | final SC01 execution via reservation behavior after order-change and delivery parameter controls; Finance locked-read extension |
| 8 | Service Fulfillment + Consignment commercial | 8 (SC70..SC77) | 4 (service_fulfillments, consignment_commercial_documents, consignment_commercial_lines, consignment_commodity_locations) | server/modules/service-fulfillment.js; server/modules/consignment.js; src/pages/consignment.jsx; SD confirm gate |
| 9 | Credit stable anchor + Credit Policy + Profile foundation | 7 (SC83..SC89) | 6 (credit_lock_anchors, credit_policy_snapshots, credit_parameters, credit_check_rules, credit_profile, credit_profile_ratings) | server/modules/credit-anchor.js (new; ensureCreditLockAnchor + first-use provisioning); server/modules/credit-policy.js; legacy credit_profile backfill in migration |
| 10 | Credit Check + Special Approval + Exposure | 10 (SC82, SC90..SC98) | 2 (credit_check_results, credit_special_approval) | server/modules/credit-check.js (evaluateCredit service); server/modules/credit-special-approval.js; PURE_DERIVED exposure; recognition-mode aware |
| 11 | Credit Evaluation + Reconciliation + Query | 9 (SC99..SC107) | 6 (credit_evaluation_indicator, credit_evaluation_scheme, credit_evaluation_model, credit_evaluation_scoring_sheet, credit_evaluation_result, credit_recalculation_history) | server/modules/credit-evaluation.js; credit_query_snapshot (DERIVED C-02) + credit_exposure_view (DERIVED C-01) query layer |
| 12 | Mobile IA + Reporting + Compatibility + Sales-group data-scope convergence | 5 (SC06, SC78..SC81) + 7 (SC108..SC114) | 0 | final backend group-filter/report proof + new routes; launcher ≤ 6 primary entries; decision reports extensions; responsive convergence |
| 13 | MySQL race hardening + Final domain acceptance | n/a (verification) | 0 | tests only; real MySQL functional + concurrency + performance gates; 24 race evidence plan executed |

### 30.3 Dependency DAG

```text
Wave 0 (Schema / shared Sales infrastructure)
  └─ Wave 1 (Customer commercial extensions + service classification foundation)
       ├─ Wave 2 (Pricing + Order-Time Discount)
       │    └─ Wave 3 (Quotation + Quotation conversion)
       │         └─ Wave 4 (Sales Order enrichment + lifecycle + Change)
       │              ├─ Wave 5 (Delivery Notice + Sales Delivery convergence)
       │              │    └─ Wave 6 (Returns + Replacement)
       │              │         └─ Wave 8 (Service Fulfillment + Consignment)
       │              ├─ Wave 7 (Finance V22 R-SAL-15 extension + Prepayment Gate + Reservation Intent)
       │              │    └─┐
       │              └─ Wave 9 (Credit stable anchor + Policy + Profile foundation)
       │                   └─ Wave 10 (Credit Check + Special Approval + Exposure)
       │                        └─ Wave 11 (Credit Evaluation + Query)
       ├─ Wave 6 ─┐
       │         │
       ├─ Wave 7 ─┤
       │         │
       ├─ Wave 8 ─┼→ Wave 12 (Mobile IA + Reporting + Compatibility convergence) → Wave 13 (MySQL race hardening + Final domain acceptance)
       │         │
       └─ Wave 11 ┘
```

No cycles. Every dependency is explicit. Wave 12 depends on Waves 6 / 7 / 8 / 11 (the branches that produce the workflows Wave 12 must report / expose / reconcile). **Wave 13 depends on Wave 12**; the convergence edge is `Wave 12 → Wave 13`, which transitively requires every preceding business branch.

### 30.4 SC allocation (114/114, duplicates 0, missing 0)

```text
SC expected = 114
SC assigned = 114
duplicates  = 0
missing    = 0
```

| Wave | SC IDs (count) |
|---|---|
| 1 | SC02, SC03, SC04, SC05, SC07, SC69 (6) |
| 2 | SC15, SC16, SC17, SC18, SC19, SC20, SC21, SC22, SC23 (9) |
| 3 | SC09, SC10, SC11, SC12, SC13, SC14 (6) |
| 4 | SC24, SC25, SC26, SC27, SC28, SC29, SC31, SC32, SC33, SC34, SC35, SC36, SC37, SC38, SC39, SC40, SC41, SC42, SC43, SC44 (20) |
| 5 | SC08, SC30, SC45, SC46, SC47, SC48, SC49, SC50, SC51, SC52, SC53 (11) |
| 6 | SC54, SC55, SC56, SC57, SC58, SC59, SC60, SC61 (8) |
| 7 | SC01, SC62, SC63, SC64, SC65, SC66, SC67, SC68 (8) |
| 8 | SC70, SC71, SC72, SC73, SC74, SC75, SC76, SC77 (8) |
| 9 | SC83, SC84, SC85, SC86, SC87, SC88, SC89 (7) |
| 10 | **SC82, SC90, SC91, SC92, SC93, SC94, SC95, SC96, SC97, SC98** (10 — Credit Exposure Canonical-Fact Invariant is primary here; runtime credit check / exposure / special approval require it) |
| 11 | SC99, SC100, SC101, SC102, SC103, SC104, SC105, SC106, SC107 (9) |
| 12 | SC06, SC78, SC79, SC80, SC81, SC108, SC109, SC110, SC111, SC112, SC113, SC114 (12) |
| 13 | verification only (all 114 SC acceptance covered by 1–12; Wave 13 verifies) |

Sum check: 6+9+6+20+11+8+8+8+7+10+9+12 = 114 ✓ (Wave 0 = n/a, Wave 13 = verification).

Primary wave means earliest **final-completion** wave, not first table creation. SC01 completes in Wave 7 (parameter storage W1; order-change W4; delivery controls W5; reservation behavior W7). SC06 completes in Wave 12 (identity/membership W1; Quotation/SO group snapshots W3/W4; final report/backend data-scope proof W12). SC08 and SC30 complete in Wave 5 when commercial defaults/UoM resolution plus line snapshot and DN/SD tolerance execution are all executable. No SC ID is added, removed, or duplicated.

### 30.5 Invariant allocation (20/20)

```text
S expected = 20
S assigned = 20
missing   = 0
```

| Invariant | First enforcing wave | Final verifying wave |
|---|---|---|
| S01 (commercial ≠ inventory) | 1 (Customer commercial extensions; SD confirm path enforces) | 13 (full MySQL regression) |
| S02 (commercial ≠ AR) | 4 (SO enrichment; AR adapter paths) | 13 |
| S03 (commercial ≠ GL) | 4 (voucher flows deferred to Finance) | 13 |
| S04 (Quotation conversion preserves source trace) | 3 (Quotation conversion) | 13 |
| S05 (history not silently rewritten) | 4 (SO Change; commercial_close_state) | 13 |
| S06 (source-line capacity not over-executed) | 5 (DN capacity; SD confirm) | 13 |
| S07 (Gift revenue 0 ≠ cost 0) | 4 (is_gift_line flag; COGS continues) | 13 |
| S08 (Service ≠ Inventory) | 8 (Service Fulfillment gate; no inventory OUT) | 13 |
| S09 (DN ≠ SD ≠ Inventory) | 5 (DN lifecycle; SD reads DN; Inventory V21) | 13 |
| S10 (Return ≠ Delete; Replacement ≠ Return; NO_SOURCE ≠ fake sale) | 6 (3-mode return; replacement) | 13 |
| S11 (NO_SOURCE marker) | 6 (NO_SOURCE commercial_source_marker) | 13 |
| S12 (Reservation intent ≠ canonical reservation) | 7 (sales_reservation_intent; Planning canonical) | 13 |
| S13 (Prepayment Gate ≠ Advance-Receipt truth) | 7 (R-SAL-15 financeAdapter; canonical V22 balance lock) | 13 |
| S14 (Credit exposure no double-count) | 10 (recognition-mode aware bucket transition) | 13 |
| S15 (BLOCK fail-closed) | 10 (evaluateCredit + ensureCreditLockAnchor) | 13 |
| S16 (Credit exception bounded) | 10 (credit_special_approval; ceiling + scope + expiry) | 13 |
| S17 (Recalculation no historical rewrite) | 11 (credit_recalculation_history; CHECK-only default) | 13 |
| S18 (Consignment location ≠ ownership ≠ settlement) | 8 (3-layer separation) | 13 |
| S19 (Business dates authoritative) | 4 (SO creation; enforced ISO date) | 13 |
| S20 (Single base currency) | 2 (Pricing engine; no multi-currency) | 13 |

### 30.6 UAT allocation (44/44)

```text
UAT expected = 44
assigned    = 44
missing     = 0
```

| Wave | UAT IDs (count) |
|---|---|
| 1 | no final-completion UAT (foundation focused tests only) (0) |
| 2 | UAT-S-04..09 (Pricing + override + snapshot + Discount) (6) |
| 3 | UAT-S-01..03 (Quotation lifecycle + conversion) (3) |
| 4 | UAT-S-10..16 (SO parties / gift / tax terms / submit / change / fulfill) + UAT-S-39 (edit policy) + UAT-S-42 (commercial tax-basis boundary) + UAT-S-43 (gift cost retention); Sales-foundation partial assertions only (10) |
| 5 | UAT-S-17 (DN capacity) + UAT-S-18 (SD confirm) (2) |
| 6 | UAT-S-19..21 (3-Return modes) + UAT-S-22 (Replacement) (4) |
| 7 | UAT-S-23 (Prepayment Gate) + UAT-S-24 (Reservation Intent) + UAT-S-28 (final Sales foundation) + UAT-S-40 (canonical read-only) (4) |
| 8 | UAT-S-25 (Service Item) + UAT-S-26..27 (Consignment) + UAT-S-41 (consignment location / ownership / settlement distinction) (4) |
| 9 | UAT-S-29 (Credit Profile) + UAT-S-30 (Credit Parameters + Rules) (2) |
| 10 | UAT-S-31 (Occupancy transition) + UAT-S-32 (Credit Check) + UAT-S-33 (Special Approval) (3) |
| 11 | UAT-S-34 (Recalculation) + UAT-S-35 (Query + Exception) + UAT-S-36 (Evaluation) (3) |
| 12 | UAT-S-37 (Reporting — execution) + UAT-S-38 (Reporting — outstanding + GP + ranking) + UAT-S-44 (Permission / RBAC / SOD) (3) |

Sum: 0+6+3+10+2+5+4+3+2+3+3+3 = 44 ✓

The Sales Order Change acceptance assigned to Wave 4 contains a parameterized matrix over all four `order_change_mode` values and both path types: DISABLED blocks both; each single-path mode admits only its named path; BOTH admits both without permission or approval bypass. Every admitted case proves separate requester/approver, canonical apply reuse, idempotent replay, append-only before/after evidence, monotonic effective version and non-retroactive parameter snapshot. Negative cases cover stale base version, forbidden field/source reassignment, reduction below notified/delivered/reserved/recognized quantity, missing authority, self-approval and adapter/audit failure rollback. R-SAL-07 / 08 / 18 provide concurrency acceptance; no new Race ID is required.

### 30.7 Race allocation (24/24)

```text
Race Requirement IDs assigned = 24 / 24

Materialized executable MySQL race scenarios
= 23  (all R-SAL-01..24 except R-SAL-23)

Conditional structural race
= 1
  R-SAL-23
  (frozen PURE_DERIVED baseline; structurally non-materialized under current baseline)

Race coverage
= 24 / 24  (R-SAL-23 covered as structural assertion, not materialized test)
TBD = 0
```

R-SAL-23 keeps its frozen PURE_DERIVED conditional semantics; structurally possible from Wave 9 onward (anchor infrastructure), but materially non-materialized until persisted cache is introduced (which is NOT the chosen baseline).

Acceptance form under the frozen baseline:

```text
Race coverage                 = 24 / 24
Materialized MySQL race tests = 23
Structural assertion races     = 1 (R-SAL-23: "no persisted mutable Credit Exposure
                              cache exists; no stale rebuild can overwrite newer
                              exposure state; therefore the cache-rebuild race
                              is structurally non-materialized")
```

If implementation later proposes a persisted Credit Exposure cache, STOP + REQUIREMENT_REOPEN_REQUIRED / DESIGN_REOPEN_REQUIRED.

| Race | First structurally possible | First executable MySQL test | Final acceptance |
|---|---|---|---|
| R-SAL-01 | 5 (SD confirm) | 5 | 13 |
| R-SAL-02 | 7 (Reservation Intent + Planning) | 7 | 13 |
| R-SAL-03 | 6 (Return) | 6 | 13 |
| R-SAL-04 | 4 (M14 Sales Discount; existing) | 4 (already exists) | 13 |
| R-SAL-05 | 5 (SD vs SR) | 5 | 13 |
| R-SAL-06 | 3 (Quotation convert) | 3 | 13 |
| R-SAL-07 | 4 (SO Change vs approve) | 4 | 13 |
| R-SAL-08 | 4 (SO Change vs SD) | 4 | 13 |
| R-SAL-09 | 6 (SD vs Return/Reopen) | 6 | 13 |
| R-SAL-10 | 6 (Return vs Replacement) | 6 | 13 |
| R-SAL-11 | 2 (Pricing vs Order approval) | 2 | 13 |
| R-SAL-12 | 9 (CREDIT_OBJECT anchor) | 9 | 13 |
| R-SAL-13 | 10 (Special Approval vs Order) | 10 | 13 |
| R-SAL-14 | 10 (Credit release vs Collection/Return) | 10 | 13 |
| R-SAL-15 | 7 (Prepayment Gate vs Finance) | 7 | 13 |
| R-SAL-16 | 5 (DN create vs SO capacity) | 5 | 13 |
| R-SAL-17 | 5 (SD vs DN remaining) | 5 | 13 |
| R-SAL-18 | 5 (SO Change vs DN) | 5 | 13 |
| R-SAL-19 | 5 (SO Close vs DN/SD) | 5 | 13 |
| R-SAL-20 | 8 (Consignment settlement) | 8 | 13 |
| R-SAL-21 | 8 (Consignment settlement vs return) | 8 | 13 |
| R-SAL-22 | 8 (Service fulfillment) | 8 | 13 |
| R-SAL-23 | 9 (Credit recalculation; PURE_DERIVED) | 13 (only structurally asserted) | 13 (structural assertion) |
| R-SAL-24 | 9 (POLICY_SCOPE + CREDIT_OBJECT) | 9 | 13 |

### 30.8 Physical schema / migration allocation

```text
new physical tables total = 44
corrected existing-table extension inventory = 6 tables / 31 logical fields
actual NEW extension fields requiring schema migration = 30
existing reused extension fields requiring NO ADD COLUMN = 1
  sales_deliveries.billing_mode
duplicate ADD attempts = 0
```

The corrected §29 inventory is the logical Design inventory. Wave 1 adds eight Sales-owned tables and zero fields to existing tables. Wave 2 adds nullable `default_pricing_list_id` / `default_discount_scheme_id` only after A-28/A-31 exist.

| Existing table | Logical field | Frozen §29 classification | Current physical state | Implementation wave | Migration action |
|---|---|---|---|---:|---|
| `customer_commercial_extensions` | `default_pricing_list_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 2 | `ADD` after `sales_price_lists`; nullable FK, no fabricated default |
| `customer_commercial_extensions` | `default_discount_scheme_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 2 | `ADD` after `sales_discount_schemes`; nullable FK, no fabricated default |
| `sales_orders` | `salesperson_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; FK A-64 |
| `sales_orders` | `sales_group_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; FK A-63 |
| `sales_orders` | `settlement_party_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `payer_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `customer_material_xref_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `commercial_tax_code` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `tax_inclusive` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `required_prepayment_cents` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `reservation_intent_state` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `commercial_close_state` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `gift_summary_cents` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `commercial_pricing_uom_code` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_orders` | `effective_version` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD INTEGER NOT NULL DEFAULT 1 CHECK >= 1`; initialize new SO at `1`; legacy backfill `1` is a compatibility baseline only; canonical application uses locked-read + CAS |
| `sales_order_items` | `is_gift_line` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `commercial_tax_basis` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `tax_inclusive_assumption` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `pricing_uom_code_applied` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `qty_break_applied_min` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `qty_break_applied_max` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD` |
| `sales_order_items` | `planned_delivery_date` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; bounded one-schedule-per-line identity is the item id |
| `sales_order_items` | `upper_delivery_tolerance_bps` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; immutable approved snapshot; CHECK >= 0 |
| `sales_order_items` | `lower_delivery_tolerance_bps` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; immutable approved snapshot; CHECK 0..10000 |
| `sales_order_items` | `price_snapshot_json` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; nullable physical compatibility, mandatory validated server evidence for every Batch A new line; immutable after approval |
| `sales_order_items` | `discount_snapshot_json` | `NEW_LOGICAL_FIELD` | `ABSENT` | 4 | `ADD`; nullable physical compatibility, mandatory ordered stage/allocation evidence including explicit zero discount; immutable after approval |
| `sales_deliveries` | `delivery_notice_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 5 | `ADD` |
| `sales_deliveries` | `source_mode` | `NEW_LOGICAL_FIELD` | `ABSENT` | 5 | `ADD`; CHECK DIRECT_ORDER / DELIVERY_NOTICE / LEGACY_UNCLASSIFIED |
| `sales_deliveries` | `billing_mode` | `EXISTING_REUSED_FIELD` | `EXISTS` (`v13-phase6e-commercial-golive`) | 5 | `REUSE_EXISTING` |
| `sales_delivery_items` | `delivery_notice_line_id` | `NEW_LOGICAL_FIELD` | `ABSENT` | 5 | `ADD` |
| `return_orders` | `commercial_source_marker` | `NEW_LOGICAL_FIELD` | `ABSENT` | 6 | `ADD` |

```text
logical extension fields = 31 / 31
new schema fields to add = 30
existing extension fields reused = 1
duplicate ADD attempts = 0
```

| Wave | New tables | Existing tables extended | Migration scope (planned) |
|---|---|---|---|
| 0 | 0 | 0 | migration runner readiness only; no new migration content |
| 1 | 8 (`sales_parameters`, `sales_groups`, `salesperson_profiles`, `salesperson_group_memberships`, `customer_commercial_extensions`, `customer_material_xref`, `sales_sellable_scope_rules`, `product_commercial_classification`) | 0 | bounded Sales parameter codes; independent xref/sellable rules; customer/person anchor overlap locks; no `users` / Master extension; no Wave-2 FK; SQLite + MySQL compatible |
| 2 | 5 (`sales_price_lists`, `sales_price_list_entries`, `sales_price_list_versions`, `sales_discount_schemes`, `sales_discount_scheme_rules`) | `customer_commercial_extensions` (+ exactly `default_pricing_list_id`, `default_discount_scheme_id`, both nullable) | create all five targets with PK/UNIQUE/CHECK/FK metadata first; current Bootstrap materializes the four-column entry UNIQUE inline; canonical registry replay installs/verifies dialect-local normalized-key guards; add the two fields without rewriting rows; SQLite verifies PRAGMA/sqlite_master and MySQL verifies named real FKs/index/triggers through information_schema; fresh/upgrade/repeat converge or fail closed on mismatch |
| 3 | 3 (sales_quotations, sales_quotation_lines, sales_quotation_conversions) | 0 | new migration file; UNIQUE on (quotation_id, line_no); PR UNIQUE on (quotation_id, sales_order_line_id); idempotency_key column |
| 4 | 2 (sales_order_changes, sales_order_change_lines) | sales_orders (+ 13 cols: salesperson_id, sales_group_id, settlement_party_id, payer_id, customer_material_xref_id, commercial_tax_code, tax_inclusive, required_prepayment_cents, reservation_intent_state, commercial_close_state, gift_summary_cents, commercial_pricing_uom_code, effective_version), sales_order_items (+ 11 cols: is_gift_line, commercial_tax_basis, tax_inclusive_assumption, pricing_uom_code_applied, qty_break_applied_min, qty_break_applied_max, planned_delivery_date, upper_delivery_tolerance_bps, lower_delivery_tolerance_bps, price_snapshot_json, discount_snapshot_json) | additive snapshot columns; JSON columns and other commercial fields remain nullable for legacy rows but are mandatory in the canonical new writer; `effective_version` alone is NOT NULL, initializes/backfills to compatibility baseline `1`, then advances only through locked canonical change application + CAS |
| 5 | 2 (delivery_notices, delivery_notice_lines) | sales_deliveries (+ `delivery_notice_id`, `source_mode`; reuse existing `billing_mode`), sales_delivery_items (+ `delivery_notice_line_id`) | source_mode truthfully distinguishes direct/notice/legacy; no fake DN; common SO line lock/tolerance/gates, plus DN lock only for notice-backed path; billing_mode reused, no duplicate ADD |
| 6 | 3 (sales_order_replacements, sales_order_replacement_lines, sales_replacement_fulfillments) | return_orders (+ commercial_source_marker) | new migration file; explicit replacement fulfillment evidence; legacy return rows NULL marker → treat as DELIVERY_BACKED |
| 7 | 3 (sales_prepayment_requirements, sales_prepayment_gate_results, sales_reservation_intent) | 0 | new migration file; PK on (sales_order_id, line_no); snapshot_key idempotency; Finance R-SAL-15 extension plus Planning EXPECTED-supply bounded contract extension before enabling that mode |
| 8 | 4 (service_fulfillments, consignment_commercial_documents, consignment_commercial_lines, consignment_commodity_locations) | 0 | new migration file; consignment FK; consignment_commodity_locations is the commercial location identity (≠ physical warehouse_id) |
| 9 | 5 (credit_lock_anchors, credit_policy_snapshots, credit_parameters, credit_check_rules, credit_profile) + credit_profile_ratings (A-52, 1 more) | 0 | new migration file; UNIQUE (anchor_key) NOT NULL on credit_lock_anchors; PK on credit_parameters (code, effective_from); PK on credit_profile (customer_id, salesperson_id, credit_object_type, credit_object_id, effective_from); legacy bootstrap migration for credit_profile + credit_lock_anchors over existing credit_profile tuples |
| 10 | 2 (credit_check_results, credit_special_approval) | 0 | new migration file; PR UNIQUE (source_credit_check_result_id) on credit_special_approval; FK to credit_policy_snapshots + credit_control_anchor |
| 11 | 6 (credit_evaluation_indicator, credit_evaluation_scheme, credit_evaluation_model, credit_evaluation_scoring_sheet, credit_evaluation_result, credit_recalculation_history) | 0 | new migration file; bounded multi-scorer per scoring_sheet |
| 12 | 0 | 0 | no schema changes; UI work only |
| 13 | 0 | 0 | no schema changes; tests only |

Sum check: 8+5+3+2+2+3+3+4+6+2+6 = 44 ✓ (matches corrected Design)

Wave 1 proof: NEW tables = 8; existing-table extension tables = 0; existing-table extension fields = 0; dangling FK targets = 0; undefined physical FK identities = 0; Wave-2 early business tables = 0; Master/Platform schema changes = 0.

### 30.9 Finance V22 R-SAL-15 bounded extension wave

The Finance V22 R-SAL-15 bounded extension is scheduled in **Wave 7 (Finance V22 R-SAL-15 bounded extension + Prepayment Gate + Reservation Intent)**.

Required contract introduced in Wave 7:

```text
financeAdapter.resolveEligiblePrepaymentForSalesGate(
  customer_id, business_date, gate_stage, sales_order_id,
  remaining_required_cents, lockMode = FOR UPDATE,
  db_transaction_context
) → acquires FOR UPDATE on canonical V22 settlement_unapplied_balances
  (balance_type = 'PREPAYMENT') in deterministic order, re-reads child
  effects (balance_applications, financial_refunds, applicable reversal
  effects), returns remaining eligible amount and source_balance_locked
  identities; locks held until caller transaction commits / rolls back.

Finance V22 mutations:
  applyUnappliedBalance
  → acquires settlement_unapplied_balances.id FOR UPDATE
    before remaining-capacity validation
  createRefund
  → acquires parent settlement_unapplied_balances.id FOR UPDATE
    before remaining-capacity validation
  reverseSettlementDocument (PREPAYMENT / UNAPPLIED reduction)
  → acquires parent settlement_unapplied_balances.id FOR UPDATE
    before remaining / validation / settlement_reversal_items mutation
```

Finance business semantics UNCHANGED. Canonical balance UNCHANGED. NO conditional wording. NO new Finance balance.

Wave 7 reports separately (per task §25) the Finance files changed and why each change is bounded.

Wave 7 must exist before the Sales Prepayment Gate is considered complete. Wave 11 (Credit Evaluation + Query) does NOT depend on Prepayment Gate; it can proceed in parallel after Wave 10.

### 30.10 Credit implementation sequence

Credit implementation sequence is:

```text
Wave 9  : credit_lock_anchors + credit_policy_snapshots + credit_parameters
         + credit_check_rules + credit_profile (+ credit_profile_ratings)
         + ensureCreditLockAnchor provisioning + legacy bootstrap
         (stable anchor; must exist BEFORE any Credit Check / mutation)

Wave 10 : credit_check_results + credit_special_approval
         + evaluateCredit() service
         + PURE_DERIVED exposure derivation
         + recognition-mode aware (DIRECT_BUSINESS / INVOICE_DRIVEN /
           PROVISIONAL_TO_FINANCIAL) bucket transition
         (R-SAL-12 anchored on CREDIT_OBJECT; R-SAL-13; R-SAL-14)

Wave 11 : credit_evaluation_indicator + scheme + model + scoring_sheet
         + result + credit_recalculation_history
         + credit_query_snapshot (DERIVED C-02) + credit_exposure_view
         (DERIVED C-01) query layer
         (R-SAL-23 conditional on PURE_DERIVED)

Wave 13 : MySQL race hardening + final domain acceptance (all materialized Sales MySQL race scenarios + R-SAL-23 structural assertion; no artificial Credit Exposure cache introduced)
```

R-SAL-12 / R-SAL-13 / R-SAL-14 become executable from Wave 10 onward. R-SAL-23 remains a structural assertion under the frozen PURE_DERIVED baseline (no persisted cache introduced; Wave 13 documents the conditional status). R-SAL-24 anchor infrastructure becomes executable from Wave 9 onward.

### 30.11 Mobile / frontend sequence

Frontend work is concentrated in **Wave 12 (Mobile IA + Reporting + Compatibility convergence)** but each prior wave that introduces a user-visible workflow may include a small frontend integration AFTER the backend contract is stable.

| Wave | Backend stability point | Frontend integration scope |
|---|---|---|
| 1 | customer_commercial_extensions | customer detail extension panel; (none) for new route |
| 2 | pure price/discount resolvers + DRAFT/ACTIVE/RETIRED lifecycle | one contextual pricing/discount sub-page reached from existing Sales & Customer navigation; no new launcher tile or top-level route; LIST → DETAIL → EDITOR/WORKFLOW pattern |
| 3 | quotation API | quotations new route (LIST / DETAIL / EDITOR / CONVERT-TO-SO) |
| 4 | SO enrichment + change | SO editor extended; SO change workflow (LIST / DETAIL / EDITOR) |
| 5 | DN API | delivery-notices new route (LIST / DETAIL / EDITOR) |
| 6 | return + replacement | returns route extended with replacement tab |
| 7 | Prepayment Gate | prepayment sub-page inside SO context |
| 8 | service + consignment | service-fulfillment list inside SO; consignment new route |
| 9 | credit_lock_anchors | (admin / setup only) |
| 10 | credit check + special approval | credit-check evaluate surface; credit-special-approvals new route |
| 11 | credit evaluation | credit-evaluation new route |
| 12 | (consolidation) | new sales-customer launcher (≤ 6 primary entries); decision reports extensions; consolidated responsive acceptance reruns |

Widths remain 320 / 390 / 430 / 680. 390px is primary. Wave-2 contextual pricing UI is included in the same matrix. Touch targets ≥ 44 CSS px. Core tasks do not depend on permanent horizontal scroll. This section schedules later implementation only; the bounded design reopen changes no frontend code.

### 30.12 MySQL verification sequence

MySQL verification is **NOT** deferred to the final wave.

For every wave that introduces any of the following:

```text
FOR UPDATE
source capacity
credit anchor
Finance shared lock
idempotency uniqueness
```

a MySQL verification checkpoint is planned **within that wave**.

| Wave | MySQL verification scope |
|---|---|
| 0 | migration runner on real MySQL (smoke) |
| 1 | eight-table FK / UNIQUE / CHECK parity; SYSTEM/document-type parameter resolution; independent xref/sellable interval rejection; salesperson multi-group/exactly-one-default; legacy fail-closed; second initialization idempotency |
| 2 | fresh Wave-2 init, exact Wave-1 upgrade, and repeated init; exactly five tables + two nullable A-39 fields; entry PK + ordered four-column normalized-key UNIQUE materialized inline by current Bootstrap, with no generated digest; duplicate probe and version FK target; LINE/HEADER CHECK parity; greatest discount rule version only; server-canonical pricing evidence; integer micros/bps/cents; named A-39 MySQL FKs + SQLite FK metadata; overlap/cycle rejection; ACTIVE immutability; resolver zero-write; lifecycle replay/audit |
| 3 | UNIQUE on conversion PK; idempotency_key UNIQUE on real MySQL |
| 4 | four-mode/path parity; request/apply idempotency; effective_version monotonic; R-SAL-07/08 shared lock order on MySQL |
| 5 | DN capacity locks; legacy SD path coexistence on MySQL |
| 6 | return source marker; replacement line capacity on MySQL |
| 7 | R-SAL-15 financeAdapter locked-read on real MySQL; PREPAYMENT balance FOR UPDATE |
| 8 | service fulfillment FOR UPDATE; consignment lock |
| 9 | FOR UPDATE on credit_lock_anchors; ensureCreditLockAnchor convergence; legacy bootstrap on real MySQL |
| 10 | R-SAL-12 / R-SAL-13 / R-SAL-14 on real MySQL with full anchor |
| 11 | R-SAL-23 conditional; bounded multi-scorer locks on real MySQL |
| 12 | UI integration smoke on real MySQL |
| 13 | all materialized Sales MySQL race scenarios (R-SAL-01..22 + R-SAL-24) + R-SAL-23 structural assertion; pnpm test:mysql / pnpm test:mysql:concurrency |

Wave 13 reruns all 23 materialized Sales MySQL race scenarios on real MySQL and verifies the R-SAL-23 structural assertion.

### 30.13 Final domain acceptance wave (Wave 13)

Wave 13 final domain acceptance runs:

```text
focused unit + integration per wave
Functional Sales UAT 44 / 44 (UAT-S-01..44 all executable)
Responsive browser matrix 320 / 390 / 430 / 680
FAST
FULL
HEAVY
build
git diff --check
SQLite compatibility per §29.42
real MySQL functional
generic MySQL concurrency
Sales MySQL concurrency
  materialized executable MySQL race scenarios = 23  (R-SAL-01..22, R-SAL-24)
  structural assertion
    R-SAL-23  (PURE_DERIVED baseline; "no persisted mutable Credit Exposure
               cache exists; no stale rebuild can overwrite newer
               exposure state; cache-rebuild race structurally
               non-materialized under the current baseline")
  = 23 + 1 = 24 / 24 requirement coverage
MySQL performance (if scale requires)
```

Acceptance criteria match §34.11 (8 criteria A–H) with final counts 114/114 / 20/20 / 44/44 / 24/24 (23 materialized + 1 structural) / 36-36 / 0 TBD.

R-SAL-23 acceptance form is a structural assertion under the PURE_DERIVED baseline. No artificial cache is created just to make R-SAL-23 materialized.

### 30.14 Risk matrix

| Wave | Risk | Classification | Reason |
|---|---|---|---|
| 0 | migration runner | LOW | infrastructure only |
| 1 | eight-table Sales commercial/parameter identity foundation | HIGH | cross-dialect interval locking, bounded parameter resolution, independent sellable scope, exactly-one default and optional user link require SQLite/MySQL proof |
| 2 | pricing resolver; price snapshot immutability | MEDIUM | multi-currency, UoM, qty-break; resolved snapshot must be immutable (R-SAL-11) |
| 3 | quotation convert × 2; capacity; idempotency | HIGH | R-SAL-06 is the first user-visible source-capacity race |
| 4 | SO Change effective_version; commercial_close_state; historical immutability | HIGH | S05 (R-SAL-07 / R-SAL-08) |
| 5 | Direct/notice-backed delivery source integrity; legacy coexistence | HIGH | SO/DN capacity locks, common gates, R-SAL-16..19; S09; no fake DN |
| 6 | 3-mode return; replacement; order-backed without fake delivery | HIGH | R-SAL-09 / R-SAL-10; S10 / S11 |
| 7 | Finance V22 + Planning expected-supply bounded extensions | **CRITICAL** | S12/S13; R-SAL-02/R-SAL-15; finite expected capacity and canonical adjust/consume required |
| 8 | Service Fulfillment; Consignment ownership (Enterprise not Customer) | **HIGH** | S08 / S18; three-layer separation (commercial / inventory / settlement); R-SAL-20 / R-SAL-21; cross-domain lock on canonical V22 settlement; no second Finance balance |
| 9 | credit_lock_anchors + ensureCreditLockAnchor provisioning | **CRITICAL** | anchor infrastructure precedes any Credit runtime; legacy backfill on real MySQL |
| 10 | R-SAL-12 / R-SAL-13 / R-SAL-14; recognition-mode aware; OLD/NEW snapshot | **CRITICAL** | S14 / S15 / S16; R-SAL-24; first executable Credit Check |
| 11 | credit evaluation; bounded multi-scorer; recalculation | MEDIUM | R-SAL-23 conditional on PURE_DERIVED |
| 12 | Mobile IA; routes; launcher | MEDIUM | responsive matrix rerun; no schema |
| 13 | all materialized Sales MySQL race scenarios + R-SAL-23 structural assertion; final acceptance | **CRITICAL** | 23 materialized + 1 structural = 24 / 24 requirement coverage under PURE_DERIVED baseline; final domain acceptance |

### 30.15 Stop conditions

Each wave has explicit stop conditions. The Implementation agent MUST NOT silently "work around" any of these.

| Wave | Stop conditions (must be surfaced and reported) |
|---|---|
| all | capacity invariant cannot be preserved |
| all | frozen domain requires semantic change → REQUIREMENT_REOPEN_REQUIRED or DESIGN_REOPEN_REQUIRED |
| all | legacy data cannot migrate safely (no historical rewrite) |
| all | SQLite / MySQL semantics diverge (cannot produce same lock contract) |
| all | Credit exposure double-count discovered (R-SAL-12 invariant breach) |
| all | Finance adapter cannot inherit caller transaction (R-SAL-15 architectural breach) |
| all | APPLY_GUIDE.md appears in git diff --cached (user-owned state must not be staged) |
| 1 | Wave 1 needs a ninth table, any existing-table field, a Platform/Master schema change, an unbounded parameter code, or a Wave-2 FK target |
| 4 | SO Change cannot satisfy R-SAL-07 / R-SAL-08 (e.g. effective_version breaks) |
| 5 | New SD lacks explicit DIRECT_ORDER / DELIVERY_NOTICE source mode, fabricates a DN, or bypasses shared SO capacity/gates (§29.12.0) |
| 7 | Finance V22 cannot provide parent balance lock (extension cannot be implemented) |
| 9 | ensureCreditLockAnchor cannot be made create-or-converge safe (no fail-open) |
| 10 | Recognition-mode transition produces mixed-version decision (R-SAL-24 breach) |

### 30.15.1 Per-wave backend authorization (incremental RBAC / SOD)

SC108..SC114 (Permissions / RBAC / SOD) is primarily **allocated to Wave 12** for final permission matrix completion, launcher exposure, and UAT-S-44 final proof. However, **every earlier wave introducing a protected backend endpoint or mutation must implement its applicable** `backend permission check` **+** `SOD restriction` **+** `negative authorization test` **in the same wave**. Frontend-hidden-only is forbidden.

| Wave | Endpoint / mutation introduced | Required backend authorization (same wave) |
|---|---|---|
| 1 | Sales parameter / sales group / salesperson membership / customer commercial extension / xref / classification mutation | permission check + SOD on canonical parameter and salesperson/group assignment; backend data scope cannot be delegated to frontend |
| 2 | pricing resolver, price_override, discount resolver | permission check + separate override authority (PRICE OVERRIDE) per §34.7 P3 |
| 3 | quotation convert → SO | permission check |
| 4 | SO submit / approve / reject / close / cancel; direct/document SO Change request + canonical apply | separate direct-request/document-manage/approve permissions + requester ≠ approver + BOTH no-bypass per §34.7 P2 |
| 5 | DN confirm; SD confirm | permission check + reservation intent / prepayment / credit gate consumption |
| 6 | return confirm; replacement fulfill | permission check + return-mode / replacement-state guard |
| 7 | prepayment gate evaluate; reservation intent request/release | permission check + Prepayment override authority |
| 8 | service fulfillment confirm; consignment settle/return | permission check + Consignment owner-attribute guard (SELLER, NOT CUSTOMER) |
| 9 | credit anchor admin; profile rating apply; policy mutation | permission check + Credit Management must be enabled OR fail-closed per §29.22.1 |
| 10 | credit check evaluate; special approval request/decide | permission check + bounded authority ceiling for special approval per §34.7 P4 + fail-closed BLOCK if mandatory rule + missing profile |
| 11 | evaluation scoring finalize; recalculation run | permission check + bounded multi-scorer aggregation |
| 12 | final permission matrix; launcher exposure; cross-workflow SOD consolidation; UAT-S-44 final proof | consolidates the per-wave negative authorization tests; no retroactive security; no wave accepted frontend-hidden-only |
| 13 | verification only | re-runs the per-wave negative authorization test suite; full RBAC regression |

No wave may be accepted with `frontend-hidden only` authorization. If a wave cannot represent its required authorization while SC108..SC114 primary wave is Wave 12, the per-wave negative authorization for that endpoint must still be added in the wave that introduces the endpoint; Wave 12 only consolidates the final matrix.

For each wave the following fields are planned (not yet implemented):

```text
Wave ID

Business objective

SC IDs

Invariant IDs

UAT IDs

Race IDs

Dependencies (from §30.3 DAG)

Physical tables added (from §30.8)

Existing tables extended (from §30.8)

Backend files expected to change

Frontend files expected to change

Tests expected to be added/updated

Migration scope (from §30.8)

Compatibility responsibilities (legacy SD without DN; products.price_cents legacy fallback; legacy customer; legacy return source marker)

Frozen-domain integrations (Finance V22 R-SAL-15 from Wave 7; Accounting & Analytics reads; Platform A-21 idempotency)

Explicit OUT OF WAVE items (do not creep scope)

Acceptance gates (focused + integration + R-SAL evidence + MySQL checkpoint if applicable)

Commit boundary (one primary local commit after external review; no push)
```

### 30.16 Per-wave contract (canonical pattern)

For each wave the following fields are planned (not yet implemented):

```text
Wave ID

Business objective

SC IDs

Invariant IDs

UAT IDs

Race IDs

Dependencies (from §30.3 DAG)

Physical tables added (from §30.8)

Existing tables extended (from §30.8)

Backend files expected to change

Frontend files expected to change

Tests expected to be added/updated

Migration scope (from §30.8)

Compatibility responsibilities (legacy SD without DN; products.price_cents legacy fallback; legacy customer; legacy return source marker)

Frozen-domain integrations (Finance V22 R-SAL-15 from Wave 7; Accounting & Analytics reads; Platform A-21 idempotency)

Explicit OUT OF WAVE items (do not creep scope)

Acceptance gates (focused + integration + R-SAL evidence + MySQL checkpoint if applicable)

Commit boundary (one primary local commit after external review; no push)
```

### 30.17 Wave contract table (concise)

| Wave | Dependencies | New tables | Existing ext | Backend files | Frontend files | Tests | Migration | Compatibility | Frozen-domain integration | OUT OF WAVE | Acceptance | Commit boundary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | n/a | 0 | 0 | server/migrations/* runner; no new migration | none | migration-runner smoke | infrastructure | n/a | none | migration-runner passes on SQLite + MySQL | n/a | one local commit after review |
| 1 | Wave 0 | 8 (`sales_parameters`, `sales_groups`, `salesperson_profiles`, `salesperson_group_memberships`, `customer_commercial_extensions`, `customer_material_xref`, `sales_sellable_scope_rules`, `product_commercial_classification`) | 0 | bounded Sales foundation modules; no Platform / Master schema changes | customer detail extension panel only | parameter/xref/sellable interval races + membership exactly-one/default + FK/CHECK/legacy tests | Wave 1 registry steps; no forward FK | legacy missing extension/classification read-only; new writes fail closed; salesperson may lack login but cannot access group-scoped docs | Master/Platform read-only targets; Platform mechanics only | focused integration + SQLite/MySQL locking checkpoint; permission gate | one local commit after external review |
| 2 | Wave 1 | exactly 5 (price_lists, price_list_entries, price_list_versions, discount_schemes, discount_scheme_rules) | A-39 exactly two nullable FKs: `default_pricing_list_id` + `default_discount_scheme_id` | pricing/discount lifecycle modules; two POST pure resolver APIs; existing audit/idempotency services | contextual pricing/discount sub-page under existing Sales & Customer navigation; no top-level route | UAT-S-04..07 configuration/lifecycle/override; UAT-S-08 resolver evidence; UAT-S-09 deterministic discount calculation; four-column entry UNIQUE fresh/upgrade/repeat; LINE/HEADER + greatest-rule-version checks; canonical pricing mismatch; FK/CHECK/UoM/cycle/overlap/zero-write/RBAC/replay/audit parity | target-first five-table create; current Bootstrap inline <=4-column UNIQUE; no Adapter/generated digest; preserve rows; add/verify two real nullable FKs; fresh/upgrade/repeat convergence, mismatch fail-closed | no fabricated default; `products.price_cents` historical read/display only and never a new resolver/write fallback | Master UoM read-only; Platform `audit_logs`/A-21 mechanics reused with no schema change | no quotation/SO schema or writer, no actual SO snapshot persistence, no Master/Inventory/Finance/Platform schema, no sixth table | SC15..SC23 and UAT-S-04..09 Wave-2 evidence; S19/S20 preserved; R-SAL-11 only structural/version evidence until Wave-4 SO persistence + immutability test | one local commit after external review |
| 3 | Wave 2 | 3 (sales_quotations, sales_quotation_lines, sales_quotation_conversions) | 0 | quotation handlers with group-scope backend predicate from first route | quotations LIST / DETAIL / EDITOR / CONVERT | unit + R-SAL-06 + fail-closed group access | new migration file; PK + PR UNIQUE | n/a | n/a | UAT-S-01..03; R-SAL-06 evidence; UAT-S-28 partial | one local commit |
| 4 | Waves 1, 2, 3 | 2 (sales_order_changes, sales_order_change_lines) | sales_orders (+ 13 cols, including `effective_version`); sales_order_items (+ 11 cols, including `price_snapshot_json` / `discount_snapshot_json`) | shared canonical writer/change application service; direct/document handlers; group-scope + authoritative line snapshots; locked-read + version CAS | SO direct-change action + change-document workflow | UAT-S-10..16 including four-mode UAT-S-15; R-SAL-07/08/11; UAT-S-28 partial | additive migration; snapshot JSON nullable for legacy but required for new canonical lines; version initializes/backfills to baseline `1` and is not client-writable | later parameters/defaults never rewrite APPLIED history; approved snapshots/evidence remain append-only | n/a | SC37..SC40/UAT-S-15 final owner Wave 4; SC30 final W5 | one local commit |
| 5 | Wave 4 | 2 (delivery_notices, delivery_notice_lines) | sales_deliveries (+ `delivery_notice_id`, `source_mode`; reuse `billing_mode`); sales_delivery_items (+ `delivery_notice_line_id`) | direct/notice source capacity + tolerance enforcement | delivery-notices route | upper BLOCK + lower controlled-close + direct/notice races | explicit source_mode; no fake DN; no duplicate billing_mode | LEGACY_UNCLASSIFIED read-only | n/a | UAT-S-17/S-18; SC08+SC30 final completion; S09 | one local commit |
| 6 | Wave 5 | 3 (sales_order_replacements, sales_order_replacement_lines, sales_replacement_fulfillments) | return_orders (+ commercial_source_marker) | SR handlers; returns replacement tab | returns route extended | unit + R-SAL-09 / R-SAL-10 tests | additive migration | legacy returns without marker → DELIVERY_BACKED | n/a | UAT-S-19..22; S10/S11 | one local commit |
| 7 | Waves 5, 6 | 3 (sales_prepayment_requirements, sales_prepayment_gate_results, sales_reservation_intent) | 0 | finance locked-read; reservation intent adapters; Finance V22 bounded extension | prepayment/reservation sub-pages | R-SAL-02/R-SAL-15; MySQL locked-read; reservation mode matrix | new migration file; idempotency snapshot_key | n/a | Finance extension + Planning EXPECTED finite-capacity bounded extension | UAT-S-23/S-24/S-28/S-40 final; S12/S13 | one local commit + cross-domain change reports |
| 8 | Wave 7 | 4 (service_fulfillments, consignment_commercial_documents, consignment_commercial_lines, consignment_commodity_locations) | 0 | new service-fulfillment module; new consignment module; SD confirm gate (service items require confirmation) | src/pages/consignment.jsx; service sub-page inside SO | unit + R-SAL-20 / R-SAL-21 / R-SAL-22 tests | new migration file | n/a | n/a | UAT-S-25..27 + UAT-S-41; S08 / S18 invariant proof | one local commit |
| 9 | Wave 1 (foundation) | 5 (credit_lock_anchors, credit_policy_snapshots, credit_parameters, credit_check_rules, credit_profile) + credit_profile_ratings (1 more) = 6 | 0 | new credit-anchor module; ensureCreditLockAnchor provisioning; new credit-policy module; new credit-profile module; legacy backfill on real MySQL | credit-anchor admin / setup only; legacy bootstrap on real MySQL | unit + R-SAL-12 anchor lock test + R-SAL-24 anchor lock test; legacy bootstrap on real MySQL | new migration file; UNIQUE (anchor_key) NOT NULL; PK on credit_parameters (code, effective_from); legacy backfill on existing credit_profile tuples | n/a | n/a (no Finance) | UAT-S-29 + S-30; first anchor infrastructure in place; no fail-open | one local commit |
| 10 | Wave 9 | 2 (credit_check_results, credit_special_approval) | 0 | evaluateCredit() service; credit-special-approval workflow | credit-check evaluate surface; credit-special-approvals new route | unit + R-SAL-12 / R-SAL-13 / R-SAL-14 tests; recognition-mode tests; MySQL FOR UPDATE on real MySQL | new migration file; PR UNIQUE (source_credit_check_result_id) | n/a | n/a (Credit Special Approval uses existing Platform approval) | UAT-S-31..33; S14 / S15 / S16 invariant proof; first executable Credit runtime | one local commit |
| 11 | Waves 7, 10 | 6 (credit_evaluation_indicator, credit_evaluation_scheme, credit_evaluation_model, credit_evaluation_scoring_sheet, credit_evaluation_result, credit_recalculation_history) | 0 | new credit-evaluation module; credit_query_snapshot (DERIVED C-02); credit_exposure_view (DERIVED C-01) | credit-evaluation new route | unit + R-SAL-23 conditional test (PURE_DERIVED default); bounded multi-scorer aggregation | new migration file; bounded multi-scorer per scoring_sheet | n/a | n/a | UAT-S-34..36; S17 invariant proof; PURE_DERIVED default | one local commit |
| 12 | Waves 6, 7, 8, 11 | 0 | 0 | (no backend changes except small integration) | new routes (quotations / delivery-notices / sales-order-changes / sales-order-replacements / service-fulfillments / consignment-commercial / credit-*); sales-customer launcher ≤ 6 primary entries; decision reports extensions; src/styles/* | responsive matrix reruns (320/390/430/680); 390px primary | none | n/a | n/a | UAT-S-37 + S-38 + S-44; full responsive acceptance | one local commit |
| 13 | Wave 12 | 0 | 0 | (verification only) | (verification only) | all 23 materialized Sales MySQL race scenarios + R-SAL-23 structural assertion; pnpm test:mysql / pnpm test:mysql:concurrency; full FAST / FULL / HEAVY | none | n/a | n/a | full domain acceptance: 36/36 Audit CAP; 24/24 race (23 materialized + 1 structural); 44/44 UAT; 114/114 SC coverage; 0 TBD | one local commit |

### 30.18 Wave dependency DAG (text form)

```text
Wave 0 (Schema / shared Sales infrastructure)
  └─ Wave 1 (Customer commercial extensions + service classification foundation)
       ├─ Wave 2 (Pricing + Order-Time Discount)
       │    └─ Wave 3 (Quotation + Quotation conversion)
       │         └─ Wave 4 (Sales Order enrichment + lifecycle + Change)
       │              ├─ Wave 5 (Delivery Notice + Sales Delivery convergence)
       │              │    └─ Wave 6 (Returns + Replacement)
       │              │         └─ Wave 8 (Service Fulfillment + Consignment)
       │              ├─ Wave 7 (Finance V22 R-SAL-15 bounded extension + Prepayment Gate + Reservation Intent)
       │              │    └─┐
       │              └─ Wave 9 (Credit stable anchor + Policy + Profile foundation)
       │                   └─ Wave 10 (Credit Check + Special Approval + Exposure)
       │                        └─ Wave 11 (Credit Evaluation + Query)
       ├─ Wave 6 ─┐
       ├─ Wave 7 ─┤
       ├─ Wave 8 ─┼→ Wave 12 (Mobile IA + Reporting + Compatibility convergence) → Wave 13 (MySQL race hardening + Final domain acceptance)
       └─ Wave 11 ┘
```

No cycles. Every edge is explicit. Wave 12 depends on Waves 6 / 7 / 8 / 11, and Wave 13 depends on Wave 12.

### 30.19 SC trace 114/114 (validation)

```text
SC expected = 114
SC assigned = 114
duplicates  = 0
missing     = 0
```

Per-SC primary wave assignment is recorded in §30.4.

### 30.20 Invariant trace 20/20 (validation)

```text
S expected = 20
S assigned = 20
missing   = 0
```

Per-invariant first enforcing wave + final verifying wave is recorded in §30.5.

### 30.21 UAT trace 44/44 (validation)

```text
UAT expected = 44
assigned    = 44
missing     = 0
```

Per-UAT wave assignment is recorded in §30.6.

### 30.22 Race trace 24/24 (validation)

```text
Race Requirement coverage        = 24 / 24
Materialized executable scenarios = 23
Conditional structural races      = 1 (R-SAL-23)
final acceptance                   = 24 / 24
TBD                                = 0
```

Per-Race wave assignment is recorded in §30.7.

### 30.23 Frozen-domain boundary

Sales does not mutate Planning or Inventory truth directly. The reopen identifies one bounded Planning integration gap instead of silently changing the frozen domain.

| Frozen Domain | Classification |
|---|---|
| Master & Engineering (V17) | NO CHANGE |
| Planning (V19) | **BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED** in Wave 7: finite EXPECTED-supply authority plus adjust/consume/release adapter; canonical reservation quantity and writer remain Planning |
| Manufacturing & Quality (V18) | NO CHANGE |
| Inventory & Warehouse (V21) | NO CHANGE |
| Finance Operations (V22) | BOUNDED INTEGRATION CONTRACT EXTENSION (scheduled in Wave 7) |
| Accounting & Analytics | NO CHANGE |
| Platform / shared / Idempotency (A-21) | NO CHANGE |

### 30.24 Documentation updates planned

For each future Implementation wave:

```text
solution.md
→ implementation-specific function / module relationships (NOT changing frozen Design)
   (append to §30 with wave updates; not altering §29)

README.md
→ only if structure / runtime / repo usage changes (NO change unless Wave 0 / 12 introduces one)

log/YYYY-MM-DD.md
→ append-only development record per wave
```

If Implementation discovers genuine Requirement contradiction → STOP + REQUIREMENT_REOPEN_REQUIRED. If genuine frozen Design contradiction → STOP + DESIGN_REOPEN_REQUIRED. Do not silently drift.

### 30.25 Commit strategy (per wave)

Each wave receives ONE primary local checkpoint commit after external review.

```text
feat(sales): <wave business objective>
test(sales): <wave focused tests>
fix(sales): <fixes if needed>
```

No single giant commit. No push until external authorization.

---

## 30.26 Final Wave-Plan Summary

This limited reopen closed all identified documentation defects, including approved DR-SAL-01 Option A. External review returned PASS and the user approved formal Freeze. Requirement, Technical Design and Implementation Wave Plan are now `PASS / FROZEN` at content baseline `5469891b78acb5b03940944698e5c51a38cf5491`; Waves 1–13 remain not implemented and not accepted.

```text
14 implementation waves (Wave 0..13)
SC: 114/114, duplicates 0, missing 0
Invariant: 20/20
UAT: 44/44
Race: 24/24, TBD 0
Materialized executable MySQL races: 23
Conditional structural races: 1 (R-SAL-23)
Physical tables: 69 = 25 EXISTING_CONVERGE + 44 NEW + 0 deprecated tables
Physical NEW tables: 44
Corrected existing-table extension inventory: 6 tables / 31 logical fields
Actual extension migration work: 28 NEW fields
Existing extension fields reused: 1 (sales_deliveries.billing_mode)
Wave 1 physical allocation: 8 NEW tables / 0 existing-table extensions / 0 existing-table fields
Wave 2 dependency correction: creates sales_price_lists / sales_discount_schemes before adding A-39 default FKs
Sales fields on Platform users / Master customers / Master products: 0
Wave 13 dependency: Wave 12 → Wave 13
Finance V22 R-SAL-15 extension scheduled in Wave 7 (CRITICAL; before Sales Prepayment Gate completion).
credit_lock_anchors introduced in Wave 9 (BEFORE any Credit runtime).
PURE_DERIVED exposure preserved (no mutable exposure balance).
Master & Engineering boundary: NO CHANGE.
Platform boundary: NO schema change; generic mechanics remain Platform-owned, A-65 parameter storage/namespace/validation/semantics are Sales-owned.
Open product decisions: 0 (DR-SAL-01 Option A approved and documented).
```

```text
SALES & CUSTOMER DOMAIN

REQUIREMENT: PASS / FROZEN
TECHNICAL DESIGN: PASS / FROZEN
IMPLEMENTATION WAVE PLAN: PASS / FROZEN

FREEZE CONTENT BASELINE:
5469891b78acb5b03940944698e5c51a38cf5491

EXTERNAL REVIEW: PASS
USER FREEZE APPROVAL: CONFIRMED

WAVE 0:
PASS / FROZEN
73abaa146c644df72d2c040af4c26548bf92e880

WAVES 1–13:
NOT IMPLEMENTED / NOT ACCEPTED

NEXT:
APPLY_GUIDE.md isolated forward correction,
then Sales Wave 1 implementation.
```

The future freeze-record commit SHA is record metadata and must not be confused with the frozen content baseline above. This task does not begin the `APPLY_GUIDE.md` correction or Wave 1 implementation and does not stage, commit or push.

---

## 31. Sales & Customer Domain Implementation — Wave 0

> Post-freeze implementation record for the externally frozen §29 Design and §30 Wave Plan. This section records repository implementation facts only; it does not modify §29 or §30 semantics.

### 31.1 Scope and zero-DDL boundary

Wave 0 implements only the shared Sales & Customer migration infrastructure:

```text
SC implemented             = 0
NEW Sales business tables  = 0
NEW Sales business fields  = 0
business API               = 0
frontend                   = 0
```

`server/migrations/sales-customer-domain.js` owns the single canonical entrypoint `migrateSalesCustomerDomain(db)` and the bounded test helper `runSalesCustomerMigrations(db, steps)`. The production registry is frozen and empty in Wave 0; no dummy schema or persistent migration journal exists.

### 31.2 Registry and execution contract

Each future registry step has:

```text
id       globally unique non-empty step identity
wave     integer Wave 0..13 ordering key
migrate  migrate(db) implementation
```

Before executing any step, the runner validates the complete registry, rejects duplicate IDs / invalid waves / missing migration functions, and orders steps by `wave ASC, id ASC`. Each step receives the exact caller database object. The runner adds no implicit transaction around the registry because SQLite and MySQL DDL transaction behavior differs.

The runner does not catch migration errors. A known idempotent condition must be handled precisely inside the owning future migration; every unexpected SQL, constraint, or adapter error propagates and fails database initialization closed.

### 31.3 SQLite execution path

```text
createSqliteDatabase(filename)
  → existing canonical schema and frozen domain migrations
  → Finance open-item derived view reconciliation
  → migrateSalesCustomerDomain(sqliteDb)
  → return sqliteDb
```

The Sales entrypoint is additive and placed after its prerequisite frozen domain schema. Existing migrations are not reordered. Fresh SQLite and existing SQLite reopen use the same zero-step Wave 0 registry.

### 31.4 Fresh MySQL bootstrap path

```text
capture migrated SQLite snapshot
  → bootstrapMySql(liveAdapter, snapshot)
  → existing live MySQL reconciliation
  → migrateSalesCustomerDomain(liveAdapter)
  → return liveAdapter
```

The temporary SQLite snapshot passes through the Sales runner before capture. The live MySQL adapter intentionally replays the same registry after bootstrap. Therefore every future Sales migration must be idempotent: on fresh MySQL the live replay is a no-op/reconciliation over snapshot-created schema.

### 31.5 Existing MySQL live-upgrade path

For an already-existing MySQL database, `bootstrapMySql` retains its current lifecycle and `createDatabase` invokes `migrateSalesCustomerDomain` on the returned live `MySqlSyncAdapter`. Future additive Sales migrations therefore reach existing MySQL directly instead of relying only on the fresh SQLite snapshot. The Sales runner owns neither connection creation nor connection lifecycle; if live replay fails, `createDatabase` closes the adapter and propagates the error.

### 31.6 Tests and MySQL gate

- `server/sales-customer-wave0-migration-runner.test.js`: zero-step production registry, deterministic ordering, same-adapter passthrough, exactly-once-per-invocation, validation-before-execution, duplicate rejection, error propagation, fresh/reopened SQLite zero-business-schema, and structural production wiring.
- `server/mysql-sales-customer-wave0.integration.js`: protected disposable MySQL smoke; asserts `MySqlSyncAdapter`, runs a harmless injected `SELECT 1`, verifies continued connection usability, and proves none of the 38 frozen future Sales tables exists.
- `scripts/gates/mysql-gate.mjs`: includes the Wave 0 smoke without changing the existing reset guard, target validation, or cleanup architecture.
- `scripts/testing/test-suites.js`: classifies the focused `*.test.js` in FULL; it is not FAST because it creates/reopens a temporary SQLite database.

No Sales permission, role mapping, route, UI, business table, extension field, or `sales_deliveries.billing_mode` convergence is introduced by Wave 0.

---

## 32. Sales & Customer Domain Implementation — Wave 1 Commercial Foundation

> Post-freeze implementation record for the approved `§29` Design and `§30` Wave Plan. This section records the implemented Wave 1 repository facts without changing the frozen plan or authorizing Wave 2+.

### 32.1 Bounded schema and migration

The Wave 0 registry now has one production step, `wave-1-commercial-foundation`, owned by `server/migrations/sales-customer-wave1-foundation.js`. It creates exactly these eight Sales-owned tables:

1. `sales_parameters`
2. `sales_groups`
3. `salesperson_profiles`
4. `salesperson_group_memberships`
5. `customer_commercial_extensions`
6. `customer_material_xref`
7. `sales_sellable_scope_rules`
8. `product_commercial_classification`

Wave 1 adds zero fields to an existing table, zero Master/Platform schema fields, zero forward foreign keys, and no Wave 2+ business table. SQLite executes idempotent index DDL in the migration. MySQL fresh bootstrap and existing-database reconciliation derive the same indexes from the canonical SQLite snapshot; the live migration replay skips SQLite-only `CREATE INDEX IF NOT EXISTS` syntax.

### 32.2 Service ownership and business invariants

- `sales-parameters.js`: bounded SYSTEM / DOCUMENT_TYPE parameters; one full-row winner with DOCUMENT_TYPE precedence; missing effective configuration fails closed.
- `sales-foundation.js`: sales group, salesperson and effective membership maintenance. A salesperson may exist without a login. Transactional lock/recheck preserves at most one effective default membership. The default invariant is **`EXACTLY_ONE DEFAULT`** for every business date that has one or more active memberships — not `AT_MOST_ONE`. Violating memberships roll back the entire save.
- `sales-commercial-foundation.js`: versioned customer commercial extensions, controlled supersession, customer-material mappings, product commercial classification and sellable-scope rules.
- Customer commercial intervals reject overlap; supersession closes the prior version and creates the successor atomically.
- Customer-material resolution never guesses among multiple product candidates.
- Product sales/pricing UoM values must resolve through canonical UoM/conversion truth. The effective-date contract is `effective_from <= authoritative_date <= effective_to` where NULL `effective_to` means "open-ended / still in force"; future-only, expired, inactive, wrong-product and missing-base conversions are all rejected. The check lives in `assertUomCompatibility` (and is reused for `customer_material_xref.commercial_uom_code`); it never copies or rewrites the Master `uoms` / `product_uom_conversions` tables.
- Sellable rules validate their frozen dimension shape, reject overlapping same-effect rules and resolve explicit `DENY` before `ALLOW`.
- Successful mutations and their audit records share one transaction; rejected mutations leave no business or audit side effect.

### 32.3 API, authorization and UI surface

`server/app.js` exposes thin owned routes for parameter, group, salesperson, membership, customer-commercial-extension, customer-material-xref, sellable-rule and product-classification list/mutation operations. The frozen `PATCH /api/customer-commercial-extensions/:id` contract is retained.

Four backend permissions are canonical: `SALES_FOUNDATION_VIEW`, `SALES_PARAMETERS_MANAGE`, `SALES_FOUNDATION_MANAGE`, and `SALES_COMMERCIAL_MANAGE`. Admin receives all four. The Sales role receives view/foundation/commercial maintenance but not global Sales parameter administration. Every handler checks backend permission; frontend visibility is not authorization.

#### Read authorization (commercial data is sales-scoped)

The view list for customer commercial extensions, customer-material xref, sellable-scope rules and product commercial classification is:

```text
SALES_FOUNDATION_VIEW | SALES_FOUNDATION_MANAGE | SALES_COMMERCIAL_MANAGE | USERS_MANAGE
```

A customer-clerk holding only `CUSTOMERS_VIEW` / `CUSTOMERS_MANAGE` MUST NOT see commercial data. A reviewer (which carries `CUSTOMERS_VIEW`) MUST NOT see commercial data. An accounting role MUST NOT see commercial data. The Customer Detail panel renders an explicit "没有查看商业资料的权限" placeholder when the user lacks the canonical view permission; the launcher button is also hidden for actors outside that scope.

#### Salesperson SoD (self-assignment and self-default)

- A SALES actor (which carries `SALES_FOUNDATION_MANAGE`) MUST NOT bind a salesperson profile to its own login user, nor rebind an existing salesperson to its own login. The check returns `403 SALESPERSON_SELF_ASSIGNMENT_DENIED` and writes no audit row.
- A SALES actor MUST NOT create, change or replace the default membership of a salesperson profile that is bound to its own login user. The check returns `403 SALESPERSON_SELF_DEFAULT_DENIED` and rolls back the entire membership transaction.
- ADMIN (USERS_MANAGE) keeps the full maintenance capability required to provision the initial link between a salesperson profile and a Platform user.

The only Wave 1 frontend addition is a bounded commercial-information panel inside the existing Customer surface. It adds no launcher item or route. The panel presents effective customer commercial records and customer-material mappings, permits authorized creation, remains read-only without manage permission, and fits the 320 / 390 / 430 / 680 acceptance widths without horizontal page overflow.

### 32.4 Verification architecture

- `server/sales-customer-wave1-foundation.test.js`: exact schema boundary, parameter precedence/fail-closed behavior, permission separation, salesperson/login independence, default-membership invariant (`EXACTLY_ONE DEFAULT`), commercial interval/supersession, explicit xref resolution, classification/UoM, DENY precedence, transactional audit, **canonical UoM effective-date contract** (positive BASE / positive ALT / future-only reject / expired reject / inactive reject / wrong-product reject / missing Master base_uom reject), **salesperson SoD** (self-assignment forbidden, self-default forbidden, admin still able to maintain), and **read authorization** (reviewer / accounting 403 across all four commercial view paths, sales 200, denied mutation leaves no business or audit row).
- `server/sales-customer-wave0-migration-runner.test.js`: production registry, fresh/reopen idempotency, exact eight-table inventory and no Wave 2+ schema.
- `server/mysql-sales-customer-wave0.integration.js`: protected real-MySQL fresh/live replay and exact Wave 1 table boundary.
- `server/mysql-sales-customer-wave1-concurrency.integration.js`: real-MySQL **multi-session with control-session lock-wait observation** customer-interval, default-membership and sellable-rule races. Three independent child-process workers (alpha, beta, control) each hold their own `MySqlSyncAdapter` and therefore their own MySQL connection / session; each reports its distinct `CONNECTION_ID()` and processId for an explicit independence proof (`MULTI_SESSION_CONSISTENCY_VERIFIED` is always established). The control worker opens a real `START TRANSACTION` and acquires the canonical `mysql_transaction_gates` row lock (`SELECT … FOR UPDATE`); the two business workers' `transaction(db, work)` invocations are queued at the same row lock until the control worker commits via `release-gate`. The control transaction release is guaranteed by a `try/finally` in `runRace`. If the normal `release-gate` RPC fails (worker crash, IPC timeout), the cleanup path best-effort force-kills the control child process so the worker can never hold a gate row lock again. Worker RPCs have a bounded 15-second timeout. Lock-wait evidence is gathered with a tiered source priority implemented in `server/test-utils/sales-wave1-lock-observer.js` (single canonical implementation imported by both the integration test and the unit test):
    1. `performance_schema.data_lock_waits` — uses THREAD_IDs only. The integration test resolves `CONNECTION_ID()` → `THREAD_ID` via `performance_schema.threads` (the canonical mapping). When any threadId is null the observer skips Tier 1 entirely rather than fabricating a value.
    2. Tier 1 succeeds only when rows for BOTH alpha AND beta appear as waiters with the control as blocker → `LOCK_WAIT_OBSERVED`. A single-waiter row downgrades to `PARTIAL_LOCK_WAIT_OBSERVED` (never `LOCK_WAIT_OBSERVED`).
    3. Tier 2 — `information_schema.PROCESSLIST` uses CONNECTION_IDs only. `AS COMMAND` upper-case aliases match the JS reads (`row.COMMAND` etc.). A non-Sleep PROCESSLIST state yields `QUERY_ACTIVITY_OBSERVED`, never `LOCK_WAIT_OBSERVED`.
    4. When neither source is readable, the helper logs `MULTI_SESSION_CONSISTENCY_VERIFIED` only.
    5. PROCESSLIST polling is bounded — the observer does NOT conclude "no wait" after a single empty sample.
- The companion `server/concurrency-lock-observer.test.js` covers 11 cases via stubbed data: distinct CONNECTION_ID / THREAD_ID, identity-rule dispatch, lowercase-`id` alias not matched, idle (Sleep) not lock-wait, single-waiter downgrade, both-waiter positive, bounded polling recovers from first-empty sample, performance_schema unavailable downgrade, observation timeout does NOT fabricate LOCK_WAIT_OBSERVED, partial threadId downgrade, default poll budget constant.
- `server/mysql-sales-customer-wave1-upgrade.integration.js`: real-MySQL additive upgrade evidence with two phases against the existing protected test database. The test does NOT issue `CREATE DATABASE` / `DROP DATABASE`; it expects the gate to have already reset the protected DB. A SQLite-only preflight runs **before any MySQL connection** — it captures the canonical snapshot via `captureSqliteSnapshot(createDatabase, true)` (the **public** `createDatabase(filename)` factory + demo seed), filters out the eight Wave-1 tables, prints the actual row counts for every required representative and count-preserved table, asserts every required pre-Wave-1 table exists in the snapshot with seeded rows, asserts every Wave-1 table has been filtered out, and asserts every fixed legacy ID (`customer-001` … `customer-003`, `product-001` … `product-005`, `supplier-001` … `supplier-003`, `warehouse-001` / `warehouse-002`, `user-admin` / `user-sales` / `user-reviewer` / `user-warehouse` / `user-accounting`, `role-admin` / `role-sales` / `role-reviewer` / `role-warehouse` / `role-accounting`, `order-demo-001`, `item-demo-001` / `item-demo-002`) appears in the captured rows. Only after the preflight does the test open the first MySQL connection. The pre-check adapter asserts `SELECT DATABASE()` matches the expected target and that the protected DB is empty (`SHOW TABLES` returns zero rows). If any non-empty state is observed, the test stops with `STOP / NO DESTRUCTIVE ACTION` — it never wipes unknown data. The bootstrap adapter applies the filtered snapshot. Phase A invariants assert (i) the eight Wave-1 tables do not exist, (ii) representative pre-Wave-1 tables (`customers`, `products`, `suppliers`, `warehouses`, `sales_orders`, `sales_order_items`, `audit_logs`, `roles`, `permissions`, `role_permissions`, `users`, `inventory`) contain rows, (iii) additional pre-Wave-1 tables preserve their row counts (including legitimately zero — `sales_deliveries`, `purchase_receipts`, etc.), (iv) `mysql_backend_metadata` columns are exactly `[version, completed_at]`, (v) `mysql_transaction_gates.gate_id=1` exists, (vi) stable pre-Wave-1 rows are snapshotted (salesperson identity is intentionally NOT snapshotted here — it is a Wave-1 table and is verified only post-upgrade). **Phase B** invokes the production `createDatabase()` factory on a brand-new session, which runs `bootstrapMySql` with the full snapshot (additive reconciliation: only Wave-1 tables are added), then `migrateSalesCustomerDomain` (idempotent no-op). Post-upgrade invariants assert exact eight Wave-1 tables, no Wave-2+ tables, identical pre-Wave-1 row counts, byte-identical stable rows, FK target identity via `information_schema.KEY_COLUMN_USAGE`, intact UNIQUE / CHECK / transaction gate, and a final migration replay for idempotency.
- `scripts/acceptance/sales-customer-wave1-responsive.mjs`: Customer Detail commercial panel at 320 / 390 / 430 / 680.

### 32.5 Final MySQL Acceptance Evidence — 2026-10-14

> Real disposable-MySQL execution recorded against `master@d44ad42db5c67961027e9e21cbc951dd6d94f5ae`. This subsection records the actual executed gate counts only; it does NOT promote the user Acceptance/Freeze decision, and it does NOT extend the eight-table Wave 1 boundary. Prior §32.1–§32.4 implementation facts are unchanged.

#### 32.5.1 Execution target and gate totals

- MySQL target database: `modern_erp_domain_test` (disposable, gated by `ERP_DB_BACKEND=mysql` and the protected whitelist; no production / shared database was touched).
- Functional / migration gate: **PASS — 52 / 52**.
- Generic concurrency gate: **PASS — 13 / 13**.
- Procurement / Outsourcing concurrency gate: **PASS — 12 / 12**.
- Inventory / Warehouse concurrency gate: **PASS — 14 / 14**.
- Sales & Customer Wave 1 concurrency gate: **PASS — 4 / 4**.
- Sales & Customer Wave 1 existing-MySQL additive upgrade gate: **PASS — 18 / 18**.
- **Total: 113 / 113 PASS**; fail / skipped / cancelled / todo are all zero.

The gate-level breakdown (52 / 13 / 12 / 14 / 4 / 18 = 113) is the only execution result recorded for this session. No additional acceptance item is claimed and no unexecuted scenario is reported as PASS.

#### 32.5.2 Race-observation detail (Sales Wave 1 concurrency)

- `R-W1-01` (customer commercial interval overlap): the canonical `mysql_transaction_gates` row lock was observed holding both business transactions. Lock-wait telemetry **was** observed for this race: two transactions were actually seen waiting.
- `R-W1-02` (salesperson default membership) and `R-W1-03` (sellable-scope rule overlap): the domain business concurrency invariants passed (success count, failure-reason, exactly-one default, final row count, atomic audit). Full lock-wait telemetry was **not** observed for these two races — they are recorded as business-invariant PASS only.
- No `LOCK_WAIT_OBSERVED` claim is made for `R-W1-02` or `R-W1-03`. The single-tier and two-tier downgrade contracts from §32.4 are the authoritative lock-wait evidence rule; this subsection does not override them.

#### 32.5.3 Known non-blocking finding

- `mysql2` backend-option warning was emitted during the run. It is recorded as a non-blocking **P2** observation; it did not affect gate exit codes or test counts and is not counted as a fail / skipped / cancelled / todo.

#### 32.5.4 Discipline notes

- No DDL, no `CREATE DATABASE`, no `DROP DATABASE`, no schema/migration change was performed as part of recording this evidence; the disposable target database is owned by the gate.
- No Wave 1 business implementation, route, permission, schema, migration, frontend, test or README change occurred. The eight-table Wave 1 boundary remains exactly as recorded in §32.1.
- No user Acceptance/Freeze claim is made by this subsection; final Freeze remains an explicit user decision recorded separately.

Wave 1 does not implement quotation, pricing, credit, reservation, delivery scheduling/control or order-change execution. It does not claim user Acceptance/Freeze; those remain external decisions after review.

---

## 33. Sales & Customer Domain Implementation — Wave 2 Pricing and Order-Time Discount

> Post-design implementation record for the approved §29.6–§29.7 and §29.31.2–§29.31.3 contracts. This records repository facts only; it does not alter the frozen Requirement/Design or claim user Acceptance/Freeze.

### 33.1 Bounded schema and migration

The Sales registry runs `wave-2-pricing-discount` after Wave 1. `server/migrations/sales-customer-wave2-pricing.js` creates exactly `sales_price_lists`, `sales_price_list_entries`, `sales_price_list_versions`, `sales_discount_schemes`, and `sales_discount_scheme_rules`. It adds only the nullable real FKs `customer_commercial_extensions.default_pricing_list_id` and `default_discount_scheme_id`. No SO/SO-line or Master/Finance/Inventory/Platform schema changes are made.

Price-entry business uniqueness is the four-column database UNIQUE `(price_list_id, material_identity_key, customer_scope_key, pricing_identity_key)`. The independent entry UUID remains the PK and version rows reference it. Backend and the exactly named before-insert/before-update triggers derive and verify uppercase UTF-8 hexadecimal identity keys byte-for-byte, enforce component limits without truncation, case-folding or digest fallback, and reject identity-field updates. SQLite fresh/reopen and MySQL fresh/live replay share the registry; live MySQL replay adds/verifies the two named customer-default FKs and trigger metadata without changing the global adapter.

### 33.2 Canonical services and API ownership

`server/modules/sales-pricing.js` owns all §29.31.2/§29.31.3 routes. DRAFT writes lock/re-read the owner, validate references/ranges/UoM truth, and write audit in the same transaction. Price and discount rule versions append only. Activation validates completeness, fallback chains and canonical UoM evidence before freezing; retirement is `ACTIVE → RETIRED`. Both transitions reuse Platform idempotency: exact replay has zero additional state/audit effect and changed payload under the same key is rejected.

The price resolver applies explicit roots, the effective customer default, depth-first fallback, customer-before-all scope, integer quantity micros, Master rational conversions and the greatest immutable price version. It never reads `products.price_cents`. The discount resolver re-runs canonical pricing for every line; client expected evidence is an exact-match assertion only. LINE rules can filter material/customer/UoM/quantity/date. HEADER rules are database- and backend-constrained to order scope and use the post-LINE subtotal. Greatest effective rule version wins; disabled or expired current history cannot resurrect an older version. Integer cents/bps, HALF_UP and largest-remainder allocation remain authoritative.

Both resolver POSTs require view authority and write no business/audit/idempotency state. Manual price or MANUAL discount additionally requires override authority and a reason. No override log, sixth table or M14 write exists.

### 33.3 Authorization, UI and verification

The independent permissions are `SALES_PRICING_VIEW`, `SALES_PRICING_MANAGE`, and `SALES_PRICING_OVERRIDE`: Admin all; Sales view/manage; Reviewer view/override; Warehouse none; Accounting view. Every endpoint checks its exact authority.

`sales-pricing` is a contextual child route of the existing Sales & Customer customer surface and is absent from launcher groups. `src/pages/sales-pricing.jsx` supplies the bounded responsive list/configuration entry surface without a new top-level application.

### 33.4 Implementation self-review closure

The final implementation review preserves immutable pricing history: a DRAFT entry with any version, and a DRAFT list containing entries, cannot be hard-deleted. Identity replacement therefore creates a new entry while retaining prior version evidence. Resolver HTTP handlers execute their complete canonical read path in one read transaction and remain zero-write. Activation validates the complete fallback interval, acquires MySQL fallback locks in deterministic ascending ID order, and uses the full action plus request body as its idempotency fingerprint. Customer defaults must be ACTIVE and applicable on the commercial-extension effective date.

The MySQL contracts assert exact nullable column metadata, exact FK names/columns/targets, exact ordered four-column UNIQUE metadata, and exact BEFORE INSERT/UPDATE identity-trigger metadata and bytewise action signatures for fresh and existing-upgrade paths. Responsive acceptance exercises 320 / 390 / 430 / 680 CSS px, verifies no page overflow, and verifies a 44 px minimum interactive target. These are implementation/verification facts only; user Acceptance/Freeze remains external.

Verification ownership: `server/sales-customer-wave2-pricing.test.js` covers SQLite schema/FK/UNIQUE/triggers, five-role RBAC, identity immutability, versions, replay, pure resolvers, HEADER constraints, LINE→HEADER arithmetic and evidence mismatch; the migration-runner test covers fresh/reopen; the protected MySQL fresh and existing-upgrade suites cover fresh/live replay/second initialization. Wave 2 returns evidence only; SO persistence and final R-SAL-11 remain Wave 4.

### 33.5 Remote review remediation R1

The Wave 2 implementation closes three review defects without changing the frozen schema or API surface:

- Price-entry creation and price-list activation reuse the Sales-owned `assertSalesClassifiedProduct` primitive. Price and discount resolution reuse the full `assertSellableProduct` path, including effective sellable-scope rules. Missing, inactive or sales-disabled classification and an applicable scope denial therefore fail before any pricing evidence is returned; failed mutations roll back business, audit and idempotency state.
- MySQL resolver reads remain at the existing session isolation level. `readTransaction` acquires `LOCK IN SHARE MODE` on the existing `mysql_transaction_gates.gate_id=1` row before canonical reads. Every canonical writer already acquires `FOR UPDATE` on that same row, so multiple readers may coexist while activation, retirement, version and customer-default mutations wait until the complete resolver snapshot commits. SQLite keeps its existing `BEGIN` snapshot path, and the resolver performs no persistent write.
- Fallback cycle detection is scoped to the current root path. A shared descendant reached from `A → C` and `B → C`, or a customer default already reachable from an explicit root, is valid and follows the frozen root precedence. Re-entering a node on one path remains `FALLBACK_CYCLE`; duplicate explicit roots remain `DUPLICATE_ROOT`.

`server/mysql-sales-customer-wave2-concurrency.integration.js` and its independent-session worker are registered in the protected MySQL concurrency gate. The bounded suite verifies resolver/retirement and resolver/customer-default exclusion with observed gate waits, version/activation serialization, competing activation/retirement, coherent before/after evidence, shared fallback semantics, and atomic audit/business outcomes. It may run only against the already protected disposable MySQL environment.

### 33.6 Real MySQL migration runtime remediation R2

The Wave 2 live registry is dialect-dispatched without changing the frozen five-table schema. SQLite remains the canonical DDL source and continues to execute the existing `CREATE TABLE IF NOT EXISTS` block, nullable customer-default additions, identity triggers and indexes. MySQL continues to obtain physical tables and missing columns only from `captureSqliteSnapshot` plus `bootstrapMySql` additive reconciliation; the later `migrateSalesCustomerDomain` registry pass no longer submits SQLite table DDL to MySQL.

On MySQL, `migrateSalesCustomerWave2Pricing` now fails closed unless all five Wave 2 tables already exist and their primary keys, complete foreign-key targets, unique-key column order and CHECK-constraint counts match the canonical snapshot. The two customer-default columns must already have been supplied by bootstrap/additive reconciliation and must remain nullable; the registry never issues `ADD COLUMN ... TEXT REFERENCES` on MySQL. A missing FK is added with its canonical name. The one expected fresh-bootstrap shape—one target-equivalent FK with a MySQL-generated name—is reconciled by dropping only that identified constraint and adding the canonical named constraint. Duplicate, wrong-target, wrong-column or otherwise unexpected FK metadata is rejected.

The existing `trg_sales_price_entries_identity_bi` and `trg_sales_price_entries_identity_bu` creation statements remain the only MySQL identity-trigger implementation. The registry creates a missing trigger through the existing worker, then validates timing, event, owner table and bytewise identity fragments through `information_schema.TRIGGERS`; replay validates existing triggers without recreating them. No global MySQL adapter, isolation, business route, table inventory, historical row or Wave 3+ contract changes are part of this remediation.

`server/sales-customer-wave2-mysql-migration.test.js` supplies executable adapter-level dispatch coverage: MySQL receives no raw Wave 2 `CREATE TABLE` or SQLite-style `ADD COLUMN`, expected bootstrap-generated FK names reconcile once, replay is idempotent, and missing table/column or unexpected FK/PK metadata fails closed. The protected real-MySQL fresh suite remains `server/mysql-sales-customer-wave0.integration.js`; the existing-schema additive/replay suite remains `server/mysql-sales-customer-wave1-upgrade.integration.js`; Wave 2 multi-session behavior remains in `server/mysql-sales-customer-wave2-concurrency.integration.js`.

---

## 34. Sales & Customer Domain Implementation — Batch A (Waves 3–5) Mapping

> 本节仅记录已冻结 `§29–§30` 的实施映射，不改变 Requirement、SC、UAT、Race、schema 数量或跨域 ownership。实施基线为 `feature/sales-batch-a@af29569ed838493cca942a52361c9c2b391b93c7`。

### 34.1 Canonical owners and compatibility dispatch

- `server/modules/sales-orders.js` 是 Wave 4 后唯一 Sales Order create/update/lifecycle writer；新 `/api/sales-orders` 与兼容 `/api/orders` 只做同一 handler 的 route alias，报价转换直接调用同一 transaction-aware service，不保留第二套旧写入实现。
- `server/modules/sales-quotations.js` 拥有 Quotation lifecycle、conversion evidence、R-SAL-06 capacity 与 group-scope authorization。
- `server/modules/sales-order-changes.js` 拥有两种 authoring path，并统一调用 `applySalesOrderChange()`；版本 CAS、容量重读、approval、idempotency、audit 在同一 transaction。
- `server/modules/delivery-notices.js` 拥有 DN lifecycle；`server/modules/sales-delivery-source.js` 提供 DIRECT_ORDER / DELIVERY_NOTICE 的公共来源与容量校验，由既有 Sales Delivery handler 调用，库存、LOT/SERIAL、OQC、valuation/COGS 与 Finance writer 不复制。

### 34.2 Derived quantity and identity mapping

- `sales_quotation_conversions` 是 converted quantity 权威证据；`sales_quotation_lines.converted_qty` 仅为同事务维护的可核对缓存。读取时按 evidence 聚合对账并计算 `remainingQty=quantity-converted`，不使用跨表 generated expression。
- `delivery_notice_lines.id` 是稳定 FK / lock identity；`UNIQUE(delivery_notice_id,sales_order_item_id)` 是业务复合唯一性。notified/remaining 由引用该 line 的 Sales Delivery evidence 聚合；缓存字段只在同一 transaction 更新并对账。
- 锁顺序固定为：全局 transaction gate（MySQL runtime）→ document header → 按 ID 排序的 SO line → DN line（若有）→ delivery/change/conversion evidence → idempotency/audit。SQLite 使用 `BEGIN IMMEDIATE`；MySQL 在 transaction gate 后对相同业务 anchor 使用 `FOR UPDATE`。

### 34.3 Wave mapping and deferred gates

- Wave 3：SC09–SC14、UAT-S-01..03、R-SAL-06；三张新表；报价 LIST/DETAIL/EDITOR/CONVERT。
- Wave 4：SC24–SC29、SC31–SC44、UAT-S-10..16/S-39/S-42/S-43、R-SAL-07/08/11；两张新表、SO 13 列、SO item 11 列（含 `price_snapshot_json` / `discount_snapshot_json`）；四模式 change matrix 与 fulfillment/close projection。
- Wave 5：SC08/SC30/SC45–SC53、UAT-S-17..18、R-SAL-01/16/17/18/19；两张新表、Sales Delivery 三个 additive source fields（复用 `billing_mode`）。
- Wave 7 Prepayment/Reservation Intent 与 Wave 9–10 Credit 尚未实现时，不创建 stub 或假 PASS：仅当订单 snapshot/参数要求对应 gate 时返回明确 409；零预付款、`DISABLED` reservation 与未启用 Credit 保持可执行。后续 Wave 的完整 UAT 项仍标记为外部前置，不在 Batch A 声称完成。

### 34.4 Migration, API, UI and verification evidence plan

- Migration registry 严格追加 Wave 3 → 4 → 5。SQLite canonical snapshot 执行 dialect-local DDL；MySQL bootstrap/additive reconciliation 先物化 snapshot，live registry 只校验/补充方言正确 metadata，不重放 SQLite `CREATE TABLE`。
- 新 API 与兼容 alias 均注册到 `ownedRouteTable`，backend permission 分为 quotation view/manage、sales view/create/manage/approve、change direct/document/approve、DN view/manage/approve、delivery view/manage/approve。
- `applicationRegistry.js` 仍是 route canonical source；新增页面沿用现有 LIST → DETAIL → EDITOR/WORKFLOW 模式并验证 320/390/430/680。
- 测试证据按 Wave focused → FAST/FULL/HEAVY/build/diff-check；protected MySQL fresh/upgrade/replay/concurrency 仅在 guard 环境可用时运行，否则记录 NOT RUN。

### 34.5 Remote review R1 remediation implementation record

This subsection records the bounded remediation implemented after the external review of `feature/sales-batch-a@4b2fd90ad2cad471b15666a85a79f4401f71b6b6`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`.

- P1-01: quotation conversion retains Platform A-21 at request scope, while each immutable conversion row stores a bounded `LINE:<fingerprint(request-key, quotation-line-id)>` key. The existing `(quotation_id,idempotency_key)` uniqueness therefore remains migration-compatible and no longer rejects a valid multi-line request. A request-local set rejects duplicate quotation-line selection before capacity evaluation.
- P1-02: the original `sales_order_items.price_snapshot_json` and `discount_snapshot_json` remain immutable. Each append-only `sales_order_change_lines.after_values_json` now carries `SO_CHANGE_COMMERCIAL_EVIDENCE_V1`, the base/target effective version, quantity/UoM/unit price, the original evidence hash and an ordered `GROSS → LINE → HEADER` effective calculation. Application validates the calculation identity and source hash before CAS; post-application validation replays the latest APPLIED evidence per current line and reconciles the order total. This uses the already frozen JSON evidence carriers, so no Design Reopen or schema addition is required.
- P1-03: an independent actor with `SALES_PRICING_OVERRIDE` obtains a server-generated, line-bound authorization through `POST /api/sales-price-overrides/authorize`. The immutable authorization is stored in the existing Platform audit evidence, binds customer/date/material/UoM/quantity/catalog version/manual price/reason/actor, is consumed once under the canonical transaction lock, and rejects creator self-authorization, forged IDs, mismatched payloads and replay. The SO writer revalidates the stored server snapshot; it never accepts a client actor or client snapshot as authority.
- P1-04: both `/api/orders` and `/api/sales-orders` continue to delegate to the same lifecycle handler. SUBMIT now rechecks order/requested dates and ordering, ship-to contact/phone/address, payment terms, positive normal-line commercial amounts, gift zero-revenue semantics, complete authoritative snapshots and header/line total equality inside the mutation transaction.
- P1-05: fulfillment projection now loads the SO and invokes the same `assertGroupScope` predicate used by SO list/detail before returning quantities. An unmapped salesperson and a different group fail closed; explicit `SALES_CROSS_GROUP` authority remains the only non-admin bypass.
- MySQL race evidence is implemented by `server/mysql-sales-customer-batch-a-concurrency.integration.js` plus an independent-process worker. Three distinct MySQL sessions expose their `CONNECTION_ID()` and process ID. A control session holds the real `mysql_transaction_gates.gate_id=1` row; both business sessions must be observed waiting on that row through `information_schema.PROCESSLIST` before release. R-SAL-06/07/08/16/17/18/19 assert capacity/version/business state, winner/loser rollback and audit cardinality. R-SAL-11 remains in the Wave-2 concurrency suite. Registration is limited to the existing protected disposable-MySQL gate.

### 34.6 Remote review R2 targeted remediation implementation record

This subsection records the bounded R2 remediation continued from `feature/sales-batch-a@a116499494a3c5286840eecce73829e5aa38b6fe`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to the three R2 P1 contract findings below and the R-SAL-17/19 coverage note; no Wave 6+ functionality, no Schema delta and no release/version drift is included.

- R2-P1-01 — Independent Override Evidence Fingerprint: `authorizedOverrideEvidence()` no longer mutates the original `snapshot.evidence`. It returns the audit-bound evidence unchanged and emits a separately fingerprinted `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` payload that carries its own `pricingEvidenceFingerprint` (binding to the immutable price evidence fingerprint) and `authorizedPriceSnapshotHash` (binding to the canonical priced snapshot minus the consumption layer). `validatePriceSnapshot()` and `validateStoredOrderSnapshots()` now re-verify the consumption payload against the live `SALES_PRICE_OVERRIDE_AUTHORIZATION` audit row using the immutable Platform evidence carrier; this covers contract version, fingerprint match, authorised actor, authority code, customer, business date, material, UoM, quantity, evidence fingerprint, original snapshot hash and audit detail identity. No client-supplied actor, snapshot or authorization id is treated as authority; the same audit row cannot be applied twice; cross-customer / cross-material / cross-quantity / forged-id / insufficient-permission requests are rejected with `PRICE_OVERRIDE_AUTHORIZATION_INVALID` or `SALES_PRICE_OVERRIDE_SOD`. The new API test exercises authorize → consume → submit → independent approve, and additionally asserts forged/replay/cross-customer/cross-material/cross-quantity rejection.
- R2-P1-02 — Consecutive SO Change Versions: `applySalesOrderChange()` now flips `sales_order_changes.state='APPLIED'` (and writes approver / applied / idempotency fields) **inside the same transaction and before** `validateEffectiveOrderCommercialEvidence()` runs, so the current target version participates in the authoritative per-line latest-APPLIED replay. Any failure inside validation, CAS update, evidence evaluation or approval bookkeeping rolls the entire transaction back; the order row keeps its previous `effective_version`, every line keeps its previous commercial state, the change stays `SUBMITTED`, and the previously-APPLIED change cannot be re-applied. The new API test asserts a full consecutive 1→2→3 change sequence on the same order line, the original snapshot identity remains untouched, multi-line ADD/MODIFY mixed payloads pass, corrupt / stale / duplicate-apply paths roll back with zero side-effects, and the validator's authoritative replay matches the latest amount evidence for `effective_version=3`.
- R2-P1-03 — Legitimate Zero-Revenue Discount: The SUBMIT gate no longer rejects a non-gift line solely because `amount_cents<=0`. The frozen `§29.7.2` resolver may legitimately yield zero final cents for a normal-priced line under an authoritative 100% discount rule, and that result remains admissibly submitted. Gift lines keep their `amount_cents=0` invariant and any other condition (missing snapshot, mismatched amount, forged snapshot id, gift/amount mismatch) still fails closed under the existing snapshot validation. The new API test creates an ACTIVE 100% LINE scheme, asserts the resulting order line carries the authoritative unit price with `amount_cents=0`, submits it through the canonical lifecycle, then asserts forged amount-0 / missing discount snapshot / mismatched amount / mutated discount snapshot are all rejected.
- R-SAL-17 / R-SAL-19 coverage note: The MySQL independent-session suite still routes R-SAL-17 (two SD capacity consumers vs DN remaining) and R-SAL-19 (SO close vs SD confirmation) through the `consume-delivery-capacity` worker action that invokes `lockAndConsumeSalesDeliveryCapacity()` plus a manual `UPDATE sales_deliveries SET status='CONFIRMED'`. They exercise the canonical capacity / version / audit serialisation path with real `mysql_transaction_gates` waits and observed processlist, but they do **not** invoke the full canonical `confirmSalesDelivery()` handler, so inventory deduction, OQC gate, financial period gate, AR exposure recognition, COGS posting, voucher generation and Sales Delivery audit are not concurrent-tested. These two IDs are therefore not claimed as full Sales Delivery Confirm concurrent acceptance; they are recorded as capacity-and-status serialisation evidence only. No fake PASS or unauthorised MySQL operation was attempted; the live MySQL fresh / upgrade / replay / concurrency gate continues to fail closed with `MYSQL TEST ENVIRONMENT = UNAVAILABLE` until a protected disposable environment supplies the five ERP_DB_* variables.

### 34.7 Remote review R3 targeted remediation implementation record

This subsection records the bounded R3 remediation continued from `feature/sales-batch-a@7d12c3dc91d54a0b9896747ed84f0e607e5d97f6`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to one R3 P1 contract finding; no Wave 6+ functionality, no Schema delta, no table or field addition, and no Git / release / version drift is included.

- R3-P1 — Duplicate consumption of one price override authorization inside a single Sales Order: `authorizedOverrideEvidence()` now accepts an optional request-scoped `consumedAuthorizationIds` Set. A second line in the same request that reuses an already-seen `priceOverrideAuthorizationId` is rejected with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` before any DB write; the new check runs at the top of the function and short-circuits without consuming an audit read or doing a LIKE scan. `buildAuthoritativeSalesLines()` owns the per-call Set and propagates it through every per-line `authorizedOverrideEvidence()` invocation, so two `items[]` rows referencing the same id are stopped before either line is resolved. `normalizedLines()` (controlled-change authoring path) now shares **one** Set across every `ADD` operation inside the same change request so two `ADD` rows referencing the same id are likewise stopped before any change-line row is inserted. The existing MySQL row-lock on the `audit_logs` row, the immutable independently fingerprinted `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` evidence, the cross-document LIKE check that already detects a previously persisted consumption (`PRICE_OVERRIDE_AUTHORIZATION_USED`), creator/override-actor SOD, RBAC, authority code, reason and snapshot integrity are all preserved. Rejection throws `HttpError` so the surrounding `transaction()` rollback leaves zero SO row, zero change-line row, zero idempotency save and zero CREATE audit log; nothing in the audit was expanded. The new focused regression tests cover: two otherwise valid lines referencing the same id rejected with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` and zero `sales_orders` / audit / idempotency side effects; two lines referencing distinct valid ids accepted; failed duplicate request followed by a legitimate single-use of the same id accepted; the same id reused in another order after successful consumption rejected with `PRICE_OVERRIDE_AUTHORIZATION_USED`; the existing authorize → create → submit → independent approve chain remains successful; the canonical `PATCH /api/sales-orders/:id` mutation path also rejects a two-line body that reuses one id; and the controlled-change authoring path with two `ADD` rows that reuse one id is rejected with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` while a subsequent single-`ADD` change request legitimately consumes that same id.

### 34.8 Remote review R4 one-time-authorization completeness implementation record

This subsection records the bounded R4 remediation continued from `feature/sales-batch-a@257ac1dfa11a1d8fa771f5e741df80a263ac28bf`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to one R4 P1 contract finding; no Wave 6+ functionality, no Schema delta, no new table or column, no Git / release / version drift, and no expansion into other business domains.

- R4 chosen existing carrier: the canonical `idempotency_records` table from `server/migrations/v13-phase6a-financial-controls.js:144` carries the DB-level `UNIQUE(operation_type, document_id, idempotency_key)` constraint that is enforced at INSERT time on both SQLite and MySQL. This avoids the R3 LIKE pattern fragility (which depended on the JSON column of `sales_order_items` and could be bypassed by PATCH removal or by a SUBMITTED-but-not-yet-applied Change ADD) and provides a transaction-bound consumption record that participates in the surrounding `transaction()` rollback automatically. No new table, column, index or constraint is introduced.
- R4 contract: `authorizedOverrideEvidence()` now `INSERT`s a consumption row into `idempotency_records` with `operation_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION'` and `document_id=<authorizationId>` inside the same transaction that resolves the line. A duplicate INSERT fails with the carrier's UNIQUE constraint and is mapped to `PRICE_OVERRIDE_AUTHORIZATION_USED`. The R3 in-request Set still short-circuits same-request duplicates with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` before any DB write. The R3 cross-document LIKE pattern is removed; the DB INSERT is now the only cross-document check, and it survives `PATCH` removal, Change ADD `SUBMITTED` occupancy, external deletion of the consumed `sales_order_items` row, and any later `ROLLBACK` of the same transaction. The consumption row is independent of `sales_order_items` lifetime.
- R4 occupancy vs consumption: the same record serves both. For direct SO create / `PATCH` / Gift Line it is created at line commit time. For `CONTROLLED_DIRECT` and `CONTROLLED_DOCUMENT` Change ADD it is created inside `normalizedLines()` at request time so the auth is reserved against any concurrent business attempt; on `APPLY` the row already exists and the change-line JSON is no longer trusted in isolation. A new `PRICE_OVERRIDE_CONSUMPTION.assertReserved()` helper re-verifies that the consumption row is still in place at apply time before any `sales_order_items` INSERT, CAS bump or APPROVE_AND_APPLY audit fires. If the row is missing the entire apply transaction rolls back with `PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED` and zero side-effects on `sales_orders` / `sales_order_items` / `sales_order_changes` / approval_requests / apply-idempotency / audit.
- R4 cancel / reject release path: `releaseChangeAuthorizationOccupancy()` walks `sales_order_change_lines` for ADD rows, extracts `priceSnapshot.authorizationEvidence.authorizationId` and `DELETE`s the corresponding consumption row inside the same transaction as the state flip. Only ADD rows release — MODIFY/CANCEL rows keep the original line's consumption record untouched. Audit `entity_type='SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION'` carries `CONSUME` on insert and `RELEASE` on delete.
- R4 unified semantics: `createSalesOrder`, `updateSalesOrder`, `addSalesOrderGiftLine`, and the `ADD` path of `CONTROLLED_DIRECT` / `CONTROLLED_DOCUMENT` change authoring all route through the same `buildAuthoritativeSalesLines` → `authorizedOverrideEvidence` → `recordPriceOverrideAuthorizationConsumption` path. RBAC, creator/override-actor SOD, audit-log row lock, the independently fingerprinted `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` evidence, and the original `sales_order_items` snapshot carriers are unchanged.
- R4 acceptance matrix tests in `server/sales-customer-batch-a.test.js`: (a) same-request duplicate rejected with `PRICE_OVERRIDE_AUTHORIZATION_DUPLICATE` (R3); (b) cross-order duplicate rejected with `PRICE_OVERRIDE_AUTHORIZATION_USED` (R3); (c) draft PATCH replacing the consumed line with a non-auth line leaves the consumption record in place and a fresh reuse attempt fails with `PRICE_OVERRIDE_AUTHORIZATION_USED`; a PATCH that tries to reuse the locked auth in a new line also fails closed; (d) SUBMITTED Change ADD reserves the auth, a concurrent SO creation with the same auth fails with `PRICE_OVERRIDE_AUTHORIZATION_USED`, REJECT flips the change to REJECTED, the consumption row is deleted and an additional `RELEASE` audit row is recorded, the same auth can then be re-consumed in a new SO; (e) when the consumption row is externally deleted before apply, apply fails with `PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED` and no `sales_order_items` row is inserted, no `effective_version` bump, no total change, no APPROVE_AND_APPLY audit, no apply-idempotency save, the change stays in `SUBMITTED` and the approval_request status is unchanged; (f) distinct valid authorisations each get their own consumption row (R3); (g) RBAC, SOD, fingerprint and snapshot carriers preserved (R2/R3).

### 34.9 Remote review R5 owner-aware authorization finalization implementation record

This subsection records the bounded R5 remediation continued from `feature/sales-batch-a@8bdafc7a3b73a035f6d768c8caab37b6aa6da89b`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to the two R5 lifecycle gaps; no Wave 6+ functionality, no Schema delta, no new table or column, no Git / release / version drift, and no expansion into other business domains.

- R5 root cause: the R4 record-based reservation could not be edited. `updateSalesOrderChange()` resolved new lines through `normalizedLines` → `authorizedOverrideEvidence` → `recordPriceOverrideAuthorizationConsumption`, and the DB UNIQUE constraint correctly fired on the second INSERT of an already-reserved authorization. The R4 release/assert helpers also lacked owner enforcement, so a misrouted release or apply could silently delete or accept a row owned by another change or a direct-SO consumption.
- R5 DRAFT Change PATCH reconciliation: `updateSalesOrderChange()` now snapshots the ADD-authorisation set currently carried by THIS change (`oldAuthIds`), projects the new ADD-authorisation set (`newAuthIds`), passes the intersection as `previouslyReservedAuthorizationIds` to `normalizedLines` → `buildAuthoritativeSalesLines` → `authorizedOverrideEvidence`. Retained authorizations are not re-inserted but verified through `assertPriceOverrideAuthorizationReserved(..., { expectedOwner: 'SALES_ORDER_CHANGE:<changeId>' })`. Newly added authorizations are inserted via the existing DB UNIQUE-protected path. After `normalizedLines` returns, the function walks `oldAuthIds \ newAuthIds` and calls `releasePriceOverrideAuthorizationConsumption(..., { expectedOwner })` so removed reservations are released atomically with the change-line rewrite. A failed `normalizedLines` throws inside the same `transaction()`, so the prior `sales_order_change_lines`, the prior consumption rows, the `apply_idempotency_key`, the audit cardinality and the order `effective_version` are all rolled back.
- R5 owner-aware `release`: `releasePriceOverrideAuthorizationConsumption()` now requires the caller to pass `expectedOwner` (typically `SALES_ORDER_CHANGE:<changeId>` or omitted for direct-line internal callers). It reads the persisted row, parses `result_json.source`, and rejects with `PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH` when the source does not match. It also refuses to delete when an applied `sales_order_items` row still carries the authorization (`PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS`); the existing `sales_order_items.price_snapshot_json` LIKE check now serves only as a guard for applied-line protection. Both checks run inside the same transaction as the state flip.
- R5 owner-aware `assertReserved`: `assertPriceOverrideAuthorizationReserved()` now accepts `expectedOwner`. Apply-time re-verification in `applySalesOrderChange()` calls it with `expectedOwner: 'SALES_ORDER_CHANGE:<changeId>'`. Cross-owner attempts throw `PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH` and roll the entire apply back; missing-record attempts throw `PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED` (R4 path preserved). The original carrier (`idempotency_records` UNIQUE constraint), the immutable independently fingerprinted `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` evidence, the audit-log row lock, RBAC, creator/override-actor SOD, the original authority and the original fingerprint binding are all preserved.
- R5 reject / cancel path: `releaseChangeAuthorizationOccupancy()` now passes `expectedOwner` to `release()` for every ADD row. Reject/cancel therefore releases only the currently reserved, owned authorisations and cannot delete a direct-SO consumption row or another change's record.
- R5 acceptance matrix tests in `server/sales-customer-batch-a.test.js`: DRAFT Change ADD A → PATCH retaining A → success with record identity preserved; PATCH replacing A with B → A released, B reserved under the same change owner; PATCH removing the ADD entirely (replacing with a MODIFY on the base line) → A released; invalid PATCH that re-uses an already-consumed authorization → 409 `PRICE_OVERRIDE_AUTHORIZATION_USED`, prior change lines and reservations untouched; PATCH replacement followed by Cancel → both old and newly-replaced reservations released, change state `CANCELLED`, no orphan records; cross-owner `release()` attempt on changeB's record with expectedOwner=changeA → throws `PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH` without deleting the changeB record; cross-owner `assertReserved()` attempt → throws and does not advance any state; missing-record apply on changeB → fails with `PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED` leaving changeA's state, audit cardinality and effective_version intact; valid-owner apply on changeA → bumps `effective_version`, appends a new SO line, immutable snapshot and authorization binding preserved; direct-SO permanent consumption protected from any later cross-owner release/assert attempt. All R1–R4 regression tests remain green.
- R5 concurrency note: under the existing protected MySQL runtime (`mysql_transaction_gates`) and SQLite `BEGIN IMMEDIATE`, the new DRAFT-PATCH reconciliation, the owner-aware release, and the apply-time re-verification are serialised inside a single transaction. Real MySQL gate continues to fail closed with `MYSQL TEST ENVIRONMENT = UNAVAILABLE`; no fabricated live PASS.

### 34.10 Remote review R6 P1/P2 bounded remediation implementation record

This subsection records the bounded R6 remediation continued from `feature/sales-batch-a@b7c446d1220a0468a4bf3674bef8167da0212e3e`. It does not change the frozen Requirement, the seven-table / two-snapshot-column Batch A schema boundary, any SC/UAT/Race allocation, or `document.md §34`. The remediation is scoped strictly to the three R6 lifecycle and contract findings; no Wave 6+ functionality, no Schema delta, no new table or column, no Git / release / version drift, and no expansion into other business domains.

- R6-P1-01 — Sales Order Change state actions enforce requester ownership and sales-group scope: `salesOrderChangeAction()` now loads the change + underlying SO through a new `loadChangeWithScope()` helper that re-asserts `assertGroupScope()` for every mutation. The helper is intentionally narrower than `orderForChange()` so REJECT / CANCEL can still target a SUBMITTED change after the SO has been closed. SUBMIT also requires `change.requested_by === actor.id` (with ADMIN bypass) so a user with `SALES_ORDER_CHANGE_DOCUMENT_MANAGE` cannot submit another user's DRAFT; the new error code is `SALES_ORDER_CHANGE_NOT_REQUESTER`. APPROVE continues to use `orderForChange()` (which additionally checks APPROVED / OPEN), so apply-time scope remains covered by the same predicate as create flows. Reuses the same `transaction()` so a failed access leaves zero side-effects on `sales_order_changes`, `sales_order_change_lines`, `approval_requests`, `idempotency_records`, `audit_logs`, and the order `effective_version`.
- R6-P1-02 — DRAFT PATCH fail-closes on corrupt historic ADD evidence: the silent `try { ... } catch {}` in `updateSalesOrderChange()` is replaced with an explicit `throw new HttpError(409, ..., { code: 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT' })` for both JSON-syntax and missing-`priceSnapshot` cases. For ADD rows that DO carry an authorisation, the captured `authorizationId` is also type-checked. A legitimate ADD without override authorisation still PATCHes successfully because the absence of `authorizationEvidence` is not a corruption signal. The rejection fires inside the same `transaction()`, so prior `sales_order_change_lines`, prior consumption rows, audit cardinality, the order `effective_version`, and the prior `sales_order_changes` row are all rolled back.
- R6-P2-01 — `release()` / `assertReserved()` require `expectedOwner` and reject the `allowAppliedLine` bypass: the default `{ expectedOwner = null }` is removed; both helpers now require an explicit non-empty `expectedOwner` string and throw `PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED` when omitted or empty. The `allowAppliedLine` option is removed (no caller ever used it) so the LIKE-on-`sales_order_items` applied-line guard is always enforced. All Change callers in `sales-order-changes.js` and `authorizedOverrideEvidence` already pass `expectedOwner` explicitly; the helpers do not introduce a second persistence carrier. The DB UNIQUE constraint, the `SALES_PRICE_OVERRIDE_AUTHORIZATION_CONSUMPTION_V1` evidence, RBAC, creator/override-actor SOD, the original authority and the original fingerprint binding are preserved.
- R6 acceptance matrix tests in `server/sales-customer-batch-a.test.js`: (P1-01) non-requester SUBMIT of another user's DRAFT rejected with `SALES_ORDER_CHANGE_NOT_REQUESTER` and zero side-effects on change state and audit cardinality; legitimate SUBMIT by requester succeeds; cross-group SUBMIT attempt (SO moved to a different sales group) rejected at `assertGroupScope()`; cross-group REJECT attempt by a no-cross-group reviewer rejected with `SALES_GROUP_SCOPE_DENIED`, change state / approval status / audit cardinality unchanged; cross-group CANCEL attempt rejected with the same scope code; legitimate REJECT by a cross-group-enabled reviewer succeeds and writes the audit row; legitimate CANCEL by the requester succeeds. (P1-02) Case A (corrupt JSON syntax in historic `after_values_json`) → 409 `SALES_ORDER_CHANGE_EVIDENCE_CORRUPT` with prior `sales_order_change_lines` / audit / effective_version / reservation unchanged; Case B (parses but missing `priceSnapshot`) → same error code, same rollback invariants; Case C (legitimate ADD without override authorisation) PATCHes successfully without over-warning; Case D (R5 lifecycle ADD A → retain → replace B → remove ADD → cancel) regression continues to pass. (P2-01) direct `release()` / `assertReserved()` call without `expectedOwner` → throws `PRICE_OVERRIDE_AUTHORIZATION_OWNER_REQUIRED` without touching the record; cross-owner release/assert with wrong `expectedOwner` → throws `PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH` without touching the unrelated record; an applied-line authorization cannot be released by its owner (`PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS`); a fresh Change ADD with a fresh authorization can still be cancelled by its owner and the reservation is released.
- R6 concurrency note: under the existing protected MySQL runtime (`mysql_transaction_gates`) and SQLite `BEGIN IMMEDIATE`, the SUBMIT / REJECT / CANCEL scope gate, the PATCH corruption gate, and the tightened owner-required release/assert contract are all serialised inside one transaction. Real MySQL gate continues to fail closed with `MYSQL TEST ENVIRONMENT = UNAVAILABLE`; no fabricated live PASS.

### 34.11 Remote review R7 P1/P2 strictly bounded remediation implementation record

This subsection records the bounded R7 remediation continued from `feature/sales-batch-a@1a4f58c72e2ec3a637f5dd8f72473b6787c1dda7`. It does not change frozen `document.md §34`, the seven-table / two-snapshot-column Batch A schema boundary, SC/UAT/R-SAL allocation, RBAC/SOD, the canonical Sales Order writer, snapshot immutability, CAS, audit/idempotency, or release identity. No Wave 6+ behavior, schema delta, second authorization carrier, automatic history repair, or UI change is included.

- R7-P1-01 — historic ADD evidence and owner-set reconciliation: the R6 object-presence check was insufficient because an empty or partially damaged `priceSnapshot` could lose its authorization reference while the authoritative `idempotency_records` reservation remained. `parseStrictAddAfter()` now validates every persisted ADD payload, its core commercial fields, and its price snapshot through the canonical `validatePriceSnapshot()` contract. `reconcileChangeAuthorizations()` then compares the unique authorization IDs declared by all ADD lines with the exact persisted consumption set whose structured `result_json.source` equals `SALES_ORDER_CHANGE:<changeId>`. Missing, extra, duplicate, malformed, cross-linked, or unreadable evidence fails closed; the code neither guesses nor repairs history. DRAFT PATCH reconciles before retain/replace/remove, REJECT and CANCEL reconcile before release, and APPLY reconciles plus owner-asserts every reservation before economic mutation. All checks remain inside the existing transaction, so failure rolls back line/state/approval/idempotency/audit and order version/amount effects. A legitimate ADD without an override has no declared ID and remains valid when the persisted owner set is also empty.
- R7-P1-02 — structural applied-line protection: `findAppliedAuthorizationLine()` no longer uses JSON text `LIKE`. SQLite compares `json_extract(price_snapshot_json, '$.authorizationEvidence.authorizationId') = ?`; MySQL compares `JSON_UNQUOTE(JSON_EXTRACT(price_snapshot_json, '$.authorizationEvidence.authorizationId')) = ?`. Both retain parameter binding and ignore SQL `NULL` without inventing evidence. Any JSON-query/read failure becomes `PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_CHECK_FAILED` rather than being interpreted as no applied row. `release()` still requires and verifies `expectedOwner` before deletion, and an exact applied match still raises `PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS`.
- R7-P2-01 — real cross-group SUBMIT coverage: the R6 scenario now creates a DRAFT while the actor is in scope, changes the underlying order's effective sales group, calls `POST /api/sales-order-changes/:id/submit`, and verifies 403 plus zero change-state, approval, SUBMIT-audit, reservation, idempotency, and SO-version effects. Restoring the group then proves the same DRAFT can submit normally. The frozen permission model is unchanged.
- Verification evidence: the focused Batch A suite is `28/28 PASS`; FAST is `380/380 PASS` across 37 suites; FULL is `2454/2454 PASS` across 351 suites; HEAVY is `67/67 PASS` across 18 suites; the Vite build passes with 1960 modules. The protected MySQL functional gate passes all 13 registered files. The protected MySQL concurrency gate passes `77/77` across seven groups, including Batch A `8/8` and a real native-JSON structure/order/NULL/unrelated-field test. The Batch A MySQL fixture uses idempotent `INSERT IGNORE` for the already bootstrap-seeded `EA` UOM; this is test setup only and changes no runtime contract. `git diff --check` is run after documentation is appended.
- Remaining boundary: corrupted historic evidence is deliberately not self-healed and requires manual data repair before its lifecycle can proceed. R-SAL-17/R-SAL-19 remain capacity-and-status serialization evidence rather than full `confirmSalesDelivery()` concurrency acceptance. This implementation record is not an Acceptance PASS or Freeze claim.
