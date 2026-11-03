# M1-Core 加工费 PO 正式可达路径 — Design Amendment 候选（R1）

> **用途**：补齐 M1-Core Active Design 中“委外订单 → 加工费 PO”的正式生产 Writer、API、事务、权限、状态、审计、下游来源校验、测试与回滚设计，使 `M1C-G02` / `M1C-G07` 可在不使用测试私有 SQL 的前提下建立完整来源链。
> **Owner**：Procurement & Outsourcing Domain Owner
> **状态**：`PENDING_APPROVAL` / `PENDING_REVIEW`
> **权威来源**：已批准 Requirement [`docs/requirements/procurement-outsourcing.md`](../../requirements/procurement-outsourcing.md) §31.13，以及当前 Active Design [`docs/design/procurement-outsourcing-m1-core.md`](../../design/procurement-outsourcing-m1-core.md)。
> **来源 SHA**：`759d7216c7546ffa00a147f603c4e8852aada991`（Active Design 基线）；来源设计 `912fd76700ff6f3ad1509eec4c9e2241c1830265`。
> **来源章节**：`docs/requirements/procurement-outsourcing.md §31.13` 与 `docs/design/procurement-outsourcing-m1-core.md §2.3、§3、§5–§10、§13.1、§14–§17`。
> **Implementation**：`NOT_AUTHORIZED`
> **Design PASS**：`NOT_ISSUED`
> **Promotion 结果**：业务所有者于 2026-11-03 批准 R1；批准内容已精确融合至
> [`docs/design/procurement-outsourcing-m1-core.md`](../../design/procurement-outsourcing-m1-core.md)。
> 本文件保留为 `627559c6032d9ec0adb2740a38e41a16b168dd59` 候审快照与审查来源；
> 上述 `PENDING` / `NOT_ISSUED` 元数据描述该候审快照，不再构成当前 Active Contract。
> **权威边界**：本文件是 Promotion 前的增量候审 Design，**不构成 Current Active Contract**；
> 当前权威合同只位于 Active Design，本文件的历史批准亦不授权 Implementation。
> **授权来源**：业务所有者于 2026-11-03 选择“由委外订单流程显式创建加工费 PO 草稿，底层复用统一采购订单 canonical Writer，不开放通用采购订单接口指定业务类型，也不自动审批”。本 R1 仅修订设计。
> **影响 Active Design 章节**：§2.3、§3、§5、§6、§7、§8、§9、§10、§13.1、§14–§17。
> **Schema / Migration**：现有列可表达来源关系，但不能跨并发可靠保证来源唯一性。§6.4 提出最小 additive 唯一性方案；该方案仍需独立 Schema / Migration 授权，本轮不实施。

## R1 Independent Review Fix Summary

| ID | 原缺陷 | 修订章节 | 修订结论 | 是否仍需 Owner 决策 |
|---|---|---|---|---|
| P0-01 | 加工费 PO 商业修改会删除重建行，Item ID 不稳定 | §2.2、§4.2 | 单一来源行原位更新；ID、来源、产品、数量及 UOM 快照不可变 | 否 |
| P0-02 | PO Change 可绕过来源锁定 | §2.3、§4.3 | ADD/MODIFY 在 create/approve/apply 全部拒绝；CANCEL 首期 fail closed | CANCEL 与重建政策仍需 |
| P0-03 | 通知、收货未完整强制 APPROVED 与行级来源 | §8 | 创建与生效均重读 PO、PO Item、通知及来源事实 | 否 |
| P1-01 | 幂等、唯一性和并发判定顺序不清 | §6 | 精确重放优先；父行锁；数据库唯一约束兜底；确定化冲突结果 | 唯一性/重建政策及 Schema 授权仍需 |
| P1-02 | 非创建人无法补齐并提交来源生成 PO | §5 | `M1C-PO-P01 = OWNER_APPROVAL_REQUIRED`；未批准前不得实现例外 | 是 |
| Price/UOM | 金额精度与 canonical 快照输入不完整 | §3.2、§4.2 | 安全整数分、精确有理数数量与完整 UOM/换算快照 | 价格/数量口径不足时仍需 |
| 404 Audit | 候选错误扩大了 404 审计义务 | §7 | 400/403/409 保持 Active Design；404 不新增 Domain 审计义务 | 否 |
| Test Matrix | 缺少绕过、行稳定、下游与并发场景 | §10 | 增补 Writer/Mutator、端到端、并发、RBAC、审计及回归矩阵 | 否 |

