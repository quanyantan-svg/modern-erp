# 决策记录（Decision Records）

> 状态：`ACTIVE`
> Owner：业务所有者（业务政策）/ Platform（治理与架构决策）
> 权威来源：本目录保存**独立重大决策**的登记与结论。决策的规范正文仍在对应的 Requirement 或 Design 中；
> 本目录**不复制**规范正文，只登记：决策 ID、归属、状态、停止点与规范来源锚点。

## 目录

| 文件 | 内容 | 状态 |
|---|---|---|
| [`OPEN-BUSINESS-DECISIONS.md`](./OPEN-BUSINESS-DECISIONS.md) | 尚未裁定的业务政策与设计决策登记 | `ACTIVE` |

## 登记规则

- 一条决策**只有一个规范来源**。本目录指向它，不复制它；
- 决策状态只允许：`PENDING`（待裁定）/ `RATIFICATION_PENDING`（待业务所有者追认）/ `APPROVED` / `REJECTED` / `DEFERRED`；
- 决策被裁定后，结论写入规范来源，本目录改状态并保留指针；
- 业务政策未裁定前，其下游 Implementation 必须 **fail closed**，不得按假设实现；
- 不得在本目录追加执行报告或测试流水。

## 与状态登记表的关系

[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 是**唯一**当前项目级进度登记表；
本目录只登记「决策是否已裁定」，不登记「哪个 Domain 完成了多少」。
