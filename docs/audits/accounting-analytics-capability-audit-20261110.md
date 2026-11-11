# Accounting & Analytics 会计与分析域 — 域级能力审计基线（2026-11-10）

> **用途**：本文件是 Accounting & Analytics 业务域**首次域级能力审计**的证据台账，覆盖 B3106 存货核算、
> B3107 固定资产、B3114 智能会计平台、B3115 总账、B3116 报表、B3117 经营会计共 6 本手册、44 项 Capability
> 在真实仓库中的实现现状与缺口。本台账是后续 Requirement / Design / Implementation / Acceptance 的**输入依据**，
> **不是** Requirement 正文、Design 正文、Capability Freeze、Domain Acceptance 或 Release Readiness。
>
> **Owner**：Accounting & Analytics Domain Owner（业务所有者）；本文件的维护与废弃由该 Owner 负责。
>
> **状态**：`AUDIT_COMPLETE / COVERAGE_REVIEWED`（审计完成，覆盖结论待业务所有者确认）。
>
> **权威关系**：`document.md` §22.6 / §22.7 / §22.14 / §22.15 / §22.16 / §22.17 是**手册能力基线来源**；
> 本文件是**逐项实现审计**，不改写 §22 的初判 Coverage 结论；后续正式 Requirement 正文将落在
> `docs/requirements/accounting-analytics.md`，正式 Design 正文将落在 `docs/design/accounting-analytics.md`。
> 唯一当前项目级进度登记表仍是 `docs/status/PROJECT_STATUS.md`。
>
> **审计基准 SHA**：`eee92c21751b9e6fa224125611750a4af4988591`（`master`，2026-11-10）。
> 审计时工作树内存在 **Procurement & Outsourcing 域的未提交改动**（`server/modules/outsourcing-finance.js`、
> `server/modules/outsourcing-gl-policy.js`、`server/migrations/procurement-*.js`、`server/modules/procurement-prepayment.js`）；
> 下列结论对这些文件的引用以工作树现状为准，**不得**被描述为已提交状态。
>
> **审计方法**：静态代码审计（route / handler / schema / 状态机 / 权限 / 事务 / 审计 / 测试 / 前端 surface 逐项定位），
> 辅以定点运行时口径核验。**本轮未运行任何测试套件，未连接真实 MySQL**；因此凡涉及运行期、并发、
> 真实权限与端到端结果的结论一律标记为需在实施/验收阶段复跑，不在本台账中宣称已通过。
> 判 `COVERED` 必须同时成立——(a) 有生产写入口或权威读入口；(b) 有服务端来源/状态/权限/事务约束；
> (c) 有可执行测试覆盖正例。**不凭文件存在或表存在宣称覆盖。**

---

## 1. 审计结论摘要

### 1.1 覆盖统计

| 手册 | Capability 数 | COVERED | PARTIAL | MISSING | OUT_OF_SCOPE |
|---|---|---|---|---|---|
| B3106 存货核算 | 9 | 0 | 8 | 1 | 0 |
| B3107 固定资产 | 8 | 0 | 4 | 4 | 0 |
| B3114 智能会计平台 | 7 | 0 | 6 | 1 | 0 |
| B3115 总账 | 8 | 2 | 2 | 3 | 1 |
| B3116 报表 | 6 | 2 | 1 | 3 | 0 |
| B3117 经营会计 | 6 | 0 | 0 | 6 | 0 |
| **合计** | **44** | **4** | **21** | **18** | **1** |

`OUT_OF_SCOPE` 仅 1 项：AA-31 汇兑损益（当前单本位币 CNY，多币种未纳入本轮范围）。

### 1.2 结论要点

1. **本域尚无 Domain Closure Requirement**。`docs/requirements/README.md` 与 `docs/design/README.md` 均登记
   「Accounting & Analytics — 尚无 Domain Closure Requirement / 尚无 Domain Technical Design」；
   `PROJECT_STATUS.md` 附录 A 记该域「**无 Domain Closure Requirement** / Implementation Partial /
   Manual Capability Closure 未闭合（B3114–B3117）」。**本轮审计是该域建立正式 Requirement 的前置证据。**
2. **已建成能力集中在「凭证 + 总账 + 三张标准报表 + 期间结账」**（AA-25/26/33/34 判定 `COVERED`），
   并已有一条**质量很高**的业务↔GL 对账底座（`server/modules/financial-inventory.js::systemHealth`，
   含 18+ 项 GL 与子账差异检查）。
3. **最大缺口是「平台化」而非「点功能」**：凭证模板表存在但**无写入口、无任何生成消费方**；
   无 accounting event / 异常工作台；无报表模板与公式引擎；无现金流量表；无期末转账/摊销/计提；
   无损益结转（`server/modules/extended.js:1033` 明确写「当前 schema 无自动损益结转，通过未结转损益虚拟权益行补偿」）。
4. **固定资产（B3107）实质处于「有 backend、无产品入口」状态**：`fixed_assets` / `asset_depreciations` 表与
   API（`server/app.js:2507-2513`）存在，前端 `src/pages/treasury-cost.jsx::FixedAssets` 存在，
   但 route `fixed-assets` 在 `src/navigation/applicationRegistry.js:94` 为 **`enabled: false`**，
   用户**无法从导航到达**该能力。按 AGENTS.md §7「frontend hidden 不等于 authorization」的反面事实，
   这是一条**用户不可达**的半成品。
