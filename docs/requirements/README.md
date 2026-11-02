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
| [`procurement-outsourcing.md`](./procurement-outsourcing.md) | Procurement & Outsourcing | `document.md` §31 | Requirement 完成；Domain Acceptance 仍 `NOT READY`；§31.12 M1 全范围历史 Requirement 已验收（`M1_REQUIREMENT_ACCEPTANCE_PASS`）；§31.13 M1-Core 首期 Requirement 已批准（`M1_CORE_REQUIREMENT_ACCEPTANCE_PASS`，2026-11-02），Implementation 未授权 |
| [`inventory-warehouse.md`](./inventory-warehouse.md) | Inventory & Warehouse | `document.md` §32 | Requirement 完成；实现 Partial；**未见独立 Domain-Level Acceptance** |
| [`finance-operations.md`](./finance-operations.md) | Finance Operations | `document.md` §33 | Requirement 完成；实现完成；**未见独立 Domain-Level Acceptance** |
| [`sales-customer/`](./sales-customer/) | Sales & Customer | `document.md` §34 + Wave 8/9/10/11 修订 | Requirement 完成；部分能力冻结；整域**明确未冻结** |
| — | Accounting & Analytics | — | **尚无 Domain Closure Requirement** |
| — | Platform | — | **尚无 Domain Closure Requirement** |

> 状态列的完整依据见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §35.3。
> 本表是**导航**，不是第二份状态登记表。

## 规则

- 本目录正文与 `document.md` §26–§34 及 Wave 修订节**同源**：G0 迁移只做物理搬迁，正文逐字保留，原章节编号保持不变（因此 `§31.12` 等深引用继续有效）。
- 一个业务合同只能有**一份 Active 正文**。若某节已被取代，必须显式标注 Superseded 并移入 `docs/archive/`。
- 不得在本目录追加执行报告、测试输出、Git 交付记录。
- 新增 Domain Requirement 正文前，先在本表登记来源章节与状态。
