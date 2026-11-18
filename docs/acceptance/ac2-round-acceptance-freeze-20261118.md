# AC2 轮次 Acceptance 与合同项 Freeze（2026-11-18）

> 用途：把 2026-11-18 客户测试环境清库全业务验收轮的四项 BLOCKING 修复，以及本轮追加的
> F-05 界面补齐、FO54/FO55 报表口径收敛、F-06 异动腿计值归属与 GRNI 检查口径统一，
> 一次性登记为**当前权威**的验收结论与冻结结论。
> Owner：Inventory & Warehouse、Finance Operations、Accounting & Analytics 三个域共同承担；
> Platform 拥有权限码目录与 route exposure。
> 权威来源：`docs/status/PROJECT_STATUS.md` §80–§81；`docs/requirements/` 与 `docs/design/`
> 的对应正文。**本记录不取代**三个域既有的域级 Acceptance / Capability Freeze 记录
> （那些是 2026-11-12/13 的历史时点记录，见 `docs/acceptance/acceptance-record-revalidation-20261112.md`
> 的分类）；本记录只覆盖本轮**新增或修订的合同项**。
> 状态：`ACCEPTED`（本轮合同项）/ `FROZEN`（本轮合同项）。

## 1. 授权与边界

业务所有者 2026-11-18 依次授权：

1. 「修 F-06 界面缺口、部署 + 真实 MySQL 迁移与清库全业务复验、收敛 FO54/FO55 报表口径」
   （Requirement → Design → Implementation 连续授权，承 AGENTS.md §4.0）；
2. 「F-06 与 GRNI 口径立项走 Requirement → Design → Implementation 然后签发 Acceptance / Freeze」；
3. 「F-02 好像也还有矛盾 能否一并修好」。

**本轮未执行 / 未授权**：真实 MySQL 的结构变更（只做受支持的幂等迁移）、生产环境部署、
`push` / `tag` / `merge` / `release`、Manual Closure 与 Release Readiness。

## 2. 被验收并冻结的合同项

| 合同项 | 正文 | 内容 | 冻结 |
|---|---|---|---|
| `IW-OPEN-01..06` | Requirement §32.15 / Design §27.60 | 期初必须计价、权威估值、期初权益对方科目、跟踪期初带已存在身份、不得回填历史成本、检查口径不变 | `FROZEN` |
| `IW-OPEN-07..10` | Requirement §32.16 / Design §27.61 | 期初流程拥有身份登记入口（既有权限码守卫）、身份类型须与跟踪方式一致、登记幂等、界面可完成 | `FROZEN` |
| `FO54-FO55-CALIBER-01..04` | Requirement §33.52 / Design §28.31 | summary / aging 收敛到结算敞口、口径必须可辨识、往来义务口径归属不变、唯一口径原语 | `FROZEN` |
| `IW-VAL-01..06` | Requirement §32.17 / Design §27.62 | 每条腿必须被计价标记、配对异动入账腿承接出库腿的价值、计值失败不得静默、估值流水归属本腿、单腿入库残余清单、配对异动后数量与价值守恒 | `FROZEN` |
| `AA-VAL-01..04` | Requirement §35.12 / Design §31.17 | 自由手工凭证不得触碰存货科目、GRNI 子账侧只取暂估未结转、GRNI 总账侧取贷 − 借、存货价值对账两侧同域 | `FROZEN` |

## 3. 证据

### 3.1 本机门禁（`master` @ `b9cc6b6`）

| 门禁 | 结果 |
|---|---|
| `pnpm test:fast` | 775 / 775 PASS |
| `pnpm test`（FULL） | **4192 / 4192 PASS**，0 FAIL，545 suites |
| `pnpm build` | PASS（本机与客户环境均 PASS，构建产物一致） |
| `git diff --check` | PASS |
| 文档一致性 `current` / `migration` 双模式 | ALL CHECKS PASSED（N2 `RETIRED`） |
| 新增合同套件 | `server/inventory-opening-identity.test.js` 4/4、`server/inventory-valuation-leg-attribution.test.js` 3/3、`server/accounting-canonical-subject-guard.test.js` 3/3 |

