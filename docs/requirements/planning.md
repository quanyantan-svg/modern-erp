# Planning — Requirement

> 状态：`ACTIVE`
> Owner：Planning
> 权威来源：`document.md` §30
> 来源：`document.md` §30（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 30. Planning Domain Closure Requirement

> 本节固化 B3120 Planning Domain Closure 的 Audit / Coverage / Requirement。
> 未直接读取用户原始 Word 手册；Manual Evidence 来自本轮 Prompt 中由上游提取的 B3120，并由 B3118/B3119/B3101/B3104/B3121 支撑。Technical Design 见 `solution.md §25`。

### 30.1 范围与 ownership

Planning 负责 Forecast、Consumption、Demand/Supply calculation、MRP、Pegging、Planned Order、Reservation relationship、Planner Workbench、planning exception、cascade preview/apply 以及 Production/Purchase/Outsource planning handoff。Planning 不拥有 BOM/Substitute master、Production/Purchase/Outsource execution、physical inventory truth、AP/accounting 或 Multi-Organization。

### 30.2 PL-01 ～ PL-45 Capability Audit Matrix

| ID | Capability / repository evidence | Current coverage | Gap / implementation decision |
|---|---|---|---|
| PL-01 | 计划参数；当前无 authoritative source | `MISSING` | `NEW`：singleton 参数，至少包含 reservation enabled |
| PL-02 | `products.reorder_point/min_stock/max_stock/lead_time_days` 存在，Product API 未形成完整策略 | `PARTIAL` | `CONVERGE`：Planning material policy；legacy 值只迁移/投影，补 safety stock 与 EOQ |
| PL-03 | 当前 `有 ACTIVE BOM→MAKE，否则 BUY` | `SEMANTIC_MISMATCH` | `NEW`：bounded `AUTO/MAKE/BUY/OUTSOURCE`；其它截图字段 `DEFER_SOURCE_DETAIL` |
| PL-04 | 无 Planning Scheme entity | `MISSING` | `NEW`：可复用 scheme；组织范围维持单组织 `OUT_OF_SCOPE` |
| PL-05 | MRP run 有 horizon，但无 scheme default/snapshot | `PARTIAL` | `ENHANCE`：scheme default + run override + completed snapshot |
| PL-06 | Sales/Forecast/BOM component 存在；Safety Stock 不存在 | `PARTIAL` | `ENHANCE`：可扩展 demand-source rows，纳入 safety-stock floor |
| PL-07 | On-hand、open PO、open production 已有；planned supply 无 | `PARTIAL` | `ENHANCE`：source selection + Planned Order supply；Outsource execution deferred |
| PL-08 | 当前库存基本全仓汇总；无 MRP warehouse scope | `MISSING` | `NEW`：scheme↔warehouse participation；不复制 warehouse master |
| PL-09 | Forecast DRAFT→ACTIVE→CANCELLED、期间和 item 已有 | `COVERED` | `KEEP` 并在 consumption/read model 中增强 |
| PL-10 | ACTIVE 可稳定表达“已下达/生效” | `COVERED` | `KEEP` storage enum；presentation 显示业务语义，不做机械 rename |
| PL-11 | `MAX(total sales,total forecast)` 只做 product/run aggregate | `SEMANTIC_MISMATCH` | `NEW`：explicit Forecast Consumption allocation |
| PL-12 | 无 Forecast Consumption Result 查询 | `MISSING` | `NEW`：bucket/original/consumed/remaining/SO/date trace |
| PL-13 | `demand_source_mode` 与 calculation scope 混在 run 输入 | `MISSING` | `NEW`：`GLOBAL/SELECTED/PRECISE_SELECTED` + explicit selections |
| PL-14 | MRP DRAFT→COMPLETED/CANCELLED，completed snapshot 不回写 | `COVERED` | `KEEP`；rerun 新建，Planned Order 不反写 result |
| PL-15 | 只有 summary/audit；无参与文档、配置、warning/error execution log | `PARTIAL` | `ENHANCE`：immutable MRP log 与 source/config snapshot |
| PL-16 | on-hand/open purchase/open production、多层 BOM、net-before-explosion 已有 | `COVERED` | `KEEP` mathematical invariants，按 scheme/time phase 扩展 |
| PL-17 | 结果以 product/horizon 聚合；需求有 need_date 但供应无统一 event | `PARTIAL` | `NEW`：time-phased demand/supply events/read model |
| PL-18 | APPROVED SO remaining + `requested_delivery_date`，legacy fallback 明确 | `COVERED` | `KEEP` authoritative date/lifecycle |
| PL-19 | safety stock 未参加 MRP | `MISSING` | `NEW`：planning floor；每 product/horizon 只补足一次，禁止 bucket 重复需求 |
| PL-20 | APPROVED PO minus CONFIRMED receipt，避免已收货重复计 open supply | `COVERED` | `ENHANCE`：expected date、scheme/warehouse eligibility |
| PL-21 | Planning 仍只认 `PENDING/IN_PROGRESS` | `SEMANTIC_MISMATCH` | `CONVERGE`：仅 `RELEASED/IN_PROGRESS` 为 firm production supply；receipt 扣减 |
| PL-22 | Planning 直接查 ACTIVE BOM | `SEMANTIC_MISMATCH` | `CONVERGE`：统一 `resolveEffectiveBomForCaller`，传 purpose/business date |
| PL-23 | 多层/损耗/cycle/net-before-explosion/shared aggregation 已有 | `COVERED` | `KEEP`，新增能力不得回退 |
| PL-24 | Engineering substitute master/resolver 已有；Planning 未消费 | `MISSING` | `ENHANCE`：保守消费；MANUAL 只建议，复杂细节不足则 partial |
| PL-25 | 无 Material Substitute Suggestion 查询 | `MISSING` | `NEW`：主料/替代/availability/source/date/strategy/method/quantity basis |
| PL-26 | `mrp_run_pegging` 已解释来源贡献 | `COVERED` | `KEEP` |
| PL-27 | 无 Reservation，不能以 Pegging status 代替 | `MISSING` | `NEW`：独立实体和语义 |
| PL-28 | 无 Strong Reservation | `MISSING` | `NEW`：MRP/人工建立；firm supply 超分配 fail closed |
| PL-29 | 无 Weak Reservation | `MISSING` | `NEW`：MRP 建立，可按策略释放/被更高优先级替代 |
| PL-30 | 无 reservation release policy | `MISSING` | `NEW`：`KEEP_ALL/RELEASE_WEAK` 并真实参与 run preparation |
| PL-31 | 无 Manual Reservation Order | `MISSING` | `NEW`：无现存 supply 时可指定 expected supply + release date |
| PL-32 | `mrp_run_results` 是 snapshot，不是 Planned Order | `MISSING` | `NEW`：MRP/manual Planned Order entity |
| PL-33 | 无 Planned Order lifecycle | `MISSING` | `NEW`：DRAFT→CONFIRMED→RELEASED→CLOSED；CANCELLED 安全分支 |
| PL-34 | 无 split | `MISSING` | `NEW`：transaction、quantity conservation、source trace/reservation adjustment |
| PL-35 | 无 merge | `MISSING` | `NEW`：product/type/policy/date/downstream compatibility guard |
| PL-36 | 无 batch maintenance | `MISSING` | `NEW`：preview→apply、全批 atomic、audit |
| PL-37 | 无 supply target change | `MISSING` | `NEW`：release 前 `MAKE/BUY/OUTSOURCE` 受控变更并记录 reason |
| PL-38 | Manufacturing 已有 bounded byproduct execution；Planning 无 planned output | `MISSING` | `NEW`：planned byproduct quantity；成本继续属 Finance |
| PL-39 | Instruction bridge 已有；缺 Planned Order source/remaining control | `PARTIAL` | `ENHANCE`：Planned Order→Instruction，累计释放不得超量 |
| PL-40 | 无 Planner Workbench | `MISSING` | `NEW`：动态 current balance、exceptions、actions |
| PL-41 | 无 Cascade Adjustment | `MISSING` | `NEW`：Sales/Forecast preview-first bounded apply |
| PL-42 | 无统一 Material Supply/Demand Status | `MISSING` | `NEW`：time bucket、on-hand/future supply/demand/projected/max warnings |
| PL-43 | 无共享 Summary→Detail read model | `MISSING` | `NEW`：同一 event/read model，禁止第二套算法 |
| PL-44 | 无 Order Supply/Demand Status | `MISSING` | `NEW`：Forecast/SO→planning/release/execution bounded trace |
| PL-45 | 无 Reservation comprehensive/trace query | `MISSING` | `NEW`：Demand→Reservation→Supply 与反向查询 |

