# M1-Core Active Design 状态指针最小修订记录（`M1C-DESIGN-STATUS-POINTER`，2026-11-07）

> 用途：登记对 Active Design `docs/design/procurement-outsourcing-m1-core.md` §13.1 / §13.3 的一处
> **纯状态指针**修订 —— 把该两处 `execution_status` 全部 `NOT_RUN` 的表述明确为 **Design 获批时的历史快照**，
> 并把**当前**执行与验收状态指回唯一权威 `docs/status/PROJECT_STATUS.md`。
> 本文**不**签发 `Design PASS`，**不**授权 Implementation，**不**签发任何 Gate 或包级 Acceptance。
>
> Owner：Procurement & Outsourcing Domain Owner（Design 修订批准）；Platform（治理一致性）。
>
> 状态：`APPROVED` —— 本轮项目 Owner 在当前对话中**总体授权** ChatGPT 主导 M1-Core 剩余验收推进，并**明确批准**
> 「B-2 Active Design 的三处纯状态指针修订」。该来源为**对话中的 Owner 授权与限定裁定记录**；
> **不存在**虚构的手写签名、电子签章或外部审批单，Owner **亦未**逐条签署独立的审批文件。
>
> 权威来源：Active Design `docs/design/procurement-outsourcing-m1-core.md` §13.1、§13.3；唯一项目状态登记表
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；七 Gate 的正式 Acceptance 证据
> [`docs/acceptance/`](./)。
>
> 本文是验收证据，不取代 Requirement、Active Design 或唯一项目状态登记表。**本文件的生成本身不构成 Git 提交
> 或远端同步。**

---

## 1. 修订动机

| 项 | 内容 |
|---|---|
| Active Design 现状 | §13.1 标题写「`execution_status` 全部 `NOT_RUN`」；§13.1 Gate 表 `execution_status` 列 7 行均为 `NOT_RUN`；§13.3 首条写「7 个 Gate 的 `execution_status` **全部 `NOT_RUN`**；**无任何 PASS**」 |
| 当前实际状态 | `docs/status/PROJECT_STATUS.md` §37.52 登记七 Gate **7 / 7 `PASS`**（附公开有界残余风险），包级仍 `M1_CORE_ACCEPTANCE_BLOCKED` |
| 矛盾 | Active Design 以**现在时**陈述一个已被取代的状态；单独阅读 Active Design 会得出「没有任何 Gate 通过」的相反结论 |
| 治理依据 | AGENTS.md §2.4：全仓库只有 `docs/status/PROJECT_STATUS.md` 是当前项目级进度登记表；§2.1：`docs/design/` 不得写入验收执行流水 |

**为什么不改写 §13.1 表格的 `execution_status` 列**：把 `PASS` 复制进 Design 会同时违反 §2.1 与 §2.4。
正确解法是**指针**：保留 Design 的 Design 时点快照原样，只把「当前状态以谁为准」写清楚。

**为什么不改写文件头部的日期化注记**：那些条目是各次 Design 批准/修订**当时**的如实记录，按 AGENTS.md §2.2
与 §12 **不得追改**。本修订**不触碰**它们。

## 2. 已应用的三处补丁

以下为对 `docs/design/procurement-outsourcing-m1-core.md` 的三处**纯指针性**修改。

### 补丁 1 —— §13.1 标题

```diff
-### 13.1 首期 Gate 定义（7 个；`execution_status` 全部 `NOT_RUN`）
+### 13.1 首期 Gate 定义（7 个；`execution_status` 列为 **Design 批准时点快照**）
```

### 补丁 2 —— §13.1 标题之后新增指针注记

```diff
 ### 13.1 首期 Gate 定义（7 个；`execution_status` 列为 **Design 批准时点快照**）
 
+> **`execution_status` 语义与当前状态权威**：下表 `execution_status` 列记录的是 **Design 批准时点**
+> 的执行状态快照（当时 7 个 Gate 均未执行）。该列**不随 Gate 执行结果更新**，本文件**不复制**
+> Gate 的 `PASS` / `FAIL` 状态，也不承载验收执行流水（AGENTS.md §2.1）。
+> **当前**执行与验收状态以 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 为
+> **唯一权威**；各 Gate 的正式 Acceptance 证据见 [`docs/acceptance/`](../acceptance/)。
+> 七个 Gate 的**业务合同**（前置数据创建方式、证据层、成功断言、拒绝断言、零副作用断言）以下表为准，
+> 不受执行状态影响。
+
 证据层级：`L1` = 生产 API 造数；`L2` = 直接调用领域函数；`L3` = 直接 SQL 造数
 （**不可**作为通路证据）。
```

