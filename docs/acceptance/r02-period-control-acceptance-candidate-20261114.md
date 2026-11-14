# R-02 期间控制一致性 域级 Acceptance 与 Capability Freeze 候签材料（2026-11-14）

> **用途**：登记 **R-02 期间控制一致性**（跨域有界解冻：Platform §36.15 + Accounting & Analytics
> §35.11 + Finance Operations §33.51 + Inventory & Warehouse §32.12）的**验收与冻结候签证据**、
> 合同项逐项判定、历史验收结论当前有效性复核，以及**随冻结待所有者裁定**的有界残余与未解决矛盾。
>
> **Owner**：业务所有者（Acceptance 与 Freeze 的**唯一**签字人）；Platform / 各域（证据维护）。
>
> **状态**：`PENDING_APPROVAL` —— **尚未签发**。本材料由实施方整理，**不代表** R-02 已通过验收、
> 能力已冻结。签发记录（若所有者裁定通过）将另立文件。
>
> **权威来源**：Requirement [`docs/requirements/platform.md`](../requirements/platform.md) §36.15、
> [`docs/requirements/accounting-analytics.md`](../requirements/accounting-analytics.md) §35.11、
> [`docs/requirements/finance-operations.md`](../requirements/finance-operations.md) §33.51、
> [`docs/requirements/inventory-warehouse.md`](../requirements/inventory-warehouse.md) §32.12；
> Design [`docs/design/platform.md`](../design/platform.md) §32.15、
> [`docs/design/accounting-analytics.md`](../design/accounting-analytics.md) §31.16、
> [`docs/design/finance-operations.md`](../design/finance-operations.md) §28.30、
> [`docs/design/inventory-warehouse.md`](../design/inventory-warehouse.md) §27.56；
> 唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；
> 实施与运行记录 [`log/2026-11-14.md`](../../log/2026-11-14.md) 单元十八～二十一。
>
> **本文件是验收与冻结**证据**，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于
> Git 提交、远端同步、发布或部署。

---

## 1. 候签结论与待所有者裁定的决定项

### 1.1 验收单元与合同项判定

**验收单元**：R-02 的 **8 条合同项**（下表）。R-02 是**跨域有界解冻**的一致性工作项，**不是**九域
整域能力矩阵的重签：本材料**不**重新认证各域的能力覆盖，只认证 R-02 建立的期间控制合同与其可执行证据。

判定口径（与既有域级验收一致）：① 生产写入口具备来源、状态机、权限与事务约束；② **已注册**的可执行
测试覆盖正例且至少一个反例；③ 有 operator 可达入口；④ 事实进入业务路径。

