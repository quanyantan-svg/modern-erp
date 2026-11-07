# M1-Core 第一批最小离线补证（WP-A / WP-B / WP-E / WP-F / WP-H）候审证据（2026-11-07）

> 用途：登记 M1-Core G01/G03/G04 三 Gate **第一批最小离线补证**的实施证据，以及
> G01 历史测试的逐项归属与执行记录对照。
> Owner：Platform / Database Safety / QA（Parity 与 Gate 证据维护）；Procurement &
> Outsourcing Domain Owner（Gate 验收决定）。
> 状态：`PENDING_APPROVAL` —— 离线补证已实施并复验，**未签发**任何 Owner Acceptance。
> 权威来源：Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5、
> Active Design `docs/design/procurement-outsourcing-m1-core.md` §13.1 / §13.1.1 /
> §5.4 / §9.1、历史执行记录
> [`m1-core-wp7a-gate-acceptance-20261103.md`](./m1-core-wp7a-gate-acceptance-20261103.md)、
> [`m1-core-g07-owner-acceptance-20261107.md`](./m1-core-g07-owner-acceptance-20261107.md)。
> 本文是补证证据，**不**替代 Requirement、Design 或 `docs/status/PROJECT_STATUS.md`，
> 也**不**改变 G02/G05/G06/G07 已签发的 Owner Acceptance。

## 1. 本批范围

| 工作包 | Gate | 层级 | 实施形态 |
|---|---|---|---|
| **WP-A** | G03 | **Primitive L2** | 新增 `server/m1c-wp7a-g03-l2-mutation-key.test.js`（4 例，已登记 FULL） |
| **WP-B** | G03 | SQLite L1 | 扩展 `server/m1c-wp7a-gate-acceptance.test.js` 的 `g03BusinessFacts()`，G03-2 / G03-3 / G03-4 统一到完整快照 |
| **WP-E** | G04 | SQLite L1 + 静态源码级 | 同文件新增 `G04-R1 — 成品唯一 Writer、企业所有权与逐批成本估值` describe（2 例） |
| **WP-F** | G04 | SQLite L1 | 同上（`G04-R1-2`） |
| **WP-H** | G01 | 登记性（无新测试） | 本文 §3 的逐项归属与执行记录对照 |

**暂不实施**（按 Owner 指示）：WP-C（多物料行与 SERIAL 身份腿数，待重新设计符合单行发料
API 的测试）、WP-D（「增量 < 0」的合法 HTTP 可达性论证与 Design 裁定）、WP-G（G04 拒绝
在 SQLite 侧的补证）、WP-I（真实 MySQL 分支，不新增 CR、不申请 ACK-4）、WP-J（不修改已签发
G07 的 Oracle）、WP-K（不修改 G07 Owner Acceptance 或项目治理状态）。

**未改动**：生产 Handler、DDL、Migration、Fixture、Oracle、Gate 合同、CR 集、ACK-4 合同。
唯一新增的生产侧文件是**测试支撑模块** `server/test-support/m1-core-g03-g04-evidence.js`
（只读快照能力，不含业务逻辑）。

## 2. 实施过程中确认的两项新事实

### 2.1 `request_fingerprint` 子句在委外严格路径上与可读字段比较冗余

`server/lib/inventory-mutation.js` 的 replay 分支以 `readableMismatch` 判定冲突，其中
`request_fingerprint` 子句与**可读字段比较**（sourceType / sourceId / sourceItemId /
movementGroupId / movementKind / businessDate / quantity / 位置身份 JSON）在委外严格
路径上**判定结果恒等**：任何能让指纹不同的输入差异，同时也会让可读字段不同。

变异实验（临时改生产代码 → 跑新套件 → 完整恢复，`git diff` 为空）：

| 变异 | 结果 |
|---|---|
| 仅去掉 `request_fingerprint` 子句 | L2-2 **仍 PASS** ⇒ 该子句单独不承重 |
| 去掉整个 `readableMismatch` 判定 | L2-2 与 L2-3 **均 FAIL** ⇒ 承重条件是**可读字段比较** |

因此 L2 套件的负控对准的是**真正承重**的条件：测试内独立复算了同一组可读字段比较
（`localReadableMismatch()`），并证明「键命中 + 内容不同」成立；若生产侧移除整个内容
比对，用例必然失败。

### 2.2 G03 的 L1 拒绝路径不写幂等记录

