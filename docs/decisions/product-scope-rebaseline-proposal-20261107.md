# 产品范围重定基线 —— 建议与 Scope Change Proposal（2026-11-07）

> **用途**：为 B3101 / B3121 采购与委外能力提出**产品范围**建议（保留 / 简化 / 暂缓 / 移出范围），
> 并为其中与**现有已批准合同**冲突的部分建立**待业务所有者批准的 Scope Change Proposal**。
>
> **Owner**：业务所有者（范围裁定与批准）；Platform（建议编制与登记）。
>
> **状态**：`PENDING` —— 本文件**全部内容是建议**，**不构成任何批准、授权、合同变更或实施许可**。
> 未获业务所有者逐项批准前，已批准 Requirement / Design / Acceptance / 延期政策**全部原样有效**。
>
> **权威来源**：本文件**不是**当前 Requirement、Design 或项目状态的权威来源。
> 当前 Requirement 见 [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md)；
> 当前 Design 见 [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) 与
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)；
> **唯一**当前项目级进度登记表见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；
> 审计台账见 [`docs/audits/b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md)。
>
> **关联登记**：[`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](./OPEN-BUSINESS-DECISIONS.md) §4；
> 项目状态登记见 [`PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §39。

---

## 1. 本文件的定位与纪律

### 1.1 产品目标（不复刻金蝶）

modern-erp 是独立的现代 ERP，**不追求完整复现或 1:1 模仿金蝶云星空**。
B3101 / B3121 操作手册是**业务参考资料**，用于提取业务概念、流程与关键边界，
**不是**逐项必须实现的功能验收清单。

- **手册出现某功能 ≠ 我们必须开发**；
- **现有 Requirement 曾列入某能力 ≠ 可以未经变更程序直接删除或改变已批准合同**；
- 产品目标是：在保证业务正确性、安全性与数据一致性的前提下，实现**满足实际使用需求的最小完整业务闭环**。

### 1.2 四条轴（不得互相替代）

沿用审计台账 [`b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md) §0.6：

| 轴 | 含义 | 本文件的处置 |
|---|---|---|
| `Evidence Status` | 代码问题证据状态（静态 / 实测） | 引用台账，**不**在本文件复制 Issue 清单 |
| `Product Scope` | 该能力是不是本 ERP 未来要做的 | §3 矩阵给出**建议**值；未批准前一律 `SCOPE_REVIEW_PENDING` |
| `Authorization` | 本次是否授权动手开发 | 全部 `NOT_AUTHORIZED`；**不因** `CORE_REQUIRED` 自动授权 |
| `Delivery Status` | 当前实施与验收到了哪一步 | 引用 [`CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md) 与 `PROJECT_STATUS.md`，**不**在本文件复制 |

**开发决策顺序**：发现问题 → 证据核验 → 业务价值判断 → 对照已批准 Requirement/Design →
必要时 Scope Change / Owner Decision → 授权 → 实施 → 回归 → 逐项验收。

### 1.3 本文件做什么 / 不做什么

| 做 | 不做 |
|---|---|
| 审查现有 Requirement / Design 是否无条件要求实现全部手册功能 | 不修改任何已批准的 Requirement / Design 正文 |
| 逐能力提出 `CORE_REQUIRED` / `SIMPLIFIED` / `OPTIONAL` / `DEFERRED` / `OUT_OF_SCOPE` **建议** | 不自行宣告范围已裁剪（后五项须有可追溯 Owner / Scope Decision） |
| 为与已批准合同冲突的裁剪建立 Scope Change Proposal | 不授权任何 Implementation、Migration、数据库操作 |
| 提出危险写入路径的**修复**或**安全关闭**方案 | 不实施任何代码修改 |
| 提出复用约束与交付标准改写 | 不以裁剪为由放弃库存、金额、权限、来源、事务、幂等、审计等核心正确性 |

### 1.4 与已批准合同的关系

- **M1-Core 已批准合同继续有效**：§31.13 Requirement、Active Design
  [`procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)、
  七 Gate Owner Acceptance 与 `M1_CORE_ACCEPTANCE_PASS`（2026-11-07）
  **一律不动**。本文件的建议**不覆盖**M1-Core 首期已交付范围。
- **D-01～D-04 继续保持延期、未授权**；WP-I / WP-J / M-15 状态不变；
  旧 M1 13 Gate **不**恢复为当前实施要求。
- 本文件对 §31.3 / §31.4 / §31.8 / §31.10 与 Design §26.27 / §26.31 的裁剪建议，
  **必须**先经业务所有者批准（见 §4 的 SCP），**才能**在未来的 Requirement / Design /
  Capability Matrix 中体现；**历史不改写**。

---

## 2. 现有 Requirement / Design 是否无条件要求实现全部手册功能

### 2.1 Requirement 层证据（`docs/requirements/procurement-outsourcing.md`）

| 位置 | 原文要点 | 性质 |
|---|---|---|
| §31.1 范围与 ownership | 逐条列出采购参数、Sourcing/Quota、PR/PO/Receipt/Return、委外全套、VMI 全套为本 Domain 拥有 | **无条件纳入范围** |
| §31.3.1 / §31.3.2 / §31.3.3 | 54 项能力逐条给出 `Implementation Decision` = `NEW` / `ENHANCE` / `KEEP` / `CONVERGE` | **逐项无条件实现决策** |
| §31.4 目标 Capability Closure 要求 | PRC-01…PRC-26、VMI-01…05、OUT-01…23 **每一项**的落地后 Coverage 目标写死为 `COVERED`；OUT 行写明「**23 capability 全部落地**」 | **无条件全覆盖目标** |
| §31.8 A. Functional | 「全部 PRC-01~26 + VMI-01~05 + OUT-01~23 = 54 项 capability **每一项都必须有 final capability disposition**」；「**所有 49 项必须达到 Requirement 定义的目标闭环**；不得残留未经用户批准的 `MISSING` / `SEMANTIC_MISMATCH`」 | **强制闭环** |
| §31.8 A.1 VMI | 「**VMI-01~05 全部归本 Domain 完成**……**不得**将 VMI-03 / VMI-05 整个 capability defer 给 Inventory Domain」 | **显式禁止 VMI 延期** |
| §31.10 最终接受状态 | 「本节 Requirement 包含 26 + 5 + 23 = 54 项 Capability / 10 个 Wave / 11 个新增 permission family」 | **以手册能力总数为验收单位** |

### 2.2 Design 层证据（`docs/design/procurement-outsourcing.md` §26）

