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

## 19. V2 系统化重构与产品结构现代化设计

§19 是 V2 的当前架构设计，对应 document.md §20。它不是对既有章节的重写，而是新增一份当前技术设计：把 §20.3 的业务合同冻结、§20.4 的架构要求，转化为可逐 wave 推进的所有权、迁移和验证方案。任何对既有实现细节的引用仍以 §1–§18 为权威；本节只补充 V2 阶段特有的目标、边界、顺序和退出门槛。

### 19.1 设计目标与原则

V2 是 §20 描述的"结构重构与所有权迁移计划"，不是 greenfield 改写，也不得被解读为对既有 ERP 业务能力的替代发布。本节的设计目标是把"减少架构集中度 / 清晰前后端领域边界"翻译成可逐步落地的所有权与迁移规则。设计遵循下列原则：

1. **行为冻结**。§3–§17 与 §20.3 的业务合同在 V2 任何 wave 内不得偏离；任何被视为"行为修复"的发现必须先作为独立 REQUIREMENT / DESIGN delta 处理，不能混进纯重构 wave。
2. **增量优先**。每个 wave 必须留下一个可运行、可回归、外部行为等价的仓库状态；不得借重构改动 API、schema、路由身份或权限语义。
3. **单一规范实现**。同一业务原语不得同时存在两套活动实现；先有 caller proof / 替代实现，再用小逻辑单元删除旧的。
4. **零 schema 默认**。结构性 wave 默认零 schema 变更；若发现 schema 需求，STOP 该 wave 并独立 REQUIREMENT / DESIGN 处理。
5. **不引入框架**。不在 V2 第一波为路由分发或领域编排引入 Express/Koa/Router/DI 框架；既有 Node 原生 HTTP + 自包含 dispatch 是原文职责。
6. **重叠 wave 不混合**。跨模块 / 跨 API / 跨 schema / 跨视觉的不相关变更不得合入同一个 wave。
7. **AGENTS.md 优先**。每个 wave 的完成 gate 由 AGENTS.md §6.1 推导，而非由"业务风险"标签推导；"高风险业务领域"不等于"HEAVY test suite"。

本节对"front-end / back-end"作如下区分：后端指 Node 原生 HTTP 入口（`server/index.js`、`server/app.js`、`server/lib/`、`server/modules/`、`server/database/`、`server/migrations/`、`server/db.js` 基础部分）；前端指 React 19 + Vite 7 入口（`src/main.jsx`、`src/App.jsx`、`src/navigation/`、`src/api.js`、`src/pages/`、`src/components/`、`src/styles/`、`src/lib/`）。任何越界修改都视为跨域变更，必须按 §15 测试 gate 阶梯与 AGENTS.md §6.1 升档。

### 19.2 后端目标架构

§20.4 对后端的要求是"减少 `server/app.js` 集中度 / 显式领域所有权 / 可见的事务边界与权限 / 减少 kitchen-sink 形态"。本节给出该目标的所有权结构。

#### A. `server/app.js` 收敛后的责任

收敛后，`server/app.js` 仅承担下列职责：

1. `createApp(db, options)` 工厂函数，导出形式与现有合同保持兼容；
2. 全局 request lifecycle：`X-Request-Id` 生成与响应头、`setSecurityHeaders`、OPTIONS 204、慢请求日志钩子、未处理异常安全化；
3. `/api/health`, `/api/health/live`, `/api/health/ready` 三个 readiness 端点（已在 solution.md §4 表达，沿用）；
4. 静态资源 / `dist/` 提供与 SPA fallback（仍由 `createApp` 持有，但不在 `handleApi` 内）；
5. **薄 dispatch 入口**：把 `(method, pathname)` 解析为 `(route handler)` 并调用；不再包含业务不变量解析、来源校验、状态机或凭证生成；
6. 业务 handler 不再声明于 `server/app.js`，统一迁入 `server/modules/`；`server/app.js` 只保留与 dispatch 相关的私有函数（regex matcher、path param 抽取）。

不再属于 `server/app.js`（按各 wave 实际迁出）：

- 低 / 中风险主数据 / 字典 CRUD handler（如 `listCustomers`, `createCustomer`, `updateSupplier`, `listProducts`, `createProduct`, `listUsers`, `createUser`, `updateUser`, `listWarehouses`, `createWarehouse`, `updateWarehouse`, `listRoles`, `createRole`, `updateRole`, `listDepartments`, `createDepartment`, `listAuxProjects`, `createAuxProject`, `listCurrencies`, `listVoucherWords`, `createVoucherWord`, `listVoucherTemplates` 等）；
- 按 §19.7 各 bounded wave 选定的低 / 中风险单据 / state-change / 物流 handler 子集；
- 持久化的 `legacy*` 影子实现（在 §19.3 中按 caller-proof 规则删除）；
- 单据号码生成器（`makeVoucherNo`, `makeInventoryTransferNo`, `makeInventoryCheckNo`, `makeInventoryAdjustmentNo`, `makePurchaseOrderNo`, `makeOrderNo`），随其所属 wave 迁入领域内部。

不属于本 wave（已在 §19.4 / §19.7 标记为高风险，不在 first-wave 迁出）：

- 期间控制（`listPeriodClosures`, `createPeriodClosure`, `closePeriod`, `unclosePeriod`, `getClosureChecklist`）；
- 全部 settlement / accounting voucher / inventory mutation / valuation / LOT-SERIAL / IQC-OQC / manufacturing WIP-cost / MySQL adapter / migrations 相关 handler。

迁出后，`handleApi` 由领域模块的 route 表装载，仅记录 `matcher (method, pathRegex) → domainModule.handler`，并按 §19.2.B 的所有权规则代理。

#### B. Route 所有权模型（单一事实源）

