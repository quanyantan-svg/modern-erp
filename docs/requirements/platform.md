# Platform — Requirement

> 状态：`ACTIVE`
> Owner：Platform
> 权威来源：`document.md` §0.1 Domain Requirement 入口 + 本文件 `§36`
> 来源：新增正文（2026-11-13 建立 Platform Domain Closure Requirement）。
> **本文件已获业务所有者批准（`APPROVED`，2026-11-13）**；Implementation 尚未授权。
> 上游依据：[`docs/audits/platform-capability-audit-20261113.md`](../audits/platform-capability-audit-20261113.md)（`v1.0`，基准 SHA `63bb7c5`）。
> 手册能力基线来源：`document.md` §17（Platform 长期能力）、`document.md` §22.22（B3122 工作流设计与配置）。
> 业务所有者 2026-11-13 裁定（详见 [`docs/decisions/platform-domain-closure-decisions-20261113.md`](../decisions/platform-domain-closure-decisions-20261113.md)）：
> - `PL-DEC-01` **闭合范围**：本域建设 Generic Workflow 引擎、Attachment、Org Scope、Notification 生产者、Numbering 服务五个子系统，**并**补齐通用 SOD 引擎与生产订单自审批缺口；Document Relation、Document Conversion、生命周期通用化、期间控制收敛四项**显式 `OUT_OF_SCOPE`**（延期后续版本）。
> - `PL-DEC-02` **Organization 归属**：Organization 主数据所有权由 Master & Engineering **正式移交** Platform；Master & Engineering 的 Multi-Organization 业务铺开仍维持 `OUT_OF_SCOPE`。
> - `PL-DEC-03` **审计 schema 升级**：`audit_logs` 结构化字段与索引升级**纳入本域**，由 Platform 主导，Finance Operations 为受影响的共同 Owner 域。
>
> **2026-11-14 有界解冻授权**：业务所有者明确批准解冻 PL-13 及受影响的 Finance Operations、
> Accounting & Analytics、Inventory & Warehouse 合同并进入 Requirement 阶段。§36.15 是本次
> 解冻形成的修订已由业务所有者于 2026-11-14 批准，状态为 `APPROVED`；Design 已授权，
> Implementation 尚未授权。本次批准不把历史冻结记录改写为“从未冻结”。

## 36. Platform 平台层域 Domain Closure Requirement

### 36.1 定位与边界

Platform 是九域架构（8 Business Domains + Platform）中的**平台层**，为八个业务域提供横向能力，本身不产生业务单据。

**本域承担**（`document.md §17`）：

| # | 能力 | 本轮处置 |
|---|---|---|
| 1 | Identity / RBAC | 封顶既有能力，无增量 |
| 2 | SOD（职责分离） | **本域新建通用 SOD 引擎** |
| 3 | Organization Scope | **本域新建组织主数据与作用域登记** |
| 4 | Workflow | **本域新建 Generic Workflow 引擎** |
| 5 | Approval | 封顶既有能力，6 族保持 canonical |
| 6 | Document Lifecycle | 封顶既有能力 + 补 operator 工作面；通用化增量 `OUT_OF_SCOPE` |
| 7 | Document Relation | **`OUT_OF_SCOPE`**（延期） |
| 8 | Document Conversion | **`OUT_OF_SCOPE`**（延期） |
| 9 | Numbering | **本域新建编号服务** |
| 10 | Attachment | **本域新建附件能力** |
| 11 | Notification | **本域新建通知生产者** |
| 12 | Audit | 封顶既有能力 + **本轮 schema 升级** |
| 13 | Period Control | 封顶既有能力；收敛增量 `OUT_OF_SCOPE` |

**本域不承担**：任何业务单据的业务语义、单据状态机、单据业务校验、库存 / 金额 / 会计事实。平台提供能力，业务语义仍由业务域决定（`solution.md §20.6`）。

**硬边界**：

1. **既有 6 个审批族在 Generic Workflow 完成前保持 canonical**（`document.md §158`、`:573`；`solution.md §1238`）。本域建设的通用引擎**与既有族并行**，本轮**不迁移任何既有族到通用引擎**（迁移为显式 `OUT_OF_SCOPE`）。
2. **通用引擎不得重写任何业务域的状态机、信用闸门、幂等、库存或会计副作用**。引擎必须**委托**域模块。
3. **通用引擎的变更入口必须使用新的路径前缀**。`/api/approvals/…` 下不得新增任何 POST / PATCH / DELETE（既有测试 `server/mobile-approval-center.test.js:166` 锁定该约束）。
4. **不得为 Platform 能力建立第二个业务主数据 owner**。组织主数据所有权移交由 `PL-DEC-02` 裁定（§36.6）。
5. **不一次性给所有业务表机械加 `org_id`**（`solution.md §20.7`）。
6. 金额一律使用**安全整数分**（AGENTS.md §6）。
7. 关键 mutation 必须在 transaction 中**重读权威状态**；失败副作用必须为零。
8. 平台级 mutation 必须写 audit。

### 36.2 能力枚举与目标 Coverage（21 项）

覆盖范围 = `document.md §17` 的 13 项平台长期能力（PL-01～PL-13）+ `document.md §22.22` 的 8 项 B3122 手册能力（WF-01～WF-08）。
逐项审计证据见 [`docs/audits/platform-capability-audit-20261113.md`](../audits/platform-capability-audit-20261113.md) §3、§4。

| ID | 能力 | 审计判定 | **本域目标** | 依据 / 本轮增量 |
|---|---|---|---|---|
| PL-01 | Identity / RBAC | `COVERED` | `COVERED`（封顶） | 既有 `users` / `roles` / `role_permissions` / `sessions` + `allow()` 权威闸门；本轮无增量 |
| PL-02 | SOD | `MISSING` | `COVERED` | **新建通用 SOD 规则表 + 求值引擎**，覆盖 6 族 + 信用特批；补 `PL-DEF-01` 生产订单自审批缺口 |
| PL-03 | Organization Scope | `MISSING` | `COVERED` | **新建组织主数据 + 作用域登记**；所有权由 `PL-DEC-02` 移交 |
| PL-04 | Generic Workflow 引擎 | `MISSING` | `COVERED` | **新建定义 / 版本发布 / 绑定 / 实例 / 任务 / 动作 / 监控 / 生命周期控制**八段引擎 |
| PL-05 | Approval | `COVERED` | `COVERED`（封顶） | 6 族 + 1 信用特批保持 canonical；本轮**不改**其状态机；补 `PL-DEF-10` 合同表述漂移 |
| PL-06 | Document Lifecycle | `PARTIAL` | `COVERED`（封顶） | 封顶既有 25 实体注册表 + 归档 / 恢复 / 清理；**补 operator 工作面**；通用关系注册表与全实体可归档 → `OUT_OF_SCOPE` |
| PL-07 | Document Relation | `MISSING` | **`OUT_OF_SCOPE`** | 无通用关系表；`solution.md:1215` 要求的 `reversal` / `remaining` / `lineage` 属性全部缺失；延期后续版本 |
| PL-08 | Document Conversion | `MISSING` | **`OUT_OF_SCOPE`** | 5 条转换线 100% 域内手写，无共享 `Source → Rule → Target` 抽象；延期后续版本 |
| PL-09 | Numbering | `PARTIAL` | `COVERED` | **新建编号服务 + 规则表**，采纳既有 `document_sequences` / `document_number_allocations`；修 `PL-DEF-11` / `PL-DEF-12` / `PL-DEF-13` |
| PL-10 | Attachment | `MISSING` | `COVERED` | **新建附件实体 + 上传 / 下载 / 绑定 / 挂载点** |
| PL-11 | Notification | `PARTIAL` | `COVERED` | **新建通知生产者 + 路由 + 权限 + 徽标**；修 `PL-DEF-15` |
| PL-12 | Audit | `COVERED` | `COVERED`（封顶 + 增量） | **schema 升级**（`business_date` / `request_id` / before-after / `created_at` 索引）由 `PL-DEC-03` 纳入；补 `PL-DEF-06` 测试缺口 |
| PL-13 | Period Control | `PARTIAL` | `COVERED`（封顶） | 封顶 4 套既有期间存储 + canonical 断言；**三闸门归一与 5 套存储收敛 → `OUT_OF_SCOPE`** |
| WF-01 | 流程定义 | `PARTIAL` | `COVERED` | 随 PL-04 引擎建立节点 / 连接 / 条件 / 参与人 / 动作模型；替换 `approval_workflows.steps` 死列语义 |
| WF-02 | 版本与发布 | `MISSING` | `COVERED` | 随 PL-04 引擎建立草稿 / 发布 / 停用与版本不可变快照 |
| WF-03 | 业务模板绑定 | `MISSING` | `COVERED` | 随 PL-04 引擎建立按组织 / 单据类型 / 条件绑定 |
| WF-04 | 流程实例 | `PARTIAL` | `COVERED` | 随 PL-04 引擎建立实例物化与图快照 |
| WF-05 | 节点任务 | `PARTIAL` | `COVERED` | 随 PL-04 引擎建立任务物化、指派与任务动作 |
| WF-06 | 业务动作 | `MISSING` | `COVERED` | 随 PL-04 引擎建立动作契约（表单操作 / 通知 / 下推 / 业务回调） |
| WF-07 | 监控 | `MISSING` | `COVERED` | 随 PL-04 引擎建立实例 / 节点 / 路径 / 状态查询与筛选 |
| WF-08 | 暂停 / 终止 / 恢复 | `MISSING` | `COVERED` | 随 PL-04 引擎建立实例级控制与重新部署 |

**目标 Coverage 合计（能力口径，业务所有者 2026-11-14 裁定）**：`COVERED` **19** / `OUT_OF_SCOPE` **2**（PL-07、PL-08）/ `PARTIAL` **0** / `MISSING` **0**。
另有 **4 项 `OUT_OF_SCOPE` 范围项**（PL-06 通用化增量、PL-07、PL-08、PL-13 收敛增量）：其中 PL-06 通用化增量与 PL-13 收敛增量是这两项能力**内部**的范围边界，能力本身为 `COVERED`（封顶），不构成「未覆盖的能力」。

### 36.3 Generic Workflow 引擎需求（PL-04 / WF-01～WF-08）

#### 36.3.1 流程定义（WF-01）

- 管理员可定义**流程模板**，包含：**节点**（审批 / 抄送 / 知会 / 条件分支 / 结束）、**连接**（前后继）、**条件**（字段-运算符-值表达式）、**参与人解析规则**、**节点动作**。
- 节点类型必须覆盖：串行审批、并行会签、条件分支、抄送（不阻塞）、知会（不阻塞）、自动节点（无人工参与）。
- 条件表达式**不得**执行任意脚本；只允许白名单字段与白名单运算符（`=`、`!=`、`>`、`>=`、`<`、`<=`、`in`、`contains`）。
- 流程模板必须可被**测试运行**（以指定变量集走一遍节点图，产出可达路径与每节点参与人解析结果，**不产生任何业务副作用**）。

#### 36.3.2 版本与发布（WF-02）

- 生命周期：草稿（`DRAFT`）→ 已发布（`PUBLISHED`）→ 已停用（`RETIRED`）。只有 `PUBLISHED` 版本可被绑定与启动。
- **已发布版本不可变**：任何修改必须产生新版本号。实例绑定**启动时刻**的版本快照。
- 停用不影响已启动实例；停用版本不可再启动新实例。
- 版本必须记录作者、发布时间、变更说明。

#### 36.3.3 业务模板绑定（WF-03）

- 绑定维度：**组织**（`PL-03` 的组织主数据）+ **单据类型** + **条件**（如金额区间、单据字段）。
- 同一（组织、单据类型）下**至多一条生效绑定**；绑定发布新版本时旧绑定自动失效。
- 绑定必须声明**优先级**与**兜底**：无匹配绑定时，业务提交必须**明确失败**（不得静默跳过审批），或由绑定显式声明"无流程"豁免。

#### 36.3.4 流程实例（WF-04）

- 业务单据提交时按绑定解析流程版本并启动实例；实例固化：**节点图快照**、**变量快照**、**启动人**、**启动时刻**、**业务单据引用**。
- 实例状态机：`RUNNING` → （`SUSPENDED` ⇄ `RUNNING`）→ `COMPLETED` / `TERMINATED` / `CANCELLED`。
- 实例的每个状态迁移必须写 audit。
- **同一业务单据的同一流程实例必须幂等**：重复提交不得启动第二个实例（幂等键 = 业务单据类型 + 单据 id + 绑定版本）。

#### 36.3.5 节点任务（WF-05）

- 实例推进到节点时**物化任务**并指派给参与人。任务动作：**同意**、**驳回**、**退回**（退回给发起人或指定节点）、**转办**、**加签**、**跳过**（仅条件分支自动节点）。
- 任务必须记录：节点、实例、参与人、创建时刻、完成时刻、动作、意见。
- **驳回必须终止实例**（回到发起人并置为 `CANCELLED` / 需重新提交），或按模板定义回到指定节点 —— 语义必须在模板中显式声明，**不得由引擎隐式决定**。
- 参与人解析结果必须在任务创建时**物化**（快照），避免角色变更后任务归属漂移。
- 任务不得重复完成；并发完成同一任务必须只有一方成功（幂等 + 乐观并发）。

