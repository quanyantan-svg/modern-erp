# Sales & Customer — Domain Closure Requirement

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/requirements/sales-customer/README.md`
> 来源：`document.md` §34（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 34. Sales & Customer Domain Closure Requirement

> 本节原固化 Sales & Customer Domain Closure 的 Requirement 阶段成果；2026-10-13 因远端外部评审发现 SC01 / SC08 / SC30 及后续业务语义缺口而进行**有限 Requirement reopen**。本次只精化既有 B3102 范围，不增加 SC / Invariant / UAT / Race ID；DR-SAL-01 已由用户批准 Option A，文档层缺陷已闭合。2026-10-14 外部独立评审对 Requirement / Technical Design / Implementation Wave Plan 均返回 PASS，用户已明确批准正式 Freeze；冻结内容基线为 `5469891b78acb5b03940944698e5c51a38cf5491`。2026-10-16 DR-SAL-04 Option A 与 2026-10-17 DR-SAL-05 Option C 均已由用户接受；同日发现的 LOT/SERIAL 组合矛盾现按 R1–R4 完成有界 superseding Requirement correction，仅重开 SC55 / SC56 / SC58、UAT-S-20 / UAT-S-21 及 DR-SAL-04/05 对应条款。Option C Reverse 的最终幂等 addendum 进一步明确 client-supplied `Idempotency-Key` 为必填并关闭 Requirement owner clarification。§34 其余已冻结合同不变，本增量只进入下一独立 Design Gate，不授权 Implementation 或 Wave 6 Acceptance/Freeze。
> Manual Evidence Baseline：B3102 销售管理 + B3103 信用管理（同时遵守已 frozen 的 B3104 库存 / B3106 存货核算 / B3108–B3113 应收/应付/发票/出纳 / B3114–B3117 总账/报表/经营会计 / B3119-B3120 生产/计划 / B3121 委外 等其它 domain 的边界）。
> 本节 Coverage 以 Sales & Customer Domain Audit 在 2026-10-12 经过 Final Arithmetic & Mapping Closure 后发布的 audit 为准：
>
> ```text
>   Capabilities audited        = 36
>   COVERED                     =  9
>   PARTIAL                     =  3
>   MISSING                     = 24
>   SEMANTIC_MISMATCH           =  0
>   OUT_OF_SCOPE                =  0
>
>   Gap IDs                     = 25
>   Requirement candidates      = 24 (RC-01..RC-24)
>
>   Frozen-domain bypasses      = 0
>   Concurrency candidates      = 15 (R-SAL-01..R-SAL-15; 5 REAL + 10 DORMANT)
> ```
>
> 本节不执行 Implementation / Migration / API / UI / Test。已冻结 Technical Design 与 Implementation Wave Plan 见 `solution.md §29–§30`。
> 本节不重写已 frozen 的 Master & Engineering / Planning / Procurement & Outsourcing / Manufacturing & Quality / Inventory & Warehouse / Finance Operations 中的任何 capability 或 canonical fact。Sales & Customer 通过消费这些 frozen canonical truth 完成自身业务，不允许 second-truth / shadow ledger。
>
> 已被外部评审 PASS / FROZEN 的 audit 不在本节重开。

### 34.1 范围与 Ownership

#### 34.1.1 Sales & Customer 拥有（canonical business owner）

- **Sales Commercial Foundation（SC01–SC08）**：Sales Parameters；Customer Commercial Extensions（Settlement Party / Payer / Salesperson / Sales Group / Customer-Material Cross Reference / Commercial Defaults / Sellable Scope）；Sales / Pricing UoM 商业使用；Over-/Under-Delivery Tolerance。
- **Quotation（SC09–SC14）**：Quotation document lifecycle；validity；conversion into Sales Order；repeated-conversion policy；commercial terms snapshot；capacity tracking。
- **Sales Pricing（SC15–SC20）**：Sales Price List；Customer / Material applicability；UOM / quantity breaks；effective dates；priority / fallback；manual override (with separate authority)；immutable resolved-price snapshot at order time。**单一 base currency baseline**。
- **Order-Time Discount（SC21–SC23）**：Sales Discount scheme / table；order-line / header；automatic + manual selection + override authority；immutable snapshot at order time。**与 Finance post-delivery Sales Discount / Allowance (M14) 严格区分**。
- **Sales Order（SC24–SC36）**：header + lines + commercial parties + commercial terms snapshot + per-line snapshot（price / UoM / discount / tax-basis / gift）+ Gift Line + Delivery Schedule + Prepayment setting + Reservation intent + Status Machine + Required Fields Submission gate + Edit Policy + Source document identity。
- **Sales Order Change（SC37–SC40）**：post-approval controlled change document；change reason / before-after / line-level trace；change approval / audit / effective version；constraint invariant。
- **Sales Order Fulfillment / Close（SC41–SC44）**：remaining commercial obligation；partial fulfillment；full fulfillment / controlled close；controlled cancellation / termination。
- **Delivery Notice（SC45–SC48）**：commercial instruction document；scheduled / notified / cancelled / remaining quantity；own lifecycle (do not mutate stock)；Linkage to Sales Delivery。
- **Sales Delivery（SC49–SC53）**：commercial execution document；reservation + prepayment + credit gate consumption；OQC / Inventory canonical / Valuation / COGS / Finance recognition adapters；idempotent confirm + audit；source-line capacity enforcement。
- **Sales Return（SC54–SC58）**：three canonical commercial modes (against delivery / against original SO / bounded no-source)；commercial source distinction；capacity / inventory IN / value restore / Finance credit adjustment integration。
- **Replacement / Replenishment（SC59–SC61）**：Return + Replacement obligation；replacement fulfillment state；replacement source link (without silent original history reopen)。
- **Prepayment Gate（SC62–SC65）**：required prepayment amount / ratio；gate stage configuration；gate result + override；refund integration。
- **Reservation Intent（SC66–SC68）**：Sales-→-Planning request；state read；release intent；react to change / cancel / close / return / replacement。**Sales does not own canonical reserved quantity truth**。
- **Service Item Sales（SC69–SC71）**：service-type commercial item identity；order line + service fulfillment / confirmation；finance recognition without inventory mutation。
- **Consignment（SC72–SC77）**：consignment commercial instruction；customer / consignment location；consigned quantity + ownership-retention commercial state；settlement confirmation；consignment commercial return；consignment reporting。
- **Sales Reporting（SC78–SC81）**：execution reports；outstanding；gross profit (integrated with Inventory / Finance valuation evidence)；ranking by customer / material / salesperson / sales group。
- **Credit Foundation + Credit Parameters + Rules + Profile + Occupancy + Check + Special Approval + Recalculation + Query + Evaluation（SC82–SC107）**：B3103 Credit Management 9 capability 的完整 business ownership；Sales consumes Finance canonical AR / advance / unapplied / refund / write-off 作为 input facts，从不写第二套。

#### 34.1.2 Sales & Customer 不拥有（仅 consume frozen domain canonical）

- Customer 身份 foundation → **Master & Engineering**（identity）；
- Product / Material identity 与 UOM foundation / UoM conversion 物理定义 → **Master & Engineering**；
- Warehouse identity / layout → **Master & Engineering**；
- Physical inventory truth / on-hand / locks / LOT-SERIAL / location / ownership dimension → **Inventory & Warehouse (V21 §32)**；
- Reservation canonical truth / MRP / demand planning → **Planning (V19 §30)**；
- OQC / IQC / Quality 引擎 → **Manufacturing & Quality (V18 §29)**；
- AR / AP open-item truth → **Finance Operations (V22 §33)**；
- Advance Receipt / Unapplied Balance / Refund / Write-off / Collection / Invoice operational truth → **Finance Operations (V22 §33)**；
- Treasury → **Finance Operations (V22 §33)**；
- Voucher / GL / Period close / Financial statements / Management accounting → **Accounting & Analytics**；
- RBAC / Workflow mechanics / Audit / Notification / Numbering / generic parameter & rule infrastructure / document relation-conversion → **Platform**；
- Statutory e-invoice / 外部税务硬件集成 → **OUT_OF_SCOPE**。

#### 34.1.3 已被过往实现冻结的 Sales-owned 边界

- `sales_orders` / `sales_order_items` / `sales_deliveries` / `sales_delivery_items` / `return_orders` / `return_order_items` 的商业 schema 与 status 语义属于这一 baseline；
- M14 Sales Discount / Allowance post-delivery operational finance adjustment 的 commercial authoring 由 Sales owns (route `sales-discounts`)；其 finance 经济效果委托至 Finance canonical adapter（`applyCreditAdjustment` + `generateVoucher`）；customer settlement / credit-adjustment balance constraint 由 Finance 拥有，**不属于 B3103 Credit Management**；
- Sales Order Header 上已 frozen 的 ship-to / requested-delivery-date / payment-terms submission gate；
- 已 covered 的：canonical OQC gate、Inventory physical mutation、Finance recognition adapter、idempotent confirm、source-line remaining enforcement。

### 34.2 Capability Catalogue（final）

```text
Total capabilities                  = 114
DOMAIN_OWNED                       = 100
INTEGRATION_BACKED                 =   3
EXISTING_REUSE                     =  11
OUT_OF_SCOPE                       =   0

Sum check: 100 + 3 + 11 + 0 = 114  ✓
```

#### 34.2.1 Scope Status Semantics（统一）

```text
DOMAIN_OWNED        = new or materially-extended Sales business semantics owned by this Domain
EXISTING_REUSE       = already implemented and verified in current repository,
                       preserved without semantic redesign
INTEGRATION_BACKED   = authoritative behavior supplied by a frozen Domain or
                       Platform mechanism; Sales 商业语义仍归此 Domain,
                       仅 consume / delegate through the frozen adapter
OUT_OF_SCOPE         = explicitly excluded in this baseline
```

Integration-Backed 不转移 Sales 商业 ownership；不得后续把 Integration-Backed 升级为
Domain-Owned，或把 Domain-Owned 降级为 Integration-Backed，除非 Domain Closure 重新授权。

#### 34.2.2 3 项 INTEGRATION_BACKED capability（行为由 frozen Domain / Platform 提供）

```text
SC51  Sales Delivery Adapters (OQC + Inventory canonical + Valuation + COGS +
      Finance Recognition)                              [INTEGRATION_BACKED]
SC58  Sales Return Adapters (Inventory IN + Value Restore + Finance Credit
      Adjustment via Finance canonical)                 [INTEGRATION_BACKED]
SC71  Service Finance Recognition (no inventory OUT;
      AR / Revenue via Finance canonical adapter)        [INTEGRATION_BACKED]
```

#### 34.2.3 11 项 EXISTING_REUSE capability（已实现并验证，不 semantic redesign）

```text
SC24  Sales Order Header (commercial structure preserved)
SC25  Sales Order Lines
SC33  SO Status Machine + Approval (DRAFT / SUBMITTED / APPROVED / REJECTED;
      SOD CREATE != APPROVE)
SC34  SO Required Commercial Fields for Submission (gating at V1.3 Phase 1)
SC35  SO Edit Policy (DRAFT / REJECTED only mutable)
SC36  SO Source Document Identity (customer reference; existing field semantics)
SC49  Sales Delivery (commercial execution document)
SC52  SD Idempotent Confirm + Audit
SC53  SD Source-Line Capacity Enforcement (remaining-not-over-execution invariant)
SC54  Return against Confirmed Sales Delivery (DELIVERY_BACKED;
      preserve existing behavior)
SC79  Sales Outstanding (decision-reports sales-outstanding already implemented)
```

#### 34.2.4 100 项 DOMAIN_OWNED capability（其余 SC01..SC114）

```text
除上述 3 项 INTEGRATION_BACKED 与 11 项 EXISTING_REUSE 之外的所有 SC capability
（涵盖 SC01..SC23 / SC26..SC32 / SC37..SC48 / SC50 / SC55..SC57 / SC59..SC70 /
 SC72..SC78 / SC80..SC81 / SC82..SC107 / SC108..SC114）均为 DOMAIN_OWNED；
每条 DOMAIN_OWNED capability 的 商业语义（what it means）归 Sales & Customer；
其实现可消费 frozen Domain canonical adapter，
但不得因 consume 而降级为 INTEGRATION_BACKED。
```

Capability 不可在 Design / Implementation 阶段新增 ID；如需新增必须重开 Requirement。

### 34.3 Capability IDs（SC01..SC114）

#### 34.3.1 Sales Commercial Foundation（SC01–SC08）

```text
SC01 Sales Parameters                                                              [DOMAIN_OWNED]
SC02 Customer Commercial Extensions                                                [DOMAIN_OWNED]
SC03 Settlement Party                                                              [DOMAIN_OWNED]
SC04 Payer                                                                         [DOMAIN_OWNED]
SC05 Salesperson                                                                   [DOMAIN_OWNED]
SC06 Sales Group                                                                   [DOMAIN_OWNED]
SC07 Customer-Material Cross Reference + Sellable Scope                             [DOMAIN_OWNED]
SC08 Commercial Defaults + Sales/Pricing UoM Usage + Over-/Under-Delivery Tolerance [DOMAIN_OWNED]
```

本次有限重开对 B3102 可直接读取证据的约束如下（不以通用经验替换手册语义）：

- SC01 同时包含 Sales **系统级参数**与**单据类型级控制参数**；参数族由对应 capability 有界定义，不猜测手册未给出的截图字段名。订单变更模式固定为 `DISABLED / CONTROLLED_DIRECT / CONTROLLED_DOCUMENT / BOTH`；此外至少包含可售控制、客户物料对应启用、交货计划/数量控制、预留行为等控制语义。参数解析结果在变更申请时形成不可变 snapshot；后续参数变化不得追溯重写已批准/已应用变更。
- SC06 不仅是销售组身份，还包含销售员可属于多个销售组、一个默认组，以及后续报价、销售订单、报表携带 `sales_group_id` 后由后端执行的组数据隔离/可见性。
- SC08 三个不可拆缺维度为：客户商业默认值；销售 UoM / 计价 UoM 及其基于 Master canonical conversion 的自动换算；超交/欠交容差默认值及其进入订单交货计划快照后的执行控制。
- SC30 的 bounded baseline 为每个 Sales Order line 一条交货计划：计划日期 + 上/下容差快照。现有可读证据未证明一行多交期，不在本 Requirement 中虚构多 schedule；若未来直接手册证据要求多 schedule，必须重开 Requirement / Design。
- B3102 客户默认值包括结算方式、付款条件、销售员、价目表、折扣表；客户物料对应须由系统参数启用，且同一内部物料允许保留多个历史客户物料编码。
- SC07 将“客户物料对应”与“可销范围”分为两项独立能力：前者只翻译 customer material code/name ↔ canonical product；后者覆盖 customer–material、salesperson–material、salesperson–customer 三个维度，并支持 ALLOW / DENY、business-date 生效与后端执行。参数关闭只停用对应规则族，不得绕过 A-61 `sales_enabled` 或 RBAC。官方资料允许客户料号在适用条件下对应多个内部物料；本 Requirement 不主动收紧为全局一对一。候选多于一个时必须由用户显式选择内部物料并重新校验 effective mapping，不得静默自动解析。
- SC06 默认组合同：没有 active membership 时允许零默认但不得创建/处理 group-scoped 新单据；恰有一个 active membership 时该 membership 必须为默认；多个 active memberships 时必须恰有一个默认。默认 membership/group 停用或过期后，新业务解析 fail closed，须受控重选；历史 Quotation/SO 的 group snapshot 不变。未关联 salesperson 的登录用户同样 fail closed，只有显式跨组权限可访问，并须留审计。
- SC06 数据范围合同：`sales_group_data_scope_enabled=TRUE` 时按 login→salesperson→business-date effective membership 限制 quotation/SO/report 的读、写、审批、导出；`FALSE` 不解释为全员跨组可见，而是普通用户不得使用 group-scoped 访问，只有显式跨组权限可绕过。Wave 3/4 首次引入 Quotation/SO 时后端即须执行，Wave 12 仅做报表收敛与综合验收。
- SC08 / SC69 对缺失 A-61 分类 fail closed：历史只读可显示 `(unclassified legacy)`；任何新 quotation/SO/price/reservation/delivery write 均要求 active classification 且 `sales_enabled=TRUE`。Sales/Pricing UoM 仅可在存在 active Master canonical base UoM 时受控回退；缺失 conversion、缺失 tolerance default 或 inactive classification 均 BLOCK。缺失分类不得隐式等同于 non-service 或可售。

直接证据复核来源：金蝶开放平台《销售管理系统参数》《销售系统参数》《客户物料对应表》《业务员》《数据权限》《销售价目表》。仓库未保存可直接读取的 B3102 原始 Word，故本次以 `document.md §22` baseline 与上述官方页面交叉约束；不得据此扩展 B3102 范围。

#### 34.3.2 Quotation（SC09–SC14）

```text
SC09 Quotation Header                                                              [DOMAIN_OWNED]
SC10 Quotation Lines                                                               [DOMAIN_OWNED]
SC11 Quotation Validity Period + Expired Quotation Rejection                       [DOMAIN_OWNED]
SC12 Quotation Lifecycle + Commercial Terms Snapshot                               [DOMAIN_OWNED]
SC13 Quotation → Sales Order Conversion                                            [DOMAIN_OWNED]
SC14 Quotation Repeated-Conversion Policy + Capacity Tracking                      [DOMAIN_OWNED]
```

#### 34.3.3 Sales Pricing（SC15–SC20）

```text
SC15 Sales Price List Master (effective dates)                                    [DOMAIN_OWNED]
SC16 Price Customer / Material Applicability                                       [DOMAIN_OWNED]
SC17 Price Sales/Pricing UoM + Quantity Breaks                                     [DOMAIN_OWNED]
SC18 Price Priority + Fallback                                                     [DOMAIN_OWNED]
SC19 Manual Price Override (separate authority)                                   [DOMAIN_OWNED]
SC20 Order-Time Resolved-Price Snapshot (immutable)                                [DOMAIN_OWNED]
```

> 单 base currency baseline；multi-currency 不在本 baseline（§34.10）。
> 商业 document 形状 / 物理 storage 由 Design 决定；本节不 prescribe 表名 / 列名 / cache 选择。

#### 34.3.4 Order-Time Discount（SC21–SC23）

```text
SC21 Sales Discount Scheme / Table                                                 [DOMAIN_OWNED]
SC22 Order-Line / Header Discount (auto + manual + override authority)             [DOMAIN_OWNED]
SC23 Order-Time Discount Snapshot (immutable)                                      [DOMAIN_OWNED]
```

> 与 Finance post-delivery Sales Discount / Allowance（M14 covered）严格分离；本节 capability 仅约束 B3102 订单时折扣。

#### 34.3.5 Sales Order（SC24–SC36）

```text
SC24 Sales Order Header                                                            [EXISTING_REUSE]
SC25 Sales Order Lines                                                             [EXISTING_REUSE]
SC26 SO Commercial Parties (ship-to / settlement party / payer / salesperson /
     sales group / customer-material identity)                                   [DOMAIN_OWNED]
SC27 SO Commercial Terms Snapshot (payment terms / commercial tax-basis
     assumption / commercial defaults)                                            [DOMAIN_OWNED]
SC28 SO Per-Line Snapshot (price / UoM / discount / commercial tax-basis
     assumption / gift flag; immutable business-time assumption)                    [DOMAIN_OWNED]
SC29 SO Gift Line (selling price = 0; inventory OUT / reservation / OQC / COGS /
     source-line trace continue)                                                  [DOMAIN_OWNED]
SC30 SO Delivery Schedule (planned date + tolerance upper / lower)                 [DOMAIN_OWNED]
SC31 SO Prepayment Requirement Setting                                            [DOMAIN_OWNED]
SC32 SO Reservation Intent (Sales → Planning)                                     [DOMAIN_OWNED]
SC33 SO Status Machine + Approval (DRAFT / SUBMITTED / APPROVED / REJECTED;
     SOD CREATE != APPROVE)                                                       [EXISTING_REUSE]
SC34 SO Required Commercial Fields for Submission (gating)                        [EXISTING_REUSE]
SC35 SO Edit Policy (DRAFT / REJECTED direct mutable; APPROVED 仅可经 SC37..SC40
     批准的受控直接变更或变更单路径修改)                                           [EXISTING_REUSE]
SC36 SO Source Document Identity (customer / quotation source where applicable)    [EXISTING_REUSE]
```

> SC29 Gift Line 语义：selling price = 0；inventory OUT / reservation 消耗 / OQC / LOT-SERIAL / COGS / source-line trace 全部继续；零收入不等于零成本。
> SC27 / SC28 commercial tax-basis assumption = 商业侧 假定 snapshot（tax code / tax rate / tax-inclusive vs tax-exclusive）；statutory / invoice final tax truth 仍归 Finance Operations canonical；商业 storage 形状由 Design 决定。

#### 34.3.6 Sales Order Change（SC37–SC40）

```text
SC37 Sales Order Controlled Change (post-approval controlled-direct or
     formal change-document mode; both are legal per approved DR-SAL-01)           [DOMAIN_OWNED]
SC38 Change Reason + Before/After + Line-Level Trace                               [DOMAIN_OWNED]
SC39 Shared Change Approval/Application + Audit + Effective Version                 [DOMAIN_OWNED]
SC40 Change Invariant (executed / delivered / invoiced / financially-recognized
     history 不可静默改写)                                                          [DOMAIN_OWNED]
```

> DR-SAL-01 Option A 已批准。四模式合同：`DISABLED` 禁止 APPROVED SO 变更；`CONTROLLED_DIRECT` 仅允许从 SO 上发起受控直接路径；`CONTROLLED_DOCUMENT` 仅允许正式变更单；`BOTH` 允许两条路径但不合并、不降低各自 RBAC/SOD/approval gate。两条合法路径共用同一 canonical application contract，并且都只作用于尚未 executed 的剩余 obligations。受控直接变更也必须生成 append-only change evidence，记录 before/after/reason/requester/approver/application actor、参数 snapshot、effective version 与 audit，绝不是对 APPROVED row 的无版本覆盖。已 executed 数量、来源关系、库存与财务历史只能经既有 reversal/return/credit-adjustment 机制纠正。

#### 34.3.7 Sales Order Fulfillment / Close（SC41–SC44）

```text
SC41 SO Remaining Commercial Obligation (Sales 商业 read-only / projection)      [DOMAIN_OWNED]
SC42 SO Partial Fulfillment                                                       [DOMAIN_OWNED]
SC43 SO Full Fulfillment / Controlled Close                                        [DOMAIN_OWNED]
SC44 SO Controlled Cancellation / Termination                                     [DOMAIN_OWNED]
```

> SC41–SC44 仅约束商业语义；persisted state / derived projection / hybrid 由 Design 决定。冻结 Finance / Inventory period truth 不得依赖 Sales closure；closure state 是 Sales-owned projection，下游消费者 read-only integrate。

#### 34.3.8 Delivery Notice（SC45–SC48）

```text
SC45 Delivery Notice Header (commercial instruction)                                [DOMAIN_OWNED]
SC46 Delivery Notice Lines (scheduled / notified / cancelled-notified / remaining)   [DOMAIN_OWNED]
SC47 Delivery Notice Lifecycle (NOT mutate inventory)                              [DOMAIN_OWNED]
SC48 Delivery Notice ↔ Sales Delivery Linkage                                       [DOMAIN_OWNED]
```

> Delivery Notice = 可选的商业履行指令；Sales Delivery = 商业执行单据；Inventory = 物理 truth。B3102 同时允许 `SO → SD` 与 `SO → DN → SD`：两条路径必须保留真实 source-line identity，直接出库不得制造虚假 DN。Delivery Notice 与 Sales Delivery 仍不得折叠。

#### 34.3.9 Sales Delivery（SC49–SC53）

```text
SC49 Sales Delivery (commercial execution)                                          [EXISTING_REUSE]
SC50 SD Reservation + Prepayment + Credit Gate Consumption
     (gates governed by SC68 / SC65 / SC95; Sales-owned gate semantics)            [DOMAIN_OWNED]