`server/modules/outsourcing.js` 的 `saveIdempotency()` 位于事务内，拒绝时事务整体回滚，
因此拒绝后 `idempotency_records` **零新增**。这使 `idempotency_records` 可以进入
G03 的零变化快照（连同 `products` 的估值激活标记），快照覆盖面因此从旧实现的
**3 张表（且限定在本订单内）**提升为 **18 张表的完整行**。

## 3. WP-H —— G01 历史测试的逐项归属与执行记录

保留 WP7-A 原始的 **25 项**执行记录不变，并**独立登记**后来新增的 D0。

| 测试 | 引入提交 | 归属 |
|---|---|---|
| `A1 compatible single purchase order input is normalised into one authoritative source row with converted_quantity=0` | `b32e9f3` | WP7-A 25 项 |
| `A2 one notice may allocate several purchase order lines of several purchase orders` | `b32e9f3` | WP7-A 25 项 |
| `A3 the allocation total must equal the notice line quantity and the rejection leaves no trace` | `b32e9f3` | WP7-A 25 项 |
| `A4 order, supplier, product and warehouse mismatches are rejected` | `b32e9f3` | WP7-A 25 项 |
| `A5 a single delivery schedule is bound automatically, several schedules demand an explicit selection and zero schedule fails closed` | `b32e9f3` | WP7-A 25 项 |
| `A6 conflicting legacy and multi order source facts are rejected instead of silently preferring one` | `b32e9f3` | WP7-A 25 项 |
| `A7 a failing source row rolls the whole notice creation back` | `b32e9f3` | WP7-A 25 项 |
| `A8 an OUTSOURCE notice never writes a standard purchase source row` | `b32e9f3` | WP7-A 25 项 |
| `B1 the outsourcing confirmation counts the quantity of this notice exactly once` | `b32e9f3` | WP7-A 25 项 |
| `B2 an outsourcing notice capacity never uses a purchase order line capacity and the reverse holds as well` | `b32e9f3` | WP7-A 25 项 |
| `B3 a standard purchase notice may not exceed the purchase order line capacity` | `b32e9f3` | WP7-A 25 项 |
| `C1 a converted notice creates a purchase receipt, accumulates the converted quantity and keeps the line level provenance` | `b32e9f3` | WP7-A 25 项 |
| `C2 a partial conversion accumulates and a second conversion continues from the remaining capacity` | `b32e9f3` | WP7-A 25 项 |
| `C3 an idempotent replay neither duplicates the receipt nor the source accounting` | `b32e9f3` | WP7-A 25 项 |
| `C4 cancelling a converted receipt never restores the converted source capacity and a re-conversion is refused` | `b32e9f3` | WP7-A 25 项 |
| `C5 a source row with an unproven historical converted quantity never provides conversion capacity` | `b32e9f3` | WP7-A 25 项 |
| `C6 an illegal conversion changes no document, no inventory, no valuation and no schedule ledger` | `b32e9f3` | WP7-A 25 项 |
| `C7 a multi purchase order notice converts into one receipt per purchase order with a per line trace` | `b32e9f3` | WP7-A 25 项 |
| `C8 the notice detail exposes the traceable converted and remaining quantities` | `b32e9f3` | WP7-A 25 项 |
| `D1 the direct purchase order to purchase receipt path stays legal and consumes the schedule ledger` | `b32e9f3` | WP7-A 25 项 |
| `D2 cancelling a draft purchase receipt releases its schedule reservation with a signed reversal effect` | `b32e9f3` | WP7-A 25 项 |
| `D3 the schedule capacity bounds the converted quantity` | `b32e9f3` | WP7-A 25 项 |
| `D4 the purchase order line remaining counts the notice allocation, so the direct path cannot steal a reserved quantity` | `b32e9f3` | WP7-A 25 项 |
| `D5 a receipt converted from a notice keeps its immutable source provenance` | `b32e9f3` | WP7-A 25 项 |
| `D6 the notice creation is idempotent under the same Idempotency-Key` | `b32e9f3` | WP7-A 25 项 |
| **`D0 concurrent 6 vs 6 notice creation yields exact 201/409 and distinct numbers cannot mask capacity`** | **`84bca44`** | **后补，不属于 WP7-A 的 25 项执行记录** |

**执行记录对照**

