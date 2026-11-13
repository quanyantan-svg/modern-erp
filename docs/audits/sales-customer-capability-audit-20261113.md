# Sales & Customer 销售与客户域 — 域级能力审计基线（2026-11-13）

> **用途**：登记 B3102 / B3103 销售与客户域**域级 Acceptance** 的逐项能力复核证据，覆盖 36 项 Audit Capability（CAP-1～CAP-36）与其对应的 114 项 SC capability，并登记本轮发现的真实缺陷、结构缺口与待裁定事项。
>
> **Owner**：Sales & Customer Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`IMPLEMENTED` —— 逐项复核与整改轮均已完成（整改后 36 项全部 `COVERED`）；**域级 Acceptance 与 Capability Freeze 尚未签发**，等待业务所有者裁定。
>
> **权威来源**：Requirement [`docs/requirements/sales-customer/01-domain-closure.md`](../requirements/sales-customer/01-domain-closure.md) §34.2～§34.14；Wave 修订 [`docs/requirements/sales-customer/02-wave-8-amendments.md`](../requirements/sales-customer/02-wave-8-amendments.md) / [`03-wave-9-amendments.md`](../requirements/sales-customer/03-wave-9-amendments.md) / [`04-wave-10-amendments.md`](../requirements/sales-customer/04-wave-10-amendments.md) / [`05-wave-11-amendments.md`](../requirements/sales-customer/05-wave-11-amendments.md)；Design [`docs/design/sales-customer/`](../design/sales-customer/)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件不改写合同正文，只记录**当前工作树上的复核结论**。审计发现**不构成** Capability Verified、Capability Freeze、Domain Acceptance、Manual Closure 或 Release Readiness。

## 1. 复核方法与判定纪律

逐项定位 Requirement 条款、Design 条款、生产写入口（route + canonical owner）、可执行测试（文件 + 用例名）、前端入口，以及**能力的事实是否被业务路径消费**。

判 `COVERED` 需同时成立：① 有生产写入口或读入口，且服务端具备来源、状态机、权限、事务约束；② 有可执行测试覆盖正例且至少一个反例；③ 该能力有 operator 可达的前端入口（LIST → DETAIL → EDITOR / WORKFLOW），或该能力本身是纯只读读模型；④ 事实进入业务路径。

判 `PARTIAL` 的三种形态（本轮出现）：**能力事实被持久化但无生产消费方**；**能力只由部分实现，未覆盖 Requirement 声明的完整枚举**；**后端能力齐备但无 operator 前端入口**。

判 `MISSING` 的形态：**该能力族在生产代码、路由、schema、前端与测试中全部不存在**。

**能力编号来源**：CAP-1～CAP-36 逐行对应 Requirement §34.13 的 Audit Capability trace 表；`SC01..SC114` 为该表的 SC family 列。§34.13 表记录的是**审计时点**（Wave 1 之前）的覆盖状态，其中多数 `MISSING` / `PARTIAL` 已被后续 Wave 1～W11-A 的实施取代 —— **本台账是当前工作树的判定，取代 §34.13 表中的历史覆盖值**，但**不改写** §34.13 的原始 trace 事实。

**审计基准 SHA**：`d70857e`（`master`，2026-11-13）。

## 2. 复核结论摘要

| 阶段 | `COVERED` | `PARTIAL` | `MISSING` | `OUT_OF_SCOPE` |
|---|---|---|---|---|
| 本轮审计（2026-11-13） | **31** | **3** | **2** | **0** |
| 整改轮后（2026-11-13） | **36** | **0** | **0** | **0** |

合计 36 项（CAP-1～CAP-36）。整改轮的逐项闭合方式见 §6.2。

**3 项 `PARTIAL`**：`CAP-1`（SC01 控制开关无生产消费方）、`CAP-24`（SC32 预留态字段惰性 + SC68 订单事件响应未接线）、`CAP-27`（SC80 毛利与 SC81 排行**完全未实现**，SC78 只覆盖 6 类单据中的 3 类）。

**2 项 `MISSING`**：`CAP-34`（SC99 / SC100 信用对账与重算，W11-D）、`CAP-36`（SC103～SC107 信用评估基础与多评分/评级应用，W11-B / W11-C）—— 两者**零实现**（无表、无路由、无模块、无前端、无测试）。

**与 §34.13 审计时点表的差异**：本轮 22 项（CAP-2、7～23、25、26、28～33、35）的当前判定**优于** §34.13 表中的 `MISSING` / `PARTIAL`，原因是 Wave 1～W11-A 的实施；这些行的差异由 Wave 各自的 acceptance / freeze 记录承载，不是本轮整改成果。§34.13 表**仍保留为审计时点的历史 trace 事实**。

## 3. 36 项能力逐项复核

### 3.1 B3102 销售管理（CAP-1～CAP-27）