SC51 SD OQC + Inventory Canonical + Valuation + COGS + Finance Recognition
     Adapters                                                                      [INTEGRATION_BACKED]
SC52 SD Idempotent Confirm + Audit                                                  [EXISTING_REUSE]
SC53 SD Source-Line Capacity Enforcement (remaining-not-over-execution invariant)   [EXISTING_REUSE]
```

#### 34.3.10 Sales Return（SC54–SC58）

```text
SC54 Return against Confirmed Sales Delivery (DELIVERY_BACKED;
     preserve existing behavior)                                                   [EXISTING_REUSE]
SC55 Return against Original Sales Order (SO_BACKED; without requiring Delivery;
     real warehouse acceptance + eligible positive valuation basis required)         [DOMAIN_OWNED]
SC56 No-Source Return (NO_SOURCE; bounded commercial document;
     real warehouse acceptance + eligible positive valuation basis required)         [DOMAIN_OWNED]
SC57 Return Commercial Source Distinction (DELIVERY_BACKED / SO_BACKED /
     NO_SOURCE explicit, truthful and mutually exclusive)                            [DOMAIN_OWNED]
SC58 Return Capacity + Inventory IN + canonical Value Basis + Voucher Counterpart;
     Finance Credit Adjustment only with an independent authoritative AR basis       [INTEGRATION_BACKED]
```

> 三种 Return 商业源必须显式、真实且互斥。`DELIVERY_BACKED` 保持既有 `restoreSourceValue()`、历史 COGS reversal 与合法 Finance Credit Adjustment 行为不变。`SO_BACKED` / `NO_SOURCE` 在没有可恢复的原始 Sales Delivery outbound valuation evidence 时，只有实际收货已合法验收、物料/仓库/LOT/SERIAL 身份匹配，且全部既有期间、权限、审核与业务日期控制满足，才可确认经济效果。
>
> `SO_BACKED` / `NO_SOURCE` 的确定性估值必须按 valuation/tracking method 分开解析。`MOVING_AVERAGE` 沿用已验证的同物料/仓库正数权威池分配语义；`LOT` Confirm 可使用与实际收货物料、仓库、LOT 精确匹配的正数 carrying-value pool，并把本次 Return 的数量、价值作为独立、可追溯的正向 movement 加入该共享 LOT 池；`SERIAL` 不得再要求或使用“同 serial 仍为正数的在库池”作为 Return 估值来源，而必须确定性引用该 serial 的权威原始 outbound valuation evidence。SERIAL 原 outbound 必须与本次 eligible Return 的产品、身份、数量 1、价值及 reversal history 一致，serial Confirm 前处于合法 returned-from-outbound lifecycle 且不得已作为 active in-stock unit 存在；缺失、歧义、过期、冲突、已消费或已反向的证据固定 HTTP 409，零业务成功副作用。
>
> 原 DR-SAL-04 的已批准/冻结正数标准成本候选只在既有权威合同能够证明批准、冻结及业务日期有效时成立；当前仓库仍无该证据。`NO_SOURCE` 不允许自动标准成本或 `LEGACY_UNVALUED` fallback；`SERIAL` 无论 `SO_BACKED` / `NO_SOURCE` 均只能使用上述原始 outbound valuation evidence。`NO_SOURCE` 的商业来源继续表示不存在权威 SO/Delivery 商业来源，但允许独立引用权威 Inventory outbound valuation provenance；该引用不得把商业模式静默改写为 `SO_BACKED` / `DELIVERY_BACKED`，商业金额继续按 NO_SOURCE 既有合同处理。其它情况下以 HTTP 409 拒绝确认。
>
> 明确禁止 `LEGACY_UNVALUED`、默认零成本、将零值池视为正值、客户端任意手工成本、Sales Order/Quotation 价格、不存在 Delivery 的假定历史成本、跨物料/仓库/LOT/SERIAL 取成本、新增未批准的 deferred valuation 状态或虚构 Finance 估值记录；不得以“尚未启用 valuation”为由绕过。
>
> 合法正向入库价值必须由 Finance canonical valuation 计算，并通过既有 Finance/Accounting canonical voucher writer 借记 `inventoryAccountRole(product_id)` 所解析的实际物料分类存货资产科目、贷记现有 `INVENTORY_GAIN_LOSS` 角色，金额为同一权威正向入库估值且借贷平衡；不得新建角色、硬编码科目、建立第二套凭证账或标记为历史 Delivery COGS reversal。库存估值依据与 Finance AR basis 相互独立：仅当存在真实、有效、匹配且现有合同允许的 Finance-owned authoritative AR/Open Item basis 时，才可执行 Credit Adjustment；否则不生成 Credit Adjustment、Invoice、AR Open Item、Sales Revenue、历史 COGS reversal 或虚假 Delivery，但合法库存入库处理仍保持有效。具体 Credit 场景若缺少已批准语义，只对该 Credit 操作 fail closed。
>
> 确认必须在受保护的 canonical transaction contract 内一致完成业务前置条件、真实收货、来源容量、LOT/SERIAL、估值依据、期间、凭证、审计与幂等。任一校验或 canonical writer 失败均不得留下业务确认成功状态、库存数量/追踪/估值、Voucher/GL、AR/Credit Adjustment、成功审计或成功幂等证据；缺少合法正数估值依据固定返回 HTTP 409。失败事实仍可由既有独立安全审计记录。重试不得重复经济效果，并发必须保持来源容量与库存估值一致。采用 `INVENTORY_GAIN_LOSS` 对方角色不改变 Sales Return 的商业单据、审计、来源或报表身份，亦不得将其伪装成库存盘盈单据。
>
> **Option C — Restricted Economic Reversal (`SO_BACKED` / `NO_SOURCE` Sales Return).** DR-SAL-05 在 SC55 / SC56 / SC58 与既已批准 Option A Confirm 之上引入受限整单冲销:Wave 6 阶段**仅允许 Full Return Reversal**,不支持部分冲销;冲销 ≠ 删除 / 取消 / 改写历史;原始 Return 与其历史入库估值、凭证事实全部保留;新产生独立、可审计的 `SALES_RETURN_REVERSAL` Reversal Evidence。冲销必须顺序通过 (i) Replacement Dependency Gate, (ii) Downstream Consumption Gate, (iii) Original Valuation + Voucher Reverse, (iv) Optional Finance Credit Independence,全部在同一受保护 canonical transaction 内执行;任一 Gate 失败整体回滚,原始 Return 与其物理 / 估值 / 凭证 / AR / 成功审计 / 成功幂等证据零副作用。不得仅以 `current_inventory_quantity ≥ return_quantity` 作为精确反转安全证据;不得按销售价格 / 标准成本 / 平均成本重新计算原始入库金额;不得引入 LEGACY_UNVALUED / 任意零值 / 客户手工值 / SO 或 Quotation 售价 / 假 Delivery COGS / 跨身份 pool;不得在已确认 Replacement Fulfillment 时强行冲销。DELIVERY_BACKED 既有 Confirm 与反向行为保持受保护,Batch A 不变。完整 contract 见 §34.15 DR-SAL-05 与 §34.5 Option C 验收矩阵。
>
> **Option C Reverse Idempotency Requirement Addendum (2026-10-17, owner approved).** 仅对 `SO_BACKED` / `NO_SOURCE` 的 Wave 6 canonical Option C Reverse，client 必须显式提供非空 `Idempotency-Key`；缺失时在任何业务 mutation、成功 audit 或成功 idempotency record 前返回 HTTP 400，server 不得生成随机 key 或以随机/隐式值替代。幂等 scope 固定为 canonical tuple `(operation_type='SALES_RETURN_REVERSAL_OPTION_C', document_id=returnId, idempotency_key=clientKey)`；payload fingerprint 使用规范化后的 Option C Reverse 业务 payload（包含 action、business date、reason 及任何会改变经济效果的权威请求字段，不包含无关 transport noise）。同 scope、同 key、等价 canonical payload 必须 replay 已记录结果且不得重复 Inventory、traceability、valuation、Accounting voucher、Finance Credit、audit 或其它经济效果；同 scope、同 key、冲突 canonical payload 返回 HTTP 409 且零新增业务副作用。幂等检查、全部 Gates、物理/追踪/估值/会计/可选 Credit、单一 success audit、结果保存必须属于一个 atomic business transaction；失败不得留下成功记录。本 addendum 不改变 Option A Confirm、DELIVERY_BACKED reverse、Replacement 或任何其它 operation 的幂等合同。
>
> **2026-10-17 LOT/SERIAL bounded superseding correction.** 上述 Option A / C 中“LOT/SERIAL 均依赖同身份正数在库池，且 Option C 当前池必须等于本次 Return movement”的组合条款不再作为 active requirement。LOT Gate-B 改为 conservative no-subsequent-negative-movement fence：锁定精确原始 Return valuation movement，证明原 quantity/value 未反向、当前 quantity/value 足以执行原值冲销，并证明该 Return movement 之后在同 product/warehouse/LOT authoritative consumption domain 内没有任何负 movement；同时检查 reservation、hold、transfer 及其它 downstream dependency。池余额充足本身不是未消费证明，不引入通用 inventory layer allocation。SERIAL Confirm/Reverse 改用原始 outbound valuation provenance：Confirm 只恢复一个合法 serial unit，Reverse 仅在该恢复单位仍完整、未被下游消费且全部 identity/lifecycle/dependency 证据成立时移除。所有检查必须在同一受保护 transaction 内锁定并权威重读；并发 Confirm/Reverse/OUT 只能产生一个合法序列化结果或 HTTP 409。
>
> **Legacy evidence rule.** 既有 Return 仅在 canonical 历史 provenance 可被唯一、确定性识别时适用上述合同；不得合成历史 outbound movement，不得从当前 pool balance 反推来源，不得用当前成本重建历史价值。歧义或不完整证据 fail closed；任何人工 remediation / backfill workflow 均需未来单独授权。

#### 34.3.11 Replacement / Replenishment（SC59–SC61）

```text
SC59 Return + Replacement Obligation (commercial source + replacement quantity)   [DOMAIN_OWNED]
SC60 Replacement Fulfillment State (open / partial / fulfilled / cancelled)         [DOMAIN_OWNED]
SC61 Replacement Source Link (no silent original executed-history reopen)           [DOMAIN_OWNED]
```

> Replacement 必须显式表达为新 / 重开的商业义务，不静默改写原订单 executed history。

#### 34.3.12 Prepayment Gate（SC62–SC65）

```text
SC62 Required Prepayment Amount / Ratio (per SO / per SO line)                    [DOMAIN_OWNED]
SC63 Prepayment Gate Stage Configuration
     (Planning Release / Reservation / Delivery)                                  [DOMAIN_OWNED]
SC64 Gate Result (PASS / WARN / BLOCK / OVERRIDE) + Override Policy                [DOMAIN_OWNED]
SC65 Prepayment Refund Integration (consume Finance refund canonical;
     do NOT create second advance-receipt ledger)                                   [DOMAIN_OWNED]
```

> Sales 拥有商业规则；Finance 拥有 money truth。Gate 不得反向写 Finance canonical。

#### 34.3.13 Reservation Intent（SC66–SC68）

```text
SC66 Reservation Intent Request (Sales → Planning)                                [DOMAIN_OWNED]
SC67 Reservation State View (Sales reads canonical Planning reservation)            [DOMAIN_OWNED]
SC68 Reservation Release Intent + React to SO Change / Cancel / Close /
     Return / Replacement                                                          [DOMAIN_OWNED]
```

> canonical reserved quantity 在 Planning；Sales 不得维护第二个 reservation ledger。
>
> B3102 行为合同分为四类：未启用预留时可创建 Inventory-owned 库存锁定；手工预留与库存量预留委托 Planning canonical reservation；预计量预留也委托 Planning，但现有 `EXPECTED` 无有限供给容量校验，故为 `BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED`，不得宣称 frozen Planning 已完整支持。调整/释放必须由 Sales intent 驱动 canonical adapter，且 SO 变更、取消、交付、受控关闭、退货、换补货均需按来源行重算或释放；任何失败不得留下 Sales shadow balance。

#### 34.3.14 Service Item Sales（SC69–SC71）

```text
SC69 Service-Type Commercial Item Identity
     (extends Master & Engineering Product 商业 classification)                     [DOMAIN_OWNED]
SC70 Service Sales Order Line + Service Fulfillment / Confirmation                 [DOMAIN_OWNED]
SC71 Service Finance Recognition (no inventory OUT; AR / Revenue via Finance
     canonical adapter)                                                             [INTEGRATION_BACKED]
```

> Service Item 必须不触发 inventory 物理 movement；保留 Finance 收入链路；Master & Engineering 仍拥有 Product identity foundation。

#### 34.3.15 Consignment（SC72–SC77）

```text
SC72 Consignment Instruction (commercial; Inventory position remains
     ENTERPRISE/seller-owned until settlement/title-transfer event)               [DOMAIN_OWNED]
SC73 Consignment Location (commercial identity, ≠ physical warehouse)              [DOMAIN_OWNED]
SC74 Consigned Quantity Tracking + Ownership-Retention Commercial State            [DOMAIN_OWNED]
SC75 Consignment Settlement Confirmation                                           [DOMAIN_OWNED]
SC76 Consignment Commercial Return                                                  [DOMAIN_OWNED]
SC77 Consignment Reporting                                                          [DOMAIN_OWNED]
```

> Consignment 商业流程不替代 Inventory 物理 truth；不替代 Finance AR / settlement canonical truth。客户/寄售地点仅表达 physical location / custody，不等于 CUSTOMER ownership；结算/产权转移前保持卖方 `ENTERPRISE` ownership，寄售退回保持/恢复卖方 ownership。

#### 34.3.16 Sales Reporting（SC78–SC81）

```text
SC78 Sales Execution Reports (Quotation / SO / Delivery Notice / Sales Delivery /
     Return / Replacement; existing decision-reports sales-summary /
     sales-outstanding extended)                                                   [DOMAIN_OWNED]
SC79 Sales Outstanding (未交 / 未结; existing decision-reports sales-outstanding)   [EXISTING_REUSE]
SC80 Sales Gross Profit (与 Inventory / Finance valuation evidence 集成)               [DOMAIN_OWNED]
SC81 Sales Ranking (customer / material / salesperson / sales group)                  [DOMAIN_OWNED]
```

> Reporting 必须消费 canonical facts；不允许 reporting shadow ledger。

#### 34.3.17 Credit Foundation Invariant（SC82）

```text
SC82 Credit Exposure Canonical-Fact Invariant                                      [DOMAIN_OWNED]
```

> foundation invariant：信用敞口必须派生自 canonical 事实；不得成为第二套 Sales / Finance truth。

#### 34.3.18 Credit Parameters（SC83–SC84）

```text
SC83 Credit Management Enabled / Disabled + Scope                                 [DOMAIN_OWNED]
SC84 Credit Control Timing + Control Strength                                     [DOMAIN_OWNED]
```

> 商业语义 = Sales-owned；实现可消费 Platform generic parameter infrastructure。
> 不为整个 SC capability 标 INTEGRATION_BACKED，因为 商业 meaning 仍归 Sales。

#### 34.3.19 Credit Rules（SC85–SC86）

```text
SC85 Credit Check Rule Model (rule per stage / scenario / timing / strength /
     credit item)                                                                   [DOMAIN_OWNED]
SC86 Credit Rule Result Types (WARNING / BLOCK)                                    [DOMAIN_OWNED]
```

> 商业语义 = Sales-owned；实现可消费 Platform generic rule infrastructure。
> 不为整个 SC capability 标 INTEGRATION_BACKED。

#### 34.3.20 Credit Profile（SC87–SC89）

```text
SC87 Credit Profile (credit object + customer + optional salesperson dimension
     where valid)                                                                  [DOMAIN_OWNED]
SC88 Credit Profile Effective Dates + Overdue-Day Policy                           [DOMAIN_OWNED]
SC89 Credit Profile Initial State + Rating + Applicable Rule + Status             [DOMAIN_OWNED]
```

> Customer identity foundation 仍归 Master & Engineering；Sales extends。

#### 34.3.21 Credit Occupancy / Exposure（SC90–SC92）

```text
SC90 Exposure Component Composition                                                [DOMAIN_OWNED]
SC91 Exposure Transition Rules (防止 SO exposure 与 AR exposure 重复计)              [DOMAIN_OWNED]
SC92 Used / Available / Over-Limit Calculation                                      [DOMAIN_OWNED]
```

> 最高风险 capability 之一；SC91 transition rule 必须防止:
>
> ```text
> approved SO exposure  →  delivered AR exposure 视为同一经济义务的不同阶段，转换时原 SO exposure 必须随状态转移被释放 / 重声明，不得与 active AR exposure 同时计入 used credit。
> ```
>
> SC90 exposure component 派生自 Finance canonical AR / advance / unapplied / refund / write-off + Planning approved SO commitment；不建立 second ledger。

#### 34.3.22 Credit Check（SC93–SC95）

```text
SC93 Credit Check Stage: SO Submit                                                 [DOMAIN_OWNED]
SC94 Credit Check Stage: SO Approve + Sales Delivery Confirm                       [DOMAIN_OWNED]
SC95 Credit Check Mandatory BLOCK + Audit (Sales owns rule meaning;
     Platform owns authorization / audit mechanics)                               [DOMAIN_OWNED]
```

> Credit Rule 决定哪些 stage 是 mandatory BLOCK；mandatory BLOCK 必须在 backend fail closed；frontend 可见性 !== authorization。

#### 34.3.23 Credit Special Approval（SC96–SC98）

```text
SC96 Credit Special Approval Request (reason + requested override + requested
     expiry / scope)                                                                [DOMAIN_OWNED]
SC97 Credit Special Approval Decision (bounded authority + ceiling + scope /
     expiry)                                                                       [DOMAIN_OWNED]
SC98 Credit Special Approval Audit + Linkage (Sales owns business scope /
     ceiling / expiry; Platform owns workflow / approval mechanics)               [DOMAIN_OWNED]
```

> Sales owns 商业语义（什么构成 valid override ceiling、scope / expiry）；Platform owns workflow / approval mechanics。
> Approved special exception must be bounded to its authorized source / scope；不得 unlimited permanent bypass。

#### 34.3.24 Credit Recalculation（SC99–SC100）

```text
SC99 Credit CHECK-only Reconciliation                                              [DOMAIN_OWNED]
SC100 Credit Deterministic Recalculation (不 mutate Sales / Inventory / Finance /
      Accounting 历史事实; 若重建派生 cache，必须先读 latest canonical snapshot，
      且 must never overwrite in-flight concurrent credit decision)               [DOMAIN_OWNED]
```

#### 34.3.25 Credit Query / Exception（SC101–SC102）

```text
SC101 Credit Query (limit / used / remaining / component breakdown)                [DOMAIN_OWNED]
SC102 Credit Exception History (over-limit / overdue / warning / block / special
      approvals / reason)                                                          [DOMAIN_OWNED]
```

#### 34.3.26 Credit Evaluation（SC103–SC107）

```text
SC103 Credit Indicator (QUALITATIVE / QUANTITATIVE)                                [DOMAIN_OWNED]
SC104 Credit Rating Scheme                                                         [DOMAIN_OWNED]
SC105 Credit Evaluation Model + Indicator Weight + Scoring Sheet                   [DOMAIN_OWNED]
SC106 Credit Bounded Multi-Scorer (per-process allowed; NOT enterprise-wide open
      scorer)                                                                       [DOMAIN_OWNED]
SC107 Credit Rating Result Application → Credit Profile                            [DOMAIN_OWNED]
```

> baseline 之内；external bureau / AI / ML / complex corporate-risk analytics = OUT_OF_SCOPE（§34.10）。

> Wave 11（SC99–SC107）的 Requirement 完成矩阵、已批准的 D1 / D2 / D3 决策、UAT-S-34/35/36 子断言与交付包装顺序见本文档 `Wave 11 — Sales & Customer Credit Evaluation / Reconciliation / Query — Stage B Requirement Closure (2026-10-27)`。本节文本本身未被改写。

#### 34.3.27 Permissions / RBAC / SOD（SC108–SC114）

```text
SC108 Sales View / Create / Manage / Approve                                       [DOMAIN_OWNED]
SC109 Pricing View / Manage + Price Override Authority                              [DOMAIN_OWNED]
SC110 Quotation / Return / Consignment / Service Sales Manage                        [DOMAIN_OWNED]
SC111 Credit View / Manage / Evaluate / Special Approve                            [DOMAIN_OWNED]
SC112 Replacement / Replenishment Manage                                            [DOMAIN_OWNED]
SC113 Consignment Manage + Service Item Authoring                                  [DOMAIN_OWNED]
SC114 SOD Principles (VIEW != WRITE; CREATE != APPROVE;
      PRICE OVERRIDE 需要单独 authority;
      CREDIT SPECIAL APPROVAL 需要 bounded authority)                              [DOMAIN_OWNED]
```

> Requirement 仅定义 capability-level intent 与不变量；具体 permission code 由 Design 在冻结 permission registry 内命名。

### 34.4 Business Invariants（S01..S20）

```text
S01  Sales commercial truth ≠ Inventory physical truth
S02  Sales commercial truth ≠ Finance open-item truth
S03  Sales commercial truth ≠ Voucher / GL truth (Accounting & Analytics)
S04  Quotation conversion 必须 preserves source trace (line capacity / customer / commercial terms)
S05  Approved historical execution cannot be silently rewritten（见 SC40 强制）
S06  Source-line capacity cannot be over-executed (Sales Delivery-item quantity ≤ SO item remaining；cross-ref SC53)
S07  Gift revenue zero ≠ inventory / cost zero（SC29 强制）
S08  Service fulfillment ≠ Inventory movement (无 inventory OUT；SC70 / SC71)
S09  Delivery Notice ≠ Sales Delivery ≠ Inventory Movement（商业指令 vs 商业执行 vs 物理 truth 三层）
S10  Return ≠ Delete; Replacement ≠ Return; NO_SOURCE Return ≠ 伪造源销售
S11  No-Source Return must visibly remain NO_SOURCE (SC57 强制显示)
S12  Reservation intent ≠ canonical reservation truth (Planning owns；Sales owns intent only)
S13  Prepayment Gate ≠ Advance-Receipt truth (Finance owns；Sales owns 商业 gate)
S14  Credit exposure must not double-count stages (SC91 transition rule 强制)
S15  Credit Check mandatory BLOCK must fail closed in backend (frontend 可见性 !== authorization)
S16  Credit exception is bounded (scope / expiry / authority ceiling；SC97 强制)
S17  Credit Recalculation must not rewrite Sales / Inventory / Finance historical truth (SC100 强制)
S18  Consignment location ≠ ownership ≠ settlement (physical inventory ≠ commercial ownership ≠ AR / settlement)
S19  Business dates are authoritative (所有商业文档 / canonical fact 均以 YYYY-MM-DD business_date 为口径；created_at / confirmed_at 仅作 audit timestamp)
S20  Same base currency baseline for Sales Pricing; multi-currency explicitly OUT_OF_SCOPE 此 baseline
```

后续 Design / Implementation 不得破坏以上 invariant；如需新增 invariant，必须重开 Requirement。

本次 Wave 6 Option A 只细化既有 invariant 的适用方式，不新增 invariant：S01 要求 Sales 只拥有真实 Return 商业身份，Inventory 继续拥有物理移动；S02 要求库存估值成立不推导 AR/Open Item 或 Credit Adjustment；S03 要求估值与平衡凭证由 Finance/Accounting canonical truth 产生；S10 禁止用假 Delivery、假销售或盘盈单据替代 `SO_BACKED` / `NO_SOURCE` Return；S11 要求 `NO_SOURCE` 在使用合法估值及 `INVENTORY_GAIN_LOSS` 时仍保持可见且不可改写模式。

本次 Wave 6 Option C 同样不新增 invariant，沿用上述既有约束的可逆形态：S05 "已确认历史不得被静默改写" 在 Option C 下体现为反向操作仅以独立、可审计的 `SALES_RETURN_REVERSAL` Reversal Evidence 进行，原始 Return 状态与历史事实不被覆写；S10 "Return ≠ Delete" 不禁止受限整单冲销，即 Option C 下 `SO_BACKED` / `NO_SOURCE` 已确认 Return 可经独立 Reversal Evidence 做反向库存 / 估值 / 凭证，但不得视为 Delete 或 Cancel；S02 / S03 同样约束反向操作不得产生虚假 AR / Open Item / Credit Adjustment / Voucher，不得借冲销名义引入新角色或第二套凭证账；Option C Gate-A 继续约束 Replacement 关系（不得伪造 Replacement fulfillment reversal）；S01 维持 Sales 商业身份与 Inventory 物理身份分离，反向时亦不允许 Sales 直接写 Finance valuation truth。

### 34.5 Frozen Functional Sales UAT（UAT-S-01..UAT-S-44）

每条 SC capability 至少一条 acceptance reference（Functional UAT / Race / Structural-RBAC assertion）。Coverage validation 见 §34.13 trace + 每条 UAT 末尾的 `[SCxx]` 标注。

```text
UAT-S-01  Quotation 创建 + validity + expired-rejection                              [SC09..SC12]
UAT-S-02  Quotation → Sales Order 单次转换                                          [SC13]
UAT-S-03  Quotation → Sales Order 重复转换 (受 SC14 策略约束)                        [SC14]
UAT-S-04  Sales Price List 生效日期 + 优先级 + fallback                             [SC15..SC18]
UAT-S-05  Price Customer / Material / UoM 解析；Sales UoM 与 Pricing UoM 不同时，
            必须使用 canonical conversion 自动换算，缺失换算时 backend BLOCK       [SC08, SC16..SC17]
