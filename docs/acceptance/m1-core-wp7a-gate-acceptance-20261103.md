# M1-Core WP7-A — M1-Core 首期非破坏性验收执行报告（2026-11-03）

**性质**：验收执行与证据登记。**不签发** `M1C-G01..M1C-G07` 的 PASS，
**不构成** M1-Core Acceptance / Domain Closure / Freeze / Release Readiness。
**不修改** Requirement（§31.13）、Active Design（`procurement-outsourcing-m1-core.md`）
或任何既有历史验收事实。

- Owner：M1-Core 域业务所有者（本轮为验收执行方，不兼签发方）
- 状态：`EXECUTION_RECORDED` —— G01/G02/G03/G04/G06 为 **PASS_WITH_RESIDUAL**，
  G05 为 **FAIL**，G07 为 **NOT_RUN**
- 权威来源：本文件是 WP7-A 的**执行证据**；项目级进度登记仍唯一位于
  `docs/status/PROJECT_STATUS.md` §37.27；Requirement / Design 正文不受本文件影响。

---

## 0. 结论摘要

| Gate | 执行状态 | 证据层 | 结论 | 剩余风险 |
|---|---|---|---|---|
| `M1C-G01` 采购通知与转换 | 已执行 | L1 HTTP + SQLite | **PASS_WITH_RESIDUAL** | MySQL 对等未证（G07 `NOT_RUN`） |
| `M1C-G02` 委外收货与质量 | 已执行 | L1 HTTP + SQLite | **PASS_WITH_RESIDUAL** | MySQL 对等未证；加工费必填政策未裁定 |
| `M1C-G03` 物料库存与 WIP | 已执行 | L1 HTTP + SQLite | **PASS_WITH_RESIDUAL** | MySQL 对等未证；`INVENTORY_MUTATION_UNEXPECTED_REPLAY` 在委外端点不可达（见 §4.4） |
| `M1C-G04` 倒冲与成品 | 已执行 | L1 HTTP + SQLite | **PASS_WITH_RESIDUAL** | MySQL 对等未证；加工费 provisional 口径未定 |
| `M1C-G05` 移动工作面 | 已执行 | Browser（Edge / Playwright） | **FAIL** | 两个工作面在构建产物中**无法打开**（§3.5）；修复需另立工作包 |
| `M1C-G06` 延期政策与财务守卫 | 已执行 | L1 HTTP + SQLite | **PASS_WITH_RESIDUAL** | MySQL 对等未证 |
| `M1C-G07` MySQL 并发与对等 | **NOT_RUN** | — | **NOT_RUN** | 四重 ACK 仅实现 3 项；本轮未授权运行 |

`PASS_WITH_RESIDUAL` 的含义：本地 SQLite 上、正向来源全部经**生产 HTTP API** 的
正向与反向断言全部成立且可复跑；但 **MySQL 8 真实后端的对等与并发结论未取得**，
因此按 Active Design §13.1 的 Gate 定义，**不得**据此签发该 Gate 的 PASS。

---

## 1. Git 基线与双远端

| 对象 | 值 |
|---|---|
| Repository | `quanyantan-svg/modern-erp` |
| Branch | `work/m1-core-rebaseline-20261102` |
| 本轮起点 HEAD | `2fe1dd841b6c73deb53b09d87da77e0c34533ae4` |
| `git ls-remote github` | `2fe1dd841b6c73deb53b09d87da77e0c34533ae4` |
| `git ls-remote origin`（Gitee） | `2fe1dd841b6c73deb53b09d87da77e0c34533ae4` |
| 起点工作树 | 干净（`git status --short --branch` 仅输出分支行） |

起点三处 HEAD 精确一致，本轮**未**强推、未重置、未改写历史、未混入无关工作树变更。

---

## 2. 证据分级与夹具边界

Active Design §13.1 定义三级证据：`L1` 生产 API 造数、`L2` 直接领域函数、
`L3` 直接 SQL 造数（**不可**作为通路证据）。

本轮正向来源**一律 L1**：委外订单、委外 BOM（`POST /api/engineering/boms`）、
加工费 PO（`POST /api/procurement/outsourcing/orders/:id/processing-fee-purchase-orders`）、
完工通知（`POST /api/receipt-notices`）、委外收货（`POST /api/procurement/outsourcing/receipts`）、
发料 / 补料 / 退料（`POST .../issues|/supplements|/returns`）、
收货生效（`POST /api/procurement/outsourcing/receipts/:id/confirm`）、
加工费账单（`POST /api/procurement/outsourcing/processing-fee-bills`）、
库存入仓（`POST /api/inventory/native-documents` + `confirm`）、
LOT / SERIAL 身份（`POST /api/inventory-lots`、`POST /api/inventory-serials`）、
采购通知与转换（`POST /api/receipt-notices`、`POST /api/receipt-notices/:id/convert`）。