| # | 能力 | SC family | 实现（owner / route / schema） | 测试证据 | 判定 | 缺口 |
|---|---|---|---|---|---|---|
| CAP-1 | 销售管理基础 | SC01–08, SC26, SC27, SC31 | `sales-parameters.js`、`sales-foundation.js`、`sales-commercial-foundation.js` · `/api/sales/parameters`、`/api/sales/groups`、`/api/sales/salespersons`、`/api/sales/memberships`、`/api/customer-commercial-extensions`、`/api/customer-material-xref`、`/api/sales/sellable-scope-rules`、`/api/sales/product-classifications` | `sales-customer-wave1-foundation.test.js`、`sales-customer-batch-a.test.js` | **PARTIAL** | SC01 的 `deliveryScheduleEnabled` / `deliveryQuantityControlEnabled` / `reservationBehavior` 三个控制开关**只被持久化与解析，无任何生产消费方**（`sales-parameters.js` 内读写，全仓无第三方读取）；SC01 / SC06 / SC07 / SC19 **无 operator 前端入口** |
| CAP-2 | 销售报价 | SC09–14 | `sales-quotations.js` · `POST /api/sales-quotations`、`/{id}/convert-to-so`、`/{id}/effective-publish`、`/{id}/cancel` · `sales_quotations / lines / conversions` | `sales-customer-batch-a.test.js:126-147`（未发布拒绝、**过期拒绝 409 且零副作用**、重复行拒绝、幂等重放、批次转单、容量耗尽） | COVERED | — |
| CAP-3 | 销售订单头 | SC24 | `sales-orders.js::createSalesOrderCanonical` · `POST /api/sales-orders` | `sales-customer-batch-a.test.js:66` | COVERED | — |
| CAP-4 | 订单价格快照 | SC20+25+28 | `sales-orders.js::validatePriceSnapshot` · `sales_order_items.price_snapshot_json` | `sales-customer-batch-a.test.js:66`、`sales-customer-wave2-pricing.test.js` | COVERED | — |
| CAP-5 | 订单 UoM 快照 | SC25+28 | `sales-orders.js::buildAuthoritativeSalesLines` · `pricing_uom_code_applied` / `commercial_uom_code` | `sales-customer-wave1-foundation.test.js`、`sales-customer-wave2-pricing.test.js` | COVERED | — |
| CAP-6 | 订单商业条款 | SC27, SC28 | `sales-orders.js` 持久化 `payment_terms` / `payment_terms_days` / `commercial_tax_code` / `tax_inclusive` / `tax_basis_assumption` | `sales-customer-batch-a.test.js:78`（商业假定不生成法定发票事实） | COVERED | — |
| CAP-7 | 订单时折扣快照 | SC21–23 | `sales-pricing.js::resolveOrderTimeDiscount` · `discount_snapshot_json` · `POST /api/sales-discounts/resolve` | `sales-customer-wave2-pricing.test.js`（LINE/HEADER 约束、版本确定、确定性分摊） | COVERED | — |
| CAP-8 | 订单商业当事人 | SC26 | `sales-orders.js`（`settlement_party_id` / `payer_id` / `ship_to_*` / `salesperson_id` / `sales_group_id`）+ `sales-commercial-foundation.js` 客户商业默认值 | `sales-customer-batch-a.test.js:78`、`sales-customer-wave1-foundation.test.js` | COVERED | — |
| CAP-9 | 赠品行 | SC29 | `sales-orders.js::addSalesOrderGiftLine` · `POST /api/sales-orders/{id}/gift-line` · `gift_summary_cents` | `sales-customer-batch-a.test.js:1453`（目录价保留、零收入）、`:1527`（零收入赠品出货仍产生库存 / 估值 / COGS 且仅一次） | COVERED | — |
| CAP-10 | 订单状态机与审批 | SC33–35 | `sales-orders.js::salesOrderAction` + DRAFT/REJECTED-only 编辑守卫 | `sales-customer-batch-a.test.js`（提交完整性门槛、审批与并发变更共用 CAS 应用服务） | COVERED | — |
| CAP-11 | 受控订单变更 | SC37–40 | `sales-order-changes.js`（530 行）· `/api/sales-order-changes`、`/api/sales-orders/{id}/controlled-change` | `sales-customer-batch-a.test.js`（16 条：归属、SoD、CAS、损坏证据 fail closed、R3–R7）、`sales-customer-wave6-bounded-superseding.test.js` | COVERED | — |
| CAP-12 | 订单履约与关闭 | SC41–44 | `sales-orders.js::getSalesOrderFulfillment` + `projection()` + 受控关闭 / 取消分支（`SALES_ORDER_EXECUTED_CANNOT_CANCEL` / `SALES_ORDER_LOWER_TOLERANCE_NOT_REACHED` / `SALES_ORDER_PENDING_DELIVERY_NOTICE`） | `sales-customer-batch-a.test.js`（组范围、精确下容差、待发货通知、已执行禁止取消） | COVERED | — |
| CAP-13 | 预收门槛 | SC62–65 | `sales-prepayment-gate.js`（678 行）+ `sales-prepayment-finance-adapter.js` · `/api/sales-prepayment-requirements`、`/api/sales-prepayment-gate-results`、`/api/sales-orders/{id}/prepayment-gate/{STAGE}`、`/override` · `src/pages/sales-wave7.jsx` | `sales-customer-wave7-functional.test.js`（~40）、`sales-customer-wave7-acceptance.test.js`（~42）、`sales-gate-retry-admission.test.js` | COVERED | — |
| CAP-14 | 发货通知 | SC45–48 | `delivery-notices.js` · `/api/delivery-notices`（+ `/{id}`、`/{id}/confirm`、`/{id}/cancel`）+ `sales-delivery-source.js` | `sales-customer-batch-a.test.js:1376-1396`（确认不产生库存变更、竞争通知不得超容差） | COVERED | — |
| CAP-15 | 销售出库 | SC49, SC50, SC52, SC53（+SC51 IB） | `server/app.js` **inline**（`listSalesDeliveries` / `createSalesDelivery` / `confirmSalesDelivery`）+ `sales-delivery-source.js::lockAndConsumeSalesDeliveryCapacity` | `sales-customer-batch-a.test.js`、`sales-customer-wave8-mixed-delivery.test.js`、`sales-customer-wave7-acceptance.test.js` | COVERED | **结构债**：CAP-15 核心逻辑未进入 `server/modules/`，不在模块归属 / 审计面内 |
| CAP-16 | 出库 OQC 门禁 | SC51（IB） | `quality-gates.js::deriveQualityState` + OQC → Sales Delivery 适配 + 质量策略豁免 | `sales-customer-wave10-quality-policy.test.js`（W10-QCP-T01..T04） | COVERED | — |
| CAP-17 | 退货 | SC54 | `server/app.js::confirmSalesReturn` / `reverseOperationalReturn` | `sales-customer-batch-a.test.js`、`sales-customer-wave8-residual.test.js`（R1） | COVERED | **结构债**：同 CAP-15 |
| CAP-18 | 退货（SO_BACKED） | SC55, SC57 | `sales-return-canonical-writer.js::confirmOptionAReturn` · `app.js` 按 `commercial_source_marker` 分派 | `sales-customer-wave6-functional.test.js`（真实 SO 行、剩余容量约束） | COVERED | — |
| CAP-19 | 退货（NO_SOURCE） | SC56, SC57 | 同上（Option C）· `SALES_RETURN_MARKER_UNKNOWN` 409 | `sales-customer-wave6-functional.test.js`（物理库存 + 池价值 + 平衡凭证且无 AR 贷记） | COVERED | — |
| CAP-20 | 补发 | SC59–61 | `sales-return-canonical-writer.js:706-844` · `/api/sales-order-replacements` · `src/pages/logistics-finance.jsx` | `sales-customer-wave6-functional.test.js`（部分 / 多次履约、取消保留履约、禁止反向与再次履约） | COVERED | — |
| CAP-21 | 销售定价 | SC15–20 | `sales-pricing.js`（价目表 / 条目 / 不可变版本 / 生命周期 / `resolveSalesPrice`）· `/api/sales-price-lists*`、`/api/sales-pricing/resolve` · `src/pages/sales-pricing.jsx` | `sales-customer-wave2-pricing.test.js`（17 条：优先级、回落、环、UoM 换算、版本历史、身份守卫） | COVERED | — |
| CAP-22 | 订单时折扣 | SC21–23 | 同 CAP-7 | `sales-customer-wave2-pricing.test.js` | COVERED | — |
| CAP-23 | M14 销售折扣（EX） | — | `discounts.js` · `GET /api/sales-discounts` | `server/m14-discounts.test.js`（20 条） | COVERED | — |
| CAP-24 | 预留意向 | SC32, SC66–68 | `sales-reservation-intent.js`（583 行）· `/api/sales-reservation-intents` · `src/pages/sales-wave7.jsx` | `sales-customer-wave7-functional.test.js`（~25）、`sales-customer-wave7-acceptance.test.js` | **PARTIAL** | (a) **SC32 惰性**：`sales_orders.reservation_intent_state` 仅在 INSERT 时写入默认值 `'NONE'`，**全仓无 UPDATE**（`sales-orders.js:462`）；(b) **SC68 未接线**：`adjustReservationIntentOnChange` 与 `releaseReservationIntentsForOrder` 是**零调用方死代码**，SO 变更 / 取消 / 关闭 / 退货 / 补发**均不触发预留响应** |
| CAP-25 | 寄售 | SC72–77 | `consignment.js`（687 行）· `/api/consignment-*` · `src/pages/wave8-sales.jsx` | `sales-customer-wave8-functional.test.js`、`sales-customer-wave8-remediation.test.js`（P0-1/P0-2、三层报表差异） | COVERED | — |
| CAP-26 | 服务物料 | SC69–71 | `service-fulfillment.js`（332 行）· `/api/service-fulfillments` · `src/pages/wave8-sales.jsx` + `finance-recognition.js` | `sales-customer-wave8-functional.test.js`（容量守恒 + 多来源信用）、`sales-customer-wave8-mixed-delivery.test.js`（纯服务出货零库存零 COGS） | COVERED | — |
| CAP-27 | 销售报表 | SC78–81 | `decision-reports.js::getSalesSummary` / `getSalesOutstanding` · `/api/reports/sales-summary`、`/api/reports/sales-outstanding` · `src/pages/decision-reports.jsx` | `server/decision-reports.test.js`（~45）、`v14-e5-report-dates-and-business-filters.test.js`、`v14-e6-line-fulfillment-reporting.test.js` | **PARTIAL** | (a) **SC80 销售毛利零实现**（全仓 `毛利` / `grossProfit` 零命中）；(b) **SC81 销售排行零实现**（客户 / 物料 / 销售员 / 销售组四维度全无）；(c) **SC78 只覆盖 6 类单据中的 3 类**（`getSalesSummary` 只读 `sales_orders` / `sales_deliveries` / `return_orders`，缺 Quotation / Delivery Notice / Replacement） |

