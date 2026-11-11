# Accounting & Analytics 域级 Acceptance 与 Capability Freeze 候签（2026-11-11）

> **用途**：本文件是 Accounting & Analytics 域**整域 Acceptance**与 **Capability Freeze** 的候签材料：汇总 AA-W1..AA-W7 七个范围包的实施范围、44 项 Capability 的逐项判定、Gate 证据、已披露限制与仍需业务所有者裁定的事项，供业务所有者据以签发（或退回）。
>
> **Owner**：Accounting & Analytics Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`PENDING_OWNER_DECISION` —— 本文件是候签材料，**尚未**构成 Acceptance、Capability Freeze、Manual Closure 或 Release Readiness。
>
> **权威来源**：Requirement [`docs/requirements/accounting-analytics.md`](../requirements/accounting-analytics.md) §35；Design [`docs/design/accounting-analytics.md`](../design/accounting-analytics.md) §31；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §52；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)；逐项复核台账 [`docs/audits/accounting-analytics-capability-audit-20261110.md`](../audits/accounting-analytics-capability-audit-20261110.md) §7。
>
> **本文件的生成不等于** Git 提交、远端同步、发布、部署、真实环境 migration 或真实业务数据库写入。

```text
ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION
（AA-07 已由业务所有者 2026-11-11 裁定闭合；等待业务所有者签发域级 Acceptance 与 Capability Freeze）
```

## 1. 候签范围

| 项 | 范围 |
|---|---|
| Domain | Accounting & Analytics（产品架构第 8 个业务域） |
| 手册对标 | B3106 存货核算、B3107 固定资产、B3114 智能会计平台、B3115 总账、B3116 报表、B3117 经营会计 |
| 能力集合 | AA-01..AA-44，共 **44 项** |
| 覆盖判定 | `COVERED` **43** 项；`PARTIAL` **0** 项；`MISSING` **0** 项；`OUT_OF_SCOPE` **1** 项（AA-31 汇兑损益 / 多币种，业务所有者 2026-11-10 裁定） |
| 合同基线 | Requirement §35.1～§35.10；Design §31.0～§31.15 |
| 实施批次 | AA-W1 + AA-W2（`3876bd3`）、AA-W5（`e40a015`）、AA-W3（`943414c`）、AA-W6（`5e6739d`）、AA-W4（`bc2035d`）、AA-W7（`d9e7319`）、前端工作面与共享断言收口（`9e1ddd4`、`7dc7766`） |
| **不在本次范围** | Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作、手册级 Manual Closure、其他域的 Acceptance |

## 2. 七个范围包的实施内容

| 包 | 范围 | 交付物 | 提交 |
|---|---|---|---|
| **AA-W1** | 会计事件台账与对账工作台 | `accounting_events`（DB 级四列自然键唯一）、`accounting_event_attempts`、未生成与异常清单、稳定错误码、受控修复（重试 / 跳过并说明原因 / 恢复，均写审计、均幂等）、业务↔GL 对账工作台与不可变快照、统一期末关账检查（未生成事件时真实拦截关账）、会计科目创建 / 修改 / 停用与引用保护 | `3876bd3` |
| **AA-W2** | 凭证模板与规则平台 | 模板创建 / 修改 / 停用 + 试算、规则命中解析（未命中与歧义显式失败）、科目按角色解析、批量生成逐条独立事务、生成运行状态追踪、受限表达式文法（无代码执行面） | `3876bd3` |
| **AA-W3** | 总账增强与期末自动化 | 冲销 / 补记统一 canonical 路径（金额与方向镜像）、出纳复核独立节点与权限（SOD）、三段式现金流量表与资金子账对账、期末转账 / 摊销 / 计提定义与幂等执行、**真实损益结转**（结转后损益归零、权益承接净损益、移除虚拟权益行）、未结转禁止关账、反结转限 ADMIN 且留痕 | `943414c` |
| **AA-W4** | 报表平台 | 报表模板 + 行项目 + 可见范围 + 版本、受限文法公式引擎（无 `eval` / `Function`、失败显式报错不静默取 0）、期间实例生命周期（实例化 → 重算 → 提交 → 审核，提交与审核分离并留痕）、自定义报表沿用同一模板与期间口径 | `bc2035d` |
| **AA-W5** | 固定资产完整生命周期 | 资产类型 / 位置 / 折旧政策独立实体、资产卡片生命周期、采购转固（金额取自收货单、禁止调用方提供金额）、受控变更单、拆分合并价值守恒、借用与盘点差异、**按政策自动计提折旧并生成凭证**（与 GL 累计折旧对账、同期间幂等）、受控处置；route `fixed-assets` 由 `enabled:false` 改为 enabled 并迁出到 `src/pages/fixed-assets.jsx` | `e40a015` |
| **AA-W6** | 存货核算深化 | 核算范围实体、计价方法确定性优先级（属性 > 类别 > 默认，同级并列 fail closed）、暂估入库单与差异调整凭证、采购费用归集与分摊（可重算、进入权威估值流水并生成凭证）、完工成本结转（金额守恒、差异去向显式）、受控成本调整、核算关账五类异常清单 | `5e6739d` |
| **AA-W7** | 经营会计 | 经营账簿 / 经营单元、经营台账（只取已过账事实、归集幂等、来源可追溯）、内部结算价格、费用归集与分摊（可重算一致、基数缺失 fail closed）、经营损益与法定损益勾稽（差额显式三段）、经营期间关账与受控反结账 | `d9e7319` |

