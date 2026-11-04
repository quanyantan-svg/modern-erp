# M1-Core WP7-R1 收口证据（2026-11-04）

> 用途：保存 M1C-WP7-R1 的历史修正、G07 生命周期收口、N7 提交追溯前置治理与回归耗时优化的证据，供独立审查。
> Owner：Procurement & Outsourcing Domain Owner；ACK-4 / G07 安全部分由 Platform / Database Safety Owner 联合维护。
> 状态：`IMPLEMENTED / READY_FOR_INDEPENDENT_REVIEW`；CR-01～CR-09、真实 MySQL parity、历史 M-15 Migration 为 `NOT_RUN`。
> 权威来源：Requirement 为 `docs/requirements/procurement-outsourcing.md §31.13`；Design 为
> `docs/design/procurement-outsourcing-m1-core.md §4.4 / §9.3 / §13.1.1–§13.1.4 / §14` 与 `solution.md §15.1`；
> 项目级当前状态只由 `docs/status/PROJECT_STATUS.md §37.33` 维护。
> 本文件是 Implementation 证据，不是 Requirement、Design、Gate PASS、Acceptance、Freeze 或 Release 记录。

## 1. 基线、授权与提交

| 项 | 值 |
|---|---|
| Repository / Branch | `quanyantan-svg/modern-erp` / `work/m1-core-rebaseline-20261102` |
| 起始 SHA（重写前） | `59dec19ec4f80b83db49ca07bb978ce159947b64`（§37.32 最终证据提交，最终 HEAD N7 FAIL） |
| 历史修正后 Combined 末提交 | `1a59b41025f5dbc4eddf59dc8a5977192d0aac80` |
| R1 新增提交 | `a16b021`（N7 提交追溯前置治理）、`9c20e60`（G07 根运行器与子租约生命周期收口）、`4f20900`（N7 回归耗时优化） |
| 备份分支 | `backup/m1c-wp7-combined-pre-r1-59dec19`（保留重写前历史） |
| Hook | `core.hooksPath = .githooks` 已本地激活 |
| 版本 / tag | `package.json` `1.6.2` 未变；既有 release tag 未移动、删除或新建 |

用户明确授权：§37.32 遗留的最终 HEAD N7 blocker 的**消息级本地历史修正**（仅重建 `59eccd5`、`59dec19e` 两条
commit message）、G07 Root Runner / 子租约生命周期收口、N7 提交追溯前置治理与 N7 回归耗时优化。未授权真实
MySQL、Migration、Push、Merge、Tag、Release 或 Deploy。

## 2. N7 根因与永久修复

- 根因：§37.32 的最终证据提交 `59eccd5` 的 commit message 未引用 `docs/status/PROJECT_STATUS.md §37.32` 或完整
  路径，最终 HEAD 的 current N7 因此 fail closed（正文与 tree 均正确，仅消息追溯缺失）。
- 历史修正：重建该提交消息为 `f3d67edc`（`登记M1C-WP7组合实施证据与审查边界`）与 `1a59b410`
  （`勘误最终文档门禁状态`），正文与业务实现未变。
- 永久修复（`a16b021`）：新增 `scripts/git/check-commit-traceability.mjs` 与 `.githooks/`，使受治理路径的提交在
  **提交前**自动带出 `Docs-Trace:` 追溯行。防线为三层：
  1. `prepare-commit-msg` —— 自动为受治理路径追加 `Docs-Trace:` 追溯行；
  2. `commit-msg` —— 校验追溯行；
  3. 独立入口 `scripts/git/check-commit-traceability.mjs check-commit HEAD` 与正式 N7
     （`check-doc-consistency.mjs --mode current --only N7`）。
- `--no-verify` 只能跳过 `commit-msg`；`prepare-commit-msg` 仍会运行，且独立检查与正式 N7 在事后仍可追溯。

## 3. 六提交历史修正 SHA 映射与 Tree 一致性

前四个 Implementation 提交 SHA 不变，仅最后两条证据/勘误提交消息被重建：

