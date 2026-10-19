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
| Finance Operations | 财务运营 | AR/AP、Provisional AR/AP、Invoice、Collection/Payment、Treasury、Bank、Bills、Collection/Payment Reconciliation、AR/AP/Treasury Operational Business Close |
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
| B3106 | 存货核算 | Accounting & Analytics |
| B3107 | 固定资产 | Accounting & Analytics |
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
| Manufacturing & Quality | Production Order 审批/下达、Issue/Return/Supplement、Receipt、Operation Plan、Forward/Backward Scheduling、Routing Snapshot、Operation Report、Production Inspection、WIP/Cost、IQC/OQC、Traceability、生产扫码 | Dispatch、Transfer、更多 Inspection/NC | PARTIAL |
| Inventory & Warehouse | Inventory、Transfer、Check、Adjustment、Scrap、Month End、LOT/SERIAL | Barcode/PDA、Bin、Stock Status、Assembly/Disassembly、完整 Reservation | PARTIAL |
| Finance Operations | AR/AP、Collection/Payment、Settlement、Invoice/Bill、Bank、Treasury，部分 Cash/Bill backend | Provisional AR/AP、完整 Treasury Operations、AR/AP/Treasury 业务关账、Notes R/P、Payment Request、Bank Statement Import、Cash Count | PARTIAL |
| Accounting & Analytics | Voucher、GL、Trial Balance、P&L、BS、Decision Reports、Accounting Config | Smart Accounting Engine、Cash Flow、Report Designer、Management Accounting | PARTIAL |
| Platform | RBAC、5 Approval Families、Audit、Notification、Lifecycle、Registry/RouteLocation | Generic Workflow、Document Relation/Conversion、Numbering、Organization Scope | PARTIAL |

---

## 22. B3101–B3122 手册能力基线与当前覆盖初判

> 本节是从 22 份金蝶操作手册提炼出的长期 Requirements Baseline。
> Claude/Codex 无需直接读取原 Word 手册，也必须逐项遵守本节。
> “当前实现”与 Coverage 是 2026-10-06 架构级初判，正式开发前必须用真实仓库证据复核。

### 22.1 B3101 采购管理
**主要目标 Domain：** Procurement & Outsourcing

> 本节已由 2026-10-08 PROCUREMENT & OUTSOURCING DOMAIN Audit passed 后的 Requirement 阶段升级为
> Verified Audit Coverage / Target Requirement / Dependency / Acceptance Condition 列。
> 详细 Capability ID 与完整矩阵见 `document.md §31`。

| Capability | 手册要求基线 | Verified Audit Coverage | Target Requirement | Dependency | Acceptance Condition |
|---|---|---|---|---|---|
| 采购基础资料与参数（PRC-01 / PRC-02 / PRC-03） | 供应商、采购组织/业务组、采购参数、采购员、价格/折扣等基础设置必须支持采购业务默认值与控制。 | generic Supplier master 已存在；采购参数、采购组织/业务组、采购员、价格/折扣 baseline 不完整。Coverage = `PARTIAL` | 新增 `Procurement Parameters` owner（PRC-01）；扩展 Supplier 采购/委外 profile（PRC-02）；建立 Buyer / Purchasing Group（PRC-03）。新业务默认 `billing_mode = SEPARATE`；LEGACY_DIRECT 保留兼容 | 无 | 参数生效；Supplier profile 字段上线；Buyer / Purchasing Group CRUD 闭环；新业务默认 SEPARATE 可观测 |
| 采购申请（PRC-11 / PRC-12） | 支持手工请购，也可由销售/计划等需求生成；请购可分配供应商、拆分/合并并下推采购订单。 | Purchase Requisition + MRP/Purchase Instruction 已有；Source-type trace 与 PR Split / Merge / Supplier Allocation 仍为 partial。Coverage = `PARTIAL` | 强化 source-line trace；明确手工 / 计划 / 销售来源事实；增强 PR Split/Merge/Supplier Allocation preview/audit | 无 | source line trace 完整；split / merge preview 与 apply 后剩余保护；supplier-part 分配不重写历史 |
| 寻源 / 配额 / 寻源决策（PRC-04 / PRC-05 / PRC-06） | 支持供应来源管理、供应商分配、配额/比例控制与采购来源决策。 | 无独立 Source List / Quota / Sourcing Decision 子域。Coverage = `MISSING` | 新增 Source List（product/supplier/source_type/effective/enabled）；新增 Quota（PROPORTIONAL 比例供应分配，deterministic、quantity conservation、source-line trace、无超分配、并发安全）；新增 Sourcing Decision（PR Line → Source List Entry → Supplier → Allocated Quantity → Rule/Reason） | 无 | Source List CRUD；Quota deterministic allocation；Sourcing Decision 可追溯；并发防护 |
| 采购价格 / 折扣 / 调价（PRC-07 / PRC-08 / PRC-09 / PRC-10） | 支持采购价目、折扣、价格调整与订单取价。 | PO line 已有价格字段；`purchase_discounts` 为 AP / settlement-stage allowance（Finance）；独立 Procurement Pricing Discount Table 缺失；Pricing UOM 取价规则缺失；Price Adjustment 缺失。Coverage = `PARTIAL`（PRC-08 = PARTIAL → ENHANCE） | 新增 Purchase Price List（supplier/product/source type/effective/pricing UOM/unit price/status/version）；扩展 Pricing UOM 取价规则；新增 Pricing Discount Table（pricing-side，**不得绑定 purchase_discounts**）；新增 effectivity-dated Price Adjustment（**禁止 retroactive 改写历史 PO/Receipt/Bill/AP**） | 无 | Price List 生效；Pricing UOM 生效；Pricing Discount 不进 AP；Price Adjustment 不回写历史；PO 冻结 resolved price evidence |
| 采购订单（PRC-13） | 支持由请购生成或手工创建；冻结供应商、价格、交期、付款条款。 | Purchase Order、审批、来源追溯已存在。Coverage = `COVERED` | 保持现有 PO 审批 lifecycle（DRAFT → SUBMITTED → APPROVED / REJECTED）；Execution lifecycle 归 PRC-19 | 无 | PO 状态机与 source snapshot 不可写回修改 |
| PO Commercial Snapshot（PRC-14） | PO 形成时冻结商业来源事实。 | supplier / contact / phone / address / expected delivery / payment terms / line price / PR source / document&base UOM quantity 已冻结。Coverage = `PARTIAL` → `ENHANCE` | 扩展 snapshot：supply supplier / settlement supplier / payee supplier / buyer / purchase group / price source / discount source / delivery schedule。默认 `settlement supplier = supply supplier`、`payee supplier = settlement supplier` | 无 | snapshot 字段 additive；默认规则可观测；payment execution 归 Finance Owner |
| Gift / Free Item（PRC-15） | 支持合法赠品/样品 line。 | PO submit 强制 `unit_price_cents > 0`（`app.js:2398` & `2640`）。Coverage = `SEMANTIC_MISMATCH` | `→ CONVERGE`：增加 `is_gift_line` 标记或放宽到 `>= 0`；非赠品不得借 gift contract 绕过 commercial validation | 无 | legal Gift 实测可建模；非 gift line 不得 0 价 |
| Delivery Schedule / Quantity Control（PRC-16） | 支持交付计划、量控、上下限容差。 | header `expected_delivery_date` + 硬性超收保护已有。Coverage = `PARTIAL` → `ENHANCE` | 新增 line/multi-delivery schedule + earliest/latest + upper/lower tolerance；lower-tolerance auto-close 算法 source 不足则不引入 | 无 | 多交付计划生效；tolerance 边界生效 |
| Prepayment Requirement（PRC-17） | 预付要求/计划。 | 无完整 Prepayment Requirement。Coverage = `MISSING` | 新增 Procurement-owned Prepayment Requirement / Schedule；定义 Procurement → Finance handoff；不建立第二支付引擎 | Finance（`OWNS actual Payment / Allocation`） | Prepayment Requirement 生效；payment 走 canonical owner |
| PO Change（PRC-18） | 支持正式受控变更。 | 无独立 PO Change order。Coverage = `MISSING` | 新增 `ADD / MODIFY / CANCEL` PO Change；保留 original / change / approval / audit / applied result；禁止历史覆盖；已执行 quantity / source identity 必须受保护 | 无 | PO Change CRUD；applied 后 source identity 不变；approval/audit 完整 |
| PO Execution Status（PRC-19） | PO 履约状态权威供下游消费。 | MRP / Workbench 按 remaining supply；Reservation 按 Approved total - reserved。无 canonical PO execution state。Coverage = `SEMANTIC_MISMATCH` | `→ CONVERGE`：建立 canonical PO execution view/state：`OPEN / PARTIALLY_RECEIVED / FULFILLED/CLOSED / CANCELLED`；MRP / Workbench / Reservation / Receiving **全部消费同一 canonical open remaining quantity** | 无 | 三个 consumer 消费同一 canonical remaining；Reservation 不再用 Approved total |
| Receipt Notice（PRC-20） | PO 可下推收料通知/ASN。 | 当前以 PO→Purchase Receipt 为主，无独立 Receipt Notice。Coverage = `MISSING` | 新增独立 Receipt Notice：PO → Receipt Notice → Receipt / IQC；兼容 multi-PO 合并；**不得改变 inventory / valuation / GRNI / AP** | 无 | Receipt Notice 不影响库存/账实/GRNI/AP |
| 来料检验（PRC-21） | 需要检验的采购收料必须进入 IQC 再有效入库。 | IQC / quality gate 已成熟。Coverage = `COVERED` | 保持现有 quality gate；为 Outsourcing 增加 source-type 扩展（`OUTSOURCING_RECEIPT`，Design 决定 canonical name） | Quality（`OWNS engine`） | IQC 不变；Outsourcing source-type 接入不破坏 |
| 采购入库（PRC-22） | 由收料/订单生成，处理批次、保质期、序列号、库存与后续应付/核算。 | Purchase Receipt + LOT/SERIAL + valuation 已有。Coverage = `COVERED` | 允许增强：Receipt Notice source；delivery schedule/tolerance enforcement；sourcing/commercial trace；MySQL source-line concurrency。**不得重写** inventory / LOT-SERIAL / IRPLUATION / IQC / idempotency / period control | 无 | 增强不重写既有主干 |
| Billing Mode Semantics（PRC-23） | LEGACY_DIRECT / SEPARATE / AUTO_BILL 三链。 | 三链已实现；新业务默认 `LEGACY_DIRECT`。Coverage = `SEMANTIC_MISMATCH` | `→ CONVERGE`：默认 `billing_mode = SEPARATE`；`LEGACY_DIRECT` 仅兼容历史；`AUTO_BILL` 仍为合法显式 mode。账务 contract：LEGACY_DIRECT `Dr Inventory / Cr AP`；SEPARATE Receipt `Dr Inventory / Cr GRNI`；SEPARATE Supplier Bill `Dr GRNI (+Input Tax Receivable if applicable) / Cr AP`；AUTO_BILL 同事务原子两步 | 无 | 新业务默认 SEPARATE 可观测；三链账务 contract 不变；历史 LEGACY_DIRECT 数据不反写 |
| Return Request（PRC-24） | 退货前置业务意图层。 | 无独立 Return Request 文档。Coverage = `MISSING` | 新增 Return Request（source / type / reason / method / replenishment / quantity）；未入库货物不得制造 inventory return | 无 | Return Request 与 Purchase Return execution 分离；未入库货物不被制造为 inventory return |
| Purchase Return（PRC-25） | 支持按采购订单、收料、入库或退货申请退回。 | Purchase Return physical/value execution 已有；financial settlement 不分支按 `billing_mode` 或剩余开票量。Coverage = `SEMANTIC_MISMATCH` | `→ CONVERGE`：LEGACY_DIRECT → AP/commercial credit；SEPARATE unbilled → revoke GRNI（无 AP credit）；SEPARATE billed → AP/commercial credit；SEPARATE partially billed → deterministic split（unbilled → GRNI reversal；billed → AP credit）。库存 reversal 与 commercial/AP adjustment 分离但保持 source trace | Finance | 四分支账务正确；source trace 完整 |
| Procurement Scan（PRC-26） | 收料/退货扫码。 | 无 Procurement Scan 入口。Coverage = `MISSING` | 新增 Procurement Scan bounded：PO or Receipt Notice → Purchase Receipt；scanner wedge + document/item identity + warehouse + qty + LOT/SERIAL。**不**做 camera SDK / barcode designer / label printing / generic PDA platform | 无 | Scan 入口不影响业务合同 |
| 寻源 / 配额 / 价格报表（执行报表） | 采购执行、全流程跟踪、按时交付等采购分析。 | Decision Reports 有采购统计/未收。Coverage = `PARTIAL` | 补完整采购执行与供应绩效分析 | 无 | 报表字段覆盖 |

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
| 生产扫码 | 生产领料、报工等扫码作业。 | 已有 canonical `production-scan` 移动入口，复用权威工单、领料与报工 handler；完整 B3105 PDA 场景仍不在本轮范围 | `COVERED` | 完整 B3105 PDA = `OUT_OF_SCOPE` |
| 包装/拆包 | 支持装箱、拆箱/包装关系。 | 无完整 packing model | `MISSING` | 新增 Packing/Unpacking |

### 22.6 B3106 存货核算
**主要目标 Domain：** Accounting & Analytics

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
**主要目标 Domain：** Accounting & Analytics

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

> 本节 Coverage 已由 2026-10-07 Master & Engineering Domain Closure 实施与验收证据复核。详细 evidence 见 `document.md §28`。

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 工作日历/班次 | 班次、工作日历、工作时间。 | Shift/Pattern/Template/Calendar API + UI 已落地；班次支持 update，其余参考资料以 create/list 为主 | `PARTIAL` | 保留非 Shift 参考资料更新/停用闭环 Gap |
| 车间公式 | 工期/活动汇报量/能力需求公式。 | 受限 grammar parser、安全创建/试算 UI/API，禁止 eval/Function | `COVERED` | 维持 parser 安全合同 |
| 资源/设备 | 资源、设备、工具等制造资源。 | Resource/Equipment create/list/detail + Work Center 关联已落地 | `PARTIAL` | 保留资源/设备 update/deactivate 闭环 Gap |
| 工序/作业 | 工序、基本活动、控制码等基础资料。 | Operation/Activity/ControlCode master 及 Routing enrichment 引用已落地 | `PARTIAL` | 保留 reference update/deactivate 闭环 Gap |
| 工作中心 | 工作中心及能力信息。 | update/deactivate/calendar/capacity 关联、引用防护与独立权限已落地 | `COVERED` | 维持 lifecycle/reference guard |
| BOM 生命周期 | 创建/版本/审核/生效/多层结构。 | purpose/effective/approval lifecycle、树形、审计与移动端工作面已落地 | `COVERED` | ACTIVE/DISCONTINUED 兼容保留 |
| BOM Purpose | 自制/通用/委外 BOM 区分。 | `GENERAL / SELF_MAKE / OUTSOURCE` + effective resolver 已落地 | `COVERED` | 完整委外执行属跨域 Gap |
| BOM 批量/树形维护 | 树形维护、批量维护和查询。 | multi-level tree + add/modify/remove/replace preview→confirm→apply 已落地 | `COVERED` | 保持 atomic apply |
| BOM 工程分析 | 多层 forward/reverse/where-used/consolidated/compare/cost | tree/where-used/consolidated/compare/material-cost UI/API 已落地 | `COVERED` | 材料成本仅引用 canonical product cost |
| 多组织分发 | 工程数据跨组织分发。 | 当前单组织 | `MISSING — OUT_OF_SCOPE_PRODUCT_BASELINE` | 随 Multi-Org Capability 实现；本 Domain Closure 不实施 |
| 配置 BOM | 配置类产品/BOM（可选/可替换/可调）。 | selectable/replaceable/modifiable/config group + 无副作用预览已落地 | `COVERED` | Sales 配置消费不在本 Domain |
| 替代料 | 主料/替代料、策略/方式/优先级/比例/生效期。 | Substitute Scheme + deterministic resolver + UI 已落地 | `COVERED` | 完整 MRP 消费属 Planning 跨域 Gap |
| 工艺路线 | 工序顺序、工作中心、标准时间、资源、工具。 | canonical routing + WorkCenter/Operation/ControlCode/Activity/Resource/Equipment enrichment 已落地 | `COVERED` | 保持 snapshot 不变 |
| Routing Topology | linear/overlap/network/split/merge | LINEAR/NETWORK + PARALLEL/SPLIT/MERGE/ALTERNATE metadata 已落地 | `PARTIAL` | 完整 APS/overlap 计算不在本阶段 |
| Engineering Change | 受控修改 BOM/路线并保留生效与历史。 | bounded ECO lifecycle/preview/approve/apply/audit/UI 已落地 | `COVERED` | 本结论限已批准 bounded scope |
| Old Material Cleanup | 用完旧料；按当前库存/预计供应清理。 | 当前库存 cleanup candidate/log 已落地；预计入供尚未纳入 | `PARTIAL` | `CROSS_DOMAIN_DEPENDENCY`：Planning/Procurement 供应事实 |
| Mold / Mold Combination | 模具/模具组合产品 | 无 | `MISSING — DEFER_SOURCE_DETAIL` | 用户手册 source 证据不足 |
| Engineering Auxiliary Attributes | 复杂辅助属性 | 无 | `MISSING — DEFER_SOURCE_DETAIL` | 用户手册 source 证据不足 |
| BOM 权限独立族 | BOM/ECO/Substitute 独立权限 | 12 个 ENGINEERING_* permission 与 backend fail-closed 已落地；旧权限仅保留兼容 | `COVERED` | 维持 SOD 与后端权威 |
| Routing Canonical Convergence | 单一 active mutable source | `product_routings` 为 canonical；legacy table/FK 保留但 active mutation 已停止 | `COVERED` | 保留 legacy read compatibility |
| Production Snapshot | BOM/Routing snapshot immutable | `bom_version_snapshot` / `routing_id_snapshot` / `production_order_routing_snapshots` 已存在 | `COVERED` | Wave F 保持 |

详细 ME-01 ~ ME-31 矩阵与 Implementation Decision 见 `§28`。

### 22.19 B3119 生产管理
**主要目标 Domain：** Manufacturing & Quality