| # | 合同项 | 判定 | 关键证据 |
|---|---|---|---|
| R2-C01 | **单一 canonical 守卫入口**（§36.15.3）：全仓库只允许一个 active canonical 期间守卫，旧闸门不得复活 | `COVERED` | `server/modules/period-control.js` 是唯一判定入口；机器守卫 `verify-period-guard-coverage.mjs`：**旧闸门 0 处活跃调用**；`assertFinancialPeriodsOpen` / `assertInventoryPeriodOpen` / `assertFinanceBusinessDateOpen` / `checkPeriodNotClosedForVoucher` / `allowClosedInventoryPeriod` 全部退役 |
| R2-C02 | **动作 → 期间轴映射与 fail closed**（§36.15.4）：每个有业务日期的经济 mutation 声明具名动作；未登记动作 fail closed | `COVERED` | `server/modules/period-action-registry.js`：16 个具名动作 → 轴集合（冻结不可变）；未登记 → `500 PERIOD_ACTION_UNREGISTERED`；合同测试 `period-control-contract.test.js`（11 例）覆盖 action 矩阵、日期边界、缺失/断裂状态、锁排序、零副作用、SQLite/MySQL schema parity |
| R2-C03 | **四域 close / reopen 顺序与依赖**（§36.15.5）：正向 Inventory + Finance → Legal → Operating，反向逆序；重开强制原因 | `COVERED` | 法定关账三项前置（存货期间 + 三个 Finance 轴关至期末 + 连续顺序）；反结账 latest-only + reason 必填（Legal / Finance / Operating 三轴）；法定反结账先锁 Legal 再按 bookId 排序锁经营账簿；`period.test.js` 新增 4 条协议用例（17/17） |
| R2-C04 | **折让确认 / 冲销受 AR / AP 业务关闭保护**（§33.51.2.5）：不得「只生成凭证」或「沿用凭证期间检查」绕过 | `COVERED` | `server/modules/discounts.js` 改走 `FINANCE_AR_MUTATION` / `FINANCE_AP_MUTATION`；M14 折让套件 FULL 绿 |
| R2-C05 | **经营关账的职责分离**（§35.11.4 增补 / §31.16.4）：关账人不得是该期分摊规则创建人或分摊结果执行人；归属缺失 fail closed | `COVERED` | 加列 `allocation_rules.created_by` / `allocation_results.created_by`（SQLite 与 MySQL 同一权威迁移）+ 审计证据回填；`closeOperatingPeriod` 写事务内判定（`MANAGEMENT_PERIOD_SOD_VIOLATION` / `MANAGEMENT_PERIOD_SOD_ATTRIBUTION_MISSING`）；AA-W7 负控 + 新增用例（7/7） |
| R2-C06 | **失败零副作用与事务外拒绝证据**（§36.15.5）：拒绝必须发生在任何经济副作用之前，证据不得随回滚消失 | `COVERED` | 守卫只在写事务内运行；中央 catch 对期间拒绝码写**一次** `PERIOD_CONTROL` 拒绝审计（含 axis / businessDate / cutoff）；合同测试「拒绝后零写入」用例 + `period.test.js` 的 exactly-once 断言 |
| R2-C07 | **真实 MySQL handler 级并发证据**（§32.15.6）：关闭与 dated mutation 必须用真实 canonical handler 并发 | `COVERED` | R-02 专属 ACK-4 campaign：manifest `R02_PERIOD_CONTROL_MYSQL_V1`，`RESULT = PASS` / `ACK-4 STATE = FINISHED`；三个竞态场景 + 负控；schema 前后均为空（详见 §2.3） |
| R2-C08 | **跨域 operator 面**（§31.16.4 / §28.30.3）：反结账必须提交原因；Finance 关账 / 重开为受权限控制的操作面 | `COVERED` | `src/pages/accounting.jsx`（法定期间重开原因）、`src/pages/accounting-analytics.jsx`（经营期间重开原因弹窗）、`src/pages/finance-operations.jsx`（资金关账 / 重开工作面）；浏览器 UAT 见 §2.4 |

**计数**：**8 `COVERED` / 0 `PARTIAL` / 0 `MISSING` / 0 `OUT_OF_SCOPE`**（R-02 验收单元口径）。

### 1.2 候签建议

建议：**签发 R-02 的 Acceptance 与 Capability Freeze**，并接受 §6 的有界残余（逐项书面记录处置），
处置权仍在所有者。

### 1.3 需要所有者**逐项**裁定的事项

| # | 待裁定 | 说明 |
|---|---|---|
| D-01 | §6 的 **N 项有界残余**的处置（关闭 / 附理由接受 / 延期） | 本材料**不预判**任何一项；按既定规则由 Final Freeze Review 书面决定 |
| D-02 | §7 的 **M 项未解决矛盾**的处置 | 同上 |
| D-03 | §4 的 **35 份受影响历史记录**的复核结论是否接受 | 分类与失效点见 §4；引用时必须按本材料的类别与具体失效点标注 |
| D-04 | 冻结范围是否包含**跨域合同**（AA §35.11 增补、Finance §28.30.2 消歧、Inventory §32.12、Platform §36.15） | 这些合同是 R-02 的载体，冻结它们意味着期间控制的**跨域口径**从此固定 |

---

## 2. 验收证据

### 2.1 门禁证据（当前 HEAD `fc38e26`）

