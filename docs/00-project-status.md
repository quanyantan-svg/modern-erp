# 项目状态快照

> 更新：2026-09-19 (M11 Net-Before-Explosion HOTFIX)

## 阶段与分支

- 阶段：v1.1 Expansion — M11 Forecast & MRP
- 分支：feature/v1.1-mrp
- 稳定基线：0cbfdd8 (`v1.0.1-rc.4`，保持不变)

## 当前生产验收状态

> **Immutable candidates: `v1.0.0`, `v1.0.1-rc.1`, `v1.0.1-rc.2`.** 本次 rc.3 稳定化未 tag、未 push、未 deploy，也未移动任何已有 tag。

### M10 — Product Routing Standard / 制品工序标准

- 新增产品级路线主数据：`product_routings` 保存产品、路线编码/名称、版本、启停状态与备注；`product_routing_operations` 保存确定性的正整数顺序号、工序编码/名称、简单工作中心文本、准备时间与单位运行时间；
- 路线与 BOM 是产品下的同级主数据，不嵌入 BOM，也不改变 BOM 语义；旧 `routing_operations`（BOM-bound API-only）保留为兼容面，并在启动时一次性、幂等迁移为停用历史路线；
- 每个产品最多一条 `ACTIVE` 路线，旧产品允许没有路线；工序始终按 `sequence_no` 排序，重复顺序、负工时、缺失产品/名称与非法编码由后端拒绝；
- 复用既有 `ROUTING_VIEW` / `ROUTING_MANAGE` 双权限，注册权限仍为 100；五角色中仅 `test_admin` 可见和管理，sales/reviewer/warehouse/accounting 均无路线权限；
- 新增完整 REST API、基础资料桌面入口与移动应用卡片，支持搜索、产品/状态筛选、详情、增删改工序、顺序号重排、启用/停用；货品页、制令单详情和业务总览均使用 canonical SPA 导航关联；
- 路线是规划主数据：库存影响 = NONE，会计影响 = NONE，审批中心影响 = NONE；未实现 MRP、工序级执行、报工、设备、产能或工序成本；
- Focused：13 tests / 4 suites / PASS；Full：1027 tests / 202 suites / 0 failed；`pnpm build` 与 `git diff --check` PASS；
- Real Edge 153：375×667、414×896、1024×768 均完成列表/详情/编辑/排序/启停验收，无页面横向溢出；console error = 0，unexpected 400/403/404/500 = 0；使用隔离 DB，未修改生产数据；无 tag、push、deploy。

### M11 — Forecast & MRP / 计划预测与物料需求计划

- 新增 `planning_forecasts`（DRAFT/ACTIVE/CANCELLED）与 `planning_forecast_items` 主数据；MRP canonical 路径下 `mrp_runs`（DRAFT/COMPLETED/CANCELLED）、`mrp_run_demands`、`mrp_run_results`、`mrp_run_components`、`mrp_run_pegging` 是只追加的不可变快照；旧 `mrp_plans` / `mrp_plan_items` 保留作为兼容面，UI 不再挂载；
- 销售需求 = `APPROVED 销售订单明细 − CONFIRMED 销售出货明细（按订单头关联）`，文档级未交付；销售退货不重新打开需求；非 APPROVED 订单不进入 MRP；采购供应 = `APPROVED 采购订单明细 − CONFIRMED 采购入库明细（按入库单关联采购订单）`；直纳入库不计未来供应；采购退货不重建 PO 供应；生产供应 = `PENDING/IN_PROGRESS 制令单数量 − CONFIRMED 生产入库数量`；COMPLETED / CANCELLED 工单不计入。
- 库存源为 `inventory` 跨全仓库汇总（教学语境明确企业可用库存，不做仓库级 MRP）；销售/采购/生产三大供应维度不重复计数 CONFIRMED 业务单据；
- BOM 展开支持多层级、循环检测、深度上限 12；组件在聚合后净库存与在途供应，避免按父级分别消耗同一条库存；Make = 有 ACTIVE BOM，Buy = 无 BOM；MAKE 建议缺少 ACTIVE 路线时附加 `ROUTING_MISSING` 警告，不阻断物料计算；MRP 原子执行：BOM 校验失败 / 循环 / 长度越界时不写任何结果行，运行保持 DRAFT；
- **净需求前置 BOM 展开（NET-BEFORE-EXPLOSION）**：每个 MAKE 父项先以 `gross − on_hand − open_po − open_prod` 计算净需求，仅当净需求 > 0 才以净需求驱动 BOM 展开；父项净需求 ≤ 0 或非 MAKE 时不贡献任何子项需求；多层级递归中每一层都对自己的净需求而非毛需求进行二次展开；共享组件仍按父项贡献累加后再统一净需求，避免按父级分别消耗同一条库存；
- COMPLETED MRP 不可执行、PATCH / 不可修改、不可取消；之后预测取消、库存变化都不再改写已完成的运行；新计算必须新建运行；
- 需求来源支持 `SALES_ORDERS` / `FORECAST` / `SALES_PLUS_FORECAST` 三种模式；SALES_PLUS_FORECAST 为累加关系，状态视图在销售展示中说明两个独立贡献维度；
- 权限：复用既有 `MRP_VIEW` / `MRP_MANAGE`（已存在），注册权限数仍为 100；五角色中仅 `test_admin` 具备计划预测 / MRP 变能力；其他四角色无 MRP 变更权限；
- 库存 = NONE，会计 = NONE，审批中心 = NONE，生产 / 采购 / 请购 / 领料单据创建 = 0；
- UI：教师可见业务总览新增「计划与物料需求」链；应用组加入 计划预测 / MRP 物料需求计划；桌面 / 移动两端均完成列表 / 编辑 / 详情 / 结果追溯验证；移动端 375×667 无横向溢出，主操作可见于底部导航之上；
- Focused：57 tests / 11 suites / PASS（含 9 项 NET-BEFORE-EXPLOSION 热修回归）；Full：1084 tests / 213 suites / 0 failed；`pnpm build` 与 `git diff --check` PASS；
- 真实 Edge 153 headless 在 375×667、414×896、1024×768 完成 `/planning/mrp` 加载与确定性算例（销售 10、预测 10、FG 库存 3、FG 在制 2、FG BOM A×2 B×3）回归：FG 净需求 15、MAKE 建议 15、A 毛组件需求 30、B 毛组件需求 45、BOM_EXPLOSION 锁定 A=30 / B=45，与 M11 算术契约一致；库存流水 / 会计凭证 / 采购订单 / 生产订单均无新建；
- 保留旧 API 作为内部兼容面，旧 MRP 历史数据无破坏；
- 无 tag、push、deploy。

