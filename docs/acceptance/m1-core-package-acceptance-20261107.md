# M1-Core 首期包级 Acceptance 正式记录（2026-11-07）

> 用途：登记业务所有者对 **M1-Core 首期包**的正式包级 Acceptance 决定，签发
> `M1_CORE_ACCEPTANCE_PASS`（附有界残余风险），并逐条固定批准范围、限制条件与不授予事项。
> 本文**不**签发 Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、
> Release 或 Deploy。
>
> Owner：业务所有者（正式包级 Acceptance 决定与残余风险接受）；Platform / Database Safety / QA（证据维护）。
>
> 状态：`APPROVED` —— 业务所有者于 2026-11-07 在当前对话中**明确选择选项 A**，正式批准 M1-Core 首期
> 包级 Acceptance，决定为 `ACCEPT_WITH_BOUNDED_RESIDUAL_RISK`，并逐条列出批准范围与条件（见 §2）。
> 该来源为**对话中的 Owner 决策记录**；**不存在**虚构的手写签名、电子签章或外部审批单。
>
> 权威来源：Active Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5；Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §13.1、§13.1.2、§13.1.3、§13.2；唯一项目状态登记表
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；七 Gate 正式 Owner Acceptance、
> WP-K 裁定与 WP-K-R1 裁定（索引见 [`README.md`](./README.md)）。
>
> 本文是验收证据，不取代 Requirement、Active Design 或唯一项目状态登记表。**本文件的生成本质不构成
> Git 提交或远端同步。**

---

## 1. Owner 决定

```text
M1_CORE_ACCEPTANCE_PASS
M1_CORE_ACCEPTANCE_PASS_WITH_BOUNDED_RESIDUAL_RISK
```

决定性质：`ACCEPT_WITH_BOUNDED_RESIDUAL_RISK` —— **有界残余风险接受**。

**M1-Core 首期包级 Acceptance 已签发**，且**仅**覆盖本文件 §3 界定的 M1-Core 首期七 Gate 范围。
本决定**不得**被扩大解释为整个 Procurement & Outsourcing Domain 已完成、已验收或已冻结。

## 2. 业务所有者逐条批准的范围与条件

业务所有者在当前对话中明确规定以下六项，本记录**逐条**承接：

| # | 批准内容 |
|---|---|
| 1 | 正式接受 M1-Core 首期七项 Gate（`M1C-G01`～`M1C-G07`）的包级验收结果，**七项 Gate 原有 `PASS` 状态保持有效** |
| 2 | 正式接受候签记录中 **R-01～R-20** 所列的全部跨 Gate 有界残余风险；明确这些风险属于**尚未充分证明或已知限制**，**不得**在后续文档中描述为已证明或已消除 |
| 3 | **D-01～D-04 继续保持延期、未授权状态**，**不视为**本次验收已交付能力 |
| 4 | 继续执行库存、跟踪、估值、财务及历史数据安全约束；发现实际业务数据不一致、库存错误、成本错误、越权或数据损坏时，**必须停止受影响业务路径并进行整改**，**不得**以本次风险接受记录豁免真实缺陷 |
| 5 | 本次 Acceptance **不授予** Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、Release 或 Deploy 权限 |
| 6 | 旧 M1 13 Gate 全范围 Design **不恢复**为当前实施和验收要求；后续延期能力根据实际产品需求**独立评估和授权** |

## 3. 验收范围（**仅** M1-Core 首期七 Gate）

| 项 | 内容 |
|---|---|
| 验收对象 | **M1-Core 首期包**（Procurement & Outsourcing，`M1C-G01`～`M1C-G07` 七个 Gate） |
| 七 Gate 状态 | **7 / 7 `PASS`**，各附公开有界残余风险 —— **保持有效，不因本决定改变** |
| 覆盖的业务合同 | 七 Gate 的成功断言、拒绝断言，以及「**业务**事实逐字段零变化 + 拒绝审计**恰好 1 条**」零副作用合同 |
| 已证明项 | 候签记录 [`m1-core-package-acceptance-candidate-20261107.md`](./m1-core-package-acceptance-candidate-20261107.md) §2 的 P1–P12 |
| 已接受的残余风险 | 同记录 §3 的 **R-01～R-20**（R-01～R-17 各 Gate Owner Acceptance 已逐项接受；R-18 已由 WP-K 接受；R-19／R-20 已由 WP-K-R1 接受）—— 本记录**引用**该清单，不复制其正文 |
| 证据基线 | `dadca3de69ac5060046db388fb2a0504d42ab7c2`（B-1／B-2 落地提交）；回归锚点 `83e13e008c851f5a235cb95e6dfa2f08afa0a32b` |

### 3.1 残余风险的引用纪律（条件 2 的固化）

R-01～R-20 全部属于**尚未充分证明**或**已知限制**。在**任何**后续文档、状态登记、能力矩阵、
Capability Freeze 材料或发布说明中：

- **不得**将 R-01～R-20 描述为**已证明**；
- **不得**将 R-01～R-20 描述为**已消除**；
- **不得**以本包级 Acceptance 反推任何单条残余风险已被关闭；
- 引用时须保留其原始范围与边界（尤其 G01 双引擎等价未证明、Schema Parity ≠ 行为 Parity、
  G03 四事件真实 MySQL 未重演、G04 败方零副作用与暂估成本、G07 Oracle 测量强度与逐项 TAP 未持久化）。

