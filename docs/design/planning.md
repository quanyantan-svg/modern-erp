# Planning — Technical Design

> 状态：`ACTIVE`
> Owner：Planning
> 权威来源：`solution.md` §25
> 来源：`solution.md` §25（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## 25. Planning Domain Technical Design

> Requirement：`document.md §30`。本设计按 Waves A–H 连续实施；每 Wave focused PASS 后进入下一 Wave。

### 25.1 Ownership and modules

| Module | Responsibility |
|---|---|
| `server/modules/planning.js` | Forecast、canonical MRP orchestration、immutable run snapshot；保留成熟 net-before-explosion 数学 |
| `server/modules/planning-domain.js` | 参数、物料策略、Scheme、Forecast Consumption、event/read model、Planned Order、Reservation、Workbench/Reports、Cascade |
| `server/modules/planning-documents.js` | Instruction/Requisition bridge；只接收 Planned Order/release contract，不再构造 Production Order |
| `server/modules/manufacturing-orders.js` | 提供唯一 `createProductionOrderCommand`；HTTP manual create 与 Planning conversion 共同调用 |
| `server/modules/planning-reservation.js` | centralized strong-reservation availability/consumption guard；Sales Delivery 与 Production Issue 复用 |
| `server/migrations/planning-domain-schema.js` | Planning Closure additive schema；SQLite/MySQL canonical snapshot source |

`server/app.js` 只做 route facts/dispatch；permission、transaction、audit 保持 handler runtime authority。

### 25.2 Planning parameters and material policy

- `planning_parameters` 使用 singleton key `DEFAULT`，字段 `reservation_enabled`、timestamps、updated_by。
- `planning_material_policies` 以 `product_id` 唯一，字段：`safety_stock`、`reorder_point`、`maximum_stock`、`economic_order_quantity`、`lead_time_days`、`supply_strategy`、timestamps/actor。
- 首次 migration 按 `products.min_stock/reorder_point/max_stock/lead_time_days` 初始化 policy；此后 Planning API 是唯一编辑面。legacy columns 保留为兼容 projection，并由 Planning policy mutation 同事务更新，旧 dashboard 只读查询继续得到一致值；Product API 不提供这些字段的活动写入路径。
- strategy precedence：run-specific approved override（本轮仅 scheme `force_supply_strategy`）> material policy explicit `MAKE/BUY/OUTSOURCE` > `AUTO`。`AUTO` 才允许以 effective Engineering BOM presence 推断 MAKE，否则 BUY。

### 25.3 Planning Scheme

Tables：

- `planning_schemes`：code/name/status(`DRAFT/ACTIVE/INACTIVE`)、horizon_days、default calculation scope、reservation release policy(`KEEP_ALL/RELEASE_WEAK`)、merge policy、release defaults、force strategy nullable、overdue-supply policy；
- `planning_scheme_demand_sources`：scheme/source_type unique，至少 SALES_ORDER/FORECAST/SAFETY_STOCK/BOM_COMPONENT；
- `planning_scheme_supply_sources`：ON_HAND/PURCHASE_ORDER/PRODUCTION_ORDER/PLANNED_ORDER；
- `planning_scheme_warehouses`：scheme_id/warehouse_id/participates；warehouse master 不复制。

只有 ACTIVE scheme 可用于新 run。MRP run 保存 `scheme_id` 和 immutable `scheme_snapshot`；允许显式 horizon override，实际值写回 run snapshot。

### 25.4 Forecast consumption

`forecast_consumptions` 是 run snapshot allocation：`run_id/forecast_item_id/sales_order_id/product_id/sales_need_date/quantity/created_at`，唯一 allocation id，不修改 forecast item。

Bounded rule：