5. **经营会计（B3117）整本手册 6 项能力全部 `MISSING`**：无经营账簿/组织、无经营数据来源、无内部结算、
   无费用归集分配、无经营损益、无经营会计关账。仓库内**不存在**任何对应模型、表、API 或页面。
6. **不可误判项（防止用"文件存在"冒充覆盖）**：
   - `server/lib/formula-evaluator.js` 属于 Master & Engineering 的**工时公式安全文法**（标识符限定 `e_` 前缀、
     无函数调用），**不是**报表取数公式引擎，不得据此把 AA-36 判为 `PARTIAL`；
   - `cash_journals`（现金日记账）归 Finance Operations 且 route `cash-journals` 亦为 `enabled: false`，
     **不是** B3115 的现金流量表（AA-29 仍为 `MISSING`）；
   - `voucher_templates` 表存在 ≠ 凭证模板平台（AA-19 仍为 `PARTIAL`）。

---

## 2. Capability 台账

> 判定字段含义：`COVERED` 全部三条成立；`PARTIAL` 存在生产入口但合同不完整；`MISSING` 无生产入口或权威模型；
> `OUT_OF_SCOPE` 经本轮范围裁定移出本域本轮 Closure（需业务所有者确认）。

### 2.1 B3106 存货核算（AA-01..AA-09）

| ID | Capability | 实现证据（route / owner / schema / 前端） | 判定 | 缺口 |
|---|---|---|---|---|
| AA-01 | 核算范围与核算体系 | `products.inventory_classification` + `account_role_mappings`（`RAW_MATERIAL_INVENTORY` / `FINISHED_GOODS_INVENTORY` / `OTHER_INVENTORY`）确定存货科目角色；`aux_projects` 提供辅助项目维度（`server/modules/extended.js:124`）；`GET /api/aux-projects` | PARTIAL | 无「核算体系 / 组织 / 所有者」实体；核算范围不可切换；owner dimension 已在库存域落地但**未进入核算范围口径** |
| AA-02 | 计价方法 | `server/modules/financial-inventory.js:43-58` `valuationMethod` / `changeValuationMethod`；`products.valuation_method`；取值集合由 tracking policy 强绑定（`MOVING_AVERAGE` / `LOT_SPECIFIC_POOL` / `SPECIFIC_SERIAL`） | PARTIAL | 无按物料/类别/属性自选的加权平均、FIFO；方法由追踪策略单向锁定，不能按业务属性定优先级 |
| AA-03 | 采购入库成本 | `purchase_receipts` → `inventory_valuation_movements`（`RECEIVE`）→ `createSystemVoucher`；GRNI 科目角色 + `systemHealth` 的 `RECEIPT_GRNI_TO_GL` 检查 | PARTIAL | 发票差异（PPV）与入库成本的完整闭环不在本域；缺入库成本的**核算说明/差异解释** |
| AA-04 | 采购费用分配 | 无。仓库内无采购费用（运费等）分摊模型、无表、无 API、无页面 | MISSING | 整条能力缺失：费用归集 → 分摊规则 → 分摊结果 → 入账价值 |
| AA-05 | 暂估成本 | GRNI 科目角色（`account_role_mappings`）+ `purchase_receipts.grni_cents` + `supplier_bills` 正式化；`systemHealth` 的 `RECEIPT_GRNI_TO_GL` | PARTIAL | 无独立暂估入库单据与暂估差异调整凭证；暂估↔正式的差额未在本域形成可解释闭环（正式化在 Finance Operations 域 §33.10） |
| AA-06 | 生产入库成本 | `postWipMovement` + `production_costs` + `production_receipts` → valuation；`systemHealth` 的 `WIP_TO_GL` | PARTIAL | WIP→成品成本的**差异分配**（产出品差异、损耗）未成闭环；无期末成本结转步骤 |
| AA-07 | 委外成本 | `server/modules/outsourcing-finance.js` OUT-20：委外成品收货生效时按「消耗材料价值 + 加工费」入账；`outsourcing_cost_evidences.processing_fee_provisional_cents`；`server/modules/outsourcing-gl-policy.js::resolveProcessingFeeAccountingProfile` 档案化角色 | PARTIAL | 委外**材料成本**未确认走 canonical valuation（工作树未提交，需复跑验证）；委外差异/WIP 已由采购域实现，但成本核算口径（材料价值取数规则）未在本域固化 |
| AA-08 | 出库核算 / 成本调整 | COGS 走 `SALES_DELIVERY_COGS` valuation movement + `createSystemVoucher`；`systemHealth` 的 `COGS_TO_GL` | PARTIAL | 无**成本调整**机制（重估、差异调整、盘盈亏成本回冲的会计凭证路径） |
| AA-09 | 存货关账 | `server/modules/inventory-period-close.js`（`inventory_period_closures`）+ `closePeriod` 强制先关存货期（`server/modules/extended.js:249` 409「必须先完成对应存货期间结账」）+ `systemHealth` BLOCKING 拦截 | PARTIAL | 关账**顺序**已正确；但核算侧异常检查清单不完整（缺存货与 GL 差异的业务可解释报告、缺未生成凭证完整性检查，见 AA-24） |

### 2.2 B3107 固定资产（AA-10..AA-17）

