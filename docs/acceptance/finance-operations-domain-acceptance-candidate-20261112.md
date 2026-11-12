# Finance Operations 财务运营域级 Acceptance 与 Capability Freeze 候签（2026-11-12）

> **用途**：本文件是 Finance Operations 域**整域 Acceptance** 与 **Capability Freeze** 的候签材料：汇总逐项能力判定、Gate 证据、已披露限制与仍需业务所有者裁定的事项，供业务所有者据以签发（或退回）。本文件**不**构成 Acceptance 本身。
>
> **Owner**：Finance Operations Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`PENDING_APPROVAL` —— 候签材料，等待业务所有者决定。逐项证据见 [`docs/audits/finance-operations-capability-audit-20261112.md`](../audits/finance-operations-capability-audit-20261112.md)。
>
> **权威来源**：Requirement [`docs/requirements/finance-operations.md`](../requirements/finance-operations.md) §33.1～§33.50；Design [`docs/design/finance-operations.md`](../design/finance-operations.md) §28；能力矩阵 [`docs/operations/finance-operations-capability-matrix.md`](../operations/finance-operations-capability-matrix.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> **本文件的生成不等于** Git 提交、远端同步、发布、部署、真实环境 migration 或真实业务数据库写入。

```text
FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION
```

## 1. 候签范围

| 项 | 范围 |
|---|---|
| Domain | Finance Operations（产品架构第 7 个业务域） |
| 手册对标 | B3108 业务应付、B3109 暂估应付、B3110 业务应收、B3111 暂估应收、B3112 发票管理、B3113 出纳管理 |
| 能力集合 | FO01～FO58，共 **58 项**（55 Domain-Owned + 3 Integration-Backed：FO50 / FO57 / FO58，不得互相升降级 —— Requirement §33.4） |
| 覆盖判定（整改前） | `COVERED` **51** 项；`PARTIAL` **6** 项（FO03 / 04 / 05 / 19 / 31 / 48）；`MISSING` **1** 项（FO36）；`OUT_OF_SCOPE` **0** 项 |
| 覆盖判定（整改后） | `COVERED` **58** 项；`PARTIAL` **0**；`MISSING` **0**；`OUT_OF_SCOPE` **0** |
| 合同基线 | Requirement §33.1～§33.50（§33.39 的真实 MySQL 条款已按 `MYSQL-EV-01` 修正）；Design §28 |
| 本轮已实施 | 消除死代码模块、修正能力矩阵 5 处事实错误、增强 UAT 的能力证据断言、Requirement §33.39 / §33.50 的 MySQL 口径修正；**整改轮**：接线 FO03/FO04/FO05/FO19（新增 `finance-due-plan.js` 与 `finance_payment_term_installments`）、实现 FO36 发票运营报表、删除 FO31 的第二写入口、退役 FO48 的 legacy 对账账本、修复 3 项新发现缺陷 |
| 不在本次范围 | Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作、其他域的 Acceptance |

## 2. Gate 证据（当前 HEAD `22ba875`）

| Gate | 结果 |
|---|---|
| `pnpm test:finance:uat`（`finance-operations-final-uat.mjs`） | **32/32 PASS**；能力检查 **58/58 PASS**（矩阵形状 + **每行证据列非空**且引用的 UAT 身份存在） |
| `pnpm test:finance:responsive`（真实 Edge） | **24/24 PASS**（6 工作面 × 320/390/430/680） |
| 域内 focused（`--filter finance`） | **78/78 PASS** |
| 整改轮新增合同套件 `server/v22-finance-closure-wiring.test.js` | **6/6 PASS**（含 FO03 未知条款 409、无方案时行为不变等负例） |
| 共享基线 | FAST **632/632**、FULL **3727/3727**、HEAVY **67/67**、build、`git diff --check` 全 PASS |
| 文档一致性 | `current` N1、N3～N6、N8、N9 PASS、N2 `RETIRED`、**N7 FAIL**（既有 4 个历史提交的追溯债务）；`migration` C1～C6 全 PASS |

### 2.1 非空洞证明（变异实验）

| 实验 | 期望 | 结果 |
|---|---|---|
| 清空矩阵 FO36 行的证据列后重跑 UAT | 必须 FAIL | **FAIL**（exit 1，`FO36: 证据列为空`） |

## 3. 必须随验收一并接受的事实

### 3.1 整改轮已闭合的 6 项 `PARTIAL` 与 1 项 `MISSING`

| 能力 | 整改前事实 | 整改轮实施 |
|---|---|---|
| FO03 | 付款条款主数据只被自己的 CRUD 读取，结算路径不消费它 | `finance-due-plan.js` 把条款接入 open item 建立路径；条款支持 1..n 分期；未知条款码 409 fail closed |
| FO04 | `upsertDueSchedules` / `assertOpenItemSide` 只有路由调用点 | AR/AP 建立即写到期计划行（`SUM(scheduled_amount_cents) == amount_cents`），单一 `due_date` 降级为最后一行投影 |
| FO05 | 对账方案表自述「no economic effect」，无生产消费者 | `match_method` 决定该侧自动对账是否运行 |
| FO19 | Design §28 指向方案规则行，但表无消费者 | 自动对账按该侧活动方案运行；无方案时行为不变 |
| FO31 | 存在未路由的第二写入口（无容量守卫、审计实体位错误） | 删除该写入口，发票过账路径成为唯一写入口（源码扫描用例固定） |
| FO36 | 发票运营报表**完全无实现** | 实现 `GET /api/finance/reports/invoices`，按 §33.17 读取发票事实与源基数 |
| FO48 | 两套活的银行对账账本 | 退役 legacy 账本：删除其读写路由与写入口，表保留为历史且不再写入 |

整改轮另修复 3 项新发现缺陷：`FIN-DEF-08`（到期计划状态词表与表 CHECK 不一致，导致该路由每次都失败）、`FIN-DEF-09`（审计实体位错误）、`FIN-DEF-10`（第二写入口没有容量守卫）。

### 3.2 真实 MySQL 证据边界（按 `MYSQL-EV-01`）

| 段 | 覆盖 | 证据 |
|---|---|---|
| schema / migration 对等 | Finance 迁移链与表结构在真实 MySQL 8 上被接受 | `test:mysql:accounting-analytics` 的 `BOOTSTRAP_CURRENT_SCHEMA`（全量迁移集） |
| **RACE-01..15 的行为等价** | 15 个 race 场景（并发收付款、确认 vs 反冲、预付二次核销、退款 vs 核销、核销 vs 坏账、往来转移并发、发票重复过账、供应商发票匹配/过账、暂估转正式 vs 普通结算、资金调拨重复执行、对账单行二次对账、业务关账 vs 财务单据） | **在真实 MySQL 上未被单独取证** —— 唯一提供该证据的门禁 `scripts/gates/mysql-finance-concurrency-gate.mjs` 被 `blockUnmigratedAck4Entry` **永久阻断**。实现齐备（`server/mysql-finance-operations-concurrency.integration.js`，16 个用例），但**从未在真实 MySQL 上执行过** |

Requirement §33.39 的义务**未被取消**：15 个 race 仍是必须交付的契约项，其「真实 MySQL 未取证」状态必须作为显式残余登记。Requirement §33.49 的 Hard Stop 第 12 条（MySQL migration 无法保证 parity）**未触发** —— parity 已证明，缺的是 race **行为**证据。

## 4. 本轮已处置

| 编号 | 事实 | 处置 |
|---|---|---|
| `FIN-DEF-01` | `server/modules/finance-manual-ar-ap.js` 是 0 调用方的死代码，且被矩阵 FO14 行写成 primary service | **已删除**（zero-caller proof：无任何 importer）；矩阵 FO14 行更正为 `finance-ar-open-item / finance-ap-open-item` |
| `FIN-DEF-04` | UAT 的 `58/58 PASS` 只是矩阵**形状**检查，32 项 UAT ≠ 58 项能力 | **已增强**：现在逐行断言证据列非空、引用的 UAT 身份存在；变异实验证明有效 |
| `FIN-DEF-05` | 矩阵 5 处事实错误（FO02 表名/路由、FO14 primary service、FO39 路由、FO58 primary service、FO38 schema） | **已修正**（FO38 另按 Design §28.11.1 明确为 `bank_accounts` 的加法列） |

## 5. 未解决矛盾（需要业务所有者裁定）

| 编号 | 事项 | 处置 |
|---|---|---|
| `FIN-DEC-01` | FO36 发票运营报表无实现 | **已裁定并实施**：补齐实现 |
| `FIN-DEC-02` | FO03 / FO04 / FO05 三个 master 无业务消费者（连带 FO19） | **已裁定并实施**：接线三个 master |
| `FIN-DEC-03` | FO31 的第二个写入口与 FO48 的 legacy 对账账本 | **已裁定并实施**：删除重复写入口并退役 legacy 账本 |
| `FIN-DEC-04` | 真实 MySQL race 行为等价未取证 | **已裁定**：按 `MYSQL-EV-01` 接受为显式残余（§3.2 已写明边界）；不新建 `FINANCE_MYSQL_V1` campaign |

**尚需业主在签发时确认的两项**：

1. 随冻结接受的残余：`PLAN` 侧的 `FIN-RES-01`（RACE-01..15 的真实 MySQL 行为等价未取证）、`FIN-RES-02`（FO02 的管理面 list/upsert 仍无专门用例，其消费路径有）、`FIN-RES-03`（N7 文档追溯债务，与本域无关）。
2. 域级 Acceptance 与 Capability Freeze 的签发范围。

## 6. 本次候签**不**主张的内容

- 不主张真实 MySQL 上的 RACE-01..15 行为等价已证明；
- 不主张 58/58 的矩阵检查等于 58 项能力各自有端到端证据；
- 不主张 B3108–B3113 手册级关闭（Manual Closure）；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张其他 Domain 的 Acceptance 或 Freeze。

## 7. 待业务所有者填写的决定

| 项 | 值 |
|---|---|
| 域级 Acceptance | ☐ 通过（`FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS`）　☐ 有条件通过　☐ 退回 |
| Capability Freeze | ☐ 签发（`FINANCE_OPERATIONS_CAPABILITY_FREEZE`，58 项 `COVERED` 能力）　☐ 部分签发（能力清单：______）　☐ 不签发 |
| 随冻结接受的残余 | `FIN-RES-01`（RACE-01..15 真实 MySQL 行为等价未取证）、`FIN-RES-02`、`FIN-RES-03`　☐ 全部接受　☐ 部分（说明：______） |
| 未解决矛盾（须显式记录） | ______ |
