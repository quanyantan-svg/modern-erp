# Planning 计划域级 Acceptance 与 Capability Freeze 记录（2026-11-12）

> **用途**：登记业务所有者对 Planning 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Planning Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；**45 项 `COVERED` 能力已冻结**。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/planning.md`](../requirements/planning.md) §30.1～§30.7；Design [`docs/design/planning.md`](../design/planning.md) §25.1～§25.19；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §54；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)；逐项判定 [`docs/audits/planning-capability-audit-20261112.md`](../audits/planning-capability-audit-20261112.md)。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
PLANNING_DOMAIN_ACCEPTANCE_PASS
PLANNING_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在同一轮对话中先要求「进行整个项目最后的收尾，对八个业务域进行验收」，随后就 Planning 域的审计候签裁定「开一轮整改 / 修订 Requirement 门禁指向 / 全部修复」，整改轮完成后进一步裁定「接受为残余并签发」与「签发域级 Acceptance + Freeze」。据此作出以下决定：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`PLANNING_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 45 项 `COVERED` 能力**（`PLANNING_CAPABILITY_FREEZE`） |
| 能力判定 | PL-01～PL-45 共 **45 项**：`COVERED` **45**、`PARTIAL` **0**、`MISSING` **0**、`OUT_OF_SCOPE` **0** |
| `PLAN-DEC-02`（真实 MySQL 行为等价） | **接受为随冻结的显式残余**（§5.1），不新建 `PLANNING_MYSQL_V1` 域级 campaign |
| 随冻结接受的残余 | `PLAN-RES-01`～`PLAN-RES-04`（§5.2） |
| 实现锚点 | `22ba875`（整改轮在未提交工作树上实施，提交见 §7） |
| 整改轮范围 | 11 项能力补齐（PL-07/08/17/19/24/25/31/36/38/42/44/45）+ 8 项真实缺陷修复 + Requirement §30.6 与 Design §25.1/§25.17/§25.19 的合同修正 |

决定来源是当前对话中所有者的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：整改轮后的本域 Active Contract（Requirement §30.1～§30.7 / Design §25.1～§25.19）及其 45 项 `COVERED` 能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3120 手册级关闭）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance。

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3718/3718 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS（exit 0） |
| 域内 focused（`--filter plan`） | **170/170 PASS** |
| 新增合同套件 `server/planning-closure-remediation.test.js` | **9/9 PASS** |
| 浏览器（真实 Edge，`b3120-planning-frontend.mjs`） | **PASS**（320/390/430/680 四档） |
| 浏览器（真实 Edge，`b3120-planning-final-acceptance.mjs`） | **PASS**（320/390/430/680 四档） |
| 跨域回归（Sales Wave 7 acceptance + functional） | **87/87 PASS** |
| 文档一致性 `current` | N1、N3～N6、N8、N9 **PASS**；N2 `RETIRED`；**N7 FAIL**（既有历史提交 `a40e356` / `59eccd5` / `171ade5` / `4403a80` 的追溯债务，与本域无关） |
| 文档一致性 `migration` | C1～C6 全 PASS |
| **真实 MySQL 8** | **部分取证**，见 §5.1 |

### 2.1 非空洞证明（变异实验）

| 实验 | 期望 | 结果 |
|---|---|---|
| 移除 `.planning-balance__actions a{min-height:44px}` 后重跑 `b3120-planning-frontend.mjs` | 必须 FAIL | **FAIL**，命中同样 10 个 22.5px 目标（`planner-workbench@320`） |
| 整改前的历史状态 | — | 脚本在首次访问时**不**命中（只在 goBack/goForward 之后才命中）→ 整改已把断言锚定到 READY 态，守卫真正承担了重量 |

## 3. 本次验收同时确认的裁定

| 事项 | 确认内容 |
|---|---|
| 整改轮的实施授权 | 「开一轮整改」授权在既有 Approved Requirement 与 Design 合同下实施 11 项能力；未新增业务规则、未新增第二套净额算法、未新增第二个 Production Order constructor |
| Requirement §30.6 门禁指向 | 「修订 Requirement 门禁指向」已落实：database 条款拆成「schema / migration 对等」与「release / reservation 行为等价」两段，逐段写明由哪个可运行门禁覆盖、覆盖什么、**不**覆盖什么 |
| Design §25.1 模块归属 | 按实现事实更正：新增 `server/modules/planning-time-phased.js`；原表所列 `server/modules/planning-reservation.js` 从未存在，strong-reservation 守卫一直归属 `planning-domain.js` |
| Design §25.19 最终状态 | MySQL **环境**并未缺失，缺失的是本域专属 campaign；本域最终状态不是 `NOT READY — MYSQL VERIFICATION PENDING`，而是「真实 MySQL 环境与 schema 对等已取证、本域行为等价未单独取证」 |
| Sales 跨域行为 | `PLAN-DEF-08` 的修复**不改变** Sales 域已签发的 Wave 7 行为或错误码（Sales Wave 7 两套件 87/87 PASS）；变更只解除了 Sales 对 Planning **内部错误码**的耦合 |

## 4. 冻结内容与解冻条件

