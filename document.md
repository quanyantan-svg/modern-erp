# document.md 建议更新内容

## 对 §20 的语义修订

### 将 §20 标题建议调整为

`## 20. 金蝶手册需求对标与能力验收主线`

### §20.1 中将“模块边界与金蝶模块边界在语义层面对齐”修订为

- 让 Modern ERP 的每项核心业务能力都能够追溯到 B3101–B3122 对应手册；
- 让业务术语、流程、状态、控制机制和上下游关系与成熟 ERP 语义对齐；
- **最终产品边界由 §21 的 8 Business Domains + Platform 定义，而不是把 22 份手册直接变成 22 个一级产品模块。**

### 将 §20.3 建议替换为

### 20.3 手册模块是需求审计与验收单位，不是最终产品业务域

- B3101–B3122 是需求完整性、Coverage 和 Acceptance 的审计单位；
- §21 定义的 8 Business Domains + Platform 是最终产品架构；
- 一个手册模块可以跨多个业务域，一个业务域也可以吸收多本手册的能力；
- route 数量、handler 数量、页面数量、Wave 编号均不是手册能力完成标准；
- 每本手册必须建立 Capability Coverage Matrix；
- 对应手册所有能力最终必须为 `COVERED` 或经过用户明确确认的 `OUT_OF_SCOPE`，才可视为该手册验收完成；
- `MODULE FREEZE` 表示该手册对应能力基线冻结，不表示产品存在一个同名一级模块；
- 默认按 B3101 → B3122 审计，不禁止用户批准的跨域架构基础任务先行，但任何先行任务必须可追溯到已确认的架构/Gap，不得成为独立“重构为了重构”的 roadmap。

---

## 21. 新版 ERP 目标业务架构

### 21.1 架构原则

Modern ERP 的长期产品架构固定为 **8 Business Domains + 1 Platform Layer**。  
B3101–B3122 继续作为需求和验收来源，8 Domains + Platform 作为产品和领域架构。

系统最终必须满足：

1. 所有金蝶手册中的目标 Capability 都可追溯到明确 Domain/Platform；
2. 同一业务原语只有一个 canonical owner；
3. 前端菜单按用户任务和业务域组织，不复制传统桌面 ERP 的 22 模块菜单；
4. 后端、数据和工作流继续保留成熟 ERP 的业务语义与审计链；
5. 现有已验证的业务事实优先复用，禁止以“新版架构”为理由整仓重写。

### 21.2 八个业务域与 Platform

| 架构域 | 核心能力 |
|---|---|
| Master & Engineering | Organization、Business Partner 基础、Material、Warehouse Foundation、BOM、Routing、Operation、Work Center、Resource、Calendar、Substitute、ECO |
| Sales & Customer | Customer、Quotation、Sales Order、Order Change、Delivery、Return/Replacement、Pricing/Discount、Credit |
| Planning | Forecast、Consumption、Demand/Supply、Reservation、MRP、Pegging、Planned Order、Release |
| Procurement & Outsourcing | Requisition、Sourcing、Supplier Allocation、Purchase Order、Receipt、Return、VMI、Outsourcing |
| Manufacturing & Quality | Production Order、Production BOM、Issue/Return/Supplement、Operation Execution、WIP、Inspection、Non-conformance |
| Inventory & Warehouse | Inventory Ledger、Inbound/Outbound、Transfer、Adjustment、Stocktake、Status Conversion、LOT/SERIAL、Bin、Barcode/Mobile |
| Finance Operations | AR、AP、Temporary AR/AP、Invoice、Collection/Payment、Treasury、Bank、Bills、Inventory Cost、Fixed Assets |
| Accounting & Analytics | Accounting Platform、Voucher、GL、Period End、Financial Reports、Management Accounting |
| Platform | Identity/RBAC、Organization Scope、Workflow、Approval、Document Lifecycle、Document Conversion、Numbering、Attachment、Audit、Notification、Period Control |

### 21.3 B3101–B3122 到目标架构的主映射

