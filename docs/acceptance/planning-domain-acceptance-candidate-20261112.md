# Planning 计划域级 Acceptance 与 Capability Freeze 候签（2026-11-12）

> **用途**：本文件是 Planning 域**整域 Acceptance** 与 **Capability Freeze** 的候签材料：汇总整改轮的实施范围、逐项能力判定、Gate 证据、已披露限制与仍需业务所有者裁定的事项，供业务所有者据以签发（或退回）。本文件**不**构成 Acceptance 本身。
>
> **Owner**：Planning Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`SUPERSEDED` —— 本文件是候签材料（决定过程的证据），**已被** [`planning-domain-acceptance-20261112.md`](./planning-domain-acceptance-20261112.md) 取代；该签发记录才是 Acceptance 与 Freeze 的正式证据。本文件**不是** Release Readiness 证据。逐项证据见 [`docs/audits/planning-capability-audit-20261112.md`](../audits/planning-capability-audit-20261112.md)。
>
> **权威来源**：Requirement [`docs/requirements/planning.md`](../requirements/planning.md) §30；Design [`docs/design/planning.md`](../design/planning.md) §25；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)。
>
> **本文件的生成不等于** Git 提交、远端同步、发布、部署、真实环境 migration 或真实业务数据库写入。本轮**已**实施经业务所有者裁定的整改轮代码与合同修正。

```text
PLANNING_DOMAIN_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION
（已于 2026-11-12 签发：PLANNING_DOMAIN_ACCEPTANCE_PASS / PLANNING_CAPABILITY_FREEZE）
```

## 1. 候签范围

| 项 | 范围 |
|---|---|
| Domain | Planning（产品架构第 3 个业务域） |
| 手册对标 | B3120 计划管理 |
| 能力集合 | PL-01～PL-45，共 **45 项** |
| 覆盖判定（整改前） | `COVERED` 34 项；`PARTIAL` 7 项（PL-07 / 17 / 19 / 31 / 42 / 44 / 45）；`MISSING` 4 项（PL-24 / 25 / 36 / 38） |
| 覆盖判定（整改后） | `COVERED` **45** 项；`PARTIAL` **0**；`MISSING` **0**；`OUT_OF_SCOPE` **0** |
| 合同基线 | Requirement §30.1～§30.7（§30.6 门禁指向已按裁定修正）；Design §25.1～§25.19（§25.1 / §25.17 / §25.19 已按实现事实修正） |
| 历史关系 | `log/2026-10-08.md:283..289` 记录过 "Final Acceptance: PASS / Freeze: YES"，但仓库无签发记录与 token，且其浏览器证据已失效、MySQL 证据不可复现 —— **不作为**本次签发依据 |
| 不在本次范围 | Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作、其他域的 Acceptance |

## 2. 整改轮的实施范围（业务所有者 2026-11-12 裁定）

| 裁定 | 落实内容 |
|---|---|
| 开一轮整改 | 补齐 11 项未达标能力（PL-07/08 仓库范围、PL-17 时间分段、PL-19 安全库存 floor、PL-24/25 替代料、PL-31 人工预留、PL-36 批量维护、PL-38 副产品、PL-42/44/45 报表与追溯）；新增 `server/modules/planning-time-phased.js`（时间分段净额引擎、时间桶 read model、供需事件来源）；新增 4 个 additive schema 对象（`planning_substitute_suggestions`、`planning_planned_order_batches`、`planning_reservations.expected_supply_quantity`、`mrp_run_results.open_planned_supply`）；新增 `server/planning-closure-remediation.test.js`（9 条合同用例）并登记进 FULL 套件清单 |
| 修订 Requirement 门禁指向 | Requirement §30.6 的 database 条款拆成「schema / migration 对等」与「release / reservation 行为等价」两段，并逐段写明由哪个可运行门禁覆盖、覆盖什么、不覆盖什么 |
| 全部修复 | 修复 `PLAN-DEF-01`（触控目标）、`PLAN-DEF-02`（浏览器脚本失败）、`PLAN-DEF-03`（浏览器验收空洞）、`PLAN-DEF-04`（Design 指向不存在模块）、`PLAN-DEF-05`（legacy MAX 第二套算法仍导出）；整改轮另新发现并修复 `PLAN-DEF-06`（共享组件库存被多次净额）、`PLAN-DEF-07`（已消费 Forecast 仍计入需求台账）、`PLAN-DEF-08`（Sales 已签发行为依赖 Planning 内部错误码） |

## 3. Gate 证据（整改后，当前 HEAD `22ba875`）

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3718/3718 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| focused（`--filter plan`） | **170/170 PASS** |
| 新增合同套件 `server/planning-closure-remediation.test.js` | **9/9 PASS** |
| 浏览器（真实 Edge，`b3120-planning-frontend.mjs`） | **PASS**（320/390/430/680） |
| 浏览器（真实 Edge，`b3120-planning-final-acceptance.mjs`） | **PASS**（320/390/430/680） |
| 跨域回归（Sales Wave 7 acceptance + functional） | **87/87 PASS** |
| 文档一致性 `current` | N1、N3～N6、N8、N9 **PASS**；N2 `RETIRED`；**N7 FAIL**（既有历史提交追溯债务，与本域无关） |
| 文档一致性 `migration` | C1～C6 全 PASS |
| **真实 MySQL 8** | **行为等价不可满足**，见 §4.2 |

### 3.1 变异实验（非空洞证明）

| 实验 | 期望 | 结果 |
|---|---|---|
| 移除 `.planning-balance__actions a{min-height:44px}` 后重跑 `b3120-planning-frontend.mjs` | 必须 FAIL | **FAIL**，命中同样 10 个 22.5px 目标（`planner-workbench@320`） |
| 移除该规则前的历史状态 | — | 脚本**不**报错（只在 goBack/goForward 之后才命中）→ 本轮已把断言锚定到 READY 态，守卫真正承担了重量 |

