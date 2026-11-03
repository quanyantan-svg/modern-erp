# M1-Core 加工费 PO 正式可达路径 —— Design Amendment 候选

> **用途**：补齐 M1-Core Active Design 中“委外订单 → 加工费 PO”的正式生产 Writer、
> API、事务、权限、状态、审计、测试与回滚设计，使 `M1C-G02` / `M1C-G07` 可以在
> 不使用测试私有 SQL 的前提下建立完整来源链。
> **Owner**：Procurement & Outsourcing（Domain Owner）
> **状态**：`PENDING_APPROVAL` / `PENDING_REVIEW`
> **权威来源**：已批准 Requirement
> [`docs/requirements/procurement-outsourcing.md`](../../requirements/procurement-outsourcing.md) §31.13，
> 以及当前 Active Design
> [`docs/design/procurement-outsourcing-m1-core.md`](../../design/procurement-outsourcing-m1-core.md)。
> **权威边界**：本文仅是增量候选 Design，**不构成 Current Active Contract**；
> 未获业务所有者批准并提升入 Active Design 前，不授权对本增量进行 Implementation。
> **授权来源**：业务所有者于 2026-11-03 明确选择：
> “由委外订单流程显式创建加工费 PO 草稿，底层复用统一采购订单 canonical Writer，
> 不开放通用采购订单接口随意指定业务类型，也不自动审批。”
> **影响 Active Design 章节**：§2.3、§3、§5.1、§6、§7、§8.1、§9、§13.1、§14、§16。
> **Schema / Migration**：无。复用已有 `purchase_orders.business_type` 与
> `purchase_orders.source_outsourcing_order_id`；本候选不授权执行 migration。

## 1. 问题与设计决定

当前正式 `POST /api/purchase-orders` 在 `server/app.js::createPurchaseOrder()` 中把
`business_type` 固定写为 `STANDARD_PURCHASE`，全仓库没有正式 Writer 同时写入：

- `business_type='OUTSOURCE_PROCESSING'`；
- `source_outsourcing_order_id=<委外订单 ID>`；
- 可追溯的加工费 PO 行。

因此现有正向测试只能以手写 SQL 制造下游前置事实，与 §31.13、Active Design
`M1C-G07` 以及本轮“禁止使用手写 SQL 制造正向生产通路”的约束冲突。

本 Amendment 固定以下决定：

1. **显式命令**：委外订单下达后，由委外流程的独立命令创建加工费 PO 草稿；
   创建委外订单或将其推进到 `RELEASED` **都不自动创建 PO**。
2. **统一 Writer**：标准采购 PO 与加工费 PO 共用一个内部 canonical draft Writer；
   不复制 `purchase_orders` / `purchase_order_items` 写入逻辑。
3. **HTTP 边界隔离**：通用 `POST /api/purchase-orders` 永远只能创建 `STANDARD_PURCHASE`；
   外部请求不得提交 `businessType` 或 `sourceOutsourcingOrderId` 切换类型。
4. **草稿而非审批事实**：新建加工费 PO 只能是 `DRAFT`；不自动 `SUBMITTED` / `APPROVED`，
   不产生收货、库存、估值、GRNI、AP 或 GL 效力。

## 2. Module / Function Responsibility

### 2.1 内部 canonical Writer

在 `server/modules/procurement-orders.js` 新增一个**非 HTTP**、不自带授权的领域服务：

```text
createPurchaseOrderDraftCanonical(db, actor, command)
```

`command` 由已授权的调用方构造，Writer 负责：

- 统一生成 `id` / `order_no`；
- 写入 `purchase_orders` 表头、供应商联系/地址/付款条款快照；
- 通过唯一明细写者写入 `purchase_order_items` 及 UOM/数量/金额快照；
- 对 `businessType` 只接受受信的内部枚举
  `STANDARD_PURCHASE | OUTSOURCE_PROCESSING`；
- `OUTSOURCE_PROCESSING` 必须有 `sourceOutsourcingOrderId`；
  `STANDARD_PURCHASE` 必须为 `NULL`；
- 状态固定写为 `DRAFT`；
- 写入一条 `CREATE` 审计，详情含业务类型和委外来源 ID（若有）。

`server/app.js::createPurchaseOrder()` 保留现有公共 HTTP 合同与
`PURCHASE_ORDERS_CREATE` 权限，但其持久化改为调用该 Writer，并强制传入：

```text
businessType = STANDARD_PURCHASE
sourceOutsourcingOrderId = null
```

### 2.2 委外流程 Handler

在 `server/modules/outsourcing.js` 新增：

```text
createOutsourcingProcessingPurchaseOrder(db, req, res, actor, outsourcingOrderId)
```

职责仅包括：授权、请求解析、事务内重读委外订单/供应商/产品、重复来源检查、
构造受信 command、调用 canonical Writer 并返回结果。它不得自行写
`purchase_orders` 或 `purchase_order_items`。

## 3. API 合同

### 3.1 新增的有界命令

```http
POST /api/procurement/outsourcing/orders/:id/processing-fee-purchase-orders
Idempotency-Key: <required non-empty key>
```

