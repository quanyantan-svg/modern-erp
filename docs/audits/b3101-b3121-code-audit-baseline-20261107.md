# B3101 / B3121 采购与委外代码审计基线

> **文档类型**：静态代码审计基线（Audit Baseline）
> **版本**：v0.1
> **审计日期**：2026-11-07
> **审计状态**：`PRELIMINARY_STATIC_REVIEW`
> **适用仓库**：`quanyantan-svg/modern-erp`
> **审计分支**：`master`
> **审计基准 SHA**：`9b9cb09799aa05ccac43d02ac1718083921c6d04`
> **业务手册**：B3101《采购管理操作手册 V1.0》；B3121《委外管理操作手册 V1.0》
> **重要声明**：本文件记录的是基于上述 SHA 的远端静态代码初审结果，不是 Domain Acceptance、Capability Freeze、Release Readiness 或完整验收报告。未在本轮执行测试套件，也未连接真实 MySQL。

---

## 0. 使用说明与状态规则

### 0.1 本文件的定位

本文件是 B3101 采购管理、B3121 委外管理及其 VMI 关联能力的**持续审计台账和问题追踪基线**。

后续开发不得只依赖聊天记录。每次开始开发前，必须先读取：

1. `AGENTS.md`
2. `docs/status/PROJECT_STATUS.md`
3. 本文件
4. 对应 Requirement / Design
5. 对应测试套件及最新证据

本文件记录问题、代码证据、业务预期、修复要求、测试要求、状态和变更历史。项目状态文件只维护摘要和链接，不复制整份问题清单。

### 0.2 审计状态与实施状态不得混用

| 状态 | 含义 |
|---|---|
| `IDENTIFIED` | 已发现线索，尚未完成证据核验 |
| `DOCUMENTED` | 已记录到本审计台账，证据和边界已说明 |
| `NEEDS_REVALIDATION` | 需要在当前 HEAD 或真实测试环境重新核验 |
| `AUTHORIZED` | 业务所有者/项目治理已明确批准实施 |
| `IMPLEMENTING` | 已获授权，正在修改代码 |
| `CODE_COMPLETE` | 代码修改完成，但不代表测试通过 |
| `TESTED` | 指定测试已运行并通过，附测试命令、SHA、Run ID 和结果 |
| `VERIFIED` | 代码、业务不变量、回归及必要证据均已核验 |
| `ACCEPTED` | 有权责任人已正式签发 Acceptance |
| `BLOCKED` | 受依赖、证据、权限或业务规则阻塞 |
| `DEFERRED_NOT_AUTHORIZED` | 明确延期或尚未授权；不得实施 |
| `REJECTED` | 经裁定不纳入产品范围 |

**不得**将 `DOCUMENTED`、`CODE_COMPLETE` 或单元测试通过写成 `ACCEPTED`。

### 0.3 每项问题的状态更新要求

任何问题状态变化，都必须至少更新本文件对应 Issue 的：

- `Status`
- `Last Updated`
- `Evidence`
- `Resolution / Next Action`
- `Verification`（若进入 TESTED / VERIFIED）
- `Change History`

当问题状态变化影响项目整体状态时，再同步：
- `docs/status/PROJECT_STATUS.md`
- `log/YYYY-MM-DD.md`
- 必要时 `docs/status/CAPABILITY_MATRIX.md`

这些文件不会自动同步；每次开发任务结束时必须显式执行状态同步。

### 0.4 Issue 记录模板

```text
Issue ID:
Capability:
Severity:
Status:
Description:
Affected Files:
Observed Evidence:
Expected Business Behavior:
Required Correction:
Dependencies / Policy Boundary:
Regression Tests:
Acceptance Criteria:
Verification Evidence:
Last Updated:
```

---

## 1. 审计范围、依据与限制

### 1.1 仓库基线

- Repository：`quanyantan-svg/modern-erp`
- Branch：`master`
- Baseline commit：`9b9cb09799aa05ccac43d02ac1718083921c6d04`
- Baseline commit message：签发 M1-Core 首期包级 Acceptance 并登记有界残余风险接受决定
- 本次基准提交为文档与日志治理变更；其提交说明明确记载 `server/`、`src/`、`scripts/` 零改动。

后续若 `master` 已前进，必须先比较当前 HEAD 与本基准 SHA；不得把本文件中的行号或代码结论未经复核直接套用到新 SHA。

### 1.2 业务依据

**B3101《采购管理操作手册 V1.0》**，重点章节：

- 1.1 采购管理概述；1.2 标准采购与采购退料流程
- 2.1 采购系统参数、单据类型参数
- 2.2 物料采购控制：请购控制、货源控制、配额控制、采购计价单位
- 2.3 供应商资料与默认交易信息
- 2.4 采购员、采购组及采购组数据隔离
- 2.5 货源清单
- 2.6 单据类型与业务流程
- 3.1 期初采购入库；3.2 期初采购退料
- 4.1 采购申请：手工、销售订单生成、指定货源、拆分/合并及合并下推
- 4.2 采购订单：赠品、供应商多方交易、财务信息、交货控制、预付款
- 4.3 采购订单变更：ADD / MODIFY / CANCEL
- 4.4 收料通知；4.5 采购入库
- 4.6 退料申请及采购退料
- 4.7 VMI：收货、消耗汇总、物权转移及结算衔接
- 4.8 配额下单
- 5.1 采购价目表；5.2 采购折扣表；5.3 采购调价
- 6.1～6.6 采购执行、汇总、全程跟踪、入库结算、预计供应量、到货及时率报表