| ID | Capability | 实现证据 | 判定 | 缺口 |
|---|---|---|---|---|
| AA-10 | 资产基础资料 | `fixed_assets` 表（asset_code / asset_name / asset_type / spec / unit / purchase_date / purchase_amount_cents / service_years / depreciation_method / residual_value_cents / location / custodian / remark / status）；`GET/POST /api/fixed-assets`、`PATCH /api/fixed-assets/:id`（`server/app.js:2507-2510`）；前端 `src/pages/treasury-cost.jsx::FixedAssets` | PARTIAL | 类别/位置/状态为**自由文本**而非字典；**折旧政策无独立实体**（方法与年限直接落在资产行上）；route `fixed-assets` 为 `enabled:false`，用户不可达 |
| AA-11 | 资产卡片 | `fixed_assets` 行即卡片基础 | PARTIAL | 无卡片生命周期（卡片状态机、来源标识、附件、卡片视图），非"卡片"模型 |
| AA-12 | 采购转固 | 无。`purchase_receipts` → `fixed_assets` 无任何生成路径 | MISSING | 整条能力缺失：资产申请 → 请购 → 采购 → 收货/领用 → 生成资产卡片 |
| AA-13 | 资产变更 | `PATCH /api/fixed-assets/:id` 直接改字段 | PARTIAL | 无变更单、无审批、无变更前后值快照、无审计明细（仅通用 audit 行） |
| AA-14 | 拆分 / 合并 | 无 | MISSING | 整条能力缺失 |
| AA-15 | 借用 / 盘点 | 无 | MISSING | 整条能力缺失 |
| AA-16 | 折旧 | `asset_depreciations` 表 + `POST /api/fixed-assets/depreciation`（手工录入金额）+ `GET /api/fixed-assets/:id/depreciations`（`server/app.js:5215-5240`） | PARTIAL | 折旧金额为**人工录入**，非按政策自动计提；**不生成会计凭证**（未接 `createSystemVoucher`）；无折旧与 GL 科目对账；无折旧失败回滚保护 |
| AA-17 | 资产处置 | 无（报废/出售/减少/处置单） | MISSING | 整条能力缺失 |

### 2.3 B3114 智能会计平台（AA-18..AA-24）

| ID | Capability | 实现证据 | 判定 | 缺口 |
|---|---|---|---|---|
| AA-18 | 业务 → 凭证平台 | `server/modules/financial-inventory.js::createSystemVoucher`（canonical 原语，row-based：`voucher_origin='SYSTEM'`）+ `reverseSystemVoucher`；科目通过 `account_role_mappings` 角色解析 | PARTIAL | 映射**硬编码在各业务调用方**，不是规则平台；无模板引用、无条件表达式、无规则版本；同一业务类型在不同调用点的映射可能分叉 |
| AA-19 | 凭证模板 | 表 `voucher_templates`（`server/migrations/extended-schema.js:28`，含 `entries_json`）；唯一读入口 `GET /api/voucher-templates`（`server/modules/accounting-config.js:44`） | PARTIAL | **无创建/修改 API**；**全仓无任何生成消费方**（grep `voucher_templates` 仅命中建表、迁移与该只读 handler）；实质是只读字典，不是模板引擎 |
| AA-20 | 自动 / 批量生成 | 各业务单据确认/过账时同步生成系统凭证（`createSystemVoucher`）；`systemHealth` 有 `SYSTEM_VOUCHER_UNIQUENESS` 幂等检查 | PARTIAL | 无批量生成、无调度任务、无生成状态追踪（无法回答"哪些已审核业务单据尚未生成凭证"） |
| AA-21 | 业务与凭证关系 | `accounting_vouchers.source_type / source_id / voucher_origin / reversal_of_id` | PARTIAL | 无统一反向导航：从凭证→业务单据的前端跳转与 API 归一化；`source_type` 为字符串枚举而非关系表 |
| AA-22 | 未生成 / 异常处理 | 无工作台。`systemHealth` 有若干 check，但**不是**"未生成凭证 / 生成失败"清单 | MISSING | 整条能力缺失：accounting event 台账 + 生成状态（`PENDING/FAILED/GENERATED/SKIPPED`）+ 受控修复入口 |
| AA-23 | 业务财务对账 | `server/modules/financial-inventory.js::systemHealth`：`INVENTORY_VALUE_TO_GL` / `INVENTORY_QUANTITY_VS_VALUATION` / `WIP_TO_GL` / `AR_TO_GL` / `AP_TO_GL` / `RECEIPT_GRNI_TO_GL` / `OUTPUT_TAX_TO_GL` / `INPUT_TAX_TO_GL` / `CASH_BANK_TO_GL` / `COGS_TO_GL` / `SUPPLIER_BILL_TO_AP_GL` 等 | PARTIAL | **底座强、产品化缺**：仅作为结账健康检查暴露；无独立对账工作台、无差异可解释说明、无差异修复流程、无对账快照留痕 |
| AA-24 | 期末检查 | `server/modules/extended.js:171` `getPeriodClosureChecklist`：仅检查 `ENTERED` / `SUBMITTED` / `REJECTED` 三态凭证 + `closePeriod` 的 `systemHealth` BLOCKING 拦截 | PARTIAL | 缺「已审核业务单据是否都已生成凭证」的完整性检查（受 AA-22 阻塞）；缺关账清单的分项归因与快照 |

### 2.4 B3115 总账（AA-25..AA-32）

