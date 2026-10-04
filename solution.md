# Modern ERP 当前技术设计与实现

## 1. 范围与设计原则

本文档是 Modern ERP 唯一当前技术设计和实现参考。§2–§18 描述当前（v1.6.2）已落地的架构、模块责任、数据关系、事务、安全、测试和运行边界；当前 MySQL stale-connection recovery 架构细节已合并入 §6 / §9 / §14。功能合同见 document.md；docs/archive/v1.6/ 下保存 V1.5 / V1.6 / V1.6.1 / V1.6.2 各阶段的设计证据与验收记录，不再作为当前规格。

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
| src/navigation/applicationRegistry.js | 最终用户 Route、权限、导航、Launcher、Presentation 与 Screen 的 canonical registry |
| src/navigation/routeLocation.js | hash RouteLocation 的解析、规范化、校验与序列化纯函数 |
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

### 3.1 V1.7 P0 — 前端应用架构基础

`src/navigation/applicationRegistry.js` 是最终用户 Route 的唯一前端事实源。每条 Route 描述唯一 key、title、domain、archetype、access、enabled、parentRoute、desktop navigation、mobile exposure、零至多个 Launcher Entry、target contract、screen identity/loader、aliases 和 responsive mode。启动期静态校验拒绝重复 key、冲突 alias、无效 parentRoute、指向不存在 Route 的 Launcher Entry，以及缺少 Screen 的启用 Route。`presentationMetadata.js` 和 `applicationMetadata.js` 只保留向后兼容 projection，不维护第二份业务 Route inventory。

Launcher Entry 与 Route 分离，一个 Route 可以没有、具有一个或具有多个 Launcher Entry。`returns` 通过不同 target 暴露销售退货和采购退货；`decision-reports` 通过 reportKey 暴露多个报表入口。P0 保持六个 core Launcher group（master-data、sales、production、purchasing、inventory、analytics）和 V1.6 的业务范围，不注册尚未实现的业务模块。

`src/navigation/routeLocation.js` 提供 `parseRouteLocation(hash)`、`serializeRouteLocation(location)`、`normalizeRouteLocation(location)`、`resolveRouteAlias(routeKey)` 和 `validateRouteTarget(route, target)`。概念对象为 `{ routeKey, params, query, target }`；函数不调用 API、不产生业务 mutation、不写数据库。SPA 继续使用 hash，不引入 Router dependency。列表地址保持 `#orders` 等旧格式，详情使用 `#orders/<documentId>`，context/report target 使用稳定 query。旧 `#mrp` 解析为 `#material-requirements-plan` 并以 replace 规范化；ID/query 使用安全编码，malformed 输入 fail safely。

浏览器 hash 经 RouteLocation parser 进入 Registry，依次检查 Route 存在、enabled、前端 access，再解析 Screen 并通过 RouteSurface 挂载业务页面。`App.jsx` 只承担认证、壳状态、history 协调、错误态和 Screen orchestration；不再维护独立 `navGroups` 或 `pages` inventory。Route Screen 使用 route-level lazy loading，加载或渲染失败由 Route-level Error Boundary 捕获，MobileShell 不整体崩溃。

`AppNavigationContext` 暴露 `currentLocation`、`currentRoute`、`canNavigate`、`navigate`、`hrefFor`、`setHeaderBackAction` 和 `registerHeaderBackAction`；`navigateToPage` 作为兼容 wrapper，把旧 target 转换为 RouteLocation。`AppLink` 通过 `hrefFor()` 生成包含 exact target 的真实 href。普通业务跳转 push history；alias/normalization replace history；Sheet、FilterSheet、ConfirmSheet、ActionSheet 等 ephemeral UI 保持 React local state。Back / Forward 始终重新解析 hash，不依赖陈旧 memory target。

Registry access 只控制 Launcher、desktop navigation、Route mount 和 contextual link。direct URL 的顺序为 parse → registry resolve → enabled → frontend access → component mount → API request → backend authorization。unknown、disabled 和 unauthorized Route 使用安全 canonical 状态；未授权 Route 不挂载受保护 Screen，因此不触发页面 API。后端授权语义不因本重构改变。

