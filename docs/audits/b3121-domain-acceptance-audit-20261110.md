# B3121 委外管理 / 采购与委外域级验收 — 当前状态复核（2026-11-10；2026-11-11 更新）

> **用途 / Owner / 状态 / 权威关系**：本文件是 §31.16 `PRC-DLV-12` 要求的**域级逐项复核**证据，覆盖 PRC-01..26、VMI-01..05、OUT-01..23 共 54 项能力，以及 2026-11-07 静态审计台账的 14 条 Issue 的当前处置。Owner 为 Procurement & Outsourcing Domain Owner；状态为 `IMPLEMENTED`（已完成复核并按裁定实施；**域级 Acceptance 与 Capability Freeze 已于 2026-11-11 签发**，见 `docs/acceptance/procurement-outsourcing-domain-acceptance-20261111.md`）。它**不改写** `docs/audits/b3101-b3121-code-audit-20261107.md` 的历史结论——那份文件是 2026-11-07 的时点证据；本文件是当前状态。`docs/status/CAPABILITY_MATRIX.md` 仍是能力覆盖矩阵的权威登记表。
>
> **复核方法**：逐项定位 Requirement、Design、生产写入口（route + canonical owner）、可执行测试（文件 + 测试名）与明确延期。不凭文件存在宣称 `COVERED`：判 `COVERED` 需同时成立——有生产写入口、有服务端来源/状态/权限/事务约束、有可执行测试覆盖正例与至少一个反例。
>
> **2026-11-11 更新**：第四轮整改（Requirement §31.19 / Design §26.39）闭合了原 9 项 `PARTIAL` 与 1 项 `MISSING`；第五轮补齐（Requirement §31.20 / Design §26.40）落定维护面、界面可达性与三项裁定，并取得**真实 MySQL Gate PASS** 与域级 Acceptance / Capability Freeze 签发。本次更新逐行改写受影响条目的判定、实现与测试证据，并保留被取代的 2026-11-10 判定（见 §8 变更记录）。

## 1. 复核结论摘要

| 分组 | COVERED | PARTIAL | SEMANTIC_MISMATCH | MISSING | 已批准延期 / 移出范围（OUT_OF_SCOPE） |
|---|---|---|---|---|---|
| PRC-01..26（26 项） | 25 | 0 | 0 | 0 | 1（PRC-06 寻源决策写入口） |
| VMI-01..05（5 项） | 4 | 0 | 0 | 0 | 1（VMI-05 结算与物权释放） |
| OUT-01..23（23 项） | 21 | 0 | 0 | 0 | 1（OUT-22 成品退货） |
| **合计 54 项** | **50** | **0** | **0** | **0** | **3（PRC-06 / VMI-05 / OUT-22）** |

- 本轮把 `AUD-PRC-004/005/006/008`（P0/P1）从 `BLOCKED` / `NEEDS_REVALIDATION` 变为**已实施并有可执行证据**。
- `AUD-PRC-007`、`AUD-PRC-009`、`AUD-VMI-001/002/003` 六条按 §31.17 的受托裁定**实现闭合**；`AUD-PRC-002` 按裁定**关闭为登记事项**。
- `AUD-PRC-001`（寻源决策写入口）维持 §31.14.1 的已批准 SAFE_CLOSE；`AUD-OUT-001/002` 维持既有状态。
- **原 9 项 `PARTIAL`（PRC-02、PRC-04、PRC-12、PRC-16、OUT-02、OUT-03、OUT-20、OUT-21、OUT-23）与 1 项 `MISSING`（PRC-17）已在第四轮整改中实现闭合**，逐行依据见 §2～§4；被取代的旧判定见 §8。
- **仍有 3 项按已批准决定排除在本域范围外**：PRC-06（寻源决策写入口，`SAFE_CLOSE`）、VMI-05（结算与物权释放，`D-P01/D-P02`）、OUT-22（成品退货，正式延期决策 `MC-REQ-16`，见 §31.20.4）。这三项**不是**实现缺口，不得被描述为已覆盖。
- **原未闭合的实现前提已闭合**：`outsourcing_wip_identity_effects.event_type` 的 CHECK 因期初 WIP 增加 `'OPENING'` 而变化，G07 离线对等回放使用的真实 MySQL 目录条款捕获值随之失效；该值已于 2026-11-11 受保护 disposable MySQL 8.0.37 运行（run `b9023437-4030-46f2-b469-0a08396bd7f6`，commit `9a4ccbb`）中**重新观测捕获**并写回；该 Gate 本身 `state=FINISHED`、`testsPassed=true`、清理已证明（见 §7.2）。

## 2. PRC-01..26 逐项复核

