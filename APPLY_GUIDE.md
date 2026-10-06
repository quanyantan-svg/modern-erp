# Modern ERP 文档基线应用说明（2026-10-06）

本包根据远端 `quanyantan-svg/modern-erp` 当前 `master` 与金蝶 B3101–B3122 全局工作流分析生成。

## 文件

- `README_UPDATE.md`：README 建议新增/替换内容。
- `DOCUMENT_UPDATE.md`：document.md §20 修订与新增 §21。
- `SOLUTION_UPDATE.md`：solution.md 新增 §20。
- `AGENTS_UPDATE.md`：AGENTS.md 的双轴架构、必读规则与 Git 补充。
- `LOG_2026-10-06.md`：新建 `log/2026-10-06.md` 的完整内容。

## 应用原则

这是 documentation-only 变更，不应同时修改 `src/`、`server/`、schema、migration 或测试行为。

推荐由 Claude Code/Codex 在本地仓库执行：

1. 确认 `git status` 干净并同步最新 `master`。
2. 完整读取 README.md、document.md、solution.md、AGENTS.md、CLAUDE.md 与最近三个实际存在日志日期。
3. 按本包内容合并到对应 canonical 文件，保持无关章节不变。
4. 新建 `log/2026-10-06.md`；若该文件届时已存在，只能 append，禁止覆盖。
5. 运行：
   - `git diff --check`
   - 文档一致性静态检查（8 Domains、22 Manuals、非核心 routes、版本语义）
6. 不运行业务测试也可以作为纯文档阶段的最低验证；如果任何测试依赖文档 literal，则按仓库 gate 补跑。
7. 用户 review 文档差异。
8. 只有用户明确批准后，以中文 commit 提交。
9. 未经明确批准不 push/tag/deploy。

## 需要重点避免

- 不把 22 本手册重新变成 22 个 Launcher 一级模块。
- 不删除 Customer Contact 业务语义。
- 不整块删除 `projects-workflow.jsx` / `business.js`。
- 不在 scope cleanup 同时夹带 Credit/Outsourcing/Barcode 等新增功能。
- 不因为目标架构包含多组织/多币种就提前宣称已经支持。
- 不创建第二套 canonical roadmap 文档。
