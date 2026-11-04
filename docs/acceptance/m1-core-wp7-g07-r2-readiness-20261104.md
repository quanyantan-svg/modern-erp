# M1-Core WP7-G07-R2 真实 MySQL Gate 执行准备收口证据（2026-11-04）

> 用途：保存 M1C-WP7-G07-R2 的固定 Fixture、独立 Oracle、独立 postflight 与子进程生命周期修复的离线证据，供独立审查。
> Owner：Procurement & Outsourcing Domain Owner；ACK-4 / G07 安全部分由 Platform / Database Safety Owner 联合维护。
> 状态：`IMPLEMENTED / READY_FOR_INDEPENDENT_REVIEW`；CR-01～CR-09、真实 MySQL parity、真实 lock-wait 与 postflight 为 `NOT_RUN`。
> 权威来源：Requirement 为 `docs/requirements/procurement-outsourcing.md §31.13`；Design 为
> `docs/design/procurement-outsourcing-m1-core.md §13.1.1–§13.1.4 / §14 RISK-9` 与 `solution.md §15.1`；
> 项目级当前状态只由 `docs/status/PROJECT_STATUS.md §37.34` 维护。
> 本文件是 Implementation 证据，不是 Gate PASS、Acceptance、Freeze 或 Release 记录。

## 1. 基线、授权与提交

| 项 | 值 |
|---|---|
| Repository / Branch | `quanyantan-svg/modern-erp` / `work/m1-core-rebaseline-20261102` |
| 基线 SHA（已推送 GitHub） | `6a13b1f8a251d9fbd61d17d80e69a08c566406a0` |
| R2 提交 | `6a68e8d`（固定 Fixture / 独立 Oracle / postflight / 子进程生命周期） |
| 版本 / tag | `package.json` `1.6.2` 未变；release tag 未移动、删除或新建 |

用户明确授权本轮**离线实施与验证**；未授权连接 MySQL、签发/消费 ACK-4 capability、执行 Gate、M-15 历史
Migration、destructive SQL、Push、Merge、Tag、Release 或 Deploy。本轮严格保持该边界。

## 2. P0-A 固定内嵌 Fixture

`server/test-support/m1-core-g07-fixtures.js` 取代任意外部 `--fixture-plan`：

- `M1_CORE_G07_FIXED_SCENARIOS` 为 CR-01～CR-09 的固定 handler/method/route/双授权主体/共享资源/具体数量；
- `M1_CORE_G07_TECHNICAL_L2_PREREQUISITES` 枚举不可经业务 HTTP 构造的前置（disposable target 身份/grants、
  `mysql_transaction_gates`、RBAC 测试身份种子、M-15 `identity_key`），不冒充 L1 生产 HTTP 证据；
- `computeM1CoreG07FixtureDigest` + 固定 `M1_CORE_G07_FIXED_FIXTURE_DIGEST` 提供 SHA 摘要；
- `assertFixedFixtureManifest` 在消费 ACK-4 前校验 9 项齐备、摘要一致、无未解析 `$ref`、路由具体、主体/方法合法；
- builder 只执行内嵌 setup 链，无法经 HTTP 构造即 `M1_G07_FIXTURE_SETUP_BLOCKED`。

root（`mysql-m1-core-gate.mjs`）与 launcher（`run-mysql-local-gate.ps1`）已移除 `--fixture-plan` / `-FixturePlan`。

## 3. P0-B 独立 Oracle 与负向控制

`m1-core-g07-contract.js`：

- `assertG07Result` 四不变式：恰一成功 + 恰一指定失败（status/code）、拒绝审计恰 1、胜者幂等恰 1、败方零副作用；
- 补充合同实际断言：`assertSafeIntegerCents`、`assertProcessingPoItemStable`、`assertProcessingPoRejected`、
  `assertUat14VmiReceiptOracle`、`assertG03EvidenceLayering`；
- 负向控制测试证明：双成功、错误 error code、额外幂等/双效果、重复审计、败方副作用均使 oracle FAIL。

`mysql-m1-core-g07.integration.js` 的 `executeRace` 改用 `assertG07Result`，不再以 plan 自供快照作为唯一 Oracle。

