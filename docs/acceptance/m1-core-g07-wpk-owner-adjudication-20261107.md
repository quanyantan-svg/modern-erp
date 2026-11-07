# M1-Core G07 WP-K 证据边界与包级验收风险裁定（2026-11-07）

> 用途：登记业务所有者对 `M1C-G07` 已签发 PASS 的**追加式证据边界裁定**，明确既有真实 MySQL
> Oracle 的证明边界、该残余证据偏差在 M1-Core 首期包级验收评估中的接受范围，以及 WP-J 的处置。
>
> Owner：Procurement & Outsourcing Domain Owner（风险接受与正式裁定）；Platform / Database Safety / QA（事实核验）。
>
> 状态：`APPROVED` —— 基于项目 Owner 在 2026-11-07 当前对话中对「批准追加式证据边界裁定、
> 接受该残余证据偏差作为 M1-Core 内部首期包级验收的有界例外、保留 G07 PASS、WP-J 暂不授权」
> 的明确指令，本裁定正式生效。该来源为对话中的 Owner 授权记录；**不存在虚构的手写签名、
> 电子签章或外部审批单**。
>
> 权威来源：Active Design `docs/design/procurement-outsourcing-m1-core.md` §13.1（G07 行）与 §13.1.3；
> Active Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5；已签发的
> [`m1-core-g07-owner-acceptance-20261107.md`](./m1-core-g07-owner-acceptance-20261107.md)（**保持原样**）；
> 候审草案 [`m1-core-g07-evidence-boundary-draft-20261107.md`](./m1-core-g07-evidence-boundary-draft-20261107.md)（**保持原样**）。
>
> 本文是验收证据，不取代 Requirement、Active Design 或唯一项目状态
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。**本文件的生成本身不构成 Git 提交或远端同步。**

## 1. Owner 决定

本次裁定对既有 `M1C-G07 PASS` 采用**追加式**边界说明，**不回溯改写**任何历史结论：

```text
M1C_G07_WPK_EVIDENCE_BOUNDARY_ACCEPTED_FOR_PACKAGE_REVIEW
```

裁定要点：

1. **采纳**候审草案 §3 的追加式证据边界说明，作为 M1-Core 验收材料中的正式口径。
2. **有条件接受**「竞争败方既有业务行逐字段零变化尚未证明」这一残余证据偏差，允许其在
   **M1-Core 内部首期包级验收评估**中作为**明确例外**引用。
3. **保留** `M1C-G07 PASS`；不得将未充分证明的断言描述为已证明。
4. **本轮不启动** G07 Oracle 强度补强（WP-J），标记 `DEFERRED_NOT_AUTHORIZED`。
5. **不签发** M1-Core 包级 Acceptance / Capability Freeze / Domain Acceptance / Release / Deploy。

> **本标识不是新的 G07 Gate PASS，也不是 `M1_CORE_ACCEPTANCE_PASS`。** 它是一条证据边界裁定，
> 其效力范围严格限于 §4 的例外限定。

## 2. 不予追溯改写的历史事实

| 项 | 值 |
|---|---|
| 已签发 Acceptance | `M1C-G07 PASS`（2026-11-07） |
| 执行 Commit SHA | `054ebb67eb7ea5b1a82b0d51a70d54e76aaceb68` |
| Run ID | `b29c3f1f-8175-42ed-9e9c-2f0faff16798` |
| Manifest | `M1_CORE_G07_V1` |
| 目标数据库 | MySQL 8.0.37，`modern_erp_domain_test`（`modern_erp_test@127.0.0.1:3306`） |
| ACK-4 | 已消费，**不可复用** |
| 机器执行结论 | 11/11 注册套件成功；16/16 指定 Schema Parity 表 MATCHED；CR-01～CR-09 成功运行；Root `FINISHED`；Cleanup / Postflight PROVEN；五类 Schema 对象归零 |

历史 G07 Owner Acceptance、`docs/status/PROJECT_STATUS.md` §37.48 及各失败 Run
（`94e2e0c7` / `a4c97802` / `c5ce2158` / `dcfbf040` / `df0202b6` / `a78b0d3e`）的原始记录
**保持原样，不覆盖、不改写**。追加本边界说明**不自动撤销** `M1C-G07 PASS`，也**不追溯增强**现有 Oracle 的证明力。

## 3. 既有 Oracle 的独立证明力分类（本轮已复核源码）

下表为本轮对 Oracle 与合同源码的**独立复核结论**，与候审草案 §1 一致，行号指向本轮 HEAD 的实际源码位置。