#### 36.3.6 业务动作（WF-06）

- 节点动作契约，四类：**表单操作**（受控字段写回白名单）、**通知**（调用 §36.8 通知生产者）、**下推**（生成目标单据，遵循目标域的 canonical 创建入口，**不得**建立第二套创建路径）、**业务回调**（注册式 handler，跨域调用必须走被调域的 canonical API）。
- 动作失败时**实例不得推进**，且失败副作用必须为零（事务边界内）。
- 动作执行必须写 audit。

#### 36.3.7 监控（WF-07）

- 查询维度：实例列表（按状态 / 业务单据类型 / 发起人 / 节点 / 组织 / 时间区间）、实例详情（节点路径、每个节点的状态与参与人、动作历史、耗时）。
- 必须能回答"这张单现在卡在谁那里、卡了多久"。
- 监控读接口必须**只读**，不触发任何状态迁移。

#### 36.3.8 暂停 / 终止 / 恢复（WF-08）

- **暂停**：实例置 `SUSPENDED`，当前任务不可完成；已产生的待办保留。暂停必须记录原因与操作人。
- **恢复**：`SUSPENDED` → `RUNNING`，当前任务重新可完成。
- **终止**：实例置 `TERMINATED`，所有未完成任务置为已取消（不产生业务副作用）。
- **重新部署**：以模板的新版本对**同类未完成实例**重启（生成新实例并终止旧实例，旧实例保留为历史）；必须显式指定实例集合，不得批量隐式执行。
- 三种控制必须分别授权（暂停 / 终止 / 重新部署不得共用一个权限码）。

#### 36.3.9 与既有审批族的并存约束

- 通用引擎**不替换**既有 6 族。既有族的待办仍由 `GET /api/approvals` 实时计算。
- 通用引擎的待办**独立呈现**（独立工作面与独立徽标），不得混入既有审批中心的计数，避免破坏既有断言。
- 通用引擎**不调用**既有族的 handler；既有族**不调用**通用引擎。两者通过通知生产者互相通知（§36.8）。

### 36.4 通用 SOD 引擎需求（PL-02）

- **规则模型**：约束类型（禁止同一人、禁止同角色、禁止同部门、最小通过人数）、适用对象（业务类型 + 动作）、求值时机（决策点 / 事后复核）、违规处置（拒绝 / 升级至上级 / 要求第二人复核）、规则状态（启用 / 停用）。
- **约束语义与求值点是两件事**：约束类型定义的是"什么算违规"，求值点决定"在哪里能算出结论"。
  「最小通过人数」的语义是**已通过人数 < N 即违规**（不达最小人数的决策必须被挡住）；
  但本轮 7 个审批决策点**全部是单步审批**，不提供「已通过人数」—— 该约束因此**不可求值**，
  维护面必须在创建时 fail closed 拒绝（不得登记一条永远不生效的规则）。
  一旦出现多审批决策点（例如通用工作流引擎的会签节点），该约束按上述语义直接生效，无需再改代码。
- **求值点**：审批决策点（同意 / 驳回 / 退回）。求值必须在事务内**重读权威状态**（不得依赖请求方传入的角色标识）。
- **违规处置**：本轮只实现"拒绝"与"升级至上级"两种；"要求第二人复核"为显式 `OUT_OF_SCOPE`。
  「要求第二人复核」是**处置**（违规之后要求谁来复核），与「最小通过人数」**约束**（多少人才算数）
  是两个维度：`OUT_OF_SCOPE` 的是前者，不影响后者的语义定义。
- **覆盖范围**：既有 6 族 + 信用特批，**全部 7 个族必须至少被一条规则覆盖或显式登记为"该族无 SOD 约束"**（不留空白）。
- **必须补齐 `PL-DEF-01`**：生产订单审批的自审批防护（发起人不得审批自己发起的生产订单）。该防护与既有 5 族的语义一致（比较 actor id 与发起人 id）。
- **不改变既有行为**：在没有规则命中时，既有族的允许 / 拒绝结果**必须与当前完全一致**（既有测试全绿是本条的验收证据）。
- 规则变更必须写 audit；规则的启用 / 停用必须由权限控制。

### 36.5 Organization Scope 需求（PL-03）

- **组织主数据**：组织（代码、名称、组织类型：法人实体 / 业务单元、状态、启用日期）、组织层级（父组织，通过 `parent_org_id` 自引用形成树）。
- **组织类型必须区分法人实体与业务单元**：库存 / 财务口径的组织是法人实体；销售 / 采购的执行组织是业务单元。二者在同一棵树中通过父子关系表达。
- **作用域登记**：作用域（`scope_code`）↔ 组织 的映射表，一个作用域可绑定多个组织（`MULTI`）或恰好一个（`SINGLE`）。
- **与既有 `accounting_scopes` 的关系**：`accounting_scopes.org_scope` 是**自由文本标签**，其 `COSTING_SCOPE_OWNERS` 校验语义**不得**被本域改动。本域提供的是**独立的**组织注册表与作用域登记，二者通过显式映射关联，不合并、不替换。
- **多组织业务铺开**（向业务表加 `org_id` 并做数据隔离）→ **`OUT_OF_SCOPE`**，遵守 `solution.md §20.7` 的加法式逐域迁移原则与"不一次性给所有表机械加字段"。
- **Operator 工作面**：组织注册表维护（列表 / 详情 / 编辑 / 启停用）+ 作用域分配。
- **归属移交**：`PL-DEC-02` 裁定 Organization 主数据所有权归 Platform；Master & Engineering 侧同步修订（§36.11）。

### 36.6 Attachment 需求（PL-10）

- **附件实体**：附件（id、归属类型、归属 id、文件名、content type、字节大小、SHA-256、存储键、上传人、上传时刻）。
- **存储**：本地文件系统（数据库同级目录下的附件目录），**不入库**（不存 blob）。数据库只存元数据与存储键。
- **上传**：支持 `multipart/form-data` 二进制上传，并保留 JSON 路径的既有行为不变（不得因新增上传能力而回归现有 1 MB JSON 限制的既有行为）。附件专用大小上限**独立于** JSON 上限，由独立配置项控制，默认 10 MB。
- **下载**：必须走鉴权后的 API（按归属对象的查看权限判定），**不得**从可直接访问的静态目录直出。
- **类型与安全**：content type 白名单 + 扩展名白名单**双重校验**；文件名必须净化（去路径分隔符与控制字符）；存储键必须由服务端生成（**不得**使用客户端文件名）；下载响应必须固定 `Content-Disposition` 且不内联执行。
- **挂载点**（本轮只开放已冻结域中**只增不改**的挂载）：会计凭证、采购订单、销售订单、生产订单、生产检验单、采购申请、销售报价。不合格 / NC 单据当前无表，本轮不挂载。
- **计数语义**：`accounting_vouchers.attachment_count` 是**孤儿列**（无写方、无读方）。本轮必须处理：迁移时以附件表回填该列的历史值，并明确该列此后为**派生值**（由附件表统计）——**不得**保留两套可独立写入的计数。
- **删除语义**：删除附件必须写 audit；附件删除不得级联删除业务单据。

### 36.7 Notification 生产者需求（PL-11）

- **生产者**（本轮必须全部实现且**必须有可执行测试覆盖**）：
  1. 通用工作流任务生成（§36.3.5）；
  2. 通用工作流任务完成 / 驳回 / 退回；
  3. 通用工作流实例终止 / 恢复；
  4. 既有 6 族审批的待办产生与审批结果；
  5. 信用特批待决与裁定结果；
  6. 库存月结阻塞项（`server/modules/inventory-period-close.js:254 runInventoryCloseChecks` 的 `BLOCKING` 项）。
- **路由**：接收人可为**具体用户**、**角色**（展开为该角色下的启用用户）、**订阅者**。同一用户由多条规则命中时**只产生一条**通知（去重键 = 业务事件 id + 接收人 id）。
- **字段扩展**：通知必须支持优先级、分类、跳转目标（`action_url`）、过期时刻。`type` 必须由自由文本收敛为**受约束枚举**。
- **权限**：新增 `NOTIFICATION_VIEW` / `NOTIFICATION_MANAGE` 权限码；既有通知接口**不得**继续使用 `DASHBOARD_VIEW`（`DASHBOARD_VIEW` 的语义是仪表盘可见，不是通知可见）。既有调用方的权限授予必须同步登记。
- **徽标**：移动端 `messages` tab 必须显示未读数徽标（当前 `src/App.jsx:186` 的 `tabBadges` 只有 `approvals`）。
- **读取一致性**：列表与未读计数必须**同源同条件**（当前实现列表 `LIMIT 50` 而计数全表，二者可不一致）。
- **推送通道**：本轮**仅站内（in-app）**。邮件 / 短信 / 企业微信等外部通道 → **`OUT_OF_SCOPE`**。
- **既有 6 族产生通知不得改变其审批结果**（通知失败不得使审批失败）。

### 36.8 Numbering 服务需求（PL-09）

- **服务层**：统一编号服务，对外提供"按单据类型 + 业务日期 + 组织 + 幂等键取号"。**不得**建立第二套计数器。
- **采纳既有结构**：`document_sequences`（`document_type` + `period_key` 复合主键）与 `document_number_allocations`（幂等键主键 + 单号唯一约束）**保持结构不变**，服务层在其上实现；`voucher_sequences` / `voucher_words` 为**死表**（`current_no` 从不递增），本轮**不迁移凭证编号**（→ `OUT_OF_SCOPE`），但须在代码与文档中标注其非权威状态。
- **规则表**（新增）：编号规则（单据类型、组织、前缀、后缀、期间模式（无 / 月 / 年）、补零长度、重置规则、启用状态、适用域）。前缀**从调用点字面量改为规则表配置**。
- **既有 6 种已覆盖单据**（`SI` / `PB` / `SCN` / `PCN` / `OB` / `PO`）改由服务发放，**单号格式保持不变**（`{TYPE}-{YYYYMM}-{00000}`），以免破坏既有数据、既有断言与业务可读性。
- **必须修复**：
  - `PL-DEF-11` —— 编号分配必须**发生在单据事务之内**，杜绝孤儿号（当前采购订单路径在事务开启前分配）。
  - `PL-DEF-12` —— 幂等键的"查-插"必须**原子化**；并发同键必须返回**同一单号**（重放），不得返回 409。
  - `PL-DEF-13` —— 采购申请单号的 `COUNT(*)+1` 造号必须改为服务发放（删除后必冲突）。
- **13 种以上未覆盖单据的迁移**（销售订单、生产订单、销售报价、库存调整 / 调拨 / 报废、组装 / 拆卸、生产检验、预测 / MRP、WIP 转移等）→ **`OUT_OF_SCOPE`**（避免触碰四个已冻结域的行为）；迁移清单须在 Operator 工作面以"待迁移"状态可见。
- **组织维度**：编号规则支持组织维度，但**不要求**既有 6 种单据立即按组织分段（分段会改变既有单号格式）→ 组织分段对既有单据 → `OUT_OF_SCOPE`，仅对新规则生效。
- **并发与唯一性**：原子 upsert 语义必须保持（既有断言 `server/v13-phase6e-commercial-golive.test.js:90` 保持为绿）；单号唯一性由唯一约束兜底。

### 36.9 Audit schema 升级需求（PL-12）

- **新增字段**：`business_date`（业务日期）、`request_id`（请求关联 id）、`before_json` / `after_json`（变更前后结构化快照）。
- **索引**：`created_at` 索引；并按查询模式补 `entity_type` + `entity_id` 复合索引。
- **向后兼容**：`audit()` 的现有调用点**不得**被强制修改 —— 新增参数必须是可选，且缺省时新列写空值。这是本轮跨 8 个已冻结域的**兼容性契约**。
- **既有审计内容不得丢失**：迁移不得删除或改写任何历史 `audit_logs` 行。
- **`auditBusinessRejection` 必须获得测试覆盖**（`PL-DEF-06`）：正例（409 被拒绝时写入拒绝审计）与反例（非 409 错误不写）。
- **责任划分**：Platform 主导 schema 与 `audit()` 实现；Finance Operations 为受影响的共同 Owner 域（其既有验收证据的当前有效性须按 AGENTS.md §4.6 复核登记）。

### 36.10 既有能力封顶项

以下能力本轮**不做行为变更**，仅封顶现状并补齐可验证性：