### M11 — Product Routing Standard / 制品工序标准（M10 历史段，已在新段下）

- M11 不涉及 M10 的具体范围；M10 制品工序标准已完整收口，新段在 M10 之上叠加 Forecast + MRP canonical。

### M9 — Final ERP Polish

- 新增权限感知的“业务总览”，仅使用已经实现的销售、采购、库存、生产、财务与报表页面；授权节点使用 canonical `AppLink`，未授权节点只作流程说明，延期能力不提供活动链接；
- 移动端继续以“应用”为默认页，新增“业务导航”卡片；应收、收款、应付、付款从“基础资料”归位到“财务管理”；空应用组仍自动隐藏；
- Desktop Dashboard 增加角色相关快捷入口和指标过滤；`/api/inventory/alerts` 仅在用户持有 `INVENTORY_VIEW` 时请求，财务角色不再产生页面加载 403；
- 教师可见术语统一为“审批、销售出货、采购入库、库存异动、制令单、用料出库、生产入库、应收账款、应付账款、收款单、付款单”；后端 permission、API、数据库标识均未改名；
- 五个演示角色保持不变，权限注册数保持 100；没有新增角色、权限、业务表或迁移；
- 本地演示数据继续由现有开发种子提供，生产环境 `NODE_ENV=production + ERP_SEED_DEMO=false` 明确禁止自动演示种子；不增加危险的数据重置工具；
- 教师演示流程见 `docs/09-demo-business-flow.md`；Focused 118 tests / 21 suites、Full 1014 tests / 198 suites 均 0 failed，`pnpm build` 与 whitespace check 通过；Microsoft Edge 153 在 375×667、414×896、1024×768 完成五角色、业务总览、代表业务页和财务工作台验收，运行时异常及意外 400/403/404/500 均为 0；无 tag、push、deploy。

### M8 — AR/AP Settlement

- 已确认销售出货/退货形成应收及贷项，已确认采购入库/退货形成应付及借项；历史确认单据启动时幂等补账；
- 收款单、付款单支持草稿、取消、原子确认、单笔/多笔分配、部分结清与全额结清；禁止零/负金额、跨往来单位和超额核销；
- 确认结算在单一事务中更新子账、分配、凭证和审计；关闭期间整体拒绝且零副作用；金额继续使用整数分；
- 新增 `AR_VIEW`、`COLLECTION_MANAGE`、`AP_VIEW`、`PAYMENT_MANAGE`，权限总数为 100；仅 admin 与 accounting 获得财务结算能力；
- `pnpm test`：1004 tests / 196 suites / 0 failed；构建、真实 Edge 375/414/1024 验收及 Git hygiene 均通过；M8 最终提交为 `dcab276`；无 tag、push、deploy。

### M7 — Decision Reports