### 30.3 Requirement contracts

#### Planning foundation

- `reservation enabled` 只允许一个 authoritative parameter source；关闭时禁止新增 reservation，但保留历史查询。
- Material policy 每个 product 最多一条 active truth，字段至少含 safety stock、reorder point、maximum stock、EOQ、lead time、`AUTO/MAKE/BUY/OUTSOURCE`。`AUTO` 是兼容 heuristic；其它手册截图细节不猜测。
- Planning Scheme 具有 code/name/active lifecycle、horizon、demand/supply source rows、calculation scope default、reservation release policy、merge/release policy和 warehouse participation。当前不增加 organization model。

#### Forecast consumption and events

- Consumption 只使用 ACTIVE forecast bucket 与 APPROVED Sales Order remaining demand；按同 product、同 run horizon、Sales need date/source identity 确定性分配；单一 Sales quantity 不得超额消费，单一 forecast bucket 不得变成负数。
- 保存每次 completed run 的 consumption allocation；Forecast 后续状态/数据变化不得重写历史。
- Demand/Supply event 至少保存 product、event date、source type/id/line、quantity、direction、status、warehouse、run；业务源仍是 authoritative document，不复制 source master。

#### MRP

- completed run immutable，scheme/config/source selections/log/event/result/pegging 均为 snapshot；重算必须新建 run。
- `GLOBAL` 取 scheme 范围内全部 eligible sources；`SELECTED` 取选中来源涉及产品的 eligible demand；`PRECISE_SELECTED` 只取明确 source rows，BOM 下阶需求只由已选 demand 驱动。
- 现有 net-before-explosion、cycle detection、scrap、shared-component aggregation 保持。
- Production firm supply 仅来自 `RELEASED/IN_PROGRESS` 未入库余量；DRAFT/SUBMITTED/APPROVED/REJECTED/CANCELLED 不计 firm supply。
- Safety Stock 是 projected balance floor，不是每 bucket 重复 transactional demand。
- BOM 必须通过 Engineering resolver；Substitute 的 MANUAL strategy 只生成 suggestion。