## 1. 问题与设计决定

当前 `POST /api/purchase-orders` 只创建 `STANDARD_PURCHASE`，没有正式 Writer 同时写入
`business_type='OUTSOURCE_PROCESSING'`、`source_outsourcing_order_id` 与可追溯加工费行。现有
`updatePurchaseOrder()` 还会删除并重建全部明细，PO Change 又能直接 ADD/MODIFY/CANCEL；仅新增创建 API 不能证明端到端来源不可绕过。

本 Amendment 固定以下方向：

1. 委外订单达到 `RELEASED` 后，由独立显式命令创建加工费 PO；创建或 RELEASE 委外订单均不自动创建 PO。
2. 标准 PO、请购转 PO、加工费 PO 复用一个内部 canonical draft Writer；不再新增第二套 PO 持久化引擎。
3. 通用 PO HTTP API 永远只创建 `STANDARD_PURCHASE`，外部字段不能切换类型或委外来源。
4. 新建加工费 PO 固定为 `DRAFT`，不自动提交或审批，不产生库存、估值、GRNI、AP 或 GL 效力。
5. 加工费 PO 首期只有一条来源锁定的加工费商业行；企业供料仍由委外用料链负责，不进入该 PO。

## 2. Module / Function Responsibility

### 2.1 内部 canonical draft Writer

在 `server/modules/procurement-orders.js` 建立非 HTTP、无隐含授权的领域服务：

```text
createPurchaseOrderDraftCanonical(db, actor, command)
```

它是所有新建 PO 的唯一持久化 owner，负责生成 PO/Item ID 与单号、验证受信 command、计算安全金额、写表头和完整快照、写行并写一条成功审计。调用方负责权限和来源重读；Writer 自身仍 fail closed 校验：

- `businessType` 只能是内部枚举 `STANDARD_PURCHASE | OUTSOURCE_PROCESSING`；
- `OUTSOURCE_PROCESSING` 必须有非空 `sourceOutsourcingOrderId` 且恰好一行；`STANDARD_PURCHASE` 的该来源必须为 `NULL`；
- 初始状态固定为 `DRAFT`；
- 所有行 ID 在此一次生成，之后不得由商业更新重新生成。

现有创建路径的收敛目标如下：

| Writer / Mutator | 允许类型 | R1 后责任与守卫 |
|---|---|---|
| `server/app.js::createPurchaseOrder()` | `STANDARD_PURCHASE` | 拒绝客户端类型/委外来源字段；构造标准 command 后调用 canonical Writer |
| `planning-documents.js::createPurchaseOrderGroups()` | `STANDARD_PURCHASE` | 请购锁定与分组仍由 Planning owner；每组调用 canonical Writer，不再直写 PO/Item |
| `outsourcing.js::createOutsourcingProcessingPurchaseOrder()` | `OUTSOURCE_PROCESSING` | 重读委外来源并构造唯一加工费行；只调用 canonical Writer |
| `server/app.js::updatePurchaseOrder()` | 两类分支 | 标准 PO 行为不变；加工费 PO 进入 §2.2 原位更新器 |
| `create/approve/applyPurchaseOrderChange()` | 标准 PO 保持既有合同 | 加工费 PO 统一执行 §2.3 守卫 |
| `changePurchaseOrderState()` | 两类 | 仅状态机；不得改写来源字段或替换 Item |

Implementation 验收须以生产代码检索和调用图证明：除 canonical Writer、受控加工费原位更新器及获准的 PO Change 标准分支外，不存在仍可 INSERT/DELETE/UPDATE `purchase_orders` 或 `purchase_order_items` 的绕过入口；migration/backfill 不计运行时 Writer，但不得被业务路由调用。

### 2.2 加工费 PO 商业字段原位更新器

