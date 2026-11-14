# Platform 平台层域级 Acceptance 与 Capability Freeze 候签材料（2026-11-14）

> **用途**：登记 Platform 域**整域 Acceptance** 与 **Capability Freeze** 的候签证据、能力逐项判定、历史验收结论当前有效性复核、随冻结待裁定的残余与未解决矛盾，供业务所有者裁定并签发。
>
> **Owner**：Platform 域业务所有者（Acceptance 与 Freeze 的**唯一**签字人）；Platform / QA（证据维护）。
>
> **状态**：`PENDING_APPROVAL` —— **尚未签发**。本材料由实施方整理，**不代表**域级 Acceptance 已通过、
> 能力已冻结。签发记录见同目录下的 `platform-domain-acceptance-20261114.md`（若所有者裁定通过）。
>
> **权威来源**：Requirement [`docs/requirements/platform.md`](../requirements/platform.md) §36；
> Design [`docs/design/platform.md`](../design/platform.md) §32；逐项审计台账
> [`docs/audits/platform-capability-audit-20261113.md`](../audits/platform-capability-audit-20261113.md)；
> 裁定记录 [`docs/decisions/platform-domain-closure-decisions-20261113.md`](../decisions/platform-domain-closure-decisions-20261113.md)；
> 唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收与冻结**证据**，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、
> 远端同步、发布或部署。

```text
PLATFORM_DOMAIN_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION
```

## 1. 候签结论与待所有者裁定的决定项

### 1.1 能力判定（两种计数口径，见 §5.1）

| 口径 | `COVERED` | `PARTIAL` | `OUT_OF_SCOPE` | `MISSING` |
|---|---|---|---|---|
| **能力口径**（21 项能力逐项） | **19** | **0** | **2**（PL-07、PL-08） | **0** |
| **Requirement §36.12.1 口径**（把 PL-06 的通用化增量与 PL-13 的收敛增量计为 `OUT_OF_SCOPE` 范围项） | **17** | **0** | **4** | **0** |

整改前（审计台账 2026-11-13）：3 `COVERED` / 7 `PARTIAL` / 11 `MISSING`。

### 1.2 候签建议

| 项 | 候签建议（**待所有者裁定，本材料不构成决定**） |
|---|---|
| 域级 Acceptance | 建议**通过** |
| Capability Freeze | 建议**冻结** §5 表中判定为 `COVERED` 的能力 |
| 决定 | `ACCEPT_WITH_BOUNDED_RESIDUAL_RISK`（若所有者接受 §6 的残余）或 `ACCEPT`（若残余均被判定为不适用） |

### 1.3 需要所有者**逐项**裁定的事项

| # | 事项 | 备选 | 影响 |
|---|---|---|---|
| D-01 | **能力计数口径**（§5.1） | 能力口径 19 / 2，或 Requirement 口径 17 / 4 | 冻结声明里的能力条数；Requirement §36.12.1 的算术表述需随之更正或确认 |
| D-02 | §6 的 **6 项有界残余**逐项处置 | 逐项关闭 / 逐项接受（书面理由）/ 延期 | 见 §6；**任何一项都不在本材料中预判为「不阻塞」** |
| D-03 | §7 的 **3 项未解决矛盾** | 修订合同 / 接受 / 延期 | 其中 MIN_APPROVERS 的判定方向已由所有者裁定为「以实现方向为 canonical」，仅剩「是否追补 Requirement 表述」一项待确认 |
| D-04 | §4.3 的 **历史验收结论复核**：27 份记录中 6 份判为 `NEEDS_REVIEW` | 接受本轮复核结论 / 要求补跑对应域的浏览器证据 | 这些域的**已签发**结论本身不被撤销，但引用时须按 §4.6 标注类别 |
| D-05 | **Manual Closure 与 Release Readiness** | — | 本记录**不包含**这两项；22 本手册逐本决定属另一轮 |