| ID | 名称 | Requirement | Design | 实现（route / owner） | 测试（文件 · 用例） | 判定 | 缺口 |
|---|---|---|---|---|---|---|---|
| PRC-01 | Procurement Parameters | §31.3.1；§31.18.2 | §26.2；§26.37.6 | `GET/PATCH /api/procurement/parameters` → `procurement-parameters.js`；接线在 `procurement-policy.js`（货源/配额/请购策略/变更开关/退货策略/预付款默认/编号策略） | `procurement-parameters.test.js` · 三条；`procurement-commercial-evidence.test.js` · F1–F4 | COVERED | — |
| PRC-02 | Supplier Procurement Profile | §31.3.1；§31.19.2 | §26.3；§26.39.2 | `PATCH /api/suppliers/:id/profile` → `procurement-profiles.js`；付款天数与品类口径在 `procurement-policy.js::resolvePaymentTermsDays` / `assertSupplierCategoryAllows`，由 `procurement-orders.js::resolvePurchaseOrderPaymentTerms` / `resolvePurchaseOrderHeaderCommercial` 统一解析，创建与整体改写共用 | `procurement-profiles.test.js`；`procurement-commercial-evidence.test.js` · B2；`procurement-sourcing-capabilities.test.js` · PRC-02（两条） | COVERED | 付款天数按档案默认值驱动并冻结来源（`CLIENT` / `SUPPLIER_DEFAULT` / `NONE`），档案变更不改写历史订单；品类**单向**门禁委外业务，普通采购由采购资质门禁把关（§31.19.2） |
| PRC-03 | Buyer / Purchasing Group | §31.3.1；§31.18.3 | §26.3；§26.37.6 | `purchase_orders.buyer_id/purchasing_group_id` + `procurement-orders.js::resolvePurchaseOrderAssignment` | `buyers.test.js`；`procurement-commercial-evidence.test.js` · F5 | COVERED | — |
| PRC-04 | Source List | §31.3.1；§31.18.2；§31.19.1 | §26.4；§26.37.6；§26.39.3 | `procurement-sourcing.js`（`overrideSourceEntry`、`listSourceOverrides`）+ `procurement-policy.js::assertSourceControl` / `resolveEffectiveSource` | `procurement-sourcing-pricing.test.js` · 四条；`procurement-commercial-evidence.test.js` · F1；`procurement-sourcing-capabilities.test.js` · PRC-04（两条） | COVERED | 手工 override 已实现：管理权限 + 必填原因 + 有界区间 + 重叠拒绝（409 `SOURCE_OVERRIDE_OVERLAP`）+ 恰好一条审计；override 只在自身区间内放行，区间外仍然无货源；不改写货源主数据 |
| PRC-05 | Quota | §31.3.1；§31.18.2 | §26.4；§26.37.6 | `procurement-sourcing.js::allocateProportional` + `procurement-policy.js::assertPurchaseQuotaControl`（请购转采购订单的分配路径） | `procurement-sourcing-pricing.test.js` · 守恒用例 | COVERED | — |
| PRC-06 | Sourcing Decision | §31.3.1；§31.14.1 | §26.4 / §26.34.1 | `procurement-sourcing.js::resolveSourcingDecision` 稳定 409 | `procurement-sourcing-pricing.test.js` · 关闭写入口用例（16 表逐字段零变化 + 恰好一条拒绝审计） | OUT_OF_SCOPE | 已批准 SAFE_CLOSE；重开需业务所有者新授权 |
| PRC-07 | Purchase Price List | §31.3.1 | §26.5 / §26.36.2 | `procurement-pricing.js` + `resolvePurchaseLinePricing()` | `procurement-commercial-evidence.test.js` · A1–A4/B1–B5 | COVERED | — |
| PRC-08 | Pricing UOM | §31.3.1 | §26.5 / §26.36.2 | 同上（document→base→pricing 有理换算） | 同上 · A1/A2/B1 | COVERED | — |
| PRC-09 | Pricing Discount Table | §31.3.1；§31.18.3 | §26.5；§26.37.6 | `pricing_discount_schemes` 独立表 + 行级 `pricing_discount_scheme_id`/`discount_source` 冻结 | `procurement-commercial-evidence.test.js` · A3 | COVERED | — |
| PRC-10 | Price Adjustment | §31.3.1 | §26.5 | `adjustPriceList`（版本化 + 历史） | `procurement-commercial-evidence.test.js` · B5 | COVERED | — |
| PRC-11 | Requisition Sources | §31.3.1 | §26.6 | `purchase_requisition_items.purchase_instruction_item_id` 回链 | `uat-r4-purchase-source-chain.test.js` · A/C/D/J | COVERED | 残余：缺 `pr_conversion_log` 转换台账 |
| PRC-12 | PR Split / Merge / Supplier Allocation | §31.3.1；§31.19.1 | §26.6；§26.39.4 | `planning-documents.js::createPurchaseOrderGroups` + `recordPrConversionAllocations`（`pr_conversion_allocations` 事实表）；`procurement-orders.js::replacePurchaseOrderItemsCanonical` 保持分配事实的行指针 | `uat-r4-purchase-source-chain.test.js` · D/E–L；`procurement-sourcing-capabilities.test.js` · PRC-12（两条） | COVERED | canonical 分配事实（请购明细 → 采购订单明细 → 供应商 → 分配数量）与专用 `PR_CONVERSION` 审计已实现；累计分配量守恒（越界 409 `PR_CONVERSION_ALLOCATION_EXCEEDS_QUANTITY`）；带分配事实的行在草稿整体改写中**原位更新**，事实表不做 UPDATE，分配来源与分配数量被改写时 fail closed |
| PRC-13 | Purchase Order | §31.3.1 | §26.6 / §26.36.3 | `procurement-orders.js::createPurchaseOrderDraftCanonical` | `procurement-orders.test.js`；`buyers.test.js` | COVERED | — |
| PRC-14 | PO Commercial Snapshot | §31.3.1；§31.18.3 | §26.6；§26.37.6 | 快照列 + `pricing_evidence_json` + `buyer_id`/`purchasing_group_id` + `settlement_supplier_id`/`payee_supplier_id` + `GET /api/purchase-orders/:id/commercial-snapshot` | `procurement-commercial-evidence.test.js` · B1 / F5 | COVERED | — |
| PRC-15 | Gift / Free Item | §31.3.1 | §26.7 | `procurement-pricing.js` 零价赠品分支 | `buyers.test.js` · 两条；`procurement-commercial-evidence.test.js` · A4/B4 | COVERED | 赠品不再受价格表影响（有价格条目时仍零价） |
| PRC-16 | Delivery Schedule | §31.3.1；§31.18.3；§31.19.1 | §26.8；§26.37.6；§26.39.5 | `procurement-orders.js`（`evaluateDeliveryScheduleClose`、`closeDeliveryScheduleByLowerTolerance`、`closeDeliverySchedule`）+ `procurement-notice-capacity.js` + 交期账本 + `planned_date_from/to`、`sequence_no` | `m1c-wp1-procurement-notice-conversion.test.js` · A5/D3/D4；`procurement-commercial-evidence.test.js` · F6；`procurement-sourcing-capabilities.test.js` · PRC-16（两条） | COVERED | `lower_tolerance_pct` 自动关单已实现：判定只有一份函数，收货确认与显式关单共用；关单事实记录被容忍的短交数量；低于下容差 409 `PO_DELIVERY_SCHEDULE_NOT_CLOSEABLE` 且零副作用 |
| PRC-17 | Prepayment Requirement | §31.3.1；§31.19.6 | §26.9；§26.39.6 | `server/modules/procurement-prepayment.js`（`createProcurementPrepaymentRequirement`、`postProcurementPrepaymentRequirement`、`cancelProcurementPrepaymentRequirement`）；路由 `GET/POST /api/procurement/prepayment-requirements`、`GET .../:id`、`POST .../:id/post`、`POST .../:id/cancel` | `server/procurement-prepayment.test.js` · A1–A7 / B1–B6 / C1–C2（15 条） | COVERED | 整条能力已实现：金额由采购订单权威金额与有理比例推导（客户端金额只作断言）、状态机 `DRAFT → POSTED → CANCELLED` 单向、申请人不得自批、过账走 canonical 财务路径（`payment_disbursements` + `source_type='PREPAYMENT_REQUIREMENT'` 应付 + 付款凭证），**不建第二套支付引擎**；失败场景零副作用 |
| PRC-18 | PO Change | §31.3.1 | §26.10 / §26.36.4 | `procurement-orders.js` + `po_change_items` + `purchase_order_item_versions` | `procurement-commercial-evidence.test.js` · C1–C11 | COVERED | — |
| PRC-19 | PO Execution Status | §31.3.1 | §26.11 / §26.36.5 | `procurement-orders.js::getPurchaseOrderLineExecution` / `getPurchaseOrderExecution` | `m11-planning.test.js` · 23b；`procurement-commercial-evidence.test.js` · D1–D3 | COVERED | — |
| PRC-20 | Receipt Notice | §31.3.1 | §26.12 / M1-Core §5.1 | `procurement-receiving.js` + `procurement-notice-conversion.js` | `m1c-wp1-procurement-notice-conversion.test.js` · A/C/D | COVERED | — |
| PRC-21 | Incoming Inspection | §31.3.1 | §26.13 | `quality-gates.js` + `authoritative-quality.js` | `m1c-g07-sqlite-smoke.test.js` · CR-02；`m1c-wp1-r2-...test.js` · A–F | COVERED | — |
| PRC-22 | Purchase Receipt | §31.3.1 | §26.12 | `purchase-receipt-engine.js` + 类型门禁 | `m1c-wp1-...test.js` · C1/C3/C6/C7/D1 | COVERED | 加工费采购订单来源已 409 `PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE` 拒绝 |
| PRC-23 | Billing Mode Semantics | §31.3.1 | §26.14 | `purchase-receipt-engine.js` + 参数默认 | `procurement-parameters.test.js`；`procurement-return-execution.test.js` · 四分支 | COVERED | — |
| PRC-24 | Return Request | §31.3.1；§31.17；§31.18.2 | §26.14；§26.37.3 | `procurement-returns.js` + `purchase_return_request_items` + `purchase_returns.return_request_id` + `RETURN_REQUEST_REQUIRED` 退货策略 | `procurement-receiving-returns.test.js` · 退货申请闭环；`procurement-commercial-evidence.test.js` · F3 | COVERED | — |
| PRC-25 | Purchase Return | §31.3.1 | §26.14 | `app.js::confirmPurchaseReturn` + canonical 草稿写入器 | `procurement-return-execution.test.js` · 四分支 | COVERED | — |
| PRC-26 | Procurement Scan | §31.3.1；§31.18.1 | §26.15（**闭环部分移出本域范围**） | `procurement/scan`（`outsourcing-finance.js::procurementScan`）——**只做来源解析 + 类型隔离**，不创建收货草稿、不确认入库、LOT/SERIAL 不落库 | `outsourcing-finance.test.js` · PRC-26 | OUT_OF_SCOPE | **业务所有者裁定移出本域范围**（移动端扫码闭环需要视觉子系统）。受限来源解析端点保留且边界可见，不得被描述为“扫码入仓闭环” |

