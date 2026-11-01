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

> 本节只描述**导航与效力判定**，不修改任何合同正文。规则依据是合同自身的声明：
> `§36.0`（自述为 Sales Credit Waves 9–11 的单一 Active Design 层）、
> `§37.54.1`（Wave 11 Stage C 的授权与适用范围）与
> `§37.54.4`（G-1…G-12 逐条取代关系表）。

1. **§36 仍然有效，未被整体废止。** `§36.0` 自述 §36 是 Sales Credit Waves 9–11 的
   **单一 Active Design 层**；与 §29 / §30 冲突时以 §36 为准。
2. **取代关系的唯一来源是 `§37.54.4`。** 该表逐条给出
   「旧 Design 精确位置 → 新 Requirement 精确位置 → 处置 → 兼容性 / 历史证据影响」。
   取代**范围严格等于该表**，不得自行扩大或缩小。
3. **G-1 与 G-2 是有界取代**（仅此两条）：
   - **G-1**：`DETERMINISTIC_REBUILD` 枚举被**退役**（retired），不是被重新定义；
     新 kind 为 `DETERMINISTIC_RECALCULATION`（§37.54.6）。历史设计文本保持原样不改写。
   - **G-2**：`§36.7.5` 在 **Wave 11 范围内**被 §37.54 **有界取代**。
   除这两条指定的条款外，§36.7.5 的其余内容仍按 §36 执行。
4. **G-3…G-12 不是取代。** 它们的处置是「一致」「一致并加强」「细化」「CORRECTION-2 已修订」——
   即 §37.54 **确认或细化** §36 的既有合同，**不废止** §36 对应条款
   （G-5、G-8、G-9 标注「一致」/「一致并加强」，G-11 标注「细化」，G-12 标注「CORRECTION-2 已修订」）。
5. **`§37.54.4` 的真实位置**：
   [`05-wave-11-stage-c.md`](./05-wave-11-stage-c.md) 的 `### 37.54.4`。
   该表「旧 Design 精确位置」列使用的是 `solution.md:NNNN` **历史行号**，
   必须按 [`docs/status/MIGRATION-MAP.md`](../../status/MIGRATION-MAP.md) §4 的历史引用解析规范定位，
   不得按新文件行号直接理解。
6. **§35.27 声明** §35.18–§35.26 构成 Wave 8 最终接受技术基线；本目录的 `03-wave-8-baseline.md`
   承载该区间的**当前有效**部分（§35.18–§35.19、§35.22–§35.24、§35.27）。
7. **§35.24 自述**为「§35.23 的 active correction layer」，只在 §35.23 的限定范围内取代 §35.23。
8. **上述以外的历史设计修订已归档**，不得与本目录正文并列宣称当前权威。

## 3. 已归档的历史设计修订

| 归档文件 | 原章节 | 内容 | 处置 |
|---|---|---|---|
| [`docs/archive/design/sales-customer/wave-8-stage-c-design-closure.md`](../../archive/design/sales-customer/wave-8-stage-c-design-closure.md) | §35（§35.0–§35.17） | Wave 8 Stage C 早期修订轮次 | `SUPERSEDED`（被 §35.27 取代；§35.18–§35.19 已移入当前基线） |
| [`docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md`](../../archive/design/sales-customer/wave-10-and-boundary-design-amendments.md) | §37.0–§37.51、§37.53（设计部分） | W7-C1/C2′ 有界修订、W10 各轮设计修订与独立复核更正、Package B 测试隔离设计 | `SUPERSEDED`（结论已并入 §37.52 Wave 10 Capability Freeze 与 §37.54） |

> 归档文件中的结论**在其自身日期为真**。§37.52 的冻结声明引用 `solution.md §37.40.8` 的
> canonical-writer 合同，该子节正文保留在
> [`docs/acceptance/sales-customer/wave-10-implementation-records.md`](../../acceptance/sales-customer/wave-10-implementation-records.md)
> （§37.40 为实施记录），**锚点未丢失**，可继续定位。

## 4. W11-B / W11-C / W11-D 的设计状态

三个工作包的 Design **已经形成**（Wave 11 Stage C Design Closure，§37.54），但**尚未取得用户批准**，
且**尚未实施**。三者不得与「设计未形成」混同。

| 工作包 | Design 正文位置 | Design 状态 | Implementation | Acceptance / Freeze |
|---|---|---|---|---|
| W11-B | `05-wave-11-stage-c.md` §37.54.9 | Stage C 已形成，状态 `WAVE11_STAGE_C_DESIGN_READY` → `WAVE11_STAGE_C_BOUNDED_CORRECTION_READY`（**待外部签收，未批准**） | 未开始 | 无 |
| W11-C | `05-wave-11-stage-c.md` §37.54.10 | 同上 | 未开始 | 无 |
| W11-D | `05-wave-11-stage-c.md` §37.54.11 | 同上 | 未开始 | 无 |

- 开放设计决策 `D-2` / `D-3` / `D-4` / `D-5` **仍然开放**，阻塞 W11-B 与 W11-C（见 `PROJECT_STATUS.md` §35.9）。
- 「未实施」的权威记载是 `PROJECT_STATUS.md` §35.5。

状态词表：`Design 已形成（待签收）` ≠ `Design 已批准` ≠ `已实施` ≠ `已验收冻结`。

## 4.1 其他尚无设计的能力

- **Accounting & Analytics** 与 **Platform** 尚无 Domain Technical Design。

## 5. 迁移说明与历史引用解析

本目录正文自 `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71` **逐字迁移**，
原章节编号（`§29`、`§35.24`、`§36.1`、`§37.54.48` 等）**在目标文件中原样保留**。

**但迁移前的根文件路径不再保有对应章节正文**：`solution.md` 已从 40,715 行缩到 1,201 行，
§29、§30、§35、§36、§37 等章节已迁入本目录。引用这些章节时必须指向上表的新文件，
不能沿用 `solution.md §29` 这样的根文件路径。

历史行号引用（`solution.md:NNNN`）与章节路径引用的解析规范见
[`docs/status/MIGRATION-MAP.md`](../../status/MIGRATION-MAP.md) §4，也可直接执行：

```bash
node scripts/docs/resolve-reference.mjs "solution.md §29"
node scripts/docs/resolve-reference.mjs "solution.md:12607"
```

逐章节映射见 [`docs/status/MIGRATION-MAP.md`](../../status/MIGRATION-MAP.md)。
