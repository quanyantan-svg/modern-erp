# M1-Core Requirement / Design Acceptance（2026-11-02）

> 用途：登记 M1-Core 首期 Requirement 与 Design 的业务所有者正式验收，以及 Active Design Promotion 证据。
> Owner：业务所有者（验收决定）/ Platform（证据维护）
> 状态：`ACCEPTED`（文档合同验收；非 Implementation / Domain Acceptance / Freeze）
> 权威来源：Requirement 规范正文为
> [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.13；
> Design 规范正文为
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)。
> 本文件只保存验收证据，不复制规范正文，不构成项目状态登记表。

## 1. 验收决定与 Git 锚点

| 项 | 值 |
|---|---|
| 日期 | 2026-11-02 |
| 批准人 | 业务所有者 |
| Requirement Acceptance ID | `M1_CORE_REQUIREMENT_ACCEPTANCE_PASS` |
| Design Acceptance ID | `M1_CORE_DESIGN_PASS` |
| Requirement 对象 | `docs/requirements/procurement-outsourcing.md` §31.13，`MC-REQ-01..MC-REQ-15` |
| Design 对象 | `docs/design/procurement-outsourcing-m1-core.md` §1–§18 |
| Acceptance / Promotion 锚点 | `95aca4d60b3a168bea2355e12829bb67af18f500`（`docs(erp): 批准M1-Core需求并提升Active Design`） |
| 来源复核 | `M1C-TC1-RV1` 最终技术合同复核 + 本次 RBAC/SoD 独立一致性复核 |
| Implementation | `NOT_AUTHORIZED` |

## 2. Requirement Acceptance 范围

- `SRD-01 / SRD-02 / SRD-03` 保持已批准，范围未扩大。
- §31.13 的 12 条继承不变量与 `MC-REQ-01..MC-REQ-15` 全部保留。
- 多 PO、部分转换、容量分域、直接 PO 入库、委外正式收货、IQC、生效时点、真实库存、WIP、
  跟踪、估值、增量倒冲、成品入库、历史 fail closed、SQLite/MySQL 对等与延期危险写入拒绝合同完整。
- `A-P01` 保持 `DESIGN_TECHNICAL_ACCEPTED`，业务所有者在本次 Requirement Acceptance 中正式确认
  统一通知模型：`receipt_notices` + `receipt_notice_items` + `receipt_notice_item_sources`，
  由 `receipt_notices.business_type` 区分业务；禁止第二套委外完成通知表与第二收货引擎。
- `M1-P-03` 状态更新为 `APPROVED`；`A-P02`、`T-11` 与 `M1-P-02` 的严格限制边界不变。
- §31.12 历史 `M1_REQUIREMENT_ACCEPTANCE_PASS` 保持原样；本 Acceptance 不替代或改写该历史事实。

## 3. Design Acceptance 与最终角色矩阵

M1-Core Design 已从
`docs/reviews/m1/procurement-outsourcing-m1-core-design.md` 通过 `git mv` 提升到
`docs/design/procurement-outsourcing-m1-core.md`；原路径仅保留不含合同正文的 N7/深链接迁移指针。
原 Domain Design §26 继续保留；M1 全范围旧候选继续在
`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md` 承担 C/D 延期与历史追溯，没有整体获批。

| 角色 | 获批动作权限 | 强制边界 |
|---|---|---|
| 委外业务员（建议 `role-outsourcing`） | `OUTSOURCING_MANAGE`、`OUTSOURCING_MATERIAL_EXECUTE` | 不得持有收货、IQC、`SUPPLIER_BILL_MANAGE` |
| 委外收货员（建议 `role-outsourcing-receiving`） | `OUTSOURCING_RECEIVING_MANAGE` | 收货录入与生效唯一动作主体；不得持有业务、材料、IQC 权限 |
| 质检人员（现有 `role-warehouse`） | `IQC_MANAGE` | 不得与收货生效职责合并 |
| 财务人员（现有 `role-accounting`） | `SUPPLIER_BILL_MANAGE`（仅普通采购） | 委外来源正式过账仍由 Policy Guard 拒绝 |
| `admin` | all-permissions | 不得绕过来源级 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED` |

上述角色定义与授予**尚未实施**。`M1C-G02` 后续正向证据必须使用委外收货员，管理员不得替代。

## 4. 明确排除与状态边界

- `M1C-G01..M1C-G07` 全部保持 `NOT_RUN`；旧 M1 全范围 13 Gate 状态不变，未签发任何 Gate PASS。
- 本记录不签发 `IMPLEMENTATION_AUTHORIZED`、`M1_CORE_IMPLEMENTATION_ACCEPTANCE_PASS`、
  `DOMAIN_ACCEPTANCE_PASS`、Capability Freeze、Manual Capability Closure 或 Release Readiness。
- Procurement & Outsourcing Domain 仍为 `PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`。
- 未修改生产代码、schema、migration、权限/角色种子或业务测试；未连接数据库，未运行 MySQL、
  FULL、HEAVY、浏览器或业务 Gate；未 Push、Merge、Tag、Release 或 Deploy。

```text
M1_CORE_REQUIREMENT_ACCEPTED_DESIGN_ACCEPTED_IMPLEMENTATION_NOT_AUTHORIZED
```