| ID | Capability | 实现证据 | 判定 | 缺口 |
|---|---|---|---|---|
| AA-25 | 凭证录入 | `POST /api/accounting-vouchers`（`server/app.js:4630` `createAccountingVoucher`）+ `GET /api/accounting-vouchers`、`GET /api/accounting-vouchers/:id`；前端 `src/pages/accounting.jsx::VoucherModal` / `VoucherDetail`；测试 `server/voucher.test.js`、`server/voucher-amount-units.test.js` | COVERED | — |
| AA-26 | 凭证过账 | 提交/审核/驳回链路（`server/app.js:2755-2760`）；所有报表口径 `v.status='POSTED'`（`generalLedgerHandler` / `getTrialBalance` / `getIncomeStatement` / `getBalanceSheet`）；`postedOnly: true` | COVERED | — |
| AA-27 | 凭证纠错 | `server/app.js:6642`：已过账**手工**凭证可冲销，生成 `MANUAL_REVERSAL` 凭证，`reversal_of_id` 唯一，审计 `REVERSE_REQUEST` | PARTIAL | 无补充凭证 / 更正差异对比；无冲销审批链（当前为直接冲销 → SUBMITTED）；系统凭证冲销走 `reverseSystemVoucher`，与手工冲销**两条路径** |
| AA-28 | 出纳复核 | 无 | MISSING | 整条能力缺失：无出纳复核状态位、无复核节点、无独立权限 |
| AA-29 | 现金流量 | 无 | MISSING | 整条能力缺失：凭证现金流量项目分配 + 现金流量表（经营/投资/筹资）。`cash_journals` 是 Finance Operations 的现金日记账，**不构成**本能力 |
| AA-30 | 期末转账 / 摊销 / 计提 | 无 | MISSING | 整条能力缺失：期末自动转账、费用摊销、计提（折旧/坏账/存货跌价等） |
| AA-31 | 汇兑损益 | 当前单本位币（所有金额接口 `currency:'CNY'`） | OUT_OF_SCOPE | 多币种未纳入本轮本域范围；如需纳入须另开范围裁定 |
| AA-32 | 损益结转 / 总账结账 | `period_closures` + `createPeriodClosure` / `closePeriod` / `unclosePeriod` / `getClosureChecklist`（`server/modules/extended.js:147-287`）；反结账限 `ADMIN` 且强制填写原因 + `period_reopen_history` 留痕；结账强制先关存货期 | PARTIAL | **无损益结转**（`server/modules/extended.js:1033` 明确「当前 schema 无自动损益结转，通过未结转损益虚拟权益行补偿」）；无结转凭证、无结转与期末检查的顺序约束 |

### 2.5 B3116 报表（AA-33..AA-38）

| ID | Capability | 实现证据 | 判定 | 缺口 |
|---|---|---|---|---|
| AA-33 | 财务报表 | `GET /api/reports/income-statement` / `balance-sheet`（`server/modules/extended.js:982/1036`）；前端 `src/pages/accounting.jsx::IncomeStatement` / `BalanceSheet`；`POSTED`-only | COVERED | — |
| AA-34 | 试算平衡 | `GET /api/reports/trial-balance`（`server/modules/extended.js:893`）；前端 `TrialBalanceReport`；测试 `server/trial-balance.test.js` | COVERED | — |
| AA-35 | 报表模板 | 无。仓库内无报表模板表 / API / 页面 | MISSING | 整条能力缺失：模板、报表项目、单位、权限、期间实例 |
| AA-36 | 公式 | 无报表公式引擎。`server/lib/formula-evaluator.js` 是 Master & Engineering 的**工时公式安全文法**（标识符限 `e_` 前缀、无函数调用、无跨表取数），**不可复用**为报表公式 | MISSING | 整条能力缺失：取数公式、计算公式、跨表校验 |
| AA-37 | 报表编制流程 | 无 | MISSING | 整条能力缺失：实例化期间 → 重算 → 保存 → 提交 → 审核 |
| AA-38 | 管理 / 自定义报表 | `server/modules/decision-reports.js`（5 个固定 reportKey：`sales-summary` / `sales-outstanding` / `purchase-summary` / `purchase-outstanding` / `inventory-movements`）；权限 `REPORT_VIEW` + 域权限；CSV 导出；行级贡献下钻 | PARTIAL | 报表**不可配置**（用户无法自建、自定义维度或公式）；管理会计口径不等于自定义报表（见 AA-39..44） |

### 2.6 B3117 经营会计（AA-39..AA-44）

| ID | Capability | 实现证据 | 判定 | 缺口 |
|---|---|---|---|---|
| AA-39 | 经营账簿 / 组织 | 无。仓库内无经营账簿 / 经营组织 / 阿米巴任何模型、表、API、页面 | MISSING | 整条能力缺失 |
| AA-40 | 经营数据来源 | 无统一 operating ledger | MISSING | 整条能力缺失 |
| AA-41 | 内部结算 | 无 | MISSING | 整条能力缺失 |
| AA-42 | 费用归集分配 | 无 | MISSING | 整条能力缺失 |
| AA-43 | 经营损益 | 无（现有分析报表不等同经营会计） | MISSING | 整条能力缺失 |
| AA-44 | 经营会计关账 | 无 | MISSING | 整条能力缺失 |

---

## 3. 领域级结构缺口（不属于单一 Capability，但阻断整域 Acceptance）