**L3 只用于三类没有生产写入入口的字段**，且不参与任何正向通路证明：

| L3 夹具 | 原因 |
|---|---|
| `products.valuation_method` | 无任何 HTTP 路由写入；不设置则 `valuationMethod()` 直接抛 409 |
| `inventory_valuation_balances` 种子行 | 估值方法与跟踪策略的绑定由应用层校验；种子行只用于给权威估值一个非零账面价值 |
| `inventory_lot_balances` 种子行 | 批次维度当前投影的写入者是 `postCanonicalTrackedLeg`，原生库存单据确认路径不写它 |

所有夹具位于一次性临时 SQLite（`mkdtempSync`），**未触碰**任何项目 / 开发 / 生产数据库，
**未连接** MySQL。

---

## 3. 逐 Gate 执行结果

### 3.1 `M1C-G01` 采购通知与转换 —— PASS_WITH_RESIDUAL

**运行命令**

```bash
node scripts/testing/run-tests.js full --filter m1c-wp1
```

**正向场景与断言**（证据文件：`server/m1c-wp1-procurement-notice-conversion.test.js`，
25 例；辅以 `m1c-wp1-r1-schedule-patch.test.js`、`m1c-wp1-r2-outsourcing-receipt-effect-evidence.test.js`）

| 断言 | 断言位 | 结果 |
|---|---|---|
| `createReceiptNotice()` 同事务原子创建表头、明细、已验证来源行，显式 `converted_quantity=0` | A1 / A7 | PASS |
| 多 PO `sourceAllocations` 逐项验证 | A2 / C7 | PASS |
| 行级部分转换，累计量正确增长 | C2 | PASS |
| 转换幂等：重放不重置、不重复扣减 | C3 | PASS |
| 容量上界**按通知 `business_type` 分域**（采购行 × PO 行 × 交期 vs 委外订单剩余） | B1 / B2 / B3 / D3 / D4 | PASS |
| 历史 NULL 来源 fail closed | C5 | PASS |
| OUTSOURCE 通知不写标准采购来源行 | A8 | PASS |
| 直接 PO → 采购入库合法 | D1 | PASS |
| 交期消费进入不可变台账 | D1 / D2 / D5 | PASS |
| 拒绝后逐字段零变化 + 拒绝审计恰好 1 条 | A3 / A4 / A6 / C6 | PASS |

**反向场景**：来源分配和不等于通知行、PO / 产品 / 供应商 / 仓不匹配、交期不可判定、
容量越界、取消后重转 —— 全部精确拒绝。

### 3.2 `M1C-G02` 委外收货与质量 —— PASS_WITH_RESIDUAL

**运行命令**：`node scripts/testing/run-tests.js full --filter m1c`

| 断言 | 断言位 | 结果 |
|---|---|---|
| 委外订单 `DRAFT → PLAN_CONFIRMED → RELEASED` | `m1c-wp2-wp5-outsourcing.test.js::releaseOrder` | PASS |
| 加工费 PO `DRAFT → SUBMITTED → APPROVED`，**创建人与审批人不同** | `m1c-processing-po.test.js` + 夹具 `createApprovedProcessingPo`（admin 创建 / reviewer 审批） | PASS |
| 委外收货表头与 ≥1 条明细原子落库 | WP2 第 1 例 | PASS |
| 正式行级来源（加工费 PO 行 + 通知行）逐行可追 | WP2 第 1 例 + R2 套件 | PASS |
| 同一通知行累计占用与剩余容量 | `m1c-wp2-wp6-r1-notice-line-capacity.test.js`（15 例） | PASS |
| `PENDING_INSPECTION` 与生效分离 | WP2 第 2 例 | PASS |
| IQC `PASS` / `WAIVED` | WP2 第 2 例 + `m1c-wp1-r2-*` | PASS |
| **委外收货员真实角色**取得正向生效证据，管理员不得替代职责分离证据 | WP2 第 4 例（`OUTSOURCING_RECEIVING_MANAGE` 单独持有；`OUTSOURCING_MANAGE` 持有者 403） | PASS |
| `EFFECTED` + 成品库存与成本证据 | WP2 第 2 例 | PASS |
| 重复确认幂等、业务零副作用、拒绝审计恰好 1 条 | `m1c-wp2-wp6-r1-receipt-effect-idempotency.test.js`（8 例） | PASS |

### 3.3 `M1C-G03` 物料库存与 WIP —— PASS_WITH_RESIDUAL

**运行命令**：`node scripts/testing/run-tests.js full --filter wp7a`（G03 组）