### 2.1 本轮新增的前端工作面（Design §31.0.3）

`src/pages/accounting-analytics.jsx` 以**单一页面**承载本域 5 个新 route，每个 route 只有一个 active executable screen：

| Route key | 页面导出 | 权限 | 对应包 |
|---|---|---|---|
| `accounting-events` | `AccountingEvents` | `ACCOUNTING_EVENTS_VIEW` / `ACCOUNTING_VIEW` | AA-W1 |
| `accounting-reconciliation` | `AccountingReconciliation` | `ACCOUNTING_RECONCILIATION_VIEW` / `ACCOUNTING_VIEW` | AA-W1 |
| `accounting-reports` | `AccountingReports` | `REPORT_TEMPLATE_VIEW` / `REPORT_INSTANCE_VIEW` | AA-W4 |
| `accounting-costing` | `InventoryCosting` | `INVENTORY_COST_VIEW` / `ACCOUNTING_VIEW` | AA-W6 |
| `management-accounting` | `ManagementAccounting` | `MANAGEMENT_ACCOUNTING_VIEW` | AA-W7 |

launcher 的「会计与分析」组由 8 项扩展为 **13 项**（新增上述 5 项）；canonical active route 由 74 增至 **79**，disabled route 由 5 收敛为 **4**（`fixed-assets` 已由 AA-W5 启用）。

## 3. 逐项能力判定

44 项 Capability 的实施后判定、逐行证据与判定口径见
[`docs/audits/accounting-analytics-capability-audit-20261110.md`](../audits/accounting-analytics-capability-audit-20261110.md) §7.2。汇总：

| 手册 | Capability 数 | `COVERED` | `PARTIAL` | `MISSING` | `OUT_OF_SCOPE` |
|---|---|---|---|---|---|
| B3106 存货核算 | 9 | 9 | 0 | 0 | 0 |
| B3107 固定资产 | 8 | 8 | 0 | 0 | 0 |
| B3114 智能会计平台 | 7 | 7 | 0 | 0 | 0 |
| B3115 总账 | 8 | 7 | 0 | 0 | 1（AA-31） |
| B3116 报表 | 6 | 6 | 0 | 0 | 0 |
| B3117 经营会计 | 6 | 6 | 0 | 0 | 0 |
| **合计** | **44** | **43** | **0** | **0** | **1** |

**与 Requirement §35.3 目标判定一致**：§35.3 记的目标是「43 `COVERED` + 1 `OUT_OF_SCOPE`」，实测与之相同。
AA-07 的合同缺位已由业务所有者 2026-11-11 的裁定闭合（见 §6）。