- 决策报表已实现五张教师要求报表：销售统计、销售未出货、采购统计、采购未交货、库存异动明细；数据均直接查询现有 canonical 业务单据与 `inventory_transactions`，未新增快照表、重复台账或统计假数据；
- 销售/采购统计严格区分订单金额、CONFIRMED 出/入库金额、CONFIRMED 退货金额与净额；所有金额继续以整数分聚合和传输；
- 未交付能力判定为 **B（文档级）**：出/入库表头可关联订单，但物流明细不直接引用订单明细，故只展示关联确认单据数、最近履行日期与“尚未/已有记录”，不伪造逐行剩余数量；
- 报表授权要求 `REPORT_VIEW` 与对应销售、采购或库存业务可见权限的交集；`role-accounting` 可见销售/采购四张报表，不可见库存异动明细；未新增权限；
- 库存异动直接复用 canonical 流水，支持日期、货品、仓库、方向和来源过滤；同时选择货品与仓库时，返回 `inventory` 当前库存与最新完整流水余额核对结果，不推导历史期初；
- 移动应用组已启用五张报表卡片；窄屏使用 KPI 与卡片/受控表格，销售/采购订单号通过 permission-aware `AppLink` 进行 SPA 下钻；
- Focused：118 tests / 17 suites / PASS；Full：991 tests / 195 suites / 0 failed；`pnpm build` 与 `git diff --check` PASS；
- Real browser：Microsoft Edge 153，375×667、414×896、1024×768 PASS；控制台异常及意外 400/403/404/500 均为 0；无 tag、push、deploy。

### Post-v1.0.0 Teacher Acceptance — Business Document Integrity Stabilization

- 采购入库、销售出库、销售退货、采购退货统一使用 `quantity + unit_price_cents + amount_cents + total_cents`；单价必须显式提供且为正整数分，服务端重算行金额和表头总额，忽略客户端注入的总额；
- 四类物流单据状态固定为 `DRAFT / CONFIRMED / CANCELLED`；`PATCH /api/<resource>/:id` 仅替换 DRAFT 头和明细，同一事务失败全部回滚；确认和取消仅对 DRAFT 可用；
- 确认动作在 `BEGIN IMMEDIATE` 内重新校验状态、会计期间、库存与权威金额，然后写库存、库存流水、自动凭证、状态和审计；任一失败零副作用；
- 采购入库 `IN`，销售出库 `OUT`，销售退货 `IN`，采购退货 `OUT`；流水保存 direction / quantity_change / balance_after / source type-id-no / warehouse / product；
- 销售收入只在销售出库确认时识别；销售订单审批仅为业务授权，不再生成重复 `Dr 1122 / Cr 6001` 凭证；
- `generateVoucher()` 集中校验 CLOSED 期间、正整数分与借贷平衡；物流凭证使用单据日期，关闭期间的业务确认返回 409 并整体回滚；
- 库存盘点修复 `check_no`，状态机统一为 `DRAFT → SUBMITTED → APPROVED`；新增注册权限 `INVENTORY_CHECK_APPROVE`，仅 admin 通过 all-permissions 获得，warehouse 创建/编辑/提交，不能自审；APPROVED 是唯一库存调整点并写 `INVENTORY_CHECK` 流水；
- 应收、应付、收款、付款的 API/内部代码保留，但由于未形成可用子账闭环，从教师可见导航与页面装配中移除，明确标记 DEFERRED；
- 新增 `server/business-integrity-stabilization.test.js`；聚焦回归 38 tests / 7 suites PASS；全量基线 662 tests / 148 suites / 0 failed；`pnpm build` PASS。

### Post-v1.0.0 Teacher Acceptance — Five-Role Teacher Acceptance Matrix

