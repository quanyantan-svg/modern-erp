# B3121 委外核心执行工作面审计与 Coverage / Gap（2026-11-10）

> 用途：核对已批准 M1-Core 委外链在当前代码中的可执行性，形成有界 Coverage / Gap 输入；不替代 B3121 全手册验收。
> Owner：Procurement & Outsourcing Domain Owner；本审计证据由项目维护者复核。
> 生命周期状态：`DRAFT`（审计结论已形成，待 Owner 复核）；审计状态：`AUDIT_COMPLETE / COVERAGE_REVIEWED`。
> 权威来源：Manual → Capability 以 `document.md` §22.21、`docs/requirements/procurement-outsourcing.md` §31.3.3 为准；首期范围以已批准 §31.13、M1-SRD-01 为准；项目当前状态只见 `docs/status/PROJECT_STATUS.md`。本文件不构成 Requirement、Design、Acceptance 或 Implementation 授权。
> 基准：本地 `master` @ `bbacab0`，工作树在审计开始时 clean；旧审计 `b3101-b3121-code-audit-20261107.md` @ `9b9cb0` 是历史快照，不直接沿用其“未验收”结论。

## 1. 授权、范围与方法

用户明确连续授权委外 `AUDIT → COVERAGE/GAP → REQUIREMENT → DESIGN`，并将本轮目标限定为**现有已批准核心闭环的可执行工作面**；跨期 WIP 成本携带、复杂差异、部分期初、委外 AP/GL 正式过账、成品退货等延期边界保持。用户指定委外收货员创建并确认完工通知，仅能读取订单号、供应商、产品、数量、加工费 PO、通知/收货状态；不得看到材料成本或 WIP 身份细节。用户指定完工由已生效收货量达到订单量把关，关闭由无待检、无未处理材料余量把关；延期财务事项不阻塞。上述选择仅授权本轮文档阶段，不自动修改既有 Active 合同或代码。

按 AGENTS.md §4.1 核查了 Route/Launcher、UI、HTTP 路由、handler 与 owner、schema、来源关系、状态、RBAC/SoD、事务与幂等、审计、测试、移动端及跨域边界。执行当前 HEAD focused：`node --test server/outsourcing.test.js server/outsourcing-finance.test.js server/outsourcing-wip-transfer.test.js server/m1c-wp2-wp5-outsourcing.test.js server/m1c-outsourcing-gl-policy-guard.test.js`，56/56 PASS、0 SKIP、退出码 0。此结果只证明所选现有测试；本轮未运行浏览器、完整回归或真实 MySQL，不据此宣称 Capability `COVERED`。

## 2. 代码事实与端到端断点