| ID | 封顶范围 | 本轮必须补齐 | 明确不做 |
|---|---|---|---|
| PL-01 | `users` / `roles` / `role_permissions` / `sessions` + `allow()` 权威闸门 | 新增平台权限码登记（§36.7、§36.11） | 不改路由权限模型（`server/lib/route-table.js:45-56` 明确禁止声明式权限元数据） |
| PL-05 | 6 族 + 1 信用特批的状态机、审批中心工作面与徽标 | 修正合同表述漂移（`PL-DEF-10`：实际 6 族 + 1，非"五族"） | 不迁移任何族到通用引擎；不改任何族的状态机 |
| PL-06 | 25 实体注册表 + 归档 / 恢复 / 清理 + 仅 `PURCHASE_RECEIPT` 可归档的既有形态 | 补 operator 工作面；补 `PL-DEF-04` 的权限专化 | 通用关系注册表、全实体可归档 → `OUT_OF_SCOPE` |
| PL-13 | 4 套既有期间存储 + `assertFinancialPeriodsOpen` 断言 | 登记 `PL-DEF-08` / `PL-DEF-09` 为显式残余 | 三闸门归一、5 套存储收敛 → `OUT_OF_SCOPE` |

### 36.11 跨域契约与不变量

| # | 契约 | 约束 |
|---|---|---|
| 1 | **Organization 所有权移交** | `PL-DEC-02` 裁定 Organization 主数据所有权归 Platform。Master & Engineering Requirement 同步修订：其 Multi-Organization 业务铺开**仍维持** `OUT_OF_SCOPE`，本域建立组织主数据**不构成**对 M&E 的多组织业务解锁 |
| 2 | **既有 6 审批族不变** | 通用引擎与其并存；既有族的允许 / 拒绝结果、有序待办、计数、徽标在通用引擎上线后**必须完全一致** |
| 3 | **通知失败不影响审批** | 通知是副作用，失败必须被记录且**不得**回滚已完成的审批 |
| 4 | **编号不破坏既有单号** | 既有 6 种单据的单号格式与历史值不得改变 |
| 5 | **审计向后兼容** | `audit()` 签名扩展对既有调用点透明；8 个已冻结域的既有审计断言保持为绿 |
| 6 | **附件不写业务事实** | 附件是旁挂实体，不得承载金额、状态或来源语义 |
| 7 | **平台能力不得成为第二写入口** | 通用工作流的下推动作必须调用目标域的 canonical 创建入口 |
| 8 | **错误码不跨域耦合** | 平台域的错误码不得被业务域用作业务判断依据（AGENTS.md §6；`docs/decisions/cross-domain-error-code-policy-20261112.md`） |
| 9 | **权限 fail closed** | 新增权限码一律后端 fail closed；前端隐藏不等于授权 |
| 10 | **SOD 不改变无命中行为** | 无规则命中时既有族行为完全一致（§36.4） |

### 36.12 验收标准

#### 36.12.1 能力覆盖

- 21 项能力中 **19 项达到 `COVERED`**、**2 项经业务所有者批准为 `OUT_OF_SCOPE`**（PL-07、PL-08）。
  每项 `OUT_OF_SCOPE` 必须登记延期理由与重启条件。
  **计数口径（业务所有者 2026-11-14 裁定）**：以**能力逐项判定**为准 —— PL-06 与 PL-13 的
  「通用化增量 / 收敛增量」是这两项能力**内部**的范围边界（已批准延期），能力本身判定为
  `COVERED`（封顶）；它们连同 PL-07、PL-08 一并构成 **4 项 `OUT_OF_SCOPE` 范围项**，
  但不构成 4 项「未覆盖的能力」。
- 目标 `PARTIAL` **0** 项、目标 `MISSING` **0** 项。

#### 36.12.2 门禁

| 门禁 | 要求 |
|---|---|
| 单元 / 合同 / 集成测试 | 五个子系统各具备正例 + 至少一个反例的已注册测试；新增 `server/*.test.js` 必须登记进 `scripts/testing/test-suites.js`（FAST / FULL / HEAVY），否则 `validate()` 失败 |
| `pnpm test:fast` | 全绿 |
| `pnpm test`（FULL） | 全绿；**既有 8 域的断言不得因本域变更而回归** |
| `pnpm test:heavy` | 全绿 |
| `pnpm build` / `git diff --check` | 通过 |
| SQLite + MySQL 双路径 | 新增表与新列必须在两条路径上等价；MySQL 物理类型经 `resolveMySqlColumnType` 解析；DDL 不得置于 transaction 内 |
| 真实 MySQL 8 | 必须有本域专属的受保护 disposable MySQL campaign 证据（受保护入口限制见 `docs/decisions/mysql-evidence-policy-20261112.md`） |
| 浏览器 | 五个子系统的 operator 工作面在 390 CSS px 基线及 320 / 430 / 680 下成立；**必须有非空洞证据**（注入 token → reload → 断言目标屏真实渲染） |

#### 36.12.3 专项断言

1. 通用工作流：定义 → 发布 → 绑定 → 启动 → 任务 → 动作 → 完成全链路；暂停 / 恢复 / 终止 / 重新部署各一例；幂等启动一例；并发完成同一任务一例。
2. 既有 6 族审批断言**全部保持为绿**且结果不变。
3. SOD：生产订单自审批被拒一例；无规则命中的族行为不变一例；规则求值在事务内重读权威状态一例。
4. 组织：组织注册 → 作用域分配 → 被通用工作流按组织绑定命中一例；`accounting_scopes` 校验语义不变一例。
5. 附件：上传 → 挂载 → 下载 → 删除全链路一例；超限拒绝一例；类型 / 扩展名双重校验拒绝一例；下载鉴权拒绝一例。
6. 通知：六类生产者各一例；去重一例；未读计数与列表同源一例；徽标一例。
7. 编号：既有 6 种单据单号格式不变一例；并发同幂等键返回同号一例；分配在事务内一例；采购申请号删除后不冲突一例。
8. 审计：新增列被写入一例；既有 `audit()` 调用点不传新参数仍为绿一例；`auditBusinessRejection` 正例 + 反例各一例；历史行未被改写一例。

### 36.13 明确 `OUT_OF_SCOPE` 清单

| 项 | 理由 | 重启条件 |
|---|---|---|
| 既有 6 族迁移到通用工作流引擎 | `document.md §158`、`:573` 规定五族在 Generic Workflow 完成前保持 canonical；迁移需逐族重签验收 | 后续版本按族逐个立项 |
| PL-07 通用单据关系表 | 需先有通用转换与关系语义；`reversal` / `remaining` / `lineage` 三项属性无任何既有实现可迁移 | 与 PL-08 同批立项 |
| PL-08 通用 `Source → Rule → Target` 转换抽象 | 5 条域内转换线的语义差异需先逐条对齐 | 与 PL-07 同批立项 |
| PL-06 通用关系注册表 / 全实体可归档 | 涉及 25 个实体的归档语义逐个确认，且触碰已冻结域 | 后续版本按实体批次立项 |
| PL-13 期间控制收敛（三闸门归一 + 5 套存储合并） | 触碰已冻结的 Finance Operations / Accounting & Analytics 域的关期语义与断言 | 需对受影响域解冻后立项 |
| 编号对既有 6 种单据的组织分段 | 会改变既有单号格式 | 随多组织业务铺开立项 |
| 13 种以上未覆盖单据的编号迁移 | 触碰四个已冻结域的造号行为 | 随各域整改轮立项 |
| 凭证编号迁入编号服务 | `voucher_sequences` / `voucher_words` 为死表，迁移会改凭证号格式 | 随会计域整改立项 |
| 通知的邮件 / 短信 / 外部通道 | 需要外部服务凭据与投递策略，超出平台内部能力 | 需独立立项与外部服务授权 |
| SOD 的"要求第二人复核"处置 | 需要复核任务模型与升级策略 | 随通用工作流引擎成熟后立项 |
| 多组织业务数据隔离（业务表 `org_id` 铺开） | `solution.md §20.7` 要求加法式逐域迁移，不一次性铺开 | 随各域整改逐域立项 |

### 36.14 未解决事项

| ID | 事项 | 状态 |
|---|---|---|
| `PL-OPEN-01` | 审计 schema 升级影响 Finance Operations 已签发的验收证据当前有效性，须按 AGENTS.md §4.6 复核并在域级 Acceptance 中登记类别 | 待 Acceptance 轮复核 |
| `PL-OPEN-02` | 附件最大 10 MB 的独立上限配置项需与运维手册 `docs/operations/` 对齐 | 待 Implementation 阶段落配置与文档 |
| `PL-OPEN-03` | 通用工作流"业务回调"跨域调用允许的域集合与调用契约细则 | 待 Design 阶段明确；Requirement 只约束"必须走被调域 canonical API" |
| `PL-OPEN-04` | 编号服务迁移既有 6 种单据时的 MySQL 并发窗口（旧 `mysql-worker.js:138-151` 的 upsert + 分离 SELECT）需在新服务中原子化 | 待 Design 阶段明确 |

### 36.15 PL-13 期间控制一致性修订（`APPROVED`，2026-11-14）

#### 36.15.1 修订身份与生效边界

| 项 | 内容 |
|---|---|
| 用途 | 消除 Platform 验收残余 R-02 / `PL-DEF-08` / `PL-DEF-09`，防止已关闭期间继续发生不符合预期的经济 mutation |
| Owner | Platform（统一守卫合同）+ Inventory & Warehouse / Finance Operations / Accounting & Analytics（各自期间轴业务语义） |
| 状态 | `APPROVED`；业务所有者 2026-11-14 批准正文并授权 Design，Implementation / Acceptance 未授权 |
| 权威来源 | `document.md` §7.10、§17、§22 与本文件 §36；域内细则分别见 §32.12、§33.51、§35.11 |
| Supersession | 获批后仅取代 §36.2、§36.10、§36.13 中“PL-13 收敛增量 `OUT_OF_SCOPE` / 继续延期”的当前口径；不改写 2026-11-14 Platform Freeze 的历史事实 |

#### 36.15.2 独立期间轴与权威事实

系统必须保留以下相互独立的期间轴，不得以“统一”为名合并业务含义：

1. `INVENTORY`：库存数量、追踪身份、库存估值及其相关 mutation 的库存期间；
2. `LEGAL_ACCOUNTING`：凭证、GL、法定会计事件与法定财务报表的会计期间；
3. `FINANCE_AR` / `FINANCE_AP` / `FINANCE_TREASURY`：三个彼此独立的 Finance Operations 业务日期关闭轴；
4. `OPERATING(managementBookId)`：按经营账簿隔离的经营会计期间。

`period_end_definitions` / `period_end_runs` / `profit_transfer_runs` 是期末处理与关账前置证据，
不是新的期间状态权威；关闭历史表与反结账历史表是证据，不得被当作当前状态 owner。

#### 36.15.3 单一期间守卫合同

- 全仓库只允许一个 active canonical **期间守卫入口**。调用方提交：权威业务日期、业务动作标识、
  明确的适用期间轴集合，以及适用时的经营账簿标识；调用方不得直接读取期间表自行判断。
- 业务日期必须是日历有效的 ISO `YYYY-MM-DD`；缺失、格式错误、无效日期、未知期间轴、缺少必需
  账簿标识、权威状态缺失或损坏时全部 fail closed。
- 多轴动作取各轴约束的**并集**：任一适用轴关闭即拒绝。拒绝必须发生在任何经济副作用之前，
  返回可定位的阻断轴、业务日期和关闭边界；失败副作用必须为零。
- 守卫必须在 mutation 的同一数据库事务内重读并锁定权威状态；关闭／反关闭命令必须锁定同一权威
  对象。并发结果只能是“mutation 先完成并被关闭快照／检查纳入”或“关闭先完成、mutation 被拒绝”。
- 现有 `assertFinancialPeriodsOpen`、`assertInventoryPeriodOpen`、`checkPeriodNotClosedForVoucher`
  的生产调用必须收敛到该入口；不得保留第二套可执行判定语义。
- 期间错误码属于生产域内部错误，不得成为跨域业务判断合同；跨域只依赖统一的成功／拒绝语义和
  结构化阻断轴。

#### 36.15.4 动作到期间轴的最低映射

| 动作类别 | 必须评估的期间轴 |
|---|---|
| 库存数量／身份／估值 mutation，以及同时生成库存相关凭证的动作 | `INVENTORY + LEGAL_ACCOUNTING` |
| 手工凭证、系统凭证、会计事件生成、冲销、补记、更正 | `LEGAL_ACCOUNTING` |
| AR 确认、调整、折让、冲销、核销、转移、坏账及退款的 AR 侧 | `FINANCE_AR + LEGAL_ACCOUNTING` |
| AP 确认、调整、折让、冲销、核销、转移、付款及退款的 AP 侧 | `FINANCE_AP + LEGAL_ACCOUNTING` |
| 资金收付、账户移动、内部转账、退款的资金侧 | `FINANCE_TREASURY + LEGAL_ACCOUNTING` |
| 同时影响多个 Finance 事实的动作 | 上述所有受影响 Finance 轴 + `LEGAL_ACCOUNTING` |
| 经营台账归集、经营分摊、内部结算及其他改变经营期间结果的动作 | `OPERATING(managementBookId)`；法定期间已关闭是其来源前提，不得反向阻断经营关账前的受控归集 |
| 纯 GL 期末调整／损益结转 | `LEGAL_ACCOUNTING`；仅经明确登记的动作可跳过 `INVENTORY`，不得接受通用布尔绕过 |

