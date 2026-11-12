# XDC-01 —— 跨域错误码耦合治理（2026-11-12）

> **决策 ID**：`XDC-01`
> **归属**：Platform（治理）／各 Domain Owner（自己域内的判定）
> **状态**：`APPROVED`
> **规范来源锚点**：[`AGENTS.md`](../../AGENTS.md) §6（代码规则）与 §4.5（验收）；守卫实现 `scripts/qa/verify-error-code-coupling.mjs`。
> **不授权**：任何 Implementation、发布、部署或远端 Git 操作。

## 1. 背景

域级验收审计发现一处真实的跨域耦合：Sales 域**已签发**的 Wave 7 行为（`SALES_RESERVATION_EXPECTED_BOUNDED_EXTENSION_REQUIRED`）依赖 Planning 域的**内部**错误码（`PLANNING_EXPECTED_FINITE_SOURCE_REQUIRED`）—— Sales 把 Planning 的拒绝翻译成自己的对外错误码。Planning 合法地按自己的 Requirement §30.2 PL-31 实现了该能力（人工预留的有界 expected supply）之后，Planning 不再产生那个错误码，**Sales 已签发的验收结论被击穿**。

结论：**一个域的内部错误分类不是跨域合同**。把它当成合同来依赖，就会让任何一个域的合法变更击穿另一个域的已签发结论。

## 2. 决定

跨域错误码耦合按三类处理：

| 类别 | 定义 | 处置 |
|---|---|---|
| `DECISION` | 消费方用生产方的错误码做**自己的业务判断** | **必须消除**：消费方在自己的模块内自包含地判定，不依赖生产方的错误分类 |
| `CONTRACT_TRANSLATION` | 消费方只把生产方的明细翻译成自己的对外错误码，不用它做业务判断 | **允许**，但必须在守卫脚本的登记表里显式登记理由；生产方改该码属**跨域合同变更**，须回到生产方的 Requirement / Design 裁定 |
| `FRONTEND_CONTRACT` | 前端按后端错误码分支 | **允许**，同样必须登记；后端改码必须同时改前端 |

此外：**引用一个生产代码中已不存在的错误码是死引用，一律 FAIL。**

## 3. 强制要求

1. 新增或修改任何跨域错误码耦合，必须同步更新
   `scripts/qa/verify-error-code-coupling.mjs` 的 `APPROVED_COUPLINGS` 登记表，并写明理由。
2. `DECISION` 类耦合在登记表中**不被接受** —— 必须先在消费方模块内自包含地判定。
3. 守卫必须纳入常规门禁：未登记的耦合或死引用会让门禁失败。
4. 域级验收审计必须把「本域错误码是否被其他域 catch 并翻译」列为**必查项**。

## 4. 本决策生效时已完成的动作

| 动作 | 说明 |
|---|---|
| 消除死引用 | `server/modules/sales-reservation-intent.js` 不再 catch `PLANNING_EXPECTED_FINITE_SOURCE_REQUIRED`；EXPECTED 的判定改为在 Sales 模块内自包含地做出，**已签发的行为与错误码逐字不变** |
| 登记既有耦合 | `PLANNING_RESERVATION_CAPACITY_EXCEEDED`（Sales ← Planning）登记为 `CONTRACT_TRANSLATION`：Planning 是预留容量计算的唯一 owner，Sales 只翻译明细 |
| 登记前端耦合 | `PERMISSION_DENIED`（前端 ← `server/lib/http.js`）登记为 `FRONTEND_CONTRACT` |
| 建立守卫 | `scripts/qa/verify-error-code-coupling.mjs`：全量扫描生产代码（322 个文件），输出「已登记 / 未登记 / 死引用 / 驱动级」四类清单；**当前结果：已登记 2 / 未登记 0 / 死引用 0** |
| 变异实验 | 注入一处未登记耦合后守卫按预期返回非零退出码并指出该耦合；移除后恢复通过 |

## 5. 停止点

本决策只治理**错误码耦合**。它不改变任何业务语义、不关闭任何已签发结论、不构成任何域的 Acceptance。

下一次触发复核的时机：新增跨域错误码消费，或守卫登记表发生变化。
