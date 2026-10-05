# Modern ERP 开发与 AI 治理规则

本文件是仓库内唯一权威的 AI 与开发治理政策。CLAUDE.md 等工具入口只能引用本文件，不得维护第二套相互冲突的项目规则。

## 1. 当前项目基线

- 前端：React 19 + Vite 7。
- 后端：Node.js 22.23.2 原生 HTTP API，不使用 Express/Koa。
- 数据库：SQLite 保留本地开发与完整回归兼容路径；MySQL 8 是一等运行后端和目标生产路径。
- 部署：Nginx 反向代理 + systemd 服务，不使用 PM2。
- 当前发布上下文以 Git release tag 为准；当前基线为 v1.6.2。

## 1.1 当前产品开发主线

- 产品开发主线是 **金蝶 B3101–B3122 模块级功能对标**：以《金蝶云星空标准版操作手册》B3101–B3122 共 22 份手册作为模块级功能对标来源。
- **模块**是顶层进度单位（不是 route 数量 / handler 抽取数量 / Wave 编号 / 页面数量）。
- 默认模块推进顺序为 `B3101 → B3102 → ... → B3122`；只有用户明确调整时才允许改变模块顺序。
- 不得因为某个 Wave 尚未完成或某个工程目标尚未达成而自动推迟、跳过或改变当前模块。
- 不得因为某个 Wave 已完成而自动开始下一个 Wave；Wave 不再是产品 roadmap。
- 历史 Wave（Wave 1 ～ Wave 5B）只作为模块内部工程模式 / 历史迁移记录保留，不构成未来执行顺序。
- 详细规则见 `document.md §20`（金蝶模块级功能对标开发主线）与 `solution.md §19`（金蝶模块级功能对标实施设计与工程约束）。

## 2. 修改应用代码前的必读与检查

仓库内有数千行 canonical 文档和源代码。完整阅读整个仓库对每个小任务都不现实；下面把阅读义务分为"会话基线建立"、"会话内变更感知读取"、"代码阅读范围"和"全局级强制通读"四档。**任务级不要机械重复全文读取，但首次会话基线不得跳过。**

### 2.1 会话基线建立（必须完整阅读）

下列任一情况触发"新会话基线"——AI 必须从头到尾完整阅读以下内容：

- `README.md`
- `document.md`
- `solution.md`
- `AGENTS.md`
- 当前 AI 对应入口规则（Claude Code 读 `CLAUDE.md`，其他工具按其入口）
- `log/` 中按日期倒序最近 3 个**实际存在**开发日志的日期（同日拆分文件须全部读取）

触发条件：

- 新建 AI / Claude Code / Codex 等开发会话；
- 上下文已经丢失或被压缩到无法确认已完整阅读；
- `git checkout` / `pull` / `rebase` / `merge` 后项目基线发生变化；
- 切换分支；
- 进行重大跨模块、架构、数据库、库存、财务等高影响修改。

### 2.2 会话内的变更感知读取

同一连续会话内，只要会话基线已建立并且 `README.md` / `document.md` / `solution.md` 自基线建立后未发生变化：

- 不需要再次全文读取核心文档；
- 开始新任务时只读取本次需求对应的章节；
- 阅读"今天"新增的 `log/YYYY-MM-DD.md` 内容（即基线建立后追加的部分）；
- 完整阅读本次修改直接涉及的代码，以及理解调用关系所必需的上下游代码（见 §2.3）。

核心文档发生修改时：

- 必须重新读取修改后的相关章节；
- 如果修改改变了整体架构、全局规则或跨模块约束，则重新完整阅读对应文档。

不要因为"小任务"跳过第一次会话基线，也不要在同一会话内机械重复读取没有变化的全文。

### 2.3 代码阅读范围

不要要求每次修改前阅读整个仓库所有源码。修改前必须：

- 完整阅读本次修改直接涉及的文件；
- 阅读理解其依赖、调用链、数据流和影响范围所必需的上下游代码；
- 重大跨模块重构或架构变更时才扩大到对应领域的完整代码范围（与 §2.4 一致）。

### 2.4 全局级阅读义务（架构级 / 跨域 / 治理 / 发布审计）

下列场景必须通读 `document.md` 与 `solution.md` 全文，并在需要时配合 `docs/archive/v1.6/` 中的阶段证据：

