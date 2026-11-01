# Procurement & Outsourcing — Requirement

> 状态：`ACTIVE`
> Owner：Procurement & Outsourcing
> 权威来源：`document.md` §31
> 来源：`document.md` §31（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## 31. Procurement & Outsourcing Domain Closure Requirement

> 本节固化 Procurement & Outsourcing Domain Closure 的 Requirement 阶段成果。
> Manual Evidence Baseline 来自上游已提供的 B3101 / B3121 + B3104 / B3105 / B3106 / B3108 / B3109 / B3119 / B3120；本节 Coverage 以 2026-10-08 PROCUREMENT & OUTSOURCING DOMAIN Audit PASS 为准。
>
> Design 见 `solution.md §26`（待用户 PASS 后展开）；本阶段不进入 Design / Implementation。
>
> 已知 Audit Normalization（用户最终确认）：
> - PRC-08 = PARTIAL → ENHANCE；
> - PRC-12 = PARTIAL → ENHANCE；
> - PRC-14 = PARTIAL → ENHANCE；
> - PRC-16 = PARTIAL → ENHANCE；
> - PRC-23 = SEMANTIC_MISMATCH → CONVERGE；
> - OUT-07 = MISSING → NEW；
> - OUT-21 = MISSING；
> - OUT-23 = MISSING → NEW / INTEGRATE。

### 31.1 范围与 ownership

Procurement & Outsourcing 拥有：

- 采购参数 / Supplier 采购 profile / Buyer / Purchasing Group；
- Sourcing / Quota / Sourcing Decision；
- 采购价格体系（Price List / Pricing UOM / Pricing Discount / Price Adjustment）；
- PR / PO / Receipt Notice / Purchase Return / Return Request；
- 委外 supplier profile / Outsourcing Source List / Processing Price；
- Outsourcing Order / Outsourcing Lifecycle（PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED）；
- OUTSOURCE BOM consumption；
- 委外 Material List / Issue / Supplement / Return / Backflush；
- Outsourcing Receipt / Inspection / Inbound 入仓；
- Processing Fee AP extension；
- Procurement Scan 成本回入口；
- VMI business documents（VMI Policy / Receipt / Consumption / Summary / Ownership Transfer / Supplier Bill handoff）。

**不在本 Domain 范围：**

- physical inventory truth、owner dimension（Inventory & Warehouse Domain）；
- IQC engine 内部（Quality Domain）；
- Supplier Bill / AP / GRNI / Payments / final costing adjustment（Finance Operations Domain）；
- GL / Voucher / Period close（Accounting & Analytics Domain）；
- MRP / Reservation（Planning Domain）；
- BOM / Substitute / Routing master（Master & Engineering Domain）；
- Production Order execution / Inspection（Manufacturing & Quality Domain）；
- Multi-Org / Multi-Currency（OUT_OF_SCOPE_PRODUCT_BASELINE）；
- 完整 B3105 PDA / camera SDK / label printing（Inventory & Warehouse Domain）；
- Generic Workflow（Platform Domain）。

### 31.2 Manual Evidence Baseline（摘要）

完整证据来自上游已批准的 B3101 / B3121 + 支撑手册 B3104 / B3105 / B3106 / B3108 / B3109 / B3119 / B3120。下表为关键 contract：

| 关键 contract | 含义 |
|---|---|
| 三账务链 | LEGACY_DIRECT `Dr Inventory / Cr AP`；SEPARATE Receipt `Dr Inventory / Cr GRNI`；SEPARATE Supplier Bill `Dr GRNI (+Input Tax Receivable if applicable) / Cr AP`；AUTO_BILL 同事务原子两步 |
| 新业务默认 billing_mode | 必须为 `SEPARATE`；`LEGACY_DIRECT` 仅历史兼容 |
| PO execution state | canonical 视图 OPEN / PARTIALLY_RECEIVED / FULFILLED/CLOSED / CANCELLED；MRP / Workbench / Reservation / Receiving **全部消费同一 canonical open remaining quantity** |
| PR→PO | quantity / source / 累计 release / 剩余 / 逆算审计完整；source-line trace 不丢 |
| Source List 启用时 | 无有效 Source List 的 supplier 不得静默使用；override 必须 permission + reason + audit |
| Quota PROPORTIONAL | deterministic、quantity conservation、source-line trace、无超分配、并发安全；其它复杂 quota algorithm = `SOURCE_DETAIL_INSUFFICIENT` |
| Sourcing Decision | PR Line → Source List Entry → Supplier → Allocated Quantity → Rule/Reason；不得仅依赖 `preferred_supplier_id` 或请求端临时 assignment |
| Pricing Discount 因子 | **只**影响 procurement price resolution / PO snapshot；**不得**直接创建 AP credit；**不得** repurpose `purchase_discounts` |
| Price Adjustment | effectivity-dated；**禁止** retroactive rewrite historical approved PO / Receipt / Bill / AP |
| Receipt Notice | PO → Receipt Notice → Receipt / IQC；**不得** change inventory / valuation / GRNI / AP；支持 multi-PO consolidation |
| Purchase Return 四分支 | LEGACY_DIRECT → AP/commercial credit；SEPARATE unbilled → reverse GRNI（无 AP credit）；SEPARATE billed → AP/commercial credit；SEPARATE partially billed → deterministic split（unbilled→GRNI reversal；billed→AP credit）；库存 reversal 与 commercial/AP adjustment 分离但 source trace |
| Outsourcing ownership | Standard Outsourcing enterprise-owned throughout；Supplier WIP = location binding，**不是** ownership transfer；不得复用 VMI ownership semantics |
| Outsourcing PO | processing-fee commitment；不得把 enterprise-supplied material 作为 PO line |
| Outsourcing cost evidence | `consumed/backflushed material carrying value + processing fee`；**排除** issued but unused / returned / supplier-WIP remaining |
| Outsourcing Lifecycle | `PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED`；**禁止**无证据把 `SUBMITTED / APPROVED` 列为必需阶段 |
| OUTSOURCE BOM | Outsourcing Order 必须消费 approved / effective / `purpose=OUTSOURCE` / business-date appropriate BOM；禁止 `ACTIVE LIMIT 1` selector |
| Handoff consumption | Planning `planning_outsource_handoffs(PENDING)` exactly-once consume；idempotent / source trace / concurrency-safe / status transition；Planning truth 不修改 |
| VMI 区别 | VMI = physical at enterprise site + owner = supplier；standard outsourcing = owner = enterprise + physical at supplier；VMI full physical availability = `CROSS_DOMAIN_DEPENDENCY` |

### 31.3 Capability Audit Matrix（已审计）

