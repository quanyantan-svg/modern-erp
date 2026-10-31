# Modern ERP

Modern ERP 是一套基于 **React 19 + Vite 7 + Node.js 22.23.2 + SQLite/MySQL 8** 构建的现代制造业 ERP。产品采用 **mobile-first** 形态，但不牺牲成熟 ERP 的业务语义、控制机制、来源关系、状态机、审计和财务一致性。

当前已发布基线仍为 **v1.6.2**，`package.json` 当前版本为 `1.6.2`。`master` 是持续开发分支，可以领先最新 release tag；精确开发状态以 Git SHA 或 `git describe` 为准。既有 release tag 不得移动、删除或重建。

## 产品架构

新版 Modern ERP 的长期产品架构采用：

1. **Master & Engineering — 主数据与工程数据**
2. **Sales & Customer — 销售与客户**
3. **Planning — 需求与计划**
4. **Procurement & Outsourcing — 采购与委外**
5. **Manufacturing & Quality — 制造与质量**
6. **Inventory & Warehouse — 库存与仓储**
7. **Finance Operations — 财务运营**
8. **Accounting & Analytics — 会计与分析**
9. **Platform — 横向平台层**

《金蝶云星空标准版操作手册》B3101–B3122 共 22 份手册继续作为 **Requirements / Coverage / Acceptance** 的权威业务对标来源，但不再直接决定最终用户菜单、一级模块或代码物理目录。

双轴关系固定为：

- **22 份金蝶手册 = Requirements / Coverage / Acceptance**
- **8 Business Domains + Platform = Product Architecture / Ownership**

一个手册可以跨多个 Domain，一个 Domain 也可以吸收多本手册。Modern ERP 不复制传统桌面 ERP 的 22 模块菜单，不复制金蝶 UI，也不复制其源码；系统只吸收成熟 ERP 的业务功能、术语、流程与控制机制，并在当前技术栈上重新实现 mobile-first 产品体验。

完整业务需求与 22 手册 Capability 基线见 [document.md](./document.md)。  
当前技术设计与实现见 [solution.md](./solution.md)。  
开发与 AI/Vibe Coding 治理见 [AGENTS.md](./AGENTS.md)。

## 当前已具备的核心基础

当前仓库已经形成可继续复用的核心能力，包括：

- 五角色 RBAC、职责分离、审批中心和操作审计；
- 客户、供应商、产品、仓库、BOM、工艺路线、工作中心等主数据；
- 销售订单、发货、退货、销售发票、AR 与收款/核销；
- Sales Wave 1 商业基础：销售参数、销售组/销售员/有效期成员关系、客户商业扩展、客户物料对应、产品销售分类与可售范围规则；
- Sales Wave 2 定价与订单时折扣：base currency 价目表、不可变价格版本、客户/物料/UoM/数量阶梯/日期解析、LINE/HEADER 折扣、手工覆盖权限及纯读证据；SQLite/MySQL 共用五表与客户默认配置；
- Sales Wave 3–5：报价生命周期与分批转单、Canonical SO Writer 的价格/折扣不可变快照、审批后受控订单变更、发货通知与 DIRECT_ORDER / DELIVERY_NOTICE 双来源销售出库；
- 请购、采购订单、收货、退货、供应商账单、AP 与付款/核销；
- Forecast、可追溯预测冲销、Planning Scheme、MRP、Demand/Supply、Pegging、Planned Order、Reservation、计划员工作台、生产/采购指令与请购；
- 生产工单审批/下达、BOM/Routing snapshot、工序计划与正排/倒排、领料/退料/补料、工序报工、生产入库、WIP 与生产成本归集；
- IQC/OQC、生产检验、检验项目/检测值/仪器/检验方案、质量门禁与生产扫码入口；
- Inventory、调拨、盘点、调整、报废、期间关闭；
- LOT/SERIAL、HOLD/RELEASE、Traceability 与 Production Genealogy；
- Inventory Valuation、WIP、COGS、GRNI 等财务库存基础；
- Voucher、GL、Trial Balance、Income Statement、Balance Sheet；
- Decision Reports；
- SQLite 本地/测试兼容路径；
- MySQL 8 一等运行路径；
- applicationRegistry / RouteLocation / MobileShell；
- Finance Operations 三种确认模式、正式/暂估 AR/AP、结算与资金 canonical writer、票据/付款申请/现金盘点/银行对账及六入口移动信息架构；
- route ownership、domain module extraction、测试分层和部署基础。
- Master & Engineering 工程基础资料、BOM 治理/分析、替代料与可配置 BOM、Routing enrichment/topology、bounded ECO 及移动端工作面。

这些能力属于已有产品资产。后续新版 ERP 采用**渐进式演进**，不进行整仓重写。

## 当前项目状态快照（2026-10-31）

本节是**当前状态的唯一入口**。它引用而不复制历史冻结证据；历史结论一律保留在
`document.md` / `solution.md` 的 dated 章节与 `log/` 中，**不得以本节覆盖历史**。
上一版项目级审计为《ERP Project-Wide Progress Baseline & Next Milestone Audit》（2026-10-31），
其勘误见 `solution.md §37.54.48`。

### 九个 Domain 当前进度

冻结层级严格区分七种状态，不得互相替代：
`Requirement Complete` → `Implementation Complete` → `Stage Acceptance` → `Capability Freeze`
→ `Domain-Level Acceptance` → `Manual Capability Closure` → `Release Readiness`。

| Domain | Requirement | Implementation | Stage Acceptance | Capability Freeze | Domain-Level Acceptance | Manual Capability Closure | Release Readiness |
|---|---|---|---|---|---|---|---|
| Master & Engineering | §28 Complete | Complete | — | — | 未见 token（下游日志记 `V17 §28` FROZEN） | 未见 | 未就绪 |
| Manufacturing & Quality | §29 Complete | Complete | — | — | 未见 token（下游日志记 `V18 §29` FROZEN） | 未见 | 未就绪 |
| Planning | §30 Complete | Complete | `Final Acceptance: PASS` | `Freeze: YES`（`log/2026-10-08.md:288`） | 有明确用户 Freeze | §30 覆盖范围内 | 未就绪（整体） |
| Procurement & Outsourcing | §31 Complete | Complete | 28/28 browser + 11/11 MySQL race | 未冻结 | **§31.11 `NOT READY`，不得 Freeze** | 未见 | 未就绪 |
| Inventory & Warehouse | §32 Complete | Partial Complete | — | — | 未见 token | 未见 | 未就绪 |
| Finance Operations | §33 Complete | Complete | — | — | 未见 token（`USER FREEZE NOT VERIFIED`） | 未见 | 未就绪 |
| Sales & Customer | §34 FROZEN | Complete（Wave 0–10 + W11） | Wave 6/7/9 + Gate A PASS | Wave 6/7/9 + Gate A + Wave 10 | 部分（Wave 8 待提交；Waves 1–2 无验收记录） | CAP-1..36 部分 | 未就绪 |
| Accounting & Analytics | **无 Domain Closure Requirement** | Partial | — | — | 未见 | **未闭合**（B3114–B3117） | 未就绪 |
| Platform | **无 Domain Closure Requirement** | Partial | — | — | 未见 | **未闭合**（B3122） | 未就绪 |

