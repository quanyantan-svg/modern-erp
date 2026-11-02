# M1-SRD-01 —— M1 采购与委外首期范围重定基线决定

> 用途：登记业务所有者于 2026-11-02 批准的三项范围决定（SRD-01 / SRD-02 / SRD-03），
> 界定 M1 首期（M1-Core）的范围边界、延期能力的处理方式与本轮授权边界。
> Owner：业务所有者（决定）/ Platform（登记与维护）
> 状态：`APPROVED`（三项范围决定本身）—— 登记文件，不代表任何 Implementation 授权
> 权威来源：**本文件只登记决定与指针**，规范正文仍在对应的 Requirement / Design 中；
> 本文件**不复制** Requirement / Design 正文，也不构成第二份项目级状态登记表。
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)
> 相关规范正文：[`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.13（M1-Core Requirement）、
> [`docs/reviews/m1/procurement-outsourcing-m1-core-design.md`](../reviews/m1/procurement-outsourcing-m1-core-design.md)（M1-Core 候选 Design）

## 1. 决定与授权来源

| 项 | 值 |
|---|---|
| 决定 ID | `M1-SRD-01` |
| 决定日期 | 2026-11-02 |
| 授权来源 | 业务所有者（Business Owner）显式批准的三项范围决定 |
| 决定形式 | `APPROVED_SCOPE_DECISION`（三项范围决定本身） |
| 基线 | `master` @ `759d7216c7546ffa00a147f603c4e8852aada991`（GitHub `github` 与 Gitee `origin` 两端一致） |
| 决定所取代的授权边界 | 业务所有者此前对 M1 全范围 A/B/C/D 四组（见 `docs/requirements/procurement-outsourcing.md` §31.12.3–§31.12.6）的 Requirement 授权与 Design 起草授权 |
| 本决定**不**授予 | Requirement 验收、Design PASS、Implementation、Migration 执行、数据库写入或重置、MySQL Gate 运行、Git push / merge / tag / release / deploy |

**三项范围决定的标识**：`SRD-01`（首期范围）、`SRD-02`（移动端阶段划分）、`SRD-03`（历史数据证据策略）。
三者均已获业务所有者批准，**本轮不再征询**。

## 2. SRD-01 —— M1-Core 首期范围

### 2.1 首期重点（IN SCOPE）

1. **采购侧**：采购收料通知、采购订单来源转换、IQC、采购入库。
2. **委外物料侧**：委外订单、BOM 用料、发料、退料、补料、Supplier WIP。
3. **委外完工侧**：委外完工通知、正式收货明细、质量门禁、合法增量倒冲、成品入库。
4. **横切能力**：必要的 canonical Inventory / Tracking / Valuation、数量守恒、来源追溯、事务、幂等、权限与审计。

### 2.2 首期不包含（OUT OF SCOPE，延期）

高级跨订单/跨期 WIP、复杂倒冲差异审批、VMI 结算、委外 AP/GL 自动过账、历史会计补偿。

### 2.3 范围边界的解释规则

- 首期**只**验收上列 2.1 的能力链与其横切约束；2.2 的能力**不得**作为 M1-Core 的首期验收条件。
- 延期能力**不是**业务政策通过，也**不是** Implementation 许可；它们的状态由
  [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](./OPEN-BUSINESS-DECISIONS.md) 独立登记。
- 延期能力在首期必须具备**禁止性安全边界**：危险的服务端写入必须被**拒绝且零副作用**，
  不得以"暂未实现"为由保留可写路径。

## 3. SRD-02 —— 移动端阶段划分

- 首期**只**修复现有工作面的 API 调用、基本交互错误、权限与错误展示，
  维持已批准 `U-REQ-01`（`docs/requirements/procurement-outsourcing.md` §31.12.7）的**有限目标**。
- **完整现场移动工作流另立工作包**；本轮**不**重做 MobileShell、导航或视觉体系。
- 移动端修复**不得**改动业务术语、API 合同、权限、状态机、Approval/Confirm/Post/Reverse 语义、
  source/downstream 关系或库存/会计事实。

## 4. SRD-03 —— 历史数据证据策略

- **只**使用真实可证明的历史来源、数量、身份与成本事实。
- 不可证明的数据**不得**推算、自动补记或默认归零。
- 历史证据**保留**；处置方式是只读、隔离或 fail-closed。
- 大规模历史数据治理、自动恢复与会计补偿**延期**。

## 5. 新旧范围的关系

| 维度 | 旧（M1 全范围） | 新（M1-Core 首期） | 关系 |
|---|---|---|---|
| Requirement | `docs/requirements/procurement-outsourcing.md` §31.12（A/B/C/D 四组 + 13 Gate） | 同文件 §31.13（M1-Core 精简合同 + 7 Gate） | §31.12 **保留为历史批准合同**，其**首期当前效力**由 §31.13 取代；历史批准事实 `M1_REQUIREMENT_ACCEPTANCE_PASS`（2026-10-31）保持不变 |
| Design | `docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`（源 `solution.md §26.33`，R1→R4-6-R2） | `docs/reviews/m1/procurement-outsourcing-m1-core-design.md` | 旧候选设计**保留原样、不被改写**；其 A/B/U/T 部分被新候选设计**取代为 M1-Core 合同**，其 C/D 部分（含 WP-7 / WP-8 的政策阻塞子项）**延期** |
| Gate | 13 个（`execution_status` 13/13 `NOT_RUN`） | 7 个（`M1C-G01..M1C-G07`，全部 `NOT_RUN`） | 旧 13 个 Gate 的**逐项处置映射**见新候选 Design；旧 Gate **不得**伪造 PASS |
| 业务政策 | 12 项开放 + `A-P01` 独立待追认 | 见 `OPEN-BUSINESS-DECISIONS.md` §1.4 | 三项范围决定为 `APPROVED_SCOPE_DECISION`；其余按 Core 限定 / 延期 / 待裁定分别登记 |

**关键区分**：**M1-Core 包级 Acceptance ≠ Procurement & Outsourcing 全域 Closure Acceptance。**
前者只覆盖 7 个 Core Gate 与 §31.13 的范围；后者仍以 §31 的 54 项 Capability 处置与
`document.md §31.11` 的历史证据为准，二者不得互相替代或互相引用为 PASS。

## 6. 延期能力的处理方式

1. **范围上移**：延期能力移出 M1-Core 的首期验收条件，登记为
   `DEFERRED_PENDING_POLICY`（见 `OPEN-BUSINESS-DECISIONS.md` §1.4）。
2. **边界上守**：延期不等于放弃。每一条延期能力在首期必须有**明确的拒绝规则**，
   服务端必须 fail closed 且**零副作用**（无部分写入、无半开状态、无副作用记账）。
3. **追溯上留**：延期能力的技术处置方案**保留**在旧候选设计中，不删除、不改写，
   供后续工作包直接继承；M1-Core 设计只引用其结论，不复制其正文。
4. **不得反向推导**：首期的实现**不得**"顺手"实现延期能力；一旦需要延期能力才能成立的核心断言，
   该断言必须被移出 Core 或降级为 fail-closed。

## 7. 本轮授权边界

本次授权覆盖：最小治理登记 → 必要业务政策建议与状态调整 → M1-Core Requirement 修订 →
M1-Core 候选 Design 修订 → Gate 集合重构 → 文档校验与本地提交。

**明确不授权**：

- 任何 `src/`、`server/`、schema、migration 或业务测试的修改；
- 任何数据库连接、重置、迁移或修改；
- Requirement 验收、Design PASS、Domain Acceptance、Capability Freeze、Release Readiness；
- Implementation 的任何阶段；
- Git push / merge / tag / release / deploy；
- MySQL destructive Gate 的运行（必须另有独立 disposable 数据库与逐次明确授权）。

## 8. 历史合同的追溯路径

| 对象 | 追溯位置 |
|---|---|
| M1 原始 Requirement（§31.12 A/B/C/D 四组、13 Gate） | [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.12；Git `4cb8c477aa00988bbfebef905764565cdfe62b71`（`docs(m1): approve procurement and outsourcing requirement`）；验收事实见 §31.12 的 R-ACC 块与 `log/2026-10-31.md` |
| M1 原候选设计（§26.33，R1→R4-6-R2） | [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)；源 SHA `912fd76700ff6f3ad1509eec4c9e2241c1830265`（见该文件抬头） |
| G0 文档结构迁移映射 | [`docs/status/MIGRATION-MAP.md`](../status/MIGRATION-MAP.md) §4；`node scripts/docs/resolve-reference.mjs "<引用>"` |
| M1 审计与 11 项缺陷登记 | `docs/requirements/procurement-outsourcing.md` §31.12.2（G-1..G-5、M1-N01/N03/N04/N11） |
| 开放业务政策登记 | [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](./OPEN-BUSINESS-DECISIONS.md) §1 |
| 当日工作日志 | [`log/2026-11-02.md`](../../log/2026-11-02.md) |

> 上表中的 `912fd767…` 与 `4cb8c477…` 为历史提交 SHA；M1-Core 的规范正文以本文件所链接的
> §31.13 与新候选设计为准，**不得**反向把旧 §31.12 / §26.33 当作当前首期有效合同。

## 9. 本决定的效力边界

- 本决定**只**界定范围、授权边界与登记义务；它**不**裁定任何业务政策。
- 依 §3.3 需要业务所有者签字的**具体裁定**（`A-P01`、`A-P02`、`M1-P-02`、`M1-P-03`、`T-11`）
  仍登记在 `OPEN-BUSINESS-DECISIONS.md` §1.4，状态**未**因本决定而变为已批准。
- 本决定生效后，M1-Core 的 Requirement 与 Design 状态分别为：
  Requirement = `PENDING_APPROVAL`；Design = `PENDING_APPROVAL` / `PENDING_REVIEW`，
  `Design PASS` = `NOT_ISSUED`，`Implementation` = `NOT_AUTHORIZED`。