### 3.2 B3103 信用管理（CAP-28～CAP-36）

| # | 能力 | SC family | 实现（owner / route / schema） | 测试证据 | 判定 | 缺口 |
|---|---|---|---|---|---|---|
| CAP-28 | 信用参数 | SC83, SC84 | `credit-policy.js` + `credit-rule-payload.js` · `GET/POST /api/credit/policy/parameters` · `credit_parameters` | `sales-customer-wave9-credit-foundation.test.js`（21 条） | COVERED | — |
| CAP-29 | 信用规则 | SC85, SC86 | `credit-policy.js`（规则写入口，`STAGES`/`SCENARIOS`/`TIMINGS`/`STRENGTHS` 枚举）· `GET/POST /api/credit/policy/rules` · `credit_check_rules` | `sales-customer-wave9-credit-foundation.test.js`（SC84+SC86 合并断言）、`sales-customer-wave10-credit-check.test.js:401` | COVERED | — |
| CAP-30 | 信用档案 | SC87–89 | `credit-profile.js` + `credit-anchor.js` · `GET/POST /api/credit/profiles`、`GET /api/credit/profiles/:id` · `credit_profile` / `credit_profile_ratings` | `sales-customer-wave9-credit-foundation.test.js`（SC87 / SC88 / SC89） | COVERED | — |
| CAP-31 | 信用占用 | SC82 + SC90–92 | `credit-anchor.js`（`credit_lock_anchors`）+ `credit-check.js::computeCreditExposure`（**PURE_DERIVED**，按设计无 `credit_exposure` 表） | `sales-customer-wave9-credit-foundation.test.js`（六张批准表、并发锚收敛）、`sales-customer-wave10-credit-check.test.js`（UAT-S-31 SO→AR 转换、W10-R9/R10、S14 Mode B/C） | COVERED | 占用无独立前端工作面，仅经信用查询 / 检查读模型暴露（符合 SC82 纯派生不变量） |
| CAP-32 | 信用检查 | SC93–95 | `credit-check.js`（1731 行）· `POST /api/credit/check`、`GET /api/credit/check-results` · `credit_check_results` · `src/pages/credit-check.jsx` | `sales-customer-wave10-credit-check.test.js`（75 条：PASS/BLOCK/WARNING/SPECIAL_APPROVAL_REQUIRED、S15 fail closed、P3 双范围） | COVERED | — |
| CAP-33 | 信用特别审批 | SC96–98 | `credit-special-approval.js`（363 行）+ `credit-check.js` 的 ONE_TIME 消费状态机 · 4 条 `/api/credit/special-approvals*` 路由 · `credit_special_approval` / `credit_special_approval_consumption` | `sales-customer-wave10-credit-check.test.js`、`sales-customer-wave10-acceptance-contract.test.js`（AC-01..AC-11） | COVERED | — |
| CAP-34 | 信用对账与重算 | SC99, SC100 | **无** —— 无模块、无路由、无表、无前端、无测试 | 无 | **MISSING** | W11-D **零实现**。Design §37.54.11 已规定 `credit_recalculation_history` 表、`POST /api/credit/reconciliation/check`、`POST /api/credit/reconciliation/recalculate` 与 `computeCreditExposure()` 追加 `factDigest`。**不**被 D-2…D-5 阻塞 |
| CAP-35 | 信用查询 | SC101, SC102 | `credit-query.js`（660 行）+ `credit-query-options.js`（210 行）· `GET /api/credit/exposure`、`/exceptions`、`/exceptions/:id`、`/query-options` · `src/pages/credit-query.jsx` | `sales-customer-wave11-a-credit-query.test.js`（38）、`-credit-query-ui.test.js`（16）、`-overdue-evidence.test.js`（9）、`-search-semantics.test.js`（40）、`sales-customer-wave11-sec-scope.test.js`（14） | COVERED | W11-A **整包** Acceptance（`W11_A_ACCEPTANCE_PASS`）仍未签发（业务所有者的独立决定，见 §5） |
| CAP-36 | 信用评估与多评分/评级应用 | SC103–107 | **无** —— 无模块、无路由、无表、无前端、无测试 | 无 | **MISSING** | W11-B / W11-C **零实现**。Design §37.54.9 / §37.54.10 已规定 `credit_evaluation_indicator` / `_scheme` / `_model` / `_scoring_sheet` / `_result` 五表、`credit-evaluation.jsx` 与 `applyCreditRating()` 唯一评级写入口。**被 D-2 / D-3（W11-B）与 D-4 / D-5（W11-C）阻塞** |