| 归属 | 引入提交 | 最后修改 | 执行记录 | 证据层 | 当前覆盖状态 |
|---|---|---|---|---|---|
| WP7-A 25 项 | `b32e9f3` | `99f0bc7`、`465b652` | WP7-A 轮，起点 HEAD `2fe1dd841b6c73deb53b09d87da77e0c34533ae4`，登记于 `a04b7a5cecd088b923fc809b0b9778fc32d7567c` | SQLite L1 | 仍在 `server/m1c-wp1-procurement-notice-conversion.test.js`，注册于 FULL |
| D0 一项 | `84bca44`（2026-11-04） | `84bca44` | **无** WP7-A 执行记录（`84bca44` 不是 `a04b7a5` 的祖先） | SQLite L1 | 同文件，注册于 FULL；本轮基线实测 **26/26 PASS** |

**口径声明**：WP7-A 文档记载的「25 例」对其执行时点准确。当前源码为 26 例，差额是 D0 在
其后加入所致。**不得**把当前的 26 项注册数追溯写成 WP7-A 当时执行了 26 项。

## 4. WP-A —— G03 的 L2 canonical inventory primitive 证据

**合同锚点**：Active Design §13.1.1 的 L2 行：「同一五字段 Mutation Key：同指纹只 replay；
异指纹 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；无物理腿、跟踪、估值或 mutation log
部分写入」。

**新增套件** `server/m1c-wp7a-g03-l2-mutation-key.test.js`（已登记 FULL，非 FAST）：

