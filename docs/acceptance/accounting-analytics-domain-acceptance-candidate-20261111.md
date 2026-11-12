# Accounting & Analytics 域级 Acceptance 与 Capability Freeze 候签（2026-11-11）

> **用途**：本文件是 Accounting & Analytics 域**整域 Acceptance**与 **Capability Freeze** 的候签材料：汇总 AA-W1..AA-W7 七个范围包的实施范围、44 项 Capability 的逐项判定、Gate 证据、已披露限制与仍需业务所有者裁定的事项，供业务所有者据以签发（或退回）。
>
> **Owner**：Accounting & Analytics Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`SUPERSEDED` —— 本文件是候签材料（决定过程的证据），**已被** [`accounting-analytics-domain-acceptance-20261111.md`](./accounting-analytics-domain-acceptance-20261111.md) 取代；该签发记录才是 Acceptance 与 Freeze 的正式证据。本文件**不是** Manual Closure 或 Release Readiness 证据。
>
> **权威来源**：Requirement [`docs/requirements/accounting-analytics.md`](../requirements/accounting-analytics.md) §35；Design [`docs/design/accounting-analytics.md`](../design/accounting-analytics.md) §31；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §52；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)；逐项复核台账 [`docs/audits/accounting-analytics-capability-audit-20261110.md`](../audits/accounting-analytics-capability-audit-20261110.md) §7。
>
> **本文件的生成不等于** Git 提交、远端同步、发布、部署、真实环境 migration 或真实业务数据库写入。

