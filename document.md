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
| Manufacturing & Quality | Production Order 审批/下达、Issue/Return/Supplement、Receipt、Operation Plan、Forward/Backward Scheduling、Routing Snapshot、Operation Report、Production Inspection、WIP/Cost、IQC/OQC、Traceability、生产扫码 | Dispatch、Transfer、更多 Inspection/NC | PARTIAL |
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
