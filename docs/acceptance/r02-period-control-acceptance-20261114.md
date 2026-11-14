# R-02 期间控制一致性 域级 Acceptance 与 Capability Freeze 记录（2026-11-14）

> **用途**：登记业务所有者对 **R-02 期间控制一致性**（跨域有界解冻）的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：业务所有者（Acceptance 与 Freeze 的**唯一**签字人）；Platform / 各域（证据维护）。
>
> **状态**：`FROZEN` —— R-02 的域级 Acceptance 已签发；**8 条合同项与承载它们的四份跨域合同已冻结**。
> **Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/platform.md`](../requirements/platform.md) §36.15、
> [`docs/requirements/accounting-analytics.md`](../requirements/accounting-analytics.md) §35.11、
> [`docs/requirements/finance-operations.md`](../requirements/finance-operations.md) §33.51、
> [`docs/requirements/inventory-warehouse.md`](../requirements/inventory-warehouse.md) §32.12；
> Design [`docs/design/platform.md`](../design/platform.md) §32.15、
> [`docs/design/accounting-analytics.md`](../design/accounting-analytics.md) §31.16、
> [`docs/design/finance-operations.md`](../design/finance-operations.md) §28.30、
> [`docs/design/inventory-warehouse.md`](../design/inventory-warehouse.md) §27.56；
> 唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、
> 远端同步、发布或部署。
>
> **本记录取代**同目录的候签材料
> [`r02-period-control-acceptance-candidate-20261114.md`](./r02-period-control-acceptance-candidate-20261114.md)
> （`R02_PERIOD_CONTROL_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION`，保留不删）。

```text
R02_PERIOD_CONTROL_ACCEPTANCE_PASS
R02_PERIOD_CONTROL_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在本轮对话中先批准 R-02 的两项开放前置（经营关账 SOD 的实施、专属 ACK-4 campaign 的运行），
在呈报候签材料后**逐项裁定**：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`R02_PERIOD_CONTROL_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 R-02 的 8 条合同项**（`R02_PERIOD_CONTROL_CAPABILITY_FREEZE`） |
| 合同项判定 | R2-C01..R2-C08 共 **8 项**：`COVERED` **8**、`PARTIAL` **0**、`MISSING` **0**、`OUT_OF_SCOPE` **0** |
| **残余处置裁定** | §6 的 **2 项有界残余随冻结接受**，书面理由见 §6 |
| **未解决矛盾裁定** | §7 的 **3 项未解决矛盾随冻结接受（不阻塞冻结）**，冻结时的状态见 §7 |
| **历史记录复核裁定** | 接受本轮 §4 的逐条失效点登记：11 份 `STILL_VALID`、24 份 `NEEDS_REVIEW`；引用时必须标注类别与具体失效点 |
| **冻结范围裁定** | **包含跨域合同**：Platform §36.15、AA §35.11（增补）、Finance §28.30.2（消歧）、Inventory §32.12 一并冻结 |
| 实现锚点 | `2347309`（canonical 守卫实施）、`baf774d`（三项矛盾处置 + campaign 建成）、`c9c6eb3`（经营关账 SOD 实施）、`600bb39`（可移植索引修正）、`fc38e26`（campaign 结果登记）、`7b99acf`（候签材料 + 定向浏览器 UAT） |

决定来源是当前对话中所有者的明确指令与逐项裁定；不存在虚构的手写签名、电子签章、外部审批单或未发生的
真实 MySQL 运行记录：ACK-4 能力由所有者在会话中批准、由 `scripts/gates/issue-mysql-ack4.ps1` 机械签发，
真实 MySQL 运行由受保护启动器执行并留下消费标记，所有门禁数字均为本轮实测。

**冻结范围**：R-02 的 8 条合同项（`R2-C01`..`R2-C08`）及其实现、schema、测试与证据；以及承载它们的
四份跨域合同修订（Platform §36.15、AA §35.11 增补、Finance §28.30.2 消歧、Inventory §32.12）。

**冻结不包含**：九域整域能力矩阵的重签 · Manual Closure（B3101–B3122 手册级关闭）· Release Readiness ·
发布 · 部署 · 真实环境 migration · 业务数据库写入 · 远端 Git 操作 · 其它域的 Acceptance。

## 2. 验收证据

| 门禁 | 结果 |
|---|---|
| `node --test server/period-control-contract.test.js` | **11/11 PASS** |
| `node --test server/period.test.js` | **17/17 PASS**（含 4 条新增关账 / 反关账协议用例） |
| `node --test server/accounting-analytics-w7.test.js` | **7/7 PASS**（含职责分离负控与回填用例） |
| `node --test server/mysql-r02-period-races.integration.js`（离线自检） | **7/7 PASS**（只证明夹具自洽） |
| `pnpm test:fast` | **774/774 PASS** |
| `pnpm test`（FULL） | **4044/4044 PASS** |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | 通过 |
| `git diff --check` | PASS |
| `scripts/qa/verify-period-guard-coverage.mjs` | **PASS**（已登记 16 个动作 / 生产代码使用 10 个 / 旧闸门 0 处活跃调用） |
| `scripts/qa/verify-error-code-coupling.mjs` | PASS |
| `scripts/qa/verify-acceptance-records.mjs` | PASS（`BROKEN 0`） |
| `scripts/docs/check-doc-consistency.mjs --mode current` | N1 / N3–N9 **PASS**，N2 `RETIRED`（不参与 PASS / FAIL 判定） |

### 2.1 真实 MySQL 8.0.37 证据（R-02 专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `R02_PERIOD_CONTROL_MYSQL_V1`（夹具操作 `RUN_R02_PERIOD_RACES`） |
| 目标 | `modern_erp_domain_test` @ `127.0.0.1:3306`（MySQL 8.0.37，一次性可弃置） |
| 结论 | **`RESULT = PASS` / `ACK-4 STATE = FINISHED`**（清理由 root 独立 post-flight 复核） |
| commitSha | `600bb39` |
| 已消费操作 | `RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_R02_PERIOD_RACES` → `CLEANUP_SCHEMA_POST_RUN` |
| 子进程 lease | 4 个全部已消费，manifest / commitSha / 目标身份逐项相符 |
| schema 前后 | 运行前与运行后独立 preflight 均为 `tables=0 views=0 triggers=0 routines=0 events=0` |
| 场景 | S1 库存关账 vs 库存 mutation；S2 法定关账 vs 记账型 mutation（含系统凭证）；S3 经营关账 vs 经营归集；S4 协调锚点 schema 形态与行锁可用性；每个场景带负控 |

**该证据证明**：真实 MySQL 8 上，关账与同轴 mutation 由**同一批稳定锁**串行化，结果只能是「mutation 先完成
并被关账快照纳入」或「关账先完成、mutation 被 409 拒绝」，**不存在** mutation 晚于关账提交的结果。

**该证据不证明**：九域整域能力矩阵已被重新认证。

**首次运行的失败已如实登记**：首次运行在 `BOOTSTRAP_CURRENT_SCHEMA` 失败并**已消耗**当次 capability
（SOD 迁移用了 MySQL 不接受的 `CREATE INDEX IF NOT EXISTS`）；迁移改为可移植写法后**新签发** capability
重跑通过（提交 `600bb39`）。

### 2.2 浏览器证据（防空壳）

| 脚本 | 覆盖面 | 结果 |
|---|---|---|
| `accounting-analytics-responsive-uat.mjs` | AA 六个工作面（320 / 390 / 430 / 680 CSS px），含**经营会计**（经营期间重开原因弹窗） | **6/6 PASS**，浏览器错误 0 |
| `finance-operations-responsive-uat.mjs` | Finance 六个工作面（320 / 390 / 430 / 680 CSS px），含**资金管理**（新增的业务关账 / 重开工作面） | **24/24 PASS** |
| `r02-period-control-responsive-uat.mjs`（本轮新增） | **会计期间**（法定期间重开原因）：四档宽度渲染 + 弹窗内「重开原因」必填 + 空原因时「重开」按钮禁用 / 填写后可用 + 无控制台错误 | **3/3 PASS**（证据：`docs/evidence/r02-period-control/`） |

**未重跑并如实登记**：既有 `p3-ui-acceptance.mjs`（五角色 × 七宽度路由可达矩阵）在本机重跑时长时间无输出
挂起、已终止；本记录**不**为其当前结果背书。R-02 实际改动的会计期间工作面由上表的定向 UAT 覆盖，其余路由
可达性不在 R-02 的变更范围。

### 2.3 本轮修复的真实缺陷（10 项）

见候签材料 §2.5（迁移脚本误删兄弟导入、守卫要求写事务、折让绕过 AR/AP 业务关闭、库存调整冲销在事务外检查、
凭证冲销 / 补记的第二套判定、法定关账前置的 400 与缺失依赖、反结账缺 latest-only 与 reason、组装拆卸的第二道
库存闸门、经营关账 SOD 的近似实现、SOD 迁移的 MySQL 不可移植建索引）。

## 3. 跨域影响登记（AGENTS.md §4.6）

R-02 改动**其他域**的已签发行为共 4 处（AA 的经营关账与法定关账前置、Finance 的折让与关账 / 重开、
Inventory 的库存 mutation 与存货关账、四域共同的错误码族收敛），全部为**收紧**，逐项见候签材料 §3。

**未发生**：R-02 **未**改变任何业务状态机、状态词表、既有权限集合、API 路径或请求主体；**未**合并任何
期间表；**未**改写既有期间历史。

## 4. 历史验收结论当前有效性复核（AGENTS.md §4.6）

**方法**：机器守卫 `verify-acceptance-records.mjs`（80 份记录，`BROKEN` 0；70 份 `NEEDS_REVIEW` 需人工复核）
＋ 本轮对**被 R-02 的五个提交改动过引用路径**的 **35 份**记录的逐份复核。其余 35 份由其它域 / 其它轮次的
改动引起，**不属于** R-02 复核范围，仍待各域自身的域级审计复核。

**结论（Owner 已裁定接受）**：**11 份 `STILL_VALID`** ＋ **24 份 `NEEDS_REVIEW`**。未撤销、未改写任何
已签发结论。

### 4.1 判 `NEEDS_REVIEW` 的 24 份（引用时须按此处的具体失效点标注）

见候签材料 §4.3 的逐份表格（每份写明：其结论直接依赖被 R-02 改动的合同 / 实现路径，或其引用的计数与
浏览器证据已过期）。

### 4.2 判 `STILL_VALID` 的 11 份

见候签材料 §4.4。依据：这些记录的主题（信用读原语、测试隔离能力、M1-Core 设计状态指针、Wave 实现映射等）
**不依赖期间闸门语义**；R-02 对其引用路径的改动只落在**期间判定**上，其引用的实现路径仍然存在，且当前
HEAD 的 FULL / HEAVY / build 门禁全绿。

## 5. 合同项逐项判定（8 项）

判定依据：① 生产入口与事务约束；② 已注册的可执行测试（正例 + 至少一个反例）；③ operator 可达入口；
④ 事实进入业务路径。四项**全部**满足方判 `COVERED`。

| # | 合同项 | 判定 | 关键证据 |
|---|---|---|---|
| R2-C01 | 单一 canonical 守卫入口（§36.15.3） | `COVERED` | 旧闸门 0 处活跃调用（机器守卫）；五个旧闸门全部退役 |
| R2-C02 | 动作 → 期间轴映射与未登记 fail closed（§36.15.4） | `COVERED` | 16 个具名动作；未登记 → `PERIOD_ACTION_UNREGISTERED`；合同测试 11 例 |
| R2-C03 | 四域 close / reopen 顺序与依赖（§36.15.5） | `COVERED` | 法定关账三项前置；反结账 latest-only + reason 必填；三轴一致 |
| R2-C04 | 折让确认 / 冲销受 AR / AP 业务关闭保护（§33.51.2.5） | `COVERED` | 折让改走 `FINANCE_AR_MUTATION` / `FINANCE_AP_MUTATION` |
| R2-C05 | 经营关账的职责分离（§35.11.4 增补 / §31.16.4） | `COVERED` | 加列 + 审计证据回填；`closeOperatingPeriod` 内 fail closed 判定；负控 + 回填用例 |
| R2-C06 | 失败零副作用与事务外拒绝证据（§36.15.5） | `COVERED` | 守卫只在写事务内运行；期间拒绝码写一次事务外审计（含 axis / businessDate / cutoff） |
| R2-C07 | 真实 MySQL handler 级并发证据（§32.15.6） | `COVERED` | campaign `RESULT = PASS` / `ACK-4 STATE = FINISHED`（三个竞态 + 负控） |
| R2-C08 | 跨域 operator 面（§31.16.4 / §28.30.3） | `COVERED` | 三个 operator 面 + 浏览器 UAT（6/6、24/24、3/3） |

## 6. 随冻结接受的有界残余（Owner 已裁定：随冻结接受）

| # | 残余 | 随冻结接受的理由 |
|---|---|---|
| R-01 | **生命周期归档预检仍按期间精确匹配读取期间表** | 归档预检是**只读 CHECK 面**（为 operator 产出阻塞项清单），不是有业务日期的经济 mutation；R-02 的 canonical 守卫按合同只覆盖后者。把它并入会把「归档」变成需要期间轴的动作，超出 R-02 的验收单元与合同范围。 |
| R-02 | **`allocation_results` 的分摊执行人只对经 canonical handler 写入的行可得** | 直接写入 `allocation_results` 的历史行若没有对应审计证据，其归属留空并按 fail closed **拒绝关账**。这是有意的保守方向：宁可拒绝一次关账，也不臆测一个执行人；补录归属的流程属后续轮次。 |

> 上述 2 项按 Owner 裁定**随冻结接受**，理由如上；它们**不构成**「已证明」或「已消除」的声明，
> 在后续文档中不得被描述为已解决。

## 7. 未解决矛盾（冻结时的状态）

| # | 矛盾 | 冻结时的状态 |
|---|---|---|
| U-01 | **历史归属缺失导致关账被拒**（旧 `allocation_results` 无审计证据 → 归属为空 → fail closed） | **已裁定随冻结接受**（不阻塞）：作为 §6 的 R-02 登记；补录归属的流程属后续轮次，不得被描述为已解决 |
| U-02 | **闸门命中的轴可能不是业务方期望的那一条**（锁序里存货轴 rank 10 排在法定轴 rank 50 之前，同期间的写动作通常先被存货轴拒绝） | **已裁定随冻结接受**（不阻塞）：这是锁序的必然结果且方向更保守；合同与测试已明确拒绝码可含两个值，fail closed 结论不变 |
| U-03 | **R-02 的验收单元不是九域整域能力矩阵** | **已裁定随冻结接受**（不阻塞）：本记录只认证 R-02 的 8 条合同项；九域整域矩阵的重签属各域自身的 Acceptance 轮次 |

## 8. 冻结后的剩余工作

- **九域整域能力矩阵的重签**：**未做**，属各域自身的域级 Acceptance 轮次；R-02 的冻结不代替它们。
- **Manual Closure**（B3101–B3122 手册级关闭）与 **Release Readiness**：**未签发**，属下一轮；22 本手册逐本决定。
- §6 的 2 项残余按 §6 的理由保持登记状态，不得在后续文档中被描述为已证明或已消除。
- §4.1 的 24 份 `NEEDS_REVIEW` 引用的兄弟域证据点保持登记，待各域自身审计复核。
- 既有 `p3-ui-acceptance.mjs` 的当前结果未被本记录背书（见 §2.2）。

## 9. 未发生的事实声明

本记录中不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录：ACK-4 能力由业务所有者在
会话中批准、由 `scripts/gates/issue-mysql-ack4.ps1` 机械签发；真实 MySQL 运行由受保护启动器执行并留下
消费标记；所有门禁数字均为本轮实测。