请求体仅允许：

```json
{
  "unitPriceCents": 0,
  "orderDate": "YYYY-MM-DD",
  "expectedDeliveryDate": "YYYY-MM-DD",
  "paymentTerms": "",
  "supplierContactName": "",
  "supplierContactPhone": "",
  "supplierAddress": "",
  "remark": ""
}
```

- `supplierId`、`productId`、`quantity`、`businessType`、`sourceOutsourcingOrderId`
  **全部从权威委外订单派生，客户端不得传入**。
- 加工费 PO 只写一条来源锁定行：产品 = 委外订单成品，数量 =
  `outsourcing_orders.order_quantity`，基础 UOM 与委外订单/产品一致。
- `unitPriceCents` 必须是非负安全整数分；草稿可为 0，但现有 PO `SUBMIT`
  门禁仍要求非赠品行单价大于 0。
- 联系人、电话、地址与付款条款可显式提供；未提供时从当前供应商主数据快照。
- 首次成功返回 `201`；精确幂等重放返回 `200` + `replayed:true`。

### 3.2 通用 PO API 的防绕过边界

`POST /api/purchase-orders` 对 `businessType`、`business_type`、
`sourceOutsourcingOrderId`、`source_outsourcing_order_id` 一律 400
`PURCHASE_ORDER_BUSINESS_TYPE_NOT_CLIENT_SETTABLE`；不能忽略这些字段后继续创建，避免调用方误以为已创建加工费 PO。

## 4. State / Source / Multiplicity

1. 只有 `RELEASED` 委外订单可创建加工费 PO 草稿；其他状态返回 409
   `OUTSOURCING_ORDER_NOT_RELEASED`。
2. 同一委外订单同时只能有一张非 `CANCELLED` 的 `OUTSOURCE_PROCESSING` PO。
   已存在时返回 409 `OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS`；已驳回 PO 仍应修订后重提，
   不得以新建第二张规避审批历史。
3. `business_type`、`source_outsourcing_order_id`、供应商、产品、来源数量是不可变来源事实。
   通用 PO 草稿更新路径对 `OUTSOURCE_PROCESSING` 只允许更新商业快照、单价、日期、
   付款条款与备注；任何来源字段或行数量改变均 409
   `OUTSOURCING_PROCESSING_PO_SOURCE_IMMUTABLE`。
4. 只有 `APPROVED` 加工费 PO 可用于 `OUTSOURCE` 完工通知与委外收货。

## 5. Permission / SOD

| 动作 | 服务端权限 | 说明 |
|---|---|---|
| 从委外订单显式创建加工费 PO 草稿 | `OUTSOURCING_MANAGE` | 只创建 `DRAFT`，不授予采购审批权 |
| 更新加工费 PO 商业字段 | `PURCHASE_ORDERS_CREATE` | 对来源字段保持不可变 |
| 提交 | `PURCHASE_ORDERS_SUBMIT` | 不自动提交；见下方有界来源单据例外 |
| 审批/驳回 | `PURCHASE_ORDERS_APPROVE` | 完全复用既有 PO 工作流，不自动审批 |

现有 PO 更新/提交还有“只能创建人操作”限制，而委外业务员按已批准
`M1-P-03` 不持有采购提交权。为避免只能由 admin 绕过的不可达状态，仅对同时满足
`business_type='OUTSOURCE_PROCESSING'` 且 `source_outsourcing_order_id IS NOT NULL` 的来源生成 PO：

- 持有 `PURCHASE_ORDERS_CREATE` 的采购人员可在 `DRAFT` / `REJECTED` 更新允许的商业字段，
  不受 `creator_id` 限制；
- 持有 `PURCHASE_ORDERS_SUBMIT` 的人员可提交该来源生成 PO，不受 `creator_id` 限制；
- 该例外不适用于 `STANDARD_PURCHASE`，也不放宽审批权限。

## 6. Transaction / Lock / Idempotency

命令在一个事务内按以下顺序执行：

1. 按 `outsourcing_order_id` 锁定并重读委外订单；
2. 验证 `RELEASED`、供应商启用/委外资质有效、产品启用、数量/UOM 可表示；
3. 查询并锁定该来源下已有 `OUTSOURCE_PROCESSING` PO，拒绝第二张非取消 PO；
4. 对供应商与产品按确定顺序重读；
5. 调用 canonical Writer 写表头、行、快照和审计；
6. 保存幂等结果后提交。

外部幂等 scope 固定为：

```text
(OUTSOURCING_PROCESSING_PO_CREATE, outsourcing_order_id, Idempotency-Key)
```

请求指纹包含全部允许的请求体字段，不包含 actor / tenant。同键异内容返回 409
`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`；精确重放复用原 PO ID/单号，不重写行、快照或审计。

SQLite 依赖外层写事务串行化；MySQL 对委外订单与已有来源 PO 使用
`SELECT ... FOR UPDATE` 或现有 adapter 等价锁。并发创建必须一方成功、另一方精确重放或合规 409，
不得产生两张活动 PO。

## 7. Error / Audit / Zero Side Effect