| 位置 | 原文要点 | 性质 |
|---|---|---|
| §26.2–§26.20 | 逐能力给出表结构、API、生命周期、事务与并发设计 | **逐项无条件设计** |
| §26.27 Implementation Waves and Gates | Wave A–J 覆盖全部 54 项，Wave J 以「UI 工作面与 launcher 收敛」为收敛点 | **逐项无条件实施计划** |
| §26.31 Design Review Checklist | 「54-capability trace preserved (49 domain-owned + 5 integration-backed)」 | **以手册追溯条数作为设计验收项** |
| §26.29 Explicit Reused Canonical Owners | 逐项列出应复用的 canonical owner（Inventory / Quality / AP / UOM / BOM / Approval / Planning） | **复用约束**（本文件 §6 继承并强化） |
| §26.30 Explicitly NOT Implemented | 已排除 Multi-Org / Multi-Currency / PDA / Finance rewrite / Inventory ledger rewrite 等 | **既有排除清单** |

### 2.3 审查结论

**结论：现有 Requirement 与 Design 确实把金蝶手册的几乎全部功能无条件列为必须实现。**

- 覆盖率口径是**手册能力条数**（54 项 / 10 个 Wave），不是**业务闭环价值**；
- 缺一条能力即构成「未闭环」（§31.8 A），因此任何裁剪都会被判定为不合格；
- §31.8 A.1 甚至**显式禁止**把 VMI 延期 —— 这使「VMI 暂缓」在现行合同下**无法表达**；
- §26.31 把「54-capability trace preserved」列为设计验收项，使**能力条数**本身成为交付标准。

**影响**：这与项目既定产品目标（最小完整业务闭环，而非 1:1 复刻）**不一致**，
且与已生效的 M1-Core 范围重定基线（`M1-SRD-01`，2026-11-02）所采用的「有界首期 + 显式延期」方法**不自洽**。

### 2.4 受本建议影响、且当前属于**已批准合同**的范围

| 合同位置 | 内容 | 本文件的建议方向 |
|---|---|---|
| Requirement §31.3.1 / §31.3.2 / §31.3.3 | 54 项 `Implementation Decision` | **32 项**进入具体 SCP（其中 **28 项**建议改变处置结论，**4 项**维持 `CORE_REQUIRED` 但需明确形式或修复义务） |
| Requirement §31.4 | 全部 `COVERED` 目标 | 改为「按 Scope Decision 裁剪后的最小闭环」 → 需 SCP-01 |
| Requirement §31.8 A / A.1 | 54 项全部闭环、禁止 VMI 延期 | 改为「按 Scope Decision 处置」→ 需 SCP-01 / SCP-11 |
| Requirement §31.10 | 以 54 项 / 10 Wave 为验收单位 | 改为以**业务闭环**为验收单位 → 需 SCP-01 |
| Design §26.27 | Wave A–J 全覆盖 | 改为按裁剪后的最小闭环排期 → 需 SCP-01 |
| Design §26.31 | 「54-capability trace preserved」 | 改为「已裁定范围的 trace preserved」→ 需 SCP-01 |
| Design §26.2–§26.20 | 逐能力设计正文 | 设计正文**不删除**；裁剪只改变**实施优先级与验收义务**，实施前按 §4 的 SCP-02～SCP-15 逐项处理 |
| Requirement §31.2 / §31.5 / §31.6 / §31.7 / §31.9 | 账务链、权限、不变量、Out of Scope、Hard Stop | **不变**，本文件全部继承 |

---

## 3. 产品范围建议矩阵（**建议值，未批准**）

### 3.1 判定口径

| 建议值 | 含义 | 判据 |
|---|---|---|
| `CORE_REQUIRED` | 最小可用业务闭环必须具备 | 缺它则核心业务闭环断裂，或破坏库存/金额/权限/来源/事务/幂等/审计正确性 |
| `SIMPLIFIED` | 保留该能力，但按更小的实现形态交付 | 业务价值成立，但手册形态包含低价值复杂度；可复用现有模块，不另建引擎 |
| `OPTIONAL` | 有价值但当前无明确需求 | 待真实业务场景出现后再排；当前不得作为交付标准 |
| `DEFERRED` | 暂缓，暂不建设 | 依赖未就绪、跨域未解、或财务/成本语义未裁定 |
| `OUT_OF_SCOPE` | 并入其他能力或明确不做 | 独立实体无必要，改由其他能力承载 |

**全部 54 项的当前 `Product Scope` = `SCOPE_REVIEW_PENDING`**；下表是**建议**，不是已生效范围。
`Authorization` 一律为 `NOT_AUTHORIZED`。
「关联」列指向**与该能力处置直接相关的 SCP**；`—` 表示该能力的处置结论不变（仍受 SCP-01 的统一验收口径调整影响）。

### 3.2 B3101 采购（PRC-01 ~ PRC-26）

