# M1C-G07 最终一次性真实 MySQL 执行与 M1-Core Acceptance 候审（2026-11-05）

> 用途：保存 Run `94e2e0c7-dba8-4aa4-95de-9767712cf5d5` 的脱敏真实 MySQL Gate 证据，登记本次执行
> 的最终失败证据链与根因候选，并汇总 M1-Core 七 Gate 候审矩阵（含 G05 正式 Owner Acceptance）。
> Owner：Procurement & Outsourcing Domain Owner（Gate 与包级正式决定）；Platform / Database Safety / QA
> （执行与证据维护）。
> 状态：`PENDING_APPROVAL` —— G07 已执行且失败，M1-Core 包级验收仍被阻断。
> 权威来源：Requirement [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md)
> §31.13.5；Active Design [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)
> §13.1；当前项目状态仅由 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 登记。本文仅为执行/候审证据。

## 1. G07 Final Execution Report

### 1.1 固定身份与授权

| 项 | 实际值 |
|---|---|
| Repository / Branch | `quanyantan-svg/modern-erp` / `work/m1-core-rebaseline-20261102` |
| 被测 SHA | `02f0cce70a73134b31f36a16067a633384e1c175` |
| Run ID | `94e2e0c7-dba8-4aa4-95de-9767712cf5d5` |
| Manifest | `M1_CORE_G07_V1` |
| Fixture digest | `2202e6c21142528bd2b21f276abcacbf250af06624a456b84ec12263e15c808c` |
| 目标 | `127.0.0.1:3306/modern_erp_domain_test` / `modern_erp_test` |
| `CURRENT_USER()` | `modern_erp_test@127.0.0.1` |
| Server UUID | `256c7a4e-d275-11f1-885b-b025aa71d167` |
| Grants SHA-256 | `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e` |
| MySQL 版本 | `8.0.37` |
| ACK-4 窗口 | `2026-11-05T04:12:46.811Z` → `2026-11-05T04:26:46.811Z`（14 分钟，≤15 分钟） |
| 有序操作 | `RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_M1_HTTP_FIXTURES` → `CLEANUP_SCHEMA_POST_RUN` |

Approval 的 `subject` = 项目业务所有者，`channel` = 当前 ERP 项目对话，`reference` 直接指向用户本轮
明确批准 G05 Owner Acceptance 与最后一次真实 G07 执行的实际消息；`summary` 固定「唯一 disposable MySQL
Gate、固定 SHA、四操作、一次执行、不自动重试」。审批临时 JSON 与 DPAPI capability 均未入库；密码、
Bearer Token、DPAPI 内容均未输出或提交。

### 1.2 执行前只读 preflight（全部 PASS）

| 检查 | 结果 |
|---|---|
| 工作树 / HEAD | clean；HEAD 精确等于被测 SHA |
| GitHub / Gitee | 同名分支均精确指向被测 SHA `02f0cce…` |
| 目标 / DPAPI | 基线 `target.json` 八字段与冻结身份一致；credential 可用 |
| MySQL / grants | MySQL `8.0.37`；最小权限（`assertExactLeastPrivilegeGrants`）与 grants digest PASS |
| 五类对象 | tables/views/triggers/routines/events = `0/0/0/0/0` |
| Server 前置 | `log_bin_trust_function_creators=1` |
| 锁观测 | `performance_schema.data_lock_waits` 可读，count = 0 |
| ACK-4 / 端口 | 无 quarantine；`33101` / `33102` 空闲 |
| 静态合同 | fixture digest、9 CR、6 主体、5 L2 前置、四操作顺序无漂移 |

两个 `mysqld` 进程与常见启动配置路径缺失风险保持 `OPEN`；本轮未终止进程、重启 MySQL 或修改全局参数。

### 1.3 执行阶段与终态

