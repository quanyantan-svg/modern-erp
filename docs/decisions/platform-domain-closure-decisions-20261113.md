# PL-DEC-01 ～ PL-DEC-03 —— Platform 平台层域闭合范围三项业务裁定（2026-11-13）

> **决策 ID**：`PL-DEC-01`、`PL-DEC-02`、`PL-DEC-03`
> **归属**：业务所有者（范围与政策裁定）；Platform（规范执行）
> **状态**：`APPROVED`
> **规范来源锚点**：[`docs/requirements/platform.md`](../requirements/platform.md) §36（Platform Domain Closure Requirement）；审计台账 [`docs/audits/platform-capability-audit-20261113.md`](../audits/platform-capability-audit-20261113.md) §8.1。
> **不授权**：本记录**不授权任何 Implementation、发布、部署或远端 Git 操作**。Implementation 仍须按 AGENTS.md §4.3 的 HARD STOP 单独取得业务所有者批准。

## 1. 背景

Platform 是九域架构（8 Business Domains + Platform）中唯一未闭合的业务域：既无 Domain Closure Requirement，也无 Domain Closure Design；`docs/status/CAPABILITY_MATRIX.md` 的 B3122 行记 `NOT_STARTED`。

2026-11-13 业务所有者指示：「指导我完成 Platform 域闭合，按照已有文档要求完整建 Platform（Generic Workflow 引擎 + Attachment + Org Scope + Notification 生产者 + Numbering 服务）」。

随后的 AUDIT / COVERAGE 阶段以真实代码逐项复核了 `document.md §17` 的 13 项平台长期能力（PL-01～PL-13）与 `§22.22` 的 8 项 B3122 手册能力（WF-01～WF-08），合计 21 项，结论为 **3 `COVERED` / 7 `PARTIAL` / 11 `MISSING`**，并登记 12 项结构缺口与 16 项真实缺陷。

复核暴露了指示与域级合同之间的三处必须由业务所有者裁定的分歧，故形成本记录。

## 2. 决定

### 2.1 `PL-DEC-01` —— Platform 域闭合范围

**决定**：本域建设五个子系统 —— Generic Workflow 引擎、Attachment、Org Scope、Notification 生产者、Numbering 服务 —— **并**补齐通用 SOD 引擎与生产订单自审批缺口。

**明确 `OUT_OF_SCOPE`（延期后续版本）**：

| 项 | 理由 |
|---|---|
| PL-07 通用单据关系表 | `solution.md:1215` 要求的 `reversal` / `remaining` / `lineage` 三项属性在所有既有表中均缺失，无可迁移的既有实现 |
| PL-08 通用 `Source → Rule → Target` 转换抽象 | 5 条转换线 100% 域内手写，语义差异需先逐条对齐 |
| PL-06 生命周期通用关系注册表 / 全实体可归档 | 涉及 25 个实体的归档语义逐个确认，且触碰已冻结域 |
| PL-13 期间控制收敛（三闸门归一 + 5 套存储合并） | 触碰已冻结的 Finance Operations / Accounting & Analytics 域的关期语义与断言 |
| 既有 6 族迁移到通用工作流引擎 | `document.md §158`、`:573` 规定既有审批族在 Generic Workflow 完成前保持 canonical；迁移需逐族重签验收 |

**理由**：五个子系统是 Platform 局部新增（新表、新路由、新工作面），不改任何已冻结域的行为；反之，PL-07 / PL-08 / PL-13 的通用化必然改写已冻结域的语义与断言，必须先对受影响域解冻才能开工。范围裁定遵循 AGENTS.md §2.3「文档职责边界」与 §3.2「跨域边界必须读全」。

### 2.2 `PL-DEC-02` —— Organization 主数据所有权移交

**决定**：Organization 主数据（组织注册表、组织层级、作用域登记）的所有权**由 Master & Engineering 正式移交 Platform**。

**同时确认**：

