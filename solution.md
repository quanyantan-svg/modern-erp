# Modern ERP 当前技术设计与实现

## 1. 范围与设计原则

本文档是 Modern ERP 唯一当前技术设计和实现参考。§2–§20 描述 V1.3 已实现的架构、模块责任、数据关系、事务、安全、测试和运行边界；§21 是 V1.4 的设计合同，已由实施切片 E1–E8 完整落地。功能合同见 document.md；docs/ 下的阶段文档和审计属于支持性或历史证据。

设计原则：

- 以实际代码和数据库约束为权威，旧设计与实现冲突时以当前实现为准。
- HTTP 层负责解析、认证、路由和响应；领域模块负责业务不变量；数据库事务负责原子性。
- 单据、库存、身份、价值、子账、总账、审计和幂等结果共享业务事务。
- 前端不作为授权或金额计算权威。
- SQLite 与 MySQL 8 实现相同业务接口，但允许数据库适配层采用不同并发机制。
- 历史经济事件不可由启动迁移或 GET/CHECK 请求静默修复。
- 业务日期、来源身份和历史状态只能从可证明事实迁移；未知值必须保持未知并在 UI/报表披露。
- 先保证正确性，再以可验证证据优化吞吐。

## 2. 运行与部署架构

运行链路：

    Browser
      → Nginx :80/:443 policy
      → Node.js 22.23.2 on 127.0.0.1:3001
      → native HTTP router
      → SQLite or MySQL 8 backend

前端由 Vite 构建到 dist/。生产 Node 进程同时提供 API、静态资源和 SPA fallback；当前 Nginx 配置使用单一 location / 反向代理，不再单独实现第二套静态/API 路由。

主服务由 deploy/systemd/modern-erp.service 管理，环境来自 /etc/modern-erp/env。备份 timer 调用 SQLite 备份脚本。项目不使用 Express、Koa、PM2、Docker 或 Redis。

数据库后端由 ERP_DB_BACKEND 选择：

- sqlite：本地开发、测试和兼容运行，路径由 ERP_DB_PATH 指定。
- mysql：MySQL 8 一等运行路径，需要 host、port、database、user、password 和可选 SSL。

MySQL 配置不完整时在连接前 fail closed。

## 3. 仓库结构与入口