| ID | 缺口 | 证据 | 影响 |
|---|---|---|---|
| ACC-X-01 | **Accounting & Analytics 无 Domain Closure Requirement / Design 正文** | `docs/requirements/README.md`、`docs/design/README.md` 登记「尚无」；`PROJECT_STATUS.md` 附录 A 记「无 Domain Closure Requirement」 | 无正式需求合同可被实现与验收；所有能力缺口无处登记 |
| ACC-X-02 | **固定资产能力用户不可达** | `src/navigation/applicationRegistry.js:94` `fixed-assets` route `enabled: false` | B3107 已建部分能力无法被业务使用，不可计入 Acceptance |
| ACC-X-03 | **Accounting & Analytics Launcher 仅 7 个入口，且 5 个指向同一张固定报表** | `src/navigation/applicationRegistry.js:287-296` | 会计与分析在信息架构上等同于"凭证 + 5 张固定报表"，无总账/报表平台/固定资产/经营会计入口 |
| ACC-X-04 | **会计科目只读** | `GET /api/accounting-subjects` 仅 list（`server/app.js:2660`），无创建/修改/停用 | 科目体系不可维护；凭证模板与角色映射无配置面 |
| ACC-X-05 | **无会计域统一 capability 工作面 / 会计分析工作台** | `business-overview` / `dashboard` 属 `FLOW_SUPPORTING`，未聚合总账、报表平台、固定资产、经营会计 | 用户无法在一个工作面完成"记账 → 对账 → 出表 → 结账 → 经营分析" |
| ACC-X-06 | **`voucher_templates` 无写入口且无消费方** | `server/modules/accounting-config.js:44` 为唯一命中；`server/migrations/extended-schema.js:28` 为建表 | 表存在但语义为"未实现"，是典型的"以文件存在冒充覆盖"风险点 |
| ACC-X-07 | **多币种为全域空白** | 全部金额接口返回 `currency:'CNY'` | 与 AA-31 一并裁定，不在本轮默认范围内 |

---

## 4. 建议的 Closure 范围包（待业务所有者裁定）

下表是**建议**，不是实施授权。每包在进入 Requirement 前需要业务所有者对 `Product Scope` 与 `Authorization` 逐项确认。

| 包 | 名称 | 覆盖 Capability | 目标产出 | 规模判断 |
|---|---|---|---|---|
| **AA-W1** | 会计与分析域基线与统一台账 | AA-18 / AA-20 / AA-21 / AA-22 / AA-23 / AA-24 / ACC-X-01 / ACC-X-04 / ACC-X-05 | 会计事件台账 + 生成状态 + 未生成/异常工作台 + 业务↔GL 对账工作台 + 统一期末检查 + 会计科目维护 | 中 |
| **AA-W2** | 凭证模板与规则平台 | AA-18 / AA-19 / AA-20 | 可创建/编辑的凭证模板、模板消费方、条件与金额表达式、批量生成与调度 | 中 |
| **AA-W3** | 总账增强与期末自动化 | AA-27 / AA-28 / AA-29 / AA-30 / AA-32 | 凭证补充与更正链、出纳复核、现金流量分配与现金流量表、期末转账/摊销/计提、损益结转 | 大 |
| **AA-W4** | 报表平台 | AA-35 / AA-36 / AA-37 / AA-38 | 报表模板 + 安全取数公式引擎 + 期间实例生命周期 + 自定义管理报表 | 大 |
| **AA-W5** | 固定资产完整生命周期 | AA-10..AA-17 / ACC-X-02 | 政策实体、资产卡片、采购转固、变更单、拆分合并、借用盘点、**自动计提折旧并生成凭证**、处置；并把 route 置为 enabled | 大 |
| **AA-W6** | 存货核算深化 | AA-01..AA-09 | 核算范围与体系、采购费用分配、暂估差异、完工成本结转、成本调整、核算关闭异常清单 | 大 |
| **AA-W7** | 经营会计（B3117） | AA-39..AA-44 | 经营账簿/组织、operating ledger、内部结算、费用归集分配、经营损益、经营关账 | **最大** |

**规模提示**：AA-W3 + AA-W4 + AA-W7 合计即覆盖 18 项 `MISSING` 中的 12 项，并新增多张核心表。
若目标是**整域 Acceptance**（6 本手册 44 项全部达到合同要求），AA-W7 无法回避；
若业务所有者愿意按**分期有界交付**推进，建议顺序为 AA-W1 → AA-W2 → AA-W5 → AA-W3 → AA-W6 → AA-W4 → AA-W7，
每包各自走 Requirement → Design → Implementation → Acceptance，最后再签发**域级 Acceptance**。

---

## 5. 明确不做的裁定（待确认）

| ID | 事项 | 建议裁定 | 依据 |
|---|---|---|---|
| ACC-OOS-01 | AA-31 汇兑损益 / ACC-X-07 多币种 | `OUT_OF_SCOPE`（本轮） | 当前单本位币；多币种横跨 Finance Operations + 本域，另开范围裁定 |
| ACC-OOS-02 | AA-29 现金流量**不得**误判为 `OUT_OF_SCOPE` | 必须在范围内 | 现金流量表是 B3115 明确能力项，且不需要多币种即可成立 |
| ACC-OOS-03 | 法定电子发票 / 税务硬件集成 | `OUT_OF_SCOPE` | 沿用 `document.md` 既有裁定 |
| ACC-OOS-04 | B3106 委外成本（AA-07）与 B3105/B3121 的重叠部分 | 归 **Procurement & Outsourcing** 域的业务执行、会计口径归本域 | 避免两域争夺同一 mutable 事实的 canonical owner |

---

## 6. 审计边界与未解决事项

1. 本台账是**静态审计**结果。`COVERED` 的 4 项（AA-25/26/33/34）仍需在 Acceptance 阶段复跑
   `pnpm test:fast` / `pnpm test` / `pnpm build` / `git diff --check` 以及 MySQL gate 后才能签发结论。