#### 31.3.1 Procurement PRC-01 ~ PRC-26

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| PRC-01 | Procurement Parameters | `MISSING` | `NEW`：source control enabled / quota control enabled / PR policy / default billing mode（SEPARATE）/ PO change policy / receiving tolerance / return policy-reasons；参数变化不反写历史已批准/已执行单据 |
| PRC-02 | Supplier Procurement Profile | `PARTIAL → ENHANCE` | 扩展 Supplier profile：`procurement enabled / outsourcing enabled / supplier category / qualification / qualification validity / procurement defaults / payment-settlement defaults / supplier WIP warehouse binding where applicable`；**不**重建 Supplier |
| PRC-03 | Buyer / Purchasing Group | `MISSING` | `NEW`：Buyer / Purchasing Group / membership / document assignment；server-side fail closed |
| PRC-04 | Source List | `MISSING` | `NEW`：Product / Supplier / Source Type (`PURCHASE / OUTSOURCE`) / Effective Period / Enabled；启用 source control 时无有效 Source List 的 supplier 不得静默使用；override = permission + reason + audit |
| PRC-05 | Quota | `MISSING` | `NEW`：bounded `PROPORTIONAL` 供应分配；deterministic / quantity conservation / source-line trace / no over-allocation / concurrency-safe；其它复杂 quota algorithm = `SOURCE_DETAIL_INSUFFICIENT` |
| PRC-06 | Sourcing Decision | `MISSING` | `NEW`：PR Line → Source List Entry → Supplier → Allocated Quantity → Rule/Reason；不得仅依赖 `preferred_supplier_id` 或请求端临时 assignment |
| PRC-07 | Purchase Price List | `MISSING` | `NEW`：supplier / product / source type / effective period / pricing UOM / unit price / status-version；单币种产品基线；不得顺手建立 Multi-Currency；PO 冻结 resolved price evidence |
| PRC-08 | Pricing UOM | `PARTIAL → ENHANCE` | `ENHANCE`：当前 generic UOM conversion / purchase UOM / document quantity / base quantity snapshot / rational conversion KEEP；补 Pricing UOM ≠ Purchase/Document UOM 时的取价规则；禁止第二 UOM engine |
| PRC-09 | Procurement Pricing Discount Table | `MISSING`（**不**复用 `purchase_discounts`） | `NEW`：procurement pricing-side discount；**仅**影响 price resolution / PO snapshot；**不得**直接创建 AP credit；existing `purchase_discounts` = AP / settlement-stage allowance（Finance）KEEP |
| PRC-10 | Purchase Price Adjustment | `MISSING` | `NEW`：effectivity-dated price adjustment + new price version/history；**禁止** retroactive rewrite historical approved PO / Receipt / Bill / AP |
| PRC-11 | Requisition Sources | `PARTIAL` | `ENHANCE`：固化 source-line trace；当前 `Manual / Planning-Purchase Instruction` 已存在；若 Sales-related direct PR 有真实 source 可作为 supported source；不得预先把 `Production Order direct / Sales Order direct / Safety Stock direct` 写成已确认事实；Planning demand 由 frozen Planning owner 管理 |
| PRC-12 | PR Split / Merge / Supplier Allocation | `PARTIAL → ENHANCE` | `ENHANCE`：保留 per-line supplier assignment / partial quantity conversion / supplier grouping / remaining protection；新增 canonical sourcing allocation / split-merge planning fact / audit；**不**重写现有 batch converter |
| PRC-13 | Purchase Order | `COVERED` | `KEEP`：现有 approval lifecycle `DRAFT → SUBMITTED → APPROVED / REJECTED`；**不**声称 current 有 CLOSED；Execution lifecycle 归 PRC-19 |
| PRC-14 | PO Commercial Snapshot | `PARTIAL → ENHANCE` | `ENHANCE`：已冻结 supplier / contact / phone / address / expected delivery / payment terms / line price / PR source / document&base UOM quantity KEEP；新增 supply / settlement / payee supplier / buyer / purchase group / price source / discount source / delivery schedule；默认 `settlement supplier = supply supplier` / `payee supplier = settlement supplier`；payment execution 归 Finance Owner |
| PRC-15 | Gift / Free Item | `SEMANTIC_MISMATCH → CONVERGE` | `CONVERGE`：合法赠品 `is_gift = true / unit_price = 0 / amount = 0`；普通非赠品不得借 gift contract 绕过 commercial validation |
| PRC-16 | Delivery Schedule / Quantity Control | `PARTIAL → ENHANCE` | `ENHANCE`：header `expected_delivery_date` + 硬性超收保护 KEEP；新增 line/multi-delivery schedule + earliest/latest + upper/lower tolerance；lower-tolerance auto-close 算法 source 不足**不**猜 |
| PRC-17 | Prepayment Requirement | `MISSING` | `NEW`：Procurement owns Prepayment Requirement / Schedule；Finance owns actual Payment / Allocation；Requirement 只定义 Procurement → Finance handoff；**不**建立第二支付引擎 |
| PRC-18 | PO Change | `MISSING` | `NEW`：正式 business document；至少 `ADD / MODIFY / CANCEL`；可改变 quantity / price / delivery date/schedule；必须保留 original / change / approval-audit / applied result；禁止历史覆盖；已执行 quantity / source identity 受保护 |
| PRC-19 | PO Execution Status | `SEMANTIC_MISMATCH → CONVERGE` | `CONVERGE`：建立 canonical PO execution view/state：`OPEN / PARTIALLY_RECEIVED / FULFILLED-CLOSED / CANCELLED where valid`；storage 由 Design 决定；**invariant**：MRP / Planner Workbench / Reservation / Receiving **全部消费同一 canonical `open remaining quantity`**；Reservation 不再使用 `Approved total` |
| PRC-20 | Receipt Notice | `MISSING` | `NEW`：独立正式 document；PO → Receipt Notice → Receipt / IQC；支持 multi-PO consolidation；**绝对不** change inventory / valuation / GRNI / AP |
| PRC-21 | Incoming Inspection | `COVERED` | `KEEP`：现有 IQC backbone；Procurement Requirement 只描述 source integration；Outsourcing 后续扩展 `OUTSOURCING_RECEIPT`（Design 决定 canonical source type）；**不**新建 Quality engine |
| PRC-22 | Purchase Receipt | `COVERED` | `KEEP` + 增强：Receipt Notice source；delivery schedule/tolerance enforcement；sourcing/commercial trace；MySQL source-line concurrency；**不**重写 inventory / LOT-SERIAL / valuation / IQC / idempotency / period control |
| PRC-23 | Billing Mode Semantics | `SEMANTIC_MISMATCH → CONVERGE` | `CONVERGE`：默认 `billing_mode = SEPARATE`；`LEGACY_DIRECT = compatibility only`；`AUTO_BILL = explicit valid mode`；账务 contract 不变（详见 §31.2 三账务链） |
| PRC-24 | Return Request | `MISSING` | `NEW`：业务意图层；不得与 Purchase Return inventory execution 合并；至少 source / type / reason / method / replenishment method / quantity；未入库货物不得制造 inventory return |
| PRC-25 | Purchase Return | `SEMANTIC_MISMATCH → CONVERGE` | `CONVERGE`：physical/value execution KEEP；financial settlement 四分支正确（详见 §31.2）；库存 reversal 与 commercial/AP adjustment 分离但保持 source trace |
| PRC-26 | Procurement Scan | `MISSING` | `NEW` bounded：PO or Receipt Notice → Purchase Receipt；scanner wedge + document/item identity + warehouse + qty + LOT/SERIAL；**不**做 camera SDK / barcode designer / label printing / generic PDA platform |

#### 31.3.2 VMI VMI-01 ~ VMI-05

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| VMI-01 | VMI Policy / Agreement | `MISSING` | `NEW`：VMI Procurement business facts（bargain / settlement contract）；full owner-dimensional physical inventory 属 `CROSS_DOMAIN_DEPENDENCY` |
| VMI-02 | VMI Receiving | `MISSING` | `NEW`：receive to supplier-owned bucket；不得伪造 owned inventory |
| VMI-03 | VMI Consumption | `MISSING` | `NEW`：consume 不会 up supplier-owned bucket |
| VMI-04 | VMI Consumption Summary / Ownership Transfer | `MISSING` | `NEW`：period summary → settlement window → ownership transfer trigger |
| VMI-05 | VMI Ownership Transfer / Supplier Bill Handoff | `MISSING` | `NEW`：transfer `supplier → own` + 创建 Supplier Bill for released qty；不建立第二 owned inventory ledger |

> VMI = `physical location = enterprise site / owner = supplier`；与 Standard Outsourcing 方向相反。VMI full physical availability 依赖 Inventory owner dimension（`CROSS_DOMAIN_DEPENDENCY`），但不阻塞 VMI business documents 设计。

