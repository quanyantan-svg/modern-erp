# Procurement & Outsourcing — Technical Design

> 状态：`ACTIVE`
> Owner：Procurement & Outsourcing
> 权威来源：`solution.md` §26
> 来源：`solution.md` §26（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

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
