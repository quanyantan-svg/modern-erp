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
> **（2026-11-02 范围重定基线提示）** 本文件当前含两个 M1 相关章节：§31.12（**M1 全范围**，
> 2026-10-31 已验收 `M1_REQUIREMENT_ACCEPTANCE_PASS`）与 §31.13（**M1-Core 首期**，
> 依 `M1-SRD-01` 重定基线，**待业务所有者批准**）。§31.12 **保留为历史批准合同**，
> 其历史批准事实不变；**首期（M1-Core）的当前有效合同是 §31.13**。
> 范围决定见 [`docs/decisions/m1-core-scope-rebaseline-20261102.md`](../decisions/m1-core-scope-rebaseline-20261102.md)。
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

> **2026-11-07 范围增补**：本文件 §31.14 记录本轮 Owner 已决定的 A1 SAFE_CLOSE 与 VMI 最小范围；它仅在所列能力上取代 §31.3.2、§31.8 中「VMI 五项全部完成 / 不得延期 VMI-05」的旧目标。§31.12、§31.13 的历史批准及 M1-Core Gate 状态不被重写。§31.14 为待验收 Requirement，不能授权 Implementation。

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

### 31.12 M1 采购与委外关键断链统一整改 Requirement（2026-10-31；业务所有者已验收 `M1_REQUIREMENT_ACCEPTANCE_PASS`）