**B3121《委外管理操作手册 V1.0》**，重点章节：

- 委外管理总体流程及六个业务环节
- 基础设置：委外参数、委外供应商、供应商 WIP 仓库、退料原因、补料原因、变更原因
- 初始化：期初委外订单、期初在产品维护
- 日常业务：委外订单、委外用料清单、加工费采购订单、委外领料、委外退料、委外补料
- 委外完成收料通知、检验、委外成品入库
- 期末处理：委外倒冲差异分摊、委外月末在制转移
- 报表：委外订单执行汇总/明细、委外订单领料汇总/明细、委外领料差异汇总

### 1.3 代码与文档依据

重点检查的远端文件包括：

- `docs/requirements/procurement-outsourcing.md`
- `docs/design/procurement-outsourcing.md`
- `docs/status/PROJECT_STATUS.md`
- `docs/status/CAPABILITY_MATRIX.md`
- `server/app.js`
- `server/modules/procurement-parameters.js`
- `server/modules/procurement-profiles.js`
- `server/modules/procurement-sourcing.js`
- `server/modules/procurement-pricing.js`
- `server/modules/procurement-orders.js`
- `server/modules/planning-domain.js`
- `server/modules/procurement-returns.js`
- `server/modules/procurement-vmi.js`
- `server/modules/procurement-reports.js`
- `server/modules/outsourcing-finance.js`
- `src/navigation/applicationRegistry.js`
- `src/pages/sourcing-pricing.jsx`
- `src/pages/outsourcing.jsx`
- `src/pages/master-data.jsx`
- 相关测试文件及 `scripts/testing/test-suites.js`

### 1.4 本轮限制

本轮是 GitHub 远端静态审查：

- 未在本轮运行 `pnpm test`、FULL、FAST 或 HEAVY。
- 未连接真实 MySQL。
- 未执行 Migration、Reset、Bootstrap、Cleanup。
- 未运行真实业务并发测试。
- 未执行任何数据库写入。
- 未修改代码、文档或远端分支。
- 未签发任何新的 Gate、Capability Acceptance 或 Domain Acceptance。

因此，涉及运行时、数据库约束、并发、真实权限和端到端结果的结论，必须在对应 Issue 中保留 `NEEDS_REVALIDATION`，不能写成已通过或已失败的运行时结论。

---

## 2. 项目治理边界：M1-Core 已验收，但 Domain 未验收

远端正式记录：

`docs/acceptance/m1-core-package-acceptance-20261107.md`

M1-Core 首期七 Gate（M1C-G01～M1C-G07）已保持 7/7 PASS，包级决定：

`ACCEPT_WITH_BOUNDED_RESIDUAL_RISK`

本次审计必须遵守以下边界：

1. M1-Core 七 Gate PASS 只覆盖正式记录列明的首期范围。
2. R-01～R-20 是被接受的有界残余风险，不得写成已证明或已消除。
3. D-01～D-04 继续延期，未授予实施授权。
4. WP-I 维持 `NOT_PROVEN / DEFERRED_NOT_AUTHORIZED`。
5. WP-J 维持 `DEFERRED_NOT_AUTHORIZED`。
6. M-15 不在本次 M1-Core Acceptance 范围。
7. 未授予 Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、Release 或 Deploy。
8. 任何真实库存错误、成本错误、越权或数据损坏，仍必须停止受影响业务路径并整改。

**本文件不是恢复旧 M1 13 Gate 全范围实施的授权。** 对延期能力必须按现行决策独立评估、授权。

---

## 3. Capability 覆盖审查：文档声明不等于代码验收

`docs/requirements/procurement-outsourcing.md` §31.3.1～§31.3.3 记录了 PRC-01～26、VMI-01～05、OUT-01～23 的 Requirement Coverage / Implementation Decision。

该矩阵描述的是需求审计和目标实现决策，不能直接作为当前代码已完成的证据。

### 3.1 B3101 采购能力 PRC-01～PRC-26