route 表只承载 dispatch 与 ownership 必需的最小信息；不复制任何已有的运行时权威。

每个 route 描述项必须且只能包含：

- `method` — 大写 HTTP method；
- `path` — 既有 `pathname.match(/^\/api\/...\/([^/]+)$/)` 等正则风格；本阶段不引入 path-to-regexp 依赖；
- `handler` — 领域模块导出的函数；签名沿用各领域既有 signature，route 装载层以薄适配形态调用；
- `owner` — 领域模块路径（`server/modules/<domain>/...` 的目录或文件），禁止使用 `app.js` 作为 owner。

route 表不承载：

- 权限策略字段。Authorization 仍由 handler 入口第一行的 `allow` / `allowAny` 校验承担；权限名取自 `PERMISSIONS` 常量。任何把权限合并到 route 表的元数据都会与 runtime 校验漂移，禁止引入。
- `transactionPolicy` / `auditPolicy` 元数据。事务边界仍是 `transaction(db, work)`，由领域 module 在触发写入时调用；审计仍是 `server/lib/audit.js` 的 `audit(db, ...)`，由领域 mutation 同事务内调用。任何把这些策略抽到 route 表的设计都会产生第二个可漂移的事实源，禁止引入。

route 表静态校验：

- 重复的 `(method, path)` → fail closed；
- 同一 `(method, path)` 关联到两个 owner → fail closed；
- 任何 handler 的 owner 字段指向 `app.js` → fail closed；
- 注册表在 `pnpm test` 内由 server test 启动时静态加载并断言。

#### C. Handler 适配层（不强求统一签名）

迁出后 handler 与 dispatch 之间以"适配"为默认形态，不强求既有 handler 立即统一签名。handler 既有的 sign 约定按各领域 module 现状保留；route 表装载层以薄适配形态调用。

适配层按下列四层组织（不修改领域实现）：

1. **HTTP adapter** — 把 `Request` / `URL` / `URLSearchParams` / body / path 解析为 plain input；不进入领域。`server/lib/http.js` 暴露 `readJson`, `assertAllowedFields`, `send`, `HttpError`, `serializeError`, `bearer`, `setSecurityHeaders`。
2. **Authorization** — handler 入口第一行调用 `allow(actor, perm)` / `allowAny(actor, [...])`；权限名取自 `PERMISSIONS` 常量；迁移时不得改权限名或放松检查。
3. **Domain command / query** — 接受 plain business input，返回 business result；领域不接收 `URLSearchParams` / `Request` / `Response` 等 HTTP 协议对象；既有实现仍暂时依赖 HTTP 形态的部分允许保留 compat adapter。
4. **Response adapter** — 把 business result 序列化为 HTTP response；不进入领域。

handler 内部禁止：

- 自行写 voucher / settlement / inventory mutation 的 SQL；
- 自行调用 `audit(...)` 与业务写入分离（必须同事务）；
- 把 `app.js` 私有函数 / 单据号码生成器 / 凭证生成器作为依赖；这些迁入领域内部。

#### D. Domain 模块责任边界

domain 目录与文件布局不在本节预先冻结。下列为设计规则，不是恒等替代方案：

- 领域目录在某个迁移 wave 证明该业务确有 coherent owner 后才创建；不得为了架构美观预创建。
- ownership 跟随当前业务责任与 call chain，不跟随 `extended.js` / `business.js` 等历史文件名。
- 不创建 catch-all 替代领域；不创建新的 kitchen-sink（例如把 OA + CRM + 项目 + workflow 合入一个目录）。
- 具体目录命名由该 wave 的 REQUIREMENT / DESIGN 决定。

举例（仅作示例，非最终仓库 taxonomy）：

- 若 sales order 迁出，target owner 通常是当前实现已承担该职责的领域文件（`server/modules/` 下现存的 export 或新增模块）；
- 若 decision-reports 迁出，target owner 通常是当前 `server/modules/decision-reports.js`（已承载）；
- 具体的目录与文件名由各 wave 决定；本节不强求统一模板。

跨领域依赖：

- 不经由 `app.js` 中转；
- 跨领域调用由模块导出函数表达；
- 静态 caller / import 关系是迁移证据，不是 runtime / domain source；本节不强制 `callers.js` 等 committed 文件。

#### E. 兼容性 / 外部 API 合同

V2 任何 wave 都不得改变：

- HTTP methods、`paths`、`request shapes`、`response shapes`、错误结构（`HttpError` + `X-Request-Id`）；
- 权限名 `PERMISSIONS.*` 与 `allow` / `allowAny` 校验语义；
- `transaction(db, work)`、审计、idempotency 行为；
- 既有 MySQL stale-connection recovery / 并发合同（solution.md §6 / §9 / §9.1）。

V2 第一波不引入任何 API deprecation 行为（无强制 deprecation 周期、无 `Deprecated:` HTTP 头）。任何 API 增加 / 字段变更 / 端点删除由后续独立 REQUIREMENT / DESIGN wave 处理。

### 19.3 后端领域所有权清理

#### A. 混合 ownership 模块的拆分策略

`server/modules/extended.js`（主数据扩展 + OA + HR + IQC / OQC + 评估 + Alert + MRP classic + financial reports）、`server/modules/business.js`（CRM + 项目 + 工时 + 通知 + workflow）、`server/modules/lifecycle-engine.js`（草稿删除 + 引用检查 + 清理事件）、`server/modules/decision-reports.js`、`server/modules/planning-documents.js`、`server/modules/planning.js` 当前承担混合 ownership。

拆分策略：

- 只迁移已证 coherent 的低 / 中风险责任（按各 wave 的 focused test / 调用链证据）；
- 高风险责任（IQC / OQC、MRP classic、financial reports、CRM / 项目 / 工时 / 通知 / workflow 等）保留在当前 canonical 模块直至其独立 wave；
- 跨域迁移按业务 owner 划分，不按文件大小或历史名划分；
- 兼容 re-export 只在迁移证据成立后暂时保留，且仅指向唯一实现。

