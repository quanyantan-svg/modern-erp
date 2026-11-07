# M1-Core 采购与委外首期 —— Active Design

> **用途**：给出 M1-Core 首期（SRD-01 范围）的**可实施技术方案**，取代旧候选设计
> §26.33 中已纳入首期的 A / B / U / T 部分，并为 §31.13 的 7 个 `M1C-Gxx` Gate 提供
> 设计侧依据。**不**重复旧设计的全部历史论证，**不**复制其正文。
> **Owner**：Procurement & Outsourcing（Domain Owner）
> **状态**：`ACTIVE` / `APPROVED` —— M1-Core 首期当前有效 Design
> **权威来源**：本文件是 M1-Core 首期唯一 Active Design；原 Domain Design §26 继续由
> [`procurement-outsourcing.md`](./procurement-outsourcing.md) 持有，二者范围不同、不构成重复正文。
> **来源 SHA**：`759d7216c7546ffa00a147f603c4e8852aada991`（基线）；
> 来源设计 `912fd76700ff6f3ad1509eec4c9e2241c1830265`
> **来源章节**：`solution.md §26.33 M1 Integrated Critical Chain Design`（来源设计，R1→R4-6-R2）
> 与 `M1-SRD-01`（范围决定，2026-11-02）
> **对应 Requirement**：[`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.13
> （`APPROVED`，`M1_CORE_REQUIREMENT_ACCEPTANCE_PASS`）
> **原 Domain Design**：[`docs/design/procurement-outsourcing.md`](./procurement-outsourcing.md) §26
> **Design ID**：`M1_CORE_DESIGN_PASS`（业务所有者，2026-11-02）
> **Implementation**：`NOT_AUTHORIZED`
> **当前项目状态**：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §37.12
> **开放业务政策**：[`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md) §1.4
>
> **修订记录**：
> - `12a6281`（2026-11-02）：首版（M1-Core 范围重定基线后的有界候选设计）。
> - 本轮（`M1C-IR2-FIX`，2026-11-02）：**独立审查问题定点修正** —— ①容量合同按
>   `business_type` 分域（§5.2）；②延期财务的**来源级**防绕过与共享入口覆盖（§9.4）；
>   ③`M1C-WP-1` 阻塞划分调整与 `T-11` 原始含义恢复（§2.2、§15.1）；
>   ④加工费**草稿创建 vs 正式过账**边界（§9.4）；⑤收货生效的**最低安全授权**与
>   "可实施 ≠ 可取证"（§8.1）；⑥`M1C-WP-0` 最小 migration 集收敛（§4.1、§4.2）；
>   ⑦`RISK-3` 现状事实修正（§14）；⑧零副作用域与拒绝审计边界（§9.2）。
>   本轮**未**修改任何实现代码、schema、migration 或测试；7 个 Gate 仍全部 `NOT_RUN`。
> - 本轮（`M1C-TC1`，2026-11-02）：三项技术合同收尾 —— ①`M-15` 技术性身份键规范化与
>   历史业务回填边界；②新建通知来源行显式初始化 `converted_quantity=0`；③管理员
>   all-permissions 不能绕过委外来源级会计政策门禁。仅修改文档；未实施或运行任何 Gate。
> - 本轮（`M1C-TC1-RV1`，2026-11-02）：最终技术合同修正 —— ①以真实
>   `products.tracking_policy` 收敛 `M-15` 严格映射并明确取代旧 `ELSE 'NONE'` / PRE-B；
>   ②指定 `createReceiptNotice()` 为标准采购来源行唯一生产 Writer，并定义多 PO 输入、验证与事务路径；
>   ③区分 HTTP 403/409 与内部服务错误传播。本轮仅修改文档，未执行 migration 或 Gate。
> - 本轮（`M1C-ACCEPTANCE-PROMOTION-20261102`）：业务所有者批准 Requirement 与 Design，
>   正式批准 `M1-P-03` 最小角色矩阵并确认 `A-P01`；本文件由待审区提升为 Active Design。
>   Implementation 仍为 `NOT_AUTHORIZED`，7 个 Gate 仍全部 `NOT_RUN`。
> - 本轮（`M1C-D-PO01`，2026-11-03）：业务所有者批准加工费 PO R1 Amendment，
>   批准 `M1C-PO-P01`、`M1C-PO-P02` 与最小来源唯一索引方案，并将其精确融合进
>   §2.3、§3、§5–§11、§13–§17。该 Promotion **不授权 Implementation**，未连接数据库、
>   未执行 migration，7 个 Gate 仍全部 `NOT_RUN`。
> - 本轮（`M1C-WP7-B0-DESIGN-PROMOTION`，2026-11-03）：Domain Owner、Platform / Database
>   Safety Owner 与用户明确批准 G03 L1/L2 分层、CR-01～CR-09、CR-02/04/05 精确错误码及 ACK-4
>   全入口安全合同；候选 `docs/reviews/m1/m1-core-wp7b0-g03-g07-safety-design-amendment.md`
>   （审查 SHA `70edc23aefdca9ee95c45be1b5933fd9cdb7f9e1`）精确融合至本文件 §6、§9.3、
>   §13–§17，跨 Domain ACK-4 规范提升至 `solution.md §15.1`。候选原文保留作来源快照。
>   本次只激活 Design，**不授权 Implementation / MySQL / M-15 / Migration**，7 个 Gate 状态不变。
> - 本轮（`M1C-G04-D2-DESIGN-AMENDMENT`，2026-11-07）：Procurement & Outsourcing Domain
>   Owner 批准 G04 可达性与证据层级的 Design-only 修订。§13.1 的 `M1C-G04` 拒绝断言现区分
>   合法 L1 净供应不足、L3 历史异常负增量防御与不受支持基数；原 409 守卫、严格支持范围、事务、
>   零副作用及审计要求全部保留。本修订不签发 `M1C-G04 PASS`，不授权 Implementation 或数据库操作。
> - 本轮（`M1C-DESIGN-STATUS-POINTER`，2026-11-07）：Procurement & Outsourcing Domain Owner 批准
>   §13.1 / §13.3 的**纯状态指针**修订。下表 `execution_status` 列与 §13.3 首条现明确为 **Design 批准
>   时点的历史快照**，**当前**执行与验收状态以 `docs/status/PROJECT_STATUS.md` 为**唯一权威**；本文件
>   **不复制** Gate 的 `PASS` / `FAIL`，七个 Gate 的**业务合同**与该列取值**均未改动**，
>   文件头部历史日期化注记**未追改**。本修订不签发 `Design PASS`，不授权 Implementation、
>   MySQL、Migration 或任何数据库操作；修订记录见
>   [`docs/acceptance/m1-core-design-status-pointer-amendment-20261107.md`](../acceptance/m1-core-design-status-pointer-amendment-20261107.md)。

## 1. 位置、与旧候选设计的关系

