# Modern ERP v1.4.0 Release Notes

> 发布：`v1.4.0`
> 实施 baseline：`9e6cb16619cb4afb907ec1aab2bca692c87e8355` (master)
> 范围：业务一致性、库存执行与期间关账、产品跟踪表达、报表口径与逐行履约、业务总览、响应式/产品一致性

V1.4 由八个受控实施切片 E1–E8 组成。V1.4 不引入新业务对象、新角色、新审批族、新跟踪模型、新期间系统或新第二套审批中心；所有能力按 §3 / §19 范围边界增厚现有合同。

## 1. 产品基础

- 结构化业务错误：服务端 `serializeError` 收敛为 `{ error, code, message, details, resolution, requestId }`；未知错误统一为 `INTERNAL_ERROR` 且不泄漏堆栈/SQL/密钥。前端 `ApiError` 优先读取 `code / details / resolution`，旧 `error` 字段保留兼容。
- 规范化状态呈现：`src/lib/presentation.js` 提供 canonical 状态组 (approval / execution / commercial / settlement / period / master / tracking)、语义 tone 与 REVIEWER 显示名（统一为 `业务审核员`，后端 code 不变）。
- 规范化动作词：`ACTION_VERBS` 提供 `新增草稿 / 保存草稿 / 提交 / 撤回 / 审核 / 驳回 / 确认入库 / 确认出库 / 确认领料 / 确认退料 / 确认完工 / 确认调拨 / 确认核销 / 关闭 / 作废 / 冲销`，禁止 `处理 / 执行 / OK / 提交完成` 等模糊词。
- 页面骨架：`BusinessPageHeader / BusinessActionBar` (primary/secondary/destructive/navigation 四类层级)、`ResponsiveBusinessList`、`BusinessState` 七态（LOADING / EMPTY / NO_RESULTS / PREREQUISITE_REQUIRED / PERMISSION_DENIED / BUSINESS_BLOCKED / ERROR）。

## 2. 库存执行

- 业务日期：在 `inventory_transfers` 与 `inventory_checks` 上新增 nullable `business_date`；新单据必须显式携带，legacy 行的 NULL 值固定显示「业务日期缺失」，不进行 `created_at` / `updated_at` 时间戳回退。
- 权限：新增 canonical `INVENTORY_TRANSFER_CONFIRM`；`INVENTORY_TRANSFER_APPROVE` 作为 deprecated compatibility alias 保留。canonical WAREHOUSE 角色获得 CONFIRM；SALES / REVIEWER / ACCOUNTING 不获得。
- 状态：调拨维持 `DRAFT → TRANSFERRED`，草稿可取消；legacy `SUBMITTED / APPROVED` 只读、不静默改写。同一 WAREHOUSE 用户可创建并确认同一调拨，分别审计创建人与确认人。
- 事务：`DUPLICATE_CONFIRMATION` 在跨进程竞争下稳定拒绝重复确认，期间门禁在事务内统一重读；不展开新表单 / 不增加确认 actor-time 列，TRANSFERRED 时将现有 `reviewer_id / updated_at` DTO 映射为 `confirmedBy / confirmedAt`。

## 3. 库存期间关账

- 单一期间表：复用现有 `inventory_period_closures` / `inventory_period_snapshots` 结构；不新增 second period 系统。
- 预关账：服务端只读 `runInventoryCloseChecks` 与最终关账共享同一检查器；最终提交在事务内重新计算，阻断项 (BLOCKING) 不可绕过、警告项 (WARNING) 需显式确认。
- 幂等：已 CLOSED 同月重复 close 复用原 closure identity、重建同一快照集合，不推进期间、不重复累计行；REOPENED → 重新预检并重建同月快照。
- 反关账：仅最近 CLOSED 月份；要求非空 `reopen_reason`，并在会计期间已开放的前提下执行；记录 `reopened_by / reopened_at / reopen_reason`。
- 截止日门禁：所有库存影响命令在写入前拒绝 `business_date <= closedThroughDate`；受保护 SQL 复用现有事务 gate。
- 稳定错误码：`PERIOD_NOT_ENDED / PERIOD_SEQUENCE_INVALID / PRECHECK_BLOCKED / PRECHECK_WARNING_CONFIRMATION_REQUIRED / FINANCIAL_PERIOD_CLOSED / INVENTORY_CONSISTENCY_ERROR / PERIOD_NOT_LATEST / REOPEN_REASON_REQUIRED`。

## 4. 产品跟踪表达

