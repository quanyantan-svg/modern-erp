# 决策记录（Decision Records）

> 状态：`ACTIVE`
> Owner：业务所有者（业务政策）/ Platform（治理与架构决策）
> 权威来源：本目录保存**独立重大决策**的登记与结论。决策的规范正文仍在对应的 Requirement 或 Design 中；
> 本目录**不复制**规范正文，只登记：决策 ID、归属、状态、停止点与规范来源锚点。

## 目录

| 文件 | 内容 | 状态 |
|---|---|---|
| [`OPEN-BUSINESS-DECISIONS.md`](./OPEN-BUSINESS-DECISIONS.md) | 尚未裁定的业务政策与设计决策登记 | `ACTIVE` |
| [`m1-core-scope-rebaseline-20261102.md`](./m1-core-scope-rebaseline-20261102.md) | `M1-SRD-01` —— M1 首期范围重定基线决定（SRD-01 / SRD-02 / SRD-03） | `APPROVED`（仅三项范围决定；不含任何 Implementation 授权） |
| [`mysql-evidence-policy-20261112.md`](./mysql-evidence-policy-20261112.md) | `MYSQL-EV-01` —— 域级验收的真实 MySQL 证据**统一口径**：schema / migration 对等由 `test:mysql:accounting-analytics` 的全量 bootstrap 证明，行为等价由 focused 覆盖并**显式登记残余**（本仓库只有三个已批准 ACK-4 campaign 可运行，其余入口被永久阻断） | `APPROVED` |
| [`cross-domain-error-code-policy-20261112.md`](./cross-domain-error-code-policy-20261112.md) | `XDC-01` —— 跨域错误码耦合治理：一个域的内部错误码不是跨域合同；`DECISION` 类耦合必须消除，契约转译必须登记；守卫 `scripts/qa/verify-error-code-coupling.mjs` | `APPROVED` |
| [`product-scope-rebaseline-proposal-20261107.md`](./product-scope-rebaseline-proposal-20261107.md) | B3101 / B3121 **产品范围重定基线建议**与 `SCP-01`～`SCP-15` Scope Change Proposal：54 项能力逐项 `Product Scope` 建议、危险写入路径处置建议、复用约束与交付标准改写建议 | `PENDING` —— **全部是建议**，待业务所有者逐项批准；未批准前已批准 Requirement / Design / Acceptance / 延期政策**全部原样有效** |
| [`platform-domain-closure-decisions-20261113.md`](./platform-domain-closure-decisions-20261113.md) | `PL-DEC-01`～`PL-DEC-03` —— Platform 平台层域闭合范围三项业务裁定：`PL-DEC-01` 建设五个子系统 + SOD 引擎 + 生产订单自审批，PL-07 / PL-08 / PL-06 通用化 / PL-13 收敛显式 `OUT_OF_SCOPE`；`PL-DEC-02` Organization 主数据所有权由 Master & Engineering 移交 Platform（M&E 的多组织业务隔离仍 `OUT_OF_SCOPE`）；`PL-DEC-03` `audit_logs` 结构化字段与索引升级纳入本域，Platform 主导、Finance Operations 为共同 Owner 域 | `APPROVED`（仅范围与政策裁定；**不含任何 Implementation 授权**） |
| [`n7-traceability-ledger-policy-20261113.md`](./n7-traceability-ledger-policy-20261113.md) | `N7-LEDGER-01` —— 变更追溯台账：N7 的「变更记录」增加第二个来源（提交信息 **或** 已登记台账），使四个**已推送**的历史提交保持可追溯而**无需改写已发布历史**；覆盖须 SHA + 文件 + 章节 id 集合完全相等且引用已批准决定；失效条目必须删除 | `APPROVED`（仅治理机制裁定；**不含任何 Implementation、发布或历史重写授权**） |

## 登记规则

- 一条决策**只有一个规范来源**。本目录指向它，不复制它；
- 决策状态只允许：`PENDING`（待裁定）/ `RATIFICATION_PENDING`（待业务所有者追认）/ `APPROVED` / `REJECTED` / `DEFERRED`；
  M1-Core 首期另启用 `APPROVED_SCOPE_DECISION`（已批准的范围决定本身）/
  `CORE_LIMITED_PENDING_OWNER`（首期限定规则已提出、待业务所有者签字）/
  `DESIGN_TECHNICAL_ACCEPTED`（该项裁定权属 Design，已由候选 Design 技术接受；**非**业务政策、无需另行追认）/
  `DEFERRED_PENDING_POLICY`（延期且待政策裁定）—— 以上均**不**等于 Implementation 许可；
- 决策被裁定后，结论写入规范来源，本目录改状态并保留指针；
- 业务政策未裁定前，其下游 Implementation 必须 **fail closed**，不得按假设实现；
- 不得在本目录追加执行报告或测试流水。

## 与状态登记表的关系

[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 是**唯一**当前项目级进度登记表；
本目录只登记「决策是否已裁定」，不登记「哪个 Domain 完成了多少」。
