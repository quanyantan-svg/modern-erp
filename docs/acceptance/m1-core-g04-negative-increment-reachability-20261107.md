# M1-Core G04「增量倒冲数量小于 0」可达性审查（2026-11-07）

> 用途：审查 Active Design §13.1 的 G04 拒绝断言「增量 < 0 或 > 可用净供应 409」中
> **「增量 < 0」这一半**的合法生产 HTTP 可达性，给出可达性分类、D-1 / D-2 方案对比与
> 推荐，供 Owner 裁定。
> Owner：Platform / Database Safety / QA（只读分析）；Procurement & Outsourcing Domain Owner
> （可达性裁定与 Design 修订决定）。
> 状态：`PENDING_APPROVAL` —— 本轮**只读分析**：未修改任何代码、未修改 Active Design、
> 未签发任何裁定、未连接真实 MySQL。
> 权威来源：Active Design `docs/design/procurement-outsourcing-m1-core.md` §13.1 G04 行、
> §9.1；Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5 G04 行；
> 决策 `docs/decisions/OPEN-BUSINESS-DECISIONS.md` M1-P-02。
> 本文是审查证据，**不**替代 Requirement、Design 或 `docs/status/PROJECT_STATUS.md`。

## 1. 结论摘要

| 断言 | 可达性分类 | 依据 |
|---|---|---|
| 增量 > 可用净供应 → 409 | **合法生产 HTTP 可达**，且**已由真实 MySQL 证明** | `server/modules/outsourcing-finance.js:206-208`；G07 Run `b29c3f1f` 的 CR-07 / CR-08 |
| 增量 < 0 → 409 | **仅 L3 SQL / 历史数据异常可构造**；合法生产 HTTP **不可达** | §2–§6 的五项不变量 |
| 增量 < 0 的**防御性行为**（异常数据下 409 + 零副作用） | **当前无断言位** | §8 的 D-1 |

**核心结论**：在当前不变量下，「增量 < 0」**无法由合法生产 HTTP 构造**；但 Active Design
§13.1 G04 行把它与「> 可用净供应」并列写成同一条 L1 拒绝断言，而 §13.1 未给 G04 提供
L2 兜底层（这与 §13.1.1 对 G03 的规定不同）。因此该断言在**字面意义上不可满足**，
需要 Owner 决定如何修正合同与如何为其防御性行为取证。

## 2. 审计项一 —— `outsourcing_receipts.business_status` 的全部合法状态迁移

| 方向 | 位置 | 说明 |
|---|---|---|
| 建立 | `server/modules/outsourcing.js:669-673` | `INSERT INTO outsourcing_receipts(... business_status ...) VALUES(..., 'PENDING_INSPECTION', ...)` —— **固定字面量**，无入参 |
| 变更 | `server/modules/outsourcing-finance.js:234` | `UPDATE outsourcing_receipts SET business_status='EFFECTED', backflush_material_value_cents=?, total_cost_cents=?, version=version+1, updated_at=? WHERE id=? AND business_status='PENDING_INSPECTION'` —— **全仓库唯一**一处对 `outsourcing_receipts` 的 UPDATE，且**不改写 `quantity`** |
| 删除 | — | `server/` 内**不存在** `DELETE FROM outsourcing_receipts` |

⇒ 合法迁移只有 **PENDING_INSPECTION → EFFECTED**，单向、不可逆、无数量改写、无删除。
已生效收货没有回退路径。

## 3. 审计项二 —— `outsourcing_material_list.backflushed_quantity` 的全部写入者

| 写入者 | 位置 | 形态 |
|---|---|---|
| 收货生效路径 | `server/modules/outsourcing-finance.js:217` | `SET backflushed_quantity = backflushed_quantity + ?`，前置 `if (incremental <= 0) continue;` ⇒ 增量恒 **> 0** |
| 倒冲复核路径 | `server/modules/outsourcing.js:607` | 同上，同样前置 `if (incremental <= 0) { ...; continue; }` |
| schema 默认 | `server/migrations/procurement-outsourcing-schema.js:501` | `backflushed_quantity REAL NOT NULL DEFAULT 0` —— **无迁移改写既有值** |

⇒ `backflushed_quantity` **单调不减**，且每次写入的增量恒为正。

## 4. 审计项三 —— BOM 快照的 `per_unit_quantity` / `required_quantity` 不变量

