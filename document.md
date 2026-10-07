# Modern ERP 当前功能、目标业务架构与能力需求

> Canonical business requirements — 2026-10-06 baseline

## 1. 文档职责、范围与版本语义

本文档是 Modern ERP **唯一当前功能与业务需求来源**，回答：

- 系统现在已经支持什么；
- 最终新版 ERP 必须支持什么；
- 每项业务能力应属于哪个目标 Domain；
- 哪些能力已经覆盖、部分覆盖、缺失或明确不在范围；
- 后续开发必须如何从 Gap 形成 Requirement。

技术实现方法、函数职责、模块调用关系和迁移设计见 `solution.md`。
开发与 AI/Vibe Coding 治理见 `AGENTS.md`。
运行方式、仓库结构与版本入口见 `README.md`。
`log/YYYY-MM-DD.md` 只追加开发历史，不替代当前需求。

当前已发布基线仍为 `v1.6.2`；`master` 可以领先 release tag。本文档描述当前目标需求与当前仓库事实，不单独维护语义版本。

本文件所引用的金蝶能力基线来自《金蝶云星空标准版操作手册》B3101–B3122 共 22 份手册。Claude/Codex 后续即使无法直接访问原始 Word 手册，也必须把本文件 §22 的手册能力基线作为需求审计来源之一；若未来重新查阅原手册发现差异，以原手册事实 + 用户确认后的本文件修订为准。

### 1.1 核心术语

- **Capability**：可以独立审计、实现和验收的业务能力。
- **Domain**：新版 ERP 的长期业务边界，不等于菜单页、数据库表或金蝶手册编号。
- **canonical**：系统承认的唯一业务事实源或实现 owner。
- **业务日期**：决定履行、库存、计价或会计期间归属的日期；不得用创建时间替代。
- **来源快照**：单据形成时冻结的客户/供应商/物料/价格/UOM/税/BOM/工艺/条款等关键来源事实。
- **CHECK-only**：只检测和报告差异，不自动改写历史业务事实。
- **Coverage**：当前 Modern ERP 相对目标 Capability 的覆盖状态。

Coverage 只允许：

- `COVERED`
- `PARTIAL`
- `MISSING`
- `SEMANTIC_MISMATCH`
- `OUT_OF_SCOPE`

§22 中的 Coverage 是 **2026-10-06 架构级基线初判**，用于让后续 Agent 不依赖原手册开始审计；它不是最终 Module Acceptance。进入具体模块时仍必须读取真实代码并补齐 Route/API/Owner/Schema/State/RBAC/Transaction/Audit/Test 证据。

---

## 2. 产品目标

Modern ERP 是 mobile-first 制造业 ERP。长期目标不是复制传统桌面 ERP 的页面结构，而是在现代移动端产品形态下完整实现成熟 ERP 的：

- 业务术语；
- 端到端流程；
- 单据来源关系；
- 状态机；
- 权限与职责分离；
- 审批/工作流；
- 库存与身份控制；
- 结算、核算与会计控制；
- 期间控制；
- 审计和可追溯性。

现有已验证业务事实优先复用；禁止以“新版架构”为理由进行整仓重写。

系统必须保持：

1. 授权审批、实物执行、商业确认、会计过账是不同事件；
2. 库存数量、LOT/SERIAL 身份、价值、WIP、AR/AP、资金和 GL 事实可追溯；
3. 已产生经济/库存影响的历史不能通过普通编辑或硬删除改写；
4. 纠错通过显式反向、冲销、贷项、退货或重开等受控方式完成；
5. SQLite 本地/测试路径与 MySQL 8 一等运行路径保持相同业务合同；
6. System Health/Reconciliation 默认 CHECK-only；
7. Mobile-first 不得牺牲业务语义。

---

## 3. 新版 ERP 目标架构：8 Business Domains + Platform

22 份金蝶手册与新版产品架构采用“双轴”：

- **B3101–B3122 = Requirements / Coverage / Acceptance 轴**
- **8 Business Domains + Platform = Product Architecture / Ownership 轴**

不得把 22 本手册直接变成 22 个一级菜单。

| Domain | 中文 | 长期责任 |
|---|---|---|
| Master & Engineering | 主数据与工程数据 | Organization、Business Partner foundation、Material、Warehouse foundation、BOM、Routing、Operation、Work Center、Resource、Calendar、Substitute、ECO |
| Sales & Customer | 销售与客户 | Customer、Quotation、Sales Order/Change、Delivery、Return/Replacement、Pricing/Discount、Credit |
| Planning | 需求与计划 | Forecast、Consumption、Demand/Supply、Reservation、MRP、Pegging、Planned Order、Release |
| Procurement & Outsourcing | 采购与委外 | Requisition、Sourcing、Quota、PO、Receipt/Return、VMI、Outsourcing |
| Manufacturing & Quality | 制造与质量 | Production Order、Material List、Issue/Return/Supplement、Operation Execution、WIP、Inspection、NC |
| Inventory & Warehouse | 库存与仓储 | Inventory Ledger、Inbound/Outbound、Transfer、Adjustment、Stocktake、Status、LOT/SERIAL、Bin、Barcode |
| Finance Operations | 财务运营 | AR/AP、Provisional AR/AP、Invoice、Collection/Payment、Treasury、Bank、Bills、Inventory Cost、Fixed Assets |
| Accounting & Analytics | 会计与分析 | Accounting Platform、Voucher、GL、Period End、Financial Reports、Management Accounting |
| Platform | 平台层 | Identity/RBAC、Organization Scope、Workflow、Approval、Document Lifecycle/Relation/Conversion、Numbering、Attachment、Audit、Notification、Period Control |

---

## 4. 角色、权限与职责分离

当前五个 canonical 角色继续作为现状基线：

| 角色 | 当前主要职责 |
|---|---|
| ADMIN | 系统配置、主数据、计划/制造管理、异常管理、当前五角色模型中的手工凭证审批 |
| SALES | 客户/供应商、销售/采购业务单据和请购创建编辑提交 |
| REVIEWER | 独立审核销售订单、采购订单、请购和库存盘点 |
| WAREHOUSE | 收发货、退货、IQC/OQC、盘点、调拨、调整、报废、生产领退料与生产入库 |
| ACCOUNTING | AR/AP、收付款、贷项/退款/核销、手工凭证、财务报表 |

当前审批中心五类授权事件仍为：

- `SALES_ORDER`
- `PURCHASE_ORDER`
- `PURCHASE_REQUISITION`
- `INVENTORY_CHECK`
- `ACCOUNTING_VOUCHER`

在 B3122 Generic Workflow 完成之前，不得用半成品 Workflow 取代这些 canonical 审批合同。

前端隐藏不是授权；每个 API 必须独立后端授权。VIEW 不得隐式授予 CREATE/MANAGE/APPROVE/POST/REVERSE。

---

## 5. 通用业务不变量

### 5.1 金额、数量、UOM、税与日期

- API/数据库金额使用安全整数分；
- 借贷必须严格平衡，不存在“一分容差”；
- 数量必须符合业务允许的正数/非负数及 UOM 换算；
- SERIAL 基本单位数量必须为整数；
- 税、UOM、价格和关键来源在过账/确认边界冻结历史快照；
- 订单日期、要求交期、预计到货日、物流日期、会计日期等业务日期必须显式保存；
- 报表按权威业务日期而不是 `created_at` 归属期间；
- 未知 legacy 业务日期必须标记未知，不得伪造。

### 5.2 状态、不可变性与纠错

- 状态转换必须同时检查当前状态、权限、来源、累计执行量和业务不变量；
- DRAFT 且无下游/经济影响的记录才允许按政策编辑或删除；
- 已确认/过账/完成的经济事实不得普通编辑或硬删除；
- 已关闭期间不得回写历史；
- 纠错必须留下来源、反向和审计证据。

### 5.3 来源、转换与累计执行

新的正常业务单据必须保留：

- source document；
- source line；
- target document；
- target line；
- source quantity；
- converted/executed quantity；
- reversed quantity；
- remaining quantity。

来源关键字段和来源快照不得被普通草稿更新静默替换。

### 5.4 事务、幂等与审计

确认/过账时必须在事务内重新读取：

- 当前状态；
- 来源；
- 累计执行量；
- 库存/未结余额；
- 期间状态；
- 必要的质量/信用/权限控制。

失败必须回滚库存、价值、AR/AP、资金、凭证、审计和幂等结果。关键 mutation 必须写 audit。

---

## 6. 必须保持的端到端主链

### 6.1 O2C

`客户/报价 → 销售订单 → 信用 → 计划/预留 → 发货/出库 → OQC → 销售发票 → AR → 收款/贷项/退款/核销 → 会计`

### 6.2 P2P

`需求/MRP → 请购 → 寻源/供应商分配 → PO → 收料/检验/入库 → 暂估/应付 → 采购发票/账单 → 付款/退款/核销 → 存货成本/会计`

### 6.3 Plan-to-Produce

`销售订单/预测 → MRP → 计划订单/生产指令 → 生产订单 → BOM/用料 → 领退补料 → 工序执行/报工 → 检验 → 生产入库 → WIP/成本/会计`

### 6.4 Plan-to-Outsource

`MRP → 委外计划/订单 → 委外用料 → 发料 → 供应商加工 → 收料/检验 → 委外入库 → 加工费 AP → 材料+加工成本`

### 6.5 R2R

`业务事实 → Inventory/AR/AP/Treasury/Asset/Cost → Accounting Event → Voucher → GL → Period End → Financial Reports / Management Accounting`

Platform Workflow / Approval / Audit / Document Relation/Conversion 贯穿全部主链。

---

## 7. 当前核心业务合同

### 7.1 主数据与工程基础

当前已有客户、供应商、产品、仓库、会计科目、部门、辅助项目、银行账户、税码、UOM、BOM、工艺路线、工作中心等基础。历史引用主数据不得硬删除，应停用并保留历史显示。产品库存真相来自 canonical inventory，而不是 `products.stock_quantity`。

### 7.2 Order-to-Cash

当前 canonical 主链：

`Customer → Sales Order → Approval → Sales Delivery → OQC → Inventory/COGS → Sales Invoice → AR → Collection/Credit/Refund/Write-off`

出货累计量不得超过批准订单来源量；仓库不得修改商业价格；OQC 和商业开票是独立事件；退货的物理与商业影响必须分离。

### 7.3 Procure-to-Pay

当前 canonical 主链：

`MRP/Purchase Instruction → Purchase Requisition → Approval → PO → Approval → Purchase Receipt → IQC → Inventory/GRNI → Supplier Bill → AP → Payment/Credit/Refund/Write-off`

来源型 PO 必须保留不可变来源身份；收货不得超过来源订单累计量；IQC 与库存确认分离；Supplier Bill/AP 与库存收货分离。

### 7.4 Planning