## 2. 验收证据

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **774/774 PASS** |
| `pnpm test`（FULL） | **4020/4020 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| 文档一致性 `node scripts/docs/check-doc-consistency.mjs --mode current --target HEAD` | **ALL CHECKS PASSED**（N1、N3～N6、N8、N9 PASS；N2 `RETIRED`；**N7 PASS**） |
| 跨域错误码守卫 `node scripts/qa/verify-error-code-coupling.mjs` | PASS（已登记 2 / 未登记 0 / 死引用 0） |
| 历史验收记录指针守卫 `node scripts/qa/verify-acceptance-records.mjs` | PASS（记录 78 份：`BROKEN` 0；`NEEDS_REVIEW` 62 份需人工复核 —— 见 §4） |

### 2.1 域级合同套件（Platform 域自有）

| 套件 | 用例 | 覆盖 |
|---|---|---|
| `server/platform-workflow-engine.test.js` | **35/35** | 定义校验 / 版本与发布 / 绑定 / 实例 / 节点任务 / 动作 / 监控 / 暂停·恢复·终止·重新部署；幂等启动；并发完成冲突；条件求值白名单 |
| `server/platform-sod-rules.test.js` | **20/20** | 族覆盖登记不留空白；可创建集合 fail closed（8 类不可求值配置）；规则生命周期与审计；升级至上级全链路；事务外拒绝证据 |
| `server/platform-sod-wiring.test.js` | **17/17** | 既有 6 族 + 信用特批的拒绝状态码与文案**逐字不变**；生产工单族自审批缺口闭合（PL-DEF-01）；接线位置源码级断言 |
| `server/platform-organizations.test.js` | **12/12** | 组织 CRUD / 防环 / 层级 / 作用域绑定 / `accounting_scopes` 映射 |
| `server/platform-attachments.test.js` | **13/13** | 内容寻址存储 / 类型与扩展名双重白名单 / 下载鉴权 / 派生计数 / 超限 413 / multipart 边界 |
| `server/platform-notifications.test.js` | **11/11** | 六类生产者各一例；去重；未读计数与列表同源；通知失败不影响审批 |
| `server/platform-numbering.test.js` | **12/12** | 既有 6 种单号格式不变；并发同幂等键返回同号；事务内分配；PRQ 号删除后不冲突 |
| `server/platform-lifecycle.test.js` | **8/8** | PL-06 权限专化；只读主体可读不可写；无权主体 403；别名兼容；operator 工作面可达 |
| `server/platform-audit-upgrade.test.js` | **7/7** | **PL-DEF-06** 正例 + 反例（409 写 / 非 409 不写 / 白名单外不写 / 同一次只落一条）；可选结构化参数；schema 升级；历史行不被改写 |
| `server/platform-domain-schema.test.js` | **5/5** | 17 张新表的 SQLite 形状、迁移幂等性、MySQL 侧由 SQLite 快照派生的 DDL（离线） |

合计 **144 例**，全部为 **class A（新合同通过）** —— 无 class B（已知缺陷复现）用例，
因此不存在「用旧缺陷仍可复现来充当新合同证据」的情形。