| 事实 | 位置 |
|---|---|
| 物料清单快照**一次性建立**：已存在即 409 `OUTSOURCING_MATERIAL_SNAPSHOT_IMMUTABLE` | `server/modules/outsourcing.js:420-422` |
| `required_quantity = per_unit_quantity × order_quantity`，两者在**同一条 INSERT** 中写入 | `server/modules/outsourcing.js:424-431` |
| 每次计算增量前复核：`isFinite(per_unit_quantity)`、`isFinite(required_quantity)`、且 `|snapshot.required_quantity − m.required_quantity| ≤ 1e-9`，否则 409 `OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED` | 生效路径 `outsourcing-finance.js:198-201`；复核路径 `outsourcing.js:588-591` |

⇒ 倒冲基数被**冻结**且每次计算前复核，不可能漂移。

## 5. 审计项四 —— 累计合格收货数量是否可能下降

| 路径 | 计算式 | 位置 |
|---|---|---|
| 收货生效 | `cumulativeFinished = alreadyEffective(排除本单) + 本单数量`，其中 `alreadyEffective = SUM(quantity) WHERE order_id=? AND business_status='EFFECTED' AND id<>?` | `server/modules/outsourcing-finance.js:185-186` |
| 倒冲复核 | `cumulativeFinished = SUM(quantity) WHERE order_id=? AND business_status='EFFECTED'`（含本单） | `server/modules/outsourcing.js:583` |

单调性依赖三项事实，全部成立：① EFFECTED 集合只增不减（§2：状态单向、无删除）；② 已生效收货的
`quantity` 不被改写（§2：唯一的 UPDATE 不含 `quantity` 列）；③ 无 `DELETE`（§2）。

⇒ **累计合格收货数量不减**。

## 6. 审计项五 —— 倒冲复核、重放、并发、历史迁移与已有数据异常

| 场景 | 结论 | 依据 |
|---|---|---|
| **倒冲复核**（`POST .../orders/:id/backflush`） | 要求收货已 `EFFECTED`（否则 409 `OUTSOURCING_RECEIPT_NOT_EFFECTED`），用同一公式，`incremental <= 0` 时**不写** | `server/modules/outsourcing.js:581-605` |
| **重放** | 生效路径入口 `idempotencyReplay` 命中即 200 返回，**不进入**事务与倒冲 ⇒ 不重复累计 | `server/modules/outsourcing-finance.js:117-123`；`saveIdempotency` 在事务末尾 `:250` |
| **并发** | 同一 (收货, 物料, 身份) 的物理变更**不可能被提交两次**：`inventory_mutation_log.idempotency_key TEXT NOT NULL UNIQUE`，且倒冲的变更键为 `OUTSOURCING_BACKFLUSH:${receipt.id}:${material.id}:OUT:${identityKey}`（与收货、物料、身份绑定）⇒ 失败方要么读到已生效状态（干净 409），要么撞唯一约束并整体回滚 | `server/migrations/inventory-position-schema.js:141-142`；`server/modules/outsourcing-inventory.js:233` |
| **历史迁移** | 无迁移改写 `backflushed_quantity` 或 `outsourcing_receipts.business_status` 的既有值 | `server/migrations/procurement-outsourcing-schema.js:501`（仅列定义） |
| **已有数据异常** | `backflushed_quantity > per_unit_quantity × cumulativeFinished` 的行**可以存在于历史库**（人工修复、遗留导入、跨版本口径差异），是负增量分支唯一的现实来源 | 由 §2–§5 反推 |

**浮点专门核查**：增量守卫用**严格** `incremental < 0`（而 `> remaining` 用 `+ 1e-9`），因此
核查了浮点残差是否可能把它推成负数。对 `per_unit_quantity ∈ [0.001, 0.400]`（步长 0.001）与
`∈ {n/3}`、每单位收货量 7 / 11、累计 1…60 批的组合做了枚举：**负增量出现次数为 0**
（增量按 `per × cum − 已累计` 逐次计算并累加，浮点残差不产生负值）。⇒ 浮点不是现实来源；
但这是**有限枚举**而非穷尽证明，属 §9 的剩余假设。

## 7. 可达性分类

| 分类 | 内容 |
|---|---|
| **1. 合法生产 HTTP 可达** | 「增量 > 可用净供应 → 409」：已由真实 MySQL Run `b29c3f1f` 的 **CR-07 / CR-08** 证明（败方因净供应不足被拒，错误码 `OUTSOURCING_WIP_INSUFFICIENT`） |
| **2. 仅 L3 SQL / 历史异常才能构造** | 「增量 < 0 → 409」：五项不变量（§2 状态单向且无删除、§3 单调累积、§4 基数冻结并复核、§5 累计不减、§6 并发受 UNIQUE 约束保护）共同排除合法 HTTP 构造；只能由受控异常种子或历史数据异常产生 |
| **3. 尚无法证明不可达** | **无**。浮点残差已在有限枚举内排除（§6），并发双累计已被唯一约束排除（§6）。剩余不确定性只在「历史库里是否已经存在异常行」这一**存量**问题上 —— 那是数据事实，不是可达性 |