UAT-S-06  Quantity Break 应用                                                      [SC17]
UAT-S-07  Manual Price Override (需要单独 authority)                               [SC19 + UAT-S-44]
UAT-S-08  Order-Time Resolved-Price Snapshot 不可变                               [SC20]
UAT-S-09  Order-Time Discount (line + header; auto + manual)                       [SC21..SC23]
UAT-S-10  Sales Order 全部 commercial parties (ship-to / settlement / payer /
            salesperson / sales group / customer-material)，并冻结 group identity   [SC06, SC26]
UAT-S-11  Sales Order Gift Line (selling price = 0, inventory / OQC / COGS /
            source-trace continue; zero revenue != zero cost)                       [SC29]
UAT-S-12  Sales Order commercial tax-basis assumption snapshot
            (commercial; final invoice tax 仍归 Finance)                            [SC27-SC28]
UAT-S-13  Sales Order Required Commercial Fields Submission Gate                  [SC34]
UAT-S-14  Sales Order Approval (SOD; CREATE != APPROVE)                             [SC33 + UAT-S-44]
UAT-S-15  Sales Order Change (post-approval; reason + before-after; audit)；
            分别验证 DISABLED / CONTROLLED_DIRECT / CONTROLLED_DOCUMENT / BOTH；
            direct 与 document 两条路径均经过 approval、RBAC/SOD、shared apply、
            idempotency、effective-version 与 append-only evidence；BOTH 不得绕过；
            已执行数量/来源/库存/财务事实受保护，非法或 stale 变更零副作用；
            SO Change vs Delivery 并发只能有一个合法序列化结果                 [SC01, SC37..SC40]
UAT-S-16  Sales Order Fulfillment / Partial / Controlled Close /
            Cancellation                                                            [SC41..SC44]
UAT-S-17  Delivery Notice 创建 + line planned-delivery-date / upper-lower tolerance
            snapshot；scheduled / notified / cancelled-notified / remaining capacity；
            cumulative notified over upper tolerated quantity is backend BLOCK       [SC01, SC08, SC30, SC45..SC48]
UAT-S-18  Sales Delivery Confirm (OQC + Reservation + Prepayment + Credit gates；
            DIRECT_ORDER 与 DELIVERY_NOTICE 两条真实 source-line path；不得 fake DN)；
            cumulative delivered over upper bound is BLOCK；
            delivered >= lower bound may controlled-close remainder with reason/audit，
            below lower bound cannot close as fulfilled                              [SC01, SC08, SC30, SC49..SC53]
UAT-S-19  Sales Return against Delivery (DELIVERY_BACKED; preserve behavior)       [SC54]
UAT-S-20  Sales Return against Original SO (SO_BACKED, no fake Delivery)            [SC55-SC57]
UAT-S-21  Sales Return No-Source (NO_SOURCE 可见; no fake source sale)             [SC56-SC57]
UAT-S-22  Replacement Obligation (Return + Replacement; replacement fulfillment
            state)                                                                   [SC59..SC61]
UAT-S-23  Prepayment Gate (Planning Release / Reservation / Delivery stage)        [SC62..SC65]
UAT-S-24  Reservation Intent request / view / release /
            react-to-change-cancel-close-return-replacement；system/document-type
            DISABLED / INVENTORY_LOCK / MANUAL / ON_HAND / EXPECTED behavior
            is resolved and enforced in backend；EXPECTED 未完成 bounded Planning
            contract extension前 fail closed                                         [SC01, SC66..SC68]
UAT-S-25  Service Item Sales (no inventory OUT; finance recognition)               [SC69..SC71]
UAT-S-26  Consignment Instruction + Settlement                                       [SC72..SC75]
UAT-S-27  Consignment Return + Reporting                                             [SC76..SC77]
UAT-S-28  Sales foundation：bounded SYSTEM / DOCUMENT_TYPE parameter resolution；
            customer defaults (settlement method / payment terms / salesperson /
            price list / discount table)；salesperson multi-group + one default；
            customer-material feature enable；sellable-control enable + customer-level
            independent customer-material translation；customer–material、
            salesperson–material、salesperson–customer 允销/限销；product
            sales_enabled fail-closed；group default/data-scope backend enforcement。
            Wave 1/4 仅作 focused checkpoint，final-completion owner = Wave 7          [SC01..SC08]
UAT-S-29  Sales Credit Profile 创建 + 生效日期 + overdue-day policy                [SC87..SC89]
UAT-S-30  Credit Parameters (enabled / scope / timing / strength) + Credit Rules
            (per stage / scenario / timing / strength / credit item)               [SC83..SC86]
UAT-S-31  Credit Occupancy Transition (SO exposure → delivered AR exposure
            不重复计; transition rule; component composition)                       [SC90..SC92]
UAT-S-32  Credit Check at SO Submit / Approve / Delivery (PASS / WARNING /
            BLOCK / SPECIAL_APPROVAL_REQUIRED; backend fail-closed)                [SC93..SC95]
UAT-S-33  Credit Special Approval (bounded authority + scope + expiry)              [SC96..SC98]
UAT-S-34  Credit Recalculation (CHECK-only + deterministic rebuild;
            no historical truth mutation)                                             [SC99..SC100]
UAT-S-35  Credit Query (limit / used / remaining / component breakdown /
            exception history)                                                       [SC101..SC102]
UAT-S-36  Credit Evaluation (bounded qualitative / quantitative + scoring sheet +
            multi-scorer; result → Credit Profile)                                   [SC103..SC107]
UAT-S-37  Sales Reporting — Execution Surface (Quotation / SO / Delivery
            Notice / Sales Delivery / Return / Replacement execution evidence;
            existing decision-reports sales-summary extended)                            [SC78]
UAT-S-38  Sales Reporting — Outstanding + Gross Profit + Ranking
            (Reporting dimensions: customer / material / salesperson / sales group;
            outstanding 未交 / 未结; gross profit 与 Inventory / Finance valuation
            evidence 集成; ranking 复用 canonical facts)                              [SC79, SC80, SC81]
UAT-S-39  Sales Order Edit Policy DRAFT/REJECTED only                                [SC35]
UAT-S-40  Reservation Intent canonical read-only                                    [SC67]
UAT-S-41  Consignment commercial 三层 distinction (location != ownership !=
            settlement)                                                              [SC73..SC74 + S18]
UAT-S-42  Sales Order commercial terms snapshot commercial 假定（不 statutory
            invoice tax truth; cross-ref SC27-SC28 + I4 + S02 + S03）              [SC27-SC28]
UAT-S-43  Gift Line cost retention (COGS continues even when revenue = 0; S07)      [SC29 + S07]
UAT-S-44  Permission / RBAC / SOD (P1-P5):
            VIEW ≠ WRITE (SC108 + SC114)
            CREATE ≠ APPROVE (SC108 + SC114)
            PRICE OVERRIDE 单独 authority (SC109 + SC114)
            CREDIT SPECIAL APPROVAL bounded authority (SC111 + SC114)
            Unauthorized backend mutation fails (SC95 / SC97 + SC114)
            Frontend hidden is NOT authorization (SC95 + SC114)
            Sales-group data scope is enforced in backend for Quotation / Sales Order /
            Reports once they carry sales_group_id; other-group data is not exposed   (SC06 + SC108..SC114)
```

UAT-S-19～UAT-S-22 的 Wave 6 Option A 验收矩阵如下；这是既有 UAT 的细化，不新增 UAT ID。UAT-S-22 仍只验收 Replacement obligation/state，不作为 Return 估值依据或跨越本次边界：

| # | Existing UAT | Acceptance case | Required result |
|---|---|---|---|
| 1 | UAT-S-20 / 21 | MOVING_AVERAGE 同物料/仓库正数权威池；LOT 同物料/仓库/LOT 正数 carrying-value pool | 真实收货成功入库；形成独立原始 Return valuation movement；LOT 加入共享池但保留 movement provenance |
| 2 | UAT-S-20 | SO_BACKED 的非 SERIAL 项无适用正数池，但存在业务日期有效、已批准且冻结的正数标准成本证据 | 成功入库；不得只凭正数字段推定已批准/冻结；当前仓库不能证明时仍 HTTP 409 |
| 2a | UAT-S-20 / 21 | SERIAL 存在唯一、匹配、未消费/未反向的权威原 outbound valuation evidence，且 lifecycle 为合法 returned-from-outbound、当前无 active in-stock unit | 精确恢复原 outbound 数量 1、价值和 serial identity；不得读取同 serial 正数在库池作为 valuation source |
| 2b | UAT-S-21 | NO_SOURCE 引用独立权威 Inventory outbound valuation provenance | 仍显示并保持 NO_SOURCE；商业金额不从 provenance、SO、Delivery 或库存价值推导；不得自动使用 standard cost / LEGACY_UNVALUED |
| 3 | UAT-S-20 / 21 | 两类合法估值依据均不存在或批准/冻结证据不可证明 | HTTP 409；零业务成功副作用 |
| 4 | UAT-S-20 / 21 | 仅可取得 `LEGACY_UNVALUED` | 拒绝确认，不得作为合法 basis |
| 5 | UAT-S-20 / 21 | 仅存在默认零成本或零值估值池 | 拒绝确认，不得将零值视为正数 |
| 6 | UAT-S-20 / 21 | 请求以 SO/Quotation 售价、客户端手工值或假 Delivery 成本估值 | 拒绝该 basis，不得写入经济事实 |
| 7 | UAT-S-20 / 21 | 合法正向估值确认 | 借记实际 `inventoryAccountRole(product_id)`、贷记既有 `INVENTORY_GAIN_LOSS`，金额一致且借贷平衡 |
| 8 | UAT-S-20 / 21 | 合法库存 basis 存在但无独立 Finance AR/Open Item basis | 库存处理有效；不产生 Credit Adjustment、虚假 AR/Invoice/Revenue |
| 9 | UAT-S-20 / 21 | 期间、科目映射、平衡、权限/SOD、追踪、容量或 writer 任一失败 | 整体回滚；确认状态、物理与估值、GL、AR、成功审计/幂等证据均不变 |
| 10 | UAT-S-20 / 21 | 同一合法请求重试或并发竞争 | 不重复入库、凭证或信用冲减；来源容量与库存估值保持一致 |
| 11 | UAT-S-20 / 21 / 22 | 分别处理 DELIVERY_BACKED / SO_BACKED / NO_SOURCE，并保留关联 Replacement | 每个 Return 的来源身份保持真实互斥；SO_BACKED 无假 Delivery；NO_SOURCE 可见；Return 不伪装盘盈；Replacement 不成为估值 basis |
| 12 | UAT-S-19 | DELIVERY_BACKED 回归 | 既有 source value restore、历史 COGS reversal 与合法 Finance Credit Adjustment 行为不变 |

UAT-S-19～UAT-S-22 的 Wave 6 Option C Restricted Economic Reversal 验收矩阵如下；这是既有 UAT 的细化，不新增 UAT ID。UAT-S-22 仍只验收 Replacement obligation / state；本 Option C 仅通过 Gate-A 增加受控反向约束，不改变 Replacement 既有 contract：

| # | Existing UAT | Acceptance case | Required result |
|---|---|---|---|
| 13 | UAT-S-20 / 21 | 无关联 Replacement obligation | 通过 Gate-A；继续 Gate-B / C / D |
| 14 | UAT-S-20 / 21 | 存在 ACTIVE 但尚未履行的 Replacement（`sales_order_replacements.cancellation_state='ACTIVE'` 且 effective fulfilled qty < replacement_quantity） | 必须经正规业务流程取消剩余补货义务；未处理时冲销返回 HTTP 409；零业务副作用 |
| 15 | UAT-S-20 / 21 | 存在已确认的 Replacement Fulfillment（`sales_replacement_fulfillments` 行确认） | HTTP 409 整体回滚；不删除 fulfillment link；不改写已确认 Delivery；不伪造 Delivery reversal；不将已履行数量改写为零；不静默恢复原 SO executed history |
| 16 | UAT-S-19 / 20 / 21 | 合法库存可证明精确反转（product / warehouse / bin identity；原始 POSTED Return valuation movement 完整、未反向；当前 quantity/value 足够；无下游 issuance / transfer / consumption / reservation / hold 破坏） | 完整零副作用整单冲销：Inventory OUT + `inventory_valuation_movements` 精确反向 + `SALES_RETURN` voucher 精确 entry 反向 + (可选) Credit 真实反向 + Reversal Evidence + idempotency + audit |
| 16a | UAT-S-20 / 21 | LOT 原始 Return movement 之后，同 product/warehouse/LOT authoritative consumption domain 无任何负 movement；当前 quantity/value 足够；其它 dependency 全部通过 | 通过 conservative fence；从共享 LOT 池精确冲销原 Return quantity/value；不得要求当前池聚合余额等于本次 Return movement |
| 16b | UAT-S-20 / 21 | LOT 当前池仍足够，但原始 Return movement 后存在任一负 movement，或 reservation/hold/transfer 依赖无法排除 | HTTP 409；池余额充足不得替代未消费 provenance；零部分副作用 |
| 16c | UAT-S-20 / 21 | SERIAL 原 outbound provenance 与 Return restore movement 均唯一完整，serial 仍是本次恢复的一单位且未被后续消费/转移/反向 | 精确移除该 restored serial unit，并精确反向其 Return valuation/voucher；保持 serial 唯一数量 |
| 16d | UAT-S-20 / 21 | SERIAL outbound/restore provenance 缺失、歧义、冲突、已消费、已反向，或 serial 已有另一 active in-stock unit | HTTP 409；不得以同 serial 正池、销售价格、当前成本或合成历史替代；零部分副作用 |
| 17 | UAT-S-19 / 20 / 21 | 估值或库存下游 consumption 无法以 canonical evidence 严格证明精确反转安全 | HTTP 409；原始 Return 与其物理 / 估值 / 凭证 / AR / 成功审计 / 成功幂等证据零变化 |
| 18 | UAT-S-19 / 20 / 21 | 仅以 `current_inventory_quantity ≥ return_quantity` 或估算平均成本 / 标准成本作为依据 | 拒绝；不得作为精确反转安全证据 |
| 19 | UAT-S-19 / 20 / 21 | Finance Credit Adjustment 不存在的合法 Option A Return | 不得引用伪造 Credit；不访问不存在 target Open Item；仅执行合法 Inventory / Valuation / Voucher reverse |
| 20 | UAT-S-19 / 20 / 21 | Finance Credit Adjustment 存在但下游 application / refund 已消费 | HTTP 409；整体回滚；保留 Credit 现状 |
| 21 | UAT-S-20 / 21 | Option C Reverse 显式携带 `Idempotency-Key`；同 scope + 同 key + 等价 canonical payload retry；同 key + 冲突 payload；并发竞争 / 二次 reversal / vs Inventory OUT / vs Replacement fulfillment | 等价 retry replay 已记录结果且不重复 Inventory/traceability/valuation/voucher/Credit/audit；冲突 payload 或非法竞争返回 409；零重复经济效果、零负库存、零部分冲销、零孤儿 audit |
| 21a | UAT-S-20 / 21 | Option C Reverse 缺失显式 `Idempotency-Key` | HTTP 400；server 不生成随机 key；Inventory、traceability、valuation、voucher/GL、Credit、Return/Reversal Evidence、成功 audit、成功 idempotency record 均零新增 |
| 22 | UAT-S-19 | DELIVERY_BACKED 既有反向行为回归 | 既有 `reverseOperationalReturn()` 行为保持不变；Batch A 不变 |
| 23 | 上游 R-SAL-10 / UAT-S-37 | Purchase Return 既有反向回归 | Purchase 侧 `reverseOperationalReturn` 行为不因 Option C 改动 |

> Case 13–21 即承担 Option C 三个 Gate + Original Valuation + Voucher + Finance Credit Independence 的反向验收；不新增 UAT ID。
> Case 22 验证 DELIVERY_BACKED 既有 reverse 不被 Option C 改写。
> Case 23 确认 Purchase Return 既有 reverse 行为不受 Option C 改动影响。
> UAT-S-22 在 Option C 下仍仅承担 Replacement obligation / state 验收；Gate-A 仅对其执行 A.2 / A.3 失败语义，不引入 Replacement 自身的反向 contract。

#### 34.5.1 Wave 6 SO_BACKED / NO_SOURCE × valuation method 六组合 Requirement Matrix（2026-10-17 bounded correction）

本矩阵仅细化 SC55 / SC56 / SC58 与 UAT-S-20 / UAT-S-21，不新增 UAT ID；DELIVERY_BACKED 保持 §34.3.10 / UAT-S-19 既有合同，不进入本次修订。

| Commercial mode × valuation | Commercial amount authority | Inventory valuation authority | Confirm eligibility / effects | Reverse eligibility / effects | Failure / downstream dependency contract |
|---|---|---|---|---|---|
| SO_BACKED × MOVING_AVERAGE | 真实 approved SO line 的不可变商业价格证据；不得作为库存成本 | 同 product/warehouse 正数权威 MA pool；无池时仅可使用既有合同能够证明 approved/frozen/effective 的标准成本，当前不能证明则 409 | 校验 SO/customer/product/capacity、period、RBAC；真实 Inventory IN，写独立 Return valuation movement 与平衡 voucher | 沿用已验证语义：原 movement/voucher 未反向、当前池足够、Return 后同池无 canonical 负 movement、Replacement/Credit/dependency 均通过后精确反向 | 任一容量、期间、权限、下游负 movement、依赖或证据失败均 409/相应授权错误并整体回滚；不改变既有 MA 语义 |
| SO_BACKED × LOT | 真实 approved SO line 商业证据；与 LOT carrying value 独立 | 同 product/warehouse/LOT 正数 authoritative carrying-value pool；允许形成独立 Return movement 后加入共享池 | 精确 LOT identity、tracking、pool 与依赖校验；Inventory/LOT IN + 原值正 movement + voucher | 不再要求 aggregate pool == Return movement；要求原 movement 未反向、当前 quantity/value 足够、Return 后同 LOT authoritative domain 无任何负 movement，并通过 reservation/hold/transfer 等依赖后精确反向 | 仅余额 `>=` 不足；任一后续负 movement、依赖不明或证据缺失均 409、零副作用；不引入通用 layer allocation |
| SO_BACKED × SERIAL | 真实 approved SO line 商业证据；不得作为 serial 库存价值 | 唯一匹配的权威原 outbound valuation movement；禁止既有正 same-serial in-stock pool、标准成本或销售价替代 | serial 为合法 returned-from-outbound lifecycle、当前无 active in-stock unit、原 outbound 数量 1/价值/identity/reversal history 完整；精确恢复一单位与原值 | restored serial unit 仍唯一完整且无 downstream consumption/transfer/hold conflict；精确移除该单位并反向 Return valuation/voucher | 缺失、歧义、stale、冲突、已消费/反向或重复在库均 409，物理/估值/凭证/audit/idempotency 零成功副作用 |
| NO_SOURCE × MOVING_AVERAGE | 固定沿用 NO_SOURCE 商业合同；不得从 SO/Delivery/provenance/库存价值推导商业金额 | 同 product/warehouse 正数权威 MA pool，或独立且确定的 Inventory outbound valuation provenance；禁止自动 standard-cost/LEGACY_UNVALUED fallback | 保持 NO_SOURCE 可见且无 SO/Delivery source pair；真实 Inventory IN、Return valuation movement、voucher；无权威 basis 则 409 | 沿用 MA strict negative-movement proof；精确反向原 Return movement/voucher，不虚构 Credit/AR | 商业/估值来源混淆、下游负 movement、period/RBAC/dependency 或 provenance 失败均整体回滚 |
| NO_SOURCE × LOT | NO_SOURCE 商业金额合同保持不变 | 同 product/warehouse/LOT 正数 carrying-value pool，或独立、确定且同 LOT 的 authoritative Inventory outbound valuation provenance；无自动成本 fallback | 保持 NO_SOURCE，不伪造 SO/Delivery；精确 LOT IN、独立 Return movement 与 voucher | 使用与 SO_BACKED LOT 相同的 no-subsequent-negative-movement fence；足额当前池 + 无后续负 movement + 全 dependency 通过后精确反向 | 余额充足不能单独通过；任何负 movement、reservation/hold/transfer 冲突或 provenance 不完整均 409、零副作用 |
| NO_SOURCE × SERIAL | NO_SOURCE 商业金额合同保持不变且不得从 serial outbound value 推导 | 唯一匹配的权威原 serial outbound valuation evidence；商业 mode 仍为 NO_SOURCE | 合法 returned-from-outbound lifecycle、无 active in-stock duplicate、数量 1、原值及 reversal history 全部确定；精确恢复一单位 | 只反向本次 restored unit；要求 restore/outbound provenance 未反向且无 downstream dependency | 无 eligible provenance 固定 409；不得转成 SO_BACKED/DELIVERY_BACKED，不得使用 positive same-serial pool、销售价、当前成本或合成历史 |

六组合共同合同：Confirm 与 Reverse 均须后端授权、期间开放、完整 preflight、稳定锁序、transaction 内权威重读、成功 audit 与 idempotency；任一失败不留下 Return 成功状态、Inventory/LOT/SERIAL、valuation、voucher/GL、AR/Credit、成功 audit 或成功 idempotency 的部分事实。SQLite 必须以 encompassing write transaction 保持同义；MySQL 必须以真实独立 session 证明 Confirm/Reverse/OUT 竞争只有合法序列化结果。历史数据只接受唯一确定的 canonical provenance，不作 balance/cost 推断或 migration-time synthetic backfill。

### 34.6 Sales MySQL Race Requirement（R-SAL-01..R-SAL-24）

```text
Total = 24 races
  R-SAL-01..15 = from frozen audit (15)
  R-SAL-16..22 = 7 new business races (Delivery Notice / SO Change / Close /
                 Consignment / Service)
  R-SAL-23    = Credit Deterministic Recalculation (cache rebuild) race;
                只在 persisted cache rebuild 存在时 materializable
                (CONDITIONAL)
  R-SAL-24    = Credit Policy / Profile Mutation vs Credit Check
                (DORMANT; distinct from R-SAL-12; protects coherent policy /
                profile / limit / rule / overdue / rating-result snapshot
                consistency)
