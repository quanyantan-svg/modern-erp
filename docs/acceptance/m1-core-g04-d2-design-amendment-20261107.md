# M1-Core G04 D-2 Active Design 修订记录（2026-11-07）

> 用途：登记 `M1C-G04-D2` Design-only 裁定及其向 Active Design §13.1 的精确融合。
> Owner：Procurement & Outsourcing Domain Owner（Design 裁定）；Platform / Database Safety / QA（证据维护）。
> 状态：`APPROVED` —— D-2 Design Amendment 已批准并融合；`M1C-G04` Gate 仍为 `INCONCLUSIVE`。
> 权威来源：Domain Owner 于 2026-11-07 的明确裁定；Active 权威正文仅位于
> `docs/design/procurement-outsourcing-m1-core.md` §13.1。本文是批准与修订记录，不是第二份 Active Design，
> 也不替代唯一项目状态登记 `docs/status/PROJECT_STATUS.md`。

## 1. 批准事实与范围

Domain Owner 批准 `M1C-G04-D2 DESIGN_AMENDMENT_APPROVED`，仅允许澄清 G04 可达性与测试证据层级：

- 保留 `incremental < 0` 与净供应不足的现有 409 守卫；
- 保留首期严格支持范围、事务内权威重读、业务事实零变化和拒绝审计恰一；
- 明确合法 L1 HTTP 可构造净供应不足，负增量由带标记 L3 历史异常种子 + 生产 Handler 证明防御性 fail closed；
- 不把 L3 异常数据种子冒充合法 L1 正向造数；
- 不修改 G04 成功语义、成本、物理腿、库存、估值、幂等、权限、SOD 或审计合同。

本批准不等于 `M1C-G04 PASS`，不授权 Implementation、生产代码、DDL、Migration、MySQL、ACK-4 或远端操作。

## 2. Active Promotion 与 Supersession 映射

| 原始合同位置 | 来源 SHA | 后继 Active 位置 | 修订性质 |
|---|---|---|---|
| `docs/design/procurement-outsourcing-m1-core.md` §13.1，`M1C-G04` 原拒绝断言 | `46002020a19e221224cec07f8730ed5c16a2f76c` | 同文件 §13.1、同 Gate ID；增加 `M1C-G04-D2` 限定注释 | 仅对“合法绝对不可达”式证据解释作局部 Supersession；不取消 409 |

Active Design 现区分：

1. `incremental > remaining + 1e-9`：合法 L1 HTTP 可达，409 `OUTSOURCING_WIP_INSUFFICIENT`；
2. `incremental < 0`：在已批准不变量成立时未发现合法 L1 HTTP 构造路径，但不是形式化不可达证明；
   D-1/D-1-C 仅以 L3 历史异常种子证明生产 Handler 的防御性 409、业务事实零变化和拒绝审计恰一；
3. BOM 快照／基数不受支持：继续 409 `OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED`。

## 3. 保留的不变量与残余假设

- 已生效收货状态单向迁移，累计有效收货不被合法回改或删除；
- BOM snapshot 的 per-unit 基数与订单总量在执行期冻结，不支持基数 fail closed；
- `backflushed_quantity` 仅由合法正增量写入，事务内重读权威状态；
- 不同 Mutation Key 的并发正确性不能仅由 `inventory_mutation_log.idempotency_key UNIQUE` 推导；
- 浮点负残差仅完成有限枚举，不宣称数学上不可能；
- 未执行真实历史库存异常行审计，不宣称历史库不存在 `backflushed_quantity > targetCumulative`。

## 4. Gate 与执行边界

- `M1C-G04 = INCONCLUSIVE`，D-2 批准不构成 Gate PASS。
- G07 已签发 PASS 的历史事实不变；其 CR-07/08 仅作为已真实执行的 MySQL 竞争子集证据。
- 未修改 Requirement、生产代码、测试、DDL、Fixture、G07 Oracle 或 Owner Acceptance。
- 未授权或执行 MySQL、ACK-4、Migration、Push、Merge、Tag、Release 或 Deploy。

```text
M1C-G04-D2 DESIGN_AMENDMENT_APPROVED
```
