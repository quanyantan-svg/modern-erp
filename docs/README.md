# 文档目录

当前项目入口与权威文档位于仓库根目录：

- [README.md](../README.md)：项目入口、技术栈、运行/测试/部署、文档导航；
- [document.md](../document.md)：全局业务 Requirement 合同 + 各 Domain Requirement 导航；
- [solution.md](../solution.md)：全局架构与 Design 合同 + 各 Domain Design 导航；
- [AGENTS.md](../AGENTS.md)：唯一权威的开发与 AI/Vibe Coding 治理政策；
- [CLAUDE.md](../CLAUDE.md)：Claude Code 入口，只引用 `AGENTS.md`。

## 本目录结构

| 目录 | 内容 | 是否当前权威 |
|---|---|---|
| [`status/`](./status/) | `PROJECT_STATUS.md`（**唯一**当前项目级进度登记表）、`CAPABILITY_MATRIX.md`（B3101–B3122 能力追溯）、`MIGRATION-MAP.md`（G0 迁移映射） | 是（状态与矩阵），迁移映射是追溯索引 |
| [`requirements/`](./requirements/) | 各 Domain **当前有效** Requirement 正文 | 是 |
| [`design/`](./design/) | 各 Domain **当前有效** Design 正文 | 是 |
| [`decisions/`](./decisions/) | 重大决策登记（开放业务政策 / 设计决策状态） | 是（决策状态），规范正文在 Requirement/Design |
| [`acceptance/`](./acceptance/) | 验收、冻结与实施证据 | 否（证据） |
| [`operations/`](./operations/) | 运维、部署、测试与演示运行手册 | 是（操作规程） |
| [`evidence/`](./evidence/) | 浏览器与响应式验收截图等原始证据 | 否（证据） |
| [`releases/`](./releases/) | 版本发布记录与 checklist | 否（历史发布证据） |
| [`archive/`](./archive/) | 历史审计、旧设计、过期状态快照与 README 抽离章节 | 否（历史证据） |

## 权威性原则

- 每个业务合同**只有一份 Active 正文**；历史版本不得与 Active 版本并列宣称当前权威；
- 状态只登记在 `status/PROJECT_STATUS.md`；README 只链接并简述，不维护第二份状态表；
- `archive/` 中的内容可能与当前实现冲突，其中的命令、配置、路径与运维建议可能已过期或不安全，使用前必须与当前代码和运维指南复核；
- 当前工作树的脱敏不代表 Git 历史已经清理，历史重写与凭据轮换必须单独审批。

发现冲突时，以根目录 canonical 文档、`docs/status/` 与当前代码为准。

## 文档一致性检查（只读）

`scripts/docs/` 提供少量稳定、可复跑的文档校验工具。它们**只读**：仅执行
`git show` / `git ls-tree`，不修改任何文档内容、不访问数据库、不改变
FAST / FULL / HEAVY 测试分组，失败时返回非零退出码。

| 命令 | 用途 |
|---|---|
| `node scripts/docs/check-doc-consistency.mjs` | C1 章节覆盖率、C2 正文逐字保留且唯一、C3 迁移映射表一致性、C4 链接与锚点、C5 历史引用解析、C6 重复 Active 合同 |
| `node scripts/docs/resolve-reference.mjs "solution.md:12607"` | 解析迁移前的历史行号 / 章节路径引用，返回其在新结构中的位置 |

迁移基线固定为 `4cb8c477aa00988bbfebef905764565cdfe62b71`（G0 迁移前的 `master`）。
默认校验目标为当前工作树；加 `--target HEAD` 可校验已提交状态，
加 `--baseline <commit>` 可指定其他基线。

解析规范与逐章节映射见 [`docs/status/MIGRATION-MAP.md`](./status/MIGRATION-MAP.md) §4。