所有有业务日期且可能改变经济事实的 mutation 必须进入可审计的覆盖登记；新增动作未声明期间轴时，
测试与发布门禁必须 fail closed。

#### 36.15.5 关闭与反关闭顺序

- 正向顺序：库存期间和三个 Finance 业务轴先完成各自关闭 → 法定会计期间关闭 → 各经营账簿期间关闭。
- 法定会计期间只能按连续顺序关闭；存在更早开放期间时不得跳期关闭。反结账只能从最新已关闭期间
  逆序执行，且必须先重开所有依赖该法定期间的已关闭经营账簿期间。
- 法定会计期间关闭前，`INVENTORY` 必须关闭至期间末，`FINANCE_AR` / `FINANCE_AP` /
  `FINANCE_TREASURY` 必须分别关闭至期间末；缺一即拒绝。
- `FINANCE_AR` / `FINANCE_AP` / `FINANCE_TREASURY` 彼此独立，任一关闭不得隐式关闭另外两个。
- 经营期间关闭后，归集、分摊、内部结算及其他会改变该账簿该期间结果的写入必须拒绝；受控重开后
  方可恢复。经营重开不得隐式重开法定会计期间。
- 关闭、反关闭、失败的关键 mutation 尝试均须留下可定位证据；不得在被回滚的业务事务中丢失拒绝证据。

#### 36.15.6 Operator、权限与验收

- 各期间轴必须有权限受控的状态、关闭、反关闭和历史证据面；Finance 业务关账不得只有只读状态卡。
- 后端权限必须 fail closed；前端隐藏不构成授权。反关闭必须强制原因并写审计。
- 期间工作面在 320 / 390 / 430 / 680 CSS px 下必须可完成核心任务，不依赖永久横向页面滚动。
- 验收必须至少覆盖：关闭缺口、跳期关闭、逆序反关闭、无效日期、缺失权威状态、多轴组合、折让确认／
  冲销、经营归集／分摊、纯 GL 期末例外、失败零副作用，以及 SQLite / MySQL 等价。
- 真实 MySQL 必须覆盖法定会计关闭 vs 凭证／AR/AP mutation、库存关闭 vs 库存 mutation、经营关闭 vs
  归集／分摊的并发；测试必须调用真实 canonical handler，不得用直接插入关闭行替代关闭命令。
- 若关闭与 mutation 均成功，证据必须证明 mutation 先提交且被关闭检查／快照纳入；仅断言“两者均可成功”
  不构成并发正确性证据。

### 36.16 Release Infrastructure 有界增补（`APPROVED`，2026-11-14）

#### 36.16.1 身份、授权与生效边界

| 项 | 内容 |
|---|---|
| 用途 | 闭合 2026-11-14 Release Readiness Audit 中除 Manual Capability Closure / 九域 Release Readiness 签发以外的 P0 / P1 基础设施缺口 |
| Owner | Platform；MySQL DR 运行证据由 Operations 共同维护；库存业务语义不在本节，另见 Sales & Customer 的 `W10-INV-RISK-01` 独立候审 Requirement |
| 状态 | `APPROVED`；业务所有者于 2026-11-14 批准本正文并授权进入 Design；Implementation / 数据库操作 / 发布仍未授权 |
| 权威来源 | `document.md` §17、§22.22；本文件 §36；`docs/status/PROJECT_STATUS.md` §62、§64；`docs/operations/deployment.md` |
| Supersession | 获批后仅对 Platform Freeze 做有界增补，不改写既有 21 项能力及其 Freeze 历史；用户明确排除 Manual Capability Closure 与九域 Release Readiness 签发，不得借本节恢复该项 |

本增补包含六个独立但共同服务于发布基础设施的合同项：

1. `PL-RI-01` MySQL 生产备份、异机副本与恢复演练；
2. `PL-RI-02` SQLite migration fail-closed；
3. `PL-RI-03` 生产依赖安全与构建依赖分层；
4. `PL-RI-04` 当前 canonical 浏览器验收门禁；
5. `PL-RI-05` 目标环境 TLS / Nginx / systemd / 防火墙 / 回滚证据；
6. `PL-RI-06` append-only 历史文档的可审计纠错与 current 门禁真实性。

#### 36.16.2 `PL-RI-01` MySQL 生产备份与恢复

业务所有者已在 `PROJECT_STATUS.md` §62 裁定 `DR-01..DR-05`，本候审 Requirement 将其转为合同：

- **RPO = 24 小时**：至少每日一次完整逻辑数据备份；本轮不引入 binlog / PITR。
- **RTO = 4 小时**：从宣布恢复到应用 `ready` 恢复为成功的总时间不得超过 4 小时。
- **异机副本 = S3 兼容对象存储**：endpoint、bucket、region 与凭据仅由环境变量或受保护凭据载体注入；不得写入仓库、日志或验收附件。
- **演练频率**：每季度至少一次，且每次发布前必须在隔离目标执行一次恢复演练；证据进入 `docs/acceptance/`，但不得包含密码、连接串或对象存储密钥。
- **备份内容**：逻辑备份必须覆盖全部业务数据、视图与 trigger 所需定义证据；恢复链路可以由应用 bootstrap 重建 schema，但必须验证恢复后的表、行数、关键约束、视图、trigger 与应用健康状态。不得仅以 `mysqldump` 退出码作为成功证明。
- **一致性**：备份必须取得一致快照；备份文件必须非空，具有 SHA-256，上传后必须回读并复核哈希。
- **保留与清理**：至少保留最近 30 个每日副本和满足季度/发布前演练追溯所需的演练源副本；清理只能删除已超过保留期且存在已验证异机副本的对象。
- **恢复安全**：恢复默认 fail closed，必须显式确认目标为 disposable 演练库或已批准的生产恢复窗口；不得提供模糊目标、默认库名、通配清理或自动覆盖生产库的入口。
- **迁移回滚**：发布前备份是 migration 的前置条件；migration 失败时停止启动，通过恢复链路回到发布前快照，不实施未经批准的反向破坏性 DDL。
- **双端工具边界**：现有 SQLite backup / restore 保持原语义；MySQL 使用独立入口与独立 systemd timer/service，二者不得根据环境变量静默互相替代。

验收必须至少证明：备份、S3 上传与回读、空/损坏备份拒绝、错误目标拒绝、全新隔离 MySQL 恢复、完整性校验、应用 live/ready、RPO/RTO 计时、清理保留策略及秘密零泄漏。真实 MySQL 与对象存储演练属于独立高风险操作，仍须逐次明确授权。

#### 36.16.3 `PL-RI-02` SQLite migration fail-closed

- SQLite 是受支持的本地 / 测试兼容后端，初始化与升级不得吞掉未知 DDL / DML 错误后继续启动。
- “列已存在”等预期幂等情况必须通过 schema inspection 或对明确、窄化的错误类别判断处理；禁止 `catch {}`、空 catch 或仅 `console.error` 后继续。
- 每个 migration 单元必须具备明确的开始、成功、失败边界；失败时后续 migration、seed 与服务监听均不得发生。
- 表重建必须处于可回滚事务或等价原子边界；失败不得留下 `_new` 表、半复制数据或已删除旧表。
- 错误输出必须包含 migration 标识与安全诊断，不得包含数据库密码或敏感连接信息。
- 兼容验收覆盖 fresh、upgrade、replay、非重复列故障注入、写入失败、表重建中断与重启重试；必须证明未知错误向上传播且应用拒绝进入 ready。

#### 36.16.4 `PL-RI-03` 生产依赖安全与构建依赖分层

- 发布候选必须使用 npm 官方 advisory 数据源或组织批准且实现兼容 audit API 的镜像执行依赖审计；镜像不支持 audit 时必须明确失败，不得记录为 PASS。
- production dependency graph 不得存在未处置的 `high` / `critical` 公告。`moderate` / `low` 必须记录可达性、生产暴露面与处置决定；不得仅因“通常是开发工具”而静默忽略。
- Vite、React build plugin 等只在构建 / 测试执行且不被 `node server/index.js` 运行时加载的包，应归入 `devDependencies`；运行时依赖必须保持最小集合。
- 本轮已知最低处置基线：Vite 必须升级到不受 `<=7.3.6` 公告影响的版本；`source-map-js` 必须解析到 `>=1.2.2`。实际 Implementation 仍须以执行时官方 advisory 为准，不得把版本号写死为永久豁免。
- 依赖升级不得降低测试、删断言或改变业务合同；必须重跑 FULL、HEAVY、build、依赖审计与生产启动 smoke。
- `packageManager` 必须固定受支持的 pnpm 版本，部署仍使用 `--frozen-lockfile`。

#### 36.16.5 `PL-RI-04` canonical 浏览器门禁

- 通用发布门禁必须从 `src/navigation/applicationRegistry.js` 取得 route key、权限 exposure 与当前移动端 tab，不得在脚本内维护已退役 route / 文案的第二份清单。
- 基线尺寸为 390 CSS px，并覆盖 320 / 430 / 680；桌面补充宽度可以保留，但不得替代 mobile-first 四档。
- 至少覆盖 admin、sales、reviewer、warehouse、accounting 五类 canonical 角色；每类必须验证 launcher 可见性、direct URL / refresh、权限拒绝、无整页横向滚动、关键控件触控高度与浏览器错误。
- 测试 fixture 必须符合当前 SOD：建单人与审批人分离。因正确的 SOD 409 导致 fixture 无法造数属于门禁漂移，必须修 fixture，不得放宽生产 SOD。
- 通知与流程任务徽标请求必须遵守 route permission exposure；无 `NOTIFICATION_VIEW` / `WORKFLOW_TASK_VIEW` 的用户不得产生预期外 403。后端继续 fail closed，前端隐藏不得替代授权。
- 门禁必须区分产品失败、fixture 失败和合同漂移；任何一类失败均返回非零，报告不得把被终止或只跑部分尺寸写成 PASS。
- Finance、Sales、Accounting、Manufacturing 等域级脚本可作为 focused 证据，但不能替代统一 canonical 门禁。

#### 36.16.6 `PL-RI-05` 目标环境发布证据

- 仓库只提供模板，不得仅凭模板存在宣称目标环境就绪。每个目标环境必须记录不可伪造的 preflight：目标 commit/tag、Node/pnpm/MySQL/Nginx/systemd 版本、环境变量名称集合、持久化目录、备份点和回滚入口。
- 公网生产必须启用 HTTPS；HTTP 仅允许重定向到 HTTPS。证书链、域名匹配、续期机制与到期监控必须实测。
- 只开放批准的 HTTP/HTTPS 与运维入口；应用端口 3001、MySQL 端口和对象存储凭据不得直接暴露公网。防火墙与云安全组均须留证。
- 必须在目标机执行 `nginx -t`、`systemd-analyze verify`、服务启动/重启、live/ready、静态资源、API、上传上限与真实客户端 IP 传递 smoke。
- 必须执行一次可恢复的 rollback rehearsal：回到上一 release artifact 与发布前数据库快照，并证明服务恢复；不得移动或重建既有 Git release tag。
- 目标环境证据缺失时，仓库本地门禁通过也只能标记 `PARTIAL`，不得宣称 production deploy ready。

#### 36.16.7 `PL-RI-06` append-only 文档纠错与 current 门禁

- `log/YYYY-MM-DD.md` 保持 append-only；发现历史断链时不得改写、删除或伪造原行。
- 必须提供显式纠错登记：原文件、原行内容或稳定锚点、错误目标、正确目标、登记时间与 Owner。解析器只可对已登记的精确错误应用纠错，不得建立通配忽略。
- N1 的报告必须同时显示原始断链与纠错登记命中；未登记断链继续 fail closed。纠错登记本身的目标也必须可达。
- `PROJECT_STATUS.md` 中“门禁已通过 / 已具备部署条件”等当前陈述必须以现场重跑结果为准；当前门禁失败时，较早的 PASS 只能作为历史证据，不得继续充当 HEAD 状态。
- 本轮已知断链 `log/2026-11-14.md:1387 → ../../docs/status/PROJECT_STATUS.md` 必须按上述机制纠正，不得回写该日志行。

#### 36.16.8 验收、兼容与禁止事项

验收门禁至少包括：focused tests、`pnpm test`、`pnpm test:heavy`、`pnpm build`、`git diff --check`、两种文档一致性模式、依赖 audit、canonical 浏览器四档、MySQL DR 隔离演练与目标环境 preflight。Acceptance 必须逐项声明哪些是本地证据、哪些是真实 MySQL / S3 / 目标主机证据。

兼容要求：不改变九域业务语义、API 业务合同、schema 业务事实、权限结果或既有 tag；SQLite 工具继续只处理 SQLite；生产服务仍由 Node HTTP + Nginx + systemd 承载。

