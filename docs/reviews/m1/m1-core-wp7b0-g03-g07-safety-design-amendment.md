# M1-Core WP7-B0 — G03 证据分层与 G07 安全执行 Design Amendment 候选（R1）

> 用途：解决 Active Design §13.1 G03 的 HTTP 可达性争议，并定义 G07 ACK-4 与 CR-01～CR-09 的安全实施合同。
> Owner：Procurement & Outsourcing Domain Owner；数据库破坏性 Gate 条款由 Platform / Database Safety Owner 联合维护。
> 状态：`PENDING_APPROVAL` / `PENDING_REVIEW`，`NOT_AUTHORIZED_FOR_IMPLEMENTATION`。
> 权威来源：Requirement `docs/requirements/procurement-outsourcing.md` §31.13；Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §6 / §13；WP7-A 执行记录 §4.3 / §5。
> 本候选不构成 Current Active Contract，不降低 Gate，不授权 MySQL、Migration、M-15 或破坏性操作。
> **初始来源 SHA**：`8559c03f78898b0b059330f096a4e1bde694f277`
> **R1 审查基线**：`1d67ce8ea34d604c245d95dd42435b4beadf0c26`
> **来源章节**：Requirement §31.13；Active Design §6、§13.1、§13.3；WP7-A §4.3、§5
> **Implementation**：`NOT_AUTHORIZED`
> **Design PASS**：`NOT_ISSUED`

## 1. G03 Mutation Key 证据裁定候选

`issueMaterial`、`supplementMaterial`、`returnMaterial` 通过外部幂等检查后，各自生成服务端
`randomUUID()` 作为内部 `eventId`，再交给 `executeOutsourcingMove()`。合法客户端字段不包含
`eventId` 或物理腿 Mutation Key。因此代码事实为：

1. 合法生产 HTTP 请求当前不能主动触发 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；
2. 每个新业务请求的内部 eventId 唯一；同一外部键的精确重放或异内容冲突，在进入库存 Writer 前已由
   `idempotencyReplay()` 处理；
3. 同端点、同外部键、异内容稳定返回 HTTP 409，但通用幂等 helper 当前没有稳定业务 code；
4. canonical Writer 命中同一 Mutation Key 时会严格比较指纹：异指纹抛 409
   `INVENTORY_MUTATION_UNEXPECTED_REPLAY`，同指纹才返回 replay evidence。库存、跟踪、估值和 mutation log
   位于同一事务，唯一键冲突回滚；未发现“撞键后静默忽略物理腿”的路径；
5. 不得为制造 L1 碰撞而向 HTTP 暴露内部 Mutation Key 或 eventId。

| 层级 | 必须证明的断言 |
|---|---|
| L1 生产 HTTP | 同外部键同内容为 200 replay 且无第二次动作；同键异内容为稳定 409 且业务事实逐字段零变化；不同外部键各获唯一内部 eventId；实际物理腿数等于预期腿数 |
| L2 canonical inventory primitive | 同一五字段 Mutation Key：同指纹只 replay；异指纹 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；无物理腿、跟踪、估值或 mutation log 部分写入 |

L1 不冒充能触发内部碰撞，L2 不替代真实 HTTP 正向通路。若 Owner 要求 L1 同键异内容也有精确 code，候选为
`OUTSOURCING_MATERIAL_IDEMPOTENCY_CONFLICT`；该行为变化仍须独立 Implementation 授权。

## 2. ACK-4 授权真实性合同（R1-01）

### 2.1 批准事实与机器凭据分离

ACK-4 必须同时存在两类不同证据，任何一类都不能替代另一类：

- **治理批准事实**：用户或受授权操作者在 Gate 外显式发起，记录批准主体、批准渠道/引用、原文摘要、
  UUIDv4 完整 `runId`、完整 commit SHA、精确目标身份、精确操作集合、`issuedAt`、`expiresAt`。Gate、测试、launcher
  不得自行签发、推断批准、重置批准或把“读到本 Prompt/环境变量”视为批准。
- **运行时机器校验凭据**：由操作者显式运行独立 issuer 后生成的一次性随机 capability，并以 Windows
  CurrentUser DPAPI + 当前用户 ACL 保存；metadata 与治理批准引用绑定。普通可编辑 JSON、环境变量、run ID
  或 approval 文本本身都不是可信机器凭据。issuer 只把已发生的批准转成机器可消费凭据，不拥有批准权。

