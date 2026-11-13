# Inventory & Warehouse 库存与仓储域 — 域级能力审计基线（2026-11-12）

> **用途**：登记 B3104 / B3105 库存与仓储域**域级 Acceptance** 的逐项能力复核证据，覆盖 44 项能力（INV-01～INV-44），并登记本轮整改轮修复的真实缺陷、文档失真与随冻结接受的残余。
>
> **Owner**：Inventory & Warehouse Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`IMPLEMENTED`（逐项复核与整改轮均已完成）——**域级 Acceptance 与 Capability Freeze 尚未签发**，等待业务所有者裁定。
>
> **权威来源**：Requirement [`docs/requirements/inventory-warehouse.md`](../requirements/inventory-warehouse.md) §32.1～§32.10；Design [`docs/design/inventory-warehouse.md`](../design/inventory-warehouse.md) §27.52（44 项能力 → owner / schema 映射表）与 §27.54（验收口径）；能力基线 `document.md §22.4 / §22.5 / §32`；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件不改写合同正文，只记录**当前工作树上的复核结论**。

## 1. 复核方法与判定纪律

逐项定位 Requirement 条款、Design 条款、生产写入口（route + canonical owner）、可执行测试（文件 + 用例名）、前端入口，以及**能力的事实是否被业务路径消费**。

判 `COVERED` 需同时成立：① 有生产写入口或读入口，且服务端具备来源、状态机、权限、事务约束；② 有可执行测试覆盖正例且至少一个反例；③ Requirement §32.9 F 列出的 operator workflow 有前端入口（LIST → DETAIL → EDITOR / WORKFLOW）；④ 事实进入业务路径。

判 `PARTIAL` 的三种典型形态（本轮出现）：**能力实现完备但无前端入口**（后端 + focused 用例齐备，UI 缺失）；**能力仅由 legacy 路径实现，未进入 canonical 合同**；**能力依赖可选扩展点，扩展点未实现**。

**能力编号来源**：INV-01～INV-44 逐行对应 Requirement §32.3 的 44 行能力基线与 Design §27.52 的 44 行映射表，顺序与编号不变。

## 2. 复核结论摘要

| 阶段 | `COVERED` | `PARTIAL` | `OUT_OF_SCOPE` | `MISSING` |
|---|---|---|---|---|
| 整改前 | **29** | **15** | **0** | **0** |
| 整改后（2026-11-12 整改轮完成） | **42** | **2** | **0** | **0** |

整改后仍为 `PARTIAL` 的 2 项：

1. **INV-07 —— 未进入 canonical 变更合同**：INV-21 的库存调整 / 报废确认仍走 legacy tuple 写入 `adjustInventory`，不产生 canonical mutation log，也不校验库存锁。调拨、盘点、批号调整、形态转换、组装拆卸、原生单据、期初、状态变更、分步调拨均已走 `applyInventoryMutation`。
2. **INV-25 —— 可选扩展点未实现**：`inventory.aux_*` 辅助属性；Design §27.52 标注为 optional，canonical 身份维度（bin / owner / status / lot / serial）已全部实现并强制。

整改前为 `PARTIAL` 的 14 项中，**12 项因本轮补齐前端工作面而转为 `COVERED`**（INV-09 / INV-10 / INV-11 / INV-12 / INV-13 / INV-14 / INV-16 / INV-19 / INV-28 / INV-34 / INV-35 / INV-36 / INV-37 中的 13 项实现 + INV-28 的防超锁修复），**2 项保持 `PARTIAL`**（INV-07、INV-25）。

## 3. 44 项能力逐项复核（整改后判定）