> 本节 Coverage 已由 2026-10-07 Manufacturing & Quality Domain Closure 实施与验收证据复核。详细 evidence 见 `document.md §29`。

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 生产订单生命周期 | 创建/提交/审核/下达/开工/完工/取消。 | 原 `DRAFT / PENDING / IN_PROGRESS / COMPLETED / CANCELLED`；本次补 Submit / Approve / Release 业务节点 | `COVERED` | Approval 接入 Platform Approval；2026-10 release sync |
| 生产订单来源 | 计划/生产指令或人工建立，来源不可反向修改 MRP demand。 | `source_type IN ('MANUAL','INSTRUCTION')`；Planning Instruction 释放存在 | `COVERED` | 保持 source/BOM/routing snapshot |
| BOM/Routing 冻结 | 产品 / 数量 / BOM / 工艺路线 / 版本 / 操作主数据冻结。 | `production_orders.bom_id / bom_version_snapshot / routing_id_snapshot` + `production_order_routing_snapshots` 已冻结 | `COVERED` | master edit 不得反向污染已下达 |
| Engineering Resolver | 按 SELF_MAKE / GENERAL 解析 BOM。 | `engineering-bom.js::resolveEffectiveBomForCaller` 已存在；本次在生产订单创建/开工路径正式消费 | `COVERED` | 不再依赖散落 `status='ACTIVE'` |
| 生产用料清单 | 子项、用量、损耗、版本快照。 | `production_order_items` 已为 frozen BOM snapshot | `COVERED` | lifecycle: generated / controlled edit / approved / released |
| 领料 | 基于用料清单的真实库存出库；LOT/SERIAL、valuation、WIP、voucher、period、idempotency。 | `production_material_issues` 已完整 | `COVERED` | 不重写 |
| 退料 | 与原出库/补料关联，按业务原因。 | `production_material_returns` 存在，扩展 reason | `COVERED` | 来料不良 / 良料退回 / 制程不良 |
| 补料 | 临时增加非原 BOM material line。 | 本次新建 `production_material_supplements` + 表 + handler | `COVERED` | 走同一库存/voucher/WIP/audit 链路 |
| 合并领料/批拣 | 多订单合并领料，per-order 分配保留。 | 本次新增 `production_batch_issues` + handler | `COVERED` | Atomic failure |
| 生产汇报 | 数量、良品/不良、工序/完工汇报。 | `production_operation_reports` 已有 | `COVERED` | 与工序一对一 truth |
| 副产品 | 副产品维护/调整。 | 本次新增 byproduct header + by-production-receipt；成本分配留 Finance | `PARTIAL — CROSS_DOMAIN_DEPENDENCY` | Byproduct Cost Allocation 归属 Finance |
| 工序计划 | 订单 + 工艺路线形成 Operation Plan lifecycle。 | `production_order_operations` 升级为 lifecycle: GENERATED / SUBMITTED / APPROVED / RELEASED / EXECUTABLE | `COVERED` | 与 Operation Execution row 同一 table |
| 工序计划 Snapshot | Operation Plan 生成时冻结工程操作/控制码/工作中心/资源/工具/标准时间/期望 yield/outsource/quality_policy。 | `production_order_operations` 已有 setup_seconds / run_seconds_per_unit / expected_yield_bps / work_center_id；本次 additive enrichment | `COVERED` | Engineering master 不得反向修改 |
| Forward / Backward Scheduling | 按 Planned Start / Planned Finish + Calendar + Capacity。 | 本次实现 `scheduleProductionOrder`（FORWARD/BACKWARD）；消费 `engineering_work_calendars`/`engineering_shifts`/`work_centers.daily_capacity_minutes` | `COVERED` | 不实现完整 APS |
| 排程容量预警 | Work Center overload warning。 | `manufacturingCapacityReport` 已存在；本次补 scheduled vs actual | `COVERED` | 不实现优化器 |
| Operation Control Code 消费 | 是否参与排程/汇报方式/检验方式。 | `product_routing_operations.control_code_id` 已存在；本次 snapshot 化 | `COVERED` | master edit 不得修改已下达 |
| Operation Report | 数量/工时/质量状态。 | `production_operation_reports` + reversal 完整 | `COVERED` | 保持 control code |
| Operation Transfer / Internal Handoff | 同组织内部工序转移自动。 | `availableInput()` 已支持前工序良品 → 后工序可投入量 | `COVERED` | 跨组织 OUT_OF_SCOPE |
| Network Topology | LINEAR / NETWORK / PARALLEL / SPLIT / MERGE / ALTERNATE。 | `product_routing_operations.topology` 已落 metadata；本次 `availableInput()` 对 NETWORK 行 PRE / POST fail closed | `COVERED` | 完整 NETWORK 模拟 = PARTIAL |
| Outsourced Operation 边界 | 识别外部工序，内部不自动完成。 | `production_order_operations.is_outsource` snapshot；本次 API/UI 暴露 `OUTSOURCING_HANDOFF_REQUIRED` | `COVERED` | 完整 Outsourcing Order = OUT_OF_SCOPE / 后续 Domain |
| Inspection Item Master | 检验项目 / 类别 / 单位 / 方法 / 标准。 | 本次新建 `inspection_items` + handler | `COVERED` | 替代品/多语言 = OUT_OF_SCOPE |
| Detection Value Master | 检验值映射到 Inspection Item。 | 本次新建 `inspection_detection_values` + handler | `COVERED` | — |
| Inspection Instrument Master | 检验仪器。 | 本次新建 `inspection_instruments` + handler | `COVERED` | 不做 IoT |
| Inspection Plan | Quality Plan 引用 Inspection Items + criteria/spec/unit/instrument。 | 本次新建 `inspection_plans` + `inspection_plan_items`；与 `quality_control_points` 形成 when/what 关系 | `COVERED` | 不与 QCP 形成两套 policy truth |
| Sampling 复用 | FULL / FIXED_QUANTITY / PERCENTAGE。 | 复用 `traceability-quality.js::calculateSampleQuantity` + `freezeQualityPolicy` | `COVERED` | 不新建抽样引擎 |
| Operation Inspection | 对需检验工序，Report → Inspection → PASS/FAIL → Released quantity。 | 本次新建 `production_inspections` + Operation Inspection handler + `released_quantity` | `COVERED` | 非检验工序保持 fast path |
| Product Inspection | 最终生产完成后根据 Plan / Control policy 生成 Product Inspection。 | 本次新建 Product Inspection kind；`confirmProductionReceipt` 按 policy gate | `COVERED` | WAIVED 仍允许放行 |
| Production Receipt Quality Gate | Receipt Confirm 必须感知 quality policy；REQUIRED 时等待 PASS / WAIVED。 | 本次 `assertProductionReceiptQualityGate` + `production_receipts.quality_state` 字段 | `COVERED` | 不重写 inventory/LOT/value 合同 |
| Nonconforming Receipt | 部分不合格品入库。 | 通过 LOT/SERIAL HOLD 隔离；本次 `nonconforming_receipt` handler + quality state FAIL 路径 | `PARTIAL — INVENTORY_STATUS_DEPENDENCY` | untracked status = OUT_OF_SCOPE |
| Production Material Issue Scan | PDA：来源单 + 物料 token → 领料。 | 本次 Production Scan 工作面提供 scanner wedge input 入口 | `COVERED` | 完整 B3105 PDA = OUT_OF_SCOPE / Inventory Domain |
| Operation Report Scan | PDA：Operation Plan + operation + qty → 报工。 | 同上 | `COVERED` | 完整 B3105 PDA = OUT_OF_SCOPE |
| Operation Transfer Scan | PDA：source/destination operation + qty → transfer。 | 同上；内部 transfer 仍走 automatic handoff | `COVERED` | 完整 B3105 PDA = OUT_OF_SCOPE |
| Production Execution Summary | 计划 / 开工 / 完成 / 良品 / 报废 / 入库进度。 | 本次 `manufacturingExecutionSummaryReport` | `COVERED` | — |
| Material Issue Summary | 需求 / 领料 / 补料 / 退料 / 净耗 / 理论支持数量。 | 本次 `materialIssueSummaryReport` | `COVERED` | — |
| WIP / Yield / Capacity Analytics | 已存在；本次整合 | 复用 `manufacturingWipReport` / `manufacturingYieldReport` / `manufacturingCapacityReport` / `manufacturingCostReport` | `COVERED` | — |
| 复杂型 Mold / Mold Combination | 模具/模具组合 | 无 | `MISSING — DEFER_SOURCE_DETAIL` | 用户手册 source 不足 |
| Auxiliary Attributes 复杂 | 复杂辅助属性 | 无 | `MISSING — DEFER_SOURCE_DETAIL` | 用户手册 source 不足 |
| 库存 Status Conversion | 合格 / 不合格 / 冻结 / 待检 | LOT/SERIAL HOLD 已支持；untracked status 未完整 | `PARTIAL — INVENTORY_STATUS_DEPENDENCY` | Inventory & Warehouse Domain |
| Cross-org Operation Transfer | 跨组织工序转移 | OUT_OF_SCOPE — 单组织基线 | `OUT_OF_SCOPE` | 随 Multi-Org 实现 |
| 完整 Outsourcing Order / Issue / Receipt / AP | 委外工序完整执行 | OUT_OF_SCOPE — Procurement & Outsourcing Domain | `OUT_OF_SCOPE` | 后续 Domain |

详细 MQ-01 ~ MQ-43 矩阵与 Implementation Decision 见 `§29`。

### 22.20 B3120 计划管理
**主要目标 Domain：** Planning

| Capability | 手册要求基线 | 当前 Modern ERP 基线 | Coverage | 主要 Gap / 后续方向 |
|---|---|---|---|---|
| 计划参数与物料策略 | 系统参数、预留开关、安全库存、再订货点、最高库存、经济订货批量、制造策略。 | 产品存在部分 legacy 字段；无 Planning authoritative policy，MAKE/BUY 仍由 BOM presence 推断 | `SEMANTIC_MISMATCH` | 建立唯一 Planning 参数与物料策略写入面；legacy 字段只作迁移输入/兼容投影 |
| 计划方案 | 可复用地配置范围、来源、需求/供应、净需求、合并、释放、仓库等参数。 | MRP run 只有一次性 horizon / demand mode | `MISSING` | 新增 Planning Scheme；单组织明确 `OUT_OF_SCOPE` |
| 需求来源 | 销售订单、预测、安全库存及下阶 BOM 形成分时需求。 | Sales Order / Forecast / BOM component 已有，但安全库存与分时事件缺失 | `PARTIAL` | 引入 source-backed demand event 与 safety-stock floor |
| 预测与冲销 | 已批准销售需求消耗已下达预测并可追溯。 | 仅用 `MAX(total sales,total forecast)` 隐式防双算 | `SEMANTIC_MISMATCH` | 新增确定性 consumption allocation 与结果查询 |
| 供需计算 | 库存、采购、生产和计划供应参与分时净需求。 | 聚合净算已有；生产状态仍按旧 `PENDING/IN_PROGRESS`，没有 planned supply/time bucket | `SEMANTIC_MISMATCH` | 消费 V18 lifecycle；形成分时事件并防 PO/收货重复 |
| BOM 展开 | 按有效、已批准、用途正确的 BOM 多层展开。 | 多层、损耗、net-before-explosion、cycle 已有；仍直接查 ACTIVE BOM | `SEMANTIC_MISMATCH` | 保留成熟数学，改用 Engineering resolver |
| 替代料计划 | MRP 消费 Engineering substitute contract，并提供建议查询。 | Engineering resolver 已冻结，Planning 未消费 | `MISSING` | MANUAL 仅建议；其余采用保守、可解释 bounded 规则 |
| Pegging | 解释 MRP 数量为何产生。 | `mrp_run_pegging` 已有 | `COVERED` | 保持为 calculation explanation，不与 Reservation 混用 |
| 预留关系 | 强/弱/人工预留、释放策略和需求↔供应双向追溯。 | 无正式 Reservation；Pegging 不能替代 allocation | `MISSING` | 新增 reservation ledger、并发/超分配防护和执行 guard |
| MRP 运算模式与日志 | Global / Selected / Precise Selected；保存选择、配置、状态、警告和失败诊断。 | 只有 demand source mode；completed snapshot 基础正确 | `PARTIAL` | 新增 calculation scope、source selection 和 immutable log |
| 计划订单 | MRP/人工形成可修改业务实体，支持确认、拆分、合并、关闭、目标改变与批量维护。 | `mrp_run_results` immutable；Instruction 不能替代 Planned Order | `MISSING` | 新增 Planned Order 与 source-link；禁止反写 MRP result |
| 计划释放 | MAKE/BUY/OUTSOURCE 受控释放并防超转换。 | 生产/采购指令已有；生产转换 raw INSERT 绕过 Manufacturing；委外执行缺失 | `SEMANTIC_MISMATCH` | MAKE 调 canonical Manufacturing command；BUY 保留采购桥；OUTSOURCE 仅 stable handoff |
| 计划员工作台与报表 | 当前动态平衡、异常、供需/订单/预测消耗/预留/替代/MRP 日志查询。 | 只有历史 run viewer 与局部 analytics | `MISSING` | 建立共享动态 read model 与移动端工作面 |
| 级联调整 | 销售订单/预测变更先预览影响，再只修改仍属 Planning 可变状态的对象。 | 无 | `MISSING` | 新增 bounded preview/apply；执行中/已收货/库存/会计事实 fail closed |

### 22.21 B3121 委外管理
**主要目标 Domain：** Procurement & Outsourcing

> 本节已由 2026-10-08 PROCUREMENT & OUTSOURCING DOMAIN Audit passed 后的 Requirement 阶段升级为
> Verified Audit Coverage / Target Requirement / Dependency / Acceptance Condition 列。
> 详细 Capability ID 与完整矩阵见 `document.md §31`。
> 本节范围 = 委外管理；VMI 业务事实另见 §22.1 / §31。

| Capability | 手册要求基线 | Verified Audit Coverage | Target Requirement | Dependency | Acceptance Condition |
|---|---|---|---|---|---|
| 委外基础资料（OUT-01 / OUT-04） | 供应商需支持委外资格/类别，维护委外仓库/WIP 等。 | Supplier master 已有；`is_outsourcing_supplier` flag 缺失；SUPPLIER-WIP WAREHOUSE 不存在。Coverage = `PARTIAL` | 扩展 PRC-02 Supplier Procurement Profile：outsourcing enabled / outsourcing qualification / supplier-WIP warehouse binding。Supplier WIP Warehouse = canonical Warehouse **location binding**，不是 supplier ownership | Inventory & Warehouse（warehouse foundation） | Supplier profile 字段上线；Supplier WIP Warehouse 绑定不创建第二 Warehouse master |
| 委外寻源 / 委外加工费（OUT-02 / OUT-03） | 复用采购寻源/价格并支持委外加工费。 | 复用 procurement sourcing/pricing 缺失；Processing Price 不存在。Coverage = `MISSING` | 复用 Procurement sourcing/pricing infrastructure；`source_type = OUTSOURCE`；Processing Price = 加工费，不是 finished product full material cost | Procurement Sourcing & Pricing（PRC-04..07） | Outsourcing Source List 可用；Processing Price 仅与加工费绑 |
| Planning Handoff（OUT-05） | 计划 OUTSOURCE / 委外订单来源。 | Frozen Planning `planning_outsource_handoffs(PENDING)` 已存在。Coverage = `PARTIAL` | Procurement/Outsourcing canonical owner 必须 exactly-once consume handoff：idempotent / source trace / concurrency-safe / status transition。Planning truth 不修改 | Planning（`OWNS upstream record`） | handoff consumption 一致；不双发 |
| 委外订单（OUT-06） | 计划/手工形成委外订单并生成委外用料清单。 | 无 Outsourcing Order。Coverage = `MISSING` | 新增 Outsourcing Order；来源至少 `PLANNING` / `MANUAL`；operation outsourcing 后续 source 足够再加 source semantic；不得与 ordinary product outsourcing 混为匿名来源 | 无 | Outsourcing Order CRUD + lifecycle + 来源可验证 |
| 委外 lifecycle（OUT-07） | 委外订单生命周期（PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED）。 | `MISSING`。Coverage = `MISSING` → `NEW` | 使用 source-backed Manual semantics：`PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED`；创建态、取消态、是否需要审批留 Design bounded；不得无证据把 `SUBMITTED / APPROVED` 宣列为必需阶段 | 无 | lifecycle 遵循 source-backed 4 状态 |
| OUTSOURCE BOM（OUT-08） | 委外 BOM / 委外用料按 effective BOM 拉取。 | Frozen Engineering OUTSOURCE BOM resolver COVERED；Outsourcing Order 未消费。Coverage = `PARTIAL` | Outsourcing Order 必须消费 approved / effective / `purpose=OUTSOURCE` / business-date appropriate 的 BOM。禁止 `ACTIVE LIMIT 1` selector | Engineering（`OWNS BOM`） | 消费 canonical Engineering resolver；不建立第二选择器 |
| 委外用料清单（OUT-09） | 明确企业提供材料、用量与损耗。 | 无 Outsourcing Material List。Coverage = `MISSING` | Order 保存/确认时形成 execution snapshot：BOM/version / component / per-unit quantity / scrap / required quantity。Release 后 master BOM 改变不回写历史。额外材料走 Supplement | 无 | snapshot 生效；不随 master BOM 漂移 |
| 委外 PO（OUT-10） | 委外加工费商业承诺。 | 无 Outsourcing PO。Coverage = `MISSING` | OUT-10 = **processing-fee commercial commitment**，不是"采购企业提供给供应商的材料"。Requirement 推荐可表达为 `Purchase Order` + `business_type = OUTSOURCE` + `source = Outsourcing Order` + commercial price = processing fee；最终是否复用 canonical PO 由 Design 决定 | Procurement PO（`OWNS execution`） | 加工费走到 canonical Supplier Bill/AP；企业材料不入 PO line |
| 委外发料/退料/补料（OUT-11 / OUT-12 / OUT-13） | 向供应商发料 / 退料 / 补料。 | Generic Inventory Transfer 存在但**不**绑定委外。Coverage = `MISSING` | 新增 `Issue / Supplement / Return`。Material movement：`Internal Warehouse ↔ Supplier WIP Warehouse` = location movement，**不是** ownership transfer。复用 canonical Inventory Transfer / tracking primitives | Inventory & Warehouse（`OWNS transfer primitives`） | 四个动作生效；LOT/SERIAL provenance 完整；不创建第二 inventory ledger |
| 材料所有权（OUT-14） | 企业保留材料所有权。 | 当前 inventory 默认 enterprise-owned。Coverage = `PARTIAL` | Outsourcing 材料 enterprise-owned throughout：issue / supplement / supplier-WIP / return / backflush。新增 order-specific material position + supplier-WIP location + issued / returned / remaining / backflushed。**不是** new owner ledger | 无 | 企业所有权不漂移；order position 可追溯 |
| LOT / SERIAL（OUT-15） | 委外材料 LOT/SERIAL provenance。 | LOT/SERIAL backbone existing；outsourcing consumer MISSING。Coverage = `PARTIAL` | 复用 existing canonical tracking；要求 issue → supplier WIP → return / backflush 持续可追 | Inventory & Warehouse（`OWNS LOT/SERIAL`） | provenance 完整；不建立第二 serial/lot engine |
| Backflush（OUT-16） | 收料后按 BOM 倒冲领料。 | Manufacturing 有 backflush；outsourcing 无。Coverage = `MISSING` | 基于 Outsourcing Order + Material List + actual issued/supplemented/returned + receipt quantity + tracked identities 做 order-specific consumption；不得跨订单随意消费 Supplier WIP | 无 | backflush 不跨界；order position 守恒 |
| Completion Receipt Notice（OUT-17） | 委外完成预到货通知。 | 无独立 Completion Receipt Notice。Coverage = `MISSING` | 新增 Completion Receipt Notice；**不**改变库存/GRNI/AP | 无 | Notice 不影响账实/GRNI/AP |
| Inspection（OUT-18） | 委外收料检验。 | IQC COVERED；source-type 扩展缺失。Coverage = `PARTIAL` | 扩展 IQC source-type：`OUTSOURCING_RECEIPT`（Design 决定 canonical name） | Quality（`OWNS engine`） | source-type 接入不破坏 IQC |
| Outsourcing Inbound（OUT-19） | 委外入库。 | 无委外收料。Coverage = `MISSING` | Flow：Outsourcing Order / Processing PO → Completion Receipt Notice → Quality（if required）→ Outsourcing Receipt → Enterprise Finished Inventory Recognition。Supplier WIP 是 source/location context；**不是** supplier-owned finished stock → enterprise ownership transfer。Supplier site 是 source/location context；只有 confirmed valid Outsourcing Receipt 才形成 enterprise warehouse finished inventory fact | 无 | 入库认可 enterprise owned；location 转移 + backflush + processing fee + cost evidence 完整 |
| Processing Fee AP（OUT-20） | 加工费形成供应商应付。 | Canonical Supplier Bill / AP engine COVERED；OUTSOURCING_RECEIPT source-type 缺失。Coverage = `PARTIAL` | **必须扩展** canonical Supplier Bill source contract；不得建立 `Outsourcing Payable` 第二引擎。至少能 trace：Outsourcing Receipt / Outsourcing Receipt Item / Outsourcing PO line / processing quantity / processing fee | Finance（`OWNS Supplier Bill / AP`） | Processing Fee 进 canonical AP；不创建第二引擎 |
| 委外成本（OUT-21） | 材料成本 + 加工费，处理期末倒冲差异 / WIP。 | Coverage = `MISSING` | 正确基础 = `consumed/backflushed material carrying value + processing fee`，**不是** `issued material + processing fee`。必须排除：issued but unused / returned / supplier-WIP remaining。Procurement/Outsourcing owner 提供 cost evidence；final costing adjustment / variance allocation 归 Finance | Finance（`OWNS final costing adjustment`） | cost 排除未耗 / 退回 / WIP 剩余；仅 consumed + processing fee |
| 委外退货（OUT-22） | 委外入库后退货。 | 无委外退货。Coverage = `MISSING` | 来源：confirmed Outsourcing Receipt。要求 quantity cap / LOT/SERIAL / finished inventory reversal / processing-fee billability-credit handoff / material & cost trace。不得机械复用普通 Purchase Return 的 price semantics | 无 | 退货四元组完整；不复制普通 Purchase Return price |
| Period-End / WIP / Opening / Reports（OUT-23） | 期末倒冲差异 / WIP / 开启。 | Generic Period Control 仅 integration backbone。Coverage = `MISSING` → `NEW / INTEGRATE` | 必须覆盖：backflush difference allocation（preview/apply/quantity conservation/audit）、supplier material balance、WIP transfer、opening outsourcing order、opening outsourcing WIP、execution summary、material issue summary/detail。Opening 期间不强制用 generic Period Close 判 PARTIAL | Finance（`OWNS period framework`） | 8 字段覆盖；opening 数据标记 OPENING；不虚构历史 accounting |
| 委外工序边界（Outsourced Operation Boundary） | 工序级委外识别 / 内部不自动完成。 | Frozen `is_outsource` snapshot + `OUTSOURCING_HANDOFF_REQUIRED` fail closed 存在；无真实 operation handoff consumer。Coverage = `PARTIAL INTEGRATION` | 普通成品委外由 OUT-01~23 主线实现；工序级完整 lifecycle 不在本 Requirement 范围 | Manufacturing & Quality（`OWNS operation`） | outbound boundary fail closed；不宣称工序委外已完成 |

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

新增最少、独立 `engineering_perms` 族（共 12 个，与实现一致）：

- `ENGINEERING_REFERENCE_VIEW` / `ENGINEERING_REFERENCE_MANAGE`（覆盖 Work Calendar / Shift / Shift Pattern / Calendar Template / Basic Activity / Workshop Formula / Resource / Equipment / Operation / Control Code）；
- `ENGINEERING_BOM_VIEW` / `ENGINEERING_BOM_MANAGE` / `ENGINEERING_BOM_APPROVE`；
- `ENGINEERING_SUBSTITUTE_VIEW` / `ENGINEERING_SUBSTITUTE_MANAGE`；
- `ENGINEERING_CONFIGURABLE_VIEW` / `ENGINEERING_CONFIGURABLE_MANAGE`；
- `ENGINEERING_CHANGE_VIEW` / `ENGINEERING_CHANGE_MANAGE` / `ENGINEERING_CHANGE_APPROVE`。

（注：原设计提到 `ENGINEERING_ROUTING_*` 独立 alias；实施时保留既有 `ROUTING_VIEW` / `ROUTING_MANAGE` 而不重复，遵循现有 RBAC 与 routing BOM Contract。）

兼容策略：

- 旧 `PRODUCTION_ORDERS_VIEW` / `PRODUCTION_ORDERS_CREATE` 对 BOM 的隐含权限：**保留** 5 个角色 seed 不变，确保不破坏现有 BOM UI/API 可用性；
- 角色 admin 继承全部新权限；
- sales/warehouse/reviewer 等角色保持现状；
- 新 permission 与现有 RBAC family 兼容。

### 28.6 Compatibility / 不变性约束

- 不删除或重命名现有 47 enabled + 5 disabled route key；本阶段依批准 Requirement 新增 3 条 Engineering canonical route，当前为 50 enabled + 5 disabled；
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

### 28.10 Final Coverage / Evidence Reconciliation（2026-10-07）

- 实施证据：Waves A–F backend/module/migration/focused integration 测试；Frontend 四个工作面及 Registry/Launcher 路由。
- 响应式证据：真实 Edge 在 320 / 390 / 430 / 680 CSS px 访问 Engineering Reference / BOM / Substitute & Configurable / ECO，无页面水平溢出与 browser error。
- Schema 计数证据（由当前 canonical SQLite snapshot 与 5 个 Engineering migration 计算）：
  - 15 张新表：`engineering_shifts`、`engineering_shift_patterns`、`engineering_calendar_templates`、`engineering_work_calendars`、`engineering_basic_activities`、`engineering_workshop_formulas`、`engineering_resources`、`engineering_equipment`、`engineering_operations`、`engineering_control_codes`、`engineering_substitute_schemes`、`engineering_substitutes`、`product_routing_operation_links`、`engineering_change_orders`、`engineering_change_items`；
  - 5 张既有表上的 28 个 additive 列：`boms` 8 个、`bom_items` 7 个、`work_centers` 5 个、`product_routings` 1 个、`product_routing_operations` 7 个；
  - 7 个显式普通索引：`idx_bom_items_product`、`idx_boms_product_purpose_status`、`idx_engineering_change_items_change`、`idx_engineering_change_orders_status`、`idx_engineering_substitutes_primary`、`idx_engineering_substitutes_scheme`、`idx_product_routing_operation_links_routing`。