Forecast、Sales Demand、Inventory、Purchase/Production Supply、BOM 进入 MRP。MRP 本身不得直接产生库存或会计副作用。MRP 输出通过生产/采购指令、请购等受控释放进入执行。

### 7.5 Manufacturing

生产订单、BOM/Routing snapshot、领退料、工序报工、生产入库、WIP/成本必须保持来源和事务一致。制令开工/完工本身不应被错误等同于库存移动。

### 7.6 Inventory / LOT / SERIAL / Traceability

库存、LOT/SERIAL 身份、tracked movements、source allocation、production genealogy 必须保持一致。跟踪策略产生历史流水后不得任意关闭或切换。调拨是 WAREHOUSE 实物事件，不属于授权审批族。

### 7.7 Quality

IQC/OQC 是物流确认前的质量门禁，不独立创造库存或会计事实。质量 PASS/FAIL/WAIVED/RETEST 等状态必须与来源快照一致。

### 7.8 AR/AP 与 Settlement

AR/AP open item、收付款、分配、退款、write-off、reversal 必须保留 immutable source 和可追溯未结余额。物流发生不等于 AR/AP 建立；商业 invoice/bill 才是当前核心商业确认边界。

### 7.9 Inventory Valuation / WIP / Accounting

数量、身份与价值是不同但关联的账。系统凭证以 source_type/source_id 等唯一来源关系连接业务事实。正式财务报表只取 POSTED 凭证。

### 7.10 Period Close

库存、核算、财务期间关闭后，不允许普通 mutation 回写历史；反结账、冲销、反向业务必须留下证据并遵循顺序控制。

---

## 8. 当前运行限制与长期目标必须区分

当前事实：

- 单组织；
- 单本位币；
- 部分 `cash-journals` / `bills` / `fixed-assets` / `workflows` 前端 Route 仍 disabled；
- Generic Workflow、Credit、Barcode、完整 Outsourcing 尚未完成；
- `server/app.js` 与部分前端页面仍存在 mixed-owner / large-file 技术债。

这些是**当前限制**，不是永久产品原则。

长期目标中：

- Organization/Organization Scope 属于 Master & Engineering + Platform；
- 多币种属于 Finance Operations + Accounting & Analytics；
- 在正式 Requirement/Design/Implementation 完成前，不得宣称已支持。

以下不因本轮架构自动进入范围：

- 政府法定电子发票/税务申报；
- 超出手册能力的完整 APS；
- 完整 MES/OEE；
- 完整 QMS/CAPA；
- 外部客户/供应商门户；
- 未经独立立项的大规模扩展产品。

---

## 9. 非核心扩展范围收口

最终产品删除当前不属于 B3101–B3122 核心 ERP 的扩展：

- `projects`
- `tasks`
- `timesheets`
- `contacts`（当前 CRM extension）
- `followups`
- `activities`

但：

1. 删除 CRM `contacts` 不等于删除 ERP Customer/Supplier Contact；
2. 客户联系人、收货地址、结算方、付款方等属于核心 Sales & Customer；
3. 若旧 contacts 数据可以迁移为核心 Contact，必须先迁移再删除 extension；
4. `projects-workflow.jsx`、`server/modules/business.js` 是 mixed-owner，必须保留/提取 Platform notifications/workflows 后再删除 Project/CRM 部分；
5. 历史表不得在普通代码清理中直接 DROP；
6. schema cleanup 需要独立数据保留、备份、SQLite/MySQL migration 与 rollback 设计。

---

## 10. Mobile-first 产品合同

- 390px 为主要移动设计基线，同时验证 320/430/680；
- 核心任务不能依赖永久横向页面滚动；
- 复杂对象采用 LIST → DETAIL → EDITOR/WORKFLOW；
- direct URL / refresh / Back / Forward 必须正确；
- 前端 `applicationRegistry.js` 是最终用户 Route canonical source；
- 8 个 Domain 不等于 8 个底部 Tab；
- MobileShell 全局入口保持任务导向；
- UI 现代化不得修改业务术语、API、权限、状态机、审批/确认语义和上下游关系。

---

## 11. 安全与非功能要求

- opaque Bearer Token，数据库只保存安全 digest；
- 密码安全哈希，不记录明文密码/token；
- 会话失效、登录限流和锁定必须 fail closed；
- JSON body、Content-Type、字段白名单必须严格；
- API 返回安全响应、no-store 和 X-Request-Id；
- 运行日志结构化脱敏；
- readiness/liveness 不泄露连接秘密；
- SQLite 与 MySQL 8 双路径；
- 生产/破坏性数据库操作必须单独批准；
- MySQL destructive test 只能运行于显式 disposable 测试库。

---

## 12. 测试与验收通用要求

任何行为变更至少验证：

1. 正常路径；
2. 非法状态；
3. 越权；
4. 重复提交/幂等；
5. 事务回滚；
6. 来源/累计量；
7. 库存/身份/价值/AR/AP/GL/WIP 副作用；
8. audit；
9. focused tests；
10. 按 AGENTS.md 运行 full/build/diff/heavy/MySQL 等适用 gate。

Implementation Agent 自报“PASS/完成”不是最终 Acceptance。最终 Acceptance 以真实代码、需求、设计和测试证据为准。

---

## 13. 文档先行与 Requirement 边界

新增或修改 Capability：

`AUDIT → COVERAGE/GAP → REQUIREMENT(document.md) → DESIGN(solution.md) → IMPLEMENTATION → ACCEPTANCE`

- `COVERED` 默认不改；
- `PARTIAL` 只补差额；
- `MISSING` 按批准 Requirement 新增；
- `SEMANTIC_MISMATCH` 先纠正业务语义；
- `OUT_OF_SCOPE` 不实现，也不得通过 UI 暗示支持。

---

## 14. 手册能力与目标 Domain 主映射

| Manual | 模块 | 主要 Domain |
|---|---|---|
| B3101 | 采购管理 | Procurement & Outsourcing |
| B3102 | 销售管理 | Sales & Customer |
| B3103 | 信用管理 | Sales & Customer |
| B3104 | 库存管理 | Inventory & Warehouse |
| B3105 | 条码管理 | Inventory & Warehouse / Manufacturing & Quality |
| B3106 | 存货核算 | Finance Operations |
| B3107 | 固定资产 | Finance Operations |
| B3108 | 应付款-业务应付 | Finance Operations |
| B3109 | 应付款-暂估应付 | Finance Operations |
| B3110 | 应收款-业务应收 | Finance Operations |
| B3111 | 应收款-暂估应收 | Finance Operations |
| B3112 | 发票管理 | Finance Operations |
| B3113 | 出纳管理 | Finance Operations |
| B3114 | 智能会计平台 | Accounting & Analytics |
| B3115 | 总账 | Accounting & Analytics |
| B3116 | 报表 | Accounting & Analytics |
| B3117 | 经营会计 | Accounting & Analytics |
| B3118 | 工程数据 | Master & Engineering |
| B3119 | 生产管理 | Manufacturing & Quality |
| B3120 | 计划管理 | Planning |
| B3121 | 委外管理 | Procurement & Outsourcing |
| B3122 | 工作流设计与配置 | Platform |

---

## 15. Capability Audit Matrix 使用规则

进入任何 B3101–B3122 模块开发前，Agent 必须把 §22 对应手册的“手册能力基线”与真实仓库逐项核对。

每条最终证据必须扩展为：

`Manual → Capability → Target Domain → UI/Route → API → Handler Owner → Schema → State Machine → RBAC/SOD → Transaction/Audit → Tests → Coverage → Gap → Requirement Ref → Design Ref → Acceptance Evidence`

不得因为存在同名页面/API 就判定 `COVERED`。

---

## 16. 现有架构资产复用原则

应优先保留并继续扩展：

- `applicationRegistry.js` / RouteLocation / MobileShell；
- Route-table / domain ownership extraction；
- Planning / MRP / Pegging；
- Production Workflow / Manufacturing Execution；
- Inventory ledger；
- LOT/SERIAL / Traceability / Genealogy；
- IQC/OQC；
- AR/AP / Settlement；
- Inventory Valuation / WIP；
- Voucher / GL；
- RBAC / Audit；
- SQLite/MySQL adapters；
- test suite governance；
- deployment baseline。

大型 mixed-owner 文件可以逐步拆分，但不能为了目录美观进行 big-bang rewrite。

---

## 17. Platform 长期能力

Platform 最终承担：

- Identity / RBAC / SOD；
- Organization Scope；
- Workflow；
- Approval；
- Document Lifecycle；
- Document Relation；
- Document Conversion；
- Numbering；
- Attachment；
- Notification；
- Audit；
- Period Control。

Document Conversion 的抽象必须服务来源追溯，但不能覆盖各 Domain 自己的业务校验。

Generic Workflow 由 B3122 驱动；在完成前，现有五审批族保持 canonical。

---

## 18. 完成定义

新版 ERP 最终完成，不以页面数量判断，而至少满足：

- B3101–B3122 每个目标 Capability 最终为 `COVERED` 或用户明确批准的 `OUT_OF_SCOPE`；
- 8 Domains + Platform 有唯一 canonical ownership；
- O2C、P2P、Plan-to-Produce、Plan-to-Outsource、R2R 端到端可追溯；
- source/downstream、累计执行量、反向证据可追溯；
- Inventory/LOT-SERIAL/WIP/AR/AP/Valuation/GL 账实一致；
- 非核心 Project/CRM extension 不再是 active product capability；
- Mobile 320/390/430/680 合同成立；
- SQLite/MySQL 适用 gate 通过；
- 用户最终 Acceptance 通过。

---

## 19. 当前开发推进顺序

1. 修复并冻结本 canonical `document.md`；
2. Core Scope Cleanup Audit / Requirement / Design / Implementation / Acceptance；
3. Domain Alignment；
4. 从 B3101 起逐手册：
   `Manual Baseline → Current Audit → Coverage/Gap → Requirement → Design → Implementation → Acceptance/Freeze`；
5. 跨域 foundation 必须由已确认 Capability Gap 驱动，不能重新形成“为重构而重构”的 Wave roadmap。

---

## 20. 金蝶手册需求对标与能力验收主线

### 20.1 手册是需求来源，不是产品菜单

B3101–B3122 是需求完整性与验收单位；8 Domains + Platform 是产品架构。
一个手册可以跨多个 Domain，一个 Domain 可以吸收多本手册。

### 20.2 审计顺序

默认按：

`B3101 → B3102 → ... → B3122`

作为需求审计顺序。只有用户明确调整时改变。

### 20.3 Freeze

对应手册的所有目标 Capability 最终都达到 `COVERED` 或批准的 `OUT_OF_SCOPE`，且用户确认 Acceptance 后，才可形成该手册 Capability Freeze。Freeze 不表示存在同名一级产品模块。

---

## 21. 领域级当前差距概览