| # | 能力 | 实现（owner / route / schema） | 测试 / UAT 证据 | 判定 | 缺口 |
|---|---|---|---|---|---|
| INV-01 | 库存参数 | `inventory-parameters.js` · `GET/PUT /api/inventory-parameters` · `inventory_parameters` | `inventory-position-integration.test.js` | COVERED | — |
| INV-02 | 仓库主数据与仓库属性 | `warehouses.js` · `GET/POST /api/warehouses`、`PATCH/DELETE /api/warehouses/{id}` · `warehouses`（bin_enabled / negative_stock_policy） | `v2-wave3a-warehouses-ownership.test.js`、`p2-data-lifecycle.test.js` | COVERED | Design §27.52 原写 `warehouse-master.js`，该模块不存在；实际 owner 为 `warehouses.js`（见 §4 `INV-DEF-12`） |
| INV-03 | 仓库仓位 | `warehouse-bin.js` · `GET/POST /api/warehouse-bins`、`PATCH /{id}`、`POST /{id}/deactivate` · `warehouse_bins` | `inventory-position-wave-a.test.js` | COVERED | — |
| INV-04 | 库存状态主数据 | `stock-status.js` · `GET/POST /api/inventory-stock-statuses`、`PATCH /{code}` · `inventory_stock_statuses` | `inventory-position-wave-a.test.js` | COVERED | — |
| INV-05 | 所有权维度 | `owner-dimension.js` · `GET /api/inventory-owner-dimensions` · `inventory.owner_type / owner_id` | `inventory-position-wave-a.test.js`、`inventory-mutation-wave-b.test.js` | COVERED | — |
| INV-06 | canonical 物理库存余额 | `lib/inventory-position.js` · `inventory.position_key` UNIQUE · 全部读路径经 `lib/inventory-compat-read.js` | `inventory-position-integration.test.js`、`inventory-domain-race.test.js` | COVERED | — |
| INV-07 | canonical 库存变更合同 | `lib/inventory-mutation.js`（`applyInventoryMutation`）· 负库存策略 / 库存锁 / 期间闸门 / 幂等键 / `inventory_mutation_log` | `inventory-mutation-wave-b.test.js`、`inventory-domain-race.test.js`、`inventory-domain-closure.test.js` | PARTIAL | 调拨、盘点、批号调整、形态转换、组装拆卸、原生单据、期初、状态变更、分步调拨均已走 `applyInventoryMutation`；**INV-21 的库存调整 / 报废确认仍走 legacy tuple 写入 `adjustInventory`**，不产生 mutation log，也不校验库存锁 |
| INV-08 | 可用量 / 预留投影 | `lib/inventory-availability.js` · `GET /api/inventory-availability` · on_hand / reserved / available 三层 | `inventory-mutation-wave-b.test.js` | COVERED | Integration-Backed（Planning 拥有预留） |
| INV-09 | 库存启用日期 | `inventory-opening.js` · `POST /api/inventory-initialization/open` · `inventory_initialization.enabled_at` | `inventory-stocktake-wave-c.test.js` | COVERED | 本轮补齐 `src/pages/inventory-work.jsx` 的「初始化与期初」工作面（开启 / 关闭 / 重新开启 + 期初单据列表 + 录入 + 确认） |
| INV-10 | 期初库存 | `inventory-opening.js` · `POST /api/inventory/opening-documents` + `/{id}/confirm` · `opening_inventory_documents / items` | `inventory-stocktake-wave-c.test.js` | COVERED | 同上；并为 `GET /api/inventory/opening-documents` 补只读列表入口，使期初单据具备 LIST → DETAIL 入口 |
| INV-11 | 初始化关闭 | `inventory-opening.js` · `GET /api/inventory-initialization`、`/open`、`/close`、`/reopen` · `inventory_initialization` | `inventory-stocktake-wave-c.test.js`、`inventory-domain-race.test.js` | COVERED | 同上 |
| INV-12 | 受托料收货 | `inventory-native-document.js` · `POST /api/inventory/native-documents`（ownerType=CUSTOMER，movementKind `ENTRUSTED_RECEIPT`） | `inventory-mutation-wave-b.test.js`、`inventory-domain-race.test.js` | COVERED | 同上；并为 `GET /api/inventory/native-documents` 补只读列表入口；受托料以 CUSTOMER 所有权登记在同一张原生单据上 |
| INV-13 | 其他入库 | `inventory-native-document.js` · 同上（`OTHER_RECEIPT`） | `inventory-stocktake-wave-c.test.js` | COVERED | 同上（「其他出入库」工作面） |
| INV-14 | 其他出库 | `inventory-native-document.js` · 同上（`OTHER_ISSUE`） | `inventory-stocktake-wave-c.test.js` | COVERED | 同上（「其他出入库」工作面） |
| INV-15 | 直接调拨 | **`inventory-transfer.js`（canonical owner）** · `GET/POST /api/inventory-transfers`、`GET /{id}`、`POST /{id}/transfer`、`/{id}/cancel` · `inventory_transfers / items` + `applyInventoryMutation` MOVE + 进侧估值承接（TRANSFER_CARRYING_VALUE） | `phase-e-inventory-approve.test.js`、`phase-e-inventory-migration.test.js`、`inventory-domain-closure.test.js`（本轮新增） | COVERED | 整改轮把两个写入口收敛为一个（见 §4 `INV-DEF-02`） |
| INV-16 | 分步调拨 / 在途 | `inventory-step-transfer.js` · `POST /api/inventory-step-transfers/out|in`、`GET /in-transit` · `inventory_step_transfer_in_transit` | `inventory-domain-race.test.js`、`outsourcing-wip-transfer.test.js` | COVERED | 本轮补齐「分步调拨」工作面（选择来源调拨单 → 调出进入在途 → 调入离开在途 + 在途量列表） |
| INV-17 | 组装 / 拆卸 | **`inventory-assembly-disassembly.js`** · `GET/POST /api/inventory/assembly-orders`、`POST /{id}/confirm`、`/api/inventory/disassembly-orders` + `/{id}/confirm` · `inventory_assembly_orders / items`；消费 `engineering-bom.js` resolver | `inventory-closure-abc-assembly-barcode.test.js`（本轮新增） | COVERED | 整改轮补齐实现与路由（此前 `MISSING`） |
| INV-18 | 批号调整 | `inventory-lot-adjustment.js` · `POST /api/inventory-lot-adjustments` + `/{id}/confirm` · `inventory_lot_adjustments` | `inventory-wave-c-extras.test.js`、`inventory-domain-race.test.js` | COVERED | — |
| INV-19 | 库存状态调整 | `POST /api/inventory-stock-status-changes`（`applyInventoryMutation` STATUS_CHANGE）· `inventory_stock_statuses` | `inventory-domain-race.test.js` | COVERED | 本轮补齐「状态调整」工作面（原状态 → 目标状态，数量 / 所有权 / 仓位不变） |
| INV-20 | 库存形态 / 属性转换 | `inventory-form-conversion.js` · `POST /api/inventory-form-conversions` + `/{id}/confirm` · `inventory_form_conversions` | `inventory-wave-c-extras.test.js` | COVERED | — |
| INV-21 | 库存调整与报废 | `app.js` inline `createInventoryAdjustment / changeInventoryAdjustmentState / createInventoryScrap` · `inventory_adjustments / items`、`inventory_scraps / items` + 估值 + 系统凭证 | `m5-inventory-workflow.test.js`、`m13-inventory-extensions.test.js` | COVERED | 能力本身齐备（canonical identity / tracking / period / valuation 均有），前端「调整」页签与报废工作面齐备；但其确认路径未进入 `applyInventoryMutation`（见 INV-07 与 `INV-RES-01`） |
| INV-22 | 批号控制 | `traceability-quality.js` · `POST /api/inventory-lots` · `inventory_lots / inventory_lot_balances / tracked_inventory_movements` | `m15-tracked-identity-key.test.js` | COVERED | — |
| INV-23 | 效期 / 保质期控制 | `traceability-quality.js` · `inventory_lots.expiry_date / manufacture_date` + `inventoryAlerts` 过期预警 | `inventory-wave-d-reports.test.js` | COVERED | — |
| INV-24 | 序列号控制 | `traceability-quality.js` · `POST /api/inventory-serials` · `inventory_serials` | `m15-tracked-identity-key.test.js` | COVERED | — |
| INV-25 | 库存辅助属性 | canonical 身份维度（bin / owner / status / lot / serial）已全部实现并强制 | — | PARTIAL | Design §27.52 标注 `inventory.aux_*` 为 optional，可选扩展点未实现 |
| INV-26 | ABC 分类 | **`inventory-abc-classifications.js`** · `GET /api/inventory/abc`、`POST /api/inventory/abc/classify`、`GET /api/inventory/abc/analysis` · `inventory_abc_classifications` | `inventory-closure-abc-assembly-barcode.test.js`（本轮新增） | COVERED | 整改轮补齐实现与路由（此前 `MISSING`，`/api/inventory-abc` 原为无过滤的裸 SELECT） |
| INV-27 | 即时库存查询 | `lib/inventory-reports.js` + `lib/inventory-compat-read.js` · `GET /api/inventory/instant-query`（完整身份过滤集：warehouse / product / bin / owner / ownerId / stockStatus / lot / serial） | `inventory-wave-d-reports.test.js`、`inventory-position-integration.test.js` | COVERED | 整改轮补齐过滤集与路由 |
| INV-28 | 库存锁定 / 解锁 | `inventory-lock.js` · `POST/GET /api/inventory-locks`、`POST /{id}/release` · `inventory_locks` | `inventory-domain-race.test.js`、`inventory-mutation-wave-b.test.js` | COVERED | 本轮修复防超锁竞态（检查移入事务并先锁 canonical 位置行，真实 MySQL 竞态用例 INV-RACE-04 取证），并补齐「锁库」工作面（列表 + 新建 + 解锁） |
| INV-29 | 定期盘点 | **`inventory-stocktake.js`（canonical owner）** · `GET/POST /api/inventory-stocktakes`、`PATCH /{id}`、`POST /{id}/submit`、`/{id}/approve`、`/{id}/scan` · `inventory_checks(check_kind)` + `inventory_check_items` + `applyInventoryMutation` ADJUSTMENT + 估值 + 系统凭证 | `inventory-domain-closure.test.js`（本轮新增）、`business-integrity-stabilization.test.js`（已迁移）、`inventory-stocktake-wave-c.test.js`（已迁移） | COVERED | 整改轮把 legacy tuple 写入口收敛为 canonical（见 §4 `INV-DEF-03`） |
| INV-30 | 周期盘点 | 同上，`checkKind=CYCLE` + `scope_strategy` + `cycle_period_key` | `inventory-domain-closure.test.js`（本轮新增用例） | COVERED | 整改轮补齐周期盘点用例；此前无任何 CYCLE 断言 |
| INV-31 | 盘盈 / 盘亏 | 同上 · 差异经 `applyInventoryMutation` ADJUSTMENT 生效，附估值流水与 `INVENTORY_COUNT` 系统凭证 | `inventory-domain-closure.test.js`、`inventory-stocktake-wave-c.test.js` | COVERED | — |
| INV-32 | 库存期间关闭 / 重开 | `inventory-period-close.js` · `GET/POST /api/inventory-period-closures`、`/status`、`/check`、`/{id}/reopen` · `inventory_period_closures / snapshots` | `m13-inventory-extensions.test.js`、`out-03-out-23.test.js` | COVERED | — |
| INV-33 | 收发汇总与明细 | `GET /api/inventory-transactions` + `GET /api/reports/decision/inventory-movements` · 数量取自 `inventory_transactions` | `inventory-transactions-query.test.js`、`teacher-acceptance-matrix.test.js` | COVERED | — |
| INV-34 | 库存台账 | `lib/inventory-reports.js::inventoryLedger` · `GET /api/inventory-ledger` | `inventory-wave-d-reports.test.js` | COVERED | 本轮补齐「库存报表」工作面（台账 / 库龄 / 呆滞 / 预警四组真实数据） |
| INV-35 | 库存库龄 | `lib/inventory-reports.js::inventoryAging` · `GET /api/inventory-aging` | `inventory-wave-d-reports.test.js` | COVERED | 同上 |
| INV-36 | 呆滞库存 | `lib/inventory-reports.js::slowMovingInventory` · `GET /api/inventory-slow-moving` | `inventory-wave-d-reports.test.js` | COVERED | 同上 |
| INV-37 | 库存预警与异常分析 | `lib/inventory-reports.js::inventoryAlerts` · `GET /api/inventory/alerts` · `inventory_alert_thresholds` | `inventory-wave-d-reports.test.js` | COVERED | 同上 |
| INV-38 | ABC 与序列号分析 | `inventory-abc-classifications.js::getInventoryAbcAnalysis` + `traceability-quality.js` · `GET /api/inventory/abc/analysis`、`GET /api/traceability` | `inventory-closure-abc-assembly-barcode.test.js` | COVERED | — |
| INV-39 | 条码规则 / 解析 / 主数据 | `lib/inventory-barcode.js` + **`inventory-barcode-generation.js`** · `GET/POST /api/inventory/barcode/rules`、`POST /bindings`、`GET /generated`、`POST /generate`、`POST /label` · `inventory_barcode_rules / bindings / resolution_log` | `inventory-closure-abc-assembly-barcode.test.js`（本轮新增）、`inventory-wave-d-reports.test.js` | COVERED | 整改轮补齐生成与标签渲染（bounded，不构成完整打印平台，符合 Requirement §32.8 的排除项） |
| INV-40 | 扫描到单据适配 | `lib/inventory-scan-adapter.js::resolveScan` · `POST /api/inventory/scan/resolve` | `inventory-wave-d-reports.test.js`、`inventory-domain-race.test.js` | COVERED | 只解析来源，不复制业务单据 |
| INV-41 | 收发扫描校验 | `lib/inventory-scan-adapter.js::validateScanForInventory` · `POST /api/inventory/scan/validate`、`GET /scan/duplicate` | `inventory-wave-d-reports.test.js` | COVERED | — |
| INV-42 | 盘点扫码 | **`inventory-stocktake.js::scanStocktake`** · `POST /api/inventory-stocktakes/{id}/scan` · 落到 `inventory_check_items` 的 canonical 位置身份；同位置重复扫码覆盖旧行 | `inventory-domain-closure.test.js`（本轮新增） | COVERED | 整改轮补齐 canonical 扫码与前端入口；legacy 扫码写入口退役（见 §4 `INV-DEF-08`） |
| INV-43 | 即时库存扫码查询 | `lib/inventory-reports.js::inventoryPositionsList` · `GET /api/inventory/scan/query` | `inventory-wave-d-reports.test.js` | COVERED | — |
| INV-44 | 包装 / 容器核心 | **`inventory-container.js`（canonical owner）** · `POST /api/inventory-containers`、`/{id}/pack`、`/{id}/unpack`、`GET /{id}/inventory`、`/{id}/transfer` · `inventory_containers / items` | `inventory-wave-d-reports.test.js` | COVERED | 整改轮补齐「拆包」（此前 legacy 路由用已废弃的 `applyInventoryMutation` 扁平签名，且语义上会凭空造出库存），退役 legacy 容器写入口（见 §4 `INV-DEF-11` / `INV-DEF-18`），并补齐前端「拆包」动作 |