**本轮补齐的断言位**（新增 `server/m1c-wp7a-gate-acceptance.test.js`）。
此前 `Design §13.1 M1C-G03` 明列但**没有断言位**的项目：

| 断言 | 断言位 | 结果 |
|---|---|---|
| LOT 身份 `LOT:<lotId>` 各自成键，`identity_type='LOT'`，`evidence_state='TRACKED'` | G03-1 | PASS |
| SERIAL 身份 `SERIAL:<serialId>` 各自成键 | G03-1 | PASS |
| MOVE 腿成对（OUT + IN），跟踪腿数 == 实际物理腿数 | G03-1 | PASS |
| 企业所有权不变（`owner_type='ENTERPRISE'`、`owner_id IS NULL`） | G03-1 | PASS |
| 每条物理腿有 `POSTED` 权威估值 | G03-1 | PASS |
| 身份异常：LOT 缺批次 / SERIAL 缺序列号 / SERIAL 携带批次 / SERIAL 数量 ≠ 1 | G03-2 | PASS（409 `WIP_IDENTITY_EVIDENCE_MISSING` / `WIP_IDENTITY_POLICY_MISMATCH`） |
| 缺 WIP 仓 | G03-3 | PASS（409 `OUTSOURCING_WIP_WAREHOUSE_MISSING`） |
| 库存不足 | G03-3 | PASS（409 `OUTSOURCING_WIP_INSUFFICIENT`） |
| UOM 不符 | G03-4 | PASS（409 `OUTSOURCING_WIP_UOM_MISMATCH`） |
| 历史不可证明 | WP3 第 2 例 | PASS（409 `OUTSOURCING_WIP_HISTORY_UNPROVEN`） |
| 同键同内容幂等重放不产生第二次物理动作 | G03-5 | PASS |
| 同键异内容拒绝 | G03-5 | PASS |
| 身份 / 容量 / UOM 拒绝后逐字段零变化 + 拒绝审计恰好 1 条 | G03-2 / G03-3 | PASS |

**数量守恒**：身份余额 `available_quantity = issued + supplemented − returned − backflushed`，
与物料行计数一致（WP3 第 1 例 + G03-1）。

### 3.4 `M1C-G04` 倒冲与成品 —— PASS_WITH_RESIDUAL

**运行命令**：`node scripts/testing/run-tests.js full --filter wp7a`（G04 组）

**本轮补齐的断言位**：

| 断言 | 断言位 | 结果 |
|---|---|---|
| 多批次部分完工：两批各 30，累计倒冲 = 0.005 × 60 = **0.30** | G04-1 | PASS |
| 无双扣：倒冲物理腿恰好 2 条且**只有 OUT** | G04-1 | PASS |
| 无双收：成品入库腿恰好 2 条 | G04-1 | PASS |
| 材料账面价值来自 **canonical 位置口径**（WIP 仓 100 分/单位 × 0.15 = **15 分**） | G04-1 | PASS |
| 成品估值 **Movement + Balance 双写**（Balance 数量 60 / 金额 60030，Movement 合计 60030） | G04-1 | PASS |
| 加工费 **provisional** 成本证据（`processing_fee_provisional_cents=30000`，`actual`/`variance` 仍为 NULL，`basis='PROVISIONAL'`） | G04-1 | PASS |
| WIP 仓余额与流水可对账（9.70 / 970） | G04-1 | PASS |
| 未批准 / 用途不符的 OUTSOURCE BOM fail closed | WP4 第 1 例 | PASS |
| 不产生提前开放的 AP / GL | G04-1 | PASS |
| 重复确认不双扣、不双收 + 拒绝审计恰好 1 条 | G04-2 | PASS |

**非空洞性证明（negative control）**：为证明「位置口径而非全局平均价」这一断言
不是恒真断言，本轮**临时**把 `server/modules/financial-inventory.js::issueValue`
的分摊改成全局平均（`SUM(value_cents)/SUM(quantity)` 跨仓），重跑 WP7-A 套件，
G04-1 随即失败并报 `材料账面价值必须来自 canonical 位置口径（15 分），实际 82`；
其余 7 例不受影响。**该临时改动已用 `git checkout -- server/modules/financial-inventory.js`
完整回退**，`git diff` 对该文件为空（见 §6.2）。

### 3.5 `M1C-G05` 移动工作面 —— **FAIL**

**运行命令**

```bash
pnpm build
node scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs
```

**结果**：`PASS=16 / FAIL=8 / TOTAL=24`（3 主体 × 4 宽度 × 2 工作面）。

