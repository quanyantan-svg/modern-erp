# Platform 平台层域级 Acceptance 与 Capability Freeze 记录（2026-11-14）

> **用途**：登记业务所有者对 Platform 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Platform 域业务所有者（Acceptance 与 Freeze 的**唯一**签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；**19 项 `COVERED` 能力已冻结**。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/platform.md`](../requirements/platform.md) §36；Design [`docs/design/platform.md`](../design/platform.md) §32；逐项审计台账 [`docs/audits/platform-capability-audit-20261113.md`](../audits/platform-capability-audit-20261113.md)；裁定记录 [`docs/decisions/platform-domain-closure-decisions-20261113.md`](../decisions/platform-domain-closure-decisions-20261113.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。
>
> **本记录取代**同目录的候签材料 [`platform-domain-acceptance-candidate-20261114.md`](./platform-domain-acceptance-candidate-20261114.md)（`PLATFORM_DOMAIN_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION`）；候签材料保留不删。

```text
PLATFORM_DOMAIN_ACCEPTANCE_PASS
PLATFORM_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在本轮对话中指示「现在进行域级 Acceptance 与 Capability Freeze」，并在呈报候签材料后**逐项裁定**（决定 `ACCEPT`）：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`PLATFORM_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 19 项 `COVERED` 能力**（`PLATFORM_CAPABILITY_FREEZE`） |
| 能力判定 | PL-01..PL-13 + WF-01..WF-08 共 **21 项**：`COVERED` **19**、`PARTIAL` **0**、`OUT_OF_SCOPE` **2**（PL-07、PL-08）、`MISSING` **0**（整改前 3 / 7 / 11） |
| **计数口径裁定** | 采用**能力口径 19 / 2**：PL-06 与 PL-13 的「通用化增量 / 收敛增量」是这两项能力**内部**的范围边界（已批准延期），能力本身判定为 `COVERED`（封顶）；`Requirement` §36.12.1 的算术表述按此口径更正（该节原写的 17 / 4 把两项**范围项**计入 `OUT_OF_SCOPE`，与 §36.2 的逐项判定表不能同时成立） |
| **残余处置裁定** | §6 的 **6 项有界残余随冻结接受**，书面理由见 §6；其中 R-01 / R-02 已由 Requirement §36.13 批准延期 |
| **历史记录复核裁定** | 接受本轮 §4 的逐条失效点登记：6 份受影响的已签发记录维持 `NEEDS_REVIEW`，引用时必须标注类别与具体失效点；**不撤销、不改写**任何已签发结论 |
| 实现锚点 | `a7def68`（专属 campaign 建成）、`8787a86`（SOD 规则维护面）、`5225428`（七个工作面 + 旧版审批流退役）、`e2763d5`（campaign 结果登记）、`96d6371`（附件前端挂载 + MIN_APPROVERS 合同修订）、`1ff47ee`（PL-06 补齐）、`6658e06`（PL-DEF-06 补齐；**campaign 通过的提交**） |

决定来源是当前对话中所有者的明确指令与逐项裁定；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：本域 Active Contract（Requirement §36 / Design §32）及其 19 项 `COVERED` 能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3101–B3122 手册级关闭）· Release Readiness · 发布 · 部署 · 真实环境 migration · 业务数据库写入 · 远端 Git 操作 · 其它域的 Acceptance。

## 2. 验收证据

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **774/774 PASS** |
| `pnpm test`（FULL） | **4020/4020 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 文档一致性 `check-doc-consistency.mjs --mode current --target HEAD` | **ALL CHECKS PASSED**（N1、N3～N6、N8、N9 PASS；N2 `RETIRED`；**N7 PASS**） |
| 跨域错误码守卫 `verify-error-code-coupling.mjs` | PASS（已登记 2 / 未登记 0 / 死引用 0） |
| 历史验收记录指针守卫 `verify-acceptance-records.mjs` | PASS（78 份记录，`BROKEN` 0） |
| 域级合同套件（10 份） | **144 例全部 PASS**，全部为 **class A（新合同通过）** —— 无 class B（已知缺陷复现）用例 |
| 浏览器 · 响应式 + 附件挂载全链路 | **40/40 PASS**（10 屏 × 4 档宽度 320 / 390 / 430 / 680） |

### 2.1 真实 MySQL 8.0.37 证据（本域专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `PLATFORM_MYSQL_V1`（`RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_PLATFORM_RACES` → `CLEANUP_SCHEMA_POST_RUN`） |
| 通过运行 | run `6a541150-6634-4005-adb2-22e694fb1e02`、commit `6658e06` |
| 结果 | **`RESULT = PASS`**；**`ACK-4 STATE = FINISHED`**（清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明） |
| 目标身份 | `modern_erp_domain_test` @ `127.0.0.1:3306`（MySQL **8.0.37**，serverUuid `256c7a4e-d275-11f1-885b-b025aa71d167`，grants sha256 `bef61617…807e`） |
| 运行前 / 运行后目标状态 | 均 `tables=0 views=0 triggers=0 routines=0 events=0`；身份与基线无漂移 |
| 竞态套件 | **4/4 PASS**：S1 职责分离拒绝的**事务外证据**（事务回滚后判定记录与审计行仍在）；S2 编号幂等并发返回同一单号（PL-DEF-12）；S3 通知去重只落一条；S4 平台 schema 形态（17 张新表 + `notifications` 6 列 + `audit_logs` 4 列） |
| 负控 | S1 另一主体审批同一工单**成功** · S2 不同幂等键拿到**不同**单号 · S3 不同去重键各落一条 |
| 全部运行 | 三次运行全部 PASS（`74b20bd2…` @ `a7def68`、`41f1a4f5…` @ `1ff47ee`、`6a541150…` @ `6658e06`），**无失败运行**；ACK-4 能力每次由业务所有者批准、由 `issue-mysql-ack4.ps1` 机械签发、一次性消费 |

### 2.2 浏览器证据（防空壳）

判定口径：屏根 canonical `data-testid` 已绘制 · 真实数据行或**指名原因的**显式空态 · 无权限拒绝态 / 错误态 ·
无横向溢出 · 全部可点目标两个轴均 ≥ 44 CSS px · 无控制台错误。

10 屏：职责分离规则 · 组织与作用域 · 编号规则 · 流程设计 · 流程绑定 · 我的流程任务 · 流程监控 ·
通知中心 · 生命周期与归档 · 销售订单详情（附件挂载点，**上传 → 列出 → 删除 → 回到显式空态**
全链路，API 轨迹 `POST 201 → GET 200 → POST delete 200 → GET 200`）。

### 2.3 本轮修复的真实缺陷（8 项）

| # | 缺陷 | 处置 |
|---|---|---|
| 1 | **生产订单自审批缺口**（`PL-DEF-01`） | 平台 SOD 层唯一把关；既有族的拒绝状态码与文案**逐字不变** |
| 2 | **拒绝证据随事务回滚消失** | 拒绝 / 升级证据改为**事务外**补写（HTTP 生命周期中央 catch，回滚之后） |
| 3 | **管理员权限被当作文档生命周期能力**（`PL-DEF-04`） | 新增 `LIFECYCLE_VIEW` / `LIFECYCLE_MANAGE`；`USERS_MANAGE` 保留为兼容别名 |
| 4 | **生命周期 operator 工作面不可达** | 迁移为启用路由 `lifecycle`，权限专化，读写分权 |
| 5 | **`auditBusinessRejection` 零测试覆盖**（`PL-DEF-06`） | 新增 7 例合同套件（正例 + 三类反例） |
| 6 | **编号三项缺陷**（`PL-DEF-11` / `12` / `13`） | 分配移入单据事务；同键并发返回**同一单号**；请购单号由服务发放 |
| 7 | **旧版审批流页面读取不存在的列且无 update 路由** | 页面与模块退役，`/api/workflows` 返回 410，`approval_workflows` 表保留为非权威 |
| 8 | **合同称「五审批族」，代码为 6 族 + 1 信用特批**（`PL-DEF-10`） | Requirement / Design 表述已校正 |

## 3. 跨域影响登记（AGENTS.md §4.6）

| 受影响域 | 触达内容 | 该域结论的处理 |
|---|---|---|
| **Manufacturing & Quality** | 生产工单审批新增平台层 SOD 闸门；`role-warehouse` 新增 `PRODUCTION_ORDERS_APPROVE`（`PL-DEC-04`） | 能力条数不受影响；其角色合同与审批路径的证据点已漂移 → 该域记录判 `NEEDS_REVIEW`（§4.1） |
| **Sales & Customer** | 销售订单详情页插入附件面板；既有族接入平台 SOD（既有防护之后，行为不变）；路由清单 85 → 93 | 能力判定不受影响；浏览器 88/88 证据所覆盖的详情页已漂移 → 判 `NEEDS_REVIEW` |
| **Planning / Accounting & Analytics / Inventory & Warehouse / Procurement & Outsourcing / Master & Engineering / Finance Operations** | 13 个前端合同测试文件的路由清单事实同步；`accounting.jsx` 与 `planning-documents.jsx` 插入附件面板 | 能力判定不受影响 → 判 `STILL_VALID`；会计与分析的浏览器证据判 `NEEDS_REVIEW` |
| **M1-Core（采购与委外包级）** | 套件清单新增 4 个平台套件；`server/app.js` 新增平台路由与 410 退役 | 七 Gate 结论不受影响 → 判 `STILL_VALID` |

## 4. 历史验收结论当前有效性复核（AGENTS.md §4.6）

**方法**：机器守卫 `verify-acceptance-records.mjs`（78 份记录，`BROKEN` 0；62 份 `NEEDS_REVIEW` 需人工复核）
＋ 本轮对**被 Platform 域提交改动过引用路径**的 **27 份**记录的逐份复核。其余 35 份由其它域的整改轮
改动，**不属于**本域复核范围，仍待各域自身的域级审计复核。

**结论**：**21 份 `STILL_VALID`**（可作为当前证据直接引用）＋ **6 份 `NEEDS_REVIEW`**。
未撤销、未改写任何已签发结论。

| 分类 | 份数 | 依据 |
|---|---|---|
| `STILL_VALID` | 21 | ① 引用路径只因平台侧**新增登记**而漂移（套件清单 / ACK-4 manifest / 启动器 / 权限目录 / `readMultipart` / campaign 操作名）—— 被引用的门禁、脚本与能力集合仍存在且仍成立；② 引用 `server/app.js` / `sales-orders.js` / `credit-special-approval.js` 的记录：平台 SOD 接线**置于既有自审批防护之后**（Design §32.4.3），既有族的允许 / 拒绝结果、状态码与文案逐字不变，由 `platform-sod-wiring.test.js`（17 例）逐字断言 |
| `NEEDS_REVIEW` | 6 | 见 §4.1；**引用时必须标注类别与具体失效点** |

### 4.1 判 `NEEDS_REVIEW` 的 6 份

| 记录 | 具体失效点 | 可否单独引用 |
|---|---|---|
| [`manufacturing-quality-domain-acceptance-20261112.md`](./manufacturing-quality-domain-acceptance-20261112.md) | 平台 SOD 接线改变**生产工单自审批**行为（允许 → 拒绝），`PL-DEC-04` 改变**角色合同**；该记录 43 项能力判定不受影响 | **否** —— 须引用本记录 §2.3 与 `platform-sod-wiring.test.js` |
| [`sales-customer-domain-acceptance-20261113.md`](./sales-customer-domain-acceptance-20261113.md) | 浏览器 **88/88** 证据所覆盖的**销售订单详情页**此后插入附件面板；路由清单由 85 变 93 | **否** —— 须引用本记录 §2.2 |
| [`sales-customer-domain-acceptance-candidate-20261113.md`](./sales-customer-domain-acceptance-candidate-20261113.md) | 同上（其 3881/3881 FULL 计数亦已过期） | **否** —— 同上 |
| [`accounting-analytics-domain-acceptance-20261111.md`](./accounting-analytics-domain-acceptance-20261111.md) | 浏览器 **6/6** 证据所覆盖的**会计凭证页**此后插入附件面板 | **否** —— 须引用本记录 §2.2 |
| [`accounting-analytics-domain-acceptance-candidate-20261111.md`](./accounting-analytics-domain-acceptance-candidate-20261111.md) | 同上（其 3695/3695 FULL 计数亦已过期） | **否** —— 同上 |
| [`acceptance-record-revalidation-20261112.md`](./acceptance-record-revalidation-20261112.md) | 其分类表是 **2026-11-12** 的快照；此后八域的域级验收与 Platform 域整改已逐条取代其中部分分类 | **否** —— 引用其中任一分类结论前须先按 §4 复核该条 |

## 5. 能力逐项判定（21 项）

判定依据：① 生产写 / 读入口具备来源、状态机、权限、事务约束；② **已注册**的可执行测试覆盖正例且至少一个反例；
③ 有 operator 可达的前端入口（或本身是纯只读读模型）；④ 事实进入业务路径。

| 能力 | 判定 | ① 入口 | ② 已注册测试 | ③ operator 入口 | ④ 事实入路径 |
|---|---|---|---|---|---|
| PL-01 Identity / RBAC | `COVERED`（封顶） | `users` / `roles` / `permissions` / `role_permissions` / `sessions`；`allow()` / `allowAny()` 唯一闸门 | `v2-wave3d-roles-ownership` / `v2-wave3e-users-ownership` | `users` | 是 |
| PL-02 SOD | `COVERED` | `server/modules/platform-sod.js`；8 条 `/api/platform/sod/*` | `platform-sod-rules`（20）+ `platform-sod-wiring`（17） | `sod-rules`（族覆盖 / 规则 / 升级待办 / 判定记录） | 是（7 个审批决策点） |
| PL-03 Organization Scope | `COVERED` | `server/modules/platform-organizations.js` | `platform-organizations`（12） | `organizations` | 是 |
| PL-04 Generic Workflow 引擎 | `COVERED` | `server/modules/platform-workflow-engine.js`；16 条 `/api/platform/workflow-*` | `platform-workflow-engine`（35） | 4 个工作面 | 是 |
| PL-05 Approval | `COVERED`（封顶） | 6 族 + 1 信用特批的既有 canonical handler（**未迁移**） | `mobile-approval-center` + `platform-sod-wiring` | `approvals`（既有） | 是 |
| PL-06 Document Lifecycle | `COVERED`（封顶） | `server/modules/lifecycle-engine.js`；6 条 `/api/lifecycle/*` | `platform-lifecycle`（8）+ `v12-lifecycle-foundation` | `lifecycle` | 是 |
| PL-07 Document Relation | `OUT_OF_SCOPE` | — | — | — | 延期理由与重启条件见 Requirement §36.13 |
| PL-08 Document Conversion | `OUT_OF_SCOPE` | — | — | — | 同上 |
| PL-09 Numbering | `COVERED` | `server/modules/platform-numbering.js`；3 条 | `platform-numbering`（12） | `numbering` | 是 |
| PL-10 Attachment | `COVERED` | `server/modules/platform-attachments.js`；4 条 | `platform-attachments`（13） | `AttachmentPanel` 挂载 7 个详情页 + 浏览器全链路 | 是 |
| PL-11 Notification | `COVERED` | `server/modules/platform-notifications.js`（六类生产者） | `platform-notifications`（11） | 通知中心 + messages 徽标 | 是 |
| PL-12 Audit | `COVERED`（封顶 + 增量） | `server/lib/audit.js` + `audit_logs` 加列 | `platform-audit-upgrade`（7，含 PL-DEF-06）+ `platform-domain-schema`（5） | —（纯读模型 + 领域内证据面） | 是 |
| PL-13 Period Control | `COVERED`（封顶） | 4 套既有期间存储 + `assertFinancialPeriodsOpen` | 既有域门禁（**无代码改动**） | 既有期间面 | 是 |
| WF-01 流程定义 | `COVERED` | `workflow_templates` / `workflow_template_versions` + 定义校验 | `platform-workflow-engine` | `workflow-designer` | 是 |
| WF-02 版本与发布 | `COVERED` | 发布 / 停用（已发布版本不可变） | `platform-workflow-engine` | `workflow-designer` | 是 |
| WF-03 业务模板绑定 | `COVERED` | `workflow_bindings` / `workflow_binding_history` | `platform-workflow-engine` | `workflow-bindings` | 是 |
| WF-04 流程实例 | `COVERED` | `workflow_instances`（幂等键唯一） | `platform-workflow-engine` | `workflow-monitor` | 是 |
| WF-05 节点任务 | `COVERED` | `workflow_node_instances` / `workflow_tasks` | `platform-workflow-engine` | `workflow-tasks` | 是 |
| WF-06 业务动作 | `COVERED` | `workflow_action_logs` / `workflow_events` + 动作白名单 | `platform-workflow-engine` | `workflow-tasks`（6 种动作） | 是 |
| WF-07 监控 | `COVERED` | 实例列表 / 详情（节点 + 任务 + 事件） | `platform-workflow-engine` | `workflow-monitor` | 是 |
| WF-08 暂停 / 终止 / 恢复 | `COVERED` | 实例级控制 + 重新部署 | `platform-workflow-engine` | `workflow-monitor` | 是 |

## 6. 随冻结接受的有界残余（Owner 已裁定：随冻结接受）

| # | 残余 | 随冻结接受的理由 |
|---|---|---|
| R-01 | **PL-06 关系图仍是 30+ 处硬编码分支，25 个实体中只有 `PURCHASE_RECEIPT` 可归档** | 通用关系注册表与全实体可归档已由 Requirement §36.13 **批准延期**（理由与重启条件已登记）。本域交付的是**封顶**：既有关系图行为逐字不变，PL-06 的 operator 工作面与权限专化已补齐 |
| R-02 | **PL-13 的三个期间闸门并存、语义不一致**（`PL-DEF-08`）；两个既有期间表对 canonical 闸门不可见（`PL-DEF-09`） | 期间控制收敛已由 Requirement §36.13 **批准延期**；本轮**无代码改动**，四个既有期间存储与 `assertFinancialPeriodsOpen` 断言保持原样，收敛须触碰已冻结的财务与会计域 |
| R-03 | **通用工作流任务的 SOD 归因未登记** | 引擎按 `businessType='WORKFLOW_TASK'` 接线，但 initiator resolver 只覆盖 7 个族 → 该业务类型**不可配置规则**（fail closed）。该行为**不会**产生「拒绝一切却看不出原因」的规则；补 resolver 随通用工作流引擎的业务域接线轮立项 |
| R-04 | **通用工作流引擎没有对外的实例启动入口** | 「平台能力不得成为第二写入口」（Design §32.11 约束 #7）：实例由被调域的 canonical 入口启动。在业务域接线之前「流程监控」与「我的流程任务」恒为空态 —— 这是引擎的边界设计，不是缺陷 |
| R-05 | **逐列 schema parity 未在真实 MySQL 上取证** | 本域专属 campaign 证明 17 张新表与加列**被真实 MySQL 8 接受**并给出目录形态；逐列类型 / 索引 / CHECK 的逐项 parity 比对需另一次取证，Owner 裁定不阻塞本次冻结 |
| R-06 | **销售订单详情页「查看业务流程 ›」触控目标高 36 px** | 该页**既有**问题、非本域引入；本轮 UAT 已打印留痕并移交 Sales & Customer 域 |

> 上述 6 项按 Owner 裁定**随冻结接受**，理由如上；它们**不构成**「已证明」或「已消除」的声明，
> 在后续文档中不得被描述为已解决。

## 7. 未解决矛盾（冻结时的状态）

| # | 矛盾 | 冻结时的状态 |
|---|---|---|
| C-01 | **能力计数口径** | **已裁定**（能力口径 19 / 2），并据此更正 Requirement §36.12.1 的算术表述；本记录的 §5 与 Requirement 逐项判定表一致 |
| C-02 | **`MIN_APPROVERS` 判定方向**（Design §32.4.2 原文「< N → 不违规」与实现相反） | **已裁定并消解**（Owner 2026-11-14：以**实现方向**为 canonical —— 「已通过人数 < N 即违规」；本轮不可创建的原因是**求值点不存在**）。Requirement §36.4 与 Design §32.4.2 已按该口径修订，代码不变 |
| C-03 | **跨域证据漂移**（制造与质量、销售与客户、会计与分析三域的证据点） | **已裁定**：接受本轮 §4.1 的分类登记；已签发结论**不被撤销**，引用时按 §4.6 标注类别与具体失效点 |

## 8. 冻结后的剩余工作

- **Manual Closure**（B3101–B3122 手册级关闭）与 **Release Readiness**：**未签发**，属下一轮；
  22 本手册逐本决定。
- 上述 §6 的残余按 §6 的理由保持登记状态，不得在后续文档中被描述为已证明或已消除。
- 本域 5 份 `NEEDS_REVIEW` 引用的兄弟域证据点保持登记，待各域自身审计复核。

## 9. 未发生的事实声明

本记录中不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录：
ACK-4 能力由业务所有者在会话中批准、由 `scripts/gates/issue-mysql-ack4.ps1` 机械签发；
三次真实 MySQL 运行均由受保护启动器执行并留下消费标记；所有门禁数字均为本轮实测。
