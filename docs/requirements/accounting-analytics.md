# Accounting & Analytics — Requirement

> 状态：`ACTIVE`
> Owner：Accounting & Analytics
> 权威来源：`document.md` §0.1 Domain Requirement 入口 + 本文件 `§35`
> 来源：新增正文（2026-11-10 建立 Accounting & Analytics Domain Closure Requirement）。
> 上游依据：`docs/audits/accounting-analytics-capability-audit-20261110.md`（`v0.1`，基准 SHA `eee92c2`）；
> 手册能力基线来源：`document.md` §22.6 / §22.7 / §22.14 / §22.15 / §22.16 / §22.17。
> 业务所有者 2026-11-10 裁定：AA-W1..AA-W7 **全部纳入**本域 Domain Closure Requirement；
> AA-31 汇兑损益 / 多币种 **`OUT_OF_SCOPE`**（本系统当前仅做单币种人民币 CNY）。
>
> **2026-11-14 有界解冻授权**：业务所有者授权解冻法定会计期间、经营期间及其跨域关账顺序合同并
> 进入 Requirement。§35.11 已由业务所有者于 2026-11-14 批准为 `APPROVED`；Design 已授权，
> Implementation 未授权；既有域级 Acceptance / Freeze 仍作为历史时点事实保留。

## 35. Accounting & Analytics Domain Closure Requirement

> 本节固化 Accounting & Analytics 业务域的 Requirement 阶段成果。
> 追溯链固定为：`Manual → Capability → Target Domain → Current Implementation → Coverage → Gap → Requirement → Design → Implementation → Acceptance`。
> 本节只定义**业务合同**（必须是什么、必须不做什么、验收如何判定），
> **不含**实现代码、模块划分、SQL、接口路径、页面布局等 Design 内容（属 `docs/design/accounting-analytics.md`）。
> 本节签署后进入 Design 阶段；Design 完成后必须 HARD STOP，等待 Implementation 批准。

### 35.1 范围与 ownership

#### 35.1.1 域定位

| 项 | 内容 |
|---|---|
| 业务域 | Accounting & Analytics（会计与分析） |
| Canonical Domain key | `accounting-analytics` |
| 覆盖手册 | B3106 存货核算、B3107 固定资产、B3114 智能会计平台、B3115 总账、B3116 报表、B3117 经营会计 |
| Capability 总数 | 44（AA-01..AA-44） |
| 主链位置 | `业务事实 → Inventory/AR/AP/Treasury/Asset/Cost → Accounting Event → Voucher → GL → Period End → Financial Reports / Management Accounting`（`document.md` §6.5 R2R） |
| 当前状态 | 实施 Partial；B3106 / B3107 / B3114–B3117 在 `docs/status/CAPABILITY_MATRIX.md` 记为 `UNVERIFIED` |

#### 35.1.2 Ownership 边界（canonical owner 唯一）

| 能力 | Canonical Owner | 本域角色 |
|---|---|---|
| Voucher / GL / 会计事件 / 报表平台 / 固定资产 / 经营会计 | **Accounting & Analytics** | 拥有 |
| AR / AP / 收付款 / 结算 / 资金 / 发票 | Finance Operations | 消费其事实并过账，不拥有 |
| 库存数量与批次身份 | Inventory & Warehouse | 消费其事实并估值，不拥有 |
| 采购与委外**业务执行**（订单、收货、加工费账单生命周期） | Procurement & Outsourcing | 消费其业务事实并过账，不拥有 |
| 生产成本 / WIP 事实 | Manufacturing & Quality | 消费其事实并结转，不拥有 |
| 审批 / 通知 / 工作流 / 审计 / 编号 | Platform | 复用横向能力 |

#### 35.1.3 三条不可越界的边界

1. **不重复实现第二套总账**：本域的 Voucher / GL / Accounting Entry 只有一个 canonical 实现；
   任何业务域的过账需求必须经本域 Accounting Event → Voucher 通道，不得新建旁路凭证表或旁路科目表。
2. **不夺取他域的业务事实**：本域的固定资产成本来源、委外成本来源、存货数量来源必须是对应域的**权威事实引用**，
   不得在本域复制一份可变副本。
3. **不重建第二套报表引擎**：`server/lib/formula-evaluator.js` 是 Master & Engineering 的工时公式安全文法，
   **不得**被扩写或复用为报表取数公式引擎；报表公式引擎是本域独立实现（见 §35.4.4）。

### 35.2 Manual Evidence Baseline

| 手册 | 手册能力基线 | 本域 Capability |
|---|---|---|
| B3106 存货核算 | `document.md` §22.6（9 项） | AA-01..AA-09 |
| B3107 固定资产 | `document.md` §22.7（8 项） | AA-10..AA-17 |
| B3114 智能会计平台 | `document.md` §22.14（7 项） | AA-18..AA-24 |
| B3115 总账 | `document.md` §22.15（8 项） | AA-25..AA-32 |
| B3116 报表 | `document.md` §22.16（6 项） | AA-33..AA-38 |
| B3117 经营会计 | `document.md` §22.17（6 项） | AA-39..AA-44 |

**基线使用规则**：

- 手册是 **Requirements / Coverage / Acceptance** 来源，**不是**最终菜单或代码目录；
- `document.md` §22 的 Coverage 列是初判，**不得**当作当前进度；当前进度以本节 §35.3 为准；
- 手册正文不可直接读取时，以 `document.md` §22 已固化的 Capability 基线为准，**不得**以常识替换手册要求；
- 若实施中发现与手册解释冲突，**立即停止该新增部分**并回到 Requirement 层裁定，不得在 Implementation 中自行解释。

### 35.3 Capability Audit Matrix（44 项）

> 判定依据：`docs/audits/accounting-analytics-capability-audit-20261110.md` §2。
> `当前判定` 是审计事实；`目标判定` 是本 Requirement 签署后的合同目标。
> 目标判定为 `COVERED` 的项，必须同时满足 §35.8 的对应验收条件，**不得**以「表存在」「接口存在」「页面存在」代替。