#### B. 死代码删除规则

仅当满足下列全部时，才允许删除一个函数或文件：

1. 删除前一刻在实现 wave HEAD 上重新跑 zero-caller proof（`git grep` / `import` / export 检查 / route ownership / 单元测试引用），不得仅依据 Stage 0 静态快照；
2. canonical 替代实现已在注册表中可见（route 表 `owner` 字段指向唯一模块）；
3. 替代实现的 return / error / permission / transaction / audit 语义与被删函数已比较；
4. 删除作为独立小逻辑单元提交（不得与跨模块变更混在同一个 commit）。

按 Stage 0 静态分析，下列函数为"当前删除候选"，但其 zero-caller proof 必须在实际删除所在 wave 的 HEAD 上重新执行：

- `legacyListCashJournals`, `legacyCreateCashJournal`, `legacyListBankAccounts`, `legacyCreateBankAccount`, `legacyUpdateBankAccount`, `legacyListBills`, `legacyCreateBill`, `legacyUpdateBill`, `legacyListFixedAssets`, `legacyCreateFixedAsset`, `legacyUpdateFixedAsset`, `legacyCalculateDepreciation`, `legacyCalculateProductionCost`；
- `getCashJournal`, `deleteCashJournal`, `getBankAccount`, `getBill`, `getFixedAsset`, `listAssetDepreciations`, `getProductionCost` 等私有 helper。

不允许删除：

- 任何仍由 `handleApi` 直接调用的私有函数；
- 任何被跨文件 `import` 引用的导出；
- 任何受既有测试依赖的 helper。

#### C. dead-code 删除前的 regression 证据

死代码删除前必须确认：

1. 替代 route 的 list / get / get-detail / mutation / state-change 由既有 focused `node --test` 覆盖；既有 live focused test 已覆盖替代实现时不得为删除而新建"行为等价"测试；
2. 若既有覆盖不足，先为 live 行为补 focused test，再删除；
3. 删除前 `pnpm test` 全绿（验证 `validate()` 集合不变）。

#### D. caller-proof 证据来源

caller-proof 是迁移证据，不属于 runtime / domain source。证据来源：

- `git grep` 跨模块 `import` / `from '...'`；
- route 表 `owner` 字段 handler 调用；
- 单元测试 `import { fn }` / `fn(` 引用；
- focused test 断言。

本节不强制 `scripts/testing/caller-proof.js` 等 committed helper 脚本。仅在实际删除 / 迁移 wave 证明 helper 必要后再由独立 wave 引入；不得仅因架构纯净而在 Wave 1 引入。

### 19.4 受保护的高风险领域

下列领域属于 V2 第一波高风险，必须延后或仅在更强 gate 下迁移：

- **inventory mutation**（inventory transactions、adjustments、transfers、scrap）：数量 + LOT/SERIAL 身份 + 估值同步发生，事务边界与审计不可破坏；
- **inventory valuation**（NONE / LOT / SERIAL 池，valuation movements、cache）：LEGACY_UNVALUED 与权威关账合同保留；
- **LOT / SERIAL**（tracking, hold/release, allocation）：身份唯一性、可用性排除规则、谱系证据；
- **IQC / OQC**（quality gates, authoritative quality, FAIL safe-default）：PASS/FAIL/STALE 与抽样规则；
- **period close**（inventory month-end, accounting period closures）：阻断级 System Health 与"存货期间先于会计期间"关闭顺序；
- **AR / AP settlement**（settlement-core, settlement, financial-controls）：不可变再贷项、缓存刷新、写后回流；
- **accounting voucher posting**（`createSystemVoucher`, period gating, debit/credit 严格相等）：POSTED-only 报表；
- **manufacturing WIP / cost**（manufacturing-execution, `snapshotManufacturingExecution`, `deriveProductionCost`）：AUTHORITATIVE / PARTIAL / ESTIMATED 证据，缺失不得伪装为零；
- **MySQL adapter / recovery**（`server/database/*`）：timeout-generation protocol、failure-driven recovery、写禁止重放；
- **migrations**（`server/migrations/`, `server/db.js` 基础 schema）：schema 变更必须单独 REQUIREMENT / DESIGN wave。

对这些领域的迁移要求：