```

#### 34.6.1 R-SAL-12 与 R-SAL-24 区分

```text
R-SAL-12  Credit Check vs another SO consuming same credit
          → protects exposure / capacity consumption
          → canonical lock identity = Credit Profile identity + SC91 transition-lock

R-SAL-24  Credit Policy / Profile Mutation vs Credit Check (NEW; not subsumed)
          → protects coherent effective-policy-snapshot consistency
          → canonical lock identity = effective policy / profile version identity
          → mutation side may include: Credit Parameters; Credit Check Rule;
            Credit Profile; Credit Limit; Overdue-Day Policy; Rating Result
            applied to Credit Profile; or any other effective credit-control value
          → does NOT require all these to share one physical record
          → this is a business-snapshot invariant
```

#### 34.6.2 R-SAL-24 Required Invariant

```text
one credit decision → one coherent effective policy version
```

valid serialization outcome A:
  Credit Check logically precedes policy mutation
  → check uses the complete OLD effective snapshot

valid serialization outcome B:
  Policy mutation logically precedes Credit Check
  → check uses the complete NEW effective snapshot

Forbidden:
  one Credit Check combines old credit limit + new rule + old overdue policy +
  new rating/profile state, or any other mixed-version decision

Race-corollary invariant (R-SAL-24 special approval consistency):
  Where a Credit Check returns SPECIAL_APPROVAL_REQUIRED, the Special Approval
  request must trace to the exact Credit Check / policy snapshot that produced it;
  a later policy mutation must not silently reinterpret an already approved
  exception; if revalidation is required by policy, it must be explicit.

> Requirement 不 prescribe 物理 lock / version column / 表 schema。Design 决定。
> 仅约束 商业 语义 invariants：coherent snapshot per decision + audit-traceability of decision-source.

| ID | Concurrent Operations | Canonical Lock Identity | Business Invariant | Final Economic State |
|---|---|---|---|---|
| R-SAL-01 | Sales Delivery confirm × 2 against same SO line remaining | Sales delivery-item source-line identity (Sales-owned source lock) | S05 + S06 | Combined delivered qty ≤ SO item remaining |
| R-SAL-02 | Sales Delivery confirm × 2 against same Reservation | Planning reservation canonical identity | S12 | combined consumption ≤ reservation |
| R-SAL-03 | Sales Return confirm × 2 against same delivery-item remaining | Sales return source-line identity | S06 + S10 | combined returned qty ≤ delivery-item remaining |
| R-SAL-04 | M14 Sales Discount confirm × 2 against same source AR | Finance canonical AR (item_class=SOURCE) identity | (Finance F1 family) + S13 | combined discount ≤ AR open amount |
| R-SAL-05 | Sales Delivery confirm vs Sales Return confirm (same physical race) | Inventory canonical position + Sales commercial identities | S01 + Inventory frozen writer | exact-once net physical effect; zero negative stock |
| R-SAL-06 | Quotation conversion × 2 against same Quotation line | SC13 Quotation line identity | S04 + S06 | converted qty ≤ quotation line remaining; SO aggregate ≤ quotation aggregate |
| R-SAL-07 | SO approve vs SO Change | SC40 change-document identity | S05 | approve OR change wins; approved-and-changed never silent-rewrite |
| R-SAL-08 | SO Change vs Delivery creation | SC40 change identity vs SC53 delivery-item identity | S05 + S06 | change applies to remaining obligation only |
| R-SAL-09 | Sales Delivery vs Return / Reopen | Delivery-item + Return-item identities | S05 + S10 | satisfied obligation may close; reopen is explicit; no silent relive |
| R-SAL-10 | Sales Return vs Replacement fulfillment | Return-item (SC57) vs Replacement (SC59-SC61) identity | S10 + SC61 | replacement state machine consistent with source return |
| R-SAL-11 | Pricing update vs Order approval | Sales Price List effective-date identity vs SO identity | S20 | snapshot is immutable; price change never rewrites already-approved SO price |
| R-SAL-12 | Credit Check vs another SO consuming same credit | Credit Profile identity + SC91 transition-lock identity | S14 + S15 | combined commit ≤ limit; mandatory BLOCK fail-closed |
| R-SAL-13 | Credit Special Approval vs Order approval | SC96 special-approval identity vs SO identity | S16 | either special-approval OR standard approval wins; never both silently |
| R-SAL-14 | Credit release vs Collection / Return | Credit Occupancy identity vs Finance refund/collection canonical | (Finance F8 family) + S14 | credit release uses transition rule, never double-counts |
| R-SAL-15 | Prepayment Gate vs Refund / Application | SC62 required-amount identity vs Finance refund canonical identity | S13 | gate vs refund snapshot reconciled; no second advance ledger |
| R-SAL-16 | Delivery Notice create/confirm × 2 against same SO notice capacity | SC46 Delivery Notice line notice-capacity identity | S04 + S06 | combined notified qty ≤ SO item remaining notice capacity |
| R-SAL-17 | Sales Delivery confirm × 2 against same Delivery Notice remaining capacity | SC46 Delivery Notice remaining identity | S09 + S06 | combined delivered qty ≤ Delivery Notice remaining |
| R-SAL-18 | SO Change vs Delivery Notice creation / confirmation | SC40 change-document identity vs SC46/SC48 Delivery Notice identity | S05 + S09 | Change applies to remaining obligation only; Delivery Notice serializes against latest change effective |
| R-SAL-19 | SO Close/Cancel (SC43/SC44) vs Delivery Notice or Sales Delivery confirmation | SC43/SC44 close state identity vs SC46/SC49 confirmation identity | S05 + S09 | One transition wins; close/cancel never silently coerces already-confirmed commercial execution |
| R-SAL-20 | Consignment Settlement × 2 against same unsettled consigned quantity | SC74 consignment outstanding qty identity | SC74 + S18 | combined settled qty ≤ consigned outstanding; settlement serialization |
| R-SAL-21 | Consignment Settlement vs Consignment Commercial Return | SC74 settlement identity vs SC76 commercial return identity | SC74 + SC76 + S18 | Either settlement or return commits; combined effect ≤ consigned outstanding at any time |
| R-SAL-22 | Service Fulfillment Confirmation × 2 against same Service order remaining | SC70 service remaining identity | S08 | combined confirmation qty ≤ service-order remaining; no double-confirm |
| R-SAL-23 | Credit Deterministic Recalculation / Cache Rebuild vs New Credit-consuming Sales Transaction (only when persisted cache rebuild exists) | Credit Occupancy derived-cache identity vs SO Check identity | S14 + S17 + SC100 | (a) Rebuild reads latest canonical snapshot before applying; (b) In-flight credit decision in concurrent transaction wins for that transaction; (c) Rebuild never overwrites in-flight decision's snapshot; (d) Rebuild never mutates canonical Sales / Inventory / Finance / Accounting historical truth |
| R-SAL-24 | Credit Policy / Profile Mutation vs Credit Check (DORMANT) | Effective policy / profile / limit / rule / overdue / rating-result version identity | §34.6.2 (one credit decision → one coherent effective policy version) + §34.6.2 (special-approval trace consistency) | One Credit Check uses exactly one coherent effective policy snapshot; special-approval trace preserves the snapshot source; no mixed-version decision |

> R-SAL-01..R-SAL-15 **来源于 Sales & Customer Domain Audit FINAL ARITHMETIC & MAPPING CLOSURE**。
> R-SAL-16..R-SAL-22 是本 Requirement 阶段为新增 capability 主动引入的业务 race。
> R-SAL-23 只在 persisted derived cache rebuild 实现时 materializable；否则可视为 R-SAL-12 的 deterministic 子情况（不计入 race ID）。
> R-SAL-24 是 cooldown 闭包新引入的独立 race ID，专门保护 **coherent effective policy / profile snapshot**；与 R-SAL-12 (exposure / capacity consumption) 区分；不允许 subsume。
> 后续 Design 阶段可基于新增 SC capabilities 增列 R-SAL-25+；不得删除 R-SAL-01..R-SAL-24。

**Race Coverage Snapshot:**

```text
R-SAL-01..R-SAL-15  → 5 REAL covered today + 10 DORMANT pending capability implementation
R-SAL-16..R-SAL-22  → 7 new DORMANT business races
R-SAL-23            → 1 CONDITIONAL (materializable only with persisted cache rebuild)
R-SAL-24            → 1 DORMANT (coherent effective policy-snapshot consistency)
Total               → 24 (5 REAL + 17 DORMANT + 1 CONDITIONAL on R-SAL-23 + 1 DORMANT on R-SAL-24)
No subsumed Race ID (former "Credit Profile mutation → R-SAL-12 subsumed" clause removed).
```

> **Wave 6 Option C Restricted Economic Reversal 与 R-SAL-09 / R-SAL-10 的澄清（不新增 Race ID）。** DR-SAL-05 Option C 受限整单冲销沿用 R-SAL-10（Sales Return vs Replacement fulfillment）既有的 canonical lock identity 组合（`return_order_items.id` + `sales_order_replacement_lines.id` + `sales_replacement_fulfillments` 行），并以 Gate-A 作为受控序列化条件：已有 Replacement Fulfillment Evidence → 竞争结果 = HTTP 409 整体回滚，与 R-SAL-10 既有的 "replacement state machine consistent with source return" 一致，无 race ID 修订。R-SAL-09（Sales Delivery vs Return / Reopen）不被 Option C 触碰：Option C 仅对 Sales Return 自身做受限反向，不重开 Sales Delivery，不重开已 close 的 SO，不 silent relive 已确认历史。Option C 反向操作与 Replacement fulfillment 之间的并发由 R-SAL-10 承担；Option C 反向操作与确认时并发由 R-SAL-05 / R-SAL-03 既有 contract 承担。

### 34.7 Permission / RBAC / SOD

- 业务 capability 意图（不冻结 permission code 名字）：SC108–SC114；
- 五大不可破坏原则：

```text
P1  VIEW  ≠ WRITE
P2  CREATE ≠ APPROVE
P3  PRICE OVERRIDE 需要单独 authority (separate from CREATE)
P4  CREDIT SPECIAL APPROVAL 需要 bounded authority (separate from standard approval)
P5  AUDIT trail 不得被任何其它 capability 跳过
```

- 已 frozen 5 角色（admin / sales / reviewer / warehouse / accounting）继续保持；本节 capability 仅规定 intent，不为 Design 阶段新引入 role。
- Sales 商业文档上的 SOD `creator_id ≠ reviewer_id` 已 covered today（sale_orders.approval flow）；不得因本 Domain capability 增加而放宽。

### 34.8 Cross-Domain Boundary Table

```text
15 capability families 显式列出
```

| # | Capability Family | Sales owner (SC IDs) | Frozen-domain dependency | Read / Write direction | Forbidden duplicate truth |
|---|---|---|---|---|---|
| 1 | Customer commercial extensions | SC02..SC07, SC26, SC36 | Master & Engineering (Customer identity) | R/W: Sales extends Customer; reads identity | 不得 second Customer identity |
| 2 | Quotation / Sales Order / Sales Order Change / Sales Delivery / Sales Return / Replacement / Delivery Notice | SC09..SC14, SC24..SC44, SC45..SC48, SC49..SC53, SC54..SC58, SC59..SC61 | Master & Engineering (Customer / Product / UoM / approved-frozen standard-cost evidence); Inventory & Warehouse (physical movement and tracking); Manufacturing & Quality (OQC); Finance Operations (AR / Open Item / Credit Adjustment); Accounting & Analytics (canonical valuation / voucher) | R/W: Sales owns commercial Return and truthful mode/source identity; Inventory owns physical movement; Finance/Accounting owns valuation/voucher; Finance owns AR/Open Item/Credit Adjustment. Sales consumes canonical contracts and never writes duplicate truth | 不得 second physical / valuation / voucher / AR ledger；不得由库存 basis 推导 AR basis；不得把 Sales Return 伪装成盘盈 |
| 3 | Sales Pricing | SC15..SC20 | Master & Engineering (Product reference / UoM) | R/W: Sales owns price list + snapshot | 不得 second pricing engine behind frozen domain |
| 4 | Order-Time Discount | SC21..SC23 | Finance Operations (customer settlement / credit-adjustment balance constraint — Finance-owned, NOT B3103 Credit) | R/W: Sales 拥有 order-time discount; consumes Finance constraint at confirm | 不得 second settlement ledger; 不得把 discount 静默注入 Finance voucher |
| 5 | Prepayment Gate | SC62..SC65 | Finance Operations (Advance Receipt / Unapplied Balance / Refund) | R/W: Sales 决定 gate rule; Finance 拥有 money truth | 不得 second advance ledger |
| 6 | Reservation Intent | SC32, SC66..SC68 | Planning (canonical reservation) + Inventory (availability / locks) | R/W: Sales requests / reads; Planning owns canonical | 不得 second reserved-quantity ledger |
| 7 | Service Item Sales | SC69..SC71 | Finance Operations (Revenue / AR recognition); Master & Engineering (Product identity) | R/W: Sales owns commercial; Finance owns finance | 不得 force warehouse OUT |
| 8 | Consignment | SC72..SC77 | Inventory & Warehouse (ENTERPRISE/seller-owned position until settlement/title transfer); Finance Operations (settlement 商业层) | R/W: Sales owns commercial lifecycle; consumes frozen canonical | 不得 second consignment stock balance；不得以 CUSTOMER-owned 伪装寄售 |
| 9 | Sales Reporting | SC78..SC81 | Inventory & Warehouse (qty); Finance Operations (revenue / AR); Planning (open demand) | R: Sales reports; canonical read-only | 不得 reporting shadow ledger |
| 10 | Credit Parameters / Rules | SC83..SC86 | Platform (parameter / rule infrastructure) | R/W: Sales owns semantic; Platform owns mechanics | 不得 make Platform the business owner |
| 11 | Credit Profile | SC87..SC89 | Master & Engineering (Customer identity) | R/W: Sales extends customer | 不得 second Customer identity |
| 12 | Credit Occupancy / Exposure | SC82, SC90..SC92 | Finance Operations (AR / advance / unapplied / refund / write-off); Planning (approved SO commitment) | R: Sales consumes canonical facts; builds exposure | 不得 second Sales / Finance exposure ledger |
| 13 | Credit Check | SC93..SC95 | Finance Operations (AR / prepayment / refund); Platform (audit / authorization) | R/W: Sales owns rule semantics; backend fail-closed BLOCK | 不得 UI-only control |
| 14 | Credit Special Approval | SC96..SC98 | Platform (workflow / approval mechanics) | R/W: Sales owns scope / ceiling / expiry; Platform owns flow | 不得 unlimited permanent bypass |
| 15 | Credit Recalculation / Query / Evaluation | SC99..SC107 | Finance Operations (canonical facts read); Platform (storage / read RBAC) | R: read-only from canonical + cache (where cache rebuild exists per SC100 invariant) | 不得 mutate Sales / Inventory / Finance historical truth |

> 准确计数：**15 capability families** 在本表显式列出。
> Accounting & Analytics 在本节列作下游消费者；不在本阶段 Design。

### 34.9 Compatibility / 不变性约束

- 已 covered 的下游约束不得破坏：
  - **I1 — One AR truth**：Finance Operations F1；Sales 通过 Finance canonical adapter 写入 AR / advance / refund，不绕过；
  - **I2 — One physical stock truth**：Inventory V21；Sales Delivery / Sales Return 通过 canonical writer (`applyInventoryMutation` + `postTrackedMovement`) 完成 physical effect；
  - **I3 — One reservation truth**：Planning V19；Sales 通过 `assertStrongReservationAvailability` 读取，不写第二套；
  - **I4 — One Tax truth (statutory)**：Accounting & Analytics (财务凭证 statutory tax) downstream；Sales 仅拥有 **commercial tax-basis assumption** snapshot（SC27 header 假定 + SC28 per-line 假定）；commercial tax-basis assumption != statutory invoice tax truth（S02 + S03 family invariant）；商业 storage 形状由 Design 决定；本节不 prescribe 表名 / 列名 / cache-view-table 选型；
  - **I5 — Business date is authoritative**：`sales_orders.order_date` / `requested_delivery_date`、`sales_deliveries.delivery_date`、`return_orders.return_date` 作为 canonical period 锚点；`created_at` / `confirmed_at` 仅 audit timestamp；
  - **I6 — Source identity preserved**：Quotation → Sales Order → (`Delivery Notice` optional) → Sales Delivery → Sales Return → Finance AR adapter 的 source-document identity 链路全程保留；直接出库保留 SO line identity，不制造虚假 DN。

- 不得通过本节 capability 重写其它已 frozen domain 的 canonical owner / invariant。

### 34.10 Out of Scope（本 Domain Closure 不实施）

```text
Multi-currency / FX（SC15–SC20 baseline = 单 base currency）
External tax hardware / 法定电子发票 集成
External credit bureau
AI / ML risk scoring
复杂 corporate-risk analytics
第三方金融数据
Customer portal
Salesforce-style CRM extension (sustained Core Scope Cleanup 决定)
Marketing automation
Full CPQ product configurator
复杂 contract lifecycle management
Multi-organization consolidation
Generic Workflow 实现自身 (Platform 范围)
```

不应仅因为 CRM 扩展 out-of-scope 而删减 Customer / Supplier Contact / 收货地址 / 结算方 等核心 Sales-owned 功能。
本节 §34 全部 capability 均建立在 `document.md §15` (Core Scope Cleanup) 已认可的 Sales 范围内。

### 34.11 Acceptance Criteria

```text
A. Sales Capability Catalogue
   114 capability IDs (SC01..SC114)
   100 DOMAIN_OWNED + 3 INTEGRATION_BACKED + 11 EXISTING_REUSE + 0 OUT_OF_SCOPE
   Sum check: 100 + 3 + 11 + 0 = 114  ✓
   与 frozen audit 36 capability / 25 Gap / 24 RC 全量 traceability
B. Manual Trace
   B3102 销售管理 → SC01..SC81
   B3103 信用管理 → SC82..SC107
   Boundaries → SC108..SC114 (Permissions / SOD)
C. Invariant Trace
   20 invariant S01..S20 在所有 capability 中贯彻
   每条 invariant 使用 S## 单一命名空间；不混用 SC##
D. UAT Trace
   44 UAT (UAT-S-01..UAT-S-44)
   每条 SC capability 至少一条 acceptance reference（Functional UAT / Race /
   Structural-RBAC assertion）
E. Race Trace
   24 races (R-SAL-01..R-SAL-24)
   5 REAL (covered today) + 10 DORMANT (audit) + 7 DORMANT (new business)
   + R-SAL-23 CONDITIONAL (materializable when persisted cache rebuild exists)
   + R-SAL-24 DORMANT (coherent effective policy-snapshot consistency)
   不允许 subsume R-SAL-24 进入 R-SAL-12；不允许删除既有 24 race ID
   可新增 R-SAL-N+ 但不得删除既有
F. Cross-Domain Trace
   Sales consumes Master & Engineering / Planning / Manufacturing & Quality /
   Inventory & Warehouse / Finance Operations canonical
   Sales does NOT write physical / AR / Voucher / GL truth 第二份
   15 capability families (§34.8) 显式列出
G. Frozen-Domain Integrity
   0 high-risk frozen-domain bypass；本节 capability 实现不能引入新的 bypass
H. Domain Closure Coverage
   0 SEMANTIC_MISMATCH, 0 OUT_OF_SCOPE；audit MISSING 全部被本 §34 收尾为 SC capability with INVARIANT
```

### 34.12 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

```text
1.  Multi-currency / FX 需求被引入（SC15–SC20 baseline = 单 base currency）；
2.  需要重写 Customer identity foundation（Master & Engineering 拥有）；
3.  需要重写 Product / Material / UoOM foundation（Master & Engineering 拥有）；
4.  需要把 Sales 写入 Physical Inventory truth 第二份（Inventory & Warehouse 拥有）；
5.  需要把 Sales 写入 Reservation canonical truth 第二份（Planning 拥有）；
6.  需要 Sales 维护 credit exposure second ledger（Finance canonical 是 single exposure truth）；
7.  需要 DROPhistorical sales / delivery / return / discount / credit 事实表；
8.  需要 retroactive rewrite 已 approved / 已 executed / 已 financially-recognized 销售历史；
9.  需要让 Credit Check 仅 UI 控制而 backend fail-open；
10. 需要让 Credit Special Approval unlimited permanent bypass；
11. 需要把 Customer settlement / credit-adjustment balance constraint 改名为 B3103 Credit Management feature；
12. 需要把 Consignment 商业流程落到 Inventory 物理 truth 第二份；
13. 需要把 Service Item Sales 强制 warehouse OUT；
14. 需要把 Reporting shadow ledger 注入 SC78–SC81；
15. 需要把 Sales Order closure / cancel 状态反向重写 Finance / Inventory period truth；
16. 需要为普通 unexecuted-order change 强制 Finance voucher reversal；
17. SC40 / SC91 transition rule 被弱化；
18. MySQL migration 无法保证 parity；
19. 引入 external credit bureau / AI / ML / 第三方金融数据 (OUT_OF_SCOPE §34.10)；
20. 引入需要 generic Workflow 替换 5 审批族。
```

### 34.13 Requirement Traceability Matrix

每条 frozen Audit Capability (CAP-1..CAP-36) 显式 row；no range approximation；不 invent Gap 仅为填链。

Trace structure per row:

```text
Manual → Audit Cap → Audit Coverage → Gap (if applicable) →
        RC (if applicable) → SC family → Scope Status → Acceptance refs
```

`(EX)` = EXISTING_REUSE；`(IB)` = INTEGRATION_BACKED；未标注 = DOMAIN_OWNED。`—` 表示该 field 不适用 (例如 COVERED Audit Capability 无 Gap / RC)。

```text
Manual  | Audit Cap | Audit Cov. | Audit Gap       | RC      | SC family    | SC IDs
--------+-----------+------------+-----------------+---------+--------------+--------------------------------------------
B3102   | CAP-1     | PARTIAL    | GAP-SC-09       | RC-08   | Comm Found.  | SC01, SC02, SC03, SC04, SC05, SC06, SC07, SC08,
        |           |            |                 |         |              | SC26, SC27, SC31
