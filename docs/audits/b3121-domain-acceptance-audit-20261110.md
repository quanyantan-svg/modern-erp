# B3121 委外管理 / 采购与委外域级验收 — 当前状态复核（2026-11-10）

> **用途 / Owner / 状态 / 权威关系**：本文件是 §31.16 `PRC-DLV-12` 要求的**域级逐项复核**证据，覆盖 PRC-01..26、VMI-01..05、OUT-01..23 共 54 项能力，以及 2026-11-07 静态审计台账的 14 条 Issue 的当前处置。Owner 为 Procurement & Outsourcing Domain Owner；状态为 `IMPLEMENTED`（已完成复核并按裁定实施，**尚未通过域级 Acceptance**）。它**不改写** `docs/audits/b3101-b3121-code-audit-20261107.md` 的历史结论——那份文件是 2026-11-07 的时点证据；本文件是当前状态。`docs/status/CAPABILITY_MATRIX.md` 仍是能力覆盖矩阵的权威登记表。
>
> **复核方法**：逐项定位 Requirement、Design、生产写入口（route + canonical owner）、可执行测试（文件 + 测试名）与明确延期。不凭文件存在宣称 `COVERED`：判 `COVERED` 需同时成立——有生产写入口、有服务端来源/状态/权限/事务约束、有可执行测试覆盖正例与至少一个反例。

## 1. 复核结论摘要

| 分组 | COVERED | PARTIAL | SEMANTIC_MISMATCH | MISSING | 已批准延期（OUT_OF_SCOPE） |
|---|---|---|---|---|---|
| PRC-01..26（26 项） | 14 | 12 | 0 | 0 | 1（PRC-06 寻源决策写入口） |
| VMI-01..05（5 项） | 1 | 0 | 0 | 0 | 4（VMI-01..04 已闭合，VMI-05 延期） |
| OUT-01..23（23 项） | 16 | 5 | 0 | 0 | 2（OUT-20 正式过账、OUT-22 成品退货） |
| **合计 54 项** | **31** | **17** | **0** | **0** | **（已含在上述分组内）** |

- 本轮把 `AUD-PRC-004/005/006/008`（P0/P1）从 `BLOCKED` / `NEEDS_REVALIDATION` 变为**已实施并有可执行证据**。
- `AUD-PRC-007`、`AUD-PRC-009`、`AUD-VMI-001/002/003` 六条按 §31.17 的受托裁定**实现闭合**；`AUD-PRC-002` 按裁定**关闭为登记事项**。
- `AUD-PRC-001`（寻源决策写入口）维持 §31.14.1 的已批准 SAFE_CLOSE；`AUD-OUT-001/002` 维持既有状态。
- 仍有 17 项为 `PARTIAL`：它们的缺口是**真实且已登记**的，不得被文件存在或子包 PASS 冒充为已覆盖；它们是 Capability Freeze 的残余项。

## 2. PRC-01..26 逐项复核