| 条件 | HTTP / Code | 拒绝审计 | 零副作用域 |
|---|---|---|---|
| 无 `OUTSOURCING_MANAGE` | 403 | 按全局 403 审计合同 | 不读业务来源，不泄露订单存在性 |
| 缺 Idempotency-Key / 字段非法 | 400 | 无业务拒绝审计 | PO 表头/行/快照/幂等记录为 0 |
| 委外订单不存在 | 404 | 恰好 1 条 | 同上 |
| 委外订单未下达 | 409 `OUTSOURCING_ORDER_NOT_RELEASED` | 恰好 1 条 | 同上 |
| 已有非取消加工费 PO | 409 `OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS` | 恰好 1 条 | 已有 PO 与全部下游逐字段不变 |
| 供应商/产品/数量/UOM 不可证 | 409 `OUTSOURCING_PROCESSING_PO_SOURCE_UNPROVEN` | 恰好 1 条 | PO 表头/行/快照/幂等结果为 0 |
| 幂等键异内容 | 409 `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` | 恰好 1 条 | 原 PO 与幂等结果不变 |
| 通用 PO API 尝试指定类型/来源 | 400 `PURCHASE_ORDER_BUSINESS_TYPE_NOT_CLIENT_SETTABLE` | 无业务拒绝审计 | 不创建任何 PO |

业务 404/409 拒绝审计的 `entity_type='OUTSOURCING_ORDER'`、`entity_id=<order id>`，
`detail` 只记动作与稳定错误码，不记录 Token、Secret 或请求原文。

## 8. Downstream Flow

```text
RELEASED 委外订单
  → 显式创建 OUTSOURCE_PROCESSING PO (DRAFT)
  → 采购人员补齐/修订允许的商业字段
  → 现有 PO SUBMIT
  → 现有 PO APPROVE
  → OUTSOURCE 完工通知 (DRAFT → CONFIRMED)
  → 委外待检收货表头 + 明细
  → IQC PASS / WAIVED
  → 收货生效（倒冲 + 成品入库）
```

加工费 PO 行只承担加工费来源追溯，不成为委外完工收货容量上界；
收货容量仍只由 Active Design §5.2.2 的委外订单剩余可收量决定。

## 9. Compatibility / Rollback

- **标准采购兼容**：通用 PO 路由、字段、状态机与权限保持不变；它仍只产生
  `STANDARD_PURCHASE`。
- **库存/会计隔离**：加工费 PO 草稿与审批本身不产生库存或会计效力；
  `M1C-WP-5` 的委外 AP/GL 拒绝边界不放宽。
- **Schema**：无新列/表/索引；SQLite / MySQL 使用同一 Writer 与业务合同。
- **行为回滚**：停用新委外 action route 即可停止新建；已创建的 DRAFT PO 保留为可追溯事实，
  不删除、不改写历史。

## 10. Tests / Gate Amendment

### 10.1 Focused tests

新增且登记到 `scripts/testing/test-suites.js` 的 FULL suite 必须使用正式 HTTP API，
不得以手写 SQL 制造正向 PO，至少覆盖：

1. `RELEASED` 委外订单显式创建一张 `DRAFT OUTSOURCE_PROCESSING` PO；
2. PO 表头的 supplier/source 与唯一行 product/quantity/UOM 正确；
3. 创建后不自动提交或审批，零库存/估值/GRNI/AP/GL 副作用；
4. 持有采购更新/提交权限的非创建人可按有界例外补齐并提交，审批仍由审批权限主体执行；
5. 委外订单未下达、无权、来源不可证、第二张活动 PO 均精确拒绝；
6. 精确幂等重放不重复写入，同键异内容 409；
7. 通用 `POST /api/purchase-orders` 携带业务类型/委外来源字段时 400；
8. 通用 PO 更新对来源锁定字段的篡改 409；
9. 并发双创建不产生两张活动 PO（MySQL 只在未来单独授权的 disposable Gate 执行）。

### 10.2 对 Active Design Gate 的增量

- `M1C-G02` 的 L1 前置路径改为：
  `委外订单 → 显式创建/提交/审批加工费 PO → OUTSOURCE 完工通知 → 待检收货明细 → IQC → 生效`。
- `M1C-G07` 的“全部 Core 业务对象经生产 API 造数”显式包括加工费 PO；
  测试私有 SQL 不得代替该通路。
- 新增 Core 并发场景：同一委外订单的加工费 PO 创建竞争；其证据并入
  `M1C-G07`，不新建第 8 个 Gate。

## 11. Promotion / Hard Stop

本 Amendment 通过审查后，才可将上述增量精确合并到
`docs/design/procurement-outsourcing-m1-core.md` 受影响章节，同时更新其修订记录、
`solution.md` / `docs/design/README.md` 导航状态与当日日志。

```text
M1C_PROCESSING_PO_DESIGN_AMENDMENT_PENDING_APPROVAL
```

**DESIGN HARD STOP**：本轮不修改实现代码、schema、migration 或测试；
现有 WP2–WP6 未提交工作树保留原状。需业务所有者明确批准本技术设计后，
才可提升为 Active Design 并恢复 WP2–WP6 Implementation。