## 3. VMI-01..05 逐项复核

| ID | 名称 | Requirement | Design | 实现 | 测试 | 判定 | 缺口 |
|---|---|---|---|---|---|---|---|
| VMI-01 | VMI Policy / Agreement | §31.3.2；§31.17 裁定 1 | §26.16 / §26.34.6 / §26.37.1 | `procurement-vmi.js::createVmiAgreement`（采购侧资质 + 区间重叠检测） | `procurement-vmi.test.js` · VMI-01 | COVERED | — |
| VMI-02 | VMI Receiving | §31.3.2；裁定 2 | §26.34.6.2 / §26.37.1 | `procurement-vmi.js::createVmiReceipt` / `confirmVmiReceipt`（唯一有效协议 + `agreement_id` + 外部幂等键） | `procurement-vmi.test.js` · VMI-02 | COVERED | — |
| VMI-03 | VMI Consumption | §31.3.2；裁定 3 | §26.34.6.3 / §26.37.1 | `procurement-vmi.js::createVmiConsumption`（双不变量 + 外部幂等键） | `procurement-vmi.test.js` · VMI-03 | COVERED | — |
| VMI-04 | VMI Summary | §31.3.2；裁定 4 | §26.34.6.3 / §26.37.1 | `procurement-vmi.js::getVmiSummary`（毛余额 + 对账差额） | `procurement-vmi.test.js` · VMI-04 | COVERED | — |
| VMI-05 | VMI Ownership Transfer / Supplier Bill Handoff | §31.3.2；§31.13 `D-P01/D-P02` | §26.16 | `procurement-vmi.js::transferVmiOwnership` 无条件 409 `VMI_SETTLEMENT_POLICY_PENDING` + 拒绝审计 | `procurement-vmi.test.js` · VMI-05；`m1c-wp2-wp5-outsourcing.test.js` · WP5 | OUT_OF_SCOPE | 已批准延期；`vmi_ownership_transfers` 表保留但不激活、不回填 |