> **（2026-11-02 日期化 supersession —— 首期当前效力）**
> 业务所有者于 2026-11-02 批准 `M1-SRD-01`（首期范围重定基线），
> 据此 **M1-Core 首期的当前有效 Requirement 改为 §31.13**。
> 本节的处置方式：
> - **本节正文整体保留**，一字不删；它是 **M1 全范围（A/B/C/D 四组 + 13 个 Gate）的历史批准合同**，
>   其 2026-10-31 的验收事实 `M1_REQUIREMENT_ACCEPTANCE_PASS` **保持不变**，不被本提示改写或撤销；
> - **首期（M1-Core）的验收条件以 §31.13 及其 7 个 `M1C-Gxx` Gate 为准**；本节的 13 个 Gate
>   继续作为 **M1 全域 Closure** 的验收合同，不再作为首期的阻塞项；
> - 本节 §31.12.3–§31.12.6 中 **C 组（加工费/GL）与 D 组（VMI 结算）** 的业务合同**整体延期**，
>   其首期安全边界改由 §31.13 `MC-REQ-15` 规定（危险写入必须拒绝且零副作用）；
> - 本节 §31.12.2 的 Gap 与 Coverage 登记、§31.12.7 的 U/T 组条款、§31.12.9 的 Gate 定义
>   **全部继续有效**，作为 M1 全域 Closure 的依据；其首期适用部分由 §31.13 逐条承接或显式延期；
> - 本节 §31.12.8 的十项集中业务决策**状态不变**；其首期处置见
>   [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md) §1.4。
>
> 追溯路径：本节原节号 `document.md §31.12`，源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`
> （`docs(m1): approve procurement and outsourcing requirement`）；迁移映射见
> [`docs/status/MIGRATION-MAP.md`](../status/MIGRATION-MAP.md)。
> **阶段与授权**：用户已接受《M1 Procurement & Outsourcing Critical Chain Audit Report》的有限勘误，并明确授权将已确认 Gap 和四组业务决策统一整理进入 **REQUIREMENT**。本节仅为业务 Requirement 修订，不构成 DESIGN / IMPLEMENTATION / ACCEPTANCE / FREEZE 或 Git 远端写入授权。依据：`document.md §22.1 / §22.21 / §31.1–31.11 / §35.8`、`solution.md §26`、M1 审计报告及 M1-AE 有限勘误；远端基线 `master@498d50143c1bd54f0d71447e5477872775910a81`。
>
> **证据纪律**：手册语义取自业务审查方提供的 B3101 / B3121 摘要及已批准 §22/§31，不得声称 Claude/Codex 可直接读取原 Word 手册。M1 原报告中的临时 SQLite 运行结果是“原审计执行者报告的证据”，本节不冒称重新执行；未运行的 MySQL / 浏览器验收均为 `NOT_RUN`。原 §31.11 的历史证据与 `NOT READY` 状态保持原样。
>
> **验收登记（2026-10-31，R-ACC 独立步骤）**：业务所有者明确接受 M1 原 Audit 及 M1-AE 有限勘误，批准本节 Requirement，签发 **`M1_REQUIREMENT_ACCEPTANCE_PASS`**，并授权进入 M1 Design。本登记**只**改写本节的阶段状态标识与授权边界，**不**修改 §31.12 的业务合同、Gap 映射、Capability 归属、验收 Gate 与十项未决业务政策；§31.11 的历史证据与 `NOT READY` 状态保持原样。已核实的 GitHub 基线为 `master@4cb8c477aa00988bbfebef905764565cdfe62b71`（`docs(m1): approve procurement and outsourcing requirement`，Requirement 正文已随该提交推送到 `github` 与 `origin` 双远端）。Design 授权边界与十项未决政策处置见 `solution.md §26.33`。

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

- 本节是 **M1 Requirement 统一需求包的已验收文本**（`M1_REQUIREMENT_ACCEPTANCE_PASS`，2026-10-31），不修改当前已冻结能力；§31 原始 Closure 历史不能被本节伪装成现已通过的 Domain Acceptance。
- 上游 M1 原报告及 M1-AE 有限勘误为审计输入；两者保留独立证据层级。原报告 UAT-20 `+50` 误判已撤回；VMI confirm HTTP 200；原报告 7 处 SQL INSERT 的小计更正为四个文件内 **8 处显式 INSERT**；E-06 是静态确认、运行未证。
- **尚未通过的决策**：A-P01/A-P02（结构/条件协调）、B-P01/B-P02（在制成本/审批）、C-P01..C-P04（会计政策及跨域接口）、D-P01/D-P02（VMI 结算策略）仍需设计/业务 Owner 按表裁定；不得因为本 Requirement 草案已写而默认为 APPROVED。
- **当前总体状态**：`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`。原 `G-1..G-5`、独立 UI/VMI/证据 Gap 保持开放；本阶段不签发 `COVERED`、Acceptance、Freeze、Release Readiness。
- **Requirement 阶段结束标识**：`M1_REQUIREMENT_ACCEPTANCE_PASS`（2026-10-31 业务所有者批准）。该标识**只**覆盖本节 Requirement 文本的验收，不覆盖任何 Capability 的 `COVERED`、Domain Acceptance、Freeze 或 Release Readiness。
- **后续授权**：业务所有者已授权进入 **M1 Design**（`AGENTS.md §4.3`），Design 唯一允许修改 `solution.md` 与 M1 相关章节及当天日志，并在完成后 HARD STOP。**仍未授权** Implementation、Migration 执行、MySQL 写入/重置、Git commit/push/merge/tag、发布、部署；§31.12.9 全部 13 个 Gate 仍为 `NOT_RUN`。

---

### 31.13 M1-Core 采购与委外首期 Requirement（2026-11-02；**已批准**）

> **阶段与授权**：业务所有者于 2026-11-02 批准 `M1-SRD-01`（首期范围重定基线，见
> [`docs/decisions/m1-core-scope-rebaseline-20261102.md`](../decisions/m1-core-scope-rebaseline-20261102.md)），
> 授权在本节完成 **M1-Core 首期**的 Requirement 修订。业务所有者于 2026-11-02 完成正式验收，
> Acceptance ID = `M1_CORE_REQUIREMENT_ACCEPTANCE_PASS`。本节是 **REQUIREMENT**，不是 IMPLEMENTATION /
> CAPABILITY ACCEPTANCE / FREEZE，**不**签发任何 Capability 的 `COVERED`，
> **不**授权 Implementation、Migration 执行、数据库写入或重置、MySQL Gate 运行、
> Git 写操作、发布或部署。
>
> **本节与 §31.12 的关系**：§31.12 是 M1 全范围的历史批准合同，其正文与验收事实**保持不变**；
> 本节是 **M1-Core 首期**的当前有效 Requirement，两者**并行有效**、各司其职：
> §31.12 继续作为 M1 全域 Closure 的依据，本节决定首期（M1-Core）的验收条件。
> **M1-Core 包级 Acceptance ≠ Procurement & Outsourcing 全域 Closure Acceptance。**
>
> **上游依据**：`document.md §22.1 / §22.21 / §31.1–§31.12 / §35.8`、`solution.md §26`、
> §31.12 全部业务合同、M1 审计报告与 M1-AE 有限勘误、M1 候选设计（源 `solution.md §26.33`），
> 以及 `M1-SRD-01` 的三项范围决定。基线 `master` @ `759d7216c7546ffa00a147f603c4e8852aada991`。
>
> **证据纪律**：本节全部函数名、表名、列名与现状判断来自对生产源码的逐处核对；
> **不存在**于源码的接口一律标注为"不存在（本次需新建）"，不得以文档既有措辞冒充实现。
> 本节**未运行**任何测试、MySQL 或浏览器；§31.13.5 的 7 个 Gate 全部为 `NOT_RUN`。

#### 31.13.1 首期范围与不变量继承

**IN SCOPE（首期核心能力链）**：

1. 采购侧：采购收料通知、采购订单来源转换、IQC、采购入库；
2. 委外物料侧：委外订单、BOM 用料、发料、退料、补料、Supplier WIP；
3. 委外完工侧：委外完工通知、正式收货明细、质量门禁、合法增量倒冲、成品入库；
4. 横切能力：必要的 canonical Inventory / Tracking / Valuation、数量守恒、来源追溯、事务、
   幂等、权限与审计。

**OUT OF SCOPE（首期不包含，延期）**：高级跨订单/跨期 WIP、复杂倒冲差异审批、VMI 结算、
委外 AP/GL 自动过账、历史会计补偿。

**继承且不得删除的全局不变量**（本节**不**因收缩范围而放弃其中任何一条）：

| # | 不变量 | 来源 |
|---|---|---|
| INV-1 | Domain Owner 边界不变：物理库存真相、LOT/SERIAL、唯一权威 Mutation 与估值余额属 Inventory；IQC 判定属 Quality；Supplier Bill / AP / 暂估属 Finance；GL / 凭证 / 期间属 Accounting。**不得**新建第二 AP、第二估值账、第二收货引擎 | §31.12.1 |
| INV-2 | 委外材料**全过程属于企业**；Supplier WIP 是**物理/保管位置**，不是物权变更；**不得**复用 VMI ownership semantics | §31.2 / §31.3.3 OUT-14 |
| INV-3 | 委外材料执行、倒冲、LOT/SERIAL **必须**复用 Inventory 唯一权威 Writer；**不得**裸 `UPDATE` 库存余额、**不得**硬编码仓库、**不得**只写库存流水而不更新价值余额 | §31.12.4 / §31.9.10 |
| INV-4 | 委外成本证据 = **实际倒冲消耗材料的账面价值 + 加工费**；**排除**发出未耗用、已退回、仍留在 Supplier WIP 的材料 | §31.2 / OUT-21 |
| INV-5 | OUT-08 BOM 消费规则（approved / effective / `purpose=OUTSOURCE` / business-date appropriate；**禁止** `ACTIVE LIMIT 1`）与 OUT-09 用料清单快照规则（每单位用量 + 订单总量；Release 后不回写历史；额外材料走 Supplement）**继续有效** | §31.3.3 |
| INV-6 | 通知单**不**改变库存、估值、GRNI 或 AP；"建待检单据"与"确认库存效力"是**不同动作** | §31.2 / §31.12.3 A-REQ-04 |
| INV-7 | schema 改动**全部 additive**；不 DROP 历史表、不做 destructive rewrite、不 retroactive rewrite 历史已批准 PO / Receipt / Bill / AP；SQLite + MySQL 8 schema parity；migration idempotent | §31.6 / §31.8.B |
| INV-8 | 全部 Procurement / Outsourcing mutation **后端 fail closed**；前端 hidden 不等于 authorization；关键 mutation 写 audit | §31.8.C |
| INV-9 | `STANDARD_PURCHASE` / `OUTSOURCE_PROCESSING` 语义隔离；`OUTSOURCE_PROCESSING` PO **不得**承载企业供料物料行 | §31.2 / §31.12.3 |
| INV-10 | 历史事实**不得**伪造；GET/CHECK **不得**静默修复历史；不可证明的数据**不得**推算、自动补记或默认归零（`SRD-03`） | §31.12.2 / `SRD-03` |
| INV-11 | `receipt_notices` 与 `outsourcing_receipts` 的**来源关系**必须可追溯；`business_type` 不得被客户端字段绕过 | §31.12.3 A-REQ-02 |
| INV-12 | 幂等：同一业务动作重放**不得**产生第二次库存、成本、通知数量或容量占用；错误必须**精确**返回 status + error code，**不得**用宽松区间掩盖 | §31.12.7 T-REQ-03 |

#### 31.13.2 核心业务合同

##### MC-REQ-01 业务单据的生产 API 可达性

- 委外收货草稿/待检事实**必须**可由**生产 API**创建，且必须包含**一条或多条非空、合法**的产品/数量明细；
  每行指向委外订单、适用的加工费 PO 行/完成通知来源，以及必要的产品 / UOM / LOT/SERIAL / 仓库身份。
- 表头与明细**原子创建**，失败时**零副作用**；总数量必须等于明细之和。
- **不得**依赖测试私有 SQL `INSERT` 制造下游可达条件。直接 `INSERT` 生产路径不存在的表
  （当前 `outsourcing_receipt_items` **无生产写入方**）即视为不达标。
- 采购侧对称要求：采购收料通知**必须**可由生产 API 创建并包含行级来源；
  采购入库**必须**可由生产 API 从订单或通知来源创建。

##### MC-REQ-02 采购收料通知、来源转换与多 PO 容量

- 转换必须由**服务端**验证 `business_type`、supplier、订单/订单行、warehouse、quantity、UOM 与状态；
  **不同业务类型强制拒绝**，**不得**凭客户端字段绕过。
- 一张标准采购通知**可**关联**多个**同供应商、兼容仓库/业务类型的采购订单**明细来源**；
  **不得**被单值 `purchase_order_id` 结构限制。
- 支持**部分转换**与重复收货；累计转换/已确认数量**不得**超过**按通知 `business_type` 分别适用**的
  容量上界（**不得**把某一业务类型才存在的上界强加于另一类型）：

  | 通知 `business_type` | 适用的容量上界 | 权威口径 |
  |---|---|---|
  | `STANDARD_PURCHASE` | ① 通知行剩余 × ② 有效**采购订单行**剩余 × ③ **交期 / 容差**剩余 | ② = 供料 PO 行数量 − 已收货 − 已分配；③ = `purchase_order_delivery_schedules` 绑定**供料 PO 行**的可消费量 − 已消费量 |
  | `OUTSOURCE` | ① 通知行剩余 × ② **委外订单**剩余可收量 | ② = `outsourcing_orders.order_quantity` − 累计合格收货量 |

  - `STANDARD_PURCHASE` 通知**不存在**委外订单，**不得**对其套用委外订单剩余可收量；
  - `OUTSOURCE` 通知**不存在**供料 PO 行，**不得**对其套用采购订单行剩余；
    其采购侧是**加工费 PO**，而加工费 PO 的交期计量的是**加工费交付**而非**物料收货数量**，
    因此加工费 PO 行与其交期**均不构成**收货容量上界；
  - 两类共同适用的第五个必要条件：**供应商与仓库相容性**（不相容即拒绝）。
- 转换已用数量与剩余量**必须**可查询、可审计、可追溯，且**累计单调不减**。
- `receipt_notice_item_sources.converted_quantity` 的数据库默认值继续为 **NULL**：
  NULL 只表示历史或来源尚未证明的累计转换量，**不得**以 `NOT NULL DEFAULT 0`、批量回填或
  `COALESCE(converted_quantity, 0)` 把历史未知量变成可用容量。
- 权威生产 API 在**首次创建**一条已完整验证的新通知来源行时，必须在创建该行的**同一权威事务**内
  显式写入 `converted_quantity = 0`。该 0 只证明“这条新来源行创建时尚未发生转换”，
  不是对历史记录的推断。创建失败不得留下半成品来源行；重试不得把已有非零累计量重置为 0，
  也不得以 `created_at`、当前日期或其他模糊条件把历史行认作新行。
- **标准采购通知来源行的唯一生产 Writer** 是
  `server/modules/procurement-receiving.js::createReceiptNotice()`，或由该函数在**同一权威事务**内调用的
  明确、私有、专用来源分配 helper。该 Writer 必须原子完成通知表头、通知明细、已验证 PO 行来源分配
  与来源行初始 0；任一校验或写入失败时整体回滚。未来的
  `server/modules/procurement-notice-conversion.js` **只读既有来源行并累计转换量**，不得创建来源行，
  也不得在重试时把非零累计量重置为 0。
- **多 PO 输入合同（`NEW_DESIGN_TARGET`，不是当前已实现 API）**：在保留当前单 PO
  `purchaseOrderId + items[].purchaseOrderItemId` 兼容输入的同时，标准采购通知行以
  `items[].sourceAllocations[]` 显式提交多来源分配；每项包含
  `purchaseOrderItemId`、可选 `deliveryScheduleId` 与正数 `allocatedQuantity`。
  Writer 必须验证 PO 行真实存在、所属订单为 `APPROVED + STANDARD_PURCHASE`、供应商一致、产品与通知行一致、
  同一通知行内 PO 行不重复、分配量之和等于通知行数量；交期存在时必须属于该 PO 行，零个有效交期、
  多交期未显式指定或历史容量不可证明均 fail closed。表头 `purchaseOrderId` 仅作兼容派生提示，
  不得作为多 PO 来源权威；转换与容量判断只认行级来源集合。
- `receipt_notice_item_sources` **只承载 `STANDARD_PURCHASE` 的已解析供料 PO 来源关系**。
  `OUTSOURCE` 继续通过“委外订单 → 加工费 PO → 委外完工通知 → 委外收货明细”追溯，
  不创建标准采购来源行，不得为复用该表而改变委外来源语义。
- **`STANDARD_PURCHASE`** 通知无有效交期、多交期归属不明或历史容量无法证明 → 明确拒绝（fail closed）；
  **`OUTSOURCE`** 通知的累计合格收货量不可证明 → 同样明确拒绝；
  **不得**以省略参数的方式绕过上界。
- **已转换的通知，其来源容量不得未经证明自动恢复**（`T-11` 原始含义：转换后取消的来源容量语义）：
  `converted_quantity` 表达**历史累计转换事实**，单调不减；取消不恢复通知来源容量；
  任何重新转换在无不可变转换冲销台账前一律拒绝。
- 无通知的**直接订单 → 采购入库**仍是合法既有路径，**不得**被强制取消；
  该路径**不经过**通知容量上界，只受**采购订单行剩余**与（若存在）交期约束。
- LOT/SERIAL **只能**继承自可验证的实物或来源身份；**不得凭空继承**。

##### MC-REQ-03 委外订单与 BOM 用料

- 委外订单**必须**消费符合 INV-5 的 OUTSOURCE BOM，**禁止** `ACTIVE LIMIT 1` 选择器。
- 委外订单必须保存/确认时形成**用料清单快照**：BOM/版本、组件、**每单位用量**、损耗、**订单总量**；
  Release 后 master BOM 改变**不**回写历史；额外材料走**补料**。
- 快照必须同时承载每单位用量与订单总量（订单总量 = 每单位用量 × 订单数量）；
  倒冲基数取**订单总量**口径，preview 与 apply **必须**使用同一口径。

##### MC-REQ-04 发料 / 退料 / 补料与 Supplier WIP 真实库存

- Issue / Supplement / Return 的**有效业务状态**与仓位 Mutation、跟踪、库存流水必须**原子一致**。
- 发料 = 企业仓 → 供应商 WIP 仓；退料 = 供应商 WIP 仓 → 企业仓；补料与发料同一链路。
- 仓库**必须**由已验证的 supplier profile / 订单上下文解析，**不接受**任意客户端
  `fromWarehouseId` / `toWarehouseId` 越权指定。
- **不得**因业务计数器变化而凭空产生库存：当前"计数器更新"不等于"权威库存写入"，
  首期必须真正经由 canonical Writer 写物理库存、跟踪与估值。
- 缺失 WIP 仓库、库存不足、不相容 tracking、无权限或数量非法 → **fail closed**；
  业务单据、库存、估值、审计**不得**出现部分成功。
- 数量要求有限、正数、合法 UOM；**约束**累计已发、已退、已补、可用 WIP、可倒冲数量；
  重放**不得**产生第二次动作。

##### MC-REQ-05 委外完工通知、正式收货明细与质量门禁

- 委外完工通知行**必须**可生成委外收货行；来源链（委外订单 → 加工费 PO → 完工通知 → 收货明细）
  **必须**逐行可追溯。
- 采购/委外入库在**应检验场景**必须由权威 Quality 判定 `PASS` 或 `WAIVED` 才能形成**库存效力**；
  不合格或未检时**不得**进入可用库存/成本。
- "**建待检收货**"与"**确认库存效力**"是**两个不同动作**：先产生待检收货表头明细供 IQC 读取，
  再由确认动作产生库存效力。
- 重复确认与并发转换**不得**重复计入库存、成本或通知数量。

##### MC-REQ-06 合法增量倒冲与真实材料成本

- 按委外订单用料清单行与**累计合格收货量**计算**增量**倒冲；
  只消耗**该订单**对应可追溯 WIP，**不得**越额、**不得**跨订单、**不得**跨 LOT/SERIAL、
  **不得**跨 UOM 静默取料。
- 增量倒冲**只**对本次**正增量**产生一条物理 OUT 腿与一条 OUT 跟踪腿；
  **无** IN 腿、**无**成品价值确认；**不得**重扣既有累计倒冲。
- 材料成本**必须**来自 canonical 估值账（位置口径分摊），**禁止**跨仓全局平均价；
  估值 Movement 与 Balance **必须**双写并对账。
- **严格支持范围**（首期，见 §31.13.4 的 `M1-P-02`）：
  1. 有明确 BOM 来源与物料行身份；
  2. 单位一致，或存在**已批准且可证明**的换算；
  3. **不支持的损耗/换算组合一律 fail closed**，**不得**生成倒冲数量或成本；
  4. **不得自行创造新的损耗公式**。
- 材料实耗价值与加工费暂估、正式账单金额与差异**必须**分别记录并可追溯。

##### MC-REQ-07 成品入库

- 只有通过质量与其他入库门禁的委外收货才形成**企业仓成品库存事实**。
- 成品入库**必须**经唯一权威 Inventory Writer 进入企业仓，**禁止**硬编码仓库、
  **禁止**裸插值变动表但不更新价值余额。
- 成品**不得**通过 VMI 式物权转移建模；Supplier WIP 仅为来源/位置上下文。

##### MC-REQ-08 数量守恒与来源追溯

- 按产品、仓库、owner、库存状态、批/序列号及订单相关身份追踪；
  发/退/补/倒冲每一步**必须**证明总物理数量守恒，或存在**明确的合法增减来源**。
- 每个物理腿**必须**携带：来源类型、业务事件 ID、业务事件项 ID、腿序号、身份键
  （五字段 Mutation Key），使**同一事件内的多个物料行与身份子腿互不撞键**。
- **非预期重放必须被硬断言拒绝**，**不得**静默丢弃后续物理腿。
- 每笔业务记录**必须**可追溯到：采购订单行 / 委外订单行 / 加工费 PO 行 / 通知行 / 收货明细 / 库存流水。

##### MC-REQ-09 事务边界与幂等

- 通知创建、确认、转换、收货确认、发料/补料/退料、倒冲、成品入库，
  必须在**单一权威事务**内**重读并锁定**必要的来源与数量容量。
- 幂等 scope 固定为 `(operation_type, document_id, idempotency_key)` 三元组，与 canonical
  财务幂等存储与唯一键**一致**；创建类 API 使用请求期 scope。
- 幂等键与物理腿 Mutation Key **必须**严格分离；外部幂等键**不得**直接充当物理腿键。
- 容量检查**必须**在事务内以**权威口径**比较：比较总量**必须包含**本次待确认的数量，
  并**净除**已转换量，避免与已收货量重复扣减。

##### MC-REQ-10 权限与职责分离

- 委外**业务操作**（订单、发退补料、完工通知、收货录入）、**收货生效**、**IQC**、
  **加工费正式过账**必须分属**不同权限**。
- **收货生效**（产生成品库存效力）必须**只**由**收货管理权限** `OUTSOURCING_RECEIVING_MANAGE`
  持有；**不得**由委外业务操作权限 `OUTSOURCING_MANAGE` 承担，否则业务操作者可自行使收货生效。
  **首期不得**为此新增独立权限（新增权限属角色授予矩阵裁定范围），**不得**擅自把既有权限授予任何角色。
- 委外业务角色**不得**持有加工费正式过账权；**不得**因现有 `OUTSOURCING_MANAGE` 权限过宽
  就保留财务越权路径。
- 加工费正式过账必须通过适用的 `SUPPLIER_BILL_MANAGE` 权限检查。该权限按已批准矩阵只显式授予
  `role-accounting`（普通采购），不得授予委外业务员或其他普通业务角色；`role-admin` 可经
  all-permissions 持有，因此 RBAC 通过**不能**证明委外来源账单可以过账。
  无论角色及权限如何，`MC-REQ-15` 的来源级 Business Policy Guard 都是独立的第二层门禁：
  未批准政策下的委外来源账单不得正式过账或匹配，管理员也无豁免。
- 全部授权判定在**后端**；前端隐藏不构成授权。

##### MC-REQ-11 审计

- 关键 mutation **必须**写 audit：通知创建/确认/取消/转换、收料、发料/补料/退料、倒冲、
  收货创建/生效、成品入库、被拒绝的权限与容量失败。
- **零副作用域与拒绝审计的边界**（Gate 断言必须据此表述）：
  - **零副作用域 = 业务事实与财务/库存状态**：业务单据与其状态字段、库存数量、跟踪分配、
    估值 Movement / Balance、AP / AR、凭证、分录、成本证据、交期台账、来源容量。
    上述各项在拒绝路径上**必须**逐字段保持前后一致。
  - **审计行不属于零副作用域**。因此"零副作用"**必须**表述为
    "**业务**零副作用 + 拒绝审计**恰好 1 条**"，**不得**表述为"审计全零"。
  - **业务门禁拒绝**（容量、交期、质量门禁、身份证据、延期政策；HTTP 409）与
    **权限拒绝**（HTTP 403）**均必须**写**恰好 1 条**拒绝审计：
    409 审计含业务单据标识与精确 error code；403 审计含主体、动作与被拒权限，
    **不得**包含业务单据标识（未授权主体不得读取业务单据）。
  - **请求格式 / 字段校验失败**（HTTP 400）**不**写 Domain 审计；
    由此"拒绝审计恰好 1 条"的断言无歧义。
- 审计**必须**记录业务单据标识与来源身份，使库存、成本与业务单据三者可互相回溯。
- 审计 schema 的结构化增强（`business_date` / `request_id` / before-after）**不在首期范围**
  （属 Platform / Finance 域独立授权），首期**不得**因此跳过 audit 写入。

##### MC-REQ-12 历史数据隔离与 fail-closed

- **只**使用真实可证明的历史来源、数量、身份与成本事实；**不可证明**的数据
  **不得**推算、**不得**自动补记、**不得**默认归零。
- 历史委外收货的效力**不得**无条件映射为"已生效"：必须按**可核查证据**
  （库存流水 / 估值流水 / 质量判定 / 成本证据 / 来源明细）判定为"已生效已确认"或"历史未证实"；
  后者**不开放**新的账单与退货能力，且**不改写**历史记录。
- 历史 WIP **没有**身份证据时，一律留在"历史不可验证"隔离桶内，
  **不得**被新的转出或倒冲动作消费；**不得**按比例分摊、**不得**推定 LOT/SERIAL。
- “首期零历史回填”精确定义为：**零历史业务事实重建、零不可证明的历史补记**。唯一有条件例外是
  `M-15` 的技术性身份键规范化：后续仅在取得**独立 Migration 授权**后，才可对已存在且身份字段
  明确、一致、可验证的 `tracked_inventory_movements` 生成确定性 `identity_key`，用于现有严格跟踪事实的
  去重与唯一性约束。该规范化不得改变历史业务数量、归属、库存效果、估值、来源项或单据状态，
  不等于恢复或证明历史 WIP 可用量；身份不明或冲突的 LOT/SERIAL 记录不得被强制写成 `NONE`。
- `M-15` 的产品跟踪权威是 `tracked_inventory_movements.product_id → products.tracking_policy`；
  合法值沿用现有 `NONE / LOT / SERIAL`，不得虚构替代字段。确定性映射只允许：

  | `products.tracking_policy` | 历史身份字段 | 允许的 `identity_key` |
  |---|---|---|
  | `LOT` | 有效且唯一的 `lot_id`，`serial_id` 为空 | `LOT:<lot_id>` |
  | `SERIAL` | 有效且唯一的 `serial_id`，`lot_id` 为空 | `SERIAL:<serial_id>` |
  | `NONE` | `lot_id`、`serial_id` 均为空 | `NONE` |
  | `LOT` 缺 `lot_id`；`SERIAL` 缺 `serial_id`；`NONE` 携带任一身份；双身份并存；策略或来源不可证明 | 任意 | **FAIL，停止迁移** |

  旧候选 Design §26.33.12 `M-15 STEP-3` 的无条件 `ELSE 'NONE'`，以及旧 PRE-B
  “两种身份字段均为空即为 `NONE`”的规则，**对 M1-Core 已被本合同取代**；不得据其实施。
  PRE-B 必须联合验证产品策略、历史 `lot_id/serial_id` 与生成后的 `identity_key`，
  不得把身份不明记录自动归类为非跟踪物料。
- 处置方式只允许：**只读 / 隔离 / fail closed**。大规模历史治理与会计补偿**延期**。

##### MC-REQ-13 SQLite / MySQL 8 兼容

- 新增表 / 列 / 索引**全部 additive**，两引擎**语义对等**；migration **idempotent**。
- 唯一性与去重必须使用**两引擎等价**的机制：不得依赖"NULL 在 UNIQUE 索引中互异"
  或"生成列摘要"这类单引擎行为。
- 锁语义必须两引擎都有等价实现（行锁 / 立即写事务），不得只在单引擎下正确。
- DDL 自动提交的引擎上，migration 必须**按已完成步骤可重放**，并规定部分完成后的重试语义。
- `M-15` 必须保持 `PRE-A → 加列 → 确定性规范化 → PRE-B / PRE-C → 建唯一索引` 顺序；
  PRE 检查读取真实目标数据，失败即停止且不自动修复。不得删除历史流水、伪造 `source_item_id`、
  覆盖已有非空身份；唯一索引未确立或 PRE 未通过时，相关委外跟踪写入继续 fail closed。

##### MC-REQ-14 移动端有限修复

- 采购寻源与委外**现有工作面**必须能正确调用项目统一的 `api(path, options)` 接口
  及对应后端权限/路由；**不得**调用不存在的导出。
- 必须通过**真实浏览器**检查入口、列表/详情/提交与错误展示；宽度 320 / 390 / 430 / 680。
- **只**修复已发现的可执行性缺陷与基本交互错误；**不**重做 MobileShell、导航或视觉体系。
- 首期**不**交付完整现场移动工作流（另立工作包）。
- 修复**不得**改变业务术语、API 合同、权限、状态机、Approval/Confirm/Post/Reverse 语义、
  source/downstream 关系或库存/会计事实。

##### MC-REQ-15 延期财务与 VMI 危险写入的拒绝边界

- **委外加工费正式过账**（`C-P01..C-P04` 未裁定）必须 **fail closed**：
  返回 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`，账单保持 `DRAFT`，
  **零 AP open item、零凭证、零分录、零成本证据刷新**。
