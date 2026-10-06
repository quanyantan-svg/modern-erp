# README.md 建议更新内容

> 用途：将当前项目定位从“22 个金蝶模块作为产品架构”修正为“22 份手册保证需求完整性，8 个业务域 + Platform 定义最终产品架构”。

## 建议新增：目标业务架构

Modern ERP 的长期产品架构正式采用 **8 Business Domains + 1 Platform Layer**。  
《金蝶云星空标准版操作手册》B3101–B3122 共 22 份手册继续作为完整业务需求、术语、流程和控制机制的权威对标来源，但**不再直接决定最终用户菜单、一级模块或代码物理目录**。

| # | Business Domain | 中文名称 | 主要范围 |
|---|---|---|---|
| 01 | Master & Engineering | 主数据与工程数据 | 组织、客户/供应商/物料基础、仓储基础、BOM、工艺路线、工序、工作中心、资源、日历、工程变更 |
| 02 | Sales & Customer | 销售与客户 | 客户、报价、订单、变更、发货、退货、价格/折扣、信用 |
| 03 | Planning | 需求与计划 | 预测、预测冲销、MRP、供需、Pegging、计划订单、计划释放 |
| 04 | Procurement & Outsourcing | 采购与委外 | 请购、寻源、配额、采购订单、收料/入库/退货、VMI、委外 |
| 05 | Manufacturing & Quality | 制造与质量 | 生产订单、用料、报工、车间工序、WIP、质量方案、检验与不合格处理 |
| 06 | Inventory & Warehouse | 库存与仓储 | 库存账、出入库、调拨、盘点、状态转换、LOT/SERIAL、仓位、条码与移动仓储 |
| 07 | Finance Operations | 财务运营 | AR/AP、暂估、发票、收付款、出纳、银行、票据、存货核算、固定资产 |
| 08 | Accounting & Analytics | 会计与分析 | 智能会计、总账、期末、财务报表、经营会计、管理分析 |
| — | Platform | 平台层 | Identity/RBAC、Workflow、Approval、Document Lifecycle、Document Conversion、Audit、Notification、Period Control、Numbering |

22 份金蝶手册与 8 个业务域采用“双轴”关系：

- **22 份手册 = Requirements / Coverage / Acceptance 轴**：保证原系统业务能力不遗漏；
- **8 Business Domains + Platform = Product Architecture 轴**：决定新版 ERP 的产品边界、信息架构和长期领域所有权；
- 一个金蝶模块可以映射到一个或多个业务域；一个业务域也可以吸收多本金蝶手册的能力；
- 不再把 B3101–B3122 直接做成 22 个一级菜单。

## 建议新增：核心产品范围收口

下列现有扩展不属于 B3101–B3122 核心 ERP 业务，确定从最终产品范围删除：

- `projects` — 项目立项；
- `tasks` — 项目任务；
- `timesheets` — 项目工时；
- `contacts` — 现有 CRM 扩展联系人入口；
- `followups` — 客户跟进；
- `activities` — 销售活动。

删除上述扩展**不等于删除销售域需要的客户联系人/地址能力**。Sales & Customer 仍需要正规的客户联系人、收货方、结算方、付款方、地址与联系方式模型；现有 CRM `contacts` 是否有可复用历史数据，必须在删除实现前先审计和迁移，不能直接丢失业务数据。

当前 `projects-workflow.jsx` / `server/modules/business.js` 同时混有通知、工作流与项目/CRM 能力。实施删除时必须先把仍属于 Platform 的通知/工作流能力保留下来，再删除项目/CRM 部分，禁止按文件整块删除造成误伤。

数据库中的历史扩展表不在普通代码清理中直接 DROP。最终 schema 清理必须经过数据保留/导出/迁移审计和单独批准。

## 建议替换：当前开发主线

开发采用以下双轴流程：

`金蝶手册能力提取 → Capability → 映射到 8 Domain/Platform → 当前实现审计 → Coverage Matrix → Gap → Requirement → Design → Implementation → Acceptance → Freeze`

默认仍可按 `B3101 → B3102 → ... → B3122` 作为**需求审计顺序**，但该编号不决定最终产品一级模块、Launcher 分组或代码目录。

当前架构基线之后的优先顺序：

1. **Core Scope Cleanup**：安全移除 Project Management / CRM 扩展；
2. **Domain Alignment**：将前端 Registry 与长期领域所有权对齐到 8 Domains + Platform，不改变既有业务事实；
3. **B3101–B3122 Coverage**：逐手册建立 Capability Coverage Matrix；
4. 仅对 `PARTIAL / MISSING / SEMANTIC_MISMATCH` 形成 Requirement / Design；
5. 每项实现继续复用已经验证的库存、MRP、制造、结算、估值、会计、权限、审计和 MySQL 基础，不进行整仓重写。

## 建议新增：当前架构差距概览

当前 v1.6.2/master 已有较强基础：销售/采购主链、Forecast/MRP/Pegging、生产订单与领退料/入库、工序报工、IQC/OQC、LOT/SERIAL 与谱系、库存调拨/盘点/报废/月结、AR/AP 与核销、存货估值/WIP、凭证/总账/报表、RBAC/审计及 MySQL 运行路径均可继续复用。

主要目标 Gap：

- Master & Engineering：组织模型、仓位、资源/设备、工作日历、替代料、ECO/工程变更；
- Sales & Customer：报价、价格体系、销售变更、信用档案/额度/占用/特批；
- Planning：更完整计划参数、安全库存、替代供应与供需优先级；
- Procurement & Outsourcing：寻源、配额、VMI、完整委外子域；
- Manufacturing & Quality：排程/派工/工序转移、更多质量类型、抽样与不合格处理；
- Inventory & Warehouse：Barcode/PDA、仓位、库存状态转换、组装/拆卸、完整预留；
- Finance Operations：暂估深度、完整出纳、固定资产生命周期、多币种；
- Accounting & Analytics：智能会计规则引擎、业务财务对账、现金流量、经营会计；
- Platform：Generic Workflow、Document Relationship/Conversion、统一编号与组织级数据权限。

当前“单组织、单本位币”仍是**现状限制**，不得在 UI/文档中宣称已经支持多组织/多币种；但它们不再被视为永久产品架构限制，后续在相关 Capability 审计确认后进入独立基础能力设计。

## Vibe Coding 与 UI Skill

开发治理以 `AGENTS.md` 为唯一权威。`README.md` 只引用，不复制第二套流程。

`.claude/skills/erp-mobile-taste/SKILL.md` 只负责明确的 UI 设计、Mobile UX、布局和响应式现代化任务。它不得改变业务术语、API、数据库、权限、状态机、审批/确认语义或上下游关系；业务正确性始终优先于视觉简化。