| 门禁 | 结果 |
|---|---|
| `node --test server/period-control-contract.test.js` | **11/11 PASS**（R-02 canonical 守卫合同） |
| `node --test server/period.test.js` | **17/17 PASS**（含 4 条新增关账 / 反关账协议用例） |
| `node --test server/accounting-analytics-w7.test.js` | **7/7 PASS**（含职责分离负控与回填用例） |
| `node --test server/mysql-r02-period-races.integration.js`（离线自检） | **7/7 PASS**（只证明夹具自洽，**不是** MySQL 证据） |
| `pnpm test:fast` | **774/774 PASS** |
| `pnpm test`（FULL） | **4044/4044 PASS** |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | 通过 |
| `git diff --check` | PASS |
| `scripts/qa/verify-period-guard-coverage.mjs` | **PASS**（已登记 16 个动作 / 生产代码使用 10 个 / 旧闸门 0 处活跃调用） |
| `scripts/qa/verify-error-code-coupling.mjs` | PASS |
| `scripts/qa/verify-acceptance-records.mjs` | PASS（`BROKEN 0`；`NEEDS_REVIEW` 需人工复核，见 §4） |
| `scripts/docs/check-doc-consistency.mjs --mode current` | N1 / N3–N9 **PASS**，N2 `RETIRED`（不参与 PASS / FAIL 判定） |

#### 2.1.1 门禁基线

以上门禁均在 **R-02 的最终提交序列**（`2347309` / `baf774d` / `c9c6eb3` / `600bb39` / `fc38e26`）之后
跑出；本材料的签发记录应复跑同一组门禁并引用其数值。

### 2.2 R-02 合同套件与覆盖面

| 套件 | 覆盖 |
|---|---|
| `server/period-control-contract.test.js`（11） | action 矩阵与轴集合、日期边界（含 2 月 30 日）、缺失锚点、断裂关闭链、未登记动作 fail closed、缺事务 fail closed、锁顺序（10/20/30/40/50/60）、拒绝后零写入、只读路径不修复状态、SQLite/MySQL schema parity 与锚点行 |
| `server/period.test.js`（新增 4） | 存货轴未关 → 拒关；Finance 轴未关至期末 → 拒关；跳期关闭 → 拒关；反结账强制原因 + 只允许最新期 |
| `server/accounting-analytics-w7.test.js`（新增 1 + 负控） | 经营关账的职责分离：自我关账被拒（状态不变）、归属落在业务行、归属缺失 fail closed、审计证据回填后恢复并可关账 |
| `server/mysql-r02-period-races.integration.js`（7） | 三个 handler 级竞态 + 三个负控 + 锚点 schema 形态与行锁（真实 MySQL 下同样通过） |

### 2.3 真实 MySQL 8.0.37 证据（R-02 专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `R02_PERIOD_CONTROL_MYSQL_V1`（夹具操作 `RUN_R02_PERIOD_RACES`） |
| 目标 | `modern_erp_domain_test` @ `127.0.0.1:3306`（MySQL 8.0.37，一次性可弃置） |
| 批准 | 业务所有者 2026-11-14 会话批准；ACK-4 capability 由 `scripts/gates/issue-mysql-ack4.ps1` 机械签发 |
| 结论 | **`RESULT = PASS` / `ACK-4 STATE = FINISHED`**（清理由 root 独立 post-flight 复核） |
| commitSha | `600bb39` |
| 已消费操作 | `RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_R02_PERIOD_RACES` → `CLEANUP_SCHEMA_POST_RUN` |
| 子进程 lease | 4 个全部已消费，manifest / commitSha / 目标身份逐项相符 |
| schema 前后 | 运行前与运行后独立 preflight 均为 `tables=0 views=0 triggers=0 routines=0 events=0` |
| 场景 | S1 库存关账 vs 库存 mutation；S2 法定关账 vs 记账型 mutation（含系统凭证）；S3 经营关账 vs 经营归集；S4 协调锚点 schema 形态与行锁可用性；每个场景带负控 |

**该证据证明**：真实 MySQL 8 上，关账与同轴 mutation 由**同一批稳定锁**串行化，结果只能是「mutation 先完成
并被关账快照纳入」或「关账先完成、mutation 被 409 拒绝」，**不存在** mutation 晚于关账提交的结果。

**该证据不证明**：R-02 的域级 Acceptance / Capability Freeze 已签发（本材料尚未签发）；也不证明九域整域
能力矩阵。

**首次运行的失败已如实登记**：首次运行在 `BOOTSTRAP_CURRENT_SCHEMA` 失败并**已消耗**当次 capability
（SOD 迁移用了 MySQL 不接受的 `CREATE INDEX IF NOT EXISTS`）；迁移改为可移植写法后新签发 capability
重跑通过（提交 `600bb39`）。

### 2.4 浏览器证据（防空壳）