### 2.2 真实 MySQL 8.0.37 证据（本域专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `PLATFORM_MYSQL_V1`（`RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_PLATFORM_RACES` → `CLEANUP_SCHEMA_POST_RUN`） |
| 通过运行 | run `6a541150-6634-4005-adb2-22e694fb1e02`、commit `6658e06` |
| 结果 | **`RESULT = PASS`**；**`ACK-4 STATE = FINISHED`**（清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明） |
| 目标身份 | `modern_erp_domain_test` @ `127.0.0.1:3306`（MySQL **8.0.37**，serverUuid `256c7a4e-d275-11f1-885b-b025aa71d167`，grants sha256 `bef61617…807e`） |
| 运行前目标状态 | 只读 preflight：`tables=0 views=0 triggers=0 routines=0 events=0`，身份与基线**无漂移** |
| 运行后目标状态 | 只读 preflight 复核：`tables=0 views=0 triggers=0 routines=0 events=0` |
| 竞态套件 | **4/4 PASS**：S1 职责分离拒绝的**事务外证据**（事务回滚后判定记录与审计行仍在）；S2 编号幂等并发返回同一单号（PL-DEF-12）；S3 通知去重只落一条；S4 平台 schema 形态（17 张新表 + `notifications` 6 列 + `audit_logs` 4 列） |
| 每个场景的负控 | S1 负控：另一个主体审批同一张工单**成功**；S2 负控：不同幂等键拿到**不同**单号；S3 负控：不同去重键各落一条 |
| 此前运行 | run `41f1a4f5-80a2-4e2b-9abe-a1e2e6dc1c68` @ `1ff47ee`（PL-06 补齐后）：PASS / FINISHED；run `74b20bd2-b357-43cf-a62f-55ef721896f8` @ `a7def68`（首版）：PASS / FINISHED。**三次运行全部通过，无失败运行** |
| ACK-4 能力 | 每次运行由业务所有者批准、`scripts/gates/issue-mysql-ack4.ps1` 机械签发（签发器本身不构成批准）；一次性消费，窗口 15 分钟 |

### 2.3 浏览器证据（防空壳）

`scripts/acceptance/platform-workfaces-responsive-uat.mjs`：**10 屏 × 4 档宽度 = 40/40 PASS**
（320 / 390 / 430 / 680 CSS px）。

判定口径（每屏每档都逐项检查）：屏根 canonical `data-testid` 已绘制 · 真实数据行或**指名原因的**
显式空态 · 无权限拒绝态 / 错误态 · 无横向溢出 · 全部可点目标两个轴均 ≥ 44 CSS px · 无控制台错误。

| 屏 | 屏根 testid | 非空洞证据 |
|---|---|---|
| 职责分离规则 | `platform-sod-rules-page` | 族覆盖 7 行 + 规则列表 |
| 组织与作用域 | `platform-organizations-page` | 组织树真实行 |
| 编号规则 | `platform-numbering-page` | 7 条编号规则真实行 |
| 流程设计 | `platform-workflow-designer-page` | 模板真实行 |
| 流程绑定 | `platform-workflow-bindings-page` | 绑定真实行 |
| 我的流程任务 | `platform-workflow-tasks-page` | 任务真实行 |
| 流程监控 | `platform-workflow-monitor-page` | 实例真实行 |
| 通知中心 | `platform-notifications-page` | 未读数 + 独立流程待办条目 |
| 生命周期与归档 | `platform-lifecycle-page` | 生命周期记录真实行 |
| 销售订单详情（附件挂载点） | `attachment-panel-SALES_ORDER` | **上传 → 列出 → 删除 → 回到显式空态**全链路（API 轨迹 `POST 201 → GET 200 → POST delete 200 → GET 200`） |

夹具经**真实 API**建立（组织 → 作用域 → 模板 → 版本 → 发布 → 绑定 → 启动实例），
因此「我的流程任务」与「流程监控」有真实数据行而不是空壳。

**页面级观察（不判定，属该业务域自己的 UAT）**：销售订单详情页的「查看业务流程 ›」可点击目标
高 36 CSS px，低于 44 px 触控下限 —— 该页**既有**问题，非本域引入，已打印留痕。

### 2.4 本轮修复的真实缺陷

