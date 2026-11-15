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
| [`master-engineering.md`](./master-engineering.md) | Master & Engineering | `solution.md` §23 | 已实施；域级 Acceptance 与 Capability Freeze 已签发（2026-11-12） |
| [`manufacturing-quality.md`](./manufacturing-quality.md) | Manufacturing & Quality | `solution.md` §24 | 已实施；域级 Acceptance 与 Capability Freeze 已签发（2026-11-12）；§24.27 route exposure 与页面自身 API 权限一致性有界增补 Design `PENDING_APPROVAL`（2026-11-15），HARD STOP |
| [`planning.md`](./planning.md) | Planning | `solution.md` §25 | 已实施并冻结（域级 Acceptance 2026-11-12） |
| [`procurement-outsourcing.md`](./procurement-outsourcing.md) | Procurement & Outsourcing | `solution.md` §26 | 原 Domain Design 基线，继续 Active；域级 Acceptance 与 Capability Freeze 已签发（2026-11-11） |
| [`procurement-outsourcing-m1-core.md`](./procurement-outsourcing-m1-core.md) | Procurement & Outsourcing（M1-Core 首期） | §31.13 对应有界后继设计 | `ACTIVE` / `M1_CORE_DESIGN_PASS`；首期 Implementation 已实施，七 Gate 7/7 `PASS` 且包级 Acceptance 已签发（`M1_CORE_ACCEPTANCE_PASS`，2026-11-07）—— **域级 Capability Freeze 与 Domain Acceptance 已于 2026-11-11 签发** |
| [`inventory-warehouse.md`](./inventory-warehouse.md) | Inventory & Warehouse | `solution.md` §27 | 已实施；域级 Acceptance 与 Capability Freeze 已签发（2026-11-13） |
| [`finance-operations.md`](./finance-operations.md) | Finance Operations | `solution.md` §28.0–§28.29 | 已实施；域级 Acceptance 与 Capability Freeze 已签发（2026-11-12） |
| [`sales-customer/`](./sales-customer/) | Sales & Customer | `solution.md` §29 / §30 / Wave 8/9/11 基线 | 既有整域基线已冻结（2026-11-13）；§29.52 `W10-INV-RISK-01` 有界增补 Design `APPROVED`（2026-11-14），Implementation 已授权（仅仓库内代码与测试）；§29.53 route exposure 与页面自身 API 权限一致性有界增补 Design `PENDING_APPROVAL`（2026-11-15），HARD STOP |
| [`accounting-analytics.md`](./accounting-analytics.md) | Accounting & Analytics | `solution.md` §31 | Design 已完成（2026-11-10），覆盖 AA-W1..AA-W7 七个实施包；Implementation 已完成；域级 Acceptance 与 Capability Freeze 已签发（2026-11-12） |
| [`platform.md`](./platform.md) | Platform | `solution.md` §32 | 既有 Design 基线与期间控制修订保持；§32.16 Release Infrastructure 有界增补 Design `APPROVED`（2026-11-14），Implementation 已授权（仅仓库内代码、测试、脚本与模板）；§32.17 Migration 风险工作包 Design `PENDING_APPROVAL`（2026-11-15，含同日技术复核修订五项），HARD STOP |

> 状态列依据见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §35.3；
> M1-Core 首期包级 Acceptance 的当前状态见同表 §37.55，B3101 / B3121 静态代码审计基线见同表 §38
> 与 [`docs/audits/README.md`](../audits/README.md)。
> §26.27 / §26.31 的「Wave A–J 全覆盖」「54-capability trace preserved」验收口径**正在被复核**：
> 见 [`docs/decisions/product-scope-rebaseline-proposal-20261107.md`](../decisions/product-scope-rebaseline-proposal-20261107.md)
> （`PENDING`，待业务所有者批准）与同表 §39。**该复核未获批准前，本目录正文与上述验收口径原样有效。**
> 本表是**导航**，不是第二份状态登记表。

## 规则

- 正文与 `solution.md` §21–§37 **同源**：G0 迁移只做物理搬迁，正文逐字保留，原章节编号保持不变（因此 `§26.33`、`§37.54.48` 等深引用继续有效）。
- **`§26.33`（M1 Integrated Critical Chain Design）不在本目录。** 该候选设计当前位于待审区
  [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)，
  状态 `PENDING_REVIEW`，`Design PASS` **未签发**，**不构成 Active 正文**；
  它没有整体获得批准。M1-Core 首期的已批准有界后继设计独立位于本目录，二者范围不同。
  `§26.33` 的深引用仍然有效，只是目标文件由 `docs/design/procurement-outsourcing.md` 变为该待审文件。
- **历史设计修订不得与 Active 正文并列。** 被取代的修订（`§35.0–§35.17`、`§37.0–§37.53` 的中间轮次）已移入
  [`docs/archive/design/sales-customer/`](../archive/design/sales-customer/)，并由本目录的基线登记指向。
- 不得在本目录追加验收执行流水、测试输出或 Git 交付记录。
- 新增 Domain Design 正文前，先在本表登记来源章节与状态。