B3102   | CAP-2     | MISSING    | GAP-SC-01       | RC-01   | Quotation    | SC09, SC10, SC11, SC12, SC13, SC14
B3102   | CAP-3     | COVERED    | —               | —       | SO Header    | SC24 (EX)
B3102   | CAP-4     | COVERED    | —               | —       | SO Snapshot  | SC20 + SC25 + SC28 [price snapshot] (EX)
B3102   | CAP-5     | COVERED    | —               | —       | SO Snapshot  | SC25 + SC28 [UoM snapshot] (EX)
B3102   | CAP-6     | MISSING    | GAP-SC-15       | RC-24   | SO Terms     | SC27, SC28 [commercial tax-basis assumption]
B3102   | CAP-7     | MISSING    | GAP-SC-16       | RC-07   | OTD          | SC21, SC22, SC23 [order-line discount snapshot]
B3102   | CAP-8     | PARTIAL    | GAP-SC-09       | RC-08   | SO Parties   | SC26 (+ SC02..SC07)
B3102   | CAP-9     | MISSING    | GAP-SC-10       | RC-09   | SO Gift      | SC29
B3102   | CAP-10    | COVERED    | —               | —       | SO Status    | SC33, SC34, SC35 (EX)
B3102   | CAP-11    | MISSING    | GAP-SC-02       | RC-02   | SO Change    | SC37, SC38, SC39, SC40
B3102   | CAP-12    | MISSING    | GAP-SC-12       | RC-22   | SO Fulfill   | SC41, SC42, SC43, SC44
B3102   | CAP-13    | MISSING    | GAP-SC-11       | RC-10   | Prepay       | SC62, SC63, SC64, SC65
B3102   | CAP-14    | MISSING    | GAP-SC-03       | RC-03   | Delivery Nt  | SC45, SC46, SC47, SC48
B3102   | CAP-15    | COVERED    | —               | —       | Sales Deliv. | SC49, SC50, SC52, SC53 (EX) + SC51 (IB adapter)
B3102   | CAP-16    | COVERED    | —               | —       | SD OQC       | SC51 (IB adapter)
B3102   | CAP-17    | COVERED    | —               | —       | Return       | SC54 (EX)
B3102   | CAP-18    | MISSING    | GAP-SC-04       | RC-23   | Return       | SC55, SC57
B3102   | CAP-19    | MISSING    | GAP-SC-06       | RC-05   | Return       | SC56, SC57
B3102   | CAP-20    | MISSING    | GAP-SC-05       | RC-04   | Replacement  | SC59, SC60, SC61
B3102   | CAP-21    | MISSING    | GAP-SC-07       | RC-06   | Pricing      | SC15, SC16, SC17, SC18, SC19, SC20
B3102   | CAP-22    | MISSING    | GAP-SC-08 + 16  | RC-07   | OTD          | SC21, SC22, SC23
B3102   | CAP-23    | COVERED    | —               | —       | (consume M14 | sales-discounts route / discounts.js
        |           |            |                 |         |  EX)         | module; not in SC numbering)
B3102   | CAP-24    | PARTIAL    | (bounded)       | (EX+new)| Reservation  | SC32, SC66, SC67, SC68
B3102   | CAP-25    | MISSING    | GAP-SC-14       | RC-12   | Consignment  | SC72, SC73, SC74, SC75, SC76, SC77
B3102   | CAP-26    | MISSING    | GAP-SC-13       | RC-11   | Service Item | SC69, SC70 + SC71 (IB adapter)
B3102   | CAP-27    | COVERED    | —               | —       | Reporting    | SC78, SC79, SC80, SC81 (SC79 EX)
B3103   | CAP-28    | MISSING    | GAP-SC-17       | RC-13   | Credit Param | SC83, SC84
B3103   | CAP-29    | MISSING    | GAP-SC-18       | RC-14   | Credit Rules | SC85, SC86
B3103   | CAP-30    | MISSING    | GAP-SC-19       | RC-15   | Credit Prof. | SC87, SC88, SC89
B3103   | CAP-31    | MISSING    | GAP-SC-20       | RC-16   | Credit Occ.  | SC82 (foundation) + SC90, SC91, SC92
B3103   | CAP-32    | MISSING    | GAP-SC-21       | RC-17   | Credit Check | SC93, SC94, SC95
B3103   | CAP-33    | MISSING    | GAP-SC-22       | RC-18   | Special Appr | SC96, SC97, SC98
B3103   | CAP-34    | MISSING    | GAP-SC-23       | RC-19   | Recalc       | SC99, SC100
B3103   | CAP-35    | MISSING    | GAP-SC-24       | RC-20   | Query        | SC101, SC102
B3103   | CAP-36    | MISSING    | GAP-SC-25       | RC-21   | Evaluation   | SC103, SC104, SC105, SC106, SC107
```

> 注：Permissions / SOD (SC108..SC114) **不是** Audit Capability。是 Requirement-derived cross-cutting capability family，单独在 `§34.13.2 SC Acceptance Coverage Validation` 与 `§34.8` cross-domain row 17 中处理。
> Audit 36 capability 与本节 114 SC capability 之间非 1:1；某些 SC 同时承担多个 audit capability（如 SC26 横跨 CAP-1 / CAP-8；SC27 / SC28 横跨 CAP-4 / CAP-6 / CAP-7）。
> 任何 audit capability 没有 SC 覆盖即为 orphan。→ 当前表所有 36 audit capability 均被覆盖。

#### 34.13.1 SC Acceptance Coverage Validation (per §11 acceptance refs)

每条 SC capability 至少 reference 一条 acceptance（Functional UAT / Race / Structural-RBAC assertion）：

```text
SC01           → UAT-S-28 (SYSTEM / DOCUMENT_TYPE parameters + feature enables)
                 + UAT-S-15 (order-change mode) + UAT-S-17..18 (delivery controls)
                 + UAT-S-24 (reservation behavior) + §34.7 Permission
SC02..SC05,SC07 → UAT-S-28 (Customer Commercial Extensions / xref / sellable scope)
SC06           → UAT-S-28 (identity + multi-group/default) + UAT-S-10 (SO group snapshot)
                 + UAT-S-44 (backend group data scope)
SC08           → UAT-S-28 (commercial defaults) + UAT-S-05 (Sales/Pricing UoM conversion)
                 + UAT-S-17..18 (tolerance snapshot + DN/SD enforcement)
SC09..SC14    → UAT-S-01..03 (Quotation lifecycle + conversion)
SC15..SC20    → UAT-S-04..08 (Pricing + override + snapshot) + R-SAL-11
SC21..SC23    → UAT-S-09 (Order-Time Discount) + UAT-S-07 (override)
SC24..SC29,SC31..SC36 → UAT-S-10..16 (parties/gift/tax-terms/submit/change/fulfill) + UAT-S-39
                + R-SAL-07..R-SAL-08 (SO Change race)
SC30           → UAT-S-17..18 (planned date + upper/lower tolerance snapshot and execution)
SC27..SC28     → UAT-S-42 (commercial terms/tax-basis snapshot is not statutory invoice truth)
SC29           → UAT-S-43 (gift-line revenue zero does not erase COGS)
SC37..SC40    → UAT-S-15 (SO Change) + R-SAL-07..R-SAL-08..R-SAL-18..R-SAL-19
SC41..SC44    → UAT-S-16 (Fulfillment / partial / close / cancel)
SC45..SC48    → UAT-S-17 (Delivery Notice capacity) + R-SAL-16..R-SAL-19
SC49..SC53    → UAT-S-18 (Sales Delivery Confirm) + R-SAL-01, R-SAL-05, R-SAL-17
SC54..SC58    → UAT-S-19..21 (3-Return modes + Option A positive valuation/accounting matrix + Option C Restricted Economic Reversal matrix) + R-SAL-03, R-SAL-09, R-SAL-10
SC59..SC61    → UAT-S-22 (Replacement) + R-SAL-10
SC62..SC65    → UAT-S-23 (Prepayment Gate) + R-SAL-15
SC66..SC68    → UAT-S-24 (Reservation Intent) + UAT-S-40 + R-SAL-02 (consume only)
SC69..SC71    → UAT-S-25 (Service Item) + R-SAL-22
SC72..SC77    → UAT-S-26..27 (Consignment) + UAT-S-41 + R-SAL-20, R-SAL-21
SC78..SC81    → UAT-S-37 (Reporting - execution surface)
                + UAT-S-38 (Reporting - outstanding + gross profit + ranking dimensions)
SC82..SC107   → UAT-S-29..36 (Credit family)
                + R-SAL-04, R-SAL-12, R-SAL-13, R-SAL-14, R-SAL-23, R-SAL-24
SC108..SC114  → UAT-S-44 (Permission / RBAC / SOD) + §34.7 P1..P5 principles
```

Race coverage (concurrency acceptance):
  R-SAL-01..R-SAL-24 each IS its own concurrency acceptance entry.
  Functional UAT 不 aggregate races into one UAT ID; UAT-S-38 is a real Sales Reporting functional UAT, NOT a race-aggregation slot.

> No orphan SC ID.

#### 34.13.2 Permissions / SOD Cross-Cutting Coverage Validation

`SC108..SC114` (Permissions / RBAC / SOD) 是 Requirement-derived cross-cutting capability family，**不**算 Audit Capability (CAP-1..CAP-36)；它们覆盖 `§34.7 P1..P5` 五大原则 (VIEW ≠ WRITE / CREATE ≠ APPROVE / PRICE OVERRIDE 单独 authority / CREDIT SPECIAL APPROVAL bounded / AUDIT 不跳过)，并通过 UAT-S-44 + Race 不可绕过。Audit CAP trace 不因此失配。

#### 34.13.3 Frozen Audit CAP Trace 36/36 Validation

```text
expected Audit capabilities  = 36   (CAP-1..CAP-36)
traced Audit capabilities    = 36
missing                      = 0
unmapped                     = 0
conflicting duplicate trace  = 0
orphan trace row             = 0
CAP-1..CAP-36 → SC mapping    = all present (§34.13 main table)

Permissions / SOD family (SC108..SC114) is Requirement-derived cross-cutting,
NOT counted as Audit CAP. Audit CAP trace remains exactly 36/36; the
§34.13 main table contains 36 CAP rows + 1 separate note row for Permissions
clarification. The Permissions row is NOT counted toward the Audit 36/36.
```

### 34.14 最终接受状态

本节 Requirement 包含：

```text
Capability Catalogue          = 114    (SC01..SC114)
DOMAIN_OWNED                 = 100
INTEGRATION_BACKED           =   3    (SC51, SC58, SC71 — adapters from frozen Domain)
EXISTING_REUSE               =  11    (SC24, SC25, SC33, SC34, SC35, SC36,
                                       SC49, SC52, SC53, SC54, SC79)
OUT_OF_SCOPE                 =   0

  Note: OUT_OF_SCOPE = 0 means zero SC capability IDs are classified OUT_OF_SCOPE
  in this domain closure. §34.10 still defines product-scope exclusions that
  intentionally have no SC ID (multi-currency, external credit bureau, AI/ML,
  CRM extensions, Generic Workflow implementation itself, etc). No dummy SC IDs
  are created for excluded products; this statement and §34.10 are NOT contradictory.

Business Invariants          = 20     (S01..S20; single namespace)

Frozen Functional Sales UAT  = 44     (UAT-S-01..UAT-S-44)
  - 43 functional/business UAT
  - 0 race-aggregation UAT (race acceptance is per-R-SAL-N)

Sales MySQL Races            = 24     (R-SAL-01..R-SAL-24)
  REAL                       =   5    (R-SAL-01..05)
  DORMANT (audit)            =  10    (R-SAL-06..15)
  DORMANT (new business)     =   7    (R-SAL-16..22)
  CONDITIONAL                =   1    (R-SAL-23, when persisted cache rebuild exists)
  DORMANT (policy-snapshot)  =   1    (R-SAL-24)
  No subsumed Race ID

Permissions / RBAC / SOD principles = 5   (P1..P5)

Cross-Domain Boundary families    = 15
Hard Stop Conditions               = 20
```

Sum checks:

```text
100 + 3 + 11 + 0 = 114  ✓
5 + 10 + 7 + 1 + 1 = 24  ✓
24 Race IDs enumerated; 0 missing; 0 duplicate
36 Audit CAP-1..CAP-36 enumerated; 0 missing; 0 unmapped; 0 conflicting duplicate
44 UAT IDs enumerated; 0 missing; 0 duplicate
114 SC IDs enumerated; 0 missing; 0 orphan (per §34.13.1)
20 Invariant IDs enumerated (S01..S20); 0 missing; 0 duplicate
```

本节有限重开的 Requirement 与 frozen audit (Capabilities 36, COVERED 9, PARTIAL 3, MISSING 24, Gaps 25, RCs 24, Races 15) 保持结构对齐：每个 audit MISSING / PARTIAL capability 至少被一条 SC capability + 一条 invariant 覆盖；每条 SC capability 至少被一条 acceptance reference 覆盖（Functional UAT / Race / RBAC assertion）；每个 RC 至少被一条 SC family 引用。DR-SAL-01 Option A 已获用户批准，SC37..SC40 与 UAT-S-15 的 Requirement 决策缺口已闭合。外部评审已 PASS，用户 Freeze approval 已确认，本节 Requirement 正式 `PASS / FROZEN`。

Official Freeze Record（2026-10-14）：

```text
SALES & CUSTOMER DOMAIN

REQUIREMENT: PASS / FROZEN
TECHNICAL DESIGN: PASS / FROZEN
IMPLEMENTATION WAVE PLAN: PASS / FROZEN

FREEZE CONTENT BASELINE:
5469891b78acb5b03940944698e5c51a38cf5491

EXTERNAL REVIEW: PASS
USER FREEZE APPROVAL: CONFIRMED

WAVE 0:
PASS / FROZEN
73abaa146c644df72d2c040af4c26548bf92e880

WAVES 1–13:
NOT IMPLEMENTED / NOT ACCEPTED