| # | 缺陷 | 处置 |
|---|---|---|
| 1 | **生产订单自审批缺口**（`PL-DEF-01`）—— 6 族审批中唯一没有自审批防护的族 | 平台 SOD 层唯一把关；既有族的拒绝状态码与文案**逐字不变** |
| 2 | **拒绝证据随事务回滚消失** —— 既有 6 族的自审批拒绝不留审计行 | 拒绝 / 升级证据改为**事务外**补写（HTTP 生命周期中央 catch，回滚之后） |
| 3 | **管理员权限被当作文档生命周期能力使用**（`PL-DEF-04`） | 新增 `LIFECYCLE_VIEW` / `LIFECYCLE_MANAGE`；`USERS_MANAGE` 保留为兼容别名 |
| 4 | **生命周期 operator 工作面不可达**（路由 `data-cleanup` 自 v1.7 起停用） | 迁移为启用路由 `lifecycle`，权限专化，读写分权 |
| 5 | **`auditBusinessRejection` 零测试覆盖**（`PL-DEF-06`） | 新增 7 例合同套件（正例 + 三类反例） |
| 6 | **编号分配在单据事务之外**（`PL-DEF-11`）、**幂等键非原子**（`PL-DEF-12`）、**请购单号删除后必冲突**（`PL-DEF-13`） | 分配移入单据事务；同键并发返回**同一单号**；请购单号由服务发放 |
| 7 | **旧版审批流页面读取不存在的列且无 update 路由** | 页面与模块退役，`/api/workflows` 返回 410，`approval_workflows` 表保留为非权威 |
| 8 | **合同称「五审批族」，代码为 6 族 + 1 信用特批**（`PL-DEF-10`） | Requirement / Design 表述已校正 |

## 3. 跨域影响登记（AGENTS.md §4.6）

本域的实现**触达了其他域**，因此那些域的已签发验收结论的当前有效性须在本记录中登记：

| 受影响域 | 触达内容 | 影响性质 | 该域结论的处理 |
|---|---|---|---|
| **Manufacturing & Quality** | 生产工单审批新增平台层 SOD 闸门（自审批被拒）；`role-warehouse` 新增 `PRODUCTION_ORDERS_APPROVE`（`PL-DEC-04`） | **行为变更**（自审批由允许改为拒绝）+ **角色合同变更** | 该域已签发记录 [`manufacturing-quality-domain-acceptance-20261112.md`](./manufacturing-quality-domain-acceptance-20261112.md) 的能力条数不受影响，但其「角色合同」与「生产工单审批」证据点已漂移 → 见 §4.3 判 `NEEDS_REVIEW` |
| **Sales & Customer** | 销售订单详情页插入附件挂载面板；`credit-special-approval.js` / `sales-orders.js` 接入平台 SOD（既有防护之后，既有行为不变）；路由清单 85 → 93 | 前端渲染变更（纯附加节点） | 该域已签发记录的**能力判定**不受影响；其浏览器 88/88 证据所覆盖的销售订单详情页已漂移 → 判 `NEEDS_REVIEW` |
| **Planning / Accounting & Analytics / Inventory & Warehouse / Procurement & Outsourcing / Master & Engineering / Finance Operations** | 13 个前端合同测试文件的路由清单事实同步（85 → 93、停用 4 → 2、权限目录 264 → 266）；`src/pages/accounting.jsx` 插入附件面板；`planning-documents.jsx` 插入附件面板 | **断言事实同步**（断言强度未降低） | 能力判定不受影响 → 判 `STILL_VALID`；其中会计与分析的浏览器证据判 `NEEDS_REVIEW` |
| **M1-Core（采购与委外包级）** | `scripts/testing/test-suites.js` 新增 4 个平台套件登记；`server/app.js` 新增平台路由与 410 退役 | 套件清单变更 | 七 Gate 结论不受影响 → 判 `STILL_VALID` |

## 4. 历史验收结论当前有效性复核（AGENTS.md §4.6）

### 4.1 复核方法

- 机器守卫 `node scripts/qa/verify-acceptance-records.mjs`：78 份记录，**`BROKEN` 0**（无悬空指针），
  62 份标为 `NEEDS_REVIEW`（引用路径在其锚点之后被改动）。
- 本轮复核的**范围**：被 Platform 域的提交（`0163310` … `6658e06`）改动过引用路径的记录
  —— 共 **27 份**。其余 35 份 `NEEDS_REVIEW` 记录由其它域的整改轮改动，**不属于**本域的复核范围，
  仍待各域自身的域级审计复核。