记录不得包含密码、Token、DPAPI 明文、连接串 secret 或环境变量快照。目标身份必须精确绑定：

```text
mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test
+ SELECT DATABASE()
+ CURRENT_USER()
+ server_uuid
+ grants SHA-256
```

完整 SHA 必须等于 `git rev-parse HEAD`，工作树必须干净；GitHub/Gitee SHA 是只读核验项，不因 ACK 自动写远端。

### 2.2 威胁模型与明确限制

该机制防止误操作、凭据重放、并发双启动、目标/SHA 漂移和普通直接 Node 绕过。它**不把同一 Windows OS
用户视为对抗性安全边界**：同一用户可读自身文件、运行 issuer、调试进程或修改本地代码，DPAPI/ACL 不能证明
其没有恶意篡改。故治理批准记录仍是授权事实，机器凭据只承担运行时 fail-closed 与一次性约束；不得宣称
“不可篡改”“密码学证明批准主体”或“抵御本机管理员”。若需要抵御同用户恶意行为，必须另引入外部签名服务、
第二主体审批或隔离执行身份，超出本候选范围。

### 2.3 校验时点与精确操作清单

只读 target preflight 可以在消费前执行。Node 根 orchestrator 必须在**首次数据库写入之前**原子消费 ACK-4，
建立 run lease；随后才可获得写路径。这里的“写入”包括 DML、current Schema bootstrap、DDL、DROP、重建和清理。
不得从当前环境变量自动构造“已批准”授权。

M1-Core 单次 run 只允许以下有序集合，不接受通配符或追加：

1. `RESET_SCHEMA_PRE_RUN`：仅删除精确目标 schema 内经 inventory 枚举的对象；
2. `BOOTSTRAP_CURRENT_SCHEMA`：仅建立该 SHA 的 canonical current schema；
3. `RUN_M1_HTTP_FIXTURES`：仅由列入 manifest 的生产 HTTP Handler 建立/变更测试业务对象；
4. `CLEANUP_SCHEMA_POST_RUN`：仅删除同一目标本次 run 后的 schema 对象并证明零对象。

M1 run 不允许 `CREATE/DROP DATABASE`、用户/权限变更、M-15、任意 Migration、手写正向业务 SQL、其他 Gate 或
任意脚本注入。

## 3. 一次性消费、多进程与 Cleanup 状态机（R1-02）

### 3.1 状态机

```text
ISSUED --原子消费--> CONSUMED --测试成功且 cleanup 已证明--> FINISHED
                              |--测试/启动失败且 cleanup 已证明--> FAILED
                              `--崩溃、失联、残留或 cleanup 不能证明--> CLEANUP_UNVERIFIED
