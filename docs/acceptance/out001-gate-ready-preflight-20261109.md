# OUT-001 GATE_READY Preflight 证据报告（2026-11-09）

> 用途：收集 **GATE_READY 授权前**的全部前置证据 —— 冻结候选与远端 ref 状态、候选上的静态
> 检查、Windows 本地能力（PowerShell 5.1 / DPAPI / ACL）、真实 MySQL 的**只读**身份核验，以及
> ACK-4 quarantine / 历史 Capability 状态 —— 供业务所有者独立技术复核。
>
> Owner：业务所有者（GATE_READY 与真实 Gate 的最终授权决定）；Platform（证据维护）。
>
> 状态：**`PREFLIGHT_PASS_PENDING_OWNER_REVIEW`** —— 前置证据收集完毕，**等待 Owner 复核**。
> 本文**不**签发 `GATE_READY`，**不**签发 `GATE_AUTHORIZED` / `GATE_EXECUTED` / `GATE_ACCEPTED`，
> **不**签发任何 Acceptance，也**不**构成业务 Capability Freeze、Domain Acceptance 或 Release。
>
> 权威来源：Active Requirement [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md)
> §31.14.2；Active Design [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md)
> §26.34.14.3、§26.34.16、§26.34.16.3、§26.34.16.3.1；唯一项目状态登记表
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §45.18～§45.27。
>
> 本文是**前置证据**，不取代 Requirement、Active Design 或唯一项目状态登记表。
> **本文件的生成本身不构成 Git 提交或远端同步。**

---

## 1. 冻结对象与远端 ref 状态

| 项 | 实际值 |
|---|---|
| Source branch | `fix/out001-launcher-tap-summary-0adfecb6` |
| Source SHA | `37a17c091054d5026d1ec7813adf3e344597ec3d` |
| Frozen candidate | `candidate/out001-d4c97a8` |
| Candidate SHA（完整） | `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec` |
| Candidate 分支新增提交 | `0` 条（冻结点未被移动） |
| GitHub `refs/heads/fix/out001-launcher-tap-summary-0adfecb6` | `37a17c091054d5026d1ec7813adf3e344597ec3d` |
| GitHub `refs/heads/candidate/out001-d4c97a8` | `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec` |
| GitHub `refs/heads/master` | `97eea5a58bad774b36fbe0e94d60a1e35c2c3a3b` —— 未改变 |
| GitHub `refs/heads/candidate/out001-075e0f6` | `075e0f6e61108a423c4ae0b194199edec2bc9465` —— 保留、未改变 |
| GitHub `refs/heads/candidate/out001-97eea5a` | `97eea5a58bad774b36fbe0e94d60a1e35c2c3a3b` —— 保留、未改变 |
| GitHub `refs/heads/candidate/out001-a5fffd1` | `a5fffd10835336fc5137ff2768290f5c34def4ea` —— 保留、未改变 |
| GitHub `refs/heads/fix/out001-mysql-test-fixtures` | `075e0f6e61108a423c4ae0b194199edec2bc9465` —— 保持不变 |
| `package.json` version | `1.6.2` —— 未改变 |
| release tags | 本地 `29` / GitHub `3` / Gitee `29` —— 未改变 |

**双远端口径**：**GitHub 已同步，Gitee 未同步。** Gitee 上不存在 OUT-001 的工作分支、候选分支
与 `fix/out001-mysql-test-fixtures`；Gitee 的 `master` 为
`a17ef2bb45b658d1c23136406f560e83634f0bbf`，与 GitHub 的 `master` 不同。**不得**把本次状态
描述为「双远端同步」。

## 2. 候选上的静态检查（全部在 `candidate/out001-d4c97a8` 上执行）