- 判定类别：`CURRENT` / `STILL_VALID`（可作为当前证据直接引用）·
  `SUPERSEDED_BY_DOMAIN_ACCEPTANCE`（不得单独引用）· `PENDING_DOMAIN_AUDIT`（不得单独引用）·
  `NEEDS_REVIEW`（只能按复核记录写明的具体失效点引用）。
- **本复核不撤销、不改写任何已签发结论。**

### 4.2 复核结论

| 分类 | 份数 | 记录 |
|---|---|---|
| `STILL_VALID` | 21 | `g0-governance-acceptance-20261101`；`m1-core-g04-owner-acceptance-20261107`；`m1-core-wp7a-gate-acceptance-20261103`；`m1-core-wp7a-r2-offline-evidence-20261107`；`out001-candidate-freeze-20261109`；`out001-gate-ready-preflight-20261109`；`planning-domain-acceptance-20261112`；`procurement-outsourcing-domain-acceptance-20261111`；`sales-customer/` 下 11 份（`batch-a-implementation-mapping` 除外，见下）；`sales-customer/w11-a-u1` / `w11-a-u2` / `w11-a-overdue` / `w11-sec-01` / `wave-0-2` / `wave-8-stage-d-implementation-evidence` / `wave-8-stage-d-verification-and-p1-remediation` / `wave-10-implementation-records` / `wave-capability-and-gate-evidence` / `f2-implementation-status-clarification` / `package-b-final-acceptance` |
| `NEEDS_REVIEW` | 6 | 见 §4.3 |
| `SUPERSEDED_BY_DOMAIN_ACCEPTANCE` | 0 | — |
| `PENDING_DOMAIN_AUDIT` | 0 | — |

`STILL_VALID` 的依据（逐类）：① 引用路径只因**平台侧新增登记**而漂移
（`scripts/testing/test-suites.js` 新增 4 个套件、`scripts/gates/ack4/ack4-runtime.mjs` 新增
`PLATFORM_MYSQL_MANIFEST`、`scripts/gates/run-mysql-local-gate.ps1` 新增 campaign 与 UTF-8 BOM、
`server/db.js` 新增表与权限码、`server/lib/http.js` 新增 `readMultipart`、
`server/test-utils/temp-db.js` 新增 campaign 操作名）—— 被引用的门禁、脚本与能力集合
**仍存在且仍成立**；② 引用 `server/app.js` / `server/modules/sales-orders.js` /
`server/modules/credit-special-approval.js` 的记录：平台 SOD 接线**置于既有自审批防护之后**
（Design §32.4.3），既有族的允许 / 拒绝结果、状态码与文案**逐字不变**，
由 `server/platform-sod-wiring.test.js`（17 例）逐字断言。

### 4.3 判 `NEEDS_REVIEW` 的 6 份（引用时须按此处的具体失效点标注）

| 记录 | 具体失效点 | 可否单独引用 |
|---|---|---|
| [`manufacturing-quality-domain-acceptance-20261112.md`](./manufacturing-quality-domain-acceptance-20261112.md) | 平台 SOD 接线改变了**生产工单自审批**行为（由允许改为拒绝），`PL-DEC-04` 改变了**角色合同**（`role-warehouse` 新增 `PRODUCTION_ORDERS_APPROVE`）；该记录 43 项能力判定不受影响，但其角色与审批路径的证据点已漂移 | **否** —— 须引用本记录 §3 与 `platform-sod-wiring.test.js` 的逐字断言 |
| [`sales-customer-domain-acceptance-20261113.md`](./sales-customer-domain-acceptance-20261113.md) | 其浏览器 **88/88** 证据所覆盖的**销售订单详情页**此后插入了附件挂载面板；路由清单事实由 85 变为 93 | **否** —— 须引用本记录 §2.3 的挂载点证据 |
| [`sales-customer-domain-acceptance-candidate-20261113.md`](./sales-customer-domain-acceptance-candidate-20261113.md) | 同上（其候签时的 3881/3881 FULL 计数亦已过期） | **否** —— 同上 |
| [`accounting-analytics-domain-acceptance-20261111.md`](./accounting-analytics-domain-acceptance-20261111.md) | 其浏览器 **6/6** 证据所覆盖的**会计凭证页**此后插入了附件挂载面板 | **否** —— 须引用本记录 §2.3 |
| [`accounting-analytics-domain-acceptance-candidate-20261111.md`](./accounting-analytics-domain-acceptance-candidate-20261111.md) | 同上（其 3695/3695 FULL 计数亦已过期） | **否** —— 同上 |
| [`acceptance-record-revalidation-20261112.md`](./acceptance-record-revalidation-20261112.md) | 其分类表是 **2026-11-12** 的快照；此后八个业务域的域级验收与 Platform 域的整改已逐条取代其中的部分分类 | **否** —— 引用其中任一记录的分类结论前，须先按本节复核该条 |