## 4. 本轮登记的真实缺陷与结构缺口

| 编号 | 事实 | 证据 | 影响 |
|---|---|---|---|
| `SC-DEF-01` | SC01 的 `deliveryScheduleEnabled` / `deliveryQuantityControlEnabled` / `reservationBehavior` 三开关只被持久化与解析，**无生产消费方** | `server/modules/sales-parameters.js:10,25,37-40,53-56,80-90`；全仓非测试命中仅此一文件 | Requirement §34.3.1 明文要求 SC01 至少包含「交货计划 / 数量控制」「预留行为」控制语义；参数可配但不可生效 |
| `SC-DEF-02` | `sales_orders.reservation_intent_state` 只在 INSERT 写默认值 `'NONE'`，**全仓无 UPDATE** | `server/modules/sales-orders.js:462`（唯一写入点） | SC32 的订单侧预留状态是惰性字段，SO 上的预留事实不可读 |
| `SC-DEF-03` | `adjustReservationIntentOnChange` 与 `releaseReservationIntentsForOrder` **零调用方** | `server/modules/sales-reservation-intent.js:518,544`（全仓仅定义处命中） | SC68「响应 SO 变更 / 取消 / 关闭 / 退货 / 补发」**从未发生**；变更或取消订单不会释放或调整预留 |
| `SC-DEF-04` | SC80 销售毛利**完全未实现** | `grep 毛利\|grossProfit` 在 `server/` + `src/` 零命中 | Requirement §34.3.16 声明 DOMAIN_OWNED，UAT-S-38 无对应实现 |
| `SC-DEF-05` | SC81 销售排行（客户 / 物料 / 销售员 / 销售组）**完全未实现** | `grep 排行\|排名\|salesRank` 在 `server/` + `src/` 零命中 | 同上 |
| `SC-DEF-06` | SC78 执行报表只覆盖 6 类单据中的 3 类 | `server/modules/decision-reports.js:210-216`（只读 `sales_orders` / `sales_deliveries` / `return_orders`） | 缺 Quotation、Delivery Notice、Replacement 三类执行证据 |
| `SC-DEF-07` | SC19 价格覆盖授权后端存在、前端**无签发入口** | `server/app.js:779` 有 `POST /api/sales-price-overrides/authorize`；`src/pages/sales-batch-a.jsx:150` 只转发既有 `authorizationId` | operator 无法在 UI 上取得覆盖授权，SC19 的「独立授权」能力实际不可用 |
| `SC-DEF-08` | SC01 / SC06 / SC07 / SC19 **无 operator 前端工作面** | 全仓无消费 `/api/sales/parameters`、`/api/sales/memberships`、`/api/sales/sellable-scope-rules`、`/api/sales/product-classifications` 的前端代码 | 参数 / 成员 / 可售范围 / 产品分类四项配置只能改库或调 API |
| `SC-DEF-09` | CAP-15 / CAP-17 核心逻辑**内联在 `server/app.js`**（约 6610–6935 行） | `server/app.js` 内 `listSalesDeliveries` / `createSalesDelivery` / `confirmSalesDelivery` / `confirmSalesReturn` | 销售出库与退货的 canonical owner 不在 `server/modules/`，违反 AGENTS.md §8 的模块归属方向，且难以被域级 focused 套件覆盖 |
| `SC-DEF-10` | 销售域**无专属真实 MySQL ACK-4 campaign** | `scripts/gates/ack4/ack4-runtime.mjs` 注册的 manifest 中无 `SALES_*`；`blockUnmigratedAck4Entry` 阻断全部销售 MySQL 入口 | 本域无法产出真实 MySQL 域级验收证据（`MYSQL-EV-01` 口径要求逐段写明覆盖 / 不覆盖） |
| `SC-DEF-11`（整改轮新发现） | `grantReservationIntent` / `consumeReservationIntent` / `releaseReservationIntent` 在**事务外**读 `intent_state`，UPDATE **不带状态 CAS** —— 两个并发授权都会观察到 `REQUESTED` 并都提交 `GRANTED`，状态机不是承重件 | `server/modules/sales-reservation-intent.js` 三条路径 | 三条路径改为：事务内 `FOR UPDATE` 复读 + UPDATE 携带期望状态（consume 另携带期望已消费数量）作 compare-and-set；锁序统一为「意图行 → canonical 对象」，与批量释放路径一致 |
| `SC-DEF-12`（整改轮新发现） | 整改初稿把订单行的**文档单位**数量与预留意图的**基本单位**数量直接比较 | 预留意图数量进入 canonical 库存锁与 Planning 预留，恒为基本单位；订单行数量为文档单位 | 统一经订单行的 `base_quantity_num / base_quantity_den` 基本单位快照换算；已执行量同样按基本单位累计 |

