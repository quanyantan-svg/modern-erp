# Modern ERP 开发与 AI 治理规则

本文件是仓库内**唯一权威的开发与 AI/Vibe Coding 治理政策**。
`CLAUDE.md`、Skill、工具配置或历史日志只能引用本文件，不得维护第二套相互冲突的开发规则。

如果任何工具行为、提示词、历史文档或 AI 自身习惯与本文件冲突，以本文件为准；如冲突涉及用户明确授权，则停止并向用户报告。

---

## 1. 项目基线

- 前端：React 19 + Vite 7；
- 后端：Node.js 22.23.2 原生 HTTP API，不使用 Express/Koa；
- 数据库：SQLite 本地/测试兼容路径 + MySQL 8 一等运行后端；
- 部署：Nginx + systemd；
- 包管理：pnpm；
- 当前已发布基线：`v1.6.2`；
- `master` 是持续开发分支，可以领先 release tag；
- Git release tag 是发布身份权威，不得移动、删除或重建既有 tag。

### 1.1 产品架构与需求双轴

最终产品架构固定为：

1. Master & Engineering
2. Sales & Customer
3. Planning
4. Procurement & Outsourcing
5. Manufacturing & Quality
6. Inventory & Warehouse
7. Finance Operations
8. Accounting & Analytics
9. Platform

《金蝶云星空标准版操作手册》B3101–B3122 共 22 份手册是：

**Requirements / Coverage / Acceptance 来源**

而不是最终一级菜单或代码目录。

固定追溯链：

`Manual → Capability → Target Domain → Current Implementation → Coverage → Gap → Requirement → Design → Implementation → Acceptance`

`document.md §22` 已固化 22 本手册的 Capability 基线。Claude/Codex 即使无法直接读取原始 Word 手册，也必须以该基线开展审计；不得自行凭常识替换手册要求。

当前总体推进顺序：

`DOCUMENT BASELINE → CORE SCOPE CLEANUP → DOMAIN ALIGNMENT → B3101...B3122 CAPABILITY CLOSURE`

历史 Wave / Stage / V1.6 路线只作为工程历史与可复用模式，不再决定产品 roadmap。

---

## 2. 文档体系与权威来源

### 2.1 文档职责边界

每份文档只承担一种职责。**超出职责的内容不得写入该文档**。

| 文档 | 唯一职责 | 明确禁止写入 |
|---|---|---|
| `README.md` | 项目定位、技术栈、基本架构、启动/测试/部署入口、当前状态摘要、文档导航 | 完整执行报告、历史测试流水、阶段修订过程、第二份状态登记表 |
| `document.md` | 全局业务 Requirement 合同 + 各 Domain Requirement 的权威导航 | 实施报告、测试输出、技术勘误、Git 交付记录 |
| `solution.md` | 全局架构与 Design 合同 + 各 Domain Design 的权威导航 | 历史 Design Amendment 堆叠、验收执行流水 |
| `docs/requirements/` | 各 Domain **当前有效** Requirement 正文 | Acceptance 记录、实施日志 |
| `docs/design/` | 各 Domain **当前有效** Design 正文 | 被取代的历史勘误正文、验收流水 |
| `docs/reviews/` | 待业务所有者审阅的**候选** Requirement / Design 正文（`PENDING_APPROVAL` / `PENDING_REVIEW`） | **不构成 Current Active Contract**；与 Active 正文并列宣称当前权威；冒充已批准状态 |
| `docs/status/PROJECT_STATUS.md` | **唯一**当前项目级进度登记表 | 第二份覆盖、把历史 PASS 描述为当前 HEAD PASS |
| `docs/status/CAPABILITY_MATRIX.md` | B3101–B3122 可追溯能力覆盖矩阵 | 凭代码文件存在就宣称 `COVERED` |
| `docs/decisions/` | 独立重大决策记录（ADR） | 与 Requirement/Design 重复的正文 |
| `docs/acceptance/` | 验收与冻结证据 | 当前状态登记 |
| `docs/operations/` | 运维与测试运行手册 | 需求与设计正文 |
| `docs/archive/` | 历史版本与不再生效的材料 | 任何"当前权威"声明 |
| `log/YYYY-MM-DD.md` | 当天开发与沟通记录（append-only） | 大体量原始证据全文 |

