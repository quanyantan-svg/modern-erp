# V1.6 / V1.6.1 / V1.6.2 历史归档

> **HISTORICAL — NOT CURRENT SPECIFICATION**
>
> 本目录保存 V1.6（Mobile Enterprise 全站迁移与一致性验收）、V1.6.1（UAT Fix Pack）、V1.6.2 Phase 1（OQC / 销售出库 UX 与 PR / IQC 对齐、MySQL 销售出库关系查询修复）与 V1.6.2 Phase 2（MySQL stale-connection recovery）的阶段性需求草案、技术设计与实施记录。
>
> 当前 ERP 的业务合同在根目录 [`document.md`](../../document.md)；当前 ERP 的技术架构在根目录 [`solution.md`](../../solution.md)；运行时操作在 [`docs/operations/`](../operations/)；发布记录在 [`docs/releases/`](../releases/)。
>
> **遇到冲突时以根目录 canonical 文档与当前代码为准。** 本目录中的阶段标题、原始措辞、章节编号、阶段冻结日期、阶段 tag 引用（`v1.6.0` / `v1.6.1` 等）保留为该阶段冻结时刻的状态，不做回溯改写。

---

## 子目录

- [`phase-requirements/`](./phase-requirements/) — 从 `document.md` §20–§34 拆分的历史阶段需求（包括 V1.5 流程对齐 UX 计划、V1.6 P0+P1、P2–P8、全站推广、V1.6.1 UAT Fix Pack、V1.6.2 Phase 1、Phase 2）。
- [`phase-designs/`](./phase-designs/) — 从 `solution.md` §19–§35 拆分的历史阶段技术设计（包括 UAT R2 / R4、V1.4-D、V1.5、V1.5 D2.2、V1.6 P0–P8、全站推广、V1.6.1、V1.6.2 Phase 1 / Phase 2）。

## 进入本归档的入口文件

- [`phase-requirements/document.md-§20-§34.md`](./phase-requirements/document.md-§20-§34.md)
- [`phase-designs/solution.md-§19-§35.md`](./phase-designs/solution.md-§19-§35.md)

每个入口文件顶部均有 `HISTORICAL — NOT CURRENT SPECIFICATION` banner 与来源说明。

## 不属于本归档的内容

- V1.2 / V1.3 / V1.4 / V1.5 release notes 与审计记录：保留在 [`docs/archive/v1.2/`](../v1.2/)、[`docs/archive/v1.3/`](../v1.3/)、[`docs/archive/v1.4/`](../v1.4/)、[`docs/archive/v1.5/`](../v1.5/)。
- V1.6 / V1.6.1 / V1.6.2 release notes 与 checklist：保留在 [`docs/releases/`](../releases/)；v1.6.2 release notes 在 release-prep 完成后由用户授权追加。
- V1.6 P8 一致性矩阵与 V1.6 全站推广矩阵：保留在 [`docs/v1.6-p8-consistency-matrix.md`](../../v1.6-p8-consistency-matrix.md) 与 [`docs/v1.6-sitewide-rollout-matrix.md`](../../v1.6-sitewide-rollout-matrix.md)，它们是冻结结果而非阶段草案。
- V1.2 视觉验收截图：保留在 [`docs/archive/v1.2/visual-evidence/`](../v1.2/visual-evidence/)。

## 拆分背景

本次 governance cleanup（与 Git tag `v1.6.2` 对应）将根目录 `document.md` / `solution.md` 收敛为唯一当前业务合同与技术架构，避免 AI 默认开发上下文被历史阶段草案污染。本归档保证 V1.5 / V1.6 / V1.6.1 / V1.6.2 阶段证据可追溯，但不再作为 ERP 必须做什么 / 是如何工作的权威来源。
