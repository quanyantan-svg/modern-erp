# M1-Core G01 正式 Owner Acceptance（2026-11-07）

> 用途：登记业务所有者对 `M1C-G01` 的有界风险接受与正式 Gate 验收决定。
>
> Owner：Procurement & Outsourcing Domain Owner（正式 Gate 验收决定与风险接受）；Platform / Database Safety / QA（技术证据维护）。
>
> 状态：`APPROVED` —— 基于项目 Owner 在 2026-11-07 当前对话中对「明确接受五项残余风险、以既有
> SQLite L1 完整业务证据与真实 MySQL G07 CR-01/CR-02 有限并发证据为依据、批准有界验收例外、
> 正式签发 `M1C-G01 PASS`」的明确指令，本决定正式生效。该来源为对话中的 Owner 授权记录；
> **不存在虚构的手写签名、电子签章或外部审批单**。
>
> 权威来源：Active Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5（G01 行）
> 与 MC-REQ-02/09/11；Active Design `docs/design/procurement-outsourcing-m1-core.md` §13.1（G01 行）；
> 首期 Gate 执行记录 [`m1-core-wp7a-gate-acceptance-20261103.md`](./m1-core-wp7a-gate-acceptance-20261103.md) §3.1；
> 离线补证 [`m1-core-wp7a-r1-offline-evidence-20261107.md`](./m1-core-wp7a-r1-offline-evidence-20261107.md) §3（WP-H）；
> 已签发 [`m1-core-g07-owner-acceptance-20261107.md`](./m1-core-g07-owner-acceptance-20261107.md)；
> [`m1-core-g07-wpk-owner-adjudication-20261107.md`](./m1-core-g07-wpk-owner-adjudication-20261107.md)（WP-K 裁定）。
>
> 本文是 Gate 验收证据，不取代 Requirement、Active Design 或唯一项目状态
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。**本文件的生成本身不构成 Git 提交或远端同步。**

## 1. Owner 决定

本次裁定选择 **ACCEPT_BOUNDED_RESIDUAL_RISK**（有界风险接受），不把未证明范围伪装为通过的测试。
基于 §2 的 SQLite L1 完整业务证据、§3 的真实 MySQL 有限并发证据与 §4 的明确残余风险，**单独签发**：

```text
M1C-G01 PASS
M1C_G01_OWNER_ACCEPTANCE_PASS_WITH_BOUNDED_RESIDUAL
```

Gate 正式值为 `PASS`，**附有公开、未关闭的证据限制**。

**本决定明确不主张**（逐条列举，不留模糊空间）：

1. **不主张** WP-I 完整 MySQL 行为验证已完成 —— WP-I **未执行**；
2. **不主张** G01 全部流程已在真实 MySQL 上验证；
3. **不主张** G07 Oracle 的「竞争败方既有业务行逐字段零变化」缺口已消除 —— 该缺口按
   [`m1-core-g07-wpk-owner-adjudication-20261107.md`](./m1-core-g07-wpk-owner-adjudication-20261107.md)
   裁定作为包级验收评估的有界例外引用，**在 G01 内同样未被证明**；
4. **不主张** G01 已完成跨引擎行为对等证明。

**G01 PASS 是 Owner 对有限证据及未闭合证明缺口的验收决定，不是宣称所有断言在每种数据库和竞态下均已被实测。**

## 2. 首期已通过的 SQLite L1 生产 HTTP 证据

### 2.1 证据来源与执行归属

| 项 | 值 |
|---|---|
| 执行文件 | `server/m1c-wp1-procurement-notice-conversion.test.js`（G01 用例集，共 **26** 例） |
| 执行层级 | SQLite L1 **生产 HTTP**（真实 Handler，非 Mock） |
| 执行结果 | **26/26 PASS**（记录于 `m1-core-wp7a-r1-offline-evidence-20261107.md` §3，2026-11-07） |
| 用例构成 | A1–A8、B1–B3、C1–C8、D1–D6 共 25 例（WP7-A 原始集合），**外加后补 D0**（D0 通知创建竞争，来源提交 `84bca44`，2026-11-04） |

**执行时点纪律（不得混同）**：

- WP7-A 记录的 **25 例**执行记录**保持原样**，D0 是**后续新增**，不得追溯写为 WP7-A 原始 26 例；
- 26/26 是 WP-H 记录的**本地 SQLite 基线运行**结果；
- **不得**把 G07 的 11/11 写成 G01 26/26 的 MySQL 执行；
- 该 26/26 基线运行在来源文档中以「本轮基线实测」登记，**其本身不携带独立 Run ID 或专属 HEAD SHA
  锚点**（来源文档给出的 SHA 为用例出处与审查基线：`84bca44` / `2fe1dd84…` / `a04b7a5…` /
  `b525422…`）。本决定据实引用该事实，**不虚构**不存在的运行标识。

