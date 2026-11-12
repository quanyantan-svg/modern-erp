# Manufacturing & Quality 制造与质量域级 Acceptance 与 Capability Freeze 记录（2026-11-12）

> **用途**：登记业务所有者对 Manufacturing & Quality 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Manufacturing & Quality Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；**37 项 `COVERED` 能力已冻结**。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/manufacturing-quality.md`](../requirements/manufacturing-quality.md) §29.1～§29.10；Design [`docs/design/manufacturing-quality.md`](../design/manufacturing-quality.md) §24；逐项判定 [`docs/audits/manufacturing-quality-capability-audit-20261112.md`](../audits/manufacturing-quality-capability-audit-20261112.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
MANUFACTURING_QUALITY_DOMAIN_ACCEPTANCE_PASS
MANUFACTURING_QUALITY_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在本轮对话中指示「现在完成剩下几个业务域的收尾工作」「最终目标是该 mobile erp 系统各业务域的 acceptance 完成整个项目验收」，并就真实 MySQL 证据口径裁定「逐域新建专属 campaign」。据此：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`MANUFACTURING_QUALITY_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 37 项 `COVERED` 能力**（`MANUFACTURING_QUALITY_CAPABILITY_FREEZE`） |
| 能力判定 | MQ-01～MQ-43 共 **43 项**：`COVERED` **37**、`PARTIAL` **1**（MQ-43 Dispatch）、`OUT_OF_SCOPE` **5**、`MISSING` **0**（整改前为 22 / 15 / 5 / 1） |
| `MQ-DEC-01`（MQ-43 Dispatch 的范围归属） | **未裁定，登记为显式残余**：该项只出现在 `document.md §21` 的领域级缺口概览，**不在 §22.19 的 B3119 目标能力基线内**，也不在 Requirement §29.4 的目标闭环表内。按 §4.1 的判定纪律，本轮**既不静默实现，也不静默丢弃**，作为随冻结接受的范围问题登记 |
| `MQ-DEC-02`（真实 MySQL 行为等价未单独取证） | **已解决**：按所有者裁定建立专属 ACK-4 campaign `MANUFACTURING_QUALITY_MYSQL_V1` 并在真实 MySQL 8.0.37 上取得 `RESULT = PASS` / `ACK-4 STATE = FINISHED`，竞态套件 4/4 PASS（§2.2） |
| `MQ-DEC-03`（N7 文档追溯债务） | **不解决**：四个**已推送**历史提交的 message 缺少变更章节引用；消除需改写已发布 Git 历史，本轮不授权。与本域能力无关，**作为显式残余随冻结接受** |
| 实现锚点 | `eceadc5`（MQ-RACE-02 断言改写，其后为 campaign 通过的提交）；域能力整改见 `979fe63`；浏览器去空洞与移动端修复见 `af47f0d` |

决定来源是当前对话中所有者的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：整改轮后的本域 Active Contract（Requirement §29 / Design §24）及其 37 项 `COVERED` 能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3119 手册级关闭）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance。

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS**（连续三次通过；期间一次瞬时失败，复跑未复现，已如实登记） |
| `pnpm test`（FULL） | **3749/3749 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 整改轮新增合同套件 `server/v23-manufacturing-quality-closure.test.js` | **9/9 PASS**（含全部负例） |
| 浏览器 · 响应式（7 路由 × 320/390/430/680） | **28/28 PASS** |
| 浏览器 · 最终验收（7 路由 + 2 详情面 × 四档宽度） | **36/36 PASS**（含真实质量门禁正反例） |
| 非空洞证明（变异实验） | 按钮强制 20px → 28/28 FAIL 并指名选择器与实测尺寸；清空渲染记录 → 每个界面 FAIL 并指名缺失标识符 |
| 治理守卫（跨域错误码耦合 / 验收记录有效性） | 双 PASS |
| 文档一致性 | `current` N1、N3～N6、N8、N9 PASS，N2 `RETIRED`，**N7 FAIL**（既有历史提交的追溯债务，与本域无关）；`migration` C1～C6 全 PASS |

### 2.1 真实 MySQL 8.0.37 证据（本域专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `MANUFACTURING_QUALITY_MYSQL_V1`（`RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_MANUFACTURING_QUALITY_RACES` → `CLEANUP_SCHEMA_POST_RUN`） |
| Run | `210f31c4-f76f-45f1-a90a-2d909846ed1a` |
| Commit | `eceadc5` |
| 结果 | `RESULT = PASS`；`ACK-4 STATE = FINISHED`（清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明；只读复核 `tables=0 views=0`） |
| 目标 | `modern_erp_domain_test` @ `127.0.0.1:3306`；server uuid `256c7a4e-d275-11f1-885b-b025aa71d167`；grants sha256 `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e`；MySQL 8.0.37 |
| 竞态套件 | `server/mysql-manufacturing-quality-concurrency.integration.js` **4/4 PASS** |

**覆盖什么**