| 脚本 | 覆盖面 | 结果 |
|---|---|---|
| `scripts/acceptance/accounting-analytics-responsive-uat.mjs` | AA 六个工作面（320 / 390 / 430 / 680 CSS px），含 **经营会计**（R-02 的经营期间重开原因弹窗） | **6/6 PASS**，浏览器错误 0 |
| `scripts/acceptance/finance-operations-responsive-uat.mjs` | Finance 六个工作面（320 / 390 / 430 / 680 CSS px），含 **资金管理**（R-02 新增的业务关账 / 重开工作面） | **24/24 PASS** |
| `scripts/acceptance/r02-period-control-responsive-uat.mjs`（本轮新增） | **会计期间**（R-02 的法定期间重开原因）：四档宽度渲染 + 弹窗内「重开原因」必填 + 空原因时「重开」按钮禁用 / 填写后可用 + 无控制台错误 | **3/3 PASS** |

#### 2.4.1 关于会计期间工作面的浏览器证据

R-02 改动的三个 operator 面中，**经营会计**与**资金管理**由既有 UAT 覆盖（见上表），
**会计期间**此前没有专门覆盖 —— 本轮新增 `scripts/acceptance/r02-period-control-responsive-uat.mjs`
做定向覆盖（真实 Edge + 真实后端 + 真实关账记录夹具），证据写入
`docs/evidence/r02-period-control/`。

**未重跑**：既有 `scripts/acceptance/p3-ui-acceptance.mjs`（五角色 × 七宽度路由可达矩阵）在本机重跑时
长时间无输出挂起，已终止；因此本材料**不**为该脚本的当前结果背书。R-02 实际改动的会计期间工作面由上表
的定向 UAT 覆盖，其余路由可达性不在 R-02 的变更范围。

### 2.5 本轮修复的真实缺陷（实施期发现）

| # | 缺陷 | 处置 |
|---|---|---|
| 1 | 迁移脚本删除含旧闸门的整条 import 时**连带删掉同语句的兄弟导入**（9 个文件） | 全部恢复；改用「HEAD vs 工作树导入集合比对」做机器检查 |
| 2 | 守卫要求写事务，而估值 / 资金流水等 canonical 写原语此前可在事务外被调用 | `runGuardedMutation`：独立入口自持事务，已有事务则内联 |
| 3 | 折让确认 / 冲销此前**只查法定期间**，绕过 AR / AP 业务关闭 | 改走 `FINANCE_AR_MUTATION` / `FINANCE_AP_MUTATION` |
| 4 | 库存调整冲销的两处期间检查在事务外执行 | 移入写事务并置于权威状态重读之后 |
| 5 | 凭证冲销 / 补记的本地 `assertPeriodOpen` 是第二套判定语义 | 改走 canonical LEGAL 轴并移入事务；错误码统一为 `FINANCIAL_PERIOD_CLOSED` |
| 6 | 法定关账前置失败返回 400，且缺「存货未关」「Finance 未关至期末」两条依赖 | 统一 409 族错误码并补齐依赖 |
| 7 | 反结账缺少 latest-only 与 reason 约束（法定轴、Finance 轴、经营轴） | 三轴统一 |
| 8 | 组装 / 拆卸模块在 dispatcher 之外还有第二道库存期间闸门 | 删除第二道 |
| 9 | 经营关账的 SOD 用「归集计划创建人」近似，**不是** Design 点名的分摊规则创建人 / 分摊结果执行人 | 按已批准 Design 加 `created_by` 列 + 审计证据回填，按原文实现；归属缺失 fail closed |
| 10 | SOD 迁移用 `CREATE INDEX IF NOT EXISTS`，MySQL 不接受 | 改为「重复即忽略」的可移植建索引（首次 campaign 因此失败并消耗 capability） |

---

## 3. 跨域影响登记（AGENTS.md §4.6）

R-02 改动**其他域**的已签发行为共 **4 处**，全部登记：