| Domain | 当前可复用基础 | 主要 Gap | 基线状态 |
|---|---|---|---|
| Master & Engineering | Customer/Supplier/Product/Warehouse、BOM、Routing、Work Center | Organization、Bin、Resource/Equipment、Calendar、Substitute、ECO | PARTIAL |
| Sales & Customer | Sales Order、Delivery、Return、Discount、Invoice/AR 链 | Quotation、Price List、Order Change、Credit | PARTIAL |
| Planning | Forecast、MRP、Demand/Supply、Pegging、Production/Purchase Instruction、Requisition | Safety Stock 深化、Reservation、更多策略/Workbench | PARTIAL |
| Procurement & Outsourcing | Requisition、PO、Receipt、Return、Supplier | Sourcing、Quota、VMI、Outsourcing | PARTIAL |
| Manufacturing & Quality | Production Order、Issue/Return、Receipt、Routing Snapshot、Operation Report、WIP、IQC/OQC、Traceability | Scheduling、Dispatch、Transfer、更多 Inspection/NC | PARTIAL |
| Inventory & Warehouse | Inventory、Transfer、Check、Adjustment、Scrap、Month End、LOT/SERIAL | Barcode/PDA、Bin、Stock Status、Assembly/Disassembly、完整 Reservation | PARTIAL |
| Finance Operations | AR/AP、Collection/Payment、Settlement、Invoice/Bill、Bank、Valuation/WIP，部分 Cash/Bill/Fixed Asset backend | Provisional AR/AP、完整 Treasury、完整 Asset、多币种 | PARTIAL |
| Accounting & Analytics | Voucher、GL、Trial Balance、P&L、BS、Decision Reports、Accounting Config | Smart Accounting Engine、Cash Flow、Report Designer、Management Accounting | PARTIAL |
| Platform | RBAC、5 Approval Families、Audit、Notification、Lifecycle、Registry/RouteLocation | Generic Workflow、Document Relation/Conversion、Numbering、Organization Scope | PARTIAL |

---

## 22. B3101–B3122 手册能力基线与当前覆盖初判

> 本节是从 22 份金蝶操作手册提炼出的长期 Requirements Baseline。
> Claude/Codex 无需直接读取原 Word 手册，也必须逐项遵守本节。
> “当前实现”与 Coverage 是 2026-10-06 架构级初判，正式开发前必须用真实仓库证据复核。

### 22.1 B3101 采购管理
**主要目标 Domain：** Procurement & Outsourcing

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 采购基础资料与参数 | 供应商、采购组织/业务组、采购参数、采购员、价格/折扣等基础设置必须支持采购业务默认值与控制。 | 供应商/采购基础已有；组织与采购参数体系不完整 | `PARTIAL` | 补采购参数、组织维度及更完整价格/折扣策略 |
| 采购申请 | 支持手工请购，也可由销售/计划等需求生成；请购可分配供应商、拆分/合并并下推采购订单。 | Purchase Requisition + MRP/Purchase Instruction 已有 | `PARTIAL` | 补供应商分配、拆分/合并等完整控制 |
| 采购订单 | 支持由请购生成或手工创建；冻结供应商、价格、交期、付款条款；支持赠品、变更与执行控制。 | Purchase Order、审批、来源追溯已存在 | `PARTIAL` | 补赠品、正式变更单、更多交付/预付控制 |
| 收料/收货通知 | 采购订单可下推收料/收货通知，多订单可合并，作为检验或入库前置业务单据。 | 当前以 PO→Purchase Receipt 为主 | `MISSING` | 补独立 Receipt Notice/收料语义 |
| 来料检验 | 需要检验的采购收料必须进入 IQC，再允许有效入库。 | IQC/quality gate 已有 | `COVERED` | 保持现有质量门禁并在采购链中完整映射 |
| 采购入库 | 由收料/订单生成，处理批次、保质期、序列号、库存与后续应付/核算关系。 | Purchase Receipt + LOT/SERIAL + valuation 已有 | `COVERED` | 继续复用现有库存/身份/价值事实 |
| 采购退货 | 支持按采购订单、收料、入库或退货申请退回，保留来源并影响库存与商业结算。 | Purchase Return/return flow 已有 | `PARTIAL` | 补退货申请及更完整来源组合 |
| 寻源与配额 | 支持供应来源管理、供应商分配、配额/比例控制与采购来源决策。 | 无完整 sourcing/quota 子域 | `MISSING` | 新增 Sourcing / Quota capability |
| VMI | 支持 VMI 库存、消耗汇总、所有权转移，并据此形成应付依据。 | 无 VMI 模型 | `MISSING` | 新增 VMI 库存与所有权转换 |
| 采购价格/折扣/调价 | 支持采购价目、折扣、价格调整与订单取价。 | 有采购价格字段/折让基础，缺完整价目体系 | `PARTIAL` | 补 price list / discount policy / adjustment |
| 采购执行报表 | 支持采购执行、全流程跟踪、按时交付等采购分析。 | Decision Reports 有采购统计/未收 | `PARTIAL` | 补完整采购执行与供应绩效分析 |

### 22.2 B3102 销售管理
**主要目标 Domain：** Sales & Customer

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 客户与销售基础资料 | 客户、销售员/组、收货/结算/付款信息、销售参数、可售控制和客户物料关系。 | 客户、收货信息、订单基础已有 | `PARTIAL` | 补销售组/数据隔离、客户物料、更多默认值 |
| 销售报价 | 支持报价单、有效期、价格与折扣，并可转销售订单。 | 无独立 Quotation | `MISSING` | 新增 Quotation |
| 销售订单 | 支持手工/报价来源订单、交期、收货方/结算方/付款方、赠品、价格折扣、履约控制。 | Sales Order + approval + source snapshots 已有 | `PARTIAL` | 补赠品、多方角色、更多价格策略 |
| 预收与发货控制 | 付款/预收条款可对发货或后续执行形成控制。 | Prepayment/financial controls 有基础 | `PARTIAL` | 补订单级预收条件与执行阻断 |
| 销售变更 | 订单批准后支持受控直接变更或变更单/工作流，保留历史。 | 无完整 Sales Order Change Document | `MISSING` | 新增正式订单变更模型 |
| 发货通知/销售出库 | 订单可下推发货通知/销售出库；执行量受订单累计量控制。 | Sales Delivery 已有；独立通知层不足 | `PARTIAL` | 评估是否需要独立 Delivery Notice |
| OQC | 需要出货检验时必须通过 OQC 或有效免检后确认出库。 | OQC 已有 | `COVERED` | 保持现有 gate |
| 销售退货/换货补货 | 支持销售退货；退货补货可重开原订单履约；无来源退货通过退货订单处理。 | Sales Return 已有，但补货义务模型未完整 | `PARTIAL` | 新增 replacement/replenishment obligation |
| 销售价格与折扣 | 价目表、折扣、调价与销售订单取价规则。 | Discount 基础已有，无完整 price list | `PARTIAL` | 补 Pricing Engine / Price List |
| 库存锁定/预留 | 销售需求可锁定或预留库存，控制后续出库可用量。 | 已有部分 allocation/traceability，不是完整 reservation | `PARTIAL` | 补统一 Reservation/Lock |
| 寄售/服务项目 | 支持寄售、服务类销售等扩展销售场景。 | 未形成明确完整能力 | `MISSING` | 按手册场景逐项补齐 |
| 销售执行报表 | 订单执行、未交、出货、退货等分析。 | Sales summary/outstanding 已有 | `COVERED` | 继续保持业务日期口径 |

### 22.3 B3103 信用管理
**主要目标 Domain：** Sales & Customer

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 信用规则 | 定义信用业务环节、控制场景、触发时点和控制强度。 | 无通用 credit rule | `MISSING` | 新增 Credit Rule |
| 信用档案 | 按客户/销售员等维度维护信用档案与额度。 | 无 Credit Profile | `MISSING` | 新增 Credit Profile/Limit |
| 信用占用 | 订单、出货、应收等业务占用与释放信用额度。 | 无统一 occupancy ledger | `MISSING` | 新增 Credit Occupancy |
| 信用检查 | 销售提交/审核等节点触发检查并阻断或提示。 | 无 credit check engine | `MISSING` | 接入 Sales lifecycle |
| 信用特批 | 支持超限特殊审批并保留审批证据。 | 无 special credit approval | `MISSING` | 与 Platform Workflow/Approval 集成 |
| 信用评估 | 指标、等级、权重评分形成信用等级并反馈控制。 | 无信用评分模型 | `MISSING` | 新增 Credit Evaluation |

### 22.4 B3104 库存管理
**主要目标 Domain：** Inventory & Warehouse

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 库存维度与参数 | 库存按组织、仓库/仓位、物料、批次、序列号、库存状态、所有权等维度管理，并有负库存/即时库存等控制。 | 仓库、产品、LOT/SERIAL 已有；组织/仓位/状态/所有权不完整 | `PARTIAL` | 补组织、Bin、Stock Status、Owner dimensions |
| 库存初始化 | 库存组织启用日期、期初库存、结束初始化。 | Opening Batch 有库存期初基础 | `PARTIAL` | 补库存组织初始化语义 |
| 其它入库/出库 | 除采购/销售/生产外支持其它收料/领用类库存交易。 | Adjustment/Scrap 等可覆盖部分场景 | `PARTIAL` | 明确 Other Receipt/Issue 单据语义 |
| 调拨 | 支持直接调拨、分步调拨等仓间移动。 | Inventory Transfer 已有 | `PARTIAL` | 补 step transfer 场景 |
| 组装/拆卸 | 库存层面的组装、拆卸业务。 | 无正式模型 | `MISSING` | 新增 Assembly/Disassembly |
| 批号调整 | 批次属性/批号调整并保留追溯。 | LOT 已有，独立 lot adjustment 不完整 | `PARTIAL` | 补批号调整业务单 |
| 库存状态转换 | 合格/冻结/待检等状态转换。 | HOLD/RELEASE 有局部语义，非完整库存状态模型 | `PARTIAL` | 新增 Stock Status Conversion |
| 形态转换 | 物料形态/包装等转换并保持数量与价值平衡。 | 无完整 conversion document | `MISSING` | 新增 Inventory Form Conversion |
| 即时库存与锁定 | 可查询即时库存并执行锁定/解锁。 | 库存查询已有；Reservation/Lock 不完整 | `PARTIAL` | 统一 Reservation/Lock ledger |
| 库存预警 | 安全库存、最小/最大、再订货、负库存等预警。 | 报表/计划有部分能力 | `PARTIAL` | 补 Inventory Warning |
| 盘点 | 周期/循环盘点，账实差异形成盘盈盘亏并审批。 | Inventory Check 已有 | `COVERED` | 继续保持独立审批与差异执行 |
| 库存月结 | 期间结账后禁止回写历史库存影响交易，支持受控反结账。 | Inventory Period Close 已有 | `COVERED` | 保持当前业务日期与反结账合同 |
| 库存报表与追溯 | 库存台账、库龄、呆滞、负库存、ABC、序列号追溯。 | 库存异动/traceability 已有，库龄/ABC 等不足 | `PARTIAL` | 补 inventory age/obsolete/ABC |