### 4.1 浏览器证据的去空洞过程

域级浏览器门禁 `scripts/acceptance/sales-customer-domain-responsive-uat.mjs`（22 个界面 × 4 档宽度 = 88 项）在建立过程中暴露并修复了三类门禁自身缺陷；**生产代码零改动**：

| 事实 | 处置 |
|---|---|
| 门禁的 44px 判定沿用了库存域的 `height < 44 && width < 44` 写法 —— 一个 30×44 的目标可以通过 | 改为 `||`；变异实验证明：改回 `&&` 时门禁保持绿色，改为 `||` 后 88/88 全部失败并点名该目标 |
| 夹具种入了 `UAT_CREDIT_MANAGEMENT_ENABLED`，而生产读取的是 `CREDIT_MANAGEMENT_ENABLED` —— 信用检查因此恒返回 `CREDIT_MANAGEMENT_DISABLED` 且不落任何证据，信用检查 / 信用特别审批两个界面永远是空的 | 改种规范参数码，并补齐真实的信用证据（6 条检查结果 + 1 条特别审批），两个界面渲染出真实数据 |
| `credit-evaluation` 页面用 `.mini-card` 同时承载空态，门的行数统计把空态当成数据行 | 空态按 `aria-label^="empty-"` 排除；该界面的**显式空态**在结果中逐界面如实登记（评分世界需要受限评分人流程，本门禁不建立） |

**非空洞证明（变异实验，两次，均已还原）**：
① 移除 `src/pages/sales-parameters.jsx` 的 `data-testid` → 门禁在该界面 4/4 失败并报「规范 data-testid 未绘制」，而行数检查本身仍会通过 —— 证明真正承重的是**界面确实渲染**这一条；
② 把 `.mobile-header__back` 缩到 30px → 旧写法下门禁保持绿色，新写法下 88/88 失败并报「1 个已绘制可点目标低于 44px」。

