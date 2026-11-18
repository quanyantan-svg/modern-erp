# 三项残余闭合轮次的 Acceptance 与合同项 Freeze（2026-11-18）

> 用途：把 2026-11-18「将三项收口 然后将三项残余修复」所交付的三项残余闭合，登记为
> **当前权威**的验收结论与冻结结论。
> Owner：Inventory & Warehouse、Procurement & Outsourcing、Accounting & Analytics 三域共同承担；
> Platform 拥有权限码目录与 route exposure。
> 权威来源：`docs/status/PROJECT_STATUS.md` §82；`docs/requirements/` 与 `docs/design/` 的对应正文。
> **本记录不取代**各域既有的域级 Acceptance / Capability Freeze 记录（那些是历史时点记录）；
> 本记录只覆盖本轮**新增或修订的合同项**。
> 状态：`ACCEPTED`（本轮合同项）/ `FROZEN`（本轮合同项）。

## 1. 授权与边界

业务所有者 2026-11-18 指令「将三项收口 然后将三项残余修复」（AGENTS.md §4.0 连续阶段授权：
Requirement → Design → Implementation → 定向验收 → Acceptance / Freeze），并作出五项裁定：

1. 委外发出商品的总账科目采用 `1406 其他存货`（`OTHER_INVENTORY`），**不**采用 `1404 在制品`
   （`production_wip_movements.production_order_id` 为 `NOT NULL` 外键，委外写不进 WIP 价值子账）；
2. 单腿入库的 VMI 目标按代码现状修正为**VMI 收货入库腿**（原「VMI 所有权转移的入库腿」在代码中不存在）；
3. 穷尽枚举发现的另两条同缺陷类单腿入库腿（拆卸组件回收入库腿、步进调拨退回入库腿）**一并纳入本轮**；
4. 手工凭证守卫的受控科目族扩展到**成本与差异族**；
5. 手工凭证守卫**一并封住**改分录与冲销两个旁路。

**本轮未执行 / 未授权**：真实 MySQL 的结构变更（本轮**无** schema 变更）、Manual Closure 与
Release Readiness。**已执行**：客户测试环境部署（授权见 §3.2）。

## 2. 被验收并冻结的合同项

| 合同项 | 正文 | 内容 | 冻结 |
|---|---|---|---|
| `PRC-GL-01..13` | Requirement §31.22 / Design §26.43 | 委外库存异动的总账接线：发出商品取 `OTHER_INVENTORY`、过桥科目取 `OUTSOURCING_PROCESSING_FEE`、五类事件各一张系统凭证、逐步同域、幂等、零副作用 | `FROZEN` |
| `IW-SLV-01..10` | Requirement §32.18 / Design §27.63 | 单腿入库异动的入库价值：组装 / 拆卸 / 步进调拨（入库与退回）/ VMI 收货五条流程的权威成本来源、同事务、0 值不伪造已估值 | `FROZEN` |
| `AA-VAL-05..13` | Requirement §35.13 / Design §31.18 | 手工凭证守卫：成本与差异族纳入受控集合、创建 / 改分录 / 冲销三条路径共用唯一守卫、非受控科目能力不回退、既有合同测试夹具按新合同调整 | `FROZEN` |

## 3. 证据

### 3.1 本机门禁（`master` @ `2566f75`）

| 门禁 | 结果 |
|---|---|
| `pnpm test:fast` | **775 / 775 PASS**（86 suites） |
| `pnpm test`（FULL） | **4205 / 4205 PASS**（546 suites，0 fail） |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| 文档一致性 `current` / `migration` 双模式 | **ALL CHECKS PASSED**（N1、N3–N9；N2 `RETIRED`） |
| 新增合同套件 | `server/outsourcing-gl-integration.test.js` 4/4、`server/accounting-manual-voucher-guard.test.js` 5/5、`server/inventory-single-leg-valuation.test.js` 4/4 |
| 变异对照 | 委外总账 4 项、手工凭证守卫 3 项**全部实测转红**，源文件逐字节恢复（SHA-256 一致） |

### 3.2 真实 MySQL 8（客户测试环境 `129.204.51.149`）

部署：commit `2566f758`（`git bundle`，未 push 远端）→ 停 `modern-erp.service` → checkout →
`pnpm install --frozen-lockfile` → `pnpm build`（`✓ built in 7.21s`）→ 启动；
`server_started`（host 127.0.0.1 / port 3001 / backend mysql）；nginx `:80` → 200，未认证 API → 401。
**本轮无 schema 变更**，客户库结构未被改动；MySQL 未重启；`calculator` / `pairbook-web` 未受影响。

**增量法取证**（授权口径：不清库，用前后差值判定新流程的贡献）：

| 项 | 事实 | 证据 |
|---|---|---|
| 基线 | 权威结账差额 **−1600**（历史委外异动无总账分录，按合同**不追认、不补记**） | `GET /api/system-health` → `INVENTORY_VALUE_TO_GL.difference = −1600` |
| **B1** | 委外发料（真实 API）产生**一张**系统凭证：`借 1406 发出商品 1000 / 贷 1403 原材料 1000` | `accounting_vouchers` → `SYS-1794991036388-138041`；`B1_ISSUE.difference` 前后**增量 = 0** |
| **B2** | 组装成品入库腿完成权威估值：`IN VALUED +1381`（= 组件出库账面价），出库腿 `OUT VALUED −1381` | `inventory_transactions`（`source_type='INVENTORY_ASSEMBLY'`）；`LEGACY_UNVALUED_MOVEMENTS = 0` |
| **B3** | 自由手工凭证挂 `6401 主营业务成本` → **409** + `MANUAL_VOUCHER_CANONICAL_SUBJECT` + `resolution`；手工凭证总数不变 | API 实测；`accounting_vouchers WHERE source_type='MANUAL'` 计数前后一致 |