1. 只取同 product、run horizon 内 ACTIVE forecast bucket；按 `need_date, forecast_item_id` 排序；
2. APPROVED SO remaining rows按 `need_date, order_id` 排序；
3. 每个 SO 依次消费尚有余额的 bucket；先 `bucket.need_date <= sales.need_date`，再按日期顺序使用 horizon 内后续 bucket；
4. allocation quantity = `min(sales remaining, forecast remaining)`；不得为负/超 bucket/超 SO；
5. 未消费 Sales 仍是 demand；未消费 Forecast 仍是 demand；最终 top demand = Sales + remaining Forecast，而不是 `MAX(total)` 隐藏关系。

该规则是 Modern ERP bounded implementation，不声称复制金蝶 time-fence 算法。

### 25.5 Time-phased events and source selection

`mrp_run_events` 保存 completed run input/output event snapshot：direction(`DEMAND/SUPPLY`)、source_type/id/line、product、event_date、warehouse、quantity、status、firm、metadata snapshot。`mrp_run_source_selections` 保存显式选择。

- `GLOBAL`：全部 eligible source rows；
- `SELECTED`：以选中 source 涉及的 products 为 operation range，再取这些 products 的 eligible demand；
- `PRECISE_SELECTED`：只取 exact source rows；BOM child demand 仅从所选 top demand 产生。

Opening on-hand 作为 horizon start 的 SUPPLY event；SO/Forecast/Safety/BOM component 是 DEMAND；open PO/production/planned order 是 SUPPLY。事件统一服务 calculation、Workbench、status/summary/detail reports。

### 25.6 Time-phased netting and safety stock

每 product 按 `event_date, demand-before-supply, source identity` 确定性排序：

```text
projected = opening on-hand
for event:
  projected += supply
  projected -= transactional demand
  shortage = max(0, safety_stock - projected)
```

Safety stock 是 floor；只在首次跌破 floor 时形成补足净需求，不在每个 bucket 重复叠加。现有 aggregate-before-netting/net-before-explosion 继续决定 BOM explosion quantity；time events提供日期与解释，不另建第二套计算器。

### 25.7 Supply source contracts

- on-hand：canonical inventory/LOT/SERIAL available quantity，按 scheme warehouse scope聚合；HOLD/expired identity不计；
- purchase：APPROVED PO remaining = ordered - CONFIRMED receipt，event date 优先 expected_delivery_date；已收货只进入 on-hand，避免双算；
- production：仅 RELEASED/IN_PROGRESS order remaining = order quantity - confirmed receipt，DRAFT/SUBMITTED/APPROVED/REJECTED/CANCELLED 不计 firm supply；
- planned：CONFIRMED 且未 release/close/cancel 的 Planned Order remaining，release 后由 instruction/downstream supply替代，禁止双算。

### 25.8 Engineering resolver and substitute planning

- Planning 不再查询 `boms.status='ACTIVE'`；调用 `resolveEffectiveBomForCaller(db, productId, purpose, businessDate)`（扩展 resolver 接受日期但不复制 eligibility SQL）。MAKE 使用 SELF_MAKE→GENERAL fallback。
- BOM tree仍用已解析 root/child effective BOM；cycle/max-depth/net-before-explosion 保持。
- `findSubstitutes` 提供 effective candidates。MANUAL 仅写 `planning_substitute_suggestions`；MIXED/BATCH/BATCH_MIXED 只在 primary shortage 且 substitute availability positive 时给出保守建议/可用抵扣，任何不明确比例不自动替换。

### 25.9 MRP immutable snapshot and log

`mrp_runs` additive：`scheme_id/scheme_snapshot/calculation_scope_mode/config_snapshot/started_at/failed_at/error_code/error_message/duration_ms`。`mrp_run_logs` 记录 phase、status、counts、warning/error，不含 secret。

执行过程先在内存收集 input；单 transaction 重读 run DRAFT、准备 weak release、写 selections/consumption/events/results/pegging/log，最后更新 COMPLETED。业务校验失败写 FAILED diagnostics 需要独立安全 transaction，不留下 result/event 半成品。completed run禁止 mutation。

