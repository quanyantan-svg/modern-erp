@AGENTS.md

# Claude Code Project Entry

AGENTS.md 是本仓库唯一权威的开发与 AI 治理政策。本文件**不复制**任何治理规则，只提供 Claude Code 的环境入口。

## 会话启动（L0）

按 `AGENTS.md §3` 的四层上下文策略执行。每次新任务读取：

1. `AGENTS.md`（治理政策，本文件已通过 `@AGENTS.md` 引入）；
2. `README.md`（项目入口与当前状态摘要）；
3. `docs/status/PROJECT_STATUS.md`（当前进度、阻塞项、下一步）；
4. 当前 Git 状态。

**不要**默认读取 `document.md`、`solution.md` 全文或全部 `log/`。任务涉及哪个 Domain 或 Capability，再按 `AGENTS.md §3` 的 L1/L2/L3 逐层加载对应正文。

## Claude 特定说明

- 仓库文件与 Git 历史优先于先前对话记忆。
- 工具权限白名单属于本机配置，不扩大任务授权，也不覆盖 AGENTS.md 的安全边界。
- 生产环境、外部服务、push、tag、部署、数据库重置和 Git 历史重写仍需用户明确批准。
- 阶段门禁与 HARD STOP 同样适用于 Claude：Design 完成后不得自动进入 Implementation。
- 交付报告必须包含机器可读状态标识与「未解决矛盾」章节。

## UI Skill 使用规则

项目存在 `.claude/skills/erp-mobile-taste/SKILL.md`，专门用于 ERP Mobile UI / UX 布局设计。

- 默认禁止加载或使用该 Skill。
- 普通前端功能开发、Bug 修复、接口联调、业务逻辑、表单字段修改、样式微调等任务均不得主动加载。
- 只有当用户在本次对话中明确要求 UI 设计、页面布局、视觉优化、Mobile UX、响应式布局重构等设计任务时才允许读取和使用。
- 任务仅涉及 `src/` 目录下的代码并不等于 UI 设计任务；不得因为任务落在前端代码区就自动触发该 Skill。
- 在用户消息中出现"UI 设计 / 页面布局 / 视觉优化 / Mobile UX / 响应式布局"等明确意图，或用户在前文已确认进入设计阶段时，才视为允许触发。

## 文档导航

| 需要找什么 | 去哪里 |
|---|---|
| 全局业务需求合同 | `document.md` |
| 全局技术设计合同 | `solution.md` |
| 某个 Domain 的当前 Requirement | `docs/requirements/` |
| 某个 Domain 的当前 Design | `docs/design/` |
| 当前项目进度 / 阻塞项 / 下一步 | `docs/status/PROJECT_STATUS.md` |
| B3101–B3122 能力覆盖追溯 | `docs/status/CAPABILITY_MATRIX.md` |
| 重大决策记录 | `docs/decisions/` |
| 验收与冻结证据 | `docs/acceptance/` |
| 运维与测试运行手册 | `docs/operations/` |
| 历史材料（非当前权威） | `docs/archive/` |
| 开发历史 | `log/YYYY-MM-DD.md` |
