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
- 请购、采购订单、收货、退货、供应商账单、AP 与付款/核销；
- Forecast、MRP、Demand/Supply、Pegging、生产/采购指令与请购；
- 生产订单、BOM/Routing snapshot、领料、退料、工序报工、生产入库；
- IQC/OQC、质量门禁；
- Inventory、调拨、盘点、调整、报废、期间关闭；
- LOT/SERIAL、HOLD/RELEASE、Traceability 与 Production Genealogy；
- Inventory Valuation、WIP、COGS、GRNI 等财务库存基础；
- Voucher、GL、Trial Balance、Income Statement、Balance Sheet；
- Decision Reports；
- SQLite 本地/测试兼容路径；
- MySQL 8 一等运行路径；
- applicationRegistry / RouteLocation / MobileShell；
- route ownership、domain module extraction、测试分层和部署基础。

这些能力属于已有产品资产。后续新版 ERP 采用**渐进式演进**，不进行整仓重写。

## 当前主要 Gap

### Master & Engineering

- Organization / Organization Scope
- Bin / 仓位
- Resource / Equipment
- Work Calendar / Shift
- Substitute Material
- ECO / Engineering Change
- 更完整的 BOM/Routing 生命周期

### Sales & Customer

- Quotation
- Price List / Pricing Engine
- Sales Order Change
- Credit Profile / Credit Limit / Occupancy / Credit Check / Special Approval
- 更完整的 replacement / replenishment obligation

### Planning

- Planning Scheme
- Safety Stock 深化
- Forecast Consumption 深化
- Reservation
- Planned Order 生命周期
- Planner Workbench
- Outsourcing release

### Procurement & Outsourcing

- Sourcing
- Supplier Allocation / Quota
- VMI
- 独立 Receipt Notice/收料语义
- 完整 Outsourcing 子域

### Manufacturing & Quality

- Operation Plan
- Scheduling
- Dispatch
- Operation Transfer
- 更完整的 Quality Plan / Sampling
- 更多检验类型
- Non-conformance disposition

### Inventory & Warehouse

- Barcode / PDA / Mobile Scan
- Bin
- Stock Status
- Assembly / Disassembly
- Form Conversion
- 完整 Reservation / Lock
- Inventory Age / Obsolete / ABC 等深化

### Finance Operations

- Provisional AP / AR
- 完整 Treasury / Cashier
- Payment Request
- Bills 生命周期
- 完整 Fixed Asset 生命周期
- Purchase Expense Allocation
- 多币种

### Accounting & Analytics

- Smart Accounting Rule Engine
- Accounting Event / Voucher Template 深化
- Business ↔ GL Reconciliation 产品化
- Cash Flow
- Report Designer / Formula Engine
- Management Accounting / Operating Ledger / Amoeba

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
- Generic Workflow 尚未完成；
- Credit、Barcode、完整 Outsourcing 尚未完成；
- 部分 `cash-journals` / `bills` / `fixed-assets` / `workflows` 用户 Route 仍 disabled；
- `server/app.js` 与部分页面仍较大；
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
| `pnpm test:mysql` | MySQL 兼容 gate |
| `pnpm test:mysql:concurrency` | MySQL 并发 gate |
| `pnpm test:mysql:performance` | MySQL 性能测试 |
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
log/
.claude/skills/erp-mobile-taste/
```

关键责任：

- `src/navigation/applicationRegistry.js`：最终用户 Route、权限、导航、Launcher、Presentation 和 Screen 的 canonical registry；
- `src/navigation/domainMetadata.js`：8 Business Domains + Platform 的唯一 canonical taxonomy；
- `src/pages/platform-notifications.jsx` / `platform-workflows.jsx`：Platform 通知与工作流用户界面 owner；
- `src/navigation/routeLocation.js`：hash RouteLocation 解析/序列化/规范化；
- `server/app.js`：HTTP 生命周期、认证分发和仍未拆出的 handler；
- `server/modules/`：逐步形成 domain canonical owner；
- `server/modules/platform-notifications.js` / `platform-workflows.js`：Platform 通知与工作流 API owner；
- `server/db.js`：SQLite 基础 schema、seed、transaction 和数据库创建；
- `server/database/`：MySQL adapter / worker / protocol / schema bootstrap；
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
pnpm test:mysql:concurrency
```

release candidate / migration release / 生产认证可运行：

```bash
pnpm test:all
```

测试分层与具体 suite 以 `scripts/testing/test-suites.js` 和 `docs/operations/testing.md` 为准，不在 README 硬编码会快速过期的测试数量。

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