### 25.10 Planned Order

Tables：

- `planned_orders`：order_no/source_type(`MRP/MANUAL`)、mrp_run/result、product、quantity、need_date/planned_supply_date、supply_type(`MAKE/BUY/OUTSOURCE`)、status(`DRAFT/CONFIRMED/RELEASED/CLOSED/CANCELLED`)、released_quantity、reservation state、version、actor/timestamps；
- `planned_order_source_links`：order/source_type/source_id/source_line/quantity，保留 split/merge lineage；
- `planned_order_byproducts`：planned order/product/quantity。

MRP materialization 对 `mrp_result_id` 幂等；manual order显式创建。mutation 使用 no-op row update取得 SQLite/MySQL portable write lock并在 transaction 内重读 version/status/released qty。

- split：parent quantity减为保留量，新 child继承 proportion source links，数量总和不变；已 release qty不能被切走；
- merge：仅同 product/type/status/policy/date compatible 且无 released downstream；新/目标 row聚合 source links，原 rows CLOSED with merge target；
- target change：DRAFT/CONFIRMED、released_quantity=0；记录 old/new/reason audit；
- batch：preview token/hash绑定当前 versions；apply重读全部 rows，任一冲突全回滚。

### 25.11 Reservation

`planning_reservations`：reservation_no/type(`STRONG/WEAK/MANUAL`)、demand source type/id/line、supply source type/id/line、product/warehouse、quantity、priority、release_date、status(`ACTIVE/RELEASED/CONSUMED/CANCELLED`)、source run/scheme、actor/timestamps/version。

- transaction 内按稳定 identity 顺序 no-op update supply rows，再计算 ACTIVE reservation sum；positive、demand remaining和supply eligible remaining全部检查；
- weak release policy在 MRP执行开始释放本 scheme/source run 的 WEAK，不影响 STRONG；到期 manual reservation显式 release；
- centralized guard `assertStrongReservationAvailability` 输入 product/warehouse/qty/current demand identity，计算物理可用量减去“属于其它 demand 的 ACTIVE STRONG”；Sales Delivery demand=`SALES_ORDER`，Production Issue demand=`PRODUCTION_ORDER`；
- guard 只限制 execution，不写 inventory balance；真正 inventory/identity/valuation仍由原 handler。

### 25.12 Workbench and reports

`buildPlanningBalanceReadModel(db,{from,to,bucket,schemeId,productId})` 是唯一动态 read model：从当前 SO/Forecast/PO/Production/Inventory/Planned Order/Reservation authority生成 events并投影 projected/shortage/excess/safety/max/exception。

Endpoints复用该 service：

- `/api/planning/workbench`；
- `/api/planning/reports/supply-demand/{status,summary,detail}`；
- `/api/planning/reports/order-supply-demand`；
- `/api/planning/reports/forecast-consumption`；
- `/api/planning/reports/reservations` 与 `/trace`；
- `/api/planning/reports/substitute-suggestions`；
- `/api/planning/reports/mrp-log`。

### 25.13 Cascade adjustment

`planning_cascade_changes` 保存 source、requested qty/date、preview snapshot/hash、status。Preview追踪 demand→Planned Order→Instruction→downstream；blocker包括 released planned order、非 DRAFT instruction、Production RELEASED/IN_PROGRESS/COMPLETED、received purchase、任何 inventory/accounting evidence。Apply验证hash与版本，只修改 Planning DRAFT/CONFIRMED objects，transaction + audit；不做 Generic Change Engine。

### 25.14 Release integration

- Planned Order CONFIRMED 才能 release；row lock后以 `quantity-released_quantity` 限制转换。
- MAKE/BUY生成或追加 Instruction item并写 `planned_order_id` source；Instruction仍是 execution bridge。
- `createProductionOrderCommand(db,{actor,input})` 成为 Manufacturing唯一 constructor：验证 active product、Engineering resolver/explicit BOM、创建 DRAFT order、snapshot BOM/material/routing/control facts、保存 instruction source。HTTP create与Planning conversion共同调用；Planning不得 HTTP self-call。
- OUTSOURCE release创建 `planning_outsource_handoffs`（PENDING）供后续 Domain消费；不创建虚假 Outsourcing Order。