大体量原始证据（测试控制台输出、迁移日志、原始审计附件）另存独立归档文件，由日志**引用**，不复制全文。

### 2.2 文档生命周期状态

每项 Requirement / Design 必须能判断其状态：

| 状态 | 含义 |
|---|---|
| `DRAFT` | 起草中，未提交审阅 |
| `PENDING_APPROVAL` | 已提交，等待业务所有者决定 |
| `APPROVED` | 已获批准，尚未实施 |
| `IMPLEMENTED` | 已按批准合同实施，但尚未验收 |
| `ACCEPTED` | 已通过验收 |
| `FROZEN` | 已冻结为基线，变更须走显式解冻 |
| `SUPERSEDED` | 已被更新版本取代，保留历史结论 |
| `ARCHIVED` | 不再生效，保留可追溯性 |

- 状态必须根据实际业务语义使用，**不得机械地把所有文档推到 `FROZEN`**；
- 一个当前业务合同**只能有一个权威正文**；
- 历史版本可以保留，但不得与 Active 版本同时宣称自己是当前权威；
- 不得丢失历史批准人、日期、原始 Commit SHA、测试证据和影响范围。

### 2.3 新增文档规则

新增任何文档前必须声明：

1. **用途** —— 它解决什么问题；
2. **Owner** —— 谁负责维护和废弃它；
3. **状态** —— §2.2 生命周期状态之一；
4. **权威来源** —— 它与 `document.md` / `solution.md` / 状态登记表的关系。

没有明确 Owner 的文档不得成为权威来源。

### 2.4 状态登记唯一性

- 全仓库只有 `docs/status/PROJECT_STATUS.md` 是当前项目级进度登记表；
- `README.md` 只能**链接和简述**该登记表，不得形成第二份独立状态登记；
- 任何"当前状态"陈述必须能定位到该表中的一行。

### 2.5 章节 ID 与重编号

- 冻结合同 ID 不得未经映射随意重编号；
- 文档迁移必须保留原编号，并建立显式映射：
  `Original File + Original Section + Source SHA → New File + New Section / Archive Reference`；
- 深引用（如 `§31.12`、`§37.54.48`）是有效合同锚点，迁移后必须仍然可定位。

---

## 3. 上下文读取策略（四层）

**废除"每次新任务无差别把全部历史文档加载进当前上下文"的做法。**
按任务需要逐层加载，不得越级批量读取。禁止用聊天记忆代替仓库文件和 Git 证据。

### L0 — 项目全局入口（每个新任务必读）

- `AGENTS.md`（本文件）；
- `README.md`（项目入口与当前状态摘要）；
- `docs/status/PROJECT_STATUS.md`（当前进度、阻塞项、下一步）；
- 当前 Git 状态（`git status --short --branch`、`git log -5 --oneline`）。

### L1 — 任务相关业务合同

按任务涉及的 Domain 与 Capability 读取：

- 对应 Requirement（`document.md` 导航 → `docs/requirements/<domain>.md`）；
- 对应 Design（`solution.md` 导航 → `docs/design/<domain>.md`）；
- 对应决策记录（`docs/decisions/`）；
- 对应验收 / 冻结状态（`docs/acceptance/`、`PROJECT_STATUS.md`）。

### L2 — 代码与依赖上下文

修改代码前必须完整阅读：

- 本次直接修改的全部文件；
- 目标函数完整定义；
- 所有直接调用方；
- 目标函数调用的关键下游；
- 相关 schema / migration；
- 相关 permission / state / transaction / audit 逻辑；
- 相关 tests；
- 相关 frontend route / surface；
- 受影响的跨域边界。

跨域、架构、库存、财务、会计、数据库、migration 任务，阅读范围必须扩大到受影响领域的完整代码区域。

不得根据文件名或局部 grep 就假设业务关系已经理解。

不得修改与本次功能无关的代码。

### L3 — 历史证据（仅在必要时加载）

只有在出现以下情况时才读取历史：

- 当前合同存在冲突，需要确认哪一版权威；
- 需要确认此前批准的业务政策；
- 需要追踪冻结 SHA；
- 需要理解历史迁移或兼容性；
- 需要调查 Regression；
- 当前状态索引明确指出历史依赖。