```

- `ISSUED`：尚未消费。缺失、格式错误、已过 `expiresAt`、SHA/target/operations/approval 引用不匹配均保持
  不可消费并 BLOCKED；过期不自动续期、不自动重发。
- `CONSUMED`：只允许一个根 orchestrator 持有。先取得本机命名 mutex，再以独占文件句柄 + 原子 rename/CAS
  把 capability 从 issued store 移至 consumed store；任一步失败都不得写数据库。
- `FINISHED`：测试成功、cleanup 成功且 postflight 证明 schema 零对象。
- `FAILED`：测试或启动失败，但 cleanup 成功且零对象已证明；同一授权仍不可再用。
- `CLEANUP_UNVERIFIED`：根进程崩溃、子进程失联、cleanup 失败、目标漂移或无法证明零对象。目标写入 quarantine
  marker，任何新 Gate 即使有新 ACK 也 BLOCKED，直至只读检查完成并取得**新的、单独的人工恢复授权**。

不存在 `CONSUMED → ISSUED`、续租成第二次 run、失败后重新启动测试或复用 cleanup 权限的转移。

### 3.2 15 分钟、run lease 与子进程

- 15 分钟约束 `issuedAt → 原子消费开始`，即启动窗口；消费完成后不因测试跨过 15 分钟而中途撤销数据库事务。
- run 本身受独立最大运行时长和进程存活监控约束；不得自动延长授权。超时后停止派发新测试动作，只允许进入
  本 run 的既定 cleanup。
- 根 lease 绑定 run ID、完整 SHA、目标身份、根 PID + 进程启动时间、Windows 用户 SID、随机 nonce、操作集合
  和 runner manifest。它不是批准签发权。
- 子进程/独立 MySQL session 只获得根进程登记的、操作子集化的 child lease；通过继承句柄/受 ACL 保护的临时
  capability 与父进程握手，不把 issuer capability 放入普通环境变量。子进程不能签发、消费或扩展授权。
- 根进程持续登记子 PID/启动时间和 session 身份。子进程不属于登记进程树、根进程死亡、target/SHA 漂移、
  child lease 重放或操作超集，一律拒绝写入。
- 这些进程树校验仍受 §2.2 同 OS 用户限制，不宣称抵御恶意伪造；其目的为防误用、重放和并发双消费。

### 3.3 失败与 cleanup

消费后的授权只允许本次既定 cleanup，且 cleanup 权限不因 15 分钟启动窗口到期而失效。cleanup 前必须先证明
所有登记子进程已退出；无法证明时不得与未知写进程并发 DROP，直接进入 `CLEANUP_UNVERIFIED`。cleanup 最多执行
一次完整尝试，不得借此重新 bootstrap 或启动测试。cleanup 失败、进程崩溃或部分 Schema 遗留时 fail closed：
保留非 secret run 记录和对象 inventory，隔离目标；后续操作者先只读确认，再以新的 run ID、精确恢复操作集合和
单独人工批准执行 recovery。恢复成功只关闭残留，不复活旧授权。

## 4. destructive 入口与授权覆盖矩阵（R1-01/R1-02）

下表是审查基线 `1d67ce8` 的 Gate/diagnostic 可达入口清单。Implementation 必须一次性完成保护或保持拒绝；
不得只保护 PowerShell launcher，也不得因接入 ACK-4 放松既有 target、least privilege、空 schema 或 live identity
检查。未完成 manifest/兼容验证的入口保持 BLOCKED，不得半迁移上线。

| 现有入口/primitive | 当前破坏能力 | ACK-4 后方案 |
|---|---|---|
| `run-mysql-local-gate.ps1` | 可向任意 package script 注入 ACK-1～3 环境 | 改为固定 allowlist launcher；只传 run ID/child bootstrap，不能签发批准；无已消费根 lease 拒绝 |
| `setup-mysql-local-gate.ps1` | 不执行 DROP；可显式 `-ForceBaseline` 改本机 identity baseline | 保持独立 setup 合同；不签发 ACK-4，不得作为 G07 run；baseline 改动仍需显式操作者动作 |
| `mysql-gate.mjs`、`mysql-concurrency-gate.mjs`、`mysql-finance-concurrency-gate.mjs` | 各自直接枚举并 DROP TABLE；后者 guard 较弱 | 移除/封闭自有 DROP，接入共同 lease primitive；直接 Node 无 lease 拒绝；各自 operation manifest 未批准前 BLOCKED |
| `mysql-sales-wave7-gate-a.mjs` | 调 `resetAuthorizedDisposableMySqlSchema()` | central primitive 同时要求 ACK-1～4；Gate 行为测试保持，不能接受 M1 lease 冒充其 manifest |
| Wave10/11/Inventory runners → `mysql-wave10-runner-support.mjs` / `resetWave10CampaignSchema()` | DROP event/trigger/view/table/routine/function；现有 base64 child lease 可由本机用户构造 | 保留既有身份/权限/零对象检查并叠加根/child lease；现有 Gate 各有精确 manifest；直接 child/Node 拒绝 |
| `server/test-utils/temp-db.js` → `resetAuthorizedDisposableMySqlSchema()` | suite 创建/清理时 DROP view/table | primitive 校验登记 child lease、target、operation；直接 `node --test` 无 lease 在首次写入前拒绝 |
| `mysql-phase7c-performance.mjs`、`mysql-phase7c-full-benchmark.mjs` | 自建表并在结束或开始时 DROP 全表 | 不属于 M1 manifest；迁移到独立 ACK-4 manifest 前保持直接执行 BLOCKED，不得继承 M1 run |
| Migration/upgrade suites 与 migration CLI | 可能执行表级 DDL/DROP | 明确排除于 M1 ACK；需要各自 Migration/upgrade 授权。M1 lease 出现在该入口时拒绝，而非放行 |
| 新 `mysql-m1-core-gate.mjs` | 预清理、current schema bootstrap、HTTP fixture、后清理 | 唯一 M1 root consumer；只接受 §2.3 四项操作和固定 suite manifest；所有写 primitive 再校验 active lease |

全局 primitive 改造属于现有 MySQL Gate 安全合同变化，须 Database Safety Owner 批准。兼容目标是“原 Gate 的
业务套件与保护条件不变，额外增加一次性批准前置”，不是继续接受旧环境变量作为 ACK-4。若任一旧入口不能安全
迁移，实施必须 fail closed 并停止该入口，而不是留下绕过路径。

## 5. M1-Core 专用 Gate 入口候选

批准并实现后建议新增：

```text
pnpm test:mysql:m1-core -- --run-id <uuid-v4>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 \
  -Script test:mysql:m1-core -RunId <uuid-v4>