| 阶段 | 结果 |
|---|---|
| ACK-4 | 新 Capability 成功签发并原子消费；issued 文件已消失，consumed 记录存在 |
| Reset / Bootstrap | child lease 已消费；Root 继续进入 HTTP 阶段，未报告失败 |
| App-A / App-B | 两个 App child 已启动；Root 经六主体登录与 Fixture builder 后才创建 Suite |
| Fixture Setup | 已完成至可生成 Fixture manifest（越过上次 `CR-08.issue` 阻断） |
| Suite | Suite child（PID `19124`）退出 `1` |
| Root | `FAILED`；`testsPassed=false`、`childrenExited=true`、`cleanupProven=true` |
| Launcher | `RESULT = FAIL`；实测 exit `5` |
| Cleanup | 仅执行 1 次；`cleanupProven=true` |
| Children | `childrenExited=true`；6 个 child lease 全部消费、无剩余 |
| 独立 postflight | `0/0/0/0/0`；端口释放；无 quarantine |

### 1.4 Suite 失败证据与根因候选

Suite child 退出 `1`，脱敏诊断（`%LOCALAPPDATA%/ModernERP/mysql-gate/evidence/94e2e0c7-…/1793852089961-suite-19124.log`）
记录：

- `CHILD_EXIT=1 MODE=suite OPERATION=RUN_M1_HTTP_FIXTURES`
- `STDOUT_PRESENT=false`（Suite stdout 完全为空）
- `STDERR_PRESENT=true`，仅两行警告：
  1. `node:sqlite` 的 `ExperimentalWarning`（来自 `db.js` 模块加载，预期）；
  2. mysql2 的 `Ignoring invalid configuration option passed to Connection: backend`（来自
     `resolveDatabaseConfig({backend:'mysql'})` 的 `backend` 字段被透传到 mysql2，属无害警告、非退出原因）。
- `TAP_FAILURE_TOTAL=UNKNOWN IDENTIFIABLE_FAILURES=0`（无任何可识别失败名称/断言/堆栈）。

**根因候选（离线复现确认）**：`scripts/gates/m1-core-g07-child.mjs` 的 `suiteProcess()` 用
`stream.pipe(process.stdout)` 捕获测试输出，但 `node:test` 的 `run({ files, isolation:'none' })` 返回的流
**不产生 TAP 文本**，只产生结构化事件（`test:pass` / `test:fail` / `test:diagnostic` / `test:complete`）。
离线复现证明：**通过测试、断言失败、`before()` 抛异常三种情况**均得到「exit 1 + stdout 空 + stderr 空」，
与本次真实签名一致。因此 `stream.pipe(process.stdout)` 始终捕获不到任何内容，基于「解析 stdout 的 node:test
TAP」的诊断链（§37.39 / commit `c9e63f2`）永远看不到失败测试名称与断言。`test:fail` 确实触发了（故 exit 1），
说明 Suite 确有真实失败，但其具体失败测试、断言与堆栈被该诊断缺口掩蔽。本缺口与前次 Run `a4c97802` 的
「stdout 丢失」同源，尚未闭合。

据此，CR-01～CR-09、lock-wait、Parity 与 Oracle 均不得记 PASS，逐项均为 `INCONCLUSIVE`。

| CR | Fixture Setup | Suite 逐项证据 | 候审结论 |
|---|---|---|---|
| CR-01 | 已完成至 Suite 创建 | stdout 未产生 | `INCONCLUSIVE` |
| CR-02 | 已完成至 Suite 创建 | stdout 未产生 | `INCONCLUSIVE` |
| CR-03 | 已完成至 Suite 创建 | stdout 未产生 | `INCONCLUSIVE` |
| CR-04 | 已完成至 Suite 创建 | stdout 未产生 | `INCONCLUSIVE` |
| CR-05 | 已完成至 Suite 创建 | stdout 未产生 | `INCONCLUSIVE` |
| CR-06 | 已完成至 Suite 创建 | stdout 未产生 | `INCONCLUSIVE` |
| CR-07 | 已完成至 Suite 创建 | stdout 未产生 | `INCONCLUSIVE` |
| CR-08 | 上次 Setup 阻断未复现 | stdout 未产生 | `INCONCLUSIVE` |
| CR-09 | 已完成至 Suite 创建 | stdout 未产生 | `INCONCLUSIVE` |

G07 聚合结论为 `FAIL`。本 Run ID / Capability 已消费，未自动重试，不提出第五次自动执行计划。

