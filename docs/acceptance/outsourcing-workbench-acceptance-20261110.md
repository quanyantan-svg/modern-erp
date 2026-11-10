# 委外核心执行工作面有界 Acceptance 与冻结记录（2026-11-10）

> 用途：登记业务所有者对委外核心执行工作面 `OUT-WB-REQ-01..08` 的最终有界 Acceptance、Requirement / Design 批准及工作面冻结决定。
>
> Owner：Procurement & Outsourcing Domain Owner（合同批准、验收与冻结决定）；Platform / QA（证据维护）。
>
> 状态：`FROZEN` —— 业务所有者于 2026-11-10 明确确认本阶段已完成验收，并要求完成最后的合同批准、冻结产物与委外工作面 Acceptance 登记。
>
> 权威来源：Requirement [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.15；Design [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.35；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §45.34。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
OUTSOURCING_WORKBENCH_ACCEPTANCE_PASS_FROZEN
```

## 1. Owner 决定与冻结边界

业务所有者在本次对话中确认「委外这一阶段已经完成验收」，并要求继续完成最后的合同批准、冻结产物及委外工作面 Acceptance 登记。据此作出以下决定：

| 项 | 决定 |
|---|---|
| Requirement | §31.15 `OUT-WB-REQ-01..08` 批准并冻结 |
| Design | §26.35 批准并冻结 |
| Acceptance | 委外核心执行工作面 `PASS` |
| 冻结标识 | `OUTSOURCING_WORKBENCH_ACCEPTANCE_PASS_FROZEN` |
| 实现锚点 | `df43d2a9b75bb88edf886f06d50445fba6da25ea`；G07 RESET 生命周期修复 `719767f39ebb256e91cc9c1d9eefb81bfc0a5965` |
| Fixture 冻结产物 | `M1_CORE_G07_FIXED_FIXTURE_DIGEST = 60f7888f1d52f6858d8eaca458ede077ab454445c51743b7004bd864767ac2fb` |

决定来源是当前对话中的 Owner 明确指令；不存在虚构的手写签名、电子签章、外部审批单或当前 HEAD 的真实 MySQL 重跑记录。

冻结范围仅包含 §31.15 / §26.35 的三岗委外工作面、受限读模型、OUTSOURCE 通知来源级授权、精确订单流转动作、事务内权威重读、材料快照时序、业务日期资格校验及完工/关闭事实门禁。该冻结不扩展为 B3121 Capability Freeze、Procurement & Outsourcing Domain Acceptance、Manual Closure、Release Readiness、Release 或 Deploy。

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| focused | `server/outsourcing-workbench.test.js` **16/16 PASS** |
| FAST | **631/631 PASS** |
| FULL | **3462/3462 PASS**（0 fail / 0 cancelled） |
| HEAVY | **67/67 PASS** |
| Build | PASS |
| 浏览器 UAT | **32/32 PASS**；三岗工作面、direct URL / refresh / Back / Forward、320 / 390 / 430 / 680 CSS px、普通采购通知 403、IQC canonical 单据链均纳入实测 |
| Git / 版本 | `master`；实现提交 `df43d2a`，生命周期修复 `719767f`；`package.json` `1.6.2`；release tag 未变化 |

上述结果来自 `docs/status/PROJECT_STATUS.md` §45.33 与 `log/2026-11-10.md` 的实施期实测登记。本文件只固定这些已存在的证据，不伪造新的测试执行。

## 3. 随 Acceptance 一并保留的公开限制

1. 当前 HEAD 未执行受保护 disposable MySQL Gate；SQLite、浏览器与离线回归证据不构成当前工作面真实 MySQL 行为证明。
2. 2026-11-09 的 OUT-001 真实 MySQL **34/34 PASS** 继续只锚定其固定候选与旧 Fixture；不得自动延伸为当前 HEAD 或新 digest 的 PASS。
3. 新 digest 已按 Owner 决定作为合同一致的静态 Fixture 产物冻结，但未签发新的 ACK-4、RunId 或 G07 真实 MySQL PASS。
4. 文档一致性 N7 的既有历史提交消息追溯债务保持开放；不得把本次冻结描述为 N7 已修复。
5. 跨期 WIP 成本携带、复杂倒冲差异生效、部分期初、委外来源账单正式 AP/GL 过账、委外成品退货及 OUT-20 / OUT-22 / OUT-23 仍在本次范围外。

业务所有者以本次最终登记指令接受上述证据限制作为此有界工作面 Acceptance 的公开边界；接受不等于这些限制已被证明、消除或豁免后续真实缺陷整改。

## 4. 不授予事项与后续变更

- `docs/status/CAPABILITY_MATRIX.md` 的 B3121 保持 `BLOCKED`；
- 不签发 B3121 Manual Capability Closure、完整采购委外 Domain Acceptance 或 Release Readiness；
- 不授权数据库写入、Migration、Push、Merge、Tag、Release 或 Deploy；
- §31.15 / §26.35 后续业务语义变更必须显式解冻并重新进入 Requirement → Design → Implementation → Acceptance 流程。

**最终状态：`OUTSOURCING_WORKBENCH_ACCEPTANCE_PASS_FROZEN`。**
