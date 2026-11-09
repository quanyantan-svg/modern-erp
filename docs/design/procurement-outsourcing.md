# Procurement & Outsourcing — Technical Design

> 状态：`ACTIVE`
> Owner：Procurement & Outsourcing
> 权威来源：`solution.md` §26
> 来源：`solution.md` §26（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

> **（2026-11-02 范围提示）**
> 业务所有者于 2026-11-02 批准 `M1-SRD-01`，据此 M1 的**首期**范围被重定基线。
> 本文件 §26 继续作为原 Domain Design 基线，不被覆盖或删除。
> M1-Core 首期由独立 Active Design
> [`docs/design/procurement-outsourcing-m1-core.md`](./procurement-outsourcing-m1-core.md)
> 承载（`M1_CORE_DESIGN_PASS`，2026-11-02）；两者范围不同，不构成重复 Active 合同。
> M1 全范围的候选设计保存在
> [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)。
> 范围决定见
> [`docs/decisions/m1-core-scope-rebaseline-20261102.md`](../decisions/m1-core-scope-rebaseline-20261102.md)；
> 当前项目状态见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §37。

> **2026-11-07 范围增补**：§26.34 是 §31.14 的有界 Design；仅在 A1 SAFE_CLOSE 与 VMI-01..05 最小范围上取代 §26.4/§26.16/§26.20 对应旧目标。§26.33 仍保留给 M1 全范围候选设计，不在此复用；M1-Core Active Design 与既有 Gate Acceptance 均不改写。
>
> **2026-11-08 OUT-001 有界批准**：§26.34 中 **OUT-001 相关范围**（§26.34.2、§26.34.4.2～§26.34.4.3、§26.34.5、§26.34.8、§26.34.9、§26.34.13、§26.34.14）已获业务所有者**有界批准**用于 Implementation；其身份链引用的唯一权威修正见 **§26.34.15.2**，两批实施范围见 **§26.34.15.3**。该批准**不**等于 §26.34 整体 `DESIGN_PASS`，**不**把 §31.14 整节标为 `APPROVED`，**不**改变 VMI、`PRC-06`、`B-P01/B-P02`、`AUD-OUT-001` 的原状态，也**不**授权 Schema / Migration、数据库操作或真实 MySQL Gate。

## 26. Procurement & Outsourcing Domain Technical Design

> 本节固化 Procurement & Outsourcing Domain Closure 的 Design 阶段成果。Requirement 见 `document.md §31`；Audit 见本次会话的 `PROCUREMENT & OUTSOURCING DOMAIN FINAL AUDIT REPORT` + Correction Pass。Manual Evidence Baseline 来自上游已批准的 B3101 / B3121 + B3104 / B3105 / B3106 / B3108 / B3109 / B3119 / B3120。
>
> 本节不进入 Implementation / Migration / API / UI / Test；仅按 §26.1–§26.29 形成可实施技术方案，等待用户 `DESIGN PASS`。

### 26.1 Architecture / Ownership

`server/app.js` 仍承担 HTTP route + auth + thin dispatch。Procurement & Outsourcing Domain 的业务逻辑按 cohesion / caller chain / transaction ownership / source-target identity / testability 拆分到以下模块：

| Module | Responsibility | Wave |
|---|---|---|
| `server/modules/procurement-parameters.js`（NEW） | Procurement Parameters owner：`source_control_enabled`、`quota_enabled`、`default_receipt_billing_mode`、`po_change_enabled`、`receiving_tolerance_policy`、`return_policy`、`requisition_policy`、`numbering`；singleton row，参数变化不反写历史已批准/已执行单据 | A |
| `server/modules/procurement-profiles.js`（NEW） | Supplier Procurement Profile additive columns + 独立 profile/version entity；Buyer / Purchasing Group / Membership / Document snapshot | A |
| `server/modules/procurement-sourcing.js`（NEW） | Source List / Quota (PROPORTIONAL) / Sourcing Decision canonical owner；`resolveEligibleSources` + deterministic allocator + manual override audit | B |
| `server/modules/procurement-pricing.js`（NEW） | Purchase Price List / Pricing UOM 取价 / Procurement Pricing Discount / Price Adjustment (effectivity-dated, no retroactive)；与 Finance `purchase_discounts` 严格隔离 | B |
| `server/modules/procurement-orders.js`（NEW） | PO core lifecycle + Commercial Snapshot + Delivery Schedule + Prepayment Requirement + PO Change (ADD/MODIFY/CANCEL) + canonical PO execution view (`OPEN / PARTIALLY_RECEIVED / FULFILLED-CLOSED / CANCELLED`) | C |
| `server/modules/procurement-receiving.js`（NEW） | Receipt Notice + Purchase Receipt confirm + IQC source-type adapter + Delivery Schedule/Tolerance enforcement；不变更既有 inventory / LOT-SERIAL / valuation / idempotency / period 合同 | D |
| `server/modules/procurement-returns.js`（NEW） | Return Request + Purchase Return four-branch financial refactor：LEGACY_DIRECT → AP credit；SEPARATE unbilled → reverse GRNI；SEPARATE billed → AP credit；partially billed → deterministic split | D |
| `server/modules/procurement-vmi.js`（NEW） | VMI business documents only：VMI Policy / VMI Receipt business fact / Consumption business fact / Consumption Summary / Ownership Transfer business fact / Supplier Bill handoff；**不得**建立第二 inventory ledger；通过 owner-dimension interface 调用 Inventory | E |
| `server/modules/outsourcing.js`（NEW） | Outsourcing Order canonical owner；Source / Header / Lines / Lifecycle（PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED + DRAFT / CANCELLED bounded technical states）；consumes Engineering resolver | F |
| `server/modules/outsourcing-materials.js`（NEW） | Outsourcing Material List snapshot + Issue / Supplement / Return / Backflush + Supplier WIP warehouse binding + LOT/SERIAL provenance；复用 canonical Inventory Transfer primitives | G |
| `server/modules/outsourcing-receiving.js`（NEW） | Completion Receipt Notice + Inspection source adapter + Outsourcing Receipt + Processing Fee AP extension (via canonical Supplier Bill) + Cost Evidence + Finished Return + WIP / Opening / Period reports | H |

保留既有（**不得重写**，仅 EXTEND / INTEGRATE）：

- `server/modules/suppliers.js`：Supplier generic master KEEP；`suppliers` 表新增 additive procurement / outsourcing profile 列；
- `server/modules/purchase-order-status-fix.test.js`、`uat-r4-purchase-source-chain.test.js` 等既有测试 KEEP；
- `server/modules/commercial-golive.js`：`PURCHASE_RECEIPT` → `ensurePayableSource` (LEGACY_DIRECT) / `GRNI CREDIT` (SEPARATE/AUTO_BILL) / `autoBillReceipt` AUTO_BILL 三链；
- `server/modules/settlement-core.js`：`ensureSubledger(AR/AP)`、AP open item；
- `server/modules/financial-inventory.js`：`receiveValue` / `issueValue` / `allocateProportionalCents` / `createSystemVoucher` / `inventoryAccountRole`；
- `server/modules/quality-gates.js` / `authoritative-quality.js` / `manufacturing-quality.js` / `traceability-quality.js`：IQC source-type EXTEND；
- `server/modules/planning-domain.js`：`planning_outsource_handoffs(PENDING)` 仅 upstream record，本 Domain 是 exactly-once consumer；
- `server/modules/engineering-bom.js` / `engineering-configurable-bom.js`：OUTSOURCE BOM resolver；
- `server/modules/planning.js`：MRP 引擎 / canonical `releasePlannedOrder` OUTSOURCE handoff creation；
- `server/lib/stock.js`：canonical inventory mutation；
- `server/lib/payment-terms.js`：payment terms 解析。

### 26.2 Procurement Parameters (PRC-01)

- Singleton table `procurement_parameters` 使用 `id='DEFAULT'`：
  ```text
  source_control_enabled         INTEGER NOT NULL DEFAULT 1
  quota_control_enabled          INTEGER NOT NULL DEFAULT 0
  default_receipt_billing_mode   TEXT    NOT NULL DEFAULT 'SEPARATE'
  po_change_enabled              INTEGER NOT NULL DEFAULT 1
  receiving_tolerance_policy     TEXT    NOT NULL DEFAULT 'STRICT'  -- STRICT | SOFT_BAND
  return_policy                  TEXT    NOT NULL DEFAULT 'STANDARD'
  requisition_policy             TEXT    NOT NULL DEFAULT 'OPEN'
  prepayment_required_default    INTEGER NOT NULL DEFAULT 0
  numbering                      TEXT    NOT NULL DEFAULT 'PERIOD_SEQ'
  updated_by, updated_at
  ```
- 第一次生效：现有业务 `default_receipt_billing_mode` 写入 `'SEPARATE'`；所有 LEGACY_DIRECT 历史记录保持原值不变（**仅新业务默认改**）。
- Parameter mutation 写 `audit(db, ..., 'UPDATE', 'PROCUREMENT_PARAMETER', 'DEFAULT', ...)`；mutation 不反写历史已批准/已执行单据；读路径永远从 `procurement_parameters` 当前行。
- Validation：所有 enum 字段白名单；`default_receipt_billing_mode` ∈ {`SEPARATE`, `LEGACY_DIRECT`, `AUTO_BILL`}；`STRICT` 不允许超收，`SOFT_BAND` 在 tolerance window 内允许。
- `procurement-parameters.js::getActiveParameters(db)` 是唯一读取入口；缓存（无副作用 short-lived in-memory cache by id='DEFAULT'）仅在同一 process 生命周期内。
- API：
  - `GET /api/procurement/parameters` 返回当前 active 参数；
  - `PATCH /api/procurement/parameters` 修改（admin / `PROCUREMENT_CONFIG_MANAGE`）；每次必须 snapshot before/after。
- Failure behavior：参数缺失视为 fail closed（`'SEPARATE'` 是 default；其它关键 enum 在缺失时抛 500 表示需要 bootstrap）。

### 26.3 Supplier Procurement Profile (PRC-02)

- 直接放 `suppliers` 表的 additive 列（避免 entity 爆炸）：
  ```text
  procurement_enabled            INTEGER NOT NULL DEFAULT 1
  outsourcing_enabled            INTEGER NOT NULL DEFAULT 0
  supplier_category              TEXT    NOT NULL DEFAULT 'GENERAL'  -- GENERAL | STRATEGIC | TRANSACTIONAL | OUTSOURCE
  qualification_status            TEXT    NOT NULL DEFAULT 'UNQUALIFIED' -- QUALIFIED | UNQUALIFIED | SUSPENDED | BLACKLIST
  qualification_valid_from        TEXT
  qualification_valid_to          TEXT
  default_payment_terms_days     INTEGER
  default_currency               TEXT    NOT NULL DEFAULT 'CNY'
  supplier_wip_warehouse_id      TEXT    REFERENCES warehouses(id)
  outsourcing_qualification_note TEXT
  ```
- 新增 `supplier_procurement_overrides` 历史版本表（versioned `effective_from` / `effective_to`），用于 audit 时回看；不复制整个 Supplier 实体。
- Qualification 校验：`qualification_status='QUALIFIED'` 且 `qualification_valid_from <= business_date <= qualification_valid_to` 才能用于 sourcing / PO / outsourcing；其它状态在 `procurement-sourcing.js::resolveEligibleSources` 显式 fail。
- Buyer / Purchasing Group：新增 `buyers` / `purchasing_groups` / `buyer_memberships`（buyer_id, purchasing_group_id, role）；PO 文档 additive snapshot `buyer_id` / `purchasing_group_id`，业务校验 server-side。
- Null-group compatibility：现有 PO 不带 group 也必须可读；legacy null-group PO 永远 `purchasing_group_id=NULL`；admin 行为不受 group scope 影响。
- API：`GET /api/suppliers/:id/profile`、`PATCH /api/suppliers/:id/profile`；`/api/buyers*`、`/api/purchasing-groups*`；`/api/suppliers/:id/wip-warehouse`。
- Failure：profile 无效字段（如 qualification 过期）→ 409，PO 创建阻断；不静默回退。

### 26.4 Sourcing — Source List / Quota / Sourcing Decision (PRC-04 / PRC-05 / PRC-06)

#### Tables

- `source_list_entries(id, supplier_id, product_id, source_type('PURCHASE'|'OUTSOURCE'), enabled, effective_from, effective_to, created_by, created_at, version)`；
- `source_list_versions(id, entry_id, version, snapshot_json, effective_from, effective_to, created_by, created_at)`（history；snapshot 不可写回修改）；
- `quota_assignments(id, supplier_id, product_id, source_type, proportion_num, proportion_den, effective_from, effective_to, version)` — `PROPORTIONAL` 表示分子/分母有理数；
- `sourcing_decisions(id, source_type('PR'|'PO'), source_id, status('DRAFT'|'APPLIED'|'OVERRIDDEN'), created_by, created_at, applied_at, hash)`；
- `sourcing_decision_allocations(id, decision_id, source_list_entry_id, supplier_id, product_id, source_quantity_num, source_quantity_den, allocated_quantity_num, allocated_quantity_den, rule_reason)`。

#### Resolver

`procurement-sourcing.js::resolveEligibleSources(db, { productId, sourceType, businessDate })`:

1. Filter `source_list_entries` by `product_id = ? AND source_type = ? AND enabled=1`；
3. 过滤 supplier：`suppliers.procurement_enabled=1` 且 `qualification_status='QUALIFIED'` 且 `qualification_valid_from <= businessDate <= qualification_valid_to`；
4. 过滤 effectivity：`effective_from <= businessDate AND (effective_to IS NULL OR effective_to >= businessDate)`；
5. 返回 list：稳定顺序 `source_list_entry_id ASC`（deterministic）。

#### Quota allocator（PROPORTIONAL only）

`procurement-sourcing.js::allocateByProportionalQuota(db, { eligibleEntries, productId, sourceType, totalDemand })`:

- 每个 eligible supplier 取 `quota_assignments` 当前有效行 `(proportion_num, proportion_den)`，归一化（`gcd` 化简后 `sum(num)/den = 1`）；
- 顺序按 `quota_assignments.id ASC`；quantity 分配 `floor((totalDemand * proportion_num) / proportion_den)`；
- residual `r = totalDemand - sum(allocated)`：按稳定 supplier 顺序 +1 直至 r=0；`r` 必然 `< eligible count`，分配 deterministic；
- 用 `rational()`（已存在于 `commercial-golive.js`）做有理数计算避免浮点授权；写库前 `roundRational`；
- 任何 conflict / overshoot → throw 409；
- Source-line trace：`sourcing_decision_allocations` 记录 `source_quantity` 与 `allocated_quantity`；PR line total 与 sum(allocated) 必须守恒。

#### Sourcing Decision Lifecycle

- `DRAFT`：resolver + allocator 输出 decision + allocations；
- `APPLIED`：单事务应用 — 同时锁定 PR line remaining + 创建 N PO draft 创建；任何一步失败 → release `_no-op update` 释放 row lock，state 不前进；
- `OVERRIDDEN`：手动 override source control 时创建 OVERRIDDEN decision 记录 `permission` (`PROCUREMENT_CONFIG_MANAGE` 或等价 purchasing_group admin)、`reason`、audit；override 不影响后续 source control 启用时其它 PR；
- `applied decision` 不可变；新 PR 必须创建新 decision row；不允许复用同一 decision 覆盖两个 PR。

#### Override Audit

- Permission: `SOURCING_OVERRIDE` (admin / purchasing_group admin)；
- API: `POST /api/procurement/sourcing/override` 必须 `permission + reason + audit`；
- Source control disabled 时 resolver 直接返回所有 supplier，但必须 `permission` + `reason` 才能写入 decision。

### 26.5 Pricing — Price List / Pricing UOM / Pricing Discount / Price Adjustment (PRC-07 / PRC-08 / PRC-09 / PRC-10)

#### Tables

- `purchase_price_list_entries(id, supplier_id, product_id, source_type('PURCHASE'|'OUTSOURCE'), pricing_uom_code, unit_price_cents, status('ACTIVE'|'INACTIVE'), effective_from, effective_to, version)`；
- `purchase_price_list_versions` 入表 `entry_id, snapshot_json, version`（history；user 不写回）；
- `pricing_discount_schemes(id, supplier_id, product_id, source_type, basis('PERCENT'|'FLAT'), value_numerator, denominator, status('ACTIVE'|'INACTIVE'), effective_from, effective_to, version)` — **Procurement Pricing Discount**；
- `purchase_discounts`（既有 Finance table）**严格不修改**；新增表 `pricing_discount_schemes` 是 Procurement 独立能力。

#### Pricing UOM 取价流程（PRC-08）

`procurement-pricing.js::resolvePrice(db, { supplierId, productId, sourceType, pricingUomCode, businessDate })`:

1. 取最近一条 `purchase_price_list_entries`（`status='ACTIVE'` + effectivity by business_date）；
2. 如果 `pricingUomCode` ≠ `base_uom_code`，则调用 `commercial-golive.js::quantitySnapshot` 取得 `pricing_uom -> base_uom` 有理换算（已有 `product_uom_conversions`，无需新建 UOM engine）；
3. unit_price 写为 pricing_uom 单价（PO line 写时再按 `document_uom -> base_uom` 与 `pricing_uom -> base_uom` 计算 money 维度）；
4. 如果不存在有效 price list entry → 抛 409，PO 创建阻断；不静默回退。

#### Pricing Discount

- 仅影响 PO unit price resolution（输入到 `unit_price_cents`）+ PO snapshot 记录 `price_source` / `discount_source`；
- **不得**直接创建 AP 调整；**不得**写 `purchase_discounts` / `account_payables` / `financial_credit_adjustments`；
- ALGORITHM 边界：本 Domain 只实现 PERCENT / FLAT 两类；其它复杂 Kingdee 算法 = `SOURCE_DETAIL_INSUFFICIENT`，留 design extension point（schema 字段预留 `formula_json` 但当前不在 mutation 路径）。

#### Price Adjustment (PRC-10)

- Effectivity-dated：写新 entry / version，旧 entry 失效（`effective_to = today`）但不修改历史 PO / Receipt / Bill / AP；
- 强制 invariant：旧 PO `unit_price_cents` 历史 snapshot 不可修改；Supplier Bill 自动 refund 生成 source 路径走既有 `applyCreditAdjustment`，**不**重新计价；
- Disallow：用户 API 不暴露 `unit_price_cents` retroactive patch；如发现 PRICE 已调整必须新建 PO Change (`MODIFY price`)；不直接 UPDATE 既有表。

#### API

- `GET /api/procurement/price-list`、`POST/PATCH`；
- `GET /api/procurement/pricing-discounts`、`POST/PATCH`（disabled = `SOURCE_DETAIL_INSUFFICIENT` 期间返回 501）；
- `POST /api/procurement/pricing/resolve` 返回 PO line `unit_price_cents` 解析结果 + snapshot fields。

### 26.6 PR / PO Governance (PRC-11 / PRC-12 / PRC-13 / PRC-14)

#### PR Source Trace (PRC-11)

- 既有 `purchase_requisitions` + `purchase_requisition_items` 保留；
- Additive 列 `source_type` ∈ {`MANUAL`, `PLANNING_PURCHASE_INSTRUCTION`, `SALES_ORDER`, `OTHER`}（source=other 不预填）；`source_id`、`source_line_id`；
- 既有 `planning-documents.js` `purchase_instructions` → `purchase_requisition` 路径保留并 EXTEND：在 PI item 写时同时 `pr_line_id` = PR line id；
- Conversion 写 `pr_conversion_log(id, pr_line_id, source_line_id, converted_quantity_num, converted_quantity_den, reversed_quantity, status)`；log 不可写回修改。

#### PR Split / Merge / Supplier Allocation (PRC-12)

- 新增 `pr_split_allocations(id, pr_line_id, source_list_entry_id, supplier_id, product_id, allocated_quantity_num, allocated_quantity_den, version)`；
- Split / Merge 通过 `sourcing_decision` + `sourcing_decision_allocations`；preview → apply 两阶段；
- Apply atomic：单事务 lock 全部 PR line + 全部 source line；任何冲突 → release + write no-AP；
- Apply 后 PR line remaining 与 sum(allocations) 守恒；
- Audit：PR split / merge / allocate / cancel 全部写 audit。

#### Purchase Order (PRC-13)

- 既有 `purchase_orders` / `purchase_order_items` 表 KEEP；不重写 existing approval flow；
- Additive 列：
  ```text
  is_gift_line INTEGER NOT NULL DEFAULT 0
  pricing_discount_scheme_id TEXT  REFERENCES pricing_discount_schemes(id)
  price_source TEXT
  discount_source TEXT
  ```
- `commercial_snapshot` 字段以 JSON text 持久化：`{supplySupplierId, settlementSupplierId, payeeSupplierId, buyerId, purchasingGroupId, supplierContact, supplierPhone, supplierAddress, paymentTermsDays, sourcePriceListVersion, sourceDiscountSchemeVersion, scheduleFingerprint}`；
- PO lifecycle：`DRAFT → SUBMITTED → APPROVED / REJECTED → CLOSED_STYLE`。Execution lifecycle 由 PRC-19 持有。

#### PO Commercial Snapshot (PRC-14)

- 既有 supplier/contact/address/payment_terms 字段 KEEP；
- Additive column `buyer_id`、`purchasing_group_id`、`settlement_supplier_id`、`payee_supplier_id`、`delivery_schedule_fingerprint`；
- 默认关系：
  - `settlement_supplier_id = supply_supplier_id`；
  - `payee_supplier_id = settlement_supplier_id`；
- 不创建第二 payment engine；
- Snapshot 在 PO APPROVED 时冻结；
- API：PO list/detail 暴露 `supplySupplier` / `settlementSupplier` / `payeeSupplier` / `buyer` / `purchaseGroup`；`/api/procurement/po/:id/commercial-snapshot`。

### 26.7 Gift / Free Item (PRC-15)

- PO line `is_gift_line` boolean；`unit_price_cents=0` 当且仅当 `is_gift_line=1`；
- Submit gate：`app.js:2398` `unit_price_cents <= 0` → 替换为：
  - 非 gift：`unit_price_cents > 0`；
  - gift：`is_gift_line=1 AND unit_price_cents=0 AND amount_cents=0`；
- 普通 line 不得借 `is_gift_line` 绕过；商业校验仍要求 positive amount；
- PO detail UI 显示 `🎁 Gift` 标记；不得隐藏 line value。

### 26.8 Delivery Schedule / Quantity Control (PRC-16)

- 新表 `po_delivery_schedule(id, po_line_id, sequence_no, planned_quantity_num, planned_quantity_den, planned_date_from, planned_date_to, upper_tolerance_pct, lower_tolerance_pct, version)`；
- PO line 仍存在 `quantity / received`；新增 column `lower_tolerance_auto_close` 仅 DRAFT 期允许配置；
- Receipt source 优先 PO line + optional `po_delivery_schedule_id`；
- `assertRemainingQuantity` 在 receipt confirm 时同时锁 source line + schedule line（schedule_id 可空）；
- Default policy：`receiving_tolerance_policy='STRICT'`（不超收）；admin 可切 `'SOFT_BAND'` 允许 tolerance window 内超收；
- Lower-tolerance auto-close **不在本 Domain 自动实现**（Requirement 标 `SOURCE_DETAIL_INSUFFICIENT`）；Design 提供 `lower_tolerance_auto_close` 字段供后续 bounded algorithm；当前 PO line 剩余 = `quantity - received`，未达 lower tolerance 不自动 close，留作 operator manual close。

### 26.9 Prepayment Requirement (PRC-17)

- 新表 `prepayment_requirements(id, po_id, sequence_no, prepayment_pct_basis_numerator, prepayment_pct_basis_denominator, due_date, expected_payment_cents, status('DRAFT'|'POSTED'|'CANCELLED'), finance_handoff_id, created_by, created_at)`；
- Procurement owner：CRUD 文档、生成 `finance_handoff_id` (UUID reference)；
- Finance owner：实际 Payment / Allocation 通过 canonical `payment_disbursements` + `payment_disbursement_items`，`source_type='PREPAYMENT_REQUIREMENT'`；
- Finance Handoff：POST prepayment 时由 Procurement 调 `payment-disbursement` API 路径生成 payment；finance 通过 canonical `applyCreditAdjustment` 与 AP 对冲；
- **不得**建立第二 payment engine；
- API：`POST /api/procurement/prepayment-requirements`、`POST /api/procurement/prepayment-requirements/:id/post`。

### 26.10 PO Change (PRC-18)

- 新表 `po_changes(id, po_id, change_no, change_type('ADD'|'MODIFY'|'CANCEL'), status('DRAFT'|'APPROVED'|'APPLIED'|'REJECTED'|'CANCELLED'), requested_by, requested_at, approved_by, approved_at, applied_by, applied_at, snapshot_before_json, snapshot_after_json, approval_audit_json)`；
- 新表 `po_change_items(id, po_change_id, po_line_id, line_no, change_type('ADD'|'MODIFY'|'CANCEL'), requested_qty_delta_num, requested_qty_delta_den, requested_price_cents_delta, requested_date_delta, schedule_change_json)`；
- Lifecycle 与 Platform Approval `PURCHASE_ORDER` 共用 `approvals.js`，复用 `approval_events`；
- Apply 必须单事务：lock PO line + `po_change_items` + `po_delivery_schedule`（如有）+ `assertRemainingQuantity`；`new_qty < already_received + already_notified + already_changed_applied_qty` → 409；
- Applied result 写入 `po_changes.snapshot_after_json` 并冻结（immutable）；
- 历史 PO line `quantity / unit_price` snapshot 不可写回修改；
- 历史 Receipt / Bill / AP 不得引用本 PO Change 进行 retroactive 调价；调价走 Finance `purchase_discounts`（已存在的 AP allowance）或 canonical credit adjustment。

### 26.11 Canonical PO Execution (PRC-19)

- 新 view/service `procurement-orders.js::getPoExecutionView(db, poId)`：
  ```text
  ordered            = po_line.quantity
  notified           = sum(notified_quantity WHERE po_delivery_schedule_id IS NULL OR delivery_id IS NOT NULL?)
  received           = sum(received_quantity FROM confirmed purchase_receipt_items)
  returned           = sum(returned_quantity FROM confirmed purchase_return_items)
  open_remaining     = ordered - received - returned  (always >= 0)
  fulfilled          = (open_remaining == 0)
  status             = 'OPEN' | 'PARTIALLY_RECEIVED' | 'FULFILLED' | 'CANCELLED'
  ```
- **唯一 consumer**：MRP (`planning.js` open supply) / Planner Workbench (`planning-domain.js` buildPlanningBalanceReadModel) / Reservation (`planning-reservation.js` 强预留 available) / Receiving (`procurement-receiving.js` remaining check)。
- MRP 迁移：`migrateMrpToPo` 启动 hook — 把 `MRP remaining` 计算改为 `getPoExecutionView.open_remaining`；删除原有 `purchase_orders.remaining_quantity` 计算；
- Reservation 迁移：`assertStrongReservationAvailability` 输入从 `purchase_orders.approved_quantity` 改为 `getPoExecutionView.open_remaining`；
- Workbench 迁移：`buildPlanningBalanceReadModel` `purchaseSupply` event 用 `getPoExecutionView.open_remaining`，并 freeze event_date = `po.expected_delivery_date`；
- 验证：`pnpm test` + `pnpm test:heavy` + 在受保护 disposable MySQL 环境 `pnpm test:mysql` + `pnpm test:mysql:concurrency`（focused test：并发 release planned vs unconfirmed 时 MRP 与 Reservation 不双算）。