### 22.5 B3105 条码管理
**主要目标 Domain：** Inventory & Warehouse / Manufacturing & Quality

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 条码生成 | 可按采购、物料等业务来源生成内部条码。 | 无完整 barcode identity | `MISSING` | 新增 Barcode Model |
| 外部条码解析 | 支持供应商条码映射和动态解析。 | 无 | `MISSING` | 新增 External Barcode Mapping |
| PDA 单据生成 | 扫码选择来源单/物料并按转换规则生成目标单据。 | 无 PDA execution layer | `MISSING` | 新增 Mobile Scan Execution |
| 收发货校验 | 扫码校验采购收货/销售出货物料、数量、批次等。 | 底层库存/LOT/SERIAL 可复用 | `MISSING` | 新增扫码校验入口 |
| 盘点扫码 | 同步/异步盘点扫码并提交盘点结果。 | 盘点底层已有，无扫码入口 | `MISSING` | 新增 Barcode Stocktake |
| 生产扫码 | 生产领料、报工等扫码作业。 | 生产执行底层已有，无扫码入口 | `MISSING` | 接入 Manufacturing execution |
| 包装/拆包 | 支持装箱、拆箱/包装关系。 | 无完整 packing model | `MISSING` | 新增 Packing/Unpacking |

### 22.6 B3106 存货核算
**主要目标 Domain：** Finance Operations

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 核算范围与核算体系 | 按核算体系/组织/所有者/仓库范围管理存货核算。 | 当前单组织 valuation ledger | `PARTIAL` | 补组织/owner 核算范围 |
| 计价方法 | 移动平均、加权平均、FIFO 等并按物料/类别/属性确定。 | 已有 valuation，方法范围需复核 | `PARTIAL` | 补完整方法与优先级 |
| 采购入库成本 | 应付/发票与采购入库匹配后影响入库成本。 | GRNI/PPV/valuation 有基础 | `PARTIAL` | 补发票差异和费用分配 |
| 采购费用分配 | 运费等采购费用分摊到存货。 | 无完整 expense allocation | `MISSING` | 新增 Purchase Expense Allocation |
| 暂估成本 | 无票入库暂估，后续根据发票/应付调整。 | 有 GRNI/估值基础但非完整暂估模式 | `PARTIAL` | 与 B3109 暂估应付协同 |
| 生产入库成本 | 生产/WIP 成本进入产成品。 | WIP / production cost 基础已有 | `PARTIAL` | 补完整生产成本结转 |
| 委外成本 | 委外成本=材料成本+加工费。 | 无 Outsourcing 子域 | `MISSING` | 随 B3121 实现 |
| 出库核算/成本调整 | 销售/领料等出库按核算方法计价，支持成本调整。 | COGS/valuation movement 已有 | `PARTIAL` | 补更多成本调整机制 |
| 存货关账 | 锁定→核算→结束期间；与库存月结存在顺序关系。 | Inventory/Accounting close 有基础 | `PARTIAL` | 补完整核算关闭顺序与异常检查 |

### 22.7 B3107 固定资产
**主要目标 Domain：** Finance Operations

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 资产基础资料 | 资产类别、状态、位置、折旧政策、核算信息。 | 固定资产 backend 基础存在 | `PARTIAL` | 补类别/位置/状态/政策模型 |
| 资产卡片 | 资产卡片是生命周期主对象，支持来源业务生成。 | 已有 fixed_assets 基础 | `PARTIAL` | 升级为完整 Asset Card |
| 采购转固 | 资产申请→请购→采购→收货/领用→资产卡片。 | 采购链存在，但未与 fixed asset 完整串联 | `PARTIAL` | 新增资产来源链 |
| 资产变更 | 位置、责任人、价值等受控变更。 | 基础 update 有，专门变更单不足 | `PARTIAL` | 新增 Asset Change |
| 拆分/合并 | 资产卡片拆分和合并。 | 无 | `MISSING` | 新增 |
| 借用/盘点 | 资产借用与固定资产盘点。 | 无完整能力 | `MISSING` | 新增 |
| 折旧 | 按政策计提折旧并形成会计影响。 | Depreciation backend 已有基础 | `PARTIAL` | 补完整折旧政策与凭证链 |
| 资产处置 | 报废/出售/减少等受控处置。 | 无完整 lifecycle | `MISSING` | 新增 Disposal |

### 22.8 B3108 应付款-业务应付模式
**主要目标 Domain：** Finance Operations

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 业务应付确认 | 上游采购/其他业务形成应付，业务应付模式不启用暂估反冲。 | AP 已有 | `COVERED` | 保持来源唯一性 |
| 付款条件/到期 | 按付款条件形成到期计划。 | payment terms 基础已有 | `PARTIAL` | 补更完整 due schedule |
| 付款/预付/退款 | 支持付款、预付、退款。 | Payment/Prepayment/Refund 基础已有 | `PARTIAL` | 复核全部场景 |
| 应付核销 | 应付与付款匹配，影响未结与账龄。 | Settlement/open-item 已有 | `COVERED` | 保持 immutable allocation/reversal |
| 应付与发票匹配 | 应付与采购发票/账单匹配并调整。 | Supplier Bill / AP 关系已有 | `PARTIAL` | 补完整 AP-Invoice matching |
| 应付转移/调整 | 应付主体转移和调整。 | 无完整 transfer document | `MISSING` | 新增或明确替代控制 |
| 应付期末 | 期末检查/结账。 | 会计期间有基础 | `PARTIAL` | 补 AP period controls |
| AP 报表与跟踪 | 订单/收货/应付/付款/发票全链跟踪、账龄等。 | AP 对账/基础报表有 | `PARTIAL` | 补完整 aging/trace |

### 22.9 B3109 应付款-暂估应付模式
**主要目标 Domain：** Finance Operations

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 暂估应付 | 未到票收货形成暂估应付。 | GRNI 有基础但非完整 provisional AP | `PARTIAL` | 建立 Provisional AP ledger |
| 财务应付 | 到票后形成正式财务应付。 | Supplier Bill/AP 已有 | `PARTIAL` | 与 provisional AP 分层 |
| 暂估冲回 | 正式应付形成时冲回暂估，避免重复负债。 | 无完整自动 reversal | `MISSING` | 新增 reversal contract |
| 月初/到票/调整冲回模式 | 支持不同暂估冲回策略。 | 无 | `MISSING` | 新增配置 |
| 付款限制 | 只有正式财务应付可进入付款。 | 当前 AP/payment 需按模式复核 | `PARTIAL` | 增加 provisional/financial gate |
| 期末与报表 | 暂估余额、正式应付及差异可追踪。 | 无专门 provisional AP report | `MISSING` | 新增 |

### 22.10 B3110 应收款-业务应收模式
**主要目标 Domain：** Finance Operations

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 业务应收确认 | 销售/其他业务形成应收。 | AR 已有 | `COVERED` | 保持 Sales Invoice→AR |
| 收款条件/到期 | 按收款条件形成到期。 | payment terms 基础 | `PARTIAL` | 补 due schedule |
| 收款/预收/退款 | 支持收款、预收、退款。 | Collection/Pre-receipt/Refund 基础已有 | `PARTIAL` | 复核完整场景 |
| 应收核销 | AR 与收款/贷项/退款匹配。 | Settlement/open-item 已有 | `COVERED` | 保持 |
| 应收与发票匹配 | 应收与销售发票关系。 | Sales Invoice→AR 已有 | `COVERED` | 继续保持独立物流/商业事件 |
| 坏账 | 坏账识别、处理和核销。 | write-off 有基础，完整坏账管理不足 | `PARTIAL` | 补 bad debt policy |
| 应收转移/调整 | 应收主体转移和调整。 | 无完整 transfer document | `MISSING` | 新增 |
| AR 报表与跟踪 | 销售订单/出货/发票/应收/收款、账龄和对账。 | 基础报表/对账已有 | `PARTIAL` | 补完整 aging/customer reconciliation |

### 22.11 B3111 应收款-暂估应收模式
**主要目标 Domain：** Finance Operations

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 暂估应收 | 按业务模式在正式开票前形成暂估应收。 | 无明确完整 provisional AR | `MISSING` | 新增 Provisional AR |
| 财务应收 | 达到正式确认条件后形成财务应收。 | AR 已有 | `PARTIAL` | 与 provisional 层分离 |
| 暂估转正式/冲回 | 正式应收形成时处理暂估余额。 | 无完整 reversal/transfer | `MISSING` | 新增 |
| 收款限制与核销 | 明确哪些应收可收款与核销。 | 现有 settlement 未区分 provisional/financial | `PARTIAL` | 新增 gate |
| 坏账/转移/调整 | 与业务应收模式一致但区分暂估层。 | 部分 write-off | `PARTIAL` | 补完整模式 |
| 期末与报表 | 暂估应收/正式应收差异、账龄可追踪。 | 无专门 provisional AR report | `MISSING` | 新增 |

### 22.12 B3112 发票管理
**主要目标 Domain：** Finance Operations

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 销项发票 | AR/销售业务形成普通/专用等销售发票并走保存/提交/审核。 | Sales Invoice 已有 | `PARTIAL` | 补更多 invoice lifecycle/type |
| 开票/电子税务对接 | 税控/电子发票开具与状态回写。 | 政府/法定电子发票明确未支持 | `OUT_OF_SCOPE` | 保持产品边界，除非未来单独立项 |
| 红字/作废 | 支持红字、作废、冲销。 | Credit/Reversal 有基础 | `PARTIAL` | 补发票级 red/void 语义 |
| 发票折扣/拆分 | 支持发票折扣、纸票拆分等。 | 不完整 | `MISSING` | 按目标范围实现非政府部分 |
| 进项发票采集 | 通过多渠道取得供应商发票。 | Supplier Bill 是内部商业账单，不等同完整进项采集 | `PARTIAL` | 补发票采集/录入层 |
| 供应商/物料映射 | 税号、供应商、物料映射匹配业务应付。 | 无完整映射引擎 | `MISSING` | 新增 Invoice Matching Mapping |
| 进项发票匹配 | 与业务应付/采购入库匹配并生成采购发票/账单。 | Supplier Bill / 3-way match 有基础 | `PARTIAL` | 补发票级匹配 |
| 增值税认证/期末 | 进项认证及税务期间控制。 | 法定认证未支持 | `OUT_OF_SCOPE` | 仅保留内部税务/会计数据，不宣称法定申报 |