- `BOOTSTRAP_CURRENT_SCHEMA`：本域全部 schema（既有 15 张表 + 本轮新增 `production_operation_transfers` + 工序状态 `OUTSOURCED` 与三个委外交接列 + 检验类型词表与抽样/放行列 + `inspection_plans.qcp_id` + 用料清单受控编辑列 + 收货放行来源列）在真实 MySQL 8 上被接受并成功 bootstrap；
- `RUN_MANUFACTURING_QUALITY_RACES`：
  - **MQ-RACE-01** 并发双审核同一用料清单 → 恰好一个 `200`、一个 `409`；清单终态 `APPROVED`；`APPROVE` 审计恰好 1 条；
  - **MQ-RACE-02** 并发受控编辑与审核 → 终态必须 `APPROVED`，审核之后不得再出现 `CONTROL_EDIT` 审计，物料行取值必须与「受控编辑是否提交」一致（撕裂状态即失败）；
  - **MQ-RACE-03** 并发双委外交接 → 恰好一个 `200`、一个 `409`；工序终态 `OUTSOURCED`；`OUTSOURCE_HANDOFF` 审计恰好 1 条；
  - **MQ-RACE-04** 并发双工序转移 → 转移总量不得超过源工序已释放数量。

**不覆盖什么**

- 真实 MySQL 上的**逐列** schema parity 比对（本域表不在任何 campaign 的列级 parity 清单内）；
- 两个**不同** ECO / 检验单并发作用于同一来源单据时的幂等与唯一性；
- 真实 MySQL 上的生产吞吐、长稳与并发连接数。

### 2.2 专属 campaign 的失败运行登记

本域专属 campaign 在取得 `PASS` 之前共有 **6 次失败运行**，全部如实登记：

| 轮次 | Run | 失败原因 | 性质 |
|---|---|---|---|
| 1 | `8636a783-…`（M&E 域） | 竞态套件的 worker 退出监听竞态导致永久挂起 | 测试装置 |
| 2–6 | `0fe29c2d…` / `071b9b22…` / `83946dfe…` / `9797e56a…` / `698cf15c…`（MQ 域） | 参数顺序、重复主键、外键指向不存在的工单、演示种子用户依赖、模板插值、插入值数 | 测试装置 |
| 7 | `9797e56a…` 之后 | MQ-RACE-02 断言假定「审核必胜」，强于真实不变量 | **断言过强**（生产行为本身无缺陷） |

每一次失败运行的 ACK-4 终态均为 `FAILED`，cleanup 均由 Root 的独立 post-flight 证明，disposable 目标均经只读复核确认为空。**没有一次失败被隐藏或改写为通过。**

## 3. 本次验收同时确认的事实

- 本域的**强制执行点**已在服务端落地：拓扑与委外边界在报工草稿创建、报工确认、工序完工三个写入口同时 fail closed；委外交接是委外工序唯一的合法离开路径；用料清单的受控编辑 / 审核 / 下达以 compare-and-swap 守卫并发；工序转移以源工序行锁守卫已释放数量。
- 上述收紧**未改变**任何 API 的请求 / 响应字段，也未改变已签发域的行为。
- 本域 43 项能力中无 `MISSING`；唯一 `PARTIAL` 是 MQ-43 Dispatch，其残余是**范围归属问题**而非实现缺口。

## 4. 冻结内容与解冻条件

- 冻结对象：Requirement §29 / Design §24 的当前正文，以及 37 项 `COVERED` 能力的实现、schema、测试与证据。
- 冻结期间对上述对象的任何修改，必须先走 Requirement / Design 变更并由本域 Owner 确认；不得以「顺手修复」「统一风格」名义在冻结树上直接改写。
- 解冻条件：能力合同或实现语义需要变更；或 §2.1 的残余需要被实际关闭；或 MQ-43 Dispatch 的范围归属被裁定。

## 5. 已知限制（随本次验收一并接受）

| 编号 | 限制 |
|---|---|
| `MQ-RES-01` | 真实 MySQL 上的逐列 schema parity 比对未被单独取证（§2.1「不覆盖什么」） |
| `MQ-RES-02` | 两个不同 ECO / 检验单并发作用于同一来源单据时的幂等与唯一性未被单独取证 |
| `MQ-RES-03` | MQ-43 Dispatch（工序派工）的范围归属未裁定，作为显式范围问题保留 |
| `MQ-RES-04` | 副产品成本分配按 Requirement §29.7 归 Accounting & Analytics 域，本域只维护数量事实 |
| `MQ-RES-05` | N7 文档追溯债务：成因是四个**已推送**历史提交的 message 缺少变更章节引用；消除它需改写已发布 Git 历史，本轮不授权。与本域能力无关。 |

## 6. 本记录**不**主张的内容

- 不主张真实 MySQL 上的逐列 schema parity 已证明；
- 不主张两个不同 ECO / 检验单并发作用于同一来源单据时的幂等已被证明；
- 不主张 MQ-43 Dispatch（工序派工）已实现；
- 不主张副产品成本分配已在本域实现；
- 不主张 B3119 手册级关闭（Manual Closure）；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张其他 Domain 的 Acceptance 或 Freeze。

## 7. 登记与后续

| 项 | 位置 |
|---|---|
| 逐项能力台账 | [`docs/audits/manufacturing-quality-capability-audit-20261112.md`](../audits/manufacturing-quality-capability-audit-20261112.md) |
| 能力矩阵 | [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md) B3119 行 |
| 项目状态登记表 | [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §58 |
| 当日日志 | [`log/2026-11-12.md`](../../log/2026-11-12.md) |

**下一域**：按就绪度顺序继续域 5 —— **Inventory & Warehouse**（INV-01..44）。
