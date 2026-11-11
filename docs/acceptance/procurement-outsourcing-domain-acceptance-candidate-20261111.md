# 采购与委外域级 Acceptance 与 Capability Freeze 候签（2026-11-11）

> **用途**：本文件是 Procurement & Outsourcing 域**整域 Acceptance**与 **Capability Freeze** 的候签材料：汇总四轮整改的实施范围、逐项能力判定、Gate 证据、已披露限制与仍需业务所有者裁定的事项，供业务所有者据以签发（或退回）。
>
> **Owner**：Procurement & Outsourcing Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`PENDING_OWNER_DECISION` —— 本文件**不是** Acceptance 记录，**不是** Freeze 记录，**不是** Release Readiness。AGENTS.md §4.5：实现方自报 PASS 不替代业务所有者确认。
>
> **权威来源**：Requirement [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.1～§31.19；Design [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.1～§26.39；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §50；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)。
>
> **本文件的生成不等于** Git 提交、远端同步、发布、部署、真实环境 migration 或真实业务数据库写入。

```text
PROCUREMENT_OUTSOURCING_DOMAIN_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION
```

## 1. 候签范围

| 项 | 范围 |
|---|---|
| Domain | Procurement & Outsourcing（产品架构第 4 个业务域） |
| 手册对标 | B3101 采购管理、B3121 委外管理 |
| 能力集合 | PRC-01..26、VMI-01..05、OUT-01..23，共 **54 项** |
| 覆盖判定 | `COVERED` **50** 项；`PARTIAL` **0** 项；`MISSING` **0** 项；按已批准决定排除在本域范围外 **3** 项（PRC-06 / VMI-05 / OUT-22） |
| 合同基线 | §31.1～§31.19（Requirement）、§26.1～§26.39（Design） |
| 实施批次 | 第一轮 §31.16 / §26.36；第二轮 §31.17 / §26.37；第三轮 §31.18 / §26.38；**第四轮 §31.19 / §26.39** |
| 不在本次范围 | Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作、Accounting & Analytics 域与其他域的 Acceptance |

## 2. 第四轮整改（本次候签的新增内容）

第四轮闭合了 2026-11-10 域级逐项复核登记的 **9 项 `PARTIAL` 与 1 项 `MISSING`**：

| 能力 | 第四轮闭合内容 | focused 证据 |
|---|---|---|
| PRC-02 | 付款天数按供应商采购档案默认值驱动并冻结来源；品类**单向**门禁委外业务，普通采购由采购资质门禁把关 | `procurement-sourcing-capabilities.test.js` · PRC-02（2 条） |
| PRC-04 | 货源手工 override：管理权限 + 必填原因 + 有界区间 + 重叠拒绝 + 恰好一条审计；只在区间内放行 | 同上 · PRC-04（2 条） |
| PRC-12 | 请购转采购订单的 canonical 分配事实 + 专用审计 + 累计守恒；草稿整体改写原位更新带事实的行 | 同上 · PRC-12（2 条） |
| PRC-16 | `lower_tolerance_pct` 自动关单与关单事实（记录被容忍的短交数量） | 同上 · PRC-16（2 条） |
| PRC-17 | 预付款要求整条能力：业务意图层 + canonical 财务交接，单向状态机、SOD、幂等、审计、零副作用 | `procurement-prepayment.test.js`（15 条） |
| OUT-02 | 委外订单必须消费有效 OUTSOURCE 货源，与采购共用同一货源控制实现与同一参数开关 | `procurement-sourcing-capabilities.test.js` · OUT-02（3 条） |
| OUT-03 | 加工价来源可读出：OUTSOURCE 价格条目优先，否则委外合同来源；普通采购价格表不得静默替换 | `out-03-out-23.test.js` · OUT-03（5 条） |
| OUT-20 | 加工费正式过账按 `C-P01`～`C-P04`：金额上界、档案科目守卫、红冲守恒、共享入口边界 | `outsourcing-finance.test.js` · OUT-20 / C-P01 / C-P03 / C-P04（11 条） |
| OUT-21 | 成本证据在过账后转 `FINAL`，给出 actual 与 variance；基准金额在收货生效时确定且不被改写 | 同上 · OUT-21（1 条） |
| OUT-23 | 期初委外结余进入同一本 WIP 身份账并落在供应商 WIP 位置；委外供给接入期间关闭与财务业务关闭读模型 | `out-03-out-23.test.js` · OUT-23（11 条） |

第四轮同时修复了三类**在实现过程中发现的真实缺陷**（此前未被登记）：

1. **采购订单草稿整体改写 500**：PRC-12 的分配事实以外键引用采购订单行，原「删除全部行再重建」的改写方式触发外键失败并返回 500。改为**原位更新**带分配事实的行（行标识不变），分配事实不做任何 UPDATE；分配来源被删或分配数量被改时 fail closed。
2. **委外加工费红冲端点缺失**：`reverseProcessingFeeBill` 已实现但**未注册路由**（HTTP 404）。已补注册。
3. **采购订单整体改写未复用权威表头口径**：改写路径未执行品类门禁、未维护 `payment_terms_days_source`、且把「档案默认值补齐后的天数」误当作「客户端声明」。已改为创建与改写共用同一份解析原语，并把「客户端是否声明」与「补齐后的天数」分开传递。

## 3. Gate 证据（本地，2026-11-11）

| Gate | 结果 |
|---|---|
| `pnpm test`（FULL） | **3547/3548 PASS**，1 项失败（见 §4.1，已登记并需要真实 MySQL Gate 复跑） |
| `pnpm test:fast` | **631/632 PASS**，同上 1 项失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| focused（新增三个套件） | `procurement-sourcing-capabilities` **11/11**、`procurement-prepayment` **15/15**、`out-03-out-23` **16/16** |
| 文档一致性 `current` 模式 | N1、N3、N4、N5、N6、N8、N9 **PASS**；N2 `RETIRED`；**N7 FAIL**（既存历史提交 `a40e356`、`59eccd5`、`171ade5`、`4403a80` 的追溯债务，与本轮无关） |
| 文档一致性 `migration` 模式 | C1～C6 全 PASS |
| 离线 MySQL DDL 探针 | 第四轮 7 张新表与新列的**生产实际发出**的 MySQL DDL 已逐条核对（类型、默认值、CHECK、UNIQUE、外键），形态可被 MySQL 8 接受 |
| 真实 MySQL Gate（M1C-G07） | **本轮未运行** —— 需要业务所有者签发 ACK-4 清单与 RunId |

## 4. 必须随验收一并接受的事实

### 4.1 G07 离线对等回放的 1 项失败（已知、已登记）

期初 WIP 使 `outsourcing_wip_identity_effects.event_type` 的 CHECK 增加 `'OPENING'`（SQLite 重建表、MySQL `MODIFY COLUMN`）。G07 离线基础设施套件的 `R4` 对等回放把该表与**真实 MySQL 目录捕获条款**逐条比对；捕获值来自 2026-11-07 的真实 MySQL 8 运行，因此该条断言在**重新捕获**前失败。

- 该失败**不得**通过削弱断言、改写检查器或手写推测的目录条款来消除；
- 重新捕获只能来自新一轮受保护真实 MySQL Gate 的实际观测；
- 在此之前，**G07 的真实 MySQL 验收结论不因本轮变更自动延续**。

### 4.2 G07 固定场景重新冻结待显式确认

固定场景新增「建立有效 OUTSOURCE 货源」步骤（7 个场景各一步），冻结摘要由 `aa024bd5…` 重新计算为 **`f112c88cb6d327f4885cf349de4a6c4efd6b4a4b1499e0547727e7103ccad33f`**，并写回三处断言（`m1-core-g07-fixtures.js` 定义、`m1-core-g07-infrastructure.test.js` 与 `m1c-g07-sqlite-smoke.test.js` 断言）。

摘要链：`60f7888f…`（§45.34 委外工作面冻结）→ `aa024bd5…`（第一轮：新增采购价格步骤）→ **`f112c88c…`**（第四轮：新增 OUTSOURCE 货源步骤）。前两次重新冻结**均未见业务所有者显式确认**，本文件一并提请确认。

### 4.3 既有冻结证据被取代的断言

M1-Core G06 的断言「委外来源账单在**专用**入口与共享入口一律 409」被第四轮合同取代：共享入口仍一律 409（跨域边界不变），**专用**入口按 `C-P02` 会计档案放行。2026-11-07 首期包级 Acceptance 覆盖的 G06 证据在该条断言上**被取代**，必须随本次域级 Acceptance 重新确认。

### 4.4 界面可达性未取证

第四轮新增的**子能力**（预付款要求、货源 override、交货计划关单、加工费过账与红冲、期初委外）目前只有 API 层，没有新增前端工作面。§31.8 F 列举的五条 operator workflow 由既有页面承担，其浏览器闭环证据（29/29 与 32/32，见 §47.5）不变；**新增子能力的界面可达性未在本轮取证**，不得被描述为「已完成」。

### 4.5 委外加工费会计档案没有产品内维护入口

`C-P02` 的档案表当前只有迁移预置的一套全局默认档案（借方 6408 委外加工费、`tax_mode=NO_TAX`）。档案缺位时过账 fail closed，因此该缺口不会产生错误过账；但供应商级档案与税务政策变更暂不具备产品内维护路径。

### 4.6 跨域影响：新增会计科目 6408

第四轮在 canonical 科目登记簿中新增 `6408 委外加工费`（委外成品收货生效时直接入账，**没有在途物资腿**）。这使试算平衡的科目集合由 21 项变为 22 项；既有损益表与资产负债表口径不变（新增科目零余额时不产生行）。该科目属于 Accounting & Analytics 域的会计政策范畴，本域只登记「委外加工费的借方角色」，科目本身的存在是跨域事实。

### 4.7 供应商品类的单向门禁口径

第四轮把「品类互斥」调整为「品类只门禁委外业务」。理由是现实业务中「既是物料供应商、又是委外加工商」是常态，互斥会让这种供应商无法存在，而普通采购侧的门禁（采购资质 + 权威价格 + 货源控制）本来就完整。**这是本轮作出的业务政策选择**，若业务所有者要求品类互斥，需追加裁定并同步改动既有委外场景（见 §31.19.2）。

## 5. 未解决矛盾（需要业务所有者裁定）

| # | 事项 | 候选处置 |
|---|---|---|
| 1 | 真实 MySQL Gate 的 ACK-4 清单与 RunId | 签发后复跑 M1C-G07，重新捕获目录条款并确认 §4.1 |
| 2 | G07 固定场景 `f112c88c…` 的重新冻结 | 显式确认，或要求重做固定场景 |
| 3 | M1-Core G06 被取代断言的重新确认 | 随域级 Acceptance 一并接受，或要求补充证据 |
| 4 | 供应商品类单向门禁（§4.7） | 接受当前口径，或裁定为互斥 |
| 5 | 委外加工费会计档案的产品内维护入口 | 接受为已知限制，或纳入下一轮范围 |
| 6 | 新增子能力的界面可达性（§4.4） | 接受为已知限制，或纳入下一轮范围 |
| 7 | OUT-22 成品退货的正式延期决策 ID | 补登 `MC-REQ-15` 类条目 |
| 8 | 域级 Acceptance 与 Capability Freeze 的**签字** | 本文件的最终决定 |

## 6. 本次候签**不**主张的内容

- 不主张任何 Domain 已 Freeze —— Capability Freeze 需要业务所有者的单独决定；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张 §4.1 的 G07 对等断言已通过；
- 不主张 3 项排除在范围外的能力（PRC-06 / VMI-05 / OUT-22）已被实现或已覆盖；
- 不主张第四轮新增子能力已具备界面可达性；
- 不主张任何真实 MySQL 运行、真实环境 migration 或业务数据库写入已经发生；
- 不主张本文件等同于业务所有者签字。

## 7. 待业务所有者填写的决定

| 项 | 决定 |
|---|---|
| 域级 Acceptance | ☐ 通过（`PROCUREMENT_OUTSOURCING_DOMAIN_ACCEPTANCE_PASS`）　☐ 有界通过　☐ 退回 |
| Capability Freeze | ☐ 冻结 50 项 `COVERED` 能力　☐ 部分冻结（列出范围）　☐ 不冻结 |
| §4.1 的 G07 对等断言 | ☐ 接受为已知未闭合项　☐ 要求立即复跑真实 MySQL Gate |
| §4.2 的固定场景重新冻结 | ☐ 确认 `f112c88c…`　☐ 不确认 |
| §4.3 的 G06 取代 | ☐ 随本次验收重新确认　☐ 要求补充证据 |
| §4.7 品类口径 | ☐ 接受单向门禁　☐ 改为互斥 |
| 签字人 / 日期 | 　 |

决定来源应为业务所有者在对话或正式单据中的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。