### 22.13 B3113 出纳管理
**主要目标 Domain：** Finance Operations

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 现金/银行账户 | 维护现金、银行账户、币种和用途。 | Bank Accounts 已有；现金能力部分存在 | `PARTIAL` | 补完整 Treasury master data |
| 期初现金银行 | 现金/银行期初及未达项。 | Opening Batch 有现金/银行基础 | `PARTIAL` | 补未达项 |
| 现金存取/账户转账 | 现金存取款、账户转账。 | Cash Journals/backend 部分存在 | `PARTIAL` | 正式产品化 |
| 收付款/退款 | 与 AR/AP 子账协同执行收付款。 | Collection/Payment/Refund 已有 | `COVERED` | 保持与 settlement 连接 |
| 付款申请 | 业务付款申请及审批。 | 无完整 Payment Request | `MISSING` | 新增 |
| 票据 | 应收/应付票据管理。 | Bills backend 部分存在 | `PARTIAL` | 补完整 bills lifecycle |
| 现金盘点 | 现金实盘与账面核对。 | 无完整能力 | `MISSING` | 新增 |
| 银行对账 | 导入/录入银行流水并与系统账交易核对。 | Bank reconciliation backend 基础存在 | `PARTIAL` | 产品化并补完整 matching |
| 出纳结账/总账核对 | 现金银行与 GL 对账后结账。 | System Health/GL reconciliation 基础 | `PARTIAL` | 补 Treasury close |

### 22.14 B3114 智能会计平台
**主要目标 Domain：** Accounting & Analytics

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 业务→凭证平台 | 业务单据通过统一规则生成总账凭证。 | System Voucher 已有 | `PARTIAL` | 从硬编码映射升级为规则平台 |
| 凭证模板 | 模板定义凭证日期、类型、摘要、科目、方向、金额、条件。 | voucher_templates/account mapping 基础 | `PARTIAL` | 补条件/金额/维度表达式 |
| 自动/批量生成 | 审核时或计划任务自动生成，也可批量生成。 | 部分自动系统凭证已有 | `PARTIAL` | 补批量/调度与状态追踪 |
| 业务与凭证关系 | 可从业务查看凭证，从凭证追溯业务。 | source_type/source_id 有基础 | `PARTIAL` | 统一 relation/navigation |
| 未生成/异常处理 | 识别未生成凭证与生成失败，允许受控修复。 | System Health 有部分 check | `PARTIAL` | 新增 accounting event/status workbench |
| 业务财务对账 | AR/AP/库存/资产/资金/暂估等业务账与 GL 对账。 | System Health/reconciliation 基础 | `PARTIAL` | 产品化可解释对账 |
| 期末检查 | 关账前检查已审核业务单据和凭证生成完整性。 | period close 有基础 | `PARTIAL` | 补统一 close prerequisite |

### 22.15 B3115 总账
**主要目标 Domain：** Accounting & Analytics

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 凭证录入 | 手工凭证录入、提交、审核。 | Manual Voucher 已有 | `COVERED` | 保持五角色 SOD |
| 凭证过账 | 审核后过账，正式报表只取 POSTED。 | 已有 | `COVERED` | 保持 |
| 凭证纠错 | 补充、更正、红字/冲销。 | Reversal 有部分能力 | `PARTIAL` | 补完整 voucher correction |
| 出纳复核 | 特定凭证可经过出纳复核。 | 无独立 cashier review | `MISSING` | 按目标流程评估 |
| 现金流量 | 凭证现金流量项目分配与现金流量表。 | 无完整 cash-flow model | `MISSING` | 新增 |
| 期末转账/摊销/计提 | 自动转账、摊销、计提等期末处理。 | 不完整 | `MISSING` | 新增 period-end automation |
| 汇兑损益 | 多币种下期末汇兑。 | 当前单本位币 | `MISSING` | 随多币种能力实现 |
| 损益结转/总账结账 | 损益结转、检查并结束 GL 期间，业务系统应先关账。 | Accounting period close 有基础 | `PARTIAL` | 补损益结转和完整 close chain |

### 22.16 B3116 报表
**主要目标 Domain：** Accounting & Analytics

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 财务报表 | 资产负债表、利润表等标准财务报表。 | Balance Sheet/P&L 已有 | `COVERED` | 保持 POSTED-only |
| 试算平衡 | 总账试算平衡。 | 已有 | `COVERED` | 保持 |
| 报表模板 | 模板、报表项目、单位、权限、期间实例。 | 无完整 report designer/platform | `MISSING` | 新增 Report Template |
| 公式 | 取数公式、计算公式、跨表校验。 | 当前报表多为固定代码查询 | `MISSING` | 新增 Formula Engine |
| 报表编制流程 | 实例化期间→重算→保存→提交→审核。 | 无完整 report lifecycle | `MISSING` | 新增 |
| 管理/自定义报表 | 用户可配置管理报表。 | Decision Reports 为固定报表 | `PARTIAL` | 补可配置 reporting platform |

### 22.17 B3117 经营会计
**主要目标 Domain：** Accounting & Analytics

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 经营账簿/组织 | 独立经营账簿、经营组织/阿米巴等。 | 无 | `MISSING` | 新增 Management Accounting model |
| 经营数据来源 | 业务单据或 GL 数据进入经营账。 | 无统一 operating ledger | `MISSING` | 新增 |
| 内部结算 | 内部交易/内部结算价格。 | 无 | `MISSING` | 新增 Internal Settlement |
| 费用归集分配 | 费用归集、分摊规则与计划。 | 无完整能力 | `MISSING` | 新增 Allocation |
| 经营损益 | 按经营单元/阿米巴核算利润。 | 当前分析报表不等同经营会计 | `MISSING` | 新增 Profit Center/Amoeba |
| 经营会计关账 | 经营期间结账及反结账。 | 无 | `MISSING` | 新增 |

### 22.18 B3118 工程数据
**主要目标 Domain：** Master & Engineering

> 本节 Coverage 已由 2026-10-06 Master & Engineering Domain Closure Audit 复核。详细 evidence 见 `document.md §28`。

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 工作日历/班次 | 班次、工作日历、工作时间。 | 无 Shift/Shift Pattern/Work Calendar | `MISSING` | Wave A 新增 |
| 车间公式 | 工期/活动汇报量/能力需求公式。 | 无 | `MISSING` | Wave A 新增（受限 grammar，禁 eval/Function） |
| 资源/设备 | 资源、设备、工具等制造资源。 | Resource/Equipment 无；work_centers 基础 | `PARTIAL` | Wave A 新增 Resource/Equipment 并增强 Work Center |
| 工序/作业 | 工序、基本活动、控制码等基础资料。 | `product_routing_operations` 已有；Operation/Activity/ControlCode master 缺失 | `PARTIAL` | Wave A 新增 Operation/Control Code/Basic Activity；Wave D 接入 |
| 工作中心 | 工作中心及能力信息。 | `work_centers` 存在；缺 update/deactivate/calendar/activity 关联 | `PARTIAL` | Wave A 增强 |
| BOM 生命周期 | 创建/版本/审核/生效/多层结构。 | `boms` / `bom_items` 存在；仅 ACTIVE/DISCONTINUED；无 purpose 维度；无 approval lifecycle | `SEMANTIC_MISMATCH` | Wave B additive：purpose/effective lifecycle + audit；不破坏 ACTIVE/DISCONTINUED |
| BOM Purpose | 自制/通用/委外 BOM 区分。 | 单一 ACTIVE 维度，无 purpose | `SEMANTIC_MISMATCH` | Wave B 新增 purpose 维度 |
| BOM 批量/树形维护 | 树形维护、批量维护和查询。 | flat list；无 multi-level tree；无 batch maintenance | `PARTIAL` | Wave B 新增 tree/where-used/batch preview-apply |
| BOM 工程分析 | 多层 forward/reverse/where-used/consolidated/compare/cost | 仅 single-level list | `MISSING` | Wave B 新增全部工程分析 |
| 多组织分发 | 工程数据跨组织分发。 | 当前单组织 | `MISSING — OUT_OF_SCOPE_PRODUCT_BASELINE` | 随 Multi-Org Capability 实现；本 Domain Closure 不实施 |
| 配置 BOM | 配置类产品/BOM（可选/可替换/可调）。 | 无 | `MISSING` | Wave C 新增 Engineering-side capability |
| 替代料 | 主料/替代料、策略/方式/优先级/比例/生效期。 | 无 | `MISSING` | Wave C 新增 Substitute Scheme + resolver contract |
| 工艺路线 | 工序顺序、工作中心、标准时间、资源、工具。 | `product_routings` canonical + `product_routing_operations` | `COVERED` | Wave D 加深：topology metadata + WorkCenter/Resource/ControlCode/Activity refs |
| Routing Topology | linear/overlap/network/split/merge | 仅 sequence 顺序 | `PARTIAL` | Wave D 加 topology metadata；不实现完整 APS |
| Engineering Change | 受控修改 BOM/路线并保留生效与历史。 | 无 ECO | `MISSING` | Wave E 新增 bounded ECO（IMMEDIATE/EFFECTIVE/USE_UP_OLD） |
| Old Material Cleanup | 用完旧料；按当前库存/预计供应清理。 | 无 | `MISSING — CROSS_DOMAIN_DEPENDENCY` | Wave E bounded cleanup（仅库存当前事实）；预计供应标记 PARTIAL |
| Mold / Mold Combination | 模具/模具组合产品 | 无 | `MISSING — DEFER_SOURCE_DETAIL` | 用户手册 source 证据不足 |
| Engineering Auxiliary Attributes | 复杂辅助属性 | 无 | `MISSING — DEFER_SOURCE_DETAIL` | 用户手册 source 证据不足 |
| BOM 权限独立族 | BOM/ECO/Substitute 独立权限 | 当前复用 `PRODUCTION_ORDERS_VIEW/CREATE` | `SEMANTIC_MISMATCH` | Wave B 新增 `ENGINEERING_BOM_*` 等独立 permission；保留旧 permission 兼容 |
| Routing Canonical Convergence | 单一 active mutable source | `product_routings`（canonical）+ legacy `routing_operations`（仍 active mutate） | `PARTIAL` | Wave D 收敛 legacy；保留 legacy 表与 FK；停止 active mutation path |
| Production Snapshot | BOM/Routing snapshot immutable | `bom_version_snapshot` / `routing_id_snapshot` / `production_order_routing_snapshots` 已存在 | `COVERED` | Wave F 保持 |

详细 ME-01 ~ ME-31 矩阵与 Implementation Decision 见 `§28`。