### 26.12 Receipt Notice / Receiving (PRC-20 / PRC-22)

#### Tables

- `receipt_notices(id, notice_no, supplier_id, warehouse_id, business_date, status('DRAFT'|'CONFIRMED'|'CANCELLED'), business_type('STANDARD_PURCHASE'|'OUTSOURCE_PROCESSING') NOT NULL DEFAULT 'STANDARD_PURCHASE', created_by, created_at)`；
- `receipt_notice_items(id, receipt_notice_id, po_line_id, schedule_id NULL, product_id, planned_quantity_num, planned_quantity_den, source_trace_json)` — 允许 N PO lines → 1 notice；
- 既有 Purchase Receipt 不变 schema；新 `outsourcing_completion_notices` 走独立表（参见 §26.20），避免与 Purchase Receipt 共用同一 `receipt_notices`。

#### Receipt Notice Invariants

- **NO Inventory / Valuation / GRNI / AP / Voucher / WIP / future Planning supply** effect；
- 仅写 `receipt_notices` / `receipt_notice_items`；
- Receipt Notice 可被 Purchase Receipt 引用作为 source（`purchase_receipts.source_notice_id` additive）；
- Receipt Notice 不形成第二 Planning supply（不写 `mrp_run_events`）；
- Compatible 多 PO 合并条件：同 supplier + 同 warehouse + 同 `business_type`；schedule/tolerance 由 Receipt 阶段 enforcement。

#### Purchase Receipt (PRC-22) — EXTEND only

- 既有 `purchase_receipts` / `purchase_receipt_items` 表 KEEP；不重写 confirm / lifecycle / IQC / idempotency / period；
- Additive 列：
  ```text
  source_notice_id TEXT REFERENCES receipt_notices(id)
  delivery_schedule_id TEXT REFERENCES po_delivery_schedule(id)
  po_change_id TEXT REFERENCES po_changes(id)
  ```
- **Standard Purchase Receipt 强制 `business_type='STANDARD_PURCHASE'`**：
  - 在 `createPurchaseReceipt` / `confirmPurchaseReceipt` 入口立即断言 `purchase_orders.business_type = 'STANDARD_PURCHASE'`；
  - 否则 `HttpError(409, 'PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE')` — **禁止**用 ordinary Purchase Receipt 接收 `OUTSOURCE_PROCESSING` PO；走 Outsourcing Receipt 路径（§26.20）；
  - 反向断言：Outsourcing Receipt 必须 `business_type='OUTSOURCE_PROCESSING'`，且 `purchase_orders.source_outsourcing_order_id = outsourcing_order.id`（§26.20）。
- Confirm 时：
  - 先 lock `po_changes` 与 `purchase_orders` 与 `po_delivery_schedule`（如有 schedule）；
  - `assertRemainingQuantity` 复用既有 helper，扩展支持 `schedule_id`；
  - `commercial_snapshot` 校验（discount / price / source 不变）；
  - 既有 inventory / LOT-SERIAL / valuation / IQC 调用不变；不重写 inventory mutation；
  - 新业务 `default_receipt_billing_mode` 来自 `procurement_parameters`；LEGACY_DIRECT 数据保持兼容；
  - `po_line.gift = 1` 时 entry 仍按 `unit_price_cents=0` 写入 valuation（carry value = 0）；不影响 inventory qty+。

### 26.13 IQC Integration (PRC-21)

- 既有 `quality-gates.js` / `authoritative-quality.js` KEEP；
- 新增 source-type `OUTSOURCING_RECEIPT`（canonical name 由 Design 决策保留：`OUTSOURCING_RECEIPT`）；
- 不新建 Quality engine；只在 `purchase_receipt_items` 启用 IQC 引用路径；
- Quality policy snapshot 仍走既有 `freezeQualityPolicy`。

### 26.14 Return Financial Refactor — Four-Branch (PRC-24 / PRC-25)

#### Tables

- `return_requests(id, return_request_no, source_type('PO'|'RECEIPT_NOTICE'|'PURCHASE_RECEIPT'|'MANUAL'), source_id, request_type('QUALITY'|'COMMERCIAL'|'STOCK'|'OTHER'), reason_code, reason_text, replenishment_method, status('DRAFT'|'POSTED'|'CANCELLED'), business_date, created_by, created_at)`；
- `return_request_items(id, return_request_id, source_line_id, product_id, quantity_num, quantity_den, line_no)`；
- 既有 `purchase_returns` / `purchase_return_items` KEEP；`purchase_returns.return_request_id` additive 引用；
- 既有 Purchase Return physical/value execution handler 不重写。

#### Return Financial Refactor — Four-Branch Logic

`procurement-returns.js::applyPurchaseReturn(db, { returnId, actor })`:

1. Load `purchase_returns` header + items + source receipts；
2. Load receipt billing mode + 既有 billed reserved quantity = `sum(supplier_bill_items.quantity WHERE receipt_id=receipt_id AND bill.status IN ('DRAFT','WAITING_MATCH','POSTED'))`（与 §26.20 同一 billable reservation 集合；CANCELLED / REVERSED 不计入）；
3. 对每行 return qty 按 deterministic split policy：

   ```text
   unbilled_qty = max(0, receipt_received_qty - billed_qty - already_returned_qty)
   billed_qty   = max(0, return_qty - unbilled_qty)
   ```

   （**billed-first split** — 满足 Spec §34 deterministic fixed order；选择后必须 document + test + audit）

4. **LEGACY_DIRECT branch**（receipt `billing_mode='LEGACY_DIRECT'`）：
   - Inventory reversal (carry value) + AP credit via canonical `applyCreditAdjustment(db, side='AP', target_open_item_id=purchase_receipts.id, source_type='PURCHASE_RETURN', source_id=return_id, amount=-return_amount, ...)`；
5. **SEPARATE unbilled branch**（receipt `billing_mode='SEPARATE'` 且 `billed_qty=0`）：
   - Inventory reversal + system voucher `Dr GRNI / Cr Inventory (carry value + offset)`；**NO AP credit**；Supplier Bill 尚未存在，invariant `billed_qty<0` 抛 409；
6. **SEPARATE billed branch**（receipt `billing_mode='SEPARATE'` 且 `billed_qty>0` 且 `unbilled_qty=0`）：
   - Inventory reversal + AP credit via canonical `applyCreditAdjustment`；
7. **Partially billed branch**（receipt `billing_mode='SEPARATE'` 且 `billed_qty>0` 且 `unbilled_qty>0`）：
   - unbilled portion → `Dr GRNI / Cr Inventory`（no AP）；
   - billed portion → AP credit via canonical `applyCreditAdjustment`；
   - 两笔 voucher 在单事务内创建；
   - audit 记录 split 比例；
8. **CANCELLED** return 不走 voucher；
9. Rollback / 失败 → release row lock + voucher 撤；
10. Audit：`'CONFIRM', 'PURCHASE_RETURN', return_id, return_no`。

#### Unbilled Goods (未入库)

- 不允许建 inventory return；走 Notice rejection / cancel 路径；
- `return_requests.source_type='RECEIPT_NOTICE'` + `return.status='CANCELLED'` 走 Notice 系统路径；
- 真实未入库货物无 Receipt source，`assertRemainingQuantity` 抛 409。

### 26.15 Procurement Scan (PRC-26)

- Bounded：仅 scanner-wedge input，document no / item identity / warehouse / qty / LOT / SERIAL；
- 不做 camera SDK / barcode designer / label printing；
- Scan 后端调用 `procurement-receiving.js::createPurchaseReceiptDraft` 或 `createReceiptNoticeDraft`；
- 前端 Scan 工作面：Source = `PO` or `Receipt Notice`；Step 1：scanner wedge → document lookup；Step 2：identity → line match；Step 3：warehouse + qty + LOT/SERIAL 录入；Step 4：submit 调用 receipt confirm；
- API：`POST /api/procurement/scan/lookup-document`、`POST /api/procurement/scan/draft-receipt`、`POST /api/procurement/scan/draft-notice`。

### 26.16 VMI (VMI-01 ~ VMI-05)

#### Tables

- `vmi_agreements(id, agreement_no, supplier_id, warehouse_id, product_id, business_date_start, business_date_end, replenishment_mode('PULL'|'PUSH'|'MIN_MAX'), min_quantity, max_quantity, ownership_transfer_rule('ON_CONSUME'|'ON_PERIOD_CLOSE'|'ON_TRANSFER'), status, created_by, created_at)`；
- `vmi_receipts(id, vmi_receipt_no, agreement_id, supplier_id, warehouse_id, product_id, quantity_num, quantity_den, business_date, status, idempotency_key, created_by)`；
- `vmi_consumptions(id, vmi_consumption_no, agreement_id, supplier_id, warehouse_id, product_id, source_type, source_id, source_LINE_id, consumed_quantity_num, consumed_quantity_den, business_date, status, idempotency_key, created_by)`；
- `vmi_consumption_summaries(agreement_id, period_key, period_start, period_end, consumed_quantity, pending_settlement_qty, ownership_transferred_qty, last_calculated_at)`；
- `vmi_ownership_transfers(id, transfer_no, agreement_id, supplier_id, warehouse_id, product_id, transfer_quantity_num, transfer_quantity_den, business_date, status('DRAFT'|'CONFIRMED'), settlement_supplier_bill_id, idempotency_key)`。

#### Owner-Dimension Interface (CROSS_DOMAIN_DEPENDENCY)

`inventory-extensions.js::OWNER_DIMENSION_INTERFACE`（契约层 — 不实现）：

```text
receiveOwnedStock({ownerType, ownerId, warehouseId, productId, quantity, lotId, serialId, source_type, source_id, idempotency_key}) -> {transaction_id, ledger_row_id}
consumeOwnedStock({ownerType, ownerId, warehouseId, productId, quantity, lotId, serialId, source_type, source_id, idempotency_key}) -> {transaction_id}
transferStockOwnership({fromOwner, toOwner, warehouseId, productId, quantity, lotId, serialId, source_type, source_id, idempotency_key}) -> {transaction_id}
```

`ownerType` ∈ {`ENTERPRISE`, `SUPPLIER`}；当前 inventory 默认 `owner_type='ENTERPRISE'`。本 Domain 调用方：
- `vmi_receipts.confirm()` → `receiveOwnedStock(ownerType='SUPPLIER', ownerId=supplier_id, ...)`；
- `vmi_consumptions.confirm()` → `consumeOwnedStock(ownerType='SUPPLIER', ownerId=supplier_id, ...)`；
- `vmi_ownership_transfers.confirm()` → `transferStockOwnership(fromOwner={type:SUPPLIER,id:supplier_id}, toOwner={type:ENTERPRISE,id:null}, ...)`。

#### Blocked Behavior

Inventory owner dimension **尚未实现**时（本 Domain 上线初期），`receiveOwnedStock / consumeOwnedStock / transferStockOwnership` 抛 `HttpError(501, 'INVENTORY_OWNER_DIMENSION_UNAVAILABLE')`：
- VMI Policy / Consumption Summary 等不需要物理 mutation 的能力可独立工作；
- 需要 owner-dimensional mutation 的能力（VMI-02 / VMI-03 / VMI-05 physical 部分）返回 409 + 明确 owner-domain-blocker；
- VMI business layer 落地 ≠ Inventory owner-dimensional physical stock 落地；
- 当 Inventory Domain 完成 owner dimension 后，接口替换为真实实现；本 Domain 仅调契约，不直接 SQL 写 inventory。

#### Supplier Bill Handoff

- 仅 VMI-05 Ownership Transfer confirm 后触发 Supplier Bill 自动生成：调用 `createSupplierBill(db, {source_type:'VMI_OWNERSHIP_TRANSFER', source_id:transfer_id, ...})`（canonical Supplier Bill）；
- VMI-02/VMI-03 **不**直接 AP；避免在 supplier-owned 阶段伪造 AP。

### 26.17 Outsourcing Order (OUT-01~OUT-10)

#### Tables

- `outsourcing_orders(id, outsourcing_no, source_type('PLANNING'|'MANUAL'), source_id, supplier_id, product_id, need_date, status('DRAFT'|'PLAN_CONFIRMED'|'RELEASED'|'COMPLETED'|'CLOSED'|'CANCELLED'), planning_handoff_id NULLABLE UNIQUE, processing_po_id NULL, processing_commercial_snapshot_json, bom_version_snapshot, created_by, created_at, version)`；
  - `planning_handoff_id` NULLABLE — NULL 表示 MANUAL Order；non-null 表示 PLANNING source；
  - **`UNIQUE(planning_handoff_id)`** — canonical exactly-once contract；
- `outsourcing_order_lines(id, outsourcing_order_id, line_no, product_id, planned_quantity_num, planned_quantity_den, source_bom_id, source_bom_version)`；
- `planning_outsource_handoffs` 既有 — additive 列 `status` ∈ {`PENDING`, `CONSUMED`}，`target_outsourcing_order_id NULLABLE`，`consumed_at`、`consumed_by`；
- `outsourcing_material_lists(id, outsourcing_order_id, version, bom_id, bom_version, snapshot_json, frozen_at)` — snapshot 不可写回修改；
- `outsourcing_material_list_items(id, outsourcing_material_list_id, component_product_id, per_unit_qty_num, per_unit_qty_den, scrap_bps, required_qty_num, required_qty_den, line_no)` — 每条 item 单独 backflush 计算的 granularity；
- 复用既有 `purchase_orders`（**Option A: 复用 canonical PO**，参见 §26.18）；PO header additive `business_type='STANDARD_PURCHASE'|'OUTSOURCE_PROCESSING'` + `source_outsourcing_order_id`。

#### Order Creation

`outsourcing.js::createOutsourcingOrder(db, {input})`:

1. Validate source：
   - `source_type='PLANNING'` → consume `planning_outsource_handoffs(id)` exactly-once（见下方 `consumePlanningHandoff`）；`outsourcing_orders.planning_handoff_id = handoff.id`；
   - `source_type='MANUAL'` → `outsourcing_orders.planning_handoff_id = NULL`；跳过 handoff；
2. Validate supplier：`supplier_procurement_profiles.outsourcing_enabled=1 AND qualification_status='QUALIFIED'`；
3. Resolve BOM：调用 `engineering-configurable-bom.js::resolveEffectiveBomForCaller(db, productId, 'OUTSOURCE', businessDate)`；无结果 → 409；
4. Snapshot：写 `outsourcing_material_lists(version=1)`；
5. Lifecycle 初始：`DRAFT`；
7. Release → `PLAN_CONFIRMED` → `RELEASED` → Material List 冻结（后续 master BOM 变更不写回）。

#### Planning Handoff Consumption (OUT-05) — Final Design

`outsourcing.js::consumePlanningHandoff(db, {handoffId, actor})`:

Transaction (复用现有 `transaction(db, work)` helper，SQLite `BEGIN IMMEDIATE` / MySQL transaction gate + row lock + retry handling)：

```text
BEGIN

lock planning_outsource_handoffs row WHERE id = handoffId FOR UPDATE

assert handoff.status = 'PENDING'   else 409 (already consumed)

assert no row exists in outsourcing_orders WHERE planning_handoff_id = handoffId
                                          else 409 (already consumed)

insert outsourcing_orders(
  planning_handoff_id = handoffId,
  source_type        = 'PLANNING',
  source_id           = handoffId,
  status              = 'DRAFT',
  ...
)

update planning_outsource_handoffs
   set status                       = 'CONSUMED',
       consumed_at                  = now,
       consumed_by                  = actor.id,
       target_outsourcing_order_id  = <new order id>
 where id = handoffId

COMMIT
```

Exactly-once invariants：

- Canonical cross-SQL identity = `outsourcing_orders.planning_handoff_id` UNIQUE 约束。MySQL / SQLite 同时生效；
- MySQL row lock = `SELECT ... FOR UPDATE` on handoff row；
- SQLite = `BEGIN IMMEDIATE` transaction + `WHERE status='PENDING'` re-check；
- Idempotency key = `OUTSOURCING_PLANNING_HANDOFF_CONSUME:{handoffId}`；二次调用返回同 `outsourcing_order_id` 而非重复 INSERT（replay safety）。

#### Cancellation Rule

- 一旦 handoff 进入 `CONSUMED`，**不**允许重新打开 / 重新消费；
- 即使下游 Outsourcing Order 后来 `CANCELLED`，handoff 保持 `CONSUMED`；
- 新需求必须创建新的 Planned Order → 新的 Planning handoff；保持 Planning 不可变性与 source history；
- `target_outsourcing_order_id` 字段是 audit trace — 即使 Order CANCELLED，handoff 仍指向它，便于追溯源。

#### Lifecycle (OUT-07)

- Source-backed Manual semantics：`PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED`；
- Bounded technical states：`DRAFT / CANCELLED` — Design 决策，不冒充 Manual Evidence；
- 状态机：`DRAFT → PLAN_CONFIRMED → RELEASED → COMPLETED → CLOSED`；`DRAFT / PLAN_CONFIRMED` 可 → `CANCELLED`；`RELEASED` 后 `CANCELLED` 仅允许在无 material issue / 无 receipt / 无 processing bill 时；`COMPLETED / CLOSED` 不可取消；
- 不写入 platform approval 作为必需阶段；如需审批走 Platform Approval `OUTSOURCING_ORDER` (后续 Design bounded)。

#### OUTSOURCE BOM Resolver (OUT-08)

`outsourcing.js::resolveBomForOrder` 调用 `resolveEffectiveBomForCaller(db, productId, 'OUTSOURCE', businessDate)`：
- 禁止 raw SQL `boms.status='ACTIVE' LIMIT 1`；
- 无 BOM → 409；
- BOM 已 expired → 409；
- BOM 已变更但 snapshot 已写 → 不影响 released order（snapshot 冻结）；
- qty 调整必须先 release 之前；release 后调整需走 PO Change（如使用 canonical PO 复用）或显式 SUPERSEDE。

### 26.18 Outsourcing PO (OUT-10) — Option A: 复用 canonical PO

**Design 决策：Option A — 复用 canonical Purchase Order。**

**理由**：
- 商业一致性：Supplier Bill / AP engine 不变；`purchase_discounts` 不变；
- 现有 `purchase_orders` 已支持 APPROVED → Receipt → Bill → AP 链；
- 测试 / migration / RBAC / Period Close 共享基础设施；
- 业务语义单一 owner 收敛。

**Additive schema**：

- `purchase_orders` 新增列：
  ```text
  business_type                TEXT NOT NULL DEFAULT 'STANDARD_PURCHASE'
  source_outsourcing_order_id  TEXT NULLABLE REFERENCES outsourcing_orders(id)
  ```
- `business_type` ∈ {`STANDARD_PURCHASE`, `OUTSOURCE_PROCESSING`}；
- Legacy 行 backfill `DEFAULT 'STANDARD_PURCHASE'` — 历史 PO 全部视为普通采购，语义不变；migration 仅填默认 + 新建列；
- `source_outsourcing_order_id` 仅在 `business_type='OUTSOURCE_PROCESSING'` 时 non-null 且必须引用 `outsourcing_orders.id`。

**Processing Fee Semantics**：
- PO line `unit_price_cents` 仅表示 processing service fee；
- 企业提供材料 **不**作为 PO line value；走 §26.19 material execution；
- PO line `quantity` = processing quantity（按 Outsourced Receipt 完成数量结算）；
- Receipt 时 GRNI：`Dr GRNI / Cr Processing fee only` — **不**包含 material value。

**OUTSOURCE_PROCESSING PO Isolation Matrix**：

| Caller | STANDARD_PURCHASE | OUTSOURCE_PROCESSING | 强制 |
|---|---|---|---|
| Standard Purchase Receipt confirm | ACCEPT | **FAIL CLOSED 409** — 走 Outsourcing Receipt 路径 | server-side `business_type` check before inventory mutation |
| Outsourcing Receipt confirm | **FAIL CLOSED 409** | REQUIRE + validate `po.source_outsourcing_order_id = outsourcing_order.id` | server-side |
| MRP Purchase Supply（`releasePlannedOrder` BUY branch） | INCLUDE | **EXCLUDE** | source list / read model |
| Planner Workbench Purchase Supply | INCLUDE | **EXCLUDE** | read model |
| Reservation Purchase Supply | INCLUDE | **EXCLUDE** | read model |
| Receipt Notice | ACCEPT (`business_type='STANDARD_PURCHASE'` additive) | REQUIRE discriminator `business_type='OUTSOURCE_PROCESSING'`，否则 → Outsourcing Receipt | additive column on `receipt_notices` |
| Purchase Return confirm | ACCEPT | **FAIL CLOSED** — 走 Outsourcing Finished Return | server-side |
| PO Execution Read Model (`getPoExecutionView`) | INCLUDE | INCLUDE but flagged `processing_fee_only` for reports | read model |
| Procurement Reports (PO outstanding / on-time) | INCLUDE with `processing_fee_value` aggregate | INCLUDE separately (never merged into BUY) | read model |
| Supplier Bill Matching | `commercial_source_type='PURCHASE_RECEIPT_ITEM'` | `commercial_source_type='OUTSOURCING_RECEIPT_ITEM'` | see §26.20 |
| PO Change (`ADD` / `MODIFY` / `CANCEL`) | ACCEPT | ACCEPT（仅改 quantity / price / schedule；不改 `business_type` / `source_outsourcing_order_id`） | mutation guard |

禁止任何 caller 静默将 `STANDARD_PURCHASE` 与 `OUTSOURCE_PROCESSING` 当作同语义处理；差异必检。

**Option B 拒绝理由**：建立独立 Outsourcing Processing Order 需建立 second PO engine、第二 Supplier Bill / AP source、第二 Approval / Period Close / Period / RBAC — 与 Requirement / Document §6 / AGENTS.md §6 单一 active canonical implementation 冲突。

### 26.19 Material Execution (OUT-11 / OUT-12 / OUT-13 / OUT-14 / OUT-15 / OUT-16)

#### Tables

- `outsourcing_material_issues(id, issue_no, outsourcing_order_id, source_material_list_item_id, status('DRAFT'|'CONFIRMED'|'CANCELLED'), business_date, created_by)`；
- `outsourcing_material_issue_items(id, issue_id, component_product_id, lot_id, serial_id, quantity_num, quantity_den, source_warehouse_id, target_warehouse_id, line_no, tracking_allocations_json)`；
- `outsourcing_material_supplements` 同结构；reason_code / reason_text；
- `outsourcing_material_returns` 同结构（方向相反 `Supplier WIP → Internal`）；
- `outsourcing_material_positions(outsourcing_order_id, component_product_id, lot_id, serial_id, required_qty_num, required_qty_den, issued_qty_num, issued_qty_den, supplemented_qty_num, supplemented_qty_den, returned_qty_num, returned_qty_den, backflushed_qty_num, backflushed_qty_den, supplier_wip_qty_num, supplier_wip_qty_den, version)` — 由 view 派生，不写库。

#### Inventory Transfer Integration

`outsourcing-materials.js::confirmMaterialIssue(db, {issueId, actor})`:

- 调用 canonical Inventory Transfer service（`server/lib/stock.js::adjustInventory` + `source_tracking_allocations`）；
- `from_warehouse_id` = internal warehouse；`to_warehouse_id` = supplier WIP warehouse (`supplier_wip_warehouse_id` from `suppliers` table)；
- MovementType = `TRANSFER_OUT`；
- `inventory_transactions` source_type = `OUTSOURCING_MATERIAL_ISSUE`；
- `supplier_wip_position` 由 `outsourcing_material_positions` 派生 view 计算（不写库存 truth）；
- LOT/SERIAL provenance：所有 identity 走 canonical `source_tracking_allocations` / `save_tracked_allocations`；
- Returns 反向：movementType=`TRANSFER_IN`。

#### Ownership Invariant

- `OWNER = ENTERPRISE`；`PHYSICAL LOCATION = Supplier WIP Warehouse`；
- **不得**复用 VMI ownership semantics；
- **不得**建立 second owner ledger；
- 缺 `supplier_wip_warehouse_id` → 409 fail closed。

#### Backflush (OUT-16) — Per Material Line Cumulative Model (Single Truth)

**Design 决策 (final)**：backflush 必须按 **Outsourcing Material List Item** 单独计算。**禁止**对不同 material line 跨物料 SUM 形成 authoritative backflush quantity — 不同物料有不同 UOM / different scale，跨 SUM 会产生跨 UOM 数字（PCS + KG 数值相加），违反 business invariant。

**Canonical formula — Per Material Line i**（rational quantity math via `rational()` from `commercial-golive.js`）：

```text
For each Material List Item i (one row in outsourcing_material_list_items
                                 scoped by outsourcing_order_id + component_product_id
                                 + lot_id (where applicable) + serial_id (where applicable)):

  # Snapshot taken from frozen Outsourcing Material List/BOM execution snapshot:
  material_required_qty_i   # snapshot frozen, NOT re-derived from current Master BOM
                             # already encodes: BOM qty * order qty + scrap rule
                             # source of truth: outsourcing_material_list_items.required_qty_i

  order_snapshot_qty        = outsourcing_orders.required_qty   # frozen at order confirm

  # Net supplied to Supplier WIP for this line (cumulative, per-line)
  net_supplied_qty_i
    = issued_qty_i
    + supplemented_qty_i
    - returned_qty_i

  # Already-backflushed for THIS LINE (cumulative)
  already_backflushed_qty_i
    = sum(inventory_valuation_movements.quantity_delta.abs
          WHERE source_type='OUTSOURCING_BACKFLUSH'
            AND source_outsourcing_order_id = order_id
            AND source_material_list_item_id = i.id
            AND (lot_id = i.lot_id OR (i.lot_id IS NULL AND lot_id IS NULL))
            AND (serial_id = i.serial_id OR (i.serial_id IS NULL AND serial_id IS NULL)))

  # Cumulative finished receipt qty (only confirmed Outsourcing Receipt)
  cumulative_finished_receipt_qty
    = sum(outsourcing_receipt_items.quantity
          WHERE outsourcing_order_id = order_id
            AND outsourcing_receipt.status = 'CONFIRMED')

  # Target cumulative consumption for THIS LINE
  # = material_required_qty_i * (cumulative_finished_receipt_qty / order_snapshot_qty)
  target_cumulative_consumption_i
    = material_required_qty_i
      × (cumulative_finished_receipt_qty / order_snapshot_qty)
    # exact rational math (no floating point)

  # Incremental backflush for THIS LINE for THIS receipt
  incremental_backflush_i
    = target_cumulative_consumption_i - already_backflushed_qty_i

  # Guards (FAIL CLOSED if any violation):
  assert incremental_backflush_i >= 0
  assert incremental_backflush_i <= (net_supplied_qty_i - already_backflushed_qty_i)
```

**Per-line isolation invariants**：

- 不同 material line 之间 **不**交叉 SUM；
- 不同 `outsourcing_order` 之间 **不**共享 inventory；
- 同 material + 不同 lot/serial 视为不同 line；identity preserved end-to-end via canonical `source_tracking_allocations`；
- 任何 cross-line SUM / aggregate-only-over-multi-material → 视为 owner 漂移 → 拒绝。

#### Scrap / Requirement Snapshot