禁止事项：不得把 Manual Capability Closure 或九域 Release Readiness 签发重新纳入本轮；不得记录或提交 secret；不得在普通测试中连接 MySQL；不得为通过 audit 使用 `skip`、删断言、忽略 high/critical、把 build dependency 伪装成运行依赖，或把历史日志改写为“从未出错”。

**Requirement status：`APPROVED`（2026-11-14）。Design 已授权；Implementation、数据库操作、发布与部署均未授权。**

### 36.17 Migration 风险工作包（`PENDING_APPROVAL`，2026-11-15；同日经业务所有者技术复核修订五项）

> **修订记录（2026-11-15，业务所有者技术复核）**：本节初稿提交于 `3ea41af`。业务所有者技术复核提出五项问题，
> 经在 HEAD 上逐项实测确认后修订，**合同项 `PL-MG-01..04` 的范围与验收口径不变**，修订集中在事实基线与判定口径：
> ① 事实基线补入 `server/db.js` 的既有表重建与重复命名原语（原 §36.17.2 缺项）；
> ② `runMigrationStep` 调用点实测计数由 6 处更正为 **7 处**（原 §32.17.2 记「6 处」）；
> ③ 窄化 catch 的错误类别补入**机器可判定面**（`node:sqlite` 的 `errcode` / MySQL 的 `ER_DUP_ENTRY`），
> 明确既有 `isUniqueConstraintError` 先例在 `node:sqlite` 下恒不命中、不得直接复制；
> ④ 恢复态发现改为**模式发现**，禁止固定临时表名的人工名单；
> ⑤ 守卫判定改为**逐站点**、索引比对覆盖 **fresh / upgrade 两条独立路径**，并要求负控与变异实验证明非空洞。
>
> **修订记录（2026-11-15，业务所有者退回后的第二轮对抗性复核）**：业务所有者**暂不批准**本节与 Design §32.17，
> 要求继续修订上述五项。第二轮复核在 HEAD 上逐条重放全部事实断言，得出并修正了以下**五处**问题
> （合同项范围与口径仍不变，只加严事实取证与可重放性）：
> 1. **计数错误**：§36.17.3 初稿把 `server/db.js` 非迁移路径的 `SWALLOWED` 记为 **8 处**，实测为 **7 处**
>    （另有 3 处 `NARROW_RETHROW`）；且初稿只要求「登记」而未实际登记 —— 现已逐行列出。
> 2. **取证方式缺失**：B 类「7 个文件均未使用显式事务」缺取证方式；现补逐文件核对结论
>    （`runMigrationStep` 均为 0；`inventory-position-schema.js` 的 3 处 `BEGIN` 全在触发器体内）。
> 3. **扫描口径的穷尽性未声明**：现补「全仓无 `_tmp` / `_bak` / `_old` 等其它临时表命名模式」，
>    因此 G-1 当前是穷尽的；将来新增模式必须同步扩展 G-1。
> 4. **E-3 归属不可复核**：现补 7 处 db.js 重建站点各自所属的 `runMigrationStep` step。
> 5. **G-3 的夹具来源未定义**：仓库内**不存在** legacy 数据库二进制夹具；现明确 upgrade 路径的「既有库」
>    必须以脚本构造（范式取自 `server/db-migration-fail-closed.test.js:224`），且夹具必须与判定同批提交、可独立重放；
>    并新增「每条事实断言都必须给出取证方式、可被第三方重放」的通用条款。

#### 36.17.1 身份、授权与生效边界

| 项 | 内容 |
|---|---|
| 用途 | 闭合 2026-11-15 阶段 III 收口登记的三项 migration 风险：吞错 catch 站点、非事务固定 `_new` 表重建、表重建导致的索引丢失；把 §36.16.3 已有的 migration fail-closed 禁止条款，从 `server/db.js` 扩展到全部 `server/migrations/**` canonical 迁移文件 |
| Owner | Platform（迁移执行器与 `server/migrations/**` 的 canonical owner）。Inventory & Warehouse、Manufacturing & Quality、Procurement & Outsourcing、Sales & Customer 仅作为受影响 schema 事实的来源方，其既有 owner、业务语义与能力矩阵状态均不变 |
| 状态 | `PENDING_APPROVAL`；业务所有者于 2026-11-15 授权本节 Requirement 与 Design 连续撰写，Design 完成后 HARD STOP。Implementation、数据库操作、发布与部署**均未授权** |
| 权威来源 | `document.md` §17、§22.22；本文件 §36.16（`PL-RI-02`）；`docs/status/PROJECT_STATUS.md` §65；`log/2026-11-15.md` 阶段 III「未解决矛盾」第 2、3、4 条 |
| Supersession | 本节只**增补** §36.16.3 的适用范围，不改写 §36.16 已批准结论，也不改写任何已冻结的历史记录 |

本节包含四个独立但共同服务于「迁移失败必须可诊断、不得静默、不得破坏既有数据」的合同项：
`PL-MG-01` 吞错 catch 消除；`PL-MG-02` 表重建原子化；`PL-MG-03` 索引保全；`PL-MG-04` 机器可验证守卫与双后端等价。

#### 36.17.2 事实基线（2026-11-15 实测清单）

基线由既有守卫 `node scripts/qa/verify-migration-fail-closed.mjs` 与一次全新 SQLite 初始化实测得出，是本节的唯一事实来源。

**A 类 —— `server/migrations/**` 内吞错 catch 站点：10 处 / 8 个文件**（Requirement §36.16.3 的禁止条款已覆盖这些站点；但 Design §32.16.2 把 SQLite migration 原语的 owner 限定为 `server/db.js`，§32.16.4.4 只概括授权「用宽泛 catch 继续启动的升级段逐项迁入 runner」，未列明 `server/migrations/**` 的具体站点、表重建原子化与索引保全要求）：

| # | 位置 | 现状 |
|---|---|---|
| A-1 | `inventory-position-schema.js:45` | `safeCreateIndex` catch-all |
| A-2 | `inventory-position-schema.js:271` | `upd.run` catch-all 后改写 key 重试 |
| A-3 | `procurement-outsourcing-opening-schema.js:62` | `safeIndex` catch-all |
| A-4 | `sales-customer-wave6-returns.js:192` | `dropMySqlConstraintIfExists` catch-all |
| A-5 | `v13-phase1-contracts.js:125` | `addColumn` catch-all |
| A-6 | `v13-phase2-source-integrity.js:12` | `addColumn` catch-all |
| A-7 | `v13-phase3-quality-gates.js:10` | `addColumn` catch-all |
| A-8 | `v13-phase6b-traceability-quality.js:5` | `add` catch-all |
| A-9 | `v14-out-procurement-final-acceptance.js:14` | `safeAddColumn` catch-all |
| A-10 | `v14-out-procurement-final-acceptance.js:18` | `safeIndex` catch-all |

**B 类 —— 固定 `_new` 表名且无事务边界的表重建：10 处 / 7 个文件**（实测计数为 10；`log/2026-11-15.md` 第 3 条写「8 处」但列出 10 个位置，本节以实测为准并保留原日志行不改写）：

| # | 位置 | 临时表 | 前置无条件 DROP |
|---|---|---|---|
| B-1 | `inventory-position-schema.js:298` | `inventory_new` | 无 |
| B-2 | `manufacturing-quality-schema.js:35` | `production_orders_new` | `:33` 有 |
| B-3 | `manufacturing-quality-schema.js:92` | `production_order_operations_new` | `:90` 有 |
| B-4 | `procurement-outsourcing-opening-schema.js:162` | `outsourcing_wip_identity_effects_new` | 无 |
| B-5 | `sales-customer-wave11-credit-evaluation-result-application.js:108` | `credit_profile_ratings_new` | 无 |
| B-6 | `sales-customer-wave6-returns.js:231` | `sales_order_replacements_new` | 无 |
| B-7 | `v14-out-procurement-final-acceptance.js:34` | `planning_outsource_handoffs_new` | 无 |
| B-8 | `v14-out-procurement-final-acceptance.js:95` | `logistics_quality_policy_snapshots_new` | 无 |
| B-9 | `v23-manufacturing-quality-closure.js:48` | `production_order_operations_v23_new` | `:46` 有 |
| B-10 | `v23-manufacturing-quality-closure.js:116` | `production_inspections_v23_new` | `:114` 有 |

实测（2026-11-15 第二轮逐文件复核）：以上 7 个文件中 `runMigrationStep` 出现次数均为 **0**；
`inventory-position-schema.js` 中另有 3 处 `BEGIN` 字样（`:171`、`:191`、`:195`），逐处核对确认**全部位于
`CREATE TRIGGER` 的触发器体内**（`BEGIN … END;`），**不是**事务语句；其余 6 个文件无任何事务关键字。
即 create → copy → drop → rename 全程不在原子边界内。

**临时表命名模式的穷尽性（2026-11-15 第二轮复核）**：全量扫描 `server/migrations/**` 的
`CREATE TABLE` 语句，除上表的 `_new` 模式外，**不存在** `_tmp` / `_bak` / `_old` / `_copy` / `_backup` /
`_staging` 等其它临时表命名模式。因此 §36.17.6 的 G-1（扫描 `CREATE TABLE …_new`）在当前代码库上是
**穷尽**的；若将来引入新的临时表命名模式，G-1 必须同步扩展，否则新增模式会静默逃逸出守卫。

**C 类 —— 表重建导致的索引丢失：3 个索引**（全新初始化实测，第二次启动才补齐）：

| 索引 | 所在表 | 创建方 | 被谁删除 |
|---|---|---|---|
| `idx_po_instruction` | `production_orders` | `v13-phase4-production-integrity.js:26` | B-2 重建，未重建 |
| `idx_po_instruction_item` | `production_orders` | `v13-phase4-production-integrity.js:27` | B-2 重建，未重建 |
| `idx_production_inspections_operation` | `production_inspections` | `manufacturing-quality-schema.js:279` | B-10 重建，未重建 |

该缺口随 SQLite 快照派生路径传播：`captureSqliteSnapshot` 使用与生产同一条 `createSqliteDatabase` 迁移链，`planMySqlIndexReconciliation` 只按快照补索引，因此快照缺失的索引在 MySQL bootstrap 后同样缺失。真实 MySQL 侧证据须在获授权的 ACK-4 campaign 中取得，本节不据此宣称 MySQL 已受影响。

**D 类 —— 由 B 类推导出的数据丢失路径（本节新增风险认定）**：非事务重建在 `DROP 旧表` 与 `RENAME` 之间失败时，旧表已不存在、数据只存在于临时表。下一次启动的行为按站点分为四种，**严重度依次递减**：

| 形态 | 站点 | 失效序列 | 后果 |
|---|---|---|---|
| **静默销毁型** | B-2 `production_orders` | 基础 `migrate()` 以旧形态重建**空** `production_orders` → 守卫判定不成立 → `DROP TABLE IF EXISTS production_orders_new` 丢弃唯一副本 → `INSERT … SELECT` 从空表复制 → **迁移成功** | **数据永久消失，应用正常启动，无任何报错** |
| **销毁后失败型** | B-3 `production_order_operations` | 正式表缺失时守卫不提前返回 → `DROP TABLE IF EXISTS production_order_operations_new` 丢弃副本 → 随后的 `INSERT … FROM production_order_operations` 因源表缺失失败 | 数据丢失**且**应用拒绝启动 |
| **失败但保留副本型** | B-1 `inventory`、B-4 `outsourcing_wip_identity_effects`、B-5 `credit_profile_ratings`、B-6 `sales_order_replacements`、B-7 `planning_outsource_handoffs`、B-8 `logistics_quality_policy_snapshots` | 重建因「临时表已存在」或「源表缺失」失败 | 应用拒绝启动，但数据副本仍留在临时表中，可人工恢复 |
| **孤儿型** | B-9 `production_order_operations_v23_new`、B-10 `production_inspections_v23_new` | inspect 守卫在正式表缺失时提前返回 | 正式表持续缺失、临时表成为孤立副本；应用不可用，数据需人工恢复 |

D 类是本工作包的**首要风险**：B-2 的失效路径在既有代码下**既不报错也不阻断启动**，属于静默数据丢失。所有 A / B / C 类收敛必须以 D 类不再成立为验收目标。

**E 类 —— `server/db.js` 的既有表重建与重复命名原语（2026-11-15 技术复核补入）**：本节初稿只把
`server/migrations/**` 作为扫描域，遗漏了 `server/db.js` 内**已存在**的表重建实现与临时表命名原语。实测：

| # | 位置 | 现状 |
|---|---|---|
| E-1 | `server/db.js:506` | 局部 `uniqueTempTable(table)` 定义**第 1 份** |
| E-2 | `server/db.js:858` | 局部 `uniqueTempTable(table)` 定义**第 2 份**（与 E-1 实现相同，各自独立定义） |
| E-3 | `server/db.js:517`、`:564`、`:635`、`:904`、`:947`、`:998`、`:1050` | **7 处**表重建站点；逐站点核对归属：`517` 属 `:511` 的 step、`564` 属 `:553`、`635` 属 `:613`、`904` / `947` / `:998` / `:1050` 属 `:890`（`tempTables` 映射）——全部位于 `runMigrationStep` 的事务边界内（`suspendForeignKeys: true`），**已是原子重建**，但临时表命名依赖 E-1 / E-2 的局部实现 |
| E-4 | `server/db.js` 的 `runMigrationStep` 调用点 | 实测 **7 处**（`:486`、`:511`、`:553`、`:613`、`:782`、`:890`、`:2799`）——本节初稿在 Design §32.17.2 记为「6 处」，计数有误，以本行为准 |

