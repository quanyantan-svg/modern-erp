# README 2026-10-31 抽离章节（历史副本）

> 状态：`ARCHIVED`
> Owner：Platform
> 权威来源：无 —— 本文件是 README 旧章节的历史副本；规范来源是 `document.md` §6（端到端主链）、
> §8（当前运行限制）、§9（非核心扩展范围收口）与 `docs/status/PROJECT_STATUS.md` §35.8/§35.9（当前断点与 Release Blockers）
> 来源：`README.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移）

---

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