`material_required_qty_i` 来自 **frozen Outsourcing Material List execution snapshot**（`outsourcing_material_lists.version`）；已 encode BOM qty × order qty × scrap rule；**Backflush 阶段禁止重新读取 Master BOM 重算**。

#### Supplier WIP Remaining — Derived Per Line (NOT input)

```text
supplier_wip_remaining_qty_i
  = issued_qty_i
  + supplemented_qty_i
  - returned_qty_i
  - backflushed_qty_i
```

`supplier_wip_remaining_qty_i` 是 derived execution state，**不**作为 backflush 数学的输入。所有下列页面 / 模块必须消费同一 view（隔离 per line / per lot / per serial）：

- Outsourcing Detail (Material Position widget)；
- Material Execution (Issue / Supplement / Return screens)；
- Procurement Reports (Outsourcing Material Issue Summary)；
- Difference Allocation (Period Close)；
- WIP Transfer (Source/Target position updates)。

任何模块重算此派生 → owner 漂移 → 拒绝。

#### Multiple Material Example (mandatory — 跨 UOM 不可加)

```text
Order finished qty = 100 FG

Material A: required = 2 PCS/unit    → material_required_qty_A = 200 PCS
Material B: required = 0.5 KG/unit   → material_required_qty_B = 50 KG

Confirmed finished qty = 30 FG
cumulative_finished_receipt_qty = 30
order_snapshot_qty = 100

target_cumulative_A = 200 × (30 / 100) = 60 PCS
target_cumulative_B = 50  × (30 / 100) = 15 KG

# Each line computed independently — NEVER:
#   (200 + 50) × 30 / 100  = 75 "unit"   # 跨 UOM 数字 — INVALID
```

#### Multi-Receipt Example (mandatory — 增量回冲)

```text
Order finished qty                = 100
Material A: material_required_qty_A = 200 PCS
order_snapshot_qty              = 100

Receipt 1 confirmed = 30
  cumulative_finished_receipt_qty  = 30
  target_cumulative_A              = 60 PCS
  already_backflushed_A            = 0
  incremental_backflush_A           = 60 PCS

Receipt 2 confirmed = 20
  cumulative_finished_receipt_qty  = 50
  target_cumulative_A              = 100 PCS
  already_backflushed_A            = 60
  incremental_backflush_A           = 40 PCS
```

Receipt 不可重新 backflush 整个 order requirement — 否则 supplier-WIP 出现负数、跨订单污染、material carrying value 失真。

#### Supplement Example (per-line)

```text
required_cumulative_A             = 10
issued_A                          = 10
supplemented_A                    = 2
returned_A                        = 1
already_backflushed_A             = 8

net_supplied_A                    = 10 + 2 - 1 = 11
available_for_further_consumption_A = 11 - 8 = 3

# New target cumulative becomes 10
incremental_backflush_A           = 10 - 8 = 2
supplier_wip_remaining_after_A    = 11 - 8 - 2 = 1
```

Supplement 已正确纳入；supplier-WIP 剩余 1 PCS 留待后续 Receipt / WIP Transfer / Period Difference 处理。

#### Failure Behavior

- 任何 guard 失败 → `HttpError(409, 'BACKFLUSH_INSUFFICIENT_SUPPLY' / 'BACKFLUSH_TARGET_MISMATCH')`；
- **不**从其它 Outsourcing Order / 其它 material line 偷 material；
- **不**写入 raw inventory UPDATE；只通过 canonical `server/lib/stock.js::adjustInventory` + `financial-inventory.js::issueValue`；
- Audit：`'BACKFLUSH', 'OUTSOURCING_ORDER', orderId, receipt_id, material_list_item_id, incremental_cents, material_consumed_value_cents`；
- Idempotency key = `OUTSOURCING_BACKFLUSH:{outsourcing_receipt_id}`；二次调用返回同 effect 不重复扣减。

#### LOT / SERIAL (OUT-15)

- Issue identity 写入 supplier site；
- Return identity 必须同 provenance；
- Backflush 必须按 order-held identity；
- Serial 不得跨 Outsourcing Order 重复消费。

### 26.20 Outsourcing Receiving / Finance Handoff (OUT-17~OUT-23)

#### Tables

- `outsourcing_completion_notices(id, notice_no, outsourcing_order_id, processing_po_id, supplier_id, expected_date, status('DRAFT'|'POSTED'|'CANCELLED'), business_date)`；
- `outsourcing_completion_notice_items(id, notice_id, product_id, planned_qty_num, planned_qty_den, planned_lot_id NULL, planned_serial_id NULL)`；
- `outsourcing_inspections(id, inspection_no, outsourcing_receipt_id, source_type, source_id, policy_snapshot_json, status('DRAFT'|'PASS'|'FAIL'|'WAIVED'), inspected_by, inspected_at)`；
- `outsourcing_receipts(id, receipt_no, outsourcing_order_id, supplier_id, warehouse_id, business_date, status('DRAFT'|'CONFIRMED'|'CANCELLED'), source_notice_id, completion_inspection_id, created_by, version)`；
- `outsourcing_receipt_items(id, outsourcing_receipt_id, product_id, lot_id, serial_id, quantity_num, quantity_den, line_no)`；
- `outsourcing_cost_evidences(id, outsourcing_receipt_id, processing_po_id, material_consumed_value_cents, processing_fee_provisional_cents, processing_fee_actual_cents NULL, variance_cents NULL, basis_status('PROVISIONAL'|'FINAL'), calculated_at)`；
- `outsourcing_finished_returns(id, return_no, outsourcing_receipt_id, business_date, status, reason_code)`；
- `outsourcing_finished_return_items(id, return_id, product_id, lot_id, serial_id, quantity_num, quantity_den)`；
- `outsourcing_wip_transfers(id, transfer_no, source_outsourcing_order_id, target_outsourcing_order_id, product_id, quantity_num, quantity_den, business_date)`；
- `outsourcing_period_closings(period_key, frozen_at, summary_json)`；
- `outsourcing_period_opening_records(id, outsourcing_order_id, opening_remaining_qty_num, opening_remaining_qty_den, opening_supplier_wip_qty_num, opening_supplier_wip_qty_den, opening_processing_fee_cents, marked_OPENING, created_at)`。

#### Completion Receipt Notice (OUT-17)

- 不影响 inventory / valuation / GRNI / AP；
- 复用 Receipt Notice infrastructure（business_type='OUTSOURCE' additive）；
- Source: Outsourcing Order + Processing PO。

#### Outsourcing Inspection (OUT-18)

- 扩展 IQC source-type `OUTSOURCING_RECEIPT`；
- Policy snapshot 走既有 `freezeQualityPolicy`；
- PASS / FAIL / WAIVED；
- Stale detection：inspection date < receipt confirm date → 409。

#### Outsourcing Inbound (OUT-19)

`outsourcing-receiving.js::confirmOutsourcingReceipt(db, {receiptId, actor})` — atomic：

1. Validate: order remaining > 0; quality gate (PASS or WAIVED);
2. **Validate processing PO required `business_type='OUTSOURCE_PROCESSING'`** + `purchase_orders.source_outsourcing_order_id = outsourcing_order.id`；不兼容 → 409（cross-order processing-fee source 阻断）；
3. Validate processing PO line（每 receipt item 必须 trace 到 processing PO line eligible qty，且该 receipt_item `outsourcing_order_id = order.id`）；
4. Backflush materials (call §26.19 Backflush cumulative model);
5. Capture material consumed value via `issueValue` (canonical) → `outsourcing_cost_evidences.material_consumed_value_cents`；
6. Recognize finished inventory: `receiveValue(product_id, warehouse_id, quantity, value_cents=0)` — finished material value 不来自 BOM 标准价，来自 consumed carrying value；
7. Update Outsourcing Order `received_qty` / status：`RELEASED → COMPLETED` (when cumulative finished receipt qty == order.required_qty — 注意是 **cumulative** 而非 single receipt condition);
8. Cost evidence provisional row (basis_status='PROVISIONAL');
9. Schedule processing fee AP bill trigger（idempotent，详见 §26.20 OUT-20）；
10. **Not** Finance — Finance boundary consumes cost evidence for final valuation adjustment.

Processing Fee AP (OUT-20) — Source Cardinality Final (Single Truth)

**Design 决策**：Source relationship belongs at **`supplier_bill_items`**，**不**在 header。Header 没有 authoritative single Receipt FK — 一个 Supplier Bill 可以包含多个 Outsourcing Receipt Items 与 / 或多个 Purchase Receipt Items（兼容）。

**Canonical source identity (generic, item-level)**：

```text
supplier_bill_items
  commercial_source_type        ∈ {PURCHASE_RECEIPT_ITEM, OUTSOURCING_RECEIPT_ITEM, ...}
  commercial_source_id           -- header-level source FK (e.g. receipt_id)
  commercial_source_item_id      -- item-level source FK (e.g. receipt_item_id)  [CANONICAL]
```

Legacy compatibility columns may coexist for existing `purchase_receipt_item_id` FK; **authoritative canonical source identity = `commercial_source_*` trio above**. Legacy-specific FK 列 **不**作为 authoritative rule，不与 `commercial_source_*` 双写 / 双改 — 写入时由 canonical 列驱动 legacy 列做一次性同步（迁移期兼容），读取时只信任 canonical。

**Forbidden designs (must NOT be reintroduced)**：

- ❌ Header-level `supplier_bills.source_outsourcing_receipt_id` FK — 已被移除（multi-receipt 1:1 假设不成立）；
- ❌ 任何 supplier_bill_items `source_type + source_outsourcing_receipt_item_id` UNIQUE（含 partial / conditional variants）— supplier_bill_items.index 不能引用 supplier_bills.status，MySQL 无 portable equivalent，且会错误禁止 partial billing；
- ❌ 任何 `UNIQUE(receipt_item_id)` 替代 partial billing 限制 — 会禁止 partial billing。

#### Processing Fee Partial Billing (canonical)

一个 confirmed Outsourcing Receipt Item **允许** partial bill 多次：

```text
Receipt Item qty = 100

Bill A = 30
Bill B = 20
Bill C = 50
```

只要累计：

```text
SUM(active_billable_reservation_qty for same commercial_source_item_id)
<= eligible_processing_qty
```

无 multi-status column，否则两个 DRAFT 并发各吃完整余量会导致双计。

#### Canonical Billable Quantity Calculation

```text
eligible_processing_qty
  = outsourcing_receipt_items.quantity  (confirmed receipt, source-receipt_item scoped)
    - sum(outsourcing_return_items.confirmed_qty
          WHERE source_outsourcing_receipt_item_id = receipt_item.id
            AND return.status = 'CONFIRMED')
    - any other source-scoped reduction by canonical Finance lifecycle

already_billed_reserved_qty
  = sum(supplier_bill_items.quantity
        WHERE commercial_source_type = 'OUTSOURCING_RECEIPT_ITEM'
          AND commercial_source_item_id = receipt_item.id
          AND bill.status IN ('DRAFT', 'WAITING_MATCH', 'POSTED'))
  # canonical billable reservation statuses = {DRAFT, WAITING_MATCH, POSTED}
  # CANCELLED / REVERSED are NOT counted (released by Finance lifecycle)

remaining_billable_qty
  = eligible_processing_qty - already_billed_reserved_qty

assert requested_qty <= remaining_billable_qty
```

**Why these statuses**: `DRAFT` reserves the qty to prevent two parallel drafts each consuming the full remaining; `WAITING_MATCH` blocks posting-stage double consume; `POSTED` blocks any further bill. `CANCELLED` / `REVERSED` release the reservation per canonical Finance lifecycle.

#### Multi-Receipt Supplier Bill (canonical)

```text
Outsourcing Receipt A item  ──┐
Outsourcing Receipt B item  ──┼─→  one Supplier Bill
Outsourcing Receipt C item  ──┘

约束：
  - 同一 supplier_id
  - 同一 payable 商业上下文（currency, payment_terms_days）
  - 每 line.commercial_source_type ∈ {PURCHASE_RECEIPT_ITEM, OUTSOURCING_RECEIPT_ITEM}
  - 不得 header-level 单 receipt FK 限制 cardinality
  - 不得 cross-PO line 跨 commercial context 混开
  - 不允许 OUTSOURCING 与 STANDARD source 在同一 supplier_bill_item 中混存（line 必须单一 source_type）
```

#### Supplier Bill Transaction (OUTSOURCE source)

Reuse existing `transaction(db, work)` helper (`BEGIN IMMEDIATE` / MySQL transaction gate + row lock + retry). **No new transaction layer.**

```text
BEGIN

lock outsourcing_receipt_items rows WHERE id IN (item_ids) FOR UPDATE

for each item:
  assert receipt.status = 'CONFIRMED'
  assert supplier compatible
  assert processing PO compatible
  assert processing PO.source_outsourcing_order_id = outsourcing_order.id

  read eligible_qty                       (per formula above)
  read already_billed_reserved_qty         (sum over {DRAFT, WAITING_MATCH, POSTED})

  remaining = eligible - already_billed_reserved

  assert requested_processing_qty <= remaining
  else 409 (OVERBILLING)

  insert supplier_bill_items rows
    commercial_source_type        = 'OUTSOURCING_RECEIPT_ITEM'
    commercial_source_id           = receipt.id
    commercial_source_item_id      = item.id
    quantity                       = requested_processing_qty
    (additive audit: source_outsourcing_receipt_item_id, source_outsourcing_po_line_id)

  post via canonical createSupplierBill + ensurePayableSource + applyCreditAdjustment
  (reuse commercial-golive.js / settlement-core.js)

COMMIT
```

SQLite: reuse `transaction(db, work)` + `BEGIN IMMEDIATE` + `WHERE commercial_source_item_id = ?` re-read SUM.
MySQL: reuse transaction gate + `SELECT ... FOR UPDATE` on `outsourcing_receipt_items` row + re-read SUM + retry mechanism.

**Idempotency**: continue reusing existing canonical `saveIdempotency` (`commercial-golive.js`). Processing-fee source key (repo-consistent): `PROCESSING_FEE_BILL:{outsourcing_receipt_item_id}:{quantity}:{fingerprint}`. **不**用 `UNIQUE(receipt_item_id)` 替代 idempotency。

**Receipt-confirm → automatic bill trigger**：

- `confirmOutsourcingReceipt` 完成 → 注册一个 **NOT a synchronous** step；调用 `createProcessingFeeBill({outsourcingReceiptId})` 单事务；
- 同一 receipt confirm 期间不会重复触发（idempotency_key）。

**Invariant**：

- 一个 Supplier Bill 可包含多个 receipt_items；
- 一个 receipt_item 可被多张 Supplier Bill lines 引用（partial billing allowed），累计 active reservation <= eligible；
- 不允许 header-level receipt FK 制造 1:1 假设；
- 不允许 OUTSOURCING source 与 STANDARD purchase source 在同一 `supplier_bill_item` 中混存（line 必须单一）。

#### Finished Return (OUT-22)

- Source: confirmed Outsourcing Receipt；
- Quantity cap = `received_qty - already_returned_qty`；
- 调用 canonical inventory reversal；
- Processing fee / billability handoff 走 canonical `applyCreditAdjustment`；
- **不得**套普通 Purchase Return 的 price semantics（material carrying value 不来自采购价）。

#### Cost Evidence (OUT-21)

`outsourcing-receiving.js::computeCostEvidence(db, {outsourcingReceiptId})`:

- `material_consumed_value_cents` = sum(`inventory_valuation_movements.value_delta_cents` WHERE `source_type='OUTSOURCING_BACKFLUSH'` AND source_id 关联 receipt) — **actual consumed carrying value**；
- 排除 `issued but unused` / `returned` / `supplier-WIP remaining`；
- `processing_fee_provisional_cents` = `processing_po_line.unit_price_cents * received_qty`；
- `processing_fee_actual_cents` = canonical Supplier Bill item `amount_cents` after onboarding；
- `variance_cents` = `processing_fee_actual - processing_fee_provisional`；
- `basis_status='PROVISIONAL'` 直到 final bill POSTED → `FINAL`；
- Finance boundary：final valuation adjustment + variance allocation + month-end costing + accounting voucher — Finance owner owns.

#### Period / WIP / Opening / Reports (OUT-23)

`outsourcing-receiving.js::closeOutsourcingPeriod(db, {period_key, actor})`:

- backflush difference allocation: 实际盘点 supplier WIP vs required - issued - returned → preview → allocate → apply；preview 提供 per-order preview；apply 单事务；generated supplement/return 标记 `system_source='PERIOD_DIFFERENCE'`；
- supplier material balance per agreement per period；
- WIP transfer: source outsourcing order → transit → target outsourcing order；canonical inventory movement；ownership 不变；
- opening: opening records 标记 `OPENING`，不得虚构历史 voucher；
- execution summary / material issue summary / detail reports 复用 §26.21 read model。

### 26.21 Canonical Read Models

`procurement-read-models.js`（NEW）— 单一动态 read model，不允许 per-report 重算：

```text
procurementReadModel({from, to, schemeId, supplierId, productId, businessType?}):
  # PO events (BUY 视角):仅包含 purchase_orders.business_type = 'STANDARD_PURCHASE'
  PO events (STANDARD_PURCHASE only):
    ordered    = sum(po_line.quantity
                     WHERE po.business_type = 'STANDARD_PURCHASE'
                       AND po.status IN ('APPROVED','PARTIALLY_RECEIVED','FULFILLED'))
    notified   = sum(receipt_notice_items.planned_qty
                      JOIN po_line ON po_line.id = receipt_notice_items.po_line_id
                      WHERE po.business_type = 'STANDARD_PURCHASE')
    received   = sum(purchase_receipt_items.confirmed_qty
                      JOIN po_line ON po_line.id = purchase_receipt_items.po_line_id
                      WHERE po.business_type = 'STANDARD_PURCHASE'
                        AND purchase_receipt.status = 'CONFIRMED')
    returned   = sum(purchase_return_items.confirmed_qty
                      JOIN purchase_receipt_items ON ...
                      JOIN po_line ON ...
                      WHERE po.business_type = 'STANDARD_PURCHASE')
    open       = ordered - received - returned
    billing    = AP open_amount (linked to receipt) - credit adjustments
    on_time    = received.expected_date vs po.expected_delivery_date

  outsourcingReadModel({from, to, supplierId, productId}):
    order_qty          = order.required_qty
    processing_po_qty  = po_line.quantity WHERE po.business_type='OUTSOURCE_PROCESSING'
                                            AND po.source_outsourcing_order_id = order.id
    received_qty       = sum(outsourcing_receipt_items.quantity WHERE receipt.status='CONFIRMED')
    # Per material line (NOT cross-material SUM):
    material_required_per_line  = outsourcing_material_list_items.required_qty_i
    issued_per_line             = sum(issue_items.qty WHERE material_list_item_id = i.id)
    supplemented_per_line       = sum(supplement_items.qty WHERE material_list_item_id = i.id)
    returned_per_line           = sum(return_items.qty WHERE material_list_item_id = i.id)
    backflushed_per_line        = sum(backflush_movements.qty WHERE source_material_list_item_id = i.id)
    supplier_wip_remaining_per_line  # DERIVED — see §26.19
      = issued_per_line + supplemented_per_line - returned_per_line - backflushed_per_line
    processing_fee     = cost_evidence.processing_fee_actual_cents
    cost_value         = cost_evidence.material_consumed_value_cents
```

**OUTSOURCE_PROCESSING 隔离**：MRP Purchase Supply / Planner Workbench Purchase Supply / Reservation Purchase Supply — 全部必须显式 `WHERE po.business_type='STANDARD_PURCHASE'`。OUTSOURCE_PROCESSING PO **不**进入 BUY supply、不进入 procurement reports 的 BUY 视图、不被 Reservation 视为 eligible supply。

**Supplier WIP Remaining** 由 §26.19 单一 view 派生；本 read model 不得重算。

API endpoints reuse the single service.

### 26.22 RBAC / Audit / Errors

新增最小独立 permission 家族（back-end fail closed；最小化 privilege migration + 保留 legacy role 行为）：

- `PROCUREMENT_CONFIG_VIEW` / `PROCUREMENT_CONFIG_MANAGE`：Parameters / Supplier profile / Buyer / Purchasing Group；
- `SOURCING_VIEW` / `SOURCING_MANAGE`：Source List / Quota / Sourcing Decision / Override；
- `PRICING_VIEW` / `PRICING_MANAGE`：Price List / Pricing Discount / Price Adjustment / resolve；
- `PO_CHANGE_VIEW` / `PO_CHANGE_MANAGE`：PO Change apply；
- `RECEIPT_NOTICE_VIEW` / `RECEIPT_NOTICE_MANAGE`：Receipt Notice create / confirm；
- `RETURN_REQUEST_VIEW` / `RETURN_REQUEST_MANAGE`：Return Request create / post（**新增**独立 workflow 权限；
  Purchase Return 自身继续复用既有 `RETURNS_VIEW` / `RETURNS_MANAGE`，**不**新建 `PURCHASE_RETURN_*` family）；
- `VMI_VIEW` / `VMI_MANAGE`：VMI Policy / Receipt / Consumption / Summary / Ownership Transfer；
- `OUTSOURCING_VIEW` / `OUTSOURCING_MANAGE`：Outsourcing Order create / lifecycle；
- `OUTSOURCING_RELEASE`：Outsourcing Order release / complete / close；
- `OUTSOURCING_MATERIAL_EXECUTE`：Issue / Supplement / Return / Backflush；
- `OUTSOURCING_RECEIVING_VIEW` / `OUTSOURCING_RECEIVING_MANAGE`：Completion Notice / Inspection / Receipt / Return；
- `PROCUREMENT_SCAN_EXECUTE`：Procurement Scan 工作面。

兼容：保留既有 `SUPPLIERS_*` / `PURCHASE_REQUISITION_*` / `PURCHASE_ORDERS_*` / `PURCHASE_RECEIPTS_*` / **`RETURNS_VIEW` / `RETURNS_MANAGE`** / `IQC_*` / `AP_*` / `PURCHASE_DISCOUNT_*`；admin 继承；其余角色保持现状。**Purchase Return confirm 4-branch 继续使用 `RETURNS_MANAGE`** — 不新建 `PURCHASE_RETURN_*`，保持权限迁移最小化。

Audit：

- Procurement Parameters / Profile / Buyer / Purchasing Group / Source List / Quota / Sourcing Decision / Override / Price List / Pricing Discount / Price Adjustment；
- PO Change applied；
- Receipt Notice（仅 Formal Invariants，无业务副作用）；
- Purchase Return 4-branch voucher；
- VMI Agreement / Receipt / Consumption / Summary / Ownership Transfer；
- Outsourcing Order lifecycle / BOM snapshot / Material Position update；
- **Planning Handoff Consumption**（含 `target_outsourcing_order_id` 链接）；
- Backflush（含 cumulative target + incremental + idempotency_key）；
- WIP Transfer / Difference Allocation；
- Cost Evidence provisional → final transition；
- Processing Fee Bill（含 source-item 维度 link）。

Errors：400 validation；403 permission；404 missing；409 state / overlap / capacity / stale / not-allowed / `PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE` / `BACKFLUSH_INSUFFICIENT_SUPPLY` / `BACKFLUSH_TARGET_MISMATCH` / `HANDOFF_ALREADY_CONSUMED` / `OVERBILLING`；500 unexpected。锁失败 / deadlock 不吞。

### 26.23 Frontend Information Architecture

Mobile-first 设计目标基线 390 CSS px；同步覆盖 320 / 430 / 680；`document.scrollWidth <= clientWidth + 1`；0 hit-target < 44px；0 非资产 browser error。

> **Design-phase 状态**：本节定义 IA 与响应式设计目标；**实际 functional browser verification 必须等到 Implementation / Acceptance 阶段**。本节**不**声称 Design 阶段已完成 320 / 390 / 430 / 680 真实浏览器验收。
>
> **Design targets**：320 / 390 (primary) / 430 / 680。
> **Actual functional browser verification**：Implementation / Acceptance phase mandatory。

Launcher（8 Domain 严格不变；本 Domain 不爆炸）：Procurement & Outsourcing Group → 7 项：

```text
Suppliers
Purchase Requisitions
Sourcing & Pricing
Purchase Orders
Receiving
Purchase Returns
Outsourcing
```

PO Change / Receipt Notice / Return Request / Procurement Scan：作为 PO / Receiving / Returns 详情的 contextual action 或 workspace sheet；不新增一级 launcher。

VMI：作为 Supplier Detail 或 Receiving Workspace 的 VMI 子工作面（operator task：查 agreement、记 consumption、跑 settlement）。

Outsourcing Materials / Outsourcing Receiving / Backflush：作为 Outsourcing Order Detail 的 contextual surface。

#### Sourcing & Pricing UX

`PR → eligible suppliers → quota → price → allocation → blocker/override → preview PO → apply`；primary action 唯一（Apply）；override 必须 permission + reason。

#### PO UX

PO Detail 顺序：Identity / Lifecycle / Commercial Terms / Source / Schedules / Pricing / Change History / Receiving / Returns / Billing / Trace。PO Change：contextual action。`business_type` 视觉标记：STANDARD_PURCHASE vs OUTSOURCE_PROCESSING；下游 Reports 视图按 business_type 隔离。

#### Receiving UX

统一 `Receipt Notice → IQC → Receipt` 视觉链；明确 `Receipt Notice ≠ Inventory Receipt`；Receipt Notice `business_type='STANDARD_PURCHASE'` 触发 Purchase Receipt，`business_type='OUTSOURCE_PROCESSING'` 触发 Outsourcing Receipt — 永不互相漂移。

#### VMI UX

明确显示 `SUPPLIER OWNED` / `consumed` / `pending settlement` / `ownership transferred` / `billable`；physical mutation fail closed（owner dimension blocker）。

#### Outsourcing UX

`Outsourcing Order Detail` 作为 execution hub：Source / Supplier / Product / Lifecycle / BOM / Material List / Material Position（derived view）/ Issue-Supplement-Return / Processing PO / Receipt / Quality / Backflush / Processing Fee / Cost Evidence / Trace。Material Position widget 显示 `issued + supplemented - returned - backflushed = supplier_wip_remaining`。

#### Mobile widths (Design targets)

每个 workspace 320 / 390 / 430 / 680 显式设计；LIST → DETAIL → EDITOR/WORKFLOW；primary action sticky bottom on mobile；filter sheet（bottom）；dense line-item 处理（plan layout — 不依赖永久横向滚动）。

ERP Design Read: Procurement & Outsourcing daily work; primary task: source / buy / receive / return / outsource / settle; density: 8; main layout issues: mixed-owner large files, multiple owners of purchase orders / receipts / returns / bills; preserve: terminology, API/state/RBAC/source/inventory/accounting contracts.

### 26.24 Schema / Migration / MySQL Parity

#### New Tables