| 类别 | 可准确主张的事实 | 不能据此主张的内容 | 复核依据 |
|---|---|---|---|
| 有真实机器结果的断言 | MySQL 运行成功；16 张指定表 Schema Parity 全 MATCHED；每 CR 恰一成功及恰一指定错误码失败；拒绝审计恰好 1 条且与失败码相关；胜者幂等记录唯一、败者幂等无记录；各 CR 已实际计算的来源匹配、状态与新增行；四项派生 delta 等于固定期望；Cleanup / Postflight | 所有业务表全字段无异常改写；所有竞争组合或历史库行为 | `server/mysql-m1-core-g07.integration.js:49`、`:59`；`server/test-support/m1-core-g07-contract.js:166-175` |
| 快照采集 | `fullSnapshot()` 对所选表执行完整 `SELECT *` 并按主键排序 | 已与独立预期快照逐字段比较 —— 真实 `assertRealG07Oracle()` **没有**执行此比较 | `server/mysql-m1-core-g07.integration.js:49`；`server/test-utils/m1-core-g07-oracle.js:96-103` |
| 仅新增行比较 | `added(before, after, table)` 按新增 ID 识别新行 | 原有同 ID 行被**原地修改**可被发现 | `server/test-utils/m1-core-g07-oracle.js:7` |
| 恒真值或恒等式 | `winnerBusinessRowDelta=1`、`loserBusinessRowDelta=0` 是**初始化常量**，9 个 CR 分支**从不重算**；7 个 CR 的 `identityDelta=1` 未逐 CR 重算（仅 CR-01、CR-09 真实重算）；`leg.change=closing-opening` 使守恒方程恒成立 | 这些断言具有独立零副作用、身份守恒或跨表守恒证明力 | `server/test-utils/m1-core-g07-oracle.js:47`、`:22-24`、`:53`、`:89`；`server/test-support/m1-core-g07-contract.js:171-172`、`:179` |
| 未启用分支 | `assertG07Result()` 支持 `snapshot` vs `expectedSnapshot` 的逐字段全量比较 | 真实 MySQL G07 suite 实际使用了该分支 —— 全仓库无任何真实运行传入 `expectedSnapshot`，该分支为**未启用**代码 | `server/test-support/m1-core-g07-contract.js:137-143`；`server/mysql-m1-core-g07.integration.js:9-12`、`:59` |

**口径纪律**：真实 MySQL G07 **确实采集**了完整表快照，但**没有**用它做逐字段全量比对。
**不得**把「采集完整表快照」表述为「已逐字段校验完整快照」。同时，§1.3 的恒真项在 PASS 签署时
**已经**是恒真的，PASS 的其它断言（胜败与精确错误码、四项派生 delta、拒绝审计、幂等、来源匹配、
Schema Parity、Cleanup / Postflight）**不依赖**它们；不得反向宣称历史 MySQL suite 未运行，
或全部 PASS 均为空洞。

## 4. 与现行合同的差距及例外的精确范围

Active Design §13.1 的 G07 行要求：拒绝方相关 PO / Item / 幂等 / 审计及下游快照**逐字段相同**
（**不得只断言数量**）。现有 G07 MySQL Oracle 未证明「竞争败方对既有业务行零原地改写」。
这是原批准合同的**证据缺口**，不是文案修辞。

本次接受的范围**严格限定**为：

- **仅**该 Oracle **测量强度**差距，在 **M1-Core 内部首期包级验收评估**中作为明确例外引用；
- 此处**不宣称**已满足原合同该项断言；`M1C-G07 PASS` 的原文与原有效力**保持不变**；
- **不豁免**真实业务数据丢失、库存估值破坏、未授权写入、未来观测到的生产缺陷；
- **不授权**正式发布、部署或任何数据库写操作。

若后续审查发现实际业务缺陷，必须另行停止并处理，**不得引用本例外遮盖**。

## 5. WP-J 与 WP-D 的处置

| 事项 | 决定 |
|---|---|
| **WP-J**（G07 Oracle 强度补强：败方完整行逐字段比较、删除两项常量 delta、7 个 CR 的 `identityDelta` 真实推导、守恒改为跨表恒等式、固化期望终态快照以启用 `expectedSnapshot` 分支） | **本轮暂不授权执行**，标记 `DEFERRED_NOT_AUTHORIZED`。若未来要求以实证关闭该风险，必须取得**独立授权、新 Oracle、独立新 Run ID 与新 ACK-4**；历史 Run `b29c3f1f` **不可追认**。 |
| **WP-D**（G04 负增量可达性 D-1 → D-2 组合） | **不再作为 WP-K 的开放裁定事项** —— D-1 / D-2 已在 G04 后续独立流程办理，见 [`m1-core-g04-d2-design-amendment-20261107.md`](./m1-core-g04-d2-design-amendment-20261107.md) 与 [`m1-core-g04-owner-acceptance-20261107.md`](./m1-core-g04-owner-acceptance-20261107.md)。 |

## 6. 状态迁移

```text
Before : M1C-G07 = PASS；G01 = INCONCLUSIVE；Package = M1_CORE_ACCEPTANCE_BLOCKED
After  : M1C-G07 = PASS（**不变**，仅追加证据边界裁定）
         WP-K   = M1C_G07_WPK_EVIDENCE_BOUNDARY_ACCEPTED_FOR_PACKAGE_REVIEW
         WP-J   = DEFERRED_NOT_AUTHORIZED
         G01    = INCONCLUSIVE（**不变**，待其自身裁定）
         Package= M1_CORE_ACCEPTANCE_BLOCKED（**不变**）
```

七 Gate 状态**在本裁定后不变**：G02/G03/G04/G05/G06/G07 = `PASS`；G01 = `INCONCLUSIVE`。

`M1_CORE_ACCEPTANCE_BLOCKED` 保持。本裁定**不**签发 M1-Core 包级 Acceptance、Capability Freeze、
Domain Acceptance、Manual Closure、Release Readiness、Tag、Release 或 Deploy；**即使七个 Gate 全部
PASS，包级验收也不得自动签发**，必须另行审查并正式接受全部跨 Gate 残余风险。

## 7. 未发生

本裁定**未**修改 Active Requirement / Design、生产 Handler、DDL、Fixture、G07 Oracle、G07 合同、
CR 集、ACK-4 合同或任何已签发 Owner Acceptance；**未**连接真实 MySQL、**未**运行 G07、
**未**签发或消费 ACK-4、**未**执行 Reset / Bootstrap / Cleanup / Migration；**未** Push / Merge /
Tag / Release / Deploy。
