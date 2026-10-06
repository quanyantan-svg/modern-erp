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

## 1.1 产品架构与需求双轴

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

## 2. 项目必备文档

每个项目阶段都必须维护：

1. `README.md`
   - 项目简介；
   - 技术栈；
   - 运行/构建/测试/部署；
   - 主要代码结构；
   - release 状态；
   - 代码结构变化时及时更新。

2. `document.md`
   - 唯一业务需求来源；
   - 当前功能；
   - 目标 Capability；
   - Coverage/Gap；
   - 业务规则、状态、权限、边界；
   - 需求变化时及时更新。

3. `solution.md`
   - 唯一技术设计来源；
   - 模块/函数职责；
   - 数据流和调用关系；
   - 事务、权限、错误、migration、测试策略；
   - 新增代码/设计时及时更新。

4. `log/YYYY-MM-DD.md`
   - 当天开发与沟通记录；
   - append-only；
   - 只追加，不删除、不重写历史。

额外治理文件：

- `AGENTS.md`：本文件，唯一 AI/Vibe Coding 治理规则；
- `CLAUDE.md`：Claude Code 项目入口，只引用 `AGENTS.md`；
- `.claude/skills/erp-mobile-taste/SKILL.md`：明确 UI 设计任务才允许加载；
- `docs/`：运维资料与历史证据，不得形成第二套当前规格；
- `APPLY_GUIDE.md`：仅一次性恢复/应用说明，不是 canonical；恢复完成可删除。

---

## 3. 修改前必读

### 3.1 新会话 / 新阶段必须完整阅读

开始任何新的 AI/Claude Code/Codex 开发会话，或上下文已经不可靠时，必须从头到尾完整阅读：

- `README.md`
- `document.md`
- `solution.md`
- `AGENTS.md`
- 当前工具入口规则（Claude Code 读取 `CLAUDE.md`）
- `log/` 中按日期倒序最近 3 个**实际存在**的开发日志日期；同日拆分文件全部读取

下列情况也必须重新建立完整基线：

- `git checkout`
- `git pull`
- `git rebase`
- `git merge`
- 切换分支
- 重大跨域/架构/数据库/库存/财务任务
- canonical 文档发生全局语义变化
- 上下文被压缩到不能确认已完整阅读

不得用旧聊天记忆代替仓库事实。

### 3.2 同一连续任务

同一个已经开始、canonical 文档没有变化的单一 implementation task 内，不需要每改一个文件重新读一遍全部文档。

但开始新的功能/阶段时，必须重新核对：

- 当前 Requirement；
- 当前 Design；
- 当天新增日志；
- 本次完整代码调用链。

### 3.3 修改代码前必须把相关代码读完

修改代码前必须完整阅读：

- 本次直接修改的全部文件；
- 目标函数完整定义；
- 所有直接调用方；
- 目标函数调用的关键下游；
- 相关 schema/migration；
- 相关 tests；
- 相关 permission/state/transaction/audit 逻辑；
- 相关 frontend route/surface。

跨域、架构、库存、财务、会计、数据库、migration 等任务，阅读范围必须扩大到受影响领域的完整代码区域。

不得根据文件名或局部 grep 就假设业务关系已经理解。

不得修改与本次功能无关的代码。

---

## 4. 文档先行

任何新增功能、行为变化、Capability Gap 修复或架构调整必须先完成文档。

固定顺序：

`AUDIT → COVERAGE/GAP → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE/FREEZE`

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

- **只修改 `document.md` 与本次需求相关章节**；
- 不修改无关需求；
- 不写实现代码；
- 不提前改 `solution.md`；
- 完成后停止，等待用户明确确认。

### 4.3 DESIGN

Requirement 获批后：

- **只修改 `solution.md` 与本次功能相关的设计**；
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

完成后停止，等待用户明确确认。

### 4.4 IMPLEMENTATION

只有 Requirement + Design 都获批后，才能修改实现。

必须：

- 严格按 `solution.md` 实现；
- 不自行扩大需求；
- 不自行改变设计；
- 不新增未经批准的功能；
- 不以“顺手优化”为理由扩大范围；
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

- `document.md`
- `solution.md`
- 真实远端/本地代码
- Coverage Matrix
- focused tests
- regression
- build
- `git diff --check`
- heavy/MySQL gate（当适用）

Implementation Agent 自报“PASS / 完成”不能替代用户最终 Acceptance。

只有用户明确确认 PASS 后，才能 Freeze 对应 Capability/Manual，并进入下一阶段。

---

## 5. Canonical 文档职责

### README.md

仅负责：

- 项目入口；
- 技术栈；
- 目录结构；
- 运行/测试/部署；
- release 状态；
- 架构摘要。

以下变化时必须更新 README：

- 项目结构；
- 启动/安装命令；
- runtime；
- database backend 使用方式；
- package scripts；
- deployment entry；
- release 状态。

### document.md

唯一业务 Requirement 来源。

新增功能时只在 Requirement 阶段修改与该功能有关内容，不重写无关章节。

### solution.md

唯一技术 Design 来源。

新增功能时只在 Design 阶段增加或修改相关设计，不写与本功能无关的实现细节。

### log/YYYY-MM-DD.md

只追加，不删除，不覆盖。

---

## 6. 代码规则

- 使用清晰、合理、可扩展的结构；
- 按已批准的 `solution.md` 编写；
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
- GET/CHECK 不静默修复历史。

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

不得一次性为“架构漂亮”迁移整个仓库。

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

### 11.5 外部 Git 动作授权

未经用户明确批准，禁止：

- push；
- tag；
- merge；
- deploy；
- release；
- Git 历史重写。

“直接通过 GitHub API 写文件”本质上也是远端 commit/push，未经用户批准同样禁止。

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

## 15. 当前 Core Scope Cleanup 特别规则

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

`projects-workflow.jsx` / `server/modules/business.js` 属于 mixed-owner，必须按函数/责任拆分，禁止整文件删除。

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

不得用“已经改了一半”“顺手处理”“工具有权限”作为继续违规操作的理由。