## 5. 能力逐项判定（21 项）

判定依据（审计台账 §1）：① 有生产写 / 读入口，且服务端具备来源、状态机、权限、事务约束；
② 有**已注册**的可执行测试覆盖正例且至少一个反例；③ 有 operator 可达的前端入口
（或该能力本身是纯只读读模型）；④ 事实进入业务路径。

| 能力 | 判定 | ① 入口 | ② 已注册测试（正例 + 负控） | ③ operator 入口 | ④ 事实入路径 |
|---|---|---|---|---|---|
| PL-01 Identity / RBAC | `COVERED`（封顶） | `users` / `roles` / `permissions` / `role_permissions` / `sessions`；`allow()` / `allowAny()` 唯一闸门 | `v2-wave3d-roles-ownership` / `v2-wave3e-users-ownership` | `users` 路由 | 是（100+ 处调用） |
| PL-02 SOD | `COVERED` | `server/modules/platform-sod.js`（规则 CRUD + 求值）；8 条 `/api/platform/sod/*` | `platform-sod-rules`（20）+ `platform-sod-wiring`（17） | `sod-rules` 工作面（族覆盖 / 规则 / 升级待办 / 判定记录） | 是（7 个审批决策点） |
| PL-03 Organization Scope | `COVERED` | `server/modules/platform-organizations.js` | `platform-organizations`（12） | `organizations` 工作面 | 是（工作流按组织绑定） |
| PL-04 Generic Workflow 引擎 | `COVERED` | `server/modules/platform-workflow-engine.js`；16 条 `/api/platform/workflow-*` | `platform-workflow-engine`（35） | 4 个工作面（设计 / 绑定 / 任务 / 监控） | 是（8 张表 + 状态机 + 幂等） |
| PL-05 Approval | `COVERED`（封顶） | 6 族 + 1 信用特批的既有 canonical handler（**未迁移**） | `mobile-approval-center` + `platform-sod-wiring`（逐字断言） | `approvals` 路由（既有） | 是 |
| PL-06 Document Lifecycle | `COVERED`（封顶） | `server/modules/lifecycle-engine.js`；6 条 `/api/lifecycle/*` | `platform-lifecycle`（8）+ `v12-lifecycle-foundation` | `lifecycle` 工作面 | 是（25 实体注册表） |
| PL-07 Document Relation | `OUT_OF_SCOPE` | — | — | — | 延期理由与重启条件见 Requirement §36.13 |
| PL-08 Document Conversion | `OUT_OF_SCOPE` | — | — | — | 同上 |
| PL-09 Numbering | `COVERED` | `server/modules/platform-numbering.js`；3 条 `/api/platform/number-series` | `platform-numbering`（12） | `numbering` 工作面 | 是（既有 7 种单据） |
| PL-10 Attachment | `COVERED` | `server/modules/platform-attachments.js`；4 条 `/api/platform/attachments` | `platform-attachments`（13） | `AttachmentPanel` 挂载 **7 个**详情页 + 浏览器全链路实证 | 是（7 类归属对象） |
| PL-11 Notification | `COVERED` | `server/modules/platform-notifications.js`（六类生产者） | `platform-notifications`（11） | 通知中心（分类 / 优先级 / 跳转 / 未读徽标 / 订阅） | 是 |
| PL-12 Audit | `COVERED`（封顶 + 增量） | `server/lib/audit.js` + `audit_logs` 加列 | `platform-audit-upgrade`（7，**含 PL-DEF-06**）+ `platform-domain-schema`（5） | —（审计是纯读模型 + 领域内证据面） | 是（全域写路径） |
| PL-13 Period Control | `COVERED`（封顶） | 4 套既有期间存储 + `assertFinancialPeriodsOpen` | 既有域门禁（**无代码改动**） | 既有期间面 | 是 |
| WF-01 流程定义 | `COVERED` | `workflow_templates` / `workflow_template_versions` + 定义校验 | `platform-workflow-engine` | `workflow-designer` | 是 |
| WF-02 版本与发布 | `COVERED` | 发布 / 停用（已发布版本不可变） | `platform-workflow-engine` | `workflow-designer` | 是 |
| WF-03 业务模板绑定 | `COVERED` | `workflow_bindings` / `workflow_binding_history` | `platform-workflow-engine` | `workflow-bindings` | 是 |
| WF-04 流程实例 | `COVERED` | `workflow_instances`（幂等键唯一） | `platform-workflow-engine` | `workflow-monitor` | 是 |
| WF-05 节点任务 | `COVERED` | `workflow_node_instances` / `workflow_tasks` | `platform-workflow-engine` | `workflow-tasks` | 是 |
| WF-06 业务动作 | `COVERED` | `workflow_action_logs` / `workflow_events` + 动作白名单 | `platform-workflow-engine` | `workflow-tasks`（6 种动作） | 是 |
| WF-07 监控 | `COVERED` | 实例列表 / 详情（节点 + 任务 + 事件） | `platform-workflow-engine` | `workflow-monitor` | 是 |
| WF-08 暂停 / 终止 / 恢复 | `COVERED` | 实例级控制 + 重新部署 | `platform-workflow-engine` | `workflow-monitor` | 是 |

