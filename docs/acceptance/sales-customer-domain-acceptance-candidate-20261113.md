# Sales & Customer 销售与客户域级 Acceptance 候签材料（2026-11-13）

> **用途**：登记业务所有者对 Sales & Customer 域**整域 Acceptance** 与 **Capability Freeze** 的候签材料、证据、冻结边界与未关闭事项。
>
> **Owner**：Sales & Customer Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`PENDING_APPROVAL` —— 候签材料已产出，等待业务所有者裁定与真实 MySQL 取证。
>
> **权威来源**：Requirement [`docs/requirements/sales-customer/01-domain-closure.md`](../requirements/sales-customer/01-domain-closure.md) §34.2～§34.14 与 [`05-wave-11-amendments.md`](../requirements/sales-customer/05-wave-11-amendments.md)；Design [`docs/design/sales-customer/`](../design/sales-customer/) §29 / §36 / §37.54；逐项判定 [`docs/audits/sales-customer-capability-audit-20261113.md`](../audits/sales-customer-capability-audit-20261113.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收证据候选，不取代 Requirement、Design 或唯一项目状态登记表；其存在不等于 Git 提交、远端同步、发布或部署。

## 1. 待裁定事项

| 项 | 候签建议 |
|---|---|
| 域级 Acceptance | 建议**通过**（`SALES_CUSTOMER_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | 建议**冻结 36 项 `COVERED` 能力**（`SALES_CUSTOMER_CAPABILITY_FREEZE`，CAP-1～CAP-36） |
| 能力判定 | CAP-1～CAP-36 共 **36 项**：`COVERED` **36**、`PARTIAL` **0**、`MISSING` **0**、`OUT_OF_SCOPE` **0**（整改前为 31 / 3 / 2） |
| D-2～D-5 开放设计决策 | **已裁定**：全部按 Design §37.54.17 推荐值实施（2026-11-13 所有者裁定，见 [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md) §2） |
| 真实 MySQL 证据 | **待取证**：本域专属 campaign `SALES_CUSTOMER_MYSQL_V1` 的基础设施已建成并离线校验通过，但**尚未在真实 MySQL 上运行** —— ACK-4 capability 只能由业务所有者用受保护 launcher 一次性签发。详见 §2.3 |
| 冻结不包含 | Manual Closure（B3102 销售管理 / B3103 信用管理）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance |

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| `pnpm test:fast` | **638/638 PASS** |
| `pnpm test`（FULL） | **3881/3881 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | **PASS** |
| 域级合同套件 `server/sales-customer-reservation-reaction.test.js`（本轮新增） | **13/13 PASS**（SC32 订单侧预留态同步、SC68 五个反应路径、已执行历史不被改写、回滚零部分状态） |
| 域能力套件 `server/sales-customer-reporting-closure.test.js`（本轮新增） | **32/32 PASS**（SC78 六类单据执行证据、SC80 毛利、SC81 四维度排行） |
| 域能力套件 `server/sales-customer-parameters-closure.test.js`（本轮新增） | **20/20 PASS**（SC01 三个控制开关的执行面与 operator 工作面） |
| 信用评估套件 `server/sales-customer-wave11-b-evaluation.test.js`（本轮新增） | **14/14 PASS**（W11-B 配置版本化、整数评分算术、评分表全生命周期、W11-C 单一评级写者与应用） |
| 信用对账套件 `server/sales-customer-wave11-d-reconciliation.test.js`（本轮新增） | **26/26 PASS**（SC99 一致性判定、SC100 确定性重算、三态重放语义、只追加历史） |
| 既有信用套件（回归） | wave9 **21/21**、wave10 **75/75**、wave10 acceptance **11/11**、W11-A 查询 **38/38**、W11-A 搜索语义 **40/40**、W11-SEC **14/14** —— 全绿且**未修改任何既有断言** |
| 既有销售套件（回归） | Wave 7 functional + acceptance + Batch A 合计 **118/118 PASS** |
| 浏览器 · 域级响应式 `scripts/acceptance/sales-customer-domain-responsive-uat.mjs` | **88/88 PASS**（22 个界面 × 4 档宽度 = 88）；两次变异实验证明非空洞 |
| 文档一致性 | `current` 模式 N1、N3～N6、N8、N9 PASS、N2 `RETIRED`、**N7 FAIL**（既有历史提交的追溯债务，与本域无关）；`migration` 模式 C1～C6 全 PASS |

### 2.1 本轮整改轮闭合的能力

| 能力 | 整改前 | 闭合方式 |
|---|---|---|
| CAP-1 | PARTIAL | SC01 的 `deliveryScheduleEnabled` / `deliveryQuantityControlEnabled` / `reservationBehavior` 三个控制开关接入生产消费方；补齐销售参数 / 销售组成员关系 / 可销范围规则 / 产品商业分类 / 价格覆盖授权五个 operator 工作面并注册为 contextual route |
| CAP-24 | PARTIAL | `sales_orders.reservation_intent_state` 接入真实生命周期；SC68 五个反应路径全部接线（SO 变更 / 取消 / 受控关闭 / 退货 / 补发），并补齐 Design §29.17.2 要求的 Delivery → consume 已交付部分 |
| CAP-27 | PARTIAL | SC80 销售毛利、SC81 四维度销售排行落地；SC78 由 3 类单据补齐到 Requirement 声明的 6 类 |
| CAP-34 | MISSING | W11-D 信用对账与重算：`credit_recalculation_history` 表、`factDigest`、`POST /api/credit/reconciliation/check`（SC99）与 `/recalculate`（SC100） |
| CAP-36 | MISSING | W11-B 信用评估基础四表 + W11-C 聚合结果表 + `applyCreditRating` 单一评级写者 + 评分表全生命周期 + `credit-evaluation` 工作面 |

### 2.2 本轮修复的真实缺陷

| 编号 | 事实 | 处置 |
|---|---|---|
| `SC-DEF-01` | SC01 三个控制开关只被持久化与解析，无生产消费方 | 三个开关全部接入生产消费方；控制为**非空洞**，有正反例断言 |
| `SC-DEF-02` | `sales_orders.reservation_intent_state` 只在 INSERT 写默认值，全仓无 UPDATE | 新增 `syncOrderReservationIntentState`，在预留意图的每个状态迁移事务内同步 |
| `SC-DEF-03` | `adjustReservationIntentOnChange` 与 `releaseReservationIntentsForOrder` 是零调用方死代码 | 两个导出全部接线；并补齐 Design 要求的 Delivery → consume 路径 |
| `SC-DEF-04` | SC80 销售毛利零实现 | 新增 `sales-reporting-gross-profit.js`，成本侧消费 canonical `inventory_valuation_movements`，**无第二套估值引擎、无影子台账、无新表** |
| `SC-DEF-05` | SC81 销售排行零实现 | 与 SC80 共用同一 canonical 事实投影，四维度排序 |
| `SC-DEF-06` | SC78 只覆盖 6 类单据中的 3 类 | 补齐 Quotation / Delivery Notice / Replacement |
| `SC-DEF-07` | SC19 价格覆盖授权后端存在、前端无签发入口 | 新增价格覆盖授权工作面，订单编辑器可直接使用新取得的授权 id |
| `SC-DEF-08` | SC01 / SC06 / SC07 / SC19 无 operator 前端工作面 | 五个 contextual route 落地 |
| `SC-DEF-09` | CAP-15 / CAP-17 核心逻辑内联在 `server/app.js` | **未在本轮处理** —— 属独立的模块归属收敛，见 §4 残余 `SC-RES-01` |
| `SC-DEF-10` | 销售域无专属真实 MySQL ACK-4 campaign | 已建立 `SALES_CUSTOMER_MYSQL_V1` campaign 基础设施；**真实运行待所有者签发 capability**，见 §2.3 |
| `SC-DEF-11`（新发现） | `grantReservationIntent` / `consumeReservationIntent` / `releaseReservationIntent` 在事务外读 `intent_state`，UPDATE 不带状态 CAS —— 两个并发授权都会观察到 `REQUESTED` 并都提交 `GRANTED`，状态机不是承重件 | 三条路径全部改为：事务内 `FOR UPDATE` 复读 + UPDATE 携带期望状态（consume 另携带期望已消费数量）作 compare-and-set；锁序统一为「意图行 → canonical 对象」，与批量释放路径一致 |
| `SC-DEF-12`（新发现） | 整改初稿把订单行的**文档单位**数量与预留意图的**基本单位**数量直接比较 | 统一经订单行的 `base_quantity_num / base_quantity_den` 基本单位快照换算；已执行量同样按基本单位累计 |

### 2.3 真实 MySQL 8 证据边界（本域专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `SALES_CUSTOMER_MYSQL_V1`（`RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_SALES_CUSTOMER_RACES` → `CLEANUP_SCHEMA_POST_RUN`） |
| 基础设施 | `scripts/gates/mysql-sales-customer-{root-lifecycle,child,gate}.mjs` + `scripts/gates/sales-customer-domain-races-worker.mjs` + `server/mysql-sales-customer-domain-races.integration.js` + `scripts/gates/ack4/ack4-runtime.mjs` 的 manifest + launcher `$ApprovedCampaigns` 条目 + `package.json` 的 `test:mysql:sales-customer` |
| 竞态用例 | **7 项**（SC-RACE-01..07）：受控 SO 变更 CAS 只赢一次、报价转单不超容量、出货确认只产生一次库存移动与 COGS 凭证、信用检查每检查组一次决策、评分表终评每表一条聚合结果、预留授权只授权一次、订单终态只释放一次预留。每项配一个**未争用负对照** |
| 离线校验 | **7/7 PASS**，连续三次稳定；campaign 模式在 SQLite 上**显式拒绝**（dialect 错误），不会产出非 MySQL 证据 |
| **真实 MySQL 运行** | **尚未执行** —— ACK-4 capability 只能由业务所有者用受保护 launcher 一次性签发（`scripts/gates/issue-mysql-ack4.ps1` 是机械签名器，批准来自人）。每次失败运行都会**消耗** capability，重试需要新的 RunId 与新的 15 分钟窗口 |
| **按 `MYSQL-EV-01` 口径** | schema / migration 对等：由 `test:mysql:accounting-analytics` 的全量 bootstrap 覆盖（它运行全部当前迁移集），**Sales 域的表也在其中**；**行为等价在真实 MySQL 上未单独取证**，在 campaign 实际运行前必须作为显式残余登记 |

**待所有者执行的两步**（campaign 拒绝脏工作树，因此必须先提交）：

```bash
# 1) 提交本轮改动后签发 capability（批准内容来自业务所有者）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/issue-mysql-ack4.ps1 ...
# 2) 运行
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 \
  -Script test:mysql:sales-customer -RunId <uuid> -Ack4Capability <path>
```

## 3. 冻结合同的显式 Supersession

**十二处**既有冻结合同的断言被**显式收窄**（无一处被删除），逐条留痕于
[`docs/audits/sales-customer-capability-audit-20261113.md`](../audits/sales-customer-capability-audit-20261113.md) §7：

| 编号 | 被收窄的断言 | 收窄后的形态 |
|---|---|---|
| `SC-SUP-01` | wave9 测试：六个 Wave 11 表必须不存在 | 在移除全部 Wave 11 表的隔离库上单独运行 Wave 9 迁移，再断言 Wave 11 表仍不存在 |
| `SC-SUP-02` | wave9 测试：任何模块不得 `UPDATE credit_profile_ratings` | 只允许唯一的 `superseded_at` 迁移；`rating_grade` / `applied_at` / `applied_by` / `evaluation_result_id` 仍禁止出现在任何 UPDATE 中 |
| `SC-SUP-03` | wave9 迁移：`credit_profile_ratings` 外键集合漂移即 fail closed | 容忍**恰好一条**具名新增外键 `fk_credit_profile_ratings_evaluation_result`；任何其他新增外键仍 fail closed |
| `SC-SUP-04` | wave10 测试：Wave 11 表必须不存在 | 在移除全部 Wave 11 表的隔离库上单独运行 Wave 10 迁移，再断言 Wave 11 表仍不存在 |
| `SC-SUP-05` | P8 测试：`REPORT_TABS` 恰好 5 项 | 对 7 项规范键的**精确集合相等**断言 |
| `SC-SUP-06` | W11-A 原语 T5：当前 `credit-check.js` 源必须等于逾期证据前瞻链的冻结摘要 | 八个历史链接**全部保持不变且互不相同**；新增第九环 `W11_D_FACT_DIGEST_CREDIT_CHECK_SHA256` 成为当前源证明 |
| `SC-SUP-07` | 11 处路由计数契约（79 / 83） | 计数更新为 **85 / 89**，每处注释写明新增的 6 条 contextual route 来源 |
| `SC-SUP-08` | D10 routes visit manifest 79 条全部 PASS | manifest 由注册表派生，计数随注册表更新为 **85** |
| `SC-SUP-09` | P8 启用 + 停用路由总数 83 | 总数更新为 **89**（85 + 4） |
| `SC-SUP-10` | V1.6 冻结矩阵必须精确覆盖每条启用路由一次 | 6 条 Sales 域路由进入 `laterRoutes` 与 `matrixWhitelist`（携带自己的域级验收证据，不重写冻结矩阵） |
| `SC-SUP-11` | P7：`useReport` 必须以 `api(endpoint` 调用 | 断言改为**语义**形态：hook 内 `api(` 调用**恰好一次**、用 `URLSearchParams` 合并、`params.set` 替换重复键 |
| `SC-SUP-12` | wave0 migration runner：Wave 11 表必须不存在 | 新增隔离用例：在移除全部 Wave 11 表的临时库上只重放 pre-Wave-11 迁移集，断言 Wave 11 表仍不存在 |

## 4. 随冻结接受的残余

| 编号 | 残余 |
|---|---|
| `SC-RES-01` | CAP-15 / CAP-17（销售出库、销售退货）的核心逻辑仍**内联在 `server/app.js`**（约 6610–6935 行），未收敛到 `server/modules/`。本轮已把**预留反应**接到该路径上，但出库与退货本身的 canonical owner 收敛属独立的结构变更 |
| `SC-RES-02` | 真实 MySQL 上的**行为等价**在 campaign 实际运行前未被单独取证（schema 对等已由 AA campaign 的全量 bootstrap 覆盖） |
| `SC-RES-03` | SC01 `deliveryScheduleEnabled` 的执行面取**交货计划（行级计划日期偏离订单头承诺）**，不取订单头字段 —— 订单头 `requested_delivery_date` 的必填性由 SC34 管辖，字面解释会让开关关闭时所有订单都无法提交。判断与理由登记于审计台账 §6.3 `SC-JUDGE-01` |
| `SC-RES-04` | SO 变更时的预留反应取**释放**而非**自动重算** —— Requirement §34.3.13 允许二者之一；自动重算会使商业订单变更因 Planning 分配能力不足而失败，属对已签发 Wave 6 / Wave 7 受控变更路径的行为改变。差额由既有 SC66 显式请求路径重新申请。判断与理由登记于审计台账 §6.3 `SC-JUDGE-03` |
| `SC-RES-05` | `factDigest` 的数值归一对**超安全整数范围**的遗留 AR 金额保留原文而非 `Number(...)` —— 否则两个不同的遗留金额会碰撞成同一摘要并破坏 R100-2。判断与理由登记于审计台账 §6.3 `SC-JUDGE-04` |
| `SC-RES-06` | `W11_A_ACCEPTANCE_PASS`（W11-A 整包 Acceptance）仍未签发 —— 单元级冻结已各自签发，整包签发是业务所有者的**独立**决定，不是单元冻结的自动汇总 |
| `SC-RES-07` | N7 文档追溯债务（四个既有历史提交，与本域能力无关） |
| `SC-RES-08` | CAP-15 / CAP-16 的 OQC 适配与财务确认属 `INTEGRATION_BACKED`（SC51 / SC58 / SC71），由冻结域的 canonical adapter 提供，本域只 consume / delegate |

## 5. 未发生事项

- 未签发任何 Acceptance / Freeze token；未签发 Manual Closure（B3102 / B3103）、Release Readiness、发布或部署。
- 未执行真实环境 migration、业务数据库写入、真实 MySQL 运行、push / merge / tag / 发布 / 部署。
- 未撤销或改写任何已签发的验收记录或 token。
