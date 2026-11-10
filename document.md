# Modern ERP 当前功能、目标业务架构与能力需求

> Canonical business requirements — global contract + Domain requirement navigation.
> Manual capability baseline: 2026-10-06 (§22). Document architecture: G0 governance refactor, 2026-11-01.
>
> 状态：`ACTIVE`
> Owner：Platform
> 权威来源：本文件 —— 全局业务 Requirement 合同；各 Domain Requirement 正文见 [`docs/requirements/`](./docs/requirements/)，本文件 §0 为导航入口
> 来源：§1–§25 保留在本文件（编号与内容未变）；§26–§34 与 Wave 修订节已逐字迁入 `docs/requirements/`，原章节编号保持不变

## 0. 文档导航与迁移映射

> 本文件是**全局业务 Requirement 合同与需求导航**，不是各 Domain 详细需求的正文。
> 各 Domain 当前有效需求正文位于 `docs/requirements/`；验收与冻结证据位于 `docs/acceptance/`；
> 当前项目状态唯一入口是 `docs/status/PROJECT_STATUS.md`。

### 0.1 Domain Requirement 入口

| Domain | Requirement 正文 | 权威状态 |
|---|---|---|
| Core Scope Cleanup | [`docs/requirements/core-scope-cleanup.md`](docs/requirements/core-scope-cleanup.md) | §26 |
| Domain Alignment | [`docs/requirements/domain-alignment.md`](docs/requirements/domain-alignment.md) | §27 |
| Master & Engineering | [`docs/requirements/master-engineering.md`](docs/requirements/master-engineering.md) | §28 |
| Manufacturing & Quality | [`docs/requirements/manufacturing-quality.md`](docs/requirements/manufacturing-quality.md) | §29 |
| Planning | [`docs/requirements/planning.md`](docs/requirements/planning.md) | §30 |
| Procurement & Outsourcing | [`docs/requirements/procurement-outsourcing.md`](docs/requirements/procurement-outsourcing.md) | §31（§31.12 = M1 全范围历史批准合同；§31.13 = M1-Core 首期已批准；§31.14 = Package A1 产品范围 Requirement，待业务所有者验收；§31.15 = 委外核心执行工作面有界 Requirement，已验收冻结；§31.16 = 完整 Active Contract 域级交付整改 Requirement，已批准并实施（`IMPLEMENTED`，待域级 Acceptance）） |
| Inventory & Warehouse | [`docs/requirements/inventory-warehouse.md`](docs/requirements/inventory-warehouse.md) | §32 |
| Finance Operations | [`docs/requirements/finance-operations.md`](docs/requirements/finance-operations.md) | §33 |
| Sales & Customer | [`docs/requirements/sales-customer/README.md`](docs/requirements/sales-customer/README.md) | §34 + Wave 8/9/10/11 修订 |
| Accounting & Analytics | **尚无 Domain Closure Requirement** | — |
| Platform | **尚无 Domain Closure Requirement** | — |

### 0.2 章节编号迁移规则

本文件 §1–§25 的编号与内容保持不变。原先位于本文件的 §26–§34 与各 Wave 修订节已**逐字迁移**到上表对应文件，
原章节编号**在目标文件中原样保留**（例如 `docs/requirements/procurement-outsourcing.md` 仍以 `## 31. …` 开头，
`§31.12` 等深引用继续有效）。

完整迁移映射（原文件 + 原章节 + 源 SHA → 新文件 + 处置）见
[`docs/status/MIGRATION-MAP.md`](docs/status/MIGRATION-MAP.md)。
原文字节级证据保留在 Git 历史 `4cb8c477aa00988bbfebef905764565cdfe62b71`。

---

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

### 5.4.1 事务启动失败与连接级幂等命名锁安全（2026-10-24 澄清）

本条仅补充事务尚未成功启动时的异常路径，不改变任何业务计算、状态机、权限、金额、锁顺序或重试规则。

- 调用方已经取得并登记的 MySQL 连接级幂等命名锁，在事务启动失败后不得遗留在仍可复用的活动连接上。
- 事务启动失败必须保留并向上抛出原始启动异常及其既有分类；不得把它静默改写为业务成功、幂等 replay、普通业务 409，亦不得为其新增自动重试。
- 只有能够证明由本次启动尝试创建的事务才允许由该异常路径回滚。不得提交或回滚调用方、外层流程或其他操作拥有的事务。
- 如果命名锁释放失败，且无法确认连接已经失效或锁已经由服务器释放，则该连接不得继续作为安全可复用连接；不得仅清除本地登记后宣称 cleanup 成功。
- 成功启动后的 COMMIT、ROLLBACK、既有 MySQL 内层重试、L0 transaction gate、Finance Parent/业务锁顺序、READ COMMITTED 隔离、幂等 scope/fingerprint/replay、业务原子性与 SQLite `BEGIN IMMEDIATE` 语义全部保持不变。
- 验收必须以确定性 fault injection 覆盖：启动前失败、持有命名锁时启动失败、释放成功、原始异常保留、不回滚外部事务、释放失败时连接不可被不安全复用，以及正常 COMMIT/ROLLBACK、既有重试、Refund replay/conflict/零重复经济副作用和 SQLite 兼容性回归。