NEXT:
APPLY_GUIDE.md isolated forward correction,
then Sales Wave 1 implementation.
```

> Note：本节多次提到的 import / adapter 函数名称（`applyInventoryMutation` / `postTrackedMovement` / `assertStrongReservationAvailability` / `applyCreditAdjustment` / `generateVoucher`）均为 **[current implementation reference]**，仅作现状 evidence；不 prescribe 新模块 / 新函数 / 新 migration。Design 决定 persistent storage / cache / view / table choice 与本节 capability 商业语义的行为一致性。

下游 Design / Wave Plan 见 `solution.md §29–§30`，现均已 `PASS / FROZEN`。Waves 1–13 尚未实施、尚未验收；下一步顺序为先完成 `APPLY_GUIDE.md` 隔离前向纠偏，再按独立授权进入 Sales Wave 1 implementation。

### 34.15 Limited Reopen Decision Records

#### DR-SAL-01 — Sales Order change mode (`OPTION A APPROVED`, FROZEN)

- Manual / repository baseline：订单批准后允许“受控直接变更”或“变更单/工作流”，两者均须保留历史。
- 用户决策：正式批准 Option A，固定为 `DISABLED / CONTROLLED_DIRECT / CONTROLLED_DOCUMENT / BOTH`。
- 两种合法路径共用 canonical application service；受控直接路径也创建 append-only evidence，并执行 before/after、reason、requester/approver/application actor、approval/effective-version/audit。
- `BOTH` 只表示两条入口都可用，不是 approval、permission、SOD、idempotency、concurrency 或 invariant bypass。
- 决策影响：A-65 enum、SC01、SC35、SC37..SC40、UAT-S-15 与 Wave 4 合同已同步；不新增 SC/UAT/Race/table/field ID。

#### DR-SAL-02 — Customer-material multiplicity (`DESIGN_DECISION`, FROZEN)

不采用全局一对一收紧；允许同一客户料号在相同业务日期存在多个适用内部物料候选。系统不自动猜测：操作员显式选择 `product_id` 后，后端验证 customer、code、product 与 business date 的 effective mapping；仍不唯一或无匹配则 BLOCK。故不存在 intentional bounded deviation，也不需要用 xref 替代 Sellable Scope。

#### DR-SAL-03 — Reservation behavior (`DESIGN_DECISION`, FROZEN)

Requirement 固定为 `DISABLED / INVENTORY_LOCK / MANUAL_RESERVATION / ON_HAND_RESERVATION / EXPECTED_SUPPLY_RESERVATION` 五种行为；DOCUMENT_TYPE 可完整覆盖 SYSTEM row。Inventory lock 使用 Inventory canonical truth；后三种 reservation 使用 Planning canonical truth。现有 Planning `EXPECTED` 没有有限容量权威来源，登记 `BOUNDED INTEGRATION CONTRACT EXTENSION REQUIRED`，未完成扩展前该模式 backend fail closed。

#### DR-SAL-04 — Wave 6 SO_BACKED / NO_SOURCE valuation and accounting (`OPTION A APPROVED`, REQUIREMENT REOPEN)

- Approval Date：2026-10-16；Scope：Wave 6 SC55 / SC56 / SC58 相关估值与会计处理；Approved Option：A；User Decision：`CONFIRMED`。
- Accounting Counterpart：现有 `INVENTORY_GAIN_LOSS`；借方为 `inventoryAccountRole(product_id)` 解析的实际存货资产科目；使用既有 canonical voucher writer 并保持借贷平衡。
- Valuation Priority（由 2026-10-17 bounded correction 有界覆盖）：MOVING_AVERAGE 使用同 product/warehouse 正数权威池；LOT 使用同 product/warehouse/LOT 正数 carrying-value pool；SERIAL 必须使用唯一匹配的 authoritative original outbound valuation evidence，不得要求 positive same-serial in-stock pool。原 approved/frozen/effective standard-cost 候选仅保留于 SO_BACKED 非 SERIAL 且既有权威合同可证明的场景；NO_SOURCE 禁止自动 standard-cost fallback；证据不能证明时 HTTP 409。
- Forbidden Basis：`LEGACY_UNVALUED`、zero/default zero、manual/client cost、SO/Quotation price、fake Delivery cost、跨身份 pool、未批准 deferred valuation 或虚构 Finance evidence。
- Finance AR Basis Independence：库存估值不推导 AR；Credit Adjustment 仅在独立、真实、匹配且合同允许的 Finance-owned authoritative AR/Open Item basis 存在时执行。
- Transaction Rollback：前置、收货、容量、追踪、估值、期间、凭证、审计与幂等处于同一受保护合同；任一失败零业务成功副作用，重试不得重复经济效果。
- Governance：不新增 SC / Invariant / UAT / Race ID，不改变跨域 owner，不改变 DELIVERY_BACKED、Batch A 或 Replacement；后续 Design 与 Implementation 均等待独立 gate。

2026-10-14 的全域 Freeze Record 与 2026-10-16 DR-SAL-04 继续作为历史基线;DR-SAL-04 已于 2026-10-16 接收并冻结，不重复开启;DR-SAL-05 是当前唯一有界 Requirement 增量，§34 其余合同保持冻结。

#### DR-SAL-05 — Wave 6 SO_BACKED / NO_SOURCE Restricted Economic Reversal (`OPTION C APPROVED`, REQUIREMENT REOPEN)

- Approval Date：2026-10-17；Scope：Wave 6 SC55 / SC56 / SC58 已确认 Sales Return 在 Option A Confirm 之上的受限整单反向经济操作;Approved Option：C；User Decision：`CONFIRMED`。
- Reversal Availability：仅允许 Full Return Reversal;本阶段不支持部分冲销。冲销 ≠ 删除 / 取消 / 改写历史;原始 Return 与其历史入库估值、凭证事实全部保留;新产生独立、可审计的 `SALES_RETURN_REVERSAL` Reversal Evidence。
- Replacement Dependency Gate (Gate-A):
  - A.1 无关联 Replacement obligation → 通过 Gate-A。
  - A.2 存在 ACTIVE 且尚未履行的 Replacement(`sales_order_replacements.cancellation_state='ACTIVE'` 且 effective fulfilled qty < replacement_quantity) → 用户必须先通过正规业务流程取消剩余补货义务;未处理时冲销返回 HTTP 409。
  - A.3 存在已确认的 Replacement Fulfillment Evidence(`sales_replacement_fulfillments` 行) → HTTP 409，整体回滚;不得删除 fulfillment link;不得改写已确认 Delivery;不得伪造 Delivery reversal;不得将已履行数量改写为零;不得静默恢复原 SO executed history。
  - 判断必须基于 canonical fulfillment evidence(`sales_replacement_fulfillments` ↔ `return_order_items.id` 真实 join)，不得仅使用 header 可编辑 lifecycle 字段。
- Downstream Consumption Gate (Gate-B)：仅以 `current_inventory_quantity ≥ return_quantity` 不构成通过依据。必须以 canonical evidence 严格证明 product / warehouse / bin 及适用 LOT/SERIAL identity、原始 Return POSTED 正数 valuation movement 完整且未反向、当前 quantity/value 足够，并且 issuance / transfer / consumption / reservation / hold 等 downstream dependency 未破坏精确反转。MOVING_AVERAGE 沿用 shared-pool strict negative-movement proof。LOT 使用 conservative no-subsequent-negative-movement fence：不得再要求 aggregate LOT balance quantity/value 等于原始 Return movement；必须证明原 Return movement 之后同 product/warehouse/LOT authoritative consumption domain 没有任何负 movement，并在 transaction 锁内重读足额 balance 与所有 dependency。SERIAL 使用 authoritative original outbound + Return restore provenance，要求本次 restored unit 仍唯一完整且未被消费/转移/反向。禁止推断标准成本、当前/历史平均成本或仅按余额推测原值；无法严格证明则 HTTP 409、整体回滚。
- Original Valuation + Voucher Reverse (Gate-C):
  - 锁定并精确反向 `inventory_valuation_movements`(实 movement identity + 实 inventory_transaction_id + 原始 basis);不得引入 LEGACY_UNVALUED / 任意零值 / 客户手工值 / SO 或 Quotation 售价 / 假 Delivery 历史 COGS / 跨身份 pool。
  - 精确反向 `SALES_RETURN` 系统凭证(实 voucher identity + 实 entry direction swap + 实 original entry amount cents + 实 original subjects + 借贷严格平衡)。
  - 禁止 `return_quantity × sales_unit_price` 作为 Inventory Valuation Reversal 金额。禁止将同一商业金额重复分配到多个原始 entry。
  - 全部通过 Finance / Accounting canonical writer，并强制带 reversal source link、idempotency、period gate。
- Finance Credit Independence (Gate-D):无 Credit Adjustment 的合法 Option A Return 不再被永久阻断;不要求虚构 Credit;不写 Credit Reversal Component;不访问不存在 target Open Item;不调用虚假 AR refresh;仅执行合法 Inventory / Valuation / Voucher reverse。若真实 Credit 存在:必须识别真实 `financial_credit_adjustments` 行;必须检查下游 application / refund consumption;必须使用 Finance canonical reversal;必须与本次 Return Reversal 共享同一受保护 transaction;不允许仅删除 Credit 行;无法合法反向 → HTTP 409，整体回滚。
- Atomicity:同一受保护 canonical transaction contract 内一致执行 Mode/Status 校验 → Original source 验证 → Replacement Dependency 验证 → Downstream Consumption 验证 → Inventory / LOT-SERIAL 锁 → Original valuation movement 锁 → 可选 Finance Credit 锁 → Reversal Evidence 写 → Inventory OUT → Valuation reverse → Voucher reverse → 可选 Credit reverse → Idempotency → Audit success。任一 gate / lock / writer / validation 失败整体回滚，原始 Return 状态、物理、估值、AR、凭证、AR Credit、成功审计、成功幂等证据不变;并发竞争在持有必要锁后重新校验，只能产生合法序列化结果。
- Idempotency Addendum：Option C Reverse 的 client-supplied `Idempotency-Key` 必填，缺失 HTTP 400，server 禁止随机生成。scope 为 `(SALES_RETURN_REVERSAL_OPTION_C, returnId, clientKey)`；同 key + 等价 canonical payload replay 已记录结果且不重复任何业务/经济/audit 效果；同 key + 冲突 payload HTTP 409。幂等 record 与 Inventory、traceability、valuation、voucher、可选 Credit、单一 success audit 同 transaction 原子提交或整体回滚。本条只适用于 `SO_BACKED` / `NO_SOURCE` Option C Reverse。
- DELIVERY_BACKED Compatibility:DELIVERY_BACKED 既有 Confirm 与既有 `reverseOperationalReturn()` 行为受保护，不在本 Option C 范围内被改写;Batch A 已验收语义不变。如现有 DELIVERY_BACKED reverse 与冻结 Inventory / Finance 安全不变量存在既有问题，应在后续各自受控任务中记录证据与影响并提出受控处理建议;未经批准不得改写冻结实现。
- Governance:不新增 SC / Invariant / UAT / Race / Audit Capability ID;UAT-S-19..22 既有 matrix 即承担 Option C 验收(§34.5 新增 Case 13–23);R-SAL-09 / R-SAL-10 既有 race 即承担相关约束(§34.6 澄清);不改变跨域 owner;不改变 Option A 已批准 contract(§29.13 / §30.29);不改变 Replacement immutable fulfillment evidence(§29.14);不改变 SC54 DELIVERY_BACKED 既有 reverse 路径。SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36 计数维持不变。

DR-SAL-05 已由用户于 2026-10-17 接受并作为历史 Option C baseline。随后发现的 Option A–Option C LOT/SERIAL 组合矛盾由下述同日 bounded superseding correction 处理；§34 其余合同保持冻结，不能据此宣称 Wave 6 已完成或自动恢复 Implementation。

#### DR-SAL-04 / DR-SAL-05 — LOT/SERIAL bounded superseding correction (`R1–R4 APPROVED`, REQUIREMENT REOPEN)

- Approval Date：2026-10-17；Scope：仅 SC55 / SC56 / SC58、UAT-S-20 / UAT-S-21 及 DR-SAL-04/05 中 LOT/SERIAL valuation provenance 与 Gate-B；User Decisions：R1–R4 `CONFIRMED`。
- Original Contradiction：Option A 要求 LOT/SERIAL 使用同身份既有正池并把 Return `+q/+v` 加入该池；原 Option C 对 LOT/SERIAL 又要求确认后 aggregate pool `== q/v`。LOT 在 `Q0>0,V0>0` 下必有 `Q1=Q0+q>q,V1=V0+v>v`；SERIAL 还会把 q=1 的 restored unit 加到 positive same-serial pool，违反 serial 唯一数量。上述 aggregate-equality / positive-same-serial 组合条款被本记录明确 supersede，不再是 active requirement。
- R1 LOT：采用 conservative no-subsequent-negative-movement fence。要求精确原 Return valuation movement、未反向 quantity/value、足额当前 balance、Return 后同 LOT authoritative consumption domain 零负 movement、reservation/hold/transfer/其它依赖显式通过、transaction 内锁定重读与并发安全；余额本身不能证明未消费；本次不引入通用 inventory layer allocation。
- R2 SERIAL：valuation authority 固定为唯一匹配的 original outbound valuation evidence。Confirm 前 serial 必须处于合法 returned-from-outbound lifecycle 且没有 active in-stock duplicate；验证 quantity=1、value、identity、outbound/restore reversal history；Confirm 精确恢复一单位，Reverse 仅在该 restored unit 仍完整且全部 dependency 通过时移除。positive same-serial pool、销售收入、标准成本与当前成本均不得替代。
- R3 NO_SOURCE：商业来源与 valuation provenance 分离。NO_SOURCE 可引用独立 authoritative Inventory outbound valuation evidence，但始终保持 NO_SOURCE 商业身份和既有商业金额合同，不得转成 SO_BACKED/DELIVERY_BACKED；无 eligible evidence 则 fail closed；禁止自动 standard-cost / LEGACY_UNVALUED fallback。
- R4 Legacy：仅允许唯一确定的 canonical historical provenance；禁止 synthetic outbound、从 current pool balance 推断、current-cost reconstruction 或 migration-time 猜测。歧义/不完整历史 HTTP 409；任何 remediation/backfill workflow 需未来单独授权。
- Cross-cutting：Confirm eligibility、physical/tracking mutation、valuation mutation、Reverse evidence、downstream proof、period、RBAC、audit、idempotency、rollback 与 concurrency 必须保持单一受保护 transaction contract。SQLite/MySQL 行为同义；真实 MySQL 独立 session 必须覆盖 Confirm/Reverse/OUT 竞争。DELIVERY_BACKED、MOVING_AVERAGE 已验证语义、F5/F6、Replacement immutable fulfillment evidence、Batch A 与 Wave 7+ 均不在本 correction 中改变。
- Adjacent Drift Triage：A) `Idempotency-Key` owner clarification 已由 2026-10-17 final addendum 关闭：Option C Reverse 必须 client-supplied key，缺失 HTTP 400，随机 fallback 属 implementation compliance gap；B) NULL/unknown marker 已由 SC57“explicit, truthful and mutually exclusive”及 fail-closed contract 明确，进入 legacy reverse 属 implementation compliance gap，预期 HTTP 409 且零副作用；C) 本记录修正 DR-SAL-05 acceptance/footer 状态；D) successful SERIAL reversal acceptance evidence 必须在后续 Implementation Gate 补齐；E) Wave 6-specific MySQL independent-session concurrency evidence 必须在后续 Acceptance Gate 补齐。
- Governance：不新增 SC / Invariant / UAT / Race / Audit Capability ID，不修改 `solution.md`，不授权 source/schema/migration/test 改动。Requirement correction 完成后仅可进入独立 Design Gate；Wave 6 仍不得 PASS / Freeze。

#### DR-SAL-06 — Wave 7 Prepayment Gate + Reservation Intent Final Acceptance Contract (`ACCEPTANCE_GATE_REOPEN`, REQUIREMENT REOPEN, AWAITING USER CONFIRMATION)

- Approval Date：2026-10-18（用户在 Wave 7 Final Acceptance Closure 任务中明确授权重开 Requirement 与 Design；本记录为 Requirement 阶段单一增量）。
- Scope：仅 Wave 7 Final Acceptance 收口；§34.3.12（Prepayment Gate，SC62–SC65）、§34.3.13（Reservation Intent，SC66–SC68）、R-SAL-02、R-SAL-15、S12、S13、相关 invariant / UAT / Race 标识、计数与商业语义均不重写。Wave 6 已冻结合同（含 DR-SAL-04 / DR-SAL-05 / DR-SAL-04·05 LOT-SERIAL bounded superseding correction）保持 FROZEN；Wave 8–13 不进入本轮。
- Acknowledged State：Wave 7 实施相关源码、迁移、注册表、测试套件已经在仓库内；本轮承认以下三项不存在或已知状态：
  1. `pnpm.cmd test:mysql` 与 `pnpm.cmd test:mysql:concurrency` 两道真实 MySQL gate 在本仓库最近一次成功执行后尚未取得针对 Wave 7 新增表（`sales_prepayment_requirements` / `sales_prepayment_gate_results` / `sales_reservation_intent`）的新鲜、独立 disposable MySQL 实例证据；前次真实 MySQL 运行属 Wave 6 保护性 gate，对新表无源覆盖。
  2. Wave 7 实施中曾出现并已被修复的 MySQL bootstrap 表达式唯一索引 `null` 列问题（`server/database/mysql-schema.js` 的 `useDigest` / `hasExpressionColumns` / `mysqlIndexColumnList` / `generatedPartialIndex` 收紧），属于已记录实现级修复；后续仍需真实 MySQL gate 复现 PASS 才算关闭，不能凭 SQLite 或确定式 fixture 等价证明。
  3. 任务提示中所述 "`sales_prepayment_gate_results.source_balance_identities default`" 失败描述在仓库现有代码与最近日志证据链中未找到匹配根因；当前迁移 DDL（`source_balance_identities LONGTEXT NOT NULL DEFAULT ('[]')`）、MYSQL_COLUMN_CONTRACTS（`'[]'`）与 `normalizeDefault` 对 MySQL 8 已识别表示（`'[]'`、`_utf8mb4'[]'`、`('[]')`、`_utf8mb4('[]')`、带空格/双引号）已归一化到等价 `[]`；不得仅据历史失败描述直接修改默认值、迁移 DDL 或放宽断言；只有真实 MySQL gate 能复现契约冲突时，才允许提出对应的最小修复。
- Wave 7 Acceptance Contract（**A**，强制条款）：
  1. 已冻结商业语义不得重写：§34.3.12 / §34.3.13 商业文字、SC62–SC68 commercial meaning、S12 / S13 invariants、R-SAL-02 / R-SAL-15 race 编号、R-SAL-15 既有 §29.16.3.x 冻结作用域均不在本轮修改；本轮不接受以删除 / 放宽既有 assertion、修改测试期望、改写失败响应为成功响应、跳过 migration 或 DB contract 来制造 PASS。
  2. 限定验收测试范围，本轮按以下四款执行：
     2.1 本轮**唯一**获准执行的验收命令，仅以下两道真实 MySQL gate，且仅在使用户授权的 disposable database（`modern_erp_domain_test`，`ERP_DB_*` env + `ERP_MYSQL_TEST_ALLOW_RESET=true`）之上：
        - `pnpm.cmd test:mysql`（`scripts/gates/mysql-gate.mjs`，含 Wave 7 migration / metadata 套）；
        - `pnpm.cmd test:mysql:concurrency`（`scripts/gates/mysql-concurrency-gate.mjs`，含 Wave 7 concurrency suite 与 Wave 7 worker）；
        本轮禁止启动任何其它命令；显式禁止包括但不限于 `pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm test:all` / `pnpm build` / 任何其它 `pnpm test:*` 变体 / 任何直连数据库 / 任何 SQLite 重跑命令；Stage 1 内即便上述 SQLite focused suite 历史 PASS 已记录（见 2.2），其任何复跑在本 A.1 也视为未授权。
     2.2 既有 SQLite focused suite 的历史 PASS 证据可以保留，**但本轮不得重新执行**下列文件或其子集，除非用户在后续 Stage 2（Design）/ Stage 3（Implementation）/ Stage 4（Final Acceptance）任一阶段另行明确授权：
        - `server/sales-customer-wave7-migration.test.js`；
        - `server/sales-customer-wave7-functional.test.js`；
        - `server/sales-customer-wave7-acceptance.test.js`；
        - `server/database/mysql-schema-bug-fix.test.js`。
        任何重新执行此四套或其子集的命令（含 `pnpm.cmd test:fast` / `node --test <file>` / 任何 SQLite fixtures 触发的命令、`scripts/acceptance/sales-customer-wave7-responsive.mjs` 等浏览器 UAT 脚本、`scripts/acceptance/sales-customer-wave6-responsive.mjs`、`scripts/gates/mysql-functional-gate.mjs` 等任何已存在的 acceptance / gate）在本轮均视为未授权；其输出结果不能替代真实 MySQL gate 的 PASS。
     2.3 SQLite focused suite 的历史 PASS **不能替代真实 MySQL gate PASS**：Wave 7 Acceptance 是否满足下文 3.1 / 3.2 / 3.3（即 A.3 Pass Conditions 中的 C1 / C2 / C3）必须由 2.1 中两道真实 MySQL gate 的实际执行输出为准；本轮 SQLite focused 结果只能作为历史 evidence 与后续新增修复的 sanity 反向引用，不可被引用为 Acceptance PASS 来源；与下文 A.4.4（SQLite focused 与真实 MySQL evidence 之间语义差异时单独记录、不得用 SQLite PASS 弥补真实 MySQL PASS 缺失）一致。
     2.4 既有 SQLite focused suite 内的 assertion 与期望值在本轮**禁止删除、合并、跳过或放宽**；即便新增真实 MySQL gate 失败也不允许按此路径制造 PASS；最小修复与新回归测试必须保留全部既有 assertion（与 §34.15 governance 及下文 A.4.1 一致）。
  3. Pass Conditions（三条件必须同时满足；任一未满足 = NOT PASS / TEST_EVIDENCE_PENDING）：
     - C1：迁移契约 — `sales_prepayment_requirements` / `sales_prepayment_gate_results` / `sales_reservation_intent` 三表在 fresh bootstrap、existing database upgrade、`pnpm.cmd test:mysql` 再次 spawn 的 idempotent rerun 三种路径下，全部满足 PK / FK / CHECK / UNIQUE / default / precision 契约，且 `sales_prepayment_gate_results.source_balance_identities` 与 `sales_reservation_intent.intent_state` 等字符串 default 在 MySQL 8 真实 `COLUMN_DEFAULT` 输出下能通过 `assertMySqlColumnContracts` + `normalizeDefault` 等价匹配；如出现失败，必须附 `information_schema.COLUMNS.COLUMN_DEFAULT` 实际输出文本作为证据。
     - C2：业务唯一性 + 完整性 — `qty_sales_reservation_intent_order_line_mode`（`COALESCE(sales_order_item_id,'')`）唯一索引在 fresh 与 existing 两路径下幂等存在；重复 normalized intent identity 触发 fail-closed；reservation 写入 `inventory_locks` 或 `planning_reservations` 均经过 `planning-domain.js` canonical adapter，不出现 Sales 影子余额。
     - C3：并发不变量 — `pnpm.cmd test:mysql:concurrency` 9 套（含 Wave 7 concurrency suite 与 Wave 7 worker）全部 PASS，并独立验证下列不变量：
        - 同一 `sales_order_id` 在 PLANNING_RELEASE / RESERVATION / DELIVERY 三阶段间不出现超额放行（eligible 余额 ≥ required 时单 PASS 同时 PASS，过期余额或冲销后重新校验形成 409 而非绕过）；
        - 同一 `planning_reservation` / `inventory_lock` 在两个真实 MySQL 会话同时消费时合并消耗 ≤ 授权量；
        - R-SAL-15 Finance mutation（`applyUnappliedBalance` / `createRefund` / `reverseSettlementDocument UNAPPLIED`）与 Sales locked-read 串行化在同一 canonical `settlement_unapplied_balances.id`（balance_type='PREPAYMENT'）lock chain 上，不出现重复 advance ledger；
        - 失败后 Gate / intent / planning / lock / audit / idempotency record 同时回滚或保持初始态，无 partial side effects；
        - 不得以 SQLite focused PASS 或单线程测试替代上述独立 session 证据。
  4. Failure Branching：以下任一发生即视为本轮**未通过**，必须立即停止后续动作：
     - 任一道 gate 失败：保留完整原始 stderr / stdout / 截屏输出；定位到具体断言 / SQL / errno / 不变量；区分实现缺陷、迁移契约缺口、测试期望错误、gate 自身 reset 守卫问题四类，按 §34.15 governance 禁止以删除 assertion / 放宽 default / 跳过 migration 凑出 PASS；只允许提出**最小修复**并附新回归测试，重跑后仍须保留全部既有断言。
     - 失败实在反映新发现但与既有 §34 商业语义冲突：本轮立即停止并在 `log/2026-10-18.md` 记录 `REQUIREMENT_REOPEN_REQUIRED`；不经用户单独批准不得进入 Design 或 Implementation；不得宣称 Wave 7 Acceptance PASS。
     - gate 输出 `MYSQL TEST ENVIRONMENT = UNAVAILABLE` 或 gate-level reset 失败：本轮视为 TEST_EVIDENCE_PENDING 而非 PASS，不宣称 ACCEPTANCE / FROZEN。
     - 任一 forensic 阶段发现 SQLite focused suite 与真实 MySQL evidence 之间语义差异：单独记录，不得用 SQLite PASS 弥补真实 MySQL PASS 缺失。
  5. Stop Conditions（任一触发立即停止本轮）：
     - HEAD 与审计报告基线（`0d4e4b8a0b71d43551072349b55f494d9a439b53`）偏离；
     - 工作区 tracked file 出现非本轮授权的差异；
     - 未授权修改 `APPLY_GUIDE.md` / `README.md` / `AGENTS.md` / `CLAUDE.md` / `package.json` / release tag；
     - 删除、跳过或放宽任何已 PASS 的 SQLite focused assertion；
     - 出现 SQLite PASS 被代替或被声明为真实 MySQL PASS；
     - 出现异常被改为成功响应、缺少新增 evidence 即宣称 Wave 7 Acceptance PASS 或 FROZEN。
- Approved Action：本轮 Requirement 阶段只允许做：(a) 编写 `log/2026-10-18.md` append-only 段，记录本 DR-SAL-06 文本与本次 Requirement Closure Report；(b) 按本 addendum 定义的 Acceptance Contract 进入 Design 阶段，禁止删除 / 改写既有 §34.3.12 / §34.3.13 / DR-SAL-04 / DR-SAL-05 / 任何已冻结 SC / UAT / Race；(c) 不得启动 Implementation，不得触动 `document.md` 其它章节、`solution.md`、`server/`、`src/`、`scripts/`、`scripts/gates/`、`server/migrations/`、`server/database/`、任何已有 sqlite 测试或仓库自动产出物。
- Governance：本轮不新增 SC / Invariant / UAT / Race / Audit Capability ID，不引入第二个 reservation ledger 或第二个 advance-receipt ledger，不修改 Wave 6 / DR-SAL-01..05 任何章节。本 addendum 不修改 §34 已冻结合同；它把 Wave 7 Final Acceptance 升级为单独 Acceptance Gate，验证证据齐备前 Wave 7 仍 `NOT ACCEPTED / NOT FROZEN`。任何与本 addendum 矛盾的"Wave 7 已 PASS / FROZEN" 声明无效除非 (i) 本 DR-SAL-06 仍保留 acceptance contract、(ii) 三项 Pass Conditions 均同时由真实 MySQL gate 证据满足、(iii) 用户在最终验收报告后单独明确批准。

---

**SALES & CUSTOMER DOMAIN REQUIREMENT — HISTORICAL BASELINE FROZEN @ `5469891b78acb5b03940944698e5c51a38cf5491`; DR-SAL-04 ACCEPTED (2026-10-16); DR-SAL-05 ACCEPTED (2026-10-17); LOT/SERIAL R1–R4 + OPTION C EXPLICIT IDEMPOTENCY-KEY REQUIREMENT FULLY CLOSED (2026-10-17), AWAITING DESIGN AUTHORIZATION**

**WAVE 6 IMPLEMENTATION ACCEPTANCE & FREEZE STATUS (2026-10-18) — USER APPROVED:** Wave 6 implementation (Sales Return Confirmation DR-SAL-04 Option A for SO_BACKED / NO_SOURCE, Sales Return Restricted Economic Reversal DR-SAL-05 Option C, LOT conservative fence R1, SERIAL outbound provenance R2, immutable provenance carrier R3, legacy fail-closed R4, mandatory explicit Idempotency-Key for Option C, Replacement lifecycle, three-mode commercial source distinction, NULL/unknown marker 409 SALES_RETURN_MARKER_UNKNOWN, F5 schema CHECK(amount_cents >= 0) relaxation, F6 cancellation_state 2-value migration, Wave 6 additive migration `sales_return_valuation_provenance` + supporting indexes) is `WAVE6_FINAL_ACCEPTANCE_PASS — FROZEN` on `feature/sales-waves6-13@aee1e0c13d26dd840ae4b596340212eef03479c0`, package `1.6.2`. The accepted working tree is unstaged and uncommitted; this is a Freeze record only, not a commit / push / tag / release. Detailed user final acceptance sign-off, matrix coverage and implementation location mapping are recorded in `solution.md §34.14` and `log/2026-10-18.md` Final Acceptance Record. No business Requirement in §34 was modified by this Freeze record; SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36 counts remain unchanged.

**WAVE 7 IMPLEMENTATION ACCEPTANCE & FREEZE STATUS (2026-10-19) — USER APPROVED:** Wave 7 implementation (Sales & Customer Finance V22 Prepayment Gate with `sales_prepayment_requirements` + `sales_prepayment_gate_results` carriers and the PrepaymentGates mobile-first surface; Sales & Customer Reservation Intent with `sales_reservation_intent` carrier and the ReservationIntents mobile-first surface; Wave 7 additive migration `server/migrations/sales-customer-wave7-prepayment-reservation.js` with SQLite `CREATE TABLE IF NOT EXISTS` + MySQL `assertMySqlColumnContracts` + `normalizeDefault` charset-prefix-with-escaped-quotes regex extension; two new contextual routes `sales-prepayment-gates` and `sales-reservation-intents` registered in `src/navigation/applicationRegistry.js`; Wave 7 MySQL migration / metadata integration test `server/mysql-sales-customer-wave7.integration.js` + Wave 7 independent-session concurrency suite `server/mysql-sales-customer-wave7-concurrency.integration.js` + Wave 7 worker `scripts/gates/mysql-concurrency-sales-wave7-worker.mjs`; minimal fixture repairs in `server/mysql-sales-customer-wave0.integration.js` / `server/mysql-sales-customer-wave1-upgrade.integration.js` removing the three Wave 7 carriers from `WAVE7_PLUS_SALES_TABLES` black-list and adding `'wave-7-prepayment-reservation'` to the Wave 1 upgrade expected migrations array; canonical 13-column inventory fixture repair in `server/mysql-sales-customer-wave7-concurrency.integration.js` reusing `computePositionKey` from `server/lib/inventory-position.js` to seed `(wave7-race-product, wave7-race-warehouse)` rows for subtests #2 / #3) is `WAVE7_FINAL_ACCEPTANCE_PASS — FROZEN` on `feature/sales-waves6-13@0d4e4b8a0b71d43551072349b55f494d9a439b53`, package `1.6.2`. The 8 accepted working-tree modifications (5 source/test + 2 canonical docs + 1 append-only log) are unstaged and uncommitted; this is a Freeze record only, not a commit / push / tag / release. Detailed user final acceptance sign-off, gate evidence, manual regression attestation, DR-SAL-06 §A.3.C1 / §A.3.C2 / §A.3.C3 satisfaction mapping and the disclosed TAP raw-log archive limitation are recorded in `solution.md §29.17.7.12` and `log/2026-10-19.md` Final Acceptance Closure Report. DR-SAL-06, §34.3.12 (SC62–SC65), §34.3.13 (SC66–SC68), R-SAL-02, R-SAL-15, S12, S13, the related Invariant / UAT / Race IDs and the Wave 6 freeze baseline above are preserved verbatim and are NOT modified by this Wave 7 record; SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36 counts remain unchanged. Wave 8–13 remain `OUT_OF_SCOPE` and are not authorized to start by this record. No `git add` / `git commit` / `git push` / `git merge` / `git rebase` / `git reset` / `git clean` / `git stash` / `git tag` / `git push --tags` / `release` / `deploy` / `package.json` / `APPLY_GUIDE.md` / `README.md` / `AGENTS.md` / `CLAUDE.md` change is authorized by this record; the accepted working tree at HEAD `0d4e4b8` remains unstaged and uncommitted, awaiting the user's separate manual Git handling.

---

**WAVE 8 STAGE B REQUIREMENT CLOSURE RECORD (2026-10-19) — STAGE B ONLY, AWAITING USER CONFIRMATION BEFORE STAGE C DESIGN.** Wave 8 (Service Fulfillment + Consignment commercial) is `WAVE8_STAGE_B_REQUIREMENT_CLOSURE_RECORDED — AWAITING_USER_CONFIRMATION` on `feature/sales-waves6-13@25e28b4103367d39c1573485ac05be04f3337924`, package `1.6.2`. This Record is **Requirement-only**, additive to §34, and preserves verbatim: every frozen §34.3.x sub-section, every frozen §34.4 invariant, every frozen §34.5 UAT, every frozen §34.6 Race (including R-SAL-20 / R-SAL-21 / R-SAL-22), every frozen §34.7 Permission principle, every frozen §34.8 cross-domain row, every frozen §34.10 Out-of-Scope boundary, the §34.13 traceability, the §34.14 freeze record, the §34.15 DR-SAL-04..06 records, the historical-baseline footer, the Wave 6 freeze footer, the Wave 7 freeze footer, SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36 counts, and the Wave 8–13 = OUT_OF_SCOPE baseline. No new SC / Invariant / UAT / Race / Audit Capability ID is introduced by this Record. No solution.md edit, no migration edit, no test edit, no schema edit, no §30 frozen-deps cell edit, no Git operation, no database operation, no test run is authorized by this Record. The §30.17 / §30.18 dependency-table fact discrepancy noted in the upstream Read-Only Audit is recorded below as a bounded Design-stage reconciliation item and is **not** silently resolved here.

#### Wave 8 Stage B — A. Scope and explicit out-of-scope boundaries

##### A.1 In scope for Wave 8 Stage B (Requirement Closure only)

1. Service Fulfillment (SC69–SC71) — three SCs already enumerated in `§34.3.14` and `§34.13.1`; the Requirement closure records the commercial contract that the eventual Design must satisfy, and bounds the gate integration with the existing Sales Delivery Confirm path without rewriting the frozen Wave 5 path.
2. Consignment commercial (SC72–SC77) — six SCs already enumerated in `§34.3.15` and `§34.13.1`; the Requirement closure records the three-truth (commercial / inventory / settlement) separation, the ENTERPRISE-ownership-during-consignment rule, the canonical capacity identity, and the consignment-vs-CUSTOMER-owned distinction.
3. Business invariants S08 (Service fulfillment ≠ Inventory movement) and S18 (Consignment location ≠ ownership ≠ settlement).
4. Frozen Functional UAT references UAT-S-25 (Service Item Sales), UAT-S-26 (Consignment Instruction + Settlement), UAT-S-27 (Consignment Return + Reporting), and UAT-S-41 (Consignment commercial three-layer distinction).
5. Frozen Sales MySQL races R-SAL-20, R-SAL-21, R-SAL-22 with their canonical lock identities.
6. Audit capabilities CAP-25 (Consignment) and CAP-26 (Service Item) — both currently flagged `MISSING` in `§34.13 main table` row-by-row against SC72–SC77 / SC69–SC70+SC71 respectively; the closure makes the audit-to-SC mapping explicit and bounded.
7. The four new tables named in the upstream user authorization: `service_fulfillments` (A-44), `consignment_commercial_documents` (A-45), `consignment_commercial_lines` (A-46), `consignment_commodity_locations` (A-47). No additional Wave 8 table is named by this Record.
8. The two planned backend modules named in the upstream user authorization: `service-fulfillment` and `consignment`. No additional Wave 8 module name is introduced by this Record.
9. The two Wave 8 mobile-first surfaces named in the upstream user authorization: `src/pages/consignment.jsx` and a contextual service-fulfillment sub-page registered under the existing Wave 7 Sales Order / Orders parentRoute. Launcher expansion is **out of scope** per UD-5.

##### A.2 Explicitly Out-of-Scope for Wave 8 Stage B

1. Any actual Design, Implementation, migration, test, registry, route, package, README, AGENTS, CLAUDE, APPLY_GUIDE, schema, gate, build, or database operation (per task §4).
2. Any new SC / Invariant / UAT / Race / Audit CAP identifier (per UD-4 #10); the canonical counts **SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36** are preserved unchanged.
3. Any modification to the frozen §34.3.14 or §34.3.15 sub-sections, including their textual wording, RACI annotations, footnote-style comments, IN_SCOPE / OUT_OF_SCOPE markers, or `[DOMAIN_OWNED]` / `[INTEGRATION_BACKED]` / `[EXISTING_REUSE]` markers.
4. Any modification to the Wave 5 / Wave 7 frozen Sales Delivery Confirm code path (`server/app.js` confirm route + Wave 7 prepayment gate integration). A later Wave 8 Design gate, if approved, may perform an explicitly bounded modification to that path **subject to a separately authorized Design-stage decision**, and is **not** authorized here.
5. Any addition of a Sales-owned shadow inventory ledger, a second Finance AR ledger, or any cross-domain schema change without a separately approved contract (per UD-4 #6).
6. Expansion of the Sales & Customer launcher entry count beyond what already exists in `src/navigation/applicationRegistry.js`; the Wave 12 global Mobile IA redesign is **out of scope** (per UD-5).
7. External bureau / AI / ML integration, multi-currency, multi-organization, bin-management, and any §34.10 product-scope exclusion (per `§34.10`). These are not Wave 8 scope, are not introduced by this closure, and require their own future Capability closures under their own separate authorization.
8. Wave 9 through Wave 13 (per UD-3 + §34 final-statement OUT_OF_SCOPE marker).

#### Wave 8 Stage B — B. Frozen traceability matrix (adjudicated against canonical §34)

##### B.1 Wave 1 SC69 (foundation) vs Wave 8 SC70..SC77

```text
SC69  Service-Type Commercial Item Identity
      (extends Master & Engineering Product 商业 classification)        [DOMAIN_OWNED]
      — already enumerated in §34.3.14, §34.13.1; foundation.
      — Wave 8 Stage B does NOT re-open SC69; the Wave 1 foundation
        (`product_commercial_classification` A-61, §29.18.0 of
        solution.md FROZEN Design) supplies the active sales-enabled /
        service-classification verification for any service-line write.
      — Wave 8 only constrains the SC69-anchored service-line reads that
        the Wave 8 Service Fulfillment Confirm gate will perform.