1. 不得借 V2 重构改变业务不变量；
2. 迁移必须携带 focused tests 覆盖：交易回滚、来源 recheck、审计写入、权限位、写后 idempotency；
3. MySQL 受影响 wave 必须运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`（在具备受保护 disposable MySQL 环境时）；
4. 任何 schema 变更必须独立 REQUIREMENT / DESIGN wave（§19.10）。

### 19.5 前端目标架构

§20.4 对前端的要求是"`applicationRegistry` 仍为 canonical 路由 / Route 元数据事实源；`RouteLocation` 语义保持；direct URL / 刷新 / Back / Forward 正常工作；授权 gate fail-closed；大型遗留页面逐步分解为 list / detail / editor / domain surface；mobile-first 不回归"。本节给出具体的层、组件归属与迁移模型。

#### A. `applicationRegistry` 不变

- `src/navigation/applicationRegistry.js` 仍是 Route、access、Launcher Entry、target contract、screen loader、responsive mode 的 canonical 事实源；
- §3.1 中既有的 `presentationMetadata.js` / `applicationMetadata.js` 仍是兼容 projection，不得成为第二份事实源；
- 不创建第二份 route registry；
- 不创建重复 launcher metadata；
- `applicationRegistry` 的静态校验（重复 key、冲突 alias、无效 parentRoute、指向不存在 Route 的 Launcher Entry、缺少 Screen 的启用 Route）维持现状（详见 solution.md §3.1）；
- `RESPONSIVE_MODES` 枚举的现有值（`LEGACY_ADAPTER` / `NATIVE_RESPONSIVE`）保持；不新增运行时 production 状态。

#### B. 屏幕 / 组件所有权层

下列层是前端 V2 必须遵守的依赖方向（上层依赖下层，下层不依赖上层）：

1. **`applicationRegistry` + `routeLocation` + `AppNavigationContext`**（事实与导航层）— 不变；
2. **`App` + `MobileShell` + `RouteScreen` + `V16RouteSurface`**（壳 / 编排层）— 不变；
3. **domain list surface**（list / filter / row）：由实际迁移 wave 的目标 owner 文件承载；
4. **domain detail surface**（detail / workflow / status / related sections）：由实际迁移 wave 的目标 owner 文件承载；
5. **domain editor / workflow surface**（form / editor / modal / action bar）：由实际迁移 wave 的目标 owner 文件承载；
6. **reusable domain components**：由实际迁移 wave 的目标 owner 文件承载；
7. **shared UI / design-system primitives**：`src/components/ui.jsx`, `src/components/design-system.jsx`, `src/components/icons.jsx`, `src/components/MobileShell.jsx`, `src/components/MobilePage.jsx`, `src/lib/copy.js`, `src/lib/status.js`, `src/lib/money.js`, `src/lib/presentation.js`, `src/lib/tracking.js`（保持与现状一致）。

明确禁止：

- 把 ERP 业务含义（如 APPROVE / CONFIRM / TRANSFER / REVERSE / HOLD / RELEASE / POST 等动作语义）写进 `src/components/ui.jsx`、`design-system.jsx`、`icons.jsx` 等通用层；
- 在通用组件中调用 `api()`、判断 role / permission、解析 route target / location；
- 让 domain surface 直接依赖另一个 domain surface（必须通过 route 跳转或 AppNavigationContext）。

#### C. Route 迁移模型（无双活屏幕）

`responsiveMode` 保持现有两个 production 值（`LEGACY_ADAPTER` / `NATIVE_RESPONSIVE`）；不新增运行时 production 状态。同一 route key 必须只对应唯一 live executable screen。

迁移按三阶段模型：

A. **Before cutover**：
- 既有 route loader 仍为权威；
- route 保持当前 `responsiveMode`（通常 `LEGACY_ADAPTER`）；
- 新 surface 可独立开发 / 测试，但不挂载为该 route key 的 live screen；不进入 registry 的 `loader`。

B. **Cutover**：
- 在 focused / full evidence 证明等价后，一次 bounded change 替换该 route 的 loader ownership；
- 必须仅有一个 active screen implementation 对应同一 route key；
- 不允许"新 primary + 旧 fallback"双活屏幕；
- 不允许同一 route key 暂时并行持有两套 live executable business screen。

C. **Responsive completion**：
- 若新 screen 仍依赖 legacy adapter（典型 desktop-table 形态），`responsiveMode` 可暂时保持 `LEGACY_ADAPTER`；
- 只有当新 screen 满足 §19.5.D 退出门槛（无 desktop-table / 无 `MutationObserver`、320 / 390 / 430 / 680 px 已覆盖）后，`responsiveMode` 才设为 `NATIVE_RESPONSIVE`。

#### D. Route 退出门槛

仅当下列全部成立时，一条 Route 视为完成 native responsive 迁移：

1. `route.key`, `pathParam`, `queryKeys`, `alias` 行为保持不变；
2. 权限 / access 与 `applicationRegistry.access` 一致；
3. list / detail / editor / workflow 路径在新 screen 内仍然一致；direct URL 仍按既有 target 解析；
4. 320 / 390 / 430 / 680 CSS px 响应式行为已记录并测试覆盖；
5. 页面不再依赖 `MutationObserver`（`data-responsive-mode` 不再为 `LEGACY_ADAPTER`）；
6. focused test 已覆盖 list / detail / editor / deep-link / Back / Forward；
7. `applicationRegistry.responsiveMode === 'NATIVE_RESPONSIVE'` 已静态设置。

### 19.6 移动展示现代化基线（设计目标）

`P4` 在 document.md §20.5 是"需求目标"层级。本节只列出现有 canonical 已经背书的展示架构原则，不进入具体组件 / CSS / 默认值：

1. **信息层级** — 主标题 / 副标题 / 主操作 / 次要操作 / 返回的标准外壳；
2. **mobile-first 密度** — 320 px 下必须能完成核心操作；主要触控目标 ≥ 44 × 44 CSS px；
3. **list / detail / editor 一致性** — 同一业务对象在 list / detail / editor 三种 surface 行为一致；
4. **primary / secondary / destructive action 层级** — 主操作优先、次要操作次级、破坏性操作需要二次确认；
5. **filter / sort / search / status / loading / error patterns** — 维持现状；
6. **safe-area 感知** — 顶栏 / 底栏适配；
7. **响应式断点** — 320 / 390 / 430 / 680 CSS px 行为保持；
8. **业务动作语义保留** — APPROVE / CONFIRM / TRANSFER / POST / REVERSE / HOLD / RELEASE 必须各自具备显式标识与文案；不得合并为一个通用 visual action。

不冻结具体组件选择 / 默认值；具体细节由后续独立 DESIGN wave 决定。

### 19.7 实现 waves

下列 wave 顺序由当前 call chain 与 ownership 推导；按"先低风险、后高风险；先规则、后内容；先静态、后行为"组织。每 wave 必须留下一个 runnable、regression-safe、externally-compatible 的仓库状态。具体 wave 数量与划分由实际当前 ownership 决定。

#### Wave 1 — 后端 dispatch 所有权基础设施

- 目标：建立 route 表装载层；建立静态校验；建立 dispatch 与领域 handler 之间的薄适配。
- scope：仅引入 route 表与 dispatch 装载；不迁任何 handler；不动业务；不改 schema；不改前端。
- files：`server/app.js`（薄化）、`server/lib/route-table.js`（新增）、`server/route-table.test.js`（新增）。
- non-goals：不迁移 handler；不引入 permissions / transactionPolicy / auditPolicy 元数据；不创建 `callers.js` 强制文件；不强制 caller-proof 脚本。
- frozen contracts：所有现有 API / 路径 / 权限 / 错误形态。
- focused tests：route 表静态校验（重复 owner / 无 owner / 指向 app.js / 唯一性）。
- canonical gate（由 AGENTS.md §6.1 推导；架构 / canonical metadata tier）：`pnpm test` + `pnpm build` + `git diff --check`。
- rollback：删除 `server/lib/route-table.js` 与新 test 文件，回退 `server/app.js` 单一 commit。
- exit criteria：
  - `server/app.js` 中除 dispatch 入口外不引入新业务逻辑；
  - route 表静态校验可独立运行并对当前 `handleApi` 行为等价；
  - `pnpm test` 全绿。
- risk：低。

#### Wave 2 — 已识别 dead-code 清理

- 目标：删除 Stage 0 静态分析得到的 dead code 候选（`legacy*` 与若干私有 helper）。
- scope：`server/app.js` 内的 `legacy*` 函数；私有 helper（`getCashJournal` / `deleteCashJournal` / `getBankAccount` / `getBill` / `getFixedAsset` / `listAssetDepreciations` / `getProductionCost` 等）。
- non-goals：不迁任何其他函数；不动 dispatch；不动业务。
- frozen contracts：所有现有 API / 路径 / 权限 / 错误形态。
- focused tests：既有 live endpoint focused test 已覆盖替代实现时不再新建"等价"测试；若覆盖不足先补 focused test 再删除。
- 删除前必须重跑 zero-caller proof（不得仅依据 Stage 0 快照）。
- canonical gate（按 AGENTS.md §6.1 推导；本 wave 是低风险结构性重构）：`pnpm test:fast` + `pnpm build` + `git diff --check`。
- rollback：保留 dead-code 删除为单独小 commit；恢复该 commit 即回滚。
- exit criteria：
  - 全仓 grep / route 表 / 测试引用已无 `legacyListCashJournals` 等；
  - `pnpm test:fast` 全绿；
  - 既有 live focused test 全绿。
- risk：低。

#### Wave 3 — 第一波低风险 backend domain 所有权迁移（master / dictionary 子集）

- 目标：将 §19.2.A 列出的"低风险主数据 / 字典 CRUD handler"从 `server/app.js` 迁入对应领域文件。
- scope：仅低 / 中风险主数据 / 字典，例如 `customers / suppliers / products / warehouses / users / roles / departments / auxProjects / currencies / voucherWords / voucherTemplates` 等。
- 排除：`periodClosures / closePeriod / unclosePeriod / getClosureChecklist` —— 期间控制为高风险，留待 §19.4 / §19.7 独立 wave。
- files：相关领域模块（按当前 call chain 与现有实现承载决定 owner；不预先创建 kitchen-sink domain）；`server/app.js`（仅 dispatch 表）；如需，原模块保留 compat re-export。
- non-goals：不动高风险期间控制；不动 settlement / accounting voucher / inventory mutation / valuation / LOT-SERIAL / IQC-OQC / manufacturing WIP-cost / MySQL adapter / migrations。
- frozen contracts：所有现有 API / 路径 / 权限 / 错误形态。
- focused tests：每个端点至少有 focused test 覆盖 list / get / create / update / delete；既有 live focused test 已覆盖的不新建。
- canonical gate（跨域 / 架构 tier）：`pnpm test` + `pnpm build` + `git diff --check`。
- rollback：本 wave 内逐端点提交；任何端点失败仅回滚该端点。
- exit criteria：
  - `server/app.js` 内不再声明上述函数；
  - route 表 `owner` 字段指向实际领域文件；
  - `pnpm test` 全绿。
- risk：低 — 中。

#### Wave 4 — 后续 bounded backend domain 迁移（按业务责任分组）

Wave 4 不再是"单据 / 物流 / 凭证一次性"子集；它把后续 backend domain 迁移拆为多个 bounded wave。每个具体 wave 必须：

- 仅迁一个 coherent business owner 的 handler；
- 不混入 §19.4 高风险领域；
- 按当前 call chain 与 §19.3.A 拆分策略选 owner；
- 携带 focused tests（既有 live focused test 已覆盖的不新建）；
- canonical gate 由 AGENTS.md §6.1 按变更类型推导（多数为架构 / 跨域 tier：`pnpm test` + `pnpm build` + `git diff --check`；少数低风险子集可降级为 `pnpm test:fast` + `pnpm build` + `git diff --check`）。

下列高风险领域**不**进入普通 first-wave：inventory mutation / period close / settlement / accounting voucher / valuation / LOT-SERIAL / IQC-OQC / manufacturing WIP-cost / MySQL adapter / migrations。

示例（仅作示例，非最终 wave 数量）：

- 一个仅迁"采购入库草稿 / 销售出货草稿"等 logistics 单一源子集的 wave；
- 一个仅迁"折让 / 退款 / write-off"中单一低风险责任子集的 wave；
- 一个仅迁"决策报表"中 read-only 子集的 wave。

实际 wave 数量与边界由当前 call chain 决定。

#### Wave 5 — extended.js / business.js / lifecycle-engine.js / decision-reports.js / planning-documents.js / planning.js 拆分（仅低 / 中风险）

- 目标：按 §19.3.A 策略，从上述混合 ownership 文件中迁出已证 coherent 的低 / 中风险责任。
- 排除：IQC / OQC、MRP classic、financial reports、CRM / 项目 / 工时 / 通知 / workflow 等高风险责任留待其独立 wave；`extended.js` / `business.js` 不要求在本 wave 变空。
- files：按各 wave 目标 owner 决定。
- frozen contracts：所有现有 API / 路径 / 权限 / 错误形态。
- focused tests：每个被迁出函数 / 端点沿用既有 live focused test。
- canonical gate（架构 / 跨域 tier）：`pnpm test` + `pnpm build` + `git diff --check`；少数纯函数 / helper 抽取可降级为 `pnpm test:fast` + `pnpm build` + `git diff --check`。
- rollback：每文件独立提交；任何文件失败仅回滚该文件。
- exit criteria：
  - 已迁出的低 / 中风险责任在原文件中不再承担；
  - route 表 `owner` 指向新 owner；
  - `pnpm test` 全绿。
- risk：低 — 中。

#### Wave 6 — 第一波 bounded frontend route-family 提取

- 目标：从历史大文件中按 route-family / business surface 提取第一组 frontend 责任。
- scope：实际由当前 call chain 决定；不预先创建空 `src/pages/<domain>/` 骨架；不预先绑定到 `master-data` 等历史文件名；按 route key 实际的业务责任（如订单、采购、库存）迁出。
- 排除：当前 §19.4 高风险责任。
- files：按 route-family 决定；`src/navigation/applicationRegistry.js`（loader 替换为唯一实现）；`server/v17-p0-frontend-application-architecture.test.js`（按需更新注册验证）。
- non-goals：不创建第二份 route registry；不创建重复 launcher metadata；不引入 `MIGRATING` 等新运行时 production 状态。
- frozen contracts：53 个 route + 5 个 disabled route；既有 access / aliases / target contract / launcher metadata / 五入口 MobileShell 不变。
- focused tests：每个 route-family 单独测试 list / detail / deep-link / Back / Forward；权限位显式断言；`applicationRegistry` 静态校验全绿。
- canonical gate（前端架构 / canonical metadata tier）：`pnpm test` + `pnpm build` + `git diff --check`。
- rollback：保持唯一 loader；任何 route-family 失败仅回滚该 route-family。
- exit criteria：
  - 该 route-family 在原文件中不再承担（剩余路由函数兼容 re-export 指向唯一实现）；
  - `applicationRegistry.responsiveMode` 保持既有值（未达到 native-responsive 退出门槛前保持 `LEGACY_ADAPTER`）；
  - `pnpm test` 全绿。
- risk：中。

#### Wave 7 — 后续 frontend route-family 提取

- 目标：继续按 route-family / business surface 提取剩余责任。
- scope / files / non-goals / frozen contracts / focused tests / gate / rollback / exit criteria / risk：与 Wave 6 同模式，由当前 call chain 决定边界。
- canonical gate（前端架构 / canonical metadata tier）：`pnpm test` + `pnpm build` + `git diff --check`。

#### Wave 8 — NATIVE_RESPONSIVE 切换

- 目标：按 route / surface 移除 `MutationObserver` 依赖；满足 §19.5.D 退出门槛后切换 `responsiveMode` 为 `NATIVE_RESPONSIVE`。
- scope：每个 route / surface 独立 wave。
- files：对应 surface 文件；`src/components/V16RouteSurface.jsx`（仅在该 route 完全切换后调整逻辑分支）；`src/navigation/applicationRegistry.js`。
- frozen contracts：路由身份、权限、行为、target contract。
- focused tests：list / detail / editor / deep-link / Back / Forward / 320 / 390 / 430 / 680 px 响应式断言。
- canonical gate（前端架构 tier）：`pnpm test` + `pnpm build` + `git diff --check`。
- rollback：`responsiveMode` 字段回退；`MutationObserver` 重新启用。
- exit criteria：
  - 对应 route 不再使用 `MutationObserver`；
  - `data-responsive-mode` 不再为 `LEGACY_ADAPTER`；
  - `pnpm test` 全绿。
- risk：低 — 中。

#### Wave 9 — 移动展示现代化（独立 REQUIREMENT / DESIGN）

- 目标：按 §19.6 的展示架构原则进入 P4 实现。
- scope：由独立 REQUIREMENT / DESIGN wave 决定。
- non-goals：不与 schema / API / 后端重构混合。
- frozen contracts：业务工作流、权限、状态机术语；§19.6 业务动作语义保留。
- canonical gate：按实际变更类型由 AGENTS.md §6.1 推导。UI 重构多为 daily-bounded tier `pnpm test:fast` + `pnpm build` + `git diff --check`；跨域 wave 升档。
- 具体细节在独立 wave 内决定。

#### Wave 10 — 高风险领域重构（独立 REQUIREMENT / DESIGN）

- 目标：inventory mutation / valuation / LOT-SERIAL / IQC-OQC / period close / settlement / accounting voucher / manufacturing WIP-cost / MySQL adapter / migrations。
- scope：每个领域单独 wave；不在其他 wave 混合。
- frozen contracts：§19.4 高风险领域合同。
- focused tests：交易回滚、来源 recheck、审计写入、写后 idempotency 显式断言。
- canonical gate：基础 gate 由 AGENTS.md §6.1 按变更类型推导；变更属于 backup / restore / production bootstrap / deployment / systemd / nginx / legacy migration / MySQL adapter / concurrency / performance / filesystem destructive safety 时，按 HEAVY 类别附加 `pnpm test:heavy`；同时涉 MySQL 且具备受保护 disposable MySQL 环境时，附加 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。`pnpm test:heavy` 与 MySQL gate 互相独立：HEAVY 类别 gate 不依赖 MySQL 环境存在。
- risk：高。

### 19.8 兼容性与 deprecation

V2 任何 wave 在迁移期间允许：

- 兼容 re-export，但仅指向唯一实现（不得形成"新 + 旧"两套 live executable 业务实现）；
- 薄 dispatch 入口（与原 dispatch 共存）作为迁移期间的 fallback，但不得形成两个并行 dispatcher；
- route 表 `owner` 字段静态指向新模块，但旧入口必须可逐步被替换。

禁止：

- 把兼容层变成第二个 writable source of truth；
- 把兼容层变成第二个 live executable business screen。

兼容层移除条件（全部 evidence-based，不得使用 elapsed-time 条件）：

- canonical loader / owner 已切换；
- 兼容 import / 引用已零（caller-proof 通过）；
- 静态 import / grep 清洁；
- focused tests 全绿；
- 该 wave 的 canonical gate 通过。

不允许任意替换：

- 任何现有 API path / request shape / 错误头 / `X-Request-Id`；
- 既有 `applicationMetadata.js` / `presentationMetadata.js` 作为兼容 projection（不得变成第二份事实源）；
- 既有 `applicationRegistry.js` 静态校验。

V2 第一波不引入任何 API deprecation 行为（无强制 deprecation 周期、无 `Deprecated:` HTTP 头）。

### 19.9 可观测性与错误合同

V2 任何 wave 必须保持：

- `X-Request-Id` 在每个响应携带；调用方提供的 ID 须符合现有格式；
- 慢请求 / 慢查询（`SLOW_REQUEST_MS`, `SLOW_QUERY_MS`）日志事件、字段不变；
- `mysql_connection_lost`, `mysql_reconnect_attempt`, `mysql_reconnect_success`, `mysql_reconnect_failed`, `mysql_transaction_lost` 事件保持；
- `HttpError` 序列化合同、`serializeError` 返回安全消息 + request ID 形态不变；
- 不在错误响应中泄露 SQL、stack、连接串、密码；
- `/api/health/live`, `/api/health/ready`, `/api/health` readiness 合同不变（详见 solution.md §9.1）。

迁移中新增的可观测事件必须保持单一来源（`server/lib/logger.js` 的 `createStructuredLogger`），不得在领域模块内建立新 logger。

### 19.10 数据库与 schema 策略

结构性 wave 默认零 schema 变更。schema 变更与结构性迁移不得混在同一个 wave。

若某结构性 wave 发现需要 schema 变更：

1. STOP 当前 wave；
2. 创建独立 REQUIREMENT / DESIGN delta（受 AGENTS.md §3 流程约束）；
3. 由独立 schema wave 实施，按 AGENTS.md §6.1 推导对应 gate，双路径验证（SQLite + MySQL 8）。

独立批准的 schema wave 可对相关领域 schema 做必要修改；该 schema wave 与结构性 extraction wave 在不同 commit / 不同 wave 实施。

不允许：

- 在结构性 V2 重构 wave 中夹带"顺手"清理 schema；
- 修改 `server/db.js` 基础 schema、`server/migrations/`、`server/database/mysql-schema.js`，除非由独立 schema wave 批准；
- 修改业务字段名 / 类型 / 索引，以消除 §19.3.A 拆分的模棱两可。

### 19.11 测试 / gate 映射

每个 wave 的完成 gate 由 AGENTS.md §6.1 按变更类型落入三档之一：

- 日常有界任务（单域 / 单页面 / 小型 bugfix / 低风险重构 / 非跨域）：`pnpm test:fast` + `pnpm build` + `git diff --check`；
- 跨域 / 架构 / canonical metadata（application registry、permissions、shared accounting / inventory contracts、cross-domain workflow、大型重构、release candidate）：`pnpm test` + `pnpm build` + `git diff --check`；
- HEAVY 相关（backup / restore、production bootstrap、deployment、systemd、nginx、legacy migration、MySQL adapter、concurrency、performance、filesystem destructive safety）：上一档基础 gate + `pnpm test:heavy`；当变更同时涉及 MySQL 且具备受保护 disposable MySQL 环境时，再附加 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。`pnpm test:heavy` 与 MySQL gate 互相独立：HEAVY 类别 gate 不依赖 MySQL 环境存在。

按当前 call chain 与 §19.7 推导，各 wave 落入 tier 如下（具体 gate 由该 wave 在执行时按实际变更再确认一次）：

| Wave | 变更类型 | canonical gate |
|---|---|---|
| Wave 1（后端 dispatch 所有权基础设施） | 架构 / canonical metadata | `pnpm test` + `pnpm build` + `git diff --check` |
| Wave 2（已识别 dead-code 清理） | 日常低风险重构 | `pnpm test:fast` + `pnpm build` + `git diff --check` |
| Wave 3（低风险 backend domain 迁移 master / dictionary 子集） | 跨域 / 架构 | `pnpm test` + `pnpm build` + `git diff --check` |
| Wave 4+（后续 bounded backend domain 迁移） | 按该 wave 实际变更类型（多为跨域 / 架构） | `pnpm test` + `pnpm build` + `git diff --check`；少数低风险子集可降级为 `pnpm test:fast` + `pnpm build` + `git diff --check` |
| Wave 5（extended.js 等混合 ownership 拆分低 / 中风险部分） | 跨域 / 架构 | `pnpm test` + `pnpm build` + `git diff --check`；少数纯函数 / helper 抽取可降级为 `pnpm test:fast` + `pnpm build` + `git diff --check` |
| Wave 6+（frontend route-family 提取） | 前端架构 / canonical metadata | `pnpm test` + `pnpm build` + `git diff --check` |
| Wave 8（NATIVE_RESPONSIVE 切换） | 前端架构 / canonical metadata | `pnpm test` + `pnpm build` + `git diff --check` |
| Wave 9（P4 移动展示现代化） | 按实际变更类型（多为 UI 重构） | 大多数 daily-bounded tier：`pnpm test:fast` + `pnpm build` + `git diff --check`；跨域 wave 升档 `pnpm test` + `pnpm build` + `git diff --check` |
| Wave 10+（高风险领域重构） | 按变更实际类型；HEAVY 类别按 AGENTS.md §6.1 追加 `pnpm test:heavy`；MySQL 受影响且具备受保护环境时附加 MySQL gate | 由该 wave 按 AGENTS.md §6.1 推导 |

不得冗余同时要求 `pnpm test:fast` 与 `pnpm test`；`pnpm test` 已包含 FAST 集合。

测试集合不变式必须保持（见 §15.2）：

- `FAST ⊆ FULL`、`FULL ∩ HEAVY = ∅`、`ALL = FULL ∪ HEAVY`；
- 不得通过 `skip` / `todo` / 删除 assertion / 重分类制造绿色；
- `server/test-suite-governance.test.js` 必须继续在 FAST suite；
- `server/v17-p0-frontend-application-architecture.test.js` 继续作为 frontend authoritative suite。

### 19.12 设计决策记录

下列决策在 §19 中作为本设计阶段的最终答复（与 document.md §20.4 要求对应）：

1. **`server/app.js` 收敛后的责任** — request lifecycle / X-Request-Id / 安全头 / readiness / 静态资源 / 薄 dispatch / 私有 matcher 函数。详见 §19.2.A。
2. **route 表最小信息集** — 只含 `method / path / handler / owner`；不复制 `permissions / transactionPolicy / auditPolicy`；Authorization 仍由 `allow` / `allowAny` 承担；事务仍由 `transaction(db, work)` 承担；审计仍由领域内 `audit(db, ...)` 承担。详见 §19.2.B。
3. **handler 适配层（不强求统一签名）** — HTTP adapter / Authorization / Domain command/query / Response adapter 四层；既有 handler 签名按各领域 module 现状保留；route 装载层以薄适配调用。详见 §19.2.C。
4. **domain 目录创建规则** — 仅在某个迁移 wave 证明该业务确有 coherent owner 后才创建；不预创建；不创建 kitchen-sink；具体命名由该 wave 决定。详见 §19.2.D。
5. **兼容性 / 外部 API 合同** — 第一波不改变 API path / request shape / 错误形态 / 权限名 / 事务 / 审计；不引入任何 API deprecation 行为。详见 §19.2.E / §19.8。
6. **dead-code 删除规则** — zero-caller proof 必须在实现 wave HEAD 重跑（不得仅依据 Stage 0 快照）；既有 live focused test 已覆盖替代实现时不新建"等价"测试。详见 §19.3.B / §19.3.C / §19.3.D。
7. **caller-proof 证据来源** — git grep / route ownership / import 静态分析 / focused test；不强制 `callers.js` 或 committed helper script；helper 仅在删除 / 迁移 wave 证明必要时独立 wave 引入。详见 §19.3.D。
8. **高风险领域延后** — inventory mutation / valuation / LOT-SERIAL / IQC-OQC / period close / settlement / accounting voucher / manufacturing WIP-cost / MySQL adapter / migrations。详见 §19.4。
9. **frontend 迁移模型（无双活屏幕）** — A. before（既有 loader 权威，新 surface 独立开发不挂载）/ B. cutover（一次 bounded change 替换 loader，唯一 active screen）/ C. responsive completion（满足 §19.5.D 后设 `NATIVE_RESPONSIVE`）。不引入 `MIGRATING` 状态。详见 §19.5.C / §19.5.D。
10. **frontend 兼容 shim** — 仅指向唯一实现；不得形成第二个 live executable screen；移除条件 evidence-based。详见 §19.8。
11. **frontend decomposition 规则** — 按 route-family / business surface 推进；不按 `master-data` 等历史文件名预绑定；目录命名由该 wave 决定。详见 §19.5.B / §19.7 Wave 6。
12. **generic UI 与 ERP 语义分离** — generic 组件只拥有展示 / 交互；不得调用 `api()`、判断 role / permission、解析 route target / location；APPROVE / CONFIRM / TRANSFER / POST / REVERSE / HOLD / RELEASE 等动作语义不得下沉到 generic 层。详见 §19.5.B。
13. **mobile 展示现代化基线** — 信息层级 / mobile-first 密度 / list-detail-editor 一致性 / action 层级 / filter-sort-status-error-loading / safe-area / 响应式断点 / 业务动作语义保留；不冻结具体组件选择 / 默认值。详见 §19.6。
14. **schema 策略** — 结构性 wave 零 schema 默认；发现 schema 需求时 STOP 并独立 REQUIREMENT / DESIGN wave；schema wave 与 extraction wave 不混合；独立批准的 schema wave 可对相关领域 schema 做必要修改。详见 §19.10。
15. **每个 wave 的 gate** — 由 AGENTS.md §6.1 按变更类型推导；见 §19.11 表；`pnpm test:heavy` 与 MySQL gate 互相独立。

### 19.13 实施前暂停

本节是 Stage 2 DESIGN 阶段的当前技术设计。任何对 `document.md`、`README.md`、`AGENTS.md`、`CLAUDE.md`、`package.json`、`server/*`、`src/*`、`tests/*`、`deploy/*`、`server/migrations/*`、`server/database/*`、CSS、schema 的修改都不属于本节授权范围；进入 Stage 3 IMPLEMENTATION 前必须由用户独立批准，且按 AGENTS.md §3 / §6 / §7 的顺序单独 wave 推进。

文档引用：本节复用并交叉引用 solution.md §1–§18 与 §3.1（V1.7 P0 前端架构）；§19 不重复 document.md §3–§19 的业务合同与既有实现细节。
