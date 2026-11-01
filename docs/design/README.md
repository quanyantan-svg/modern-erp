# Design 正文索引

> 状态：`ACTIVE`
> Owner：Platform
> 权威来源：本目录保存各 Domain **当前有效** Design 正文；全局架构合同与导航在 [`solution.md`](../../solution.md) §0 / §1–§20。
> 验收与冻结证据在 [`docs/acceptance/`](../acceptance/)；被取代的历史设计修订在 [`docs/archive/design/`](../archive/design/)。

## 目录

| 文件 | Domain | 原章节 | 当前状态 |
|---|---|---|---|
| [`core-scope-cleanup.md`](./core-scope-cleanup.md) | Core Scope Cleanup | `solution.md` §21 | 已实施 |
| [`domain-alignment.md`](./domain-alignment.md) | Domain Alignment | `solution.md` §22 | 已实施 |
| [`master-engineering.md`](./master-engineering.md) | Master & Engineering | `solution.md` §23 | 已实施 |
| [`manufacturing-quality.md`](./manufacturing-quality.md) | Manufacturing & Quality | `solution.md` §24 | 已实施 |
| [`planning.md`](./planning.md) | Planning | `solution.md` §25 | 已实施并冻结 |
| [`procurement-outsourcing.md`](./procurement-outsourcing.md) | Procurement & Outsourcing | `solution.md` §26 | 设计正文；**M1 §26.33 设计仍在独立分支待复核，未合并到 `master`** |
| [`inventory-warehouse.md`](./inventory-warehouse.md) | Inventory & Warehouse | `solution.md` §27 | 已实施 |
| [`finance-operations.md`](./finance-operations.md) | Finance Operations | `solution.md` §28.0–§28.29 | 已实施 |
| [`sales-customer/`](./sales-customer/) | Sales & Customer | `solution.md` §29 / §30 / Wave 8/9/11 基线 | 已实施；分波次冻结基线 |
| — | Accounting & Analytics | — | **尚无 Domain Technical Design** |
| — | Platform | — | **尚无 Domain Technical Design** |

> 状态列依据见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §35.3。
> 本表是**导航**，不是第二份状态登记表。

## 规则

- 正文与 `solution.md` §21–§37 **同源**：G0 迁移只做物理搬迁，正文逐字保留，原章节编号保持不变（因此 `§26.33`、`§37.54.48` 等深引用继续有效）。
- **历史设计修订不得与 Active 正文并列。** 被取代的修订（`§35.0–§35.17`、`§37.0–§37.53` 的中间轮次）已移入
  [`docs/archive/design/sales-customer/`](../archive/design/sales-customer/)，并由本目录的基线登记指向。
- 不得在本目录追加验收执行流水、测试输出或 Git 交付记录。
- 新增 Domain Design 正文前，先在本表登记来源章节与状态。