#### 31.3.3 Outsourcing OUT-01 ~ OUT-23

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| OUT-01 | Outsourcing Supplier | `PARTIAL` | `ENHANCE`：扩展 PRC-02 Supplier Procurement Profile：`outsourcing enabled / outsourcing qualification / supplier WIP warehouse binding` |
| OUT-02 | Outsourcing Source List | `MISSING` | `NEW`：复用 Procurement sourcing/pricing infrastructure；`source_type = OUTSOURCE` |
| OUT-03 | Processing Price | `MISSING` | `NEW`：加工费；**不是** finished product full material cost |
| OUT-04 | Supplier WIP Warehouse | `PARTIAL` | `ENHANCE`：canonical Warehouse bound to Supplier as outsourcing WIP **location**；**不是** ownership transfer；不创建第二 Warehouse master |
| OUT-05 | Planning Handoff | `PARTIAL` | `ENHANCE`：exactly-once consume `planning_outsource_handoffs(PENDING)`；idempotent / source trace / concurrency-safe / status transition；Planning truth 不修改 |
| OUT-06 | Outsourcing Order | `MISSING` | `NEW`：来源至少 `PLANNING / MANUAL`；operation outsourcing source semantic 后续 source 足够再加 |
| OUT-07 | Outsourcing Lifecycle | `MISSING → NEW` | `NEW`：source-backed Manual semantics `PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED`；**不**写 `SUBMITTED / APPROVED` 为必需阶段；创建态 / 取消态 / 是否需要审批留 Design bounded |
| OUT-08 | OUTSOURCE BOM | `PARTIAL` | `ENHANCE`：Outsourcing Order 必须消费 approved / effective / `purpose=OUTSOURCE` / business-date appropriate BOM；禁止 `ACTIVE LIMIT 1` selector |
| OUT-09 | Outsourcing Material List | `MISSING` | `NEW`：Order 保存/确认时形成 execution snapshot（BOM/version / component / per-unit quantity / scrap / required quantity）；Release 后 master BOM 改变**不**回写历史；额外材料走 Supplement |
| OUT-10 | Outsourcing PO | `MISSING` | `NEW`：**processing-fee commercial commitment**；不是 "采购企业提供给供应商的材料"；Requirement 推荐 `business_type = OUTSOURCE` + `source = Outsourcing Order` + commercial price = processing fee；最终是否复用 canonical PO 留 Design |
| OUT-11 | Outsourcing Material Issue | `MISSING` | `NEW`：issue enterprise-owned materials to supplier WIP warehouse；复用 canonical Inventory Transfer / tracking primitives |
| OUT-12 | Outsourcing Material Supplement | `MISSING` | `NEW`：与 Issue 同一链路；source-traceable |
| OUT-13 | Outsourcing Material Return | `MISSING` | `NEW`：from supplier WIP → internal warehouse；复用 canonical Inventory Transfer / tracking primitives |
| OUT-14 | Outsourcing Material Ownership | `PARTIAL` | `ENHANCE`：enterprise-owned throughout；新增 order-specific material position + supplier-WIP location + issued / returned / remaining / backflushed；**不**是 new owner ledger |
| OUT-15 | LOT / SERIAL for Outsourcing Materials | `PARTIAL` | `ENHANCE`：复用 existing canonical tracking；要求 issue → supplier WIP → return / backflush 持续可追；禁止第二 serial/lot engine |
| OUT-16 | Backflush | `MISSING` | `NEW`：基于 Outsourcing Order + Material List + actual issued/supplemented/returned + receipt quantity + tracked identities；order-specific consumption；不跨订单随意消费 Supplier WIP |
| OUT-17 | Outsourcing Completion Receipt Notice | `MISSING` | `NEW`：不改变 inventory / GRNI / AP |
| OUT-18 | Outsourcing Inspection | `PARTIAL` | `ENHANCE`：扩展 IQC source-type `OUTSOURCING_RECEIPT`（Design 决定 canonical name） |
| OUT-19 | Outsourcing Inbound | `MISSING` | `NEW`：Flow：Outsourcing Order / Processing PO → Completion Receipt Notice → Quality（if required）→ Outsourcing Receipt → Enterprise Finished Inventory Recognition；**不**是 supplier-owned finished stock → enterprise ownership transfer；Supplier WIP 是 source/location context；只有 confirmed valid Outsourcing Receipt 才形成 enterprise warehouse finished inventory fact |
| OUT-20 | Processing Fee AP | `PARTIAL` | `ENHANCE`：**必须扩展** canonical Supplier Bill source contract；不得建立 `Outsourcing Payable` 第二引擎；至少能 trace：Outsourcing Receipt / Outsourcing Receipt Item / Outsourcing PO line / processing quantity / processing fee |
| OUT-21 | Outsourcing Cost Evidence | `MISSING` | `NEW`：正确基础 = `consumed/backflushed material carrying value + processing fee`；**排除** issued but unused / returned / supplier-WIP remaining；Procurement/Outsourcing owner 提供 cost evidence；final costing adjustment / variance allocation 归 Finance |
| OUT-22 | Finished Return | `MISSING` | `NEW`：来源 = confirmed Outsourcing Receipt；要求 quantity cap / LOT-SERIAL / finished inventory reversal / processing-fee billability-credit handoff / material & cost trace；**不**机械复用普通 Purchase Return 的 price semantics |
| OUT-23 | Period-End / WIP / Opening / Reports | `MISSING → NEW / INTEGRATE` | `NEW / INTEGRATE`：必须覆盖 backflush difference allocation / supplier material balance / WIP transfer / opening outsourcing order / opening outsourcing WIP / execution summary / material issue summary-detail；Opening 期间不强制用 generic Period Close 判 PARTIAL；不得用 generic Period Close 判 PARTIAL |

### 31.4 目标 Capability Closure 要求

| Domain Capability | 落地后 Coverage 目标 | 关键 Acceptance |
|---|---|---|
| Procurement Parameters (PRC-01) | `COVERED` | 参数生效；新业务默认 SEPARATE 可观测；参数变化不反写历史 |
| Supplier Procurement Profile (PRC-02) | `COVERED` | procurement / outsourcing qualification / category / payment-settlement defaults；supplier WIP binding where applicable |
| Buyer / Purchasing Group (PRC-03) | `COVERED` | server-side fail closed；不依赖前端隐藏 |
| Sourcing (PRC-04 / PRC-05 / PRC-06) | `COVERED` | Source List enabled + Quota deterministic + Sourcing Decision 可追溯；override 审计完整 |
| Pricing (PRC-07 / PRC-08 / PRC-09 / PRC-10) | `COVERED` | Price List / Pricing UOM / Pricing Discount / Price Adjustment 生效；PO 冻结 resolved price evidence；Pricing Discount **不**进 AP；Price Adjustment **不**回写历史 |
| PR / PO (PRC-11 / PRC-12 / PRC-13 / PRC-14) | `COVERED` | source-line trace / split-merge audit / snapshot 完整 |
| Gift (PRC-15) | `COVERED` | legal Gift 实测可建模；非 gift line 不得 0 价 |
| Delivery Schedule (PRC-16) | `COVERED` | multi-delivery schedule + tolerance boundary 生效 |
| Prepayment (PRC-17) | `COVERED` | Procurement→Finance handoff 完整；Finance 唯一支付 owner |
| PO Change (PRC-18) | `COVERED` | ADD/MODIFY/CANCEL；original/change/audit/applied 完整 |
| PO Execution (PRC-19) | `COVERED` | canonical execution state OPEN/PARTIALLY_RECEIVED/FULFILLED-CLOSED/CANCELLED；MRP/Workbench/Reservation/Receiving 同一消费 |
| Receipt Notice (PRC-20) | `COVERED` | 不影响 inventory / valuation / GRNI / AP；multi-PO consolidation 可用 |
| IQC (PRC-21) | `COVERED` | backbone KEEP；Outsourcing source-type 接入不破坏 |
| Purchase Receipt (PRC-22) | `COVERED` | 增强不重写既有主干 |
| Billing Mode (PRC-23) | `COVERED` | 默认 SEPARATE；三链账务 contract 不变；历史 LEGACY_DIRECT 数据不反写 |
| Return Request (PRC-24) | `COVERED` | 与 Purchase Return execution 分离；未入库货物不被制造为 inventory return |
| Purchase Return (PRC-25) | `COVERED` | 四分支账务正确；source trace 完整 |
| Procurement Scan (PRC-26) | `COVERED` | bounded 入仓；不影响业务合同 |
| VMI (VMI-01 ~ VMI-05) | `COVERED`（business layer） | VMI Policy / Consumption / Summary / Supplier Bill handoff 完整；不伪造 owned inventory |
| Outsourcing (OUT-01 ~ OUT-23) | `COVERED` | 23 capability 全部落地；enterprise ownership 不漂移；location binding 完整；canonical Supplier Bill 扩展不创建第二引擎 |

### 31.5 Permission 约束

新增最小独立 permission 家族（back-end fail closed；不锁死最终 name）：

- Procurement Configuration（含 Procurement Parameters / Buyer / Purchasing Group / Profile / Numbering / Tolerance）
- Sourcing（Source List / Quota / Sourcing Decision）
- Pricing（Price List / Pricing UOM / Pricing Discount / Price Adjustment）
- PO Change（PO Change / PO Execution state management）
- Receipt Notice（Receipt Notice create/confirm）
- Return Request（Return Request create/review/post）
- VMI（VMI policy / receiving / consumption / summary / ownership transfer）
- Outsourcing View / Manage
- Outsourcing Release（Outsourcing Order release/complete/close）
- Outsourcing Material Execution（Issue / Supplement / Return / Backflush）
- Outsourcing Receiving（Completion Receipt Notice / Inspection / Receipt / Return）

兼容：保留既有 `SUPPLIERS_*` / `PURCHASE_REQUISITION_*` / `PURCHASE_ORDERS_*` / `PURCHASE_RECEIPTS_*` / `RETURNS_*` / `IQC_*` / `AP_*` / `PURCHASE_DISCOUNT_*`；5 个 role seed（admin / sales / warehouse / reviewer / accounting）继续按现有能力访问；新 permission admin 继承；其它角色保持现状。

### 31.6 Compatibility / 不变性约束

- 不删除 / 重命名现有 57 enabled + 5 disabled route key；本 Domain Closure additive 引入新 route 与 owner；
- 不修改既有 `purchase_discounts` schema（保持现有 AP / settlement-stage allowance 语义）；
- 不重写 Inventory / Quality / AP / GL / Period Close backbone；
- 不重写 Manufacturing canonical owner；
- 不修改既有的 SCHEMA SUPPLIER master；新字段以 additive 形式扩展；
- 不 DROP historical table；
- 不重命名既有 release tag；
- SQLite + MySQL 8 schema parity；migration idempotent。

### 31.7 Out of Scope（本 Domain Closure 不实施）