- 门禁顺序固定为：HTTP 入口先执行适用的身份与 RBAC 检查；未授权主体按既有合同返回 403，
  且在授权检查前不得读取或泄露账单来源。对已通过权限检查的请求，再执行独立的来源级
  Business Policy Guard；只要任一账单行来源为 `OUTSOURCING_RECEIPT_ITEM`，普通业务用户、
  财务用户与管理员均返回 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`。内部服务调用必须调用同一
  业务 Guard、不得绕过，但无需伪装成 HTTP 403/409，必须保持项目既有错误传播与异常处理合同。
  不得仅凭 `ADMIN` 或 `SUPPLIER_BILL_MANAGE` 绕过。
- **拒绝必须落在来源级，且覆盖共享入口**（**不得**只在委外专用入口拒绝）：
  - 判定依据是**账单行的商业来源**，不是路由、不是操作人、也不是账单级单一列：
    一张 `supplier_bills` 账单只要存在任一 `supplier_bill_items.commercial_source_type
    = 'OUTSOURCING_RECEIPT_ITEM'` 的行，即为**委外加工费账单**，其**正式过账**一律拒绝。
  - 必须覆盖的入口：委外专用过账入口、**共享**供应商账单过账入口、
    共享账单**匹配**入口、以及由普通采购入库自动生成账单的**内部调用**路径。
  - **普通采购账单**（来源为 `purchase_receipt_items`）的创建、匹配与过账**必须保持合法**，
    **不得**因上述拒绝规则而被误伤。
  - 拒绝判定必须发生在**任何状态变更之前**（账单 `status` / `grni_cents` / `variance_cents`
    全部不变），**不得**依赖"恰好缺少某来源列"这类偶然失败作为拒绝依据。
- **委外加工费账单的"草稿创建"与"正式过账"是两个不同动作**，边界必须明确且自洽：
  - **草稿创建**（`POST /api/procurement/outsourcing/processing-fee-bills`）**允许**：
    只登记"待裁定事实"，账单状态为 `DRAFT`，
    **零 AP open item、零凭证、零分录、零成本证据刷新**；
  - **正式过账**（`POST /api/procurement/outsourcing/processing-fee-bills/:id/post`
    与共享的 `POST /api/supplier-bills/:id/post`）**一律拒绝**。
  - **不得**出现"一处允许草稿、另一处把全部加工费账单操作一律禁止"的自相矛盾表述。
- **VMI 结算 / 物权释放 / 账单交接**（`D-P01` / `D-P02` 未裁定）必须 **fail closed**：
  **零库存位变化、零期间与结算行、零账单**（业务事实零变化；拒绝审计依 `MC-REQ-11` 边界处理）。
- **倒冲差异单据的审核生效路径**（`B-P02` 未裁定）必须 **fail closed**：
  差异**只提供只读 preview**，任何"审核后生效"写入一律拒绝。
- **跨单 WIP 成本携带**（`B-P01` 未裁定）必须 fail closed：`cost_cents` 保持 NULL、
  `cost_state='UNVERIFIED_COST'`；**不得**以假定平均价生成不可逆历史账务。
- 上述拒绝**必须**由**服务端**执行并有**零副作用**断言（按 `MC-REQ-11` 的零副作用域表述）；
  **不得**以简单隐藏 UI 代替服务端拒绝与零副作用验证。

#### 31.13.3 依赖与不可强依赖

- **可并行独立推进**：采购**直接**入库路径与 IQC、**采购通知转换**路径
  （`A-P01` 已由 Design 技术接受，`A-P02` 拒收重开、`T-11` 取消后容量恢复、
  零有效交期三项均按**受限行为** fail closed，**不阻塞**多 PO 与行级部分转换主链）、
  委外收货明细与两段式生效、发退补料的 canonical Writer、增量倒冲与成品入库、
  权限门禁收紧、历史 fail-closed、移动端有限修复。
- `M1-P-03` 角色授予矩阵已由业务所有者于 2026-11-02 批准；它不再构成政策阻塞。
  Implementation 必须创建/配置获批角色，并由**委外收货员**取得 `M1C-G02` 正向证据；
  管理员不得替代职责分离正向证据。
- `M1-P-02` 仍仅在希望**放宽**严格支持范围时需要签字；首期继续 fail closed。
- **不得**把"完成委外收货 Schema"当作"开始修订发退补料权威 Writer"的全局阻塞；
  **不得**把 UI 修复或并发证据留到最后才补。

#### 31.13.4 政策处置与待业务所有者签字项

完整登记见 [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md) §1.4。本节只登记**首期适用结论**：

| ID | 首期适用结论 | 状态 | 首期行为 |
|---|---|---|---|
| `A-P01` | 唯一权威通知模型 = 复用 `receipt_notices` + `receipt_notice_items` + 行级来源表；**不新建**第二套委外完成通知表 | `DESIGN_TECHNICAL_ACCEPTED`（Owner 已确认） | 裁定权仍属 Procurement Design；业务所有者已于 2026-11-02 在本节 Requirement Acceptance 中正式确认该唯一模型，不与 M1 全范围历史登记混淆 |
| `A-P02` | 保留多 PO / 行级部分转换 / 累计容量上限；首期**不开放**复杂拒收重开与自动再转换；LOT/SERIAL 只继承可验证身份 | `CORE_LIMITED_PENDING_OWNER` | **受限行为**：拒收重开与自动再转换类请求一律 409 且零副作用。**不阻塞**多 PO 与行级部分转换主链；签字只在**放宽**该收缩时需要 |
| `M1-P-02` | 主歧义（每单位用量 vs 订单总量）**已由**已批准的 OUT-09 / OUT-08 规则闭合；损耗计入与单位换算仍待裁定 | `CORE_LIMITED_PENDING_OWNER` | 严格支持范围外 fail closed（409 `OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED`）；**仅放宽时**需签字 |
| `M1-P-03` | 最小权限矩阵：委外业务员 = `OUTSOURCING_MANAGE` + `OUTSOURCING_MATERIAL_EXECUTE`；委外收货员 = `OUTSOURCING_RECEIVING_MANAGE`；质检人员（`role-warehouse`）= `IQC_MANAGE`；财务人员（`role-accounting`）= `SUPPLIER_BILL_MANAGE`（仅普通采购）；`admin` 保留 all-permissions 但无来源级政策豁免 | `APPROVED` | 业务、收货、IQC、正式过账严格分离；收货录入与生效只认 `OUTSOURCING_RECEIVING_MANAGE`，不得以 `OUTSOURCING_MANAGE` 回退；角色与授予仍待 Implementation 落地，本轮未修改权限种子 |
| `T-11` | **原始含义 = 通知转换后取消的来源容量语义**：`converted_quantity` 为历史累计事实、单调不减；取消**不**恢复通知来源容量；重新转换 fail closed | `CORE_LIMITED_PENDING_OWNER` | **受限行为**：按上述 fail closed 语义实现，**不阻塞**主链。**不得**把 `T-11` 改写为"零交期政策"——零有效交期属**交期上界**的独立技术合同，见 `MC-REQ-02` |
| `B-P01` / `B-P02` | WIP 成本携带 / 差异审核生效 | `DEFERRED_PENDING_POLICY` | 见 `MC-REQ-15` |
| `C-P01..C-P04` | 加工费确认 / 科目 / 红冲 / GL 边界 | `DEFERRED_PENDING_POLICY` | 见 `MC-REQ-15`（含草稿创建与正式过账的边界） |
| `D-P01` / `D-P02` / `M1-P-04` | VMI 结算 / 价格 / 关期容差 | `DEFERRED_PENDING_POLICY` | 见 `MC-REQ-15` |

> `M1-P-03` 已于 2026-11-02 获批；剩余签字点只涉及 `M1-P-02` 的**放宽方向**（仅在希望放宽时）。
> `A-P01` 保持 Design 技术接受且已获 Owner 正式确认；`A-P02` 与 `T-11` 的**收紧方向**按受限行为直接实施，
> **不阻塞** `M1C-WP-1` / `M1C-G01`，**不**阻塞任何首期工作包的代码实施。
> 状态词 `DESIGN_TECHNICAL_ACCEPTED` 的定义见
> [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md) §1.4；
> `DESIGN_TECHNICAL_ACCEPTED` 仍表示裁定权属于 Design；本次 Owner 确认另行登记，二者均**不**等于 Implementation 许可。

#### 31.13.5 首期验收 Gate（M1C-G01 … M1C-G07；全部 `NOT_RUN`）

| Gate | 业务断言（必要条件；**不得**以单个 HTTP 2xx 代替） | 证据层 |
|---|---|---|
| `M1C-G01` | 采购通知可达；`createReceiptNotice()`（或其同事务私有来源 helper）原子创建标准采购表头、明细与已验证来源行，并显式初始化 `converted_quantity=0`；多 PO `sourceAllocations` 输入逐项验证且只为 `STANDARD_PURCHASE` 写来源行；转换模块不创建来源行；新建后可部分转换且累计量正确增长；重放不重置、不重复扣减；历史 NULL 行被拒绝且历史数据零改写；多 PO 行级来源成立，且累计容量上界**按通知 `business_type` 分别适用**（`STANDARD_PURCHASE` = 通知行 × 采购订单行 × 交期；`OUTSOURCE` = 通知行 × 委外订单剩余可收量；**不**把委外订单容量强加于普通采购）；无通知的直接 PO → 采购入库合法；容量与交期不可绕过 | HTTP + SQLite/MySQL |
| `M1C-G02` | 委外正式收货**明细**原子可达（≥1 行、非空）；来源链逐行可追；IQC 从正式明细可达并可完成 PASS/WAIVED；建待检与生效分离；失败时**业务**零副作用 + 拒绝审计恰好 1 条。`M1-P-03` 政策前置已获批；Implementation 必须创建/配置委外收货员，并由该角色以 `OUTSOURCING_RECEIVING_MANAGE` 取得正向证据，管理员不得替代该职责分离证据 | HTTP + Quality + Inventory |
| `M1C-G03` | 发料/退料/补料沿 canonical 仓位写**真实**库存、跟踪与估值；企业所有权不变；内部仓与 WIP 仓数量与流水可对账；重放不产生第二次动作；失败时**业务**零副作用 + 拒绝审计恰好 1 条 | HTTP + Inventory/Valuation snapshots |
| `M1C-G04` | 增量倒冲公式正确；材料成本来自 canonical 池分摊（**非**全局平均价）；成品经唯一 Writer 入企业仓；重复确认与并发不双扣/双收 | HTTP + Valuation snapshots |
| `M1C-G05` | 两个受影响移动工作面无 `api.get/post` TypeError；320/390/430/680 宽度交互成功；服务端 RBAC 生效；**不**含视觉体系重做 | Browser |
| `M1C-G06` | 延期财务/VMI 危险写入**服务端拒绝**（HTTP 精确 status + error code；内部服务保持既有异常传播合同），且拒绝**必须覆盖专用入口、共享 POST/MATCH 与自动开票内部调用链**：管理员与持有财务权限的主体对委外来源账单过账均在通过适用权限检查后返回 409，业务零副作用；未授权委外业务角色在读取来源前返回 403；内部服务调用同一来源级 Guard 且不得绕过；**同时**普通采购账单的创建、匹配与过账仍然合法（防误伤回归）；业务事实**零** AP/GL/凭证/分录/库存位/结算行/账单/成本证据写入 + 拒绝审计恰好 1 条 | HTTP + Finance + Inventory snapshots |
| `M1C-G07` | 生产 API 端到端（无手写 SQL 造数）；SQLite/MySQL 对等；Core 关键 mutation 的**真实 Handler** 并发：一方成功 / 另一方合规拒绝，零重复写入、零部分副作用 | HTTP + Real MySQL 8 concurrency |

**`TC-01 / M-15` 共享 Gate 前置**：`M-15` 不是独立业务 Gate，但它是依赖严格跟踪唯一性的
`M1C-G03` / `M1C-G04` / `M1C-G07` 的基础设施前置。未来获独立 Migration 授权后，Gate 取证必须包含：
PRE-A / PRE-B / PRE-C 基于真实目标数据的结果；只对明确一致身份生成允许的三类键；不明、冲突、
缺来源或撞键时停止且业务数据零改写；SQLite/MySQL 结果对等；唯一索引未建立时相关写入 fail closed。
本轮未运行 PRE、未执行规范化、未建立索引，上述 Gate 仍全部 `NOT_RUN`。

**Gate 规则**：

- 7 个 Gate 的 `execution_status` **全部为 `NOT_RUN`**；**无任何 PASS**。
- **零副作用的统一表述**：按 `MC-REQ-11` 的零副作用域，断言一律为
  "**业务**事实逐字段零变化 + 拒绝审计**恰好 1 条**"；
  **不得**表述为"审计全零"（那会与 `MC-REQ-11` 的拒绝审计义务矛盾）。
- 任一 Gate `NOT_RUN` / `FAIL`、以手工 SQL 造数替代业务可达性、或以延期能力的未裁定状态冒充通过，
  都**不得**签发对应能力的 `COVERED`。
- MySQL destructive Gate 仍**必须**使用独立 disposable 数据库并取得**逐次**明确授权；
  本轮**未运行**、**不授权**运行。
- `M1C-G07` **不强制**原 11 项 MySQL 竞态全量完成；按 Core 实际 mutation 选取必要的**真实 Handler** 竞态。
- **M1-Core 包级 Acceptance ≠ M1 全域 Closure Acceptance**；M1 全域 Closure 仍以 §31.12.9 的
  13 个 Gate 为准。

#### 31.13.6 Requirement 验收状态与 Implementation HARD STOP

- 本节状态：**`APPROVED`**。业务所有者于 2026-11-02 正式签发
  **`M1_CORE_REQUIREMENT_ACCEPTANCE_PASS`**，覆盖 `MC-REQ-01..MC-REQ-15`。
- §31.12 的 `M1_REQUIREMENT_ACCEPTANCE_PASS`（2026-10-31）**只**覆盖 §31.12 的历史文本，
  **不**自动授予本节任何 PASS，也不构成对本节的批准。
- 本节**不**签发任何 Capability 的 `COVERED`，**不**构成 Domain Acceptance / Freeze / Release Readiness；
  `PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 状态**不变**。