2. 本轮**未**运行测试套件、**未**连接真实 MySQL、**未**修改任何实现代码、**未**执行 migration。
3. 工作树内的 Procurement 域未提交改动使 AA-07 的委外成本结论存在时效风险，需在 Procurement 域提交后复核。
4. `docs/status/CAPABILITY_MATRIX.md` 中 B3106 / B3107 / B3114–B3117 当前记为 `UNVERIFIED`；
   本台账**不**改写该表（正式 Capability 覆盖状态只在该表登记，且须有可执行证据）。
5. 本台账结论**不构成**任何 Acceptance、Freeze、Scope Decision 或实施授权。

---

## 7. 实施后逐项复核（2026-11-11）

> 本节是 AA-W1..AA-W7 实施完成后的**逐项复核**，取代 §2 的实施前判定；§2 的原始判定作为审计基线**保留不变**。
> 判定沿用 §「审计方法」的同一把尺子：(a) 有生产写入口或权威读入口；(b) 有服务端来源 / 状态 / 权限 / 事务约束；
> (c) 有可执行测试覆盖正例。**不凭文件存在或表存在宣称覆盖。**
> 本节**不构成** Capability Freeze 或 Domain Acceptance —— 正式覆盖状态只登记在
> [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)，且须有可执行证据。

### 7.1 复核统计

| 手册 | Capability 数 | COVERED | PARTIAL | MISSING | OUT_OF_SCOPE |
|---|---|---|---|---|---|
| B3106 存货核算 | 9 | 8 | 1 | 0 | 0 |
| B3107 固定资产 | 8 | 8 | 0 | 0 | 0 |
| B3114 智能会计平台 | 7 | 7 | 0 | 0 | 0 |
| B3115 总账 | 8 | 7 | 0 | 0 | 1 |
| B3116 报表 | 6 | 6 | 0 | 0 | 0 |
| B3117 经营会计 | 6 | 6 | 0 | 0 | 0 |
| **合计** | **44** | **42** | **1** | **0** | **1** |

对比 §35.3 的目标判定（43 `COVERED` + 1 `OUT_OF_SCOPE`）：**AA-07 委外成本** 未能在本域闭合，
是本轮唯一的未解决矛盾（见 §7.3）。

### 7.2 逐项复核结论