历史证据来源优先级：`docs/archive/` 与 `docs/acceptance/` → Git 历史 → `log/`。

### 3.1 上下文纪律

- 不得把五万行级文档全文复制进会话；
- 不得为了"确认一下"而批量读取多个 Domain 的完整正文；
- 审计大文档时使用分片、结构化索引和脚本解析，结论以索引 + 定点原文核验为准；
- 同一连续任务内，canonical 文档未变化时不必每改一个文件重读全部文档。

---

## 4. 开发阶段控制

固定顺序：

`AUDIT → COVERAGE/GAP → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE/FREEZE`

各阶段是**不同的治理阶段**。证据范围、文件修改边界和验收标准不得合并，也不得互相替代。

### 4.0 连续阶段授权（Consecutive Stage Authorization）

当用户在同一次指令中**一次性明确授权多个连续阶段**时（例如同时授权 Requirement 与 Design），可以在一次工作会话内连续执行这些阶段，不要求每个阶段结束后都暂停对话等待再次确认。

连续执行时必须满足：

- 每个阶段分别记录：授权来源、范围、输入依据、实际修改的文件、结论、未解决问题、下一阶段边界；
- 各阶段证据独立留存，不得合并为单一"已完成"声明；
- Requirement 阶段仍然**只修改 Requirement 正文**并追加当天日志，**不得提前修改 Design**；
- Design 阶段仍然**只修改 Design 正文**并追加当天日志；
- 不得跨阶段边界修改文件：Requirement 不写实现代码，Design 不写实现代码；
- **DESIGN 完成后必须 HARD STOP。** 不得自动进入 IMPLEMENTATION，必须等待用户明确批准 Implementation；
- Acceptance / Freeze 仍按 §4.5 执行，仍须用户最终验收；
- 用户的连续阶段授权**只覆盖被明确授权的阶段**。它不代表自动授权其他阶段，也不代表授权 Git 写操作、数据库操作、migration 执行、发布、部署或任何外部写入；这些仍按 §11、§13、§16 单独取得用户批准。

未获连续阶段授权时，§4.1–§4.5 的逐阶段停顿与确认要求全部有效。

### 4.1 AUDIT / COVERAGE

先检查真实仓库：

- UI / Route；
- Launcher / direct route；
- API；
- handler；
- canonical owner；
- schema；
- source relation；
- state machine；
- RBAC / SOD；
- transaction / idempotency；
- audit；
- tests；
- mobile/responsive；
- cross-domain impact。

Coverage 只允许：

- `COVERED`
- `PARTIAL`
- `MISSING`
- `SEMANTIC_MISMATCH`
- `OUT_OF_SCOPE`

完成后停止，等待用户确认。

### 4.2 REQUIREMENT

只有用户确认的 `PARTIAL / MISSING / SEMANTIC_MISMATCH` 才进入 Requirement。

此阶段：

- **只修改与本次需求相关的 Requirement 正文**（`document.md` 对应章节与 `docs/requirements/` 对应 Domain 正文）；
- 不修改无关需求；
- 不写实现代码；
- 不提前改 Design；
- 完成后停止，等待用户明确确认；如果用户已按 §4.0 一次性授权连续执行 Requirement 与 Design，则不因本步骤停顿而中断，直接进入 §4.3，并在本阶段记录中写明该授权来源。

### 4.3 DESIGN

Requirement 获批后（或用户已按 §4.0 一次性授权连续执行 Requirement 与 Design 时）：

- **只修改与本次功能相关的 Design**（`solution.md` 对应章节与 `docs/design/` 对应 Domain 正文）；
- 说明实现过程，不粘贴大段实现代码；
- 至少说明：
  - module/function responsibility；
  - call/data flow；
  - schema/migration；
  - transaction；
  - RBAC/SOD；
  - state transition；
  - error behavior；
  - audit；
  - compatibility；
  - tests；
  - rollback（当适用）。

**完成后必须 HARD STOP**，等待用户明确确认 Implementation。不得自动进入 §4.4。

### 4.4 IMPLEMENTATION

只有 Requirement + Design 都获批后，才能修改实现。

