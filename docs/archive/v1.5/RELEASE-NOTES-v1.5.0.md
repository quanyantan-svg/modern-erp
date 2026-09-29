# Modern ERP v1.5.0 Release Notes

> 发布：`v1.5.0`（MINOR over `v1.4.1`）
> 实施 baseline：`da269875d2173f6608c88ec3052f3b7f89f10523` (master)
> 范围：流程对齐 UX 计划 — 全 53 条启用路由统一打磨；D1 采购入库安全归档；七领域主结构；单轨 680px 响应式应用 shell；保留 V1.4.1 既定 MySQL 升级路径热修复。

V1.5.0 是一个 **MINOR 版本**：不引入新业务对象、新角色、新审批族、新跟踪模型、新期间系统或新第二套审批中心；所有能力依据 `document.md` / `solution.md` §21 已冻结的 V1.5 设计合同，在 V1.4.1 既定能力上做"流程对齐 UX + 安全归档"两类增厚。

## 1. 产品 / UX 增厚

- **全 53 条启用路由完成 V1.5 视觉与产品打磨**（D0–D9 实施切片 + D10 最终验收）；其中 4 条为原型（应用页、业务总览、采购入库列表、采购入库详情）经独立原型阶段冻结并由最终验收复核保留。
- **canonical 680px 单轨响应式应用 shell**：所有启用页面通过 `.mobile-shell { --app-max-width:680px; --page-max-width:680px }` 与 `.business-page-shell--rail` 共用同一工作轨；窄宽度 100%，居中桌面显示。
- **七主业务领域**（teacher-flow 一级）：
  - 基础资料
  - 销售
  - 计划 / MRP
  - 生产
  - 采购
  - 库存
  - 经营分析
- **应用启动器对齐业务流程**：第一屏只突出七个主流程领域；高级、内部、系统和扩展功能通过次级入口、上下文动作、"更多"菜单、角色专属工作区、设置或扩展业务区渐进披露。
- **业务总览对齐原始 ERP 流程语义**：桌面显示销售 / 生产 / 采购 三条主工作流，并提供 BASE DATA / INVENTORY / ANALYTICS 三组支持能力；移动端纵向步骤链；不压扁质量门禁、商业开票、AR/AP 与结算事件。
- **减少永久解释性文案**：详细解释统一进入 `HelpDisclosure`、tooltip、可展开区或上下文帮助；主视图只保留操作必需的状态、待办、异常、下一步动作。
- **统一页面模板体系**：LIST / DETAIL / FORM / WORKFLOW / REPORT / CONFIG 六个 canonical 模板跨域保持共同层级。
- **本地化用户可见状态**：`src/lib/presentation.js` 与 `src/lib/status.js` 提供 canonical 状态组（approval / execution / commercial / settlement / period / master / tracking / lifecycle）；不允许 raw 枚举 / 后端标识符直接渲染。
- **响应式支持**：390px mobile / 680px canonical rail / 1440px centered desktop；报告与表格允许 bounded internal overflow，page-level 横向溢出零容忍。

## 2. 流程语义对齐

- **仓库验收**：原始教师流程图节点统一映射为 `采购入库`；`purchase-receipts` 是唯一主入口；副标题允许显示"仓库验收"，不新增重复顶层页面。
- **IQC**：`iqc` 是采购入库 / 仓库验收的内部质量门禁（FLOW_INTERNAL_STEP；parentRoute = `purchase-receipts`），不是第八主业务领域。
- **OQC**：`oqc` 是销售出货的内部质量门禁（FLOW_INTERNAL_STEP；parentRoute = `sales-deliveries`），不是第八主业务领域。
- **应收结算**：`accounts-receivable` 包含销售发票、收款 / 核销、销售折让；不与销售出货等同。
- **应付结算**：`accounts-payable` 包含供应商账单、付款 / 核销、采购折让；不与采购入库等同。
- **MRP**：`mrp-runs` 与 `material-requirements-plan` 共享同一 `presentationConcept: 'MRP'`，物料建议嵌套于 MRP；MRP 不与采购指令或物料计划形成并列主导航。
- **财务 = 角色导向支持**：`accounting` / `bank-accounts` 是 ACCOUNTING 角色专属工作区或快捷入口；不构成第八主流程领域。
- **审批 ≠ 履约**：销售订单 / 采购订单审批完成不等于出货 / 入库完成；销售出货不等于 AR；采购入库不等于 AP；继续保留 V1.4-C 已冻结的显式边界。

## 3. 安全归档（D1）