### 补丁 3 —— §13.3 首条

```diff
-- 7 个 Gate 的 `execution_status` **全部 `NOT_RUN`**；**无任何 PASS**。
+- 7 个 Gate 的 `execution_status` 列记录 **Design 批准时点**的快照（当时全部 `NOT_RUN`）；
+  **当前**执行与验收状态以 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 为
+  **唯一权威**，本文件不复制 Gate 的 `PASS` / `FAIL`。本节其余规则为**执行前置条件**，
+  与当前执行状态无关：任何 Gate 若以手工 SQL 造数替代业务可达性、以延期能力的未裁定状态冒充通过，
+  或未创建/配置委外收货员便把 `M1C-G02` 的**正向**收货生效断言标记通过，
+  都**不得**签发对应能力的 `COVERED`。
```

### 2.1 §13.1 Gate 表（**未改动**）

补丁 1～3 **不修改** §13.1 Gate 表的任何一格：`M1C-G01`～`M1C-G07` 七行的 `前置数据创建方式`、`证据层`、
`成功断言`、`拒绝断言`、`零副作用断言` 与 `execution_status` 列**全部原样保留**。
七个 Gate 的**业务合同不因本次修订发生任何变化**。

## 3. 本修订明确**不做**的事

| 不做 | 理由 |
|---|---|
| 不把 `PASS` / `FAIL` 复制进 Design | AGENTS.md §2.1、§2.4 |
| 不修改七个 Gate 的业务合同 | 本次仅指针性澄清；Gate 的成功/拒绝/零副作用断言与证据层一字不改 |
| 不改写 §13.1 表格 `execution_status` 列的值 | 该列是 Design 时点快照；改写等于把执行状态写进 Design |
| 不改写文件头部的日期化注记 | AGENTS.md §2.2、§12 |
| 不在 Design 内新增第二份状态登记 | AGENTS.md §2.4 |
| 不扩大 Design 的功能或业务范围 | 本次不涉及任何业务合同变更 |
| 不签发 `Design PASS`、不授权 Implementation、不签发任何 Gate 或包级 Acceptance | AGENTS.md §4.3 / §4.5 |
| 不恢复旧 13 Gate 为实施任务 | §13.2 的边界保持不变 |

## 4. 验证要求与结果

| 检查 | 结果 |
|---|---|
| `node scripts/docs/check-doc-consistency.mjs`（current） | `ALL CHECKS PASSED`（N2=`RETIRED`，不参与 PASS/FAIL） |
| `node scripts/docs/check-doc-consistency.mjs --mode migration` | C1～C6 `ALL CHECKS PASSED` |
| `git diff --check` | PASS |
| N7 可追溯 | 提交信息须含 `Docs-Trace: docs/design/procurement-outsourcing-m1-core.md` 与 `Docs-Trace: docs/status/PROJECT_STATUS.md`；N7 对受治理文件按 fail-closed 判定 |

**回归适用性**：本修订与 WP-K-R1 均为**纯文档变更**，`server/`、`src/`、`scripts/` **零改动**。
因此 `83e13e008c851f5a235cb95e6dfa2f08afa0a32b` 上实测的 FULL `3344/3344`、FAST `576/576` 与 Build PASS
**继续适用**，无需为纯文档改动重复执行完整 FULL。SHA 差异与适用性说明见
[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 对应条目。

## 5. 状态迁移

```text
Before : Active Design §13.1 / §13.3 以现在时陈述「全部 NOT_RUN / 无任何 PASS」（与 §37.52 的 7/7 PASS 矛盾）
After  : 同上表述被标注为 **Design 批准时点历史快照**，当前执行状态指向 PROJECT_STATUS.md（唯一权威）
         七个 Gate 的业务合同、execution_status 列值与文件头部日期化注记 **均未改动**
         七 Gate = 7/7 PASS（**不变**）；Package = M1_CORE_ACCEPTANCE_BLOCKED（**不变**）
```

## 6. 未发生

本修订**未**修改 Active Requirement、生产代码、DDL、Fixture、G07 Oracle、G07 合同、测试或任何已签发
Owner Acceptance；**未**连接真实 MySQL、**未**运行 G07、**未**签发或消费 ACK-4、**未**执行
Reset / Bootstrap / Cleanup / Migration；**未** Push / Merge / Tag / Release / Deploy；
**未**恢复旧 13 Gate 为实施任务。