| ID | 能力 | Requirement 中记录的初始覆盖判断 | 本轮代码审计状态 |
|---|---|---|---|
| PRC-01 | Procurement Parameters | MISSING | 部分代码存在；参数是否全部进入业务校验需逐项验证 |
| PRC-02 | Supplier Procurement Profile | PARTIAL | 后端档案接口存在；字段语义、业务消费和前端需核验 |
| PRC-03 | Buyer / Purchasing Group | MISSING | 后端 CRUD / membership 路由存在；服务端数据隔离需验证 |
| PRC-04 | Source List | MISSING | 货源列表及创建/停用接口存在；资格和业务日期规则有缺口 |
| PRC-05 | Quota | MISSING | 比例配额及分配函数存在；并发、余量、来源闭环需验证 |
| PRC-06 | Sourcing Decision | MISSING | 写接口存在；发现权限和来源真实性问题，见 AUD-PRC-001 |
| PRC-07 | Purchase Price List | MISSING | 价格列表、创建接口存在；正式 PO 取价链需验证 |
| PRC-08 | Pricing UOM | PARTIAL | 使用通用 UOM 快照；价格单位与基础单位金额计算需整改 |
| PRC-09 | Procurement Pricing Discount | MISSING | 折扣方案代码存在；多重折扣和 PO 快照需验证 |
| PRC-10 | Purchase Price Adjustment | MISSING | 新版本调整接口存在；生效区间、历史不可变及 PO 消费需验证 |
| PRC-11 | Requisition Sources | PARTIAL | 手工/计划来源存在；销售订单来源及 source-line trace 需核验 |
| PRC-12 | PR Split / Merge / Supplier Allocation | PARTIAL | 有批量转换基础；逐行分配、余量保护、审计需核验 |
| PRC-13 | Purchase Order | COVERED（Requirement 记录） | 基础生命周期存在；仍需按完整手册回归 |
| PRC-14 | PO Commercial Snapshot | PARTIAL | 部分供应商快照存在；采购员/采购组/价格来源等需核验 |
| PRC-15 | Gift / Free Item | SEMANTIC_MISMATCH → CONVERGE | 已有赠品字段；需验证零价和非赠品价格约束 |
| PRC-16 | Delivery Schedule / Quantity Control | PARTIAL | 交货计划接口存在；多次交货和上下限控制需核验 |
| PRC-17 | Prepayment Requirement | MISSING | 不得仅凭字段存在认定预付款流程完整 |
| PRC-18 | PO Change | MISSING | ADD/MODIFY/CANCEL 代码存在；快照和金额一致性有缺口 |
| PRC-19 | PO Execution Status | SEMANTIC_MISMATCH → CONVERGE | 有公共执行视图，但 MRP 查询仍存在独立 SQL 消费 |
| PRC-20 | Receipt Notice | MISSING | 后端通知能力存在；多 PO 合并、来源及状态边界需回归 |
| PRC-21 | Incoming Inspection | COVERED（Requirement 记录） | 复用 IQC；需验证采购与委外来源接入 |
| PRC-22 | Purchase Receipt | COVERED（Requirement 记录） | 复用库存主干；需验证交期、来源行并发和账务不变量 |
| PRC-23 | Billing Mode Semantics | SEMANTIC_MISMATCH → CONVERGE | 需验证三种模式及其账务合同，不可仅看字段 |
| PRC-24 | Return Request | MISSING | 当前可见实现主要为申请表头，缺少完整申请业务闭环 |
| PRC-25 | Purchase Return | SEMANTIC_MISMATCH → CONVERGE | 已有四分支相关实现；仍需以真实测试证明 |
| PRC-26 | Procurement Scan | MISSING | 已有扫码来源解析入口；是否形成收货草稿需核验 |

### 3.2 VMI-01～VMI-05

| ID | 能力 | 当前审计判断 |
|---|---|---|
| VMI-01 | VMI Policy / Agreement | 有 Agreement 基础代码；供应商资格语义和协议约束需整改/验证 |
| VMI-02 | VMI Receiving | 有收货单代码，但真实库存动作受 Inventory owner dimension 依赖门禁约束 |
| VMI-03 | VMI Consumption | 有消耗代码；业务命令幂等和数量守恒需验证 |
| VMI-04 | Consumption Summary / Ownership Transfer | 需核对汇总窗口、消耗结算和物权转移业务链 |
| VMI-05 | Ownership Transfer / Supplier Bill Handoff | 受延期政策和跨域依赖约束；不得自行开放正式结算 |

VMI 物理库存必须维持 `physical location = enterprise site / owner = supplier`，不得把供应商所有权库存伪装为企业自有库存。

### 3.3 B3121 委外能力 OUT-01～OUT-23

| ID | 能力 | Requirement 中记录的初始覆盖判断 | 本轮代码审计状态 |
|---|---|---|---|
| OUT-01 | Outsourcing Supplier | PARTIAL | 复用供应商档案；委外资格和 WIP 绑定需验证 |
| OUT-02 | Outsourcing Source List | MISSING | 复用货源基础；OUTSOURCE 资格和有效期需验证 |
| OUT-03 | Processing Price | MISSING | 有采购价格基础；加工费语义与 PO 快照需验证 |
| OUT-04 | Supplier WIP Warehouse | PARTIAL | 有绑定/位置基础；仓库属性和位置守恒需验证 |
| OUT-05 | Planning Handoff | PARTIAL | 有计划交接代码；Exactly-once、来源与并发证据需核验 |
| OUT-06 | Outsourcing Order | MISSING | 订单创建和计划来源代码存在；全手册流程需回归 |
| OUT-07 | Outsourcing Lifecycle | MISSING → NEW | 有生命周期转换；与手册状态及取消边界需核验 |
| OUT-08 | OUTSOURCE BOM | PARTIAL | 有 BOM 快照基础；批准/生效/用途/业务日期选择器需验证 |
| OUT-09 | Outsourcing Material List | MISSING | 有用料明细；快照不可变和补料规则需验证 |
| OUT-10 | Outsourcing PO | MISSING | 有加工费 PO 关联；商业承诺和财务边界需验证 |
| OUT-11 | Material Issue | MISSING | 有发料实现；库存、批次/序列号和 WIP 证据需回归 |
| OUT-12 | Material Supplement | MISSING | 有补料实现；原因、来源、库存和审计需回归 |
| OUT-13 | Material Return | MISSING | 有退料实现；来源、库存反向移动和身份追踪需回归 |
| OUT-14 | Material Ownership | PARTIAL | 有企业所有权和 WIP 位置基础；数量/身份守恒需验证 |
| OUT-15 | LOT / SERIAL | PARTIAL | 复用追踪能力；发料至退料/倒冲全链追溯需验证 |
| OUT-16 | Backflush | MISSING | 有增量倒冲实现；数量、成本、身份和重复执行需回归 |
| OUT-17 | Completion Receipt Notice | MISSING | 已有统一收料通知代码；委外来源和通知状态需验证 |
| OUT-18 | Outsourcing Inspection | PARTIAL | 复用 IQC；待检与已生效边界需回归 |
| OUT-19 | Outsourcing Inbound | MISSING | 有两阶段收货实现；库存、质量、加工费和来源链需验证 |
| OUT-20 | Processing Fee AP | PARTIAL | 有 Supplier Bill 草稿路径；正式过账受政策限制 |
| OUT-21 | Outsourcing Cost Evidence | MISSING | 有临时成本证据；最终成本调整受政策限制 |
| OUT-22 | Finished Return | MISSING | 当前首期范围受拒绝/延期边界约束，不得擅自开放 |
| OUT-23 | Period-End / WIP / Opening / Reports | MISSING → NEW / INTEGRATE | 多个子能力仍需区分已实现、延期、未授权和缺失 |