| 主体 | 工作面 | 宽度 | 服务端 RBAC 判定 | 页面 | 结论 |
|---|---|---|---|---|---|
| admin | outsourcing | 320/390/430/680 | 200 ✓ | **打不开** | FAIL ×4 |
| admin | sourcing-pricing | 320/390/430/680 | 200 ✓ | **打不开** | FAIL ×4 |
| 委外业务员 | outsourcing | 320/390/430/680 | 200 ✓ | **打不开** | FAIL ×4 |
| 委外业务员 | sourcing-pricing | 320/390/430/680 | **403 ✓** | 页面级处理 ✓ | PASS ×4 |
| 销售专员 | outsourcing | 320/390/430/680 | **403 ✓** | 页面级处理 ✓ | PASS ×8 |
| 销售专员 | sourcing-pricing | 320/390/430/680 | **403 ✓** | 页面级处理 ✓ | （同上） |

**成立的部分**

- 服务端来源级 RBAC **正确**：admin 200 / 200；委外业务员 200 / 403
  （`GET /api/procurement/source-entries` 要求 `PROCUREMENT_CONFIG_VIEW`，该角色不持有）；
  销售专员 403 / 403。后端 fail closed 成立。
- 无权主体的**页面级处理**成立且文案明确：路由权限暴露在应用层生效，
  页面渲染「**无权访问 / 当前账号没有打开该应用的权限。**」，无控制台错误、无崩溃。
  （实测：委外业务员 @ `#sourcing-pricing`、销售专员 @ `#outsourcing` 均如此。）
- 无 `api.get/api.post` TypeError。
- 320 / 390 / 430 / 680 四宽度均无横向溢出（`documentWidth === viewportWidth`）。

**不成立的部分（阻塞 G05 的缺陷）**

**缺陷 G05-A（P0，阻塞）—— 两个工作面在构建产物中无法打开。**

- 证据：浏览器控制台 `Error: Unknown route screen module: ../pages/outsourcing.jsx`
  与 `.../../pages/sourcing-pricing.jsx`；页面渲染「应用暂时无法打开 / 请返回应用列表后重试」。
- 根因：`src/navigation/applicationRegistry.js:104-144` 的 `loadScreenModule(path)`
  是一个显式 `switch`，**没有** `../pages/outsourcing.jsx` 与
  `../pages/sourcing-pricing.jsx` 两个 `case`；而
  `src/navigation/applicationRegistry.js:80-81` 的路由表**确实**用
  `defaultScreen('../pages/sourcing-pricing.jsx')` / `defaultScreen('../pages/outsourcing.jsx')`
  注册了这两条路由。于是路由可被解析、launcher 会暴露入口，但**打开时**落进
  `default:` 分支 `Promise.reject(new Error('Unknown route screen module: ...'))`。
- 佐证：全新 `pnpm build` 产出的 `dist/assets/` 中**没有** `page-outsourcing*.js`
  与 `page-sourcing-pricing*.js` chunk。
- 最小修复建议（**不在本轮范围内**）：在 `loadScreenModule` 中补两条 `case`，
  形如
  `case '../pages/outsourcing.jsx': return import('../pages/outsourcing.jsx');`
  与
  `case '../pages/sourcing-pricing.jsx': return import('../pages/sourcing-pricing.jsx');`
  并补一条**注册表与 loader 覆盖一致性**的回归断言（现有
  `server/v17-p0-frontend-application-architecture.test.js:129` 只断言 loader 的**形状**，
  不校验每条已注册路由的 screen module 可加载，因此此前无人发现）。

**缺陷 G05-B（P1，阻塞「提交」步骤）—— 委外页面的动作门禁恒为假。**

- 证据：`src/components/ui.jsx:10` 的契约是
  `export const can = (user, permission) => user?.permissions?.includes(permission);`
  即 `can(user, 'PERMISSION_CODE')`。而 `src/pages/outsourcing.jsx` 的三处调用是
  **单参数数组**形式：`can(['OUTSOURCING_MANAGE', 'OUTSOURCING_RELEASE'])`（:85）、
  `can(['OUTSOURCING_RELEASE'])`（:201）、`can(['OUTSOURCING_MANAGE'])`（:206）。
  此时 `user` 是数组、`permission` 为 `undefined`，`user?.permissions` 为 `undefined`，
  表达式恒为 `undefined`（假）。实测：
  `can(['OUTSOURCING_MANAGE','OUTSOURCING_RELEASE']) === undefined`，
  而 `can(admin, 'OUTSOURCING_RELEASE') === true`。
- 后果：「新建委外订单」「确认计划 / 下达 / 标记完工」「取消」三个动作按钮
  **永不渲染** —— 即使缺陷 G05-A 修复、工作面可以打开，委外页面仍是**只读**的，
  Active Design §13.1 要求的「入口 → 列表 → 详情 → **提交** → 错误展示」仍无法走通。