### 2.2 逐能力证据覆盖

| 合同对象 | 用例 | 已证明的行为（SQLite L1） |
|---|---|---|
| 单 PO 兼容、行级来源创建与显式 `converted_quantity=0` | A1 / A7 | 标准采购来源行由 canonical Writer 创建；新来源行显式写 `0`，重试不重置非零累计量 |
| 多 PO 同通知行 `sourceAllocations`、来源一致性及归属 | A2 / A3 / A4 / A6 / C7 | 多 PO 分配落库；PO / 产品 / 供应商不匹配被精确拒绝；来源分配和 ≠ 通知行时被拒 |
| 按 `business_type` 分域的容量、交期约束与不可变消费台账 | B1 / B2 / B3、D1–D5、C6 | 容量按业务类型分域独立计算；容量越界拒绝码 `RECEIPT_NOTICE_CAPACITY_EXCEEDED`；交期不可判定拒绝码 `RECEIPT_NOTICE_SCHEDULE_UNPROVEN`；已消费容量台账不可变 |
| 部分转换、累计量、同键重放、取消不恢复、直接 PO 路径 | C1–C5、C7 / C8、D1 / D2 / D6 | 部分转换后累计量正确；同键重放幂等；取消**不**恢复已消费容量；直接 PO 路径合法 |
| 历史 NULL、零交期 / 多交期不明、容量越界、来源错配的精确拒绝 | A3–A8、B2 / B3、C4–C6、D3 / D4 | 历史 NULL 拒绝码 `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN`；负向路径附业务事实快照与拒绝审计 |

## 3. 真实 MySQL 证据及其精确边界

### 3.1 历史真实 MySQL 并发子集

- **运行锚点**：G07 Run ID `b29c3f1f-8175-42ed-9e9c-2f0faff16798`；执行 SHA
  `054ebb67eb7ea5b1a82b0d51a70d54e76aaceb68`；Manifest `M1_CORE_G07_V1`；MySQL 8.0.37。
  该 Run 属于 **G07 的验收对象**，本决定**不**将其表述为 G01 的 MySQL 执行。
- **CR-01**（采购通知容量竞争）：通知容量 10、两个请求各 6，恰一成功（`201`）恰一失败（`409`），
  失败码 `RECEIPT_NOTICE_CAPACITY_EXCEEDED`。
  依据 `server/test-support/m1-core-g07-contract.js:23-29`（`successStatus: 201`、
  `failureStatus: 409`、`failureCode: 'RECEIPT_NOTICE_CAPACITY_EXCEEDED'`、
  `quantities { capacity: 10, requestQty: 6, outstanding: 6, ledger: 0 }`）。
- **CR-02**（采购入库确认竞争）：恰一 `200`、恰一 `409`，失败码
  `PURCHASE_RECEIPT_ALREADY_CONFIRMED`。
  依据 `server/test-support/m1-core-g07-contract.js:30-36`。
- 「恰一成功 / 恰一失败」由 `assertG07RaceOutcome()` 的 `exactSuccessCount` / `exactFailureCount = 1`
  强制（`server/test-support/m1-core-g07-contract.js:4-5`、`:98-112`）。

### 3.2 Schema Parity 的边界

历史 G07 的 **16 张指定表**与 canonical SQLite schema 一致（全部 MATCHED），涵盖通知来源、交期台账、
采购单据等相关表。这只证明**这 16 张表的已检查 schema 属性**，**不**证明全部 G01 业务路径的 MySQL 行为。

### 3.3 G07 Oracle 的测量强度限制（同时约束本 G01 的 MySQL 证据）

- `server/test-utils/m1-core-g07-oracle.js:7` 的 `added(before, after, table)` 只按**新增 ID** 识别新行，
  **无法检出已存在行的原地字段修改**；
- `winnerBusinessRowDelta=1` / `loserBusinessRowDelta=0` 是初始化常量（`oracle.js:47`），
  9 个 CR 分支从不重算；`identityDelta` 仅 CR-01、CR-09 真实重算；
  `leg.change = closing - opening`（`oracle.js:22-24`）使守恒方程成为算术恒等式；