```

Node 入口 `scripts/gates/mysql-m1-core-gate.mjs` 只注册 M1-Core schema parity、真实 HTTP Handler 多 session 竞态和
SQLite/MySQL 对等套件。不得运行基于 `race_probe_generic` 的既有采购委外并发套件，不得用 SQL 造正向业务单据。
SQL 仅可做只读快照、同步观测，或设置没有生产写入口且合同明确允许的 L2/L3 前置；不能冒充 L1。

## 6. CR-01～CR-09 确定性执行矩阵（R1-03）

所有正向对象由生产 HTTP 创建；每项至少两个独立应用进程/数据库 session。同步控制 session 先持有
`mysql_transaction_gates(gate_id=1) FOR UPDATE`，再同时发出两条真实 HTTP；通过 `performance_schema` lock-wait
与请求在途状态证明两者均已到达事务门，随后释放控制锁。生产 `transaction()` 在事务内重读权威状态，因此先获锁
者提交后，后获锁者必须看到新状态。不以 `sleep` 猜测竞争。胜者身份可以不确定，但“恰一成功 + 恰一指定失败 +
最终快照”必须唯一；控制 SQL 只做同步，不创建或修改业务对象。

### 6.1 CR-01 修订结论

原“`confirmReceiptNotice()` 与 `convertReceiptNoticeToReceipts()` 竞争同一新增容量”不成立：通知创建时已把
allocation 计入 PO 行/交期 outstanding reservation；转换只增加 `converted_quantity` 并形成对应 receipt，不增加
该 reservation 的 `usedQuantity`。而同一通知从 DRAFT 确认与转换也没有共同合法初始状态。因此 CR-01 改为：

- 权威资源：同一 `purchase_order_items.id=P1` 与同一 `delivery_schedules.id=S1`；两者初始容量均 10、已用 0。
- 两条真实调用：两个独立 session 同时 `POST /api/receipt-notices`，在 body 使用不同 `idempotencyKey`，各请求对
  P1/S1 分配数量 6。
- 唯一结果：一个 201；另一个 409 `RECEIPT_NOTICE_CAPACITY_EXCEEDED`。
- 成功快照：恰一 DRAFT 通知、通知行与 source allocation=6；PO 行/交期 outstanding reservation=6，ledger
  consumption=0；无采购收货、库存、跟踪、估值、AP 或凭证；成功审计恰一。
- 失败快照：无第二通知/行/source/idempotency result，无容量或库存变化；拒绝审计按合同恰一。

### 6.2 完整矩阵

| CR | 两条真实 HTTP / 相同权威资源 | 初始数量与唯一预期 | 失败 status/code | 必核快照 |
|---|---|---|---|---|
| CR-01 | 两次 `POST /api/receipt-notices`；同 P1/S1 | capacity=10；6 vs 6；恰一 201 | 409 `RECEIPT_NOTICE_CAPACITY_EXCEEDED` | §6.1 的通知/source、PO 行、交期 ledger、库存/财务零副作用与审计 |
| CR-02 | 两次 `POST /api/purchase-receipts/:id`；同一 DRAFT receipt，不同 Key | receipt qty=10；恰一 200 | 409 **新增** `PURCHASE_RECEIPT_ALREADY_CONFIRMED` | receipt 状态、PO 累计量、库存/跟踪/估值、AP/凭证、幂等、成功/拒绝审计各唯一 |
| CR-03 | 两次 `POST /api/procurement/outsourcing/receipts/:id/confirm`；同一 PENDING_INSPECTION receipt，不同 Key | finished qty=4、WIP 足量；恰一 200 | 409 `OUTSOURCING_RECEIPT_ALREADY_EFFECTED` | 成品、倒冲、估值、成本、状态/version、幂等、审计均只一份 |
| CR-04 | 两次 `POST /api/procurement/outsourcing/orders/:id/issues`；同 material row + source position identity | source=10；6 vs 6；恰一 201 | 409 **新增** `OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT` | source=4、WIP=6；一张 issue；MOVE 两腿、跟踪、估值、WIP effect、幂等/审计唯一；失败全零 |
| CR-05 | 两次 `POST /api/procurement/outsourcing/orders/:id/supplements`；同 material row + source position identity | source=10；6 vs 6；恰一 201 | 409 **新增** `OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT` | source=4、WIP=6；一张 supplement；物理腿/跟踪/估值/WIP/幂等/审计唯一；失败全零 |
| CR-06 | 两次 `POST /api/procurement/outsourcing/orders/:id/returns`；同 material row + WIP identity | WIP=10；6 vs 6；恰一 201 | 409 `OUTSOURCING_WIP_INSUFFICIENT` | WIP=4、source 回入=6；一张 return；身份余额、腿、估值、幂等/审计唯一 |
| CR-07 | 两个不同 receipt 各调用 `POST .../receipts/:id/confirm`；同 order/material row/WIP identity | order=10、per-unit=1、WIP=6；两张各 qty=4 且均已 IQC PASS；恰一 200 | 409 `OUTSOURCING_WIP_INSUFFICIENT` | 恰一 EFFECTED/一张仍 PENDING_INSPECTION；backflush=4、WIP=2、成品=4；材料价值仅消费 4，成品成本=材料实际成本+胜者加工费；失败单据业务/库存/估值/成本全零，拒绝审计一条 |
| CR-08 | 一次 receipt confirm 与一次 `POST .../orders/:id/returns`；同 LOT/SERIAL WIP identity | identity WIP=1，BOM backflush=1，return=1；恰一成功 | 另一方 409 `OUTSOURCING_WIP_INSUFFICIENT` | identity 余额不负且总量守恒；若 confirm 胜则成品/成本一份，若 return 胜则 source 回入一份；败方全零 |
| CR-09 | 两次 `POST /api/procurement/outsourcing/orders/:id/processing-fee-purchase-orders`；同 RELEASED order，不同 Key | 恰一 201 | 409 `OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS` | 恰一 PO、恰一稳定 PO Item、同源 PO 终身唯一、成功幂等/审计一份、拒绝审计一份 |

CR-07 的两张合法前置单据可由生产 HTTP 完整建立：创建/下达委外订单与材料快照、创建并审批加工费 PO、分别创建
并确认两张 OUTSOURCE 完工通知、分别创建两张委外收货、分别创建并完成 IQC 为 PASS。不得直接 INSERT 正向单据。
如果实现审查发现上述 HTTP 链无法产生两张合法待检收货，CR-07 必须 BLOCKED 并返回 Design 裁定；不得用 CR-03
的同收货重复确认冒充独立 CR-07。

### 6.3 新 error code 的最小触发位置

- CR-02：在 `confirmPurchaseReceiptCore()` 事务内重读 `purchase_receipts` 后，若状态已为 `CONFIRMED`，抛
  409 `PURCHASE_RECEIPT_ALREADY_CONFIRMED`；其他非法状态保持既有状态语义。`confirmPurchaseReceipt()` 的
  rejection-audit code allowlist 必须精确纳入该新 code，确保败方恰一拒绝审计，不扩大其他采购拒绝的审计语义。
- CR-04/05：在 `applyInventoryMutation()` 的权威 source position 锁定和 `current < quantity` 检查处，允许调用方
  显式传入一个受限 insufficient-stock code；只有 `executeOutsourcingMove()` 的 SUPPLY 路径传
  `OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT`。默认调用方仍保持既有 409/message 行为，避免改变普通采购、
  库存等其他业务语义。不得在上层按 message substring 翻译。

三项 code 均属未来 Implementation，尚未授权；缺 code 时相应 CR 为 BLOCKED，不得以 message substring 或宽泛
409 判 PASS。

## 7. Schema parity 与逐字段快照

真实 MySQL `information_schema` 与 SQLite 双向对等断言至少覆盖：

- `receipt_notice_items` / `receipt_notice_item_sources` 的数量、转换量、交期、来源约束；
- `outsourcing_receipts` / `outsourcing_receipt_items` 的明细、状态、通知/加工费 PO Item 来源、金额和版本；
- `purchase_orders.source_outsourcing_order_id` 的 NULL 语义与非 NULL 终身唯一索引；
- `inventory_mutation_log` evidence/fingerprint/唯一键；
- `outsourcing_wip_identity_balances` 与未来 `tracked_inventory_movements.identity_key` 的身份唯一性；
- 幂等、审计、库存/跟踪/估值、成本证据的 FK、CHECK、UNIQUE 与安全整数类型；
- `mysql_transaction_gates` 单例行和真实事务重试/回滚合同。

拒绝场景快照覆盖业务头/行、状态/version、库存 position/transaction、跟踪、估值 movement/balance、WIP identity、
幂等、审计、PO/Item、通知/交期、成本/AP/凭证。业务事实逐字段不变；拒绝审计按合同新增恰一条。

## 8. M-15 条件依赖（R1-04）

### 8.1 A — 全新 disposable MySQL

当前基线明确尚未实现 M-15，且现有 schema parity 测试明确断言 `tracked_inventory_movements` **没有**
`identity_key`。因此在 M-15 Implementation 获批并进入 canonical current schema 前，涉及该字段/唯一索引的 G07
parity 断言保持 BLOCKED。

未来实现获批后，全新、空的 disposable schema 可以直接由该 SHA 的 canonical current-schema bootstrap 建立目标
列、约束和索引，并在零历史行上验证结构、正向新写入、并发唯一性及 cleanup。Gate 不得为了测试而调用历史
Migration/M-15 命令；空表 PRE-A/B/C 的 0 行结果只说明本次空库无历史冲突，**不证明**真实历史迁移已经完成。

### 8.2 B — 现有历史数据库

任何已有 `tracked_inventory_movements` 历史行的数据库都必须另获 Migration 与 destructive 授权，按 Active Design
§4.4/§4.4.1 执行真实数据 PRE-A → additive column → 确定性规范化 → PRE-B/PRE-C → unique index，并保存
真实行数、冲突标识、DDL/index、前后校验和 rollback/重试证据。不明身份、双身份、缺来源、策略不一致或撞键即停；
不得删、并、伪造、覆盖非空 identity 或无条件归为 `NONE`。

因此依赖关系为：

```text
Owner 批准本 Design
  → 独立授权 ACK-4 / error-code / M1 Gate Implementation
  → M-15 Implementation 另行批准并进入 canonical schema
      → A: 空 disposable 只做 current schema 初始化与 G07（不签发历史 Migration PASS）
      → B: 历史库须再获单独 Migration + destructive 授权并完成真实 PRE-A/B/C
```

G07 的一次性空库结果不得外推为任何项目历史数据库已迁移；也不得因为 G07 需要而自动运行 M-15。

## 9. 待批准事项与暂停点

1. Domain Owner 批准 G03 L1/L2 分层、CR-01 替代场景、CR-07 唯一 oracle 与 CR-02/04/05 code 合同；
2. Platform / Database Safety Owner 批准 ACK-4 的 issuer、一次性状态机、进程树/cleanup/quarantine 和全入口
   fail-closed 改造；
3. 独立 Implementation Authorization：ACK-4、M1 runner、真实 Handler races、schema parity 与三项 error code；
4. M-15 Implementation 与历史 Migration 分别批准；不得合并为 G07 测试准备；
5. 实现、无数据库单测和独立安全审查通过后，再由用户对一个精确 run ID/SHA/target/operations 单独批准 MySQL Gate。

当前结论：`G07 = NOT_RUN`，`ACK-4 = NOT_IMPLEMENTED`，`M-15 = NOT_AUTHORIZED`，本候选
`NOT_AUTHORIZED_FOR_IMPLEMENTATION`。本轮不签发任何 Gate PASS、Acceptance 或 Freeze。