- **Design**：M1-Core 已批准的 Active Design 见
  [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)，
  Design ID = `M1_CORE_DESIGN_PASS`；该状态仍**不授权** Implementation。
- **本节明确未授权**：Implementation、Migration 执行、数据库连接/重置/修改、MySQL Gate 运行、
  Git push / merge / tag / release / deploy。
- 原 `G-1..G-5` 与 §31.12.2 登记的 `M1-N01/N03/N04/N11` 保持开放；
  其中被 §31.13 承接的子项**以 §31.13.5 的 Gate 为关闭依据**，未承接的保持开放。

---

### 31.14 Package A1 SAFE_CLOSE 与 VMI 最小闭环 Requirement（2026-11-07；待验收）

**授权与状态**：业务所有者在本轮任务说明 §1 明确决定 `AUD-FE-001`、`AUD-PRC-001`、`AUD-OUT-001` 的有界 `SAFE_CLOSE` 意图及 VMI 最小范围，并授权连续起草 Requirement → Design。此节是待业务所有者验收的 Requirement 增补，**不授权 Implementation**。其范围仅限下列 A1、VMI-01..05；其余 PRC/OUT 能力、`SCP-01..10/12..15` 不变。决策索引为 `OPEN-BUSINESS-DECISIONS.md` §4.1。

#### 31.14.1 A1 寻源危险写入

- `AUD-FE-001`：寻源定价页不得保留以 `PR-DEMO-001`、`product-001` 或固定数量调用正式写 API 的演示操作；移除「模拟寻源分配」及其可调用写入函数。现有合法 Source List、Quota、定价查询和独立获批功能保持可用；不借此新增 Preview API。
- `AUD-PRC-001`：`POST /api/procurement/sourcing-decisions` 由服务端对通过适用身份和权限检查的所有角色（含管理员）稳定返回 409 业务拒绝；未授权者仍遵循既有 403 门禁。拒绝时 `sourcing_decisions`、`sourcing_decision_allocations`、PR/PO、库存、采购与财务事实逐字段零变化，按现有拒绝审计合同恰好一次记录，不重复审计。不得以假 PR 来源、临时正式状态机或仅隐藏前端控件替代关闭。`AUD-PRC-002` Hash 单独保留。

#### 31.14.2 委外 WIP 数量归属与延期边界

M1-Core §7.5 对 `M1C-G03/G06` 的首期合同保留**数量归属守恒**、拒绝跨订单/跨期成本携带。仅在 Supplier WIP 订单归属变更、源减目标增、总量守恒且物理位置不变时，属于逻辑数量转移，**不要求虚构 canonical Inventory movement**。改变真实仓位时才属于物理转移，必须由 canonical Inventory 写者证明来源、身份、数量守恒；成本携带属于 `B-P01` 延期。现有 `createWipTransfer()` 的合同核验不得以缺少物理 movement 为唯一缺陷，也不得为 `SAFE_CLOSE` 禁用已批准的合法数量转移。身份余额不明、历史 WIP 不可证明、成本语义不可证明、数量越界或并发冲突须 fail closed、业务零副作用与拒绝审计；真实缺陷与 Gate 影响以专项审计 §12 的逐项证据追踪，不改写既有 7/7 PASS。

#### 31.14.3 VMI-01..05 当前产品范围

| Capability | 当前有界目标与验收义务 |
|---|---|
| VMI-01 | 最小 Agreement：supplier、warehouse、product、生效起止日、active/inactive。业务日期内唯一有效绑定；VMI 供应商资格**尚无已批准专属依据**，必须由 Owner 裁定，不能等同委外资格或假设新字段。 |
| VMI-02 | Receipt Draft → Confirm；创建与确认都须复核真实 Agreement 的 supplier/warehouse/product/日期，零个或多个有效候选均拒绝；确认仅通过 canonical `applyInventoryMutation()` 写 `SUPPLIER` owner 位置，来源可追溯，重复确认不双收入库，创建及确认具备业务幂等。 |
| VMI-03 | 只从已确认 Receipt 发起 Consumption；复核 Agreement 与身份、累计消耗不超过该 Receipt 可用量，Supplier-owned 位置足额；库存扣减、Consumption 事实及审计原子完成，并发不超额。相同 Idempotency-Key + 相同 payload 精确重放，异 payload 409；失败无半完成事实。 |
| VMI-04 | 只读数量汇总 Received、Consumed、Remaining Supplier-owned；`Remaining = Received − Consumed` 应与已确认 canonical 库存事实及合法退回/调整对账；不显示已结算数量、金额、物权转移金额或自动应付。 |
| VMI-05 | 物权转移、结算、Supplier Bill Handoff 延期；`POST /api/procurement/vmi/ownership-transfers` 保持 409 `VMI_SETTLEMENT_POLICY_PENDING`，库存、物权、结算单、账单、AP/GL 均零变化。`D-P01/D-P02` 继续 `PENDING`。 |