E 类**不是新增数据丢失风险**（db.js 的 7 处重建已在原子边界内），而是**原语归属缺口**：仓库内当前存在
**两份**同名同实现的临时表命名原语，且它们与 `server/migrations/**` 的 10 处固定 `_new` 重建**互不相干**。
若不把 E 类纳入本工作包，表重建将在「迁移层」与「启动层」各留一套实现，AGENTS.md §6
「同一业务原语只允许一个 active canonical implementation」在迁移链路上无法成立。因此本工作包必须同时收敛 E 类。

#### 36.17.3 `PL-MG-01` 吞错 catch 必须消除

- `server/migrations/**` 内不得存在 catch-all、空 catch、仅注释后继续、或仅 `console.error` 后继续的站点。
- 「预期幂等」（列已存在、索引已存在）必须通过 **schema inspection** 判定，不得依赖错误文本匹配或捕获后忽略。
- 允许的窄化 catch 只有一种形态：错误类别被**显式枚举**，且该类别之外的一切错误一律向上传播并带上 migration 标识与安全诊断。错误文本匹配仅可用于区分**同一错误类别内部**的变体，不得用于判定「这一整类错误都可以忽略」。
- **窄化 catch 的错误类别必须由机器可判定特征判定，并逐方言写明**（2026-11-15 技术复核补入）：
  - SQLite（`node:sqlite`）：判定面是 `errcode` —— `2067` = `SQLITE_CONSTRAINT_UNIQUE`、`1555` = `SQLITE_CONSTRAINT_PRIMARYKEY`、`1` = `SQLITE_ERROR`（duplicate column 等）。**不得**依赖 `error.code`（`node:sqlite` 恒为 `ERR_SQLITE_ERROR`）或 `error.errno`（`node:sqlite` 不提供该字段）；
  - MySQL：判定面是 `error.code === 'ER_DUP_ENTRY'` / `errno === 1062`（唯一冲突）、`ER_CANT_DROP_FIELD_OR_KEY`（约束不存在）。
  - 仓库既有先例 `server/modules/sales-orders.js:27` 与 `server/modules/outsourcing-finance.js:958` 的 `isUniqueConstraintError` 先查 `error.code === 'SQLITE_CONSTRAINT_UNIQUE'` / `error.errno === 19`，在 `node:sqlite` 下**恒不命中**，实际只靠 message 正则兜底 —— **不得**作为本工作包的判定实现直接复制或照搬。
- 错误输出不得包含数据库密码、连接串、token 或业务数据。
- 已有守卫 `scripts/qa/verify-migration-fail-closed.mjs` 的「范围外待处理」计数必须归零；该计数归零后，守卫不得因此失效，而应扩展为覆盖 `server/migrations/**` 全域的常驻守卫。
- **归零口径的边界**：本条只覆盖 `server/migrations/**`（迁移链）。守卫「非迁移路径（`server/db.js` 其余部分）」段共列 **10 个** catch 站点，其中 **7 处 `SWALLOWED`**、3 处 `NARROW_RETHROW`。**这 7 处 `SWALLOWED` 不在本工作包范围内，其处置在此显式登记为「范围外 · 未处置」**：

  | 位置 | 形态 | 处置 |
  |---|---|---|
  | `server/db.js:2123` | `catch (_) {}` | 范围外 · 未处置 |
  | `server/db.js:2180` | `catch (_) {}` | 范围外 · 未处置 |
  | `server/db.js:2512` | `catch (error) {}` | 范围外 · 未处置 |
  | `server/db.js:2594` | `catch (error) {}` | 范围外 · 未处置 |
  | `server/db.js:2655` | `.catch(() => {})` | 范围外 · 未处置 |
  | `server/db.js:2672` | `catch (error) {}` | 范围外 · 未处置 |
  | `server/db.js:2747` | `catch (error) {}` | 范围外 · 未处置 |

  （2026-11-15 第二轮复核更正：本节初稿记为「8 处 `SWALLOWED`」，实测为 **7 处**；另有 3 处
  `NARROW_RETHROW`（`:826`、`:2703`、`:2771`）不属吞错。）
  「迁移域归零」**不得**被解释为「`server/db.js` 已无吞错站点」；这 7 处必须另立有界工作包处置。

#### 36.17.4 `PL-MG-02` 表重建必须原子且可恢复

- 表重建必须处于事务或等价原子边界内；失败时不得留下临时表残留、半复制数据或已删除的旧表。
- 重建必须使用**运行内唯一**的临时表名，或使用保留命名空间并显式判定其归属；不得再以固定表名配合无条件 `DROP TABLE IF EXISTS` 的方式清理上次残留。
- 迁移启动时必须显式判定「旧表缺失但临时表存在」的恢复态，并**完成**该次交换，不得丢弃承载数据的临时表。
- 外键强制必须在原子边界之外按需关闭、在边界结束后立即恢复；失败路径同样必须恢复，不得让连接停留在外键关闭状态。
- **重建单元必须运行在顶层事务**：外键窗口只能由拥有事务的迁移执行器在 `BEGIN` 之前开启（SQLite 的 `PRAGMA foreign_keys` 在事务内不生效）。重建单元若被嵌套在外层事务内，外键窗口**必须 fail closed 拒绝**，不得在未关闭外键强制的情况下继续执行 `DROP`。
  （2026-11-15 第二轮复核：迁移链是 `server/db.js` 中一串**顶层** `migrate*(db)` 调用（`:701`–`:706` 等），
  不在任何事务内；`transaction()` 仅用于运行期（`:2659`）。因此本条的 fail closed **不会打断既有迁移链**。）
- **表重建原语与临时表命名必须是仓库内唯一实现**：`server/db.js` 现存的两份局部命名原语（`:506`、`:858`，见 E-1 / E-2）必须收敛为一份，并与 `server/migrations/**` 共用；不得出现第三份命名实现，也不得让迁移层与启动层各自持有一套重建原语。
- **恢复态发现必须是模式发现，不得使用固定名称清单**（2026-11-15 技术复核补入）：遗留临时表必须按重建临时表的命名模式从 `sqlite_master` 查询得到。固定名称清单**无法**覆盖运行内唯一命名的残留（如 db.js 的 `<table>_new_<uuid>`），且清单本身会成为第二份需要人工同步的迁移知识。
- 行数与内容不变量必须在切换前证明；重建前后行数不一致时必须失败，不得以部分数据继续启动。

#### 36.17.5 `PL-MG-03` 索引保全

- 任何表重建都不得删除目标表上已有的索引；若重建后的目标形态与重建前不一致，必须显式重建全部应存在的索引。
- 每张被重建的表都必须有一份**权威索引清单**，重建后必须逐项核对；缺项即失败。
- 全新初始化后的 schema 索引集合必须与既有库升级后的索引集合一致；「全新初始化缺索引、第二次启动才补齐」的状态不得继续存在。

#### 36.17.6 `PL-MG-04` 机器可验证守卫与双后端等价

- 必须提供机器可验证的守卫，至少覆盖：吞错 catch 计数、非事务固定 `_new` 表重建计数、重建后索引缺失计数；三项均须为 0 才可判定通过。
- **判定必须是逐站点的，不得以文件级推断代替**（2026-11-15 技术复核补入）：同一文件内可能既有位于迁移执行器内的站点、也有位于执行器外的站点；以「该文件是否使用了执行器」推断原子性会产生假 PASS。
- **索引集合比对必须覆盖两条独立路径**（同上）：
  - **fresh 路径**：全新初始化后的索引集合 vs 同一库第二次启动后的索引集合；
  - **upgrade 路径**：既有库（legacy 形态）升级后的索引集合 vs 同一库第二次启动后的索引集合。
  只比对「同一库建两次快照」只覆盖第二条路径，**不能**证明「全新初始化缺索引、第二次启动才补齐」这一状态已消除。
- **每项判定必须有非空洞证明**：至少包含一条负控（人为注入违规必须转红）与一条变异实验记录（改动实现后判定必须转红），否则判定不得作为通过依据。
- **索引集合比对的夹具来源必须显式定义**：仓库内**不存在** legacy 数据库二进制夹具（无 `server/fixtures/`、
  无提交的 `.db` 文件）。upgrade 路径的「既有库」必须**以脚本构造**，不得依赖不存在的二进制；
  构造范式以既有 PL-RI-02 focused 测试 `server/db-migration-fail-closed.test.js:224`（legacy 形态库 +
  真实数据 + 升级后数据完整保留）为基准，并按被重建表的全集扩展。夹具脚本必须与判定同批提交，
  判定结果必须可由该脚本独立重放。
- **事实基线的每一条断言都必须可被独立复核重放**：计数、行号、归属关系必须给出**取证方式**
  （扫描命令 / 逐文件核对结论），使第三方能够在同一 HEAD 上重放并得到相同结论；
  「实测」二字本身不构成证据。
- 守卫必须给出**逐条位置**的清单，计数变化必须可定位到具体文件与行。
- 临时表命名原语的**唯一性**也必须可判定：仓库内存在的临时表命名实现数必须为 1；遗留孤儿临时表残留数必须为 0。
- SQLite 与 MySQL 的迁移语义必须保持等价：MySQL 侧不执行 SQLite 专用 DDL，MySQL schema 由 SQLite 快照派生；快照缺索引不得被当作「目标库本来就没有」。
- 真实 MySQL 证据仍属受保护 campaign；本地 SQLite 证据不得被表述为 MySQL 证据。

#### 36.17.7 验收、兼容与禁止事项

验收门禁至少包括：focused 迁移测试（fresh / upgrade / replay / 未知 DDL / 复制中断 / 校验失败 / 重启重试）、`scripts/qa/verify-migration-fail-closed.mjs` 归零、新增守卫判定归零（吞错 catch / 逐站点非原子重建 / 重建后索引缺失 / 临时表命名原语唯一性 / 遗留孤儿残留）、`pnpm test`、`pnpm test:heavy`、`pnpm build`、`git diff --check`、两种文档一致性模式。

兼容要求：不改变九域业务语义、API 业务合同、业务 schema 事实、权限结果、单据状态机、金额单位与既有 tag；**不得新增业务表、业务列、CHECK 约束或数据回填**；历史行内容不得被改写；MySQL 侧 DDL 语义不变。

禁止事项：不得以 `catch` 改名、注释化或 `try {} catch {}` 形式保留吞错；不得用 `skip`、删断言或放宽门禁制造绿色；不得把「第二次启动补齐」当作幂等证明；不得在普通测试中连接 MySQL；不得在本轮顺带修改任何业务 schema、权限或状态机；不得把未取得的真实 MySQL 证据写成已通过；**不得**以文件级推断代替逐站点判定；**不得**以固定名称清单代替恢复态的模式发现；**不得**复制 `isUniqueConstraintError` 既有先例的错误字段判定写法；**不得**新建第二份临时表命名或表重建实现。

**Requirement status：`PENDING_APPROVAL`（2026-11-15）。Design 已获授权并连续执行；Implementation、数据库操作、发布与部署均未授权。**

### 36.18 Route 首屏 API 授权一致性通用合同（`APPROVED`，2026-11-15）

> **授权来源**：业务所有者于 2026-11-15 的一次性指令「复核整个系统、修复存在的阻塞、达到可发布的状态」。
> 该指令一次性授权 AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION 的连续执行（AGENTS.md §4.0）；
> **未**授权 push / tag / merge / release / deploy、数据库破坏性操作、真实 MySQL campaign 与任何 Acceptance / Freeze 签发。

#### 36.18.1 身份、Owner 与生效边界

| 项 | 内容 |
|---|---|
| 用途 | 把「route 声明的 exposure 权限集合未覆盖该页面自身依赖的 API 权限集合」这一**已在三个业务域各自暴露**的缺陷形态，从域级一次性修补升级为**平台级通用合同** + 机器可验证守卫 |
| Owner | Platform（`src/navigation/applicationRegistry.js` 的 route exposure 合同与跨域前端授权原语的 canonical owner）。各业务域仍是各自页面与业务语义的 owner |
| 状态 | `APPROVED`（2026-11-15）；Design §32.18 同日 `APPROVED`；Implementation 已授权，范围仅限 §36.18.5 所列仓库内代码、测试与脚本 |
| 权威来源 | `document.md` §17、§22.22；本文件 §36.16.5（`PL-RI-04` canonical 浏览器门禁）；`docs/status/PROJECT_STATUS.md` §66.2、§66.4 第 3 条、§67.4、§67.6 第 1/2/5 条 |
| Supersession | 本节**不改写** §36.16、§36.17，也不改写 Manufacturing & Quality §29.11 与 Sales & Customer §34.16 的已批准结论；本节记录的是这两个域级包**之后**发现的第三个域实例与平台级归因 |

