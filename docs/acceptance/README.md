# 验收与冻结证据

> 状态：`ACTIVE`（证据目录）
> Owner：Platform
> 权威来源：**无** —— 本目录保存验收 / 冻结 / 实施证据，**不是**当前需求、架构或项目状态的权威来源。
> 当前 Requirement：[`docs/requirements/`](../requirements/)；当前 Design：[`docs/design/`](../design/)；
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)

## 目录

| 路径 | 内容 |
|---|---|
| [`sales-customer/`](./sales-customer/) | Sales & Customer 各 Wave 的 Acceptance / Freeze 记录与实施证据 |

## 规则

- 证据文件**引用**合同，不复制合同正文；
- 证据中的历史 PASS **不得**被描述为当前 HEAD 的 PASS；
- 冻结标识、冻结边界、Git 锚点与排除项必须原样保留；
- 新的验收证据不得写入 `document.md` / `solution.md` / `docs/requirements/` / `docs/design/`。