工作树在候选上为 clean，`git rev-parse HEAD` 实测为
`d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec`。**所有技术检查均在候选上运行**，未在 source
branch 上代替。

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| B1 | `node --test scripts/gates/ack4-runtime.test.js server/mysql-out001-gate-infrastructure.test.js server/mysql-disposable-target-guard.test.js server/mysql-out001-m3-uncertain-commit.test.js` | `0` | `83/83 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| B2 | `node --check scripts/gates/ack4/ack4-runtime.mjs` | `0` | 通过 |
| B3 | `node --check scripts/gates/mysql-out001-static-preflight.mjs` | `0` | 通过 |
| B4 | `node --check scripts/gates/mysql-local-preflight.mjs` | `0` | 通过 |
| B5 | `node --check scripts/gates/mysql-out001-gate.mjs` | `0` | 通过 |
| B6 | `node --check scripts/gates/mysql-out001-root-lifecycle.mjs` | `0` | 通过 |
| B7 | `node --check server/mysql-out001.integration.js` | `0` | 通过 |

### 2.1 ACK-4 Runtime 合同核对（源码核对 + 上述可执行断言）

| # | 合同项 | 结论 | 依据 |
|---|---|---|---|
| A1 | RunId 为 UUIDv4 | **已满足** | `scripts/gates/ack4/ack4-runtime.mjs` 的 runId 正则要求版本位为 `4` 且变体位为 `[89ab]`；`validateAck4Approval` 强制 |
| A2 | 绑定完整 40 位 Commit SHA | **已满足** | 运行时要求 `^[0-9a-f]{40}$` 并与 `expected.commitSha` 逐字比对；期望值来自 `git rev-parse HEAD` |
| A3 | 消费窗口 ≤ 15 分钟 | **已满足** | `ACK4_CONSUME_WINDOW_MS = 15 * 60 * 1000`；超过即拒绝，过期即拒绝 |
| A4 | 精确绑定 `OUT_001_MYSQL_V1` | **已满足** | manifest 不匹配即 `ACK4_MANIFEST_MISMATCH` |
| A5 | 四项固定操作及顺序 | **已满足**（顺序有一处例外，见 §6 R-2） | 操作集合以 `exactArray` 逐项比对；根操作必须从「第一个未完成的操作」开始；子 lease 绑定且仅绑定一个操作 |
| A6 | 绑定 Host / Port / Database / User / CurrentUser / ServerUUID / Grants SHA | **已满足** | `normalizeAck4Target` 归一化后按 SHA-256 摘要比对；`grantsSha256` 必须为 64 位十六进制；`selectedDatabase` 必须与 `database` 相等 |
| A7 | 原子一次性消费 | **已满足** | 目录级互斥 + 源文件 `renameSync` 到 consumed 路径；顺序与并发双消费均被拒绝（可执行断言覆盖） |
| A8 | Root Lease 与 Child Lease 绑定 | **已满足** | 子 lease 携带 `runId` / `rootPid` / `rootStartedAt`，与根 lease 不一致即 `ACK4_PROCESS_TREE_MISMATCH`；portable lease 由根以 Ed25519 签名 |
| A9 | PID / 进程创建时间 / operation scope | **部分满足**（见 §6 R-1） | lease 绑定 `childPid` 与 `childStartedAt` 并核对 `process.pid`，且绑定单一 operation；**但** `childStartedAt` 由父进程生成并经环境变量传递，不是操作系统进程创建时间 |
| A10 | quarantine fail closed | **已满足**（恢复路径另见 §6 R-3） | `finalizeAck4Run` 在清理未证明时写入 `CLEANUP_UNVERIFIED` 标记（`flag:'wx'`）；`assertNoAck4Quarantine` 在消费前强制调用 |
| A11 | 不允许重放或扩大操作权限 | **已满足** | 能力重放、操作重放（`ACK4_OPERATION_REPLAY`）、子 lease 重放、跨 operation 使用均被拒绝；恢复路径必须使用**不同**的 runId |

### 2.2 Gate 编排合同核对

| # | 合同项 | 结论 | 依据 |
|---|---|---|---|
| B1 | 固定 suite = `server/mysql-out001.integration.js` | **已满足** | `OUT_001_MYSQL_SUITE_FILE` 常量；子进程只运行该固定文件，不存在传入任意脚本的入口；Launcher 无脚本参数 |
| B2 | Static Preflight 在 ACK-4 consume 之前 | **已满足** | `mysql-out001-gate.mjs` 中静态预检断言先于根 capability 消费；只读 MySQL 预检亦先于 Gate |
| B3 | RESET / BOOTSTRAP / RUN / CLEANUP 顺序 | **已满足** | 根生命周期按序驱动；运行时要求从第一个未完成操作开始 |
| B4 | 只有 Root Cleanup 子进程拥有 DROP 能力 | **已满足**（一处例外，见 §6 R-4） | 清理能力由 `assertActivePortableChildOperation(['RESET_SCHEMA_PRE_RUN','CLEANUP_SCHEMA_POST_RUN'])` 门控；套件与应用进程不持有该 lease，且其清理请求被 `deferMySqlCleanup()` 变成「已延期」；RESET 子进程另由 `requireEmpty` 与 EMPTY_ONLY 断言限制 |
| B5 | 五类对象独立 Postflight | **已满足** | 独立 `--mode postflight` 子进程（无 lease、只读）重新核验身份并统计 tables / views / triggers / routines / events，五类非零即不接受 |
| B6 | Root Evidence 与 Launcher Result 可验证 | **Root Evidence 已满足；Launcher Result 部分满足**（见 §6 R-5） | Root Evidence 原子写入且拒绝覆盖，manifest 绑定字节数与 SHA-256 并被独立复核；Launcher Result 仅原子写入、**未**纳入 root manifest，也**未**被独立校验器覆盖 |
| B7 | 子进程没有退出证明时禁止 PASS | **已满足** | 缺退出证明即抛 `OUT_001_MYSQL_CHILD_EXIT_UNVERIFIED`；`childrenExited` 为 Gate PASS 的必要条件；Launcher PASS 同样要求 `childrenExited -eq $true` |

## 3. Windows 本地能力（Windows PowerShell 5.1）

| # | 检查 | 实际结果 |
|---|---|---|
| C1 | `$PSVersionTable.PSVersion` | `5.1.26100.9711`（`PSEdition = Desktop`，非 PowerShell 7） |
| C2 | `Get-Service MySQL80` | `Running` |
| C3 | `Test-NetConnection 127.0.0.1 -Port 3306` | `TcpTestSucceeded = True` |
| C4 | 当前 Windows SID | `S-1-5-21-3244792470-3882632599-549765274-500` |

### 3.1 PowerShell Parser AST（**只解析，不执行**）

| 脚本 | 解析错误数 | 函数数 | Token 数 |
|---|---|---|---|
| `scripts/gates/issue-mysql-ack4.ps1` | `0` | 0 | 316 |
| `scripts/gates/run-out001-mysql-gate.ps1` | `0` | 8 | 2342 |
| `scripts/gates/setup-mysql-local-gate.ps1` | `0` | 5 | 1010 |

三个脚本**均未执行**：`issue-mysql-ack4.ps1`、`run-out001-mysql-gate.ps1`、
`setup-mysql-local-gate.ps1` 在本工作包中只被 AST 解析。

### 3.2 DPAPI 实际验证（CurrentUser）

| 项 | 实际结果 |
|---|---|
| 作用域 | `DataProtectionScope.CurrentUser` |
| 密文字节数 | `294` |
| Protect / Unprotect 往返一致 | **`True`** |
| sentinel 明文是否打印 | **否** |

### 3.3 临时 ACL sentinel（与 ACK-4 Issuer 相同的 FileSecurity 逻辑）

| 项 | 实际结果 |
|---|---|
| Owner = 当前 SID | `True` |
| `AreAccessRuleProtection`（继承已禁用） | `True` |
| 显式访问规则数 | `1` |
| 继承访问规则数 | `0` |
| 仅当前 SID / FullControl / Allow | `True` |
| 当前 SID 可读取临时文件 | `True` |
| 临时文件已删除 | `True` |

**未调用** `issue-mysql-ack4.ps1`，**未创建**任何真正的 Capability。

### 3.4 现有本地凭据与 baseline（只读）

| 项 | 实际结果 |
|---|---|
| `credential.dat` 存在 | `True` |
| `target.json` 存在 | `True` |
| DPAPI 凭据可由当前 SID 解密 | **`OK`**（明文字节 `16`，非空，**未打印**） |
| baseline 字段完整性 | `host` / `port` / `database` / `user` / `currentUser` / `serverUuid` / `serverVersion` / `grantsSha256`（64 位十六进制）/ `disposableTarget` / `initialInventory` —— **全部存在** |

baseline 实际值：`127.0.0.1:3306`、`modern_erp_domain_test`、`modern_erp_test`、
`modern_erp_test@127.0.0.1`、`256c7a4e-d275-11f1-885b-b025aa71d167`、`8.0.37`、
`grantsSha256 = bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e`、
`initialInventory = EMPTY_ONLY`。**文件未被修改**，未自动运行 setup，未使用 `-ForceBaseline`。

## 4. 真实 MySQL 只读 Preflight

固定目标：`127.0.0.1:3306` / `modern_erp_domain_test` / `modern_erp_test` / MySQL 8。
凭据来自既有 `target.json` 与 DPAPI `credential.dat`；解密在**进程内**完成，口令只进入
**当前进程**的环境变量，`finally` 中清除。**未修改** `mysql-local-preflight.mjs`。

| # | 核验项 | 实际结果 | 结论 |
|---|---|---|---|
| D1 | `DATABASE()` | `modern_erp_domain_test` | **一致** |
| D2 | `CURRENT_USER()` | `modern_erp_test@127.0.0.1` | **与 baseline 一致** |
| D3 | Server UUID | `256c7a4e-d275-11f1-885b-b025aa71d167` | **与 baseline 一致** |
| D4 | Grants SHA-256 | `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e` | **与 baseline 一致** |
| D5 | MySQL 版本 | `8.0.37` | **8.x** |
| D6 | `assertExactLeastPrivilegeGrants` | 通过（未抛错） | **通过** |
| D7 | 五类对象 inventory | `tables=0, views=0, triggers=0, routines=0, events=0` | **五类全为零** |
| D8 | 预检整体 | 退出码 `0`，`ok=true`，`drift=[]`，`nonEmpty=[]` | **PASS** |

只读性说明：预检只执行身份读取、授权指纹读取与对象计数；**没有**任何 DDL / DML，
**没有** `SET GLOBAL`，**没有** `GRANT` / `REVOKE`，**没有**触碰 `calculator_db`
（本次唯一连接的目标库是 `modern_erp_domain_test`）。五类对象计数仍为零，本身即
「未创建任何对象」的证据。

### 4.1 `log_bin` / `log_bin_trust_function_creators`

通过临时 Node helper、经既有 `MySqlSyncAdapter` **只读**执行
`SHOW GLOBAL VARIABLES WHERE Variable_name IN ('log_bin','log_bin_trust_function_creators')`：

| 变量 | 实际值 |
|---|---|
| `log_bin` | `ON` |
| `log_bin_trust_function_creators` | `ON` |

`log_bin` 为开启状态，因此 `log_bin_trust_function_creators` 必须为 `1` —— 实测为 `ON`，
**条件已满足**。**未执行** `SET GLOBAL`，**未扩大**账号权限，无需 Owner 的管理员操作授权。

## 5. Quarantine / 历史 Capability

| 项 | 实际结果 |
|---|---|
| Quarantine 目录 | `%LOCALAPPDATA%\ModernERP\mysql-gate\ack4\quarantine` —— **不存在** |
| `assertNoAck4Quarantine(quarantineDir, target)` | **`PASS`**（以本轮实际 target identity `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`，字段形状与 `run-out001-mysql-gate.ps1` 构造的 target proof 一致） |
| 历史 RunId `0adfecb6-7db9-4015-9c41-cc36ad42ec48` | consumed 记录**存在**；children 目录**存在**；**未复用、未重新签发、未删除** |
| 已消费 RunId 总数 | `12`（本工作包**未创建**任何新 RunId） |
| quarantine marker | **未删除**任何 marker（本工作包本就未创建、未触碰） |

## 6. 未完全满足项与其性质（有界残余，供 Owner 复核）

以下各项**不影响**上述任何前置检查的执行结果，但属合同措辞与实际强制强度之间的差异，
**必须**在授权 `GATE_READY` 前由 Owner 逐条裁定。

| # | 项 | 实际情况 | 性质 |
|---|---|---|---|
| R-1 | A9「进程创建时间」 | portable child lease 绑定了 `childPid` 与 `childStartedAt`，但 `childStartedAt` 由**父进程生成**并经环境变量传递，**不是**操作系统进程创建时间。仓库内的后代登记簿（`mysql-out001-descendant-registry.mjs`）另行查询 `Win32_Process.CreationDate`，但 ACK-4 子 lease 本身没有 | **有界残余**：PID 复用防线在后代登记簿侧存在，在 ACK-4 子 lease 侧缺失。属**自报**属性而非独立取证 |
| R-2 | A5 / B3 顺序 | `CLEANUP` 类操作被**豁免**于「第一个未完成操作」的顺序检查，因此原语允许 CLEANUP 作为根的首个操作；实际顺序由编排器调用顺序保证 | **有界残余**：顺序依赖编排器而非原语强制 |
| R-3 | A10 quarantine 恢复 | 恢复路径的操作集合是**另一个更窄**的 2 操作 manifest（`ACK4_RECOVERY_V1`：`INSPECT_QUARANTINE` / `CLEANUP_SCHEMA_RECOVERY`），且 `recoverAck4Quarantine` 在 OUT-001 Gate 中**没有生产调用方**，只有测试覆盖 | **有界残余**：权限**未被扩大**（集合更窄），但恢复入口目前不可达 |
| R-4 | B4 DROP 能力 | DROP 原语同时允许 `RESET_SCHEMA_PRE_RUN` 与 `CLEANUP_SCHEMA_POST_RUN`；RESET 不被允许 DROP，仅由固定调用方的 `requireEmpty` 与 EMPTY_ONLY 断言阻止 | **有界残余**：靠固定调用方代码而非原语本身区分 |
| R-5 | B6 Launcher Result 可验证性 | Root Evidence **完全可验证**（原子写入 + 拒绝覆盖 + manifest 绑定字节数/SHA-256 + 独立复核）。Launcher Result **仅**原子写入且拒绝覆盖，**未**纳入 root manifest，也**未**被独立校验器覆盖；其记录的 `gateStdoutSha256` / `gateStderrSha256` 指向 `ps1` 在收尾时删除的临时文件 | **有界残余（既有状态）**：Launcher 结果的独立可验证性弱于 Root Evidence。属 §45.18/§45.19 之后的既有形态，非本工作包引入 |
| R-6 | 破坏性环境变量的继承 | `ERP_MYSQL_TEST_ALLOW_RESET` / `ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS` 被**每一个**子进程继承；阻止套件子进程 DROP 的是 portable lease 的 operation scope 与 `deferMySqlCleanup()` | **有界残余**：纵深防御的第二层缺失（环境变量不按子进程收敛） |
| R-7 | Postflight 子进程 | Postflight 子进程在 lease / 后代登记簿机制**之外**派生，只检查其退出码与超时，未纳入后代退出证明 | **有界残余**：与 B7 的「后代退出证明」口径不完全一致 |

**上述各项均不构成 `PREFLIGHT_BLOCKED`**：所有**可执行**的前置检查（静态测试、AST、DPAPI、ACL、
凭据解密、身份核验、授权指纹、五类对象、`log_bin` 组合、quarantine）全部以退出码 `0` 通过，
且**没有**任何一项前置检查失败。本文因此登记为 `PREFLIGHT_PASS_PENDING_OWNER_REVIEW`；
R-1～R-7 是**授权前须由 Owner 逐条裁定**的强制强度残余，而不是已发生的失败。

## 7. 明确不包含 / 本工作包未发生

| 项 | 状态 |
|---|---|
| `GATE_READY` | **未签发** —— 本文只提供前置证据 |
| `GATE_AUTHORIZED` / `GATE_EXECUTED` / 技术 PASS / `GATE_ACCEPTED` | **未签发** |
| ACK-4 签发或消费 | **未发生** |
| RunId 创建 | **未发生**（已消费 RunId 总数仍为 `12`） |
| 真实 MySQL Gate 执行 | **未执行** |
| `RESET_SCHEMA_PRE_RUN` / `BOOTSTRAP_CURRENT_SCHEMA` / `RUN_OUT001_HTTP_FIXTURES` / `CLEANUP_SCHEMA_POST_RUN` | **未执行** |
| 任何 DDL / DML / `SET GLOBAL` / `GRANT` / `REVOKE` | **未发生**（全部数据库访问均为只读） |
| `calculator_db` | **未触碰** |
| `issue-mysql-ack4.ps1` / `run-out001-mysql-gate.ps1` / `setup-mysql-local-gate.ps1` | **未执行**（仅 AST 解析） |
| 业务 Capability Freeze / Domain Acceptance / Manual Closure / Release | **不包含** |
| Merge / Tag / Release / Deploy / Push / Gitee 同步 | **未发生** |

## 8. 结论

**`PREFLIGHT_PASS_PENDING_OWNER_REVIEW`**

所有可执行前置检查通过（退出码 `0`），冻结候选与远端 ref 状态一致，Windows 本地能力可用，
真实 MySQL 的**只读**身份与授权指纹与冻结 baseline 逐字一致，目标 schema 五类对象为零，
`log_bin` 与 `log_bin_trust_function_creators` 组合满足条件，quarantine 无标记。

**`GATE_READY` 未签发。** 真实 Gate 的授权与执行、`ACK-4` 的签发与消费、RunId 的创建，
以及 §6 R-1～R-7 的强制强度残余的逐条裁定，均需业务所有者的**单独**决定。若获授权，
必须使用**全新**的 RunId / ACK-4 Capability，既有已消费的 ACK-4 不得复用，且候选必须仍是
`d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec`。

## 9. 索引

- 项目状态登记：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §45.27
- 冻结证据：[`out001-candidate-freeze-20261109.md`](./out001-candidate-freeze-20261109.md)
- 验收与冻结证据索引：[`README.md`](./README.md)
- 当日开发记录：`log/2026-11-09.md`