- MySQL parity 证据：真实 disposable MySQL 8 上 fresh bootstrap、V1.3/V1.4-shaped existing database additive upgrade、连续第二次初始化、Engineering 表/列恢复、原始行与 permission mapping 保留均通过；`pnpm test:mysql` 与 `pnpm test:mysql:concurrency` 最终 PASS。
- BOM Permission Family：Original Gap `SEMANTIC_MISMATCH`；独立 `ENGINEERING_BOM_VIEW` / `ENGINEERING_BOM_MANAGE` / `ENGINEERING_BOM_APPROVE` 权限族及测试已落地，Final Coverage `COVERED`。
- 最终保留 Gap：非 Shift 参考资料 update/deactivate；完整 APS；预计入供参与 Use-Up-Old；完整 MRP substitute 消费；Multi-Org/Mold/Auxiliary 的合法 deferred 范围。

---

**MASTER & ENGINEERING DOMAIN CLOSURE REQUIREMENT — READY FOR DESIGN & IMPLEMENTATION**

---

## 29. Manufacturing & Quality Domain Closure Requirement

> 本节固化 Manufacturing & Quality Domain Closure 的 Requirement 阶段成果。
> Manual Evidence Baseline 来自 Prompt §0–§43；本节 Coverage 以真实仓库审计 + 本 Domain 实施 + Verification 结果为准。
> Design 见 `solution.md §24`；实施 Waves A–H 见 `solution.md §24.13`。

### 29.1 范围与边界

本 Domain Closure 的范围是：

- Production Order 全生命周期（Draft → Submit → Approve → Release → Start → Complete / Cancel）；
- Production Material List lifecycle 与受控编辑；
- Production Material Issue / Supplement / Return（含合并领料、批拣）；
- Operation Plan lifecycle + Engineering Snapshot；
- Forward / Backward Scheduling（Calendar / Shift / Work Center Capacity）；
- Shop-floor Execution（Operation Report / Reversal / Internal Handoff / Topology / Outsourced 边界）；
- Manufacturing Quality Master（Inspection Item / Detection Value / Instrument / Inspection Plan）；
- Operation Inspection / Product Inspection / Production Receipt Quality Gate；
- Nonconforming Receipt 边界（LOT/SERIAL HOLD）；
- Production Scan Execution（Material + Operation）；
- Production Execution / Material Issue Analytics。

**不在本 Domain 范围：**

- 库存 inventory / LOT/SERIAL mutation（Inventory & Warehouse Domain 拥有）；
- 成本计算（Finance Operations Domain）；
- 库存状态转换（untracked nonconforming 隔离 = Inventory & Warehouse Domain dependency）；
- 完整 Outsourcing Order / Issue / Receipt / AP（Procurement & Outsourcing Domain）；
- MRP / 需求计划（Planning Domain）；
- 完整 APS / MES / HMI；
- Multi-Organization / Cross-org Operation Transfer（OUT_OF_SCOPE）；
- B3105 完整 Barcode / PDA 平台（Inventory & Warehouse Domain）；
- B3106 存货核算 / Cost Engine rewrite（Finance Operations Domain）。

### 29.2 Manual Evidence Baseline（摘要）

完整 43 项 MQ-01 ~ MQ-43 evidence 在会话上下文；本节列出关键 contract：

| 关键 contract | 含义 |
|---|---|
| 生产订单生命周期 | B3119：`保存 → 提交 → 审核 → 下达 → 开工 → 执行 → 完工`；本系统：`DRAFT / PENDING / SUBMITTED / APPROVED / RELEASED / IN_PROGRESS / COMPLETED / CANCELLED` |
| Approval | Production Order Approval 不等于实际允许车间执行；Release 是允许生成/下达正式执行任务的业务节点 |
| BOM Resolver | 不再长期依赖 `status='ACTIVE' ORDER BY ... LIMIT 1`；必须经 Engineering Resolver |
| Engineering Snapshot | 释放后 `BOM / Routing / Control Code / Work Center / standard time` 冻结 |
| Material List | 由 frozen BOM 形成；执行后不得任意修改；额外需求必须走 Supplement |
| Combined Picking | 多 Production Order 合并领料；per-order 分配与 WIP 归属保留 |
| Supplement | 临时增加非原 BOM material line；走与 Issue 相同 inventory / tracking / voucher / WIP / period / audit / idempotency 链路 |
| Return Reason | 来料不良 / 良料退回 / 制程不良；reason 必须支持 audit / statistics |
| Production Report | 与 `production_operation_reports` 唯一权威合并 |
| Byproduct | 副产品数量维护；成本分配留 Finance |
| Operation Plan | 自动/手工生成；GENERATED → SUBMITTED → APPROVED → RELEASED → EXECUTABLE |
| Scheduling | Forward / Backward；按 planned_start / planned_finish + Calendar + Work Center 容量 |
| Topology | LINEAR / NETWORK / PARALLEL / SPLIT / MERGE / ALTERNATE；当前 LINEAR 完整；NETWORK 必须 fail closed |
| Control Code | 是否参与排程 / 加工方法 / 汇报方法 / 检验方法 |
| Internal Handoff | 同组织普通工序自动流转 |
| Outsourced 边界 | 内部不自动完成；OUTSOURCING_HANDOFF_REQUIRED |
| Inspection Item / Detection Value / Instrument | master + lifecycle |
| Inspection Plan | 引用 Inspection Items + criteria / unit / instrument；与 QCP 形成 when / what |
| Sampling | 复用现有 FULL / FIXED_QUANTITY / PERCENTAGE |
| Operation Inspection | Report → Inspection → PASS / FAIL → Released quantity |
| Product Inspection | Receipt Confirm 按 policy gate；REQUIRED 时等待 PASS / WAIVED |
| Nonconforming | LOT/SERIAL HOLD 隔离；untracked status = Inventory dependency |
| Scan Execution | scanner wedge input；document no / operation code / LOT/SERIAL identity token |

### 29.3 Capability Audit Matrix（已审计）

完整 43 项 Coverage/Gap/Implementation Decision 见本节上表 `§22.19`。关键 deferred 类别按合法 reason 标注：

- `OUT_OF_SCOPE — CURRENT PRODUCT BASELINE`：Multi-Org Distribution、Cross-Org Operation Transfer；
- `CROSS_DOMAIN_DEPENDENCY`：Byproduct Cost Allocation（Finance）、完整 Outsourcing Order / Issue / Receipt / AP（Procurement）、untracked Nonconforming Stock Status（Inventory）；
- `DEFER_SOURCE_DETAIL`：Mold / Mold Combination / Complex Auxiliary Attributes；
- `SEMANTIC_MISMATCH`：原 `DRAFT / PENDING / IN_PROGRESS / COMPLETED` 状态模型 → 本轮补 Submit / Approve / Release 业务节点；BOM Resolver 在生产路径由 `status='ACTIVE' LIMIT 1` 收敛为 canonical Engineering Resolver。

### 29.4 目标 Capability Closure 要求

| Domain Capability | 落地后 Coverage 目标 | 关键 Acceptance |
|---|---|---|
| Production Order Lifecycle | `COVERED` | Draft / Submit / Approve / Reject / Release / Start / Complete / Cancel；状态机不允许跳跃 |
| Production Order Approval | `COVERED` | 接入 Platform Approval family `PRODUCTION_ORDER`；Audit + idempotency |
| Engineering Resolver 消费 | `COVERED` | `resolveEffectiveBomForCaller` 在生产订单 create / instruction 释放路径被调用 |
| Material List lifecycle | `COVERED` | generated / controlled edit / approved / released |
| Material Issue | `COVERED` | 复用现有 `production_material_issues`；不重写 |
| Material Supplement | `COVERED` | 新建 `production_material_supplements`；走同一库存 / voucher / WIP / period / audit / idempotency 链路 |
| Material Return | `COVERED` | reason 扩展；走现有 handler |
| Batch Picking / Combined Issue | `COVERED` | `production_batch_issues` 头 + 行；atomic failure；per-order 归属保留 |
| Byproduct | `PARTIAL — CROSS_DOMAIN_DEPENDENCY` | 表 + API + UI + Receipt 接入；cost allocation = Finance |
| Operation Plan lifecycle | `COVERED` | GENERATED / SUBMITTED / APPROVED / RELEASED / EXECUTABLE；snapshot |
| Forward Scheduling | `COVERED` | planned_start + Work Calendar + Shift + operation duration；non-working skip |
| Backward Scheduling | `COVERED` | planned_finish - work backward |
| Calendar Consumption | `COVERED` | `engineering_work_calendars` / `engineering_shifts` 真实读 |
| Capacity Warning | `COVERED` | Work Center overload |
| Control Code Snapshot | `COVERED` | `production_order_operations` 包含 snapshot fields |
| Topology | `COVERED` (LINEAR) + `PARTIAL` (NETWORK) | NETWORK 必须 fail closed |
| Operation Report | `COVERED` | 复用现有 verification |
| Internal Handoff | `COVERED` | `availableInput()` 自动流转 |
| Outsourced Boundary | `COVERED` | snapshot + OUTSOURCING_HANDOFF_REQUIRED |
| Inspection Item / Detection Value / Instrument Master | `COVERED` | CRUD + lifecycle |
| Inspection Plan | `COVERED` | 与 QCP 形成 when / what |
| Sampling 复用 | `COVERED` | 复用 `calculateSampleQuantity` |
| Operation Inspection | `COVERED` | `released_quantity` 与 `reported_quantity` 区分 |
| Product Inspection | `COVERED` | 按 policy gate |
| Production Receipt Quality Gate | `COVERED` | `assertProductionReceiptQualityGate` + `quality_state` 字段 |
| Nonconforming | `PARTIAL — INVENTORY_STATUS_DEPENDENCY` | LOT/SERIAL HOLD；untracked = OUT_OF_SCOPE |
| Production Scan | `COVERED` | Material + Operation 工作面；scanner wedge input |
| Analytics | `COVERED` | Execution Summary + Material Issue Summary；保留 WIP / Yield / Capacity / Cost |

### 29.5 Permission 约束

新增 / 既有 permission family（与实现一致）：

- 既有：`PRODUCTION_ORDERS_VIEW` / `PRODUCTION_ORDERS_CREATE` / `PRODUCTION_ORDERS_START` / `PRODUCTION_ORDERS_COMPLETE` / `PRODUCTION_MATERIAL_ISSUE_MANAGE` / `PRODUCTION_RECEIPT_MANAGE` / `PRODUCTION_COSTS_VIEW`；
- 既有：`IQC_VIEW` / `IQC_MANAGE` / `OQC_VIEW` / `OQC_MANAGE`；
- 新增：`PRODUCTION_PLAN_VIEW` / `PRODUCTION_PLAN_MANAGE`（Operation Plan）；
- 新增：`PRODUCTION_SUPPLEMENT_MANAGE`（Production Material Supplement）；
- 新增：`PRODUCTION_RETURN_MANAGE`（Production Material Return，含 reason）；
- 新增：`PRODUCTION_BATCH_ISSUE_MANAGE`（Batch Picking）；
- 新增：`PRODUCTION_INSPECTION_VIEW` / `PRODUCTION_INSPECTION_MANAGE`（Operation + Product Inspection）；
- 新增：`PRODUCTION_QUALITY_CONFIG_VIEW` / `PRODUCTION_QUALITY_CONFIG_MANAGE`（Inspection Item / Detection Value / Instrument / Plan master）；
- 新增：`PRODUCTION_BYPART_MANAGE`（Byproduct Receipt）；
- 新增：`PRODUCTION_SCAN_EXECUTE`（Production Scan 工作面）；
- Approval：family `PRODUCTION_ORDER` 接入 Platform Approval；admin 继承；
- 兼容：旧 `PRODUCTION_OUTPUT` permission 保留不引入。

兼容：5 个 role seed（admin / sales / warehouse / reviewer / accounting）继续按现有能力访问。

### 29.6 Compatibility / 不变性约束

- 不删除或重命名原有 50 enabled + 5 disabled route key；本轮新增 `production-quality` / `production-scan` / `quality-configuration` 三条 Manufacturing canonical route，最终为 53 enabled + 5 disabled；
- Production Order 状态机：`DRAFT → SUBMITTED → APPROVED → RELEASED → IN_PROGRESS → COMPLETED`；每个转移需要同时检查权限、来源、累计执行量、业务不变量；不支持从 SUBMITTED 直接跳到 IN_PROGRESS 等；
- Production Order `bom_id / bom_version_snapshot / routing_id_snapshot / production_order_items.*` 不可写回修改；
- 既有 IQC / OQC / QCP 不破坏；
- 既有 `production_material_issues / production_material_returns / production_receipts / production_receipt_reversals / production_operation_reports / production_operation_report_reversals` 表与 handler 不破坏；
- legacy `production_outputs` 表保留；dead handler `createProductionOutput` 移除；2 处 active read（`listProductionOrders` / `getProductionOrder`）替换为 `production_receipts.netReceived` 来源；
- 不 DROP historical table；
- SQLite + MySQL 8 schema parity；migration idempotent。

### 29.7 Out of Scope（本 Domain Closure 不实施）

- Multi-Org Distribution / Cross-Org Operation Transfer；
- 完整 Outsourcing Order / Issue / Receipt / AP（Procurement & Outsourcing Domain）；
- 完整 MRP substitute 消费；
- 完整 APS / MES / HMI；
- Mold / Mold Combination / Complex Auxiliary Attributes（DEFER_SOURCE_DETAIL）；
- Inventory Status Conversion / 完整 Stock Status；
- Generic Workflow / Smart Accounting / Management Accounting；
- Finance Costing rewrite / destructive cleanup / DROP historical table / database reset；
- 完整 B3105 Barcode / PDA 平台（Inventory & Warehouse Domain）；
- B3106 存货核算完整 lifecycle（Finance Operations Domain）；
- Byproduct Cost Allocation。

### 29.8 Acceptance Criteria

#### A. Functional

- Production Order 全 lifecycle 转移 + Approval family `PRODUCTION_ORDER` 接入；
- Material List lifecycle + controlled edit + approved / released；
- Material Issue / Supplement / Return / Batch Issue 走相同 inventory / voucher / WIP / period / audit / idempotency 链路；
- Operation Plan lifecycle + Engineering Snapshot + Forward / Backward Scheduling；
- Work Calendar / Shift / Capacity 真实消费；
- Topology：LINEAR 完整；NETWORK / PARALLEL / SPLIT / MERGE / ALTERNATE fail closed；
- Internal Handoff + Outsourced Boundary fail closed；
- Inspection Item / Detection Value / Instrument Master CRUD + lifecycle；
- Inspection Plan + 与 QCP 的 when / what 关系；
- Operation Inspection + Product Inspection + Production Receipt Quality Gate；
- Nonconforming Receipt LOT/SERIAL HOLD 隔离；
- Production Scan 工作面 Material + Operation；
- Analytics Execution Summary + Material Issue Summary + 既有 WIP / Yield / Capacity / Cost。

#### B. Data / Schema

- 新增表 / column 全部 additive；既有表 / 字段无破坏；
- Production Order 状态机字段 additive；既有数据兼容（`DRAFT / PENDING / IN_PROGRESS / COMPLETED / CANCELLED` 仍合法）；
- legacy `production_outputs` 表保留；dead handler 移除；
- SQLite / MySQL 8 schema parity；migration idempotent。

#### C. Security

- 所有 Manufacturing mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- Audit 写入关键 Production / Quality / Inspection mutation；
- Approval family `PRODUCTION_ORDER` 与现有五审批族不冲突。

#### D. Test

- Wave A focused：production order state machine / approval / engineering resolver / material list lifecycle / legacy production_outputs convergence；
- Wave B focused：material supplement / return reason / batch picking / atomic failure；
- Wave C focused：operation plan lifecycle / forward-backward / calendar skip / capacity；
- Wave D focused：control code snapshot / topology / internal handoff / outsource boundary；
- Wave E focused：inspection item / detection value / instrument / plan / QCP relation；
- Wave F focused：operation inspection / product inspection / receipt quality gate / nonconforming boundary；
- Wave G focused：production scan material + operation；
- Wave H focused：execution summary / material issue summary；
- 全部 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。

#### E. UI / Mobile

