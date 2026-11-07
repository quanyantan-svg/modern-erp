# M1-Core G07 WP-K-R1 证据边界追加式 Owner 裁定（2026-11-07）

> 用途：在已签发的 `M1C_G07_WPK_EVIDENCE_BOUNDARY_ACCEPTED_FOR_PACKAGE_REVIEW` 裁定**之外**，以**追加式**方式
> 正式登记一次独立复核所得的**更完整**的 G07 Oracle 测量强度边界，并在**有界残余风险接受**方案下
> 接受该扩大披露的证明缺口，供 M1-Core 首期包级验收评估引用。
> 本文**不**签发 Gate PASS，**不**签发包级 Acceptance，**不**签发 Freeze / Release Readiness。
>
> Owner：Procurement & Outsourcing Domain Owner（风险接受与正式裁定）；Platform / Database Safety / QA（事实核验）。
>
> 状态：`APPROVED` —— 本轮项目 Owner 在当前对话中**总体授权** ChatGPT 主导 M1-Core 剩余验收推进，并在**同一次
> 限定裁定**中明确批准「WP-K-R1 按有界残余风险接受方案正式落地」，且逐条列明本裁定的接受边界（见 §1.2）。
> 该来源为**对话中的 Owner 授权与限定裁定记录**；**不存在**虚构的手写签名、电子签章或外部审批单，
> Owner **亦未**逐条签署独立的审批文件 —— 本文的逐条 R1 决定系由该次限定裁定的授权范围推导。
>
> 权威来源：Active Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5；Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §13.1、§13.1.3；已签发并**原样保留**的
> [`m1-core-g07-owner-acceptance-20261107.md`](./m1-core-g07-owner-acceptance-20261107.md)（`M1C-G07 PASS`）与
> [`m1-core-g07-wpk-owner-adjudication-20261107.md`](./m1-core-g07-wpk-owner-adjudication-20261107.md)（原 WP-K 裁定）；
> 候审草案 [`m1-core-g07-evidence-boundary-draft-20261107.md`](./m1-core-g07-evidence-boundary-draft-20261107.md)（**保持原样**）。
>
> 本文是验收证据，不取代 Requirement、Active Design 或唯一项目状态
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。**本文件的生成本身不构成 Git 提交或远端同步。**

---

## 1. Owner 决定

### 1.1 裁定标识

```text
M1C_G07_WPK_R1_EVIDENCE_BOUNDARY_ACCEPTED_WITH_BOUNDED_RESIDUAL
```

本文是对既有 `M1C_G07_WPK_EVIDENCE_BOUNDARY_ACCEPTED_FOR_PACKAGE_REVIEW` 的**追加式**边界说明，
**不回溯改写**任何历史结论。

### 1.2 授权来源（如实引用）

项目 Owner 于 2026-11-07 在当前对话中：

1. **总体授权** ChatGPT 主导 M1-Core 剩余验收推进；
2. **明确批准**「WP-K-R1 按有界残余风险接受方案正式落地」；
3. **逐条限定**该裁定的接受边界为：
   - 9 CR × 6 effects = 54 个槽位，其中 29 个未重新计算；
   - 原 WP-K 已披露 25 个，本次新增 4 个；
   - 35 个 (CR, 表) 组合在对应真实 MySQL G07 Oracle 中缺少业务不变量校验；
   - **已有 SQLite 测试只作为不同层级的补偿证据，不能证明这些 MySQL 场景逐字段无异常**；
   - 历史 G07 11/11、Schema Parity 16/16 与其他真实有效断言继续保留；
   - 扩大披露的只是**证明缺口**，不得据此豁免真实业务缺陷；
   - 风险接受**仅**用于 M1-Core 首期包级验收评估；
   - WP-J 继续 `DEFERRED_NOT_AUTHORIZED`；
   - 原 `M1C-G07 PASS` 和 WP-K 正式裁定**原样保留**。

本文的 R1-1～R1-5 决定**全部落在**上述边界之内；候审稿中超出边界的表述已在 §4 说明并按边界收敛。