#### 36.18.2 事实基线（2026-11-15 在 HEAD `6272337` 上实测，非引用既有结论）

**枚举方法**：93 条 canonical route × 5 类 canonical 角色，每条 route 由该角色可见时执行
「direct URL → **完整 reload** → 等待 networkidle」，逐条记录全部 `/api/` 响应状态。
该方法与 canonical 浏览器门禁的判定面一致，但**对每个 (角色, route) 做隔离 reload**，
因此不继承门禁「hash 跳转 + Back/Forward 造成失败清单随运行时序漂移」的已知缺陷
（`PROJECT_STATUS.md` §65.4 第 2 条、§67.6 第 2 条）。枚举共覆盖 **202** 个 (角色, route) 组合。

**枚举结论（穷尽）**：全部 202 个组合中，**首屏出现非预期 4xx/5xx 的组合只有一个**：

| 角色 | route | 403 的 API | 后端守卫（实测行号） | 角色实测权限 |
|---|---|---|---|---|
| `role-reviewer` | `inventory` | `GET /api/inventory-stock-statuses` | `allowAny(['STOCK_STATUS_VIEW','STOCK_STATUS_MANAGE'])`（`server/modules/stock-status.js:28`） | 两者皆无 |
| `role-reviewer` | `inventory` | `GET /api/warehouse-bins` | `allowAny(['WAREHOUSE_BIN_VIEW','WAREHOUSE_BIN_MANAGE'])`（`server/modules/warehouse-bin.js:25`） | 两者皆无 |

其余 201 个组合**首屏 0 个非预期 4xx/5xx**，且**无浏览器控制台错误**。据此确认：

- §67.4 已实施的两个域级包**当前有效**：`manufacturing-analytics`（accounting × 4 档）与
  `sales-price-override-authorizations`（sales / reviewer）不再产生首屏 403；
- `inventory` 是该缺陷形态在**第三个业务域**的实例，根因与前两处**同形**：
  `src/pages/inventory-work.jsx:172`–`:183` 的 `useInventoryReferences` **无条件**加载 4 个参照端点，
  而 `inventory` route 的 exposure 只有 `any:['INVENTORY_VIEW']`
  （`src/navigation/applicationRegistry.js:43`）；
  `role-reviewer` 持有 `INVENTORY_VIEW` 但不持有上述 2 组守卫（`server/db.js:2046`）。

**平台级归因**：route 的 exposure 与页面自身的 API 依赖之间**没有合同**，因此每个域各自踩坑 ——
Manufacturing & Quality（§29.11）、Sales & Customer（§34.16）、Inventory & Warehouse（本节实例）。
在平台级合同缺位的前提下，「修一个域」不能保证「下一个域不复发」。

#### 36.18.3 合同项 `PL-EXPOSURE-01..07`

- **`PL-EXPOSURE-01`（首屏 API 依赖必须登记）**：每条 canonical route 在**首屏**加载的 API 依赖，
  及其所要求的权限，必须在代码中以**单一事实来源**登记。页面不得自行维护第二份端点清单，
  不得发出未登记的首屏请求。
- **`PL-EXPOSURE-02`（登记必须与后端实际守卫逐项一致）**：登记的权限集合必须等于**后端 handler 内的实际守卫**，
  由机器从服务端源码解析核对，**不得**手抄、不得凭前端推断。任一条不一致即判定失败。
- **`PL-EXPOSURE-03`（逐角色包含性）**：对每一类 canonical 角色，若该角色**可见**某条 route，
  则该 route 的首屏请求集合必须**完全落在**该角色的可读端点集合内。
  「先发请求、后被后端拒绝」即判定失败 —— **前端隐藏不构成授权**，后端继续 fail closed。
- **`PL-EXPOSURE-04`（exposure 语义不变）**：修法**不得**默认采用「收紧 route exposure」，
  因为它改变权限结果（可见入口减少），属业务所有者的独立裁定。
  本合同沿用 `SC-EXPOSURE-05` 的既定口径（`PROJECT_STATUS.md` §67.3）：**页面按 actor 权限自适应，
  后端守卫与 route exposure 语义不变**。收紧 exposure 仍是开放业务决定，登记于
  `docs/decisions/OPEN-BUSINESS-DECISIONS.md`，**不**在本合同内自行吸收。
- **`PL-EXPOSURE-05`（无权态与空态必须可区分）**：actor 无权读取某个依赖时，页面必须呈现**明确的无权态**，
  **不得**把它渲染成「没有可选数据」；一个依赖都无权时必须 **fail closed**（不发任何请求）。
- **`PL-EXPOSURE-06`（缺陷清单必须来自可复跑的穷尽枚举）**：判定「该缺陷形态是否已消除」必须依据
  **可复跑的穷尽枚举**（每个 (角色, route) 隔离 reload），**不得**以单次浏览器门禁的 FAIL 列表作为
  穷尽证据；枚举必须输出 (角色, route, 端点, 状态) 四元组，且可被第三方在同 HEAD 上重放得到相同结论。
- **`PL-EXPOSURE-07`（门禁不得自我豁免）**：任何「预期外 403」**不得**进入门禁 allowlist；
  `NOTIFICATION_VIEW` / `WORKFLOW_TASK_VIEW` 一类的徽标请求已按 `PL-RI-04` 由 route exposure 前置，
  不得以「徽标例外」放宽本节判定。

#### 36.18.4 与既有合同的关系

| 既有合同 | 关系 |
|---|---|
| `PL-RI-04`（§36.16.5）canonical 浏览器门禁 | **仍然有效且仍是发布门禁**。本节只补「缺陷清单必须来自穷尽枚举」的取证口径，不改变门禁的判定面 |
| §36.16.5 徽标条款 | **未改写**。`src/App.jsx` 的通知 / 流程待办徽标已按 route exposure 前置，本节不涉及 |
| Manufacturing & Quality §29.11（`MQ-EXPOSURE-01..05`） | **未改写**。其页签登记仍由 `src/lib/manufacturingAnalyticsTabs.js` 持有；本节要求该登记同时满足 `PL-EXPOSURE-02` 与 `PL-EXPOSURE-03` |
| Sales & Customer §34.16（`SC-EXPOSURE-01..05`） | **未改写**。其参照登记仍由 `src/lib/salesPriceOverrideReferences.js` 持有；同上 |
| `SC-EXPOSURE-05`（收紧 exposure 的开放决定） | **仍开放**，按 §36.18.3 的 `PL-EXPOSURE-04` 延期处理 |

#### 36.18.5 验收、兼容与禁止事项

**验收门禁**：

1. **穷尽枚举**：新增的可复跑枚举入口对 93 条 route × 5 类 canonical 角色输出
   「首屏非预期 4xx/5xx 组合数 = 0」，且**首屏控制台错误数 = 0**。
2. **平台级 focused 守卫**：对**全部**已登记 route，逐条断言
   ① 登记的权限集合 == 后端实际守卫（`PL-EXPOSURE-02`）；
   ② 对每一类 canonical 角色（取自**真实种子库**的 `role_permissions`，不是手抄名单），
   若角色可见该 route，则该 route 的首屏依赖全部可读（`PL-EXPOSURE-03`）；
   ③ 页面**不得**自带第二份端点清单（登记处之外的字面量调用即失败）。
3. **canonical 浏览器门禁**：`node scripts/acceptance/release-browser-readiness.mjs` 返回退出码 0，
   且 `PRODUCT_FAILURE` / `FIXTURE_FAILURE` / `CONTRACT_DRIFT` 三类均为 0。
4. **变异实验（证明断言承重、非空洞）**：至少三条 —— ① 把某页的首屏默认依赖改回固定项 → 必须转红；
   ② 取消按权限过滤 → 必须转红；   ③ 篡改登记中的权限码 → 必须转红。
5. `pnpm test:fast`、`pnpm test`、`pnpm test:heavy`、`pnpm build`、`git diff --check`、
   两种文档一致性模式（current / migration）。

**兼容要求**：不改变任何角色的权限集合与 `role_permissions`；不新增、不删除权限码；
不改变 route 数量与 route key；不改变任何 API 的请求 / 响应合同与权限判定；
不改变单据状态机、金额与估值语义、业务 schema、既有 release tag。

**禁止事项**：不得以 allowlist / 白名单把 403 放进门禁豁免项；不得放宽后端 API 守卫；
不得新增权限码或修改 role 种子；不得以「收紧 exposure」作为默认修法；
不得把前端隐藏当作授权实现；不得在登记缺项时以「登记不全」为由豁免判定；
不得把一次浏览器门禁的 FAIL 列表写成「缺陷已穷尽枚举」；不得把未取得的真实 MySQL 证据写成已通过。

**Requirement 状态：`APPROVED`（2026-11-15）。Design §32.18：`APPROVED`（同日）。
Implementation：已授权（2026-11-15），范围仅限本节验收门禁所列的仓库内代码、测试与脚本；
真实 MySQL 连接、数据库操作、Acceptance / Freeze 签发、发布与部署**未授权**。**

### 36.19 导航分组完整性与界面语言一致性通用合同（`APPROVED`，2026-11-17）

> **授权来源**：业务所有者于 2026-11-17 的指令「admin 缺少了系统设置 → 用户与权限 → 用户管理 → 新增用户，
> 无法新增用户；前后端还存在中英文混用的情况，请做一次修整」。
> 该指令一次性授权 AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION 的连续执行（AGENTS.md §4.0）；
> **未**授权 push / tag / merge / release / deploy、数据库操作、真实 MySQL campaign
> 与任何 Acceptance / Freeze / Release Readiness 签发。
> 业务所有者同日就四件事作出决定：①「系统设置」分组取 **8 条配置类入口**；
> ②中英文混用按**全量**修整；③阶段授权为 Requirement → Design → Implementation 连续执行；
> ④腾讯云部署**单独授权**，本轮只交付部署执行清单。

#### 36.19.1 身份、Owner 与生效边界

| 项 | 内容 |
|---|---|
| 用途 | 把「route 存在但没有任何用户界面入口」与「最终用户界面出现英文」这两类**跨域缺陷形态**，从一次性点修补升级为**平台级通用合同** + 机器可验证守卫 |
| Owner | Platform（`src/navigation/applicationRegistry.js` 的 route / 导航分组合同与最终用户界面文案语言的 canonical owner）。各业务域仍是各自页面与业务语义的 owner |
| 状态 | `APPROVED`（2026-11-17）；Design §32.19 同日 `APPROVED`；Implementation 已授权，范围仅限 §36.19.5 所列仓库内代码、测试与脚本 |
| 权威来源 | `document.md` §17、§22.22；本文件 §36.16.5（`PL-RI-04` canonical 浏览器门禁）、§36.18（`PL-EXPOSURE-01..07`）；`docs/status/PROJECT_STATUS.md` §68、§69 |
| Supersession | 本节**不改写** §36.16、§36.17、§36.18 的已批准结论；它**显式修订** V1.6 P1B 遗留的「启动器只承载八个业务域、Platform / utility 分组不得出现」这一历史产品决定 —— 见 §36.19.3 第 3 条 |

#### 36.19.2 事实基线（2026-11-17 在 HEAD `a12d127` 上实测，非引用既有结论）

**基线一：route 可达性缺口。** 93 条 canonical route 中，**51 条**在启动器分组内有条目；
**10 条**在「启动器条目 / 底部页签 / 父路由声明 / 页面内导航链接」四条可达路径上**全部落空**，
即**只能靠手敲 URL 打开**：

| 域 | 四路径全落空的 route |
|---|---|
| Platform | `workflow-designer`、`workflow-bindings`、`workflow-monitor`、`organizations`、`numbering`、`sod-rules`、`lifecycle`（7 条） |
| Manufacturing & Quality | `quality-control-points`（1 条） |
| Accounting & Analytics | `product-costs`、`cost-rates`（2 条） |

另有 1 条 `users`（用户与权限）在页面内出现过，但只出现在工作台快捷入口候选表里 —— 它排在
第 **13** 位而该表只保留前 **6** 位，因此**实际同样不可达**。
**合计 11 条 route 在最终用户界面上没有任何可达入口**。

作为对照，`manufacturing-analytics`（生产执行分析）**不算**缺口：它由
`src/pages/business-overview.jsx` 的业务总览流程节点直接链接（`step(..., 'manufacturing-analytics')`）。

**基线二：admin 的「新增用户」路径实测断裂。** `admin` 具备 `USERS_MANAGE` / `ROLES_MANAGE`
（真实种子库共 266 项权限），`POST /api/users` 返回 **201**，`#users` 页面的「新增用户」按钮存在且可见；
但启动器中 `v16-launcher-tile-users` **不存在**、页面文本中「系统设置」**不存在**。
**结论**：断裂点不在权限、不在页面、不在后端，而在**导航分组缺失**。

