# WP-A1-02 Owner Acceptance 候签记录（2026-11-08）

> 用途：登记业务所有者对 `WP-A1-02`（`AUD-PRC-001`，正式寻源决策写入口服务端安全关闭）的**有界验收决定**。
>
> Owner：Procurement & Outsourcing Domain Owner（验收决定与残余风险接受）；Platform / QA（技术证据维护）。
>
> 状态：`PENDING_OWNER_APPROVAL` —— **业务所有者尚未作出决定**。本文件只是候签记录，
> **不签发任何 Acceptance 标识**，不构成 `ACCEPTED`，也不构成 Design PASS。
>
> 权威来源：Active Requirement [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.14.1；
> Active Design [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.34.1；
> 审计台账 [`docs/audits/b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md) §13；
> 唯一项目状态 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §42。
>
> 来源 SHA：实施提交 `8fa20a4374418ea24150fc5234ccd577389802dd`；本候签记录撰写基线 `master` @ `a39beac7a334ab4cf32fd5bc6b33ef978d6a6d65`。
>
> 本文件是验收证据，不取代 Requirement、Active Design 或唯一项目状态登记表。**本文件的生成本身不构成 Git 提交或远端同步。**

```text
WP_A1_02_OWNER_ACCEPTANCE_PENDING_APPROVAL
```

## 1. 验收对象与范围

| 项 | 值 |
|---|---|
| 工作包 | `WP-A1-02` |
| 审计 Issue | `AUD-PRC-001` —— 正式寻源决策写入口在服务端未关闭 |
| Owner 决定来源 | `OPEN-BUSINESS-DECISIONS.md` §4.1 的 `SAFE_CLOSE` 意图；Requirement §31.14.1 |
| 实施提交 | `8fa20a4374418ea24150fc5234ccd577389802dd`（`关闭正式寻源决策写入并验证零业务副作用`） |
| 验收范围 | **仅** `POST /api/procurement/sourcing-decisions` 的服务端统一 409 关闭 + 零业务副作用 + 单次拒绝审计 + 合法只读查询保留 |
| 明确不在范围 | `PRC-06` Capability Closure；`AUD-PRC-002`（Hash，`AUD-PRC-001` 的 Hash 部分**单独保留**）；VMI；`AUD-OUT-001`；M1-Core 七 Gate；Domain Acceptance；Manual Closure；Release Readiness；Release / Deploy |

本记录与 [`wp-a1-01-owner-acceptance-20261108.md`](./wp-a1-01-owner-acceptance-20261108.md) 是**两个独立**的验收对象，**不互相代表、不合并决定**。

## 2. 实施证据（提交 `8fa20a4`）

提交改动 3 个文件（+58 / −114）：

| 文件 | 变更 |
|---|---|
| `server/modules/procurement-sourcing.js` | `resolveSourcingDecision()` 在既有认证与 `assertViewPermission(actor)`（`PROCUREMENT_CONFIG_VIEW` / `PROCUREMENT_CONFIG_MANAGE`）之后，**统一**抛出 `HttpError(409, '正式寻源决策写入已关闭', { code: 'SOURCING_DECISION_WRITE_CLOSED' })`，并在抛出前调用**一次** `auditBusinessRejection(db, actor, { entityType: 'SOURCING_DECISION', entityId: null, action: '正式寻源决策写入' }, error)`。原决策写入与分配写入代码（含 `sourcing_decisions` / `sourcing_decision_allocations` 的 INSERT、`manualOverride` 人工覆盖分支及其权限判定、`allocateProportional` 分配计算与 `roundRational` 引用）**整体删除**。 |
| `server/procurement-sourcing-pricing.test.js` | 用「关闭后拒绝」用例替换原「配额分配守恒」用例（详见 §3.2）。 |
| `scripts/acceptance/procurement-outsourcing-functional-uat.mjs` | UAT-04 改为「配额 GET 200 + 正式决策 POST 409 且 code 为 `SOURCING_DECISION_WRITE_CLOSED`」。 |

逐项对照 Requirement §31.14.1「`POST /api/procurement/sourcing-decisions` 由服务端对通过适用身份和权限检查的所有角色（含管理员）稳定返回 409 业务拒绝；未授权者仍遵循既有 403 门禁」：

| Requirement 义务 | 本提交是否满足 | 证据 |
|---|---|---|
| **服务端**统一 409（不得以假 PR 来源、临时正式状态机或仅隐藏前端控件替代关闭） | **满足** | 409 位于 `server/modules/procurement-sourcing.js` 的服务端入口；前端控件移除属**另一个**独立工作包 `WP-A1-01` |
| 对通过适用身份和权限检查的**所有角色**（含管理员）稳定 409 | **满足** | 测试覆盖普通有权用户与管理员两条主体路径，均返回同一 409 与同一 code |
| 未授权者仍遵循既有 403 | **满足** | 测试先以未获授权的销售专员断言 **403**，再补授 `PROCUREMENT_CONFIG_VIEW` 后才进入 409 路径 |
| 拒绝时 `sourcing_decisions`、`sourcing_decision_allocations`、PR/PO、库存、采购与财务事实**逐字段零变化** | **满足** | 15 张业务表逐行 `deepEqual` 快照对比（详见 §3.2） |
| 按现有拒绝审计合同**恰好一次**记录，不重复审计 | **满足** | 断言每次业务拒绝恰好新增 1 条 `entity_type='SOURCING_DECISION' AND action='REJECT' AND detail LIKE '%SOURCING_DECISION_WRITE_CLOSED%'` 的审计行；使用 `auditBusinessRejection` 单一边界，handler 与统一错误层不双记 |
| `AUD-PRC-002` Hash 单独保留 | **满足** | 提交未触碰 Hash 实现 |

## 3. 验证证据（2026-11-08 实测）

### 3.1 focused 5 / 5 PASS

命令：`node --test server/procurement-sourcing-pricing.test.js`
实测结果：`# tests 5 / # pass 5 / # fail 0`，**退出码 0**。

> **登记口径说明**：`server/procurement-sourcing-pricing.test.js` 登记在 **FULL** 套件（FAST=29 / FULL=222 / HEAVY=7），
> 不在 FAST 套件。因此任务书指定的 `pnpm.cmd test:fast --filter procurement-sourcing-pricing` **选不出**该文件；
> 本记录以直接执行该测试文件取得真正的 focused 结果，并在 §3.5 完整披露该命令的真实行为与退出码。

### 3.2 拒绝路径用例的逐项覆盖（focused 第 4 项）

用例名：`closed decision write rejects ordinary user, admin, forged source and repeat without business effects`。

| 环节 | 断言 |
|---|---|
| 未授权主体 | 无 `PROCUREMENT_CONFIG_VIEW` 的销售专员 → **403**（既有门禁保持） |
| 普通有权用户 | 为 `role-sales` 补授 `PROCUREMENT_CONFIG_VIEW` 后，以销售专员令牌 POST → **409** + `code='SOURCING_DECISION_WRITE_CLOSED'` |
| 管理员 | 以 `admin` 令牌、**相同**载荷 POST → **409** + 同一 code（管理员无豁免） |
| 伪造来源 | 以 `admin` 令牌、`sourceId='FORGED-PR-NOT-FOUND'` POST → **409** + 同一 code（拒绝**不依赖**伪来源是否存在） |
| 重复请求 | 再次以 `admin` 令牌、原始载荷 POST → **409** + 同一 code，且**不**产生重复业务效果 |
| 逐字段业务快照 | 每次拒绝后对下列 **15** 张表逐行 `deepEqual` 对比拒绝前快照，任何字段变化即失败：`source_list_entries`、`source_list_versions`、`quota_assignments`、`sourcing_decisions`、`sourcing_decision_allocations`、`purchase_requisitions`、`purchase_orders`、`purchase_order_items`、`inventory`、`inventory_transactions`、`inventory_valuation_movements`、`inventory_valuation_balances`、`supplier_bills`、`account_payables`、`accounting_vouchers` |
| 拒绝审计 | 每次业务拒绝恰好新增 **1** 条拒绝审计行；4 次拒绝累计恰好 4 条 |
| 合法只读查询保留 | `GET /api/procurement/source-entries?productId=product-001` → **200**；`GET /api/procurement/quotas?productId=product-002` → **200** |

### 3.3 FAST 576 / 576 PASS

命令：`node scripts/testing/run-tests.js fast`
实测结果：`# tests 576 / # suites 42 / # pass 576 / # fail 0`，**退出码 0**。

### 3.4 Build PASS

命令：`pnpm.cmd build`
实测结果：`✓ built in 3.82s`，**退出码 0**。

### 3.5 任务书指定命令的真实行为（必须披露）

命令：`pnpm.cmd test:fast --filter procurement-sourcing-pricing`
实测结果：`[run-tests] suite=fast files=0` → runner 以**无文件参数**启动 `node --test` → Node 回退为**默认全仓发现** → **3441 tests / 429 suites，3437 pass，4 fail**，**退出码 1**。

- 该命令**没有**筛选到寻源定向测试文件（该文件登记在 FULL，见 §3.1），并因此把不属于 FAST / FULL 的 `server/production-safety.test.js` 一并纳入。
- 4 项失败全部位于 `server/production-safety.test.js`：① 陈旧断言——Demo Seed 现创建 **7** 个用户（5 基础 + M1-P-03 的 2 个委外角色，2026-11-02 起），测试仍断言 5；②③ Windows `EBUSY` 临时库 `unlink` 级联（由 ① 断言失败后未执行 `db.close()` 引起）；④ 文件级汇总。
- 该 4 项失败**与本轮变更无关**：本轮只改动 `docs/**` 与 `log/**` 下的 Markdown；该测试文件亦**未登记**在 FAST / FULL / HEAVY 任一套件清单中。
- 本记录**不**把该命令记为 PASS，也**不**把它的失败归因于 WP-A1-02。

### 3.6 本轮命令汇总

| 命令 | 实测结果 | 退出码 |
|---|---|---|
| `pnpm.cmd build` | `✓ built in 3.82s` | 0 |
| `node --test server/procurement-sourcing-pricing.test.js` | 5 / 5 PASS | 0 |
| `node scripts/testing/run-tests.js fast` | 576 / 576 PASS | 0 |
| `node scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs` | PASS=24 FAIL=0 TOTAL=24 | 0 |
| `node scripts/testing/run-tests.js fast --filter procurement-sourcing-pricing` | 3441 tests / 3437 pass / **4 fail**（见 §3.5） | **1** |

## 4. 已披露的限制与未证明事项（不得隐藏、不得改写为 PASS）

1. **旧功能 UAT 为 15 / 28，不是 PASS。** `scripts/acceptance/procurement-outsourcing-functional-uat.mjs` 全套 **28** 项中仅 **15** 项通过；其中**只有 UAT-04 按新合同通过**（配额 GET 200 + 正式决策 POST 409 `SOURCING_DECISION_WRITE_CLOSED`）。其余失败集中在收货与委外既有链路，属**既有**缺陷面，**不**由本工作包引入，也**不**由本工作包关闭。**全套不记为 PASS。**
2. **FULL 回归未完成，不记为 PASS。** FULL 曾启动但因耗时停止；**停止前**仍出现既有的 `m1-core-g07-diagnostics.test.js` 临时证据文件 `SetAccessControl` 权限拒绝。FULL 在本轮**没有**跑完，因此**不得**声称 FULL PASS，也不得以 FAST 576/576 替代 FULL 结论。
3. **没有本轮真实 MySQL Gate 证据。** 本轮**未连接**任何真实 MySQL，**未**执行 `test:mysql` / `test:mysql:concurrency` / 任何 disposable MySQL Gate，**未**执行 Migration、Reset、Bootstrap 或 Cleanup。全部证据来自临时 SQLite fixture。因此「MySQL 与 SQLite 双端等价」「MySQL 下的拒绝审计恰好一次」**未被证明**。
4. **并发未证明。** 本轮**未**执行同键并发的重复请求竞争测试。409 拒绝在 MySQL 并发下的稳定性、唯一约束与拒绝审计在竞争下的恰好一次性，**未被证明**。
5. **拒绝审计的覆盖面受限。** `auditBusinessRejection()` 只对 `status === 409` 的 `HttpError` 生效；本工作包的 403（未授权主体）与 400（输入格式）**不**产生拒绝审计。这沿用既有全局合同，`AGENTS.md` / M1-Core `MC-REQ-11` 要求的**全应用范围 403 拒绝审计仍未实现**（已知遗留，由 `M1C-WP-5` 承接）。本工作包**不**关闭该遗留。
6. **审计记录的定位维度较粗。** 拒绝审计的 `entityId` 固定为 `null`（关闭发生在任何来源解析之前），因此审计行**不**能定位到具体来源单据。这与「拒绝不依赖伪来源是否存在」的要求一致，但也意味着事后无法从审计行反查被拒请求的来源标识。
7. **WP-A1-02 与 WP-A1-01 是两个独立对象。** 本记录**只**覆盖服务端 409 关闭。前端演示入口移除属 `WP-A1-01`（`AUD-FE-001`），其验收记录为 [`wp-a1-01-owner-acceptance-20261108.md`](./wp-a1-01-owner-acceptance-20261108.md)。本记录**不**以 WP-A1-01 的证据替代自身的证据，也**不**把两者合并为一次验收。
8. **`AUD-PRC-002`（Hash）仍开放。** Requirement §31.14.1 明确「`AUD-PRC-002` Hash 单独保留」。本工作包**不**覆盖 Hash 语义，**不**构成该 Issue 的关闭依据。
9. **旧功能 UAT 的 15/28 与 FULL 未完成两项限制，对本工作包的正面结论构成上限。** 即使 Owner 接受 WP-A1-02，也**不得**据此声称 B3101 / B3121 的旧功能面已通过验收。

## 5. 残余风险（若接受，由业务所有者一并承担）

| # | 残余风险 | 说明 |
|---|---|---|
| R-A1-02-01 | 无真实 MySQL 证据 | 409 路径与拒绝审计仅在 SQLite fixture 上验证 |
| R-A1-02-02 | 并发未验证 | 同键并发重复请求下的稳定性与拒绝审计恰好一次性未证明 |
| R-A1-02-03 | 旧功能 UAT 15/28 未解决 | 收货与委外既有链路的失败面仍开放 |
| R-A1-02-04 | FULL 未完成 | 无完整回归基线，回归归因能力受限 |
| R-A1-02-05 | 403 拒绝审计全局缺口 | `MC-REQ-11` 的全应用 403 拒绝审计仍未实现；本工作包的 403 路径不写审计 |
| R-A1-02-06 | 拒绝审计 `entityId` 恒为 null | 事后无法由审计行反查被拒来源 |
| R-A1-02-07 | `server/production-safety.test.js` 未分类 | 该文件不在任何套件清单内，其陈旧断言与 Windows `EBUSY` 级联会持续污染按任务书指定的过滤命令 |
| R-A1-02-08 | `PRC-06` 能力面因此关闭 | 正式寻源决策写入关闭后，`PRC-06` 的可用写路径为空；本工作包**不**补偿该能力缺口，也**不**扩大 `PRC-06` 范围 |

## 6. 明确不因本次验收关闭的事项

- `AUD-PRC-002`～`AUD-PRC-009`、`AUD-FE-001`～`AUD-FE-003`、`AUD-VMI-001`～`AUD-VMI-003`、`AUD-OUT-001`、`AUD-OUT-002` 的状态**全部不变**。
- `PRC-06` **不**因本记录变为 `COVERED`；`docs/status/CAPABILITY_MATRIX.md` **不**更新；**不扩大** `PRC-06` 范围。
- B3101 / B3121 **仍为 `BLOCKED`**；Procurement & Outsourcing Domain Acceptance **仍为 `NOT READY`**（`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`）。
- M1-Core 七 Gate 的 7 / 7 `PASS` 及其既有范围**不变**；`R-01`～`R-20`、`D-01`～`D-04`、`WP-I` / `WP-J`、`M-15` 原状态**不变**。
- §26.34 的 Design 状态**不**因本记录改变：`PENDING_REVIEW` 保持，`DESIGN_PASS` **未签发**。**WP-A1-01 / WP-A1-02 的 Acceptance 不是 Design PASS**，`A1-D-RV-01`～`A1-D-RV-04` 四个 Owner Review Gate 状态**不变**。
- 本记录**不**授权真实 MySQL、Migration、数据库写入、DDL、Push、Merge、Tag、Release、Deploy。

## 7. Owner 决定栏（**待业务所有者填写；本文件不代填**）

请在下列两项中**择一**，并显式签署。决定前本工作包保持 `TESTED` / `PENDING_OWNER_APPROVAL`。

- [ ] **`ACCEPT_WITH_BOUNDED_RESIDUALS`** —— 接受 §4 全部限制与 §5 全部残余风险，`AUD-PRC-001` 记为 `ACCEPTED`
- [ ] **`RETURN_FOR_REWORK`** —— 退回返工，并指明必须补齐的证据（缺项：真实 MySQL 证据 / 并发证据 / 旧功能 UAT 15/28 / FULL 完整回归 / 403 拒绝审计 / 其他）

```text
决定标识：____________________（ACCEPT_WITH_BOUNDED_RESIDUALS 或 RETURN_FOR_REWORK）
决定人：____________________
日期：____________________
```

**在业务所有者作出上述决定之前**，`AUD-PRC-001` 与 `WP-A1-02` 的状态**保持** `TESTED` / `PENDING_OWNER_APPROVAL`，**不得**改写为 `ACCEPTED`、`VERIFIED` 或任何形式的 PASS。

## 8. 未解决矛盾

1. **任务书指定的过滤命令与仓库套件登记不一致。** `pnpm.cmd test:fast --filter procurement-sourcing-pricing` 选出 0 个文件并退化为全仓发现；定向文件实际登记在 FULL（详见 §3.5）。本记录按两种口径都记录真实结果处理，未做掩盖，也**未**修改 `scripts/testing/`（本轮禁止修改 `scripts/`）。该矛盾需由业务所有者裁定。
2. **拒绝审计的「恰好一次」与全局 403 审计缺口的张力。** 本工作包的 409 拒绝审计恰好一条已被断言；但同一端点在 403 路径上**不写**任何拒绝审计，这使「拒绝即留痕」在该端点上不成立，与 `MC-REQ-11` 的义务存在缺口。该缺口由 `M1C-WP-5` 承接，本工作包**不**扩大范围自行补齐，也**不**据此宣称 `MC-REQ-11` 已满足。
3. **`PRC-06` 的能力真空。** 服务端写入口关闭后，`PRC-06` 的正式寻源决策写入能力在产品上不可用；本工作包按 Owner 的 `SAFE_CLOSE` 决定执行，但**不**回答「该能力何时、以何种范围恢复」。该问题不在本工作包范围内，需由业务所有者另行裁定。