### 1.3 本裁定明确**不**主张

1. **不主张** `M1C-G07 PASS` 失效、错误或需要撤销 —— 该 PASS **原样保留**、原有效力。
2. **不主张** G07 的 11/11 注册套件、16/16 Schema Parity、CR-01～CR-09 的胜败与精确错误码、拒绝审计关联、
   幂等、来源匹配、Cleanup / Postflight、五类 Schema 对象归零等**真实有效断言**是空洞的 —— 这些断言经复核
   均基于真实计算，**继续保留并具证明力**。
3. **不主张** SQLite 层的补偿证据**等价于**或**可替代**对应真实 MySQL 场景的逐字段无异常证明。
4. **不主张**任何生产代码存在缺陷 —— 本轮未发现任何生产代码缺陷。
5. **不主张**本文扩大了任何已批准的**功能**范围或**业务合同**范围 —— 本文只处置**证据强度**边界。
6. **不主张**WP-I、WP-J、M-15 或旧 13 Gate 已完成、已授权或已恢复为当前验收条件。

## 2. 原 WP-K 已接受范围（**原样保留，不追溯改写**）

原裁定 §3～§4 的全部结论继续有效：

- `added(before, after, table)` 只按新增 ID 识别新行，**无法检出既有行的原地字段修改**；
- `winnerBusinessRowDelta=1` / `loserBusinessRowDelta=0` 是初始化常量，9 个 CR 分支从不重算；
- 7 个 CR 的 `identityDelta=1` 未逐 CR 重算（仅 CR-01、CR-09 真实重算）；
- `leg.change = closing - opening` 使守恒方程成为算术恒等式；
- `assertG07Result()` 的 `expectedSnapshot` 逐字段全量比较分支在真实 MySQL suite 中**从未启用**；
- 已接受范围**严格限定**为「该 Oracle **测量强度**差距」，**仅**在 M1-Core 内部首期包级验收评估中作为
  明确例外引用；**不豁免**真实业务数据丢失、库存估值破坏、未授权写入或未来观测到的生产缺陷。

本文**不**修改、不收窄、不扩展上述任何一条；**只**追加 §4 的扩大披露。

## 3. 复核方法（可独立复跑）

| 方法 | 说明 |
|---|---|
| 槽位口径 | 对 `server/test-utils/m1-core-g07-oracle.js` 的 `effects` 初始化器写入**唯一哨兵值**，再逐 CR 执行 `scenarioEvidence()`；结果仍等于哨兵值者即「该 CR 分支从未重算」。不依赖阅读结论，可由任何复核方重跑。 |
| 快照表覆盖交叉 | 将 G07 合同每条 CR 的 `snapshotTables` 与 Oracle 中实际被引用的表名集合求差集，得到「采集但未断言」的表清单；再逐表在 SQLite 层定位补偿证据与其作用域。 |
| 事实来源 | 均为本轮 HEAD（`83e13e008c851f5a235cb95e6dfa2f08afa0a32b`）的实际源码，逐项给出 `file:line`。 |

**未修改**任何生产代码、DDL、Fixture、Oracle、合同或测试。

## 4. 口径与逐项认定

### 4.1 修正后的槽位口径

| 口径 | 数值 | 构成 |
|---|---|---|
| 断言槽位总数 | **54** | 9 条 CR × 6 个 effects 字段 |
| ├ 固定期望槽位 | **36** | 9 × 4（`documentDelta`、`quantityDelta`、`identityDelta`、`amountDeltaCents`），对照 `G07_FIXED_EFFECTS` |
| └ 胜败业务行槽位 | **18** | 9 × 2（`winnerBusinessRowDelta`、`loserBusinessRowDelta`），对照字面量 `1` / `0` |
| **从未重算槽位合计** | **29** | 见下 |
| ├ 原 WP-K 已披露 | **25** | 18 个胜败槽位（全部 9 条 CR）+ 7 个 `identityDelta`（CR-02～CR-08） |
| └ **本次新增披露** | **4** | `CR-01.amountDeltaCents`；`CR-02.documentDelta`；`CR-03.documentDelta`；`CR-07.documentDelta` |
| 真实重算槽位 | **25** | 54 − 29 |