必须：

- 严格按已批准的 Design 实现；
- 不自行扩大需求；
- 不自行改变设计；
- 不新增未经批准的功能；
- 不以"顺手优化"为理由扩大范围；
- 不留下 TODO 占位；
- 新功能/行为变化必须添加测试；
- 错误必须显式处理，禁止静默忽略；
- 保持兼容性，除非 Requirement 明确改变合同；
- 代码结构必须清晰、可扩展。

实现过程中若发现：

- 新业务规则；
- 新 schema；
- 新 migration；
- 新跨域影响；
- 新状态机；
- 新会计/库存/结算/估值语义；
- 手册解释冲突；

立即停止该新增部分，返回 Requirement/Design 层，不得直接实现。

### 4.5 ACCEPTANCE / FREEZE

最终 Acceptance 必须基于：

- `document.md` 与对应 Requirement 正文；
- `solution.md` 与对应 Design 正文；
- 真实远端/本地代码；
- Coverage Matrix；
- focused tests；
- regression；
- build；
- `git diff --check`；
- heavy/MySQL gate（当适用）。

Implementation Agent 自报"PASS / 完成"不能替代用户最终 Acceptance。

只有用户明确确认 PASS 后，才能 Freeze 对应 Capability/Manual，并进入下一阶段。

### 4.6 验收证据的引用规则

历史验收结论会随实现演进而失效，且失效本身不会主动暴露。本节把"能不能引用它"变成可判定的事。

- 引用一份历史验收记录时，**必须**同时写明它在
  [`docs/acceptance/acceptance-record-revalidation-20261112.md`](./docs/acceptance/acceptance-record-revalidation-20261112.md)
  中的类别：
  - `CURRENT` / `STILL_VALID` —— 可作为当前证据直接引用；
  - `SUPERSEDED_BY_DOMAIN_ACCEPTANCE` —— 不得单独引用，改引更晚的域级 Acceptance；
  - `PENDING_DOMAIN_AUDIT` —— 不得作为当前证据单独引用，待该域域级审计复核；
  - `NEEDS_REVIEW` —— 只能按复核记录写明的具体失效点引用。
- 域级 Acceptance 的**真实 MySQL 证据**必须逐段写明覆盖什么、**不**覆盖什么；本仓库只有三个已批准的 ACK-4 campaign 可运行，其余入口被永久阻断，不得被引用为证据（见
  [`docs/decisions/mysql-evidence-policy-20261112.md`](./docs/decisions/mysql-evidence-policy-20261112.md)）。
- 域级验收审计必须把**历史已验收结论的当前有效性**列为必查项：至少核对被引用的门禁、脚本、能力集合是否仍存在且仍成立。
- 机器可验证入口：
  `node scripts/qa/verify-acceptance-records.mjs`（指针悬空或未登记漂移即失败）。

---

## 5. 防止文档再次膨胀

以下为强制规则：

1. 禁止将 Agent 完整执行报告粘贴进 Requirement / Design。
2. 禁止为了记录一次测试而复制完整控制台输出。
3. 禁止在同一文档反复追加"当前状态"的新副本。
4. 禁止在没有明确 Owner 的情况下创建新的权威文档。
5. 禁止同一个 Requirement / Design 维持两份 Active 正文。
6. 禁止未经映射随意重编号冻结合同 ID。
7. 文档修改必须精确到业务能力与对应章节。
8. 新增文档必须声明用途、Owner、状态及权威来源（§2.3）。
9. 过期设计必须进行明确 Supersession，而不是无限追加纠错段落。
10. 不以固定行数上限代替内容质量判断；文档过长必须分析结构原因。

补充约束：

- 文档迁移必须保留原章节编号并建立 §2.5 映射表；
- 从旧文件移除的任何内容，必须能在**当前有效文档**、**归档文件**或 **Git Commit 历史 + 映射索引** 中至少一处被重新定位；
- 无法判定为重复、过时或已归档的内容，**不允许仅因其冗长而删除**；应标记为 `NEEDS_OWNER_REVIEW` 并保留原始内容与来源。

### 5.1 可执行校验

上述规则不得只靠人工遵守。仓库提供**只读**的文档一致性检查，**两种模式语义不同**，
必须分开理解、分开执行。

