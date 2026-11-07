# M1-Core G04 正式 Owner Acceptance（2026-11-07）

> 用途：记录 `M1C-G04` 的有界风险接受与单 Gate 正式验收决定。
>
> Owner：Procurement & Outsourcing Domain Owner（正式 Gate 验收决定）；Platform / Database Safety / QA（技术证据维护）。
>
> 状态：`APPROVED` —— 基于项目 Owner 在 2026-11-07 当前对话中对“明确是否接受剩余风险并签发 G04 PASS”的明确指令，本决定采用**有界风险接受**方案，签发 `M1C-G04 PASS`。该来源为对话中的 Owner 授权记录；**不存在虚构的手写签名、电子签章或外部审批单**。
>
> 权威来源：`docs/requirements/procurement-outsourcing.md` §31.13.5（G04）、MC-REQ-06/07/08/09/11/12/13；`docs/design/procurement-outsourcing-m1-core.md` §9.1–9.2、§13.1（已批准 `M1C-G04-D2`）；`docs/acceptance/m1-core-g03-g04-offline-closure-20261107.md`；历史 `docs/acceptance/m1-core-g07-owner-acceptance-20261107.md`。
>
> 本文为 Gate 验收证据，不取代 Requirement、Active Design 或唯一项目状态 `docs/status/PROJECT_STATUS.md`。**仓库正式状态需在本记录依治理流程落库并经文档校验后同步更新**；本文件的生成本身不构成 Git 提交或远端同步。

## 1. Owner 决定

本次裁定选择 **ACCEPT_BOUNDED_RESIDUAL_RISK**，不把未证明范围伪装为通过的测试。基于 §2 的 G04 直接证据、§3 的真实 MySQL 并发子集与 §4 的明确残余风险，**单独签发**：

```text
M1C-G04 PASS
M1C_G04_OWNER_ACCEPTANCE_ACCEPTED_WITH_BOUNDED_RESIDUAL
```

验收范围仅为 M1-Core 首期 G04：受支持 BOM 基数下的增量倒冲、canonical 位置估值、Supplier WIP 消耗、成品唯一 Writer 入企业仓、暂估成本证据、重放幂等、拒绝防御与已测并发子集。**G04 PASS 是 Owner 对有限证据及未闭合证明缺口的验收决定，不是宣称所有断言在每种数据库和竞态下均已被实测。**

## 2. 首期已通过的 SQLite / 生产 HTTP 证据

| 合同对象 | 直接证据 | 可签发的证明范围 |
|---|---|---|
| 两批正向生效与增量倒冲 | `server/m1c-wp7a-gate-acceptance.test.js` `G04-1` | 每批合格收货 30，BOM 每单位 0.005，累计倒冲 0.30；仅生成倒冲 OUT 腿、成品 IN 腿，无双扣/双收 |
| 位置口径材料成本与成品成本 | 同文件 `G04-1`、`G04-R1-2` | 每批材料成本 15 分，provisional 加工费 30,000 分，成品估值 30,015 分；对照仓不同价格以防全局平均误用；Movement 与 Balance 逐批核对 |
| 唯一成品 Writer 与企业所有权 | 同文件 `G04-R1-1` | 成品进入合法企业仓，owner_type=`ENTERPRISE`、owner_id=`NULL`；物理/跟踪/已过账估值腿关联；静态唯一 Writer 调用链 |
| 重复确认 | 同文件 `G04-2` | 幂等与重复拒绝情况下零双扣/双收；拒绝审计检查 |
| 合法 HTTP 净供应不足 | `G04-WP-G`（同文件新增 G04 证据） | L1 供应不足时 `409 OUTSOURCING_WIP_INSUFFICIENT`，G04 18 表逐字段业务事实零变化，REJECT 恰好新增一条 |
| 历史异常负增量防御 | `G04-D1`（backflush）及 `G04-D1-C`（confirm） | 唯一 L3 异常种子令已倒冲 3 > 合法目标 2，生产 HTTP 对应 Handler 返回 `409 OUTSOURCING_WIP_INSUFFICIENT`；18 表业务事实零变化、REJECT +1，confirm 审计准确关联动作、收货实体与错误码 |
| 不支持基数拒绝 | 既有 G04/Outsourcing 合同与回归 | `409 OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED` 保持，不放宽首期受支持范围 |

上述证据为 SQLite 生产 HTTP（L1）与标明的 L3 异常种子；**L3 不冒充可由合法 L1 创建的业务状态**。最终 R3-R1 本地报告：相关 Focused `49/49`、FAST `576/576`、FULL `3344/3344`、Build PASS；其执行归属为本地报告和已完成的源码审查，并非本验收时重新运行。

## 3. 历史真实 MySQL 并发证据及精确边界