`cash-journals`、`bills`、`fixed-assets`、`workflows`、`data-cleanup` 保持 `enabled: false` 且不进入 Launcher；System Health 和 controlled Go-Live UI 不注册为最终用户 Route。`V16RouteSurface` 的 classification、application group、archetype、module 和 responsive mode 从 Registry 派生。旧页面保留 `LEGACY_ADAPTER` MutationObserver 适配；V1.7 新页面默认 `NATIVE_RESPONSIVE`，P0 不批量迁移旧页面。

现有 BusinessPageShell、BusinessPageHeader、BusinessDetailLayout、ResponsiveBusinessList、RecordCard、CompactRecord、BusinessState、BusinessActionBar、DetailSection、KeyValueRow、Sheet、FilterSheet、ActionSheet 与 BottomActionBar 继续作为唯一 design system。MobileShell 固定且仅包含 messages、approvals、apps、workspace、profile 五个全部启用入口，不按 viewport 分叉第二棵组件树。

P0 按 Registry Foundation、Route Location、App Shell Integration、Legacy Compatibility & Acceptance 四个逻辑单元实施。测试覆盖 53/5 Route 数量与完整性、projection、RouteLocation round-trip/编码/非法输入、Launcher/List/Detail/Related/Refresh/Back/Forward、alias、unknown/disabled/unauthorized、Screen Error Boundary 和五入口移动合同。旧 source-contract 测试若绑定 `App.jsx navGroups/pages` 旧结构，应改为验证 Registry projection 的等价产品合同，不删除真实业务回归。正式完成 gate 仍为 focused tests、`pnpm test`、`pnpm build` 和 `git diff --check`。

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

### 9.1 MySQL stale-connection recovery（v1.6.2）

应用通过 `MySqlSyncAdapter` 复用一条长 MySQL 连接，由 `server/database/mysql-worker.js` 持有。MySQL 服务端在 `wait_timeout` / `interactive_timeout` 后或发生瞬时中断时会关闭空闲连接；应用必须能在不重启 Node 进程的前提下从陈旧连接恢复。架构约束如下：