**没有任何 Domain 达到 Release Readiness。** 生产发布仍未获授权（`document.md:11187`）。

### B3101–B3122 最新 Coverage 来源

`document.md §22`（2026-10-06）仍是**已批准的手册能力基线**，其 Coverage 列是初判，**不得当作当前进度**。
当前权威 Coverage 来源如下；**未经逐条证据支持的 Capability 保持 `UNVERIFIED`**。

| 手册 | 权威 Coverage 来源 | 状态 |
|---|---|---|
| B3101 采购 / B3121 委外 | §31.3.1（PRC-01..26）、§31.3.3（OUT-01..23）、VMI-01..05 | Requirement 已完成；Acceptance `NOT READY` |
| B3102 销售 | §34.8（CAP-1..27） | 已实现并部分冻结 |
| B3103 信用 | §34.8（CAP-28..36）+ SC82–SC107 | 已实现并冻结（W11-SEC/U1/U2/OVERDUE/U3） |
| B3104 库存 / B3105 条码 | §32.3（INV-01..44） | Requirement 已完成；Domain Acceptance 未见 |
| B3106 存货核算 / B3107 固资 | §33.1.3 仅确认归属 | **无能力矩阵，Coverage `UNVERIFIED`** |
| B3108–B3113 | §33.5（FO01..FO58）+ §33.2 三种识别模型 | Requirement 已完成；Domain Acceptance 未见 |
| B3114–B3117 | 无 | **无能力矩阵，Coverage `UNVERIFIED`** |
| B3118 工程数据 | §28.3（ME-01..31） | 已实现；Domain Acceptance 未见 |
| B3119 生产管理 | §29.3（MQ-01..43） | 已实现；Domain Acceptance 未见 |
| B3120 计划 | §30.2（PL-01..45） | 已实现并冻结 |
| B3122 工作流 | §22.22 | 仍然开放（正确） |

### 已验收 / 待验收 / 未实施

- **已验收并冻结**：Planning；Sales Wave 6 / 7 / 9、Gate A、Wave 10（能力冻结，发布仍阻塞）；
  Package B 测试隔离；W11-SEC-01、W11-A U1、U2、OVERDUE、U3。
- **实现完成但缺 Domain-Level Acceptance**：Master & Engineering、Manufacturing & Quality、
  Inventory & Warehouse、Finance Operations。
- **待验收**：Procurement & Outsourcing（`NOT READY`）。
- **未实施**：W11-B（Evaluation Foundation）、W11-C（Multi-Scorer / Rating）、W11-D（Reconciliation）；
  Accounting & Analytics 的 Cash Flow、Report Designer、Management Accounting；
  Platform Generic Workflow 执行引擎。

### W11 依赖 DAG（`solution.md §37.54.15.1` 为准）

```text
[W11-SEC] ──> [W11-A] Credit Query / Exception History

[W11-B] Evaluation Foundation ──> [W11-C] Multi-Scorer / Rating Application

[W11-D] Reconciliation / Recalculation ──> 仅依赖 [W11-SEC] 的 Scope 合同
```

硬依赖只有三条：`W11-A → W11-SEC`、`W11-C → W11-B`、`W11-D → W11-SEC`。
`W11-B`、`W11-D` **不依赖** `W11-A`；`W11-A` **不依赖** `W11-B/C`；`W11-D` **不依赖** `W11-B/C`。
`W11-D ↔ W11-A` 仅为**可选复用**（`solution.md §37.54.15.1` CORRECTION-5，2026-10-27）。

**W11-A 包级 Acceptance**：其唯一硬依赖 W11-SEC 已通过；契约范围
（`§37.54.15.3`：3 个 GET 端点 + `credit-query.js` + `credit-query.jsx` + U1/U2/U3 增量）已全部
验收冻结。包级标识 `W11_A_ACCEPTANCE_PASS` **仍被保留、尚未签发**——签发是用户的决定，不由本次纠偏代签。
W11-A OVERDUE Foundation 的冻结记录本身**未记载 Git SHA**（其工作树保持未暂存/未提交），
在包级冻结引用完整锚点集之前应先闭合该锚点。

### Frozen SHA / Git 状态

| 项 | 值 |
|---|---|
| Frozen Implementation（W11-A U3） | `ec618eb81684d645707c70a8b69ff9379682fbaa`（tree `908c10310cd92a509374ada2bd31b5882be580f2`） |
| Closure HEAD | `ebe3363fe88d64222a6aa619a932bfe9a4fa3578` |
| WIP 父提交 / Recovery 基线 | `60f3fbd169d7b43bbae3824b10b538edef4aeec1` / `8c716f64dbeb8d650c3dd87a43661ed205fdcfdd` |
| 分支 | `review/w11a-u3-fast-blocked-20261030`（GitHub 与 Gitee 同名 Review Branch 均已指向 Closure HEAD） |
| `master`（两端） | `aee1e0c13d26dd840ae4b596340212eef03479c0`（未变） |
| Release tag | `v1.6.0` / `v1.6.1` / `v1.6.2`（未变） |
| 版本 | `1.6.2`（未变） |

### 五条端到端主链闭合情况

