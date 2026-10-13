# Modern ERP 文档恢复与应用说明

> 本文件不是 canonical 项目规范，只用于这次文档事故恢复。恢复完成并确认 Git 历史正确后，可以删除本文件。

## 1. 为什么需要恢复

2026-10-06 曾把下列“建议更新内容”文件直接覆盖到 canonical 文件：

- README.md
- document.md
- solution.md
- AGENTS.md

这些建议文件只包含增量片段，不是完整文档，因此会导致原有技术、业务和治理基线丢失。

本恢复包提供的是**完整可直接替换版本**，不是 patch。

## 2. 恢复包文件

- `README.md`
- `document.md`
- `solution.md`
- `AGENTS.md`
- `APPLY_GUIDE.md`
- `log-2026-10-06-append.md`

其中：

- README：项目入口/运行/目录/架构摘要；
- document：完整业务需求与 22 手册 Capability；
- solution：完整技术设计与 8 Domains 演进方案；
- AGENTS：完整 Vibe Coding / AI 治理；
- log append：追加到当天日志；
- APPLY_GUIDE：本次恢复说明，不是长期规范。

## 3. 不需要覆盖 CLAUDE.md

如果当前 `CLAUDE.md` 仍然是：

- `@AGENTS.md`
- 声明 AGENTS.md 是唯一治理政策；
- 默认不加载 `erp-mobile-taste`；
- 只有明确 UI Design/Mobile UX/Responsive 任务才加载 Skill；

则不需要修改。

## 4. 本地恢复步骤

先备份当前错误文件：

```bash
mkdir -p .tmp/doc-recovery-backup
cp README.md .tmp/doc-recovery-backup/README.md.bad
cp document.md .tmp/doc-recovery-backup/document.md.bad
cp solution.md .tmp/doc-recovery-backup/solution.md.bad
cp AGENTS.md .tmp/doc-recovery-backup/AGENTS.md.bad
```

将恢复包中的四个 canonical 文件覆盖到仓库根目录：

```text
README.md
document.md
solution.md
AGENTS.md
```

`log-2026-10-06-append.md` 的内容只追加到：

```text
log/2026-10-06.md
```

禁止覆盖当天已有日志。

## 5. 检查

```bash
git status --short
git diff -- README.md document.md solution.md AGENTS.md log/2026-10-06.md
git diff --check
```

重点确认：

- README 第一行是 `# Modern ERP`，不是“建议更新内容”；
- document 第一行是完整 canonical business requirement 标题；
- solution 第一行是 `# Modern ERP 当前技术设计与实现`；
- AGENTS 第一行是 `# Modern ERP 开发与 AI 治理规则`；
- 不存在 `README_UPDATE.md / DOCUMENT_UPDATE.md / SOLUTION_UPDATE.md / AGENTS_UPDATE.md` 替代 canonical 文件；
- log 是 append-only。

## 6. 文档一致性检查

应看到：

- 8 Business Domains + Platform；
- 22 Manuals = Requirements/Coverage/Acceptance；
- 191 条 Capability baseline 在 document；
- Project/CRM extension 删除范围；
- Core Scope Cleanup；
- Domain Alignment；
- B3101→B3122 Capability Closure；
- 文档先行；
- Requirement/Design 用户确认；
- 中文 commit；
- 未经批准不 push/tag/deploy；
- Taste Skill 仅明确 UI 设计任务加载。

## 7. Git 提交

文档恢复确认后：

```bash
git add README.md document.md solution.md AGENTS.md log/2026-10-06.md
git commit -m "docs: 恢复并固化ERP完整文档基线"
```

提交后检查：

```bash
git status
git log -1 --oneline
```

然后再按用户授权决定是否：

```bash
git push origin master
```

不要在未确认前自动 push/tag/deploy。

## 8. 恢复后的下一步

不要立即写 ERP 功能。

下一阶段：

```text
CORE SCOPE CLEANUP AUDIT
→ user review
→ REQUIREMENT
→ user approval
→ DESIGN
→ user approval
→ IMPLEMENTATION
→ ACCEPTANCE
```

完成后：

```text
DOMAIN ALIGNMENT
→ B3101...B3122 CAPABILITY CLOSURE
```

## 9. 恢复完成后

`APPLY_GUIDE.md` 可以删除，因为：

- 它不是 README；
- 不是 Requirement；
- 不是 Design；
- 不是治理；
- 不应长期形成第五套规则。

恢复过程记录保留在 `log/YYYY-MM-DD.md` 即可。