- Multi-Org / Multi-Currency（OUT_OF_SCOPE_PRODUCT_BASELINE）；
- 完整 B3105 PDA / camera SDK / label printing / generic PDA platform；
- Finance engine rewrite（重写 Supplier Bill / AP / GRNI / Payments / Cost）；
- Inventory ledger rewrite（含 owner dimension 的 invasive 改动）；
- Generic Workflow redesign；
- destructive data rewrite / DROP historical table / database reset；
- 完整 Operation Outsourcing handoff（工序委外完整 lifecycle，Outsourced Operation Boundary = PARTIAL INTEGRATION）；
- retroactive rewrite 历史 approved PO / Receipt / Bill / AP（PRC-10 Price Adjustment 的硬性禁止）。

### 31.8 Acceptance Criteria

#### A. Functional

全部 PRC-01~26 + VMI-01~05 + OUT-01~23 = 54 项 capability 每一项都必须有 final capability disposition。本域 capability disposition **穷尽且仅**分为以下两类：

```text
DOMAIN-OWNED SOURCE-BACKED CAPABILITIES = 49
+
MUST INTEGRATE capabilities = 5
=
54 capabilities
```

Cross-domain dependency 是 acceptance dependency metadata，不是 capability disposition；不得把任何 capability "挪入 CROSS_DOMAIN_DEPENDENCY" 来代替 disposition。

1. **Procurement & Outsourcing Domain 自有的 source-backed capability = 49 项**

   按 family 分组（25 PRC + 5 VMI + 19 OUT）：

   - **PRC domain-owned = 25 项**（PRC-21 = integration-backed，本节不含）：
     PRC-01 / PRC-02 / PRC-03 / PRC-04 / PRC-05 / PRC-06 / PRC-07 / PRC-08 / PRC-09 / PRC-10 / PRC-11 / PRC-12 / PRC-13 / PRC-14 / PRC-15 / PRC-16 / PRC-17 / PRC-18 / PRC-19 / PRC-20 / PRC-22 / PRC-23 / PRC-24 / PRC-25 / PRC-26
   - **VMI domain-owned = 5 项**（**全部**）：
     VMI-01 / VMI-02 / VMI-03 / VMI-04 / VMI-05
   - **OUT domain-owned = 19 项**（OUT-08 / OUT-18 / OUT-20 / OUT-23 = integration-backed，本节不含）：
     OUT-01 / OUT-02 / OUT-03 / OUT-04 / OUT-05 / OUT-06 / OUT-07 / OUT-09 / OUT-10 / OUT-11 / OUT-12 / OUT-13 / OUT-14 / OUT-15 / OUT-16 / OUT-17 / OUT-19 / OUT-21 / OUT-22

   所有 49 项必须达到 Requirement 定义的目标闭环；不得残留未经用户批准的 `MISSING` / `SEMANTIC_MISMATCH`。其中 4 项历史 `SEMANTIC_MISMATCH` 的 `→ CONVERGE` invariant：
   - PRC-15 Gift / Free Item：`is_gift_line` 标记 / `>= 0` 放宽；
   - PRC-19 PO Execution Status：canonical `OPEN / PARTIALLY_RECEIVED / FULFILLED-CLOSED / CANCELLED`；MRP / Workbench / Reservation / Receiving 全部消费同一 canonical `open remaining quantity`；
   - PRC-23 Billing Mode Semantics：默认 `SEPARATE`；`LEGACY_DIRECT = compatibility only`；`AUTO_BILL = explicit valid mode`；
   - PRC-25 Purchase Return：LEGACY_DIRECT → AP/commercial credit；SEPARATE unbilled → reverse GRNI；SEPARATE billed → AP/commercial credit；SEPARATE partially billed → deterministic split（unbilled → GRNI reversal；billed → AP credit）。

   **VMI-01~05 全部归本 Domain 完成**。VMI-01 Policy / Agreement、VMI-02 Receiving business fact、VMI-03 Consumption business fact、VMI-04 Consumption Summary / Settlement Window、VMI-05 Ownership Transfer business fact 五项的 business layer（policy、agreement、document、quantity、settlement、audit、idempotency / business lifecycle）全部由 Procurement & Outsourcing Domain owner 完成；不得将 VMI-03 / VMI-05 整个 capability defer 给 Inventory Domain。

2. **MUST INTEGRATE capability = 5 项**

   必须成功消费 canonical owner 的稳定 integration contract，**不得**建立 duplicate mutable truth：

   - **PRC-21 IQC**：消费 `authoritative-quality.js`，不得新建 Quality engine；
   - **OUT-08 OUTSOURCE BOM**：消费 `engineering-configurable-bom.js` resolver（`approved / effective / purpose=OUTSOURCE / business-date appropriate`），禁止 `ACTIVE LIMIT 1` selector；
   - **OUT-18 Inspection**：扩展 IQC source-type `OUTSOURCING_RECEIPT`（canonical name 由 Design 决定）；
   - **OUT-20 Processing Fee AP**：扩展 canonical Supplier Bill source contract，**不得**建立 `Outsourcing Payable` 第二引擎；至少能 trace Outsourcing Receipt / Outsourcing Receipt Item / Outsourcing PO line / processing quantity / processing fee；
   - **OUT-23 Period-End**：复用 Period Close framework integration；opening 期间不强制用 generic Period Close 判 PARTIAL。

3. **OUT_OF_SCOPE_PRODUCT_BASELINE**

   仅允许用户已批准的明确产品基线项目：

   - Multi-Organization；
   - Multi-Currency；
   - 完整 B3105 PDA / camera SDK / label printing / generic PDA platform；
   - Finance engine rewrite；
   - Inventory ledger rewrite（含 invasive owner-dimension 改造）；
   - Generic Workflow redesign；
   - destructive data rewrite / DROP historical table / database reset；
   - 完整 Operation Outsourcing handoff lifecycle；
   - retroactive rewrite 历史 approved PO / Receipt / Bill / AP（PRC-10 硬性禁止）；
   - Standard Outsourcing 复用 VMI ownership semantics；
   - enterprise-supplied material 入 OUT-10 PO line；
   - supplier-owned finished stock 通过 OUT-19 VMI-style ownership transfer。

最终不得存在 `unexplained MISSING / PARTIAL / SEMANTIC_MISMATCH`。任何 unresolved disposition 必须以 Hard Stop Conditions 形式回退至 Requirement/Design 层重新审视，**不得**通过偷换 disposition 类别伪装覆盖。

---

#### A.1 Cross-Domain Dependency Boundary（acceptance dependency metadata，**不是** capability disposition）

Inventory & Warehouse Domain owns owner-dimensional physical inventory truth。本域通过该 dependency 把 owner-dimensional physical mutation 部分交给 Inventory Domain 实现。

dependency 被以下 capability 调用，但**仅针对其物理库存 owner-dimensional mutation 部分**：

| capability | Procurement 拥有 | Inventory 拥有 |
|---|---|---|
| VMI-02 Receiving | VMI receipt document、supplier / product / source、received quantity、business audit、idempotency / business lifecycle | post 入 supplier-owned physical stock；owner-dimensional availability 更新 |
| VMI-03 Consumption | consumption document、supplier / product / source、consumed quantity、settlement trace、business audit、idempotency / business lifecycle | deduct supplier-owned physical stock；owner-dimensional availability 更新 |
| VMI-05 Ownership Transfer | ownership-transfer business event、settlement quantity、supplier、source consumption、Supplier Bill handoff | physical owner change `supplier-owned → enterprise-owned` |

dependency 不进入 capability disposition 计数；它仅是 acceptance dependency metadata。54-capability accounting 仍 = 49 domain-owned + 5 integration-backed。

---

#### A.2 Explicit Invariants

- **VMI business-layer closure** `≠` **owner-dimensional Inventory closure**。本 Domain 完成 VMI business layer 不代表 Inventory owner-dimension 物理库存层就绪；二者验收分别独立。
- **Inventory owner-dimension dependency** `≠` **VMI-01~05 capability disposition substitute**。Inventory owner-dimension dependency 不得成为将 VMI-01~05 推迟或标 PARTIAL 的理由；本 Domain 必须独立完成 VMI business layer。
- **Capability disposition 穷尽且分类清晰**：任何 capability 必须落到 `Domain-owned source-backed` 或 `MUST INTEGRATE` 之一；不得以 `CROSS_DOMAIN_DEPENDENCY` 代替 disposition。
- **Cross-domain dependency 仅记录 metadata**：用于 traceability 与 acceptance dependency 校验，不计入 capability 分类。

#### B. Data / Schema

- 新增表 / column 全部 additive；既有表 / 字段无破坏；
- 既有的 SUPPLIER / `purchase_discounts` / Supplier Bill / AP / GRNI / IQC 表 / IBC 后续 schema 不破坏；
- SQLite / MySQL 8 schema parity；migration idempotent；
- Opening 期间 opening outsourcing order / opening outsourcing WIP 标记 `OPENING`；不虚构历史 accounting。

#### C. Security

- 所有 Procurement / Outsourcing mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- Source control override = permission + reason + audit；
- Audit 写入关键 PO / Receipt / Return / Outsourcing / VMI mutation。

#### D. Test