| Capability | 基线判定 | 复核判定 | 证据（写入口 / 约束 / 可执行测试） |
|---|---|---|---|
| AA-01 核算范围与核算体系 | `PARTIAL` | `COVERED` | `accounting_scopes` / `product_costing_profiles`（`server/migrations/inventory-costing-schema.js`）；`accounting-inventory-cost.js::resolveCostingProfile`；「AA-W6.1/2 核算范围是独立实体，维度非法、编码重复与越权一律拒绝」 |
| AA-02 计价方法 | `PARTIAL` | `COVERED` | 同上「AA-W6.3 计价方法按属性 > 类别 > 默认选择，同级并列时 fail closed」「AA-W6.4 已有估值移动的物料变更计价方法被拒绝」 |
| AA-03 采购入库成本 | `PARTIAL` | `COVERED` | 成本构成四段齐备：暂估 `provisional_receipts` / 正式与差异 `provisional_receipt_adjustments` / 分摊费用 `purchase_expense_allocations` / 权威估值流水 `inventory_valuation_movements`；「AA-W6.5/6」「AA-W6.8/9/10」；构成经 `GET /api/accounting/provisional-receipts` 与 `GET /api/purchase-expenses` **可回看**（AA-W6.7） |
| AA-04 采购费用分配 | `MISSING` | `COVERED` | `purchase_expenses` / `purchase_expense_allocation_rules` / `purchase_expense_allocations`；「AA-W6.8/9/10 采购费用分摊：可重算、进入权威价值流水并生成凭证」 |
| AA-05 暂估成本 | `PARTIAL` | `COVERED` | 「AA-W6.5/6 暂估入库单与差异调整：差异走调整凭证，暂估金额不被改写」 |
| AA-06 生产入库成本 | `PARTIAL` | `COVERED` | `production_cost_closings`（`product_cost_cents + variance_cents == wip_cents`，`variance_target` 显式）；「AA-W6.11/12 完工成本结转：金额守恒、差异去向显式并与 GL 一致」 |
| **AA-07 委外成本** | `PARTIAL` | **`PARTIAL`（未闭合）** | **本域无实现**：§35.4.6 的 AA-W6 条款未包含 AA-07，本域模块无任何 `OUTSOURCE` 取数规则；委外成本口径当前由采购委外域 canonical 实现承担（`server/modules/outsourcing-finance.js` 读取 `backflush.valuation.issuedValueCents` + `outsourcing-gl-policy.js::resolveProcessingFeeAccountingProfile`，2026-11-11 域级 Acceptance 已冻结）。详见 §7.3 |
| AA-08 出库核算 / 成本调整 | `PARTIAL` | `COVERED` | `cost_adjustments` + 调整凭证 + 原因与授权人可追溯；「AA-W6.13/14 成本调整：生成凭证并可追溯原因与授权人」 |
| AA-09 存货关账 | `PARTIAL` | `COVERED` | `GET /api/accounting/costing-close-checklist` 五类异常清单（估值↔GL 差异、`LEGACY_UNVALUED`、负库存/残值、暂估未结转、成本调整未过账）+ `systemHealth` 合并展示；「AA-W6.15/16」 |
| AA-10 资产基础资料 | `PARTIAL` | `COVERED` | 资产类别 / 位置 / 折旧政策为独立实体，卡片引用而非内嵌文本；「AA-W5 · 资产类别、资产位置与折旧政策是独立实体，卡片引用而非内嵌文本」 |
| AA-11 资产卡片 | `PARTIAL` | `COVERED` | `fixed_assets` 生命周期主对象（状态机 DRAFT→ACTIVE→IDLE→DISPOSING→DISPOSED）；AA-W5 全部用例 |
| AA-12 采购转固 | `MISSING` | `COVERED` | 「AA-W5 · 转固金额取自采购收货单并绑定来源，同一来源不得重复转固」「转固不允许调用方提供金额」「只有已确认的采购收货单可以转固」 |
| AA-13 资产变更 | `PARTIAL` | `COVERED` | 「AA-W5 · 变更未生效前资产当前值不得被改写，审核人不得是制单人」「已计提折旧的资产不得直接改原值」 |
| AA-14 拆分 / 合并 | `MISSING` | `COVERED` | 「AA-W5 · 拆分必须价值守恒，累计折旧按原值比例结转」「合并后原值等于合并前合计」 |
| AA-15 借用 / 盘点 | `MISSING` | `COVERED` | 「AA-W5 · 借用登记与归还受控，未归还时不得重复借出」「盘点差异被记录但不得改写资产原值或累计折旧」 |
| AA-16 折旧 | `PARTIAL` | `COVERED` | 「AA-W5 · 按期间自动计提、生成凭证并与 GL 累计折旧科目对账，且同期间幂等」「手工折旧录入受控：超过剩余可折旧金额被拒绝」 |
| AA-17 资产处置 | `MISSING` | `COVERED` | 「AA-W5 · 处置生成凭证并结转处置损益，审核人不得是制单人」「已处置资产不得再计提折旧」 |
| AA-18 业务 → 凭证平台 | `PARTIAL` | `COVERED` | `accounting-rules.js` 模板 + 规则绑定 + 命中解析；「AA-W2.1」「AA-W2.5 规则命中唯一：未命中与歧义都显式失败」「AA-W2.6 科目通过角色解析，缺少映射时失败」 |
| AA-19 凭证模板 | `PARTIAL` | `COVERED` | 模板可创建 / 修改 / 停用 + 试算 preview + **被生成链路真实消费**；「AA-W2.1」「AA-W2.2 停用模板后新业务不再命中，已生成凭证不受影响」「AA-W2.3 已被使用过的模板版本不得原地改写」 |
| AA-20 自动 / 批量生成 | `PARTIAL` | `COVERED` | `POST /api/accounting/events/batch-generate`（逐条独立事务）+ `accounting_generation_runs` 状态追踪；「AA-W2.9 批量生成逐条独立事务，单条失败不回滚整批」 |
| AA-21 业务与凭证关系 | `PARTIAL` | `COVERED` | `accounting_events` 唯一台账，自然键 DB 级唯一；「AA-W1.1」「AA-W1.4」 |
| AA-22 未生成 / 异常处理 | `MISSING` | `COVERED` | `GET /api/accounting/events/ungenerated` + 稳定错误码 + 受控修复（重试 / 跳过并说明原因 / 恢复，均写审计）；「AA-W1.5/1.6」「AA-W1.7」「AA-W1.8 重复修复不会产生第二张凭证」 |
| AA-23 业务财务对账 | `PARTIAL` | `COVERED` | `GET /api/accounting/reconciliation` + 不可变快照 `accounting_reconciliation_runs`；「AA-W1.9」「AA-W1.10 对账快照可按期间回看且重复运行幂等」 |
| AA-24 期末检查 | `PARTIAL` | `COVERED` | `GET /api/accounting/close-checklist` 统一检查 + 真实拦截关账；「AA-W1.12/1.13」「AA-W1.12 存在未生成事件时关账被真实拦截」 |
| AA-25 凭证录入 | `COVERED` | `COVERED` | 既有 `/api/accounting-vouchers` 契约未变（§35.6.1 回归固定） |
| AA-26 凭证过账 | `COVERED` | `COVERED` | 既有 `status='POSTED'` 口径未变（§35.6.2 回归固定） |
| AA-27 凭证纠错 | `PARTIAL` | `COVERED` | `accounting-posting.js` 统一冲销 / 补记路径，金额与方向镜像；「AA-W3.1/W3.3」「AA-W3.4」 |
| AA-28 出纳复核 | `MISSING` | `COVERED` | 独立节点 + `VOUCHER_CASHIER_REVIEW` 权限 + 制单人≠复核人 + 未复核不得过账；「AA-W3.5」「AA-W3.6」「AA-W3.7」 |
| AA-29 现金流量 | `MISSING` | `COVERED` | 三段式现金流量表 + 未分类现金分录显式 + 与资金子账差异标记；「AA-W3.8/W3.9」「AA-W3.10」 |
| AA-30 期末转账 / 摊销 / 计提 | `MISSING` | `COVERED` | 期末定义 + 幂等执行 + 凭证生成；「AA-W3.11」「AA-W3.12/W3.13」 |
| AA-31 汇兑损益 | `OUT_OF_SCOPE` | `OUT_OF_SCOPE` | 业务所有者 2026-11-10 裁定；本域单本位币 CNY（§35.6.9） |
| AA-32 损益结转 / 总账结账 | `PARTIAL` | `COVERED` | 真实损益结转（结转后损益归零、权益承接净损益）+ 未结转禁止关账 + 反结转限 ADMIN 且留痕 + **移除虚拟权益行**；「AA-W3.14」「AA-W3.16」「AA-W3.17」「AA-W3.15 移除虚拟权益行后资产负债表口径自洽」 |
| AA-33 财务报表 | `COVERED` | `COVERED` | 既有口径未变（§35.6.2 回归固定） |
| AA-34 试算平衡 | `COVERED` | `COVERED` | 既有口径未变；试算平衡科目集合由 21→22→23→27（AA-W3 / AA-W5 种子科目），已由 `server/trial-balance.test.js` 固定 |
| AA-35 报表模板 | `MISSING` | `COVERED` | `report_templates` + 行项目 + 可见范围 + 状态 + 版本；「AA-W4.1/2」 |
| AA-36 公式 | `MISSING` | `COVERED` | 受限文法求值，无 `eval` / `Function` / 动态代码执行面，失败显式报错不静默取 0；「AA-W4.4/6/7」 |
| AA-37 报表编制流程 | `MISSING` | `COVERED` | 实例化 → 重算 → 提交 → 审核，提交与审核分离、审核留痕、审核后重算生成新版本；「AA-W4.8/9/10」 |
| AA-38 管理 / 自定义报表 | `PARTIAL` | `COVERED` | 自定义报表沿用同一模板与期间口径、可见范围受控；既有 5 张固定执行报表口径与入口不变；「AA-W4.11/12」「AA-W4.13」 |
| AA-39 经营账簿 / 组织 | `MISSING` | `COVERED` | `management_books` / `profit_centers` 独立实体；「AA-W7.1/2」 |
| AA-40 经营数据来源 | `MISSING` | `COVERED` | `operating_ledger_entries` 只取已过账事实、归集幂等、来源可追溯；「AA-W7.3/4」 |
| AA-41 内部结算 | `MISSING` | `COVERED` | `internal_settlement_prices` 可维护、非法窗口被拒；「AA-W7.5」 |
| AA-42 费用归集分配 | `MISSING` | `COVERED` | `cost_collection_plans` + `allocation_rules` + `allocation_results`，可重算一致、基数缺失 fail closed；「AA-W7.7/8」 |
| AA-43 经营损益 | `MISSING` | `COVERED` | 经营损益与法定损益勾稽，差额显式列出（未分配 / 内部交易抵消 / 口径差异三段）；「AA-W7.9/10」 |
| AA-44 经营会计关账 | `MISSING` | `COVERED` | 经营关账要求归集与分摊完成、法定期间先行、受控反结账；「AA-W7.11/12」 |