| 旧 SHA（重写前） | 新 SHA（重写后） | 变化 |
|---|---|---|
| `84bca446304200619d5a301e6d796ff58e9b8206` | `84bca446304200619d5a301e6d796ff58e9b8206` | 不变 |
| `c8145c2be97652db2979338b9b51c19280319654` | `c8145c2be97652db2979338b9b51c19280319654` | 不变 |
| `cb8538ae30773b3a0a911d0782d743ba01d6b1ba` | `cb8538ae30773b3a0a911d0782d743ba01d6b1ba` | 不变 |
| `b49afedddfd89ddc96a271d3ca7ce872d099f05d` | `b49afedddfd89ddc96a271d3ca7ce872d099f05d` | 不变 |
| `59eccd54d33e5a95c43c1e3e78d5b4b5ecb6d357` | `f3d67edc73ba8891372ca4b7b37e6788ba40cd36` | 仅消息重建 |
| `59dec19ec4f80b83db49ca07bb978ce159947b64` | `1a59b41025f5dbc4eddf59dc8a5977192d0aac80` | 仅消息重建 |

旧、新 Combined 最终 Tree 完全一致：`132fe40c96547e3c43223c5e85370112f6aeead2`。正文与业务实现未因历史修正改变。

## 4. G07 Root/Child 生命周期收口与 Child Lease 安全修复

`9c20e60` 收口 G07 根运行器与子租约生命周期：

- Root Runner、生产 HTTP fixture builder（`server/tests/m1-core-g07-http-fixture-builder.js`）、
  Root/Child/Cleanup/Quarantine/Recovery 生命周期均已离线实现；
- Child Lease 由 HMAC 改为 **Ed25519**：根持私钥、子进程仅持公钥，子进程不能自行签发扩权 lease；
- target / SHA / operation / PID / 父进程持续校验；子进程未确认退出时禁止 cleanup；
- Cleanup、Quarantine、独立 Recovery lease 均有模拟覆盖。

CR-01～CR-09 的**真实 MySQL 执行**仍为 `NOT_RUN`；真实 `information_schema` parity 仍为
`READY_TO_EXECUTE / NOT_RUN`。上述离线收口不构成 G07 PASS。

## 5. N7 回归耗时优化

`4f20900` 将 N7 回归改为最小临时 Git 仓库 + 临时 `n7-test-anchor`，避免每个场景重复扫描真实 G0 历史；
并在临时子进程隔离 Git 配置（`GIT_CONFIG_GLOBAL=NUL` / `GIT_CONFIG_NOSYSTEM=1`），不读取用户全局配置。
T01～T31 断言、受治理范围与正式 anchor 均未改变。耗时由约 1555s 降至约 63s。

## 6. 门禁结果

| 门禁 | 结果 |
|---|---|
| N7 回归（`check-doc-consistency.test.js` T01–T31） | PASS |
| 提交追溯测试（`check-commit-traceability.test.js`） | PASS |
| `pnpm build`（经 `pnpm.cmd`） | PASS |
| docs current（HEAD） | N1、N3～N9 PASS；N2 RETIRED |
| docs current（HEAD，`--only N7`） | PASS |
| docs migration | C1～C6 PASS |
| `check-commit-traceability.mjs check-commit HEAD` | PASS |
| `git diff --check` | PASS |
| `pnpm test:fast`（经 `pnpm.cmd`） | 534/534 PASS（本轮未重跑） |
| `pnpm test`（FULL） | `NOT_RERUN / ABORTED_AT_USER_REQUEST`（用户要求中止，不写 PASS） |

FAST/FULL runner 输出 `isolation=sqlite`，并明确移除 `ERP_MYSQL_TEST_ALLOW_RESET`。本轮未运行 HEAVY、MySQL Gate
或 M-15 历史 Migration。

## 7. 未发生事项

MySQL 连接/初始化/create/drop/reset、真实 Migration、Push、Merge、Tag、Release、Deploy、Gate PASS、
Acceptance、Freeze 均未发生。本条不签发 G07 PASS、M1-Core Acceptance、Domain Closure 或 Freeze。

```text
M1C_WP7_R1_READY_FOR_INDEPENDENT_REVIEW
```