- 架构级变更（修改 §1–§18 描述的运行链路、领域模块边界、数据库抽象、事务与锁、库存身份与估值、财务子账、制造 WIP / 成本、测试架构、部署 / 备份 / 恢复等）；
- 跨域变更（同一改动同时影响 O2C / P2P / 制造 / 库存 / 财务 / 决策报表两个或更多领域）；
- 全局 ERP 不变量变更（金额单位、UOM、税、状态机、LOT / SERIAL 语义、IQC / OQC、RBAC、审批族、月结、估值规则、并发策略）；
- 仓库或文档治理变更（修改 `AGENTS.md`、`document.md`、`solution.md`、`README.md`、`docs/README.md` 或 `docs/archive/` 目录结构）；
- 主要 release 审计（V1.6.x、V1.7 等的合规复核、归档整理、阶段总结）。

全局级变更还需把代码阅读范围扩展到对应领域的完整代码区；只有真正的 release audit / 全仓治理才要求通读所有源码。局部变更不要求阅读仓库内每一个源文件。

**任务级文档阅读不等于可以跳过完整调用链阅读。** 文档告诉你"做什么"和"为什么"，调用链告诉你"在哪里做"和"必须不能动什么"；两者都是任务级阅读义务的硬性部分。

## 3. 模块开发与实现授权顺序

新增功能、行为变化或金蝶模块对标任务必须按以下顺序进行。每个阶段完成后必须停止，等待用户对当前阶段成果的明确确认，再进入下一阶段；不要把"暂停等确认"当成可选。

固定顺序：

`MODULE AUDIT → COVERAGE/GAP → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE/FREEZE`

### MODULE AUDIT / COVERAGE

- 对照对应金蝶操作手册（参见 §1.1 与 `document.md §20.2` 的 22 模块清单）提取该模块的业务功能；
- 检查真实仓库实现（前端、后端、数据库、测试、audit、RBAC、SOD、transaction、mobile surface、cross-module impact）；
- 形成 Coverage Matrix（参见 `document.md §20.4`），逐项给出 `COVERED` / `PARTIAL` / `MISSING` / `SEMANTIC_MISMATCH` / `OUT_OF_SCOPE`；
- Implementation Agent 不得把"看见类似页面 / 同名 API"自行判断为 `COVERED`；必须就业务语义、控制机制与状态机逐项核对。
- 完成后停止，等待用户对审计结果的明确确认。

### GAP

- 明确 `COVERED` / `PARTIAL` / `MISSING` / `SEMANTIC_MISMATCH` / `OUT_OF_SCOPE` 五种状态；
- 只有 `PARTIAL` / `MISSING` / `SEMANTIC_MISMATCH` 三类项目经过用户确认后才进入 REQUIREMENT；
- `COVERED` 默认保持不动；`OUT_OF_SCOPE` 不实现，不通过 UI / 文档 / 日志暗示已经支持。

### REQUIREMENT

- 只更新 `document.md` 中与本次变化相关的章节；
- 不重写无关需求；
- 不粘贴详细实现源码；
- 完成后停止，等待用户对需求文档的明确确认，再进入 DESIGN。

### DESIGN

需求获批后，只更新 `solution.md` 中相关设计，说明：

- 模块和函数职责；
- 数据流与调用关系；
- 事务边界；
- 权限与职责分离；
- 错误行为；
- 测试策略；
- 与金蝶 Coverage Matrix 的对应关系；
- 受 §6 测试 gate 阶梯约束的 gate 推导。

- 不粘贴详细实现源码；
- 完成后停止，等待用户对设计文档的明确确认，再进入 IMPLEMENTATION。

### IMPLEMENTATION

需求和设计获批后才可以：

- 修改实现；
- 修改或增加测试；
- 仅在运行要求、设置、结构或入口变化时更新 README；
- 将开发结果追加到当天 `log/YYYY-MM-DD.md`。

Implementation Agent 的职责范围（关键边界）：

- 当用户已经提供或批准完整 Requirement / Design / Implementation Brief 时，Implementation Agent 的职责只是按照该批准内容实施；**不需要重新发明需求或设计**。
- 如果批准的 implementation brief 同时要求把已经确认的 Requirement / Design 机械写入 `document.md` / `solution.md`，可以在同一 implementation task 中按提供内容更新这些文档，不需要重新发明需求或设计。
- 但是：不得扩大需求；不得改变设计；不得新增未经批准的功能。
- 实现过程中发现新 Gap / 新 schema 需求 / 跨模块冲突 / 新业务规则 / 手册解释冲突时，停止该新增部分，先报告给用户；不得直接修改。
- 不得以"顺手优化"为理由扩大实现范围。
- 不得为了完成架构目标（拆 `app.js`、拆 `extended.js`、完成 Wave 编号等）夹带业务变更。