1. Master & Engineering 的 **Multi-Organization 业务数据隔离**（向业务表铺开 `org_id` 并按组织分流业务数据）**仍维持 `OUT_OF_SCOPE`**；所有权移交**不构成**对 M&E 的多组织业务解锁。
2. Master & Engineering Requirement `§28.1` 与 `§28.9` 已同步修订：`§28.9` 第 1 条 Hard Stop 收窄为"多组织**业务数据隔离**需求"，Platform 建立组织主数据**不触发**该条。
3. 两域均不得在未获新的业务所有者裁定前实施多组织业务数据隔离；遵守 `solution.md §20.7` 的加法式逐域迁移原则与「不一次性给所有表机械加字段」。
4. M&E 若需组织主数据的只读查询或解析契约，走 Platform 的 canonical 组织接口，**不得**另建第二套组织模型。

**理由**：审计确认当前**不存在任何组织主数据**（无 `organizations` 表、无 `org_id` 列），`accounting_scopes.org_scope` 是自由文本标签而非 FK，`document.md:126`、`:392` 把 Organization 归属判给「M&E + Platform」但未指定唯一 owner，而 `master-engineering.md:27`、`:194` 把 Multi-Organization 判为 M&E 的 `OUT_OF_SCOPE` 与 Hard Stop —— 三者叠加会让"建组织模型"这一动作无法被任何一方合法执行。裁定唯一 owner 是唯一能解开该死结的方式。

**影响面**：Master & Engineering 已于 2026-11-12 签发 `MASTER_ENGINEERING_DOMAIN_ACCEPTANCE_PASS` 与 `MASTER_ENGINEERING_CAPABILITY_FREEZE`。本次修订**不改变该域任何能力判定**（31 项 ME capability 的覆盖结论与实现均不变），只收窄 §28.9 的 Hard Stop 表述并补充所有权说明；按 AGENTS.md §4.6，该域既有验收记录的当前有效性须在 Platform 域级 Acceptance 轮中复核登记。

### 2.3 `PL-DEC-03` —— 审计 schema 升级纳入本域

**决定**：`audit_logs` 的结构化字段与索引升级**纳入 Platform 域范围**，由 Platform 主导实施，**Finance Operations 为受影响的共同 Owner 域**。

**范围**：

1. 新增列 `business_date`、`request_id`、`before_json` / `after_json`；
2. 新增 `created_at` 索引，并按查询模式补 `entity_type` + `entity_id` 复合索引；
3. `audit()` 的新增参数**必须可选** —— 既有 8 个已冻结域的调用点**不得被强制修改**，缺省时新列写空值；
4. 迁移不得删除或改写任何历史 `audit_logs` 行；
5. `auditBusinessRejection` 必须获得测试覆盖（正例 + 反例），补 `PL-DEF-06`。

**理由**：该项原登记为 `M1-F-12`（`docs/decisions/OPEN-BUSINESS-DECISIONS.md:88`），状态「跨域阻塞」，约束为「Platform / Finance 域独立授权；本轮不修改审计 schema」。审计写入是全部九个域的共用路径，不补结构化字段则审计证据无法承载 before-after 与请求关联。裁定纳入本域即构成 Platform / Finance 的**联合授权**。

**影响面**：该 schema 变更触及全部 8 个已冻结域的审计调用点。按 AGENTS.md §4.6，须在 Platform 域级 Acceptance 轮中逐域复核被引用的门禁、脚本与能力集合是否仍成立，并登记各自的证据有效性类别。

## 3. 未授权事项

本记录**明确不授权**：

- 任何 Implementation（AGENTS.md §4.3 要求 Design 完成后 HARD STOP，Implementation 须业务所有者单独批准）；
- 任何 Acceptance / Capability Freeze 标识的签发；
- 真实环境 migration、业务数据库写入、真实 MySQL Gate 的执行；
- push / merge / tag / 发布 / 部署；
- 多组织业务数据隔离（§2.2 第 1 项）；
- 本记录所列 `OUT_OF_SCOPE` 项的任何实施。

## 4. 规范落地锚点

| 决策 | 规范正文 |
|---|---|
| `PL-DEC-01` | `docs/requirements/platform.md` §36.2（能力枚举与目标 Coverage）、§36.13（`OUT_OF_SCOPE` 清单） |
| `PL-DEC-02` | `docs/requirements/platform.md` §36.5（Organization Scope）；`docs/requirements/master-engineering.md` §28.1、§28.9 |
| `PL-DEC-03` | `docs/requirements/platform.md` §36.9（Audit schema 升级） |