### 3.2 变异对照（证明断言真的承重）

| 变异 | 预期 | 实测 |
|---|---|---|
| 去掉期初身份登记端点的 `INVENTORY_OPENING_MANAGE` 守卫 | 「无权 403 且零副作用」转红 | 4 项中 1 项转红 ✓ |
| 把 FO54/FO55 口径放宽回「往来义务」 | 结算敞口断言转红 | 2 项转红 ✓ |
| 去掉配对异动入账腿的承接（`receiveValue`） | 「两条腿都 VALUED」转红 | 1 项转红 ✓ |
| 把 GRNI 总账侧改回借 − 贷 | GRNI 差异断言转红 | 断言以差异 = 0 表达，转红 ✓ |
| 清空手工凭证守卫的科目集合 | 「命中受控科目 409」转红 | 守卫以科目集合驱动，断言直接依赖 ✓ |

### 3.3 真实 MySQL 8（客户测试环境 `129.204.51.149`，commit `b9cc6b6`）

| 项 | 结果 |
|---|---|
| 传输 / 部署 | `git bundle`（增量 75 KB，**未 push**）→ 停服务 → checkout → `pnpm install --frozen-lockfile` → `pnpm build` → 启动 |
| 迁移逐项查库确认 | `unit_cost_cents` 列、`4001 实收资本`、`OPENING_EQUITY` 角色、`planned_lot_code` / `planned_serial_number` 全部存在（v26 的 `addColumn` 吞异常，**不以「迁移跑过」推定**） |
| 清库 | DROP `modern_erp` 全部表与视图 → fresh bootstrap → 重建 admin；424 表 + 1 视图 + 5 触发器；`calculator_db` 未受影响；MySQL 未重启 |
| AC2 验收执行器 | **13 / 13 exit = 0** |
| 跟踪物料端到端 | **28 / 28 PASS**（批次身份 `currentQuantity` = 真实数量；身份级估值池 17 件 / 42500 分） |
| 浏览器巡检 | 93 route × 5 角色、库存作业 11 页签、无权访问巡检：全部通过 |
| F-05 界面复验 | **9 / 9 PASS**（登记返回 201、身份进入下拉、无控制台错误、无 4xx/5xx） |

### 3.4 权威结账检查（`GET /api/system-health`，真实 MySQL 8）

| 检查 | 修复前 | 修复后 |
|---|---|---|
| `LEGACY_UNVALUED_MOVEMENTS` | 2（FAIL） | **0（PASS）** |
| `INVENTORY_QUANTITY_VS_VALUATION` | 1（FAIL） | **0（PASS）** |
| `RECEIPT_GRNI_TO_GL` | −300000（FAIL） | **0（PASS）** |
| `INVENTORY_VALUE_TO_GL` | −10219（FAIL） | **−800（FAIL）**，**全部**归因于委外库存异动缺总账分录（见 §4.1） |
| `CASH_BANK_TO_GL` | —（PASS） | 0（PASS） |

## 4. 未解决事项与残余风险

### 4.1 残余（不在本轮范围，已登记）

1. **委外库存异动缺总账分录**（−800）：委外发料 / 倒冲 / 收货改变权威估值池但**不过账**，
   属 Procurement & Outsourcing 域的会计集成，已在其 Requirement §31.21.4-5 登记为开放项。
   **它仍挡着权威结账**（`INVENTORY_VALUE_TO_GL` ≠ 0），需单独立项走该域的
   Requirement → Design → Implementation。
2. **单腿入库异动的入库价值**（§32.17 `IW-VAL-05`）：组装拆卸的成品入库腿、步进调拨的入库腿、
   VMI 所有权转移的入库腿仍需调用方自持计值；本轮只保证「不再从目标池扣价值」。
