# M1-Core WP7-B0 — G03 证据分层与 G07 安全执行 Design Amendment 候选

> 用途：解决 Active Design §13.1 G03 的 HTTP 可达性争议，并定义 G07 ACK-4 与 CR-01～CR-09 的安全实施合同。
> Owner：Procurement & Outsourcing Domain Owner；数据库破坏性 Gate 条款由 Platform / Database Safety Owner 联合维护。
> 状态：`PENDING_APPROVAL` / `PENDING_REVIEW`，`NOT_AUTHORIZED_FOR_IMPLEMENTATION`。
> 权威来源：Requirement `docs/requirements/procurement-outsourcing.md` §31.13、Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §6 / §13、WP7-A 执行记录 §4.3 / §5。
> 本候选不构成 Current Active Contract，不降低 Gate，不授权 MySQL、Migration、M-15 或破坏性操作。
> **来源 SHA**：`8559c03f78898b0b059330f096a4e1bde694f277`
> **来源章节**：Requirement §31.13；Active Design §6、§13.1、§13.3；WP7-A §4.3、§5
> **Implementation**：`NOT_AUTHORIZED`
> **Design PASS**：`NOT_ISSUED`

## 1. G03 Mutation Key 证据裁定候选

`issueMaterial`、`supplementMaterial`、`returnMaterial` 通过外部幂等检查后各自生成服务端 `randomUUID()`，
作为内部 `eventId` 交给 `executeOutsourcingMove()`；客户端允许字段不含 `eventId` 或物理腿 Mutation Key。
因此代码事实为：

1. 合法生产 HTTP 请求当前不能触发 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；
2. 新业务请求的内部 eventId 每次唯一；同一外部键的精确重放或异内容冲突在进入库存 Writer 前已被
   `idempotencyReplay()` 截获；
3. 同一端点、同一外部幂等键、不同内容稳定返回 HTTP 409，但通用幂等 helper 当前没有稳定 error code；
4. 内部 Writer 命中同一 Mutation Key 时会比较严格指纹：不一致抛 409
   `INVENTORY_MUTATION_UNEXPECTED_REPLAY`，一致才返回 replay evidence。库存、跟踪、估值和 mutation log 在
   同一事务中，唯一键冲突回滚；未发现“撞键后静默忽略物理腿”的路径；
5. 不得为了制造 L1 碰撞而把内部 Mutation Key 或 eventId 暴露给 HTTP。

建议只修订证据层，不降低业务标准：

| 层级 | 必须证明的断言 |
|---|---|
| L1 生产 HTTP | 同外部键同内容 200 replay 且无第二次动作；同键异内容稳定 409 且业务事实逐字段零变化；不同外部键各获唯一内部 eventId；实际腿数等于预期腿数 |
| L2 canonical inventory primitive | 同一五字段 Mutation Key：同指纹只 replay；异指纹 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；无物理腿、跟踪、估值或 mutation log 部分写入 |

L1 不冒充能触发内部碰撞，L2 不替代真实 HTTP 正向通路。若 Owner 要求 L1 同键异内容也有精确 code，建议
统一新增 `OUTSOURCING_MATERIAL_IDEMPOTENCY_CONFLICT`；该行为变化仍须独立 Implementation 授权。

## 2. ACK-4 最小实现合同候选

### 2.1 风险

现有 launcher、preflight、固定 target contract 与 `assertAuthorizedDisposableMySqlTarget()` 已覆盖目标名提示、
精确身份、允许操作集合、实时身份和空 schema（ACK-1～3）。但授权值是可重复设置的环境变量；直接运行
`pnpm test:mysql:concurrency` 可进入 Node Gate，且 `mysql-concurrency-gate.mjs` 自有 DROP 实现。现状无法证明
“本次、此 SHA、此目标获得用户一次性批准”，故 ACK-4 维持 `NOT_IMPLEMENTED`。

### 2.2 授权记录与一次性消费

每次运行必须在当前用户 `%LOCALAPPDATA%/ModernERP/mysql-gate/acks/` 建立非仓库授权记录：

- `runId`：UUIDv4；
- `commitSha`：40 位 SHA，等于运行时 `git rev-parse HEAD`，且工作树干净；
- `targetIdentity`：精确为 `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`，并绑定
  baseline 的 server UUID、current user、grants SHA-256；
- `operations`：精确、有序的
  `DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP`；禁止通配或追加；