- **运行锚点**：G07 Run ID `b29c3f1f-8175-42ed-9e9c-2f0faff16798`；执行 SHA `054ebb67eb7ea5b1a82b0d51a70d54e76aaceb68`；M1C-G07 已另行正式 Owner PASS。执行为 MySQL 8 真实生产 HTTP + 两应用会话并发；不将其混同于当前 G04 的独立 MySQL 重演。
- **CR-03**：同一待检收货的两次竞争确认；Oracle 核对一方 HTTP 200、一方 409 `OUTSOURCING_RECEIPT_ALREADY_EFFECTED`、生效状态、WIP 净量以及与生效收货关联的成本证据。
- **CR-07**：两张已满足 IQC 条件的收货争用不足 WIP；Oracle 核对一方确认生效、另一方 409 `OUTSOURCING_WIP_INSUFFICIENT` 且维持 PENDING_INSPECTION、WIP 变化及成本证据。
- **CR-08**：同一 LOT/SERIAL WIP 身份下收货倒冲与退料竞争；Oracle 核对胜败 HTTP 精确状态／错误码、最终 WIP 变化、成本证据或退料新增行的部分来源关联。
- **G07 Oracle 限制**：`server/test-utils/m1-core-g07-oracle.js` 主要以 `added(before, after, table)` 检测新增行并计算结果；它**不能全面发现竞争前已存在的业务行被更新**。其中 `loserBusinessRowDelta=0`、`winnerBusinessRowDelta=1` 在 `scenarioEvidence` 中为常量，不能视为独立的败方逐字段零副作用证明；`change=closing-opening` 的守恒检查属于恒等式检查。CR-03/07/08 也不构成全部 G04 成品数量／估值腿在真实 MySQL 上的独立逐字段重演。
- 已签发 G07 PASS 的历史事实保持；上述缺口不被本次 G04 决定抹除，亦不代替尚待单独裁定的 **G07 WP-K**。
- **历史 SHA 比较的精确范围**：对 `054ebb67eb7ea5b1a82b0d51a70d54e76aaceb68..1de469217ce0ebf83b8c5a2df69c2d6df63a1718` 的 GitHub 提交比较实际涉及 **15 个文件**，包括多份 Acceptance、状态及日志文档、`scripts/testing/test-suites.js`、测试及测试辅助文件；**不得描述为整个提交范围只修改了一个文件**。其中唯一被修改的**生产模块文件**为 `server/modules/outsourcing.js`，其变更是 G03 ISSUE / SUPPLEMENT / RETURN 外部幂等冲突的拒绝审计边界修复。该区间**未修改 G04 的 `backflushMaterial()` 与 `confirmOutsourcingReceipt()` 生产 Handler 逻辑**；这一较窄事实不构成当前 SHA 的真实 MySQL 复验，也不扩大历史 G07 CR-03/07/08 的 Oracle 证明范围。后续 R3 与 G03/G04 治理本地补丁同样未修改上述 G04 生产 Handler。

## 4. Owner 明确接受的残余风险（不转写为 PROVEN）

1. **MySQL 败方完整零副作用未充分证明**：历史 Oracle 不能识别所有既有行 UPDATE，G04 不将“败方 PO/库存/WIP/估值/成本/幂等记录全字段不变”记为真实 MySQL 已逐项证明。
2. **并发覆盖有限**：CR-03、CR-07、CR-08 是确定的真实竞争子集，不能证明所有不同 Key、不同收货组合、跨身份／跨订单场景正确；MySQL 成品/估值完整逐腿重演未在本次 G04 新增验证。
3. **异常负增量仅防御性证明**：D-1/D-1-C 依赖隔离 SQLite 的 L3 异常种子；“合法 HTTP 未发现负增量构造路径”仅在 Design 既定状态单向迁移、BOM 快照冻结、权威事务重读等前提下成立，不是数学上普遍不可达性证明。
4. **历史库与浮点边界未穷尽**：未做真实历史存量异常审计；浮点负残差仅有有界分析，不宣称在一切数据／并发条件下绝对不可能。
5. **暂估成本不是 AP/GL 完结**：收货材料实耗账面价值和加工费 provisional 证据属于首期 G04 合同；正式加工费过账、最终差异分摊及延期政策均未获本次放行。
6. **本次不追认 G07 证明缺口**：G07 WP-K 是否接受已有 Oracle 与 Active Design §13.1 的证明差异，仍须独立裁定；本决定不自动补写历史 Run 的 Oracle 结果。

风险接受仅适用于 **M1C-G04 单 Gate 首期能力**；不修改原 Requirement／Design 的业务规则，不允许删减 409 Guard、放宽库存与财务安全门禁，不能代替缺陷修复。发现真实生产不变量反例应新建缺陷、HARD STOP，并按治理程序重评受影响 Gate。

## 5. 验收范围之外与项目状态

- **仅本 Gate**：`M1C-G04 PASS`。此前 `M1C-G03 PASS`、G02/G05/G06/G07 PASS 保持其各自正式验收记录不变；**G01 继续 `INCONCLUSIVE`**。
- G04-D2 Design Amendment 已批准，其证据层级澄清继续有效。
- **`M1_CORE_ACCEPTANCE_BLOCKED` 保持**；不签发包级 Acceptance、Domain Closure、Capability Freeze、Manual Closure、Release Readiness、Tag、Release 或 Deploy。
- 本次决定**不授权**真实 MySQL/G07、ACK-4、Reset/Bootstrap/Cleanup、Migration、生产 Handler、DDL、Fixture 或 Oracle 修改；也不授权 Push、Merge、Tag、Release、Deploy。
- 历史测试结果及各自运行 SHA、失败 Run 与原 Owner 决定必须保持不可覆盖的追溯记录。本文件落库后，按照仓库治理要求在 `docs/acceptance/README.md` 登记，并在 `docs/status/PROJECT_STATUS.md` 追加日期化状态迁移；通过 Docs current / migration 与 Git 检查后再提交，**禁止改写旧 §37.48 / §37.49**。

```text
Before : M1C-G04 = INCONCLUSIVE
After  : M1C-G04 = PASS（仅在本次 Owner 决定按项目治理正式登记后）
Other  : M1C-G01 = INCONCLUSIVE；G02/G03/G05/G06/G07 = PASS
Package: M1_CORE_ACCEPTANCE_BLOCKED
```