## 4. 本轮整改轮修复的真实缺陷

| 编号 | 事实 | 处置 |
|---|---|---|
| `INV-DEF-01` | `server/modules/inventory-stocktake.js` 调用 `transaction(db, …)` 但**从未 import**（同批三个新模块均已 import）。本轮注册路由后一调即 `ReferenceError`；此前模块从未被路由，缺陷长期休眠 | 补 import；盘点全生命周期用例落地 |
| `INV-DEF-02` | 本轮新增的 `/api/inventory-transfer-commands` 与既有 `/api/inventory-transfers` 在**同一张 `inventory_transfers` 表**上并存两个写入口，且语义相反：模块路径走 `applyInventoryMutation`（INV-07 合规）但**不做进侧估值承接**（只出账不进货价值 → 估值漂移）、用今天替代缺失的权威业务日期、事务外读单据；legacy 路径估值 / 期间 / 业务日期 fail-closed / 事务内复读齐备但**不走 `applyInventoryMutation`**，且对仓位仓与 LOT/SERIAL 产品直接拒绝 | 退役 `/api/inventory-transfer-commands`（410）；`/api/inventory-transfers` 收归 canonical 模块，物理异动改走 `applyInventoryMutation`，估值承接按 legacy 语义补齐（出账 `issueSourceValue` + 进账 `receiveValue` / TRANSFER_CARRYING_VALUE） |
| `INV-DEF-03` | legacy `/api/inventory-checks` 写入口按 warehouse+product tuple 写入（`setInventoryQuantity`），盘盈盘亏不经过 canonical 位置身份与 `applyInventoryMutation` | 退役 legacy 写入口（410）；`inventory-stocktake.js` 成为唯一写入口：DRAFT → SUBMIT → APPROVE 全链、位置级 `inventory_check_items`、乐观复核、创建人≠审批人、估值与系统凭证 |
| `INV-DEF-04` | canonical 盘点审批用 `checked_at` 兜底业务日期，与 legacy 的 fail-closed 相反 | 缺权威业务日期一律 409 `SOURCE_LINEAGE_MISSING`；创建时即写入 `business_date` |
| `INV-DEF-05` | canonical 盘点审批在事务外逐行 `applyInventoryMutation`，多行盘点中途失败会留下**已应用的差异** | 整段差异包进单一事务 |
| `INV-DEF-06` | canonical 盘点审批无事务内复读与状态 CAS，并发双审批可重复应用 | 事务内复读 + `status='SUBMITTED'` 条件更新（受影响行数必须为 1） |
| `INV-DEF-07` | canonical 盘点审批无创建人≠审批人分离 | 补齐（同 legacy） |
| `INV-DEF-08` | 盘点扫码写入口 `/api/inventory-checks/{id}/scan` 写 `inventory_checks.updated_at` —— **该列不存在** → 一调即 SQL 错误；且扫码写入的行与手工盘点行**重复计数**，审批时会对同一位置调整两次 | 扫码收归 canonical 模块：同位置重复扫码覆盖旧行；legacy 扫码入口退役 |
| `INV-DEF-09` | legacy 盘点列表与审批中心都用 `JOIN products`（INNER），canonical 多行盘点单据 `product_id` 为 NULL → **列表不可见、审批中心不可见**，盘点单无法被审批 | 改为 LEFT JOIN；canonical 列表返回 `stocktakes` 与位置级明细 |
| `INV-DEF-10` | `inventory_transfer_items` **没有 `line_no` 列**，canonical 模块按 `line_no` 排序 → SQL 错误（模块此前从未被路由，缺陷休眠） | 改为按 `id` 排序 |
| `INV-DEF-11` | legacy 容器「拆包」路由用已废弃的 `applyInventoryMutation` 扁平签名（`direction` / `productId`）且 `sourceType='CONTAINER_UNPACK'` 不在允许集 → 必然 400；其语义还会**凭空为每行增加库存**（装箱时并未扣减仓库余额） | 在 canonical 容器模块实现「拆包」：只释放装箱归属关系，不产生任何数量；legacy 容器写入口退役 |
| `INV-DEF-12` | Design §27.52 指向三个**不存在的模块**：`warehouse-master.js`（INV-02，实际 `warehouses.js`）、`inventory-stock-status-mutation.js`（INV-19，实际 inline `/api/inventory-stock-status-changes`）、`inventory-adjustment-scrap.js`（INV-21，实际 inline 调整 / 报废处理器） | 按实现事实更正 Design §27.52 的 owner 列（文档修订，非行为变更） |
| `INV-DEF-13` | `master-data.jsx` 渲染 `<AppLink page="inventory-master">`，但注册表**无此路由** → 死链；同时 `inventory` 路由改指 canonical 工作面后，legacy 库存作业屏成为孤儿屏，P0-A 前端架构契约测试失败 | 库存域收敛到**单一 canonical 工作面**（`inventory-work.jsx`）：调拨 / 调整工作面迁入，legacy 库存作业屏与其死代码删除，P0-A 契约测试更新为新映射 |
| `INV-DEF-14` | `master-data.jsx` 内含 9 个**零调用方**的 legacy 库存组件（`InventoryStockDetail` / `InventoryAdjustments` / `InventoryChecks` / `InventoryTransfers` 及其 modal / detail） | 零调用证明后删除 |
| `INV-DEF-15` | 扫码解析出的 `PRD-<code>` 条码只给出 product_code，盘点扫码拿不到 product id → 扫码盘点不可用 | 扫码按 product_code 解析货品 id |
| `INV-DEF-16` | canonical 盘点审批**未写估值流水与系统凭证**（legacy 路径写了）—— 直接采用 canonical 会丢盘盈盘亏的估值与 `INVENTORY_COUNT` 凭证 | 按 legacy 语义补齐：盘盈 `receivePositiveSourceValue`、盘亏 `issueSourceValue`，并生成 `INVENTORY_COUNT` 系统凭证 |
| `INV-DEF-17` | `inventoryQueryFilters` 收到的是请求 `url` 对象而非 `url.searchParams` → `GET /api/inventory/instant-query` 与 `GET /api/inventory/scan/query` **每次调用都 500**（`query.get is not a function`）。该路由由本轮整改轮登记，缺陷随路由一并生效 | 传入 `url.searchParams`；浏览器去空洞后控制台错误由 7066 条降为 0，canonical 工作面的即时库存页签真实渲染 12 行 |
| `INV-DEF-18` | 容器「装箱」路由引用了未导入的 `pack` → `ReferenceError: pack is not defined`；「拆包」又写入不存在的 `updated_at` 列与不在 CHECK 词表内的 `UNPACKED` 状态 | 补回 `pack` 导入并改名为 `packContainer`；拆包只释放装箱归属关系（不改状态、不写不存在的列），容器状态词表保持 OPEN / SEALED / DISPATCHED / DESTROYED |
| `INV-DEF-19` | 锁库的「防超锁」检查在**事务外**读已锁量 → 两个并发锁各自读到「尚未锁定」，可锁超过该位置实际数量 | 检查移入事务并先对 canonical 位置行加锁（MySQL `FOR UPDATE`）；真实 MySQL 竞态用例 INV-RACE-04 证明只成功一次 |
| `INV-DEF-20` | 库存域的浏览器响应式验收脚本此前**从未真正加载目标屏**：注入 token 后未重载，壳层停留在登录页，其绿色是空洞证据（只测到登录表单） | 注入 token 后重载再断言；去空洞后新增「真实数据或显式空态」「全部可点目标 ≥44px」「底部导航固定且内容预留其高度」三项判定，并逐页签走查 canonical 工作面 |
| `INV-DEF-21` | 响应式脚本的空态选择器（`.empty-state`）与真实 DOM（`.canonical-empty-state` / `.business-state`）不符，导航遮挡判定把**正确固定**到底部的导航误判为遮挡 | 选择器与判定按真实 DOM 修正；修正后 108 项（24 界面 + 84 页签）全绿 |

