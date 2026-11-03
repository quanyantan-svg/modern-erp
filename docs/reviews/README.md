# 待审候选正文

> 状态：`ACTIVE`（候审目录索引）—— 其中的候选正文**均未获批准**，**不构成 Current Active Contract**
> Owner：各 Domain Owner（提出候选）/ 业务所有者（批准或拒绝）
> 权威来源：**无** —— 本目录**只**保存尚未获得业务所有者批准的候选 Requirement / Design 正文。
> 它**不构成 Current Active Contract**，**不**签发 `Design PASS`，**不**授权 Implementation，
> **不**构成 Domain Acceptance / Freeze / Release Readiness。
> 当前 Requirement：[`docs/requirements/`](../requirements/)；当前 Design：[`docs/design/`](../design/)；
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)

## 目录

| 路径 | Domain | 候选类型 | 状态 | 权威来源 |
|---|---|---|---|
| [`m1/procurement-outsourcing-critical-chain-design.md`](./m1/procurement-outsourcing-critical-chain-design.md) | Procurement & Outsourcing | Design（候选，**M1 全范围**；源 `solution.md §26.33`） | `PENDING_APPROVAL` / `PENDING_REVIEW` | 无 —— 源 `solution.md §26.33` @ `912fd76700ff6f3ad1509eec4c9e2241c1830265` |
| [`m1/procurement-outsourcing-m1-core-design.md`](./m1/procurement-outsourcing-m1-core-design.md) | Procurement & Outsourcing | Active Design Promotion 迁移指针（**不含合同正文**） | `PENDING_REVIEW` | 无 —— 当前唯一 Active Design 位于 `docs/design/procurement-outsourcing-m1-core.md` |
| [`m1/procurement-outsourcing-m1-core-processing-po-design-amendment.md`](./m1/procurement-outsourcing-m1-core-processing-po-design-amendment.md) | Procurement & Outsourcing | M1-Core Design Amendment（加工费 PO 正式可达路径，R1 Promotion 来源快照） | `SUPERSEDED`（候审快照元数据仍保留 `PENDING`） | 2026-11-03 已精确融合至 `docs/design/procurement-outsourcing-m1-core.md`；本文件仅保留审查追溯，不构成第二份 Active Contract |
| [`m1/m1-core-wp7b0-g03-g07-safety-design-amendment.md`](./m1/m1-core-wp7b0-g03-g07-safety-design-amendment.md) | Procurement & Outsourcing / Platform | G03 证据分层、ACK-4 授权/消费状态机、destructive 入口覆盖、CR-01～CR-09 与 M-15 条件依赖的 R1 Design Amendment 候选 | `PENDING_APPROVAL` / `PENDING_REVIEW`，`NOT_AUTHORIZED_FOR_IMPLEMENTATION` | 无；Active Design §13 继续唯一有效，等待 Domain Owner 与 Database Safety Owner 裁定 |

> M1 全范围候选设计继续承担 C / D 组延期部分与历史结论追溯，**没有整体获得 Design PASS**。
> M1-Core 首期有界后继设计已于 2026-11-02 提升为
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)
> （`M1_CORE_DESIGN_PASS`）；旧 13 Gate → 新 7 Gate 的映射见其 §13.2。

## 规则

- 进入本目录的正文必须**逐字保留**其原始章节编号与结构，并写明
  Owner、状态、来源 SHA、来源章节、对应 Requirement；
- 本目录正文**不得**与 `docs/requirements/` 或 `docs/design/` 中的 Active 正文重复；
  重复即视为产生第二份 Active 合同，由 `node scripts/docs/check-doc-consistency.mjs --mode current` 检出；
- 本目录正文**不得**自称 `APPROVED`、不得声明 `Design PASS` 或 Implementation 授权；
- 获得业务所有者批准后，须**单独**执行 **Active Design Promotion**（正文移入 `docs/design/`，
  更新本索引与 `docs/status/PROJECT_STATUS.md`），**不得**在本目录内直接改写为已批准状态；
- 被取代的候审版本移入 [`docs/archive/`](../archive/)，不得与在审版本并列宣称当前权威。

## 与状态登记表的关系

候审对象的就绪 / 阻塞状态登记在
[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 与
[`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md)。
本目录**不**维护第二份状态登记。