- `procurement_parameters`
- `buyers`、`purchasing_groups`、`buyer_memberships`
- `source_list_entries`、`source_list_versions`
- `quota_assignments`
- `sourcing_decisions`、`sourcing_decision_allocations`
- `purchase_price_list_entries`、`purchase_price_list_versions`
- `pricing_discount_schemes`（**新** Procurement Pricing Discount）
- `prepayment_requirements`
- `po_changes`、`po_change_items`
- `po_delivery_schedule`
- `receipt_notices`、`receipt_notice_items`
- `return_requests`、`return_request_items`
- `vmi_agreements`、`vmi_receipts`、`vmi_consumptions`、`vmi_consumption_summaries`、`vmi_ownership_transfers`
- `outsourcing_orders` (含 `planning_handoff_id NULLABLE UNIQUE`)、`outsourcing_order_lines`
- `outsourcing_material_lists`、`outsourcing_material_list_items`
- `outsourcing_material_issues`、`outsourcing_material_issue_items`
- `outsourcing_material_supplements`、`outsourcing_material_return_items`
- `outsourcing_completion_notices`、`outsourcing_completion_notice_items`
- `outsourcing_inspections`
- `outsourcing_receipts`、`outsourcing_receipt_items`
- `outsourcing_cost_evidences`
- `outsourcing_finished_returns`、`outsourcing_finished_return_items`
- `outsourcing_wip_transfers`
- `outsourcing_period_closings`、`outsourcing_period_opening_records`

#### Additive Columns (existing tables)

- `suppliers`：`procurement_enabled / outsourcing_enabled / supplier_category / qualification_status / qualification_valid_from / qualification_valid_to / default_payment_terms_days / default_currency / supplier_wip_warehouse_id / outsourcing_qualification_note`
- `purchase_orders`：`business_type ('STANDARD_PURCHASE'|'OUTSOURCE_PROCESSING') NOT NULL DEFAULT 'STANDARD_PURCHASE'` / `source_outsourcing_order_id NULLABLE` / `is_gift_default` / `pricing_discount_scheme_id` / `price_source` / `discount_source` / `buyer_id` / `purchasing_group_id` / `settlement_supplier_id` / `payee_supplier_id` / `delivery_schedule_fingerprint`
- `purchase_order_items`：`is_gift_line / pricing_discount_scheme_id / source_price_list_version / schedule_id_default`
- `purchase_receipts`：`source_notice_id / delivery_schedule_id / po_change_id`
- `purchase_returns`：`return_request_id / billing_mode_branch / billed_quantity / unbilled_quantity`
- `receipt_notices`：`business_type ('STANDARD_PURCHASE'|'OUTSOURCE_PROCESSING') NOT NULL DEFAULT 'STANDARD_PURCHASE'`
- `supplier_bills`：**不**新增 header-level `source_outsourcing_receipt_id` FK；header 维持单一 supplier_id + 商业上下文；保留既有列；新增 `commercial_context_json`（contract snapshot，仅 audit）
- `supplier_bill_items`：通用源字段 `source_type` / `source_id` / `source_item_id`（兼容既有 `purchase_receipt_item_id` FK 列）；additive 列 `source_outsourcing_receipt_item_id NULL` + `source_outsourcing_po_line_id NULL`（仅当 `source_type='OUTSOURCING_RECEIPT_ITEM'` 时 non-null）；additive audit 列 `source_outsourcing_receipt_id`
- `warehouses`：`supplier_id NULL` / `is_supplier_wip INTEGER NOT NULL DEFAULT 0` / `outsourcing_use_only INTEGER NOT NULL DEFAULT 0`
- `product_uom_conversions`：保留（无需新增）
- `tax_codes`：保留（无需新增）
- `planning_outsource_handoffs`：保留；新增列 `status ('PENDING'|'CONSUMED')`、`target_outsourcing_order_id NULLABLE` (FK)、`consumed_at`、`consumed_by`

#### Indexes / Unique Constraints

- UNIQUE `procurement_parameters(id='DEFAULT')` — singleton；
- UNIQUE `buyer_memberships(buyer_id, purchasing_group_id)`；
- UNIQUE `source_list_entries(supplier_id, product_id, source_type, version)`；
- UNIQUE `quota_assignments(supplier_id, product_id, source_type, version)`；
- UNIQUE `sourcing_decision_allocations(decision_id, source_list_entry_id)`；
- UNIQUE `purchase_price_list_entries(supplier_id, product_id, source_type, pricing_uom_code, version)`；
- UNIQUE `pricing_discount_schemes(supplier_id, product_id, source_type, version)`；
- UNIQUE `po_delivery_schedule(po_line_id, sequence_no)`；
- UNIQUE `receipt_notice_items(notice_id, po_line_id)`；
- UNIQUE `return_request_items(request_id, source_line_id)`；
- **UNIQUE `outsourcing_orders(planning_handoff_id)`** — canonical exactly-once；
- UNIQUE `outsourcing_orders(outsourcing_no)`；
- UNIQUE `outsourcing_material_lists(outsourcing_order_id, version)`；
- UNIQUE `outsourcing_receipts(outsourcing_no)`；
- INDEX `supplier_bill_items(commercial_source_type, commercial_source_item_id, bill_status)` — 支持 billable reservation SUM 查询（不强制 UNIQUE，因为 partial billing 是合法的；详见 §26.20）；
- INDEX `outsourcing_receipt_items(outsourcing_order_id)` / `outsourcing_material_list_items(outsourcing_order_id, line_no)` / `outsourcing_cost_evidences(outsourcing_receipt_id)` / `planning_outsource_handoffs(status, target_outsourcing_order_id)` / `purchase_orders(business_type)` / `receipt_notices(business_type)` / `vmi_agreements(supplier_id, warehouse_id, product_id, business_date_start)` / `vmi_consumptions(agreement_id, business_date)`。

#### SQLite / MySQL parity

- 所有 migration additive；`CREATE TABLE/INDEX IF NOT EXISTS`；缺列才 add；
- `safeAddColumn` 模式（参考 `engineering-reference-schema.js`）；
- `readMySqlColumnNames` + `readMySqlIndexNames` 复用 §23.15 root cause fix；禁止 driver-native casing 依赖；
- `ALTER TABLE` 重复 idempotent try/catch；
- Snapshot table（`purchase_price_list_versions` / `source_list_versions` / `outsourcing_material_lists`）使用 structured row（不依赖 generic JSON blob）；
- id generation 一律 `randomUUID()` / `genId()`（不混用 driver-native IDENTITY）；
- canonical SQLite snapshot 保持与 MySQL reconciliation 一致；
- 不 DROP legacy table（`purchase_orders` / `purchase_order_items` / `purchase_receipts` / `purchase_returns` / `purchase_discounts` / `planning_outsource_handoffs` 等）。

### 26.25 Transaction / Concurrency / Idempotency

| Operation | Lock Rows | Validate | Write | Side Effects | Commit |
|---|---|---|---|---|---|
| Sourcing apply | PR line + source_list_entry rows + quota_assignment rows | effectivity / qualification / quantity conservation | sourcing_decision + allocations + PR remaining update | none | yes |
| PR→PO convert | PR line + PO line drafts | remaining / pricing / source | PR conversion log + PO draft + PO line items | none | yes |
| PO Change apply | PO line + po_changes row + po_change_items + po_delivery_schedule | not-below-received + commercial | po_changes APPLIED + PO line update + audit | PO snapshot frozen | yes |
| Receipt Notice convert | Notice + Notice items + PO line (schedule if applicable) | not-exceed-notified-remaining | notice status POSTED | none (no inventory/GRNI/AP) | yes |
| Receipt confirm | PO line + receipt_notice_id + po_delivery_schedule + receipt_items | billing mode + remaining + commercial + IQC | receipt POSTED + inventory + valuation + GRNI/AP | inventory/valuation/GRNI/AP per chain | yes |
| Return Request post | source line | source existence + quantity cap | return_requests POSTED | none | yes |
| Purchase Return 4-branch confirm | return header + receipt + supplier_bill_items | billing mode + billed_qty + split | return POSTED + 1-2 vouchers (GRNI/AP) + AP credit + inventory reversal | inventory/valuation/GRNI/AP | yes |
| VMI Receipt confirm | agreement + supplier_id | agreement active + supplier qualified + qty | vmi_receipts POSTED + call `receiveOwnedStock(SUPPLIER)` | owner-dim physical | yes |
| VMI Consumption confirm | agreement + supplier_id + source id | activity + qty | vmi_consumptions POSTED + call `consumeOwnedStock(SUPPLIER)` | owner-dim physical | yes |
| VMI Ownership Transfer confirm | agreement + supplier_id + source qty | pending qty + supplier_bill source status | billing | owner-dim physical + AP credit | yes |
| Planning OUTSOURCE handoff consume | handoff row (`SELECT ... FOR UPDATE`) | status PENDING + no existing `outsourcing_orders.planning_handoff_id = handoff.id` | handoff status='CONSUMED' + handoff.target_outsourcing_order_id = new_order.id + new order DRAFT (planning_handoff_id = handoff.id) | none | yes |
| Outsourcing Material Issue confirm | material_list_id + supplier_wip_warehouse_id + supplier_id | material list frozen + position + LOT/SERIAL | issue POSTED + inventory transfer + position update | inventory (location only) | yes |
| Outsourcing Material Supplement confirm | material_list_id | frozen + reason + qty | supplement POSTED + inventory transfer | inventory (location) | yes |
| Outsourcing Material Return confirm | material_list_id + supplier_id + LOT/SERIAL provenance | not-exceed-issued + provenance | return POSTED + inventory reverse transfer | inventory (location) | yes |
| Outsourcing Backflush (cumulative) | outsourcing_receipt_items + inventory_valuation_movements (read) | incremental_backflush >= 0 AND <= (net_supplied - already_backflushed) | `OUTSOURCING_BACKFLUSH` valuation movements (Supplier WIP → Internal) + cost_evidence row | inventory carrying value transfer | yes |
| Outsourcing Receipt confirm | order + processing_po + quality gate + supplier_id | order remaining + quality + processing PO business_type='OUTSOURCE_PROCESSING' + source_outsourcing_order_id = order.id | receipt POSTED + backflush + cost evidence + finished inventory | inventory + AP extension trigger | yes |
| Processing Fee Bill confirm | outsourcing_receipt_items (lock) | not-double-bill + cumulative billable qty check | supplier_bill_items source link (`source_type='OUTSOURCING_RECEIPT_ITEM'`) + supplier_bill POSTED + AP open item + cost evidence final | AP + cost evidence FINAL | yes |
| Standard Purchase Receipt confirm (re-affirmed) | purchase_orders | `business_type='STANDARD_PURCHASE'` else 409 FAIL CLOSED | receipt POSTED + inventory + valuation + GRNI/AP | inventory/valuation/GRNI/AP | yes |
| Backflush difference allocation preview | source agreement + period | qty conservation | preview_json + hash | none | preview only |
| Backflush difference allocation apply | source + period | hash match + qty conservation + system source | generated supplement/return rows + period summary | inventory (location) | yes |
| Outsourcing WIP Transfer confirm | source order + target order + LOT/SERIAL | source order position + target order compatible | transfer POSTED + inventory transfer + positions | inventory (location) | yes |
| Outsourcing Period Close | period | all orders within period + no pending transfer | period_closings frozen | none | yes |

Idempotency keys (UNIQUE on (source_type, idempotency_key))：

- `PURCHASE_RECEIPT_CONFIRM`
- `PURCHASE_RETURN_CONFIRM`
- `VMI_RECEIPT_CONFIRM`
- `VMI_CONSUMPTION_CONFIRM`
- `VMI_OWNERSHIP_TRANSFER_CONFIRM`
- `OUTSOURCING_PLANNING_HANDOFF_CONSUME`
- `OUTSOURCING_MATERIAL_ISSUE_CONFIRM`
- `OUTSOURCING_MATERIAL_SUPPLEMENT_CONFIRM`
- `OUTSOURCING_MATERIAL_RETURN_CONFIRM`
- `OUTSOURCING_RECEIPT_CONFIRM`
- `OUTSOURCING_PROCESSING_BILL_CONFIRM`
- `OUTSOURCING_WIP_TRANSFER_CONFIRM`
- `BACKFLUSH_DIFFERENCE_APPLY`

#### SQLite vs MySQL — Reuse Existing Transaction Architecture

Repository 已经具备：
- SQLite：`transaction(db, work)` helper（底层 `BEGIN IMMEDIATE`）；
- MySQL：transaction gate + `SELECT ... FOR UPDATE` row lock + retry handling；
- 通用：idempotency table + UNIQUE `(source_type, idempotency_key)`（`saveIdempotency` helper in `commercial-golive.js`）。

**Design 不引入并行 transaction system**。所有 Procurement & Outsourcing mutation 必须直接复用以上 helper；不允许 `BEGIN ... COMMIT` 裸调用与新 helper 平行。

- SQLite：`transaction(db, work)` — `BEGIN IMMEDIATE` 序列化；
- MySQL：
  - `SELECT ... FOR UPDATE` row lock on source line + schedule line + receipt + notice + handoff + agreement + order + supplier_bill_items (source_outsourcing_receipt_item_id = ?) + outsourcing_receipt_items (lock-by-source);
  - `outsourcing_orders.planning_handoff_id` UNIQUE 约束 = SQLite + MySQL 双路径 same exactly-once semantics；
  - `saveIdempotency` 复用 `commercial-golive.js` helper；key = `OUTSOURCING_PLANNING_HANDOFF_CONSUME:{handoffId}` 等；
  - atomic conditional UPDATE：`UPDATE ... WHERE status=? AND version=?`，affected rows=1 才继续；
  - deadlock retry upper bound（business transaction），仍失败 → release + 409；
- 跨后端 contract：所有 `BEGIN`/`COMMIT` 都必须包在 `transaction(db, work)` 内；不允许 client-side 直连 begin/end。

### 26.26 Testing Architecture

#### Focused (per Wave)

| Wave | 测试族 | 关注点 |
|---|---|---|
| A | `procurement-parameters.test.js` / `procurement-profiles.test.js` / `buyers.test.js` | parameter CRUD + supplier profile + buyer/group + legacy null-group |
| B | `procurement-sourcing.test.js` / `procurement-pricing.test.js` | source list / quota PROPORTIONAL / pricing discount / price adjustment no-retroactive |
| C | `procurement-pr-po.test.js` / `procurement-po-change.test.js` | PR split/merge + PO commercial snapshot + PO Change guard |
| D | `procurement-receiving.test.js` / `procurement-returns.test.js` | Receipt Notice no-side-effect + Receipt confirm + Return 4-branch voucher + Return Request |
| E | `procurement-vmi.test.js` | VMI business layer + owner-dim interface mocked fail-closed |
| F | `outsourcing-order.test.js` | handoff exactly-once + OUTSOURCE BOM resolver + lifecycle |
| G | `outsourcing-materials.test.js` | Issue/Supplement/Return/Backflush + LOT/SERIAL provenance |
| H | `outsourcing-receiving.test.js` | Completion Notice + Inspection + Receipt + Processing Fee AP extension + Cost Evidence |
| I | `outsourcing-period.test.js` | backflush diff allocation + WIP transfer + opening |
| J | `procurement-frontend-contract.test.js` / `outsourcing-frontend-contract.test.js` + acceptance scripts | Registry/API contract + 320/390/430/680 responsive |

#### Canonical Gates (per Wave)

- `pnpm test:fast` + `pnpm build` + `git diff --check` (Wave 边界)；
- 跨域 / 架构 / canonical metadata：`pnpm test` + `pnpm build` + `git diff --check`；
- Heavy / DB / MySQL：`pnpm test:heavy` + 受保护 disposable MySQL 环境 `pnpm test:mysql` + `pnpm test:mysql:concurrency`；
- release candidate：`pnpm test:all`。

#### Concurrency Cases (mandatory)

- two sourcing allocations same PR；
- two PR→PO conversions same line；
- PO Change vs Receipt (race)；
- two Notices same remaining PO qty；
- two Receipts same remaining PO qty；
- Receipt return vs billing (race)；
- **two handoff consumers same handoff → exactly one Outsourcing Order (UNIQUE plan_handoff_id + row lock)**；
- **cancel consumed order → handoff remains CONSUMED, target_outsourcing_order_id still set (audit)**；
- two outsource material issues；
- two outsource receipts (same order, different qty)；
- **two processing bills race on same receipt_item → cumulative already_billed_reserved (over {DRAFT, WAITING_MATCH, POSTED}) guards no overbilling (NO partial unique)**；
- **one Supplier Bill containing multiple Outsourcing Receipt Items (A + B + C)** + canonical cumulative billable check；
- two VMI ownership transfers；
- **Backflush cumulative target race — partial receipt × 2**：
  - Receipt 1 confirmed = 30 → cumulative target = 60, incremental 60；
  - Receipt 2 confirmed = 20 → cumulative target = 100, already 60, incremental 40；
  - **Never re-backflush full order requirement**；
- **Backflush supplement + scenario** — verified Supplement correctly counted；
- **Backflush insufficient supplier-WIP** → FAIL CLOSED `BACKFLUSH_INSUFFICIENT_SUPPLY`；
- **Backflush LOT/SERIAL provenance** — identity preserved end-to-end；
- **OUTSOURCE_PROCESSING PO → ordinary Purchase Receipt → BLOCKED (409 `PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE`)**；
- **STANDARD_PURCHASE PO → Outsourcing Receipt → BLOCKED (409)**；
- **OUTSOURCE_PROCESSING PO → Planning BUY supply → EXCLUDED**（MRP / Workbench / Reservation）；
- **OUTSOURCE_PROCESSING PO → cross-order processing fee → BLOCKED**；
- Backflush difference allocation preview/apply race；
- Outsourcing WIP Transfer vs new Issue race；
- Period close vs confirm Receipt race；
- 12 critical sections per `document.md §31.8.E`。

### 26.27 Implementation Waves and Gates

**Wave A — Procurement Foundation** (PRC-01/02/03)：parameters + supplier profile + buyers + purchasing groups；schema + migration + focused tests + RBAC seed update + current route adapter。

**Wave B — Sourcing & Pricing** (PRC-04/05/06/07/08/09/10)：source list + quota allocator + sourcing decision + price list + pricing UOM extension + pricing discount + price adjustment；no retroactive invariant；focused + heavy gates。

**Wave C — PR / PO Governance** (PRC-11/12/13/14)：PR source trace + split/merge + PO commercial snapshot + delivery schedule + prepayment requirement + PO Change；focused + heavy + MySQL。

**Wave D — Receiving / Return** (PRC-15/16/19/20/21/22/24/25/26)：Gift + delivery schedule enforcement + canonical PO execution view (converge MRP/Workbench/Reservation/Receiving) + Receipt Notice + IQC source-type extension + Purchase Receipt 4-branch billing + Return Request + Purchase Return 4-branch voucher refactor + Procurement Scan；focused + heavy + MySQL + MySQL concurrency；本 Wave 是收敛点，所有 consumer 必须切换到 canonical view。

**Wave E — VMI Bounded Business Layer** (VMI-01~05)：VMI business documents + owner-dimension interface mocked fail-closed；policy / summary 独立工作；physical mutation 部分等 Inventory Domain owner dimension；focused + heavy。

**Wave F — Outsourcing Foundation** (OUT-01/02/03/04/05/06/07/08/09)：outsourcing profile + source list + processing price + supplier WIP warehouse + planning handoff consumption (exactly-once) + Outsourcing Order + lifecycle (PLAN_CONFIRMED/RELEASED/COMPLETED/CLOSED + DRAFT/CANCELLED) + OUTSOURCE BOM consumption + material list snapshot；focused + heavy + MySQL。

**Wave G — Outsourcing Materials** (OUT-11/12/13/14/15/16)：Issue / Supplement / Return / Backflush + supplier WIP warehouse binding + LOT/SERIAL provenance；focused + heavy + MySQL + MySQL concurrency。

**Wave H — Outsourcing Receiving / Finance Handoff** (OUT-17/18/19/20/21/22)：Completion Receipt Notice + Inspection + Outsourcing Receipt + Processing Fee AP extension (canonical Supplier Bill source-type) + Cost Evidence (consumed carrying value + processing fee) + Finished Return；focused + heavy + MySQL + MySQL concurrency。

**Wave I — Period / WIP / Opening / Reports** (OUT-23)：backflush difference allocation + WIP transfer + opening + execution summary + material issue summary；focused + heavy。

**Wave J — UI / Convergence** (PRC-26 + UI IA + cross-cutting)：UI 工作面与 launcher 收敛 + 320/390/430/680 验收 + read model + analytics；focused + heavy + MySQL + acceptance scripts。

每 Wave 完成后：

- `pnpm test:fast` + `pnpm build` + `git diff --check`；
- 涉及 MySQL 时 `pnpm test:mysql` + `pnpm test:mysql:concurrency`（受保护 disposable 环境）；
- Wave D 完成后 running `pnpm test` + `pnpm test:heavy` 必须稳定；
- Wave H 完成后 final closure candidate。

### 26.28 Rollback / Deployment Safety

- 所有 migration additive；不 DROP legacy table；不重命名既有 release tag；
- `default_receipt_billing_mode` 默认值变更仅影响新业务；LEGACY_DIRECT 历史 Receipt 保留原值（兼容）；
- 参数变化不反写历史已批准/已执行单据；
- 任何变更触发的 `legacy null` 兼容性必须 fail-closed：缺新字段 → 视为 nullable 旧逻辑 path；
- 不使用 destructive down-migrate；rollback 以应用代码回退 + 新增结构停止写入；
- 不进入 production database 验证；MySQL destructive test 只在显式 disposable/test database + reset guard；
- 不破坏既有 route key / API method/path/request/response；
- 不重写 Inventory / Quality / AP / GL / Period Close backbone。

### 26.29 Explicit Reused Canonical Owners

- Purchase Order core lifecycle：`server/modules/procurement-orders.js` EXTEND 既有；
- Purchase Receipt execution：`server/modules/procurement-receiving.js` EXTEND 既有 + 既有 `commercial-golive.js::autoBillReceipt`；
- IQC：`server/modules/quality-gates.js` + `authoritative-quality.js` + `manufacturing-quality.js` source-type extension；**不**新建 Quality engine；
- LOT / SERIAL：`server/lib/stock.js` + `traceability-quality.js`；**不**新建 tracking engine；
- Inventory mutation：`server/lib/stock.js::adjustInventory` + `financial-inventory.js::receiveValue` / `issueValue`；
- Inventory valuation：`server/modules/financial-inventory.js::allocateProportionalCents` + `createSystemVoucher`；
- Supplier Bill / AP / GRNI：`server/modules/settlement-core.js::ensureSubledger` + `applyCreditAdjustment` + `commercial-golive.js::createSupplierBill`；
- Tax codes / tax snapshot：`server/modules/commercial-golive.js::taxSnapshot`；
- UOM conversion：`server/modules/commercial-golive.js::conversionSnapshot` + `quantitySnapshot` + `rational()`；**不**建立第二 UOM engine；
- Approval：`server/modules/approvals.js`；`PURCHASE_ORDER` family；OUTSOURCE_OUTSOURCING_ORDER optional future family；
- Planning BUY / OUTSOURCE handoff：`server/modules/planning-domain.js::releasePlannedOrder` write `planning_outsource_handoffs`；本 Domain exactly-once consumer；
- Engineering OUTSOURCE BOM：`server/modules/engineering-configurable-bom.js::resolveEffectiveBomForCaller`；
- Production Instruction / Purchase Instruction bridge：`server/modules/planning-documents.js` KEEP；PR 自有 lifecycle 与本 Domain 新模块对接。

### 26.30 Explicitly NOT Implemented

- Multi-Organization；
- Multi-Currency；
- 完整 B3105 PDA / camera SDK / label printing / generic PDA platform；
- Finance engine rewrite（重写 Supplier Bill / AP / GRNI / Payments / Cost）；
- Inventory ledger rewrite（含 invasive owner-dimension 改造）；
- Generic Workflow redesign；
- destructive data rewrite / DROP historical table / database reset；
- 完整 Operation Outsourcing handoff lifecycle（普通产品委外由 OUT-01~23 主线；operation outsource 后续 bounded）；
- retroactive rewrite 历史 approved PO / Receipt / Bill / AP（PRC-10 硬性禁止）；
- Standard Outsourcing 复用 VMI ownership semantics；
- enterprise-supplied material 入 OUT-10 PO line（processing fee only）；
- supplier-owned finished stock 通过 OUT-19 建模为 VMI-style ownership transfer；
- Lower-tolerance auto-close algorithm（`SOURCE_DETAIL_INSUFFICIENT` 留作 extension point）；
- Kingdee complex discount formula（`SOURCE_DETAIL_INSUFFICIENT` 留作 extension point）；
- 跨组织委外 / 跨组织 Supplier（OUT_OF_SCOPE）。

### 26.31 Design Review Checklist

- [x] No second Inventory truth；
- [x] No second AP truth；
- [x] No second Quality truth；
- [x] No second BOM resolver；
- [x] No second MRP engine；
- [x] VMI owner semantics correct（Standard Outsourcing = enterprise owned at supplier WIP location；VMI = supplier owned at enterprise site）；
- [x] Outsourcing ownership correct（enterprise-owned throughout）；
- [x] GRNI direction correct（LEGACY_DIRECT Dr Inventory / Cr AP；SEPARATE Receipt Dr Inventory / Cr GRNI；SEPARATE Bill Dr GRNI (+ Input Tax Receivable) / Cr AP；AUTO_BILL atomic）；
- [x] Purchase Return branching complete（4-branch: LEGACY_DIRECT / SEPARATE unbilled / SEPARATE billed / partially billed deterministic split billed-first）；
- [x] Outsourcing cost = consumed value + processing fee（不把 issued-but-unused / returned / supplier-WIP remaining 计入）；
- [x] PO Reservation supply converged by design（canonical PO execution view = single source）；
- [x] PRC IDs preserved (PRC-01~26)；
- [x] OUT IDs preserved (OUT-01~23)；
- [x] VMI IDs preserved (VMI-01~05)；
- [x] 54-capability trace preserved (49 domain-owned + 5 integration-backed)；
- [x] Cross-domain dependency recorded as metadata, not capability disposition。

---

**PROCUREMENT & OUTSOURCING DOMAIN CLOSURE DESIGN — READY FOR USER REVIEW**

### 26.32 Definitive Final Acceptance Implementation Reconciliation（2026-10-09）

已实现并验证的 Finance handoff：

- `confirmOutsourcingReceipt` 原子写入 `outsourcing_cost_evidences` provisional evidence；材料值只取 receipt-specific backflush consumed carrying value，不包含 issued-but-unused / returned / supplier-WIP remaining；
- `postProcessingFeeBill` 复用 `ensurePayableSource`，按 canonical `supplier_bill_items.commercial_source_*` 聚合 POSTED actual fee，刷新 actual / variance / basis status；
- `createFinishedReturn` 在 transaction 中重读累计退货数量；unbilled 不写 AP credit，billed 按 POSTED bill item 可贷数量确定性分配，并复用 `createCommercialCreditNote` → `applyCreditAdjustment`；`outsourcing_finished_return_credits` 保存 return → bill item → credit note trace；
- Purchase Return 四分支测试直接查询 `accounting_vouchers` / `accounting_entries` / role mapping，固定真实 debit/credit 方向与金额；
- SQLite focused 12 files 48/48 PASS；disposable MySQL 8 integration / concurrency / performance PASS；responsive 28/28 PASS。

Functional Browser UAT 尚有 3 个 Design-to-Implementation gap，故当前 Design acceptance 不得勾选 Freeze：

1. Planning handoff consumer 只依赖 `outsourcing_orders.planning_handoff_id UNIQUE`，未锁定、验证并将 authoritative upstream handoff 从 `PENDING` 转为 accepted/consumed；
2. `outsourcing_completion_notices` 及其 executable route/lifecycle 未落地；
3. canonical Quality owner 尚未暴露 `OUTSOURCING_RECEIPT` inspection create/complete contract。

