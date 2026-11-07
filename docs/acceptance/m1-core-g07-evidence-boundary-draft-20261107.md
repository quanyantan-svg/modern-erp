# M1-Core G07 证据边界更正 —— **候审草案（未签发）**（2026-11-07）

> 用途：登记对已签发 `M1C-G07 PASS` 的**追加式证据边界更正草案**，把真实 MySQL G07 证据按
> 「已证明 / 未充分证明 / 恒真或恒等式 / 未启用」四类逐项列明，供 Owner 独立裁定。
> Owner：Platform / Database Safety / QA（草案维护）；Procurement & Outsourcing Domain Owner
> （是否采纳、是否影响包级验收的裁定）。
> 状态：**`DRAFT — NOT_ISSUED`** —— 本文**只是草案**，**未签发**、**不构成**任何 Acceptance、
> **不修改**已签发的 `M1C-G07 PASS`，也**不修改** `docs/status/PROJECT_STATUS.md`。
> 权威来源：`docs/acceptance/m1-core-g07-owner-acceptance-20261107.md`（已签发的 G07 Owner
> Acceptance，**保持原样**）、`docs/design/procurement-outsourcing-m1-core.md` §13.1 G07 行与
> §13.1.3、`server/test-utils/m1-core-g07-oracle.js`、
> `server/test-support/m1-core-g07-contract.js`。
> 本文是证据边界草案，不是 Requirement、Design 或项目状态权威来源。

## 0. 本草案的性质与边界

- **只起草，不签发**。本文不产生任何 Gate PASS、包级 Acceptance、Freeze 或 Release Readiness。
- **不改写历史**。已签发的 `M1C-G07 PASS`（Run `b29c3f1f` / SHA `054ebb67…`）与其验收证据
  `m1-core-g07-owner-acceptance-20261107.md`、`PROJECT_STATUS.md` §37.48 **保持原样**。
- 本草案**追加**一条边界说明，供 Owner 判断「该残余证据偏差是否可被接受用于 M1-Core 包级验收」。
- 依据：`AGENTS.md` §2.2 的状态语义（`PENDING_APPROVAL` / `APPROVED` / …）与 §5.9 的
  supersession 要求 —— 历史结论保留，边界以**日期化追加**说明。

## 1. 四类证据强度逐项列明

### 1.1 已证明（有真实 MySQL 机器状态与断言位支撑）

| 断言 | 证据 |
|---|---|
| 真实 MySQL 8.0.37 执行成功 | Run `b29c3f1f-8175-42ed-9e9c-2f0faff16798`，SHA `054ebb67…`，Suite child exit 0 |
| **Schema Parity 16/16 全 MATCHED，零差异** | `assertM1CoreInformationSchemaParity()` 对 `M1_CORE_PARITY_TABLES` 全表比对；任一差异即抛 `M1_SCHEMA_PARITY_MISMATCH`；测试通过 |
| 竞争的**胜败与精确错误码** | `assertG07RaceOutcome()` 断言恰一成功 + 恰一失败（精确 status + error code），逐 CR 生效 |
| 拒绝审计**恰好 1 条**且与失败码相关 | `audit.exactRequestReject`（失败码命中 + 实体相关）+ `audit.count === 1` |
| 幂等**胜者成功一次、败者无记录** | `idempotency.winnerSucceeded === 1` + `loserAbsent` |
| 业务**来源匹配** | `sources.allMatched`（逐 CR 的来源单据/明细/PO 行核对） |
| 四项**派生 delta**（`documentDelta` / `quantityDelta` / `amountDeltaCents`）等于固定期望 | 由 before/after 快照**实测推导**后与固定期望比较（非由幂等计数推断） |
| Cleanup 一次完成、**Postflight PROVEN** | Root 自带的独立只读 postflight 重新证明身份并计数五类对象，clean；执行后另起的独立只读复验同样得到 `0/0/0/0/0` |
| ACK-4 **一次性消费**、四操作按序、6 个 child lease 全消费、Quarantine NONE | `ack4/consumed/`、`ack4/children/`、postflight 与五类对象清单 |

