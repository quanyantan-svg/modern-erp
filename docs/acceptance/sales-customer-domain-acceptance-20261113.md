# Sales & Customer 销售与客户域级 Acceptance 与 Capability Freeze 记录（2026-11-13）

> **用途**：登记业务所有者对 Sales & Customer 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Sales & Customer Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；**36 项 `COVERED` 能力已冻结**。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/sales-customer/01-domain-closure.md`](../requirements/sales-customer/01-domain-closure.md) §34.2～§34.14 与 [`05-wave-11-amendments.md`](../requirements/sales-customer/05-wave-11-amendments.md)；Design [`docs/design/sales-customer/`](../design/sales-customer/) §29 / §36 / §37.54；逐项判定 [`docs/audits/sales-customer-capability-audit-20261113.md`](../audits/sales-customer-capability-audit-20261113.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
SALES_CUSTOMER_DOMAIN_ACCEPTANCE_PASS
SALES_CUSTOMER_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者于本轮指示「现在做 Sales & Customer 业务域 补齐剩余缺口 进行最后验收 最终目标是域级 acceptacne 和能力 freezen」，并在候签材料呈报后裁定「批准签发并运行 campaign」与「签发」。据此：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`SALES_CUSTOMER_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 36 项 `COVERED` 能力**（`SALES_CUSTOMER_CAPABILITY_FREEZE`，CAP-1～CAP-36） |
| 能力判定 | CAP-1～CAP-36 共 **36 项**：`COVERED` **36**、`PARTIAL` **0**、`MISSING` **0**、`OUT_OF_SCOPE` **0**（整改前为 31 / 3 / 2） |
| D-2～D-5 开放设计决策 | **已裁定**：全部按 Design §37.54.17 推荐值实施（2026-11-13）。四项均为 Requirement 允许范围内的 Design 决策，不改动 Requirement、不重开 Requirement |
| 真实 MySQL 证据 | **已取证**：本域专属 campaign `SALES_CUSTOMER_MYSQL_V1` 在真实 MySQL 8.0.37 上 **PASS**，`ACK-4 STATE = FINISHED`，清理由 root 的独立 post-flight 证明 |
| 冻结不包含 | Manual Closure（B3102 销售管理 / B3103 信用管理）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance |

决定来源是当前对话中所有者的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：整改轮与收尾轮后的本域 Active Contract（Requirement §34 / Wave 11 修订节 / Design §29、§36、§37.54）及其 36 项 `COVERED` 能力的实现、schema、测试与证据。

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| `pnpm test:fast` | **638/638 PASS** |
| `pnpm test`（FULL） | **3885/3885 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | **PASS** |
| 域级合同套件 `server/sales-customer-reservation-reaction.test.js` | **13/13 PASS**（SC32 订单侧预留态同步、SC68 五个反应路径、已执行历史不被改写、回滚零部分状态） |
| 域能力套件 `server/sales-customer-reporting-closure.test.js` | **32/32 PASS**（SC78 六类单据执行证据、SC80 毛利、SC81 四维度排行） |
| 域能力套件 `server/sales-customer-parameters-closure.test.js` | **20/20 PASS**（SC01 三个控制开关的执行面与 operator 工作面） |
| 信用评估套件 `server/sales-customer-wave11-b-evaluation.test.js` | **14/14 PASS**（W11-B 配置版本化、整数评分算术、评分表全生命周期、W11-C 单一评级写者与应用） |
| 信用对账套件 `server/sales-customer-wave11-d-reconciliation.test.js` | **26/26 PASS**（SC99 一致性判定、SC100 确定性重算、三态重放语义、只追加历史） |
| MySQL 类型契约守卫 `server/sales-customer-wave11-mysql-type-contract.test.js` | **4/4 PASS**（钉住映射 == 快照引导产物 == 手写 MySQL DDL；被索引文本列不得为 LONGTEXT；延迟外键唯一） |
| 既有信用套件（回归） | wave9 **21/21**、wave10 **75/75**、wave10 acceptance **11/11**、W11-A 查询 **38/38**、W11-A 搜索语义 **40/40**、W11-SEC **14/14** —— 全绿且**未修改任何既有断言** |
| 既有销售套件（回归） | Wave 7 functional + acceptance + Batch A 合计 **118/118 PASS** |
| 浏览器 · 域级响应式 `scripts/acceptance/sales-customer-domain-responsive-uat.mjs` | **88/88 PASS**（22 个界面 × 4 档宽度 = 88）；两次变异实验证明非空洞 |
| 文档一致性 | `current` 模式 N1、N3～N6、N8、N9 PASS、N2 `RETIRED`、**N7 FAIL**（既有历史提交的追溯债务，与本域无关）；`migration` 模式 C1～C6 全 PASS |
| 跨域错误码耦合守卫 `node scripts/qa/verify-error-code-coupling.mjs` | **PASS**：已登记 2 / 未登记 0 / 死引用 0 |
| 历史验收记录守卫 `node scripts/qa/verify-acceptance-records.mjs` | **PASS**：76 份记录，悬空指针 0 / 未登记漂移 0 |