| 域 | 受影响行为 | 性质 | 处置 |
|---|---|---|---|
| Accounting & Analytics | 经营期间**关账**从此拒绝「既分摊又关账」的同一人；AA-W7 的既有关账用例改用另一个角色 | **收紧**（已批准 Requirement §35.11.4 增补） | 记录于 `log/2026-11-14.md` 单元二十；AA-W7 验收结论的当前有效性按 §4 复核 |
| Accounting & Analytics | 法定关账前置（存货期间 + 三个 Finance 轴）与反结账顺序收紧 | 收紧 | 同上 |
| Finance Operations | 折让确认 / 冲销自此受 AR / AP 业务关闭保护（此前只查法定期间）；Finance 关账 / 重开强制原因 | 收紧 | 同上 |
| Inventory & Warehouse | 库存数量 / 身份 / 价值 mutation 自此同时受存货轴与法定轴保护；存货关账以稳定锚点加锁 | 收紧 | 同上 |
| 四域（共同） | 期间拒绝的错误码与文案统一（`INVENTORY_PERIOD_CLOSED` / `FINANCIAL_PERIOD_CLOSED` / `FINANCE_PERIOD_CLOSED` / `OPERATING_PERIOD_CLOSED`），关账前置失败由 400 改为统一 409 | 收紧 + 错误码族收敛 | 引用旧错误码的下游须按 §4.6 复核 |

**未发生**：R-02 **未**改变任何业务状态机、状态词表、既有权限集合、API 路径或请求主体；**未**合并任何期间表；
**未**改写既有期间历史。

---

## 4. 历史验收结论当前有效性复核（AGENTS.md §4.6）

### 4.1 复核方法

1. 机器守卫 `scripts/qa/verify-acceptance-records.mjs`：**80 份记录，`BROKEN` 0；70 份 `NEEDS_REVIEW`**（需人工复核）。
2. 本轮复核**被 R-02 的五个提交改动过引用路径**的 **35 份**记录：提交 `2347309`（Implementation）、
   `baf774d`（三项矛盾处置 + campaign）、`c9c6eb3`（SOD 实施）、`600bb39`（可移植索引修正）、
   `fc38e26`（campaign 结果登记），共改动 86 个仓库路径。
3. 其余 **35 份**由其它域 / 其它轮次的改动引起，**不属于** R-02 复核范围，仍待各域自身的域级审计复核。

### 4.2 复核结论

| 分类 | 份数 | 依据 |
|---|---|---|
| `STILL_VALID` | 11 | R-02 的改动只落在**期间闸门路径**上；该记录的主题（信用读原语、测试隔离、M1-Core 设计状态指针、Wave 实现映射等）与期间闸门语义无关；其引用的实现路径仍然存在，且当前 HEAD 的 FULL / HEAVY / build 门禁全绿 |
| `NEEDS_REVIEW` | 24 | ① 其结论**直接依赖**被 R-02 改动的合同或实现路径（关账 / 反结账 / 期间 / 折让 / 库存 / 资金）；或 ② 其引用的**计数**（FULL / 浏览器 / HEAVY）与**浏览器证据覆盖的页面**已过期。**引用时必须按 §4.3 的具体失效点标注** |

未撤销、未改写任何已签发结论。

### 4.3 判 `NEEDS_REVIEW` 的 24 份（引用时须按此处的具体失效点标注）