- 佐证：`can([...])` 是 `src/pages/` 中**唯一**的数组式调用；其余 30+ 处全部是
  `can(user, 'CODE')` 规范形式。
- 最小修复建议（**不在本轮范围内**）：三处改为
  `can(user, 'OUTSOURCING_MANAGE')` / `can(user, 'OUTSOURCING_RELEASE')`，
  并需要从当前登录主体取 `user`（页面目前未取）。建议与 G05-A 一并作为
  **新的前端工作包**处理。

**对既有 G05 证据的追溯修正**：本轮之前
`scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs` 报告的 `PASS=16/16`
**不是**有效证据 —— 该脚本在注入 `localStorage` token 后**没有 reload**，
SPA 从未离开登录页，被测对象是**登录页**而不是目标工作面；且它的断言
（无 TypeError、正文非空、无横向溢出）在工作面打不开时**依然成立**。
本轮已把该脚本加固为：注入 token 后 reload、断言工作面**确实渲染**
（不接受登录页或「应用暂时无法打开」）、逐工作面探测服务端 RBAC 状态、
新增无权主体。加固后的脚本如实报告 `PASS=16 / FAIL=8`。

### 3.6 `M1C-G06` 延期政策与财务守卫 —— PASS_WITH_RESIDUAL

**运行命令**：`node scripts/testing/run-tests.js full --filter wp7a`（G06 组）
辅以 `server/m1c-outsourcing-gl-policy-guard.test.js`。

| 断言 | 断言位 | 结果 |
|---|---|---|
| 委外加工费账单 `DRAFT` 创建合法且停留在 `DRAFT` | G06-1 / R1-A | PASS |
| 专用正式过账 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED` | G06-1 / R1-A | PASS |
| 共享 `POST /api/supplier-bills/:id/post` 409 | G06-1 / R1-A | PASS |
| 共享 `POST /api/supplier-bills/:id/match` 409 | G06-1 / R1-A | PASS |
| 内部调用方使用**同一个**来源级 Guard | R1-A | PASS |
| Admin 不绕过来源级业务政策 | G06-1（admin 共享过账 409） | PASS |
| 无权限主体**先**得到 403，且不泄露来源与单据标识 | G06-1 / R1-A | PASS |
| 普通采购账单创建与过账仍合法（防误伤回归） | R1-A | PASS |
| VMI 结算 / 物权释放等延期危险写入被拒绝 | WP5 第 1 例（`VMI_SETTLEMENT_POLICY_PENDING`） | PASS |
| 倒冲差异生效被拒绝 | WP5 第 1 例（`OUTSOURCING_DIFFERENCE_APPROVAL_PENDING`） | PASS |
| 成品退货 / 跨单 WIP 转移被拒绝 | WP5 第 1 例 | PASS |
| **拒绝后 AP / 凭证 / 库存 / 估值 / 成本 / 单据逐字段零变化** | G06-1（本轮新增快照断言） | PASS |
| 409 / 403 恰好 1 条拒绝审计；400 不写 Domain 审计 | G06-1 / WP2-WP5 / 幂等套件 C 组 | PASS |

G06-1 的逐字段快照覆盖：`supplier_bills`（全行）、`supplier_bill_items`、
`account_payables`、`account_vouchers`、`inventory_transactions`、
`inventory_valuation_movements`、`inventory_valuation_balances`、
`outsourcing_cost_evidences`、`outsourcing_receipts`、`outsourcing_receipt_items`。
四次拒绝（专用过账 / 共享过账 / 共享匹配 / 管理员共享过账）**每一次**后快照
与拒绝前**逐字节相同**。

---

## 4. 未解决矛盾与剩余风险

### 4.1 加工费 `processingFeeCents` / `unitPriceCents` 是否必填 —— 未裁定

沿用既有缺省 0 的受限行为，本轮**未**通过新增测试预期擅自批准该政策。
后果：G04 的 `INV-4`（委外成本证据 = 材料实耗价值 + 加工费）在缺省情形下
**低估**成品成本。本报告中的加工费金额均为 **provisional**，
**不得**被解读为最终加工费金额。

### 4.2 `M1C-G07` 未运行 —— MySQL 对等与并发结论缺失

G01–G06 的全部正向与反向断言只在**一次性 SQLite** 上成立。
MySQL 8 下的命名锁（`GET_LOCK`）、全局事务闸门、唯一索引行为、
`FOREIGN KEY` 与 `CHECK` 语义**均未复跑**。按 §31.13.5 的 Gate 规则，
这使得 G01–G06 只能记为 `PASS_WITH_RESIDUAL`。

### 4.3 `INVENTORY_MUTATION_UNEXPECTED_REPLAY` 在委外端点不可达

Active Design §13.1 `M1C-G03` 的拒绝断言列有「撞键 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`」。
实测：该错误码在 `server/lib/inventory-mutation.js` 的**全局**幂等键冲突处产生
与 `server/modules/outsourcing-inventory.js:69` 的 WIP 身份效果冲突处产生；而委外发料的
canonical 变更键为 `${sourceType}:${eventId}:${material.id}:MOVE:${identity.identityKey}`，
其中 `eventId` 每次请求都是新 `randomUUID()`，**因此在委外 HTTP 端点上该撞键不可能发生**。
委外端点上的等价合同是「同一幂等键不能用于不同请求内容」（409，无 error code）。
本轮按实际合同取证，**未**伪造该错误码的可达路径。