## 4. 必须随验收一并接受的事实

### 4.1 整改轮修复的 8 项真实缺陷

| 编号 | 事实 | 状态 |
|---|---|---|
| `PLAN-DEF-01` | 工作台卡片两个动作链接渲染为 22.5px 触控目标 | 已修复 |
| `PLAN-DEF-02` | `b3120-planning-frontend.mjs` 在当前 HEAD 失败；2026-10-07 的历史 PASS 已随 `c3fa520` 失效 | 已修复 |
| `PLAN-DEF-03` | `b3120-planning-final-acceptance.mjs` 的工作台断言从未在卡片渲染状态下执行（空洞证据） | 已修复（等待 READY 态 + 变异实验） |
| `PLAN-DEF-04` | Design §25.1 指向不存在的 `server/modules/planning-reservation.js` | 已修复（按实现事实更正） |
| `PLAN-DEF-05` | legacy `consumeForecastDemand`（MAX 语义）仍导出，生产无调用方 | 已修复（删除 export + legacy 测试改为断言 canonical 合同） |
| `PLAN-DEF-06` | BOM 展开按父级递归，共享组件库存被多次净额，下层需求被低估（14 被算成 6） | 已修复（按层级推进 + 回归用例） |
| `PLAN-DEF-07` | 已消费 Forecast 仍以全额进入需求台账与结果行 | 已修复（统一使用有效（剩余）Forecast + 判别性用例） |
| `PLAN-DEF-08` | Sales 已签发的 Wave 7 行为依赖 Planning 内部错误码 | 已修复（Sales 守卫自包含，**已签发行为与错误码逐字不变**） |

### 4.2 真实 MySQL 行为等价未单独取证（随冻结必须显式接受的残余）

本仓库当前只有三个已批准的 ACK-4 campaign 可运行：`test:mysql:m1-core`、`test:mysql:accounting-analytics`、`test:mysql:out001`；其余 MySQL 入口由 `blockUnmigratedAck4Entry` **永久阻断**。Planning 域**没有**专属 campaign，且 `M1_CORE_PARITY_TABLES` 与 `AA_PARITY_TABLES` 都不含 Planning 表。

据此：

- **已取证**：Planning 的全量迁移与表结构在真实 MySQL 8 上被 `test:mysql:accounting-analytics` 的 `BOOTSTRAP_CURRENT_SCHEMA` 步骤接受。
- **未取证**：release / reservation 在真实 MySQL 上的行为等价（不双发、不超分配）。该保证当前**只**由本域 focused 套件的并发与幂等反例覆盖。
- Requirement §30.6 与 Design §25.17 / §25.19 已按此边界修正，明确不得把该残余表述为已证明。

### 4.3 其他随冻结接受的残余

| 编号 | 残余 |
|---|---|
| `PLAN-RES-01` | `mrp_run_demands.source_type` 有 `CHECK(source_type IN ('SALES_ORDER','FORECAST'))`，因此组件需求只存在于 `mrp_run_events` / `mrp_run_pegging` / `mrp_run_components`，不进入需求台账。改该 CHECK 需要 SQLite 表重建，本轮不做 |
| `PLAN-RES-02` | `SELECTED` / `PRECISE_SELECTED` 两种计算范围模式没有端到端专门用例；模式本身已实现并被校验 |
| `PLAN-RES-03` | N7 文档一致性仍 FAIL，成因是四个既有历史提交的追溯债务，与本域无关；本域**未**把它写成 PASS |
| `PLAN-RES-04` | 真实 MySQL 环境本身**未**缺失，缺失的是本域专属 campaign；建立 `PLANNING_MYSQL_V1` 是把它升级为真实 MySQL 行为证据的唯一路径 |

## 5. 未解决矛盾（需要业务所有者裁定）

| 编号 | 事项 | 可选处置 |
|---|---|---|
| `PLAN-DEC-02` | 真实 MySQL 行为等价未单独取证 | ① 接受为随冻结的显式残余（§4.2 已写明边界）；② 另行授权新建 `PLANNING_MYSQL_V1` 域级 campaign（需业主逐次签发 ACK-4 capability，工期与工件量显著增加） |

## 6. 本次候签**不**主张的内容

- 不主张真实 MySQL 上的 release / reservation 行为等价已证明；
- 不主张 2026-10-08 的历史 "Final Acceptance: PASS" 在当前 HEAD 成立；
- 不主张 B3120 手册级关闭（Manual Closure）；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张其他 Domain 的 Acceptance 或 Freeze；
- 不主张本次候签授权了真实环境 migration、业务数据库写入或远端 Git 操作。

## 7. 待业务所有者填写的决定

| 项 | 值 |
|---|---|
| 域级 Acceptance | ☐ 通过（`PLANNING_DOMAIN_ACCEPTANCE_PASS`）　☐ 有条件通过　☐ 退回 |
| Capability Freeze | ☐ 签发（`PLANNING_CAPABILITY_FREEZE`，45 项 `COVERED` 能力）　☐ 部分签发（能力清单：______）　☐ 不签发 |
| `PLAN-DEC-02` 处置 | ☐ 接受 §4.2 残余（理由：______）　☐ 授权新建 `PLANNING_MYSQL_V1` campaign |
| 随冻结接受的残余 | `PLAN-RES-01`、`PLAN-RES-02`、`PLAN-RES-03`、`PLAN-RES-04`　☐ 全部接受　☐ 部分（说明：______） |
| 未解决矛盾（须显式记录） | ______ |