| 冻结对象 | 说明 |
|---|---|
| 业务合同 | Requirement §30.1～§30.7 与 Design §25.1～§25.19 为本域唯一权威正文 |
| 能力实现 | 45 项 `COVERED` 能力的端点、状态机、权限、事务、审计与错误码 |
| Schema | `server/migrations/planning-domain-schema.js` 的 Planning Closure schema（含整改轮的 4 个 additive 对象：`planning_substitute_suggestions`、`planning_planned_order_batches`、`planning_reservations.expected_supply_quantity`、`mrp_run_results.open_planned_supply`）与既有迁移链共同构成冻结基线 |
| 净额与事件语义 | `server/modules/planning-time-phased.js` 的事件排序、时间分段投影、安全库存 floor（每产品 / 每 horizon 一次）与按层级推进的 BOM 展开（共享组件只净额一次） |
| 测试 | FULL / HEAVY / focused / 新增合同套件 / 浏览器 UAT 全部通过是冻结基线的一部分 |

**解冻条件**：任何对上述内容的修改都必须先走显式解冻（登记变更理由、影响范围与新的验收证据），不得以「顺手优化」扩大范围；涉及跨域合同变更（Sales 预留意图、Manufacturing 指令、Inventory 供给口径、会计成本）时必须回到对应 Domain 的 Requirement / Design 层重新裁定。

## 5. 已知限制（随本次验收一并接受）

### 5.1 `PLAN-DEC-02` 真实 MySQL 行为等价未单独取证

本仓库当前只有三个已批准的 ACK-4 campaign 可以运行：`test:mysql:m1-core`、`test:mysql:accounting-analytics`、`test:mysql:out001`；其余 MySQL 入口（`test:mysql`、`test:mysql:concurrency`、`test:mysql:legacy`、各 Sales Wave 门禁）由 `blockUnmigratedAck4Entry` **永久阻断**，不得被引用为证据。`M1_CORE_PARITY_TABLES`（16 张采购 / 库存表）与 `AA_PARITY_TABLES`（47 张会计与分析表）都**不含** Planning 表，Planning 域因此**没有专属 ACK-4 campaign**。

据此：

- **已取证**：Planning 的全量迁移与表结构在真实 MySQL 8 上被 `test:mysql:accounting-analytics` 的 `BOOTSTRAP_CURRENT_SCHEMA` 步骤接受。
- **未取证**：release / reservation 在真实 MySQL 上的行为等价（不双发、不超分配）。该保证当前**只**由本域 focused 套件的并发与幂等反例覆盖。

**业务所有者已裁定接受该残余**。本记录**不**主张真实 MySQL 上的 release / reservation 行为等价已证明。建立 `PLANNING_MYSQL_V1` 域级 campaign 是把它升级为真实 MySQL 证据的唯一路径。

### 5.2 其他随冻结接受的残余

| 编号 | 残余 |
|---|---|
| `PLAN-RES-01` | `mrp_run_demands.source_type` 有 `CHECK(source_type IN ('SALES_ORDER','FORECAST'))`，因此组件需求只存在于 `mrp_run_events` / `mrp_run_pegging` / `mrp_run_components`，不进入需求台账。修改该 CHECK 需要 SQLite 表重建，本轮不做 |
| `PLAN-RES-02` | `SELECTED` / `PRECISE_SELECTED` 两种计算范围模式没有端到端专门用例；模式本身已实现并被校验 |
| `PLAN-RES-03` | N7 文档一致性仍 FAIL，成因是四个既有历史提交的追溯债务，与本域无关；本域**未**把它写成 PASS |
| `PLAN-RES-04` | 真实 MySQL 环境本身**未**缺失，缺失的是本域专属 campaign（与 §5.1 同源） |

### 5.3 已修复但值得记录的事实

整改轮修复的 8 项真实缺陷（`PLAN-DEF-01`～`PLAN-DEF-08`）已全部闭合，其中 `PLAN-DEF-06`（共享组件库存被多次净额，下层需求被低估）与 `PLAN-DEF-07`（已消费 Forecast 重复计入需求）是**整改轮新发现**的真实业务正确性缺陷，回归证据见 `server/planning-closure-remediation.test.js` 与 `server/m11-planning.test.js` 用例 45b。

## 6. 本记录**不**主张的内容

- 不主张真实 MySQL 上的 release / reservation 行为等价已证明；
- 不主张 `log/2026-10-08.md:283..289` 的历史 "Final Acceptance: PASS / Freeze: YES" 在当前 HEAD 成立（该历史记录保留，但不作为本次签发的依据）；
- 不主张 B3120 手册级关闭（Manual Closure）；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张其他 Domain 的 Acceptance 或 Freeze；
- 不主张本次验收授权了真实环境 migration、业务数据库写入或远端 Git 操作。

## 7. 登记与后续

- 状态登记：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §54；能力覆盖矩阵：`docs/status/CAPABILITY_MATRIX.md` 的 B3120 行；逐项判定：`docs/audits/planning-capability-audit-20261112.md`。
- 本记录取代同日的候签材料 [`planning-domain-acceptance-candidate-20261112.md`](./planning-domain-acceptance-candidate-20261112.md)；候签材料标记为 `SUPERSEDED`，保留作为决定过程的证据。
- 按就绪度顺序，下一个域为 **Finance Operations**（FO01～FO58）。