| ID | Capability | 本轮代码审计状态 | 建议 Product Scope | 理由与裁剪边界 | 关联 |
|---|---|---|---|---|---|
| PRC-01 | Procurement Parameters | 部分代码存在 | `CORE_REQUIRED` | 参数开关是 source/quota/默认账务/容差/退货政策的上游控制，成本低、杠杆高；复用现有 `procurement-parameters.js`，不重建参数中心 | — |
| PRC-02 | Supplier Procurement Profile | 后端档案接口存在 | `CORE_REQUIRED` | 供应商资格是寻源/委外的前置门禁；**扩展**既有 Supplier master（不重建）；必须补 AUD-PRC-003 的开关与业务日期判定 | — |
| PRC-03 | Buyer / Purchasing Group | 后端 CRUD / membership 路由存在 | `SIMPLIFIED` | 先做**简单归属**（单据记录采购员/采购组）；复杂组织级数据隔离需真实场景驱动。服务端既有权限**不得**被削弱 | SCP-03 |
| PRC-04 | Source List | 货源列表及创建/停用接口存在 | `SIMPLIFIED` | 保留「启用 source control 时无有效货源不得静默使用」与 override 原因+审计（正确性）；不建复杂资质评分/多维有效期模型 | SCP-02 |
| PRC-05 | Quota（自动比例分配） | 分配函数存在 | `DEFERRED` | 自动配额是**优化**而非正确性；无真实需求时改为手工寻源分配即可覆盖业务；保留参数开关为关闭态，避免"有参数无实现"的悬空 | SCP-02 |
| PRC-06 | Sourcing Decision | 写接口存在 | `CORE_REQUIRED` | 记录"为什么向这个供应商下多少"是采购商业可追溯的最小要求；已有活跃写入口，必须先修 AUD-PRC-001（P0 权限）与 AUD-PRC-002 | SCP-02 |
| PRC-07 | Purchase Price List | 价格列表、创建接口存在 | `CORE_REQUIRED` | 基础取价与 PO 价格冻结是金额正确性基础；复用 canonical 金额与舍入 | SCP-04 |
| PRC-08 | Pricing UOM | 使用通用 UOM 快照 | `CORE_REQUIRED` | 计价单位 ≠ 采购单位时的取价与金额换算是**金额正确性**，非可选功能；必须修 AUD-PRC-004（P0）；禁止第二 UOM engine | SCP-04 |
| PRC-09 | Procurement Pricing Discount | 折扣方案代码存在 | `SIMPLIFIED` | 只保留**单级**折扣因子，且仅影响 price resolution / PO snapshot（不入 AP）；多级折扣、复杂公式、历史重算不作为目标 | SCP-04 |
| PRC-10 | Purchase Price Adjustment | 新版本调整接口存在 | `OUT_OF_SCOPE` | 调价的业务实质是「带生效期的价格版本」，由 PRC-07 的 effectivity-dated price list 承载即可；**不建独立调价引擎**，避免第二价格真相 | SCP-04 |
| PRC-11 | Requisition Sources | 手工/计划来源存在 | `SIMPLIFIED` | 保留「手工」+「计划转请购」两类来源与 source-line trace；**不**预先把销售订单直转请购、生产订单直转、安全库存直转写成已确认事实 | SCP-05 |
| PRC-12 | PR Split / Merge / Supplier Allocation | 有批量转换基础 | `SIMPLIFIED` | 保留逐行供应商分配、部分数量转换、余量保护；不建复杂拆并规划器 | SCP-05 |
| PRC-13 | Purchase Order | 基础生命周期存在 | `CORE_REQUIRED` | 已是 `KEEP`；保持 `DRAFT → SUBMITTED → APPROVED / REJECTED` 与 Execution lifecycle 分离 | — |
| PRC-14 | PO Commercial Snapshot | 部分供应商快照存在 | `CORE_REQUIRED` | 供应商、价格、付款条件、来源的冻结快照是商业可追溯与后续争议处理基础；仅"付款方/结算方"等扩展字段可按需追加 | — |
| PRC-15 | Gift / Free Item | 已有赠品字段 | `OPTIONAL` | 赠品场景未确认出现。**保留的不变量**：非赠品行不得零价绕过商业校验；赠品建模本身待真实需求 | SCP-06 |
| PRC-16 | Delivery Schedule / Quantity Control | 交货计划接口存在 | `CORE_REQUIRED` | M1-Core `MC-REQ-02` 的容量上界直接依赖交期/容差；不是可选功能。可简化为单交期行 + 容差上界，多次交货可按需追加 | — |
| PRC-17 | Prepayment Requirement | 不得仅凭字段存在认定 | `DEFERRED` | 预付款的实际支付与核销属 Finance；Procurement 侧需求单在无预付款业务前无价值。**不建第二支付引擎** | SCP-07 |
| PRC-18 | PO Change | ADD/MODIFY/CANCEL 代码存在 | `SIMPLIFIED` | 保留 `MODIFY`（数量/价格）+ `CANCEL`，且必须修 AUD-PRC-005（P0 原始快照与金额一致性）；`ADD`（追加行）待真实需求 | SCP-08 |
| PRC-19 | PO Execution Status | 公共执行视图存在，MRP 有独立 SQL | `CORE_REQUIRED` | canonical `open remaining quantity` 是跨域正确性不变量（MRP / 预留 / 收货共用同一口径）；必须修 AUD-PRC-006（P0），不得复制第二套 SQL 口径 | SCP-09 |
| PRC-20 | Receipt Notice | 后端通知能力存在 | `CORE_REQUIRED` | M1-Core 已批准范围（采购收料通知 + 来源转换 + 多 PO 容量）；不得改变库存/估值/GRNI/AP | — |
| PRC-21 | Incoming Inspection | 复用 IQC | `CORE_REQUIRED` | 复用既有 IQC backbone；**不新建质量引擎** | — |
| PRC-22 | Purchase Receipt | 复用库存主干 | `CORE_REQUIRED` | 库存入账主干；交期、来源行并发与账务不变量必须成立 | — |
| PRC-23 | Billing Mode Semantics | 三种模式待验证 | `CORE_REQUIRED` | 默认 `SEPARATE` 的三账务链是会计正确性硬约束；`LEGACY_DIRECT` 仅历史兼容 | — |
| PRC-24 | Return Request | 仅有表头级实现 | `SIMPLIFIED` | 保留**单级**退货申请（来源 + 原因 + 数量），可与退货执行同屏完成；不建多级申请/审批流。现有活跃写入口必须补齐明细与来源数量保护（AUD-PRC-007） | SCP-10 |
| PRC-25 | Purchase Return | 已有四分支相关实现 | `CORE_REQUIRED` | 库存冲销与商业/应付调整分离但保留来源追溯；四分支账务合同为会计正确性硬约束 | — |
| PRC-26 | Procurement Scan | 已有扫码来源解析入口 | `OPTIONAL` | 无 PDA / 扫码枪工作场景确认；手工录入可覆盖。**不做** camera SDK / 条码设计器 / 标签打印 / 通用 PDA 平台 | SCP-06 |

### 3.3 VMI（VMI-01 ~ VMI-05）

VMI 的物理前提是 `physical location = enterprise site / owner = supplier`，完整落地依赖 Inventory
owner dimension（跨域）。按审计台账 §0.7「VMI 结算/物权转移 —— 保持延期/拒绝边界」。

| ID | Capability | 本轮代码审计状态 | 建议 Product Scope | 理由与裁剪边界 | 关联 |
|---|---|---|---|---|---|
| VMI-01 | VMI Policy / Agreement | 有 Agreement 基础代码，资格语义可疑 | `DEFERRED` | 依赖 Inventory owner dimension；且当前实现误用委外资格（AUD-VMI-001）。**不因手册存在而强制建设** | SCP-11 |
| VMI-02 | VMI Receiving | 有收货单代码，受 owner dimension 门禁 | `DEFERRED` | 真实 VMI 收货必须落到 supplier-owned 桶；owner dimension 未就绪前，活跃写路径必须安全关闭（见 §5） | SCP-11 |
| VMI-03 | VMI Consumption | 有消耗代码，幂等待复验 | `DEFERRED` | 消耗会减少 supplier-owned 桶；同样受 owner dimension 门禁。**注意**：现行 Requirement §31.8 A.1 明文禁止 defer 本项，必须由 Owner 显式裁定 | SCP-11 |
| VMI-04 | Consumption Summary / Ownership Transfer | 需核对汇总窗口与结算链 | `DEFERRED` | 结算窗口与物权转移是财务级语义，未裁定前不建 | SCP-11 |
| VMI-05 | Ownership Transfer / Supplier Bill Handoff | 受延期政策与跨域依赖约束 | `DEFERRED` | 物权转移 + 供应商账单交接跨 Inventory 与 Finance 两侧；**不得**自行开放正式结算 | SCP-11 |