| # | 记录 | 具体失效点 |
|---|---|---|
| 1 | [`accounting-analytics-domain-acceptance-20261111.md`](./accounting-analytics-domain-acceptance-20261111.md) | R-02 修订 AA 合同（§35.11.4 增补）并改变关账行为；其 FULL 3708 与浏览器 6/6 覆盖的会计凭证页 / 经营会计页已过期 |
| 2 | [`accounting-analytics-domain-acceptance-candidate-20261111.md`](./accounting-analytics-domain-acceptance-candidate-20261111.md) | 同上（其 FULL 3695 已过期） |
| 3 | [`finance-operations-domain-acceptance-20261112.md`](./finance-operations-domain-acceptance-20261112.md) | R-02 收紧 AR / AP / 资金三轴的期间语义与折让路径；其 FULL 3728 已过期；其浏览器证据覆盖的资金页被 R-02 新增了关账 / 重开工作面 |
| 4 | [`finance-operations-domain-acceptance-candidate-20261112.md`](./finance-operations-domain-acceptance-candidate-20261112.md) | 同上 |
| 5 | [`inventory-warehouse-domain-acceptance-20261113.md`](./inventory-warehouse-domain-acceptance-20261113.md) | R-02 改变存货关账的法定依赖、锁协议与库存 mutation 的期间闸门；其 FULL 3766 已过期 |
| 6 | [`inventory-warehouse-domain-acceptance-candidate-20261112.md`](./inventory-warehouse-domain-acceptance-candidate-20261112.md) | 同上（其 FULL 3766 已过期） |
| 7 | [`platform-domain-acceptance-20261114.md`](./platform-domain-acceptance-20261114.md) | PL-13 的判定由「封顶 + 收敛增量 `OUT_OF_SCOPE`」变为**已实现**的 canonical 守卫；其 FULL 4020 已过期 |
| 8 | [`platform-domain-acceptance-candidate-20261114.md`](./platform-domain-acceptance-candidate-20261114.md) | 同上 |
| 9 | [`acceptance-record-revalidation-20261112.md`](./acceptance-record-revalidation-20261112.md) | 其分类表是 **2026-11-12** 的快照；R-02 又使 35 份记录进入复核范围 |
| 10 | [`sales-customer-domain-acceptance-20261113.md`](./sales-customer-domain-acceptance-20261113.md) | （原判：浏览器 88/88 覆盖的销售订单详情页此后被改）R-02 追加：`server/app.js` 与资金 / 会计页再被改，其 FULL 3885 已过期 |
| 11 | [`sales-customer-domain-acceptance-candidate-20261113.md`](./sales-customer-domain-acceptance-candidate-20261113.md) | 同上（其 FULL 3881 已过期） |
| 12 | [`manufacturing-quality-domain-acceptance-20261112.md`](./manufacturing-quality-domain-acceptance-20261112.md) | （原判：平台 SOD 接线改变生产工单自审批行为）R-02 未改该行为，但改变了生产完工与采购入库路径的期间闸门；其 FULL 3749 已过期 |
| 13 | [`master-engineering-domain-acceptance-20261112.md`](./master-engineering-domain-acceptance-20261112.md) | R-02 改动了 `document.md` 与 `server/app.js`（其引用路径漂移）；其 FULL 3740 已过期 |
| 14 | [`master-engineering-domain-acceptance-candidate-20261112.md`](./master-engineering-domain-acceptance-candidate-20261112.md) | 同上 |
| 15 | [`procurement-outsourcing-domain-acceptance-20261111.md`](./procurement-outsourcing-domain-acceptance-20261111.md) | 其引用的 `server/period.test.js` 被 R-02 改写（关账前置语义），记录中关于关账行为的描述需按新合同复核 |
| 16 | [`m1-core-wp7a-gate-acceptance-20261103.md`](./m1-core-wp7a-gate-acceptance-20261103.md) | 其证据路径（`inventory-mutation` / `financial-inventory` / `outsourcing` / `test-suites` / ACK-4 启动器）被 R-02 改写；ACK-4 manifest 注册表新增了 `R02_PERIOD_CONTROL_MYSQL_V1` |
| 17 | [`m1-core-wp7a-r1-offline-evidence-20261107.md`](./m1-core-wp7a-r1-offline-evidence-20261107.md) | 同上（其 FULL 3331 已过期） |
| 18 | [`m1-core-wp7a-r2-offline-evidence-20261107.md`](./m1-core-wp7a-r2-offline-evidence-20261107.md) | 同上（其 FULL 3337 已过期） |
| 19 | [`m1-core-g04-negative-increment-reachability-20261107.md`](./m1-core-g04-negative-increment-reachability-20261107.md) | 其证据路径（`outsourcing-finance` / `outsourcing`）的期间闸门被 R-02 改写 |
| 20 | [`m1-core-g04-owner-acceptance-20261107.md`](./m1-core-g04-owner-acceptance-20261107.md) | 同上（其 FULL 3344 已过期） |
| 21 | [`out001-candidate-freeze-20261109.md`](./out001-candidate-freeze-20261109.md) | `server/db.js` / `outsourcing-finance.js` 被 R-02 改写；其 FULL 3438 已过期；ACK-4 manifest 注册表已变 |
| 22 | [`out001-gate-ready-preflight-20261109.md`](./out001-gate-ready-preflight-20261109.md) | `scripts/gates/ack4/ack4-runtime.mjs` 被 R-02 改写（新增 manifest）；其 gate 入口集合已变 |
| 23 | [`g0-governance-acceptance-20261101.md`](./g0-governance-acceptance-20261101.md) | `document.md`（§0.1 导航）被 R-02 增补，其合同路径漂移需复核 |
| 24 | [`n7-traceability-ledger.md`](./n7-traceability-ledger.md) | 台账条目集合未变（R-02 的提交信息合规，N7 以提交信息路径通过），但台账引用的受治理文件清单已漂移，需复核 |