### 2.1 真实 MySQL 8.0.37 证据（本域专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `SALES_CUSTOMER_MYSQL_V1`（`RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_SALES_CUSTOMER_RACES` → `CLEANUP_SCHEMA_POST_RUN`） |
| 通过运行 | run `c738ecc6-6193-40d3-9517-29211a4b6099`、commit `aa075921839de4ce1b5aa0a1ca4d3b24800333c2` |
| 结果 | `RESULT = PASS`；`ACK-4 STATE = FINISHED`（清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明） |
| 独立只读复核 | 目标 `modern_erp_domain_test@127.0.0.1:3306/modern_erp_domain_test` → `tables=0 views=0 triggers=0 routines=0 events=0`；serverUuid `256c7a4e-d275-11f1-885b-b025aa71d167`、grants sha256 `bef61617…807e`、MySQL 8.0.37 |
| 竞态套件 | **7/7 PASS**：SC-RACE-01 受控订单变更 CAS 只赢一次；SC-RACE-02 报价转单不超容量；SC-RACE-03 出货确认只产生一次库存移动与 COGS 凭证；SC-RACE-04 信用检查每检查组一次决策；SC-RACE-05 评分表终评每表一条聚合结果；SC-RACE-06 预留授权只授权一次（实测 GRANT 审计 1 条）；SC-RACE-07 订单终态只释放一次预留。每项配一个**未争用负对照** |
| 争用证据 | 每个竞态都由 `performance_schema.data_lock_waits` 的真实等待图与服务器上报的会话状态共同证明「确实被阻塞」，并由**文件闸门 + L0 协调闸门**双重屏障保证两个竞争者同时进入被争用代码路径 |

### 2.2 失败运行（如实登记）

本域 campaign 共运行 **9 次**，前 8 次均失败。**每一次失败都是真实缺陷或真实夹具缺陷被 campaign 暴露**，逐条登记如下（ACK-4 capability 每次失败运行都会被消耗，重试需要新的 RunId 与新的 15 分钟窗口）：

