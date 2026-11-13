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

## 当前状态摘要

当前项目状态、阻塞项与下一步的唯一登记处是
**[docs/status/PROJECT_STATUS.md](./docs/status/PROJECT_STATUS.md)**。
本文件不维护第二份状态表。

当前基线：已发布 release tag `v1.6.2`，`package.json` 版本 `1.6.2`；
`master` 是持续开发分支，可领先 release tag。精确开发状态以 Git SHA 或 `git describe` 为准。
**没有任何 Domain 达到 Release Readiness；生产发布仍未获授权。**

## 核心范围、端到端主链与当前运行限制

规范来源是 [document.md](./document.md)：

- §6 必须保持的端到端主链（O2C / P2P / Plan-to-Produce / Plan-to-Outsource / R2R）；
- §8 当前运行限制与长期目标的区分；
- §9 非核心扩展范围收口（projects / tasks / timesheets / contacts / followups / activities）。

当前的断点、五条主链闭合情况与 Release Blockers 见
[docs/status/PROJECT_STATUS.md](./docs/status/PROJECT_STATUS.md) §35.8 与 §35.9。

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
| `pnpm test:mysql:inventory-warehouse` | Inventory & Warehouse 域专属 ACK-4 campaign（`INVENTORY_WAREHOUSE_MYSQL_V1`，受保护，独立 campaign 与 suite 标签，INV-RACE-01..04 竞态矩阵） |
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
scripts/qa/（治理守卫：跨域错误码耦合、历史验收记录有效性）

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
- `src/pages/inventory-work.jsx`：Inventory & Warehouse 库存与仓储的**单一** canonical 工作面（21 个页签：即时库存、仓位、库存状态、所有权、库存参数、盘点、批号调整、形态转换、组装拆卸、ABC、条码、容器、扫码、调拨、调整、初始化与期初、其他出入库、分步调拨、状态调整、锁库、库存报表）；
- `server/modules/inventory-stocktake.js` / `inventory-transfer.js` / `inventory-container.js`：盘点、调拨、容器（装箱 / 拆包）的**唯一**写入口；
- `server/modules/inventory-abc-classifications.js` / `inventory-assembly-disassembly.js` / `inventory-barcode-generation.js`：ABC 分类、组装拆卸、条码生成与标签渲染；
- `server/lib/inventory-mutation.js`：`applyInventoryMutation` canonical 物理变更合同（负库存策略、库存锁、期间闸门、幂等键与 mutation log）；
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

## 文档导航

| 需要找什么 | 去哪里 |
|---|---|
| 项目定位、技术栈、启动 / 测试 / 部署入口 | 本文件 |
| 全局业务 Requirement 合同与 Domain 需求导航 | [document.md](./document.md) |
| 全局技术 Design 合同与 Domain 设计导航 | [solution.md](./solution.md) |
| 某个 Domain 的当前 Requirement 正文 | [docs/requirements/](./docs/requirements/) |
| 某个 Domain 的当前 Design 正文 | [docs/design/](./docs/design/) |
| **当前项目状态、阻塞项与下一步** | [docs/status/PROJECT_STATUS.md](./docs/status/PROJECT_STATUS.md) |
| B3101–B3122 能力覆盖追溯 | [docs/status/CAPABILITY_MATRIX.md](./docs/status/CAPABILITY_MATRIX.md) |
| G0 文档迁移映射（可追溯性） | [docs/status/MIGRATION-MAP.md](./docs/status/MIGRATION-MAP.md) |
| 重大决策记录 | [docs/decisions/](./docs/decisions/) |
| 验收与冻结证据 | [docs/acceptance/](./docs/acceptance/) |
| 运维与测试运行手册 | [docs/operations/](./docs/operations/) |
| 历史材料（非当前权威） | [docs/archive/](./docs/archive/) |
| 开发与沟通历史 | [log/](./log/) |
| 开发与 AI/Vibe Coding 治理政策 | [AGENTS.md](./AGENTS.md) |
| Claude Code 入口 | [CLAUDE.md](./CLAUDE.md) |

`AGENTS.md` 是唯一权威的治理政策；`CLAUDE.md` 只引用它，不维护第二套规则。
`APPLY_GUIDE.md` 已由业务所有者于 2026-11-02 明确批准永久删除并完成提交；项目不再读取、恢复或依赖该文件。

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
