# Modern ERP 开发与 AI 治理规则

本文件是仓库内唯一权威的 AI 与开发治理政策。CLAUDE.md 等工具入口只能引用本文件，不得维护第二套相互冲突的项目规则。

## 1. 当前项目基线

- 前端：React 19 + Vite 7。
- 后端：Node.js 22.23.2 原生 HTTP API，不使用 Express/Koa。
- 数据库：SQLite 保留本地开发与完整回归兼容路径；MySQL 8 是一等运行后端和目标生产路径。
- 部署：Nginx 反向代理 + systemd 服务，不使用 PM2。
- 当前发布上下文以 Git release tag 为准；当前基线为 v1.6.2。

## 2. 修改应用代码前的必读与检查

**任务分级的阅读要求**。仓库内有数千行 canonical 文档，逐字通读不应对每一个小任务都强制执行；以下分级明确"任务级"与"全局级"的阅读义务。

### 2.1 任务级阅读义务（普通有界任务）

对于单一页面 / 单一功能 / 单一缺陷修复 / 单一脚本改动等"有界任务"，AI 在动手前必须：

1. 阅读 `AGENTS.md`。
2. 阅读 `README.md`。
3. 阅读本次变化相关的 `document.md` 章节（按标题定位，不通读）。
4. 阅读本次变化相关的 `solution.md` 章节（按标题定位，不通读）。
5. **完整阅读本次变化相关的实现调用链**：前端组件 / 路由、API / handler、领域模块 / 服务、数据库 / schema / migration（如相关）、权限 / 业务合同、对应测试。不得因为任务小而跳过调用链。
6. 阅读历史日志仅在确实相关时：例如本次变化涉及某个近期回归、某个近期阶段决策、或正在准备 release；按"release 窗口"或"决策日期"读取 `log/` 对应文件，而不是机械读取最近三个日历日期。
7. 执行并检查：
   - `git status --short`
   - `git branch --show-current`
   - `git rev-parse HEAD`
8. 保留全部既有未提交和未跟踪的用户工作，不得擅自覆盖、移动、删除、暂存或提交。

**任务级文档阅读不等于可以跳过完整调用链阅读。** 文档告诉你"做什么"和"为什么"，调用链告诉你"在哪里做"和"必须不能动什么"；两者都是任务级阅读义务的硬性部分。

### 2.2 全局级阅读义务（架构级 / 跨域 / 治理 / 发布审计）

下列场景必须通读 `document.md` 与 `solution.md` 全文，并在需要时配合 `docs/archive/v1.6/` 中的阶段证据：

- 架构级变更（修改 §1–§18 描述的运行链路、领域模块边界、数据库抽象、事务与锁、库存身份与估值、财务子账、制造 WIP / 成本、测试架构、部署 / 备份 / 恢复等）；
- 跨域变更（同一改动同时影响 O2C / P2P / 制造 / 库存 / 财务 / 决策报表两个或更多领域）；
- 全局 ERP 不变量变更（金额单位、UOM、税、状态机、LOT / SERIAL 语义、IQC / OQC、RBAC、审批族、月结、估值规则、并发策略）；
- 仓库或文档治理变更（修改 `AGENTS.md`、`document.md`、`solution.md`、`README.md`、`docs/README.md` 或 `docs/archive/` 目录结构）；
- 主要 release 审计（V1.6.x、V1.7 等的合规复核、归档整理、阶段总结）。

### 2.3 局部变更与全仓审查

局部变更不要求阅读仓库内每一个源文件；只有全局性变更（§2.2）才要求扩展到全仓审查。

## 3. 需求、设计、实现的顺序

新增功能或行为变化必须按以下顺序进行。

### STAGE 1 — REQUIREMENT

- 只更新 document.md 中与本次变化相关的章节。
- 不重写无关需求。
- 用户要求分阶段确认时，完成需求更新后停止并等待确认。

### STAGE 2 — DESIGN

需求获批后，只更新 solution.md 中相关设计，说明：

- 模块和函数职责；
- 数据流与调用关系；
- 事务边界；
- 权限与职责分离；
- 错误行为；
- 测试策略。

solution.md 不粘贴详细实现源码。

### STAGE 3 — IMPLEMENTATION

需求和设计获批后才可以：

- 修改实现；
- 修改或增加测试；
- 仅在运行要求、设置、结构或入口变化时更新 README；
- 将开发结果追加到当天 log/YYYY-MM-DD.md。

旧规则“新增功能时只修改 document.md”和“新增功能时只修改 solution.md”表示连续阶段，而不是互斥的全局规则。

如果实现先于必需的需求或设计步骤开始，立即停止实现，先修复文档与工作流状态。

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
- 提交信息必须清楚描述变更。
- 提交后报告当前分支和短 commit hash。
- 未经明确批准，禁止 push、tag、deploy。
- 未经明确批准，禁止重写 Git 历史。
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

## 10. 违规与冲突处理

一旦发现请求、现有变更、工具行为或拟执行动作违反本文件，或授权边界与安全影响无法确认，必须立即停止相关动作，保持工作树和外部状态不变，报告已知事实、风险与所需授权，并等待用户决定。不得用“修复”“清理”“顺手处理”扩大任务范围，也不得以工具权限代替用户授权。