#### Planned Order and release

- Planned Order 独立于 immutable `mrp_run_results`，来源为 MRP 或 MANUAL；保存 source links、quantity/date/type/status、reservation/release state与 audit。
- split/merge/target-change/batch 在 transaction 中重读状态和累计 release；数量守恒，来源 trace 不丢，失败零副作用。
- MAKE：Planned Order→Production Instruction→canonical Manufacturing create command；禁止第二个 Production Order constructor。
- BUY：Planned Order→Purchase Instruction→Purchase Requisition；采购执行 owner 不变。
- OUTSOURCE：Planning target/handoff 可用；完整 Outsourcing Order/Issue/Receipt/AP 为 `CROSS_DOMAIN_DEPENDENCY`。

#### Reservation

- Pegging 与 Reservation 分表、分语义。
- Strong/Weak/Manual reservation 数量必须为正，不得超过 remaining demand 或 eligible supply；并发时 transaction/lock 防 over-reserve。
- Strong Reservation 被 Sales Delivery 与 Production Material Issue 的 centralized guard 尊重；Planning 不建立第二库存账。
- Weak reservation 可按 scheme `RELEASE_WEAK` 在新 run preparation 时释放；Strong 不被该策略释放。release date 到期的 manual reservation 显式转为 RELEASED。

#### Workbench, reports and cascade