G0 文档重构后，`solution.md` 不再保有 §26 的正文；M1 全范围候选设计保存在
[`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)
（源 `solution.md §26.33` @ `912fd767…`，4199 行，R1→R4-6-R2 逐字保留）。

本文件是**有界的后继设计**，不是对旧文件的改写：

| 旧 §26.33 部分 | M1-Core 处置 |
|---|---|
| §26.33.1–§26.33.3（范围、历史协调、组件与 Owner 图） | **继承并收敛**，见 §2–§3 |
| §26.33.4–§26.33.5（数据模型、状态机） | **仅保留 A / B 组首期所需部分**，见 §4–§6；C / D 组整体延期 |
| §26.33.6（API 合同） | **收敛为首期 API 矩阵**，见 §7 |
| §26.33.7（schema / migration） | **收敛为首期最小 migration 集**，见 §4.1 与 §4.2 |
| §26.33.8（事务、锁序、幂等） | **收敛为首期事务边界与幂等合同**，见 §6 |
| §26.33.9（RBAC / SOD / Audit） | **收敛为首期最小权限矩阵**，见 §8 |
| §26.33.10（守恒不变量） | **收敛为首期不变量**，见 §9.1 |
| §26.33.11（错误与回滚） | **收敛为首期零副作用边界、错误码与来源级拒绝合同**，见 §9.2–§9.4 |
| §26.33.12（13-Gate） | **由 §13 的 7 个 `M1C-Gxx` Gate 取代**，逐项处置映射见 §13.2 |
| §26.33.13（WP-0..WP-8） | **由 §2.2 的 `M1C-WP-0..M1C-WP-7` 取代**；WP-7（GL）、WP-8（差异审核 + 结算释放）整体延期 |
| §26.33.14（政策登记） | **状态处置**改由 `OPEN-BUSINESS-DECISIONS.md` §1.4 持有；本文件 §15 只引用 |
| §26.33.15（阻塞与 HARD STOP） | **收敛**为 §15–§17 |

**旧文件保持原样、不被改写、不被删除**。它仍是延期部分（C / D 组）与历史结论的权威载体。

`M1C-WP7-B0-R1` 候选亦保持原文，保存在
[`docs/reviews/m1/m1-core-wp7b0-g03-g07-safety-design-amendment.md`](../reviews/m1/m1-core-wp7b0-g03-g07-safety-design-amendment.md)
（初始来源 `8559c03`，R1 审查/Promotion 基线 `70edc23aefdca9ee95c45be1b5933fd9cdb7f9e1`）。其映射为：

| 候选章节 | Active 权威位置 |
|---|---|
| §1 G03 证据分层 | 本文件 §13.1.1 |
| §2–§4 ACK-4 / 状态机 / 全入口 | `solution.md §15.1`；M1 manifest 见本文件 §13.1.4 |
| §5 M1 专用入口 | 本文件 §13.1.4 |
| §6 CR-01～CR-09 / error code | 本文件 §9.3、§13.1.3 |
| §7 schema parity | 本文件 §13.1 / §13.1.2 |
| §8 M-15 条件依赖 | 本文件 §4.4 / §13.1.2 |
| §9 待批准项 | 已由本次 Promotion 关闭 Design 批准项；Implementation / run 授权仍由本文件 §17 与 `solution.md §15.1` 控制 |

候选仅作为获批来源快照与 Supersession 追溯，不再构成并列待决 Design，也不成为第二份 Active Contract。

**深引用解析**：本文件中的 `§26.33.x` 自指**指向上述旧候选设计文件**；
`§31.12.x` 指向 [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md)；
`§31.13.x` 指向同文件 §31.13。迁移期的行号 / 章节引用解析见
[`docs/status/MIGRATION-MAP.md`](../status/MIGRATION-MAP.md) §4。

## 2. 范围与工作包

### 2.1 首期范围

首期覆盖 §31.13.2 的 `MC-REQ-01..MC-REQ-15`；**不含**高级跨订单/跨期 WIP、复杂倒冲差异审批、
VMI 结算、委外 AP/GL 自动过账、历史会计补偿（`M1-SRD-01` §2.2）。

### 2.2 Core 工作包与依赖 DAG

```text
M1C-WP-0  基础设施
  ├ migration 骨架 + parity 断言
  ├ SOURCE_TYPES 注册（OUTSOURCING_SUPPLEMENT / OUTSOURCING_BACKFLUSH）
  ├ SUPPLIER_BILL_MANAGE 权限注册并按已批准矩阵授予 role-accounting（admin 继承不构成政策豁免）
  └ 锁顺序文档化 + 统一事务守卫
       │
       ├──┬──────────────┬──────────────┬──────────────┬──────────────┐
       ▼  ▼              ▼              ▼              ▼              │
   WP-1 WP-2           WP-3           WP-4           WP-5           WP-6
   采购通知/转换        委外收货明细    发退补料         增量倒冲        危险写入拒绝
   (G01)               + 两段式生效    (G03)           + 成品入库      + 权限分离
                       (G02)          [独立于         (G04)          (G06)
                                      WP-2]                          [独立]
       │                  │              │              │
       └──────────────────┴──────────────┴──────────────┘
                              │
                              ▼
                          M1C-WP-7
                          生产 API 端到端 + SQLite/MySQL 对等 + Core 真实 Handler 并发
                          (G07)
```

**非强依赖（必须遵守）**：`M1C-WP-3`（发退补料权威 Writer）**不**依赖 `M1C-WP-2`（委外收货明细）。
不得把"完成委外收货 Schema"当作开始修订材料 Writer 的全局阻塞。

**待签政策不再阻塞任何工作包的代码实施**：`M1C-WP-1`（采购通知转换）原先被
`A-P01` / `A-P02` / `T-11` 阻塞，现已解除 ——
`A-P01` 由本 Design **技术接受**（§15.1），`A-P02`（复杂拒收重开）、`T-11`（取消后容量恢复）
与零有效交期路径均按**受限行为** fail closed 实现（§5.2、§15.1.1）。
`M1-P-03` 授予矩阵已获批准；政策不再阻塞。角色/权限配置仍待独立授权的 Implementation，
其正向实证要求见 §2.3 对 `M1C-WP-2` 的说明。`M1-P-02` 只在放宽严格支持范围时仍需裁定。

### 2.3 工作包与 Gate 的对应

| 工作包 | 内容 | 交付 Gate | 首期就绪度 |
|---|---|---|---|
| `M1C-WP-0` | 基础设施（最小 migration 集 + parity 断言 + `SOURCE_TYPES` 注册 + `SUPPLIER_BILL_MANAGE` 权限注册 + 锁序与事务守卫） | 全部 Gate 的前置 | 设计就绪；Migration 实测证据未取得 |
| `M1C-WP-1` | 采购收料通知、来源转换、多 PO 容量、交期绑定 | `M1C-G01` | 设计就绪，**不依赖**任何待签政策（`A-P01` 已技术接受；`A-P02` / `T-11` / 零有效交期按受限行为 fail closed） |
| `M1C-WP-2` | 委外收货表头 + 明细原子写入、两段式生效、IQC 门禁时点 | `M1C-G02` | `M1-P-03` 已批准；Implementation 仍须独立授权并创建/配置委外收货员，正向证据必须由该角色取得 —— 见 §8.1 |
| `M1C-WP-3` | 发料 / 补料 / 退料的真实库存、跟踪、估值 | `M1C-G03` | 设计就绪，不依赖待签政策 |
| `M1C-WP-4` | 合法增量倒冲、真实材料成本、成品入库 | `M1C-G04` | 设计就绪（按严格支持范围 fail closed） |
| `M1C-WP-5` | 延期财务 / VMI / 差异生效的拒绝边界与权限分离 | `M1C-G06` | 设计就绪，不依赖待签政策 |
| `M1C-WP-6` | 移动端有限修复 | `M1C-G05` | 设计就绪，不依赖待签政策 |
| `M1C-WP-7` | 端到端、SQLite/MySQL 对等、Core 真实 Handler 并发 | `M1C-G07` | 依赖前述各包产出真实 handler |

**`M1C-D-PO01` 跨包依赖**：加工费 PO 正式可达路径不是新工作包。其 additive UNIQUE
索引与历史冲突预检归 `M1C-WP-0`；显式创建、提交、审批、通知与收货来源链归
`M1C-WP-2`；生产 API、Item ID 稳定、zero-bypass 与 SQLite/MySQL 并发唯一性证据归
`M1C-WP-7`。三者均须另获 Implementation 授权，现状 Gate 不变。

**本轮没有任何工作包被宣布为 Implementation Ready。** Design PASS 与 Implementation 授权是两件事；
"设计就绪 / 可进行代码实施"**不等于**"已获授权实施"，也**不等于**"对应 Gate 可取得正向证据"。

## 3. 复用的生产模块与函数

| 能力 | 规范 Owner（现有模块 / 函数） | M1-Core 是否新建 | 复用方式 |
|---|---|---|---|
| 唯一权威物理库存写入 | `server/lib/inventory-mutation.js::applyInventoryMutation` | **否** | 委外全部物理腿经由它；**不得**自建第二 Writer |
| 库存位置身份 | `server/lib/inventory-position.js::computePositionKey` | 否 | owner / warehouse / lot / serial 进入 `position_key` |
| 严格跟踪写者 | `server/lib/traceability-quality.js::postCanonicalTrackedLeg` | 否 | 每条物理腿**逐腿显式调用**；`trackingMode='EXTERNAL'` |
| 唯一权威估值账 | `server/modules/financial-inventory.js::issueValue` / `receiveValue` | 否 | MOVE 成对、倒冲仅 issue；Movement + Balance 双写 |
| 采购订单 / 采购入库引擎 | `server/app.js`（`createPurchaseReceipt` / `confirmPurchaseReceipt`） | 否 | 转换流程**调用**既有引擎，不重写 |
| 采购订单 canonical draft Writer | `server/modules/procurement-orders.js::createPurchaseOrderDraftCanonical`（目标 owner） | **是（抽取既有写入原语）** | 标准 PO、请购转 PO、加工费 PO 共用；外部调用方不得自选 `business_type` |
| 加工费 PO 商业更新 | `updateOutsourcingProcessingPurchaseOrderCommercialFields`（目标私有服务） | **是** | 仅原位更新商业白名单；禁止删除重建来源行 |
| 收料通知 | `server/modules/procurement-receiving.js` | 否 | 扩展行级来源与容量不变式 |
| 委外订单 / 用料清单 | `server/modules/outsourcing.js::createOutsourcingOrder` / `snapshotMaterialList` | 否 | 扩展 BOM 来源校验与快照口径 |
| 委外材料执行 | `server/modules/outsourcing.js::issueMaterial` / `supplementMaterial` / `returnMaterial` / `backflushMaterial` | 否（**改写实现，不改 owner**） | 改写为经 canonical Writer |
| 委外收货 | `server/modules/outsourcing.js::createOutsourcingReceipt`（创建）+ `server/modules/outsourcing-finance.js::confirmOutsourcingReceipt`（生效） | 否 | 明细写入 + 两段式状态机 |
| IQC 判定 | `server/modules/quality-gates.js::deriveQualityState` / `assertQualityGate` | 否 | 消费 `outsourcing_receipt_items`；扩 `PENDING_INSPECTION` 白名单 |
| 委外成本证据 | `server/modules/outsourcing-finance.js::refreshOutsourcingCostEvidence` | 否 | 只读取已生效事实 |
| 加工费 / AP / GL | `server/modules/commercial-golive.js` / `settlement-core.js` | 否 | **首期只做拒绝边界**，不实现过账 |
| 移动工作面 | `src/pages/outsourcing.jsx`、`src/pages/sourcing-pricing.jsx` | 否（仅修调用约定） | 复用 `src/api.js` 的 `api(path, options)` |
| 通知 → 入库转换 | **新建** `server/modules/procurement-notice-conversion.js`（owner 唯一） | **是** | 调用既有采购入库引擎 |
| 端到端验收 | `scripts/acceptance/procurement-outsourcing-functional-uat.mjs` | 否（扩充 Gate） | 与 §31.13.5 的 7 Gate 对齐 |
| Core 并发 suite | **新建** `server/mysql-procurement-outsourcing-m1-core-concurrency.integration.js` | **是** | 以 gate 方式驱动，**不**塞进 FAST / FULL / HEAVY |

## 4. 最小 schema / migration 集

### 4.1 首期纳入的**最小** migration 集（`M1C-WP-0`）

> **收敛原则**：首期只做**核心库存身份、跟踪与估值确实依赖**的迁移与**前置检查**；
> **非首期必要的历史 WIP 转移迁移**与**高风险历史修复（历史回填 / 历史推导）一律移出**（见 §4.2）。
> 首期新增的表与列**零历史回填**：历史事实**不得**被推定，历史行的容量与身份一律
> 落到 §10 的 fail closed 路径。

| 编号 | 对象 | 内容 | 端 |
|---|---|---|---|
| `M-01` | `receipt_notice_item_sources` | **新表**（**schema only，零历史回填**）：行级已解析来源（通知行 ↔ 采购订单行 ↔ 交期 ↔ 已分配数量 ↔ 已转换数量）；数据库默认保持 `converted_quantity NULL`（历史或来源未证明）；权威生产 Writer 首次创建且在同一事务完成全部来源验证的新行时，必须**显式写入 0**，表示“该新行创建时尚未转换”。不得以 `DEFAULT 0`、批量回填或 `COALESCE` 把历史未知量变成容量 | 双端 |
| `M-02` | `purchase_receipts` | `+ source_notice_id TEXT` | 双端 |
| `M-03` | `purchase_receipt_items` / `outsourcing_receipt_items` / `schedule_consumption_effects` | 收货行增通知来源与交期；新增**不可变有符号交期消费台账**（正向 + 负向 effect），唯一键 `(business_event_type, business_event_id, business_event_item_id, reverses_effect_key)`；**零历史回填** | 双端 |
| `M-04` | `outsourcing_receipts` | `+ warehouse_id` / `+ source_notice_id` / `+ business_date` / `+ version INTEGER NOT NULL DEFAULT 0` | 双端 |
| `M-05` | `outsourcing_receipt_items` | `+ lot_id` / `+ serial_id` / `+ unit_code TEXT NOT NULL DEFAULT 'EA'` / `+ processing_po_item_id` / `+ source_notice_item_source_id` | 双端 |
| `M-06` | `outsourcing_material_list` | `+ source_warehouse_id TEXT NULL`（NULL = 历史不可证 ⇒ 运行期 409）/ `+ legacy_unverified_wip_quantity REAL NULL`（**NULL = 未证明**，**禁止** `NOT NULL DEFAULT 0`）/ `+ identity_evidence_state TEXT NOT NULL DEFAULT 'NONE'`；**零历史回填** | 双端 |
| `M-07` | 三张 WIP 身份层**新表**（effects / allocations / balances） | 纯 additive **新表**，**零历史回填**（历史行数必为 0）；是 `INV-WIP-4` / `INV-WIP-5` / `SRC-1` 的 canonical 证据层载体 | 双端 |
| `M-15` | `tracked_inventory_movements` | `+ identity_key TEXT NOT NULL DEFAULT ''` + 委外身份部分唯一索引；**五步顺序**：PRE-A → 加列 → **确定性技术规范化** → PRE-B/PRE-C → 建索引；任一 PRE 不通过**中止迁移**。此处不是历史业务回填，范围与授权见 §4.4 | 双端 |
| `M-17` | `permissions` / `role_permissions` | `+ SUPPLIER_BILL_MANAGE`，并按 `M1-P-03` **只显式授予现有 `role-accounting`**（普通采购）；不得授予委外业务员或其他普通业务角色；`admin` 可经 all-permissions 继承但无政策豁免；必须与 `V13_DESIRED_ROLE_PERMISSIONS` 同步，否则每次启动被剥离 | 双端 |

**代码级、无 migration**：`SOURCE_TYPES`（`server/lib/inventory-mutation.js`）新增
`OUTSOURCING_SUPPLEMENT` 与 `OUTSOURCING_BACKFLUSH` 两个字面量。
**注册前** `applyInventoryMutation` 对这两条路径一律 400；既有字面量一个不改。

### 4.2 首期**移出**的 migration（历史治理 / 延期能力工作包）

> 移出理由统一为：**首期能力不依赖**，或**属高风险历史修复**（需独立授权、需实测影响行数）。
> 移出**不**等于放弃；这些对象在首期一律以 §10 的 fail closed 路径运行。

| 编号 | 对象 | 移出理由 | 首期运行期行为 |
|---|---|---|---|
| `M-07b/c/d` | `outsourcing_wip_transfers` 加列 + 确定性回填 + `outsourcing_material_list` 残差收紧 | **历史 WIP 转移迁移**：跨单 WIP 成本携带属 `B-P01` 延期范围，首期 `createWipTransfer` 的成本携带已被 `M1C-G06` 拒绝，**不需要**该迁移 | WIP 转移**数量**归属守恒保留；成本携带拒绝（`B-P01`） |
| `M-12a/b` | 历史通知行的**已解析来源 1:1 回填** / 未解析来源登记 | **高风险历史修复**：需独立授权与实测；首期不推定任何历史 PO 关联 | 历史通知行**无来源行** ⇒ 转换路径 fail closed（409 `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN`） |
| `M-13` | `outsourcing_material_list.source_warehouse_id` 由历史发料最早来源仓**确定性推导回填** | **高风险历史修复**：历史回填须独立授权 | `source_warehouse_id` 留 **NULL** ⇒ 运行期 409 fail closed |
| `M-14` | `receipt_notice_item_unresolved_sources` **新表** | 仅在执行 `M-12b` 历史回填时才有意义；首期无回填则不需要该表 | 不建表、不写入 |

**移出的直接后果（必须在 Gate 中体现）**：首期**不**产生任何历史来源行与历史身份行，
因此历史通知与历史 WIP 一律**不可**通过新的转换 / 倒冲 / 转出路径获得容量或授权；
这与 §10 的历史 fail closed 一致，**不是**缺陷。

### 4.3 首期**排除**的 migration（延期，不得实施）

`M-08`（`outsourcing_difference_approvals`）、`M-09`（VMI 结算三表）、`M-10`（VMI 协议价格列）、
`M-11`（`OUTSOURCING_DIFFERENCE_APPROVE` 权限）、`M-16`（委外会计政策两表）、`M-18`（加工费预留超额列）——
分别属于 B-P02 / D-P01 / D-P02 / C-P01..C-P04 的延期范围。**不得**在首期顺带实施。

### 4.4 迁移纪律

- 全部 **additive**；不 DROP 历史表；不重建既有表；两引擎语义对等；**idempotent**。
- **首期不做任何历史业务事实重建或不可证明的历史补记**（§4.2）：新增表与业务事实列对历史行
  一律为 **NULL / 未证明**，不得以 `DEFAULT 0` 冒充“已证明未转换”，不得推定历史来源、
  WIP、LOT/SERIAL、库存、估值、成本或会计事实。
- 唯一有条件例外是 `M-15` 的**技术性身份键规范化**，且本轮**不执行**：未来必须另获独立
  Migration 授权，且只可把已有、明确、一致的身份字段规范化为 `LOT:<lot_id>`、
  `SERIAL:<serial_id>`；仅当产品与该行保存字段能证明其为非跟踪物料时才可写 `NONE`。
  LOT/SERIAL 身份缺失、策略冲突、身份字段冲突、来源行缺失、规范化后撞键或来源关系无法证明时，
  一律停止，不得推断，也不得把身份不明的 LOT/SERIAL 强制转换为 `NONE`。
- `M-15` 不改变历史业务数量、归属、库存效果、估值、来源项或单据状态；仅支持现有严格跟踪事实的
  去重与唯一性约束，**不等于**恢复或证明历史 WIP 的可用量。
- MySQL DDL 自动提交 ⇒ 每个中间状态**幂等可重放**；失败重跑**不得**重复写、**不得**删历史。
- `M-15` 的 PRE 检查**不通过时中止迁移**并报告行数，**不得**删流水、**不得**臆造 `source_item_id`。
  PRE 检查的范围**仅限**身份键可判定性（是否存在可确定的 `identity_key`、是否存在会撞键的历史流水），
  **不**包含任何历史修复或历史改写动作。
- PRE-A / PRE-B / PRE-C 必须读取真实目标数据，不能凭静态推断宣称通过；不得覆盖已有非空身份。
  SQLite / MySQL 的规范化结果与唯一性语义必须对等；MySQL DDL 自动提交造成的部分完成状态必须
  可识别、可安全重试。唯一索引未确立或 PRE 未通过时，相关委外跟踪写入继续 fail closed。

#### 4.4.1 `M-15` 严格身份映射与旧规则取代声明

产品跟踪策略的真实权威字段是 `products.tracking_policy`（现有值 `NONE / LOT / SERIAL`）；
`tracked_inventory_movements.product_id` 必须关联该产品事实。现有权威读取路径为
`server/modules/traceability-quality.js::productTracking()` 与
`server/lib/inventory-mutation.js::validateInventoryMaster()`；本 Design **不新增、不虚构**替代字段。

| 产品跟踪策略 | 历史 `lot_id / serial_id` | 唯一允许结果 |
|---|---|---|
| `LOT` | 有效 `lot_id`，`serial_id` 为空 | `LOT:<lot_id>` |
| `SERIAL` | 有效 `serial_id`，`lot_id` 为空 | `SERIAL:<serial_id>` |
| `NONE` | 两者均为空 | `NONE` |
| `LOT` 缺 `lot_id` | 任意 | **FAIL** |
| `SERIAL` 缺 `serial_id` | 任意 | **FAIL** |
| `NONE` 携带任一身份字段 | 任意 | **FAIL** |
| 双身份并存、未知策略、产品关联缺失或其他不可证明组合 | 任意 | **FAIL** |

旧候选 Design §26.33.12 的 `M-15 STEP-3 CASE ... ELSE 'NONE'` 与旧 PRE-B
“`lot_id`、`serial_id` 均为空即为 `NONE`”对 **M1-Core 明确 `SUPERSEDED`**；旧文件保留为历史，
但正式实施只允许采用上表。PRE-B 必须在真实目标库联合核对
`tracked_inventory_movements.product_id → products.tracking_policy`、历史 `lot_id/serial_id` 与生成后的
`identity_key`；任何不一致均停止，不得把身份不明记录自动归类为非跟踪物料。

## 5. 唯一 Writer 合同

### 5.1 通知 → 收料

- 收料通知的唯一权威模型 = `receipt_notices` + `receipt_notice_items` + `receipt_notice_item_sources`；
  由 `receipt_notices.business_type` 判别标准采购与委外。**不新建第二套委外完成通知表，
  不建立第二收货引擎。**（该选择的业务前提 §31.12.3 A-REQ-06 已批准，且该条已把物理模型定性为
  **Design 协调项**；本 Design 承担该裁定并记录为**技术接受** —— §15.1。）
- **标准采购通知创建的唯一生产 Writer** 是现有
  `server/modules/procurement-receiving.js::createReceiptNotice()`，或由其在同一事务内调用的
  私有专用来源分配 helper。它必须原子写入表头、明细、已验证来源行及显式
  `converted_quantity=0`；任一失败整体回滚。
- 转换由**新建目标** `server/modules/procurement-notice-conversion.js` **唯一**拥有；
  它只读取已经存在的来源行、复核通知/PO/容量关系、调用既有
  `createPurchaseReceipt` / `confirmPurchaseReceipt`，并在真实转换成功的同一权威事务累计
  `converted_quantity`。它**不重写**采购入库引擎、**不得创建来源行**、不得把非零累计量重置为 0。
- 转换必须由服务端校验 `business_type`、supplier、订单/订单行、warehouse、quantity、UOM、状态。
- 新来源行必须由该权威 Writer 在**首次创建**时、与来源关系及容量验证处于**同一事务**地显式写入
  `converted_quantity=0`。创建失败整体回滚；幂等重试只复用既有事实，不得把非零累计量重置为 0。
  历史或混合来源行保持 NULL 并 fail closed，不得靠时间字段猜测“新行”。
- **当前 API 事实**：现有 `POST /api/receipt-notices` allowlist 只有表头 `purchaseOrderId`，
  行内只有可选 `purchaseOrderItemId`，当前实现尚不创建 `receipt_notice_item_sources`；以下是
  **`NEW_DESIGN_TARGET`，不是现状声明**。
- **多 PO 输入**：标准采购行新增 `items[].sourceAllocations[]`；每项为
  `{ purchaseOrderItemId, deliveryScheduleId?, allocatedQuantity }`。为兼容既有单 PO 调用，
  `purchaseOrderId + items[].purchaseOrderItemId` 可由 Writer 规范化为单元素分配；一旦提供
  `sourceAllocations`，它就是该行唯一输入来源，禁止与旧字段表达冲突事实。
- **创建校验与写入路径**：逐项重读 PO 行及其订单，要求订单 `APPROVED`、
  `business_type='STANDARD_PURCHASE'`、供应商一致、产品等于通知行产品、分配量有限且为正、
  同一通知行内 PO 行不重复、分配量之和等于通知行数量；提供的交期必须属于该 PO 行，
  未提供时只允许唯一有效交期确定性绑定，零个或多个候选均 fail closed。所有来源转换到通知表头
  `warehouseId`；当前 PO schema 无仓库列，不虚构 PO 仓库字段。表头 `purchaseOrderId` 只写入
  行级来源集合按确定性顺序得到的首个订单，作为兼容派生提示；后续不得读取它作为来源权威。
- `receipt_notice_item_sources` **仅**用于 `STANDARD_PURCHASE` 已解析供料 PO 来源。
  `OUTSOURCE` 仍经“委外订单 → 加工费 PO → 委外完工通知 → 委外收货明细”追溯，
  `createReceiptNotice()` 不为其创建标准采购来源行。
- **容量不变式**（修正现状 E-06，作用域 = `OUTSOURCE` 通知行）：比较总量**必须包含**本次待确认的数量，
  并按"通知全量 − 已转换量"口径避免与已收货量重复扣减。现状 `confirmReceiptNotice`
  （`server/modules/procurement-receiving.js:186-211`）在 `OUTSOURCE` 分支以仅汇总 `CONFIRMED`
  的值减去仍是 `DRAFT` 的本通知数量，导致本次确认量未进入上限比较。

### 5.2 按通知 `business_type` 分别适用的容量上界（`M1C-G01`）

> **不再存在"对所有通知统一适用的四重上界"。** 每一类通知只受**它自己真实拥有**的权威容量约束；
> **不得**把某一业务类型才存在的上界强加于另一类型。

#### 5.2.1 `STANDARD_PURCHASE`（标准采购通知 → 采购入库）

一次转换分配的总量**必须同时**满足：

| 上界 | 权威口径 |
|---|---|
| 通知行可转换剩余 | 通知行数量 − 已转换量（已转换量 **NULL** ⇒ 该行**不提供**可转换容量，409） |
| 有效**采购订单行**剩余 | **供料 PO 行**数量 − 已收货量 − 已分配量（`purchase_order_items`） |
| 交期与容差剩余 | 交期行可消费量 − 已消费量；交期行由 `purchase_order_delivery_schedules` 绑定**供料 PO 行**（`order_item_id`）。**唯一有效交期**可确定性绑定，**多交期必须显式指定** |

- **`STANDARD_PURCHASE` 通知不存在委外订单**：**不得**对其套用委外订单剩余可收量
  （既无 `outsourcing_order_id`，也无委外收货事实可汇总）。
- **零交期 / 多交期归属不明 / 历史容量无法证明** → 一律 fail closed（409
  `RECEIPT_NOTICE_SCHEDULE_UNPROVEN`）；**不得**以省略 `deliveryScheduleId` 的方式绕过上界。

#### 5.2.2 `OUTSOURCE`（委外完工通知 → 委外收货）

一次转换分配的总量**必须同时**满足：

| 上界 | 权威口径 |
|---|---|
| 通知行可转换剩余 | 同上 |
| **委外订单剩余可收量** | `outsourcing_orders.order_quantity` − 累计合格收货量（`outsourcing_receipts`，排除 `CANCELLED`） |

- **`OUTSOURCE` 通知不存在供料 PO 行**：**不得**对其套用采购订单行剩余。
- 委外通知的采购侧是**加工费 PO**（`business_type='OUTSOURCE_PROCESSING'`），但加工费 PO 的交期计量的是
  **加工费交付**、**不是**物料收货数量，因此**加工费 PO 行与其交期都不构成收货容量上界**。
  加工费 PO 行**只**承担"收货明细 ↔ 加工费来源"的可追溯角色（`MC-REQ-05` 的来源链），不承担容量角色。
- 委外订单剩余可收量**不可证明**（历史收货效力未证实） → 一律 fail closed（409）。

**`OUTSOURCE` 通知行可转换剩余的权威口径（M1C-WP2–WP6-R1 登记，2026-11-03）**

`OUTSOURCE` 通知**不**创建 `receipt_notice_item_sources`（§5.1 / MC-REQ-02 已明确该表只承载
`STANDARD_PURCHASE` 来源关系），因此它的"已转换量"由**委外收货明细**侧的来源追溯给出，
而不是由该表的 `converted_quantity` 给出：

| 量 | 权威口径 |
|---|---|
| 通知行数量 | `receipt_notice_items.quantity`（按**真实通知行 ID** 逐行，不按订单粗略分配） |
| 通知行历史有效收货占用 | `SUM(outsourcing_receipt_items.quantity)`，来源行 `outsourcing_receipt_items.source_notice_item_source_id = 通知行 ID`，且 `outsourcing_receipts.business_status <> 'CANCELLED'`（**待检与已生效都仍占用**） |
| 通知行剩余 | 通知行数量 − 历史有效收货占用 − **本次拟收货量**（比较总量含本次） |

- 历史收货若**无法证明**其通知行来源（`source_notice_item_source_id` 为 NULL 或指向已不存在的通知行），
  该订单的通知行剩余容量**不可证明** → 一律 fail closed（409 `RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN`）；
  **不得**按订单总量粗略分摊、**不得**推定归属（§10、MC-REQ-12）。
- 越界一律 409 `RECEIPT_NOTICE_CAPACITY_EXCEEDED`（§9.3），业务零副作用 + 拒绝审计恰好 1 条。
- 换 `Idempotency-Key` **不得**绕过该上界：容量以历史累计占用为准，与请求键无关。

#### 5.2.3 两类共同适用的条件与例外

- **供应商相容性**与**仓库相容性**是两类共同适用的必要条件（不相容即 409）。
- **直接 PO → 采购入库**（无通知）路径**不经过**上述任何通知容量上界，
  只受**采购订单行剩余**与（若存在）交期约束；该路径**必须保持合法**，
  **不得**因通知转换未实施而被取消或收紧（`MC-REQ-02`、`M1C-G01` 的"直接路径仍合法"断言）。

### 5.3 委外材料 → 权威库存

- 发料 / 补料 / 退料是 `MOVE`：各产生 **OUT + IN** 两条物理腿、**同身份严格跟踪腿**、
  以及 `issueValue` + `receiveValue` **成对**估值。
- 倒冲是**单 OUT 增量腿**：**无** IN 腿、**无** `receiveValue`。
- 一律 `trackingMode='EXTERNAL'` + `valuationMode='EXTERNAL'`，
  由调用方在同一外层事务内**显式**调用 canonical 跟踪与估值写者。
- 仓库由 **supplier profile + 物料行绑定**解析；客户端**不得**指定 `fromWarehouseId` / `toWarehouseId`。
- **禁止**裸 `UPDATE` 库存余额、**禁止**硬编码仓库、**禁止**裸写 `inventory_valuation_movements`
  而不更新 `inventory_valuation_balances`、**禁止**跨仓全局平均价。

### 5.4 委外收货 → 成品

- `createOutsourcingReceipt` 改为**表头 + 明细原子写入**，状态置为**待检**（非直接 `CONFIRMED`）。
- `confirmOutsourcingReceipt` 是**生效**动作：门禁通过后写成品入库、倒冲增量、材料成本证据。
- 两者是**两个不同动作**；重复确认与并发转换**不得**重复计入库存、成本或通知数量。

### 5.5 委外订单 → 加工费 PO → 收货来源链（`M1C-D-PO01`）

- 只有 `RELEASED` 委外订单可经显式命令创建一张 `DRAFT OUTSOURCE_PROCESSING` PO；
  创建或 RELEASE 委外订单均不自动创建 PO，也不自动提交或审批。
- 标准 PO、请购转 PO、加工费 PO 必须调用 §3 的同一 canonical draft Writer。
  通用 `POST /api/purchase-orders` 永远只创建 `STANDARD_PURCHASE`，客户端传入类型或
  委外来源字段即 400，不得忽略后继续创建。
- 加工费 PO 恰好一条来源锁定商业行。其 Item ID、order/product/source/supplier、来源数量及
  `document_uom_code`、数量分子分母、换算分子分母、基础数量分子分母创建后不可变。
  商业更新只允许 `DRAFT/REJECTED` 的日期、付款条款、联系/地址快照、备注、单价及派生金额，
  且必须原位 UPDATE；禁止增删替换行或 `DELETE + INSERT`。
- `unitPriceCents` 为非负安全整数分；草稿可为 0，非赠品提交前必须大于 0。数量使用完整
  有理数与 UOM 快照，金额沿既有精确舍入口径计算且不得溢出安全整数。
- `M1C-PO-P02` 已批准：同一委外订单**终身最多一张**加工费 PO；`CANCEL`、同源重建及
  PO Change `ADD/MODIFY` 全部拒绝。共享守卫必须在 PO Change create/approve/apply 三阶段
  各自权威重读后执行，不能只保护 apply。
- OUTSOURCE 完工通知必须绑定唯一且 `APPROVED` 的加工费 PO 和真实唯一 PO Item；
  通知创建、委外收货创建与收货生效均须重读 PO 状态、委外来源、供应商、产品及 UOM。
  `processing_po_item_id` 不得指向任意同供应商行；加工费 PO 行只承担来源追溯，不承担收货容量上界。

## 6. 事务边界与幂等

| 动作 | 事务内必须重读并锁定的权威事实 | 幂等键 |
|---|---|---|
| 标准采购通知创建 / 确认 / 取消 | `createReceiptNotice()`（或其同事务私有 helper）重读 PO/PO 行/交期并原子写表头、明细、来源行与显式初始 0；确认/取消重读通知与来源容量 | `(operation_type, document_id, idempotency_key)` |
| 通知 → 入库转换 | 通知行 + **按 `business_type` 分域**的容量来源（`STANDARD_PURCHASE` = 供料 PO 行 + 交期行；`OUTSOURCE` = 委外订单行） | 同上 |
| 采购入库确认 | 采购订单行 + 交期行 + 库存位 | 同上 |
| 委外收货创建（表头 + 明细） | 委外订单行 + 加工费 PO 行 + 库存位 | 同上 |
| 加工费 PO 显式创建 | 先判定精确幂等重放，再锁定委外订单父行，重读供应商/产品/UOM，检查终身唯一来源 | `(OUTSOURCING_PROCESSING_PO_CREATE, outsourcing_order_id, Idempotency-Key)` |
| 发料 / 补料 / 退料 | 物料行 WIP 余额 + 库存位 + 身份证据层 | 同上 |
| 委外收货生效（倒冲 + 成品） | 累计合格收货量 + 物料行 WIP + 库存位 + 身份证据层 | 同上 |
| 加工费过账（首期拒绝） | 账单行 | 同上（拒绝路径同样幂等） |

**幂等 scope 固定为三元组** `(operation_type, document_id, idempotency_key)`，
与 canonical 财务幂等存储及唯一键**一致**；创建类 API 使用请求期 scope
`create-request:<normalized Idempotency-Key>`。**不得**引入 actor / tenant 维度
（存储、唯一键、查询、锁键、`saveIdempotency` 与全部调用方均无该维度）。

**物理腿 Mutation Key 为五字段**：

```text
<SOURCE_TYPE>:<business_event_id>:<business_event_item_id>:<leg_seq>:<identity_key>
```

四个区分维度分别隔离业务事件、业务项、物理腿与身份子腿。**必须**同时具备两条硬断言：

1. **非预期重放硬拒绝** —— 命中 `inventory_mutation_log` 但内容不符 ⇒ 409
   `INVENTORY_MUTATION_UNEXPECTED_REPLAY`，**不得**静默返回 `replayed:true`；
2. **实际腿数 == 预期腿数** —— 多物料行与 SERIAL 拆分场景下，每条腿各自成键，
   **不得**因撞键丢腿。

外部 `Idempotency-Key` 与物理腿 Mutation Key **严格分离**。

加工费 PO 创建的 fingerprint 只含路由委外订单 ID 与规范化商业输入：可选文本 trim 后缺省为空，
日期为 `YYYY-MM-DD|null`，单价为安全整数，键序固定；不得包含 actor、tenant 或会漂移的服务端
主数据快照。同 Key 同 fingerprint 必须在“已有来源 PO”检查前返回原 PO
`200 + replayed:true`；同 Key 异内容 409。非重放请求在 SQLite 写事务 / MySQL 父行锁内执行，
PO、Item、成功审计与幂等结果原子提交。不同 Key 竞争只允许一方 201，另一方稳定映射为
`OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS`。

`purchase_orders(source_outsourcing_order_id)` 的 UNIQUE 索引是并发最终兜底：标准 PO 该列必须
为 NULL；非空委外来源终身唯一。建索引前必须只读检查重复非空来源并 fail closed；发现冲突时
不得删除、合并或改写历史。本 Design 只批准后续实现该 schema/migration，不授权连接或迁移项目数据库。

## 7. API 矩阵

| Route | 注册状态 | 首期处置 | Gate |
|---|---|---|---|
| `POST /api/receipt-notices` | `EXISTING_REGISTERED` | 扩展行级来源写入 | `M1C-G01` |
| `POST /api/receipt-notices/:id/confirm` | `EXISTING_REGISTERED` | 修正容量不变式（E-06） | `M1C-G01` |
| `POST /api/receipt-notices/:id/cancel` | `EXISTING_REGISTERED` | **不**恢复来源容量 | `M1C-G01` |
| `POST /api/receipt-notices/:id/convert` | **`NEW_DESIGN_TARGET`** | 通知 → 采购入库转换 | `M1C-G01` |
| `POST /api/procurement/outsourcing/orders/:id/processing-fee-purchase-orders` | **`NEW_DESIGN_TARGET`** | 显式创建唯一 `DRAFT OUTSOURCE_PROCESSING` PO；必需 Idempotency-Key | `M1C-G02` / `M1C-G07` |
| `POST /api/purchase-orders` | `EXISTING_REGISTERED` | 仍只创建 `STANDARD_PURCHASE`；拒绝客户端类型/委外来源字段 | `M1C-G07` |
| `PUT /api/purchase-orders/:id` | `EXISTING_REGISTERED` | 加工费 PO 只原位更新商业白名单并保持 Item ID；标准 PO 合同不变 | `M1C-G02` / `M1C-G07` |
| PO Change create / approve / apply | `EXISTING_REGISTERED` | 加工费 PO 的 ADD/MODIFY/CANCEL 三阶段全部拒绝 | `M1C-G07` |
| `POST /api/purchase-receipts` + `/:id/confirm` | `EXISTING_REGISTERED` | 直接路径保持合法；消费交期台账 | `M1C-G01` |
| `POST /api/procurement/outsourcing/receipts` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 表头 + 明细原子写入；状态置待检 | `M1C-G02` |
| `POST /api/procurement/outsourcing/receipts/:id/confirm` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 两段式生效；增量倒冲 + 成品入库 | `M1C-G02` / `M1C-G04` |
| `POST /api/procurement/outsourcing/orders/:id/material-list` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 校验 OUTSOURCE BOM 来源；快照同时承载每单位用量与订单总量 | `M1C-G03` |
| `POST /api/procurement/outsourcing/orders/:id/issues` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 改走 canonical Writer（MOVE 双腿） | `M1C-G03` |
| `POST /api/procurement/outsourcing/orders/:id/supplements` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 同上；**需注册** `OUTSOURCING_SUPPLEMENT` | `M1C-G03` |
| `POST /api/procurement/outsourcing/orders/:id/returns` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 同上 | `M1C-G03` |
| `POST /api/procurement/outsourcing/orders/:id/backflush` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 增量倒冲（单 OUT 腿）+ canonical 估值 | `M1C-G04` |
| `POST /api/procurement/outsourcing/processing-fee-bills` | `EXISTING_REGISTERED` | **草稿创建允许**（账单 `DRAFT`；零 AP / 凭证 / 分录 / 成本证据刷新） | `M1C-G06` |
| `POST /api/procurement/outsourcing/processing-fee-bills/:id/post` | `EXISTING_REGISTERED` | **首期拒绝**（`C-P01..C-P04` 未裁定；委外专用过账入口） | `M1C-G06` |
| `POST /api/supplier-bills/:id/post` | `EXISTING_REGISTERED` | **来源级拒绝**：委外来源账单一律 409；**普通采购账单保持合法**（**共享**入口，`M1C-G06` 必须在此真实入口断言） | `M1C-G06` |
| `POST /api/supplier-bills/:id/match` | `EXISTING_REGISTERED` | **来源级拒绝**：委外来源账单一律 409（现状该路径会改写账单状态）；普通采购账单保持合法 | `M1C-G06` |
| `POST /api/procurement/outsourcing/wip-transfers` | `EXISTING_REGISTERED` | 数量归属守恒保留；**成本携带拒绝**（`B-P01`） | `M1C-G03` / `M1C-G06` |
| `POST /api/procurement/outsourcing/finished-returns` | `EXISTING_REGISTERED` | **首期拒绝**（OUT-22 延期） | `M1C-G06` |
| VMI 结算 / 物权释放 / 账单交接 | `EXISTING_REGISTERED` / 部分**尚不存在** | **首期拒绝**（`D-P01` / `D-P02`） | `M1C-G06` |
| 倒冲差异 preview | `EXISTING_REGISTERED` | **只读 preview**；生效写入拒绝（`B-P02`） | `M1C-G06` |
| `src/pages/outsourcing.jsx`、`src/pages/sourcing-pricing.jsx` | 前端 | 10 处调用点改为 `api(path, options)` | `M1C-G05` |

**`NEW_DESIGN_TARGET` 路由在注册前不得被 Gate 断言为可达。**

## 8. RBAC / SoD

### 8.1 首期最小权限矩阵

#### 8.1.1 既有权限现状核对（源码证据）

| 权限 | 注册位置 | 语义 | 现状持有者 |
|---|---|---|---|
| `OUTSOURCING_MANAGE` | `server/db.js:272`（"管理委外订单"） | 委外**业务操作**：订单创建 / 下达 / 取消（`server/modules/outsourcing.js:13-14`）、用料清单快照（`:224`）、发退补料（`:243/264/282`） | `V13_DESIRED_ROLE_PERMISSIONS`（`server/migrations/v13-phase1-contracts.js:32`）与 `server/db.js` 种子中**无任何角色**持有；仅 `admin` 经 all-permissions 继承 |
| `OUTSOURCING_RECEIVING_MANAGE` | `server/db.js:276`（"管理委外收货与退货"） | 委外**收货**域 | 同上：**无任何角色**持有；仅 `admin` |
| `OUTSOURCING_MATERIAL_EXECUTE` | `server/db.js:274` | 委外材料执行（与 `OUTSOURCING_MANAGE` 并列） | 同上：无角色持有 |
| `IQC_VIEW` / `IQC_MANAGE` | `server/db.js` 权限表 | 质检判定 | `role-warehouse` 持有（见 `server/db.js` 种子） |
| `SUPPLIER_BILL_MANAGE` | **尚未注册**（`M-17` 补） | 供应商账单正式过账 | 当前无普通角色持有；目标按已批准矩阵授予 `role-accounting`（普通采购），`admin` 经 all-permissions 持有但无政策豁免 |

现状 `RECEIVE_PERMISSIONS = ['OUTSOURCING_RECEIVING_MANAGE', 'OUTSOURCING_MANAGE']`
（`server/modules/outsourcing-finance.js:13`、`server/modules/outsourcing.js:9`）⇒ 现状
`confirmOutsourcingReceipt` **允许** `OUTSOURCING_MANAGE`，即**委外业务操作者可自行使收货生效**，
与 `MC-REQ-10`"收货生效必须与委外业务操作分属不同权限"**冲突**。
同理，现状 `FINANCE_PERMISSIONS = ['SUPPLIER_BILL_MANAGE', 'OUTSOURCING_MANAGE']`
（`server/modules/outsourcing-finance.js:14`）⇒ 委外业务角色**可**执行加工费过账，
与 `MC-REQ-10`"委外业务角色不得持有加工费正式过账权"**冲突**。

#### 8.1.2 首期最小权限矩阵（`M1-P-03` 已批准）

| 动作 | 首期权限 | 相对现状 |
|---|---|---|
| 委外订单创建 / 下达 / 取消 / 用料快照 | `OUTSOURCING_MANAGE` | 不变 |
| 委外材料发料 / 补料 / 退料 / 倒冲 | `OUTSOURCING_MATERIAL_EXECUTE` | 委外业务员同时持有 `OUTSOURCING_MANAGE` 与本权限 |
| 委外收货**录入**（表头 + 明细，建待检） | **仅 `OUTSOURCING_RECEIVING_MANAGE`** | **收紧**：移除 `OUTSOURCING_MANAGE` 回退 |
| **委外收货生效**（产生成品库存效力） | **仅 `OUTSOURCING_RECEIVING_MANAGE`** | **收紧**：移除 `OUTSOURCING_MANAGE` 回退 |
| IQC 判定 | 既有 IQC 权限（`IQC_MANAGE`） | 不变 |
| 委外加工费账单**草稿创建** | `OUTSOURCING_MANAGE` | 只登记待裁定事实，不产生 AP/GL；不授予正式过账权 |
| 从委外订单显式创建加工费 PO 草稿 | `OUTSOURCING_MANAGE` | 只创建 DRAFT；不授予采购提交或审批权 |
| 加工费 PO 商业字段修改 | `PURCHASE_ORDERS_CREATE` | `M1C-PO-P01`：真实来源 PO 可由非创建人原位修改白名单；标准 PO creator 限制不变 |
| 加工费 PO 提交 | `PURCHASE_ORDERS_SUBMIT` | `M1C-PO-P01`：真实来源 PO 可由非创建人提交；仍须完整提交门禁 |
| 加工费 PO 审批/驳回 | `PURCHASE_ORDERS_APPROVE` | 独立审批；创建人不得审批自己创建的 PO |
| 加工费**正式过账** | RBAC 层仅认 `SUPPLIER_BILL_MANAGE`；其后仍必须通过独立来源级 Business Policy Guard | **收紧**：移除 `OUTSOURCING_MANAGE` 回退；`M-17` 注册并只授予 `role-accounting`。`admin` 可经 all-permissions 持有，但委外来源账单仍由 Policy Guard 拒绝 |

#### 8.1.3 获批角色矩阵与实施边界

- **收货生效的最低安全授权 = 既有的 `OUTSOURCING_RECEIVING_MANAGE`**：
  该权限**已注册**，语义已覆盖"管理委外收货与退货"，**无需**新增权限。
- **委外业务员**（建议技术 ID `role-outsourcing`）：
  `OUTSOURCING_MANAGE`、`OUTSOURCING_MATERIAL_EXECUTE`；不得持有收货、IQC 或正式过账权限。
- **委外收货员**（建议技术 ID `role-outsourcing-receiving`）：只持有
  `OUTSOURCING_RECEIVING_MANAGE`；收货录入与收货生效统一只认该权限。
- **质检人员**：现有 `role-warehouse` 持有 `IQC_MANAGE`；不得与委外收货生效职责合并。
- **财务人员**：现有 `role-accounting` 持有 `SUPPLIER_BILL_MANAGE`，仅用于普通采购财务业务；
  不得授予委外业务员或其他普通业务角色。
- **管理员**：保留 all-permissions，但命中委外来源后仍受独立 Business Policy Guard 约束，无 409 豁免。
- 上述建议技术 ID 是**待实施角色定义**。本轮未创建角色、未改权限种子；后续 Implementation 必须落地矩阵。
- `M1C-G02` 政策前置已消除，但 Gate 仍 `NOT_RUN`。正向证据必须使用委外收货员角色，
  管理员不得替代职责分离证据。

### 8.2 职责分离原则

- 委外**业务**角色**不得**持有加工费**正式过账**权。
- 委外业务员不得持有 `OUTSOURCING_RECEIVING_MANAGE`；委外收货员不得持有
  `OUTSOURCING_MANAGE`、`OUTSOURCING_MATERIAL_EXECUTE` 或 `IQC_MANAGE`。
- 质检职责不得与委外收货录入/生效职责合并；委外业务员不得持有 `SUPPLIER_BILL_MANAGE`。
- **不得**因现有 `OUTSOURCING_MANAGE` 权限过宽就保留财务越权路径（收货生效与加工费过账两处均收紧）。
- 加工费正式过账 RBAC 只认 `SUPPLIER_BILL_MANAGE`；授予对象按已批准矩阵仅为
  `role-accounting`（普通采购）。委外来源即使通过 RBAC 仍由来源级 Policy Guard 拒绝。
- 授权判定全部在**后端**；前端隐藏不构成授权。

## 9. 不变量、错误与零副作用

### 9.1 首期数量守恒与来源追溯不变量

| # | 不变量 |
|---|---|
| `INV-WIP-1` | 每行 `supplier_wip == legacy_unverified_wip_quantity + verified_tracked_wip + verified_quantity_only_wip`（逐行成立）。**适用域** = `legacy_unverified_wip_quantity IS NOT NULL` 的行；历史行首期为 **NULL = 未证明**，落入 §10 的隔离桶，**不参与**该恒等式的成立判定，也**不**因 NULL 被当作 0 |
| `INV-WIP-2` | `supplier_wip_available == verified_tracked_wip + verified_quantity_only_wip`，恒 `>= 0`；**永不超出**当前 WIP |
| `INV-WIP-3` | **负向动作**（退料 / 倒冲）**不得**消费 `legacy_unverified_wip_quantity` |
| `INV-WIP-4` | 身份证据：`LOT`/`SERIAL` 产品只能由 `evidence_state='TRACKED'` 的余额授权；`NONE` 数量桶**不得**为 LOT/SERIAL 产品提供授权 |
| `INV-WIP-5` | 每个 CONSUME effect 必有 `CONSUMPTION` allocation，且 `Σ allocations == |effect|`；`remaining_supply(source) >= 0` |
| `VAL-1` | 估值 Movement 与 Balance **双写**，数量与价值逐腿对账 |
| `VAL-2` | 材料成本来自 **canonical 位置口径**分摊；**禁止**跨仓全局平均价 |
| `VAL-3` | 委外估值腿必须断言 Movement `status='POSTED'` 且 `inventory_transactions.valuation_status='VALUED'`，否则 409 并整体回滚 |
| `SRC-1` | 每个物理腿携带五字段 Mutation Key；实际腿数 == 预期腿数 |
| `SRC-2` | 每笔业务记录可追溯到订单行 / 加工费 PO 行 / 通知行 / 收货明细 / 库存流水 |
| `QTY-1` | 收货表头总量 == 明细之和 |
| `QTY-2` | **按通知 `business_type` 分别适用**的容量上界同时成立（`STANDARD_PURCHASE` = 通知行 × 采购订单行 × 交期；`OUTSOURCE` = 通知行 × 委外订单剩余可收量）；比较总量包含本次数量；**不得**跨类型套用 |
| `HIST-1` | 历史未证实事实**不**映射为"已生效"；历史记录**不改写** |

### 9.2 零副作用域与拒绝审计的边界

**零副作用域（必须逐字段保持前后一致）** = **业务事实与财务 / 库存状态**：
业务单据与其状态字段、库存数量、跟踪分配、估值 Movement / Balance、AP / AR、凭证、分录、
成本证据、交期台账、来源容量。

**审计行不属于零副作用域。** 因此：

| 拒绝类别 | HTTP | 业务事实 | Domain 拒绝审计 |
|---|---|---|---|
| 请求格式 / 字段校验失败 | 400 | 零变化 | **不写**（非业务门禁拒绝） |
| 业务门禁拒绝（容量、交期、质量门禁、身份证据、延期政策） | 409 | **零变化** | **恰好 1 条**（含业务单据标识 + 精确 error code） |
| 权限拒绝 | 403 | **零变化** | **恰好 1 条**（含主体、动作、被拒权限；**不含**业务单据标识） |

**Gate 的"零副作用断言"必须按上表表述为"业务零副作用 + 拒绝审计恰好 1 条"，
不得表述为"审计全零"** —— 后者与 `MC-REQ-11` 的拒绝审计义务直接矛盾。
403 的拒绝审计由**授权判定失败点**（路由 dispatch 层，`db` 与 `actor` 均可用处）写入，
`allow` / `allowAny` 抛出的 `HttpError(403)` 由该层捕获后写审计并原样重抛。

### 9.3 首期错误码与零副作用

| 场景 | HTTP | error code | 零副作用断言（业务域） | 拒绝审计 |
|---|---|---|---|---|
| 收货缺明细 / 明细为空 | 400 | `OUTSOURCING_RECEIPT_ITEMS_REQUIRED` | 收货 / IQC / 库存 / 估值**零变化** | 不写 |
| 明细产品与加工费 PO 行不匹配 | 409 | `OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH` | 同上 | 恰好 1 条 |
| 质量门禁未通过（生效动作） | 409 | `OUTSOURCING_QUALITY_GATE_NOT_PASSED` | 库存 / 估值 / 成本证据**零变化** | 恰好 1 条 |
| 容量上界越界（按 §5.2 分域判定） | 409 | `RECEIPT_NOTICE_CAPACITY_EXCEEDED` | 收货 / 库存 / 估值 / 通知 / 交期台账**零变化** | 恰好 1 条 |
| 同一完工通知行被重复消费（历史有效收货占用 + 本次 > 通知行数量，见 §5.2.2） | 409 | `RECEIPT_NOTICE_CAPACITY_EXCEEDED` | 同上 | 恰好 1 条 |
| 委外收货生效被重复请求（已生效收货，换 `Idempotency-Key` 或并发进入事务时状态已改变） | 409 | `OUTSOURCING_RECEIPT_ALREADY_EFFECTED` | 收货 / 库存 / 估值 / 成本证据 / WIP 计数**零变化** | 恰好 1 条 |
| 同一幂等键携带不同请求内容 | 409 | `OUTSOURCING_RECEIPT_IDEMPOTENCY_CONFLICT` | 同上 | 恰好 1 条 |
| 加工费金额非法（非安全整数分 / 负数 / 溢出 / 非法字符串） | 400 | `OUTSOURCING_RECEIPT_AMOUNT_INVALID` | 收货 / 库存 / 估值**零变化** | 不写 |
| 委外收货成品成本金额溢出安全整数分 | 409 | `OUTSOURCING_RECEIPT_AMOUNT_OVERFLOW` | 库存 / 估值 / 成本证据**零变化** | 恰好 1 条 |
| 交期不可判定（零 / 多交期 / 历史不可证） | 409 | `RECEIPT_NOTICE_SCHEDULE_UNPROVEN` | 同上 | 恰好 1 条 |
| 转换后重新转换（来源容量未恢复，`T-11`） | 409 | `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN` | 同上 | 恰好 1 条 |
| 委外订单剩余可收量不可证明 | 409 | `RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN` | 同上 | 恰好 1 条 |
| 缺 WIP 仓 / 库存不足 / UOM 不符 | 409 | `OUTSOURCING_WIP_*` | 业务单据 / 库存 / 估值**零变化** | 恰好 1 条 |
| 倒冲基数不受支持（损耗 / 单位换算） | 409 | `OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED` | 物理腿 / 跟踪 / 估值 / 身份层 effect / 计数器**零变化** | 恰好 1 条 |
| 身份证据缺失 / 策略不匹配 | 409 | `WIP_IDENTITY_EVIDENCE_MISSING` / `WIP_IDENTITY_POLICY_MISMATCH` | 同上 | 恰好 1 条 |
| 非预期重放 | 409 | `INVENTORY_MUTATION_UNEXPECTED_REPLAY` | **不得**静默丢弃后续腿 | 恰好 1 条 |
| 采购入库并发重复确认（不同 Key，事务内重读已为 `CONFIRMED`） | 409 | `PURCHASE_RECEIPT_ALREADY_CONFIRMED` | 入库单 / PO 累计量 / 库存 / 跟踪 / 估值 / AP / 凭证**逐字段零变化** | 恰好 1 条；`confirmPurchaseReceipt()` rejection-audit allowlist 精确纳入该 code |
| 委外发料 / 补料的权威 source position 库存不足 | 409 | `OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT` | 发料/补料单、来源仓、WIP、物理腿、跟踪、估值、身份 effect **逐字段零变化** | 恰好 1 条 |
| 委外加工费**正式过账**（首期，含共享入口） | 409 | `OUTSOURCING_GL_POLICY_NOT_APPROVED` | 账单 `status` / `grni_cents` / `variance_cents` **零变化**（保持 `DRAFT`）；**零** AP open item / 凭证 / 分录 / 成本证据刷新 | 恰好 1 条 |
| 委外加工费账单**匹配**（首期，含共享匹配入口） | 409 | `OUTSOURCING_GL_POLICY_NOT_APPROVED` | 账单 `status` / `grni_cents` / `variance_cents` **零变化** | 恰好 1 条 |
| VMI 结算 / 物权释放（首期） | 409 | `VMI_SETTLEMENT_POLICY_PENDING` | 库存位 / 期间 / 结算行 / 账单**零变化** | 恰好 1 条 |
| 倒冲差异生效（首期） | 409 | `OUTSOURCING_DIFFERENCE_APPROVAL_PENDING` | 差异单据 / 库存 / 估值**零变化** | 恰好 1 条 |
| 越权 | 403 | — | 业务 / 库存 / 估值**零变化** | 恰好 1 条（不含业务单据标识） |

**错误断言纪律**：必须**精确**验证 status + error code + 状态不变；
**不得**使用 `201 或 409` 之类的宽松区间掩盖错误。

`PURCHASE_RECEIPT_ALREADY_CONFIRMED` 的唯一新增触发点是 `confirmPurchaseReceiptCore()` 在事务内重读
`purchase_receipts` 后发现 `status='CONFIRMED'`；其他非法状态保持既有语义。其 HTTP caller 的拒绝审计 allowlist
只精确增加该 code，不扩大其他采购拒绝的审计范围。

`OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT` 由 `applyInventoryMutation()` 在权威 source position 已锁定且
`current < quantity` 的检查点按调用方受限参数产生；只有 `executeOutsourcingMove()` 的 SUPPLY 路径传该 code。
Writer 的默认调用方继续保持既有 409/message 行为；不得在上层按 message substring 翻译，亦不得改变普通采购、
库存或其他 Domain 的既有外部语义。两项错误码的实现仍需独立 Implementation Authorization。

### 9.4 委外加工费过账的**来源级**拒绝合同

> **不得**只在委外专用入口拒绝。判定依据是**账单行的商业来源**，不是路由、不是操作人、
> 也不是账单级单一列 —— 现状 `createProcessingFeeBill` **不写** `supplier_bills.commercial_source_type`
> （其值恒为 NULL），因此**只**看该列会漏判。

**判定规则（唯一）**：一张 `supplier_bills` 账单只要存在**任一**行满足
`supplier_bill_items.commercial_source_type = 'OUTSOURCING_RECEIPT_ITEM'`，
即为**委外加工费账单**，其**正式过账**与**匹配**一律拒绝（409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`）。

**两层门禁顺序**：HTTP 入口先执行适用的身份与 RBAC 检查；未授权主体返回 403，且不得在授权前
读取账单来源。已授权 HTTP 请求再执行 Business Policy Guard；普通业务用户、财务用户与经
all-permissions 持有权限的管理员命中委外来源后均返回 409
`OUTSOURCING_GL_POLICY_NOT_APPROVED`。内部服务函数与共享入口同样必须调用这个来源级 Guard、
不得绕过，但内部函数**不要求伪装成 HTTP 403/409**，必须保持项目既有错误传播与异常处理合同；
由 HTTP 边界把领域错误映射为 409。403/409 的拒绝审计分别遵守 §9.2，业务事实均逐字段零变化。

**必须覆盖的入口（逐个列出，不得遗漏）**：

| 入口 | 位置 | 首期处置 | 普通采购账单是否受影响 |
|---|---|---|---|
| 委外专用过账 | `postProcessingFeeBill()`（`server/modules/outsourcing-finance.js:221`） | **拒绝**（现状**会成功过账**并产生 AP payable + 成本证据刷新 —— 是真实缺口） | 不适用 |
| **共享**过账 | `postSupplierBill()`（`server/modules/commercial-golive.js:303`） | **按来源判定拒绝** | **否** —— 普通采购账单仍然合法 |
| **共享**过账路由 | `POST /api/supplier-bills/:id/post`（`server/modules/commercial-golive.js:725`） | **拒绝**（委外来源账单）；`M1C-G06` **必须**在此真实共享入口上断言 | **否** |
| **共享**匹配 | `matchSupplierBill()` / `POST /api/supplier-bills/:id/match`（`:726`） | **拒绝**（委外来源账单）；现状该路径会改写账单 `status` 与 `variance_cents` | **否** |
| 普通采购**自动开票**内部调用 | `autoBillReceipt()` → `postSupplierBill()`（`server/modules/commercial-golive.js:639-641`） | **必须保持合法** —— 其账单行来源是 `purchase_receipt_items`，非委外来源 | **否** |

**判定时序**：拒绝判定必须发生在**任何状态变更之前**（账单 `status` / `grni_cents` /
`variance_cents` 全部不变，且 `ensurePayableSource` / `createSystemVoucher` /
`refreshOutsourcingCostEvidence` **一律不被调用**）。
**不得**依赖"恰好缺少某来源列"这类偶然失败作为拒绝依据 ——
现状 `postSupplierBill` 对委外账单**偶然**被 `supplierBillRecognitionSources`
（内连接 `purchase_receipts`）挡下并返回"供应商账单缺少已确认收货来源"，
那是副作用而非显式拒绝；一旦委外账单行带上 `receipt_id`，共享入口即可过账。

**首期允许的边界（草稿 vs 正式过账）**：

| 动作 | 入口 | 首期处置 |
|---|---|---|
| 委外加工费账单**草稿创建** | `POST /api/procurement/outsourcing/processing-fee-bills` | **允许**：只登记"待裁定事实"，账单 `DRAFT`；**零** AP open item / 凭证 / 分录 / 成本证据刷新 |
| 委外加工费账单**正式过账** | `POST /api/procurement/outsourcing/processing-fee-bills/:id/post` | **拒绝**（409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`） |
| 委外加工费账单**正式过账（共享）** | `POST /api/supplier-bills/:id/post` | **拒绝**（同上） |

因此**不得**出现"一处允许草稿、另一处把全部加工费账单操作一律禁止"的自相矛盾表述：
被拒的是**正式过账与匹配**，不是**草稿登记**。

### 9.5 加工费 PO 错误、审计与零副作用

| 条件 | HTTP / code | 审计 | 零副作用 |
|---|---|---|---|
| 缺 Idempotency-Key、非法字段或格式 | 400 | 不写 Domain 拒绝审计 | PO / Item / 幂等结果均为 0 |
| 无权限 | 403 | 按全局合同恰好一条，且不泄露业务身份 | 不读写业务来源 |
| 委外订单不存在 | 404 | 沿用现有行为；本 Design 不新增 Domain 审计义务 | PO / Item / 幂等结果均为 0 |
| 未 RELEASED、同源 PO 已存在、来源漂移、PO Change 禁止动作或下游来源不符 | 409 + 稳定 code | 恰好一条业务拒绝审计 | 既有 PO、Item、通知、收货、库存、成本逐字段不变 |

合法创建返回 201 并与 PO、Item、幂等结果原子写入恰好一条成功审计；精确重放返回
`200 + replayed:true` 且不新增成功审计。不得为 404 静默扩大审计义务。

## 10. 历史数据 fail-closed

| 事实 | 处置 |
|---|---|
| 历史委外收货的 `business_status='CONFIRMED'` | **不**无条件映射为"已生效"；按可核查证据（库存流水 / 估值流水 / 质量判定 / 成本证据 / 来源明细）判定为"已生效已确认"或"历史未证实"；后者**不开放**新账单与新退货能力，**不改写**历史 |
| 历史 WIP 无 `lot_id` / `serial_id` 列 | 历史身份**不可证** ⇒ 证据层历史行数必为 0；**不得**编造身份分区、**不得**按比例分摊、**不得**推定 LOT/SERIAL |
| 历史 WIP 残差 | **首期不回填**（§4.2）：历史行 `legacy_unverified_wip_quantity` 保持 **NULL = 未证明** ⇒ 落入"历史不可验证"隔离桶，该行**不可**被新的转出或倒冲消费；残差回填属历史治理工作包 |
| 历史转换量 | `converted_quantity` 保持 **NULL = 未证明**（数据库默认 NULL，首期无回填）；该行**不提供**可转换容量（保守预留）；任何路径不得把 NULL 自动改成 0。只有权威生产 Writer 在同一事务首次创建并验证的新来源行才显式初始化 0 |
| M-15 技术性身份键 | **不属于历史业务事实重建**，但本轮仍不执行。未来仅凭已有明确一致字段确定性生成 `LOT:<lot_id>` / `SERIAL:<serial_id>` / 可证明非跟踪的 `NONE`；不明、冲突或撞键即停止。不得由此证明历史 WIP 可用量 |
| 历史通知行的 PO 归属 | **首期不回填**：历史通知行**无来源行** ⇒ 转换路径 fail closed（409 `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN`）；**不推定任何 PO 关联** |
| 历史来源仓 | **首期不回填**：`source_warehouse_id` 保持 **NULL** ⇒ 运行期 409 fail closed |
| 历史加工费 PO 来源唯一性 | 建 `purchase_orders(source_outsourcing_order_id)` UNIQUE 前，必须只读扫描非空来源重复；任一冲突即停止 migration 并报告，不得自动选主、删除、取消、合并或改写历史 |
| 历史加工费 PO 缺来源 / 缺行 / 多行 / UOM 不可证 | 不自动生成来源、不补 Item ID、不匹配同供应商任意 PO；新增通知、收货或商业更新一律 fail closed，只读查询沿既有合同保留 |
| 处置方式 | 只允许 **只读 / 隔离 / fail closed**；大规模治理与会计补偿**延期** |

## 11. SQLite / MySQL 8 相容性

- 全部 additive；两引擎**语义对等**；migration idempotent。
- **唯一性 / 去重**：一般身份去重不得依赖单引擎特性。`M1C-PO-P02` 是明确批准的有界例外：
  `purchase_orders(source_outsourcing_order_id)` 使用两端均支持的“多个 NULL、非空值唯一”语义，
  标准 PO 必须为 NULL，非空委外来源终身唯一；必须以双端 parity 与并发测试证明。
  其他去重不得依赖"NULL 在 UNIQUE 索引中互异"（SQLite）或"生成列摘要"（MySQL）这类单引擎行为。
  `tracked_inventory_movements` 改用 **NOT NULL `identity_key`** + 部分唯一索引。
  该索引的三方向行为如实表述：*重复必拒绝*（两端等价）、*谓词外行*（两端等价）、
  *不同必放行*（MySQL 侧依赖 SHA-256 无碰撞假设，**形式上不等价**）。
- **锁语义**：行锁 / 立即写事务在两端都要有等价实现；不得只在单引擎下正确。
- **DDL 自动提交**：migration 按已完成步骤**幂等可重放**；部分完成后的重试语义必须显式定义。
- **CHECK 约束**：`outsourcing_receipts.business_status` 当前**无 CHECK**，新增状态值**无需**重建表。
- **parity 断言**：新增表 / 列 / 索引 / 状态的**成员集合**在两端必须一致；
  运行时刻类字段（如"检测到未解析"的时刻）**明确排除出 parity**。

## 12. 移动端有限修复（`M1C-G05`）

- `src/pages/outsourcing.jsx` 有 **5 处**、**`src/pages/sourcing-pricing.jsx` 有 5 处**调用
  `api.get` / `api.post`；而 `src/api.js:21` 导出的 `api` 是**函数**（`api(path, options)`），
  **不存在** `api.get` / `api.post` ⇒ 两页在运行时抛 TypeError。
- 修复方式：改为 `api(path, { method, body })`；**不**扩展 `api` 对象。
- 验证：真实浏览器走完入口 → 列表 → 详情 → 提交 → 错误展示；宽度 320 / 390 / 430 / 680；
  服务端 RBAC 生效（无权用户被 403）。
- **不**重做 MobileShell、导航或视觉体系；**不**交付完整现场移动工作流（另立工作包）。

## 13. M1-Core Gate

### 13.1 首期 Gate 定义（7 个；`execution_status` 列为 **Design 批准时点快照**）

> **`execution_status` 语义与当前状态权威**：下表 `execution_status` 列记录的是 **Design 批准时点**
> 的执行状态快照（当时 7 个 Gate 均未执行）。该列**不随 Gate 执行结果更新**，本文件**不复制**
> Gate 的 `PASS` / `FAIL` 状态，也不承载验收执行流水（AGENTS.md §2.1）。
> **当前**执行与验收状态以 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 为
> **唯一权威**；各 Gate 的正式 Acceptance 证据见 [`docs/acceptance/`](../acceptance/)。
> 七个 Gate 的**业务合同**（前置数据创建方式、证据层、成功断言、拒绝断言、零副作用断言）以下表为准，
> 不受执行状态影响。

证据层级：`L1` = 生产 API 造数；`L2` = 直接调用领域函数；`L3` = 直接 SQL 造数
（**不可**作为通路证据）。

#### 13.1.1 `M1C-G03` Mutation Key 证据分层

`issueMaterial`、`supplementMaterial`、`returnMaterial` 在外部幂等检查后由服务端生成唯一 `eventId`；合法 HTTP
输入不包含该 eventId 或物理腿 Mutation Key。因此合法生产 HTTP 当前不能主动触发
`INVENTORY_MUTATION_UNEXPECTED_REPLAY`，不得为制造碰撞而向 HTTP 暴露内部 key。G03 固定分层为：

| 层级 | 权威断言 |
|---|---|
| L1 生产 HTTP | 同外部键同内容为 200 replay 且无第二次动作；同键异内容为稳定 409 且业务事实逐字段零变化；不同外部键各获唯一内部 eventId；实际物理腿数等于预期腿数 |
| L2 canonical inventory primitive | 同一五字段 Mutation Key：同指纹只 replay；异指纹 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；无物理腿、跟踪、估值或 mutation log 部分写入 |

L1 不冒充能触发内部碰撞，L2 不替代真实 HTTP 正向通路。Writer 对同 key 异指纹的唯一键冲突必须整体回滚，
不得静默忽略任何物理腿。若后续要求 L1 同键异内容具有独立精确 code，使用已批准候选
`OUTSOURCING_MATERIAL_IDEMPOTENCY_CONFLICT`，但仍须独立 Implementation Authorization。

| Gate | 前置数据创建方式 | 证据层 | 成功断言 | 拒绝断言 | 零副作用断言 | `execution_status` |
|---|---|---|---|---|---|---|
| `M1C-G01` | L1：`createReceiptNotice()` 经兼容单 PO 与多 PO `sourceAllocations` 创建标准采购通知 → 转换 → 采购入库；另建 OUTSOURCE 通知与无通知直接 PO → 采购入库路径 | HTTP + SQLite/MySQL | `createReceiptNotice()`（或其同事务私有 helper）原子创建表头、明细、已验证来源行与显式初始 0；转换模块不创建来源行；新建后部分转换成立且累计量正确增长；重放不重置、不重复扣减；行级多 PO 来源成立；OUTSOURCE 不写标准采购来源行；容量上界**按通知 `business_type` 分域**；交期消费进入不可变台账；直接路径仍合法 | 历史 NULL 行拒绝且历史数据零改写；来源分配和不等于通知行、PO/产品/供应商不匹配、交期不可判定、容量越界、委外订单剩余不可证明、转换后重转均精确拒绝 | 拒绝时收货 / 库存 / 估值 / 通知 / 来源累计量 / 交期台账**逐字段零变化** + 拒绝审计恰好 1 条 | `NOT_RUN` |
| `M1C-G02` | L1：委外订单 → 显式创建/提交/独立审批加工费 PO → OUTSOURCE 完工通知 → 待检收货（带明细）→ IQC → 生效；正向主体必须为已配置的委外收货员，管理员不得替代 | HTTP + Quality + Inventory | 加工费 PO 为唯一单行来源且 `APPROVED`；通知、收货创建与生效逐段重读 PO/Item 来源；表头与 **≥1 条明细**原子落库；IQC 从正式明细可达；建待检与确认效力分离；生效后成品与成本证据一致 | 缺/未审批/错来源 PO、错 PO Item、缺明细、来源不匹配、质量门禁未过均精确拒绝；`OUTSOURCING_MANAGE` 单独持有时执行收货录入或生效 → 403 | 拒绝时 PO / Item / 收货 / IQC / 库存 / 估值 / 成本证据**逐字段零变化** + 拒绝审计恰好 1 条 | `NOT_RUN` |
| `M1C-G03` | L1：物料行 → 发料 / 补料 / 退料；L2：仅验证 HTTP 不可达的 strict Mutation Key 碰撞 | HTTP + Inventory / Valuation snapshots；L2 primitive | 沿 canonical 仓位写**真实**物理库存、跟踪与估值；企业所有权不变；内部仓与 WIP 仓数量与流水可对账；多物料行与 SERIAL 拆分各自成键，实际腿数 == 预期腿数 | L1：缺 WIP 仓、库存不足、UOM/身份异常及同外部键异内容精确拒绝；L2：异指纹同 Mutation Key 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；重放幂等 | 拒绝时业务单据 / 库存 / 跟踪 / 估值 / 身份层**逐字段零变化** + 拒绝审计恰好 1 条；L2 不冒充 L1 | `NOT_RUN` |
| `M1C-G04` | L1：发料 → 分批完工 → 生效 | HTTP + Valuation snapshots | 增量倒冲公式正确；材料成本来自 canonical 位置口径分摊（**非**全局平均价）；成品经唯一 Writer 入企业仓；OUT-21 成本证据 = 实际倒冲材料账面价值 + 加工费 | **可达的 L1 业务拒绝**：本次增量 `> remaining + 1e-9` → 409 `OUTSOURCING_WIP_INSUFFICIENT`，业务事实逐字段零变化、拒绝审计恰一；BOM 快照／基数不受支持 → 409 `OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED`。**异常数据防御拒绝**：`incremental < 0` → 409 `OUTSOURCING_WIP_INSUFFICIENT`；该状态在已批准的状态迁移、BOM 快照与事务不变量成立时未发现合法 L1 HTTP 构造路径；由受控 L3 历史异常种子 + 生产 HTTP 的 D-1（backflush）与 D-1-C（confirm）证明 fail closed，**不得**列为合法 L1 正向造数。重复确认仍不得双扣／双收入库 | 拒绝时业务事实逐字段零变化 + 拒绝审计恰好 1 条；重复 / 并发时零重复扣减、零重复入库 | `NOT_RUN` |
| `M1C-G05` | 无（浏览器） | Browser | 两个工作面无 `api.get/post` TypeError；320 / 390 / 430 / 680 四宽度交互成功；服务端 RBAC 生效；**不含**视觉体系重做 | 无权用户访问 → 页面级处理 + 服务端 403 | — | `NOT_RUN` |
| `M1C-G06` | L1：委外加工费草稿创建、专用/共享 POST、共享 MATCH、普通采购自动开票内部调用链及普通采购共享入口回归；并覆盖其余延期危险写入 | HTTP + Finance + Inventory snapshots | HTTP 危险写入精确拒绝；管理员与持财务权限主体通过 RBAC 后由来源级 Guard 返回 409；未授权主体在读来源前 403；内部服务调用同一 Guard 并按既有异常合同传播；委外草稿仍为 `DRAFT`；普通采购创建/匹配/过账仍合法 | 管理员和财务主体命中委外来源 → 409；未授权主体 → 403 且不泄露来源；专用 POST、共享 POST/MATCH 与内部服务均不可绕过；普通采购同链路成功 | **零** AP open item / 凭证 / 分录 / 库存位 / 结算行 / 账单 `status` / `grni_cents` / `variance_cents` / 成本证据写入（逐字段零变化）+ 拒绝审计恰好 1 条 | `NOT_RUN` |
| `M1C-G07` | L1：全部 Core 业务对象经生产 API 造数，含加工费 PO 正式创建/提交/审批 | HTTP + Real MySQL 8 concurrency | 生产 API 端到端**无手写 SQL 造数**；加工费 PO Item ID 经商业更新保持稳定；运行时 PO/Item Writer/Mutator 有 zero-bypass proof；SQLite / MySQL 行为对等；同源不同 Key 并发只一方成功 | 同 Key 异内容、同源第二张、PO Change ADD/MODIFY/CANCEL、通用 PO 类型注入及来源篡改均精确拒绝 | 拒绝方 PO / Item / 幂等 / 审计及下游快照逐字段相同（不得只断言数量） | `NOT_RUN` |

**`M1C-G04-D2` 证据层级／可达性限定（2026-11-07）**：
`incremental = perUnitQuantity × cumulativeEffectiveFinished − backflushedQuantity`。合法 L1 HTTP 的净供应不足
由 WP-G 证明；历史 MySQL CR-07/08 仅补充其已真实执行的竞争子集，不据此推导 G07 败方全字段证据已经闭合。
负增量守卫不得删除；D-1／D-1-C 的 SQL 仅作为有标记的 L3 历史异常种子，随后调用生产 Handler，其结论仅为
防御性 409 + 业务事实逐字段零变化 + 拒绝审计恰一。合法路径不可达判断以 §9.1 的状态单向迁移、BOM 快照冻结、
`backflushed_quantity` 仅由合法正增量写入及事务内权威重读等不变量成立为前提，并受浮点残差有限枚举、历史存量
未核查的限制；不同 Mutation Key 的并发正确性也不能仅由 `inventory_mutation_log.idempotency_key UNIQUE` 推导。
本修订不改变 G04 成功语义、零副作用、账面成本、成品唯一 Writer、RBAC/SOD 或首期严格支持范围。

#### 13.1.2 `TC-01 / M-15` 条件前置

它不是第 8 个 Gate，不改变 7-Gate 结构。当前 schema parity 明确断言
`tracked_inventory_movements` 尚无 `identity_key`；在 M-15 Implementation 获批并进入 canonical current schema
前，涉及该列/唯一索引的 G03/G04/G07 parity 断言保持 BLOCKED。

- **A — 全新 disposable MySQL**：未来 M-15 实现进入 canonical schema 后，空目标可以通过 current-schema
  bootstrap 直接建立目标列、约束和索引，并验证新写入/并发唯一性。Gate 不得为了测试调用历史 Migration/M-15；
  空表 PRE-A/B/C 的 0 行结果只说明该空库无冲突，不证明任何历史数据库迁移完成。
- **B — 现有历史数据库**：必须另获 Migration 与 destructive 授权，按 §4.4/§4.4.1 在真实历史数据上执行
  PRE-A → additive column → 确定性规范化 → PRE-B/PRE-C → unique index。缺来源、身份不明/双身份、策略不一致
  或撞键即停；不得删、并、伪造、覆盖非空 identity 或无条件归为 `NONE`。

G03/G04/G07 仍须取得三类允许身份键的确定性映射、不可判定/撞键停止且零改写、SQLite/MySQL 对等，以及唯一
索引未建立时相关写入 fail closed 的证据。空库 G07 不得外推为历史 Migration PASS。

#### 13.1.3 `M1C-G07` 同步合同与 CR-01～CR-09

全部正向业务对象必须由生产 HTTP 创建。每项至少两个独立应用进程/数据库 session；控制 session 先持有
`mysql_transaction_gates(gate_id=1) FOR UPDATE`，同时发出两条真实 HTTP，并通过 `performance_schema` lock-wait
与请求在途状态证明二者已到达事务门后再释放。控制 SQL 只做同步，不创建或修改业务对象；不得以 `sleep` 猜竞争。
胜者身份可以不确定，但“恰一成功 + 恰一指定失败 + 最终逐字段快照”必须唯一。

原 CR-01“确认通知与转换通知竞争新增容量”被取代：通知创建已把 allocation 计入 outstanding reservation，转换
只把既有 reservation 形成 receipt，不新增 used quantity；DRAFT 确认与转换也没有共同合法初态。CR-01 固定为
两个通知创建请求竞争同一 PO Item / delivery schedule。

| CR | 两条真实 HTTP / 权威资源 | 初始量与唯一结果 | 失败 status/code | 逐字段快照 |
|---|---|---|---|---|
| `CR-01` | 两次 `POST /api/receipt-notices`，body 使用不同 `idempotencyKey`；同 P1/S1 | PO Item 与交期 capacity=10、used=0；6 vs 6；恰一 201 | 409 `RECEIPT_NOTICE_CAPACITY_EXCEEDED` | 恰一 DRAFT 通知/行/source allocation=6；outstanding=6、ledger=0；无 receipt/库存/估值/AP/凭证；败方无第二业务对象/幂等结果，拒绝审计恰一 |
| `CR-02` | 两次 `POST /api/purchase-receipts/:id`；同一 DRAFT receipt，不同 Key | receipt qty=10；恰一 200 | 409 `PURCHASE_RECEIPT_ALREADY_CONFIRMED` | receipt 状态、PO 累计量、库存/跟踪/估值、AP/凭证、幂等与成功/拒绝审计均唯一 |
| `CR-03` | 两次 `POST /api/procurement/outsourcing/receipts/:id/confirm`；同一待检 receipt，不同 Key | finished qty=4、WIP 足量；恰一 200 | 409 `OUTSOURCING_RECEIPT_ALREADY_EFFECTED` | 成品、倒冲、估值、成本、状态/version、幂等和审计均只一份 |
| `CR-04` | 两次 `POST .../orders/:id/issues`；同 material row/source position identity | source=10；6 vs 6；恰一 201 | 409 `OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT` | source=4、WIP=6；恰一 issue；MOVE 两腿/跟踪/估值/WIP effect/幂等/审计唯一；败方业务全零 |
| `CR-05` | 两次 `POST .../orders/:id/supplements`；同 material row/source position identity | source=10；6 vs 6；恰一 201 | 409 `OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT` | source=4、WIP=6；恰一 supplement；物理腿/跟踪/估值/WIP/幂等/审计唯一；败方业务全零 |
| `CR-06` | 两次 `POST .../orders/:id/returns`；同 material row/WIP identity | WIP=10；6 vs 6；恰一 201 | 409 `OUTSOURCING_WIP_INSUFFICIENT` | WIP=4、source 回入=6；恰一 return；身份余额/腿/估值/幂等/审计唯一 |
| `CR-07` | 两个不同 receipt 各 `POST .../receipts/:id/confirm`；同 order/material/WIP identity | order=10、per-unit=1、WIP=6；两张各 qty=4 且均 IQC PASS；恰一 200 | 409 `OUTSOURCING_WIP_INSUFFICIENT` | 恰一 EFFECTED/一张保持 PENDING_INSPECTION；backflush=4、WIP=2、成品=4；材料只消费 4，成品成本=实际材料成本+胜者加工费；败方业务/库存/估值/成本全零，拒绝审计恰一 |
| `CR-08` | 一次 receipt confirm 与一次 `POST .../orders/:id/returns`；同 LOT/SERIAL WIP identity | identity WIP=1，backflush=1，return=1；恰一成功 | 另一方 409 `OUTSOURCING_WIP_INSUFFICIENT` | identity 余额非负守恒；confirm 胜则一份成品/成本，return 胜则一份 source 回入；败方全零 |
| `CR-09` | 两次 `POST .../orders/:id/processing-fee-purchase-orders`；同 RELEASED order，不同 Key | 恰一 201 | 409 `OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS` | 恰一 PO/稳定 Item/成功幂等与审计；拒绝审计恰一；同源 PO 终身唯一 |

CR-07 前置必须经生产 HTTP 完整建立：创建/下达委外订单与材料快照、创建并审批加工费 PO、分别创建并确认两张
OUTSOURCE 通知、分别创建两张委外收货、分别完成 IQC PASS。若实现审查发现该链不能产生两张合法待检收货，
CR-07 必须 BLOCKED 并返回 Design 裁定；不得用 CR-03 的同收货重复确认冒充独立 CR-07。

**不纳入首期**（随延期能力移出）：`RACE-01`（Sourcing allocation）、`RACE-02`（PR→PO）、
`RACE-03`（PO Change vs Receipt）、`RACE-06`（Purchase Return vs Bill）、`RACE-07`（Planning handoff，
其 exactly-once 实现**已存在**，剩余为证据）、`RACE-10`（加工费账单）、`RACE-11`（VMI 物权转移）、
`RACE-10a`（会计政策区间）、`RACE-11a`（VMI 结算期间重叠）。

#### 13.1.4 `M1C-G07` ACK-4 与专用入口

全局 destructive 安全合同以 `solution.md §15.1` 为唯一跨 Domain 权威；本节只规定 M1 manifest。批准后的目标入口为：

```text
pnpm test:mysql:m1-core -- --run-id <uuid-v4>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 \
  -Script test:mysql:m1-core -RunId <uuid-v4>
```

`scripts/gates/mysql-m1-core-gate.mjs` 只注册 M1-Core schema parity、真实 HTTP Handler 多 session 竞态和
SQLite/MySQL 对等 suite；不得运行 `race_probe_generic`，不得 SQL 造正向业务单据。M1 单次 operation manifest
固定且有序为 `RESET_SCHEMA_PRE_RUN`、`BOOTSTRAP_CURRENT_SCHEMA`、`RUN_M1_HTTP_FIXTURES`、
`CLEANUP_SCHEMA_POST_RUN`，不接受通配/追加；不授权 CREATE/DROP DATABASE、账号/权限变更、M-15、Migration、
其他 Gate 或任意脚本。

四重 ACK 中 ACK-1～3 已有实现；ACK-4 设计现已 `APPROVED / NOT_IMPLEMENTED`。任何缺失、过期、已消费、
target/SHA/operation 漂移、工作树不净、直接 Node、未登记 child 或 cleanup 未证明路径一律 BLOCKED。只能在精确
disposable target 上、于 ACK-4 Implementation 和独立安全审查通过后，再取得**本次 run**的明确授权执行。
**本次 Promotion 未运行、也不授权运行任何 MySQL Gate。**

### 13.2 旧 13 Gate → M1-Core Gate / DEFERRED / SUPERSEDED 逐项映射

> 旧 Gate 编号与状态来自 `docs/requirements/procurement-outsourcing.md` §31.12.9 与旧候选设计 §26.33.12。
> 旧 Gate 的 `execution_status` **13/13 `NOT_RUN`**、`readiness_status` 9 `NOT_RUN` + 4 `BLOCKED`
> **保持不变**；本映射**不**将任何旧 Gate 记为 PASS。

| 旧 Gate | 旧内容 | M1-Core 处置 | 目标 | 理由 |
|---|---|---|---|---|
| `M1-GA01` | 委外收货生产 API 写表头 + 明细、来源正确、IQC 从正式明细可达 | **吸收** | `M1C-G02` | 首期核心能力，直接对应 |
| `M1-GA02` | Standard PO→Notice→Purchase Receipt、多 PO 合并与行级部分转换、容量上限 | **吸收** | `M1C-G01` | 首期核心能力，直接对应 |
| `M1-GA03` | OUTSOURCE Order/PO→完成通知→待检收货→IQC→确认入库 | **吸收** | `M1C-G02` | 与 GA01 同属委外收货链，合并为一个可执行 Gate |
| `M1-GB01` | 委外发料/补料/退料沿 canonical 仓位写真实库存 | **吸收** | `M1C-G03` | 首期核心能力，直接对应 |
| `M1-GB02` | 分批完工、倒冲增量、真实估值 Writer、成本证据一致 | **吸收** | `M1C-G04` | 首期核心能力，直接对应 |
| `M1-GB03` | 倒冲差异方向与审核、跨单 WIP 迁移成本守恒 | **DEFERRED** | `M1C-G06`（只读 preview + 生效拒绝 + 成本携带拒绝） | 依赖 `B-P01` / `B-P02`；首期差异只读、WIP 转移成本保持 `UNVERIFIED_COST` |
| `M1-GC01` | 加工费部分账单容量、缺字段 4xx、重复 POST、关闭期间拒绝 | **DEFERRED** | `M1C-G06`（首期一律拒绝 + 零副作用） | 加工费账单能力整体延期；其"危险写入必须被安全拒绝"部分由 G06 接管 |
| `M1-GC02` | 经批准会计政策下的 Bill→AP→Voucher→Payment 对账 | **DEFERRED** | `M1C-G06` | 依赖 `C-P01..C-P04`；首期 GL 一律不产生 |
| `M1-GD01` | VMI 期间汇总、Owner Change 物理净 0 | **DEFERRED** | `M1C-G06` | 依赖 `D-P01`；首期 VMI 结算与物权释放一律拒绝 |
| `M1-GD02` | VMI Supplier Bill / AP 自动形成 | **DEFERRED** | `M1C-G06` | 依赖 `D-P02` |
| `M1-GU01` | 两个移动工作面无 `api.get/post` TypeError、四宽度交互、server RBAC | **吸收** | `M1C-G05` | 首期核心能力（`SRD-02`），直接对应 |
| `M1-GT01` | 11 项 MySQL 同资源竞争全部调用真实 Domain Handler | **SUPERSEDED（缩减）** | `M1C-G07`（`CR-01..CR-08`） | 首期按 Core 实际 mutation 选取；11 项中 7 项随延期能力移出；**核心链的真实库存 / 事务 / 幂等 / 并发验证未被删除** |
| `M1-GT02` | UAT-14 正向 VMI Owner Dimension；库存 UAT-20 全段 +50 算术 + 独立 `OWNER_CHANGE` Handler Gate | **拆分** | UAT-14 **oracle 纠正** → `M1C-G07`；`OWNER_CHANGE` 独立 Handler Gate 与 UAT-20 → **DEFERRED**（随 VMI 结算） | UAT-14 oracle 纠正（创建 201 / 确认 200）是 §31.12.6 D-REQ-03 的**已批准 Requirement 义务**，落在 VMI **收货**（未延期），因此由 G07 承接；`OWNER_CHANGE` 属 VMI-05 物权释放（已延期） |

**M1-Core 包级 Acceptance ≠ M1 全域 Closure Acceptance。** 旧 13 Gate 继续作为
**M1 全域 Closure** 的验收合同；新 7 Gate 是 **M1-Core 首期包**的验收合同。两者不得互相替代。

### 13.3 Gate 治理规则

- 7 个 Gate 的 `execution_status` 列记录 **Design 批准时点**的快照（当时全部 `NOT_RUN`）；
  **当前**执行与验收状态以 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 为
  **唯一权威**，本文件不复制 Gate 的 `PASS` / `FAIL`。本节其余规则为**执行前置条件**，
  与当前执行状态无关：任何 Gate 若以手工 SQL 造数替代业务可达性、以延期能力的未裁定状态冒充通过，
  或未创建/配置委外收货员便把 `M1C-G02` 的**正向**收货生效断言标记通过，
  都**不得**签发对应能力的 `COVERED`。
- **零副作用的统一表述**：按 §9.2 的零副作用域，所有 Gate 的零副作用断言一律为
  "**业务**事实逐字段零变化 + 拒绝审计**恰好 1 条**"；**不得**表述为"审计全零"。
- 任一 Gate `NOT_RUN` / `FAIL`、以手工 SQL 造数替代业务可达性、以延期能力的未裁定状态冒充通过、
  或未创建/配置委外收货员便把 `M1C-G02` 的**正向**收货生效断言标记通过，
  都**不得**签发对应能力的 `COVERED`。
- 延期 Gate **不再**作为 M1-Core Design 接受的全局阻塞项；但延期能力仍受 §9.2–§9.4 的**拒绝边界**约束，
  且由 `M1C-G06` 验证（**含共享入口**）。
- MySQL destructive Gate 必须遵守 `solution.md §15.1` 与本文件 §13.1.4，使用精确 disposable target、完成
  ACK-4 一次性消费并取得逐次明确授权；ACK-4 未实现或 cleanup/quarantine 未闭合时一律不得执行。本轮未执行。

## 14. 现状风险核对（本轮逐项复核）

> 下列均为**对生产源码的静态核对结论**，**不是**修复完成声明。
> 每项的"首期处置"是**设计要求**，其实现状态在首期 Implementation 完成前一律记为 `NOT_IMPLEMENTED`。

| # | 现状事实（源码证据） | 首期处置 | 实现状态 |
|---|---|---|---|
| `RISK-1` | `server/modules/outsourcing.js` 与 `server/modules/outsourcing-finance.js` 中 `applyInventoryMutation` / `postCanonicalTrackedLeg` / `issueValue` / `receiveValue` 出现 **0 次** —— 业务计数器更新**不等于**权威库存写入 | 改写为经 canonical Writer（§5.3） | `NOT_IMPLEMENTED` |
| `RISK-2` | `createOutsourcingReceipt`（`server/modules/outsourcing.js:344-359`）只写表头，`assertAllowedFields` 不含 items；`outsourcing_receipt_items` 在 `server/` 中**无任何生产 INSERT 写入方**（仅 SELECT 读取方）；且 `business_status` 被硬编码为 `'CONFIRMED'` | 改为表头 + 明细原子写入，状态置待检（§5.4） | `NOT_IMPLEMENTED` |
| `RISK-3` | **CURRENT**：`confirmOutsourcingReceipt`（`server/modules/outsourcing-finance.js:76+`）① 直接 `UPDATE outsourcing_material_list SET backflushed_quantity=...`（`:121`）；② 倒冲估值侧**直接 `INSERT INTO inventory_valuation_movements`**（`:123-124`），**未**更新 `inventory_valuation_balances`，且 `warehouse_id` **硬编码** `'warehouse-001'`；③ 材料成本由 `inventory_valuation_balances` 按 **product_id 全局 SUM** 求移动平均价（`:118`）；④ **成品库存路径 = `INSERT INTO inventory_transactions` + `adjustInventory(...)`（`:130-132`），并未调用 `receiveValue`** —— `server/modules/outsourcing-finance.js` 与 `server/modules/outsourcing.js` 中 `issueValue` / `receiveValue` 命中 **0 次**。因此**成品侧根本没有任何估值腿**（**不是** `receiveValue(value_cents=0)`，也不是其他估值写入）：Movement / Balance 双写未发生，成品价值余额未被更新 | **TARGET**：倒冲改单 OUT 增量腿走 canonical Writer（`issueValue` 成对写 Movement + Balance）；材料成本改位置口径分摊；成品入库走唯一 Writer（`applyInventoryMutation` + `receiveValue`）并断言 `VAL-3` | `NOT_IMPLEMENTED` |
| `RISK-4` | **CURRENT**：`postProcessingFeeBill`（`server/modules/outsourcing-finance.js:221-243`）**无** source-aware 会计政策门禁、**无**期间守卫、**不**产生 GL，但**会**把账单置 `POSTED`、经 `ensurePayableSource` 产生 AP payable、并刷新成本证据 —— 即**现状委外加工费可以正式过账**；`server/` 全仓库 `outsourcing_accounting_polic*` **零命中**。**共享入口无显式来源判定**：`postSupplierBill`（`server/modules/commercial-golive.js:303`）与 `/api/supplier-bills/:id/post`（`:725`）、`/match`（`:726`）**均不按 `supplier_bill_items.commercial_source_type` 判定**；`postSupplierBill` 对委外账单返回的 409 来自 `supplierBillRecognitionSources` 内连接 `purchase_receipts` 的**偶然**失败，而 `matchSupplierBill` 会**改写**账单 `status` 与 `variance_cents` | 首期按**来源级**判定（§9.4）：委外来源账单的**过账与匹配**在委外专用入口与**共享**入口一律 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`；**草稿创建允许**且停留在 `DRAFT`；普通采购账单**不受影响** | `NOT_IMPLEMENTED`（拒绝路径亦待实施） |
| `RISK-5` | VMI 的消耗与物权转移对同一 SUPPLIER 位存在**双扣路径**（`server/modules/procurement-vmi.js`，两者均在事务外读 `business_status`）；结算触发模型未裁定；`server/` 中 `randomUUID()` 用于 4 处业务 ID 生成 | 首期 VMI 结算 / 物权释放 / 账单交接一律拒绝且零副作用；**不**推导触发模型 | `NOT_IMPLEMENTED`（拒绝路径亦待实施） |
| `RISK-6` | `src/pages/outsourcing.jsx`（5 处）与 `src/pages/sourcing-pricing.jsx`（5 处）调用 `api.get` / `api.post`；`src/api.js:21` 的 `api` 是**函数**，`api.get` / `api.post` **不存在** ⇒ 两页运行时 TypeError | 改为 `api(path, { method, body })`；不扩展 `api` 对象（§12） | `NOT_IMPLEMENTED` |
| `RISK-7` | **CURRENT**：`confirmOutsourcingReceipt`（`server/modules/outsourcing-finance.js:77`）与 `createOutsourcingReceipt`（`server/modules/outsourcing.js:345`）**共用** `RECEIVE_PERMISSIONS = ['OUTSOURCING_RECEIVING_MANAGE','OUTSOURCING_MANAGE']`（`:13` / `:9`）⇒ 委外**业务操作**权限 `OUTSOURCING_MANAGE` **可自行使收货生效**；同理 `FINANCE_PERMISSIONS = ['SUPPLIER_BILL_MANAGE','OUTSOURCING_MANAGE']`（`server/modules/outsourcing-finance.js:14`）⇒ 委外业务角色**可**执行加工费过账。二者均与 `MC-REQ-10` 冲突。**授权矩阵现状**：`V13_DESIRED_ROLE_PERMISSIONS`（`server/migrations/v13-phase1-contracts.js:32`）与 `server/db.js` 种子中普通角色不持有 `OUTSOURCING_*`，仅 `admin` 经 all-permissions 继承 | 收货录入/生效只认 `OUTSOURCING_RECEIVING_MANAGE`；加工费过账 RBAC 只认 `SUPPLIER_BILL_MANAGE` 并仅授予 `role-accounting`，其后来源级 Policy Guard 对管理员同样生效；按 §8.1 创建/配置委外业务员与委外收货员 | `NOT_IMPLEMENTED`（角色、授予与两层门禁均待实施） |
| `RISK-8` | **CURRENT**：通用 PO Writer 固定创建标准 PO；加工费 PO 无正式创建入口；`updatePurchaseOrder` 删除重建明细导致 Item ID 不稳定；PO Change ADD/MODIFY/CANCEL 无加工费类型守卫；来源列无唯一约束 | 按 §5.5–§10 建立统一 Writer、原位更新、三阶段 Change 守卫、下游来源重读及最小 UNIQUE 索引 | `NOT_IMPLEMENTED` |
| `RISK-9` | **CURRENT**：`createReceiptNotice()` 以 `Date.now().toString().slice(-10)` 生成 `notice_no`；CR-01 会并发创建两张通知，同毫秒生成相同业务号的碰撞风险尚未由实现证据排除 | G07 Implementation 前必须审计 schema 唯一性、错误传播与并发生成行为；不得让编号碰撞把预期容量 409 退化为未分类约束错误或重复业务号。若修复会改变业务编号语义，必须返回 Design/Owner 裁定；本次 Promotion 不修改编号逻辑 | `OPEN_IMPLEMENTATION_RISK` |

**本节明确不把任何上述现状缺陷写成已修复。**

## 15. 已裁定项与剩余受限边界

### 15.1 待签字项与已裁定项

#### 15.1.1 已由 Design 裁定或降级为**受限行为**（**不阻塞**任何工作包 / Gate）

| ID | 本轮处置 | 依据 | 首期行为 |
|---|---|---|---|
| `A-P01` | **Design 技术接受**（`DESIGN_TECHNICAL_ACCEPTED`）：唯一权威通知模型 = `receipt_notices` + `receipt_notice_items` + `receipt_notice_item_sources`；不新建第二套委外完成通知表 | §31.12.3 `A-REQ-06` 已把该项定性为**物理模型设计冲突**、裁定权属 Procurement Design；业务所有者已于 2026-11-02 在 §31.13 Requirement Acceptance 中正式确认 | 按唯一模型实施；该确认只覆盖 M1-Core，不改变 M1 全范围历史登记 |
| `M1-P-03` | **`APPROVED`**：委外业务员、委外收货员、质检人员、财务人员与管理员按 §8.1 分离 | 业务所有者 2026-11-02 明确批准 | 政策不再阻塞；角色/权限种子仍待 Implementation，`M1C-G02` 仍 `NOT_RUN` |
| `M1C-PO-P01` | **`APPROVED`**：真实来源加工费 PO 允许持相应采购权限的非创建人原位修改商业白名单并提交 | 业务所有者在 `M1C-D-PO01` Promotion 指令中明确批准 | 审批仍须 `PURCHASE_ORDERS_APPROVE`，创建人不得自审；标准 PO creator 限制不变 |
| `M1C-PO-P02` | **`APPROVED`**：一张委外订单终身最多一张加工费 PO；CANCEL、同源重建、PO Change ADD/MODIFY 均拒绝 | 同上 | 以非空来源 UNIQUE 索引兜底；实施前必须历史冲突预检 |
| `A-P02` | 降级为**受限行为**：复杂拒收重开与自动再转换**首期不开放** | 已批准部分（multi-PO、质量门禁、行级容量守恒）不受影响；收缩方向无需签字 | 拒收重开 / 自动再转换类请求一律 409 + 零业务副作用 + 拒绝审计恰好 1 条；**不阻塞**多 PO 与行级部分转换主链 |
| `T-11` | 降级为**受限行为**，并**恢复其原始含义**：`T-11` = **通知转换后取消的来源容量语义**（`converted_quantity` 为历史累计事实、单调不减；取消**不**恢复通知来源容量；重新转换 fail closed） | 旧候选设计 §26.33.13 的 `R4-6` 与其政策登记表均如此定义 | 按上述语义实现；**不得**把 `T-11` 改写为"零交期政策"——零有效交期属**交期上界**的独立技术合同（§5.2.1） |
| 零有效交期路径 | 独立的技术合同，**不**挂在 `T-11` 名下 | §5.2.1 | `STANDARD_PURCHASE` 通知零交期 / 多交期归属不明 / 历史不可证 → 409 `RECEIPT_NOTICE_SCHEDULE_UNPROVEN` |

#### 15.1.2 仅在放宽时仍需业务所有者签字

| ID | 签字内容 | 阻塞的工作包 / Gate | 不签字的后果 |
|---|---|---|---|
| `M1-P-02` | **仅在希望放宽支持范围时**需要签字（损耗计入口径 / 单位换算系数）；收紧方向不需要 | 不阻塞 `M1C-G04`（按严格支持范围 fail closed） | 按严格支持范围执行（首期 fail closed） |

> **首期不再存在"因待签政策而整体无法实施"的工作包。**
> `M1-P-03` 已决定“谁能执行”；`M1-P-02` 只在放宽时相关。Implementation 仍须独立授权。

### 15.2 独立复核结论与剩余风险

1. **M1-P-03 已裁定但尚未实施**：政策阻塞已消除；后续 Implementation 必须创建/配置获批角色。
   `M1C-G02` 正向证据必须由委外收货员取得，管理员不得替代；Gate 当前仍 `NOT_RUN`。
2. **权限与政策仍是两层门禁**：`role-accounting` 与管理员可能通过 `SUPPLIER_BILL_MANAGE` RBAC，
   但委外来源账单仍由独立 Business Policy Guard 拒绝；普通采购账单继续合法。
3. **Core 收敛 vs 全域 Closure**：7 个 Core Gate 通过**不**等于 §31 的 54 项 Capability 处置闭合，
   也不等于 Procurement & Outsourcing 的 Domain Acceptance。
4. **历史隔离的业务影响规模未知**：历史 WIP 残差、历史转换量、历史来源行、历史收货效力缺口的
   影响行数**未实测**。首期**不做任何历史回填**（§4.2），一律 fail closed 执行，
   **可能**造成部分历史订单不可继续；该规模的评估属**独立授权**的历史对账，不在首期。
5. **CR-01 与通知编号风险已重新裁定**：确认通知与转换通知不竞争新增容量；CR-01 改为两个
   `createReceiptNotice()` 请求竞争同一 PO Item / delivery schedule 的剩余容量。实现还必须关闭 §14 `RISK-9`
   的同毫秒 `notice_no` 碰撞风险，且不得用编号碰撞替代容量 409 证据。
6. **加工费 PO 政策已裁定但尚未实施**：`M1C-PO-P01/P02` 不再是政策阻塞；canonical Writer、
   Item ID 稳定、UNIQUE 索引、下游来源重读及 `CR-09` 仍须独立 Implementation 授权和真实证据。

## 16. Rollback 与兼容

| 维度 | 方案 |
|---|---|
| Schema | 全部 additive；**不** DROP、不重建既有表。加工费 PO 追加 `purchase_orders(source_outsourcing_order_id)` UNIQUE 前先做只读冲突预检；冲突即停。回滚 = 停止新代码路径并保留已建立索引/新增对象，除非另获独立 DDL 回滚授权 |
| 数据回填 | **首期零历史业务事实重建、零不可证明补记**（§4.2）。历史业务事实列保持 NULL = 未证明并 fail closed。`M-15` 技术性身份键规范化须另获独立 Migration 授权；本轮不执行，故无反向数据迁移 |
| 行为 | 新能力以**新 handler / 新语义**落地；既有直接 PO → 采购入库路径**保持可用**，不因通知转换未实施而中断；既有普通采购账单路径**保持可用**，不因委外来源级拒绝而中断 |
| 加工费 PO | 停用新委外创建 action 即可停止新增；已创建 PO/Item 保留为历史事实，禁止删除、改写来源或以取消重建规避终身唯一性 |
| 旧候选设计 | M1 全范围旧候选继续留在 `docs/reviews/m1/`，承担延期 C/D 组与历史结论追溯；只有其首期 A/B/U/T 适用结论由本 Active Design 承接。**不得**整体归档或宣称整个 M1 全范围已通过 |
| 迁移重试 | 每个中间状态幂等可重放；失败重跑不重复写、不删历史 |
| Feature 开关 | 危险写入拒绝（§9.2–§9.4）为**默认**行为，不依赖开关；未获批能力**不得**提供"开启"路径 |

## 17. Design Acceptance 与 Implementation 硬性边界

- 本文件**未**修改任何实现代码、测试、schema、migration 或配置。
- 本文件**未**运行任何测试、MySQL、浏览器或 build；7 个 Gate 全部 `NOT_RUN`。
- 业务所有者于 2026-11-02 签发 `M1_CORE_DESIGN_PASS`；该 PASS 只覆盖 M1-Core 首期 Design，
  **不**构成 Procurement Domain Acceptance、Capability Freeze、Manual Closure 或 Release Readiness。
- `A-P01` 保持 **Design 技术接受**且 Owner 已确认；`M1-P-03` 已批准；
  `A-P02` / `T-11` 继续受限，`M1-P-02` 仅在放宽严格支持范围时待签。
- `M1C-PO-P01` / `M1C-PO-P02` 已由业务所有者在本轮明确批准；最小 UNIQUE 索引仅获
  **后续代码实现许可的设计前提**，本轮未授权或执行数据库连接、migration 或 MySQL Gate。
- `M1C-WP7-B0-R1` 已由 Domain Owner、Platform / Database Safety Owner 与用户明确批准；G03 分层、
  CR-01～CR-09、CR-02/04/05 精确错误码及全局 ACK-4 合同现为 Active Design。其状态均为
  `APPROVED / NOT_IMPLEMENTED`，本次 Promotion 不构成 Implementation Authorization。
- 旧候选设计 §26.33 **未被改写**；其 A / B / U / T 部分的结论在本文件 §13.2 有逐项处置映射。
- 旧 13 Gate **未被伪造 PASS**；其状态仍为 13/13 `NOT_RUN`。
- **IMPLEMENTATION HARD STOP**：Design 已批准，但 Implementation 明确为 `NOT_AUTHORIZED`；
  不得自动启动或恢复 `M1C-WP-0` / `M1C-WP-2..WP-7`。

## 18. 本轮结束标识

```text
M1_CORE_DESIGN_PASS
```

> 该标识**只**表示本轮**独立审查问题定点修正**（容量分域、来源级防绕过、WP-1 阻塞划分、
> 草稿 / 过账边界、收货生效授权、WP-0 迁移收敛、RISK-3 事实修正、零副作用与拒绝审计边界）
> **在文档层已完成并由业务所有者批准**；它不是 Domain Acceptance / Freeze / Release Readiness，
> 也**不**授权 Implementation。7 个 `M1C-Gxx` Gate 仍全部 `NOT_RUN`。