| 金蝶手册 | 主要目标归属 |
|---|---|
| B3101 采购管理 | Procurement & Outsourcing |
| B3102 销售管理 | Sales & Customer |
| B3103 信用管理 | Sales & Customer |
| B3104 库存管理 | Inventory & Warehouse |
| B3105 条码管理 | Inventory & Warehouse；生产现场动作可跨 Manufacturing & Quality |
| B3106 存货核算 | Finance Operations |
| B3107 固定资产 | Finance Operations |
| B3108–B3109 应付款 | Finance Operations |
| B3110–B3111 应收款 | Finance Operations |
| B3112 发票管理 | Finance Operations |
| B3113 出纳管理 | Finance Operations |
| B3114 智能会计平台 | Accounting & Analytics |
| B3115 总账 | Accounting & Analytics |
| B3116 报表 | Accounting & Analytics |
| B3117 经营会计 | Accounting & Analytics |
| B3118 工程数据 | Master & Engineering |
| B3119 生产管理（含车间/质量） | Manufacturing & Quality |
| B3120 计划管理 | Planning |
| B3121 委外管理 | Procurement & Outsourcing，跨 Planning / Inventory / Finance |
| B3122 工作流设计与配置 | Platform |

此表只定义主归属。跨域业务关系必须保留，不能为了单一归属切断上下游。

### 21.4 必须保持的端到端主链

新版架构必须完整支持并保持可追溯：

**O2C**

`客户/报价 → 销售订单 → 信用控制 → 计划/库存准备 → 发货/出库 → 应收 → 销售发票 → 收款 → 核销 → 会计`

**P2P**

`需求/MRP → 请购 → 寻源/采购订单 → 收料/检验/入库 → 应付/暂估 → 采购发票 → 付款 → 核销 → 存货成本/会计`

**Plan-to-Produce**

`销售订单/预测 → MRP → 计划订单 → 生产订单 → BOM/领退补料 → 工序执行/报工 → 检验 → 生产入库 → WIP/成本`

**Plan-to-Outsource**

`MRP → 委外计划/订单 → 委外用料 → 发料 → 供应商加工 → 收料/检验 → 委外入库 → 加工费应付 → 材料+加工成本`

**R2R**

`业务事实 → 库存/AR/AP/资金/资产/成本 → 智能会计 → 凭证 → 总账 → 期末 → 财务报表/经营会计`

Platform 的 Workflow / Approval / Audit / Document Conversion 贯穿上述全部流程。

### 21.5 核心产品范围收口：删除非核心扩展

最终产品不再支持下列当前扩展：

- Project Management：`projects`、`tasks`、`timesheets`；
- CRM Extension：`contacts`、`followups`、`activities`。

要求：

1. 从 `applicationRegistry`、Launcher、桌面导航和 direct route 中删除上述最终用户能力；
2. 删除对应前端 executable surface；
3. 删除对应后端 API/handler 和仅服务上述能力的权限/seed；
4. 删除或更新与上述能力绑定的测试；
5. `projects-workflow.jsx` 与 `server/modules/business.js` 是 mixed-owner 文件，必须先保留/提取仍属于 Platform 的 `notifications`、`workflows` 等能力，再删除 Project/CRM 部分；
6. Sales & Customer 仍需要客户联系人、收货地址、结算方/付款方等核心能力；不得把“删除 CRM contacts 扩展”误解成“ERP 不需要客户联系人”；
7. 若现有 `contacts` 数据可映射为未来 Customer Contact 主数据，先做迁移设计，再删旧实现；
8. 历史数据库表不得在普通代码删除任务中直接 DROP。最终 DROP/归档必须单独审计历史数据、备份、迁移/导出、SQLite/MySQL 双路径和 rollback；
9. 清理后 Lifecycle dependency、权限 catalogue、测试 manifest、文档、演示 seed 与导航必须保持一致；
10. 删除后不得保留“隐藏但仍受支持”的产品承诺；如只保留历史表，应明确为 legacy data retention，而非 active capability。

### 21.6 当前仓库能力基线（2026-10-06 初步架构审计）

下表是**领域级初步审计**，用于规划，不替代 B3101–B3122 的逐 Capability Module Acceptance。