## 8. D-1 / D-2 方案对比与推荐

### D-1 —— 防御性测试（隔离 SQLite + 受控异常种子 + 生产 Handler 拒绝）

| 项 | 内容 |
|---|---|
| 做法 | 在**一次性隔离 SQLite** 中，用**直接 SQL**把某条 `outsourcing_material_list` 的 `backflushed_quantity` 抬高到 `per_unit_quantity × cumulativeFinished` 之上（受控异常种子），再经**生产 HTTP** 触发收货生效，断言：409 `OUTSOURCING_WIP_INSUFFICIENT`、**业务事实逐字段零变化**（含 `backflushed_quantity` 未再变动）、拒绝审计恰好 1 条 |
| 优点 | 证明**防御分支确实 fail closed**；离线、确定、可复跑；不触碰生产代码 |
| 缺点 | **种子是 L3 异常数据**，只能证明「守卫在工作」，**不能**证明「该状态在生产中不可达」；必须**显式标注为异常种子**，**不得**冒充正常 L1 造数；若种子写法与真实历史异常形态不符，证明力有限 |
| 风险 | 需防止该用例被误读为「G04 的负增量断言已通过」；证据文档必须写明它是**防御性**证据 |

### D-2 —— Design 修订（Active Design §13.1 G04 拒绝列）

| 项 | 内容 |
|---|---|
| 做法 | 把 G04 拒绝列拆开并标注可达性：「增量 > 可用净供应 → 409（HTTP 可达，已由 CR-07/CR-08 证明）」；「增量 < 0 → 409（在 §9.1 不变量下**不可由合法 HTTP 构造**；其防御性行为由 D-1 的受控异常种子证明）」 |
| 优点 | 让合同与现实一致；消除一条**字面上不可满足**的 L1 断言；把残余风险显式写进合同 |
| 缺点 | 触碰 Active Design ⇒ 需要 **Design 裁定**与 §2.5 的编号映射 / supersession 记录（AGENTS.md §5.9）；**修订本身不产生任何证据**，不能替代 D-1 |
| 风险 | 若只做 D-2 不做 D-1，守卫仍无断言位 —— 合同被改软了但行为仍未验证 |

### 推荐

**推荐 D-1 与 D-2 组合，且顺序为 D-1 → D-2**：先取得**可执行**的防御性证据（D-1），再用它支撑
合同修订（D-2）。只做其一都不足：D-1 单独留下「Design 断言了一条无法满足的 L1 要求」；D-2 单独
留下「守卫从未被验证」。**两者都不解决**历史库中是否已存在异常行这一存量问题 —— 那需要独立的
数据核查授权，不在本包范围。

**D-1 的实施前置**：需要 Owner 单独授权（新增一个测试文件 + 异常种子），并明确该种子是
**L3 受控异常种子**而非 L1 造数；本包**未实施**。

## 9. 剩余假设清单

| # | 假设 | 状态 |
|---|---|---|
| A1 | `inventory_mutation_log.idempotency_key` 的 UNIQUE 约束在 canonical schema 中真实生效 | 静态证据（migration `inventory-position-schema.js:142`）；**未在真实 MySQL 上复核**（本包禁止连接） |
| A2 | 浮点残差不会把增量推成负数 | **有限枚举**（per_unit 0.001–0.400 与 n/3，累计 ≤ 60 批，负增量 0 次）；非穷尽证明 |
| A3 | 已生效收货的 `quantity` 在所有路径上都不被改写 | 静态证据（唯一的 UPDATE 不含 `quantity` 列）；未做全仓写入点穷举扫描之外的真实库核验 |
| A4 | 历史库中不存在 `backflushed_quantity > per_unit × cumulative` 的行 | **未核查**（存量数据事实，需独立授权） |
| A5 | `outsourcing_material_list` 无删除路径 | 静态证据（`server/` 内无 DELETE） |

## 10. 未发生

未连接真实 MySQL、未运行 G07、未签发或消费 ACK-4、未执行 Reset/Bootstrap/Cleanup/Migration、
未修改任何生产代码、未修改 Active Design 或 Requirement、未修改 Fixture / Oracle / Gate 合同、
未实施 D-1 或 D-2、未签发任何 Owner Acceptance、未 Push / Merge / Tag / Release / Deploy。