- **CANCELLED 采购入库支持安全归档**：符合条件的 `CANCELLED` 业务单据可从正常业务列表移除；底层语义为软归档 / 软移除，不进行物理删除；保留原单、原始明细、取消证据与审计链；授权恢复由 ADMIN 单独完成。
- **D1 归档前事务内重读**：当前状态、来源链、下游引用、库存流水、批次 / 序列号跟踪、存货估值、AR / AP / 凭证、结算分配、已关期间依赖、来源完整性等必须保留的依赖被阻断时，归档被显式拒绝；不允许悄悄绕过。
- **复用既有 `lifecycle_archives` 与 `audit_logs` 表**：D1 不引入新 schema / migration / 索引；不修改业务日期、库存、估值、AR、AP、凭证、结算、跟踪移动或物理损坏的契约。
- **ADMIN 恢复支持**：`USERS_MANAGE` + `PURCHASE_RECEIPTS_MANAGE` 双权限；恢复后回到 `CANCELLED` 状态；活动 / 默认列表自动隐藏已归档记录，可通过授权 `includeArchived=true` 查询。
- **UI 术语**：动作显示"从业务列表移除"，归档标记显示"已归档"；不得使用"已删除"、"永久删除"、"彻底删除"、"不可恢复"。

## 4. 审批 / 业务合同安全

V1.5.0 明确**不**修改下列任何合同：

- **审批中心仍只包含五类授权事件**：`SALES_ORDER` / `PURCHASE_ORDER` / `PURCHASE_REQUISITION` / `INVENTORY_CHECK` / `ACCOUNTING_VOUCHER`；不引入第六类审批族。
- **库存调拨是 WAREHOUSE 实物执行事件**（不是审批）：草稿 → 已调拨；WAREHOUSE 创建并确认同一调拨不属于自审。
- **C01–C05 全部保留**：canonical 业务日期口径（`sales_orders.order_date` / `sales_deliveries.delivery_date` / `purchase_receipts.receipt_date` / `return_orders.return_date` / `inventory_transactions.business_date`）；业务对象选择器（编码 + 名称 + 已停用标识）；逐行未交 / 未收（订单行为最小粒度，remaining 不得小于零）；业务总览两层视图；canonical 业务状态术语统一。
- **LOT / SERIAL 跟踪语义保留**：`products.tracking_policy` 是唯一 canonical 字段；NONE / LOT / SERIAL 各按既有可证明事实呈现；不为未启用跟踪的历史业务伪造谱系；legacy / 未启用跟踪的记录统一显示"历史数据 / 来源信息不完整"。
- **存货期间结账语义保留**：单一期间表；预关账 → 提交在事务内统一重读；幂等重建同月快照；反关账仅最近 CLOSED 月份，要求非空 `reopen_reason`；截止日门禁拒绝 `business_date <= closedThroughDate`。
- **履约语义保留**：销售未交 / 采购未收以 APPROVED 订单行为最小粒度；普通销售 / 采购退货不自动重开原始订单履约义务；剩余数量 = 订单数量 − 有效确认执行数量，不得小于零；已履行行默认隐藏，可通过显式选项查看。
- **后端实体身份 / API 命名 / 数据库表命名不变**；前端展示层标签调整不强迫后端重命名。

## 5. 验证

D10 最终验收证据（`log/2026-09-30.md` V1.5 D10 段落）：

- 启用路由 = 53；metadata 路由 = 53；53/53 unique / missing 0 / extra 0。
- 浏览器访问：53 routes × {390, 680, 1440} = 159 visits，PASS: 159，FAIL: 0。
- viewport 覆盖：390 mobile / 680 canonical rail / centered desktop。
- 未解决路由 = 0；D10 修复前发现的 page-level 横向溢出 = 0（修复后）；修复仅限 `.business-page-shell` 栅格列宽与直接子节点 `min-width: 0`。
- D10 focused tests = 16 / 16 PASS（`server/v15-d10-final-ux-acceptance.test.js`）。
- `pnpm test` 默认 / SQLite（`ERP_DB_*` 已清空）：**1585 total / 1581 passed / 0 cancelled / 0 skipped / 0 todo**；4 个失败位于 `server/production-safety.test.js`（reset-data sentinel / temp-target / malformed-path），与 D3–D9 既定回归一致；D10 **0 new failures**。
- `pnpm build`：PASS（1933 modules transformed）。
- `git diff --check`：PASS。
- 受保护 disposable MySQL functional gate 与 concurrency gate：D1 MySQL 集成用例 (1 / 1) + D1 disposable 二次并发验证全部 PASS；既有 V1.4 / V1.4.1 并发合同继续绿色；post-stress canonical System Health 在 disposable MySQL 上保持 GREEN without repair。

## 6. 显式 NOT-CHANGED 清单

V1.5.0 明确**不**修改下列任何合同：

