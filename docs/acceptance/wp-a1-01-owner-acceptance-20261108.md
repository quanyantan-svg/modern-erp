# WP-A1-01 正式 Owner Acceptance 记录（2026-11-08）

> 用途：登记业务所有者对 `WP-A1-01`（`AUD-FE-001`，寻源与定价页演示写入入口安全关闭）的**有界验收决定**。
>
> Owner：Procurement & Outsourcing Domain Owner（验收决定与残余风险接受）；Platform / QA（技术证据维护）。
>
> 状态：`ACCEPTED` —— 业务所有者于 **2026-11-08** 作出决定 **`ACCEPT_WITH_BOUNDED_RESIDUALS`**，
> 签发标识 **`WP_A1_01_ACCEPTED_WITH_BOUNDED_RESIDUALS`**。该决定**附有公开、未关闭的证据限制**（见 §4、§5）。
> 本决定**不**构成 Requirement 验收、Design PASS、Capability Closure、Domain Acceptance、Manual Closure
> 或 Release Readiness。
>
> 权威来源：Requirement [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.14.1
> —— **待验收增量，状态 `PENDING_APPROVAL`**；Design [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.34.1
> —— **待审增量，状态 `PENDING_REVIEW`**（M1-Core 首期的 Active Design 是
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)）；
> 审计台账 [`docs/audits/b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md) §13 与 §13.2；
> 唯一项目状态 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §42 与 §44。
>
> 来源 SHA：实施提交 `6cb514a66ebf6587fc5899bf0a7a4cbe1dd4c66e`；候签记录撰写基线 `master` @ `a39beac7a334ab4cf32fd5bc6b33ef978d6a6d65`；
> Owner 复核基线 `github/master` @ `6ee0ad3c98612f03107aa39ead0eae6c5e2c8f64`。
>
> 本文件是验收证据，不取代 Requirement、Design 或唯一项目状态登记表。**本文件的生成本身不构成 Git 提交或远端同步。**

```text
WP_A1_01_ACCEPTED_WITH_BOUNDED_RESIDUALS
```

## 1. 验收对象、范围与 Owner 决定

| 项 | 值 |
|---|---|
| 工作包 | `WP-A1-01` |
| 审计 Issue | `AUD-FE-001` —— 寻源与定价页面把演示操作接入正式写 API |
| Owner 决定来源 | `OPEN-BUSINESS-DECISIONS.md` §4.1 的 `SAFE_CLOSE` 意图；Requirement §31.14.1 |
| 实施提交 | `6cb514a66ebf6587fc5899bf0a7a4cbe1dd4c66e`（`关闭寻源页面演示写入并保留只读查询`） |
| 验收范围 | **仅** 寻源与定价页的演示写入入口移除 + 合法只读查询保留 |
| 明确不在范围 | `PRC-06` Capability Closure；`AUD-PRC-002`（Hash）；VMI；`AUD-OUT-001`；M1-Core 七 Gate；Domain Acceptance；Manual Closure；Release Readiness；Release / Deploy |

### 1.1 Owner 决定（2026-11-08）

业务所有者于 **2026-11-08** 在本轮对话中作出**明确的有界接受决定**：

```text
WP_A1_01_ACCEPTED_WITH_BOUNDED_RESIDUALS
```

| 项 | 值 |
|---|---|
| 决定 | `ACCEPT_WITH_BOUNDED_RESIDUALS` |
| 签发标识 | `WP_A1_01_ACCEPTED_WITH_BOUNDED_RESIDUALS` |
| 验收对象 | `WP-A1-01` / `AUD-FE-001`，范围**仅限**本节范围栏所列 |
| 验收日期 | 2026-11-08 |
| 决定来源 | 本轮对话中业务所有者明确的条件授权，及业务所有者对远端代码与本候签材料的独立技术复核 |
| 被接受的证据限制 | §4 全部六项（**含**旧功能 UAT 15/28、FULL 未完成、无本轮真实 MySQL Gate 证据） |
| 被接受的残余风险 | §5 全部 R-A1-01-01 ～ R-A1-01-05 |
| 决定**不**覆盖 | §6 全表 |

**决定来源的边界（不得虚构）**：本决定的来源是**业务所有者在当前对话中的明确授权**。仓库侧可核验的复核对象为 `github/master` @ `6ee0ad3c98612f03107aa39ead0eae6c5e2c8f64` 的代码与本文件正文。**不存在虚构的手写签名、电子签章或外部审批单**；本轮 Review 的执行人、评审编号与逐项发现未在本仓库记录，本文**不代为杜撰**。

**本次接受的含义**：仅接受本节范围栏所列的 `WP-A1-01` 实施事实与其证据，**并**把 §4 的六项证据限制与 §5 的五项残余风险接受为**已知且未关闭**的残余风险。接受**不**等于：

- §4 的任何一项限制被消除 —— 旧功能 UAT 15/28、FULL 未完成、无本轮真实 MySQL Gate 证据**仍然开放**；
- §5 的任何一项残余风险被证明不存在；
- `AUD-FE-001` 的**其它**能力面（`AUD-FE-002` / `AUD-FE-003`）被关闭；
- `PRC-06` 变为 `COVERED`，或 B3101 / B3121 变为 `COVERED`。

**实施授权的来源（须与 Requirement / Design 状态区分）**：`WP-A1-01` 的实施授权来自**先前独立的有界 Implementation 授权**（审计台账 §13 与 `log/2026-11-07.md`），**不是**来自 §31.14 或 §26.34 的获批 —— §31.14 至今仍为 `PENDING_APPROVAL`，§26.34 至今仍为 `PENDING_REVIEW`。本次验收**不**改变这两项状态，也**不**追溯性地把该实施授权解释为 Requirement 或 Design 的批准。

## 2. 实施证据（提交 `6cb514a`）

提交改动 2 个文件（+18 / −37）：

| 文件 | 变更 |
|---|---|
| `src/pages/sourcing-pricing.jsx` | 删除 `runAllocation()` 函数（含对 `POST /api/procurement/sourcing-decisions` 的正式写调用）、删除「模拟寻源分配」`BusinessAction` 按钮、删除 `allocating` 状态与固定演示参数（`PR-DEMO-001` / `product-001` / `quantity: 100` / `new Date()` 业务日期）；页面头注释移除 `POST /api/procurement/sourcing-decisions` 条目。保留 Source List、Quota、Price List、Pricing Discount 的只读查询与展示。 |
| `scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs` | 原「点击模拟寻源分配按钮 → 断言 POST 返回 200」的断言，改为：断言「模拟寻源分配」按钮**不存在**；依次切换 `Quota` / `Price List` / `Pricing Discount` / `Source List` 四个只读页签；监听请求，断言只读查询**不触发** `POST /api/procurement/sourcing-decisions`。 |

逐项对照 Requirement §31.14.1「移除『模拟寻源分配』及其可调用写入函数；现有合法 Source List、Quota、定价查询和独立获批功能保持可用；不借此新增 Preview API」：

| Requirement 义务 | 本提交是否满足 | 证据 |
|---|---|---|
| 不得保留以 `PR-DEMO-001`、`product-001` 或固定数量调用正式写 API 的演示操作 | **满足** | `runAllocation()` 及其固定参数整体删除 |
| 移除「模拟寻源分配」及其可调用写入函数 | **满足** | 函数与按钮同时删除；浏览器断言「按钮不存在」 |
| 保留现有合法 Source List、Quota、定价查询和独立获批功能 | **满足** | 四个只读页签在 4 个视口下均可切换并正常渲染 |
| 不新增 Preview API | **满足** | 提交只含删除，无新增 API / 路由 / 状态机 |

## 3. 验证证据（2026-11-08 实测）

### 3.1 浏览器响应式回归 24 / 24 PASS

命令：`node scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs`
实测结果：`PASS=24 FAIL=0 TOTAL=24`，**退出码 0**。

**范围必须明确区分**（本记录不把整体套件与寻源子集混为一谈）：

| 范围 | 构成 | 结果 |
|---|---|---|
| **整体套件** | 2 个工作面（委外加工 `outsourcing`、寻源与定价 `sourcing-pricing`）× 4 个视口（320 / 390 / 430 / 680）× 3 个真实主体（`admin`、委外业务员、销售专员）= **24** | **24 / 24 PASS** |
| **寻源子集** | 1 个工作面（`sourcing-pricing`）× 4 个视口 × 3 个主体 = **12** | **12 / 12 PASS** |
| **其中与 WP-A1-01 直接相关的断言格** | `admin` × `sourcing-pricing` × 4 个视口 = **4** | **4 / 4 PASS**：断言「模拟寻源分配」按钮不存在、四个只读页签可切换、只读查询不产生 `POST /api/procurement/sourcing-decisions` |

寻源子集另外 8 格（委外业务员 / 销售专员 × 4 视口）断言的是服务端 RBAC：委外业务员与销售专员对寻源读接口均得到服务端 **403**，页面不得渲染伪造数据。该部分属**既有 RBAC 合同**，不是本工作包的新增义务。

整体套件的 24 格同时断言：目标工作面**真实渲染**（不接受登录页或「应用暂时无法打开」）、无横向溢出（`w=viewport/vp overflow=false`）、无 `api.get/api.post` TypeError、错误展示符合预期。

### 3.2 构建 PASS

命令：`pnpm.cmd build`
实测结果：`✓ built in 3.82s`，**退出码 0**。

### 3.3 本轮补充执行的其余命令

| 命令 | 实测结果 | 退出码 |
|---|---|---|
| `node --test server/procurement-sourcing-pricing.test.js` | 5 / 5 PASS | 0 |
| `node scripts/testing/run-tests.js fast` | 576 / 576 PASS | 0 |
| `pnpm.cmd build` | built in 3.82s | 0 |
| `node scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs` | PASS=24 FAIL=0 TOTAL=24 | 0 |
| `node scripts/testing/run-tests.js fast --filter procurement-sourcing-pricing` | **[run-tests] suite=fast files=0** → `node --test` 无文件参数 → Node 默认全仓发现：3441 tests / 429 suites，3437 pass，**4 fail** | **1** |

**关于最后一行命令的说明（不得省略）**：任务指定的 `pnpm.cmd test:fast --filter procurement-sourcing-pricing` **没有**筛选到寻源定向测试文件——`server/procurement-sourcing-pricing.test.js` 登记在 **FULL** 套件，不在 FAST 套件（FAST=29 / FULL=222）。过滤结果为 0 个文件后，runner 以**无文件参数**启动 `node --test`，Node 回退为默认全仓发现，从而把不属于 FAST / FULL 的 `server/production-safety.test.js` 一并跑了进来。该 4 项失败为：

1. `production: ERP_SEED_DEMO=true explicitly opts in` —— 陈旧断言：Demo Seed 现创建 **7** 个用户（5 个基础角色 + M1-P-03 新增的 2 个委外角色，2026-11-02 M1-Core WP-0 起），测试仍断言 5；
2. `development (default): demo users created` —— Windows `EBUSY` 临时库 `unlink` 失败（由第 1 项断言失败后未执行 `db.close()` 的级联）；
3. `production: existing migrations still complete` —— 同一 `EBUSY` 级联；
4. `server/production-safety.test.js` —— 文件级汇总。

这 4 项失败**与本轮变更无关**：本轮改动只涉及 `docs/**` 与 `log/**` 下的 Markdown，未触及该测试文件或 Demo Seed；`server/production-safety.test.js` 亦**未登记**在 FAST / FULL / HEAVY 任一套件清单中（属 `AGENTS.md §10` 意义上的未分类测试文件，本轮不处理）。本记录**不**把该命令记为 PASS，也**不**把它的失败归因于 WP-A1-01。

## 4. 已披露的限制与未证明事项（不得隐藏、不得改写为 PASS）

以下六项限制随 §1.1 的接受决定**一并被接受为已知限制**，但**没有任何一项被消除**。本节原文**不得**被改写为 PASS，也**不得**因接受决定而删除或弱化。

1. **旧功能 UAT 为 15 / 28，不是 PASS。** `scripts/acceptance/procurement-outsourcing-functional-uat.mjs` 全套 **28** 项中仅 **15** 项通过；其中**只有 UAT-04 按新合同通过**（配额 GET 200 + 正式决策 POST 409 `SOURCING_DECISION_WRITE_CLOSED`）。其余失败集中在收货与委外既有链路，属**既有**缺陷面，**不**由本工作包引入，也**不**由本工作包关闭。**全套不记为 PASS。**
2. **FULL 回归未完成，不记为 PASS。** FULL 曾启动但因耗时停止；**停止前**仍出现既有的 `m1-core-g07-diagnostics.test.js` 临时证据文件 `SetAccessControl` 权限拒绝。FULL 在本轮**没有**跑完，因此**不得**声称 FULL PASS，也不得以 FAST 576/576 替代 FULL 结论。
3. **没有本轮真实 MySQL Gate 证据。** 本轮**未连接**任何真实 MySQL，**未**执行 `test:mysql` / `test:mysql:concurrency` / 任何 disposable MySQL Gate，**未**执行 Migration、Reset、Bootstrap 或 Cleanup。全部浏览器与测试证据均来自临时 SQLite 与本地产物 `dist/`。因此「MySQL 与 SQLite 双端等价」**未被证明**。
4. **WP-A1-01 的服务端侧不构成独立证据。** 本工作包的义务是**前端**入口移除。服务端正式写入口的关闭是**另一个**独立工作包 `WP-A1-02`（`AUD-PRC-001`），其验收记录为 [`wp-a1-02-owner-acceptance-20261108.md`](./wp-a1-02-owner-acceptance-20261108.md)。本记录**不**以 WP-A1-02 的证据替代 WP-A1-01 的证据。
5. **静态删除不等于入口不可达的全域证明。** 本轮证明的是「该页面不再存在该按钮、不再发出该 POST」；**未**证明其它前端或脚本路径不存在同类演示写入。
6. **旧功能 UAT 的 15/28 与 FULL 未完成两项限制，对本工作包的正面结论构成上限。** 即使 Owner 接受 WP-A1-01，也**不得**据此声称 B3101 / B3121 的旧功能面已通过验收。

## 5. 残余风险（**已于 2026-11-08 由业务所有者一并接受**；仍未消除、仍未关闭）

| # | 残余风险 | 说明 |
|---|---|---|
| R-A1-01-01 | 无真实 MySQL 证据 | 演示写入入口的移除是纯前端行为，风险主要为「其它路径仍可达」，当前未取得 MySQL 侧证据 |
| R-A1-01-02 | 只读查询的回归覆盖仅来自浏览器 harness | 四个只读页签的可切换性由响应式 UAT 断言；未新增服务端定向测试来锁定这些 GET 的响应合同 |
| R-A1-01-03 | 旧功能 UAT 15/28 未解决 | 收货与委外既有链路的失败面仍开放；若日后被归因到本工作包，本记录不提供抗辩 |
| R-A1-01-04 | FULL 未完成 | 无完整回归基线；若 FULL 后续暴露回归，无法区分是本工作包还是既有缺口 |
| R-A1-01-05 | `server/production-safety.test.js` 未分类 | 该文件既不在 FAST / FULL / HEAVY，也不在治理扫描根内；其陈旧断言与 Windows `EBUSY` 级联会持续污染按任务书指定的过滤命令 |

## 6. 明确不因本次验收关闭的事项

- `AUD-FE-002`（寻源与定价页面缺少完整维护交互）、`AUD-FE-003`、`AUD-PRC-001`～`AUD-PRC-009`、`AUD-VMI-001`～`AUD-VMI-003`、`AUD-OUT-001`、`AUD-OUT-002` 的状态**全部不变**。
- `PRC-06` **不**因本记录变为 `COVERED`；`docs/status/CAPABILITY_MATRIX.md` **不**更新。
- B3101 / B3121 **仍为 `BLOCKED`**；Procurement & Outsourcing Domain Acceptance **仍为 `NOT READY`**（`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`）。
- M1-Core 七 Gate 的 7 / 7 `PASS` 及其既有范围**不变**；`R-01`～`R-20`、`D-01`～`D-04`、`WP-I` / `WP-J`、`M-15` 原状态**不变**。
- §26.34 的 Design 状态**不**因本记录改变：`PENDING_REVIEW` 保持，`DESIGN_PASS` **未签发**；§31.14 的 Requirement 状态同样**不**因本记录改变：`PENDING_APPROVAL` 保持，Requirement 验收**未签发**。**WP-A1-01 / WP-A1-02 的 Acceptance 不是 Design PASS，也不是 Requirement 验收**，`A1-D-RV-01`～`A1-D-RV-04` 四个 Owner Review Gate 状态**不变**。
- 本记录**不**授权真实 MySQL、Migration、数据库写入、DDL、Push、Merge、Tag、Release、Deploy。

## 7. Owner 决定记录（**已作出**，2026-11-08）

```text
决定标识：WP_A1_01_ACCEPTED_WITH_BOUNDED_RESIDUALS
决定：ACCEPT_WITH_BOUNDED_RESIDUALS
验收日期：2026-11-08
决定来源：业务所有者在本轮对话中的明确授权及独立技术复核
```

- 本栏由**业务所有者的决定**填入，**不代填**签名人、审批编号或电子签章（来源边界见 §1.1）。
- 候签阶段的原始候选态 `PENDING_OWNER_APPROVAL`、§3 的全部测试证据（含 `not ok` 项）与 §4 / §5 的限制与残余风险**原样保留**，**不**因本次接受决定而被改写、删除或弱化。
- `AUD-FE-001` 与 `WP-A1-01` 的状态由 `TESTED` / `PENDING_OWNER_APPROVAL` 迁移为 `ACCEPTED`（附有界残余风险）。该迁移**仅限**本文件 §1 范围栏所列，**不**外溢到 §6 的任何一项。

## 8. 未解决矛盾

1. **任务书指定的过滤命令与仓库套件登记不一致。** `pnpm.cmd test:fast --filter procurement-sourcing-pricing` 选出 0 个文件并退化为全仓发现；定向文件实际登记在 FULL。这使得「按任务书原样执行」与「真正跑到目标测试」两件事在本轮无法同时成立。本记录按**两种口径都记录真实结果**的方式处理，未做任何掩盖，也**未**修改 `scripts/testing/`（本轮禁止修改 `scripts/`）。该矛盾需由业务所有者裁定：是修订任务书命令口径，还是修订套件登记策略。
2. **未分类测试文件与治理扫描根的缺口。** `server/production-safety.test.js` 不在任何套件清单内，其失败只在退化的过滤命令里暴露；这是 `AGENTS.md §10`「静默不分类新增 `*.test.js`」所禁止的状态。本轮只做记录与披露，未做分类或修正。