- 单一 authority：`products.tracking_policy` (`NONE | LOT | SERIAL`) 是唯一 canonical 字段；不引入 `is_lot_enabled` / `is_serial_enabled` 平行布尔。
- NONE：表格与追溯页不渲染批次/序列号输入；服务端对 NONE 提交的非空 allocations 返回 `TRACKING_POLICY_MISMATCH`，不静默忽略、不创建占位身份。
- LOT/SERIAL：分配 / 调拨 / 领退料 / 入退 / 调整 / 报废 / 盘点保持数量、身份、价值原子一致；SERIAL 基本数量必须为整数，序列号全局唯一；HOLD / 过期 / 仓库 / 期间 / 数量 / 重复均以结构化错误码（`LOT_REQUIRED / LOT_NOT_AVAILABLE / SERIAL_REQUIRED / SERIAL_DUPLICATE / SERIAL_NOT_AVAILABLE / TRACKING_QUANTITY_MISMATCH / TRACKING_POLICY_MISMATCH / TRACKING_IDENTITY_CONFLICT`）显式呈现，并附 `resolution` 字段。
- 追溯只展示可证明证据：legacy / 未启用跟踪的记录统一呈现「历史数据 / 来源信息不完整」，不得为未启用跟踪的历史业务伪造谱系，UUID 不作为主标识。

## 5. 报表口径与业务对象选择

- 权威业务日期：销售订单 `order_date`、销售出货 `delivery_date`、销售退货 `return_date`；采购订单 `order_date`、采购入库 `receipt_date`、采购退货 `return_date`；库存异动 `inventory_transactions.business_date`；调拨/盘点使用 V1.4 E2 新增的 `business_date`；缺失权威日期的 legacy 记录以 `legacyMissing` / `LEGACY_UNKNOWN` 隔离。
- 不得回退：UI 筛选器与列标题显示具体日期名（`订单日期 / 出货日期 / 预计到货日` 等），不得以 `created_at` 替代；屏幕与 CSV 导出共享查询服务与 DTO。
- 业务对象选择：`BusinessEntitySelector` 单选、显示 `编码 · 名称`、已停用项以 `（已停用）` 标识、selectedId 仅用于历史回显、网络请求只传 canonical `id`。后端只接受 `usage ∈ REPORT_SALES / REPORT_PURCHASE / REPORT_INVENTORY` 与 `type ∈ CUSTOMER / SUPPLIER / PRODUCT / WAREHOUSE`，对 `TRANSACTION_*` 与未注册类型 fail-closed。
- sales-outstanding 与 purchase-unreceived 以 `requested_delivery_date` / `expected_delivery_date` 判断到期与逾期；缺失承诺日期显示「承诺日期缺失」，不产生虚假逾期天数。

## 6. 履约报表（销售未交 / 采购未收）

- 行级粒度：以 APPROVED 订单行为最小报告粒度；每行显示订单号/行号、伙伴 code/name、产品 code/name、`ordered / executed / remaining / commitmentDate / overdueDays / fulfillmentStatus / accuracyStatus / contributionCount`。
- 来源闭合：`executed` = 状态为 CONFIRMED、来源行身份明确、且未被 canonical execution reversal 撤销的下游执行行。普通销售/采购退货不重开原始订单履约义务（仅显式的 `补货/换货义务` 未来才能再次进入待履行计算）。
- legacy 隔离：无 `*_order_item_id` 的历史执行行进入 `legacyUnattributed` 汇总，相关订单行标记 `LIMITED / LEGACY_SOURCE_MISSING`，全局 `accuracyNotice` 披露；不按产品/日期/数量猜测归属。
- 懒加载贡献：`GET /api/reports/:reportKey/lines/:orderItemId/contributions`，仅接受冻结的 `sales-unfulfilled` 与 `purchase-unreceived` 两个 `reportKey`；贡献只返回 confirmed、未被冲销、来源行明确的下游单据，合计严格等于主行 `executedQuantity`，并对目标领域权限作二次校验。
- 排序与可见性：默认 `逾期优先, 承诺日期升序, 单号/行号` 稳定排序；已履行行默认隐藏，可通过显式「显示已履行」包含。

## 7. 业务总览（两级视图）