## 4. OUT-01..23 逐项复核

| ID | 名称 | Requirement | Design | 实现 | 测试 | 判定 | 缺口 |
|---|---|---|---|---|---|---|---|
| OUT-01 | 委外供应商 | §31.3.3 | §26.3 / §26.35.3 | `procurement-profiles.js` + 建单资质复核 | `outsourcing-workbench.test.js` · 业务日期资质用例 | COVERED | — |
| OUT-02 | 委外货源 | §31.3.3；§31.19.1 | §26.4；§26.39.7 | `procurement-policy.js::assertSourceControl`（`sourceType='OUTSOURCE'`，与采购**同一份实现**与同一个参数开关）+ `procurement-sourcing.js`（`source_type=OUTSOURCE` 货源条目） | `procurement-sourcing-capabilities.test.js` · OUT-02（三条：拒绝零副作用 / 正例创建 / 参数开关同样生效） | COVERED | 委外订单创建必须消费业务日期上有效的 OUTSOURCE 货源；无货源 409 `OUTSOURCE_SOURCE_REQUIRED` 且订单零副作用并写恰好一条拒绝审计；PURCHASE 货源不能替代 OUTSOURCE 货源；货源控制开关对委外同样生效 |
| OUT-03 | 加工价格 | §31.3.3；§31.19.1 | §26.18 / §26.36.3；§26.39.7 | `outsourcing.js::resolveOutsourcingProcessingPrice` + `assertProcessingPoPriceSource` + `createOutsourcingProcessingPurchaseOrder`（冻结商业金额与证据） | `m1c-processing-po.test.js` · 整组；`server/out-03-out-23.test.js` · OUT-03（五条） | COVERED | 价格来源可读出：有效 OUTSOURCE 价格条目优先（冻结 `price_entry_id` / `price_version` / 证据），否则冻结为**委外合同**来源（`price_entry_id` 保持 NULL，证据含来源、委外订单号、金额与业务日期）；客户端单价不一致固定 409 `OUTSOURCING_PROCESSING_PRICE_ASSERTION_MISMATCH` 且零副作用；普通 PURCHASE 价格表不得静默替换委外价格来源 |
| OUT-04 | 供应商 WIP 仓 | §31.3.3 | §26.19 | `procurement-profiles.js` + `outsourcing-inventory.js` | `m1c-wp7a-gate-acceptance.test.js` · G03-3/G03-M5 | COVERED | — |
| OUT-05 | 计划交接 | §31.3.3 | §26.17 | `outsourcing.js::consumePlanningHandoff` | `out-final-acceptance.test.js` · OUT-05 A–I | COVERED | — |
| OUT-06 | 委外订单 | §31.3.3 | §26.17 | `outsourcing.js::createOutsourcingOrder` | `outsourcing.test.js`；`outsourcing-workbench.test.js` | COVERED | — |
| OUT-07 | 委外生命周期 | §31.3.3 | §26.17 / §26.35.5 | `outsourcing.js::transitionOutsourcingOrder` | `outsourcing-workbench.test.js` · 动作/状态/完工/关闭门禁 | COVERED | — |
| OUT-08 | 委外 BOM | §31.3.3；裁定 10 | §26.17 / §26.37.2 | `outsourcing.js::resolveOutsourcingBasisBom`（canonical 解析器 + 订单绑定校验） | `m1c-wp2-wp5-outsourcing.test.js` · WP4 | COVERED | — |
| OUT-09 | 用料清单 | §31.3.3 | §26.19 / §26.35 | `outsourcing.js::snapshotMaterialList` | `outsourcing-workbench.test.js` · 快照时序 | COVERED | — |
| OUT-10 | 加工费 PO | §31.3.3 | §26.18 / §26.36.3 | `outsourcing.js::createOutsourcingProcessingPurchaseOrder` | `m1c-processing-po.test.js` · 幂等/并发 | COVERED | — |
| OUT-11 | 委外发料 | §31.3.3 | §26.19 | `outsourcing.js::issueMaterial` → `outsourcing-inventory.js` | `m1c-wp2-wp5-outsourcing.test.js` · WP3 | COVERED | — |
| OUT-12 | 委外补料 | §31.3.3 | §26.19 | `outsourcing.js::supplementMaterial` | 同上 + `m1c-wp7a-g03-idempotency-conflict.test.js` · G03-C2 | COVERED | — |
| OUT-13 | 委外退料 | §31.3.3 | §26.19 / §26.35.5 | `outsourcing.js::returnMaterial` | `outsourcing.test.js`；`outsourcing-workbench.test.js` · 关闭后拒绝 | COVERED | — |
| OUT-14 | 材料所有权 | §31.3.3 | §26.19 | `outsourcing_material_list` + 位置读模型 | `outsourcing.test.js`；G03-M5 | COVERED | — |
| OUT-15 | 委外材料 LOT/SERIAL | §31.3.3 | §26.19 | `outsourcing-inventory.js::resolveOutsourcingIdentity` | `m1c-wp7a-gate-acceptance.test.js` · G03-1/G03-2 | COVERED | — |
| OUT-16 | 增量倒冲 | §31.3.3 | §26.19 | `outsourcing.js::backflushMaterial` | `outsourcing.test.js`；G04-1 | COVERED | 损耗率/单位换算按 `M1-P-02` fail closed |
| OUT-17 | 委外完工通知 | §31.3.3 | §26.20 / §26.35.4 | `procurement-receiving.js`（OUTSOURCE 来源级授权） | `out-final-acceptance.test.js` · OUT-17 | COVERED | — |
| OUT-18 | 委外检验 | §31.3.3 | §26.20 | `quality-gates.js` + `authoritative-quality.js` | `out-final-acceptance.test.js` · OUT-18 | COVERED | — |
| OUT-19 | 委外收货入库 | §31.3.3 | §26.20 | `outsourcing.js::createOutsourcingReceipt` + `outsourcing-finance.js::confirmOutsourcingReceipt` | `m1c-wp2-wp5-outsourcing.test.js` · WP2 | COVERED | — |
| OUT-20 | 加工费应付 | §31.3.3；§31.13 `MC-REQ-15`；§31.19.3 | §26.20 / §26.36；§26.39.8 | `outsourcing-finance.js::postProcessingFeeBill` / `reverseProcessingFeeBill` / `createProcessingFeeBill` + `outsourcing-gl-policy.js`（`resolveProcessingFeeAccountingProfile` + 来源级 Guard）；路由 `POST /api/procurement/outsourcing/processing-fee-bills/:id/post`、`:id/reverse` | `outsourcing-finance.test.js` · OUT-20 / C-P01 / C-P03 / C-P04（十一条）；`m1c-outsourcing-gl-policy-guard.test.js` · R1-A | COVERED | 正式过账已实现并按 `C-P01`～`C-P04` 固化：金额在收货生效时确认、过账执行金额上界（超开票 409）；科目只能来自已批准会计档案（缺档案 409 `OUTSOURCING_GL_PROFILE_NOT_APPROVED` 且零副作用）；红冲数量守恒且金额反向；共享入口继续拒绝委外来源账单、普通采购不误伤。**披露限制**：会计档案当前只有迁移预置的全局默认档案，没有维护端点（见 §7.3） |
| OUT-21 | 委外成本证据 | §31.3.3；§31.19.4 | §26.20；§26.39.8 | `outsourcing_cost_evidences`（倒冲材料价值 + 基准金额 + 实际金额 + 差异）+ `outsourcing-finance.js::refreshOutsourcingCostEvidence` | `outsourcing-finance.test.js` · OUT-21（过账后转 FINAL、actual 取 canonical 账单实际金额）；G04-R1-2 | COVERED | 基准金额取收货生效时确认的加工费金额且永不被账单改写；实际金额取 canonical 账单金额；差异 = 实际 − 基准；`basis_status` 在应付数量被完整开票后转 `FINAL`，已红冲行从实际口径中扣除 |
| OUT-22 | 成品退货 | §31.3.3；§31.15.1 范围排除 | §26.20 | `outsourcing-finance.js::createFinishedReturn` 无条件 409 `OUTSOURCING_FINISHED_RETURN_NOT_APPROVED` + 拒绝审计 | `outsourcing-finance.test.js` · OUT-22 | OUT_OF_SCOPE | 已批准范围排除（拒绝稳定、零副作用）；缺口：**无正式延期决策 ID**（不在 `MC-REQ-15` 系列内），需业务所有者补登或纳入实现范围 |
| OUT-23 | 期末/WIP/期初/报表 | §31.3.3；§31.13 `B-P01`/`B-P02`；§31.19.5 | §26.20 / §26.34.4；§26.39.9 | `procurement-reports.js` + `outsourcing-finance.js::createWipTransfer` + `outsourcing.js::createOpeningOutsourcingOrderCanonical`（路由 `POST /api/procurement/outsourcing/opening-orders`）+ `inventory-period-close.js`（`OUTSOURCING_SUPPLY_CONSISTENCY`）+ `finance-business-close.js`（`outsourcingExposure`） | `outsourcing-finance.test.js` · OUT-23；`outsourcing-wip-transfer.test.js`；`server/out-03-out-23.test.js` · OUT-23（十条） | COVERED | 期初委外订单可带物料行、身份与供应商 WIP 位置；期初结余进入**同一本** WIP 身份账（`event_type='OPENING'`）且落在供应商 WIP 位置；期初不产生凭证与应付；委外供给进入既有期间关闭读模型与财务业务关闭读模型且不新增关闭轴。**保留边界**：`B-P01`（跨单成本携带）与 `B-P02`（差异生效）仍按既有延期 |

