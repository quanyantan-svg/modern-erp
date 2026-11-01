# G0 开发治理重构 —— 正式验收记录

> 状态：`ACTIVE`（验收证据）
> Owner：Platform
> 权威来源：**无** —— 本文件是 G0 的**验收证据**，不构成任何业务 Domain 的 Acceptance，也不签发任何 Freeze。
> 关联状态登记：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §36.4
> 实施记录：[`log/2026-11-01-g0.md`](../../log/2026-11-01-g0.md)、[`log/2026-11-01-g0-r1.md`](../../log/2026-11-01-g0-r1.md)
> 迁移追溯：[`docs/status/MIGRATION-MAP.md`](../status/MIGRATION-MAP.md)

## 1. 验收结论

| 项 | 值 |
|---|---|
| Acceptance 标识 | **`G0_ACCEPTANCE_PASS`** |
| 批准日期 | 2026-11-01 |
| 批准人 | 业务所有者（在本次治理集成会话中明确签发） |
| 验收锚点 | `1aa753d6e72fdfb37968601d26cfdd422b794948`（`docs(erp): 登记 G0-R1 交付提交锚点`） |
| 验收范围 | G0（开发治理体系重构）+ G0-R1（独立审计问题修复），合计 4 个提交 |
| 验收对象性质 | **治理层（文档与校验工具）工作包**，不是业务能力工作包 |

本记录只登记**已发生的事实**：业务所有者对 G0 治理重构做出验收决定，并签发上表标识。
本记录**不重新执行**任何测试，**不扩大**验收范围，**不替代** `AGENTS.md §4.5` 要求的用户最终 Acceptance 流程
（该流程已在本次会话完成）。

## 2. Git 事实与锚点

| 项 | 值 |
|---|---|
| 验收锚点提交 | `1aa753d6e72fdfb37968601d26cfdd422b794948` |
| 该提交的父链 | `879ada1` → `1f0c7f8` → `8186e81` → `4cb8c47`（`4cb8c47` = G0 迁移前的 `master`） |
| 迁移基线 | `4cb8c477aa00988bbfebef905764565cdfe62b71` |
| G0 主实施提交 | `8186e8165fbec60f60432011a118fa8eb20a76b8`（`docs(erp): 完成 G0 开发治理体系重构`） |
| G0-R1 修复提交 | `879ada1243731c055b0fe3776b2437dd65819ce4`（`docs(erp): 修复 G0 独立审计发现的文档权威与迁移引用问题`） |
| 集成方式 | 本地 `master` 以 `git merge --ff-only` 快进到 `1aa753d`（无三方合并、无 merge commit、无 squash、无 cherry-pick、无 rebase） |
| `1aa753d6` 的处置 | **未被移动、未被删除、未被重建、未被改写**；本验收登记提交位于其之后 |
| `package.json` version | `1.6.2`（未变） |
| Release tag | `v1.6.0` / `v1.6.1` / `v1.6.2`（未变） |

## 3. 验收范围

**在范围内（已验收）**：

1. **G0 治理体系重构** —— 文档体系分层与权威来源唯一化、`AGENTS.md` / `CLAUDE.md` 重构、
   `document.md` / `solution.md` / `README.md` 的逐章节受控迁移、144 条迁移映射登记、
   `docs/requirements/` / `docs/design/` / `docs/status/` / `docs/decisions/` / `docs/acceptance/`
   / `docs/archive/` 目录体系建立、四层上下文策略（`AGENTS.md §3`）、防文档膨胀规则（`AGENTS.md §5`）。
2. **G0-R1 独立审计问题修复** —— P1-1 历史引用无法解析、P1-2 Sales 当前设计优先级表述、
   P1-3 W11-B/C/D 虚假 `NOT_STARTED`、P1-4 错误的深引用声明；P2-1 §35 双目标映射、
   P2-2 元数据头格式、P2-3 一致性检查工具纳入版本管理。
3. **文档一致性检查工具** —— `scripts/docs/check-doc-consistency.mjs`、
   `scripts/docs/lib/migration-index.mjs`、`scripts/docs/resolve-reference.mjs`（纯 Node.js 内置模块）。