- Production Order Detail 成为真正 execution hub（Header → Source & Plan → Material → Operations → Quality → Receipt → Completion）；
- Material Execution / Operation Execution / Production Receipt 按数据要求 mobile-friendly；
- Production Scan 工作面按扫描器主流入口；
- Quality Master 与 Quality Execution 分离；
- 320 / 390 / 430 / 680 CSS px 验证；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`。

#### F. Documentation / Log

- `document.md §22.19` 与 §29 同步更新；
- `solution.md §24` 同步更新（Design）；
- `log/2026-10-07.md` 追加本 Domain Closure 完整记录；
- `README.md` 仓库地图与新增 page route / server module / 测试同步更新；
- `APPLY_GUIDE.md` 不动。

### 29.9 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization 需求出现；
2. 需要重写完整 MRP / 完整 APS / 完整 Outsourcing；
3. 需要 DROP historical table；
4. destructive data rewrite；
5. source semantics 不足；
6. MySQL migration 无法保证 parity；
7. 既有 Inventory / AR / AP / WIP / GL 原子合同必须破坏；
8. legacy `production_outputs` 表有真实活动调用方（非本仓库代码）。

### 29.10 最终接受状态

本节 Requirement 包含 43 项 Capability / 8 个 Wave / 16 个新增 permission。本节为 Approved Requirement，下游 Design 见 `solution.md §24`。

---

**MANUFACTURING & QUALITY DOMAIN CLOSURE REQUIREMENT — READY FOR DESIGN & IMPLEMENTATION**

---

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
- database：受保护 disposable MySQL 环境运行 `pnpm test:mysql` 与 `pnpm test:mysql:concurrency`，证明 release/reservation 不双发、不超分配；
- browser：Forecast、MRP、Planned Orders、Planner Workbench、Instruction flow、Planning Configuration/Reservation 在 320/390/430/680 CSS px 无 document overflow，主要动作、长编码、time bucket、trace、split/merge、source selection 可用。

### 30.7 Explicitly deferred / out of scope

- `OUT_OF_SCOPE_PRODUCT_BASELINE`：Multi-Organization；
- `CROSS_DOMAIN_DEPENDENCY`：完整 Outsourcing execution、Procurement sourcing、physical Inventory status/lock 深化；
- `SOURCE_DETAIL_INSUFFICIENT`：截图级 Manufacturing Strategy 全字段、金蝶精确 forecast time-fence、复杂 substitute 数量算法；
- 不实施 generic APS、Finance rewrite、Generic Workflow、destructive cleanup 或 legacy table DROP。

---

**PLANNING DOMAIN CLOSURE REQUIREMENT — APPROVED BY CONTINUOUS USER AUTHORIZATION FOR DESIGN & IMPLEMENTATION**

---

## 31. Procurement & Outsourcing Domain Closure Requirement

> 本节固化 Procurement & Outsourcing Domain Closure 的 Requirement 阶段成果。
> Manual Evidence Baseline 来自上游已提供的 B3101 / B3121 + B3104 / B3105 / B3106 / B3108 / B3109 / B3119 / B3120；本节 Coverage 以 2026-10-08 PROCUREMENT & OUTSOURCING DOMAIN Audit PASS 为准。
>
> Design 见 `solution.md §26`（待用户 PASS 后展开）；本阶段不进入 Design / Implementation。
>
> 已知 Audit Normalization（用户最终确认）：
> - PRC-08 = PARTIAL → ENHANCE；
> - PRC-12 = PARTIAL → ENHANCE；
> - PRC-14 = PARTIAL → ENHANCE；
> - PRC-16 = PARTIAL → ENHANCE；
> - PRC-23 = SEMANTIC_MISMATCH → CONVERGE；
> - OUT-07 = MISSING → NEW；
> - OUT-21 = MISSING；
> - OUT-23 = MISSING → NEW / INTEGRATE。

### 31.1 范围与 ownership

Procurement & Outsourcing 拥有：

- 采购参数 / Supplier 采购 profile / Buyer / Purchasing Group；
- Sourcing / Quota / Sourcing Decision；
- 采购价格体系（Price List / Pricing UOM / Pricing Discount / Price Adjustment）；
- PR / PO / Receipt Notice / Purchase Return / Return Request；
- 委外 supplier profile / Outsourcing Source List / Processing Price；
- Outsourcing Order / Outsourcing Lifecycle（PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED）；
- OUTSOURCE BOM consumption；
- 委外 Material List / Issue / Supplement / Return / Backflush；
- Outsourcing Receipt / Inspection / Inbound 入仓；
- Processing Fee AP extension；
- Procurement Scan 成本回入口；
- VMI business documents（VMI Policy / Receipt / Consumption / Summary / Ownership Transfer / Supplier Bill handoff）。

**不在本 Domain 范围：**

- physical inventory truth、owner dimension（Inventory & Warehouse Domain）；
- IQC engine 内部（Quality Domain）；
- Supplier Bill / AP / GRNI / Payments / final costing adjustment（Finance Operations Domain）；
- GL / Voucher / Period close（Accounting & Analytics Domain）；
- MRP / Reservation（Planning Domain）；
- BOM / Substitute / Routing master（Master & Engineering Domain）；
- Production Order execution / Inspection（Manufacturing & Quality Domain）；
- Multi-Org / Multi-Currency（OUT_OF_SCOPE_PRODUCT_BASELINE）；
- 完整 B3105 PDA / camera SDK / label printing（Inventory & Warehouse Domain）；
- Generic Workflow（Platform Domain）。

### 31.2 Manual Evidence Baseline（摘要）

完整证据来自上游已批准的 B3101 / B3121 + 支撑手册 B3104 / B3105 / B3106 / B3108 / B3109 / B3119 / B3120。下表为关键 contract：

| 关键 contract | 含义 |
|---|---|
| 三账务链 | LEGACY_DIRECT `Dr Inventory / Cr AP`；SEPARATE Receipt `Dr Inventory / Cr GRNI`；SEPARATE Supplier Bill `Dr GRNI (+Input Tax Receivable if applicable) / Cr AP`；AUTO_BILL 同事务原子两步 |
| 新业务默认 billing_mode | 必须为 `SEPARATE`；`LEGACY_DIRECT` 仅历史兼容 |
| PO execution state | canonical 视图 OPEN / PARTIALLY_RECEIVED / FULFILLED/CLOSED / CANCELLED；MRP / Workbench / Reservation / Receiving **全部消费同一 canonical open remaining quantity** |
| PR→PO | quantity / source / 累计 release / 剩余 / 逆算审计完整；source-line trace 不丢 |
| Source List 启用时 | 无有效 Source List 的 supplier 不得静默使用；override 必须 permission + reason + audit |
| Quota PROPORTIONAL | deterministic、quantity conservation、source-line trace、无超分配、并发安全；其它复杂 quota algorithm = `SOURCE_DETAIL_INSUFFICIENT` |
| Sourcing Decision | PR Line → Source List Entry → Supplier → Allocated Quantity → Rule/Reason；不得仅依赖 `preferred_supplier_id` 或请求端临时 assignment |
| Pricing Discount 因子 | **只**影响 procurement price resolution / PO snapshot；**不得**直接创建 AP credit；**不得** repurpose `purchase_discounts` |
| Price Adjustment | effectivity-dated；**禁止** retroactive rewrite historical approved PO / Receipt / Bill / AP |
| Receipt Notice | PO → Receipt Notice → Receipt / IQC；**不得** change inventory / valuation / GRNI / AP；支持 multi-PO consolidation |
| Purchase Return 四分支 | LEGACY_DIRECT → AP/commercial credit；SEPARATE unbilled → reverse GRNI（无 AP credit）；SEPARATE billed → AP/commercial credit；SEPARATE partially billed → deterministic split（unbilled→GRNI reversal；billed→AP credit）；库存 reversal 与 commercial/AP adjustment 分离但 source trace |
| Outsourcing ownership | Standard Outsourcing enterprise-owned throughout；Supplier WIP = location binding，**不是** ownership transfer；不得复用 VMI ownership semantics |
| Outsourcing PO | processing-fee commitment；不得把 enterprise-supplied material 作为 PO line |
| Outsourcing cost evidence | `consumed/backflushed material carrying value + processing fee`；**排除** issued but unused / returned / supplier-WIP remaining |
| Outsourcing Lifecycle | `PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED`；**禁止**无证据把 `SUBMITTED / APPROVED` 列为必需阶段 |
| OUTSOURCE BOM | Outsourcing Order 必须消费 approved / effective / `purpose=OUTSOURCE` / business-date appropriate BOM；禁止 `ACTIVE LIMIT 1` selector |
| Handoff consumption | Planning `planning_outsource_handoffs(PENDING)` exactly-once consume；idempotent / source trace / concurrency-safe / status transition；Planning truth 不修改 |
| VMI 区别 | VMI = physical at enterprise site + owner = supplier；standard outsourcing = owner = enterprise + physical at supplier；VMI full physical availability = `CROSS_DOMAIN_DEPENDENCY` |

### 31.3 Capability Audit Matrix（已审计）

#### 31.3.1 Procurement PRC-01 ~ PRC-26

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| PRC-01 | Procurement Parameters | `MISSING` | `NEW`：source control enabled / quota control enabled / PR policy / default billing mode（SEPARATE）/ PO change policy / receiving tolerance / return policy-reasons；参数变化不反写历史已批准/已执行单据 |
| PRC-02 | Supplier Procurement Profile | `PARTIAL → ENHANCE` | 扩展 Supplier profile：`procurement enabled / outsourcing enabled / supplier category / qualification / qualification validity / procurement defaults / payment-settlement defaults / supplier WIP warehouse binding where applicable`；**不**重建 Supplier |
| PRC-03 | Buyer / Purchasing Group | `MISSING` | `NEW`：Buyer / Purchasing Group / membership / document assignment；server-side fail closed |
| PRC-04 | Source List | `MISSING` | `NEW`：Product / Supplier / Source Type (`PURCHASE / OUTSOURCE`) / Effective Period / Enabled；启用 source control 时无有效 Source List 的 supplier 不得静默使用；override = permission + reason + audit |
| PRC-05 | Quota | `MISSING` | `NEW`：bounded `PROPORTIONAL` 供应分配；deterministic / quantity conservation / source-line trace / no over-allocation / concurrency-safe；其它复杂 quota algorithm = `SOURCE_DETAIL_INSUFFICIENT` |
| PRC-06 | Sourcing Decision | `MISSING` | `NEW`：PR Line → Source List Entry → Supplier → Allocated Quantity → Rule/Reason；不得仅依赖 `preferred_supplier_id` 或请求端临时 assignment |
| PRC-07 | Purchase Price List | `MISSING` | `NEW`：supplier / product / source type / effective period / pricing UOM / unit price / status-version；单币种产品基线；不得顺手建立 Multi-Currency；PO 冻结 resolved price evidence |
| PRC-08 | Pricing UOM | `PARTIAL → ENHANCE` | `ENHANCE`：当前 generic UOM conversion / purchase UOM / document quantity / base quantity snapshot / rational conversion KEEP；补 Pricing UOM ≠ Purchase/Document UOM 时的取价规则；禁止第二 UOM engine |
| PRC-09 | Procurement Pricing Discount Table | `MISSING`（**不**复用 `purchase_discounts`） | `NEW`：procurement pricing-side discount；**仅**影响 price resolution / PO snapshot；**不得**直接创建 AP credit；existing `purchase_discounts` = AP / settlement-stage allowance（Finance）KEEP |
| PRC-10 | Purchase Price Adjustment | `MISSING` | `NEW`：effectivity-dated price adjustment + new price version/history；**禁止** retroactive rewrite historical approved PO / Receipt / Bill / AP |
| PRC-11 | Requisition Sources | `PARTIAL` | `ENHANCE`：固化 source-line trace；当前 `Manual / Planning-Purchase Instruction` 已存在；若 Sales-related direct PR 有真实 source 可作为 supported source；不得预先把 `Production Order direct / Sales Order direct / Safety Stock direct` 写成已确认事实；Planning demand 由 frozen Planning owner 管理 |
| PRC-12 | PR Split / Merge / Supplier Allocation | `PARTIAL → ENHANCE` | `ENHANCE`：保留 per-line supplier assignment / partial quantity conversion / supplier grouping / remaining protection；新增 canonical sourcing allocation / split-merge planning fact / audit；**不**重写现有 batch converter |
| PRC-13 | Purchase Order | `COVERED` | `KEEP`：现有 approval lifecycle `DRAFT → SUBMITTED → APPROVED / REJECTED`；**不**声称 current 有 CLOSED；Execution lifecycle 归 PRC-19 |
| PRC-14 | PO Commercial Snapshot | `PARTIAL → ENHANCE` | `ENHANCE`：已冻结 supplier / contact / phone / address / expected delivery / payment terms / line price / PR source / document&base UOM quantity KEEP；新增 supply / settlement / payee supplier / buyer / purchase group / price source / discount source / delivery schedule；默认 `settlement supplier = supply supplier` / `payee supplier = settlement supplier`；payment execution 归 Finance Owner |
| PRC-15 | Gift / Free Item | `SEMANTIC_MISMATCH → CONVERGE` | `CONVERGE`：合法赠品 `is_gift = true / unit_price = 0 / amount = 0`；普通非赠品不得借 gift contract 绕过 commercial validation |
| PRC-16 | Delivery Schedule / Quantity Control | `PARTIAL → ENHANCE` | `ENHANCE`：header `expected_delivery_date` + 硬性超收保护 KEEP；新增 line/multi-delivery schedule + earliest/latest + upper/lower tolerance；lower-tolerance auto-close 算法 source 不足**不**猜 |
| PRC-17 | Prepayment Requirement | `MISSING` | `NEW`：Procurement owns Prepayment Requirement / Schedule；Finance owns actual Payment / Allocation；Requirement 只定义 Procurement → Finance handoff；**不**建立第二支付引擎 |
| PRC-18 | PO Change | `MISSING` | `NEW`：正式 business document；至少 `ADD / MODIFY / CANCEL`；可改变 quantity / price / delivery date/schedule；必须保留 original / change / approval-audit / applied result；禁止历史覆盖；已执行 quantity / source identity 受保护 |
| PRC-19 | PO Execution Status | `SEMANTIC_MISMATCH → CONVERGE` | `CONVERGE`：建立 canonical PO execution view/state：`OPEN / PARTIALLY_RECEIVED / FULFILLED-CLOSED / CANCELLED where valid`；storage 由 Design 决定；**invariant**：MRP / Planner Workbench / Reservation / Receiving **全部消费同一 canonical `open remaining quantity`**；Reservation 不再使用 `Approved total` |
| PRC-20 | Receipt Notice | `MISSING` | `NEW`：独立正式 document；PO → Receipt Notice → Receipt / IQC；支持 multi-PO consolidation；**绝对不** change inventory / valuation / GRNI / AP |
| PRC-21 | Incoming Inspection | `COVERED` | `KEEP`：现有 IQC backbone；Procurement Requirement 只描述 source integration；Outsourcing 后续扩展 `OUTSOURCING_RECEIPT`（Design 决定 canonical source type）；**不**新建 Quality engine |
| PRC-22 | Purchase Receipt | `COVERED` | `KEEP` + 增强：Receipt Notice source；delivery schedule/tolerance enforcement；sourcing/commercial trace；MySQL source-line concurrency；**不**重写 inventory / LOT-SERIAL / valuation / IQC / idempotency / period control |
| PRC-23 | Billing Mode Semantics | `SEMANTIC_MISMATCH → CONVERGE` | `CONVERGE`：默认 `billing_mode = SEPARATE`；`LEGACY_DIRECT = compatibility only`；`AUTO_BILL = explicit valid mode`；账务 contract 不变（详见 §31.2 三账务链） |
| PRC-24 | Return Request | `MISSING` | `NEW`：业务意图层；不得与 Purchase Return inventory execution 合并；至少 source / type / reason / method / replenishment method / quantity；未入库货物不得制造 inventory return |
| PRC-25 | Purchase Return | `SEMANTIC_MISMATCH → CONVERGE` | `CONVERGE`：physical/value execution KEEP；financial settlement 四分支正确（详见 §31.2）；库存 reversal 与 commercial/AP adjustment 分离但保持 source trace |
| PRC-26 | Procurement Scan | `MISSING` | `NEW` bounded：PO or Receipt Notice → Purchase Receipt；scanner wedge + document/item identity + warehouse + qty + LOT/SERIAL；**不**做 camera SDK / barcode designer / label printing / generic PDA platform |

#### 31.3.2 VMI VMI-01 ~ VMI-05

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| VMI-01 | VMI Policy / Agreement | `MISSING` | `NEW`：VMI Procurement business facts（bargain / settlement contract）；full owner-dimensional physical inventory 属 `CROSS_DOMAIN_DEPENDENCY` |
| VMI-02 | VMI Receiving | `MISSING` | `NEW`：receive to supplier-owned bucket；不得伪造 owned inventory |
| VMI-03 | VMI Consumption | `MISSING` | `NEW`：consume 不会 up supplier-owned bucket |
| VMI-04 | VMI Consumption Summary / Ownership Transfer | `MISSING` | `NEW`：period summary → settlement window → ownership transfer trigger |
| VMI-05 | VMI Ownership Transfer / Supplier Bill Handoff | `MISSING` | `NEW`：transfer `supplier → own` + 创建 Supplier Bill for released qty；不建立第二 owned inventory ledger |

> VMI = `physical location = enterprise site / owner = supplier`；与 Standard Outsourcing 方向相反。VMI full physical availability 依赖 Inventory owner dimension（`CROSS_DOMAIN_DEPENDENCY`），但不阻塞 VMI business documents 设计。

#### 31.3.3 Outsourcing OUT-01 ~ OUT-23

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| OUT-01 | Outsourcing Supplier | `PARTIAL` | `ENHANCE`：扩展 PRC-02 Supplier Procurement Profile：`outsourcing enabled / outsourcing qualification / supplier WIP warehouse binding` |
| OUT-02 | Outsourcing Source List | `MISSING` | `NEW`：复用 Procurement sourcing/pricing infrastructure；`source_type = OUTSOURCE` |
| OUT-03 | Processing Price | `MISSING` | `NEW`：加工费；**不是** finished product full material cost |
| OUT-04 | Supplier WIP Warehouse | `PARTIAL` | `ENHANCE`：canonical Warehouse bound to Supplier as outsourcing WIP **location**；**不是** ownership transfer；不创建第二 Warehouse master |
| OUT-05 | Planning Handoff | `PARTIAL` | `ENHANCE`：exactly-once consume `planning_outsource_handoffs(PENDING)`；idempotent / source trace / concurrency-safe / status transition；Planning truth 不修改 |
| OUT-06 | Outsourcing Order | `MISSING` | `NEW`：来源至少 `PLANNING / MANUAL`；operation outsourcing source semantic 后续 source 足够再加 |
| OUT-07 | Outsourcing Lifecycle | `MISSING → NEW` | `NEW`：source-backed Manual semantics `PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED`；**不**写 `SUBMITTED / APPROVED` 为必需阶段；创建态 / 取消态 / 是否需要审批留 Design bounded |
| OUT-08 | OUTSOURCE BOM | `PARTIAL` | `ENHANCE`：Outsourcing Order 必须消费 approved / effective / `purpose=OUTSOURCE` / business-date appropriate BOM；禁止 `ACTIVE LIMIT 1` selector |
| OUT-09 | Outsourcing Material List | `MISSING` | `NEW`：Order 保存/确认时形成 execution snapshot（BOM/version / component / per-unit quantity / scrap / required quantity）；Release 后 master BOM 改变**不**回写历史；额外材料走 Supplement |
| OUT-10 | Outsourcing PO | `MISSING` | `NEW`：**processing-fee commercial commitment**；不是 "采购企业提供给供应商的材料"；Requirement 推荐 `business_type = OUTSOURCE` + `source = Outsourcing Order` + commercial price = processing fee；最终是否复用 canonical PO 留 Design |
| OUT-11 | Outsourcing Material Issue | `MISSING` | `NEW`：issue enterprise-owned materials to supplier WIP warehouse；复用 canonical Inventory Transfer / tracking primitives |
| OUT-12 | Outsourcing Material Supplement | `MISSING` | `NEW`：与 Issue 同一链路；source-traceable |
| OUT-13 | Outsourcing Material Return | `MISSING` | `NEW`：from supplier WIP → internal warehouse；复用 canonical Inventory Transfer / tracking primitives |
| OUT-14 | Outsourcing Material Ownership | `PARTIAL` | `ENHANCE`：enterprise-owned throughout；新增 order-specific material position + supplier-WIP location + issued / returned / remaining / backflushed；**不**是 new owner ledger |
| OUT-15 | LOT / SERIAL for Outsourcing Materials | `PARTIAL` | `ENHANCE`：复用 existing canonical tracking；要求 issue → supplier WIP → return / backflush 持续可追；禁止第二 serial/lot engine |
| OUT-16 | Backflush | `MISSING` | `NEW`：基于 Outsourcing Order + Material List + actual issued/supplemented/returned + receipt quantity + tracked identities；order-specific consumption；不跨订单随意消费 Supplier WIP |
| OUT-17 | Outsourcing Completion Receipt Notice | `MISSING` | `NEW`：不改变 inventory / GRNI / AP |
| OUT-18 | Outsourcing Inspection | `PARTIAL` | `ENHANCE`：扩展 IQC source-type `OUTSOURCING_RECEIPT`（Design 决定 canonical name） |
| OUT-19 | Outsourcing Inbound | `MISSING` | `NEW`：Flow：Outsourcing Order / Processing PO → Completion Receipt Notice → Quality（if required）→ Outsourcing Receipt → Enterprise Finished Inventory Recognition；**不**是 supplier-owned finished stock → enterprise ownership transfer；Supplier WIP 是 source/location context；只有 confirmed valid Outsourcing Receipt 才形成 enterprise warehouse finished inventory fact |
| OUT-20 | Processing Fee AP | `PARTIAL` | `ENHANCE`：**必须扩展** canonical Supplier Bill source contract；不得建立 `Outsourcing Payable` 第二引擎；至少能 trace：Outsourcing Receipt / Outsourcing Receipt Item / Outsourcing PO line / processing quantity / processing fee |
| OUT-21 | Outsourcing Cost Evidence | `MISSING` | `NEW`：正确基础 = `consumed/backflushed material carrying value + processing fee`；**排除** issued but unused / returned / supplier-WIP remaining；Procurement/Outsourcing owner 提供 cost evidence；final costing adjustment / variance allocation 归 Finance |
| OUT-22 | Finished Return | `MISSING` | `NEW`：来源 = confirmed Outsourcing Receipt；要求 quantity cap / LOT-SERIAL / finished inventory reversal / processing-fee billability-credit handoff / material & cost trace；**不**机械复用普通 Purchase Return 的 price semantics |
| OUT-23 | Period-End / WIP / Opening / Reports | `MISSING → NEW / INTEGRATE` | `NEW / INTEGRATE`：必须覆盖 backflush difference allocation / supplier material balance / WIP transfer / opening outsourcing order / opening outsourcing WIP / execution summary / material issue summary-detail；Opening 期间不强制用 generic Period Close 判 PARTIAL；不得用 generic Period Close 判 PARTIAL |

### 31.4 目标 Capability Closure 要求

| Domain Capability | 落地后 Coverage 目标 | 关键 Acceptance |
|---|---|---|
| Procurement Parameters (PRC-01) | `COVERED` | 参数生效；新业务默认 SEPARATE 可观测；参数变化不反写历史 |
| Supplier Procurement Profile (PRC-02) | `COVERED` | procurement / outsourcing qualification / category / payment-settlement defaults；supplier WIP binding where applicable |
| Buyer / Purchasing Group (PRC-03) | `COVERED` | server-side fail closed；不依赖前端隐藏 |
| Sourcing (PRC-04 / PRC-05 / PRC-06) | `COVERED` | Source List enabled + Quota deterministic + Sourcing Decision 可追溯；override 审计完整 |
| Pricing (PRC-07 / PRC-08 / PRC-09 / PRC-10) | `COVERED` | Price List / Pricing UOM / Pricing Discount / Price Adjustment 生效；PO 冻结 resolved price evidence；Pricing Discount **不**进 AP；Price Adjustment **不**回写历史 |
| PR / PO (PRC-11 / PRC-12 / PRC-13 / PRC-14) | `COVERED` | source-line trace / split-merge audit / snapshot 完整 |
| Gift (PRC-15) | `COVERED` | legal Gift 实测可建模；非 gift line 不得 0 价 |
| Delivery Schedule (PRC-16) | `COVERED` | multi-delivery schedule + tolerance boundary 生效 |
| Prepayment (PRC-17) | `COVERED` | Procurement→Finance handoff 完整；Finance 唯一支付 owner |
| PO Change (PRC-18) | `COVERED` | ADD/MODIFY/CANCEL；original/change/audit/applied 完整 |
| PO Execution (PRC-19) | `COVERED` | canonical execution state OPEN/PARTIALLY_RECEIVED/FULFILLED-CLOSED/CANCELLED；MRP/Workbench/Reservation/Receiving 同一消费 |
| Receipt Notice (PRC-20) | `COVERED` | 不影响 inventory / valuation / GRNI / AP；multi-PO consolidation 可用 |
| IQC (PRC-21) | `COVERED` | backbone KEEP；Outsourcing source-type 接入不破坏 |
| Purchase Receipt (PRC-22) | `COVERED` | 增强不重写既有主干 |
| Billing Mode (PRC-23) | `COVERED` | 默认 SEPARATE；三链账务 contract 不变；历史 LEGACY_DIRECT 数据不反写 |
| Return Request (PRC-24) | `COVERED` | 与 Purchase Return execution 分离；未入库货物不被制造为 inventory return |
| Purchase Return (PRC-25) | `COVERED` | 四分支账务正确；source trace 完整 |
| Procurement Scan (PRC-26) | `COVERED` | bounded 入仓；不影响业务合同 |
| VMI (VMI-01 ~ VMI-05) | `COVERED`（business layer） | VMI Policy / Consumption / Summary / Supplier Bill handoff 完整；不伪造 owned inventory |
| Outsourcing (OUT-01 ~ OUT-23) | `COVERED` | 23 capability 全部落地；enterprise ownership 不漂移；location binding 完整；canonical Supplier Bill 扩展不创建第二引擎 |

### 31.5 Permission 约束

新增最小独立 permission 家族（back-end fail closed；不锁死最终 name）：

- Procurement Configuration（含 Procurement Parameters / Buyer / Purchasing Group / Profile / Numbering / Tolerance）
- Sourcing（Source List / Quota / Sourcing Decision）
- Pricing（Price List / Pricing UOM / Pricing Discount / Price Adjustment）
- PO Change（PO Change / PO Execution state management）
- Receipt Notice（Receipt Notice create/confirm）
- Return Request（Return Request create/review/post）
- VMI（VMI policy / receiving / consumption / summary / ownership transfer）
- Outsourcing View / Manage
- Outsourcing Release（Outsourcing Order release/complete/close）
- Outsourcing Material Execution（Issue / Supplement / Return / Backflush）
- Outsourcing Receiving（Completion Receipt Notice / Inspection / Receipt / Return）

兼容：保留既有 `SUPPLIERS_*` / `PURCHASE_REQUISITION_*` / `PURCHASE_ORDERS_*` / `PURCHASE_RECEIPTS_*` / `RETURNS_*` / `IQC_*` / `AP_*` / `PURCHASE_DISCOUNT_*`；5 个 role seed（admin / sales / warehouse / reviewer / accounting）继续按现有能力访问；新 permission admin 继承；其它角色保持现状。

### 31.6 Compatibility / 不变性约束

- 不删除 / 重命名现有 57 enabled + 5 disabled route key；本 Domain Closure additive 引入新 route 与 owner；
- 不修改既有 `purchase_discounts` schema（保持现有 AP / settlement-stage allowance 语义）；
- 不重写 Inventory / Quality / AP / GL / Period Close backbone；
- 不重写 Manufacturing canonical owner；
- 不修改既有的 SCHEMA SUPPLIER master；新字段以 additive 形式扩展；
- 不 DROP historical table；
- 不重命名既有 release tag；
- SQLite + MySQL 8 schema parity；migration idempotent。

### 31.7 Out of Scope（本 Domain Closure 不实施）

- Multi-Org / Multi-Currency（OUT_OF_SCOPE_PRODUCT_BASELINE）；
- 完整 B3105 PDA / camera SDK / label printing / generic PDA platform；
- Finance engine rewrite（重写 Supplier Bill / AP / GRNI / Payments / Cost）；
- Inventory ledger rewrite（含 owner dimension 的 invasive 改动）；
- Generic Workflow redesign；
- destructive data rewrite / DROP historical table / database reset；
- 完整 Operation Outsourcing handoff（工序委外完整 lifecycle，Outsourced Operation Boundary = PARTIAL INTEGRATION）；
- retroactive rewrite 历史 approved PO / Receipt / Bill / AP（PRC-10 Price Adjustment 的硬性禁止）。

### 31.8 Acceptance Criteria

#### A. Functional

全部 PRC-01~26 + VMI-01~05 + OUT-01~23 = 54 项 capability 每一项都必须有 final capability disposition。本域 capability disposition **穷尽且仅**分为以下两类：

```text
DOMAIN-OWNED SOURCE-BACKED CAPABILITIES = 49
+
MUST INTEGRATE capabilities = 5
=
54 capabilities
```

Cross-domain dependency 是 acceptance dependency metadata，不是 capability disposition；不得把任何 capability "挪入 CROSS_DOMAIN_DEPENDENCY" 来代替 disposition。

1. **Procurement & Outsourcing Domain 自有的 source-backed capability = 49 项**

   按 family 分组（25 PRC + 5 VMI + 19 OUT）：

   - **PRC domain-owned = 25 项**（PRC-21 = integration-backed，本节不含）：
     PRC-01 / PRC-02 / PRC-03 / PRC-04 / PRC-05 / PRC-06 / PRC-07 / PRC-08 / PRC-09 / PRC-10 / PRC-11 / PRC-12 / PRC-13 / PRC-14 / PRC-15 / PRC-16 / PRC-17 / PRC-18 / PRC-19 / PRC-20 / PRC-22 / PRC-23 / PRC-24 / PRC-25 / PRC-26
   - **VMI domain-owned = 5 项**（**全部**）：
     VMI-01 / VMI-02 / VMI-03 / VMI-04 / VMI-05
   - **OUT domain-owned = 19 项**（OUT-08 / OUT-18 / OUT-20 / OUT-23 = integration-backed，本节不含）：
     OUT-01 / OUT-02 / OUT-03 / OUT-04 / OUT-05 / OUT-06 / OUT-07 / OUT-09 / OUT-10 / OUT-11 / OUT-12 / OUT-13 / OUT-14 / OUT-15 / OUT-16 / OUT-17 / OUT-19 / OUT-21 / OUT-22

   所有 49 项必须达到 Requirement 定义的目标闭环；不得残留未经用户批准的 `MISSING` / `SEMANTIC_MISMATCH`。其中 4 项历史 `SEMANTIC_MISMATCH` 的 `→ CONVERGE` invariant：
   - PRC-15 Gift / Free Item：`is_gift_line` 标记 / `>= 0` 放宽；
   - PRC-19 PO Execution Status：canonical `OPEN / PARTIALLY_RECEIVED / FULFILLED-CLOSED / CANCELLED`；MRP / Workbench / Reservation / Receiving 全部消费同一 canonical `open remaining quantity`；
   - PRC-23 Billing Mode Semantics：默认 `SEPARATE`；`LEGACY_DIRECT = compatibility only`；`AUTO_BILL = explicit valid mode`；
   - PRC-25 Purchase Return：LEGACY_DIRECT → AP/commercial credit；SEPARATE unbilled → reverse GRNI；SEPARATE billed → AP/commercial credit；SEPARATE partially billed → deterministic split（unbilled → GRNI reversal；billed → AP credit）。

   **VMI-01~05 全部归本 Domain 完成**。VMI-01 Policy / Agreement、VMI-02 Receiving business fact、VMI-03 Consumption business fact、VMI-04 Consumption Summary / Settlement Window、VMI-05 Ownership Transfer business fact 五项的 business layer（policy、agreement、document、quantity、settlement、audit、idempotency / business lifecycle）全部由 Procurement & Outsourcing Domain owner 完成；不得将 VMI-03 / VMI-05 整个 capability defer 给 Inventory Domain。

2. **MUST INTEGRATE capability = 5 项**

   必须成功消费 canonical owner 的稳定 integration contract，**不得**建立 duplicate mutable truth：

   - **PRC-21 IQC**：消费 `authoritative-quality.js`，不得新建 Quality engine；
   - **OUT-08 OUTSOURCE BOM**：消费 `engineering-configurable-bom.js` resolver（`approved / effective / purpose=OUTSOURCE / business-date appropriate`），禁止 `ACTIVE LIMIT 1` selector；
   - **OUT-18 Inspection**：扩展 IQC source-type `OUTSOURCING_RECEIPT`（canonical name 由 Design 决定）；
   - **OUT-20 Processing Fee AP**：扩展 canonical Supplier Bill source contract，**不得**建立 `Outsourcing Payable` 第二引擎；至少能 trace Outsourcing Receipt / Outsourcing Receipt Item / Outsourcing PO line / processing quantity / processing fee；
   - **OUT-23 Period-End**：复用 Period Close framework integration；opening 期间不强制用 generic Period Close 判 PARTIAL。

3. **OUT_OF_SCOPE_PRODUCT_BASELINE**

   仅允许用户已批准的明确产品基线项目：

   - Multi-Organization；
   - Multi-Currency；
   - 完整 B3105 PDA / camera SDK / label printing / generic PDA platform；
   - Finance engine rewrite；
   - Inventory ledger rewrite（含 invasive owner-dimension 改造）；
   - Generic Workflow redesign；
   - destructive data rewrite / DROP historical table / database reset；
   - 完整 Operation Outsourcing handoff lifecycle；
   - retroactive rewrite 历史 approved PO / Receipt / Bill / AP（PRC-10 硬性禁止）；
   - Standard Outsourcing 复用 VMI ownership semantics；
   - enterprise-supplied material 入 OUT-10 PO line；
   - supplier-owned finished stock 通过 OUT-19 VMI-style ownership transfer。

最终不得存在 `unexplained MISSING / PARTIAL / SEMANTIC_MISMATCH`。任何 unresolved disposition 必须以 Hard Stop Conditions 形式回退至 Requirement/Design 层重新审视，**不得**通过偷换 disposition 类别伪装覆盖。

---

#### A.1 Cross-Domain Dependency Boundary（acceptance dependency metadata，**不是** capability disposition）

Inventory & Warehouse Domain owns owner-dimensional physical inventory truth。本域通过该 dependency 把 owner-dimensional physical mutation 部分交给 Inventory Domain 实现。

dependency 被以下 capability 调用，但**仅针对其物理库存 owner-dimensional mutation 部分**：

| capability | Procurement 拥有 | Inventory 拥有 |
|---|---|---|
| VMI-02 Receiving | VMI receipt document、supplier / product / source、received quantity、business audit、idempotency / business lifecycle | post 入 supplier-owned physical stock；owner-dimensional availability 更新 |
| VMI-03 Consumption | consumption document、supplier / product / source、consumed quantity、settlement trace、business audit、idempotency / business lifecycle | deduct supplier-owned physical stock；owner-dimensional availability 更新 |
| VMI-05 Ownership Transfer | ownership-transfer business event、settlement quantity、supplier、source consumption、Supplier Bill handoff | physical owner change `supplier-owned → enterprise-owned` |

dependency 不进入 capability disposition 计数；它仅是 acceptance dependency metadata。54-capability accounting 仍 = 49 domain-owned + 5 integration-backed。

---

#### A.2 Explicit Invariants

- **VMI business-layer closure** `≠` **owner-dimensional Inventory closure**。本 Domain 完成 VMI business layer 不代表 Inventory owner-dimension 物理库存层就绪；二者验收分别独立。
- **Inventory owner-dimension dependency** `≠` **VMI-01~05 capability disposition substitute**。Inventory owner-dimension dependency 不得成为将 VMI-01~05 推迟或标 PARTIAL 的理由；本 Domain 必须独立完成 VMI business layer。
- **Capability disposition 穷尽且分类清晰**：任何 capability 必须落到 `Domain-owned source-backed` 或 `MUST INTEGRATE` 之一；不得以 `CROSS_DOMAIN_DEPENDENCY` 代替 disposition。
- **Cross-domain dependency 仅记录 metadata**：用于 traceability 与 acceptance dependency 校验，不计入 capability 分类。

#### B. Data / Schema

- 新增表 / column 全部 additive；既有表 / 字段无破坏；
- 既有的 SUPPLIER / `purchase_discounts` / Supplier Bill / AP / GRNI / IQC 表 / IBC 后续 schema 不破坏；
- SQLite / MySQL 8 schema parity；migration idempotent；
- Opening 期间 opening outsourcing order / opening outsourcing WIP 标记 `OPENING`；不虚构历史 accounting。

#### C. Security

- 所有 Procurement / Outsourcing mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- Source control override = permission + reason + audit；
- Audit 写入关键 PO / Receipt / Return / Outsourcing / VMI mutation。

#### D. Test

- Wave A focused：Procurement Parameters + Supplier Profile + Buyer；
- Wave B focused：Sourcing / Quota / Pricing；
- Wave C focused：PR / PO / PO Change / PO Execution；
- Wave D focused：Receipt Notice / Purchase Return 四分支 / Procurement Scan；
- Wave E focused：VMI business layer + Inventory owner dimension handshake；
- Wave F focused：Outsourcing Foundation（profile / source list / processing price / WIP warehouse / handoff / order / lifecycle / BOM）；
- Wave G focused：Outsourcing Materials（material list / PO / Issue / Supplement / Return / LOT-SERIAL / Backflush）；
- Wave H focused：Outsourcing Receiving / Finance Handoff（notice / inspection / inbound / processing fee AP / cost evidence / finished return）；
- Wave I focused：Period-End / WIP / Opening / Reports；
- Wave J focused：UI / mobile convergence；
- 全部 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency` + `pnpm test:mysql:performance`。