### 3.2 延期未授权项（条件 3 的固化）

D-01（WP-I）、D-02（WP-J）、D-03（M-15）、D-04（旧 13 Gate 的 6 项 `DEFERRED` 与 9 项 RACE）
**继续保持延期、未授权**，**不构成本包已交付能力**。其状态与后续授权条件见候签记录 §3.4。

## 4. 安全与整改约束（条件 4 的固化）

本次风险接受**不豁免任何真实缺陷**。在 M1-Core 首期已交付范围内：

- 库存、跟踪、估值、财务与历史数据的既有安全约束**继续全部执行**，本次 Acceptance **不放松**任何一项；
- 一旦发现实际业务数据不一致、库存错误、成本错误、越权或数据损坏：
  **立即停止受影响业务路径**并按 AGENTS.md §16 与 §4.4～§4.5 进行整改，
  **不得**以本 Acceptance 或任一残余风险接受记录作为豁免依据；
- 整改完成后应**重新评估受影响 Gate 的验收状态**，不得默认既有 `PASS` 自动延续到受影响范围之外。

## 5. 明确**不**授予的事项（条件 5 的固化）

| 不授予 | 说明 |
|---|---|
| Capability Freeze | 需另行裁定；本包级 Acceptance **不自动** Freeze 任何 Capability |
| Domain Acceptance | **不得**据此认为 Procurement & Outsourcing Domain 已完成 |
| Manual Closure | 需另行裁定与对应 Manual 的覆盖矩阵 |
| Release Readiness / Release / Deploy | **未授权**；Gate PASS ≠ 生产发布许可 |
| 新增 Run ID、ACK-4、数据库写操作 | **未**授予；历史 Run `b29c3f1f` 与 ACK-4 **不可复用** |
| Reset / Bootstrap / Cleanup / Migration | **未**授予 |
| 任何功能、权限或业务合同扩展 | 本包**不**扩大 M1-Core 首期范围 |

## 6. 旧 M1 全范围与延期能力边界（条件 6 的固化）

旧 M1 13 Gate 全范围 Design **不恢复**为当前实施和验收要求；旧 13 Gate 继续作为
**M1 全域 Closure** 的验收合同（Active Design §13.2），两者**不得互相替代**。
后续延期能力必须**根据实际产品需求重新评估并独立授权**，**不得**由本次包级 Acceptance 自动推导为
实施任务或验收条件。

## 7. 状态迁移

```text
Before : 七 Gate = 7/7 PASS；Package = M1_CORE_ACCEPTANCE_BLOCKED
         WP-K   = M1C_G07_WPK_EVIDENCE_BOUNDARY_ACCEPTED_FOR_PACKAGE_REVIEW
         WP-K-R1= M1C_G07_WPK_R1_EVIDENCE_BOUNDARY_ACCEPTED_WITH_BOUNDED_RESIDUAL
         WP-J   = DEFERRED_NOT_AUTHORIZED；WP-I = NOT_PROVEN / DEFERRED_NOT_AUTHORIZED
After  : 七 Gate = 7/7 PASS（**不变**）
         Package= M1_CORE_ACCEPTANCE_PASS
                 （M1_CORE_ACCEPTANCE_PASS_WITH_BOUNDED_RESIDUAL_RISK）
                 —— 范围**仅** M1-Core 首期七 Gate
         WP-K   = **不变**；WP-K-R1 = **不变**
         WP-J   = DEFERRED_NOT_AUTHORIZED（**不变**）
         WP-I   = NOT_PROVEN / DEFERRED_NOT_AUTHORIZED（**不变**）
         M-15   = 不在范围（**不变**）
         Capability Freeze / Domain Acceptance / Manual Closure /
         Release Readiness / Release / Deploy = **仍未授予**
```

`docs/status/PROJECT_STATUS.md` §37.48～§37.54、七 Gate 正式 Owner Acceptance、WP-K 与 WP-K-R1 裁定、
以及全部历史测试与失败 Run 记录**一律原样保留，不覆盖、不改写**。

## 8. 历史不可改写

本文**未**修改：Active Requirement、Active Design、生产代码、DDL、Fixture、G07 Oracle、G07 合同、
CR 集、ACK-4 合同、测试，以及**任何**已签发的 Gate Owner Acceptance、WP-K 裁定与 WP-K-R1 裁定。
候签记录 [`m1-core-package-acceptance-candidate-20261107.md`](./m1-core-package-acceptance-candidate-20261107.md)
的 `PENDING_APPROVAL` 状态是对其撰写时点的真实记录，**保留不删**；其「当前状态」含义由本节取代。

## 9. 未发生

本文**未**连接真实 MySQL、**未**运行 G07、**未**签发或消费 ACK-4、**未**执行
Reset / Bootstrap / Cleanup / Migration、**未**运行 HEAVY；**未** Push / Merge / Tag / Release / Deploy；
**未**恢复旧 13 Gate 为当前实施和验收要求；**未**虚构 WP-I、WP-J 或 M-15 的完成状态。