### 1.2 未充分证明（真实 MySQL 上**没有**对应的逐字段断言）

| 断言 | 现状 | 依据 |
|---|---|---|
| **败方相关业务行的全字段零变化** | Design §13.1 G07 行要求「拒绝方 PO / Item / 幂等 / 审计及下游快照**逐字段**相同（**不得只断言数量**）」。真实 oracle **只断言数量与派生聚合量**：`added(before, after, table)` 只按 id 识别**新增**行，既有行的**原地字段改写**不进入任何比较 | `server/test-utils/m1-core-g07-oracle.js:7`（`added()`）；`server/mysql-m1-core-g07.integration.js:49`（`fullSnapshot()` **采集**完整行，但只被当作聚合量的原料） |
| 败方**既有行被原地改写**这一类失败模式 | **不可被现有 oracle 检出** | 同上 |
| 快照的**逐字段全量比较** | `assertG07Result()` 中存在 `snapshot` vs `expectedSnapshot` 的全量 JSON 相等分支，但真实 suite 使用的是 `assertRealG07Oracle()`，且真实运行**不存在** `expectedSnapshot` | `server/test-support/m1-core-g07-contract.js:137-143` |

**口径更正**：真实 MySQL G07 **确实采集**了完整表快照（`SELECT *` + 主键排序），但**没有**用它做
逐字段全量比对。**不得**把「采集完整表快照」表述为「已逐字段校验完整快照」。

### 1.3 恒真断言或算术恒等式（**不能**承载任何证明力）

| 项 | 性质 | 依据 |
|---|---|---|
| `effects.loserBusinessRowDelta` | **常量**：初始化为 `0`，9 个 CR 分支**从不重算**；断言为「常量 ≠ 0」⇒ **永不可能失败** | `server/test-utils/m1-core-g07-oracle.js:47`；`server/test-support/m1-core-g07-contract.js:171` |
| `effects.winnerBusinessRowDelta` | 同上，常量 `1` | `oracle.js:47`；`contract.js:172` |
| `effects.identityDelta` | **仅 CR-01（`allocations.length`）与 CR-09（`items.length`）真实重算**；其余 **7 个 CR** 保留初值 `1` 并与期望值 `1` 比较 ⇒ **恒真** | `oracle.js:53`（CR-01）、`oracle.js:89`（CR-09）；`contract.js:166-170` |
| 守恒等式 `leg.opening + leg.change === leg.closing` | `change` 被**定义**为 `closing − opening`（`oracle.js:22-24`），断言的是**算术恒等式** ⇒ **恒成立**。legs 真正承载的只是「`opening`/`closing` 为安全整数、`sourceId`/`identity` 非空」；其数值承重来自 `quantityDelta` 与固定期望的比较，而非该方程 | `oracle.js:22-24`；`contract.js:179` |

### 1.4 未启用的分支

| 项 | 状态 |
|---|---|
| `assertG07Result()` 的 `snapshot` vs `expectedSnapshot` **逐字段全量比较**分支 | 代码存在（`contract.js:137-143`），**真实 suite 从未使用**，且真实运行**没有** `expectedSnapshot` 数据 |

## 2. 对已签发 `M1C-G07 PASS` 的影响评估（本草案不修改该 PASS）