#### E. Concurrency critical sections

以下区域必须为 critical section（Design 决定具体 SQL / lock strategy；本阶段不设计 SQL）：

- Sourcing allocation；
- PR → PO；
- PO Change vs Receipt；
- PO → Receipt Notice；
- PO → Receipt；
- Receipt → Return；
- Receipt → Supplier Bill；
- Planning OUTSOURCE handoff → Outsourcing Order；
- Outsource Material Issue；
- Outsource Receipt；
- Processing Fee Bill；
- VMI Ownership Transfer。

#### F. UI / Mobile

- 实际 operator workflow（user task；Design 决定 UI 结构）：
  - PR → Sourcing → PO；
  - PO → Receipt Notice → IQC → Receipt；
  - Return Request → Purchase Return；
  - VMI policy → receipt / consumption → settlement / ownership transfer；
  - Planning OUTSOURCE → Outsourcing Order → Materials → Receiving → Processing Fee；
- Mobile-first：390 CSS px 为主；同时验证 320 / 430 / 680；
- LIST → DETAIL → EDITOR/WORKFLOW；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`；
- 不得修改业务术语、API、权限、状态机、Approval/Confirm/Post/Reverse、source/downstream、inventory/accounting facts。

#### G. Documentation / Log

- `document.md §22.1 / §22.21 / §31` 同步更新；
- `solution.md §26` 同步更新（Design；本阶段未开始）；
- `log/2026-10-08.md` 追加本 Domain Closure Requirement 完整记录；
- `README.md` 仓库地图与新增 page route / server module / 测试在 Design 完成后同步更新；
- `APPLY_GUIDE.md` 不动。

### 31.9 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization / Multi-Currency 需求出现；
2. 需要重写 Inventory / Quality / AP / GL / Period Close / Production backbone；
3. 需要 DROP historical table 或 destructive schema rewrite；
4. 需要把 enterprise-supplied material 作为 PO line 入 OUT-10；
5. 需要 retroactive rewrite 历史 approved PO / Receipt / Bill / AP；
6. 需要把 Standard Outsourcing 复用 VMI ownership semantics；
7. 需要把 supplier-owned finished stock 通过 OUT-19 建模为 VMI-style ownership transfer；
8. source semantics 不足导致 lower-tolerance auto-close / 截图级 forecast time-fence / 复杂 substitute 数量算法 / 完整 quota algorithm 不得不猜测；
9. MySQL migration 无法保证 parity；
10. 需要把 Outsource Material Issue / Return 通过 raw UPDATE inventory balance（绕过 canonical inventory transfer）；
11. 既有的 LEGACY_DIRECT 历史数据需要被反写以满足新默认；
12. 既有的 IQC / OQC / QCP / Production / Planning / Engineering canonical owner 必须被破坏。

### 31.10 最终接受状态

本节 Requirement 包含 26 + 5 + 23 = 54 项 Capability / 10 个 Wave / 11 个新增 permission family。本节 Requirement 完成；下游 Design 见 `solution.md §26`（本阶段未开始）。等待用户 PASS。

---

**PROCUREMENT & OUTSOURCING DOMAIN CLOSURE REQUIREMENT — COMPLETE / READY FOR USER REVIEW**

### 31.11 Definitive Final Acceptance Evidence（2026-10-09）

- Domain source-of-truth checkpoint：`1964648`；`document.md` / `solution.md` / `log/2026-10-08.md` 已独立提交，`APPLY_GUIDE.md` 保持用户原有 dirty state；
- Functional Browser UAT：真实 Playwright Chromium + browser-authenticated mutation，`25/28 PASS`；
- Responsive Browser UAT：7 surfaces × 4 widths（320 / 390 / 430 / 680）=`28/28 PASS`；
- Purchase Return 四分支 persisted voucher proof：LEGACY_DIRECT、SEPARATE unbilled、SEPARATE billed、10 received / 4 billed / 7 return 均 PASS；partial split = AP/commercial credit 4,000 cents + GRNI reversal 3,000 cents；
- OUT-21：`outsourcing_cost_evidences` 保存 consumed material carrying value、provisional fee、POSTED Supplier Bill actual fee、variance 与 `PROVISIONAL / FINAL`；
- OUT-22：unbilled finished return 不制造 AP credit；billed return 通过 canonical Supplier Credit Note + `applyCreditAdjustment` 降低 AP，并保存 receipt item / bill item / credit note trace；
- Focused inventory：12 files / 12 suites / 48 tests / 48 pass / 0 fail / 0 skipped / 0 todo；
- disposable MySQL 8.0.37：`test:mysql` PASS、`test:mysql:concurrency` 13/13 PASS、`test:mysql:performance` PASS（20 writers / 400 operations / 0 errors）；
- Final Acceptance blocker（不得 Freeze）：
  1. `UAT-15`：Outsourcing Order 接受任意 `planningHandoffId`，但未重读/更新 authoritative `planning_outsource_handoffs`；
  2. `UAT-21`：没有 executable Outsourcing Completion Receipt Notice contract；普通 Receipt Notice 对 Outsourcing source 返回 404/409；
  3. `UAT-22`：IQC API 只接受 Purchase Receipt，`OUTSOURCING_RECEIPT` source contract 返回 400。

因此本 Domain 当前状态为：`NOT READY`。其余 51 项不能抵消上述 3 项 acceptance failure；不得 Freeze。

#### 31.11.1 MySQL concurrency evidence correction（2026-10-09）

`pnpm test:mysql:concurrency` 在 disposable MySQL 8 上为 13/13 PASS，但现有 `server/mysql-phase7b-concurrency.integration.js` 只直接证明通用 row-lock / idempotency、合成的 Purchase Receipt / Supplier Bill / Material Issue 状态竞态及既有库存、结算、期间并发原语。它没有逐项执行本次最终验收指定的 Sourcing allocation、PR→PO、PO Change vs Receipt、Receipt Notice、Planning handoff、Outsourcing Receipt、Processing Fee partial bill、VMI Ownership Transfer 等真实 domain handler race。因此 MySQL gate PASS 不等于这 11 个指定场景已经全部具备 MySQL 实证；该差距是独立 Acceptance blocker，修复前同样不得 Freeze。

---

## 32. Inventory & Warehouse Domain Closure Requirement

> 本节固化 Inventory & Warehouse Domain Closure 的 Requirement 阶段成果。
>
> **Manual Evidence Baseline：**
> Primary = `B3104 库存管理`；Secondary = `B3105 条码管理`（仅取 Inventory/Warehouse 所属能力）。
> Boundary 手册 = `B3101` Procurement / `B3102` Sales / `B3106` Inventory Costing / `B3119` Manufacturing / `B3120` Planning / `B3121` Outsourcing，仅用于确定接口；不得重新打开冻结业务域。
>
> **本节 Coverage 以 Inventory & Warehouse Audit PASS 为准：**
> Audit = `PASS`；Requirement capability set = 44；Owner accounting = 40 Domain-Owned + 4 Integration-Backed；Requirement Only；Design 未开始；Implementation 未开始。
>
> Design 见 `solution.md §27`（待用户 PASS 后展开）；本阶段不进入 Design / Implementation / Migration / API / UI / Test 任一阶段。
>
> 已知 Domain Authority：
> - Inventory & Warehouse = **Physical Inventory Truth Owner**；
> - 不得建立第二套库存余额；
> - `warehouse / location != owner`；
> - 所有业务域最终使用同一 physical inventory truth。

### 32.1 范围与 ownership

#### 32.1.1 Inventory & Warehouse 拥有

Inventory & Warehouse 是以下能力的唯一 canonical owner：

- 库存参数（inventory parameters：update policy / negative-stock policy / tracking policy / warehouse control defaults）；
- Warehouse Master 与 Warehouse Attributes（bin-enabled / negative-stock policy / MRP participation / inventory-lock permission / active-inactive）；
- Warehouse Bin / Location（仓库内仓位）；
- Stock Status Master（AVAILABLE / HOLD-BLOCKED / INSPECTION-QUARANTINE 至少三类，具体最终枚举由 Design 决定）；
- Owner Dimension（ENTERPRISE / SUPPLIER / CUSTOMER 至少三类）；
- Canonical Physical Inventory Balance（足以表达 product + warehouse + bin + owner + stock status + lot + serial + expiry 的唯一库存身份）；
- Canonical Inventory Mutation Contract（所有 physical mutation 经统一语义：receipt / issue / return / transfer / adjustment / stocktake / scrap / VMI / outsourcing supplier-WIP）；
- Inventory Enable Date / Opening Inventory / Initialization Close；
- Entrusted Material Receipt（physical location = enterprise warehouse，owner = CUSTOMER）；
- Other Inventory Receipt / Other Inventory Issue（库存原生单据，不伪装成 Purchase Receipt / Sales Delivery / Production Issue）；
- Direct Transfer / Step Transfer (In-Transit)；
- Lot Adjustment（split / merge / identity adjustment，quantity 守恒）；
- Stock Status Adjustment（status 变化，quantity / owner / location 守恒）；
- Inventory Form / Attribute Conversion；
- Inventory Adjustment & Scrap；
- Lot / Expiry / Shelf-Life Control / Serial Control / Auxiliary Inventory Attributes；
- ABC Classification；
- Instant Inventory Query（按 product / warehouse / bin / owner / stock status / lot / serial）；
- Inventory Lock / Unlock（locked quantity 不得作为 available，audit + 防止超锁）；
- Regular Stocktake / Cycle Stocktake / Stocktake Difference & Gain-Loss；
- Inventory Period Close / Reopen（precheck / close / snapshot / closed-period mutation block / controlled reopen / audit）；
- Receipt / Issue Summary & Detail / Inventory Ledger / Inventory Aging / Slow-Moving Inventory；
- Inventory Alerts & Anomaly Analysis（minimum / maximum / safety / reorder point / expiry / negative-balance anomaly）；
- ABC & Serial Analysis；
- Barcode Rules / Parsing / Master（bounded barcode foundation）；
- Stocktake Scan / Instant Inventory Scan Query；
- Packing / Container Core（container / pack / unpack / whole-container transfer / partial-container transfer / container content inquiry；container 不得成为第二库存余额）。

#### 32.1.2 Inventory & Warehouse 不拥有

- AP / AR（Finance Operations Domain）；
- 最终财务 costing / GL / Voucher / Period Close（Finance Operations / Accounting & Analytics Domain）；
- MRP / Demand calculation / Reservation intent / Reservation document（Planning Domain）；
- 业务单据语义：Purchase Receipt / Purchase Return / Production Issue-Receipt / Outsourcing Issue-Receipt / Sales Delivery / Planning documents（各自业务域）；
- BOM / Substitute / Routing master（Master & Engineering Domain）；
- Production Order execution / Inspection / Operation Transfer（Manufacturing & Quality Domain）；
- Quality inspection decision（Quality 域所有，但 Quality 可触发 Stock Status 变化，Inventory 是状态 owner）；
- IQC / OQC 内部语义；
- 最终成本估值 / 差异 / voucher（Finance / Inventory Costing）；
- Multi-Organization / Multi-Currency（OUT_OF_SCOPE_PRODUCT_BASELINE）；
- 完整 B3105 PDA / camera SDK / label printing 平台 / 设备地址管理；
- Generic Workflow / Smart Accounting / Management Accounting / Generic no-code scan-config designer / 完整 WMS wave engine（OUT_OF_SCOPE）。

#### 32.1.3 Physical Inventory Identity

最终物理库存身份必须能够表达：

```text
Product
+ Warehouse
+ Bin / Location
+ Owner
+ Stock Status
+ Lot / Serial
+ Expiry
→ Physical Quantity
```

Inventory owns `where / how much / whose / what stock status / what lot/serial / what physical availability / how physical stock moves`。

### 32.2 Manual Evidence Baseline（摘要）

完整证据来自上游已批准的 B3104 + B3105。下表为关键 contract：

| 关键 contract | 含义 |
|---|---|
| One Physical Stock Truth | 全部业务域最终使用同一 physical inventory truth；禁止第二库存账 |
| `Location ≠ Ownership` | warehouse / location 与 owner 解耦；至少支持 enterprise-owned @ enterprise warehouse、enterprise-owned @ supplier-WIP warehouse、supplier-owned @ enterprise warehouse（VMI）、customer-owned @ enterprise warehouse（entrusted material） |
| Business Document ≠ Inventory Mutation | 采购 / 销售 / 生产 / 委外拥有业务单据；Inventory 提供唯一 physical mutation contract |
| `On-hand ≠ Reserved ≠ Available` | on_hand / reserved / available 必须分明；Planning owns reservation intent；Inventory owns physical availability projection |
| LOT / SERIAL Canonical | LOT、SERIAL、expiry 不得由各业务域重复维护 |
| Stock Status First-Class | 库存状态影响 availability / issue / shipment / transfer / reservation eligibility |
| Business Date / Period Authoritative | 库存动作服从业务日期与库存期间 |
| Quantity Truth ≠ Final Cost Truth | Inventory owns physical quantity；Finance owns final financial costing / accounting |
| Initialization Closure | 库存初始化必须有结束状态；结束后期初库存不可按普通草稿任意重写 |
| Stocktake Difference | 盘盈 / 盘亏必须通过 canonical physical mutation 生效；不得直接覆盖库存余额而无 movement evidence |
| Period Close | precheck → close → snapshot → closed-period mutation block → controlled reopen → audit |
| Negative Stock Policy | 按 inventory parameter 控制；不绕过物理约束 |
| VMI | supplier-owned @ enterprise warehouse，physical at enterprise site |
| Standard Outsourcing | enterprise-owned @ supplier-WIP warehouse，owner 不变 |
| Entrusted Material | customer-owned @ enterprise warehouse，受托料不得记成企业自有库存 |

### 32.3 Capability Audit Matrix（已审计）

44 capability IDs 按以下分类组织。后续 Design / Implementation 不得新增 ID：

#### 32.3.1 Foundation & Physical Stock

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-01 | Inventory Parameters | `MISSING → NEW` | Domain-Owned；库存参数至少覆盖 inventory update policy、negative-stock policy、tracking / expiry policy references、warehouse control defaults；不得与 Planning / Finance 参数混为一套 |
| INV-02 | Warehouse Master & Warehouse Attributes | `PARTIAL → ENHANCE` | Domain-Owned；既有仓库 CRUD 必须保留；扩展 bin / location enabled、negative-stock policy、MRP participation、inventory-lock permission、active / inactive |
| INV-03 | Warehouse Bin / Location | `MISSING → NEW` | Domain-Owned；支持仓库内仓位 / location；库存、查询、扫描及移动均可使用仓位维度 |
| INV-04 | Stock Status Master | `PARTIAL → NEW` | Domain-Owned；建立 canonical stock-status dimension（至少表达 AVAILABLE / HOLD-BLOCKED / INSPECTION-QUARANTINE）；具体最终枚举由 Design 决定；Quality 可以触发状态变化，Inventory 是状态 owner |
| INV-05 | Owner Dimension | `MISSING → NEW` | Domain-Owned；至少支持 ENTERPRISE / SUPPLIER / CUSTOMER；owner identity 不得由 warehouse 隐式推导；本能力解除 Domain 4 当前 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE` 依赖 |
| INV-06 | Canonical Physical Inventory Balance | `PARTIAL → CONVERGE` | Domain-Owned；余额从 `warehouse + product` 升级为足够表达完整库存身份的 canonical physical balance；不得产生第二库存账 |
| INV-07 | Canonical Inventory Mutation Contract | `PARTIAL → CONVERGE` | Domain-Owned；所有 receipt / issue / return / transfer / adjustment / stocktake / scrap / VMI / outsourcing supplier-WIP 最终统一通过 authoritative inventory mutation semantics 改变物理库存；业务域不能直接维护另一套 physical balance |
| INV-08 | Available Stock / Reservation Projection | `PARTIAL → ENHANCE` | **Integration-Backed — Planning**；Inventory 提供 on_hand / reserved / available；Planning 继续拥有 reservation intent 与 reservation documents；不得复制 Planning reservation engine |