### 4.4 判 `STILL_VALID` 的 11 份

`sales-customer/batch-a-implementation-mapping.md`、`sales-customer/f2-implementation-status-clarification.md`、
`sales-customer/package-b-final-acceptance.md`、`sales-customer/w11-a-overdue-acceptance-and-freeze.md`、
`sales-customer/w11-a-u1-acceptance-and-freeze.md`、`sales-customer/w11-a-u2-acceptance-and-freeze.md`、
`sales-customer/w11-sec-01-acceptance-and-freeze.md`、`sales-customer/wave-0-2-implementation-records.md`、
`sales-customer/wave-10-capability-freeze.md`、`sales-customer/wave-8-stage-d-implementation-evidence.md`、
`sales-customer/wave-capability-and-gate-evidence.md`。

依据：这些记录的主题是信用读原语、测试隔离能力、Wave 实现映射与状态事实，**不依赖期间闸门语义**；
R-02 对其引用路径的改动只落在**期间判定**上，其引用的实现路径仍然存在，且当前 HEAD 的
FULL / HEAVY / build 门禁全绿。

---

## 5. 覆盖逐项判定（8 项）

见 §1.1。判定依据：① 生产入口与事务约束；② 已注册的可执行测试（正例 + 至少一个反例）；③ operator 可达入口；
④ 事实进入业务路径。四项**全部**满足方判 `COVERED`。

---

## 6. 随冻结待裁定的有界残余（**本材料不预判任何一项的处置**）

| # | 残余 | 说明 |
|---|---|---|
| R-01 | 生命周期归档预检仍按**期间精确匹配**读取期间表 | 数据生命周期的归档预检是 CHECK 面（只读），不是有日期的经济 mutation；R-02 的 canonical 守卫不适用于它，因此保留既有判定语义 |
| R-02 | `allocation_results` 的**分摊执行人**只对「经由 canonical handler 写入」的行可得 | 直接写入 `allocation_results` 的历史行若无对应审计证据，其归属留空并按 fail closed 拒绝关账；这是有意的保守方向，但确实缩小了可直接关账的历史期间范围 |

> 上述 2 项**均未**在本材料中写成「本身不阻塞冻结」。按既定规则，处置决定由
> **Final Freeze Review** 作出并书面记录（关闭 / 附理由接受 / 延期）。

---

## 7. 未解决矛盾

| # | 矛盾 | 状态 |
|---|---|---|
| U-01 | **关账人的归属判定与「关账人即分摊执行人」在旧数据上的可得性**：历史 `allocation_results` 若无审计证据则归属为空 | 已按 fail closed 收敛；作为 R-02 残余 R-02 登记，**未**描述为「已解决」 |
| U-02 | **闸门命中的轴可能不是业务方期望的那一条**：锁序里存货轴（10）排在法定轴（50）之前，因此同期间的写动作通常先被存货轴拒绝 | 已在合同与测试中明确（拒绝码可含两个值）；这不改变 fail closed 结论 |
| U-03 | **R-02 的验收单元不是九域整域能力矩阵**：本材料只认证 8 条合同项 | 已由所有者裁定 D-04 决定是否连同跨域合同一并冻结 |

---

## 8. 冻结范围（候签）

**冻结**：R-02 的 8 条合同项及其实现、schema、测试与证据；以及承载它们的四份跨域合同修订
（Platform §36.15、AA §35.11 增补、Finance §28.30、Inventory §32.12）。

**不包含**：九域整域能力矩阵的重签 · Manual Closure（B3101–B3122 手册级关闭）· Release Readiness ·
发布 · 部署 · 真实环境 migration · 业务数据库写入 · 远端 Git 操作 · 其它域的 Acceptance。

---

## 9. 未发生的事实声明

- **未**执行任何真实环境 migration、**未**写入业务数据库、**未**连接生产库。
- **未**做 push / tag / merge / 部署 / 发布；`package.json` 版本与 release tag 未改变。
- **未**撤销或改写任何已签发的 Acceptance / Freeze 结论；§4 的复核只标注当前有效性。
- **未**签发任何 Acceptance / Freeze 标识：本材料**尚未签发**。
- **未**合并任何期间存储表；既有期间历史未回填、未改写。
