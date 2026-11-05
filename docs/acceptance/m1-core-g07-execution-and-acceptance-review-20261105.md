# M1C-G07 一次性 MySQL 执行与 M1-Core Acceptance 候审包（2026-11-05）

> 用途：保存 Run `1197f81a-4a9c-4587-944c-64f11cbad47c` 的脱敏真实 MySQL Gate 证据，
> 并按 `M1C-G01..G07` 汇总 M1-Core 包级 Acceptance 候审材料。
> Owner：Procurement & Outsourcing Domain Owner（正式验收决定）；Platform / Database Safety / QA
> （执行与证据维护）。
> 状态：`PENDING_APPROVAL` —— G07 已执行且失败，M1-Core 验收被阻断，未签发任何 Gate PASS。
> 权威来源：Requirement
> [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.13.5；Active Design
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md) §13.1；当前项目状态仅由
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 登记。本文仅为执行/候审证据，不替代 Requirement、
> Design 或 Owner Acceptance。

## 1. G07 Execution Report

### 1.1 固定身份与一次性授权

| 项 | 实际值 |
|---|---|
| Repository / Branch | `quanyantan-svg/modern-erp` / `work/m1-core-rebaseline-20261102` |
| 被测 SHA | `9bcbedab078d5cc707e2af0f928452042c74e6f3` |
| Run ID | `1197f81a-4a9c-4587-944c-64f11cbad47c` |
| Manifest | `M1_CORE_G07_V1` |
| Fixture digest | `2202e6c21142528bd2b21f276abcacbf250af06624a456b84ec12263e15c808c` |
| 目标 | `127.0.0.1:3306/modern_erp_domain_test` / `modern_erp_test` |
| `CURRENT_USER()` | `modern_erp_test@127.0.0.1` |
| Server UUID | `256c7a4e-d275-11f1-885b-b025aa71d167` |
| Grants SHA-256 | `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e` |
| ACK-4 窗口 | `2026-11-05T00:27:20.8090953Z` → `2026-11-05T00:37:20.8090953Z` |
| 有序操作 | `RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_M1_HTTP_FIXTURES` → `CLEANUP_SCHEMA_POST_RUN` |

Approval 使用项目所有者角色标识 `PROJECT_OWNER`，channel 为本次项目对话，reference 直接指向
用户本轮「批准基于新 SHA 重新执行一次 G07，并推进 acceptance」的消息。审批临时 JSON
签发后已删除；DPAPI Capability 内容、数据库密码与 Bearer Token 未写入仓库或本报告。

### 1.2 执行前只读 preflight

| 检查 | 结果 |
|---|---|
| 工作树 / HEAD | clean；HEAD 精确等于被测 SHA |
| GitHub / Gitee 同名分支 | 两端均精确指向被测 SHA |
| `target.json` / DPAPI | 存在且可用；八字段与授权一致 |
| MySQL / grants | MySQL `8.0.37`；最小权限校验 PASS；grants digest 一致 |
| 五类对象 | tables/views/triggers/routines/events = `0/0/0/0/0` |
| `log_bin_trust_function_creators` | `1` |
| `performance_schema` | 启用；`data_lock_waits` 可读；preflight 时 waiter = 0 |
| ACK-4 Quarantine | 无未解决 marker |
| HTTP 端口 | `33101` / `33102` 未被占用 |
| 静态合同 | digest 一致；CR=9；6 个正式主体；5 个 L2 前置；四操作顺序一致 |

已知环境风险保持 `OPEN`：存在两个 `mysqld` 进程；三个常见 MySQL 启动配置路径均缺失。
本轮没有终止进程、重启 MySQL 或修改全局参数。

### 1.3 执行阶段与终态

| 阶段 | 结果 |
|---|---|
| ACK-4 | 新 Capability 成功签发并原子消费；issued 文件已不存在；consumed 记录存在 |
| Root / Child Lease | Root 启动；5 个 child lease 均有已消费记录 |
| Reset | 已执行；未报错 |
| Bootstrap | 已执行；App 后续可启动并执行 Fixture Setup |
| App-A / App-B | 两个 App 进程已启动；六个主体登录环节未报错 |
| Fixture Setup | 顺序到达 `CR-08.issue`，该步失败 |
| Suite | **未创建/未启动** |
| Cleanup | 执行 1 次；Root 报告 `cleanupProven=true` |
| Child exit | `childrenExited=true`；`childCount=5` |
| 独立 postflight | Root 通过；事后另一次只读核验为 `0/0/0/0/0` |
| Quarantine | 无 |
| Root 终态 | `FAILED`；`testsPassed=false` |