`SCP-11` 原「五项全部延期」提案仅在上述决定范围内被**部分取代**，不是整体批准，也不把 VMI-05 宣称 `COVERED`。§31.8 A 的旧完整闭环目标在 VMI-04 结算窗口与 VMI-05 上由本节有界取代；历史正文与批准事实保留。VMI 的供应商所有权不变量保持：企业仓内 `SUPPLIER` owner 的货物不得计入企业所有权；Receipt 与 Consumption 分别记录，不用 `CONSUMED` Receipt 状态表示消耗。`M1-F-07/M1-F-11` 风险仍受延期结算边界约束。B3101/B3121 仍 `BLOCKED`，无 Capability Closure、Domain Acceptance 或 Freeze。

---

### 31.15 委外核心执行工作面有界 Requirement（2026-11-10；`FROZEN`）
> **用途 / Owner / 状态 / 权威关系**：本节只补充已批准 §31.13 的委外核心执行工作面和订单状态安全门禁，Owner 为 Procurement & Outsourcing Domain Owner，生命周期状态为 `FROZEN`。`document.md` 是全局导航，§31.13 仍是已批准首期业务合同。输入证据为 `docs/audits/b3121-outsourcing-core-workbench-audit-20261110.md` §2–§4、B3121 §22.21/§31.3.3 和用户本轮范围、岗位、字段及状态判定。
> **批准与冻结记录（2026-11-10）**：业务所有者在本次对话中先明确要求「解决这些矛盾，最终目标是要登记委外这个模块的 acceptance 验收」，并在实现与验收完成后进一步确认「委外这一阶段已经完成验收」，要求继续登记最后的合同批准、冻结产物与委外工作面 Acceptance。据此批准并冻结本节 `OUT-WB-REQ-01..08`，签发 `OUTSOURCING_WORKBENCH_ACCEPTANCE_PASS_FROZEN`。该来源为**对话中的 Owner 决策记录**；**不存在**虚构的手写签名、电子签章或外部审批单。本冻结只覆盖委外核心执行工作面，不扩展到 §31.13 之外的能力，也不构成 B3121 Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、Release 或 Deploy。

#### 31.15.1 范围、角色与继承边界

本轮目标是让已批准的委外核心链由真实岗位在同一移动端 Web 产品中完成：订单/计划来源 → 合格供应商与 OUTSOURCE BOM → 用料清单快照 → 加工费 PO → 发/补/退料及 WIP 位置 → 完工通知 → 待检收货 → canonical IQC 或明确免检 → 收货生效、增量倒冲与成品入库 → 执行/材料查询 → 完工与关闭。各步必须消费现有权威 Writer，保留订单、PO、通知、收货明细、材料身份和库存/估值来源关系；UI 不得直接写库存、WIP 余额、成本或 IQC 结论。

委外业务员负责订单、BOM/材料、加工费 PO 的既有许可动作；**委外收货员**负责 OUTSOURCE 完工通知的创建/确认以及待检收货录入和既有许可的收货生效；**IQC 人员**仍独立检验。通知的岗位决定只适用于 OUTSOURCE 来源，不能授予委外收货员通用 `RECEIPT_NOTICE_MANAGE`，不能使其创建、查看或确认 `STANDARD_PURCHASE` 通知。收货员只可读订单号、供应商、产品、数量、加工费 PO、通知/收货状态及完成收货所必需的仓库/行来源字段；**材料成本、Supplier WIP 身份明细和其他订单敏感投影不得返回给该岗位**。后端按真实来源和权限 fail closed；隐藏按钮不构成授权。

§31.13 的所有 Inventory、Tracking、Valuation、Quality、Finance、Accounting、事务、幂等、审计与延期不变量继续有效。本轮不开放跨期 WIP 成本携带、复杂倒冲差异审核生效、部分期初、委外来源账单正式 AP/GL 过账或委外成品退货；这些保留原拒绝边界和后续 Owner 决策。UI 不得用“已完成”描述仍受 409 拒绝的能力，B3121 全手册不因本节而关闭。

#### 31.15.2 可验收业务要求

| ID | Requirement / 可观察验收条件 | 对应 Gap |
|---|---|---|
| `OUT-WB-REQ-01` | 委外入口按角色展示同一 Route 下的任务列表、详情、操作步骤和下一步；订单、通知、待检收货和相关检验的详情能通过 URL 直接进入，刷新、Back/Forward 后恢复业务身份和状态；320/390/430/680 CSS px 的核心任务不依赖整页永久横向滚动。 | OUT-WB-01/05 |
| `OUT-WB-REQ-02` | 新建/处理订单必须提供可搜索的合法供应商、产品、有效 OUTSOURCE BOM、计划来源、仓库及加工费 PO 选择上下文，显示适用状态与不可选原因；不得要求现场人员记忆原始数据库 ID。保存时后端仍按业务日期、资格、BOM 版本、来源和数量重新校验，UI 预选不替代权威复核。 | OUT-WB-01/05 |
| `OUT-WB-REQ-03` | 业务员可在权限范围内对订单执行用料清单快照、加工费 PO、发料、补料、退料、合法倒冲/复核，查看企业所有权、WIP 保管位置、可操作数量及 LOT/SERIAL 来源；一切写入复用 §31.13 已批准 Writer，失败显示可纠正原因且不丢失已输入内容。只读报表须明确区分待检与已生效口径。 | OUT-WB-01/05 |
| `OUT-WB-REQ-04` | 委外收货员可在来源固定为 `OUTSOURCE` 的范围内创建、读取、确认完工通知，并从该通知创建有正式行来源的待检收货；通知本身不改变库存/估值/AP。服务端必须限制其读取投影与写入来源，拒绝对普通采购通知和其他委外业务写入的越权访问。既有通用通知管理者的合法普通采购路径维持。 | OUT-WB-02 |
| `OUT-WB-REQ-05` | 待检委外收货可从工作面进入 canonical IQC；IQC 人员可看真实委外收货来源、完成合格/不合格判定并返回委外来源；免检仅依据已生效质量政策。收货员只能在质量门禁通过、PO/通知/明细/容量/材料身份可证明时执行既有收货生效动作。待检、拒收、失败或缺证据均不形成成品库存事实。 | OUT-WB-04 |
| `OUT-WB-REQ-06` | 订单生命周期请求必须明确目标动作并与当前状态相符；服务端在同一事务中重读订单和相关权威事实。`RELEASED→COMPLETED` 仅在**已生效收货净量达到订单数量**且来源可证明时允许；待检、取消或未生效收货不计入。不得提前推进以掩盖待检或不足。 | OUT-WB-03 |
| `OUT-WB-REQ-07` | `COMPLETED→CLOSED` 仅在无待检收货、无未处理的委外材料 WIP 余量、无仍可转换的未结完工通知且来源/身份余额可证明时允许；合法材料余量须经原批准的退料、倒冲或有界数量归属转移处理。延期的 AP/GL、跨期成本和复杂差异不得被伪造为已结清，也不得作为本轮关闭的必需前提。既有错误状态/历史不可证明订单 fail closed，不做 GET 自动修复。 | OUT-WB-03 |
| `OUT-WB-REQ-08` | 订单流转、通知、材料、收货及质量跨域动作须保持已有职责分离、交易原子性、幂等/重放边界、成功与拒绝审计；状态陈旧、来源不符、容量不足、未知身份或未授权时返回稳定可识别错误，业务事实零部分写入。拒绝审计按 §31.13 `MC-REQ-11`，不得把业务零副作用误写为审计全零。 | OUT-WB-01..05 |

`OUT-WB-REQ-07/08` 的材料终态约束：`COMPLETED` 后只允许对本订单真实未耗用 WIP 做有来源、身份和数量校验的退料，以便清零并关闭；新发料、新补料及新收货继续只在 `RELEASED` 发生。`CLOSED` 后所有材料发/补/退/倒冲及 WIP 归属转移均须由后端拒绝，业务事实零变化。该限定是用户“无未处理材料余量才关闭”决策的必要可执行边界，不开放已延期差异处理。

`OUT-WB-REQ-02/06` 还继承已批准 `MC-REQ-03`：委外用料快照须在订单草稿确认计划时已经形成且来源 BOM 在业务日期有效；未形成或历史不可证明时不得下达。已确认计划/已下达后的首次快照或重建均拒绝，Release 后 master BOM 改动不得改写已存快照。委外供应商资格须按订单业务日期和有效起止日判断，不能仅按系统当前日判断。

#### 31.15.3 Acceptance 边界与阶段状态

本节候选验收应以生产 HTTP 的分岗正反例、真实来源/状态/数量断言、SQLite/MySQL 双路径、并发失败方零副作用、focused + full + heavy 适用 Gate、浏览器 direct URL/刷新/Back/Forward 和四档宽度验证。必须证明收货员无法使用普通采购通知与宽订单详情，质检/收货生效仍分岗，订单无法提前完工/关闭；延期接口继续 409 且零业务副作用。测试通过、实现代理自报 PASS 均不替代用户最终 Acceptance。

本节当前状态为 `FROZEN`，且**已实施并通过有界验收**：实现证据、验收边界与未重跑真实 MySQL 的限制见 [`docs/acceptance/outsourcing-workbench-acceptance-20261110.md`](../acceptance/outsourcing-workbench-acceptance-20261110.md) 与 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §45.34。验收范围**仅**限本节 `OUT-WB-REQ-01..08` 的委外核心执行工作面；§31.13 的既有批准与验收事实不被撤销，`docs/status/CAPABILITY_MATRIX.md` 的 B3121 `BLOCKED` 不变。本节的有界工作面冻结**不等于** B3121 Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、Release 或 Deploy。

---

### 31.16 完整 Active Contract 域级交付整改 Requirement（2026-11-10；`APPROVED` → `IMPLEMENTED`）

> **用途 / Owner / 状态 / 权威关系**：本节把 2026-11-10 对当前 HEAD 的复核结论转化为 Procurement & Outsourcing 完整 Active Contract 的域级交付整改要求。Owner 为 Procurement & Outsourcing Domain Owner；生命周期状态为 `IMPLEMENTED`（已按批准合同实施，**尚未通过域级 Acceptance**）；`document.md` 仅承担导航，本节是 §31 的当前候选增补。它不取代 §31.1～§31.15 的已批准或已冻结正文，只收敛其中与 AUD-PRC-004/005/006 及域级验收有关的冲突。
> **授权来源与范围选择**：业务所有者在本次对话中确认三项 `SEMANTIC_MISMATCH`，授权自行判断解决，并明确要求域级交付采用**完整 Active Contract**。因此不采用 `SCP-01..15` 的范围裁剪建议：PRC-18 保留 `ADD / MODIFY / CANCEL`，PRC-08 与 PRC-19 保持核心正确性要求；既有明确批准的延期、fail-closed 和有界冻结仍属于 Active Contract，不被本节伪造为已经实施。
> **批准与实施记录（2026-11-10）**：业务所有者在本轮对话中明确批准本节 Requirement 与对应 Design §26.36，并授权进入 Implementation。实施按 §26.36 的 I1～I4 拆分完成，证据见 `docs/status/PROJECT_STATUS.md` §46 与 `log/2026-11-10.md`。`IMPLEMENTED` 只表示合同已按批准设计实现并通过本地 Gate，**不表示域级 Acceptance、Capability Freeze、Manual Closure、Release 或 Deploy**；真实 MySQL Gate 尚未在本轮重跑，该限制随域级验收候选一并登记。

#### 31.16.1 当前缺口与目标状态

| ID | 当前 Coverage | 交付目标 |
|---|---|---|
| `AUD-PRC-004` / PRC-07/08 | `SEMANTIC_MISMATCH` | 采购价格按**计价单位数量**计算，完整接入采购订单商业快照；金额、折扣和舍入可重演。 |
| `AUD-PRC-005` / PRC-18 | `SEMANTIC_MISMATCH` | 正式 PO Change 保存真实变更前后快照，安全应用 ADD/MODIFY/CANCEL，数量、单价、行金额与表头总额原子一致。 |
| `AUD-PRC-006` / PRC-19 | `SEMANTIC_MISMATCH` | MRP、计划工作台、采购来源预留和收货共用唯一 canonical PO open remaining；加工费 PO 不进入 BUY supply。 |
| Procurement & Outsourcing Domain | `PARTIAL` | 对 §31 当前 Active Contract 逐项取证；所有未延期能力闭环，延期能力保持已批准 fail-closed；完成域级 Acceptance 候选，不以子包 PASS 冒充 Domain PASS。 |