| 路径 | 责任 |
|---|---|
| src/main.jsx | React 启动入口 |
| src/App.jsx | 应用壳、权限化导航和页面选择 |
| src/api.js | Bearer Token、请求封装和安全错误映射 |
| src/pages/ | 业务页面 |
| src/components/ | 通用与移动端组件 |
| src/lib/ | 金额、状态和产品文案 |
| server/index.js | 配置数据库、创建 HTTP server、优雅关闭 |
| server/app.js | 原生 HTTP 路由、认证分发及仍未拆出的核心 handler |
| server/db.js | SQLite schema/seed、权限、共享 transaction 和数据库创建 |
| server/modules/ | 领域服务、工作流和 reconciliation |
| server/database/ | MySQL 配置、同步 adapter、worker、protocol 和 schema bootstrap |
| server/migrations/ | 按业务阶段组织的增量迁移 |
| server/lib/ | HTTP 校验/响应、审计和结构化日志 |
| server/*.test.js | 单元、合同、回归和集成测试 |
| scripts/runtime/ | 开发运行入口；当前由 package.json 保持稳定命令别名 |
| scripts/admin/ | SQLite 备份/恢复、首个管理员初始化与受保护的数据转换工具 |
| scripts/gates/ | MySQL 功能/并发 gate 和 JSON-lines 并发 worker |
| scripts/diagnostics/ | 性能诊断、benchmark 和历史调试工具 |
| scripts/acceptance/ | 隔离数据库、浏览器和发布验收工具 |
| deploy/ | Nginx 与 systemd 配置 |
| docs/archive/v1.2/ | V1.2 审计、视觉验收和发布上下文历史证据，不是当前产品事实 |

server/app.js 仍是较大的集中路由文件。新增复杂领域逻辑应优先进入 server/modules/，但本阶段不为目录美观迁移既有 handler。

脚本从 package.json 或其他脚本启动子进程时，必须从 `import.meta.url` 推导仓库根目录并显式设置 `cwd` 或使用绝对目标路径，不得依赖调用者碰巧位于仓库根目录。ES module 的相对 import 仍以脚本文件自身为基准。浏览器验收脚本的临时数据库与截图位置必须继续保持隔离；默认生成截图写入被忽略的 `.tmp/`，不能混入 `docs/archive/` 的版本化历史证据；结构移动不得改变验收业务流程。

## 4. HTTP 请求生命周期

createApp(db, options) 创建原生 HTTP request handler。典型流程：

1. 为请求生成或验证 X-Request-Id。
2. 设置 CSP、nosniff、DENY frame、no-referrer、Permissions-Policy 和 API no-store 等响应头。
3. 解析 URL、method 和 Bearer Token。
4. 对受保护 API 加载 session、用户、角色和权限；过期、注销或禁用用户会话被拒绝。
5. 路由到 server/app.js handler 或 server/modules/ 领域 handler。
6. readJson 强制 application/json、对象 body 和大小上限；敏感端点使用字段 allowlist。
7. allow/allowAny 校验精确权限。
8. handler 校验输入、状态和来源，并在需要时进入 transaction。
9. HttpError 转换为受控业务响应；未知错误记录 request ID 和安全上下文，客户端只收到通用错误和 request ID。
10. 非 API GET 在 production 从 dist 提供静态文件，并通过路径包含检查防止越界；未知 SPA route 回退 index.html。

前端可隐藏无权入口，但手写 API 请求仍会由后端返回 401/403。

## 5. 认证、RBAC、SOD 与审计

### 5.1 会话与密码

- 登录 Token 使用 crypto.randomBytes 生成，数据库只保存 SHA-256 digest。
- 密码使用随机盐和 Node scrypt。
- SESSION_HOURS 控制绝对有效期。
- 登录失败按标准化用户名累计并锁定；锁定响应包含 Retry-After。
- logout 删除 session；用户密码、角色或 active 变化会撤销已有 session。
- Authorization、Cookie、密码、Token、secret 和数据库密码字段由 logger 递归脱敏。

### 5.2 权限模型

users → roles → role_permissions。五个正常角色由 server/db.js seedSchema 建立，ADMIN 获得注册权限全集，其他角色使用显式权限列表。

canonical 审批中心由 server/modules/approvals.js 维护五个文档适配器。审批查询根据 actor 权限、创建人和状态组合过滤；具体状态变化仍由对应领域 handler 执行。

职责分离：

- SALES 创建/提交销售、采购和请购；
- REVIEWER 审核销售、采购、请购和库存盘点；
- WAREHOUSE 执行实物流；
- ACCOUNTING 处理子账、结算和手工凭证；
- 当前五角色模型中 ADMIN 承担 VOUCHER_APPROVE，但 create/approve 同人仍被拒绝。

### 5.3 用户管理 API 载荷合同

`server/app.js` 的 `createUser`（`POST /api/users`）与 `updateUser`（`PATCH /api/users/:id`）使用 `assertAllowedFields` 严格字段白名单。`active` 是 update-only 字段：CREATE 不接受，由后端在 `INSERT` 中 hard-code `active=1` 写入；UPDATE 接受并由 `body.active` 决定 0/1。

| Endpoint | 允许字段 | 拒绝字段 |
|---|---|---|
| `POST /api/users` | `username`、`displayName`、`password`、`roleId` | `active`（硬编码 1）、`username` 之外的任何键 |
| `PATCH /api/users/:id` | `displayName`、`password`、`roleId`、`active` | `username`、白名单外任何键 |

前端 `UserModal`（`src/pages/master-data.jsx`）不得用整页 `form` 状态做盲发，必须构造与上述合同一致的显式载荷：

- 创建载荷：`{ username, displayName, password, roleId }`，不包含 `active`。
- 更新载荷：`{ displayName, password, roleId, active }`；当 `password` 为空字符串或未填写时，从载荷中移除该键，由后端保留原密码。

后端 `assertAllowedFields` 与现有 `readJson` 错误合同（`请求包含不支持的字段: <fields>`，由 `server/lib/http.js` 抛出）保持不变；不得为了容忍前端整对象提交而弱化。后端 admin gate（`USERS_MANAGE`）与五个 canonical 角色（ADMIN / SALES / REVIEWER / WAREHOUSE / ACCOUNTING）保持不变。

### 5.4 审计

server/lib/audit.js 向 audit_logs 写入用户、动作、实体、实体 ID、摘要和时间。审计必须在关键业务事务中调用，使业务写入与审计一起提交或回滚。结构化运行日志与不可变业务审计是不同系统。

## 6. 数据库抽象

### 6.1 SQLite 路径

`server/db.js` 的 `createDatabase(target)` 通过参数形态选择后端：`typeof target === 'string'` 走向后兼容的 SQLite 显式路径，直接打开目标文件；`target` 为缺省或对象时调用 `resolveDatabaseConfig(target)`，按 `ERP_DB_BACKEND` 决定 SQLite 或 MySQL 分支。SQLite 分支使用 Node `node:sqlite` 的 `DatabaseSync`，启用 `foreign_keys`，并运行基础 schema、兼容迁移和增量业务迁移。SQLite `transaction()` 发出 `BEGIN IMMEDIATE`，在单文件数据库写锁下执行工作，随后 `COMMIT`；异常时 `ROLLBACK`。

SQLite 是完整回归和本地开发基线，不等于 SQLite-only 产品限制。生产环境默认不 seed demo 数据，除非显式 `ERP_SEED_DEMO=true`。

operator 脚本（如 `scripts/admin/setup-admin.mjs`）必须按当前后端选择参数形态：SQLite 用字符串并按需 `mkdirSync` 父目录；MySQL 用缺省或对象参数，让 `resolveDatabaseConfig` 读取 `ERP_DB_*`，并跳过 SQLite 父目录创建。MySQL 环境向 `createDatabase` 传递 SQLite 路径字符串会误入 SQLite 分支。

### 6.2 MySQL adapter、worker 与 protocol

resolveDatabaseConfig 校验 ERP_DB_BACKEND 和所有 MySQL 连接参数。createMySqlDatabase：

1. 从 SQLite schema 创建兼容 snapshot；
2. 创建 MySqlSyncAdapter；
3. 由 mysql-schema.js 在 MySQL 中 bootstrap schema、索引、约束、迁移标记和 transaction gate；
4. 失败时关闭 adapter，不返回半初始化连接。

MySqlSyncAdapter 为保持既有同步 db.prepare().run/get/all 调用合同，把 mysql2 异步连接封装在 worker thread：

- 主线程向 mysql-worker.js 发送 query、exec、sequence 或 close 请求；
- 每个 adapter 复用一个 SharedArrayBuffer；
- 主线程通过 Atomics.wait 同步等待；
- protocol header 保存状态、长度、active request generation 和 response generation；
- 请求超时后 abandon 当前 generation；
- worker 只有在 generation 仍为 active 时才能发布和唤醒响应；
- 迟到响应被丢弃，不能覆盖或唤醒后续请求；
- 响应大小有固定上限，超限作为受控错误返回。

这就是 MySQL timeout-generation protocol。它解决超时后旧响应污染下一请求的问题，不代表网络或数据库操作可以无限期阻塞。

SQL adapter 只翻译项目明确使用的 SQLite 方言，例如 BEGIN IMMEDIATE、INSERT OR IGNORE、ON CONFLICT、部分 PRAGMA 查询和序列分配。新 SQL 必须同时验证两种方言，不能假设任意 SQLite 语法都可自动翻译。

### 6.3 迁移

- server/db.js 保留基础 schema、seed 和部分历史兼容迁移。
- server/migrations/ 按生命周期、计划、路由、折让和 V1.3 Phase 1–7C 组织幂等迁移。
- 迁移增加表、列、索引、角色权限和迁移标记，不为无法证明的旧来源、批次、序列号或成本伪造历史。
- MySQL bootstrap 以 schema snapshot 和 MySQL 专用约束建立等价结构。
- 应用启动不得执行业务余额自动修复；reconciliation 默认为 CHECK-only。

## 7. 领域模块责任图

| 模块 | 主要责任 |
|---|---|
| approvals.js | 五类审批查询与标准化详情 |
| planning.js | Forecast、MRP、net-before-explosion、pegging |
| planning-documents.js | 生产/采购指令、请购及下游生成 |
| production-workflow.js | 制令、领退料、生产入库及冲销 |
| manufacturing-execution.js | 工序快照、报工、良率、WIP/成本分析 |
| authoritative-quality.js | IQC/OQC 单据、快照、PASS/FAIL/STALE |
| quality-gates.js | QCP 解析、抽样、免检和物流门禁 |
| traceability-quality.js | LOT/SERIAL 分配、HOLD/RELEASE、谱系和追溯 |
| inventory-extensions.js | 盘点、调整、调拨、报废和存货期间 |
| financial-inventory.js | 数量价值、valuation、WIP、GL 对账与 System Health |
| settlement-core.js | AR/AP open-item 派生和缓存刷新 |
| settlement.js | 收款、付款、分配与冲销 |
| financial-controls.js | 预收预付、应用、退款、write-off、幂等和账户移动 |
| discounts.js | 遗留折让合同及显式冲销 |
| commercial-golive.js | Invoice/Bill、税、UOM、贷项、期初、导入导出和编号 |
| lifecycle-engine.js / data-lifecycle.js | 安全草稿删除、引用检查和例外清理 |
| decision-reports.js | 销售、采购、未履行和库存异动报告 |
| extended.js / business.js | 财务扩展、CRM、项目/OA 和仍在迁移的领域能力 |

## 8. Canonical 来源图与调用关系

### 8.1 商业和物流

    Sales Order (approved)
      → Sales Delivery draft + source lines
      → OQC policy/snapshot/PASS
      → confirm delivery
         → inventory quantity + identity + valuation + COGS voucher
      → Sales Invoice
         → AR + revenue + output tax voucher
      → collection / credit / refund / write-off / reversal

    Purchase Requisition (approved)
      → Purchase Order (approved)
      → Purchase Receipt draft + source lines
      → IQC policy/snapshot/PASS
      → confirm receipt
         → inventory quantity + identity + valuation + GRNI voucher
      → Supplier Bill + 3-way match
         → AP + input tax + PPV/GRNI voucher
      → payment / credit / refund / write-off / reversal

物流 handler 在事务内再次读取来源头、来源行和已确认累计量。来源价格由服务器继承，不接受仓库端重新定价。

### 8.2 计划和制造

    Active Forecast + approved Sales Orders
      → immutable MRP Run
      → MAKE/BUY results + pegging
      → Production/Purchase Instructions
      → Production Order or Purchase Requisition

    Production Order start
      → BOM/Routing/Cost snapshots
      → Material Issue/Return
      → Operation Reports/Reversals
      → Production Receipt/Reversal
      → Completion + WIP/variance closure

MRP 不产生库存或财务副作用。库存副作用只发生在仓库确认的执行单据；制令开工/完工本身不移动库存。

### 8.3 财务

    business source
      → source-unique SYSTEM voucher
      → accounting entries
      → POSTED-only reports

    Sales Invoice / Supplier Bill
      → positive AR/AP source item
      → immutable credits + confirmed allocations + reversals + write-off
      → derived open amount/status cache

来源业务、子账、凭证和结算账户移动通过 source_type/source_id 及唯一约束连接。手工凭证使用独立 ENTERED/SUBMITTED/POSTED/REJECTED 工作流。

## 9. 事务、锁与幂等

transaction(db, work) 是共享原子边界：

- SQLite：BEGIN IMMEDIATE 串行化写事务。
- MySQL：START TRANSACTION 后 SELECT mysql_transaction_gates(gate_id=1) FOR UPDATE，并持有到 COMMIT/ROLLBACK。

MySQL 单例 transaction gate 使不同 Node 进程、worker 和连接的所有应用写事务串行进入跨表不变量区。它优先保证当前复杂库存/财务不变量的正确性，但也限制无关写事务并行度。

MySQL 对 ER_LOCK_DEADLOCK、ER_LOCK_WAIT_TIMEOUT、errno 1213/1205 或 SQLSTATE 40001 重试完整 transaction callback。ERP_DB_TX_RETRY_MAX 默认 3，允许 0–10；退避为 20、40、80 毫秒并封顶 250 毫秒。业务校验错误不重试；最终耗尽会标记 attempts。

持久幂等由 idempotency_records 保存 operation、document、key、request fingerprint 和成功结果。MySQL 在事务前以 operation/document/key 派生的 GET_LOCK advisory lock 关闭首次并发竞态；事务完成或最终回滚后 RELEASE_LOCK。

唯一约束仍是凭证来源、单据分配、身份和自然键的最后防线。不得用进程内 mutex 作为跨进程正确性依据。

## 10. 库存身份、数量与估值

### 10.1 数量与身份

- inventory：warehouse_id + product_id 的 canonical 数量。
- inventory_transactions：每次确认产生的不可变数量流水，保存来源、方向、业务日期和余额。
- inventory_lot_balances：LOT 仓库余额。
- inventory_serials：SERIAL 唯一身份、仓库和生命周期。
- tracked_inventory_movements / tracked_source_allocations：数量流水到批次/序列号的扩展证据。

postTrackedMovement 在业务事务中验证身份集合、可用性和数量。HOLD 仍计入 on-hand，但不计入 available。调拨改变位置不改变公司总量。

### 10.2 估值

- inventory_valuation_movements 是价值权威历史。
- inventory_valuation_balances 是事务维护缓存。
- NONE 使用移动加权池；LOT 使用批次池；SERIAL 使用特定价值。
- issueValue/receiveValue/restoreOriginalValue 等操作与数量移动共享事务。
- 全量耗尽强制数量和值同时归零；退货/冲销引用原价值事件，不按当前平均价重算。
- LEGACY_UNVALUED 不被迁移静默估价，并会阻断权威关账。

System Health 比较 canonical 数量、身份聚合、valuation movement/cache 和库存 GL；只返回差异，不修复。

## 11. 财务子账、总账与对账

account_receivables/account_payables 保存正向来源及派生缓存。financial_credit_adjustments、settlement allocations/reversals、balance applications、refunds 和 write-offs 构成不可变历史。

settlement-core 按历史重新计算：

    open = original
      - effective credits
      - effective allocations
      - balance applications
      - effective write-offs
      + reversals

open 不得为负。确认收付款时，settlement.js 在事务中重新读取 draft、party、每个 source open、分配合计和账户，再创建凭证、移动、缓存和审计。

系统凭证通过 source type/id 唯一。generate/createSystemVoucher 负责期间门禁、科目角色解析、借贷严格相等和 POSTED 写入。财务报表只查询 POSTED。

System Health 对 inventory value、WIP、GRNI、AR、AP、税、COGS、cash/bank 和来源单据执行 GL reconciliation。关闭期间前必须无阻断差异；存货期间先关，会计期间后关。

## 12. 制造、WIP 与成本

制令开工从当前有效 BOM、路线、工作中心和成本创建不可变快照：

- 物料需求 = planned quantity × snapshot usage；
- 工序保存 sequence、work center、setup/run seconds、capacity 和 rate；
- 标准成本保存材料、人工、制造费用和单位成本。

领料按冻结标准成本 Dr WIP / Cr inventory；生产入库按冻结单位成本 Dr finished inventory / Cr WIP。operation report 记录良品、报废和人工/设备时间。冲销记录保留原 report 并按依赖顺序恢复。

manufacturing-execution 计算：

- 工序可用投入和下游消耗；
- 良率、报废率和预期差异；
- 工作中心计划/实际负荷；
- AUTHORITATIVE/PARTIAL/ESTIMATED 材料证据；
- 人工、制造费用、总成本和制造差异。

缺失设备时间时制造费用和依赖它的总成本保持 null，不用零替代。完工时制造差异显式过账并要求 WIP 归零。

## 13. 开票、税、UOM、期初与导入导出

commercial-golive.js 集中 V1.3 商业层：

- quantitySnapshot 使用版本化 UOM 精确分数，并保存单据/基本数量快照。
- calculateLineTax 和 roundRational 使用 BigInt 分数与 round-half-up，单据税为行税之和。
- create/postSalesInvoice 连接已交付未开票量，并生成 AR/Revenue/Output Tax。
- create/match/postSupplierBill 完成 PO/Receipt/Bill 匹配，生成 AP/Input Tax/GRNI/PPV。
- createCommercialCreditNote 按原单净额/税额比例生成不可变反向商业记录。
- allocateDocumentNumber 使用数据库序列和幂等分配。
- opening_batches 提供 validate/submit/approve/post/activate。
- stageCsvImport、validateImport、commitImport 提供分阶段原子导入。
- canonicalExport 从 canonical inventory、AR/AP、POSTED GL、税或 System Health 导出。

Go-Live 激活与普通首笔业务共享事务 gate，避免期初状态和正常过账交叉。激活后期初入口关闭。

## 14. 错误、安全与可观测性

- HttpError 用于预期 4xx/409；未知错误不把 SQL、stack 或 secret 返回客户端。
- readJson 限制 body 大小、Content-Type 和对象形状。
- SQL 参数通过 prepare 绑定；敏感用户字段使用 allowlist。
- 静态路径用 path.relative containment 校验。
- logger 输出单行 JSON：timestamp、level、service、event 和安全元数据。
- 每个响应带 X-Request-Id；调用方 request ID 必须满足受限格式。
- 慢请求按 SLOW_REQUEST_MS 记录，慢 MySQL 查询按 SLOW_QUERY_MS 记录；只记录标签、时长和 SQL fingerprint。
- GET /api/health/live 只检查进程；/api/health/ready 执行最小数据库探针；/api/health 保留兼容 alias。
- /api/system-health 需要权限，只执行业务 reconciliation，不用于 readiness。

## 15. 测试架构与 gate

### 15.1 默认回归

server/*.test.js 使用 node:test，主要通过 server/test-utils/temp-db.js 或系统临时目录创建隔离 SQLite 数据库。测试必须证明仓库默认 data/erp.db 不被访问或删除。

测试层次：

- 领域 focused tests：状态、金额、来源、权限和回滚。
- 合同测试：五角色、五审批族、schema/migration、前端源结构。
- 集成/UAT：跨模块业务链、期间关闭和 reconciliation。
- UI/浏览器工具：在隔离数据库和临时输出目录运行。

默认完成 gate：

    focused node --test ...
    pnpm test
    pnpm build
    git diff --check

### 15.2 MySQL gate

- pnpm test:mysql：schema/SQL 兼容与业务集成。
- pnpm test:mysql:concurrency：多进程、多连接真实锁等待与竞态。
- pnpm test:mysql:performance：1/5/10/20 writer 的 gate benchmark。

`pnpm test:mysql` 和 `pnpm test:mysql:concurrency` 的 launcher 位于 `scripts/gates/`；并发 gate 与 `scripts/diagnostics/mysql-phase7c-performance.mjs` 都调用 `scripts/gates/mysql-concurrency-worker.mjs`。launcher 使用模块位置推导仓库根目录、测试文件和 worker 绝对路径，并显式设置子进程 `cwd`，避免受调用 CWD 影响；传入子进程的 MySQL 测试环境与 reset 防护保持不变。

MySQL gate 要求全部连接变量、ERP_MYSQL_TEST_ALLOW_RESET=true，以及数据库名包含 test、phase7a/phase7c 或 disposable 等安全标识。缺失条件时必须拒绝执行。测试不得接触生产或未知数据库。

## 16. 部署、备份、恢复与管理操作

部署入口：

- deploy/systemd/modern-erp.service：modern-erp 用户、/opt/modern-erp、/etc/modern-erp/env、Node server/index.js。
- deploy/nginx/modern-erp.conf：Nginx → 127.0.0.1:3001 单一代理。
- deploy/systemd/modern-erp-backup.service/timer：调用 scripts/admin/backup-db.mjs。

SQLite：

- scripts/admin/backup-db.mjs 使用 VACUUM INTO 生成一致快照、校验 integrity_check 并执行 retention。
- scripts/admin/restore-db.mjs 验证备份、生成 safety backup、处理 WAL/SHM、恢复后再次校验；生产要求显式确认且应在维护窗口停服务。
- reset-data.js 在 NODE_ENV=production 下 fail closed。

MySQL：

- 当前仓库提供 schema bootstrap、SQLite-to-MySQL 转换和测试 gate。
- SQLite VACUUM 备份/恢复工具不是 MySQL 生产备份方案；MySQL 生产备份、恢复演练、升级/回滚和灾备必须由后续独立运维方案确认。

scripts/admin/setup-admin.mjs 只用于显式创建首个 ADMIN，要求强密码、拒绝覆盖和弱演示密码，不被应用启动自动调用。scripts/admin/convert-sqlite-to-mysql.mjs 只允许绝对 disposable SQLite 副本与显式启用 reset guard 的测试 MySQL 目标，不得用于仓库默认数据库或未知生产库。

`setup-admin` 必须在当前配置的数据库后端下工作，并按 §6.1 的 `createDatabase(target)` 参数语义分派：

- 后端选择：脚本读取 `ERP_DB_BACKEND`。`backend === 'sqlite'`（默认）走 SQLite 路径；`backend === 'mysql'` 走 MySQL 路径。任何情况下都不得用 SQLite 路径字符串误入 SQLite 分支。
- SQLite 路径：`dbPath = process.env.ERP_DB_PATH || <repo>/data/erp.db`；`createDatabase(dbPath)`（字符串参数）；打开前 `mkdirSync(dirname(dbPath), { recursive: true })`。
- MySQL 路径：不构造 SQLite 路径字符串；调用 `createDatabase()`（缺省参数）让 `resolveDatabaseConfig` 读取 `ERP_DB_HOST/PORT/NAME/USER/PASSWORD`；跳过 `ensureDbDir`（MySQL 不需要文件系统 DB 目录）。
- 函数签名：保留 `setupAdmin({ dbPath, username, password, rootDir })` 形式作为测试入口（dbPath 用于 SQLite 直接注入）；operator CLI 入口按上述后端选择规则调用。
- 必须保留的既有合同：用户名必填、密码必填、`MIN_PASSWORD_LENGTH = 12`、`WEAK_DEMO_PASSWORDS` 弱演示密码集合拒绝、ADMIN 角色存在校验、已存在用户拒绝、`hashPassword`（scrypt + 随机盐）、明文密码不记录/不持久化、显式 operator 调用禁止应用启动自动调用、退出码语义（成功 0、失败 1）不变。

当前仓库不提供适用于 V1.4 的可直接执行生产全量数据重置工具。全量生产数据重置必须使用单独评审、与目标 schema 和部署环境匹配、具有备份/恢复证据并获得明确批准的环境化流程；`server/reset-data.js` 只允许仓库外的一次性开发/测试 SQLite 数据库，不能替代生产流程。

## 17. 性能与并发特征

已确认：

- Vite 页面/vendor 拆包消除了原主 bundle 超 500 kB 警告。
- MySQL 独立 session 通过数据库 gate，而不是单进程队列，保证跨进程写正确性。
- 唯一约束、advisory idempotency lock、transaction retry 和请求 generation 共同处理重复与并发失败。
- 部分高风险查询有索引、上限和慢查询观测。

当前限制：

- 全局 transaction gate 串行化所有写事务，即使文档互不相关。
- 没有 disposable MySQL 环境的运行不能作为性能通过证据。
- 真实 10k 产品、50k 单据、百万流水等目标数据集的 EXPLAIN ANALYZE 和端点 p95 尚未形成正式证据。
- 一些旧主数据/分析列表仍无默认分页。
- 读取不受写 gate 快照串行化；所有权威 mutation recheck 必须留在 transaction 内。

因此当前结论是 KEEP GLOBAL GATE：没有证据前不削弱正确性边界，同时不宣称已经认证企业级吞吐。未来只有在真实 benchmark、query plan 和完整回归支持下，才能改为确定性资源级锁。

## 18. 版本、已知技术债与批准边界

- Git tag 标识项目发布版本，package.json.version 镜像最新发布基线；精确维护检出状态由 Git SHA 或 git describe 标识。
- 当前 master 是 V1.4.1 发布基线；当前 HEAD 携带 v1.4.1 release-preparation 元数据，等待 future annotated tag 指向 release-preparation commit 而非 E8 implementation baseline。
- server/app.js 和若干页面仍过大，路由/页面拆分需要独立设计和回归。
- SQLite schema、历史 imperative migrations 与 MySQL bootstrap 并存，新增迁移必须验证双路径。
- docs/ 已分为 operations 当前专项指南与 archive 历史证据；两者均不得覆盖本文件和 document.md 的 canonical 合同。
- 旧 archive 当前工作树已脱敏，但 Git 历史仍包含历史秘密；历史清理与凭据轮换不属于普通代码重构。
- MySQL 生产备份/恢复、真实容量、分页收口和部署升级/回滚仍需环境化验收。
- 多公司、多币种、年结、政府电子发票、APS、完整 MES/OEE/QMS 和期初 WIP 属于明确未支持范围，不得通过 UI 或文档暗示已实现。

## 19. UAT R2 前端可见范围与设计调整

### 19.1 范围与不变量

R2 移除两个用户可见页面（`system-health`、`go-live`），不调整后端 reconciliation、Go-Live / import、商业结算（Sales Invoice / Supplier Bill）、税、UOM 服务、相关数据库表与 server API。不新增业务角色；canonical 五角色不变。R1 已固化的需求（document.md §2 §3 §15 §16 §19 §20）保持。

### 19.2 前端文件删除与修改

整文件删除：

- `src/pages/system-health.jsx`：单一 `SystemHealth` 默认导出，唯一消费者是 `src/App.jsx` 的路由表项；无其他导入。

文件级修改：

- `src/pages/commercial-go-live.jsx`：删除 `GoLive` 具名导出与对应 JSX 体（顶部 `<Panel>`、`api('/api/opening-batches')`、`api('/api/imports')` 等 stage/validate/commit 调用）；保留 `SalesInvoices` 与 `SupplierBills` 两个具名导出（同文件承载）。
- `src/App.jsx`：删除 `import SystemHealth`；从 `launcherIconNames` 删除 `'health'` 标记；删除 `system-health` 与 `go-live` 桌面 `navGroups` 项；删除两个对应路由表项；从 `import { GoLive, SalesInvoices, SupplierBills }` 删除 `GoLive` 标记（保留 `SalesInvoices`、`SupplierBills`）。`ic.health` 失去两个唯一引用但本身保留在 `icons.jsx` 不清理。
- `src/navigation/applicationMetadata.js`：删除 `MOBILE_APPLICATION_GROUPS` 中 `system-health` 与 `go-live` 两项。
- `src/styles.css`：删除 `.go-live-rail*`、`.go-live-workbench*`、`.eyebrow`、`.opening-row` 等仅 GoLive 使用的选择器；保留 `.billing-strip`、`.commercial-totals`、`.source-facts`（被 `SalesInvoices` / `SupplierBills` 复用）。`system-health-page` 不存在 CSS 规则，无需清理。

不动的部分：

- `src/pages/decision-reports.jsx` 的 `.decision-report__reconciliation` 卡片（库存期间对账 UI，独立于 System Health）。
- 后端 handler、路由、表、模块、SQL migration。

### 19.3 其他 `/api/imports` 前端消费者

无。`/api/imports` 在前端的全部三个调用点（`stage` / `validate` / `commit`）都位于 `commercial-go-live.jsx` 的 `GoLive` 组件内。`/api/opening-batches` 也仅由 `GoLive` 调用。删除 `GoLive` 即清空两族后端 API 在用户可见前端的所有引用，不会影响其他 ERP 模块。

### 19.4 应用启动卡、桌面导航与移动应用注册

- 应用启动卡：`launcherIconNames` 删除 `'health'` 后，`system-health` 启动卡不再渲染；`go-live` 本无独立启动卡条目。
- 桌面导航：财务组 `navGroups` 减少两个卡片，不重新平衡其余顺序。
- 移动应用：`MOBILE_APPLICATION_GROUPS` 的 finance 组减少两个应用，不重新平衡其余顺序。
- 图标：`ic.health` 删除两个引用后无消费者；保留在 `icons.jsx` 不清理，避免引入不相关的清理。

### 19.5 测试计划

用户载荷合同（新建 `server/uat-r2-user-payload.test.js`）：

- `assertAllowedFields(['username','displayName','password','roleId'])` 在对象包含 `active` 时抛出 400 `请求包含不支持的字段: active`（验证 CREATE 严格合同不被弱化）。
- `assertAllowedFields(['displayName','password','roleId','active'])` 在对象仅含 `active` 时不抛出（验证 PATCH 合同不变）。
- `createUser` handler 在收到 `active` 字段时返回 400 与原错误文本一致。
- `updateUser` handler 在 PATCH 载荷不包含 `password` 键时保留原密码（`body.password === undefined` 分支）。

setup-admin 后端扩展（现有 `server/setup-admin.test.js`）：

- 在 `process.env.ERP_DB_BACKEND='mysql'` 下，验证 `setupAdmin` 内部调用 `createDatabase()` 而非 `createDatabase(string)`，且不触发 `mkdirSync` SQLite 父目录。可通过 stub 或 spy 实现，无须 live MySQL。
- 现有 SQLite focused tests 保持通过；`MIN_PASSWORD_LENGTH`、`WEAK_DEMO_PASSWORDS`、ADMIN 角色校验、已存在用户拒绝、明文密码不记录合同不变。

前端移除（现有 `server/mobile-application-launcher.test.js`）：

- 从 `role-admin` 与 `role-accounting` 期望导航页列表中删除 `'system-health'` 与 `'go-live'` 两个标记。

受影响既有 focused tests 必须 0 failed；`pnpm test` 全量回归必须 0 failed；`pnpm build` 通过；`git diff --check` 通过。仅在具备受保护 disposable MySQL 环境时才运行 `pnpm test:mysql`，不得把未知或生产数据库用于测试。

### 19.6 README 与 document.md

- README.md：实现阶段需要在"当前支持"清单与项目地图中确认 System Health / Go-Live 不再列为用户可见模块；后端能力（reconciliation、opening batches、CSV import）继续保留。
- document.md：R1 已完成需求更新；实现阶段不重写。
- 历史文档（`docs/archive/*`、`log/*`）一律保留，不动。

## 20. UAT R4 设计：采购来源链衔接与源型 PO 编辑

本节是 Phase R4-R2 的技术设计，仅在设计阶段记录，不触动实现。R4-R1 的需求已在 document.md §7 / §8 / §20 固化（commit `37fd954`）。本节为 R4-R3 实施提供精确的调用链、合同、根因与最小修复边界。

### 20.1 数据模型与现有来源字段

Purchase Instruction（`server/modules/planning-documents.js`，`purchase_instructions` / `purchase_instruction_items`）：

- header：`id`、`instruction_no`、`mrp_run_id`、`status` (`DRAFT` / `RELEASED` / `CANCELLED`)、`planned_date`、`notes`、`created_by`。
- items：`id`、`instruction_id`、`mrp_result_id`、`product_id`、`quantity`、`need_by_date`、`purchase_requisition_id`（回链，null 表示尚未生成请购）。

Purchase Requisition（`server/modules/planning-documents.js`，`purchase_requisitions` / `purchase_requisition_items`）：

- header：`id`、`requisition_no`、`source_instruction_id`（回链）、`status` (`DRAFT` / `SUBMITTED` / `APPROVED` / `REJECTED` / `CANCELLED`)、`request_date`、`required_date`、`notes`、`creator_id`、`purchase_order_id`（回链）。
- items：`id`、`requisition_id`、`product_id`、`quantity`、`preferred_supplier_id`、`unit_price_cents`、`amount_cents`、`purchase_instruction_item_id`（回链到 PUI 明细）。

Purchase Order（`server/app.js`，`purchase_orders` / `purchase_order_items`）：

- header：`id`、`order_no`、`supplier_id`、`status`、`order_date`、`expected_delivery_date`、`payment_terms`、`payment_terms_days`、`supplier_contact_name/phone/address`、`purchase_requisition_id`（回链）、`creator_id`、`total_cents`、`remark`。
- items：`id`、`order_id`、`product_id`、`quantity`、`unit_price_cents`、`amount_cents`、`line_no`、`purchase_requisition_item_id`（回链到 PR 明细），外加 V1.3 Phase 1 引入的 UOM / 数量分数快照（`document_uom_code` / `document_quantity_num` / `document_quantity_den` / `conversion_*` / `base_quantity_num` / `base_quantity_den`）。

已有来源字段（实施只需复用，不需要迁移）：

- PR 行级 source：`purchase_requisitions.source_instruction_id` + `purchase_requisition_items.purchase_instruction_item_id`。
- PO 行级 source：`purchase_orders.purchase_requisition_id` + `purchase_order_items.purchase_requisition_item_id`。

source product：`product_id`（在 PR / PO 行上复制自上游）。
source quantity：`quantity`（在 PR / PO 行上复制自上游，PO 生成时由服务端从 PR 复制；编辑 PUT 时服务端再次读取并存对比）。

### 20.2 UAT-FUNC-003 根因 — MRP / 采购指令 → 请购单只部分衔接

调用链：

- 已有快捷路径：`src/pages/planning-documents.jsx` 的 `PurchaseInstructionDetail` 行内 “生成请购单” 按钮（line 416-440）已经构造完整 `POST /api/purchase-requisitions` body，包含 `sourceInstructionId`、`items: [{ productId, quantity, purchaseInstructionItemId }]`，后端 `createPurchaseRequisition`（`planning-documents.js:661`）按现有校验链路写入，来源链路完整。
- 失效路径：`src/pages/planning-documents.jsx` 的 `PurchaseRequisitionCreate` 模态（line 518 起）打开后，`form` 初始 items 为空；当用户在 `来源采购指令` 下拉中选择 PUI 时，**没有 useEffect 拉取 `GET /api/purchase-instructions/:id` 来填充 items**，操作员只能手工点击 “＋ 增加” 并填写 productId / quantity / unitPriceCents，再点保存。

根因分类：选项 A（source 对象未传递到 PR 模态）+ 选项 B（source 即使可选中，表单 initializer 也不会加载 PUI 明细）组合。`source_instruction_id` 字段本身已存在于 PR header，但 PR items 与 PUI items 之间没有自动联动。

### 20.3 PR 自动衔接最小设计

源日期模型：

- `purchase_instructions` header 仅含 `planned_date`，没有 header 级 “要求到货日”。`purchase_instruction_items` 行级保留 `need_by_date`（可为 null）。
- `purchase_requisitions` header 强制单一 `required_date`；`purchase_requisition_items` 不带自己的 `need_by_date`。当前 `createPurchaseRequisition` 校验（`planning-documents.js:704`）要求 `required_date` 与每条来源 item 的 `need_by_date` 严格相等 —— 即当 PUI items 中存在非空 `need_by_date` 时，PR header 的单一 `required_date` 必须与之匹配；为不引入 schema 变更，本设计不改变这一单值约束。

PR 自动衔接的前端最小修改：

- `useEffect` 监听 `form.sourceInstructionId` 变化。若非空，调 `GET /api/purchase-instructions/:id` 并将返回的 `items[]` 映射为 form items，每行携带 `productId`、`quantity`、`purchaseInstructionItemId`、`unitPriceCents`（取 `product.priceCents` 默认值）、`amountCents = quantity * unitPriceCents`。
- `required_date` 默认值的确定性聚合规则：从 PUI items 中筛选 `need_by_date` 非空值，取**最早日期**（按 `YYYY-MM-DD` 字典序 / 时间序等价）；若全部为空，回退 `planned_date`。规则按集合而非顺序计算，避免依赖首条 item 的偶然顺序。
- 操作员仍可在表单里覆盖 `required_date` / 改 quantity / unitPriceCents / preferredSupplierId；任何数量修改显式发生在 PR 行上，不回写 PUI。后端 `createPurchaseRequisition` 已 enforce `quantity <= pii.quantity` 与 `purchase_requisition_id` 反向唯一约束；`required_date` 不与来源 item 的 `need_by_date` 一致时由后端拒绝，操作员可改 `required_date` 重新提交或调整来源。
- 当 `sourceInstructionId` 清空（手工创建），form items 保持空白，不强制来源链路；`required_date` 默认按 today / 空字符串维持既有行为。

不引入新 schema；现有 `purchase_requisitions.source_instruction_id` 与 `purchase_requisition_items.purchase_instruction_item_id` 已足够。

### 20.4 PR → PO 创建合同

`POST /api/purchase-requisitions/:id/generate-purchase-order`（`server/modules/planning-documents.js:842` 的 `generatePurchaseOrderFromRequisition`）：

- 仅 `APPROVED` 且 `purchase_order_id IS NULL` 的 PR 可触发。
- 必填 body：`supplierId`。
- 可选：`orderDate`、`expectedDeliveryDate`、`paymentTerms`、`supplierContactName`、`supplierContactPhone`、`supplierAddress`。
- 服务端从 PR items 复制 `product_id`、`quantity`、`unit_price_cents`，逐行写入 PO items，并写入 `purchase_requisition_item_id`（行级回链）。
- PO header 写入 `purchase_requisition_id`（头级回链）。
- 当前实现 INSERT 列不包含 `payment_terms_days`，新建源型 PO 默认 0；保存草稿时由操作员补齐。

### 20.5 PO 更新合同与不可变边界

`PUT /api/purchase-orders/:id`（`server/app.js:1509` 的 `updatePurchaseOrder`）：

权限：`PURCHASE_ORDERS_CREATE`，且仅 `DRAFT` / `REJECTED` 状态，且仅 `creator_id === actor.id` 或 `ADMIN`。

源型 PO 不可变（`current.purchase_requisition_id` 非空时，line 1516-1527）：

- 头：`purchase_requisition_id`（PUT body 提供不同值 → 409）。
- 行：`purchase_requisition_item_id`（缺失或变更 → 409）、`product_id`（与 stored 不等 → 409）、`quantity`（与 `Number(stored.quantity)` 不等 → 409）。
- 行集合大小必须一致（line 1519：增删行 → 409）。

源型 PO 可编辑：

- header：`supplierId`、`orderDate`、`expectedDeliveryDate`、`paymentTerms`、`paymentTermsDays`、`supplierContactName/Phone/Address`、`remark`。
- 行：`unitPriceCents`（每行）。

非源型 PO 没有上述行级不可变约束；前端传不带 `purchaseRequisitionItemId` 的 items 时走 `savePurchaseOrderItems`（line 1545）路径，行为不变。

### 20.6 UAT-FUNC-004 根因 — PO 编辑死锁

调用链：

- `src/pages/master-data.jsx` 的 `PurchaseOrderEditor`（line 410-486）：
  - 初始化 line 425-436：`setForm({ ..., items: detail.order.items.map((x) => ({ productId: x.productId, quantity: x.quantity, price: x.unitPriceCents / 100 })) })` —— 这一步丢弃了 `purchaseRequisitionItemId`。
  - 保存 line 457-462：`items: form.items.map((x) => ({ productId: x.productId, quantity: Number(x.quantity), unitPriceCents: yuanToNonNegativeCents(x.price) }))` —— PUT body 同样不包含 source 标识。
- `server/app.js` `updatePurchaseOrder`（line 1520-1527）：`sourceId = sourceLineId(body.items[index], 'purchaseRequisitionItemId', 'purchase_requisition_item_id')`，因前端未携带，返回 `null`；`!sourceId` 为真，立即触发 409 “来源请购明细、货品和数量不可修改”，即使操作员只改过 `paymentTerms` / `paymentTermsDays`，与 productId / quantity 完全无关。

根因分类：选项 F（前端序列化 PUT 载荷时漏掉了应保留的源行标识）。后端 immutability 校验本身正确；问题在前后端载荷合同不一致。

quantity 整数 round-trip 不会引入 drift：当 `uomCode === base_uom_code`（默认）时，`quantitySnapshot` 走 `server/modules/commercial-golive.js:68` 的 `doc = rational(num, 1)` → `base = multiplyRational(doc, {1,1})` → `quantity = base.num / base.den`，整数 quantity 精确还原。

### 20.7 选定 PO 更新设计

设计实质（不使用此前 “Option A / B / C” 标签中任何一项，原 Option A 定义为“header-only update / omit immutable lines”，与本设计不同）：

- `PurchaseOrderEditor` 继续按现有合同发送完整的 PO item payload（`productId` / `quantity` / `unitPriceCents`）；不在 PUT body 中省略 items。
- 唯一新增的载荷字段：每行 item 携带 `purchaseRequisitionItemId`，从已加载的 `detail.order.items` 透传到 PUT body。
- 源型 PO 的 productId 与 quantity 由前端保持原值；后端 immutability 校验（`server/app.js:1520-1527`）保持不变 —— 修复的是“源标识缺失导致未变更的源行被误判为 mutation”这一前端载荷丢失，而不是放宽校验。
- 后端 `sourceLineId` 解析路径（`server/app.js:2297`）已支持 camel / snake / `sourceItemId` / `source_item_id` 四种写法，前端使用 camel `purchaseRequisitionItemId` 即可。
- 不引入 header-only / line-only 分路径：现有 PUT 路径对源型 / 非源型 PO 都成立，仅 item 字段的可变范围由 backend 决定。

边界：

- 不可变字段（`purchase_requisition_item_id` / `productId` / `quantity`）继续由后端严格校验；前端不修改、不省略。
- `unitPriceCents` 允许修改，因为源型 PO 的合同只把 product / quantity 定义为不可变。
- 不得为绕过校验而放宽后端；不得在 PUT 之外新增旁路。
- `purchase_order_items` 表在 update 期间被 `DELETE FROM purchase_order_items WHERE order_id=?` 全删再 INSERT（line 1537），PO 行的 `id` 会变化；下游 `purchase_receipts` 与 `purchase_receipt_items` 通过 `purchase_order_id` 与新 PO 行 `product_id` / `quantity` 重新匹配；这与 R4-R1 之前的现有行为一致，不在本设计中扩展。

### 20.8 付款条件 / 付款天数语义

字段与校验：

- `payment_terms` (text, max 200)：`readSnapshotText` 任意字符串。
- `payment_terms_days` (integer 0–3650)：`paymentTermsDays` helper（`server/app.js:1412-1416`）拒绝非安全整数 / 负值 / > 3650。
- 提交（`changePurchaseOrderState`，`server/app.js:1551-1597`）：line 1570 强制 `payment_terms` 非空；`payment_terms_days` 没有非零强制。

UAT 验收数据建议：

- `payment_terms = '月结 30 天'`
- `payment_terms_days = 30`

允许 `payment_terms = '现金'` 配合 `payment_terms_days = 0`，但语义不一致时建议同时调整。

### 20.9 数据库 / schema 影响

**MYSQL SCHEMA CHANGE REQUIRED = NO**。

理由：

- PR / PO 的 source 字段（`source_instruction_id`、`purchase_instruction_item_id`、`purchase_requisition_id`）均已存在。
- 修复仅在前端保留现有 source 标识的透传；后端合同保持不变。
- 没有数据迁移；现有数据完全兼容。

### 20.10 现有生产 PO 兼容性

**EXISTING PO-20260926-67857530 RESUMABLE AFTER FIX = YES**。
**REPLACEMENT PO REQUIRED = NO**。

- PO 当前处于 DRAFT；`purchase_order_items` 行已写入并保留 `purchase_requisition_item_id`。
- 修复后操作员重新打开编辑器 → 表单 items 携带 `purchaseRequisitionItemId` → PUT body 由前端补全 source 标识 → 后端校验通过 → 保存成功 → 提交。
- 不需要取消 / 重建 PO；不需要数据迁移。
- 在 R4-R3 实施阶段不得触生产数据；R4-R2 仅记录设计结论。

### 20.11 回归测试计划

新建 `server/uat-r4-purchase-source-chain.test.js`（与 R2 类似命名），按需求 A–J 覆盖：

A. Purchase Instruction → PR auto-carry
- 后端：在 PR 创建时携带 `purchaseInstructionItemId` 与 `sourceInstructionId`，写入 `purchase_requisition_items.purchase_instruction_item_id`。
- 前端 contract：通过 fixture 模拟 `PurchaseRequisitionCreate` useEffect 联动，调 `GET /api/purchase-instructions/:id` 后应能填充 items。

B. 不依赖手工重打
- 生成的 PR 可直接进入 submit；不需要操作员重打 product / quantity。

C. 源型 PO header edit
- 创建 APPROVED PR → 生成 PO；模拟操作员改 `paymentTerms` + `paymentTermsDays`；PUT `updatePurchaseOrder` 返回 200。

D. 源型 PO 不可改 product
- PUT body 携带与 stored 不同 `productId` → 409。

E. 源型 PO 不可改 quantity
- PUT body 携带与 stored 不同 `quantity` → 409。

F. 未变更 source lines 不触发 immutable error
- 改 `paymentTerms` / `paymentTermsDays`、items 原样携带 `purchaseRequisitionItemId` → 200。

G. PO 提交
- 补齐 `payment_terms` 后 `submit` 成功 → 状态 `SUBMITTED`。

H. 手工创建 PO 回归
- 不携带 `purchaseRequisitionItemId` 的 PUT（无源 PR 的 PO）仍能正常编辑 / 提交。

I. 后端 strict-source 校验保留
- 现有 `server/m12-planning-documents.test.js` 等不动；新增测试覆盖 `updatePurchaseOrder` 对缺失 source 标识的 409。

J. 库存副作用 = 0
- PR / PO 任何编辑与审批路径中 `inventory_transactions` 行数不变；`accounting_vouchers` 行数不变。

实施阶段 `pnpm --config.verify-deps-before-run=false test` 全量 0 failed；`pnpm --config.verify-deps-before-run=false build` 通过；`git diff --check` 通过。

### 20.12 实施范围 / 文件清单

Frontend：

- `src/pages/master-data.jsx`：在 `PurchaseOrderEditor` 的初始化和保存 map 中各加一行 `purchaseRequisitionItemId: x.purchaseRequisitionItemId`，不改动其他字段。
- `src/pages/planning-documents.jsx`：在 `PurchaseRequisitionCreate` 增加一个 `useEffect` 监听 `form.sourceInstructionId`，调用 `GET /api/purchase-instructions/:id` 自动填充 items；处理 loading / 错误 / 已填项防覆盖。

Backend：不动；现有 `purchaseOrderInput` / `updatePurchaseOrder` / `sourceLineId` / `paymentTermsDays` / `createPurchaseRequisition` / `generatePurchaseOrderFromRequisition` 均保持。

Tests：

- 新建 `server/uat-r4-purchase-source-chain.test.js`。
- 不修改任何既有测试。

### 20.13 README / document 影响

- README.md：不需要修改（采购流程描述未改变）。
- document.md：R4-R1 已固化需求，本阶段不重写。
- 历史文档（`docs/archive/*`、`log/*`）一律保留。

### 20.14 R4-R2B — 采购来源链 cardinality / schema 校正（R4-R3A 触发的设计修订）

R4-R2A 通过只读审计发现 R4-R2 §20.3 / §20.9 在 schema 约束上结论错误：现行迁移 `server/migrations/planning-documents-schema.js:179-183` 的唯一索引方向与 R4-R1 / R4-R2 已批准的多行来源链路模型冲突。本节是 R4-R3A 之后的更正设计，取代 §20.3 中 “不引入新 schema” 与 §20.9 中 “MYSQL SCHEMA CHANGE REQUIRED = NO” 的两条结论。R4-R1 业务需求保持不变。

#### 20.14.1 正确的 domain cardinality

| 关系 | Cardinality |
|---|---|
| `purchase_instructions` 1 → `purchase_instruction_items` N | 一对多 |
| `purchase_requisitions` 1 → `purchase_requisition_items` N | 一对多 |
| `purchase_instruction_items` 1 → 0..1 `purchase_requisition_item` | 一对多对多（PUI 行至多被一个 PR 行消费） |
| `purchase_requisition_item` 0..1 → 1 `purchase_instruction_item` | PR 行可保留 0 个或 1 个来源 PUI 身份 |
| 多 `purchase_instruction_items` 行共享同一个 `purchase_requisition_id` | **允许**（approved multi-line source-chain 模型的硬性要求） |

#### 20.14.2 现有错误约束（与已批准模型冲突）

`server/migrations/planning-documents-schema.js:179-183`：
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_instruction_items_requisition
  ON purchase_instruction_items(purchase_requisition_id)
  WHERE purchase_requisition_id IS NOT NULL;
```

单列 UNIQUE 方向错误地把 "PUI 行被消费" 表达成 "一个 PR 最多只能被一个 PUI 行回链"。这与 R4-R1 已批准的多行来源链路模型（一个 PR 可包含多个来源 PUI 行）直接冲突。R4-R3 实施时不得不使用 “首行保留 source 标识、其他行置 null” 的 workaround，违反 R4-R1 “来源参考必须保留” 与 R4-R2 §20.3 “每行携带 purchaseInstructionItemId”。

#### 20.14.3 正确的 database 约束模型

A. 去除 `purchase_instruction_items.purchase_requisition_id` 的唯一性 — 仍可保留非唯一索引以支持 PUI → PR 回链查询。

B. 在 `purchase_requisition_items.purchase_instruction_item_id`（注意：是 PR items 表上的前向字段，不是 PUI 表）上增加部分唯一约束：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_requisition_items_pui
  ON purchase_requisition_items(purchase_instruction_item_id)
  WHERE purchase_instruction_item_id IS NOT NULL;
```

这正好表达 “一个 PUI 行至多被一个 PR 行消费” 的反向 cardinality，同时不限制 “一个 PR 可包含多个 PUI 行”。

双后端兼容：与现有 `idx_purchase_requisitions_po` 等部分唯一索引同型，SQLite 直接接受；MySQL 由 `server/database/mysql-schema.js` 的 generated-column-with-SHA2-digest 路径处理（已在 v13-phase7c performance 等迁移中使用同型约束）。

#### 20.14.4 并发 / 重复消费保护

新的 `UNIQUE(purchase_requisition_items.purchase_instruction_item_id) WHERE NOT NULL` 是数据库级并发安全网：两个并发 `createPurchaseRequisition` 同时尝试消费同一 PUI 行时，第二个 INSERT 命中 UNIQUE 约束并使事务回滚，避免 race。

现有应用级友好错误检查 `createPurchaseRequisition` 中 `if (pii.purchase_requisition_id) throw new HttpError(409, '该采购指令明细已经生成过请购单')`（`planning-documents.js:704`）保留不变 — 它对正常串行请求给出可读的中文错误信息，DB 级 UNIQUE 是其并发安全网。不需要额外的条件 UPDATE。

#### 20.14.5 迁移设计

新建 `server/migrations/r4-purchase-source-cardinality.js`，导出 `migrateR4PurchaseSourceCardinality(db)`，由 `server/db.js` 的迁移序列调用（约 line 175 之后）。迁移执行步骤（顺序敏感）：

1. **前置条件检查**（fail-closed）：运行
   ```sql
   SELECT purchase_instruction_item_id, COUNT(*) cnt
     FROM purchase_requisition_items
    WHERE purchase_instruction_item_id IS NOT NULL
    GROUP BY purchase_instruction_item_id
   HAVING COUNT(*) > 1;
   ```
   若返回任何行，迁移**停止**并抛出明确错误（不静默删除或重写业务数据）。错误信息应列出重复的 `purchase_instruction_item_id` 与数量，要求人工评审。

2. **删除错误唯一索引**：
   ```sql
   DROP INDEX IF EXISTS idx_purchase_instruction_items_requisition;
   ```

3. **保留非唯一查找索引**（保持现有 PUI → PR 回链查询性能）：
   ```sql
   CREATE INDEX IF NOT EXISTS idx_purchase_instruction_items_requisition_lookup
     ON purchase_instruction_items(purchase_requisition_id);
   ```

4. **新增正确方向的部分唯一约束**：
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_requisition_items_pui
     ON purchase_requisition_items(purchase_instruction_item_id)
     WHERE purchase_instruction_item_id IS NOT NULL;
   ```

幂等性：每个 DDL 自身已 `IF EXISTS` / `IF NOT EXISTS`，重复运行不会破坏。前置检查在已修复数据库上永远返回空，安全。

#### 20.14.6 现有生产数据兼容性

- 现有 `purchase_requisition_items` 行若存在重复 `purchase_instruction_item_id`，前置检查会拦截并要求人工评审。R4-R3A 仅做了 schema 审计、未实际查询生产数据库；该前置条件在实施阶段必须先由用户在受保护 disposable 副本或直接 production read-only 视角下确认。
- 现有 `purchase_instruction_items.purchase_requisition_id` 非空值不受迁移影响（旧索引被 DROP，值保留；新非唯一索引覆盖相同列）。
- 现有生产 PO `PO-20260926-67857530` 不涉及 PR 行级 schema 变化，仍可按 R4-R3 §UAT-FUNC-004 修复恢复 — REPLACEMENT PO REQUIRED = NO。
- 部署顺序：迁移必须在应用重启前完成；这是非破坏性 schema 演进（同型处理参考 `v13-phase4-production-integrity.js:23` 已有的 `DROP INDEX IF EXISTS idx_production_instruction_items_production_order`，该迁移走的是同一路径）。

#### 20.14.7 修正后的前端映射

R4-R3 中 “`purchaseInstructionItemId: index === 0 ? source.id : null`” workaround 必须删除。每个 source item 必须无条件携带其 `purchaseInstructionItemId`：

```jsx
const mappedItems = sourceItems.map((source) => ({
  productId: source.product_id,
  quantity: Number(source.quantity) || 0,
  purchaseInstructionItemId: source.id,
  preferredSupplierId: '',
  unitPriceCents: Number(productById.get(source.product_id)?.priceCents) || 0,
  amountCents: Math.round(quantity * unitPriceCents),
}));
```

UAT-FUNC-004 PO 编辑修复保持独立有效，不受本节影响。

#### 20.14.8 修正后的回归测试计划

新增到 `server/uat-r4-purchase-source-chain.test.js`：

- A. 多 PUI → 单 PR：构造一个 PUI 含 3 条 item 的 fixture（产品 / 数量 / need_by_date 各异），通过 `POST /api/purchase-requisitions` 创建单 PR 含 3 个 PR item，每条携带不同 `purchaseInstructionItemId`。
- B. 验证 3 条 PR item 都返回 `purchaseInstructionItemId === <source pii.id>`，对应 3 条 PUI 行的 `purchase_requisition_id` 都更新为该 PR header id。
- C. 重复消费：再次尝试以同一 PUI 行创建另一个 PR → 409（应用级）+ DB 级 UNIQUE 双层保护。
- D. 不同 PUI 行各自独立：每条 PUI 行只被消费一次，再次提交包含其中任意一条 PUI 行的 PR → 拒绝。
- E. 不允许 first-line-only 行为回归：上述 A 的 3 条 PR item 必须全部保留 `purchaseInstructionItemId`，不允许在测试中接受 “首行携带、其他置 null” 的退化形态。
- F. PO 编辑回归（UAT-FUNC-004）独立保持：保留现有 E/F/G/H/I/J/K/L 测试。
- G. 库存副作用 = 0：保留现有 M1。
- H. 手工 PO 不受影响：保留现有 L。

测试中必须显式断言每个 PR item 的 `purchase_instruction_item_id` 与对应 PUI item id 完全相等，不允许任何 “first-line-only” 退化解。

#### 20.14.9 R4-R3 WIP 处置

R4-R3 实施期间的 WIP（含 “首行保留 source 标识” workaround）已 stash 在 `wip/r4-r3-before-source-cardinality-fix`（commit master 工作树，commit-style stash entry）。R4-R2B 不恢复 stash；后续 R4-R3 实施阶段在 schema 修复合并后从 stash 弹出 worktree，逐项修正 “首行保留” workaround 与测试中 “first-line-only” 路径，再独立 commit。

## 21. [V1.4-D — IMPLEMENTED] 业务一致性、库存关账与产品交互设计合同

### 21.1 设计状态、边界与整体结构

本节是 V1.4 的 immutable 实现合同（design contract）。状态为 **IMPLEMENTED BY E1–E8**；释放基线为 v1.4.1。本节技术内容等同于已上线能力，任何后续修改都应被视作对设计合同的扩展并随对应设计评审更新。设计复用现有原生 HTTP、RBAC、审计、事务、SQLite/MySQL adapter、库存流水、估值、跟踪分配、来源行和期间表，不引入第二套期间、库存、审批或追溯系统。

V1.4 的共同调用结构为：

    React 业务页 / 移动卡片
      → src/api.js 统一请求与结构化错误
      → server/app.js 路由、认证、精确权限
      → server/modules/ 领域查询或命令
      → 同一 transaction 内的状态、数量、身份、价值、审计
      → SQLite / MySQL 8 等价约束

本节只纳入冻结范围：库存期间关账、产品跟踪模式呈现、C01–C05、有限的交互一致性和相应移动适配。完整销售/采购逐行驾驶舱、复杂成本关账、多组织、多币种、仓位/LPN、工作流设计器、PDA 配置器、APS、完整 MES/QMS 均不进入 V1.4。

### 21.2 库存期间关账

#### 21.2.1 业务模型与期间关系

- **库存关账**：对一个已经结束的自然月运行只读检查，在同一受控事务中复核通过后，保存该月库存快照和检查证据，并把该月及以前日期标记为不可再发生库存影响。它是库存期间控制，不进入 Approval Center，也不产生库存、估值或会计分录。
- **反关账**：由有权限人员对最近一个已关库存期间执行的受控重开。必须填写原因、二次确认并保留操作者、时间和原因；它不删除原快照和原关账审计，也不自动反开会计期间。
- **关账截止日** `closedThroughDate`：连续 CLOSED 链中最后期间的自然月末。所有库存影响命令必须在写入前拒绝 `businessDate <= closedThroughDate`；不能只检查“业务日期所在月份是否恰好有一条 CLOSED 记录”。
- **当前开放库存期间**：`closedThroughDate` 后的第一个自然月。若从未关账，系统没有伪造的截止日；第一次成功关账建立控制基线，此后只能按自然月严格连续关账。
- **下一可关账期间**：已有基线时为最后 CLOSED 期间的下一个月；最近期间处于 REOPENED 时只能先重关同一期间。第一次关账可选择任一已经结束的自然月作为明确基线，不能选择当前月或未来月。`nextCloseablePeriod` 约束期间推进，不排斥对现有 CLOSED 同月执行不推进期间的幂等重关。
- 每个 `period_key` 只保留一条 `inventory_period_closures` 记录；不同月份可依次关账。对已 CLOSED 的同月重复关账是允许的幂等操作：重新运行权威预检，通过后复用原 closure identity，删除并重建/替换同一快照集合，不新增期间记录、不再次推进期间。业务状态未变化时重建结果必须等价；并发或重复请求不得产生重复 closure/snapshot。REOPENED 的同月重关是另一条显式路径，同样复用原期间记录、重新预检并重建其快照。
- 财务期间与库存期间继续使用现有两套**不同领域的控制记录**，不再新建第三套系统：会计月结前仍须确认同月库存已关；库存反关账前，同月会计期间必须已开放。反关账不会跨域自动重开财务期间。
- 只能反开最近一个 CLOSED 库存期间；存在更晚 CLOSED 期间时禁止反开较早期间。反开后 `closedThroughDate` 回退到上一个仍 CLOSED 的月末，后续库存写入仍受该截止日保护。

#### 21.2.2 预关账检查模型

领域模块新增一个共享的只读 `runInventoryCloseChecks(db, period, actor)`；预检接口和最终关账命令调用同一函数，避免 UI 与提交时口径分叉。返回结构：

```text
period, periodStart, periodEnd, closedThroughDate, nextCloseablePeriod
overallStatus: PASS | WARNING | BLOCKED
checks[]: {
  code, label,
  severity: BLOCKING | WARNING,
  status: PASS | FAIL,
  count,
  description,
  resolutionHint,
  drillDown?: { target, filters }
}
checkedAt
```

检查项只来自现有可证明能力：

| code | 严重度 | 事实来源与含义 | 可处理路径 |
|---|---|---|---|
| `PERIOD_SEQUENCE` | BLOCKING | 目标月必须已结束；推进期间时须等于 `nextCloseablePeriod`，REOPENED 时须重关该期间；已存在 CLOSED 同月是允许的幂等重关例外且不推进链 | 选择 `nextCloseablePeriod`、重关已反开的期间，或对目标 CLOSED 同月执行幂等重关 |
| `NEGATIVE_INVENTORY` | BLOCKING | `inventory` 中数量小于零，或现有估值检查发现负值/残值异常 | 下钻库存异常并用受控业务单纠正 |
| `PENDING_INVENTORY_DOCUMENTS` | BLOCKING | 目标月末前仍为草稿/待处理的库存影响单据；缺业务日期且无法证明属于以后期间的 legacy 开放单也阻断 | 完成、取消或基于证据修复业务日期 |
| `UNFINISHED_STOCKTAKE` | BLOCKING | 目标月末前的盘点处于 DRAFT/SUBMITTED 等未完成状态 | 完成审批或取消盘点 |
| `INVENTORY_CONSISTENCY` | BLOCKING | 现有 System Health 中数量缓存、库存流水、跟踪身份、估值余额之间的阻断性差异 | 下钻健康检查；不自动修复 |
| `FINANCIAL_SYSTEM_HEALTH` | BLOCKING | 与存货相关的系统凭证、库存价值与总账、WIP/GRNI 等既有 BLOCKING 检查失败 | 按检查 code 进入有权限的业务异常页，或联系 ADMIN/ACCOUNTING；不恢复最终用户 System Health 入口 |
| `LEGACY_BUSINESS_DATE_UNKNOWN` | BLOCKING | 构建目标期快照/流量所需的 legacy 库存事件没有可证明业务日期 | 只允许基于权威来源的受控数据修复；不得回退 `created_at` |
| `INACTIVE_OR_LEGACY_REFERENCE` | WARNING | 已停用主数据或非阻断历史说明，不影响数量/价值真相 | 可继续，但确认框展示警告摘要 |

`PASS` 是单项状态，不另作 severity。任何 BLOCKING/FAIL 使 `overallStatus=BLOCKED`，服务端和客户端都不能绕过；只有 WARNING/FAIL 时为 `WARNING`，用户可在明确勾选“已阅读警告”后继续。预检不写业务、审计、快照或修复数据。检查的 `drillDown` 只包含业务目标和安全筛选，不返回任意 SQL、内部表名或未授权标识。

最终关账必须在持有数据库写事务/相应 MySQL 串行化锁后重新运行相同检查，不能信任先前浏览器结果。若预检后事实变化，返回最新检查集和 `PRECHECK_BLOCKED`，零副作用。首次关账、已 CLOSED 同月幂等重关及 REOPENED 同月重关均进入同一事务命令：复用已存在的同月 closure identity（首次关账才新建），删除该 closure 旧快照、按权威业务日期重建、写 `close_checks_json`、更新 CLOSED/closed_by/closed_at 并审计；整个过程一次提交或全部回滚。已 CLOSED 不是同月请求的自动冲突条件；只有不同期间不连续、期间未结束或其他业务状态无效时返回相应错误。

#### 21.2.3 页面与移动流程

库存关账页采用统一 BusinessPageHeader，顶部只保留一个主动作“执行关账检查”，并展示：当前开放期间、关账截止日、下一可关账期间。检查结果使用 `PeriodCloseCheckList` 分组显示通过、警告、阻断数量；每项给出说明、解决建议和有权限时的下钻动作。

流程为：选择允许的期间 → 执行检查 → 阅读结果 → 无阻断时出现“确认关账” → 二次确认展示期间、截止日、警告及“此日期以前库存业务将被阻止” → 提交关账。最近 CLOSED 期间详情提供“重新执行同月关账”入口，明确说明将复检并替换同一快照、不会推进期间或新建记录；它调用相同 close 命令。检查结果发生变化时留在本页并刷新结果，不显示原始 409/System Health 字符串。移动端采用纵向检查卡和底部固定主动作，不使用横向表格。

反关账是独立的 destructive action，只在最近 CLOSED 期间详情中出现；打开独立确认面板，要求输入非空原因，并显示“不会自动反开会计期间”和重开后的截止日。历史详情展示关账人/时间、完整检查快照、反关账人/时间/原因及重关记录状态，技术 UUID 不作为主标题。

#### 21.2.4 API、权限与稳定错误

沿用现有 `/api/inventory-period-closures` 资源：

| 接口 | 权限 | 合同 |
|---|---|---|
| `GET /api/inventory-period-closures/status` | `INVENTORY_PERIOD_CLOSE_VIEW` | 返回当前开放期间、`closedThroughDate`、`nextCloseablePeriod`、最近 closure；无写入 |
| `POST /api/inventory-period-closures/check` | `INVENTORY_PERIOD_CLOSE_VIEW` | body `{ period }`；返回结构化检查，不审计为业务操作 |
| `POST /api/inventory-period-closures` | `INVENTORY_PERIOD_CLOSE_MANAGE` | body `{ period, notes?, confirmWarnings? }`；事务内复检，通过后复用现有 close/快照表 |
| `POST /api/inventory-period-closures/:id/reopen` | `INVENTORY_PERIOD_CLOSE_MANAGE` | body `{ reason }`；只允许最近 CLOSED 且会计期间已开放 |
| `GET /api/inventory-period-closures/:id` | `INVENTORY_PERIOD_CLOSE_VIEW` | 返回 closure、解析后的检查快照、快照汇总和 reopen 审计 |

稳定业务错误至少包括：`PERIOD_NOT_ENDED`、`PERIOD_SEQUENCE_INVALID`、`PRECHECK_BLOCKED`、`PRECHECK_WARNING_CONFIRMATION_REQUIRED`、`FINANCIAL_PERIOD_CLOSED`、`INVENTORY_CONSISTENCY_ERROR`、`PERIOD_NOT_LATEST`、`REOPEN_REASON_REQUIRED`。同月已 CLOSED 的重复 close 不得仅因该状态返回 `PERIOD_ALREADY_CLOSED`；校验错误用 400，权限用 403，不存在用 404，状态/业务冲突用 409，未知内部错误用安全 500。

现有 `inventory_period_closures`、`inventory_period_snapshots`、`close_checks_json`、`reopen_reason`、closed/reopened actor/time 字段足够，库存关账本身 **NO SCHEMA CHANGE**。旧 closure 无 `close_checks_json` 时显示“历史关账未保存结构化检查”，不伪造 PASS。现有对账健康函数由关账适配层筛选存货相关 BLOCKING 项，不复制一套计算。

### 21.3 产品跟踪模式、交易分配与追溯

#### 21.3.1 单一产品模型

`products.tracking_policy` 是唯一 canonical 模式，枚举保持 `NONE | LOT | SERIAL`；不增加 `is_lot_enabled`、`is_serial_enabled` 等平行布尔字段。legacy 产品继续由既有默认 `NONE` 读取。跟踪策略变更继续通过现有受控 API 和历史表，只有零库存、无开放执行、无已发生跟踪移动时允许；历史跟踪事件永远按其已记录身份展示，不随当前产品设置隐藏或改写。

产品编辑器以单选“无跟踪 / 批次 / 序列号”呈现，并解释后果。V1.4 不重写跟踪引擎，不迁移已有 lot/serial 身份，不为 NONE 产品制造占位身份。

#### 21.3.2 统一交易组件与验证

新增复用 `TrackingAllocationEditor`，输入为产品、仓库、方向、数量、业务日期、来源上下文与当前 allocations；内部使用已有跟踪可用量 API，输出现有 `trackingAllocations` 合同。它只在所选产品模式需要时渲染：

- `NONE`：表单不展示批次/序列号控件，请求省略 allocations；服务端对非空 allocations 返回 `TRACKING_NOT_REQUIRED`，避免静默丢弃用户输入。
- `LOT`：入库事件允许录入/选择批次及可选生产/到期信息，分配数量之和必须等于业务数量；出库事件只能选择该仓可用、非 HOLD、未过期批次，数量不能超过可用量。
- `SERIAL`：业务数量必须是整数，分配序列号个数必须精确等于数量；产品内序列号保持全局唯一，入库不得重复创建，出库必须位于指定仓且可用。

各业务流程统一规则：采购入库/生产入库创建或接收身份；调拨在同一事务中移动原身份；生产领料和销售出货消耗指定身份；销售退货、采购退货和冲销必须引用可证明的原始身份，不允许换号替代；调整、报废和盘点按实际增减方向创建/选择身份，并保持数量、身份和估值原子一致。只在当前后端已支持的这些动作中接入组件，不扩展新业务对象。

服务端仍是权威：保存草稿可记录分配意图，确认时必须重新检查模式、精确数量、唯一性、仓库位置、HOLD/有效期和期间开放状态；任一行失败则整单数量、身份、价值、状态和审计全部回滚。稳定错误使用 `TRACKING_ALLOCATION_REQUIRED`、`TRACKING_QUANTITY_MISMATCH`、`SERIAL_DUPLICATE`、`TRACKED_IDENTITY_UNAVAILABLE`、`TRACKED_IDENTITY_HOLD`、`TRACKED_IDENTITY_EXPIRED`。

#### 21.3.3 追溯页面与 legacy 诚实性

追溯查询继续只使用 `tracked_inventory_movements`、来源分配和 genealogy 表中可证明关系，不用产品/日期相似性猜测父子关系。每个事件卡在可得时显示：业务单号和可授权链接、业务日期、仓库、方向/数量、源/目标批次或序列号、上游/下游来源及反向关系；`created_at` 仅放在审计详情。

没有可靠来源、业务日期或 genealogy 的记录显示统一 InlineAlert：`历史数据 / 来源信息不完整`，并逐项指出缺失字段。它可以显示已证明的孤立库存事件，但不能生成虚构链路；查询无匹配身份与“身份存在但历史不完整”使用不同空状态。

移动端 LOT 采用搜索/扫码后选择与数量输入，SERIAL 支持逐一扫码、粘贴批量校验和已录/应录计数；NONE 项目完全不占据跟踪区域。卡片首屏保留产品、数量、仓库、业务日期和验证状态，长身份列表进入详情面板。

### 21.4 C01 — canonical 业务日期

#### 21.4.1 日期映射

业务日期解析集中到服务端 `business-date.js`（名称为设计意图），报告、导出、库存关账和期间门禁共享，不在各 SQL 中任意 `COALESCE(..., created_at)`：

| 业务对象 / 事件 | 权威业务日期 | 允许 fallback | legacy 处理 | 报表用途 |
|---|---|---|---|---|
| 销售订单 | `sales_orders.order_date` | 否 | 空值标“业务日期缺失”并从期间活动排除 | 销售订单金额/数量期间 |
| 销售出货 | `sales_deliveries.delivery_date` | 否 | 同上 | 销售出货期间、库存 OUT |
| 销售退货 | `return_orders.return_date`（销售类型） | 否 | 同上 | 销售退货期间、库存 IN |
| 采购订单 | `purchase_orders.order_date` | 否 | 同上 | 采购订单金额/数量期间 |
| 采购入库 | `purchase_receipts.receipt_date` | 否 | 同上 | 采购入库期间、库存 IN |
| 采购退货 | `return_orders.return_date`（采购类型） | 否 | 同上 | 采购退货期间、库存 OUT |
| 库存流水 | 已证明来源单据日期；V1.4 新写入的 `inventory_transactions.business_date` | 否 | 无来源证明的旧值为 `LEGACY_UNKNOWN`，不得因恰好等于创建日而当成权威日期 | 库存异动、关账流量/快照 |
| 库存调拨 | `inventory_transfers.business_date` | 否 | 新字段为空时显示缺失；不从 created/updated 推测 | OUT/IN 两端同一业务日 |
| 生产领料 | `production_material_issues.issue_date` | 否 | 空值标缺失 | 库存 OUT、生产执行 |
| 生产退料 | `production_material_returns.return_date` | 否 | 空值标缺失 | 库存 IN、生产执行 |
| 生产完工 | `production_orders.actual_finish` | 否 | 这是既有完工事件事实；不从 created/submitted/approved 时间推测 | 工单完工活动；完工入库另用 receipt date |
| 生产完工入库 | `production_receipts.receipt_date`；冲销用 `reversal_date` | 否 | 空值标缺失 | 库存 IN/OUT、WIP 活动 |
| 库存盘点生效 | `inventory_checks.business_date` | 否 | 空值标缺失 | 盘盈盘亏流水、期间检查 |
| 库存调整 | `inventory_adjustments.adjustment_date` | 否 | 空值标缺失 | 库存异动 |
| 库存报废 | `inventory_scraps.scrap_date` | 否 | 空值标缺失 | 库存 OUT |

销售/采购统计是“期间活动”而非订单 cohort：同一 `from/to` 对订单、物流和退货子指标分别应用各自日期，响应 `dateBasis` 明示每个指标的字段。未交按 `requested_delivery_date`、未收按 `expected_delivery_date` 判断到期与逾期；订单日期可作为单独辅助筛选，不能冒充承诺日期。自然日范围首尾均包含，统一按保存的 `YYYY-MM-DD` 比较，不把服务器本地时间截断后混入口径。

桌面、移动、API 和导出调用同一查询服务与过滤 DTO。每份响应/导出头包含 `dateBasis`、查询范围、生成时间和 legacy 排除数量；缺权威日期记录可通过“日期缺失”区单独查看，但不混入有日期的期间 KPI。

#### 21.4.2 写入与 legacy 来源可信度

V1.4 不在 `inventory_transactions` 持久化 `business_date_origin`。服务端建立固定、受测试的 canonical source-date registry，以 `source_type/source_id → canonical source object → authoritative business date` 解析库存流水日期，并在 DTO/报表查询结果中产生 `EXPLICIT | SOURCE_DERIVED | LEGACY_UNKNOWN` 准确度分类。只有来源类型、来源 id、唯一来源记录和来源业务日期均可证明时才返回 `SOURCE_DERIVED`；新命令明确提供且与 canonical 来源一致时可返回 `EXPLICIT`。无法证明时一律为 `LEGACY_UNKNOWN`，即使旧 `inventory_transactions.business_date` 恰好等于创建日也不得视为可信。

`inventory_transfers.business_date`、`inventory_checks.business_date` 以 nullable 列加入以兼容旧行；V1.4 新建/确认路径在应用层强制非空，旧行不从时间戳回填。生产工单完工复用既有 `production_orders.actual_finish`，成品库存入库复用 `production_receipts.receipt_date`，不增加重复的 `completion_date`。若未来需要可独立编辑、与实际完工时间不同的业务完工日，必须先形成新的需求决策。

所有库存影响命令使用规范化后的权威业务日期调用 `assertFinancialPeriodsOpen`；该门禁改为检查日期是否小于等于库存/会计各自的已关截止日，而不是只查同月一条记录。已确认事件的业务日期不可普通编辑，纠错继续走现有反向/冲销流程。

### 21.5 C02 — BusinessEntitySelector

`BusinessEntitySelector` 是客户、供应商、产品和仓库共用的受控单选组件。用户输入只用于搜索，只有选择候选项后才形成筛选值；显示值统一为 `编码 · 名称`，已停用历史项追加 `（已停用）`，网络请求只传 canonical `id`。V1.4 不支持多选，也不把未匹配的自由文本静默当成全量或内部 ID。

交互状态包括：空选择、输入搜索、加载、结果、无匹配、已选、清除、权限拒绝和网络失败。桌面使用可搜索 popover/listbox；移动使用底部全屏选择面板，保持搜索框、当前选择和清除动作可达。键盘、焦点、屏幕阅读标签与触控目标沿用现有 design-system 的可访问性合同。

后端新增最小只读查找资源：

```text
GET /api/lookups/business-entities
  ?type=CUSTOMER|SUPPLIER|PRODUCT|WAREHOUSE
  &usage=REPORT_SALES|REPORT_PURCHASE|REPORT_INVENTORY
  &q=<code-or-name>
  &selectedId=<optional historical hydration>
  &limit=<bounded>

{ items: [{ id, code, name, active, label }], hasMore }
```

`type` 与 `usage` 必须经固定 registry 映射到表、可搜索列、active 规则和所需权限，禁止把客户端值拼接为表名/列名。V1.4 只注册上述报告 usage：要求 `REPORT_VIEW` 与对应领域可见权限的交集，并返回 active 与 inactive 供历史报告筛选。`selectedId` 只用于在有权报告上下文中回显历史引用，不能绕过领域授权或枚举对象。查询对 code 前缀和 name 包含做有界、转义后的参数化匹配；同名对象以 code 区分。通用 `TRANSACTION_*` lookup 和全站交易选择器框架明确延后，不进入 V1.4。

报告 URL/API 仍可接收既有 `customerId/supplierId/productId/warehouseId` 参数以兼容合法书签，但 UI 不再要求用户知道这些值。旧的伪“编码”自由文本不建立第二套后端解析路径；无效 id 返回 `BUSINESS_ENTITY_NOT_FOUND` 或明确空结果。此项无业务数据迁移。

### 21.6 C03 — 销售未交与采购未收逐行履约

#### 21.6.1 查询模型与公式

`decision-reports` 抽取共享的行级履约查询，销售与采购分别以 APPROVED `sales_order_items` / `purchase_order_items` 为基表，使用已存在的 `sales_delivery_items.sales_order_item_id` 和 `purchase_receipt_items.purchase_order_item_id` 聚合：

```text
orderedQuantity  = order line quantity
executedQuantity = SUM(confirmed, source-linked execution line quantity)
remainingQuantity = orderedQuantity - executedQuantity
fulfillmentStatus = NOT_STARTED | PARTIAL | FULFILLED
overdueDays = remainingQuantity > 0 && commitmentDate < businessToday
              ? calendar-day difference : 0
```

`executedQuantity` 只纳入状态为 CONFIRMED、来源行身份明确、尚未被该业务对象支持的 canonical 执行冲销撤销的出货/入库行。当前系统没有销售出货/采购入库专用冲销对象，V1.4 不用普通退货或库存冲销猜测一个不存在的“订单义务重开”；普通销售退货、采购退货及其反向操作均不扣减 executedQuantity。未来若新增显式、来源行级的物流执行冲销，必须先更新 document/solution，再由该权威关系扣减。

若聚合结果大于订货量，返回 `accuracyStatus=INCONSISTENT` 和一致性错误，不把负剩余强行截成零。已履行行默认隐藏，`includeFulfilled=true` 时显示。默认排序：逾期且剩余大于零优先，其次 commitmentDate 升序，再按订单号、行号稳定排序。销售 commitmentDate 为 `requested_delivery_date`，采购为 `expected_delivery_date`；缺失日期显示“承诺日期缺失”，不产生虚假逾期天数。

主响应行至少包含：订单/单据业务号、订单行 identity、伙伴 code/name、产品 code/name、ordered/executed/remaining、commitmentDate、overdueDays、fulfillmentStatus、accuracyStatus、contributionCount。主响应不默认内联全部下游贡献。金额不是履约数量的替代，不把履约状态解释为开票、AR/AP 或结算状态。

#### 21.6.2 legacy 与下钻

V1.3 后新增的正常物流行必须有来源行；legacy 下游行若 `*_order_item_id` 为空，禁止按订单号、产品、伙伴、日期或数量猜测归属。它们进入独立 `legacyUnattributed` 汇总，并使相关报表响应携带 `accuracyNotice`；逐行准确结果只累计有来源记录。页面显示“历史数据 / 来源行缺失，以下未归属执行未计入逐行数量”，并允许有权限用户查看未归属业务单号，不将其随机分摊给订单行。

用户显式展开行时，唯一 canonical lazy drill-down 为 `GET /api/reports/:reportKey/lines/:orderItemId/contributions`；`reportKey` 只允许冻结的销售未交/采购未收 registry 值。响应返回构成 `executedQuantity` 的权威 confirmed、未被 canonical execution reversal 撤销的下游单据/行：业务号、行号、数量、业务日期、状态及有权限时的 SPA 链接；贡献数量合计必须等于主行 `executedQuantity`。DRAFT、CANCELLED、已有效冲销或无来源行的记录不得进入贡献。服务端在返回每个链接/字段前复核目标领域权限；无权时只返回受控数量摘要。不提供竞争性的第二贡献 API，也不扩展为发票、AR/AP、结算全程驾驶舱。

API 逐步把旧订单头字段保留在兼容窗口内并标记 deprecated，新 `lines[]` 是 canonical。旧 `deliveryState/receiptState` 不再驱动新 UI；发布说明明确记录粒度变化。此项是 QUERY/API/UI CHANGE，现有来源列和索引足够，不新增派生状态列或缓存表。

### 21.7 C04 — 两层业务总览与订单阶段

#### 21.7.1 Level 1 主流程

Level 1 是所有有总览入口用户可理解、移动友好的静态主链，不显示受保护业务数量：

```text
销售：销售订单 → 出货 → 应收 → 收款/结清
采购：MRP/采购指令 → 请购 → 采购订单 → 入库 → 应付 → 付款/结清
制造：MRP → 生产指令/制令 → 领料 → 完工入库
```

连接线必须显示边界提示：出货后仍需销售发票/商业确认才形成 AR；入库先形成库存/GRNI，供应商账单过账后才形成 AP；订单审批只授权后续执行，不等于已履约。质量、发票/账单等真实中间阶段可用简短注记，不为图形对称新增业务对象。

#### 21.7.2 Level 2 canonical 阶段

Level 2 从某个主链或订单详情展开，复用/扩展现有 `/api/workflow/sales-orders/:id` 和 purchase counterpart。销售阶段按存在的对象呈现订单审批、出货来源、OQC、销售发票、AR、收款/核销；采购呈现采购指令/请购、PO 审批、采购入库、IQC、GRNI 说明、供应商账单、AP、付款/核销；制造呈现 MRP/指令/制令、领料、报工/质量摘要、完工入库。没有 canonical 对象的阶段只显示流程说明，不制造记录或链接。

每个节点返回统一 envelope：

```text
{
  key, label, description,
  access: PROCESS_ONLY | SUMMARY_ALLOWED | DETAIL_ALLOWED | ACTION_ALLOWED,
  state?, statusGroup?, summary?, records?, links?, actions?
}
```

- `PROCESS_ONLY`：只返回 label/description，服务端不查询受保护域。
- `SUMMARY_ALLOWED`：可返回经授权的状态/数量摘要，不返回业务标识。
- `DETAIL_ALLOWED`：可返回授权字段与可打开链接。
- `ACTION_ALLOWED`：在详情权限上，再按精确 capability 和单据状态返回动作。

服务端先计算节点授权，再决定是否查询对应表；不能先加载全部数据再靠 React 隐藏。SPA 直接访问目标详情仍由目标 API 二次授权。现有 workflow voucher 的脱敏思路保留，但改成上述一致 envelope。订单页删除“来源可选”提示，改为“出货/入库必须引用已批准订单行”；C04 只校正阶段、状态说明和链接，不构建 C06/C07 完整逐行驾驶舱。

### 21.8 C05 — 库存调拨执行与兼容

#### 21.8.1 状态、权限与 API 语义

canonical 生命周期保持 `DRAFT → TRANSFERRED`，草稿可 `CANCELLED`；这是 WAREHOUSE 的双仓物理执行，不是第六审批族，不进入 Approval Center。创建人与确认人允许相同，但两次动作分别授权、分别审计。

选定权限策略：

- 保留 `INVENTORY_TRANSFER_CREATE`，用于新建/编辑/取消 DRAFT。
- 新增 canonical `INVENTORY_TRANSFER_CONFIRM`，用于确认调拨及非盘点调拨冲销。
- `INVENTORY_TRANSFER_APPROVE` 在 V1.4 作为 deprecated alias 保留；后端统一的 `allowInventoryTransferConfirm` 接受 CONFIRM 或旧 APPROVE，避免旧角色/集成突然失权。新权限管理 UI 不再提供旧 code，日志记录 alias 使用；最早在下一主版本、完成使用审计和公告后移除。
- canonical WAREHOUSE 与 ADMIN seed 增加 CONFIRM；不把确认能力授予 REVIEWER、SALES 或 ACCOUNTING。兼容迁移不删除任何既有自定义角色的旧授权。

外部 canonical 动作路径保持 `POST /api/inventory-transfers/:id/transfer` 以避免破坏调用方，业务语义和文案统一为“确认调拨 / CONFIRM”；V1.4 不增加第二条 `/confirm` 路径。新 handler、DTO、UI、测试和权限检查使用 `INVENTORY_TRANSFER_CONFIRM`，只有显式兼容检查可以出现旧 `INVENTORY_TRANSFER_APPROVE`。重复确认返回 409 `DUPLICATE_CONFIRMATION`，不再次写库存。取消路径改由 CREATE 能力保护，只允许 DRAFT。

#### 21.8.2 数据、事务与审计映射

调拨草稿保存 `business_date`，在 DRAFT 可由有 CREATE 能力者修改，确认后不可改。确认事务依次锁定/重读草稿、检查权威业务日期和关账截止日、验证源仓数量与 LOT/SERIAL、移动双仓数量、跟踪身份和仓库维度价值、写两端相同业务日期的库存流水、更新 TRANSFERRED、记录确认人与时间、写审计；任何失败全部回滚。公司总数量和总存货价值守恒，不产生 AR/AP、收入、费用或公司级存货净分录。

为最小兼容，不新增重复的确认人/确认时间列：

- `creator_id/created_at` 对外映射 `createdBy/createdAt`。
- 仅当技术状态为 TRANSFERRED 时，现有 `reviewer_id` 映射为 `confirmedBy`，该次原子状态更新后的 `updated_at` 映射为 `confirmedAt`；UI 只称“确认人/执行人”。
- CANCELLED 行的相同 legacy 字段只映射为 `cancelledBy/cancelledAt`，绝不显示“审核人”。
- 新增 nullable `business_date` 是必要 schema 变化；legacy 空值显示“业务日期缺失”，不从 `created_at/updated_at` 推测。

历史 `SUBMITTED/APPROVED` 保留技术原值、只读且无确认/取消动作。UI 分别显示“历史待处理（未证明已调拨）”和“历史已批准（不等于已调拨）”，详情同时展示 `legacyTechnicalStatus`。若完整的双端库存流水能证明移动，只能增加独立提示“发现库存移动证据”，仍不改写或重标为 TRANSFERRED；不完整/无证据则明确未知，交后续受控数据治理，不做启动迁移。

### 21.9 小型、可执行的产品交互系统

#### 21.9.1 页面骨架与动作层级

在现有 `design-system.jsx`、`MobilePage`、卡片和状态组件上收敛，不重写全部页面。业务页的标准结构为：

1. `BusinessPageHeader`：业务标题、简短上下文/口径、一个主动作；返回与帮助是导航动作。
2. 搜索/筛选区：常用条件直接显示，次要条件进入现有 `FilterSheet`；已应用条件可清除。
3. `ResponsiveBusinessList`：桌面表/列表与移动卡片共享数据、状态和动作模型。
4. 详情/来源：使用抽屉或详情页，`SourceDocumentLink` 始终显示业务号，不显示 UUID。
5. `BusinessState`：加载、空、权限、业务阻断和网络错误占据一致位置。
6. 移动端主动作放入 `MobilePage` bottom action bar，不能因长列表滚出可达范围。

动作层级：`PRIMARY` 每页通常只有一个当前主动作；`SECONDARY` 是保存、筛选、导出等辅助动作；`DESTRUCTIVE` 使用危险色、原因与二次确认；`NAVIGATION` 使用链接/轻按钮且不伪装提交。多个业务动作同时存在时，按当前状态选择一个 primary，其余进入 secondary/menu，不展示多个同权重实心按钮。

#### 21.9.2 Canonical 动作词和状态组

| 词语 | 只用于 |
|---|---|
| 新增 / 保存草稿 | 创建或保存仍可编辑、无业务效果的 DRAFT |
| 提交 / 撤回 | 进入或退出授权审批队列；撤回只在规则允许且未审核时 |
| 审核 / 驳回 | REVIEWER/会计复核的授权决定，不用于库存物理动作 |
| 确认入库 / 确认出库 / 确认领料 / 确认完工 / 确认调拨 | 会产生对应业务、库存或价值效果的明确执行动作 |
| 关闭 | 终止后续正常处理但不抹除历史；必须由具体领域定义 |
| 作废 | 对未生效单据的受控终止，不等同删除 |
| 冲销 / 反向调拨 / 退料等 | 对已生效事实建立显式反向记录；按钮必须说出对象，不使用“处理/执行/OK/提交完成” |

前端 `src/lib/status.js`（或同职责模块）集中把 backend enum 映射为中文 label、semantic tone 和所属状态组，页面不直接显示 enum。至少分开：

- 审批：草稿、待审核、已审核、已驳回。
- 履约/执行：未开始、部分、已履行/已入库/已调拨、已冲销。
- 商业/会计：未开票、部分开票、已开票；未过账、已过账、已冲销。
- 结算：未结、部分结清、已结清、已核销。

同一对象可以并列显示多个 `DocumentStatusGroup`，不把它们压成一个万能 badge。历史/准确度标记采用中性或警告语义，不冒充业务状态。页面标题、卡片和链接优先显示单据号、主数据 code/name；UUID 仅在受控诊断/管理员详情中出现。

`role-reviewer` 后端 code 保持不变，用户可见名称统一为“业务审核员”或等价的跨销售/采购/请购/盘点独立审核表述，不再显示成只负责销售的“销售主管”。这只是显示术语修正，不改变角色权限或审批族。

#### 21.9.3 公共组件边界

| 组件/模式 | 责任 | 复用基础 |
|---|---|---|
| `BusinessPageHeader` / `BusinessActionBar` | 页面上下文与唯一主动作、移动固定动作 | PageHeader、MobilePage |
| `BusinessEntitySelector` | C02 单选及所有状态 | SearchField、FilterSheet |
| `DocumentStatusGroup` | 多维状态映射 | StatusChip |
| `ResponsiveBusinessList` / `MobileBusinessCard` | 桌面/移动同模型不同布局 | RecordCard、现有列表 |
| `SourceDocumentLink` | 权限感知的业务号链接 | App navigation target |
| `BusinessErrorState` / `EmptyState` | 结构化错误、空状态与恢复动作 | InlineAlert、EmptyState、ErrorState |
| `FulfillmentProgress` | 订货/执行/剩余与逾期 | KPI/进度基础组件 |
| `PeriodCloseCheckList` | 关账检查分组、下钻和阻断摘要 | SectionHeader、InlineAlert |
| `TrackingAllocationEditor` | 按 NONE/LOT/SERIAL 呈现已有分配合同 | 表单、选择面板、移动卡 |

先在 V1.4 涉及页面使用这些模式；未触及页面只在后续修改时迁移，避免一次性全站重写。

#### 21.9.4 空、错、载入和移动规则

`BusinessState` 必须区分：

- 真空数据：“尚无调拨单”，给有权限用户明确新增动作。
- 筛选无结果：“当前条件无匹配”，提供清除筛选。
- 缺前置条件：“请先维护产品跟踪策略/完成来源单据”，链接到允许的下一步。
- 权限不足：说明所需业务权限，不渲染受保护详情或动作。
- 业务规则阻断：展示结构化 message、原因、resolution 和安全下钻，例如关账 blocker。
- 网络/服务器错误：提供 requestId、重试，不泄漏 SQL/stack。

核心移动卡只放业务号、伙伴（适用时）、产品/来源、计划或剩余数量、关键业务日期、状态和下一动作；长技术字段进入详情。桌面表可以增加辅助列，但两端共用 API、权限、状态映射和错误合同。核心决策/动作信息不得依赖横向滚动，来源单据不可在移动布局中被省略。

### 21.10 后端错误合同

现有 `HttpError` 和安全 500 机制增量扩展为：

```json
{
  "error": "兼容旧客户端的消息字符串",
  "code": "PRECHECK_BLOCKED",
  "message": "存在阻断项，不能关账",
  "details": {},
  "resolution": "处理阻断项后重新执行关账检查",
  "requestId": "..."
}
```

`error` 在 V1.4 保留；新客户端优先读取 `code/message/details/resolution`，`src/api.js` 的 `ApiError` 保留这些字段。未知异常只返回 `INTERNAL_ERROR`、通用 message 和 requestId；唯一约束/SQL/stack 先在服务端结构化日志中记录，再映射为安全业务错误。

触及的 V1.4 endpoint 必须使用稳定 code：期间类见 §21.2.4；来源类 `SOURCE_UNAVAILABLE`、`SOURCE_QUANTITY_EXHAUSTED`、`SOURCE_LINEAGE_MISSING`；状态类 `INVALID_DOCUMENT_STATE`、`DUPLICATE_CONFIRMATION`；权限类 `PERMISSION_DENIED`；主数据 `BUSINESS_ENTITY_NOT_FOUND/INACTIVE`；跟踪类见 §21.3.2。HTTP 语义保持 400 输入、401 未认证、403 未授权、404 不存在、409 状态/业务冲突、500 安全内部错误。无需在 V1.4 一次改造所有旧 endpoint，但新公共序列化器必须向后兼容，后续触及即迁移。

### 21.11 数据、schema 与兼容影响矩阵

| 能力 | schema | query/API/UI | 兼容策略 |
|---|---|---|---|
| 库存关账状态/预检/重开 | **NO SCHEMA CHANGE** | 新 status/check；close/reopen 扩展；快照改用权威日期 | 复用 closure/snapshot/check JSON；旧检查缺失明确显示 |
| 跟踪模式 | **NO SCHEMA CHANGE** | 交易 UI/校验和追溯展示变更 | 复用 `tracking_policy`、allocation/movement/genealogy；NONE 默认 |
| C01 订单/物流/退货日期 | **QUERY CHANGE ONLY** | 统计按各自现有日期字段 | 不回退 created_at |
| C01 调拨日期 | **MIGRATION REQUIRED** | 新写入、门禁、报表 | `inventory_transfers.business_date NULL`；旧行未知 |
| C01 盘点日期 | **MIGRATION REQUIRED** | 新写入、批准门禁、报表 | `inventory_checks.business_date NULL`；旧行未知 |
| C01 生产完工日期 | **NO SCHEMA CHANGE** | 完工命令与报告复用 `actual_finish`；成品入库复用 `receipt_date` | 不增加重复 completion date |
| C01 库存流水日期可信度 | **QUERY/DTO CHANGE ONLY** | canonical source-date registry、关账/报表 | 不持久化 origin；无法证明即 `LEGACY_UNKNOWN` |
| C02 业务对象选择 | **NO SCHEMA CHANGE** | 新 bounded lookup API + 公共组件 | 保留已有 id 参数；报告可见 inactive |
| C03 行级未交/未收 | **QUERY/API CHANGE** | 聚合来源行、下钻 contribution | 复用现有 FK/index；legacy 未归属隔离 |
| C04 两层总览 | **NO SCHEMA CHANGE** | workflow API envelope + UI | 无权节点 PROCESS_ONLY；无新业务对象 |
| C05 调拨确认权限 | **PERMISSION DATA MIGRATION** | handler/UI 术语、alias | 新 CONFIRM；旧 APPROVE 保留 deprecated |
| C05 确认审计 | **COMPATIBILITY MAPPING** | DTO/UI 映射 | TRANSFERRED 时 reviewer/updated 映射 confirmed；不重命名列 |
| 全局 UX / 状态 / 错误 | **NO SCHEMA CHANGE** | 共享组件、映射和响应序列化 | 保留旧 `error` 字段，渐进迁移 |

不新增履约缓存/状态列、第二套 tracking flags、第二套期间表、重复 confirmed actor/time、`production_orders.completion_date`、`inventory_transactions.business_date_origin` 或历史状态重写。行级履约现有来源索引已可用；实施时只在双后端 `EXPLAIN`/基准显示必要时另行评审普通复合索引，V1.4 迁移不预先创建无证据索引。

### 21.12 SQLite / MySQL 迁移与 legacy 策略

V1.4 设计一项范围受限的幂等添加式迁移（实现时可按仓库惯例拆成同一 slice 的模块），SQLite 与 MySQL adapter 都必须执行等价步骤。迁移范围仅包含 `inventory_transfers.business_date`、`inventory_checks.business_date` 和 `INVENTORY_TRANSFER_CONFIRM` 权限/canonical 角色映射；不包含 production completion、库存流水 provenance 或普通索引迁移。

**前检：**统计 transfer/check 空日期、历史 SUBMITTED/APPROVED 调拨及持有旧 APPROVE 权限的角色；检查两个目标列和新权限是否已存在。另以只读 source-date registry 统计 inventory transaction 各 source type 可证明/不可证明数量，但不为此增加字段或修改流水。只报告 id/count，不输出敏感数据，不修改记录。

**迁移：**

1. 以幂等 column-existence guard 为 `inventory_transfers.business_date`、`inventory_checks.business_date` 增加 nullable DATE/TEXT-date 等价列；不回填 legacy 行，不增加未经查询计划证明的索引。
2. 增加 `INVENTORY_TRANSFER_CONFIRM` 权限及说明，授予 canonical WAREHOUSE；ADMIN 继续通过全权限 reconciliation 获得。保留旧 APPROVE code、role mapping 和外部合同，不批量删除/改名；重复运行不得产生重复权限或扩大其他角色权限。
3. 更新新写入路径后，应用层要求新 transfer/check 具备权威日期。nullable 仅用于 legacy 兼容，不代表新数据允许缺失。库存流水可信度始终由 source-date registry 在应用/查询层解析，不执行 origin 字段迁移或历史日期回填。

**后检：**验证两个新列和新权限各一份、没有新增 `production_orders.completion_date` 或 `inventory_transactions.business_date_origin`、未知日期行未被回填、角色未意外扩权、SQLite/MySQL schema 与 source-date registry 查询结果等价；运行 focused tests、全量回归、build 和受保护 disposable MySQL gate。

**回滚：**这是添加式 schema。应用回滚时保留新列和权限数据，旧版本可忽略，避免 DROP COLUMN/删除历史权限造成二次风险；必要时只回滚应用读写路径。任何需要修正历史日期/状态的动作是单独、需批准的数据治理，不包含在启动迁移。迁移失败必须事务回滚并阻止启动，不能部分继续。

MySQL 使用现有 migration helper 和参数化 SQL；日期保存与 SQLite 一致的 canonical 日值。本设计只有两个 nullable 日期列和权限数据，不需要 generated column 或普通索引。未知或生产数据库不用于 reset/gate。

#### 21.12.1 [V1.4.1 — DESIGN CLOSURE] MySQL existing-database 升级路径

公共 tag `v1.4.0` 上线后从真实生产 UAT 中观察到：V1.4-E2 迁移对**已经具备 `mysql_backend_metadata` 完成标记的 live MySQL 数据库**不生效。原因不在迁移本身，而在 `createMySqlDatabase` 的连线：

- `captureSqliteSnapshot(createSqliteSnapshot, seedDemo)` 捕获一个全新的 SQLite 数据库；该 SQLite 经过完整迁移链（`migrate(db)` → `seed(db)` → `reconcileV14E2Permissions`），因此快照已经包含 V1.4 列和权限 / role mapping 行。
- `bootstrapMySql(adapter, snapshot)` 对每个 `snapshot.tables[i]` 走 `CREATE TABLE IF NOT EXISTS` —— 对已存在的 V1.3 MySQL 表而言是 **no-op**，不会新增 `business_date` 列。
- `bootstrapMySql` 只在 `complete=false`（全新 DB）时把 snapshot 行的列定义写进 DDL；已存在 DB 走 `INSERT IGNORE` 循环，因此 `permissions` / `role_permissions` 行（包括 `INVENTORY_TRANSFER_CONFIRM`）恰好被 `INSERT IGNORE` 灌进老库 —— 这是为什么生产中权限 OK、而 `business_date` 列缺失。

修复设计（不影响 §21.12 的范围/合同）：

- 在 `server/database/mysql-adapter.js` 的 `createMySqlDatabase` 中，于 `bootstrapMySql(adapter, snapshot)` 之后追加一步：直接对 **`adapter`** 调用唯一权威实现 `migrateV14E2BusinessDate(adapter)` / `ensureV14E2ConfirmPermission(adapter)` / `ensureV14E2CanonicalRolePermissions(adapter)`。不复制 SQL、不引入第二套迁移路径；既有迁移函数自身的列-存在性 guard 和 `INSERT OR IGNORE` 已经是幂等的，所以 fresh + upgrade + 重复 init 三条路径共用同一份权威代码。
- 不修改 `bootstrapMySql` 自身以避免把它扩展成不受控的 schema-diff 引擎；升级路径只承接确实已在 SQLite 迁移链里出现的、§21.12 列出的两个 additive 列和新的确认权限/角色映射。
- 不为 `production_orders.completion_date` 或 `inventory_transactions.business_date_origin` 添列；不引入新 index；不重建 `inventory_transfers` / `inventory_checks`；不回填 legacy business_date；legacy 行保持 NULL（`业务日期缺失`）。
- 实施切片 `V1.4.1`：在 master 提交并跑过 `server/mysql-v14-1-hotfix-upgrade-path.integration.js`（V1.3-shaped disposable MySQL DB + 二次 init 幂等）+ 既有 SQLite 回归 + 受保护 disposable MySQL gate；行为合同、API、角色、审批族、permission data migration 都不变。
- v1.4.1 Git tag 不在本提交中创建；本提交的 `package.json` 版本保持 1.4.0 不动；不 push / 不 deploy。

### 21.13 实施切片与依赖顺序

每个切片在独立逻辑单元内完成实现、focused tests、文档/当日日志和 UAT checkpoint；前一切片验收后再进入下一项：

| Slice | 范围与依赖 | 预计文件/模块 | 测试与 UAT checkpoint | 迁移 |
|---|---|---|---|---|
| V1.4-E1 公共合同与 UI 基础 | 结构化错误、状态分组、BusinessPageHeader/ActionBar、Responsive list/error state；不改业务结果 | `src/api.js`、`src/components/design-system.jsx`、`src/lib/status.js`、HTTP error serializer | 错误兼容、状态词、单主动作、关键移动组件 | 无 |
| V1.4-E2 业务日期与调拨契约 | §21.4 日期 resolver/写入/门禁；§21.8 permission alias、business date、审计 DTO 和 legacy 只读 | `server/app.js`、financial/inventory helpers、db/migrations、inventory transfer UI | 跨月、截止日、同人创建确认、守恒、legacy/alias、SQLite/MySQL | 有，§21.12 |
| V1.4-E3 库存关账 | 依赖 E2 的可信日期；status/check/close/reopen、PeriodCloseCheckList | inventory-extensions module/page、system health adapter、routes | 预检、连续关账、重关/反关、并发与零副作用 | 无新表/列 |
| V1.4-E4 跟踪呈现 | 复用现有引擎，接 TrackingAllocationEditor 到已支持交易，改造 trace 页面 | traceability page/module、各相关业务表单 | NONE/LOT/SERIAL、身份/数量/价值原子性、legacy trace、移动扫码 | 无 |
| V1.4-E5 报表日期与选择器 | 依赖 E1/E2；C01 期间活动查询、C02 lookup/selector、桌面移动导出同口径 | decision-reports module/page、lookup helper | code/name、inactive、权限、跨月、缺日期、导出一致 | 无 |
| V1.4-E6 行级履约 | 依赖 E5 筛选/日期；C03 lines/contributions 和 legacy 隔离 | decision-reports module/page | 零/部分/全部、多次确认、普通退货、legacy、逾期 | 无 |
| V1.4-E7 两层总览 | 依赖 E1 状态/页面；C04 Level 1/2、workflow envelope、订单来源文案 | business-overview、master-data workflow、workflow handlers | 主链、财务边界、节点授权与直接 API 拒绝 | 无 |
| V1.4-E8 移动一致性验收 | 对 E2–E7 触及流程做卡片/底部动作/无横滚/来源可见收口；不扩新业务 | application metadata、MobilePage、触及页面 | 关键 viewport、角色任务、动作可达、术语回归 | 无 |

E2 内部顺序固定为：1）添加式 schema migration 与 permission compatibility；2）backend canonical date resolver/write gate 与 transfer compatibility behavior；3）focused/兼容/事务测试；4）前端“确认调拨”术语和 UI 迁移；5）UAT checkpoint。后端兼容必须先于新 UI 依赖，前端不得先切到尚未注册的新权限。

E5 内部顺序固定为：1）bounded business-object lookup；2）共享 `BusinessEntitySelector`；3）lookup/filter tests；4）迁移受影响的报告筛选器；5）接入期间活动 business-date 查询；6）验证桌面/移动/API/export 口径一致；7）UAT checkpoint。lookup/selector 必须先于报告筛选迁移，不能用临时自由文本或内部 ID 过渡。

E2 先于 E3 是硬依赖：关账快照和截止门禁不能继续基于不可信日期。E5 先于 E6 让行级报表直接复用正确筛选和日期合同。E8 是受控收口，不借机重写未触及页面。

### 21.14 测试策略与完成 gate

#### 21.14.1 自动化分层

- 领域单元：日期 resolver、履约公式、status/error mapping、check severity、权限 alias。
- API/事务集成：真实 SQLite HTTP 路径，断言状态、响应 code、数据库副作用、审计和重复/并发行为。
- UI 合同/组件：selector 所有状态、检查列表、状态分组、来源链接、移动卡和动作词。
- 数据库兼容：legacy DB 重开、迁移幂等、schema 后检；MySQL 仅在受保护 disposable 环境运行现有 reset/gate。
- 每个 slice 先 focused tests，再 `pnpm test`、`pnpm build`、`git diff --check`；不得通过删减/绕过测试制造通过。

#### 21.14.2 必测矩阵

**库存关账：**预检全 PASS、WARNING 明示确认、每种 BLOCKING、结束月限制、首次基线与严格连续；已 CLOSED 同月重复 close 成功且复用 closure identity、替换同一快照，业务状态不变时结果等价；重复/并发 close 不产生重复 closure/snapshot；REOPENED → CLOSED 重新预检并重建同一期间快照；日期 `<= closedThrough` 的所有库存写入被阻止、只反开最近期间、会计已关阻止反关、原因/actor/time/检查快照审计、VIEW/MANAGE 权限、失败零副作用、SQLite/MySQL 等价。

**LOT/SERIAL：**NONE 表单隐藏且服务端拒绝多余分配；LOT 分配和调拨/领料/出货/退货/调整/报废/盘点保持身份及数量；SERIAL 整数、精确数量、全局唯一和仓库可用；HOLD/过期；重复确认；历史模式变化后仍可追溯；缺 provenance 只显示 legacy 提示；移动扫码计数。

**C01：**9 月业务日期/10 月录入的跨月场景；订单、出货、退货各自期间活动；范围边界；missing legacy date 不回退；库存 transfer 两端同日；盘点/调整/报废/领料/完工；桌面、移动和导出相同；关账截止门禁；旧 guessed ledger 由 registry 返回未知；迁移不猜 transfer/check 日期，schema 后检证明不存在 `business_date_origin` 迁移/列。

**C02：**code 前缀/name 片段、同名不同码、选择后传 id、无匹配、清除、inactive 在历史报告可见、selectedId 历史回显、特殊字符/limit、无权限不可枚举、移动面板；registry 不接受 `TRANSACTION_*` usage，既有新交易选择规则不因本 lookup 扩权或改变。

**C03：**0/部分/全部；多张 confirmed 下游累计且不重复；lazy contribution drill-down 的贡献数量合计严格等于主行 `executedQuantity`；DRAFT/CANCELLED/已有效冲销/无来源行不进入贡献；普通退货与退货冲销均不重开；若未来有显式执行冲销则只按其来源行扣减；legacy 无来源不猜；超执行标一致性错误；缺承诺日期；逾期天数/默认排序；已履行默认隐藏；contributions 权限。

**C04：**Level 1 三条顺序；文案不暗示出货=AR、入库=AP、审批=履约；Level 2 只用已有对象；PROCESS_ONLY 不触发受保护查询；summary/detail/action 四级授权；直接请求受保护详情仍 403；订单详情无“来源可选”。

**C05：**同一 WAREHOUSE 创建/确认；CREATE 与 CONFIRM 分离；旧 APPROVE alias 兼容且无角色扩权，新行为/权限检查使用 CONFIRM；现有 `/api/inventory-transfers/:id/transfer` 保持唯一 canonical action path，路由集中不存在 `/confirm`；SALES/REVIEWER/ACCOUNTING 拒绝；重复/并发确认；关闭期间；库存不足；两仓数量、跟踪身份、仓库价值守恒；原子回滚；反向调拨；confirmed actor/date；legacy SUBMITTED/APPROVED 只读且不误判。

**全局 UX：**禁用模糊动作词、物理执行不叫审核、用户页不显示 UUID、状态组不混并、六类空/错/加载状态、核心移动 viewport 无横滚且主动作/来源可达。源码字符串测试只能作为补充，关键行为使用组件或浏览器验收。

### 21.15 端到端 UAT 场景

复用电子制造场景，但只给确需身份管理的项目启用 tracking：成品控制器使用 SERIAL，关键 PCB 来料使用 LOT，包装辅料保持 NONE。

1. ADMIN 建客户、供应商、仓库、产品、BOM/路线；验证产品模式、NONE 表单无跟踪噪声、业务对象按 code/name 查找。
2. SALES 建带 9 月 30 日订单日期、10 月要求交期的销售订单，REVIEWER 审核；Level 1/2 正确区分授权与履约。
3. 运行 MRP，生成采购指令→请购→PO 及生产指令/制令；保持行来源。
4. WAREHOUSE 在明确 receipt date 接收 PCB LOT，完成 IQC；ACCOUNTING 过账供应商账单形成 AP，并执行部分付款/核销。
5. WAREHOUSE 领用 PCB LOT、报工；工单完工使用既有 `actual_finish`，三个成品 SERIAL 的完工入库使用明确 `receipt_date`，验证 genealogy 只含可证明关联。
6. 同一 WAREHOUSE 用户创建并确认带业务日期的调拨，验证文案为“确认调拨”、两仓数量/身份/价值守恒；重复确认被拒绝。
7. 分两次出货形成销售订单行部分→全部履约，完成 OQC；普通销售退货不重开原订单剩余。销售发票过账后才形成 AR，部分收款/核销与折让按现有合同执行。
8. 在桌面和移动查看 C01 期间活动、C02 选择器、C03 剩余/逾期/下游贡献和 C04 两层总览；业务日期跨月归属与导出一致，移动无核心横滚。
9. 构造并修复一个可处理的关账 blocker，重新预检后关闭已结束自然月；验证日期不晚于截止日的库存动作被拒绝。先确认会计期间为开放，再以原因反关账并核验审计，最后重关且快照不重复。
10. 全程以 SALES、REVIEWER、WAREHOUSE、ACCOUNTING、ADMIN 各自账号验证 PROCESS_ONLY 与受保护详情/动作边界；检查业务页不出现内部 UUID 或原始系统错误。

UAT 断言数量、金额（整数分）、身份、价值、来源、业务日期、权限和审计；不要求所有产品启用 LOT/SERIAL，不把物流确认等同于 AR/AP。

### 21.16 设计完成判定与未决项

本设计已覆盖 V1.4-C 全部冻结项和库存关账/跟踪/全局一致性要求，未发现 document.md 内部矛盾。V1.4 实施切片 E1–E8 已分别在 focused 套件和全量套件中证明本设计合同落地；SQLite 1523 / 1523 PASS；MySQL functional 44 / 44 PASS；MySQL concurrency 13 / 13 PASS；System Health PASS；构建 PASS；浏览器业务 UAT PASS。任何需要猜测业务日期、来源、历史调拨状态或 genealogy 的情况都必须 fail closed，并作为独立数据治理请求回报，不能扩大本设计授权。