### 22.19 B3119 生产管理
**主要目标 Domain：** Manufacturing & Quality

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 生产订单 | 由计划等来源形成生产订单，审核/开工并创建生产用料清单。 | Production Order 已有 | `COVERED` | 保持 source/BOM snapshot |
| 生产用料清单 | 子项、用量、损耗、版本快照。 | BOM snapshot/material list 已有 | `PARTIAL` | 补更完整损耗/替代 |
| 领料/退料/补料 | 生产领料、退料、补料。 | Issue/Return 已有；Supplement 需复核 | `PARTIAL` | 补正式补料场景 |
| 生产汇报 | 数量、良品/不良、工序/完工汇报。 | Operation Report 已有 | `PARTIAL` | 补更多 report types |
| 产品检验 | 生产完工后检验再入库，不合格需处置。 | 当前 IQC/OQC 较强，生产检验不完整 | `PARTIAL` | 扩 Quality domain |
| 生产入库 | 检验通过后生产入库并影响库存/WIP/价值。 | Production Receipt/WIP 已有 | `COVERED` | 保持 |
| 工序计划 | 订单+工艺路线形成工序计划。 | Routing snapshot/operation reports 有 | `PARTIAL` | 建立正式 Operation Plan |
| 生产排程 | 工序/资源排程。 | 无完整 scheduling | `MISSING` | 新增 Shop-floor Scheduling |
| 派工/释放 | 操作计划派工、释放到执行。 | 无完整 dispatch | `MISSING` | 新增 |
| 工序汇报/转移 | 工序报工与工序间转移，支持跨组织/委外工序等场景。 | 报工有，transfer 不完整 | `PARTIAL` | 补 Operation Transfer |
| WIP | 在制品数量/价值与工序执行一致。 | WIP ledger 已有 | `COVERED` | 保持 |
| 质量基础 | 检验项目、抽样、质量方案、仪器等。 | QCP/抽样基础有，范围不足 | `PARTIAL` | 扩 Quality Plan/Sampling |
| 多类型检验 | 来料、产品、库存、发货、退货、工序、巡检、委外检验。 | 当前主要 IQC/OQC | `PARTIAL` | 补其余检验类型 |
| 不合格处理 | 不合格结果、处置与复检。 | 部分 FAIL/RETEST 语义 | `PARTIAL` | 新增 Non-conformance disposition |

### 22.20 B3120 计划管理
**主要目标 Domain：** Planning

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 计划方案 | 计划参数、范围、来源、需求/供应、净需求等方案配置。 | MRP run 基础有，方案配置不完整 | `PARTIAL` | 新增 Planning Scheme |
| 需求来源 | 销售订单、预测、安全库存等形成需求。 | Sales Order + Forecast 已有 | `PARTIAL` | 补安全库存等来源 |
| 预测与冲销 | 销售实际需求消耗预测。 | Forecast 已有；consumption 需复核 | `PARTIAL` | 补 Forecast Consumption |
| 供需计算 | 现有库存、采购/生产供应参与净需求。 | MRP supply/demand 已有 | `COVERED` | 保持 |
| BOM 展开 | 按 BOM 展开相关需求。 | 已有 | `COVERED` | 保持 |
| 预留关系 | 强/弱预留及需求供应对应。 | Pegging 有，Reservation 不完整 | `PARTIAL` | 区分 Pegging vs Reservation |
| MRP 运算模式 | 全局/选择/精确等运算方式。 | 基础 MRP run 已有 | `PARTIAL` | 补方案/范围模式 |
| 计划订单 | MRP 结果形成计划订单并支持拆分、合并、关闭、调整。 | 当前 Production/Purchase Instruction 类似计划结果 | `PARTIAL` | 统一 Planned Order lifecycle |
| 计划释放 | 计划订单释放为生产、委外或请购。 | 生产/采购释放已有；委外缺失 | `PARTIAL` | 补 Outsourcing release |
| 计划工作台 | 计划员查看例外、动态平衡、级联变更。 | 有 MRP results/analytics，非完整 workbench | `PARTIAL` | 新增 Planner Workbench |

### 22.21 B3121 委外管理
**主要目标 Domain：** Procurement & Outsourcing

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 委外基础资料 | 供应商需支持委外资格/类别，维护委外仓库/WIP 等。 | 无完整 Outsourcing master data | `MISSING` | 新增 |
| 委外价格/寻源 | 复用采购寻源/价格并支持委外加工费。 | 无完整 sourcing/outsourcing pricing | `MISSING` | 新增 |
| 委外订单 | 计划/手工形成委外订单并生成委外用料清单。 | 无 Outsourcing Order | `MISSING` | 新增 |
| 委外用料 | 明确企业提供材料、用量与损耗。 | 无 | `MISSING` | 新增 |
| 委外发料/退料/补料 | 向供应商发料及退/补料，企业保留材料所有权。 | 无完整委外执行 | `MISSING` | 新增 |
| 委外收料/检验 | 供应商加工完成后收料并按要求检验。 | 采购收货/IQC 可复用底层 | `MISSING` | 新增 Outsourcing Receipt/Inspection |
| 委外入库/退货 | 合格品入库及委外退货。 | 无 | `MISSING` | 新增 |
| 委外加工费应付 | 加工费形成供应商应付。 | AP 底层可复用 | `MISSING` | 新增 source type/settlement |
| 委外成本 | 材料成本+加工费，处理期末倒冲差异/WIP。 | 无完整委外成本 | `MISSING` | 新增，与 Inventory Cost/WIP 集成 |

### 22.22 B3122 工作流设计与配置
**主要目标 Domain：** Platform

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 流程定义 | 图形化/结构化定义节点、连接、条件、参与人和动作。 | 当前仅固定审批族/基础 workflow data | `PARTIAL` | 新增 Generic Workflow Definition |
| 版本与发布 | 流程测试、发布版本、模板启用。 | 无完整 version/publish lifecycle | `MISSING` | 新增 |
| 业务模板绑定 | 按组织/单据/条件绑定流程模板与节点 UI/权限。 | 无通用绑定 | `MISSING` | 新增 |
| 流程实例 | 业务提交启动流程实例。 | 当前五类 approval 是固定适配器 | `PARTIAL` | 抽象 Workflow Instance |
| 节点任务 | 生成待办，参与人执行同意/驳回等动作。 | Approval Center 有固定任务 | `PARTIAL` | 泛化但不得破坏现有审批 |
| 业务动作 | 工作流节点可执行表单操作、通知、下推等业务动作。 | 无 generic business callback | `MISSING` | 新增 Action/Callback |
| 监控 | 查看流程实例、节点、路径和状态。 | 无完整 monitor | `MISSING` | 新增 |
| 暂停/终止/恢复 | 管理员受控暂停、终止、恢复、重新部署。 | 无完整控制 | `MISSING` | 新增 |

---

## 23. Claude/Codex 后续审计必须补的证据

§22 不能替代真实代码审计。每次进入具体手册时，Agent 必须在对应 Capability 下补充或形成审计输出：

1. UI / `applicationRegistry` Route；
2. Launcher / direct route exposure；
3. API method/path；
4. handler；
5. canonical owner；
6. schema/table/index/FK；
7. source snapshot / document relation；
8. state machine；
9. RBAC / SOD；
10. transaction / idempotency；
11. audit；
12. focused/full/heavy/MySQL tests；
13. cross-domain impact；
14. final Coverage；
15. confirmed Gap。

如果代码事实与 §22 的“当前 Modern ERP 基线”不同，以真实仓库事实为准，并在 REQUIREMENT 阶段修订本文件；不得静默改变目标“手册要求基线”。

---

## 24. 文档更新规则

- 新业务 Requirement：只改 `document.md` 对应章节；
- Requirement 批准后设计：改 `solution.md`；
- 仓库结构/运行方式/版本变化：才改 `README.md`；
- AI/Vibe Coding 治理规则变化：才改 `AGENTS.md`；
- 每次开发过程追加 `log/YYYY-MM-DD.md`；
- 本文件发生业务范围/架构变化时，后续 Agent 必须重新完整阅读。

---

## 25. 当前文档状态

截至 2026-10-06：

- 8 Domains + Platform：已确认；
- 22 Manuals：已形成手册能力基线；
- 非核心 Project/CRM extension：已确认退出最终产品范围；
- 当前 Coverage：领域级和手册级已有初判，但尚未逐 Capability 完成最终代码证据审计；
- 下一阶段：Core Scope Cleanup Audit，然后进行 Domain Alignment，再从 B3101 起逐项关闭 Capability Gap。

## 26. Core Scope Cleanup Implementation Acceptance Criteria

本节固化 Core Scope Cleanup 实施阶段的 Requirement Acceptance Criteria。本节必须先于 Implementation 完成；设计见 `solution.md §21`。

### 26.1 Active capability removal

以下 capability 不再是 active product capability：

- `projects`
- `tasks`
- `timesheets`
- `contacts`（CRM extension）
- `followups`
- `activities`

具体删除对象：

- active Route；
- Launcher / navigation / desktop group exposure；
- executable frontend surface（Screen 与 Modal）；
- 6 项 API family（GET / POST / PATCH / DELETE）；
- extension-specific handler；
- extension-specific active permission；
- extension-specific tests；
- stale metadata / source-contract references。

### 26.2 Explicitly protected

以下能力必须保护，禁止误删或破坏：

- **Platform Notification**
  - `notifications` Route；
  - `src/pages/projects-workflow.jsx::Notifications`；
  - 移动端 `messages` Tab；
  - `GET /api/notifications`、`POST /api/notifications/read`；
  - `notifications` 表；
  - `listNotifications` / `markNotificationRead`。
- **Platform Workflow（DISABLED）**
  - `workflows` Route（保持 `enabled: false`）；
  - `src/pages/projects-workflow.jsx::Workflows / WorkflowModal`；
  - `GET /api/workflows`、`POST /api/workflows`；
  - `approval_workflows` 表；
  - `listWorkflows` / `createWorkflow`；
  - `WORKFLOW_VIEW` / `WORKFLOW_MANAGE` permission；
  - 通用 `src/components/MobileWorkflowProgress.jsx` 组件；
  - 本阶段不开放、不重构、不删除 Generic Workflow 仍由 B3122 推进。
- **Core Customer / Supplier Contact**
  - `customers.contact` / `customers.phone` / `customers.address`；
  - `suppliers.contact` / `suppliers.phone` / `suppliers.address` / `suppliers.email`；
  - 当前 `customers` / `suppliers` 表 master contact 字段。
- **Project Accounting（不同于 Project Management）**
  - `PROJECTS_VIEW` / `PROJECTS_MANAGE` permission；
  - `aux_projects` 表；
  - `GET /api/aux-projects`、`POST /api/aux-projects`、`listAuxProjects` / `createAuxProject`；
  - `accounting_entries.project_id` 列。
- **Legacy Tables**
  - `contacts`、`customer_followups`、`sales_activities`、`projects`、`project_tasks`、`project_timesheets` 表继续存在；
  - 历史数据保留；
  - 本阶段禁止 `DROP TABLE` / `DELETE FROM` / `TRUNCATE`；
  - 不迁移、不转换、不清空。
- **Lifecycle Legacy Reference Guards**
  - `server/modules/data-lifecycle.js` 中四条 legacy FK 引用必须保留：
    - `customer.dependencies` 中的 `['contacts','customer_id']`；
    - `customer.dependencies` 中的 `['customer_followups','customer_id']`；
    - `customer.dependencies` 中的 `['projects','customer_id']`；
    - `supplier.dependencies` 中的 `['contacts','supplier_id']`；
  - 理由：表与 FK 仍存在，lifecycle 提前移除会从 `RECORD_REFERENCED` 退化为数据库 FK error。