## 4. P0-C 独立 postflight 与 ACK-4 状态闭合

- `m1-core-g07-child.mjs` 新增只读 `postflight` 模式：独立只读连接重验目标身份 + `wave10ObjectInventory`
  统计 tables/views/triggers/routines/events 五类对象，不消费 destructive operation。
- root 在 cleanup 后派发独立 postflight 子进程；五类零对象证明通过后才允许 `finalizeAck4Run` 进入 `FINISHED`；
  失败/漂移/不确定/残留 → `CLEANUP_UNVERIFIED` + Quarantine。
- 保持原 M1 四项 manifest；已消费凭据不重用，Recovery 用新独立授权（`recoverAck4Quarantine` 既有）。
- launcher 最终报告读取 root 输出的 ACK-4 `state`，与 root 状态一致。

## 5. P1 子进程生命周期与真实并发证明

- `m1-core-g07-child-lifecycle.mjs`：`hasExited` / `waitForExit` 处理正常/非零/SIGTERM/exit-before-wait 三态。
- `mysql-m1-core-g07.integration.js` `waitForBothTransactions` 改用 `performance_schema.data_lock_waits` 证明
  真实争用同一 `mysql_transaction_gates` FOR UPDATE 事务门；观测不到即 FAIL，不用 `sleep` 猜竞争。
- `scripts/gates/m1-core-g07-child-lifecycle.test.js` 纯多进程测试（不连 MySQL）。

## 6. 离线回归（本轮实际重跑）

| 门禁 | 结果 |
|---|---|
| `pnpm test:fast`（经 `pnpm.cmd`） | 543/543 PASS |
| `pnpm test`（FULL，经 `pnpm.cmd`） | 3270/3270 PASS（399 suites） |
| `pnpm build`（经 `pnpm.cmd`） | PASS |
| `git diff --check` | PASS |
| focused G07/ACK-4/child-lifecycle 离线测试 | PASS |

## 7. NOT_RUN（必须真实 MySQL，本轮未执行）

CR-01～CR-09 真实执行、真实 `information_schema` parity、真实 lock-wait 竞争观测、真实 postflight 零对象证明、
M-15 历史 Migration、MySQL 连接/create/drop/reset、ACK-4 capability 签发/消费、Gate 执行、Push/Merge/Tag/Release/Deploy。

## 8. Gate 执行前独立人工核对清单

1. 固定 Fixture digest `M1_CORE_G07_FIXED_FIXTURE_DIGEST` 经独立复核确认；
2. disposable MySQL target 身份/grants 与 setup 基线一致；
3. `performance_schema` 已启用且 `data_lock_waits` consumer 打开（否则 lock-wait 观测不可用）；
4. 真实 ACK-4 capability 由操作者经独立 issuer 签发，绑定精确 runId/SHA/target/四操作；
5. 技术性 L2 前置（transaction gate、角色种子、M-15 列）已由各自授权路径建立；
6. 逐 CR 的 setup 链请求体与响应字段经真实 MySQL 首跑核验。

```text
M1C_WP7_G07_R2_READY_FOR_INDEPENDENT_REVIEW
```

## 9. M1C-G07-EXECUTION-READINESS-FINAL 最终集成闭环（2026-11-04）

本节追加保存本轮离线 Implementation 证据；文档用途、Owner、状态和权威来源沿用文件头声明。本节不签发
G07 PASS，不把 SQLite Setup 当作 MySQL 并发证明。

### 9.1 提交链与同源 Setup

- 基线：`58a1c2bb587bd51ce918db9821ea347bae9df680`；分支：`work/m1-core-rebaseline-20261102`；
- `efb5e52`：同源正式 Builder、动态业务日期、GET 无 body、逐步状态/DTO/状态/来源校验，以及九项 SQLite HTTP Setup；
- `ad14cbd`：真实 MySQL 全表前后快照 Oracle、A/B waiter 分别归属、请求级拒绝审计及成功/失败键幂等证明；
- `346444c`：ACK-4 消费前静态预检、无 DDL App/Suite 连接、Root/Child/Launcher 全终态及独立 postflight 边界。