| ID | Capability | 当前判定 | 目标判定 | 归属包 | 目标合同要点 |
|---|---|---|---|---|---|
| AA-01 | 核算范围与核算体系 | PARTIAL | COVERED | AA-W6 | 必须存在可配置的**核算范围**实体（核算体系 / 组织 / 所有者维度），并能按范围出账 |
| AA-02 | 计价方法 | PARTIAL | COVERED | AA-W6 | 计价方法必须可按物料 / 类别 / 属性**自主选择**并有确定性优先级，不得仅由追踪策略单向锁定 |
| AA-03 | 采购入库成本 | PARTIAL | COVERED | AA-W6 | 入库成本必须可解释（成本构成 + 差异来源），并与 GL 存货科目一致 |
| AA-04 | 采购费用分配 | MISSING | COVERED | AA-W6 | 运费等采购费用必须可归集、按规则分摊到存货价值，并形成可审计的分摊结果 |
| AA-05 | 暂估成本 | PARTIAL | COVERED | AA-W6 | 暂估入库必须有独立单据与暂估→正式差异调整凭证，形成完整闭环 |
| AA-06 | 生产入库成本 | PARTIAL | COVERED | AA-W6 | WIP→成品成本结转必须含差异分配（损耗 / 良率），并与 GL 一致 |
| AA-07 | 委外成本 | PARTIAL | COVERED | AA-W6 | 委外成本口径 = 材料成本 + 加工费由 Procurement & Outsourcing 域的 canonical 实现承担，本域只做**权威事实引用**（§35.4.6 AA-W6.17～AA-W6.19；业务所有者 2026-11-11 裁定选项 A） |
| AA-08 | 出库核算 / 成本调整 | PARTIAL | COVERED | AA-W6 | 必须存在受控的成本调整机制（重估 / 差异调整 / 盘盈亏成本回冲）并生成会计凭证 |
| AA-09 | 存货关账 | PARTIAL | COVERED | AA-W6 | 核算关闭必须有完整异常检查清单与差异解释，且与库存月结保持既定先后顺序 |
| AA-10 | 资产基础资料 | PARTIAL | COVERED | AA-W5 | 资产类别 / 位置 / 状态 / 折旧政策必须是字典与政策实体，不得为自由文本 |
| AA-11 | 资产卡片 | PARTIAL | COVERED | AA-W5 | 资产卡片必须是生命周期主对象，有明确状态机 |
| AA-12 | 采购转固 | MISSING | COVERED | AA-W5 | 必须存在「采购收货 → 资产卡片」的受控生成路径，并保留来源追溯 |
| AA-13 | 资产变更 | PARTIAL | COVERED | AA-W5 | 位置 / 责任人 / 价值等变更必须经受控变更单，含前后值快照与审批 |
| AA-14 | 拆分 / 合并 | MISSING | COVERED | AA-W5 | 资产卡片必须可受控拆分与合并，且价值守恒 |
| AA-15 | 借用 / 盘点 | MISSING | COVERED | AA-W5 | 必须存在资产借用与固定资产盘点，含差异处理 |
| AA-16 | 折旧 | PARTIAL | COVERED | AA-W5 | 折旧必须**按政策自动计提**并生成会计凭证，且与 GL 科目可对账 |
| AA-17 | 资产处置 | MISSING | COVERED | AA-W5 | 报废 / 出售 / 减少必须是受控处置单，含税务与账务处理 |
| AA-18 | 业务 → 凭证平台 | PARTIAL | COVERED | AA-W2 | 业务事实到凭证的映射必须由**可配置规则**表达，不得硬编码在业务调用方 |
| AA-19 | 凭证模板 | PARTIAL | COVERED | AA-W2 | 凭证模板必须可创建 / 修改 / 停用，且**被生成链路真实消费** |
| AA-20 | 自动 / 批量生成 | PARTIAL | COVERED | AA-W2 | 必须支持单笔自动、批量生成与按期调度，且生成状态可追踪 |
| AA-21 | 业务与凭证关系 | PARTIAL | COVERED | AA-W1 | 必须存在**统一**的 Accounting Event 台账，作为业务 ↔ 凭证的归一关系层，支持双向导航 |
| AA-22 | 未生成 / 异常处理 | MISSING | COVERED | AA-W1 | 必须能识别「应生成但未生成 / 生成失败」并提供受控修复入口 |
| AA-23 | 业务财务对账 | PARTIAL | COVERED | AA-W1 | 业务账 ↔ GL 对账必须产品化为可解释工作台，含差异快照留痕 |
| AA-24 | 期末检查 | PARTIAL | COVERED | AA-W1 | 关账前必须统一检查已审核业务单据的凭证生成完整性 + 各子账差异 |
| AA-25 | 凭证录入 | COVERED | COVERED | — | 保持现有录入 / 提交 / 审核 / 驳回与五角色 SOD |
| AA-26 | 凭证过账 | COVERED | COVERED | — | 保持 POSTED-only 报表口径与过账唯一性 |
| AA-27 | 凭证纠错 | PARTIAL | COVERED | AA-W3 | 必须支持补充凭证与更正差异对比；冲销路径必须统一 |
| AA-28 | 出纳复核 | MISSING | COVERED | AA-W3 | 必须存在独立出纳复核节点与独立权限 |
| AA-29 | 现金流量 | MISSING | COVERED | AA-W3 | 必须存在凭证现金流量项目分配与**现金流量表** |
| AA-30 | 期末转账 / 摊销 / 计提 | MISSING | COVERED | AA-W3 | 必须支持期末自动转账、费用摊销与计提（含折旧等） |
| AA-31 | 汇兑损益 | OUT_OF_SCOPE | OUT_OF_SCOPE | — | 业务所有者 2026-11-10 裁定：单币种人民币，不做多币种与汇兑损益 |
| AA-32 | 损益结转 / 总账结账 | PARTIAL | COVERED | AA-W3 | 必须实现**真实损益结转**（不再以虚拟权益行补偿），并纳入期末检查链 |
| AA-33 | 财务报表 | COVERED | COVERED | — | 保持资产负债表 / 利润表 POSTED-only |
| AA-34 | 试算平衡 | COVERED | COVERED | — | 保持总账试算平衡 |
| AA-35 | 报表模板 | MISSING | COVERED | AA-W4 | 必须存在报表模板（项目 / 单位 / 权限 / 期间实例） |
| AA-36 | 公式 | MISSING | COVERED | AA-W4 | 必须存在**安全**取数与计算公式引擎（禁止 eval / Function / 动态代码执行） |
| AA-37 | 报表编制流程 | MISSING | COVERED | AA-W4 | 必须实现实例化 → 重算 → 保存 → 提交 → 审核的报表生命周期 |
| AA-38 | 管理 / 自定义报表 | PARTIAL | COVERED | AA-W4 | 用户必须能自建管理报表并配置维度、公式与权限 |
| AA-39 | 经营账簿 / 组织 | MISSING | COVERED | AA-W7 | 必须存在经营账簿与经营单元（阿米巴）模型 |
| AA-40 | 经营数据来源 | MISSING | COVERED | AA-W7 | 必须存在统一经营台账，其数据可追溯到 GL 或业务单据 |
| AA-41 | 内部结算 | MISSING | COVERED | AA-W7 | 必须存在内部交易与内部结算价格模型 |
| AA-42 | 费用归集分配 | MISSING | COVERED | AA-W7 | 必须存在费用归集、分摊规则与分摊计划，并有可解释的分摊结果 |
| AA-43 | 经营损益 | MISSING | COVERED | AA-W7 | 必须能按经营单元核算经营利润 |
| AA-44 | 经营会计关账 | MISSING | COVERED | AA-W7 | 必须存在经营期间结账与受控反结账 |

**统计**：当前 4 `COVERED` / 21 `PARTIAL` / 18 `MISSING` / 1 `OUT_OF_SCOPE`；
目标 43 `COVERED` / 0 `PARTIAL` / 0 `MISSING` / 1 `OUT_OF_SCOPE`。

### 35.4 目标 Capability Closure 要求

> 每个包给出**必须成立**的业务事实与**必须不成立**的行为。所有条款均为可验收陈述。
> 「禁止」条目为 fail closed 硬约束，违反即视为该包未完成。

#### 35.4.1 AA-W1 会计事件台账与对账工作台

**AA-21 业务与凭证关系（统一关系层）**

- AA-W1.1 必须存在唯一的会计事件台账实体，每个「应生成凭证的业务事实」在其上**恰有一条**事件记录。
- AA-W1.2 事件必须能回答：来自哪个业务单据（来源类型 + 来源 ID）、属于哪个会计期间、应生成何种凭证、
  当前处于未生成 / 已生成 / 已跳过 / 生成失败 / 已冲销中的哪一态、关联哪张凭证。
- AA-W1.3 必须支持**双向导航**：从业务单据可查到其凭证，从凭证可跳回其来源业务单据。
- AA-W1.4 事件与凭证的关系必须唯一且不可重复生成；同一业务事实重复触发不得产生第二张凭证。
- **禁止**：不得以 `source_type` / `source_id` 自由字符串拼接作为唯一关系载体；不得为同一业务事实并存两套关系表。

**AA-22 未生成 / 异常处理**

- AA-W1.5 必须能列出「已审核 / 已生效但未生成凭证」的业务事实清单，并按来源类型、期间、错误码筛选。
- AA-W1.6 生成失败必须留存稳定错误码与错误信息，不得只留自由文本。
- AA-W1.7 必须提供**受控修复**入口：重试生成、跳过并说明原因；两者都必须写审计，且跳过后该事实不得静默消失。
- AA-W1.8 重试必须幂等；同一事件重复重试不得产生重复凭证。
- **禁止**：不得提供无审计的「一键补凭证」；不得允许人工直接改写已过账凭证。

**AA-23 业务财务对账**

- AA-W1.9 必须把业务账与 GL 的对账（存货、存货数量、WIP、AR、AP、GRNI、进项税、销项税、资金、COGS、供应商账单）
  产品化为**可解释条目**：每条给出检查码、差异金额、差异方向、受影响记录与解释。
- AA-W1.10 对账结果必须可留痕为快照，并可按期间回看。
- AA-W1.11 对账差异不得被自动静默修复；差异只能由有权限的人按对应业务单据处理后重跑。
- **禁止**：不得以「对账通过」掩盖差异；不得在差异存在时静默放行关账（关账拦截属 AA-24，允许业务所有者显式豁免）。

**AA-24 期末检查**

- AA-W1.12 会计期间结账前置检查必须**统一**覆盖：录入中 / 待审核 / 已驳回凭证、未过账凭证、
  已审核业务单据的凭证生成完整性、各子账与 GL 差异。
- AA-W1.13 检查必须给出可定位到具体单据的失败原因，不得只给布尔值。
- AA-W1.14 结账顺序必须保持：业务系统先关账 → 会计期间后关账；反结账必须留痕并限定权限。
- **禁止**：不得以删除检查项、降低检查强度或放宽阈值的方式让关账通过。

**会计科目维护（ACC-X-04）**

- AA-W1.15 会计科目必须可创建、修改、停用，并校验编码唯一、名称必填、类型与余额方向合法。
- AA-W1.16 已被凭证分录引用的科目不得被删除或改变类型 / 余额方向；停用后不得用于新分录。
- **禁止**：不得删除有引用历史的科目。