**注意**：以上表格中的“Requirement 初始覆盖判断”是现有 Requirement 文件中的原始字段，不代表本轮独立验证后的代码完成率。本轮的代码审计状态也不是 Acceptance。

---

## 4. 已确认的代码问题与审计 Issue

### AUD-PRC-001 — 寻源决策写操作使用查看权限

- **Capability**：PRC-06
- **Severity**：P0
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-sourcing.js`
- **Evidence**：`resolveSourcingDecision()` 约第 256～295 行；函数入口调用 `assertViewPermission(actor)`，随后写入 `sourcing_decisions` 和 `sourcing_decision_allocations`，并写审计记录。
- **Observed**：正式写操作使用查看权限门禁。
- **Expected**：正式寻源决策必须使用明确的 Manage / Execute 权限；人工覆盖还必须额外检查专用权限和原因。
- **Required Correction**：
  1. 区分预览和正式决策。
  2. 正式写操作采用服务端写权限。
  3. 验证真实 PR / PR line / source identity，不接受演示来源作为生产事实。
  4. 仅在完整事务和来源校验成功后推进正式状态。
  5. 增加无权限、伪造来源、重复请求和并发测试。
- **Verification**：本轮未运行测试。
- **Acceptance Criteria**：仅具备查看权限的用户无法创建决策；不存在伪造 PR 的正式决策；决策来源、分配数量、原因和审计可追溯。

### AUD-PRC-002 — 寻源决策 Hash 不是 SHA-256

- **Capability**：PRC-06
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-sourcing.js`
- **Evidence**：约第 292～293 行：`const hash = \`sha256:${hashInput.length}\`;`
- **Observed**：当前值只是输入字符串长度，不是真正 SHA-256。
- **Required Correction**：使用 Node `crypto` 对规范化、稳定排序后的决策输入计算真实 SHA-256；明确 hash 覆盖字段和版本化策略。
- **Acceptance Criteria**：相同规范化输入产生相同 hash；不同输入不会仅因长度相同而得到相同 hash；测试覆盖字段顺序和重复执行。

### AUD-PRC-003 — 供应商资格校验忽略采购/委外开关和业务日期

- **Capability**：PRC-02 / PRC-04 / OUT-01 / OUT-02
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-sourcing.js`
- **Evidence**：约第 95～105 行：查询 `procurement_enabled`、`outsourcing_enabled`、资质状态及有效期，但校验只检查 `qualification_status` 和 `qualification_valid_to`；日期使用当前系统日期。
- **Observed**：
  - 查询采购/委外启用字段，但当前 helper 未按 `sourceType` 使用它们。
  - 未检查 `qualification_valid_from`。
  - 使用当前日期，而不是请求的 `businessDate`。
- **Required Correction**：
  1. 按 PURCHASE / OUTSOURCE 分别检查供应商业务启用状态。
  2. 校验资质生效起止日期。
  3. 将业务日期显式传入资格校验。
  4. 历史业务日期校验不得错误依赖今天的资格状态。
- **Acceptance Criteria**：禁用采购的供应商不能参与 PURCHASE 寻源；禁用委外的供应商不能参与 OUTSOURCE 寻源；未生效/已过期资格按业务日期被拒绝。

### AUD-PRC-004 — Pricing UOM 金额计算疑似将计价单位价格乘以基础单位数量

- **Capability**：PRC-07 / PRC-08
- **Severity**：P0（金额正确性）
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-pricing.js`
- **Evidence**：约第 186～210 行：按 `pricing_uom_code` 选择价格条目，随后调用 `quantitySnapshot()`，并将 `unit_price_cents` 直接乘以 `snapshot.base`。
- **Observed**：若价格为每 BOX 的价格，而 `snapshot.base` 是 EA 数量，则金额可能多乘换算比例。
- **Required Correction**：
  1. 明确价格的计价单位和数量的单据单位。
  2. 使用价格计价单位数量计算金额；不能将每 BOX 单价乘以 EA 数量。
  3. 保留精确有理数换算和统一舍入规则。
  4. 折扣也必须在明确的金额基数上计算。
