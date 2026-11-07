# M1-Core 第二批离线补证（WP-C）与 WP-D / WP-K 候审（2026-11-07）

> 用途：登记 M1-Core 第二批工作包的实施与候审结果：WP-C（G03 多物料行与 SERIAL 身份物理
> 腿数补证，SQLite L1）、WP-D（G04 负增量可达性审查，**只读分析**）、WP-K（G07 证据边界
> 更正**草案**，未签发）。
> Owner：Platform / Database Safety / QA（补证与证据维护）；Procurement & Outsourcing
> Domain Owner（Gate 验收决定、WP-D 可达性裁定、WP-K 是否采纳的裁定）。
> 状态：`PENDING_APPROVAL` —— 离线补证已实施并复验；WP-D 与 WP-K **只产出分析与草案**，
> **未签发**任何 Acceptance，**未修改**任何已签发结论。
> 权威来源：Active Design `docs/design/procurement-outsourcing-m1-core.md` §13.1 / §13.1.1；
> Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5；
> 既有候审证据 [`m1-core-wp7a-r1-offline-evidence-20261107.md`](./m1-core-wp7a-r1-offline-evidence-20261107.md)。
> 本文是补证证据，**不**替代 Requirement、Design 或 `docs/status/PROJECT_STATUS.md`。

## 1. 本批范围

| 工作包 | 性质 | 产出 |
|---|---|---|
| **WP-C** | 实施（测试） | 新增 `server/m1c-wp7a-g03-multi-material.test.js`（6 例，已登记 **FULL**，非 FAST） |
| **WP-D** | **只读分析** | [`m1-core-g04-negative-increment-reachability-20261107.md`](./m1-core-g04-negative-increment-reachability-20261107.md) —— 可达性分类 + D-1/D-2 方案对比与推荐 |
| **WP-K** | **只起草，不签发** | [`m1-core-g07-evidence-boundary-draft-20261107.md`](./m1-core-g07-evidence-boundary-draft-20261107.md) —— 四类证据强度列明 + 追加式边界说明 + 待 Owner 裁定事项 |

**未改动**：生产 Handler、DDL、Migration、Fixture 合同、G07 Oracle、Active Requirement、Active
Design、Gate 合同、CR 集、ACK-4 合同、治理状态（`docs/status/PROJECT_STATUS.md`）。
唯一新增的生产侧文件是**测试支撑模块**（`server/test-support/m1-core-g03-g04-evidence.js`，
第一批已新增，本批仅复用）与**测试文件**。

## 2. WP-C —— G03 多物料行与 SERIAL 身份物理腿数（SQLite L1）

### 2.1 合同锚点

Active Design §13.1 的 G03 成功列：「沿 canonical 仓位写真实物理库存、跟踪与估值；企业所有权
不变；内部仓与 WIP 仓数量与流水可对账；**多物料行与 SERIAL 拆分各自成键，实际腿数 == 预期腿数**」。

此前 G03-1 只覆盖**单物料单身份**各发一次，多物料行与 SERIAL 拆分的腿数断言**没有断言位**。

### 2.2 场景构造（全部经生产 HTTP API，L1）

- 一个委外订单，三条物料行：**LOT**（批次跟踪）、**NONE**（非跟踪）、**SERIAL**（序列号跟踪）。
- 四次**独立**的合法发料：LOT 一次、NONE 一次、SERIAL **两个不同序列号各一次**。
- **SERIAL 每次数量严格为 1**（生产合同的 SERIAL 策略要求）；**未**改造 HTTP API 为批量发料，
  **未**发起数量为 2 的 SERIAL 请求。
- 直接 SQL（L3）仅三处，且都是没有生产写入入口的字段：`products.valuation_method`、
  `inventory_valuation_balances` 种子行、`inventory_lot_balances` 种子行。
- 本文件**独立**于 G03 / G04 / G06 的其它用例，不依赖它们的执行顺序；拥有一次性临时 SQLite。

### 2.3 六项断言