- Wave A focused：Procurement Parameters + Supplier Profile + Buyer；
- Wave B focused：Sourcing / Quota / Pricing；
- Wave C focused：PR / PO / PO Change / PO Execution；
- Wave D focused：Receipt Notice / Purchase Return 四分支 / Procurement Scan；
- Wave E focused：VMI business layer + Inventory owner dimension handshake；
- Wave F focused：Outsourcing Foundation（profile / source list / processing price / WIP warehouse / handoff / order / lifecycle / BOM）；
- Wave G focused：Outsourcing Materials（material list / PO / Issue / Supplement / Return / LOT-SERIAL / Backflush）；
- Wave H focused：Outsourcing Receiving / Finance Handoff（notice / inspection / inbound / processing fee AP / cost evidence / finished return）；
- Wave I focused：Period-End / WIP / Opening / Reports；
- Wave J focused：UI / mobile convergence；
- 全部 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency` + `pnpm test:mysql:performance`。

#### E. Concurrency critical sections

以下区域必须为 critical section（Design 决定具体 SQL / lock strategy；本阶段不设计 SQL）：

- Sourcing allocation；
- PR → PO；
- PO Change vs Receipt；
- PO → Receipt Notice；
- PO → Receipt；
- Receipt → Return；
- Receipt → Supplier Bill；
- Planning OUTSOURCE handoff → Outsourcing Order；
- Outsource Material Issue；
- Outsource Receipt；
- Processing Fee Bill；
- VMI Ownership Transfer。

#### F. UI / Mobile

- 实际 operator workflow（user task；Design 决定 UI 结构）：
  - PR → Sourcing → PO；
  - PO → Receipt Notice → IQC → Receipt；
  - Return Request → Purchase Return；
  - VMI policy → receipt / consumption → settlement / ownership transfer；
  - Planning OUTSOURCE → Outsourcing Order → Materials → Receiving → Processing Fee；
- Mobile-first：390 CSS px 为主；同时验证 320 / 430 / 680；
- LIST → DETAIL → EDITOR/WORKFLOW；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`；
- 不得修改业务术语、API、权限、状态机、Approval/Confirm/Post/Reverse、source/downstream、inventory/accounting facts。

#### G. Documentation / Log

- `document.md §22.1 / §22.21 / §31` 同步更新；
- `solution.md §26` 同步更新（Design；本阶段未开始）；
- `log/2026-10-08.md` 追加本 Domain Closure Requirement 完整记录；
- `README.md` 仓库地图与新增 page route / server module / 测试在 Design 完成后同步更新；
- `APPLY_GUIDE.md` 不动。

### 31.9 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization / Multi-Currency 需求出现；
2. 需要重写 Inventory / Quality / AP / GL / Period Close / Production backbone；
3. 需要 DROP historical table 或 destructive schema rewrite；
4. 需要把 enterprise-supplied material 作为 PO line 入 OUT-10；
5. 需要 retroactive rewrite 历史 approved PO / Receipt / Bill / AP；
6. 需要把 Standard Outsourcing 复用 VMI ownership semantics；
7. 需要把 supplier-owned finished stock 通过 OUT-19 建模为 VMI-style ownership transfer；
8. source semantics 不足导致 lower-tolerance auto-close / 截图级 forecast time-fence / 复杂 substitute 数量算法 / 完整 quota algorithm 不得不猜测；
9. MySQL migration 无法保证 parity；
10. 需要把 Outsource Material Issue / Return 通过 raw UPDATE inventory balance（绕过 canonical inventory transfer）；
11. 既有的 LEGACY_DIRECT 历史数据需要被反写以满足新默认；
12. 既有的 IQC / OQC / QCP / Production / Planning / Engineering canonical owner 必须被破坏。

### 31.10 最终接受状态

本节 Requirement 包含 26 + 5 + 23 = 54 项 Capability / 10 个 Wave / 11 个新增 permission family。本节 Requirement 完成；下游 Design 见 `solution.md §26`（本阶段未开始）。等待用户 PASS。

---

**PROCUREMENT & OUTSOURCING DOMAIN CLOSURE REQUIREMENT — COMPLETE / READY FOR USER REVIEW**

### 31.11 Definitive Final Acceptance Evidence（2026-10-09）

- Domain source-of-truth checkpoint：`1964648`；`document.md` / `solution.md` / `log/2026-10-08.md` 已独立提交，`APPLY_GUIDE.md` 保持用户原有 dirty state；
- Functional Browser UAT：真实 Playwright Chromium + browser-authenticated mutation，`25/28 PASS`；
- Responsive Browser UAT：7 surfaces × 4 widths（320 / 390 / 430 / 680）=`28/28 PASS`；
- Purchase Return 四分支 persisted voucher proof：LEGACY_DIRECT、SEPARATE unbilled、SEPARATE billed、10 received / 4 billed / 7 return 均 PASS；partial split = AP/commercial credit 4,000 cents + GRNI reversal 3,000 cents；
- OUT-21：`outsourcing_cost_evidences` 保存 consumed material carrying value、provisional fee、POSTED Supplier Bill actual fee、variance 与 `PROVISIONAL / FINAL`；
- OUT-22：unbilled finished return 不制造 AP credit；billed return 通过 canonical Supplier Credit Note + `applyCreditAdjustment` 降低 AP，并保存 receipt item / bill item / credit note trace；
- Focused inventory：12 files / 12 suites / 48 tests / 48 pass / 0 fail / 0 skipped / 0 todo；
- disposable MySQL 8.0.37：`test:mysql` PASS、`test:mysql:concurrency` 13/13 PASS、`test:mysql:performance` PASS（20 writers / 400 operations / 0 errors）；
- Final Acceptance blocker（不得 Freeze）：
  1. `UAT-15`：Outsourcing Order 接受任意 `planningHandoffId`，但未重读/更新 authoritative `planning_outsource_handoffs`；
  2. `UAT-21`：没有 executable Outsourcing Completion Receipt Notice contract；普通 Receipt Notice 对 Outsourcing source 返回 404/409；
  3. `UAT-22`：IQC API 只接受 Purchase Receipt，`OUTSOURCING_RECEIPT` source contract 返回 400。

因此本 Domain 当前状态为：`NOT READY`。其余 51 项不能抵消上述 3 项 acceptance failure；不得 Freeze。

#### 31.11.1 MySQL concurrency evidence correction（2026-10-09）

`pnpm test:mysql:concurrency` 在 disposable MySQL 8 上为 13/13 PASS，但现有 `server/mysql-phase7b-concurrency.integration.js` 只直接证明通用 row-lock / idempotency、合成的 Purchase Receipt / Supplier Bill / Material Issue 状态竞态及既有库存、结算、期间并发原语。它没有逐项执行本次最终验收指定的 Sourcing allocation、PR→PO、PO Change vs Receipt、Receipt Notice、Planning handoff、Outsourcing Receipt、Processing Fee partial bill、VMI Ownership Transfer 等真实 domain handler race。因此 MySQL gate PASS 不等于这 11 个指定场景已经全部具备 MySQL 实证；该差距是独立 Acceptance blocker，修复前同样不得 Freeze。

---

### 31.12 M1 采购与委外关键断链统一整改 Requirement（2026-10-31；待业务所有者验收）

> **阶段与授权**：用户已接受《M1 Procurement & Outsourcing Critical Chain Audit Report》的有限勘误，并明确授权将已确认 Gap 和四组业务决策统一整理进入 **REQUIREMENT**。本节仅为业务 Requirement 修订，不构成 DESIGN / IMPLEMENTATION / ACCEPTANCE / FREEZE 或 Git 远端写入授权。依据：`document.md §22.1 / §22.21 / §31.1–31.11 / §35.8`、`solution.md §26`、M1 审计报告及 M1-AE 有限勘误；远端基线 `master@498d50143c1bd54f0d71447e5477872775910a81`。
>
> **证据纪律**：手册语义取自业务审查方提供的 B3101 / B3121 摘要及已批准 §22/§31，不得声称 Claude/Codex 可直接读取原 Word 手册。M1 原报告中的临时 SQLite 运行结果是“原审计执行者报告的证据”，本节不冒称重新执行；未运行的 MySQL / 浏览器验收均为 `NOT_RUN`。原 §31.11 的历史证据与 `NOT READY` 状态保持原样。

#### 31.12.1 目标、范围和 Domain Owner

目标：以**单次、跨能力的业务合同闭合**替代 G-1～G-5 的零散修补，完成“采购订单→收料通知→采购入库”和“委外订单/加工费 PO→完成通知→待检收货明细→质量门禁→成品入库→加工费账单→AP/GL”的真实业务可达性；同时补齐委外材料实物/WIP/成本、VMI 结算与验收证据。