- **Required Test**：例如 1 BOX = 12 EA，2 BOX，价格 12.00 元/BOX，预期金额 24.00 元，而不是 288.00 元。
- **Acceptance Criteria**：Pricing UOM = Purchase UOM、Pricing UOM ≠ Purchase UOM、分数换算、折扣、边界舍入均有测试。
- **Note**：本项是按当前函数输入/输出语义发现的静态问题；修复前必须再核对调用方传入的 `uomCode` 和数量单位契约。

### AUD-PRC-005 — PO Change 的原始快照与应用金额需要整改

- **Capability**：PRC-18
- **Severity**：P0（商业数据一致性）
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-orders.js`
- **Evidence**：
  - 创建变更单约第 246～263 行：`payload_json`、`original_json`、`requested_json` 均写入 `JSON.stringify(body.payload)`。
  - 应用 MODIFY 约第 299～309 行：更新 `quantity`、`unit_price_cents`，但 SQL 未同步更新 `amount_cents`。
- **Observed**：
  - `original_json` 并非变更前订单/明细的真实快照。
  - MODIFY 后明细金额可能与数量、单价不一致。
- **Required Correction**：
  1. 创建变更单时读取并保存真实原始订单/明细快照。
  2. 应用时重新校验订单版本和执行数量。
  3. 原子更新 quantity、unit price、amount、header totals（如存在）。
  4. 防止同一变更重复应用。
  5. 变更前后审计快照不可覆盖。
- **Acceptance Criteria**：变更前快照等于真实原订单；变更后数量、单价、金额一致；执行数量保护有效；重复应用被拒绝或精确重放。

### AUD-PRC-006 — MRP 采购供应量查询未排除委外加工费 PO

- **Capability**：PRC-19（跨 Domain：Planning / Procurement / Outsourcing）
- **Severity**：P0（计划供应量正确性）
- **Status**：`DOCUMENTED`
- **File**：`server/modules/planning-domain.js`
- **Evidence**：约第 687～693 行的采购供应量 SQL 查询 `purchase_orders` 中 `status='APPROVED'` 的采购订单，但未过滤 `business_type`。
- **Cross-check**：`server/modules/procurement-orders.js` 的公共执行视图/供应量逻辑约第 168～222 行已明确区分 `OUTSOURCE_PROCESSING`，并注释 BUY supply 应排除加工费 PO。
- **Observed**：MRP 的该条独立查询可能将 `OUTSOURCE_PROCESSING` 加工费 PO 计入普通采购供应量。
- **Required Correction**：
  1. 让 MRP、Planner Workbench、Reservation、Receiving 消费同一 canonical PO execution / open remaining quantity。
  2. 普通采购供应量排除加工费 PO。
  3. 对已收货、已退货、取消、关闭、部分收货状态统一口径。
- **Acceptance Criteria**：同一 PO 在 MRP、工作台、预留、收货视图中的可执行余量一致；加工费 PO 不污染 BUY supply。
- **Dependencies**：需按 PRC-19 Design 约束实施，不得临时复制另一套 SQL 口径。

### AUD-PRC-007 — 采购退货申请仅有表头级基础实现

- **Capability**：PRC-24
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-returns.js`
- **Evidence**：文件约 95 行；当前可见实现包含列表和创建申请，创建请求字段为 `receiptId`、`requestDate`、`remark`，插入 `purchase_return_requests` 表头记录。
- **Observed**：当前文件中未见申请明细、申请类型/原因/方式/补料方式、审批、转换正式采购退货单的完整流程。
- **Required Correction**：先按 B3101 §4.6.1 和 Requirement PRC-24 完成业务设计，再实施申请明细、状态流转、来源数量保护及正式退货转换。
- **Acceptance Criteria**：申请可关联采购订单/收货/入库来源；明细数量受来源可退数量约束；审批和转换可追溯；未入库货物不得创建库存退货事实。

### AUD-PRC-008 — 采购订单变更 CANCEL 的业务语义需核验

- **Capability**：PRC-18 / PRC-19
- **Severity**：P1
- **Status**：`NEEDS_REVALIDATION`
- **File**：`server/modules/procurement-orders.js`
- **Evidence**：`applyPurchaseOrderChange()` 的 CANCEL 分支约第 309～311 行直接更新 `purchase_orders.status='CANCELLED'`。
- **Required Revalidation**：核验取消是否针对整张订单还是明细行；已执行数量、收货通知、交货计划、预留、MRP 供应量、审计及下游来源是否同步处理。
- **Acceptance Criteria**：取消边界符合 B3101 §4.3；不得通过取消整张 PO 意外取消未要求取消的明细或破坏已执行事实。

### AUD-PRC-009 — 采购到货及时率报表口径不正确