| 主链 | 步骤齐备 | 结构完整 | 主要断点 |
|---|---|---|---|
| Order-to-Cash | 10/10 | 是 | 识别模式分支（`LEGACY_DIRECT` 的 AR 来源是 Delivery 而非 Invoice）；AR aging 不带 source 维度 |
| Procure-to-Pay | 12/12 | 否 | **Receipt Notice → Purchase Receipt 转换未接线**（`assertNoticeCompatibleWithReceipt` 无生产调用点）；`SEPARATE` 下 GRNI→Bill 为人工 |
| Plan-to-Produce | 9/9 | 是 | Planned Order → Production Instruction → Production Order 经 `production_instruction_items.planned_order_id` 与 `production_orders.production_instruction_item_id` **两跳 FK 完整可追溯**；仅指令表头不直接携带 `planned_order_id` |
| Plan-to-Outsource | 9 识别 / 4 不可达 | 否 | `outsourcing_receipt_items` 无生产写入路径；processing-fee bill 无 GL 凭证；无 `receiptNoticeId` FK |
| Record-to-Report | 7/7 | 部分 | 无 Accounting Event 层（FO58 无实现）；TB/P&L/BS 不保留 source 维度，报告终点不可回溯业务单据 |

### 当前 Release Blockers

| 标识 | 状态 | 阻塞范围 |
|---|---|---|
| `W10-INV-RISK-01` | `BLOCKS_RELEASE_ONLY` | 仅发布 |
| `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` | 冻结且发布阻塞 | 发布 |
| `LEGACY_DATA_EVIDENCE_PENDING` | 开放 | 非阻塞（外部证据依赖未解） |
| `CREDENTIAL_EXPOSURE_OPEN` | `USER_ACCEPTED / DEFERRED` | 非阻塞（**已被接受并延后，不等于风险消除**） |
| `R-U3-INV-09` | `ACCEPTED_RESIDUAL` | 非阻塞（限 Selector 精确身份过滤的已测 Collation 差异） |
| `R-U3-INV-10` | `DEFERRED_OUT_OF_SCOPE` | 阻塞受影响目标的部署/迁移 |
| `CURRENT ACCEPTANCE HARNESS DRIFT` | 开放 | Procurement 最终验收/冻结 |
| `D-2` / `D-3` / `D-4` / `D-5` | 开放设计决策 | W11-B、W11-C |

### 当前推荐的下一个工作包

**A — 项目 Git / 文档基线纠偏**（即本节）。理由：当前 canonical 文档陈述的仍是若干阶段之前的
状态，任何后续业务包都会基于错误基线被规划与复核；本包零回归风险、零 MySQL 依赖，且已把
两项源码级缺陷（`outsourcing_receipt_items` 无生产写入路径、processing-fee bill 无 GL 凭证）
写入待治理清单。详见 `document.md §35` 与 `solution.md §37.54.48`。

---

## 当前主要 Gap

> 本节仍以 `document.md §22` / §35 的权威 Coverage 来源为准；下列条目为**面向下一步的深化方向**，
> 不是能力缺失的最终判定。凡与 §35 冲突，以 §35 与对应 Domain Closure 为准。


### Master & Engineering 仍保留的跨域 / deferred Gap

- Organization / Organization Scope（Multi-Organization 基线外）
- Bin / 仓位（Inventory & Warehouse 所有）
- 完整 MRP substitute 消费与完整委外执行
- 完整 APS / MES / HMI
- Mold / Mold Combination 与复杂 Auxiliary Attributes（缺原手册细节证据）

### Sales & Customer

- Credit Profile / Credit Limit / Occupancy / Credit Check / Special Approval（Wave 9 基础与 Wave 10 运行时已实现并验收冻结）；
  Wave 11 的**信用查询 / 异常历史 / 选择器 / 搜索语义已验收冻结**（W11-SEC-01、U1、U2、OVERDUE、U3），
  **尚未实施**的是信用评估基础与多评分/评级应用（W11-B / W11-C）与信用对账重算（W11-D）
- 更完整的 replacement / replenishment obligation

### Planning

- 更细粒度的时界/批量/合并策略与 APS 深化
- 替代料自动消耗策略深化
- 完整委外执行（当前只提供 OUTSOURCE 计划释放交接，不替代委外子域）
- 跨组织计划（Multi-Organization 基线外）

### Procurement & Outsourcing

- 已实现 Sourcing、Supplier Allocation / Quota、采购价格与折扣、PO Change、Receipt Notice、采购退货四分支、Procurement Scan；
- VMI business layer 已实现；Inventory owner-dimension 物理动作当前明确 fail closed；
- Outsourcing Order、材料发/退/补、倒冲、收货、加工费 Supplier Bill/AP、成本证据、完工退货商业贷项、差异/WIP/报表已实现；
- **历史检查点（2026-10-09）**：functional browser UAT 25/28 PASS，缺口为 authoritative Planning handoff
  consumption、Completion Receipt Notice、`OUTSOURCING_RECEIPT` Inspection。**该检查点已被后续实现取代**：
  OUT-05 / OUT-17 / OUT-18 已在源码落地，11 个采购委外真实 handler race 已有 11/11 真实 MySQL 证据。
  当前 Domain 仍未冻结，原因是 `document.md §31.11` 仍记 `NOT READY`，且存在新的验收 harness 漂移；
  详见「当前项目状态快照」的 Release Blockers；
- responsive browser matrix 为 7 surfaces × 320/390/430/680 = 28/28 PASS；disposable MySQL 8 integration/concurrency/performance gates PASS。

### Manufacturing & Quality

- Dispatch
- Operation Transfer
- 更多检验类型
- Non-conformance disposition

### Inventory & Warehouse

> Bin、Stock Status、Form Conversion、库存锁定与预留、ABC 报表的**数据模型与权威写入已实现**
> （`warehouse-bin.js`、`stock-status.js`、`inventory-form-conversion.js`、`inventory-lock.js`、
> `inventory-availability.js`、`/api/inventory-abc`）；下列为仍待闭合的部分。

- Barcode **生成与标签打印**（当前只有解析/校验/规则与绑定 CRUD）
- PDA 执行层（扫描 → 生成业务单据）与盘点扫码入口、收发货扫码校验
- Assembly / Disassembly（库存组装/拆卸）
- Bin / Stock Status / Owner Dimension / Stocktake 的 **HTTP CRUD 路由尚未登记**
  （模块存在但未被 `server/app.js` 引入）
- Inventory Age / Obsolete 等深化

### Finance Operations

- 更深的票据背书/贴现会计联动与现金预测
- 批量发票、法定电子发票及税务硬件集成（法定电子发票与税务硬件集成为 **OUT_OF_SCOPE**）
- Purchase Expense Allocation
- 多币种