| 例 | 断言 |
|---|---|
| `L2-0` | 生产委外 canonical 变更键仍由**同样五个字段**构成（`sourceType`、`eventId`、`material.id`、物理腿种类、身份键）；模板漂移即失败 |
| `L2-1` | 同键同指纹 → `replayed=true`、同一 movement group、**零新增**物理腿/流水/跟踪/估值/mutation log；首次执行只新增物理腿、流水与 mutation log |
| `L2-2` | 同键异指纹 → **精确 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`**；`inventory`、`inventory_transactions`、`tracked_inventory_movements`、`inventory_valuation_movements`、`inventory_valuation_balances`、`inventory_mutation_log` **六类事实零部分写入** |
| `L2-3` | 负控：① 键确实命中既有 mutation log 行（证明 409 不是「键未命中」）；② 独立复算可读字段比较对「同键异内容」成立；③ 不同五字段键必须独立成功（拒绝是键作用域的）；④ 同键异内容仍被拒绝 |

**口径边界（必须如实理解）**：L2 直接调用 `applyInventoryMutation()` 并使用委外严格模式
（`trackingMode: 'EXTERNAL'`、`valuationMode: 'EXTERNAL'`）。在该模式下 canonical primitive
**自身不写**跟踪腿与估值流水 —— 那是调用方 `postTrackingAndValuation()` 的职责。因此本套件
**不**声称「Primitive 正向执行完成了外部跟踪或估值写入」；它只断言冲突发生时六类事实都**没有**
被部分写入，并在 `L2-1` 中显式声明该口径。

**非空洞证明**：见 §2.1 的变异实验 —— 去掉整个内容比对判定后 `L2-2` 与 `L2-3` **实测 FAIL**，
恢复后 4/4 PASS；生产文件 `git diff` 为空。

## 5. WP-B —— G03 的 L1 拒绝路径完整业务事实快照

**合同锚点**：Active Design §13.1 的 G03 零副作用列「业务单据 / 库存 / 跟踪 / 估值 / 身份层
**逐字段零变化** + 拒绝审计**恰好 1 条**」。

**变更**：`materialFacts(orderId)`（3 张表、限定本订单）→ `g03BusinessFacts()`（**18 张表的
完整行**，全库范围）。表集与域的对应见 `server/test-support/m1-core-g03-g04-evidence.js`：

| 域 | 表 |
|---|---|
| 业务单据 | `outsourcing_issues`、`outsourcing_supplements`、`outsourcing_returns`、`outsourcing_material_list` |
| 库存（含幂等账本） | `inventory`、`inventory_transactions`、`inventory_mutation_log`、`idempotency_records` |
| 跟踪 | `tracked_inventory_movements`、`tracked_source_allocations`、`inventory_lot_balances` |
| 估值 | `inventory_valuation_movements`、`inventory_valuation_balances` |
| 身份层 | `outsourcing_wip_identity_balances`、`outsourcing_wip_identity_effects`、`outsourcing_wip_identity_effect_allocations` |
| 货品估值激活标记 | `products` |

`audit_logs` **不在**快照内 —— 拒绝审计**恰好 1 条**是与「零变化」并列的独立要求，由
G03-2 / G03-3 / G03-4 各自断言（口径为实体作用域：`action='REJECT' AND entity_type=? AND entity_id IS ?`）。

**统一到完整快照的三条拒绝路径**：

| 例 | 拒绝分支 | 零副作用断言 |
|---|---|---|
| G03-2 | 身份异常 4 分支（LOT 缺批次 / SERIAL 数量≠1 / SERIAL 缺序列号 / SERIAL 携带批次） | 完整快照逐字段零变化 + 拒绝审计恰好 4 条 |
| G03-3 | 缺 WIP 仓、库存不足（退料超量） | 两处完整快照逐字段零变化 + 拒绝审计恰好 1 条/条 |
| G03-4 | UOM 不符 | **由「仅 `issued_quantity == 0`」升级为完整快照逐字段零变化** + 拒绝审计恰好 1 条 |

**非空洞证明**：在 G03-4 的拒绝窗口内注入一处**跟踪层既有行的原地字段改写**
（`UPDATE tracked_inventory_movements SET quantity=quantity+1`），G03-4 **实测 FAIL**；旧断言
（仅 `issued_quantity`）不会发现该改写。恢复后 8/8 PASS。

## 6. WP-E —— G04 成品唯一 Writer、企业所有权与流水关联

**合同锚点**：Requirement §31.13.5 G04 行「成品经唯一 Writer 入企业仓」；Active Design
§13.1 G04 行；§5.4「委外收货 → 成品」唯一 Writer 合同。

**新增用例** `G04-R1-1`，三组断言：

1. **成品仓位**：成品只有一个 canonical 仓位；只在合法企业仓 `warehouse-001`；**不在**供应商
   WIP 仓 `warehouse-002`；`owner_type='ENTERPRISE'`、`owner_id IS NULL`；数量 = 两批合计 60。
2. **流水逐笔关联**：每条成品物理腿（`inventory_transactions`，`source_type='OUTSOURCING_RECEIPT'`
   / `direction='IN'`）必须 `valuation_status='VALUED'`，且恰好一条跟踪腿
   （`tracked_inventory_movements.transaction_id` 关联、同收货、同货品、同仓位、同数量）与恰好
   一条 POSTED 估值流水（`inventory_valuation_movements.inventory_transaction_id` 关联、同收货、
   同收货明细）。
3. **静态 Writer 调用链检查**（源码级）：扫描 `server/` 下全部生产源文件（排除 `*.test.js`）：
   ① `sourceType: 'OUTSOURCING_RECEIPT'` 字面量只出现在**一个**文件；② 该文件的全部字面量都位于
   `receiveOutsourcingFinishedGoods()` 函数体内；③ 该 Writer 在整个 server 树里**只有一个调用点**
   （`modules/outsourcing-finance.js`）。

**口径边界**：第 ③ 组是**源码级**证明「今天不存在第二条成品写入路径」，**不是**运行时证明；
将来新增写入点会让该断言失败，从而强制重新审查。因此本用例**不**以「库存腿数正确」宣称
唯一 Writer 已被证明。

**非空洞证明**：在第二个模块临时植入一处 `sourceType: 'OUTSOURCING_RECEIPT'` 字面量，
`G04-R1-1` **实测 FAIL**；恢复后 10/10 PASS，生产文件 `git diff` 为空。

## 7. WP-F —— G04 逐批成本构成与 Movement/Balance 逐笔对账

**合同锚点**：Active Design §13.1 G04 行成功列「材料成本来自 canonical 位置口径分摊（**非**
全局平均价）」、「OUT-21 成本证据 = 实际倒冲材料账面价值 + 加工费」。

**新增用例** `G04-R1-2`（独立 describe，独立成品货品与独立委外订单，不依赖用例执行顺序）：

1. **按收货单 + 明细关联 Movement**：每批成品估值必须恰好一条
   `inventory_valuation_movements`（`source_type='OUTSOURCING_RECEIPT'` + `source_id=收货单` +
   `source_item_id=明细` + `status='POSTED'`）。
2. **每批成本构成**：该批 Movement 的 `value_delta_cents` **必须等于**该批
   `material_consumed_value_cents` + `processing_fee_provisional_cents`；同时显式断言 Movement
   **不等于**单独的材料成本（加工费必须在其中），且 `quantity_delta` 等于该批明细数量；
   `basis_status='PROVISIONAL'`、`processing_fee_actual_cents` 与 `variance_cents` 仍为 NULL。
3. **Movement → 物理腿**：Movement 的 `inventory_transaction_id` 必须指向该批成品物理腿
   （同收货、IN 方向、成品货品、`valuation_status='VALUED'`）。
4. **逐批 Balance 增量**：第 N 批的 Balance 金额/数量增量 = 该批 Movement 合计（**不**把累计
   Balance 当作单笔 Movement）。
5. **期初期末对账**：各批 Movement 加总 = 期末 Balance − 期初 Balance（金额与数量）；
   期末 Balance 金额 = 各批 Movement 加总。期初必须为空 —— 成品在首批完工前没有估值余额。

**口径说明**：成品 Movement 的金额**包含** provisional 加工费，因此**不得**断言它等于单独的
材料成本；断言的是「材料成本 + 加工费」这一合同构成。

**非空洞证明**：临时把生产侧 `totalFinishedValue` 改为只含材料成本（去掉 provisional 加工费），
`G04-R1-2` 与既有 `G04-1` **同时实测 FAIL**；恢复后 10/10 PASS，生产文件 `git diff` 为空。

**位置口径的非空洞性**：本 describe 同样种入同产品对照仓（99999 分/单位），若材料成本退化为
全局平均价，材料账面价值将由 15 分偏离，逐批成本构成断言必然失败。

## 8. 离线复验

| 项 | 结果 |
|---|---|
| Focused `server/m1c-wp7a-g03-l2-mutation-key.test.js`（WP-A） | **4/4 PASS** |
| Focused `server/m1c-wp7a-gate-acceptance.test.js`（WP-B / WP-E / WP-F） | **10/10 PASS** |
| Focused `server/m1c-wp1-procurement-notice-conversion.test.js`（G01） | **26/26 PASS** |
| Focused `server/m1c-wp2-wp5-outsourcing.test.js` | **13/13 PASS** |
| 变异实验（4 项） | 全部按预期 FAIL → 恢复后 PASS；生产文件 `git diff` 为空 |
| FAST | **576/576 PASS**，0 fail / 0 skipped / 0 todo |
| FULL（新增文件登记于 FULL，故一并复跑） | **3329/3329 PASS**，0 fail / 0 skipped / 0 todo |
| Build | PASS |
| Node `--check`（4 个改动文件） | PASS |
| `git diff --check` | PASS |
| docs current / migration | **ALL CHECKS PASSED** |

## 9. 本批**未**关闭的缺口

| 缺口 | 状态 |
|---|---|
| G03 的 L1「多物料行与 SERIAL 身份腿数」（实际腿数 == 预期腿数） | **未补**（WP-C，待重新设计符合单行发料 API 的测试） |
| G04「增量 < 0」的合法 HTTP 可达性 | **未补**（WP-D，待可达性论证与 Design 裁定） |
| G04「增量 > 可用净供应 → 409」 | **已由真实 MySQL CR-07 / CR-08 证明**；SQLite 侧无断言位（WP-G，可提交残余风险） |
| G01 的真实 MySQL 分支（原子性、多 PO、部分转换、转换幂等、历史 NULL、OUTSOURCE 容量分域、直接 PO 路径、交期不可绕过） | **未补**（WP-I，本批明确不新增 CR、不申请 ACK-4） |
| G07 Oracle 的败方逐字段零变化、`identityDelta` 恒真、守恒恒等式、`expectedSnapshot` 未启用 | **未动**（WP-J，本批明确不修改已签发 G07 的 Oracle） |
| G07 PASS 的证据边界更正 | **未登记**（WP-K，待独立 Owner 决定） |
| G01/G03/G04 的 Owner Acceptance | **未签发** |

## 10. 候审结论

```text
M1C_WP7A_R1_OFFLINE_EVIDENCE_READY_FOR_INDEPENDENT_REVIEW
```

本批只产出**离线补证证据**。G01/G03/G04 仍为 `INCONCLUSIVE`，`M1_CORE_ACCEPTANCE_BLOCKED`
保持；G02/G05/G06/G07 的已签发 Owner Acceptance 不受本批影响。
