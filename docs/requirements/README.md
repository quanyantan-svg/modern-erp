# Requirement 正文索引

> 状态：`ACTIVE`
> Owner：Platform
> 权威来源：本目录保存各 Domain **当前有效** Requirement 正文；全局合同与导航在 [`document.md`](../../document.md) §0 / §1–§25。
> 验收与冻结证据在 [`docs/acceptance/`](../acceptance/)；被取代或历史版本在 [`docs/archive/`](../archive/)。

## 目录

| 文件 | Domain | 原章节 | 当前状态 |
|---|---|---|---|
| [`core-scope-cleanup.md`](./core-scope-cleanup.md) | Core Scope Cleanup | `document.md` §26 | Requirement 完成；Domain Closure 已实施（无独立 Domain Acceptance token） |
| [`domain-alignment.md`](./domain-alignment.md) | Domain Alignment | `document.md` §27 | Requirement 完成 |
| [`master-engineering.md`](./master-engineering.md) | Master & Engineering | `document.md` §28 | Requirement 完成；实现完成；**未见独立 Domain-Level Acceptance** |
| [`manufacturing-quality.md`](./manufacturing-quality.md) | Manufacturing & Quality | `document.md` §29 | Requirement 完成；实现完成；**未见独立 Domain-Level Acceptance** |
| [`planning.md`](./planning.md) | Planning | `document.md` §30 | Requirement 完成；**有明确用户 Freeze** |
| [`procurement-outsourcing.md`](./procurement-outsourcing.md) | Procurement & Outsourcing | `document.md` §31 | Requirement 完成；Domain Acceptance 仍 `NOT READY`；§31.12 M1 全范围历史 Requirement 已验收（`M1_REQUIREMENT_ACCEPTANCE_PASS`）；§31.13 M1-Core 首期 Requirement 已批准（`M1_CORE_REQUIREMENT_ACCEPTANCE_PASS`，2026-11-02），首期 Implementation 已实施并取得包级 Acceptance（`M1_CORE_ACCEPTANCE_PASS`，2026-11-07）—— **Domain Acceptance、Capability Freeze 仍未签发，不得据此认为整个 Procurement & Outsourcing Domain 已完成** |
| [`inventory-warehouse.md`](./inventory-warehouse.md) | Inventory & Warehouse | `document.md` §32 | Requirement 完成；实现 Partial；**未见独立 Domain-Level Acceptance** |
| [`finance-operations.md`](./finance-operations.md) | Finance Operations | `document.md` §33 | Requirement 完成；实现完成；**未见独立 Domain-Level Acceptance** |
| [`sales-customer/`](./sales-customer/) | Sales & Customer | `document.md` §34 + Wave 8/9/10/11 修订 | Requirement 完成；部分能力冻结；整域**明确未冻结** |
| [`accounting-analytics.md`](./accounting-analytics.md) | Accounting & Analytics | `document.md` §35 | Requirement 完成并获批准（`APPROVED`，2026-11-10）；AA-W1..AA-W7 全部纳入 Domain Closure，AA-31 多币种 `OUT_OF_SCOPE`；**Design 实施与域级 Acceptance 均未开始** |
| — | Platform | — | **尚无 Domain Closure Requirement** |

> 状态列的完整依据见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §35.3；
> M1-Core 首期包级 Acceptance 的当前状态见同表 §37.55，B3101 / B3121 静态代码审计基线见同表 §38
> 与 [`docs/audits/README.md`](../audits/README.md)。
> §31.3 / §31.4 / §31.8 / §31.10 的「54 项能力全部 `COVERED`」验收口径**正在被复核**：
> 见 [`docs/decisions/product-scope-rebaseline-proposal-20261107.md`](../decisions/product-scope-rebaseline-proposal-20261107.md)
> （`PENDING`，待业务所有者批准）与同表 §39。**该复核未获批准前，本目录正文与上述验收口径原样有效。**
> 本表是**导航**，不是第二份状态登记表。

## 规则

- 本目录正文与 `document.md` §26–§34 及 Wave 修订节**同源**：G0 迁移只做物理搬迁，正文逐字保留，原章节编号保持不变（因此 `§31.12` 等深引用继续有效）。
- 一个业务合同只能有**一份 Active 正文**。若某节已被取代，必须显式标注 Superseded 并移入 `docs/archive/`。
- 不得在本目录追加执行报告、测试输出、Git 交付记录。
- 新增 Domain Requirement 正文前，先在本表登记来源章节与状态。