- Level 1：按原始流程图 / 教师业务流程组织的静态主链，包含 基础资料 / 销售 / 计划-MRP / 生产 / 采购 / 库存 / 财务衔接 / 经营报表 八个主业务域；移动友好，不堆叠完整工作台，不显示受保护业务数量。
- Level 2：在订单详情 / 单据详情 / 跟踪视图中展开 canonical 阶段（订单审批、出货、OQC、物流确认、商业发票、AR、收款/核销；请购、PO、IQC、收货、供应商账单、AP、付款/核销；MRP / 指令 / 制令 / 领料 / 报工 / 完工入库）。
- 节点授权：`PROCESS_ONLY` 不触发受保护查询；`SUMMARY_ALLOWED` 可返回状态/数量摘要；`DETAIL_ALLOWED` 暴露授权字段与链接；`ACTION_ALLOWED` 在详情权限基础上按精确 capability 与单据状态返回动作。SPA 直接访问受保护详情仍由目标 API 二次授权。
- 语义边界：出货 ≠ AR；入库 ≠ AP；审批 ≠ 履约；调拨 = WAREHOUSE 的实物执行，不进入 Approval Center。

## 8. 响应式与产品一致性

- 现有全部 48 条用户可见路由审计：`375×812 / 390×844 / 768×1024 / 1024×768 / 1280×800` 五档 viewport 检查页面级水平溢出。
- 移动任务：核心移动卡只放业务号、伙伴、产品/来源、计划或剩余数量、关键业务日期、状态和下一动作；`MobilePage` 底部主动作不因长列表滚出可达范围。
- 共用组件：`BusinessPageHeader / BusinessActionBar / BusinessEntitySelector / DocumentStatusGroup / ResponsiveBusinessList / SourceDocumentLink / BusinessErrorState / PeriodCloseCheckList / TrackingAllocationEditor`。
- canonical 词表：原始系统 enum 与内部 ID 不作为主 UI 内容呈现；状态组不强行压扁；六类空/错/载入状态显式区分。

## 9. 迁移与兼容

- 添加式 schema：仅 `inventory_transfers.business_date` 与 `inventory_checks.business_date` 两个 nullable TEXT 日期列；幂等迁移 `server/migrations/v14-e2-business-date.js`，无 `production_orders.completion_date`、无 `inventory_transactions.business_date_origin`、无新表、无第二套跟踪标志、无第二套期间表。
- 权限数据迁移：`INVENTORY_TRANSFER_CONFIRM` 权限以 `INSERT OR IGNORE` 幂等落地；`role-warehouse` 获得 CONFIRM（其它角色无）；`INVENTORY_TRANSFER_APPROVE` 保留为 deprecated alias，不删除历史角色映射。
- legacy 行为：legacy `SUBMITTED / APPROVED` 调拨与 NULL 业务日期行保持原值、只读、不静默改写；追溯页面对缺少历史证据的记录显示「历史数据 / 来源信息不完整」。
- 升级路径：纯添加式；旧版本回滚后保留新列和权限数据；数据库不需要 reset / 不需要 reseed；无 incompatible 字段变更。

## 10. 显式延后 (deferred by design)

V1.4 不属于范围内且明确延后：

- 通用 `TRANSACTION_*` 业务对象 selector 与全站交易选择器框架
- 报表业务对象多选筛选
- C04 完整逐行工作台 / C06 / C07 全行驾驶舱
- 多组织、多币种、多账簿期间关闭
- APS / 完整 MES-OEE / 完整 QMS-CAPA / 法定税务申报
- 政府电子发票 / 法定税务申报
- 完整 PDA 配置器 / 仓位 / LPN / 拣货波次
- 期初 WIP 迁移 / 年结损益结转 / Year-End Carry Forward
- 在真实大规模 MySQL 数据和目标硬件上的生产容量认证
- 用户可见的 System Health / Go-Live 前端（已移除，仅作后端 / 内部能力保留）

## 11. 已知边界

- 旧 `SUBMITTED / APPROVED` 调拨及缺失业务日期的盘点行：业务日期字段为 NULL，UI 显示「业务日期缺失」，与正常期间的报表统计隔离。
- `INVENTORY_TRANSFER_APPROVE`：最早在下一主版本、使用审计与公告后移除；当前为 deprecated compatibility alias。
- 真实生产 MySQL 大容量 / 性能认证仍需在目标硬件与生产容量上做端到端验收。

---

发布参考：

- canonical 文档基线：`document.md` / `solution.md`
- 实现提交链：`7a6a855 (E1) → fdac6ac (E2) → 9fb7856 (E3) → b85a445 (E4) → 5bcb4e4 (E5) → 3762fce (E6) → 44f072c (E7) → 9e6cb16 (E8)`
- 历史归档：`docs/archive/v1.4/`（本目录）、`docs/operations/`（当前专项运维）、`docs/archive/v1.3/` 与 `docs/archive/v1.2/` 与 `docs/archive/v1.1/` 与 `docs/archive/v0.9/`（历史版本归档，仅作历史证据，不替代 canonical 文档）