Root Node 进程因未捕获的 Fixture Setup 异常以非零退出；外层执行工具观测到的命令退出码为 `1`。
Launcher 实际输出 `RESULT = FAIL` 与 `ACK-4 STATE = FAILED`。脚本源码的 FAILED 分支合同是 `exit 5`，
但本次外层观测值并非 5；本报告不将源码意图冒充实测退出码，该差异保持 `OPEN`。

### 1.4 失败详情与 CR 结果

```text
M1_G07_FIXTURE_SETUP_BLOCKED:CR-08.issue:http 500
code=ER_DATA_TOO_LONG
requestId=64579f30-eefe-4159-ad09-a794c5babc8c
```

- 阶段：`RUN_M1_HTTP_FIXTURES` 的 Fixture Setup（Suite 创建前）。
- CR / Step：`CR-08.issue`。
- 主体：`outsourcing`。
- 请求：`POST /api/procurement/outsourcing/orders/{orderId}/issues`。
- 预期：2xx Setup 成功。实际：HTTP `500`，`ER_DATA_TOO_LONG`。
- 根因线索：MySQL 报告某写入值超出列容量；当前脱敏错误不包含具体列名。本轮不猜测列、
  不修改 Handler，也不重试。

| CR | Fixture Setup | 真实并发 Suite | 结论 |
|---|---|---|---|
| CR-01 | 已通过并继续到后续场景 | 未启动 | `NOT_RUN` |
| CR-02 | 已通过并继续到后续场景 | 未启动 | `NOT_RUN` |
| CR-03 | 已通过并继续到后续场景 | 未启动 | `NOT_RUN` |
| CR-04 | 已通过并继续到后续场景 | 未启动 | `NOT_RUN` |
| CR-05 | 已通过并继续到后续场景 | 未启动 | `NOT_RUN` |
| CR-06 | 已通过并继续到后续场景 | 未启动 | `NOT_RUN` |
| CR-07 | 已通过并继续到后续场景 | 未启动 | `NOT_RUN` |
| CR-08 | `issue` 步骤 `FAIL` | 未启动 | `FAIL`（Setup） |
| CR-09 | 未到达 | 未启动 | `NOT_RUN` |

因 Suite 未启动，本轮没有 CR-01～CR-09 的竞态 HTTP status/error-code 对、A/B lock waiter、真实
Schema Parity、SQLite/MySQL 对等或补充 Oracle PASS 证据。不得以已通过的 Setup 冒充并发 Gate PASS。

## 2. M1-Core Acceptance Review Packet

### 2.1 七项 Gate 候审矩阵