| 层 | 当前证据 | 结论 |
|---|---|---|
| 路由与导航 | `src/navigation/applicationRegistry.js` 只有一个 `outsourcing` Route，权限是 `OUTSOURCING_VIEW/MANAGE`；`src/pages/outsourcing.jsx` 使用本地 `active` 模态状态，不消费 RouteLocation target。 | 收货员无法进入委外工作面；单据 direct URL、刷新和浏览器历史无法恢复明细。 |
| 委外工作面 | `src/pages/outsourcing.jsx` 仅有订单列表、详情、建单、流转、取消；建单输入原始 ID。 | 现有注释提到的材料、PO、通知、收货、质量、报表并无对应可执行控件；320/390/430/680 宽度的完整工作流无证据。 |
| 订单/BOM 快照 | `createOutsourcingOrder()` 用当前日期验证供应商，未按业务日期检查资格起始日；`snapshotMaterialList()` 为独立接口且没有订单状态门禁；订单可在无快照时下达。 | 与已批准 `MC-REQ-03`“保存/确认形成快照、Release 后不回写历史”不符；需要在本轮工作面与服务端收敛。 |
| 服务端路由与 owner | `server/app.js` 已 dispatch 到 `server/modules/outsourcing.js`、`outsourcing-finance.js`、`procurement-receiving.js`、`quality-gates.js`、`procurement-reports.js`；Inventory 经 canonical mutation。 | 主业务 Writer 基础存在，缺前端与受限读取/授权衔接；不得新增第二套通知、库存、IQC、AP 引擎。 |
| 通知与权限 | `procurement-receiving.js` 的 create/confirm 一律要求 `RECEIPT_NOTICE_MANAGE`；`server/db.js` 与 `v13-phase1-contracts.js` 中委外收货员只有 `OUTSOURCING_RECEIVING_MANAGE`。 | 该岗位不能创建/确认 OUTSOURCE 完工通知；直接授予通用权限会同时开放普通采购通知，超出本轮决定。 |
| 收货与质量 | `outsourcing.js` 已创建 `PENDING_INSPECTION` 收货；`outsourcing-finance.js` 确认时复核 PO、通知、IQC、容量、倒冲并入库；`quality-gates.js` 支持 `OUTSOURCING_RECEIPT`；`quality.jsx` 仅从采购入库页提示创建 IQC，完成后固定返回采购入库。 | 后端主链可达，跨模块移动端入口和返回源未闭合；质量和收货生效仍需分岗。 |
| 生命周期 | `outsourcing.js::transitionOutsourcingOrder` 事务前读取订单，按 `LIFECYCLE_NEXT` 直接更新；`action` 只作为审计动作标签，未校验请求动作与目标态，也未校验完工/关闭业务事实。 | `RELEASED→COMPLETED→CLOSED` 存在并发陈旧状态及越过收货/材料门禁风险；属语义不符。 |
| 材料动作状态 | `issueMaterial()`、`supplementMaterial()` 在事务内只允许 `RELEASED`；`returnMaterial()` 虽在事务内重读订单，却没有任何订单状态校验。 | `CLOSED` 后仍可退料；若 `COMPLETED` 时留有未耗用材料，必须允许有界退料才能满足关闭门禁，且不能重新发/补料。 |
| 数据与审计 | 现有委外订单、用料、材料动作、通知、收货明细、WIP/成本证据表已存在；关键收货/库存 Writer 有事务、幂等和审计；Lifecycle 拒绝审计与状态重读不足。 | 核心工作面原则上不需要新 schema；新读模型应只投影现有权威事实。 |

## 3. OUT-01..23 有界 Coverage

下表的分类是**本轮“已批准核心闭环可执行工作面”覆盖**，不等于 B3121 全手册 Capability 最终状态。`OUT_OF_SCOPE` 仅表示该子能力不属于本轮有界包；其手册 Gap 不因此关闭。`COVERED` 须有完整合同、可达工作面及验收证据，本轮不签发。