**边界**：延期**不等于**允许保留不安全的活跃写入口。VMI 现有写路径必须按 §5 处置。

### 3.4 B3121 委外（OUT-01 ~ OUT-23）

| ID | Capability | 本轮代码审计状态 | 建议 Product Scope | 理由与裁剪边界 | 关联 |
|---|---|---|---|---|---|
| OUT-01 | Outsourcing Supplier | 复用供应商档案 | `SIMPLIFIED` | 并入 PRC-02 的同一份 Supplier 扩展（`outsourcing enabled` + 委外资格 + WIP 仓库绑定），**不建第二供应商主数据** | SCP-12 |
| OUT-02 | Outsourcing Source List | 复用货源基础 | `SIMPLIFIED` | 复用 PRC-04，`source_type = OUTSOURCE`；**不建第二货源实体** | SCP-12 |
| OUT-03 | Processing Price | 有采购价格基础 | `OUT_OF_SCOPE` | 加工费本质是"来源不同的价格"，由 PRC-07 的 price list 承载（加工费来源类型）即可；**不建独立加工费价格实体** | SCP-12 |
| OUT-04 | Supplier WIP Warehouse | 有绑定/位置基础 | `CORE_REQUIRED` | WIP 是**物理/保管位置**不是物权；M1-Core 已批准范围；绑定必须是 canonical Warehouse，**不建第二仓库主数据** | — |
| OUT-05 | Planning Handoff | 有计划交接代码 | `OPTIONAL` | 计划驱动委外是否是真实现场景未确认；手工委外订单已覆盖最小闭环。保留 exactly-once 消费与并发安全要求，仅在启用时 | SCP-12 |
| OUT-06 | Outsourcing Order | 订单创建与计划来源代码存在 | `CORE_REQUIRED` | M1-Core 已批准；委外单据主链起点 | — |
| OUT-07 | Outsourcing Lifecycle | 有生命周期转换 | `SIMPLIFIED` | 保留 `PLAN_CONFIRMED / RELEASED / COMPLETED / CLOSED`（+ DRAFT / CANCELLED）；**不**引入 `SUBMITTED / APPROVED` 多级审批 | SCP-12 |
| OUT-08 | OUTSOURCE BOM | 有 BOM 快照基础 | `CORE_REQUIRED` | 复用既有 OUTSOURCE BOM 解析器（approved / effective / `purpose=OUTSOURCE` / 业务日期）；**禁止** `ACTIVE LIMIT 1`，**不建第二 BOM 引擎** | — |
| OUT-09 | Outsourcing Material List | 有用料明细 | `CORE_REQUIRED` | M1-Core 已批准；执行快照 + Release 后不回写历史是核心不变量 | — |
| OUT-10 | Outsourcing PO | 有加工费 PO 关联 | `SIMPLIFIED` | 复用 canonical PO（`business_type = OUTSOURCE_PROCESSING`），**不建第二套采购单据**；已由 `M1C-D-PO01` 批准该方向 | SCP-12 |
| OUT-11 | Material Issue | 有发料实现 | `CORE_REQUIRED` | M1-Core 已批准；必须走 canonical Inventory Writer，禁止裸 `UPDATE` 库存余额 | — |
| OUT-12 | Material Supplement | 有补料实现 | `CORE_REQUIRED` | 与 Issue 同一链路，需来源可追溯与原因 | — |
| OUT-13 | Material Return | 有退料实现 | `CORE_REQUIRED` | 库存反向移动 + 身份追踪；来源与数量守恒 | — |
| OUT-14 | Material Ownership | 有企业所有权与 WIP 位置基础 | `CORE_REQUIRED` | 企业所有权全程不变 + 逐单材料位置；**不是**新 owner ledger | — |
| OUT-15 | LOT / SERIAL | 复用追踪能力 | `CORE_REQUIRED` | 发料→WIP→退料/倒冲全链可追；复用 canonical tracking，**不建第二 serial/lot 引擎** | — |
| OUT-16 | Backflush | 有增量倒冲实现 | `SIMPLIFIED` | 只保留 **M1-Core 已批准的合法增量倒冲**（逐单逐行累计模型）；跨订单消耗、跨期成本携带、复杂差异分摊 → `DEFERRED`（与 D-01 / AUD-OUT-001 一致） | SCP-13 |
| OUT-17 | Completion Receipt Notice | 已有统一收料通知代码 | `CORE_REQUIRED` | M1-Core 已批准；**不**改变库存/GRNI/AP | — |
| OUT-18 | Outsourcing Inspection | 复用 IQC | `CORE_REQUIRED` | 扩展 IQC source-type；待检不得提前计入正式指标（见 AUD-OUT-002） | — |
| OUT-19 | Outsourcing Inbound | 有两阶段收货实现 | `CORE_REQUIRED` | M1-Core 已批准；只有确认有效的委外收货才形成企业成品库存事实 | — |
| OUT-20 | Processing Fee AP | 有 Supplier Bill 草稿路径 | `DEFERRED` | 与 M1-Core 已登记的「委外 AP/GL 自动过账」延期一致；维持来源级 409 拒绝守卫（`OUTSOURCING_GL_POLICY_NOT_APPROVED`），**不得**自行开放正式过账 | SCP-14 |
| OUT-21 | Outsourcing Cost Evidence | 有临时成本证据 | `SIMPLIFIED` | 只保留「实际倒冲消耗材料的账面价值」作为委外侧成本证据；加工费随账单产生；最终成本调整与差异分摊归 Finance | SCP-13 |
| OUT-22 | Finished Return | 当前首期范围受拒绝/延期边界约束 | `DEFERRED` | 成品退货依赖账单可抵扣交接（Finance），场景未确认；**不得**机械复用普通采购退货的价格语义 | SCP-14 |
| OUT-23 | Period-End / WIP / Opening / Reports | 多个子能力需区分 | `SIMPLIFIED` | 保留**少量关键报表**（委外执行汇总、领料汇总明细）并修正待检口径（AUD-OUT-002）；期初委外订单/期初在产品 → `OPTIONAL`（可用导入替代）；跨单/跨期 WIP 转移与倒冲差异分摊 → `DEFERRED`（与 D-01 / AUD-OUT-001 一致） | SCP-15 |

### 3.5 汇总统计（**建议值，未批准**）