| Gate | Requirement | 实际实施/验证证据 | 独立审查 | 候审状态 | 剩余风险 / Owner 待办 |
|---|---|---|---|---|---|
| G01 | §31.13.5 `M1C-G01` | WP1 实施验收；WP7-A SQLite/L1 HTTP `PASS_WITH_RESIDUAL` | 无独立 Gate 审查 | `INCONCLUSIVE` | MySQL 对等/并发未取得；Domain Owner |
| G02 | §31.13.5 `M1C-G02` | WP7-A 委外收货/IQC/职责分离 SQLite HTTP `PASS_WITH_RESIDUAL` | 无独立 Gate 审查 | `INCONCLUSIVE` | MySQL 对等未取得；加工费必填政策未裁定；Domain Owner |
| G03 | §31.13.5 `M1C-G03` | WP7-A L1 HTTP + L2 canonical primitive；SQLite `PASS_WITH_RESIDUAL` | G03 L1/L2 Design 已独立审查/提升，非 Gate Acceptance | `INCONCLUSIVE` | MySQL 严格跟踪/唯一性动态证据缺失；Domain Owner / DB Safety |
| G04 | §31.13.5 `M1C-G04` | WP7-A 增量倒冲/估值/成品 SQLite `PASS_WITH_RESIDUAL` | 无独立 Gate 审查 | `INCONCLUSIVE` | MySQL 并发与成本证据未取得；加工费 provisional 口径未裁定；Domain Owner |
| G05 | §31.13.5 `M1C-G05` | 修复后已登记 Browser `24/24` | `M1C_G05_INDEPENDENT_REVIEW_PASS` | `INCONCLUSIVE` | 独立审查明确不是 Owner Acceptance；Domain Owner 正式签字待定 |
| G06 | §31.13.5 `M1C-G06` | WP7-A 来源级 Guard/普通采购防误伤/zero-side-effect SQLite `PASS_WITH_RESIDUAL` | 无独立 Gate 审查 | `INCONCLUSIVE` | MySQL 对等未取得；延期会计政策仍开放；Domain/Accounting Owner |
| G07 | §31.13.5 `M1C-G07` | 本次唯一真实 MySQL Run；失败于 `CR-08.issue` Setup | 执行准备有独立证据，本次失败无 PASS | `FAIL` | `ER_DATA_TOO_LONG`；Suite/CR 并发/Parity/Oracle 未执行；Domain Owner / Platform / DB Safety |

### 2.2 已有 Owner 决议与不可扩张边界

- `M1_CORE_REQUIREMENT_ACCEPTANCE_PASS` 与 `M1_CORE_DESIGN_PASS` 已由 Owner 签发；它们是合同验收，
  不是任何 Gate PASS。
- `M1-P-03` 职责分离已批准；`A-P01` 唯一通知模型已确认。
- WP0/WP1 的实施验收不等于 G01～G07 验收。
- G05 只有独立技术审查 PASS，Owner 正式 Acceptance 仍为 `PENDING_APPROVAL`。
- 本次空库 `BOOTSTRAP_CURRENT_SCHEMA` 成功不构成历史 M-15 Migration / PRE-A/B/C 验收。
- M1-Core 包级 Acceptance 即使未来通过，也不等于 M1 全域 Closure 或 Procurement & Outsourcing Domain Acceptance。

### 2.3 开放风险与待裁定项

1. **G07 必备阻断**：`CR-08.issue` 在 MySQL Setup 返回 `ER_DATA_TOO_LONG`；未取得任何真实并发/
   lock-wait/parity/oracle PASS。
2. **G05 Owner 签字**：技术独立审查已通过，但 Owner Gate Acceptance 未签发。
3. **G01～G04/G06 证据层级**：已有 SQLite/L1 执行证据，但不得由本次失败的 G07 自动补成
   MySQL 对等或 Owner Gate PASS。
4. **业务/会计政策**：加工费 `processingFeeCents` / `unitPriceCents` 必填与最终成本口径未裁定；
   延期 AP/GL/VMI 政策仍开放，G06 仅证明安全拒绝设计的 SQLite 证据。
5. **权限残留**：`RECEIPT_NOTICE_MANAGE`、`PO_CHANGE_MANAGE`、`PROCUREMENT_CONFIG_MANAGE`、
   `ENGINEERING_BOM_MANAGE` 仍是 admin-only 差距；admin 行为不作为 SOD 证据。
6. **两项已知环境/测试工具风险保持 `OPEN`**：两个 `mysqld` 进程；MySQL 启动配置文件缺失。
   本次清理成功不表示这两项已修复。
7. **新观测到的工具差异**：issuer 在单独 Windows PowerShell 5.1 子进程中未自动加载
   `System.Security`；本次以同进程预加载后成功调用原 issuer。此外，外层执行工具观测退出码
   `1` 与 Launcher FAILED 分支源码合同 `5` 不一致。两者均未在本轮修改。

## 3. 候审结论

```text
M1_CORE_ACCEPTANCE_BLOCKED
```

阻断项为 G07 真实执行 `FAIL`、G05 Owner Acceptance 未签发，以及 G01～G04/G06 尚不具备
可由本候审包签发为 Gate PASS 的完整证据/独立审查边界。本文不签发
`M1_CORE_ACCEPTANCE_PASS`、Capability Freeze、Manual Closure、Domain Acceptance 或 Release Readiness。