#### 32.3.2 Initialization & Native Inventory Documents

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-09 | Inventory Enable Date | `MISSING → NEW` | Domain-Owned；正式库存启用日期；启用前 / 后的业务行为必须可确定 |
| INV-10 | Opening Inventory | `MISSING → NEW` | Domain-Owned；支持初始库存录入，含 warehouse / bin / owner / status / lot / serial / quantity；不得伪造历史采购 / 销售业务 |
| INV-11 | Initialization Close | `MISSING → NEW` | Domain-Owned；库存初始化必须有结束状态；结束后期初库存不可按普通草稿任意重写 |
| INV-12 | Entrusted Material Receipt | `MISSING → NEW` | Domain-Owned；物理 location = enterprise warehouse；owner = CUSTOMER；不得把受托料记成企业自有库存 |
| INV-13 | Other Inventory Receipt | `MISSING → NEW` | Domain-Owned；提供库存原生"其他入库"；不得伪装成 Purchase Receipt |
| INV-14 | Other Inventory Issue | `MISSING → NEW` | Domain-Owned；提供库存原生"其他出库"；不得伪装成 Sales Delivery / Production Issue |

#### 32.3.3 Inventory Movement & Conversion

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-15 | Direct Transfer | `COVERED → KEEP` | Domain-Owned；既有 transfer 必须保留；强化：owner 不变、stock identity 守恒、source decrease 与 destination increase 必须 single-effect；包含合法调拨退回 |
| INV-16 | Step Transfer / In-Transit | `MISSING → NEW` | Domain-Owned；支持 Transfer Out → IN_TRANSIT → Transfer In；适用于源仓与目标仓不能同时完成移动的业务；必须显式表示在途量 |
| INV-17 | Assembly & Disassembly | `MISSING → NEW` | **Integration-Backed — Engineering BOM**；支持库存层组装 / 拆卸；Engineering / BOM 是结构来源；Inventory owns physical consume / produce movement；不得创建第二 BOM truth；最终成本分摊仍归 Finance / Inventory Costing |
| INV-18 | Lot Adjustment | `PARTIAL → ENHANCE` | Domain-Owned；支持 lot split / lot merge / lot identity adjustment；数量守恒；不得借批号调整制造或销毁库存 |
| INV-19 | Stock Status Adjustment | `MISSING → NEW` | Domain-Owned；支持同一物理库存 status A → status B；数量、owner、location 必须守恒 |
| INV-20 | Inventory Form / Attribute Conversion | `MISSING → NEW` | Domain-Owned；支持手册中的形态转换语义；库存数量必须守恒；辅助属性 / BOM 版本 / 计划跟踪号等 metadata 的 canonical owner 不得被复制 |
| INV-21 | Inventory Adjustment & Scrap | `COVERED → KEEP` | Domain-Owned；保留并收敛已有 Inventory Adjustment / Inventory Scrap；必须使用 canonical inventory identity、tracking、period、valuation integration |

#### 32.3.4 Tracking & Inventory Control

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-22 | Lot Control | `COVERED → KEEP` | Domain-Owned；保留现有 LOT canonical capability；支持 lot master / lot balance / source provenance / movement trace / availability control |
| INV-23 | Expiry / Shelf-Life Control | `COVERED → KEEP` | Domain-Owned；支持 manufacture date / expiry date / expired identification / outbound eligibility / warning；不得由 Barcode 再建第二套 expiry truth |
| INV-24 | Serial Control | `COVERED → KEEP` | Domain-Owned；保留 canonical SERIAL identity；支持 unique identity / current physical position / lifecycle state / movement trace |
| INV-25 | Auxiliary Inventory Attributes | `MISSING → NEW` | Domain-Owned；库存身份允许使用必要的辅助属性；Master Data 可拥有属性定义；Inventory owns these attributes as physical-stock dimensions where required |
| INV-26 | ABC Classification | `MISSING → NEW` | Domain-Owned；支持物料 ABC 分类，并能作为周期盘点策略输入；涉及金额 / 成本的分类基础只读取 Finance canonical evidence |
| INV-27 | Instant Inventory Query | `PARTIAL → ENHANCE` | Domain-Owned；即时库存必须支持汇总 / 明细查询；至少可按 product / warehouse / bin / owner / stock status / lot / serial 查询 |
| INV-28 | Inventory Lock / Unlock | `PARTIAL → ENHANCE` | Domain-Owned；支持锁库 / 解锁；locked quantity 不得继续作为普通 available stock 使用；必须可审计并防止超锁 |

#### 32.3.5 Stocktake & Period Control

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-29 | Regular Stocktake | `COVERED → KEEP` | Domain-Owned；支持定期盘点计划 / 作业；实际盘点数与账存数必须分离保存 |
| INV-30 | Cycle Stocktake | `MISSING → NEW` | Domain-Owned；支持周期盘点；可使用 ABC 分类 / 周期策略决定盘点范围 |
| INV-31 | Stocktake Difference & Gain/Loss | `PARTIAL → ENHANCE` | Domain-Owned；盘盈 / 盘亏必须通过 canonical physical mutation 生效；不得直接覆盖库存余额而无 movement evidence |
| INV-32 | Inventory Period Close / Reopen | `COVERED → KEEP` | Domain-Owned；保留现有库存期间能力；要求 precheck / close / snapshot / closed-period mutation block / controlled reopen / audit |

#### 32.3.6 Inventory Reports & Alerts

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-33 | Receipt / Issue Summary & Detail | `PARTIAL → ENHANCE` | Domain-Owned；覆盖物料收发汇总 / 物料收发明细 / 业务分类统计；数量来自 canonical inventory movements |
| INV-34 | Inventory Ledger | `COVERED → KEEP` | Domain-Owned；支持 opening / receipt / issue / closing；按业务日期形成可追溯库存台账 |
| INV-35 | Inventory Aging | `MISSING → NEW` | Domain-Owned；按现存库存形成账龄分析；不得使用虚构库存数量；成本金额如展示，读取 Finance canonical valuation |
| INV-36 | Slow-Moving Inventory | `MISSING → NEW` | Domain-Owned；支持基于真实收发历史识别 long-time no movement / receipt-only-no-issue 等呆滞库存 |
| INV-37 | Inventory Alerts & Anomaly Analysis | `MISSING → NEW` | Domain-Owned；必须覆盖 minimum stock / maximum stock / safety stock / reorder point / expiry / negative-balance anomaly；不得以 stale `products.stock_quantity` 为库存事实 |
| INV-38 | ABC & Serial Analysis | `MISSING → NEW` | Domain-Owned；提供 ABC analysis / serial master / current state / trace lookup；复用 canonical ABC / SERIAL data |

#### 32.3.7 Barcode / Warehouse Scan Core

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-39 | Barcode Rules / Parsing / Master | `MISSING → NEW` | Domain-Owned；支持 bounded barcode foundation：master lookup / dynamic parse / material identity / quantity / lot / serial / warehouse / bin identity；不要求复刻完整打印平台 |
| INV-40 | Scan-to-Document Adapter | `MISSING → NEW` | **Integration-Backed — Business Domains**；支持条码扫描 source document → target document draft / no-source inventory-native document draft；目标单据仍由对应 Domain 拥有（如 PO → Purchase Receipt、SO / Delivery → outbound validation、inventory-native Other Receipt）；不得用 Barcode 模块复制业务单据 |
| INV-41 | Inbound / Outbound Scan Validation | `MISSING → NEW` | **Integration-Backed — Business Domains**；扫描验证 document / product / quantity / warehouse / bin / lot / serial / expiry / stock eligibility；Barcode / Inventory 执行 physical validation；目标业务状态仍由原业务 Domain 决定 |
| INV-42 | Stocktake Scan | `MISSING → NEW` | Domain-Owned；支持 scan product / warehouse / bin / lot / serial / quantity → canonical Stocktake；不创建第二盘点系统 |
| INV-43 | Instant Inventory Scan Query | `MISSING → NEW` | Domain-Owned；支持扫描 product barcode / warehouse / bin barcode / lot / serial 查询即时库存 |
| INV-44 | Packing / Container Core | `MISSING → NEW` | Domain-Owned；只实现 bounded warehouse packing relation：container / package identity / pack / unpack / whole-container transfer / partial-container transfer / container content inquiry；container 不能成为第二库存余额；真实库存仍以 canonical inventory identity 为准 |

### 32.4 Owner Accounting — FROZEN

```text
Domain-Owned       40
Integration-Backed 4:
  INV-08 Planning Reservation
  INV-17 Engineering BOM
  INV-40 Business Document Scan Adapter
  INV-41 Business Document Validation

TOTAL              44
```

后续 Design / Implementation 不得增加新 ID；不得把 Integration-Backed capability 升级为 Domain-Owned（除非后续 Domain Closure 重新授权）；不得把 Domain-Owned capability 降级为 Integration-Backed。

Integration-Backed capability 的语义：

- **INV-08** Available Stock / Reservation Projection：Planning owns reservation intent 与 reservation documents；Inventory 提供 on_hand / reserved / available 三层投影，并保证 reservation 不会让 physical availability 越过真实 on_hand；不复制 Planning reservation engine。
- **INV-17** Assembly & Disassembly：Engineering / BOM 是结构与 component 关系的 canonical owner；Inventory 拥有物理 consume / produce movement；最终成本分摊归 Finance / Inventory Costing。
- **INV-40** Scan-to-Document Adapter：Business Domains 拥有目标单据；Inventory / Barcode 提供 bounded scan source-document resolution 与 draft payload 生成；不得复制业务单据语义。
- **INV-41** Inbound / Outbound Scan Validation：Inventory 执行 physical validation（eligibility / identity / quantity / location / lot / serial / expiry）；Business Domains 决定业务状态与单据 lifecycle。

### 32.5 Frozen Core Invariants

Requirement 必须保持以下 invariant，Design / Implementation 不得破坏：

#### I1 — One Physical Stock Truth

所有业务域最终使用同一 physical inventory truth。禁止第二库存账。

#### I2 — Location ≠ Ownership

```text
warehouse / location
!=
owner
```

必须支持至少：

```text
Enterprise-owned @ enterprise warehouse
Enterprise-owned @ supplier-WIP warehouse
Supplier-owned @ enterprise warehouse         // VMI
Customer-owned @ enterprise warehouse         // entrusted material
```

#### I3 — Business Document ≠ Inventory Mutation

采购 / 销售 / 生产 / 委外拥有自己的业务单据；Inventory 提供唯一 physical mutation contract。

#### I4 — On-hand ≠ Reserved ≠ Available

```text
on_hand
reserved
available
```

Planning owns reservation intent；Inventory owns physical availability projection。

#### I5 — LOT / SERIAL Is Canonical

LOT、SERIAL、expiry 不得由各业务域重复维护。

#### I6 — Stock Status Is First-Class

库存状态影响 availability / issue / shipment / transfer / reservation eligibility。

#### I7 — Business Date / Period Is Authoritative

库存动作必须服从业务日期与库存期间。

#### I8 — Quantity Truth ≠ Final Cost Truth

Inventory owns physical quantity；Finance owns final financial costing / accounting。

### 32.6 Existing Capabilities Must Be Preserved

Requirement 明确现有成熟能力属于 convergence，不得重写：

- warehouse CRUD；
- direct inventory；
- inventory transactions；
- inventory transfer；
- stocktake；
- inventory adjustment；
- inventory scrap；
- LOT；
- SERIAL；
- expiry；
- HOLD；
- traceability；
- inventory valuation integration；
- inventory period close / reopen；
- business-date protection。

目标是增强 canonical dimensions，不是另造一套库存模块。

### 32.7 Explicit Cross-Domain Boundaries

#### 32.7.1 Planning

Planning owns：

```text
reservation intent
MRP
planning supply / demand
```

Inventory owns：

```text
physical on-hand
physical eligibility
available projection
```

INV-08 是唯一授权的 Planning ↔ Inventory 接口面；不得引入第二套 reservation / availability engine。

#### 32.7.2 Procurement / Sales / Manufacturing / Outsourcing

这些域拥有业务单据。Inventory 只拥有最终 physical mutation。

不得重新设计已经冻结的：

```text
Purchase Receipt
Purchase Return
Production Issue / Receipt
Outsourcing Issue / Receipt
Planning documents
```

VMI 的 business layer 由 Procurement 完成；Inventory 仅负责 owner-dimensional physical mutation；VMI-02 / VMI-03 / VMI-05 的 physical 部分属于 INV-05 / INV-06 / INV-07。

#### 32.7.3 Quality

Quality owns：

```text
inspection decision
```

Inventory owns：

```text
physical stock status
availability consequence
```

INV-04 / INV-19 由 Quality 触发但 Inventory 是 canonical owner。

#### 32.7.4 Engineering

Engineering owns BOM / Substitute / Routing master。INV-17（Assembly / Disassembly）消费 Engineering BOM resolver，不创建第二 BOM truth。

#### 32.7.5 Finance / Inventory Costing

Finance owns：

```text
valuation policy
final cost
variance
voucher
GL
```

Inventory 可以调用 canonical valuation evidence，但不得建立第二套 costing engine。

### 32.8 Explicit Out of Scope

以下 B3105 内容不进入 Domain 5 Core Requirement：

- printer / device address management；
- 完整 barcode label-printing 平台；
- fixed-asset barcode stocktake；
- manufacturing operation reporting scan（Manufacturing & Quality 已 `COVERED`）；
- operation-transfer scan；
- independent Quality barcode workflow；
- generic no-code scan-config designer；
- advanced multi-user scan orchestration；
- automatic scan-task assignment engine；
- full merged-picking / WMS wave engine；
- three-level packaging printing。

未来可以作为 WMS / Barcode enhancement。本次不得因为手册存在就扩展进去。

其它 Out of Scope：

- Multi-Organization / Multi-Currency（`OUT_OF_SCOPE_PRODUCT_BASELINE`）；
- Finance engine rewrite / Generic Workflow redesign；
- 禁止建立、替换或并行维护第二套 Physical Inventory Ledger。
  - INV-34 Inventory Ledger 仍属于 Domain 5 Core Requirement；
  - 其 opening / receipt / issue / closing read model 必须从 canonical inventory balances + movements 派生；
  - 不得成为第二库存余额；
- retroactive rewrite 历史库存 / 收货 / 凭证；
- 第二库存账 / 第二 Inventory mutation engine / 第二 costing engine / 第二 UOM engine / 第二 expiry truth；
- Complete WMS / Advanced Logistics / Complete APS / Complete MES / HMI。

Schema Migration 行为明确（避免误解为禁止正常 schema migration）：

```text
禁止：
- 删除业务历史
- reset production / business data
- destructive rewrite with semantic data loss
- 为重构方便清空历史库存

允许：
- additive migration
- idempotent migration
- transactional table rebuild where SQLite requires it
- data-preserving constraint / index reconstruction

前提：
- existing business facts preserved
- before / after reconciliation
- rollback / fail-closed on mismatch
- SQLite / MySQL parity
```

### 32.9 Acceptance Criteria

#### A. Functional

INV-01~13 inventory parameters 全部启用且 effective；warehouse attributes 全部支持；stock-status dimension 至少 AVAILABLE / HOLD-BLOCKED / INSPECTION-QUARANTINE 三类最终生效；owner dimension 至少 ENTERPRISE / SUPPLIER / CUSTOMER 三类最终生效；canonical physical inventory balance 在全部 mutation / query / report 路径上唯一。

INV-15~17 三类 transfer 行为正确：direct transfer（owner 不变、stock identity 守恒）、step transfer（source → IN_TRANSIT → destination 在途量显式）、assembly / disassembly（消费 Engineering BOM resolver）；INV-18 / INV-19 / INV-20 / INV-21 数量、owner、location、status 守恒。

INV-22~26 LOT / expiry / serial / auxiliary / ABC 全部支持；INV-27 即时库存查询至少按 product / warehouse / bin / owner / stock status / lot / serial 路径返回；INV-28 lock 数量不进入 available。

INV-29~32 定期盘点 / 周期盘点 / 盘盈盘亏 / 期间关闭 reopen 全部覆盖；盘盈盘亏必须经 INV-07 canonical mutation。

INV-33~38 报表 / 库存台账 / 库龄 / 呆滞 / 预警 / ABC / 序列号追溯 / anomaly 全部产出真实数据；不得使用 stale `products.stock_quantity` 作为库存事实。

INV-39~44 Barcode / 扫描适配 / 校验 / 盘点扫码 / 即时库存扫码 / 包装容器 全部 bounded 完成；INV-40 / INV-41 不得复制业务单据；INV-44 container 不得成为第二库存余额。

INV-08 必须提供 on_hand / reserved / available 三层投影；reservation 不会越过真实 on_hand；不得复制 Planning reservation engine；INV-17 必须消费 Engineering BOM resolver。

#### A.1 Acceptance-Level Business Invariants

```text
VMI:
  Supplier-owned @ Enterprise warehouse
  must become representable

Outsourcing:
  Enterprise-owned @ Supplier-WIP warehouse
  must remain representable

Entrusted Material:
  Customer-owned @ Enterprise warehouse
  must become representable
```

以及：

```text
warehouse transfer:
  location changes
  owner does not

ownership transfer:
  owner changes
  location may not

stock-status adjustment:
  status changes
  quantity / location / owner do not

lot adjustment:
  lot identity changes
  total quantity does not

step transfer:
  source → in-transit → destination
  quantity conserved
```

#### B. Data / Schema

- 新增表 / column 全部 additive；既有表 / 字段无破坏；既有 LOT / SERIAL / 库存事务 / 库存台账 schema 完整保留；
- INV-04 stock-status、INV-05 owner、INV-03 bin、INV-09 enable date、INV-10/11 opening 与 initialization close、INV-16 in-transit、INV-28 lock、INV-30 cycle stocktake、INV-35 aging、INV-36 slow-moving、INV-37 alert、INV-39 barcode master、INV-44 container 等新增结构必须使用 structured rows；snapshot / log payload 可使用 bounded JSON；不得用 generic JSON 替代 core identity；
- SQLite / MySQL 8 schema parity；migration idempotent；既有 release tag `v1.6.2` 不破坏；
- Inventory Opening 期间 `OPENING` 标记；不虚构历史采购 / 销售凭证；
- 历史库存表 / 库存事务 / 库存台账不破坏；不得 DROP historical inventory table；不 retroactive rewrite 历史库存余额。

#### C. Security