- 代码提交：待提交 `test(acceptance): add five-role teacher acceptance matrix`；
- 单一 canonical 文件 `server/teacher-acceptance-matrix.test.js`：**52 tests / 12 suites / PASS**，覆盖 navigation closure / live auth/me / 五角色完整 surface / cross-role separation of duties / frontend crash sweep / API 500 sweep / legacy DB 兼容 / data integrity / deferred feature visibility；
- 五角色合同从真实源码（`src/App.jsx navGroups` + `server/db.js rolePermissions` + `server/db.js PERMISSIONS`）推导，不依赖记忆或假设：
  - `role-admin` 经 `PERMISSIONS.map(...)` 继承所有 96 个 permission，sidebar 显示全部 nav；
  - `role-sales`：`ORDERS_*` + `PURCHASE_ORDERS_*` + `CUSTOMERS_*` + `SUPPLIERS_*` + `CRM_*` + 仓库 `PURCHASE_RECEIPTS_*` / `SALES_DELIVERIES_*` / `RETURNS_*`，**无** `ORDERS_APPROVE` / `VOUCHER_*` / `PERIOD_CLOSE_*` / `IQC_*` / `OQC_*` / `COST_*` / `USERS_MANAGE` / `ROLES_MANAGE`；
  - `role-reviewer`：仅 `ORDERS_APPROVE` + `PURCHASE_ORDERS_APPROVE` + 业务 read，**无**任何 `_MANAGE` / `_CREATE` / `_SUBMIT` 写权限，无 `VOUCHER_*` / `PERIOD_CLOSE_*` / `IQC_*` / `OQC_*` / `COST_*` / `CRM_*` / `USERS_MANAGE`；
  - `role-warehouse`：`IQC_VIEW` / `IQC_MANAGE` / `OQC_VIEW` / `OQC_MANAGE` / `INVENTORY_TRANSFER_APPROVE` / `PURCHASE_RECEIPTS_*` / `SALES_DELIVERIES_*` / `RETURNS_*`，**无** `VOUCHER_*` / `PERIOD_CLOSE_*` / `COST_*` / `CRM_*` / `ORDERS_*` / `USERS_MANAGE` / `ROLES_MANAGE`；
  - `role-accounting`：`VOUCHER_SUBMIT` + `ACCOUNTING_VIEW` + `REPORT_VIEW` + 出纳 / 银行 / 票据 / 固定资产，**无** `VOUCHER_APPROVE` / `PERIOD_CLOSE_*` / `COST_*` / `CRM_*` / `IQC_*` / `OQC_*` / `USERS_MANAGE` / `ROLES_MANAGE`；
- **ROLE-ACCOUNTING COST ACCESS = PENDING**：保持与 `3031573` Cost P0 Containment 一致，未在本次任务中变更；
- Cross-role SoD 显式测试覆盖：sales 创建/提交 → reviewer approve，accounting 创建/提交 → admin approve（creator ≠ approver 强制），accounting 不能自审；
- Menu ↔ Permission ↔ API closure：所有可见页的 nav gate → 组件 → action gate → API → permission → lookup 形成闭合链路；`server/app.js` 中无 `QC_MANAGE` / `QC_VIEW` / `BOM_MANAGE` / 任何未注册 permission code；
- Deferred feature visibility：Production Output 路由已移除，`src/App.jsx navGroups` 不含 production-output / production-cost / mrp-calculator / unrouted MRP lifecycle 任何 nav 项；
- Frontend crash sweep：post-v0.9.4 / post-Quality 模态无 `if(...) setForm(...)` 反模式；非 admin-visible 页面无 `/api/users` 调用；IQC / OQC / Contacts / Followups / SalesActivities / Production 模态 SSR 渲染无 ReferenceError；
- API 500 sweep：所有 sidebar 可见页对应的 GET 端点在空 DB 与最小 DB 下都返回 2xx/4xx，**无 500**；non-existent detail route 返回 404；
- Legacy DB 兼容：representative pre-stabilization fixture（删除 IQC/OQC permissions 后再启动 createDatabase）→ 自动恢复 IQC_VIEW / IQC_MANAGE / OQC_VIEW / OQC_MANAGE，schema 全列存在；二次启动幂等；
- Data integrity：IQC / OQC 多行校验失败时完整 rollback，header 与 items 行均不持久化；PATCH 替换 items 不重复行 / 不重复文档；
- 真实生产浏览器验证：**不在本次范围**（Windows 本地环境无生产 browser 访问能力），仅完成代码 + 自动化测试层面；
- Focused：`node --test server/teacher-acceptance-matrix.test.js` → 52 tests / 12 suites / PASS；Full：`pnpm test` → **633 tests / 145 suites / 0 failed**；`pnpm build` PASS（418.51 kB JS / 29.19 kB CSS，无 warning）；`git diff --check` PASS（仅 CRLF 提示）；
- P0 / P1 = NONE；P2 记录：`src/pages/logistics-finance.jsx` 与 `src/pages/master-data.jsx` 中部分 modal 仍以 `if (detail && !form.X) setForm(...)` 形式在 render 阶段触发 setter（带 guard 不无限循环），与 v0.9.4 修复后的 canonical `useEffect([detail])` 模式不一致，不影响功能，记录待后续清理任务。

### Post-v1.0.0 Teacher Acceptance — Manufacturing Stabilization

### Post-v1.0.0 Teacher Acceptance — Manufacturing Stabilization