### 26.3 Expected active route count

当前 Audit 基线：

- enabled routes：53；
- disabled routes：5。

删除 6 项 Extension Route 后，预期 Registry 重新计算结果：

- enabled routes：`53 - 6 = 47`；
- disabled routes：5。

最终数字以 Implementation 时 Registry 真实计算为准，不得使用全局字符串替换 `53 → 47`；任何与预期不符必须先解释差异。

### 26.4 Acceptance Criteria

#### Product

- 6 个 Extension 不再有 active user surface；
- Project / CRM launcher entry 不再出现；
- 不存在空的 `utility-extension` launcher group；
- Project / CRM desktop group 不再暴露；
- 47 enabled + 5 disabled 经 Registry 真实计算确认；
- direct URL / refresh / Back / Forward 对剩余 route 仍正确。

#### Platform

- notifications 桌面端、移动端 `messages` Tab 正常工作；
- workflows 仍保持 `enabled: false`，且其 API/table/permission/symbol 全部保留；
- `MobileWorkflowProgress` 组件继续存在且可被其它业务页面引用。

#### Core

- `customers.contact` / `customers.phone` / `customers.address` 字段保留并被客户列表页展示；
- `suppliers.contact` / `suppliers.phone` / `suppliers.address` / `suppliers.email` 字段保留；
- `aux_projects` 表与 `/api/aux-projects` API 保留；
- `PROJECTS_VIEW` / `PROJECTS_MANAGE` permission 保留；
- `accounting_entries.project_id` 列保留。

#### Backend

- 6 个 Extension API family 不再 active；
- `GET /api/users/lookup` 与 `listProjectManagerCandidates` 不再注册；
- core lookup（`/api/lookup/customers`、`/api/lookup/suppliers` 等）保持；
- `business.js` 仅保留 Platform 部分（`listNotifications` / `markNotificationRead` / `listWorkflows` / `createWorkflow`）；
- 真实 grep 证明无 Project / CRM Extension handler 调用链残存。

#### Data

- 不 DROP table；
- 不删除 legacy rows；
- SQLite/MySQL schema 在本阶段不修改；
- `data-lifecycle.js` 四条 legacy reference 仍存在；
- 数据库 destructive operation 仍受保护。

#### Test

- `scripts/testing/test-suites.js` manifest 不含 stale path；
- 测试集中不存在 `/api/users/lookup` stale continuity assertion；
- route metadata contract 测试真实反映新 registry；
- 14+ 受影响的测试文件已同步更新或删除；
- `pnpm test:fast` PASS；
- `pnpm test` PASS；
- `pnpm build` PASS；
- `git diff --check` PASS；
- `server/test-suite-governance.test.js`（governance self-test）仍 PASS。

### 26.5 Out of Scope（本阶段不实施）

- Unit F Legacy Schema Cleanup（DROP TABLE / 数据迁移 / SQLite/MySQL 双路径 migration）；
- Domain Alignment（`projects-workflow.jsx` 文件改名、logical ownership 重新组织、Frontend 主导航按 8 Domains 重组）；
- B3101–B3122 Capability Closure；
- Generic Workflow 实现；
- 新增任何 CRM / Project / Quotation / Pricing / Credit / Outsourcing 能力；
- 删除既有 release tag。

---

**DOCUMENT REQUIREMENTS BASELINE — CORE SCOPE CLEANUP REQUIREMENT READY FOR DESIGN & IMPLEMENTATION**

## 27. Domain Alignment Requirement（8 Domains + Platform）

### 27.1 Audit baseline and coverage decision

本阶段以 Core Scope Cleanup 冻结后的真实仓库为基线：47 条 enabled route、5 条 disabled route、现有 API/schema/state/permission/transaction/audit 合同均为兼容边界。审计发现当前业务能力已存在，但 Registry 仍以 `master-data / sales / production / purchasing / inventory / analytics` 及若干 cross-domain 变体表达旧产品归属；Launcher 仍是 6 个业务组加 utility 组；`projects-workflow.jsx` 与 `server/modules/business.js` 的文件名已不能表达其仅剩的 Platform 职责。

本阶段 Coverage 为现有能力的 ownership alignment，不改变 `document.md §22` 的 22 本手册 Coverage 结论：

- Registry / Launcher / Desktop taxonomy：`SEMANTIC_MISMATCH`，需对齐 8 Domains + Platform；
- Notifications / Workflow 前后端 owner：`SEMANTIC_MISMATCH`，需拆入明确 Platform owner；
- `extended.js` / `commercial-golive.js` / `financial-inventory.js` / `server/app.js`：`PARTIAL` ownership，只有无需解释业务合同的安全边界才允许本轮移动，其余必须登记技术债；
- 新 ERP Capability：`OUT_OF_SCOPE`。

### 27.2 Product architecture

Canonical product architecture 固定为：

1. `master-engineering` — Master & Engineering；
2. `sales-customer` — Sales & Customer；
3. `planning` — Planning；
4. `procurement-outsourcing` — Procurement & Outsourcing；
5. `manufacturing-quality` — Manufacturing & Quality；
6. `inventory-warehouse` — Inventory & Warehouse；
7. `finance-operations` — Finance Operations；
8. `accounting-analytics` — Accounting & Analytics；
9. `platform` — Platform 横向能力，不作为第九个普通 Business Launcher group。

### 27.3 Ownership principles

- 每个 active capability 与 route 必须只有一个 primary Target Domain；
- Platform 可提供 auth、RBAC、approval、notification、workflow foundation、lifecycle、audit、numbering、error/request contract 等横向服务，但不拥有 Sales Order、Purchase Order、Inventory Movement、Voucher Posting 等业务事实；
- 同一 mutable business fact 不允许两个 Domain 同时成为 active canonical owner；
- Customer 归 Sales & Customer，Supplier 归 Procurement & Outsourcing，Warehouse 归 Inventory & Warehouse；
- BOM/Routing/Work Center 表达“如何生产”，归 Master & Engineering；Forecast/MRP/Instruction 表达“生产/采购什么、何时”，归 Planning；Production Order/Issue/Receipt/Inspection 表达执行，归 Manufacturing & Quality；
- Sales Invoice/AR/Collection/Supplier Bill/AP/Payment/Treasury/Cost 归 Finance Operations；Voucher/GL/Statements/Decision Reports/Auxiliary Accounting 归 Accounting & Analytics；
- owner alignment 不等于 Manual capability coverage closure，不得据此把任何 `MISSING` 改为 `COVERED`。

### 27.4 Compatibility requirement

本阶段必须保持：

- 47 enabled + 5 disabled route inventory 与全部 route key；
- direct URL、refresh、Back/Forward 与既有 target/query contract；
- 全部 HTTP method/path、request/response/status/error contract；
- SQLite/MySQL schema、table/column/FK，不新增 migration；
- permission、RBAC/SOD、state machine、transaction、idempotency 与 audit 语义；
- MobileShell 现有 5 个 global tab；
- workflows `enabled: false`；
- Core Scope Cleanup 删除结果，不恢复 projects/tasks/timesheets/CRM contacts/followups/activities。

### 27.5 Information architecture requirement

- Business Launcher 恰好投影 8 个非空 Domain group；disabled route 不得进入 active launcher；
- Platform route 只通过 global、profile/system、messages、approvals 或 contextual surface 暴露；
- 同一 route 的多入口 target（例如 Sales Return / Purchase Return、Decision Reports）保持；
- Desktop navigation 使用同一 canonical taxonomy 投影，不维护第二套 ownership source；
- canonical domain constants 必须 single-source、exported、testable。

### 27.6 Required ownership cleanup

- 前端将 Notifications 与 Workflows 从误导性的 `projects-workflow.jsx` 拆入 coherent Platform page module；
- 后端将四个通知/工作流 handler 从误导性的 `business.js` 拆入 coherent Platform module，并建立单一 dispatch owner；
- `extended.js`、`commercial-golive.js`、`financial-inventory.js` 与 `server/app.js` 的未拆责任必须有明确 Target Domain 和 `KEEP_TEMPORARY_WITH_DEBT` 原因，禁止标为 UNKNOWN；
- 不为填满 Domain 创建空目录，不进行 `server/domains/*` big-bang migration。

### 27.7 Completion and acceptance

- 所有 active/disabled routes 的 domain 都属于 canonical set；active Registry 不再使用旧 taxonomy 或 cross-domain 变体；
- 每项当前 active capability 都能追溯到 Target Domain、frontend route、API family、backend owner、permission family 与 primary tests；
- Finance/Accounting、Engineering/Planning/Manufacturing、Platform/business fact 边界清楚；
- 新增 pure source-contract architecture tests，并纳入 FAST + FULL；
- `pnpm test:fast`、`pnpm test`、`pnpm build`、`git diff --check` 全部通过；
- 只有用户最终 Acceptance PASS 后，本 Domain Alignment 才能 Freeze 并进入 B3101。

### 27.8 Explicit non-goals

本阶段不新增 B3101–B3122 缺失能力，不实施 Quotation、Credit、Pricing、Sourcing、Outsourcing、Barcode/PDA、ECO、Advanced Scheduling、Generic Workflow、Smart Accounting、Management Accounting、Multi-Organization、Multi-Currency；不修改 schema/migration，不执行 Unit F，不 push/tag/deploy。

---

**DOCUMENT BASELINE — DOMAIN ALIGNMENT REQUIREMENT APPROVED FOR AUTHORIZED DESIGN & IMPLEMENTATION**

---

## 28. Master & Engineering Domain Closure Requirement

> 本节固化 Master & Engineering Domain Closure 的 Requirement 阶段成果。
> Manual Evidence Baseline 来自 Prompt §0–§11；Coverage 来自本章依据真实仓库证据的审计；Design 见 `solution.md §23`。
> 实施 Waves A–F 见 `solution.md §23.11`。

### 28.1 范围与边界

本 Domain Closure 的范围是：

- Master & Engineering 拥有的“如何制造”的工程事实；
- 为 Planning、Manufacturing & Quality、Procurement & Outsourcing、Finance Operations 提供稳定的 authoritative engineering source 与 resolver contract。

**不在本 Domain 范围：**

- 实际生产执行 / 报工 / WIP（Manufacturing & Quality）；
- MRP 详细 substitute 消费（Planning）；
- 委外订单执行 / AP 加工费（Procurement & Outsourcing）；
- 库存 mutation、计价、AR/AP、GL（Inventory / Finance / Accounting）；
- Multi-Organization（OUT_OF_SCOPE — CURRENT PRODUCT BASELINE）；
- 完整 APS 调度 / HMI / 完整 MES（OUT_OF_SCOPE）。

### 28.2 Manual Evidence Baseline（摘要）

完整 31 项 ME-01 ~ ME-31 evidence 在会话上下文；本节列出关键 contract：