| Domain | 当前基础 | 主要 Gap | 状态 |
|---|---|---|---|
| Master & Engineering | 客户、供应商、产品、仓库、BOM、Product Routing、Work Center、Routing Operation | Organization、Bin、Resource/Equipment、Calendar、Substitute、ECO | PARTIAL |
| Sales & Customer | Sales Order、Delivery、Return、Discount、Invoice/AR 链 | Quotation、完整 Pricing、Order Change、Credit | PARTIAL |
| Planning | Forecast、MRP、Demand/Supply、Pegging、Production/Purchase Instruction、Requisition | Safety Stock 深化、替代供应、更多计划策略/参数 | PARTIAL |
| Procurement & Outsourcing | Requisition、PO、Receipt、Return、Supplier | Sourcing、Quota、VMI、完整 Outsourcing | PARTIAL |
| Manufacturing & Quality | Production Order、Issue/Return、Receipt、Routing Snapshot、Operation Report、WIP、IQC/OQC、Traceability | Scheduling、Dispatch、Operation Transfer、更多 Inspection、Sampling/NC 深化 | PARTIAL |
| Inventory & Warehouse | Inventory、Transfer、Check、Adjustment、Scrap、Month End、LOT/SERIAL、Traceability | Barcode/PDA、Bin、Status Conversion、Assembly/Disassembly、完整 Reservation | PARTIAL |
| Finance Operations | AR/AP、Collection/Payment、Settlement、Invoices/Bills、Bank Accounts、Valuation/WIP；Cash/Bills/Fixed Assets 有部分后端 | Temporary AR/AP 深化、完整 Treasury、Fixed Asset 生命周期、多币种 | PARTIAL |
| Accounting & Analytics | Voucher、GL、Trial Balance、P&L、Balance Sheet、Decision Reports、Accounting Config 基础 | Smart Accounting Rule Engine、业务财务对账产品化、Cash Flow、Management Accounting | PARTIAL |
| Platform | RBAC、5 Approval Families、Audit、Notification、Lifecycle、Registry/RouteLocation | Generic Workflow、Document Relationship/Conversion、Numbering、Organization Scope | PARTIAL |

### 21.7 当前限制与目标限制必须分开表达

当前运行事实继续保持：

- 当前单组织；
- 当前单本位币；
- `fixed-assets` / `cash-journals` / `bills` / `workflows` 等部分前端 Route 仍 disabled；
- 当前 Generic Workflow、Outsourcing、Credit、Barcode 等未完成；
- 当前代码存在较大的 `server/app.js` 与 mixed-owner 页面/模块。

但目标架构不把“单组织/单本位币”永久冻结为产品原则：

- Organization-ready 是 Master & Engineering / Platform 的目标 Gap；
- 多币种是 Finance Operations / Accounting & Analytics 的目标 Gap；
- 何时实施必须由对应手册 Capability Audit 和独立 Requirement/Design 决定；
- 在正式实现前，系统仍必须诚实显示为不支持。

`APS / 完整 MES-OEE / 完整 QMS-CAPA / 政府法定税务申报` 等超出 B3101–B3122 核心能力的产品，不因本次架构调整自动进入范围；如以后新增，必须单独立项。

### 21.8 后续开发推进顺序

本次文档基线确认后，不直接开始新增 ERP 功能。后续顺序为：

1. `CORE SCOPE CLEANUP AUDIT`：审计并安全移除 Project/CRM 扩展；
2. `DOMAIN ALIGNMENT`：将 Registry、导航和 logical ownership 对齐 8 Domains + Platform；初期保持既有 API/数据业务合同；
3. 从 B3101 起逐手册执行：
   `MANUAL EXTRACTION → CAPABILITY MATRIX → CURRENT AUDIT → GAP → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE/FREEZE`；
4. 每个 Capability 必须同时记录 `Manual → Capability → Domain → Current Owner → Coverage → Target Owner`；
5. 跨域 foundation 只有在已确认 Gap 的前提下才允许先行，不得重新演变成无业务目标的 Wave roadmap。

### 21.9 最终完成标准

新版 ERP 不是以“页面都做完”判定完成。最终至少满足：

- B3101–B3122 每项目标 Capability 均为 `COVERED` 或明确 `OUT_OF_SCOPE`；
- 8 Domains + Platform 有清晰 canonical ownership；
- 非核心 Project/CRM 扩展已不再是 active product capability；
- O2C / P2P / Plan-to-Produce / Plan-to-Outsource / R2R 端到端可追溯；
- Document source/downstream、行级累计执行、状态、权限、审计和反向业务证据可追溯；
- Inventory / LOT-SERIAL / WIP / AR/AP / Valuation / GL 等账实一致；
- Mobile-first 320/390/430/680 合同成立；
- SQLite / MySQL 8 适用合同通过对应 gate；
- focused、full、build、diff check 以及适用的 heavy/MySQL gate 全绿；
- 用户完成最终 Acceptance 后方可声明新版 ERP 架构完成。