- 支持面明确收口：**SUPPORTED_UI = BOM + Production Orders**；**SUPPORTED_API_ONLY = MRP plan list/create/generate、legacy MRP calculate/bom-explode、work centers、routing operations、labor records 的现有 routed 基础合同**；**DEFERRED = Production Output、Production Cost、MRP Calculator UI、MRP detail/update/execute 未路由 lifecycle**；
- 五角色合同保持不变：Manufacturing 由 `test_admin` 操作；`role-sales` / `role-reviewer` / `role-warehouse` / `role-accounting` 不获得制造入口或生产变更权限；未新增第六角色；
- BOM 前端移除不存在的 `BOM_MANAGE`，统一使用 canonical `PRODUCTION_ORDERS_CREATE`；后端 BOM list/detail 使用 `PRODUCTION_ORDERS_VIEW`，create/update/discontinue 使用 `PRODUCTION_ORDERS_CREATE`；
- BOM 状态合同固定为 `ACTIVE` / `DISCONTINUED`，不引入 `APPROVED`；create 会停用同产品旧 ACTIVE BOM，事务内写入 header + 全部 items；update 事务内替换 items，避免重复或半写；DISCONTINUED BOM 不可编辑；
- BOM 校验覆盖父项产品、至少一条组件、组件产品、数量 > 0、损耗率 0..1、重复组件、自引用；
- Production Order Core 保留历史状态机 `PENDING → IN_PROGRESS → COMPLETED` 与有效取消语义；`complete` 仍是流程完工，不自动入库；新增未知 action 400、非法重复转换 409、重复取消幂等返回已取消；
- 生产工单 UI 移除“编辑功能开发中”占位，不暴露虚假的编辑入口；
- MRP canonical contract：输入为 `plan_id + SALES_ORDER demand_source_id`；需求来源为销售订单明细；BOM 来源为最新 ACTIVE BOM 并递归展开；库存来源为 `inventory` 汇总；在途来源为 `purchase_receipts` header + `purchase_receipt_items`；输出为 `mrp_plan_items.gross_requirement/on_hand/scheduled_receipt/planned_order_quantity`；
- `/api/mrp-plans/generate` 修复错误 SQL：不再读取 `purchase_receipts.product_id/quantity`，改从 receipt items 汇总；生成前清理同 plan 旧明细并在事务中重建；
- legacy `/api/mrp/calculate` 与 `/api/mrp/bom-explode` 的 BOM 状态查询从 `APPROVED` 改为 `ACTIVE`；MRP Calculator UI 组件保持 unmounted，记录为 DEFERRED；
- Routing GET 修复不存在的 `b.bom_code`，改返回 `bom_version/product_code/product_name`；空库和有数据均应 200；
- Production Output 不注册 `PRODUCTION_OUTPUT`，并移除 `/api/production-outputs` 路由；当前 unsafe handler 不作为公开支持面；
- Production Cost 继续延后，不新增 route/UI，不修改已稳定 Standard Cost / Cost Rate 合同；
- Focused：`server/manufacturing-stabilization.test.js`，11 tests / 4 suites / PASS；Affected：`server/manufacturing-stabilization.test.js server/app.test.js`，51 tests / 14 suites / PASS；Full：581 tests / 133 suites / PASS；`pnpm build` PASS（418.51 kB JS / 29.19 kB CSS）；`git diff --check` PASS（仅 CRLF 提示）。

### Post-v1.0.0 Teacher Acceptance — Quality Stabilization