#### 31.16.2 可验收业务要求

| ID | Requirement / 可观察验收条件 |
|---|---|
| `PRC-DLV-01` | 价格条目中的 `unit_price_cents` 始终表示“每一个 `pricing_uom_code` 的安全整数分单价”。订单输入的 document UOM 数量必须经现有 canonical UOM 有理数换算为 pricing UOM 数量后再计算金额；禁止用 base UOM 数量直接乘 pricing UOM 单价。金额使用统一 `HALF_UP_CENT_V1`，分数换算不得先转浮点。 |
| `PRC-DLV-02` | 普通采购订单的所有生产创建路径（手工、请购/采购指令转换、批量转换及其它已登记 canonical caller）必须调用同一采购价格解析原语，冻结价格条目/版本、业务日期、document/base/pricing UOM 换算、折扣及舍入证据。无有效价格或换算时 fail closed；合法赠品为零价；不得由请求端仅传 `unitPriceCents` 绕过。已批准历史 PO 不因价格版本变化被重算。 |
| `PRC-DLV-03` | 折扣只在明确的计价金额基数上计算；百分比和固定额都必须产出可重演证据。行金额、折扣后金额和订单总额都为安全整数分；总额等于有效行金额之和。必须覆盖 Pricing UOM = Document UOM、Pricing UOM ≠ Document UOM、分数换算、边界舍入、折扣和价格历史。 |
| `PRC-DLV-04` | PO Change 是正式业务单据，保留 `ADD / MODIFY / CANCEL`。创建时由服务端读取真实 PO 表头、明细、执行量、版本与商业快照，形成不可变 before/requested；不得把请求 payload 复制成 original。批准者不得与申请者相同，权限必须后端 fail closed。 |
| `PRC-DLV-05` | 应用 PO Change 必须在单事务中锁定并重读订单、目标行、交货计划、通知/收货执行量和当前版本；陈旧版本、重复应用、状态变化或来源不符均稳定拒绝。成功时原子形成 after/applied 快照、版本和审计；相同业务幂等键与相同指令精确重放，异指令冲突。 |
| `PRC-DLV-06` | `MODIFY` 原子更新当前有效数量、计价证据、单价、行金额及表头总额；新数量不得低于已确认收货或其它已冻结执行承诺。`ADD` 创建完整来源/UOM/价格快照并重新计算总额。历史 receipt/bill/AP 不回写、不追溯重算。 |
| `PRC-DLV-07` | `CANCEL` 必须显式区分整单与行级目标。整单取消只允许所有行均无已确认收货、有效通知、有效预留或其它不可逆下游事实；行级取消只关闭未执行余量并保留已执行事实。部分执行或历史不可证明时 fail closed，不得用整单状态更新掩盖行级义务。 |
| `PRC-DLV-08` | canonical PO execution 以订单行作为最小身份，输出 ordered、cancelled、notified、received、returned、reserved、open remaining 与状态。普通采购的 `open remaining` 不因采购退货自动重新打开；只有独立、可追溯且获批准的补货义务才能形成新 supply。结果不得为负。 |
| `PRC-DLV-09` | 只有 `STANDARD_PURCHASE` 可形成 BUY supply；`OUTSOURCE_PROCESSING` 仅是加工费商业单据，不得进入普通采购 MRP、计划工作台或采购来源预留容量。MRP、工作台、预留、收货和执行 API 必须消费同一 canonical service，不得保留第二套数量 SQL 口径。 |
| `PRC-DLV-10` | Planning 跨域变更只允许替换 PO supply adapter，不改变已冻结需求、BOM 展开、制造供给和计划状态机语义。迁移后相同 PO 在 MRP、工作台、预留和收货的可执行余量一致；并发预留/收货/变更只能有符合版本与容量的一方成功。 |
| `PRC-DLV-11` | 前端必须提供可完成的定价维护/取价证据、PO Change 列表/申请/审批/应用和执行余量详情；Route 仍以 `applicationRegistry.js` 为唯一来源，direct URL、刷新、Back/Forward 和权限曝光一致。320/390/430/680 CSS px 核心任务不得依赖整页横向滚动。 |
| `PRC-DLV-12` | 域级交付必须逐项复核 PRC-01..26、VMI-01..05、OUT-01..23。已批准延期能力以“稳定服务端拒绝、零业务副作用、边界可见且有回归证据”验收，不得伪称已实现；未延期能力必须有真实 UI/API/来源/状态/RBAC/事务/审计/SQLite/MySQL 证据。AUD-PRC-007/008/009、AUD-VMI-001/002/003 及 B3121 未闭合项必须按 Active Contract 关闭或证明其已批准延期边界。 |

#### 31.16.3 域级 Acceptance Gate

域级 Acceptance 候选至少同时满足：

1. `PRC-DLV-01..12` 全部有生产调用链与正反例证据；三项 P0 不再是 `SEMANTIC_MISMATCH`。
2. PRC/VMI/OUT capability matrix 逐项定位 Requirement、Design、实现、测试和明确延期，不凭文件存在宣称 `COVERED`。
3. focused、`pnpm test`、`pnpm build`、`git diff --check` 全部通过；高风险库存/计划/金额/数据库路径追加 HEAVY 与受保护 disposable MySQL integration/concurrency Gate。
4. 采购与委外的浏览器闭环在四档宽度由真实岗位完成；权限、职责分离、重复提交、并发、回退和失败零副作用均被验证。
5. 文档 current/migration 两种一致性检查分别执行并如实登记；既有 N7 历史债务不得冒充本轮 PASS，也不得通过弱化检查器关闭。
6. Implementation Agent 的 PASS 只形成验收候选；最终 Domain Acceptance、Capability Freeze 和 Manual Closure 仍须业务所有者明确确认。

本节完成 Requirement 起草后进入连续授权的 Design 阶段；当前 `IMPLEMENTED` 不授权 Schema/Migration 在真实环境的执行、数据库写入、MySQL destructive Gate、Git push/merge/tag、发布或部署——这些仍需逐次明确批准。域级 Acceptance 候选见 `docs/status/PROJECT_STATUS.md` §46。
---

### 31.17 域级交付整改的委托裁定与补充合同（2026-11-10；`APPROVED` → `IMPLEMENTED`）

> **用途 / Owner / 状态 / 权威关系**：本节记录业务所有者在 2026-11-10 对「完成采购与委外业务域验收」的一次整体授权，以及在该授权下由 Agent 逐项作出的**受托裁定**，并把这些裁定写成可验收的补充合同。Owner 为 Procurement & Outsourcing Domain Owner；生命周期状态为 `IMPLEMENTED`；`document.md` 只承担导航。本节是 §31.16 的补充，不取代 §31.1～§31.16 的任何正文。
> **授权来源**：业务所有者在同一轮对话中指示「批准授权你做所有这些修复，最终达到域级 Acceptance、Capability Freeze」。该授权包含为闭合 §31.16 `PRC-DLV-12` 点名缺口（`AUD-PRC-007/008/009`、`AUD-VMI-001/002/003`）所需的 Requirement 补充、Design 补充、实现、Gate 与验收包准备；**不包含**业务所有者本人对最终域级 Acceptance 与 Capability Freeze 的签字，该签字仍须在证据包呈现后单独给出（AGENTS.md §4.5）。

#### 31.17.1 受托裁定

| # | 缺口 | 受托裁定 | 依据 |
|---|---|---|---|
| 1 | `AUD-VMI-001` VMI 资格语义 | **VMI 协议本身即 VMI 专属业务事实**；供应商须在业务日期具备**采购侧**资质（`procurement_enabled` + `QUALIFIED` + 有效区间），**不等同委外资质**，也不新增资格字段（Design §26.34.6.3 明确排除 `vmi_enabled`）。同一 supplier+warehouse+product 的协议有效期不得重叠，重叠由事务内区间检测证明。 | Requirement §31.14.3「VMI 资格无已批准专属依据」「不能等同委外资格」；Design §26.34.6.1/§26.34.6.3 |
| 2 | `AUD-VMI-002` 协议绑定 | VMI 收货创建与确认**都必须**按业务日期解析**恰好一个**有效协议并写入 `agreement_id`；0 个 / 多个 / 失效 / 不匹配一律 409；显式 `agreementId` 必须与唯一候选一致；历史 `agreement_id IS NULL` 的收货不得确认、不得消耗（`VMI_AGREEMENT_UNVERIFIED`），不推定绑定、不回填。 | Design §26.34.6.2 |
| 3 | `AUD-VMI-003` 消耗幂等与容量 | 收货创建、收货确认与消耗都必须提供**外部幂等键**；同键同载荷精确重放、异载荷 409。消耗必须同时满足两个不变量：本收货剩余容量 `receipt.quantity − 已确认消耗` 与 canonical SUPPLIER 位置足额；不得以同供应商/产品的其他收货库存替代。 | Design §26.34.6.2/§26.34.6.3 |
| 4 | `AUD-VMI-004` 汇总口径 | VMI 汇总只暴露**未调整毛余额** `Received − Consumed`、canonical 供应商物权余额与两者差额；**不得**暴露 `pendingSettlement`、`transferred` 或任何结算金额/自动应付。无法证明的调节差额以显式 `UNRECONCILED` 呈现，不得被吸收。 | Requirement §31.13 `D-REQ-01`；Design §26.34.6.3 |
| 5 | `AUD-PRC-002` 寻源决策哈希 | **关闭为登记事项**：正式寻源决策写入口已按 §31.14.1 `AUD-PRC-001` 稳定 409 关闭，仓库中不再存在活动写入路径，`sha256:${hashInput.length}` 式伪哈希已无触发面。**重开写入口前必须先实现真 SHA-256**，本裁定不构成重开授权。 | 审计台账 `AUD-PRC-002`「先裁定正式写入口」 |
| 6 | `AUD-PRC-007` 退货申请闭环 | 退货申请是**业务意图层**，必须携带明细（来源入库行 + 数量）、`requestType`、`reasonCode`/`reasonText`、`replenishmentMethod` 与业务日期；不得再接受只有表头的申请。状态沿用既有表 CHECK 的词表：`DRAFT` 草稿 → `CONVERTED` 已转换为正式采购退货（对应 Design §26.14 的 `POSTED`）/ `REJECTED` 已关闭未转换（对应 `CANCELLED`）。转换通过 canonical 采购退货草稿写入器完成，`purchase_returns.return_request_id` 回链。未入库货物没有来源行，因此不得制造 inventory return。 | Requirement §31.3.1 PRC-24；Design §26.14 |
| 7 | `AUD-PRC-009` 采购到货及时率口径 | **及时率** = 承诺交期当天或之前已确认收货的数量 ÷ 订单数量；**完成比**是另一件事，必须以 `fulfilmentRate` 单独暴露，二者不得共用同一字段或同一名称。 | 审计台账「报表指标合同需业务所有者批准」 |
| 8 | `AUD-PRC-002` 之外新增的采购侧门槛 | 普通采购订单创建时，供应商必须在**订单业务日期**具备有效采购资质，否则 409 `PURCHASE_SUPPLIER_NOT_QUALIFIED`；采购收货必须引用 `STANDARD_PURCHASE` 订单，加工费采购订单 409 `PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE`；赠品行永不携带商业价格（价格表不被查阅），且存在有效价格条目时也不得变成定价行。 | Design §26.3 / §26.7 / §26.12；Requirement §31.3.1 PRC-15/PRC-22 |
| 9 | PRC-03 单据落位 | 采购订单记录 `buyer_id` / `purchasing_group_id`。**显式指定**时服务端校验：采购员有效、采购组有效、采购员确属该组，否则 409；未指定时取创建人自己的有效成员关系；创建人没有成员关系时**不落位**，但绝不臆造一个不存在的采购员。 | Requirement §31.3.1 PRC-03 |
| 10 | `OUT-08` BOM 选择 | 委外订单绑定的 BOM 必须是 canonical 工程解析器在**该产品、业务日期、`purpose=OUTSOURCE`** 下认可的 BOM；建单时校验一次，用料快照时再校验一次。任一次不可证即 fail closed。系统不得以“第一条 ACTIVE 行”隐式选主。 | Requirement §31.3.3 OUT-08；Design §26.17 |

#### 31.17.2 可验收条件