#### 5.1.1 `current` 模式 —— 当前文档完整性（默认）

```bash
node scripts/docs/check-doc-consistency.mjs            # 默认即 current 模式
node scripts/docs/check-doc-consistency.mjs --mode current --target HEAD
```

验证**持续开发后的当前文档**是否自洽：

| 检查 | 内容 |
|---|---|
| N1 | 链接与标题锚点可达（相对 G0 验收锚点**不得新增**失效链接） |
| N2 | **RETIRED（已退役）** —— 经项目负责人决定主动退役自动章节编号解析与唯一性校验；**不再产生 PASS / FAIL 判定**，不得被记为 PASS；章节权威关系改由人工 Review 确认。N2 编号保留为历史标识，**不得重新编号** |
| N3 | Active 集合内无第二份同一合同正文；待审候选不复制 Active 正文 |
| N4 | Active 合同文件声明 状态 / Owner / 权威来源，状态为 `ACTIVE` |
| N5 | 索引 README 登记本目录全部直属正文，且其链接可达 |
| N6 | 历史行号 / 章节引用在当前结构中**仍可追溯**（结构化解析，不要求逐字不变） |
| N7 | 已批准合同的后续修改可经「变更记录 + Git Diff」定位到提交；受治理路径取自 anchor..target **真实 Git 历史**，整文件删除与 Rename 一律 Fail Closed；「变更记录」有两个来源 —— **提交信息**（须含受治理文件完整路径，或全部被触达章节 id）与**变更追溯台账**（`docs/acceptance/n7-traceability-ledger.md`，见 [`docs/decisions/n7-traceability-ledger-policy-20261113.md`](./docs/decisions/n7-traceability-ledger-policy-20261113.md)），台账覆盖须 SHA + 文件 + 章节 id 集合**完全相等**且引用**已批准**的所有者决定 |
| N8 | 待审候选声明 `PENDING` / `NOT_AUTHORIZED` / `NOT_ISSUED`，不得冒充已批准 |
| N9 | 现场重跑 `migration` 模式的 C1–C6，证明 G0 历史迁移证明仍可独立复跑 |

**合法修改已批准合同后，本模式不得报「迁移丢失」**——这正是双模式拆分的目的。

##### 5.1.1.1 N2 退役说明

- N2 是**经项目负责人决定主动退役**，不是修复成功，也不是"检查通过"。
- 退役范围：Markdown 元数据中的章节编号自动解析（单节 / 区间 / 多项声明）、
  权威章节唯一性校验、分段合同的索引登记推断。
- 退役原因：自动推断需要持续的规则扩展，且其结论仍需人工 Review 确认，
  投入产出不匹配。**章节权威关系改由人工 Review 确认。**
- 退役后：N1、N3–N9 继续有效；`migration` 模式的 C1–C6 **完整保留**；
  N2 编号保留为历史标识并输出 `[RETIRED]`，**不得重新编号**，以免造成历史记录混乱。
- 退役不得以降低其他检查条件、或把 N2 记为 PASS 的方式实现。
- 落地记录见 `docs/status/PROJECT_STATUS.md` §36.9 与 `log/2026-11-01.md`。

#### 5.1.2 `migration` 模式 —— 历史迁移验证（显式调用）

```bash
node scripts/docs/check-doc-consistency.mjs --mode migration
```

固定比对 **G0 迁移前的 `master` → G0 验收锚点**，目标锚定不随 HEAD 漂移，
因此历史证明**永远可独立复跑**：

- Source：`4cb8c477aa00988bbfebef905764565cdfe62b71`（G0 迁移前的 `master`）
- Target：`1aa753d6e72fdfb37968601d26cfdd422b794948`（G0 验收锚点）

覆盖：C1 迁移章节覆盖率、C2 正文逐字保留与唯一、C3 迁移映射表一致性、
C4 链接与锚点、C5 历史引用解析、C6 重复 Active 合同。
**不得**为通过检查而删除断言、跳过项目或降低标准。

失败返回非零退出码；两种模式都**只读**：不修改任何文档内容、不访问数据库、不改变测试分组。