### 4.1 开放设计决策（D-2～D-5）与编号矛盾

`docs/design/sales-customer/05-wave-11-stage-c.md` §37.54.17 记录 5 项 Design 决策，D-1 已闭合（CORRECTION-2 → `result_snapshot_json`）。D-2～D-5 原为 `PENDING` 且标注「请用户确认」；**业务所有者已于 2026-11-13 裁定全部按 Design 推荐值实施**（见 §6.1）：

| ID | 决策 | 阻塞 | Design §37.54.17 | 裁定后状态 |
|---|---|---|---|---|
| D-2 | 评分数值一律整数 milli-point、权重整数 milli-weight、**禁止插值与浮点** | W11-B | 请用户确认 | `APPROVED`（2026-11-13） |
| D-3 | 模型 / 方案 / 指标**不设独立版本表**，采用生效日期版本化（沿用 Wave 9 形态） | W11-B | 请用户确认 | `APPROVED`（2026-11-13） |
| D-4 | 评分表创建时**固定** profile 版本；apply 时版本变化则 fail closed（409 `CREDIT_RATING_TARGET_PROFILE_CHANGED`） | W11-C | 请用户确认 | `APPROVED`（2026-11-13） |
| D-5 | `credit_evaluation_result` 对 sheet 唯一；重新评价必须新建评分表 | W11-C | 请用户确认 | `APPROVED`（2026-11-13） |

D-7（评分人 ≠ 应用人的**人员级**分离）是**未决业务决策**，Design 明确「不强制」；本轮沿用该立场，不重开 Requirement。

**编号矛盾（须在整改轮裁定）**：`docs/decisions/OPEN-BUSINESS-DECISIONS.md` §2 把 D-4 / D-5 登记为「信用对账与重算（W11-D）」的设计决策，而 Design §37.54.17 把 D-4 / D-5 定义为 **W11-C** 的决策；`docs/status/PROJECT_STATUS.md` §35.9 则登记为「D-2 / D-3 / D-4 / D-5 阻塞 W11-B、W11-C」，与 Design 一致。**以 Design §37.54.17 与 §35.9 为准**，`OPEN-BUSINESS-DECISIONS.md` §2 的 D-4 / D-5 归属行是**文档失真**，须在整改轮更正。**W11-D 不被 D-2～D-5 阻塞。**

## 5. 未关闭的历史与授权事项

| 事项 | 状态 | 来源 |
|---|---|---|
| `W11_A_ACCEPTANCE_PASS`（W11-A 整包 Acceptance） | **未签发** —— 单元级冻结（W11-SEC-01 / U1 / U2 / OVERDUE / U3）已各自签发，整包签发是业务所有者的**独立**决定，不是单元冻结的自动汇总 | `docs/decisions/OPEN-BUSINESS-DECISIONS.md` §3；`PROJECT_STATUS.md` §35.6 / §35.11.4 |
| Waves 1–2 无独立验收记录 | **历史事实** —— 实施记录见 `docs/acceptance/sales-customer/wave-0-2-implementation-records.md`；按 AGENTS.md §4.6 引用规则，该目录整体为 `PENDING_DOMAIN_AUDIT`，本轮逐项复核后可逐份重判 | `docs/acceptance/acceptance-record-revalidation-20261112.md` |
| Wave 8「待提交」 | **历史事实已消解** —— `docs/acceptance/sales-customer/wave-8-final-acceptance-and-freeze.md` 已存在并含 `WAVE8_FINAL_ACCEPTANCE_PASS`；`PROJECT_STATUS.md` §35 表格中的「Wave 8 待提交」是**状态表未更新**，非事实缺口 | `PROJECT_STATUS.md` §35 快照表 |
| 真实 MySQL 证据 | 本域**无专属 campaign**；按 `MYSQL-EV-01` 统一口径（`docs/decisions/mysql-evidence-policy-20261112.md`），schema 对等可由 `test:mysql:accounting-analytics` 的全量 bootstrap 覆盖，但**行为等价在真实 MySQL 上未被单独取证**，必须作为显式残余登记，或按所有者「逐域新建专属 campaign」的裁定新建 | `docs/decisions/mysql-evidence-policy-20261112.md`；`docs/acceptance/inventory-warehouse-domain-acceptance-20261113.md` §2.1 |
| `AGENTS.md` §4.6 引用规则 | 本台账引用的域内历史记录整体处于 `PENDING_DOMAIN_AUDIT` 类别；本轮复核后须在 `docs/acceptance/acceptance-record-revalidation-20261112.md` 中重判 | `AGENTS.md` §4.6 |

## 6. 整改轮（2026-11-13）—— 所有者裁定与实施结果

### 6.1 所有者裁定

业务所有者于本轮就三项待决事项作出裁定：