### 4.4 `OUTSOURCE` 历史来源隔离规模未实测

历史收货无法证明通知行来源即 fail closed（`OUTSOURCING_WIP_HISTORY_UNPROVEN` /
`RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN`），可能使部分历史委外订单
**不可继续收货**。该隔离规模本轮**未**实测（沿用 §37.26 的既有登记）。

### 4.5 G05 的两个前端缺陷需要独立工作包

见 §3.5。两者都不影响后端 RBAC 与业务事实，但**阻塞** G05 的正向结论，
且「提交」步骤即使在 G05-A 修复后仍会因 G05-B 而失败。

### 4.6 `TC-01 / M-15` 共享前置未运行

本轮**未**执行规范化、**未**建立唯一索引、**未**运行 PRE-A / PRE-B / PRE-C。
依赖严格跟踪唯一性的 `M1C-G03` / `G04` / `G07` 在 MySQL 上取证时**必须**先取得该前置。

---

## 5. `M1C-G07` — MySQL 执行准备（**NOT_RUN**）

**状态：`NOT_RUN`。本轮未连接任何 MySQL、未运行 destructive Gate、未执行项目数据库
Migration、未执行 `M-15`、未在 MySQL 中创建或删除数据库、未自行实现任何高风险数据库行为。**

### 5.1 CR-01..CR-09 → 真实生产 Handler

| 场景 | 竞争的权威资源 | 必须直接调用的真实 Handler | 路由 |
|---|---|---|---|
| `CR-01` | 交期容量 | `confirmReceiptNotice` 与 `convertReceiptNoticeToReceipts` **共用**的容量解析函数 | `POST /api/receipt-notices/:id/confirm`、`POST /api/receipt-notices/:id/convert` |
| `CR-02` | 采购订单行累计收货量 | `confirmPurchaseReceipt` | `POST /api/purchase-receipts/:id`（body `{action:'confirm'}`） |
| `CR-03` | 委外收货生效（成品入库 + 倒冲） | `confirmOutsourcingReceipt` | `POST /api/procurement/outsourcing/receipts/:id/confirm` |
| `CR-04` | 物料行 WIP 数量 | `issueMaterial` | `POST /api/procurement/outsourcing/orders/:id/issues` |
| `CR-05` | 物料行 WIP 数量 | `supplementMaterial` | `POST /api/procurement/outsourcing/orders/:id/supplements` |
| `CR-06` | 物料行 WIP 数量 | `returnMaterial` | `POST /api/procurement/outsourcing/orders/:id/returns` |
| `CR-07` | 增量倒冲可消费量 | `confirmOutsourcingReceipt`（倒冲腿） | 同 `CR-03` |
| `CR-08` | 同一 LOT / SERIAL 身份的可用量 | 倒冲腿与退料腿 | 同 `CR-03` / `CR-06` |
| `CR-09` | 同一委外订单的加工费 PO 终身唯一性 | `createOutsourcingProcessingPurchaseOrder` | `POST /api/procurement/outsourcing/orders/:id/processing-fee-purchase-orders` |

**全部目标均为生产 Handler**；正向通路**不得**以手写 SQL 造数替代。

### 5.2 SQLite / MySQL Schema Parity 测试入口

- 入口：`server/m1c-wp0-schema-parity.test.js`（登记在 **FAST** 与 **FULL**）。
- 机制：离线驱动生产 DDL 翻译器 `bootstrapMySql`（`server/database/mysql-schema.js`），
  用**录制型 mock adapter** 采集发出的 DDL，**不连接 MySQL**，因此**不能**据此签发动态对等 Gate。
- 已覆盖：5 张新表的列集、类型族、NOT NULL / DEFAULT / PK / UNIQUE / 索引 / FK / CHECK，
  加法迁移路径的 5 条 CREATE TABLE + 16 条 ALTER TABLE + 6 个新索引。