`updatePurchaseOrder()` 在事务内重读表头和唯一明细后按 `business_type` 分派。对 `OUTSOURCE_PROCESSING` 调用内部
`updateOutsourcingProcessingPurchaseOrderCommercialFields()`，只允许 `DRAFT` / `REJECTED`，并仅原位更新白名单：

- 表头：`order_date`、`expected_delivery_date`、`payment_terms`、`payment_terms_days`、供应商联系人/电话/地址快照、`remark`；
- 唯一行：`unit_price_cents` 与由锁定数量精确重算的 `amount_cents`；
- 表头：由唯一行精确重算的 `total_cents`。

更新前必须重读并验证恰好一行、行属于当前 PO、PO 类型/来源非空、供应商/产品/数量/UOM 快照仍与权威委外来源一致。以下事实全部不可修改：

`purchase_order_items.id`、`order_id`、`line_no`、`product_id`、来源数量、`document_uom_code`、`document_quantity_num/den`、`conversion_numerator/denominator`、`base_quantity_num/den`、`purchase_orders.business_type`、`source_outsourcing_order_id`、`supplier_id`。

加工费 PO 禁止增行、删行、替换行和 `DELETE + INSERT`。任何非白名单输入或来源事实不一致均以精确 409 整体回滚。`STANDARD_PURCHASE` 的既有更新语义不因本 Amendment 改变。

### 2.3 PO Change 防绕过守卫

建立共享 `assertProcessingPurchaseOrderChangeAllowed()`，并在 `createPurchaseOrderChange()`、`approvePurchaseOrderChange()`、`applyPurchaseOrderChange()` 各自事务/权威重读之后调用，不能只在 apply 阶段保护：

- `ADD`：对 `OUTSOURCE_PROCESSING` 一律 409；
- `MODIFY`：对 `OUTSOURCE_PROCESSING` 一律 409，商业字段只能走 §2.2；
- `CANCEL`：在 Owner 批准完整政策前对 `OUTSOURCE_PROCESSING` 一律 409，既有标准 PO 合同不变。

若未来批准 CANCEL，最低安全门禁必须同时满足允许的 PO 状态，且不存在任何有效完工通知、待检/已生效委外收货、IQC、库存、结算或其他下游引用；发现任一下游即 fail closed。取消后的同源重建、历史承诺保留及唯一性模型记为 `M1C-PO-P02 = OWNER_APPROVAL_REQUIRED`，不得由实现自行决定。

## 3. API 与规范化输入合同

### 3.1 有界创建命令

```http
POST /api/procurement/outsourcing/orders/:id/processing-fee-purchase-orders
Idempotency-Key: <required non-empty key>
```

请求体只允许商业字段：`unitPriceCents`、`orderDate`、`expectedDeliveryDate`、`paymentTerms`、`supplierContactName`、`supplierContactPhone`、`supplierAddress`、`remark`。`supplierId`、`productId`、`quantity`、`businessType`、`sourceOutsourcingOrderId` 全部由事务内权威委外订单派生，客户端传入即 400。

通用 `POST /api/purchase-orders` 对任一 camel/snake case 的类型或委外来源字段返回 400
`PURCHASE_ORDER_BUSINESS_TYPE_NOT_CLIENT_SETTABLE`，不得忽略后继续创建。

### 3.2 Price / Quantity / UOM

- `unitPriceCents` 必须是 `Number.isSafeInteger` 范围内的非负整数分；草稿允许 0，非赠品行提交前仍必须大于 0；
- 来源数量不接受浮点近似覆盖。command 使用规范化有理数，并必须完整携带
  `documentUomCode`、`documentQuantityNumerator/Denominator`、`conversionNumerator/Denominator`、`baseQuantityNumerator/Denominator`；所有分子为安全整数、分母为正安全整数；
- 产品、来源数量及 UOM/换算快照来自已批准委外订单/产品权威事实，商业 API 不得覆盖；
- `amountCents` 复用现有采购订单精确舍入口径，由规范化数量与安全整数单价计算；结果和 PO 汇总均须为安全整数分，溢出即 400/409 且零写入；
- 不凭空生成价格。加工费总价、分摊或数量口径若不能从已批准合同证明，登记 Owner 决策，不能在 Writer 内推导。