- **Procurement & Outsourcing Owner**：订单、来源/通知、委外业务单据、材料执行指令、加工费来源及可追踪业务证据；不得直接代替库存、质量、财务或总账 Owner。
- **Inventory & Warehouse Owner**：位置/所有权、LOT/SERIAL、唯一权威物理库存 Mutation 与跟踪分配；Supplier WIP 只能作为“企业所有、供应商位置”的库存身份。
- **Quality Owner**：IQC 规则、检验记录和允许/拒绝入库的质量判定。
- **Finance Operations Owner**：Supplier Bill、AP、GRNI/暂估、付款、供应商贷项、存货估值与后续成本调整；不允许委外模块建立第二 AP、第二估值账或直接写余额。
- **Accounting & Analytics Owner**：会计事件（若设计采纳）、系统凭证/分录、会计期间、GL 及对账。Accounting Domain Closure 尚未完成；不能因此伪造会计规则或宣告闭环。
- **Planning Owner**：保留现有委外 handoff 的 exactly-once 来源合同；不得因整改修改已冻结 Planning 业务语义。

保留 §31.6/§31.7 不变性：SQLite/MySQL parity、加性迁移、零破坏性历史改写、不新建第二 Owner 引擎、不扩展到完整工序委外、多组织/多币种、通用工作流重构等。保留所有已批准的历史 Capability 与状态机，不以本节覆盖旧的冻结/验收记录。

#### 31.12.2 经 M1-AE 纠正的 Gap 与 Coverage（本轮整改基线）

Coverage 使用且仅使用 `COVERED / PARTIAL / MISSING / SEMANTIC_MISMATCH / OUT_OF_SCOPE`；下表表示**当前待整改状态**，不是修复完成后的状态。

| Workstream | 关联已登记 Gap / 发现 | 关联 Capability | 当前 Coverage | Severity | 可验证缺口与本轮归属 |
|---|---|---|---|---|---|
| A-01 委外收货明细 | G-1 / M1-F01 | OUT-18..22 | `MISSING` | P0 | 正式收货 API 仅写表头；`outsourcing_receipt_items` 无业务 Writer；IQC/加工费下游无法从真实生产接口获取明细。 |
| C-01 加工费财务闭环 | G-2 / M1-F02、M1-N02 | OUT-20/21 + Finance/Accounting | `PARTIAL` | P0 | 专用 POST 写 AP 但缺标准期间/总账确认路径；输入校验可能返回 500；不可把局部 AP 写入视为 GL 闭环。 |
| A-02 收料通知转换 | G-3 / M1-F03、M1-N06/N10、M1-AE E-06 | PRC-20/22/26、OUT-17/19 | `PARTIAL` | P1 | 通知→入库来源与转换未接线；订单类型隔离、分批上限与事务内校验欠缺。 |
| B-01 委外库存/WIP/估值 | G-4 / M1-F04、M1-N05/N07/N08/N09 | OUT-04、OUT-11..16、OUT-21..23 | `SEMANTIC_MISMATCH` | P0 | 材料发退补与权威库存/WIP/LOT/估值不一致；差异方向、审批与跨单 WIP 成本守恒未闭合。 |
| T-01 VMI 旧 UAT 合同 | G-5 / M1-F05 | VMI-02/03/05 Acceptance | `SEMANTIC_MISMATCH` | P2 | UAT-14 仍期待旧版 Owner Dimension 409，而当前 Owner Dimension 已可用；属于验收 Oracle 漂移，不等于 VMI 物理能力全部缺失。 |
| D-01 VMI 期间结算 | M1-N03 | VMI-04 | `MISSING` | P1 | 现有 summary 是累计视图，未形成按期间/结算窗口的可信业务事实。 |
| D-02 VMI 财务交接 | M1-N04 | VMI-05 | `PARTIAL` | P1 | 物权转移写数量，未形成基于已批准结算数量/价格的 Canonical Supplier Bill。 |
| U-01 移动工作面 API | M1-N01 | 采购寻源/委外相关 UI | `MISSING`（所涉页面可执行性） | P1 | 页面调用 `api.get`/`api.post`，但共享 `api` 当前为函数；此处不借机重设计移动 UI。 |
| T-02 MySQL 并发证据 | M1-N11 | §31.8.E Acceptance | `SEMANTIC_MISMATCH`（证据层） | P1 | 11 项 `race_probe_generic` 探针没有调用对应真实 Domain Handler，不能作为 11 条业务竞态的验收证据。 |

**去重规则**：N02→G-2；N05/N07/N08/N09→G-4；N06/N10/E-06→G-3；N01、N03、N04、N11独立追踪。此前报告 §3.3 对 `M1-N06` 的误标 `M1-N09` 已纠正。新增细分缺陷不得复制生成同义正式 Gap ID；任一 `COVERED` 结论均须未来 Acceptance 实测。

#### 31.12.3 A 组：收料通知、委外收货与来源明细合同（A-01 / A-02）

**已批准业务前提（不重开政策）**：B3101 允许采购订单直接生成采购入库，也允许“采购订单→收料通知→采购入库”；支持多采购订单合并收料。B3121 委外完工应从委外订单及其关联加工费采购订单产生完成通知，经免检或合格检验后进入成品入库。`document.md §31.2/§31.3.3` 已要求通知单**不**改变库存、估值、GRNI 或 AP；完成入库必须保留订单、供应商与来源关系。`solution.md §26.18` 已批准 `OUTSOURCE_PROCESSING` PO 语义隔离，不能把委外加工费 PO 当普通采购物料 PO。

A-REQ-01 **来源与可达性**：正式 API 必须可以创建包含一条或多条**非空、合法产品/数量明细**的委外收货草稿/待检事实；每行指向委外订单、适用的加工费 PO 行/完成通知来源，以及必要的产品/UOM/LOT/SERIAL/仓库身份。不得依赖测试私有 SQL INSERT 制造下游可达条件。表头和明细必须原子创建，失败时零副作用；总数量与明细之和必须一致。

A-REQ-02 **通知转换**：标准采购的通知行可生成采购入库行；委外完成通知行可生成委外收货行。无通知的直接订单→采购入库仍为合法既有路径，不能被强制取消。转换必须由服务端验证 `business_type`、supplier、订单/订单行、warehouse、quantity、UOM 和状态；不同业务类型强制拒绝，不能凭客户端字段绕过。

A-REQ-03 **合并与分批**：一张标准采购通知可关联多个同供应商、兼容仓库/业务类型的采购订单**明细来源**；不得被单值 `purchase_order_id` 结构限制。支持部分转换及重复收货，但累计转换/已确认数量不得超过通知行、有效订单行、交期/容差和委外订单剩余可收量。转换已用数量与剩余量应可查询、可审计、可追溯。

A-REQ-04 **质量门禁与效力时点**：采购/委外入库在应检验场景必须由权威 Quality 判定 PASS/WAIVED 才能形成库存效力；不合格/未检时不得进入可用库存/成本。可以先产生待检收货表头明细供 IQC 读取；“建待检单据”和“确认库存效力”是不同动作。重复确认和并发转换不能重复计入库存、成本或通知数量。

A-REQ-05 **事务与前后置条件**：通知创建、确认、转换、收货确认都应在单一权威事务中重读并锁定必要的来源/数量容量。当前 `confirmReceiptNotice` 对仅汇总 `CONFIRMED` 的值减去仍是 `DRAFT` 的本通知数量，导致本次确认量未进入上限比较（M1-AE E-06）；未来必须以 `other_confirmed + this_notice_qty <= open_qty` 等价安全不变量证明修正。不同状态、错误、权限和审计保持 fail-closed。

A-REQ-06 **设计冲突留待 Design 协调**：`solution.md §26.12` 提议独立委外完成通知表，而 `§26.20` 又要求复用 `receipt_notices`；这是**物理模型设计冲突**，不是用户尚未确定的业务语义。本 Requirement 只固定来源、行级身份、业务类型和数量不变量，不预先要求建立两套通知单表，也不批准重复的“第二收货引擎”。Design 需提出一个与历史数据兼容、SQLite/MySQL 对等的唯一权威模型并说明迁移。

#### 31.12.4 B 组：委外材料、Supplier WIP、所有权与成本合同（B-01）

**已批准业务前提**：委外材料在全过程**属于企业**；Supplier WIP 是物理/保管位置，不是 VMI 的物权变更。发料由企业仓→供应商 WIP、退料由供应商 WIP→企业仓；补料遵守来源、数量及仓库规则。材料执行、倒冲、LOT/SERIAL 必须复用 Inventory 唯一权威 Writer/位置/跟踪；不得裸 UPDATE 库存余额。OUT-21 成本只含实际倒冲消耗材料的账面价值及加工费，不包括发出未耗用、已退回、仍留在 Supplier WIP 的材料价值。

B-REQ-01 **实物与业务同事务一致**：Issue/Supplement/Return 的有效业务状态与仓位 Mutation、tracking、库存流水必须原子一致。供应商 WIP 仓库由已验证的 supplier profile/订单上下文决定，不接受任意客户端 `fromWarehouseId/toWarehouseId` 越权指定。缺失 WIP 仓库、库存不足、不相容 tracking、无权限或数量非法时 fail-closed，业务单据、库存、估值、审计不得出现部分成功。