| 例 | 断言 |
|---|---|
| `G03-M1` | 四次发料产生**四个不同的业务事件 ID**；每次发料落一张委外发料单（订单、物料行、数量、幂等键精确）；每张发料单名下恰好两条物理流水 |
| `G03-M2` | 每个合法 MOVE **恰好一条 OUT、一条 IN**，四次共**八条物理腿**；OUT 腿来自来源仓、IN 腿进入供应商 WIP 仓，数量绝对值等于发料量 |
| `G03-M3` | 物料行与身份键**精确对应**：LOT → `LOT:<lotId>`、NONE → `NONE`、SERIAL-1/SERIAL-2 → 各自 `SERIAL:<id>`；身份余额恰好四行，供给量、消耗量、可用量与 `evidence_state` 精确；**不串行**（LOT 物料行不得承载 SERIAL 身份、NONE 物料行不得承载跟踪身份、SERIAL 物料行只允许承载本单两个序列号）；身份效果恰好四条，挂在正确的物料行、身份键、业务事件下 |
| `G03-M4` | 每条物理腿**恰好一条**跟踪记录与**恰好一条** POSTED 估值记录，跟踪与估值都关联同一业务事件、同一货品、同一仓位，数量相等；物理腿 `valuation_status='VALUED'` |
| `G03-M5` | 来源仓与供应商 WIP 仓**数量守恒**（来源 = 初始 − 发料，WIP = 累计发料，两者合计 = 初始）；两个仓位的 `owner_type='ENTERPRISE'`、`owner_id IS NULL` |
| `G03-M6` | 同一外部幂等键**同内容重放**返回 200 且 `replayed=true`，**不产生第二次物理动作**、不改变任何 G03 业务事实；**异内容**（同键不同数量）稳定 409，G03 完整业务事实**逐字段零变化** |

### 2.4 非空洞负控（三项变异实验，临时改生产代码后完整恢复，生产文件 `git diff` 为空）

| 变异 | 结果 |
|---|---|
| **A（精准）**：把 LOT 的身份键**字符串**改写为 `LOT:SERIALISED`（身份与仓位不变） | **仅 `G03-M3` FAIL**，其余五项 PASS ⇒ 身份分域断言精确承重 |
| **B**：把跟踪记录的 `transaction_id` 统一指向第一条腿 | **仅 `G03-M4` FAIL** ⇒ 跟踪↔物理腿关联断言精确承重 |
| **C**：MOVE 不再产生 IN 物理腿 | `G03-M1` / `G03-M2` / `G03-M4` FAIL ⇒ 腿数断言与事件级腿断言承重 |

（另：第一轮曾用「把所有身份压成 `NONE`」的宽泛变异，导致多个用例同时失败；已改为上表的精准
变异，以证明**各断言各自**承重。）

## 3. WP-D —— G04 负增量可达性审查（只读分析）

完整结论见 [`m1-core-g04-negative-increment-reachability-20261107.md`](./m1-core-g04-negative-increment-reachability-20261107.md)。摘要：

| 断言 | 可达性分类 |
|---|---|
| 增量 **> 可用净供应** → 409 | **合法生产 HTTP 可达**，已由真实 MySQL Run `b29c3f1f` 的 **CR-07 / CR-08** 证明 |
| 增量 **< 0** → 409 | **仅 L3 SQL / 历史数据异常可构造**；合法生产 HTTP **不可达** |
| 增量 < 0 的**防御性行为** | **当前无断言位**（可由受控异常种子 + 生产 Handler 证明） |

关键不变量：`outsourcing_receipts.business_status` 只有 `PENDING_INSPECTION → EFFECTED` 单向
迁移（唯一 UPDATE 在 `server/modules/outsourcing-finance.js:234`，不改数量、无 DELETE）；
`backflushed_quantity` 只有两个写入者且都是「+ 恒正增量」（`outsourcing-finance.js:217`、
`outsourcing.js:607`）；BOM 快照一次性建立（`outsourcing.js:420-422`，重复建立即 409
`OUTSOURCING_MATERIAL_SNAPSHOT_IMMUTABLE`）且每次计算前复核基数（两处 1e-9 比较）；
累计合格收货量因状态单向、无删除、无数量改写而**不减**；同一 (收货, 物料, 身份) 的物理变更受
`inventory_mutation_log.idempotency_key UNIQUE` 约束保护，**不存在并发双累计**。

**推荐 D-1 → D-2 组合**：先以受控异常种子取得**可执行**的防御性证据（D-1），再以它支撑
Active Design §13.1 G04 拒绝列的可达性标注修订（D-2）。**两者都不解决**「历史库中是否已存在
异常行」这一存量问题（需独立的数据核查授权）。**本包未实施 D-1 / D-2，未修改 Active Design。**

## 4. WP-K —— G07 证据边界更正草案（未签发）

完整草案见 [`m1-core-g07-evidence-boundary-draft-20261107.md`](./m1-core-g07-evidence-boundary-draft-20261107.md)。摘要：