## 2. M1-Core 七 Gate 候审矩阵

| Gate | 现有实施 / 验证证据 | 候审状态 | 剩余风险 / Owner 待办 |
|---|---|---|---|
| G01 | WP1 + WP7-A SQLite/L1 HTTP；`84bca44` 并发错误码/编号 focused | `INCONCLUSIVE` | 真实 MySQL HTTP 半边是真缺口；G07 无逐项证据 |
| G02 | 收货/IQC/SOD SQLite HTTP + R1 幂等 | `PENDING_OWNER_DECISION` | 无新增技术证据缺口；只待 Owner 核验签发或给精确拒绝理由 |
| G03 | L1 HTTP + L2 canonical primitive + G07 离线 Oracle | `INCONCLUSIVE` | 真实 MySQL current-schema/parity 与逐项结果仍缺 |
| G04 | 增量倒冲/估值/成品 SQLite + G07 离线 Oracle | `INCONCLUSIVE` | 真实 Handler/MySQL 并发不双扣/双收结果仍缺 |
| **G05** | Browser `24/24`（3 主体 × 2 工作面 × 4 宽度）+ 服务端 RBAC | **`PASS`** | 业务所有者本轮正式 Owner Acceptance；不依赖 G07 |
| G06 | 来源 Guard / zero-side-effect SQLite | `PENDING_OWNER_DECISION` | 无新增技术证据缺口；只待 Owner 签发或指出具体未满足断言 |
| G07 | 本次真实 MySQL 执行，Suite child exit 1 | `FAIL` | 逐 CR/lock-wait/Parity/Oracle 证据因诊断缺口不可恢复；Platform / DB Safety |

`M1_CORE_REQUIREMENT_ACCEPTANCE_PASS`、`M1_CORE_DESIGN_PASS` 只覆盖合同；空库 current-schema bootstrap
不构成历史 M-15 Migration 验收；延期 WIP/VMI/GL 政策不无条件阻塞首期；M1-Core 包级候选不等于 M1 Domain
Closure。两个 `mysqld` 环境风险、加工费必填与延期会计政策继续 OPEN。

## 3. 剩余阻塞清单

1. **真实失败测试名称 / 断言 / 根因候选**：Suite child exit 1，stdout 空、仅两行无害警告；根因候选为
   `node:test run({isolation:'none'})` 流不产出 TAP 文本、`stream.pipe(process.stdout)` 捕获不到任何内容，
   导致具体失败测试与断言不可恢复（离线复现确认）。具体业务失败点被该诊断缺口掩蔽。
2. **受影响 Gate**：G07（`FAIL`）；G01 / G03 / G04 因真实 MySQL 逐项证据缺失保持 `INCONCLUSIVE`。
3. **安全终态**：Root `FAILED`、`testsPassed=false`、`childrenExited=true`、`cleanupProven=true`、cleanup 1 次、
   独立 postflight `0/0/0/0/0`、端口释放、无 quarantine；未重试。
4. **本次已正式通过**：`M1C-G05 PASS`（Owner Acceptance，见
   [`m1-core-g05-owner-acceptance-20261105.md`](./m1-core-g05-owner-acceptance-20261105.md)）。
5. **可单独继续的验收与后续工作**：G02 / G06 可立即交 Owner 核验签发（不依赖 G07）；G05 已闭合；
   G07 诊断链（`suiteProcess()` 改消费 `test:fail` / `test:diagnostic` 事件而非 TAP stdout）与 G01/G03/G04
   真实 MySQL 验证各自需要**独立授权**与新一轮 Run ID / ACK-4，不由本文自动发起。

## 4. 候审结论

```text
M1_CORE_ACCEPTANCE_BLOCKED
```

阻断项：G07 Suite 聚合失败且逐项证据不可恢复；G01/G03/G04 缺少真实 MySQL 逐项证据；G02/G06 仍待 Owner
裁定。本文不签发 `M1_CORE_ACCEPTANCE_PASS`、Freeze、Domain Acceptance、Release 或 Deploy，也不提出
第五次自动执行计划。