## 5. 2026-11-07 审计台账 14 条 Issue 的当前处置

| Issue | 原状态 | 当前状态 | 处置与证据 |
|---|---|---|---|
| AUD-PRC-001 | ACCEPTED | ACCEPTED（有界残余） | §31.14.1 已批准 SAFE_CLOSE 维持：写入口稳定 409、零业务副作用、恰好一条拒绝审计 |
| AUD-PRC-002 | BLOCKED | **CLOSED_AS_REGISTERED** | 写入口已按 §31.14.1 关闭，仓库无活动写入路径，伪哈希不可达；重开前必须先实现真 SHA-256（§31.17 裁定 5） |
| AUD-PRC-003 | TESTED | TESTED | 资格按 `sourceType` 与 `businessDate` 校验维持 |
| AUD-PRC-004 | NEEDS_REVALIDATION | **IMPLEMENTED** | `resolvePurchaseLinePricing()` 唯一取价原语；24 EA=2 BOX、分数、半分边界、折扣、历史不重算均有可执行证据（`procurement-commercial-evidence.test.js` A1–A4/B1–B5） |
| AUD-PRC-005 | BLOCKED | **IMPLEMENTED** | PO Change 服务端 before/requested 快照、金额重算、版本 CAS、幂等、SOD、行级与整单取消边界（C1–C11） |
| AUD-PRC-006 | BLOCKED | **IMPLEMENTED** | canonical 逐行执行模型被 MRP/工作台/预留/收货共同消费；加工费 PO 排除 BUY supply（D1–D3、m11-planning 23b） |
| AUD-PRC-007 | BLOCKED | **IMPLEMENTED** | 退货申请明细 + 业务字段 + DRAFT→CONVERTED/REJECTED + 正式转换与回链（`procurement-receiving-returns.test.js`） |
| AUD-PRC-008 | NEEDS_REVALIDATION | **IMPLEMENTED** | 行级/整单取消范围区分、执行事实门禁（收货/通知/预留/交期）、幂等（C4/C5/C9） |
| AUD-PRC-009 | BLOCKED | **IMPLEMENTED** | 及时率 = 承诺交期前已确认收货数量 ÷ 订单数量；完成比单独以 `fulfilmentRate` 暴露（`procurement-commercial-evidence.test.js` E1） |
| AUD-VMI-001 | BLOCKED | **IMPLEMENTED** | VMI 资格基准改为采购侧资质 + 协议唯一性 + 区间重叠检测（VMI-01） |
| AUD-VMI-002 | BLOCKED | **IMPLEMENTED** | 收货绑定唯一有效协议 + 外部幂等键 + 历史 NULL fail closed（VMI-02） |
| AUD-VMI-003 | NEEDS_REVALIDATION | **IMPLEMENTED** | 消耗外部幂等键 + 双不变量容量（VMI-03） |
| AUD-OUT-001 | TESTED | TESTED（未验收） | `OUT_001_MYSQL_CHILD_TIMEOUT` 等真实 MySQL 证据见 `docs/acceptance/out001-real-mysql-acceptance-20261109.md`；本轮未重跑 |
| AUD-OUT-002 | TESTED | TESTED | 报表仅 `EFFECTED` 计正式指标 |