> 固定资产（B3107）已按 `document.md §33.1.3` 归属 **Accounting & Analytics**，不再列入 Finance Operations。
> 付款申请、现金盘点、银行对账、Treasury 关账、到期计划与账单生命周期均已实现；仍缺 GRNI 反冲
> （设计如此）与 FO13 暂估转正式的**反冲**一半。

### Accounting & Analytics

- Smart Accounting Rule Engine
- Accounting Event / Voucher Template 深化
- Business ↔ GL Reconciliation 产品化
- Cash Flow
- Report Designer / Formula Engine
- Management Accounting / Operating Ledger / Amoeba
- 完整 Fixed Asset 生命周期（B3107 归属本 Domain，见 `document.md §33.1.3`）

### Platform

- Generic Workflow
- Workflow Definition / Instance / Node / Action
- Document Relationship
- Document Conversion
- Numbering
- Organization Scope

## 核心产品范围收口

以下现有扩展不属于 B3101–B3122 核心 ERP 产品范围，已确定从最终产品移除：

- `projects`
- `tasks`
- `timesheets`
- `contacts`（现有 CRM Extension）
- `followups`
- `activities`

重要边界：

- 删除 CRM `contacts` 不等于删除 ERP Customer/Supplier Contact；
- 客户联系人、收货地址、结算方、付款方等仍属于核心 Sales & Customer；
- 若旧 contacts 数据可迁移为核心联系人，必须先迁移再删除；
- 原 `projects-workflow.jsx` 与 `server/modules/business.js` 已完成 Platform ownership 提取；
- notifications / workflows 分别由明确的 Platform page/module 承载，workflows 用户 Route 仍保持 disabled；
- 历史数据库表不得在普通代码清理中直接 DROP；
- schema cleanup 必须单独完成数据保留、备份、SQLite/MySQL migration 与 rollback 设计。

## 必须保持的端到端主链

### Order-to-Cash

`Customer / Quotation → Sales Order → Credit → Planning/Reservation → Delivery/OQC → Inventory/COGS → Sales Invoice → AR → Collection/Credit/Refund/Write-off → Accounting`

### Procure-to-Pay

`Demand/MRP → Purchase Requisition → Sourcing → Purchase Order → Receipt/IQC → Inventory/GRNI → Supplier Bill / AP → Payment/Credit/Refund/Write-off → Cost/Accounting`

### Plan-to-Produce

`Sales Order/Forecast → MRP → Planned Order/Instruction → Production Order → BOM/Material List → Issue/Return/Supplement → Operation Execution → Inspection → Production Receipt → WIP/Cost`

### Plan-to-Outsource

`MRP → Outsourcing Plan/Order → Outsourcing Material List → Issue → Supplier Processing → Receipt/Inspection → Outsourcing Receipt → Processing AP → Material + Processing Cost`

### Record-to-Report

`Business Facts → Inventory/AR/AP/Treasury/Asset/Cost → Accounting Event → Voucher → GL → Period End → Financial Reports / Management Accounting`

## 当前运行限制

当前事实仍然是：

- 单组织；
- 单本位币；
- Generic Workflow 尚未完成（当前只有 `approval_workflows` 定义表与其 `steps` JSON 列，
  **没有任何执行引擎**；审批仍是 6 个领域硬编码适配器）；
- Credit 的**评估 / 评分 / 对账**（W11-B / W11-C / W11-D）尚未实施；信用查询侧已验收冻结；
- Barcode 的**生成与 PDA 执行层**尚未完成；完整 Outsourcing 子域已实现；
- 部分 `cash-journals` / `bills` / `fixed-assets` / `workflows` 用户 Route 仍 disabled；
- `server/app.js` 与部分页面仍较大；

### 当前发布阻塞项

生产发布**未获授权**。当前阻塞标识与状态：

| 标识 | 状态 | 阻塞范围 |
|---|---|---|
| `W10-INV-RISK-01` | `BLOCKS_RELEASE_ONLY` | 仅发布 |
| `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` | 冻结且发布阻塞 | 发布 |
| `LEGACY_DATA_EVIDENCE_PENDING` | 开放 | 非阻塞 |
| `CREDENTIAL_EXPOSURE_OPEN` | `USER_ACCEPTED / DEFERRED` | 非阻塞（已接受并延后） |
| `R-U3-INV-09` | `ACCEPTED_RESIDUAL` | 非阻塞 |
| `R-U3-INV-10` | `DEFERRED_OUT_OF_SCOPE` | 阻塞受影响目标的部署/迁移 |
| `CURRENT ACCEPTANCE HARNESS DRIFT` | 开放 | Procurement 最终验收/冻结 |
| `D-2` / `D-3` / `D-4` / `D-5` | 开放设计决策 | W11-B、W11-C |
- 部分领域仍存在 mixed-owner 文件。

这些是**当前限制**，不是永久产品原则。Organization-ready、多币种等后续通过对应 Capability 的 Requirement/Design 独立实现；在真正完成前不得通过 UI 或文档宣称已经支持。

## 实际技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19、Vite 7 |
| 后端 | Node.js 22.23.2 原生 HTTP |
| 数据库 | SQLite（本地/测试兼容）与 MySQL 8（一等运行后端） |
| 数据库驱动 | Node `node:sqlite`、`mysql2` worker adapter |
| 反向代理 | Nginx |
| 进程管理 | systemd |
| 包管理 | pnpm |

项目不使用 Express、Koa 或 PM2。

## 快速开始

要求 Node.js 22.23.2 和 pnpm。

```bash
pnpm install
pnpm dev
```

默认开发入口：

- 前端：http://127.0.0.1:5173
- API：http://127.0.0.1:3001

生产式本地启动：

```bash
pnpm build
pnpm start
```

Windows 可在构建后使用仓库现有 `start-local.ps1`。

## 环境与数据库后端

项目不依赖 `dotenv` 自动读取；变量必须由 shell、进程管理器或 systemd `EnvironmentFile` 注入。

SQLite 示例：

```bash
ERP_DB_BACKEND=sqlite
ERP_DB_PATH=./data/erp.db
```

MySQL 8 示例：

```bash
ERP_DB_BACKEND=mysql
ERP_DB_HOST=127.0.0.1
ERP_DB_PORT=3306
ERP_DB_NAME=modern_erp
ERP_DB_USER=modern_erp
ERP_DB_PASSWORD=<provided-securely>
```