Final verdict：`NOT READY`。后续修复必须继续遵守本节既有 source/transaction/RBAC/audit/SQLite+MySQL 设计，不得以 ordinary Purchase Receipt/IQC 的假成功替代。

---

### 26.34 Package A1 SAFE_CLOSE 与 VMI 最小闭环 Design（2026-11-07；待审阅）

**依据与边界**：Owner 决定见 `OPEN-BUSINESS-DECISIONS.md` §4.1；Requirement 见 §31.14。此处仅形成下一轮 Implementation 的设计依据，**未授权修改代码、Schema 或数据库**。本节在列明的 A1/VMI 范围内 supersede §26.4、§26.16 旧的全量目标和旧 owner-dimension 不可用假设；未列出的采购/委外设计保持原状。M1-Core 首期 §7、§13 与七 Gate 已签发验收保留其原范围。

#### 26.34.1 A1 寻源关闭

- `src/pages/sourcing-pricing.jsx` 删除 `runAllocation()` 及「模拟寻源分配」按钮和演示常量；保留现有合法 GET 查询、Source List、Quota、Price/Discount 展示及独立操作。无需新 Preview API、路由或状态机。
- `POST /api/procurement/sourcing-decisions` 在 `server/modules/procurement-sourcing.js::resolveSourcingDecision()` 的**服务端入口**完成既有认证/适用权限后，统一抛 `HttpError(409, ..., {code:'SOURCING_DECISION_WRITE_CLOSED'})`；管理员同样受该业务策略约束。拒绝须发生在任何 source/decision/allocation 业务写入前，不依赖伪来源是否存在，也不以隐藏 UI 代替。未授权者依既有 403；业务 409 由一个边界调用 `auditBusinessRejection`，不得 handler 与全局异常层双记。保留 Source List/Quota 查询及配置接口，不改 `AUD-PRC-002` Hash 实现。
- 测试矩阵：普通有权用户、管理员、伪 PR 来源、同请求重复调用皆稳定 409；逐字段快照比较 `sourcing_decisions`、allocations、PR/PO、库存/采购/财务表；按拒绝审计合同核对单次记录及重复调用不造成重复业务效果；GET/配置回归。

#### 26.34.2 WIP 转移核验与 Gate 影响

`createWipTransfer()` 现状更新源/目标 `outsourcing_material_list.issued_quantity`，未调用物理 Inventory Writer；如果只改变 Supplier WIP 的订单归属，这是**逻辑数量归属**而非仓位移动。它既不生成成本携带，也不能被记为真实库存 movement。代码注释「reusing canonical inventory movements」与实现不符，应在获批实施时纠正。源减目标增须在同一事务中以权威余额、身份、订单状态与业务日期重读后执行；数量必须有限、正数、精度合法且不超源剩余，目标行唯一可判定。零身份余额记录不足以证明历史 WIP 可转移：需核对产品跟踪策略、历史 movement 与身份台账覆盖，任一不可证明则 fail closed。两请求竞争同一源时采用数据库可证明的锁/条件更新，败方零业务副作用并按拒绝合同审计；成本字段保持 `UNVERIFIED_COST`/NULL，不以 `issued_quantity` 假装价值转移。若业务要求真实物理位置变化，须另按 canonical `applyInventoryMutation()`、跟踪与估值设计，不复用本逻辑接口冒充物理转移。

**M1C-G03/G06 Impact Assessment**：§7.5/§13 的数量归属保留与成本携带拒绝仍是已批准合同；既有 7/7 PASS 不作撤销或扩张。原 `AUD-OUT-001` 以「无 canonical Inventory movement」作为唯一缺陷的判定不成立；当前代码仍有事务外余额/身份读取、数量未充分校验、历史覆盖与并发守卫未证明等具体风险，见审计台账 §12。下一轮针对这些缺陷做最小修复与 focused/并发/SQLite-MySQL 复核，再由 Owner 判断是否影响 G03/G06；**不批准关闭整个接口**，也不自动重签 Gate。`B-P01` 成本携带及 `B-P02` 差异生效持续拒绝。

#### 26.34.3 VMI 调用链与 Schema

调用链：`Agreement → Receipt(PENDING) → Confirm(CONFIRMED) → SUPPLIER-owned Inventory → Consumption(CONFIRMED) → read-only Summary`。`procurement-vmi.js` 保持业务 owner；物理库存仅由 `applyInventoryMutation()` 持有。复用现有 `vmi_agreements` 的 `supplier_id/warehouse_id/product_id/effective_from/effective_to/active` 与现有 Receipt/Consumption 事实表，不采用 §26.16 旧草案中不存在的 `agreement_no/replenishment_mode/ownership_transfer_rule/settlement` 字段。现有 `min_stock/max_stock/reorder_level` 仅作为兼容字段，不驱动新补货或结算规则。

- **VMI-01**：现有 `createVmiAgreement()` 以 `outsourcing_enabled=1` 判资格，Requirement/Design 中未找到「委外资格等于 VMI 资格」的批准依据。`VMI_SUPPLIER_ELIGIBILITY_OWNER_DECISION_PENDING`；在 Owner 裁定正式资格来源前，不改成采购资格、全体供应商或虚构 `vmi_enabled`。若裁定需新增资格字段，先回到 Requirement/Design 并另获 Schema/Migration 授权；当前 VMI-01 实施放行受阻。
- **VMI-02**：创建时必须通过 `agreementId` 明确绑定有效 Agreement（或仅在唯一有效候选时由服务端确定性绑定），检查 supplier/warehouse/product/receivedDate、有效期与 active；确认时在同一事务内重读 Receipt、Agreement 与 owner 位置并重验，状态仅 `PENDING → CONFIRMED`。多协议候选或历史 Receipt 无可证明绑定一律 409，不能 `LIMIT 1` 选取。确认仅调用 `applyInventoryMutation({sourceType:'VMI_RECEIPT', movementKind:'IN', toPosition:{ownerType:'SUPPLIER',ownerId:supplierId,...}})`；库存、状态与审计原子完成。重试由业务命令幂等和内部固定 Receipt mutation key 双层保护。
- **VMI-03**：只接受已确认 Receipt；事务内重读 Receipt/Agreement、supplier/warehouse/product、该 Receipt 已确认消费累计及 canonical Supplier 位置余额；若有退回或调整，先按可追溯事实计算可用量，无法归属到 Receipt 的历史变动不能靠总池余额猜分。`quantity > receipt可用量` 或 owner 位置不足时 409 且零业务副作用。`applyInventoryMutation({sourceType:'VMI_CONSUMPTION', movementKind:'OUT', fromPosition:{ownerType:'SUPPLIER',ownerId:supplierId,...}})`、Consumption 行与审计同一原子事务；Receipt 保持 `CONFIRMED`，不启用 `CONSUMED`。同一 Receipt 的并发消费通过数据库锁/条件累计守卫串行化或等效可证明方案，SQLite/MySQL 均不得超额。
- **VMI-04**：GET 汇总按已确认 Receipt、Consumption 和 canonical owner 位置事实计算 Received、Consumed、Remaining，按 supplier/product/warehouse 口径保持可追溯；对合法退回/调整显示可解释的差额并使 `Received − Consumed` 与当前 Supplier 位置余额对账。历史 `CONSUMED/TRANSFERRED` 状态、ownership-transfer 表行及无法归属的旧数据不能默认为新结算事实；口径冲突时显式标记不可核对，不伪造非负余额。移除 `pendingSettlement/transferred` 对外字段及任何金额/已结算展示，不写结算表。
- **VMI-05**：现有 ownership-transfer POST 继续在权限后返回 409 `VMI_SETTLEMENT_POLICY_PENDING`，拒绝审计仅一次，物权、库存、Supplier Bill、AP、GL 零变化。`D-P01/D-P02`、`M1-GD01/GD02` 不改变，避免 `M1-F-07` 双扣；不新增结算周期、物权变更、税价或账单 API。

**最小 additive migration 设计边界**：现有 `vmi_receipts` 无 `agreement_id`，`vmi_consumptions` 无业务幂等键；下一轮须先验证现有通用 `idempotencyReplay/requestFingerprint/saveIdempotency` 与 `vmi_receipts.idempotency_key UNIQUE` 的复用能力，再设计 Receipt 的 `agreement_id` 可空 FK/索引、Consumption 的命令键唯一约束（或复用通用幂等表），及业务日期/来源索引。历史行保持原值、不自动回填、不删除表；历史绑定不能证明时只读兼容、确认/消耗 fail closed。任何新增字段、唯一索引、锁策略均需独立 Schema/Migration 授权与 SQLite/MySQL 8 parity 验证，不在本轮执行。

**幂等、权限、错误与验证**：沿现有 `VMI_VIEW/VMI_MANAGE` 后端门禁；管理者亦不得越过协议/库存/延期策略。Receipt 创建、确认与 Consumption 的外部 `Idempotency-Key` 按 operation + 业务对象作用域及规范化 payload 指纹记录：同键同负载精确重放原响应，同键异负载 409；内部库存 mutation key 固定于权威业务 ID。复用现有命名锁/事务释放合同，拒绝审计放在回滚后的单一边界；400 输入错误与 403 权限错误沿既有合同，协议不唯一/失效、余额不足、幂等冲突、历史不可证明为稳定 409 code。测试覆盖协议 0/1/多匹配、日期边界、历史 NULL 绑定、同键重放/异负载、重复确认、双并发超额、事务故障注入、owner 维度与库存/事实/审计快照、合法调整/退回汇总、VMI-05 零副作用；SQLite focused/full/heavy 与受保护 disposable MySQL 并发门禁按 §9/§10 执行。回滚仅撤销新代码与 additive 入口，保留已产生的业务事实；不得删除历史表或以回滚改写库存。

#### 26.34.4 A1 Design Review Addendum — WIP 业务幂等与来源追溯（2026-11-08；PENDING_REVIEW）

> **定位 / Owner / 状态**：本增补仅属于 `docs/design/procurement-outsourcing.md` §26.34 的待审 Design，Owner 为 Procurement & Outsourcing Domain Owner。依据 §31.14、Owner Decision §4.1 和 M1-Core Active Design §7/§9/§10。它细化 §26.34.2–§26.34.3，不形成第二份权威 Design，不变更 Requirement、已批准 M1-Core 7/7 Gate、`B-P01/B-P02`、`D-P01/D-P02`。`PENDING_REVIEW` 不等于 Design PASS、Implementation 或 Migration 授权。
>
> **代码核验锚点**：`master` @ `ba276d63d437a42d61b47763ed8d35bd9b3236d8`。`createWipTransfer()` 位于 `server/modules/outsourcing-finance.js`；现有转移表只把 `material_list_id` 写成目标行，不能独立保存源行；`outsourcing_wip_identity_effects` 已有 `TRANSFER_OUT` / `TRANSFER_IN`，`outsourcing_wip_identity_effect_allocations` 已有 `TRANSFER_ORIGIN`，但现有转移函数尚未使用。以下是**目标设计**，不得当作现有实现事实。

##### 26.34.4.1 WIP Transfer 命令、幂等作用域与结果

- 请求保持既有 `POST /api/procurement/outsourcing/wip-transfers`，在另行批准 Implementation 后要求幂等键（非空、长度有界）；复用 `requestFingerprint()`、`idempotencyReplay()`、`saveIdempotency()`，**先验证**既有 MySQL 命名锁释放与事务所有权合同。无合法键返回 400，绝不生成 WIP 转移事实；改变请求合同需要本 Design 获业务所有者审批。**键来源与响应约定以 §26.34.8 为准**：键取请求体 `body.idempotencyKey`，**不**取 HTTP `Idempotency-Key` 头；本节此前的「外部 `Idempotency-Key`」表述已由 §26.34.8 取代。
- 规范化指纹必须包含 `sourceOrderId`、`targetOrderId`、`materialListId`（源行）、`quantity`（经 UOM/精度规范化）、`transferDate` 和任何最终获批的身份选择字段。作用域至少为 `(operationType='OUTSOURCING_WIP_TRANSFER', authoritative sourceOrderId, body.idempotencyKey)`，还必须服从现有组织/租户与授权边界；不得跨主体查询或重放他人的响应。**字段集合与归一规则的权威正文是 §26.34.8.2**；本节只保留原则性要求。
- 首次成功：201，返回稳定的 `id`、`transferNo`；相同作用域、相同 Key 和相同规范化载荷：返回原业务结果并附 `replayed:true`，不新增转移记录、身份证据、库存、审计成功事实；同 Key 不同载荷：409 `OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT`，不写业务事实。**最终响应形式以 §26.34.8.1 为准**（首次 201 `{id, transferNo}`；精确重放 201 `{id, transferNo, replayed:true}`；缺键 400 `IDEMPOTENCY_KEY_REQUIRED`）；本节此前的「200 + `replayed:true`」假设与「replay 形式待核对」开放项已由 §26.34.8 取代。不得由 Agent 自行更改全局幂等合同。
- 幂等记录写入与 WIP 数量/身份效力、业务转移事实、成功审计必须在**同一业务事务**中完成。重试或中途失败不得产生半个转移；`transferNo` 使用稳定、冲突安全的生成方式，不能依赖毫秒时间戳作为唯一性证明，**具体编号方案以 §26.34.14.2 为准**。对于已进入 COMMIT 结果不确定状态的 MySQL 请求，不允许自动重新执行写入，**也不得以新的幂等键自动重建业务事实**；处置方式以 §26.34.9.2 第 7 条与 **§26.34.14.3 的严格恢复条件**为准。

##### 26.34.4.2 源/目标物料行与不可变来源证据

- API 的 `materialListId` **表示源行**；数据库旧表 `outsourcing_wip_transfers.material_list_id` 在既有实现中**表示目标行**。这两个语义必须显式映射，不得直接将 API 字段覆盖为同一个数据库事实。
- 源行按 `(id=materialListId, order_id=sourceOrderId)` 唯一核定；目标行按 `(order_id=targetOrderId, product_id=source.product_id)` 查询并检查候选数严格为 1；`get()`/`LIMIT 1` 不能证明唯一。还要验证产品、基础 UOM、同一供应商 WIP 物理位置、两订单状态、业务日期和权限，任何不一致均拒绝，不允许跨仓物理移动借用逻辑转移接口。
- **UOM 三方一致**：源行 `unit`、目标行 `unit` 与产品基础 UOM 必须三者一致。跨 UOM 的数量归属不是同一物料的数量转移，任何一方不一致即固定 409 `OUTSOURCING_WIP_TRANSFER_UOM_MISMATCH`，零业务副作用、单次拒绝审计；不得静默换算，也不得由请求方指定 UOM。
- **最小 Schema 候选（单独授权）**：保留旧 `material_list_id` 对应目标行的历史语义，仅为 `outsourcing_wip_transfers` 新增 `source_material_list_id TEXT NULL`（可选 FK→`outsourcing_material_list.id`）与必要查询索引。所有新转移写入显式源行 ID，目标行仍写现有 `material_list_id`；二者在确认后不可普通修改。历史行的新增列保持 NULL，不根据订单+产品猜回填；历史来源不可证明时只读标 `SOURCE_UNVERIFIED`。新增列是否必需以及是否另建不可变来源关联，须完成 migration 评审再批准；不得在 Design Review 当下执行 DDL。
- 转移事实能从 `transferId → sourceOrderId + sourceMaterialListId → targetOrderId + targetMaterialListId` 正向、反向追溯；源/目标 ID、数量、UOM、业务日期、身份效力来源、操作人和审计具有稳定关联。仅凭旧表里的 `source_order_id` + 目标产品作事后 JOIN 不算确定性证据。
- 源行与目标行的 `legacy_unverified_wip_quantity` 只有在证明为已核验数据时才参与。`NULL` 表示未知，绝不 `COALESCE(...,0)` 后获得转移容量。不得仅因 `outsourcing_wip_identity_balances` 行数为 0 就认定历史 WIP 为合法可转移数量。

##### 26.34.4.3 身份效力与允许路径

- 第一实施候选仅评估**可证明的非跟踪产品**（`products.tracking_policy='NONE'`）、`identity_key='NONE'`、来源证明齐全、同一 Supplier WIP 物理位置不变且不存在成本携带的订单间**逻辑数量归属**。LOT/SERIAL、历史残差、身份政策冲突及成本/价值不可证明的路径继续 fail closed，不能因有迁移能力而放宽 `B-P01` 延期边界。
- 对候选合法路径，不得只更新两条 `outsourcing_material_list.issued_quantity`。必须在同一事务内形成配对的 `TRANSFER_OUT`（源行 `CONSUME`）与 `TRANSFER_IN`（目标行 `SUPPLY`）身份效力，并以已有 `TRANSFER_ORIGIN` 分配和 `source_effect_id`（经过代码级契约核验后）串起可用源供给、源转出、目标转入。每笔供给被消费/转移的累计分配不得超过原供给；`Σ transfer_out = Σ transfer_in = requested quantity`。如现有 schema/消费者无法准确表达该链，不得伪造成功，应返回待裁定的 409 并回到 Design/Schema 审批。该链的**权威规范正文**见 **§26.34.15.2**（含「禁止把 `TRANSFER_OUT` 作为 `source_supply_effect_id` 的供给来源」）。
- 必须同时验证 `supplier_wip_remaining` 与 canonical WIP 身份账的数量。初始和最终两订单各自的身份可用量、`issued_quantity + supplemented_quantity - returned_quantity - backflushed_quantity` 的定义一致；组合总量守恒。物理库存 `inventory_positions/inventory_transactions/tracked_inventory_movements` **无新增数量移动**，企业所有权不变。目标行尚未拥有可核对的估值来源时，不得使下游成本携带/会计路径意外可执行。
- `outsourcing_wip_identity_effects` 中的 `TRANSFER_IN/OUT` 已在 schema 声明，**不代表**实现或 Gate 已完成。当前 `recordSupply/recordConsumption` 是私有实现且主要服务物理发退倒冲；Implementation 应通过唯一规范 Owner 进行有界扩展，禁止复制第二套 ledger、绕过现有分配或更改已批准的物理腿写者。

#### 26.34.5 A1 Design Review Addendum — WIP 事务、拒绝审计、并发与 Gate（PENDING_REVIEW）

##### 26.34.5.1 事务算法和并发守恒

1. 先完成认证和 `OUTSOURCING_MATERIAL_EXECUTE` 权限、有限长度输入格式校验；对业务源的任何查询/重放均不得绕过权限与组织范围。
2. 使用当前 `transaction(db, work)` 原语：SQLite `BEGIN IMMEDIATE`；MySQL 按现有 L0 transaction gate 与命名锁/事务生命周期合同运行。在事务内确定性重读源/目标订单、物料行、产品跟踪策略、身份/供给分配、历史残差与日期/期间状态；不能沿用事务外余额作为写入依据。
3. 对两订单同物料行执行**确定性锁顺序**或由既有 L0 gate 证明所有相关 Writer 串行化，并在更新中使用受影响行数/旧版本或余额条件校验（CAS）。减源、增目标、配对 effect / allocation、转移事实、幂等成功记录和审计同一原子提交。即使另一个请求已占用同一源余额，也不得发生超额或双花；若无法证明锁/条件写的双数据库语义，停止实施该路径。
4. 失败必须回滚：两行 `issued_quantity`、身份余额、effect/allocations、转移表、幂等成功结果、库存/估值/AP/GL 等业务事实前后**逐字段不变**。拒绝审计采用已有 `auditBusinessRejection()`，仅在业务回滚后由**单一边界**记录一次；不可在事务内先写成功审计再试图保留它，也不能在 handler 和统一错误层重复记录。
5. MySQL deadlock/timeout/ROLLBACK 不确定/COMMIT 结果不确定，必须按 `AGENTS.md` 与 `server/db.js` 已批准事务清理、隔离和重试合同处理；无证明不得将未知提交解释为失败可安全重试。任何新 Lock/DDL/跨域 Writer 影响须另审。

##### 26.34.5.2 错误与审计约束（候选业务 code 须经 Design 批准）

| 条件 | 目标行为 | 数据影响及审计 |
|---|---|---|
| 缺键、NaN/Infinity、0/负数、精度/UOM/日期格式非法、**源/目标订单相同** | 400 | 零业务写入；沿现有 400 审计约定 |
| 未授权 / 跨授权范围 | 403 | 零业务写入；不得泄露别人的订单与余额 |
| 源订单或源行确不存在 | 404 | 零业务写入；不扩大既有 404 审计义务 |
| 多个目标候选、无效订单状态、不一致供应商 WIP 仓、**源/目标物料行 UOM 与产品基础单位不一致**、关闭业务期间 | 409 + 具有稳定 code 的具体原因 | 零业务副作用；单次拒绝审计 |
| 历史余额未证实 / 身份无法追溯 / LOT/SERIAL 或成本延期路径 | 409 + `OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED` / `..._IDENTITY_UNSUPPORTED` / `..._COST_POLICY_PENDING`（按实际原因选择） | 零业务副作用；单次拒绝审计 |
| 超额 / 并发败方 | 409 + `OUTSOURCING_WIP_TRANSFER_OVERDRAW` / `..._CONCURRENT_CONFLICT` | 零业务副作用；单次拒绝审计 |
| 同 Key 异载荷 | 409 `OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT` | 不生成第二个转移/身份证据；单次拒绝审计 |
| 首次合法转移 | 201 | 数量与身份成对守恒；恰好一条成功审计 |
| 同 Key 同载荷重放 | 按已批准 replay 合同 | 精确重放结果，**不新增**成功或拒绝审计 |

`HttpError` 的错误 code 只在 HTTP/API 层映射；内部事务失败不能伪装成业务成功或一律误转 409。原实现仅部分 409 走审计；正式修订必须覆盖全部**已明确属于业务门禁**的拒绝，而不得把 DB 连接异常也写成业务拒绝。

##### 26.34.5.3 必须新增的 focused / race / parity 证据

- **WIP 正向**：从有效、新建、可证明的 `NONE` WIP 供应中转出部分数量；源减少目标增加，物理库存 0 变化、成本 0 携带、身份 effect `TRANSFER_OUT/IN` 与分配链恰好对应；后续合法退料/倒冲不能消费已转走的源容量。
- **WIP 幂等**：同 Key 同载荷首次创建与精确重放；同 Key 异载荷稳定冲突；不同 Key 同源竞争，合法总完成量不超过源初始余额；失败方单次拒绝审计。
- **WIP 负向**：负数/0/非有限量、UOM 不符、SERIAL 非整数、跨仓、源目标相同、目标重复产品行、closed period、未 RELEASED/不允许的状态、历史 NULL 残差、LOT/SERIAL 未批准、缺失 identity supply、目标身份余额冲突；逐字段快照证明零业务副作用。
- **WIP 并发**：真实 API 两连接同时各转相同源的相同/不同 Key；在 SQLite 和受保护 disposable MySQL 8 中验证最后可用量无负数、没有重复 effect、没有双扣/双加；通过人工同步屏障与故障注入验证失败回滚和 MySQL 不确定连接隔离，不得仅凭单线程 mock 宣称通过。
- **兼容 Gate**：核验 M1C-G03/G06 已批准原行为未受破坏；新增测试仅扩大 A1 专项证据，不改写历史 7/7 PASS；Gate 是否需重审由 Owner 根据差异证据决定。旧 `201 || 409` 宽松断言必须改成按已批准允许/拒绝情形分别**固定结果**。

#### 26.34.6 A1 Design Review Addendum — VMI 最小 Schema / Migration 边界（PENDING_REVIEW）

##### 26.34.6.1 当前实体核验和最小增量候选

| 对象 | master 现状 | 最小候选与门禁 |
|---|---|---|
| `vmi_agreements` | 已有 `supplier_id/warehouse_id/product_id/effective_from/effective_to/active` | **优先无新增业务字段**。有效协议必须按 supplier+warehouse+product+业务日期+active 严格唯一；时间区间重叠不能靠普通组合 UNIQUE 判定，须在事务中检测并发重叠。供应商资格仍 `OWNER_DECISION_PENDING`。 |
| `vmi_receipts` | 已有 `idempotency_key UNIQUE`，**无** `agreement_id` | **候选唯一必要持久化变更**：加 `agreement_id TEXT NULL`（FK 指向 `vmi_agreements.id`，若两端 FK 迁移可证明安全）和关联查询索引；业务创建时为新行写入可验证的 Agreement ID，历史 NULL 保留。 |
| `vmi_consumptions` | 已有 `vmi_receipt_id`，**无**外部业务幂等键字段 | 优先复用通用 `idempotency_records`，操作+Receipt+Key 作用域、payload fingerprint；仅当无法证明精确重放/跨进程并发时，才另提新增唯一键字段或索引的 Design/Migration 候选。 |
| `outsourcing_wip_transfers` | 旧 `material_list_id` 存目标行，未存源行 | §26.34.4 的 `source_material_list_id TEXT NULL` 是**独立的 WIP migration 候选**，不能与 VMI `agreement_id` 混成一项自动授权。 |
| `vmi_ownership_transfers` | 存在旧业务表 | **不新增、不激活、不回填**；VMI-05 继续 409，禁止物权、Bill、AP/GL 生效。 |

**必须先做只读 preflight**：检查 SQLite 与 MySQL 8 当前表、列、FK、索引、旧业务状态/数量、历史 VMI Receipt 未绑定数量、Agreement 日期区间交叠数量、已存在重复/冲突幂等键、来源流水和 owner 位置完整性；输出可追溯计数和样本（不得含敏感凭证），不得自动修复。不能把开发环境空库的结论泛化为真实库。任何 Schema DDL 都必须在**单独明确授权**及备份/回滚方案后执行；本次只形成候选。

##### 26.34.6.2 Agreement 绑定、幂等与历史策略

- 新 Receipt 创建时：必须在事务内按 supplier/warehouse/product/receivedDate 找到**恰好一个**有效 Agreement；若请求显式 `agreementId`，仍要核对该 ID 与唯一有效候选一致。0 个、多个、已失效、不匹配均 409；不可 `LIMIT 1` 或根据列表排序隐式选主。确认时重读 `receipt.agreement_id` 与 Agreement，并在同一事务中重验绑定、状态 `PENDING`、owner 位置与日期，再调用 canonical `applyInventoryMutation()`。
- 对有效期采用仓库规范的 `YYYY-MM-DD` 业务日期，不可默认 `created_at`；`effective_from`/`effective_to` 边界以及 active/inactive 的行为在用例中固定。Agreement 的资格基准如何定义、Agreement 到期后能否对已确认收货执行消费，均**不得**由 Agent 隐式裁定：如现有已批准合同不足，保持严格 fail closed，提交 Owner 决策；无需为未批准政策开发接口。
- 外部 `Idempotency-Key` 覆盖 Receipt 创建、Receipt Confirm、Consumption；规范化指纹包括协议/Receipt ID、supplier/warehouse/product、quantity、业务日期及 operation-specific 字段。成功记录与业务事实同事务，内部库存 `VMI_RECEIPT:<stableReceiptId>` / `VMI_CONSUMPTION:<stableConsumptionId>` 保证固定来源键，不得每次重试新 UUID 造成双入/双扣。同 Key 同载荷精确 replay；异载荷 409；跨操作与跨权限边界不共享重放结果。
- `vmi_receipts.idempotency_key UNIQUE` 不是 fingerprint/response replay 的替代品；`vmi_consumptions` 没键也不能以每次新 UUID 当作业务幂等。应先证明通用幂等表能覆盖 SQLite/MySQL 两路径，且同一个调用中命名锁与事务相容；无法证明就回到 Design，不用临时内存锁替代数据库证据。
- 对历史 `agreement_id=NULL` 的 Receipt：只读兼容、带 `AGREEMENT_UNVERIFIED` 或等效明确标识；**不推定绑定、不自动更新状态、不补写库存**。对于历史 `CONSUMED/TRANSFERRED` 等状态，不将其当作 A1 正式结算或已批准 owner change。若历史 Receipt 无法明确归属，其后续 Confirm / Consumption 一律 fail closed。