- 所有 inventory mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- INV-28 锁库必须 backend permission + audit；防止超锁；
- Audit 写入关键 inventory mutation（receipt / issue / return / transfer / adjustment / stocktake / scrap / VMI / outsourcing supplier-WIP / lock / unlock / period close / period reopen）；
- INV-04 stock-status 变更必须 audit；
- INV-05 owner 变更必须 audit。

#### D. Test

- INV-01~02 inventory parameters + warehouse attributes focused；
- INV-03~05 bin / stock-status / owner dimension focused；
- INV-06~07 canonical physical balance + mutation contract focused；
- INV-08 reservation / available projection focused（与 Planning 协作）；
- INV-09~11 initialization + opening + close focused；
- INV-12~14 entrusted / other receipt / other issue focused；
- INV-15~16 direct + step transfer focused；
- INV-17 assembly / disassembly focused（消费 Engineering BOM resolver）；
- INV-18~21 lot / status / form conversion / adjustment / scrap focused；
- INV-22~28 lot / expiry / serial / auxiliary / ABC / instant query / lock focused；
- INV-29~32 stocktake + period focused；
- INV-33~38 reports + alerts focused；
- INV-39~44 barcode + scan + packing focused；
- 全部 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency` + `pnpm test:mysql:performance`。

#### E. Concurrency critical sections

以下区域必须为 critical section（Design 决定具体 SQL / lock strategy；本阶段不设计 SQL）：

- inventory mutation（含 receipt / issue / return / transfer / adjustment / scrap）；
- inventory direct transfer / step transfer in-transit handoff；
- inventory owner mutation（VMI receipt / VMI consumption / VMI ownership transfer / outsourcing supplier-WIP position movement / entrusted material receipt）；
- inventory stock-status mutation（含 Quality 触发）；
- inventory lot adjustment（split / merge / identity）；
- inventory lock / unlock（防超锁）；
- inventory stocktake difference mutation；
- inventory period close / reopen；
- inventory assembly / disassembly（消费 BOM resolver，库存 consume / produce）；
- planning reservation vs inventory availability（INV-08）。

#### F. UI / Mobile

- 实际 operator workflow（user task；Design 决定 UI 结构）：
  - 即时库存查询（按 product / warehouse / bin / owner / stock status / lot / serial）；
  - 入库 / 出库 / 调拨（direct + step + IN_TRANSIT）；
  - 库存状态调整（HOLD / RELEASE / 待检）；
  - 库存锁定 / 解锁；
  - 盘点（定期 / 周期）；
  - 库存初始化 + opening + close；
  - 受托料登记 / 其他入库 / 其他出库；
  - 形态转换 / 批号调整 / 库存调整 / 报废；
  - 库龄 / 呆滞 / 预警 / ABC / 序列号追溯；
  - Barcode / 扫码查询 / 盘点扫码 / 收发货扫码；
  - 包装 / 拆包 / 容器转移 / 容器内容查询。
- Mobile-first：390 CSS px 为主；同时验证 320 / 430 / 680；
- LIST → DETAIL → EDITOR / WORKFLOW；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`；
- 不得修改业务术语、API、权限、状态机、Approval / Confirm / Post / Reverse、source / downstream、inventory / accounting facts。

#### G. Documentation / Log

- `document.md §22.4 / §22.5 / §32` 同步更新；
- `solution.md §27` 同步更新（Design；本阶段未开始）；
- `log/2026-10-10.md` 追加本 Domain Closure Requirement 完整记录；
- `README.md` 仓库地图与新增 page route / server module / 测试在 Design / Implementation 完成后同步更新；
- `APPLY_GUIDE.md` 不动。

### 32.10 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization / Multi-Currency 需求出现；
2. 需要重写 Procurement / Sales / Quality / Production / Planning / Engineering canonical owner；
3. 需要 DROP historical inventory table 或 destructive schema rewrite；
4. 需要把 INV-04 stock-status 与 Quality inspection decision 合并；
5. 需要把 INV-05 owner 由 warehouse 隐式推导；
6. 需要 retroactive rewrite 历史库存余额 / 库存台账；
7. 需要把 Standard Outsourcing 复用 VMI ownership semantics；
8. 需要把受托料记成企业自有库存；
9. source semantics 不足导致 inventory aging algorithm / slow-moving algorithm / ABC classification algorithm 不得不猜测；
11. MySQL migration 无法保证 parity；
12. 需要通过 raw UPDATE inventory balance（绕过 canonical inventory transfer）；
13. 既有的 INV-15 transfer / INV-22 LOT / INV-24 SERIAL / INV-32 period close canonical owner 必须被破坏；
14. INV-44 container 必须成为第二库存余额；
15. INV-40 / INV-41 必须复制业务单据语义；
16. INV-08 必须复制 Planning reservation engine。

### 32.11 最终接受状态

本节 Requirement 包含 44 项 Capability / Owner accounting = 40 Domain-Owned + 4 Integration-Backed（INV-08 Planning / INV-17 Engineering BOM / INV-40 Business Document Scan Adapter / INV-41 Business Document Validation）。

本节 Requirement 完成；下游 Design 见 `solution.md §27`（本阶段未开始）。等待用户 PASS。

---

**INVENTORY & WAREHOUSE DOMAIN CLOSURE REQUIREMENT — COMPLETE / READY FOR USER REVIEW**

---

## 33. Finance Operations Domain Closure Requirement

> 本节固化 Finance Operations Domain Closure 的 Requirement 阶段成果。
> Manual Evidence Baseline 来自上游已批准的 B3108 / B3109 / B3110 / B3111 / B3112 / B3113 + 支撑手册 B3101 / B3102 / B3106（Accounting & Analytics）/ B3121 / B3114。
> 本节 Coverage 以 2026-10-10 Finance Operations Domain Audit PASS 为准。
> 已知 Audit Semantic Blocker（R.1 — R.11）已固化为本节 Requirement 目标。
>
> Design 见 `solution.md §28`（待用户 PASS 后展开）；本阶段不进入 Design / Implementation / Migration / API / UI / Test 任一阶段。
>
> 本节明确消除 B3108 / B3109 / B3110 / B3111 中的 LEGACY_DIRECT 双识别歧义，并通过冻结三种识别模型收尾 AR / AP 事实。

### 33.1 范围与 ownership

#### 33.1.1 Finance Operations 拥有

Finance Operations 是以下能力的唯一 canonical owner：

- AR / AP operational open-item truth（`account_receivables` / `account_payables` open-item 模型 + canonical equation + invariant F1）；
- Collections / Settlement / Allocation / Reconciliation（payment_collections / payment_disbursements / payment_*_items / financial_credit_adjustments / balance_applications）；
- Advance Receipt / Prepayment / Refund / Write-off / Bad-debt operational facts；
- Sales / Purchase operational invoice truth（`sales_invoices` / `supplier_bills` / `commercial_credit_notes` 内部发票事实）；
- Cash / Bank operational movement truth（`settlement_account_movements` 单一 canonical movement ledger + reconciliation）；
- Treasury operations（bank / cash / settlement account / treasury initialization）；
- Bank statement / Bank reconciliation（外部银行证据 + 匹配 evidence）；
- AR / AP / Treasury 业务关账（独立于会计期间关账）；
- Operational Finance Reports（AR / AP / Treasury 报表）。

#### 33.1.2 Finance Operations 不拥有

- customer / supplier 商业 lifecycle（Sales & Customer / Procurement & Outsourcing）；
- sales / purchase source documents（同上）；
- 实物库存 truth（Inventory & Warehouse — FROZEN）；
- 存货核算 / 估值 ledger authoritative（Accounting & Analytics — B3106 / B3107）；
- 固定资产 lifecycle / depreciation authoritative GL（Accounting & Analytics — B3107）；
- voucher engine / GL / 期间结账 / 财务报表 / 经营会计（Accounting & Analytics — B3114 / B3115 / B3116 / B3117）；
- Multi-Org / Multi-Currency / Hedging / Loan / Cash Pooling / SWIFT 集成（OUT_OF_SCOPE）；
- 法定电子发票 / 税务申报硬件集成（OUT_OF_SCOPE）。

#### 33.1.3 B3106 / B3107 Ownership Correction（normalization）

**Freeze B3106 存货核算 与 B3107 固定资产 归属 `Accounting & Analytics`，不再属于 Finance Operations。**

事实上的当前 route 注册（`product-costs / cost-rates / fixed-assets` 当前 `domain='finance-operations'`）保留为 architectural debt，**本 Requirement 阶段不得实施移动**。后续 Domain Alignment 阶段须在遵循 `document.md §27` 与 `AGENTS.md §27` 兼容性约束的前提下单独调整。

`document.md §14` Manual → Domain 主映射表已同步：
- B3106 → Accounting & Analytics
- B3107 → Accounting & Analytics

`document.md §22.6` / `§22.7` Capability Audit Matrix baseline Coverage 表已同步：`*主要目标 Domain：Accounting & Analytics*`。

### 33.2 Canonical Recognition Models

本 Requirement 冻结三种 AR / AP recognition model。Legacy LEGACY_DIRECT / SEPARATE / AUTO_BILL 实现命名须由 Design 阶段映射到下述三种 canonical model。

```text
DIRECT_BUSINESS_OPEN_ITEM
INVOICE_DRIVEN_OPEN_ITEM
PROVISIONAL_TO_FINANCIAL
```

#### 33.2.1 DIRECT_BUSINESS_OPEN_ITEM

语义：
- 已确认销售出库 → 最终 AR；
- 已确认采购收货 → 最终 AP；
- 后续发票 / 账单 = 关联既有最终 AR / AP（link 而非新建）；
- 不允许：同一经济事件产生两笔最终暴露。

Invariant：
```text
one economic event → one final exposure
```

#### 33.2.2 INVOICE_DRIVEN_OPEN_ITEM

语义：
- 销售出库 / 采购收货仅产生 operational evidence（无 AR / AP）；
- 过账销售发票 → 最终 AR；
- 过账采购发票 / 账单 → 最终 AP。

Invariant：
- delivery / receipt 保持 operational evidence 身份，不被当作 AR / AP 替代品。

#### 33.2.3 PROVISIONAL_TO_FINANCIAL

语义（以 AP 为例）：
- 采购收货 → Provisional AP；
- 供应商发票到达 → provisional item 反向 / 转换；
- 同时创建最终发票 → 最终 Financial AP。

AR 等价：
- 出库 / 配置源 → Provisional AR；
- 销售发票 → provisional 反向 + 转换；
- 最终 Financial AR 形成。

Invariant：
- provisional 暴露 + financial 暴露 **不得** double-count 同一经济义务；
- 普通 settlement eligibility 仅限 final / financial open item，除非未来 Requirement 显式放宽。

### 33.3 AR / AP Canonical Equation

```text
open amount
=
original amount
- return / credit effects
- discount effects
- other approved credit effects
- cash allocations
- unapplied-balance applications
- write-offs
+ valid reversals
```

不允许：第二套独立可写 AR / AP 余额。
cached columns 仅作为 derived / cache projection。
canonical facts 必须可重算 reconcile。

### 33.4 Final Capability Catalogue

```text
Total = 58
Domain-Owned       = 55
Integration-Backed = 3
```

```text
FO50 Treasury ↔ GL Reconciliation                 [INTEGRATION-BACKED]
FO57 Source Business Document Adapter             [INTEGRATION-BACKED]
FO58 Accounting Event / Voucher Adapter           [INTEGRATION-BACKED]
```

后续 Design / Implementation 不得新增 Finance Operations capability ID；如需新增，必须重开 Requirement。
Integration-Backed 不得升级为 Domain-Owned；Domain-Owned 不得降级为 Integration-Backed。

### 33.5 Capability IDs

#### 33.5.1 Foundation / Recognition

```text
FO01 Finance Operations Parameters
FO02 Recognition Mode Policy
FO03 Collection / Payment Terms
FO04 Multi-Due-Date Schedule
FO05 Settlement / Reconciliation Scheme

FO06 AR Initialization
FO07 AP Initialization
FO08 Treasury Initialization

FO09 Final AR Open Item
FO10 Final AP Open Item

FO11 Provisional AR
FO12 Provisional AP
FO13 Provisional → Financial Conversion / Reversal

FO14 Other / Manual AR & AP
FO15 AR / AP Counterparty Transfer
```

#### 33.5.2 Settlement

```text
FO16 Collection Document
FO17 Payment Document

FO18 Explicit Settlement Allocation
FO19 Automatic / Scheduled Reconciliation
FO20 Manual / Special Reconciliation
FO21 Settlement Records & Trace

FO22 Settlement Reversal

FO23 Advance Receipt / Prepayment
FO24 Unapplied Credit / Prepayment Balance
FO25 Unapplied Balance Application
FO26 Collection / Payment Refund
     (Unapplied Balance Refund)

FO27 Financial Write-off
FO28 Bad-Debt Provision
```

#### 33.5.3 Invoice Operations

```text
FO29 Sales Invoice
FO30 Purchase / Input Invoice

FO31 Invoice Source Cardinality / Partial / Split
FO32 Invoice ↔ AR/AP Reconciliation

FO33 Credit / Red Invoice
FO34 Invoice Void / Cancel
FO35 Input-Invoice Verification / Certification
FO36 Invoice Operational Reports
```

#### 33.5.4 Treasury

```text
FO37 Settlement Account Master
FO38 Settlement Method / Purpose Master

FO39 Canonical Treasury Movement

FO40 Cash Deposit / Withdrawal
FO41 Internal Bank Transfer

FO42 Notes Receivable
FO43 Notes Payable
FO44 Payment Request

FO45 Cash Count

FO46 Bank Statement Header + Lines
FO47 Bank Statement Import
FO48 Bank Reconciliation
FO49 Unmatched Bank Items
```

#### 33.5.5 Business Close / Reporting

```text
FO50 Treasury ↔ GL Reconciliation              [INTEGRATION-BACKED]

FO51 AR Business Close
FO52 AP Business Close
FO53 Treasury Business Close

FO54 AR Reports
FO55 AP Reports
FO56 Treasury Reports
```

#### 33.5.6 Cross-Domain Integration

```text
FO57 Source Business Document Adapter          [INTEGRATION-BACKED]
FO58 Accounting Event / Voucher Adapter        [INTEGRATION-BACKED]
```

### 33.6 FO01 — Finance Operations Parameters

至少包含 policy-level configuration：

```text
recognition model          (DIRECT_BUSINESS / INVOICE_DRIVEN / PROVISIONAL_TO_FINANCIAL)
business enable date
settlement tolerance
default collection / payment terms
refund / write-off controls
provisional mode controls
```

不允许包含 Accounting & Analytics 配置（如 GL voucher 架构、科目 mapping）。

### 33.7 FO03 / FO04 — Terms and Due Schedule

一个 payment / collection term 可生成 1..n schedule lines。每个 schedule line 概念上包含：

```text
due date
amount / ratio
remaining amount
status
```

Invariant：

```text
sum(schedule amounts) == open item contractual amount
```

不允许把 multi-due-date terms 退化为单一 `due_date` 列。

### 33.8 FO06–FO08 — Initialization

AR initialization：

```text
enable date
opening AR
opening other AR
opening collection / refund facts where applicable
end initialization
```

AP 等价。

Treasury initialization：

```text
enable date
opening cash account balances
opening bank balances
enterprise-side outstanding bank items
bank-side outstanding items
end initialization
```

Initialization 不得伪造正常日常交易历史。

### 33.9 FO09 / FO10 — Final Open Items

Final AR / AP 必须保留：

```text
party
source type / id / no
business date
currency scope if supported
original amount
due schedule
recognition mode
financial / provisional state
current open amount
status
trace
```

已确认历史 source identity 不得 casual 重写。

### 33.10 FO11–FO13 — Provisional Mode

Provisional items 是 first-class facts。**不得**仅以：

```text
ordinary SALES_DELIVERY AR
ordinary PURCHASE_RECEIPT AP
```

加 undocumented flag 表示。

Required relation：

```text
business source
→ provisional item
→ financial invoice
→ conversion / reversal evidence
→ financial open item
```

Conversion 必须保留 traceability。**不允许**硬删除。

### 33.11 FO14 — Other / Manual AR & AP

允许合法的非销售 / 非采购 operational receivable / payable 创建。要求：

```text
explicit reason
party
business date
amount
source / reference
audit
approval / confirmation state
```

不得成为绕过 source controls 的静默通道。

### 33.12 FO15 — AR / AP Transfer

Transfer 含义：

```text
remaining open amount
Party A
→ Party B
```

with explicit transfer document / evidence。必须保留：

```text
total exposure
source history
transfer chain
remaining amount
business date
actor
reason
```

不允许原地 mutate 原 counterparty。

### 33.13 FO16–FO22 — Settlement Truth

Collection / Payment lifecycle：

```text
DRAFT → CONFIRMED → optional PARTIAL / FULL REVERSAL
```

已 confirmed documents 不得硬删除。

Allocation 支持：

```text
one settlement → many open items
many settlements → one open item
partial amount
```

不允许 over-allocation。所有 confirm / reversal 操作要求 idempotency。

### 33.14 FO19 / FO20 — Reconciliation Schemes

支持业务语义等价于：

```text
direct
automatic / scheduled
manual / special
```

这些是 matching strategies。**不得**创建第二套 AR / AP 真相。

### 33.15 FO23–FO26 — Unapplied Money

Advance receipt / Prepayment **不是**普通 AR / AP settlement。

Canonical flow：

```text
cash received / paid → unapplied balance

then either:
apply to open item
or
refund
```

明确保持分离：

```text
Settlement Reversal
!= Unapplied-Balance Refund
```

两者保留独立 evidence。

### 33.16 FO27 / FO28 — Write-off / Bad Debt

Write-off：

```text
confirmed operational reduction of an open item
```

with：

```text
reason
amount
approval
reversal
accounting integration
```

Bad-debt provision 独立于 write-off。至少支持：

```text
aging-based provision
individual-assessment provision
provision reversal / reduction
```

**不允许**建设完整 IFRS / ECL engine。

### 33.17 FO29–FO36 — Invoice Truth

Operational invoice 独立于：

```text
AR / AP
cash settlement
voucher
```

Invoice 必须保留：

```text
counterparty
source document lines
quantity
price
tax snapshot
gross / net / tax
business / invoice date
status
source cardinality
AR / AP relation
credit / red relation
```

### 33.18 FO31 — Partial / Split / Multi-Source Invoice

支持：

```text
partial invoicing
multiple source lines
cumulative invoiced quantity / amount
remaining invoiceable quantity / amount
```

Invoice limits 禁止超过 source business facts。在 bounded 范围内允许一张 invoice 收集兼容 source lines。**不得**duplicate source quantity。

### 33.19 FO33 / FO34 — Credit / Red / Void

Confirmed / posting economic history 通常必须通过下列方式纠正：

```text
credit / red invoice
reversal
```

不允许 hard deletion。

Void / cancel 仅在 legal / business valid 且 downstream dependencies 允许时生效。被 cancel / void 的 invoice 不得遗留 orphan：

```text
AR / AP
settlement
voucher
tax
```

effects。

### 33.20 FO35 — Input Invoice Verification

仅内部 ERP state。

至少需要 bounded lifecycle 等价于：

```text
UNVERIFIED
VERIFIED
CERTIFIED
REJECTED / INVALID
```

精确 enum naming 属于 Design。外部 tax-authority 验证保持 OUT_OF_SCOPE。

### 33.21 FO37 — Settlement Account Master

收敛 operational cash / bank account semantics。必须支持：

```text
CASH
BANK
```

operational account identity 独立于 GL accounting subject。每个 settlement account 可映射到 downstream accounting role / subject。

**不得**让 cash account 仅作为 accounting subject `1001` 隐式存在。

### 33.22 FO39 — One Treasury Movement Truth

**Blocking invariant。**每个已确认 cash / bank-changing operation 必须产生 exactly one canonical treasury movement。概念上：

```text
account
direction
amount
business date
source type
source id
counterparty
external reference
reversal relation
```

Examples：

```text
collection
payment
refund
settlement reversal
cash deposit
cash withdrawal
bank transfer
notes settlement
```

All 使用 **同一** treasury movement contract。

### 33.23 Treasury Balance Invariant

Operational balance：

```text
opening balance
+ canonical IN movements
- canonical OUT movements
```

`bank_accounts.balance_cents` 可保留仅作为：

```text
derived / cache projection
```

并必须 reconcile 至 canonical movements。

Forbidden：

```text
cash_journals 直接 mutate balance
且
settlement_account_movements 单独 mutate balance
```

不允许 competing writers。

### 33.24 Legacy cash_journals 处置

当前 `cash_journals` 直接写入路径 **不是 canonical**。Requirement：

```text
converge 至 canonical Treasury Movement
或
retire 作为 write path
```

之后 `cash_journals` 可保留为：

```text
read model
compatibility projection
report
```

但不得作为独立 balance engine。

### 33.25 FO40 / FO41 — Cash and Bank Transfer

Cash deposit / withdrawal 与 internal bank transfer 必须是 paired movements。例：

```text
Bank A → Bank B
```

must conserve organization cash total：

```text
A -100
B +100
total change = 0
```

不允许 one-sided balance mutation。

### 33.26 FO42 / FO43 — Notes Receivable / Payable

支持 bounded operational note lifecycle：

```text
create / register
hold
transfer / endorse where applicable
discount where applicable
settle / mature
cancel / reverse where valid
```

必须显式 link cash / AR / AP consequences。**不得**建设完整 banking bill platform。

### 33.27 FO44 — Payment Request

Payment request = request / approval evidence，**不是** cash movement。仅 approved / executed payment 才产生 treasury movement。Platform Workflow 可提供 approval orchestration。Finance Operations owns financial request fact。

### 33.28 FO45 — Cash Count

Cash count 必须比较：

```text
book cash
vs
physical counted cash
```

Difference 要求 explicit handling / evidence。Cash count 本身不得静默 overwrite balance。

### 33.29 FO46–FO49 — Bank Statement / Reconciliation

Bank statement = 外部银行 evidence。Statement lines 必须是 first-class。

Import 必须创建 statement evidence，**不得**创造 book movement。

Bank reconciliation matches：

```text
canonical book treasury movement
↔
bank statement line
```

支持：

```text
automatic match
manual match
partial / multi-line matching where needed
unmatched book items
unmatched bank items
reconciliation result
```

Invariant：reconciliation **不得**创建原始 cash movement。

### 33.30 FO50 — Treasury ↔ GL Reconciliation