## 4. State / Source / Multiplicity

### 4.1 创建状态与来源

只有 `RELEASED` 委外订单可创建 `DRAFT OUTSOURCE_PROCESSING` PO。供应商、成品、来源数量和 UOM 必须在事务内可证明；否则 409。加工费 PO 不承担成品收货容量上限，该上限仍由委外订单剩余可收数量决定。

### 4.2 Item 身份稳定

加工费 PO 创建后始终恰好保留一条来源锁定行。商业单价修改前后 Item ID 和全部来源/UOM 字段完全一致；已有下游引用不会因 PO 编辑失效。任何检测到多行、缺行或来源漂移的历史记录均 fail closed，不自动修复。

### 4.3 Multiplicity / CANCEL 待决政策

当前候选建议同一委外订单最多一张加工费 PO，并以数据库唯一约束作为并发兜底；这会连同 `CANCELLED` 历史一起禁止同源重建。该业务政策与取消后重建规则尚未获批，统一登记为 `M1C-PO-P02 = OWNER_APPROVAL_REQUIRED`。在批准前：创建发现任意同源加工费 PO均 409，CANCEL 也对加工费 PO fail closed；不得用“只查非取消记录”形成未批准的重建通道。

## 5. Permission / SOD

| 动作 | 权限 | 设计状态 |
|---|---|---|
| 从委外订单显式创建加工费 PO 草稿 | `OUTSOURCING_MANAGE` | 已批准方向；只创建 DRAFT，不授予采购提交/审批权 |
| 修改加工费 PO 商业字段 | `PURCHASE_ORDERS_CREATE` + 来源/状态守卫 | 非创建人例外待 Owner 批准 |
| 提交 | `PURCHASE_ORDERS_SUBMIT` + 提交门禁 | 非创建人例外待 Owner 批准 |
| 审批/驳回 | `PURCHASE_ORDERS_APPROVE` | 复用既有流程；创建人仍不得审批自己创建的 PO |

候选政策 `M1C-PO-P01 = OWNER_APPROVAL_REQUIRED`：对真实、可验证的 `OUTSOURCE_PROCESSING` PO，建议允许持有相应采购权限的非创建人原位补齐商业字段并提交；审批仍由独立 `PURCHASE_ORDERS_APPROVE` 主体执行。该例外不适用于 `STANDARD_PURCHASE`，不放宽来源锁定，不给委外业务员采购提交/审批权，也不能以 admin 代替真实职责分离验证。Owner 未批准前，Implementation 不得改变现有 creator 限制。

## 6. Transaction / Idempotency / Uniqueness / Concurrency

### 6.1 判定顺序

进入事务后固定顺序：

1. 校验权限、必填 Header 与允许字段；对允许字段完成规范化并计算 fingerprint；
2. 以 `(OUTSOURCING_PROCESSING_PO_CREATE, outsourcing_order_id, Idempotency-Key)` 查询幂等结果：同 Key 同 fingerprint 立即返回原 PO `200 + replayed:true`；同 Key 异 fingerprint 返回精确 409；
3. 非重放请求锁定并重读委外订单父行；SQLite 使用外层写事务，MySQL 使用该父行 `SELECT ... FOR UPDATE` 或 adapter 等价行锁；
4. 验证 RELEASED、供应商/资质、产品、数量及 UOM；
5. 检查同源 PO。发现已有记录返回 409；合法精确重放不会被此检查抢先拒绝；
6. 调用 canonical Writer 写表头、唯一行及成功审计；保存幂等结果；同一事务提交。

### 6.2 Fingerprint 规范化

fingerprint 只包含路由委外订单 ID 与 §3.1 允许字段的规范值：缺省可选字符串统一为空字符串，文本按输入合同 trim，日期统一 `YYYY-MM-DD` 或 `null`，`unitPriceCents` 统一为安全整数，字段按固定键序列化。不得包含 actor/tenant，不得包含服务端派生的可漂移主数据快照。外部 Idempotency-Key 不替代库存等下游既有 Mutation Key。

### 6.3 原子性与确定结果

