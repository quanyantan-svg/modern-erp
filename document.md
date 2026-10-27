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

---

**WAVE 8 STAGE B REQUIREMENT CLOSURE RECORD (2026-10-19) — STAGE B ONLY, AWAITING USER CONFIRMATION BEFORE STAGE C DESIGN.** Wave 8 (Service Fulfillment + Consignment commercial) is `WAVE8_STAGE_B_REQUIREMENT_CLOSURE_RECORDED — AWAITING_USER_CONFIRMATION` on `feature/sales-waves6-13@25e28b4103367d39c1573485ac05be04f3337924`, package `1.6.2`. This Record is **Requirement-only**, additive to §34, and preserves verbatim: every frozen §34.3.x sub-section, every frozen §34.4 invariant, every frozen §34.5 UAT, every frozen §34.6 Race (including R-SAL-20 / R-SAL-21 / R-SAL-22), every frozen §34.7 Permission principle, every frozen §34.8 cross-domain row, every frozen §34.10 Out-of-Scope boundary, the §34.13 traceability, the §34.14 freeze record, the §34.15 DR-SAL-04..06 records, the historical-baseline footer, the Wave 6 freeze footer, the Wave 7 freeze footer, SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36 counts, and the Wave 8–13 = OUT_OF_SCOPE baseline. No new SC / Invariant / UAT / Race / Audit Capability ID is introduced by this Record. No solution.md edit, no migration edit, no test edit, no schema edit, no §30 frozen-deps cell edit, no Git operation, no database operation, no test run is authorized by this Record. The §30.17 / §30.18 dependency-table fact discrepancy noted in the upstream Read-Only Audit is recorded below as a bounded Design-stage reconciliation item and is **not** silently resolved here.

#### Wave 8 Stage B — A. Scope and explicit out-of-scope boundaries

##### A.1 In scope for Wave 8 Stage B (Requirement Closure only)

1. Service Fulfillment (SC69–SC71) — three SCs already enumerated in `§34.3.14` and `§34.13.1`; the Requirement closure records the commercial contract that the eventual Design must satisfy, and bounds the gate integration with the existing Sales Delivery Confirm path without rewriting the frozen Wave 5 path.
2. Consignment commercial (SC72–SC77) — six SCs already enumerated in `§34.3.15` and `§34.13.1`; the Requirement closure records the three-truth (commercial / inventory / settlement) separation, the ENTERPRISE-ownership-during-consignment rule, the canonical capacity identity, and the consignment-vs-CUSTOMER-owned distinction.
3. Business invariants S08 (Service fulfillment ≠ Inventory movement) and S18 (Consignment location ≠ ownership ≠ settlement).
4. Frozen Functional UAT references UAT-S-25 (Service Item Sales), UAT-S-26 (Consignment Instruction + Settlement), UAT-S-27 (Consignment Return + Reporting), and UAT-S-41 (Consignment commercial three-layer distinction).
5. Frozen Sales MySQL races R-SAL-20, R-SAL-21, R-SAL-22 with their canonical lock identities.
6. Audit capabilities CAP-25 (Consignment) and CAP-26 (Service Item) — both currently flagged `MISSING` in `§34.13 main table` row-by-row against SC72–SC77 / SC69–SC70+SC71 respectively; the closure makes the audit-to-SC mapping explicit and bounded.
7. The four new tables named in the upstream user authorization: `service_fulfillments` (A-44), `consignment_commercial_documents` (A-45), `consignment_commercial_lines` (A-46), `consignment_commodity_locations` (A-47). No additional Wave 8 table is named by this Record.
8. The two planned backend modules named in the upstream user authorization: `service-fulfillment` and `consignment`. No additional Wave 8 module name is introduced by this Record.
9. The two Wave 8 mobile-first surfaces named in the upstream user authorization: `src/pages/consignment.jsx` and a contextual service-fulfillment sub-page registered under the existing Wave 7 Sales Order / Orders parentRoute. Launcher expansion is **out of scope** per UD-5.

##### A.2 Explicitly Out-of-Scope for Wave 8 Stage B

1. Any actual Design, Implementation, migration, test, registry, route, package, README, AGENTS, CLAUDE, APPLY_GUIDE, schema, gate, build, or database operation (per task §4).
2. Any new SC / Invariant / UAT / Race / Audit CAP identifier (per UD-4 #10); the canonical counts **SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36** are preserved unchanged.
3. Any modification to the frozen §34.3.14 or §34.3.15 sub-sections, including their textual wording, RACI annotations, footnote-style comments, IN_SCOPE / OUT_OF_SCOPE markers, or `[DOMAIN_OWNED]` / `[INTEGRATION_BACKED]` / `[EXISTING_REUSE]` markers.
4. Any modification to the Wave 5 / Wave 7 frozen Sales Delivery Confirm code path (`server/app.js` confirm route + Wave 7 prepayment gate integration). A later Wave 8 Design gate, if approved, may perform an explicitly bounded modification to that path **subject to a separately authorized Design-stage decision**, and is **not** authorized here.
5. Any addition of a Sales-owned shadow inventory ledger, a second Finance AR ledger, or any cross-domain schema change without a separately approved contract (per UD-4 #6).
6. Expansion of the Sales & Customer launcher entry count beyond what already exists in `src/navigation/applicationRegistry.js`; the Wave 12 global Mobile IA redesign is **out of scope** (per UD-5).
7. External bureau / AI / ML integration, multi-currency, multi-organization, bin-management, and any §34.10 product-scope exclusion (per `§34.10`). These are not Wave 8 scope, are not introduced by this closure, and require their own future Capability closures under their own separate authorization.
8. Wave 9 through Wave 13 (per UD-3 + §34 final-statement OUT_OF_SCOPE marker).

#### Wave 8 Stage B — B. Frozen traceability matrix (adjudicated against canonical §34)

##### B.1 Wave 1 SC69 (foundation) vs Wave 8 SC70..SC77

```text
SC69  Service-Type Commercial Item Identity
      (extends Master & Engineering Product 商业 classification)        [DOMAIN_OWNED]
      — already enumerated in §34.3.14, §34.13.1; foundation.
      — Wave 8 Stage B does NOT re-open SC69; the Wave 1 foundation
        (`product_commercial_classification` A-61, §29.18.0 of
        solution.md FROZEN Design) supplies the active sales-enabled /
        service-classification verification for any service-line write.
      — Wave 8 only constrains the SC69-anchored service-line reads that
        the Wave 8 Service Fulfillment Confirm gate will perform.

SC70  Service Sales Order Line + Service Fulfillment / Confirmation   [DOMAIN_OWNED]
      — already enumerated in §34.3.14, §34.13.1; Wave 8 SC.
      — capacity identity = sales_order_items.id (where
        product_commercial_classification.service_classification=TRUE).
      — Wave 8 introduces one additive carrier `service_fulfillments`
        (A-44) which DOES carry service confirmation facts only;
        sales_order_items is NOT rewritten.

SC71  Service Finance Recognition (no inventory OUT; AR / Revenue via
      Finance canonical adapter)                                       [INTEGRATION_BACKED]
      — already enumerated in §34.3.14, §34.13.1; Wave 8 SC.
      — same `[INTEGRATION_BACKED]` marker as SC51 / SC58; the Frozen
        Finance V22 recognition paths owned by Finance are unchanged.
      — Service Confirm must invoke them; it must not duplicate or
        fork them.

SC72  Consignment Instruction (commercial; Inventory position remains
      ENTERPRISE/seller-owned until settlement / title-transfer)       [DOMAIN_OWNED]
SC73  Consignment Location (commercial identity, ≠ physical warehouse)  [DOMAIN_OWNED]
SC74  Consigned Quantity Tracking + Ownership-Retention
      Commercial State                                                  [DOMAIN_OWNED]
SC75  Consignment Settlement Confirmation                               [DOMAIN_OWNED]
SC76  Consignment Commercial Return                                     [DOMAIN_OWNED]
SC77  Consignment Reporting                                             [DOMAIN_OWNED]
      — already enumerated in §34.3.15, §34.13.1; all six are
        Wave 8 SCs.
      — capacity identity = consignment_commercial_lines.id (R-SAL-20
        canonical lock identity — see B.3 below).
      — Wave 8 introduces three additive carriers:
        consignment_commercial_documents (A-45),
        consignment_commercial_lines (A-46),
        consignment_commodity_locations (A-47 — commercial location
        identity ≠ physical warehouse_id).
```

##### B.2 Frozen Business Invariants S08 + S18 traceability

```text
S08  Service fulfillment ≠ Inventory movement
     (no inventory OUT；SC70 / SC71)                                       — §34.4
     Wave 8 binding: any service-line Confirm path
     (i)  must not write inventory OUT, inventory decrement, or
          fabricated COGS;
     (ii) must invoke the Frozen Finance V22 canonical recognition
          adapter for AR/Revenue;
     (iii) must remain fail-closed when no eligible Finance evidence
          can be canonicalized.
     The Service Fulfillment Confirm gate does not invent a new
     recognition writer; it delegates to the SC71 INTEGRATION_BACKED
     adapter under the same §28 (Finance Operations) ownership that
     Wave 7 already uses.

S18  Consignment location ≠ ownership ≠ settlement
     (physical inventory ≠ commercial ownership ≠ AR / settlement)        — §34.4
     Wave 8 binding: the three layers cited in §29.19.1 of the Frozen
     Design (Layer 1 commercial / Layer 2 Inventory V21 ENTERPRISE-owned
     / Layer 3 Finance AR+settlement) are not collapsed by Wave 8; the
     consignment_commodity_locations (A-47) commercial identity is NOT a
     physical warehouse, the consignment lifecycle MUST keep
     owner_type='ENTERPRISE' on Layer 2 until an authoritative
     settlement / title-transfer event, and the Layer 3 settlement must
     be expressed via the Frozen Finance V22 canonical AR/settlement
     writers (no second consignment stock balance; no CUSTOMER-owned
     fake on Layer 2 during consignment).
```

##### B.3 Frozen Functional UAT (UAT-S-25 / 26 / 27 / 41)

```text
UAT-S-25  Service Item Sales (no inventory OUT; finance recognition)     — §34.5
          already covers SC69..SC71 + R-SAL-22; Wave 8 does not add a
          new UAT ID.

UAT-S-26  Consignment Instruction + Settlement                            — §34.5
          already covers SC72..SC75 + R-SAL-20; Wave 8 does not add a
          new UAT ID.

UAT-S-27  Consignment Return + Reporting                                  — §34.5
          already covers SC76..SC77 + R-SAL-21; Wave 8 does not add a
          new UAT ID.

UAT-S-41  Consignment commercial 三层 distinction
          (location != ownership != settlement)                            — §34.5
          already covers SC73..SC74 + S18; Wave 8 does not add a
          new UAT ID.
```

##### B.4 Frozen Sales MySQL Race (R-SAL-20 / 21 / 22)

```text
R-SAL-20  Consignment Settlement × 2 against same unsettled consigned
          quantity.
          canonical lock identity = SC74 consignment outstanding qty
          identity; business invariant = SC74 + S18;
          required result = combined settled qty ≤ consigned
          outstanding; settlement serialization.                             — §34.6 row 20

R-SAL-21  Consignment Settlement vs Consignment Commercial Return.
          canonical lock identity = SC74 settlement identity vs SC76
          commercial return identity; business invariant = SC74 + SC76 +
          S18; required result = either settlement or return commits,
          combined effect ≤ consigned outstanding at any time.              — §34.6 row 21

R-SAL-22  Service Fulfillment Confirmation × 2 against same Service
          order remaining.
          canonical lock identity = SC70 service remaining identity;
          business invariant = S08; required result = combined
          confirmation qty ≤ service-order remaining; no
          double-confirm; no inventory OUT path; service-only;
          service_classification=TRUE precondition.                        — §34.6 row 22

Wave 8 Stage B requires real independent-session MySQL evidence for
R-SAL-20 / R-SAL-21 / R-SAL-22 to come out of TEST_EVIDENCE_PENDING;
Wave 13 may repeat these gates (per UD-4 #7) but cannot substitute for
the initial Wave 8 acceptance proof.
```

##### B.5 Audit Capability ID traceability (CAP-25 / CAP-26)

```text
CAP-25  Consignment  | B3102 | MISSING | GAP-SC-14 | RC-12
        SC trace:    SC72, SC73, SC74, SC75, SC76, SC77
        Frozen audit trace: §34.13 main table row CAP-25 ↔ SC72..SC77
        Wave 8 must transition CAP-25 MISSING → COVERED in the same
        Freeze that turns UAT-S-26 / UAT-S-27 / UAT-S-41 + R-SAL-20 /
        R-SAL-21 green; no separate audit CAP ID is created.

CAP-26  Service Item | B3102 | MISSING | GAP-SC-13 | RC-11
        SC trace:    SC69, SC70, SC71 (SC71 IB adapter)
        Frozen audit trace: §34.13 main table row CAP-26 ↔ SC69..SC71
        Wave 8 must transition CAP-26 MISSING → COVERED in the same
        Freeze that turns UAT-S-25 + R-SAL-22 green; no separate audit
        CAP ID is created.

Note: the frozen audit count `Audit CAP 36` (CAP-1..CAP-36) is preserved
unchanged; CAP-25 / CAP-26 transition MISSING→COVERED does not change
the count, only their frozen-table status. (UD-4 #10)
```

#### Wave 8 Stage B — C. Service Fulfillment contract (frozen-bound)

The Service Fulfillment contract is read directly from `§34.3.14` (SC69 / SC70 / SC71), `§34.5` UAT-S-25, `§34.6` R-SAL-22, `§34.4` S08, `§34.7` Permission, `§34.8` cross-domain row 7, and `§29.18` / `§29.18.0–3` of the Frozen Design. Any clause **not** explicitly stated in those frozen sections is recorded in §H below as a Design Decision Needed; no new business policy is invented here.

1. **Commercial identity and source linkage** — Service Fulfillment is a Sales-owned confirmation record whose `sales_order_id` + `sales_order_item_id` match the canonical Wave 5 SO line. A Service Fulfillment row may exist only for a SO line whose `product_commercial_classification.service_classification=TRUE` (SC69-anchored active row via `product_commercial_classification` A-61 / `§29.18.0`). SC69 is the foundation; no SO line may carry a Service Fulfillment record without an active A-61 row.
2. **Service classification authority** — Master & Engineering owns `products` identity (frozen-Master boundary decision in `§29.18.3`); Sales & Customer owns `product_commercial_classification` (A-61). Sales does not add an `is_service` column to `products`. The Service Fulfillment Confirm path checks `product_commercial_classification.service_classification=TRUE` for the line's `product_id`; legacy products missing A-61 surface as `(unclassified legacy)` and are **fail-closed** for any new service-line write. (UD-4 #1)
3. **State and confirmation evidence** — Service Fulfillment carries `confirmation_state ∈ { PENDING, CONFIRMED, CANCELLED }` (`§29.18.1`). A row is created PENDING at Wave 8 service-line acceptance (or via authorized backfill hook); CONFIRMED at the Service Fulfillment Confirm call; CANCELLED via the documented cancel path. No state may silently transition between these without an auditable event.
4. **Line quantity and remaining-capacity semantics** — Remaining service capacity on a SO service line equals `sales_order_items.quantity - SUM(service_fulfillments.confirmation_qty WHERE confirmation_state='CONFIRMED')` (`§29.18.1` + `§29.30` row 11). This is the same definition carried by the frozen Source / Capacity Model and is the canonical lock identity for R-SAL-22 (`§29.44`).
5. **No Inventory physical movement** — Service Confirm must not write inventory OUT, inventory decrement, or fabricated COGS. (`§34.3.14` note + S08). A service line is not deliverable through `confirmSalesDelivery`; the §29.18.2 decision branches the confirm path so that the service line path refuses to invoke `applyInventoryMutation`. Frozen Wave 5 / Wave 6 / Wave 7 confirm inventory/valuation/voucher facts are untouched for non-service lines.
6. **Finance canonical recognition** — Service recognition (AR / Revenue) must be expressed via the `[INTEGRATION_BACKED]` Finance Operations V22 canonical adapter (`SC71`). No Sales-owned shadow Finance writer is introduced. The Frozen Finance recognition writer is the only authority; Wave 8 only calls it.
7. **Cancellation and correction semantics** — Service Fulfillment CANCELLED must not silently rewrite Confirmation history. Confirmed records do not auto-cancel; cancellation is a documented, audited, append-only event. Where the frozen Requirement is silent on partial cancel, defer to §H Design Decision Needed DDN-SVC-1.
8. **Idempotency** — Any Service Confirm call must be idempotent at the row-identity level (replay returns identical state). Where the frozen Requirement is silent on header-supplied vs body-supplied `Idempotency-Key` policy for Service Fulfillment, defer to §H Design Decision Needed DDN-SVC-2.
9. **Audit** — Every state transition writes one `audit_logs` row keyed by `service_fulfillments.id` (per `§29.35` row "service_fulfillment CREATE / CONFIRM / CANCEL"). No audit is silently skipped.
10. **RBAC and transactional atomicity** — All Service Fulfillment writes require `SALES_MANAGE` (sales write side); reads accept `SALES_MANAGE` or `SALES_VIEW`. Sales-group data scope is enforced in backend, mirroring Wave 7 (`§34.7` P1 / P5). All service confirmations commit Inventory no-effect (no inventory rows) + Finance recognition + audit + idempotency in one transaction or rollback as one. SQLite is `BEGIN IMMEDIATE`; MySQL is the same locked transaction with canonical lock identities listed in §29.43/§29.44.

##### C.9 Sales Delivery Confirm Gate integration (frozen-bound, bounded)

The frozen Sales Delivery confirm path calls `authorizeSalesPrepaymentGateForMutation()` inside `confirmSalesDelivery()` (`server/app.js`). UD-2 confirms this is a Wave 7 integration that Wave 8 may later extend with an explicitly bounded modification **subject to a separately authorized Design-stage decision**, but this Record does **not** authorize that extension. The Stage B Requirement only records the following contract:

- A service line with no Service Fulfillment in `CONFIRMED` state cannot pass the Sales Delivery Confirm path; the path must return HTTP 409 (or the documented failure code) with zero inventory side effects.
- A service line with a Service Fulfillment in `CONFIRMED` state passes the inventory-OUT branch with `inventory OUT 0` (per `§29.18.2`) and proceeds to the SC71 Finance recognition call.
- A non-service line passes the inventory-OUT branch unchanged (frozen Wave 5 contract).
- A mixed service + non-service SO/Delivery confirmation must still produce no inventory OUT for the service sub-lines and proceed for the non-service sub-lines; underdelivered quantity is recorded per the existing Wave 5 lower-bound tolerance handling without silently absorbing service lines.
- The Delivered-vs-Service-line concurrency invariant R-SAL-22 is the only Service Fulfillment race scope in this Stage B; no other race is added.

No `Idempotency-Key` policy, no new gate alias, no new RBAC code, and no new route is introduced by this Record for the Confirm Gate integration. (UD-2 #6)

#### Wave 8 Stage B — D. Consignment contract (frozen-bound)

The Consignment contract is read directly from `§34.3.15` (SC72..SC77), `§34.5` UAT-S-26 / UAT-S-27 / UAT-S-41, `§34.6` R-SAL-20 / R-SAL-21, `§34.4` S18, `§34.7` Permission, `§34.8` cross-domain row 8, and `§29.19.0–5` of the Frozen Design. Any clause **not** explicitly stated in those frozen sections is recorded in §H below as a Design Decision Needed.

1. **Instruction, physical handoff, location, tracking, settlement, return, reporting** — Consignment consists of the following subprocesses, each mapped to one or more frozen SCs:
   - Instruction (`SC72`): create a `consignment_commercial_documents` header + `consignment_commercial_lines` rows; record `consignment_commodity_location_id` on the line.
   - Physical handoff (Sales-only commercial instruction; physical truth at Inventory): write one Inventory movement via `applyInventoryMutation` (canonical Inventory V21 writer) with `owner_type='ENTERPRISE'` and the canonical `consignment_commodity_location_id` as the position location reference; no CUSTOMER-owned fake position is created (per `§29.19.0`).
   - Location identity (`SC73`): `consignment_commodity_locations` (A-47) is the commercial location, **not** a physical warehouse; the physical layer remains the Frozen Inventory V21 position keyed on `warehouse_id` (and never on a CUSTOMER ownership marker for consignment).
   - Tracking: every consignment line mutation emits a `tracked_inventory_movements` row via the canonical Inventory writer; no Sales shadow tracking table.
   - Settlement confirmation (`SC75`): confirm a settlement quantity ≤ remaining consigned capacity; on success, the Frozen Inventory position transfers ownership via the canonical writer (Layer 2 ENTERPRISE → CUSTOMER-owned OR out of layer 2 depending on settlement semantics) and the Layer 3 Finance canonical settlement writer records AR / settlement.
   - Return (`SC76`): confirm a return quantity ≤ remaining consigned capacity; on success, the Frozen Inventory position is restored at the consignment location with `owner_type='ENTERPRISE'` (per `§29.19.1` Layer 1 / Layer 2 return path), and the Frozen Finance canonical refund / credit-adjustment writer records the Finance effect.
   - Reporting (`SC77`): produces Consignment reporting from canonical facts (consignment_commercial_lines + Inventory V21 position + Finance settlement); no reporting shadow ledger.
2. **Three-truth ownership boundaries** — `§34.4` S18 + `§29.19.1` Layer 1/2/3 separation: Layer 1 commercial, Layer 2 Inventory ENTERPRISE-owned during consignment, Layer 3 Finance AR / settlement. The closure respects the canonical lock identity `consignment_commercial_lines.id` (`§29.19.3`) and does not introduce a parallel Sales-owned capacity balance.
3. **ENTERPRISE-owned position until lawful ownership transfer** — Until a documented settlement or authorized title-transfer event fires, the Layer 2 Inventory position at consignment location is `owner_type='ENTERPRISE'`. Settlement is the documented ownership-transfer event; return is also a documented event but does not transfer ownership away from ENTERPRISE. CUSTOMER-owned Layer 2 position represents a different business meaning (entrusted / customer-owned stock), **not** consignment (`§29.19.0` + `§29.19.5`).
4. **Commercial capacity and concurrent settlement / return controls** — Commercial remaining capacity equals `consignment_commercial_lines.consigned_quantity − settled_quantity − returned_quantity` (`§29.19.3` Layer 1 formula). R-SAL-20 + R-SAL-21 serialize concurrent settlement and return against the same `consignment_commercial_lines.id` so combined effect ≤ remaining at any time. SQLite is `BEGIN IMMEDIATE`; MySQL is locked transaction with the canonical lock identity listed in §29.44.
5. **Authoritative Inventory physical position** — `inventory_v21` canonical position remains the source of truth at Layer 2 (`§29.19.1`); the consignment module never reads from or writes to a parallel Sales-owned stock table.
6. **Authoritative Finance settlement and AR effects** — Settlement / return must invoke the same Frozen Finance V22 canonical writers used by Wave 7 (`settlement_unapplied_balances`, `account_receivables`, `payment_collections` etc.), keyed on the canonical `consignment_commercial_lines.id` row identity. No second Finance balance, no consignment-specific Finance balance.
7. **Failure rollback and historical preservation** — Any consignment instruction / settlement / return / cancel commit or rollback as one. Confirmed consignment history is not silently rewritten (`S05`); correction is via a documented, audited, idempotency-keyed correction that produces independent audit evidence.
8. **Legacy and compatibility treatment** — Legacy rows (rows with no Wave 8 consignment carrier) remain read-only legacy; no migration-time synthetic backfill creates a Wave 8 consignment record for a legacy shipment. Consignment instructions may only be created for shipments explicitly authorized through the new sales commercial path. Pre-existing consignment shipments in customer-side legacy rows fail closed if downstream verification cannot canonicalize them (`R4` analog).

#### Wave 8 Stage B — E. Data and migration acceptance

1. **Exactly four new Wave 8 tables** are added, one already-named by the Frozen Design and three by `§29.2` Physical Model Inventory:
   - `service_fulfillments` (A-44): service-only confirmation evidence keyed on `sales_order_id` + `sales_order_item_id`; canonical capacity identity for R-SAL-22 is `sales_order_items.id`; the carrier is Sales-owned but the fact it carries is consumed by the Frozen Inventory / Finance writers.
   - `consignment_commercial_documents` (A-45): Sales-owned consignment commercial header.
   - `consignment_commercial_lines` (A-46): Sales-owned consignment commercial line; canonical capacity identity for R-SAL-20 / R-SAL-21 is `consignment_commercial_lines.id`.
   - `consignment_commodity_locations` (A-47): Sales-owned commercial location identity; **not** a physical warehouse. Distinct from Master `warehouses`, distinct from Inventory V21 `warehouse_id`. UD-4 #4.
2. **No change to frozen domain schemas** — `products`, `inventory_v21`, `inventory_valuation_movements`, `inventory_valuation_balances`, `inventory_serials`, `account_receivables`, `payment_collections`, `settlement_unapplied_balances`, `planning_reservations`, `inventory_locks`, `purchase_orders`, `planned_orders`, and every other frozen Migration's domain table are not altered by the Wave 8 migration. Any required cross-domain change must go through a separately approved contract under its own Wave / Stage; Wave 8 does **not** open that path. (UD-4 #6)
3. **SQLite / MySQL parity** — Fresh bootstrap, existing-database upgrade, and `pnpm.cmd test:mysql` idempotent re-run paths must all produce the same schema for the four new carriers. The Wave 6 prefix-realization convention (`idx_*_identity_status_created` index prefix realization in `server/database/mysql-schema.js`) and the Wave 7 expression-unique-index pattern (`COALESCE(...)` for nullable composite keys) are reused as Design defaults; any deviation is recorded under §H Design Decision Needed. Wave 8 does NOT assume nullable composite keys are safe without dialect-parity proof (UD-3 §3.E last bullet).
4. **Constraints** — PK / FK / UNIQUE / CHECK / `idx_*` indexes are mandated by Design (`§29.41`) and verified by `assertMySqlColumnContracts` + hand-rolled fixture + the Wave 8-focused MySQL migration / metadata integration test (modeled after `server/mysql-sales-customer-wave7.integration.js` + Wave 0/1 upgrade test). Specific UNIQUE identities, exact index column lists, and CHECK clause text are **Design-stage decisions** (`§29.41`); the Stage B Record does not invent them and does not pre-empt Design decisions that the frozen contract leaves to Design.
5. **Wave 8-specific migration file** — one additive `server/migrations/sales-customer-wave8.js` (or analogous filename) carrying one `ensureSqlite*` / `ensureMysql*` function pair per new table, satisfying fresh / upgrade / replay / idempotency; registered into `server/migrations/sales-customer-domain.js` migration list under a new `'wave-8-service-fulfillment-and-consignment'` step. Migration registration name, exact step label, and reconciliation semantics are **Design-stage decisions**.

#### Wave 8 Stage B — F. Security and concurrency

1. **Backend permission** — All Wave 8 write endpoints require `SALES_MANAGE`; reads accept `SALES_MANAGE` or `SALES_VIEW`. Sales-group data scope (`salesperson_group_memberships` on `actor` → `salesperson_profiles`) is enforced in backend on any consignment or service row whose header carries `sales_group_id`. Cross-document scope (e.g. `customer_id` matching) is enforced where relevant. (UD-4 #8 + UD-2 #6 boundary)
2. **Permission registration** — Wave 8 may register new permission codes (e.g. `consignment:manage`, `service-sales:manage`, `consignment:view`, `service-sales:view`). The exact codes, the registry role/principal mapping, and the explicit frontend route visibility are **Design-stage decisions**; frontend hidden-only is not authorization (per `§34.7` P1-P5). (UD-4 #8)
3. **R-SAL-20 / R-SAL-21 / R-SAL-22 independent MySQL session proof** — Real independent-session MySQL race evidence is REQUIRED to transition the Wave 8 Audit Capability rows CAP-25 / CAP-26 from MISSING to COVERED; SQLite and single-thread tests cannot substitute for the first Wave 8 acceptance proof (UD-4 #7). The eventual Design must register a `server/mysql-sales-customer-wave8-concurrency.integration.js` (or analogous) file plus a corresponding worker at `scripts/gates/mysql-concurrency-sales-wave8-worker.mjs` and add it to the 9-suite list in `scripts/gates/mysql-concurrency-gate.mjs`.
4. **Row lock identities and transactional order** — The canonical lock identities are pre-declared above in §B.4 + `§29.44` (R-SAL-22: `sales_order_items.id` + `service_fulfillments.id`; R-SAL-20 / R-SAL-21: `consignment_commercial_lines.id` + Layer 2 Inventory position + Layer 3 Finance canonical identity). Specific transaction order, FOR UPDATE granularity, MySQL index-list selection to support range locks, deadlock-avoidance ordering, and READ COMMITTED vs REPEATABLE READ default are **Design-stage decisions**; the frozen Wave 6 LOT frontier convention (`idx_valuation_movements_identity_status_created` with prefix realization) is a usable precedent for any new frontier-style identity range lock Wave 8 needs.
5. **Audit** — Every state transition (service: CREATE / CONFIRM / CANCEL; consignment: instruction / settlement / return / cancel / reporting query) writes one `audit_logs` row. Audit is not bypassable from the frontend; the Frozen Wave 6 / Wave 7 audit machinery is reused unchanged.
6. **No assertion deletion, bypass, fake success, SQLite-as-MySQL substitution** — the closure follows the Wave 7 governance (`DR-SAL-06 §A.4.1 / §A.4.4`) verbatim: no PASS is manufactured by deletion / relaxation / skip / exception-to-success; SQLite PASS cannot stand in for real-MySQL PASS.

#### Wave 8 Stage B — G. Acceptance checklist (Stage C Design + Stage D Implementation + Stage E Final Acceptance gates, NOT executed here)

1. Functional closure: SC69 / SC70 / SC71 / SC72 / SC73 / SC74 / SC75 / SC76 / SC77 (Wave 8 SCs) all transition from MISSING / OUT_OF_SCOPE to COVERED against frozen Wave 1 / Wave 5 frozen contracts and frozen Wave 6 / Wave 7 frozen contracts; UAT-S-25 / UAT-S-26 / UAT-S-27 / UAT-S-41 all PASS.
2. Schema and migration parity: four new tables in fresh + upgrade + replay + idempotent rerun across SQLite and MySQL; all PK / FK / UNIQUE / CHECK / index metadata PASS; existing Wave 0..7 tables untouched.
3. Security / RBAC: every Wave 8 mutation is backend fail-closed against missing `SALES_MANAGE`; Sales-group data scope enforced; cross-document line linkage enforced; permission visibility ≠ authorization (UD-4 #8).
4. Idempotency and audit: every Wave 8 mutation has an idempotent replay; failure path produces zero partial side effects; every state transition writes an audit row.
5. Cross-domain ownership: Layer 1 Sales commercial, Layer 2 Inventory V21 ENTERPRISE-owned during consignment, Layer 3 Finance V22 canonical AR / settlement; no shadow ledger at any layer; no `inventory OUT` for service lines; no second Finance balance; nothing silent at any layer boundary.
6. SQLite focused tests: migration + functional + acceptance + bounded-superseding equivalents (modeled on Wave 6/7) all green; SQLite PASS cannot substitute for MySQL PASS.
7. Real MySQL migration and concurrency evidence: `pnpm.cmd test:mysql` PASS for the Wave 8 subset; `pnpm.cmd test:mysql:concurrency` PASS for the new Wave 8 suite with real independent sessions observed at `mysql_transaction_gates.gate_id=1`; all three Wave 8 R-SAL races exhibit legal serialized outcomes only; the gate's `MYSQL TEST ENVIRONMENT = UNAVAILABLE` output is `TEST_EVIDENCE_PENDING`, not PASS.
8. Frontend and responsive UAT: `src/pages/consignment.jsx` + the contextual service-fulfillment sub-page under Orders parentRoute are tested at 320 / 390 / 430 / 680 CSS px; Wave 7 mobile-first patterns reused verbatim; no Launcher expansion; no horizontal overflow at 320 px; min control ≥ 24 px; canary API smoke returns 2xx with real 390 px viewport; permission denial returns 401 / 403 as appropriate.
9. Documentation synchronization: `solution.md` gains Wave 8 §29.18.x + §29.19.x implementation-evidence sub-sections; `document.md` Wave 8 Freeze footer appended in the same additive pattern as Wave 6 / Wave 7; `log/YYYY-MM-DD.md` append-only entries record each gate; canonical counts `SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36` preserved unchanged throughout.

#### Wave 8 Stage B — H. Design Decisions Needed (clause-anchored, not invented)

The following decisions are not present in the frozen Contract in `§34.3.14 / §34.3.15 / §34.5 / §34.6 / §34.4 / §34.7 / §34.8` and must be made by Stage C Design (with evidence and trade-offs), or escalated as a `REQUIREMENT_REOPEN` if no frozen constraint can answer them.

```text
DDN-SVC-1  Service Fulfillment CANCELLED after CONFIRMED (partial vs full).
           — Frozen §29.18.1 / §29.32 lifecycle names CANCELLED but does
             not state partial semantics.
           — Options: (a) full cancel restores remaining capacity and is
             subject to optional Finance recognition reversal; (b) only
             a transition to a new PENDING row is permitted; (c) full
             cancel is allowed only pre-Recognition; (d) all CONFIRMED
             are immutable, requiring a symmetric "Negative Confirmed
             Evidence" row.
           — Recommendation: (a) full cancel pre-Recognition is allowed;
             post-Recognition a Finance-recognized reversal must use
             the same canonical Finance reconciliation pathway, never
             a direct Sales writer.

DDN-SVC-2  Service Fulfillment Idempotency-Key policy (header vs body
           vs payload fingerprint).
           — Frozen §34 (Wave 6 Option C) requires explicit header for
             Option C Reverse. Wave 8 service confirmation has no such
             frozen policy.
           — Options: (a) reuse the Wave 6 Option C explicit-header rule;
             (b) accept body `Idempotency-Key` only; (c) accept header
             only; (d) defer to canonical idempotency design in §29.45.
           — Recommendation: (a) explicit header required to keep
             `Idempotency-Key` policy uniform across Sales mutations,
             per the §29.45 rule and DR-SAL-05 Idempotency Addendum
             precedent.

DDN-CON-1  Consignment capacity re-validation source.
           — Frozen §29.19.3 Layer 1 formula locks to
             consignment_commercial_lines.* fields. Concurrent
             settlement-vs-return revalidation may need to re-read
             Layer 2 ENTERPRISE-owned position or Layer 3 Finance
             settlement total under the same transaction to detect
             lag-driven drift.
           — Options: (a) Layer 1 re-read only (cheapest, but lag may
             over-allow); (b) Layer 1 + Layer 2 re-read (Inventory
             FOR UPDATE on the canonical position); (c) Layer 1 +
             Layer 2 + Layer 3 re-read (broadest but most locks).
           — Recommendation: (b) Layer 1 + Layer 2 re-read; the
             settlement lag at Layer 3 is bounded by the canonical
             Finance writer running in the same transaction and is
             not separately race-prone at the consignment capacity
             decision. R-SAL-21's required result remains the same.

DDN-CON-2  Consignment location validate-on-write vs validate-on-mutation.
           — Frozen §29.19.1 names `consignment_commodity_locations`
             as commercial identity distinct from physical warehouse.
             The frozen contract does not state whether an instruction
             line may carry a `consignment_commodity_location_id`
             that maps to a closed or inactive commercial record.
           — Options: (a) fail-closed on create when location is
             inactive; (b) fail-closed only at settlement / return
             mutation; (c) block create + soft-warn at mutation;
             (d) delegate to Master & Engineering warehouse active
             status by transitive check.
           — Recommendation: (a) fail-closed on create + on
             settlement / return mutation, mirroring the active
             `product_commercial_classification` discipline for
             service lines.

DDN-CON-3  Consignment Instruction allow partial cancel / split.
           — Frozen SC72 names "Consignment Instruction" but does
             not state whether a partial cancel of an unsplit line
             is allowed before / during settlement.
           — Options: (a) line cancel only when
             settled+returned=0 (full cancel); (b) allow partial
             cancel with audit; (c) no cancel, only instruction
             quantity adjustment with reason+audit.
           — Recommendation: (c) no partial cancel; quantity
             adjustment only with reason + audit, mirroring the
             SO Change / Wave 4 contract discipline.

DDN-MIG-1  Migration registration point.
           — `server/migrations/sales-customer-domain.js` currently
             registers `wave-7-prepayment-reservation` as the latest
             step. Wave 8 must add one step. Naming, ordering,
             pre-upgrade-fresh-compatibility claim is a Design
             decision.
           — Options: (a) `wave-8-service-fulfillment-and-consignment`;
             (b) two separate steps; (c) reuse Wave 6 / Wave 7
             pattern verbatim.
           — Recommendation: (a) one additive step following Wave
             6 / Wave 7 pattern; matches Wave 6 / Wave 7 evidence
             ledger style.
```

Each DDN is recorded with options, evidence, recommendation. Stage C Design is expected to adjudicate them; if any DDN becomes a new business policy (not a Design choice), it must trigger `REQUIREMENT_REOPEN` and return to Stage B.

#### Wave 8 Stage B — I. Wave 8 frozen traceability + frozen contract preservation record

| Frozen item | Frozen location | This Record's relation to it |
|---|---|---|
| `§34.3.14` SC69..SC71 | document.md lines 4536–4546 | Cited; not rewritten. |
| `§34.3.15` SC72..SC77 | document.md lines 4548–4560 | Cited; not rewritten. |
| `§34.3.16` SC78..SC81 Reporting | document.md lines 4562–4573 | Out of scope for Wave 8; SC78..SC81 remain Wave 12 / 13 territory. |
| `§34.4` S08 / S18 | document.md lines 4712 / 4722 | Cited; not rewritten. |
| `§34.5` UAT-S-25 / 26 / 27 / 41 | document.md lines 4783–4785, 4817–4818 | Cited; not rewritten. |
| `§34.6` R-SAL-20 / 21 / 22 | document.md lines 4974–4976 | Cited; not rewritten. |
| `§34.7` Permission principles P1..P5 | document.md lines 4999–… | Cited; not rewritten. |
| `§34.8` cross-domain rows 7 / 8 | document.md lines 5029–5030 | Cited; not rewritten. |
| `§34.10` Out-of-scope | document.md lines 5054–… | Cited; not rewritten. |
| `§34.13` traceability + Audit CAP-25 / CAP-26 | document.md lines 5139–5256 | Cited; not rewritten; CAP-25 / CAP-26 transitions MISSING → COVERED is reserved for Wave 8 Freeze. |
| `§34.14` freeze baseline | document.md lines 5264–5346 | Cited; not rewritten. |
| `§34.15` DR-SAL-04..06 | document.md lines 5347–5458 | Cited; not rewritten. |
| Historical-baseline footer | document.md line 5461 | Preserved verbatim. |
| Wave 6 freeze footer | document.md line 5463 | Preserved verbatim. |
| Wave 7 freeze footer | document.md line 5465 (above) | Preserved verbatim. |
| `§34.15` governance (no new ID, no destructive shortcut, no cross-domain mutation without separate approval) | document.md lines 5373 / 5396 / 5410 / 5457 | Reaffirmed for Wave 8. |

#### Wave 8 Stage B — J. Original Read-Only Audit Register (corrections register)

The upstream Read-Only Audit Report was preserved as historical evidence (in the prior Wave 8 audit conversation history; it is **not** archived as a file in `docs/evidence/sales-customer-wave8/` because that directory does not yet exist on this branch). Corrections recorded below are applied to the *new* Stage B Requirement Closure record, per upstream instruction §1 ("Correct inaccurate findings in the new Requirement Closure record instead of silently rewriting the prior report"). Where the prior audit contained a finding that is corrected here, the correction is reflected in §B / §C / §D / §E / §F / §H above; downstream code, schema and test code are not modified by this Record.

| # | Audit claim / finding | Disposition in this Stage B Record |
|---|---|---|
| 1 | "Wave 7 must be modified to host the Service Item Sales Confirm Gate" | **CORRECTED (UD-2).** Service-item Sales Delivery Confirm Gate is a Wave 8 responsibility. A bounded Wave 8 modification to the existing Sales Delivery Confirm path may be authorized in a separate Stage C Design decision. Frozen Wave 5 / Wave 7 paths are not rewritten here. Reflected in §C.9. |
| 2 | "Absence of Wave 7 → Wave 8 table FK establishes absence of dependency" | **CORRECTED (UD-1).** Schema FK is one signal; runtime / business / project-order dependencies are independent. Reflected in §A.1 #1 + the §30.17 / §30.18 reconciliation note below. |
| 3 | "Service Fulfillment rewrites the Sales Delivery confirm path" | **CORRECTED (UD-2 #1 + #2).** Service-line confirm path does not write inventory OUT, does not decrement inventory, does not fabricate COGS; non-service lines preserve existing semantics. Service confirm requires eligible service-classification + Service Fulfillment in `CONFIRMED`; mixed service + physical lines follow per-line semantics; Prepayment Gate interaction is explicitly reconciled. Reflected in §C.5 + §C.9. |
| 4 | "Consignment CAN use the `inventory V21 CUSTOMER-owned` position during consignment" | **CORRECTED (`§29.19.0` + UD-4 #5).** Physical Inventory position at consignment is `owner_type='ENTERPRISE'` until a settlement / title-transfer event; CUSTOMER-owned Layer 2 is a different business meaning (entrusted stock) and is not consignment. Reflected in §D.3. |
| 5 | "Master products table needs `is_service` column" | **CORRECTED (UD-4 #1).** Sales-owned `product_commercial_classification` (A-61 / `§29.18.0`) is the Wave 1 / Wave 8 foundation; no Master `products` rewrite. Reflected in §C.2. |
| 6 | "A second Sales-owned reservation / prepayment ledger is acceptable for Wave 8" | **CORRECTED (UD-4 #6).** No Sales shadow inventory ledger, no second Finance AR ledger. Reflected in §A.2 #5 + §D.5 / §D.6. |
| 7 | "Frontend hidden-only is acceptable authorization" | **CORRECTED (UD-4 #8).** Hidden is not authorization; permission codes must map to backend permission rows. Reflected in §F.1 / §F.2. |
| 8 | "Wave 7 acceptance evidence is sufficient for Wave 8" | **CORRECTED (UD-4 #7).** Wave 8 R-SAL-20 / 21 / 22 require independent MySQL session evidence as part of Wave 8 acceptance; Wave 13 may repeat but cannot substitute for the initial Wave 8 proof. Reflected in §F.3. |
| 9 | "Consignment commercial location == physical warehouse" | **CORRECTED (UD-4 #4).** `consignment_commodity_locations` (A-47) is the commercial location; physical layer remains Inventory V21 `warehouse_id`; the two are not equal. Reflected in §D.1. |
| 10 | "New SC / Invariant / UAT / Race / Audit CAP IDs are needed for Wave 8" | **CORRECTED (UD-4 #10).** All Wave 8 traces re-use frozen SC69..SC77, S08 / S18, UAT-S-25 / 26 / 27 / 41, R-SAL-20 / 21 / 22, CAP-25 / CAP-26. Counts unchanged. Reflected in §A.2 #2 + §B. |
| 11 | "Wave 6 / Wave 7 frozen contracts must be re-opened to enable Wave 8" | **CORRECTED (UD-4 #9 + UD-2 #2).** Frozen Wave 6 / Wave 7 contracts are preserved verbatim. Wave 8 may perform an explicitly bounded modification to the Sales Delivery Confirm path under a separate Stage C Design authorization; that re-opening decision is recorded but not made here. |
| 12 | "Sales & Customer launcher should expand for Wave 8" | **CORRECTED (UD-5).** No launcher expansion; `src/pages/consignment.jsx` + a contextual service-fulfillment sub-page only. Wave 12 global Mobile IA redesign is out of scope. Reflected in §A.1 #9 + §A.2 #6. |

Each row maps to the relevant UD-n in the upstream authorization; no audit row is silently dropped; no row introduces a new frozen contract clause.

#### Wave 8 Stage B — K. Frozen §30.17 / §30.18 dependency-cell discrepancy note (UD-1 reconciliation item)

The upstream authorization records a discrepancy in `solution.md §30.17` (and possibly `§30.18`) where the Wave 7 dependency cell references Wave 5 + Wave 6 only, while the Wave 8 Service Fulfillment Confirm Gate creates a runtime dependency on Wave 7 (specifically the frozen `authorizeSalesPrepaymentGateForMutation()` call inside `confirmSalesDelivery()`). This Record records the discrepancy as a **bounded Stage C Design reconciliation item** and explicitly does NOT modify §30.17 / §30.18 in Stage B. The Stage C Design sub-section `§29.18.2` decision-point already encodes the runtime dependency on `authorizeSalesPrepaymentGateForMutation`; the Stage C Design must align the §30.17 / §30.18 Wave 7 dependency cell wording with that decision-point without rewriting any frozen §29 / §30 contract. (UD-1 final paragraph)

#### Wave 8 Stage B — L. Frozen Wave 6 / Wave 7 contracts explicitly preserved

This Record does NOT modify or re-open any of:

1. Wave 6 frozen contracts: DELIVERY_BACKED `reverseOperationalReturn` (frozen); Option A Confirm (`confirmOptionAReturn`) with R1 LOT conservative fence, R2 SERIAL outbound provenance, R3 NO_SOURCE commercial / valuation separation, R4 legacy fail-closed (frozen); Option C Restricted Economic Reversal with mandatory explicit `Idempotency-Key`, F5 `CHECK(amount_cents >= 0)` relaxation, F6 `cancellation_state` 2-value migration, Replacement lifecycle immutable fulfillment evidence, three-mode commercial source distinction, NULL/unknown marker 409 `SALES_RETURN_MARKER_UNKNOWN`, Wave 6 composite index `idx_valuation_movements_identity_status_created` prefix realization, `sales_return_valuation_provenance` additive carrier.
2. Wave 7 frozen contracts: `sales_prepayment_requirements` / `sales_prepayment_gate_results` / `sales_reservation_intent` carriers, Prepayment Gate PLANNING_RELEASE / RESERVATION / DELIVERY stage decisions and override pathway, Wave 7 R-SAL-15 bounded Finance integration contract extension (Finance parent balance lock on `settlement_unapplied_balances.id` where `balance_type='PREPAYMENT'`), Wave 7 Reservation Intent four-mode dispatch + react-to-event helpers, Wave 7 MySQL `assertMySqlColumnContracts` + `normalizeDefault` charset-prefix-with-escaped-quotes regex extension, Wave 7 expression-unique-index `COALESCE(sales_order_item_id, '')` parity, Wave 7 mobile-first PrepaymentGates + ReservationIntents surfaces with two new contextual routes under Orders parentRoute.
3. Wave 5 frozen contracts: Delivery Notice line capacity, DIRECT_ORDER / DELIVERY_NOTICE double-source Sales Delivery convergence, Sales Delivery confirm inventory OUT + valuation + COGS voucher chain.
4. Wave 1 frozen contracts: Sales Parameters / Sales Group / Customer Commercial Extensions / Customer Material / Product Commercial Classification (`product_commercial_classification` A-61 — the foundation SC69 uses).
5. Frozen Domain Ownership Principle: Master & Engineering owns `products` identity; Sales & Customer owns `product_commercial_classification`; Inventory V21 owns `inventory` / `inventory_v21` position; Finance V22 owns `account_receivables` / `settlement_unapplied_balances` / canonical V22 AR + settlement + refund + credit-adjustment machinery; Planning V19 owns `planning_reservations` / EXPECTED bounded-integration-contract-extension logic; Manufacturing & Quality owns production-cost / WIP; Procurement & Outsourcing owns PO / receipt; Accounting & Analytics owns GL / Voucher / Trial Balance / IS / BS; Platform owns notifications / workflows / numbering / generic rule infrastructure.

#### Wave 8 Stage B — M. Status and Hard Stop

Status going out of this Record: `WAVE8_STAGE_B_REQUIREMENT_CLOSURE_RECORDED — AWAITING USER CONFIRMATION BEFORE STAGE C DESIGN`. Wave 6 remains `WAVE6_FINAL_ACCEPTANCE_PASS — FROZEN` on `feature/sales-waves6-13@aee1e0c13d26dd840ae4b596340212eef03479c0`. Wave 7 remains `WAVE7_FINAL_ACCEPTANCE_PASS — FROZEN` on `feature/sales-waves6-13@0d4e4b8a0b71d43551072349b55f494d9a439b53`. Wave 9–13 remain `OUT_OF_SCOPE`. Wave 8 has not been authorized to start Stage C Design or anything beyond this Stage B Requirement Closure record.

Hard Stop: this Record is bounded. It does **not** authorize any of the following without a separate user authorization: Stage C Design work on `solution.md`, any Stage D Implementation, any test run (`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm test:mysql` / `pnpm test:mysql:concurrency` / `pnpm build`), any database connection / reset / DDL / DML, any Git operation (`add` / `commit` / `push` / `merge` / `rebase` / `reset` / `clean` / `stash` / `tag` / `push --tags`), any deletion of untracked SQLite / WAL / SHM artefacts, any modification to `APPLY_GUIDE.md` / `README.md` / `AGENTS.md` / `CLAUDE.md` / `package.json` / release tags, any new SC / Invariant / UAT / Race / Audit Capability ID, or any Wave 9–13 work. The next user action must explicitly confirm this Stage B Requirement Closure deliverable before Stage C Design starts.

---

## Wave 8 Stage B — Bounded Business Decisions & Cross-Domain Contract Reopen

### 1. Reopen reason, authority, scope and frozen protection

This additive Requirement record reopens only the business-policy and cross-domain-contract blockers identified by `solution.md §35.17`. It does not approve any option below and does not authorize a new Stage C revision or Stage D implementation. The historical Stage B closure, all historical Design text and all freeze records remain evidence and are not rewritten.

The following remain frozen and unchanged: Wave 6, Wave 7, Finance V22 recognition/settlement semantics, Inventory V21 position and mutation authority, the Sales Order Change contract, A-61 product commercial classification ownership, the four-table Wave 8 limit, and the existing SC / Invariant / UAT / Race / Audit Capability identifiers and counts. Wave 9–13 remain out of scope.

Decision classifications used by this record:

| Classification | Meaning in this Reopen |
|---|---|
| `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` | Existing Requirement and implementation evidence already determine the behavior; no new business approval is requested. |
| `TECHNICAL_DESIGN_CHOICE` | Existing approved policy permits Stage C to choose the implementation detail, once Stage C is separately authorized. |
| `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | The recommendation is only a proposal; the user must explicitly select or revise it. |
| `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED` | The current canonical owner lacks a proven callable contract required by Wave 8; the user must explicitly authorize the bounded extension before Design or implementation. |

Only the first two classifications may become implementation contracts without a further business-policy decision. Every recommendation under the latter two classifications remains unapproved.

### 2. Existing evidence baseline

The decisions below are based on the canonical documents and the actual runtime entry points, not on naming inference:

- Finance: `server/modules/finance-recognition.js` accepts explicit `DIRECT_BUSINESS_OPEN_ITEM`, `INVOICE_DRIVEN_OPEN_ITEM`, or `PROVISIONAL_TO_FINANCIAL`; it rejects a non-positive recognition amount. DIRECT creates the final source open item and later invoice processing links the source without recognizing a second open item. PROVISIONAL conversion currently requires the linked source to be fully invoiced. INVOICE_DRIVEN creates no open item until invoice processing. `server/modules/finance-recognition-policy.js` has a legacy fallback to DIRECT; Wave 8 may not rely on that fallback.
- Invoice linkage: `finance_invoice_source_links` provides stable invoice/source linkage and uniqueness within one invoice, but the inspected contract does not itself prove a locked cumulative cap across multiple invoices for one source.
- Gate and Finance locks: `authorizeSalesPrepaymentGateForMutation()` reads/locks Sales gate facts before its Finance adapter locks PREPAYMENT parent balances. Finance mutations acquire the PREPAYMENT parent lock at transaction start. Frozen `§29.17.7.5` requires PREPAYMENT parent first for the cross-domain composition. Current `confirmSalesDelivery()` obtains Delivery/Sales facts before calling the Gate. Therefore the current helper call graph is not proof of a globally composable parent-first lock order.
- Service/SO authority: current SO Change locks the change and SO/line facts, but does not count future `service_fulfillments`. The A-61 classification writer locks its own product/classification facts, but does not protect open service obligations. `§35.17` already requires both future paths to fail closed around outstanding/confirmed service facts.
- Inventory V21: the canonical position key is product + warehouse + bin + owner + status + `lot_id` + `serial_id`; ENTERPRISE ownership requires null `owner_id`. LOT identity is the canonical `lot_id`, not a newly normalized Sales batch-code namespace. `applyInventoryMutation()` requires immutable source and idempotency identities, locks affected position keys deterministically, and supports caller-owned transactions, but its source allowlist does not currently contain the three Wave 8 consignment sources. Its default valuation path can be best-effort; Wave 8 value-changing consignment operations cannot rely on swallowed valuation failure.
- Audit: the existing writer persists `audit_logs` inside the supplied transaction. A rolled-back transaction does not preserve that audit row. Existing Wave 8 Requirements require audited committed state transitions and zero failed side effects; they do not require a durable audit row for every rejected request.

### 3. Decision Package A — Service Fulfillment

| Item | Classification | Options and material effects | Recommendation (not approval) |
|---|---|---|---|
| A1 Finance recognition mode | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **A1-DIRECT:** CONFIRM creates final AR from the immutable fulfillment source; later invoice only links it. Fits SC70/SC71 recognition timing, but recognizes before invoice and needs the A3 invoice-cap contract. **A1-PROVISIONAL:** CONFIRM creates provisional AR; invoice converts it. Current adapter's full-invoice condition does not support arbitrary partial conversion without extension. **A1-INVOICE-DRIVEN:** CONFIRM records operational fulfillment with no AR until invoice; this changes the current Stage B promise that CONFIRM invokes Finance recognition/economic effect. | Select **A1-DIRECT** with an explicit `SERVICE_FULFILLMENT` policy; forbid policy fallback. It reuses Finance's final-open-item path, avoids a Sales ledger and provides the narrowest single-recognition rule. |
| A2 zero-amount service | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **A2-ZERO-FACT:** allow CONFIRMED operational evidence at exactly zero; store quantity/state and explicit zero business amount on the fulfillment, create no AR/open item, and let Delivery validate that committed evidence. **A2-BLOCK:** reject zero-value confirmation until Finance exposes a zero-effect result contract. Both prohibit a fabricated zero AR. | Select **A2-ZERO-FACT**. Zero is a genuine operational fact with no economic posting. Stage C must express the conditional Finance evidence shape and must not call the positive-amount Finance adapter. |
| A3 sales-invoice linkage | `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED` | **A3-FULL-ONLY:** one fulfillment may link to one full-value invoice; partial/multiple invoicing is rejected. This can remain narrow but reduces business capability. **A3-CUMULATIVE:** Finance locks the immutable fulfillment source/open item and enforces aggregate linked invoice amount not greater than its recognized amount, allowing partial and multiple invoices; opening balance is never recognized twice. | Select **A3-CUMULATIVE**. Use `source_type='SERVICE_FULFILLMENT'`, `source_id=service_fulfillments.id` and the existing `finance_invoice_source_links`; no fifth Wave 8 table. The cumulative, locked cap is the bounded Finance extension requiring approval. |
| A4 confirmed reversal | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **A4-PENDING-ONLY:** CANCELLED is reachable only from PENDING; CONFIRMED is immutable in Wave 8. Existing confirmed Delivery, invoice and AR remain untouched. **A4-CONTROLLED-REVERSAL:** permit CONFIRMED reversal only through Finance's canonical reversal, after Delivery/invoice eligibility checks, with immutable reversal history. This adds policy and cross-domain behavior. | Select **A4-PENDING-ONLY** for Wave 8. SC70/SC71 and S08 require confirmation, evidence and no service inventory movement; they do not promise post-confirmation reversal. CANCELLED remains a real PENDING transition, so no promised capability is silently removed. |
| A5 Wave 7 Gate integration | `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED` | **A5-CONFIRM-GATE:** treat each service CONFIRM as a new entry applying the existing DELIVERY-stage policy before recognition; each partial confirmation evaluates current authoritative PREPAYMENT balance. Later Sales Delivery rechecks the Gate but does not repeat service recognition. **A5-DELIVERY-ONLY:** defer Gate/economic recognition to Delivery, contradicting the current service-confirm recognition timing. Calling the current helper unchanged does not establish equivalent policy or safe lock order. | Select **A5-CONFIRM-GATE**, subject to C1. This reuses the frozen policy meaning but adds a Wave 8 trigger and a composable parent-first lock entry; it does not consume prepayment or rewrite Wave 7 history. |

#### A package requirements if the recommendations are approved

1. Each non-zero fulfillment has one immutable Finance source identity. Idempotent retry must return the same recognition result; Sales Delivery must never recognize the same service amount again.
2. Zero-value confirmation remains valid fulfillment evidence with zero Finance side effects. It must be distinguishable from a missing or failed Finance call.
3. Direct recognition establishes the maximum invoice-link amount. Partial/multiple invoice links are serialized and cumulative; an over-link fails with no side effect.
4. PENDING cancellation writes audit; CONFIRMED has no Wave 8 cancel command under A4-PENDING-ONLY.
5. Gate failure, Finance failure, classification conflict, quantity conflict or invoice-link conflict rolls back the whole attempted mutation. Durable rejected-attempt audit is not promised by this package.

### 4. Decision Package B — Consignment

| Item | Classification | Options and material effects | Recommendation (not approval) |
|---|---|---|---|
| B1 location deactivation | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B1-HISTORICAL-CONTINUITY:** inactive location rejects new instruction/handoff, but existing outstanding stock may legally settle or return using its immutable historical physical mapping; mapping cannot change while outstanding quantity exists. **B1-HARD-BLOCK:** inactivity blocks every mutation, stranding stock until reactivation. | Select **B1-HISTORICAL-CONTINUITY**. It preserves Inventory truth and permits disposal of existing stock. Mutation must lock the commercial line/location and affected Inventory positions and re-read active/mapping/outstanding facts. |
| B2 commercial amount authority | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B2-REPRESENTABLE-NET-UNIT:** `consignment_commercial_lines.unit_price_cents` is the immutable, tax-exclusive, post-discount net amount per whole sales UOM in document currency. For an SO source it must exactly equal the approved SO line's effective net-unit result at instruction; otherwise creation fails because the four-table carrier cannot preserve an arbitrary total. Without SO it is the explicitly supplied approved net unit price. Each cumulative settlement target is `floor(unit_price_cents × cumulative_settled_micros / 1,000,000)`; each event posts target minus prior-posted cents, so the final event receives the remainder. Later source-price changes do not alter the instruction. **B2-ARBITRARY-TOTAL:** support any independent line total/discount/tax allocation, which needs an extra field or pricing carrier and is outside the approved zero-extension/four-table boundary. | Select **B2-REPRESENTABLE-NET-UNIT**. It is deterministic with integer cents/micros and makes the existing field the sole amount authority, at the cost of rejecting non-representable source pricing. Tax itself remains outside this Wave 8 settlement amount rather than being invented. |
| B3 LOT canonical identity | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B3-V21-ID:** when LOT is absent, `lot_code` is null and `lot_code_key=''`; blank text is not a valid LOT. When present, input must resolve to one existing canonical Inventory V21 lot and `lot_code_key` stores that immutable lot id; `lot_code` is display evidence only. No trimming/case-folding/Unicode normalization defines identity. SQLite uses binary equality and MySQL must use an explicit binary/case-sensitive comparison for the key. **B3-NEW-CODE-NORMALIZATION:** define Sales-owned normalized batch-code identity, which has no frozen basis and risks dialect/collation divergence. | Select **B3-V21-ID**. Identity follows V21 `lot_id`; it does not invent ASCII-only or case-folding policy. Stage C must correct any earlier text that treated free-form `lot_code` normalization as canonical identity. |
| B4 partial cancel/split | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B4-WHOLE-DRAFT-CANCEL:** DRAFT document may cancel in full; after instruction/handoff, remaining quantity is resolved only by legal settlement or controlled return. Four tables are sufficient and R-SAL-20/21 keep one capacity anchor. **B4-PARTIAL-SPLIT:** add canceled/split quantity, lineage, allocation and concurrency evidence. The approved four tables currently have no sufficient carrier, so this requires a scope/schema reopen. | Select **B4-WHOLE-DRAFT-CANCEL** for Wave 8. Partial cancel/split remains out of scope, not an implied TODO. |
| B5 return destination/economics | `NEW_BUSINESS_POLICY_REQUIRES_USER_APPROVAL` | **B5-EXPLICIT-DESTINATION:** an unsettled return command names an active enterprise destination warehouse/bin; V21 moves stock from the immutable historical consignment position to that destination. Ownership remains ENTERPRISE and no AR/refund is created. A settled customer sales return follows the existing controlled Sales Return chain, not this command. **B5-HEADER-SOURCE:** always return to an inferred/header source location; this is ambiguous for bin-enabled or relocated operations. | Select **B5-EXPLICIT-DESTINATION**. Lock the commercial line and both position keys in deterministic order; settlement and return serialize on the same line, then re-read remaining quantity. R-SAL-21 must exercise one legal settlement and one legal return concurrently—an endpoint that always responds 409 is not acceptance evidence. |

#### B package requirements if the recommendations are approved

1. Commercial location and physical warehouse/bin remain different identities. The line preserves the historical mapping used by handoff; Inventory V21 remains physical authority.
2. All consigned on-hand remains `owner_type='ENTERPRISE'`, `owner_id=NULL` until settlement/title transfer. No CUSTOMER-owned shortcut and no Sales shadow inventory are permitted.
3. Settlement is an Inventory OUT plus the approved Finance commercial effect. Unsettled return is an Inventory MOVE/return-to-enterprise-location with no AR/refund. Post-settlement sales return uses its existing reverse chain.
4. `consigned_quantity - settled_quantity - returned_quantity` never becomes negative. R-SAL-20 and R-SAL-21 use real legal operations and the same locked commercial line capacity anchor.

### 5. Decision Package C — Cross-Domain Contracts

#### C1. Wave 7 / Finance lock composition

Classification: `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED`.

Observed and proposed lock chains (`→` means later acquisition inside the same logical mutation):

| Path | Current/proposed order and ownership | Finding |
|---|---|---|
| Existing Wave 7 Gate helper | Gate requirement/result read and Sales locks → Sales Order facts → Finance adapter PREPAYMENT parent lock; caller transaction/connection | Not composable with the frozen parent-first rule when the caller already holds Sales locks. |
| Proposed Service Fulfillment CONFIRM | PREPAYMENT parent ids in ascending order → authoritative Gate re-read/evaluation → SO/service capacity line → fulfillment row/range → Finance recognition source/open item → audit; one caller-owned transaction | Required target order; unavailable as a proven current public contract. |
| Existing Sales Delivery CONFIRM | Delivery and line/capacity facts → SO/quality/period facts → Gate helper → Inventory positions/valuation → Finance recognition; caller transaction | The current order cannot itself prove compatibility with PREPAYMENT-parent-first composition. |
| Finance recognition | Source/open-item reads and inserts inside the caller transaction when supplied | No explicit cross-domain `FOR UPDATE` ordering contract was found for the Wave 8 source. |
| Finance PREPAYMENT consume/refund/reversal | PREPAYMENT parent balance lock at the start of the Finance mutation → children/effects | This is the frozen anchor order that Wave 8 must respect. |

Minimal proposed extension, not approved: Finance/Wave 7 exposes a composable prepayment authorization operation that (a) discovers candidate PREPAYMENT parent identities without holding Sales row locks, (b) locks those parent rows in ascending id order on the caller-owned connection, (c) re-reads authoritative balances and Gate inputs after locking, and only then (d) permits the caller to acquire Sales capacity/document locks. Service CONFIRM and any affected Sales Delivery entry must use this composition. Finance recognition must separately declare a deterministic source/open-item lock order after Sales capacity locks. Deadlock retry may handle transient database victims but cannot replace the ordering contract. No frozen policy meaning, balance ownership or Gate result meaning changes.

Potential cycle being removed: Delivery/Service path holding Sales then waiting for PREPAYMENT, while a Finance mutation holds PREPAYMENT then reaches a Sales-related dependency. Until this extension is approved and designed, neither Service CONFIRM nor the affected Delivery composition is implementation-ready.

#### C2. Inventory V21 consignment writer

Classification: `BOUNDED_CROSS_DOMAIN_CONTRACT_EXTENSION_REQUIRED`.

Minimal proposed extension, not approved:

| Operation | Immutable source identity | V21 effect |
|---|---|---|
| `CONSIGNMENT_HANDOFF` | source id = consignment document id; source item id = commercial line id; idempotency key bound to operation + line + client key | MOVE from explicit enterprise source warehouse/bin to the line's resolved historical consignment warehouse/bin. |
| `CONSIGNMENT_SETTLEMENT` | source id = immutable settlement event identity derived from line + idempotency key; source item id = commercial line id | OUT from the historical consignment position for only the settled quantity. |
| `CONSIGNMENT_RETURN` | source id = immutable return event identity derived from line + idempotency key; source item id = commercial line id | MOVE from historical consignment position to the explicitly supplied active enterprise destination. |

For all three operations, the canonical position key remains V21 product/warehouse/bin/ENTERPRISE/null-owner/status/`lot_id`/`serial_id`; the commercial location id is never substituted for `warehouse_id`. Source and destination positions are locked in canonical key order. LOT/SERIAL validation and conservation use existing V21 authority. The caller owns one transaction/connection; any commercial, Inventory, valuation or audit failure rolls back the whole mutation. Repeated immutable idempotency identity returns the same effect and mismatched reuse fails closed. Audit records only the committed operation.

Handoff and return must use strict value-preserving movement behavior; settlement must use strict Inventory issue/COGS behavior. A best-effort valuation failure is not acceptable for these operations. The bounded source impact is the V21 mutation source-type contract in `server/lib/inventory-mutation.js` and, only if required to expose strict value-preserving/issue behavior, the existing canonical financial-inventory adapter; the position-key module retains its meaning. No Inventory schema/migration, shadow stock table, Sales stock ledger or fifth Wave 8 table is approved.

#### C3. Platform failure audit

Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT`.

The current audit writer participates in the business transaction, so a rollback also removes its audit insert. Current Wave 8 Requirement demands audit for committed transitions and zero side effects for failed mutations; it does not require durable logging of every rejected attempt. Therefore Wave 8 must not promise a persistent failure audit, and no Platform contract extension or new audit subsystem is needed. If durable rejected-attempt evidence is later required, it is a separate Platform Requirement decision outside this Reopen.

### 6. Traceability and contract impact

| Frozen trace | Impact of this Reopen |
|---|---|
| SC70–SC71, S08 | A1/A2 define recognition and zero-value evidence; A4 preserves service confirmation without Inventory OUT and limits cancel to PENDING if approved; A5/C1 gate every economic confirmation without changing the frozen Gate policy. |
| SC72–SC77, S18 | B1–B5 keep commercial, Inventory and Finance truth separate; enterprise ownership persists until settlement; commercial location never becomes an Inventory dimension. |
| R-SAL-20 | Settlement races serialize on `consignment_commercial_lines.id`; combined settled quantity and financial/physical effects cannot exceed capacity. |
| R-SAL-21 | Legal settlement and legal unsettled return race on the same line, with real V21 effects; combined settled+returned cannot exceed consigned quantity. |
| R-SAL-22 | Service confirmations serialize on the SO service-line capacity anchor and fulfillment evidence while respecting the C1 parent-first boundary. |
| UAT-S-25 / UAT-S-26 / UAT-S-27 / UAT-S-41 | Acceptance must cover explicit service mode/zero/invoice behavior, consignment instruction/handoff/settlement/return, mobile flows already in scope, and real cross-domain failure/rollback behavior. No new UAT id is created. |
| Audit CAP-25 / CAP-26 | Committed Wave 8 transitions remain queryable; failed requests have zero business side effects but no new promise of durable failure audit. |

The four and only four new Wave 8 tables remain `service_fulfillments`, `consignment_commercial_documents`, `consignment_commercial_lines`, and `consignment_commodity_locations`. This Reopen approves neither a fifth table nor an extension of an existing table. B2 deliberately constrains representability to existing `unit_price_cents`; B3 uses canonical V21 `lot_id` as the key value; A3 uses the existing Finance invoice-source-link carrier. API shapes, permissions and error codes remain Stage C technical design work after the policy selections; backend authorization remains fail closed.

### 7. Approved scope versus unapproved decisions

Already governed and therefore not reopened: four-table maximum; no new existing-table columns; no Sales-owned Finance or Inventory ledger; service fulfillment has no Inventory OUT/COGS; consignment stock is ENTERPRISE-owned before settlement; committed transitions are audited transactionally; failures have zero partial business side effects; existing trace identifiers/counts are unchanged.

The following remain explicitly **unapproved** and require user decisions:

1. A1 recognition mode: DIRECT, PROVISIONAL or INVOICE_DRIVEN.
2. A2 zero-value confirmation: operational zero fact or block.
3. A3 invoice policy: full-only or cumulative partial/multiple linkage, including the bounded Finance extension.
4. A4 reversal: PENDING-only cancellation or controlled CONFIRMED reversal.
5. A5 Gate trigger at Service CONFIRM and the bounded C1 composition extension.
6. B1 inactive-location historical continuity or hard block.
7. B2 representable tax-exclusive net-unit authority or a separately reopened amount carrier/scope.
8. B3 canonical V21 lot-id identity or a separately approved normalization policy.
9. B4 whole DRAFT cancel only or a separately reopened partial-cancel/split carrier.
10. B5 explicit return destination or header-source inference.
11. C2 the three-source Inventory V21 bounded writer extension and strict valuation behavior.

C3 requires no decision unless the user adds a new durable-failure-audit Requirement.

### 8. Exact input required for the next Stage C correction

Stage C must not resume until the user supplies explicit selections for A1, A2, A3, A4, A5, B1, B2, B3, B4, B5, C1 and C2 (approval of each recommendation is sufficient; revisions must state the replacement policy). The next authorization must also explicitly permit `solution.md` modification. Once authorized, Stage C must:

1. make the selected policies the active service/consignment contract and supersede only conflicting Wave 8 §35 text;
2. specify the C1 parent-first callable API, transaction ownership, authoritative re-read, deterministic locks and Delivery compatibility;
3. specify A3 invoice cumulative/full-only enforcement without duplicate Finance recognition;
4. specify the C2 source allowlist, immutable identities, exact V21 position mapping and strict valuation rollback;
5. align schema constraints with A2/B2/B3/B4 without adding a table or existing-table column;
6. map the selected behavior to the existing SC70–77, S08/S18, R-SAL-20/21/22, UAT-S-25/26/27/41 and CAP-25/26 only; and
7. retain the implementation hard stop until that corrected Design is separately approved.

### 9. Hard Stop

This record is Requirement decision material, not approval. It changes no historical Requirement, Design, source, migration, test, frontend, configuration, database or Git state. It authorizes no test/build/format/migration/database/Git operation, no Stage C edit, no Stage D implementation and no Wave 9–13 work.

**Final governance status: `WAVE8_STAGE_B_BOUNDED_REOPEN_DELIVERED — AWAITING USER DECISIONS`. Hard Stop.**

---

## Wave 8 Stage B — User Decision Approval Record

Authorization source: the user's `Sales & Customer Wave 8 — User Decision Approval & Stage C Final Design Reconciliation` instruction dated 2026-10-19. This record approves the business decisions below and authorizes one bounded `solution.md §35` Design reconciliation only. It does not authorize Stage D Implementation, tests, builds, formatting, migration execution, database access, Git operations, or Wave 9–13.

| Decision | User-approved option and condition |
|---|---|
| A1 | `A1-DIRECT`: explicit `DIRECT_BUSINESS_OPEN_ITEM` for non-zero `SERVICE_FULFILLMENT`; immutable fulfillment source; no fallback and no duplicate Sales ledger. |
| A2 | `A2-ZERO-FACT`: zero-value Service Fulfillment may CONFIRM as authoritative operational evidence without calling Finance recognition or creating a zero AR. |
| A3 | `A3-CUMULATIVE`: partial/multiple invoice links are allowed through existing `finance_invoice_source_links`, subject to a locked cumulative source-capacity extension and no fifth table. |
| A4 | `A4-PENDING-ONLY`: only `PENDING → CANCELLED`; CONFIRMED has no Wave 8 cancel/reversal API. |
| A5 | `A5-CONFIRM-GATE`: every Service CONFIRM is a new DELIVERY-stage Gate entry, rechecking current authority without consuming prepayment; later Delivery rechecks independently. Subject to C1. |
| B1 | `B1-HISTORICAL-CONTINUITY`: inactive locations block new instruction/handoff; historical unsettled stock may settle/return from verified V21 movement evidence; mapping is immutable while outstanding. |
| B2 | `B2-REPRESENTABLE-NET-UNIT`: immutable tax-exclusive post-discount integer-cent `unit_price_cents`; BigInt cumulative allocation; non-representable source economics fail closed. |
| B3 | `B3-V21-ID`: `lot_code_key` carries canonical V21 `lot_id`; `lot_code` is display evidence only; no Sales-owned lot normalization. |
| B4 | `B4-WHOLE-DRAFT-CANCEL`: only a not-handed-off DRAFT instruction may be cancelled in full; no partial cancel/split. |
| B5 | `B5-EXPLICIT-DESTINATION`: unsettled return names a legal enterprise warehouse/bin and uses strict V21 MOVE; no AR/refund; settled sales return uses the existing controlled reverse chain. |
| C1 | Approved bounded Design scope for PREPAYMENT-parent-first Gate/Finance lock composition, authoritative re-read, stale-plan rollback/retry and real independent-session MySQL proof. Frozen Wave 7/Finance business semantics remain unchanged. |
| C2 | Approved bounded Design scope for V21 sources `CONSIGNMENT_HANDOFF`, `CONSIGNMENT_SETTLEMENT`, `CONSIGNMENT_RETURN`, strict value conservation/COGS, canonical tracking, caller-owned atomic transaction and no V21 schema extension. |
| C3 | Existing Platform audit contract accepted: committed transitions are audited in-transaction; failed transaction effects and uncommitted audit roll back together; no durable failed-attempt subsystem is required. |

All 12 requested decisions (A1–A5, B1–B5, C1–C2) are approved with the stated conditions; C3 is accepted. The four-table limit, zero existing-table column extension, existing trace identifiers/counts, Wave 6/7 freeze and Stage D hard stop remain binding. Any carrier conflict found during Design must be reported explicitly and may not be solved by silent policy or schema expansion.

**Requirement decision status: `WAVE8_STAGE_B_USER_DECISIONS_APPROVED — STAGE_C_FINAL_RECONCILIATION_AUTHORIZED`.**

---

## Wave 8 Stage B — V21 Historical Position Evidence Amendment

> Authorization: the user's `Wave 8 — Bounded V21 Evidence Carrier Requirement Amendment` instruction dated 2026-10-19. This is a bounded Requirement amendment only. It preserves the Wave 8 Stage D Hard Stop现场, does not amend `solution.md`, does not authorize source/migration/test/frontend/configuration changes, and does not authorize tests, builds, database access or Git writes.

### A. Root-cause verification

The original active Wave 8 contract kept exactly four new Wave 8 business tables and prohibited every existing-table column extension. Stage D inspection proved that this restriction cannot carry the approved B1/B5 historical-position semantics.

1. `applyInventoryMutation()` validates a complete canonical `fromPosition` / `toPosition` tuple at mutation time: product, warehouse, bin, owner type/id, stock status, LOT id and SERIAL id. It derives `position_key` only after those inputs pass V21 master/owner/status/bin/identity validation. A bin-enabled warehouse requires an explicit valid bin.
2. The canonical position key is a lowercase SHA-256 digest of the normalized tuple. It can verify a known tuple by recomputation but is intentionally one-way and cannot reconstruct warehouse/bin/owner/status/LOT/SERIAL values.
3. Current `inventory_transactions` persistence contains transaction id, warehouse, product, quantity/direction/balance, source identity, dates and later LOT/SERIAL/valuation fields, but the active V21 writer does not persist the complete position tuple, position key, bin, owner, stock status, movement group, or its supplied source item in that row.
4. Current `tracked_inventory_movements` contains its own id, `transaction_id`, source/source-item, product, warehouse, direction, quantity, LOT/SERIAL, dates and reversal flag. It does not persist bin, owner, stock status, position key, movement group or movement kind. It therefore narrows identity for LOT/SERIAL but does not reconstruct a complete historical position.
5. Current `inventory_mutation_log` contains one row per `applyInventoryMutation()` call with idempotency key, movement group, source type/id, movement kind, quantity, business date, actor and timestamp. It does not contain `source_item_id`, normalized from/to identity, request fingerprint, or the inventory transaction ids created by that mutation.
6. `inventory` contains the current complete position identity and balance, not an immutable history snapshot. `inventory_lot_balances` and `inventory_serials.current_warehouse_id` are current identity/location projections and likewise cannot prove the original handoff bin/owner/status. Current commercial-location mapping is mutable after outstanding quantity closes and is expressly not historical Inventory authority.
7. Bin-enabled stock makes the gap decisive because neither tracking nor valuation evidence carries the historical bin. LOT evidence retains LOT and warehouse but still loses bin/owner/status. SERIAL evidence retains SERIAL and warehouse but still loses bin/owner/status, and the current SERIAL location can subsequently change.
8. One Handoff line can require multiple V21 mutations: strict LOT/SERIAL processing is partitioned by canonical identity, and multiple SERIAL ids are each independent positions. All partitions may share one `movement_group_id` and commercial `source_item_id`, while each call has its own idempotency key and OUT/IN transaction pair. Therefore `movement_group_id` is a non-unique correlation identity, not a unique movement-row identity.
9. Settlement/Return must start from `consignment_commercial_lines.handoff_movement_group_id`, identify every Handoff mutation row for that commercial line, recover the persisted destination position of each applicable partition, subtract later lawful settlement/return evidence by exact identity, then lock and revalidate the current V21 position. The group alone is insufficient without source-item and per-mutation direction/position evidence.
10. Current V21 replay reads only `movement_group_id` by unique `idempotency_key`. It neither compares the replayed request's source/item/kind/quantity/date/positions/modes nor returns the original transaction/position evidence. Same-key changed semantics can therefore be silently treated as replay by the current primitive; that is insufficient for new Wave 8 commands.
11. Existing persisted evidence was exhaustively considered: current inventory rows, inventory transactions, tracked movements, tracked source allocations, LOT/SERIAL masters and balances, valuation movements, mutation log, audit detail and remark. No existing combination can recover a bin-complete immutable from/to tuple for every legal Handoff. Audit text, remark and client-supplied free text are not physical-position authority.

Coverage classification for this amendment: `SEMANTIC_MISMATCH` — the approved historical-continuity Requirement is valid, but the original zero-extension carrier restriction makes it unrepresentable in the real V21 schema.

### B. Existing-schema evidence matrix

| Carrier | Persisted authority relevant to Wave 8 | Missing for historical Handoff resolution | Permitted use |
|---|---|---|---|
| `inventory` | Current complete canonical position and on-hand | Immutable handoff-time snapshot and event correlation | Re-lock/revalidate current balance after historical identity is resolved; never substitute current state for history. |
| `inventory_transactions` | Physical direction, quantity, warehouse/product, source and valuation linkage | Complete bin/owner/status/position tuple, movement group; active writer omits source item | Physical/valuation evidence only; not sufficient alone. |
| `tracked_inventory_movements` | Source item, transaction id, direction, warehouse/product, LOT/SERIAL | Bin/owner/status/position key and movement group | LOT/SERIAL and transaction corroboration; not sufficient alone. |
| `tracked_source_allocations` | Source-item LOT/SERIAL allocation intent/posting state | From/to location, owner/status, movement group and physical transaction pair | Tracking allocation proof only. |
| `inventory_valuation_movements` | Product/warehouse/LOT/SERIAL value movement and inventory transaction linkage | Bin/owner/status/position key and movement group | Value conservation/COGS proof only. |
| `inventory_mutation_log` | Unique idempotency key, movement group, source, kind, quantity/date | Source item, normalized from/to identities, semantic fingerprint and exact transaction association | Preferred bounded extension point because it already owns mutation idempotency/correlation. |
| audit / remark | Human-readable committed-operation context | Structured canonical identity and enforceable replay equality | Diagnostic only; explicitly prohibited as position authority. |
| commercial location mapping | Current Sales mapping to warehouse/bin | Immutable historical V21 fact | New Handoff validation only; never used to reconstruct an executed Handoff. |

### C. Option 1 amended Requirement contract

The user selects **Option 1 — Minimal Additive Extension to Existing Inventory V21 Evidence Carrier**. The active Wave 8 Requirement is amended as follows:

1. The four Wave 8 business tables remain unchanged in count. No fifth Wave 8 business table, shadow inventory ledger or Sales-owned physical balance is allowed.
2. A minimal additive extension to an existing Inventory V21 evidence table is now permitted solely to preserve mutation-time normalized position evidence required by Consignment Handoff/Settlement/Return. `inventory_mutation_log` is the preferred candidate because it already owns idempotency and movement-group correlation; the final table/field realization remains a Stage C decision.
3. The extension must provide enough immutable evidence to identify one mutation call within a possibly multi-row movement group, associate it with `source_type + source_id + source_item_id`, distinguish source and destination, recover the complete normalized canonical position tuple for each present side, prove its physical inventory transaction association, and validate exact replay semantics.
4. Every saved identity must be produced from V21's actually normalized and validated `fromPosition` / `toPosition` inside the canonical writer. Client JSON, commercial-location mapping, remark or audit text cannot be copied as authority without canonical normalization and revalidation.
5. Handoff evidence and physical mutation must commit in the same caller-owned transaction. Evidence is insert-once/ordinary-edit-prohibited. Any inventory, tracking, valuation, business, audit or evidence failure rolls back all effects.
6. Settlement performs strict canonical V21 OUT; Return performs strict canonical V21 MOVE to an explicit legal enterprise destination. Neither may directly update inventory or bypass `applyInventoryMutation()`.
7. Historical evidence resolves the identity that was handed off; it does not assert that stock is still available. Settlement/Return must recompute/verify the stored tuple, lock current canonical positions in V21 order, and revalidate balance, status, owner, LOT/SERIAL, period, tracking and valuation authority. Missing, malformed, ambiguous or insufficient evidence fails closed.
8. Ownership remains `ENTERPRISE` with null owner id on both sides of Handoff/Return until the approved settlement/title-transfer event. No CUSTOMER-owned proxy is introduced.
9. Idempotency identity remains the existing unique `idempotency_key`. Same key plus exactly equivalent normalized semantics returns the same movement group and historical evidence without new rows or effects. Same key with any material semantic difference returns conflict. Multiple partition keys may share one movement group; the group itself is not made unique.
10. Legacy rows remain readable with new fields null. No guessed backfill, startup fabrication, commercial-map inference or rewriting of historical economic facts is allowed. A mutation requiring historical position truth fails closed when the legacy evidence is incomplete.
11. Inventory & Warehouse continues to own physical position, mutation, tracking, valuation evidence integration and idempotency carrier. Sales & Customer owns the consignment commercial document/capacity and references the Inventory evidence; it does not own or edit that evidence.

This amendment replaces only the conflicting Wave 8 clauses `zero existing-table column extensions` / `no V21 schema extension`. All other A1–C3 decisions, the four-table business model, Wave 6/7 frozen semantics, V21 position identity and canonical-writer ownership remain unchanged.

### D. Candidate-field minimal-sufficiency analysis for Stage C

The following are candidate responsibilities, not an approved physical schema:

| Candidate | Why it may be necessary | Why it is not sufficient alone / Stage C question |
|---|---|---|
| `source_item_id` | Disambiguates the commercial line inside a document and movement group. | Still cannot recover either position or prove the physical transaction pair. |
| `from_position_identity_json` | Can preserve the complete normalized source tuple with fewer additive columns. | Must define canonical key order/version, JSON validation, exact null semantics and SQLite TEXT versus MySQL JSON parity. Hash/key alone is insufficient. |
| `to_position_identity_json` | Preserves the actual Handoff destination and Return destination independent of later mapping changes. | Same serialization/parity requirements; must be null for legitimate single-sided OUT. |
| from/to inventory transaction ids | Directly binds each evidence side to the exact physical ledger row and enables direction/quantity/source verification. | Stage C must decide whether two nullable references are mandatory or whether an equally strong existing relation can be proven for NONE/LOT/SERIAL and multi-partition cases. Mere timestamp/source joins are not sufficient. |
| request fingerprint/digest | Provides constant-time exact semantic replay conflict detection, including normalized positions and execution modes. | Must not replace readable position evidence; Stage C must define the canonical fingerprint payload/version and legacy-null behavior. |
| explicit physical columns | Strong typing and direct SQL predicates/FKs. | Duplicates up to eight dimensions per side, creates a broad nullable-column matrix and is less bounded than two versioned snapshots; Stage C must justify it if selected. |
| `from_position_key` / `to_position_key` only | Compact and useful for current-position lock lookup. | SHA-256 is non-reversible and cannot satisfy historical reconstruction by itself; keys may accompany but cannot replace the tuple snapshots. |
| separate source/destination evidence rows | Natural one-direction-per-row model. | Would require a new carrier/table or change current row cardinality; not approved unless Stage C proves an existing carrier can express it without a fifth table. One mutation-log row with two independently identified sides is the preferred bounded shape. |

Minimum semantic sufficiency therefore requires, regardless of final names: source-item correlation; complete normalized from/to snapshots; unambiguous per-call identity within a non-unique movement group; exact replay comparison; and verifiable association to the physical OUT/IN transactions. Stage C must select the smallest cross-dialect realization and may not omit one of these responsibilities merely because LOT/SERIAL tracking partially duplicates it.

### E. Schema, migration and compatibility requirements

1. SQLite and MySQL 8 must expose equivalent nullability, value domain, identity comparison, JSON/text validation, indexes and replay behavior.
2. Fresh bootstrap, additive upgrade of an existing database, and repeated migration execution must converge without destructive DDL or data repair.
3. New columns must be nullable for historical rows. New Wave 8 writes must satisfy the complete-evidence invariant at the application/constraint boundary selected in Stage C.
4. Existing `idempotency_key` identity and historical values remain unchanged. Existing legal callers retain their business behavior; the extension cannot force fabricated evidence onto old rows or reinterpret their economics.
5. `movement_group_id` remains a many-mutation correlation id. Stage C must define the non-unique lookup index and stable ordering for `(movement_group_id, source_type, source_id, source_item_id, mutation-row-id)` or an equivalent key.
6. New transaction references, if selected, must preserve OUT/IN direction, source, quantity and atomic existence across both dialects. No timestamp-based or remark-based association is acceptable.
7. JSON, if selected, stores only a versioned canonical normalized position object; it is not arbitrary client JSON. Explicit columns, if selected, must remain bounded to the same position contract and cannot redesign V21 identity.
8. No existing economic row is updated to claim new facts; no GET/startup repair is allowed. Rollback retains schema but not partially written mutation/evidence rows.

### F. Traceability and current Stage D work preservation

- R-SAL-20 and R-SAL-21 require settlement/return races to resolve the same immutable Handoff evidence, then serialize on current commercial capacity and V21 positions. The amendment supplies the missing historical correlation; it does not relax capacity or current-balance checks.
- R-SAL-22 is not structurally changed; Service Fulfillment concurrency remains governed by the approved SO-line/fulfillment/Finance locks. It remains in the Wave 8 combined acceptance because the implementation worktree is one bounded Wave.
- UAT-S-26 must prove instruction/Handoff evidence, exact ENTERPRISE destination position, settlement OUT, strict value/Finance conservation and complete trace from commercial line to physical transactions.
- UAT-S-27 must prove inactive-location historical continuity, explicit return destination, exact Handoff-source reconstruction and failure on missing/ambiguous evidence.
- S18 remains the three-truth invariant: commercial location, physical position/ownership and settlement are distinct. This amendment strengthens that separation by prohibiting mapping-based historical inference.
- No new SC, Invariant, UAT, Race or Audit CAP id is created; canonical counts remain unchanged.

The partial Stage D files and edits already present in the worktree are preserved as an unaccepted Hard Stop现场. They are not rolled back, completed, migrated, tested, committed or declared PASS. In particular, the four-table Wave 8 migration, registry entry, permission seeds, Service Fulfillment skeleton, C1 adapter changes, V21 source allowlist and migration-runner changes remain subject to the corrected Stage C Design and later explicit Stage D resumption authorization.

### G. Mandatory Stage C design decisions

Stage C must resolve and receive separate user approval for all of the following before Stage D can resume:

1. Exact existing V21 table selected for the additive carrier and proof that no second canonical writer is created.
2. Exact field list, types, nullability, constraints and index order for SQLite/MySQL; JSON versus explicit-column decision and canonical snapshot version/serialization.
3. Whether from/to inventory transaction ids are mandatory, their FK/application validation, and how tracked/valuation rows corroborate NONE, LOT and SERIAL partitions.
4. Per-mutation identity and stable ordering when multiple rows share one movement group and source item; no uniqueness may incorrectly collapse multiple SERIAL partitions.
5. Canonical request-fingerprint inputs, replay result shape and mismatch error contract, including valuation/tracking modes and legacy-null compatibility.
6. Handoff writer sequence that obtains normalized V21 identities, writes physical OUT/IN and immutable evidence atomically, and returns the complete replayable evidence set.
7. Settlement/Return resolver algorithm from commercial line → movement group → source item → partition evidence → current V21 position, including later Settlement/Return consumption of specific LOT/SERIAL evidence.
8. Lock order for mutation-log evidence, current positions, LOT/SERIAL, valuation and commercial capacity; independent-session proof for R-SAL-20/21.
9. Additive migration strategy and metadata assertions for fresh/upgrade/replay, including old nullable rows and no guessed backfill.
10. Compatibility boundary for existing V21 callers and tests, plus fail-closed error codes for missing, malformed, ambiguous or replay-conflicting evidence.
11. Required focused, regression, heavy and protected MySQL acceptance evidence. This Requirement stage does not execute any of them.

### H. Resume gate and status

Wave 8 Stage D remains stopped. Resume requires, in order: user acceptance of this Requirement amendment; separately authorized Stage C update to `solution.md`; user acceptance of that Design; then explicit authorization to resume Stage D. Until then no source, migration, test, frontend, configuration, database or Git write is authorized beyond this Requirement record and its append-only log.

**Final status: `WAVE8_STAGE_B_V21_EVIDENCE_AMENDMENT_DELIVERED — AWAITING_USER_ACCEPTANCE`. Hard Stop.**

---

## Wave 8 Stage D — Implemented Capability Coverage Record

> This record describes the implementation produced after the user accepted §35.19 and explicitly resumed Stage D. It does not change the approved Requirement, create a new global SC/Invariant/UAT/Race/CAP identity, or declare Final Acceptance/Freeze.

### Coverage delivered

- Service Fulfillment: `PENDING / CONFIRMED / CANCELLED`, Sales Group scope, SO-line capacity, confirmed immutability, zero-value operational fact, DIRECT Finance recognition, period gate, C1 parent-first Gate, audit and idempotency are implemented.
- Mixed Delivery: physical lines retain V21 OUT/valuation/COGS; service lines require confirmed fulfillment capacity and do not create physical OUT, COGS or duplicate Finance exposure.
- Finance A3: opaque invoice-source-link identity, frozen tuple uniqueness, exact posted-invoice replay, cumulative per-fulfillment quantity/cents capacity, multi-fulfillment invoice allocation, multi-source Service Credit allocation, VOID-aware capacity and weak-writer rejection are implemented without a second AR/Credit engine.
- Consignment: commercial location/document/line lifecycle, Handoff, partial/multiple Settlement, explicit-destination Return, historical continuity, reports, RBAC/scope/audit/idempotency and strict V21 tracking/valuation/COGS/Finance composition are implemented.
- V21 evidence: the approved nine nullable fields are additive on `inventory_mutation_log`; canonical Position Snapshot V1, exact OUT/IN references, request fingerprint, immutable Consignment evidence and fail-closed legacy/malformed evidence behavior are active.
- UI/API: Service Fulfillment and Consignment are contextual routes only; direct URL/refresh/navigation use the canonical registry and no global Launcher tile was added.

### Acceptance evidence boundary

The implementation includes focused SQLite functional coverage, migration/schema parity coverage, full repository gates and protected MySQL independent-session concurrency for R-SAL-20/21/22 and A3 POST/POST, POST/VOID, Credit/Credit and Credit/VOID. R-SAL-15 remains the frozen Wave 7 parent-lock regression in the combined MySQL gate. Exact command outcomes are recorded in `log/2026-10-20.md`.

Implementation evidence is not user acceptance. Wave 8 remains awaiting the user's independent Final Acceptance and must not be labelled FROZEN before that decision.
## Wave 8 Residual Requirement Amendment — R1/R2/R3 (2026-10-21)

> This is a **Requirement-only** amendment closing the three residual blockers reported in
> `solution.md §35.21.8` / `log/2026-10-20.md`. It is additive to Wave 8 and preserves verbatim every
> approved §35.18/§35.19/§35.21 contract, every frozen §28–§30 Finance/Inventory semantic, and the
> Wave 6/7 freeze baseline. It introduces no new SC / Invariant / UAT / Race / Audit Capability
> identifier; the SC 114 / Invariant 20 / UAT 44 / Race 24 / Audit CAP 36 counts are unchanged.
> It authorizes **no** source, migration, test, frontend, configuration or database change and no Git
> operation. Final Acceptance and Freeze remain unauthorized.

### R0. Provenance and coverage of the three items

| Item | Coverage before this amendment | Evidence |
|---|---|---|
| R1 Commercial Credit Note reversal | `MISSING` | `commercial_credit_notes.status` already admits `REVERSED` (`server/migrations/v13-phase6e-commercial-golive.js:114`) but the only writer is `createCommercialCreditNote`, which hard-codes `POSTED` (`server/modules/commercial-golive.js:366`); the only credit route is `POST /api/commercial-credit-notes` (`server/modules/commercial-golive.js:568`); `reverseCreditAdjustment` exists but is never invoked with `sourceType='SALES_CREDIT_NOTE'`. |
| R2 A3 Invoice lock order | `SEMANTIC_MISMATCH` | §35.18.11.5 specifies SO line → Fulfillment → FINAL AR → Invoice/Link. `postSalesInvoice` locks no SO-line stage, `recordInvoiceLinks` reads the link before the fulfillment and FINAL AR locks (`server/modules/finance-recognition.js:97` before `:106`/`:107`), and `voidPostedInvoice` performs no source-stage locking at all. |
| R3 MySQL `lot_code_key` collation | `SEMANTIC_MISMATCH` | §35.18.2 requires binary collation on byte-identity keys and SQLite declares `lot_code_key TEXT COLLATE BINARY` (`server/migrations/sales-customer-wave8-service-consignment.js:93`). MySQL realizes it as `utf8mb4_0900_ai_ci`, recorded in `WAVE8_KNOWN_MYSQL_PARITY_GAPS`. |

### R1. Commercial Credit Note Reversal contract

#### R1.1 Scope and carrier reuse

R1 is **entirely implementable on existing carriers. No new business table and no shadow Finance engine
is authorized.** The business document remains `commercial_credit_notes`; the monetary primitive remains
`financial_credit_adjustments` + `settlement_unapplied_balances` + `credit_reversal_components`; the
invoice-side capacity remains `sales_invoices.credited_amount_cents` / `remaining_creditable_amount_cents`
(`server/migrations/v22-finance-wave-c-invoice.js:50-51`); the accounting effect remains the canonical
system-voucher reversal; the audit trail remains `audit_logs`; the retry guard remains `idempotency_records`.
The existing `reverseCreditAdjustment()` (`server/modules/settlement-core.js:165`) is the **only** authorized
monetary reversal primitive.

#### R1.2 State machine

`POSTED → REVERSED` is the only legal transition, and it is terminal.

- `DRAFT` credit notes may not be reversed through this entry point; a draft is cancelled by its own path.
- `REVERSED` is final. No re-post, no re-open, no second reversal.
- Partial reversal is **forbidden**. A reversal always reverses the full posted credit amount.
- Amounts on an existing credit note are immutable in both directions. A reversal never edits `net_cents`,
  `tax_cents`, `gross_cents`, `tax_snapshot_json`, `adjustment_type`, `source_type`, `source_id` or `party_id`.
- Any state outside `POSTED` fails closed with `COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE`.

#### R1.3 Downstream dependency failure-closed

A credit whose monetary footprint can no longer be safely undone must fail closed with
`COMMERCIAL_CREDIT_REVERSAL_BLOCKED` and a machine-readable `reason`. The following are blocking:

1. the derived `CREDIT` settlement balance has any confirmed balance application or confirmed financial refund;
2. any linked `credit_reversal_components` row shows applied or unapplied cents already consumed by a
   downstream return reversal;
3. the target open item has consumed, cash-allocated or written-off amount that the reversal would drive negative;
4. the accounting period covering the credit date is closed, or the period covering the reversal date is closed.

No "reverse anyway", no compensating entry and no best-effort success is legal. The caller must first
reverse the dependent settlement, refund or return reversal through its own canonical path.

#### R1.4 Capacity, history and immutability semantics

On a successful reversal, in the same transaction:

- every `financial_credit_adjustments` row of that credit moves `CONFIRMED → REVERSED` with
  `reversed_cents = amount_cents`, and the derived `CREDIT` balance moves to `REVERSED`;
- the canonical system voucher created by the credit is reversed by the existing voucher reversal, never by
  a hand-written balancing entry;
- the source invoice `credited_amount_cents` is reduced by exactly the reversed gross, and
  `remaining_creditable_amount_cents` is recomputed as `gross_cents − credited_amount_cents`;
- `remaining_creditable_amount_cents` may never be driven below zero;
- the invoice's historical `finance_invoice_source_links` rows are **not** deleted and **not** modified.
  They stop counting only through the credit-status predicate. A reversed credit therefore **frees invoice
  creditable capacity but does not release the invoicing capacity** that a Service Fulfillment source already
  consumed under §35.18.12;
- the reversal is recorded in `audit_logs` with entity type `COMMERCIAL_CREDIT_NOTE`, action `REVERSE`, the
  actor, the reversal date and the reason.

A no-op reversal of an already-reversed credit is legal only through the idempotent replay path below; it
must never be reported as a fresh business reversal.

#### R1.5 API, permission and request contract

- Route: `POST /api/commercial-credit-notes/:id/reverse`.
- Body: `reversalDate` (required, `YYYY-MM-DD`, must be on or after `credit_date`) and `reason`
  (required, non-empty).
- Permission: `FINANCE_INVOICE_MANAGE`, identical to credit creation. **No new permission is introduced.**
- Idempotency: a header `Idempotency-Key` is **mandatory**, scoped to `COMMERCIAL_CREDIT_REVERSAL` and the
  credit note id. An exact replay returns the original result with `replayed: true`. The same key with a
  different reversal date or reason is rejected with `COMMERCIAL_CREDIT_REVERSAL_IDEMPOTENCY_CONFLICT`.
- A repeated reversal carrying a **new** idempotency key against an already-reversed note fails closed with
  `COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE`; it must not silently succeed.

#### R1.6 Lock order and atomicity

The reversal composes with the frozen Finance writers and must not create a reverse edge against the C1
PREPAYMENT parent-first chain of §35.18.6:

```text
0. unlocked identity discovery only (read the credit note, its derived adjustments and balance ids)
1. target FINAL AR / AP open item rows by id ASC
2. the credit's financial_credit_adjustments rows, then the derived CREDIT settlement balance, by id ASC
3. the commercial_credit_notes row, then the source invoice / bill row, by id ASC
4. the accounting voucher reversal, then idempotency result and audit
```

All of it executes inside one caller-owned transaction. A failure at any step rolls back the credit state,
the adjustment reversal, the balance reversal, the voucher reversal, the invoice recomputation, the
idempotency record and the audit together. There is no durable failed-attempt audit promise.

#### R1.7 Period and business-date rules

The reversal is a Finance operation dated by `reversalDate`. Both the credit's `credit_date` and the
`reversalDate` must fall in open accounting periods. Reversing into a period earlier than `credit_date` is
refused.

### R2. A3 Invoice lock order contract

#### R2.1 Target order

Invoice POST, VOID and Credit on Service-bearing invoices must take their locks in the §35.18.11.5
composable order, with no reverse edge against C1 or any frozen Finance path:

```text
0. unlocked identity discovery only — invoice id, its SO item ids, candidate CONFIRMED fulfillment ids,
   FINAL AR open item ids, existing link identities
1. SO line rows by id ASC
2. CONFIRMED service fulfillment rows by id ASC
3. FINAL AR open item rows by id ASC
4. invoice header row, then finance_invoice_source_links read and write
```

Non-Service invoices keep their existing behavior unchanged; the SO-line and Fulfillment stages are simply
empty for them and must not introduce a lock where none is needed.

#### R2.2 Re-read and retry

After stage 4 the authority is re-read beneath its own locks and the existing five-tuple replay contract and
capacity equalities of §35.18.11.3 / §35.18.12 are enforced unchanged. If a candidate set discovered at
stage 0 grew, the invoice is refused with a retryable `A3_INVOICE_SOURCE_PLAN_STALE` and the caller rolls
back and retries from discovery. A newly inserted candidate may only **increase** capacity-consumption
opportunity; omission is conservative and must never justify an over-allocation.

A retry must never acquire an additional Finance parent after a Sales lock, and must never add a link or a
source lock that was not in the discovered candidate set.

#### R2.3 VOID and Credit

- VOID must lock the same stages as POST before reversing anything, so a concurrent POST cannot interleave
  between source locking and voucher reversal. VOID leaves historical `finance_invoice_source_links` rows in
  place and immutable.
- Credit must lock the same stages, then apply the §35.18.12 multi-source allocation rules unchanged.
- R1 Credit reversal composes after R2: it locks the credit's own adjustments and balance, never re-entering
  the SO-line or Fulfillment stages, so it cannot invert the POST order.

#### R2.4 Prohibited shortcuts

The following are forbidden and must not be used to satisfy R2: relying on the MySQL adapter's global
transaction gate as the correctness proof; reordering only one local `FOR UPDATE` without auditing its
callers; introducing a shadow lock table; weakening the §35.18.11.3 replay or §35.18.12 conservation checks;
or treating an unlocked capacity `SUM` as if it were locked.

### R3. MySQL `lot_code_key` binary collation contract

#### R3.1 Identity semantics unchanged

R3 changes **only** the MySQL comparison semantics of the existing LOT canonical identity key. It does not
change LOT business meaning, does not introduce a new LOT code model, does not change `inventory_lots`,
`tracked_source_allocations` or any V21 position key, and does not create a fifth Wave 8 table. SQLite keeps
`COLLATE BINARY`; MySQL must reach binary parity.

#### R3.2 Target state

`consignment_commercial_lines.lot_code_key` is `VARCHAR(128) NOT NULL DEFAULT ''` with
`CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin` on MySQL, matching the approved byte-identity rule of
§35.18.2.

Two effective generation points must both be corrected, because the table is materialized by the shared
MySQL snapshot reconciliation **before** the Wave 8 migration runs:

1. the column generator, so a fresh MySQL database is created directly at the binary collation;
2. an additive, idempotent upgrade step, so an existing MySQL database is corrected without a rebuild.

#### R3.3 Pre-change safety

Before any collation change the upgrade must prove the existing data is safe to compare byte-exactly:

- the number of `lot_code_key` values that are equal under the case/accent-insensitive collation but
  **different** under binary comparison must be zero for every identity group participating in
  `uq_consignment_lines_identity`;
- otherwise the upgrade must fail closed with `WAVE8_LOT_KEY_COLLATION_AMBIGUOUS` and report the offending
  identity groups.

No automatic merge, coalesce, delete, rewrite, case-folding or LOT re-identification is permitted under any
condition. Ambiguity is an operator decision.

#### R3.4 Convergence and compatibility

- Fresh install, existing-database upgrade and repeated startup must all converge to the same binary
  collation without data repair and without destructive DDL.
- The Wave 8 MySQL physical-contract assertion must compare `lot_code_key`'s real collation, and
  `WAVE8_KNOWN_MYSQL_PARITY_GAPS` must no longer list R3 once the correction lands.
- All existing consignment LOT behavior — `chk_consignment_line_lot` pairing, FIFO entitlement, SERIAL exact
  identity, immutable handoff evidence — must be unchanged.

#### R3.5 Acceptance obligations

Fresh, upgrade and repeated migration on both backends; a metadata assertion proving the binary collation; an
ambiguity-detection test proving fail-closed; and SQLite/MySQL parity tests proving identical LOT identity
resolution for case-differing inputs.

### R4. Wave 8 Mobile workflow — remaining Stage D items (no new Requirement)

Mobile Workflow remains under the existing Stage D authorization; R1–R3 add nothing to it. The outstanding
implementation-only items, to be delivered in Stage D and not re-specified here, are:

1. remove the remaining raw id/JSON `window.prompt` inputs;
2. implement real business forms and selectors for warehouse, bin, position, LOT and SERIAL;
3. complete success, failure, permission-denied and business-conflict states for Service and Consignment;
4. execute the real-browser business-flow acceptance at 320 / 390 / 430 / 680 CSS px.

Route-width and mount checks must continue to be reported separately from real workflow acceptance.

### R5. Authorization boundary of this amendment

This amendment authorizes documentation only. No source, migration, test, frontend or configuration change,
no database operation, no test or build execution, and no Git operation is authorized by this Record.
Stage D is **not** resumed by this Record. `AGENTS.md §4.2` requires an explicit user confirmation after the
Requirement stage and before any Design stage.

---

## Wave 8 Final Closure — SALES Warehouse/Bin Reference Access Requirement Amendment (2026-10-21)

> This is a bounded **Requirement-only** amendment created after the final-closure audit proved that the
> current warehouse and bin master APIs cannot safely satisfy the Consignment workflow for a normal SALES
> actor. It preserves all approved Wave 8 business, Finance, Inventory, V21 evidence, schema and R1–R4
> contracts. It introduces no new SC / Invariant / UAT / Race / Audit Capability identifier and does not
> change the canonical counts. Design and Implementation remain stopped pending the governance gates below.

### A. Verified gap and coverage

The current implementation does not provide a legitimate SALES reference-data path:

- `GET /api/warehouses` is guarded by `WAREHOUSES_VIEW OR WAREHOUSES_MANAGE` and returns the warehouse
  master payload, including `address`, `manager`, `createdAt` and `updatedAt`. The standard SALES role has
  neither warehouse permission and receives 403.
- `GET /api/warehouse-bins` is guarded by `WAREHOUSE_BIN_VIEW OR WAREHOUSE_BIN_MANAGE`, returns bin-master
  lifecycle data, and is likewise unavailable to the standard SALES role.
- The current Wave 8 page catches the warehouse 403 and leaves the selector empty. That is graceful
  rendering, not a Handoff/Return business-flow closure. Handoff still accepts a raw optional bin id and
  Return still accepts a raw destination bin id, so the approved selector requirement is not fulfilled.

Coverage is therefore `MISSING` for a narrow, business-context-bound SALES warehouse/bin reference read.
Granting `WAREHOUSES_VIEW`, `WAREHOUSES_MANAGE`, `WAREHOUSE_BIN_VIEW` or `WAREHOUSE_BIN_MANAGE` to SALES is
not an acceptable remedy because those capabilities belong to Inventory/Warehouse master-data ownership.

### B. Approved business access contract

A user may read warehouse/bin candidates for Wave 8 Consignment only when the user already has the
applicable legitimate Consignment access. Read access is operational reference access, not warehouse
master access and not inventory visibility.

1. The read path must require the narrow Consignment permission appropriate to the operation. A user with
   no Consignment access receives 403; authentication failure retains the platform's existing behavior.
2. The read path must be bound to an accessible Consignment business context rather than expose an
   unrestricted warehouse directory. The server must re-check the document/line scope and Sales Group
   authority before returning candidates.
3. Handoff source candidates are restricted to the document's immutable source warehouse; if that
   warehouse uses bins, only active bins belonging to that warehouse may be returned.
4. Return destination candidates include only active, legally selectable enterprise warehouses and, after
   a warehouse is selected, only active bins belonging to it. The exact allowed-destination scope rule is
   reserved for Stage C, but it must fail closed and may not be inferred solely by the client.
5. Inactive warehouses/bins are never offered as candidates. A mutation must revalidate active state,
   parent-child membership, bin-enabled rules and business scope inside its transaction; a prior reference
   response is never mutation authority.
6. Settlement does not choose a warehouse/bin. It continues to resolve immutable historical Handoff
   evidence and re-lock the current V21 position under the existing contract.

### C. Minimum disclosure and ownership

The response may disclose only the stable fields required to label and submit a choice:

- warehouse: `id`, `code`, `name`, and the minimum bin-enabled indicator needed to drive the selector;
- bin: `id`, `warehouseId`, `code`, `name`.

It must not disclose warehouse address, manager, audit timestamps, inventory quantity, valuation, cost,
LOT/SERIAL balances, stock-status administration, owner-dimension administration or warehouse configuration.
It must not provide create/update/deactivate/delete behavior.

Inventory/Warehouse remains the owner of warehouse/bin master data and V21 Position validation. Sales owns
only the contextual read orchestration and its Consignment business scope. No warehouse-management
permission is granted to SALES, no inventory canonical writer changes ownership, and no shadow inventory or
fifth Wave 8 business table is introduced.

### D. Compatibility and security constraints

- Prefer a safe existing reference primitive only if Stage C proves it has the exact narrow response and
  context-bound authorization above. Otherwise Stage C must specify one minimal read-only endpoint family.
- Existing `/api/warehouses` and `/api/warehouse-bins` management/read contracts and their Inventory role
  permissions remain unchanged; this amendment does not broaden them and does not change the global role
  seed by granting warehouse permissions to SALES.
- The reference path is read-only and requires no schema or migration change. SQLite/MySQL must return the
  same candidate semantics and field shape.
- Direct endpoint access without the required Consignment permission or outside the actor's Sales Group
  scope fails with 403 and returns no candidate data. Unknown, inaccessible or mismatched context fails
  closed without revealing whether the foreign record exists.
- Existing V21 mutation, evidence, idempotency, atomicity, ownership, tracking and valuation contracts remain
  authoritative. Client-submitted ids are untrusted and are revalidated by the mutation path.

### E. Workflow and acceptance obligations

After separately approved Design and Implementation, acceptance must prove with real HTTP requests and a
real standard SALES account that:

1. Handoff can select its permitted source warehouse and, where applicable, an active source bin and then
   complete without a warehouse-master permission grant.
2. Settlement completes from historical Handoff evidence without current-location inference or a location
   selector.
3. Return can select a permitted active destination warehouse/bin and complete at 320 / 390 / 430 / 680
   CSS px without raw warehouse/bin id entry.
4. A user lacking the applicable Consignment permission receives 403 from the new/narrow read path, and the
   SALES user continues to receive 403 from warehouse/bin management operations.
5. Stale, inactive, cross-warehouse, cross-scope and foreign-document candidate submissions fail closed with
   zero inventory, commercial, Finance, evidence, audit and idempotency side effects.

The R1 idempotency HTTP check, R2 call-chain/lock-order audit, independent-connection MySQL reversal races,
full regression, protected MySQL gates and browser workflow remain required by the user's final-closure
authorization. They are not executed in this Requirement stage.

### F. Stage C decisions required

Stage C must decide and document, without changing this business contract:

1. reuse versus a dedicated contextual endpoint, exact route(s), parameters and response schema;
2. the precise permission OR/AND expression for Handoff and Return reference reads;
3. how document/line Sales Group scope is loaded and how not-found versus forbidden is normalized;
4. the permitted Return destination scope and whether warehouse and bin lookup is one response or two;
5. active/bin-enabled filtering, stable ordering, empty-result behavior and stale-selection revalidation;
6. frontend loading/empty/error/403 behavior and removal of the remaining raw bin-id inputs;
7. focused authorization, disclosure, scope, SQLite/MySQL parity and real-browser tests.

### G. Preservation and resume gate

All existing dirty-worktree changes, completed R1–R4 implementation, untracked SQLite/WAL/SHM artifacts and
`APPLY_GUIDE.md` are preserved. This amendment neither accepts nor reverts any implementation and does not
declare Final Acceptance or Freeze.

Per `AGENTS.md §4.2`, the next step requires explicit user acceptance of this Requirement amendment. Only
then may a separately authorized Stage C append the bounded technical design to `solution.md`. Source,
migration, test, frontend, database and build work remains stopped until that Design is accepted and Stage D
is explicitly resumed for this amendment.

**Status: `WAVE8_SALES_REFERENCE_REQUIREMENT_DELIVERED — AWAITING_USER_ACCEPTANCE`. Hard Stop.**

---

## Wave 8 Final Acceptance and Freeze Record (2026-10-21)

### 1. Acceptance decision

The user reviewed and explicitly accepted the final targeted independent re-audit result
`WAVE8_FINAL_TARGETED_REAUDIT_PASS`, then declared `WAVE8_FINAL_ACCEPTANCE_PASS`. Wave 8 is therefore
accepted and frozen at the approved Requirement boundary recorded in this document. This record closes
Acceptance/Freeze documentation only; it does not alter any Requirement, economic fact, schema, permission,
state machine or cross-domain ownership rule.

### 2. Accepted capability coverage

The accepted Wave 8 business baseline comprises:

- Service Fulfillment creation, confirmation and cancellation, including Service-aware mixed Delivery and
  zero-physical-stock/COGS behavior for Service lines;
- Consignment commercial locations, documents and lines, instruction, Handoff, Settlement, explicit Return
  and the three-layer commercial/physical/Finance report;
- fail-closed zero-amount Settlement, SO-backed price authority, multi-position/LOT/SERIAL partition
  entitlement and immutable V21 historical-position evidence;
- Handoff restricted to the document source warehouse, and B5 explicit Return to any eligible active
  non-Supplier-WIP enterprise warehouse/bin, including a destination different from the source warehouse;
- context-bound read-only SALES warehouse/bin references with joint `SALES_MANAGE` and
  `CONSIGNMENT_MANAGE`, Sales Group scope, minimal disclosure and mutation-time authoritative revalidation;
- Service Finance DIRECT recognition, A3 invoice-source conservation, immutable invoice links, Credit Note
  reversal and the canonical `SO Line -> Fulfillment -> FINAL AR -> Invoice -> Existing Links` lock chain;
- SQLite/MySQL additive migration compatibility, four Wave 8 business tables, the approved nine-field
  nullable `inventory_mutation_log` evidence carrier, and binary MySQL `lot_code_key` identity.

### 3. Final acceptance evidence

The accepted final evidence set contains Wave 8 focused 64/64, fast 380/380, full 2626/2626, heavy 67/67,
Vite build PASS, MySQL integration 56/56, MySQL concurrency 102/102 including Wave 8 15/15, and real Edge
acceptance with 36 responsive checks plus 16 workflows at 320/390/430/680 CSS px. The final targeted
independent re-audit additionally re-ran the P1-focused pair at 20/20 and the five-file Wave 8 gate at
64/64. It independently confirmed the A3 lock chain and both Reference API HTTP negative matrices and found
no remaining P0/P1.

The broader fast/full/heavy/build/MySQL/browser figures were not re-run during the targeted re-audit; they
remain the actual completed Stage D gate results recorded on the same date, not newly generated audit runs.

### 4. Frozen boundary

The frozen scope is Wave 8 only: the approved Service Fulfillment, Consignment, V21 evidence extension,
Finance A3/Credit Reversal, B5 destination, SALES reference-access, migration and acceptance contracts.
Future changes inside this boundary require a new audited Requirement and Design approval before
implementation. Historical evidence must not be guessed or rewritten, inventory and Finance canonical
writer ownership remains unchanged, and no fifth Wave 8 business table or shadow inventory/AR is permitted.

This freeze does not freeze the ERP project as a whole, does not accept or authorize Wave 9–13, and does not
constitute a Git commit, release, deployment, tag, production migration or package-version change.

**Status: `WAVE8_FINAL_ACCEPTANCE_PASS — FREEZE_DOCUMENTED_PENDING_COMMIT`.**

---

## Stage B Requirement Applicability Closure — Sales Credit Waves 9–11 (2026-10-22)

### 1. Authorization, scope and frozen protection

This is an additive Requirement applicability closure for the combined Sales Credit scope (Wave 9 + Wave 10 + Wave 11), performed under authorization `STAGE_A_AUDIT_PASS — STAGE_B_REQUIREMENT_ONLY_AUTHORIZED`.

It records only Requirement-level applicability and clarification. It does **not** approve any physical schema, key, constraint, migration shape, transaction boundary or implementation approach, and it does **not** authorize Stage C Design or Stage D Implementation. `solution.md` remains read-only in this stage.

Scope:

```text
Wave 9   SC83..SC89         (7 capabilities)
Wave 10  SC82 + SC90..SC98  (10 capabilities)
Wave 11  SC99..SC107        (9 capabilities)
Total    26 capabilities     (B3103 Credit Management)
```

The following remain frozen and unchanged by this record: all Wave 1–8 contracts; the Wave 8 freeze; every historical Requirement, Design and acceptance record; and all identifier namespaces and counts —

```text
SC total        = 114   (unchanged)
Invariant total = 20    (unchanged; S01..S20)
UAT total       = 44    (unchanged; UAT-S-01..UAT-S-44)
Race total      = 24    (unchanged; R-SAL-01..R-SAL-24)
Audit CAP total = 36    (unchanged)
```

No SC, Invariant, UAT, Race or CAP identifier is added, deleted or renumbered by this record.

Decision classifications used here:

| Classification | Meaning |
|---|---|
| `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` | Existing frozen Requirement already determines the behavior; this record only confirms or disambiguates it. No new business approval is requested. |
| `BOUNDED_CLARIFICATION_ONLY` | The underlying intent is frozen; this record makes an implicit distinction explicit without adding business policy. |
| `REQUIREMENT_DECISION_PENDING` | A genuinely new business decision is required and is **not** answered by this record. Stage C and Implementation are blocked on it until the user decides. |
| `LEGACY_DATA_EVIDENCE_PENDING` | Depends on read-only evidence from an external environment that does not yet exist and has not been authorized. No compatibility claim is made. |

### 2. Baseline verification

Verified read-only before this record was written:

```text
branch  = feature/sales-waves6-13
HEAD    = fb8d3a417882956ccab882a87e2066a140e4d9c4
version = 1.6.2
remote  = github.com/quanyantan-svg/modern-erp
tracked working-tree changes = 0
untracked artifacts = 602, all SQLite / WAL / SHM test artifacts
APPLY_GUIDE.md = present, untouched
```

No baseline difference was found. No branch, commit, tag, push, merge or history operation was performed.

### 3. B-1 — Optional salesperson dimension in Credit Profile

**Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` (confirmed) + `BOUNDED_CLARIFICATION_ONLY` (four-way distinction).**

Frozen text confirmed unchanged — §34.3.20 SC87:

```text
SC87 Credit Profile (credit object + customer + optional salesperson dimension
     where valid)                                                                  [DOMAIN_OWNED]
```

§34.1.1 and §34.8 row 11 confirm Customer identity foundation stays with Master & Engineering and Sales only extends it; no second Customer identity is permitted.

The frozen Requirement already establishes the optional salesperson dimension. This Stage B record makes the four constituent concepts explicit so that no later stage may conflate them:

| Concept | Requirement meaning | Frozen anchor |
|---|---|---|
| **Credit Object identity** | The commercial subject the credit profile governs | SC87 "credit object" |
| **Customer-level Credit Profile** | A profile whose scope is the customer as a whole, with no salesperson dimension | SC87 (customer component; salesperson optional) |
| **Salesperson-specific Credit Profile** | A profile that additionally applies to one salesperson **where valid** | SC87 (explicit "optional salesperson dimension where valid") |
| **Effective-dated Profile version** | A dated version of one of the above, governed by effective dates | SC88 "Credit Profile Effective Dates + Overdue-Day Policy"; S19 |

Explicit constraint adopted from this Stage B record: **the optional salesperson dimension must not be eliminated merely to simplify a database primary key, a UNIQUE constraint or any other physical identity.** SC87 remains the governing Requirement text. If any later stage cannot express both the customer-level and salesperson-specific scope in physical form, that is a physical-design failure to be solved in Stage C — it is **not** grounds to narrow SC87.

**No surrogate primary key, normalized scope key, UNIQUE, CHECK or FK decision is made here.** Those remain Stage C responsibilities and are carried forward in §10.

The precedence question raised by having both scopes is a separate matter and is recorded as `REQUIREMENT_DECISION_PENDING` in §9.

### 4. B-2 — R-SAL-24 business meaning

**Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` (confirmed).**

`DORMANT` in §34.6 is an implementation / coverage status. This is confirmed by the frozen text itself, not by inference: the §34.6 Race Coverage Snapshot states

```text
R-SAL-01..R-SAL-15  → 5 REAL covered today + 10 DORMANT pending capability implementation
```

so `DORMANT` means **pending capability implementation**. It does not mean the race can never be implemented, and it is not a prohibition on scheduling.

The business invariant remains exactly as frozen in §34.6.2:

```text
one credit decision → one coherent effective policy version
```

Valid serialization outcome A: the Credit Check logically precedes the policy mutation and uses the complete OLD effective snapshot.
Valid serialization outcome B: the policy mutation logically precedes the Credit Check and uses the complete NEW effective snapshot.
Forbidden: one Credit Check combining old credit limit + new rule + old overdue policy + new rating/profile state, or any other mixed-version decision.

R-SAL-12 and R-SAL-24 remain distinct and non-subsumable, per §34.6.1 and the explicit prohibition in §34.11 E: *"不允许 subsume R-SAL-24 进入 R-SAL-12"*. R-SAL-12 protects exposure / capacity consumption; R-SAL-24 protects coherent effective policy / profile snapshot consistency. §34.6.1 additionally fixes R-SAL-24's canonical lock identity as **effective policy / profile / limit / rule / overdue / rating-result version identity** — a version identity, which this record does not weaken.

Confirmed constraint: **full R-SAL-24 verification must not be claimed in Wave 9.** R-SAL-24 is defined as a mutation-versus-Credit-Check race, and real Credit Check runtime is planned for Wave 10. Wave 9 may only establish the anchor and lock-order infrastructure that R-SAL-24 depends on. The reconciliation of infrastructure-level versus end-to-end verification timing is a Stage C responsibility and is carried forward in §10.

### 5. B-3 — Legacy Credit Profile compatibility

**Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` (compatibility rules) + `LEGACY_DATA_EVIDENCE_PENDING` (applicability).**

Current evidence does **not** establish whether historical `credit_profile` rows exist in any external target database. Repository inspection confirms no such table exists in this repository: the only occurrences of `credit_profile` outside `solution.md` are negative assertions in `server/sales-customer-wave0-migration-runner.test.js`, `server/mysql-sales-customer-wave0.integration.js` and `server/mysql-sales-customer-wave1-upgrade.integration.js`, all of which assert that the table must **not** yet exist.

Applicability therefore remains **`LEGACY_DATA_EVIDENCE_PENDING`** and no compatibility claim is made in either direction. The legacy bootstrap remains conditional upon a separately authorized, read-only environment inventory.

The Requirement-level compatibility behavior is fixed as follows, applying to any Credit legacy path:

```text
1. Preserve authoritative historical data.
2. Do not invent missing Credit Profile records.
3. Do not fabricate historical credit limits or ratings.
4. Do not silently resolve ambiguous identity.
5. Reject unsafe or nondeterministic migration.
6. Do not claim historical compatibility without evidence.
```

These behaviors are grounded in already-frozen Requirement and governance text and are not new policy: S05 (approved historical execution cannot be silently rewritten), `AGENTS.md` §6 (unknown historical facts must not be fabricated), and `AGENTS.md` §15 (legacy tables must not be dropped in ordinary cleanup).

Explicit constraint: **legacy bootstrap is conditional.** Until the read-only inventory is separately authorized and produces evidence, no stage may assume that a legacy Credit Profile table exists, that it is empty, or that it is compatible.

No database was opened, queried or modified during this Stage B closure.

### 6. B-4 — Rating result and Profile version identity

**Classification: `ALREADY_GOVERNED_BY_FROZEN_CONTRACT` (traceability principle) + `BOUNDED_CLARIFICATION_ONLY` (five-identity distinction).**

The governing principle is already frozen: S05 (approved historical execution cannot be silently rewritten) and §34.6.2's race-corollary invariant (where a Credit Check returns a special-approval outcome, the exception request must trace to the exact Credit Check and policy snapshot that produced it, and a later policy mutation must not silently reinterpret an already approved exception). SC107 (Credit Rating Result Application → Credit Profile) and UAT-S-36 ("result → Credit Profile") place rating application on the Credit Profile.

This record makes the five business identities explicit and states that they must not be collapsed:

| Identity | Business responsibility | Must remain distinct from |
|---|---|---|
| **Stable Credit Object / locking identity** | The long-lived credit-control scope and serialization identity | the effective profile version and the evidence snapshot |
| **Effective Credit Profile version** | The effective-dated limit, status, rating and overdue state that applied on a business date | the stable anchor and the decision evidence |
| **Immutable policy snapshot evidence** | The coherent, append-only evidence of the policy state used by one decision | the lock identity |
| **Credit Evaluation result** | The evaluation outcome produced by a scoring sheet and scheme | the profile version it was applied to |
| **Applied rating history** | The dated record that a rating was applied to a specific profile version | the evaluation result that produced it |

Explicit constraint: **historical evidence must remain traceable after a later profile or rating mutation, and these business identities must not be collapsed into a single physical ID merely for implementation convenience.** Any later stage that maps more than one of these identities onto one physical identifier must demonstrate that historical traceability is preserved, or return to Requirement.

### 7. Stage B 26-SC Requirement coverage matrix

All 26 capabilities are mapped to their frozen Requirement text, business invariant, acceptance reference and Stage C carry-forward dependency. Capability status is unchanged by this record.

| Wave | SC | Frozen Requirement anchor | Invariant | Acceptance | Stage C carry-forward |
|---|---|---|---|---|---|
| 9 | SC83 | §34.3.18 Credit Management Enabled/Disabled + Scope | S15 | UAT-S-30 | #10 snapshot identity; #13 race timing |
| 9 | SC84 | §34.3.18 Credit Control Timing + Control Strength | S15 | UAT-S-30 | #5 parameter version uniqueness |
| 9 | SC85 | §34.3.19 Credit Check Rule Model | S15 | UAT-S-30 | #4 rule key; #13 race timing |
| 9 | SC86 | §34.3.19 Credit Rule Result Types (WARNING/BLOCK) | S15 | UAT-S-30 | #4 rule key |
| 9 | SC87 | §34.3.20 Credit Profile (optional salesperson) | S15 | UAT-S-29 | #1, #2, #3, #9, #15 |
| 9 | SC88 | §34.3.20 Effective Dates + Overdue-Day Policy | S19 | UAT-S-29 | #3 overlap / active resolution; #12 rating owner |
| 9 | SC89 | §34.3.20 Initial State + Rating + Applicable Rule + Status | S15 | UAT-S-29 | #12 rating canonical write owner |
| 10 | SC82 | §34.3.17 Credit Exposure Canonical-Fact Invariant | S14 | §34.8 row 12 | #10 |
| 10 | SC90 | §34.3.21 Exposure Component Composition | S14 | UAT-S-31 | — |
| 10 | SC91 | §34.3.21 Exposure Transition Rules | S14 | UAT-S-31 | #13 race timing |
| 10 | SC92 | §34.3.21 Used / Available / Over-Limit Calculation | S14, S15 | UAT-S-31 | #13 capacity preconditions |
| 10 | SC93 | §34.3.22 Credit Check Stage: SO Submit | S15 | UAT-S-32, R-SAL-12 | #9 provisioning boundary |
| 10 | SC94 | §34.3.22 Credit Check Stage: SO Approve + SD Confirm | S15 | UAT-S-32 | #9 |
| 10 | SC95 | §34.3.22 Mandatory BLOCK + Audit | S15 | UAT-S-32 | #9 |
| 10 | SC96 | §34.3.23 Special Approval Request | S16 | UAT-S-33, R-SAL-13 | #9, #10 |
| 10 | SC97 | §34.3.23 Special Approval Decision (bounded authority) | S16 | UAT-S-33, R-SAL-13 | #9 |
| 10 | SC98 | §34.3.23 Special Approval Audit + Linkage | S16 | UAT-S-33, §34.6.2 corollary | #10, #11 |
| 11 | SC99 | §34.3.24 CHECK-only Reconciliation | S17 | UAT-S-34 | — |
| 11 | SC100 | §34.3.24 Deterministic Recalculation | S17 | UAT-S-34, R-SAL-23 | — |
| 11 | SC101 | §34.3.25 Credit Query | — | UAT-S-35 | — |
| 11 | SC102 | §34.3.25 Credit Exception History | S05 | UAT-S-35 | #10 |
| 11 | SC103 | §34.3.26 Credit Indicator | — | UAT-S-36 | — |
| 11 | SC104 | §34.3.26 Credit Rating Scheme | — | UAT-S-36 | — |
| 11 | SC105 | §34.3.26 Model + Indicator Weight + Scoring Sheet | — | UAT-S-36 | #7 |
| 11 | SC106 | §34.3.26 Bounded Multi-Scorer | — | UAT-S-36 | — |
| 11 | SC107 | §34.3.26 Rating Result Application → Credit Profile | S05, S19 | UAT-S-36, R-SAL-24 | #6, #7, #8, #12 |

Sum check: 7 + 10 + 9 = **26** ✓

Cross-cutting Requirement anchors confirmed unchanged and applicable to all 26:

```text
Permissions / SOD   SC111 (Credit View/Manage/Evaluate/Special Approve)
                    SC114 + §34.7 P4 (CREDIT SPECIAL APPROVAL needs bounded authority,
                                       separate from standard approval)
                    UAT-S-44 final permission proof
Finance boundary    §34.8 rows 12/13 (read-only canonical AR / advance / unapplied /
                    refund / write-off) + §34.9 I1 (One AR truth)
No second ledger     SC82 + §34.8 row 12 (不得 second Sales / Finance exposure ledger)
No history mutation  S05 + S17 + §34.8 row 15
```

### 8. Additional Requirement coverage confirmation

Verified against the frozen §34 text. Each item below is **already expressed**; this record adds no new rule for any of them.

| Required behavior | Frozen location | Status |
|---|---|---|
| SC83–SC89 Credit Parameters, Rules, Profile | §34.3.18, §34.3.19, §34.3.20; §34.8 rows 10–11 | Confirmed |
| SC82 + SC90–SC98 PURE_DERIVED Exposure, Check, Special Approval | §34.3.17, §34.3.21, §34.3.22, §34.3.23; §34.8 rows 12–14 | Confirmed |
| SC99–SC107 Reconciliation, Query, Evaluation | §34.3.24, §34.3.25, §34.3.26; §34.8 row 15 | Confirmed |
| S14–S17 | §34.4 (S14 exposure no double-count; S15 mandatory BLOCK fail-closed; S16 bounded exception; S17 recalculation no history rewrite) | Confirmed |
| R-SAL-12 / 13 / 14 / 23 / 24 | §34.6, §34.6.1, §34.6.2 | Confirmed |
| UAT-S-29–36 | §34.5 (UAT-S-29 … UAT-S-36) | Confirmed |
| SC111 / SC114 Credit authorization and SOD | §34.3.27; §34.7 P1–P5 | Confirmed |
| Finance canonical AR / settlement read-only integration | §34.8 rows 12–13; §34.9 I1 | Confirmed |
| No second Credit Exposure ledger | SC82 §34.3.17; §34.8 row 12 | Confirmed |
| No mutation of historical Sales / Finance / Accounting truth | S05, S17; §34.8 row 15 | Confirmed |

Effective-date rule check:

```text
Already expressed:
  - SC88 "Credit Profile Effective Dates + Overdue-Day Policy" names effective
    dating as a Credit Profile capability.
  - UAT-S-29 accepts "Credit Profile 创建 + 生效日期 + overdue-day policy".
  - S19 makes the business date authoritative.

NOT expressed anywhere in frozen §34:
  - a rule that one logical Credit Object cannot hold two conflicting effective
    Credit Profiles on the same business date;
  - a resolution rule for the case where a customer-level profile and a
    salesperson-specific profile both apply on the same business date;
  - any interval-overlap prohibition or deterministic tie-break.

Verified by inspection: the credit Requirement area contains zero occurrences of
precedence, priority, fallback, most-specific or tie-break language. By contrast
§34.1.1 explicitly gives Sales Pricing "effective dates；priority / fallback", so
the omission in the Credit Profile clauses is a genuine gap rather than an
intentional design choice.
```

Because a naive "one profile per customer per date" rule would contradict SC87 by eliminating the optional salesperson dimension recorded in §3, this gap must not be closed by assumption. It is recorded in §9 as `REQUIREMENT_DECISION_PENDING` and no rule is inserted here.

### 9. `REQUIREMENT_DECISION_PENDING` register

One genuinely new business decision is required. It is not answered by this record and no rule has been inserted.

```text
REQUIREMENT_DECISION_PENDING-1

Question:
  When a customer-level Credit Profile and a salesperson-specific Credit Profile
  are both effective on the same business date for the same Credit Object, which
  one governs the credit limit and status used by the Credit Check?

Why it cannot be inferred:
  - SC87 establishes that both scopes may exist; it does not order them.
  - SC88 establishes effective dating; it does not order overlapping scopes.
  - A "one profile per customer per date" reading would eliminate the optional
    salesperson dimension and contradict SC87.
  - "Most specific wins", "customer-level wins" and "aggregate / strictest wins"
    are all commercially defensible and produce materially different limits,
    approvals and audit outcomes.

Blocking effect:
  Wave 9 Implementation of SC87 / SC88 effective-date resolution is blocked on
  this decision. Stage C must not invent an ordering.

Explicitly NOT decided here:
  ordering rule; whether cross-scope overlap is forbidden or resolved by
  tie-break; whether effective-version intervals must be non-overlapping per
  scope; which profile supplies credit_limit_cents for evaluation.
```

Related but **not** an independent business decision, because it is a physical-design question rather than a policy question: whether effective-version intervals of one scope must be physically non-overlapping is Stage C carry-forward item #3. Its cross-scope case was subject to `REQUIREMENT_DECISION_PENDING-1` and is now governed by the approved decision recorded in §13.

#### 9.1 Resolution — `RESOLVED` (2026-10-22)

`REQUIREMENT_DECISION_PENDING-1` is **RESOLVED** by explicit user approval on 2026-10-22, under authorization `STAGE_A_AUDIT_PASS — STAGE_B_REQUIREMENT_ONLY_AUTHORIZED`.

Approved decision: **Customer-level Credit Limit + Salesperson-level Sub-Limit (Dual-Limit Control)**, recorded in full — policy, acceptance scenarios and boundary rules — in **§13**.

The register entry above is retained **verbatim** as the historical record that this gap existed, that it could not be inferred from frozen Requirement text, and that it was deliberately left unanswered rather than closed by assumption. It has not been erased or rewritten.

Consequences of this resolution:

```text
Blocking effect on Wave 9 SC87 / SC88 effective-date resolution : LIFTED
Stage C carry-forward items #1, #2, #3                         : unblocked at
                                                                    Requirement
                                                                    level; still
                                                                    require Stage C
                                                                    Design
                                                                    reconciliation
Blocking effect on Stage C authorization                        : UNCHANGED —
                                                                    Stage C remains
                                                                    NOT AUTHORIZED
```

No other `REQUIREMENT_DECISION_PENDING` entry exists in §34 or in this Stage B closure. `LEGACY_DATA_EVIDENCE_PENDING` (§5) is an external-evidence dependency, not an undecided Requirement, and remains open by design.

### 10. Stage C Design carry-forward register

The following 15 unresolved Design issues are preserved for Stage C reconciliation. **None is resolved by this Stage B record**, and none may be resolved by modifying `solution.md` during Stage B.

| # | Carried-forward Design issue |
|---|---|
| 1 | `credit_profile` physical primary key and candidate keys |
| 2 | Nullable salesperson normalized-scope uniqueness and bidirectional consistency |
| 3 | Effective-date interval overlap and deterministic active Profile resolution (cross-scope case subject to REQUIREMENT_DECISION_PENDING-1) |
| 4 | `credit_check_rules.id` PK / UNIQUE definition |
| 5 | `credit_parameters` column UNIQUE versus composite PK conflict |
| 6 | `credit_profile_ratings` Wave 9 → Wave 11 deferred FK |
| 7 | SQLite foreign-key creation versus pre-target DML behavior |
| 8 | MySQL FK ordering and idempotent metadata convergence |
| 9 | Stable Credit Anchor provisioning transaction boundary |
| 10 | Credit Policy Snapshot fingerprint identity and uniqueness |
| 11 | Canonical names: `credit_lock_anchors` and `credit_check_results` |
| 12 | Credit Profile rating canonical write owner |
| 13 | R-SAL-12 / R-SAL-24 infrastructure versus full business-race timing |
| 14 | Read-only legacy inventory and conditional bootstrap |
| 15 | SQLite / MySQL PK, UNIQUE, CHECK, FK and indexed-column type parity |

Additional external-review findings carried forward and explicitly bound:

- **Credit Profile normalized-scope consistency and effective-date overlap** → items #2 and #3, gated by REQUIREMENT_DECISION_PENDING-1.
- **`credit_parameters` effective-version uniqueness** → item #5. Frozen Requirement SC83 / SC84 already require configurable Credit Parameters; a column-level uniqueness that defeats effective versioning is a physical defect to reconcile in Stage C, not a new business decision.
- **SQLite FK pre-target DML compatibility** → item #7. Whether SQLite accepts an inline foreign key whose target table does not yet exist, and when such a constraint actually begins to be enforced, is a cross-dialect fact that Stage C must establish and Stage D must prove by test. It is not assumed here.

### 11. Requirement delta

Appended by this Stage B record:

```text
document.md   "Stage B Requirement Applicability Closure — Sales Credit Waves 9–11
              (2026-10-22)" sections 1–12, appended after the Wave 8 Final
              Acceptance and Freeze Record. Additive only; no existing line
              modified, removed or renumbered.
```

Not modified:

```text
§34.1  scope and ownership          unchanged
§34.2  capability catalogue         unchanged
§34.3  SC01..SC114 definitions      unchanged
§34.4  S01..S20 invariants          unchanged
§34.5  UAT-S-01..UAT-S-44           unchanged
§34.6  R-SAL-01..R-SAL-24           unchanged
§34.7  permission / RBAC / SOD      unchanged
§34.8  cross-domain boundary        unchanged
§34.9  compatibility constraints    unchanged
§34.10 out of scope                unchanged
§34.11 acceptance criteria         unchanged
§34.12 hard stop conditions        unchanged
§34.13 coverage validation trace   unchanged
all historical Stage B / Stage D / freeze records   unchanged
solution.md                        unchanged
source / migrations / tests / UI   unchanged
```

For all four mandatory decisions B-1, B-2, B-3 and B-4, the closure confirms already-frozen Requirement intent and adds no new business policy.

`REQUIREMENT_SEMANTICS_UNCHANGED`

with exactly one additive element that introduces **no** new policy: the bounded clarification of already-frozen concepts in §3, §4, §5 and §6, plus the `REQUIREMENT_DECISION_PENDING-1` register in §9, which records a gap and deliberately does not answer it.

**Superseded in part by §13.** The statement above accurately described the delta as of the initial applicability closure, in which B-1 … B-4 were confirmations only. §13 was subsequently appended after explicit user approval and **does** introduce new business policy (Dual-Limit Control), resolving `REQUIREMENT_DECISION_PENDING-1` per §9.1. The full Requirement delta for the current state of this closure is therefore recorded in §13.6 and the §13 status line, not solely in this §11 statement.

### 12. Frozen boundary

This Stage B closure is bounded to Requirement applicability for Sales Credit Waves 9–11. It does not freeze or unfreeze any Wave, does not approve Stage C Design, does not authorize Stage D Implementation, and does not constitute a commit, push, merge, tag, release, deployment, migration or package-version change.

Wave 1–8 frozen contracts remain fully in force. No historical Requirement, Design or acceptance text has been rewritten. `APPLY_GUIDE.md` and all 602 untracked SQLite / WAL / SHM artifacts were preserved untouched.

Stage C Design reconciliation and Stage D Implementation remain **NOT AUTHORIZED** and must not begin until the user explicitly confirms this Requirement closure. As originally recorded, both the `REQUIREMENT_DECISION_PENDING-1` register and the 15-item Stage C carry-forward register were open at this point.

**Status at §12: `STAGE_B_REQUIREMENT_APPLICABILITY_CLOSED — AWAITING_USER_REQUIREMENT_PASS`.**

Superseded in part by §13 and §9.1 below: `REQUIREMENT_DECISION_PENDING-1` was subsequently **RESOLVED** by explicit user approval on 2026-10-22 (§13). The 15-item Stage C carry-forward register remains fully open, and Stage C remains NOT AUTHORIZED.

---

### 13. Approved business decision — Customer-level Credit Limit + Salesperson-level Sub-Limit (Dual-Limit Control)

**Resolution target:** `REQUIREMENT_DECISION_PENDING-1` (§9), resolved per §9.1.
**Authorization:** explicit user approval, 2026-10-22, under `STAGE_A_AUDIT_PASS — STAGE_B_REQUIREMENT_ONLY_AUTHORIZED`.
**Scope:** SC87, SC88, SC90, SC91, SC92, SC93, SC94, SC95.

This is the first and only **new business policy** introduced by this Stage B closure. It adds no physical schema decision, no key definition, no constraint shape and no transaction design. It defines business semantics only.

#### 13.1 Approved policy

```text
P1  A customer-level Credit Profile defines the aggregate credit ceiling for
    the customer.

P2  A salesperson-specific Credit Profile defines an additional sub-limit for
    eligible business attributable to that salesperson.

P3  When both profiles apply, BOTH controls must pass. The salesperson-specific
    profile does not replace or increase the customer-level aggregate ceiling.

P4  When only a customer-level profile applies, use the customer-level control.

P5  When only a salesperson-specific profile applies, use that valid limit only
    if the frozen Credit Policy permits salesperson-level control without a
    mandatory customer-level profile. Otherwise fail closed.

P6  Missing required profiles, ambiguous attribution or invalid effective scope
    must never produce an implicit PASS.

P7  Customer-level exposure includes all applicable customer obligations.
    Salesperson-level exposure contains only source obligations with canonical,
    provable salesperson attribution.

P8  The same economic obligation may participate in both the customer aggregate
    check and its applicable salesperson sub-limit check, but must be counted
    only once within each exposure calculation.

P9  Existing Finance AR or settlement history must never be arbitrarily
    apportioned across salespersons.

P10 Credit decisions must use one authoritative business date and deterministic
    effective-profile resolution.

P11 Overlapping effective-date intervals for the same logical profile scope are
    invalid unless an independently approved explicit version-resolution rule
    exists.

P12 Where more than one credit scope must be enforced, the checks must form one
    logically atomic business decision. Stage C owns physical lock identities,
    acquisition order and transaction implementation.

P13 Credit Special Approval must remain bounded to the exact applicable scope,
    authority, ceiling and validity interval. It cannot silently override other
    applicable mandatory credit controls.
```

#### 13.2 Relationship to frozen Requirement

This decision resolves the gap recorded in §8 and §9 without weakening any frozen contract. It is additive to, and subordinate of, existing §34 text:

```text
S14 (exposure no double-count)      P8 scopes the rule PER SCOPE; S14 and the
                                    SC91 stage-transition rule continue to
                                    govern the STAGE dimension. Both hold
                                    simultaneously; P8 does not replace S14.
S15 (mandatory BLOCK fail closed)   reinforced by P5, P6 and P11
S16 (bounded exception)             reinforced by P13
S17 (no history rewrite)            protected by P7 and P9
S19 (business date authoritative)   reinforced by P10
§34.6.2 race corollary              reinforced by P13
§34.8 row 12 / §34.9 I1             reinforced by P9 (One AR truth)
SC87 optional salesperson           PRESERVED — P2 depends on it
SC82 PURE_DERIVED                   UNCHANGED — no second exposure ledger
SC83 / SC84 Credit Policy           P5 delegates the salesperson-only
                                    permission to Credit Policy configuration
```

#### 13.3 Business acceptance matrix

Business-level acceptance only. No physical schema, key, column or index is implied.

**Positive scenarios**

| # | Scenario | Expected business outcome |
|---|---|---|
| A1 | Customer-level profile only; aggregate exposure within ceiling | PASS under customer control |
| A2 | Customer-level + salesperson sub-limit both applicable; both within | PASS under both controls |
| A3 | Salesperson-only profile; Credit Policy permits salesperson-level control; within limit | PASS under salesperson control |
| A4 | One economic obligation subject to both controls | Counted once in the customer calculation and once in the salesperson calculation; never twice within either |
| A5 | Obligation transitions SO exposure → delivered AR exposure | Original SO exposure released/re-declared per SC91; not simultaneously counted with active AR exposure |
| A6 | Credit Special Approval granted for one applicable scope | That scope may proceed within the approved ceiling, authority and validity interval only |

**Negative scenarios**

| # | Scenario | Expected business outcome |
|---|---|---|
| N1 | Customer aggregate exceeded; salesperson sub-limit within | BLOCK on customer control |
| N2 | Salesperson sub-limit exceeded; customer aggregate within | BLOCK on salesperson control |
| N3 | Both controls exceeded | BLOCK |
| N4 | Overlapping effective-date intervals within the same logical scope | INVALID effective scope; fail closed; no implicit PASS |
| N5 | Salesperson-only profile; Credit Policy does NOT permit salesperson-level control without a mandatory customer-level profile | Fail closed; no implicit PASS |
| N6 | A required profile is missing or invalid | Fail closed per §29.22.1 and S15 |
| N7 | Salesperson attribution ambiguous or not provable | Not attributable to any salesperson scope; never recorded as salesperson-scope PASS |
| N8 | Credit Special Approval granted for the customer aggregate, salesperson sub-limit still exceeded | Sub-limit still BLOCK; approval does not leak to another scope |
| N9 | Credit Special Approval granted for a salesperson sub-limit, customer aggregate still exceeded | Aggregate still BLOCK; approval does not leak to another scope |
| N10 | Attempt to apportion Finance AR or settlement history across salespersons | PROHIBITED by P9; no such derivation may exist |

#### 13.4 Boundary — obligations without provable salesperson attribution

`REQUIREMENT_DECISION_PENDING-1` was resolved by the explicitly approved **Dual-Limit Control** policy recorded in §13.1, not by selecting among candidate orderings. One boundary consequence of that policy is recorded explicitly so that no later stage may resolve it by assumption:

```text
sales_orders.salesperson_id is a NULLABLE foreign key added in Wave 4
(server/migrations/sales-customer-wave4-orders.js). Obligations created before
Wave 4, and any obligation without provable salesperson attribution, therefore
carry no salesperson dimension.

Such obligations:
  - DO count fully in customer-level aggregate exposure (P7, first clause);
  - MUST NOT count toward any salesperson sub-limit (P7, second clause);
  - MUST NOT be recorded as salesperson-scope PASS (P6);
  - MUST NOT be apportioned from Finance AR or settlement history (P9).

This is fail-safe rather than an implicit PASS: the customer aggregate ceiling
still binds these obligations. Excluding them from the sub-limit removes a
constraint, but the aggregate ceiling remains in force, so no obligation becomes
uncontrolled.

Stage C must prove this boundary on both the fresh-install and legacy-upgrade
paths, and must not introduce any compensating inference.
```

#### 13.5 Delegated to Credit Policy configuration, not a new Requirement decision

P5 delegates the salesperson-only permission to Credit Policy configuration (SC83 / SC84), defaulting to fail closed per §29.22.1. This is a runtime configuration question and **not** a second pending Requirement decision. Stage C must make that configuration dimension explicit, but no further business policy decision is required from the user.

#### 13.6 Stage C obligations created by this decision

Stage C must demonstrate that the approved policy is implementable consistently, and must **not** assume any particular physical schema is approved:

```text
- customer aggregate and salesperson sub-limit exposure calculations that
  satisfy P7 / P8 / P9 simultaneously
- one logically atomic multi-scope Credit Check (P12) expressed in physical
  terms, with deterministic deadlock-safe anchor lock order
- the deferred Wave 9 -> Wave 11 foreign key, with SQLite / MySQL migration
  equivalence
- immutable policy snapshot identity and uniqueness that can bind a coherent
  multi-scope decision (R-SAL-24)
- independent, separate concurrency evidence for R-SAL-12 and R-SAL-24
- the §13.4 attribution boundary on fresh-install and legacy-upgrade paths
- Credit Policy configuration dimension for P5
```

Stage C authorization is still **NOT GRANTED** by this record.

**Status: `STAGE_B_REQUIREMENT_DUAL_LIMIT_DECISION_APPROVED — AWAITING_USER_REQUIREMENT_PASS`.**

---

## Stage B Requirement Amendment — Sales Credit Profile Authorization Policy (Wave 9) (2026-10-22)

**Authorization:** explicit user approval of the complete Credit Profile authorization policy, under bounded authorization `WAVE9_BOUNDED_REQUIREMENT_CLOSURE`.
**Scope:** SC83..SC89, SC111, SC114; Wave 9 Credit Profile, Credit Lock Anchor and their read/write authorization.
**Classification:** this is a **NEW approved business authorization policy**. It is **not** an existing frozen Requirement that was already fully defined, and it must not be described as prior functionality.

### 14. Resolution target — `REQUIREMENT_DECISION_PENDING-2`

#### 14.0 Historical state of the pending decision (preserved, not rewritten)

```text
RAISED    2026-10-22, log/2026-10-22.md, "Sales Credit Wave 9 — Bounded
          Data-Scope Design Review (W9-P1)"
QUESTION  Frozen Requirement does not determine Credit Profile ownership,
          visibility scope or mutation scope, and no sales-group data scope is
          implemented for Credit. Three commercially defensible policies exist:
          Credit as a central function; ownership via the customer's default
          Sales Group; or aggregate-shared / sub-limit-private.
STATUS    RAISED AND NOT ANSWERED. solution.md was deliberately not modified;
          no remediation was performed. Wave 9 remained IMPLEMENTED /
          ACCEPTANCE_PENDING.
SOURCE    log/2026-10-22.md §"Bounded Data-Scope Design Review (W9-P1)"
```

The raise record above is preserved verbatim in `log/2026-10-22.md` and is not erased or rewritten. `REQUIREMENT_DECISION_PENDING-2` was **not** written into `document.md` at raise time; it existed only in the append-only log. It is registered here so that the Requirement source of truth carries the full pending-decision history.

Verified Requirement evidence that the gap could not be closed by inference:

```text
SC06 (§34.3.1)          scopes backend group data isolation to
                        quotation / SO / report "once they carry sales_group_id";
                        credit_profile carries no sales_group_id.
UAT-S-44 (§34.5)       repeats the same scoping for Quotation / Sales Order /
                        Reports "once they carry sales_group_id".
SC111 (§34.3.27)       defines capability intent only — View / Manage /
                        Evaluate / Special Approve — with no ownership dimension.
§34.7 P1-P5            contain no group-ownership clause.
§34.8 row 11           Credit Profile boundary is "R/W: Sales extends customer /
                        不得 second Customer identity"; no access owner is named.
§13 P1-P13             govern limit semantics and fail-closed evaluation, not
                        visibility or ownership.
```

#### 14.1 Resolution — `RESOLVED` (2026-10-22)

`REQUIREMENT_DECISION_PENDING-2` is **RESOLVED** by explicit user approval on 2026-10-22, under authorization `WAVE9_BOUNDED_REQUIREMENT_CLOSURE`.

```text
Before : REQUIREMENT_DECISION_PENDING-2 = RAISED / NOT ANSWERED
         (registered in log/2026-10-22.md only; Stage C and Implementation
          blocked on it)
After  : REQUIREMENT_DECISION_PENDING-2 = APPROVED / RESOLVED
         (new business authorization policy recorded in §14.2)
```

Approved decision: **Sales Credit Central Ownership + Shared Customer Aggregate Read Access + Self-Only Salesperson Sub-Limit Visibility + Combined Credit Permission and Cross-Group Scope Enforcement.**

**Naming note.** The external review package labelled the four decisions `P1`–`P4`. They are recorded here as `AP1`–`AP4` / `AP4.1` so that they can never be confused with the already-frozen **Dual-Limit Control** series §13.1 `P1`–`P13`. Content is unchanged by this renaming.

### 14.2 Approved policy

#### AP1 — Central Credit ownership

Credit Profile is centrally owned by the **Sales Credit business domain**.

A Credit Profile is **NOT** owned by:

- a specific Sales Group;
- the customer's default Sales Group;
- the currently logged-in salesperson;
- the creator of the profile;
- the salesperson who last modified it.

Customer-level and salesperson-specific Credit Profiles remain centrally governed Credit business records.

Sales Group membership is an **authorization-context fact, not Credit Profile ownership**.

```text
Do NOT create a duplicate profile per Sales Group.
Do NOT split the existing customer aggregate credit ceiling by Sales Group.
Do NOT alter §13.1 Dual-Limit Control P1-P13.
```

#### AP2 — The customer aggregate is enterprise-shared

The Customer Aggregate Credit Limit belongs to the centrally administered customer credit object. The same customer may legitimately transact through multiple Sales Groups.

1. A customer does **not** require one authoritative Sales Group owner for Credit Profile purposes.
2. A **missing default Sales Group does not invalidate** a centrally administered Customer Aggregate Profile.
3. Multiple active Sales Group relationships do **not** create duplicate aggregate limits.
4. The customer's default Sales Group is a **commercial default, not an authorization ownership key**.
5. Existing customer and salesperson canonical identities remain authoritative.

A qualified central Credit administrator may create and manage a Customer Aggregate Profile even when the customer has no default Sales Group.

```text
Do NOT introduce synthetic ownership rows, assignment rows or surrogate owner keys.
```

#### AP3 — Salesperson sub-limit visibility is self-only

For an ordinary salesperson holding `CREDIT_VIEW`:

| Target | Result |
|---|---|
| Customer Aggregate Profile | readable |
| Own salesperson Sub-Limit Profile | readable — subject to a valid canonical salesperson identity and active applicable membership |
| Any other salesperson's Sub-Limit Profile | **not readable** |

```text
Same Sales Group membership alone does NOT confer permission to read another
salesperson's sub-limit.

Membership in multiple Sales Groups does NOT confer visibility over other
salespersons' profiles.

An unmapped, inactive or otherwise invalid salesperson identity does NOT
qualify for self-scope access.
```

Read restriction applies to **every** read surface, not only the list:

```text
- collection queries
- detail-by-ID queries
- effective-dated profile versions
- historical rating records associated with a restricted profile
- nested or expanded profile responses
- any API projection that would otherwise expose restricted sub-limit data
```

Frontend hiding is **not** a substitute for backend authorization.

Ordinary Sales Group membership must **not** be silently converted into Credit Profile administrator status.

#### AP4 — Credit permission and cross-group scope are separate and must both be enforced

```text
ADMIN
  Global Credit authorization, subject to existing audit, SOD and business
  controls. ADMIN bypass concerns ACCESS SCOPE only; it does not bypass
  business invariants or mandatory audit requirements.

SALES_CROSS_GROUP
  A DATA-SCOPE permission only. It does NOT independently grant:
    - CREDIT_VIEW
    - CREDIT_MANAGE
    - Credit Evaluation authority
    - Credit Special Approval authority
    - any additional Credit mutation authority
```

For non-ADMIN actors:

1. `CREDIT_VIEW` grants applicable Credit read capability.
2. `CREDIT_MANAGE` governs Credit management capability.
3. `SALES_CROSS_GROUP` expands the **data scope of already-authorized** Credit capabilities.
4. A user without an appropriate Credit capability remains denied even when `SALES_CROSS_GROUP` is present.
5. A user possessing `CREDIT_MANAGE` without the required central / cross-group management authorization **cannot** use that permission to raise their own sub-limit or the customer aggregate limit.

```text
Read and write permissions remain DISTINCT.

Use the existing permission registry and actor identity model.
Do NOT invent a new role or permission code.

If an existing permission explicitly implies another permission, preserve that
existing relationship. Do NOT invent an implicit relationship where the
repository does not define one.
```

#### AP4.1 — Central management write authority

Authorized Credit Profile management is restricted to:

1. **ADMIN**, or
2. a **non-ADMIN actor possessing both** the required Credit management authority **AND** `SALES_CROSS_GROUP` scope authority.

```text
Ordinary salesperson membership — including membership in the salesperson's
OWN profile scope — does NOT create Credit Profile write authority.

Consequence: an ordinary salesperson may NOT increase their own sub-limit,
even if the Sales role currently carries CREDIT_MANAGE.

The same restriction applies to customer aggregate limit modifications.

Existing business validation, effective-date rules and historical immutability
are NOT changed by this restriction.
```

### 14.3 Central configuration versus Profile authorization

Central Credit configuration is **not** Sales Group-owned merely because Sales Credit owns its business meaning. However, AP1–AP4 must not be read as granting new mutation rights over Parameters, Rules or Anchors beyond existing canonical permissions.

| # | Category | Determined by this policy, or by the existing frozen contract? |
|---|---|---|
| 1 | Global Credit Parameters | **Existing frozen contract governs** (SC83 / SC84 / §34.7). AP1 clarifies that central ownership ≠ Sales Group ownership. No new mutation right is created or removed. |
| 2 | Global Credit Check Rules | **Existing frozen contract governs** (SC85 / SC86 / §34.7). Same clarification; no new mutation right. |
| 3 | Customer Aggregate Credit Profiles | **Directly determined by this policy** — AP1 + AP2 + AP4 + AP4.1. |
| 4 | Salesperson Sub-Limit Credit Profiles | **Directly determined by this policy** — AP3 (read) + AP4.1 (write). |
| 5 | Credit Lock Anchors | **Partly determined.** AP1: an Anchor is an internal serialization identity derived from the Credit Object and is not a Sales-Group-owned record; its scope follows the centrally governed Credit Object. AP4/AP4.1 govern provisioning authority. Anchor provisioning must not become a route around Profile authorization (see N10). |
| 6 | Immutable Policy Snapshots | **Existing frozen contract governs** (S05, R-SAL-24, §34.6.2). This record creates **no** human-facing access contract for snapshots; they are internal decision evidence consumed by the Credit Check. |

Additional fixed statements:

```text
Internal Credit Check behavior in future Wave 10 is NOT a human-facing profile
read. Restricting what a person may see must NOT weaken what the engine must
evaluate.

The approved Credit Control engine must continue to evaluate ALL mandatory
customer and salesperson scopes, even where the current user is not personally
authorized to view every underlying Profile.

Frontend visibility permissions must NEVER weaken mandatory backend Credit
Checks.

The Wave 10 engine is neither built nor authorized by this record.
```

### 14.4 Authorization matrix

Read and write are separate columns by design (SC114 `VIEW != WRITE`).

| Actor / authority | Customer aggregate READ | Own sub-limit READ | Other sub-limit READ | Credit Profile WRITE |
|---|---|---|---|---|
| ADMIN | ALLOW | ALLOW | ALLOW | ALLOW (audit + business rules still apply) |
| Ordinary salesperson + `CREDIT_VIEW` | ALLOW | ALLOW **if valid own canonical identity + active applicable membership** | **DENY** | **DENY** |
| Reviewer / Accounting + `CREDIT_VIEW` | ALLOW | **DENY** | **DENY** | **DENY** |
| `CREDIT_VIEW` + `SALES_CROSS_GROUP` | ALLOW | ALLOW | ALLOW | **DENY** without management authority |
| `CREDIT_MANAGE` + `SALES_CROSS_GROUP` | per existing Credit read capability contract | per existing Credit read capability contract | per existing Credit read capability contract | **ALLOW** |
| Actor without any Credit capability | **DENY** | **DENY** | **DENY** | **DENY** |

Row constraints:

1. The matrix **must not** automatically grant every holder of `CREDIT_MANAGE` a new read permission. Where the canonical permission registry does not define that implication, Stage C must state the contract explicitly rather than leave it implicit.
2. ADMIN's bypass concerns **access scope only**. It does not bypass business validation, effective-date rules, SOD or mandatory audit.
3. An authorized Credit manager must still satisfy all existing mutation validation, audit and SOD requirements (AP4.1 preserves existing business validation unchanged).

#### 14.4.1 Existing registry / role implication rules, recorded separately

The following are **existing canonical facts** of the repository permission registry, recorded here for traceability and **not** introduced by this policy. They are separate from the new business data-scope rules of AP1–AP4.

```text
server/db.js PERMISSIONS registry defines, among others:
  SALES_CROSS_GROUP   跨销售组访问销售单据
  CREDIT_VIEW         查看信用策略与信用档案
  CREDIT_MANAGE       管理信用策略与信用档案

Seeded role grants (server/db.js seedDatabase):
  role-admin       : all permissions (includes all three above)
  role-sales       : CREDIT_VIEW, CREDIT_MANAGE
                     — does NOT hold SALES_CROSS_GROUP
  role-reviewer    : CREDIT_VIEW, SALES_CROSS_GROUP
                     — does NOT hold CREDIT_MANAGE
  role-accounting  : CREDIT_VIEW
  role-warehouse   : no Credit permission

The registry is FLAT: no permission-to-permission implication rule exists in
the repository. Whether CREDIT_MANAGE holders may read Credit data is an
IMLEMENTATION arrangement observed in Wave 9 (credit-profile.js / credit-anchor.js
use VIEW = ['CREDIT_VIEW','CREDIT_MANAGE'] for reads), not a registry-defined
implication. Stage C must state the read/write contract explicitly.
```

Consequence under AP4 + AP4.1 for the seeded roles: `role-sales` holds `CREDIT_MANAGE` but **not** `SALES_CROSS_GROUP`, so it is **DENY** on Credit Profile WRITE. This is the intended new policy outcome, not a contradiction of the registry.

### 14.5 Acceptance scenarios

Business-level Requirement acceptance only. **No new SC, Invariant, UAT, Race or CAP identifier is created.** These scenarios attach to the existing Wave 9 and cross-cutting Credit authorization acceptance references.

#### Positive scenarios

| # | Scenario | Expected Requirement outcome |
|---|---|---|
| A1 | ADMIN reads and manages a centrally owned customer aggregate profile | ALLOW; audit and business rules still enforced |
| A2 | Valid salesperson holding `CREDIT_VIEW` reads the customer's shared aggregate profile | ALLOW |
| A3 | Valid salesperson holding `CREDIT_VIEW` reads their own salesperson sub-limit | ALLOW — valid canonical identity + active applicable membership |
| A4 | Customer with **no** default Sales Group has one centrally managed aggregate Credit Profile | ALLOW; no synthetic owner required |
| A5 | One customer transacting through **two** Sales Groups | Exactly **one** authoritative customer aggregate profile; no split, no duplicate |
| A6 | Actor with `CREDIT_VIEW` + `SALES_CROSS_GROUP` views applicable salesperson-specific Credit Profiles across groups | ALLOW |
| A7 | Properly authorized central Credit manager (management authority + `SALES_CROSS_GROUP`, or ADMIN) manages centrally owned profiles | ALLOW; all existing validation, audit and SOD still apply |

#### Negative scenarios

| # | Scenario | Expected Requirement outcome |
|---|---|---|
| N1 | Same-group membership alone used to reveal another salesperson's sub-limit | DENY |
| N2 | Regular salesperson modifies their **own** sub-limit | DENY |
| N3 | Regular salesperson modifies the shared customer aggregate limit merely by holding `CREDIT_MANAGE` | DENY |
| N4 | `SALES_CROSS_GROUP` without any Credit capability calls a Credit API | DENY (fail closed) |
| N5 | `CREDIT_VIEW` without management authority attempts to mutate Profiles | DENY |
| N6 | Unmapped or inactive salesperson identity claims self-scope visibility | DENY |
| N7 | Expired or invalid applicable group membership claims self-scope eligibility | DENY |
| N8 | Direct Profile ID access used to bypass collection filtering | DENY — ID access must apply the same predicate |
| N9 | Historical Profile / Rating endpoint used to reveal another salesperson's restricted information | DENY |
| N10 | Unauthorized Anchor provisioning used to bypass centrally governed Credit scope | DENY |
| N11 | Ordinary salesperson holding memberships in multiple groups tries to read other salespersons' sub-limits | DENY |
| N12 | Any denied mutation above | **Zero** successful business, audit and idempotency side effects |

**Denial versus business-validation failure.** These are distinct outcomes and must be distinguishable:

```text
Permission denial  → an authorization decision. Fails closed. No business
                      mutation, no audit of a business action, no idempotency
                      record, no partial state.
Business validation→ an authorized actor performed the mutation and the
   failure             mutation failed a business rule. Transaction rolls back
                      under the existing contract. SOD/audit semantics unchanged.

A frontend-hidden control is neither of these and must not be reported as a
denial.
```

### 14.6 Compatibility with existing Credit Requirement

Explicitly preserved and **unchanged** by this policy:

```text
- §13.1 Dual-Limit Control business rules P1-P13, in full.
- SC83..SC89 and their frozen meanings.
- SC111 (Credit View / Manage / Evaluate / Special Approve).
- SC114 (VIEW != WRITE; CREATE != APPROVE; bounded special approval authority).
- Existing Sales Group / Salesperson canonical identities.
- One Customer Aggregate Profile per effective scope.
- One Salesperson Sub-Limit Profile per effective customer / salesperson scope.
- Effective-date history (§13.1 P10, P11; SC88; S19).
- Initial rating and immutable rating history (S05, SC89, SC107).
- PURE_DERIVED future Credit Exposure (SC82; §34.8 row 12; One AR truth).
- Future backend mandatory BLOCK behavior (S15; §29.22.1).
- The existing 14-table allocation across Waves 9-11.
- Existing Wave 9 migration and source files.
- §34.7 P1-P5 and the prohibition on Design introducing a new role.
- §13.4 the no-provable-attribution boundary.
```

Explicit prohibitions carried into this policy:

```text
- No new ownership table and no duplicate business ledger is authorized.
- Do NOT add a sales_group_id column to credit_profile merely to enforce access
  scope.
- Do NOT assign the customer's default Sales Group as the profile owner.
- The approved permission policy must NOT change customer credit exposure
  arithmetic or credit-limit resolution.
- LEGACY_DATA_EVIDENCE_PENDING (§5) remains unchanged and open.
- WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS remains unchanged.
```

Identifier namespaces are unchanged: SC total 114, Invariant total 20 (S01..S20), UAT total 44 (UAT-S-01..UAT-S-44), Race total 24 (R-SAL-01..R-SAL-24), Audit CAP total 36.

### 14.7 Explicit supersession of prior Sales-Group data-scope text

Prior text exists that, read alone, implies Credit Profile is governed by Sales Group data scope. It is **superseded** by this policy so that no two competing active business policies remain.

```text
SUPERSEDED (Design-stage assertion):
  solution.md §36.9.3 "Data scope: sales group filtering applied in the backend
  predicate; never delegated to the frontend (§30.15.1)."

  For Credit Profile this assertion is INCOMPLETE AND NOW SUPERSEDED as a
  business policy: it does not define which group owns a Profile, how a
  multi-group customer's aggregate Profile is scoped, or whether sub-limits
  are private. The approved policy is AP1 + AP2 + AP3 + AP4 + AP4.1.

RETAINED, NOT SUPERSEDED (still-frozen Requirement anchors):
  SC06 / UAT-S-44 group data scope for Quotation / Sales Order / Reports that
  carry sales_group_id — those records are unaffected.
  §30.15.1 backend-enforcement principle — retained and reinforced: filtering
  and fail-closed denial belong in the backend predicate, never in the
  frontend.
```

`solution.md §36.9.3` itself is **not modified by this record**. Stage C must reconcile it under a separate authorization (§14.8).

### 14.8 Stage C Design handoff

Stage C remains **NOT AUTHORIZED** by this record. The following are Design obligations created by this policy, to be discharged only under a separately authorized Stage C action:

```text
1. Reconcile solution.md §36.9.3 against AP1-AP4/AP4.1 and remove the
   unqualified sales-group-filtering assertion for Credit Profile.
2. Express the §14.4 authorization matrix as a single fail-closed backend
   predicate applied uniformly to collection, detail-by-ID, effective-dated
   version, nested/expanded and historical rating reads.
3. State explicitly whether CREDIT_MANAGE confers read capability, since the
   registry defines no implication. Do not leave it implicit.
4. Define self-scope eligibility: canonical salesperson identity resolution plus
   active applicable membership validity, with the N6/N7 denial cases.
5. Define central management write authority (AP4.1) as a distinct condition
   from CREDIT_MANAGE alone.
6. Prove Anchor provisioning (category 5, §14.3) cannot bypass Credit scope
   (N10).
7. Keep Wave 10 mandatory backend Credit Check evaluation independent of any
   human-facing visibility restriction.
8. Preserve the 14-table allocation, the existing Wave 9 migration and source
   files, and §13 Dual-Limit semantics. No new ownership table; no
   credit_profile.sales_group_id.
9. Stage C carry-forward register items #1-#15 (§10) all remain OPEN. This
   record closes none of them.
```

### 14.9 Boundary, status and what this record does NOT claim

```text
Wave 9 status        : IMPLEMENTED / ACCEPTANCE_PENDING — UNCHANGED.
Wave 9 freeze        : NOT frozen. NOT self-accepted. NOT ACCEPTANCE_PASS.
Wave 10 / Wave 11    : NOT started. NOT authorized by this record.
W7-C1 / W7-C2'       : untouched. NOT authorized by this record.
Stage C Design       : NOT authorized by this record.
Code remediation     : REQUIRES SEPARATE EXPLICIT AUTHORIZATION. The current
                       Wave 9 implementation does not satisfy AP3/AP4/AP4.1 —
                       it currently allows any CREDIT_VIEW holder to read all
                       profiles and any CREDIT_MANAGE holder to write them
                       (server/modules/credit-profile.js:9,:56,:75,:131). That
                       gap is recorded, NOT fixed here.
Test-evidence gaps   : NONE resolved by this record. Specifically the SC83-SC86
                       credit_parameters / credit_check_rules effective-version
                       and key questions (Stage C carry-forward #4, #5) and the
                       SC88 / SC89 rating-owner and overlap questions
                       (carry-forward #3, #12) remain OPEN and are NOT falsely
                       marked resolved.
Solution.md / README / AGENTS.md / CLAUDE.md / APPLY_GUIDE : untouched.
Source / migrations / tests / scripts / UI / package.json : untouched.
Database               : not opened, queried or modified.
```

**Status: `SALES CREDIT WAVE 9 — REQUIREMENT DECISION 2 CLOSURE READY FOR EXTERNAL REVIEW — AWAITING_USER_REQUIREMENT_PASS`.**

---

## Stage B Requirement Amendment — Global Credit Configuration Authority (Wave 9) (2026-10-22)

**Authorization:** explicit user approval of `W9-CREDIT_GLOBAL_CONFIG_AUTHORITY_DECISION`, under bounded authorization `WAVE9_BOUNDED_REQUIREMENT_DECISION_3_CLOSURE` (AGENTS.md §4.2).
**Scope:** SC83, SC84, SC85, SC86, SC111, SC114; UAT-S-30; S15 — the human read/write authorization of **globally effective** Credit Parameters and Credit Check Rules.
**Classification:** **AP5 is a NEW approved business Requirement.** It is **not** existing functionality and must not be described as pre-existing behavior. It is an extension of the approved Sales Credit authorization policy §14 (AP1–AP4.1).

### 15.0 Decision identity

```text
Decision id      : AP5
Title            : Centralized Global Credit Configuration Authority
Extends          : §14 AP1-AP4.1 (Sales Credit authorization policy)
Does NOT reuse   : §13.1 Dual-Limit P1-P13
                   §14 AP1-AP4.1 identifiers
                   SC / UAT / R-SAL / S01-S20 identifiers
Resolution target: REQUIREMENT_DECISION_PENDING-3
```

### 15.1 Historical raise record (preserved, not rewritten)

```text
RAISED    2026-10-22, during bounded Stage C Data-Scope Design
QUESTION  Must globally effective Credit Parameters and Credit Check Rules also
          require central management authority (ADMIN, or CREDIT_MANAGE +
          SALES_CROSS_GROUP), or is CREDIT_MANAGE alone intentionally
          sufficient for global Credit configuration?
STATUS    RAISED AND NOT ANSWERED. Recorded as an open business-security risk
          so that no stage could silently close it.
SOURCE    solution.md §36.15.12  "W9-CREDIT_GLOBAL_CONFIG_AUTHORITY_DECISION"
          log/2026-10-22.md, "Final Data-Scope Design Clarification"
WHY IT COULD NOT BE INFERRED (verified against frozen Requirement)
  - §14.3 categories 1-2 explicitly declined to decide the global-configuration
    mutation right.
  - §34.7 P1-P5 contain no central-authority or group-ownership clause, and
    forbid Design from introducing a new role.
  - SC83 / SC84 make Credit Management configurable but fix no authority rule.
  - §34.3.27 states Requirement defines capability-level intent only.
  - Both answers are commercially defensible and materially different, because
    the same role can disable the fail-closed gate that S15 depends on.
VERIFIED IMPACT AT RAISE TIME (read-only)
  server/modules/credit-policy.js:108  createCreditParameter -> allow('CREDIT_MANAGE')
  server/modules/credit-policy.js:152  createCreditRule     -> allow('CREDIT_MANAGE')
  server/modules/credit-policy.js:9    const VIEW = ['CREDIT_VIEW','CREDIT_MANAGE']
  role-sales holds CREDIT_MANAGE without SALES_CROSS_GROUP
```

This raise record is retained verbatim. It is **not** erased and **not** rewritten.

### 15.2 Resolution — `APPROVED / RESOLVED` (2026-10-22)

```text
Before : REQUIREMENT_DECISION_PENDING-3 = RAISED / NOT ANSWERED
         (open business-security risk; global configuration writable by
          CREDIT_MANAGE alone)
After  : REQUIREMENT_DECISION_PENDING-3 = APPROVED / RESOLVED
         (new business policy AP5, recorded below)
```

Approved policy: **Global Credit Parameters and Credit Check Rules shall use centralized management write authority.**

### 15.3 AP5 — Centralized Global Credit Configuration Authority

AP5 governs the human-facing read and write authorization of **globally effective** Credit Parameters and Credit Check Rules. It adds no new business semantics to Credit: the *meaning* of enabled/disabled, scope, timing, strength and rule applicability is unchanged. Only **who may read and who may write** is newly determined.

#### 15.3.1 Read contract

```text
READ  =  ADMIN   OR   CREDIT_VIEW
DENY  =  actor without CREDIT_VIEW and without ADMIN authority
DENY  =  actor with SALES_CROSS_GROUP but not CREDIT_VIEW
DENY  =  actor with CREDIT_MANAGE but not CREDIT_VIEW, unless ADMIN
```

```text
CREDIT_MANAGE    does NOT automatically grant CREDIT_VIEW.
SALES_CROSS_GROUP does NOT automatically grant CREDIT_VIEW.
READ access to global configuration does NOT grant WRITE access.

No permission-to-permission implication may be invented. The canonical
permission registry is flat and defines no implication; this Requirement does
not create one.
```

#### 15.3.2 Write contract

```text
WRITE =  ADMIN
     OR ( CREDIT_MANAGE  AND  SALES_CROSS_GROUP )     <- logical AND, not OR
otherwise DENY
```

The authorized writer must still satisfy **all** existing requirements, unchanged:

```text
effective-date constraints (assertDateRange, effective_from / effective_to)
version ownership (predecessor closing, overlap rejection)
transaction integrity
idempotency
audit (§34.7 P5)
business validation
```

Authorization must be enforced by the backend, independently of frontend visibility.

#### 15.3.3 Scope of the write restriction

The restriction applies to **every** mutation that changes the effective meaning of global Credit configuration, including but not limited to:

```text
- creating a Parameter configuration
- creating a new effective Parameter version
- creating a Credit Rule
- creating a new effective Rule version
- changing configuration scope
- changing control timing
- changing control strength
- changing the credit item or rule applicability
- disabling Credit Management (CREDIT_MANAGEMENT_ENABLED)
- downgrading BLOCK to WARNING
```

AP5 introduces **no** separate approval workflow, **no** new permission code and **no** additional business condition beyond the approved authorization policy.

### 15.4 Authorization matrix

READ and WRITE are **independent** columns. READ is not inferred from WRITE, and WRITE is not inferred from READ.

| Actor | READ | WRITE |
|---|---|---|
| ADMIN | ALLOW | ALLOW |
| `CREDIT_VIEW` only | ALLOW | DENY |
| `CREDIT_MANAGE` only | DENY | DENY |
| `CREDIT_VIEW` + `CREDIT_MANAGE` | ALLOW | DENY |
| `CREDIT_VIEW` + `SALES_CROSS_GROUP` | ALLOW | DENY |
| `CREDIT_MANAGE` + `SALES_CROSS_GROUP`, **without** `CREDIT_VIEW` | **DENY** | **ALLOW** |
| `CREDIT_VIEW` + `CREDIT_MANAGE` + `SALES_CROSS_GROUP` | ALLOW | ALLOW |
| `SALES_CROSS_GROUP` only | DENY | DENY |
| No Credit permissions | DENY | DENY |

The sixth row is deliberate and is **not** a defect. A dedicated configuration administrator may hold management plus cross-group authority without needing business read visibility; READ and WRITE remain genuinely independent capabilities, consistent with SC114 `VIEW != WRITE` and §34.7 P1. Where a role currently carries both permissions, the actual distinction must be preserved at the API boundary — it must not be collapsed into one permission.

### 15.5 Internal Credit engine exception

```text
resolveCreditParameter() and resolveCreditRule() are the internal effective
configuration resolvers consumed by mandatory backend Credit enforcement.

They are NOT human-facing GET endpoints and must NOT acquire the §15.3.1
human read predicate.

A human actor's Credit read scope must never decide which rules or parameters
apply to a mandatory backend Credit Check (S15, §29.22.1).

Reading global configuration must never weaken future Wave 10 enforcement.
```

### 15.6 Existing role consequences

Seeded role grants verified read-only from `server/db.js` (registry **unchanged** by this record):

| Role | `CREDIT_VIEW` | `CREDIT_MANAGE` | `SALES_CROSS_GROUP` | Global config READ | Global config WRITE |
|---|---|---|---|---|---|
| ADMIN | yes | yes | yes (via `all`) | **ALLOW** | **ALLOW** |
| SALES | yes | yes | **no** | **ALLOW** | **DENY** |
| REVIEWER | yes | no | yes (`db.js:1761`) | **ALLOW** | **DENY** |
| ACCOUNTING | yes | no | no | **ALLOW** | **DENY** |
| WAREHOUSE | no | no | no | DENY | DENY |

Consequences, recorded as intended outcomes rather than regressions:

1. `role-sales` **retains** authorized global Credit Parameter / Rule **READ** access.
2. `role-sales` **loses** global Credit Parameter / Rule **WRITE** access under AP5.
3. That loss is **intentional business policy, not a regression**, and must not be bypassed by any alternative endpoint, payload variant or role workaround.
4. A privileged actor holding centrally authorized management permissions can administer the configuration. Under the seeded roles this is currently ADMIN; granting `SALES_CROSS_GROUP` to an existing role is a **separate, explicitly authorized operational decision**, not something this Requirement performs.

Explicit prohibitions for this stage:

```text
Do NOT alter seeded role permissions during Requirement closure.
Do NOT silently grant SALES_CROSS_GROUP to ordinary sales users to preserve
     the previous behavior.
Do NOT create a replacement role.
Do NOT create a new permission.
```

`role-reviewer` and `role-accounting` remain subject to their actual permission sets, as recorded in the table.

### 15.7 Mandatory backend security semantics

The following are Requirement-level guarantees for global Credit configuration:

```text
1.  Backend authorization is mandatory on EVERY global Credit configuration
    mutation.
2.  Frontend visibility is NOT an authorization boundary (S15, SC114).
3.  Unauthorized mutation attempts produce an explicit permission denial.
4.  Unauthorized attempts do NOT create Parameter versions.
5.  Unauthorized attempts do NOT create Rule versions.
6.  Unauthorized attempts do NOT close or replace previous effective versions.
7.  Unauthorized attempts do NOT create successful business audit entries.
8.  Unauthorized attempts do NOT consume or create successful idempotency
    records.
9.  Unauthorized attempts produce NO partial business state.
10. Internal Credit enforcement does NOT use the current human actor's read
    scope to decide which rules apply (§15.5).
```

Points 4-9 together define the **no-side-effect authorization invariant**: a denied mutation must be a complete no-op across business rows, version closure, audit and idempotency.

AP5 introduces **no** new Credit Exposure ledger and does **not** alter the approved Dual-Limit calculation.

### 15.8 Acceptance scenarios

Business-level Requirement acceptance. **No new SC, Invariant, UAT, Race or CAP identifier is created.** These scenarios attach to the existing Credit authorization and **UAT-S-30** traceability.

#### Positive scenarios

| # | Scenario | Expected outcome |
|---|---|---|
| P1 | ADMIN reads and creates Parameter versions | ALLOW |
| P2 | ADMIN reads and creates Rule versions | ALLOW |
| P3 | `CREDIT_VIEW`-only actor reads global configuration | ALLOW |
| P4 | `CREDIT_MANAGE` + `SALES_CROSS_GROUP` actor creates a valid effective-dated Parameter | ALLOW |
| P5 | `CREDIT_MANAGE` + `SALES_CROSS_GROUP` actor creates a valid effective-dated Rule | ALLOW |
| P6 | Authorized central manager modifies the effective enabled/disabled configuration | ALLOW |
| P7 | Authorized central manager creates a WARNING rule **or** a BLOCK rule | ALLOW |
| P8 | Internal Credit resolution still consumes authoritative effective configuration regardless of a human actor's Credit read scope | ALLOW; engine unaffected by §15.3.1 |

#### Negative scenarios

| # | Scenario | Expected outcome |
|---|---|---|
| N1 | Ordinary `role-sales` disables Credit Management | DENY |
| N2 | Ordinary `role-sales` weakens a BLOCK rule | DENY |
| N3 | `CREDIT_MANAGE` without `SALES_CROSS_GROUP` writes | DENY |
| N4 | `SALES_CROSS_GROUP` without `CREDIT_MANAGE` writes | DENY |
| N5 | `CREDIT_VIEW`-only actor writes | DENY |
| N6 | `CREDIT_MANAGE`-only actor calls a human GET endpoint without `CREDIT_VIEW` | DENY |
| N7 | Unauthorized POST creates a new effective version | DENY; no version created |
| N8 | Unauthorized POST closes a predecessor version | DENY; predecessor untouched |
| N9 | Unauthorized POST | DENY; zero successful business audit entries and zero successful idempotency records |
| N10 | Frontend exposure used to bypass backend authorization | DENY; frontend is not a boundary |

Every scenario must be **independently testable** in the subsequent Implementation stage. Each is stated so that a single focused assertion can prove it. Permission denial must remain distinguishable from ordinary business-validation failure.

### 15.9 Compatibility and non-goals

Preserved unchanged:

```text
- §13.1 Dual-Limit P1-P13
- §14 AP1-AP4.1 (central ownership, shared aggregate, self-only sub-limit,
  credit permission x cross-group, central Profile write authority)
- SC83-SC89 and their frozen meanings
- SC111 (Credit View / Manage / Evaluate / Special Approve)
- SC114 (VIEW != WRITE; CREATE != APPROVE; bounded special approval)
- UAT-S-29 and UAT-S-30
- S15 mandatory backend fail-closed behavior
- effective-dated Parameter and Rule history
- Credit Policy Snapshot immutability
- the 14-table Waves 9-11 allocation
- Wave 9 physical migration and source files
- existing Wave 10 / Wave 11 Design
- W7-C1 / W7-C2' remediation boundaries
- LEGACY_DATA_EVIDENCE_PENDING
- WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS
```

Non-goals — AP5 governs **only** global Credit Parameters and Credit Check Rules:

```text
It does NOT automatically change unrelated Sales parameters, pricing rules,
Finance policies, customer master data or generic system configuration.

No new physical schema is authorized.
No new permission is authorized.
No new workflow is authorized.
No global Credit business semantics change beyond human read/write
authorization.
```

Identifier namespaces remain unchanged: SC total 114, Invariant total 20 (S01..S20), UAT total 44 (UAT-S-01..UAT-S-44), Race total 24 (R-SAL-01..R-SAL-24), Audit CAP total 36.

### 15.10 Explicit supersession

```text
SUPERSEDED:
  document.md §14.3 categories 1 and 2 stated that global Credit Parameters and
  Credit Check Rules are governed by the EXISTING FROZEN CONTRACT and that
  §14 "creates no new mutation right" over them.

  Under that position, combined with the implemented
  allow(actor,'CREDIT_MANAGE') at credit-policy.js:108 and :152, global
  configuration was writable by CREDIT_MANAGE alone. AP5 REMOVES that mutation
  right for actors lacking central authority.

  §14.3 is therefore superseded in part for categories 1 and 2 ONLY, as to the
  human WRITE authorization of global Credit configuration. It is NOT superseded
  for any other purpose, and specifically NOT superseded as to:
    - Credit central ownership (AP1)
    - shared Customer Aggregate (AP2)
    - self-only sub-limit visibility (AP3)
    - credit permission x cross-group enforcement (AP4)
    - central Profile management write authority (AP4.1)
    - the statement that central configuration is not Sales Group-owned
    - the frozen contract that still governs Parameters and Rules business
      SEMANTICS (SC83-SC86)

RETAINED VERBATIM:
  §14.0, §14.1, §14.2 (AP1-AP4.1), §14.4, §14.4.1, §14.5, §14.6, §14.7, §14.8,
  §14.9 and §13 unchanged.

  §14.4.1's registry facts (the flat registry and the seeded role grants) remain
  accurate and unchanged; only their WRITE consequence for global
  configuration is extended by AP5.
```

### 15.11 Stage C Design handoff

Stage C is **NOT AUTHORIZED** by this record. Obligations created for a separately authorized Stage C reconciliation:

```text
1. Reconcile solution.md §36.15.7 rows 2 and 4, which currently specify
   CREDIT_MANAGE alone for Parameter and Rule writes.
2. Reconcile solution.md §36.15.12, which recorded this risk as OPEN; it must
   be updated to record the approved resolution without erasing the raise.
3. Express the §15.4 matrix as one fail-closed backend predicate, with READ and
   WRITE resolved independently.
4. Remove the CREDIT_MANAGE-as-read-fallback in the Parameter and Rule READERS
   (credit-policy.js:9, :98, :142), since §15.3.1 forbids the implication.
5. Express the §15.7 no-side-effect invariant in terms of the existing
   transaction, audit and idempotency structure.
6. Preserve §15.5: the internal resolvers stay actor-free and unfiltered.
7. Preserve the existing Wave 9 migration, source files, effective-date and
   overlap handling, and the 14-table allocation.
8. Stage C carry-forward register items #1-#15 (§10) all remain OPEN. This
   record closes none of them.
```

### 15.12 Boundary and status

```text
Wave 9 status        : IMPLEMENTED / ACCEPTANCE_PENDING — UNCHANGED.
Wave 9 freeze        : NOT frozen. NOT self-accepted. NOT ACCEPTANCE_PASS.
Stage C Design       : NOT authorized by this record.
Implementation       : AP5 is NOT implemented by this record. Any code change
                       requires separate explicit authorization.
Wave 10 / Wave 11    : NOT started. NOT authorized.
W7-C1 / W7-C2'       : untouched. NOT authorized.
solution.md / README / AGENTS.md / CLAUDE.md / APPLY_GUIDE : untouched.
Source / migrations / tests / scripts / UI / package.json  : untouched.
Database               : not opened, queried or modified.
Test / build           : not executed.
Test-evidence gaps     : NONE resolved. Stage C carry-forward #1-#15 remain OPEN.
```

**Status: `SALES CREDIT WAVE 9 — REQUIREMENT DECISION 3 CLOSURE READY FOR EXTERNAL REVIEW — AWAITING_USER_REQUIREMENT_PASS`.**

---

## Wave 9 Final Acceptance and Freeze Record (2026-10-23)

### 1. Acceptance decision

The user explicitly approved `SALES CREDIT WAVE 9 — FINAL_ACCEPTANCE_PASS / FROZEN` after review of the
complete SQLite, MySQL, concurrency, build and responsive-UI evidence. Wave 9 is therefore accepted and
frozen at the approved Requirement boundary in §13–§15 and the existing SC83–SC89 / UAT-S-29–30 contract.
This record closes Acceptance/Freeze documentation only. It does not rewrite any approved business rule,
permission contract, schema, state transition, ownership boundary or historical stage record.

### 2. Accepted Requirement boundary

The frozen Wave 9 Requirement comprises:

- Credit Parameters and Credit Check Rules with effective-dated history, explicit stage/scenario/timing/item
  semantics, and independently configurable `WARNING` and `BLOCK` strengths (SC83–SC86);
- Customer Aggregate and eligible Salesperson sub-limit Credit Profiles, effective-date resolution,
  predecessor closure, overlap rejection, overdue policy, immutable initial-rating provenance and status
  semantics (SC87–SC89);
- AP1–AP4.1 central ownership, shared aggregate, self-only sub-limit visibility, independent Credit permission
  and cross-group enforcement, and central Profile/Anchor write authority;
- AP5 global-configuration authorization: human READ is `ADMIN OR CREDIT_VIEW`; human WRITE is
  `ADMIN OR (CREDIT_MANAGE AND SALES_CROSS_GROUP)`, with denied writes producing zero business, audit and
  idempotency effects;
- UAT-S-29 and UAT-S-30, including responsive access, direct-route behavior and backend fail-closed parity.

### 3. Final acceptance evidence

The user accepted the following completed evidence as the Wave 9 Final Acceptance basis:

```text
SQLite focused                 21 / 21 PASS
Fast                          380 / 380 PASS
Full                         2647 / 2647 PASS
Heavy                          67 / 67 PASS
MySQL Integration              73 / 73 PASS
MySQL Wave 9 Credit            17 / 17 PASS
MySQL Concurrency             106 / 106 PASS
MySQL Wave 9 Anchor             4 / 4 PASS
Build                                  PASS
Responsive UI                         PASS (320 / 390 / 430 / 680 CSS px)
git diff --check                       PASS
```

The accepted MySQL Anchor evidence covers independent real-MySQL sessions, genuine same-key contention for
both `CREDIT_OBJECT` and `POLICY_SCOPE`, strict deadlock classification when applicable, acknowledged explicit
rollback, same-connection canonical recovery, final one-row identity convergence, production `transaction()`
convergence and zero leaked worker sessions.

### 4. Preserved open dependencies and downstream gate

- `LEGACY_DATA_EVIDENCE_PENDING` remains open and unchanged. No legacy Credit Profile bootstrap,
  compatibility fact or historical value is inferred by this freeze.
- `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` remains active and unchanged; the label also covers the
  approved Design meaning of W7-C2′. This freeze does not implement or accept W7-C1/W7-C2′.
- Wave 10 and Wave 11 are not started or authorized by this record. Their Requirements and Design remain
  future work subject to the existing gate and separate explicit authorization.

### 5. Frozen boundary and change control

The freeze is limited to the accepted Wave 9 Credit Foundation. Any future change to AP1–AP5, SC83–SC89,
UAT-S-29/30, the six Wave 9 table contracts, authorization predicates, effective-date behavior, Anchor
identity, canonical ownership or accepted compatibility semantics must restart the repository's
`AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE` sequence.

This freeze does not freeze the ERP project as a whole and is not a Git commit, tag, release, deployment,
database migration or version change. Git closure remains pending separate user authorization.

**Status: `WAVE9_FINAL_ACCEPTANCE_PASS — FROZEN — GIT_CLOSURE_PENDING`.**

## Gate A Final Acceptance and Freeze Record (2026-10-24)

### 1. Acceptance decision

The user explicitly accepted `GATE_A_MYSQL_CAMPAIGN_PASS` and authorized the Gate A
`FINAL_ACCEPTANCE_PASS / FROZEN` record on the basis of the single authorized real-MySQL
execution of `pnpm test:mysql` against
`mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`
(server UUID `5d3c6a68-b8a5-11f1-8ce6-b025aa71d167`, MySQL 8.0.37).
Gate A is therefore accepted and frozen at the approved Requirement boundary of §37 and the
existing Wave 7 Sales & Customer contract. This record closes Acceptance/Freeze documentation
only. It rewrites no approved business rule, permission contract, schema, state transition,
ownership boundary, lock order, isolation level or historical stage record, and it changes no
production code.

### 2. Accepted Requirement boundary

The frozen Gate A boundary comprises:

- the Wave 7 Sales & Customer capability set exercised by the bounded Gate A campaign
  (A-PARITY, A-PROD, A-RAW, A-TXLIFE);
- the MySQL L0 transaction gate and the L1–L8 business lock order;
- the canonical named-lock lifecycle and its single authoritative release contract, including
  the transaction-start-failure path;
- the existing effective-retry semantics, the existing idempotency contract and the Finance
  monetary authority rules exercised by M19–M25;
- the existing SQLite compatibility behavior and MySQL `READ COMMITTED` session isolation;
- the existing schema, migration and reconciliation contracts, together with the existing
  target-identity guard, authorization checks and fail-fast gate rules.

### 3. Final acceptance evidence

The user accepted the following completed evidence as the Gate A Final Acceptance basis. The
MySQL campaign below was produced by the single authorized execution:

```text
A-PARITY   server/mysql-sales-customer-wave7.integration.js                 4 / 4 PASS
A-PROD     server/mysql-sales-customer-wave7-concurrency.integration.js     6 / 6 PASS
A-RAW      server/mysql-sales-customer-wave7-raw-locks.integration.js       4 / 4 PASS
A-TXLIFE   server/mysql-transaction-start-safety.integration.js             8 / 8 PASS
TAP fail / skipped / cancelled / todo                                     0 / 0 / 0 / 0
GATE A MYSQL CAMPAIGN                                                            PASS
```

The applicable Gate A M-cases are `PASS`: M1–M8, M13, M14, M16–M18, M19-GRNR, M20–M25.
M9, M10, M11, M12, M15 and M19-CREDIT are reported `BLOCKED_BY_WAVE10` by the runner itself
and are not discharged by this record.

The accepted A-TXLIFE real-session evidence covers verified server-side named-lock release,
session destruction with server lock reclamation and retirement from
`information_schema.PROCESSLIST`, the post-quarantine session-identity set equalling the
original set minus exactly the quarantined victim, the absence of any adapter connection leak
beyond the intentionally live primary and observer sessions, and the production
`transaction()` lifecycle releasing the replay-miss lock with both the exact-replay and
fingerprint-conflict reacquired locks released.

Supporting local regression evidence recorded earlier on 2026-10-24 and not re-run in this
freeze stage, per the stage authorization: `test:fast` 427/427 PASS, `test` 2754/2754 PASS,
`test:heavy` 67/67 PASS, `build` PASS (1964 modules transformed), `git diff --check` PASS.
The earlier M24/M25 remediation stage additionally recorded `test:fast` 397/397 PASS and
`test` 2724/2724 PASS on the same baseline.

Post-run read-only inventory of the authorized database returned zero tables, zero views,
zero triggers, zero routines and zero events, with target identity unchanged.

### 4. Preserved open dependencies and downstream gate

- Gate B remains `BLOCKED_BY_WAVE10`. It holds `B-COMPOSE`, `B-M9`, `B-M10`, `B-M11`,
  `B-M12`, `B-M15` and `B-M19C`. Gate A is not a prerequisite for Gate B, and this freeze
  does not discharge, weaken or defer Gate B.
- M9, M10, M11, M12, M15 and M19-CREDIT remain `BLOCKED_BY_WAVE10`.
- The residual open items recorded in `solution.md §37.31.15` (R1–R4) remain open and
  unchanged. They were recorded, not fixed, and this freeze does not close them.
- Wave 10 and Wave 11 are not started, accepted or authorized by this record. Their
  Requirements and Design remain future work subject to the existing gate and a separate
  explicit authorization.
- This record does not declare the remaining W7-C1 / W7-C2′ follow-up work complete. Gate B
  acceptance must still be completed and separately authorized.
- The disclosed operational risk of the broad global administrative grant on the disposable
  test account remains as recorded in `log/2026-10-24.md` and is not changed by this freeze.

### 5. Frozen boundary and change control

The freeze is limited to the accepted Gate A campaign boundary. Any future change to the
Gate A M-case set, the runner manifest or its suite order, the strict TAP / fail-fast /
cleanup rules, the target-identity guard, the canonical named-lock release contract, the
MySQL session isolation level, the L0 / L1–L8 lock order or the accepted A-TXLIFE fixture
semantics must restart the repository's
`AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE` sequence.

This freeze does not freeze the ERP project as a whole and is not a Git commit, tag,
release, deployment, database migration or version change. Git closure remains pending
separate user authorization.

**Status: `GATE_A_FINAL_ACCEPTANCE_PASS — FROZEN`.**

---

## Wave 10 Precondition Requirement Reconciliation (2026-10-24)

### 1. Authorization, scope and frozen protection

**Authorization.** The user authorized one bounded Requirement stage: reconcile the Wave 10 entry
conditions against the current repository fact, reconcile the Stage C carry-forward register #1–#15
against real implementation and test evidence, and correct a bounded set of document-state
contradictions. Under the amended `AGENTS.md §4.0` the same authorization extends to the
immediately following Design stage, which must HARD STOP before Implementation.

**Scope.** This record is Requirement-only. It introduces no business rule, no permission contract,
no schema, no state transition, no ownership boundary, no lock order, no isolation level and no
acceptance conclusion. It changes no production source, no test, no migration and no
`package.json`.

**Explicitly not modified.** The Gate A Final Acceptance and Freeze Record (2026-10-24); the Wave 9
Final Acceptance and Freeze Record (2026-10-23); the Stage B Requirement Applicability Closure
(2026-10-22) and its §13–§15 amendments; every earlier Stage A/B/C record; `solution.md`;
`README.md`; the frozen Gate A runner, its suite manifest, its suite order, its strict TAP /
fail-fast / per-suite-cleanup rules, the target-identity guard, the named-lock release contract and
the Gate A M1–M25 board.

**Read-only basis.** Every statement below was read from the local working tree and the local Git
state at `feature/sales-waves6-13@2037cb632e2464477fe9752dc3113dac3c0eacf3`, package `1.6.2`. No
database was connected, no test, build, migration, reset or destructive operation was executed, and
no Git write operation was performed.

### 2. Canonical dependency direction

The authoritative dependency direction is fixed and is not re-decided by this record:

```text
Gate A Final Acceptance + Freeze
  → Wave 10 Implementation
  → Gate B Acceptance
  → Gate B Freeze
  → Wave 11
```

- **Gate A is accepted and frozen.** See "Gate A Final Acceptance and Freeze Record (2026-10-24)"
  §1–§3 and `solution.md §37.33`. The accepted evidence is the single authorized real-MySQL
  execution of `pnpm test:mysql` against
  `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`
  (server UUID `5d3c6a68-b8a5-11f1-8ce6-b025aa71d167`, MySQL 8.0.37): A-PARITY 4/4, A-PROD 6/6,
  A-RAW 4/4, A-TXLIFE 8/8, TAP fail/skipped/cancelled/todo 0/0/0/0.
- **Gate B is a downstream obligation of Wave 10, never a prerequisite for it.** This is already the
  canonical position and is confirmed, not changed, here: `solution.md §37.18` ("Gate A does not
  depend on Gate B; Gate B is a downstream obligation of Wave 10 itself and is never a prerequisite
  for Gate A"), `solution.md §37.26` ("Gate B is not a prerequisite for Gate A, and Gate A does not
  discharge Gate B"), and the Gate A Freeze Record §4 ("Gate A is not a prerequisite for Gate B, and
  this freeze does not discharge, weaken or defer Gate B").
- **Gate B must be executed against real Wave 10 production code.** `solution.md §37.18.2` requires
  every Gate B case to be reported `BLOCKED_BY_WAVE10` until Wave 10 is separately authorized and
  implemented, and never as PASS, never as skipped-and-green, never as "verified by inspection".
- **No Gate B-0 exists and none is created.** No preparatory gate may be introduced to bypass this
  order.

### 3. `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` — status reconciliation

The label was defined as a *condition*, not as a permanent state. `solution.md §37.18.1` states:
"Gate A passing, plus **explicit user Final Acceptance**, is what satisfies
`WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS`." `solution.md §37.26` restates it: the label "is
unchanged and is satisfied only by Gate A plus explicit user Final Acceptance."

| Fact | Evidence |
|---|---|
| Gate A campaign PASS | `log/2026-10-24.md` — "authorized Gate A MySQL campaign execution (single run)" |
| Explicit user Final Acceptance granted | `log/2026-10-24.md` — "Gate A — Final Acceptance and Freeze Record (2026-10-24)"; `document.md` Gate A Freeze Record §1 |
| Both limbs of the defining condition are satisfied | 2026-10-24 |

**Current status: the condition named by `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` is
satisfied as of 2026-10-24.** The label remains a valid historical identifier of the Wave 10 entry
gate and is retained as such; it is **not** an active block, and it must no longer be restated as an
unmet current condition.

Historical statements that recorded this label as "active and unchanged" were accurate on their own
record dates and are **preserved as history, not rewritten**: `document.md` §14.9 and §15.11
(2026-10-22); `document.md` "Wave 9 Final Acceptance and Freeze Record" §4 (2026-10-23);
`solution.md` §36.16.4 (2026-10-22); and the `solution.md` §37 stage boundary paragraphs of
2026-10-23 / 2026-10-24. Each of them is superseded **for current status only** by this record and
by the Gate A Freeze Record.

What genuinely remains open is **not** this label. It is:

1. **Gate B acceptance** — a downstream obligation dischargeable only after Wave 10 is implemented
   and the fixtures are executed against it (`solution.md §37.18.2`).
2. **The remaining W7-C1 / W7-C2′ follow-up work** and the residual open items R1–R4 in
   `solution.md §37.31.15` — explicitly not declared complete by the Gate A Freeze Record §4 or by
   `solution.md §37.33.3`.
3. **Wave 10 implementation itself** — not started, not accepted, not authorized.

### 4. Stage C carry-forward register #1–#15 — closure evidence matrix

The register is `document.md` §10 "Stage C Design carry-forward register" (Stage B Requirement
Applicability Closure, 2026-10-22). It was opened at Stage B — before Stage C Design and before any
Wave 9 implementation — and states of itself: "**None is resolved by this Stage B record**." That
statement is correct for 2026-10-22 and is preserved. What was missing is the *current* status,
which is recorded below.

Each item was checked against the current repository, not against the existence of a freeze record.
A freeze record is not evidence that an item is closed, and SQLite-only evidence is not evidence of
real MySQL concurrency.

| # | Carried-forward Design issue | Current status | Wave 10 blocking |
|---|---|---|---|
| 1 | `credit_profile` physical primary key and candidate keys | Closed | Not blocking |
| 2 | Nullable salesperson normalized-scope uniqueness and bidirectional consistency | Closed | Not blocking |
| 3 | Effective-date interval overlap and deterministic active Profile resolution | Closed | Not blocking |
| 4 | `credit_check_rules.id` PK / UNIQUE definition | Closed | Not blocking |
| 5 | `credit_parameters` column UNIQUE versus composite PK conflict | Closed | Not blocking |
| 6 | `credit_profile_ratings` Wave 9 → Wave 11 deferred FK | Closed at Wave 9 | Not blocking; Wave 11 realization deferred |
| 7 | SQLite foreign-key creation versus pre-target DML behavior | Closed by design construction | Not blocking |
| 8 | MySQL FK ordering and idempotent metadata convergence | Partially closed | Not blocking; Wave 10 obligation |
| 9 | Stable Credit Anchor provisioning transaction boundary | Closed | Not blocking |
| 10 | Credit Policy Snapshot fingerprint identity and uniqueness | Closed | Not blocking; Wave 10 runtime writer |
| 11 | Canonical names: `credit_lock_anchors` and `credit_check_results` | Partially closed | Not blocking; Wave 10 deliverable |
| 12 | Credit Profile rating canonical write owner | Closed for the Wave 9 path | Not blocking; Wave 11 `EVALUATED` path deferred |
| 13 | R-SAL-12 / R-SAL-24 infrastructure versus full business-race timing | Open by design | Future acceptance obligation |
| 14 | Read-only legacy inventory and conditional bootstrap | Open — `LEGACY_DATA_EVIDENCE_PENDING` | Not blocking; unresolved evidence |
| 15 | SQLite / MySQL PK, UNIQUE, CHECK, FK and indexed-column type parity | Partially closed — evidence incomplete | Not blocking; cross-database evidence obligation |

#### #1 — `credit_profile` physical primary key and candidate keys

- **Original Requirement:** `document.md` §34.3 SC87–SC89 (Credit Profile identity and effective-dated
  versioning); register §10 #1.
- **Existing Design:** `solution.md §36.2.2` (`credit_profile`, A-51, supersedes §29.22 PK) and
  `§36.5.5` (contract assertion requirement).
- **Implementation evidence:** `server/migrations/sales-customer-wave9-credit-foundation.js:79`
  (`id TEXT PRIMARY KEY NOT NULL`, SQLite) and `:176` (`id VARCHAR(128) NOT NULL PRIMARY KEY`,
  MySQL); candidate key `uq_credit_profile_scope_version` UNIQUE(`anchor_id`,`effective_from`) at
  `:22`; lookup index `ix_credit_profile_customer_scope` at `:23`.
- **Test evidence:** `server/sales-customer-wave9-credit-foundation.test.js` (SQLite focused, in FAST
  and FULL; covered by the accepted Wave 9 `test:fast` 380/380 and `test` 2647/2647) and
  `server/mysql-sales-customer-wave9-credit.integration.js` (real MySQL, accepted 17/17). The
  migration's own `assertSqlite` (`:226`) and `assertMySql` (`:247`) assert column identity/order and
  PK per table and fail closed on drift; both ran in the accepted MySQL execution.
- **Current status:** **Closed.** The key contract is settled by Design, implemented in Wave 9, and
  asserted on both engines.
- **Wave 10 blocking:** **Not blocking.** Wave 10 may not alter this contract.
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract.

#### #2 — Nullable salesperson normalized-scope uniqueness and bidirectional consistency

- **Original Requirement:** `document.md` §34.3 SC87 (optional salesperson dimension; §3 B-1) and the
  register §10 #2.
- **Existing Design:** `solution.md §36.2.2` — `salesperson_scope_key` NOT NULL normalized (`*` for
  aggregate) with a bidirectional consistency CHECK; `§36.3.1` applicable control scope resolution.
- **Implementation evidence:** migration `:82` `salesperson_scope_key TEXT NOT NULL`; the bidirectional
  CHECK at `:92`; `ix_credit_profile_customer_scope` at `:23`; scope derivation in
  `server/modules/credit-profile.js:31`.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC87 aggregate and
  sub-limit identities normalize to distinct scopes on MySQL" (accepted 17/17), whose own comment
  records that "Scope normalization is enforced as a physical MySQL CHECK, not only in code"; plus the
  SQLite focused suite.
- **Current status:** **Closed.**
- **Wave 10 blocking:** **Not blocking.** Wave 10 must consume the same normalized scope key rather
  than derive a second scope representation.
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract and a Wave 10 read constraint.

#### #3 — Effective-date interval overlap and deterministic active Profile resolution

- **Original Requirement:** `document.md` §34.3 SC88 (effective dating); register §10 #3, whose
  cross-scope case was gated by `REQUIREMENT_DECISION_PENDING-1`.
- **Existing Design:** `solution.md §36.2.2`; `§36.3.4` step 5; `§36.6.3` step 6 ("resolve effective
  `credit_profile` at `business_date` (exactly one row, else fail closed)"). The cross-scope ordering
  was resolved by the approved Dual-Limit decision at `document.md` §13 / §9.1 (2026-10-22).
- **Implementation evidence:** `server/modules/credit-profile.js:124`
  `closePredecessorAndAssertNoOverlap` — `:127` same-scope-same-`effective_from` → HTTP 409
  `CREDIT_PROFILE_VERSION_EXISTS`; `:129-130` predecessor closure; `:133` overlap rejection; `:44`
  `resolveEffectiveCreditProfile` with `effective_from<=? AND (effective_to IS NULL OR
  effective_to>=?) ORDER BY effective_from DESC, id`; `:66` the same deterministic predicate in the
  list resolver.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC88 effective-dated
  resolution, predecessor closure, overlap rejection and overdue policy persist on MySQL" (accepted
  17/17); SQLite focused suite.
- **Current status:** **Closed.**
- **Wave 10 blocking:** **Not blocking.** Wave 10 must call this exact resolver and must fail closed
  when the effective row is not unique; it may not re-derive an effective row by its own rule.
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract and a Wave 10 consumption
  constraint.

#### #4 — `credit_check_rules.id` PK / UNIQUE definition

- **Original Requirement:** `document.md` §34.3 SC83–SC86; register §10 #4.
- **Existing Design:** `solution.md §36.2.4` (A-49, supersedes §29.21 missing key).
- **Implementation evidence:** migration `:62` / `:164` primary key; `uq_credit_check_rules_version`
  UNIQUE(`rule_code`,`effective_from`) at `:20`; `ix_credit_check_rules_stage_date` at `:21`.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC83-SC86 control
  scope, timing and both rule strengths round-trip on MySQL" (accepted 17/17); SQLite focused suite;
  metadata PK assertion executed on real MySQL.
- **Current status:** **Closed.**
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract.

#### #5 — `credit_parameters` column UNIQUE versus composite PK conflict

- **Original Requirement:** `document.md` §34.3 SC83–SC84 (configurable Credit Parameters);
  register §10 #5.
- **Existing Design:** `solution.md §36.2.3` (A-48, supersedes §29.21 UNIQUE/PK conflict).
- **Implementation evidence:** migration `:47` / `:156` primary key; `uq_credit_parameters_version`
  UNIQUE(`code`,`effective_from`) at `:18`.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — the three AP5 cases
  (human READ, human WRITE, and "ordinary Sales cannot disable Credit Management or weaken BLOCK to
  WARNING") at accepted 17/17; SQLite focused suite.
- **Current status:** **Closed.** The column-level uniqueness that would have defeated effective
  versioning is not present.
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract.

#### #6 — `credit_profile_ratings` Wave 9 → Wave 11 deferred FK

- **Original Requirement:** `document.md` §34.3 SC89 (initial-rating provenance); register §10 #6.
- **Existing Design:** `solution.md §36.5.2` (the one deferred FK — "no `REFERENCES` clause, either
  engine" in Wave 9); `§36.2.6`; `§36.5.3` (Wave 11 ordering); `§36.5.5` I-6 (forward-FK convergence).
- **Implementation evidence:** migration `:120` `evaluation_result_id TEXT` with **no** `REFERENCES`
  clause in the SQLite DDL and **no** FK to `credit_evaluation_result` in the MySQL DDL block
  (`:203`ff); the provenance CHECK at `:124` enforces `INITIAL_ASSIGNED ⟺ evaluation_result_id IS
  NULL`.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC89 initial rating
  provenance is recorded and rating evidence is append-only on MySQL" (accepted 17/17); the
  `assertMySql` nullability assertion confirms
  `credit_profile_ratings.evaluation_result_id IS_NULLABLE='YES'`, executed on real MySQL.
- **Current status:** **Closed at Wave 9.** The deferred-FK design is implemented exactly as designed.
  The **Wave 11 realization** of the constraint (`fk_credit_profile_ratings_evaluation_result`) is
  future work and is not yet due; `§36.5.2` states that Wave 10 adds no FK on this column.
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close at Wave 9**; carry the Wave 11 realization forward as a Wave 11
  migration obligation.

#### #7 — SQLite foreign-key creation versus pre-target DML behavior

- **Original Requirement:** `document.md` §10 item #7 (cross-dialect fact that Stage C must establish
  and Stage D must prove by test).
- **Existing Design:** `solution.md §36.5.2` — the design deliberately takes the option that depends
  on **no** DDL-tolerance assumption, so that the question has no runtime expression: "MySQL never
  sees a FK to a nonexistent parent, because no `REFERENCES` clause is emitted in Wave 9; SQLite never
  sees an unresolvable reference at DDL time, for the same reason."
- **Implementation evidence:** confirmed for both engines — no `REFERENCES` clause on
  `evaluation_result_id` in the SQLite DDL (`:120`) or the MySQL DDL (`:203`ff); the migration's
  `assertMySql` requires the FK set to equal the declared set exactly (`fks.length !== contract.fks.length`
  → drift), so an added forward FK would fail closed.
- **Test evidence:** the claim is structural and is asserted on real MySQL by the accepted 17/17
  execution of `server/mysql-sales-customer-wave9-credit.integration.js` (which runs the migration
  through the MySQL path); SQLite focused suite.
- **Current status:** **Closed by design construction.** The pre-target DML question was eliminated
  rather than answered by assumption. The separate upgrade-path equivalence obligation is tracked
  under #15.
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close** on the design-construction ground; retain the upgrade-path
  equivalence obligation under #15.

#### #8 — MySQL FK ordering and idempotent metadata convergence

- **Original Requirement:** `document.md` §10 item #8.
- **Existing Design:** `solution.md §36.5.3` (required ordering inside Wave 11) and `§36.5.5`
  (contract assertions I-1 … I-8, "must assert unconditionally after creating tables, so that
  `CREATE TABLE IF NOT EXISTS` cannot silently adopt a drifted pre-existing structure").
- **Implementation evidence:** migration `createIndexes` (`:129`ff) probes
  `information_schema.STATISTICS` on MySQL and only issues the `CREATE INDEX` when absent
  (probe-then-act convergence); `assertMySql` (`:247`) runs unconditionally after table creation
  (`:312`) and fails closed on column-order, PK, FK-target, CHECK-count or index-shape drift, with
  **no repair DDL**.
- **Test evidence:** executed on real MySQL in the accepted `server/mysql-sales-customer-wave9-credit.integration.js`
  run (17/17) and the accepted Wave 9 MySQL Integration 73/73.
- **Current status:** **Partially closed.** The Wave 9 metadata convergence and fail-closed assertion
  are implemented and executed. The **Wave 10 → Wave 11 FK ordering** obligation of `§36.5.4`
  ("Wave 9 → 10 upgrade: 2 tables added; `credit_special_approval` FK target created before the
  referencing table") and `§36.5.5` I-6 cannot exist yet, because the Wave 10 tables do not exist.
- **Wave 10 blocking:** **Not blocking** for Wave 10 to start. It is a **Wave 10 implementation
  obligation**: Wave 10 must create the target before the referencing table and must append its own
  `§36.5.5`-style read-only assertions.
- **Minimal handling:** **Partially close**; carry the Wave 10/11 ordering and assertion obligation
  into the Wave 10 scope. Do not record this item as fully closed.

#### #9 — Stable Credit Anchor provisioning transaction boundary

- **Original Requirement:** `document.md` §10 item #9.
- **Existing Design:** `solution.md §36.4` — the integrated provisioning protocol (five steps:
  pure key derivation → INSERT with duplicate tolerance → **unconditional** re-read and
  `FOR UPDATE` → fail closed → continue), explicitly superseding the self-contradictory §29.21.1;
  "No partial business mutation — the anchor INSERT is in the same transaction as the business
  mutation".
- **Implementation evidence:** `server/modules/credit-anchor.js:72` `ensureCreditLockAnchor` —
  `:85` the MySQL-only ` FOR UPDATE` re-read (SQLite relies on `BEGIN IMMEDIATE` serialization),
  `:87` fail closed `CREDIT_ANCHOR_UNRESOLVABLE`, `:88` `CREDIT_ANCHOR_SHAPE_CONFLICT`. The
  transaction boundary is real: `server/modules/credit-profile.js:148` opens `transaction(db, () => …)`
  and the anchor provisioning (`:152`), overlap check (`:156`), profile insert (`:160`), rating insert
  (`:167`), audit and idempotency all execute inside that one transaction.
- **Test evidence:** `server/mysql-sales-customer-wave9-anchor-concurrency.integration.js` — accepted
  "MySQL Wave 9 Anchor 4/4 PASS" (`document.md` Wave 9 Final Acceptance §3), proving independent
  real-MySQL sessions, genuine same-key contention for both `CREDIT_OBJECT` and `POLICY_SCOPE`,
  deadlock classification, acknowledged rollback and one final logical row; plus
  `server/mysql-sales-customer-wave9-credit.integration.js` "anchor identity stays canonical and
  group-free on MySQL" (accepted 17/17).
- **Current status:** **Closed.**
- **Wave 10 blocking:** **Not blocking.** Wave 10 must provision anchors in the fixed
  `POLICY_SCOPE → AGGREGATE → SALESPERSON` order and must not add a second provisioning protocol.
- **Minimal handling:** **Close**; retain as a frozen Wave 9 contract and a Wave 10 composition
  constraint.

#### #10 — Credit Policy Snapshot fingerprint identity and uniqueness

- **Original Requirement:** `document.md` §10 item #10.
- **Existing Design:** `solution.md §36.2.5` (A-50, supersedes §29.21 fingerprint uniqueness) and
  `§36.3.4` step 6 (insert-only; existing rows read with no row lock) and `§36.3.4.3`.
- **Implementation evidence:** migration `:106` `snapshot_fingerprint TEXT NOT NULL`;
  `uq_credit_policy_snapshots_identity` UNIQUE(`credit_lock_anchor_id`,`business_date`,
  `snapshot_fingerprint`) at `:24`; the `credit_policy_snapshots` table at `:102` (SQLite) / `:192`
  (MySQL).
- **Test evidence:** metadata index-shape assertion executed on real MySQL in the accepted 17/17 run;
  SQLite focused suite. **No production writer of `credit_policy_snapshots` exists yet** — the
  snapshot writer belongs to the Wave 10 `evaluateCredit()` runtime (`§36.6.3` step 7).
- **Current status:** **Closed** for the identity/uniqueness contract. The **runtime writer** is a
  Wave 10 deliverable, not a Wave 9 defect.
- **Wave 10 blocking:** **Not blocking.**
- **Minimal handling:** **Close** the contract; record the writer as Wave 10 scope.

#### #11 — Canonical names: `credit_lock_anchors` and `credit_check_results`

- **Original Requirement:** `document.md` §10 item #11.
- **Existing Design:** `solution.md §36.2.1` (`credit_lock_anchors`, A-62, Wave 9) and `§36.2.7`
  (`credit_check_results`, A-54, **plural canonical**, Wave 10, supersedes §29.25.1).
- **Implementation evidence:** `credit_lock_anchors` **exists** — migration `:30` / `:146`, listed in
  `SALES_WAVE9_TABLES` (`:6`ff). `credit_check_results` **does not exist**: no
  `CREATE TABLE ... credit_check_results` and no `CREATE TABLE ... credit_special_approval` exists
  anywhere under `server/`, and no `evaluateCredit` symbol exists in any server module. The Wave 10
  runtime is therefore absent, exactly as the Gate A M-board records.
- **Test evidence:** Wave 9 accepted evidence covers `credit_lock_anchors` only. No Wave 10 table
  evidence exists and none can exist before Wave 10 implementation.
- **Current status:** **Partially closed.** The *naming* question is closed by Design for both names
  (`credit_lock_anchors` shipped; `credit_check_results` plural canonical is fixed for Wave 10). The
  Wave 10 table itself is not implemented.
- **Wave 10 blocking:** **Not blocking.** This is a **Wave 10 deliverable**, not a Wave 10
  precondition.
- **Minimal handling:** **Partially close** the naming question; carry the table creation as Wave 10
  scope. Do not record the Wave 10 table as existing.

#### #12 — Credit Profile rating canonical write owner

- **Original Requirement:** `document.md` §34.3 SC89 (rating provenance) and `§14` (Wave 9
  authorization); register §10 #12.
- **Existing Design:** `solution.md §36.7.1` — "`credit_profile_ratings` is the SOLE canonical owner
  of applied rating state; `credit_profile.rating_grade` / `rating_effective_from` /
  `rating_effective_to` are a DERIVED READ PROJECTION … maintained inside the same transaction as the
  rating application, and never written independently"; `§36.7.2` rating application flow (SC107,
  Wave 11).
- **Implementation evidence:** `server/modules/credit-profile.js:167` writes the
  `INITIAL_ASSIGNED` rating row and `:160` writes the inline projection columns, both inside the
  single `transaction(db, …)` opened at `:148`; the migration CHECK at `:124` enforces the
  `INITIAL_ASSIGNED` / `evaluation_result_id IS NULL` pairing. No second rating writer exists.
- **Test evidence:** `server/mysql-sales-customer-wave9-credit.integration.js` — "SC89 initial rating
  provenance is recorded and rating evidence is append-only on MySQL" (accepted 17/17); SQLite
  focused suite.
- **Current status:** **Closed for the Wave 9 `INITIAL_ASSIGNED` path.** The **`EVALUATED`** rating
  application path is SC107, a Wave 11 capability, and does not exist yet.
- **Wave 10 blocking:** **Not blocking.** Wave 10 must not create a second rating writer; the Credit
  Special Approval workflow (`§36.6.6`) must not write rating rows.
- **Minimal handling:** **Close** for Wave 9; carry the `EVALUATED` path forward as a Wave 11
  obligation.

#### #13 — R-SAL-12 / R-SAL-24 infrastructure versus full business-race timing

- **Original Requirement:** `document.md` §10 item #13.
- **Existing Design:** `solution.md §36.8.2` (Wave 9 infrastructure fixtures W9-R1…W9-R7, and the
  explicit limit "R-SAL-24 is **infrastructure-level only** at Wave 9. No Wave 9 fixture may claim
  full R-SAL-24 verification."); `§36.8.3` (Wave 10 full business races W10-R1…W10-R12); `§37.10`
  (M9–M12, M15 and M19-Credit are Wave 10 only and "must be reported as BLOCKED, never as PASS").
- **Implementation evidence:** the Wave 9 infrastructure half exists — `ensureCreditLockAnchor`
  (`server/modules/credit-anchor.js:72`) takes exactly one anchor row `FOR UPDATE` and no other
  Credit lock. The full business-race half cannot exist: `credit_check_results` and
  `credit_special_approval` do not exist and `evaluateCredit` does not exist.
- **Test evidence:** the accepted Wave 9 evidence covers the infrastructure half only —
  "MySQL Wave 9 Credit 17/17 PASS", "MySQL Concurrency 106/106 including Wave 9 Anchor 4/4".
  **No Wave 10 full business-race evidence exists.**
- **Current status:** **Open by design, and correctly split.** Wave 9 covered the infrastructure half
  within its stated limit; the full business-race half is an explicit Wave 10 obligation and, for
  Credit integration, a Gate B obligation.
- **Wave 10 blocking:** **Not a precondition** — it is the **core Wave 10 acceptance obligation**
  (W10-R1…W10-R12) and the downstream Gate B obligation (B-M9, B-M10, B-M11, B-M12, B-M15, B-M19C).
- **Minimal handling:** **Keep open** as a Wave 10 implementation + Gate B acceptance obligation. Do
  not mark PASS; do not let the Wave 9 infrastructure evidence stand in for it.

#### #14 — Read-only legacy inventory and conditional bootstrap

- **Original Requirement:** `document.md` §10 item #14 and the `LEGACY_DATA_EVIDENCE_PENDING`
  classification (`document.md` Stage B §1 classification table; §5 applicability; §9.1 closing note
  that it "remains open by design").
- **Existing Design:** `solution.md §36.5.6` — the legacy bootstrap is **CONDITIONAL** and blocked
  behind `LEGACY_DATA_EVIDENCE_PENDING`: Wave 9 "create the new `credit_profile` table empty; do NOT
  backfill; do NOT invent Credit Profile records; do NOT fabricate historical credit limits or
  ratings; do NOT silently resolve ambiguous legacy identity; do NOT claim historical compatibility".
- **Implementation evidence:** `server/migrations/sales-customer-wave9-credit-foundation.js` contains
  **no** `INSERT INTO credit_profile` — the table is created empty. The safe default is implemented
  as designed.
- **Test evidence:** **none exists, and none can exist without authorization.** No authorized
  read-only external inventory has been performed. `document.md` Wave 9 Final Acceptance §4 keeps
  `LEGACY_DATA_EVIDENCE_PENDING` open and unchanged, and no compatibility claim is made in either
  direction.
- **Current status:** **Open — `LEGACY_DATA_EVIDENCE_PENDING`.** The unresolved fact is preserved: the
  existence of a legacy `credit_profile` table carrying rows in an external environment is **unknown**
  and unproven in either direction. **It is not established that no legacy data exists**, and this
  record does not assert it.
- **Wave 10 blocking:** **Not blocking.** `§36.5.6` defines a safe default (empty table, no backfill),
  so Wave 10 neither depends on nor is endangered by the legacy inventory.
- **Minimal handling:** **Keep open** as an unresolved external-evidence dependency with a
  non-destructive compatibility boundary. Do not close it, do not reclassify it, and do not describe
  it as "verified that no legacy data exists".

#### #15 — SQLite / MySQL PK, UNIQUE, CHECK, FK and indexed-column type parity

- **Original Requirement:** `document.md` §10 item #15.
- **Existing Design:** `solution.md §36.5.4` (migration equivalence proof obligations) and `§36.5.5`
  (contract assertion requirement plus I-1…I-8).
- **Implementation evidence:** the migration implements per-table contract assertions for both
  engines — `assertSqlite` (`:226`) and `assertMySql` (`:247`), invoked unconditionally after table
  creation (`:312`). `assertMySql` covers column identity/order, PK column order, FK set with
  referenced table and column, CHECK count, index shape (column order and uniqueness), the I-5
  nullability parity (`credit_profile.salesperson_scope_key` `NO`; `credit_profile.salesperson_id`
  and `credit_profile_ratings.evaluation_result_id` `YES`) and a bounded physical-type parity set
  (`credit_lock_anchors.anchor_key` `varchar(512)`;
  `credit_profile_ratings.evaluation_result_id` `varchar(128)`;
  `credit_check_rules.result_payload_json` `json`; `credit_policy_snapshots.notes_json` `json`).
- **Test evidence:** the assertions execute on real MySQL as part of the accepted
  `server/mysql-sales-customer-wave9-credit.integration.js` run (17/17) and the accepted Wave 9
  MySQL Integration 73/73.
- **Current status:** **Partially closed — evidence incomplete.** The per-table metadata contract is
  implemented and executed on a real MySQL, but three `§36.5.4` / `§36.5.5` obligations are **not
  evidenced**:
  - **I-3 (explicit orphan check after bootstrap and after every live upgrade, executed with
    `FOREIGN_KEY_CHECKS` restored)** — no orphan-check query exists in the Wave 9 migration or in the
    Wave 9 MySQL integration test.
  - **I-4 (row preservation across replay and each upgrade path)** — no row-count snapshot comparison
    exists for the six Wave 9 tables; and there is **no dedicated Wave 9 migration / upgrade-path
    test file**, unlike the equivalent Wave 2 / Wave 6 / Wave 7 migration tests.
  - **I-6 (forward-FK convergence after Wave 11)** — future by construction; Wave 11 does not exist.
  The physical-type parity assertion also covers only four named columns, not every column type of
  the six tables.
- **Wave 10 blocking:** **Not blocking** for Wave 10 to start. It is a **cross-database evidence
  obligation** that must be discharged by a protected MySQL gate; the SQLite-only evidence must not
  be presented as real MySQL verification, and the Gate A MySQL evidence must not be presented as
  Wave 9 Credit Foundation MySQL evidence.
- **Minimal handling:** **Partially close**; record exactly which real evidence is missing, when it
  must be produced and which protected gate must produce it. Do not describe this item as
  cross-database verified.

### 5. Bounded document-state contradiction corrections

| # | Contradiction | Verified finding | Correction applied in this stage |
|---|---|---|---|
| 1 | `document.md` / `solution.md` wording that describes Wave 10 as still blocked by Gate B | **No such current-state wording exists.** The canonical direction is already correct: `solution.md §37.18`, `§37.26`, `§37.33.3` and the Gate A Freeze Record §4 all state that Gate B is a downstream obligation and never a prerequisite. `document.md` contains no line asserting the reverse. | No historical text rewritten. §2 of this record states the canonical direction explicitly and confirms it against the existing authority. |
| 2 | `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` mechanically restated as an unmet current condition | **The label's own defining condition is met.** `§37.18.1` / `§37.26` define it as "satisfied only by Gate A plus explicit user Final Acceptance"; both occurred on 2026-10-24. | §3 of this record states the current status as satisfied, keeps the label as a historical identifier, and preserves every dated historical statement as history rather than rewriting it. |
| 3 | #1–#15 uniformly recorded as OPEN against later Stage C Design, Wave 9 implementation, SQLite and MySQL evidence and the Gate A freeze | **The uniform-OPEN statement is stale for current status.** 10 items are closed, 3 are partially closed with a precisely named residual, and 2 remain open by design. | §4 of this record adds the per-item closure evidence matrix. The original `§10` register text is preserved verbatim as the 2026-10-22 record. |
| 4 | `server/mysql-sales-customer-wave9-credit.integration.js:52` — `WAVE11_TABLES` contains the Wave 10 tables `credit_check_results` and `credit_special_approval` alongside the Wave 11 table `credit_evaluation_result` | **Confirmed.** The constant name is misleading; the three tables are used at `:239` only as a set of table names to locate `information_schema` rows. The name does not affect behaviour. | **Recorded only.** No source change is made in this stage. Renaming the constant (and any accompanying assertion text) is a bounded future implementation item that must not alter the set of tables inspected. |
| 5 | The Gate A M1–M25 board is a static array, while a future Gate B must be evidenced by real execution | **Confirmed.** `scripts/gates/mysql-sales-wave7-gate-a.mjs:100`–`:107` is a hard-coded literal array of case/status pairs, already recorded as an open item in `solution.md §37.31.15` R3 ("Recorded, not fixed"). | **Recorded only.** The Gate A runner, its board and its frozen conclusions are not modified. The Design stage must require that Gate B use its own runner and generate its board from real execution evidence rather than a literal. |

### 6. Preserved unresolved evidence, real blockers and Wave 10 entry conditions

**Unresolved evidence that is preserved and must not be reported as closed:**

1. `LEGACY_DATA_EVIDENCE_PENDING` (#14) — no authorized read-only external inventory exists. The
   existence of legacy `credit_profile` rows remains unknown and unproven in either direction.
2. #15 — the `§36.5.4` upgrade-path equivalence obligations and `§36.5.5` I-3 (orphan check) and I-4
   (row preservation) are **not evidenced** for the six Wave 9 tables; no dedicated Wave 9
   migration/upgrade-path test file exists.
3. #8 — the Wave 10 → Wave 11 FK ordering and forward-FK convergence obligations cannot exist yet.
4. #13 — the Wave 10 full business races (W10-R1…W10-R12) and the Gate B Credit-integration cases
   (B-COMPOSE, B-M9, B-M10, B-M11, B-M12, B-M15, B-M19C) have **no** execution evidence.
5. #11 — `credit_check_results` and `credit_special_approval` do not exist; no `evaluateCredit`
   production path exists.
6. `solution.md §37.31.15` R1–R4 — recorded, not fixed; not closed by the Gate A freeze.
7. The remaining W7-C1 / W7-C2′ follow-up work, which the Gate A Freeze Record §4 explicitly does
   not declare complete.
8. The disclosed broad global administrative grant on the disposable test account, as recorded in
   `log/2026-10-24.md`.
9. The `WAVE11_TABLES` naming item (§5 #4) and the static Gate A M-board (§5 #5), both recorded as
   bounded future implementation items.

**Real conditions for entering Wave 10:**

- **Authorisation is the only precondition.** Per §2, the canonical dependency direction makes Gate B
  a downstream obligation, and per §3 the `WAVE10_BLOCKED_UNTIL_W7_C1_C2_ACCEPTANCE_PASS` condition
  is satisfied. No Gate B-0 exists. The gate that Wave 10 waits on is therefore the explicit user
  authorization to implement, not a further technical gate.
- **Wave 10 must not be pre-empted.** The Credit Check engine, `credit_check_results`,
  `credit_special_approval`, the Special Approval workflow and the SO Submit / Approve / Delivery
  Confirm integration belong to Wave 10 and must not be implemented earlier under another wave
  name, and must not be simulated by fixture-computed exposure.
- **Wave 10 inherits the frozen contracts.** Wave 9 (Credit Foundation), Wave 7 (Sales & Customer),
  the L0 transaction gate, the L1–L8 lock order, the Finance monetary authority, the effective
  retry semantics, the idempotency contract, the SQLite behaviour, the MySQL `READ COMMITTED`
  isolation and the frozen Gate A boundary all remain in force.

### 7. Boundary and status

This record is a Requirement reconciliation only. It modifies `document.md` and the append-only
`log/2026-10-24.md` only. It changes no production source, no test, no schema, no migration, no
`README.md`, no `package.json`, no permission, no lock order and no acceptance conclusion. It does
not reopen, modify or weaken the frozen Gate A record, its runner, its suite manifest, its suite
order, its strict TAP / fail-fast / cleanup rules, its target-identity guard, its named-lock release
contract or its M1–M25 board. It does not close any Requirement that this record does not itself
close, and it does not claim that any Gate, Wave or legacy-data question has been verified beyond
the evidence cited above.

No test, build, MySQL gate, migration, database query, database reset or destructive operation was
executed. No Git add, commit, push, pull, fetch, merge, rebase, reset, restore, clean, stash or tag
was performed. No release or deployment occurred. Wave 10 and Wave 11 remain unstarted.

**Status: `REQUIREMENT_RECONCILIATION_COMPLETE`.**

---

## Wave 10 B-9 / B-10 / S14 Bounded Requirement Amendment (2026-10-24)

### 1. Authorization and bounded reopen

The user explicitly approved the consecutive `AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION`
closure for Wave 10 B-9, B-10 and S14. This subsection records the Requirement phase only. It
does not declare Acceptance or Freeze and does not authorize MySQL, Gate B, Git write, release or
deployment.

The original Wave 9 Final Acceptance and Freeze Record remains authoritative historical evidence.
Only the B-9 Profile-status semantic is reopened, and only to apply the ACTIVE-only enforceability
rule below. Wave 9 schema, migration, anchor identity, policy versioning, rating provenance,
effective-date resolution and permission policy remain frozen. This bounded reopen is not
automatically re-frozen; focused compatibility evidence and explicit user Acceptance remain
required.

### 2. B-9 — O2 ACTIVE-only Credit Profile enforceability

- An effective `ACTIVE` Credit Profile is eligible for mandatory Credit Check. Its limit,
  applicable rule, effective date and authorization continue to determine PASS / WARNING / BLOCK.
- An effective `SUSPENDED` Profile cannot authorize a new controlled credit commitment. Mandatory
  Credit Check fails closed. Suspension is not an exemption and does not disable Credit Management.
- An effective `CLOSED` Profile cannot authorize a new controlled credit commitment. Mandatory
  Credit Check fails closed. Closing a Profile does not settle, cancel, erase or release an existing
  economic obligation.
- Historical Profile, Rating, Sales Order, Delivery, AR, settlement, approval and exposure facts
  remain intact. Eligibility is restored only by a valid effective `ACTIVE` Profile under the
  existing versioning contract.
- A missing required Profile retains `CREDIT_PROFILE_MISSING`. An effective but non-ACTIVE Profile
  is distinct and must fail with `CREDIT_PROFILE_NOT_ENFORCEABLE`. Ambiguous effective Profiles keep
  the existing fail-closed behavior.
- The resolver must not fall back to an earlier ACTIVE version when the currently effective version
  is `SUSPENDED` or `CLOSED`, and a mandatory salesperson sub-limit must not fall back to the
  aggregate Profile as a bypass.
- Special Approval is a bounded ceiling/scope exception only. It cannot override the non-ACTIVE
  status fence and cannot make a suspended or closed Profile ACTIVE.
- Historical exposure remains visible and derived from canonical facts. Refusing a new commitment
  must not delete or release old exposure.
- Exact replay of an already committed operation creates no new side effect. A new economic
  obligation is checked against the currently applicable Profile status.
- Existing explicit Credit Management disable/exemption behavior remains governed by the existing
  contract; Profile status creates no new exemption.

### 3. B-10 — O1 transition-based retention; no age expiry

An unresolved approved Sales Order commitment remains in Credit Exposure until a canonical
business lifecycle transition removes or transfers its outstanding economic obligation. Elapsed
calendar time alone never releases it.

Consequences:

- no exposure-age parameter, expiry default, day-counting algorithm, TTL, scheduler or cleanup path;
- no automatic release of an old but valid undelivered commitment and no age-based removal of open AR;
- delivery, invoice, AR, collection, refund, credit adjustment, cancellation and closure follow
  their canonical business facts;
- cancellation or closure releases only the extinguished amount; any residual Delivery, AR or
  other outstanding obligation remains counted;
- business-date/as-of eligibility remains valid and separate from age expiry;
- `CREDIT_SUB_LIMIT_OVERDUE_DAYS` remains an overdue-AR policy and never becomes an SO commitment
  expiry control;
- overdue AR is a subset of AR open and is never an additional exposure bucket.

This subsection supersedes only the ambiguous "within exposure window" / "age <= window" wording
in `solution.md §29.23.1` and `§36.3.2`. Their historical text is preserved; the operative rule is
transition-based retention with no age expiry.

### 4. S14 — existing-contract remediation

Mode B (`INVOICE_DRIVEN_OPEN_ITEM`) and Mode C (`PROVISIONAL_TO_FINANCIAL`) invoice-sourced final AR
must use authoritative Finance source links and allocation evidence so that one outstanding
economic portion is counted exactly once across SO commitment, delivered/provisional exposure and
final AR.

This is an implementation defect against existing SC90–SC92, S14, `solution.md §29.23.2` and
`§36.3.2.2`; it is not a new business policy. The repair must consume canonical Finance ownership,
including `finance_invoice_source_links.invoiced_amount_cents`, and must not create a second Finance
allocation, Credit Exposure ledger or mutable exposure cache. A source-level amount or remaining-AR
allocation that cannot be proven from canonical facts must fail closed; it must never be guessed,
equally split or proportionally fabricated.

### 5. Recognition Mode rule-coverage boundary

- A rule with `recognition_mode IS NULL` is globally applicable for its stage and effective date.
- A mode-specific rule applies only to its matching Recognition Mode.
- Multiple applicable rules retain the existing strongest-outcome evaluation.
- Credit Management disabled retains the existing explicit bypass.
- When Credit Management is enabled but no effective rule applies to the actual mode, the existing
  Wave 10 contract treats the stage as not credit-controlled: `enforced=false`, no decision row and
  no audit row. A rule for another mode must not be silently promoted to a global rule.
- An applicable mandatory BLOCK rule remains backend fail-closed. WARNING and bounded Special
  Approval retain their existing semantics, subject to the new non-ACTIVE Profile fence.
- The current physical rule model has no explicit customer/scenario exemption discriminator even
  though `solution.md §29.22.1` names explicit exemption as a possible bypass. This is recorded as
  an OPEN contract-to-model gap. This bounded amendment does not invent an exemption, permission,
  default rule or unconditional enforcement policy.

### 6. Requirement decision record

```text
B9_O2_REQUIREMENT_APPROVED
B10_O1_REQUIREMENT_APPROVED
S14_EXISTING_CONTRACT_REMEDIATION_AUTHORIZED
RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
WAVE10_FINAL_ACCEPTANCE_NOT_DECLARED
```

## Wave 10 MySQL Acceptance Infrastructure Remediation Requirement (2026-10-25)

### 1. Authorization, source and bounded status

The user explicitly authorized one consecutive `AUDIT -> REQUIREMENT -> DESIGN` documentation
stage for the Wave 10 MySQL Acceptance Infrastructure remediation. This section records the
Requirement phase only. The immediately following Design phase may proceed without an intervening
approval, but Design completion is a mandatory HARD STOP. Production code, tests, fixtures,
runners, workers, manifests, TAP parsing, package scripts, MySQL access, destructive database
operations and Git writes are not authorized by this stage.

The current source audit reconciled findings `W10-AUD-001` through `W10-AUD-009`. Findings 001,
002, 003, 004, 005, 007, 008 and 009 are `CONFIRMED`. Finding 006 is
`PARTIALLY_CONFIRMED`: the current fixture does not exercise the formal Wave 9 physical upgrade
path or compare actual source and target schema signatures, but its dynamic foreign-key edge
enumeration and value-by-value preservation of its synthetic six-table graph remain valid local
test intentions. No finding is treated as real-MySQL execution evidence.

This remediation does not alter the approved Wave 10 business meaning. It specifies the evidence
infrastructure required before a separately authorized real-MySQL campaign may be requested.

### 2. W10-AIR-R01 — Evidence authenticity and M-board identity

Each fixed Gate B case has exactly one case identity, one primary evidence level, one executable
case owner and one marker emission point. A marker is emitted only after that exact case's
preconditions, production or raw action, persistent postconditions and cleanup obligations have
passed in the current process run.

- `B-COMPOSE` is `STATIC_INTENT`; it proves static composition only and makes no runtime lock or
  business-outcome claim.
- `B-M9`, `B-M10`, `B-M11`, `B-M12`, `B-M15` and `B-M19C` require
  `PRODUCTION_SERIALIZED_OUTCOME` as their primary M-board evidence. A separate raw diagnostic may
  supplement a case, but cannot produce or replace its production marker.
- `B-M15` must prove the real empty-parent, two-salesperson aggregate-capacity business result;
  observing one anchor row wait is insufficient.
- Source text, function names, constant arithmetic, a different R-case, historical logs, SQLite
  output and a prewritten PASS list cannot produce a production marker.
- Missing, duplicate, extra, out-of-order ownership, wrong-level or cross-case marker reuse fails
  the Gate B runner. A failed TAP suite, child-process failure, unconfirmed child termination,
  cleanup failure or missing final-zero confirmation suppresses the M-board entirely.

### 3. W10-AIR-R02 — Destructive-target identity and inventory safety

Before the first destructive statement, the runner must establish one immutable campaign identity
from both approved configuration and the connected server:

1. exact password-free `mysql://user@host:port/database` authorization;
2. exact configured host, port, database and user;
3. actual `SELECT DATABASE()` result;
4. actual `CURRENT_USER()` result;
5. actual server UUID and MySQL 8 version policy;
6. a normalized effective-grant fingerprint and the required bounded schema privileges;
7. an initial object inventory covering tables, views, triggers, routines and events.

The UUID, actual account and grant fingerprint are future preflight outputs requiring separate
authorization; they must never be guessed or committed as unverified constants. The first campaign
run uses `EMPTY_ONLY`: a non-empty initial inventory fails before DROP and requires a separately
authorized recovery decision. Once an empty target and full identity have been confirmed, the
runner may hold an in-memory campaign lease for objects created by that run. Every per-suite reset
and final cleanup must revalidate database, actual account, UUID and version before acting.
Identity drift revokes the lease and fails closed without destructive action.

Passwords, raw grants, full environment dumps, SQL payloads and connection secrets must not appear
in errors, TAP or M-board output. Reports may include only the password-free target identity,
server-UUID digest or approved bounded form, version, account identity, grant digest and inventory
counts.

### 4. W10-AIR-R03 — Bounded child lifecycle and cleanup

Every suite has an explicit wall-clock deadline. Timeout enters `CHILD_TIMEOUT`; the runner must
request graceful termination of the suite process and its workers, wait for bounded exit
confirmation, escalate to a platform-safe process-tree termination, and again wait for bounded
confirmation. Fixed sleeps are not exit evidence.

If termination is confirmed, suite failure proceeds to final cleanup. If termination cannot be
confirmed, cleanup must not race a possibly live database client: the run fails non-zero with
cleanup recorded as `NOT_ATTEMPTED_CHILD_LIVE`. All ordinary suite failures, non-zero exits, spawn
errors, malformed TAP, marker failures and runner exceptions with no live child enter final
cleanup. Identity failure before a destructive lease performs no cleanup. Cleanup identity drift,
reset failure, zero-object failure or adapter-close failure is terminal and prevents PASS.

### 5. W10-AIR-R04 — Deterministic independent-session business races

W10-R1 through W10-R12 must use distinct MySQL connections and the real production handlers or
services named by the approved contract. `Promise.all` alone is not a concurrency barrier. Each
case must provide a deterministic coordinator and, where needed, an observer connection:

- both contenders register distinct `CONNECTION_ID()` values and announce READY;
- a coordinator holds the existing L0 transaction gate or the case's approved raw coordination
  row so both production calls are demonstrably pending before release;
- `performance_schema` observation, bounded query-state observation or another exact server fact
  proves the required wait; inability to observe required evidence fails rather than sleeps to
  PASS;
- raw coordination never becomes the production business result;
- both transaction outcomes, authoritative final rows, amounts, audits and idempotency records are
  asserted after all sessions settle.

The required case meanings remain those in `solution.md §36.8.3`: R1 covers BOTH_FIT and
ONLY_ONE_FITS Credit Checks; R2 allows exactly one effective Special/standard authority, not zero;
R3 proves an exact OLD-or-NEW exposure and no transition double-count; R4 and R8 prove coherent
version sets; R7 races a different-scope approval against a mandatory sub-limit refusal; R9 uses a
real final unpaid AR reached from an SO transition; R10 uses consolidated or otherwise
source-unprovable AR and returns `UNPROVEN_ATTRIBUTION`; R11 proves Finance-parent-first completion
without a cycle; R12 uses N independent production checks and separately proves that reuse of an
existing immutable snapshot takes no snapshot-row lock.

### 6. W10-AIR-R05 — Authoritative capacity preconditions

Every capacity race must calculate its classification from committed authoritative facts before
release of the race barrier. It reads the applicable effective Profile limit, canonical
recognition-mode-aware exposure `E`, business date, scope, cents unit and each proposed delta, then
derives `available = limit - E`.

The fixture records and asserts exactly one of:

```text
BOTH_FIT      da <= available AND db <= available AND da + db <= available
ONLY_ONE_FITS da <= available AND db <= available AND da + db >  available
NEITHER_FITS  da >  available AND db >  available
```

The expected winner count follows that computed classification. A constant copied from seed input
is not proof. NULL/unbounded limits, currency mismatch, unsafe integers, ambiguous attribution or
a precondition that changes before the coordinated start make the fixture explicitly
unconstructible or fail closed; they cannot be converted into PASS.

### 7. W10-AIR-R06 — Formal migration, parity, upgrade and preservation

Fresh initialization must use the production `createDatabase()` MySQL bootstrap path. The upgrade
fixture must begin from an actual canonical SQLite snapshot whose Sales & Customer registry is
bounded through Wave 9, materialize that snapshot through the production MySQL bootstrap, and then
invoke the canonical ordered migration registry through Wave 10. Creating the final schema and
dropping two tables is not an upgrade fixture.

For all six Wave 9 tables, parity compares normalized metadata captured from the actual canonical
SQLite Wave 9 source schema with actual MySQL `information_schema`: complete ordered columns,
logical type mapping, nullability, defaults, primary keys, foreign keys, checks and indexes where
the cross-dialect contract applies. Handwritten type strings may be diagnostic expectations but
cannot be the source side.

The suite must prove:

- fresh bootstrap and Wave 9->10 upgrade produce equivalent normalized metadata for the eight
  Credit tables;
- repeated formal initialization and repeated registry upgrade are idempotent;
- I-4 compares complete pre/post values for a non-empty, referentially connected six-table Wave 9
  graph, including nullable and boundary-value variants, not row counts alone;
- I-3 dynamically enumerates every actual FK edge of the eight tables and finds zero orphans;
- every difference is reported and cleanup remains subject to R02/R03.

`LEGACY_DATA_EVIDENCE_PENDING` remains open. Synthetic fixtures never prove the state of an
external historical database.

### 8. W10-AIR-R07 — Case-complete zero-side-effect projections

Each rejection, loser, rollback and replay case declares its projection before execution and
compares it afterward by stable identity, business status, monetary fields, version/fingerprint and
relationships, not total row count alone. The union includes, where the case can touch them:

- `credit_check_results`, `credit_special_approval`, `credit_policy_snapshots` and Profile/rule/
  parameter version facts;
- `sales_prepayment_requirements`, `sales_prepayment_gate_results` and eligible Finance parent
  balances;
- `sales_orders`, order items and applicable delivery/invoice source facts;
- `account_receivables`, settlement/application facts and `finance_invoice_source_links`;
- relevant `audit_logs` and `idempotency_records` rows, including operation keys and stored result;
- every other table written by the exact production entrypoint under test.

A required table or column that cannot be queried is a fixture failure. No necessary projection is
silently skipped. A winning transaction's expected effects are asserted separately from the
loser's zero-effect delta, and exact replay must create no second economic, audit or idempotency
effect.

### 9. W10-AIR-R08 — Real-MySQL business matrix

The protected Wave 10 campaign must include a separately named business-matrix suite covering:

- B-9 O2: effective ACTIVE allows evaluation; effective SUSPENDED and CLOSED return
  `CREDIT_PROFILE_NOT_ENFORCEABLE`; no fallback to an earlier ACTIVE version or aggregate bypass;
  Special Approval cannot cross the status fence; historical exposure remains intact.
- B-10 O1: an old unresolved approved SO and open AR remain exposed across arbitrary business-date
  distance; only proven lifecycle extinction/transition releases an amount; overdue AR is not an
  extra bucket.
- S14 Mode B/C: authoritative invoice-source links, partial invoice, partial settlement, multiple
  deliveries, multiple salespersons, exact single-source attribution, missing/inconsistent
  lineage and ambiguous remaining allocation. No proportional, FIFO, equal or residual guessing is
  allowed.
- Recognition Mode: global rule, exact-mode rule, nonmatching-only rule, no applicable rule,
  strongest applicable outcome and mandatory BLOCK rollback.

The explicit customer/scenario exemption selector remains
`RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN`. The matrix asserts that no selector or bypass
is fabricated; it does not implement or claim exemption support. SQLite evidence may remain useful
regression evidence but cannot close this MySQL matrix.

### 10. W10-AIR-R09 — Strict TAP, marker grammar and local behavior tests

Strict TAP acceptance requires one complete top-level plan, a valid end-of-stream, internally
consistent test records and summary counters, at least one test, `pass == tests`, and zero fail,
skip, cancelled or todo. Missing, duplicate, extra, illegal, truncated or contradictory records
fail even when the child exit code is zero. A non-zero exit always fails.

The runner orchestration, target verifier, process lifecycle, TAP parser and M-board reducer must
be testable without a database through injected adapters/processes/clocks or pure state reducers.
Local behavioral tests must cover guard refusal, identity mismatch, non-zero exit, hang and both
termination outcomes, malformed/incomplete TAP, cleanup failure, final-zero failure, every marker
cardinality/level error, suppression of PASS and Gate A/legacy execution-graph isolation. Source
regex checks may supplement but cannot replace these tests.

### 11. W10-AIR-R10 — Freeze, compatibility and authorization boundary

- Gate A remains frozen and is neither imported nor executed by either Wave 10 runner.
- Wave 9 schema, business semantics and freeze history remain unchanged. Wave 9 participation is
  limited to a test-only physical snapshot and compatibility verification required by R06.
- L0, L1-L8, READ COMMITTED, Finance monetary authority, permissions, status, idempotency and
  production transaction semantics are unchanged.
- No shadow ledger, mutable exposure cache, new business feature, Wave 11/12 implementation or
  schema correction may be introduced to make a test pass.
- Real MySQL suites remain outside unconditional FAST/FULL/HEAVY and are reachable only through
  explicit protected commands after separate exact-target authorization.
- Passing local remediation tests authorizes neither MySQL execution nor Acceptance/Freeze.

### 12. Requirement acceptance and OPEN facts

The future Implementation is Requirement-complete only when every `W10-AIR-R01` through
`W10-AIR-R10` mapping has executable tests and no lower evidence class is promoted. The following
facts remain OPEN until their separately authorized phases:

```text
OPEN  actual server UUID, CURRENT_USER and effective-grant fingerprint
OPEN  actual initial object inventory at the future campaign target
OPEN  all real-MySQL migration, race, lock, rollback, cleanup and M-board results
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
```

**Requirement status: `WAVE10_MYSQL_ACCEPTANCE_REMEDIATION_REQUIREMENT_COMPLETE`.**

## Wave 10 MySQL least-privilege readiness and Finance View parity requirement (2026-10-25)

### Authorization, scope and audited gap

The user authorized one consecutive Audit → Requirement → Design → Implementation → local
verification → dedicated-account remediation → read-only preflight sequence, with the hard stop
immediately before any real MySQL Acceptance campaign. The existing Guard is `PARTIAL`: it omits
`TRIGGER` and can admit global DML, dynamic administration, grant delegation or inherited roles.
MySQL initialization is `SEMANTIC_MISMATCH`: unlike SQLite, it does not install the canonical
`finance_open_item_effects` derived View because the SQLite snapshot contains tables only.

### W10-LPR-R01 — exact dedicated-account contract

The campaign account is exactly `modern_erp_wave10@127.0.0.1`, connected only to
`modern_erp_domain_test`. Its target-schema privileges are exactly `SELECT`, `INSERT`, `UPDATE`,
`DELETE`, `CREATE`, `DROP`, `ALTER`, `INDEX`, `REFERENCES`, `TRIGGER` and `CREATE VIEW`. Its only
privileges outside that schema are table-scoped `SELECT` on
`performance_schema.data_locks`, `performance_schema.data_lock_waits` and
`performance_schema.threads`. `USAGE ON *.*` is the sole permitted global grant.

Every other privilege is forbidden, including global DML/DDL, `ALL PRIVILEGES`, `PROCESS`,
`SUPER`, `FILE`, `SHUTDOWN`, reload, account/role/replication administration, every dynamic
administrative privilege, routine/event authority, unrelated-schema authority and `WITH GRANT
OPTION`. No role may be granted, active or default. A global privilege never substitutes for an
explicit target-schema privilege.

### W10-LPR-R02 — fail-closed identity and fingerprint

Before a campaign lease or destructive lifecycle action, the Guard must verify in order: exact
configured host/port/database/user; `DATABASE()`; exact `CURRENT_USER()`; approved server UUID;
MySQL 8 version policy; normalized effective `SHOW GRANTS` fingerprint; the exact privilege and
no-role contract above; and the approved initial five-category object inventory. Missing,
additional, inherited, differently scoped or delegated authority fails closed before mutation.
The trusted grant fingerprint is supplied independently; current grants must never be learned or
promoted automatically as trusted.

### W10-LPR-R03 — canonical Finance View parity

`server/modules/finance-open-item-effect-view.js` remains the single canonical definition of
`finance_open_item_effects`. Fresh SQLite and MySQL initialization, repeated initialization and an
existing-schema upgrade must all leave exactly that derived View available after its dependency
tables exist. Initialization is idempotent, corrects a stale prior View definition, never creates a
materialized/shadow table, and fails closed on dependency or DDL error. Inventory and cleanup must
continue to classify and remove it as a View before base tables. Cross-backend projection semantics
and Finance monetary authority are unchanged.

### W10-LPR-R04 — evidence and boundaries

Local behavior tests must prove: the valid exact grant set; every missing required schema
privilege; global static or dynamic excess; grant delegation; role inheritance/default role;
schema/account/database/UUID/version/fingerprint mismatch; inventory refusal; View first install,
repeat, stale-definition upgrade, canonical definition and dependencies; cleanup View ordering;
and zero Gate A change. Syntax, focused suites, related Wave 9/10/Finance tests, FAST, FULL, build
and `git diff --check` are required with MySQL/destructive environment removed.

This requirement authorizes no Gate A edit or execution, Gate B, Acceptance, target-schema
bootstrap/reset/migration/DDL/DML/cleanup, unrelated account/schema change, Git write, Wave 11 or
Wave 12 work. The only permitted external mutation after local verification is creation or exact
grant remediation of the confirmed-dedicated account named in R01, followed solely by read-only
preflight. Real MySQL Acceptance remains separately authorized.

**Requirement status: `WAVE10_MYSQL_LEAST_PRIVILEGE_AND_VIEW_PARITY_REQUIREMENT_APPROVED_BY_CONSECUTIVE_AUTHORIZATION`.**

## Wave 10 Gate B OQC quality-policy fixture Requirement (2026-10-26)

### 1. Authorization, scope and audited gap

The user explicitly authorized one consecutive `AUDIT -> REQUIREMENT -> DESIGN` stage for the Wave 10
Gate B OQC fixture gap, with a mandatory HARD STOP at the end of Design. This section records the
Requirement phase only. The immediately following Design phase may proceed without an intervening
approval. Implementation, real MySQL access, Gate A, Gate B, the Wave 10 Acceptance campaign,
destructive database operations, production quality-gate semantics and Git writes are **not**
authorized by this stage.

Audited gap classification — `PARTIAL` against the canonical production chain, `MISSING` against the
Wave 10 acceptance fixture:

- `PARTIAL` — the canonical Sales Delivery quality-gate chain is fully implemented in production, but
  the Wave 10 acceptance fixture installs no quality-policy fact of any kind, so the chain cannot be
  traversed by the acceptance suites.
- `MISSING` — the Wave 10 acceptance fixture has no means to reach the canonical Delivery CONFIRM
  transition through the real production HTTP route.

**This is not a production defect.** The HTTP 409 refusal observed in the Gate B run is the correct
production behaviour of the fail-safe default. No production defect and no new cross-domain
Requirement was discovered; the gap is confined to acceptance-fixture infrastructure.

### 2. Audit facts this Requirement is bound to

Each fact below was verified against the actual source at HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6`.

- **A1** — `server/app.js:5658`: `createSalesDelivery()` calls
  `configureTrackedDraftLines({ sourceType: 'SALES_DELIVERY', sourceId: deliveryId, itemTable:
  'sales_delivery_items', foreignKey: 'delivery_id', rawItems: items, businessDate: deliveryDate })`
  inside the Delivery-creation transaction.
- **A2** — `server/app.js:4190-4199`: `configureTrackedDraftLines()` calls `freezeQualityPolicy()`
  exactly once per persisted Delivery line.
- **A3** — `server/modules/traceability-quality.js:418-434`: `resolveQualityPolicy()` selects the
  applicable Quality Control Point. With no applicable control point, `SALES_DELIVERY` resolves to
  `{ qcpId: null, version: null, inspectionRequired: true, samplingMode: 'FULL', samplingValue: null,
  failSafe: true }`. The only default waiver in the codebase is `OUTSOURCING_RECEIPT` (OUT-18), which
  does not apply to Sales Delivery.
- **A4** — `server/modules/traceability-quality.js:436-443`: `freezeQualityPolicy()` writes
  `logistics_quality_policy_snapshots` with `inspection_required = 1`, `qcp_id = NULL` and
  `waiver_reason = NULL` in that case.
- **A5** — `server/app.js:5843`: `confirmSalesDelivery()` calls `assertQualityGate(db, 'OQC',
  deliveryId)` on the confirmation path, before the inventory, COGS and Finance recognition writes.
- **A6** — `server/modules/quality-gates.js:191-238`: `deriveQualityState()` reads
  `qualityPolicyAllowsPosting()`; with a required policy and no matching `oqc_inspections` row the
  state is `NOT_INSPECTED` (`未检验`), and `assertQualityGate()` raises HTTP 409
  `物流单据质量门禁未通过：未检验`. The refusal label is the production fallback of
  `assertQualityGate()`: the per-source label `销售出库单` is declared on
  `config.OQC.sourceTypes.SALES_DELIVERY`, while the label resolution reads
  `config[kind].shared.sourceTypes`, so the resolved label is `物流单据`. The refusal text is
  therefore asserted against the message the production gate actually raises, not against a
  hand-written label. See solution.md §37.46.11.
- **A7** — `server/test-utils/wave10-mysql-acceptance-fixture.js`: the Wave 10 acceptance fixture
  contains **no** `quality_control_points`, **no** `logistics_quality_policy_snapshots` and **no**
  `oqc_inspections` fact of any kind.
- **A8** — `server/migrations/v13-phase6b-traceability-quality.js:216-221`: the shipped default
  control points are inserted only when a `user-admin` row exists. The protected Wave 10 MySQL target
  is initialized in production mode, so the demo seed does not run, `user-admin` does not exist and
  `quality_control_points` is empty on that target. Even where the default row does exist it carries
  `inspection_required = 1` and would produce the same refusal.
- **A9** — `server/mysql-sales-customer-batch-a-concurrency.integration.js:169-171`: the Batch A
  concurrency fixture writes a `logistics_quality_policy_snapshots` row **by hand** with
  `qcp_id = NULL`, `qcp_version = NULL` and `waiver_reason = 'CONCURRENCY_FIXTURE'`. That row
  corresponds to no Quality Control Point and records no resolution. It is not acceptable evidence
  under this Requirement.
- **A10** — `server/test-utils/wave10-mysql-acceptance-fixture.js:278-298`: the fixture already
  installs the fail-closed Wave 1 `sales_parameters` SYSTEM row through the canonical writer
  `upsertSalesParameters()`, for exactly the same reason — a production prerequisite must be present
  as a real configuration fact rather than invented behind the writer. A Quality Control Point is the
  same class of prerequisite.
- **A11** — `server/mysql-sales-customer-wave10-business-matrix.integration.js:104-126`: the
  `W10-BUSINESS-MATRIX` suite of the Wave 10 Acceptance campaign creates **and confirms** Sales
  Deliveries through the same real production HTTP route and the same shared fixture base. It is
  exposed to the same refusal and is therefore in scope of this Requirement, not only the Gate B
  production-races suite.

### 3. W10-QCP-R01 — Production quality-gate semantics are unchanged

- The canonical Sales Delivery **continues to enforce OQC**. `assertQualityGate(db, 'OQC',
  deliveryId)` remains on the confirmation path with unchanged behaviour, ordering, status set and
  error contract.
- **Missing policy evidence remains fail-safe `BLOCKED`.** The absence of an applicable Quality
  Control Point, the absence of a frozen policy snapshot, or a snapshot that requires inspection
  without a matching OQC inspection must continue to refuse the confirmation.
- **No production default changes.** The `SALES_DELIVERY` fail-safe default, the
  `OUTSOURCING_RECEIPT` default waiver (OUT-18), `resolveQualityPolicy()`, `freezeQualityPolicy()`,
  `qualityPolicyAllowsPosting()`, `deriveQualityState()` and `assertQualityGate()` are unchanged.
- **No outsourcing quality policy change.**
- No production quality-control-point default, seed, migration or schema change is introduced.

### 4. W10-QCP-R02 — The fixture establishes valid, auditable test quality-policy facts

- The Wave 10 acceptance fixture must install its quality-policy prerequisite through the **canonical
  quality-control-point writer**, not by hand-writing a policy snapshot row.
- The installed fact must be a real Quality Control Point carrying an operation type of
  `SALES_DELIVERY`, an effective-from date, an effective-to date or its absence, an active flag, a
  sampling mode, a version and a written reason.
- The fact must be **auditable**: the creation must leave a canonical audit record, and the frozen
  per-line policy snapshot must carry the Quality Control Point identity and version that produced
  it.
- The fact must be **test-scoped**: it applies to the Wave 10 acceptance fixture's own scope only and
  must not alter production defaults, other products or other operation types.
- A hand-written `logistics_quality_policy_snapshots` row that references no Quality Control Point
  (A9) is not acceptable fixture evidence.

### 5. W10-QCP-R03 — Waiver justification and evidence identity

- A waiver (inspection not required) requires a **legitimate test-only business reason** written into
  the Quality Control Point. The reason must state that the Wave 10 acceptance cases exercise the
  Sales Delivery → Finance → Credit chain and that outgoing-goods inspection is outside the subject
  of those cases. It must **not** claim that an inspection was performed or that a product passed
  inspection.
- The frozen policy snapshot produced by the canonical path must **match the actual business facts**
  of the document it belongs to: the actual Delivery header id, the actual Delivery line id, the
  actual product id, the Delivery's effective business date, and the Quality Control Point id and
  version.
- The frozen snapshot must be produced by the canonical resolution at document creation. It must not
  be produced by deleting, rewriting or hand-crafting an already frozen snapshot.
- The waiver must be reachable only through the canonical resolution order, so that a more specific
  applicable control point continues to take precedence over a broader one.

### 6. W10-QCP-R04 — M-R03 and M-R09 keep their original Finance/Credit race semantics

- **M-R03 (`R-SAL-14`)** still races the canonical Sales Invoice posting against the Credit
  evaluation and still asserts the exact OLD-or-NEW exposure with no transition double count.
- **M-R09** still races two Credit evaluations against the canonical SO → Delivery → final unpaid AR
  transition and still asserts the mandatory salesperson sub-limit refusal carrying `OVER_LIMIT` and
  not `UNPROVEN_ATTRIBUTION`.
- The quality-policy arrangement changes nothing about the Finance or Credit facts: the recognition
  mode, the invoice, the receivable, the exposure projection, the capacity classification and the
  zero-side-effect projections remain exactly as they are today.
- The Delivery confirmation must still be performed through the **real HTTP confirmation route**.
  The fixture must not bypass, stub, monkey-patch, pre-empt or otherwise intercept the production
  confirmation handler or the production quality gate.

### 7. W10-QCP-R05 — Negative test: missing OQC evidence still blocks

A deterministic, database-local regression must prove both directions against the same fixture base:

- **Negative** — with no applicable quality-policy fact, a Delivery created through the real
  production route receives a frozen policy that requires inspection, and the real confirmation route
  refuses with the **production** HTTP 409 quality-gate refusal. The refusal must be the production
  refusal produced by `assertQualityGate()`, not a test-local message or a test-local status code.
- **Positive** — with the fixture's quality-policy fact installed, a Delivery created through the
  same real production route freezes a policy snapshot that requires no inspection and records the
  control-point identity and version, and the real confirmation route succeeds.
- The negative case must fail if the production fail-safe default is weakened, and it must be
  meaningful without requiring a real MySQL campaign.

### 8. W10-QCP-R06 — No schema, migration, credential or gate-shape change

- No MySQL schema change, no migration, no DDL, no new table and no new column. The existing
  `quality_control_points`, `quality_control_criteria` and `logistics_quality_policy_snapshots`
  structures are sufficient.
- No MySQL account, grant, role or credential change. The credential exposure recorded in
  `log/2026-10-26.md` remains **OPEN** and is an operator action outside this Requirement.
- No change to the protected target, the campaign lease, the guard, the runners, the manifests, the
  case identifiers, the evidence levels or the M-board shape.

### 9. Acceptance conditions

1. Facts A1–A11 remain true in the implementation.
2. The Wave 10 acceptance fixture installs its quality-policy prerequisite through the canonical
   writer and leaves a canonical audit fact.
3. Every Delivery created by the Wave 10 acceptance suites freezes a policy snapshot that references
   the installed control point, carries its version, and matches the actual Delivery id, Delivery
   line id, product id and business date.
4. The real Delivery confirmation route succeeds in M-R03 and M-R09, and the Finance/Credit
   assertions are unchanged.
5. The negative regression proves the production fail-safe refusal, and the positive regression
   proves the waived confirmation.
6. The SQLite and MySQL paths behave identically for the fixture base.
7. The local regression (`pnpm test:fast`, `pnpm test`, `pnpm build`, `git diff --check`) passes with
   no skipped, todo, cancelled or weakened assertion.

### 10. Compatibility boundary

Unchanged: production quality-gate semantics and defaults, the outsourcing quality policy, the
quality-control-point schema and migrations, the Sales Delivery creation and confirmation handlers,
the Credit and Finance business semantics, the L0 and L1–L8 lock order, READ COMMITTED isolation,
permissions, status machines, audit and idempotency contracts, the Gate A contract and its freeze,
the Wave 9 freeze, the seven Gate B case identities and evidence levels, the package version and the
release tags.

Open and unaffected by this Requirement: the MySQL credential exposure (`CREDENTIAL_EXPOSURE_OPEN`
for operator action); real-MySQL evidence (`TEST_EVIDENCE_PENDING` until a separately authorized
campaign); `LEGACY_DATA_EVIDENCE_PENDING`; `RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN`.

**Requirement status: `WAVE10_GATE_B_OQC_FIXTURE_REQUIREMENT_COMPLETE`.**

## Wave 10 M-R09 Credit capacity contract Requirement (2026-10-26)

### 1. Authorization, scope and the audited contradiction

The user confirmed that the M-R09 acceptance contract contains a verified contradiction and explicitly
authorized one consecutive `REQUIREMENT -> DESIGN` stage for it, with a mandatory HARD STOP at the end
of Design. This section records the Requirement phase only; the Design phase may follow without an
intervening approval. Implementation, real MySQL access, Gate B re-execution, the Wave 10 Acceptance
campaign, Git writes and Wave 11 are **not** authorized by this stage.

Audited classification — `SEMANTIC_MISMATCH` in the Wave 10 acceptance **test contract**
(`server/mysql-sales-customer-wave10-concurrency.integration.js`, case `M-R09`).

**This is not a production defect.** The production Credit engine computes the capacity, the
classification and the refusal exactly as the canonical contract requires. The defect is confined to
one expectation literal inside one acceptance assertion. It was latent until the approved
quality-policy fixture remediation made that assertion reachable for the first time.

### 2. Audit facts this Requirement is bound to

Each fact was verified against the actual source at HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6`.

- **A1** — `server/mysql-sales-customer-wave10-concurrency.integration.js:521` asserts
  `capacity.classification === 'ONLY_ONE_FITS'` for M-R09.
- **A2** — `server/test-utils/wave10-mysql-acceptance-fixture.js:647-655` `classifyCapacity()`:
  `BOTH_FIT` iff `da <= available AND db <= available AND da + db <= available`; `ONLY_ONE_FITS` iff
  `da <= available AND db <= available AND da + db > available`; `NEITHER_FITS` iff
  `da > available AND db > available`.
- **A3** — this file, `W10-AIR-R05` in the section "Wave 10 MySQL Acceptance Infrastructure
  Remediation Requirement (2026-10-25)", states the identical algebra verbatim and adds the rule
  *"The expected winner count follows that computed classification."*
- **A4** — the M-R09 race is configured with `salespersonLimit: 110000`
  (`...wave10-concurrency.integration.js:494`); the fixture seeds the salesperson Profile
  `w10-profile-a` with `credit_limit_cents = 110000`
  (`...wave10-mysql-acceptance-fixture.js:478`, `seedProfile()` at `:504-514`).
- **A5** — the canonical obligation is **100000 cents**: the fixture price-list version is
  `unit_price_cents = 100000` (`...wave10-mysql-acceptance-fixture.js:459-460`) and
  `productionOrderBody()` (`...wave10-mysql-acceptance-fixture.js:546-554`) requests quantity 1.
  Both proposed deltas are **20000 cents** (`...wave10-concurrency.integration.js:518`, `:525-526`).
- **A6** — after the canonical confirmation the obligation leaves the SO-commitment stage and the
  delivered-not-settled stage and is represented exactly once by the final unpaid AR
  (`server/modules/credit-check.js:453-456` stage conservation), and that AR is provably attributable
  to the salesperson (`resolveReceivableAttribution()` → `PROVABLY_ATTRIBUTABLE`,
  `server/modules/credit-check.js:378-379`), so it is not attribution-ambiguous.
- **A7** — therefore `exposureCents = 100000`, `available = 110000 - 100000 = 10000`, and both
  proposed deltas (20000) exceed `available`. `classifyCapacity()` returns **`NEITHER_FITS`**.
- **A8** — the two M-R09 classification assertions are mutually exclusive under **every** possible
  fixture value: `:521` (`ONLY_ONE_FITS`) requires `available >= 20000`, while `:522`
  (`exposureCents + 20000 > limitCents`, algebraically `available < 20000`) requires the opposite.
  The pair can never both hold.
- **A9** — M-R09's own refusal contract (`:529-534`) requires **both** contenders to return HTTP 409
  `CREDIT_CHECK_BLOCKED` carrying `OVER_LIMIT` and **not** `UNPROVEN_ATTRIBUTION`. The expected
  winner count is therefore 0, and under `W10-AIR-R05` only `NEITHER_FITS` has an expected winner
  count of 0.
- **A10** — the approved case matrix in `solution.md` §37.39.6.2 describes M-R09 as
  *"aggregate passes; sub-limit exposure=50, proposal=70>60 and blocks"*. The case never claims a
  winner: the abstract proposal exceeds the remaining capacity and is blocked.
- **A11** — the production refusal path is consistent with the corrected classification:
  `server/modules/credit-check.js:807` computes `overLimit` from
  `exposureCents + proposedDeltaCents > limitCents`; the salesperson scope then emits `OVER_LIMIT`
  (`:835`) and, because the attribution is provable and the overdue-day policy is defined, never
  `UNPROVEN_ATTRIBUTION` (`:813-817`). `evaluateCreditCheck()` raises the 409 inside the production
  transaction (`server/modules/credit-check.js:1091-1101`), so a blocked evaluation leaves no
  persistent row.
- **A12** — the observed failure is exactly this contradiction: `actual 'NEITHER_FITS'`,
  `expected 'ONLY_ONE_FITS'` at `...wave10-concurrency.integration.js:521` (`log/2026-10-26.md`,
  "追加：Wave 10 Gate B 单次真实 MySQL 回归"). The assertions at `:519-520` passed, which independently
  confirms `exposureCents = 100000` and `available = 10000`.
- **A13** — `ONLY_ONE_FITS` is **correct** for M-R01 (`...:68`, `:182-184`), M-R05 (`:400`), M-R06
  (`:418`), `B-M10` (`server/mysql-sales-customer-wave10-gate-b.integration.js:117`) and `B-M15`
  (`:203`): each of those races starts from zero committed exposure, so `available` genuinely exceeds
  each single delta while their sum exceeds it. M-R09 is the only case in the repository whose
  committed exposure makes the remaining capacity smaller than each proposal.

### 3. W10-MR09-R01 — The canonical chain is unchanged

M-R09 continues to test the canonical approved Sales Order → confirmed Delivery → final unpaid
Accounts Receivable transition, created and confirmed through the **real production HTTP routes**.
No direct SQL substitute, no stub, no monkey-patch and no interception of the production
confirmation handler, the Credit engine or the Finance recognition writer is permitted.

### 4. W10-MR09-R02 — The salesperson exposure is represented exactly once

The obligation must appear in exactly one exposure stage. The SO-commitment stage and the
delivered-not-settled stage are released by the transition and the final unpaid AR carries the
amount. The obligation must never be counted twice, and the aggregate projection must not count it
in a different stage than the salesperson projection.

### 5. W10-MR09-R03 — Capacity comes from persisted exposure and the effective Profile

The classification must be computed from the actual persisted exposure and the effective Profile
resolved by the production resolver. A seed constant, a hardcoded classification or a copied
expected value is not proof. The limit, the exposure and each proposed delta keep their present
values: limit 110000 cents, exposure 100000 cents, both proposed deltas 20000 cents.

### 6. W10-MR09-R04 — The correct classification is `NEITHER_FITS`

Because the available capacity is 10000 cents and each proposed delta is 20000 cents, both
proposals exceed the available capacity and the correct classification is **`NEITHER_FITS`**. The
expected classification literal in the M-R09 assertion must be corrected from `ONLY_ONE_FITS` to
`NEITHER_FITS`. `ONLY_ONE_FITS` is not a weaker or softer expectation here: it is a different
business statement — that exactly one contender may proceed — and M-R09's own refusal contract
requires that **neither** proceeds.

### 7. W10-MR09-R05 — Both concurrent checks return 409 `CREDIT_CHECK_BLOCKED` with `OVER_LIMIT`

Both coordinated contenders must be refused with the production HTTP 409 contract, the
`CREDIT_CHECK_BLOCKED` code and the `OVER_LIMIT` reason code. The refusal must remain the existing
production refusal contract and must not be replaced by a test-local status, code or message.

### 8. W10-MR09-R06 — The refusal must not be attributed to `UNPROVEN_ATTRIBUTION`

The AR must remain provably attributable to the salesperson. The refusal reason must be the
capacity failure `OVER_LIMIT` and must never be the attribution failure `UNPROVEN_ATTRIBUTION`.
M-R09 remains the contrast case to M-R10, which deliberately constructs an attribution-ambiguous AR.

### 9. W10-MR09-R07 — No unauthorized persistent side effect

The blocked evaluations must leave zero forbidden persistent delta across the declared projection
families: no economic row, no audit row, no idempotency record, no duplicate credit check result
group and no duplicate Special Approval authority. The forbidden-delta assertion and the
duplicate-effect assertion are preserved in full.

### 10. W10-MR09-R08 — No production, schema or migration change

No production Credit, Finance, Sales, quality-gate or HTTP code changes. No MySQL schema change, no
migration, no DDL, no new table and no new column. No change to the protected target, the campaign
lease, the guard, the runners, the manifests, the case identifiers, the evidence levels or the
M-board shape. No account, grant, role or credential change. The canonical HTTP, Finance and Credit
business contracts remain unchanged.

### 11. W10-MR09-R09 — Other cases are untouched

`ONLY_ONE_FITS` remains the correct classification for M-R01, M-R05, M-R06, `B-M10` and `B-M15`, and
those cases are not modified in any way. Only the M-R09 expectation literal changes.

### 12. W10-MR09-R10 — No test weakening

No assertion is deleted, relaxed, skipped, mocked or replaced by a hardcoded PASS. The correction is
a factual correction of one expected classification value, and the available-capacity precondition
it depends on may be made explicit.

### 13. Acceptance conditions

1. Facts A1–A13 remain true in the implementation.
2. The M-R09 classification expectation equals `NEITHER_FITS` and is derived from the computed
   capacity, never from a constant.
3. The limit, the exposure, the available capacity and both proposed deltas keep their present
   values, and the exposure conservation assertion is preserved.
4. Both concurrent requests are preserved and still expect HTTP 409 `CREDIT_CHECK_BLOCKED` with
   `OVER_LIMIT` and without `UNPROVEN_ATTRIBUTION`.
5. The forbidden-delta and duplicate-effect assertions are preserved.
6. M-R01, M-R05, M-R06, `B-M10` and `B-M15` are byte-for-byte unchanged.
7. No production file, schema, migration, runner, manifest, package file or release tag changes.
8. The local regression (`pnpm test:fast`, `pnpm test`, `pnpm build`, `git diff --check`) passes with
   no skipped, todo, cancelled or weakened assertion.

### 14. Compatibility boundary

Unchanged: the production Credit engine, the capacity classification algebra, the exposure
projection, the production refusal contract, the Finance recognition writers, the canonical HTTP
routes, the L0 and L1–L8 lock order, READ COMMITTED isolation, permissions, status machines, audit
and idempotency contracts, the Wave 9 freeze, the Gate A freeze, the Gate B case identities and
evidence levels, the M-board shape, the package version and the release tags.

Open and unaffected by this Requirement: the MySQL credential exposure (`CREDENTIAL_EXPOSURE_OPEN`,
operator action); the real-MySQL evidence for M-R09 (`TEST_EVIDENCE_PENDING` until a separately
authorized campaign); `LEGACY_DATA_EVIDENCE_PENDING`;
`RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN`;
`WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN`.

**Requirement status: `WAVE10_MR09_CONTRACT_REQUIREMENT_COMPLETE`.**

## Wave 10 CHECK clause parity normalization Requirement (2026-10-26)

### 1. Authorization, scope and the audited gap

The user confirmed that the Wave 10 Full Acceptance campaign exposed the gap
`WAVE10_PARITY_CHECK_CLAUSE_ESCAPE_NORMALIZATION_ABSENT`, and explicitly authorized one consecutive
`AUDIT / COVERAGE CONFIRMATION -> REQUIREMENT -> DESIGN` stage, with a mandatory HARD STOP at the end
of Design. This section records the Requirement phase only; the Design phase may follow without an
intervening approval. Implementation, real MySQL access, any Gate or Acceptance re-run, Git writes,
credential operations and Wave 11 are **not** authorized by this stage.

Audited classification — `SEMANTIC_MISMATCH` in the Wave 10 acceptance **test contract**
(`server/test-utils/wave10-mysql-schema-fixture.js`), surfaced by the live protected campaign as the
`M-MIG-01` and `M-MIG-02` check-constraint parity failures.

**This is not a production defect on the evidence available.** The production CHECK definitions, the
DDL generation path, the migration set and the business code are unchanged and are out of scope. The
defect is confined to the parity fixture's ability to *read* MySQL's rendering of a CHECK constraint.
Whether the live server's stored constraint is semantically identical to the SQLite source is **not**
asserted by this Requirement; see A18 and `W10-PARITY-CHECK-R09`.

### 2. Audit facts this Requirement is bound to

Every fact was verified against the actual source at HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6`
or against the preserved campaign transcript. No MySQL connection was made in this stage.

- **A1** — the two real failing assertions are `server/mysql-sales-customer-wave10.integration.js:117`
  (`M-MIG-01`, message `credit_check_results: check-constraint parity`) and
  `server/test-utils/wave10-mysql-schema-fixture.js:410` (`M-MIG-02`, message
  `credit_lock_anchors: check-constraint parity`). Both compare the MySQL-side `checks` array with the
  SQLite-side `checks` array with `assert.deepEqual`.
- **A2** — the clause text that reached the normalizer on the MySQL side contained a **literal
  backslash character immediately before every string literal's closing and opening single quotes**,
  for example `(decision in (\'pass\',\'warning\',\'block\',\'special_approval_required\'))`. This is
  read from the preserved campaign transcript byte-for-byte: the transcript stores `\\'`, which is
  node's `util.inspect` encoding of one literal backslash followed by one quote, not a display-only
  escape. The same form appears for `scope_type`, `anchor_type` and the `credit_lock_anchors`
  anchor disjunction.
- **A3** — the backslash was **not** introduced by the repository's transport. The worker response
  path is `JSON.stringify` → UTF-8 → `SharedArrayBuffer` → `JSON.parse`
  (`server/database/mysql-worker-protocol.js:41` and `:29`), which is lossless for backslashes: a
  backslash inside a string value is escaped on the way out and restored byte-identically on the way
  in. The value that reached `normalizeCheckClause()` is therefore byte-identical to the value
  `mysql2` delivered, and that value is byte-identical to what the server returned.
- **A4** — the backslash was **not** present in the SQL that created the constraints. The canonical
  SQLite DDL and the canonical live MySQL DDL of the affected tables use plain quoted literals
  (`server/migrations/sales-customer-wave9-credit-foundation.js:32,55,64-67,88,98,104,118,125,151-152,160,169-172,184-185`;
  `server/migrations/sales-customer-wave10-credit-check.js:43,55,62,68,78,82,88-91,109-111,133-138`),
  and the generic MySQL bootstrap emits the SQLite CHECK body verbatim
  (`server/database/mysql-schema.js:204`).
- **A5** — the SQLite side, read from that **same** DDL text, parsed successfully: its canonical forms
  appear in the failure diff. This independently confirms the source text carries no backslash, so the
  divergence is created between the DDL and the server's metadata rendering, not in the source.
- **A6** — `tokenizeCheckClause()` has **no** backslash branch. A `\` reaches
  `throw new CheckClauseSyntaxError('unsupported token ' + char)`
  (`server/test-utils/wave10-mysql-schema-fixture.js:111`).
- **A7** — `normalizeCheckClause()` catches only `CheckClauseSyntaxError` and returns
  `` `raw: ${text.toLowerCase()}` `` (`:283-285`). A `raw:` form can never equal a parsed canonical
  form, so the two sides are incomparable whenever the MySQL side falls back.
- **A8** — the observation matches the mechanism exactly: the only MySQL-side clause that compared
  equal (`sales_order_id is not null or sales_delivery_id is not null`) contains **no** string
  literal, and every clause that contains one produced a `raw:` form.
- **A9** — the tokenizer's present capabilities are: `'...'` with the SQL-standard doubled-quote
  escape (`''` → `'`), `"..."` and `` `...` `` with doubled delimiters, numeric literals, identifiers,
  the `<` `=` `>` `!` operators (with `!=` normalised to `<>`), and the `()` `,` punctuation
  (`:56-114`). It does **not** support backslash escapes, `N'..'` / `X'..'` / `B'..'` literal
  prefixes, `BETWEEN`, `LIKE`, `IS TRUE` / `IS FALSE`, or arithmetic operators. An unterminated string
  literal currently runs to the end of the text instead of failing.
- **A10** — `normalizeCheckClause()` strips backticks, charset introducers (`_utf8mb4`, `_utf8`,
  `_binary`) and collapses whitespace **before** tokenizing (`:271-275`). The absence of `_utf8mb4`
  from the captured `raw:` text therefore does **not** prove that the live text lacked it.
- **A11** — the repository never sets `sql_mode`: there is no `SET sql_mode` anywhere under `server/`.
  The worker sets only `time_zone`, `SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED` and
  `innodb_lock_wait_timeout` (`server/database/mysql-worker.js:106-108`), so the session inherits the
  server default sql_mode, in which MySQL 8 does **not** include `NO_BACKSLASH_ESCAPES`.
- **A12** — the eight compared tables and their approved CHECK cardinality, which the migrations
  themselves assert on both engines
  (`server/sales-customer-wave10-mysql-parity.test.js:40-49`): `credit_lock_anchors` 2,
  `credit_parameters` 2, `credit_check_rules` 5, `credit_profile` 3, `credit_policy_snapshots` 1,
  `credit_profile_ratings` 3, `credit_check_results` 3, `credit_special_approval` 4 — **23 CHECK
  constraints** in total. Every one of the eight tables carries at least one string-literal CHECK, so
  every table is affected by this gap.
- **A13** — the case-insensitive literal comparison is sound for these eight tables. The only
  case-sensitive columns in the schema (`from_position_key`, `to_position_key`, `request_fingerprint`
  → `ascii_bin`; `from_position_identity_json`, `to_position_identity_json` → `utf8mb4_bin`;
  `lot_code_key` → `utf8mb4_0900_bin`, `server/database/mysql-schema.js:217-225`) appear in **none**
  of the eight credit tables, and all eight are created with the default `utf8mb4_0900_ai_ci`
  (`server/database/mysql-schema.js:205`).
- **A14** — the `raw:` fallback is fail-closed across the parsed/raw boundary (A7) and, between two
  `raw:` forms, equates only byte-identical lowercased texts. Its residual coarseness is the
  case-insensitive and whitespace-only collapse, which A13 bounds to these eight tables. It also
  **discards the parse reason**, so an unsupported-syntax fallback is currently indistinguishable
  from an escaped-literal fallback.
- **A15** — the existing local regression `server/sales-customer-wave10-mysql-parity.test.js` is
  **source-text only**: it reads the two migration sources and never opens a database (`:35-36`,
  `:113-126`). Its "MySQL rendering" samples (`:128-144`) are hand-written models whose string
  literals carry **plain** quotes. No local case covers a backslash-escaped literal, the `raw:`
  branch, or an unterminated literal, which is why the local gate stayed green while the live
  campaign failed.
- **A16** — the parity suite has **never** been green. On 2026-10-25 the live parity suite ran with
  4 pass / 3 fail (`M-MIG-01`, `M-MIG-02`, `M-MIG-06`); `M-MIG-06` was subsequently fixed, and
  `M-MIG-01` / `M-MIG-02` now fail only on the escaped-literal rendering.
- **A17** — the live rendering matches the hand-written model in every respect except the literal
  quoting: the live text wraps the clause in one parenthesis and parenthesises each `AND` / `OR`
  operand, exactly as modelled at `server/sales-customer-wave10-mysql-parity.test.js:138-139`. Only
  the string-literal quoting diverges, which is the narrowest possible characterisation of the gap.
- **A18** — the **semantic** question is bounded but not closed. The constraint was created from
  plain-quoted DDL (A4) under a session that did not disable backslash escapes (A11), so the
  *enforced* constraint holds the literal values `PASS`, `WARNING`, `BLOCK`,
  `SPECIAL_APPROVAL_REQUIRED` and is the same constraint the SQLite source declares. That is a
  conclusion drawn from the DDL and the session configuration, **not** a live observation: the live
  `SHOW CREATE TABLE` rendering and the effective `@@session.sql_mode` could not be read in this
  stage because no MySQL access is authorized. The canonical DDL's plain quoted literals are
  mode-independent — `'PASS'` denotes `PASS` whether or not `NO_BACKSLASH_ESCAPES` is set — so the
  *enforced* constraint is unambiguous under either mode. What remains unproven is the **rendering
  convention** the server uses when it re-prints that constraint into
  `information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE`, and whether the observed convention is stable.
  The equivalence is therefore **conditional on the observed rendering** and must be established
  against a live capture, not assumed.

### 3. W10-PARITY-CHECK-R01 — One canonical form for semantically equivalent CHECK expressions

Two CHECK expressions that denote the same constraint must normalize to one canonical form,
independently of the backend that rendered them. The canonical form is produced by parsing the
expression into its tree and re-rendering it; it must not depend on the incidental shape of the
source text (redundant parentheses, operator spacing, quoting style, identifier quoting, charset
introducers). This applies to the SQLite source side and the MySQL target side of the same
constraint.

### 4. W10-PARITY-CHECK-R02 — The MySQL escaped-literal rendering is recognised, not guessed

The rendering confirmed in A2 — a string literal whose quotes are backslash-escaped — must be
recognised as a *representation* of a string literal and decoded to the literal's semantic value. The
decoder must be restricted to the escape sequences the server actually defines; it must not remove
backslashes, must not remove or add quotes, and must not apply to any byte outside a string literal.
A backslash that appears outside a string literal remains an unsupported token and remains
fail-closed.

### 5. W10-PARITY-CHECK-R03 — The canonical form must not alter the constraint

Column names, comparison operators, `AND` / `OR` / `NOT` structure and precedence, `IN` member sets
and their values, and `IS [NOT] NULL` predicates must survive normalization unchanged. The canonical
form may differ from the source text only in the representational dimensions listed in R01. No
operator, operand, member or value may be added, dropped, reordered or rewritten.

### 6. W10-PARITY-CHECK-R04 — Genuinely different constraints must stay different

Two CHECK expressions that denote different constraints must never normalize to the same canonical
form. This covers at minimum: a different comparison operator; a different operand; a different
column; a different `IN` member set; a different literal value; `AND` against `OR`; `NOT` against
its operand; and the presence against the absence of a `NULL` predicate. A literal whose semantic
value differs between the two backends — including a value that differs only by an escape sequence —
must be classified as different, not as equivalent.

### 7. W10-PARITY-CHECK-R05 — Unsupported or incomplete expressions fail closed

A CHECK expression that cannot be parsed completely — an unsupported token, an unsupported escape, an
unterminated string literal, a truncated expression, trailing tokens after a complete parse, or an
empty expression — must not be treated as equivalent to anything. It must produce a form that is
distinct from every parsed canonical form, and it must be **diagnosable**: the reason for the
fallback must be retained and surfaced, so that an unsupported-syntax fallback can never be confused
with a representational fallback. The existing distinct `raw:` prefix is retained as that
distinguishing marker; the fallback is **not** removed.

### 8. W10-PARITY-CHECK-R06 — No passing by weakening the contract

The remediation must not be achieved by removing or skipping any CHECK assertion, by ignoring or
loosening the approved CHECK cardinality, by skipping or filtering any test, by weakening the
`M-MIG-01` / `M-MIG-02` comparison, by permanently disabling the `raw:` fallback, or by hard-coding
any table name, column name or literal. The approved CHECK counts of the eight tables (A12) remain
the counts the migrations themselves assert on both engines.

### 9. W10-PARITY-CHECK-R07 — M-MIG-01 and M-MIG-02 keep their full structure

`M-MIG-01` and `M-MIG-02` keep their current scope, their real-database validation and their
comparison contract: a fresh production bootstrap and the canonical SQLite source compared against
the live MySQL `information_schema` metadata, with complete column, foreign-key, CHECK and index
parity. The remediation changes only how a CHECK clause is read and normalized; it does not weaken,
replace or bypass the live comparison, and it does not replace the live check with a source-text
comparison.

### 10. W10-PARITY-CHECK-R08 — No production change

No production CHECK definition, DDL, migration, business code, credit or finance implementation,
schema object, permission, state machine, audit or idempotency contract is modified. The
`server/migrations/**`, `server/database/**`, `server/app.js`, `server/modules/**` and the Gate
runner / manifest files are out of scope.

### 11. W10-PARITY-CHECK-R09 — The escape dialect follows input provenance, and the mode is observed

The literal dialect is derived from **where the text came from**, never guessed from its byte
content:

- text read from the canonical SQLite DDL source is decoded in the SQL-standard dialect, in which
  only `''` denotes a literal quote and a backslash is an ordinary character;
- text read from the MySQL catalog rendering is decoded in the MySQL rendering dialect, in which the
  server's own escape convention applies.

`sql_mode` governs how the server **parses input DDL**, not how it re-prints a stored expression.
The canonical DDL uses plain quoted literals, which denote the same value under every mode including
`NO_BACKSLASH_ESCAPES`, so the enforced constraint is mode-independent (A18). The rendering
convention, however, is a server behaviour that is neither documented in this repository nor
observed in this stage, so it must be **observed**: the live comparison must record the effective
`@@session.sql_mode`, the server version and the captured rendering bytes, and a rendering that
cannot be decoded under the declared dialect must fail closed with a named diagnostic instead of
being forced into a canonical form.

The repository's own DDL and session configuration are unchanged by this Requirement; the mode is
read from the live session that the acceptance campaign already uses.

### 12. W10-PARITY-CHECK-R10 — The rendering contract is captured, not modelled

The MySQL rendering that the fixture must read must be **captured from a live server** and recorded
as evidence, not hand-modelled. A hand-written model of the server's rendering is what produced the
current gap (A15, A17). The captured form, the observed `sql_mode`, the server version and the
capture date must be recorded, and the local regression must be built on the captured bytes.

### 13. Acceptance conditions

1. A captured live MySQL CHECK rendering and the corresponding canonical SQLite CHECK source
   normalize to one identical canonical form, with the literal values preserved.
2. The eight approved CHECK counts (A12) are asserted unchanged, per table.
3. Every pair of genuinely different constraints listed in R04 still normalizes to two different
   canonical forms.
4. Unsupported, incomplete, unterminated and malformed inputs fail closed with a retained, inspectable
   reason, and never compare equal to a parsed canonical form.
5. The effective `sql_mode`, the server version and the captured rendering bytes are recorded during
   the live comparison; the literal dialect is selected from the input's provenance, and a rendering
   that cannot be decoded under that dialect fails closed with a named diagnostic (R09).
6. The existing local CHECK normalizer regressions and the existing SQLite/MySQL physical parity,
   index, foreign-key and column-type contracts are unchanged and still pass.
7. No production file, migration, schema object, fixture of the OQC remediation, `M-R09` assertion,
   Finance / Credit production implementation, Gate runner or manifest is modified.

### 14. Error handling, compatibility and rollback boundary

- **Error handling.** A parse failure is never an equivalence. The fallback form stays distinct from
  every parsed canonical form and carries a retained reason. A `sql_mode` that disables backslash
  escapes is reported as a distinct, named condition rather than silently changing the outcome.
- **Compatibility.** The canonical form, the comparison order and the CHECK counts are unchanged for
  every constraint that already normalizes today; no currently passing comparison may change its
  result. The eight credit tables, their migrations, the Gate B identity set, the Gate A freeze, the
  Wave 9 freeze and the M-board shape are unaffected.
- **Rollback.** The change is confined to the acceptance test contract in one fixture file and one
  local regression file. A plain revert restores the previous state; no schema, migration, data,
  external system or persistent state is involved, so there is no database-side rollback and no
  partially applied state to reconcile.
- **Not authorized here.** Implementation, live MySQL access, any Gate or Acceptance re-run, Git
  writes and credential operations remain outside this Requirement.

### 15. OPEN facts

```text
OPEN  the live MySQL CHECK_CLAUSE rendering and the effective session sql_mode
OPEN  the live M-MIG-01 / M-MIG-02 result after the remediation
OPEN  W10-RACES and W10-BUSINESS-MATRIX live results (both suites did not run)
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
```

**Requirement status: `WAVE10_PARITY_CHECK_NORMALIZATION_REQUIREMENT_COMPLETE`.**

## Wave 10 Full Acceptance blocker Requirement (2026-10-27)

### 1. Authorization, scope and the audited gap

The user authorized the AGENTS.md §4 Requirement stage for the remaining Wave 10 Full Acceptance blocker and
the `M-BIZ-19` `no-rule` fixture problem. This section records the Requirement phase only. The Design phase
is **not** authorized and has not been started. No implementation, no test run, no MySQL connection, no
schema or fixture change, and no Git write operation is authorized by this stage.

Audited classification — `SEMANTIC_MISMATCH` in the Wave 10 acceptance **test contract**
(`server/mysql-sales-customer-wave10-business-matrix.integration.js`), exposed as
`WAVE10_MATRIX_M_BIZ_19_NO_RULE_VARIANT_FK_BLOCKED` by the read-only preflight audit of 2026-10-26.

**This is not a production defect.** No production Credit, Finance, Quality or Sales behaviour, no
schema, no migration and no constraint definition is in scope. The defect is confined to how one
acceptance case prepares its own test data.

### 2. Audit coverage and method

The audit covered all 39 top-level cases of the three protected suites against the current source:
`W10-PARITY` (7), `W10-RACES` (12) and `W10-BUSINESS-MATRIX` (20, including the independent database
lifecycles inside `M-BIZ-19` and `M-BIZ-20`). Every raw DML statement in the three suites and in the
shared acceptance fixture was enumerated and checked against the canonical schema contracts; every
capacity and exposure expectation was recomputed from the fixture constants and the production engine
algebra. No MySQL connection, no test execution and no database query was performed in this stage.

### 3. Verified facts this Requirement is bound to

- **A1** — the protected suite has three suites and 39 top-level cases:
  `scripts/gates/mysql-sales-wave10-manifest.mjs:4-8`; the acceptance runner is
  `scripts/gates/mysql-sales-wave10-acceptance.mjs` and the shared runner support is
  `scripts/gates/mysql-wave10-runner-support.mjs`.
- **A2** — `W10-PARITY` and `W10-RACES` have real-MySQL evidence: `M-MIG-03/M-MIG-05`, `M-MIG-04`,
  `M-MIG-06`, `M-MIG-07`, `M-MIG-08` passed in the 2026-10-26 campaign, and all twelve `M-R01`..`M-R12`
  passed in the `WAVE10_GATE_B_PASS` campaign.
- **A3** — that Gate B evidence still corresponds to the current worktree: the Gate B transcript
  (`%TEMP%\w10gateb\gateb-run.txt`) was written at `2026-10-26 22:35:54`, which is **after** the last
  modification of `server/mysql-sales-customer-wave10-concurrency.integration.js` (`21:52:47`) and of
  `server/test-utils/wave10-mysql-acceptance-fixture.js` (`20:14:42`). The two files the Gate B races
  suite exercises are unchanged since that evidence was produced.
- **A4** — `W10-BUSINESS-MATRIX` has **no** real-MySQL evidence. Both campaigns executed to date aborted
  in suite 1, so all twenty cases are `TEST_EVIDENCE_PENDING`.
- **A5** — `W10-BUSINESS-MATRIX` contains exactly 20 top-level cases with no `describe`, no `it`, no
  `test.skip`, no `test.todo`, no `test.only`, no conditional registration and no per-case hook. The only
  module-level gate is the environment check at `:38-39`, which throws at import time and therefore
  aborts the whole file rather than skipping individual cases.
- **A6** — every case builds its own schema through `withMatrix()`
  (`server/mysql-sales-customer-wave10-business-matrix.integration.js:67-74`), which calls
  `createTempDb(wave10MysqlTempOptions(label))`; `wave10MysqlTempOptions()`
  (`server/test-utils/wave10-mysql-acceptance-fixture.js:47-49`) binds every lifecycle to
  `createWave10MysqlLifecycle()`, so each lifecycle re-verifies the protected target identity under the
  campaign lease. `M-BIZ-19` runs two lifecycles and `M-BIZ-20` runs three, so the suite performs
  **23** complete schema rebuilds; each ends in `handle.cleanup()` in a `finally` block.
- **A7** — the fixture always creates the aggregate Credit Profile and binds it to the fixture rule:
  `server/test-utils/wave10-mysql-acceptance-fixture.js:477` calls `seedProfile(...)`, and `:512` writes
  `rule_id = 'w10-race-rule'` into that row. The referenced rule row is created at `:474-476`.
- **A8** — the canonical schema declares the corresponding foreign key without a delete action:
  `server/migrations/sales-customer-wave9-credit-foundation.js:93` declares
  `rule_id TEXT REFERENCES credit_check_rules(id)` and `:218` lists the pair
  `['rule_id','credit_check_rules']` without `on_delete`. Generating the actual canonical snapshot yields
  `on_delete: 'NO ACTION'`, so `server/database/mysql-schema.js:202` emits
  `FOREIGN KEY (rule_id) REFERENCES credit_check_rules (id) ON UPDATE NO ACTION ON DELETE NO ACTION`,
  executed with `ENGINE=InnoDB` at `:314`.
- **A9** — the protected session enforces foreign keys: `@@session.foreign_key_checks = 1` and
  `@@global.foreign_key_checks = 1` were observed on the dedicated account.
- **A10** — the failing statement is
  `server/mysql-sales-customer-wave10-business-matrix.integration.js:426`
  `db.prepare("DELETE FROM credit_check_rules WHERE id='w10-race-rule'").run();`, executed in the
  `no-rule` variant of `M-BIZ-19` (`:421-433`), outside the check's transaction and therefore in
  autocommit.
- **A11** — the engine's rule selection is over **effective** rules, not over existing rows:
  `server/modules/credit-check.js:508-511` selects `credit_check_rules` by
  `business_stage = ? AND status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR
  effective_to>=?)`; `:513-516` then filters by recognition mode; `:666-675` returns
  `{ enforced:false, decision:'PASS', checkGroupId:null, scopeResults:[],
  reasonCodes:['NO_APPLICABLE_EFFECTIVE_RULE'] }` when nothing remains.
- **A12** — the `no-rule` variant's own assertions are `:429`
  (`enforced === false`, `decision === 'PASS'`) and `:430` (the persistence projection is unchanged).
  They are consistent with the engine contract in A11.
- **A13** — the `disabled` variant (`:425`) flips `credit_parameters.value_bool` to `0` and exercises the
  separate early return `CREDIT_MANAGEMENT_DISABLED`; it is not affected by the foreign key.
- **A14** — `M-BIZ-18` (`:410-419`) is the *other-mode-only* path: an effective rule exists for the stage
  but its `recognition_mode` does not match the requested mode, so the mode filter empties the
  applicable set and the engine returns the same `NO_APPLICABLE_EFFECTIVE_RULE` outcome. The two cases
  therefore differ in their **business fact**, not in the engine's return value.
- **A15** — every other raw DML statement in the suite satisfies the canonical schema:
  `:219` (no-op on `effective_from`, see A16), `:241` (`status='SUSPENDED'` is allowed by the
  `credit_profile` status CHECK, and `w10-profile-a` exists because `M-BIZ-04` passes
  `salespersonLimit: 50000`), `:256` and `:297` (no CHECK on the affected columns), `:383` (the
  `sales_invoices` insert satisfies the NOT NULL, UNIQUE, CHECK and FK contracts, and every column added
  later by `v22-finance-wave-c-invoice.js:45-51` is nullable or carries a default), `:404` and `:413`
  (`recognition_mode` carries no CHECK), `:425`, `:438` (the second rule satisfies the
  `credit_check_rules` CHECKs and the `(rule_code, effective_from)` uniqueness), and `:450` (child rows
  are deleted before their parent).
- **A16** — `M-BIZ-03`'s `:219` update writes `effective_from='2026-01-01'`, which the fixture already
  wrote, so it is a no-op; and no historical ACTIVE Profile version is ever seeded, so the premise
  "does not fall back to a historical ACTIVE" is not exercised by that case. It is a **coverage gap**,
  not a failure: the case still passes as a CLOSED fail-closed check.
- **A17** — the runner's terminal behaviour is confirmed by source and by the 2026-10-26 campaign: a
  non-zero suite exit raises `WAVE10_MYSQL_SUITE_FAILED` (`mysql-wave10-runner-support.mjs:188-193`),
  the `finally` block still performs the final protected reset and asserts the zero inventory
  (`:202-213`), the lease is released (`:216-219`), and the campaign transcript of the failed run
  contains `FINAL ZERO OBJECTS = {"tables":0,"views":0,"triggers":0,"routines":0,"events":0}`.
- **A18** — the eight compared Credit tables keep 23 approved CHECK constraints
  (`2/2/5/3/1/3/3/4`), and **none** of them carries a numeric literal, so the known numeric-versus-string
  literal rendering boundary does not affect the approved set.

### 4. W10-ACC-R01 — The `no-rule` variant must express "no applicable effective rule"

The `no-rule` variant of `M-BIZ-19` must establish the business fact that **a Credit Check for this
stage and this business date has no applicable effective rule**. The engine's contract (A11) is that
such a stage carries no Credit control at all. The fixture data must establish that fact as a **state
of the rule set**, and it must establish it in a way that can actually be created.

The current setup expresses the absence by deleting the rule row, which is rejected by the database
before the case can reach its own assertions (A7, A8, A9, A10). That is a setup defect, not a business
statement.

### 5. W10-ACC-R02 — The referential contract must not be broken

The fixture data must not remove, orphan or re-point a row that another row references. Specifically:

- no row referenced by `credit_profile.rule_id` may be deleted while the reference exists;
- the foreign key `credit_profile.rule_id -> credit_check_rules(id)` and its `ON DELETE NO ACTION`
  behaviour must remain exactly as the canonical schema declares it;
- the fix must not be achieved by dropping the foreign key from the migration, by deleting or nulling the
  referencing Profile, by disabling foreign-key enforcement for the session
  (`SET FOREIGN_KEY_CHECKS = 0`), or by any other means that would let a real referential violation
  pass unnoticed.

### 6. W10-ACC-R03 — The rule fact stays real, dated and auditable

A rule is a versioned, dated, status-bearing business object, and the engine selects over **effective**
rules (A11). The absence of an applicable effective rule must therefore be expressed by the rule set
not offering one **for this stage on this business date** — never by the rule fact not existing. The
fixture data must keep the rule a real, persisted, auditable row with its declared business attributes.

### 7. W10-ACC-R04 — The three unenforced paths stay distinct

The suite must keep three distinguishable business facts apart, each with its own fixture state and its
own case identity:

1. **credit management disabled** — the `M-BIZ-19` `disabled` variant: the switch is off, the engine
   returns the `CREDIT_MANAGEMENT_DISABLED` early return;
2. **no applicable effective rule** — the `M-BIZ-19` `no-rule` variant: the stage has no effective rule
   on this business date;
3. **rule effective for the stage but not for the requested recognition mode** — `M-BIZ-18`: a rule
   exists and is effective for the stage, and the mode filter empties the applicable set.

Facts 2 and 3 share the engine's return value (A14); their distinctness is carried by the fixture state
and by the case identity, and each case must keep naming the fact it actually establishes. A correction
must not collapse facts 1 and 2 into one, and must not make fact 2 indistinguishable from fact 3 in the
fixture.

### 8. W10-ACC-R05 — The observable contract of the case is unchanged

The corrected variant must keep the assertions the case exists to make (A12): the evaluation is **not
enforced**, the decision is **PASS**, and the persistence projection is **unchanged** — no
`credit_check_results` row, no `credit_policy_snapshots` row, no audit row, no idempotency record and no
change to any other projected fact. A variant that reaches these assertions by weakening them, by
skipping them or by turning them into a non-failure does not satisfy this Requirement.

### 9. W10-ACC-R06 — No production change

No production Credit, Finance, Quality or Sales code, no schema, no migration, no constraint definition,
no foreign key, no permission, no state machine and no audit or idempotency contract is modified. The
correction is confined to the acceptance test contract.

### 10. W10-ACC-R07 — No weakening of the suite

The correction must not remove, skip, condition or reclassify any of the 39 protected cases; must not
change the suite manifest, the case identifiers, the evidence levels or the M-board shape; must not
change the `M-MIG-01` / `M-MIG-02` live comparison contract; must not change the `M-R09` assertion; and
must not change the shared acceptance fixture's OQC quality-policy installation, which the eight
delivery-creating business-matrix cases depend on.

### 11. W10-ACC-R08 — The corrected fixture data is covered by an engine-neutral local regression

The corrected `no-rule` fixture state must be provable without a live MySQL server, so that the next
failure of this class is caught by the local gate rather than by a protected campaign. The local
regression must assert, at minimum:

1. the corrected fixture state produces the engine's non-enforced outcome (`enforced === false`,
   `decision === 'PASS'`, reason code `NO_APPLICABLE_EFFECTIVE_RULE`) and writes no evidence;
2. the `disabled`, `no-rule` and `other-mode-only` states remain three distinguishable fixture states;
3. the referential contract holds in the corrected state — the Profile's `rule_id` still resolves to an
   existing rule row, and no statement in the corrected setup deletes or orphans a referenced row;
4. the approved CHECK cardinality of the eight tables and the existing parity, index, foreign-key and
   physical-type contracts are unchanged.

### 12. Audit result classification

**CONFIRMED_BLOCKER — three.** CB-2 and CB-3 are calendar-gated: they are confirmed defects of the
acceptance test contract that do **not** block a campaign run on 2026-10-27 but do block any campaign
run on or after the dates stated. They are derived in §17.7 and carry their own Requirements (§17.8).

| # | Subject | Evidence | Impact |
|---|---|---|---|
| CB-1 | `M-BIZ-19` `no-rule` variant | A7, A8, A9, A10, A19–A22 | the variant's setup statement is rejected by the database; the case fails before its assertions; `W10-BUSINESS-MATRIX` fails and the campaign aborts at suite 3 |
| CB-2 | `M-R02` hard-coded approval expiry `'2026-12-31'` | §17.7, `server/mysql-sales-customer-wave10-concurrency.integration.js:292,296` and `server/modules/credit-special-approval.js:169-174` | on or after **2027-01-01** the approval request is refused with `CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST` before the race starts; `W10-RACES` fails and the campaign aborts at suite 2 |
| CB-3 | `M-R08` salesperson-scope Profile predecessor is never closed | §17.7, `wave10-mysql-acceptance-fixture.js:506` vs `server/modules/credit-anchor.js:18-23`, `server/modules/credit-profile.js:124-136` and `:47-54` | on or after **2026-12-31** two salesperson Profiles qualify, the resolver raises `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS`, no evidence is written and `M-R08` fails — order-dependent, roughly a coin flip |

**COVERAGE_GAP — four. None is a failure; none is converted into a Requirement here.**

| # | Subject | Evidence | Note |
|---|---|---|---|
| CG-1 | `M-BIZ-03` "does not fall back to a historical ACTIVE" | A16 | the setup update is a no-op and no historical ACTIVE version exists, so the stated premise is not exercised; the case still passes as a CLOSED fail-closed check |
| CG-2 | `M-BIZ-08` "overdue AR" | A15, and `credit-check.js:236-245` reads no `due_date` filter | the `due_date` update does not influence the exposure read, so the "overdue" premise is not exercised by the asserted outcome; the case still passes |
| CG-6 | `M-R02` "exactly one effective authority" | §17.7, `server/mysql-sales-customer-wave10-concurrency.integration.js:312` | the assertion is a disjunction, and when the special decision wins the gate both predicates hold at once, so the stated invariant is not proven |
| CG-7 | `M-R04` Profile-identity assertion | §17.7, `server/mysql-sales-customer-wave10-concurrency.integration.js:389` | the candidate list is built from the same table the assertion reads, so it can only fail on a deleted Profile, never on a wrong identity |

**UNVERIFIED_RISK — six. Each is recorded with its trigger; none is asserted to be a defect.**

| # | Subject | Trigger | Why it is not a confirmed blocker |
|---|---|---|---|
| UR-1 | `M-BIZ-06` exposure window across a UTC midnight | `wave10BusinessDate()` is read at fixture time, `reviewed_at` is written at approve time; a midnight crossing makes `reviewed_at > businessDate` and drops the order from the exposure read | the fixture already derives the business date from the run date and documents this hazard in `wave10-mysql-acceptance-fixture.js:25-33`; it is a narrow, calendar-bound race, not a contradiction |
| UR-2 | `M-BIZ-12` `sales_delivery_no` collision | `app.js:5650` derives `'SD' + Date.now().toString().slice(-10)` and `server/db.js:661` declares `delivery_no TEXT NOT NULL UNIQUE`; two deliveries in the same millisecond would collide | the two deliveries are separated by a full HTTP create-and-confirm round trip including a scrypt login, so the probability is negligible; the column is unique, so the failure would be loud |
| UR-3 | `M-BIZ-04` Profile anchor key | the fixture writes `SCOPE:w10-race-sp-a` (`wave10-mysql-acceptance-fixture.js:506`) while the production anchor builder computes `SCOPE:SALESPERSON|w10-race-sp-a` | the keys differ, so a second anchor row is inserted; `credit_lock_anchors` is outside the persistence projection, so the asserted projections are unaffected. See CB-3 for the calendar-gated consequence of the same divergence |
| UR-4 | hard-coded date literals | `M-BIZ-05` `:256`, `M-BIZ-08` `:297`, `M-BIZ-15` `:384-386`, `M-BIZ-20` `:440` | none of them enters the derivation of the asserted value; they are declared reference facts |
| UR-5 | runner's default per-suite timeout against the estimated `W10-BUSINESS-MATRIX` runtime | §17.4 | the estimate is extrapolated, not measured, and the override is an available bounded knob; it is a precondition on the protected acceptance stage, recorded in §15.3 |
| UR-6 | `innodb_lock_wait_timeout = 2` against a 15 s gate-admission budget | §17.7, `server/database/mysql-worker.js:31,108` and `server/modules/sales-gate-retry-admission.js:1` | a slow first wait-evidence observation makes the contenders abort and retry, which opens gaps in the pending window; if the delay exceeded the budget the approval would be refused with HTTP 503, which the suite explicitly rejects — the failure mode is loud, not silent |

**NON_BLOCKING — the remaining checks.** The `W10-PARITY` and `W10-RACES` suites keep real-MySQL
evidence that corresponds to the current worktree (A2, A3). The twelve race capacity expectations were
independently recomputed and are mutually consistent, including `M-R09`'s `NEITHER_FITS` with the
`available < 20000` precondition and the deliberately contrasting `M-R10` (`UNPROVEN_ATTRIBUTION`, and
explicitly **not** `OVER_LIMIT`). The seven business-matrix delivery-creating cases depend on the shared
fixture's OQC quality control point, which is installed by the fixture base with `qualityPolicy`
defaulting to `true` and is never overridden per case, and no production quality-gate file is modified.
The strict TAP validator accepts the new `WAVE10_CHECK_METADATA_EVIDENCE` transcript line. The runner's
cleanup ordering and terminal zero-inventory guarantee are confirmed by source and by the failed 2026-10-26
campaign (A17).

### 13. Acceptance conditions

1. The `no-rule` variant of `M-BIZ-19` reaches its own assertions and passes, with the fixture data
   expressing "no applicable effective rule" as a rule-set state.
2. The referential contract holds: the Profile's `rule_id` resolves to an existing rule row and no
   statement in the corrected setup deletes, orphans or re-points a referenced row.
3. The foreign key and its `ON DELETE NO_ACTION` behaviour are unchanged in the canonical schema and in
   the migrated schema.
4. The `disabled`, `no-rule` and `other-mode-only` states remain three distinguishable fixture states
   with their own case identities.
5. The observable contract is unchanged: not enforced, `PASS`, and a byte-identical persistence
   projection before and after the evaluation.
6. The engine-neutral local regression described in R08 passes, and the existing local CHECK normalizer,
   parity, index, foreign-key and physical-type regressions are unchanged and still pass.
7. All 39 protected cases remain present, enabled and unclassified; the suite manifest, case
   identifiers, evidence levels and M-board shape are unchanged.
8. The protected campaign over the dedicated disposable target reaches all three suites and reports the
   final cleanup as confirmed with a five-category inventory of zero.
9. `M-R02` reaches its own assertions and passes on a campaign run whose business date is on or after
   2027-01-01, with the approval expiry derived from the run date rather than from a fixed literal.
10. `M-R08` passes **deterministically** on a campaign run whose business date is on or after 2026-12-31,
    and the seeded salesperson Profile and the Profile created by the case resolve to one anchor and
    therefore one version chain, so the production predecessor closure closes the predecessor.
11. The production `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` guard is still fail-closed: two Profiles that
    genuinely qualify for the same scope and business date are still refused.

### 14. Compatibility boundary and prohibited changes

- **Unchanged:** the production Credit engine and its classification algebra; the exposure projection;
  the production refusal contract; the Finance recognition writers; the canonical HTTP routes; the L0
  and L1-L8 lock order; READ COMMITTED isolation; permissions; state machines; audit and idempotency
  contracts; the Wave 9 and Gate A freezes; the Gate B case identities, evidence levels and M-board
  shape; the `M-R09` assertion; the OQC fixture remediation; the approved CHECK cardinality of the eight
  tables; the package version and the release tags.
- **Prohibited in the future Implementation:** deleting, orphaning or re-pointing a referenced row;
  weakening or dropping a foreign key or a CHECK constraint; disabling foreign-key enforcement for the
  session; disabling the `raw:` fallback of the CHECK normalizer; removing or skipping any of the 39
  cases; weakening the `M-MIG-01` / `M-MIG-02` comparison or the `M-R09` assertion; editing the Gate
  runner, the manifest or the suite registration; changing a protected target, an account or a grant.
- **Prohibited in the future Implementation (added by §17.8 and §17.9):** removing the approval expiry as
  a business attribute, or replacing it with an unbounded value; editing production anchor-key
  construction (`server/modules/credit-anchor.js`) or the production predecessor-closure logic
  (`server/modules/credit-profile.js`) to make the fixture pass; weakening or removing the production
  `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` guard or its trigger; editing the `M-R02` or `M-R08` assertions
  to remove their asserted invariants; making any of the three corrected cases calendar-dependent in a
  different way.

### 15. Staged follow-up conditions

1. **Design** — the mechanism that expresses "no applicable effective rule" while preserving the
   referential contract, the auditable rule fact and the three distinct unenforced paths, together with
   the exact file list and the local regression contract. The Design must additionally cover the two
   calendar-gated cases (R09, R10) and must end in a HARD STOP.
2. **Implementation** — only after a separate explicit authorization; confined to the acceptance test
   contract, with the local, engine-neutral regression executed under a backend that cannot resolve to
   MySQL.
3. **Protected Acceptance** — only after a separate explicit authorization for exactly one
   `pnpm.cmd test:mysql:wave10` run against the dedicated disposable target, with the read-only preflight
   repeated first. The campaign must run with `ERP_MYSQL_WAVE10_SUITE_TIMEOUT_MS` set above the measured
   `W10-BUSINESS-MATRIX` runtime (see UR-5 in §17.4), and the read-only preflight must confirm that value
   in the child environment before the run.

### 16. OPEN facts

```text
OPEN  the real-MySQL result of W10-BUSINESS-MATRIX (20 cases, never executed)
OPEN  the real-MySQL result of M-MIG-01 / M-MIG-02 after the CHECK normalization remediation
OPEN  CREDENTIAL_EXPOSURE_OPEN
OPEN  WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN
OPEN  WAVE10_CLASSIFICATION_ALGEBRA_LOCAL_REGRESSION_ABSENT
OPEN  WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
OPEN  CB-2 — M-R02 hard-coded approval expiry blocks any campaign on or after 2027-01-01
OPEN  CB-3 — M-R08 salesperson Profile predecessor never closed; blocks any campaign on or after 2026-12-31
OPEN  CG-4 — the hand-written MySQL DDL materialization path of the Wave 9 tables is never exercised
OPEN  CG-3 / CG-5 — M-MIG-01 comparison scope and M-BIZ-16 replay semantics
```

**Requirement status: `WAVE10_ACCEPTANCE_BLOCKER_REQUIREMENT_COMPLETE`.**

### 17. Independent re-verification pass (2026-10-27)

A second Requirement-stage pass re-derived every material fact of §3 from the current source and
re-checked the whole 39-case surface. It changed no existing Requirement, corrected one count,
strengthened the blocker evidence, and added **nine** findings the first pass had not recorded —
two of them new confirmed blockers — together with two new Requirements.

#### 17.1 Scope and method

- Same authorization as §1: Requirement stage only. Read-only inspection; **no** test run, build,
  MySQL connection or database query; **no** Git write operation. The only files modified are
  `document.md` (this section and the two amendments noted in §17.5 and §17.6) and the append-only
  development log.
- Method: every raw DML statement in the three protected suites and in the shared acceptance fixture
  was re-enumerated and re-checked against the canonical schema contracts; every capacity and exposure
  expectation was recomputed; the runner, the strict TAP parser, the campaign object inventory and the
  OQC dependency were re-read from source; the `W10-PARITY` and `W10-RACES` suites were additionally
  submitted to two independent read-only audit passes, whose material claims were then re-verified
  against the source by hand.
- The Requirement set **R01–R08 stands unchanged**.

#### 17.2 CB-1 evidence strengthened — the rejection holds on both materialization paths

The first pass established CB-1 through the snapshot-to-MySQL rendering path only. The re-verification
adds the independent live-upgrade path and closes two remaining links.

- **A19 — fresh-bootstrap path.** `server/database/mysql-adapter.js:271` captures the canonical SQLite
  snapshot and `:281` passes it to `bootstrapMySql`; `server/database/mysql-schema.js:414` materializes
  every snapshot table through `tableDefinition()` on a fresh database, and `:314` materializes a missing
  table through the same function on the additive path. `:202` emits the foreign key as
  `FOREIGN KEY (rule_id) REFERENCES credit_check_rules (id) ON UPDATE NO ACTION ON DELETE NO ACTION`,
  and `:205` executes the statement with `ENGINE=InnoDB`. A fresh Wave 10 database therefore carries
  the constraint with an explicit `ON DELETE NO ACTION` delete action.
- **A20 — live-upgrade path, independent of the snapshot.** `server/migrations/sales-customer-wave9-credit-foundation.js:188`
  declares `FOREIGN KEY(rule_id) REFERENCES credit_check_rules(id)` inside the migration's own MySQL
  DDL with **no** `ON DELETE` clause. MySQL's default delete action for an omitted clause is `RESTRICT`,
  which equally rejects the deletion of a referenced parent row. The constraint therefore exists on
  the upgrade path regardless of how the snapshot extractor renders it, and the blocker no longer
  depends on the snapshot rendering behaviour.
- **A21 — every foreign-key-check suspension is paired with a restore.** A repository-wide search finds
  `SET FOREIGN_KEY_CHECKS=0` in exactly two places on the Wave 10 acceptance path, and both restore the
  setting in a `finally` block:
  - `server/database/mysql-schema.js:410` — the bootstrap suspends the checks only while it creates the
    tables and restores them at `:472`. The bootstrap adapter **is** the adapter the acceptance fixture
    uses (`server/test-utils/temp-db.js:90` returns the adapter produced by `createDatabase`, and
    `server/db.js:572-579` dispatches the MySQL backend to `createMySqlDatabase`), so the session that
    later executes the `M-BIZ-19` `DELETE` carries `foreign_key_checks = 1`.
  - `server/test-utils/mysql-wave10-campaign-target.js:267` — the campaign reset, restored at `:276`. It
    runs on the runner's own session, never on the suite child's.

  Every remaining occurrence belongs to a different gate or an unrelated administrative tool, and each of
  those is likewise paired with a restore. The SQLite-local `PRAGMA foreign_keys` toggles
  (`server/migrations/inventory-position-schema.js:296,324` and
  `server/migrations/sales-customer-wave6-returns.js:221,251,323-339`) do not apply to the MySQL backend.
  Nothing on the acceptance path leaves the constraint unenforced while the fixture's own statements run.
- **A22 — the referencing row always exists.** `server/test-utils/wave10-mysql-acceptance-fixture.js:477`
  creates `w10-profile-agg` unconditionally (unlike the salesperson profiles at `:478-479`, which are
  conditional), and `:512` writes `rule_id='w10-race-rule'` into it. `credit_profile.rule_id` is
  nullable, but the fixture populates it, so the parent delete is blocked in every lifecycle.

⇒ **CB-1 is deterministic on both materialization paths.** With A9 (`@@session.foreign_key_checks = 1`
on the dedicated account) the chain is closed: the `M-BIZ-19` `no-rule` variant cannot reach its own
assertions at `:429`/`:430`, `W10-BUSINESS-MATRIX` fails, and the runner aborts the campaign at suite 3.

#### 17.3 New COVERAGE_GAP findings — three, none of them a failure

**CG-3 — `M-MIG-01` compares only CHECK constraints for the two Wave 10 tables.**
`server/mysql-sales-customer-wave10.integration.js:178-185` compares `actual.checks` with
`expected.checks` and nothing else, guarded only by `actual.foreignKeys.length > 0` (`:182`) and
`actual.checks.length > 0` (`:183`), both satisfied by a single foreign key or check. The column set,
the physical types, the NULL/NOT NULL flags, the defaults, the foreign-key column mapping and the index
set of `credit_check_results` and `credit_special_approval` are not compared, although the case title
claims it "creates exactly the approved Wave 10 additions". The contract itself is covered elsewhere:
`M-MIG-06` (`:211-218`) compares fresh against upgrade through `assertEquivalentCreditMetadata`
(`server/test-utils/wave10-mysql-schema-fixture.js:616-627`), which compares columns, foreign keys,
checks and indexes for all eight tables. Not a failure and not converted into a Requirement here; the
finding is that this case's own title overstates its scope.

**CG-4 — the hand-written MySQL DDL materialization path of the Wave 9 tables is never exercised.**
`server/database/mysql-schema.js:114` maps every column whose name ends in `_id` to `VARCHAR(128)`,
so the snapshot path materializes `credit_lock_anchors.policy_scope_id` as `VARCHAR(128)`, while the
Wave 9 migration's own MySQL DDL (`server/migrations/sales-customer-wave9-credit-foundation.js:149-150`)
declares the same column as `LONGTEXT`. Because `bootstrapMySql` always pre-creates the table from the
snapshot and the migration's `CREATE TABLE IF NOT EXISTS` is then a no-op, both the fresh path and the
acceptance's own "upgrade" path (`server/mysql-sales-customer-wave10.integration.js:122-133`, which
bootstraps a Wave 9 bounded snapshot before running the migrations) materialize the column from the
snapshot. The divergence between the two materialization paths is therefore structurally invisible to
the parity suite. Severity is low and the effect is not behavioural: `policy_scope_id` is not a foreign
key, is not indexed, and is NULL for every `CREDIT_OBJECT` anchor that the fixture and the production
anchor builder create. Not a failure.

**CG-5 — `M-BIZ-16`'s second and third evaluations are exact replays of the first.**
The check-group identity is `CCHK1:sha256(sourceType|sourceId|stage|businessDate|authorizationContext|parameterSetHash|ruleSetHash|profileEffectiveStateHash|exposureDigest)`
(`server/modules/credit-check.js:873-876`) and it does **not** include the recognition mode.
`M-BIZ-16` (`server/mysql-sales-customer-wave10-business-matrix.integration.js:392-399`) evaluates the
same order `biz16-order`, the same stage `SO_SUBMIT`, the same business date and the same
`authorizationContext` (`race:biz16-order`,
`server/test-utils/wave10-mysql-acceptance-fixture.js:542`) for all three supported modes, and the
exposure it reads (`sales_orders`, `sales_deliveries`, `account_receivables` —
`server/modules/credit-check.js:226-244`) does not change between the calls. The second and third calls
therefore resolve to the same check group, and `:908` suppresses the `credit_check_results` INSERT and
`:936` the `EVALUATE` audit for a replay. The asserted fact is nevertheless genuinely established:
the mode filter is applied before the check-group identity is built
(`server/modules/credit-check.js:666`), so the decision is recomputed on every call, against a rule
whose `recognition_mode` is NULL
(`server/test-utils/wave10-mysql-acceptance-fixture.js:475`) and therefore applies to every mode. What
the case does not produce is three independent persisted evaluations. Not a failure.

#### 17.4 New UNVERIFIED_RISK — one

**UR-5 — the runner's default per-suite timeout is shorter than the estimated
`W10-BUSINESS-MATRIX` runtime.**
`scripts/gates/mysql-wave10-runner-support.mjs:25` defaults `ERP_MYSQL_WAVE10_SUITE_TIMEOUT_MS` to
`600_000`, with an accepted range of 10000..3600000 (`:26-28`). The 2026-10-26 campaign overrode it to
`1800000` for exactly this reason (`log/2026-10-26.md:1231-1233`), so the override is an already-proven
bounded knob that relaxes no identity, grant, manifest or cleanup guard.
The measured per-lifecycle cost is ≈27 s — `W10-PARITY` 193 s over 7 cases and `W10-RACES` 324 s over
12 cases — and `W10-BUSINESS-MATRIX` performs **23** schema rebuilds (18 single-lifecycle cases plus 2 in
`M-BIZ-19` and 3 in `M-BIZ-20`), i.e. an estimated ≈620 s against a 600 000 ms default.
Trigger: a protected campaign run without the timeout override.
Failure mechanism: the runner raises `WAVE10_MYSQL_SUITE_TIMEOUT`
(`scripts/gates/mysql-wave10-runner-support.mjs:184-186`). If the child's termination is confirmed, the
final protected reset still runs and the target ends at zero objects; if termination is **not**
confirmed, the runner deliberately refuses to touch the target (`:173-181`,
`cleanup = NOT_ATTEMPTED_CHILD_LIVE`) and does not release the campaign lease (`:216`), leaving the
target dirty and the lease held.
Why it is not a confirmed blocker: the runtime is extrapolated, not measured — the suite has never run —
and the override is an available, bounded execution-time knob. It is a precondition on the protected
acceptance stage, recorded in §15.3, and not a defect in any suite.

#### 17.5 Correction to §12 — the delivery-creating case count

The business-matrix cases that create a delivery number **seven**, not eight: `M-BIZ-07`, `M-BIZ-09`,
`M-BIZ-10`, `M-BIZ-11`, `M-BIZ-12`, `M-BIZ-13`, `M-BIZ-14`. `canonicalDelivery` is called directly at
`server/mysql-sales-customer-wave10-business-matrix.integration.js:281` and `:365-366`, and through
`canonicalInvoiceScenario` at `:189` from `:308`, `:318`, `:329`, `:342` and `:354`. `M-BIZ-05`,
`M-BIZ-06` and `M-BIZ-08` create no delivery. The correction changes no conclusion: those seven cases
depend on the shared fixture's OQC quality control point, which the fixture base installs with
`qualityPolicy` defaulting to `true` and which no case overrides.

#### 17.6 Effect on the Requirement set

R01–R08 stand unchanged. None of CG-3, CG-4, CG-5 or UR-5 alters the `no-rule` business fact, the
referential contract, the three distinguishable unenforced paths, the observable contract, the
no-production-change boundary or the no-suite-weakening boundary. §15.3 has been amended with the
protected-acceptance precondition that UR-5 establishes. §12's delivery-creating case count has been
corrected in place, as recorded in §17.5.

#### 17.7 `W10-RACES` audit — two calendar-gated blockers, both re-derived from source

The re-verification confirmed the twelve race capacity expectations and added two defects that are
gated by the calendar rather than by the current date. Both are defects of the acceptance test
contract; neither touches production code.

**CB-2 — `M-R02` hard-codes an approval expiry that becomes invalid.**
`server/mysql-sales-customer-wave10-concurrency.integration.js:292` and `:296` hard-code
`requestedExpiryBusinessDate` and `approvedExpiryBusinessDate` as `'2026-12-31'`.
`server/modules/credit-special-approval.js:169-174` refuses a request whose expiry is earlier than the
result's business date with HTTP 409 `CREDIT_SPECIAL_APPROVAL_EXPIRY_IN_PAST`, and that business date
is the campaign run date (`creditInput` → `wave10BusinessDate()`).
Trigger: a campaign run on or after **2027-01-01**.
Mechanism: the request is refused before the race begins, `request.body?.approval?.id` is undefined and
`assert.ok(approvalId)` at `:294` fails. The whole `W10-RACES` suite aborts, and with it the
`GATE-B-PRODUCTION-RACES` re-run of the same file
(`scripts/gates/mysql-sales-wave10-manifest.mjs:26-29`).
Status: **CONFIRMED_BLOCKER for any campaign on or after 2027-01-01**. It does **not** block a campaign
run on 2026-10-27, because `'2026-12-31'` is still in the future. The sibling business-matrix case
`M-BIZ-04` already avoids this by using `wave10FutureBusinessDate()`
(`server/mysql-sales-customer-wave10-business-matrix.integration.js:234,239`), so the two suites express
the same requirement in two different ways.

**CB-3 — `M-R08` never closes the salesperson Profile predecessor, so two Profiles overlap from 2026-12-31.**
The fixture writes the salesperson anchor key as `...|SCOPE:w10-race-sp-a`
(`server/test-utils/wave10-mysql-acceptance-fixture.js:506`) while production builds
`...|SCOPE:SALESPERSON|w10-race-sp-a` (`server/modules/credit-anchor.js:18-23`). The two keys differ, so
`ensureCreditLockAnchor` provisions a **second** anchor, and `closePredecessorAndAssertNoOverlap`
(`server/modules/credit-profile.js:124-136`) closes a predecessor by `WHERE anchor_id = ?` — the new
anchor, which has no predecessor. The seeded `w10-profile-a` (`effective_from '2026-01-01'`,
`effective_to NULL`) is therefore never closed. `M-R08` creates a second salesperson Profile with
`effectiveFrom: '2026-12-31'`
(`server/mysql-sales-customer-wave10-concurrency.integration.js:476`).
Trigger: a campaign run on or after **2026-12-31**.
Mechanism: from that date both Profiles satisfy `resolveEffectiveCreditProfile`'s predicate
(`server/modules/credit-profile.js:47-54`: `effective_from <= businessDate AND (effective_to IS NULL OR
effective_to >= businessDate)` over the same `customer_id`, `salesperson_scope_key`,
`credit_object_type` and `credit_object_id`), so the resolver throws HTTP 409
`CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS`; the evaluation writes no `credit_check_results` row and
`assert.ok(groups.length > 0)` at `:483` fails. Whether it fails depends on which contender wins the
gate, so it is order-dependent and roughly a coin flip.
Contrast: `M-R04` uses the **aggregate** scope, whose fixture anchor key `SCOPE:AGGREGATE` matches the
production key exactly, so its predecessor *is* closed to `2026-12-30` (`previousDate`,
`server/modules/sales-foundation-common.js:36-40`) and the case is safe. Only the salesperson scope is
affected.
Relation to UR-3: UR-3 recorded the anchor-key divergence itself and classified it as harmless because
`credit_lock_anchors` is outside the persistence projection. That is true but incomplete — the same
divergence also disables the predecessor closure, and that is what turns it into a date-gated blocker.
Status: **CONFIRMED_BLOCKER for any campaign on or after 2026-12-31**, roughly two months from this
pass. It does **not** block a campaign run on 2026-10-27.

Three lower-severity items were also recorded:

- **CG-6 — `M-R02`'s "exactly one effective authority" assertion is a disjunction, not an exclusion.**
  `:312` asserts `approval.decision === 'APPROVED' || order.status === 'APPROVED'`. When the special
  decision wins the gate first, the later standard approval consumes the approval
  (`server/modules/credit-check.js:884-906`), so both predicates hold simultaneously and the
  disjunction cannot distinguish one authority from two. The load-bearing constraints are the
  neighbouring `consumes <= 1` (`:309`) and the Sales Order approve-audit count (`:310-311`). The stated
  invariant is therefore not proven.
- **CG-7 — `M-R04`'s Profile-identity assertion is a tautology.** `:389` asserts that the group's
  `credit_profile_id` is a member of a candidate list built from `old.id` plus every other row of the
  same `credit_profile` table the assertion itself reads. It can only fail if the referenced Profile was
  deleted; it cannot fail on a wrong Profile identity. The sound identity checks are the neighbouring
  `profiles.size === 1` / `fingerprints.size === 1` / `hashes.size === 1` (`:386-388`).
- **UR-6 — `innodb_lock_wait_timeout = 2` against a 15 s gate-admission budget.**
  `server/database/mysql-worker.js:31,108` sets the session lock-wait timeout to 2 seconds while the
  Sales Order gate-admission budget is 15 000 ms
  (`server/modules/sales-gate-retry-admission.js:1`). Every contender blocks on the L0 gate row
  (`server/db.js:2125`), so a first wait-evidence observation that takes longer than 2 s makes the
  contenders abort with `ER_LOCK_WAIT_TIMEOUT`, roll back and retry, which opens gaps in which a
  contender is not pending; `waitForWave10Waiters` allows 30 s
  (`server/test-utils/wave10-mysql-acceptance-fixture.js:196`). If the observation delay exceeded the
  15 s budget the approval would be refused with HTTP 503, which the suite explicitly rejects. The
  failure mode is loud, not silent.

The re-verification also confirmed, from source, that the twelve capacity expectations are each the
only consistent classification, that every contender runs inside `transaction()` and therefore holds the
exclusive `mysql_transaction_gates` lock for the whole transaction (the contenders are serialized, not
merely interleaved), that **no assertion names an ambiguous winner** (M-R01, M-R05 and M-R06 assert
winner *counts*, M-R07 asserts a refusal, M-R09 and M-R10 assert that both contenders refuse), that the
suite contains no `catch` block, no `test.skip`/`todo`/`only` and no conditional registration, and that
`runCoordinatedWave10Race` releases the coordination gate on **every** path
(`server/test-utils/wave10-mysql-acceptance-fixture.js:245-250`), re-throwing the wait-evidence failure
together with the contenders' real outcomes rather than producing a PASS marker.

#### 17.8 W10-ACC-R09 — An approval expiry must not be a fixed calendar literal

Any Special Approval expiry that the acceptance suite requests or approves must remain valid on every
calendar date on which the campaign may be executed. A hard-coded expiry date is not an acceptable
representation of that requirement, because the suite would then encode an execution deadline as if it
were a business fact.

The corrected setup must express the intent — *the approval is valid beyond the current business date* —
in a way that holds for any run date, and must keep the asserted behaviour unchanged: the approval is
requested and decided through the canonical production writer, and the race between the special decision
and the standard approval still resolves to exactly one effective authority.

Acceptance conditions:

1. `M-R02` reaches its own assertions and passes on a campaign run whose business date is **on or after
   2027-01-01**, without any edit to the case's assertions.
2. The requested and approved expiry remain strictly later than the current business date, derived from
   the run date rather than from a literal.
3. The expiry is still bounded and still audited as a business attribute of the approval; it is not
   removed, and it is not widened to an unbounded value.
4. The fix does not change the `M-BIZ-04` behaviour, which already uses the derived form and must keep
   using it.

#### 17.9 W10-ACC-R10 — A Profile version chain must actually be closed

When the acceptance fixture creates a Profile for a scope, the fixture's own scope identity must be the
identity the production code uses for that scope. Otherwise the production predecessor-closure step
operates on an anchor that holds no predecessor, the seeded Profile is never closed, and two Profiles
later qualify for the same scope and business date.

The corrected setup must make the seeded Profile and the production-created Profile part of **one**
anchor and therefore one version chain, so that the production predecessor closure can and does close the
predecessor. The asserted behaviour stays unchanged: after the mutation, the aggregate and the
salesperson result rows belong to one coherent version set, share one policy snapshot fingerprint and
carry one profile effective-state hash.

Acceptance conditions:

1. The seeded salesperson Profile and the Profile created by `M-R08` resolve to the same anchor, so the
   production predecessor closure closes the predecessor rather than leaving it open.
2. `M-R08` reaches its own assertions and passes on a campaign run whose business date is **on or after
   2026-12-31**, and it passes deterministically — the result must not depend on which contender wins the
   coordination gate.
3. `M-R08` still fails closed, as it must, if two Profiles ever do qualify for the same scope and
   business date; the correction must not remove the production `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS`
   guard or weaken its trigger.
4. The aggregate scope (`M-R04`) keeps its current behaviour and its current predecessor closure.
5. No production code, schema, migration, constraint, permission or state machine is modified; the
   correction is confined to the acceptance fixture's own reference data.

#### 17.10 Amended acceptance conditions and effect on the Requirement set

- §13 is amended: acceptance condition 1 now covers the `M-BIZ-19` `no-rule` variant **and** the two
  calendar-gated cases; a new condition requires `M-R02` to hold on or after 2027-01-01, a new condition
  requires `M-R08` to hold deterministically on or after 2026-12-31, and a new condition requires the
  anchor identity of the fixture to match the production scope identity.
- R01–R08 stand unchanged. R09 and R10 (§17.8, §17.9) are added as independent Requirements for CB-2 and
  CB-3. Neither alters the `M-BIZ-19` business fact, the referential contract, the three distinguishable
  unenforced paths, the observable contract, the no-production-change boundary or the no-suite-weakening
  boundary.
- All three confirmed blockers (CB-1, CB-2, CB-3) are defects of the acceptance test contract. None of
  them is a production defect, and none of them requires a schema, migration, constraint, permission or
  state-machine change.
- **CB-1 blocks the next campaign unconditionally.** CB-2 and CB-3 do not block a campaign run on
  2026-10-27, but they must be closed before any campaign executed on or after 2026-12-31, and CB-3 is
  within roughly two months of this pass. The three are best closed in one Design and one Implementation
  unit, because they share the same file set — the business-matrix suite, the concurrency suite and the
  shared acceptance fixture.
- The staged follow-up conditions of §15 are unchanged in substance, except that §15.3 now carries the
  UR-5 timeout precondition.

## Wave 10 Parity Oracle Requirement Addendum (2026-10-27)

### 1. Authorization, scope and stage boundary

The user authorized, under AGENTS.md §4.0 (Consecutive Stage Authorization), one consecutive
`AUDIT → REQUIREMENT → DESIGN` stage for the two remaining Wave 10 Full Acceptance parity blockers,
with a mandatory HARD STOP at the end of Design.

This section records the **Requirement** phase only. The Design phase is authorized to follow
immediately and is recorded in `solution.md` → §37.50. **Implementation is not authorized by this
stage.** No implementation, no test run, no build, no MySQL connection, no database query, no DDL,
no DML, no migration execution, no schema change and no Git write operation is authorized here.

Scope: the correctness of the **Wave 9/10 Schema Parity Oracle** — the acceptance-side machinery
that decides whether the canonical SQLite source and the live MySQL target are the same physical
schema. Scope does **not** extend to a general ERP database redesign, to any business behaviour, or
to any production schema change.

This Addendum is **bounded**. It does not restate the Wave 10 Requirement, the Design of §37.48 or
§37.49, or the approved CHECK cardinality. It adds the requirements that the two live failures
expose, and it corrects one frozen grading whose justification those failures falsified.

### 2. Audit method and evidence levels

The audit was performed by reading the canonical sources, by re-deriving the production MySQL DDL
through the production generator's own exported entry point
(`planMySqlAdditiveReconciliation`, `server/database/mysql-schema.js:310-323`), and by replaying the
**captured campaign transcript** of the failed 2026-10-27 Full Acceptance run
(`%TEMP%\w10recovery\campaign2-wave10.stdout.txt`, the `WAVE10_CHECK_METADATA_EVIDENCE` line, and the
`M-MIG-02` TAP diagnostic block). No MySQL connection was made, no test was executed, no database was
opened, and no repository file was modified during the audit.

Three evidence levels are used and are never conflated:

| Level | Meaning |
|---|---|
| `LIVE_CAPTURED_EVIDENCE` | bytes captured by the failed 2026-10-27 campaign, read back verbatim from the transcript |
| `SOURCE_DERIVED` | re-derived from the current canonical source by executing the production generator's own exported function |
| `TEST_EVIDENCE_PENDING` | not yet observed on a live MySQL server; must not be claimed as verified |

### 3. Verified facts

- **P01** — the production generic generator's **indexed set** is the union of the table's index
  columns and its foreign-key source columns: `server/database/mysql-schema.js:184-187`
  (`...table.indexes.flatMap((index) => index.columns...)` ∪ `...table.foreignKeys.map((fk) => fk.from)`).
  The same rule is duplicated inline in `columnDefinition` at `:209-212`.
- **P02** — the acceptance fixture's **oracle indexed set** is the index columns **only**:
  `server/test-utils/wave10-mysql-schema-fixture.js:17-19`
  (`new Set(table.indexes.flatMap((index) => index.columns).filter(Boolean))`). It contains no
  foreign-key contribution.
- **P03** — both sides feed the **same** production type mapper. The fixture calls
  `mysqlTypeFamily` directly (`wave10-mysql-schema-fixture.js:407-409`), which is
  `server/database/mysql-schema.js:121-125`, which calls `mysqlType` (`:87-116`). **No second type
  mapping exists** in the repository; the defect is in the *indexed predicate* passed into the shared
  mapper, not in the mapping itself.
- **P04** — `mysql-schema.js:114` maps a column to `VARCHAR(128)` when
  `indexed || column.pk || name === 'id' || name.endsWith('_id')`, and to `LONGTEXT` otherwise. The
  `_id` suffix clause therefore **masks** the P01/P02 difference for every foreign-key column whose
  name ends in `_id`. The difference is observable only on foreign-key columns whose name does **not**
  end in `_id`.
- **P05** — the referenced parent columns are all `VARCHAR(128)` in the generic path
  (`users.id`, `customers.id`, `salesperson_profiles.id`, `sales_orders.id`, `sales_deliveries.id`
  and the six Credit `id` columns). InnoDB requires a foreign-key child column to be type-compatible
  with its parent column, so a `LONGTEXT` child column would make the server **refuse the foreign
  key** (errno 150). The oracle's `longtext` prediction therefore does not describe a schema that
  could exist. This is an independent proof that the production generator is right and the oracle is
  wrong, independent of the live failure.
- **P06** — the two Wave 10 tables' physical types are fixed by the approved contract
  `WAVE10_MYSQL_COLUMN_TYPES` (`server/migrations/sales-customer-wave10-credit-check.js:227-273`),
  which the production mapper consults first (`mysql-schema.js:93`). The indexed predicate is
  therefore **irrelevant** for those two tables, and all 41 of their columns agree across every path.
- **P07** — over the **117 columns** of the eight tables, the generic bootstrap path and the hand-
  written migration DDL path diverge in **exactly one** column:
  `credit_lock_anchors.policy_scope_id` — generic `VARCHAR(128)`
  (`mysql-schema.js:114`, the `_id` suffix clause) versus hand-written `LONGTEXT NULL`
  (`server/migrations/sales-customer-wave9-credit-foundation.js:150`).
- **P08** — over the same 117 columns, the **oracle** and the **generic generator** diverge in
  **exactly five** columns, and they are exactly the five foreign-key columns whose names do not end
  in `_id`:

  | Table | Column | Oracle predicts | Generic generator produces | Hand-written DDL |
  |---|---|---|---|---|
  | `credit_parameters` | `created_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:159`) |
  | `credit_check_rules` | `created_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:168`) |
  | `credit_profile` | `created_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:184`) |
  | `credit_policy_snapshots` | `captured_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:197`) |
  | `credit_profile_ratings` | `applied_by` | `longtext` | `varchar` | `VARCHAR(128)` (`:206`) |

- **P09** — the **oracle** and the **hand-written DDL** diverge in exactly six columns: the five of
  P08 plus `credit_lock_anchors.policy_scope_id` of P07. This reproduces the six-column list of the
  2026-10-27 report, but on a **different axis** than that report claimed (see P15).
- **P10** — the live MySQL Credit tables are materialized by the **generic snapshot bootstrap**, not
  by the hand-written migration DDL. `createDatabase` (`server/db.js:572-592`) calls
  `createMySqlDatabase` (`:576`), which bootstraps every table from the SQLite snapshot
  (`mysql-schema.js:414` for a fresh target, `:314` inside `planMySqlAdditiveReconciliation` for an
  additive target), and only **then** replays the migrations (`server/db.js:589`). The migrations'
  `CREATE TABLE IF NOT EXISTS` (`sales-customer-wave9-credit-foundation.js:310`) is therefore a
  no-op. This is proven by the live evidence itself: `credit_lock_anchors` is the **first** table
  `compareWave9SourceTarget` compares (`wave10-mysql-schema-fixture.js:493-503`) and it **passed** all
  four assertion groups live, which is only possible if `policy_scope_id` was `varchar` — the
  hand-written DDL declares it `LONGTEXT`.
- **P11** — the hand-written Wave 9 MySQL DDL is therefore **structurally unreachable** in the
  production bootstrap: both bootstrap branches use the generic `tableDefinition`. The divergence of
  P07 is real, but it is a divergence between one path that runs and one path that cannot run.
- **P12** — the CHECK comparison is asymmetric by construction. `extractCheckClauses`
  (`wave10-mysql-schema-fixture.js:375-401`) **sorts** the normalized canonical forms (`:400`);
  `readNormalizedMySqlTable` (`:479-484`) orders by the **raw** `cc.CHECK_CLAUSE` text and normalizes
  afterwards, so its array order is the catalogue's order, not the canonical order. Two producers of
  the same set therefore produce two differently ordered arrays.
- **P13** — the live catalogue's raw CHECK order is dominated by the **parenthesis-depth prefix** of
  the rendering, not by the identifier: under `utf8mb4_0900_ai_ci` the sequence `((` sorts before
  `(` followed by a backtick, so an `OR` expression such as
  `((`sales_order_id` is not null) or (`sales_delivery_id` is not null))` sorts before an `IN` list
  such as `(`decision` in (_utf8mb4\'PASS\',...))`. Replaying the captured evidence against the
  canonical SQLite source shows: the CHECK **multiset is identical for all eight tables**, while the
  **array order differs for exactly three** — `credit_check_results` (Wave 10 → `M-MIG-01`),
  `credit_check_rules` and `credit_profile_ratings` (Wave 9 → `M-MIG-02`). For the other five tables
  the two orders happen to coincide, which is why the defect is latent rather than universal.
- **P14** — **correcting only the type prediction would not close `M-MIG-02`.** The column assertion
  is the first assertion of the per-table block (`wave10-mysql-schema-fixture.js:499`), so the CHECK
  assertion at `:501` was never reached for `credit_parameters` and was never reached at all for the
  four tables after it. After the type prediction is corrected, `M-MIG-02` would still fail on
  `credit_check_rules: check-constraint parity` and on `credit_profile_ratings: check-constraint
  parity` under P13.
- **P15** — the 2026-10-27 report's attribution is **falsified**. Its six-column table is labelled
  "hand-written MySQL DDL versus canonical type generator", but for five of those six columns the
  canonical generator's prediction is `varchar` — identical to the hand-written DDL — and only the
  **oracle** predicts `longtext`. The report's separate claim that "Wave 9 runs through the hand-
  written DDL path on MySQL" is also falsified by P10. The six-column list is reproducible only on the
  oracle-versus-hand-written axis (P09), which is not the axis on which the live comparison runs.
- **P16** — **CG-4's observation is confirmed and its justification is falsified.** The observation
  (`credit_lock_anchors.policy_scope_id` is `VARCHAR(128)` through the snapshot path and `LONGTEXT`
  through the migration DDL) is correct, and P11 now **proves** that the hand-written path is never
  exercised. The justification recorded in `solution.md` §37.49.10 — "No acceptance path can produce
  the divergence" — is **falsified as a general claim**: `M-MIG-02` is such an acceptance path and it
  failed. It did not fail because of CG-4's divergence, however; it failed because of P08. The correct
  statement is narrower: *the divergent path is the unreachable one*.
- **P17** — the live evidence covers `credit_lock_anchors` (columns, foreign keys, checks and indexes
  all passed) and `credit_parameters` (columns only, failing on `created_by`). The foreign-key, CHECK
  and index assertion groups of `credit_parameters` and of `credit_check_rules`, `credit_profile`,
  `credit_policy_snapshots` and `credit_profile_ratings` were **never reached**. They are
  `TEST_EVIDENCE_PENDING`.
- **P18** — the static parity inventory of the eight tables, re-derived through the production
  generator's own exported entry point and cross-validated against the migrations' own `CONTRACTS`
  with **zero mismatches**: 8 tables, **117 columns**, **25 foreign-key edges**, **23 CHECK
  constraints** (`2/2/5/3/1/3/3/4`), **15 declared indexes** plus **2 SQLite auto-indexes** for the two
  Wave 10 table-level UNIQUE constraints (17 index entries in total), and `id` as the single-column
  primary key of every table.
  Every foreign key is declared without an action on both sides, so both sides normalize to
  `RESTRICT`.

### 4. Root-cause findings and their classification

| ID | Finding | Classification | Evidence |
|---|---|---|---|
| **RC-1** | the CHECK comparison compares two differently ordered arrays of the same set | `SEMANTIC_MISMATCH` in the acceptance **test contract** | P12, P13 |
| **RC-2** | the acceptance oracle's indexed predicate is narrower than the production generator's, so it mis-predicts five foreign-key columns | `SEMANTIC_MISMATCH` in the acceptance **test contract**; **not** a production defect | P01–P05, P08, P10 |
| **RC-3** | the generic bootstrap path and the hand-written Wave 9 migration DDL declare one column differently | `SEMANTIC_MISMATCH` between **two production declarations**, on a path that is structurally unreachable | P07, P11 |
| **RC-4** | the 2026-10-27 report attributed the six divergences to the wrong axis and to the wrong materialization path | **falsified attribution**, recorded for the audit trail | P09, P10, P15 |

**RC-2 is not a production defect.** The production generator's rule is not a heuristic accident: it
is what makes the schema creatable at all (P05). The hand-written Wave 9 DDL agrees with the
production generator on all five RC-2 columns (P08). The defect is that the acceptance oracle
reimplements the indexed predicate and implements it **narrower** than the generator.

**RC-3 is a real production inconsistency, but it is not what failed.** It must be registered as an
independent issue under R10 and must **not** be corrected by an unauthorized migration edit in this
unit.

### 5. Requirement statements

- **W10-PAR-R01 — the CHECK comparison is over the normalized multiset.** Two CHECK sets are equal
  when their **normalized canonical forms** are equal as a **multiset**: the comparison is
  insensitive to the order of the constraints, and it is **sensitive to the number of occurrences**
  of each constraint. A repeated constraint must remain a repeated constraint on both sides.
- **W10-PAR-R02 — the type prediction uses the production generator's rule.** The acceptance oracle
  must derive "is this column indexed" exactly as the production generator does: an indexed column
  **or** a foreign-key source column counts. The prediction for a foreign-key column must therefore
  be the generator's `VARCHAR(128)`, not `LONGTEXT`.
- **W10-PAR-R03 — the prediction must consume the production mapper.** The physical type family must
  continue to be produced by the production `mysqlTypeFamily`, or by the production generator's own
  emitted DDL. A second, hand-written type mapping in the acceptance layer is prohibited, and a
  hand-written copy of the **indexed predicate** is permitted only if a local regression proves it
  equal to the production generator's rule for every column of all eight tables.
- **W10-PAR-R04 — all eight tables are compared on the complete physical contract.** For every one of
  the six Wave 9 tables and the two Wave 10 tables, the comparison covers: column name and ordinal,
  physical type family, nullability, default, primary key, foreign keys with their actions, index
  identity, index uniqueness and column order, and the CHECK set. The comparison must not stop at the
  first difference; it must be exhaustive.
- **W10-PAR-R05 — the two Wave 10 tables keep their approved physical contract.** The approved
  `WAVE10_MYSQL_COLUMN_TYPES` contract and the hand-written Wave 10 MySQL DDL are unchanged, and the
  two tables' column types are unchanged by this unit.
- **W10-PAR-R06 — both initialization paths are covered.** The **generic snapshot bootstrap** path
  and the **hand-written migration DDL** path are both covered by the local regression, so that a
  divergence between them is detected by the local gate rather than by a protected campaign.
- **W10-PAR-R07 — a real schema divergence must remain detectable.** After the corrections, a genuine
  divergence between the canonical source and the live target must still fail the comparison. This
  includes RC-3: if the live table were materialized from the hand-written DDL, the difference on
  `credit_lock_anchors.policy_scope_id` must still be reported.
- **W10-PAR-R08 — no false-green route.** A PASS must not be obtained by hard-coding an exception for
  the five RC-2 columns, by removing the column-type comparison, by treating `TEXT`, `VARCHAR` and
  `LONGTEXT` as one family, by ignoring foreign-key columns, by dropping or weakening any CHECK, by
  lowering the approved CHECK cardinality, by ignoring the `raw:` fallback of the normalizer, by
  accepting an unparsable expression, by modifying the production MySQL schema, or by adapting the
  production DDL to a wrong test expectation.
- **W10-PAR-R09 — the corrections are covered by an engine-neutral local regression.** The regression
  must reproduce both live failures offline, prove the negative cases still fail, and keep the
  existing parity, index, foreign-key, migration-idempotency and CHECK-parsing regressions intact.
- **W10-PAR-R10 — RC-3 is registered as an independent issue.** The `credit_lock_anchors.policy_scope_id`
  divergence between the generic bootstrap path and the hand-written Wave 9 migration DDL is recorded
  as a separate open issue with its own Requirement. It is **not** corrected by this unit, and the
  Wave 9 migration DDL is **not** modified. Any future correction that touches a migration requires
  its own Requirement and Design.

### 6. Acceptance conditions

1. The eight tables' CHECK sets compare **equal** when the two sides hold the same normalized
   constraints in a different order, and **unequal** when a constraint is missing, when the number of
   occurrences of a constraint differs, or when a constraint's expression differs.
2. The comparison preserves the `raw:` fallback: an unparsable clause keeps its distinct `raw:` form
   and never compares equal to a parsed form.
3. The oracle's predicted physical type family equals the production generator's for **all 117
   columns** of the eight tables, and in particular for the five RC-2 foreign-key columns.
4. A plain, non-indexed, non-foreign-key `TEXT` column is still predicted `longtext` — the
   correction must not over-apply.
5. The two Wave 10 tables' approved physical contract is unchanged, and their columns compare equal
   against the generic generator's output.
6. The `credit_lock_anchors.policy_scope_id` divergence between the generic path and the hand-written
   path is **detected** by the local regression.
7. The full inventory — 117 columns, 25 foreign keys, 23 CHECK constraints, the index sets and the
   primary keys of all eight tables — is asserted by the local regression, and it matches the
   migrations' own `CONTRACTS` with zero mismatches.
8. The existing local regressions — the CHECK normalizer suite, the index-parity suite, the
   foreign-key and physical-type contracts, the migration-idempotency suite — are unchanged and
   still pass.
9. The protected suite's case identities, counts, evidence levels and M-board shape are unchanged, and
   no assertion is deleted, skipped, weakened or reclassified.
10. No production code, schema, migration, constraint, permission, state machine, business rule or
    data is modified. The unit is confined to the acceptance test contract and its local regression.
11. The corrected `M-MIG-01` and `M-MIG-02` pass on a protected campaign, and the previously
    unreached foreign-key, CHECK and index assertion groups of the five Wave 9 tables after
    `credit_parameters` obtain their first live evidence.

### 7. Compatibility boundary and prohibited changes

- **Unchanged:** the production MySQL generator and every rule in it; the production DDL of every
  table; the Wave 9 and Wave 10 migrations; the approved `WAVE10_MYSQL_COLUMN_TYPES` contract; the
  approved CHECK cardinality of the eight tables; the CHECK normalizer's grammar, its two literal
  dialects and its `raw:` fallback; the index-parity contract and its backend-generated-name
  exception; the foreign-key support-index exception; the protected suite manifest, case
  identities, evidence levels and M-board shape; the package version and the release tags.
- **Prohibited in the future Implementation:** hard-coding an exception for the five RC-2 columns;
  removing, weakening or skipping the column-type comparison; collapsing `TEXT` / `VARCHAR` /
  `LONGTEXT` into one family; ignoring foreign-key columns in the prediction; deleting or weakening
  any CHECK; lowering the approved CHECK cardinality; ignoring or disabling the `raw:` fallback;
  accepting an unparsable expression as equivalent to a parsed one; modifying the production MySQL
  schema; adapting the production DDL, the hand-written migration DDL or the approved Wave 10
  contract to a wrong test expectation; removing, skipping, weakening or reclassifying any protected
  case; changing the runner, the manifest or the suite registration; touching a protected target, an
  account or a grant.

### 8. Corrected CG-4 classification and the falsified deferral justification

`solution.md` §37.49.10 graded **CG-4** as `DEFERRABLE_WITH_JUSTIFICATION` with the stated reason:
"`credit_lock_anchors.policy_scope_id` is `VARCHAR(128)` through the snapshot path and `LONGTEXT`
through the migration's own DDL, but both are the same text family and the column is not a foreign
key, is not indexed and is NULL for every anchor the fixture and the production builder create.
**No acceptance path can produce the divergence**, and any future correction would touch a
migration, which needs its own Requirement."

This Addendum records the following corrections:

1. **The deferral justification is falsified and must not be carried forward.** `M-MIG-02` **is** an
   acceptance path, and it failed. The clause "no acceptance path can produce the divergence" is
   therefore not a valid basis for deferral and is withdrawn.
2. **The observation stands and is now proven.** The two paths really do declare the column
   differently (P07), and the hand-written path is now proven to be structurally unreachable (P11).
3. **The failure was caused by a different root cause.** `M-MIG-02` failed on the oracle's indexed
   predicate (RC-2), not on CG-4's divergence. CG-4's divergence was never reached, because
   `credit_lock_anchors` compares equal.
4. **The corrected grading** of CG-4 is therefore:
   - the **subject** — "the hand-written MySQL DDL materialization path of the Wave 9 tables is never
     exercised" — is **CONFIRMED** and is now **proven** rather than inferred;
   - the **reason** is restated as: *the divergent declaration lives on the unreachable path, and the
     path that runs is the one the acceptance compares against*;
   - the **latent inconsistency** between the two declarations is registered as an **independent
     open issue** under W10-PAR-R10, and is **not** corrected by this unit;
   - CG-4 is **no longer** deferred on the basis of a falsified justification. It is deferred on the
     basis of the corrected, narrower and now-proven reason, and its residual consequence — one
     column whose declared type differs between a reachable and an unreachable path — is registered
     as an open issue rather than as a justification.
5. `CG-3` (`M-MIG-01` compares only CHECK constraints for the two Wave 10 tables) is **unchanged** and
   remains `SEPARATE_REQUIREMENT_REQUIRED`: this Addendum does not widen `M-MIG-01`'s comparison scope
   to the columns, foreign keys and indexes of the two Wave 10 tables. That remains a separate
   Requirement.

### 9. Staged follow-up conditions

1. **Design** — the mechanism for the order-insensitive, duplicate-preserving CHECK comparison, the
   alignment of the oracle's indexed predicate with the production generator's rule, the exact file
   list, the offline reproduction of both live failures, the negative regressions and the acceptance
   evidence plan, ending in a HARD STOP.
2. **Implementation** — only after a separate explicit authorization, confined to the acceptance test
   contract and its local regression.
3. **Protected Acceptance** — only after a separate explicit authorization for exactly one
   `pnpm.cmd test:mysql:wave10` run against the dedicated disposable target, with the read-only
   preflight repeated first.

### 10. OPEN facts

```text
OPEN  the real-MySQL result of M-MIG-01 / M-MIG-02 after the parity-oracle remediation
OPEN  the real-MySQL result of W10-RACES (12 cases) and W10-BUSINESS-MATRIX (20 cases), never executed
OPEN  the foreign-key / CHECK / index assertion groups of credit_parameters, credit_check_rules,
      credit_profile, credit_policy_snapshots and credit_profile_ratings (TEST_EVIDENCE_PENDING)
OPEN  RC-3 — credit_lock_anchors.policy_scope_id is declared VARCHAR(128) by the generic bootstrap
      path and LONGTEXT by the hand-written Wave 9 migration DDL (independent issue, W10-PAR-R10)
OPEN  CG-3 — M-MIG-01 compares only the CHECK constraints of the two Wave 10 tables
OPEN  CREDENTIAL_EXPOSURE_OPEN
OPEN  WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN
OPEN  WAVE10_CLASSIFICATION_ALGEBRA_LOCAL_REGRESSION_ABSENT
OPEN  WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
```

**Requirement status: `WAVE10_PARITY_ORACLE_REQUIREMENT_COMPLETE`.**

## Wave 10 Inventory Fixture Requirement (2026-10-27)

### 1. Authorization, scope and stage boundary

The user explicitly authorized, under AGENTS.md §4.0 (Consecutive Stage Authorization), one consecutive
`REQUIREMENT → DESIGN` stage for the single shared root cause behind the two remaining Wave 10
Full Acceptance failures (`M-BIZ-12`, `M-BIZ-14`), with a mandatory HARD STOP at the end of Design.

This section records the **Requirement** phase only. The Design phase is authorized to follow
immediately and is recorded in `solution.md` → §37.51. **Implementation is not authorized by this
stage.** No implementation, no test run, no build, no MySQL connection, no database query, no DDL,
no DML, no migration execution, no schema change and no Git write operation is authorized here.

Scope: the **shape of the stock that the Wave 10 shared acceptance fixture seeds**, and the independent
production inventory correctness risk that the same failure exposes. Scope does **not** extend to the
production out-bound availability check, to the inventory schema, to any migration, to the accounting,
valuation or AR/AP semantics, or to any other business behaviour. No production code is modified by
the unit this Requirement authorizes.

### 2. Evidence base and evidence levels

The Requirement was derived from the real code at HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6` and
from the **captured** transcript of the failed 2026-10-27 protected Full Acceptance campaign
(`%TEMP%\w10final\final-acceptance.stdout.txt`, 19473 bytes, process exit code `1`). No database was
opened, no test was executed and no repository file was modified while the facts below were
established.

| Level | Meaning |
|---|---|
| `LIVE_CAPTURED_EVIDENCE` | bytes captured by the failed 2026-10-27 protected campaign, read back verbatim from the transcript |
| `SOURCE_DERIVED` | re-derived from the current canonical source by reading the exact production writer, schema and adapter code paths |
| `TEST_EVIDENCE_PENDING` | not yet observed on a live MySQL server; must not be claimed as verified |

### 3. Verified facts — the shared root cause

- **P01** — `server/test-utils/wave10-mysql-acceptance-fixture.js:523-530` — `seedWave10Inventory()`
  seeds the Wave 10 acceptance stock with
  `INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at) VALUES(?,?,?,?,?)`,
  i.e. **without** `position_key`.
- **P02** — `server/migrations/inventory-position-schema.js:228` and `:304` — `inventory.position_key` is
  a **nullable** `TEXT` column, and the legacy `UNIQUE(warehouse_id, product_id)` is dropped by the
  table rebuild at `:295-325`. A row may therefore legally exist with `position_key = NULL`.
- **P03** — the fixture runs **after** the schema migration:
  `server/mysql-sales-customer-wave10-business-matrix.integration.js:68-73` calls `createTempDb(...)`
  and then `seedWave10AcceptanceBase(...)`, and `seedWave10AcceptanceBase` calls
  `seedWave10Inventory(db)` at `wave10-mysql-acceptance-fixture.js:515`. The migration's legacy
  backfill (`inventory-position-schema.js:237-276`) therefore **never observes the fixture row**; the
  row is born with `position_key = NULL` and stays that way for the whole case.
- **P04** — the legacy row's remaining dimension columns take their column defaults:
  `owner_type = 'ENTERPRISE'` (`inventory-position-schema.js:230`), `stock_status = 'AVAILABLE'`
  (`:232`), `bin_id / lot_id / serial_id = NULL` (`:229 / :233 / :234`), `active = 1` (`:235`).
  The seeded row therefore already carries the **canonical default dimensions** and differs from a
  canonical row **only** in `position_key`.
- **P05** — the canonical physical write path is `adjustInventory()` → `resolveCanonicalPosition()` →
  `upsertByPositionKey()` (`server/lib/stock.js:83-89`, `:35-58`, `:60-89`). The upsert executes
  `INSERT INTO inventory(...) ON CONFLICT(position_key) DO UPDATE SET quantity = inventory.quantity + excluded.quantity`.
- **P06** — the MySQL adapter rewrites that clause into `ON DUPLICATE KEY UPDATE`
  (`server/database/mysql-adapter.js:60`). A `NULL` value never conflicts in a `UNIQUE` index, so the
  legacy row's `position_key = NULL` **cannot** match `uq_inventory_position_key`. The upsert
  consequently **inserts a second row**, and because the insert path carries the *delta* of the
  movement, that new row's `quantity` is **-1**, not the resulting balance. A negative shadow row is
  born by the first confirmed Delivery.
- **P07** — the availability pre-check reads
  `SELECT quantity FROM inventory WHERE warehouse_id = ? AND product_id = ?` with **no** `position_key`,
  `owner_type`, `owner_id` or `stock_status` filter and **no** deterministic row selection
  (`server/app.js:5645` — creation path; `server/app.js:5876` — confirmation path).
- **P08** — `inventory.id` is the MySQL `VARCHAR(128)` PRIMARY KEY
  (`server/database/mysql-schema.js:114` and `:191`), i.e. the clustered index. The canonical row's id
  is `randomUUID()` (`server/db.js:2209-2210`); every hexadecimal character of a UUID sorts **below**
  `'w'` (0x77), so the canonical row sorts **before** the fixture row `'w10-race-inventory'` in every
  id-ordered scan. The read therefore returns the canonical row with `quantity = -1` first.
- **P09 — dialect divergence (load-bearing for the regression design).** On SQLite the same read is
  served by `idx_inventory_product_wh_status` (`inventory-position-schema.js:280`), on which the two
  rows tie on `(product_id, warehouse_id, stock_status)`; SQLite breaks the tie by `rowid`, and the
  legacy row has the smaller rowid. The read therefore returns `quantity = 100` on SQLite and
  `quantity = -1` on MySQL. **The defect is consequently not reproducible on SQLite by asserting that
  the Delivery is refused.** It is proven today by the existing local regression
  `server/sales-customer-wave10-quality-policy.test.js` → `W10-QCP-T02`, which confirms a complete
  canonical Delivery on SQLite **with the defective fixture still in place**.
- **P10** — `LIVE_CAPTURED_EVIDENCE` — the protected transcript contains, verbatim:
  `not ok 12 - M-BIZ-12 S14 multiple delivery links conserve one invoice header` with
  `error: 'canonical delivery creation failed: 400 {"error":"W10-RACE-P 库存不足","code":"VALIDATION","message":"W10-RACE-P 库存不足","requestId":"b9c0b0b7-1e95-4934-a3c3-a8f25d88a417","status":400}'`
  and `not ok 14 - M-BIZ-14 S14 multi-salesperson residual is not guessed` with
  `error: 'canonical delivery creation failed: 400 {"error":"W10-RACE-P 库存不足", …}'`.
  Both stacks carry the frame `canonicalDelivery (…/business-matrix.integration.js:113:11)`.
- **P11** — the captured message identifies the **creation** path and not the confirmation path:
  `createSalesDelivery` composes the message as `(product?.code || item.productId) + ' 库存不足'`
  (`server/app.js:5646`), so the product code `W10-RACE-P` is present, whereas the confirmation path
  throws the bare `'库存不足'` (`server/app.js:5877`). The captured message contains `W10-RACE-P`,
  therefore **the refusal happened in `createSalesDelivery`**, on the *second* Delivery.
- **P12** — `M-BIZ-13`, the same chain with **one** Delivery, **passed** in the same campaign, which
  isolates the defect to the second Delivery of the same `(warehouse_id, product_id)` pair.

**Shared root cause — established.** `M-BIZ-12` and `M-BIZ-14` both reach the stock through
`seedWave10AcceptanceBase()` → `seedWave10Inventory()` → the same
`(w10-race-warehouse, w10-race-product)` pair, and both fail at the **creation of their second
Delivery**. The two failures therefore share one root cause: the acceptance fixture seeds a
**legacy-shaped** inventory row (P01–P04) that the canonical write path cannot match (P05–P06), and
the production availability read then selects the resulting negative shadow row (P07–P08, P11).
It is a **test-fixture defect**, not a production behaviour defect of the Delivery chain.

### 4. The complete inventory state-transition tables

#### 4.1 The current (defective) path — `M-BIZ-12` and `M-BIZ-14`

| # | Event | Rows for `(w10-race-warehouse, w10-race-product)` | Available read | Result |
|---|---|---|---|---|
| 0 | schema migration applied | *(table empty)* | — | — |
| 1 | `seedWave10Inventory()` (P01–P04) | `id='w10-race-inventory'`, `quantity=100`, **`position_key=NULL`**, `owner_type='ENTERPRISE'`, `owner_id=NULL`, `stock_status='AVAILABLE'`, `bin_id/lot_id/serial_id=NULL`, `active=1` | — | seeded in legacy shape |
| 2 | Delivery #1 **creation** (`app.js:5645`) | unchanged | `100` (single row) | `100 ≥ 1` ⇒ **201** |
| 3 | Delivery #1 **confirmation** (`app.js:5876`) | unchanged | `100` | `100 ≥ 1` ⇒ passes |
| 4 | Delivery #1 **deduction** (`adjustInventory` → P05/P06) | **two** rows now exist: `w10-race-inventory` (`quantity=100`, `position_key=NULL`) **and** a canonical row (`quantity=-1`, canonical `position_key`, `id=randomUUID()`) | — | **negative shadow row created** |
| 5 | Delivery #2 **creation** (`app.js:5645`) | two rows | MySQL returns the canonical row first (P08) → **`-1`** | `-1 < 1` ⇒ **HTTP 400 `W10-RACE-P 库存不足`** |
| 6 | Delivery #2 **confirmation** | — | — | **never reached** |

Both captured failures stop at step 5 (P10, P11). The legacy row is never decremented; the canonical
row is created already negative; no row ever reaches `quantity = 99` or `98`.

#### 4.2 The required path after the fixture correction

| # | Event | Rows for the pair | Canonical row `quantity` | Result |
|---|---|---|---|---|
| 0 | schema migration applied | *(table empty)* | — | — |
| 1 | fixture seeds through the canonical absolute writer | **one** row, `position_key` = production `computePositionKey(...)`, `owner_type='ENTERPRISE'`, `owner_id=NULL`, `stock_status='AVAILABLE'`, `bin_id/lot_id/serial_id=NULL`, `active=1` | **100** | one canonical position established |
| 2 | Delivery #1 creation | one row | `100` | `100 ≥ 1` ⇒ **201** |
| 3 | Delivery #1 confirmation + deduction | **one** row (the same row, matched by `ON DUPLICATE KEY UPDATE`) | **99** | balance `99` |
| 4 | Delivery #2 creation | one row | `99` | `99 ≥ 1` ⇒ **201** |
| 5 | Delivery #2 confirmation + deduction | **one** row | **98** | balance `98` |

Invariants that must hold at every step: exactly **one** row for the pair; **zero** rows with
`position_key IS NULL`; **zero** rows with a negative quantity; the `quantity` sequence
`100 → 99 → 98`; the `inventory_transactions.balance_after` sequence `99 → 98`.

### 5. Requirement clauses

- **W10-INV-R01** — the acceptance fixture must seed the Wave 10 stock through the **production
  canonical absolute writer** `setInventoryQuantity(db, warehouseId, productId, quantity, now)`
  (`server/lib/stock.js:126-148`), and never through a raw `INSERT INTO inventory`.
- **W10-INV-R02** — the canonical position identity of the seeded row must be produced by the
  **production** identity functions `resolveCanonicalPosition()` (`server/lib/stock.js:35-58`) and
  `computePositionKey()` (`server/lib/inventory-position.js:113-134`). The fixture must not maintain
  a second position-key format, a second dimension tuple, or a hand-written hash.
- **W10-INV-R03** — the seeded row must carry `owner_type = 'ENTERPRISE'`, `owner_id = NULL`,
  `stock_status = 'AVAILABLE'`, `bin_id = NULL`, `lot_id = NULL`, `serial_id = NULL`, `active = 1`,
  and an **absolute** `quantity = 100` EA.
- **W10-INV-R04** — after seeding, exactly **one** inventory row may exist for the fixture
  `(warehouse_id, product_id)` pair, and **zero** rows may carry `position_key IS NULL`.
- **W10-INV-R05** — the first canonical Delivery confirmation must leave that row at `quantity = 99`
  and the second at `quantity = 98`, with the row count for the pair unchanged at one and no negative
  row created at any point.
- **W10-INV-R06** — the existing `DELETE FROM inventory WHERE warehouse_id=? AND product_id=?` in
  `seedWave10Inventory()` must be retained and must execute **before** the canonical write, so that
  re-running the seed can never leave a second row behind.
- **W10-INV-R07** — the fixture must remain idempotent: a second invocation of
  `seedWave10AcceptanceBase()` on the same database must leave exactly one canonical row for the
  pair.
- **W10-INV-R08** — **no production code path may change.** The formal out-bound delivery, the
  inventory deduction, the inventory transaction, the valuation movement, the Finance recognition,
  the AR/AP settlement and the state machines stay exactly as they are. No schema, no migration, no
  index and no historical business data may change.
- **W10-INV-R09** — the correction must be dialect-neutral: the same canonical identity and the same
  `100 → 99 → 98` sequence must result on SQLite and on MySQL, and the fixture must not branch on the
  dialect.
- **W10-INV-R10** — every existing consumer of the shared acceptance fixture must remain green:
  `server/sales-customer-wave10-quality-policy.test.js` (`W10-QCP-T01..T04`),
  `server/sales-customer-wave10-acceptance-contract.test.js` (`AC-01..AC-11`),
  `server/sales-customer-wave10-mysql-parity.test.js`, `server/sales-customer-wave10-credit-check.test.js`,
  and the protected Gate B and Business Matrix suites.
- **W10-INV-R11** — the seeded inventory row's `id` must not be depended upon by any test. The
  correction replaces the fixed id `'w10-race-inventory'` with the production writer's generated id;
  a repository-wide search found **zero** references to `'w10-race-inventory'` outside the fixture
  itself, and `seedWave10Inventory()` has exactly **one** caller
  (`seedWave10AcceptanceBase()`, `wave10-mysql-acceptance-fixture.js:515`). There is therefore no
  compatibility obligation to preserve the old id, and no existing test may be broken by its removal.
- **W10-INV-R12** — the local regression must assert the **position identity, the row count and the
  balance sequence**, and must not be satisfied by "the Delivery succeeded". Because of P09 the
  SQLite row order masks the MySQL refusal, so a regression that only asserts the business outcome
  would be green against the defective fixture and would prove nothing.
- **W10-INV-R13** — the new local regression `server/sales-customer-wave10-inventory-fixture.test.js`
  must be registered in the **`FULL`** suite **only**, and must **not** be registered in `FAST`. The
  manifest's own `FAST` classification criterion is that `FAST` "Must not require a temp SQLite or
  Vite SSR" (`scripts/testing/test-suites.js:19-20` and `:573-575`), while `W10-INV-T01`..`T08` need a
  real database state, the canonical inventory position identity and the deduction verification, and
  `createTempDb()` (`server/test-utils/temp-db.js:72`) is what supplies that state — as a disposable
  temp SQLite. The fixture must **not** bypass `createTempDb()` in order to qualify for `FAST`. This
  unit changes **no** existing `FAST` / `FULL` / `HEAVY` classification; the only count that moves is
  `FULL`, by the new file's single entry.
- **W10-INV-R14** — the regression must distinguish, per case and in the report, a **reproduction of a
  known defect** from a **pass of the new Fixture contract**, and must never present the one as the
  other. In particular the duplicate-row case `W10-INV-T05` must be made **deterministic by
  construction**: the legacy row's quantity must satisfy the requested quantity under **either** row
  selection of the unfiltered availability read, so the case asserts the **write** outcome (the
  canonical row moves, the legacy row does not) and asserts **nothing** about which row that read
  selected. A variant in which the two rows differ is a **known-risk reproduction** of
  `W10-INV-RISK-01` and is **never** evidence that the new Fixture contract holds.

### 6. Acceptance conditions

- **AC-INV-01** — with the corrected fixture, the pair `(w10-race-warehouse, w10-race-product)`
  carries exactly one inventory row after seeding, its `position_key` is non-`NULL` and equals the
  production `computePositionKey()` of the canonical default identity, and its `quantity` is `100`.
- **AC-INV-02** — the negative reproduction is retained: a deliberately seeded legacy row
  (`position_key IS NULL`, `quantity = 100`) must be proven to produce, after one canonical
  confirmation, **two** rows for the pair — one with `position_key IS NULL` and one canonical row
  with `quantity = -1`. This is the machine-verifiable proof of the root cause.
- **AC-INV-03** — two canonical confirmations against the corrected fixture leave exactly one row
  for the pair with `quantity = 99` and then `98`; the `inventory_transactions` rows carry
  `quantity_change = 1` and `balance_after = 99` and `98`.
- **AC-INV-04** — the **missing** case is not a PASS: with the canonical row absent, the canonical
  Delivery creation must be refused by the production availability check (the production refusal,
  not a test-local assertion).
- **AC-INV-05** — the **duplicate** case is not a PASS: with a legacy row present beside the
  canonical row, the canonical deduction must move the **canonical** row and must leave the legacy
  row's quantity untouched.
- **AC-INV-06** — the **wrong identity** case is not a PASS: a row carrying a non-canonical
  `position_key` (or a wrong `owner_type` / `stock_status`) must not be decremented by the canonical
  writer; its quantity must remain unchanged.
- **AC-INV-07** — the negative regressions must fail against the **defective** fixture and pass
  against the corrected one, and must be executed on a backend that cannot resolve to MySQL.
- **AC-INV-08** — `pnpm test:fast`, `pnpm test`, `pnpm test:heavy`, `pnpm build` and
  `git diff --check` must all pass, and the local test backend must be isolated from MySQL. The new
  regression of `W10-INV-R13` is executed by the **`FULL`** gate (`pnpm test`) and is deliberately
  **absent** from `FAST`; a green `pnpm test:fast` is therefore **not** evidence for
  `W10-INV-T01`..`T08` and must not be reported as such.

### 7. Compatibility and forbidden changes

- **Compatible by construction**: the fixture's public shape (`seedWave10AcceptanceBase`, its options,
  its returned objects) does not change; the seeded pair, the product, the warehouse and the
  quantity are unchanged; the canonical delivery, valuation, Finance and Credit behaviour is
  unchanged; the protected case identities, the manifest, the runner and the evidence grades are
  unchanged.
- **Forbidden in this unit**: any change to `server/app.js`, `server/lib/stock.js`,
  `server/lib/inventory-position.js`, `server/modules/*`, the inventory schema, any migration, the
  protected suite assertions, the runner, the manifest, `package.json`, `AGENTS.md`, `README.md`,
  `APPLY_GUIDE.md`, and any historical business data.
- **Forbidden outcome**: the two failures must not be made to disappear by weakening an assertion,
  by changing an amount, by changing a delivery count, by relaxing a tolerance or by skipping a case.

### 8. Independent production inventory correctness risk — `W10-INV-RISK-01`

The failure exposed a production-side robustness gap that **the fixture correction does not resolve**
and that must not be reported as resolved.

- **Subject** — `createSalesDelivery()` (`server/app.js:5645`) and `confirmSalesDelivery()`
  (`server/app.js:5876`) read the available stock with
  `SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?` and take **the first row**
  returned. The read carries **no** `position_key`, `owner_type`, `owner_id` or `stock_status` filter
  and **no** deterministic row selection, while the physical identity of a stock row is the
  multidimensional `position_key` (`server/lib/inventory-position.js:1-21`).
- **Reachability** — the read mis-selects whenever **more than one active row exists for the same
  `(warehouse_id, product_id)` with different canonical identities**. Such a state is reachable in
  production: the demo seed writes `position_key = NULL` rows (`server/db.js:1827-1838`), and the
  migration's legacy backfill can itself emit a **non-canonical** key — the `:rid` suffix path at
  `server/migrations/inventory-position-schema.js:270` and the `:fallback` path at `:273` produce
  `position_key` values that are **not** equal to `computePositionKey(...)`. A row written after a
  migration, or a backfilled row carrying a suffix, therefore coexists with a canonical row.
- **Possible impact — two directions, both reachable from the source.** The attribution of the
  **observed** acceptance failures to the fixture shape (§4.1) is unchanged, but the **defect's own**
  risk boundary is wider than that observed failure mode and must **not** be described as "only a
  possible false out-of-stock report":
  - **Direction A — false refusal.** The read selects a row whose quantity is lower than the
    canonical position's, so the production guard (`server/app.js:5646`, `server/app.js:5877`)
    refuses a Delivery that the stock could satisfy. This is the failure mode actually observed
    (`P08`, `P10`, `P11`).
  - **Direction B — false allowance, then a negative canonical balance.** The read selects a
    legacy-shaped or otherwise differently-identified row whose quantity is **higher** than the
    canonical position's, so the guard **passes** and the out-bound proceeds although the canonical
    position cannot cover it. The write path is canonical — the delta always lands on the canonical
    row — but the canonical upsert carries **no** negative-balance guard
    (`server/lib/stock.js:60-89`: `quantity = inventory.quantity + excluded.quantity`), so the
    canonical row can be driven **below zero**.
  - Both directions are `SOURCE_DERIVED` conclusions from the read semantics and the known data
    shapes; only direction A was observed.
- **Evidence grade** — `LIVE_CAPTURED_EVIDENCE` for the *read semantics* (the protected campaign
  proved that the read returns the shadow row and refuses), `SOURCE_DERIVED` for the code path.
  For **real production data** the grade is `TEST_EVIDENCE_PENDING`: no production dataset was
  inspected in this stage, so the **prevalence** of legacy-shaped rows in production is **not**
  established and must not be asserted.
- **Freeze impact — no pre-decision.** This Requirement **does not** decide that `W10-INV-RISK-01`
  blocks, or does not block, the Wave 10 Final Freeze. What broke the acceptance is the **fixture's**
  legacy shape and the fixture correction removes that manufactured trigger; the production read
  defect is independent of it, and direction B above is a reachability conclusion this unit does not
  close. The **Final Freeze Review** must therefore take an **explicit, recorded risk-disposition
  decision**: either close the risk through its **own** Requirement and Design, or **accept** it with
  a written justification under an **explicit authorization**. A silent omission, or a blanket
  "not a blocker" assertion carried over from this section, does **not** discharge it.
- **Boundary of this unit** — the production read is **not** modified here, and `W10-INV-RISK-01` is
  **not** part of the Fixture Implementation's production-code scope. This unit authorizes the fixture
  correction and the registration of this risk only. Any correction of the production read needs its
  own Requirement, its own Design and its own acceptance.

### 9. Post-stock readiness assessment

The two failing cases were audited **after** the second Delivery would succeed, so that the stock
defect does not merely expose the next statically discoverable failure. Each item below was checked
against the real source.

| # | Item | Finding | Grade |
|---|---|---|---|
| 1 | `sales_delivery_no` millisecond collision | `'SD' + Date.now().toString().slice(-10)` (`server/app.js:5650`) and `delivery_no TEXT NOT NULL UNIQUE` (`server/db.js:1220`). Two Deliveries created in the same millisecond collide, and the collision is an **explicit UNIQUE constraint failure**, never a silent overwrite. The two Deliveries of `M-BIZ-12` are separated by a full canonical confirmation (credit check, lock sequence, valuation movement, vouchers) plus a fresh scrypt login, so the collision is not reachable here. | `SOURCE_DERIVED`, not a blocker |
| 2 | Sales Order remaining deliverable capacity | The order line's `upper_delivery_tolerance_bps` is copied from the product classification (`server/modules/sales-orders.js:361`) and is `0` in the fixture, so the upper capacity is exactly `2.000000` EA for `M-BIZ-12` (`toleranceBoundsMicros`, `server/modules/sales-delivery-source.js:10-15`). The check at `server/app.js:5639` sees `1 + 1 ≤ 2` on the second Delivery and passes. | `SOURCE_DERIVED`, passes |
| 3 | OQC gate and approved-order state | The fixture installs one real `SALES_DELIVERY` control point through the canonical writer **before** any Delivery exists (`wave10-mysql-acceptance-fixture.js:465` → `seedWave10QualityPolicy`), and the creation path freezes the policy at document creation. `assertQualityGate(db, 'OQC', deliveryId)` (`server/app.js:5843`) therefore passes. Proven today on SQLite by `W10-QCP-T02`. | `SOURCE_DERIVED` + existing local proof |
| 4 | Finance invoice source linkage | `prepareSalesLines` (`server/modules/commercial-golive.js:99-114`) requires a **CONFIRMED** Delivery of the same customer and enforces `billed + qty ≤ source.quantity`; `finance_invoice_source_links` is `UNIQUE(invoice_id, invoice_side, source_type, source_id, source_line_id)` (`server/migrations/v22-finance-wave-c-invoice.js:34`), so two different Delivery ids yield **exactly two** rows, satisfying `M-BIZ-12`'s `links.length === 2` and the two-distinct-`source_id` assertion. | `SOURCE_DERIVED`, passes |
| 5 | One invoice over multiple Deliveries — quantity and amount | Each Delivery line carries quantity `1` and unit price `100000`; the invoice line defaults to the Delivery line's unit price (`commercial-golive.js:110`). Two lines ⇒ `200000` cents, matching `M-BIZ-12`'s `arOpenCents === 200000` and `M-BIZ-14`'s `receivable.amount_cents === 200000`. | `SOURCE_DERIVED`, passes |
| 6 | Cross-salesperson AR attribution | `M-BIZ-14`'s two Deliveries come from two different orders with two different `salesperson_id`s; the production exposure projection attributes the residual to `ambiguousAttributionCents` and never to one of them. The invoice and AR facts are **unchanged** by the stock correction. | `SOURCE_DERIVED`, unchanged by this unit |
| 7 | Inventory valuation preconditions | `issueSourceValue` → `getBalance` reads `inventory_valuation_balances` — a **separate** table keyed `NONE:${warehouseId}:${productId}` (`server/modules/financial-inventory.js:60-76`) — and **not** the `inventory` table. With no valuation balance and `valuation_activated_at` NULL, the writer emits a `LEGACY_UNVALUED` movement with zero cost, so `cogsCents = 0` and **no COGS voucher** is written. This is **identical before and after** the stock correction. | `SOURCE_DERIVED`, unchanged by this unit |
| 8 | Strong-reservation availability | `assertStrongReservationAvailability` (`server/modules/planning-domain.js:662-671`) reads on-hand stock as `SUM(quantity)` over the pair (`server/modules/planning-domain.js:506-510`). Before the correction the sum after the first Delivery is `100 + (-1) = 99`; after the correction it is a single row of `99`. **Identical** ⇒ the correction introduces no new reservation pressure. | `SOURCE_DERIVED`, unchanged by this unit |
| 9 | Fixture cleanup and case isolation | `withMatrix` (`business-matrix.integration.js:67-74`) gives every case its own disposable schema through `createWave10MysqlLifecycle()`, and `handle.cleanup()` drops every object via `resetWave10CampaignSchema` (`server/test-utils/mysql-wave10-campaign-target.js:254-279`). No stock state leaks between cases; `M-BIZ-13` passing between the two failures corroborates it. | `SOURCE_DERIVED`, isolated |

**No statically discoverable contradiction remains after the stock correction.** Items 1–9 are either
unreachable, explicitly fail-loud, unchanged by the correction, or verified to pass.

### 10. Staged follow-up conditions

1. **Design** — the exact file whitelist, the new `seedWave10Inventory()` data flow, the single source
   of truth for the canonical `position_key`, the invariants, the SQLite/MySQL consistency argument,
   the negative and positive regression plan, the necessity of a protected Gate B re-run, the
   preconditions of the protected Full Acceptance, the explicit boundary between the fixture
   correction and the production risk, and the rollback — ending in a HARD STOP.
2. **Implementation** — only after a separate explicit authorization, confined to the fixture
   correction and its local regression.
3. **Protected Gate B** — only after a separate explicit authorization. The shared acceptance fixture
   **is** in the Gate B import closure, so the existing `WAVE10_GATE_B_PASS` transcript no longer
   covers the post-correction state and a Gate B re-run becomes **mandatory** before the final
   Acceptance review.
4. **Protected Full Acceptance** — only after the Gate B re-run passes and after a separate explicit
   authorization for exactly one `pnpm.cmd test:mysql:wave10` run against the dedicated disposable
   target, with the read-only preflight repeated first.

### 11. OPEN facts

```text
OPEN  the real-MySQL result of M-BIZ-12 and M-BIZ-14 after the fixture correction
OPEN  W10-INV-RISK-01 — the production out-bound availability read has no canonical
      position_key / owner / status filter and no deterministic row selection; both a false
      refusal (direction A) and a false allowance with a possible negative canonical balance
      (direction B) are source-reachable; it is NOT in this Fixture Implementation's
      production-code scope; the Final Freeze Review must close it or explicitly accept it
      under authorization; its production prevalence is TEST_EVIDENCE_PENDING
OPEN  RC-3 — credit_lock_anchors.policy_scope_id is declared VARCHAR(128) by the generic
      bootstrap path and LONGTEXT by the hand-written Wave 9 migration DDL (W10-PAR-R10)
OPEN  CG-3 — M-MIG-01 compares only the CHECK constraints of the two Wave 10 tables
OPEN  CREDENTIAL_EXPOSURE_OPEN
OPEN  WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN
OPEN  WAVE10_CLASSIFICATION_ALGEBRA_LOCAL_REGRESSION_ABSENT
OPEN  WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT
OPEN  LEGACY_DATA_EVIDENCE_PENDING
OPEN  RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN
OPEN  Wave 10 user Acceptance and Freeze
```

### 12. Requirement addendum correction (2026-10-27)

The user authorized a **bounded** correction of this Requirement only — two corrections, no re-audit.
The correction is recorded here; the matching Design correction is recorded in
`solution.md` → §37.51.14. **Implementation remains unauthorized.**

| # | Correction | Before | After |
|---|---|---|---|
| C1 | **Test-suite layering** | the Requirement was silent on the suite registration, and the Design registered the new regression in `FAST` **and** `FULL` — against the manifest's own `FAST` criterion ("Must not require a temp SQLite or Vite SSR", `scripts/testing/test-suites.js:19-20`, `:573-575`), while `W10-INV-T01`..`T08` need the real database state, the canonical position identity and the deduction verification that `createTempDb()` supplies | **`W10-INV-R13`** fixes the classification to **`FULL` only**, forbids bypassing `createTempDb()` to qualify for `FAST`, and forbids changing any existing `FAST` / `FULL` / `HEAVY` classification; **`AC-INV-08`** states that the new regression is executed by `pnpm test` and is deliberately absent from `pnpm test:fast` |
| C2 | **`W10-INV-RISK-01` risk boundary** | the impact was described as "a false `库存不足` refusal … or an understated available quantity", and the write path was called "canonical and correct … so the observed failure mode is an over-refusal, not a stock corruption"; the Freeze impact pre-decided that the risk "does **not** block the Wave 10 Freeze by itself" | the impact now states **two directions** — **A** false refusal, and **B** false allowance followed by a possible negative canonical balance, the canonical upsert carrying no negative-balance guard (`server/lib/stock.js:60-89`); the Freeze impact now **pre-decides nothing** and requires the **Final Freeze Review** to record an explicit risk-disposition decision — closed through its own Requirement and Design, or explicitly accepted with a written justification under an explicit authorization |
| C3 | **Outcome classes in the regression** | the Requirement required discrimination (R12) but did not forbid presenting a known-risk reproduction as a pass of the new Fixture contract | **`W10-INV-R14`** requires the two classes to be distinguished per case and in the report, and makes the duplicate-row case `W10-INV-T05` deterministic by construction |

**Unchanged by this correction**: the shared-root-cause attribution (§3–§4, facts `P01`..`P12`); clauses
`W10-INV-R01`..`W10-INV-R12`; acceptance conditions `AC-INV-01`..`AC-INV-07`; the compatibility and
forbidden-change boundary (§7); the nine-item post-stock readiness audit (§9); the staged follow-up
conditions (§10); and the production Schema, migrations and inventory business implementation, none of
which are in scope for this unit.

**Requirement status: `WAVE10_INVENTORY_FIXTURE_REQUIREMENT_CORRECTED`.**
## Wave 10 Capability Freeze (2026-10-27)

### 1. Authorization, scope and what this freeze is not

The user explicitly approved the **Wave 10 Capability Freeze** under AGENTS.md §4.5, on the basis of
`WAVE10_FULL_ACCEPTANCE_PASS` and `WAVE10_FREEZE_READY`.

This freeze applies **only** to the Wave 10 business capability and acceptance contracts that have
already passed acceptance. It is **not** a production release authorization, **not** a Git commit
authorization, and **not** a Wave 11 development authorization.

**Frozen** — the approved Wave 10 capability set (`W10-AIR-R01`..`R09`):

| Requirement | Frozen capability |
|---|---|
| R01 | Evidence authenticity and M-board identity |
| R02 | Destructive-target identity and inventory safety |
| R03 | Bounded child lifecycle and cleanup |
| R04 | Deterministic independent-session business races |
| R05 | Authoritative capacity preconditions |
| R06 | Formal migration, parity, upgrade and preservation |
| R07 | Case-complete zero-side-effect projections |
| R08 | Real-MySQL business matrix — B-9 O2, B-10 O1, S14 Mode B/C, Recognition Mode |
| R09 | Strict TAP, marker grammar and local behavior tests |

together with the approved business contracts these capabilities express: the canonical-writer
contract (`solution.md` §37.40.8), the S14 invoice / Finance AR recognition and cross-salesperson
attribution contract, the Recognition Mode refusal contract, and the Credit exposure projection
contract.

**Explicitly NOT frozen** — this freeze must not be read as any of the following:

- the whole Sales & Customer Domain across all Waves;
- Inventory Domain correctness certification;
- legacy data migration compatibility certification;
- production deployment approval;
- the proposition that every OPEN issue is resolved.

### 2. Acceptance evidence on which the freeze rests

| Evidence | Result |
|---|---|
| Gate B production races | **12 / 12 PASS** |
| Gate B suite | **7 / 7 PASS** |
| Gate B typed evidence | **7 / 7**, digests recomputed and matching |
| W10-PARITY | **7 / 7 PASS** |
| W10-RACES | **12 / 12 PASS** |
| W10-BUSINESS-MATRIX | **20 / 20 PASS** |
| Full Acceptance total | **39 / 39 PASS** |
| Process ExitCode | **0** |
| Strict TAP | **PASS** (fail / skip / todo / cancelled all 0) |
| MySQL cleanup | **CONFIRMED** (`CLEANUP_CONFIRMED`, `FINAL ZERO OBJECTS`) |
| Final independent inventory | **0 / 0 / 0 / 0 / 0** |
| FAST | **488 / 488 PASS** |
| FULL | **2923 / 2923 PASS** (2915 baseline + exactly the 8 new inventory-fixture cases) |
| HEAVY | **67 / 67 PASS** |
| Build | **PASS** |
| `git diff --check` | **PASS** |

The 39 real-MySQL results are the acceptance record of the frozen contracts and are **not**
re-marked, downgraded or voided by any risk disposition below.

### 3. Freeze fingerprint and untracked acceptance files

- Approved business contract version: **`W10-CONTRACT-2026-10-27`** — anchored to `document.md`
  §9 `W10-AIR-R08` and §5 `W10-AIR-R01`..`R10`, `solution.md` §37.40.8, §37.49, §37.50, §37.51,
  at `package.json` version `1.6.2`, HEAD `420cd3d5ce6f8d46ff388459b5fc6902f45791c6`.
- **Code fingerprint at freeze time** — SHA-256 over path + content of every `git ls-files`
  entry **except `document.md` and `solution.md`**, the two documents that carry this very
  freeze record and are therefore excluded to keep the fingerprint invariant under it:
  **`a43cd9f8a3310594458b99196d3f7379345163e2ca4ea31abbce9895fd11ff80`** (782 files). This is the value a later verifier reproduces unchanged.
- For completeness: the all-tracked-files fingerprint measured **before** this freeze record was
  appended to `document.md` / `solution.md` was `96fe8291853121d2d34d67962aca680b4a73fa18851a0b5e3eb7531cf70e9cf5` (784 files); appending this
  record necessarily changes it to `a1f8ba05eccd4409e0b8d050445953c252e677ba2a39b58c36c40e802d0a2d16`, which is exactly why the code-only fingerprint
  above is the anchor.
- Untracked acceptance files at freeze time (SHA-256, byte size):

| File | Bytes | SHA-256 |
|---|---|---|
| `server/sales-customer-wave10-acceptance-contract.test.js` | 23629 | `7ad2bb46602b6e2eedc553ae81e61b5874c62667dcfb8012703e1fdef678c44f` |
| `server/sales-customer-wave10-inventory-fixture.test.js` | 30073 | `03d4e32d8008b40a1f8adc86b47b37df391ced1376f97d3713ebda08cc1e69e1` |
| `server/sales-customer-wave10-quality-policy.test.js` | 25529 | `5ca14c18dcc3312a89484cf170c2572079e7174d559b04c5cad00f76acab7e01` |

The two untracked daily journals are append-only records by governance and are therefore not part
of the freeze fingerprint; their pre-append state at freeze time was
`log/2026-10-26.md` = 193385 bytes / `2ae5bf3fddd52bf57ec3e11f76a4d4dc7b9b1eb944743b1d7eb9948051a5f7d9` and
`log/2026-10-27.md` = 249190 bytes / `e69ab75c480d8324950a23f6407ca16e2d14e8a2185ed98eea2bca30756e1786`.

### 4. Outstanding risks — recorded, not closed

No OPEN item is rewritten as CLOSED by this freeze.

- **`W10-INV-RISK-01` — classified `BLOCKS_RELEASE_ONLY`.** The production out-bound availability
  read (`server/app.js:5645`, `server/app.js:5876`) has no canonical `position_key` / owner / status
  filter and no deterministic row selection, and the canonical upsert
  (`server/lib/stock.js:60-89`) carries no negative-balance guard. Direction A (false refusal of a
  satisfiable delivery) is `LIVE_CAPTURED_EVIDENCE`; direction B (false allowance, then a negative
  canonical balance) is `SOURCE_DERIVED`, with production prevalence `TEST_EVIDENCE_PENDING`.
  **The canonical position read and the negative-balance safety risk must be dispositioned through
  their own Requirement and Design before any production release.** This capability freeze does
  **not** lift that release restriction, and this freeze does **not** certify Inventory Domain
  correctness.
- **`CREDENTIAL_EXPOSURE_OPEN` — classified `REQUIRES_OWNER_DECISION`.** The local credential
  residue remains an owner decision. **Recording this classification does not mean the owner has
  accepted the risk**, and no risk acceptance is made on the owner's behalf by this freeze.
- The remaining seven OPEN items keep their deferral justification and applicable boundary:
  `WAVE10_LOCAL_GATE_BACKEND_ISOLATION_ABSENT` (contributor-tooling isolation; the acceptance
  target was provably uncontaminated), `WAVE10_QUALITY_GATE_LABEL_FALLBACK_OPEN` (message-only),
  `WAVE10_CLASSIFICATION_ALGEBRA_LOCAL_REGRESSION_ABSENT` (coverage gap, algebra verified
  canonical), `LEGACY_DATA_EVIDENCE_PENDING` (external evidence, undecided in both directions),
  `RECOGNITION_MODE_EXPLICIT_EXEMPTION_MODEL_GAP_OPEN` (declared model boundary),
  `W10-PAR-R10` / `RC-3` (real inconsistency on a structurally unreachable path, detection
  retained), `CG-3` (contract covered by the passing `M-MIG-06`).

### 5. Release hold and the remaining authorization boundary

- **Production release is not authorized.** `W10-INV-RISK-01` blocks release, and
  `CREDENTIAL_EXPOSURE_OPEN` requires an owner decision that must be recorded first.
- **Git consolidation still requires separate authorization.** This freeze is a decision record
  only: no `git add`, `commit`, `push`, `tag`, `merge`, `rebase`, `reset`, `restore`, `clean` or
  `stash` was performed, no `package.json` version was changed, and no release tag was created,
  moved or deleted. Committing the frozen tree is a separate, explicitly authorized action.
- Wave 11 is **not** started by this freeze.

**Freeze status: `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`.**
