# Master & Engineering 工程主数据域级 Acceptance 与 Capability Freeze 记录（2026-11-12）

> **用途**：登记业务所有者对 Master & Engineering 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Master & Engineering Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；**17 项 `COVERED` 能力已冻结**。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/master-engineering.md`](../requirements/master-engineering.md) §28.1～§28.10；Design [`docs/design/master-engineering.md`](../design/master-engineering.md) §23；逐项判定 [`docs/audits/master-engineering-capability-audit-20261112.md`](../audits/master-engineering-capability-audit-20261112.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
MASTER_ENGINEERING_DOMAIN_ACCEPTANCE_PASS
MASTER_ENGINEERING_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在本轮对话中指示「现在完成剩下几个业务域的收尾工作」「最终目标是该 mobile erp 系统各业务域的 acceptance 完成整个项目验收」，并就真实 MySQL 证据口径裁定「逐域新建专属 campaign」。据此：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`MASTER_ENGINEERING_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 17 项 `COVERED` 能力**（`MASTER_ENGINEERING_CAPABILITY_FREEZE`） |
| 能力判定 | §22.18 / §28.3 的 **21 项**能力：`COVERED` **17**、`PARTIAL` **1**（Old Material Cleanup，按 §28.4 自身目标口径）、`OUT_OF_SCOPE` **3**（Multi-Org Distribution、Mold / Mold Combination、Complex Auxiliary Attributes，均由 §28.7 排除）、`MISSING` **0** |
| `ME-DEC-01`（真实 MySQL 的列级 parity 与并发行为等价未单独取证） | **已解决**：按所有者裁定为本域建立独立 ACK-4 campaign `MASTER_ENGINEERING_MYSQL_V1`，在真实 MySQL 8.0.37 上取得 `RESULT = PASS` / `ACK-4 STATE = FINISHED`，竞态套件 4/4 PASS（§2.1） |
| `ME-DEC-02`（「逐列 parity 比对」未取证） | **不解决**：本域 15 张表不在任何 campaign 的列级 parity 清单内；本轮取证的是「schema 被真实 MySQL 8 接受并成功 bootstrap」与「并发行为等价」。**作为显式残余随冻结接受**，不得表述为已证明逐列 parity |
| `ME-DEC-03` | 签发范围：域级 Acceptance + Capability Freeze；**不**签发 Manual Closure、Release Readiness、发布与部署 |
| 实现锚点 | `4584f22`（竞态套件退出监听修正，其后为 MQ 域 Requirement 登记）；域能力整改与 campaign 建立见 `b514451`、`b40b63f` |

决定来源是当前对话中所有者的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：整改轮与并发整改后的本域 Active Contract（Requirement §28.1～§28.10 / Design §23）及其 17 项 `COVERED` 能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3118 手册级关闭）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance。

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3740/3740 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 域内 focused（9 个既有工程套件） | **63/63 PASS** |
| 合同套件 `server/engineering-reference-lifecycle.test.js` | **7/7 PASS** |
| 合同套件 `server/engineering-topology-cleanup.test.js` | **5/5 PASS** |
| 浏览器（真实 Edge，`v17-engineering-frontend.mjs`，4 工作面 × 320/390/430/680） | **PASS**；含「打开参考资料详情 → 断言编辑/停用动作存在 → 断言触控目标不小于 44px」 |
| 非空洞证明（变异实验） | 把生命周期按钮强制为 20px 后浏览器验收按预期 **FAIL**，并精确指出 `编辑` / `停用` 两个 22px 目标 —— 该门禁真正承担了重量 |
| 治理守卫（跨域错误码耦合 / 验收记录有效性） | 双 PASS |
| 文档一致性 | `current` 模式 N1、N3～N6、N8、N9 PASS，N2 `RETIRED`，**N7 FAIL**（四个既有历史提交的追溯债务，与本域无关）；`migration` 模式 C1～C6 全 PASS |

### 2.1 真实 MySQL 8.0.37 证据（本域专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `MASTER_ENGINEERING_MYSQL_V1`（`RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_ENGINEERING_RACES` → `CLEANUP_SCHEMA_POST_RUN`） |
| Run | `cbc6b6a6-5ed2-4460-898c-9140ee1916d7` |
| Commit | `4584f22` |
| 结果 | `RESULT = PASS`；`ACK-4 STATE = FINISHED`（清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明；只读复核 `tables=0 views=0`） |
| 目标 | `modern_erp_domain_test` @ `127.0.0.1:3306`；server uuid `256c7a4e-d275-11f1-885b-b025aa71d167`；grants sha256 `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e`；MySQL 8.0.37 |
| 竞态套件 | `server/mysql-master-engineering-concurrency.integration.js` **4/4 PASS** |

**覆盖什么**