## 4. Gate 证据

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3695/3695 PASS**，0 失败（459 个套件；含新登记的域级 schema 双引擎离线对等 53 条） |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| focused（会计与分析域 6 个套件） | **85/85 PASS** |
| focused（域级 schema 双引擎离线对等，新登记） | **53/53 PASS** |
| focused（14 个共享 route 清单套件） | **250/250 PASS** |
| 浏览器四档宽度验收（真实 Edge，6 个工作面 × 320/390/430/680） | **6/6 PASS**，浏览器错误 **0**；证据 [`docs/evidence/accounting-analytics/README.md`](../evidence/accounting-analytics/README.md) |
| 离线 MySQL DDL 对等探针 | AA 的 **45 张新表**与 AA-W5 的加列在生产 MySQL DDL 翻译器输出中**全部存在**；列集合两端一致；全部 `*_cents` 列为 `BIGINT`；AA-W1 自然键 UNIQUE 与状态机 CHECK 保留 |
| 文档一致性 `current` | N1、N3～N6、N8、N9 **PASS**；N2 `RETIRED`；**N7 FAIL**（既存历史提交 `a40e356` / `59eccd5` / `171ade5` / `4403a80` 的追溯债务，与本域无关） |
| 文档一致性 `migration` | C1～C6 全 PASS |
| **真实 MySQL 8 parity / concurrency** | **未运行** —— 见 §7 |

## 5. 必须随验收一并接受的事实

### 5.1 真实 MySQL Gate 未运行（Requirement §35.8.1 第 6 项未闭合）

Requirement §35.8.1 第 6 项要求「真实 MySQL 8 路径完成 parity / concurrency 验证（具备受保护 disposable 环境时）」。本轮**未**运行：

- 本机统一 MySQL Gate launcher（`scripts/gates/run-mysql-local-gate.ps1`）当前**只放行** `test:mysql:m1-core` 一个已批准 ACK-4 的 campaign，其余脚本一律 `BLOCKED`；本域**没有**已批准的 ACK-4 清单与 RunId；
- 本轮已用**离线 MySQL DDL 对等探针**（新登记的 `accounting-analytics-mysql-schema-parity.test.js`）证明本域 schema 在 MySQL 侧成立，但**离线探针不等于真实 MySQL 验收**——它不连接 MySQL、不执行 MySQL migration、不覆盖并发行为。

**已披露限制**：在此之前，**不得**声称本域已通过真实 MySQL parity / concurrency 验收；`docs/status/CAPABILITY_MATRIX.md` 中本域五本手册的 `VERIFIED` 状态只依据本地可执行证据，不构成 MySQL 运行期验收结论。

### 5.2 AA-07 委外成本：已由业务所有者裁定闭合

见 §6。

### 5.3 试算平衡科目集合由 21 增至 27

AA-W3 的 `4103 本年利润` 与 AA-W5 的 `1601 固定资产` / `1602 累计折旧` / `6602 折旧费用` / `6603 处置资产损益` 进入试算平衡科目集合，由 23 调整为 27；`server/trial-balance.test.js` 已固定该口径。既有损益表与资产负债表口径不变。

### 5.4 共享套件的固化断言被本域改动触发，已同步

AA-W1..AA-W7 新增 20 项权限（227 → 247）、新增 5 个 route（74 → 79）、并由 AA-W5 启用 `fixed-assets`（disabled 5 → 4）。这使 14 个跨域共享套件的**固化计数断言**失效（`server/v12-release-acceptance.test.js`、`server/trial-balance.test.js`、以及 v14/v15/v16/v17 的 route 清单套件）。这些断言**已按新事实逐条同步**并附改动理由注释；**未**放宽任何业务语义断言，**未**删除断言，**未**降级测试分类。`docs/v1.6-sitewide-rollout-matrix.md` 作为冻结的 V1.6 历史证据**未被改写**，新增 route 按既有 `laterSalesRoutes` 机制登记。

### 5.5 前端工作面与既有会计页面的分工

Design §31.0.3 约定 5 个新 route 由单一页面承载；`accounting`（既有 `src/pages/accounting.jsx`）与 `decision-reports` 保持不变。**本轮未改造既有 `accounting.jsx`**：其中「未结转损益（虚拟行，不持久化）」的资产负债表展示行仍保留，尽管 AA-W3 已实现真实损益结转并从结转链移除虚拟权益行补偿。该展示行与真实结转事实的一致性未在本轮取得浏览器取证，登记为**残余事实**。

### 5.6 委外成本口径的跨域归属（已裁定，符合合同）

AA-07 的实现位于采购与委外域（该域已于 2026-11-11 签发域级 Acceptance 与 Capability Freeze）。本域**未**新增第二套委外成本事实表、口径常量或第二套过账路径，符合 Requirement §35.2 第 2 条「不夺取他域的业务事实」与 §35.4.6 AA-W6.18～AA-W6.19 的禁止条款。该边界已由 §31.6.2 的 Design 不变量与审计台账 §7.3 固定。