### 7.3 唯一未解决矛盾：AA-07 委外成本

**事实**：

1. `docs/requirements/accounting-analytics.md` §35.3 把 AA-07 的目标判定记为 `COVERED`，归属范围包 AA-W6；
2. 但同一份 Requirement 的 §35.4.6（AA-W6 的可验收条款）**不含任何 AA-07 条款** —— AA-07 没有可实施、可测试的合同条款；
3. 本域 6 个后端模块与 7 个 migration 中**没有任何 `OUTSOURCE` 取数规则**；
4. 委外成本口径当前由采购与委外域的 canonical 实现承担：材料成本取本域权威估值流水
   （`outsourcing-finance.js` 的 `backflush.valuation.issuedValueCents`），加工费取自
   `outsourcing-gl-policy.js::resolveProcessingFeeAccountingProfile` 解析的会计档案；
   该域已于 2026-11-11 签发域级 Acceptance 与 Capability Freeze；
5. §35.2 第 2 条同时要求「本域的委外成本来源必须是采购与委外域的**权威事实引用**」。

**矛盾**：§35.3 要求「在本域固化取数规则」，§35.4.6 却没有该规则，§35.2 又禁止本域另立事实。
按 AGENTS.md §4.4，实施阶段**不得**自行新增业务规则；按 §35.9 第 4 项，这属于
「Capability 编号与真实业务关系不一致」的 Hard Stop。

**待业务所有者裁定的两个选项**（**本轮未自行选择**）：

| 选项 | 内容 | 影响 |
|---|---|---|
| **A** | 裁定 AA-07 由采购与委外域已冻结的 canonical 实现承担，本域只做**权威事实引用**；据此在 §35.4.6 补一条明示条款 | 复核结论变为 **43 `COVERED` + 1 `OUT_OF_SCOPE`**，与 §35.3 目标一致；不改代码 |
| **B** | 在 §35.4.6 补一条条款，要求本域提供**只读**的委外成本构成投影（材料成本 + 加工费），事实来源仍是采购与委外域 | 需新增一条只读端点与测试；不新增业务事实、不改他域实现；复核结论同样变为 43 `COVERED` |

无论选 A 或 B，**AA-07 的合同条款都必须先在 Requirement 层落定**，再进入 Implementation。

---

## 8. 变更历史

| 版本 | 日期 | 变更 | 基准 SHA |
|---|---|---|---|
| `v0.1` | 2026-11-10 | 首次域级审计：44 项 Capability 逐项取证与判定；登记 7 条领域级结构缺口；提出 7 个范围包建议 | `eee92c21751b9e6fa224125611750a4af4988591` |
| `v0.2` | 2026-11-11 | AA-W1..AA-W7 实施后逐项复核：42 `COVERED` / 1 `PARTIAL`（AA-07）/ 1 `OUT_OF_SCOPE`；登记唯一未解决矛盾 AA-07 与两个待裁定选项；§2 实施前判定保留不变 | `d9e7319`（AA-W7 提交） |
