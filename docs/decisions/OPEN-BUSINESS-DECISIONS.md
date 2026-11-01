# 开放业务政策与设计决策登记

> 状态：`ACTIVE`
> Owner：业务所有者（业务政策裁定）/ 各 Domain Owner（设计决策）
> 权威来源：**规范正文在对应的 Requirement / Design 中**；本表是决策状态索引，不复制规范正文。
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)
>
> §1.1 – §1.3 的处置依据是 **M1 候选设计**
> [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)
> §26.33.14（源 `solution.md §26.33` @ `912fd76700ff6f3ad1509eec4c9e2241c1830265`）。
> 该候选设计**尚未获得** `Design PASS`；本表引用它只用于登记**技术处置**与**开放状态**，
> **不**因此把任何政策记为已批准，**不**构成 Acceptance / Freeze。

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
| `M1-P-03` | 角色授予矩阵：除 `role-accounting` 外是否设立独立委外业务角色、该角色持有哪些 `OUTSOURCING_*` 权限、`SUPPLIER_BILL_MANAGE` 是否授予其它既有角色 | WP-0 的权限注册子项。**不**阻塞 `SUPPLIER_BILL_MANAGE` 的**注册**与门禁收紧（无人持有即无人能过账，属 fail-closed） | `PENDING` |
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

## 4. 不在本表范围

- 已获批业务政策不重复登记（见 §31.12.8 的「不再重新征询」清单）；
- 已冻结能力的历史裁定保留在 [`docs/acceptance/`](../acceptance/)；
- Domain 级进度不在本表，见 `PROJECT_STATUS.md` §35.3。