- 代码提交：待提交 `fix(quality): stabilize iqc and oqc workflows`；
- 单一 canonical IQC / OQC 合同与 DB schema 对齐：`iqc_no` / `oqc_no`、`supplier_id` / `customer_id`、`receipt_id` / `delivery_id`、`inspection_type`、`status`、`result`、`total_quantity`、`sample_quantity`、`qualified_quantity`、`reject_quantity`、`inspector_id`、`inspected_at`、`remark`；明细 `iqc_id` / `oqc_id`、`product_id`、`batch_no`、`quantity`、`sample_size`、`qualified` (0/1)、`reject_reason`；
- `server/app.js` 内与现行 schema 不一致的 legacy `QC_*` handler 死代码（约 140 行，引用不存在的 `inspection_no` / `inspection_id` / `inspection_date` / `sampled_quantity` / `defective_quantity` / `defect_rate` / `inspection_result` 等列）已清理；这些 handler 从未被任何 route 注册；
- 新增 routed 端点：`GET /api/iqc/:id`、`PATCH /api/iqc/:id`、`POST /api/iqc/:id/complete`；对称的 `GET /api/oqc/:id`、`PATCH /api/oqc/:id`、`POST /api/oqc/:id/complete`；
- `createIqcInspection` / `createOqcInspection` 现以 `BEGIN` 事务写入 header + 全部明细行；任何字段校验失败 → 完整 rollback，header 不再孤立、`items` 不再被静默丢弃（P0 DATA LOSS 已修复）；
- `updateIqcInspection` / `updateOqcInspection` 同样事务化：先校验 header + items，再 DELETE/INSERT items；不允许重复行；
- 新增 `completeIqcInspection` / `completeOqcInspection` —— 唯一合法的 `PENDING → COMPLETED` 通道，要求 `result ∈ {PASS, FAIL}`，写入 `inspected_at` 并 audit；重复 complete 返回 409，COMPLETED 单据 PATCH 返回 409；
- 数量不变量（header + items 两层同时生效）：非负、有限、`sample_quantity ≤ total_quantity`、`sample_size ≤ quantity`（item 级）、`qualified_quantity + reject_quantity ≤ sample_quantity`；任何违反返回 400；
- 状态 / 结果枚举：`status ∈ {PENDING, COMPLETED}`，`result ∈ {PASS, FAIL}`；未知值返回 400；
- 权限：`role-warehouse` 经 canonical role-permission reconciliation 增加 `IQC_VIEW` / `IQC_MANAGE` / `OQC_VIEW` / `OQC_MANAGE`；`role-admin` 通过 all-canonical-permissions 继承；`role-sales` / `role-reviewer` / `role-accounting` 不持有；无第六个角色；
- Frontend：`src/pages/quality.jsx` 完全重写 —— 移除 `QC_MANAGE` 引用，弹窗显式接收 `user` / `notify`，使用 canonical `iqc_no` / `supplier_name` / `customer_name` / `inspector_name` 字段、`PENDING` / `COMPLETED` 状态、`PASS` / `FAIL` 结果、`sample_size` / `qualified` / `reject_reason` 明细字段；依赖改用 `GET /api/lookup/suppliers` 与 `GET /api/lookup/customers`（窄查询，返回 `id / code / name`），产品复用 `GET /api/products`；检验员从 `user.displayName` 派生，无 `/api/users` 调用；
- 编辑仅在 `PENDING` 状态下显示；新增「完成」动作触发 `POST /:id/complete`；fetch / save 失败由 `notify` 受控提示，无 unhandled rejection、无 ReferenceError、无白屏；
- Supplier Evaluation API：`GET /api/supplier-evaluations` 与 `POST /api/supplier-evaluations` 路由、handler、schema 完整保留；**SUPPLIER EVALUATION UI = DEFERRED**（未新增页面）；
- Focused：`server/quality-stabilization.test.js`，51 tests / 5 suites / PASS；Full：570 tests / 129 suites / PASS；`pnpm build` PASS（417.71 kB JS / 29.19 kB CSS）；`git diff --check` PASS。

### Post-v1.0.0 Teacher Acceptance — CRM Stabilization

- 代码提交：待提交 `fix(crm): stabilize customer follow-up workflows`；
- `role-sales` 经 canonical role-permission reconciliation 增加 `CRM_VIEW` 与 `CRM_MANAGE`；`role-admin` 继续继承全部 canonical permissions；`role-reviewer`、`role-warehouse`、`role-accounting` 不持有 CRM 权限；
- CRM API 授权统一为：GET 联系人 / 客户跟进 / 销售活动需要 `CRM_VIEW` 或 `CRM_MANAGE`，POST/PATCH/DELETE 需要 `CRM_MANAGE`；联系人列表不再以 `CUSTOMERS_VIEW` / `CUSTOMERS_MANAGE` 作为替代授权；
- CRM 选择器改用 `GET /api/lookup/customers` 与 `GET /api/lookup/suppliers`，响应保持最小 `id/code/name`；lookup 额外允许 CRM 权限，但完整客户/供应商 API 未放宽；
- 联系人 create/edit 使用 snake_case API contract，`customer_id` / `supplier_id` 关系字段在 PATCH 中持久化；
- 客户跟进弹窗修复未声明 `user` / `notify`，新增真实 `PATCH /api/customer-followups/:id`，编辑保存更新原行而不是创建重复行；handler/creator 继续由当前认证 actor 派生；
- 销售活动 create/edit 持久化 `actual_cost_cents` 精确整数分，状态限制为 `PLANNING / IN_PROGRESS / COMPLETED / CANCELLED`，未知状态返回 400；
- CRM 三个 modal 的失败保存路径通过受控 `notify` 处理，不再因未声明变量白屏；
- Focused：`server/crm-stabilization.test.js`，19 tests / 3 suites / PASS；受影响 lookup 回归：`server/phase-e-warehouse-logistics.test.js` 继续 PASS；Full：519 tests / 124 suites / PASS；`pnpm build` PASS。

### Post-v1.0.0 Teacher Acceptance — Cost P0 Containment