### 25.15 Legacy convergence

对 `/api/mrp/calculate`、`/api/mrp/bom-explode`、`/api/mrp-plans*` 做 repo caller proof。活动 frontend改到 canonical Planning route；旧 endpoints 若仍需测试/兼容则调用 canonical read/calculation service并标记 compatibility response，不再保留独立 BOM/MRP math。historical `mrp_plans*` tables保留且不 DROP。

### 25.16 RBAC / audit / errors

新增：`PLANNING_CONFIG_MANAGE`、`PLANNED_ORDER_RELEASE`、`PLANNING_RESERVATION_MANAGE`；保留 `MRP_VIEW/MRP_MANAGE`。admin继承；现有角色不自动扩大，只有既有 planner/admin路径按当前 seed明确赋予。

关键 audit：parameter/policy/scheme、MRP execute/fail、planned order create/confirm/split/merge/target/release/close/cancel、reservation create/release/consume、cascade apply。业务冲突返回 409，validation 400，permission 403，missing 404；不得吞 lock/deadlock。

### 25.17 Migration / MySQL / rollback

Migration additive、`CREATE TABLE/INDEX IF NOT EXISTS`、缺列才 add；SQLite base snapshot与MySQL reconciliation自动纳入。核心 entity不用 generic JSON；snapshot/log可用JSON text。无 destructive rollback：回退代码后新表保留，旧 route/schema/历史仍可读；不 down-migrate/drop。

MySQL concurrency gate增加：同一 Planned Order并发 release至多一次；同 supply并发 strong reservation总量不超 eligible；split/merge版本冲突一方失败且无半应用。

### 25.18 Frontend information architecture

Planning Launcher保持紧凑：Forecast、MRP、Planned Orders、Planner Workbench、Production Instruction、Purchase Instruction。Configuration/Reservation/Reports作为 Workbench/MRP contextual surface，不新增大量一级入口。

ERP Design Read: Planning daily work; primary task: diagnose shortage and safely release supply; density: 8; main layout issues: historical-run-only views, no traceable allocation or contextual actions; preserve: terminology, API/state/RBAC/source/inventory/accounting contracts.

- 390px：time bucket→exception summary→dense material rows/cards→trace sheet→single contextual primary action；
- Planned Order card：product/type/qty/need/planned/source/reservation/release/exception；
- Reservation明确显示 Demand ← quantity → Supply、Strong/Weak、priority/release/status；
- desktop增强密度但不另建业务 screen；320/390/430/680用现有 Edge/playwright-core验收。

### 25.19 Implementation Waves and gates

1. Wave A：schema、parameters、material policy、scheme/warehouse；
2. Wave B：forecast consumption、events/read model；
3. Wave C：scheme-driven MRP modes、time phase、Engineering resolver、V18 production supply、substitute/log；
4. Wave D：Planned Order lifecycle/split/merge/batch/target/byproduct/release；
5. Wave E：Strong/Weak/Manual Reservation + Sales Delivery/Production Issue guard；
6. Wave F：Workbench/reports/frontend；
7. Wave G：Cascade preview/apply；
8. Wave H：Manufacturing command、Purchase/Outsource handoff、legacy convergence。

每 Wave focused tests；最终运行 FAST/FULL/HEAVY/MySQL/MySQL concurrency/build/diff/browser responsive。MySQL环境缺失时最终状态必须为 `NOT READY — MYSQL VERIFICATION PENDING`。

---

**PLANNING DOMAIN CLOSURE DESIGN — APPROVED BY CONTINUOUS USER AUTHORIZATION FOR IMPLEMENTATION**

---