##### 26.34.6.3 Consumption 容量、汇总与迁移执行合同

- Consumption 事务内同时核对：Receipt 为已确认、真实 Agreement 绑定可证、`receipt.quantity - confirmedConsumptions - sourceAttributedReturns/Adjustments >= requestedQty`，以及 canonical SUPPLIER 位置实际足额；**两个不变量必须同时成立**，不能用同供应商/产品/仓库的其他 Receipt 库存替代本 Receipt 的剩余容量。缺少可归属的退回/调整事实时 fail closed，不自动按 FIFO/比例回填。
- 一次业务 Consumption 内先通过身份与源头检查，再原子写 canonical OUT 库存腿、VMI Consumption 事实、幂等成功记录和成功审计；失败回滚上述全部，拒绝审计在事务外单次持久化。同 Receipt 并发双请求必须经当前 SQLite/MySQL 事务门禁及累计守卫证明总消费不超额；不得要求另建第二套库存 Writer。
- VMI-04 的 `Received - Consumed` 是**未调整毛余额**；若存在经证明的合法退回/调整，需显示可解释的调节差额以对账 canonical Supplier-owned 当前余额，不能谎称 `Received - Consumed` 无条件等于调整后位置余额。无法证明时返回显式不可核对状态，不伪造可用量；不得展示 `pendingSettlement/transferred` 或任何物权转移金额、自动应付。
- Migration 候选须**新增而非重建**历史来源事实，`agreement_id` 历史默认 NULL；不得执行自动回填、硬删除旧状态或强行重写旧 VMI 移动记录。SQLite 与 MySQL 8 分别验证创建新库、升级现有库、重复运行、部分失败与重试（注意 MySQL DDL 可自动提交），验证 FK/索引/NULL/有效日期/unique 语义 parity。撤回应用代码时须保留所有已生效库存/业务事实；DDL 回滚需独立备份与受控计划，不能通过删除历史账来“恢复”。
- 范围明确排除：新增 `vmi_enabled`、复杂补货算法、自动 ownership transfer、价格/税/结算/供应商账单、AP/GL、历史事实推断和其他产品范围 SCP。新资格字段如确有必要必须先回 Requirement/Owner Decision，不能在 Schema 设计中偷偷确定业务政策。

#### 26.34.7 Review Gate、未决项与 HARD STOP（2026-11-08；PENDING_REVIEW）

| Gate | 通过条件 | 当前结果 |
|---|---|---|
| `A1-D-RV-01` WIP 幂等与来源 | 确认 replay 响应、源/目标不可变证据和现有 WIP ledger effect 的一对一归属算法 | `PENDING_OWNER_REVIEW`（只形成设计候选） |
| `A1-D-RV-02` WIP 安全并发 | 明确合法 `NONE` 路径、成本/LOT/SERIAL 延期与 400/403/404/409、拒绝审计、SQLite/MySQL race 断言 | `PENDING_OWNER_REVIEW` |
| `A1-D-RV-03` VMI Schema | 优先复用通用幂等，仅最小 `agreement_id` 候选，历史 NULL fail closed、双端迁移 preflight/rollback | `PENDING_OWNER_REVIEW`；Schema/Migration 未授权 |
| `A1-D-RV-04` 产品/外部政策 | VMI Supplier Eligibility 与 Agreement 到期后 Consumption 的业务政策须获 Owner 裁定；若需新字段先改 Requirement | `BLOCKED_ON_OWNER_DECISION` |

**验收边界**：本增补仅为 **Design Review 修订候选**，不得自动把 §31.14 标为 `APPROVED`、把 §26.34 标为 `DESIGN_PASS`、把 `AUD-OUT-001` 标为已验证或将 B3101/B3121 变为 `COVERED`。M1-Core 七 Gate 的 7/7 PASS 继续仅对原范围有效；`D-P01/D-P02`、`B-P01/B-P02`、`SCP-01..10/12..15`、`M-15` 原状态不变。

**未发生事项**：本轮没有修改 `docs/requirements/`、`document.md`、`server/`、`src/`、数据库 Schema/Migration、运行测试或 MySQL Gate，也没有提交、Push、Merge、Tag、Release、Deploy。Design Review 文本完成后 **HARD STOP**；接下来须由业务 Owner 明确批准 Requirement、此 Design Amendment、Implementation 范围，以及各个 Schema/Migration 的独立授权。A1-I1/I2 可在获得明确实施授权后优先单独推进；A1-I3/I4 不得绕开本表阻塞项。

---

#### 26.34.8 A1 小修：WIP 幂等合同（`body.idempotencyKey`）（2026-11-08；PENDING_REVIEW）

> **定位 / Owner / 状态**：本小节属于 `docs/design/procurement-outsourcing.md` §26.34 的待审 Design，Owner 为 Procurement & Outsourcing Domain Owner。它把 §26.34.4.1「最终 HTTP replay 形式须与既有已批准接口风格核对」收敛为**固定合同**，并把幂等键来源固定为请求体 `body.idempotencyKey`。它不构成第二份权威 Design，不变更 Requirement §31.14、M1-Core 已批准七 Gate、`B-P01/B-P02`、`D-P01/D-P02`，不签发 `DESIGN_PASS`，不授权 Implementation 或 Migration。
>
> **代码核验锚点**：`master` @ `a39beac7a334ab4cf32fd5bc6b33ef978d6a6d65`。`createWipTransfer()` 位于 `server/modules/outsourcing-finance.js:397`；当前 `assertAllowedFields()` 只允许 `sourceOrderId/targetOrderId/materialListId/quantity/transferDate`，**没有**幂等键。通用幂等原语位于 `server/modules/financial-controls.js`：`requestFingerprint()` / `idempotencyReplay()` / `saveIdempotency()`。以下为**目标合同**，不是现有实现事实。
>
> **键来源与响应约定的唯一权威（优先关系）**：本小节（§26.34.8）与 §26.34.10 的**键来源**（请求体 `body.idempotencyKey`，**不**取 HTTP `Idempotency-Key` 头）与**响应约定**，**取代** §26.34.3、§26.34.4.1、§26.34.5.3、§26.34.6.2 中「外部 `Idempotency-Key`」的表述及未定形的 replay 形式。上述各节凡与之冲突者，**以 §26.34.8 / §26.34.10 为准**。

##### 26.34.8.1 键来源、作用域与固定响应

- 幂等键的**唯一来源**是请求体字段 `body.idempotencyKey`（`POST /api/procurement/outsourcing/wip-transfers`）。本 Design **不**使用 HTTP `Idempotency-Key` 头；头部不得作为回退来源。
- 键必须为非空字符串，去除首尾空白后长度有界。缺失或全空白 → **400 `IDEMPOTENCY_KEY_REQUIRED`**，零业务写入、零幂等记录。
- 固定作用域：`operationType = 'OUTSOURCING_WIP_TRANSFER'`，`documentId = sourceOrderId`。调用形式固定为 `idempotencyReplay(db, 'OUTSOURCING_WIP_TRANSFER', sourceOrderId, key, fingerprint)`；`saveIdempotency()` 使用同一组 `(operationType, documentId, key)`。
- 固定响应合同：

| 情形 | HTTP | 响应体 |
|---|---|---|
| 首次成功 | 201 | `{ id, transferNo }` |
| 同 Key 同内容（精确重放） | 201 | `{ id, transferNo, replayed: true }` |
| 同 Key 异内容 | 409 | `OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT` |
| 缺少 Key | 400 | `IDEMPOTENCY_KEY_REQUIRED` |

- 幂等记录中保存**不含** `replayed` 标记的基准结果 `{ id, transferNo }`；`replayed: true` 由入口在重放命中时统一附加，避免幂等载荷随重放次数变化。
- 缺键判定必须在调用 `idempotencyReplay()` **之前**由业务入口完成：共享原语对缺键抛的是无稳定 code 的通用 400，业务入口必须先行拦截以产出固定 code `IDEMPOTENCY_KEY_REQUIRED`；**不得**为此修改 `financial-controls.js` 的全局幂等合同。
- 同 Key 异载荷的 409 由共享原语的指纹比对抛出（消息为通用文案）；业务入口必须把该 409 映射为固定 code `OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT`，并按 §26.34.9.2 第 8 条走**单一边界**拒绝审计（恰好一条），不得由 handler 与统一错误层重复记录。

##### 26.34.8.2 规范化指纹

指纹由 `requestFingerprint()` 对**规范化载荷**计算。规范化载荷必须覆盖以下字段，且字段顺序无关（`requestFingerprint()` 自身按键排序）：

| 字段 | 规范化规则 |
|---|---|
| `sourceOrderId` | 原样字符串 |
| `targetOrderId` | 原样字符串 |
| `materialListId` | **源**物料行 ID（原样字符串） |
| `quantity` | 按该行的 UOM 与产品精度规范化为**定点可比较**的数值表示；浮点尾差不得参与比较 |
| `uom` | 源物料行持久化的 `outsourcing_material_list.unit`；**不在请求体新增 UOM 入参**。该列由 BOM 项 UOM 快照写入（`item.uom_code_snapshot`、`products.base_uom_code`、`products.unit` 三者依次取首个非空），**不保证**等于产品基础 UOM —— 实施时必须先核验二者一致，不一致按 §26.34.5.2 的 409 门禁拒绝，**不得**静默换算，也**不得**由请求方指定 UOM |
| `transferDate` | `YYYY-MM-DD` 业务日期 |
| 身份选择字段 | 第一实施候选（§26.34.4.3：`identity_key='NONE'`、非跟踪产品）下固定为显式常量 `identityKey:'NONE'`；候选之外的身份取值必须**先**回到 §26.34.4.3 复核，不得在本小修中放宽 |

- 指纹只覆盖上述集合。目标订单的物料行 ID **不**进入指纹：目标行由 `(targetOrderId, product_id)` 唯一判定（§26.34.4.2），而 `product_id` 由源行派生；把派生结果放进指纹会让同一业务语义的不同表示产生不同指纹。
- 载荷字段的**缺失**与**显式空值**必须归一为同一表示，否则同一业务语义会因请求书写差异产生不同指纹而绕过精确重放。
- **归一规则只适用于请求合同已存在的入参**：WIP 转移当前只允许 `sourceOrderId`、`targetOrderId`、`materialListId`、`quantity`、`transferDate` 五项（`server/modules/outsourcing-finance.js:400` 的 `assertAllowedFields()`）。**不得假设存在 `remark`、`uom`、`identityKey` 等未获批准的请求入参**，也不得为其编造缺失/空值归一规则。
- 身份选择字段是**服务端派生的常量**，不是请求入参；调用方不传递、也不需要传递它。UOM 同理取自源物料行持久化事实，不由请求方指定。
- 指纹使用的 UOM 与数量归一所依据的 UOM **必须是同一个值**；否则同一业务语义可能产生两个不同指纹而绕过精确重放。

##### 26.34.8.3 原子性与重放边界

- 幂等记录、转移事实（`outsourcing_wip_transfers` 行）、数量效力（源/目标 `issued_quantity` 增减）、身份效力（配对的 `TRANSFER_OUT` / `TRANSFER_IN` 与 `TRANSFER_ORIGIN` 分配，见 §26.34.4.3）与**成功审计**必须在**同一业务事务**内提交。任一失败整体回滚，不得产生半个转移。
- 精确重放**不得**新增转移行、不得新增身份 effect/分配、不得改动任何数量、不得新增成功审计。精确重放的响应内容必须与首次成功的响应**逐字段一致**（仅多 `replayed: true`）。
- 幂等记录读取（`idempotencyReplay()`）在业务事务**之外**执行；幂等记录写入（`saveIdempotency()`）在业务事务**之内**执行。这与仓库既有调用方（如 `server/modules/consignment.js`）的既有约定一致。
- 幂等记录的唯一约束为 `UNIQUE(operation_type, document_id, idempotency_key)`（`idempotency_records`），因此「同 Key 异载荷」在并发下由该唯一约束与 MySQL 命名锁共同收敛，不得依赖应用层「先查后写」的时序假设。
- `transferNo` 的稳定、冲突安全生成方式属 §26.34.4.1 已登记的待修项；其**最小稳定编号方案已由 §26.34.14.2 固定**，本小修不再保留该开放项，也**不**引入第二套编号算法。

#### 26.34.9 A1 小修：MySQL 命名锁释放与事务边界合同（2026-11-08；PENDING_REVIEW）

> **定位 / Owner / 状态**：同 §26.34.8。本小节**只核对并固定** `server/db.js` 与 `server/modules/financial-controls.js` 的**既有**锁与事务释放合同，**不修改其实现**。它是 WIP 幂等（§26.34.8）与 VMI 幂等（§26.34.10）必须遵守的调用侧约束。

##### 26.34.9.1 既有实现的核验事实

以下为 `master` @ `a39beac7a334ab4cf32fd5bc6b33ef978d6a6d65` 的**既有实现事实**（本轮只读核验，零改动）：

| 事实 | 位置 |
|---|---|
| `idempotencyReplay()` 在**未命中**记录时 `return null` 且**不释放** MySQL 命名锁；锁由当前请求继续持有 | `server/modules/financial-controls.js:52` |
| `idempotencyReplay()` 在**命中**记录时经 `releaseMySqlIdempotencyLocks(db, { lockNames: [lockName] })` 释放；随后指纹不符抛 409，一致则返回 `result_json` | `server/modules/financial-controls.js:55-57` |
| `idempotencyReplay()` 的查找异常路径同样经该公共合同释放 | `server/modules/financial-controls.js:49` |
| `transaction()` 在 COMMIT 成功后释放命名锁 | `server/db.js:2371` |
| `transaction()` 在 ROLLBACK、终态失败、不可证明回滚与不确定 COMMIT 各路径释放命名锁 | `server/db.js:2389 / 2395 / 2401` |
| MySQL `BEGIN` 启动失败由 `settleFailedTransactionStart(db, startupError)` 处理，其默认 `releaseLocks = true` 会执行释放 | `server/db.js:2277-2297`、`server/db.js:2353` |
| `assertMySqlTransactionAdmission(db)` 位于 `transaction()` 内部 `try` **之前**；拒绝时直接抛出，**不**经过任何释放路径 | `server/db.js:2338`（`try` 起于 `server/db.js:2344`） |
| `readTransaction()` 的 BEGIN 失败路径以 `{ releaseLocks: false }` 调用 `settleFailedTransactionStart()`；读路径不拥有命名锁 | `server/db.js:2422` |
| `releaseMySqlIdempotencyLocks()` 是**唯一**权威释放合同；`RELEASE_LOCK` 返回 1 才算已确认释放，其余结果（0 / NULL / 异常 / 超时）一律视为**未确认**并隔离该连接 | `server/db.js:2195-2272` |
| 不确定 COMMIT（`mysqlRequestTimeout` / `sessionLost`）**永不**被自动重试为写操作 | `server/db.js:2398-2403` |

##### 26.34.9.2 调用侧必须遵守的释放合同

1. **未命中即持锁**：调用 `idempotencyReplay()` 得到 `null`（无重放）时，MySQL 命名锁**仍由当前请求持有**，直到本请求的 `transaction()` 结束或调用侧显式释放。调用方**不得**因为「没有重放结果」而假设锁已释放。
2. **正常路径**：正常 COMMIT 或 ROLLBACK 之后，`transaction()` 自行释放锁。调用侧**不得**在事务之后再重复释放一次——重复释放会产生 `LOCK_ABSENT` 之类的未确认结果并触发既有连接隔离机制。
3. **BEGIN 启动失败**：由 `settleFailedTransactionStart()` 的默认行为释放，调用侧无需重复处理。
4. **admission 拒绝**：`assertMySqlTransactionAdmission()` 在 `transaction()` 内部 `try` 之前，失败时**没有任何内部释放路径**。因此调用方**必须**提供外层释放保障：以 `try { transaction(db, work) } finally { releaseMySqlIdempotencyLocks(db) }` 包裹，使 admission 拒绝、事务外异常与事务内回滚三种情形都收敛到同一个公共释放合同。
   - `finally` 中的释放在 SQLite 路径是**空操作**（`releaseMySqlIdempotencyLocks()` 在 `db.dialect !== 'mysql'` 时直接返回空结果），因此同一段调用代码可同时服务 SQLite 与 MySQL 两条路径，不需要分支。
5. **禁止绕过公共合同**：调用侧**不得**直接执行 `RELEASE_LOCK()` 或任何等价的私有释放语句；不得自建第二套锁释放实现；不得吞掉 `releaseMySqlIdempotencyLocks()` 的返回值。
6. **未确认释放的处置**：`releaseMySqlIdempotencyLocks()` 的 `unverified` 非空时，该连接已被既有机制隔离（`quarantineMySqlAdapter(db, 'idempotency_lock_release_unverified')`）。调用侧**不得**在隔离连接上继续发起任何语句，**不得**把未确认释放当作已释放，**不得**自行恢复该连接。SQLite 路径没有命名锁，其既有连接隔离机制保持不变。
7. **不确定 COMMIT**：`transaction()` 对不确定 COMMIT 不会自动重试写操作。调用侧**不得**在捕获该错误后自动重发写请求，**尤其不得以新的幂等键自动重建业务事实** —— 新键会绕开既有幂等记录，可能在原提交其实已生效时产生第二笔业务事实。处置的**原则**是：**只有在原会话与未决事务已被安全收束、原业务事实确实未提交、且无并发未决写入三项同时成立时**，才允许以**同一**幂等键重试；否则一律保持隔离并交由 Owner / 人工处置。**三项条件的逐条判定与禁止项以 §26.34.14.3 为准**，其中「仅查询不到记录」**不构成**未提交证明。

   只读核验**必须**在可信连接上执行；在被隔离或会话状态不确定的连接上所得的核验结果**不构成**「已提交」或「未提交」的证明，也**不得**被当作可重试的依据。
8. **业务拒绝的单一边界**：任何业务门禁拒绝（409）必须在**事务回滚之后**由**单一**边界调用 `auditBusinessRejection()` 记录恰好一条拒绝审计；不得在事务内先写成功审计再回滚，也不得由 handler 与统一错误层各记一条。`auditBusinessRejection()` 只对 `status === 409` 的 `HttpError` 生效，400 / 403 沿既有合同处理。

##### 26.34.9.3 本小修的边界

- 本小修**不修改** `server/db.js`、`server/modules/financial-controls.js` 或任何其他生产代码。
- 若将来需要改变 `idempotencyReplay()` 的「未命中不释放」行为，或 `assertMySqlTransactionAdmission()` 的位置，必须**先**回到 Requirement / Design 层并取得单独批准；不得在 Implementation 中顺手调整。
- 本小修**不引入**新的锁原语、新的锁命名空间或新的事务层级。

#### 26.34.10 A1 小修：VMI 幂等合同（2026-11-08；PENDING_REVIEW）

##### 26.34.10.1 三个独立 operationType

| 操作 | `operationType` | `documentId`（作用域） | 幂等键来源 |
|---|---|---|---|
| Receipt 创建 | `VMI_RECEIPT_CREATE` | `create-request:${idempotencyKey}` | `body.idempotencyKey` |
| Receipt 确认 | `VMI_RECEIPT_CONFIRM` | `receiptId` | `body.idempotencyKey` |
| Consumption 创建 | `VMI_CONSUMPTION_CREATE` | `receiptId` | `body.idempotencyKey` |

- 三个操作**互不共享**重放记录：`operationType` 不同即不同作用域。同一把键在三个操作上分别成立，不得跨操作重放，也不得跨权限边界共享重放结果。
- 幂等键唯一来源为请求体 `body.idempotencyKey`；不读取 HTTP 头。
- 缺少 Key → **400 `IDEMPOTENCY_KEY_REQUIRED`**，零业务写入、零库存变化、零幂等记录。判定必须在调用 `idempotencyReplay()` 之前完成（理由同 §26.34.8.1）。
- Receipt Confirm 端点当前不读取请求体；本 Design 要求它**接受并只接受** `idempotencyKey` 一个字段的请求体。Consumption 端点的允许字段集合须新增 `idempotencyKey`。Receipt 创建端点已允许 `idempotencyKey`，保持不变。

##### 26.34.10.2 规范化指纹

| 操作 | 指纹覆盖字段 |
|---|---|
| Receipt 创建 | `supplierId`、`warehouseId`、`productId`、`quantity`（规范化）、`receivedDate`（`YYYY-MM-DD`）、`remark`、`agreementId` |
| Receipt 确认 | `receiptId`、操作类型（`VMI_RECEIPT_CONFIRM`） |
| Consumption 创建 | `receiptId`（消费所依据的 Receipt，即 `body.vmiReceiptId`）、`quantity`（规范化）、`consumedDate`（`YYYY-MM-DD`）、`destination`、`remark` |

- 三个指纹的**归一规则**一致：字符串去除首尾空白；缺失与显式空值归一为同一表示；数量按基础 UOM 与产品精度规范化为定点可比较表示；日期按 `YYYY-MM-DD`。
- Receipt 确认的指纹只覆盖 `receiptId` 与操作类型：确认动作的业务语义由 Receipt 自身的权威状态决定（`PENDING → CONFIRMED`），请求侧没有其他可变载荷。若将来确认动作引入可变入参，必须先扩展本小节再实施。
- Consumption 的指纹以**消费所依据的 Receipt** 为作用域，而不是以新建的 Consumption 文档为作用域：这保证「同一 Receipt 上同一载荷的重复消费」被精确重放，而「同一 Receipt 上不同载荷的重复消费」被稳定拒绝。

##### 26.34.10.3 固定响应合同

| 操作 | 情形 | HTTP | 响应体 |
|---|---|---|---|
| Receipt 创建 | 首次成功 | 201 | `{ id, receiptNo }` |
| Receipt 创建 | 精确重放 | 201 | `{ id, receiptNo, replayed: true }` |
| Receipt 确认 | 首次成功 | 200 | `{ ok: true }` |
| Receipt 确认 | 精确重放 | 200 | `{ ok: true, replayed: true }` |
| Consumption 创建 | 首次成功 | 201 | `{ id, consumptionNo }` |
| Consumption 创建 | 精确重放 | 201 | 原结果 `{ id, consumptionNo }` + `replayed: true` |
| 三个操作 | 同 Key 异载荷 | 409 | `VMI_IDEMPOTENCY_KEY_PAYLOAD_CONFLICT` |
| 三个操作 | 缺少 Key | 400 | `IDEMPOTENCY_KEY_REQUIRED` |

- 幂等记录保存**不含** `replayed` 标记的基准结果；`replayed: true` 由入口在命中时统一附加。
- 同 Key 异载荷的 409 由共享原语的指纹比对抛出，业务入口必须映射为固定 code `VMI_IDEMPOTENCY_KEY_PAYLOAD_CONFLICT`，并按 §26.34.9.2 第 8 条走单一边界拒绝审计（恰好一条）。
- **新 Key 不是重放**：同一 Receipt 用一把**新**键再次确认时，重放查找不命中，随后由既有状态门禁「只有待确认状态可以确认」拒绝（409），库存零变化；不得因为「键不同」而放行第二次确认。

##### 26.34.10.4 原子性与库存副作用

- Receipt 确认：canonical `applyInventoryMutation()` 的 SUPPLIER owner 入库腿、`vmi_receipts.business_status = 'CONFIRMED'`、幂等成功记录与成功审计必须在**同一业务事务**内提交。内部库存 mutation key 固定为 `VMI_RECEIPT:<stableReceiptId>`（§26.34.3）。
- Consumption 创建：canonical `applyInventoryMutation()` 的 SUPPLIER owner 出库腿、`vmi_consumptions` 事实行、幂等成功记录与成功审计必须在**同一业务事务**内提交。内部库存 mutation key 固定为 `VMI_CONSUMPTION:<stableConsumptionId>`；`stableConsumptionId` 必须是**权威业务 ID**，不得在重试时新生成随机 UUID。
- 精确重放**不得**新增库存变化、不得新增 Consumption / Receipt 事实、不得新增成功审计。
- 业务拒绝审计只能在**事务回滚之后**由**单一**边界执行；400 与 403 沿既有合同。

#### 26.34.11 A1 小修：VMI 旧 `idempotency_key` 字段兼容合同（2026-11-08；PENDING_REVIEW）

##### 26.34.11.1 保留与并存

- `vmi_receipts.idempotency_key TEXT UNIQUE` 是**既有**列与既有唯一约束（`server/migrations/procurement-outsourcing-schema.js:416`）。**保留**该列与该约束；**不删除**该表、该列或该约束，**不**重建表。
- 新建 Receipt **继续**写入该列（保持现状：`body.idempotencyKey` 写入 `vmi_receipts.idempotency_key`）。
- **同时**使用通用幂等表 `idempotency_records` 保存**完整指纹**与**响应结果**（§26.34.10）。
- **权威重放记录**是通用幂等记录 `idempotency_records`；`vmi_receipts.idempotency_key` 只是**遗留键列**，不承载指纹，不承载响应。
- 本小修**不新增**任何 Schema。`vmi_receipts.agreement_id` 仍是 §26.34.6.1 的**独立** Migration 候选，**未授权、未执行**；它**不**因幂等问题被顺带引入。

##### 26.34.11.2 通用记录未命中时的遗留键核对

通用幂等记录未命中（即 `idempotencyReplay()` 返回 `null`）时，**必须**再按遗留键列核对：

1. 以 `idempotency_key = <key>` 查询 `vmi_receipts`。该列有 UNIQUE 约束，最多命中一行。
2. **未命中** → 正常创建新 Receipt（写遗留键列 + 写通用幂等记录）。
3. **命中** → 用该历史行**持久化字段**重建规范化指纹的**可证明部分**：`supplier_id`、`warehouse_id`、`product_id`、`quantity`、`received_date`、`remark`。
   - `agreementId` **不可证明**：当前 `vmi_receipts` **没有** `agreement_id` 列，历史行无法证明该字段。
     - 本次请求**未提供** `agreementId`（归一为空）→ 可证明部分即为完整指纹；
     - 本次请求**提供了** `agreementId` → 该字段无法与历史行比对 → 返回 **409 `VMI_RECEIPT_IDEMPOTENCY_LEGACY_UNVERIFIED`**（不得据此新建第二个 Receipt，也不得猜测历史绑定）。
   - 完全匹配 → **返回原 Receipt**（201 + 原 `id` / `receiptNo` + `replayed: true`），**不重复创建**，不新增库存变化，不新增成功创建审计。
   - 内容不一致 → **409 `VMI_IDEMPOTENCY_KEY_PAYLOAD_CONFLICT`**（与 §26.34.10.3 同一 code）。
   - 无法证明历史载荷（`agreementId` 不可比对，或历史行的任一指纹字段缺失 / 不可归一）→ **409 `VMI_RECEIPT_IDEMPOTENCY_LEGACY_UNVERIFIED`**。