禁止把真实密码、Token、连接串写入仓库、日志、fixture、截图或命令示例。

MySQL destructive/reset 测试只能运行于明确标识为 disposable/test 且显式启用 reset guard 的数据库。
执行 destructive MySQL gate 前还必须同时提供 `ERP_MYSQL_TEST_ALLOW_RESET=true`、与实际配置完全一致且不含密码的
`ERP_MYSQL_TEST_DISPOSABLE_TARGET=mysql://<user>@<host>:<port>/<database>`，以及
`ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS=DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP`。
数据库名称含有 `test` 仅作为附加防护，不能单独证明 disposable ownership。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 同时启动前端与 API 开发环境 |
| `pnpm build` | 构建前端到 `dist/` |
| `pnpm start` | 启动生产式 Node 服务 |
| `pnpm test:fast` | 日常快速回归 |
| `pnpm test` | canonical 完整回归 |
| `pnpm test:heavy` | backup / deployment / production bootstrap 等 heavy gate |
| `pnpm test:all` | FULL + HEAVY |
| `pnpm test:list` | 列出 FULL suite 文件 |
| `pnpm test:mysql` | Wave 7 Gate A-only MySQL A-PARITY/A-PROD/A-RAW/A-TXLIFE 整合门禁 |
| `pnpm test:mysql:legacy` | 旧通用 MySQL 兼容 gate（不属于 Gate A） |
| `pnpm test:mysql:concurrency` | MySQL 并发 gate |
| `pnpm test:mysql:gate-a` | 与 `test:mysql` 相同的 Gate A-only 入口：A-PARITY/A-PROD/A-RAW/A-TXLIFE |
| `pnpm test:mysql:wave10` | 受保护的 Wave 10 MySQL parity/upgrade + W10-R1..R12 独立会话验收 + M-BIZ-01..20 业务矩阵 Runner；必须单独授权 |
| `pnpm test:mysql:gate-b` | 独立 Gate B Runner：七个固定案例与实际执行派生 M-board；必须单独授权 |
| `pnpm test:mysql:wave11-sec` | W11-SEC-01 Credit Read Scope 真实 MySQL 验收门禁（受保护，单 suite） |
| `pnpm test:mysql:wave11-a` | W11-A Credit Query / Exception History 真实 MySQL 验收门禁（受保护，单 suite） |
| `pnpm test:mysql:wave11-a:selector` | W11-A U3 Selector 搜索语义真实 MySQL 门禁（受保护，独立 campaign 与 suite 标签） |
| `pnpm test:mysql:inventory-demo-seed` | W11-A U3 Demo Seed 库存规范位置真实 MySQL 门禁（受保护，独立 campaign 与 suite 标签，M-INV-01..08） |
| `pnpm test:mysql:local` | 统一本机 MySQL Gate launcher：读取 DPAPI 凭据、核验固定身份基线、串行执行受保护 Gate、复核清理归零 |
| `pnpm test:mysql:local:setup` | 一次性建立统一本机 MySQL 测试目标：掩码提示输入测试账号口令、DPAPI 加密保存、建立固定身份基线 |
| `pnpm test:mysql:finance-concurrency` | Finance Operations 域 15 路 MySQL 真并发回归（RACE-01..15） |
| `pnpm test:mysql:performance` | MySQL 性能测试 |
| `pnpm test:finance:responsive` | Finance 六入口 × 320/390/430/680 真实浏览器验收 |
| `pnpm test:finance:uat` | Finance Operations 58 项能力矩阵 + 32 项最终业务 UAT |
| `pnpm test:sales:wave2-responsive` | Sales Wave 2 定价/折扣工作面 320/390/430/680 真实浏览器验收 |

Finance Operations 的 FO01–FO58 服务、界面/API、schema、测试与 UAT 追溯见 [能力矩阵](docs/operations/finance-operations-capability-matrix.md)。
| `pnpm backup-db` | SQLite 备份 |
| `pnpm restore-db -- <file>` | SQLite 恢复 |
| `pnpm setup-admin -- --username <name> --password <secret>` | 显式创建首个管理员 |
| `pnpm reset-data` | 仅开发/测试 SQLite 数据重置 |

## 仓库地图

```text
src/main.jsx
src/App.jsx
src/api.js
src/navigation/
src/pages/
src/components/
src/styles/
src/lib/

server/index.js
server/app.js
server/db.js
server/modules/
server/database/
server/migrations/
server/lib/
server/*.test.js

scripts/runtime/
scripts/admin/
scripts/gates/
scripts/diagnostics/
scripts/acceptance/
scripts/testing/

deploy/
docs/operations/
docs/archive/
docs/releases/
docs/evidence/
log/
.claude/skills/erp-mobile-taste/
```

关键责任：