SC70  Service Sales Order Line + Service Fulfillment / Confirmation   [DOMAIN_OWNED]
      — already enumerated in §34.3.14, §34.13.1; Wave 8 SC.
      — capacity identity = sales_order_items.id (where
        product_commercial_classification.service_classification=TRUE).
      — Wave 8 introduces one additive carrier `service_fulfillments`
        (A-44) which DOES carry service confirmation facts only;
        sales_order_items is NOT rewritten.

SC71  Service Finance Recognition (no inventory OUT; AR / Revenue via
      Finance canonical adapter)                                       [INTEGRATION_BACKED]
      — already enumerated in §34.3.14, §34.13.1; Wave 8 SC.
      — same `[INTEGRATION_BACKED]` marker as SC51 / SC58; the Frozen
        Finance V22 recognition paths owned by Finance are unchanged.
      — Service Confirm must invoke them; it must not duplicate or
        fork them.

SC72  Consignment Instruction (commercial; Inventory position remains
      ENTERPRISE/seller-owned until settlement / title-transfer)       [DOMAIN_OWNED]
SC73  Consignment Location (commercial identity, ≠ physical warehouse)  [DOMAIN_OWNED]
SC74  Consigned Quantity Tracking + Ownership-Retention
      Commercial State                                                  [DOMAIN_OWNED]
SC75  Consignment Settlement Confirmation                               [DOMAIN_OWNED]
SC76  Consignment Commercial Return                                     [DOMAIN_OWNED]
SC77  Consignment Reporting                                             [DOMAIN_OWNED]
      — already enumerated in §34.3.15, §34.13.1; all six are
        Wave 8 SCs.
      — capacity identity = consignment_commercial_lines.id (R-SAL-20
        canonical lock identity — see B.3 below).
      — Wave 8 introduces three additive carriers:
        consignment_commercial_documents (A-45),
        consignment_commercial_lines (A-46),
        consignment_commodity_locations (A-47 — commercial location
        identity ≠ physical warehouse_id).
```

##### B.2 Frozen Business Invariants S08 + S18 traceability

```text
S08  Service fulfillment ≠ Inventory movement
     (no inventory OUT；SC70 / SC71)                                       — §34.4
     Wave 8 binding: any service-line Confirm path
     (i)  must not write inventory OUT, inventory decrement, or
          fabricated COGS;
     (ii) must invoke the Frozen Finance V22 canonical recognition
          adapter for AR/Revenue;
     (iii) must remain fail-closed when no eligible Finance evidence
          can be canonicalized.
     The Service Fulfillment Confirm gate does not invent a new
     recognition writer; it delegates to the SC71 INTEGRATION_BACKED
     adapter under the same §28 (Finance Operations) ownership that
     Wave 7 already uses.

S18  Consignment location ≠ ownership ≠ settlement
     (physical inventory ≠ commercial ownership ≠ AR / settlement)        — §34.4
     Wave 8 binding: the three layers cited in §29.19.1 of the Frozen
     Design (Layer 1 commercial / Layer 2 Inventory V21 ENTERPRISE-owned
     / Layer 3 Finance AR+settlement) are not collapsed by Wave 8; the
     consignment_commodity_locations (A-47) commercial identity is NOT a
     physical warehouse, the consignment lifecycle MUST keep
     owner_type='ENTERPRISE' on Layer 2 until an authoritative
     settlement / title-transfer event, and the Layer 3 settlement must
     be expressed via the Frozen Finance V22 canonical AR/settlement
     writers (no second consignment stock balance; no CUSTOMER-owned
     fake on Layer 2 during consignment).
```

##### B.3 Frozen Functional UAT (UAT-S-25 / 26 / 27 / 41)

```text
UAT-S-25  Service Item Sales (no inventory OUT; finance recognition)     — §34.5
          already covers SC69..SC71 + R-SAL-22; Wave 8 does not add a
          new UAT ID.

UAT-S-26  Consignment Instruction + Settlement                            — §34.5
          already covers SC72..SC75 + R-SAL-20; Wave 8 does not add a
          new UAT ID.

UAT-S-27  Consignment Return + Reporting                                  — §34.5
          already covers SC76..SC77 + R-SAL-21; Wave 8 does not add a
          new UAT ID.

UAT-S-41  Consignment commercial 三层 distinction
          (location != ownership != settlement)                            — §34.5
          already covers SC73..SC74 + S18; Wave 8 does not add a
          new UAT ID.
```

##### B.4 Frozen Sales MySQL Race (R-SAL-20 / 21 / 22)

```text
R-SAL-20  Consignment Settlement × 2 against same unsettled consigned
          quantity.
          canonical lock identity = SC74 consignment outstanding qty
          identity; business invariant = SC74 + S18;
          required result = combined settled qty ≤ consigned
          outstanding; settlement serialization.                             — §34.6 row 20

R-SAL-21  Consignment Settlement vs Consignment Commercial Return.
          canonical lock identity = SC74 settlement identity vs SC76
          commercial return identity; business invariant = SC74 + SC76 +
          S18; required result = either settlement or return commits,
          combined effect ≤ consigned outstanding at any time.              — §34.6 row 21

R-SAL-22  Service Fulfillment Confirmation × 2 against same Service
          order remaining.
          canonical lock identity = SC70 service remaining identity;
          business invariant = S08; required result = combined
          confirmation qty ≤ service-order remaining; no
          double-confirm; no inventory OUT path; service-only;
          service_classification=TRUE precondition.                        — §34.6 row 22