| 次数 | run | 根因 | 性质 |
|---|---|---|---|
| 1 | `1b504a91-fc50-4983-9f27-8f6baf4ded27` | `credit_evaluation_result.profile_effective_state_hash physical type drifted` | **真实缺陷**：迁移的 MySQL 物理类型声明与 SQLite 快照引导这条权威路径各自维护一份副本，漂移只在真实 MySQL 上可见 |
| 2 | `8ca9260a-25ef-4d02-a35a-72b74cb44c64` | `credit_recalculation_history.business_date physical type drifted` | 同上缺陷的第二个实例（第三份副本：断言列表） |
| 3 | `3158fbb5-8692-4b2f-a435-da00c20fb89d` | `credit_profile_ratings foreign key set drifted` | **真实缺陷**：快照生成的 MySQL DDL 不带外键约束名，迁移按名查找落空后重复创建，同一列出现两条外键 |
| 4 | `6f86a677-2a8b-4f28-b86a-7f02038c448d` | `ER_DUP_ENTRY`（夹具） | **夹具缺陷**：campaign 引导时 demo seed 开启，留下的 `user-admin` 与套件自己的管理员身份冲突 |
| 5 | `c057368f-3048-49df-a418-ee23aeacbd97` | 两条竞态的「确实发生争用」证据不成立 | **证据缺陷**：口径要求两个竞争者都停在 L0 闸门，而真实争用还有「一方阻塞在另一方身上」的形态 |
| 6 | `42250cc8-d3d3-4c56-999b-4b8470eb6614` | 同上 | 同上 |
| 7 | `1b504a91` 之后的第 7 次（`174774e8-b94e-4fa3-a797-122793cdd5ab`） | 同上 | 同上 |
| 8 | `f697b6d6-4166-40a6-980f-6a43a959afbf` | SC-RACE-04 与 SC-RACE-07 的结果为 `[200, 200]` | **夹具缺陷**：两个竞争者共用同一个幂等键，第二个直接重放了第一个的结果，根本没有进入被争用的代码路径 |

第 1～3 次暴露的是**真实产品缺陷**，已修复并加装离线守卫（`server/sales-customer-wave11-mysql-type-contract.test.js`），使同类漂移此后在 SQLite 上即可被捕获，不必再消耗 capability。第 4～8 次暴露的是**夹具与证据缺陷**，已修复在竞态套件与 campaign 基础设施内。

### 2.3 浏览器证据的去空洞过程

域级浏览器门禁在建立过程中暴露并修复了三类**门禁自身**缺陷；**生产代码零改动**：

| 事实 | 处置 |
|---|---|
| 门禁的 44px 判定沿用了库存域的 `height < 44 && width < 44` 写法 —— 一个 30×44 的目标可以通过 | 改为 `||`；变异实验证明：改回 `&&` 时门禁保持绿色，改为 `||` 后 88/88 全部失败并点名该目标 |
| 夹具种入了 `UAT_CREDIT_MANAGEMENT_ENABLED`，而生产读取的是 `CREDIT_MANAGEMENT_ENABLED` —— 信用检查恒返回 `CREDIT_MANAGEMENT_DISABLED` 且不落任何证据，信用检查 / 信用特别审批两个界面永远是空的 | 改种规范参数码，并补齐真实的信用证据（6 条检查结果 + 1 条特别审批），两个界面渲染出真实数据 |
| `credit-evaluation` 页面用 `.mini-card` 同时承载空态，门的行数统计把空态当成数据行 | 空态按 `aria-label^="empty-"` 排除；该界面的**显式空态**在结果中逐界面如实登记（评分世界需要受限评分人流程，本门禁不建立） |

**非空洞证明（变异实验，两次，均已还原）**：
① 移除 `src/pages/sales-parameters.jsx` 的 `data-testid` → 门禁在该界面 4/4 失败并报「规范 data-testid 未绘制」，而行数检查本身仍会通过 —— 证明真正承重的是**界面确实渲染**这一条；
② 把 `.mobile-header__back` 缩到 30px → 旧写法下门禁保持绿色，新写法下 88/88 失败并报「1 个已绘制可点目标低于 44px」。

## 3. 冻结合同的显式 Supersession

