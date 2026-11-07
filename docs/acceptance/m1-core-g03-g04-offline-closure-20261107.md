# M1-Core G03 收口与 G04 离线补证候审矩阵（2026-11-07）

> 用途：登记 G07 diagnostics Windows ACL 环境复核、G03 最后补证与 G04 防御性补证，形成供
> Domain Owner 独立裁定的逐项证据矩阵。
>
> Owner：Platform / Database Safety / QA（证据维护）；Procurement & Outsourcing Domain Owner
> （G03/G04 Acceptance 与 D-2 裁定）。
>
> 状态：`PENDING_APPROVAL` —— 本文不签发 Gate PASS，不修改当前 Gate 状态。
>
> 权威来源：Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5、Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §9 / §13.1、正式 G07 Owner Acceptance
> `docs/acceptance/m1-core-g07-owner-acceptance-20261107.md`。本文是候审证据，不替代 Requirement、
> Design 或唯一状态登记 `docs/status/PROJECT_STATUS.md`。

## 1. 锚点与范围

| 项 | 值 |
|---|---|
| 用户指定基线 | `1de469217ce0ebf83b8c5a2df69c2d6df63a1718` |
| 测试实施 SHA | `c33aaa4876e91ef5288ae1aa67c07bb0dccd0fe5` |
| 分支 | `master`（仅本地；未 Push） |
| 允许修改 | 测试、测试辅助、候审证据、当日日志 |
| 未修改 | 生产 Handler、DDL、Migration、Fixture、G07 Oracle、Active Requirement / Design、已签发 Owner Acceptance |

证据等级沿用既有定义：L1 是生产 HTTP + 隔离 SQLite；L2 是 canonical primitive；L3 是明确标注的
受控异常数据种子；真实 MySQL 只引用已签发 Run `b29c3f1f-8175-42ed-9e9c-2f0faff16798` 的历史事实，
本轮未连接 MySQL、未运行 G07。

## 2. 阶段 A —— G07 diagnostics Windows ACL 环境复核

### 2.1 受限执行环境失败证据

命令：`node --test scripts/gates/m1-core-g07-diagnostics.test.js`。

- 结果：`9/10 PASS`；唯一失败是
  `production evidence writer creates a readable sanitized file with platform restriction applied`。
- 身份：`DESKTOP-OVOCP1N\CodexSandboxOffline`，用户 SID 尾号 `-1008`，Medium Integrity，属于
  `CodexSandboxUsers`。