| 建议 Product Scope | 数量 | 占比 | 说明 |
|---|---|---|---|
| `CORE_REQUIRED` | **26** | 48.1% | 最小可用业务闭环 + 核心正确性不可裁剪项 |
| `SIMPLIFIED` | **14** | 25.9% | 保留但以更小实现形态交付，不另建引擎 |
| `OPTIONAL` | **3** | 5.6% | 有价值但当前无明确需求，待场景出现再排 |
| `DEFERRED` | **9** | 16.7% | 跨域未解 / 财务语义未裁定 / 场景未确认 |
| `OUT_OF_SCOPE` | **2** | 3.7% | PRC-10 并入 PRC-07；OUT-03 并入 PRC-07 |
| **合计** | **54** | 100% | PRC 26 + VMI 5 + OUT 23 |
| `SCOPE_REVIEW_PENDING`（**当前生效值**） | **54** | 100% | 未获 Owner 批准前，全部能力维持此值 |

**与已交付范围的一致性**：26 项 `CORE_REQUIRED` 中，**16 项**直接落在 M1-Core 首期已批准范围内
（采购收料通知 / 来源转换 / IQC / 采购入库 / 交期容量口径；委外订单 / BOM 用料 / 发退补料 /
Supplier WIP / 完工通知 / 质量门禁 / 增量倒冲 / 成品入库；canonical Inventory / Tracking / Valuation 横切），
**10 项**（PRC-01 / 02 / 06 / 07 / 08 / 13 / 14 / 19 / 23 / 25）属 §31 Domain Closure 已批准范围且已有实现。
本建议**未缩小**任何已交付或已批准能力；裁剪只发生在**未交付**部分
（自动配额、独立调价实体、VMI 全域、委外财务与成品退货、期初与跨期 WIP、复杂报表等）。

---

## 4. Scope Change Proposal（**待业务所有者批准**）

每个 SCP 独立可批可驳。**未获批准前，被提议的范围变更一律不生效**，
对应能力维持现行已批准合同的状态，且**不授权任何 Implementation**。

### SCP-01 —— 验收口径从「手册能力条数」改为「已裁剪的最小业务闭环」

| 项 | 内容 |
|---|---|
| 提议 | 把 §31.4 / §31.8 A / §31.10 与 Design §26.27 / §26.31 的**验收单位**从「54 项能力全部 `COVERED`」改为「**经 Scope Decision 裁剪并批准的能力集合**全部 `COVERED`」；被裁剪项按 §3 建议值处置 |
| 理由 | 现行口径使任何裁剪都自动判为不合格，且把**手册能力条数**变成了交付标准，与「不复刻金蝶、按需建设」的产品目标冲突 |
| 影响 | §31.3 / §31.4 / §31.8 / §31.10、Design §26.27 / §26.31；**§31.2 / §31.5 / §31.6 / §31.7 / §31.9 不变** |
| 需批准 | ① 是否把验收单位改为「已裁剪集合」；② 是否同时删除 §26.31 的「54-capability trace preserved」验收项 |

### SCP-02 —— 采购寻源与配额简化（PRC-04 / PRC-05 / PRC-06）

| 项 | 内容 |
|---|---|
| 提议 | PRC-05 自动配额 `DEFERRED`（参数保留为关闭态）；PRC-04 保留简化货源清单 + 启用即禁止静默使用 + override 原因与审计；PRC-06 保留为**手工寻源分配记录**，并先修 AUD-PRC-001（P0 权限）/ AUD-PRC-002（hash） |
| 理由 | 自动配额是优化而非正确性；手工分配已覆盖最小闭环；正式写接口的权限与来源正确性不可简化 |
| 影响 | §31.3.1 PRC-04 / 05 / 06、§31.4 对应行、§31.8 A.1 |
| 需批准 | ① 是否确认放弃自动配额；② 寻源决策是否保留为正式单据 |

### SCP-03 —— 采购员 / 采购组简化（PRC-03）

| 项 | 内容 |
|---|---|
| 提议 | 保留单据级采购员/采购组**归属**；复杂组织级数据隔离 `SIMPLIFIED`，按真实场景再定 |
| 理由 | 组织级隔离成本高、收益取决于实际组织结构；服务端现有权限不得被削弱 |
| 影响 | §31.3.1 PRC-03、§31.4 对应行 |
| 需批准 | 是否存在跨采购组强制隔离的真实业务场景 |

### SCP-04 —— 价格与折扣收敛（PRC-07 / PRC-08 / PRC-09 / PRC-10）

| 项 | 内容 |
|---|---|
| 提议 | PRC-10 独立调价实体 `OUT_OF_SCOPE`，调价并入 PRC-07 的带生效期价格版本；PRC-09 只保留**单级**折扣因子（仅影响取价与 PO 快照）；PRC-07 / PRC-08 保持 `CORE_REQUIRED` 并必须修 AUD-PRC-004（P0 计价单位金额） |
| 理由 | 调价与折扣的复杂形态是低频场景；避免第二价格真相；**金额正确性不可简化** |
| 影响 | §31.3.1 PRC-07～10、§31.4 对应行、Design §26.5 |
| 需批准 | ① 是否接受调价并入价格版本；② 折扣是否只要单级 |

### SCP-05 —— 请购来源与拆并简化（PRC-11 / PRC-12）

| 项 | 内容 |
|---|---|
| 提议 | 来源收敛为「手工 + 计划转请购」；拆并只保留逐行分配、部分数量转换与余量保护，不建拆并规划器 |
| 理由 | 销售订单直转请购等来源缺少真实来源事实；拆并规划器复杂度高于收益 |
| 影响 | §31.3.1 PRC-11 / 12、§31.4 对应行 |
| 需批准 | 是否有必须支持的其它请购来源 |

### SCP-06 —— 赠品与扫码归入可选（PRC-15 / PRC-26）

| 项 | 内容 |
|---|---|
| 提议 | 两项 `OPTIONAL`；**保留不变量**：非赠品行不得零价绕过商业校验；扫码不做 camera SDK / 条码设计器 / 标签打印 / 通用 PDA 平台 |
| 理由 | 两项场景均未确认；其正确性要求（零价约束）由 PO 商业校验保留 |
| 影响 | §31.3.1 PRC-15 / 26、§31.4 对应行 |
| 需批准 | ① 是否存在赠品业务；② 是否需要扫码 / PDA 工作方式 |

### SCP-07 —— 预付款需求暂缓（PRC-17）

| 项 | 内容 |
|---|---|
| 提议 | `DEFERRED`；Procurement 侧不建预付款需求与第二支付引擎 |
| 理由 | 实际支付与核销属 Finance；无预付款业务前该需求单无使用场景 |
| 影响 | §31.3.1 PRC-17、§31.4 对应行 |
| 需批准 | 是否存在预付款业务；如存在，由 Finance 决定唯一支付 owner 与交互边界 |