## 6. 已裁定：AA-07 委外成本（业务所有者 2026-11-11，选项 A）

**发现的问题**：

1. Requirement §35.3 把 AA-07 目标判定记为 `COVERED`，归属范围包 AA-W6；
2. 但 §35.4.6（AA-W6 的可验收条款）**原本不含任何 AA-07 条款** —— AA-07 没有可实施、可测试的合同条款；
3. 本域 6 个后端模块与 7 个 migration 中**没有任何 `OUTSOURCE` 取数规则**；
4. 委外成本口径当前由采购与委外域承担：材料成本取自本域权威估值流水（`outsourcing-finance.js` 的 `backflush.valuation.issuedValueCents`），加工费取自 `outsourcing-gl-policy.js::resolveProcessingFeeAccountingProfile` 解析的会计档案；
5. §35.2 第 2 条同时要求本域的委外成本来源必须是采购与委外域的**权威事实引用**。

**矛盾**：§35.3 要求「在本域固化取数规则」，§35.4.6 没有该规则，§35.2 又禁止本域另立事实。这属 AGENTS.md §35.9 第 4 项 Hard Stop（Capability 编号与真实业务关系不一致）。

**业务所有者裁定（2026-11-11）：选项 A** —— 委外成本口径由采购与委外域已冻结的 canonical 实现承担，
本域只做权威事实引用。落地：

| 项 | 落地内容 |
|---|---|
| Requirement §35.4.6 | 补入 **AA-W6.17～AA-W6.19**：口径归属、只读边界、变更归属与禁止条款 |
| Design §31.6.2 | 补入**委外成本口径**不变量，明确本域模块**不得**引入 `OUTSOURCE` 取数规则 |
| Requirement §35.3 | AA-07 行改写为「由 Procurement & Outsourcing 域的 canonical 实现承担，本域只做权威事实引用」 |
| 实现代码 | **未新增任何代码** —— 本域既无委外成本事实表，也无第二条委外加工费过账路径 |
| 选项 B | **未被采用**：本域**没有**新增委外成本只读端点 |

**后果**：AA-07 由 `PARTIAL` 转为 `COVERED`，全域复核结论为 **43 `COVERED` / 0 `PARTIAL` / 1 `OUT_OF_SCOPE`**，
与 §35.3 目标一致；`docs/status/CAPABILITY_MATRIX.md` 中 B3106 由 `BLOCKED` 转为 `VERIFIED`。

## 7. 待业务所有者授权：真实 MySQL Gate

Requirement §35.8.1 第 6 项的真实 MySQL parity / concurrency 需要：

1. 一份**本域专属的 ACK-4 清单**（描述目标 disposable 数据库、破坏性操作范围、子进程契约、清理证明与 RunId 形态），由业务所有者签发；
2. 一次**受授权的 RunId**；
3. 一个把本域纳入覆盖范围的 campaign（本轮**未**创建）。

统一 launcher 目前对未签发 ACK-4 的脚本一律 `BLOCKED`，因此本轮**未**运行任何真实 MySQL campaign。业务所有者可选择：

- **授权本域 campaign**：按 ACK-4 流程新建清单与 gate 脚本后运行，产出真实 MySQL 证据并把 §5.1 闭合；
- **本轮接受离线对等证据**：接受 §4 的离线 MySQL DDL 对等探针作为本域 schema 侧的 MySQL 路径证据，并把真实 MySQL Gate 登记为**域级 Acceptance 的后续条件**（此时 §35.8.1 第 6 项应记为**有界残余**，不得记为已通过）。

## 8. 签发后仍**不**签发的项

- **Manual Closure**（B3106 / B3107 / B3114–B3117 手册级关闭）是独立决定；
- **Release Readiness** 与任何 Domain 的发布授权；
- 真实环境 migration、业务数据库写入、发布、部署、远端 Git 操作（push / tag / merge）。

## 9. 本轮**未**发生的事项

- 未运行真实 MySQL Gate（§7）；
- 未在真实环境执行 migration，未写入任何业务数据库；
- 未 push / merge / tag / 发布 / 部署；
- 未把 AA-07 写成已覆盖，未代替业务所有者签发 Acceptance 或 Freeze；
- 未修改冻结的 V1.6 历史证据文件，未删除或降级任何共享断言。