- TEMP：`C:\Users\Administrator\AppData\Local\Temp\`；临时根目录 Owner 是 Administrators。
- 一次性探针文件 Owner 实测为 `DESKTOP-OVOCP1N\CodexSandboxOffline`，因此**不是临时文件所有权错配**。
- 完整异常链的关键帧：

```text
System.UnauthorizedAccessException: Attempted to perform an unauthorized operation.
at System.Security.AccessControl.NativeObjectSecurity.Persist(...)
at System.IO.File.SetAccessControl(String path, FileSecurity fileSecurity)
at restrictWindowsFile (scripts/gates/m1-core-g07-diagnostics.mjs:117)
at writeRestrictedDiagnosticEvidence (scripts/gates/m1-core-g07-diagnostics.mjs:143)
at TestContext.<anonymous> (scripts/gates/m1-core-g07-diagnostics.test.js:114)
```

触发点是 PowerShell `[IO.File]::SetAccessControl($p,$acl)`。文件由当前受限用户拥有，但受限令牌仍被
Windows 拒绝持久化 DACL，故根因是**执行令牌权限限制**，不是文件所有权，也没有证据指向程序逻辑错误。

### 2.2 正常 Windows 执行环境复核

同一 SHA、同一命令在普通主机令牌下执行：

- 身份：`DESKTOP-OVOCP1N\Administrator`，SID 尾号 `-500`，High Integrity，Administrators；
- 结果：`10/10 PASS`；
- 随后的普通令牌 FULL 同一 ACL 用例通过，FULL 总结果 `3343/3343 PASS`。

结论：`PROVEN — ENVIRONMENT_DIFFERENCE`。没有删除、跳过或弱化 ACL 安全断言，没有修改权限策略，
没有修改 G07 diagnostics 代码。受限沙箱不能把 `SetAccessControl` 成功作为产品 PASS；正常 Windows
令牌下原断言实际通过。

## 3. G03 独立验收矩阵

| 合同 / 候审条件 | 结论 | 层级与断言位 | 剩余边界 |
|---|---|---|---|
| ISSUE / SUPPLEMENT / RETURN 经 canonical 库存、跟踪、估值，企业所有权不变，WIP 对账 | `PROVEN` | L1：`server/m1c-wp2-wp5-outsourcing.test.js` 的 WP3；`server/m1c-wp7a-gate-acceptance.test.js` G03-1 | SQLite 行为；MySQL current-schema parity 另由已签发 G07 16/16 MATCHED 支撑 |
| 四次合法 HTTP 发料分别形成四个业务 eventId 与四条独立 Mutation Log | `PROVEN` | L1：`server/m1c-wp7a-g03-multi-material.test.js` G03-M1 | 无 |
| 每事件精确核对 `source_type/source_id/source_item_id/movement_kind/movement_group_id/idempotency_key` | `PROVEN` | L1：G03-M1 共用 `assertMutationBundle()`；Key 精确为 `OUTSOURCING_ISSUE:<eventId>:<materialId>:MOVE:<identityKey>` | 无 |
| LOT / NONE / SERIAL-1 / SERIAL-2 身份不串；物理 OUT/IN 与跟踪腿 `lot_id/serial_id` 准确 | `PROVEN` | L1：G03-M1/M3/M4；物理身份读取 Mutation Log 的 from/to position identity，跟踪身份读取 tracked legs | `inventory_transactions` 本身无 lot/serial 列，物理身份 canonical 载体是 Mutation Log position identity |
| 每事件恰好一条 Mutation Log，且关联正确 OUT / IN 两腿 | `PROVEN` | L1：G03-M1 的 log 数量、`out_inventory_transaction_id`、`in_inventory_transaction_id` 精确比对 | 无 |
| 错绑 Mutation Key、物理身份或跟踪身份会被测试发现 | `PROVEN` | L1 负控：G03-M7 复用正向验证器，分别注入跨事件 Key、SERIAL-2 物理身份、SERIAL-2 跟踪身份并要求断言失败 | 内存克隆负控，不污染数据库 |
| 同内容 replay 200 且无二次物理动作；内部同 Key 异内容严格 409 | `PROVEN` | L1 G03-M6/G03-5；L2 `server/m1c-wp7a-g03-l2-mutation-key.test.js` L2-0～L2-3 | 合法 HTTP 不控制内部 eventId，内部碰撞按已批准 L2 取证 |
| 外部同幂等键异内容：三操作 409、完整事实零变化、每次恰好一条 REJECT | `PROVEN` | L1：`server/m1c-wp7a-g03-idempotency-conflict.test.js` G03-C1～C3；D-G03-001 已独立源码审查 | 无 |
| 身份 / 缺仓 / 库存 / UOM 拒绝后完整事实逐字段零变化 + REJECT 恰好一条 | `PROVEN` | L1：G03-2/2N/3/4；18 表快照与承重负控 | 无 |
| MySQL schema 身份唯一性与行为前置 | `PROVEN`（历史真实执行） | G07 Run `b29c3f1f`：16 表 Schema Parity 全 MATCHED；CR-07/CR-08 与 Supplemental Oracle PASS；正式 G07 Owner Acceptance 保留该历史事实 | G07 PASS 不自动签发 G03；本轮未重跑 MySQL |

### 3.1 G03 候审结论

就 Requirement §31.13.5 与 Active Design §13.1 的 G03 技术条件而言，矩阵已无 `PARTIAL` / `MISSING`，
候审结论为：

```text
M1C_G03_TECHNICALLY_READY_FOR_OWNER_ACCEPTANCE_DECISION
```

这不是 `M1C-G03 PASS`。只有 Domain Owner 能签发正式 Acceptance；在该决定前，项目状态仍是 G03
`INCONCLUSIVE`，`M1_CORE_ACCEPTANCE_BLOCKED` 不变。

## 4. G04 防御性补证矩阵

| 条件 | 结论 | 层级与断言位 | 剩余边界 |
|---|---|---|---|
| 多批部分完工、增量倒冲、无双扣/双收、成品估值 Movement + Balance | `PROVEN` | L1：G04-1/G04-2、G04-R1-1/R1-2 | 本轮未改既有断言 |
| D-1：历史已倒冲量大于当前合法目标累计量 | `PROVEN`（防御性） | L1 建立合法目标与已生效收货；唯一 L3 SQL 将 `backflushed_quantity` 从 2 置 3；再经生产 HTTP 命中 409 `OUTSOURCING_WIP_INSUFFICIENT`、18 表事实零变化、REJECT +1 | 只证明异常数据下 fail closed，不证明合法 L1 可生成负增量 |
| WP-G：净 WIP 供应不足 | `PROVEN` | 全部业务造数经 L1 HTTP：供应 1、合法待检收货 2、confirm 409、18 表事实零变化、REJECT +1 | 无 |
| WP-G 的真实 MySQL 对照 | `PROVEN`（历史真实执行） | G07 Run `b29c3f1f` CR-07/CR-08 已证明净供应竞争的胜败与 `OUTSOURCING_WIP_INSUFFICIENT` | 真实 G07 的败方全字段零变化仍是 G07 候审边界；本轮 SQLite 逐字段快照补证不追溯改变该历史 Run |
| D-2 Active Design 可达性表述 | `PARTIAL — OWNER_DECISION_REQUIRED` | 拟议修订见 §4.1 | 本轮不修改 Active Design |
| 历史存量数据是否已有同类异常 | `MISSING — OUT_OF_SCOPE` | 需要独立真实数据审计授权 | 本轮禁止真实数据库 |

### 4.1 D-2 拟议修订（未实施）

建议把 G04 拒绝列拆分为：

1. 「增量 > 可用净供应 → 409」：合法生产 HTTP 可达；由 L1 SQLite WP-G 与历史真实 MySQL
   CR-07/CR-08 支撑。
2. 「增量 < 0 → 409」：仅在以下不变量成立时不可由合法 HTTP 构造；其防御性行为由 D-1 的 L3
   受控历史异常种子证明，不得冒充 L1 正常造数。

这只是候审文本，不修改 Active Design，不构成 D-2 批准或实施。

### 4.2 必须保留的前提与残余假设

- 收货状态单向迁移，已生效收货数量不被合法路径回改或删除；
- BOM / material snapshot 基数在订单执行期冻结并在计算时重读；
- `backflushed_quantity` 合法写入保持单调，且倒冲在同一事务内重读权威状态、写 Mutation Log 与业务事实；
- 不同 Mutation Key 的并发正确性**不能仅由 UNIQUE 推断**，仍依赖事务隔离、权威状态重读和 Writer 执行条件；
- 浮点残差只做过既有有限枚举（`per_unit_quantity` 0.001～0.400、含 n/3、收货量 7/11、累计至
  60 批，负增量 0 次），不是穷尽证明；
- 历史库是否已存在 `backflushed_quantity > per_unit × cumulativeFinished` 未核查；D-1 只证明防御分支；
- G07 真实 MySQL 执行 PASS 是历史事实，但已签发 PASS 不自动证明或签发 G04，也不消除 G07
  败方逐字段零变化的既有证据边界。

### 4.3 G04 候审结论

D-1 与 WP-G 本轮要求均已 `PROVEN`，但 D-2 仍需 Owner 对「合法 HTTP 可达性 + 防御性 L3」的合同
口径独立裁定，且历史存量异常未审计。因此 G04 整体候审为：

```text
M1C_G04_DEFENSIVE_EVIDENCE_PROVEN_D2_OWNER_DECISION_REQUIRED
```

不得自行签发 G04 PASS；当前 G04 `INCONCLUSIVE` 保持。

## 5. 验证结果

| Gate | 结果 |
|---|---|
| Focused（WP-A / WP-C / D-G03-001 / G03-G04 acceptance / suite governance） | `48/48 PASS` |
| FAST | `576/576 PASS`，0 fail / skipped / todo |
| FULL（普通 Windows 主机令牌，222 files） | `3343/3343 PASS`，0 fail / skipped / todo；`336614.022 ms` |
| Build | PASS（Vite 7.3.6，1968 modules） |
| G07 diagnostics ACL，受限令牌 | `9/10 PASS`，唯一 `UnauthorizedAccessException`，见 §2.1 |
| G07 diagnostics ACL，普通令牌 | `10/10 PASS` |
| docs current / migration | `ALL CHECKS PASSED`；current 的 N1、N3～N9 PASS，N2=`RETIRED`；migration C1～C6 PASS |
| `git diff --check` | PASS |

## 6. 未发生与停止点

未连接真实 MySQL，未运行 G07，未签发或消费 ACK-4，未执行 Migration / Reset / Bootstrap / Cleanup，
未修改生产代码、DDL、Fixture、G07 Oracle、Active Requirement / Design 或已签发 Owner Acceptance，未
Push / Merge / Tag / Release / Deploy。

本轮没有发现新的生产业务缺陷。证据提交完成后 HARD STOP，等待独立源码复核与 Owner 对 G03 Acceptance、
G04 D-2 的独立决定。