- **Capability**：B3101 §6.6
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-reports.js`
- **Evidence**：约第 39 行：`onTimeRate` 计算为 `received / ordered`。
- **Observed**：该公式是收货完成比例，不是根据计划交货日期与实际收料/入库日期判断的到货及时率。
- **Required Correction**：基于交货计划、实际收货/入库日期和逾期天数定义统计口径；分批到货必须有明确的数量加权规则。
- **Acceptance Criteria**：准时/逾期数量、逾期天数、及时率可复算；未到货数量不能被误算为准时。

### AUD-VMI-001 — VMI Agreement 资格条件疑似误用委外资格

- **Capability**：VMI-01
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-vmi.js`
- **Evidence**：`createVmiAgreement()` 约第 65～80 行使用 `suppliers.outsourcing_enabled=1` 作为供应商条件。
- **Observed**：VMI Agreement 的供应商资格依赖委外启用字段，业务语义可疑。
- **Required Correction**：核对 Requirement、Design 和 VMI 业务合同；定义 VMI supplier eligibility，不得直接复用委外资格作为 VMI 合法性证明。
- **Acceptance Criteria**：供应商是否可签 VMI 协议由明确的 VMI 规则决定，不因是否启用委外而错误放行/拒绝。

### AUD-VMI-002 — VMI 收货未见有效 Agreement 绑定校验

