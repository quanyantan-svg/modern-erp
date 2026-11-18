# VMI 结算机制与 `6401` 对账期望侧扩展的 Acceptance 与合同项 Freeze（2026-11-18）

> 用途：把 2026-11-18 交付的「VMI 结算机制」与「`COGS_TO_GL` 期望侧覆盖 VMI 结算成本」
> 两项合同项，连同它们所依赖的三项残余闭合轮次（委外库存异动的总账接线 / 单腿入库异动的
> 入库价值 / 手工凭证守卫的受控科目族扩展与旁路闭合），登记为**当前权威**的验收结论与
> 冻结结论。
> Owner：Procurement & Outsourcing 域（VMI 结算机制）、Accounting & Analytics 域
> （`6401` 对账期望侧）、Inventory & Warehouse 域（单腿入库计值）、Finance Operations 域
> （应付与总账 canonical 原语）；Platform 拥有权限码目录与 route exposure。
> 权威来源：`docs/status/PROJECT_STATUS.md` §82（残余闭合轮次）与 §85（本轮）；
> `docs/requirements/procurement-outsourcing.md` §31.22 / §31.24；
> `docs/design/procurement-outsourcing.md` §26.43 / §26.45；
> `docs/requirements/accounting-analytics.md` §35.13 / §35.14；
> `docs/design/accounting-analytics.md` §31.18 / §31.19；
> 裁定原文：[`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md) §1。
> **本记录不取代**各域既有的域级 Acceptance / Capability Freeze 记录（那些是历史时点记录）；
> 本记录只覆盖本轮**新增或修订的合同项**。
> 状态：`ACCEPTED`（本轮合同项）/ `FROZEN`（本轮合同项）。

## 1. 授权与裁定

业务所有者 2026-11-18 的两次指令构成本轮授权来源：

1. 「我决定还是补齐再交付」——授权闭合 VMI 结算机制，解除 `D-P01` / `D-P02` 对实现层的
   HARD STOP（AGENTS.md §4.0 连续阶段授权：Requirement → Design → Implementation →
   定向验收 → Acceptance / Freeze）；
2. 「保留 `6401` 作为成本科目，把该检查的期望侧扩展为『销售出库成本 + VMI 结算成本』」——
   授权修订 `COGS_TO_GL` 的期望侧口径。

本轮采用的四项业务裁定：

| 裁定 | 内容 | 登记位置 |
|---|---|---|
| `D-P01` = **D-2a** | 消耗直接扣 SUPPLIER 位**单腿**物理 OUT，商业释放 = 实际消耗量；`M1-F-07` 的双扣路径**结构性消失**；调整容差**严格 0**；首期**不开放**部分结算 / 多账单 | `docs/decisions/OPEN-BUSINESS-DECISIONS.md` §1 `D-P01`；Requirement §31.24.2 `VMI-SET-01/02/09/10` |
| `D-P02` = 协议单价 + canonical 账单 | 价格取 **VMI 协议单价**；客户端**一律不得**传金额 / 账单 ID（传入即 400）；账单走 **canonical Supplier Bill**（`supplier_bill_items.commercial_source_type='VMI_SETTLEMENT_LINE'`）；税按 `NO_TAX` 或协议约定；账单日期取消耗日期 | 同上 `D-P02`；Requirement §31.24.2 `VMI-SET-03/04/05/11` |
| 结算账单作废语义 | **待裁定**（见 §5 第 2 项）；本轮**不**擅自决定 | Requirement §35.14.5 第 2 项 |
| 成本确认与应付构成 | **业务所有者已接受**「成本在结算时确认、应付拆成两条性质不同开项」的语义：收货开项（未消耗余量）与结算开项（已消耗已出账）并存 | Design §26.45.9 第 1 / 2 项；`server/vmi-settlement.test.js` 的「结算后的应付构成可观测」用例把它固化为回归锚点 |

**本轮未执行 / 未授权**：Manual Closure（22 本手册）、九域 Release Readiness、Git
push / tag / release。真实 MySQL 的**只读**检查与**经应用 HTTP API** 的业务写入已执行
（见 §4）。

## 2. 被验收并冻结的合同项

| 合同项 | 正文 | 内容 | 冻结 |
|---|---|---|---|
| `VMI-SET-01..18` | Requirement §31.24 / Design §26.45 | VMI 结算机制：D-2a 物理模型、协议单价权威成本、结算期间与重叠守卫、首期期初证据、五组恒等式（容差严格 0）、canonical 账单与分配事实、期间守卫、幂等、读模型、独立权限码与审计、纯加性迁移 | `FROZEN` |
| `VMI-SET-AC-01..10` | Requirement §31.24.4 | 十项可验收条件（含「消耗已发生、结算未出账」的陷阱口径与「不得暴露结算金额字段」） | `ACCEPTED` |
| `AA-COG-01..06` | Requirement §35.14 / Design §31.19 | `6401 主营业务成本` 的对账期望侧覆盖**全部**来源；只计已出账结算账单所覆盖的结算成本；**不得**取 VMI 消耗的价值流水；**不得**放宽差额容忍；唯一实现点；跨域依赖登记 | `FROZEN` |
| `AA-COG-AC-01..06` | Requirement §35.14.4 | 六项可验收条件（含 1 分篡改变异对照与双引擎 SQL 形态守卫） | `ACCEPTED` |
| `PRC-GL-01..13` | Requirement §31.22 / Design §26.43 | 委外库存异动的总账接线（**本轮被依赖**：委外发料是 VMI 与结算链之外的独立总账路径） | `FROZEN`（沿用 §82 轮次） |
| `IW-SLV-01..10` | Requirement §32.18 / Design §27.63 | 单腿入库异动的入库价值（含 VMI 收货入库腿，**本轮结算链依赖**） | `FROZEN`（沿用 §82 轮次） |
| `AA-VAL-05..13` | Requirement §35.13 / Design §31.18 | 手工凭证守卫（`6401` 属受控成本科目族，**本轮结算凭证不被手工凭证守卫误伤**的前提） | `FROZEN`（沿用 §82 轮次） |

**冻结范围与解冻**：本轮冻结上表全部合同项。修改它们须走显式解冻 + Requirement 修订。
三个域既有的域级 Acceptance / Capability Freeze 记录**保持不变**（历史时点记录）。
Manual Closure 与 Release Readiness **未签发**。

## 3. 实现摘要

| 合同项 | 实现落点 |
|---|---|
| `VMI-SET-01..18` | 新增 `server/migrations/v28-vmi-settlement.js`（三张结算表 + `vmi_agreements.unit_price_cents`，纯加性、幂等、SQLite / MySQL 双端、历史数据不回填 0）；新增 `server/modules/vmi-settlement.js`（结算链唯一 canonical owner：协议单价校验、七量聚合、VMI-P/S/E/C/R 五组恒等式、首期期初证据、期间重叠检查、分配事实）；`server/modules/procurement-vmi.js`（收货与消耗金额改为协议单价 × 数量、结算期开 / 闭、账单生成、物权转移接口按 D-2a 退役、汇总读模型新增可结算量）；`server/modules/commercial-golive.js`（`createSupplierBill` 写入 `commercial_source_*` 三元组、`supplierBillRecognitionSources` 增 VMI 分支）；`server/modules/outsourcing-gl-policy.js`（`assertSupplierBillGlPostable` 识别 VMI 来源）；`server/database/mysql-schema.js`（MySQL 列类型 pin，避免被索引的文本列落到 LONGTEXT 而被 InnoDB 拒绝） |
| `AA-COG-01..06` | `server/modules/financial-inventory.js::systemHealth` 的 `COGS_TO_GL` 期望侧新增「已过账结算账单所覆盖的 VMI 结算成本」一项，来源是**分配事实** `vmi_settlement_bill_allocations` → 结算行的 `settled_qty` × `unit_price_cents` |
| 跨域依赖 | Requirement §31.24.6 与 Design §26.45.11 交叉登记了 Accounting & Analytics 域消费 VMI 结算事实的事实与被依赖方的约束 |

**关键取舍（不得在后续文档中被描述为已消除或未发生）**：

1. 期望侧**不**取「VMI 消耗的价值流水」——消耗腿在消耗时即减存货价值，而 `Dr 6401` 的
   成本凭证在结算出账时才记；计入消耗会造成「消耗已发生、结算未出账」窗口的新瞬时失配
   （`AA-COG-03`）。该取舍有独立陷阱用例承重。
2. 期望侧**不**以 `supplier_bills.status='POSTED'` 为过滤条件——结算账单过账在结算事务
   **之后**，且账单作废**不**冲销 `VMI_SETTLEMENT_LINE` 成本凭证（见 §5 第 2 项）；
   以分配事实为连接脊柱可在两种状态下都与总账侧一致。
3. 差额容忍**未放宽**：`COGS_TO_GL` 仍是严格相等判定（差额 ≠ 0 即 FAIL / BLOCKING），
   无阈值、无白名单（`AA-COG-04`）。

## 4. 证据

### 4.1 本机门禁（`master` @ `1bde79c`）

| 门禁 | 结果 |
|---|---|
| `pnpm test:fast` | **775 / 775 PASS**（86 suites） |
| focused 合同套件 | `server/vmi-settlement.test.js` + `server/accounting-cogs-check-vmi-settlement.test.js` = **22 / 22 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| 文档一致性 `current` / `migration` 双模式 | `migration` **ALL CHECKS PASSED**；`current` 除 N7（未提交导致的 Git 历史追溯，见 §6）外全部通过 |
| 错误码耦合守卫 `node scripts/qa/verify-error-code-coupling.mjs` | PASS（已登记 2 / 未登记 0 / 死引用 0） |
| 变异对照 | ① 期望侧误取「VMI 消耗的价值流水」→ 5 例**全部转红**；② 完全去掉 VMI 结算项（修订前行为）→ 3 例转红（含 `AA-COG-AC-01`）；断言承重已证明 |

**`pnpm test`（FULL）的已知失败**：当前 FULL 有 **15 项失败**，全部来自**并发会话的在途工作**
（permission registry 计数、VMI 收货入库腿自持计值、界面中英文残留）。已用 `stash` 在基线上
复现同一批失败，**不是本轮引入**。本轮**不修**这些失败，也**不**因此降低任何门禁标准。
本记录**不**声称 FULL 在当前 HEAD 全绿。

### 4.2 真实 MySQL 8 客户环境（`129.204.51.149`，commit `1bde79c2`）

部署：commit `1bde79c2` → 停 `modern-erp.service` → checkout → `pnpm install --frozen-lockfile`
→ `pnpm build` → 启动。**本轮有 schema 变更**（v28 迁移新增三张结算表与协议单价列）；
MySQL 未重启；同机 `calculator` / `pairbook-web` 未受影响。

**VMI 结算链端到端实测**（协议单价 **1000 分/件**）：

| 步骤 | 实测结果 |
|---|---|
| VMI 协议 | 协议单价 1000 分/件 |
| 收货 | **20 件** |
| 消耗 | **5 件** |
| 结算期开启 | `openingSource=CANONICAL_INVENTORY_POSITION` + `openingEvidenceHash`（首期期初来自 canonical inventory position 快照，非 0 兜底） |
| 结算期关闭 | **五组恒等式全部成立，容差 0 通过** |
| 结算账单 | `PB-202611-00001`，`grossCents=5000`（= 1000 × 5），`supplier_invoice_no` 自动生成，`tax_mode=NO_TAX` |
| 账单过账 | **200**；产生 canonical 系统凭证 `Dr 6401 主营业务成本 / Cr 2202 应付账款` |
| 读模型 | `received 20 / consumed 5 / grossRemaining 15 / reconciliationStatus RECONCILED / billableQuantity 5 / billable true` |
| **权威结账** | **BLOCKING 24 项全部 PASS、FAILING = 0**；`INVENTORY_VALUE_TO_GL` 差额 **0** |
| 库内现状 | **427 表**；1 个 VMI 协议、1 张收货、1 笔消耗、1 个已关闭结算期、1 张已过账结算账单、1 条分配事实、3 张凭证 |
| 应付开项 | **2 条合计 20000**（收货余 15000 + 结算 5000），与业务所有者裁定的应付构成一致 ✓ |

**库内现状的口径说明**：427 表 = §3.3 清库重播种后的 424 表 + v28 迁移新增的 3 张结算表。

**账号现状**：用户只有 `admin` + 6 个 `demo_*` 角色账号（口令由业务侧掌握，运维脚本与
仓库**不保存**口令）。

### 4.3 客户环境播种脚本的实测证据（`scripts/acceptance/customer-env-seed.mjs`）

脚本**只用应用的 HTTP API**（不直连数据库、不 import `server/` 模块），口令走环境变量。
本地以「干净库 + 真实 HTTP 服务」跑了两遍：

| 项 | RUN 1 | RUN 2（幂等复跑） |
|---|---|---|
| 退出码 | **0** | **0** |
| 步骤汇总 | OK 29 / SKIP 0 / FAIL 0 | OK 22 / SKIP 6 / FAIL 0 |
| 权威结账 | **BLOCKING 24/24 PASS、FAILING = 0** | **BLOCKING 24/24 PASS、FAILING = 0** |
| 委外订单 | 新建 `OS-…` | **复用同一张**（按「供应商 + 成品 + 业务日期 + 数量」锚点） |
| 组装单 | 新建 `ASM-…` | **复用同一张** |
| VMI 收货 / 消耗 | 新建 | **复用同一张**（幂等键精确重放） |
| 结算期 / 结算账单 | 新建 / `PB-202611-00001`（`grossCents=5000`） | **复用同一张**（账单仍 `PB-202611-00001`、`grossCents=5000`） |

**脚本实测暴露的五条业务事实**（已写进脚本注释，避免后来者重踩）：
VMI 货品的期初成本**必须**等于协议单价（否则移动加权池均价与协议单价错位，
`INVENTORY_VALUE_TO_GL` 出差额）；委外订单必须绑定**已批准的 OUTSOURCE BOM**（`bomId`）；
`boms` 的合法 `purpose` 只有 `GENERAL / SELF_MAKE / OUTSOURCE`；`boms` 对
`(product_id, version)` 唯一 → 两张 BOM 必须用不同版本号；OUT-02 校验的是**被委外货品**的
货源而非组件的货源；委外订单列表读模型**不暴露 remark** → 幂等锚点必须用业务键组合。

### 4.4 本轮证据的边界（明确不覆盖什么）

- §4.2 的证据覆盖 **VMI 结算链本身**与**结算后的权威结账**；
- §4.3 的播种脚本实测是在**本地 SQLite 干净库**上做的，**不**等于真实 MySQL 上的播种复跑；
- 它**不**覆盖逐列 schema parity（427 表只做了表数量核对，未做逐列比对）；
- 它**不**覆盖并发行为（结算链的并发等价未在真实 MySQL 上单独取证）；
- 它**不**覆盖 VMI 结算的 operator 工作面 —— 仓库**至今没有任何 VMI 前端页面**
  （Requirement §31.24.3 第 5 项）。

## 5. 未解决事项与残余风险

以下事实**不得**被描述为已解决或已消除：

1. **`6401 主营业务成本` 的第三个来源仍未被期望侧覆盖**：`server/modules/consignment.js:488`
   的 `CONSIGNMENT_SETTLEMENT_COGS` 凭证借记 `6401`，其估值流水类型
   `CONSIGNMENT_SETTLEMENT` **不在** `COGS_TO_GL` 期望侧的取值集合内。因此 `AA-COG-01`
   （期望侧必须覆盖**全部**来源）在委托代销这一支上**仍有口径缺口**。本轮**不**擅自把
   委托代销纳入期望侧 —— 纳入即改变该检查的覆盖边界，且委托代销的成本确认口径
   （结算时一次确认 vs 分摊确认）本身需要独立裁定。**扩大期望侧需独立裁定。**
2. **结算账单作废不冲销结算凭证**：`voidPostedInvoice`（`server/modules/commercial-golive.js`
   的 `voidPostedInvoice`）只对 `SUPPLIER_BILL` 来源调 `reverseSystemVoucher`，而 VMI 结算
   账单在 DIRECT 识别模式下**不**产生 `SUPPLIER_BILL` 来源凭证（它的成本凭证来源是
   `VMI_SETTLEMENT_LINE`）。因此作废结算账单**不会**冲销 `6401` 的成本凭证，其应付开项也
   不被冲销 —— 作废后 6401 成本与应付开项**留存**。`AA-COG-02` 的期望侧按「已出账」口径
   保留该金额（与总账侧一致），因此**不会**因此产生对账失配；但「作废后成本与应付是否
   应当冲销」属**会计语义**，**待业务所有者裁定**。
3. **VMI 供应商资格规则**：`OWNER_DECISION_PENDING`（`SCP-11`），阻塞 VMI 协议面向哪些
   供应商开放。
4. **VMI 结算无 operator 工作面**：协议维护、结算期开闭、账单与分配**尚无前端页面**；
   本轮只交付读模型字段（`VMI-SET-15`）。
5. **VMI 收货不登记 LOT / SERIAL 身份**：跟踪口径货品的入库价值仍无法归属到具体身份
   （Requirement §32.18 开放项 1）。
6. **VMI 消耗后的应付口径未裁定**：结算**之后**发生的消耗仍冲减**收货**开项，结算开项
   不被结算后的消耗核销（`server/vmi-settlement.test.js` 已把该当前口径固化为回归锚点）。
   该语义**待裁定**。
7. **`vmi_receipts.business_status` 的 `'CONSUMED'` / `'TRANSFERRED'` 态**（`M1-F-11`）：
   D-2a 下不再需要独立的物权转移态；是否在读模型中启用 `'CONSUMED'` 留待界面轮次。
8. **N7 文档追溯债务**：本轮文档变更尚未提交，`current` 模式的 N7 检查因此 FAIL；
   提交后须复跑。N7 不是本轮的业务缺陷。
9. **既有违规手工凭证不得再被冲销或改分录**（Requirement §35.13 `AA-VAL-12` 能力收缩）：
   客户环境实测该类凭证数为 0，无实际影响。

## 6. 机器可读状态

```text
VMI_SETTLEMENT_ACCEPTANCE=PASS(本轮合同项在真实 MySQL 8 上验收通过)
VMI_SETTLEMENT_CONTRACT_ITEM_FREEZE=FROZEN(VMI-SET-01..18 / VMI-SET-AC-01..10)
COGS_EXPECTED_SIDE_CONTRACT_ITEM_FREEZE=FROZEN(AA-COG-01..06 / AA-COG-AC-01..06)
LOCAL_FAST=775/775
LOCAL_FOCUSED=22/22(vmi-settlement + accounting-cogs-check-vmi-settlement)
LOCAL_FULL=15 FAILING(并发会话在途工作，非本轮引入；已用 stash 在基线复现同一批失败)
LOCAL_BUILD=PASS
ERROR_CODE_COUPLING=PASS(已登记 2 / 未登记 0 / 死引用 0)
REAL_MYSQL_DEPLOY=1bde79c2(含 v28 schema 迁移；MySQL 未重启)
REAL_MYSQL_VMI_SETTLEMENT=PASS(协议 1000 分/件 → 收 20 → 耗 5 → 关期 → 账单 PB-202611-00001 grossCents=5000 → 过账 200)
REAL_MYSQL_SETTLEMENT_IDENTITY=5/5 PASS(容差 0)
REAL_MYSQL_OPENING_EVIDENCE=CANONICAL_INVENTORY_POSITION(+ openingEvidenceHash)
REAL_MYSQL_VMI_READMODEL=received 20 / consumed 5 / grossRemaining 15 / RECONCILED / billableQuantity 5 / billable true
AUTHORITATIVE_CLOSE=PASS(BLOCKING 24/24，FAILING=0；INVENTORY_VALUE_TO_GL 差额 0)
REAL_MYSQL_AP_OPEN_ITEMS=2 条合计 20000(收货余 15000 + 结算 5000)
REAL_MYSQL_TABLES=427(424 基线 + 3 张 v28 结算表)
CUSTOMER_ENV_SEED=PASS(RUN 1 exit=0 / RUN 2 幂等复跑 exit=0；两次权威结账 BLOCKING 24/24 PASS、FAILING=0；本地 SQLite 干净库)
COGS_TO_GL_DIFFERENCE=0(结算后)
COUNSELLED_COG_SOURCE=CONSIGNMENT_SETTLEMENT(6401 第三来源，未覆盖；扩大期望侧需独立裁定)
SETTLEMENT_BILL_VOID=NOT_REVERSING(作废不冲销 VMI_SETTLEMENT_LINE 成本凭证与应付开项；会计语义待裁定)
VMI_SUPPLIER_QUALIFICATION=OWNER_DECISION_PENDING(SCP-11)
VMI_SETTLEMENT_UI=MISSING(无前端页面；仅交付读模型字段)
VMI_TRACKED_IDENTITY=NOT_IMPLEMENTED(收货不登记 LOT/SERIAL)
N7_TRACEABILITY=PENDING(本轮文档未提交；提交后复跑 current 模式)
MANUAL_CLOSURE=NOT_ISSUED
RELEASE_READINESS=NOT_ISSUED
```

## 7. 签署

| 角色 | 承担者 | 说明 |
|---|---|---|
| 本轮实现与证据采集 | 仓库（执行） | 已完成；证据见 §4 |
| 本轮合同项的 Acceptance 与 Freeze | 业务所有者 | **已签发**（2026-11-18 指令「我决定还是补齐再交付」+「保留 `6401` 作为成本科目，把该检查的期望侧扩展为『销售出库成本 + VMI 结算成本』」，并作出 D-2a / 协议单价 + canonical 账单 / 容差严格 0 / 首期不开放部分结算四项裁定） |
| 「成本在结算时确认、应付拆成两条性质不同开项」语义 | 业务所有者 | **已接受**（随本轮冻结） |
| 委托代销作为 `6401` 第三来源的期望侧覆盖 | 业务所有者 | **待裁定**（本轮未擅自扩大期望侧） |
| 结算账单作废的会计语义 | 业务所有者 | **待裁定**（本轮未擅自决定） |
| 域级 Acceptance / Manual Closure / Release Readiness / push | 业务所有者 | 域级记录不变；Manual Closure 与 Release Readiness 未签发；本记录不授予 Git 写操作授权 |