- **连接生命周期** — worker 持有 `connection`、`connectionConfig`、`inTransaction`、`closed` 四个内部状态。每次进入操作前调用 `ensureConnection()`：若已 `closed` 则拒绝；若当前连接存活则复用；否则用 `connectionConfig` 重建并应用会话设置。
- **会话设置** — 每次新建连接（含初次连接与重连）必须按顺序执行 `SET time_zone = '+00:00'`、`SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED`、`SET SESSION innodb_lock_wait_timeout = 2`；只有全部成功后才视为可用。不得让重连"静默丢失"这些会话设置。
- **可恢复错误中央分类** — 集中识别以下 mysql2 / Node 错误为可恢复传输级：`PROTOCOL_CONNECTION_LOST`、`PROTOCOL_PACKETS_OUT_OF_ORDER`、`PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR`、`PROTOCOL_ENQUEUE_AFTER_QUIT`、`PROTOCOL_SEQUENCE_TIMEOUT`、`ECONNRESET`、`ECONNREFUSED`、`ETIMEDOUT`、`EPIPE`、`ENOTFOUND`、`EAI_AGAIN`，以及文本特征 `Connection lost` / `Connection terminated` / `Server has gone away` / `Packets out of order`。业务 / SQL 错误（`ER_DUP_ENTRY`、`ER_NO_REFERENCED_ROW_2`、`ER_BAD_FIELD_ERROR`、`ER_PARSE_ERROR`、`ER_LOCK_DEADLOCK`、`ER_LOCK_WAIT_TIMEOUT` 等）不得触发重连。错误分类有且仅有一个中央实现，禁止散落复制。
- **写安全** — `INSERT` / `UPDATE` / `DELETE` / `REPLACE` / `COMMIT` / 文档序号分配 / 业务过账 / 库存过账 / 会计过账 一旦被分发到 MySQL，即便客户端后续收到连接错误，也可能已经写入。**绝不自动重试已经被分发到 MySQL 的写操作**。`allocateSequence` 是显式写动作，与业务写入同等对待。
- **只读自动重试** — 明确只读的语句（`SELECT` / `WITH` / `SHOW` / `DESCRIBE` / `DESC` / `EXPLAIN`）在收到可恢复连接错误时可以自动重试一次，路径为：丢弃陈旧连接 → 重连 → 重新应用会话设置 → 重试同一条 SELECT 一次 → 成功或失败上抛。`/api/health/ready` 的 `SELECT 1 ready` 由此 self-heal。非读操作不享受此重试。
- **写失败后的清理** — 写遇到可恢复连接错误时不重放该写、丢弃陈旧连接、不在下一个请求前静默重建；下一条独立请求来时按 `ensureConnection()` 规则自动建立新连接。
- **事务丢失** — 重连**不能**在另一条 MySQL 连接上继续同一事务。连接丢失后：不得重放事务语句，不得在新连接上假装 `COMMIT` 成功；必须把错误返回给调用方，并在 worker 内部把 `inTransaction` 复位为 `false`；adapter 的 `isTransaction` 必须与之保持一致。
- **关闭语义** — `MySqlSyncAdapter.close()` 必须继续以优雅方式关闭健康连接，并使之后任何请求以 `MySQL database is closed` 失败；不得在 close 后继续重建连接。已损坏连接不必先尝试 `.end()` 再销毁；mysql2 的 `destroy()` 是更安全的兜底。
- **性能边界** — 禁止对每次 SQL 调用前置 `connection.ping()`。ERP 单次业务请求中可能包含数十次同步 SQL；每次前置 ping 会显著放大 MySQL 网络往返。允许的恢复路径为失败驱动（failure-driven recovery），必要时可加空闲阈值后做的有界主动校验，但默认不引入主动 ping。
- **可观测性** — 使用现有结构化 logger 在恢复实际发生时发出以下事件：`mysql_connection_lost`、`mysql_reconnect_attempt`、`mysql_reconnect_success`、`mysql_reconnect_failed`、`mysql_transaction_lost`。不得记录密码、完整连接配置、SQL 参数值或业务数据；正常成功查询不得产生日志。
- **Readiness 合同** — MySQL 健康时 `/api/health/ready = 200`；MySQL 宕机时 `/api/health/ready = 503`、`/api/health/live = 200`；MySQL 恢复后下一个 readiness 请求自动重建连接并返回 `200`，无需应用重启。本阶段不改 readiness API、不改 `db.prepare('SELECT 1 ready').get()` 作为权威探针。

显式禁止的"伪修复"：调整 MySQL 全局 `wait_timeout` / `interactive_timeout`、cron / systemd 周期重启、外部 watchdog、Nginx 兜底、周期性 HTTP 探活维持连接；同服务器其他项目共用同一 MySQL，不得为单个应用修改全局行为。

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