### SCP-08 —— 采购订单变更限定子集（PRC-18）

| 项 | 内容 |
|---|---|
| 提议 | 只保留 `MODIFY`（数量/价格）+ `CANCEL`；`ADD`（追加行）按需再定；上线前必须修 AUD-PRC-005（P0 原始快照与金额一致性） |
| 理由 | 变更链是审计敏感区；缩小变更种类显著降低快照/金额不一致风险 |
| 影响 | §31.3.1 PRC-18、§31.4 对应行、Design §26.10 |
| 需批准 | ① 是否需要 PO 追加行；② 未修复前的处置是「修复」还是「安全关闭」（见 §5） |

### SCP-09 —— canonical 采购执行口径保留（PRC-19）

| 项 | 内容 |
|---|---|
| 提议 | 保持 `CORE_REQUIRED`，**不裁剪**；必须让 MRP / 预留 / 收货共用同一 open remaining quantity，修复 AUD-PRC-006（P0） |
| 理由 | 这是跨域正确性不变量；裁剪它会污染计划供应量 |
| 影响 | 无（维持已批准合同），只是把修复义务显式化 |
| 需批准 | 无需批准；仅确认 P0 修复进入后续工作包 |

### SCP-10 —— 退货申请单级化（PRC-24）

| 项 | 内容 |
|---|---|
| 提议 | 保留**单级**退货申请（来源 + 原因 + 数量），不建多级申请/审批流；现有活跃写入口必须补齐明细与来源可退数量保护（AUD-PRC-007） |
| 理由 | 申请与退货执行分离的正确性要求保留；审批链复杂度收益低 |
| 影响 | §31.3.1 PRC-24、§31.4 对应行、Design §26.14 |
| 需批准 | ① 是否单级即可；② 未补齐前的处置（修复或安全关闭） |

### SCP-11 —— VMI 全域暂缓（VMI-01 ~ VMI-05）

| 项 | 内容 |
|---|---|
| 提议 | 五项全部 `DEFERRED`；**直接冲突**：§31.8 A.1 明文「VMI-01~05 全部归本 Domain 完成」且「不得将 VMI-03 / VMI-05 整个 capability defer」 |
| 理由 | VMI 完整物理可用性依赖 Inventory owner dimension（跨域）；无业务决策前开放结算与物权转移会引入真实库存与金额错误风险 |
| 影响 | §31.3.2 全部 5 行、§31.4 VMI 行、§31.8 A.1 VMI 段、Design §26.16 |
| 需批准 | **必须显式批准**才能突破 §31.8 A.1 的禁止条款；并同时裁定现有 VMI 活跃写路径的处置（见 §5） |

### SCP-12 —— 委外基础配置复用收敛（OUT-01 / OUT-02 / OUT-03 / OUT-05 / OUT-07 / OUT-10）

| 项 | 内容 |
|---|---|
| 提议 | 委外供应商、委外货源、加工费价格、委外 PO **全部复用** canonical 供应商 / 货源 / 价格 / 采购单据（`source_type` / `business_type` 区分），不建第二套主数据；计划交接 `OPTIONAL`；生命周期不引入多级审批 |
| 理由 | 委外与采购共用主体与单据主干；复用可避免多份真相，符合「不重复建立库存/质量/财务/审批/计划引擎」的硬约束 |
| 影响 | §31.3.3 对应 6 行、§31.4 OUT 行、Design §26.17 / §26.18 |
| 需批准 | ① 是否确认全部复用（不建第二主数据）；② 计划驱动委外是否为真实现场景 |

### SCP-13 —— 委外倒冲与成本证据限定有界（OUT-16 / OUT-21）

| 项 | 内容 |
|---|---|
| 提议 | 只保留 M1-Core 已批准的**合法增量倒冲**与「实际倒冲消耗材料账面价值」成本证据；跨订单消耗、跨期成本携带、倒冲差异分摊 `DEFERRED`（与已生效的 D-01 / AUD-OUT-001 一致，**不新增**延期） |
| 理由 | 跨单/跨期成本携带是高风险引擎，不应为满足手册条目而引入 |
| 影响 | §31.3.3 OUT-16 / OUT-21、§31.4 OUT-23 行、Design §26.19 / §26.20 |
| 需批准 | 确认维持既有延期边界，并把范围口径写入未来 Requirement |

### SCP-14 —— 委外财务与成品退货暂缓（OUT-20 / OUT-22）

| 项 | 内容 |
|---|---|
| 提议 | 两项 `DEFERRED`；维持来源级 409 拒绝守卫（`OUTSOURCING_GL_POLICY_NOT_APPROVED`），**不得**自行开放正式过账；成品退货依赖 Finance 可抵扣交接 |
| 理由 | 与 M1-Core 已登记的「委外 AP/GL 自动过账」延期一致；财务语义未裁定前开放会产生真实 AP/凭证错误 |
| 影响 | §31.3.3 OUT-20 / OUT-22、§31.4 OUT 行、Design §26.20 |
| 需批准 | 确认维持既有延期；确认成品退货是否进入产品范围 |

### SCP-15 —— 委外期初 / 期末与报表限定（OUT-23）

| 项 | 内容 |
|---|---|
| 提议 | 保留少量关键报表（委外执行汇总、领料汇总明细）并修正待检口径（AUD-OUT-002）；期初委外订单 / 期初在产品 `OPTIONAL`（可用导入替代）；跨单/跨期 WIP 转移与倒冲差异分摊 `DEFERRED` |
| 理由 | 报表字段应可从业务事实复算；期初数据可用导入替代专有单据；跨期 WIP 属高风险 |
| 影响 | §31.3.3 OUT-23、§31.4 OUT-23 行、Design §26.20 / §26.23 |
| 需批准 | ① 需要哪几张报表；② 期初数据走导入还是专单据 |

---

## 5. 危险写入路径的处置建议（**不得以「暂时不需要」容忍不安全写入**）

按审计台账 §0.6 默认策略：发现代码正确性问题时先评估该入口是否仍会被使用；
**活跃入口必须修复或安全封锁**。本节只给建议，不实施。

### 5.1 处置类别

| 类别 | 含义 |
|---|---|
| `FIX` | 能力保留且入口活跃 —— 必须修复并补回归测试 |
| `FIX_OR_CLOSE` | 能力保留，但入口当前不可信 —— 修复，或在修复前服务端 fail closed / 停用 |
| `SAFE_CLOSE` | 能力被裁剪且无真实场景 —— 经裁定后服务端 fail closed / 只读 / 隐藏入口，**不得**留作可写入 |
| `REPORT_ONLY` | 只影响读出与报表口径 —— 修正口径或停用该指标，**不得**产生错误业务事实 |