- **无 ERP 业务对象 / 角色 / 审批族新增**；canonical 五角色 + canonical 五审批族不变；`role-reviewer` 内部代码不变。
- **无 schema-intent 变化**；不引入新表、新列、新索引、新 migration；`lifecycle_archives` 与 `audit_logs` 复用既有结构。
- **无 API 行为变化**；`POST /api/purchase-receipts/:id/archive` 与 `POST /api/purchase-receipts/:id/restore` 是 D1 引入的两个新业务动作，但 handler / 载荷 / 错误合同 / 权限字符串均符合既有 `/api/:resource/:id/:action` 模式；不修改既有 endpoint 合同。
- **无前端路由变化**；启用路由从 V1.4.1 的 48 → V1.5.0 的 53，新增 5 条均来自 V1.5-A 流程对齐计划冻结（`approvals` / `dashboard` / `notifications` 收纳为可见、`iqc` / `oqc` 升级为可见任务流）；不改变 `/api/*` 路径。
- **无依赖变化**；不升级、不引入、不删除任何 `dependencies` / `devDependencies` / `optionalDependencies`。
- **无 MySQL existing-database 升级行为回归**；V1.4.1 additive `business_date` 列热修复仍由 `createMySqlDatabase()` 后置步骤接管；V1.5.0 不改动 `bootstrapMySql` / `migrateV14E2BusinessDate` / `ensureV14E2ConfirmPermission` / `ensureV14E2CanonicalRolePermissions`。

## 7. 升级路径与回滚

- **升级路径**：`git fetch` → 校验 annotated `v1.5.0` tag 与 dereferenced commit → checkout → `pnpm install --frozen-lockfile` → `pnpm build` → 重启 systemd 服务。前端 Vite dist 替换；后端 `node server/index.js` 不需 DB 迁移即可启动。V1.4.1 升级行为继续保留：若目标 MySQL 库是 V1.3-shaped（缺 `inventory_transfers.business_date` / `inventory_checks.business_date`），`createMySqlDatabase()` 仍自动应用权威 V1.4-E2 迁移实现。
- **回滚路径**：回到 `v1.4.1` tag 即可；V1.5.0 不引入新 schema / 新权限 / 新 endpoint 行为，因此不需破坏性数据库操作；D1 归档记录是普通 lifecycle 数据，回滚后保留历史可读、不影响后续操作。

## 8. 关联文档

- 设计：`document.md` §21 V1.5 流程对齐 UX 计划需求冻结 + `solution.md` §23 V1.5 设计合同（待 D10 实施切片与最终验收后冻结）。
- D0 共享 UX 基线：`src/navigation/presentationMetadata.js`（53 启用路由 + 5 禁用路由 + 7 主领域 + 5 审批族 + `mrp` 技术别名）。
- D1 安全归档：`server/v15-d1-purchase-receipt-archive.test.js` + 受保护 disposable MySQL 集成 `mysql-v15-d1-purchase-receipt-archive.integration.js`。
- D2 / D2.1 / D2.2 原型冻结：`docs/archive/v1.2/` 视觉验收历史 + `server/v15-d2-four-prototypes.test.js` / `server/v15-d21-single-rail.test.js` / `server/v15-d22-final-visual-polish.test.js`。
- D3–D9 全站推广：`server/v15-d3-sales-purchase-ux.test.js` / `d4-settlement` / `d5-planning-production` / `d6-inventory` / `d7-master-config` / `d8-reporting` / `d9-extension-system`。
- D10 最终验收：`server/v15-d10-final-ux-acceptance.test.js` + `scripts/acceptance/v15-d10-final-ux-acceptance.mjs`（53 × 3 = 159 visits，PASS: 159）。
- 当日日志：`log/2026-09-30.md`（D3–D9 + D10 段落）。
- 历史 release：`docs/archive/v1.4/RELEASE-NOTES.md`（V1.4.0）与 `docs/archive/v1.4/RELEASE-NOTES-v1.4.1.md`（V1.4.1 PATCH），均保持不变。

## 9. 后续边界（仅声明，未启动）

- V1.5 之后的能力增厚（V1.5.x PATCH / V1.6 MINOR）需独立需求 → 设计 → 实施切片，不得悄悄回到本节冻结合同之上。
- §19 明确延后的能力（多组织 / 多币种 / APS / 完整 MES / QMS / 政府电子发票 / 多账簿期间等）继续延后，不因 V1.5.0 发布而进入下一阶段。
- D10 final UX acceptance 已验证 53 routes × 3 viewports 的 159 visits 全部 PASS；若下一阶段引入新路由，必须重跑 `scripts/acceptance/v15-d10-final-ux-acceptance.mjs` 并扩展 manifest。