- 代码提交：`3031573 fix(cost): align standard cost and rate contracts`；
- Standard Cost 公共契约统一为 camelCase + integer cents：`productId`、`materialCostCents`、`laborCostCents`、`overheadCostCents`、`standardCostCents`、`effectiveDate`、`remark`；
- 新版本替换在 `BEGIN IMMEDIATE` 事务内完成校验、旧 ACTIVE 历史化、新 ACTIVE 插入和审计；失败全部回滚；
- 标准成本维护不再写 `products.price_cents`，产品销售价保持不变；
- Cost Rate 统一使用 `rateType`、`rateValue`、`unit`、`effectiveDate`、`remark`，数据库保持 canonical `rate_type/rate_value/effective_date`；
- API 读取统一要求 `COST_VIEW` 或 `COST_MANAGE`，写入要求 `COST_MANAGE`；成本产品选择器使用只返回 `id/code/name` 的域内窄查询；
- `role-accounting` 未被静默授予 Cost 权限：**ROLE ASSIGNMENT DECISION = PENDING**；
- `PRODUCTION COST = DEFERRED TO MANUFACTURING/COST INTEGRATION`，未增加路由或 UI；
- Focused：32 tests / 4 suites / PASS；Full：500 tests / 121 suites / PASS；`pnpm build` PASS。

> v1.0.1 Warehouse & Logistics Stabilization：代码候选已完成本地自动化验证；禁止 tag/push/deploy。必须在真实生产浏览器完成 `test_warehouse` 回归后才可评估发布。目前仅为 **READY FOR PRODUCTION REGRESSION**。

以下为 v1.0.0 发布前的历史验收记录，原结论保留：

- **当前已验收生产候选**: `v0.9.10`
- **对应 commit**: `3064442 fix(accounting): expose period closing workflow`
- **最终验收文档**: `docs/07-production-acceptance.md`(已扩展 Phase C / D / E / F 综合结论,A / B 历史 evidence-locked 段落保留)
- **Phase A** — Deployment: PASS
- **Phase B** — Authentication / Permission: PASS(evidence-locked;来自 `v0.9.2` 历史 record,未被重写)
- **Phase C** — Master Data: PASS
- **Phase D** — Core ERP: PASS
- **Phase E** — Accounting: PASS
- **Phase F** — Operations / Recovery: PASS
- **FINAL PRODUCTION ACCEPTANCE = PASS**
- **READY FOR v1.0.0 RELEASE = YES**(`v1.0.0` tag 仍未创建)

## 已完成的核心工作流

| 模块 | 状态 | 提交 | 验证 |
|------|------|------|------|
| Authentication | ✅ | acdaad2 | 11 tests |
| Production Order Core Workflow | ✅ | 5809edb | 8 tests |
| Voucher Approval Workflow | ✅ | 9e8aab4 | 15 tests |
| Accounting Period Integrity / Period Closing Core | ✅ | ee3168b | 13 tests |
| Income Statement | ✅ | 28c2f51 | 21 tests |
| Balance Sheet | ✅ | fc088f3 | 28 tests |
| Financial Reporting Consistency | ✅ | f6a2521 | 15 tests |
| Production Safety (Phase 2A) | ✅ | 023f34b | 11 tests |
| Backup / Restore (Phase 2B) | ✅ | 43a0386 | 18 tests |
| First Admin Bootstrap (Phase 2C-1) | ✅ | a880d89 | 17 tests |
| systemd Service + Backup Timer (Phase 2C-2A) | ✅ | 90dcd49 | 4 tests |
| Nginx Reverse Proxy (Phase 2C-2B) | ✅ | 本提交 | 4 tests |
| Supplier Schema Migration (v0.9.1 hotfix) | ✅ | 70df697 | 9 tests |
| Production UI Refinement (iOS-inspired) | ✅ | 6168cdd | 11 tests |
| **Phase A Production Acceptance (v0.9.2)** | ✅ | d33147b | 13 记录项 |
| **Phase B Production Acceptance (v0.9.2)** | ✅ | b59de70 | 12 记录项 + 95 focused tests |
| **Phase B Evidence Lock (v0.9.2)** | ✅ | d6394d8 | 11 user-confirmed production manual checks + 1 retained automated-only |
| **Phase D Hotfix (project + production permissions)** | ✅ | 3d1a973 | 21 regression tests |
| **Phase D Hotfix — Badge component repair** | ✅ | b8556f4 | 12 regression tests |
| **Phase D Follow-up — ProductionOrderModal render loop fix** | ✅ | 本提交 | 9 regression tests |
| **Phase D Hotfix — Project manager selector population** | ✅ | 7d3a3aa | 26 regression tests |
| **Phase E Hotfix — Manual voucher workflow + role-accounting VOUCHER_SUBMIT** | ✅ | 314a11d | 27 regression tests |
| **Phase E Hotfix — Manual voucher amount unit (yuan ↔ cents)** | ✅ | 本提交 | 39 regression tests |
| **Phase E Hotfix — Trial Balance filter (subject include + canonical period range + period write)** | ✅ | 本提交 | 21 regression tests |
| **Phase E Hotfix — Trial Balance closing/opening direction classification** | ✅ | 本提交 | 14 regression tests |
| **Phase E Final Hotfix — Period closing workflow UI exposure** | ✅ | 3064442 | 31 regression tests |
| **Final Production Acceptance (v0.9.10)** | ✅ | 本提交 | DOCS-ONLY 收口,A–F 全部 PASS |