### 5.2 逐项处置建议

| 审计 Issue | 入口 / 风险 | 严重度 | 建议处置 | 理由 |
|---|---|---|---|---|
| AUD-FE-001 | `src/pages/sourcing-pricing.jsx` 「模拟寻源分配」按钮以固定 `PR-DEMO-001` / `product-001` / 数量 100 调用**正式写 API** | P0 | `SAFE_CLOSE`（**立即**）+ 服务端拒绝演示来源身份 | 这是**演示按钮误接生产写路径**，不是业务功能；产品裁剪的最直接正确处置是移除该入口并让后端拒绝伪造来源，而不是保留"以后再修" |
| AUD-PRC-001 | `resolveSourcingDecision()` 写操作使用 `assertViewPermission` | P0 | `FIX`（若 PRC-06 保留） | 正式写入口的权限门禁错误；写权限 + 真实来源校验是寻源决策的底线 |
| AUD-PRC-002 | 决策 hash 为输入串长度，非 SHA-256 | P1 | `FIX` | 审计指纹不可信则无法追溯决策 |
| AUD-PRC-003 | 供应商资格校验忽略采购/委外开关与业务日期 | P1 | `FIX` | 资格门禁同时服务 PRC-02/04 与 OUT-01/02，是跨两侧的正确性问题 |
| AUD-PRC-004 | 计价单位价格乘以基础单位数量 | P0 | `FIX` | 金额正确性，不可裁剪（PRC-08 `CORE_REQUIRED`） |
| AUD-PRC-005 | PO Change 原始快照非真实快照、MODIFY 不同步金额 | P0 | `FIX_OR_CLOSE` | 依 SCP-08 决定：保留 `MODIFY`/`CANCEL` 则修复；未修复前该写入口必须 fail closed |
| AUD-PRC-006 | MRP 采购供应量未排除委外加工费 PO | P0 | `FIX` | 计划供应量正确性（PRC-19 `CORE_REQUIRED`） |
| AUD-PRC-007 | 退货申请仅写表头，缺明细与来源数量保护 | P1 | `FIX_OR_CLOSE` | 依 SCP-10 决定；修复前不得允许生成无明细的退货申请事实 |
| AUD-PRC-008 | PO Change `CANCEL` 语义（整单 vs 明细）待复验 | P1 | `NEEDS_REVALIDATION` → 复验后 `FIX` 或 `FIX_OR_CLOSE` | 语义未定，先复验 |
| AUD-PRC-009 | 采购到货及时率按 `received / ordered` 计算 | P1 | `REPORT_ONLY`（修正口径或停用该指标） | 报表口径错误，不产生库存/金额事实 |
| AUD-VMI-001 | VMI Agreement 资格误用 `outsourcing_enabled` | P1 | `FIX_OR_CLOSE` | 依 SCP-11：VMI 暂缓 → 该写入口安全关闭；VMI 保留 → 修正资格定义 |
| AUD-VMI-002 | VMI 收货未见有效 Agreement 绑定校验 | P1 | `SAFE_CLOSE`（依 SCP-11） | 无协议绑定的收货不得产生供应商所有权的库存事实 |
| AUD-VMI-003 | VMI 消耗命令无客户端幂等键 | P1 | `SAFE_CLOSE`（依 SCP-11） | 重放可能重复消耗；裁剪期间不需要对外可用 |
| AUD-OUT-001 | 跨委外订单 WIP 转移只改数量字段，无 canonical Inventory movement | P0* | `SAFE_CLOSE`（维持并**正式化** `DEFERRED_NOT_AUTHORIZED` → 服务端 409） | 已明确延期；若接口仍可写入，会产生"看起来完成了库存转移"的假象 |
| AUD-OUT-002 | 委外执行汇总把 `PENDING_INSPECTION` 计入累计完工 | P1 | `REPORT_ONLY`（待检单列） | 报表污染正式完工/入库指标；属正确读出 |
| AUD-FE-002 | 寻源与定价页只有列表，无维护交互 | P1 | `OPTIONAL`（按 SCP-02 收敛后的最小集合决定） | UI 缺口不是独立缺陷；**不**以菜单完整性为交付标准 |
| AUD-FE-003 | 委外页缺发/补/退/完工/质量/收货工作面 | P1 | 按 `CORE_REQUIRED` 能力集的最小工作面决定 | 与 §3.4 的 `CORE_REQUIRED` 集合对齐；延期能力**不提供**可执行入口 |

### 5.3 fail closed 原则

- 未获授权、跨域依赖未解、或已被裁剪为 `DEFERRED` / `OUT_OF_SCOPE` 的**写入**路径，
  必须**服务端**拒绝（明确 status + error code），**不得**仅在前端隐藏；
- 拒绝路径必须**零业务副作用**，并按合同写拒绝审计；
- `SAFE_CLOSE` 的关闭动作本身必须留下**可追溯裁定**（本文件 + 未来 SCP 批准记录），
  不得成为无据的"功能消失"。

---

## 6. 复用与不新建引擎的硬约束

以下约束在**任何**范围裁剪下都**不得**放宽（继承 Requirement §31.13.1 `INV-1`~`INV-3` 与
Design §26.29，并按本文件 §6.1 收紧）：

| # | 约束 | 依据 |
|---|---|---|
| R-1 | **不新建第二套**库存真相 / 估值余额 / 数量守恒逻辑 | INV-1、INV-3 |
| R-2 | **不新建第二套** IQC / OQC / 质量引擎 | INV-1、Design §26.29 |
| R-3 | **不新建第二套** Supplier Bill / AP / GRNI / 付款引擎 | INV-1、Design §26.29 |
| R-4 | **不新建第二套** UOM 换算引擎 | PRC-08、Design §26.29 |
| R-5 | **不新建第二套** BOM 解析器 | OUT-08、Design §26.29 |
| R-6 | **不新建第二套** MRP / 计划引擎 | PRC-19、Design §26.29 |
| R-7 | **不新建第二套** 审批引擎；采购审批复用既有 `approvals.js` family | Design §26.29 |
| R-8 | **不新建第二套** 供应商 / 货源 / 价格 / 采购单据 / 仓库主数据 | SCP-04 / SCP-12 |
| R-9 | 委外材料执行必须走 canonical Inventory Writer；禁止裸 `UPDATE` 库存余额、禁止硬编码仓库 | INV-3 |
| R-10 | 委外 AP/GL 过账不得绕过来源级 409 守卫；管理员无豁免 | §31.13.5 `MC-REQ-15` / `TC-03` |

### 6.1 收紧说明（相对现行合同）