| 事项 | 裁定 |
|---|---|
| D-2～D-5 四项开放设计决策 | **全部按 Design §37.54.17 已写明的推荐值实施**：D-2 整数 milli-point / milli-weight、禁止插值与浮点；D-3 模型 / 方案 / 指标不设独立版本表，沿用 Wave 9 生效日期版本化；D-4 评分表创建时固定 profile 版本、apply 时版本变化 fail closed（409 `CREDIT_RATING_TARGET_PROFILE_CHANGED`）；D-5 `credit_evaluation_result` 对 sheet 唯一、重新评价须新建评分表 |
| 真实 MySQL 证据口径 | **新建 Sales 专属 campaign**（沿用库存域裁定「逐域新建专属 campaign」） |
| 整改范围 | **全量补齐**：信用三包（W11-B / W11-C / W11-D）+ 3 项 `PARTIAL` + SC80 / SC81 报表 + SC01 / SC06 / SC07 / SC19 的 operator 前端工作面 |

### 6.2 逐项能力判定（整改后）

| 阶段 | `COVERED` | `PARTIAL` | `MISSING` | `OUT_OF_SCOPE` |
|---|---|---|---|---|
| 整改前（2026-11-13 审计） | 31 | 3 | 2 | 0 |
| 整改后（2026-11-13 整改轮） | **36** | **0** | **0** | **0** |

3 项 `PARTIAL` 与 2 项 `MISSING` 的闭合方式：

| 能力 | 原判定 | 闭合方式 |
|---|---|---|
| CAP-1 | PARTIAL | `SC-DEF-01` 三个 SC01 控制开关接入生产消费方；`SC-DEF-08` 五个 operator 工作面（销售参数 / 销售组成员关系 / 可销范围规则 / 产品商业分类 / 价格覆盖授权）落地并注册为 contextual route |
| CAP-24 | PARTIAL | `SC-DEF-02` `sales_orders.reservation_intent_state` 接入真实生命周期；`SC-DEF-03` SC68 五个反应路径全部接线（SO 变更 / 取消 / 受控关闭 / 退货 / 补发），并补齐 Design §29.17.2 要求的 **Delivery → consume 已交付部分**（此前 `consumeReservationIntent` 无生产调用方） |
| CAP-27 | PARTIAL | `SC-DEF-04` SC80 销售毛利、**SC-DEF-05** SC81 四维度排行落地；`SC-DEF-06` SC78 由 3 类单据补齐到 6 类 |
| CAP-34 | MISSING | W11-D 信用对账与重算：`credit_recalculation_history` 表、`factDigest`、`POST /api/credit/reconciliation/check`（SC99）与 `/recalculate`（SC100） |
| CAP-36 | MISSING | W11-B 信用评估基础四表 + W11-C 聚合结果表 + `applyCreditRating` 单一评级写者 + 评分表全生命周期 + `credit-evaluation` 工作面 |

### 6.3 本轮记录的有界判断（须与冻结结论一并阅读）

| 编号 | 事项 | 判断与理由 |
|---|---|---|
| `SC-JUDGE-01` | SC01 `deliveryScheduleEnabled` 的执行面 | Requirement §34.3.1 要求 SC01 至少含「交货计划 / 数量控制」语义，但 SC34 使订单**头** `requested_delivery_date` 在提交时必填。字面「订单不得携带任何计划日期」的解释会让开关关闭时**所有订单都无法提交**，与 SC34 冲突。故执行面取**交货计划（行级计划日期偏离订单头承诺）**，订单头字段仍由 SC34 管辖。控制仍**非空洞**：有正反例断言 |
| `SC-JUDGE-02` | 预留数量单位域 | 预留意图数量恒为**产品基本单位**（它进入 canonical 库存锁与 Planning 预留）；订单行数量为**文档单位**。二者比较必须经订单行的 `base_quantity_num / base_quantity_den` 基本单位快照。本轮修正了整改初稿把订单行数量直接与意图数量比较的单位域错配 |
| `SC-JUDGE-03` | SO 变更时的预留反应 | Requirement §34.3.13 允许「重算**或**释放」。自动重算会使商业订单变更因 Planning 分配能力不足而失败 —— 这是对已签发 Wave 6 / Wave 7 受控变更路径的行为改变，且所有者未授权。故采用**释放**：变更后不再有预留覆盖订单已不携带的数量，无 Sales shadow balance；差额由既有 SC66 显式请求路径（同样经 owner adapter、预收门槛与组范围检查）重新申请 |
| `SC-JUDGE-04` | `factDigest` 数值归一 | `readOpenReceivables` 有意把超安全整数范围的遗留金额以**文本**读出（Wave 10 已冻结）。直接 `Number(...)` 会让两个不同的遗留金额碰撞成同一摘要，从而破坏 R100-2。故：安全整数归一为 `String(Number(v))`，超范围值**保留原文** |
| `SC-JUDGE-05` | P8 报表页签断言 | SC80 / SC81 是 Requirement §34.3.16 声明的 DOMAIN_OWNED 能力，需要 operator 入口。原 P8 断言「`REPORT_TABS` 恰好 5 项」被**收窄**为对规范键集合的**精确相等**断言（7 项），严格性不变且新增了「不得缺项」一侧的守卫 |

## 7. 冻结合同的显式 Supersession 登记

按 AGENTS.md §5 与库存域先例，以下既有冻结合同的断言被**显式取代**（收窄而非删除），并在本台账留痕：