## 6. 业务所有者裁定登记（2026-11-11 已闭合）

| # | 事项 | 裁定结果 |
|---|---|---|
| 1 | 真实 MySQL Gate 的执行授权（ACK-4 清单与 RunId） | **已签发并执行**：run `b9023437-4030-46f2-b469-0a08396bd7f6`（commit `9a4ccbb`）→ `state=FINISHED`、`testsPassed=true`、`cleanupProven=true` |
| 2 | G07 固定场景重新冻结的显式确认 | **已确认**：摘要 `f112c88cb6d327f4885cf349de4a6c4efd6b4a1499e0547727e7103ccad33f`（摘要链 `60f7888f…` → `aa024bd5…` → `f112c88c…`） |
| 3 | `outsourcing_wip_identity_effects` CHECK 变化后的真实 MySQL 目录条款重新捕获 | **已重新观测捕获**并写回；离线回放恢复通过（55/55），断言未被削弱、检查器未被修改（见 §7.2） |
| 4 | OUT-22 正式延期决策 ID | **已补登**：`MC-REQ-16`（Requirement §31.20.4）；既有稳定拒绝边界与回归不变 |
| 5 | M1-Core G06 断言被 §31.19 取代后的重新确认 | **随域级 Acceptance 重新确认**（Requirement §31.20.3；Acceptance 记录 §3） |
| 6 | 供应商品类的单向门禁口径 | **确认为域级合同**：品类只门禁委外业务，普通采购由采购资质门禁把关（§31.19.2 / §31.20.3） |
| 7 | 委外加工费会计档案的维护入口 | **已实现产品内维护面**：列出 / 建立 / 暂停 / 重新批准（Requirement §31.20.1 / Design §26.40.1） |