现行 Requirement / Design 已禁止"重建"类第二引擎，但**未**禁止"新建并行实体"
（如独立调价实体、独立加工费价格实体）。本建议追加：

- **R-8** 明确委外侧与采购侧**共用**供应商 / 货源 / 价格 / 采购单据 / 仓库主数据；
- 因此 SCP-04（PRC-10 并入 PRC-07）与 SCP-12（OUT-03 并入 PRC-07、OUT-10 复用 canonical PO）
  **不新增任何引擎**，只减少实体。

---

## 7. 交付与验收标准的改写（**禁止以手册条目数量为准**）

建议在获批后写入未来的 Requirement / Design：

1. **禁止**把金蝶原版的**菜单数量、表单数量、操作步骤数量**作为开发完成标准；
2. 交付单位是**业务闭环**（如「采购订单 → 收料通知 → 采购入库 → 采购退货」端到端可追溯且账务正确），
   不是能力条目数；
3. 每张业务单据、每个接口、每个报表都必须能追溯到**已批准的范围决定**；
4. 范围决定未覆盖的功能，允许**不存在**；**不得**以"手册里有"为由要求补齐；
5. UI 验收按**真实任务完成度**（操作员能否在移动端完成该业务），不按界面元素覆盖率；
6. 每个开发包必须单独提交**最小范围、验收标准与明确的不做项**。

---

## 8. 保留能力必须维持的核心正确性不变量

**任何**被标为 `CORE_REQUIRED` 或 `SIMPLIFIED` 的能力，仍必须满足：

| 类别 | 硬约束 |
|---|---|
| 库存 | 数量守恒、物权不漂移、位置与所有权分离、失败副作用为零 |
| 金额 | 安全整数分、单一取价与舍入口径、估值与账面价值一致 |
| 权限 | 后端 fail closed；前端隐藏不等于授权；越权直接拒绝并留审计 |
| 来源 | 来源行可追溯；数量、身份、状态、文档关系不丢 |
| 事务 | 关键 mutation 在事务内重读权威状态；失败整体回滚 |
| 幂等 | 同一业务动作重放不得产生第二次库存 / 成本 / 容量占用 |
| 审计 | 关键 mutation 与拒绝路径写审计；历史不可改写 |

**依据**：Requirement §31.13.1 `INV-1`~`INV-12`；§31.6；§31.8 C。
**裁剪的是功能面，不是这些不变量。**

---

## 9. 需业务所有者批准的事项清单

| # | 事项 | 对应 SCP | 影响面 |
|---|---|---|---|
| 1 | 把验收单位由「54 项能力全覆盖」改为「已裁剪集合全覆盖」 | SCP-01 | §31.4 / §31.8 / §31.10 / §26.27 / §26.31 |
| 2 | 删除「以手册菜单/表单/步骤数量为交付标准」 | SCP-01 + §7 | 验收标准 |
| 3 | 放弃自动配额（PRC-05） | SCP-02 | §31.3.1 |
| 4 | 采购员/采购组是否需要组织级强制隔离 | SCP-03 | §31.3.1 |
| 5 | 调价并入价格版本；折扣只保留单级 | SCP-04 | §31.3.1 / §26.5 |
| 6 | 请购来源集合是否收敛为「手工 + 计划」 | SCP-05 | §31.3.1 |
| 7 | 是否需要赠品、扫码/PDA | SCP-06 | §31.3.1 |
| 8 | 是否存在预付款业务 | SCP-07 | §31.3.1 |
| 9 | PO 变更保留 `MODIFY`+`CANCEL` 还是含 `ADD`；未修复前修复还是关闭 | SCP-08 | §31.3.1 / §26.10 / §5 |
| 10 | **VMI 五项是否全部暂缓**（须显式突破 §31.8 A.1 的禁止条款） | SCP-11 | §31.3.2 / §31.4 / §31.8 A.1 / §26.16 |
| 11 | 委外侧全部复用 canonical 主数据与单据 | SCP-12 | §31.3.3 / §26.17 / §26.18 |
| 12 | 计划驱动委外是否为真实现场景 | SCP-12 | OUT-05 |
| 13 | 维持倒冲与成本证据的有界实现 | SCP-13 | OUT-16 / OUT-21 / OUT-23 |
| 14 | 维持委外 AP/GL 与成品退货延期 | SCP-14 | OUT-20 / OUT-22 |
| 15 | 委外需要哪几张报表；期初数据走导入还是专单据 | SCP-15 | OUT-23 |
| 16 | §5 中各危险写入路径的处置类别（`FIX` / `FIX_OR_CLOSE` / `SAFE_CLOSE` / `REPORT_ONLY`） | §5 | 多个活跃写入口 |

---

## 10. 未解决矛盾与风险

1. **§31.8 A.1 与产品目标的直接冲突**：现行合同**明文禁止** defer VMI-03 / VMI-05。
   在业务所有者显式批准 SCP-11 之前，任何"VMI 暂缓"的表述都**不成立**，
   现行合同仍要求 VMI 五项全部完成。本文件**不**自行解释该条款。
2. **能力条数与工程节奏**：现行 §31.8 A 的"全部 49 项必须闭环"是 Domain Closure 的完成定义；
   若 SCP-01 未获批准，本文件 §3 的全部建议**都只是建议**，不改变任何交付义务。
3. **M1-Core 与 Domain Closure 的关系未变**：M1-Core 包级 Acceptance（2026-11-07）
   仍只覆盖其七 Gate；本文件的裁剪**不**也不应被解读为对 M1-Core 已交付范围的否定。
4. **裁剪 ≠ 降级正确性**：若 Owner 选择 `SAFE_CLOSE`，必须同步接受"该入口暂时不可用"的业务后果；
   若选择 `FIX`，修复必须带回归证据，不得只改测试期望。
5. **范围与实现工作量无关**：本文件**不**承诺任何工作量、里程碑或日期。
6. **旧 M1 13 Gate**：仍是 M1 全域 Closure 的验收合同；本建议**不**恢复它为当前实施要求。

---

## 11. 本轮明确未发生

- **未**修改任何已批准的 Requirement / Design 正文、Acceptance、Gate 状态或延期政策；
- **未**实施任何代码整改；**未**修改 `server/`、`src/`、`scripts/` 下任何文件；
- **未**修改数据库 Schema 或 Migration；**未**执行任何数据库写操作、Reset、Bootstrap、Cleanup；
- **未**签发任何 Acceptance / Freeze / `Design PASS`；**未**授权任何 Implementation；
- **未**把任何能力标记为已裁剪、已实现、已测试或已验收；
- **未**执行 Release 或 Deploy；**未** Push / Merge / Tag。