| 类别 | 内容 |
|---|---|
| **已证明** | 真实 MySQL 执行成功；Schema Parity 16/16 全 MATCHED；竞争的胜败与精确错误码；拒绝审计恰好 1 条；幂等胜者唯一、败者无记录；业务来源匹配；四项派生 delta 等于固定期望；Cleanup 一次完成与 Postflight PROVEN；ACK-4 一次性消费与四操作按序 |
| **未充分证明** | **败方相关业务行的全字段逐字段零变化** —— 真实 oracle 只比较**新增行**与**派生聚合量**，既有行的**原地字段改写**不可被检出 |
| **恒真 / 恒等式** | `loserBusinessRowDelta`、`winnerBusinessRowDelta`（常量）、7 个 CR 的 `identityDelta`（常量）、守恒表达式 `opening + change === closing`（`change` 被定义为 `closing − opening`，是算术恒等式） |
| **未启用** | `expectedSnapshot` 的逐字段全量比较分支（代码存在，真实 suite 从未使用，真实运行无该数据） |

**口径更正**：真实 MySQL G07 **确实采集**了完整表快照，但**没有**用它做逐字段全量比对 ——
**不得**把「采集完整表快照」表述为「已逐字段校验完整快照」。

**对已签发 PASS 的评估**：已签发的 `M1C-G07 PASS` 的验收对象**每一项都有机器状态与断言位
支撑**，且**没有任何一项**依赖上述恒真项或未启用分支 ⇒ **该 PASS 不因本草案失效**；但任何依据
它推断「败方业务行逐字段零变化已被证明」的表述**超出证据**。

**待 Owner 裁定**：(1) 是否采纳追加式证据边界说明；(2) **是否接受该残余证据偏差用于 M1-Core
包级验收**；(3) 是否启动 G07 Oracle 强度补强（WP-J，新 Oracle 的结论只能来自**新的 Run**，
不得追溯适用于 `b29c3f1f`）；(4) 是否接受 WP-D 的 D-1 → D-2 组合。

**本包未修改**已签发的 `m1-core-g07-owner-acceptance-20261107.md`，**未修改**
`docs/status/PROJECT_STATUS.md`。

## 5. 离线复验

| 项 | 结果 |
|---|---|
| Focused `server/m1c-wp7a-g03-multi-material.test.js`（WP-C） | **6/6 PASS** |
| Focused WP-A / WP7-A / WP1(G01) / WP2-WP5 | **4/4 · 12/12 · 26/26 · 13/13 PASS** |
| 变异实验（3 项） | 全部按预期 FAIL → 恢复后 PASS；生产文件 `git diff` 为空 |
| FAST | **576/576 PASS**，0 fail / 0 skipped / 0 todo |
| FULL | **3337/3337 PASS**，0 fail / 0 skipped / 0 todo |
| Build / Node `--check` / `git diff --check` | PASS |
| docs current / migration | **ALL CHECKS PASSED** |

## 6. 本批**未**关闭的缺口

| 缺口 | 状态 |
|---|---|
| G04「增量 < 0」的合法 HTTP 可达性 | 已完成**只读审查**并给出分类与推荐（D-1 → D-2）；**未实施** D-1 / D-2，未修改 Active Design |
| G04「增量 < 0」的防御性行为断言 | **未补**（需 D-1 授权） |
| G04 拒绝在 SQLite 侧的补证 | **未补**（WP-G，可提交残余风险；真实 MySQL 已由 CR-07 / CR-08 覆盖） |
| G01 的真实 MySQL 分支 | **未补**（WP-I，不新增 CR、不申请 ACK-4） |
| G07 Oracle 的败方逐字段零变化等四项强度问题 | **未改**（WP-J，不修改已签发 G07 的 Oracle） |
| G07 PASS 的证据边界更正 | **只起草，未签发**（WP-K） |
| G01/G03/G04 的 Owner Acceptance | **未签发** |

## 7. 候审结论

```text
M1C_WP7A_R2_WP_C_IMPLEMENTED_WP_D_ANALYZED_WP_K_DRAFTED_READY_FOR_REVIEW
```

本批只产出**离线补证证据**与**两份候审草案**。G01/G03/G04 仍为 `INCONCLUSIVE`，
`M1_CORE_ACCEPTANCE_BLOCKED` 保持；G02/G05/G06/G07 的已签发 Owner Acceptance 不受本批影响。