PO、Item、成功审计和幂等结果必须原子提交。精确重放不新增 PO、Item、成功审计或幂等记录。不同 Key 并发时只能一个成功，另一方稳定映射为
`OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS`；唯一约束冲突在事务边界转换为同一 409，不暴露数据库异常。

### 6.4 最小 additive 唯一性方案（另需授权）

仅靠“查询后插入”和父行锁不足以证明所有 Writer、SQLite/MySQL 故障恢复与未来调用方都不会产生重复。推荐最小方案是在
`purchase_orders(source_outsourcing_order_id)` 建立 UNIQUE 索引：标准 PO 必须保持 `NULL`，SQLite 与 MySQL 均允许多个 `NULL`，非空委外来源只能出现一次。该方案与 §4.3 的“包含取消历史、禁止重建”建议一致。

若 Owner 选择“取消后可重建”，不得复用上述模型；需另行设计可移植 active-key（含历史保留与状态转换原子性）。两种方案均属于 Schema/Migration 变化，必须另获授权、覆盖 SQLite/MySQL migration/rollback/concurrency 后才能实施。本轮不改 Schema、不运行 migration。

## 7. Error / Audit / Zero Side Effect

| 条件 | HTTP / Code | 审计合同 | 零副作用 |
|---|---|---|---|
| 无权限 | 403 | 按 Active Design 全局合同恰好一条，且不泄露业务身份 | 不读/写业务来源 |
| 缺 Header、字段或格式非法 | 400 | 不写 Domain 拒绝审计 | PO/Item/幂等记录均为 0 |
| 委外订单不存在 | 404 | 沿用当前行为；本候选不新增 Domain 审计义务 | 同上 |
| 状态、来源、重复、PO Change 或下游门禁冲突 | 409 + 稳定 code | 恰好一条业务拒绝审计 | 既有事实不变，无部分写入 |
| 成功创建 | 201 | 与 PO/Item/幂等结果同事务恰好一条成功审计 | 不产生库存/财务副作用 |

404 若未来需要新增 Domain 审计，必须单独批准，不能在本候选中伪称既有合同。403、409 继续遵守 Active Design；拒绝审计不记录 Token、Secret 或请求原文。

## 8. Downstream Flow and Source Recheck

```text
RELEASED 委外订单 → 显式创建 DRAFT 加工费 PO → 采购补齐/提交 → 独立审批
→ OUTSOURCE 完工通知 → 待检委外收货表头/明细 → IQC PASS/WAIVED → 收货生效
```

### 8.1 OUTSOURCE 完工通知创建

首期请求必须提供 `processingPoId`，或由服务端以已批准的唯一性规则确定且结果恰好一个；不得以省略值绕过。`createReceiptNotice()` 必须校验 PO 存在、类型为 `OUTSOURCE_PROCESSING`、状态为 `APPROVED`、来源委外订单和供应商一致，并读取唯一 PO Item，校验 Item 属于该 PO、产品/来源数量/UOM 快照与权威来源一致。PO 行仅证明加工费来源，不作为通知/收货容量上限。

### 8.2 委外收货创建

`createOutsourcingReceipt()` 必须同时验证委外订单、APPROVED 加工费 PO、唯一 PO Item、CONFIRMED OUTSOURCE 通知及通知明细、仓库、供应商、产品、UOM、LOT/SERIAL（适用时）。每个
`outsourcing_receipt_items.processing_po_item_id` 必须指向当前委外订单绑定的该 APPROVED PO 的唯一行；不得只校验表头后接受任意 Item ID。

### 8.3 委外收货生效

`confirmOutsourcingReceipt()` 必须在核心 mutation 事务内重新锁定/重读收货、委外订单、加工费 PO、PO Item、通知/通知行与收货行，并再次确认 PO 仍为 `APPROVED`、类型/委外来源/供应商一致，PO Item 的归属、产品和 UOM 与各行一致，通知仍为 `CONFIRMED`。任一事实漂移均在库存、倒冲、成本、审计写入前 409 整体回滚。

### 8.4 历史数据

历史缺少加工费 PO、通知来源或 Item 引用的记录不自动生成、匹配、回填或改写。只读查询按既有合同保留；任何新增 mutation 对不可证明来源 fail closed。