- **Capability**：VMI-01 / VMI-02
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-vmi.js`
- **Evidence**：`createVmiReceipt()` 约第 88～105 行接受 supplier / warehouse / product / quantity 等字段，未见按供应商、产品、仓库和业务日期验证有效 Agreement。
- **Required Correction**：在任何真实 VMI 收货业务启用前，要求有效 Agreement 和有效期匹配；数量、供应商、仓库、产品必须与协议一致。
- **Policy Boundary**：VMI 物理库存 owner dimension 仍是跨域依赖；本 Issue 不授权绕过 owner dimension 门禁。

### AUD-VMI-003 — VMI 消耗命令的业务幂等需要验证

- **Capability**：VMI-03
- **Severity**：P1
- **Status**：`NEEDS_REVALIDATION`
- **File**：`server/modules/procurement-vmi.js`
- **Evidence**：`createVmiConsumption()` 约第 145～180 行生成新的 consumption UUID，并以该 UUID 构造内部库存 mutation idempotency key；请求字段中未见客户端幂等键。
- **Observed**：相同业务请求重试时可能生成新的消耗记录，而不是同一业务命令的精确重放。
- **Required Revalidation**：核对数据库唯一约束、事务、请求指纹和业务数量保护。
- **Acceptance Criteria**：相同 Idempotency-Key + 相同 payload 精确重放；相同 Key + 不同 payload 返回冲突；重复消耗不能超出已确认 VMI 可用量。

### AUD-OUT-001 — 跨委外订单 WIP 转移当前仅修改 WIP 数量字段

- **Capability**：OUT-23 / B3121 期末处理
- **Severity**：P0（若开放真实执行）
- **Status**：`DEFERRED_NOT_AUTHORIZED`
- **File**：`server/modules/outsourcing-finance.js`
- **Evidence**：`createWipTransfer()` 约第 394～425 行插入 WIP transfer 记录并更新源/目标 `outsourcing_material_list.issued_quantity`；该函数可见代码未执行对应 canonical Inventory movement。
- **Observed**：函数注释称复用 canonical inventory movements，但实现片段只更新 WIP 数量字段。
- **Policy Boundary**：跨订单 WIP 成本携带及身份归属受 B-P01 / M1-GB03 延期边界约束。当前状态不是普通待修功能。
- **Required Action**：
  1. 在业务授权前保持 fail-closed，不得将此接口作为已完成真实库存转移。
  2. 先完成库存 movement、LOT/SERIAL、成本携带、数量守恒、并发和来源身份的 Design。
  3. 取得明确业务授权后才可实现。
- **Acceptance Criteria**：未授权时明确拒绝；授权后源/目标 WIP、canonical Inventory、身份和成本证据守恒；并发转移不会超额。

### AUD-OUT-002 — 委外执行汇总将待检收货计入累计完工数量

- **Capability**：OUT-17 / OUT-18 / OUT-19 / OUT-23
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`server/modules/procurement-reports.js`
- **Evidence**：`getOutsourcingExecutionReport()` 约第 45～60 行累计收货查询仅过滤 `business_status <> 'CANCELLED'`，没有将 `PENDING_INSPECTION` 与已生效收货区分。
- **Observed**：待检收货可能被纳入累计完工数量、加工费和成本统计。
- **Required Correction**：明确报表字段的业务定义；只有通过适用质量门禁并正式生效的收货，才能计入“已完工/已入库”等正式指标。待检数量应单独展示。
- **Acceptance Criteria**：PENDING_INSPECTION 不污染已完工/已入库正式指标；EFFECTED 与取消记录按明确定义统计。

### AUD-FE-001 — 寻源与定价页面把演示操作接入正式写 API

- **Capability**：PRC-06
- **Severity**：P0（误写风险）
- **Status**：`DOCUMENTED`
- **File**：`src/pages/sourcing-pricing.jsx`
- **Evidence**：`runAllocation()` 使用固定 `PR-DEMO-001`、`product-001` 和数量 100 调用 `POST /api/procurement/sourcing-decisions`；按钮显示“模拟寻源分配”。
- **Observed**：UI 文案称“模拟”，实际调用正式写 API，可能创建真实决策和审计记录。
- **Required Correction**：
  1. 删除生产页面中的硬编码演示来源。
  2. 真正预览必须使用无副作用 preview endpoint / pure calculation。
  3. 正式决策必须选择真实 PR line、确认分配并二次确认。
  4. 前端不能代替后端权限和来源校验。
- **Acceptance Criteria**：点击预览不会写数据库；正式提交必须有真实来源、权限和审计。

### AUD-FE-002 — 寻源与定价页面只有列表展示，缺少完整维护交互

- **Capability**：PRC-04～PRC-10
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`src/pages/sourcing-pricing.jsx`
- **Evidence**：当前页面读取 source entries、quotas、price list、discounts 并展示列表；未见完整新增/编辑/停用表单覆盖全部配置。
- **Required Correction**：按 capability 分别设计 LIST → DETAIL / CREATE / EDIT / DISABLE 工作流；字段、权限、有效期、版本和审计与后端契约一致。
- **Acceptance Criteria**：用户可完成授权范围内的货源、配额、价格、折扣和调价维护；无权限操作在服务端被拒绝。

### AUD-FE-003 — 委外页面未覆盖手册要求的执行操作工作面

- **Capability**：OUT-11～OUT-19、OUT-23
- **Severity**：P1
- **Status**：`DOCUMENTED`
- **File**：`src/pages/outsourcing.jsx`
- **Evidence**：当前页面主要展示委外订单列表、详情、创建及生命周期转换；详情展示材料位置和发/补/退/倒冲数量汇总，但未见完整发料、补料、退料、完工通知、质量、收货和期末操作表单。
- **Required Correction**：在复用现有后端业务 API 的前提下，按手册流程补齐工作面；未授权的 WIP/差异/财务操作必须隐藏并由后端 fail-closed。
- **Acceptance Criteria**：所有开放的委外操作均有来源、数量、仓库、LOT/SERIAL、权限、状态和结果反馈；延期能力不提供可执行入口。

---

## 5. 前端和路由的整体缺口

当前 `applicationRegistry.js` 已有采购与委外入口，包括：

- `purchase-orders`
- `suppliers`
- `purchase-receipts`
- `purchase-requisitions`
- `sourcing-pricing`
- `outsourcing`

但路由存在不等于对应手册能力已经有完整可操作界面。

需要后续逐项审计的工作面：

### B3101

- 采购系统参数
- 物料采购控制页签
- 供应商采购档案
- 采购员与采购组成员/数据隔离
- 货源清单、配额下单
- 采购价目、折扣、调价
- 采购申请来源、拆分/合并
- 订单商业信息、交货计划、预付款
- PO Change
- 收料通知多 PO 合并
- 采购退货申请
- 期初采购入库/退料
- VMI 协议、收货、消耗汇总、物权转移（仅在授权范围内）
- 采购订单执行、预计供应量、到货及时率等报表

### B3121

- 委外参数
- 委外供应商和 WIP 仓库
- 退料/补料/变更原因
- 期初委外订单
- 期初在产品
- 委外订单和用料清单
- 委外加工费 PO
- 发料、补料、退料
- 委外完工通知、IQC、成品入库
- 倒冲差异分摊
- 月末 WIP 转移（受政策约束）
- 委外执行、领料、差异报表

---

## 6. 测试与验证缺口

本轮确认仓库中央测试套件已登记采购与委外相关测试文件，但**未在本轮执行这些测试**。测试文件存在不代表当前 HEAD 通过。

后续至少需要补齐以下验证：

| 范围 | 必需测试 |
|---|---|
| 权限 | View-only 不得执行写操作；跨采购组数据隔离；越权 API 直接拒绝 |
| 供应商资格 | PURCHASE / OUTSOURCE 开关、资质有效期起止、业务日期 |
| 寻源 | 真实 PR line、source list、quota、数量守恒、override 原因、幂等 |
| 定价 | Pricing UOM ≠ Purchase UOM、折扣、版本、生效日期、舍入 |
| PO Change | 原始快照、ADD/MODIFY/CANCEL、金额一致、已执行数量保护、重复应用 |
| PO Execution | MRP / Workbench / Reservation / Receiving 同一 open remaining quantity |
| 退货申请 | 申请明细、审核、来源数量上限、转换正式退货 |
| VMI | Agreement 匹配、supplier ownership、收货/消耗幂等、数量守恒、政策拒绝边界 |
| 委外 WIP | 发/补/退/倒冲后数量守恒、LOT/SERIAL、库存 movement、并发 |
| 委外收货 | PENDING_INSPECTION 不得提前计入正式入库/完工指标 |
| 报表 | 每个统计字段均可从业务事实复算 |
| 数据库 | SQLite/MySQL schema parity、Migration 幂等、唯一约束、事务回滚 |
| 前端 | 页面权限、真实 API、空/错/重复提交状态、预览无副作用 |

每次正式验证必须记录：Commit SHA、测试命令、Run ID、数据库类型/版本、测试结果、失败项及证据路径。

---

## 7. 后续开发包建议（不是实施授权）

### Package A — Procurement / Outsourcing Integrity Remediation

建议优先评估：

1. AUD-PRC-001：寻源写权限和真实来源
2. AUD-PRC-002：真实 SHA-256
3. AUD-PRC-003：供应商资格和业务日期
4. AUD-PRC-004：Pricing UOM 金额
5. AUD-PRC-005：PO Change 快照和金额
6. AUD-PRC-006：MRP canonical PO execution 消费
7. AUD-PRC-009：采购及时率口径
8. AUD-OUT-002：委外报表待检数量口径

**Package A 仍需先经过 Requirement / Design / 授权门禁。** 不能仅凭本审计文档自动开始修改。

### Package B — B3101 Procurement Workbench

补齐采购参数、物料控制、供应商采购档案、Buyer / Purchasing Group、货源、配额、定价、请购、PO、交期、预付款、变更、收货、退货、VMI 允许范围和报表工作面。

### Package C — B3121 Outsourcing Workbench

补齐委外参数、供应商 WIP 配置、原因资料、期初数据、委外订单、发/补/退料、收货通知、质量、入库、报表等工作面。

### Package D — Deferred / Policy-Gated Capabilities

VMI 完整物权转移/结算、跨订单/跨期间 WIP 成本携带、倒冲差异审核生效、委外正式 AP/GL 过账、委外成品退货等必须遵循现行延期和授权记录，不能自动排入开发。

---

## 8. 下一轮审计必须补齐的事项

本文件 v0.1 不宣称已经完成全部 PRC-01～26、VMI-01～05、OUT-01～23 的逐项运行时审计。

下一轮应补充：

1. 逐项检查每个 Capability 对应的 API、Schema、Migration、Handler、RBAC、事务、审计、前端、测试。
2. 对每个 `COVERED` 声明找出当前 HEAD 的真实代码与测试证据。
3. 检查 SQLite 与 MySQL 的 Schema/Migration parity。
4. 检查所有跨域消费者是否复用 canonical API / read model。
5. 检查每项业务能力是否符合 B3101 / B3121 操作手册。
6. 对所有延期能力核对正式裁定，不以代码存在作为授权依据。
7. 逐项给出 `VERIFIED / PARTIAL / MISSING / BLOCKED / DEFERRED_NOT_AUTHORIZED` 的审计结论，并附证据。

---

## 9. 审计问题状态总表

| Issue ID | Severity | Capability | Status | 首要处理 |
|---|---|---|---|---|
| AUD-PRC-001 | P0 | PRC-06 | DOCUMENTED | 写权限与真实来源 |
| AUD-PRC-002 | P1 | PRC-06 | DOCUMENTED | 真正 SHA-256 |
| AUD-PRC-003 | P1 | PRC-02/04、OUT-01/02 | DOCUMENTED | 资格与业务日期 |
| AUD-PRC-004 | P0 | PRC-07/08 | DOCUMENTED | Pricing UOM 金额 |
| AUD-PRC-005 | P0 | PRC-18 | DOCUMENTED | PO Change 快照/金额 |
| AUD-PRC-006 | P0 | PRC-19 | DOCUMENTED | MRP 统一执行视图 |
| AUD-PRC-007 | P1 | PRC-24 | DOCUMENTED | 退货申请闭环 |
| AUD-PRC-008 | P1 | PRC-18/19 | NEEDS_REVALIDATION | CANCEL 语义 |
| AUD-PRC-009 | P1 | B3101 §6.6 | DOCUMENTED | 及时率口径 |
| AUD-VMI-001 | P1 | VMI-01 | DOCUMENTED | Agreement 资格语义 |
| AUD-VMI-002 | P1 | VMI-01/02 | DOCUMENTED | Agreement 绑定 |
| AUD-VMI-003 | P1 | VMI-03 | NEEDS_REVALIDATION | 消耗幂等 |
| AUD-OUT-001 | P0* | OUT-23 | DEFERRED_NOT_AUTHORIZED | 不得绕过 WIP 政策 |
| AUD-OUT-002 | P1 | OUT-17/18/19/23 | DOCUMENTED | 待检数量报表口径 |
| AUD-FE-001 | P0 | PRC-06 | DOCUMENTED | 演示按钮真实写 API |
| AUD-FE-002 | P1 | PRC-04～10 | DOCUMENTED | 寻源定价维护工作面 |
| AUD-FE-003 | P1 | OUT-11～19/23 | DOCUMENTED | 委外执行工作面 |

`P0*` 表示：若跨单 WIP 转移被当作正式业务开放，则为高风险；但当前正确状态是延期未授权，不能把它转成普通 P0 开发任务。

---

## 10. 审计变更历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-07 | v0.1 | 基于 master SHA `9b9cb09799aa05ccac43d02ac1718083921c6d04` 建立初步静态审计基线；记录已确认代码线索、待复验项和延期边界 |

后续追加记录时使用：

```text
### YYYY-MM-DD — Audit Update

- Repository HEAD:
- Issue IDs changed:
- New evidence:
- Status transitions:
- Tests / Run IDs:
- Policy / Authorization references:
- Files updated:
- Commit SHA:
```

---

## 11. 文档维护规则

1. 本文件是采购与委外审计 Issue 的唯一详细台账。
2. `PROJECT_STATUS.md` 只记录总体状态、阶段结论和本文件链接。
3. `CAPABILITY_MATRIX.md` 只记录 Capability 层面的正式覆盖状态；不得因 Issue 已记录就改为 PASS。
4. `log/YYYY-MM-DD.md` 记录每次状态迁移和证据变更。
5. 每次代码开发结束后，必须同步本文件对应 Issue 状态。
6. 只有测试通过并完成业务不变量核验，才能进入 `VERIFIED`。
7. 只有正式责任人签发后，才能进入 `ACCEPTED`。
8. 发现新问题时新增 Issue ID，不覆盖历史 Issue。
9. 修复代码后，保留原始发现、修复 commit、测试证据和验收证据。
10. 不得把本文件中的任何 `DOCUMENTED` 项目描述成已修复或已验收。