- `src/navigation/applicationRegistry.js`：最终用户 Route、权限、导航、Launcher、Presentation 和 Screen 的 canonical registry；
- `src/navigation/domainMetadata.js`：8 Business Domains + Platform 的唯一 canonical taxonomy；
- `src/pages/platform-notifications.jsx` / `platform-workflows.jsx`：Platform 通知与工作流用户界面 owner；
- `src/pages/engineering-reference.jsx` / `engineering-substitute.jsx` / `engineering-change.jsx`：Master & Engineering 工程资料、替代/配置、ECO 工作面；
- `src/pages/planning-workbench.jsx`：Planning 计划订单与计划员例外工作台；
- `src/pages/finance-operations.jsx`：Finance Operations 发票与资金 hub；应收、收款、应付、付款沿用各自 canonical 工作面；
- `src/components/BomGovernancePanel.jsx`：BOM lifecycle、tree/analysis 与 batch preview→apply 可复用工作面；
- `src/navigation/routeLocation.js`：hash RouteLocation 解析/序列化/规范化；
- `server/app.js`：HTTP 生命周期、认证分发和仍未拆出的 handler；
- `server/modules/`：逐步形成 domain canonical owner；
- `server/modules/platform-notifications.js` / `platform-workflows.js`：Platform 通知与工作流 API owner；
- `server/modules/planning.js` / `planning-domain.js`：MRP 运算与 Planning 方案、预测冲销、计划订单、预留、工作台 canonical owner；
- `server/modules/sales-parameters.js` / `sales-foundation.js` / `sales-commercial-foundation.js`：Sales Wave 1 参数、组织人员和商业资料 canonical owner；
- `server/modules/sales-pricing.js`：Sales Wave 2 价目表、价格版本、折扣规则、生命周期及两个纯读 resolver 的 canonical owner；
- `server/modules/sales-quotations.js` / `sales-orders.js` / `sales-order-changes.js`：Sales Wave 3–4 报价、权威订单写入与受控变更 owner；
- `server/modules/delivery-notices.js` / `sales-delivery-source.js`：Sales Wave 5 发货通知和销售出库来源/容量控制 owner；
- `server/modules/credit-policy.js` / `credit-profile.js` / `credit-anchor.js`：Sales Wave 9 信用参数与规则、信用档案、信用锁锚点 owner；
- `server/modules/credit-scope.js`：Credit 授权 canonical owner —— 信用档案五档读取数据范围（ALL / DENY / CROSS_GROUP / AGGREGATE_PLUS_SELF / AGGREGATE_ONLY）、集中管理写入权威、全局配置读取权威、信用评估 / 特别审批申请 / 特别审批决策三项能力权威；纯内部 Credit 解析器不在此文件，保持 actor-free；
- `server/modules/credit-check.js`：Sales Wave 10 信用检查 canonical owner —— `evaluateCredit()` 运行时序列（§36.6.3 步骤 1–10）、适用信用范围解析、PURE_DERIVED 敞口投影、L2–L5 锁链、策略快照绑定与特别审批消费；
- `server/modules/credit-special-approval.js`：Sales Wave 10 信用特别审批 canonical owner —— 申请、决策、权限上限、失效业务日期、范围模式、申请审批分离与幂等；
- `server/migrations/sales-customer-wave10-credit-check.js`：Wave 10 两张新表 `credit_check_results` / `credit_special_approval` 的双数据库结构与幂等升级；
- `server/migrations/sales-customer-wave2-pricing.js`：Wave 2 五表、客户商业扩展两个可空 FK、四列业务 UNIQUE 与双数据库身份触发器；
- `server/migrations/sales-customer-wave3-quotation.js` / `sales-customer-wave4-orders.js` / `sales-customer-wave5-delivery.js`：Batch A 七张新表及既有订单/出库表 additive schema；
- `server/db.js`：SQLite 基础 schema、seed、transaction 和数据库创建，以及 MySQL 事务生命周期安全（pre-BEGIN 准入守卫、回滚结算门、命名锁已验证释放）；
- `server/migrations/sales-customer-domain.js`：Sales & Customer 按 Wave/id 确定排序的 canonical migration entrypoint；SQLite 初始化与 MySQL live-upgrade 共用，所有未来步骤必须幂等；
- `server/database/`：MySQL adapter / worker / protocol / schema bootstrap 与 additive reconciliation；
- `server/migrations/`：增量 schema migration；
- `scripts/testing/`：suite manifest、runner 和 governance；
- `docs/archive/`：历史证据，不是当前规格；
- `log/`：append-only 开发记录。

## 测试与质量门

### 日常有界任务

```bash
pnpm test:fast
pnpm build
git diff --check
```

### 跨域 / 架构 / canonical metadata / release-candidate

```bash
pnpm test
pnpm build
git diff --check
```

### 数据库 / 备份 / 部署 / migration / MySQL adapter 等 high-risk 任务

在完整回归基础上追加：

```bash
pnpm test:heavy
```

以及实际受影响且具备受保护 disposable MySQL 环境时的：

```bash
pnpm test:mysql
pnpm test:mysql:gate-a # 与 test:mysql 相同的 Gate A-only 入口
pnpm test:mysql:legacy # 旧通用门禁，仅在单独授权时运行
pnpm test:mysql:concurrency
pnpm test:mysql:finance-concurrency
pnpm test:mysql:wave10 # Wave 10 protected campaign；仅在精确目标授权后运行
pnpm test:mysql:gate-b # 独立 Gate B campaign；仅在精确目标授权后运行
```

release candidate / migration release / 生产认证可运行：

```bash
pnpm test:all
```

测试分层与具体 suite 以 `scripts/testing/test-suites.js` 和 `docs/operations/testing.md` 为准，不在 README 硬编码会快速过期的测试数量。

Sales & Customer Batch A 的独立浏览器验收脚本（需要本机 Edge、现有构建产物，使用一次性 SQLite 测试库）：`node scripts/acceptance/sales-customer-batch-a-acceptance.mjs`。脱敏证据写入 `docs/evidence/sales-customer-batch-a/`；该脚本不替代上述回归与 MySQL 门禁。

## 部署入口

- `.env.example`
- `deploy/nginx/modern-erp.conf`
- `deploy/systemd/modern-erp.service`
- `deploy/systemd/modern-erp-backup.*`
- `docs/operations/deployment.md`

生产目标路径为 Ubuntu 22.04 + Node.js 22.23.2 + MySQL 8 + Nginx + systemd。

## Canonical 文档

- `README.md`：项目入口、技术栈、运行/测试/部署、目录和发布状态；
- `document.md`：唯一当前功能与业务需求来源；
- `solution.md`：唯一当前技术设计与实现参考；
- `AGENTS.md`：唯一当前开发与 AI/Vibe Coding 治理政策；
- `CLAUDE.md`：Claude Code 入口，只引用 `AGENTS.md`；
- `log/YYYY-MM-DD.md`：append-only 开发历史；
- `docs/`：运维资料和历史证据，不得形成第二套当前规格。

`APPLY_GUIDE.md` 不是 canonical 文档，仅可用于一次性恢复/应用说明；恢复完成后可以删除。

## 当前开发主线

当前执行顺序：

```text
DOCUMENT BASELINE
→ CORE SCOPE CLEANUP
→ DOMAIN ALIGNMENT
→ B3101 ... B3122 CAPABILITY CLOSURE
```

单个业务能力遵循：

```text
AUDIT
→ COVERAGE / GAP
→ REQUIREMENT
→ DESIGN
→ IMPLEMENTATION
→ ACCEPTANCE / FREEZE
```

22 手册负责“不漏业务”；8 Domains + Platform 负责“系统最终怎么组织”。

## Vibe Coding 与 UI Skill

所有 AI/Claude Code/Codex 开发必须遵守 `AGENTS.md`。

`.claude/skills/erp-mobile-taste/SKILL.md` 只用于用户明确要求的 UI Design、Mobile UX、Layout、Responsive Design 任务。它不得改变：