B-REQ-02 **权威位置与守恒**：按产品、仓库、owner、库存状态、批/序列号及订单相关身份追踪；发/退/补/转移每一步必须证明总物理数量守恒或明确的合法增减来源。不得因业务计数器变化而凭空产生库存。数量要求有限、正数、合法 UOM，并约束累计已发、已退、已补、可用 WIP、可倒冲数量；重放不应产生第二次动作。

B-REQ-03 **倒冲和成品入库**：按委外订单材料清单行与累计合格收货量计算增量倒冲；只消耗该订单对应可追溯 WIP，不得越额、跨订单、跨 LOT/SERIAL 或跨 UOM 静默取料。使用 Canonical Valuation Writer，使 material carrying value 与 valuation movements/balances、OUT-21 cost evidence 一致。只有完成质量及其他入库门禁时，成品才通过唯一权威 Inventory Writer 进入企业仓；禁止硬编码 `warehouse-001/002`、裸插值变动表但不更新价值余额。

B-REQ-04 **倒冲差异**：按 B3121 的方向约定：供应商盘点实际数量大于应有账面时，形成委外退料候选；小于账面时，形成委外补料候选。Preview/Allocate/Apply/审核/生效应有清楚状态界限，单据在获得所需审核前不得直接标为已生效；每笔差异、物料行与源/目标仓必须可追溯，并防止重复分摊。差异所需业务审核阶段以手册语义为下限，具体权限/角色由后续 Design 承接已有 RBAC/SoD。

B-REQ-05 **月末 WIP 转移**：订单内/订单间在制转移保留源订单、目标订单、产品、数量、所属 WIP 位置及成本身份；企业所有权保持不变。数量和金额不可仅改单边业务计数器；成本携带、期间边界、过账/冲销和跨仓中转规则列入待裁定 B-P01，未裁定前不得通过假定平均价生成不可逆历史账务。

B-REQ-06 **独立推进边界**：发退补料的 canonical inventory Mutation 可以在来源与仓位合同明确后独立设计；**不是必须依赖** A 组委外收货明细迁移。倒冲与成品入库成本集成依赖可靠的材料事实，最终加工费与 GL 对账依赖 A/B 组共同提供的来源/成本证据。

#### 31.12.5 C 组：加工费、AP、GL 与期间合同（C-01）

**已批准业务前提**：委外加工费是加工服务商业金额，而不是企业供料的采购材料价。加工费来源应通过 `OUTSOURCING_RECEIPT_ITEM` 等权威行级 source trace 接入 Canonical Supplier Bill；允许合法的部分开票和多收货行开票，累计 active reserved quantity 不超过 eligible quantity。Finance 拥有 Supplier Bill/AP/GRNI/估值调整；Accounting 拥有 GL/Voucher/会计期间。不得新建第二 payable、会计凭证或成本引擎。

C-REQ-01 **来源与金额**：开票行只能消费已达合法可计费阶段、来源完整、供应商相符、加工费 PO 相容的委外收货行。行级来源、数量、单位、加工费单价、税额和实际过账金额须一致且可追溯。DRAFT/WAITING_MATCH/POSTED 预留量合并参与容量检查；退款、撤销、冲销释放或扣减容量需具有可审计的规范行为。输入缺失/非法应返回稳定 4xx 业务错误，不得抛未处理 500。

C-REQ-02 **AP 与 GL 不混同**：加工费 Supplier Bill POST 必须经过与现有 Canonical Finance 合同一致的业务日期/期间门禁、AP 确认与系统会计分录交接；账单已 POSTED 不能表示“已有总账凭证”。完整业务验收应区分 `AP_CLOSED`、`GL_CLOSED`、`END_TO_END_CLOSED`；借贷平衡、来源金额、期间和冲销应逐一验证。不能错误地称“某付款凭证不平衡”：当前风险是原始加工费确认与整条 AP/GL 业务对账缺口。

C-REQ-03 **确认/暂估政策的 Stop Point**：委外收货的材料实耗价值与加工费暂估、正式账单金额和差异必须分别记录并可追溯；在 C-P01～C-P04 会计政策获批准前，禁止擅自采用普通采购 `Dr GRNI / Cr AP`、任意费用科目、直接制造差异或补记不可逆历史凭证。关闭期间的加工费 AP/GL 写入必须拒绝；是否同时封锁材料库存动作取决于**其自身 Inventory/Accounting 期间合同**，不得以“AP 已结账”一刀切阻断全部委外发料。

C-REQ-04 **退货与冲销**：已开票委外退货必须保留原收货行、已计费数量、Credit Note/AP 减少、材料及成品成本反向追踪；账务冲销/红冲应归 canonical Finance/Accounting；不得只创建贷项却缺少可抵销的历史原始凭证。禁止在本阶段通过修改生产行为修补历史账务。

#### 31.12.6 D 组：VMI 消耗汇总、物权转移与供应商结算（D-01/D-02/T-01）