## 9. Compatibility / Rollback

- `STANDARD_PURCHASE` 的外部 API、creator 限制、状态机和既有商业更新行为不变；统一 Writer 迁移须以回归证明语义等价。
- 加工费 PO 创建/审批自身不产生库存或会计效力，M1C-WP5 的 AP/GL 拒绝边界不放宽。
- 行为回滚可停用新委外 action route；已创建 DRAFT/历史 PO 保留为可追溯事实，不删除、不改写。
- additive 唯一索引仅在独立授权、预检无重复、双数据库验证与明确 rollback 后部署；本 Amendment 不授权执行。

## 10. Tests / Gate Amendment

测试须登记到 `scripts/testing/test-suites.js` 的正确 suite；正向链只用正式 HTTP API，不以私有 SQL 制造加工费 PO：

1. 显式创建得到单行 `DRAFT OUTSOURCE_PROCESSING`，来源/供应商/产品/数量/UOM/金额快照正确且无自动审批、库存、估值、GRNI/AP/GL；
2. 商业单价更新前后 Item ID、行数 1、来源身份、产品、数量、UOM 快照不变，下游引用仍有效；篡改返回 409 且零部分写入；
3. PO Change ADD/MODIFY 在 create、approve、apply 三阶段分别被拒；CANCEL 在政策未批准时被拒，存在任一下游时始终被拒；
4. 通用 PO API 类型/来源字段被 400 拒绝；Planning/标准 PO 路径仍只创建标准 PO且行为无回归；
5. OUTSOURCE 通知缺 PO、未审批 PO、错来源/供应商/Item/产品/UOM 均被拒；合法 APPROVED 链可达；
6. 收货创建及生效分别覆盖完整来源重读；生效前将 PO 状态或来源事实改坏时，库存/倒冲/成本/审计零副作用；
7. 同 Key 同规范请求精确重放，`200 + replayed:true` 且不重复成功审计；同 Key 异内容精确 409；缺省值与等价规范输入 fingerprint 一致；
8. 不同 Key 并发创建只有一个 201，另一方稳定 409；SQLite 与获单独授权的 disposable MySQL gate 验证唯一约束和锁语义；
9. `M1C-PO-P01` 获批后才启用非创建人 UPDATE/SUBMIT 正向测试；同时验证权限缺失、伪造类型、创建人自审、普通 PO creator 限制和真实不同主体 SOD；
10. 400 无 Domain 拒绝审计、403 恰好一条全局审计且不泄露、404 沿用现状、409 恰好一条业务拒绝审计；所有拒绝均零业务变化；
11. 历史来源不完整记录 fail closed 且 GET/CHECK 不静默修复；
12. 生产代码调用图/检索证明运行时 PO/Item Writer 与 Mutator 全部命中 §2 矩阵，形成 zero-bypass proof。

`M1C-G02` 的 L1 前置链更新为“委外订单 → 显式创建/提交/审批加工费 PO → OUTSOURCE 通知 → 待检收货明细 → IQC → 生效”；`M1C-G07` 明确纳入正式 API 造数、Item ID 稳定和并发唯一性证据，不新增第 8 个 Gate。

## 11. Promotion / Hard Stop

本候选完成 R1 文档修订，但仍含两项 Owner 政策依赖：

- `M1C-PO-P01 = OWNER_APPROVAL_REQUIRED`：非创建采购人员更新/提交例外；
- `M1C-PO-P02 = OWNER_APPROVAL_REQUIRED`：同源唯一范围、CANCEL 与取消后重建政策，并连带决定唯一性 Schema。

此外 Schema/Migration 方案必须另行授权。只有业务所有者批准这些依赖及本 Amendment 后，才能将精确内容合并到 Active Design；在此之前不得提升状态、不得签发 Design PASS、不得恢复 WP2–WP6 Implementation。

```text
M1C_PROCESSING_PO_DESIGN_R1_READY_FOR_INDEPENDENT_REVIEW
```

**DESIGN HARD STOP**：本轮不修改实现、Schema、Migration、测试或权限配置；WP2–WP6 未提交工作树保持原状，WP7 不启动。
