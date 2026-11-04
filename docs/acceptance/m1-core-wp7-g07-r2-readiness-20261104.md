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