同轮其它检查：`INVENTORY_QUANTITY_VS_VALUATION 0`、`WIP_TO_GL 0`、`RECEIPT_GRNI_TO_GL 0`、
`COGS_TO_GL 0`、`SYSTEM_VOUCHER_UNIQUENESS 0`。

**取证后环境复原**：验收探针账号（临时 `role-admin`）已**删除**，其全部外键引用（243 列）已改指
`user-admin-init`；`/tmp` 下的 bundle 与脚本已清理；`admin` 账号与其口令**未被触碰**。
客户库保留本次增量取证产生的业务事实（1 笔委外发料、1 张组装单）与夹具（BOM `probe-bom-assy`），
作为证据留存。

### 3.3 已知的门禁回归及其处置（不降级断言）

守卫扩到成本与差异族后，**12 个既有报表套件**（试算平衡 / 资产负债表 / 损益表 / 财务摘要）以
`6401 主营业务成本` 构造费用侧事实的手工凭证被拦截。按 Requirement §35.13 `AA-VAL-13` 登记的
口径，这些测试的**费用侧夹具**改用非受控科目 `6603 处置资产损益`（EXPENSE 类型，口径等价）；
**断言的强度与语义不变**，科目目录断言（目录仍含 `6401`）不变。

## 4. 未解决事项与残余风险

1. **历史委外异动仍缺总账分录**（权威结账绝对值 −1600）：按 Requirement §31.22 的边界，
   本轮**不追认、不补记**历史凭证。要让绝对值归零，需在**干净库**上重跑验收轮次，或由业务所有者
   就历史数据另行裁定。
2. **VMI 收货不登记 LOT / SERIAL 身份**：跟踪口径货品的入库价值无法归属到具体身份，
   本轮只对移动加权口径计值（Requirement §32.18 §32.18.5 开放项 1）。
3. **步进调拨「退回来源仓」入库腿当前无 HTTP 路由**（`returnToSource` 为 zero-caller）：
   本轮的自持计值修复是**预防性**的（Requirement §32.18 §32.18.4 第 1 项）。
4. **既有违规手工凭证不得再被冲销或改分录**（Requirement §35.13 `AA-VAL-12` 能力收缩）：
   客户环境实测该类凭证数为 0，无实际影响。
5. 客户环境残留 AC2 虚构验收数据与本次增量取证的夹具；`ac2_*` 验收账号口令未轮换。

## 5. 冻结范围与解冻

- 本轮**冻结**的是 §2 表中的合同项（`PRC-GL-01..13`、`IW-SLV-01..10`、`AA-VAL-05..13`）。
  修改它们须走显式解冻 + Requirement 修订。
- AC2 轮次记录（`ac2-round-acceptance-freeze-20261118.md`）的 17 个合同项中，
  `IW-VAL-01..06` 与 `AA-VAL-01..04` 被本轮**有界解冻并修订**（`IW-VAL-05` 修订为
  `IW-SLV-01..10`，`AA-VAL-01` 修订为 `AA-VAL-05..13`），其余 13 项**不变**。
- 三个域既有的域级 Acceptance / Capability Freeze 记录**保持不变**（历史时点记录）。
- Manual Closure 与 Release Readiness **未签发**。

## 6. 机器可读状态

```text
RESIDUALS_ROUND_ACCEPTANCE=PASS(本轮合同项在真实 MySQL 8 上验收通过)
RESIDUALS_ROUND_CONTRACT_ITEM_FREEZE=FROZEN(PRC-GL-01..13 / IW-SLV-01..10 / AA-VAL-05..13)
LOCAL_FAST=775/775
LOCAL_FULL=4205/4205
LOCAL_BUILD=PASS
DOC_CONSISTENCY=ALL CHECKS PASSED(current + migration)
REAL_MYSQL_DEPLOY=2566f758(git bundle；未 push)
REAL_MYSQL_GAP_DELTA=0(增量法：新流程对 INVENTORY_VALUE_TO_GL 的贡献为 0)
REAL_MYSQL_ABS_GAP=-1600(历史委外异动，按合同不追认)
OUTSOURCING_GL_VOUCHER=Dr 1406 / Cr 1403
ASSEMBLY_INBOUND_LEG=VALUED(+1381 = 组件出库账面价)
LEGACY_UNVALUED_MOVEMENTS=0
MANUAL_VOUCHER_GUARD=409 MANUAL_VOUCHER_CANONICAL_SUBJECT + 零副作用
AUTHORITATIVE_CLOSE=BLOCKED(仅剩历史委外异动一项，需干净库重跑或所有者裁定)
MANUAL_CLOSURE=NOT_ISSUED
RELEASE_READINESS=NOT_ISSUED
```

## 7. 签署

| 角色 | 承担者 | 说明 |
|---|---|---|
| 本轮实现与证据采集 | 仓库（执行） | 已完成；证据见 §3 |
| 本轮合同项的 Acceptance 与 Freeze | 业务所有者 | **已签发**（2026-11-18 指令「将三项收口 然后将三项残余修复」并裁定五项口径） |
| 历史委外异动的处置（追认 / 干净库重跑 / 裁定保留） | 业务所有者 | **待裁定**（见 §4.1） |
| 域级 Acceptance / Manual Closure / Release Readiness / push | 业务所有者 | 域级记录不变；Manual Closure 与 Release Readiness 未签发 |