**会计与分析工作台（ACC-X-05）**

- AA-W1.17 必须提供一个会计分析工作面，聚合展示：期间状态、待办（待审核凭证 / 待修复会计事件 / 待复核固定资产 /
  待结账）、期末检查结果与对账差异入口。
- AA-W1.18 工作台聚合的是**入口**，不得复制他域业务事实的明细表；点击必须跳转到本域或对应域的权威界面。

#### 35.4.2 AA-W2 凭证模板与规则平台

**AA-19 凭证模板**

- AA-W2.1 凭证模板必须可创建、修改、停用；每张模板定义凭证日期来源、凭证类型、摘要、科目、方向、金额来源、维度。
- AA-W2.2 模板条目必须能被**真实生成链路消费**：模板停用后，已生成凭证不受影响，新业务不得再命中停用模板。
- AA-W2.3 模板必须带版本与生效区间；已被生成过的模板版本不得原地改写，只能新增版本。
- **禁止**：不得保留「有模板表但无写入口、无消费方」的半成品状态。

**AA-18 业务 → 凭证平台（规则化）**

- AA-W2.4 业务类型到凭证模板的映射必须由可配置规则表达（来源类型 + 业务事件类型 + 生效区间 + 模板）。
- AA-W2.5 规则命中必须唯一；命中歧义或未命中必须显式失败并写入会计事件错误码，不得回退到硬编码映射。
- AA-W2.6 科目必须通过**科目角色 / 规则解析**获得，不得由业务代码写死科目编码。
- **禁止**：不得为同一业务类型并存两套 active 映射（规则映射与硬编码映射）。

**AA-20 自动 / 批量生成**

- AA-W2.7 必须支持三种触发：业务动作即时自动生成、按期间批量生成、定时调度补生成。
- AA-W2.8 批量与调度必须可查询执行结果（成功数、失败数、失败原因、运行时间），并写审计。
- AA-W2.9 批量生成必须逐条独立事务，单条失败不得回滚整批，也不得留下半张凭证。
- **禁止**：不得静默跳过失败条目；不得在无幂等保护的情况下重复生成。

**AA-W2.10 规则安全**

- AA-W2.11 模板条件与金额来源只能使用**声明式、白名单**表达式；不得执行用户提供的代码。
- AA-W2.12 任何公式求值必须失败即报错，不得返回 0 或跳过该分录。

#### 35.4.3 AA-W3 总账增强与期末自动化

**AA-27 凭证纠错**

- AA-W3.1 已过账凭证的更正必须通过**冲销 + 补记**完成，不得原地修改已过账分录。
- AA-W3.2 手工凭证与系统凭证的冲销必须走**同一条** canonical 路径，语义一致。
- AA-W3.3 冲销必须校验：原凭证存在、未被冲销、期间未关账、金额与方向镜像一致。
- AA-W3.4 必须支持补充凭证（与原凭证关联、可对比差异）。
- **禁止**：不得提供直接编辑已过账分录的入口。

**AA-28 出纳复核**

- AA-W3.5 必须存在独立的出纳复核状态与节点，且与制单、审核**职责分离**。
- AA-W3.6 只有被标记为需出纳复核的凭证才进入该节点；复核通过前不得过账。
- AA-W3.7 复核人不得是制单人；违反职责分离必须被后端拒绝。
- **禁止**：不得以配置开关绕过职责分离。

**AA-29 现金流量**

- AA-W3.8 凭证分录必须可指定现金流量分类（经营 / 投资 / 筹资）及可选项目；未指定的分录必须被显式识别为「未分类」并在对账中体现。
- AA-W3.9 必须提供现金流量表（主表），数据只取已过账凭证，且期间口径与资产负债表、利润表一致。
- AA-W3.10 现金流量表必须可与资金子账（现金 / 银行）对账，差异可解释。
- **禁止**：不得以「现金日记账」冒充现金流量表；不得纳入未过账凭证。

**AA-30 期末转账 / 摊销 / 计提**

- AA-W3.11 必须支持三类期末处理的定义与执行：自动转账、费用摊销、计提（含折旧计提）。
- AA-W3.12 期末处理定义必须绑定期间、来源、科目 / 方向、金额来源，并可被重复执行而结果幂等。
- AA-W3.13 执行结果必须生成**会计凭证**并进入正常审核 / 过账链路，不得旁路写 GL。
- **禁止**：不得在未生成凭证的情况下直接改写科目余额。

**AA-32 损益结转 / 总账结账**

- AA-W3.14 期末必须实现**真实损益结转**：把本期损益类科目余额结转到权益科目，生成结转凭证。
- AA-W3.15 结转后利润表 / 资产负债表的期间口径必须自洽；不得再依赖「未结转损益虚拟权益行」补偿。
- AA-W3.16 结转必须进入期末检查链：未结转时不得允许关闭会计期间。
- AA-W3.17 结转必须可受控反结转，且反结转与反结账都必须留痕并限定权限。
- **禁止**：不得在结转未完成时关闭会计期间；不得在无留痕的情况下回滚已结转结果。

#### 35.4.4 AA-W4 报表平台

**AA-35 报表模板**

- AA-W4.1 必须存在报表模板实体，含模板标识、名称、所属域、可见范围、状态与版本。
- AA-W4.2 模板必须包含报表项目（行项目）定义：项目编码、名称、层级、排序、取值来源、是否合计行。
- AA-W4.3 模板必须有**期间实例**：实例化期间后可承载计算结果、状态与审核轨迹。
- **禁止**：不得保留「只有固定代码查询、无模板实体」的报表形态作为本能力的完成态。

**AA-36 公式**

- AA-W4.4 必须实现报表取数公式与计算公式，且**禁止** `eval` / `Function` / `vm` / 动态代码执行。
- AA-W4.5 取数来源必须是**白名单数据源**（总账科目余额、凭证分录汇总、辅助项目余额、业务台账聚合），
  且必须绑定期间与维度（部门 / 辅助项目 / 经营单元）。
- AA-W4.6 公式必须有长度上限、解析深度上限与可识别的错误码（如除零、未知标识符、非法记号、超限）。
- AA-W4.7 求值失败必须显式报错并标记该报表项，不得静默取 0。
- **禁止**：不得复用或扩写 `server/lib/formula-evaluator.js`（工时公式文法，标识符限定 `e_` 前缀、无函数调用、
  无跨表取数）；不得让报表公式与工时公式共用同一语法入口。

**AA-37 报表编制流程**

- AA-W4.8 报表必须支持生命周期：实例化 → 重算 → 保存 → 提交 → 审核。
- AA-W4.9 重算必须幂等且可重复；审核后的实例重算必须回到可编辑态或被拒绝，不得静默改写已审核结果。
- AA-W4.10 报表实例必须留存版本与审核留痕，可按期间回看。
- **禁止**：不得在没有审核轨迹的情况下让报表结果被引用为正式财务口径。

**AA-38 管理 / 自定义报表**

- AA-W4.11 用户必须能基于模板创建自定义管理报表，配置维度、过滤条件与公式。
- AA-W4.12 自定义报表必须遵守与模板报表相同的期间口径、权限与 POSTED-only 约束。
- AA-W4.13 已有固定执行报表（销售 / 采购统计、未交未货反应表、存货异动明细表）必须保持既有口径与入口不变。
- **禁止**：不得为自定义报表另建第二套 GL 取数口径。

#### 35.4.5 AA-W5 固定资产完整生命周期

**AA-10 资产基础资料 / AA-11 资产卡片**

- AA-W5.1 资产类别、资产位置、资产状态必须是字典实体；资产行必须引用而非内嵌自由文本。
- AA-W5.2 必须存在独立的**折旧政策**实体（方法、年限、残值率、起算规则、适用类别），资产引用政策。
- AA-W5.3 资产卡片必须有生命周期状态机（草稿 / 在用 / 闲置 / 处置中 / 已处置），状态流转必须受控并写审计。
- **禁止**：不得把折旧方法与年限继续平铺在资产行上而无政策实体。

**AA-12 采购转固**

- AA-W5.4 必须存在从采购收货（或其他指定来源）生成资产卡片的受控路径。
- AA-W5.5 转固必须保留来源单据引用，且金额取自权威来源，不得由用户在转固时另填金额。
- AA-W5.6 同一来源不得重复转固。
- **禁止**：不得在采购域复制一份资产台账。

**AA-13 资产变更**

- AA-W5.7 位置 / 责任人 / 价值等变更必须经受控变更单，含变更前后值快照、原因、审批。
- AA-W5.8 变更单未生效前，资产当前值不得被改写。

**AA-14 拆分 / 合并**