server/*.test.js 与 src/lib/v14-e1-presentation.test.js 使用 node:test，主要通过 server/test-utils/temp-db.js 或系统临时目录创建隔离 SQLite 数据库。测试必须证明仓库默认 data/erp.db 不被访问或删除。

测试层次：

- 领域 focused tests：状态、金额、来源、权限和回滚。
- 合同测试：五角色、五审批族、schema/migration、canonical 前端 registry（V1.7 P0 之后）。
- 集成/UAT：跨模块业务链、期间关闭和 reconciliation。
- UI/浏览器工具：在隔离数据库和临时输出目录运行。

### 15.2 测试分层（V1.7 P0 + 整合后）

V1.7 Test Suite Consolidation 整理后的分层，由 `scripts/testing/test-suites.js`
集中声明，`scripts/testing/run-tests.js` 跨平台调用。Manifest 在每次运行前由
`validate()` 做 invariant 校验：FAST ⊆ FULL、FULL ∩ HEAVY = ∅、所有列出的文件存在、
磁盘上每一个 `*.test.js` 都被分类到某一个 suite；任何一项不满足即 fail-closed（exit 2）。

集合语义：

    FAST  ⊆ FULL
    FULL ∩ HEAVY = ∅
    ALL   = FULL ∪ HEAVY

`test:all` 因此执行每个 Node `--test` 文件恰好一次 —— FAST 不会因为落在两个
suite 里而被重复跑。

当前 suite 实测（2026-10-04 review）：

- `pnpm test:fast` —— 日常开发快速 feedback。覆盖 V1.7 P0 frontend authoritative suite、helpers、copy/status、轻量权限、suite governance self-test 与小型确定性回归，不跑 temp SQLite / Vite SSR。当前 12 文件 / 344 测试，约 13.9 秒。
- `pnpm test` —— canonical full regression。包含 fast 全部内容 + 当前领域 workflow + integration + security + supported migration safety。当前 116 文件 / 1914 测试，约 56.3 秒。
- `pnpm test:heavy` —— slow / environment-coupled：backup restore、长迁移矩阵、生产 bootstrap、MySQL adapter、concurrency、performance、browser acceptance。不进入日常 gate。当前 7 文件 / 67 测试，约 19.6 秒（在 disposable 环境一次跑完）；MySQL gate 保持独立脚本，不被拉入 `test:heavy` 以保留其 disposable-only 防护。
- `pnpm test:all` —— FULL ∪ HEAVY，仅用于 release candidate / 数据库 migration release / 生产认证。当前 123 文件。

Runner 提供 `--list` / `--dry-run` 低成本验证 suite selection，也提供 `--filter <substring>`
对单个 suite 做 targeted smoke；`pnpm test:list` 是 `full --list` 的别名。

不允许通过 `skip()` / `todo()` / 删除 assertion 来制造"全绿"，heavy 分类依据必须是执行成本 / 环境依赖，而不是当前 failing。

frontend authoritative suite 固定为 `server/v17-p0-frontend-application-architecture.test.js`：
它拥有 route inventory 53/5、RouteLocation round-trip / 编码 / 非法输入 / stable query、launcher
group projection、route aliases、disabled routes、App.jsx shell + lazy screen + RouteSurface
+ AppNavigationContext + MobileShell 五入口合同。后续 frontend navigation contract
的新增与改动必须落在此处；旧 source-structure assertion（如 `App.jsx must still reference
Dashboard`）已迁移至 registry / projection API，禁止回归。

`server/test-suite-governance.test.js` 是 suite governance self-test，落在 FAST。
它重新调用 `validate()` 并断言每个 suite 不变量，保证后续任何人新增 `*.test.js`
但忘记把它分到某个 suite 时，`pnpm test:fast` 会立即失败。

完整测试矩阵、删除/迁移记录、1975→1868 的准确账目、各 domain canonical owner 与
runtime 实测见 [docs/operations/testing.md](./docs/operations/testing.md)。

默认完成 gate：

    focused node --test ...
    pnpm test
    pnpm build
    git diff --check

跨域 / 架构 / release-candidate 阶段使用 `pnpm test`；数据库 / 备份 / 生产 / 迁移 /
release 相关变更追加 `pnpm test:heavy` 与既有 MySQL gate。日常有界任务使用
`pnpm test:fast`。具体 AI gate 阶梯以 `AGENTS.md` §6 为权威。

### 15.3 MySQL gate

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
- 当前 master 与 tag `v1.6.2` 一致；任何 release-prep 变更以新 commit 表达，不得回滚既有 release tag。
- server/app.js 和若干页面仍过大，路由/页面拆分需要独立设计和回归。
- SQLite schema、历史 imperative migrations 与 MySQL bootstrap 并存，新增迁移必须验证双路径。
- docs/ 已分为 operations 当前专项指南与 archive 历史证据；两者均不得覆盖本文件和 document.md 的 canonical 合同。
- 旧 archive 当前工作树已脱敏，但 Git 历史仍包含历史秘密；历史清理与凭据轮换不属于普通代码重构。
- MySQL 生产备份/恢复、真实容量、分页收口和部署升级/回滚仍需环境化验收。
- 多公司、多币种、年结、政府电子发票、APS、完整 MES/OEE/QMS 和期初 WIP 属于明确未支持范围，不得通过 UI 或文档暗示已实现。