九项同源 Setup 实际结果均为 `FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS`：CR-01 初始 PO/排程 10、已占 0；
CR-02 DRAFT 收货 10；CR-03 待检收货 4、WIP 10、IQC PASS；CR-04/05 来源库存 10、WIP 0；
CR-06 WIP 10、来源库存 0；CR-07 两张待检收货各 4、WIP 6、两张 IQC PASS；CR-08 LOT 身份 WIP 1、IQC PASS；
CR-09 RELEASED 委外订单 10、加工费 PO 0。业务主数据和单据均由正式 HTTP 生成；CR-08 物理数量/LOT 也由正式
HTTP 生成，仅匹配估值池经列明的 `SOURCE_INVENTORY_SEED` canonical L2 准入。

### 9.2 Oracle、补充 Oracle 与负向控制

真实调用路径固定为两个 `createApp(existingAdapter)` HTTP App → 正式 route/handler → 已 bootstrap 的 MySQL schema；
Suite 不调用 MySQL `createDatabase()`。每个 CR 读取竞争前/后的权威表完整快照，直接从业务表证明唯一成功效果和败方零
业务效果；成功请求键恰一条 `SUCCEEDED`，失败请求键零条（现行 schema 只允许 `SUCCEEDED`），不再从幂等数量推导败方
副作用。库存腿、WIP、成本、PO Item、拒绝审计、业务来源六类篡改负控均实际 FAIL。

真实 Suite 已注册并将在取得 MySQL/ACK-4 授权后实际运行：Schema Parity、PO Item Stable、通用 PO 注入拒绝、
PO Change ADD/MODIFY/CANCEL 拒绝、UAT-14 VMI create=201/confirm=200、G03 L1/L2 和 Safe Integer cents。

### 9.3 ACK-4、Runner 与治理边界

`assertM1CoreG07StaticPreflight` 在 capability 消费前验证固定 digest、九个 CR、路由/body、环境变量名、主体、L2、
四操作 manifest 和目标证明绑定。App/Suite 只用无 migration/DDL 的 existing adapter；Bootstrap 仍是唯一 schema 初始化操作。
Root 只有 `FINISHED + testsPassed + childrenExited + cleanupProven + exit 0` 才允许 Launcher 返回 0；`UNKNOWN`、`FAILED`、
`CLEANUP_UNVERIFIED` 均非零且隔离保留；未证明全部子进程退出时不进入 destructive cleanup；独立会话核对
tables/views/triggers/routines/events 五类对象均为零。令牌只存在于受限临时 manifest，finally 删除，不写长期日志/报告。

M1-P-03 复核结论：`OUTSOURCING_MANAGE` / `OUTSOURCING_MATERIAL_EXECUTE`、
`OUTSOURCING_RECEIVING_MANAGE`、`IQC_MANAGE` 均有对应非 admin 测试主体；`RECEIPT_NOTICE_MANAGE`、
`PO_CHANGE_MANAGE`、`PROCUREMENT_CONFIG_MANAGE`（以及本 Fixture 所需 `ENGINEERING_BOM_MANAGE`）仍为 admin-only 授权差距。
本轮未扩大正式角色，admin 路径不作为职责分离证据。

### 9.4 本轮离线门禁

| 门禁 | 本轮实际结果 |
|---|---|
| 固定 digest | `2202e6c21142528bd2b21f276abcacbf250af06624a456b84ec12263e15c808c` |
| focused G07 | 30/30 PASS |
| FAST | 546/546 PASS |
| FULL | 3282/3282 PASS（400 suites） |
| Build | PASS（1968 modules） |
| docs current | PASS（N1、N3～N9；N2=`RETIRED`） |
| docs migration | PASS（C1～C6） |
| N7 独立重跑 | PASS |
| `git diff --check` | PASS |

真实 MySQL 连接、CR-01～CR-09 真实并发、真实 information_schema、真实 postflight、ACK-4 签发/消费、Migration
仍为 `NOT_RUN`；Push/Merge/Tag/Release/Deploy 未发生。