### 5.1 关于两种计数口径（待 D-01 裁定）

- **能力口径**：21 项能力逐项判定 → 19 `COVERED` / 2 `OUT_OF_SCOPE`（PL-07、PL-08）。
  PL-06 与 PL-13 的**通用化增量 / 收敛增量**是这两个能力**内部**的范围边界（已批准延期），
  能力本身判定为 `COVERED`（封顶）。
- **Requirement §36.12.1 口径**：`17 COVERED / 4 OUT_OF_SCOPE`，其枚举为
  「PL-06 通用化增量、PL-07、PL-08、PL-13 收敛增量」—— 即把两项**范围项**计入 `OUT_OF_SCOPE`，
  相应地把 PL-06 与 PL-13 两项能力本身排除在 `COVERED` 之外。
- 两组数字**指向同一份事实**。Requirement §36.12.1 的算术表述（17 + 4 = 21）与 §36.2 的逐项
  判定表（PL-06 / PL-13 = `COVERED`）**不能同时成立** —— 本记录按两种口径分别给出，
  请所有者裁定采用哪一个（D-01）；采用能力口径时，Requirement §36.12.1 的表述需随之更正。

## 6. 随冻结待裁定的有界残余（**本材料不预判任何一项的处置**）

| # | 残余 | 事实边界 | 待裁定 |
|---|---|---|---|
| R-01 | **PL-06 关系图仍是 30+ 处硬编码分支，25 个实体中只有 `PURCHASE_RECEIPT` 可归档** | 通用关系注册表与全实体可归档已由 Requirement §36.13 判为 `OUT_OF_SCOPE`（延期理由与重启条件已登记）。本轮交付的是**封顶**：既有关系图行为逐字不变 | 接受为封顶边界 / 另立范围项 |
| R-02 | **PL-13 的三个期间闸门并存、语义不一致**（`PL-DEF-08`）；`operating_period_closures` / `finance_business_closures` 对全部 canonical 闸门不可见（`PL-DEF-09`） | 期间控制收敛已由 Requirement §36.13 判为 `OUT_OF_SCOPE`；本轮**无代码改动**，四个既有期间存储与 `assertFinancialPeriodsOpen` 断言保持原样 | 同上 |
| R-03 | **通用工作流任务的 SOD 归因未登记** | 引擎已按 `businessType='WORKFLOW_TASK'` 接线，但 initiator resolver 只覆盖 7 个族 → 该业务类型**不可配置规则**（fail closed），不会产生「拒绝一切却看不出原因」的规则 | 接受为 fail closed 的显式边界 / 立项补 resolver |
| R-04 | **通用工作流引擎没有对外的实例启动入口** | 「平台能力不得成为第二写入口」（Design §32.11 约束 #7）：实例由被调域的 canonical 入口启动。因此在业务域接线之前，「流程监控」与「我的流程任务」恒为空态 | 接受为引擎的边界设计 / 立项一个业务域接线 |
| R-05 | **逐列 schema parity 未在真实 MySQL 上取证** | 本域 campaign 证明 17 张新表与加列**被真实 MySQL 8 接受**并给出目录形态；未做逐列类型 / 索引 / CHECK 的逐项 parity 比对 | 接受 / 追加一次 parity 取证 |
| R-06 | **销售订单详情页「查看业务流程 ›」触控目标高 36 px**（低于 44 px） | 该页**既有**问题、非本域引入；本轮 UAT 已打印留痕、不判定 | 移交 Sales & Customer 域 |