- Workbench 使用当前 authoritative source 构建动态 balance，不以历史 run 冒充当前状态；按 time bucket 展示 projected balance、shortage/excess/safety stock/reservation/exception。
- 所有供需、预测冲销、预留、替代与 MRP 日志查询复用同一 read model/source service。
- Cascade apply 只允许修改 DRAFT/CONFIRMED 且未释放的 Planning entity；执行中 Production、已收货 Purchase、Inventory、Accounting 一律作为 blocker，禁止自动改写。

### 30.4 Permission / compatibility

- 保留 `MRP_VIEW/MRP_MANAGE` 兼容；新增最小 Planning permission family：configuration、planned-order release、reservation manage；后端独立 fail closed。
- 不删除/重命名现有 Forecast/MRP/Instruction/Requisition route/API；新字段和 endpoint additive。
- Legacy `/api/mrp/calculate`、`/api/mrp/bom-explode`、`/api/mrp-plans*` 必须完成 caller proof：无 caller 时退出 active authority；需要兼容时只能适配 canonical service，不保留第二套算法。历史表不 DROP。

### 30.5 Data / migration / rollback

- schema additive、idempotent，保留历史 run、instruction id、production/procurement facts；SQLite/MySQL parity。
- Planned Order、Reservation、Forecast Consumption 必须是结构化核心实体，不以 generic JSON blob 替代；snapshot/log payload 可使用 bounded JSON。
- rollback 以应用代码回退和新增结构停止写入为主；不 destructive down-migrate，不 DROP legacy table，不伪造历史。

### 30.6 Acceptance

- focused：foundation、forecast、MRP modes/time phase/BOM/substitute、planned order、reservation/execution guards、workbench/report/cascade、downstream command、legacy convergence；
- canonical：`pnpm test:fast`、`pnpm test`、`pnpm test:heavy`、`pnpm build`、`git diff --check`；
- database：受保护 disposable MySQL 环境的**真实门禁**。本仓库当前只有三个已批准的 ACK-4 campaign 可以运行：`pnpm test:mysql:m1-core`、`pnpm test:mysql:accounting-analytics`、`pnpm test:mysql:out001`；其余 MySQL 入口（`test:mysql`、`test:mysql:concurrency`、`test:mysql:legacy`、各 Sales Wave 门禁）由 `blockUnmigratedAck4Entry` **永久阻断**，不得被引用为证据。本域据此把数据库证据拆成两段，并明确各自证明什么：
  1. **schema / migration 对等**：由 `pnpm test:mysql:accounting-analytics` 的 `BOOTSTRAP_CURRENT_SCHEMA` 覆盖 —— 该步骤在真实 MySQL 8 上运行**全量当前迁移集**，因此 Planning 的全部迁移与表结构在真实 MySQL 上的可接受性由该 campaign 证明；
  2. **release / reservation 行为对等（不双发、不超分配）**：由本域 focused 套件（含并发与幂等反例）覆盖。**本域当前没有专属 ACK-4 campaign**，因此「真实 MySQL 上的 release/reservation 行为等价」**未被单独取证**；域级 Acceptance 必须把它显式登记为残余，不得表述为已证明。若业务所有者要求该证据，须先新增 `PLANNING_MYSQL_V1` manifest 与域级 campaign；在此之前本域不得声称已取得真实 MySQL 行为证据。
- browser：Forecast、MRP、Planned Orders、Planner Workbench、Instruction flow、Planning Configuration/Reservation 在 320/390/430/680 CSS px 无 document overflow，主要动作、长编码、time bucket、trace、split/merge、source selection 可用。

### 30.7 Explicitly deferred / out of scope

- `OUT_OF_SCOPE_PRODUCT_BASELINE`：Multi-Organization；
- `CROSS_DOMAIN_DEPENDENCY`：完整 Outsourcing execution、Procurement sourcing、physical Inventory status/lock 深化；
- `SOURCE_DETAIL_INSUFFICIENT`：截图级 Manufacturing Strategy 全字段、金蝶精确 forecast time-fence、复杂 substitute 数量算法；
- 不实施 generic APS、Finance rewrite、Generic Workflow、destructive cleanup 或 legacy table DROP。

---

**PLANNING DOMAIN CLOSURE REQUIREMENT — APPROVED BY CONTINUOUS USER AUTHORIZATION FOR DESIGN & IMPLEMENTATION**

---