四个新增槽位的初始化值恰等于其固定期望值，故断言恒真、不会误报；它们同样**没有独立证明力**。
因此本次新增披露只会**下调** G07 Oracle 的已证明强度，**不会**推翻任何既有 PASS 结论。

### 4.2 新增披露的 4 个恒真槽位（逐项）

| 槽位 | 未证明内容 | 不同层级的补偿证据 | 业务风险 |
|---|---|---|---|
| `CR-01.amountDeltaCents`（期望 `0`） | CR-01（两个 `POST /api/receipt-notices` 竞争同一 PO Item / 交期）中「不产生估值写入、AP open item 或会计凭证」**未由该 Oracle 断言证明** | G07 Oracle 层：CR-01 的 `documentDelta` / `quantityDelta` / `identityDelta` **均真实重算**并与固定期望 `1 / 6 / 1` 比对 → 可证明「恰一通知、恰一明细行、恰一来源分配」。SQLite 层：G01 `businessSnapshot()` 对 `inventory_transactions`、`inventory_valuation_movements`、`inventory_valuation_balances`、`account_payables`、`accounting_vouchers` 做整表 `SELECT *` 逐字段快照 | **低** —— 该端点的业务语义不产生估值 / AP / 凭证；风险在于「Oracle 不能证明该端点没有写下游行」 |
| `CR-02.documentDelta`（期望 `0`） | 「未新增采购入库单」**未由该 Oracle 断言证明** | G07 Oracle 层：`quantityDelta` 为该产品/仓位全部匹配行的**净额求和**（能检出库存原地改写）；`amountDeltaCents` 为新增估值行 `value_delta_cents > 0` 之和（第二次入库会由 `1000` 变 `2000` 而被捕获）；`sourcesMatched` 另校验 `purchase_receipts.status === 'CONFIRMED'`。SQLite 层：G01 `businessSnapshot()` 覆盖 `purchase_receipts`、`purchase_receipt_items`、`inventory`、`inventory_transactions`、估值两表、`account_payables`、`accounting_vouchers` | **低** |
| `CR-03.documentDelta`（期望 `0`） | 「未新增委外收货单」**未由该 Oracle 断言证明** | G07 Oracle 层：`quantityDelta` 为 WIP 身份余额净额；`amountDeltaCents` 为生效收货关联成本证据合计；`sourcesMatched` 校验生效数、待检数与成本行数。SQLite 层：G04 事实表集（18 表）覆盖 `outsourcing_receipts`、`outsourcing_receipt_items`、`outsourcing_material_list`、`outsourcing_cost_evidences`、库存/跟踪/估值/身份四域与 `inventory_mutation_log` | **低** |
| `CR-07.documentDelta`（期望 `0`） | 「未新增委外收货单」（两张合法 IQC-PASS 收货争用同一 WIP 身份）**未由该 Oracle 断言证明** | 同 CR-03，另加 `pending.length === 1` 的待检保持断言与 WIP 净额、`costs.length === 1`。SQLite 层：同 G04 事实表集 | **低～中**（CR-07 是两张独立收货争用同一 WIP，新增一张收货是最贴近的漏检形态） |

### 4.3 35 个「采集但未断言」（CR, 表）组合

G07 合同为每条 CR 声明了 `snapshotTables`，真实 MySQL 运行确实对每张表执行了完整 `SELECT *` + 主键排序采集
（`server/mysql-m1-core-g07.integration.js:49`、`:52`、`:58`）。但其中 **35 个 (CR, 表) 组合**的表
**从未参与任何 Oracle 断言** —— 即在对应真实 MySQL G07 Oracle 中**缺少业务不变量校验**。