- **覆盖缺口（须在 G07 中补齐）**：`receipt_notice_items` 表体本身、
  `outsourcing_receipts` / `outsourcing_receipt_items` 的**表体**未进入逐表对等循环，
  只被断言了加法列计划。
- `server/sales-customer-wave10-mysql-parity.test.js` 只覆盖 Wave 9/10 信用表，
  **不覆盖**采购 / 委外表。

### 5.3 UNIQUE / 锁 / 事务 / 幂等 / 审计验证方案

| 维度 | 验证点 | 依据 |
|---|---|---|
| UNIQUE | `outsourcing_wip_identity_effects.idempotency_key`、`inventory_mutation_log.idempotency_key`、`supplier_bill_items` 来源唯一、`purchase_orders.source_outsourcing_order_id` 终身唯一 | `server/m1c-wp2-wp5-outsourcing.test.js` 的 UNIQUE 索引组；MySQL 侧必须复跑「历史重复来源在建索引前 fail closed」 |
| 锁 | MySQL `GET_LOCK` 幂等命名锁；`inventory_locks` 位置锁；全局事务闸门 | `server/modules/financial-controls.js:35-41`；事务前拒绝必须释放命名锁以免退化为 503 |
| 事务 | 所有 Core mutation 在事务内重读权威状态；失败副作用为零 | `server/lib/inventory-mutation.js`、`server/modules/outsourcing-finance.js` |
| 幂等 | 同键精确重放返回已记录结果；同键异内容 409；换键重复确认 409 | `m1c-wp2-wp6-r1-receipt-effect-idempotency.test.js` |
| 审计 | 409 恰好 1 条 Domain 拒绝审计（含精确 error code）；403 审计不含业务单据标识；400 不写 Domain 审计 | 同上 |

**并发模型**：必须使用**多会话**。既有可复用范式有两种 ——
`server/mysql-phase7b-concurrency.integration.js`（多进程 + `Promise.all`，
每进程独立 adapter/session）与
`server/mysql-inventory-domain-concurrency.integration.js:88` /
`server/mysql-finance-operations-concurrency.integration.js:184`
（单进程多 app 实例 + `Promise.allSettled`）。
**不得**复用 `server/mysql-procurement-outsourcing-concurrency.integration.js`：
它对手写 `race_probe_generic` 表做并发，**不调用真实领域 Handler**，且是单会话。

### 5.4 四重 disposable MySQL ACK 设计

`server/test-utils/mysql-disposable-target.js::assertAuthorizedDisposableMySqlTarget`
已实现前三重：

| ACK | 实现 | 要求 |
|---|---|---|
| ACK-1 | 已实现 `:19-21` | `ERP_MYSQL_TEST_ALLOW_RESET === 'true'`（精确字符串） |
| ACK-2 | 已实现 `:22-30` | `ERP_MYSQL_TEST_DISPOSABLE_TARGET` **精确等于** `mysql://<user>@<host>:<port>/<db>`；且库名匹配 `/(test\|phase7[abc]\|disposable)/i` |
| ACK-3 | 已实现 `:31-37` | `ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS === 'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP'`（精确相等，不接受子集 / 超集 / 重排） |
| **ACK-4** | **NOT_IMPLEMENTED** | 需绑定 run ID + commit SHA 的一次性授权：`ERP_MYSQL_TEST_RUN_ID`（UUIDv4）、`ERP_MYSQL_TEST_TARGET_COMMIT_SHA`（40 位十六进制且等于 `git rev-parse HEAD`）、`ERP_MYSQL_TEST_RUN_ACK`（形如 `ALLOW_DESTRUCTIVE_RUN:<run_id>:<sha>:<target_identity>:DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP`），并在 `scripts/gates/.state/mysql-destructive-acks/<run_id>.json` 以原子 `open(...,'wx')` 一次性消费（**首次 DROP 之前**消费） |

**本轮未实现 ACK-4**，也不得声称已验证 ACK-4。最接近的既有一次性机制是
`ERP_MYSQL_WAVE10_CAMPAIGN_ID` + 进程内租约，它**不绑定 commit SHA** 且随进程消亡。

### 5.5 目标数据库身份与清理边界

| 项 | 值 |
|---|---|
| Host / Port | `127.0.0.1` / `3306` |
| Database | `modern_erp_domain_test` |
| User | `modern_erp_test` |
| Disposable target identity | `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test` |
| 基线凭据 | `%LOCALAPPDATA%\ModernERP\mysql-gate\credential.dat`（DPAPI）+ `target.json` |
| 清理边界 | Gate 自身 `cleanup()` 删除 schema；**测试账号保留**供下一轮使用；**不删除**账号与库定义 |