- AA-W5.9 必须支持资产卡片受控拆分与合并。
- AA-W5.10 拆分 / 合并必须**价值守恒**（原值 = 拆后合计；合并前合计 = 合并后原值），且累计折旧按比例结转并可解释。
- **禁止**：不得出现价值不守恒的拆分 / 合并。

**AA-15 借用 / 盘点**

- AA-W5.11 必须存在资产借用（借出 / 归还，含借用人与归还确认）与固定资产盘点（含差异处理）。
- AA-W5.12 盘点差异必须走受控差异单，不得直接改写资产原值或累计折旧。

**AA-16 折旧**

- AA-W5.13 折旧必须**按政策自动计提**（按期间批量），不得依赖人工录入折旧金额。
- AA-W5.14 计提必须生成会计凭证（借：管理费用 / 制造费用等；贷：累计折旧），并进入正常审核 / 过账链路。
- AA-W5.15 累计折旧与账面净值必须与资产卡片一致，并与 GL 折旧科目可对账。
- AA-W5.16 计提必须幂等：同一期间同一资产重复计提不得重复入账。
- **禁止**：不得在无政策依据的情况下接受任意折旧金额。

**AA-17 资产处置**

- AA-W5.17 必须存在受控处置单（报废 / 出售 / 减少），含处置方式、处置价、处置日期、原因与审批。
- AA-W5.18 处置必须生成会计凭证并结转处置损益；未处置的资产不得被直接删除。

**固定资产入口（ACC-X-02）**

- AA-W5.19 固定资产必须从导航可达（route 不得处于 disabled 状态），并遵守既有 mobile-first 与权限暴露约束。

#### 35.4.6 AA-W6 存货核算深化

**AA-01 核算范围与核算体系**

- AA-W6.1 必须存在核算范围实体（核算体系 / 组织 / 所有者维度），并可绑定到物料 / 货品。
- AA-W6.2 估值与报表必须能按核算范围出账；范围不明的估值不得计入权威余额。
- **禁止**：不得把单组织假设硬编码在核算逻辑中。

**AA-02 计价方法**

- AA-W6.3 计价方法必须可按物料 / 类别 / 属性选择，并定义**确定性优先级**（属性 > 类别 > 物料 > 默认）。
- AA-W6.4 已有估值移动的物料变更计价方法必须受控（需结清或走变更流程），不得静默切换导致历史成本不可解释。

**AA-03 / AA-05 采购入库成本与暂估成本**

- AA-W6.5 必须存在独立的暂估入库单据，记录暂估金额、暂估依据与后续转正式的处理路径。
- AA-W6.6 暂估与正式之间的差异必须通过差异调整凭证体现，不得直接改写原暂估金额。
- AA-W6.7 入库成本构成（暂估 / 正式 / 分摊费用 / 差异）必须可解释并可回看。

**AA-04 采购费用分配**

- AA-W6.8 必须存在采购费用归集与分摊：费用登记 → 按规则分摊 → 分摊结果落到存货价值并生成凭证。
- AA-W6.9 分摊规则必须可解释、可复核（分摊基数、权重、分摊金额可重算一致）。
- AA-W6.10 分摊金额必须计入权威估值流水，不得只停留在报表口径。
- **禁止**：不得把分摊费用记在期间费用而不进存货价值。

**AA-06 生产入库成本**

- AA-W6.11 WIP → 成品成本结转必须包含差异分配（损耗 / 良率差异），差异去向必须显式。
- AA-W6.12 结转后成品成本与 GL 存货科目必须一致。

**AA-07 委外成本**（业务所有者 2026-11-11 裁定：**选项 A**）

- AA-W6.17 委外成本口径 = **材料成本 + 加工费**，其 canonical 实现由 **Procurement & Outsourcing 域**承担
  （材料成本取本域权威估值流水 `inventory_valuation_movements` 的倒冲材料价值，加工费取
  `outsourcing-gl-policy.js::resolveProcessingFeeAccountingProfile` 解析的会计档案）；
  该域已于 2026-11-11 签发域级 Acceptance 与 Capability Freeze。
- AA-W6.18 本域**只做权威事实引用**（§35.2 第 2 条）：不得新增第二套委外成本事实表、委外成本口径常量
  或第二条委外加工费过账路径；本域的取数只能读采购与委外域的 canonical 结果。
- AA-W6.19 本域**不得**改写委外成本口径；口径变更属于 Procurement & Outsourcing 域的合同变更，
  须先走该域的 Requirement / Design 层。
- **禁止**：不得以「本域固化取数规则」为由在 Accounting & Analytics 域复制委外成本口径；
  §35.3 对 AA-07 的目标判定 `COVERED` 即由本组条款以**跨域权威引用**方式满足。

**AA-08 出库核算 / 成本调整**

- AA-W6.13 必须存在受控成本调整机制：重估、差异调整、盘盈亏成本回冲。
- AA-W6.14 每次调整必须生成凭证并可追溯到调整原因与授权人。

**AA-09 存货关账**

- AA-W6.15 核算关闭必须提供完整异常检查清单：估值与 GL 差异、未估值历史移动、负库存 / 残值、暂估未结转、成本调整未过账。
- AA-W6.16 异常清单必须可定位到具体记录并可解释；关闭顺序保持「库存月结 → 会计核算关账」。

#### 35.4.7 AA-W7 经营会计

**AA-39 经营账簿 / 组织**

- AA-W7.1 必须存在经营账簿实体（一个法人可有多个经营账簿），账簿是经营会计的隔离边界。
- AA-W7.2 必须存在经营单元 / 利润中心（阿米巴）模型，可挂靠到部门 / 责任人 / 经营区域。

**AA-40 经营数据来源**

- AA-W7.3 必须存在统一经营台账（operating ledger），条目必须可追溯到来源（GL 科目余额或业务单据），
  追溯链必须双向可查。
- AA-W7.4 经营台账必须按期间与经营单元聚合，且只取已过账事实。

**AA-41 内部结算**

- AA-W7.5 必须存在内部结算价格模型（按物料 / 内部交易类型 / 有效期）。
- AA-W7.6 内部交易必须能按内部结算价格计量并形成内部结算结果，差异有明确去向。

**AA-42 费用归集分配**

- AA-W7.7 必须存在费用归集（按来源归集到经营单元）与分摊规则、分配计划。
- AA-W7.8 分摊结果必须可解释（基数、权重、分摊前后金额），并可重算一致。

**AA-43 经营损益**

- AA-W7.9 必须能按经营单元出具经营损益（收入 - 内部转移 - 分摊费用 = 经营利润）。
- AA-W7.10 经营损益必须与法定损益可勾稽（差异可解释），不得成为第二套无法对账的账。

**AA-44 经营会计关账**

- AA-W7.11 必须存在经营期间关账与受控反结账，独立于法定会计期间但与之有先后约束。
- AA-W7.12 经营期间关账前必须完成经营台账归集与分摊，未完成不得关账。

### 35.5 Permission / RBAC / SOD 约束

#### 35.5.1 权限族

新增权限必须落在既有权限模型内（`server/db.js` 权限表 + `role_permissions`），并映射到五角色
（ADMIN / SALES / PURCHASING / WAREHOUSE / ACCOUNTING）。

| 权限 | 名称 | 默认角色 | 用途 |
|---|---|---|---|
| `ACCOUNTING_SUBJECTS_VIEW` / `_MANAGE` | 查看 / 维护会计科目 | ACCOUNTING | AA-W1 科目维护 |
| `ACCOUNTING_EVENTS_VIEW` / `_REPAIR` | 查看 / 修复会计事件 | ACCOUNTING | AA-W1 未生成与异常处理 |
| `ACCOUNTING_RECONCILIATION_VIEW` | 查看业务财务对账 | ACCOUNTING | AA-W1 对账工作台 |
| `VOUCHER_TEMPLATES_VIEW` / `_MANAGE` | 查看 / 维护凭证模板与规则 | ACCOUNTING | AA-W2 规则平台 |
| `ACCOUNTING_RULE_RUN` | 执行批量 / 调度生成 | ACCOUNTING | AA-W2 批量生成 |
| `VOUCHER_CASHIER_REVIEW` | 出纳复核 | ACCOUNTING | AA-W3 出纳复核 |
| `ACCOUNTING_PERIOD_END_MANAGE` | 执行期末转账 / 摊销 / 计提 / 损益结转 | ACCOUNTING | AA-W3 期末自动化 |
| `CASH_FLOW_VIEW` | 查看现金流量表 | ACCOUNTING | AA-W3 现金流量 |
| `REPORT_TEMPLATE_VIEW` / `_MANAGE` | 查看 / 维护报表模板 | ACCOUNTING | AA-W4 报表平台 |
| `REPORT_INSTANCE_VIEW` / `_SUBMIT` / `_APPROVE` | 查看 / 提交 / 审核报表实例 | ACCOUNTING | AA-W4 报表生命周期 |
| `FIXED_ASSETS_VIEW` / `_MANAGE` | 查看 / 管理固定资产 | ACCOUNTING（**已存在**） | AA-W5 |
| `FIXED_ASSET_DEPRECIATE` | 计提折旧 | ACCOUNTING | AA-W5 自动计提 |
| `FIXED_ASSET_DISPOSE` | 资产处置 | ADMIN | AA-W5 处置 |
| `INVENTORY_COST_VIEW` / `_MANAGE` | 查看 / 管理存货核算 | ACCOUNTING | AA-W6 |
| `MANAGEMENT_ACCOUNTING_VIEW` / `_MANAGE` | 查看 / 管理经营会计 | ACCOUNTING | AA-W7 |