4. **并发**：同键并发创建由 `vmi_receipts.idempotency_key` 的 UNIQUE 约束与 MySQL 命名锁（§26.34.9）共同收敛。遗留键写入触发 UNIQUE 冲突时，必须映射为上述稳定 409 code；**不得**把数据库唯一约束错误直接暴露为 500，也不得据此新建第二个 Receipt。

##### 26.34.11.3 历史数据的只读与不可回填

- **不自动回填**历史记录：不得为历史 Receipt 补写 `idempotency_records` 行。
- **不修改**历史业务行：不得回写 `vmi_receipts` 的任何既有列（含 `idempotency_key`、`business_status` 与数量）。
- **NULL 历史键保持 NULL**：`idempotency_key IS NULL` 的历史行**不参与**任何遗留键匹配；不得推断、不得补写，也不得据 NULL 推断「该行无幂等保护」。
- 历史 `CONSUMED` / `TRANSFERRED` 等状态**不**被当作新的结算事实或已批准物权变更（§26.34.3 / §26.34.6.2 保持有效）。
- 遗留核对是**只读**路径：命中历史行时不写任何历史行、不写库存、不新增成功创建审计；如需留痕，只能按既有幂等重放口径记录，且**不得**被记为成功创建。

##### 26.34.11.4 边界

- 本小修**不**授权、**不**执行任何 Schema / Migration；`agreement_id` 候选的 preflight、DDL、parity 与回滚仍按 §26.34.6.1 / §26.34.6.3 独立授权。
- 本小修**不**改变 VMI-05 的状态：`POST /api/procurement/vmi/ownership-transfers` 继续返回 409 `VMI_SETTLEMENT_POLICY_PENDING`，物权、库存、Supplier Bill、AP/GL 零变化。幂等合同**不**得成为开放 VMI-05 的理由。
- 本小修**不**变更 §26.34.6.2 关于历史 `agreement_id=NULL` Receipt 只读兼容与 fail closed 的结论。

#### 26.34.12 A1 小修的边界与 HARD STOP（2026-11-08；PENDING_REVIEW）

- §26.34.8～§26.34.11 是 §26.34 的**待审 Design 修订**，全部为 `PENDING_REVIEW`。它们**不**签发 `DESIGN_PASS`，**不**授权 Implementation、Schema / Migration、数据库操作或真实 MySQL Gate。
- §26.34.7 的四个 Owner Review Gate 状态**全部保持不变**：`A1-D-RV-01` / `A1-D-RV-02` / `A1-D-RV-03` 仍为 `PENDING_OWNER_REVIEW`，`A1-D-RV-04` 仍为 `BLOCKED_ON_OWNER_DECISION`。本小修**不关闭**其中任何一项，也不改变其通过条件。
- §26.34.8 / §26.34.10 的幂等合同**不**构成对 A1-I1 / A1-I2 验收状态的任何改变，也**不**等同于 Design PASS。
- `AUD-OUT-001` 的 `DEFERRED_NOT_AUTHORIZED` 状态、`M1C-G03/G06` 的既有 7/7 PASS、`B-P01/B-P02`、`D-P01/D-P02`、`SCP-01..10/12..15` 与 `M-15` 的原状态**全部不变**。
- 本小修只修改 `docs/design/procurement-outsourcing.md`。**未**修改 `docs/requirements/`、`document.md`、`server/`、`src/`、`scripts/`、数据库 Schema / Migration；**未**运行 Migration、数据库写入、真实 MySQL Gate 或任何业务测试。
- Design 修订完成后 **HARD STOP**：须由业务 Owner 明确批准 Requirement §31.14、§26.34 及其小修、Implementation 范围，以及各个 Schema / Migration 的独立授权，方可进入实现阶段。

#### 26.34.13 OUT-001 实施前置：I3a / I3b 两批划分（2026-11-08；PENDING_REVIEW）

> **定位 / Owner / 状态**：本小节属于 §26.34 的待审 Design 修订，Owner 为 Procurement & Outsourcing Domain Owner。它把 §26.34.2 的 OUT-001 风险登记与 §26.34.4～§26.34.11 的既有合同收敛为**两批可实施的候选划分**。**不签发** Requirement 验收或 `DESIGN_PASS`，**不授权**任何 Implementation、Schema / Migration、数据库操作或真实 MySQL Gate。`AUD-OUT-001` 保持 `DEFERRED_NOT_AUTHORIZED`，本小节**不**改变该标签。

##### 26.34.13.1 产品目标保留（不得无条件关闭整个 WIP Transfer）

- **委外 WIP 跨订单的合法数量归属转移仍是获批产品目标**（§31.14.2、§26.34.2）：在 Supplier WIP 物理位置不变、订单间**逻辑数量归属**、数量守恒、来源可证明、无成本携带的条件下，该能力**必须保留**。
- 本次实施前置**不**、也**不得**把 `POST /api/procurement/outsourcing/wip-transfers` 整体关闭为 409「功能已下线」。整体关闭只属于「有界 `SAFE_CLOSE`」的其它 Issue 处置类别，**不是** OUT-001 的处置类别；§26.34.2 已明确「不批准关闭整个接口」。
- 继续 fail closed 的路径（**必须**保持 409，且**必须**留单次拒绝审计）：历史身份不可证明（`OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED`）、LOT / SERIAL 或跟踪产品（`OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED`）、成本 / 价值携带（`OUTSOURCING_WIP_TRANSFER_COST_POLICY_PENDING`，`B-P01` 延期期间）、身份余额冲突、目标行不唯一、订单状态不允许、业务期间关闭、数量越界（`OUTSOURCING_WIP_TRANSFER_OVERDRAW`）或并发败方（`OUTSOURCING_WIP_TRANSFER_CONCURRENT_CONFLICT`）。
- 「保留合法数量转移」与「不安全路径 fail closed」**同时成立**是本设计的核心。任何一方被无条件取消，都超出本小节授权。

##### 26.34.13.2 I3a-S —— 不修改 Schema 的安全加固（**可独立实施**）

> **可实施性结论（依据 §26.34.14.1 的代码级证据）**：本清单的每一项都**不需要**身份 effect 链即可正确实施；其可观测结果是**稳定 409 + 零业务副作用 + 单次拒绝审计**，**不包含**任何正向 201。

| # | 事项 | 合同要点 | 依据 |
|---|---|---|---|
| I3a-S-1 | 请求合同与输入校验 | 允许字段集合新增 `body.idempotencyKey`（当前该字段被 400 `VALIDATION` 拒绝）；数量必须有限正数、精度合法；业务日期 `YYYY-MM-DD`；源 / 目标订单不同，固定 400 `OUTSOURCING_WIP_TRANSFER_SAME_ORDER`（**属输入校验，不是业务门禁 409**）；缺键 400 `IDEMPOTENCY_KEY_REQUIRED`；非法输入 400 且零业务写入 | §26.34.8.1、§26.34.5.2 |
| I3a-S-2 | 事务内权威重读 | 源 / 目标订单状态、源 / 目标物料行余额、产品跟踪策略、身份余额、期间状态一律在**事务内**重读；**不得**沿用事务外读取的余额作为写入依据 | §26.34.5.1 第 2 条 |
| I3a-S-3 | 幂等合同落地 | 键来源、作用域、指纹、固定响应与同事务提交按 §26.34.8 执行；不得自行更改全局幂等合同 | §26.34.8 |
| I3a-S-4 | 数量守恒与并发守卫 | 源减目标增必须成对；以受影响行数 / 余额条件更新（CAS）保证不超额；竞争败方 409 且零业务副作用 | §26.34.4.3、§26.34.5.3 |
| I3a-S-5 | 拒绝审计单一边界 | 业务 409 在事务回滚后由**单一**边界调用 `auditBusinessRejection()` 记录**恰好一条**；handler 与统一错误层不得双记；400 / 403 沿既有合同 | §26.34.5.2、§26.34.9.2 第 8 条 |
| I3a-S-6 | 身份路径继续 fail closed | **保持**既有 `OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED` 行为：源行存在任何身份余额时拒绝。I3a-S **不**放宽该门禁 | §26.34.13.1、§26.34.14.1 |
| I3a-S-7 | 历史可证明性守卫 | 源行 `legacy_unverified_wip_quantity IS NULL` → 409 `OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED`（当前该守卫**缺失**）；`identity_evidence_state` 必须为 `VERIFIED` | §26.34.4.2、§26.34.13.1 |
| I3a-S-8 | `transferNo` 稳定生成 | 按 §26.34.14.2 的最小稳定编号方案生成；唯一性证明是随机后缀而非毫秒时间戳；`id` 与 `transferNo` 在业务事务**内**铸造并与幂等记录同事务持久化 | §26.34.14.2 |
| I3a-S-9 | 目标行唯一性与 UOM 核验 | 目标行候选数必须**严格为 1**（`get()` / `LIMIT 1` 不构成唯一性证明）；源行 `unit` 与产品基础 UOM 不一致 → 409 | §26.34.4.2、§26.34.8.2 |
| I3a-S-10 | 锁与事务边界 | 按 §26.34.9.2 以 `try/finally` 包裹并复用 `releaseMySqlIdempotencyLocks(db)`；不确定 COMMIT 按 §26.34.14.3 的严格恢复条件处置，**不得**以新键自动重建业务事实 | §26.34.9.2、§26.34.14.3 |
| I3a-S-11 | 回归断言 | 逐字段业务快照（源 / 目标 `issued_quantity`、转移表、幂等记录、审计、库存 / 估值 / AP / GL）+ 拒绝审计恰好一次 + 幂等同键重放 / 异载荷冲突 / 缺键三态；**断言必须是固定结果**，见 §26.34.14.1 | §26.34.5.3、§26.34.14.1 |

**I3a-S 的边界**：**不修改任何 Schema / Migration**，**不**新增表、列、索引或约束；**不**实现身份 effect / 分配链（属 I3b）；**不**实现来源追溯的新持久化列（§26.34.14.3 证明其非必需）；**不**放宽 `B-P01` / `B-P02` 延期边界；**不**触碰 M1-Core 已批准 Gate 的原合同。

##### 26.34.13.2b I3a-P —— 正向 201 行为（**必须依赖 I3b**，不得单独实施）

> **依赖结论**：正向 `201 {id, transferNo}` **无法**在 I3a-S 之内获得。理由见 §26.34.14.1：当前唯一能承载「已证明 WIP 数量」的物料行，恰好就是**必然带身份余额**的行；I3a-S 不实现身份链，若在这些行上放行 201，就会产生 §26.34.4.3 所禁止的「只改两条 `issued_quantity`」状态，使身份账与数量账脱节。因此 **I3a-P 与 I3b 必须同批实施**。

| # | 事项 | 合同要点 | 依赖 |
|---|---|---|---|
| I3a-P-1 | 成对身份效力 | 同一事务内形成源行 `TRANSFER_OUT`（`effect_direction='CONSUME'`，`signed_quantity<0`）与目标行 `TRANSFER_IN`（`effect_direction='SUPPLY'`，`signed_quantity>0`），`business_event_id` 恒等于转移事实 ID | **I3b** |
| I3a-P-2 | `TRANSFER_ORIGIN` 分配 | 源行 `TRANSFER_OUT` 按供给占用比例分配到源行既有 SUPPLY effect（`allocation_kind='TRANSFER_ORIGIN'`，`source_supply_effect_id` 指向合法的**原始 SUPPLY effect**）；目标行 `TRANSFER_IN` 通过 `source_effect_id` 关联该 `TRANSFER_OUT` effect，**不得**以分配行表达该关联；每笔供给的累计分配不得超过原供给。身份链的权威规范正文见 **§26.34.15.2** | **I3b** |
| I3a-P-3 | 数量与身份守恒 | `Σ transfer_out = Σ transfer_in = requested quantity`；源行 `available_quantity` 相应减少、目标行 `available_quantity` 相应增加；`available_quantity = supplied - consumed` 恒成立 | **I3b** |
| I3a-P-4 | 物理与成本不变量 | 物理库存 `inventory_positions` / `inventory_transactions` / `tracked_inventory_movements` **无新增数量移动**；企业所有权不变；成本字段保持未证实，**零携带** | **I3b** |
| I3a-P-5 | 正向验收断言 | 合法 NONE 路径必须断言**固定 201** `{id, transferNo}`，并断言身份 effect / 分配链 / 数量守恒 / 物理零移动。**禁止**以 `201 || 409` 作为正向验收 | **I3b** |

##### 26.34.13.3 I3b —— 来源追溯与身份效力（**经 §26.34.14.1 核验：不需要新增 Schema**）

> **Schema 结论（2026-11-08 只读代码核验）**：既有 `outsourcing_wip_identity_effects` / `..._effect_allocations` / `..._identity_balances` 的表、列、CHECK、UNIQUE 与 FK **已经能够完整表达**跨订单 WIP 数量归属转移的来源追溯与身份效力链；`TRANSFER_IN` / `TRANSFER_OUT` / `TRANSFER_ORIGIN` 早已在 CHECK 约束中声明（`server/migrations/procurement-outsourcing-schema.js:743`、`:767`），缺的**只是 Writer**。因此 **I3b 不以任何 additive Migration 为前置条件**；此前候选的 `source_material_list_id` 已被**降级为可选便利项**（见 I3b-2）。

| # | 事项 | 合同要点 | 门禁 |
|---|---|---|---|
| I3b-1 | 身份效力 Writer | 复用 `server/modules/outsourcing-inventory.js` 的唯一规范 Writer 路径扩展 `TRANSFER_OUT` / `TRANSFER_IN` / `TRANSFER_ORIGIN`；**不得**新建第二套账本、不得绕过既有分配算术 | **无需 Schema 授权**；需 Owner 批准 Implementation 范围 |
| I3b-2 | 来源行可追溯 | 源行由**转移事实 ID → `TRANSFER_OUT` effect 的 `material_list_id`** 唯一确定（`business_event_id` = 转移事实 ID）；既有 `outsourcing_wip_transfers.material_list_id` 继续表示**目标行**，语义不变。**可选便利项**（非必需）：新增 `source_material_list_id TEXT NULL` 以便免 JOIN 直读 | 可便利项**如实施，须单独申请 additive Migration 授权**（含双端 parity、备份与回滚）；**未获授权时不影响 I3b 交付** |
| I3b-3 | 历史行处理 | 历史转移行**不**补写、不回填；历史来源不可证明者只读标 `SOURCE_UNVERIFIED`，不得据 `source_order_id` + 目标产品事后 JOIN 伪造确定性证据 | 同上 |
| I3b-4 | 双向追溯 | `transferId → sourceOrderId + sourceMaterialListId → targetOrderId + targetMaterialListId` 正反双向可追溯 | 同上 |
| I3b-5 | 物理与成本不变量 | 物理库存 `inventory_positions` / `inventory_transactions` / `tracked_inventory_movements` **无新增数量移动**；企业所有权不变；成本字段保持未证实，**零携带** | §26.34.4.3、`B-P01` |
| I3b-6 | 证据要求 | SQLite 与 MySQL 8 分别验证身份链在并发下的守恒、失败零副作用与重放稳定；**真实 MySQL Gate 仍需独立授权** | **需单独授权**（真实 MySQL Gate） |

**I3b 的边界**：I3b 与 **I3a-P 必须同批实施**（§26.34.13.2b）。I3b **不**要求任何 additive Migration；可选便利项 `source_material_list_id` 若被提出，**必须单独申请授权**，不得与 I3b 打包执行，也**不得**成为 I3b 的前置条件。I3a-S 仍可独立实施，与 I3b 无耦合。

##### 26.34.13.4 实施前置条件与 HARD STOP

- **I3a-S、I3a-P、I3b 三者均未获授权**：本小节只是**候审修订**。
  - **I3a-S** 须由业务 Owner 明确批准 Implementation 范围；其验收断言是**固定 409 + 固定 code + 零副作用**，**不含**任何正向 201。
  - **I3a-P** 与 **I3b** 必须**同批**批准（依据 §26.34.14.1），并与 §26.34.14.2 的编号方案、§26.34.14.3 的恢复条件一并获批。
  - **I3b 不以任何 additive Migration 为前置条件**（依据 §26.34.14.1 与 §26.34.13.3）；可选便利项 `source_material_list_id` 若被提出，须单独申请 additive Migration 授权。
- I3a-S 的实施须先具备：Requirement 侧可引用的「数量归属守恒 + 不可证明路径 fail closed」合同（§31.14.2 当前为 `PENDING_APPROVAL`）与本 Design 的批准（§26.34 当前为 `PENDING_REVIEW`）。
- **2026-11-08 更新**：上述两项前置对 **OUT-001 本工作包**已由业务所有者**有界批准**满足（§31.14.2 获批为适用合同；§26.34 中 OUT-001 相关范围获有界批准），两批实施范围与身份链修正见 **§26.34.15**。本小节其余结论不变。
- 本小节自身**不**改变 `AUD-OUT-001` 的 `DEFERRED_NOT_AUTHORIZED` 标签（该标签的实际迁移见 **§26.34.15.4**），**不**改变 M1C-G03 / G06 既有 7/7 `PASS` 的范围，**不**改变 `B-P01` / `B-P02`、`D-P01` / `D-P02`、`M-15`、`SCP-01`～`SCP-16` 的原状态，也**不**开放 VMI-05。
- **HARD STOP**：本小节完成后不进入生产代码 Implementation。

#### 26.34.14 OUT-001 Design Dependency Review（2026-11-08；PENDING_REVIEW）

> **定位 / Owner / 状态**：本小节是 2026-11-08 对 OUT-001 实施前置的**只读依赖审查**结论，Owner 为 Procurement & Outsourcing Domain Owner。依据为只读代码审查与一次性临时 SQLite 探针（**探针脚本位于仓库之外**，不在仓库内创建或修改任何文件，不连接生产数据库，不执行 DDL）。它**细化** §26.34.13 的批次划分，**不签发** Requirement 验收或 `DESIGN_PASS`，**不授权**任何 Implementation、Schema / Migration、数据库操作或真实 MySQL Gate。

##### 26.34.14.1 结论一：I3a 不实现身份链却要求保留合法转移 —— 结构性冲突与证据

**代码级事实（只读核验，`master` @ `ba5dbb4a105abe5b2ab36ffe48a851317be300c2`）**：

| # | 事实 | 位置 |
|---|---|---|
| F1 | 正常发料 `issueMaterial()` 在同一事务内调用 `executeOutsourcingMove(..., direction:'SUPPLY')`，后者调用 `recordSupply()` | `server/modules/outsourcing.js:490`；`server/modules/outsourcing-inventory.js:218-219` |
| F2 | `recordSupply()` 为 NONE 产品写入 `outsourcing_wip_identity_effects`（`effect_direction='SUPPLY'`、`event_type='ISSUE'`）**并** upsert `outsourcing_wip_identity_balances`（`identity_key='NONE'`、`evidence_state='QUANTITY_ONLY'`） | `server/modules/outsourcing-inventory.js:74-93` |
| F3 | 同一发料事务把 `outsourcing_material_list.issued_quantity` 加上数量并置 `identity_evidence_state='VERIFIED'` | `server/modules/outsourcing.js:493` |
| F4 | `createWipTransfer()` 只要源行存在**任意**身份余额行就抛 409 `OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED` | `server/modules/outsourcing-finance.js:409-414` |
| F5 | `createWipTransfer()` 的容量检查用 `issued + supplemented - returned - backflushed`；从未发料的行该值为 0 | `server/modules/outsourcing-finance.js:415-416` |
| F6 | `outsourcing_material_list.issued_quantity` 的**唯一**生产写入方是 F3 的发料路径 | `server/modules/outsourcing.js:493` |
| F7 | `TRANSFER_IN` / `TRANSFER_OUT` / `TRANSFER_ORIGIN` 只出现在 schema 的 CHECK 约束与测试断言中，**无任何生产 Writer** | `server/migrations/procurement-outsourcing-schema.js:743`、`:767`；`server/modules/**` 无写入点 |
| F8 | 身份 effect 表为**只追加**：无 `DELETE FROM outsourcing_wip_*`，无对 `outsourcing_wip_identity_effects` 的 `UPDATE` | 全仓检索无命中 |

**推论（冲突的根因）**：

- 由 F1 + F2 + F3 + F6：**任何**拥有可证明 WIP 数量的物料行，必然同时拥有身份余额行。
- 由 F4：这些行今天**全部**被 409 拒绝 —— 包括身份证据恰好就是 §26.34.4.3 第一实施候选（非跟踪产品、`identity_key='NONE'`、`evidence_state='QUANTITY_ONLY'`）的行。
- 由 F4 + F5 反向推论：没有身份余额的行必然从未发料，容量为 0，任何正数量转移必然 409。
- ⇒ **当前实现下 `POST /api/procurement/outsourcing/wip-transfers` 不存在任何可返回 201 的路径**：接口事实上已对全部可证明行关闭，而**不是**被安全地限制在"不支持的子集"内。

**因此**：

1. **I3a-S（安全加固）可独立实施**，其正确可观测结果是**稳定 409 + 零业务副作用 + 单次拒绝审计**；I3a-S **不产生**任何正向 201。
2. **I3a-P（正向 201）必须依赖 I3b**：若在没有身份链的行上放行 201，就会产生 §26.34.4.3 明确禁止的「只更新两条 `issued_quantity`」状态，使身份账与数量账脱节。
3. §26.34.13.1「保留合法数量归属转移的产品目标」**仍然成立**，但其**可实现路径**是 **I3a-P 与 I3b 同批实施**，而不是 I3a 单独放行。

**一次性探针观测**（临时 SQLite，脚本在仓库之外；不连接生产库、不执行 DDL）：

| 场景 | 观测结果 |
|---|---|
| 正常发料 5 PCS（非跟踪产品）后源行身份余额 | `identity_key='NONE'`、`identity_type='NONE'`、`evidence_state='QUANTITY_ONLY'`、`supplied=5`、`consumed=0`、`available=5` |
| 同一源行的身份 effect | `effect_direction='SUPPLY'`、`signed_quantity=5`、`event_type='ISSUE'` |
| 源行物料行 | `issued_quantity=5`、`identity_evidence_state='VERIFIED'` |
| 对该行发起 3 PCS 转移 | **409 `OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED`** |
| 请求携带 `idempotencyKey` | **400 `VALIDATION`**（该字段当前不在允许字段集合内） |
| 以**目标**行充当源行发起转移 | 404（`materialListId` 必须是**源**行） |

**验收断言的硬性要求**：既有 `server/outsourcing-finance.test.js:232` 使用 `assert.equal(transfer.status === 201 || transfer.status === 409, true)` —— 这**不是**正向验收，也不构成任何正向证据。I3a-S 的验收断言必须是**固定 409 + 固定 code + 逐字段零副作用快照**；I3a-P 的验收断言必须是**固定 201** + 身份链与守恒断言。**任何一档都不得使用 `201 || 409`。**

##### 26.34.14.2 结论二：`transferNo` 最小稳定编号方案

**现状与问题**：`server/modules/outsourcing-finance.js:418` 生成 `'WIP-XFER-' + Date.now().toString().slice(-10)`；`outsourcing_wip_transfers.transfer_no` 为 `TEXT NOT NULL UNIQUE`（`server/migrations/procurement-outsourcing-schema.js:650`）。问题有二：

1. **唯一性证明错误**：毫秒时间戳截断**不能**保证唯一 —— 同毫秒内的两次转移必然相同。仓库的规范做法是**时间戳只作可读前缀、随机后缀承担唯一性**（`server/modules/financial-controls.js:23`、`server/modules/procurement-orders.js:29`、`server/modules/consignment.js:375`）。
2. **稳定性缺失**：编号在事务**外**铸造，且不与幂等记录绑定；同一业务事实在不确定 COMMIT 之后重试会铸出**新**编号，使幂等记录与转移事实脱钩。

**最小稳定编号方案**：

```text
transferNo = `WIP-XFER-${businessDateYYYYMMDD}-${randomUUID 去连字符后取前 12 位大写十六进制}`
```

| 性质 | 规定 |
|---|---|
| 唯一性证明 | **随机后缀**（UUIDv4 的随机源截取 12 位十六进制 = 48 位）；`transfer_no UNIQUE` 约束作为最终兜底 |
| 可读前缀 | **业务日期** `YYYYMMDD`，**不取墙上时钟**，因此不受时钟回拨与并发重试影响 |
| 禁止 | **不得**以 `Date.now()` 截断或任何纯时钟值作为唯一性来源 |
| 铸造时机 | 在业务事务**内**铸造，并与转移事实行、幂等记录 `result_json` **同一事务**持久化 |
| 精确重放 | **原样返回**已持久化的 `transferNo`，**不得**重新铸造 |
| 不确定 COMMIT 后 | 仅在 §26.34.14.3 的恢复条件成立且已证明原事实**未提交**时，才由重试铸造新编号（此时不存在"原编号"） |
| 冲突处置 | `transfer_no` UNIQUE 冲突必须映射为稳定错误码（409），**不得**暴露为 500 |

**与仓库既有风格的关系**：`financial-controls.js:23` 的 4 位十六进制后缀只有 16 位熵，弱于本方案。本方案在**位数**上取 12 位（48 位），在**前缀**上改用业务日期而非墙上时钟，在**语义**上把编号绑定到事务与幂等记录。允许实现时按既有 `number(prefix)` helper 风格封装，但**熵来源与持久化语义不得削弱**。

##### 26.34.14.3 结论三：不确定 COMMIT 的安全恢复条件（收紧）

**为什么"查询不到记录"不构成未提交证明**：MySQL 的 READ COMMITTED 下，未提交事务的行对其它会话不可见；因此在原事务**仍可能提交**的时刻读到"无记录"，与"原事务已回滚"**不可区分**。请求超时时 Worker 仍可能在执行该语句，原会话的开放事务可能在稍后才提交。

**允许按原 Key 重试的必要条件（必须全部成立，缺一即禁止重试）**：

| # | 条件 | 判定依据 |
|---|---|---|
| R1 | **原会话已终止且终止已确认** | 原适配器已被隔离，且 `quarantineState.state === 'TERMINATION_CONFIRMED'`（`sessionState === 'TERMINATED'`）。`TERMINATION_PENDING` 与 `TERMINATION_FAILED` **均不满足**本条件 | `server/database/mysql-adapter.js:131-157` |
| R2 | **未决事务已随会话收束** | R1 成立后，服务端回收该会话，其开放事务被回滚、其命名锁被释放。原会话**仍存活**（含仅 `TERMINATION_PENDING`）时本条件**不成立** | `server/db.js:2287-2288`（`sessionDestroyed` 释放路径） |
| R3 | **核验连接可信且与原会话不同** | 核验必须在**另一条**可信连接上执行，且由三项共同成立：(a) 核验连接由**独立创建的 Adapter** 提供（不是其它会话的复用，也不是被隔离适配器的复用）；(b) 该连接是**可信会话**：`mysqlSessionState()` ∈ `{IDLE_TRUSTED, FRESH}`；(c) 该连接的 **connection id** 与原会话不同。**禁止**跨 Adapter 比较会话 epoch —— epoch 是**每个 Worker 内部**的局部计数器，两个独立 Adapter 的原始数字互不可比；epoch 只用于证明**同一 Worker 自身**的 session replacement。**禁止**在被隔离的适配器上核验 | `server/db.js:2152-2159`、`server/test-utils/out001-m3-identity.js` |
| R4 | **核验在 R1 之后执行且为只读** | 顺序不可颠倒：先确认会话终止，再只读核验 `(operationType, documentId, key)` 作用域下的幂等记录与转移事实行；核验必须是只读事务，**不得**写任何行 | `server/db.js:2409`（`readTransaction`） |
| R5 | **无并发未决写入** | 作用域的 MySQL 命名锁在核验与重试之间**不得**被他人持有；重试必须经由正常路径的 `idempotencyReplay()` 重新获取该锁，使并发写入被串行化 | `server/modules/financial-controls.js:35-41` |