| 编号 | 被取代的断言 | 原意 | 收窄后的形态 | 理由 |
|---|---|---|---|---|
| `SC-SUP-01` | `server/sales-customer-wave9-credit-foundation.test.js` —— 六个 Wave 11 表必须不存在 | **Wave 9 迁移不得创建任何 Wave 11 表** | 在**移除全部 Wave 11 表**的隔离库上单独运行 Wave 9 迁移，再断言 Wave 11 表仍不存在 | Wave 11 表已由各自的 Wave 11 registry 条目创建；对着完整 registry 断言「不存在」只会变成空洞断言 |
| `SC-SUP-02` | 同上 —— 「no module may rewrite applied rating history」（任何模块不得 `UPDATE credit_profile_ratings`） | 已应用评级历史不可被改写 | 允许**唯一**的 `superseded_at` 迁移 UPDATE；`rating_grade` / `applied_at` / `applied_by` / `evaluation_result_id` 仍**禁止**出现在任何 UPDATE 中 | Design §37.54.10.6 明文规定仅 `superseded_at` 可迁移 |
| `SC-SUP-03` | `server/migrations/sales-customer-wave9-credit-foundation.js` —— `credit_profile_ratings` 外键集合漂移即 fail closed | 冻结表的外键集合不得漂移 | 容忍**恰好一条**具名新增外键 `fk_credit_profile_ratings_evaluation_result`；任何其他新增外键仍 fail closed | Design §37.54.10.8 / §37.54.12.3 的兼容性 schema 扩展；沿用该文件既有的「approved additive suffix」例外形态 |
| `SC-SUP-04` | `server/sales-customer-wave10-credit-check.test.js` —— Wave 11 表必须不存在 | **Wave 10 迁移不得创建任何 Wave 11 表** | 在移除全部 Wave 11 表的隔离库上单独运行 Wave 10 迁移，再断言 Wave 11 表仍不存在 | 同 `SC-SUP-01` |
| `SC-SUP-05` | `server/v16-p8-flow-consistency.test.js` —— `REPORT_TABS` 恰好 5 项 | 报表切换器只渲染规范报表键 | 对 7 项规范键的**精确集合相等**断言 | SC80 / SC81 需要 operator 入口；精确相等比计数更强 |
| `SC-SUP-06` | `scripts/sales-customer-wave11-a-primitives.test.js` T5 —— 当前 `credit-check.js` 源必须等于逾期证据前瞻链的冻结摘要 | 冻结证据链的每一环都是不可变的历史链接 | **八个历史链接全部保持不变且互不相同**；新增第九环 `W11_D_FACT_DIGEST_CREDIT_CHECK_SHA256` 成为**当前**源证明 | Design §37.54.11.2 已**预告**：W11-D 追加 `factDigest` 后该冻结指纹**必然**失效，那是**基线推进**而非缺陷 |
| `SC-SUP-07` | 11 处路由计数契约（79 / 83） | 注册表路由集合的任何增删都必须被察觉 | 计数更新为 **85 / 89**，每处变更注释写明新增的 6 条 contextual route 来源 | 本域新增 6 条 contextual route（无 launcher 入口）；计数断言是**变更察觉器**，不是业务合同 |
| `SC-SUP-08` | `server/v15-d10-final-ux-acceptance.test.js` —— D10 routes visit manifest 79 条全部 PASS | 每条可呈现路由都必须被逐条走查 | manifest 由 `ROUTE_PRESENTATIONS` 派生，计数随注册表更新为 **85** | 同 `SC-SUP-07` |
| `SC-SUP-09` | `server/v16-p8-flow-consistency.test.js` —— 启用 + 停用路由总数 83 | 停用路由集合固定为 4 条 | 总数更新为 **89**（85 + 4） | 同 `SC-SUP-07` |
| `SC-SUP-10` | `server/v16-sitewide-rollout.test.js` —— 冻结 V1.6 矩阵必须精确覆盖每条启用路由一次 | 冻结矩阵不被后续域闭环保留重写 | 6 条 Sales 域路由进入 `laterRoutes` 与 `matrixWhitelist`（它们**携带自己的域级验收证据**，不重写冻结矩阵） | 同 `SC-SUP-07`，且沿用该文件既有的「later routes carry their own evidence」形态 |
| `SC-SUP-11` | `server/v16-p7-decision-reports.test.js` —— `useReport` 必须以 `api(endpoint` 调用 | useReport 每个 effect 只发一次请求，并把已应用过滤器合并进同一个 query | 断言改为**语义**形态：hook 内 `api(` 调用**恰好一次**、用 `URLSearchParams` 合并、`params.set` 替换重复键 | 报表视图选择器（`?report=gross-profit`）必须与已应用过滤器合并且**不得**追加重复键；请求合同未变，只是参数拼装方式改变 |
| `SC-SUP-12` | `server/sales-customer-wave0-migration-runner.test.js` —— Wave 11 表必须不存在 | **Wave 11 之前的迁移不得创建任何 Wave 11 表** | 新增隔离用例：在移除全部 Wave 11 表的临时库上只重放 pre-Wave-11 迁移集，断言 Wave 11 表仍不存在 | 同 `SC-SUP-01`，Wave 11 边界因此仍然可证 |

**没有任何断言被删除**。十二处收窄各自保留了原断言的保护对象，且在台账留痕。

## 8. 未发生事项

- 未签发任何 Acceptance / Freeze token；未签发 Manual Closure（B3102 / B3103）、Release Readiness、发布或部署。
- 未执行真实环境 migration、业务数据库写入、真实 MySQL 运行、push / merge / tag / 发布 / 部署。
- 真实 MySQL campaign 的**运行**尚未执行 —— ACK-4 capability 只能由所有者用受保护 launcher 一次性签发，本轮只完成 campaign 基础设施与其离线夹具校验。