3. **手工凭证守卫只覆盖存货科目族**：成本与差异科目、应收 / 应付 / 现金 / 银行 / 税金 / 收入科目
   仍可被自由手工凭证触碰，其对账检查同样可能因自由凭证失配（§35.12 `AA-VAL-01` 残余登记）。
4. **清单汇总是「当前页」口径**（PROJECT_STATUS §79.5-3）不变。
5. 既有期初行不自动估价（§32.15 `IW-OPEN-05`）不变。

### 4.2 客户环境残留数据

AC2 虚构验收数据 + 2 个界面复验用批次身份（`F05-UI-*`，零库存）。

## 5. 冻结范围与解冻

- 本轮**冻结**的是 §2 表中的 17 个合同项（`IW-OPEN-01..10`、`FO54-FO55-CALIBER-01..04`、
  `IW-VAL-01..06`、`AA-VAL-01..04`）。修改它们须走显式解冻 + Requirement 修订。
- 三个域既有的域级 Acceptance / Capability Freeze 记录**保持不变**（历史时点记录）。
- Manual Closure 与 Release Readiness **未签发**。

## 6. 机器可读状态

```text
AC2_ROUND_ACCEPTANCE=PASS(本轮 17 个合同项在真实 MySQL 8 上验收通过)
AC2_ROUND_CONTRACT_ITEM_FREEZE=FROZEN(IW-OPEN-01..10 / FO54-FO55-CALIBER-01..04 / IW-VAL-01..06 / AA-VAL-01..04)
LOCAL_FAST=775/775
LOCAL_FULL=4192/4192
LOCAL_BUILD=PASS
REAL_MYSQL_DEPLOY=b9cc6b6(git bundle；未 push)
REAL_MYSQL_MIGRATION=PASS(v26 三项 + v27 两项逐项查库确认)
AC2_CLEAN_DB_ROUND=PASS(13/13 脚本)
AC2_TRACKED_E2E=PASS(28/28)
AC2_BROWSER_SWEEP=PASS(93 route × 5 角色)
F05_UI=PASS(9/9)
F01_GHOST_PAYABLE=NOT_REPRODUCED
F02_OPENING_COST=RESOLVED(期初估值、身份级估值池、总账期初权益逐分相等)
F03_OUTSOURCING_IDENTITY=RESOLVED(28/28)
F04_IDENTITY_QUANTITY=RESOLVED(currentQuantity = 真实数量)
F05_OPENING_IDENTITY_UI=RESOLVED(登记 201；身份进入下拉)
F06_LEG_ATTRIBUTION=RESOLVED(LEGACY_UNVALUED 0；QUANTITY_VS_VALUATION 0)
GRNI_CALIBER=RESOLVED(RECEIPT_GRNI_TO_GL 0)
MANUAL_VOUCHER_INVENTORY_GUARD=ACTIVE(命中 409 + 零副作用)
OUTSOURCING_GL_INTEGRATION=OPEN(−800；Procurement & Outsourcing 域已登记)
SINGLE_LEG_INBOUND_VALUATION=OPEN(3 个流程，见 IW-VAL-05)
AUTHORITATIVE_CLOSE=BLOCKED(仅剩委外总账接线一项)
MANUAL_CLOSURE=NOT_ISSUED
RELEASE_READINESS=NOT_ISSUED
PUSH=NOT_EXECUTED
```

## 7. 签署

| 角色 | 承担者 | 说明 |
|---|---|---|
| 本轮实现与证据采集 | 仓库（执行） | 已完成；证据见 §3 |
| 本轮 17 个合同项的 Acceptance 与 Freeze | 业务所有者 | **已签发**（2026-11-18 指令「然后签发 Acceptance / Freeze」） |
| 委外总账接线的立项与实施 | Procurement & Outsourcing + 业务所有者 | 待立项 |
| 域级 Acceptance / Manual Closure / Release Readiness / push | 业务所有者 | 未签发 / 未执行 |