| ID | 名称 | Requirement | Design | 实现（route / owner） | 测试（文件 · 用例） | 判定 | 缺口 |
|---|---|---|---|---|---|---|---|
| PRC-01 | Procurement Parameters | §31.3.1 | §26.2 | `GET/PATCH /api/procurement/parameters` → `procurement-parameters.js` | `procurement-parameters.test.js` · 三条 | PARTIAL | 8 个开关（source/quota/po_change/receiving_tolerance/return/requisition/numbering/prepayment 默认）**无生产消费方**；仅 `default_receipt_billing_mode` 被收货路径使用 |
| PRC-02 | Supplier Procurement Profile | §31.3.1 | §26.3 | `PATCH /api/suppliers/:id/profile` → `procurement-profiles.js`；建单门禁在 `procurement-orders.js::createPurchaseOrderDraftCanonical` | `procurement-profiles.test.js`；`procurement-commercial-evidence.test.js` · B2（无价格 fail closed） | PARTIAL | 采购资质**已**在建单处 fail closed（`PURCHASE_SUPPLIER_NOT_QUALIFIED`）；剩余缺口：品类（category）与付款结算默认值未驱动单据 |
| PRC-03 | Buyer / Purchasing Group | §31.3.1 | §26.3 | `purchase_orders.buyer_id/purchasing_group_id` + `procurement-orders.js::resolvePurchaseOrderAssignment` | `buyers.test.js`；矩阵复核（本轮新增落位与校验） | PARTIAL | 落位与显式校验已实现；缺口：无采购组归属的采购员**不阻断**建单（只留空），且无跨域归属报表 |
| PRC-04 | Source List | §31.3.1 | §26.4 | `procurement-sourcing.js` | `procurement-sourcing-pricing.test.js` · 四条 | PARTIAL | 货源主数据与资格/生效期已闭合；缺口：`source_control_enabled` 未接入请购/建单路径；override 路由不存在 |
| PRC-05 | Quota | §31.3.1 | §26.4 | `procurement-sourcing.js::allocateProportional` | `procurement-sourcing-pricing.test.js` · 守恒用例 | PARTIAL | 分配器无生产调用方（寻源写入口已关闭）；缺口：配额不参与任何单据生成 |
| PRC-06 | Sourcing Decision | §31.3.1；§31.14.1 | §26.4 / §26.34.1 | `procurement-sourcing.js::resolveSourcingDecision` 稳定 409 | `procurement-sourcing-pricing.test.js` · 关闭写入口用例（16 表逐字段零变化 + 恰好一条拒绝审计） | OUT_OF_SCOPE | 已批准 SAFE_CLOSE；重开需业务所有者新授权 |
| PRC-07 | Purchase Price List | §31.3.1 | §26.5 / §26.36.2 | `procurement-pricing.js` + `resolvePurchaseLinePricing()` | `procurement-commercial-evidence.test.js` · A1–A4/B1–B5 | COVERED | — |
| PRC-08 | Pricing UOM | §31.3.1 | §26.5 / §26.36.2 | 同上（document→base→pricing 有理换算） | 同上 · A1/A2/B1 | COVERED | — |
| PRC-09 | Pricing Discount Table | §31.3.1 | §26.5 | `pricing_discount_schemes` 独立表 + 取价证据 | `procurement-commercial-evidence.test.js` · A3 | PARTIAL | 折扣不进 AP 已由表分离保证；缺口：缺「不得写 `purchase_discounts`/不得创建 AP 信用」的零副作用断言；PO 行缺 `pricing_discount_scheme_id`/`discount_source` 独立列（只在证据 JSON 内） |
| PRC-10 | Price Adjustment | §31.3.1 | §26.5 | `adjustPriceList`（版本化 + 历史） | `procurement-commercial-evidence.test.js` · B5 | COVERED | — |
| PRC-11 | Requisition Sources | §31.3.1 | §26.6 | `purchase_requisition_items.purchase_instruction_item_id` 回链 | `uat-r4-purchase-source-chain.test.js` · A/C/D/J | COVERED | 残余：缺 `pr_conversion_log` 转换台账 |
| PRC-12 | PR Split / Merge / Supplier Allocation | §31.3.1 | §26.6 | `planning-documents.js::createPurchaseOrderGroups` | `uat-r4-purchase-source-chain.test.js` · D/E–L | PARTIAL | 分组、部分数量转换、余量保护与源行写锁已闭合；缺口：缺 canonical split/merge 规划事实与专用审计 |
| PRC-13 | Purchase Order | §31.3.1 | §26.6 / §26.36.3 | `procurement-orders.js::createPurchaseOrderDraftCanonical` | `procurement-orders.test.js`；`buyers.test.js` | COVERED | — |
| PRC-14 | PO Commercial Snapshot | §31.3.1 | §26.6 / §26.36.3 | 快照列 + `pricing_evidence_json` + `buyer_id`/`purchasing_group_id` | `procurement-commercial-evidence.test.js` · B1 | PARTIAL | 价格证据、供应商/联系人/付款条件/买方与采购组已冻结；缺口：缺 `settlement_supplier_id`/`payee_supplier_id`/`price_source`/`discount_source` 独立列与 `/commercial-snapshot` 读取端点 |
| PRC-15 | Gift / Free Item | §31.3.1 | §26.7 | `procurement-pricing.js` 零价赠品分支 | `buyers.test.js` · 两条；`procurement-commercial-evidence.test.js` · A4/B4 | COVERED | 赠品不再受价格表影响（有价格条目时仍零价） |
| PRC-16 | Delivery Schedule | §31.3.1 | §26.8 / M1-Core §5.2 | `procurement-orders.js` + `procurement-notice-capacity.js` + 交期账本 | `m1c-wp1-procurement-notice-conversion.test.js` · A5/D3/D4 | PARTIAL | 多批次交期与容差上限已生效；缺口：无交期区间（only `planned_date`）、`lower_tolerance_pct` 自动关单按 §26.8 `SOURCE_DETAIL_INSUFFICIENT` 延期、`receiving_tolerance_policy` 无消费方 |
| PRC-17 | Prepayment Requirement | §31.3.1 | §26.9 | 无生产写入口 | 无 | MISSING | 整条能力缺失（文档 + 明细 + 计划 + 状态机 + Finance handoff）。§31.3.1 判 NEW、§31.16 未纳入延期 |
| PRC-18 | PO Change | §31.3.1 | §26.10 / §26.36.4 | `procurement-orders.js` + `po_change_items` + `purchase_order_item_versions` | `procurement-commercial-evidence.test.js` · C1–C11 | COVERED | — |
| PRC-19 | PO Execution Status | §31.3.1 | §26.11 / §26.36.5 | `procurement-orders.js::getPurchaseOrderLineExecution` / `getPurchaseOrderExecution` | `m11-planning.test.js` · 23b；`procurement-commercial-evidence.test.js` · D1–D3 | COVERED | — |
| PRC-20 | Receipt Notice | §31.3.1 | §26.12 / M1-Core §5.1 | `procurement-receiving.js` + `procurement-notice-conversion.js` | `m1c-wp1-procurement-notice-conversion.test.js` · A/C/D | COVERED | — |
| PRC-21 | Incoming Inspection | §31.3.1 | §26.13 | `quality-gates.js` + `authoritative-quality.js` | `m1c-g07-sqlite-smoke.test.js` · CR-02；`m1c-wp1-r2-...test.js` · A–F | COVERED | — |
| PRC-22 | Purchase Receipt | §31.3.1 | §26.12 | `purchase-receipt-engine.js` + 类型门禁 | `m1c-wp1-...test.js` · C1/C3/C6/C7/D1 | COVERED | 加工费采购订单来源已 409 `PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE` 拒绝 |
| PRC-23 | Billing Mode Semantics | §31.3.1 | §26.14 | `purchase-receipt-engine.js` + 参数默认 | `procurement-parameters.test.js`；`procurement-return-execution.test.js` · 四分支 | COVERED | — |
| PRC-24 | Return Request | §31.3.1；§31.17 | §26.14 / §26.37.3 | `procurement-returns.js` + `purchase_return_request_items` + `purchase_returns.return_request_id` | `procurement-receiving-returns.test.js` · 退货申请闭环 | PARTIAL | 明细、业务字段、DRAFT→CONVERTED/REJECTED 与正式转换已闭合；缺口：缺审批岗分权（当前转换只要求 `RETURN_REQUEST_MANAGE`）与退料方式驱动的补货动作 |
| PRC-25 | Purchase Return | §31.3.1 | §26.14 | `app.js::confirmPurchaseReturn` + canonical 草稿写入器 | `procurement-return-execution.test.js` · 四分支 | COVERED | — |
| PRC-26 | Procurement Scan | §31.3.1 | §26.15 | `procurement/scan`（`outsourcing-finance.js::procurementScan`） | `outsourcing-finance.test.js` · PRC-26 | PARTIAL | 只实现「来源解析 + 类型隔离」；缺口：Design §26.15 的 `lookup-document`/`draft-receipt`/`draft-notice` 三个 API 与「扫描→收货草稿→确认」闭环未实现 |

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
| OUT-02 | 委外货源 | §31.3.3 | §26.4 | `procurement-sourcing.js`（`source_type=OUTSOURCE`） | 无 OUTSOURCE 货源正例 HTTP 用例 | PARTIAL | 缺可执行正反例；委外订单未消费货源 |
| OUT-03 | 加工价格 | §31.3.3 | §26.18 / §26.36.3 | `outsourcing.js::createOutsourcingProcessingPurchaseOrder`（冻结商业金额） | `m1c-processing-po.test.js` · 整组 | PARTIAL | 加工费 PO 的 `price_entry_id`/证据为 null；缺「已批准委外合同/加工价」实体 |
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
| OUT-20 | 加工费应付 | §31.3.3；§31.13 `MC-REQ-15`/`C-P01..C-P04` | §26.20 / §26.36 | `outsourcing-finance.js::createProcessingFeeBill`（DRAFT）+ `outsourcing-gl-policy.js` 来源级 Guard | `outsourcing-finance.test.js` · OUT-20；`m1c-outsourcing-gl-policy-guard.test.js` · R1-A | PARTIAL | 正式 AP/GL 过账按已批准延期 409（零 AP/凭证/成本刷新、拒绝审计恰好一条、普通采购不误伤）；残余：`C-P01` 金额确认时点、`C-P02` 科目/税、`C-P03` 红冲、`C-P04` 跨域边界仍未裁定 |
| OUT-21 | 委外成本证据 | §31.3.3 | §26.20 | `outsourcing_cost_evidences`（倒冲材料价值 + 暂估加工费） | `outsourcing-finance.test.js` · OUT-19；G04-R1-2 | PARTIAL | 主体已实现；缺口：`basis_status` 停在 PROVISIONAL（依赖 OUT-20 正式过账的裁定），无 POSTED 后 actual/variance 证据 |
| OUT-22 | 成品退货 | §31.3.3；§31.15.1 范围排除 | §26.20 | `outsourcing-finance.js::createFinishedReturn` 无条件 409 `OUTSOURCING_FINISHED_RETURN_NOT_APPROVED` + 拒绝审计 | `outsourcing-finance.test.js` · OUT-22 | OUT_OF_SCOPE | 已批准范围排除（拒绝稳定、零副作用）；缺口：**无正式延期决策 ID**（不在 `MC-REQ-15` 系列内），需业务所有者补登或纳入实现范围 |
| OUT-23 | 期末/WIP/期初/报表 | §31.3.3；§31.13 `B-P01`/`B-P02` | §26.20 / §26.34.4 | `procurement-reports.js` + `outsourcing-finance.js::createOpeningOutsourcingOrder` / `createWipTransfer` | `outsourcing-finance.test.js` · OUT-23；`outsourcing-wip-transfer.test.js` | PARTIAL | 执行/材料报表与有界 WIP 数量转移已实现；缺口：无**期初委外 WIP**（期初只写订单，无物料行/身份余额）、无委外来源的期间关闭接入；差异生效 `B-P02` 与跨单成本携带 `B-P01` 仍延期 |

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