**明确不在范围内**：

- 任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机、业务测试断言；
- 任何业务 Domain 的 Acceptance 或 Freeze；
- M1 采购委外 Design 的批准；
- 任何数据库写入、migration 执行、MySQL reset；
- 发布、部署、release tag 变更。

## 4. 独立审计结果

| 项 | 值 |
|---|---|
| 独立审计结论 | **`G0_R1_INDEPENDENT_REVIEW_PASS`** |
| 结论来源 | 业务所有者于 2026-11-01 验收时确认并签发 |
| 未解决 P0 | **0** |
| 未解决 P1 | **0**（G0 独立审计提出的 P1-1…P1-4 全部修复并复核） |
| P2 | **已知、非阻断**；P2-1 / P2-2 / P2-3 已在 G0-R1 修复并复核 |

**证据边界（如实标注）**：独立审计报告**正文不在本仓库内**。仓库内可核验的是修复动作与复核结果
（见 `log/2026-11-01-g0-r1.md` §3、§4、§5.1），该文件 §9 记录的 G0-R1 阶段结束标识为
`G0_R1_READY_FOR_INDEPENDENT_REVIEW`，即**复核结论由仓库外的业务所有者给出**。
本记录据实登记该结论，不伪造仓库内不存在的审计报告文件。

## 5. 工程验证的真实结果

### 5.1 已通过

| 检查 | 结果 |
|---|---|
| 迁移章节覆盖 | PASS —— 基线 188 个 H2 章节（45 保留 + 143 迁移）全部定位 |
| 迁移正文逐字保留且唯一 | PASS —— 143 个已迁移章节正文逐字命中且各出现一次 |
| 迁移映射表一致性 | PASS —— 143 行映射的目标文件、新行范围、内容哈希与实际全部一致 |
| 链接与锚点 | PASS —— 新增失效 0 条（7 条为基线既有历史遗留，位于 `docs/archive/v1.6/`） |
| 历史引用解析 | PASS —— 10 条抽样引用全部可解析 |
| 重复 Active 合同 | PASS —— 分段映射 1 个（§35），无重复正文 |
| `git diff --check` | PASS —— 无空白错误（exit 0） |
| Build | PASS —— `✓ built in 3.42s`（G0 worktree） |

### 5.2 FAST：499/500 与 500/500 的真实区别

**这不是两次不同的代码状态，而是同一次代码在两种目录上下文下的运行结果。**

| 上下文 | 结果 | 差异根因 |
|---|---|---|
| Git worktree 内 | **499 / 500** | 唯一失败为 `server/mobile-shell.test.js` → `example/ folder is in .git/info/exclude` |
| 普通（主）工作区内 | **500 / 500 PASS**（37 suites，0 fail / 0 skipped / 0 todo） | — |

根因：该断言读取 `<repoRoot>/.git/info/exclude`；Git worktree 中 `.git` 是**文件**而非目录，
该路径在 worktree 内结构上不存在，`readFileSync` 抛 ENOENT 使测试失败。
该失败是**目录拓扑造成的环境例外**，不是业务代码缺陷。

**结论成立的前提（已用 Git 核验）**：被测代码与 `master` 逐字节一致——
`git diff --stat master <G0 HEAD> -- src/ server/ scripts/ package.json pnpm-lock.yaml` 为空。

**处置纪律**：G0 与 G0-R1 **均未修改任何业务测试**、未删断言、未降级测试分组、未制造绿色。
本次验收登记同样**不修改**该断言；worktree 上下文中的同一失败按上述事实如实记录。

### 5.3 本轮未运行（不得声称通过）

| 检查 | 状态 |
|---|---|
| `pnpm test`（FULL） | **未运行** —— 不得声称通过 |
| `pnpm test:heavy` | **未运行** —— 不得声称通过 |
| `pnpm test:all` | **未运行** —— 不得声称通过 |
| `pnpm test:mysql` / `test:mysql:concurrency` / `test:mysql:performance` | **未运行** —— 不得声称通过 |
| 任何数据库写操作、migration、reset | **未发生** |
| 浏览器 / 移动端验收 | **未运行** |

### 5.4 快进合入本地 `master` 后的复核（2026-11-01）