- `BOOTSTRAP_CURRENT_SCHEMA` 在真实 MySQL 8 上运行**全量当前迁移集**，证明本域 15 张新表、28 个加法列、2 个工序级拓扑列与 ECO compare-and-swap 语义被真实 MySQL 接受并成功 bootstrap；
- `RUN_ENGINEERING_RACES` 在真实 MySQL 8 上证明本域并发行为等价：
  - **ME-RACE-01** 并发双 apply 同一 ECO → 恰好一个 `200`、一个 `409`；目标产品只剩一个 `ACTIVE` BOM 且版本为 `2.0`；不产生重复版本行；`APPLY` 审计恰好 1 条；
  - **ME-RACE-02** 并发 `approve` 与 `reject` 同一 ECO → 恰好一个终态、恰好一条终态审计；
  - **ME-RACE-03** 并发双 deactivate 同一 master → 两个调用都幂等成功，`DEACTIVATE` 审计**恰好 1 条**（该断言在「事务外读权威状态」的实现下会失败，因此它真正承担了重量）；
  - **ME-RACE-04** 并发停用被活动引用的 master → 两个调用都 `409`，master 仍 `active=1`，不落任何审计。

**不覆盖什么**

- 「真实 MySQL 上的**逐列** schema parity 比对」未被单独取证（本域 15 张表不在任何 campaign 的列级 parity 清单内）；
- 两个**不同** ECO 并发作用于同一目标 BOM 时的版本唯一性未被单独取证（ECO 行锁只序列化同一 ECO 的并发）；
- 真实 MySQL 上的生产吞吐、并发连接数与长稳行为不在本轮范围。

### 2.2 首轮专属 campaign 的失败登记

首个专属 campaign run `8636a783-0171-46a1-aa1f-b7d55dec634e`（commit `b514451`）**未通过**：ME-RACE-01 PASS（577ms）后 ME-RACE-02 永久挂起。根因是**测试装置**的退出监听竞态（`exit` 监听挂载晚于闸门放行，先退出的 worker 事件被漏掉），**不是**被测生产代码或合同缺陷。处置与修正见逐项审计台账 §5.2.1。本条随冻结一并登记，不隐藏。

## 3. 本次验收同时确认的事实

- 本域 ECO 状态机迁移与工程参考资料 master 的生命周期，现在**在事务内复读权威状态**并以先决状态做 compare-and-swap；并发双 apply、并发 approve/reject、并发双 deactivate 三类缺陷已在真实 MySQL 8 上被证明关闭（§2.1）。
- 上述收紧**未改变**已签发域的行为，也未改变本域任何 API 的请求/响应字段；它把实现收敛到 Requirement §28.8 A 已声明的原子语义。
- 本域 21 项能力中无 `MISSING`；`PARTIAL` 一项的残余是 Requirement §28.4 自身定义的跨域依赖，不是实现缺口。

## 4. 冻结内容与解冻条件

- 冻结对象：Requirement §28 / Design §23 的当前正文，以及 17 项 `COVERED` 能力的实现、schema、测试与证据。
- 冻结期间对上述对象的任何修改，必须先走 Requirement / Design 变更并由本域 Owner 确认；不得以「顺手修复」「统一风格」名义在冻结树上直接改写。
- 解冻条件：能力合同或实现语义需要变更；或 §2.1 的残余需要被实际关闭。

## 5. 已知限制（随本次验收一并接受）

| 编号 | 限制 |
|---|---|
| `ME-RES-01` | 真实 MySQL 上的逐列 schema parity 比对未被单独取证（§2.1「不覆盖什么」） |
| `ME-RES-02` | 两个不同 ECO 并发作用于同一目标 BOM 时的版本唯一性未被单独取证 |
| `ME-RES-03` | Old Material Cleanup 的「预计入供应」一段按 §28.4 仍为 `CROSS_DOMAIN_DEPENDENCY`，本域不消费 |
| `ME-RES-04` | N7 文档追溯债务：成因是四个**已推送**历史提交的 message 缺少变更章节引用；消除它需改写已发布 Git 历史，本轮不授权。与本域能力无关。 |

## 6. 本记录**不**主张的内容

- 不主张真实 MySQL 上的逐列 schema parity 已证明；
- 不主张两个不同 ECO 并发作用于同一目标 BOM 时版本唯一性已被证明；
- 不主张「预计入供应」已接入 Use-Up-Old；
- 不主张 Multi-Org Distribution、Mold / Mold Combination、Complex Auxiliary Attributes 已实现（三项按 §28.7 排除）；
- 不主张 B3118 手册级关闭（Manual Closure）；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张其他 Domain 的 Acceptance 或 Freeze。

## 7. 登记与后续

| 项 | 位置 |
|---|---|
| 逐项能力台账 | [`docs/audits/master-engineering-capability-audit-20261112.md`](../audits/master-engineering-capability-audit-20261112.md) |
| 候签材料（已被本记录取代） | [`docs/acceptance/master-engineering-domain-acceptance-candidate-20261112.md`](./master-engineering-domain-acceptance-candidate-20261112.md)，状态改为 `SUPERSEDED` |
| 能力矩阵 | [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md) B3118 行 |
| 项目状态登记表 | [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §57 |
| 当日日志 | [`log/2026-11-12.md`](../../log/2026-11-12.md) |

**下一域**：按就绪度顺序继续域 4 —— **Manufacturing & Quality**（MQ-01..43）。