## 当前测试状态

### M8 应收应付与结算（2026-09-16）

- ✅ 已确认销售出货/销售退货自动形成唯一应收子账影响；
- ✅ 已确认采购入库/采购退货自动形成唯一应付子账影响；
- ✅ 收款、付款支持草稿、原子确认、取消、部分及多单核销；
- ✅ 结算凭证按科目编码映射并受关账期间保护；
- ✅ 启动回填幂等，旧财务表无损兼容；
- ✅ 权限总数 100，仍为五角色模型；
- 详细审计与口径见 `docs/08-ar-ap-settlement.md`。

- CRM 定向：`server/crm-stabilization.test.js`，**19 tests / 3 suites**；
- 成本定向：`server/cost-stabilization.test.js`，**32 tests / 4 suites**；
- 全量：**519 tests / 124 suites**；
- 构建：`pnpm build` PASS；
- **全部通过**

## Production Acceptance Status（v1.0.0 发布前历史记录）

- **Release**: `v0.9.10`
- **Commit**: `3064442`
- **Phase A — Deployment Baseline**: ✅ PASS(详见 `docs/07-production-acceptance.md`)
- **Phase B — Authentication & Permission**: ✅ **`PASS — EVIDENCE LOCKED`**(来自 `v0.9.2` 历史 record,未被重写)
- **Phase C — Master Data CRUD**: ✅ PASS
- **Phase D — Core ERP**: ✅ PASS
- **Phase E — Accounting**: ✅ PASS
- **Phase F — Operations / Recovery**: ✅ PASS
- **FINAL PRODUCTION ACCEPTANCE = PASS**
- **READY FOR v1.0.0 RELEASE = YES**(未创建 `v1.0.0` tag)

## 分值汇总

- 完整：42 / 88 (48%)
- 部分：23 / 88 (26%)
- 缺失：22 / 88 (25%)
- NOT_VERIFIED：1 / 88 (1%)

## 当前 P0 问题

- 无已知 P0 + BROKEN

## 当前 P1 问题

- 期间管理（已升级为完整：会计期间保护、Period Closing Core、Period Reopen）
- 月结/年结（Month Closing 已完整；Year-End Carry Forward 未实现）
- 凭证字 + 编号规则（部分）
- 凭证模板（缺失）
- 试算平衡表（已升级为完整：REPORT_VIEW；UI 补齐）
- 经营汇总（已升级为完整：与利润表共享计算；保留 AR/AP；无 UI）
- 利润表（已升级为完整：单月期间；REVENUE/EXPENSE；POSTED only）
- 资产负债表（已升级为完整：as-of 期间末累计；未结转损益虚拟行；equationValid 整数比较）
- 现金流量表（缺失）
- 往来对账（基础）
- 银行对账（基础）
- 资产变动/清理（基础）
- 人工记录/工序（基础）
- IQC/OQC/检验标准（部分）
- 联系人/跟进/活动（基础）
- 项目/任务/工时（基础）
- OA 请假/报销/审批流（基础）
- 预警规则/记录/处理（基础）
- 数据导入/导出（缺失）
- 文件上传/附件（缺失）

## 下一步候选

按优先级和依赖关系筛选，见本文档末尾候选列表。

## 候选列表

| # | 模块 | 功能 | 当前 | 优先级 | 依赖 | 备注 |
|---|------|------|------|--------|------|------|
| 1 | 报表 | 利润表 | 完整 | P1 | 凭证审核 ✅ + 期间结账 ✅ | 已完成 |
| 2 | 报表 | 资产负债表 | 完整 | P1 | 凭证审核 ✅ + 期间结账 ✅ | 本次实现 |
| 3 | 报表 | 现金流量表 | 缺失 | P2 | 凭证审核 ✅ + 期间结账 ✅ | 新增 |
| 4 | 财务 | 凭证字 + 编号规则 | 部分 | P1 | — | 已有表，编号规则未完善 |
| 5 | 财务 | Year-End / 年结 | NOT_VERIFIED | P1 | 期间结账 ✅ | 完整年结逻辑未实现 |

## Year-End 状态

- 期间结账（Month Closing）已实现并验证
- Year-End Carry Forward / 完整年结逻辑 NOT_VERIFIED，未在本阶段实现
- 后续重构任务应单独评估年结流程，不应与月结混淆