Wave 8 Stage B requires real independent-session MySQL evidence for
R-SAL-20 / R-SAL-21 / R-SAL-22 to come out of TEST_EVIDENCE_PENDING;
Wave 13 may repeat these gates (per UD-4 #7) but cannot substitute for
the initial Wave 8 acceptance proof.
```

##### B.5 Audit Capability ID traceability (CAP-25 / CAP-26)

```text
CAP-25  Consignment  | B3102 | MISSING | GAP-SC-14 | RC-12
        SC trace:    SC72, SC73, SC74, SC75, SC76, SC77
        Frozen audit trace: §34.13 main table row CAP-25 ↔ SC72..SC77
        Wave 8 must transition CAP-25 MISSING → COVERED in the same
        Freeze that turns UAT-S-26 / UAT-S-27 / UAT-S-41 + R-SAL-20 /
        R-SAL-21 green; no separate audit CAP ID is created.

CAP-26  Service Item | B3102 | MISSING | GAP-SC-13 | RC-11
        SC trace:    SC69, SC70, SC71 (SC71 IB adapter)
        Frozen audit trace: §34.13 main table row CAP-26 ↔ SC69..SC71
        Wave 8 must transition CAP-26 MISSING → COVERED in the same
        Freeze that turns UAT-S-25 + R-SAL-22 green; no separate audit
        CAP ID is created.

Note: the frozen audit count `Audit CAP 36` (CAP-1..CAP-36) is preserved
unchanged; CAP-25 / CAP-26 transition MISSING→COVERED does not change
the count, only their frozen-table status. (UD-4 #10)
```

#### Wave 8 Stage B — C. Service Fulfillment contract (frozen-bound)

The Service Fulfillment contract is read directly from `§34.3.14` (SC69 / SC70 / SC71), `§34.5` UAT-S-25, `§34.6` R-SAL-22, `§34.4` S08, `§34.7` Permission, `§34.8` cross-domain row 7, and `§29.18` / `§29.18.0–3` of the Frozen Design. Any clause **not** explicitly stated in those frozen sections is recorded in §H below as a Design Decision Needed; no new business policy is invented here.

1. **Commercial identity and source linkage** — Service Fulfillment is a Sales-owned confirmation record whose `sales_order_id` + `sales_order_item_id` match the canonical Wave 5 SO line. A Service Fulfillment row may exist only for a SO line whose `product_commercial_classification.service_classification=TRUE` (SC69-anchored active row via `product_commercial_classification` A-61 / `§29.18.0`). SC69 is the foundation; no SO line may carry a Service Fulfillment record without an active A-61 row.
2. **Service classification authority** — Master & Engineering owns `products` identity (frozen-Master boundary decision in `§29.18.3`); Sales & Customer owns `product_commercial_classification` (A-61). Sales does not add an `is_service` column to `products`. The Service Fulfillment Confirm path checks `product_commercial_classification.service_classification=TRUE` for the line's `product_id`; legacy products missing A-61 surface as `(unclassified legacy)` and are **fail-closed** for any new service-line write. (UD-4 #1)
3. **State and confirmation evidence** — Service Fulfillment carries `confirmation_state ∈ { PENDING, CONFIRMED, CANCELLED }` (`§29.18.1`). A row is created PENDING at Wave 8 service-line acceptance (or via authorized backfill hook); CONFIRMED at the Service Fulfillment Confirm call; CANCELLED via the documented cancel path. No state may silently transition between these without an auditable event.
4. **Line quantity and remaining-capacity semantics** — Remaining service capacity on a SO service line equals `sales_order_items.quantity - SUM(service_fulfillments.confirmation_qty WHERE confirmation_state='CONFIRMED')` (`§29.18.1` + `§29.30` row 11). This is the same definition carried by the frozen Source / Capacity Model and is the canonical lock identity for R-SAL-22 (`§29.44`).
5. **No Inventory physical movement** — Service Confirm must not write inventory OUT, inventory decrement, or fabricated COGS. (`§34.3.14` note + S08). A service line is not deliverable through `confirmSalesDelivery`; the §29.18.2 decision branches the confirm path so that the service line path refuses to invoke `applyInventoryMutation`. Frozen Wave 5 / Wave 6 / Wave 7 confirm inventory/valuation/voucher facts are untouched for non-service lines.
6. **Finance canonical recognition** — Service recognition (AR / Revenue) must be expressed via the `[INTEGRATION_BACKED]` Finance Operations V22 canonical adapter (`SC71`). No Sales-owned shadow Finance writer is introduced. The Frozen Finance recognition writer is the only authority; Wave 8 only calls it.
7. **Cancellation and correction semantics** — Service Fulfillment CANCELLED must not silently rewrite Confirmation history. Confirmed records do not auto-cancel; cancellation is a documented, audited, append-only event. Where the frozen Requirement is silent on partial cancel, defer to §H Design Decision Needed DDN-SVC-1.
8. **Idempotency** — Any Service Confirm call must be idempotent at the row-identity level (replay returns identical state). Where the frozen Requirement is silent on header-supplied vs body-supplied `Idempotency-Key` policy for Service Fulfillment, defer to §H Design Decision Needed DDN-SVC-2.
9. **Audit** — Every state transition writes one `audit_logs` row keyed by `service_fulfillments.id` (per `§29.35` row "service_fulfillment CREATE / CONFIRM / CANCEL"). No audit is silently skipped.
10. **RBAC and transactional atomicity** — All Service Fulfillment writes require `SALES_MANAGE` (sales write side); reads accept `SALES_MANAGE` or `SALES_VIEW`. Sales-group data scope is enforced in backend, mirroring Wave 7 (`§34.7` P1 / P5). All service confirmations commit Inventory no-effect (no inventory rows) + Finance recognition + audit + idempotency in one transaction or rollback as one. SQLite is `BEGIN IMMEDIATE`; MySQL is the same locked transaction with canonical lock identities listed in §29.43/§29.44.

##### C.9 Sales Delivery Confirm Gate integration (frozen-bound, bounded)

The frozen Sales Delivery confirm path calls `authorizeSalesPrepaymentGateForMutation()` inside `confirmSalesDelivery()` (`server/app.js`). UD-2 confirms this is a Wave 7 integration that Wave 8 may later extend with an explicitly bounded modification **subject to a separately authorized Design-stage decision**, but this Record does **not** authorize that extension. The Stage B Requirement only records the following contract:

- A service line with no Service Fulfillment in `CONFIRMED` state cannot pass the Sales Delivery Confirm path; the path must return HTTP 409 (or the documented failure code) with zero inventory side effects.
- A service line with a Service Fulfillment in `CONFIRMED` state passes the inventory-OUT branch with `inventory OUT 0` (per `§29.18.2`) and proceeds to the SC71 Finance recognition call.
- A non-service line passes the inventory-OUT branch unchanged (frozen Wave 5 contract).
- A mixed service + non-service SO/Delivery confirmation must still produce no inventory OUT for the service sub-lines and proceed for the non-service sub-lines; underdelivered quantity is recorded per the existing Wave 5 lower-bound tolerance handling without silently absorbing service lines.
- The Delivered-vs-Service-line concurrency invariant R-SAL-22 is the only Service Fulfillment race scope in this Stage B; no other race is added.

No `Idempotency-Key` policy, no new gate alias, no new RBAC code, and no new route is introduced by this Record for the Confirm Gate integration. (UD-2 #6)

#### Wave 8 Stage B — D. Consignment contract (frozen-bound)

The Consignment contract is read directly from `§34.3.15` (SC72..SC77), `§34.5` UAT-S-26 / UAT-S-27 / UAT-S-41, `§34.6` R-SAL-20 / R-SAL-21, `§34.4` S18, `§34.7` Permission, `§34.8` cross-domain row 8, and `§29.19.0–5` of the Frozen Design. Any clause **not** explicitly stated in those frozen sections is recorded in §H below as a Design Decision Needed.

1. **Instruction, physical handoff, location, tracking, settlement, return, reporting** — Consignment consists of the following subprocesses, each mapped to one or more frozen SCs:
   - Instruction (`SC72`): create a `consignment_commercial_documents` header + `consignment_commercial_lines` rows; record `consignment_commodity_location_id` on the line.
   - Physical handoff (Sales-only commercial instruction; physical truth at Inventory): write one Inventory movement via `applyInventoryMutation` (canonical Inventory V21 writer) with `owner_type='ENTERPRISE'` and the canonical `consignment_commodity_location_id` as the position location reference; no CUSTOMER-owned fake position is created (per `§29.19.0`).
   - Location identity (`SC73`): `consignment_commodity_locations` (A-47) is the commercial location, **not** a physical warehouse; the physical layer remains the Frozen Inventory V21 position keyed on `warehouse_id` (and never on a CUSTOMER ownership marker for consignment).
   - Tracking: every consignment line mutation emits a `tracked_inventory_movements` row via the canonical Inventory writer; no Sales shadow tracking table.
   - Settlement confirmation (`SC75`): confirm a settlement quantity ≤ remaining consigned capacity; on success, the Frozen Inventory position transfers ownership via the canonical writer (Layer 2 ENTERPRISE → CUSTOMER-owned OR out of layer 2 depending on settlement semantics) and the Layer 3 Finance canonical settlement writer records AR / settlement.
   - Return (`SC76`): confirm a return quantity ≤ remaining consigned capacity; on success, the Frozen Inventory position is restored at the consignment location with `owner_type='ENTERPRISE'` (per `§29.19.1` Layer 1 / Layer 2 return path), and the Frozen Finance canonical refund / credit-adjustment writer records the Finance effect.
   - Reporting (`SC77`): produces Consignment reporting from canonical facts (consignment_commercial_lines + Inventory V21 position + Finance settlement); no reporting shadow ledger.
2. **Three-truth ownership boundaries** — `§34.4` S18 + `§29.19.1` Layer 1/2/3 separation: Layer 1 commercial, Layer 2 Inventory ENTERPRISE-owned during consignment, Layer 3 Finance AR / settlement. The closure respects the canonical lock identity `consignment_commercial_lines.id` (`§29.19.3`) and does not introduce a parallel Sales-owned capacity balance.
3. **ENTERPRISE-owned position until lawful ownership transfer** — Until a documented settlement or authorized title-transfer event fires, the Layer 2 Inventory position at consignment location is `owner_type='ENTERPRISE'`. Settlement is the documented ownership-transfer event; return is also a documented event but does not transfer ownership away from ENTERPRISE. CUSTOMER-owned Layer 2 position represents a different business meaning (entrusted / customer-owned stock), **not** consignment (`§29.19.0` + `§29.19.5`).
4. **Commercial capacity and concurrent settlement / return controls** — Commercial remaining capacity equals `consignment_commercial_lines.consigned_quantity − settled_quantity − returned_quantity` (`§29.19.3` Layer 1 formula). R-SAL-20 + R-SAL-21 serialize concurrent settlement and return against the same `consignment_commercial_lines.id` so combined effect ≤ remaining at any time. SQLite is `BEGIN IMMEDIATE`; MySQL is locked transaction with the canonical lock identity listed in §29.44.
5. **Authoritative Inventory physical position** — `inventory_v21` canonical position remains the source of truth at Layer 2 (`§29.19.1`); the consignment module never reads from or writes to a parallel Sales-owned stock table.
6. **Authoritative Finance settlement and AR effects** — Settlement / return must invoke the same Frozen Finance V22 canonical writers used by Wave 7 (`settlement_unapplied_balances`, `account_receivables`, `payment_collections` etc.), keyed on the canonical `consignment_commercial_lines.id` row identity. No second Finance balance, no consignment-specific Finance balance.
7. **Failure rollback and historical preservation** — Any consignment instruction / settlement / return / cancel commit or rollback as one. Confirmed consignment history is not silently rewritten (`S05`); correction is via a documented, audited, idempotency-keyed correction that produces independent audit evidence.
8. **Legacy and compatibility treatment** — Legacy rows (rows with no Wave 8 consignment carrier) remain read-only legacy; no migration-time synthetic backfill creates a Wave 8 consignment record for a legacy shipment. Consignment instructions may only be created for shipments explicitly authorized through the new sales commercial path. Pre-existing consignment shipments in customer-side legacy rows fail closed if downstream verification cannot canonicalize them (`R4` analog).

#### Wave 8 Stage B — E. Data and migration acceptance

1. **Exactly four new Wave 8 tables** are added, one already-named by the Frozen Design and three by `§29.2` Physical Model Inventory:
   - `service_fulfillments` (A-44): service-only confirmation evidence keyed on `sales_order_id` + `sales_order_item_id`; canonical capacity identity for R-SAL-22 is `sales_order_items.id`; the carrier is Sales-owned but the fact it carries is consumed by the Frozen Inventory / Finance writers.
   - `consignment_commercial_documents` (A-45): Sales-owned consignment commercial header.
   - `consignment_commercial_lines` (A-46): Sales-owned consignment commercial line; canonical capacity identity for R-SAL-20 / R-SAL-21 is `consignment_commercial_lines.id`.
   - `consignment_commodity_locations` (A-47): Sales-owned commercial location identity; **not** a physical warehouse. Distinct from Master `warehouses`, distinct from Inventory V21 `warehouse_id`. UD-4 #4.
2. **No change to frozen domain schemas** — `products`, `inventory_v21`, `inventory_valuation_movements`, `inventory_valuation_balances`, `inventory_serials`, `account_receivables`, `payment_collections`, `settlement_unapplied_balances`, `planning_reservations`, `inventory_locks`, `purchase_orders`, `planned_orders`, and every other frozen Migration's domain table are not altered by the Wave 8 migration. Any required cross-domain change must go through a separately approved contract under its own Wave / Stage; Wave 8 does **not** open that path. (UD-4 #6)
3. **SQLite / MySQL parity** — Fresh bootstrap, existing-database upgrade, and `pnpm.cmd test:mysql` idempotent re-run paths must all produce the same schema for the four new carriers. The Wave 6 prefix-realization convention (`idx_*_identity_status_created` index prefix realization in `server/database/mysql-schema.js`) and the Wave 7 expression-unique-index pattern (`COALESCE(...)` for nullable composite keys) are reused as Design defaults; any deviation is recorded under §H Design Decision Needed. Wave 8 does NOT assume nullable composite keys are safe without dialect-parity proof (UD-3 §3.E last bullet).
4. **Constraints** — PK / FK / UNIQUE / CHECK / `idx_*` indexes are mandated by Design (`§29.41`) and verified by `assertMySqlColumnContracts` + hand-rolled fixture + the Wave 8-focused MySQL migration / metadata integration test (modeled after `server/mysql-sales-customer-wave7.integration.js` + Wave 0/1 upgrade test). Specific UNIQUE identities, exact index column lists, and CHECK clause text are **Design-stage decisions** (`§29.41`); the Stage B Record does not invent them and does not pre-empt Design decisions that the frozen contract leaves to Design.
5. **Wave 8-specific migration file** — one additive `server/migrations/sales-customer-wave8.js` (or analogous filename) carrying one `ensureSqlite*` / `ensureMysql*` function pair per new table, satisfying fresh / upgrade / replay / idempotency; registered into `server/migrations/sales-customer-domain.js` migration list under a new `'wave-8-service-fulfillment-and-consignment'` step. Migration registration name, exact step label, and reconciliation semantics are **Design-stage decisions**.

#### Wave 8 Stage B — F. Security and concurrency

1. **Backend permission** — All Wave 8 write endpoints require `SALES_MANAGE`; reads accept `SALES_MANAGE` or `SALES_VIEW`. Sales-group data scope (`salesperson_group_memberships` on `actor` → `salesperson_profiles`) is enforced in backend on any consignment or service row whose header carries `sales_group_id`. Cross-document scope (e.g. `customer_id` matching) is enforced where relevant. (UD-4 #8 + UD-2 #6 boundary)
2. **Permission registration** — Wave 8 may register new permission codes (e.g. `consignment:manage`, `service-sales:manage`, `consignment:view`, `service-sales:view`). The exact codes, the registry role/principal mapping, and the explicit frontend route visibility are **Design-stage decisions**; frontend hidden-only is not authorization (per `§34.7` P1-P5). (UD-4 #8)
3. **R-SAL-20 / R-SAL-21 / R-SAL-22 independent MySQL session proof** — Real independent-session MySQL race evidence is REQUIRED to transition the Wave 8 Audit Capability rows CAP-25 / CAP-26 from MISSING to COVERED; SQLite and single-thread tests cannot substitute for the first Wave 8 acceptance proof (UD-4 #7). The eventual Design must register a `server/mysql-sales-customer-wave8-concurrency.integration.js` (or analogous) file plus a corresponding worker at `scripts/gates/mysql-concurrency-sales-wave8-worker.mjs` and add it to the 9-suite list in `scripts/gates/mysql-concurrency-gate.mjs`.
4. **Row lock identities and transactional order** — The canonical lock identities are pre-declared above in §B.4 + `§29.44` (R-SAL-22: `sales_order_items.id` + `service_fulfillments.id`; R-SAL-20 / R-SAL-21: `consignment_commercial_lines.id` + Layer 2 Inventory position + Layer 3 Finance canonical identity). Specific transaction order, FOR UPDATE granularity, MySQL index-list selection to support range locks, deadlock-avoidance ordering, and READ COMMITTED vs REPEATABLE READ default are **Design-stage decisions**; the frozen Wave 6 LOT frontier convention (`idx_valuation_movements_identity_status_created` with prefix realization) is a usable precedent for any new frontier-style identity range lock Wave 8 needs.
5. **Audit** — Every state transition (service: CREATE / CONFIRM / CANCEL; consignment: instruction / settlement / return / cancel / reporting query) writes one `audit_logs` row. Audit is not bypassable from the frontend; the Frozen Wave 6 / Wave 7 audit machinery is reused unchanged.
6. **No assertion deletion, bypass, fake success, SQLite-as-MySQL substitution** — the closure follows the Wave 7 governance (`DR-SAL-06 §A.4.1 / §A.4.4`) verbatim: no PASS is manufactured by deletion / relaxation / skip / exception-to-success; SQLite PASS cannot stand in for real-MySQL PASS.

#### Wave 8 Stage B — G. Acceptance checklist (Stage C Design + Stage D Implementation + Stage E Final Acceptance gates, NOT executed here)

1. Functional closure: SC69 / SC70 / SC71 / SC72 / SC73 / SC74 / SC75 / SC76 / SC77 (Wave 8 SCs) all transition from MISSING / OUT_OF_SCOPE to COVERED against frozen Wave 1 / Wave 5 frozen contracts and frozen Wave 6 / Wave 7 frozen contracts; UAT-S-25 / UAT-S-26 / UAT-S-27 / UAT-S-41 all PASS.
2. Schema and migration parity: four new tables in fresh + upgrade + replay + idempotent rerun across SQLite and MySQL; all PK / FK / UNIQUE / CHECK / index metadata PASS; existing Wave 0..7 tables untouched.
3. Security / RBAC: every Wave 8 mutation is backend fail-closed against missing `SALES_MANAGE`; Sales-group data scope enforced; cross-document line linkage enforced; permission visibility ≠ authorization (UD-4 #8).
4. Idempotency and audit: every Wave 8 mutation has an idempotent replay; failure path produces zero partial side effects; every state transition writes an audit row.
5. Cross-domain ownership: Layer 1 Sales commercial, Layer 2 Inventory V21 ENTERPRISE-owned during consignment, Layer 3 Finance V22 canonical AR / settlement; no shadow ledger at any layer; no `inventory OUT` for service lines; no second Finance balance; nothing silent at any layer boundary.
6. SQLite focused tests: migration + functional + acceptance + bounded-superseding equivalents (modeled on Wave 6/7) all green; SQLite PASS cannot substitute for MySQL PASS.
7. Real MySQL migration and concurrency evidence: `pnpm.cmd test:mysql` PASS for the Wave 8 subset; `pnpm.cmd test:mysql:concurrency` PASS for the new Wave 8 suite with real independent sessions observed at `mysql_transaction_gates.gate_id=1`; all three Wave 8 R-SAL races exhibit legal serialized outcomes only; the gate's `MYSQL TEST ENVIRONMENT = UNAVAILABLE` output is `TEST_EVIDENCE_PENDING`, not PASS.
8. Frontend and responsive UAT: `src/pages/consignment.jsx` + the contextual service-fulfillment sub-page under Orders parentRoute are tested at 320 / 390 / 430 / 680 CSS px; Wave 7 mobile-first patterns reused verbatim; no Launcher expansion; no horizontal overflow at 320 px; min control ≥ 24 px; canary API smoke returns 2xx with real 390 px viewport; permission denial returns 401 / 403 as appropriate.
9. Documentation synchronization: `solution.md` gains Wave 8 §29.18.x + §29.19.x implementation-evidence sub-sections; `document.md` Wave 8 Freeze footer appended in the same additive pattern as Wave 6 / Wave 7; `log/YYYY-MM-DD.md` append-only entries record each gate; canonical counts `SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36` preserved unchanged throughout.

#### Wave 8 Stage B — H. Design Decisions Needed (clause-anchored, not invented)

The following decisions are not present in the frozen Contract in `§34.3.14 / §34.3.15 / §34.5 / §34.6 / §34.4 / §34.7 / §34.8` and must be made by Stage C Design (with evidence and trade-offs), or escalated as a `REQUIREMENT_REOPEN` if no frozen constraint can answer them.

```text
DDN-SVC-1  Service Fulfillment CANCELLED after CONFIRMED (partial vs full).
           — Frozen §29.18.1 / §29.32 lifecycle names CANCELLED but does
             not state partial semantics.
           — Options: (a) full cancel restores remaining capacity and is
             subject to optional Finance recognition reversal; (b) only
             a transition to a new PENDING row is permitted; (c) full
             cancel is allowed only pre-Recognition; (d) all CONFIRMED
             are immutable, requiring a symmetric "Negative Confirmed
             Evidence" row.
           — Recommendation: (a) full cancel pre-Recognition is allowed;
             post-Recognition a Finance-recognized reversal must use
             the same canonical Finance reconciliation pathway, never
             a direct Sales writer.

DDN-SVC-2  Service Fulfillment Idempotency-Key policy (header vs body
           vs payload fingerprint).
           — Frozen §34 (Wave 6 Option C) requires explicit header for
             Option C Reverse. Wave 8 service confirmation has no such
             frozen policy.
           — Options: (a) reuse the Wave 6 Option C explicit-header rule;
             (b) accept body `Idempotency-Key` only; (c) accept header
             only; (d) defer to canonical idempotency design in §29.45.
           — Recommendation: (a) explicit header required to keep
             `Idempotency-Key` policy uniform across Sales mutations,
             per the §29.45 rule and DR-SAL-05 Idempotency Addendum
             precedent.

DDN-CON-1  Consignment capacity re-validation source.
           — Frozen §29.19.3 Layer 1 formula locks to
             consignment_commercial_lines.* fields. Concurrent
             settlement-vs-return revalidation may need to re-read
             Layer 2 ENTERPRISE-owned position or Layer 3 Finance
             settlement total under the same transaction to detect
             lag-driven drift.
           — Options: (a) Layer 1 re-read only (cheapest, but lag may
             over-allow); (b) Layer 1 + Layer 2 re-read (Inventory
             FOR UPDATE on the canonical position); (c) Layer 1 +
             Layer 2 + Layer 3 re-read (broadest but most locks).
           — Recommendation: (b) Layer 1 + Layer 2 re-read; the
             settlement lag at Layer 3 is bounded by the canonical
             Finance writer running in the same transaction and is
             not separately race-prone at the consignment capacity
             decision. R-SAL-21's required result remains the same.

DDN-CON-2  Consignment location validate-on-write vs validate-on-mutation.
           — Frozen §29.19.1 names `consignment_commodity_locations`
             as commercial identity distinct from physical warehouse.
             The frozen contract does not state whether an instruction
             line may carry a `consignment_commodity_location_id`
             that maps to a closed or inactive commercial record.
           — Options: (a) fail-closed on create when location is
             inactive; (b) fail-closed only at settlement / return
             mutation; (c) block create + soft-warn at mutation;
             (d) delegate to Master & Engineering warehouse active
             status by transitive check.
           — Recommendation: (a) fail-closed on create + on
             settlement / return mutation, mirroring the active
             `product_commercial_classification` discipline for
             service lines.

DDN-CON-3  Consignment Instruction allow partial cancel / split.
           — Frozen SC72 names "Consignment Instruction" but does
             not state whether a partial cancel of an unsplit line
             is allowed before / during settlement.
           — Options: (a) line cancel only when
             settled+returned=0 (full cancel); (b) allow partial
             cancel with audit; (c) no cancel, only instruction
             quantity adjustment with reason+audit.
           — Recommendation: (c) no partial cancel; quantity
             adjustment only with reason + audit, mirroring the
             SO Change / Wave 4 contract discipline.

DDN-MIG-1  Migration registration point.
           — `server/migrations/sales-customer-domain.js` currently
             registers `wave-7-prepayment-reservation` as the latest
             step. Wave 8 must add one step. Naming, ordering,
             pre-upgrade-fresh-compatibility claim is a Design
             decision.
           — Options: (a) `wave-8-service-fulfillment-and-consignment`;
             (b) two separate steps; (c) reuse Wave 6 / Wave 7
             pattern verbatim.
           — Recommendation: (a) one additive step following Wave
             6 / Wave 7 pattern; matches Wave 6 / Wave 7 evidence
             ledger style.
```

Each DDN is recorded with options, evidence, recommendation. Stage C Design is expected to adjudicate them; if any DDN becomes a new business policy (not a Design choice), it must trigger `REQUIREMENT_REOPEN` and return to Stage B.

#### Wave 8 Stage B — I. Wave 8 frozen traceability + frozen contract preservation record

| Frozen item | Frozen location | This Record's relation to it |
|---|---|---|
| `§34.3.14` SC69..SC71 | document.md lines 4536–4546 | Cited; not rewritten. |
| `§34.3.15` SC72..SC77 | document.md lines 4548–4560 | Cited; not rewritten. |
| `§34.3.16` SC78..SC81 Reporting | document.md lines 4562–4573 | Out of scope for Wave 8; SC78..SC81 remain Wave 12 / 13 territory. |
| `§34.4` S08 / S18 | document.md lines 4712 / 4722 | Cited; not rewritten. |
| `§34.5` UAT-S-25 / 26 / 27 / 41 | document.md lines 4783–4785, 4817–4818 | Cited; not rewritten. |
| `§34.6` R-SAL-20 / 21 / 22 | document.md lines 4974–4976 | Cited; not rewritten. |
| `§34.7` Permission principles P1..P5 | document.md lines 4999–… | Cited; not rewritten. |
| `§34.8` cross-domain rows 7 / 8 | document.md lines 5029–5030 | Cited; not rewritten. |
| `§34.10` Out-of-scope | document.md lines 5054–… | Cited; not rewritten. |
| `§34.13` traceability + Audit CAP-25 / CAP-26 | document.md lines 5139–5256 | Cited; not rewritten; CAP-25 / CAP-26 transitions MISSING → COVERED is reserved for Wave 8 Freeze. |
| `§34.14` freeze baseline | document.md lines 5264–5346 | Cited; not rewritten. |
| `§34.15` DR-SAL-04..06 | document.md lines 5347–5458 | Cited; not rewritten. |
| Historical-baseline footer | document.md line 5461 | Preserved verbatim. |
| Wave 6 freeze footer | document.md line 5463 | Preserved verbatim. |
| Wave 7 freeze footer | document.md line 5465 (above) | Preserved verbatim. |
| `§34.15` governance (no new ID, no destructive shortcut, no cross-domain mutation without separate approval) | document.md lines 5373 / 5396 / 5410 / 5457 | Reaffirmed for Wave 8. |

#### Wave 8 Stage B — J. Original Read-Only Audit Register (corrections register)

The upstream Read-Only Audit Report was preserved as historical evidence (in the prior Wave 8 audit conversation history; it is **not** archived as a file in `docs/evidence/sales-customer-wave8/` because that directory does not yet exist on this branch). Corrections recorded below are applied to the *new* Stage B Requirement Closure record, per upstream instruction §1 ("Correct inaccurate findings in the new Requirement Closure record instead of silently rewriting the prior report"). Where the prior audit contained a finding that is corrected here, the correction is reflected in §B / §C / §D / §E / §F / §H above; downstream code, schema and test code are not modified by this Record.

| # | Audit claim / finding | Disposition in this Stage B Record |
|---|---|---|
| 1 | "Wave 7 must be modified to host the Service Item Sales Confirm Gate" | **CORRECTED (UD-2).** Service-item Sales Delivery Confirm Gate is a Wave 8 responsibility. A bounded Wave 8 modification to the existing Sales Delivery Confirm path may be authorized in a separate Stage C Design decision. Frozen Wave 5 / Wave 7 paths are not rewritten here. Reflected in §C.9. |
| 2 | "Absence of Wave 7 → Wave 8 table FK establishes absence of dependency" | **CORRECTED (UD-1).** Schema FK is one signal; runtime / business / project-order dependencies are independent. Reflected in §A.1 #1 + the §30.17 / §30.18 reconciliation note below. |
| 3 | "Service Fulfillment rewrites the Sales Delivery confirm path" | **CORRECTED (UD-2 #1 + #2).** Service-line confirm path does not write inventory OUT, does not decrement inventory, does not fabricate COGS; non-service lines preserve existing semantics. Service confirm requires eligible service-classification + Service Fulfillment in `CONFIRMED`; mixed service + physical lines follow per-line semantics; Prepayment Gate interaction is explicitly reconciled. Reflected in §C.5 + §C.9. |
| 4 | "Consignment CAN use the `inventory V21 CUSTOMER-owned` position during consignment" | **CORRECTED (`§29.19.0` + UD-4 #5).** Physical Inventory position at consignment is `owner_type='ENTERPRISE'` until a settlement / title-transfer event; CUSTOMER-owned Layer 2 is a different business meaning (entrusted stock) and is not consignment. Reflected in §D.3. |
| 5 | "Master products table needs `is_service` column" | **CORRECTED (UD-4 #1).** Sales-owned `product_commercial_classification` (A-61 / `§29.18.0`) is the Wave 1 / Wave 8 foundation; no Master `products` rewrite. Reflected in §C.2. |
| 6 | "A second Sales-owned reservation / prepayment ledger is acceptable for Wave 8" | **CORRECTED (UD-4 #6).** No Sales shadow inventory ledger, no second Finance AR ledger. Reflected in §A.2 #5 + §D.5 / §D.6. |
| 7 | "Frontend hidden-only is acceptable authorization" | **CORRECTED (UD-4 #8).** Hidden is not authorization; permission codes must map to backend permission rows. Reflected in §F.1 / §F.2. |
| 8 | "Wave 7 acceptance evidence is sufficient for Wave 8" | **CORRECTED (UD-4 #7).** Wave 8 R-SAL-20 / 21 / 22 require independent MySQL session evidence as part of Wave 8 acceptance; Wave 13 may repeat but cannot substitute for the initial Wave 8 proof. Reflected in §F.3. |
| 9 | "Consignment commercial location == physical warehouse" | **CORRECTED (UD-4 #4).** `consignment_commodity_locations` (A-47) is the commercial location; physical layer remains Inventory V21 `warehouse_id`; the two are not equal. Reflected in §D.1. |
| 10 | "New SC / Invariant / UAT / Race / Audit CAP IDs are needed for Wave 8" | **CORRECTED (UD-4 #10).** All Wave 8 traces re-use frozen SC69..SC77, S08 / S18, UAT-S-25 / 26 / 27 / 41, R-SAL-20 / 21 / 22, CAP-25 / CAP-26. Counts unchanged. Reflected in §A.2 #2 + §B. |
| 11 | "Wave 6 / Wave 7 frozen contracts must be re-opened to enable Wave 8" | **CORRECTED (UD-4 #9 + UD-2 #2).** Frozen Wave 6 / Wave 7 contracts are preserved verbatim. Wave 8 may perform an explicitly bounded modification to the Sales Delivery Confirm path under a separate Stage C Design authorization; that re-opening decision is recorded but not made here. |
| 12 | "Sales & Customer launcher should expand for Wave 8" | **CORRECTED (UD-5).** No launcher expansion; `src/pages/consignment.jsx` + a contextual service-fulfillment sub-page only. Wave 12 global Mobile IA redesign is out of scope. Reflected in §A.1 #9 + §A.2 #6. |

Each row maps to the relevant UD-n in the upstream authorization; no audit row is silently dropped; no row introduces a new frozen contract clause.

#### Wave 8 Stage B — K. Frozen §30.17 / §30.18 dependency-cell discrepancy note (UD-1 reconciliation item)

The upstream authorization records a discrepancy in `solution.md §30.17` (and possibly `§30.18`) where the Wave 7 dependency cell references Wave 5 + Wave 6 only, while the Wave 8 Service Fulfillment Confirm Gate creates a runtime dependency on Wave 7 (specifically the frozen `authorizeSalesPrepaymentGateForMutation()` call inside `confirmSalesDelivery()`). This Record records the discrepancy as a **bounded Stage C Design reconciliation item** and explicitly does NOT modify §30.17 / §30.18 in Stage B. The Stage C Design sub-section `§29.18.2` decision-point already encodes the runtime dependency on `authorizeSalesPrepaymentGateForMutation`; the Stage C Design must align the §30.17 / §30.18 Wave 7 dependency cell wording with that decision-point without rewriting any frozen §29 / §30 contract. (UD-1 final paragraph)

#### Wave 8 Stage B — L. Frozen Wave 6 / Wave 7 contracts explicitly preserved

This Record does NOT modify or re-open any of:

1. Wave 6 frozen contracts: DELIVERY_BACKED `reverseOperationalReturn` (frozen); Option A Confirm (`confirmOptionAReturn`) with R1 LOT conservative fence, R2 SERIAL outbound provenance, R3 NO_SOURCE commercial / valuation separation, R4 legacy fail-closed (frozen); Option C Restricted Economic Reversal with mandatory explicit `Idempotency-Key`, F5 `CHECK(amount_cents >= 0)` relaxation, F6 `cancellation_state` 2-value migration, Replacement lifecycle immutable fulfillment evidence, three-mode commercial source distinction, NULL/unknown marker 409 `SALES_RETURN_MARKER_UNKNOWN`, Wave 6 composite index `idx_valuation_movements_identity_status_created` prefix realization, `sales_return_valuation_provenance` additive carrier.
2. Wave 7 frozen contracts: `sales_prepayment_requirements` / `sales_prepayment_gate_results` / `sales_reservation_intent` carriers, Prepayment Gate PLANNING_RELEASE / RESERVATION / DELIVERY stage decisions and override pathway, Wave 7 R-SAL-15 bounded Finance integration contract extension (Finance parent balance lock on `settlement_unapplied_balances.id` where `balance_type='PREPAYMENT'`), Wave 7 Reservation Intent four-mode dispatch + react-to-event helpers, Wave 7 MySQL `assertMySqlColumnContracts` + `normalizeDefault` charset-prefix-with-escaped-quotes regex extension, Wave 7 expression-unique-index `COALESCE(sales_order_item_id, '')` parity, Wave 7 mobile-first PrepaymentGates + ReservationIntents surfaces with two new contextual routes under Orders parentRoute.
3. Wave 5 frozen contracts: Delivery Notice line capacity, DIRECT_ORDER / DELIVERY_NOTICE double-source Sales Delivery convergence, Sales Delivery confirm inventory OUT + valuation + COGS voucher chain.
4. Wave 1 frozen contracts: Sales Parameters / Sales Group / Customer Commercial Extensions / Customer Material / Product Commercial Classification (`product_commercial_classification` A-61 — the foundation SC69 uses).
5. Frozen Domain Ownership Principle: Master & Engineering owns `products` identity; Sales & Customer owns `product_commercial_classification`; Inventory V21 owns `inventory` / `inventory_v21` position; Finance V22 owns `account_receivables` / `settlement_unapplied_balances` / canonical V22 AR + settlement + refund + credit-adjustment machinery; Planning V19 owns `planning_reservations` / EXPECTED bounded-integration-contract-extension logic; Manufacturing & Quality owns production-cost / WIP; Procurement & Outsourcing owns PO / receipt; Accounting & Analytics owns GL / Voucher / Trial Balance / IS / BS; Platform owns notifications / workflows / numbering / generic rule infrastructure.

#### Wave 8 Stage B — M. Status and Hard Stop

Status going out of this Record: `WAVE8_STAGE_B_REQUIREMENT_CLOSURE_RECORDED — AWAITING USER CONFIRMATION BEFORE STAGE C DESIGN`. Wave 6 remains `WAVE6_FINAL_ACCEPTANCE_PASS — FROZEN` on `feature/sales-waves6-13@aee1e0c13d26dd840ae4b596340212eef03479c0`. Wave 7 remains `WAVE7_FINAL_ACCEPTANCE_PASS — FROZEN` on `feature/sales-waves6-13@0d4e4b8a0b71d43551072349b55f494d9a439b53`. Wave 9–13 remain `OUT_OF_SCOPE`. Wave 8 has not been authorized to start Stage C Design or anything beyond this Stage B Requirement Closure record.

Hard Stop: this Record is bounded. It does **not** authorize any of the following without a separate user authorization: Stage C Design work on `solution.md`, any Stage D Implementation, any test run (`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm test:mysql` / `pnpm test:mysql:concurrency` / `pnpm build`), any database connection / reset / DDL / DML, any Git operation (`add` / `commit` / `push` / `merge` / `rebase` / `reset` / `clean` / `stash` / `tag` / `push --tags`), any deletion of untracked SQLite / WAL / SHM artefacts, any modification to `APPLY_GUIDE.md` / `README.md` / `AGENTS.md` / `CLAUDE.md` / `package.json` / release tags, any new SC / Invariant / UAT / Race / Audit Capability ID, or any Wave 9–13 work. The next user action must explicitly confirm this Stage B Requirement Closure deliverable before Stage C Design starts.

---