### 5.4.2 事务生命周期安全补充要求（2026-10-24 外部复核补充）

本条补充 `solution.md §37.30` 外部复核提出的 R1–R7 缺口，仅约束事务与连接生命周期，不改变任何业务计算、状态机、权限、金额、锁顺序、幂等 scope 或既有重试规则；`§5.4.1` 全部条款继续有效。

#### R1 事务启动所有权

- 在尝试 BEGIN 之前，事务尝试必须先判定当前连接的事务状态。
- 若已存在活动事务，或该状态不可信，事务尝试必须拒绝发起 BEGIN。
- 不得在已有活动事务的情况下发出新的 START TRANSACTION；MySQL 会隐式提交既有事务。
- 只有能够证明由本次尝试成功创建并由本次尝试拥有的事务，才允许被该路径回滚。
- 所有权判定必须基于本次尝试自身的证据；连接级事务标记本身不得作为所有权证明。
- 本条不得改变既有嵌套调用约定：既有模块的嵌套守卫仍然直接执行函数体而不再次进入事务。

#### R2 回滚失败

- 若 ROLLBACK 失败、超时，或回滚结果不确定，必须同时满足：
  - 不得再接纳任何事务重试；
  - 不得发出新的 BEGIN；
  - 必须隔离该 adapter；
  - 必须启动有界会话拆除；
  - 必须保留主操作的原始异常，并把 cleanup 失败单独记录；
  - 未取得证明前不得报告回滚成功。
- 主操作异常的优先级不得因 cleanup 失败而被替换或降级。

#### R3 正常路径的已验证释放

- COMMIT 成功后，必须验证已登记的 MySQL 命名锁释放结果。
- 最终失败的事务清理之后，在原会话已知且健康时必须验证释放结果。
- 释放结果 1 为已确认；结果 0、NULL、传输失败与超时均为未确认。
- 未确认的释放必须立即隔离该连接。
- 不得撤销或改写已经提交的业务事务。
- 不得对已经提交的 mutation 进行静默重试。

#### R4 Finance 幂等 replay 释放

- `server/modules/financial-controls.js` 的 `idempotencyReplay()` 既有释放路径不得：
  - 忽略无法验证的 RELEASE_LOCK 结果；
  - 在继续复用活动连接时抹除未知的锁归属；
  - 重连之后把新会话误当作原持有者。
- 必须复用 R3 相同的已批准释放与隔离合同。
- 不得改变 exact replay 的 200 语义、冲突 fingerprint 的 409 语义或既有幂等 scope。

#### R5 读事务启动

- 必须处理 `readTransaction()` 中与 `transaction()` 等价的 BEGIN-before-try 安全边界。
- 失败或超时的读事务启动不得使状态不确定的 adapter 继续可复用，也不得导致对外部事务的回滚。
- 不得把本条扩展为读隔离级别或 L0 锁定的重新设计。

#### R6 Worker 与 adapter 不确定性

- 超时的同步请求可能仍在 Worker 中继续执行。
- 隔离必须阻止该 adapter 上的任何后续业务 SQL。
- Worker 终止是异步的，必须暴露真实的 PENDING / CONFIRMED / FAILED 状态。
- 隔离本身不构成服务端命名锁已释放的证明。
- 不得自动重放结果不确定的写入、COMMIT 或 ROLLBACK。

#### R7 测试注册安全

- 纯确定性测试可以加入本地 FAST / FULL / HEAVY 套件。
- 真实 MySQL 集成测试必须保留在受保护的、显式的 MySQL 测试门禁之后。
- 不得把真实 MySQL 集成测试注册进无条件的 `test:heavy` 命令。
- 未获得新鲜的精确目标授权前，不得运行破坏性 MySQL 测试。

#### 兼容性与边界

- 必须保留：MySQL L0 transaction gate；L1–L8 业务锁顺序；既有 Finance 金额权威；既有有效重试语义；既有幂等行为；SQLite 行为；MySQL READ COMMITTED 隔离；既有 Wave 7 Gate A 用例；Gate B / Wave 10 边界；既有 schema 与 migration。
- 不得引入新的 ERP 业务功能、新的自动启动重试或广泛的数据库引擎重写。

#### 后续 Design 必须定义的内容

- 最小可允许的生产文件清单；候选为 `server/db.js`、`server/database/mysql-adapter.js`、`server/database/mysql-worker.js`、`server/modules/financial-controls.js`。
- 除非独立证明必要，否则不得修改协议层。
- 未来测试必须覆盖的用例：外部事务的 pre-BEGIN 拒绝；BEGIN 失败与超时；已验证与失败的 RELEASE_LOCK；正常 COMMIT 释放；ROLLBACK 失败且其后不得再重试；COMMIT 成功后释放失败；replay 命中/冲突与释放失败；`readTransaction()` 启动失败；Worker 迟到完成与隔离；连接拆除结果上报；原始异常保持稳定；零重复金额事实；SQLite 兼容性。

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