## 6. 仍未闭合、必须由业务所有者裁定的事项

| # | 事项 | 为什么 Agent 不能自行决定 |
|---|---|---|
| 1 | PRC-17 预付款要求（整条 MISSING） | 需要新的业务单据与 Finance handoff 合同（§31.3.1 判 NEW，无延期依据） |
| 2 | PRC-26 扫码闭环（Design §26.15 的三个 API） | 要么实现「扫描→收货草稿→确认」，要么修订 Requirement 措辞收敛为「仅解析」 |
| 3 | PRC-01 未接线的 8 个参数开关 | 开关的业务判定条件未在 Requirement/Design 中定义 |
| 4 | PRC-04/05 寻源治理 | 正式寻源写入口已 SAFE_CLOSE；Source List / Quota 是否需要可写路径是范围裁定 |
| 5 | PRC-12 split/merge 规划事实 | 需要新的规划事实模型与审计口径 |
| 6 | PRC-14 settlement/payee supplier 与价格/折扣来源独立列 | 商业快照的完整字段范围需要范围裁定 |
| 7 | PRC-24 审批岗分权 | 退货申请的审批岗位需要权限模型裁定 |
| 8 | OUT-02/OUT-03 委外货源与加工价来源 | 委外货源是否需要独立决策流程、加工费是否需要「已批准委外合同」实体 |
| 9 | OUT-20 `C-P01..C-P04`、OUT-23 期初 WIP 与期间关闭 | 财务口径与跨域接入的既有延期决策 |
| 10 | OUT-22 正式延期决策 ID | 当前只有范围排除，没有 `MC-REQ-15` 类条目 |
| 11 | 真实 MySQL Gate 的执行授权 | 受保护 disposable 环境的逐次授权 |

## 7. 未发生事项

本复核不执行真实环境 migration、不写业务数据库、不运行 MySQL Gate、不 push/merge/tag/发布/部署、不改动 `docs/audits/b3101-b3121-code-audit-20261107.md` 的历史结论、不把 `PARTIAL` 宣称为 `COVERED`。
