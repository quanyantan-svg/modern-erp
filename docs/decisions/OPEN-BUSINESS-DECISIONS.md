# 开放业务政策与设计决策登记

> 状态：`ACTIVE`
> Owner：业务所有者（业务政策裁定）/ 各 Domain Owner（设计决策）
> 权威来源：**规范正文在对应的 Requirement / Design 中**；本表是决策状态索引，不复制规范正文。
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)
>
> §1.1 – §1.3 的处置依据是 **M1 候选设计**
> [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)
> §26.33.14（源 `solution.md §26.33` @ `912fd76700ff6f3ad1509eec4c9e2241c1830265`）。
> §1.4 的处置依据是 **`M1-SRD-01` 首期范围重定基线决定**
> [`docs/decisions/m1-core-scope-rebaseline-20261102.md`](./m1-core-scope-rebaseline-20261102.md)
> 与 **M1-Core Active Design**
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)。
> 该设计已签发 `M1_CORE_DESIGN_PASS`；`A-P01` 与 `M1-P-03` 的当前状态见 §1.4，
> 其余开放/延期政策不因 Design PASS 自动获批，且 Implementation 仍未授权。

## 1. Procurement & Outsourcing —— M1 集中业务决策登记

规范来源：[`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.12.8
「集中业务决策登记（不重复要求确认已获批规则）」。

> 该 Requirement 明确列出**不再重新征询**的已获批事实：`STANDARD_PURCHASE` / `OUTSOURCE_PROCESSING` 区分、
> 是否支持多 PO 收料、委外材料企业所有权、WIP 是地点而非物权、GL Owner 属 Accounting、
> 采用 Canonical Supplier Bill 等。本表不重复这些条目。

| ID | 归属 | 待定内容（摘要） | 当前约束 | 停止点 | 状态 |
|---|---|---|---|---|---|
| A-P01 | A | 完成通知表 `§26.12` 独立表 vs `§26.20` 复用表，及历史行级来源迁移 | 单一可追溯的通知→收货来源；不得预先强制重复建表 | Procurement Design 前需提供兼容论证 | `OWNER_RATIFICATION_PENDING` |
| A-P02 | A | 完成通知部分转换、拒收/退回重开、剩余量与批号继承边界的 Canonical 细节 | 不改变已获批 multi-PO 与质量门禁；保持行级容量守恒 | 具体规则不可证实时暂停该子项 | `PENDING` |
| B-P01 | B | 跨订单/跨期 Supplier WIP 价值携带（源账面价值、价格差异、转移时点、期间锁） | 数量+成本必须守恒；不创造余额或历史凭证；暂不指定计价方法 | 成本变动前需业务裁定 | `PENDING` |
| B-P02 | B | 倒冲差异生成单据后的审核人、退补单撤销/冲销状态 | 手册方向与审核要求已明确；只待权限/状态细节 | Outsourcing + RBAC Owner，Design 需补充 | `PENDING` |
| C-P01 | C | 委外加工费在收货、暂估、正式过账各时点的金额确认；是否产生及何时冲回 GRNI | 不直接照搬普通采购账务分录 | Finance + Accounting Owner，GL Implementation HARD STOP | `PENDING` |
| C-P02 | C | 加工费会计科目/资本化、价差与税务（进项税适用性） | 不预设 `NO_TAX` 永久正确；不允许伪造凭证模板 | Finance + Accounting Owner，GL Implementation HARD STOP | `PENDING` |
| C-P03 | C | 过账后红冲/贷项与历史无原始凭证数据的处理 | 禁止自动补记不明来源的历史总账 | Finance + Accounting Owner，历史处理 HARD STOP | `PENDING` |
| C-P04 | C | Accounting Domain 未 Domain Closure 时，委外 Source→Canonical Voucher 的有界接入边界 | GL Owner 固定为 Accounting；不创建委外专用第二 GL | 跨域需求批准后设计 | `PENDING` |
| D-P01 | D | VMI 结算窗口（周期/自定义）、消耗与物权转移的前后顺序、可结算数量口径 | 企业仓供应商所有权 + 数量守恒已批准；触发策略未批准 | Procurement/VMI + Finance Owner，结算 Implementation HARD STOP | `PENDING` |
| D-P02 | D | VMI 物权释放数量的协议价格、税与账单日期以及部分结算规则 | 必须产生 Canonical Supplier Bill，不得仅保存客户端传入 ID | Procurement/VMI + Finance Owner，账单 Implementation HARD STOP | `PENDING` |

**影响**：C 组与 D 组政策未裁定时，委外与 VMI 的 GL / 结算实现必须 fail closed；
不得以"先实现再补政策"的方式推进。

### 1.1 §31.12.8 十项集中业务政策的状态更新（2026-11-01）

依据 M1 候选设计 [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)
§26.33.14.1 的原文处置，本表十项**没有一项被批准**，全部保持待裁定：

| ID | 设计给出的技术处置（摘要） | 是否阻塞 Implementation | 状态 |
|---|---|---|---|
| `A-P01` | 唯一权威 = `receipt_notices` + `receipt_notice_items` + `receipt_notice_item_sources`；技术方案已形成，但**状态固定为 `OWNER_RATIFICATION_PENDING`**，**不计入**开放业务政策 | 否 | `OWNER_RATIFICATION_PENDING`（**未批准**） |
| `A-P02` | 部分转换与行级容量已在 `M1-D-02/D-03` 定义；**拒收/退回重开**与**批号继承**仍未定义 | 否（不阻塞 WP-1 主链；相关子项保持 `POLICY_DECISION_PENDING`） | `PENDING` |
| `B-P01` | 设计给出**机制**（`M1-D-12`：转移只改归属、不动实物，成本按 canonical 估值余额分摊携带，期间受 `assertFinancialPeriodsOpen` 约束），**不指定**计价方法 | 是（WP-8 的成本部分） | `PENDING` |
| `B-P02` | 提出 `outsourcing_difference_approvals` + `OUTSOURCING_DIFFERENCE_APPROVE` 的**建议**与 `PREVIEW→ALLOCATED→APPLIED` 状态机 | 是（WP-8 的审核部分） | `PENDING` |
| `C-P01` | 明确**禁止**照搬 `Dr GRNI / Cr AP`；建立 **source-aware 会计政策门禁**：在 C-P01..C-P04 获批前，委外加工费账单**不能过账**（409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`，账单保持 DRAFT，零 AP/GL 写入） | 是（WP-7 **与** WP-5 的过账子项） | `PENDING` |
| `C-P02` | 设计只落实 `tax_mode` 的**显式**选择与 `NO_TAX` 的显式声明；资本化与进项税留待裁定 | 是（WP-7） | `PENDING` |
| `C-P03` | 明确**禁止**自动补记不明来源的历史总账；给出 `accountingProfile` 的兼容式扩展机制；历史缺口登记为 `M1-F-10` | 是（WP-7） | `PENDING` |
| `C-P04` | 界定边界为**只**接入 `createSystemVoucher` 的既有接口，不新建委外专用 GL；角色映射在裁定前不存在 | 是（WP-7） | `PENDING` |
| `D-P01` | 给出 **D-1 / D-2a / D-2b / D-3 四个有界备选**（D-2 按"是否先做 Owner Change"拆为两个子形态）及各自的物理与商业恒等式，**推荐 D-2a**；**不得自动采用任一模型** | 是（WP-4 的触发模型部分、WP-8） | `PENDING` |
| `D-P02` | 明确移除客户端金额与账单 ID；价格必须来自权威源；账单走 canonical Supplier Bill | 是（WP-8 的价格部分） | `PENDING` |

### 1.2 候选设计**新增**登记的开放业务政策（`M1-P-xx`）

以下三项**不属于** §31.12.8 的十项，是候选设计在其内部新发现的、需业务 Owner 裁定的语义待决项。
依据同文件 §26.33.14.2 的 R4-5 权威开放政策清单（共 **12** 项 = §31.12.8 十项中的九项 + 本节三项）。

| ID | 待定内容（摘要） | 阻塞范围 | 状态 |
|---|---|---|---|
| `M1-P-02` | 损耗（scrap）是否计入倒冲基数；BOM 计量单位与物料清单 `unit` 不一致时的换算系数。设计**不自行选择答案** | WP-2 的成本部分 / `M1-GB02` 的成本断言段。**不**阻塞 WP-2 的跟踪与估值合同 | `PENDING` |
| `M1-P-03` | 角色授予矩阵：除 `role-accounting` 外是否设立独立委外业务角色、该角色持有哪些 `OUTSOURCING_*` 权限、`SUPPLIER_BILL_MANAGE` 是否授予其它既有角色 | 本行保留 **M1 全范围候选**在 2026-11-01 的历史状态；M1-Core 首期矩阵已于 2026-11-02 批准，见 §1.4 | `PENDING`（M1 全范围历史） |
| `M1-P-04` | VMI 调整量的关期容差：是否允许非零容差、容差适用到哪一类调整量（供应商池 / 企业池 / 两者）。设计默认容差 = 0（严格） | WP-4 的关期子项 / `M1-GD01`。**不**阻塞 VMI-P/S/E/R/L 恒等式与 `vmi_settlement_lines` 分列实现 | `PENDING` |

**`M1-P-01` 不列入本表**：其主歧义（每单位用量 vs 订单总量）已由**已批准**的 OUT-09 / OUT-08 规则闭合，
其残余归 `M1-P-02`。设计原文亦不得重新列入开放政策。

### 1.3 候选设计登记的源码冲突与跨域移交（`M1-F-xx`）

依据 §26.33.14.3。这些是**登记项**，不改变本表十项政策的状态，也不关闭任何 Gap。

| ID | 处置类别 | 处理方 | 状态 |
|---|---|---|---|
| `M1-F-05` | 历史验收与当前源码的**时序协调**（§31.11 由 `09abeb4` 记录，`consumePlanningHandoff` 由 `4e035c5` 落地，晚约 3 小时 48 分）；§31.11 的历史结论**不得被覆盖** | 本轮 Design 已更正事实陈述；剩余为运行时 + MySQL 并发证据（WP-6 / `M1-GT01`） | 待运行验证 |
| `M1-F-06` | canonical `createSupplierBill` 与委外路径共享「缺 `supplierInvoiceNo` → 500」缺陷；canonical 侧（`commercial-golive.js:283`）**不在** §31.12 范围 | **Finance 域独立授权**；本轮不修改 canonical 侧 | 跨域阻塞 |
| `M1-F-07` | VMI 消耗与物权转移对同一 SUPPLIER 位的**双扣路径**（`procurement-vmi.js:155-173` / `:195-220`） | 依赖 `D-P01` 的模型选择（见 §1） | 依赖 §1 的 `D-P01` |
| `M1-F-08` | `src/pages/inventory-hub.jsx`、`src/pages/inventory-overview.jsx` 调用**不存在**的 `apiClient` 导出 | **Inventory 域独立授权**；本轮不修改 | 跨域阻塞 |
| `M1-F-09` | `quality-gates.js:147-153` 的「可检状态」白名单缺 `PENDING_INSPECTION` | 本轮 Design 已指定技术合同（§26.33.5.1），实现归 WP-3 | 已归入 WP-3 |
| `M1-F-10` | 委外退货会写无原始委外凭证对应的普通采购贷项凭证 | 依赖 `C-P03`（见 §1） | 依赖 §1 的 `C-P03` |
| `M1-F-11` | `vmi_receipts.business_status` 的 CHECK 含 `'CONSUMED'`，但**全仓库无写入** | 是否启用属 VMI 状态裁定；设计明确**不启用**（无业务依据且改变 `getVmiSummary` 语义） | `POLICY_DECISION_PENDING` |
| `M1-F-12` | `audit_logs` 无 `business_date` / `request_id` / before-after 结构化字段，`created_at` 无索引 | **Platform / Finance 域独立授权**；本轮不修改审计 schema | 跨域阻塞 |

**本节不改变 §1 十项政策的任何状态，也不构成任何 Capability 的 `COVERED` 或任何 Acceptance / Freeze。**
G-5（UAT-14 旧 oracle 与 V21 合同冲突）的处置动作已由 `document.md §31.12.6`（D-REQ-03）**批准**，
它是 **Implementation 内的已批准纠正动作**，**不是**业务政策待决项（见 §3）。

### 1.4 M1-Core 首期政策处置（2026-11-02，依据 `M1-SRD-01`）

> 本节只登记**处置与状态**，不复制 Requirement / Design 正文。
> 规范正文：[`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.13
> 与 [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)。
>
> **状态含义**（M1-Core 首期专用于表达"首期范围已收敛、但业务政策尚未签字"这一中间态）：
>
> | 状态 | 含义 | 是否需要业务所有者签字 |
> |---|---|---|
> | `APPROVED_SCOPE_DECISION` | 范围决定本身已批准（SRD-01 / SRD-02 / SRD-03） | 否（已签） |
> | `CORE_LIMITED_PENDING_OWNER` | 已提出**首期限定规则**建议；首期按该建议 fail closed，**放宽**支持范围需签字 | **是**（仅放宽需签；收紧/拒绝不需要） |
> | `DESIGN_TECHNICAL_ACCEPTED` | 该项的裁定权属 **Design**（物理模型 / 技术选择），已由候选 Design **技术接受**；**不**是业务政策，**不**需业务所有者另行追认 | **否**（业务所有者在 Requirement 验收时**一次性确认**，不另设独立签字项） |
> | `OWNER_RATIFICATION_PENDING` | 已有技术方案，缺业务所有者对**该方案**的追认 | **是** |
> | `DEFERRED_PENDING_POLICY` | 延期且待政策裁定；首期**必须**拒绝其危险写入且零副作用 | 延期后需要 |
>
> **以上状态都不等于 Implementation 许可**，也都不等于该政策的业务内容已获批准。

#### 1.4.1 已批准的范围决定（`APPROVED_SCOPE_DECISION`）

| ID | 内容 | 状态 | 首期效力 |
|---|---|---|---|
| `SRD-01` | M1-Core 首期范围：采购通知/来源转换/IQC/采购入库；委外订单/BOM 用料/发退补料/Supplier WIP；委外完工通知/正式收货明细/质量门禁/合法增量倒冲/成品入库；必要的 canonical Inventory/Tracking/Valuation、数量守恒、来源追溯、事务、幂等、权限与审计 | `APPROVED_SCOPE_DECISION` | 界定 §31.13 的 IN SCOPE |
| `SRD-02` | 移动端阶段划分：首期只修现有工作面的 API 调用、基本交互错误、权限与错误展示，维持 `U-REQ-01` 的有限目标；完整现场移动工作流另立工作包 | `APPROVED_SCOPE_DECISION` | 界定 §31.13 `MC-REQ-13` 与 `M1C-G05` |
| `SRD-03` | 历史数据证据策略：只用真实可证明事实；不可证明数据不得推算/自动补记/默认归零；保留历史证据，只读、隔离或 fail closed | `APPROVED_SCOPE_DECISION` | 界定 §31.13 `MC-REQ-11` |

#### 1.4.2 Core 限定规则建议（`CORE_LIMITED_PENDING_OWNER` / `OWNER_RATIFICATION_PENDING`）

> **共性规则**：以下每一条的**收紧方向**（拒绝、fail closed、不生成错误数据）在首期**直接可实施**，
> 不需要额外签字；**需要签字的只是"是否放宽支持范围"或"是否追认具体技术选择"**。
> 首期一律按最保守方向执行。

| ID | 建议的 Core 限定规则 | 影响与首期行为 | 状态 | 签字点 |
|---|---|---|---|---|
| `A-P01` | **唯一权威通知模型 = 复用 `receipt_notices` + `receipt_notice_items` + 行级来源表**，不新建第二套委外完成通知表、不建立第二收货引擎；由 `receipt_notices.business_type` 判别标准采购与委外 | 裁定权仍属 Procurement Design；业务所有者已于 2026-11-02 在 M1-Core Requirement Acceptance 中正式确认该唯一模型 | `DESIGN_TECHNICAL_ACCEPTED`（Owner 已确认） | **不阻塞**任何工作包；该确认只覆盖 M1-Core，不改变 M1 全范围历史登记 |
| `A-P02` | **保留**多 PO 来源、行级部分转换与累计容量上限；首期**不开放**复杂拒收重开（拒收→重开→再转换状态机）与自动再转换；LOT/SERIAL **只能**来自可验证的实物或来源身份，**不得凭空继承** | 已批准部分（multi-PO、质量门禁、行级容量守恒）**不受影响**；新增的拒绝边界使首期行为确定。首期对"拒收重开"类请求一律 409 且零业务副作用 | `CORE_LIMITED_PENDING_OWNER` | **受限行为**，**不阻塞**多 PO 与行级部分转换主链；签字**只在放宽**该收缩时需要 |
| `M1-P-02` | **区分两层**：① **已批准**部分 = OUT-09 每单位用量/订单总量快照 + OUT-08 BOM 消费规则 → "每单位用量 vs 订单总量"主歧义**已闭合**；② **未裁定**部分 = 损耗（scrap）是否计入倒冲基数、BOM 计量单位 ↔ 物料清单 `unit` 换算系数。首期采用**严格支持范围**：① 有明确 BOM 来源（approved / effective / `purpose=OUTSOURCE` / business-date appropriate）与物料行身份；② 单位一致，或存在**已批准且可证明**的换算；③ **不支持的损耗/换算组合一律 fail closed**，不得生成倒冲数量或成本；④ **不得自行创造新的损耗公式**，不得用跨仓全局平均价代替材料成本 | 首期倒冲在"受支持组合"内产出正确增量；落在受支持范围外时 409 `OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED` 且零副作用。**收紧不需要签字** | `CORE_LIMITED_PENDING_OWNER` | 是否**放宽**支持范围（接受损耗计入某一口径、接受某类换算系数）。**主歧义不需要重新签字**（已由已批准规则闭合） |
| `M1-P-03` | **已批准最小权限矩阵**：委外业务员（建议技术 ID `role-outsourcing`）持有 `OUTSOURCING_MANAGE`、`OUTSOURCING_MATERIAL_EXECUTE`；委外收货员（建议技术 ID `role-outsourcing-receiving`）只持有 `OUTSOURCING_RECEIVING_MANAGE`；现有 `role-warehouse` 持有 `IQC_MANAGE`；现有 `role-accounting` 持有 `SUPPLIER_BILL_MANAGE` 且仅用于普通采购；`admin` 保留 all-permissions | 收货录入/生效只认 `OUTSOURCING_RECEIVING_MANAGE`；业务员、收货员、质检和财务职责强制分离；委外来源账单即使通过 RBAC 仍由独立 Business Policy Guard 拒绝，管理员无豁免 | `APPROVED`（2026-11-02） | 角色与授予须由后续 Implementation 创建/配置；本次批准**不**等于已实施，也不授权 Implementation |
| `T-11` | **原始含义 = 通知转换后取消的来源容量语义**：① **不得未经证明自动恢复来源容量** —— 转换已用数量（`converted_quantity`）保持累计且单调不减，取消**不**恢复通知来源容量，重新转换 fail closed；② 该语义**不含**"零交期政策" | 首期一律 fail closed，**收紧不需要签字**；**受限行为**，**不阻塞**多 PO 与行级部分转换主链 | `CORE_LIMITED_PENDING_OWNER` | 是否在后续工作包**允许**已取消转换的来源量再次转换（若允许，必须新增独立不可变 conversion reversal 事实与反向上限；首期保持拒绝） |
| 交期上界（**独立于 `T-11`**） | **无有效交期**、**多交期归属不明**、**历史容量无法证明** → 一律明确拒绝（409），**不得以省略参数绕过上界**；交期容量由**可追溯的交期消费事实**判定；交期上界**只**适用于 `STANDARD_PURCHASE` 通知（委外通知无供料 PO 行交期） | 首期一律 fail closed，**收紧不需要签字** | `CORE_LIMITED_PENDING_OWNER` | 是否在后续工作包**开放**零有效交期场景下的转换路径（首期保持拒绝）。**该项不是 `T-11`** |

#### 1.4.3 延期政策（`DEFERRED_PENDING_POLICY`）

> 依 `M1-SRD-01` §2.2，下列能力移出 M1-Core 首期验收范围。**延期不是业务政策通过，也不是 Implementation 许可。**
> 每条在首期都必须有**服务端拒绝规则 + 零副作用**；不得以"暂未实现"为由保留可写路径。

| ID | 内容 | 首期边界（必须 fail closed） | 状态 |
|---|---|---|---|
| `B-P01` | 跨订单/跨期 Supplier WIP 价值携带（源账面价值、价差、转移时点、期间锁） | 委外 WIP **数量**归属守恒仍属首期（`M1C-G03`）；跨单 WIP **成本携带**延期 ⇒ `cost_cents` 保持 NULL、`cost_state='UNVERIFIED_COST'`，**不得**以假定平均价生成不可逆历史账务 | `DEFERRED_PENDING_POLICY` |
| `B-P02` | 倒冲差异生成单据后的审核人、退补单撤销/冲销状态 | 首期**不开放**倒冲差异单据的生效路径；差异只提供**只读 preview**，任何"审核后生效"类写入一律 409 且零副作用 | `DEFERRED_PENDING_POLICY` |
| `C-P01` | 加工费在收货/暂估/正式过账各时点的金额确认；GRNI 产生与冲回 | 委外加工费**正式过账**必须拒绝（409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`），账单保持 DRAFT，**零 AP / 零 GL / 零凭证 / 零分录**。**拒绝按来源级判定并覆盖共享入口**（委外来源账单的过账与匹配在委外专用入口与 `POST /api/supplier-bills/:id/post` / `/match` 一律拒绝）；**草稿创建允许**（只登记待裁定事实，零会计效果）；**普通采购账单不受影响** | `DEFERRED_PENDING_POLICY` |
| `C-P02` | 加工费会计科目/资本化、价差与税务 | 同 `C-P01`；首期**不得**产生任何加工费会计分录 | `DEFERRED_PENDING_POLICY` |
| `C-P03` | 过账后红冲/贷项与历史无原始凭证数据的处理 | 首期**不得**创建无原始委外凭证对应的采购贷项/红冲凭证；相关路径一律拒绝且零副作用 | `DEFERRED_PENDING_POLICY` |
| `C-P04` | Accounting 未 Domain Closure 时委外 Source→Canonical Voucher 的有界接入边界 | 首期**不接入**任何委外专用 GL 路径；不得新建委外专用第二 GL | `DEFERRED_PENDING_POLICY` |
| `D-P01` | VMI 结算窗口、消耗与物权转移的前后顺序、可结算数量口径 | VMI **结算/物权释放**写入一律拒绝且零副作用；不得凭空推导统一触发模式 | `DEFERRED_PENDING_POLICY` |
| `D-P02` | VMI 物权释放数量的协议价格、税、账单日期、部分结算规则 | 同 `D-P01`；VMI 账单交接一律拒绝 | `DEFERRED_PENDING_POLICY` |
| `M1-P-04` | VMI 调整量的关期容差 | 随 VMI 结算整体延期，首期**不适用**（容差不进入首期合同） | `DEFERRED_PENDING_POLICY` |

#### 1.4.4 需签字项与不依赖签字项（首期 Core 子项独立性）

| Core 子项 | 依赖的政策 | 首期可推进性 |
|---|---|---|
| 采购入库**直接**路径（PO → Purchase Receipt，无通知）、IQC 读取正式收货明细 | 无 | **可独立推进** |
| 委外收货**表头 + 明细**原子创建、零空明细、来源可达 | 无 | **可独立推进** |
| 委外发料 / 补料 / 退料写 canonical 库存 + 跟踪 + 估值 | 无 | **可独立推进** |
| 合法增量倒冲（受支持组合）与成品入库 | `M1-P-02`（**仅放宽**需签字；收紧不需要） | **可独立推进**（按严格支持范围 fail closed） |
| 委外收货**生效**（两段式：建待检 → 确认库存效力）与质量门禁 | `M1-P-03` 已批准；Implementation 仍未授权 | 政策不再阻塞；实施后必须由委外收货员取得正向证据，管理员不得替代 |
| 权限分离（`SUPPLIER_BILL_MANAGE` 注册 + 单权限门禁收紧 + 收货生效只认 `OUTSOURCING_RECEIVING_MANAGE`） | `M1-P-03` 已批准 | 政策就绪；仍须独立 Implementation 授权后落地 |
| 历史数据 fail-closed / 只读 / 隔离 | 无（`SRD-03` 已批准） | **可独立推进** |
| 移动端有限修复 | 无（`SRD-02` 已批准） | **可独立推进** |
| 采购**通知转换**（多 PO、部分转换、容量分域、交期绑定） | `A-P01`（**Design 技术接受**）+ `A-P02`（**受限行为**）+ `T-11`（**受限行为**） | **可独立推进**（`A-P01` 不再要求 Owner 重复审批；`A-P02` / `T-11` / 交期上界均按 fail closed 受限行为实施，**不阻塞**多 PO 与行级部分转换主链） |
| 委外加工费**草稿创建**（与正式过账分离） | `C-P01..C-P04` 的**首期边界**已定（草稿允许、正式过账拒绝） | **可独立推进** |

> **重要**：本节**不**签发任何 Implementation 授权。上述"可独立推进"仅表示**该子项不被上述待签政策阻塞**，
> 其实际实施仍需 Requirement 验收 + Design PASS + 独立的 Implementation 授权。

#### 1.4.5 本节与既有登记的关系

- 本节**不改变** §1.1 – §1.3 的任何历史结论；`M1-F-05..M1-F-12` 的处置类别与转交对象**保持原样**。
- §1.1 – §1.3 描述的是 **M1 全范围**下的处置；§1.4 描述的是 **M1-Core 首期**下的处置。
  两者**同时有效**：全范围口径继续有效以支撑后续工作包，首期口径决定 M1-Core 的实施边界。
- 本节**不**构成任何 Capability 的 `COVERED`，也**不**构成 Acceptance / Freeze / Release Readiness。
  M1-Core 的 7 个 Gate 状态见
  [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md) §13。

### 1.5 加工费 PO R1 已批准决策（`M1C-D-PO01`，2026-11-03）

> 批准依据：业务所有者在本轮 Promotion 指令中明确批准下列合同；未单独提供具体时分，
> 因此本表只记录会话日期与批准内容，不虚构批准时间。规范正文已融合至
> [M1-Core Active Design](../design/procurement-outsourcing-m1-core.md) §2.3、§3、§5–§11、§13–§17。

| ID | 批准内容 | 状态 | 实施边界 |
|---|---|---|---|
| `M1C-PO-P01` | 真实、可验证来源的加工费 PO，允许持相应采购权限的非创建人原位修改商业白名单并提交；审批权限独立、创建人不得自审、来源不可变；标准 PO creator 限制不变 | `APPROVED` | 未实施；仍需独立 Implementation 授权 |
| `M1C-PO-P02` | 一张委外订单终身最多一张加工费 PO；CANCEL、同源重建、PO Change ADD/MODIFY 全部拒绝 | `APPROVED` | 未实施；不得以 admin 或 Change 绕过 |
| `M1C-PO-U01` | 最小唯一性方案为 `purchase_orders(source_outsourcing_order_id)` UNIQUE；标准 PO 来源为 NULL；建索引前必须验证历史冲突 | `APPROVED_DESIGN` | 仅批准后续代码/schema/migration 实现；不授权连接或迁移项目数据库 |

本节关闭 R1 的 P01/P02 业务待决状态，但**不**签发 Implementation、Gate PASS、Acceptance、
Freeze、Domain Closure 或 Release Readiness。



## 2. Sales & Customer —— 开放设计决策

规范来源：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §35.9（Release Blockers 表）。

| ID | 待定内容 | 阻塞范围 | 状态 |
|---|---|---|---|
| D-2 | 信用评估基础（W11-B）的设计决策 | W11-B | `PENDING` |
| D-3 | 多评分 / 评级应用（W11-C）的设计决策 | W11-C | `PENDING` |
| D-4 | 信用对账与重算（W11-D）的设计决策 | W11-D | `PENDING` |
| D-5 | 信用对账与重算（W11-D）的设计决策 | W11-D | `PENDING` |

## 3. 待业务所有者追认 / 待独立决定

| ID | 事项 | 状态 | 说明 |
|---|---|---|---|
| `W11_A_ACCEPTANCE_PASS` | W11-A 整包 Acceptance | 未签发 | 标识保留给完整 W11-A 包；签发是业务所有者的**独立**决定，不是既有单元冻结的自动汇总。另有两项需先处理：W11-A OVERDUE 冻结记录未记载 Git SHA；所有单元冻结记录都把 "W11-A Package" 列入排除项。见 `PROJECT_STATUS.md` §35.6 / §35.11.4。 |
| G-5 | UAT-14 旧 Test Oracle 与当前 V21 Contract 冲突 | **Gap 仍开放；业务政策待决已消解** | **Gap 本身未关闭**：仍见 `PROJECT_STATUS.md` §35.8。**但「修 test 还是修 contract」这一问题已由**已批准**的 Requirement 条款 `document.md §31.12.6`（D-REQ-03）**裁定**——UAT-14 必须针对当前 V21 合同（创建 `201` / 确认 `200`），拒绝恢复过时 409 作为测试捷径。因此 G-5 **不再是**业务政策待决项，而是 **Implementation 内的已批准纠正动作**（候选设计 §26.33.14.3，归 WP-6 / `M1-GT02`）。在 Implementation 完成并通过对应 Gate 前，G-5 不得被记为已关闭；本表不改写 §35.8 的历史登记。 |

## 4. Procurement & Outsourcing —— 产品范围裁剪决策（2026-11-07）

规范来源：[`docs/decisions/product-scope-rebaseline-proposal-20261107.md`](./product-scope-rebaseline-proposal-20261107.md)
（`PENDING`）。审计依据：[`docs/audits/b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md) §0.5～§0.7。

**背景**：现行 Requirement §31.3 / §31.4 / §31.8 / §31.10 与 Design §26.27 / §26.31 把金蝶手册的
几乎全部功能**无条件**列为必须实现（54 项全部 `COVERED` 目标、49 项必须闭环、明文禁止 defer
VMI-03 / VMI-05）。这与「modern-erp 不复刻金蝶、按需建设最小完整业务闭环」的产品目标**不一致**。
下表登记**待业务所有者逐项裁定**的范围变更提案。

| ID | 范围变更提案 | 涉及 Capability | 状态 | 与现行合同的冲突 |
|---|---|---|---|---|
| `SCP-01` | 验收单位由「54 项能力全覆盖」改为「已裁剪集合全覆盖」；删除以手册能力条数为验收项 | 全部 54 项 | `PENDING` | 与 §31.4 / §31.8 A / §31.10 / §26.27 / §26.31 冲突 |
| `SCP-02` | 自动配额暂缓；货源与寻源简化为可解释的手工分配 | PRC-04 / 05 / 06 | `PENDING` | 与 §31.3.1 PRC-05 `NEW`、§31.4 对应行冲突 |
| `SCP-03` | 采购员 / 采购组简化为单据级归属 | PRC-03 | `PENDING` | 与 §31.3.1 PRC-03 `NEW` 冲突 |
| `SCP-04` | 独立调价实体并入价格版本；折扣只保留单级 | PRC-07 / 08 / 09 / 10 | `PENDING` | 与 §31.3.1 PRC-10 `NEW`、§31.4 对应行冲突 |
| `SCP-05` | 请购来源收敛为「手工 + 计划」；拆并简化 | PRC-11 / 12 | `PENDING` | 与 §31.3.1 对应行冲突 |
| `SCP-06` | 赠品与扫码归入可选 | PRC-15 / 26 | `PENDING` | 与 §31.3.1 对应行冲突 |
| `SCP-07` | 预付款需求暂缓 | PRC-17 | `PENDING` | 与 §31.3.1 PRC-17 `NEW`、§31.4 对应行冲突 |
| `SCP-08` | 采购订单变更限定为 `MODIFY` + `CANCEL` | PRC-18 | `PENDING` | 与 §31.3.1 PRC-18 `NEW`、§31.4 对应行冲突 |
| `SCP-09` | canonical 采购执行口径**不裁剪**，但把 P0 修复义务显式化 | PRC-19 | `PENDING`（**仅确认修复义务**，无需范围裁剪） | 无冲突 |
| `SCP-10` | 退货申请单级化 | PRC-24 | `PENDING` | 与 §31.3.1 PRC-24 `NEW` 冲突 |
| `SCP-11` | **VMI 五项全部暂缓** | VMI-01 ~ VMI-05 | `PENDING` | **直接冲突**：§31.8 A.1 明文「VMI-01~05 全部归本 Domain 完成」且「不得将 VMI-03 / VMI-05 整个 capability defer」——**须显式突破该条款** |
| `SCP-12` | 委外侧全部复用 canonical 供应商 / 货源 / 价格 / 采购单据；计划交接归入可选 | OUT-01 / 02 / 03 / 05 / 07 / 10 | `PENDING` | 与 §31.3.3 对应行冲突 |
| `SCP-13` | 倒冲与成本证据限定为 M1-Core 已批准的有界实现 | OUT-16 / 21 | `PENDING` | 与 §31.3.3 对应行冲突；**不新增**延期，与 D-01 一致 |
| `SCP-14` | 委外 AP/GL 过账与成品退货维持延期 | OUT-20 / 22 | `PENDING` | 与 §31.3.3 对应行冲突；与已生效延期一致 |
| `SCP-15` | 委外期初 / 期末与报表限定为少量关键报表 | OUT-23 | `PENDING` | 与 §31.3.3 OUT-23 冲突 |

**另需裁定**：`SCP-16` —— 审计台账 §5 中 17 个审计 Issue 对应的**危险写入路径处置类别**
（`FIX` / `FIX_OR_CLOSE` / `SAFE_CLOSE` / `REPORT_ONLY`）。其中
`AUD-FE-001`（演示按钮直连正式写 API）、`AUD-OUT-001`（跨委外订单 WIP 转移未走 canonical Inventory）
为 P0 级；`AUD-VMI-001`～`AUD-VMI-003` 随 `SCP-11` 一并处置。

**纪律**：

- 全部 54 项能力的当前 `Product Scope` = **`SCOPE_REVIEW_PENDING`**；
- `SCP-01`～`SCP-16` **一律未生效**；已批准 Requirement / Design / Acceptance / 延期政策
  （含 D-01～D-04、WP-I / WP-J / M-15、旧 M1 13 Gate）**全部维持原状**；
- `Product Scope` 的任何具体取值**只能**由业务所有者的 Scope Decision 确立，
  **不得**由开发者或 AI 宣告；
- 本表**不**登记「哪个 Domain 完成了多少」，那属于 `PROJECT_STATUS.md`。

### 4.1 Package A1 Owner Decision Addendum（2026-11-07）

授权来源：本轮用户粘贴的《Package A1 — Sourcing Safe Closure & VMI Minimum Scope Alignment》§1；仅授权决策记录、Requirement、Design，Implementation 未授权。本条保留 §4 原始提案，不把 `SCP-16` 十七项或 `SCP-11` 全量提案整体判为已批准。

| 决策对象 | 当前有效 Owner 决定 | 未决边界 |
|---|---|---|
| `AUD-FE-001` | `SAFE_CLOSE`：移除演示写入操作 | 不新增 Preview API；未实施、未测试 |
| `AUD-PRC-001` | `SAFE_CLOSE`：服务端关闭正式寻源决策写入口 | `AUD-PRC-002` Hash 独立追踪；查询与配置保留；未实施、未测试 |
| `AUD-OUT-001` | `SAFE_CLOSE` 意图已批准，但须先与 M1-Core 数量归属转移合同协调 | 不能据「无 canonical Inventory movement」关闭逻辑转移；成本与身份不支持路径继续拒绝；Gate 影响待专项判定 |
| `SCP-11` VMI 范围 | 原「五项全部暂缓」提案由本决定**部分取代**：VMI-01 协议、02 收货、03 消耗、04 只读数量汇总保留；VMI-05 物权转移及 Supplier Bill 交接暂缓 | `D-P01/D-P02` 仍 `PENDING`；VMI 供应商资格规则 `OWNER_DECISION_PENDING`；不得把 VMI 结算作为已批准能力 |

`SCP-16` 其余 Issue 及 `SCP-01..10/SCP-12..15` 保持原提案状态。`AUD-OUT-001` 的原审计事实仍保留在审计台账；新的合同核验结论见台账 §12。M1-Core 七 Gate 既有 7/7 PASS、R-01～R-20、M1-GD01/02、B-P01/02、C-P01..04、M-15 均不因本决定改变。

## 5. 不在本表范围

> **编号映射（2026-11-07）**：为把 §4 让给新增的「产品范围裁剪决策」，
> 原 **§4「不在本表范围」→ 现 §5「不在本表范围」**。正文内容**未改写**；
> 仓库内**无**任何指向原 §4 的深引用，故无失效引用。

- 已获批业务政策不重复登记（见 §31.12.8 的「不再重新征询」清单）；
- 已冻结能力的历史裁定保留在 [`docs/acceptance/`](../acceptance/)；
- Domain 级进度不在本表，见 `PROJECT_STATUS.md` §35.3。