```text
ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION
（已于 2026-11-12 签发：ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS / ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE）
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
| **真实 MySQL 8 parity / concurrency**（受保护 disposable MySQL 8.0.37） | **PASS**：run `253e14e6-83d7-4d4e-82d3-9465984fc122`、commit `0a81155`；`state=FINISHED`、清理由 root 独立 post-flight 证明；目标 `modern_erp_domain_test` @ `127.0.0.1:3306`，server uuid `256c7a4e-d275-11f1-885b-b025aa71d167`；见 §5.1 与 §7 |

## 5. 必须随验收一并接受的事实

### 5.1 真实 MySQL Gate 已运行并通过（Requirement §35.8.1 第 6 项闭合）

- **执行**：受保护 disposable MySQL 8.0.37，目标 `modern_erp_domain_test` @ `127.0.0.1:3306`，账号 `modern_erp_test`；
  ACK-4 manifest `ACCOUNTING_ANALYTICS_MYSQL_V1`，run `253e14e6-83d7-4d4e-82d3-9465984fc122`，commit `0a81155`；
  `RESULT = PASS`、`ACK-4 STATE = FINISHED`，清理由 root **独立 post-flight** 证明（运行前后目标库对象数均为 0）。
- **Parity**：本域 45 张新表与 AA-W5 加列的两张既有表（共 47 张）在真实 MySQL 8 目录上的**列集合、NULL 约束、
  UNIQUE 与 CHECK 条款**与 canonical SQLite 快照逐项一致（用生产比较器判定，未另写比较逻辑）。
- **Behaviour**：AA-W1 科目维护与事件台账、AA-W1 对账快照、AA-W2 凭证模板与规则、AA-W4 报表生命周期、
  AA-W5 政策折旧并生成可对账凭证（借 折旧费用 / 贷 累计折旧，且同期间幂等）、AA-W6 暂估差异调整凭证、
  AA-W7 经营账簿与关账前置，全部在真实 MySQL 上成立，权威事实由第三个进程直接从 MySQL 读取判定。
- **Concurrency**：两条独立应用进程共享同一个 MySQL 库并发写入 —— 会计科目、凭证模板、核算范围三条
  UNIQUE 边界各只有一个成功、另一个被拒，且权威表中只落一条。
- **金额**：本域全部 `*_cents` 列在真实 MySQL 上都是安全整数分。

**本次 campaign 暴露并已修复的两处真实缺陷**（均由本次实施产生，已提交）：

| 缺陷 | 现象 | 修复 |
|---|---|---|
| MySQL 重复键冲突返回 500 | MySQL 驱动把 `ER_DUP_ENTRY` 放在错误的 `code` 上、消息里只有人类可读文本，全局错误处理只看 `error.message`，因此并发重复插入在 MySQL 上是 500 而不是 409 | `server/app.js` 的全局处理同时检查 `error.code`（`90694fc`） |
| MySQL 目录字面量与 latin1 解码 | ① `information_schema` 的字符串列声明为 latin1，驱动把服务端的 utf8mb4 字节逐字节解码，中文默认值以多个单字节字符到达，比较器无法与 canonical SQLite 文本相等；② 目录把字符串字面量渲染成带反斜杠转义的定界符，比较器只接受单反斜杠形式 | 比较器按 UTF-8 还原目录列文本（`78c1666`），并把「反斜杠串 + 引号」整体当作定界符（`fe9d079`） |

**已披露限制**：本次 campaign **不**覆盖本域全部 85 条契约用例 —— 它覆盖 Parity、七个包的代表性权威写入路径、
三条并发边界与金额边界；逐条契约用例仍以本地 SQLite 套件（85/85）为准。campaign 也**不**覆盖 MySQL 下的
库存估值并发（该并发属 Inventory 域）。

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

## 7. 真实 MySQL Gate：已执行并通过

Requirement §35.8.1 第 6 项已由业务所有者 2026-11-11 的授权（`OWNER_AUTHORIZED_AA_MYSQL_ACK4_CAMPAIGN_2026-11-11`）闭合：

| 项 | 值 |
|---|---|
| campaign | `test:mysql:accounting-analytics`（`scripts/gates/mysql-accounting-analytics-gate.mjs`） |
| ACK-4 manifest | `ACCOUNTING_ANALYTICS_MYSQL_V1`（操作：`RESET_SCHEMA_PRE_RUN` / `BOOTSTRAP_CURRENT_SCHEMA` / `RUN_AA_HTTP_FIXTURES` / `CLEANUP_SCHEMA_POST_RUN`） |
| run | `253e14e6-83d7-4d4e-82d3-9465984fc122` |
| commit | `0a81155b97597c519a101827b050738cd0638f1c` |
| 目标 | `modern_erp_domain_test` @ `127.0.0.1:3306`，账号 `modern_erp_test`，server 8.0.37，uuid `256c7a4e-d275-11f1-885b-b025aa71d167` |
| 结果 | `RESULT = PASS`；`ACK-4 STATE = FINISHED`；清理由 root 独立 post-flight 证明（运行前后对象数均为 0） |

**本轮新建的受保护资产**：`scripts/gates/mysql-accounting-analytics-gate.mjs`、
`scripts/gates/mysql-accounting-analytics-child.mjs`、
`scripts/gates/mysql-accounting-analytics-root-lifecycle.mjs`、
`server/mysql-accounting-analytics.integration.js`、`server/test-support/accounting-mysql-http-fixture.js`；
`scripts/gates/run-mysql-local-gate.ps1` 的放行表改为按 manifest 名的白名单。
真实 MySQL integration 文件与既有 `mysql-*.integration.js` 一样**不**登记进 FULL / FAST 套件。

**同时修正的门禁完整性缺陷**：TAP 报告器此前只监听 `test:fail` 事件，嵌套子测试的失败不一定到达该事件，
于是失败套件的子进程仍以 0 退出，**门禁会把失败的套件报成 PASS**。已改为同时扫描合成 TAP 的 `not ok` 行，
并以「失败套件 → `failed = true`」的负例证明该守卫真正生效（`0a81155`）。
**该缺陷同样影响采购与委外域已签发的 M1-Core G07 campaign**（2026-11-11），该域的 PASS 结论需要按本修正重跑确认。

## 8. 签发后仍**不**签发的项

- **Manual Closure**（B3106 / B3107 / B3114–B3117 手册级关闭）是独立决定；
- **Release Readiness** 与任何 Domain 的发布授权；
- 真实环境 migration、业务数据库写入、发布、部署、远端 Git 操作（push / tag / merge）。

## 9. 本轮**未**发生的事项

- 未在真实环境执行 migration；真实 MySQL 只在受保护 disposable 目标上运行（§7）；
- 未在真实环境执行 migration，未写入任何业务数据库；
- 未 push / merge / tag / 发布 / 部署；
- 未把 AA-07 写成已覆盖，未代替业务所有者签发 Acceptance 或 Freeze；
- 未修改冻结的 V1.6 历史证据文件，未删除或降级任何共享断言。