#### 35.5.2 职责分离（SOD）

- 制单、审核、出纳复核三者必须互斥；**不得**由同一用户完成同一凭证的这三个动作。
- 会计事件修复人不得是该事件对应的原始业务单据审核人。
- 固定资产处置审批人不得是处置单制单人。
- 报表实例提交人不得是审核人。
- 经营会计关账人与该期间分配规则的制定人不得为同一用户。
- 违反 SOD 必须由**后端**拒绝；前端隐藏不构成授权。

#### 35.5.3 Fail closed

- 所有新增 API 必须后端 fail closed：权限不足、状态不允许、期间已关、幂等冲突一律拒绝并写审计。
- 权限必须来自服务端解析的角色权限，不得信任前端传入的角色或权限标识。

### 35.6 Compatibility / 不变性约束

以下为**不得破坏**的既有合同，任何实施不得改变：

1. **既有 HTTP 契约**：`/api/accounting-vouchers`、`/api/reports/income-statement`、`/api/reports/balance-sheet`、
   `/api/reports/trial-balance`、`/api/period-closures`、`/api/fixed-assets`、`/api/product-costs`、`/api/cost-rates`、
   `/api/cash-journals`、`/api/reports/decision/*` 的路径、方法、请求体、响应体、状态码与错误码保持不变；
   新能力只能**新增**端点或**新增可选字段**。
2. **既有报表口径**：资产负债表 / 利润表 / 试算平衡仍只取 `status='POSTED'` 的凭证，期间口径与业务日期口径不变。
3. **既有系统凭证语义**：`voucher_origin='SYSTEM'`、`source_type` 取值集合、`SYSTEM_VOUCHER_UNIQUENESS` 幂等检查、
   `reverseSystemVoucher` 的冲销语义保持不变。
4. **既有估值语义**：`inventory_valuation_movements` 为权威历史、`inventory_valuation_balances` 为派生缓存、
   `LEGACY_UNVALUED` 阻断权威结账的行为保持不变。
5. **既有结账顺序**：库存月结（`inventory_period_closures`）先于会计期间结账（`period_closures`）保持不变。
6. **既有反结账约束**：反结账限 ADMIN、强制原因、`period_reopen_history` 留痕保持不变。
7. **既有 Route 清单**：route key 集合与 `src/navigation/applicationRegistry.js` 的唯一 source 原则不变；
   本域只允许把 `fixed-assets` 由 `enabled:false` 改为 enabled，不得新增第二套会计 route。
8. **既有表**：既有表的列、约束、语义不得被本域改写；新增能力一律**新增表 / 新增列**（见 §35.8.2）。
9. **单币种**：全部新增金额字段使用**安全整数分**，币种固定 CNY；不得引入多币种字段。

### 35.7 Out of Scope

| ID | 事项 | 裁定 | 依据 |
|---|---|---|---|
| AA-31 | 汇兑损益 / 多币种 | `OUT_OF_SCOPE` | 业务所有者 2026-11-10 裁定：当前仅做单币种人民币 CNY |
| ACC-OOS-03 | 法定电子发票 / 税务硬件集成 | `OUT_OF_SCOPE` | 沿用 `document.md` 既有裁定 |
| ACC-OOS-05 | 多组织 / 法人集团合并报表 | `OUT_OF_SCOPE` | 沿用既有基线；经营账簿不等于法人合并 |
| ACC-OOS-06 | 预算与全面预算管理 | `OUT_OF_SCOPE` | 手册基线未覆盖 |
| ACC-OOS-07 | 成本法 / 分步法等高级成本核算体系 | `OUT_OF_SCOPE` | 本轮只做既定计价方法与成本调整；变更生产方式结转 |

### 35.8 Acceptance Criteria

#### 35.8.1 整域 Acceptance 门槛

Accounting & Analytics 域级 Acceptance 必须同时满足：

1. §35.3 全部 43 项目标 `COVERED` 能力**逐项**有证据；
2. 七个包 AA-W1..AA-W7 各自的验收条件全部通过；
3. 覆盖 AA-W1..AA-W7 的自动化测试全部通过（FAST 与 FULL）；
4. `pnpm test:fast`、`pnpm test`、`pnpm build`、`git diff --check` 全部通过；
5. 涉及 schema / migration 的包，追加 `pnpm test:heavy`；
6. 真实 MySQL 8 路径完成 parity / concurrency 验证（具备受保护 disposable 环境时）；
7. 移动端在 320 / 390 / 430 / 680 四档下完成真实验收（新增 / 改造的工作面）；
8. `docs/status/CAPABILITY_MATRIX.md` 中 B3106 / B3107 / B3114–B3117 的覆盖状态按证据更新；
9. `docs/status/PROJECT_STATUS.md` 登记该域状态；
10. 业务所有者**明确**签发域级 Acceptance（Implementation Agent 自报 PASS **不构成** Acceptance）。

#### 35.8.2 分包验收条件

| 包 | 关键验收条件 |
|---|---|
| AA-W1 | 会计事件台账可证明「每个应生成凭证的业务事实恰有一条事件」；未生成清单可列出并可受控修复；对账工作台给出可解释差异与快照；期末检查覆盖凭证生成完整性且关账被真实拦截（负例）；会计科目可维护且有引用保护 |
| AA-W2 | 凭证模板可写且被真实消费；规则命中唯一、未命中显式失败；批量生成逐条独立事务、幂等、失败可见；公式求值无代码执行面 |
| AA-W3 | 冲销与补记统一路径且金额镜像；出纳复核独立权限与 SOD 生效；现金流量表可出且与资金子账可对账；期末转账 / 摊销 / 计提生成凭证；**真实损益结转**生效且未结转时禁止关账 |
| AA-W4 | 报表模板 + 项目 + 期间实例可维护；公式引擎无 `eval` / `Function` 且错误码可辨；生命周期「重算 → 提交 → 审核」留痕；自定义报表可建；既有 5 张固定执行报表口径不变 |
| AA-W5 | 政策实体被资产引用；转固保留来源且不重复；变更单有前后值快照与审批；拆分合并价值守恒；借用盘点有差异单；**折旧按政策自动计提并生成凭证**、幂等、与 GL 可对账；处置受控；route 可达 |
| AA-W6 | 核算范围可配并按范围出账；计价方法优先级确定；暂估单据与差异调整凭证闭环；采购费用分摊结果进入权威估值流水；完工差异分配显式；成本调整生成凭证；关账异常清单可定位 |
| AA-W7 | 经营账簿 / 经营单元 / 经营台账 / 内部结算价 / 费用归集分配 / 经营损益 / 经营关账七要素齐备；经营损益与法定损益可勾稽；经营关账前必须完成归集与分摊 |

#### 35.8.3 每包必须新增的测试

- 单元 / 合同测试：覆盖正例 + **至少一个反例**（越权、状态不允许、期间已关、幂等冲突、公式非法、数据不守恒）；
- 集成测试：跨模块（业务域 → 会计事件 → 凭证 → GL → 报表）链路；
- 回归测试：既有会计、估值、结账、报表、财务模块行为不变；
- 新增测试文件必须登记进 `scripts/testing/test-suites.js`，不得静默不分类；
- 禁止通过 `skip`、删除断言、降级测试分类制造绿色。

#### 35.8.4 状态与证据

- 每包完成后在 `docs/acceptance/` 留存验收证据文件；
- `docs/status/CAPABILITY_MATRIX.md` 的 Capability 覆盖状态**只能**依据可执行证据更新，不得凭代码文件存在宣称 `COVERED`；
- 本 Requirement 的实施状态按 §2.2 生命周期推进：`APPROVED` → `IMPLEMENTED` → `ACCEPTED` → `FROZEN`。

### 35.9 Hard Stop Conditions