- `issuedAt` / `expiresAt`：UTC；有效期 15 分钟且不得自动续期；
- `approvalStatement`：用户明确批准的原文摘要、渠道和时间；不得把阅读 prompt 推断为批准；
- `state`：`ISSUED` / `CONSUMED` / `EXPIRED`，含消费时间和消费 SHA；
- 不写密码、DPAPI 明文、Token、secret 连接信息或环境变量快照。

建立与消费使用排他创建/原子 rename；run ID 只能从 `ISSUED` 原子变为 `CONSUMED` 一次。缺失、过期、已用、
格式错、目标漂移、SHA 不符、工作树不净、操作集合或 baseline 不等，一律在首次 DROP 前 `BLOCKED`。

### 2.3 防绕过

- PowerShell 只取得凭据、做只读 preflight/互斥和传 run ID，不能是唯一检查点；
- Node 顶层 M1-Core Gate 自行读取并原子消费 ACK-4，再建立仅本进程有效的 run lease；
- 所有 DROP/重建/cleanup 进入同一 destructive primitive；该 primitive 验证 ACK-1～4 和实时
  `SELECT DATABASE()`；现有自有 DROP 路径必须收敛或拒绝；
- 直接 `node ...`、`pnpm test:mysql:concurrency` 或测试文件时，无未消费 ACK-4/run lease 必须 BLOCKED；
- 失败后授权不恢复；cleanup 使用同一 lease/目标；日志只输出非 secret 元数据。

把 ACK-4 放入全局 primitive 会改变所有 MySQL Gate 的安全合同，必须先获 Domain Owner 与 Database Safety
Owner 批准，再实施兼容迁移及 fail-closed 测试。本轮不得修改全局策略。

## 3. M1-Core 专用入口候选

批准后建议新增：

```text
pnpm test:mysql:m1-core
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 \
  -Script test:mysql:m1-core -RunId <uuid-v4>
```

Node 入口 `scripts/gates/mysql-m1-core-gate.mjs` 只注册 M1-Core schema parity、真实 HTTP Handler 多会话竞态和
SQLite/MySQL 对等套件。不得运行基于 `race_probe_generic` 的既有采购委外并发套件，也不得用 SQL 构造正向
业务单据。SQL 只可读快照或设置没有生产写入口且合同明确允许的 L2/L3 前置，不能冒充 L1。

## 4. CR-01～CR-09 执行矩阵候选

前置业务对象均由生产 API 创建；每项由至少两个独立 MySQL connection/session 经同步闸门释放真实 HTTP
请求，并保存成功/拒绝 HTTP、error code、审计、幂等和逐字段快照。

| CR | 真实 Handler / route | 两会话竞争与精确预期 | 逐字段结果 |
|---|---|---|---|
| CR-01 | `confirmReceiptNotice`；`convertReceiptNoticeToReceipts` | 竞争同一交期/PO 行容量；一方 200/201，另一方 409 `RECEIPT_NOTICE_CAPACITY_EXCEEDED` | 交期台账、通知来源/转换量、入库、幂等；拒绝审计恰好 1 条 |
| CR-02 | `confirmPurchaseReceipt`；`POST /api/purchase-receipts/:id` | 不同 Key 确认同一 DRAFT 收货；一方 200，另一方 409；实施前须补稳定 `PURCHASE_RECEIPT_ALREADY_CONFIRMED` | PO 累计量、库存/跟踪/估值、AP/凭证、状态、幂等、审计无重复；未补 code 则 BLOCKED |
| CR-03 | `confirmOutsourcingReceipt` | 不同 Key 生效同一待检收货；一方 200，另一方 409 `OUTSOURCING_RECEIPT_ALREADY_EFFECTED` | 成品、倒冲、估值、成本、状态、幂等、审计 |
| CR-04 | `issueMaterial` | 两发料竞争不足以同时满足的同一来源仓/身份；一方 201，另一方 409；实施前补 `INVENTORY_INSUFFICIENT` | MOVE OUT+IN、跟踪、估值、WIP、物料行、幂等、审计 |
| CR-05 | `supplementMaterial` | 同 CR-04 的补料 Handler；一方 201，另一方 409 `INVENTORY_INSUFFICIENT`（候选） | 补料单、来源仓/WIP、物理腿、跟踪、估值、幂等、审计 |
| CR-06 | `returnMaterial` | 两退料竞争只够一方消费的同一 WIP 身份；一方 201，另一方 409 `OUTSOURCING_WIP_INSUFFICIENT` | 退料、WIP/来源仓、身份余额、腿/估值、幂等、审计 |
| CR-07 | `confirmOutsourcingReceipt` 倒冲腿 | 竞争同一物料行增量可消费量；必须在实施时固定为“同收货重复生效”或“不同收货争 WIP”之一及唯一 code | `target cumulative - already backflushed` 只消费一次；成品/成本原子 |
| CR-08 | 倒冲腿与 `returnMaterial` | 竞争同一 LOT/SERIAL 余额；一方成功，另一方 409 `OUTSOURCING_WIP_INSUFFICIENT` | 身份余额非负守恒；跟踪、库存、估值和业务行一致 |
| CR-09 | `createOutsourcingProcessingPurchaseOrder` | 不同 Key 对同一 RELEASED 订单创建；一方 201，另一方 409 `OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS` | 恰好一 PO/Item/成功审计/幂等；拒绝审计 1 条；UNIQUE 兜底 |

