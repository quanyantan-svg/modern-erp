# Modern ERP 当前技术设计与实现

## 1. 范围与设计原则

本文档是 Modern ERP 唯一当前技术设计和实现参考，描述 V1.3 的架构、模块责任、数据关系、事务、安全、测试和运行边界。功能合同见 document.md；docs/ 下的阶段文档和审计属于支持性或历史证据。

设计原则：

- 以实际代码和数据库约束为权威，旧设计与实现冲突时以当前实现为准。
- HTTP 层负责解析、认证、路由和响应；领域模块负责业务不变量；数据库事务负责原子性。
- 单据、库存、身份、价值、子账、总账、审计和幂等结果共享业务事务。
- 前端不作为授权或金额计算权威。
- SQLite 与 MySQL 8 实现相同业务接口，但允许数据库适配层采用不同并发机制。
- 历史经济事件不可由启动迁移或 GET/CHECK 请求静默修复。
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

当前仓库不提供适用于 V1.3 的可直接执行生产全量数据重置工具。全量生产数据重置必须使用单独评审、与目标 schema 和部署环境匹配、具有备份/恢复证据并获得明确批准的环境化流程；`server/reset-data.js` 只允许仓库外的一次性开发/测试 SQLite 数据库，不能替代生产流程。

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
- 当前 master 是 v1.3.0 发布后的维护状态；尚未声明 v1.3.1 或 V1.4 发布，当前 HEAD 不等同于 v1.3.0 标签提交。
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