本节记录**验收登记当日**在快进后的本地 `master` 工作区
（`D:/Project/VSCode/ERP系统/modern-erp-master-integration`）上重新执行的只读/无库校验，
用于证明被验收的状态在集成后依然成立。**本节不重新执行任何业务验收。**

| 检查 | 命令 | 结果 |
|---|---|---|
| G0 历史迁移证明 | `node scripts/docs/check-doc-consistency.mjs --target 1aa753d6e72fdfb37968601d26cfdd422b794948` | **PASS** —— C1–C6 全绿（6/6），基线 188 个 H2 章节 100% 定位，143 个已迁移章节正文逐字唯一，10 条历史引用全部可解析 |
| 当前工作树文档一致性 | `node scripts/docs/check-doc-consistency.mjs` | **PASS** —— C1–C6 全绿（6/6） |
| Build | `pnpm build` | **PASS** —— `✓ built in 3.25s` |
| FAST | `pnpm test:fast` | **499 / 500**，37 suites，0 skipped，0 todo —— 唯一失败为 `server/mobile-shell.test.js:490` 的 `example/ folder is in .git/info/exclude`（**已复核为 §5.2 所述 worktree 目录拓扑例外**，非业务缺陷） |
| 空白检查 | `git diff --check` | **PASS** —— exit 0 |
| 依赖安装 | `pnpm install --frozen-lockfile` | 83 packages，**无版本漂移**（`pnpm-lock.yaml` 未改动） |

**本轮同样未修改任何业务测试**，未删断言，未降级测试分组；`499 / 500` 的失败被如实保留为失败。

## 6. 本次验收**不**代表什么

1. **不代表任何业务 Domain Acceptance。** G0 是治理层工作包，不关闭任何业务 Gap。
   G-1…G-5、D-2…D-5、M1 的十项集中业务决策、`W11_A_ACCEPTANCE_PASS`、
   Procurement & Outsourcing 的 `NOT READY` 与全部 Release Blockers **全部保持开放**。
2. **不批准 M1 Design。** M1 `solution.md §26.33` 仍为 `PENDING_REVIEW`，
   `Design PASS` 未签发，`Implementation` 未授权，13 个 Gate 全部 `NOT_RUN`。
3. **不代表 ERP Release Ready。** 没有任何 Domain 达到 Release Readiness；
   生产发布仍未获授权。
4. **不签发任何 Freeze。** 本记录不冻结任何 Capability、Manual 或 Domain。
5. **不追溯认可历史测试流水。** §5 的测试结果只在其记录的提交与上下文下成立。

## 7. 未解决矛盾与保留事项

| # | 事项 | 性质 | 状态 |
|---|---|---|---|
| 1 | 独立审计报告正文不在仓库内；`G0_R1_INDEPENDENT_REVIEW_PASS` 由业务所有者在仓库外确认 | 证据边界，已如实标注 | 保留 |
| 2 | FAST 在 worktree 上下文恒为 499/500（`.git/info/exclude` 目录拓扑例外） | 环境例外，非缺陷 | 保留；如需 worktree 内全绿，需业务所有者单独授权修改该断言 |
| 3 | `docs/archive/v1.6/` 内 7 条 G0 之前即存在的失效链接 | 历史遗留 | 保留；不在 G0 范围 |
| 4 | FULL / HEAVY / MySQL / 浏览器验收未在本轮运行 | 验证缺口 | 保留；按 `AGENTS.md §9` 需在对应高风险领域任务中补跑 |
| 5 | `document.md §9` 业务合同裁定、Accounting & Analytics 与 Platform Domain Closure、W11-B/C/D 业务实现 | 业务范围 | 保留，需单独授权 |
| 6 | M1 §26.33 Design 未获批准、未实施、未验收 | 业务范围 | 保留 |

## 8. 后续动作（需单独授权）

本验收登记**不**授权以下任何一项：

- 合并 M1 到 `master`；
- M1 Design 的 Active Promotion（`docs/design/` 生效化）；
- 任何 Implementation / Migration / 数据库操作；
- 推送 `master` 或任何新分支到远端；
- 发布、部署、release tag 变更。