### 5.6 具体运行方案（**待单独授权后才可执行**）

```powershell
# ① 一次性准备（只写凭据与基线，不创建库/账号）
pnpm test:mysql:local:setup

# ② 逐次明确授权的受保护启动（内含预检身份核对 → 机器级互斥锁 → 才注入 destructive ACK）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:concurrency
```

- 机器级互斥锁：`Global\ModernERP.MySqlGate.<database>`；忙 → 退出码 6。
- 退出码：0 = PASS + CLEANUP CONFIRMED；2 = 预检失败；5 = Gate 通过但清理未确认；6 = 锁忙。
- **必须单独取得授权后才可执行**：本轮**未**执行。

### 5.7 Run ID 与 Commit SHA 绑定（本轮占位）

| 项 | 值 |
|---|---|
| Run ID（建议，UUIDv4） | `m1c-g07-20261103-<uuidv4>`（执行时生成并登记） |
| Target commit SHA | 执行时的 `git rev-parse HEAD`，必须与被验收代码一致 |
| ACK-4 状态 | **NOT_IMPLEMENTED** —— 执行前须先实现并登记，否则**不得**声称满足四重 ACK |

### 5.8 明确禁止的操作

- 连接任何**现有项目** MySQL 数据库；
- 运行 destructive MySQL Gate 而未取得逐次授权；
- 在 MySQL 中创建或删除数据库；
- 执行项目数据库 Migration 与 `M-15`；
- 以手写 SQL 造数替代正向生产通路；
- 自行实现未经批准的高风险数据库行为。

---

## 6. 门禁数字与工作树

### 6.1 门禁

| 命令 | 结果 |
|---|---|
| `node scripts/testing/run-tests.js full --filter m1c` | **124 / 124 PASS**，0 FAIL |
| `node scripts/testing/run-tests.js full --filter wp7a` | **8 / 8 PASS**，0 FAIL（本轮新增套件） |
| `node scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs` | **PASS=16 / FAIL=8 / TOTAL=24**（G05） |
| `pnpm test:fast` | **511 / 511 PASS**，0 FAIL |
| `pnpm test`（FULL） | **3236 / 3236 PASS**，0 FAIL，0 SKIP，0 CANCELLED（基线 3228 + 本轮新增 8；耗时 1151.7 s） |
| `pnpm build` | PASS（`✓ built in 3.78s`） |
| `node scripts/docs/check-doc-consistency.mjs --mode current` | N1 / N3 / N4 / N6 / N8 / N9 **PASS**；N2 **RETIRED**（治理决定，不参与判定）；N5 在补登记 `docs/acceptance/README.md` 后 PASS；N7 在本轮提交后复跑确认 PASS |
| `node scripts/docs/check-doc-consistency.mjs --mode migration` | **C1–C6 全部 PASS** |
| `git diff --check` | PASS |

全部测试经 `scripts/testing/run-tests.js` 运行，进程环境由 `scripts/testing/test-env.js`
净化（`ERP_DB_BACKEND=sqlite`，剔除全部 MySQL 指向变量），**未接触**任何 MySQL 或项目数据库。

### 6.2 工作树与核心实现

本轮**未修改**任何核心实现文件。唯一的临时改动（negative control，位于
`server/modules/financial-inventory.js`）已用 `git checkout --` 完整回退，
`git diff` 对该文件为空。

本轮新增 / 修改的文件仅限验收工具与证据：

- `server/m1c-wp7a-gate-acceptance.test.js`（新增验收套件，登记进 FULL）
- `scripts/testing/test-suites.js`（登记）
- `scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs`（加固既有浏览器验收工具）
- `docs/acceptance/m1-core-wp7a-gate-acceptance-20261103.md`（本文件）
- `docs/status/PROJECT_STATUS.md`（§37.27 登记）
- `log/2026-11-03.md`（当日日志）

### 6.3 最终门禁复跑

见 §6.1 的最终数字，以及 `log/2026-11-03.md` 与 `docs/status/PROJECT_STATUS.md` §37.27 的登记。

---

## 7. 本轮明确未发生的事项

未 Push / Merge / Tag / Release / Deploy；未运行项目数据库 Migration 与 `M-15`；
未连接 MySQL、未运行 MySQL Gate、未在 MySQL 中创建或删除数据库；
未修改 Requirement §31.13、Active Design 正文与任何既有历史验收事实；
未签发 `M1C-G01..M1C-G07` 的 PASS、未签发 M1-Core Acceptance / Domain Closure /
Freeze / Release Readiness；未把 G05 的两个前端缺陷纳入本轮修复
（它们需要独立工作包与用户授权）。