**明确禁止**：

| # | 禁止项 |
|---|---|
| P1 | 以**新的**幂等键重试（会绕开既有幂等记录，可能产生第二笔业务事实） |
| P2 | 仅以"查询不到记录"作为未提交证明（必须先满足 R1 + R4） |
| P3 | 在被隔离 / 终止未确认 / 终止失败的连接上执行核验或重试 |
| P4 | 在未记录恢复决定与审计的情况下自动重试 |
| P5 | 在 R1～R5 任一不成立时把操作标记为"可重试" |

**允许的重试路径**：R1～R5 全部成立后，以**同一**幂等键、**同一**规范化载荷重新进入正常路径（先做重放查找；若记录此时存在，即为重放而非新写）。重试产生的 `id` / `transferNo` 是**新的**业务事实编号，与 §26.34.14.2 一致（原事实已证明未提交）。

**处置的实现合同（2026-11-09 明确）**：`transaction()` 判定「COMMIT 已发出但未被确认」（`mysqlRequestTimeout` 或 `sessionLost`）时，必须**先于任何收尾动作**进入专门的不确定 COMMIT 分支，顺序固定为：

1. 在**原**异常上保留其 `classification`、`sessionLost`、`mysqlRequestTimeout` 与原始错误码，并附加**不确定 COMMIT 标记**传给上层调用者；
2. **立即隔离**原适配器（原因 `uncertain_commit`），由适配器终止其 Worker；
3. **禁止**在原适配器上发出 `ROLLBACK`（COMMIT 结果未知，ROLLBACK 可能落在已提交事务之后或另一语句之后）；
4. **禁止**在替代会话上代替原会话收尾；
5. **禁止**重跑事务工作体；
6. **不得**把原适配器恢复成可复用的可信空闲状态；
7. 命名锁登记**只在**终止确认为 `TERMINATION_CONFIRMED` 之后才按「随会话销毁由服务器回收」清理；`TERMINATION_FAILED` 时保持隔离，**不得**冒充 `SESSION_DESTROYED`。

上层 handler 的对应义务：不确定 COMMIT **不是**已确认的业务拒绝，因此**不得**写入普通拒绝审计、**不得**在已被隔离的适配器上继续写入、**不得**产生第二笔业务事实；原异常原样上抛，处置由 R1～R5 决定。普通业务错误、明确 `ROLLBACK` 与可证明安全的重试路径保持既有行为不变。

**审计义务**：恢复决定（成立 / 不成立、依据哪几条条件、终止状态、原会话自身的会话替换证据）必须写入审计；不成立时必须保持隔离并升级处置，**不得**静默降级为普通失败。审计记录会话标识时，只允许使用**原会话自身**可证明的标识（其 connection id，以及其 Worker 自身 epoch 的递增）；**禁止**把核验连接的 epoch 与原会话的 epoch 互相比较——两者是互不相干的局部计数器，比较结果没有技术意义。

##### 26.34.14.4 本轮审查的边界

- 本轮**只**做只读代码审查、一次性临时 SQLite 探针与 Design 文档修订；**未**修改任何 `server/` / `src/` / `scripts/` 文件，**未**执行 DDL / Migration，**未**连接真实数据库，**未**运行任何 Gate。
- 本轮**不**签发 Requirement 验收或 `DESIGN_PASS`，**不**授权任何 Implementation。§26.34 仍为 `PENDING_REVIEW`，§31.14 仍为 `PENDING_APPROVAL`。
- 本轮**不**改变 `AUD-OUT-001` 的 `DEFERRED_NOT_AUTHORIZED` 标签，**不**改变 M1C-G03 / G06 既有 7/7 `PASS`、`B-P01` / `B-P02`、`D-P01` / `D-P02`、`M-15`、`SCP-01`～`SCP-16` 的原状态，**不**开放 VMI-05。
- 探针脚本位于仓库之外的一次性临时目录，**未**在仓库内创建或修改任何文件；其观测结论以本节 F1～F8 的源码事实为准。

**HARD STOP**：本小节完成后不进入生产代码 Implementation。

#### 26.34.15 OUT-001 有界实施授权、身份链引用修正与两批范围登记（2026-11-08；OUT-001 相关范围已获有界批准）

> **定位 / Owner / 状态**：本小节属于 `docs/design/procurement-outsourcing.md` §26.34，Owner 为 Procurement & Outsourcing Domain Owner。业务所有者于 **2026-11-08** 在本轮任务说明中**有界批准** §26.34 中 **OUT-001 相关范围**（即 §26.34.2、§26.34.4.2～§26.34.4.3、§26.34.5、§26.34.8、§26.34.9、§26.34.13、§26.34.14）的 Implementation，并**同时**修正其身份链引用、登记两批实施范围。它**不**签发 §26.34 整体 `DESIGN_PASS`，**不**把 §31.14 整节标为 `APPROVED`，**不**授权 Schema / Migration、数据库操作或真实 MySQL Gate，也**不**签发任何 Acceptance。

##### 26.34.15.1 Owner 有界批准的边界

| 项 | 决定 |
|---|---|
| Requirement | §31.14.2 按「现有数量归属守恒 + 历史不可证明 fail closed + 成本携带延期」三项原则，**批准为 OUT-001 本工作包的适用合同**。§31.14 **整节**的其余内容（VMI-01..05）**未**获批准 |
| Design | §26.34 中 OUT-001 相关范围**有界批准**：允许先完成 §26.34.15.2 的最小身份链引用纠正，再连续执行 §26.34.15.3 登记的两批 Implementation |
| **未**批准 | §31.14 / §26.34 **全域闭合**；VMI（VMI-01..05 与 `D-P01` / `D-P02`）；`PRC-06`；`B-P01` / `B-P02` —— **原状态一律不变** |
| **未**批准 | 任何新增 Schema / Migration（含 §26.34.13.3 I3b-2 的可选便利项 `source_material_list_id`）；连接真实 MySQL 或生产数据库；Push / Merge / Tag / Release / Deploy |

##### 26.34.15.2 身份链引用修正（规范正文）

本小节是 §26.34.4.3 与 §26.34.13.2b（I3a-P-1 / I3a-P-2）身份链引用的**唯一权威修正正文**。跨订单 WIP 数量归属转移的身份链固定为：

```text
原始 SUPPLY（源行 · effect_direction='SUPPLY' · event_type ∈ {ISSUE, SUPPLEMENT}）
   │  TRANSFER_ORIGIN 分配：effect_id = TRANSFER_OUT effect
   │                       source_supply_effect_id = 上面的原始 SUPPLY effect
   ▼
TRANSFER_OUT（源行 · effect_direction='CONSUME' · signed_quantity < 0）
   │  source_effect_id：目标行 effect → TRANSFER_OUT effect
   ▼
TRANSFER_IN（目标行 · effect_direction='SUPPLY' · signed_quantity > 0）
```

| # | 规则 | 规范正文 |
|---|---|---|
| C1 | `TRANSFER_OUT` = **源行** `CONSUME` | `material_list_id` = **源**物料行 ID；`effect_direction='CONSUME'`；`signed_quantity = -转移数量`；`event_type='TRANSFER_OUT'` |
| C2 | `TRANSFER_OUT` 使用 `TRANSFER_ORIGIN` 分配 | `allocation_kind='TRANSFER_ORIGIN'`；`effect_id` = 该 `TRANSFER_OUT` effect；`source_supply_effect_id` **必须指向合法的原始 SUPPLY effect**（源行既有 `effect_direction='SUPPLY'` 且 `event_type ∈ {ISSUE, SUPPLEMENT}` 的 effect），按供给占用比例分配，累计分配不得超过该供给数量 |
| C3 | `TRANSFER_IN` = **目标行** `SUPPLY` | `material_list_id` = **目标**物料行 ID；`effect_direction='SUPPLY'`；`signed_quantity = +转移数量`；`event_type='TRANSFER_IN'` |
| C4 | `TRANSFER_IN` 通过 `source_effect_id` 关联对应 `TRANSFER_OUT` | `source_effect_id` = 同一次转移的 `TRANSFER_OUT` effect ID；该关联**只**由 `source_effect_id` 表达，**不得**用分配行表达 |
| C5 | **禁止**把 `TRANSFER_OUT` 作为 `source_supply_effect_id` 的供给来源 | `TRANSFER_OUT` 是 `CONSUME` 效应而非供给。把它当作供给来源会建立「分配指向非供给」的记录，破坏「每笔供给被消费/转移的累计分配不得超过原供给」的算术前提，并把来源链方向倒置 |
| C6 | 源 / 目标 effect 的 `business_event_id` 必须关联**同一个** WIP Transfer ID | 两侧 effect 的 `business_event_id` 恒等于 `outsourcing_wip_transfers.id`；这是 `transferId → 源行 / 目标行` 双向追溯的唯一锚点 |

C2 的**供给来源封闭性**（2026-11-08 定向修补确认）：`TRANSFER_IN` 本身也是 `effect_direction='SUPPLY'`，因此 C2 的「原始 SUPPLY effect」必须按 `event_type ∈ {ISSUE, SUPPLEMENT}` 进一步限定；`TRANSFER_IN` **不得**被当作原始供给来源。源行没有可覆盖本次转移数量的原始 ISSUE / SUPPLEMENT 供给时，该转移固定 409 `OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED`、零业务副作用、单次拒绝审计。本轮**不新增**多级递归来源功能：跨级追溯（目标行的 `TRANSFER_IN` 再向下追溯到更早订单的原始供给）属**未批准**能力，不得以任何形式实现或暗示。

C2 与 C4 合起来表达「原始供给 → 源转出 → 目标转入」的完整链条；C5 明确排除把 C4 的关联倒置为分配语义。C1～C6 与既有 Schema 完全相容：`TRANSFER_IN` / `TRANSFER_OUT` / `TRANSFER_ORIGIN` 早已在 `outsourcing_wip_identity_effects` / `..._effect_allocations` 的 CHECK 约束中声明，缺的只是 Writer，因此**不需要**任何 additive Migration。

##### 26.34.15.3 两批 Implementation 范围登记

| 批次 | 范围 | 依赖 | 可观测结果 |
|---|---|---|---|
| **I3a-S** | §26.34.13.2 的 I3a-S-1 ～ I3a-S-11 | 无（不依赖 I3b） | **不含任何正向 201**；稳定 400 / 403 / 404 / 409 + 固定 code + 零业务副作用 + 单次拒绝审计 |
| **I3a-P + I3b** | §26.34.13.2b 的 I3a-P-1 ～ I3a-P-5 与 §26.34.13.3 的 I3b-1 ～ I3b-6；身份链按 §26.34.15.2 | 两项**同批**实施 | 合法 NONE 路径**固定 201**；同 Key 精确重放 201 `replayed:true`；同 Key 异载荷 409；身份链与数量账守恒；物理库存零新增移动 |

两批的顺序与边界：

1. I3a-S 先实施并独立提交。I3a-S 的验收断言**只能是**固定拒绝结果；**不得**声称正向 201、成功幂等精确重放或身份链已在本阶段验证。
2. I3a-S 通过后连续实施 I3a-P + I3b；两批各自形成**独立**的本地逻辑 commit。
3. I3b **不以任何 additive Migration 为前置条件**；可选便利项 `source_material_list_id` 本轮**未获授权**，因此不实施、不申请，且**不得**成为两批交付的前置条件。
4. 两批的 `transferNo` 按 §26.34.14.2 的最小稳定编号方案生成；幂等键来源、作用域与固定响应按 §26.34.8；MySQL 命名锁释放与不确定 COMMIT 处置按 §26.34.9.2 与 §26.34.14.3。

##### 26.34.15.4 本轮边界与 HARD STOP

- 本小节**不**改变 §26.34 中 OUT-001 相关范围以外的任何既有状态；`A1-D-RV-01` ～ `A1-D-RV-04` 四个 Owner Review Gate 状态不变。
- `AUD-OUT-001` 的标签由 `DEFERRED_NOT_AUTHORIZED` 迁移为 `IMPLEMENTATION_AUTHORIZED`（有界，见 §26.34.15.1 与 §26.34.15.3）。该迁移**只**表示本工作包获得了实施授权，**不**表示缺陷已修复或已验收；两批实施与本地验证完成后**仍不**签发 `AUD-OUT-001` 的 Acceptance，其状态最多推进到 `TESTED` / `PENDING_OWNER_APPROVAL`。
- `M1C-G03` / `M1C-G06` 既有 7/7 `PASS` 及其范围、`B-P01` / `B-P02`、`D-P01` / `D-P02`、`M-15`、`SCP-01` ～ `SCP-16`、`PRC-06` 与 B3101 / B3121 状态**全部不变**。
- 本轮**未**授权真实 MySQL Gate：不得运行、不得声称 PASS；`FULL` 回归若未完成须记录 `NOT_RUN`；旧功能 UAT 的既有失败**不得**改写为 PASS。
- **HARD STOP**：两批 Implementation 完成后停止，等待 Owner 技术复核与真实 MySQL Gate 授权；不得 Push / Merge / Tag / Release / Deploy。

#### 26.34.16 OUT-001 受保护真实 MySQL 8 Gate 范围登记（2026-11-08；GATE_IMPLEMENTED）

> **定位 / Owner / 状态**：本小节属于 `docs/design/procurement-outsourcing.md` §26.34，Owner 为 Procurement & Outsourcing Domain Owner。本小节只登记 **Gate 的范围与状态**，**不**执行 Gate，**不**签发任何 Acceptance。

##### 26.34.16.1 ACK-4 Manifest 与操作范围

OUT-001 使用**独立**的 ACK-4 Manifest `OUT_001_MYSQL_V1`，操作范围固定为四项：

| # | 操作 | 归属进程 | 说明 |
|---|---|---|---|
| 1 | `RESET_SCHEMA_PRE_RUN` | Root 的 operation 子进程 | 清空一次性目标；执行前必须有已消费的 ACK-4 Lease |
| 2 | `BOOTSTRAP_CURRENT_SCHEMA` | Root 的 operation 子进程 | 建立当前 Schema；**唯一**允许执行 DDL 的位置 |
| 3 | `RUN_OUT001_HTTP_FIXTURES` | Root 的 suite 子进程 | 运行固定套件 `server/mysql-out001.integration.js`；不接受任意传入脚本 |
| 4 | `CLEANUP_SCHEMA_POST_RUN` | Root 的 operation 子进程 | 清理 Schema；**唯一**有权 DROP 的位置 |

`M1_CORE_MANIFEST` 属于 M1-Core G07，**未被修改**，也未被本 Manifest 复用。OUT-001 不复用任何被 `blockUnmigratedAck4Entry` 阻断的旧入口。

##### 26.34.16.2 目标绑定与清理权责

- 目标必须精确绑定到那一个已批准的本地一次性 MySQL 8 目标（host / port / database / user），并核对 `server UUID`、`CURRENT_USER()`、有效授权的 SHA-256 指纹与 MySQL 8 版本；初始对象必须为空。
- 口令只经 DPAPI 在进程内解密，**不落盘、不入日志、不上命令行**。
- **Schema 清理只有一个归属进程**：Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程。测试进程只关闭自己的连接；`deferMySqlCleanup()` 把来自测试进程的清理请求变成「已延期」而不是执行。
- 全部 schema 清理失败 → ACK-4 终态 `CLEANUP_UNVERIFIED` → 写入 quarantine 标记；恢复需要**新的** ACK-4 批准。
- 收尾由**独立**的只读 postflight 核验五类数据库对象（tables / views / triggers / routines / events）为零。

##### 26.34.16.3 M1～M5 证据范围与已知不可达项

| # | 待证项 | 本 Gate 的证明方式 | 当前状态 |
|---|---|---|---|
| M1 | 命名锁获取 / COMMIT-ROLLBACK 释放 / 第二会话重新获取 | 两个**独立** MySQL 会话上的 `GET_LOCK` / `RELEASE_LOCK`；并证明应用自身的幂等命名锁在请求进行中被持有、在请求结束后被释放 | GATE_IMPLEMENTED（**未执行**） |
| M2 | 不同 Key、同源并发 | 两个**独立**应用进程（两个独立 MySQL 会话）+ `mysql_transaction_gates` 全局门禁作确定性屏障，逐个观察门禁等待者 | GATE_IMPLEMENTED（**未执行**） |
| M3 | COMMIT 不确定 / 会话终止 / R1–R5 | 真实 MySQL 上可判定：会话状态机、锁释放未确认 → 隔离 → `TERMINATION_CONFIRMED`；**真实**的「COMMIT 结果未知」由本地 TCP 代理在真实 MySQL 上产生（详见 §26.34.16.3.1）：服务端真的提交、客户端收不到确认，随后由**同一 MySQL 账户**的观察者终止 victim 会话。该路径**不需要** `CONNECTION_ADMIN` / `SUPER` / 额外 `PROCESS` 权限：MySQL 允许一个账户终止**自己**的会话，且同一账户的线程始终出现在自己的 `PROCESSLIST` 视图中。账户身份按固定口径核验（两侧 `CURRENT_USER()` 相同、`PROCESSLIST.USER` 只与配置用户名比较、数据库绑定、连接 id 互异），**禁止**把 `PROCESSLIST.USER` 与 `CURRENT_USER()` 直接比较。若 `KILL` 被拒绝或身份不匹配，测试**立即失败**，绝不自动提升权限 | GATE_IMPLEMENTED（**未执行**；真实不确定 COMMIT = `NOT_PROVEN_ON_REAL_MYSQL`） |
| M4 | CHECK / UNIQUE / FK / SQLite-MySQL Schema Parity | 真实 MySQL 上逐条触发并断言**具体**约束错误；双端 Parity 复用仓库既有 `compareTableParity` 比较器 | GATE_IMPLEMENTED（**未执行**） |
| M5 | `transfer_no` UNIQUE 冲突映射 | 真实 MySQL 重复键错误 + handler 分类器断言（映射为 409 `OUTSOURCING_WIP_TRANSFER_NO_CONFLICT`，不得暴露 500） | GATE_IMPLEMENTED（**未执行**） |

##### 26.34.16.3.1 M3「真实不确定 COMMIT」的验证方法（2026-11-09 修订）

**为什么必须换方法**：先前登记的「一次性 least-privilege 账户刻意没有 `KILL CONNECTION` 权限」这一前提**不成立**。MySQL 允许一个账户终止**自己**的会话，而同一账户的全部线程始终出现在自己的 `information_schema.PROCESSLIST` 视图中。因此「服务端已提交、客户端未收到确认」这一状态**可以在不提升任何权限的前提下**被真实制造出来。M3 因此不再以仓库自带的 recovery worker 夹具冒充真实证据：夹具只保留为**离线**代码路径证明，并被明确标注为离线模拟。

**故障注入装置**（`server/database/test-fixtures/mysql-commit-withholding-proxy.js`，仅测试用）：

| 项 | 约定 |
|---|---|
| 传输 | Node.js 内置 `node:net`，**不新增**任何 npm 依赖 |
| 监听 | 只绑定 `127.0.0.1` 的临时端口，**不监听**外部网络 |
| 上游 | 只连接**已经授权**的那一个 MySQL host/port |
| 协议 | 解析 MySQL packet framing（3 字节长度 + 1 字节 sequence id），正确处理 TCP 分包与粘包；`COM_STMT_PREPARE` / `COM_STMT_EXECUTE` 等非 `COM_QUERY` 报文原样透传 |
| 拦截 | 只识别 `COM_QUERY` 且语句**恰好**为 `COMMIT` 的报文；原样转发给真实服务端，等待服务端的 OK 报文后**暂存不转发**，并上报 `COMMIT_RESPONSE_WITHHELD` |
| 日志 | **不记录**认证包、口令、SQL 参数或任何原始报文，只记录事件名与字节数 |
| TLS | **不修改** TLS 配置。目标若启用 TLS，代理无法在不解析密文的前提下检查协议，因此调用方必须 **fail closed** |

**角色与顺序**：

1. **victim** —— 独立 HTTP 应用进程，其 MySQL 会话经代理连到真实服务端；它提交**真实**的 WIP Transfer。
2. **观察者** —— 与 victim **同一 MySQL 账户**的另一条独立会话，只做只读观察与**精确**终止。
3. 观察者在执行终止前必须先核验**账户身份**。核验口径固定为以下五条，任一不成立即失败：
   1. `victimCurrentUser === observerCurrentUser` —— 两侧的 `CURRENT_USER()`（即实际用于认证的 `user@host`）必须相同；
   2. `victimRow.user === targetConfig.user` —— `PROCESSLIST.USER` 只给出**用户名字符串**部分，因此只能与**配置的用户名**比较；
   3. `victimRow.db === targetConfig.database` —— victim 的 `PROCESSLIST.DB` 必须等于当前批准的测试数据库；
   4. `observerDatabase === targetConfig.database` —— observer 连接的数据库必须等于当前批准的测试数据库；
   5. `victimConnectionId !== observerConnectionId` —— 两侧必须是不同的连接，且 connection id 均为有效正整数。

   **`PROCESSLIST.USER` 与 `CURRENT_USER()` 严禁直接比较**：前者是裸用户名，后者是 `user@host`，二者语义不同。victim 侧的 `CURRENT_USER()` 与 `DATABASE()` 由独立应用进程的 `CONNECTION_ID` 探针一并取回（`SELECT CONNECTION_ID() id, CURRENT_USER() currentUser, DATABASE() databaseName`），observer 侧同样取回 `CURRENT_USER()` 与 `DATABASE()`。

   核验通过后**只允许**执行 `KILL CONNECTION <verified_victim_id>`；**禁止** `KILL QUERY`、禁止终止未核验的连接、禁止 `GRANT`、禁止获取 `CONNECTION_ADMIN` / `SUPER` / 额外 `PROCESS` 权限、禁止连接其它数据库。权限被拒或身份不匹配时**立即失败**。
4. 顺序固定为：提交真实业务事务 → 代理暂存服务端 COMMIT OK → 观察者终止 victim → 客户端收到真实连接丢失。

**R1～R5 的逐条判定**（对应 §26.34.14.3）：

| # | 判定 |
|---|---|
| R1 | 原适配器被隔离且 `quarantineState.state === 'TERMINATION_CONFIRMED'`（`TERMINATION_PENDING` / `TERMINATION_FAILED` 均不成立） |
| R2 | 原会话终止后，命名锁由**服务器**释放（`IS_FREE_LOCK(...) = 1`），事务随之收束 |
| R3 | 核验连接必须是**另一条**可信连接，由三项共同证明：(a) 核验连接由**独立创建的 Adapter** 提供（不是其它会话的复用）；(b) 它是**可信会话**（`mysqlSessionState()` ∈ `{IDLE_TRUSTED, FRESH}`）；(c) 它的 **connection id** 与原会话不同。**不**使用会话 epoch 跨 Adapter 比较（见下） |
| R4 | 在 R1 成立**之后**，以**只读事务**核验同一 `(operationType, documentId, idempotencyKey)` 作用域下的幂等记录与 WIP 转移事实：服务端 COMMIT 既然成功，就必须**恰好一笔**转移事实与**恰好一条**幂等记录，且二者指向同一笔事实 |
| R5 | 作用域的命名锁在核验与重试之间未被他人持有；相同幂等键重新进入**正常** `idempotencyReplay()` 路径，返回**原 id / 原 transferNo** 且 `replayed=true`，不新增转移事实、成功审计、身份 effect、数量效力，物理库存 / 估值 / AP / GL 零变化 |

**会话 epoch 的可判定边界（2026-11-09 复核修正）**：会话 epoch 是**每个 MySQL Worker 内部**的局部单调计数器，只有该 Worker 自己替换会话时才会递增。两个**独立 Adapter** 因此拥有两个互不相干的计数器，**禁止**把它们的原始数字互相比较来证明「会话不同」——那只是两个无关计数器的巧合，恒等于 1 时甚至无法区分任何情况。

因此：

- **R3 不再比较 epoch**，改由「独立创建的 Adapter + 可信会话 + 不同的 connection id」三项共同证明；
- victim 自身的 epoch `1 → 2` 只作为**victim 自己**的会话被替换的独立证据：epoch 递增说明该 Worker 重建了会话，MySQL 随之分配了新的 connection id，两者同时成立才算替换发生。该步骤由代理在故障注入**之前**故意销毁一次客户端会话触发，**只销毁传输，不触碰任何业务数据**；
- 判定逻辑集中在 `server/test-utils/out001-m3-identity.js`，真实 Gate 与离线回归共用同一实现；离线用例断言 R3 判定函数**不出现** epoch，且判定结果对任意 epoch 取值不变。

**禁止项**：不得以新的幂等键重建业务事实（P1）；不得仅以「查询不到记录」作为未提交证明（P2）；不得在被隔离 / 终止未确认 / 终止失败的连接上核验或重试（P3）；不得在未记录恢复决定与审计的情况下自动重试（P4）；不得在 R1～R5 任一不成立时把操作标记为可重试（P5）。**不确定 COMMIT 不等于已确认的业务拒绝**：它不得被写成普通拒绝审计，也不得在已被隔离的适配器上继续写入。

**离线回归与真实证据的边界**：确定性离线套件 `server/mysql-out001-m3-uncertain-commit.test.js` 覆盖 packet framing、COMMIT 识别、非 COMMIT 透传、COMMIT OK 暂存、代理超时 fail closed、无 socket 泄漏、不确定 COMMIT 不进入 `settleTransactionRollback()`、不建立新的 Worker 会话、终止确认后才清理锁登记、终止失败保持隔离、handler 不把不确定 COMMIT 记为普通拒绝、业务体只执行一次，以及**账户身份比较**与 **R3 合同**（同一 `CURRENT_USER()`、`PROCESSLIST.USER` 只与配置用户名比较、数据库绑定、连接 id 互异、R3 判定不含 epoch）。它**不**证明任何真实 InnoDB 行为；真实证据只能由本小节的故障注入在受保护 Gate 中产生。

##### 26.34.16.4 Gate 状态词汇（不得混用）

| 状态 | 含义 | 当前 |
|---|---|---|
| `GATE_IMPLEMENTED` | Gate 的代码、Manifest、子进程与测试已存在并进入仓库 | **本轮达成** |
| `GATE_READY` | Gate 的代码与合同已就绪，可被授权执行 | **未达成**（待 Owner 技术复核） |
| `GATE_AUTHORIZED` | Owner 已就**这一次**目标签发 ACK-4 能力 | **未达成** |
| `GATE_EXECUTED` | Gate 对真实 MySQL 实际跑过一次并留下终态 | **未达成**（本轮 `NOT_RUN`） |
| `GATE_ACCEPTED` | Owner 依据执行证据接受该 Gate 的结论 | **未达成** |

本轮**不**执行真实 MySQL Gate，**不**手动设置破坏性环境变量，**不**执行 Migration / DDL，**不**连接生产数据库，**不**创建 ACK-4 Capability，**不**签发 OUT-001 Acceptance。
