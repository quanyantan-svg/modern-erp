# 验收与冻结证据

> 状态：`ACTIVE`（证据目录）
> Owner：Platform
> 权威来源：**无** —— 本目录保存验收 / 冻结 / 实施证据，**不是**当前需求、架构或项目状态的权威来源。
> 当前 Requirement：[`docs/requirements/`](../requirements/)；当前 Design：[`docs/design/`](../design/)；
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)

## 目录

| 路径 | 内容 |
|---|---|
| [`g0-governance-acceptance-20261101.md`](./g0-governance-acceptance-20261101.md) | G0 开发治理重构的正式验收记录（`G0_ACCEPTANCE_PASS`，2026-11-01）—— 治理层验收，**不含**任何业务 Domain Acceptance |
| [`m1-core-requirement-design-acceptance-20261102.md`](./m1-core-requirement-design-acceptance-20261102.md) | M1-Core Requirement / Design 正式验收（`M1_CORE_REQUIREMENT_ACCEPTANCE_PASS` / `M1_CORE_DESIGN_PASS`）；Implementation 未授权，非 Domain Acceptance |
| [`m1-core-wp1-implementation-acceptance-20261102.md`](./m1-core-wp1-implementation-acceptance-20261102.md) | M1-Core WP1 Implementation 正式验收（`M1C_WP1_IMPLEMENTATION_PASS`）；不等于 `M1C-G01 PASS`，非 Capability Freeze / Domain Acceptance |
| [`m1-core-wp7a-gate-acceptance-20261103.md`](./m1-core-wp7a-gate-acceptance-20261103.md) | M1-Core WP7-A 首期非破坏性验收**执行记录**（G01–G06 逐 Gate 证据矩阵、G05 缺陷登记、G07 MySQL 执行准备）；**未签发**任何 Gate PASS，非 Domain Acceptance |
| [`sales-customer/`](./sales-customer/) | Sales & Customer 各 Wave 的 Acceptance / Freeze 记录与实施证据 |

## 规则

- 证据文件**引用**合同，不复制合同正文；
- 证据中的历史 PASS **不得**被描述为当前 HEAD 的 PASS；
- 冻结标识、冻结边界、Git 锚点与排除项必须原样保留；
- 新的验收证据不得写入 `document.md` / `solution.md` / `docs/requirements/` / `docs/design/`。