历史引用解析方法见 [`docs/status/MIGRATION-MAP.md`](docs/status/MIGRATION-MAP.md) §4，
或直接执行 `node scripts/docs/resolve-reference.mjs "<引用>"`。

---

## 6. 代码规则

- 使用清晰、合理、可扩展的结构；
- 按已批准的 Design 编写；
- 同一业务原语只允许一个 active canonical implementation；
- 删除/迁移前必须完成 zero-caller / dependency proof；
- 不为了目录美观进行 big-bang rewrite；
- 不建立 kitchen-sink module；
- API 权限必须后端 fail closed；
- frontend hidden 不等于 authorization；
- 金额 API/DB 边界使用安全整数分；
- 核心 mutation 必须在 transaction 中重读权威状态；
- inventory / LOT-SERIAL / valuation / AR/AP / WIP / accounting 等失败副作用必须为零；
- 关键 mutation 写 audit；
- 未知历史事实不得伪造；
- GET/CHECK 不静默修复历史；
- **一个域的内部错误码不是跨域合同**：消费方不得用生产方的错误码做自己的业务判断；确需转译明细的耦合必须登记理由，生产方改码须走对应域的 Requirement / Design 裁定（见 [`docs/decisions/cross-domain-error-code-policy-20261112.md`](./docs/decisions/cross-domain-error-code-policy-20261112.md)）；
- 机器可验证入口：`node scripts/qa/verify-error-code-coupling.mjs`（未登记的耦合或死引用即失败）。

---

## 7. 前端规则

`src/navigation/applicationRegistry.js` 是最终用户 Route canonical source。

必须保持：

- route key 唯一；
- direct URL / refresh / Back / Forward；
- permission exposure 一致；
- launcher/navigation 一致；
- RouteLocation 一致；
- 同一 route 不存在两套 active executable screen。

Mobile-first：

- 主要设计基线 390 CSS px；
- 同时验证 320 / 430 / 680；
- 核心任务不依赖永久横向页面滚动；
- 复杂对象采用 LIST → DETAIL → EDITOR/WORKFLOW；
- 状态、业务身份和 primary action 优先；
- UI 不能改变业务语义。

---

## 8. Backend / Domain Ownership 规则

长期目标：

- `server/app.js` 收敛为 HTTP lifecycle + auth + thin dispatch；
- 领域逻辑逐步进入 `server/modules/` 或后续 coherent domain 目录；
- `ownedRouteTable` owner 唯一；
- route descriptor 只保留 route facts；
- permission / transaction / audit 继续由 runtime handler 负责。

每次 ownership migration：

1. caller proof；
2. 找到 canonical implementation；
3. 建立单一 owner；
4. 切换 dispatch；
5. 删除旧 active implementation；
6. focused tests；
7. full gate（按任务等级）。

不得一次性为"架构漂亮"迁移整个仓库。

---

## 9. 高风险领域

以下任务默认提高验证等级：

- inventory mutation；
- inventory valuation；
- LOT/SERIAL；
- traceability/genealogy；
- IQC/OQC；
- period close；
- AR/AP settlement；
- treasury；
- accounting voucher；
- manufacturing WIP/cost；
- schema/migration；
- MySQL adapter/concurrency/recovery；
- backup/restore；
- deployment。

必须特别验证：

- authority recheck；
- transaction rollback；
- idempotency；
- audit；
- SQLite/MySQL 双路径；
- concurrent behavior（适用时）。

---

## 10. 测试规则

新增功能必须有单元/合同/集成测试，按实际行为选择。

禁止：

- 通过 `skip` 制造绿色；
- 删除 assertion；
- 降级测试分类；
- 修改测试来掩盖真实 bug；
- 静默不分类新增 `*.test.js`。

测试 suite 集中由 `scripts/testing/test-suites.js` 管理。

集合语义保持：

- `FAST ⊆ FULL`
- `FULL ∩ HEAVY = ∅`
- `ALL = FULL ∪ HEAVY`

### 10.1 日常有界任务

```bash
pnpm test:fast
pnpm build
git diff --check
```

并按需运行 focused `node --test ...`。

### 10.2 跨域 / 架构 / canonical metadata

```bash
pnpm test
pnpm build
git diff --check
```

### 10.3 Heavy / DB / deployment