旧规则"新增功能时只修改 document.md"和"新增功能时只修改 solution.md"表示连续阶段，而不是互斥的全局规则。

### ACCEPTANCE / FREEZE

- Module Acceptance 必须基于真实远端代码、Coverage Matrix、Requirement、Design、测试证据；
- Implementation Agent 的自我报告（包括 "PASS"、"迁移完成"、"重构结束" 等说法）不能作为最终 Module Acceptance 的依据；
- 只有用户明确确认 `Module Acceptance = PASS` 后，`MODULE FREEZE` 才成立；
- `MODULE FREEZE` 之后才能进入下一个金蝶模块；
- `MODULE FREEZE` 之后的模块内部若发现新 Gap、新设计变更或新业务需求，按本节重新走 `MODULE AUDIT → COVERAGE → REQUIREMENT → DESIGN → ACCEPTANCE/FREEZE`。

### 流程违规处理

如果实现先于必需的需求或设计步骤开始，立即停止实现，先修复文档与工作流状态；如果 Implementation Agent 自行决定扩大需求 / 改变设计 / 新增未经批准的功能，立即停止该新增部分，恢复到上一阶段并报告。

## 4. Canonical 文档职责

- README.md：项目入口、实际技术栈、运行/构建/测试命令、主要目录和当前发布状态；不得扩张成完整业务规范。
- document.md：唯一当前功能和业务需求来源。
- solution.md：唯一当前技术设计和实现参考。
- docs/：运维资料、专项参考和历史/发布证据，不得形成第二套当前规格。

README 必须在以下内容变化时更新：项目结构、运行时要求、安装或启动命令、数据库后端使用方式、主要入口、构建/测试命令或当前发布状态。

## 5. 日志规则

- 使用 log/YYYY-MM-DD.md。
- 只追加，不重写或删除历史记录。
- 从现在起每个日历日只使用一个文件。
- 同日拆分的遗留文件保持原样；读取该日期时必须全部读取。
- 不补造缺失的历史日期。
- 首次建立会话基线时按日期倒序读取最近 3 个**实际存在**开发日志的日期；同一天有多个日志文件则全部读取。
- 同一连续会话内只需要继续读取新追加的日志内容，不需要重复读取已建立基线的历史日志。

## 6. 代码与测试规则

- 使用清晰、可扩展的结构，并按获批设计实现。
- 所有失败必须显式处理；禁止静默忽略错误。
- 禁止遗留未完成的 TODO 占位实现。
- 除非需求明确改变合同，否则保持兼容性。
- 功能或缺陷行为变化必须增加回归测试。
- 先运行 focused tests，再运行完整回归和构建。
- 不得削弱、删除或绕过测试来制造通过结果。
- 金额在 API/数据库边界使用安全整数分；所有外部输入由后端验证。
- 关键状态转换、库存、结算和会计操作必须保留事务、权限和审计合同。
- 测试套件分层由 `scripts/testing/test-suites.js` 集中声明并由 `validate()` 做不变量校验。集合语义固定为 `FAST ⊆ FULL`、`FULL ∩ HEAVY = ∅`、`ALL = FULL ∪ HEAVY`。新增或调整 `*.test.js` 必须落到 FAST / FULL / HEAVY 中的一个，不能静默未分类。

### 6.1 测试 gate 阶梯（按任务类型）

不同任务必须使用不同的最小完成 gate。任何 release candidate、跨域或 release-related
变更不得降级为 `pnpm test:fast`；`test:fast` 是日常快速 feedback，不是 release certification。