| 关键 contract | 含义 |
|---|---|
| Workshop Formula 安全 | **严禁** `eval()` / `Function()`；只允许受限 grammar / parser |
| BOM 用途 | 必须能表达 `GENERAL / SELF_MAKE / OUTSOURCE`（命名由 Design 决定） |
| Routing Operation Control Code | 控制排程/加工/汇报/检验；execution 语义归 M&Q |
| Substitute 策略/方式 | 至少：混用/手工/整批/整批+混用；替代/取代/按比例 |
| ECO Change Type | 至少 `IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD` |
| BOM Reference 不得 | direct self-reference + multi-level cycle |
| Production Snapshot 不得被 master edit 反向污染 | `bom_version_snapshot` / `routing_id_snapshot` / `production_order_routing_snapshots` 不可写回修改 |
| Routing 双源收敛 | `product_routings` canonical；legacy `routing_operations` 保持 table+FK 但停止 active mutation |

### 28.3 Capability Audit Matrix（已审计）

完整 31 项 Coverage/Gap/Implementation Decision 见本节上表 `§22.18`。关键 non-source-backed 类别按合法 deferred reason 标注：

- `OUT_OF_SCOPE — CURRENT PRODUCT BASELINE`：Multi-Org Distribution；
- `CROSS_DOMAIN_DEPENDENCY`：完整 expected incoming supply（PO/计划供应）；BOM substitute 真正消费；委外加工费 AP；
- `DEFER_SOURCE_DETAIL`：Mold / Mold Combination / Complex Auxiliary Attributes；
- `SEMANTIC_MISMATCH`：BOM Purpose / Approval Lifecycle；BOM 权限族。

### 28.4 目标 Capability Closure 要求

| Domain Capability | 落地后 Coverage 目标 | 关键 Acceptance |
|---|---|---|
| Work Calendar / Shift / Pattern | `COVERED` | Shift/Pattern/Calendar + Time-window validation + Work Center 关联 |
| Workshop Formula | `COVERED` | 受限 grammar；不得出现 `eval`/`Function`；div/0 防御；长度与深度限制 |
| Resource / Equipment | `COVERED` | 类型枚举；quantity > 0；与 Work Center / Operation 关联 |
| Operation / Control Code / Activity | `COVERED` | 强制 lifecycle active/inactive；Code 唯一；历史引用不断裂 |
| Work Center | `COVERED`（增强） | UPDATE / Deactivate / Calendar 关联 / Operation 关联 / activity / ref guard |
| BOM Status 治理 | `COVERED` | purpose 维度；effective lifecycle；approval lifecycle；保持 ACTIVE/DISCONTINUED 兼容 |
| BOM Tree / Cycle | `COVERED` | direct self-ref + multi-level cycle 拒绝；tree expand；drill |
| BOM Batch Maintenance | `COVERED` | add / modify / remove / replace 全部 `preview → apply`；atomic transaction；audit |
| BOM Engineering Analysis | `COVERED` | forward / reverse-where-used / consolidated / compare / material-cost |
| Substitute Scheme | `COVERED` | strategy/method/priority/ratio/date/lifecycle + deterministic resolver |
| Configurable BOM | `COVERED` | selectable / replaceable / modifiable 组件属性；preview / validation |
| Routing Canonical | `COVERED` | legacy `routing_operations` 不再 active mutate；保留 table + FK |
| Routing Topology | `COVERED` | 数据模型表达 sequence / parallel / split / merge；不实现完整 APS |
| Routing Enrichment | `COVERED` | 关联 WorkCenter / Operation / ControlCode / Activity / Resource / Equipment；outsource indicator；quality indicator |
| ECO | `COVERED` | IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD；allowed operations 受限；impact preview；atomic apply；audit；不破坏 existing snapshot |
| Use-Up-Old | `PARTIAL — CROSS_DOMAIN_DEPENDENCY` | 当前库存可参考；预计入供应类型依赖未来 Domain |
| Mold / Mold Combination | `MISSING — DEFER_SOURCE_DETAIL` | 用户手册 source 不足 |
| Multi-Org Distribution | `OUT_OF_SCOPE` | 当前 product baseline |

### 28.5 Permission 约束

新增最少、独立 `engineering_perms` 族：

- `ENGINEERING_BOM_VIEW` / `ENGINEERING_BOM_MANAGE` / `ENGINEERING_BOM_APPROVE`；
- `ENGINEERING_ROUTING_VIEW` / `ENGINEERING_ROUTING_MANAGE`（已有 `ROUTING_VIEW`/`ROUTING_MANAGE` 保留兼容，新增 Engineering 独立 alias）；
- `ENGINEERING_REFERENCE_VIEW` / `ENGINEERING_REFERENCE_MANAGE`（覆盖 Work Calendar / Shift / Resource / Equipment / Operation / Control Code / Activity / Work Center）；
- `ENGINEERING_CHANGE_VIEW` / `ENGINEERING_CHANGE_MANAGE` / `ENGINEERING_CHANGE_APPROVE`；
- `ENGINEERING_SUBSTITUTE_VIEW` / `ENGINEERING_SUBSTITUTE_MANAGE`；
- `ENGINEERING_CONFIGURABLE_VIEW` / `ENGINEERING_CONFIGURABLE_MANAGE`。

兼容策略：

- 旧 `PRODUCTION_ORDERS_VIEW` / `PRODUCTION_ORDERS_CREATE` 对 BOM 的隐含权限：**保留** 5 个角色 seed 不变，确保不破坏现有 BOM UI/API 可用性；
- 角色 admin 继承全部新权限；
- sales/warehouse/reviewer 等角色保持现状；
- 新 permission 与现有 RBAC family 兼容。

### 28.6 Compatibility / 不变性约束

- 不修改现有 47 enabled + 5 disabled route key；
- 不修改 BOM `/api/boms*` / Routing `/api/product-routings*` 既有 response/request 关键字段；新增字段以 **additive** 形式补齐；
- 不修改 BOM ACTIVE/DISCONTINUED enum；purpose 作为 **additive 新字段**，默认 `GENERAL`；
- 不修改 Work Center 既有字段（capacity_hours / efficiency / unit_cost_cents / active）；新字段以 additive migration 补齐；
- `production_orders.bom_id` / `production_order_items.bom_item_id` / `production_order_routing_snapshots` 全部 **不可重写**；
- legacy `routing_operations` 表 + `production_labor_records.operation_id` FK **保留**（兼容 source 数据），但停止 active mutation；
- 不 DROP historical table；
- 不重命名既有 release tag；
- SQLite + MySQL 8 schema parity。

### 28.7 Out of Scope（本 Domain Closure 不实施）

- Multi-Org Distribution；
- 完整 MRP substitute 消费；
- 完整 Outsource Order / Issue / Receipt / AP；
- 完整 Production Scheduling（仅 routing topology metadata）；
- 完整 MES / HMI；
- Mold / Mold Combination（DEFER_SOURCE_DETAIL）；
- 完整 Substitution/Category ；
- Generic Workflow / Smart Accounting / Management Accounting；
- 财务 rewrite / destructive cleanup / DROP historical table / database reset。

### 28.8 Acceptance Criteria

#### A. Functional

- Shift / Shift Pattern / Work Calendar / Template CRUD 闭环；Calendar 关联 Work Center；
- Workshop Formula 受限 grammar 通过 parser；不出现 eval/Function；解析失败返回明确错误；
- Resource / Equipment CRUD + 类型枚举校验 + quantity 校验；
- Operation / Control Code / Activity 独立 master；被 Work Center / Routing 引用时 lifecycle 校验；
- Work Center UPDATE / Deactivate / 关联 Calendar / 关联 Resource；
- BOM purpose 维度上线；verified by period & approval lifecycle；
- BOM Tree 展开、where-used、cycle 检测拒绝、multi-level 限制；
- BOM Batch Maintenance add/modify/remove/replace 全部 preview→apply atomic，失败不留半应用；
- BOM Forward / Reverse-where-used / Consolidated / Compare / Material-Cost 分析；
- Substitute Scheme + resolver contract（不写 MRP）；
- Configurable BOM：selectable / replaceable / modifiable 组件标志 + 配置预览；
- Routing canonical 收敛；legacy `routing_operations` 不再 active mutate；
- Routing enrichment：WorkCenter / Operation / ControlCode / Activity / Resource / Equipment 引用；
- Routing topology metadata：main / alternate / split / merge；
- ECO：IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD；allowed operations 受限；impact preview；atomic apply；audit；历史 snapshot 不被污染；
- Use-Up-Old：当前库存 cleanup candidate；预计入供应标记 PARTIAL CROSS_DOMAIN_DEPENDENCY；
- 工程分析（forward/reverse/where-used/consolidated/compare/cleanup-log）UI 与 API 可用。

#### B. Data / Schema

- 新增表与字段全部 additive；既有表/字段无破坏；
- `production_orders.bom_id` / `production_order_routing_snapshots` 不可写回修改；
- 历史 BOM/Routing 引用不可硬删除（active/inactive lifecycle）；
- SQLite / MySQL 8 schema parity；
- migration idempotent。

#### C. Security

- 所有 BOM/Routing/ECO/Substitute mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- 新 permission 5 个角色 seed 不越权；
- audit 写入关键 BOM/路由变更。

#### D. Test

- Wave A focused：reference + formula + calendar + work center reference；
- Wave B focused：BOM lifecycle / purpose / version / cycle / tree / batch / snapshot immutability；
- Wave C focused：substitute invalid self / priority conflict / date validation / ratio validation / deterministic query / configurable BOM；
- Wave D focused：routing canonical / legacy convergence / operation refs / snapshot preservation；
- Wave F focused：production consumer stability + MRP consumer stability；
- 所有 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。

#### E. UI / Mobile

- 新增 Engineering Reference 工作面（统一 master-engineering / engineering 控制台），按 SPEC 选择 320 / 390 / 430 / 680 验证；
- BOM / Routing 现有 desktop table 必须改造为 list → detail → editor/workflow 偏好；
- 复杂对象不再依赖永久横向滚动；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`。

#### F. Documentation / Log

- `document.md` §22.18 与 §28 同步更新；
- `solution.md` §23 同步更新（Design）；
- `log/2026-10-06.md` 追加本 Domain Closure 完整记录；
- `README.md` 仓库地图与新增 page route / server module / 测试同步更新；
- `APPLY_GUIDE.md` 不动。

### 28.9 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization 需求出现；
2. 需要重写完整 MRP；
3. 需要实现完整 Production Scheduling / APS；
4. 需要实现完整 Outsourcing / 加工费 AP；
5. 需要 DROP historical table；
6. destructive data rewrite；
7. source semantics 不足；
8. MySQL migration 无法保证 parity；
9. 既有 Inventory/AR/AP/WIP/GL 原子合同必须破坏。

---

**MASTER & ENGINEERING DOMAIN CLOSURE REQUIREMENT — READY FOR DESIGN & IMPLEMENTATION**