CR-02/04/05 当前缺精确稳定 code；不能用消息文本或宽泛 409 冒充满足。CR-07 不能写二选一软断言。
加工费 PO 还须经真实 `PUT /api/purchase-orders/:id` 证明 Item ID、来源、产品、数量、UOM/换算原位稳定；
通用 PO 类型注入、来源篡改及 PO Change ADD/MODIFY/CANCEL 必须精确拒绝。

## 5. Schema parity 与快照

真实 MySQL `information_schema` 与 SQLite 双向对等断言至少覆盖：

- `receipt_notice_items` / `receipt_notice_item_sources` 的数量、转换量、交期、来源约束；
- `outsourcing_receipts` / `outsourcing_receipt_items` 的明细、状态、通知/加工费 PO Item 来源、金额和版本；
- `purchase_orders.source_outsourcing_order_id` 的 NULL 语义与非 NULL 终身唯一索引；
- `inventory_mutation_log` evidence/fingerprint/唯一键；
- `outsourcing_wip_identity_balances` 与 `tracked_inventory_movements.identity_key` 的身份唯一性；
- 幂等、审计、库存/跟踪/估值/成本证据的 FK、CHECK、UNIQUE 与安全整数类型。

拒绝场景快照覆盖业务头/行、状态/version、库存 position/transaction、跟踪、估值 movement/balance、WIP
identity、幂等、PO/Item、通知/交期、成本/AP/凭证。业务事实逐字段不变；拒绝审计按合同新增 1 条。

## 6. M-15 / TC-01 前置

M-15 须另获 Migration 与 destructive 授权，并在严格身份证据前完成：

1. PRE-A：读取真实产品 tracking policy、lot/serial、source item 和潜在冲突；不明即停；
2. additive 加列且不覆盖既有非空 `identity_key`；
3. 只按产品策略生成 `LOT:<lot_id>`、`SERIAL:<serial_id>` 或可证明 `NONE`；禁止无条件 ELSE NONE；
4. PRE-B：联合核对策略、lot/serial 和生成键；缺失、双身份、冲突即停；
5. PRE-C：检测严格唯一键撞键、重复来源项和索引可建性；不得删、并、伪造、改写历史；
6. PRE 全通过才建唯一索引；SQLite/MySQL DDL、NULL、重放语义对等；失败时相关写入继续 fail closed；
7. 保存真实行数、冲突标识、DDL/index definition、前后校验和及 rollback/重试证据。

## 7. Disposable MySQL 安全准备与待批准项

- Owner 批准本候选并完成 Active Design Promotion；
- Database Safety Owner 批准 ACK-4 的全局安全合同变化；
- 无数据库单测证明缺失/过期/已用/漂移/SHA 不符/工作树不净全部 BLOCKED；
- 实现真实 Handler、多 connection、精确 oracle、逐字段快照和 schema parity；
- 独立批准并完成 M-15 PRE-A/B/C；
- 执行前重核本地/GitHub/Gitee SHA、target baseline、DPAPI credential、least privilege、空 schema 和互斥锁；
- 用户对单次 run ID、SHA、目标、操作集合、有效期明确批准；然后再单独授权运行 G07。

Owner 还须裁定 G03 L1/L2 分层、是否补齐所有 L1 精确 code，以及 CR-07 的唯一 oracle。在此之前：
`G07 = NOT_RUN`，`ACK-4 = NOT_IMPLEMENTED`，不得执行 MySQL Gate。