| ID | 验收条件 |
|---|---|
| `PRC-DLV-13` | VMI-01..05 的正例与反例全部有可执行测试：协议资格（采购侧基准）、协议区间重叠、收货绑定与幂等重放、消耗容量双不变量、汇总口径不含物权/结算字段、结算写入口稳定 409 且零副作用。 |
| `PRC-DLV-14` | 采购订单创建受供应商资质门禁保护；采购收货受订单类型门禁保护；赠品行在存在价格条目时仍为零价；既有供应商画像与收货夹具的表达方式随之更新且被测业务合同语义不变。 |
| `PRC-DLV-15` | 退货申请必须带明细与业务字段；申请本身不产生库存退货事实；转换后形成真实采购退货草稿并回链；重复转换不重复生成；已转换的申请不得再取消。 |
| `PRC-DLV-16` | 采购执行报表的及时率与完成比是两个字段、两个口径，且有可执行断言。 |

#### 31.17.3 未发生事项

本节不新增 release tag、不改变 `package.json` 版本、不执行真实环境 migration、不写业务数据库、不授权 push/merge/tag/发布/部署。域级 Acceptance 与 Capability Freeze 的签字仍需业务所有者在证据包呈现后单独给出。---

### 31.18 域级交付整改第三轮：参数接线、业务快照与 PRC-26 范围裁定（2026-11-10；`APPROVED` → `IMPLEMENTED`）

> **用途 / Owner / 状态 / 权威关系**：本节是 §31.17 的续篇，记录业务所有者在同一轮对话中的两项追加决定：(1) **PRC-26 扫码闭环移出本域范围**；(2) 其余可实现的残余能力按本节合同实现。Owner 为 Procurement & Outsourcing Domain Owner；生命周期状态为 `IMPLEMENTED`；`document.md` 只承担导航。本节不取代 §31.1～§31.17 的任何正文。
> **授权来源**：业务所有者指示「PRC-26 扫码闭环不用做了，手机上如果要实现扫码的话应该还需要加入视觉的东西太麻烦，直接删去；剩下的东西你如果能实现都实现吧；然后批准 ACK4 清单与 RunId」。

#### 31.18.1 PRC-26 移出本域范围（业务所有者裁定）

- **裁定**：**PRC-26 的“扫码 → 收货草稿 → 确认”闭环（Design §26.15 的 `lookup-document` / `draft-receipt` / `draft-notice` 三个 API 与移动端扫码工作面）移出采购与委外域的 Active Contract 范围**，不再作为本域 Closure 的前置条件。
- **理由**：移动端扫码闭环需要视觉识别能力（相机 / 条码识别 / 标签），其产品与工程边界超出本域既有合同；为一个受限扫描闭环引入视觉子系统不符合本域的取舍。
- **保留边界（不得被读成已实现，也不得被当作缺陷）**：
  - 已有的**受限来源解析**继续保留并受测：`POST /api/procurement/scan` 只做「来源解析 + 类型隔离」，对 `OUTSOURCE_PROCESSING` 采购订单返回 409，对普通采购订单返回可解析的订单/行/数量草稿行。**它不创建收货草稿、不确认入库，LOT/SERIAL 身份不回传落库**。
  - 该端点不得被描述为“扫码入仓闭环”，UI 不得以“已完成”描述仍受该边界限制的能力。
- **未发生事项**：本裁定不删除既有的受限扫描端点与其回归测试；不新增任何视觉、相机、条码设计或标签打印能力；不把 OUT-01/OUT-02 的手工委外收货路径视为被本裁定覆盖。

#### 31.18.2 采购参数接线（PRC-01）

采购参数是**活的业务开关**，每个参数都有确定含义并被接在它所治理的业务事实上；参数变化在下一次业务动作生效，**不回写历史**：

| 参数 | 取值 | 接线位置与行为 |
|---|---|---|
| `sourceControlEnabled` | 布尔（默认开） | 请购转采购订单的供应商分组转换：所选供应商在业务日期必须存在有效 `PURCHASE` 货源，否则 409 `PURCHASE_SOURCE_REQUIRED` |
| `quotaEnabled` | 布尔（默认关） | 同一路径：该供应商在业务日期的采购配额必须存在，且本次分配数量不得超过配额比例，否则 409 `PURCHASE_QUOTA_NOT_CONFIGURED` / `PURCHASE_QUOTA_EXCEEDED` |
| `requisitionPolicy` | `OPEN` / `SOURCE_REQUIRED` | 请购单创建：`SOURCE_REQUIRED` 时必须带来源指令，否则 409 `REQUISITION_SOURCE_REQUIRED` |
| `poChangeEnabled` | 布尔（默认开） | 采购订单变更的**申请与适用**两端：关闭时 409 `PO_CHANGE_DISABLED_BY_PARAMETER` |
| `receivingTolerancePolicy` | `STRICT` / `SOFT_BAND` | 收货容量：STRICT 不得超出订单数量；SOFT_BAND 允许到交期上下容差上限 |
| `returnPolicy` | `STANDARD` / `REQUEST_REQUIRED` | 采购退货创建：`REQUEST_REQUIRED` 时必须来自已转换的退货申请，否则 409 `RETURN_REQUEST_REQUIRED` |
| `prepaymentRequiredDefault` | 布尔（默认关） | 新建采购订单的 `prepayment_required` 默认值 |
| `defaultReceiptBillingMode` | `SEPARATE` / `LEGACY_DIRECT` / `AUTO_BILL` | 采购收货的默认开票模式（既有接线） |
| `numbering` | `PERIOD_SEQ` | 采购单号按期间序号生成（唯一取值） |

#### 31.18.3 商业快照与交期区间（PRC-14 / PRC-16 / PRC-09）

- 采购订单表头新增 `settlement_supplier_id` / `payee_supplier_id`：默认结算供应商等于供货供应商、付款供应商等于结算供应商，可被显式覆盖；历史行保持 NULL 并在读取时回落到供货供应商，**不回填**。
- 采购订单行新增 `pricing_discount_scheme_id` / `discount_source`：价格来源已是 `price_entry_id`，折扣来源单独冻结；采购侧折扣**只**影响取价与订单快照，不得创建 AP 信用。
- 新增只读端点 `GET /api/purchase-orders/:id/commercial-snapshot`：返回订单当时冻结的商业事实（供应商快照、结算/付款供应商、采购员/采购组、预付款要求、行级价格与折扣来源、交期计划）。该端点**只读**：不重算、不修复历史。
- 交期计划新增 `planned_date_from` / `planned_date_to` / `sequence_no`：多次交货的 earliest/latest 区间与批次序号；区间开始晚于结束一律 400。

#### 31.18.4 可验收条件

| ID | 验收条件 |
|---|---|
| `PRC-DLV-17` | 采购参数九个开关全部接在真实业务事实上，各有正例与反例；参数变化不回写历史。 |
| `PRC-DLV-18` | 商业快照端点返回冻结事实；结算/付款供应商默认等于供货供应商；折扣来源单独冻结；交期区间与批次序号可读且非法区间被拒。 |
| `PRC-DLV-19` | PRC-26 的范围裁定被登记：受限扫描端点保留且边界可见，扫码入仓闭环明确不在本域范围。 |

### 31.19 域级交付整改第四轮：残余能力闭合与合同固化（2026-11-11；`APPROVED` → `IMPLEMENTED`）

> **用途 / Owner / 状态 / 权威关系**：本节固化 2026-11-10 域级能力复核登记的 **9 项 `PARTIAL` 与 1 项 `MISSING`**（PRC-02 / PRC-04 / PRC-12 / PRC-16 / PRC-17 / OUT-02 / OUT-03 / OUT-20 / OUT-21 / OUT-23）的业务合同。Owner 为 Procurement & Outsourcing Domain Owner；生命周期状态为 `IMPLEMENTED`——已按本节合同实施并通过本地 Gate，**尚未通过域级 Acceptance**。`document.md` 只承担导航。本节不取代 §31.1～§31.18 的任何正文；与既有条款冲突时，本节**只**在本节列明的范围内优先。
> **授权来源**：业务所有者指示「完成最后的收尾，最终目标是域级 Acceptance 和能力 Freeze」，并在第三轮中裁定「剩下的东西你如果能实现都实现吧」。§31.18 的裁定继续有效。

#### 31.19.1 残余能力清单与闭合口径

| Capability | 原判定 | 本轮闭合口径 |
|---|---|---|
| PRC-02 供应商采购档案 | `PARTIAL` | 档案**驱动**单据：付款天数在客户端未指定时取档案默认值，并把「天数 + 来源」冻结在订单上；档案后续变更不改写历史订单。供应商品类**单向**门禁委外业务（见 §31.19.2）。 |
| PRC-04 货源列表 | `PARTIAL` | 货源主数据与资格/生效期已有；本轮补齐**手工 override**：权限 + 原因 + 有界日期区间 + 恰好一条审计，且**只在区间内**放行。 |
| PRC-12 请购拆并与供应商分配 | `PARTIAL` | 分组、部分数量转换、余量保护与源行写锁已有；本轮补齐 **canonical 分配事实**（请购明细 → 采购订单明细 → 供应商 → 分配数量）与专用审计，累计分配量不得超请购数量。 |
| PRC-16 交货计划 | `PARTIAL` | 交期区间与批次序号已冻结；本轮补齐 **lower tolerance 自动关单**与关单事实（含被容忍的短交数量）。 |
| PRC-17 预付款要求 | `MISSING` | **整条能力实现**：业务意图层（采购拥有要求单据）+ Finance 交接（付款由 canonical 财务路径完成），不建第二套支付引擎。 |
| OUT-02 委外货源 | `PARTIAL` | 委外订单必须消费业务日期上有效的 **OUTSOURCE 货源**，与采购**共用**同一份货源控制实现与同一个参数开关。 |
| OUT-03 委外加工价 | `PARTIAL` | 加工费采购订单必须有可读出的价格来源：有效 OUTSOURCE 价格条目优先，否则冻结为**委外合同**来源；普通 PURCHASE 价格表不得静默替换委外价格来源。 |
| OUT-20 加工费应付 | `PARTIAL` | 加工费正式过账实现：金额确认时点、科目与税、红冲、跨域边界四项口径按 §31.19.3 固化。 |
| OUT-21 委外成本证据 | `PARTIAL` | 成本证据在**过账**时按 canonical 账单实际金额转 `FINAL`，并给出 actual 与 variance；基准金额在收货生效时确定且此后不被账单改写。 |
| OUT-23 期末 / WIP / 期初 / 报表 | `PARTIAL` | 期初委外订单可带物料行、身份与供应商 WIP 位置，期初结余进入**同一本** WIP 身份账；委外供给进入既有期间关闭读模型与财务业务关闭读模型，不新增关闭轴。 |

#### 31.19.2 PRC-02 供应商品类与付款结算默认值

- **付款天数**：采购订单的付款天数来源唯一且可追溯 —— 客户端明确给出时以客户端为准（来源 `CLIENT`），未给出时取供应商采购档案的 `default_payment_terms_days`（来源 `SUPPLIER_DEFAULT`），两者都没有时为空（来源 `NONE`）。来源与天数一起冻结在采购订单上；档案变更不改写历史订单。客户端给出的金额与天数都**不是**权威。
- **品类门禁是单向的**：供应商品类为 `OUTSOURCE` 时可以承接委外订单与委外加工费采购订单；其他品类（`GENERAL` / `STRATEGIC` / `TRANSACTIONAL`）**不得**承接委外业务，违者 409 `SUPPLIER_CATEGORY_NOT_OUTSOURCE`。
- **品类不限制普通采购订单**：普通采购由采购资质门禁（`procurement_enabled` + 业务日期上有效的采购资质）独立把关，未启用采购业务或资质无效时 409 `PURCHASE_SUPPLIER_NOT_QUALIFIED`。理由：现实业务中「既是物料供应商、又是委外加工商」是常态，把品类做成互斥开关会让这种供应商无法存在，而普通采购侧的门禁本来就完整。
- 品类快照冻结在采购订单上（`supplier_category_snapshot`），供事后追溯；品类不是客户可写字段。

#### 31.19.3 OUT-20 加工费正式过账的会计口径（`C-P01`～`C-P04`）