## 7. 本轮披露的限制与边界

### 7.1 已被取代的判定（保留历史，不改写）

2026-11-10 的复核判定中，PRC-02 / PRC-04 / PRC-12 / PRC-16 / PRC-17 / OUT-02 / OUT-03 / OUT-20 / OUT-21 / OUT-23 的 `PARTIAL` / `MISSING` 结论已被 §31.19 / §26.39 的实现取代。取代关系见 §2～§4 逐行「实现」与「测试」列；本文件不删除历史结论的引用位置，`docs/status/PROJECT_STATUS.md` §37～§48 与 `log/2026-11-10.md` 仍保留当时的判定与证据。

### 7.2 G07 对等回放：目录条款已按真实 MySQL 观测重新捕获

期初 WIP 使 `outsourcing_wip_identity_effects.event_type` 的 CHECK 增加 `'OPENING'`（SQLite 重建表、MySQL `MODIFY COLUMN`）。G07 离线基础设施套件的 `R4` 对等回放把该表与**真实 MySQL 目录捕获条款**逐条比对；捕获值来自 2026-11-07 的真实 MySQL 8 运行，因此一度失效。

**闭合事实（2026-11-11）**：

| 项 | 值 |
|---|---|
| 真实 MySQL Gate | run `b9023437-4030-46f2-b469-0a08396bd7f6`，commit `9a4ccbb`，目标 `modern_erp_domain_test` @ `127.0.0.1:3306`（MySQL 8.0.37，server uuid `256c7a4e-d275-11f1-885b-b025aa71d167`） |
| 结果 | `state=FINISHED`、`testsPassed=true`、`cleanupProven=true`、`childrenExited=true`；schema parity 与 CR-01..CR-09 全部通过 |
| 目录条款观测 | 受保护 disposable MySQL 上对 `information_schema.CHECK_CONSTRAINTS` 的**只读**观测（随 Gate 运行窗口进行）；证据见 [`docs/evidence/procurement-outsourcing-domain-acceptance-20261111/`](../evidence/procurement-outsourcing-domain-acceptance-20261111/g07-outsourcing-wip-identity-effects-catalogue-capture.json) |
| 捕获值 | ``(`event_type` in (_utf8mb4\'ISSUE\',…,_utf8mb4\'TRANSFER_OUT\',_utf8mb4\'OPENING\'))`` |
| 离线回放 | 恢复通过（`m1-core-g07-infrastructure.test.js` + `m1c-g07-sqlite-smoke.test.js` 合计 **55/55 PASS**） |

该断言**没有**被削弱，**没有**被改写，检查器**未**被修改。

### 7.3 委外加工费会计档案的维护面（已闭合）

第五轮实现了产品内维护面（Requirement §31.20.1 / Design §26.40.1）：`GET/POST /api/procurement/outsourcing/processing-fee-accounting-profiles` 与 `POST …/:id/approval`。维护面只做「列出 / 建立 / 改变批准状态」三件事，不改写既有档案的科目、税率与有效期；建立时校验角色码必须解析到**启用**科目（否则 409 `OUTSOURCING_GL_PROFILE_ROLE_UNRESOLVED`），同范围窗口重叠被拒（409 `OUTSOURCING_GL_PROFILE_OVERLAP`），重新批准前重读权威科目。维护权限属财务侧过账权限，委外业务侧不得定义科目。证据：`server/outsourcing-gl-profile-maintenance.test.js`（6 条）与浏览器 UAT-35。

**保留限制**：档案引用的角色码必须已存在于启用科目；档案不是业务单据，不得被用来绕过科目治理。

### 7.4 界面可达性（已闭合）

第四轮新增的**子能力**（预付款要求、货源 override、交货计划关单、加工费过账与红冲、期初委外）原先只有 API 层。第五轮补齐了对应工作面（Requirement §31.20.2 / Design §26.40.2）：

| 子能力 | 工作面 |
|---|---|
| PRC-17 预付款要求 | 采购订单详情「预付款要求」 |
| PRC-04 货源 override | 寻源与定价「货源 override」 |
| PRC-16 交货计划关单 | 采购订单详情「交货计划」 |
| OUT-20 加工费过账与红冲 | 委外加工「加工费账单」 |
| OUT-23 期初委外订单 | 委外加工「新建期初委外订单」 |
| OUT-20 会计档案维护 | 委外加工「加工费会计档案」 |

浏览器 UAT `scripts/acceptance/procurement-outsourcing-functional-uat.mjs` 扩展到 **36/36 PASS**（新增 UAT-30..UAT-36），其中 UAT-36 在 390 CSS px 下断言三个工作面**实际渲染**新增面板且无整页横向滚动。前端不计算权威金额、不放宽权限。

### 7.5 未发生事项

本复核不执行真实环境 migration、不写业务数据库、不运行 MySQL Gate、不 push/merge/tag/发布/部署、不改动 `docs/audits/b3101-b3121-code-audit-20261107.md` 的历史结论、不把未实现的范围排除项宣称为 `COVERED`。

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-10 | 首次域级逐项复核：54 项中 40 项 `COVERED`、9 项 `PARTIAL`、1 项 `MISSING`（PRC-17）、4 项已批准延期或移出范围。 |
| 2026-11-11 | 第四轮整改后复核：54 项中 **50 项 `COVERED`**、0 项 `PARTIAL`、0 项 `MISSING`；3 项按已批准决定排除在本域范围外（PRC-06 / VMI-05 / OUT-22）。10 项原残余的逐行依据见 §2～§4；新披露的限制见 §7。 |
| 2026-11-11（第五轮） | 会计档案维护面与第四轮新增子能力的界面可达性闭合（§7.3、§7.4）；业务所有者七项裁定全部落定（§6）；真实 MySQL Gate PASS 且目录条款按实测重新捕获（§7.2）；**域级 Acceptance 与 Capability Freeze 已签发**（`docs/acceptance/procurement-outsourcing-domain-acceptance-20261111.md`）。本文件的判定结论自此与该签发记录一致。 |