**十二处**既有冻结合同的断言被**显式收窄**（无一处被删除），逐条留痕于
[`docs/audits/sales-customer-capability-audit-20261113.md`](../audits/sales-customer-capability-audit-20261113.md) §7：
Wave 9 / Wave 10 的「Wave 11 表不存在」断言收窄为隔离迁移证明（`SC-SUP-01` / `SC-SUP-04`）；
Wave 9 的评级历史不可改写断言收窄为「仅允许 `superseded_at` 迁移」（`SC-SUP-02`）；
Wave 9 迁移的外键集合断言容忍**恰好一条**具名新增外键（`SC-SUP-03`）；
P8 的 `REPORT_TABS` 计数改为精确集合相等（`SC-SUP-05`）；
11 处路由计数契约随新增 6 条 contextual route 更新（`SC-SUP-07`）；
D10 走查 manifest 与 P8 路由总数同步更新（`SC-SUP-08` / `SC-SUP-09`）；
冻结 V1.6 矩阵的 `laterRoutes` / `matrixWhitelist` 纳入 6 条 Sales 域路由（`SC-SUP-10`）；
P7 的 `useReport` 字面断言收窄为请求合同语义（`SC-SUP-11`）；
wave0 migration runner 的「Wave 11 表不存在」断言收窄为隔离迁移证明（`SC-SUP-12`）。

此外，W11-A 原语的 T5 冻结指纹按 Design §37.54.11.2 的**预告**重新钉住：八个历史链接全部保持不变且互不相同，新增第九环成为当前源证明（`SC-SUP-06`）。

## 4. 随冻结接受的残余

| 编号 | 残余 |
|---|---|
| `SC-RES-01` | CAP-15 / CAP-17（销售出库、销售退货）的核心逻辑仍**内联在 `server/app.js`**，未收敛到 `server/modules/`。本轮已把**预留反应**接到该路径上，但出库与退货本身的 canonical owner 收敛属独立的结构变更 |
| `SC-RES-02` | 逐列 schema parity 未单独取证；schema / migration 对等由本域专属 campaign 的全量 bootstrap 证明 |
| `SC-RES-03` | SC01 `deliveryScheduleEnabled` 的执行面取**交货计划（行级计划日期偏离订单头承诺）**，不取订单头字段 —— 订单头 `requested_delivery_date` 的必填性由 SC34 管辖，字面解释会让开关关闭时所有订单都无法提交。判断与理由登记于审计台账 §6.3 `SC-JUDGE-01` |
| `SC-RES-04` | SO 变更时的预留反应取**释放**而非**自动重算** —— Requirement §34.3.13 允许二者之一；自动重算会使商业订单变更因 Planning 分配能力不足而失败，属对已签发 Wave 6 / Wave 7 受控变更路径的行为改变。差额由既有 SC66 显式请求路径重新申请。判断与理由登记于审计台账 §6.3 `SC-JUDGE-03` |
| `SC-RES-05` | `factDigest` 的数值归一对**超安全整数范围**的遗留 AR 金额保留原文而非 `Number(...)` —— 否则两个不同的遗留金额会碰撞成同一摘要并破坏 R100-2。判断与理由登记于审计台账 §6.3 `SC-JUDGE-04` |
| `SC-RES-06` | `W11_A_ACCEPTANCE_PASS`（W11-A 整包 Acceptance）仍未签发 —— 单元级冻结已各自签发，整包签发是业务所有者的**独立**决定，不是单元冻结的自动汇总 |
| `SC-RES-07` | N7 文档追溯债务（四个既有历史提交，与本域能力无关） |
| `SC-RES-08` | CAP-15 / CAP-16 的 OQC 适配与财务确认属 `INTEGRATION_BACKED`（SC51 / SC58 / SC71），由冻结域的 canonical adapter 提供，本域只 consume / delegate |
| `SC-RES-09` | 竞态套件的「确实发生争用」证据依赖真实等待图的采样窗口（5ms 轮询）。当前 7/7 竞态全部被观测到，但该采样本质上是概率性的 |

## 5. 未发生事项

- 未签发 Manual Closure（B3102 销售管理 / B3103 信用管理）、Release Readiness、发布或部署的任何 token。
- 未执行真实环境 migration、业务数据库写入、push / merge / tag / 发布 / 部署。
- 未撤销或改写任何已签发的验收记录或 token。
- 未伪造任何真实 MySQL 运行记录：§2.2 登记的 8 次失败运行与 1 次通过运行均为真实发生。