> 上述 6 项**均未**在本材料中写成「本身不阻塞冻结」。按既定规则，处置决定由
> **Final Freeze Review** 作出并书面记录（关闭 / 附理由接受 / 延期）。

## 7. 未解决矛盾

| # | 矛盾 | 状态 |
|---|---|---|
| C-01 | **能力计数口径**（17 / 4 与 19 / 2）与 Requirement §36.12.1 的算术表述 | 待 D-01 裁定 |
| C-02 | **`MIN_APPROVERS` 判定方向**：Design §32.4.2 原文「已通过人数 < N → **不违规**」与实现（`approvedCount < required` → 违规）方向相反 | **已裁定并消解**（业务所有者 2026-11-14）：以**实现方向**为 canonical —— 「最小通过人数」的语义是「已通过人数 < N 即违规」；本轮不可创建的原因是**求值点不存在**（7 个决策点均为单步、不提供已通过人数），不是约束本身无效。Design §32.4.2 与 Requirement §36.4 已按该口径修订，代码不变。**待确认**：是否追补 Requirement §36.4 的措辞 |
| C-03 | **PL-12 的 44 项能力判定（`PENDING_DOMAIN_AUDIT` 类别的交叉影响）** | 见 §3 与 §4.3：制造与质量域的角色合同与生产工单审批证据点已漂移，其**能力条数**不受影响；该域已签发结论未被撤销，引用时按 §4.6 标注类别 |

## 8. 冻结范围（候签）

**冻结范围**：本域 Active Contract（Requirement §36 / Design §32）及其 §5 表中判定为 `COVERED`
的 19（或 17）项能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3101–B3122 手册级关闭）· Release Readiness · 发布 · 部署 ·
真实环境 migration · 业务数据库写入 · 远端 Git 操作 · 其它域的 Acceptance。

## 9. 未发生的事实声明

本记录中不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录：
ACK-4 能力由业务所有者在会话中批准、由 `scripts/gates/issue-mysql-ack4.ps1` 机械签发；
三次真实 MySQL 运行均由受保护启动器执行并留下消费标记；所有门禁数字均为本轮实测。