## 5. 随冻结接受的残余

| 编号 | 残余 | 影响的判定 |
|---|---|---|
| `INV-RES-01` | INV-21 的库存调整 / 报废确认仍走 legacy tuple 写入（`adjustInventory`），不产生 canonical mutation log、不校验库存锁 | INV-07、INV-28 判 `PARTIAL` |
| `INV-RES-02` | **已解决**：Requirement §32.9 F 列出的 11 个 operator workflow 已全部具备前端入口（初始化与期初、其他出入库、分步调拨、状态调整、锁库、库存报表），并由浏览器逐页签走查（4 档宽度 × 21 页签 = 84 项）取证全绿 | 原 13 项 `PARTIAL` 转 `COVERED` |
| `INV-RES-03` | Design §27.52 标注为 optional 的 `inventory.aux_*` 辅助属性扩展点未实现 | INV-25 判 `PARTIAL` |
| `INV-RES-04` | 逐列 schema parity 未在真实 MySQL 8 上取证（按 `MYSQL-EV-01` 口径由本域专属 campaign 的全量 bootstrap 覆盖 schema 等价，行为等价另行取证） | 全域 |
| `INV-RES-05` | 既有库存行（`position_key` 为空）只在**下一次启动的 backfill** 后才对 canonical 身份可见；本轮之后由脚本直写的历史行同理 | INV-06 / INV-07 |
| `INV-RES-06` | N7 文档追溯债务（既有历史提交，与本域能力无关） | 全域 |
| `INV-RES-07` | 底部导航「不遮挡内容」的判定依赖 `mobile-shell` 的 `padding-bottom` 预留（`--bottom-nav-height`）。该契约是全站级的，本域只登记证据，不在域内改写全站壳层 | 全域（浏览器证据口径） |

## 6. 未解决事项与暂停点

- **本域的域级 Acceptance 与 Capability Freeze 尚未签发**：等待业务所有者对 §2 的 14 项 `PARTIAL`（尤其 `INV-RES-02` 的 11 个缺失 operator workflow 是否补前端）作出裁定。
- 本轮**未**执行真实环境 migration、业务数据库写入、push / merge / tag / 发布 / 部署。