| 维度 | 评估 |
|---|---|
| PASS 的**验收对象** | 「11/11 PASS、16 表 Schema Parity 全 MATCHED、CR-01～CR-09 通过真实生产 Handler 与 MySQL 并发 Oracle、Root FINISHED、Cleanup/Postflight PROVEN、五类对象归零、ACK-4 一次性消费」—— 上述**每一项都有机器状态与断言位支撑**，且**没有任何一项**依赖 §1.3 的恒真断言或 §1.4 的未启用分支 |
| §1.3 的恒真项 | `loserBusinessRowDelta` / `winnerBusinessRowDelta` / 7 个 CR 的 `identityDelta` / 守恒方程 —— 它们在 PASS 签署时**已经**是恒真的；PASS 的其它断言（胜败与精确错误码、四项派生 delta、拒绝审计、幂等、来源匹配、Schema Parity、Cleanup/Postflight）**不依赖**它们 |
| §1.2 的缺口 | 真实 MySQL G07 **没有**证明「败方业务行逐字段零变化」。该缺口属于 **G07 合同中的一条子断言**，不属于已签发 PASS 的对象清单 |
| 结论 | **已签发的 `M1C-G07 PASS` 不因本草案失效**；但任何依据「M1C-G07 PASS」推断「败方业务行逐字段零变化已在真实 MySQL 证明」的表述**超出证据**，应予更正 |

## 3. 追加式证据边界说明（建议采纳的表述）

> `M1C-G07 PASS`（Run `b29c3f1f` / SHA `054ebb67…`）证明的是：真实 MySQL 8.0.37 上注册套件
> 11/11 通过；16 张 Parity 表 Schema 全 MATCHED；CR-01～CR-09 的并发**恰一成功 + 恰一精确
> 错误码**、拒绝审计恰好 1 条、幂等胜者唯一且败者无记录、业务来源匹配、四项派生 delta 等于固定
> 期望；四操作按序、6 个 child lease 全消费、Cleanup 一次完成、Postflight PROVEN、五类 Schema
> 对象归零、Quarantine NONE、ACK-4 一次性消费。
>
> 该 PASS **不**主张、且当前证据**不**支持：败方相关业务行的**全字段逐字段**零变化。真实
> oracle 以**新增行**与**派生聚合量**为比较口径，既有行的原地字段改写不可被检出；oracle 中的
> `loserBusinessRowDelta` / `winnerBusinessRowDelta`、7 个 CR 的 `identityDelta` 与守恒表达式为
> **恒真 / 算术恒等式**，不承载证明力；`expectedSnapshot` 的逐字段全量比较分支**未启用**。

## 4. 需 Owner 裁定的事项（**本草案不预设答案**）

| # | 待裁定事项 | 说明 |
|---|---|---|
| 1 | 是否采纳 §3 的追加式证据边界说明 | 采纳 = 在 `docs/acceptance/` 增加一份**追加**记录并登记索引；**不**修改 `m1-core-g07-owner-acceptance-20261107.md`，**不**修改 `PROJECT_STATUS.md` §37.48 的 `M1C-G07 PASS` |
| 2 | **是否接受该残余证据偏差用于 M1-Core 包级验收** | 这是包级验收的独立判断：G01/G03/G04 仍 `INCONCLUSIVE`，本草案**不**改变它们；Owner 若认为「败方逐字段零变化」缺口必须先补证，则 G07 的证据强度需先提升（见下） |
| 3 | 是否启动 G07 Oracle 强度补强（WP-J） | 方案：把败方断言改为**完整行逐字段比较**（可发现原地改写）、删除两项常量 delta、让 7 个 CR 的 `identityDelta` 真实推导、把守恒改为**跨表恒等式**、为每个 CR 固化期望终态快照以启用 `expectedSnapshot` 分支。**该改造会使 Oracle 的断言强度高于已签发 PASS 时的强度**，因此新 Oracle 的结论只能来自**新的 Run**，**不得**追溯适用于 `b29c3f1f`；需要新的 ACK-4 授权与新 Run ID |
| 4 | 是否接受 WP-D 推荐的组合方案（D-1 → D-2） | 见 `m1-core-g04-negative-increment-reachability-20261107.md` §8 |

## 5. 未发生

未签发任何 Acceptance、未修改已签发的 `m1-core-g07-owner-acceptance-20261107.md`、未修改
`docs/status/PROJECT_STATUS.md`、未修改 G07 Oracle / Fixture / CR / Gate 合同、未连接真实
MySQL、未运行 G07、未签发或消费 ACK-4、未执行 Reset/Bootstrap/Cleanup/Migration、未 Push /
Merge / Tag / Release / Deploy。