- ERP 业务术语；
- API；
- schema；
- 权限；
- 状态机；
- Approval / Confirm / Post / Reverse 语义；
- 上下游来源关系；
- 财务、库存和审计事实。

业务正确性优先于视觉简化。

## Git 与安全

- 使用本地 Git；
- 中文 commit；
- 每次逻辑单元及时提交；
- 未经用户明确批准不 push / tag / merge / deploy；
- 不重写 Git 历史；
- 不移动或重建既有 release tag；
- 不提交 `.env`、数据库、备份、真实日志、Token 或密码；
- 破坏性数据库操作必须单独批准。

私有项目，禁止外传。

## Wave 8 销售履约扩展（已验收并冻结）

当前工作树已实现 Service Fulfillment 与 Consignment 的上下文工作面，并保留全局 Launcher 不新增主入口：

- 销售订单可进入 Service Fulfillment，执行 `PENDING / CONFIRMED / CANCELLED` 流程；
- Consignment 支持商业地点、指令、Handoff、Settlement、Return 与三层查询；
- Consignment 的物理库存变化仍由 Inventory V21 canonical writer 负责，Finance 暴露仍由既有 Finance writer 负责；
- `inventory_mutation_log` 仅增加经批准的九个 nullable 历史位置证据字段，没有第五张 Wave 8 业务表或影子库存/AR；
- SQLite 与 MySQL 8 迁移均走 canonical migration lifecycle，旧行保持可读且不做猜测式 backfill；
- Wave 8 四张业务表在 MySQL 上由共享 snapshot reconciliation 先行创建；migration 追加只读的 `information_schema` 物理合同断言（列/默认值/NULL/CHECK/FK/UNIQUE/index 顺序/collation），结构不兼容时 fail closed 且不做修复性 DDL；`lot_code_key` 已按最终设计收敛为 MySQL binary collation，并保留升级前歧义检测。
- `SALES_VIEW` 是本轮新增权限且有 §35.18.8 批准依据，不是 HEAD 既有权限；Wave 8 读取判定为 `SALES_MANAGE OR SALES_VIEW` 再叠加对应窄权限，写入判定为 `SALES_MANAGE` + 窄权限。

Wave 8 测试入口：

- `server/sales-customer-wave8-functional.test.js`：Stage D 功能与证据回归；
- `server/sales-customer-wave8-remediation.test.js`：P0/P1 反例复现与闭环（P0-1 零金额、P0-2 SO 商业权威、partition entitlement、handoff 仓库、三层报告、RBAC、C1 锁序证据）；
- `server/sales-customer-wave8-mysql-metadata.test.js`：四表 MySQL 既有结构 fail-closed 证明；
- `server/sales-customer-wave8-mixed-delivery.test.js`：混合/纯服务 Delivery 与 RBAC 负向矩阵（真实 HTTP 面）；
- `server/mysql-sales-customer-wave8-concurrency.integration.js`：真实 MySQL 独立会话 R-SAL-20/21/22 与 A3 竞态。
- 浏览器响应式与 direct/refresh/back/forward 入口为 `node scripts/acceptance/sales-customer-wave8-acceptance.mjs`（本机 Edge，320/390/430/680 CSS px）。

用户已于 2026-10-21 明确确认 `WAVE8_FINAL_ACCEPTANCE_PASS`。上述 Wave 8 批准范围现作为冻结基线；冻结仅适用于 Wave 8，不冻结整个 ERP 项目，也不授权 Wave 9–13、发布、部署或版本变更。

## 统一本机 MySQL 测试目标

本机全部真实 MySQL 集成测试统一使用**同一个实例、同一个 Schema、同一个最小权限账号**：

| 项 | 值 |
|---|---|
| Host / Port | `127.0.0.1` / `3306` |
| Database | `modern_erp_domain_test` |
| User | `modern_erp_test` |
| 口令 | 不入库；由 Windows 当前用户的 DPAPI 加密保存 |

本机当前仅存两个用户项目 Schema：统一测试目标 `modern_erp_domain_test`（专用空库）与历史遗留的
`calculator_db`。`calculator_db` 仍存在 `calculation_history` 的 Missing Tablespace 问题
（其 `.ibd` 文件缺失，MySQL 错误日志持续记录），**并未恢复正常**；本项目不使用它，
受保护 Gate 也不会触碰它。

一次性设置（掩码提示输入口令 → DPAPI 保存 → 建立固定身份基线）：

```bash
pnpm test:mysql:local:setup
```

此后运行受保护 MySQL Gate 只需一条命令：

```bash
pnpm test:mysql:local                                   # 默认运行 W11-SEC Gate
powershell -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:wave10
```

`pnpm test:mysql:local` **当前默认只运行 W11-SEC Gate**，这**不代表全部历史 MySQL Gate 已完成适配**：

| Gate | 与统一目标的关系 |
|---|---|
| `test:mysql:wave11-sec` | 统一 launcher 的默认目标，已在本机实测通过 |
| `test:mysql:wave10` / `test:mysql:gate-b` | 复用同一受保护 runner，可用同一 launcher 调用；本轮**未**重跑 |
| `test:mysql:finance-concurrency` / `test:mysql:performance` | 可运行，但**绕过**受保护合同（不校验 disposable target 身份指纹），且其 runner 只 `DROP TABLE`、不满足五类归零清理合同；尚未接入统一 launcher |
| `test:mysql`（gate-a）/ `test:mysql:concurrency` / `test:mysql:legacy` | **尚未适配**：其并发套件要求 `information_schema.PROCESSLIST` 可见，最小权限账号无 `PROCESS` 权限；不得以扩大测试账号权限绕过 |

launcher 会依次：读取 DPAPI 凭据 → 只读核验身份与空库 → 取得机器级互斥锁（所有会清理 Schema 的 Gate 串行执行）→ 运行 Gate → 用新会话复核五类对象归零。

固定身份基线（server UUID / CURRENT_USER / grants SHA-256）保存在
`%LOCALAPPDATA%\ModernERP\mysql-gate\target.json`，**只被比较，从不被重新生成**；
身份漂移会被拒绝启动，重新建立基线必须显式执行 setup 脚本。

**运行前提**（launcher 的只读 preflight 逐项核验，任一不满足即拒绝启动 Gate）：