Integration-backed read / check capability。比较：

```text
Treasury operational balance / movements
↔
Accounting & Analytics GL cash / bank balances
```

Finance Operations 不得直接 repair GL。Mismatch 仅产生 reconciliation evidence。

### 33.31 FO51–FO53 — Operational Business Close

**独立于** Accounting period close。

分别维护：

```text
FO51  AR Business Close
FO52  AP Business Close
FO53  Treasury Business Close
```

每个 capability 必须独立实现并独立证明：

```text
pre-close inspection
close
closed-through business date
status
reopen
audit
```

Invariant：

```text
AR close  !=  AP close  !=  Treasury close
```

且：

```text
FO51 / FO52 / FO53
!=
Accounting & Analytics accounting-period close
```

一个 generic close flag 不被接受。

#### 33.31.1 FO51 AR Business Close

AR operational close：维护 closed-through business date；close 之后 affect 该业务日期的 AR documents 不得 create / modify / confirm / reverse / delete；Read / report 仍允许；reopen 通过受控 business-close lifecycle；audit 必须。

#### 33.31.2 FO52 AP Business Close

AP operational close：维护 closed-through business date；close 之后 affect 该业务日期的 AP documents 不得 create / modify / confirm / reverse / delete；Read / report 仍允许；reopen 通过受控 business-close lifecycle；audit 必须。

#### 33.31.3 FO53 Treasury Business Close

Treasury operational close：维护 closed-through business date；close 之后 affect 该业务日期的 Treasury documents（cash / bank / settlement / reconciliation / statement）不得 create / modify / confirm / reverse / delete；Read / report 仍允许；reopen 通过受控 business-close lifecycle；audit 必须。

#### 33.31.4 Shared Post-Close Rules (FO51 / FO52 / FO53)

close 之后，affect closed-through business date 的 documents 不得：

```text
create
modify
confirm
reverse
delete
```

除非通过受控 business-close lifecycle 重开。Read / report 仍允许。close 之后的修正须使用有效 open business date。

### 33.32 FO54 — AR Reports

至少：

```text
AR summary
AR detail
AR aging
due / overdue receivables
customer statement
AR tracking
uninvoiced AR
```

派生自 canonical Finance Operations facts。

### 33.33 FO55 — AP Reports

至少：

```text
AP summary
AP detail
AP aging
due / overdue payables
supplier statement
AP tracking
uninvoiced AP
```

### 33.34 FO56 — Treasury Reports

至少：

```text
cash journal
bank movement ledger
settlement account balance
bank statement report
reconciliation result
unmatched-item report
```

Reports 不得成为 second financial ledgers。

### 33.35 FO57 — Source Business Document Adapter

Integration-backed。

消费 frozen domains 的 economic facts：

```text
Sales & Customer
Procurement & Outsourcing
```

including：

```text
delivery
sales return
purchase receipt
purchase return
outsourcing payable source
discount source where applicable
```

Finance Operations 不得 rewrite frozen source document。

### 33.36 FO58 — Accounting Event / Voucher Adapter

Integration-backed。

Finance Operations 发出 authoritative operational accounting events。Accounting & Analytics owns：

```text
voucher generation architecture
posting
GL
financial statements
accounting period
```

Finance Operations 不得建立自身 voucher engine。可复用既有 canonical voucher adapter。

### 33.37 Discount Ownership Decision

Freeze 如下 boundary：

#### 33.37.1 Sales Discount

commercial authoring / navigation 可保持：

```text
Sales & Customer
```

但其 confirmed financial open-item effect 归：

```text
Finance Operations
```

通过 canonical credit-adjustment integration。

#### 33.37.2 Purchase Discount

当前 contextual operation 可保持：

```text
Finance Operations
```

AP financial effect 归 Finance Operations。

asymmetry 被接受为 role / workflow ownership。**不得**仅因视觉对称而 move routes。

### 33.38 Non-Negotiable Invariants

Freeze：

```text
F1   One AR/AP Open-Item Truth
F2   Recognition Mode Is Explicit
F3   Provisional != Financial
F4   Allocation Is Explicit
F5   Prepayment / Advance != Settlement
F6   Reversal != Delete
F7   Invoice != AR/AP != Settlement != Voucher
F8   One Treasury Movement Truth
F9   Bank Statement != Book Movement
F10  Reconciliation Does Not Mutate Cash Truth
F11  Business Close != Accounting Period Close
F12  Exact Money
F13  Source Documents Remain Owned By Source Domains
F14  GL Remains Downstream
```

Money truth 保持：

```text
integer cents
```

或等价 exact representation。不允许 floating-point money truth。

### 33.39 Finance-Specific Concurrency Requirement

Design 必须 later 实现并证明 exactly **15** MySQL race scenarios：

```text
RACE-01  Collection vs Collection on same AR
RACE-02  Payment vs Payment on same AP

RACE-03  Collection confirm vs settlement reversal
RACE-04  Payment confirm vs settlement reversal

RACE-05  Same prepayment / advance application twice
RACE-06  Refund vs balance application
RACE-07  Write-off vs settlement

RACE-08  AR transfer vs collection
RACE-09  AP transfer vs payment

RACE-10  Same invoice post twice
RACE-11  Supplier Bill Match / Post / Double-Post Concurrency

RACE-12  Provisional conversion vs ordinary settlement

RACE-13  Same treasury transfer execute twice
RACE-14  Same bank statement line reconcile twice

RACE-15  Business close vs dated financial transaction
```

Must execute on：

```text
real MySQL
```

SQLite-only evidence 不计入。

### 33.40 Frozen Functional UAT

Freeze exactly **32** functional UAT scenarios。

```text
UAT-01  AR initialization
UAT-02  AP initialization
UAT-03  Treasury initialization

UAT-04  DIRECT_BUSINESS AR
UAT-05  INVOICE_DRIVEN AR
UAT-06  PROVISIONAL_TO_FINANCIAL AR

UAT-07  DIRECT_BUSINESS AP
UAT-08  INVOICE_DRIVEN AP
UAT-09  PROVISIONAL_TO_FINANCIAL AP

UAT-10  Multi-due-date schedule

UAT-11  Partial collection
UAT-12  Partial payment
UAT-13  Multi-open-item allocation
UAT-14  Automatic / manual reconciliation

UAT-15  Advance receipt
UAT-16  Supplier prepayment
UAT-17  Unapplied balance application
UAT-18  Unapplied-Balance Refund
UAT-19  Settlement reversal

UAT-20  Write-off + reversal
UAT-21  Bad-debt provision

UAT-22  AR counterparty transfer
UAT-23  AP counterparty transfer

UAT-24  Sales invoice partial / source / credit / void
UAT-25  Purchase invoice matching / verification / credit

UAT-26  Cash / Bank settlement account
UAT-27  Cash deposit / withdrawal + internal transfer

UAT-28  Notes receivable / payable + payment request

UAT-29  Cash count

UAT-30  Bank statement import + reconciliation + unmatched items

UAT-31  AR / AP / Treasury close + reopen

UAT-32  AR / AP / Treasury reports + Treasury ↔ GL reconciliation
```

Final Acceptance 不得 defer 任何 UAT。

#### 33.40.1 UAT-18 — Unapplied-Balance Refund 双方向必证

UAT-18 必须独立证明两个方向：

```text
A. Customer-side
  customer advance receipt / unapplied credit
  → refund to customer
  → verifying:
     original unapplied balance
     refund amount
     remaining unapplied balance
     canonical treasury movement
     accounting adapter evidence
     repeat execution idempotent / rejected

B. Supplier-side
  supplier prepayment / unapplied credit
  → refund from / to supplier as appropriate
  → verifying:
     original unapplied balance
     refund amount
     remaining unapplied balance
     canonical treasury movement
     accounting adapter evidence
     repeat execution idempotent / rejected
```

UAT-19 (Settlement Reversal) 不得作为 UAT-18 的替代 evidence。

#### 33.40.2 UAT-31 — 三独立业务关账复合 UAT

UAT-31 是 composite UAT，须独立证明三个 operational close 状态：

```text
AR close
AP close
Treasury close
```

每个独立 close 都必须通过：

```text
pre-close check
→ close succeeds
→ closed-through business date persisted
→ affected dated transaction rejected
→ zero economic side effect
→ reopen succeeds
→ valid dated transaction succeeds again
```

明确证明：

```text
AR close  !=  AP close  !=  Treasury close
```

且：

```text
all three operational closes
!=
Accounting & Analytics accounting-period close
```

一个 generic close flag 不被接受。

### 33.41 Responsive Requirement

Finance Operations mobile acceptance 必须验证：

```text
320 / 390 / 430 / 680  CSS px
```

不允许 horizontal document overflow。Touch targets：

```text
>= 44px
```

不允许为每个 capability 都创建 launcher card。Target mobile launcher：

```text
<= 6 Finance Operations primary entries
```

Recommended information architecture for Design to evaluate：

```text
Receivables
Collections
Payables
Payments
Invoices
Treasury
```

Sub-functions should be contextual / hub navigation。**本阶段不得实施**。

### 33.42 Migration Rule

Future migration may be：

```text
additive
idempotent
transactional where possible
reconcilable
rollback / fail-closed aware
```

Migration 必须 detect：

```text
duplicate economic exposure
cash / bank balance mismatch
orphan allocations
invalid provisional / final pairs
```

**不得**silently reinterpret inconsistent historical finance data。

### 33.43 Existing Runtime Convergence Requirements

后续 Design 必须 converge 而非 duplicate：

```text
settlement-core.js
settlement.js
financial-controls.js
commercial-golive.js
discounts.js

legacy cash_journals
bank_accounts balance writer
bank_statements
bank_reconciliations
bills
```

**不得**创建：

```text
settlement-v2
treasury-v2
new_ar_ledger
new_ap_ledger
```

并立于既有真相。

### 33.44 Out of Scope

显式 OUT_OF_SCOPE for Finance Operations：

```text
Multi-org consolidation
full multi-currency FX accounting
hedging / derivatives
loan management
full corporate treasury
cash pooling
bank host-to-host
SWIFT integration

tax disk hardware drivers
航天 / 百望 device driver integration
vendor-specific invoice cloud SDK
electronic signature provider
SMS / email invoice delivery platform
government tax-network API

Smart Accounting
General Ledger
financial statements
Inventory Costing
Fixed Assets Accounting
Management Accounting
full IFRS / ECL expected-credit-loss engine
```

Internal operational invoice state 保持 IN scope。

### 33.45 Permission 约束

新增最少 Finance Operations permission family，back-end fail closed。具体名称由 Design bounded。

兼容策略：
- 保留既有 `AR_VIEW` / `COLLECTION_MANAGE` / `AP_VIEW` / `PAYMENT_MANAGE` / `SALES_DISCOUNT_MANAGE` / `PURCHASE_DISCOUNT_MANAGE` / `BANK_ACCOUNTS_*` / `BANK_RECONCILE_*` / `CASH_JOURNALS_*` / `BILLS_*` / `FIXED_ASSETS_*` / `ACCOUNTING_VIEW` / `VOUCHER_SUBMIT` / `REPORT_VIEW`；
- 5 个 role seed（admin / sales / warehouse / reviewer / accounting）继续按现有能力访问；
- 新 permission admin 继承；其它角色保持现状。

### 33.46 Compatibility / 不变性约束

- 不删除 / 重命名现有 59+ enabled + 5 disabled route key；本 Domain Closure additive 引入新 route 与 owner；
- 不修改既有 `cash_journals` / `bills` / `bank_statements` / `bank_reconciliations` 表 / 列；新字段以 additive 形式扩展；
- 不重写 `account_receivables` / `account_payables` canonical equation；新字段以 additive 形式扩展；
- 不重写 canonical voucher adapter；新事件通过 `additive` integration；
- 不 DROP historical table；
- 不重命名既有 release tag；
- SQLite + MySQL 8 schema parity；migration 即生效（idempotent）。

### 33.47 Out of Scope（本 Domain Closure 不实施）

- Multi-Org / Multi-Currency（OUT_OF_SCOPE_PRODUCT_BASELINE）；
- 法定电子发票 / 税务硬件集成（OUT_OF_SCOPE）；
- voucher engine rewrite；
- 第二套 AR / AP ledger；
- 第二套 Treasury movement engine；
- retroactive rewrite 历史已确认 AR / AP / Treasury 事实；
- 完整 IFRS / ECL expected-credit-loss engine；
- 完整 corporate treasury / SWIFT / cash pooling。

### 33.48 Acceptance Criteria

#### A. Functional

全部 FO01–FO58 = 58 capability 每一项都必须有 final capability disposition。本域 capability disposition **穷尽且仅**分为以下两类：

```text
DOMAIN-OWNED SOURCE-BACKED CAPABILITIES = 55
+
MUST INTEGRATE capabilities = 3
=
58 capabilities
```

Cross-domain dependency 是 acceptance dependency metadata，**不是** capability disposition。

1. **Finance Operations Domain 自有的 source-backed capability = 55 项**

   5 个 Domain-Owned Integration-Backed 不算入（它们是 FO50 / FO57 / FO58，归入第 2 类）。

2. **MUST INTEGRATE capability = 3 项**

   ```text
   FO50 Treasury ↔ GL Reconciliation    → consume canonical GL cash/bank balance from Accounting & Analytics
   FO57 Source Business Document Adapter → consume frozen Sales / Procurement / Outsourcing source documents
   FO58 Accounting Event / Voucher Adapter → emit canonical accounting events to Accounting & Analytics
   ```

3. **OUT_OF_SCOPE_PRODUCT_BASELINE**

   仅允许用户已批准的明确产品基线项目：
   ```text
   Multi-Organization
   Multi-Currency
   法定电子发票 / 税务硬件集成
   voucher engine rewrite
   第二套 AR / AP / Treasury ledger / movement engine
   retroactive rewrite 历史已确认 AR / AP / Treasury 事实
   完整 IFRS / ECL engine
   完整 corporate treasury / SWIFT / cash pooling
   ```

最终不得存在 `unexplained MISSING / PARTIAL / SEMANTIC_MISMATCH`。任何 unresolved disposition 必须以 Hard Stop Conditions 形式回退至 Requirement / Design 层重新审视，**不得**通过偷换 disposition 类别伪装覆盖。

#### A.1 三大 Recognition Model Hard Invariants

- **DIRECT_BUSINESS_OPEN_ITEM 模型下**：不允许 invoice / bill 形成 second AR / AP for same economic event；
- **INVOICE_DRIVEN_OPEN_ITEM 模型下**：delivery / receipt 不允许被当作 AR / AP 替代品；
- **PROVISIONAL_TO_FINANCIAL 模型下**：provisional 与 financial 暴露不得 double-count；payment 仅限 financial AP。

#### A.2 显式 Invariants

- **Treasury 双真相消除** `≠` `bank_accounts.balance_cents` 完全删除。`bank_accounts.balance_cents` 保留为 derived / cache projection；canonical truth = `settlement_account_movements`。
- **B3106 / B3107 ownership 已 normalizes** 至 Accounting & Analytics；本 Domain 不再承接 Inventory Costing / Fixed Assets authoritative。
- **Capability disposition 穷尽且分类清晰**：任何 capability 必须落到 `Domain-owned source-backed` 或 `MUST INTEGRATE` 之一；不得以 `CROSS_DOMAIN_DEPENDENCY` 代替 disposition。
- **Cross-domain dependency 仅记录 metadata**：用于 traceability 与 acceptance dependency 校验，不计入 capability 分类。

#### B. Data / Schema

- 新增表 / column 全部 additive；既有表 / 字段无破坏；
- `account_receivables` / `account_payables` canonical equation 不得被破坏；
- `cash_journals` / `bills` / `bank_statements` / `bank_reconciliations` 表保留；legacy 路径可保留为 read model / compatibility projection，**不得**作为 write path；
- SQLite / MySQL 8 schema parity；migration 即生效；
- Opening 期间 opening AR / AP / Treasury 标记 `OPENING`；不虚构历史 daily transactions；
- 历史 AR / AP / Treasury 表不破坏；不得 DROP historical finance table；不 retroactive rewrite 历史事实。

#### C. Security

- 所有 Finance Operations mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- Audit 写入关键 AR / AP / Treasury mutation；
- `settlement_account_movements` 写入必须有 voucher + balance reconcile；
- Cash journal write path 必须迁移至 canonical Treasury Movement 或 retired。

#### D. Test

- Wave A focused：参数 + 初始化 + 识别模型 + Terms + Due Schedule；
- Wave B focused：Final Open Items（FO09 / FO10）+ Provisional + Conversion / Reversal（FO11 / FO12 / FO13）+ Transfer（FO15）；
- Wave C focused：Settlement Documents + Allocation + Reconciliation Schemes（FO16–FO22）；
- Wave D focused：Unapplied Money + Refund + Write-off + Bad-Debt Provision（FO23–FO28）；
- Wave E focused：Sales Invoice + Purchase Invoice + Cardinality + Reconciliation + Credit/Red + Void/Cancel + Verification + Reports（FO29–FO36）；
- Wave F focused：Settlement Account + Treasury Movement + Cash/Transfer + Notes + Payment Request + Cash Count（FO37–FO45）；
- Wave G focused：Bank Statement + Import + Reconciliation + Unmatched + Treasury Close（FO46–FO49 + FO53）+ Treasury ↔ GL Reconciliation（FO50）；
- Wave H focused：AR / AP / Treasury 业务关账 + Reports（FO51–FO56）+ Source / Voucher Adapter（FO57 / FO58）；
- 全部 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`（**15 races 必须真实 MySQL 实证**）；
- responsive browser matrix：320 / 390 / 430 / 680 CSS px 在 6 个 primary launcher entries 上无横向溢出；
- **32 UAT 必须真实 PASS**：不得 defer 至 Final Acceptance 之后。

#### E. Concurrency critical sections

以下区域必须为 critical section（Design 决定具体 SQL / lock strategy；本阶段不设计 SQL）：

- multi-collection / multi-payment on same AR / AP（RACE-01 / RACE-02）；
- collection / payment confirm vs settlement reversal（RACE-03 / RACE-04）；
- same prepayment / advance application twice（RACE-05）；
- refund vs balance application（RACE-06）；
- write-off vs settlement（RACE-07）；
- AR / AP transfer vs collection / payment（RACE-08 / RACE-09）；
- same invoice post twice（RACE-10）；
- supplier-bill match / post concurrent（RACE-11）；
- provisional conversion vs ordinary settlement（RACE-12）；
- same treasury transfer execute twice（RACE-13）；
- same bank statement line reconcile twice（RACE-14）；
- business close vs dated financial transaction（RACE-15）。

#### F. UI / Mobile

- 实际 operator workflow（user task；Design 决定 UI 结构）：
  - DIRECT_BUSINESS AR / AP / Provisional → Financial AR / AP 流程；
  - Multi-due-date Schedule → Allocation / Reconciliation；
  - Settlement Reversal 流程；
  - Refund / Write-off / Bad-Debt Provision 流程；
  - Invoice Partial / Split / Multi-Source / Credit / Void 流程；
  - Cash / Bank Settlement Account Master + Treasury Movement 流程；
  - Cash Count + Internal Bank Transfer 流程；
  - Notes R / P + Payment Request 流程；
  - Bank Statement Import + Reconciliation + Unmatched Items 流程；
  - AR / AP / Treasury 业务关账流程。
- Mobile-first：390 CSS px 为主；同时验证 320 / 430 / 680；
- Mobile launcher primary entries ≤ 6；
- Sub-functions 走 contextual / hub navigation；
- LIST → DETAIL → EDITOR / WORKFLOW；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`；
- 不得修改业务术语、API、权限、状态机、Approval / Confirm / Post / Reverse、source / downstream、AR / AP / Treasury / 会计事实。

#### G. Documentation / Log

- `document.md §14` Manual → Domain 主映射 + `§22.6` / `§22.7` Capability Audit Matrix + `§21` Domain-level gaps + `§3` Product Architecture 已同步；
- `document.md §33` 已固化 Requirement（含 58 capability + 55 + 3 + F1–F14 + 32 UAT + 15 RACE + 3 recognition models + B3106 / B3107 ownership correction）；
- `log/2026-10-10.md` append-only 记录本 Domain Closure Requirement 阶段成果；
- `solution.md` **本阶段不修改**；Design 在 Requirement 通过后于 `solution.md §28` 展开；
- `APPLY_GUIDE.md` 不动。

### 33.49 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization / Multi-Currency 需求出现；
2. 需要重写 voucher engine；
3. 需要 DROP historical finance table 或 destructive schema rewrite；
4. 需要 retroactive rewrite 已确认 AR / AP / Treasury 事实；
5. 需要建立第二套 AR / AP / Treasury ledger / movement engine；
6. 需要把 cash_journals 保留为 balance write path（必须迁移至 canonical Treasury Movement 或 retired）；
7. 需要把 customer / supplier / sales / purchase / inventory / production / outsource / engineering / planning / accounting 业务事实重写；
8. 需要走 Generic Workflow 取代现有 5 审批族；
9. 需要把 B3106 / B3107 ownership 重映射回 Finance Operations；
10. 需要把 sales-discounts / purchase-discounts 仅因视觉对称 move routes；
11. 需要把 provision / financial 模型混淆为 undocumented flag；
12. MySQL migration 无法保证 parity；
13. Source semantics 不足导致 multi-due-date 算法 / 完整 reversal-on-financial-invoice 不得不猜测；
14. 既有的 AR / AP / Settlement / Invoice / Treasury canonical truth 必须被破坏；
15. 把 receipt / delivery 当作 AR / AP 替代品。

### 33.50 最终接受状态

本节 Requirement 包含 **58** 项 Capability / Owner accounting = **55 Domain-Owned + 3 Integration-Backed**（FO50 Treasury ↔ GL Reconciliation / FO57 Source Business Document Adapter / FO58 Accounting Event / Voucher Adapter）。

本节 Requirement 包含 **14** Non-Negotiable Invariants（F1–F14）/ **3** Canonical Recognition Models / **32** Frozen Functional UAT / **15** Finance-Specific MySQL Races。

本节 Requirement 完成；下游 Design 见 `solution.md §28`（本阶段未开始）。等待用户 PASS。

---

**FINANCE OPERATIONS DOMAIN CLOSURE REQUIREMENT — COMPLETE / READY FOR USER REVIEW**

---

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