出现下列任一情况，实施必须**立即停止**并回到 Requirement / Design 层裁定：

1. 需要新增业务规则、schema、migration、跨域影响、状态机，或会计 / 库存 / 结算 / 估值语义变更；
2. 需要修改 §35.6 列出的既有合同；
3. 手册解释与本节冲突；
4. 发现本节 Capability 编号与真实业务关系不一致；
5. 需要新增权限族但本节 §35.5 未列；
6. 需要把 AA-31 / 其他 `OUT_OF_SCOPE` 项拉回范围内。

停止时必须：保持工作树与外部状态 → 报告已发生什么 → 修订 Requirement / Design → 获得业务所有者确认 → 再恢复实施。

### 35.10 最终接受状态

| 项 | 值 |
|---|---|
| Requirement 状态 | `FROZEN`（2026-11-12 域级 Acceptance 与 Capability Freeze 已签发：`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS` / `ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`，43 项 `COVERED` 能力冻结；签发记录见 [`docs/acceptance/accounting-analytics-domain-acceptance-20261111.md`](../acceptance/accounting-analytics-domain-acceptance-20261111.md)） |
| Design 状态 | `APPROVED` → 已实施（`docs/design/accounting-analytics.md` §31） |
| Implementation 状态 | `COMPLETE`（AA-W1 → AA-W2 → AA-W5 → AA-W3 → AA-W6 → AA-W4 → AA-W7，提交 `3876bd3` / `e40a015` / `943414c` / `5e6739d` / `bc2035d` / `d9e7319`） |
| Domain Acceptance | **已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS`，2026-11-12） |
| Capability Freeze | **已签发**（`ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`，冻结 43 项 `COVERED` 能力） |
| Manual Closure | 未闭合 |
| Release Readiness | 未就绪 |

**已解决的矛盾**：`AA-07 委外成本` 原在 §35.3 记为目标 `COVERED` 并归属 AA-W6，但 §35.4.6 缺 AA-07 条款
（AGENTS.md §35.9 第 4 项 Hard Stop）。业务所有者 **2026-11-11 裁定选项 A**：委外成本口径由
Procurement & Outsourcing 域已冻结的 canonical 实现承担，本域只做权威事实引用；据此已在
**§35.4.6 补 AA-W6.17～AA-W6.19**。逐项复核结论随之为 **43 `COVERED` / 0 `PARTIAL` /
1 `OUT_OF_SCOPE`（AA-31）**，与 §35.3 目标一致。裁定过程见
[`docs/audits/accounting-analytics-capability-audit-20261110.md`](../audits/accounting-analytics-capability-audit-20261110.md) §7.3。

**已闭合**：Requirement §35.8.1 第 6 项的真实 MySQL 8 parity / concurrency 已运行并通过
（run `52ee28ff-377c-4558-a0d8-d4e7824a8c47` @ `003fc8cd`，`state=FINISHED`，清理独立 post-flight 证明）。

**冻**：本节（§35）与 Design §31 自 2026-11-12 起冻结，任何修改必须先走显式解冻。

---

**ACCOUNTING & ANALYTICS DOMAIN CLOSURE REQUIREMENT IMPLEMENTED — AWAITING OWNER ACCEPTANCE**

### 35.11 法定会计与经营期间一致性修订（`APPROVED`，2026-11-14；同日增补：经营关账职责分离与归属字段）

#### 35.11.1 法定会计期间权威语义

- Accounting & Analytics 继续是 `LEGAL_ACCOUNTING` 的唯一业务 owner；凭证、GL、会计事件、冲销、
  补记、更正和期末处理不得自行读取期间表，必须使用 Platform §36.15 的单一守卫合同。
- 法定会计期间采用连续关闭语义：只能关闭最早可关闭的开放期间，不得在更早期间开放时跳期关闭；
  反结账只能从最新已关闭期间逆序执行。
- 手工凭证与系统凭证必须使用同一期间判定；同一业务日期不得因入口不同而得到不同结果。
- 业务日期必须日历有效。期间记录缺失、状态损坏、关闭链不连续或调用方未声明动作类别时 fail closed。

#### 35.11.2 关账顺序与前置条件

`AA-W1.14` 的“业务系统先关账”明确为：目标期间末日前，库存期间已关闭，且 Finance Operations 的
AR、AP、Treasury 三个独立业务轴均已关闭至该日；随后才允许关闭法定会计期间。既有凭证状态、会计事件、
对账、损益结转、库存／WIP／AR／AP／Treasury 与 GL 勾稽检查继续适用，不得用新增顺序检查替代。

反向顺序必须为：先重开依赖该法定期间的全部已关闭经营账簿期间，再重开法定会计期间；之后是否重开
Finance 或库存轴由各自 owner 显式决定，法定反结账不得隐式重开任何业务轴。

#### 35.11.3 期末动作与有界例外

- 纯 GL 的期末转账、摊销、计提、损益结转可不受 `INVENTORY` 轴阻断，但始终受
  `LEGAL_ACCOUNTING` 约束；例外必须按动作白名单登记，不得继续使用任意调用方可传的通用绕过开关。
- 会改变库存数量／估值、AR、AP 或 Treasury 事实的期末动作必须同时通过对应业务轴，不得借“会计调整”
  名义绕过业务关闭。
- `period_end_runs` / `profit_transfer_runs` 只证明前置处理状态，不是法定期间关闭 authority。

#### 35.11.4 经营期间

- `OPERATING(managementBookId)` 按经营账簿隔离，继续独立于法定会计期间；法定期间先关闭是经营关账
  前提，但不阻止经营关账前从已过账法定事实执行受控归集与分摊。
- 某账簿某期间关闭后，归集、分摊、内部结算、重算及任何改变经营损益结果的 mutation 必须拒绝且
  副作用为零；受控重开后方可恢复。
- 经营重开必须强制原因、权限、SOD 与审计，不得隐式重开法定会计期间。
- **经营关账的职责分离（2026-11-14 修订补充）**：关账人不得是该期经营分摊所用
  `allocation_rules` 的创建人，也不得是该期 `allocation_results` 的执行人。判定必须基于**业务行上的
  权威归属字段**（`allocation_rules.created_by`、`allocation_results.created_by`），不得以审计日志等
  可变证据代替；既有历史行以审计日志一次性回填，回填后归属不得为空。
- 归属字段缺失、无法判定创建人或执行人时 **fail closed**：拒绝关账并返回可定位的阻断原因，
  不得默认放行，也不得由调用方传入布尔开关绕过。
- 为承载归属，本域对 `allocation_rules` / `allocation_results` 做**加列**扩展（additive，
  既有行不回填为臆测值：只能由审计日志回填，回填不到者留空并按上一条 fail closed）。

#### 35.11.5 并发、审计与验收

- 法定／经营关闭、重开和对应 mutation 必须在同一事务内锁定同一权威状态；MySQL 不得依赖无锁读取。
- 关键拒绝证据必须在业务事务回滚后仍可查询，至少包含 actor、动作、业务日期、阻断轴和关闭边界。
- 验收必须覆盖：跳期关闭、非最新反结账、三个 Finance 轴前置、手工与系统凭证一致性、纯 GL 例外、
  经营关闭后归集／分摊拒绝、重开恢复、失败零副作用以及真实 MySQL close-vs-mutation 并发。
- 经营关账职责分离的验收增量：关账人即该期分摊规则创建人或分摊结果执行人时关账被拒且状态不变；
  归属缺失时同样被拒；换用未参与该期分摊的人关账则成功；既有历史行的归属回填可核验。
- 既有 43 项冻结能力的当前有效性须在 Acceptance 轮按 `AGENTS.md` §4.6 逐条复核；本节不预判其
  `STILL_VALID` / `NEEDS_REVIEW` 结论。

---

### 35.12 存货与成本科目的手工凭证守卫与 GRNI 检查口径统一（F-06 附属，`APPROVED` → `IMPLEMENTED`，2026-11-18）

#### 35.12.1 身份与边界

- 用途：关闭「总账与权威估值被静默拆开」的两条路径，使 §32.15 的三项 BLOCKING 检查在真实环境里
  可归零。Owner = Accounting & Analytics（估值流水、关账检查、凭证录入）。
- 授权来源与范围：业务所有者 2026-11-18 指令「F-06 与 GRNI 口径立项走 Requirement → Design →
  Implementation」与「F-02 好像也还有矛盾 能否一并修好」（§4.0 连续阶段授权）。
- 缺陷事实（客户测试环境实测，真实 MySQL 8）：`INVENTORY_VALUE_TO_GL` = −10,219，逐笔归因为
  **三个互不相同的来源**：① 一张自由手工凭证贷记了存货科目而**没有任何估值流水**（−10,000）；
  ② 库存状态变更 IN 腿未计价（+1,381，属 Inventory 域，见 §32.17）；
  ③ 委外库存异动有估值流水但**没有总账分录**（−1,600，属 Procurement & Outsourcing 域，
  已在其 §31.21.4-5 登记为开放项，本轮不实现）。

#### 35.12.2 合同项

- **`AA-VAL-01`（自由手工凭证不得触碰存货科目）**：存货科目由**权威估值事实**驱动，
  因此自由手工凭证（`POST /api/accounting-vouchers`）不得以其为对方分录。受控科目集合由
  `account_role_mappings` 的角色码决定（`RAW_MATERIAL_INVENTORY` / `FINISHED_GOODS_INVENTORY` /
  `OTHER_INVENTORY` / `WIP` / `GRNI`），不得硬编码科目号。
  命中时固定 409（`MANUAL_VOUCHER_CANONICAL_SUBJECT`），**零副作用**（不产生凭证与分录）。
  更正路径：库存调整单 / 成本调整（自动过账），或对既有凭证做**补记 / 冲销**。
  *残余登记*：成本与差异科目（`COGS` / `INVENTORY_GAIN_LOSS` / `INVENTORY_SCRAP_EXPENSE` /
  `MATERIAL_PRICE_VARIANCE` / `MANUFACTURING_VARIANCE` / `PURCHASE_PRICE_VARIANCE` /
  `PURCHASE_RETURN_VARIANCE` / `OUTSOURCING_PROCESSING_FEE`）、应收 / 应付 / 现金 / 银行 / 税金 /
  收入科目本轮**不**纳入守卫：成本侧的自由调整同时牵涉损益结转合同（`AA-W3`），应收 / 应付 /
  现金 / 税金科目属 Finance Operations 与本域的其余合同。其对账检查同样可能因自由凭证失配，
  作为开放项登记，待各自合同裁定后再纳入。
- **`AA-VAL-02`（GRNI 子账侧只能是暂估未结转）**：`GRNI_TO_GL` / `RECEIPT_GRNI_TO_GL` 的子账侧
  只能是**暂估未结转**的收货应付（`item_class='SOURCE'` 且 `item_kind='PROVISIONAL'` 且
  `conversion_state='OPEN'`）。原实现误用 `item_kind='FINAL'`（与 AR/AP 口径复制），
  使已转销行与暂估行同时被排除，恒定失配。
- **`AA-VAL-03`（GRNI 总账侧按平台记账约定取贷 − 借）**：在途物资（1407）在平台约定下是
  **贷方口径**（确认收货贷记、账单结转借记），因此「未结转收货金额」= 贷 − 借。
  同一检查在三处实现（`financial-inventory.js` / `accounting-reconciliation.js` /
  `commercial-golive.js`）必须**同口径**，不得一处贷 − 借、另一处借 − 贷。
- **`AA-VAL-04`（存货价值对账的两侧必须同域）**：`INVENTORY_VALUE_TO_GL` 的价值流水侧覆盖
  **全部**存货估值池（含在制 / 委外在途仓位），总账侧因此必须包含在制科目（`WIP` / 1404）；
  否则在制池有值而总账侧没有 → 恒定失配。

#### 35.12.3 验收增量

1. 自由手工凭证命中存货 / 成本科目时 409 + `MANUAL_VOUCHER_CANONICAL_SUBJECT`，且**零副作用**
   （凭证与分录计数不变）。
2. 非受控科目的自由手工凭证仍可正常创建、提交、审批（既有能力不回退）。
3. GRNI 检查：暂估未结转金额与总账在途物资口径一致，差异为 0；三处实现同口径。
4. `INVENTORY_VALUE_TO_GL` 两侧同域（含在制科目）。
5. 变异对照：把守卫的科目集合清空 → 「手工凭证 409」断言必须转红；
   把 GRNI 总账侧改回借 − 贷 → GRNI 差异断言必须转红。
6. `pnpm test`、`pnpm build`、`git diff --check` 与两种文档一致性模式全部通过。

**Requirement 状态：`APPROVED`（2026-11-18，业务所有者授权）。Design §31.17：`APPROVED`（同日）。
Implementation：已实施（2026-11-18）；真实 MySQL 连接、数据库写操作、发布与部署**未授权**。**

### 35.13 手工凭证守卫的受控科目族扩展与旁路闭合（`APPROVED` → `IMPLEMENTED`，2026-11-18）

> **用途 / Owner / 状态 / 权威关系**：本节修订 §35.12 `AA-VAL-01` 的受控科目集合边界，并把守卫
> 从「只覆盖凭证创建路径」扩展到「覆盖全部手工凭证写路径」。Owner 为 Accounting & Analytics
> Domain Owner。生命周期状态 `IMPLEMENTED`（2026-11-18：合同已获批准并按已批准合同实施，
> **尚未验收**）。
> 对应 Design 见 `solution.md §31` → `docs/design/accounting-analytics.md` §31.18。
> 本节**不取代** §35.1～§35.12 的任何正文。
>
> **授权来源**：业务所有者 2026-11-18「将三项收口 然后将三项残余修复」（AGENTS.md §4.0
> 连续阶段授权），并就本节两项口径作出裁定：
> 1. 受控科目族扩展到**成本与差异族**（本节 §35.13.2 的 10 个角色码）；
> 2. **一并封住**改分录与冲销两个旁路（只扩科目集合封不住它们）。
>
> **显式有界解冻**：本节**有界解冻** §35.12 的 `AA-VAL-01..04` 四项，仅覆盖
> 「受控科目集合」与「守卫生效路径」两处；`AA-VAL-02`（GRNI 子账侧口径）、
> `AA-VAL-03`（GRNI 总账侧口径）与 `AA-VAL-04`（存货价值对账两侧同域）**未被修改**，
> 其正文与既有断言继续有效。AC2 轮次 Acceptance 记录 §2 表中的 17 个冻结合同项中，
> `AA-VAL-01..04` 被本节有界解冻，其余 13 项**不受影响**。

#### 35.13.1 事实基础（仓库代码取证 + 客户测试环境真实 MySQL 8 实测，2026-11-18）

| # | 事实 | 证据 |
|---|---|---|
| H1 | 守卫**只有一处实现**，内联在凭证创建处理器内 | `server/app.js:6229-6239`（`createAccountingVoucher` 内） |
| H2 | 改分录路径**没有**守卫 | `server/app.js:6260` `updateAccountingVoucher`（`PATCH /api/accounting-vouchers/:id`）在写入分录前**不**校验受控科目 |
| H3 | 冲销路径**没有**守卫 | `server/app.js:8199` `reverseManualVoucher`（`POST /api/accounting-vouchers/:id/reverse`）经 `accounting-posting.js::reverseVoucher` 镜像原凭证分录，**不**校验受控科目 |
| H4 | 受控科目集合由角色码推导，未硬编码科目号 | `server/app.js:6230-6232`：`SELECT subject_id FROM account_role_mappings WHERE role_code IN (...)` |
| H5 | 科目表**没有**科目族字段 | `accounting_subjects` 只有 `type ∈ {ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE}` 五值，粒度不足以表达「存货科目族」；`account_role_mappings.role_code` 是 PRIMARY KEY，一角色码只能对一个科目 |
| H6 | 成本与差异族已有角色码，**无需**新增科目或角色码 | `COGS` 6401、`INVENTORY_GAIN_LOSS` 6402、`INVENTORY_SCRAP_EXPENSE` 6403、`MATERIAL_PRICE_VARIANCE` 6404、`MANUFACTURING_VARIANCE` 6405、`PURCHASE_RETURN_VARIANCE` 6406、`PURCHASE_PRICE_VARIANCE` 6407、`LABOR_ABSORPTION` 5101、`OVERHEAD_ABSORPTION` 5102、`OUTSOURCING_PROCESSING_FEE` 6408 |
| H7 | 这些科目同样由权威事实驱动 | 生产领料 `Dr WIP / Cr 存货 / 差异`、生产吸收 `Dr WIP / Cr 5101 / Cr 5102`、销售出库成本 `Dr 6401 / Cr 存货`、委外加工费账单 `Dr 6408 / Cr 2202` —— 全部是 `createSystemVoucher` 产出的**系统凭证** |
| H8 | 受控科目会影响多个 BLOCKING 对账检查 | `/api/system-health` 的 `COGS_TO_GL` 取 `COGS`（6401）；`INVENTORY_VALUE_TO_GL` 取存货角色集合；`WIP_TO_GL` 取 `WIP`（1404） |
| H9 | 客户环境**没有**触碰受控科目的手工凭证 | 实测：`accounting_vouchers.source_type='MANUAL'` 共 1 张，其分录科目为 6603 / 6609，均**不在**本节受控集合内；触碰受控科目的手工凭证数为 **0** |
| H10 | 冲销的 canonical 路径同时服务手工与系统凭证 | `server/modules/accounting-posting.js:139-145`：系统凭证冲销用 `SYSTEM_REVERSAL`、手工凭证冲销用 `MANUAL_REVERSAL`，二者共用 `reverseVoucher` |

**根因**：H1 说明守卫是一个**单点实现**，而不是「一条写路径上的约束」。H2、H3 是同一根因的两个
实例：守卫只挂在创建路径上，其余手工凭证写路径不受约束，于是「先建一张违规凭证再改分录」与
「对违规凭证冲销」都能绕过守卫 —— 受控科目依然可以被自由手工凭证触碰，`AA-VAL-01` 的保护目标
在实现层并不成立。

#### 35.13.2 合同条款

| ID | 条款 |
|---|---|
| `AA-VAL-05` | 受控科目集合**必须**扩展到成本与差异族，与存货族合并为同一受控集合：`RAW_MATERIAL_INVENTORY`、`FINISHED_GOODS_INVENTORY`、`OTHER_INVENTORY`、`WIP`、`GRNI`、`COGS`、`INVENTORY_GAIN_LOSS`、`INVENTORY_SCRAP_EXPENSE`、`MATERIAL_PRICE_VARIANCE`、`MANUFACTURING_VARIANCE`、`PURCHASE_RETURN_VARIANCE`、`PURCHASE_PRICE_VARIANCE`、`LABOR_ABSORPTION`、`OVERHEAD_ABSORPTION`、`OUTSOURCING_PROCESSING_FEE`。集合仍**必须**由 `account_role_mappings` 的角色码推导，**不得**硬编码科目号；**不得**为扩展本守卫而新增科目或角色码。 |
| `AA-VAL-06` | 守卫**必须**覆盖**全部**手工凭证写路径：创建（`POST /api/accounting-vouchers`）、改分录（`PATCH /api/accounting-vouchers/:id`）、冲销（`POST /api/accounting-vouchers/:id/reverse`）。改分录路径**必须**校验**将要写入的完整分录集合**，**不得**只校验「变更后的分录」而放过「既有分录」。 |
| `AA-VAL-07` | 冲销路径的守卫**只**适用于**手工凭证**的冲销：冲销一张手工凭证时**必须**校验**原凭证**的分录科目（原凭证的分录即冲销凭证的分录）；**系统凭证**的冲销（`SYSTEM_REVERSAL`，含采购退货、销售退货等业务单据的冲销）**不受**本守卫约束，**不得**因此被阻断。 |
| `AA-VAL-08` | 守卫**必须**只有**一处**实现（单一 canonical 原语），创建、改分录、冲销三条路径**必须**调用同一实现；**不得**在处理器内各自内联一份科目集合。 |
| `AA-VAL-09` | 命中受控科目时**必须**固定拒绝：`409` + 错误码 `MANUAL_VOUCHER_CANONICAL_SUBJECT` + 明确的 `resolution`；**必须**零副作用（不产生凭证与分录）。错误码**保持不变**（既有合同事实，跨域消费方按 §35.12 的既有口径引用）。 |
| `AA-VAL-10` | **能力不回退**：**非**受控科目**必须**仍可自由录入（如费用类 6602 / 6603、现金 1001、收入 6001、税金 222101 / 222102）。本节**不得**把守卫扩大为「除现金外的一切」。 |
| `AA-VAL-11` | 系统凭证**不得**受本守卫约束：生产领料、生产吸收、销售出库成本、采购入库、委外加工费账单、期初库存等由业务事实驱动的凭证**必须**继续正常产生。 |
| `AA-VAL-12` | **历史更正路径收窄（能力收缩，必须登记）**：既有触碰受控科目的手工凭证**不得**再被冲销，也**不得**再被改分录；其更正**必须**经业务单据（库存调整单 / 成本调整）或系统凭证产生。客户环境实测该类凭证数为 **0**（H9），故本收缩在交付环境无实际影响。 ||
| `AA-VAL-13` | **既有合同测试的夹具调整**：既有报表类合同测试（试算平衡 / 资产负债表 / 损益表 / 财务摘要）以自由手工凭证构造**费用侧**事实，而费用侧原先使用 `6401 主营业务成本`；该科目本轮纳入受控集合后，自由手工凭证不得触碰它，故这些测试的**费用侧夹具改用非受控科目 `6603 处置资产损益`**（EXPENSE 类型，口径等价）。**断言的强度与语义不变**，仅科目引用随夹具调整；科目目录断言（目录中仍含 `6401`）不变。 |

#### 35.13.3 明确不在本节范围内的事项

1. **应收 / 应付 / 现金 / 银行 / 税金 / 收入科目纳入守卫**：本轮**不**纳入。它们属 Finance Operations
   与本域的其余合同（`AR_TO_GL` / `AP_TO_GL` / `CASH_BANK_TO_GL` / 税金检查），纳入会改变既有
   权限与操作结果，需单独裁定（登记为开放项，见 §35.13.5）。
2. **科目族字段**：**不**给 `accounting_subjects` 增加族字段，**不**改动
   `account_role_mappings.role_code` 的主键约束；受控集合仍由角色码清单表达。
3. **系统凭证冲销**：**不**改动 `reverseVoucher` 的系统冲销行为（`AA-VAL-07`）。
4. **历史凭证的追认或补记**：**不**追认、**不**补记任何历史违规手工凭证。
5. **手工凭证的其它写路径**（提交 `submit`、审核 `approve`、删除 `delete`）：这些路径**不新增或删除
   分录**，因此**不**受本守卫约束；状态流转**不变**。

#### 35.13.4 可验收条件

| ID | 验收条件 |
|---|---|
| `AA-VAL-AC-01` | 手工凭证命中**存货族**科目 → 409 + `MANUAL_VOUCHER_CANONICAL_SUBJECT`，且凭证与分录计数**不变**。 |
| `AA-VAL-AC-02` | 手工凭证命中**成本与差异族**科目（至少覆盖 6401 / 6404 / 6408 三类）→ 409 + 同一错误码，零副作用。 |
| `AA-VAL-AC-03` | **改分录**路径：把一张合法手工凭证的分录改成命中受控科目 → 409 + 同一错误码，原凭证的分录与状态**均未改变**。 |
| `AA-VAL-AC-04` | **冲销**路径：一张命中受控科目的**既有**手工凭证 → 冲销被拒（409 + 同一错误码），**不得**产生冲销凭证；一张**合法**手工凭证 → 冲销**仍然成功**。 |
| `AA-VAL-AC-05` | **系统凭证不受约束**：生产领料、销售出库成本、采购入库、委外加工费账单等既有流程**全部**保持通过，且其系统凭证正常产生。 |
| `AA-VAL-AC-06` | **能力不回退**：非受控科目（6603 / 1001 / 6001 等）的手工凭证**仍然**录入成功（201）。 |
| `AA-VAL-AC-07` | 守卫实现唯一：全仓 `MANUAL_VOUCHER_CANONICAL_SUBJECT` 的抛出点**有且仅有一处**（静态断言）。 |
| `AA-VAL-AC-08` | 变异对照：清空受控科目集合 → `AA-VAL-AC-01/02/03` 必须转红；移除改分录路径的守卫调用 → `AA-VAL-AC-03` 必须转红；移除冲销路径的守卫调用 → `AA-VAL-AC-04` 必须转红。 |

#### 35.13.5 未解决矛盾（需业务所有者裁定，本节不自行决定）

1. **应收 / 应付 / 现金 / 银行 / 税金 / 收入科目是否纳入守卫**：本轮明确不纳入。这些科目同样有
   权威事实驱动方（AR / AP 开项、结算流水、发票与账单），纳入后 `AR_TO_GL` / `AP_TO_GL` /
   `CASH_BANK_TO_GL` 的失配也会被挡住；但现金与收入科目的人工调整（手续费、红字冲销）在实务中
   常见，全面封锁的可用性代价最高。留待后续裁定。
2. **历史违规手工凭证的更正路径收窄**（`AA-VAL-12`）：本轮按 fail closed 收窄。若客户环境出现
   此类凭证，只能走业务单据或系统凭证，**不**提供人工绕过。

**Requirement 状态：`APPROVED`（2026-11-18，业务所有者授权）。Design §31.18：`APPROVED`（同日）。
Implementation：已实施（2026-11-18）；真实 MySQL 连接、数据库写操作、Acceptance / Freeze 签发、
发布与部署**未授权**。**