> **口径纪律（不可扩大或缩小）**：
> 1. 本项的含义**仅**是「在真实 MySQL 的 G07 Oracle 层未纳入该 CR 的业务不变量断言」。
> 2. **完全没有任何测试覆盖的组合为 0 个**：逐表复核确认，35 个组合涉及的全部 9 张表在 **SQLite 层均存在
>    补偿证据**。
> 3. **但 SQLite 层的补偿证据属于不同层级**：它**不能**证明这些真实 MySQL 场景逐字段无异常，
>    **不能**替代 MySQL 层的业务不变量校验，**不**构成跨引擎等价证明。
> 4. SQLite 层的补偿证据作用域**并非全部等价于**「整表零变化」，引用时不得混同。

| 表 | SQLite 层补偿证据（**不同层级**） | 作用域 | 涉及 CR | 组合数 |
|---|---|---|---|---|
| `inventory_transactions` | G01 `businessSnapshot()`；G03 / G04 事实表集；G06-1 `businessSnapshot()` | 整表 / 整表全列 / 按 `receipt_id` | CR-01～CR-08 | 8 |
| `tracked_inventory_movements` | G03 / G04 事实表集 | 整表全列 | CR-02～CR-08 | 7 |
| `outsourcing_material_list` | G03 / G04 事实表集 | 整表全列 | CR-03～CR-08 | 6 |
| `outsourcing_wip_identity_effects` | G03 / G04 事实表集 | 整表全列 | CR-03～CR-08 | 6 |
| `outsourcing_receipt_items` | G04 事实表集；G06-1 `businessSnapshot()` | 整表全列 / 按 `receipt_id` | CR-03、CR-07 | 2 |
| `accounting_vouchers` | G01 `businessSnapshot()`；G06-1 `businessSnapshot()` | 整表 / 按 `source_id` | CR-01、CR-02 | 2 |
| `supplier_bills` | G06-1 `businessSnapshot()`（`:1026-1039`） | 按 `bill_id` 全行 | CR-01、CR-02 | 2 |
| `schedule_consumption_effects` | G01 `businessSnapshot()` | 整表 | CR-01 | 1 |
| `purchase_receipt_items` | G01 `businessSnapshot()` | 整表 | CR-02 | 1 |
| **合计** | | | | **35** |

事实表集定义位置：`server/test-support/m1-core-g03-g04-evidence.js:14`（G03，19 表）、
`:39`（G04，18 表）、`:71`（G03 L2 事实表集）。
G06-1 断言位置：`server/m1c-wp7a-gate-acceptance.test.js:1096-1097`、`:1106`。
G01 `businessSnapshot()` 位置：`server/m1c-wp1-procurement-notice-conversion.test.js:62`。

### 4.4 对一份早期独立复核表述的更正

一份早期独立复核曾表述 `supplier_bills`「全仓库无任何测试文件引用」。该表述经复核**不成立** ——
G06-1 的 `businessSnapshot()` 确实覆盖 `supplier_bills` 全行并与其余 9 张表一同做 `JSON.stringify`
逐字节比较。本裁定按复核结果**更正**该表述，**不**沿用其扩大结论。

## 5. 原 WP-K 接受范围与本次新增披露的差异

| 维度 | 原 WP-K 已接受 | 本次新增披露 | 关系 |
|---|---|---|---|
| 缺口性质 | 败方对**既有业务行**的原地改写未被检出（`added()` 只认新增 ID） | 4 个恒真固定期望槽位；35 个 (CR, 表) 组合的声明快照表未纳入该 CR 的业务不变量断言 | **同一类别、不同机制** |
| 是否覆盖新增披露 | 否 | — | 原接受范围**不包含**本次新增披露 |
| 是否影响 G07 PASS | 否（PASS 的其余断言不依赖恒真项） | 否（同向，只能下调证明力） | 一致 |
| 实证关闭途径 | WP-J（`DEFERRED_NOT_AUTHORIZED`） | 同属 WP-J 范畴，**本文不新增授权** | 一致 |