- `MySQL80` 服务正常运行，`127.0.0.1:3306` 可达；
- 固定身份基线有效 —— server UUID / CURRENT_USER / grants SHA-256 与基线一致，漂移即拒绝启动；
- 专用数据库 `modern_erp_domain_test` 初始为空（五类对象计数全 0）；
- 最小权限合同匹配 —— 由仓库既有 `assertExactLeastPrivilegeGrants` 核验，本仓库不复制第二份权限清单；
- Trigger bootstrap 前置条件满足 —— 见下节。

**Trigger bootstrap 前置条件（`log_bin_trust_function_creators`）**：

本机 MySQL 开启二进制日志（`log_bin=1`）时，最小权限账号无法 `CREATE TRIGGER`，
而 Gate 的 Schema bootstrap 必须创建触发器（`inventory_mutation_log` 3 个 + Wave 2 价格 3 个），
因此必须开启 `log_bin_trust_function_creators=1`。这是**服务器级开关**，不改变账号授权集合，
也不改变固定身份基线。

- 该开关当前值 `1` 是**运行时设置**（`SET GLOBAL`），**不持久化**：实例配置文件未指定该项，
  `mysqld-auto.cnf` 不存在，`performance_schema.variables_info` 报 `VARIABLE_SOURCE = DYNAMIC`。
- `MySQL80` **重启后会回到默认值 `0`**。届时二进制日志仍开启，最小权限账号将无法创建触发器，
  Gate 会在 Schema bootstrap 阶段以 `ER_BINLOG_CREATE_ROUTINE_NEED_SUPER` 失败。
- 重启后必须先通过**单独的、经授权的管理员操作**恢复该前置条件，再执行 Gate。
- **普通 launcher 不得自动以 root 修改全局变量** —— 该动作不属于 Gate 流程，必须显式授权、单独执行。
- **不允许为绕过该问题扩大 `modern_erp_test` 的权限**（例如授予 `SUPER` / `SET_USER_ID`），
  也不允许改动 Schema 跳过触发器；二者都会破坏最小权限合同与业务控制。

## Gate A 销售 Wave 7 MySQL 门禁（已验收并冻结）

`pnpm test:mysql` 与 `pnpm test:mysql:gate-a` 指向同一个受保护的 bounded Gate A runner，只运行
A-PARITY / A-PROD / A-RAW / A-TXLIFE 四个套件。旧通用 MySQL gate 保留在独立的
`pnpm test:mysql:legacy` 与 `pnpm test:mysql:concurrency`，不属于 Gate A。

用户已于 2026-10-24 明确接受 `GATE_A_MYSQL_CAMPAIGN_PASS`。一次授权的真实 MySQL 执行
（`mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`，MySQL 8.0.37）四套件全部 PASS：

| 套件 | 用例文件 | 结果 |
|---|---|---|
| A-PARITY | `server/mysql-sales-customer-wave7.integration.js` | 4 / 4 PASS |
| A-PROD | `server/mysql-sales-customer-wave7-concurrency.integration.js` | 6 / 6 PASS |
| A-RAW | `server/mysql-sales-customer-wave7-raw-locks.integration.js` | 4 / 4 PASS |
| A-TXLIFE | `server/mysql-transaction-start-safety.integration.js` | 8 / 8 PASS |

- 冻结仅适用于 Gate A 验收边界，不冻结整个 ERP 项目；
- **历史状态（2026-10-24 记录时）**：Gate B 保持 `BLOCKED_BY_WAVE10`，Wave 10 已实现但尚未验收，
  Wave 11 未启动。**该状态已被后续记录取代**：Wave 10 已于 2026-10-27 完成验收并冻结
  （`WAVE10_FULL_ACCEPTANCE_PASS` / `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`），
  Wave 11 已推进至 W11-SEC-01 与 W11-A U1/U2/OVERDUE/U3。Gate B 与 Wave 10 的**发布**仍阻塞，
  详见「当前项目状态快照」的 Release Blockers；
- 该冻结不是 Git commit、tag、发布、部署、migration 或版本变更。

## Wave 10 信用检查与特别审批（已验收并冻结）

Wave 10 在 Wave 9 信用基础上实现首个可执行信用运行时：

| 交付物 | 文件 |
|---|---|
| 两张新表与双数据库迁移 | `server/migrations/sales-customer-wave10-credit-check.js` |
| 信用检查引擎 | `server/modules/credit-check.js` |
| 信用特别审批工作流 | `server/modules/credit-special-approval.js` |
| 销售订单提交 / 审批与销售出库确认集成 | `server/modules/sales-orders.js`、`server/app.js` |
| 信用检查评估与信用特别审批页面 | `src/pages/credit-check.jsx` |
| 集中测试 | `server/sales-customer-wave10-credit-check.test.js` |

API：`POST /api/credit/check`、`GET /api/credit/check-results`、`POST /api/credit/special-approvals`、
`GET /api/credit/special-approvals`、`GET /api/credit/special-approvals/:id`、
`POST /api/credit/special-approvals/:id/decide`。

- 信用敞口完全由销售与财务权威事实派生，不存在第二套信用余额或物理敞口缓存；
- 信用检查在销售订单提交、销售订单审批、销售出库确认三个阶段执行，缺失强制档案时后端 fail closed；
- 信用管理默认关闭（`CREDIT_MANAGEMENT_ENABLED` 缺省 false），未启用时既有业务流程行为完全不变；
- 特别审批只对产生该结论的一个信用范围有效，受权限上限、失效业务日期与申请审批分离约束；
- **Wave 10 已于 2026-10-27 验收并冻结**（`WAVE10_FULL_ACCEPTANCE_PASS`）；能力冻结但**发布仍阻塞**
  （`WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`）。Wave 11 已推进至 W11-A U3（2026-10-31 验收冻结）。
  冻结记录：`document.md` "Wave 10 Capability Freeze (2026-10-27)"。

### Wave 10 MySQL readiness

- The live MySQL initialization path now recreates the canonical
  `finance_open_item_effects` derived View after its dependency tables are bootstrapped, matching
  SQLite fresh, repeated and upgrade initialization behavior.
- The protected Wave 10 Guard requires the exact dedicated-account contract: the eleven approved
  target-schema privileges, three table-scoped Performance Schema reads, global `USAGE` only, no
  roles and no grant delegation. The trusted normalized grant SHA-256 remains an explicit
  preflight input.
- The prepared account is `modern_erp_wave10@127.0.0.1`; its credential is intentionally not
  stored in this repository. Real Wave 10 MySQL Acceptance remains separately authorized.