- **`C-P01` 金额确认时点**：加工费的**基准金额在收货生效时确认**（生效收货数量 × 已约定加工费单价），此后**不被账单改写**。账单草稿只是「待结算事实的登记」，记录供应商声称的单价，**不**冻结加工费金额、**不**写成本证据。过账时执行金额上界：账单行金额不得超过「基准金额 × 本行开票数量 ÷ 生效收货数量」，少开票（部分开票）合法，差额进入 OUT-21 的 `variance_cents`；超开票一律 409 `OUTSOURCING_PROCESSING_FEE_PRICE_MISMATCH`。
- **`C-P02` 科目与税**：过账复用 canonical 财务原语（应付、确认模式、系统凭证、期间校验），**不自写第二套算法**。借方科目**只能**来自已批准的会计档案（`outsourcing_processing_fee_accounting_profiles`）：档案缺位、未批准或角色码没有科目映射时一律 409 `OUTSOURCING_GL_PROFILE_NOT_APPROVED`，且拒绝发生在任何状态、应付、凭证与成本证据写入之前。税额沿用 canonical 行税计算模式。
- **`C-P03` 红冲**：已过账的加工费账单可按行红冲。数量守恒（累计红冲数量不得超过该行已开票数量），金额反向（反向凭证 + 反向应付调整），并写审计与幂等记录。
- **`C-P04` 跨域边界**：委外加工费**不新建第二套总账**。来源级政策守卫在**共享入口**（普通采购账单的公共通道）上继续拒绝委外来源账单；委外专属入口按 `C-P02` 档案放行。普通采购账单的行为**不受影响**。
- 委外成品在收货生效时直接按「消耗材料价值 + 加工费」入账，**没有在途物资腿**：借方不得套用普通采购的 `Dr GRNI / Cr AP`。

#### 31.19.4 OUT-21 成本证据口径

- 成本证据的**基准金额**取收货生效时确认的加工费金额，**实际金额**取 canonical 账单的实际金额，**差异** = 实际 − 基准；三者都不得手算。
- `basis_status` 由 `PROVISIONAL` 转为 `FINAL` 的条件：该收货的应付数量已被完整开票（累计已过账开票数量 + 已红冲数量 ≥ 保留加工数量）。已红冲的行必须从实际金额与开票数量中扣除。
- **不得**把 `PARTIAL` / `PROVISIONAL` 描述为已取得最终成本结论。

#### 31.19.5 OUT-23 期初委外与期间关闭接入

- 期初委外订单可携带物料行（数量、来源仓、身份）、供应商 WIP 位置与订单级信息；期初单据显式标记为期初事实，不产生历史凭证、应付或收入。
- 期初结余进入**同一本** WIP 身份账（`event_type='OPENING'`），可被后续退回、倒冲与转移消费；期初**不新建第二本 WIP 账**。
- 期初不得伪造历史身份证据：物料的身份口径按产品跟踪策略判定，不符即 409 `WIP_IDENTITY_POLICY_MISMATCH`。
- 委外供给（供应商 WIP 位置 + 委外成品库存）进入既有**期间关闭读模型**（新增 `OUTSOURCING_SUPPLY_CONSISTENCY` 检查）与**财务业务关闭读模型**（暴露委外敞口，不新增关闭轴）。委外来源**不改变**普通采购与生产的既有口径。

#### 31.19.6 PRC-17 预付款要求的职责边界

- 采购侧拥有**预付款要求单据**（业务意图层）：金额由采购订单权威金额与声明的有理比例推导（`HALF_UP`、安全整数分），**不得**由客户端决定；客户端金额只作断言，不一致即 400 `PREPAYMENT_AMOUNT_MISMATCH`；比例非法即 400 `PREPAYMENT_RATIO_INVALID`；订单不存在 404 `PREPAYMENT_PO_NOT_FOUND`，订单未批准 409 `PREPAYMENT_PO_NOT_APPROVED`。
- 状态机 `DRAFT → POSTED → CANCELLED` 单向：只有 `DRAFT` 可过账或取消；已 `POSTED` 不得再次过账（409 `PREPAYMENT_STATUS_INVALID`），也不得取消。
- **过账才产生付款**：过账把要求单交接给 canonical 财务路径，产生真实的付款事实、应付项、未核销预付余额与付款凭证；**采购侧不建第二套支付引擎**。
- 职责分离：申请人不得过账自己的申请（409 `PREPAYMENT_SELF_POST_FORBIDDEN`）；无财务付款权限的主体 403。缺结算账户 400 `PREPAYMENT_SETTLEMENT_ACCOUNT_REQUIRED`，且零副作用。
- 失败场景必须零业务副作用（无要求单、无付款单、无财务余额变化）。

#### 31.19.7 合同边界与本轮明确未发生的事项

1. **本轮不新增供应商品类之外的档案字段**，不引入资格模型的新维度；品类沿用既有枚举。
2. **本轮不改变 VMI 的结算与物权释放边界**（VMI-05 仍按 §31.13 `D-P01/D-P02` 延期）。
3. **本轮不实现 OUT-22 成品退货**；其范围排除与延期决策仍按 §31.15.1 处理。
4. **本轮不撤销 PRC-06 寻源写入口的 SAFE_CLOSE**，也不新增寻源决策写入口。
5. 本轮**改变**了 M1-Core G06 的既有断言（委外来源账单在**专用**入口由「一律 409」改为「按 `C-P02` 档案过账」，**共享**入口仍一律 409）。2026-11-07 首期包级 Acceptance 覆盖的 G06 证据在该条断言上**被本节取代**，必须随域级 Acceptance 重新确认。
6. 本轮**不**执行真实环境 migration、真实业务数据库写入、真实 MySQL Gate、发布、部署或任何远端 Git 操作。

#### 31.19.8 可验收条件

| ID | 验收条件 |
|---|---|
| `PRC-DLV-20` | 付款天数来源可读且不撒谎（`CLIENT` / `SUPPLIER_DEFAULT` / `NONE`）；档案变更不改写历史订单；委外业务受品类单向门禁，普通采购受采购资质门禁。 |
| `PRC-DLV-21` | 货源 override 具备权限、必填原因、有界区间、重叠拒绝与恰好一条审计；区间外不放行。 |
| `PRC-DLV-22` | 请购转采购订单写 canonical 分配事实与专用审计；累计分配量守恒；草稿整体改写不得删除或改写分配事实。 |
| `PRC-DLV-23` | 交货计划在累计收货达到下容差时自动关单，关单事实记录被容忍的短交数量；低于下容差不得关单且零副作用。 |
| `PRC-DLV-24` | 预付款要求具备完整状态机、金额推导、SOD、幂等、审计与零副作用；过账产生 canonical 财务事实而非第二套支付引擎。 |
| `PRC-DLV-25` | 委外订单必须消费有效 OUTSOURCE 货源，与采购共用同一实现与同一参数开关；委外与采购都不存在第二份货源规则。 |
| `PRC-DLV-26` | 加工费价格来源可读出（OUTSOURCE 价格条目或委外合同），客户端单价不一致固定拒绝，普通采购价格表不得静默替换。 |
| `PRC-DLV-27` | 加工费正式过账按 `C-P01`～`C-P04` 执行：金额上界、档案科目守卫、红冲守恒与共享入口边界；缺档案时 fail closed 且零副作用。 |
| `PRC-DLV-28` | 成本证据在过账后转 `FINAL` 并给出 actual 与 variance；未完整开票时保持 `PROVISIONAL`。 |
| `PRC-DLV-29` | 期初委外结余进入同一本 WIP 身份账且落在供应商 WIP 位置；期初不产生凭证与应付；委外供给进入期间关闭与财务业务关闭读模型且不新增关闭轴。 |
| `PRC-DLV-30` | 本节改变了 M1-Core G06 的既有断言，该取代关系被明确登记并随域级 Acceptance 重新确认。 |

### 31.20 域级交付收口补充：维护面、界面可达性与三项裁定（2026-11-11；`APPROVED` → `IMPLEMENTED`）

> **用途 / Owner / 状态 / 权威关系**：本节补齐第四轮收口时登记的三项限制与三项待裁定，并固化第四轮新增子能力的**界面可达性**要求。Owner 为 Procurement & Outsourcing Domain Owner；生命周期状态为 `IMPLEMENTED`。本节不取代 §31.1～§31.19 的任何正文。
> **授权来源**：业务所有者指示「这几个为解决矛盾需解决，解决后签发 acceptance 和 freeze」。

#### 31.20.1 OUT-20 会计档案的维护面

- 委外加工费过账的**科目只来自已批准的会计档案**（§31.19.3 `C-P02`）。档案必须**可维护**，否则过账能力没有产品内入口。
- 维护面只做三件事：**列出**、**建立**、**改变批准状态**（`APPROVED` / `SUSPENDED`）。它**不改写**既有档案的科目、税率与有效期 —— 会计政策变更就是换一套档案；历史档案与历史过账事实都不被改写。
- 建立档案的拒绝条件：范围不正确（`GLOBAL` 不得带供应商、`SUPPLIER` 必须带供应商）、供应商不存在、税务口径或批准状态取值非法、生效结束日早于起始日、**角色码没有对应的启用科目**（409 `OUTSOURCING_GL_PROFILE_ROLE_UNRESOLVED`）、同范围窗口重叠的已批准档案（409 `OUTSOURCING_GL_PROFILE_OVERLAP`）。
- 重新批准前必须**重读权威科目**：科目被停用后不得让档案复活。
- **职责分离**：维护权限是财务侧的过账权限；委外业务侧不得定义科目。
- 缺档案或档案未批准时过账**仍然 fail closed**（409 `OUTSOURCING_GL_PROFILE_NOT_APPROVED`），且拒绝发生在任何状态、应付、凭证与成本证据写入之前。

#### 31.20.2 第四轮新增子能力的界面可达性

第四轮新增的子能力（预付款要求、货源 override、交货计划关单、加工费正式过账与红冲、期初委外订单）必须有**产品内可达的工作面**，不得只存在于 API：

| 子能力 | 工作面 | 岗位与动作 |
|---|---|---|
| PRC-17 预付款要求 | 采购订单详情「预付款要求」 | 采购岗建立；财务岗过账 / 取消；申请人不得过账自己的申请 |
| PRC-04 货源 override | 寻源与定价「货源 override」 | 采购配置岗登记有界区间与原因；其他岗位只读 |
| PRC-16 交货计划关单 | 采购订单详情「交货计划」 | 收货确认触发自动关单；采购岗可显式关单；低于下容差一律拒绝 |
| OUT-20 加工费过账与红冲 | 委外加工「加工费账单」 | 财务岗过账 / 红冲；草稿只登记待结算事实 |
| OUT-23 期初委外订单 | 委外加工「新建期初委外订单」 | 委外业务岗建立期初事实 |
| OUT-20 会计档案维护 | 委外加工「加工费会计档案」 | 财务岗列出 / 建立 / 暂停 / 重新批准 |

界面不得改变业务语义：金额、状态与权限一律来自服务端；前端不自行计算权威金额，不自行判定可否过账或关单。

#### 31.20.3 三项裁定（业务所有者）

| 事项 | 裁定 | 说明 |
|---|---|---|
| 供应商品类门禁口径 | **单向门禁**：品类只门禁委外业务；普通采购由采购资质门禁把关 | 现实业务中「既是物料供应商、又是委外加工商」是常态；品类做成互斥开关会让这种供应商无法存在，而普通采购侧的门禁（采购资质 + 权威价格 + 货源控制）本来就完整。§31.19.2 的口径在本轮被确认为域级合同。 |
| M1-Core G06 被取代的断言 | **随域级 Acceptance 重新确认** | 共享入口仍一律 409（跨域边界不变），**专用**入口按 `C-P02` 档案放行。2026-11-07 首期包级 Acceptance 覆盖的 G06 证据在该条断言上被取代。 |
| G07 固定场景重新冻结 | **确认**摘要 `f112c88cb6d327f4885cf349de4a6c4efd6b4a4b1499e0547727e7103ccad33f` | 固定场景新增「建立有效 OUTSOURCE 货源」步骤；摘要链 `60f7888f…` → `aa024bd5…` → `f112c88c…`。 |

#### 31.20.4 OUT-22 成品退货的正式延期决策

- **决策 ID**：`MC-REQ-16`（与 §31.13 `MC-REQ-15` 同系列），**决定**：OUT-22 成品退货**不纳入**本域当前 Active Contract 范围；既有稳定拒绝边界（409 `OUTSOURCING_FINISHED_RETURN_NOT_APPROVED` + 零信用证据）继续有效并继续被回归固定。
- 该延期**不**授权任何成品退货写入口，也**不**授权删除既有拒绝路径与 `outsourcing_finished_returns` 表。

#### 31.20.5 可验收条件

| ID | 验收条件 |
|---|---|
| `PRC-DLV-31` | 会计档案可列出、建立、暂停与重新批准；角色码未解析、范围非法、窗口重叠固定拒绝且零副作用；重新批准前重读权威科目；维护权限属财务侧。 |
| `PRC-DLV-32` | 第四轮新增子能力在产品内可达：采购订单详情、寻源与定价、委外加工三个工作面渲染对应面板，390 CSS px 下无整页横向滚动，金额与状态一律取自服务端。 |
| `PRC-DLV-33` | 供应商品类单向门禁、M1-Core G06 被取代断言的重新确认与 G07 固定场景重新冻结三项裁定被登记。 |
| `PRC-DLV-34` | OUT-22 成品退货的正式延期决策（`MC-REQ-16`）被登记，既有稳定拒绝边界不变。 |