**已批准业务前提**：VMI 实物存于企业仓，收货后 Owner=`SUPPLIER`；普通委外则始终 Owner=`ENTERPRISE`。V21 的 Owner Dimension 已由 Inventory canonical mutation 支持；不得恢复旧版 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE`。VMI 收货、消耗和物权转移不应无条件直接生成 AP；§31.3.2 已批准 VMI-04 期间汇总/结算窗口及 VMI-05 物权转移后的 Canonical Supplier Bill handoff。

D-REQ-01 **期间结算事实**：VMI-04 应按明确的 agreement/supplier/product/period 口径输出期初、收货、耗用、已转移、可结算、已结算、调整和期末数量；支持结算窗口及可审计的重复生成/重放。当前 `getVmiSummary()` 的生命周期累计数字不自动等于结算期事实，不得用 `received-consumed-transferred` 的未裁定口径冒充已批准的可开票数量。

D-REQ-02 **物权变更与支付来源**：合法的 `SUPPLIER → ENTERPRISE` 必须由 Inventory 的 owner-dimensional `OWNER_CHANGE` 原子执行，不能重复加总物理库存；适用且经确认的 released quantity 才能形成 canonical Supplier Bill/AP 来源。需要说明消耗先发生、物权后转移、先转移后消耗等策略的合法适用条件和数量/计价一致性；**在 D-P01/D-P02 政策裁定前不得凭空推导统一触发模式或价格**。

D-REQ-03 **老测试合同纠正**：采购/委外 UAT-14 必须针对当前 V21 合同，收货创建 `201`，收货确认 `200`，后者证明供应商 Owner 仓位实际增加；拒绝恢复过时 409 作为测试捷径。库存 UAT-20 既有 `+50` 预期源于整段操作“+50 入库、-20 转出、+20 转入”，算术正确，**不得误改为 0**；但该脚本不等于直接证明原子 `OWNER_CHANGE` Handler，应另加一项直接 Handler 级测试。UAT-20 中间的 ownership shift 在无额外收发的情况下物理净变化必须为 0。

#### 31.12.7 U/T 组：UI 和验收证据质量（不新增业务政策）

U-REQ-01：采购寻源和委外现有工作面应能正确调用项目统一的 `api(path,options)` 接口及对应后端权限/路由；必须通过真实浏览器检查入口、列表/详情/提交及错误展示。只解决已发现可执行性缺陷，不在 M1 重设计导航/视觉体系。

T-REQ-01：涉及业务闭环的最终 UAT 必须通过生产 API 建立订单、通知、收货行、IQC、加工费账单、库存事实，不能只靠手写 SQL Fixture。单元测试可保留明确用途的数据库 Fixture，但必须与业务可达性 Gate 分开，且测试记录明确其证据层级。

T-REQ-02：MySQL 并发要求真实 Domain Handler（而非 `race_probe_generic` 模型）在真实 MySQL 8 中对同一业务资源竞争，证明“一方成功/另一方合规拒绝或确定性串行”、零重复写入、零部分副作用。11 项关键竞态必须逐个映射源码、前后库存/AP/收货行快照和事务锁证据；SQLite 不能代替 MySQL。任何 `NOT_RUN` 不得改写为 PASS。

T-REQ-03：错误断言精确验证 status + error code/message + 状态不变；不得用 `201 或 409` 这种宽松区间掩盖错误。真实业务测试必须区分“源事实由 API 可生成”“函数可直接调用”“直接 SQL 造数”三个证据等级。

#### 31.12.8 集中业务决策登记（不重复要求确认已获批规则）

| ID | 归属 | 待定内容 | 当前建议/约束 | 负责人及停止点 |
|---|---|---|---|---|
| A-P01 | A | `solution.md §26.12` 独立完成通知表 vs `§26.20` 复用通知表，及历史行级来源迁移 | **Design reconciliation**，业务要求仅是单一可追溯的通知→收货来源；不得预先强制重复建表 | Procurement Design；Design 前需提供兼容论证 |
| A-P02 | A | 完成通知部分转换、拒收/退回重开、剩余量与批号继承边界中 Canonical 尚未明确之处 | 不改变已获批 multi-PO 和质量门禁；保持行级容量守恒 | Procurement/Quality Owner；具体规则不可证实时暂停该子项 |
| B-P01 | B | 跨订单/跨期 Supplier WIP 价值携带（源账面价值、价格差异、转移时点、期间锁） | 数量+成本必须守恒；不创造余额或历史凭证，暂不指定计价方法 | Finance Valuation + Inventory Owner；成本变动前需业务裁定 |
| B-P02 | B | 倒冲差异生成单据后的具体审核人、退补单撤销/冲销状态 | 手册方向与审核要求已明确；只待权限/状态细节 | Outsourcing + RBAC Owner；Design 需补充 |
| C-P01 | C | 委外加工费在收货、暂估、正式过账各时点的金额确认；是否产生及何时冲回 GRNI | 不直接照搬普通采购账务分录 | Finance + Accounting Owner；GL Implementation HARD STOP |
| C-P02 | C | 加工费会计科目/资本化、价差与税务（进项税适用性） | 不预设 `NO_TAX` 永久正确，也不允许伪造凭证模板 | Finance + Accounting Owner；GL Implementation HARD STOP |
| C-P03 | C | 过账后红冲/贷项与历史无原始凭证数据的处理 | 禁止自动补记不明来源的历史总账；迁移/补偿需独立授权 | Finance + Accounting Owner；历史处理 HARD STOP |
| C-P04 | C | Accounting Domain 尚未 Domain Closure 时，委外 Source→Canonical Voucher 的有界接入边界 | GL Owner 已固定为 Accounting；不创建委外专用第二 GL | Accounting Owner；跨域需求批准后设计 |
| D-P01 | D | VMI 结算窗口（周期/自定义）、消耗与物权转移的前后顺序、可结算数量口径 | 企业仓供应商所有权 + 数量守恒已批准；触发策略未批准 | Procurement/VMI + Finance Owner；结算 Implementation HARD STOP |
| D-P02 | D | VMI 物权释放数量的协议价格、税与账单日期以及部分结算规则 | 必须产生 Canonical Supplier Bill，不得仅保存客户端传入 ID | Procurement/VMI + Finance Owner；账单 Implementation HARD STOP |

不再重新征询：`STANDARD_PURCHASE` / `OUTSOURCE_PROCESSING` 区分、是否支持多 PO 收料、委外材料企业所有权、WIP 是地点而非物权、GL Owner 属 Accounting、采用 Canonical Supplier Bill 等已批准事实。没有完成 C/D 组政策裁定时，可独立推进其他不依赖子项的 Requirement/Design，但不能宣告整体闭合。

#### 31.12.9 未来验收 Gate（本轮全部 NOT_RUN）

| Gate | 业务断言（必要条件；不得以单个 HTTP 2xx 代替） | 证据层 |
|---|---|---|
| M1-GA01 | 委外收货生产 API 实际写表头+明细、来源正确、零空明细，IQC 从正式明细可达；无 SQL 造数 | HTTP + SQLite/MySQL |
| M1-GA02 | Standard PO→Notice→Purchase Receipt，允许无通知直接 PO→Receipt；多 PO 合并与行级部分转换，数量上限/事务/重放安全 | HTTP + SQLite/MySQL race |
| M1-GA03 | OUTSOURCE Order/Processing PO→完成通知→待检收货→IQC PASS/WAIVED→确认入库；错误来源 409、失败时库存/成本零副作用 | HTTP + Quality + Inventory |
| M1-GB01 | 委外发料/补料/退料沿 canonical stock positions/WIP/tracking 写真实库存；企业所有权保持、库存数量与流水可对账 | HTTP + Inventory snapshots |
| M1-GB02 | 分批完工、倒冲增量、真实估值 Writer、材料成本 + 加工费暂估证据一致；重复确认和并发不得双扣/双收 | HTTP + Valuation snapshots |
| M1-GB03 | 盘点多/少两方向正确生成候选退/补单，审核后才实效；跨单 WIP 迁移数量及经批准的成本算法守恒 | HTTP + approval + period |
| M1-GC01 | 加工费部分账单满足 active reservation ≤ eligible；缺字段 4xx；重复 POST 合规拒绝或幂等；关闭 AP/GL 业务日期拒绝过账 | HTTP + Finance |
| M1-GC02 | 经批准的会计政策下加工费 Supplier Bill→AP→Accounting Voucher/Entries→Payment/Credit 的来源与金额对账、期间/冲销可查 | Finance + Accounting reconciliation |
| M1-GD01 | VMI 期间汇总和 released quantity 可按结算窗口复现；Owner Change 物理数量净 0、供应商/企业 Owner 两端方向正确 | HTTP + Inventory + period |
| M1-GD02 | 经批准的 VMI 结算策略下 Supplier Bill/AP 从合法物权/数量/价格源自动形成且无重复结算 | HTTP + Finance |
| M1-GU01 | 两个受影响移动工作面无 `api.get/post` TypeError；320/390/430/680 宽度交互成功并检查 server RBAC | Browser |
| M1-GT01 | 11 项 MySQL 同资源竞争均直接调用真实 Domain Handler；证据包含拒绝方零副作用和权威库存/应付/通知快照 | Real MySQL 8 concurrency |
| M1-GT02 | UAT-14 正向 VMI Owner Dimension；库存 UAT-20 保留全段 +50 算术并新增独立 OWNER_CHANGE Handler Gate；历史 oracle 不掩盖错误 | Browser/HTTP + Inventory |

**真实性规则**：测试先证明原始 API 可执行，再证明领域 Writer/状态机/跨域后果；MySQL 必须是受保护、已明确授权的独立测试目标；不得运行或清理用户真实数据。测试直接创建 SQL Fixture 仅可用于独立单元/负向边界，不作为生产链通路证据。任何一个 Gate `NOT_RUN`、`FAIL`、手工造数替代业务或会计政策待定，都不能签发对应能力 `COVERED`。

#### 31.12.10 修复依赖与下一阶段边界

依赖仅定义为未来 Design/Implementation 规划约束，**不等于当前 Implementation 授权**：

- **可并行独立设计**：A（来源/收货明细与转换）、B（委外材料到 WIP 的权威实物与追踪）、D（VMI 期间汇总/Owner Change 与账单交接）、U/T（UI 可执行性、测试架构）；共同遵守 Domain Owner 与 shared writer 合同。
- **需要真实前置事实**：B 的倒冲/估值后续需要已生效材料/WIP 来源；A 的委外完成入库成本校验需要可信材料成本；C 的最终 AP/GL 过账需要 A 的正式收货行来源、B 的成本证据及经批准的 C 组会计政策。
- **不允许的强依赖**：不得将“完成所有委外收货 Schema”作为“开始修订委外发退料权威库存 Writer”的全局阻塞；不得把 UI 修复、VMI 结算或 11 项并发测试放在最后才补而不随批次运行。
- **设计必须解决**：§26.12/§26.20 通知表语义冲突、Canonical Inventory/Valuation 的一次写入、SQLite/MySQL 行锁与 schema parity、跨域事务/期间门禁、历史兼容与可逆性；只在获批 Design 阶段写入 `solution.md`。

#### 31.12.11 Requirement Stage 状态与 HARD STOP

- 本节是 **M1 Requirement 统一需求包的待验收文本**，不修改当前已冻结能力；§31 原始 Closure 历史不能被本节伪装成现已通过的 Domain Acceptance。
- 上游 M1 原报告及 M1-AE 有限勘误为审计输入；两者保留独立证据层级。原报告 UAT-20 `+50` 误判已撤回；VMI confirm HTTP 200；原报告 7 处 SQL INSERT 的小计更正为四个文件内 **8 处显式 INSERT**；E-06 是静态确认、运行未证。
- **尚未通过的决策**：A-P01/A-P02（结构/条件协调）、B-P01/B-P02（在制成本/审批）、C-P01..C-P04（会计政策及跨域接口）、D-P01/D-P02（VMI 结算策略）仍需设计/业务 Owner 按表裁定；不得因为本 Requirement 草案已写而默认为 APPROVED。
- **当前总体状态**：`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`。原 `G-1..G-5`、独立 UI/VMI/证据 Gap 保持开放；本阶段不签发 `COVERED`、Acceptance、Freeze、Release Readiness。
- **本阶段结束标识**：`M1_REQUIREMENT_DRAFT_READY_PENDING_OWNER_REVIEW`。等待用户批准 Requirement 与未决业务政策；**未授权 Design、Implementation、Migration、MySQL 写入、Git Commit/Push、发布、部署**。文档更新完成后按 `AGENTS.md §4.2` HARD STOP。

---
