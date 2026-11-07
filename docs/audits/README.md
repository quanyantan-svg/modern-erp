# 审计基线索引

> 状态：`ACTIVE`（审计台账索引）
> Owner：Platform（本索引维护）；各审计基线正文的 Owner 由其文件抬头单独声明
> 权威来源：本目录**不是** Requirement、Design 或项目状态的权威来源。当前 Requirement 见
> [`docs/requirements/`](../requirements/)；当前 Design 见 [`docs/design/`](../design/)；
> **唯一**当前项目级进度登记表见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；
> Capability 层面的正式覆盖状态见 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)。
>
> 本目录登记的是**审计基线**。审计发现**不构成** Capability Verified、Capability Freeze、
> Domain Acceptance、Manual Closure 或 Release Readiness；也不构成任何 Implementation 授权。

## 目录

| 审计基线 | 手册 | Domain | 审计版本 | 审计基准 SHA | 审计状态 | 详细台账 |
|---|---|---|---|---|---|---|
| B3101 / B3121 采购与委外代码审计基线（2026-11-07） | B3101 采购管理、B3121 委外管理 | Procurement & Outsourcing | `v0.1` | `9b9cb09799aa05ccac43d02ac1718083921c6d04` | `PRELIMINARY_STATIC_REVIEW` | [`b3101-b3121-code-audit-baseline-20261107.md`](./b3101-b3121-code-audit-baseline-20261107.md) |

## 登记条目

### B3101 / B3121 采购与委外代码审计基线（2026-11-07）

| 项 | 值 |
|---|---|
| 详细台账 | [`b3101-b3121-code-audit-baseline-20261107.md`](./b3101-b3121-code-audit-baseline-20261107.md) |
| 覆盖手册 | B3101《采购管理操作手册 V1.0》、B3121《委外管理操作手册 V1.0》 |
| 覆盖 Capability | PRC-01..PRC-26、VMI-01..VMI-05、OUT-01..OUT-23（登记于台账 §3） |
| 对应 Domain | Procurement & Outsourcing |
| 审计版本 | `v0.1` |
| 审计基准 SHA | `9b9cb09799aa05ccac43d02ac1718083921c6d04`（`master`，2026-11-07） |
| 审计状态 | `PRELIMINARY_STATIC_REVIEW`（初步静态代码审查） |
| 审计方法 | 远端静态代码审查；**未**运行任何测试套件，**未**连接真实 MySQL |
| Issue 总数 | 17 |
| Issue 状态统计 | `DOCUMENTED` 14；`NEEDS_REVALIDATION` 2；`DEFERRED_NOT_AUTHORIZED` 1 |
| 项目状态登记 | [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §38 |
| 能力矩阵登记 | [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)「B3101 / B3121 审计基线登记」 |
| 本轮性质 | **仅登记审计基线**：未实施任何代码整改，未签发任何 Acceptance / Freeze |

**边界**：

- 台账记录的是基于上述基准 SHA 的**静态代码初审结果**，**不是** Domain Acceptance、Capability Freeze、
  Manual Closure、Release Readiness 或完整验收报告；
- 涉及运行时、数据库约束、并发、真实权限与端到端结果的结论，在对应 Issue 中保持 `NEEDS_REVALIDATION`，
  **不得**写成已通过或已失败的运行时结论；
- 台账 §7 的 Package A～D 只是**建议**，**不是**实施授权；
- M1-Core 首期包级 Acceptance（`M1_CORE_ACCEPTANCE_PASS`，2026-11-07）覆盖范围**仅**其七 Gate，
  **不**覆盖本台账的 Capability 粒度，**也不**授予 Capability Freeze / Domain Acceptance。

## 持续状态更新机制

后续所有 B3101 / B3121 开发任务，都必须以
[`b3101-b3121-code-audit-baseline-20261107.md`](./b3101-b3121-code-audit-baseline-20261107.md)
作为**详细 Issue 台账**。本索引与
[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 只维护摘要与链接，**不复制** Issue 清单。

### 状态迁移链

```text
IDENTIFIED → DOCUMENTED → AUTHORIZED → IMPLEMENTING → CODE_COMPLETE → TESTED → VERIFIED → ACCEPTED
```

允许进入 `BLOCKED` 或 `DEFERRED_NOT_AUTHORIZED`；台账另设 `NEEDS_REVALIDATION`（需在当前 HEAD 或
真实测试环境重新核验）与 `REJECTED`（经裁定不纳入产品范围）。**不得跳过必要状态。**

### 每次处理一个 Issue 的必做项

1. 更新该 Issue 的 `Status`；
2. 记录对应开发 Commit SHA；
3. 记录测试命令、Run ID 和结果；
4. 记录业务不变量及回归验证证据；
5. 更新 `Last Updated` 与 `Change History`；
6. 同步 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 中的项目进展摘要；
7. 在 `log/YYYY-MM-DD.md` 记录本次状态变化；
8. **只有**达到 Capability 级别的正式验证条件时，才更新
   [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)。

这些文件**不会自动同步**；每次开发任务结束时必须显式执行状态同步。

### 不可混用的状态

| 状态 | 不等于 |
|---|---|
| `CODE_COMPLETE` | `TESTED`（代码写完不代表测试通过） |
| `TESTED` | `VERIFIED`（测试通过不代表业务不变量与回归已核验） |
| `VERIFIED` | `ACCEPTED`（已核验不代表已获正式验收） |
| `ACCEPTED` | **只能**由正式责任人签发；实施代理自评**不**构成 Acceptance |

补充纪律：

- 一个 Issue 完成，**不代表**整个 Capability 或 Domain 完成；
- 延期能力（`DEFERRED_NOT_AUTHORIZED`）**不得**自动转为已授权实施；
- 不得把台账中的 `DOCUMENTED` 项目描述成已修复或已验收；
- 发现新问题时**新增** Issue ID，**不覆盖**历史 Issue；修复后保留原始发现、修复 commit、
  测试证据与验收证据。

## 规则

- 本目录新增任何审计文档前，必须先在本索引登记：名称、覆盖手册、Domain、审计版本、审计基准 SHA、
  审计状态与详细台账链接；
- 审计文档抬头必须声明：用途、Owner、状态、权威来源、审计基准 SHA、审计状态；
- 审计基准 SHA 之后 `master` 前进时，必须先比较当前 HEAD 与基准 SHA；**不得**把台账中的行号或代码结论
  未经复核直接套用到新 SHA；
- 不得在本目录登记当前项目状态（那是 `PROJECT_STATUS.md` 的唯一职责），也不得在本目录复制 Issue 清单
  （那是各审计台账正文的唯一职责）。