在完整回归基础上追加：

```bash
pnpm test:heavy
```

涉及 MySQL 且具备受保护 disposable MySQL 环境时追加：

```bash
pnpm test:mysql
pnpm test:mysql:concurrency
```

性能任务再按需运行：

```bash
pnpm test:mysql:performance
```

release candidate / migration release 可使用：

```bash
pnpm test:all
```

---

## 11. Git 规范

### 11.1 本地 Git

所有变更使用本地 Git 管理。

### 11.2 精确暂存

禁止无脑：

```bash
git add .
```

优先精确暂存本逻辑单元文件。

### 11.3 及时提交

每个获批逻辑单元完成、验证通过后及时 commit。

commit 信息必须使用中文，清楚说明：

- 变更目的；
- 范围；
- 影响。

### 11.4 汇报版本

提交后报告：

- 当前 branch；
- short commit hash；
- `package.json` version 是否变化；
- release tag 是否变化。

### 11.5 外部 Git 操作授权

未经用户明确批准，禁止：

- push；
- tag；
- merge；
- deploy；
- release；
- Git 历史重写。

"直接通过 GitHub API 写文件"本质上也是远端 commit/push，未经用户批准同样禁止。

不得移动、删除或重建既有 release tag。

---

## 12. 日志规则

- 文件：`log/YYYY-MM-DD.md`
- append-only
- 不删除历史
- 不重写历史
- 不补造不存在的历史日期
- 同日拆分遗留文件保持原样
- 新开发记录写当前日历日文件

记录至少包括：

- baseline；
- scope；
- changes；
- tests；
- Git status/commit；
- 未发生事项；
- 下一阶段/暂停点。

---

## 13. 数据库与安全

- SQLite 是受支持的本地/测试兼容后端；
- MySQL 8 是一等运行后端；
- destructive operation 必须用户明确批准；
- MySQL reset test 必须显式 disposable/test database；
- 不记录 `ERP_DB_PASSWORD`；
- 不保存 Token/Secret；
- backup/restore/migration/history rewrite 属于高风险独立操作；
- schema 改动必须先 Requirement，再 Design；
- migration 必须考虑 SQLite + MySQL；
- rollback/兼容策略必须明确。

---

## 14. erp-mobile-taste Skill

`.claude/skills/erp-mobile-taste/SKILL.md` 默认**不加载**。

只有用户明确要求以下任务才允许加载：

- UI Design
- 页面布局
- 视觉优化
- Mobile UX
- 响应式设计
- mobile-first redesign

以下任务不得因为发生在 `src/` 就自动加载：

- 普通功能开发；
- Bug 修复；
- API 联调；
- 业务逻辑；
- 字段调整；
- 非设计型样式修复。

Skill 不得改变：

- ERP terminology；
- API；
- schema；
- permissions；
- state machine；
- Approval/Confirm/Post/Reverse；
- source/downstream；
- inventory/accounting facts。

---

## 15. Core Scope Cleanup 特别规则

已确认最终删除的非核心扩展：

- projects
- tasks
- timesheets
- contacts（CRM extension）
- followups
- activities

实施前必须先做 dependency audit。

不得误删：

- Customer/Supplier Contact 核心能力；
- delivery/billing/settlement contact；
- notifications；
- workflows；
- approvals；
- audit。

历史 mixed-owner 文件（曾记为 `projects-workflow.jsx` / `server/modules/business.js`）必须按函数/责任拆分，禁止整文件删除。
**当前基线（`master` @ `4cb8c47`）中这两个文件已不存在**，本条因此转为：任何重新引入同名文件的改动，必须重新履行 dependency audit。

历史数据库表不得在普通 cleanup 中直接 DROP。

---

## 16. 违反后果

如果发现违反：

- 文档先行；
- 用户确认；
- scope；
- Git 授权；
- database safety；
- test gate；
- canonical ownership；
- 业务语义；

立即停止开发。

先：

1. 保持工作树和外部状态；
2. 报告已经发生什么；
3. 修复 Requirement / Design / 文档；
4. 获得用户确认；
5. 再恢复 Implementation。

不得用"已经改了一半""顺手处理""工具有权限"作为继续违规操作的理由。