| 任务类型 | 必跑 gate | 备注 |
|---|---|---|
| 日常有界任务（单域 / 单页面 / 小型 bugfix / 低风险重构 / 非跨域） | `pnpm test:fast` + `pnpm build` + `git diff --check` | focused node `--test` 仍按需运行 |
| 跨域 / 架构 / canonical metadata（application registry、permissions、shared accounting/inventory contracts、cross-domain workflow、大型重构、release candidate） | `pnpm test` + `pnpm build` + `git diff --check` | FULL 包含 FAST 的全部内容 |
| Heavy 相关变更（backup / restore、production bootstrap、deployment、systemd、nginx、legacy migration、MySQL adapter、concurrency、performance、filesystem destructive safety） | `pnpm test` + `pnpm test:heavy` + 受影响 MySQL gate + `pnpm build` + `git diff --check` | MySQL gate 仅在具备受保护 disposable MySQL 环境时运行 |

新增低成本的 runner 选项：

- `pnpm test:list` —— `pnpm test` 的 `--list`，不执行测试，输出 suite 文件清单。
- `node scripts/testing/run-tests.js <suite> --list` —— 同上对任意 suite。
- `node scripts/testing/run-tests.js <suite> --filter <substring>` —— targeted smoke，仅匹配 basename 的文件。

`pnpm test:all` 用于 release candidate / 数据库 migration release / 生产认证，
集合语义为 `FULL ∪ HEAVY`；`test:fast` 不会被重复执行。

### 6.2 标准完成检查

有界任务（默认）：

    pnpm test:fast
    pnpm build
    git diff --check

跨域 / 架构 / release-candidate：

    pnpm test
    pnpm build
    git diff --check

heavy 相关：在 6.1 表格的对应行追加 `pnpm test:heavy` 与受影响 MySQL gate。

仅在具有受保护 disposable MySQL 环境时运行 MySQL reset/gate；不得把未知或生产数据库用于测试。

## 7. Git 规则

- 必须使用本地 Git 追踪变更。
- 不自动使用 git add .；只暂存本逻辑单元的精确文件。
- 只有任务已授权提交时，才在完成逻辑单元后提交。
- 提交信息必须使用中文，清楚描述变更目的、范围和影响；不得提交无描述或纯英文模板。
- 提交后报告当前分支、短 commit hash 与相关 package / release 版本号（如已变更）。
- 未经用户明确批准，禁止 push、tag、merge、deploy 与发布版本。
- 未经用户明确批准，禁止重写 Git 历史。
- 不得移动、重建或删除既有 release tag。

## 8. 数据库与安全规则

- SQLite 是受支持的本地/测试兼容后端；MySQL 8 是一等运行后端。
- 生产或破坏性数据库操作必须取得明确批准。
- disposable MySQL 测试必须满足现有环境变量、测试库命名和 reset opt-in 防护。
- 不得输出、记录或保存 ERP_DB_PASSWORD。
- 文档、日志、fixture、命令示例和提交中不得出现真实密钥、密码或令牌。
- 备份、恢复、全量重置、迁移和历史重写均视为高风险独立操作。

## 9. 目录与实现约定

- 前端业务页面位于 src/pages/，共享组件位于 src/components/。
- 后端核心入口为 server/index.js、server/app.js 和 server/db.js；领域逻辑逐步位于 server/modules/，数据库适配位于 server/database/，迁移位于 server/migrations/。
- 不得假设尚不存在的 server/routes/、Express 中间件或 PM2 配置已经实现。
- 不为目录美观而移动代码；涉及路径变更时同步检查 import、package scripts、测试、部署配置和文档引用。

### 9.1 `.claude/` 项目级配置治理

项目级 `.claude/` 配置纳入版本控制：

- **应提交**：项目级共享 Claude 设置（如未来新增的非 `settings.local.*` 配置）与项目级 Skill（当前为 `.claude/skills/erp-mobile-taste/SKILL.md`）。
- **必须忽略**：本机私有 settings、缓存、临时状态、凭据、Token 等；具体规则见 `.gitignore`。
- **`erp-mobile-taste` Skill 默认不加载**，只有用户明确要求 UI 设计、布局、视觉优化、Mobile UX 或响应式设计时才加载（详见 `CLAUDE.md` 的 UI Skill 使用规则）。
- 项目级 Skill 由项目维护者评估后再提交，禁止随变更自动 `git add` 整个 `.claude/` 目录。

## 10. 违规与冲突处理

一旦发现请求、现有变更、工具行为或拟执行动作违反本文件，或授权边界与安全影响无法确认，必须立即停止相关动作，保持工作树和外部状态不变，报告已知事实、风险与所需授权，并等待用户决定。不得用“修复”“清理”“顺手处理”扩大任务范围，也不得以工具权限代替用户授权。
