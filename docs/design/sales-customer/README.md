# Sales & Customer — 当前权威 Design

> 状态：`ACTIVE` —— 本目录是 Sales & Customer Domain **唯一的当前有效技术设计正文**
> Owner：Sales & Customer
> 权威来源：本文件；全局架构合同见 [`solution.md`](../../../solution.md)，导航见 [`docs/design/README.md`](../README.md)
> 对应 Requirement：[`docs/requirements/sales-customer/`](../../requirements/sales-customer/)
> 验收与冻结证据：[`docs/acceptance/sales-customer/`](../../acceptance/sales-customer/)
> 被取代的历史设计修订：[`docs/archive/design/sales-customer/`](../../archive/design/sales-customer/)

## 1. 当前有效设计正文

| 文件 | 原章节 | 内容 | 基线状态 |
|---|---|---|---|
| `01-domain-technical-design.md` | §29 | Domain Technical Design 基线（5,141 行） | `ACTIVE`（§36 在其与 §30 冲突处以 §36 为准） |
| `02-wave-plan.md` | §30 + §30.26 | Domain Implementation Wave Plan 与最终摘要 | `ACTIVE`（计划文本，冲突处以 §36 为准） |
| `03-wave-8-baseline.md` | §35.18–§35.19、§35.22–§35.24、§35.27 | Wave 8 冻结技术基线 | `FROZEN`（§35.27：§35.18–§35.26 构成 Wave 8 最终接受技术基线） |
| `04-wave-9-credit-baseline.md` | §36 + §36.16 | Sales Credit Stage C Combined Design Reconciliation | `FROZEN`（§36.16：§36.0–§36.15 构成 Wave 9 冻结技术基线；§36 自述为 Waves 9–11 的**唯一 Active Design 层**） |
| `05-wave-11-stage-c.md` | §37.54 | Wave 11 Credit Evaluation / Reconciliation / Query Stage C Design Closure | `ACTIVE`（Wave 11 Stage C 设计闭合，U1/U2/U3 单元级已冻结） |

## 2. 基线优先级规则

1. §36 自述为 **Sales Credit Waves 9–11 的唯一 Active Design 层**；与 §29 / §30 冲突时以 §36 为准。
2. §37.54 是 Wave 11 的 Stage C 设计闭合，覆盖 U1/U2/U3；其单元级 Acceptance 与 Freeze 记录在
   [`docs/acceptance/sales-customer/`](../../acceptance/sales-customer/)。
3. §35.27 声明 §35.18–§35.26 构成 Wave 8 最终接受技术基线；本目录的 `03-wave-8-baseline.md`
   承载该区间的**当前有效**部分（§35.18–§35.19、§35.22–§35.24、§35.27）。
4. §35.24 自述为「§35.23 的 active correction layer」，只在 §35.23 的限定范围内取代 §35.23。
5. 上述以外的历史设计修订**已归档**，不得与本目录正文并列宣称当前权威。

## 3. 已归档的历史设计修订

| 归档文件 | 原章节 | 内容 | 处置 |
|---|---|---|---|
| [`docs/archive/design/sales-customer/wave-8-stage-c-design-closure.md`](../../archive/design/sales-customer/wave-8-stage-c-design-closure.md) | §35（§35.0–§35.17） | Wave 8 Stage C 早期修订轮次 | `SUPERSEDED`（被 §35.27 取代；§35.18–§35.19 已移入当前基线） |
| [`docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md`](../../archive/design/sales-customer/wave-10-and-boundary-design-amendments.md) | §37.0–§37.51、§37.53（设计部分） | W7-C1/C2′ 有界修订、W10 各轮设计修订与独立复核更正、Package B 测试隔离设计 | `SUPERSEDED`（结论已并入 §37.52 Wave 10 Capability Freeze 与 §37.54） |

> 归档文件中的结论**在其自身日期为真**。§37.52 的冻结声明引用 `solution.md §37.40.8` 的
> canonical-writer 合同，该子节正文保留在
> [`docs/acceptance/sales-customer/wave-10-implementation-records.md`](../../acceptance/sales-customer/wave-10-implementation-records.md)
> （§37.40 为实施记录），**锚点未丢失**，可继续定位。

## 4. 尚未纳入本目录的设计

- **W11-B / W11-C / W11-D** 的 Design **尚未形成**（`NOT_STARTED`）；开放设计决策 `D-2`/`D-3`/`D-4`/`D-5`
  见 `PROJECT_STATUS.md` §35.9。
- **Accounting & Analytics** 与 **Platform** 尚无 Domain Technical Design。

## 5. 迁移说明

本目录正文自 `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71` **逐字迁移**，
原章节编号**原样保留**，因此 `solution.md §29`、`§35.24`、`§36.1`、`§37.54.48` 等深引用继续有效。
逐章节映射见 [`docs/status/MIGRATION-MAP.md`](../../status/MIGRATION-MAP.md)。