| Capability | 本轮 Coverage | 证据与 Gap |
|---|---|---|
| OUT-01 委外供应商 | `PARTIAL` | 供应商资格/WIP 绑定有服务端路径；建单无合格供应商选择器，业务日期校验需复核。 |
| OUT-02 委外货源 | `PARTIAL` | 寻源基础存在；委外工作面无可用货源/来源选择与可见解释。 |
| OUT-03 加工价格 | `PARTIAL` | 加工费 PO 有后端创建；工作面不能选择/查看价格来源及商业承诺。 |
| OUT-04 供应商 WIP 仓 | `PARTIAL` | 绑定及库存位置模型存在；工作面不能说明来源仓和 WIP 位置，不能处理身份不明时的安全拒绝。 |
| OUT-05 计划交接 | `PARTIAL` | 后端消费计划来源且现有测试覆盖；工作面无计划交接队列和来源回溯。 |
| OUT-06 委外订单 | `PARTIAL` | 建单 API 与简单 UI 存在；原始 ID 输入、只读投影及 deep link 不满足现场操作。 |
| OUT-07 委外生命周期 | `SEMANTIC_MISMATCH` | 流转可任意 NEXT；缺请求动作匹配、事务内状态重读、完工与关闭事实门禁。 |
| OUT-08 委外 BOM | `PARTIAL` | approved/effective OUTSOURCE BOM 解析路径存在；移动端无版本/适用性可见选择与错误提示。 |
| OUT-09 用料清单 | `SEMANTIC_MISMATCH` | 快照 Writer 存在，但订单可无快照下达，且可在下达后首次快照；违反已批准快照时序，无工作面执行和明细显示。 |
| OUT-10 加工费 PO | `PARTIAL` | PO Writer 与来源校验存在；无创建/审批状态与行级来源工作面。 |
| OUT-11 委外发料 | `PARTIAL` | Inventory Writer 存在；无选择清单行、批序列、仓库并执行发料的工作面。 |
| OUT-12 委外补料 | `PARTIAL` | 事务/库存链存在；无原因、来源、身份录入工作面。 |
| OUT-13 委外退料 | `SEMANTIC_MISMATCH` | 反向库存链存在但 `returnMaterial()` 缺订单状态门禁，关闭后仍能改变材料事实；无可退余额与身份录入工作面。 |
| OUT-14 材料所有权 | `PARTIAL` | 企业所有权/WIP 位置由服务端保持；工作面缺余额与保管位置只读解释。 |
| OUT-15 LOT/SERIAL | `PARTIAL` | 复用 canonical 跟踪；工作面缺身份选择、错误恢复及全链显示。 |
| OUT-16 增量倒冲 | `PARTIAL` | 后端增量倒冲及库存/估值路径存在；无合法收货后的复核入口与结果显示。 |
| OUT-17 完工通知 | `MISSING` | 通用 Writer 支持 OUTSOURCE，但指定委外收货员无创建/确认权限，UI 无入口。 |
| OUT-18 委外 IQC | `PARTIAL` | 后端支持委外收货来源；质量页无委外待检进入及返回来源路径。 |
| OUT-19 委外收货入库 | `PARTIAL` | 待检/生效 Writer 存在；收货员无法从订单/通知进入闭环工作面，生效门禁需 UI 明示。 |
| OUT-20 加工费应付 | `OUT_OF_SCOPE` | 正式 AP/GL 过账按 §31.13 `MC-REQ-15` 继续 409；只在本轮展示加工费 PO 与延期状态，不开放正式写入。 |
| OUT-21 委外成本证据 | `PARTIAL` | 已生效收货形成材料实际消耗+加工费暂估证据；最终成本调整仍延期，现场仅按岗位展示允许字段。 |
| OUT-22 成品退货 | `OUT_OF_SCOPE` | 当前有正式拒绝边界，未进入本轮核心工作面；保留手册 Gap。 |
| OUT-23 期末/WIP/期初/报表 | `PARTIAL` | 执行/材料报表与有界 WIP 数量转移已有实现且 OUT-001 有界验收；复杂差异生效、跨期成本及部分期初仍延期，不以本轮关闭整项。 |

## 4. 本轮确认的 Gap 与后续边界

| Gap ID | 类别 | 所需处理 | 不得扩大到 |
|---|---|---|---|
| OUT-WB-01 | 工作面缺失 | 订单、BOM/用料、加工费 PO、发退补、倒冲、通知、待检收货、生效、报表的角色化任务链和可恢复详情路由。 | 第二套业务 Writer 或桌面端副本。 |
| OUT-WB-02 | 权限与隐私 | 委外收货员仅在 OUTSOURCE 来源创建/确认通知并读取收货所需投影；业务员、质检员、收货生效人维持分离。 | 直接赋予通用 `RECEIPT_NOTICE_MANAGE` 或暴露材料成本/WIP 身份。 |
| OUT-WB-03 | 生命周期语义 | 订单动作匹配、事务内权威重读、确认/下达前快照约束、完工及关闭事实校验、退料状态限制、并发失败零业务副作用和拒绝审计。 | 改写历史订单或启用延期财务功能。 |
| OUT-WB-04 | 跨域质量衔接 | 待检委外收货进入 canonical IQC，检验后返回委外来源，按质量门禁决定是否可生效。 | 委外私有 IQC 或绕过质检。 |
| OUT-WB-05 | 现场可用性 | 来源选择器、状态/错误说明、320/390/430/680 宽度与 direct URL/刷新/Back/Forward。 | 改变业务数量/金额/状态语义。 |

以上五项进入本轮候选 Requirement。旧审计 §9 的 Issue 状态及 B3121 `BLOCKED` 不据此自动变更；`OUT-20/22/23` 延期部分仍由既有合同和待裁定 Scope 决策管理。下一阶段只可写相关 Requirement 正文和当日日志；Design 与 Implementation 均不得在 Requirement 阶段提前修改。