**基线三：回归来源可精确定位。** 启动器分组的历史形态是 6 个业务组 + 5 个 utility 折叠区，
其中 `utility-system`（**系统设置**）承载 `users`（用户与权限）。
commit `c77616b`（2026-10-06，「refactor: 收敛ERP八域与平台架构」）删除了全部 utility 分组
（含 `utility-system`）、把 8 个分组标题由**中文**（`基础资料` / `销售管理` / `生产管理` / `采购管理` /
`库存管理` / `决策报表` / `业务流程` / `财务工具` / `高级设置` / `系统设置`）改为**英文域名**
（`Master & Engineering` / `Sales & Customer` / …），并**在同一提交内**新增测试
「does not expose Platform or legacy utility groups as business domains」把「Platform 不进启动器」
锁成不变量。随后 2026-11-13 的 Platform 域闭合新增的 9 条 Platform route **从未**获得任何启动器条目。
**两个用户报告的缺陷形态同源于此一次重构。**

**基线四：界面语言缺口。** 穷尽扫描 `src/`（81 个文件）与 `server/`：

| 位置 | 用户可见英文条数 | 代表形态 |
|---|---|---|
| 前端 `src/` | **131** | 启动器 8 个英文分组标题；`PLANNING CONTROL` / `WORKFLOW DESIGNER` / `INVOICE CONTROL` 等全大写眉标；`canonical` / `legacy` / `fail closed` / `override` / `Handoff` 等嵌在中文句子里的英文单词；`LINE` / `HEADER` / `BLOCK` / `WARNING` 等枚举选项 |
| 后端 `server/` | **172** | `HttpError(status, 'English message')` 与 `send(res, 4xx, { error: 'English' })`；经 `server/lib/http.js` 的 `serializeError` → 响应体 `message` → `src/api.js:60` → `src/lib/copy.js:37` 的 `return serverMessage` **原样透出**，中文兜底不覆盖 400 / 409 / 410 / 413 / 415 / 422 |

`src/navigation/domainMetadata.js` 早已保存中文 `navigationLabel`（`主数据与工程` / `销售与客户` / … /
`系统设置`），但启动器使用的是 registry 内另一份**硬编码英文**标签 —— 同一概念存在两份事实来源。

#### 36.19.3 合同项 `PL-NAVI-01..06`

- **`PL-NAVI-01`（域分组完整性）**：`APPLICATION_LAUNCHER_GROUPS` 必须覆盖
  `DOMAIN_DEFINITIONS`（8 业务域 + Platform）的**全部 9 个域**，每域**有且只有一个**分组。
  缺任一域即判定失败 —— 不得以「该域入口较少」为由豁免。
- **`PL-NAVI-02`（route 可达性）**：每条 **active** route 必须至少具备一条用户界面可达路径：
  ① 启动器分组条目；② 底部页签（`messages` / `approvals` / `workspace` / `workflow-tasks`）；
  ③ 父路由声明（`parentRoute`）；④ 页面内导航链接。
  路径 ④ 必须由**确定性**判据认定（`src/pages/**` 与 `src/components/**` 中的导航构造：
  `navigateToPage(` / `navigate(` / `hrefFor(` / `canNavigate(` / `page:` / `page=` /
  `routeKey:` / 业务总览 `step()` 的第三参数），**不得**用「页面上出现过这个字符串」这类宽判据。
  四条路径全部落空的 route **必须为空**；确属「仅直达 URL」的 route 必须进入守卫中的
  **显式登记清单**并附理由与真实链接来源，登记缺项即判定失败（**沉默的缺失一律失败**）。
- **`PL-NAVI-03`（分组名单源）**：启动器分组的 `label` 必须**等于**
  `DOMAIN_BY_KEY[group.key].navigationLabel`。registry **不得**再硬编码第二份域名称；
  英文 `label` 仅保留在 `domainMetadata.js` 作为领域标识符，不再进入用户界面。
- **`PL-NAVI-04`（分组标题语言）**：启动器分组标题必须是中文，**不得**出现 ASCII 字母。
- **`PL-NAVI-05`（入口与权限一致）**：新增入口**不得**放宽任何 route 的 exposure 权限集合，
  **不得**新增权限码、**不得**修改角色种子。入口的可见性继续由既有 route exposure 判定，
  后端继续 fail closed；**前端显示不等于授权**。
- **`PL-NAVI-06`（守卫必须可复跑）**：导航完整性判定必须来自**可复跑的确定性枚举**
  （从 registry 计算，而非单次浏览器门禁输出），并输出
  「不可达 route 清单」「缺分组域清单」「非中文分组标题清单」三张零结果清单。

#### 36.19.4 合同项 `PL-LANG-01..07`

- **`PL-LANG-01`（最终用户可见文案必须中文）**：`src/` 中所有最终用户可见文本
  （按钮、标题、页签、选项、占位符、空态、帮助、toast、页眉眉标、报表口径说明）必须为中文。
- **`PL-LANG-02`（后端用户可见消息必须中文）**：任何会进入 HTTP 响应 `message` / `error` /
  `details.resolution` 的业务消息必须为中文。§36.19.2 基线四列出的 **172** 条必须在本次修整中
  全部改写。**不得**改动 `details.code` / `details.reason` 等机器可读码、字段名、表名、
  SQL 标识符、audit 的 action / entity type —— 前端 `src/lib/copy.js` 与
  `scripts/qa/verify-error-code-coupling.mjs` 依赖这些码做分类与耦合校验。
- **`PL-LANG-03`（前端错误消息兜底）**：前端在展示服务端 `message` 前必须做中文兜底；
  **非中文**的 `serverMessage` **不得**原样透出。该兜底不得吞掉已有中文业务消息，
  也不得改变 HTTP 状态码到中文文案的既有映射（`src/lib/copy.js` 既有分支保持不变）。
- **`PL-LANG-04`（领域专名白名单）**：以下类别**允许保留**，且**必须**保持拼写一致：
  制造与财务缩写（`MRP` / `BOM` / `WIP` / `IQC` / `OQC` / `GRNI` / `LOT` / `SERIAL` /
  `UOM` / `ABC` / `GL` / `AR` / `AP` / `COGS` / `SKU` / `OEM` / `FIFO` / `LIFO` / `JSON` /
  `CSV` / `PDF` 等）；内部批次与条目编号（`Wave N` / `SC01` / `M&Q` / `PL` / `IW` 等）；
  权限码与枚举**取值**；产品名 `Modern ERP`。
  白名单之外的英文一律判定失败。
- **`PL-LANG-05`（枚举值展示）**：下拉选项等枚举**取值**保持英文（提交值不变），
  但**展示文本**必须为中文标签。
- **`PL-LANG-06`（守卫）**：提供**机器可验证入口**扫描 `src/` 与 `server/` 的用户可见字符串，
  命中白名单之外的英文即失败并输出 `file:line` 与原文，供逐条修整与复核。
- **`PL-LANG-07`（守卫不得自我豁免）**：白名单必须**显式列举**、逐条可读，
  不得使用「忽略含字母的短串」之类的模糊规则；**不得**把白名单扩大为新的通配符。

#### 36.19.5 验收、兼容与禁止事项

**验收门禁**：

1. **导航可达性守卫**：不可达 route 清单 = 0；缺分组域清单 = 0；非中文分组标题清单 = 0。
2. **界面语言守卫**：`src/` 与 `server/` 的用户可见英文清单 = 0（白名单外）。
3. **既有门禁不回归**：`server/mobile-application-launcher.test.js` 的既有断言
   （角色 route 矩阵、禁用 route 不出现、内部流程流不作为主 tile）**保持通过**；
   被本节修订的「Platform 不进启动器」断言必须**显式改写并注明依据**，不得删除。
4. **canonical 浏览器门禁**：`node scripts/acceptance/release-browser-readiness.mjs` 返回退出码 0，
   `PRODUCT_FAILURE` / `FIXTURE_FAILURE` / `CONTRACT_DRIFT` 三类均为 0。
5. **变异实验（证明断言承重、非空洞）**：至少三条 ——
   ① 从 `APPLICATION_LAUNCHER_GROUPS` 删除 `platform` 分组 → 导航守卫必须转红；
   ② 把某个分组标题改回英文 → 导航守卫必须转红；
   ③ 在任一用户可见文案里写入一句英文 → 语言守卫必须转红。
6. `pnpm test:fast`、`pnpm test`、`pnpm test:heavy`、`pnpm build`、`git diff --check`、
   两种文档一致性模式（current / migration）。

**兼容要求**：不改变任何角色的权限集合与 `role_permissions`；不新增、不删除权限码；
不改变 route 数量与 route key；不改变任何 API 的请求 / 响应合同与权限判定；
不改变单据状态机、金额与估值语义、业务 schema、既有 release tag；
不改变九个业务域的启动器条目集合（只补 Platform 分组与 4 条被遗漏的既有条目）。

**禁止事项**：不得把「入口」实现为放宽 exposure 或新增权限码；
不得以 allowlist 掩盖 `PL-NAVI-02` 的不可达 route；
不得改动 `details.code` / `details.reason` 等机器可读码；
不得把领域专名白名单扩大为通配规则；
不得在修整中改动任何业务规则、状态机或审批语义；
不得把腾讯云部署或任何数据库操作纳入本节授权范围。

**Requirement 状态：`APPROVED`（2026-11-17）。Design §32.19：`APPROVED`（同日）。
Implementation：已授权（2026-11-17），范围仅限本节验收门禁所列的仓库内代码、测试与脚本；
腾讯云部署、数据库操作、Acceptance / Freeze / Release Readiness 签发、push / tag / merge / release
**均未授权**。**


### 36.20 MySQL 8 方言兼容与追踪估值一致性修复（`APPROVED`，2026-11-17）

> **授权来源**：业务所有者 2026-11-17「推进修复 D4 和 D5 也做 D5 按照你的推荐做」。
> 该指令授权对 §71 检出的缺陷做修复；腾讯云部署仍为**单独授权**事项。

#### 36.20.1 身份与边界

| 项 | 内容 |
|---|---|
| 用途 | 闭合 §71.5 检出的 MySQL 8 方言不兼容缺陷与追踪估值错配 |
| Owner | Platform（MySQL 适配器与翻译层）；Inventory & Warehouse（估值语义）；各受影响模块 Owner |
| 状态 | `APPROVED`（2026-11-17）；Design §32.20 同日 `APPROVED`；Implementation 已实施 |
| Supersession | 不改写 §71 的验收结论；不改写任何域级 Acceptance / Freeze |

#### 36.20.2 合同项

- **`PL-DDL-01`（运行时 DDL 形状翻译）**：运行自建表的 DDL 必须物化出与快照 bootstrap
  **同一份物理 schema**。MySQL 8 不接受 `TEXT` 参与键、不接受 `TEXT` 带默认值、
  不支持 `CREATE INDEX IF NOT EXISTS`。因此：
  ① 翻译层必须把参与键的 `TEXT` 译为 `VARCHAR(128)`、其余译为 `LONGTEXT`，
  并把 `LONGTEXT` 的字符串默认值写成表达式形式 `DEFAULT ('…')`；
  ② 索引的幂等创建必须显式做存在性检查（`information_schema`）后再建，
  不得依赖 `IF NOT EXISTS`。
- **`PL-DDL-02`（不得依赖 SQLite 伪列）**：`rowid` 是 SQLite 伪列，MySQL 无此列。
  需要稳定全序的表必须使用**两种方言都支持的**排序键（`created_at, id`），
  行值比较必须写成 `(a, b) > (?, ?)`。
- **`PL-GROUP-01`（聚合必须兼容 `ONLY_FULL_GROUP_BY`）**：带 `GROUP BY` 的查询，
  被选出的非分组列必须用聚合函数包裹，或来自函数依赖的主键。
- **`PL-VALUATION-01`（追踪策略与估值方法同源）**：财务估值方法由追踪策略唯一决定
  （`NONE→MOVING_AVERAGE`、`LOT→LOT_SPECIFIC_POOL`、`SERIAL→SPECIFIC_SERIAL`）。
  映射必须是**单一事实来源**；产品创建、追踪策略变更都必须按它写入 `valuation_method`，
  不得依赖列默认值。
- **`PL-VALUATION-02`（存量对齐必须幂等）**：已存在的错配行必须由一条幂等迁移按
  canonical 映射对齐，且**只动估值尚未激活**的行（估值已激活的货品其方法已冻结）。
- **`PL-EMPTY-01`（空结果不是崩溃理由）**：查询返回空集合时必须给出明确结论，
  不得因解引用空元素而抛出 500。

#### 36.20.3 验收门禁

1. 目标环境上 §71.5 列出的全部 500 端点返回 2xx（真实业务 id 与不存在 id 两种输入都要覆盖）。
2. `pnpm test:fast` 与受影响的 focused suite 全部通过。
3. 变异实验：把翻译层的 DDL 翻译关掉 → 500 复现；把 `PL-VALUATION-01` 的写入去掉 →
   新建 LOT 货品的估值方法再次错配。

**Requirement 状态：`APPROVED`（2026-11-17）。Implementation 已实施（部分）。**