- `assertG07Result()` 的 `expectedSnapshot` 逐字段全量比较分支
  （`server/test-support/m1-core-g07-contract.js:137-143`）在真实 MySQL suite 中**从未启用**。

因此 CR-01 / CR-02 的**胜败与精确错误码**、**派生聚合量**、**部分来源匹配**与**新增行检查**具有实际
证明力；但**「拒绝路径下全部既有业务行逐字段零变化」在真实 MySQL 上未被证明**。该限制按 WP-K 裁定
作为包级验收评估的有界例外引用，**在 G01 内不被豁免，也不得被表述为已证明**。

## 4. Owner 明确接受的残余风险（不转写为 PROVEN）

1. **完整 G01 HTTP + SQLite/MySQL 双引擎等价未证明**：多 PO 分配、部分转换、分域容量、交期绑定与
   回滚、取消后源容量不可恢复、直接 PO 路径、历史 NULL 防伪等流程未在真实 MySQL 逐项重演。
   Active Requirement §31.13.5 与 Active Design §13.1 的 G01 证据层均写明 **`HTTP + SQLite/MySQL`**，
   从严格逐项取证口径而言**仍未完全满足**；本决定以**明确记录的 Owner 例外**为前提。
2. **真实 MySQL 中拒绝路径的全字段零业务变化未充分证明**：受 §3.3 的 Oracle 边界制约。
3. **MySQL 不同事务交错覆盖有限**：CR-01 / CR-02 只检验已定义的两类争用，不能推断多 PO、交期、
   转换及取消路径在全部竞争组合下无缺陷。
4. **历史真实数据的不可证明来源与交期情况未在历史库上作 Migration / 现场核验**：SQLite 受控历史
   NULL 测试**不能**替代真实存量审计（且 M-15 历史 Migration 属另一授权范围）。
5. **Schema Parity 不是行为 Parity**：16/16 通过**不等于** G01 所有关键路径已跨引擎行为对等；
   不得借 G07 的 PASS 或 G03 / G04 的风险接受自动覆盖此差距。

**风险接受仅适用于 M1C-G01 单 Gate 首期能力**；不修改原 Requirement / Design 的业务规则，不给任何
非法输入或风险路径放行，不允许删减既有拒绝守卫，不代替缺陷修复。若发现真实生产不变量反例，
应新建缺陷、HARD STOP，并按治理程序重评受影响 Gate。

## 5. 验收范围之外与项目状态

- **仅本 Gate**：`M1C-G01 PASS`（附公开残余风险）。G02 / G03 / G04 / G05 / G06 / G07 各自已签发的
  Owner Acceptance **保持不变**。
- **WP-I 保持 `NOT_PROVEN / DEFERRED_NOT_AUTHORIZED`**：完整 MySQL 行为验证继续作为**公开残余风险**
  登记，**不**因本 Gate PASS 标记为 DONE。若未来生产发布或包级风险复核要求补证，必须**单独批准**
  有限范围的真实 MySQL 执行；历史 G07 ACK-4 **不可复用**。
- **`M1_CORE_ACCEPTANCE_BLOCKED` 保持**：本决定**不**签发 M1-Core 包级 Acceptance、Capability Freeze、
  Domain Acceptance、Manual Closure、Release Readiness、Tag、Release 或 Deploy。
  **即使七个 Gate 全部 PASS，包级验收也不得自动签发**，必须另行审查并正式接受全部跨 Gate 残余风险。
- 本次决定**不授权**真实 MySQL / G07、ACK-4、Reset / Bootstrap / Cleanup、Migration、生产 Handler、
  DDL、Fixture、Oracle、测试或 Active Requirement / Design 修改；也**不授权** Push、Merge、Tag、
  Release、Deploy。

## 6. 状态迁移

```text
Before : M1C-G01 = INCONCLUSIVE；G02/G03/G04/G05/G06/G07 = PASS；Package = M1_CORE_ACCEPTANCE_BLOCKED
After  : M1C-G01 = PASS（M1C_G01_OWNER_ACCEPTANCE_PASS_WITH_BOUNDED_RESIDUAL）
         其余六 Gate = PASS（**不变**）
         WP-I     = NOT_PROVEN / DEFERRED_NOT_AUTHORIZED（**保持**）
         Package  = M1_CORE_ACCEPTANCE_BLOCKED（**不变**）
```

七 Gate 当前状态：**7 / 7 `PASS`**（附有界残余风险）。包级状态**仍为 `BLOCKED`**。
Gate PASS **不等于**生产发布许可；技术验收与上线准备是两个不同阶段。