**本次新增披露扩展的是「测量强度差距」的描述范围，不改变其性质**（证据强度不足，非代码缺陷）。
原 WP-K 例外在**文字上**仅限「既有业务行逐字段零变化」，因此本裁定**不**追认原例外，
而是以**独立追加项**的方式接受新增披露，并在 §6.2 明确二者在包级验收中的共同引用方式。

## 6. 裁定决定与边界

### 6.1 R1-1 ～ R1-5 决定

| 编号 | 裁定事项 | 决定 |
|---|---|---|
| R1-1 | 是否追加式采纳 §4.1 的修正口径与 §4.2 的 4 个新增披露恒真槽位 | **采纳** |
| R1-2 | 是否追加式采纳 §4.3 的 35 个 (CR, 表) 组合边界说明，并明确其与原 WP-K 例外的关系 | **采纳**，作为**独立于原例外**的追加项；原例外**不**被追认或扩写（§5） |
| R1-3 | 是否维持 WP-J `DEFERRED_NOT_AUTHORIZED` 不变 | **维持不变**；本文**不**主张启动 Oracle 强度补强 |
| R1-4 | 是否将本项残余风险纳入 M1-Core 首期包级验收的跨 Gate 残余风险清单 | **纳入**，且**仅**限 M1-Core 首期包级验收评估 |
| R1-5 | 是否维持 `M1C-G07 PASS` 不变 | **维持不变** |

### 6.2 风险接受的精确范围

本次接受的**仅**是「G07 Oracle **测量强度**差距」的**扩大披露**，其效力范围严格限定为：

- **仅**在 **M1-Core 内部首期包级验收评估**中作为**明确例外**引用；
- 此处**不宣称**已满足 Active Design §13.1 对 G07 的逐字段快照要求；`M1C-G07 PASS` 的原文与原有效力
  **保持不变**；原 WP-K 裁定的原文与原有效力**保持不变**；
- **不豁免**真实业务数据丢失、库存估值破坏、未授权写入，或未来观测到的生产缺陷；
- **不授权**正式发布、部署、任何数据库写操作或任何新的真实 MySQL 执行；
- **不**改变 WP-I、WP-J、M-15 的 `NOT_PROVEN` / `DEFERRED_NOT_AUTHORIZED` 状态。

若后续审查发现实际业务缺陷，必须另行停止并处理，**不得引用本例外遮盖**。

## 7. 状态迁移

```text
Before : M1C-G07 = PASS；WP-K = M1C_G07_WPK_EVIDENCE_BOUNDARY_ACCEPTED_FOR_PACKAGE_REVIEW
         WP-J = DEFERRED_NOT_AUTHORIZED；Package = M1_CORE_ACCEPTANCE_BLOCKED
After  : M1C-G07 = PASS（**不变**）
         WP-K   = M1C_G07_WPK_EVIDENCE_BOUNDARY_ACCEPTED_FOR_PACKAGE_REVIEW（**不变**）
         WP-K-R1 = M1C_G07_WPK_R1_EVIDENCE_BOUNDARY_ACCEPTED_WITH_BOUNDED_RESIDUAL
         WP-J   = DEFERRED_NOT_AUTHORIZED（**不变**）
         Package= M1_CORE_ACCEPTANCE_BLOCKED（**不变**，须另行正式接受全部跨 Gate 残余风险）
```

七 Gate 状态 7/7 `PASS` **不变**；本文**不**签发包级 Acceptance、Capability Freeze、Domain Acceptance、
Manual Closure、Release Readiness、Tag、Release 或 Deploy。

## 8. 未发生

本裁定**未**修改 Active Requirement / Design、生产 Handler、DDL、Fixture、G07 Oracle、G07 合同、CR 集、
ACK-4 合同或任何已签发 Owner Acceptance；**未**连接真实 MySQL、**未**运行 G07、**未**签发或消费 ACK-4、
**未**执行 Reset / Bootstrap / Cleanup / Migration；**未** Push / Merge / Tag / Release / Deploy；
**未**恢复旧 13 Gate 为实施任务；**未**虚构 WP-I、WP-J 或 M-15 的完成状态。
