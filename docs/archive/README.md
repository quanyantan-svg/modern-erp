# 文档归档

本目录保存历史审计、旧设计、阶段合同、发布验收和研究材料。它们是历史证据，**不是**当前需求、架构或项目状态的权威来源。

当前信息位于：

- [README.md](../../README.md)
- [document.md](../../document.md)
- [solution.md](../../solution.md)
- [docs/status/PROJECT_STATUS.md](../status/PROJECT_STATUS.md)（唯一当前项目级进度登记表）
- [docs/requirements/](../requirements/) 与 [docs/design/](../design/)（各 Domain 当前正文）

归档内容可能与当前实现冲突；其中的命令、配置、路径和运维建议可能已经过期或不安全，使用前必须与当前代码和运维指南复核。任何账号、密码、Token、连接密钥都必须脱敏。

当前工作树的脱敏不代表 Git 历史已经清理。历史中可能仍包含早于现行卫生政策的材料；历史重写和凭据轮换必须单独审批。

目录约定：

- `v0.9/`、`v1.1/`、`v1.2/`、`v1.3/`：有明确版本来源的证据；
- `v1.4/`、`v1.5/`、`v1.6/`：版本发布证据与阶段性 Requirement / Design 抽离件；
- `audits/`：无法可靠归属单一版本的旧审计、规格和计划；
- `old-refactor/`：第一次重构及原 ERP 研究材料；
- `project-status-history.md`：已停止作为当前状态来源的累计历史快照；
- `design/sales-customer/`：G0 迁移中判定为**已被取代**的 Sales 设计修订轮次
  （原 `solution.md` §35.0–§35.17 与 §37.0–§37.51 / §37.53 的设计部分），保留原章节编号与正文；
- `status/`：G0 迁移中判定为**过期**的状态快照（原 `solution.md` §21「当前设计状态」，2026-10-06）；
- `readme-20261031-extracted-sections.md`：G0 从 `README.md` 抽离的、与 `document.md` §6/§8/§9 重复的章节副本。

G0 迁移的逐章节映射（原文件 + 原章节 + 源 SHA → 新文件 + 处置）见
[docs/status/MIGRATION-MAP.md](../status/MIGRATION-MAP.md)；原文字节级证据保留在 Git 历史 `4cb8c47`。

V1.2 归档包括流程完整性审计和 before/after 视觉验收截图。截图是当时发布上下文的历史证据，不是当前 UI 基线，也不是验收脚本的默认生成目录。
