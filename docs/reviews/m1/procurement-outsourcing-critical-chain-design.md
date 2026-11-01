# M1 采购与委外关键断链统一整改 —— 候选设计正文（待业务所有者审阅）

> **用途**：保存 M1 `solution.md §26.33` 的**完整候选设计合同**，使其在 G0 文档结构下可被
> 评审、引用与追溯，而**不**产生第二份 Active Design 正文。
> **Owner**：Procurement & Outsourcing（Domain Owner）
> **状态**：`PENDING_APPROVAL` / `PENDING_REVIEW` —— 候选设计，**不是**当前已批准 Design
> **权威来源**：**无**。本文件**不构成** Current Active Contract，不签发 `Design PASS`，
> 不构成 Domain Acceptance / Freeze / Release Readiness。
> **来源 SHA**：`912fd76700ff6f3ad1509eec4c9e2241c1830265`
> （`work/m1-r4-6-design-correction-20261101`，`docs(erp): 登记 M1 R4-6-R2 Git Closure 交付记录`）
> **来源章节**：`solution.md §26.33 M1 Integrated Critical Chain Design（2026-10-31；Design 阶段，待业务所有者审阅）`
> **对应 Requirement**：[`docs/requirements/procurement-outsourcing.md`](../../requirements/procurement-outsourcing.md) §31.12
> （已由业务所有者于 2026-10-31 验收，标识 `M1_REQUIREMENT_ACCEPTANCE_PASS`）
> **Active Design**：[`docs/design/procurement-outsourcing.md`](../../design/procurement-outsourcing.md) §26
> （当前**唯一** Active 的 Procurement & Outsourcing Design 正文；**不含** §26.33）
> **Implementation**：`NOT_AUTHORIZED`
> **Design PASS**：`NOT_ISSUED`
> **当前项目状态**：[`docs/status/PROJECT_STATUS.md`](../../status/PROJECT_STATUS.md) §36.3
> **开放业务政策**：[`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../../decisions/OPEN-BUSINESS-DECISIONS.md)

## 位置与引用说明

G0 文档重构后，根目录 `solution.md` 只保留全局架构合同与 Domain Design 导航，
**不再保有** §26 的正文；原 `solution.md §26.33` 的正文即本文件。

因此：

- 本文件正文中的 `solution.md §26.33`、`§26.33.x` 等自指，**指的就是本文件**；
- 本文件正文中的 `document.md §31.12`，现位于
  [`docs/requirements/procurement-outsourcing.md`](../../requirements/procurement-outsourcing.md) §31.12
  （章节编号原样保留，深引用继续有效）；
- 本文件正文中的 `solution.md §26`、`§27`、`§28` 等，分别位于
  [`docs/design/procurement-outsourcing.md`](../../design/procurement-outsourcing.md)、
  [`docs/design/inventory-warehouse.md`](../../design/inventory-warehouse.md)、
  [`docs/design/finance-operations.md`](../../design/finance-operations.md)；
- 迁移前的历史行号 / 章节引用解析规范见
  [`docs/status/MIGRATION-MAP.md`](../../status/MIGRATION-MAP.md) §4，
  可执行命令为 `node scripts/docs/resolve-reference.mjs "<引用>"`。

## 状态边界

1. 本文件**只是候选设计**。业务所有者尚未签发 `Design PASS`，因此**不存在** §26.33 的 Active Design。
2. §26.33 内部 R1 / R2 / R3 / R4 / R4-5 / R4-6 / R4-6-R1 / R4-6-R2 的修订轮次，
   **只是该设计自身的内部纠错**，**不等于**业务所有者已批准整个 Design。
3. 本文件**不授权**任何 Implementation、Migration、数据库写入、发布或部署。
4. §26.33.12 的 **13 个 Gate 全部为 `NOT_RUN`**；§26.33.14.1 / §26.33.14.2 登记的
   **12 项开放业务政策**（`A-P02`、`B-P01`、`B-P02`、`C-P01..C-P04`、`D-P01`、`D-P02`、
   `M1-P-02`、`M1-P-03`、`M1-P-04`）均未获批准。`A-P01` 独立为
   `OWNER_RATIFICATION_PENDING`，不计入这 12 项；`M1-P-01` 已按 OUT-09 / OUT-08 闭合。
5. 整体 Design 的审批条件与各工作包的 Implementation 阻塞不是同一概念：业务 Owner 完成上述
   政策裁定与独立追认后，才可能签发 Design PASS；各 WP 的精确阻塞范围仍以 §26.33.15 为准。
   某个 WP 保持 `BLOCKED` 不会使整个设计自动成为 `APPROVED`，本说明也不擅自批准任何政策。
6. Design PASS 之后还需**单独**执行 **Active Design Promotion**（把正文移入 `docs/design/`），
   Implementation 仍需独立授权；本轮**不提前执行**。

---

> 以下为 `solution.md §26.33` 的**逐字正文**（源 SHA `912fd76700ff6f3ad1509eec4c9e2241c1830265`，
> 源行范围 3960–8158，4199 行）。正文内容**未被修改**，章节编号与内部结构原样保留。

### 26.33 M1 Integrated Critical Chain Design（2026-10-31；Design 阶段，待业务所有者审阅）

> **阶段与授权**：业务所有者已于 2026-10-31 接受 M1 原 Audit 及 M1-AE 有限勘误，签发 `M1_REQUIREMENT_ACCEPTANCE_PASS`，并授权进入 M1 Design（`AGENTS.md §4.3`）。本节是 **DESIGN**，不是 IMPLEMENTATION：未签发任何 Capability 的 `COVERED`，未签发 Domain Acceptance / Freeze / Release Readiness，未执行 Migration、MySQL 写入、Git 写操作、发布或部署。已批准业务权威是 `document.md §31.12`；本节**只**给出技术实现方案，**不**改写 §31.12 的业务规则、Gap 映射、Capability 归属与 13 个验收 Gate。
>
> **上游基线**：GitHub `master@4cb8c477aa00988bbfebef905764565cdfe62b71`（`docs(m1): approve procurement and outsourcing requirement`），`github` 与 `origin` 双远端一致；**该轮 Design 开始时**工作树干净（本轮 R1 修订后的工作树含未提交修改，见 §26.33 抬头 R1 块）。本节依据 `document.md §22.1 / §22.21 / §31.1–31.12 / §35.8`、`solution.md §26`、Inventory V21（`solution.md §27`）、Finance Operations（`§28`）、Accounting 与 Quality 的当前 Canonical Design，以及对本仓库真实生产代码的逐文件核对。
>
> **证据纪律**：本节所有函数名、表名、列名、行号均来自实际源码；不存在于源码的接口一律显式标注为“**不存在（本次需新建）**”，不得以文档既有措辞冒充实现。设计所依赖的运行时事实（数量恒等式、状态机、锁语义）均为**静态源码事实**，本轮**未运行任何测试、MySQL 或浏览器**，所有 Gate 仍为 `NOT_RUN`。
>
> **编号约定**：§26.33 的决策编号为 `M1-D-xx`（技术决策）、`M1-F-xx`（源码与已批准 Requirement 的冲突登记）、`M1-P-xx`（本 Design 内新发现的、需业务 Owner 裁定的语义待决项，不属于 §31.12 的十项）。所有 `POLICY_DECISION_PENDING` 标记表示该子项**不得**进入 Implementation。
>
> **R1 有界修订（2026-10-31；Design 内部修订轮，未取得新业务政策）**
>
> - **授权来源**：业务所有者本轮指令《M1-D-R1 — Focused Design Reconciliation & Evidence Export》，授权对**已授权的 M1 Design** 做一次有界修订；**不是**新的 Audit、Requirement 或 Implementation 授权。
> - **范围**：只改写本节内已登记的技术合同。不新增业务政策；不改写 `document.md §31.12` 的业务合同、Gap 映射、Capability 归属、13 个验收 Gate 与十项未决政策登记；`document.md` 的 R-ACC 修改保持原状。
> - **输入依据**：本轮对本仓库生产源码的逐行复核 —— `server/lib/inventory-mutation.js`、`server/modules/traceability-quality.js`、`server/modules/financial-inventory.js`、`server/modules/outsourcing.js`、`server/modules/outsourcing-finance.js`、`server/modules/procurement-receiving.js`、`server/modules/procurement-vmi.js`、`server/modules/quality-gates.js`、`server/modules/commercial-golive.js`、`server/modules/financial-controls.js`、`server/modules/engineering-bom.js`、`server/lib/stock.js`、`server/database/mysql-schema.js`、以及 `server/migrations/procurement-outsourcing-schema.js` 与 `server/migrations/v13-phase6b-traceability-quality.js`；并核对 Git 历史 `09abeb4`(2026-10-09 15:43) 与 `4e035c5`(2026-10-09 19:31) 的先后顺序。
> - **本轮纠正五项**：`R1-01` 严格跟踪写者；`R1-02` 估值写者与数量/价值对账；`R1-03` 来源类型注册表；`R1-04` Planning handoff 现状裁定；`R1-05` E-06 容量公式的数学解释。逐项结论见 **§26.33.4.6**（R1-01/R1-02/R1-03）、**§26.33.5.1**（R1-05）与 **§26.33.14.3**（R1-04 与 8+1 发现去重）。
> - **本轮未发生**：未修改任何实现代码、测试、Schema/Migration 或配置；未运行 MySQL、浏览器或业务测试；未执行 Git add/commit/push/merge/tag/release/deploy；未签发任何 Capability 的 `COVERED`、Domain Acceptance、Freeze 或 Release Readiness；§31.12.9 的 13 个 Gate 的 `execution_status` 全部保持 `NOT_RUN`（`readiness_status` 的双维度口径见 §26.33.12，R3 起适用）。
>
> **R3 有界修订（2026-10-31；跨小节最终一致性勘误轮）**
>
> - **授权来源**：业务所有者《M1-D-R3 — Final Cross-Section Consistency Correction》，授权对**已存在的 `solution.md §26.33`** 做最后一次**有界技术合同纠正**。**不是**新的 Audit 或 Requirement；**未**授予 Implementation 授权；业务所有者**尚未**批准 M1 Design PASS。
> - **范围**：只改写本节内已存在的设计内容。**保留** `M1-D-01..36` 决策编号、`WP-0..WP-8` 工作包、13 个 Gate 的**编号**；**不**新增业务 Requirement；**不**新增业务政策批准；**不**擅自选择 `A-P02`、`B-P01`、`B-P02`、`C-P01..C-P04`、`D-P01`、`D-P02`、`M1-P-02`、`M1-P-03` 中的任何方案。
> - **本轮纠正十项**：`A` 统一 C-01 通知来源模型；`B` 统一 C-02 WIP 转移合同；`C` 重新核对 C-03 VMI 恒等式；`D` 修复 C-06 Tracking Identity 双端唯一性合同；`E` 增强 C-08 历史收货证据判定；`F` 完善 C-07 加工费容量边界；`G` 修正 C-04/C-09 与决策台账；`H` 跨章节引用与状态口径统一。
> - **全篇交叉检查**：从 §26.33.1 到 §26.33.15 逐项复核字段名、公式、迁移清单、Schema 与 Migration 的 NOT NULL 一致性、SQLite/MySQL 语义、内部章节引用、决策台账、Gate 追踪、WP 依赖图与政策待决项；旧字段/旧公式一律**彻底更新**或**明确标记为历史兼容 / 已废弃 / 仅用于解释旧缺陷**，禁止同一字段在不同小节拥有互斥定义。
> - **本轮未发生**：未修改任何实现代码、测试、Schema、Migration 或配置文件；未运行数据库、Migration、MySQL、浏览器或业务测试；未执行 Git add / commit / push / merge / reset / rebase / tag / release；未签发任何 Capability 的 `COVERED`、Domain Acceptance 或 Freeze；`document.md` 的 R-ACC 与 D-REQ-03 / UAT-14 oracle 登记**未被回退**。
> - **状态语义**：`DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE` = 技术合同已完整且与已批准 Requirement 自洽，剩余为业主验收；`TECHNICAL_CONTRACT_UNPROVEN` = 该包内某项技术合同尚缺可静态确立的事实或只在设计中断言；`DEPENDENCY_PENDING` = 依赖他包/他域交付物；`POLICY_DECISION_PENDING` = 需业务政策裁定后方可实施。
>
> **R4 有界修订（2026-10-31；R3 独立复核发现的技术合同闭合轮）**
>
> - **授权来源**：业务所有者《M1-D-R4 — R3 Independent Review Findings Closure》，授权对**已存在的 `solution.md §26.33`** 做一次**有界技术纠正**。**不是**新的 Audit / Requirement；**未**授予 Implementation 授权；业务所有者**尚未**批准 M1 Design PASS。
> - **范围**：只改写本节内已存在的设计内容。**保留** `M1-D-01..36` 决策编号、`WP-0..WP-8` 工作包、13 个 Gate 的**编号**；**不**新增业务 Requirement；**不**新增业务政策批准；**不**擅自选择 `A-P02`、`B-P01`、`B-P02`、`C-P01..C-P04`、`D-P01`、`D-P02`、`M1-P-02`、`M1-P-03`、`M1-P-04` 中的任何方案。
> - **本轮纠正十一项**（逐项结论见对应小节）：
>   - `R4-01` **C-05 Mutation Key 唯一性**：R3 的 `<SOURCE_TYPE>:<business_event_id>:<legSeq>` **不区分同一业务事件内的多个业务项**。已核对源码：`confirmOutsourcingReceipt`（`outsourcing-finance.js:100-124`）的倒冲按 `for (const m of materials)` **逐个物料行**产生物理 OUT 腿 → 同一事件下 N 个物料行会算出**同一个** Mutation Key → 非 Consignment 路径命中 `inventory_mutation_log` 后**不比对请求内容**直接返回 `replayed:true`（`inventory-mutation.js:258-261`）→ 第 2…N 条腿被**静默丢弃**。SERIAL 拆分同理。**修正**：Mutation Key 扩为 `<SOURCE_TYPE>:<business_event_id>:<business_event_item_id>:<leg_seq>:<identity_key>`，并增加"非预期重放"硬断言。
>   - `R4-02` **INV-WIP-3 自指不等式**：R3 的 `transferred_out_i ≤ (… − transferred_out_i + transferred_in_i)` 左端含 `transferred_out_i`，是**自指**的。**修正**：拆为 `WIP_before / q_requested / cum_transferred_out / WIP_after` 四个量，并新增**逐行**非负断言。
>   - `R4-03` **历史 WIP 身份隔离**：M-07b **不回填** `transferred_out/in`（历史转移量已净值计入 `issued_quantity`，回填即**双计**）；新增**持久化**的 `identity_state` / `source_resolution_state` / `legacy_unverified_wip_quantity` / `identity_evidence_state`，把"不可证身份"的历史量**隔离**在新的可转出/可倒冲之外。
>   - `R4-04` **WIP 转移相容性**：产品 / UOM / 供应商 / 供应商 WIP 仓 / LOT-SERIAL 身份五项相容门禁；现状 `createWipTransfer`（`outsourcing-finance.js:383-406`）**只**按 `product_id` 找目标行，**不**校验供应商、UOM、仓库、身份 → 不相容转移必须 fail closed。
>   - `R4-05` **VMI 公式**：R3 的 VMI-P/S/E 把 `adjusted_*` 放在**右端**，VMI-R 的 closing 却把同一量放在**左端**（`+ adjusted`）→ 两式**互斥**（差 `2 × adjusted`）。**修正**：统一为**有符号**调整量，`adjusted_*` 一律置于**左端**（来源侧）；补齐 §26.33.4.4 中**遗漏 `+ adjusted_enterprise_qty`** 的过期 closing 公式；补 5 个数值例子；未归属调整量的**绝对值**超容差即拒绝关期。
>   - `R4-06` **C-01 RESOLVED 完整性**：`RESOLVED` 必须伴随**实际已解析来源行**且其 `allocated_quantity` 之和**恰好**对账原未解析量；空来源集合或数量不对账 → fail closed。
>   - `R4-07` **M-12 迁移完整性**：M-12a / M-12b **逐列**给出取值来源（主键确定性派生、`business_date` 取 `receipt_notices.notice_date`、`created_at`/`updated_at` 取通知的历史时间戳、`detected_at` 取迁移执行时刻并**排除出 parity**）；`converted_quantity` 对遗留行写 **NULL（未证明）**而非 0。
>   - `R4-08` **M-15 执行顺序**：R3 把 PRE-B（"回填后自洽"）排在**加列之前** → 顺序不可能成立。**修正**：PRE-A 可在加列前；加列 → 回填 → PRE-B/PRE-C → 建索引；并规定 MySQL DDL 自动提交下**部分完成后的重试语义**与 feature gate 开启前置。
>   - `R4-09` **VAL-12 / T-02 一致性**：VAL-12 原写"**语义等价**"，与 T-02 的"形式上不等价"**冲突**。**修正**：按"重复必拒绝 / 不同必放行 / 谓词外行"三方向如实表述，删除"语义等价"断言。
>   - `R4-10` **C-07 OVER_RESERVED 模型**：R3 只说"登记为 `OVER_RESERVED`"，**没有**持久化载体。**修正**：定为**账单行级**持久状态 + 账单级派生；超额行**仍属** active 预留集合；按确定性顺序识别超额；取消/重开时只**重算标记**、绝不缩减预留量。
>   - `R4-11` **多 PO 与交期容量**：R3 只定义了通知行口径，**未**定义 PO 行剩余、交期/容差剩余、供应商/仓库相容与累计转换量。**修正**：四重容量界逐项定义；确定"一个通知行**不得**分配到同一 PO 行的多条交期"→ 唯一键保持 NOT NULL；`received_quantity` **从未被维护**的事实 → 交期消费量的权威口径与 fail-closed 分支。
> - **本轮未发生**：未修改任何实现代码、测试、Schema、Migration 或配置文件；未运行数据库、Migration、MySQL、浏览器或业务测试；未执行 Git add / commit / push / merge / reset / rebase / tag / release / deploy；未签发任何 Capability 的 `COVERED`、Domain Acceptance 或 Freeze；`document.md` 的 R-ACC 与 D-REQ-03 / UAT-14 oracle 登记**未被回退**。
> - **状态语义**：`DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE` = 技术合同已完整且与已批准 Requirement 自洽，剩余为业主验收；`TECHNICAL_CONTRACT_UNPROVEN` = 该包内某项技术合同尚缺可静态确立的事实或只在设计中断言；`DEPENDENCY_PENDING` = 依赖他包/他域交付物；`POLICY_DECISION_PENDING` = 需业务政策裁定后方可实施。
>
> **R4-5 有界技术修订（2026-11-01；Post-R4 独立复核）**
>
> - **授权来源与边界**：业务所有者《M1 Design R4-5 — Post-R4 Independent Review: Bounded Technical Contract Remediation》只授权修订既有 `solution.md §26.33` 与追加当日日志；不是 Audit / Requirement / Implementation / Acceptance / Freeze 授权，不批准任何业务政策，也不授权数据库、测试或 Git 写操作。
> - **输入依据**：已批准 `document.md §31.12`（尤其 A-REQ-03、C-REQ-01、C-REQ-04）、PRC-16/20/22、OUT-08/09、R4 全部技术合同及 2026-10-30～2026-11-01 日志。R4-5 不改变 `M1-D-01..36`、`WP-0..WP-8`、M-01..M-18、13 个 Gate 的编号与状态。
> - **六项修订**：R4-03 改为“受影响行当前余额全量隔离”的可证明模型；R4-07 把来源行可转换授权与订单级保守预留分开；R4-11 取消通过省略交期参数绕过容量的路径，并以可追溯交期消费事实作为唯一权威；R4-10 区分未过账超额与 POSTED 历史异常；Mutation Key 统一称为“五字段（SOURCE_TYPE + 四个区分维度）”；VMI 明确池级等式与 `unallocated_adjusted_qty` 的差额关系；政策登记统一为 12 项开放政策、A-P01 独立待追认、M1-P-01 已闭合。
> - **未解决边界**：零有效交期时是否允许无交期转换、退货导致 POSTED 预留超额后的最终会计处置、历史 WIP/交期/转换量证据规模，仍须 Owner 裁定或独立历史对账；在裁定或证据到位前一律 fail closed。`TECHNICAL_CONTRACT_UNPROVEN` 仅保留给这些未获证据/裁定的子项，不伪造 Design PASS。
>
> **R4-6 Final Technical Contract Correction（2026-11-01）**
>
> - **授权来源与交付边界**：业务所有者《R4-6：M1 Design Correction、Cross-Section Consistency Audit & Dual-Remote Delivery》授权本轮只修订既有 `solution.md §26.33`、向 `log/2026-11-01.md` 追加记录，并在独立分支提交、推送同一提交到 GitHub/Gitee。该授权不包含 Implementation、Schema/Migration 实际执行、代码/测试修改、数据库连接或破坏性 MySQL Gate，也不签发 Design/Domain Acceptance、Freeze 或 Release Readiness。
> - **修订原因**：R4-5 之后仍存在六项 P0 技术合同缺口（WIP 五动作、隔离生命周期、交期 effect 完整性、转换取消语义、VMI 期间/期初/多账单、MySQL destructive 授权）及六项跨章节冲突（VMI 容差、委外过账调用边界、通知转换 RBAC、API 幂等、会计政策有效期、退货/AP/GL 分层）。
> - **权威修订范围**：§26.33.4–§26.33.15。R4-6 的逐动作矩阵、effect ledger、API 幂等矩阵和分层副作用矩阵若与 R1–R4-5 的概括性文字冲突，以 R4-6 为准；历史审计文字保留，不删除。`M1-D-01..36`、M-01..M-18、`WP-0..WP-8` 和 13 个 Gate 编号全部保留。
> - **Gate 影响**：不新增或删除 Gate，不把任何 Gate 改为 PASS；`execution_status` 仍为 13/13 `NOT_RUN`，`readiness_status` 仍为 9 `NOT_RUN` + 4 `BLOCKED`。R4-6 只补强既有 Gate 的断言与 fail-closed 前置。
> - **政策边界**：12 项开放政策保持不变；A-P01 仍为 `OWNER_RATIFICATION_PENDING`；M1-P-01 仍已闭合。零交期、通知转换取消释放、VMI 部分结算/窗口、C-P03 退货会计处置及非零 VMI 容差均未被本轮批准。

> **R4-6-R1 Bounded Technical Contract Correction（2026-11-01）**
>
> - **授权来源与交付边界**：业务所有者《R4-6-R1 — Bounded Technical Contract Correction》授权本轮只修订**已存在的** `solution.md §26.33` 与向 `log/2026-11-01.md` 追加记录。**不是**重新设计 M1、**不是**重新审计 Requirement、**不是** Implementation、**不是** Acceptance / Freeze / Release Readiness；**未**授权任何 Git 写操作、数据库连接、Migration 执行或 MySQL Gate 运行。
> - **修订原因**：R4-6 之后仍存在三项 P0 设计缺口与两项一致性缺口 —— `P0-02`（WIP 历史隔离与身份级可用量未闭合：数量级可用被当成身份级授权）、`P0-03`（交期 effect 账本只定义了正向回填，缺负向历史回填合同与事件时点矩阵）、`F-04`（M1 Mutation API 幂等矩阵不完整，且 scope 与 canonical 源码不一致）、`P0-06`（"四重 destructive ACK"中第四项无源码实现）、以及 VMI 结算期间 `status` 口径与真实 DDL 不一致。
> - **权威修订范围**：§26.33.4.1（P0-03 时点矩阵与七步回填）、§26.33.4.2（P0-02 身份级模型）、§26.33.5.2（身份层状态机）、§26.33.5.5（Mutation Boundary）、§26.33.6（API 路径与集合对齐）、§26.33.7（M-03 扩展 + M-07d + PA-6/PA-7）、§26.33.8（F-04 完整幂等矩阵）、§26.33.10.1（INV-WIP-7..10）、§26.33.11（错误码）、§26.33.12（Race 子场景 + 四重 ACK）、§26.33.15（T-13/T-14 与一致性登记）。R4-6-R1 的权威文字若与 R1–R4-6 的概括性文字冲突，**以 R4-6-R1 为准**；历史审计文字**保留**，并在被取代处显式标注 **SUPERSEDED / 作废**。
> - **编号边界**：`M1-D-01..36`、`M-01..M-18`（新增**子步** `M-07d`，**不**改 M-07a/b/c 的历史含义）、`WP-0..WP-8` 与 13 个 Gate 的**编号**全部保留；**新增** `RACE-05a / RACE-06a / RACE-10a / RACE-11a` **子编号**（`RACE-01..RACE-11` 的编号与历史含义**全部保留**）；**新增**技术风险 `T-14`。**不新增** Gate、不新增业务政策、不新增业务 Requirement。
> - **Gate 影响**：13 个 Gate 的 `execution_status` 仍为 **13/13 `NOT_RUN`**，`readiness_status` 仍为 **9 `NOT_RUN` + 4 `BLOCKED`**；R4-6-R1 只在现有 Gate 内**补强断言**（§26.33.12 的"R4-6-R1 Gate 断言增量"）。
> - **政策边界**：12 项开放政策**全部**保持不变（`A-P02`、`B-P01`、`B-P02`、`C-P01..C-P04`、`D-P01`、`D-P02`、`M1-P-02`、`M1-P-03`、`M1-P-04`）；`A-P01` 仍为 `OWNER_RATIFICATION_PENDING`；`M1-P-01` 仍已闭合。**零交期路径、通知转换取消容量语义、VMI 部分结算/窗口、C-P03 退货会计处置、非零 VMI 容差**均**未被**本轮批准。
>
> **R4-6-R2 Final Bounded Correction（2026-11-01）**
>
> - **授权来源与交付边界**：业务所有者《R4-6-R2 Final Bounded Correction》授权本轮做**最后一轮有界技术合同勘误**。技术决策由业务所有者与独立审查方**已确定**，本轮**严格执行**，**不重新设计**、不增加额外功能、不重新讨论已确定的边界。授权范围 = **只修订既有 `solution.md §26.33`** + 向 `log/2026-11-01.md` 追加记录。**不是** Implementation / Acceptance / Freeze / Release Readiness；**未**授权 Git 写操作、数据库连接、Migration 执行或 MySQL Gate 运行。
> - **本轮五项修正**：① **P0-02** WIP 身份模型 —— 拆分 `verified_tracked_wip` / `verified_quantity_only_wip` 两种证据、按事件类型定义物理背书（`ID-INDEP-1` 重写）、新增 `outsourcing_wip_identity_effect_allocations` 来源分配表、分离数据库约束与运行时约束、扩展锁序；② **P0-03** 委外成品退货 —— 新增 `outsourcing_finished_return_items`、改为明细级请求结构、退货明细唯一对应原始正向交期 effect；③ **F-04** 幂等矩阵 —— 增加 `Route Status` 列、统一创建类请求期 scope、Alias 共用 operation type / scope / fingerprint、差异 preview 的 CURRENT / TARGET 区分、**29 条 API 记录 / 28 个唯一 operation type / 1 组别名**；④ **Race Mapping** —— RACE-05a 固定唯一错误码、RACE-06a 改为同一 Handler 同一原始 effect、RACE-10a `BLOCKED`、RACE-11a `BLOCKED_UNTIL_HANDLER_REGISTERED`；⑤ **ACK-4** —— 确定完整未来一次性授权合同，**本轮不实现**。
> - **权威修订范围**：§26.33.4.1 / §26.33.4.2 / §26.33.5.2 / §26.33.5.3 / §26.33.5.5 / §26.33.6.1 / §26.33.6.3 / §26.33.8 / §26.33.10.1 / §26.33.11 / §26.33.12 / §26.33.15。R4-6-R2 的权威文字若与 R1–R4-6-R1 的概括性文字冲突，**以 R4-6-R2 为准**；历史文字**保留**，并在被取代处显式标注。
> - **编号边界**：`M1-D-01..36`、`M-01..M-18`（**不新增编号**；`outsourcing_finished_return_items` 作为 **M-03 的扩展**）、`WP-0..WP-8` 与 13 个 Gate 的**编号**全部保留；`RACE-01..RACE-11` 的编号与历史含义**全部保留**（仅保留 R4-6-R1 已新增的四个**子编号**并修正其内容）；`T-01..T-14` 保留（`T-13` / `T-14` 内容更新）。**不新增** Gate、不新增业务政策、不新增业务 Requirement。
> - **Gate 影响**：13 个 Gate 的 `execution_status` 仍为 **13/13 `NOT_RUN`**，`readiness_status` 仍为 **9 `NOT_RUN` + 4 `BLOCKED`**；四个 Race 子场景中 **RACE-10a = `BLOCKED`**、**RACE-11a = `BLOCKED_UNTIL_HANDLER_REGISTERED`**，委外成品退货并发场景**单独** `BLOCKED`。
> - **政策边界**：**12 项开放业务政策全部保持不变**（`A-P02`、`B-P01`、`B-P02`、`C-P01..C-P04`、`D-P01`、`D-P02`、`M1-P-02`、`M1-P-03`、`M1-P-04`）；`C-P03` 仍待裁定；`D-P01` / `D-P02` 仍待裁定；`A-P01` 仍为 `OWNER_RATIFICATION_PENDING`；`M1-P-01` 仍已闭合。**不得**把任何 BLOCKED / NOT_RUN 自动提升为 PASS。
>
> **R2 有界修订（2026-10-31；Design 最终一致性勘误轮，未新增业务政策）**
>
> - **授权来源**：业务所有者本轮指令《M1-D-R2 — Final Integrated Design Consistency Correction》，授权对**已存在的 `solution.md §26.33`** 做最后一次有界设计勘误。**不是**新的 Audit、Requirement 或 Implementation 授权；业务所有者**尚未**批准 M1 Design PASS，也**未**授权任何 Implementation。
> - **范围**：只改写本节内已登记的设计段落。**保留**既有结构、`M1-D-01..26` 决策编号、`WP-0..WP-8` 工作包与 13 个验收 Gate 的编号与状态；**不**重新 Audit、**不**重新 Requirement、**不**重写整个 §26.33。`document.md` 的 R-ACC 登记**不再修改**。
> - **输入依据**：本轮再次逐行复核生产源码 —— `server/lib/inventory-mutation.js`、`server/lib/traceability-quality.js`、`server/lib/stock.js`、`server/modules/financial-inventory.js`、`server/modules/financial-controls.js`、`server/modules/finance-recognition.js`、`server/modules/finance-recognition-policy.js`、`server/modules/commercial-golive.js`、`server/modules/settlement-core.js`、`server/modules/outsourcing.js`、`server/modules/outsourcing-finance.js`、`server/modules/procurement-receiving.js`、`server/modules/procurement-vmi.js`、`server/modules/quality-gates.js`、`server/modules/engineering-bom.js`、`server/modules/roles.js`、`server/database/mysql-schema.js`、`server/database/mysql-adapter.js`、`server/migrations/procurement-outsourcing-schema.js`、`server/migrations/v13-phase6b-traceability-quality.js`、`server/migrations/v13-phase6d-financial-inventory.js`、`server/migrations/v13-phase1-contracts.js`。
> - **本轮纠正十项**：`C-01` 通知来源 Schema 与历史回填；`C-02` Supplier WIP 转移数量守恒；`C-03` VMI 物理与商业恒等式；`C-04` GL 防绕过；`C-05` 幂等键与重复合法业务；`C-06` 严格估值与防重；`C-07` 加工费预留量定义；`C-08` 历史 CONFIRMED 收货兼容；`C-09` RBAC 与职责分离；`C-10` 已批准 Gate 与 Migration 合同。逐项结论见 §26.33.4.7、§26.33.4.2/4.3/4.4、§26.33.5.1、§26.33.7、§26.33.8、§26.33.9、§26.33.10、§26.33.12、§26.33.13、§26.33.14、§26.33.15。
> - **本轮未发生**：未修改任何实现代码、测试、Schema/Migration 文件或配置；未运行 MySQL、浏览器或业务测试；未执行 Git add/commit/push/merge/reset/rebase/tag/release/deploy；未签发任何 Capability 的 `COVERED`、Domain Acceptance、Freeze 或 Release Readiness；13 个 Gate 的编号与状态不变，全部仍 `NOT_RUN` / `BLOCKED`。

#### 26.33.1 Design Scope and Provenance

**目标**：以一次跨能力的技术闭合，把 §31.12 登记的 `G-1..G-5`、`M1-N01/N03/N04/N11` 与 UI/证据 Gap 变成**可通过生产 API 到达**的业务链，同时不新建第二 Owner 引擎、不复制普通采购账务、不虚构历史凭证。

**本 Design 的四个工作流与 Requirement 的对应**（`document.md §31.12.10`）：

| 工作流 | Requirement 锚点 | 本节小节 |
|---|---|---|
| A 收料通知 / 来源转换 / 委外收货明细 / Quality | `§31.12.3` A-REQ-01..06 | §26.33.4.1 / §26.33.5.1 / §26.33.6.1 |
| B 材料发退补 / Supplier WIP / Inventory / LOT-SERIAL / Valuation / Backflush | `§31.12.4` B-REQ-01..06 | §26.33.4.2 / §26.33.5.2 / §26.33.6.2 |
| C Processing Fee Supplier Bill / AP / GL / 期间 / Credit-Reverse | `§31.12.5` C-REQ-01..04 | §26.33.4.3 / §26.33.5.3 / §26.33.6.3 |
| D VMI 消耗汇总 / Owner Change / 结算 | `§31.12.6` D-REQ-01..03 | §26.33.4.4 / §26.33.5.4 / §26.33.6.4 |
| U/T 移动工作面 / 真实端到端与 MySQL 并发 | `§31.12.7` U-REQ-01 / T-REQ-01..03 | §26.33.6.5 / §26.33.12 |

**Domain Owner 边界（承 §31.12.1，不放宽）**：Procurement & Outsourcing 拥有订单、来源/通知、委外单据、材料执行指令、加工费来源与业务证据；Inventory 拥有位置/所有权/LOT-SERIAL/唯一权威物理 Mutation 与估值余额；Quality 拥有 IQC 判定；Finance 拥有 Supplier Bill / AP / 估值调整；Accounting 拥有凭证与期间。本 Design **不**让委外模块直接写 `accounting_vouchers` 之外的第二套账，也**不**新建第二 AP、第二估值账、第二收货引擎。

**技术决策台账（每项标注六要素）**

| ID | 决策 | 依据的已批准 Requirement | 复用的现有实现 | 新增 schema / API 影响 | 迁移/兼容影响 | 需 Owner 批准 |
|---|---|---|---|---|---|---|
| `M1-D-01` | 通知与收货的唯一权威模型 = `receipt_notices` + `receipt_notice_items`，用 `business_type` 判别 | A-REQ-02 / A-P01 | `receipt_notices`(`procurement-outsourcing-schema.js:279-300`)、`receipt_notice_items`(`:302-313`) | 新增 `receipt_notice_item_sources` 表 | 历史行回填为 1:1 item_sources，纯加性 | 否（Design 已裁定） |
| `M1-D-02` | 多 PO 合并用**行级来源表**表达，不用 JSON；**R4-5 更正**：容量由**四重上界**共同约束（通知来源行可转换剩余 / 有效 PO 行剩余 / 已确定绑定的交期与容差剩余 / 委外订单剩余可收量）。存在适用交期时，省略 `deliveryScheduleId` 只能触发“唯一有效交期确定性绑定”或 409，绝不能取消交期检查；一个通知行至多分配到同一 PO 行一次 | A-REQ-03 | `assertRemainingQuantity`(`app.js:4284`) 容量语义 | 新增 `receipt_notice_item_sources`；M-03 增交期归属事实 | 无破坏；历史不可归属时 fail closed | 否（零交期路径待 Owner 裁定） |
| `M1-D-03` | 通知→入库转换走**新增独立 handler + 现有收货引擎的来源字段**，不重写 Purchase Receipt 引擎 | A-REQ-02 / A-REQ-03 | `createPurchaseReceipt`(`app.js:5473`)、`confirmPurchaseReceipt`(`app.js:5554`) | `purchase_receipts.source_notice_id`、`purchase_receipt_items.source_notice_item_source_id` | 加性列，历史行为不变 | 否 |
| `M1-D-04` | **R1-05 更正**：E-06 修正 = 单一 `assertNoticeCapacity` 不变式；比较总量必须**包含**本次待确认通知的数量（现状被 `−thisQty` / `+thisQty` 抵消而**遗漏**），并按 `reservationBase = 通知全量 − 已转换量` 口径避免与已收货量**重复扣减**（§26.33.5.1） | A-REQ-05 | `sumOutsourcingNoticeQty`(`procurement-receiving.js:39`) | `receipt_notice_item_sources.converted_quantity`（M-02） | 行为修正，回归项 | 否 |
| `M1-D-05` | 委外收货**表头+明细原子写入**，明细是生产 Writer | A-REQ-01 | `outsourcing_receipt_items`(`:579-588`) 已存在 | `outsourcing_receipts` 增 `warehouse_id`/`source_notice_id`/`version`；`outsourcing_receipt_items` 增 `lot_id`/`serial_id`/`unit_code`/`processing_po_item_id` | 加性 | 否 |
| `M1-D-06` | “建待检收货”与“确认库存效力”分离为两个动作 | A-REQ-04 | `deriveQualityState`(`quality-gates.js:191`)、`assertQualityGate`(`:231`) | `outsourcing_receipts.business_status` 新值（该列**无 CHECK**，无需重建表） | 状态迁移加性 | 否 |
| `M1-D-07` | 发/退/补料的仓库由 **supplier profile + 物料行绑定**解析，客户端不得指定 | B-REQ-01 | `suppliers.supplier_wip_warehouse_id`(`:265`)、`procurement-profiles.js:99` | 请求体移除 `fromWarehouseId`/`toWarehouseId` | 破坏性**输入**变更，非法输入由 400 拒绝 | 否 |
| `M1-D-08` | 委外材料库存身份 = `ownerType=ENTERPRISE` @ 供应商 WIP 仓 | B-REQ-01 / §31.2 | `applyInventoryMutation`(`inventory-mutation.js:232`)、`computePositionKey`(`inventory-position.js:113`) | 无 | 无 | 否 |
| `M1-D-09` | **R4-6 逐动作合同**：发料/补料/退料才是 `MOVE`，分别产生 OUT+IN 物理腿、同身份严格跟踪腿和 `issueValue+receiveValue` 成对估值；一律 `trackingMode='EXTERNAL'` + `valuationMode='EXTERNAL'`，由调用方显式调用 canonical 跟踪/估值写者 | B-REQ-01 / B-REQ-03 | `postCanonicalTrackedLeg`、`issueValue`/`receiveValue`、`applyInventoryMutation` | 无 | 行为修正（现状委外零 canonical 跟踪/估值闭合） | 否 |
| `M1-D-10` | **R4-6 逐动作合同**：倒冲只对本次正增量产生一条物理 OUT + 一条 OUT 跟踪 + `issueValue`；无 IN 腿、无 `receiveValue`，不得重扣既有累计倒冲；`OUTSOURCING_BACKFLUSH` 必须先注册 | B-REQ-03 | `backflushMaterial` 累计公式 | `SOURCE_TYPES` 注册项 | 数量基数残余见 `M1-P-02` | 否（`M1-P-02` 除外） |
| `M1-D-11` | 倒冲差异方向由**差额符号**导出，客户端不得选择方向 | B-REQ-04 | `outsourcing_period_differences`(`:658-674`) 的 `PREVIEW/ALLOCATED/APPLIED` CHECK | 新增 `outsourcing_difference_approvals` | 加性 | 审核人/权限待 `B-P02` |
| `M1-D-12` | WIP 转移是**订单间归属再分配**：只写 transfer 事实和 `transferred_out/in`，不调用物理 Mutation、`postCanonicalTrackedLeg`、`issueValue` 或 `receiveValue`；五项相容门禁保持。成本携带继续为 `UNVERIFIED_COST`，不得绕过 B-P01 | B-REQ-05 | `outsourcing_wip_transfers`、`createWipTransfer` | 既有加性列不变 | 数量守恒；无物理/估值腿 | 成本算法待 `B-P01` |
| `M1-D-13` | 加工费账单来源合同 = `supplier_bill_items.commercial_source_*` 三元组（已存在） | C-REQ-01 | `supplier_bill_items`(`v13-phase6e-commercial-golive.js:99-110`) | `outsourcing_receipt_items.processing_po_item_id`；写 `source_outsourcing_po_line_id`（列已存在从未写） | 加性 | 否 |
| `M1-D-14` | 加工费过账必须接入期间守卫与 `recognizeFinanceExposure`，但由委外专用 `postOutsourcingProcessingFeeBill` 编排；只复用/扩展无副作用的 source resolver/helper，不调用 canonical `postSupplierBill` 顶层 orchestrator | C-REQ-02 | Finance guards、source resolver、exposure helper | `supplier_bill_items.commercial_source_*` 三元组（已存在） | 行为修正 + helper 有界扩展 | 否 |
| `M1-D-15` | 加工费的 **GL 凭证不在本 Design 内闭合**；给出接入点与角色集占位，标 `POLICY_DECISION_PENDING(C-P01/C-P02)` | C-REQ-03 | `createSystemVoucher`(`financial-inventory.js:172`) | 无 | 无 | **是（C-P01/C-P02）** |
| `M1-D-16` | 委外加工费的 `Dr GRNI / Cr AP` **禁止**照搬普通采购 | C-REQ-03 | — | 无 | 无 | **是（C-P01）** |
| `M1-D-17` | VMI 结算使用期间表、行表与账单分配表；同协议有效窗口禁止重叠；首期期初必须来自 canonical inventory position 的可审计快照，未知即阻断；部分结算/多账单在 D-P01/D-P02 未裁定前保持 BLOCKED | D-REQ-01 | `vmi_*` 四表 | M-09 扩为 periods/lines/bill_allocations 与期初证据列 | 加性；历史未知不写 0 | 是（D-P01/D-P02） |
| `M1-D-18` | 消耗与物权转移**不得对同一批供应商仓位重复扣减**；给出**四个**有界备选模型（**R3 更正**：原"三个"指 D-1 / D-2 / D-3；现按"是否先做 Owner Change"把 D-2 拆为 **D-2a / D-2b**，故为 D-1 / D-2a / D-2b / D-3） | D-REQ-02 | `applyInventoryMutation` 的 `OWNER_CHANGE` 配对语义 | 无 | 无 | **是（D-P01）** |
| `M1-D-19` | VMI 价格来源必须是**权威来源**，客户端不得传金额/账单 ID | D-REQ-02 | `vmi_agreements`(`:376-396`) | `transferVmiOwnership` 请求体移除 `settlementAmountCents`/`supplierBillId` | 输入破坏性变更 | 价格规则待 `D-P02` |
| `M1-D-20` | VMI 账单走 canonical `supplier_bill_items.commercial_source_*`，新增 `'VMI_SETTLEMENT_LINE'` 字面量 | D-REQ-02 | `createSupplierBill`(`commercial-golive.js:276`) | 新字面量 + 写三元组 | 加性 | 否 |
| `M1-D-21` | 前端统一改为 `api(path, { method, body })`；**不**扩展 `api` 对象 | U-REQ-01 | `src/api.js:21` | 2 个页面 10 处调用点 | 纯前端调用修正 | 否 |
| `M1-D-22` | MySQL 并发证据必须**直接调用真实 Domain Handler**，并使用 worker 多连接模式 | T-REQ-02 | `server/mysql-inventory-domain-concurrency.integration.js:18-58` | 新增 suite 文件并注册进 gate suites 数组 | 仅测试资产 | 否 |
| `M1-D-23` | **来源类型注册表扩展（R1-03）**：`SOURCE_TYPES`（`inventory-mutation.js:47-61`）新增 `OUTSOURCING_SUPPLEMENT` / `OUTSOURCING_BACKFLUSH` / `OUTSOURCING_FINISHED_RETURN` 三个字面量。**注册前** `applyInventoryMutation` 对这三条路径一律 `400 sourceType 不合法`，不得假定现有接口已支持 | B-REQ-01 / B-REQ-03 | `SOURCE_TYPES`(`inventory-mutation.js:47-61`) | 代码级集合扩展（**无** schema 变更） | 纯加性；既有 37 个字面量一个不改；无 migration、无 SQLite/MySQL 差异 | 否 |
| `M1-D-24` | **委外严格跟踪写者合同（R1-01；R3 补齐身份键与 `source_item_id` 非空要求）**：每条物理腿在同一外层事务内由调用方**显式**调用 `postCanonicalTrackedLeg`，并满足「来源占用 + 幂等 + 回滚」三要件（§26.33.4.6.1） | B-REQ-01 / B-REQ-02 / OUT-15 | `postCanonicalTrackedLeg`(`traceability-quality.js:247-275`)、**新索引 `uq_tracked_outsourcing_identity`（M-15）**；旧 `uq_tracked_post`(`v13-phase6b-traceability-quality.js:112`) 已降级为附加约束 | 无 | 新增写者调用；现状委外**零**跟踪写入 | 否 |
| `M1-D-25` | **委外估值写者合同（R1-02）**：每条物理腿在同一外层事务内由调用方**显式**调用 `issueValue`/`receiveValue`（位置口径），并满足「数量/价值对账 + Movement/Balance 双写 + 回滚 + 重放」四要件（§26.33.4.6.2）。**禁止**任何只写物理库存、不写相应估值余额而宣称成本闭合的方案 | B-REQ-03 / B-REQ-05 | `issueValue`/`receiveValue`(`financial-inventory.js:97-114`)、`writeMovement`(`:78-93`)、`consignment.js:216-233` | 无 | 禁止裸写 `inventory_valuation_movements`；禁止跨仓全局平均价 | 否 |
| `M1-D-26` | **Planning handoff 现状裁定（R1-04）**：生产源码**已**具备 authoritative exactly-once 消费路径 `consumePlanningHandoff`（`outsourcing.js:98-137`，含行锁、`PENDING` 状态守卫、`planning_handoff_id` UNIQUE 守卫与 UNIQUE 冲突兜底）。`M1-F-05` 改判为「历史验收与当前源码的时序差」，剩余缺口**只有**运行时证据与 MySQL 并发证据 | D-REQ-03 / §31.11 UAT-15 | `consumePlanningHandoff`(`outsourcing.js:98-137`)、`v14-out-procurement-final-acceptance.js` | 无 | 无（仅更正事实陈述） | 否 |
| `M1-D-27` | **C-01 通知来源唯一模型**：`receipt_notice_item_sources` 只登记**已解析**来源（`purchase_order_item_id` 保持 **NOT NULL**，每行必是一条真实 PO 行）；历史未知来源另登记到**新表** `receipt_notice_item_unresolved_sources`。未解析通知行**禁止业务转换**（409），**不得编造 PO 关联**（§26.33.4.7.1）；**R4-06 更正**：`RESOLVED` 必须伴随**实际已解析来源行**且其分配量之和与原未解析量**精确对账**，空集合或数量不对账一律 fail closed | A-REQ-03 | `receipt_notice_item_sources`（本 Design 新增）、`receipt_notice_items.purchase_order_item_id`（可空） | 新表 `receipt_notice_item_unresolved_sources` | 加性；M-12 回填按"已解析/未解析"分流，**不改写历史行** | 否 |
| `M1-D-28` | **C-02 WIP 转移有符号量（R4-5 权威版）**：`supplier_wip_i = issued + supplemented − returned − backflushed − transferred_out + transferred_in`；新转移源 −q、目标 +q、总量守恒。历史转移已净值计入 `issued_quantity`，M-07b 不回填 `transferred_out/in`。因事件累计量不能证明为当前余额子集，隔离改为：受任何未验证历史转移影响的行，`legacy_unverified_wip_quantity_i = supplier_wip_i`；未受影响行取 0。**R4-6-R1 更正**：隔离桶改为**残差**；**R4-6-R2 再更正**：残差按**三种数量**定义（`supplier_wip − verified_tracked_wip − verified_quantity_only_wip`）且范围扩展为**全部**无身份证据的历史行；"未受影响行取 0"的口径**作废**（见 §26.33.4.2 的 R4-6-R2 块）。故可用量只能为当前余额或 0，永不超出当前 WIP | B-REQ-05 | `outsourcing_wip_transfers`、`createWipTransfer` | 既有四列不变；M-07c 按受影响集合计算全行隔离；**M-07d 扩展为残差并新增身份层两表** | 加性；受影响行在独立对账前禁止新转出/倒冲；不改写历史 `issued_quantity`；**T-14** 登记历史阻断规模 | 否（业务阻断规模待 Owner 评估） |
| `M1-D-29` | **C-03 VMI 七量恒等式（R3 已统一命名与期初口径；R4-05 更正符号约定）**：物理量（`supplierOnHand` / `enterpriseOnHand` / `supplierConsumedDirect` / `enterpriseConsumed` / `ownerChanged`）与商业量（`commercialReleased` / `settled`）**分离**；`closing_qty` 不再扣减 `ownerChanged`、也不含 `commercialReleased`；`billable = commercialReleased`；调整量按所有权池**分列**、无法归属者进 `unallocated_adjusted_qty` 并阻断关期。**R4-05 裁定**：调整量是**有符号量**（正 = 池增加），`adjusted_*` 与 `unallocated_adjusted_qty` 一律置于恒等式**左端（来源侧）**；关期判据是 `\|unallocated_adjusted_qty\| > 容差`（**正负同等阻断**） | D-REQ-01/02 | `getVmiSummary`(`procurement-vmi.js:229`)、`vmi_settlement_lines`（本 Design 新增） | `vmi_settlement_lines` 列集见 §26.33.4.4（`opening_supplier_qty`/`opening_enterprise_qty`/`received_qty`/`supplier_consumed_qty`/`enterprise_consumed_qty`/`owner_changed_qty`/`returned_qty`/`adjusted_supplier_qty`/`adjusted_enterprise_qty`/`unallocated_adjusted_qty`/`closing_supplier_qty`/`closing_enterprise_qty`/`closing_qty`/`commercial_released_qty`/`settled_qty`） | 加性 | **是（D-P01）** —— 模型未选定前只落地与模型无关的分列口径；**调整量容差另立 `M1-P-04`** |
| `M1-D-30` | **R4-6 source-aware 会计门禁**：委外顶层 orchestrator 必须是 `postOutsourcingProcessingFeeBill`；可复用纯校验、解析、期间守卫和无副作用 helper，但不得调用 `postSupplierBill` 顶层流程。`assertOutsourcingAccountingPolicy` 必须先于 AP/GL 任一副作用；有效政策要求唯一匹配且区间不重叠 | C-REQ-02/03/04 | Finance canonical guards/helpers | M-16 空表 fail-closed；区间重叠双端事务校验 | 不新增政策行或角色集 | **是（C-P01..C-P04）** |
| `M1-D-31` | **C-05 业务事件 ID 体系**：物理腿 `idempotencyKey` 是**五字段 Mutation Key（`SOURCE_TYPE` + 四个区分维度）**：`<SOURCE_TYPE>:<business_event_id>:<business_event_item_id>:<leg_seq>:<identity_key>`；四个区分维度分别隔离业务事件、业务项、物理腿和身份子腿，并保留“非预期重放”硬断言 | B-REQ-01/02 | `applyInventoryMutation` 的 `idempotencyKey`、`idempotencyReplay` | 无 | 加性 | 否 |
| `M1-D-32` | **C-06 严格估值与防重对等**：委外估值腿必须断言返回 Movement `status='POSTED'` 且 `inventory_transactions.valuation_status='VALUED'`，否则 409 并整体回滚（拒绝 `LEGACY_UNVALUED` 回退）；身份占用改用**非空** `identity_key` 列 + 普通 UNIQUE，消除 SQLite「NULL 互异」与 MySQL「生成列摘要」的行为差异（§26.33.4.6.1、§26.33.10.2）。**R4-09 更正**：双端行为只按「重复必拒绝 / 不同必放行 / 谓词外行」三方向**如实**表述 —— "不同必放行"方向在 MySQL 侧依赖 SHA-256 无碰撞假设，**形式上不等价**，删除"语义等价"断言 | B-REQ-03 / T-REQ-02 | `issueValue`(`financial-inventory.js:106-114`)、`writeLegacyMovement`(`:95`)、`uq_tracked_post`(`v13-phase6b-traceability-quality.js:112`)、`generatedPartialIndex`(`mysql-schema.js:138-160`) | `tracked_inventory_movements` 增 `identity_key TEXT NOT NULL DEFAULT ''` + 新 UNIQUE | 加性；**双端"不同必放行"方向形式上不等价**（非"语义等价"） | 否 |
| `M1-D-33` | **C-07 加工费三段式容量（R4-5）**：`GrossEligible`、`ReservedOthers`、`RemainingEligible` 口径不变；`OVER_RESERVED` 为账单行级持久状态并始终留在 active 集合。DRAFT/WAITING_MATCH 超额阻断过账；POSTED 超额派生为历史异常，保留原数量/金额/AP/GL 与审计，绝不自动反向。退货是否允许制造该 POSTED 异常由 C-P03 裁定，裁定前退货预检 fail closed | C-REQ-01/04 | `createProcessingFeeBill`、canonical return/credit/reversal | M-18 四状态字段不变 | 行为修正 + 预留键统一；POSTED 处置政策待决 | 是（C-P03 最终处置） |
| `M1-D-34` | **C-08 历史收货效力判定**：历史 `business_status='CONFIRMED'` **不得**无条件映射为 `EFFECTED`。按可核查证据（Inventory 流水 / Valuation 流水 / Quality 判定 / 成本证据 / 来源明细）判定为 `EFFECTED_CONFIRMED` 或 `LEGACY_UNVERIFIED`；后者**不开放**新的账单与退货能力，且**不改写**历史记录（§26.33.5.1） | A-REQ-01/04 / C-REQ-01/04 | `outsourcing_receipts.business_status`(`procurement-outsourcing-schema.js:565`)、`createOutsourcingReceipt`(`outsourcing.js:344-359`)、`confirmOutsourcingReceipt`(`outsourcing-finance.js:76`) | 无（读模型派生字段） | 读时派生，**不写回**；历史修复属独立授权 | 否 |
| `M1-D-35` | **C-09 委外业务与应付权限分离**保持；R4-6 另明确通知创建/确认/取消/转换统一使用已注册的 `RECEIPT_NOTICE_MANAGE`，查看使用 `RECEIPT_NOTICE_VIEW\|RECEIPT_NOTICE_MANAGE`，转换再叠加目标侧管理权限。未注册的 `PROCUREMENT_NOTICE_CONVERT` 字面量作废，不得进入 `allowAny` | C-REQ-01/02、A-REQ-02/03 | `PERMISSIONS`、`procurement-receiving.js`、desired-set/admin 规则 | 仅 `SUPPLIER_BILL_MANAGE` 仍需 M-17 注册；通知转换不新增权限码 | fail-closed RBAC | **是（加工费角色授予矩阵待 Owner 确认）** |
| `M1-D-36` | **C-10 已批准义务与回填修正（R4-07/R4-08 更正迁移合同）**：`document.md §31.12.6`（D-REQ-03）**已获 Requirement PASS**，UAT-14 旧 oracle 的纠正是**已批准的 Requirement 义务**，只在 Implementation 执行，不再作为业务政策待决；M-13 回填由 `INSERT` 改为**只更新目标列且仅在目标列为 NULL 时**的 `UPDATE`（§26.33.7、§26.33.12）。**R4-07**：M-12a / M-12b **逐列**给出取值来源，`converted_quantity` 对遗留行写 **NULL（未证明）**，不得写 0 冒充"已证明未转换"。**R4-08**：M-15 的执行顺序改为 PRE-A → 加列 → 回填 → PRE-B/PRE-C → 建索引，并规定 MySQL DDL 自动提交下的**重试语义**与 feature gate 前置 | D-REQ-03 / T-REQ-02 | `document.md §31.12.6`、M-13 | 无 | 回填语句修正为幂等 `UPDATE`；`uq_tracked_post` 的 oracle 纠正归 WP-6 | 否 |

#### 26.33.2 Historical §26 Reconciliation

`document.md §31.12.3` A-REQ-06 明确指出 `solution.md §26.12` 与 `§26.20` 存在**物理模型设计冲突**，要求本 Design 提出**唯一权威模型**。核对结果：冲突客观存在，且 §26.20 自身也不自洽。以下为逐条裁定。**本表是 §26 与 §26.33 之间唯一的解释入口；凡与本表冲突的旧措辞，以本表为准。**

| 历史条目 | 原文事实 | 冲突判定 | **§26.33 裁定（唯一权威）** | 旧条目处置 |
|---|---|---|---|---|
| `§26.12`（`:2850`） | “新 `outsourcing_completion_notices` 走独立表（参见 §26.20），避免与 Purchase Receipt 共用同一 `receipt_notices`” | 与 §26.20 冲突 | **不采纳独立表。** 唯一权威通知模型 = `receipt_notices` + `receipt_notice_items`，由 `receipt_notices.business_type ∈ ('STANDARD_PURCHASE','OUTSOURCE')` 判别（CHECK 已存在于 `:283`）；`outsourcing_order_id` / `processing_po_id` 已在 `v14-out-procurement-final-acceptance.js:68-69` 以加性列落地 | **SUPERSEDED** by `M1-D-01` |
| `§26.12`（`:2849`） | `receipt_notice_items(..., po_line_id, schedule_id NULL, product_id, planned_quantity_num/den, source_trace_json)` | 列名与现实不符：`po_line_id` / `schedule_id` / `source_trace_json` **均不存在**；真实列名是 `purchase_order_item_id`，数量是 `quantity REAL` | 真实列名以 `:302-313` 为准；`schedule_id` 由 `M1-D-02` 的 `receipt_notice_item_sources.delivery_schedule_id` 承载；`source_trace_json` 由同一表的 `source_trace_json` 承载（**行级、结构化、可查询**，不以 JSON 替代关系） | **SUPERSEDED**（结构保留、载体改写） |
| `§26.12`（`:2856`） | “Receipt Notice 可被 Purchase Receipt 引用作为 source（`purchase_receipts.source_notice_id` additive）” | 无冲突，且**现实中该列不存在** | 采纳：`purchase_receipts.source_notice_id` 与 `purchase_receipt_items.source_notice_item_source_id` 以加性列落地 | **CONFIRMED → 实现** |
| `§26.12`（`:2869-2872`） | Purchase Receipt 强制 `business_type='STANDARD_PURCHASE'`，否则 409 `PURCHASE_RECEIPT_REQUIRES_STANDARD_PURCHASE` | 无冲突（`purchase_orders.business_type` 已在 `:270` 存在） | 采纳，但把断言点从 `createPurchaseReceipt` 入口**下移到确认前的库存写之前**，并统一错误码常量 | **CONFIRMED → 实现** |
| `§26.18`（`:3069-3114`） | `OUTSOURCE_PROCESSING` PO 语义隔离矩阵 | 无冲突 | 全文保留；本 Design 只补充 `receipt_notices.business_type='OUTSOURCE'` ↔ `purchase_orders.business_type='OUTSOURCE_PROCESSING'` 的**显式映射表**（§26.33.4.1） | **RETAINED** |
| `§26.19`（`:3118-3134`） | 表结构写作 `outsourcing_material_issues` / `_issue_items` / `_supplements` / `_returns` / `outsourcing_material_positions`；并称 `outsourcing-materials.js::confirmMaterialIssue` | **与现实全部不符**：这五张表**不存在**；`server/modules/outsourcing-materials.js` **不存在**；真实表是 `outsourcing_issues` / `outsourcing_supplements` / `outsourcing_returns` / `outsourcing_material_list`（`:485-555`）；真实 handler 是 `issueMaterial`(`outsourcing.js:242`)，**无 DRAFT/confirm 分离、立即生效** | **不新建影子表。** 沿用真实表并**加性扩展**；设计语义（来源可追溯、数量守恒、LOT/SERIAL、复用 canonical Writer）由 `M1-D-07..12` 承载。`outsourcing_material_positions` **不建表也不建 view** —— 位置视图由 `getMaterialPosition`(`outsourcing.js:361`) 与 `procurement-reports.js:87-114` 以**派生读模型**提供 | **SUPERSEDED**（表名与模块名作废，语义保留） |
| `§26.20`（`:3310-3311`） | Tables 列出 `outsourcing_completion_notices` / `_items` | 与同节 `:3325`“复用 Receipt Notice infrastructure”自相矛盾 | 采用 `:3325` 的复用语义，删除独立表条目（§26.33.4.1） | **SUPERSEDED（Tables 块）** |
| `§26.20`（`:3313-3314`） | `outsourcing_receipts(..., source_notice_id, completion_inspection_id, ..., version)`；`outsourcing_receipt_items(id, receipt_id, product_id, lot_id, serial_id, quantity_num, quantity_den, line_no)` | 现实列名/类型不符：`outsourcing_receipts` 无 `source_notice_id`/`completion_inspection_id`/`version`/`warehouse_id`；`outsourcing_receipt_items` 无 `lot_id`/`serial_id`/`quantity_num`/`quantity_den` | 采纳为**加性列目标形态**；数量列**保持 `REAL`**（与 `outsourcing_material_list` 一致），并新增 `unit_code` 与**非零分母的 UOM 一致性断言**替代 num/den | **SUPERSEDED → 加性迁移目标** |
| `§26.20`（`:3337-3348`） | `confirmOutsourcingReceipt` 原子 10 步（含 backflush、`receiveValue(value_cents=0)`、状态机、成本证据） | 与现实不符：现实实现写死 `warehouse-001`，用 legacy `adjustInventory`，用**跨仓全局平均价**算材料成本，且**不发凭证** | 采纳为**目标语义**，并按 `M1-D-06/D-09/D-10` 拆成“建待检收货 / 生效”两段；材料价值改由 `issueValue` 的 canonical 池分摊得出，**禁止全局平均价** | **SUPERSEDED → 目标语义 + 阻塞标记** |
| `§26.20`（`:3350-3369`） | Supplier Bill 行级来源身份 = `commercial_source_type/id/item_id` 三元组 | 与现实一致（`db.js:577-579` 已存在该三列） | **保留并成为 C 组唯一来源合同**（`M1-D-13`）；`UNIQUE(receipt_item_id)` 等禁止项一并保留 | **RETAINED** |
| `§26.32`（`:3942-3958`） | 三项 Design-to-Implementation gap + `NOT READY` | 与 §31.12 一致 | gap 2（完成通知 executable contract）由 `M1-D-01/D-03/D-05` 闭合；gap 3（Quality `OUTSOURCING_RECEIPT` contract）**已在上轮实现**（`authoritative-quality.js:256`），由 `M1-D-06` 补齐其**门禁时点**；gap 1（Planning handoff exactly-once）**已由 `4e035c5`(2026-10-09 19:31) 在生产源码中闭合**，本 Design 把它从「未闭合缺陷」改判为「**缺运行时与 MySQL 并发证据**」，见 `M1-F-05` 与 `M1-D-26` | **PARTIALLY SUPERSEDED** |

#### 26.33.3 Component and Owner Map

| 组件 | 规范 Owner（模块 / 表） | 本 Design 是否新建 | 复用/被复用关系 |
|---|---|---|---|
| 收料通知 | `server/modules/procurement-receiving.js` + `receipt_notices`/`receipt_notice_items` | 否（新增 `receipt_notice_item_sources` 关联表） | 被 A 组转换、采购入库来源引用 |
| 通知→入库转换 | **新建** `server/modules/procurement-notice-conversion.js`（owner 唯一） | **是** | 调用 `purchase_receipts` 既有写入路径 |
| 采购入库引擎 | `server/app.js:5473-5619`（`createPurchaseReceipt`/`confirmPurchaseReceipt`） | 否 | 被转换流程**调用**，不重写 |
| 委外收货 | `server/modules/outsourcing.js`（创建）+ `server/modules/outsourcing-finance.js`（生效） | 否（加列） | 明细写入在 `outsourcing.js`；库存/成本/证据在 `outsourcing-finance.js` |
| IQC | `server/modules/quality-gates.js` + `server/modules/authoritative-quality.js` | 否 | 消费 `outsourcing_receipt_items` |
| 物理库存 | `server/lib/inventory-mutation.js::applyInventoryMutation` | 否 | **唯一权威物理写**；委外全部经由它 |
| 库存位置身份 | `server/lib/inventory-position.js::computePositionKey`（8 维 SHA-256） | 否 | owner/warehouse/lot/serial 进入 `position_key` |
| 估值 | `server/modules/financial-inventory.js`（`issueValue`/`receiveValue`/`issueSourceValue`/`receiveSourceValue`） | 否 | **唯一权威估值账**；委外不得自建 |
| 委外材料执行 | `server/modules/outsourcing.js`（`issueMaterial`/`supplementMaterial`/`returnMaterial`/`backflushMaterial`） | 否（改写实现，不改 owner） | 复用 canonical 库存/估值 Writer |
| 委外财务 | `server/modules/outsourcing-finance.js` | 否 | 复用 `commercial-golive.js` 的 Supplier Bill/贷项 |
| Supplier Bill / AP | `server/modules/commercial-golive.js` + `server/modules/settlement-core.js` | 否 | 委外加工费**不建第二应付引擎** |
| 会计凭证 | `server/modules/financial-inventory.js::createSystemVoucher` + Accounting | 否 | 委外凭证**尚未闭合**（`M1-D-15`） |
| VMI | `server/modules/procurement-vmi.js` + `vmi_*` 四表 | 否（新增结算期间/行表） | 物理经 `applyInventoryMutation` |
| 移动工作面 | `src/pages/outsourcing.jsx`、`src/pages/sourcing-pricing.jsx` | 否（仅修调用约定） | 复用 `src/api.js` 的 `api(path, options)` |
| 端到端验收 | `scripts/acceptance/procurement-outsourcing-functional-uat.mjs` | 否（扩充 Gate） | 与 `document.md §31.12.9` 13 Gate 对齐 |
| MySQL 并发 | **新建** `server/mysql-procurement-outsourcing-domain-concurrency.integration.js` | **是** | 注册进 `scripts/gates/mysql-concurrency-gate.mjs` |

#### 26.33.4 Source and Data Model

##### 26.33.4.1 A 组：通知、来源与收货

**唯一权威通知模型（M1-D-01）**：`receipt_notices`（头，`business_type` 判别）+ `receipt_notice_items`（行）+ **`receipt_notice_item_sources`（行级来源，本 Design 新增）**。

```text
receipt_notices                    (现存，:279-300，不改)
  id, notice_no UNIQUE, purchase_order_id TEXT NULL,        -- 兼容字段，见下
  business_type TEXT CHECK IN ('STANDARD_PURCHASE','OUTSOURCE') DEFAULT 'STANDARD_PURCHASE',
  supplier_id, warehouse_id, notice_date, status TEXT DEFAULT 'DRAFT'  -- 无 CHECK
  handler_id, remark, idempotency_key TEXT UNIQUE, creator_id, created_at, updated_at
  + outsourcing_order_id TEXT, processing_po_id TEXT          -- v14 已加

receipt_notice_items               (现存，:302-313，不改)
  id, notice_id FK, purchase_order_item_id TEXT NULL,
  product_id FK, quantity REAL NOT NULL, line_no INTEGER NOT NULL
  + outsourcing_order_id TEXT                                   -- v14 已加

receipt_notice_item_sources        (本次新增；行级多 PO 来源关系 —— 本小节是本表的 DDL 唯一权威)
  id TEXT PRIMARY KEY,
  notice_item_id TEXT NOT NULL REFERENCES receipt_notice_items(id),
  purchase_order_item_id TEXT NOT NULL REFERENCES purchase_order_items(id),
  delivery_schedule_id TEXT NULL,                -- 引用 purchase_order_delivery_schedules(id)
  allocated_quantity REAL NOT NULL,              -- 本行分配给该 PO 行的数量
  converted_quantity REAL NULL,                  -- 已转换到采购入库的累计量
                                                  -- R4-07：**NULL = 转换量"未证明"**（遗留行），
                                                  --       非 NULL = 已证明的累计转换量（含已证明的 0）
  source_trace_json TEXT NOT NULL DEFAULT '{}',  -- 结构化来源 trace（非 JSON 关系的替代）
  business_date TEXT NOT NULL,
  created_at, updated_at
  UNIQUE(notice_item_id, purchase_order_item_id)
```

**R4-07：`converted_quantity` 改为可空的理由（R3 的 `NOT NULL DEFAULT 0` 已被本轮取代）**

R3 把 `converted_quantity` 定为 `REAL NOT NULL DEFAULT 0`。但 M-12a 的遗留回填**无法证明**遗留通知行有多少数量已经被转换过：`purchase_receipt_items` 在 M-03 之前**没有** `source_notice_item_source_id` 列，历史收货与历史通知之间**没有任何可证明的归属关系**（且"无通知直接 PO→入库"是合法的既有路径）。写 `0` 等于断言"已证明没有转换"，属于**编造事实**，违反 AGENTS.md §13 与本 Design 的"不可推定来源"原则。

⇒ **裁定（R4-5）**：`converted_quantity` 为**可空**；`NULL` 表示“历史转换量未证明”，非 `NULL` 表示“已证明的累计转换量”（已证明为零时写 `0`）。`COALESCE(converted_quantity, 0)` **只允许**用于订单级保守预留估计，使未知行继续按全额占用预留；来源行的正向转换授权**禁止 COALESCE**，遇 NULL 必须 409 `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN`。M-12a 对遗留行继续写 `NULL`。

| `converted_quantity` | 证据含义 | 正向转换授权 |
|---|---|---|
| `NULL` | 历史累计转换量未知 | 否；409 `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN` |
| `0` | 已证明未转换 | 是；仍受其它三重容量限制 |
| `0 < value < allocated_quantity` | 已证明部分转换 | 是；只允许剩余量 |
| `value = allocated_quantity` | 已全部转换 | 否；409 `RECEIPT_NOTICE_SOURCE_EXHAUSTED` |
| `value < 0`、非有限数、`value > allocated_quantity` | 数据不变量破坏 | 拒绝并报告，不得截断或自动修复 |

**列分类（R3 明确；"全部列 NOT NULL" 的旧表述已作废）**

| 类别 | 列 | 理由 |
|---|---|---|
| **必填（NOT NULL）** | `id`、`notice_item_id`、`purchase_order_item_id`、`allocated_quantity`、`source_trace_json`、`business_date`、`created_at`、`updated_at` | 每一行都是一条**已解析**的来源事实，缺一即语义不成立 |
| **唯一键字段（NOT NULL，参与 UNIQUE）** | `notice_item_id`、`purchase_order_item_id` | 二者皆非空 ⇒ `UNIQUE(notice_item_id, purchase_order_item_id)` 在 SQLite 与 MySQL 上**行为完全一致**（不依赖 NULL 互异语义） |
| **可空（R4-07 新增）** | `converted_quantity` | `NULL` = 转换量**未证明**（遗留行）；非 `NULL` = 已证明的累计转换量。理由见上方"R4-07 理由"段 |
| **可选（允许 NULL）** | `delivery_schedule_id` | 通知行**不一定**绑定某一条交期；引用 `purchase_order_delivery_schedules(id)`，该表存在于 `procurement-outsourcing-schema.js:315-331` |

**为什么不用 `purchase_orders.business_type` 决定通知类型**：`receipt_notices.business_type` 是**通知单自身**的判别（CHECK 约束存在且已被 `createReceiptNotice` 写入与校验，`procurement-receiving.js:111-114`），`purchase_orders.business_type` 是**采购订单**的判别（`procurement-orders.js:11` 的 `BUSINESS_TYPES` 集合）。两者是不同值空间，不得混用。映射表：

| 通知 `business_type` | 允许的 PO `business_type` | 转换目标 | 来源判定 |
|---|---|---|---|
| `STANDARD_PURCHASE` | `STANDARD_PURCHASE` | `purchase_receipts`（普通采购入库） | `receipt_notice_item_sources.purchase_order_item_id` |
| `OUTSOURCE` | `OUTSOURCE_PROCESSING` | `outsourcing_receipts`（委外完工收货） | `outsourcing_receipts.processing_po_id` + `outsourcing_order_id` |
| `STANDARD_PURCHASE` | `OUTSOURCE_PROCESSING` | — | **409 拒绝**（`RECEIPT_NOTICE_PO_TYPE_MISMATCH`） |
| `OUTSOURCE` | `STANDARD_PURCHASE` | — | **409 拒绝**（同上） |

**既有 `purchase_order_id` 头字段的处置**（历史兼容）：`receipt_notices.purchase_order_id` 现为单值 FK，**无法**表达多 PO。设计将其降级为**兼容派生字段**：
- 新写入：多 PO 通知时写入**首个**来源 PO（仅供旧读模型与 `idx_receipt_notices_order` 使用）；
- 权威关系：`receipt_notice_item_sources`；
- 历史回填（**R3 已统一；R2 的「NULL 占位来源行」方案作废**）：分两路，**均不删除、不改写任何历史行**：
  - `receipt_notice_items.purchase_order_item_id IS NOT NULL` 的行 → **恰好 1 条** `receipt_notice_item_sources`（`purchase_order_item_id` 取该值，`allocated_quantity` 取 `receipt_notice_items.quantity`）—— 无损 1:1 加性回填（M-12a）；
  - `receipt_notice_items.purchase_order_item_id IS NULL` 的行 → **恰好 1 条** `receipt_notice_item_unresolved_sources`（`quantity = receipt_notice_items.quantity`），**不写入** `receipt_notice_item_sources`，**不推定任何 PO 关联**（M-12b）。
  - **`receipt_notice_item_sources.purchase_order_item_id` 在任何路径下都不写 NULL**（该列 NOT NULL，见本小节 DDL）。未解析登记的权威 DDL 与转换阻断规则见 **§26.33.4.7.1**。

**R4-11：多 PO 与交期容量的四重上界（本小节是来源行级容量口径的唯一权威）**

R3 只定义了通知行口径（`§26.33.5.1` 的 `reservationBase`），**未**定义 PO 行剩余、交期/容差剩余与供应商/仓库相容。`document.md §31.12.3` 的 **A-REQ-03** 明文要求"累计转换/已确认数量不得超过通知行、有效订单行、**交期/容差**和委外订单剩余可收量"。R4 逐项补齐如下。

**(1) 容量上界**

| 上界 | 定义 | 权威来源 | 适用 |
|---|---|---|---|
| `noticeLineAllocated` | `Σ allocated_quantity`（该通知行**已分配**给各来源行的量之和） | `receipt_notice_item_sources` | 每个通知行 |
| `sourceRowRemaining` | 仅当 `converted_quantity(s) IS NOT NULL` 才定义为 `allocated_quantity(s) − converted_quantity(s)`；NULL 时容量不可证并 409 | `receipt_notice_item_sources` | 每个来源行 |
| `poLineRemaining` | `purchase_order_items.quantity − Σ 已确认 purchase_receipt_items.quantity`（同 `purchase_order_item_id`） | canonical `assertRemainingQuantity`(`app.js:4284-4289`) 的同一口径 | 每个 PO 行 |
| `scheduleRemaining` | `planned_quantity × (1 + upper_tolerance_pct/100) − consumed` | `purchase_order_delivery_schedules`（`procurement-outsourcing-schema.js:315-331`） | 每个**已绑定**交期的来源行 |
| `orderRemaining`（委外） | `outsourcing_orders.order_quantity − Σ outsourcing_receipts.quantity`（`business_status<>'CANCELLED'`） | §26.33.5.1 的 `open_qty` | `business_type='OUTSOURCE'` 的通知 |

```text
convertible(s, q) 要求**同时**满足：
  q ≤ sourceRowRemaining(s)                -- 通知行分配剩余
  q ≤ poLineRemaining(poItem(s))           -- 有效订单行剩余
  q ≤ scheduleRemaining(resolvedSchedule(s)) -- 存在适用交期时必检；参数省略不能取消检查
  q ≤ orderRemaining(order)                -- 委外订单剩余可收量（OUTSOURCE 通知）
任一不满足 → 409（错误码见 §26.33.11）
```

**(2) 交期消费量的唯一权威口径（R4-5 取代 R4-11 的 `received_quantity` 分支）**

已核对源码：`purchase_order_delivery_schedules.received_quantity` **只被读取**（`procurement-orders.js:40` 的 `rowToSchedule`）并**初始化为 0**（`procurement-orders.js:139-140`），**全仓库无任何写入**；收货路径也**从不**校验交期（`app.js` 只登记了 `createDeliverySchedule` / `listDeliverySchedules` 两个路由）。⇒ **`received_quantity` 不是可用的权威容量来源。**

```text
consumed(schedule s)
  = Σ schedule_consumption_effects.signed_quantity
      WHERE delivery_schedule_id = s.id AND effect_state = 'EFFECTIVE'

schedule_consumption_effects 是交期消费的 canonical、可追溯事实：
  · 普通 PO 直接收货、通知转采购入库、通知转委外收货都必须在同一事务内写入；
  · 每个正向 effect 唯一绑定 purchase_receipt_item / outsourcing_receipt_item 与 delivery_schedule_id；
  · 取消、退货、冲销写独立负向 effect，引用原 effect；不得 UPDATE/覆盖历史正向事实；
  · R4-6：不得使用 `UNIQUE(source_type, source_item_id, effect_kind)` 作为唯一防重；它会阻止同一收货行多次合法部分退货。唯一性改为“业务反向事件 + 原正向 effect”的组合键，见下方 DDL；
  · purchase_order_delivery_schedules.received_quantity 仅可作为由该账本派生的兼容投影，不能参与容量授权。
```

**R4-6：交期 effect ledger 的物理合同、历史回填与反向上限（P0-03）**

```text
schedule_consumption_effects
  id TEXT PRIMARY KEY,
  purchase_order_item_id TEXT NOT NULL,
  delivery_schedule_id TEXT NOT NULL,
  source_type TEXT NOT NULL,              -- PURCHASE_RECEIPT_ITEM / OUTSOURCING_RECEIPT_ITEM / LEGACY_BACKFILL
  source_item_id TEXT NOT NULL,           -- 正向来源业务行
  business_event_type TEXT NOT NULL,      -- RECEIPT / RETURN / CANCEL / REVERSAL / LEGACY_BACKFILL
  business_event_id TEXT NOT NULL,        -- 每次独立反向事件的稳定 ID
  business_event_item_id TEXT NOT NULL,   -- 反向业务行；正向时等于 source_item_id
  signed_quantity REAL NOT NULL,          -- 正向 >0，反向 <0，禁止 0/非有限
  reverses_effect_id TEXT NULL,            -- 反向必填，引用原正向 effect；正向必须 NULL
  reverses_effect_key TEXT NOT NULL,       -- 正向固定 ''；反向固定原 effect id，规避 NULL UNIQUE 差异
  effect_state TEXT NOT NULL DEFAULT 'EFFECTIVE',
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(idempotency_key),
  UNIQUE(business_event_type, business_event_id, business_event_item_id, reverses_effect_key)
```

- 正向 effect 对每个真实收货明细恰好一条；原正向行永不 UPDATE。反向 effect 必须引用 `effect_state='EFFECTIVE'` 的正向行，并在锁内证明同 `purchase_order_item_id`、同 `delivery_schedule_id`。
- `reversible_remaining(original) = original.signed_quantity + Σ effective negative effects referencing original`；反向数量 `r` 必须满足 `0 < r <= reversible_remaining`。对原 effect 行和已有反向行加锁后重读，再写新负向行；多次部分退货用不同 `business_event_id/business_event_item_id`，合法共存，累计绝不超过原数量。
- 同一外部 `Idempotency-Key` + 相同 fingerprint 返回首次结果；同键不同 fingerprint 409；不同 key 对同一业务事件由第二个、全部 NOT NULL 的 UNIQUE 拒绝。`reverses_effect_id` 仍保留真实 FK 语义，`reverses_effect_key` 只为跨端确定性唯一键，禁止客户端提供。容量检查、业务收货/退货写入、正/负 effect 与审计在同一事务。
- **M-03 历史回填**：历史已确认收货若其 PO 行在收货业务日只有一条有效交期，且收货行可唯一关联该 PO 行，则以确定性 `id='M03-SCHEDULE-' || source_type || '-' || source_item_id`、稳定 business event/fingerprint 幂等插入正向 `LEGACY_BACKFILL` effect；不改历史收货数量、状态或时间。多交期、零交期、PO 行不可解析或已有冲突 effect 时不猜测，登记 `LEGACY_SCHEDULE_UNPROVEN` 并使该 PO 行容量授权返回 `RECEIPT_NOTICE_SCHEDULE_CAPACITY_UNKNOWN`。
- **迁移兼容**：M-03 首次执行时建表/列/索引后按确定性选择回填；已经执行过旧版 M-03 的数据库，通过存在性检查加缺失列/索引，再仅对“账本尚无该来源正向 effect”的历史行补写。SQLite/MySQL 使用相同排序、相同确定性 ID/fingerprint 与相同不确定分支；运行时刻不进入业务事实或 parity 比较。

**R4-6-R1：正负 effect 的事件时点矩阵（P0-03 权威合同）**

> **R4-6-R1 授权来源**：业务所有者《R4-6-R1 — Bounded Technical Contract Correction》授权本轮消除 P0-03 缺口。**本矩阵是 §26.33.4.1 交期 effect 账本的时点权威**；与 R4-6 的概括性文字冲突时以本矩阵为准。判定依据是**真实 Handler 与状态机**（逐行核对生产源码），**不得**凭接口名称推断生效时间。

**核对到的源码事实（逐行，非推断）**

| 事实 | 源码位置 | 含义 |
|---|---|---|
| `createReceiptNotice` 写 `status='DRAFT'` | `server/modules/procurement-receiving.js:107-185` | 通知创建**不产生**任何库存效力 |
| `confirmReceiptNotice` 只改 `status='CONFIRMED'` | `procurement-receiving.js:186-211`（事务内只有 UPDATE + audit） | 通知确认**不产生**任何库存效力 |
| `cancelReceiptNotice` 只允许 `status='DRAFT'` | `procurement-receiving.js:213-224` | 未生效通知取消 ⇒ **不存在**正向事实 ⇒ **不产生**负向 effect |
| `createPurchaseReceipt` 写 `status='DRAFT'` | `server/app.js:5473` | 收货草稿**不产生**库存效力 |
| `confirmPurchaseReceipt` 的 `action='confirm'` 在**同一事务内**执行 `postTrackedMovement` + `adjustInventory` + `inventory_transactions` + `receiveSourceValue`，随后 `status='CONFIRMED'` | `server/app.js:5554-5610` | **正向 effect 的唯一生效时点** |
| `confirmPurchaseReceipt` 的 `action='cancel'` 要求 `status==='DRAFT'` | `server/app.js:5611-5614` | 未生效收货取消 ⇒ **不产生**负向 effect |
| `confirmPurchaseReturn` 的 `action='confirm'` 在**同一事务内**执行 `postTrackedMovement`(OUT) + `adjustInventory(-q)` + `inventory_transactions` + `issueSourceValue`，随后 `status='CONFIRMED'` | `server/app.js:6199-6270` | **负向 effect 的唯一生效时点**（实物退货真正产生库存反向流水的事务） |
| `confirmOutsourcingReceipt` 在**同一事务内**执行倒冲 + `inventory_transactions`(IN) + `adjustInventory`，随后 `business_status='EFFECTED'` | `server/modules/outsourcing-finance.js:76-150` | 委外收货的正向 effect 生效时点 |
| `createFinishedReturn` 在**同一事务内**写 `outsourcing_finished_returns`(CONFIRMED) + `inventory_transactions`(OUT) + `adjustInventory(-q)` | `outsourcing-finance.js:249-326` | 委外成品退货的负向 effect 生效时点 |
| `createOutsourcingReceipt` 直接写 `business_status='CONFIRMED'` 且**不写明细** | `server/modules/outsourcing.js:344-359` | 现状单阶段；M1-D-05 目标形态拆为 `DRAFT → PENDING_INSPECTION → EFFECTED`，**生效时点仍是 `EFFECTED`** |

**事件时点矩阵（本表是权威）**

| 业务事件 | 是否产生 effect | 生效时点 | effect 类型 | 权威 Handler |
|---|---|---|---|---|
| 普通采购收货**创建 DRAFT** | **否** | 尚未生效 | — | `app.js:5473` `createPurchaseReceipt` |
| 普通采购收货**确认** | **是** | 实际确认并产生库存效力时（与 `postTrackedMovement` / `adjustInventory` / `receiveSourceValue` **同一事务内**） | 正向 `signed_quantity > 0` | `app.js:5554` `confirmPurchaseReceipt`（`action='confirm'`） |
| 通知转换为采购收货 **DRAFT** | **否** | 尚未生效 | — | 新增 `server/modules/procurement-notice-conversion.js::convertReceiptNoticeToReceipts` |
| 通知转换为委外收货 **DRAFT** | **否** | 尚未生效 | — | 同上（`target='OUTSOURCING_RECEIPT'`） |
| 委外收货进入**待检**（`PENDING_INSPECTION`） | **否** | 尚未产生库存效力 | — | 新增 `.../receipts/:id/submit` |
| 委外收货 **`EFFECTED`** | **是** | 实际库存生效事务内（倒冲 + 成品入库 + 成本证据） | 正向 `signed_quantity > 0` | `outsourcing-finance.js:76` `confirmOutsourcingReceipt`（`.../receipts/:id/effect`；`:confirm` 为其别名） |
| **未生效单据**取消（DRAFT 收货 / DRAFT 通知） | **不产生负向 effect** | 原本没有正向事实 | — | `app.js:5611` / `procurement-receiving.js:213` |
| **已生效收货**退货（采购退货确认） | **是** | 实物退货实际生效事务内（与 `adjustInventory(-q)` / `issueSourceValue` 同一事务） | 负向 `signed_quantity < 0`，`reverses_effect_id` 指向原正向 effect | `app.js:6199` `confirmPurchaseReturn` |
| **已生效收货**退货（委外成品退货确认） | **是** | 同上 | 负向 `signed_quantity < 0` | `outsourcing-finance.js:249` `createFinishedReturn` |
| **已生效收货**冲销（真实库存反向事实） | **是** | 实际冲销事务内 | 负向 `signed_quantity < 0` | 须为**真实**产生反向库存流水的动作；仅改状态而无反向流水的动作**不产生** effect（见下） |
| **已生效收货**取消 | **依实际反向业务事实处理** | 不得只根据状态变更推断 | 若该取消**真的**产生了反向库存流水 ⇒ 负向 effect；否则**不产生** effect 并登记 `LEGACY_SCHEDULE_UNPROVEN` | 见下 |

**"仅改状态、没有真实库存反向事实"的判定规则（R4-6-R1 明确）**

一个动作是否产生负向 effect，**只**由"该动作在同一事务内是否产生了可核查的库存反向事实"决定，**不**由 `business_status` 的取值变化决定。判定顺序：

1. 该动作是否写了 `inventory_transactions`（`direction='OUT'`）与 `adjustInventory(-q)` / `applyInventoryMutation` 的 OUT 腿？—— 无 ⇒ **不产生**负向 effect。
2. 该动作是否有可核查的库存流水**行 ID**，可与原正向 effect 归属到同一 PO 行 / 同一交期？—— 无 ⇒ **不产生**负向 effect。
3. 两者皆有 ⇒ 负向 effect 的 `signed_quantity` **必须等于**该反向流水的实际数量；不等 ⇒ 拒绝并报告（不得取整、不得按比例）。

⇒ 由此得到三条硬性结论：

- **未生效单据取消**（DRAFT 收货 / DRAFT 通知）**永远不产生**负向 effect —— 它没有正向事实可反向；
- **已生效收货的"取消"**若只是把 `business_status` 改成 `CANCELLED` 而**没有**任何反向库存流水（MySQL/SQLite 上都存在这种纯状态改写），则**不产生**负向 effect；此时该 PO 行的交期消费量**仍然成立**（实物确实到过），交期容量**不因状态改写而恢复**，且该行必须被登记为 `LEGACY_SCHEDULE_UNPROVEN`（容量授权 fail closed），等待独立授权对账；
- **交期容量的恢复只来自可核查的实物反向事实**（采购退货确认、委外成品退货确认、真实冲销），**不来自**任何状态字段的取值。

**历史回填补充（M-03 扩展为七步；不新增 Migration 编号）**

R4-6 的 M-03 只明确了"历史已确认收货的正向 effect"。R4-6-R1 把它扩展为**正向 + 负向**两条独立回填链：

| 步 | 内容 | 判定依据 | 确定性来源 | 不可判定时的处置 |
|---|---|---|---|---|
| 1 | 回填历史**有效收货**的正向 effect | 收货已生效（采购：`purchase_receipts.status='CONFIRMED'`；委外：`outsourcing_receipts.business_status='EFFECTED'`） | `id='M03-SCHEDULE-' \|\| source_type \|\| '-' \|\| source_item_id`（R4-6 已定） | — |
| 2 | 查找历史**已经实际生效**的**采购退货** | `purchase_returns.status='CONFIRMED'` **且**存在同 `receipt_item_id` 的反向 `inventory_transactions`（`direction='OUT'`，`source_type='PURCHASE_RETURN'`） | 反向行 ID + 原收货行 ID | 找不到原收货行 ⇒ `LEGACY_SCHEDULE_UNPROVEN`，**不猜测、不自动冲减** |
| 3 | 查找历史**已经实际生效**的**委外退货** | `outsourcing_finished_returns.business_status='CONFIRMED'` **且**存在反向 `inventory_transactions`（`direction='OUT'`，`source_type='OUTSOURCING_FINISHED_RETURN'`） | 同上 | 同上 |
| 4 | 查找历史**已经实际完成**的收货**取消 / 冲销** | 存在**真实**反向库存流水（按上文判定规则第 1、2 条） | 反向行 ID | 只有状态改写、无反向流水 ⇒ **不产生**负向 effect，且登记 `LEGACY_SCHEDULE_UNPROVEN` |
| 5 | 把能够确定归属的历史负向事件**绑定到原始正向 effect** | 反向流水可唯一回指原收货行 → 原收货行可唯一回指 PO 行 → PO 行的唯一有效交期 | `reverses_effect_id` = 原正向 effect 的 `id`；`reverses_effect_key` = 同一值（规避双端 NULL UNIQUE 差异） | 归属不唯一 ⇒ `LEGACY_SCHEDULE_UNPROVEN` |
| 6 | **不得**覆盖原始正向 effect | 正向 effect 行**永不** UPDATE / DELETE | — | — |
| 7 | 校验累计反向上限 | `Σ effective negative effects referencing original ≤ original.signed_quantity` | 确定性求和 | 超限 ⇒ 迁移**中止**并报告（不得静默截断） |

**"创建退货单" / "确认退货单" / "退货真正产生库存反向流水"的三层区分（R4-6-R1 强制）**

| 层 | 判定 | 是否进入账本 |
|---|---|---|
| 创建退货单 | 只写退货单头/行（`status='DRAFT'`） | **否** —— 尚未生效 |
| 确认退货单 | 把退货单改为 `CONFIRMED`，但**同一事务内没有**反向库存流水 | **否** —— 尚无反向事实 |
| 退货真正产生库存反向流水 | 同一事务内出现 `inventory_transactions(direction='OUT')` + 库存位减少 | **是** —— 此刻写负向 effect |

⇒ **尚未生效的退货单不得提前记入负向 effect。** 回填必须以"反向库存流水存在"为唯一入账条件，而不是以退货单状态为条件。

**数值证明（R4-6-R1 必须覆盖的案例）**

```text
案例 1（基础）：历史采购收货 +100；历史采购退货 −30
  账本保留两条独立事实：
    EFFECT    +100   (business_event_type='RECEIPT')
    REVERSAL  −30   (business_event_type='RETURN', reverses_effect_id → 上行)
  净消费 = 70（**不是 100**）
  ⇒ 净消费量由 Σ signed_quantity 求得，不是"正向量减去别处的量"

案例 2（两次部分退货）：+100 后分别 −30、−20
  ⇒ 三行 effect 共存；Σ negative = 50 ≤ 100；净消费 = 50
  ⇒ 两次退货必须使用**不同的** (business_event_id, business_event_item_id)

案例 3（退货后再次退货）：+100 后 −30 再 −70
  ⇒ 第二次退货前重读 reversible_remaining = 100 − 30 = 70；−70 恰好用尽，合法
  ⇒ 若第三次再退 1 → 409 SCHEDULE_EFFECT_REVERSAL_EXCEEDED，零副作用

案例 4（累计反向超过原始数量）：+100 后试图一次性 −120
  ⇒ 409 SCHEDULE_EFFECT_REVERSAL_EXCEEDED（r 必须满足 0 < r <= reversible_remaining）

案例 5（同一原始 effect 并发反向）：两个连接同时对同一正向 effect 退 60
  ⇒ 锁序 PO 行 → 交期行 → 原正向 effect → 已有负向 effects；仅一方成功
  ⇒ 失败方零副作用（effect 表、业务退货单、库存、估值、审计全部不变）

案例 6（历史退货找不到原始 effect）：历史退货行的原收货行不可解析
  ⇒ 登记 LEGACY_SCHEDULE_UNPROVEN；该 PO 行交期容量授权 fail closed
     （409 RECEIPT_NOTICE_SCHEDULE_CAPACITY_UNKNOWN）；**不得**猜测、**不得**自动冲减

案例 7（历史取消发生在库存生效之前）：DRAFT 收货被取消
  ⇒ 无正向事实 ⇒ 无负向 effect；不进入账本（不产生 0 值行）

案例 8（历史冲销只修改状态、没有真实库存反向事实）
  ⇒ 按上文判定规则第 1、2 条：**不产生**负向 effect
  ⇒ 该 PO 行的交期消费量**仍然成立**；容量授权登记 LEGACY_SCHEDULE_UNPROVEN 并 fail closed
  ⇒ **不得**因为状态变成 CANCELLED 就把消费量归零

必须成立的不变式：
  Σ effective negative effects referencing original  <=  original.signed_quantity
且
  任何历史反向事实都**不得**通过 UPDATE 覆盖原始正向 effect（正向行不可变）
```

**迁移与兼容（R4-6-R1 对 M-03 的扩展）**

- **保留**：确定性 ID（`M03-SCHEDULE-…`）、稳定 fingerprint、幂等重跑（`WHERE NOT EXISTS`）、MySQL DDL 自动提交后的恢复能力（按存在性检查补列/补索引/补行）、SQLite/MySQL 相同的业务判断、`received_quantity` 仅为兼容投影。
- **扩展 M-03 的 PRE / BACKFILL / POST 检查**：

| 检查 | 内容 | 失败行为 |
|---|---|---|
| **PRE-1** | 交期与 PO 行的对应关系可解析（`purchase_order_delivery_schedules.order_item_id` → `purchase_order_items.id`） | 该 PO 行登记 `LEGACY_SCHEDULE_UNPROVEN` |
| **PRE-2** | 历史已生效收货行数 == 可确定性归属的正向 effect 行数（差集即 `LEGACY_SCHEDULE_UNPROVEN` 集合） | 只登记，**不中止**（不可判定是历史事实，不是数据损坏） |
| **PRE-3** | 历史反向库存流水行数 == 可确定性绑定的负向 effect 行数（差集同上） | 只登记，**不中止** |
| **BACKFILL-1** | 步 1～5 逐条确定性插入；正向与负向各自独立 | — |
| **BACKFILL-2** | 负向 effect 的 `reverses_effect_id` 必须指向**本账本内已存在**的正向 effect | 指向不存在 ⇒ 该行**不写入**并登记 `LEGACY_SCHEDULE_UNPROVEN` |
| **POST-1** | 逐 effect 断言 `Σ negative referencing original ≤ original.signed_quantity` | **中止**并报告（不得截断、不得自愈） |
| **POST-2** | 断言原始正向 effect 行**未被 UPDATE**（回填前后逐字比较 `signed_quantity` / `source_item_id` / `delivery_schedule_id`） | **中止**并报告 |
| **POST-3** | 两端 `LEGACY_SCHEDULE_UNPROVEN` 集合的**成员**一致（数量与判定依据一致；运行时刻类字段排除出 parity） | parity 破坏 ⇒ 中止 |

- **兼容旧 M-03**：已执行过旧版 M-03 的数据库，通过存在性检查补列/补索引后，只对"账本尚无该来源正向 effect"的历史行补写正向 effect，并对"账本尚无该负向 effect"的历史反向流水补写负向 effect；判定依据统一为上表的规则，**不依赖**回填执行顺序。
- **`received_quantity` 仍只是兼容投影**：由账本派生，**不参与**任何容量授权；历史行的该列恒为 0 **不得**被当作"无消费"的证据。

历史已确认收货没有可证明的 `delivery_schedule_id` 时，不按日期、行序或比例猜测。单交期 PO 行可由唯一性确定性归属；多交期 PO 行只要存在未归属历史消费，整行交期容量即不可证，409 `RECEIPT_NOTICE_SCHEDULE_CAPACITY_UNKNOWN`，等待独立授权对账。

**R4-6-R2：委外成品退货的交期反向归属修正（P0-03 权威补充）**

> **R4-6-R2 授权来源**：业务所有者《R4-6-R2 Final Bounded Correction》授权本节修正。**未**批准任何业务政策（C-P03 保持待裁定）；**未**进入 Implementation。

**CURRENT IMPLEMENTATION（源码实际行为，不得描述为已具备明细级冲销能力）**

- `server/modules/outsourcing-finance.js::createFinishedReturn`（`:249-326`）的请求字段为 `outsourcingReceiptId` / `quantity` / `returnDate` / `remark` ⇒ **收货单级数量模型**。
- 写入 `outsourcing_finished_returns`（**表头级**，其 DDL 为 `procurement-outsourcing-schema.js:608-621`：`id / return_no / outsourcing_receipt_id / supplier_id / quantity REAL NOT NULL / return_date / business_status / creator_id / created_at`）⇒ **没有 `outsourcing_receipt_item_id`**。
- **全仓库核对**：`outsourcing_finished_return_items` 表**不存在**（`grep -rn "outsourcing_finished_return_items" server/` 无命中）⇒ **没有**明细级退货分配关系，**没有**原始交期 effect 的反向关联。
- ⇒ **不得宣称现有 Handler 已具备明细级交期冲销能力。** 下列条款全部是 **TARGET CONTRACT**。

**TARGET CONTRACT：退货明细来源表（新增；本小节是 DDL 唯一权威）**

```text
outsourcing_finished_return_items
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  outsourcing_receipt_item_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(return_id) REFERENCES outsourcing_finished_returns(id),
  FOREIGN KEY(outsourcing_receipt_item_id) REFERENCES outsourcing_receipt_items(id),
  CHECK(quantity > 0),
  UNIQUE(return_id, outsourcing_receipt_item_id)
```

- 全部 UNIQUE / FK 建立在 **NOT NULL** 列上 ⇒ SQLite 与 MySQL 行为**严格等价**；`CHECK` 由 `mysql-schema.js:204` 翻译保留 ⇒ 双端都强制。
- **纯加性**：`CREATE TABLE IF NOT EXISTS`，无表重建（§26.33.7 加性原则）。
- **历史数据不做回填**：历史退货**没有**明细级归属 ⇒ **不得**按收货数量比例拆分、**不得**推定明细；历史负向事实的回填依据仍是 §26.33.4.1 的"存在真实反向库存流水"规则，且无法唯一归属者一律登记 `LEGACY_SCHEDULE_UNPROVEN`（见下）。

**TARGET CONTRACT：退货 API 请求结构（破坏性输入变更）**

```text
当前（CURRENT）：{ outsourcingReceiptId, quantity, returnDate, remark }
目标（TARGET）：{ outsourcingReceiptId,
                  items: [ { outsourcingReceiptItemId, quantity } ],
                  returnDate, remark }
```

- **单条 `quantity` 的收货单级模型被明细级 `items[]` 取代**；既有调用方若仍只传 `quantity` → 400（缺 `items`），**不得**静默回退到收货单级模型。

**每条退货明细的五项强制校验（R4-6-R2）**

| # | 校验 | 违反 |
|---|---|---|
| 1 | **关联真实的原始委外收货明细** —— `outsourcing_receipt_item_id` 必须存在于 `outsourcing_receipt_items` | 404 `OUTSOURCING_RETURN_ITEM_NOT_FOUND` |
| 2 | **该明细属于指定收货单** —— `outsourcing_receipt_items.receipt_id` == 请求的 `outsourcingReceiptId` | 409 `OUTSOURCING_RETURN_ITEM_MISMATCH` |
| 3 | **退货累计数量不超过原始收货数量** —— `Σ(该收货明细的历史 + 本次) ≤ outsourcing_receipt_items.quantity` | 409 `OUTSOURCING_RETURN_QUANTITY_EXCEEDED` |
| 4 | **找到唯一对应的原始正向交期 effect** —— 由该收货明细 → 收货行 → PO 行 → 交期 → `schedule_consumption_effects` 的正向 effect，逐跳**唯一**解析 | 409 `OUTSOURCING_RETURN_ITEM_UNPROVEN` + 该 PO 行登记 `LEGACY_SCHEDULE_UNPROVEN` |
| 5 | **创建引用原始 effect 的负向 effect** | — |

**反向 effect 的强制合同**

```text
reverses_effect_id = original_positive_effect.id
signed_quantity    = -return_quantity          （负向）
0 < return_quantity <= reversible_remaining(original_positive_effect)
```

⇒ `reversible_remaining(original) = original.signed_quantity + Σ effective negative effects referencing original`（§26.33.4.1 的既有公式）⇒ **累计反向不得超过原始正向量**。

**禁止比例猜测（R4-6-R2 强制）**

若历史退货**无法唯一**对应下列任一项：

- 原始委外收货明细；
- PO 行；
- Delivery Schedule；
- 原始正向交期 effect；

则必须标记 **`LEGACY_SCHEDULE_UNPROVEN`** 并**阻止相关交期容量授权**（409 `RECEIPT_NOTICE_SCHEDULE_CAPACITY_UNKNOWN`）。

⇒ **不得**按收货数量比例分配交期；**不得**修改历史正向 effect；**不得**猜测。

**C-P03 状态保留（R4-6-R2 明确）**

C-P03 **尚未裁定** ⇒ 继续保留既有 fail-closed 规则：**涉及 POSTED 预留超额和未批准商业调整政策的退货，不得在物理副作用之前绕过门禁**。既有错误码 **`POSTED_RESERVATION_POLICY_PENDING`** 继续使用。

⇒ **不得借本次技术合同修订擅自批准 C-P03**；C-P03 的处置仍是 Owner 裁定事项。

**普通 PO 直接收货同样受本合同约束**：`POST /api/purchase-receipts` 的每个 item 新增 `deliveryScheduleId?`。显式 ID 必须属于该 PO 行；省略且恰好一条有效交期时服务端确定性绑定；多条或零条时 409 `RECEIPT_NOTICE_SCHEDULE_REQUIRED`；历史容量不可证时 409 `RECEIPT_NOTICE_SCHEDULE_CAPACITY_UNKNOWN`。直接收货与通知转换必须调用同一 `resolveAndReserveScheduleCapacity(...)`，不得维护第二套容量算法。

**(3) 容差口径**

- `upper_tolerance_pct` / `lower_tolerance_pct` 按**百分数单位**消费（`5` = 5%）。写入路径必须校验 `0 ≤ pct ≤ 100`（现状 `createDeliverySchedule`（`procurement-orders.js:133-140`）**未**校验 → 实现项）。
- **可转换剩余量只用上容差**：`scheduleRemaining = planned_quantity × (1 + upper_tolerance_pct/100) − consumed`。下容差（`lower_tolerance_pct`）约束的是"少交是否可接受"，属**交期关闭**规则，不在 M1 的可转换容量范围内，本 Design **不**消费该字段。
- **历史取值的实际分布未实测**（写入路径不校验 ⇒ 历史上可能存在 > 100 或单位不一致的值）→ 登记为 `T-06`（§26.33.15）。

**(4) 供应商与仓库相容（A-REQ-03 的"同供应商、兼容仓库/业务类型"）**

| 相容项 | 规则 | 可执行性事实 |
|---|---|---|
| 供应商 | 通知的每个来源 PO 行的 `purchase_orders.supplier_id` 必须等于 `receipt_notices.supplier_id` | `purchase_orders.supplier_id` 存在（`db.js:1076`）⇒ **可执行** |
| 业务类型 | 按本小节上方的映射表（`STANDARD_PURCHASE` ↔ `STANDARD_PURCHASE`；`OUTSOURCE` ↔ `OUTSOURCE_PROCESSING`） | `purchase_orders.business_type` 存在（`procurement-outsourcing-schema.js:270`）⇒ **可执行** |
| 仓库 | 一张通知的**全部**来源必须转换到**同一**收货仓；STANDARD_PURCHASE 的收货仓必须等于 `receipt_notices.warehouse_id`；OUTSOURCE 的目标仓由服务端解析（`outsourcing_receipts.warehouse_id`，M-04 新增），客户端不得指定 | `purchase_orders` **没有仓库列**（`db.js:1073-1090`；`procurement-outsourcing-schema.js:268-275` 的增量列中亦无）⇒ **PO 级"兼容仓库"在现有 Schema 中不可表达** |

⇒ **仓库相容的诚实口径**：A-REQ-03 的"兼容仓库"在现有数据模型中**只能按通知级表达** —— 通知携带唯一 `warehouse_id`，其全部来源都转换到该仓，因此这些来源**彼此仓库相容**。若业务需要"每条 PO 各自带收货仓并要求相容"，则需为 `purchase_orders` 增加仓库列，属 **Requirement 级 schema 变更**，**不在** M1 范围；本 Design **不**擅自新增该列，也**不**以任何方式削弱 A-REQ-03 已批准的"不得被单值 `purchase_order_id` 结构限制"与"行级部分转换"要求。OUTSOURCE 的服务端仓库解析规则必须以既有仓库主数据为准，本 Design **不新增**解析规则。

**(5) 一个通知行是否可分配到同一 PO 行的多条交期？—— 裁定：不可以**

- **裁定**：一个通知行对同一 PO 行**至多一条**来源分配。`UNIQUE(notice_item_id, purchase_order_item_id)` 因此**保持不变**，且**继续建立在两个 NOT NULL 列上** ⇒ SQLite 与 MySQL 行为一致（R3 已确立的 NULL 互异陷阱不会复现）。
- `delivery_schedule_id` 表达的是"该通知行分配到该 PO 行的**哪一条**交期"，**不参与**唯一键。
- **理由**：若允许一个通知行跨同一 PO 行的多条交期，唯一键必须纳入 `delivery_schedule_id`，而该列**可空** ⇒ 唯一键在 SQLite/MySQL 上因 NULL 互异而失效（R3 的核心教训）；且"一张通知行跨多条交期"是**业务模型选择**（需要时可用**多个通知行**表达同一 PO 行的不同交期份额），属 `A-P02` 的"分批"语义，**不在** M1 已批准的范围内。
- **交期解析矩阵（R4-5 权威版）**：指定 ID 且不属于 PO 行 → 409；恰好一条有效交期且未指定 → 按唯一性确定绑定；多条有效交期且未指定 → 409 `RECEIPT_NOTICE_SCHEDULE_REQUIRED`；存在适用交期时绝不允许 `scheduleBound=false`。零有效交期能否转换在已批准 Requirement 中无明确依据，保持 `TECHNICAL_CONTRACT_UNPROVEN` 并 fail closed 为 `RECEIPT_NOTICE_SCHEDULE_REQUIRED`，等待 Owner 裁定；不得擅自开放“无交期例外”。

**(6) 累计转换量与并发预留**

- `converted_quantity` 是**累计值**，在同一来源行上单调不减；每次转换在同一事务内、**对来源行加锁后重读**再累加（§26.33.8 的扩展锁序 L2）。
- 并发：两张通知同时转换到同一 PO 行时，必须按扩展锁序（通知行 → 来源行 → PO 行 → 交期，均按 id 升序）取锁，**只有一方**能占用最后一份容量，另一方 409 `RECEIPT_NOTICE_CAPACITY_EXCEEDED`。

**R4-6：转换后取消的最小裁定（P0-04）**：`converted_quantity` 表达**历史累计转换事实**，保持单调不减；它不是“当前有效收货量”。已批准 Requirement 与 §22 capability 基线没有证明取消收货后可重新开放通知来源容量，因此本轮不引入 conversion reversal 表、不把该列减回去，也不允许同一来源量再次转换。取消/退货只通过交期负向 effect 恢复可证明的交期容量，并按各自订单/收货合同恢复可恢复的当前容量；**通知来源容量不自动恢复**。该不对称语义登记为 `T-11 TECHNICAL_CONTRACT_UNPROVEN`：Owner 需最小裁定“取消已转换收货是否允许通知来源量再次转换”；若未来允许，必须新增独立不可变 conversion reversal 事实与反向上限，仍禁止 UPDATE 减少 `converted_quantity`。`converted_quantity=NULL` 继续全程 fail closed，不得借取消路径改为 0。

**委外收货的来源链（M1-D-05）**：`outsourcing_receipt_items` 必须能追到委外订单与加工费 PO 行：

```text
outsourcing_receipts                (现存，:557-576)
  + warehouse_id TEXT NULL            -- 消除写死的 'warehouse-001'
  + source_notice_id TEXT NULL        -- 完工通知来源
  + business_date TEXT NULL           -- 与 received_date 区分：业务日 vs 收货日
  + version INTEGER NOT NULL DEFAULT 0 -- 乐观并发
  现有 business_status 无 CHECK 约束 → 新增状态值无需重建表（SQLite/MySQL 同）

outsourcing_receipt_items            (现存，:579-588)
  + lot_id TEXT NULL
  + serial_id TEXT NULL
  + unit_code TEXT NOT NULL DEFAULT 'EA'
  + processing_po_item_id TEXT NULL  -- 指向 purchase_order_items(id)，加工费 PO 行
  + source_notice_item_source_id TEXT NULL -- 指向 receipt_notice_item_sources(id)
  现有 quantity REAL / unit_price_cents / line_no 保持
```

**加工费 PO 行可追溯性（M1-D-13）**：`processing_po_item_id` 是加工费计量的**权威容量锚**。`purchase_orders.business_type='OUTSOURCE_PROCESSING'` 的行才可被引用；引用非该类型的 PO 行 → 409 `PROCESSING_PO_LINE_TYPE_MISMATCH`。账单行通过已存在但从未写入的 `supplier_bill_items.source_outsourcing_po_line_id` 指向它，形成 `收货明细 → 加工费 PO 行 → 账单行` 的完整行级链。

##### 26.33.4.2 B 组：材料、Supplier WIP 与估值

> **R1 提示**：本小节描述**业务**合同（仓库解析、库存身份、数量公式、UOM 断言、BOM 快照）；与之配套的**物理写者**合同（严格跟踪写者、估值写者、来源类型注册表）见 **§26.33.4.6**，该小节是 R1-01/R1-02/R1-03 的唯一权威。

**权威仓库解析（M1-D-07）**：新增 `server/modules/procurement-outbound-wip.js` 导出

```text
resolveSupplierWipWarehouse(db, supplierId)   -> { warehouseId } | throws 409
resolveMaterialIssueWarehouse(db, materialListRow) -> { warehouseId } | throws 409
```

- `resolveSupplierWipWarehouse` 读 `suppliers.supplier_wip_warehouse_id`（`procurement-outsourcing-schema.js:265`，由 `procurement-profiles.js:99` 写入并已在 `:88-90` 校验仓库存在且启用）。**缺失或未启用 → 409 `SUPPLIER_WIP_WAREHOUSE_MISSING`**（Requirement B-REQ-01 的 fail-closed 硬性要求，现状是全仓库零读取）。
- `resolveMaterialIssueWarehouse` 读**新增列** `outsourcing_material_list.source_warehouse_id`（在 `snapshotMaterialList` 时按 BOM 快照中的来源仓写入）。**缺失 → 409 `MATERIAL_SOURCE_WAREHOUSE_MISSING`**。
- 客户端 `fromWarehouseId` / `toWarehouseId` 从 `issueMaterial` / `supplementMaterial` / `returnMaterial` 的 `assertAllowedFields` 白名单中**移除**（`outsourcing.js:243/264/282`），改为服务端解析结果。这直接消除 `outsourcing-finance.js:371` 写死的 `'warehouse-002' → 'warehouse-001'`。

**库存身份（M1-D-08）**：委外材料在全过程**属于企业**，`Supplier WIP` 只是位置。因此

```text
内部仓位置   = { productId, warehouseId: <内部仓>, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId, serialId }
供应商 WIP 位置 = { productId, warehouseId: <supplier_wip_warehouse_id>, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId, serialId }
```

`ownerType='SUPPLIER'` **只**用于 VMI（企业仓内的供应商所有货物），**不**用于委外材料。这与 §31.2「Outsourcing ownership：企业所有，Supplier WIP = location binding，不是 ownership transfer」一致。

**移动方向与数量**：

| 动作 | `movementKind` | from | to | 数量守恒式 |
|---|---|---|---|---|
| 发料 Issue | `MOVE` | 内部仓 | 供应商 WIP 仓 | `issued += q`；物理总量不变 |
| 补料 Supplement | `MOVE` | 内部仓 | 供应商 WIP 仓 | `supplemented += q` |
| 退料 Return | `MOVE` | 供应商 WIP 仓 | 内部仓 | `returned += q` |
| 倒冲 Backflush | `OUT` | 供应商 WIP 仓 | — | `backflushed += q`；物理总量减少 |

**R4-6：五种 WIP 动作的唯一逐动作 Writer 合同（P0-01）**

| 动作 | 物理库存 | 严格跟踪 | 估值 | WIP 计数器 | 明确禁止 |
|---|---|---|---|---|---|
| Issue 发料 | `MOVE`：内部仓 OUT、供应商 WIP 仓 IN，数量与身份相同 | OUT + IN；同 `movement_group_id`、业务项、LOT/SERIAL 身份 | 来源仓 `issueValue` + 目标仓 `receiveValue`，价值绝对值相等 | `issued += q` | 单腿、跨身份、跨仓全局平均价 |
| Supplement 补料 | 同上 | OUT + IN | `issueValue` + `receiveValue` | `supplemented += q` | 与 Issue 共用业务事件 ID 或 Mutation Key |
| Return 退料 | `MOVE`：供应商 WIP 仓 OUT、内部仓 IN | OUT + IN | `issueValue` + `receiveValue` | `returned += q` | 先加计数再验证来源身份/可用量 |
| Backflush 倒冲 | `OUT`：供应商 WIP 仓单腿出库 | 仅 OUT | 仅 `issueValue` | 只把**本次正增量**计入 `backflushed` | IN 腿、`receiveValue`、按累计目标重复扣减 |
| WIP Transfer | **不变**；零 `inventory_transactions` | **不新增物理跟踪流水** | **不产生物理估值腿** | 源 `transferred_out += q`、目标 `transferred_in += q` | 调用 `applyInventoryMutation` / `postCanonicalTrackedLeg` / `issueValue` / `receiveValue`；B-P01 前计算或搬运成本 |

前三种 MOVE 的两腿必须同事务、OUT 在前 IN 在后，且满足 `Σ physical quantity delta = 0`；跟踪身份和估值来源必须逐腿对应。倒冲的 `incremental = target_cumulative − locked(backflushed_quantity)`，只有 `incremental > 0` 才允许写 OUT/跟踪/估值，写后 `backflushed_quantity += incremental`；`incremental < 0` 或同业务事件发生非预期重放均 409。WIP Transfer 只改变订单间归属证据，其成本字段在 B-P01 获批前固定 `cost_cents=NULL, cost_state='UNVERIFIED_COST'`。

**数量公式（R3 已统一；修正现状的负数与错扣）**：现状 `supplierWipRemaining = issued + supplemented - returned - backflushed` 在四处重复（`outsourcing.js:58/288/393`、`procurement-reports.js:96`），且 `createWipTransfer` 扣减 `issued_quantity` 会把**补料部分**扣成负数。本 Design 统一为：

```text
net_supplied_i   = issued_i + supplemented_i
supplier_wip_i   = net_supplied_i - returned_i - backflushed_i
                  - transferred_out_i + transferred_in_i
```

新增 `outsourcing_material_list.transferred_out_quantity REAL NOT NULL DEFAULT 0` 与 `transferred_in_quantity REAL NOT NULL DEFAULT 0`（**R3 修正**：取代 R1 的单一 `transferred_quantity`，该旧列名全文作废），并把上述公式收敛到**单一导出函数** `supplierWipRemaining(materialRow)`（新模块 `server/modules/outsourcing-material-position.js`），四处读模型全部改调它。`issued_quantity` **不再**因 WIP 转移而减少。

**R4-03：上式之外还有一层"隔离"口径**（权威定义见本小节下方的 DDL 与 §26.33.5.2）

```text
supplier_wip_i            = issued + supplemented − returned − backflushed
                          − transferred_out + transferred_in          （数量守恒口径）
supplier_wip_available_i = supplier_wip_i − legacy_unverified_wip_quantity_i
                          （**新**转移 / 新倒冲 的可用量；归属不可证的历史量被隔离）
```

⇒ 守恒类断言（INV-WIP-1 / 1b / 2）用 `supplier_wip`；**身份绑定的新动作**用 `supplier_wip_available`。两者不可混用，否则会把归属不可证的历史量当作可动用的新 WIP（R4-03 的核心要求）。

**物料快照的权威来源（M1-P-01 继承；R1-03 已批准规则落地）**：现状 `snapshotMaterialList`（`outsourcing.js:223-239`）把 `requiredQuantity` 与 `bomSnapshot` **全部由客户端提交**，`DELETE` 后整表重插，无 BOM 校验、无基数声明、无版本留存。设计要求：

- 快照必须来自 canonical Engineering OUTSOURCE BOM resolver：`resolveEffectiveBomForCaller(db, productId, 'OUTSOURCE', businessDate)`（`engineering-bom.js:672`，与 `manufacturing-orders.js:59`、`planning.js:387` 同一跨模块模式；`BOM_PURPOSES` 含 `'OUTSOURCE'`，`engineering-bom.js:21`）；
- **禁止** `ACTIVE LIMIT 1` 选择器（OUT-08）。`resolveEffectiveBom` 的 legacy 回退分支（`engineering-bom.js:174`）正是 `status='ACTIVE'` + `LIMIT 1` 形态且**不带 purpose 约束**，因此委外消费方必须**断言**所解析到的 BOM 的 `purpose === 'OUTSOURCE'`，否则 409 —— 不能默认接受回退结果；
- 快照必须按**已批准的 OUT-09 规则**同时承载 `per_unit_quantity` 与 `required_quantity`（订单总量口径 = per-unit × `order_quantity`）以及 `scrap`、BOM 版本号；Release 后 master BOM 改变**不回写**历史快照；额外材料走 Supplement；
- 由此，倒冲基数取 `required_quantity`（订单总量口径），`previewOutsourcingDifference` 与 `applyOutsourcingDifference` **必须使用同一口径**（现状 `outsourcing-finance.js:338` 与 `:360` 单位不一致）；
- 损耗（scrap）是否放大 `required_quantity`、以及 BOM 单位与 `outsourcing_material_list.unit` 的换算系数，是 `M1-P-02` 的残余真歧义，**本 Design 不自行选择**。

**UOM 与数量断言（M1-D-07 配套）**：委外物料数量列保持 `REAL`，但必须断言：
- `Number.isFinite(q) && q > 0`，否则 400 `MATERIAL_QUANTITY_INVALID`；
- 动作行的 `unit_code` 必须等于 `outsourcing_material_list.unit`，否则 409 `MATERIAL_UOM_MISMATCH`（**不做静默换算**；Requirement B-REQ-02 要求”合法 UOM”，§31.2 要求”Materials of different UOM/scale must NEVER be aggregated”）；
- LOT/SERIAL 产品必须提供 `lotId`/`serialId`，且 `lot.product_id` / `serial.product_id` 必须匹配（由 `applyInventoryMutation` 的 `validateInventoryMaster` 强制，`inventory-mutation.js:145-168`）。

**C-02 Supplier WIP 转移的数量守恒（M1-D-28）**

**矛盾陈述（R1 的已废弃写法，仅用于解释旧缺陷，不得作为设计依据）**：R1 的 `M1-D-12` 曾规定"`transferred_i += q`（源行）/ `transferred_j += q`（目标行）"，而数量公式同时是 `supplier_wip_i = issued + supplemented − returned − backflushed − transferred_i`。若源行与目标行**都**增加同一个 `transferred_quantity`，则目标行的 WIP 剩余量会被**再扣一次** —— 转移后目标订单凭空少了 q，跨订单的 Supplier WIP 总量**不守恒**（源 −q、目标 −q，净 −2q）。现状 `createWipTransfer`（`outsourcing-finance.js:383-406`）把这一矛盾推到了极端：它同时 `UPDATE ... issued_quantity-=q`（源行）与 `issued_quantity+=q`（目标行），即用**发料计数器**承载转移，而 `issued_quantity` 正是 WIP 剩余公式的组成项 —— 补料部分会被扣成负数。**R3 裁定：R1 的 `transferred_quantity` / `transferred_i` 写法全文作废，唯一权威字段是 `transferred_out_quantity` 与 `transferred_in_quantity`（见下方 DDL 与 §26.33.5.2、§26.33.10.1）。**

**裁定：拆为有符号的两列** —— 源行只记流出、目标行只记流入。

```text
outsourcing_material_list
  + transferred_out_quantity REAL NOT NULL DEFAULT 0   -- 本行作为转移来源流出
  + transferred_in_quantity  REAL NOT NULL DEFAULT 0   -- 本行作为转移目标流入
  + legacy_unverified_wip_quantity REAL NOT NULL DEFAULT 0
        -- R4-5：受未验证历史转移影响时，隔离的是**该行当前全部 supplier_wip**，
        --   而不是历史事件 quantity 的累计值；未受影响行恒为 0。
  + identity_evidence_state TEXT NOT NULL DEFAULT 'NONE'
        -- R4-03：本行的身份证据状态
        --   'NONE'      = 未参与任何历史转移（无隔离）
        --   'UNVERIFIED'= 参与过至少一次历史转移且该转移无身份分区证据
        --   'VERIFIED'  = 全部历史转移均有身份分区证据（当前历史数据不可能达到）
  supplier_wip_i = issued_i + supplemented_i − returned_i − backflushed_i
                  − transferred_out_i + transferred_in_i
  supplier_wip_available_i = supplier_wip_i − legacy_unverified_wip_quantity_i
        -- R4-03：**新**转移 / 新倒冲 的可用量（隔离口径）

outsourcing_wip_transfers                (现存 :641-656；**加性、分阶段**扩展 —— 见 §26.33.7 的 M-07a / M-07b)
  现有：id, transfer_no, source_order_id, target_order_id, material_list_id,
        quantity, transfer_date, business_status, creator_id, created_at
        （**现 `material_list_id` 的历史语义 = 目标行**，见 M-07b 回填规则）
  M-07a 新增列（一律先以**可空**或带默认值的形式加入，保证双端可执行）：
  + source_material_list_id TEXT NULL    -- 源行；历史行仅在**唯一可判定**时回填
  + target_material_list_id TEXT NULL    -- 目标行；历史行由 `material_list_id` 确定性回填
  + product_id TEXT NULL                  -- 目标行的产品；历史行确定性回填
  + identity_json TEXT NOT NULL DEFAULT '[]'  -- (warehouse, lot, serial) 分区明细；
                                             -- 历史行保持 '[]'（**无身份证据，不得编造**）
  + identity_state TEXT NOT NULL DEFAULT 'UNVERIFIED'
        -- R4-03：本行的身份证据状态
        --   'UNVERIFIED' = 无身份分区证据（**所有历史行**；identity_json='[]'）
        --   'VERIFIED'   = 有身份分区明细且 Σ分区数量 == quantity（**只有新写入行**可达）
  + source_resolution_state TEXT NOT NULL DEFAULT 'UNRESOLVED'
        -- R4-03：源行是否被唯一确定
        --   'RESOLVED'   = source_material_list_id 非空且唯一确定
        --   'UNRESOLVED' = 源行不可唯一确定（source_material_list_id IS NULL）
  + quantity_accounting TEXT NOT NULL DEFAULT 'NETTED_IN_ISSUED'
        -- R4-03：该转移量的记账口径（**声明式**，不是推算）
        --   'NETTED_IN_ISSUED' = 数量**已被净值计入**源行 issued_quantity（**历史行的唯一口径**）
        --   'COUNTER_ONLY'     = 仅通过 transferred_out/in 计数（**新写入行的唯一口径**）
  + cost_cents INTEGER NULL              -- 成本携带；B-P01 未裁定前保持 NULL
  + cost_state TEXT NOT NULL DEFAULT 'UNVERIFIED_COST'
        -- 'UNVERIFIED_COST' | 'CARRYING_VALUE'（B-P01 裁定后才允许后者）
  + business_date TEXT NULL              -- 业务日；历史行仅当 `transfer_date` 匹配 ^\d{4}-\d{2}-\d{2}$ 时回填
  + period_key TEXT NULL                 -- 期间键；历史行由 `business_date` 派生
  **不做 NOT NULL 收紧**：SQLite 收紧需重建表（违反加性原则）；MySQL 8 严格模式下
  对已有数据的表执行 ADD COLUMN NOT NULL 且无默认值会直接失败。
```

**R4-5 / R4-03：历史数量会计、当前余额与身份证据必须分离**

现状 `createWipTransfer`（`outsourcing-finance.js:401-402`）对转移执行的是
`UPDATE outsourcing_material_list SET issued_quantity = issued_quantity - q`（源行）与
`issued_quantity = issued_quantity + q`（目标行）。⇒ **历史转移量已经被净值计入 `issued_quantity` 本身**。

因此，若 M-07b 再把历史转移量回填进 `transferred_out_quantity` / `transferred_in_quantity`，同一个数量会被**计两次**（一次在 `issued_quantity` 内、一次在转移计数列内）⇒ `supplier_wip` 被**低估**、跨订单守恒被破坏。R3 的迁移清单**没有**回填这两列，但**也没有**说明原因 —— R4 明确如下：

| 记账口径 | 历史行 | 新写入行 |
|---|---|---|
| 数量落在哪里 | `issued_quantity` 内（已被净值调整） | `transferred_out_quantity` / `transferred_in_quantity` |
| `quantity_accounting` | `'NETTED_IN_ISSUED'` | `'COUNTER_ONLY'` |
| `transferred_out/in` 的值 | **保持 0**（**不回填**） | 累加本次转移量 |

⇒ **数量守恒在两侧都成立**：历史行的 `supplier_wip` 与迁移前逐行相等（`transferred_*` 为 0，`issued_quantity` 已含净值）；新行按有符号两列计算。跨订单 Σ `supplier_wip` 在迁移前后守恒。隔离字段不参加物理数量会计，只限制未来身份绑定动作。

**事件累计隔离公式作废**：不得再以“该行作为历史目标的 quantity + 作为历史源的 quantity”计算隔离。历史事件量描述过去发生过多少转移，不证明其中多少仍留在当前行；链式 A→B→C 会把 B 隔离 40 而 B 当前 WIP 为 0，退料/倒冲后也会让累计事件量超过余额。

**权威隔离模型（当前余额全量隔离）**

> **R4-6-R1：以下 R4-05 模型已被取代（SUPERSEDED）** —— 本块确立的"隔离桶是**独立数量字段**、未参与历史转移的行取 0"的口径，由 §26.33.4.2 的 **R4-6-R1 身份级 WIP 可用量模型**取代，并由该节的 **R4-6-R2 块**进一步更正：`legacy_unverified_wip_quantity` 改为**残差**（R4-6-R2 版本为 `supplier_wip − verified_tracked_wip − verified_quantity_only_wip`），隔离范围扩展为**全部**无身份证据的历史行。下列文字**保留**作为 R4-05 的历史记录与推导依据，**不得**作为实现依据；实现口径一律以 R4-6-R1 块为准。R4-05 的"受影响行取 `supplier_wip`、不累计事件量、不用 `MAX()` 掩盖矛盾"三点结论在 R4-6-R1 下**依然成立**并被继承。

```text
supplier_wip_i
  = issued_i + supplemented_i − returned_i − backflushed_i
    − transferred_out_i + transferred_in_i

legacyAffected(i)
  = i 是任一 identity_state='UNVERIFIED' 历史转移的已知目标行
    OR i 是其已解析源行
    OR i 属于未解析源行的保守候选集合
       （source_order_id + product_id，并满足可证明的 UOM/供应商/WIP 仓条件；
        条件不能证明时扩大到该 source_order 的全部当前正余额物料行）

legacy_unverified_wip_quantity_i
  = CASE
      WHEN legacyAffected(i) AND supplier_wip_i > 0 THEN supplier_wip_i
      ELSE 0
    END

supplier_wip_available_i
  = supplier_wip_i − legacy_unverified_wip_quantity_i
```

该模型刻意不声称能从缺失证据中精确还原身份：一旦历史未验证量与当前余额在同一聚合行中混合，无法证明哪一单位仍属于哪个历史身份，最小可证明安全子集只能是“可用 0、整行隔离”。因此恒有 `0 ≤ legacy_unverified_wip_quantity_i ≤ supplier_wip_i` 与 `supplier_wip_available_i ≥ 0`，且不需要 `MAX()` 掩盖矛盾。

**八类场景证明**：单次 A→B 隔离当前仍有余额的 A/B 受影响行；链式 A→B→C 中 B 当前为 0 故隔离 0，绝不出现 40>0；同一行多次转入/转出只改变 `legacyAffected` 布尔事实，不累计事件量；源行不可解析时扩大候选集合并 fail closed；历史与新版本转移混合时不得把新量与旧量在同一聚合行中假定可分，受影响行仍全量隔离；已从 `issued_quantity` 扣除的转移不再次写转移计数；退料/倒冲后的隔离随当前权威余额重算，永不超过余额；任何解除隔离都必须由独立授权的历史对账提供逐身份证据，不由 GET/CHECK 自动修复。

**业务影响**：受影响行不能继续新转出或新倒冲，也不能用新转入量在同一聚合行上绕过隔离；这可能造成过严阻断。影响行数与数量属 T-09 未实测证据，需 Owner 在 Acceptance 时裁定是否接受该停机范围或另行授权历史对账。本 Design 不修改历史 `issued_quantity`、不伪造 LOT/SERIAL、不自动修复历史。

**R4-6：历史隔离桶的运行期生命周期（P0-02）**

`legacy_unverified_wip_quantity` 是“当前聚合行内不可证明身份归属的历史 WIP”隔离桶，不是可消费的先进先出层。M-07c 建立初始桶后，常规业务 Writer **不得直接 UPDATE 该列**；只有独立授权、逐身份有证据的历史对账流程可以调整。运行期必须把可追溯新量与隔离量分开证明：

```text
available_wip = supplier_wip - legacy_unverified_wip_quantity
0 <= legacy_unverified_wip_quantity <= supplier_wip
available_wip >= 0

正向事件（Issue / Supplement / verified Transfer-In）：
  supplier_wip += q
  legacy_unverified_wip_quantity 不变
  available_wip += q

负向事件（Return / Backflush / Transfer-Out）：
  先在锁内断言 q <= available_wip
  supplier_wip -= q
  legacy_unverified_wip_quantity 不变
  available_wip -= q
```

- 新正向量只有在业务事件、物料行、仓库、UOM 与 LOT/SERIAL 身份证据完整时才形成独立可用增量；无法把新旧量在同一聚合行中区分时，动作 fail closed，不按数量猜测。
- Return、Backflush、Transfer-Out 都不得消耗隔离桶；新负向量先扣可用层。任何写后 `available_wip < 0` 或隔离桶大于当前 WIP 都使整笔事务回滚。
- WIP Transfer 同时锁定并重读源/目标行：源行验证 `q <= available_wip`；目标行只把有完整身份的 `q` 增加到可用层，目标行原隔离桶保持不变。目标行无法承载独立身份分区时 fail closed。
- 场景证明：初始 `supplier_wip=100, legacy=100, available=0`；可追溯补料 50 后为 `150/100/50`；倒冲 60 必须拒绝；倒冲 50 仅在来源、身份、库存、估值与期间全部通过时允许，完成后为 `100/100/0`。

**R4-6-R1：LOT/SERIAL 身份级 WIP 可用量模型（P0-02 权威合同）**

> **R4-6-R1 授权来源**：业务所有者《R4-6-R1 — Bounded Technical Contract Correction》授权本轮消除 P0-02 缺口。**不是**新的 Audit / Requirement；**未**授予 Implementation 授权；**未**批准任何业务政策。**本小节是身份级 WIP 可用量的唯一权威**，与 R4-05 / R4-6 的概括性文字冲突时以本小节为准。

**缺陷复述（为什么必须有身份层）**

R4-6 的数量合同是：

```text
supplier_wip_available = supplier_wip - legacy_unverified_wip_quantity
```

其中 `identity_evidence_state` 是**物料行级**状态、`legacy_unverified_wip_quantity` 是**数量级**隔离字段。三者之间存在一个未被闭合的矛盾：

| 事实 | 出处 | 后果 |
|---|---|---|
| 新补料 / 转入需要 LOT/SERIAL 身份证据 | §26.33.4.2 的 R4-04 第 5 项相容门禁、§26.33.4.6.1 的委外严格跟踪写者合同 | 负向动作必须绑定身份 |
| `legacy_unverified_wip_quantity` 只能证明**数量**不可归属，证明不了**哪个身份**不可归属 | §26.33.4.2 的 R4-03 隔离模型 | 数量级授权被当成身份级授权 |
| `identity_evidence_state='UNVERIFIED'` 的行**任何正数倒冲**均拒绝 | §26.33.5.2 的 R4-03 隔离门禁 | 行级 UNVERIFIED 行的**新**可追溯量也一并被拒 ⇒ `100/100/0 → 150/100/50` 场景中的 +50 无法被消费 |

⇒ 必须引入**身份级**（LOT/SERIAL 粒度）余额层，使"数量可用"与"身份可用"成为两个**分别可证**的量。

**CURRENT IMPLEMENTATION 与 TARGET CONTRACT 的强制区分（R4-6-R2）**

本轮开始前**必须**在每个委外 WIP 相关小节把"当前源码实际行为"与"未来必须实现的技术合同"分开写。核对到的**当前源码事实**（`server/modules/outsourcing.js`、`server/modules/outsourcing-finance.js`）：

| Handler | **CURRENT IMPLEMENTATION（源码实际行为）** | **TARGET CONTRACT（R4-6-R2 设计目标，本轮未实现）** |
|---|---|---|
| `issueMaterial` | 只写 `outsourcing_issues` 一行 + `UPDATE outsourcing_material_list SET issued_quantity += q` + 审计。**无** `applyInventoryMutation`、**无** `postCanonicalTrackedLeg`、**无** `issueValue`/`receiveValue` | `MOVE` 双腿（内部仓 OUT → 供应商 WIP 仓 IN）+ 每腿 canonical 跟踪 + 成对估值 + 身份层 `SUPPLY` effect + allocation |
| `supplementMaterial` | 只写 `outsourcing_supplements` + `supplemented_quantity += q`。**无**任何物理 / 跟踪 / 估值 / 身份层写入 | 同 Issue，另带独立 `sourceType='OUTSOURCING_SUPPLEMENT'`（当前**未注册**） |
| `returnMaterial` | 只写 `outsourcing_returns` + `returned_quantity += q`。**无**任何物理 / 跟踪 / 估值 / 身份层写入 | `MOVE` 双腿（WIP 仓 OUT → 内部仓 IN）+ canonical 跟踪 + 成对估值 + 身份层 `CONSUME` effect + **allocation 分配** |
| `backflushMaterial` | 只 `UPDATE backflushed_quantity += incremental` + 审计。**无**物理 OUT、**无**跟踪、**无**估值 | 单 OUT 腿 + canonical 跟踪 OUT + `issueValue` + 身份层 `CONSUME` effect + **allocation 分配** |
| `createFinishedReturn` | 收货单级数量模型：`outsourcing_finished_returns` 头 + 成品库存 OUT + `adjustInventory` + 商业贷项分配。**无** `outsourcing_finished_return_items`、**无**明细级交期反向 | 明细级退货 + `outsourcing_finished_return_items` + 每条明细唯一对应原始正向交期 effect + 负向 effect（见 §26.33.4.1 的 R4-6-R2 块） |

⇒ **全仓库核对结论**：`server/modules/outsourcing.js` 与 `server/modules/outsourcing-finance.js` 中 `applyInventoryMutation` / `postCanonicalTrackedLeg` / `issueValue` / `receiveValue` 的出现次数为 **0** ⇒ **现状委外材料链路不具备 canonical 物理 / 跟踪 / 估值写入，也不具备任何身份层 effect**。本节其余全部条款均为 **TARGET CONTRACT**，**不得**被描述为当前已具备的行为。

**三种数量的强制拆分（R4-6-R2 更正；取代 R4-6-R1 的单一 `verified_identity_wip`）**

R4-6-R1 把 `NONE` 类型数量桶也计入 `verified_identity_wip`，导致**数量级证据与身份级证据混淆**（`NONE` 桶没有 LOT/SERIAL 身份，却与身份层余额同列）。R4-6-R2 裁定拆分为**三种互斥数量**：

```text
第 1 层（行级，数量）—— 数量守恒口径：
  supplier_wip_i = issued_i + supplemented_i - returned_i - backflushed_i
                   - transferred_out_i + transferred_in_i

第 2 层（证据级，按 evidence_state 分列）—— 本轮更正的权威公式：
  verified_tracked_wip_i
      = Σ available_quantity  WHERE evidence_state = 'TRACKED'
  verified_quantity_only_wip_i
      = Σ available_quantity  WHERE evidence_state = 'QUANTITY_ONLY'
  legacy_unverified_wip_i
      = supplier_wip_i
        - verified_tracked_wip_i
        - verified_quantity_only_wip_i

  supplier_wip_available_i
      = supplier_wip_i - legacy_unverified_wip_i
      = verified_tracked_wip_i + verified_quantity_only_wip_i
```

**授权来源按产品 tracking_policy 严格分离（R4-6-R2 权威）**

| 产品 `tracking_policy` | 可用量授权来源 | 允许的 `identity_key` | 允许的 `evidence_state` |
|---|---|---|---|
| `LOT` | **指定 LOT 的 TRACKED 余额** | `LOT:<lot_id>` | `TRACKED` |
| `SERIAL` | **指定 SERIAL 的 TRACKED 余额** | `SERIAL:<serial_id>` | `TRACKED` |
| `NONE` | **QUANTITY_ONLY 数量桶** | `NONE` | `QUANTITY_ONLY` |

**四条禁止（R4-6-R2 强制）**

1. **禁止**用 `QUANTITY_ONLY` 余额授权 LOT / SERIAL 产品；
2. **禁止**把 `identity_key='NONE'` 描述为**真实库存身份** —— 它是**数量桶标识**，不是身份；
3. **禁止**把数量级证据写成 LOT / SERIAL 身份证据；
4. **禁止**将新业务事件用于减少历史隔离残差（`legacy_unverified_wip_i`）。

`identity_key` 的取值集合**固定为**三个：`LOT:<lot_id>`、`SERIAL:<serial_id>`、`NONE`；`NONE` **只**允许用于产品 `tracking_policy='NONE'`。

**残差定义（R4-6-R1 确立，R4-6-R2 保留并按三种数量展开）**

R4-05 的模型把 `legacy_unverified_wip_quantity` 当作一个**独立**数量字段，对"未参与历史转移"的行取 0；这导致 `supplier_wip ≠ bucket + identity`（历史行证据层为空而桶为 0 ⇒ 行级可用量 100、证据层可用量 0），也就是上面那条"数量可用与身份不可用"的矛盾。裁定：**桶是残差**，即"行总量中尚未被任何证据层证明的部分"。因此：

- 任何历史行（证据层为空）在迁移后 `legacy_unverified_wip = supplier_wip`、`verified_tracked_wip = 0`、`verified_quantity_only_wip = 0`、`supplier_wip_available = 0`；
- 新正向事件**只增加对应证据层**，行总量与该证据层同增 ⇒ **残差（隔离量）自动保持不变**，即"新增 50 不得改变原历史隔离量 100"；
- 负向事件**只减少被授权的那个证据层**，行总量与该证据层同减 ⇒ **残差同样保持不变**；
- ⇒ 残差只被两个动作改变：① M-07d 迁移初值；② 独立授权的历史对账。常规业务 Writer **永不**写这一列。
- **R4-6-R2 追加**：历史数据**没有**可确定关联的物理流水时 ⇒ **不做身份回填、不做比例分摊、不推定 LOT/SERIAL、不减少历史隔离残差**。受影响的行数与隔离总量**未实测**，继续标记**未知**（`T-14`）。

**这比 R4-05 更严（R4-6-R1 显式取代 R4-05 的"未受影响行取 0"）**：R4-05 只隔离"参与过历史转移"的行；R4-6-R1 隔离**全部**无身份证据的历史行。收紧方向的依据是 `AGENTS.md §6`（"未知历史事实不得伪造"）与 Requirement B-REQ-03（"不得越额、跨订单、跨 LOT/SERIAL 或跨 UOM 静默取料"）：**没有身份证据的历史 WIP 不得被身份绑定的退料 / 倒冲 / 转出消费**。收紧带来的业务阻断规模登记为 `T-14`（§26.33.15），`T-09` 的范围相应扩大（`T-09` 原文保留不改）。

**为什么必须新建最小 sidecar，而不能复用现有表**

| 候选 | 为什么不满足 |
|---|---|
| `tracked_inventory_movements`（canonical 跟踪流水） | 只记录**物理**腿。WIP Transfer 按 §26.33.4.2 的定义是**归属再分配、不产生任何物理移动**，因此转移**永远不会**出现在跟踪流水里；且该表没有**订单归属**维度，无法回答"同一 LOT 在 WIP 仓的这些单位里有多少属于本订单 / 本物料行" |
| `inventory_lot_balances` | 主键是 `(warehouse_id, lot_id)`，**没有 owner 维度、没有订单维度**；它回答"WIP 仓里 LOT X 有多少"，不回答"其中多少属于订单 A" |
| `inventory_serials` | 只有 `lifecycle_state` 与 `current_warehouse_id`，**没有订单归属**、没有数量累计，无法承载"已消费 / 剩余可用" |
| `inventory`（8 维 `position_key`） | 位置口径，**没有订单维度、没有血缘**；同一 LOT 在同一仓对不同订单不可区分 |
| `outsourcing_issues` / `outsourcing_supplements` / `outsourcing_returns`（现存三表） | DDL 中**没有 `lot_id` / `serial_id` 列**（`server/migrations/procurement-outsourcing-schema.js:503-556`）⇒ 历史发 / 退 / 补**没有任何身份证据** |
| `outsourcing_wip_transfers.identity_json` | 只承载**新写入**转移行的分区明细；历史行恒为 `'[]'`（M-07b），且它不跟踪 Issue / Supplement / Return / Backflush 的身份余额 |

⇒ 因此需要一个**最小 additive sidecar**。它**不是**第二套 Inventory / Tracking 引擎：

- 物理库存仍只由 `applyInventoryMutation` 写（§26.33.5.5 Mutation Boundary）；
- 跟踪流水仍只由 `postCanonicalTrackedLeg` 写；
- 估值余额仍只由 `issueValue` / `receiveValue` 写；
- sidecar **不持有任何物理数量**，它只持有"**委外 WIP 归属层**的身份配额"，且每一行都必须由同一事务内的 canonical 物理腿背书（`ID-INDEP-1`）。

**表结构（本小节是 DDL 的唯一权威）**

```text
outsourcing_wip_identity_effects          (不可变签名台账 —— 权威事实)
  id TEXT PRIMARY KEY,
  material_list_id TEXT NOT NULL REFERENCES outsourcing_material_list(id),
  identity_key TEXT NOT NULL,             -- 'LOT:<lot_id>' | 'SERIAL:<serial_id>' | 'NONE'
  identity_type TEXT NOT NULL,            -- 'LOT' | 'SERIAL' | 'NONE'
  lot_id TEXT NULL, serial_id TEXT NULL,
  effect_direction TEXT NOT NULL,         -- 'SUPPLY' | 'CONSUME'
  signed_quantity REAL NOT NULL,          -- SUPPLY > 0；CONSUME < 0；禁止 0 / 非有限
  event_type TEXT NOT NULL,               -- 'ISSUE'|'SUPPLEMENT'|'TRANSFER_IN'|'RETURN'|'BACKFLUSH'|'TRANSFER_OUT'
  business_event_id TEXT NOT NULL,
  business_event_item_id TEXT NOT NULL,
  source_effect_id TEXT NULL,             -- R4-6-R2：**历史兼容字段**，单一来源；
                                            --   **权威血缘在 outsourcing_wip_identity_effect_allocations**
  business_date TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(idempotency_key),
  UNIQUE(event_type, business_event_id, business_event_item_id, identity_key),
  CHECK(effect_direction IN ('SUPPLY','CONSUME')),
  CHECK(identity_type IN ('LOT','SERIAL','NONE')),
  CHECK((identity_type='LOT'   AND lot_id IS NOT NULL AND serial_id IS NULL)
     OR (identity_type='SERIAL' AND serial_id IS NOT NULL AND lot_id IS NULL)
     OR (identity_type='NONE'  AND lot_id IS NULL AND serial_id IS NULL)),
  -- R4-6-R2 数据库级数量约束（**只能表达单行约束**）：
  CHECK((effect_direction='SUPPLY' AND signed_quantity > 0)
     OR (effect_direction='CONSUME' AND signed_quantity < 0))     -- 禁止 0 值

outsourcing_wip_identity_effect_allocations  (R4-6-R2 新增：来源分配血缘 —— 多来源消费的权威载体)
  id TEXT PRIMARY KEY,
  effect_id TEXT NOT NULL,
  source_supply_effect_id TEXT NOT NULL,
  allocation_kind TEXT NOT NULL,         -- 'CONSUMPTION' | 'TRANSFER_ORIGIN'
  allocated_quantity REAL NOT NULL,      -- 恒 > 0
  created_at TEXT NOT NULL,
  FOREIGN KEY(effect_id) REFERENCES outsourcing_wip_identity_effects(id),
  FOREIGN KEY(source_supply_effect_id) REFERENCES outsourcing_wip_identity_effects(id),
  CHECK(allocation_kind IN ('CONSUMPTION','TRANSFER_ORIGIN')),
  CHECK(allocated_quantity > 0),
  UNIQUE(effect_id, source_supply_effect_id, allocation_kind)

outsourcing_wip_identity_balances        (锁内重读的物化余额 —— 并发闸门)
  material_list_id TEXT NOT NULL REFERENCES outsourcing_material_list(id),
  identity_key TEXT NOT NULL,
  identity_type TEXT NOT NULL,
  lot_id TEXT NULL, serial_id TEXT NULL,
  evidence_state TEXT NOT NULL,           -- 'TRACKED'（LOT/SERIAL 身份证据）| 'QUANTITY_ONLY'（数量桶，非身份）
  supplied_quantity REAL NOT NULL DEFAULT 0,
  consumed_quantity REAL NOT NULL DEFAULT 0,
  available_quantity REAL NOT NULL DEFAULT 0,   -- = supplied - consumed；恒 >= 0
  last_effect_id TEXT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(material_list_id, identity_key),
  CHECK(evidence_state IN ('TRACKED','QUANTITY_ONLY')),
  CHECK(supplied_quantity >= 0),
  CHECK(consumed_quantity >= 0),
  CHECK(available_quantity >= 0),        -- 物化余额不得为负
  CHECK((identity_type='LOT'   AND lot_id IS NOT NULL AND serial_id IS NULL AND evidence_state='TRACKED')
     OR (identity_type='SERIAL' AND serial_id IS NOT NULL AND lot_id IS NULL AND evidence_state='TRACKED')
     OR (identity_type='NONE'  AND lot_id IS NULL AND serial_id IS NULL AND evidence_state='QUANTITY_ONLY'))
```

- **主键 / 外键 / 唯一约束**：全部 UNIQUE / 主键建立在 **NOT NULL** 列上；余额表主键 `(material_list_id, identity_key)` 两列皆 NOT NULL ⇒ SQLite 与 MySQL 行为**严格等价**（不依赖 NULL 互异语义 —— R3 的核心教训）。
- `identity_key` 的取值口径**复用** §26.33.4.6.1 已定义的 `tracked_inventory_movements.identity_key`（`'LOT:<id>'` / `'SERIAL:<id>'` / `'NONE'`）⇒ 两侧口径逐字一致，不得另立命名。**但 R4-6-R2 明确**：`'NONE'` **不是**身份，只是数量桶键。
- **MySQL DDL**：`CHECK` 约束由 `server/database/mysql-schema.js:204` 从 SQLite 快照翻译保留 ⇒ 双端都强制；三表均为 `CREATE TABLE IF NOT EXISTS`（§26.33.7 加性原则），**不需要**任何表重建，**禁止** `ALTER TABLE ... ADD COLUMN ... UNIQUE`。
- **不新增** `outsourcing_material_list` 的列：证据层的行级投影由本层的余额求和得出，`legacy_unverified_wip_quantity` 沿用 M-06 已有的列。

**数据库约束与运行时约束必须分开（R4-6-R2 强制）**

| 约束类别 | 载体 | 能表达什么 | **不能**表达什么 |
|---|---|---|---|
| **数据库级** | 上表的 `CHECK` / `FOREIGN KEY` / `UNIQUE` / `NOT NULL` | 单行取值范围（SUPPLY > 0、CONSUME < 0、禁止 0）、LOT/SERIAL/NONE 与 `lot_id`/`serial_id` 的组合合法性、allocation 数量 > 0、物化余额非负、关系存在性 | **跨行 `SUM` 一致性**：分配合计是否等于消费量、`remaining_supply` 是否 ≥ 0、余额是否与台账一致 —— 这些**必须**由运行时事务断言 |
| **运行时级** | 同一事务内的断言 | ① `Σ CONSUMPTION allocations(effect) == \|effect.signed_quantity\|`；② `Σ TRANSFER_ORIGIN allocations(effect) == effect.signed_quantity`（TRANSFER_IN）；③ 来源 effect 必须是合法**正向** effect（`effect_direction='SUPPLY'`）；④ 产品 / `identity_type` / `identity_key` / `material_list_id` / 订单关系必须与被分配方一致；⑤ `Σ allocations(source) <= source.signed_quantity` 且 `remaining_supply(source) >= 0`；⑥ 物化余额必须与不可变台账重算结果**一致**；⑦ TRANSFER_IN 的 TRANSFER_ORIGIN 分配必须与同一转移事件的 TRANSFER_OUT 的 CONSUMPTION 分配**完全对应** | — |

⇒ **不得声称普通 SQL `CHECK` 可以完成跨行 `SUM` 校验。** 上述七项只能由运行时事务断言保证，且断言失败即整笔回滚。

**数量公式（运行时权威；R4-6-R2 版本）**

```text
verified_tracked_wip_i
    = Σ_b balances(i, b).available_quantity   WHERE evidence_state = 'TRACKED'
verified_quantity_only_wip_i
    = Σ_b balances(i, b).available_quantity   WHERE evidence_state = 'QUANTITY_ONLY'
legacy_unverified_wip_i
    = supplier_wip_i - verified_tracked_wip_i - verified_quantity_only_wip_i
supplier_wip_available_i
    = supplier_wip_i - legacy_unverified_wip_i
    = verified_tracked_wip_i + verified_quantity_only_wip_i
available(identity b)  = balances(i, b).available_quantity

remaining_supply(effect s)                     -- s 必须 effect_direction='SUPPLY'
    = s.signed_quantity
      - Σ allocated_quantity
        FROM outsourcing_wip_identity_effect_allocations
        WHERE source_supply_effect_id = s.id AND allocation_kind = 'CONSUMPTION'
      -- **不扣 TRANSFER_ORIGIN**：来源扣减只由 TRANSFER_OUT 的 CONSUMPTION 分配完成
```

**逐动作生命周期（本表是 §26.33.4.2 逐动作矩阵的证据层补充；R4-6-R2 版本）**

| 动作 | 行级 `supplier_wip` | 行级 `legacy_unverified_wip` | 证据层 effect | 证据层余额变化 | 授权断言（锁内重读后） |
|---|---|---|---|---|---|
| Issue | `+q` | **不变** | `SUPPLY +q`（每身份分区一条） | `supplied += q` | 身份分区 Σ == q；跟踪品按 tracking_policy 给出 `lotId`/`serialId` |
| Supplement | `+q` | **不变** | `SUPPLY +q` | `supplied += q` | 同上；**不得**因此改变行级 `identity_evidence_state` |
| Return | `−q` | **不变** | `CONSUME −q`（按指定身份） | `consumed += q` | `q ≤ available(identity)` **且** `q ≤ supplier_wip_available` **且** 写 `CONSUMPTION` allocation（FIFO 分配到来源 SUPPLY） |
| Backflush | `−q` | **不变** | `CONSUME −q`（按指定身份） | `consumed += q` | 同上；不足 → 409 `BACKFLUSH_INSUFFICIENT_VERIFIED_WIP` |
| WIP Transfer | 源 `−q`、目标 `+q` | 两行**均不变** | 源 `CONSUME −q`、目标 `SUPPLY +q` | 源 `consumed += q`、目标 `supplied += q` | 源：`q ≤ available(identity)` 且 `q ≤ supplier_wip_available(源行)`，并写 `CONSUMPTION` allocation；目标：写 `TRANSFER_ORIGIN` allocation，**继承**源 TRANSFER_OUT 已确定的来源构成（`ID-INDEP-3`） |

⇒ **负向动作只能消费已验证证据层**：Return / Backflush / Transfer-Out 一律先断言 `q ≤ available(identity)`；`available(identity) = 0` 的历史身份**不可**被任何负向动作消费，也**不可**把行级数量级可用量当成身份授权。
⇒ **Transfer 不产生物理库存、Tracking 或 Valuation 流水**：它的两个 effect 是**归属层**事实（`CONSUME` / `SUPPLY`）；来源血缘由 **allocation 表**表达（源 `CONSUMPTION`、目标 `TRANSFER_ORIGIN`），**不再**依赖单个 `source_effect_id`。

**来源分配规则（R4-6-R2 权威；FIFO、严格同域）**

| 规则 | 内容 |
|---|---|
| 分配域 | **同一订单**、**同一物料行**、**同一产品**、**同一 `identity_type` / `identity_key`**；**不得**跨身份、跨产品、跨 UOM 混合 |
| 排序 | 按原始 supply effect 的 **`created_at ASC, id ASC`** |
| 策略 | **FIFO** 分配（先满足最早创建的 supply effect 的剩余量） |
| SERIAL | 每次**只能**分配一个完整序列号数量（`qty === 1`），不得把一个序列号拆成多份分配 |
| 消费分配 | 写 `allocation_kind='CONSUMPTION'`：`effect_id` 指向负向 CONSUME effect，`source_supply_effect_id` 指向正向 SUPPLY effect；**一笔消费可以分配到多笔 SUPPLY**；分配数量之和必须**恰好**等于该消费 effect 的绝对值；**不得**消费已用完的 SUPPLY（`remaining_supply(source) >= allocated_quantity`） |
| 转移来源分配 | 写 `allocation_kind='TRANSFER_ORIGIN'`：`effect_id` 指向**目标订单**的正向 TRANSFER_IN effect，`source_supply_effect_id` 指向**源订单**的原始 SUPPLY 来源；允许一笔 TRANSFER_IN 对应多笔原始 SUPPLY；**必须**与同一转移事件的 TRANSFER_OUT 的 CONSUMPTION 分配明细**完全对应**（数量、来源构成逐项相等）；**不重复扣减来源供应量** —— 来源扣减只由 TRANSFER_OUT 的 CONSUMPTION 分配完成 |
| TRANSFER_IN 的来源 | **必须继承**对应 TRANSFER_OUT 已确定的原始来源构成，**不得**重新猜测、不得凭新的事件 ID 创建独立身份 |
| `source_effect_id` | 保留为**历史兼容字段**；新模型的**权威血缘是 allocation 表**，**不得**再依赖它表达多来源关系 |

**身份冲突与 fail-closed 规则（R4-6-R2 版本）**

| ID | 规则 | 违反 |
|---|---|---|
| `ID-INDEP-1` | **按事件类型定义的物理背书（R4-6-R2 重写；取代 R4-6-R1 的"所有正向身份事件都必须由 `tracked_inventory_movements` 背书"这一过宽表述）** —— 见下方"ID-INDEP-1 事件类型 × 产品 tracking_policy 背书矩阵"。**不得仅凭新增事件 ID 就宣称身份已验证** | 409 `WIP_IDENTITY_EVIDENCE_MISSING` |
| `ID-INDEP-2` | **NONE 不得掩盖跟踪身份**：若产品 tracking_policy 为 `LOT`/`SERIAL` 而请求缺 `lotId`/`serialId` ⇒ 409 `WIP_IDENTITY_REQUIRED`，**不得**以 `identity_key='NONE'` 落账。`identity_key='NONE'` **只**允许用于 tracking_policy='NONE' 的产品，其余额 `evidence_state='QUANTITY_ONLY'`，**不是**身份证据 | 409 `WIP_IDENTITY_REQUIRED` |
| `ID-INDEP-3` | **SERIAL 独占性 + TRANSFER_IN 来源继承**：同一 `(material_list_id, identity_key)` 在同一物料行上至多存在**一个**余额行；SERIAL 一次一个（`postCanonicalTrackedLeg` 强制 `qty===1`）。Transfer-In 若目标行已存在该身份的**未消费余额**，必须与之**合并**（累加 `supplied`）而不是新建余额行，并证明该序列号当前不在 WIP 仓（由 canonical SERIAL 写者的 `lifecycle_state` / `current_warehouse_id` 断言强制）；TRANSFER_IN 的 `TRANSFER_ORIGIN` 分配**必须**继承源 TRANSFER_OUT 已确定的来源构成 | 409 `WIP_IDENTITY_INDEPENDENCE_UNPROVEN` |
| `ID-INDEP-4` | **残差不可被新身份吸收**：新正向事件**只增加**对应证据层；它**不得**减少任何行的 `legacy_unverified_wip`。历史对账若要把残差中的单位指认给某身份，必须**先扣除**该身份已由证据层声明的数量，否则会与证据层重复计入。**新业务事件一律不得用于减少历史隔离残差** | 409 `WIP_IDENTITY_RESIDUAL_CONFLICT` |
| `ID-INDEP-5` | **无法区分新旧身份即整行阻断**：当请求所需的身份在证据层不存在（`available(identity) = 0`）而行级 `supplier_wip_available > 0`（残差模型出现不一致）时 ⇒ **整行阻断**，不得按数量猜测、不得虚构身份可用量 | 409 `WIP_IDENTITY_NOT_RESOLVABLE` |
| `ID-INDEP-6` | **R4-6-R2 新增：证据层与 tracking_policy 绑定**：`evidence_state='TRACKED'` 的余额行**只**允许 `identity_type ∈ ('LOT','SERIAL')`；`evidence_state='QUANTITY_ONLY'` 的余额行**只**允许 `identity_type='NONE'` 且产品 `tracking_policy='NONE'`。**禁止**用 QUANTITY_ONLY 余额授权 LOT / SERIAL 产品 | 409 `WIP_IDENTITY_POLICY_MISMATCH` |
| `ID-INDEP-7` | **R4-6-R2 新增：分配完整性**：消费 effect 的 `CONSUMPTION` 分配合计必须**恰好**等于其绝对值；TRANSFER_IN 的 `TRANSFER_ORIGIN` 分配合计必须**恰好**等于其数量；任一来源的 `remaining_supply` 必须 `>= 0`；来源不得被重复消费 | 409 `WIP_IDENTITY_ALLOCATION_INCOMPLETE` / 409 `WIP_IDENTITY_SUPPLY_EXHAUSTED` |

**ID-INDEP-1 事件类型 × 产品 tracking_policy 背书矩阵（R4-6-R2 唯一权威）**

| 事件 | LOT / SERIAL 产品 | NONE 产品 |
|---|---|---|
| `ISSUE` | **canonical WIP 仓 IN 腿** + 对应 tracked movement | **canonical WIP 仓 IN 腿** |
| `SUPPLEMENT` | **canonical WIP 仓 IN 腿** + 对应 tracked movement | **canonical WIP 仓 IN 腿** |
| `RETURN` | **canonical WIP 仓 OUT 腿** + 对应 tracked movement | **canonical WIP 仓 OUT 腿** |
| `BACKFLUSH` | **canonical WIP 仓 OUT 腿** + 对应 tracked movement | **canonical WIP 仓 OUT 腿** |
| `TRANSFER_OUT` | **不要求物理流水**；要求**原身份供应来源分配**（`CONSUMPTION` allocation 指向来源 SUPPLY） | **不要求物理流水**；要求**原数量桶来源分配**（`CONSUMPTION` allocation 指向来源 SUPPLY） |
| `TRANSFER_IN` | **不要求物理流水**；要求与源转出事件具有**相同身份来源链**（`TRANSFER_ORIGIN` allocation **继承**源 TRANSFER_OUT 的来源构成） | **不要求物理流水**；要求与源转出事件具有**相同数量来源链**（`TRANSFER_ORIGIN` allocation **继承**源 TRANSFER_OUT 的来源构成） |

**解释（R4-6-R2 固定）**：

- Issue / Supplement 是物理库存**进入**供应商 WIP 仓的业务事件 ⇒ 必须有 canonical WIP 仓 IN 腿。
- Return / Backflush 是物理库存**离开**供应商 WIP 仓的业务事件 ⇒ 必须有 canonical WIP 仓 OUT 腿。
- WIP Transfer 是**归属再分配**，**不产生**物理、Tracking、Valuation 流水 ⇒ 不要求物理流水，但**必须**保留来源血缘。
- TRANSFER_IN **必须**能够证明其来源于**对应的** TRANSFER_OUT，**不能**凭一个新的事件 ID 创建独立身份。

⇒ **任何物理腿缺失、身份不一致或来源不可证明的情况，均 fail closed**（整笔回滚，零副作用）。

**锁序扩展（§26.33.8 的补充；R4-6-R2 增加 allocation 来源行锁）**

```text
L2e 委外物料行 outsourcing_material_list（按 id 升序）
L2g 委外身份余额 outsourcing_wip_identity_balances
      （按 (material_list_id, identity_key) 升序）—— R4-6-R1 新增
L2h 委外身份台账 outsourcing_wip_identity_effects —— 只追加，随行锁，不单独加锁
L2i 委外身份分配来源行 outsourcing_wip_identity_effect_allocations
      （待分配的**正向供应来源**，按 source_supply_effect_id 升序）—— R4-6-R2 新增
```

**同一身份竞争时的固定取锁序（R4-6-R2 权威）**

```text
1. 锁订单（源 / 目标）
2. 锁物料行（源 / 目标）
3. 锁身份余额（按 (material_list_id, identity_key) 升序）
4. 锁待分配的正向供应来源（按 effect id 升序）
5. 锁内重新计算可分配余额（remaining_supply）
6. 写 effect 与 allocation
7. 更新余额与业务计数器
```

⇒ **全部操作在一个事务内**；任一步失败 ⇒ **整笔回滚**（effect、allocation、余额、业务计数器、库存、跟踪、估值、审计同时回滚）。

WIP Transfer 的完整取锁序：**源订单 → 目标订单 → 源物料行 → 目标物料行 → 源身份余额 → 目标身份余额 → 源供应来源行 → 目标供应来源行**。

**幂等键（第三层：业务效果事实）**

```text
WIP-IDENTITY-EFFECT:<event_type>:<business_event_id>:<business_event_item_id>:<identity_key>
```

- 该键**只**用于 `outsourcing_wip_identity_effects.idempotency_key`，与外部 API `Idempotency-Key`（第一层）、五字段 Mutation Key（第二层）**严格分离**，三者不得互相替代。
- `UNIQUE(idempotency_key)` + `UNIQUE(event_type, business_event_id, business_event_item_id, identity_key)` 双重防重 ⇒ 同一来源事件不得重复增加身份数量。
- **R4-6-R2**：`outsourcing_wip_identity_effect_allocations` 由 `UNIQUE(effect_id, source_supply_effect_id, allocation_kind)` 防重 ⇒ 同一消费事件对同一来源的同一分配种类**不得重复登记**。
- `request_fingerprint` 复用 `server/modules/financial-controls.js:25-30` 的 `requestFingerprint(...)`，覆盖全部影响数量结果的字段。

**事务边界 / 并发防重 / 回滚**

- 身份 effect、身份 allocation、身份余额、业务计数器、`inventory` / `tracked_inventory_movements` / `inventory_valuation_*`、审计**同处一个** `transaction(db, work)`（§26.33.8 的 `runInTransaction` 语义）。
- **并发防重**：负向动作在锁内重读 `available_quantity` **与** `remaining_supply` 之后才断言；两个并发消费者争抢同一 `(material_list_id, identity_key)` 的最后余额、或争抢同一来源 supply 的最后剩余量时，**只有一方**成功，另一方 409 且**零副作用**（余额、effect、allocation、业务计数器、库存、估值、审计全部回滚）。
- **回滚**：任一断言失败 → 整笔回滚；`outsourcing_wip_identity_effects`、`outsourcing_wip_identity_effect_allocations` 与 `outsourcing_wip_identity_balances` 与业务单据**同时**回滚。
- **禁止**在 handler 内 `catch` 后继续（§26.33.8 Rollback）。

**强制数量案例（逐例逐步求值；R4-6-R2 三种数量版本）**

初始历史状态（迁移后）：

```text
supplier_wip                 = 100
legacy_unverified_wip        = 100      (残差；证据层为空)
verified_tracked_wip         = 0
verified_quantity_only_wip   = 0
supplier_wip_available       = 0
```

新增一笔**可追溯**补料 +50（身份 `LOT:X`，产品 tracking_policy='LOT' ⇒ `evidence_state='TRACKED'`）：

```text
supplier_wip                 = 150        (+50)
legacy_unverified_wip        = 100        (**不变** —— 新增量只进入证据层)
verified_tracked_wip         = 50         (+50；balances(M,'LOT:X').available_quantity = 50)
verified_quantity_only_wip   = 0
supplier_wip_available       = 50
```

请求倒冲 60：

```text
available(identity 'LOT:X') = 50 < 60   ⇒ 409 BACKFLUSH_INSUFFICIENT_VERIFIED_WIP
零副作用：身份余额、effect、业务计数器、库存、估值、审计全部不变
```

请求倒冲 50（通过身份、库存、估值与业务门禁后）：

```text
available(identity 'LOT:X') = 50 >= 50  ✓
FIFO 分配：本次 -50 全部分配到最早创建的 supply effect（remaining_supply 后仍 >= 0）
supplier_wip                 = 100        (-50)
legacy_unverified_wip        = 100        (**不变**)
verified_tracked_wip         = 0          (-50)
verified_quantity_only_wip   = 0
supplier_wip_available       = 0
```

⇒ **新增 50 不得改变原历史隔离量 100**（两处 `legacy_unverified_wip` 均为 100）；且**不得**因为新补料发生就把整行 `identity_evidence_state` 改成 `VERIFIED` —— 行级状态仍为 `UNVERIFIED`，证据层是**独立**的可用性表达。

**行级 `identity_evidence_state` 的口径（R4-6-R2 更正）**

| 值 | 含义（R4-6-R2 权威） |
|---|---|
| `NONE` | 该行**从未**参与任何证据绑定动作（证据层无行） |
| `UNVERIFIED` | 该行仍有**未被证据层覆盖**的历史量（残差 > 0）⇒ 行级仍含不可证部分 |
| `VERIFIED` | 该行残差为 0（`supplier_wip == verified_tracked_wip + verified_quantity_only_wip`）⇒ 全部 WIP 已被证据层证明 |

⇒ `VERIFIED` **只**由残差归零达成，**不得**由"发生了一次新补料"达成；发生新补料后残差仍 > 0 ⇒ 仍为 `UNVERIFIED`。

**守恒等式（M1-D-28 的核心断言；R4-02 已把 INV-WIP-3 改为非自指的四量断言）**

```text
转移瞬间：
  source_line.transferred_out_quantity += q
  target_line.transferred_in_quantity  += q
  ⇒ 源行 supplier_wip −q、目标行 supplier_wip +q
  ⇒ 跨订单 Σ supplier_wip 不变（转移是 0 和的归属再分配）

**R4-02 的四个独立量（运行时合同的权威定义；锁定并重读源行之后计算）**
  WIP_before(i)          = issued_i + supplemented_i − returned_i − backflushed_i
                           − transferred_out_i + transferred_in_i
                           （**加锁后重读**源行所得的当前值；含该行此前已转入的部分）
  q_requested            = 本次请求的转移量（必须 > 0 且有限）
  cum_transferred_out(i) = transferred_out_i(前) + q_requested   （单调不减的累计值）
  WIP_after(i)           = WIP_before(i) − q_requested

不变量（同时登记于 §26.33.10.1 的 INV-WIP-1..6；**R4-02 后为最终版**）：
  INV-WIP-1  对任一**订单**：Σ_i supplier_wip_i ≥ 0
  INV-WIP-1b 对任一**物料行**：supplier_wip_i ≥ 0
             （R4-02：R3 只有**订单级**聚合非负；逐行非负必须单独断言，
               否则一行被透支可被同订单另一行的正数掩盖）
  INV-WIP-2  跨订单：Σ_订单 Σ_i supplier_wip_i 在转移前后守恒（差额为 0）
  INV-WIP-3  **转移量不得超过源行当时可用的 WIP**：
               q_requested ≤ WIP_before(i)
               （R4-02：R3 的 `transferred_out_i ≤ (… − transferred_out_i + transferred_in_i)`
                 左端含 `transferred_out_i`、右端也含该项 ⇒ **自指不等式**，
                 展开后成为 `2·transferred_out_i ≤ A + transferred_in_i`，
                 既不等价于"转移量 ≤ 当时可用 WIP"，也无法在运行时直接求值。
                 R4 以四量定义取代，两侧均不含待求量。）
             且 WIP_after(i) = WIP_before(i) − q_requested ≥ 0（逐行非负）
             违反 → 409 WIP_TRANSFER_EXCEEDS_AVAILABLE
  INV-WIP-3b **隔离口径（R4-5）**：q_requested ≤ supplier_wip_available(i)
               = WIP_before(i) − legacy_unverified_wip_quantity(i)
             —— 受未验证历史转移影响的行 available 恒为 0；不得部分动用
             违反 → 409 WIP_TRANSFER_LEGACY_UNVERIFIED
  INV-WIP-4  **新写入**转移行（`quantity_accounting='COUNTER_ONLY'`）：
               transferred_in_j 与 transferred_out_i 必须成对出现在同一条
               outsourcing_wip_transfers 行上；单边出现即为证据缺失 → 409
             **历史行**（`quantity_accounting='NETTED_IN_ISSUED'`）：
               历史数量仍由 issued_quantity 的净值承载；隔离字段只表达当前可用性，
               其"配对"以 `source_resolution_state` 显式登记，
               **不得**用 transferred_out/in（恒为 0）去核对历史行
  INV-WIP-5  一个业务事件 ID 对应一条 transfer 行；重复转移由 M1-D-31 的
             业务事件 ID 体系防重
  INV-WIP-6  任一**新写入**转移行的 Σ(identity_json 分区数量) 必须 == 该行 quantity；
             且不得跨 LOT/SERIAL 身份分区（批次 A 的 WIP 不得记到批次 B 名下）。
             **历史行**（`identity_state='UNVERIFIED'`、`identity_json='[]'`）
             ⇒ Σ 分区数量 = 0 ≠ quantity ⇒ **该不变量对历史行不成立**，
               不得被当作"已满足"；其后果由 INV-WIP-3b 的隔离规则承担
             （R4-03："源行可确定但无身份证据"的历史转移 ⇒ 身份不变式**不成立**）
```

**目标行的转入 WIP 是否允许再次转出（R3 明确裁定：允许）**

- **允许**。转入的 WIP 是目标订单 WIP 的合法组成部分；禁止再次转出会人为锁死物料，且与 §26.33.5.2 的 WIP 转移语义（订单间归属再分配）冲突。
- **可转移量必须纳入 `transferred_in`**：源行的可转出量就是该行的 `supplier_wip_i`，其定义**已含** `+ transferred_in_i`：

```text
可转出量(source) = supplier_wip_available_source
                  = supplier_wip_source − legacy_unverified_wip_quantity_source
                  = (issued + supplemented − returned − backflushed
                     − transferred_out + transferred_in)
                    − legacy_unverified_wip_quantity
```

  因此"转出自己刚转入的量"在数量上自然被允许，且**不破坏**任何守恒式：转出使源行 `transferred_out += q`、新目标行 `transferred_in += q`，跨订单 Σ `supplier_wip` 仍为 0 和。**R4-02/R4-03**：可转出量的判定式为 `q_requested ≤ WIP_before(source)`（INV-WIP-3）**且** `q_requested ≤ supplier_wip_available(source)`（INV-WIP-3b）；两者都必须在**加锁并重读源行之后**求值。
- **必须同时满足**：见下方"R4-04 相容性门禁"；`identity_json` 的身份分区必须与被转出量严格对应（INV-WIP-6）；否则 409（错误码见 §26.33.11）。
- **若某条历史转移行的 `source_material_list_id` 为 NULL（无法确定源行）**，按上述保守候选集合把可能源行当前正余额全量隔离；不得把历史 quantity 写入任何行的 `transferred_in`。请求命中候选行时 409 `WIP_TRANSFER_LEGACY_UNRESOLVED`（fail-closed）。

**R4-04：WIP 转移的相容性门禁（五项，全部 fail closed）**

WIP 转移被定义为**归属再分配**：物料始终在**同一个**供应商 WIP 仓、同一个 LOT/SERIAL 身份上、企业所有（`ownerType='ENTERPRISE'`），**不产生任何物理移动**。该定义**只**在下列五项相容时成立。现状 `createWipTransfer`（`outsourcing-finance.js:383-406`）**只**按 `product_id` 在目标订单中查找目标行（`:388`），**不**校验供应商、UOM、仓库、身份 ⇒ 不相容的转移今天会被静默接受。R4 补齐如下：

| # | 相容项 | 断言 | 违反 | 可执行性事实 |
|---|---|---|---|---|
| 1 | **产品** | 目标行 `product_id` 必须等于源行 `product_id` | 409 `WIP_TRANSFER_PRODUCT_MISMATCH` | `outsourcing_material_list.product_id` 存在（`procurement-outsourcing-schema.js:489`）⇒ 可执行。**注意**：现状用 `SELECT * FROM outsourcing_material_list WHERE order_id=? AND product_id=?` 取**第一行**，目标订单有多行同产品时会**取错行**；R4 要求目标行**显式指定**且唯一 |
| 2 | **UOM** | 目标行 `unit` 必须等于源行 `unit` | 409 `WIP_TRANSFER_UOM_MISMATCH` | `outsourcing_material_list.unit` 存在（`:490`）⇒ 可执行。**不做静默换算**（B-REQ-02） |
| 3 | **供应商** | 源订单 `outsourcing_orders.supplier_id` 必须等于目标订单的 | 409 `WIP_TRANSFER_SUPPLIER_MISMATCH` | `outsourcing_orders.supplier_id` 存在（`:460`）⇒ 可执行 |
| 4 | **供应商 WIP 仓** | 两个订单的 `suppliers.supplier_wip_warehouse_id` 必须存在且**相等** | 409 `WIP_TRANSFER_WAREHOUSE_MISSING`（仓未配置）／`WIP_TRANSFER_WAREHOUSE_MISMATCH`（仓不同） | `suppliers.supplier_wip_warehouse_id` 存在（`procurement-outsourcing-schema.js:265`）⇒ 可执行。**理由**：仓不同 ⇒ 实物必须移动 ⇒ 该动作**不是**归属再分配，而是**物理转移**；本 Design **没有**物理转移设计，故必须 fail closed |
| 5 | **LOT/SERIAL 身份** | `identity_json` 的每个分区必须与源行**已发往 WIP 仓**的身份证据严格对应（`tracked_inventory_movements` 中 `source_type='OUTSOURCING_ISSUE'`、方向为 WIP 仓 IN 的 `(lot_id/serial_id)`），且 Σ 分区数量 == `quantity`；**不得**跨身份分区 | 409 `WIP_TRANSFER_IDENTITY_MISMATCH` | 身份证据来自 §26.33.4.6.1 的来源占用账 ⇒ 可执行 |

- **SERIAL 特别规则**：`postCanonicalTrackedLeg` 强制 SERIAL 一次一个（`qty===1`），因此 SERIAL 产品的转移**必须**逐个序列号拆分，拆分后的每一份都要有自己的 `identity_json` 分区与自己的业务事件 ID（M1-D-31）。
- **相容性门禁必须在**加锁并重读源行之后、任何写入之前**求值**，且与 §26.33.8 的锁序一致（源订单 → 目标订单 → 源物料行 → 目标物料行）。
- **对 M-07b 历史源行推断的等价保守条件**：历史行的 `source_material_list_id` 只有在**同时**满足下列条件时才回填，否则留 `NULL`（⇒ `source_resolution_state='UNRESOLVED'` ⇒ 运行期 409 `WIP_TRANSFER_LEGACY_UNRESOLVED`）：
  1. 源订单中**恰好一行**同 `product_id` 的物料行（现状 R3 已有）；
  2. 该源行的 `unit` 与目标行 `unit` **相等**；
  3. 源订单与目标订单的 `supplier_id` **相等**；
  4. 两订单的供应商 WIP 仓**可解析且相等**（仓未配置 ⇒ 无法确认 ⇒ 不回填）。
  ⇒ R4 把 R3 的"仅按产品唯一"收紧为"产品 + UOM + 供应商 + 供应商 WIP 仓"。**历史行不被改写**：无法确定者一律留 NULL，**不得**猜测、**不得**编造身份分区。

**物理与归属的边界**：WIP 转移是**订单归属再分配**，**不是**实物移动 —— 物料始终在**同一个**供应商 WIP 仓、同一个 LOT/SERIAL 身份上、企业所有（`ownerType='ENTERPRISE'`）。因此转移**不产生** `inventory` 位置变化、**不产生** `inventory_transactions`、**不产生** `tracked_inventory_movements`、**不产生** `inventory_valuation_movements`；它只改变**订单级归属**与两行的 WIP 剩余量。物理证据是”该身份仍在该仓且数量未变”，归属证据是 `outsourcing_wip_transfers` 行 + 两行的 `transferred_out/in_quantity`。

**LOT/SERIAL 身份证据**：转移必须记录被转移的 `(warehouse_id, lot_id, serial_id)` 分区明细（`identity_json`），且各分区数量之和 **等于** `quantity`；转移**不得**跨越不同身份分区（不得把 A 批次的 WIP 记到 B 批次名下）。身份明细的权威来源是源订单发料时写入的 `tracked_inventory_movements`（`source_type='OUTSOURCING_ISSUE'`，方向为 WIP 仓 IN）。

**成本转移证据（B-P01 继续待决）**：转移的 `cost_cents` 必须由 canonical 估值余额分摊携带，**禁止**跨仓全局平均价、**禁止**默认单价。**B-P01 未裁定前**：转移的**数量归属**可实施，但 `cost_cents` 保持 **NULL** 且 `cost_state='UNVERIFIED_COST'`；任何依赖转移成本闭合的断言（OUT-21 成本证据、跨期 WIP 价值）保持 `POLICY_DECISION_PENDING`，`M1-GB03` 的成本段继续 `BLOCKED`。本 Design **不**为 B-P01 预设计价方法。

##### 26.33.4.3 C 组：加工费、AP 与期间

**来源合同（M1-D-13）**：沿用 `supplier_bill_items` 的 canonical 三元组，**不新增列**：

```text
commercial_source_type   = 'OUTSOURCING_RECEIPT_ITEM'   -- 现存唯一字面量
commercial_source_id     = outsourcing_receipts.id       -- 头级来源
commercial_source_item_id= outsourcing_receipt_items.id   -- 行级来源（CANONICAL）
source_outsourcing_receipt_item_id = outsourcing_receipt_items.id  -- 现存，冗余写
source_outsourcing_receipt_id       = outsourcing_receipts.id      -- 现存，冗余写
source_outsourcing_po_line_id       = outsourcing_receipt_items.processing_po_item_id  -- 现存列，本 Design 首次写入
```

`commercial_source_item_id` 是权威行级来源（与 `solution.md §26.20:3354-3363` 的禁止项一致：不得引入头级 FK、不得引入 `UNIQUE(receipt_item_id)`、不得用 `UNIQUE(source_type+item_id)`）。

**容量与部分计费（R3 已统一为三段式口径；权威定义见 §26.33.10.3）**：`GrossEligible = 收货行数量 − 有效退货量`；`ReservedOthers = 其他有效账单行（DRAFT/WAITING_MATCH/POSTED）的 base_quantity`；`RemainingEligible = GrossEligible − ReservedOthers`；新账单行必须 `newQuantity <= RemainingEligible`。预留集合 = `supplier_bills.status IN ('DRAFT','WAITING_MATCH','POSTED')`（与 `commercial-golive.js:269/325` 的 canonical 集合一致）；**预留键统一为 `supplier_bill_items.commercial_source_type='OUTSOURCING_RECEIPT_ITEM' + commercial_source_item_id`**（**现状** `outsourcing-finance.js:196-198` 用 `source_outsourcing_receipt_item_id` 键，会使经 canonical 路径创建的账单不被计入预留）。**部分计费必须允许**，因此**不得**建唯一索引；互斥由**事务内对来源行加锁后重读**预留量 + 求和保证（§26.33.8、§26.33.10.3）。**不得**把已扣过预留的 `RemainingEligible` 再与全量预留比较。

**期间与业务日（M1-D-14，R4-6）**：`postOutsourcingProcessingFeeBill` 必须先完成 RBAC、幂等、锁内状态/来源重读与 `assertOutsourcingAccountingPolicy`，门禁成功后才按 canonical 顺序调用

```text
assertFinanceBusinessDateOpen(db, 'AP', bill.bill_date)   -- finance-business-close.js:21
assertFinancialPeriodsOpen(db, bill.bill_date)             -- financial-inventory.js:24
recognizeFinanceExposure(db, {...})                        -- finance-recognition.js:239
```

这三条的缺失正是现状缺陷：`outsourcing-finance.js` 全文**零**引用 `assertFinanceBusinessDateOpen`/`assertFinancialPeriodsOpen`/`recognizeFinanceExposure`/`createSystemVoucher`。改后 `account_payables.recognition_mode` 由 NULL 变为 canonical 值，消除 `commercialReconciliation` 中 `SUPPLIER_BILL_TO_SUBLEDGER_GL` 因 `recognition_mode IS NULL` 而恒为 BLOCKING 的一部分误报（**该对账项在 C-P01 裁定前仍为 BLOCKING，见 §26.33.10.4**）。

**R4-6 权威边界：canonical `postSupplierBill` 顶层 orchestrator 禁止复用；只允许有界复用纯 helper（M1-D-14）**。逐行核对 `commercial-golive.js` 后确认两处硬连：

```text
commercial-golive.js:276  createSupplierBill
    matched = lines.every(x => x.source?.receipt_status === 'CONFIRMED')
    → 委外行的 x.source 来自 commercial_source_item_id（委外收货明细），
      没有 receipt_status 字段 → matched=false → 账单落 WAITING_MATCH
commercial-golive.js:291  supplierBillRecognitionSources
    FROM supplier_bill_items i JOIN purchase_receipts r ON r.id=i.receipt_id
    → 委外账单行的 receipt_id 为 NULL → JOIN 无行 → sources 为空
commercial-golive.js:303  postSupplierBill
    if (!sources.length) throw new HttpError(409, '供应商账单缺少已确认收货来源')
```

因此委外加工费账单**不能**调用 `postSupplierBill` 顶层流程。设计允许一处**无副作用 helper 的有界扩展**（不新建第二应付引擎）：

- 抽取/扩展只读 `supplierBillRecognitionSources` resolver：当 `commercial_source_type='OUTSOURCING_RECEIPT_ITEM'` 时，以委外收货头/行返回 source facts；resolver 自身不得写 AP/GL/状态/审计；
- 委外专用创建路径的 matched 判定要求 `outsourcing_receipts.business_status='EFFECTED'`，历史 `LEGACY_UNVERIFIED` 永远不匹配；
- `postOutsourcingProcessingFeeBill` 在调用任何 `recognizeFinanceExposure` 或凭证 helper **之前**先执行唯一 source-aware policy gate。C-P01..C-P04 未批时必然在此 409，因而不会进入 AP/GL helper。

该扩展**不改变**普通采购账单的任何行为，也不新增会计政策。

**输入校验（消除 500）**：`createProcessingFeeBill` 必须对 `supplierInvoiceNo` 调用 `requiredText(...)`、`billDate` 调用 `normalizeBusinessDate(...)`，缺任一 → 400（现状为 `NOT NULL` 约束冲突 → SQLite/MySQL 均 500）。同一缺陷在 canonical `createSupplierBill`(`commercial-golive.js:283`) 同样存在，但**该路径不在 M1 范围内**，登记为 `M1-F-06` 交由 Finance 域独立授权。

**GL 边界（M1-D-15 / M1-D-16；R2 已重写为 source-aware 门禁，M1-D-30）**

**本 Design 不闭合委外加工费的 GL 凭证。** 理由：Requirement C-REQ-03 明文禁止在 C-P01～C-P04 获批前擅自采用普通采购 `Dr GRNI / Cr AP`、任意费用科目、直接制造差异或补记不可逆历史凭证。

**R2 纠正：R1 的"角色未映射即失败"保护并不覆盖全部分支。** `commercial-golive.js::postSupplierBill` 的三个确认分支行为不同，必须逐支核对：

```text
commercial-golive.js:303  postSupplierBill
  :306  assertFinanceBusinessDateOpen('AP') + assertFinancialPeriodsOpen          ← 期间门禁
  :307  supplierBillRecognitionSources(billId)
  :308  if (!sources.length) throw 409 '供应商账单缺少已确认收货来源'
  :309  recognizeFinanceExposure({ side:'AP', invoice:{...type:'SUPPLIER_BILL'} })
  :315  if (recognition.recognitionMode !== RECOGNITION_MODES.DIRECT) createSystemVoucher(...)

分支 A — DIRECT（DIRECT_BUSINESS_OPEN_ITEM）      finance-recognition.js:258-267
  → 只链接既有 FINAL open item，**不创建凭证**；postSupplierBill 因 :315 的条件**跳过** createSystemVoucher
  → 后果：账单 POSTED、AP 有 open item、**GL 一行都没有**
  → 且 commercialReconciliation 的 WHERE（commercial-golive.js:650）
       `COALESCE(h.recognition_mode,'INVOICE_DRIVEN_OPEN_ITEM') <> 'DIRECT_BUSINESS_OPEN_ITEM'`
     会把 recognition_mode='DIRECT_BUSINESS_OPEN_ITEM' 的行**整行排除**
     → 该账单对 SUPPLIER_BILL_TO_SUBLEDGER_GL **BLOCKING** 检查**不可见** = 静默 GL 绕过
分支 B — INVOICE_DRIVEN（INVOICE_DRIVEN_OPEN_ITEM）  finance-recognition.js:270-275
  → 到达 :315 → createSystemVoucher 使用**普通采购角色集**
     GRNI / INPUT_TAX_RECEIVABLE / PURCHASE_PRICE_VARIANCE / ACCOUNTS_PAYABLE（:316-319）
  → 后果：为委外加工费发出**普通采购分录**，违反 M1-D-16 与 C-REQ-03
分支 C — PROVISIONAL（PROVISIONAL_TO_FINANCIAL）      finance-recognition.js:277-292
  → 同样到达 :315 → 同样使用普通采购角色集 → 同上
```

**委外来源的确认模式如何落定（`finance-recognition-policy.js:23-63`）**：`resolveRecognitionPolicy` 的解析顺序是 ① 来源级覆盖 → ② 遗留单据（**只有** `SALES_DELIVERY` / `PURCHASE_RECEIPT` 有 `billing_mode`；`OUTSOURCING_RECEIPT_ITEM` **没有**）→ ③ 站点级默认 → ④ **兜底 = `DIRECT_BUSINESS_OPEN_ITEM`**（`:61-62`）。因此委外加工费在**没有任何显式政策配置**时会落到**分支 A** —— 恰恰是唯一不产生凭证、且使该账单逃出 BLOCKING 对账的分支。

**另一条现实可达路径**：`ensurePayableSource` → `ensureSubledger`（`settlement-core.js:74-93`）**不写** `item_kind` / `recognition_mode`，而 `account_payables.item_kind` 的默认值是 `'FINAL'`（`v22-finance-wave-a-foundation.js:206-207`）→ 一旦委外来源的 open item 存在，分支 A 的 `row.item_kind !== 'FINAL'` 检查即通过，`recognizeFinanceExposure` 会**成功**返回。

**结论**：**不得**用"新会计科目角色不存在"作为唯一防绕过保护；必须建立 **source-aware 的委外加工费会计政策门禁**，并且委外过账**不得**复用 `postSupplierBill`。

**委外专用过账路径与门禁（M1-D-30）**

```text
postOutsourcingProcessingFeeBill(db, bill, actorId)          -- 新建；owner = outsourcing-finance.js
  ① 账单状态检查：仅 DRAFT 可过账；已 POSTED → 幂等返回首次结果
  ② 期间门禁（允许的操作）
       assertFinanceBusinessDateOpen(db, 'AP', bill.bill_date)   -- 关闭期间 → 409
       assertFinancialPeriodsOpen(db, bill.bill_date)             -- 已结期间 → 409
  ③ 来源门禁（允许的操作）
       账单行必须 commercial_source_type='OUTSOURCING_RECEIPT_ITEM'
       收货明细必须通过 §26.33.5.1 的效力判定（EFFECTED_CONFIRMED）；LEGACY_UNVERIFIED → 409
       供应商一致；加工费 PO 行相容（M1-D-13）
  ④ **source-aware 会计政策门禁（禁止未批准的 GL 操作）**
       assertOutsourcingAccountingPolicy(db, { side:'AP', sourceType:'OUTSOURCING_RECEIPT_ITEM',
                                                businessDate: bill.bill_date })
       → 查 outsourcing_accounting_policies（本次新增；默认**无**任何行）
       → 无已批准且在有效期内的政策行 ⇒ 409 OUTSOURCING_GL_POLICY_NOT_APPROVED
       → 该 409 发生在**任何** recognizeFinanceExposure / createSystemVoucher / open item 写入**之前**
  ⑤ （仅在 ④ 通过后）AP 确认 + GL 交接
       AP 确认使用**委外专用**确认模式与来源（不得使用普通采购的 source/policy 解析路径）
       GL 交接使用**委外专用角色集** OUTSOURCING_PROCESSING_FEE_*（account_role_mappings 中
       在 C-P01/C-P02 裁定前**不注册**；注册后由 ④ 的政策行指定角色集）
```

**允许 / 禁止的边界（source-aware 门禁的判定内容）**

| 类别 | 具体操作 | 当前状态 |
|---|---|---|
| **允许** | 来源校验（收货明细效力、供应商、PO 行相容） | 可实施 |
| **允许** | 期间 / 业务日门禁（`assertFinanceBusinessDateOpen`、`assertFinancialPeriodsOpen`） | 可实施 |
| **允许** | 账单创建（DRAFT）、预留量占用、容量锁、输入校验、幂等、审计 | 可实施 |
| **R4-6：BLOCKED** | 委外退货的商业贷项分配 / AP 调整 / GL（`createCommercialCreditNote` + `applyCreditAdjustment`） | C-P03 未裁定前不得调用；允许实物退货不代表允许会计副作用 |
| **禁止** | 复用 `postSupplierBill`（任一分支） | 门禁拒绝 |
| **禁止** | 选择任何确认模式（DIRECT / INVOICE_DRIVEN / PROVISIONAL） | 门禁拒绝 |
| **禁止** | 生成任何 `accounting_vouchers` / `accounting_entries` 行 | 门禁拒绝 |
| **禁止** | 用普通采购角色集（`GRNI` / `INPUT_TAX_RECEIVABLE` / `PURCHASE_PRICE_VARIANCE` / `ACCOUNTS_PAYABLE`）为委外加工费生成任何分录 | 门禁拒绝 |
| **禁止** | 让委外账单的 `recognition_mode` 落到 `DIRECT_BUSINESS_OPEN_ITEM`（会使该行逃出 BLOCKING 对账） | 门禁拒绝 |

**当前状态的诚实表述（C-04 的结论）**：在 C-P01～C-P04 获批之前，**委外加工费账单只能创建（DRAFT）并占用预留量，不能过账**。过账动作在 ④ 处显式失败为 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`，账单保持 DRAFT，**零** AP open item、**零** 凭证、**零** 分录写入。因此：

- 不存在"AP 已确认但 GL 未知"的对账盲区 —— 委外账单根本不会进入 `supplier_bills.status='POSTED'` 的集合，`SUPPLIER_BILL_TO_SUBLEDGER_GL` 不会因委外账单而产生假 PASS 或假 FAIL；
- `closureState` 必须诚实报告（§26.33.6.3）：委外账单在裁定前恒为 `'NOT_POSTED'`；
- **这不是本 Design 替业务 Owner 选择会计政策** —— 门禁只是把"未裁定时不得发出任何 GL"这一条**已批准的 Requirement 约束**（C-REQ-03）落到代码路径上，并**显式区分**了允许的来源/期间/AP 操作与禁止的未批准 GL 操作。

**新增登记表（默认无行 ⇒ 天然 fail-closed）**

```text
outsourcing_accounting_policies                    (本次新增；无业务数据，默认空)
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL,                             -- 'AP'
  source_type TEXT NOT NULL,                      -- 'OUTSOURCING_RECEIPT_ITEM'
  recognition_mode TEXT NOT NULL,                 -- 经 C-P01..C-P04 批准的委外专用确认模式
  voucher_role_set TEXT NOT NULL,                 -- 委外专用角色集（JSON 数组）
  business_date_from TEXT NOT NULL, business_date_to TEXT NULL,
  approval_ref TEXT NOT NULL,                     -- 业务批准的引用（可审计）
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
  UNIQUE(side, source_type, business_date_from)

outsourcing_accounting_policy_scopes               (R4-6；并发区间 guard，不承载政策内容)
  side TEXT NOT NULL,
  source_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(side, source_type)
```

该表**只**由 C-P01～C-P04 获批后的受控授权动作写入；本 Design **不**预置任何行，**不**预定义角色集内容，**不**选择确认模式。

**R4-6：政策有效期唯一性（F-05）**

- `business_date_from` / `business_date_to` 使用闭区间；`business_date_to IS NULL` 表示无限未来。同一 `(side, source_type)` 的 active 行不得重叠：`new.from <= COALESCE(existing.to,'9999-12-31') AND existing.from <= COALESCE(new.to,'9999-12-31')` 即冲突。
- 写政策时锁定稳定的 policy scope（MySQL 锁对应 side/source_type 的 guard 行；SQLite `BEGIN IMMEDIATE`），重读全部 active 区间后检查再插入；不能只依赖 `UNIQUE(side, source_type, business_date_from)`。查询某业务日必须得到**恰好一条**已批准 active policy；零条 → `OUTSOURCING_GL_POLICY_NOT_APPROVED`，多条 → `OUTSOURCING_GL_POLICY_AMBIGUOUS`，均在任何 AP/GL 副作用前失败。
- 每行必须有非空 `approval_ref`、创建人/时间与审计；变更通过停用旧行 + 新增新行保留历史，不 UPDATE 覆盖批准证据。本 Design/M-16 默认零行，不预置任何未经批准政策。

**R4-6：委外过账真实调用顺序（F-02）**

```text
postOutsourcingProcessingFeeBill
  → RBAC + Idempotency-Key/fingerprint
  → 开事务并锁账单/来源行
  → 重读 DRAFT、来源、容量、期间
  → assertOutsourcingAccountingPolicy（必须唯一命中；C-P01..04 未批即 409）
  → 纯校验/无副作用解析 helper
  → recognizeFinanceExposure / AP open item（仅门禁成功后）
  → 经批准的委外专用 GL adapter（若政策要求）
  → 状态、审计、幂等结果
```

允许复用 `postSupplierBill` 内部的纯校验、日期解析、期间守卫和明确无副作用的底层 helper；**禁止**把 `postSupplierBill` 作为顶层 orchestrator，禁止在 source-aware policy gate 前创建 AP open item/凭证，禁止普通采购角色集与 reconciliation source 判定泄漏到委外路径。任一步失败整体回滚。

**R4-6：退货、贷项、AP 与 GL 四层边界（F-06）**

| 行为 | 当前允许性 | 政策依赖 | Inventory | AP | GL | 期间/回滚 |
|---|---|---|---|---|---|---|
| 实物退货 | 仅 EFFECTED 且来源/身份/可退量可证时可进入预检；若会制造 POSTED 超额，在 C-P03 前 409 | C-REQ-04 + C-P03 边界 | 允许 canonical 反向物理腿 | 无 | 无 | Inventory/Finance 期间均重检；失败零副作用 |
| 商业贷项分配 | **BLOCKED** | C-P03 | 无 | 尚不调整 | 尚不生成 | 政策/期间/原账单证据未齐即 409 |
| AP open item 调整 | **BLOCKED** | C-P01/C-P03/C-P04 | 无 | 仅获批 adapter 可写 | 无或按政策后续 | 与贷项事件同事务，否则回滚 |
| GL 凭证生成 | **BLOCKED** | C-P01/C-P02/C-P03 | 无 | 不得隐式写 | 仅获批委外角色集 | Accounting 期间检查；失败使整笔会计动作回滚 |

允许实物退货不等于允许后三层。C-P03 未裁定时，`createCommercialCreditNote` / `applyCreditAdjustment` 不得被委外路径调用来产生 AP/GL；既存 POSTED 异常继续只读报告，不自动冲销。

**R1 旧表述的更正**：R1 曾称"改后 `account_payables.recognition_mode` 由 NULL 变为 canonical 值，消除 `SUPPLIER_BILL_TO_SUBLEDGER_GL` 因 `recognition_mode IS NULL` 而恒为 BLOCKING 的一部分误报"。该表述**不准确** —— 该检查项的 FAIL 成因是 **GL 缺失**（`row.amount === row.subledger && row.amount === gl`，`gl=0`），而不是 `recognition_mode IS NULL`；而把 `recognition_mode` 置为 `DIRECT_BUSINESS_OPEN_ITEM` 恰恰会让该行**逃出**这项 BLOCKING 检查。故本轮改为：**委外账单在裁定前不过账**（`recognition_mode` 保持不落值），从根上消除该盲区。

因此 `M1-GC02`（Requirement §31.12.9）在 C-P01～C-P04 裁定前标记为 **BLOCKED**（§26.33.12）；`M1-GC01` 的过账断言按 §26.33.12 的"合规拒绝"口径解释（过账被门禁合规拒绝，账单保持 DRAFT，零副作用）。

##### 26.33.4.4 D 组：VMI 消耗、物权与结算

**物理与商业的分离（M1-D-18；R2 已重写为七量模型，M1-D-29）**

**R2 纠正**：R1 的单式恒等式 `received = consumed + transferred + still_supplier_owned + returned_or_cancelled` 把**物理消耗**、**物权转移**与**商业释放**压进同一个 "consumed/transferred" 词里，导致三类量互相串账：

- `ownerChanged` 是**归属再分配**，**不是**物理流出 —— 把它当作 `transferred` 扣减，会在 `closing_qty` 里**重复扣减**（实物并未离开）；
- `supplierConsumedDirect`（供应商所有状态下被直接消耗）与 `enterpriseConsumed`（物权转移后被企业实际消耗）是**两次不同的物理 OUT**，不能合并成一个 "consumed"；
- `commercialReleased` 是**商业量**，把它扣进物理 `closing_qty` 会把"可开票量"与"在库量"混为一谈。

**七量定义（R2 的权威口径）**

| 量 | 含义 | 物理/商业 | 归属 |
|---|---|---|---|
| `supplierOnHand` | SUPPLIER 所有、在企业仓的**在库**数量 | 物理 | `inventory` 中 `owner_type='SUPPLIER'` 的位置数量 |
| `enterpriseOnHand` | ENTERPRISE 所有、在企业仓的**在库**数量 | 物理 | `inventory` 中 `owner_type='ENTERPRISE'` 的位置数量 |
| `supplierConsumedDirect` | **SUPPLIER 所有状态下**被直接消耗的数量 | 物理 | SUPPLIER 位的 OUT 腿（未发生物权转移） |
| `enterpriseConsumed` | **物权转移后**被企业实际消耗的数量 | 物理 | ENTERPRISE 位的 OUT 腿 |
| `ownerChanged` | SUPPLIER → ENTERPRISE 的物权转移数量 | 物理（归属再分配） | `OWNER_CHANGE` 的成对腿 |
| `commercialReleased` | 商业上**释放**（可进入结算）的数量 | 商业 | `vmi_settlement_lines.commercial_released_qty`（R3 统一命名；旧名 `released_qty` 全文作废） |
| `settled` / `billed` | 已结算 / 已开票数量 | 商业 | `vmi_settlement_lines.settled_qty` |

**恒等式（R4 权威版；**权威定义在 §26.33.10.5**，本处为同义摘要，不得与 §26.33.10.5 出现互斥表述）**

```text
**调整量的符号约定（R4-05 裁定；本节与 §26.33.10.5 一致）**
  adjusted_supplier_qty / adjusted_enterprise_qty 是**有符号量**：
      正 = 该所有权池的**在库量增加**（盘盈 / 找到的货 / 计价调整上调）
      负 = 该所有权池的**在库量减少**（盘亏 / 报废 / 计价调整下调）
  unallocated_adjusted_qty 同样是**有符号量**（正负都表示"归属不明"）。
  ⇒ 有符号量的**来源侧**在等式**左端**：一个正调整量进入该池，一个负调整量离开该池。
  ⇒ R3 把 `adjusted_*` 放在**右端**（消耗侧），与 VMI-R 的 closing 公式（`+ adjusted`）**符号相反**
    ⇒ 两式互斥（差 `2 × (adjusted_supplier + adjusted_enterprise)`）⇒ R3 的 VMI-P/S/E **不成立**。

VMI-P（物理总量，以期初为起点）
  opening_supplier_qty + opening_enterprise_qty + received_qty
    + adjusted_supplier_qty + adjusted_enterprise_qty
    + unallocated_adjusted_qty
    = supplierOnHand + enterpriseOnHand
      + supplierConsumedDirect + enterpriseConsumed
      + returnedOrCancelled

VMI-S（供应商来源池）
  opening_supplier_qty + received_qty + adjusted_supplier_qty
    = supplierOnHand + supplierConsumedDirect
      + ownerChanged + returnedOrCancelled

VMI-E（企业池 —— 只由物权转移进入）
  opening_enterprise_qty + ownerChanged + adjusted_enterprise_qty
    = enterpriseOnHand + enterpriseConsumed

VMI-C（商业 —— 与物理解耦）
  billable_qty = commercialReleased            -- 不得用 received − consumed − transferred 冒充
  settled_qty  <= commercialReleased           -- 不得重复结算
  有效上限（防止超额释放同一批）：
    commercialReleased <= ownerChanged + supplierConsumedDirect
  |unallocated_adjusted_qty| > tolerance → 拒绝关期（409），不得擅自分配到某一所有权池
    （R4-05：**正负同等阻断**；容差定义见 §26.33.10.5）

VMI-R（结算行 closing —— 纯物理量）
  closing_qty            = closing_supplier_qty + closing_enterprise_qty
  closing_supplier_qty   = opening_supplier_qty + received_qty
                          − supplier_consumed_qty − owner_changed_qty
                          − returned_qty + adjusted_supplier_qty
  closing_enterprise_qty = opening_enterprise_qty + owner_changed_qty
                          − enterprise_consumed_qty + adjusted_enterprise_qty
  ⇒ ownerChanged 在两个池之间**对冲**（供应商池 −、企业池 +），**不减少**两池合计：
    它是归属再分配，不是物理流出
  ⇒ commercialReleased / settled_qty **不进入** closing 公式：它们是商业量
  ⇒ R4-05：closing 的调整量符号与 VMI-P/S/E **同向**（来源侧为正）。
    当 `unallocated_adjusted_qty=0` 时，`closing_supplier + closing_enterprise` 与 VMI-P 严格对账；
    非零时两者差额恰为 `unallocated_adjusted_qty`，不得宣称三式全部严格相等
```

**R4-05：三式的互斥性证明（本轮新发现；R3 的 VMI-P/S/E 与 VMI-R 不可同时成立）**

```text
R3 的 VMI-P（调整量在右端）：
  opening_S + opening_E + received = onHand_S + onHand_E + consumed_S + consumed_E
                                    + returned + adjusted_S + adjusted_E
  ⇒ onHand_S + onHand_E = opening_S + opening_E + received − consumed_S − consumed_E
                              − returned − adjusted_S − adjusted_E          …(i)

R3 的 VMI-R closing 之和：
  closing_S + closing_E = opening_S + opening_E + received − consumed_S − consumed_E
                              − returned + adjusted_S + adjusted_E          …(ii)

(i) 与 (ii) 的右端相差 2×(adjusted_S + adjusted_E) ⇒ 二者**互斥**。
⇒ 唯一自洽的符号约定：`adjusted_*` 置于**左端（来源侧）**。
   VMI-S + VMI-E 相加后 ownerChanged 对消，得到两个已归属池的合计；
   VMI-P 比该池级合计多 `unallocated_adjusted_qty`。
   因而只有 `unallocated_adjusted_qty=0` 时三者严格相等；非零残差必须显式披露并受关期门禁约束。
```

**R4-05：`returned_qty` 的口径边界（避免引入未被 Schema 承载的量）**

`vmi_settlement_lines` 只有**一个** `returned_qty` 列。本 Design 将其口径固定为**归还给供应商的数量（SUPPLIER 池减少）**：VMI-E 侧**不**设退货项（企业已拥有该货物，其"退回"不是 VMI 结算事件）。因此 VMI-P 的 `returnedOrCancelled` = `returned_qty`。若将来需要企业池退货，**必须**新增独立列并同时扩展 VMI-E —— 本轮**不**臆造第二列，也**不**把企业池退货混入 `returned_qty`。

**R1 旧 closing 公式的更正**：R1 写的是 `closing_qty = opening + received − consumed − transferred − released ± adjusted`。其中 `− transferred`（把物权转移当物理流出）与 `− released`（把商业释放当物理流出）**两项都是重复扣减**，本轮删除；`consumed` 拆为 `supplier_consumed_qty` 与 `enterprise_consumed_qty` 两项。

**四个备选模型与数值例子（M1-D-29；共同场景：**期初 `opening_supplier_qty = opening_enterprise_qty = 0`**，期间 VMI 收货 100，全部 SUPPLIER 所有，企业仓；本例无退货、无调整量，即 `returned_qty = adjusted_supplier_qty = adjusted_enterprise_qty = unallocated_adjusted_qty = 0`）**

| 量 | D-1 先转移后消耗 | D-2a 消耗触发直接扣 SUPPLIER | D-2b 消耗触发先 Owner Change 再消耗 | D-3 消耗与结算分离 |
|---|---|---|---|---|
| 动作 | 收货即 OWNER_CHANGE 100；企业随后实际消耗 50 | 消耗 30 = SUPPLIER 位**单腿**物理 OUT 30；同事务记录 `commercialReleased += 30` | 同一 `movement_group_id` 内三条腿：① SUPPLIER OUT 30 ② ENTERPRISE IN 30 ③ **ENTERPRISE OUT 30（真实物理 OUT）** | 消耗 30 = SUPPLIER 位单腿 OUT；结算时再 OWNER_CHANGE 20；商业释放 50 |
| `supplierOnHand` | 0 | 70 | 70 | 50 |
| `enterpriseOnHand` | 50 | 0 | 0（+30 随即 −30） | 20 |
| `supplierConsumedDirect` | 0 | 30 | 0 | 30 |
| `enterpriseConsumed` | 50 | 0 | 30 | 0 |
| `ownerChanged` | 100 | 0 | 30 | 20 |
| `commercialReleased` | 100 | 30 | 30 | 50 |
| `settled` | 0 | 0 | 0 | 0 |
| `closing_qty` | 50 | 70 | 70 | 70 |
| **VMI-P 校验** `received = onHand(两池) + consumed(两池) + returned` | 100 = 0+50+0+50+0 ✓ | 100 = 70+0+30+0+0 ✓ | 100 = 70+0+0+30+0 ✓ | 100 = 50+20+30+0+0 ✓ |
| **VMI-S 校验** `received = supplierOnHand + supplierConsumedDirect + ownerChanged + returned` | 100 = 0+0+100+0 ✓ | 100 = 70+30+0+0 ✓ | 100 = 70+0+30+0 ✓ | 100 = 50+30+20+0 ✓ |
| **VMI-E 校验** `ownerChanged = enterpriseOnHand + enterpriseConsumed` | 100 = 50+50 ✓ | 0 = 0+0 ✓ | 30 = 0+30 ✓ | 20 = 20+0 ✓ |
| **VMI-C 校验** `billable = released`；`released` 与 `ownerChanged` 解耦 | 100 = 100 ✓（released = ownerChanged） | 30 = 30 ✓（released > ownerChanged，两者不同） | 30 = 30 ✓（released = ownerChanged = 30） | 50 = 50 ✓（released 50 中 **30 无实物转移**） |
| 特征 | 数量对账最简单；无双扣 | 物理无双扣；已消耗量天然有商业来源；**无需**物权转移腿 | 同 D-2a 的商业语义，但**多一条真实物理 OUT 腿** | 与"消耗先发生、结算稍后"最贴合 |
| 代价 | 前置全部商业负债；供应商仓在转移后不再反映供应商占用 | 已消耗但未转移的部分在物理上仍属供应商，物权证据缺失 | **必须显式写第二条物理 OUT**，否则物理总量凭空 +30 | 需要把"实物转移量"与"商业释放量"拆成两个量 |

> **R4-05 备注**：上表的四组"校验"行是**调整量全为 0** 的特例；在 R4 的符号约定下它们**仍然全部成立**（`adjusted_* = unallocated = 0` 时 R3 与 R4 的两套写法**退化为同式**）。⇒ R4 的符号更正**不推翻**上表的任何一行，但**改变了含调整量场景的正确写法**（见下表）。

**R4-05：含调整量的五个数值例子（验证 VMI-P 与两个所有权池方程同时对账）**

共同场景：期初 `opening_supplier_qty = opening_enterprise_qty = 0`；期间 VMI 收货 `received_qty = 100`（全部 SUPPLIER 所有）；除注明外 `supplier_consumed_qty = enterprise_consumed_qty = returned_qty = 0`；容差取 `0`（严格）。

| # | 场景 | `adjusted_supplier` | `adjusted_enterprise` | `unallocated` | `owner_changed` | 期末 `onHand_S` | 期末 `onHand_E` | **VMI-P 校验** | **VMI-S 校验** | **VMI-E 校验** | 关期判定 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **正的供应商调整**（+10，盘盈归供应商池） | `+10` | `0` | `0` | `0` | `110` | `0` | LHS `0+0+100+10+0+0 = 110`；RHS `110+0+0+0+0 = 110` ✓ | LHS `0+100+10 = 110`；RHS `110+0+0+0 = 110` ✓ | LHS `0+0+0 = 0`；RHS `0+0+0 = 0` ✓ | **可关期** |
| 2 | **负的供应商调整**（−10，盘亏归供应商池） | `−10` | `0` | `0` | `0` | `90` | `0` | LHS `0+0+100−10+0+0 = 90`；RHS `90+0+0+0+0 = 90` ✓ | LHS `0+100−10 = 90`；RHS `90+0+0+0 = 90` ✓ | LHS `0+0+0 = 0`；RHS `0+0+0 = 0` ✓ | **可关期** |
| 3 | **正的企业调整**（+5，物权转移 40 后盘盈归企业池） | `0` | `+5` | `0` | `40` | `60` | `45` | LHS `0+0+100+0+5+0 = 105`；RHS `60+45+0+0+0 = 105` ✓ | LHS `0+100+0 = 100`；RHS `60+0+40+0 = 100` ✓ | LHS `0+40+5 = 45`；RHS `45+0+0 = 45` ✓ | **可关期** |
| 4 | **负的企业调整**（−5，物权转移 40 后盘亏归企业池） | `0` | `−5` | `0` | `40` | `60` | `35` | LHS `0+0+100+0−5+0 = 95`；RHS `60+35+0+0+0 = 95` ✓ | LHS `0+100+0 = 100`；RHS `60+0+40+0 = 100` ✓ | LHS `0+40−5 = 35`；RHS `35+0+0 = 35` ✓ | **可关期** |
| 5 | **非零未归属调整**（+7，无法判定归属哪个池） | `0` | `0` | `+7` | `40` | **不可单独确定** | **不可单独确定** | LHS `0+0+100+0+0+7 = 107` ⇒ 只确定 `onHand_S + onHand_E = 107` | LHS `0+100+0 = 100` ⇒ 要求 `onHand_S = 60` | LHS `0+40+0 = 40` ⇒ 要求 `onHand_E = 40` | **拒绝关期**（`\|7\| > 容差 0`） |

**第 5 例的对账论证（R4-05 的核心）**

```text
VMI-P ⇒ onHand_S + onHand_E = 107
VMI-S + VMI-E（ownerChanged 两侧对消）⇒ onHand_S + onHand_E = 100
两者之差 = 7 = unallocated_adjusted_qty
⇒ 归属不明时，**两个所有权池的恒等式不可能同时成立**：
   · 若把 +7 归供应商池 ⇒ onHand_S = 67、onHand_E = 40，合计 107（与 VMI-P 一致），
     但 VMI-S 要求 onHand_S = 60 ⇒ VMI-S 差 7
   · 若把 +7 归企业池   ⇒ onHand_S = 60、onHand_E = 47，
     VMI-S 成立，但 VMI-E 要求 onHand_E = 40 ⇒ VMI-E 差 7
   · 差额**恒为** unallocated，且方向由归属决定 ⇒ **不得擅自分配**
⇒ 这正是"未归属调整量必须阻断关期"的数学根据；
   归属修复属于**独立授权**的历史/业务处置，本 Design 不提供自动分配。
```

**R4-05：容差与阻断规则**

- 关期门禁：`|unallocated_adjusted_qty| > VMI_ADJUSTMENT_TOLERANCE_QTY` ⇒ **拒绝关期（409）**。**正负同等阻断**（R3 只写了 `> 0`，负的未归属调整会被漏过）。
- 容差常量 `VMI_ADJUSTMENT_TOLERANCE_QTY` 的**默认值 = 0（严格）**。任何非零容差都是**业务容忍度政策**，登记为 `M1-P-04`（§26.33.14.2），**本 Design 不自行选择**。
- 容差只放宽**关期门禁**，不把残差数学上变成零：VMI-S/VMI-E 各自对已归属池精确成立，二者之和与 VMI-P 的差额始终显式等于 `unallocated_adjusted_qty`。当残差非零时不得声称三组恒等式严格相等，即使未来 Owner 批准非零容差。
- 若 `M1-P-04` 裁定容差为 `t > 0`，则 `unallocated_adjusted_qty` 必须在 `[-t, +t]` 内，且**必须**在结算行上显式保留其**符号**与**绝对值**（`vmi_settlement_lines.unallocated_adjusted_qty` 为有符号列），以便对账与审计。

**D-2b 的第二条物理 OUT 与事务关系（C-03 明确要求）**：若采用 D-2b，消耗事件必须在**同一个外层 `transaction(db, work)`** 内按**固定顺序**写入三条腿：

```text
腿1  applyInventoryMutation(OWNER_CHANGE 的 OUT 半)  SUPPLIER −q   sourceType='VMI_OWNERSHIP_TRANSFER'
腿2  applyInventoryMutation(OWNER_CHANGE 的 IN  半)  ENTERPRISE +q  同 movement_group_id、同 source_id/source_item_id
腿3  applyInventoryMutation(OUT)                     ENTERPRISE −q   同 movement_group_id、同 source_id/source_item_id
```

- 三腿**必须**同 `movement_group_id`、同 `source_id`（= 业务事件 ID，`M1-D-31`）、同 `source_item_id`；
- **腿3 不可省略**：只写腿1+腿2 会让 ENTERPRISE 位凭空 +q → 物理总量 100 变 130，**破坏 VMI-P**；同时 SERIAL 产品会留下一个"已转入但未消耗"的悬空身份；
- 腿2→腿3 之间**不得**存在可见中间态：三者同事务提交，任何一步失败 → 整体回滚；
- 若采用 D-2a，则只写**一条** SUPPLIER OUT 腿 + 商业释放记录，物理总量天然守恒；
- **D-P01 仍未批准，本 Design 不自动采用 D-2a 或 D-2b。** 四条路径（D-1 / D-2a / D-2b / D-3）都写进设计，是为了让 D-P01 裁定后**直接**落地，而不是让实现阶段再猜。

**本 Design 的处置**：D-P01 未裁定，因此**不自动采用任一模型**。本 Design 做的是把三条路径都表达得出来，并落地**与模型无关**的部分：
- 新增 `vmi_settlement_periods` / `vmi_settlement_lines`（M1-D-17），行表把上表七个量**分列**承载（`M1-D-29`；**R3 更正列名**，权威 DDL 见本小节的 `vmi_settlement_lines` 块）—— 三种模型都能写进同一张表，差异只在**哪一个量触发账单**；
- **七量 ↔ Schema 列的权威映射（R3 明确；禁止出现两套定义）**

| 语义量 | `vmi_settlement_lines` 列 | 关系 |
|---|---|---|
| `supplierOnHand` | `closing_supplier_qty` | **期末在库**（不是独立列；由 VMI-R 公式算出） |
| `enterpriseOnHand` | `closing_enterprise_qty` | 同上 |
| `supplierConsumedDirect` | `supplier_consumed_qty` | 直接列 |
| `enterpriseConsumed` | `enterprise_consumed_qty` | 直接列 |
| `ownerChanged` | `owner_changed_qty` | 直接列 |
| `commercialReleased` | `commercial_released_qty` | 直接列（**R3 统一命名**；`released_qty` 全文作废） |
| `settled` | `settled_qty` | 直接列 |

  ⇒ **不存在** `supplier_on_hand_qty` / `enterprise_on_hand_qty` 两列（R2 曾用此名，属未落地草稿，已作废）；在库量由 `closing_*` 承载。
- 恒等式 `M1-F-07` 作为**结算期关闭前的强制断言**（§26.33.10.5，R2 已重述为 VMI-P/S/E/C/R 五组），任何模型下都必须成立；
- `M1-D-18` 的选择留给 D-P01；本 Design 给出**推荐 D-2a**（物理腿最少、恒等式最简、已消耗量天然有商业来源）并说明 D-2b 的额外成本。

**结算期与防重（M1-D-17）**：

```text
vmi_settlement_periods
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES vmi_agreements(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  period_key TEXT NOT NULL,            -- 'YYYY-MM' 或自定义窗口标识
  window_kind TEXT NOT NULL,           -- 'CALENDAR_MONTH' | 'CUSTOM'
  window_start TEXT NOT NULL, window_end TEXT NOT NULL,
  opening_source TEXT NOT NULL,        -- PRIOR_CLOSED_PERIOD | CANONICAL_INVENTORY_POSITION
  opening_snapshot_at TEXT NOT NULL,
  opening_evidence_hash TEXT NOT NULL,
  opening_audit_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN' | 'CLOSED'
  opened_at, closed_at, created_at, updated_at
  UNIQUE(agreement_id, period_key)

vmi_settlement_lines
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES vmi_settlement_periods(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  -- 期初在库（R3 明确：恒等式必须以期初为起点，不得忽略期初库存）
  opening_supplier_qty   REAL NOT NULL DEFAULT 0,   -- 期初 SUPPLIER 所有、在库
  opening_enterprise_qty REAL NOT NULL DEFAULT 0,   -- 期初 ENTERPRISE 所有、在库
  -- 期间物理量
  received_qty            REAL NOT NULL DEFAULT 0,
  supplier_consumed_qty   REAL NOT NULL DEFAULT 0,  -- SUPPLIER 所有下直接消耗
  enterprise_consumed_qty REAL NOT NULL DEFAULT 0,  -- 物权转移后实际消耗
  owner_changed_qty       REAL NOT NULL DEFAULT 0,  -- 归属再分配，**不是**物理流出
  returned_qty            REAL NOT NULL DEFAULT 0,
  -- 调整量（R3：按所有权池分列；无法归属者单列并阻断关期）
  adjusted_supplier_qty   REAL NOT NULL DEFAULT 0,
  adjusted_enterprise_qty REAL NOT NULL DEFAULT 0,
  unallocated_adjusted_qty REAL NOT NULL DEFAULT 0, -- 归属不明的调整；**有符号**（R4-05）
                                                    -- |值| > VMI_ADJUSTMENT_TOLERANCE_QTY 时拒绝关期（正负同等）
  -- 期末在库（纯物理量）
  closing_supplier_qty   REAL NOT NULL DEFAULT 0,
  closing_enterprise_qty REAL NOT NULL DEFAULT 0,
  closing_qty            REAL NOT NULL DEFAULT 0,   -- = closing_supplier_qty + closing_enterprise_qty
  -- 商业量（与物理解耦，M1-D-29；R3 统一命名为 commercial_released_qty）
  commercial_released_qty REAL NOT NULL DEFAULT 0,
  settled_qty             REAL NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NULL,       -- 来源见 D-P02
  bill_id TEXT NULL,                    -- 指向 supplier_bills(id)
  created_at, updated_at
  UNIQUE(period_id, product_id)

vmi_settlement_bill_allocations                 -- R4-6：多账单追踪载体；政策未批前保持无行
  id TEXT PRIMARY KEY,
  settlement_line_id TEXT NOT NULL REFERENCES vmi_settlement_lines(id),
  supplier_bill_id TEXT NOT NULL REFERENCES supplier_bills(id),
  supplier_bill_item_id TEXT NOT NULL REFERENCES supplier_bill_items(id),
  allocation_event_id TEXT NOT NULL,
  allocated_qty REAL NOT NULL,
  allocated_amount_cents INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(allocation_event_id), UNIQUE(idempotency_key),
  UNIQUE(settlement_line_id, supplier_bill_item_id)
```

**R4-6：期间、首期期初与多账单合同（P0-05）**

- 窗口边界采用闭区间 `[window_start, window_end]`，且 `window_start <= window_end`。同一 `agreement_id` 的**全部期间**（`OPEN` 与 `CLOSED` **均**参与；本 Design **没有** `CANCELLED` 状态）若满足 `new.start <= existing.end AND existing.start <= new.end` 即重叠，必须 409；相邻窗口要求 `next.start > previous.end`。`UNIQUE(agreement_id, period_key)` 仅防同键重放，不替代重叠检查。**R4-6-R1 更正**：本句原作"同一 `agreement_id` 的**非取消期间**"，该措辞**作废** —— DDL 的状态集合只有 `('OPEN','CLOSED')`，不存在"取消期间"；权威口径见 §26.33.6.4 的"R4-6-R1：VMI 结算期间的 `status` 语义统一"。
- 创建期间必须先锁 `vmi_agreements` 行，再查询该协议全部有效期间并检查重叠，最后写期间/行/审计；SQLite 依赖 `BEGIN IMMEDIATE`，MySQL 使用 agreement 行 `FOR UPDATE`。两端用同一谓词；并发下只有一方可创建重叠候选。
- 非首期的 opening 必须严格等于时间上紧邻的上一已关闭期间 closing；存在时间缺口、多个前期或前期未关闭均 fail closed。首期不存在前期时，按 `agreement + supplier + product + warehouse + ownerType` 从 canonical inventory position 在 `snapshot_at` 事务快照读取 SUPPLIER/ENTERPRISE 两个所有权池，写入 `opening_supplier_qty/opening_enterprise_qty`，并在 period/line 保存 `opening_source='CANONICAL_INVENTORY_POSITION'`、`opening_snapshot_at`、位置证据摘要与审计引用。无法证明历史 Owner 维度、发现 legacy 未归属库存或快照不完整时 409 `VMI_OPENING_BALANCE_UNPROVEN`，不得默认为 0。
- 首期初始化由 `(agreement_id, period_key)` 与行唯一键保证 exactly-once；重放必须比对快照身份/fingerprint，不得重新取“当前库存”覆盖旧快照。期初调整不是普通开期能力，必须单独授权并写不可变调整证据。
- `vmi_settlement_lines.bill_id` 降级为兼容派生字段：零分配时 NULL，恰好一张账单时可投影该 bill，多张时必须 NULL/`MULTIPLE` 读模型标识，权威关系只在 `vmi_settlement_bill_allocations`。`settled_qty = Σ effective allocated_qty`，金额同理逐 allocation 对账。
- D-P01/D-P02 尚未批准“一条结算行是否允许多次部分结算”及定价/窗口模型，因此 allocation 表仅作为可承载设计，创建账单/分配 API 继续 `BLOCKED`；不得因表已设计就开放部分结算。获批后每次分配必须锁 line、重读 `commercial_released_qty - settled_qty`、写 canonical bill item + allocation + `settled_qty` + 审计/幂等，全部同事务。

**列语义与命名纪律（R3）**

| 语义 | 列 | 纪律 |
|---|---|---|
| 期初在库 | `opening_supplier_qty` / `opening_enterprise_qty` | 取上一个已关闭窗口的 `closing_supplier_qty` / `closing_enterprise_qty`；**恒等式必须以期初为起点** |
| 期间收货 | `received_qty` | 期间内经 `VMI_RECEIPT` 进入的量 |
| 期间消耗 | `supplier_consumed_qty` / `enterprise_consumed_qty` | **两类消耗分开**，不得合并成一个 `consumed_qty` |
| 物权转移 | `owner_changed_qty` | 归属再分配；**不进入**任何物理扣减项 |
| 调整量 | `adjusted_supplier_qty` / `adjusted_enterprise_qty` / `unallocated_adjusted_qty` | **有符号**（R4-05：正 = 池增加，负 = 池减少）；**能归属到所有权池的才进前两列**；无法确定归属的进 `unallocated_adjusted_qty`，其**绝对值**超过 `VMI_ADJUSTMENT_TOLERANCE_QTY`（默认 0）时**拒绝关期**（409，**正负同等**），**不得擅自分配到某一池** |
| 期末在库 | `closing_supplier_qty` / `closing_enterprise_qty` / `closing_qty` | 纯物理量；**不含** `commercial_released_qty`、**不含** `settled_qty`、**不扣减** `owner_changed_qty` |
| 商业释放 | `commercial_released_qty` | **R3 统一命名**；旧名 `released_qty` 全文作废，不得与 `vmi_settlement_lines.released_qty` 混用 |
| 已结算 | `settled_qty` | `settled_qty <= commercial_released_qty`（VMI-C） |

- 防重：`settled_qty` 只能由 `vmi_settlement_bill_allocations` 的有效分配量派生并单调增加；每次增加必须在同一事务锁定 line 后重读。`UNIQUE(period_id, product_id)` 保证一行一产品一窗口，allocation 的三组唯一约束负责事件/请求/账单行防重。
- **已结算量不得重复**：创建账单时原子写 canonical bill item、allocation 与派生 `settled_qty`；兼容 `bill_id` 不作为权威关系。相同请求重放返回首次结果，跨键重复事件由 `allocation_event_id` 唯一约束拒绝，累计上限由行锁 + `settled_qty <= commercial_released_qty` 断言保证。D-P01/D-P02 未批前该写路径保持 BLOCKED。
- **可复现（R2 已更正公式；R4-05 补齐被遗漏的调整项）**：期初量取上一个已关闭窗口的 `closing_supplier_qty` / `closing_enterprise_qty`；按 VMI-R 计算：
  `closing_supplier_qty = opening_supplier_qty + received_qty − supplier_consumed_qty − owner_changed_qty − returned_qty + adjusted_supplier_qty`；
  `closing_enterprise_qty = opening_enterprise_qty + owner_changed_qty − enterprise_consumed_qty + adjusted_enterprise_qty`；
  `closing_qty = closing_supplier_qty + closing_enterprise_qty`。
  **R4-05 更正**：R3 的这段"可复现"文本里，`closing_enterprise_qty` **遗漏了 `+ adjusted_enterprise_qty`**，与 §26.33.10.5 的 VMI-R **不一致**（该遗漏会让企业池的调整量在重算时丢失）。本轮补齐，两处现已**逐字一致**。
  **删除** R1 公式中的 `− transferred`（物权转移不是物理流出）与 `− released`（商业量不是物理量）两项重复扣减。窗口重放（同一 `period_key` 重新生成）必须得到**相同**结果——设计要求结算期生成是**纯函数式重算 + 幂等 upsert**，不是增量累加。

**价格与账单来源（M1-D-19 / M1-D-20）**：
- `transferVmiOwnership` 的请求体**移除** `settlementAmountCents` 与 `supplierBillId`（现状允许客户端直接传入金额与账单 ID，`procurement-vmi.js:184/203/221-222`）。移除后该 handler 只写**物权转移事实**，不写金额。
- 金额来源必须是权威来源：VMI 协议价（`vmi_agreements` 增 `price_list_entry_id` 或协议单价，取决于 D-P02）或 canonical 采购价目表。**客户端金额一律 400**。
- 账单交接：`supplier_bill_items.commercial_source_type = 'VMI_SETTLEMENT_LINE'`（**新字面量**），`commercial_source_id = vmi_settlement_periods.id`，`commercial_source_item_id = vmi_settlement_lines.id`。`supplier_bills` 走 canonical `createSupplierBill` 路径（含 `assertFinanceBusinessDateOpen` + `assertFinancialPeriodsOpen` + `recognizeFinanceExposure`）。这满足 D-REQ-02「必须产生 Canonical Supplier Bill，不得仅保存客户端传入 ID」。

**UAT-14 纠正（D-REQ-03；R2 已更正其处置性质）**：现有 `scripts/acceptance/procurement-outsourcing-functional-uat.mjs:235-241` 仍断言 `409 INVENTORY_OWNER_DIMENSION_UNAVAILABLE`。核对源码：`assertInventoryOwnerDimension`(`procurement-vmi.js:18-20`) 是**空实现**，`createVmiReceipt` 对该请求返回 **201**（`procurement-vmi.js:104`），`confirmVmiReceipt` 走 `applyInventoryMutation` 真实写入 SUPPLIER owner 位（`:116-135`）。因此旧 oracle **已过期**。

**R2 纠正（C-10）**：R1 把"是否改写旧 UAT-14 的期望值"登记为需业务 Owner 决定的待裁定项。**这是错的** —— `document.md §31.12.6`（D-REQ-03）已**明确要求**："采购/委外 UAT-14 必须针对当前 V21 合同，收货创建 `201`，收货确认 `200`，后者证明供应商 Owner 仓位实际增加；**拒绝恢复过时 409 作为测试捷径**"，且该 Requirement 已获 `M1_REQUIREMENT_ACCEPTANCE_PASS`。因此：

- 旧 oracle 的纠正是**已批准的 Requirement 义务**，**只在 Implementation 中执行**，**不再**作为业务政策待决；
- `document.md §35.8` 的 G-5 仍是**已登记的历史风险**，其**处置**即 D-REQ-03 的纠正动作；本 Design 不改写 §35.8，也不重新征询"改 test 还是改 contract"；
- **不修改** `assertInventoryOwnerDimension` 的业务语义（它已无操作，保留为空实现 + 注释，避免成为第二道门禁）；
- §26.33.12 的 `M1-GT02` 保留两条断言：正向断言（创建 201 / 确认 200 / SUPPLIER 位 +50 / ENTERPRISE 位不变），并登记**旧 oracle 在被按 D-REQ-03 纠正之前仍会失败** —— 该失败是**已批准待执行的纠正项**，不是待裁定项。

##### 26.33.4.5 U/T 组：移动工作面与证据层级

**前端调用约定（M1-D-21）**：`src/api.js:21` 是 `export async function api(path, options = {})`——**纯函数**，无 `.get()`/`.post()` 附加属性（已全仓库核实：无任何 `api.get =` 赋值、无 `Object.assign(api, …)`）。因此 `api.get(...)`/`api.post(...)` 必然抛 `TypeError`。正确约定与现有正确页面一致：

```text
api(path)                                     -- GET   （例：src/pages/sales-pricing.jsx:27）
api(path, { method: 'POST', body })           -- POST  （例：src/pages/sales-pricing.jsx:44）
api(path, { method: 'POST', body, headers: { 'Idempotency-Key': k } })  -- 例：src/pages/credit-check.jsx:89
```

10 处需修正的调用点（全部后端路由与响应包络均已存在，**只是调用约定错**）：

| 文件:行 | 现状 | 目标 |
|---|---|---|
| `src/pages/outsourcing.jsx:70` | `api.get('/api/procurement/outsourcing/orders?...')` | `api('/api/procurement/outsourcing/orders?...')` |
| `src/pages/outsourcing.jsx:126` | `api.get('/api/procurement/outsourcing/orders/${orderId}')` | `api('/api/procurement/outsourcing/orders/${orderId}')` |
| `src/pages/outsourcing.jsx:149` | `api.post(url, { action })` | `api(url, { method: 'POST', body: { action } })` |
| `src/pages/outsourcing.jsx:157` | `api.post(url)` | `api(url, { method: 'POST' })` |
| `src/pages/outsourcing.jsx:226` | `api.post(url, { ...form })` | `api(url, { method: 'POST', body: { ...form } })` |
| `src/pages/sourcing-pricing.jsx:51` | `api.get('/api/procurement/source-entries')` | `api('/api/procurement/source-entries')` |
| `src/pages/sourcing-pricing.jsx:52` | `api.get('/api/procurement/quotas')` | `api('/api/procurement/quotas')` |
| `src/pages/sourcing-pricing.jsx:53` | `api.get('/api/procurement/price-list')` | `api('/api/procurement/price-list')` |
| `src/pages/sourcing-pricing.jsx:54` | `api.get('/api/procurement/discounts')` | `api('/api/procurement/discounts')` |
| `src/pages/sourcing-pricing.jsx:70` | `api.post('/api/procurement/sourcing-decisions', {...})` | `api('/api/procurement/sourcing-decisions', { method: 'POST', body: {...} })` |

**范围外但必须登记**：`src/pages/inventory-hub.jsx:7,35` 与 `src/pages/inventory-overview.jsx:13` 导入并调用 `apiClient`，而 `src/api.js` **没有** `apiClient` 导出（同样必崩）。这属于 **Inventory & Warehouse Domain** 的页面，**不在** §31.12 的 U-01 范围内，也不在本 Design 的 WP 范围内。登记为 `M1-F-08`，交由 Inventory 域独立授权修正；本轮**不修改**。

**证据层级（Requirement T-REQ-03）**：所有测试必须标注其证据层级，三级不可混淆：

| 层级 | 含义 | 能否作为“业务可达性”证据 |
|---|---|---|
| **L1 API-可达** | 由生产 API/Handler 创建事实 | **可以** |
| **L2 函数可调用** | 直接调用领域函数构造事实 | 仅可作单元/边界证据 |
| **L3 直接 SQL 造数** | `INSERT` 直接写库 | **不可**作为生产链通路证据 |

现状违规点：`server/outsourcing-finance.test.js:71-72,163-164` 与 `server/out-final-acceptance.test.js:333-334` 直接 `INSERT outsourcing_receipt_items`（L3）来驱动 IQC 与加工费路径；`scripts/acceptance/procurement-outsourcing-functional-uat.mjs:333-334` 亦然（L3）。本 Design 要求：`M1-GA01` 之后的验收**必须**用 L1 造数；L3 仅允许用于独立单元/负向边界，并在测试记录中显式标注层级。

##### 26.33.4.6 R1 修订：B 组物理写者合同（严格跟踪 / 估值 / 来源类型）

本小节是 `R1-01`、`R1-02`、`R1-03` 的**唯一权威**结论。§26.33.1 的 `M1-D-09/M1-D-10/M1-D-23/M1-D-24/M1-D-25`、§26.33.5.2、§26.33.8、§26.33.10 的相关条目均指向本小节；凡与之冲突的旧措辞，以本小节为准。

**先决事实（逐行复核，非推断）**

```text
server/lib/inventory-mutation.js
  :47-61   SOURCE_TYPES（37 个字面量；'OUTSOURCING_RECEIPT' 在 :48 与 :56 重复出现一次，对 Set 语义无影响）
  :90      canonicalFingerprint 只在 isConsignment 时被调用，并要求
           trackingMode==='CANONICAL_STRICT' && valuationMode==='EXTERNAL'
           && valuationPolicy===CONSIGNMENT_POLICIES[sourceType]
  :242     isConsignment = CONSIGNMENT_SOURCE_TYPES.has(sourceType)
  :258-261 非 Consignment 命中 inventory_mutation_log 后**直接返回 replayed:true，不比对请求内容**
  :352-359 isConsignment → postCanonicalTrackedLeg（严格写者）
  :360-362 否则且 trackingMode!=='EXTERNAL' → writeTrackedMovement（宽松写者：只插一行流水）
  :366-386 valuationMode!=='EXTERNAL' → issueSourceValue（try/catch 吞异常）
           valuationMode==='EXTERNAL'  → **一行估值都不写**
  :465-469 db.isTransaction 为真时内联执行（复用外层事务）
server/modules/traceability-quality.js
  :247-275 postCanonicalTrackedLeg：LOT → 校验批次归属 + 改 inventory_lot_balances；
           SERIAL → 强制单个序列号且 qty===1 + 改 inventory_serials.lifecycle_state/current_warehouse_id；
           然后插 tracked_inventory_movements（带 transaction_id）
  :277-317 postTrackedMovement：按 tracked_source_allocations 过账并置 posted=1（allocation-driven 模型）
  :341-389 reverseTrackedSource：冲销时置 reversed=1
  :472-482 reconcileTrackedInventory：批次/序列号维度与 inventory.quantity 的一致性核对
server/modules/financial-inventory.js
  :60-64   balanceKey（估值方法 + product + warehouse + lot/serial）
  :78-93   writeMovement：同时写 inventory_valuation_movements 与 inventory_valuation_balances；
           quantity<0 或 value<0 或 (|quantity|≈0 且 value≠0) → 409「估值余额将产生负数或零数量残值」
  :97-104  receiveValue（数量>0、金额为安全整数分）
  :106-114 issueValue（余额不足 → 409；按 allocateProportionalCents 分摊 value_cents）
  :129-146 identityAllocations / receiveSourceValue / issueSourceValue
           （依赖 tracked_source_allocations 中 posted=1 且 reversed=0 的分配行）
server/migrations/v13-phase6b-traceability-quality.js
  :91      tracked_source_allocations UNIQUE(source_type,source_id,source_item_id,lot_id,serial_id,planned_lot_code,planned_serial_number)
  :112     uq_tracked_post UNIQUE(source_type,source_id,source_item_id,lot_id,serial_id,direction) WHERE reversed=0
server/database/mysql-schema.js
  :138-160 generatedPartialIndex：MySQL 侧把部分唯一索引翻译为「生成列 + SHA2 哈希 + 唯一索引」，
           谓词 `reversed=0` 被保留 → MySQL 侧在"重复必拒绝"方向提供身份去重；
           SQLite 侧的实际行为见下方 C-06 纠正（R4-09：两个方向的等价性必须分开表述）
server/lib/stock.js
  :83-89   adjustInventory：只 upsert inventory.quantity，**不写**流水、跟踪或估值 —— 不是 canonical 写者
```

**结论一（R1-01）：`trackingMode='CANONICAL_STRICT'` 不等于严格跟踪。**

`applyInventoryMutation` 中 `trackingMode` 只有**两个**可观测分支：取 `'EXTERNAL'` 时**不写**任何跟踪流水；取其他值时走 `writeTrackedMovement` —— 只插一行 `tracked_inventory_movements`，**不**维护 `inventory_lot_balances`、**不**维护 `inventory_serials.lifecycle_state`。严格写者 `postCanonicalTrackedLeg` 的唯一入口条件是 `isConsignment`（`:242`、`:352`），与 `trackingMode` **无关**。全仓库生产调用点中 `trackingMode:'CANONICAL_STRICT'` 只出现**一次**（`consignment.js:239`），且其 `sourceType` 必属 `CONSIGNMENT_SOURCE_TYPES`。

因此：若委外路径按原设计传 `trackingMode='CANONICAL_STRICT'`，得到的是宽松流水行 + **未维护的批次余额与序列号生命周期**；`reconcileTrackedInventory()`（`traceability-quality.js:472-482`）会判定批次/序列号维度与 `inventory.quantity` 不一致。**参数名称不得当作功能实现。**

**委外严格跟踪写者合同（M1-D-24 / R1-01 结论）**

```text
每条物理腿（OUT / IN）在**同一个外层 transaction** 内按下列顺序完成：

 1. applyInventoryMutation({ ..., movementKind:'MOVE'|'OUT'|'IN',
                             trackingMode:'EXTERNAL',      // 抑制宽松流水行
                             valuationMode:'EXTERNAL',    // 估值由调用方负责（见 R1-02）
                             fromPosition/toPosition: 显式携带 lotId / serialId })
      → 返回 movements[]（每腿带 transactionId、direction、positionKey、balanceAfter）
 2. 对 movements[] 中**每一条腿**调用 postCanonicalTrackedLeg(db, {
        transactionId, sourceType, sourceId, sourceItemId,
        productId, warehouseId, lotId, serialId, quantity, direction, businessDate })
      → LOT：校验批次归属 + assertAvailableLot(OUT) + 改 inventory_lot_balances
      → SERIAL：强制 qty===1 + 单序列号 + 迁移 lifecycle_state / current_warehouse_id
      → 写 tracked_inventory_movements（携带 transaction_id）
 3. 估值腿（§26.33.4.6.2）必须在步骤 2 **之后**执行：LOT/SERIAL 产品的
    issueValue/receiveValue 需要位置身份（lotId/serialId）已确定。

不可省略 / 不可换序：
  · 步骤 2 不可省略：省略即退化为宽松跟踪（见「结论一」）。
  · 步骤 1 的 trackingMode 必须是 'EXTERNAL'：若为 'CANONICAL_STRICT' 或任何其他非
    'EXTERNAL' 值，步骤 1 会先写一行宽松流水、步骤 2 再写一行严格流水，
    uq_tracked_outsourcing_identity（§26.33.4.6.1 的 C-06 修正，R3 权威索引）会在同一
    (source_type, source_id, source_item_id, identity_key, direction) 上撞唯一约束而使整个事务失败。
  · SERIAL 产品一次只能移动**一个**序列号（postCanonicalTrackedLeg 强制 qty===1）。
    数量为 q 的发料必须拆成 q 次 applyInventoryMutation（或 q 个互不相同的 source_item_id）。
  · MOVE 的两条腿必须**先 OUT 后 IN**：SERIAL 的 OUT 腿要求序列号当前为 AVAILABLE
    且 current_warehouse_id 等于来源仓（traceability-quality.js:233-235）。
  · LOT 产品的 MOVE 要求来源仓与目的仓**分别**存在批次余额；目的仓批次余额由 IN 腿建立。
```

**来源占用（source occupancy）的三重占用账**

| 占用账 | 键 | 语义 | 释放方式 |
|---|---|---|---|
| `inventory_mutation_log` | `idempotency_key` UNIQUE | 物理 mutation 的**重放**占用 | 永不释放；同键重放返回 `replayed:true` |
| `tracked_inventory_movements` + `uq_tracked_post` | (source_type, source_id, source_item_id, lot_id, serial_id, direction) WHERE reversed=0 | **【R3：已降级为附加约束；在 SQLite 上实际不提供去重】** —— 详见下方 C-06 纠正。委外身份去重的**权威**索引是新增的 `uq_tracked_outsourcing_identity` | `reverseTrackedSource` 置 `reversed=1` |
| `tracked_source_allocations` | UNIQUE(source_type, source_id, source_item_id, lot_id, serial_id, planned_lot_code, planned_serial_number) + `posted`/`reversed` | **分配占用**：普通采购/销售路径（allocation-driven 模型）的过账身份分配 | `reverseTrackedSource` 置 `reversed=1` |

- 委外路径采用**位置驱动**模型：身份来自 `fromPosition/toPosition` 的 `lotId/serialId`，**不**使用 `tracked_source_allocations` 作为身份来源。因此委外路径**不**调用 `issueSourceValue`/`receiveSourceValue`（二者强制要求 `posted=1 AND reversed=0` 的分配行，见 `financial-inventory.js:129-146`），而调用 `issueValue`/`receiveValue`（位置口径）。
- 位置驱动模型下的**冲销**依据是 `tracked_inventory_movements` 的 `reversed` 标记与 `reverseTrackedSource`，不依赖 allocation 表。
- **来源占用必须在委外退料与倒冲时被检查**：被退/被倒冲的 LOT/SERIAL 必须是**本订单曾发往供应商 WIP 仓**的身份（`tracked_inventory_movements` 中 `source_type='OUTSOURCING_ISSUE'` 且方向为该仓 IN）。现状 `assertReturnProvenance`（`traceability-quality.js:194-214`）只覆盖 `SALES_RETURN`/`PURCHASE_RETURN`，对委外来源**不生效** → 列为 `M1-D-24` 的强制实现项。

**C-06 来源占用的跨端等价性纠正（M1-D-32）**

R1 把 `uq_tracked_post` 当作"双端严格身份占用"。**该结论不成立** —— 它在两端的行为并不等价：

```text
v13-phase6b-traceability-quality.js:112
  CREATE UNIQUE INDEX uq_tracked_post ON tracked_inventory_movements(
    source_type, source_id, source_item_id, lot_id, serial_id, direction) WHERE reversed=0
```

| 引擎 | 实现路径 | 对含 NULL 身份列的行为 |
|---|---|---|
| SQLite | 原生部分唯一索引 | SQLite 的 UNIQUE 索引中，**任一**被索引列为 NULL 即视为互异。`lot_id`/`serial_id` **恒有一列为 NULL**（NONE 跟踪产品两列皆 NULL；LOT 产品 `serial_id` 为 NULL；SERIAL 产品 `lot_id` 为 NULL）→ **重复行被允许** → 在 SQLite 上 `uq_tracked_post` **实际不提供任何去重** |
| MySQL | `mysql-schema.js:445-447`：`useDigest = hasExpressionColumns(index) \|\| (index.unique && (where \|\| columns.length > 4))`；该索引 `unique && where` 成立 → 走 `generatedPartialIndex`（`:138-160`） | 生成列把 NULL `COALESCE` 成 `CHAR(30)` 后取 `SHA2` → **重复行被拒绝**（含 NULL 身份列的行**也参与**去重） |

⇒ 在 SQLite 上"身份占用"实际不存在，在 MySQL 上存在。**两者不等价**，不得据此宣称防重已保证。

**修正方案：非空身份键 + 委外来源的 `source_item_id` 强制非空（M1-D-32；R3 已补齐前置检查）**

```text
tracked_inventory_movements
  + identity_key TEXT NOT NULL DEFAULT ''      -- 'LOT:<lot_id>' | 'SERIAL:<serial_id>' | 'NONE'

CREATE UNIQUE INDEX uq_tracked_outsourcing_identity
  ON tracked_inventory_movements(source_type, source_id, source_item_id, identity_key, direction)
  WHERE source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT','OUTSOURCING_RETURN',
                        'OUTSOURCING_BACKFLUSH','OUTSOURCING_RECEIPT','OUTSOURCING_FINISHED_RETURN')
    AND reversed = 0
```

**R3 明确：`source_item_id` 的非空要求与现实**

| 事实 | 证据 | 结论 |
|---|---|---|
| `tracked_inventory_movements.source_item_id` 的 Schema **允许 NULL** | `v13-phase6b-traceability-quality.js:100`（`source_item_id TEXT`，无 NOT NULL） | 该列**本身**不可收紧为 NOT NULL（收紧需重建表，违反加性原则） |
| 生产写者会**静默**把缺失的来源行写成 NULL | `inventory-mutation.js:219` 写 `input.sourceItemId \|\| null`；`traceability-quality.js:267` 直接写 `sourceItemId` | 委外写者**必须在调用前自行断言** `sourceItemId` 非空，否则会静默产生 NULL 身份行 |
| **没有任何**生产写者使用六个委外来源类型 | 全部 `INSERT INTO tracked_inventory_movements` 位于 `inventory-mutation.js:219`、`traceability-quality.js:267/292/312/329/334/363/382`；其调用方的 `sourceType` 只有 `INVENTORY_ADJUSTMENT`/`INVENTORY_CHECK`/`PURCHASE_RECEIPT`/`SALES_DELIVERY`/`SALES_RETURN`/`PURCHASE_RETURN`/`INVENTORY_SCRAP`/`PRODUCTION_*`/`INVENTORY_TRANSFER` | 从**生产路径**看，委外来源的历史跟踪流水**应为零**；但这是**静态推断**，**不是**运行期事实 |

**R3 的处置（不假定历史为零）**

1. **新写入强制非空**：六个委外来源类型的写入，`source_item_id` **必须**是业务行 ID；委外写者在调用 `applyInventoryMutation` **之前**断言其非空，缺失即 400 `TRACKING_SOURCE_ITEM_REQUIRED`（**不得**依赖 `applyInventoryMutation` 兜底 —— 它会静默写 NULL）。
2. **M-15 建索引前的三重前置检查（任一不通过即中止迁移，fail-closed）**：

```text
PRE-A  委外来源行的 source_item_id 非空性
       SELECT COUNT(*) FROM tracked_inventory_movements
        WHERE source_type IN (六个委外来源) AND source_item_id IS NULL
       → 必须为 0；否则【中止迁移】并报告行数
PRE-B  identity_key 回填完整性
       回填后，任何委外来源行若 identity_key 与其 lot_id/serial_id 不一致
       （LOT 行必须为 'LOT:<lot_id>'；SERIAL 行必须为 'SERIAL:<serial_id>'；
         两者皆空必须为 'NONE'）→ 【中止迁移】并报告
PRE-C  重复身份预检
       SELECT source_type,source_id,source_item_id,identity_key,direction,COUNT(*) n
         FROM tracked_inventory_movements
        WHERE source_type IN (六个委外来源) AND reversed=0
        GROUP BY 1,2,3,4,5 HAVING n>1
       → 必须为空；否则【中止迁移】并报告重复组
```

3. **历史 NULL / 重复的安全处置**：**不得**自动删除历史流水，**不得**自动补写 `source_item_id`，**不得**自动改写 `identity_key` 为臆测值。迁移中止后，由**独立授权**的历史修复处置；在该处置完成前，**委外跟踪写入路径保持关闭**（feature gate），避免继续产生不可去重的行。
4. **`identity_key` 的回填**：`UPDATE tracked_inventory_movements SET identity_key = CASE WHEN lot_id IS NOT NULL THEN 'LOT:'||lot_id WHEN serial_id IS NOT NULL THEN 'SERIAL:'||serial_id ELSE 'NONE' END WHERE identity_key = ''` —— 只填空、不覆盖、不改写其他列；历史行的语义不变。
5. **唯一性方向上的双端等价性（如实记录）**：

| 方向 | SQLite | MySQL | 结论 |
|---|---|---|---|
| **重复必拒绝** | 部分唯一索引逐列精确比较，5 列全 NOT NULL ⇒ 拒绝 | `generatedPartialIndex`（`mysql-schema.js:138-160`）生成 STORED 列 `CASE WHEN <谓词> THEN SHA2(CONCAT_WS(CHAR(31), COALESCE(CAST(col AS CHAR),CHAR(30)), …),256) ELSE NULL END` + UNIQUE ⇒ 拒绝 | **等价** |
| **不同必放行** | 逐列精确比较 ⇒ 放行 | 依赖 **SHA-256 无碰撞**假设 ⇒ 放行 | **形式上不等价**（工程上可接受；MySQL 侧 5 列普通 UNIQUE 会超出本仓库的 `useDigest` 策略 —— `mysql-schema.js:445-447` 对 `columns.length > 4` 强制走摘要路径） |
| 谓词外行 | 不在部分索引内 | 摘要为 NULL，MySQL 唯一索引允许多个 NULL ⇒ 不参与 | **等价** |

6. **旧索引处置**：`uq_tracked_post` **保留不动**（不做索引删除），退化为附加约束；新的 `uq_tracked_outsourcing_identity` 承担**全部**委外身份去重职责。
7. **有效唯一性定义（R3 权威）**：对委外路径，同一 **来源行 + 物理腿 + LOT/SERIAL 身份** 只能存在**一条**未冲销流水 —— `(source_type, source_id, source_item_id, identity_key, direction)`，其中 `source_id` = **业务事件 ID**（`M1-D-31`），`source_item_id` = 业务行 ID（非空），故同一订单同一物料行的多次合法发料彼此独立。
8. **两层保障不可互相替代**：Mutation Key（`M1-D-31`）防"同一动作被重放"，身份唯一性防"同一身份被同一来源行重复过账"。
9. **诚实结论**：在本轮**未运行**数据库的条件下，"委外来源历史跟踪流水为零、且 `source_item_id` 全非空"只是**静态推断**。因此 PRE-A / PRE-B / PRE-C 三项的实测结果属于 `TECHNICAL_CONTRACT_UNPROVEN`（见 §26.33.13 的 WP-0 子项），**不得**在实测前宣称该唯一性合同已闭合。

**C-06 严格估值：VALUED 断言（M1-D-32）**

`issueValue` 在**可估值余额行不存在**且产品 `valuation_activated_at` 为 NULL 时，会**静默**返回一条 `writeLegacyMovement`（`financial-inventory.js:95`，`:110`）—— `status='LEGACY_UNVALUED'`、`value_delta_cents=0`，**不抛错**。委外路径要求成本闭合，**不得**接受这种回退。

```text
// 估值腿之后，在同一业务事务内立即断言
const issued = issueValue(db, { ..., inventoryTransactionId });
if (issued.status !== 'POSTED')
  throw new HttpError(409, '委外估值必须为 POSTED 估值事件，不得使用 LEGACY_UNVALUED 回退');
const tx = db.prepare('SELECT valuation_status FROM inventory_transactions WHERE id=?').get(inventoryTransactionId);
if (tx?.valuation_status !== 'VALUED')
  throw new HttpError(409, '委外物理流水未被标记为已估值');
```

- 两条断言**任一不满足即 409 并整体回滚**（同一外层事务）；
- `receiveValue` 同理：其 LEGACY 分支条件是 `value===0 && valuationBasis==='LEGACY_UNVALUED' && 产品未激活`（`:101`），委外路径**不得**传 `valuationBasis='LEGACY_UNVALUED'`；
- `writeMovement` 在传入 `inventoryTransactionId` 时把 `inventory_transactions.valuation_status` 置 `'VALUED'`（`financial-inventory.js:91`），因此该断言与写入是同一事务内的**读后校验**，可机械验证；
- `status='POSTED'` 且 `value_delta_cents=0` 是**允许**的（真实零成本），被拒绝的**只有** `LEGACY_UNVALUED`。

**幂等与重放（R1-01 的幂等要件）**

- `applyInventoryMutation` 的重放语义**按来源类型分叉**：
  - Consignment（`isConsignment`）：命中 `inventory_mutation_log` 后比对 `request_fingerprint` 与位置身份，**不一致 → 409** `INVENTORY_MUTATION_IDEMPOTENCY_CONFLICT`；
  - 非 Consignment（含委外）：命中后**直接返回 `{ replayed:true }`，不比对请求内容**（`inventory-mutation.js:258-261`）。
- 因此委外路径**不得**把 `inventory_mutation_log` 当作请求级幂等保证。委外 handler 必须：
  1. 先用 canonical `idempotencyReplay(db, operationType, documentId, key, fingerprint)`（`financial-controls.js:32-58`）判定重放；fingerprint 由 `requestFingerprint(...)`（`:25-30`）对**规范化后的请求体**计算；同键不同内容 → 409「同一幂等键不能用于不同请求内容」；
  2. 只有 `idempotencyReplay` 返回 `null`（首次）时才继续写；
  3. 成功后 `saveIdempotency(...)`（`:60-63`）写入结果；
  4. `applyInventoryMutation` 的 `idempotencyKey` 必须是**确定性**派生（**R4-01 更正**：`<SOURCE_TYPE>:<business_event_id>:<business_event_item_id>:<leg_seq>:<identity_key>`，见 §26.33.4.7.2；R1 的 `<ACTION>:<orderId>:<materialListId>:<legSeq>` 与 R3 的三段式**均已作废**），保证同一业务动作重试命中同一行、而同一事件内的不同业务项/身份子腿**互不撞键**；
  5. **重放时整条业务动作必须是 no-op**（业务单据行、库存、跟踪、估值、审计一律不再写）。重放命中 `applyInventoryMutation` 后 `movements[]` 为空，因此估值腿与跟踪腿也**不得**执行 —— 与 `consignment.js:241` `if (mutation.replayed) return mutation;` 同构。

**失败回滚（R1-01 的回滚要件）**

- 委外 handler 的**最外层**必须是一层 `transaction(db, work)`；`applyInventoryMutation` 在 `db.isTransaction` 为真时内联执行（`inventory-mutation.js:465-469`），`postCanonicalTrackedLeg`、`issueValue`、`receiveValue` 自身**不**开事务（纯写入），因此三者与业务单据、审计同处一个事务。
- 任一腿失败（批次不可用 / 序列号不在仓 / 库存不足 / 可估值余额不足 / 估值余额将为负）→ 抛错 → 整个事务回滚 → 业务行、`inventory`、`inventory_transactions`、`tracked_inventory_movements`、`inventory_lot_balances`、`inventory_serials`、`inventory_valuation_movements`、`inventory_valuation_balances`、`audit_logs` **同时**回滚。
- 禁止在 handler 内 `catch` 后继续。`applyInventoryMutation` 的估值分支确实吞异常（`inventory-mutation.js:381-385`），委外路径用 `valuationMode:'EXTERNAL'` **根本不进入**该分支。

**结论二（R1-02）：`valuationMode='EXTERNAL'` 会跳过内部估值，委外必须自带估值写者。**

- `applyInventoryMutation` 的估值分支条件是 `input.valuationMode !== 'EXTERNAL'`；取 `'EXTERNAL'` 时**一行估值都不写**（既不写 movement，也不写 balance）。
- 因此任何「物理已写、估值未写」的委外方案都是**成本不闭合**。本 Design 明确禁止现状形态：`outsourcing-finance.js:130-132` 直接 INSERT `inventory_transactions` + 调用 `adjustInventory`（`lib/stock.js:83-89`，只改 `inventory.quantity`）；`outsourcing-finance.js:123-124` 直接 INSERT `inventory_valuation_movements` 而**不更新** `inventory_valuation_balances` —— 后者会令两张估值表**永久不一致**。
- **委外估值写者合同（M1-D-25 / R1-02 结论）**：每条物理腿在**同一外层事务**内显式调用 canonical 写者，且必须满足四要件：

```text
① 真实 canonical 写者
   出库腿 → issueValue(db, { businessDate, productId, warehouseId, lotId?, serialId?,
                             quantity, movementType, sourceType, sourceId, sourceItemId,
                             inventoryTransactionId })
   入库腿 → receiveValue(db, { ..., valueCents, valuationBasis, ... })
   （financial-inventory.js:97-114；内部 writeMovement :78-93）
   禁止：直接 INSERT inventory_valuation_movements（不写 balance）；
   禁止：跨仓全局平均价（现状 outsourcing-finance.js:116-119 违反此条）；
   禁止：以 quantity=0 / value=0 的名义宣称成本闭合。

② 出入库数量与价值对账
   MOVE 腿：|issueValue.valueDeltaCents| == receiveValue.valueCents（成对相等，零差额）
   OUT 腿 ：无配对入库，价值随出库离开
   倒冲  ：issueValue 的数量 == 本次 backflush 增量 == backflushed_quantity 的增量
   每个余额桶的 |Σ quantity| 与 |Σ value_cents| 必须同向变动；writeMovement 在
   quantity<0 或 value<0 或 (|quantity|≈0 且 value≠0) 时抛 409（:87）。

③ Movement / Balance 双写（由 writeMovement 保证）
   每次调用必须同时产生 1 行 inventory_valuation_movements（status='POSTED'）
   与 1 次 inventory_valuation_balances 的 upsert（balance_key 由 valuation_method +
   product + warehouse + lot/serial 决定，:60-64）；并在传入 inventoryTransactionId 时
   把 inventory_transactions.valuation_status 置 'VALUED'。
   断言：Σ inventory_valuation_movements(qty,value) 必须逐桶等于
        inventory_valuation_balances 的 (quantity, value_cents) 增量。

④ 失败回滚与重放
   回滚：与 R1-01 同一外层事务；估值失败（可估值余额不足 / 余额将为负 / 期间已结）
        → 整笔回滚，物理库存与业务单据同时回滚。
   重放：命中 canonical idempotencyReplay 时**不得**再次调用 issueValue/receiveValue
        （否则重复扣减估值余额）；重放必须返回首次结果。
```

- **期间守卫**：`issueValue`/`receiveValue` 自身调用 `assertFinancialPeriodsOpen`（`financial-inventory.js:98/107`）；`applyInventoryMutation` 额外调用 `assertInventoryPeriodOpen`（`inventory-mutation.js:434-449`）与 `assertFinancialPeriodsOpen`（`:462`）。三道守卫都在同一事务内，越界抛 409，**不得** catch 后继续。

**结论三（R1-03）：真实 `SOURCE_TYPES` 注册表与委外六个动作的映射。**

`server/lib/inventory-mutation.js:47-61` 的真实集合（37 个字面量；`'OUTSOURCING_RECEIPT'` 在 `:48` 与 `:56` 重复出现一次，对 Set 语义无影响）：

```text
PURCHASE_RECEIPT, PRODUCTION_RECEIPT, OUTSOURCING_RECEIPT, SALES_DELIVERY,
OTHER_RECEIPT, OTHER_ISSUE, INVENTORY_TRANSFER, INVENTORY_STEP_TRANSFER_OUT,
INVENTORY_STEP_TRANSFER_IN, INVENTORY_STOCK_STATUS_CHANGE, INVENTORY_LOT_ADJUSTMENT,
INVENTORY_FORM_CONVERSION, INVENTORY_ASSEMBLY, INVENTORY_DISASSEMBLY,
INVENTORY_ADJUSTMENT, INVENTORY_SCRAP, INVENTORY_STOCKTAKE_DIFF, INVENTORY_BIN_MOVE,
VMI_RECEIPT, VMI_CONSUMPTION, VMI_OWNERSHIP_TRANSFER,
OUTSOURCING_ISSUE, OUTSOURCING_RETURN, OUTSOURCING_RECEIPT,
ENTRUSTED_RECEIPT, ENTRUSTED_ISSUE, BARCODE_SCAN_CONFIRM, OPENING_INVENTORY,
SALES_RETURN, SALES_RETURN_REVERSAL,
CONSIGNMENT_HANDOFF, CONSIGNMENT_SETTLEMENT, CONSIGNMENT_RETURN
```

`applyInventoryMutation` 对未注册字面量一律 `400 sourceType 不合法`（`:234`）。委外六个动作的映射与注册状态：

| 委外动作 | 目标 `sourceType` | 已注册 | 现状物理写入方式 | 必要的有界扩展 |
|---|---|---|---|---|
| 发料 Issue | `OUTSOURCING_ISSUE` | **是** | 无（`issueMaterial` 仅 2 条 SQL，零物理写入） | 无 |
| 补料 Supplement | `OUTSOURCING_SUPPLEMENT` | **否** | 无 | **必须**新增该字面量（M1-D-23） |
| 退料 Return（材料） | `OUTSOURCING_RETURN` | **是** | 无 | 无 |
| 倒冲 Backflush | `OUTSOURCING_BACKFLUSH` | **否** | 无（只改计数器 + 裸写估值流水） | **必须**新增该字面量（M1-D-23） |
| 成品收货 Finished Receipt | `OUTSOURCING_RECEIPT` | **是** | `adjustInventory` + 裸 `inventory_transactions`（非 canonical） | 改为 canonical 调用（§26.33.4.6.1/2） |
| 成品退货 Finished Return | `OUTSOURCING_FINISHED_RETURN` | **否** | 裸 `inventory_transactions` + `adjustInventory`（其 `source_type` 字面量**未注册**） | **必须**新增该字面量（M1-D-23） |

- **不得假定现有 `applyInventoryMutation()` 已支持补料、倒冲与成品退货。** 这三条路径在注册扩展落地前会被 `400 sourceType 不合法` 拒绝，因此 WP-2/WP-3 的实现必须**先**完成 `SOURCE_TYPES` 扩展（纯代码集合），再接线。
- **注册扩展的兼容性**：`SOURCE_TYPES` 是**代码级**集合（既非 schema 约束、也非 CHECK），扩展不影响历史行、不影响 SQLite/MySQL parity、**不需要 migration**；既有 37 个字面量**一个都不改**。
- **字面量一致性要求**：同一 `sourceType` 字面量必须同时用于 `applyInventoryMutation` 的 `sourceType`、`tracked_inventory_movements.source_type`、`tracked_source_allocations.source_type`（若该路径使用分配表）与 `inventory_valuation_movements.source_type`，否则身份占用（`uq_tracked_post`）与估值识别（`identityAllocations`）会跨账失配。
- **成品退货必须是独立字面量**：成品退货是**入库的镜像**（方向 OUT，来源是委外收货），与材料退料是两个不同的业务事实。若共用 `OUTSOURCING_RETURN`，`uq_tracked_post` 的身份占用会把成品退货误判为材料退料。

##### 26.33.4.7 R2 修订：来源模型、业务事件 ID 体系与权限边界

本小节是 `C-01`、`C-05`、`C-09` 的**唯一权威**结论；§26.33.1 的 `M1-D-27/M1-D-31/M1-D-35` 与 §26.33.7、§26.33.8、§26.33.9 的相关条目均指向本小节。

**C-01 通知来源的唯一兼容模型（M1-D-27；R3 已统一全文）**

**矛盾陈述（历史缺陷说明，保留以解释 R1/R2 的修正动机）**：R1/R2 的 §26.33.4.1 曾把 `receipt_notice_item_sources.purchase_order_item_id` 定义为 `TEXT NOT NULL`，同时又要求为 `purchase_order_item_id IS NULL` 的历史行生成**该列为 NULL 的占位来源行**。NOT NULL 列不能承载 NULL；若把该列放宽为可空，`UNIQUE(notice_item_id, purchase_order_item_id)` 在 **SQLite 与 MySQL 上都会因 NULL 互异而失效**，已解析行与未解析行会混在同一张表里失去保护。**R3 裁定：该 NULL 占位方案全文作废，不再出现在任何小节、迁移清单或错误表中。**

**唯一模型裁定：另设安全的未解析来源登记机制**（不采用"受控 NULL"方案）。理由：

1. `receipt_notice_item_sources` 的**必填列与唯一键列全部 NOT NULL**（逐列分类见 §26.33.4.1 的列分类表；**唯一可选列是 `delivery_schedule_id`**），每行必是一条**真实** PO 行 → `UNIQUE(notice_item_id, purchase_order_item_id)` 的两列皆非空，在 SQLite 与 MySQL 上**行为完全一致**，无需 NULL 语义差异论证；
2. "未知来源"是**另一类事实**（知道有一行通知量，但不知其 PO 归属），与"已解析来源"不是同一条记录；混表会污染来源表的不变量，也让"来源已解析"这一断言无法表达；
3. 未解析登记拥有独立的 `detected_at` / `resolution_state` / `resolution_note`，使后续**独立授权**的历史修复有可审计落点，而不必改写历史行；
4. 不放宽任何既有列的 NOT NULL，不引入新的 NULL 语义，**不编造任何历史 PO 关联**。

```text
receipt_notice_item_sources
  → DDL 唯一权威在 §26.33.4.1（本小节不重复定义，避免两处定义互斥）

receipt_notice_item_unresolved_sources   (本次新增；未解析来源登记 —— 本小节是该表的 DDL 唯一权威)
  id TEXT PRIMARY KEY,
  notice_item_id TEXT NOT NULL REFERENCES receipt_notice_items(id),
  quantity REAL NOT NULL,                          -- 该通知行中来源未知的数量
  resolution_state TEXT NOT NULL DEFAULT 'UNRESOLVED',  -- 'UNRESOLVED' | 'RESOLVED'
  resolution_note TEXT NULL,
  detected_at TEXT NOT NULL, resolved_at TEXT NULL,
  UNIQUE(notice_item_id)                           -- 每条通知行至多一条未解析登记
```

**规则（R3 修订）**

| 规则 | 行为 | 违反时 |
|---|---|---|
| R-C01-1 | 通知行的**已解析来源** = 其 `receipt_notice_item_sources` 行集合 | — |
| R-C01-2 | **只有 `resolution_state='UNRESOLVED'` 的登记才构成未解析阻断**。已解析来源与**仍未解析**登记同时存在 → 该通知行**不可转换**（来源不完整） | 409 `RECEIPT_NOTICE_SOURCE_INCOMPLETE` |
| R-C01-3 | 通知行**只有** `resolution_state='UNRESOLVED'` 的登记（无任何已解析来源） → 该通知行**不可转换**；**不得**由客户端指定 PO 行补齐 | 409 `RECEIPT_NOTICE_SOURCE_UNRESOLVED` |
| R-C01-4 | `resolution_state='RESOLVED'` 的登记**不阻断**转换，但该状态**只能**由**独立授权**的历史修复流程写入（须附 `resolution_note` 与 `resolved_at`）；**不得**由常规业务代码、迁移回填或客户端请求写入 | 越权写入 → 拒绝并审计 |
| R-C01-5 | **无已解析来源、也无未解析登记**（通知行既不在已解析表、也不在未解析登记表）→ **fail-closed 阻断**：来源事实缺失，**不得**按"无来源即无约束"放行 | 409 `RECEIPT_NOTICE_SOURCE_ABSENT` |
| R-C01-6 | 未解析登记**不得**被自动改写为已解析来源；补齐属于**独立授权**的历史修复。修复过程**不得自动猜测 PO 行**，**不得静默改写历史来源**；每个被补齐的来源必须附可审计的推导依据（`resolution_note`） | — |
| R-C01-7 | M-12 回填按"已解析 / 未解析"**分流**：已解析 → 1 行 `receipt_notice_item_sources`；未解析 → 1 行 `receipt_notice_item_unresolved_sources`（`quantity = receipt_notice_items.quantity`）。**两者都不改写 `receipt_notice_items` 的任何一行**；**任何路径都不向 `receipt_notice_item_sources` 写 NULL** | — |
| **R-C01-8** | **R4-06：`RESOLVED` 必须伴随"实际已解析来源行"** —— 置为 `RESOLVED` 时，该通知行在 `receipt_notice_item_sources` 中**必须已存在 ≥ 1 行**。**空来源集合**不得置为 `RESOLVED`（否则等于把"来源未知"改写成"来源已知"却无任何来源行） | 409 `RECEIPT_NOTICE_RESOLUTION_INCOMPLETE` |
| **R-C01-9** | **R4-06：数量必须精确对账** —— 本次置 `RESOLVED` 所写入的已解析来源行的 `allocated_quantity` 之和，**必须恰好等于**该未解析登记原 `quantity`（容差 `1e-9`）。**少一分**（未补齐）或**多一分**（超分配）都不得置为 `RESOLVED` | 409 `RECEIPT_NOTICE_RESOLUTION_INCOMPLETE` |
| **R-C01-10** | **R4-06：处置字段必填** —— 置为 `RESOLVED` 时必须同时写入**非空** `resolution_note`（可审计的推导依据）与**非空** `resolved_at`；缺任一即拒绝 | 409 `RECEIPT_NOTICE_RESOLUTION_NOTE_REQUIRED` |
| **R-C01-11** | **R4-06：常规路径不得改写状态** —— 常规业务请求、通知创建/确认/转换、**以及任何迁移回填**（含 M-12a / M-12b）**不得**把 `resolution_state` 从 `UNRESOLVED` 改为 `RESOLVED`。M-12b 恒写 `UNRESOLVED`。置 `RESOLVED` 的唯一入口是**独立授权**的历史修复流程，且该动作必须是**原子**的：写入已解析来源行 + 更新登记状态 + 写 `resolution_note` / `resolved_at` **三者在同一事务内**完成 | 越权写入 → 拒绝并审计 |
| **R-C01-12** | **R4-06：通知行数量必须被来源完整覆盖** —— 对任一通知行：`Σ(已解析来源行的 allocated_quantity) + Σ(未解析登记的 quantity) == receipt_notice_items.quantity`。任何**超额分配**都使该通知行不可转换 | 409 `RECEIPT_NOTICE_SOURCE_OVERALLOCATED` |

**多 PO 通知的表头兼容字段不会被下游当成唯一来源 —— 四条证明**

`receipt_notices.purchase_order_id` 现为单值 FK，无法表达多 PO。设计将其降级为**派生提示字段（deprecated derived hint）**：

1. **只写不读**：新代码**只写**该列（多 PO 时写按 `receipt_notice_item_sources.created_at, id` 排序的**首条**来源所属订单），**不读**它来决定来源；
2. **转换必须比对行级来源集合**：转换 handler 收到请求里的 `purchaseOrderItemId` 后，必须核对该 PO 行**属于该通知行的已解析来源集合**；不在集合内 → 409 `RECEIPT_NOTICE_SOURCE_MISMATCH`。**任何按表头取 PO 行的下游都无法通过该断言** —— 这就是"表头不能被当成唯一来源"的机械证明；
3. **确定性与可预测**：表头值由排序规则确定性派生，可重复计算；不一致只**报告**，不改写；
4. **只读对账断言**：新增只读检查 `NOTICE_HEADER_SOURCE_CONSISTENCY` —— 若 `receipt_notices.purchase_order_id` 与派生值不一致 → 记为不一致项（**只报告，不修复、不改写历史**），供业主后续独立处置。

**C-05 业务事件 ID 体系（M1-D-31）**

原设计的物理腿 `idempotencyKey = <ACTION>:<orderId>:<materialListId>:<legSeq>` **不含独立业务事件 ID**，因此同一订单、同一物料行的**第二次合法发料**会与第一次算出**同一个** Mutation Key → 命中 `inventory_mutation_log` 后，非 Consignment 路径**直接返回 `replayed:true` 且不比对请求内容**（`inventory-mutation.js:256-261`）→ 第二次发料被**静默丢弃**，物理库存少发。修正如下：

```text
标识                        生成方          稳定性                                  用途
business_event_id          服务端          每个业务事件唯一、终身不变              物理 mutation 的 source_id；Mutation Key 的主键部分
business_event_item_id     服务端          每个业务行唯一                          source_item_id
请求 Idempotency-Key       客户端          客户端重试时必须保持相同                canonical idempotencyReplay(operationType, documentId, key, fingerprint)
movement_group_id          服务端          每个业务事件恰好一个                      成对物理腿的分组（OUT/IN 同组）
物理腿 idempotencyKey      服务端派生      确定性                                  applyInventoryMutation 的 idempotencyKey
```

**一一对应规则（R4-01 更正 Mutation Key 公式）**

```text
1 业务事件  ⇒ 1 个 business_event_id = 1 个 movement_group_id
1 业务事件可含**多个业务项** ⇒ 每个业务项 1 个 business_event_item_id
1 业务项    ⇒ M 条物理腿（M ≥ 1；MOVE 为 2 条 OUT/IN，SERIAL 拆分时 M = 序列号个数）
1 条物理腿  ⇒ 1 个 Mutation Key
leg_seq：'OUT' / 'IN'（MOVE）或 '0'（单腿）
identity_key：'LOT:<lot_id>' / 'SERIAL:<serial_id>' / 'NONE'（与 §26.33.4.6.1 的身份键**同一个**定义）

Mutation Key = <SOURCE_TYPE>:<business_event_id>:<business_event_item_id>:<leg_seq>:<identity_key>
例（发料，MOVE，批次 L-4412）：
  OUTSOURCING_ISSUE:evt-7f3a:oml-9c21:OUT:LOT:L-4412
  OUTSOURCING_ISSUE:evt-7f3a:oml-9c21:IN:LOT:L-4412
例（同一事件内的第二个物料行，倒冲单腿，无跟踪）：
  OUTSOURCING_BACKFLUSH:evt-7f3a:oml-9c22:0:NONE
例（SERIAL 拆分，同一物料行的两个序列号）：
  OUTSOURCING_ISSUE:evt-7f3a:oml-9c21:OUT:SERIAL:SN-0031
  OUTSOURCING_ISSUE:evt-7f3a:oml-9c21:OUT:SERIAL:SN-0032
```

**R4-01：R3 的三段式公式为何不成立（本轮新发现）**

R3 的公式是 `<SOURCE_TYPE>:<business_event_id>:<legSeq>`，其中 `legSeq` 只取 `'OUT'` / `'IN'` / `'0'`。它**不区分同一业务事件内的多个业务项**，也不区分同一腿内的多个身份子分区。已核对源码：`confirmOutsourcingReceipt`（`outsourcing-finance.js:100-124`）的倒冲按 `for (const m of materials)` **逐个物料行**产生一条物理 OUT 腿（N 个物料行 ⇒ N 条腿，`source_item_id` 各为 `m.id`）；SERIAL 产品的一次发料必须拆成 `q` 次 `applyInventoryMutation`（`postCanonicalTrackedLeg` 强制 `qty===1`，`traceability-quality.js:247-275`）。

⇒ 在 R3 的公式下，上述 N 条腿与 q 条拆分腿会算出**同一个** Mutation Key。而 `applyInventoryMutation` 对**非 Consignment** 来源（含全部委外来源）命中 `inventory_mutation_log` 后**直接返回 `{ replayed:true }` 且不比对请求内容**（`inventory-mutation.js:258-261`）⇒ 第 2…N 条腿被**静默丢弃**，物理库存少扣。**这是 R3 未发现的真实碰撞。**

**R4-5：五字段 Mutation Key（SOURCE_TYPE + 四个区分维度）**

| 维度 | 键中的字段 | 区分什么 | 不区分会怎样 |
|---|---|---|---|
| 业务事件 | `business_event_id` | 同一订单同一物料行的**多次**合法发/退/补 | 第二次合法发料被丢弃（R2 已修，R3 保留） |
| **业务事件项** | `business_event_item_id` | 同一事件内的**多个业务项**（倒冲的 N 个物料行、收货的 N 条明细） | **R3 的缺口**：第 2…N 条腿撞键并被静默丢弃 |
| **物理腿** | `leg_seq` | MOVE 的 OUT/IN 两腿、单腿事件的 `0` | MOVE 的入库腿撞上出库腿 |
| **身份子腿** | `identity_key` | 同一腿内的多个 LOT/SERIAL 身份分区（SERIAL 拆分） | **R3 的缺口**：q 个序列号拆分成 q 条腿时撞键 |

**R4-01 的确定性要求**

- `business_event_id` 与 `business_event_item_id` 由**服务端**生成、终身稳定；生成时**必须**断言不含 `':'`（否则键的分隔不可解析）。
- `identity_key` **不得**用序号（`0/1/2`）—— 序号在重试时可能因遍历顺序变化而漂移；必须用**身份本身**（`LOT:<lot_id>` / `SERIAL:<serial_id>`），重试必然得到同一键。
- 非跟踪产品（NONE）的 `identity_key = 'NONE'`，**不得**留空字符串（`''` 是 `tracked_inventory_movements.identity_key` 的列默认值，语义是"未填充"）。
- `inventory_mutation_log.idempotency_key` 是 `TEXT NOT NULL UNIQUE`（`inventory-position-schema.js:140-151`），**无长度上限** ⇒ 长键无需散列。

**R4-01 的第二道防线：非预期重放的硬断言（不依赖键设计）**

即便键设计正确，委外写者**仍必须**机械断言物理腿数与预期一致，否则任何未来的键改动都会重新打开"静默丢弃"的洞：

```text
每条物理腿调用 applyInventoryMutation 后立即断言：
  ① mutation.replayed === false
     —— 若为 true，说明该腿撞上了 `inventory_mutation_log` 的既有行。
        只有当**整个业务事件**命中 canonical idempotencyReplay（请求级幂等）时
        才允许 replayed=true；此时整条业务动作为 no-op，**不得**继续写腿。
        否则 ⇒ 409 INVENTORY_MUTATION_UNEXPECTED_REPLAY → 整笔回滚。
  ② movements.length === 本腿预期写入的物理行数
     —— 断言"预期腿数 == 实际腿数"（例如倒冲 N 个物料行 ⇒ N 条 OUT 腿；
        SERIAL 拆分 q 个序列号 ⇒ q 条 OUT 腿）。
        不等 ⇒ 409 INVENTORY_MUTATION_LEG_COUNT_MISMATCH → 整笔回滚。
```

⇒ 两条断言共同保证："**SERIAL 拆分与多物料倒冲不可能静默重放另一条物理 mutation**"（R4-01 的核心要求）。请求级 canonical 幂等与整笔回滚**保持不变**（`idempotencyReplay` + `requestFingerprint` + 同一外层 `transaction`）。

- `source_id` **必须**是 `business_event_id`，**不得**用 `orderId` 或 `materialListId`；`source_item_id` **必须**是业务行 ID —— 且它**等于** `business_event_item_id`（两者是同一个业务行），使 `uq_tracked_outsourcing_identity`（`(source_type, source_id, source_item_id, identity_key, direction)`）在"多物料行"与"SERIAL 拆分"两种场景下都**不撞键**。
- **同键异请求必须拒绝**：请求级幂等由 canonical `idempotencyReplay` 承担 —— fingerprint 由 `requestFingerprint(...)`（`financial-controls.js:25-30`）对规范化请求体计算，同键不同内容 → 409「同一幂等键不能用于不同请求内容」（`:56`）。
- **不同键的合法新事件不得复用旧库存 Mutation**：新事件 ⇒ 新 `business_event_id` ⇒ 新 Mutation Key ⇒ 不命中旧 `inventory_mutation_log` 行；同一订单同一物料行的第 N 次发/退/补彼此完全独立。
- **重放必须整条 no-op**：命中 canonical 幂等记录 ⇒ 直接返回首次结果，业务行、物理、跟踪、估值、审计**一律不再写**（§26.33.4.6.1）。`applyInventoryMutation` 自身命中 `inventory_mutation_log` 时 `movements[]` 为空，因此跟踪腿与估值腿**不得**执行。
- 事件 ID 一旦分配即写死在业务行上；重试复用同一 `business_event_id`，因此不会因重试而产生第二条物理动作。

**C-09 委外业务权限与加工费账单权限的分离（M1-D-35）**

**现状事实（逐行核对）**：`SUPPLIER_BILL_MANAGE` 在全仓库**只出现一次** —— `server/modules/outsourcing-finance.js:14` 的 `FINANCE_PERMISSIONS`；而 `server/db.js:46-301` 的 `PERMISSIONS` 目录中**没有**该码，`server/migrations/*` 中也**没有**任何注册。因此 `allowAny(actor, ['SUPPLIER_BILL_MANAGE','OUTSOURCING_MANAGE'])` 实际**退化为只看 `OUTSOURCING_MANAGE`**（`db.js:272`）：

| 事实 | 后果 |
|---|---|
| `OUTSOURCING_MANAGE`（"管理委外订单"）已注册 | 任何持有它的用户都能**创建并过账**加工费 Supplier Bill |
| `SUPPLIER_BILL_MANAGE` 未注册 | 门禁中该项**永假**，`role-accounting` 即使想持有也无法通过目录注册 |
| `role-accounting` 的 V13 desired set（`v13-phase1-contracts.js:63-72`）含 `BILLS_VIEW/BILLS_MANAGE/AP_VIEW` 等，但**无**任何可过账委外加工费账单的权限 | 财务角色**当前无法**过账委外加工费账单 |
| `reconcileV13RolePermissions`（`:75-108`）在**每次启动**删除四个非 admin 角色中"已注册但不在 desired set"的权限行 | 新注册的权限若未进入 desired set，**每次启动都会被剥离** |
| `db.js:1748/1760-1762` 把 `PERMISSIONS` 全部授予 `role-admin` | admin 自动获得新权限 |
| `roles.js:68` 要求 ADMIN 的权限集包含 `PERMISSIONS` 的**全部** | 新增目录项会使**已保存**的 admin 权限集失效，直到重存 |

**权限边界设计**

```text
委外业务权限族（Procurement & Outsourcing Owner）
  OUTSOURCING_VIEW / OUTSOURCING_MANAGE / OUTSOURCING_RELEASE
  OUTSOURCING_MATERIAL_EXECUTE / OUTSOURCING_RECEIVING_VIEW / OUTSOURCING_RECEIVING_MANAGE
  → 覆盖：委外订单、材料发退补、委外收货与成品退货

加工费应付权限族（Finance Owner）
  SUPPLIER_BILL_MANAGE（**本次注册**）
  → 覆盖：加工费 Supplier Bill 的创建与过账
  → **不得**与 OUTSOURCING_MANAGE 通过 allowAny 混用
```

- 委外路径的加工费账单门禁改为 `allow(actor, 'SUPPLIER_BILL_MANAGE')`（**单权限**，不再 allowAny 退化）。
- `OUTSOURCING_MANAGE` **不得**创建或过账加工费账单；委外**收货生效**仍由 `OUTSOURCING_RECEIVING_MANAGE` 控制。
- **SoD**：创建/过账（Finance 侧 `SUPPLIER_BILL_MANAGE`）与收货生效（`OUTSOURCING_RECEIVING_MANAGE`）分属两个权限族，验收须断言二者不可互相替代。
- **注册与授予的兼容性（必须同时完成，缺一则授予不成立）**：
  1. 在 `PERMISSIONS` 目录（`server/db.js:46`）注册 `SUPPLIER_BILL_MANAGE`；
  2. **必须**把 `SUPPLIER_BILL_MANAGE` 加入 `V13_DESIRED_ROLE_PERMISSIONS['role-accounting']`（`v13-phase1-contracts.js:63-72`）。否则 `reconcileV13RolePermissions` 会在**每次启动**把它从 `role-accounting` 剥离，授予**不持久**。该常量是**角色合同**而非历史数据，扩展它是加性的；但它位于**已发布的 V13 migration 文件**中，实施时必须单独标注该文件的改动并取得授权；
  3. `role-accounting` 获得该权限；委外业务侧角色**不得**获得；
  4. admin 通过"授予全部"自动获得（`db.js:1760-1762`）；管理界面必须容忍 `PERMISSIONS` 目录增长（`roles.js:68` 的 ADMIN 全权限约束）。
- **待 Owner 确认（不得当作已获批准）**：完整的**角色授予矩阵**（除 `role-accounting` 外，是否需要独立的委外业务角色、该角色持有哪些 `OUTSOURCING_*`）属**业务授权决定**，本 Design 只固化"加工费账单权限与委外业务权限分离"这一**职责分离原则**与具体注册项，授予矩阵标记为 `POLICY_DECISION_PENDING`。

#### 26.33.5 State Machines and Mutation Boundaries

##### 26.33.5.1 A 组状态机

```text
收料通知 receipt_notices.status
  DRAFT ──confirm──> CONFIRMED ──cancel──> CANCELLED
  （无 CHECK 约束；取消后已转换量不回滚，仅阻断后续转换）

委外完工通知（business_type='OUTSOURCE'）额外遵守 §31.12.3 A-REQ-05 的容量不变式：
  other_reserved(notice ∉ {this}) + this_notice_qty <= open_qty
  open_qty = outsourcing_orders.order_quantity − Σ outsourcing_receipts.quantity(business_status<>'CANCELLED')
```

**E-06 修正的具体形态（M1-D-04；R1-05 已更正其数学解释）**：现状 `procurement-receiving.js:196-206`

```text
others = sumOutsourcingNoticeQty(order, ['CONFIRMED']) - thisQty     -- 确认时本单仍是 DRAFT，本单不在该 SUM 内
open   = order_quantity - alreadyReceipted
if (others + thisQty > open + 1e-9) throw 409
```

**R1-05 的数学更正**：把上式按代数展开 —— `others + thisQty = (Σ_CONFIRMED − thisQty) + thisQty = Σ_CONFIRMED`。因此：

- 比较式**并未**退化为 `0 > open`，它是一个**活着的**上限检查；
- 但被比较的总量**恰好等于 `Σ_CONFIRMED`**，即**完全遗漏本次待确认通知的数量** —— `−thisQty` 与 `+thisQty` 相互抵消，本单数量从未真正进入比较；
- 同时还遗漏另外两项：其他 `DRAFT` 通知的数量（创建期 `:158` 计入 `['DRAFT','CONFIRMED']`，确认期只算 `['CONFIRMED']`，两期口径不一致）；以及已部分转换的量（转换后同一批数量既留在通知侧、又会经收货量扣减 `open`，构成**重复扣减**）。

**修正后的单一共享断言**（创建与确认共用；落在新模块 `server/modules/procurement-notice-conversion.js`）：

```text
noticeQty(n)      = Σ receipt_notice_items.quantity WHERE notice_id = n.id
convertedQty(n)   = Σ_{s ∈ resolvedSources(n)} COALESCE(s.converted_quantity, 0)
                      -- R4-07：**来源行上的 `converted_quantity` 是权威累计值**
                      --   （新写入行由转换路径在同一事务内、锁内重读后累加）
                      --   遗留行为 NULL ⇒ COALESCE ⇒ 0 ⇒ **"未证明"，按保守方向全量预留**
reservationBase(n) = noticeQty(n) − convertedQty(n)          -- 通知尚未转化的净占用

open_qty          = order.order_quantity
                    − Σ outsourcing_receipts.quantity
                       (order_id = ? AND business_status <> 'CANCELLED')

reservedOthers    = Σ reservationBase(n)
                     WHERE n.outsourcing_order_id = ?
                       AND n.business_type = 'OUTSOURCE'
                       AND n.status IN ('DRAFT','CONFIRMED')   -- 创建前本单尚未插入；确认时显式排除本单
                       AND n.id <> thisNoticeId

assert reservedOthers + reservationBase(thisNotice) <= open_qty + 1e-9
        else 409 NOTIFY_CAPACITY_EXCEEDED
```

**R4-07：遗留"未证明转换量"的容量后果（必须诚实说明）**

遗留来源行的 `converted_quantity` 为 **NULL**（未证明），`reservationBase(n)` 因此按**通知全量**计入预留。若该通知行**实际上**已被遗留收货消耗，则同一批数量会被**同时**计入 `reservedOthers`（预留侧）与 `open_qty` 的扣减侧（经收货量）⇒ **重复扣减** ⇒ 容量被**过严地收紧**。

- ⇒ 这是**保守方向**：它只会**阻断**本可进行的转换，**不会**放行超量转换。**不得**为此写入"已证明未转换"的 `0`（那会**放宽**容量并编造事实）。
- ⇒ 该情形必须由**只读诊断** `NOTICE_LEGACY_CONVERSION_UNRESOLVED` 显式报告（列出通知行、其未解析/未证明状态与保守预留量），并通过**独立授权**的历史对账消化。
- ⇒ 本 Design **不**提供自动归属，**不**修改任何历史行，**不**把"从收货量反推转换量"写入 `converted_quantity`（历史收货与历史通知之间**没有**可证明的归属关系）。

**R4-11：行级四重上界与订单级不变式的分层（避免重复扣减）**

```text
通知行 n 的转换量 q 必须**同时**满足：

(1) 行级（§26.33.4.1 的 convert 入口，逐来源行 s 求值）
      q ≤ sourceRowRemaining(s)            -- 通知行分配剩余
      q ≤ poLineRemaining(poItem(s))       -- 有效订单行剩余
      q ≤ scheduleRemaining(schedule(s))   -- 交期/容差剩余（当 s.delivery_schedule_id 非空）
    违反 → 409（RECEIPT_NOTICE_SOURCE_EXHAUSTED /
                 RECEIPT_NOTICE_PO_LINE_EXCEEDED /
                 RECEIPT_NOTICE_SCHEDULE_EXCEEDED /
                 RECEIPT_NOTICE_SCHEDULE_CAPACITY_UNKNOWN）

(2) 订单级（OUTSOURCE 通知；本小节的不变式）
      reservedOthers + reservationBase(thisNotice) ≤ open_qty
    违反 → 409 NOTIFY_CAPACITY_EXCEEDED

(3) 委外收货自身的行级容量（outsourcing_receipt_items）
      Σ 明细.quantity == receipt.quantity，且每次收货行不得超过其来源通知行的
      未转换余量；重复转换由 `converted_quantity` 的单调累计 + 幂等键拦截
    违反 → 409（RECEIPT_NOTICE_SOURCE_EXHAUSTED）
```

⇒ **分层的意义**：(1) 回答"这一批最多还能转多少"；(2) 回答"这个订单整体还能收多少"；(3) 回答"这张收货单本身是否自洽"。三者的量纲不同、**不重复扣减**同一批数量：行级用**分配量**，订单级用**通知全量**，而分配量之和 ≤ 通知全量（由 R-C01-12 保证）。

**容量预留口径表（避免重复扣减）**

| 事实 | 是否占用订单可收量 | 计入哪一侧 |
|---|---|---|
| 通知 `DRAFT` | **是** | reserved |
| 通知 `CONFIRMED` | **是** | reserved |
| 通知 `CANCELLED` | 否 | — |
| 通知的**已转换**部分（已生成未取消的委外收货） | 是，但**只计一次** | 计入 `open_qty` 的扣减侧（经收货量），并从 `reservationBase` 中扣除 |
| 通知的**未转换**部分 | **是** | reserved |
| 委外收货 `DRAFT` / `PENDING_INSPECTION` / `EFFECTED` | **是**（实物已到，订单量已被占用） | 计入 `open_qty` 的扣减侧 |
| 委外收货 `CANCELLED` | 否 | — |

- 不变式的含义：`已收 + 已预留 ≤ order_quantity`。同一批数量**永远只被计一次** —— 未转化的通知量在 reserved 侧，已转化的量在 `open_qty` 扣减侧。
- **创建路径**：现状 `:155-164` 的 `activeNotified` 用**通知全量**（不扣已转换量），在存在部分转换时会与 `open_qty` **重复扣减**。改为调用同一个 `assertNoticeCapacity`（`reservationBase` 口径），消除两套公式。
- **确认路径**：`reservedOthers` **排除本单**（`n.id <> thisNoticeId`），本单以 `reservationBase(thisNotice)` 进入比较 —— 这正是 Requirement A-REQ-05 要求的 `other_confirmed + this_notice_qty <= open_qty` 等价安全不变式，且不再遗漏本单数量。
- **同事务内重读**：`reservedOthers`、`convertedQty`、`open_qty` 三者必须在**同一事务**内、在写入前重读（§26.33.8 的锁顺序 L1→L2），否则并发转换与并发确认之间会再次出现超发。

**委外收货状态机（M1-D-06）**：

```text
outsourcing_receipts.business_status
  DRAFT ──submit──> PENDING_INSPECTION ──effect──> EFFECTED
    │                     │
    └──cancel──> CANCELLED ◄──cancel──┘
```

| 状态 | 库存效力 | 成本证据 | 质量门禁 | 可否开加工费账单 |
|---|---|---|---|---|
| `DRAFT` | 无 | 无 | 未触发 | 否 |
| `PENDING_INSPECTION` | 无 | 无 | **已触发**；未 PASS/WAIVED 则阻断 | 否 |
| `EFFECTED` | **有**（成品入库 + 材料倒冲） | provisional | 已通过 | **是**（须满足 §26.33.10.3 容量与期间） |
| `CANCELLED` | 无（已 EFFECTED 的取消需反向单据，不在本 Design 范围） | 无 | — | 否 |

- 现状缺陷：`outsourcing_receipts.business_status` 默认值即 `'CONFIRMED'`（`:565`），且 `createOutsourcingReceipt` 直接写 `'CONFIRMED'`（`outsourcing.js:354-355`），意味着**一张刚建、未经任何质量判定的收货单立刻可开加工费账单**。本 Design 把创建写为 `DRAFT`，并新增 `submit`（触发质量门禁）与 `effect`（产生库存与成本）两个动作。
- 该列**无 CHECK 约束**，新增状态值在 SQLite/MySQL 上都无需重建表；DDL 默认值保持 `'CONFIRMED'` 不动（历史兼容），**新代码一律显式写状态**。
- `quality-gates.js:147-153` 的”可检状态”白名单已包含 `['DRAFT','CONFIRMED']`；实施时须把 `PENDING_INSPECTION` 加入该白名单（`loadQualitySource` 的 ready 状态判定），否则 IQC 无法对 `PENDING_INSPECTION` 单据建检验。**这是 `M1-F-09`**（设计发现的状态白名单缺口）。

**C-08 历史 `CONFIRMED` 收货的效力判定（M1-D-34）**

**R2 纠正**：R1 的处置是”既有 `'CONFIRMED'` 行在读取时被映射为 `EFFECTED`（读时兼容，不写回）”。**该映射不成立。** 现状 `createOutsourcingReceipt`（`outsourcing.js:344-359`）在**创建**时即写 `business_status='CONFIRMED'`，而只有 `confirmOutsourcingReceipt`（`outsourcing-finance.js:76-150`）才把它改成 `'EFFECTED'` 并写库存与成本。因此历史库中**同时存在两类** `'CONFIRMED'` 行：

| 类别 | 可核查特征 | 真实语义 |
|---|---|---|
| 创建后**从未**确认过 | 只有 `outsourcing_receipts` 行；**零** `inventory_transactions`、**零** `inventory_valuation_movements` | **未生效**（只到”建单”这一步） |
| 已被 `confirmOutsourcingReceipt` 处理过 | 有 `inventory_transactions`（`source_type='OUTSOURCING_RECEIPT'`）+ `inventory_valuation_movements`（`movement_type='OUTSOURCING_BACKFLUSH'`） | 可能已生效 |

⇒ **不得**无条件把 `'CONFIRMED'` 映射为 `'EFFECTED'`：那会让一批**从未生效**的收货单获得开票与退货资格。

**证据判定（R3 已按真实源码重写：区分「效力证据」与「成本证据」）**

**R3 复核源码后的事实更正**：历史路径 `confirmOutsourcingReceipt`（`outsourcing-finance.js:76-150`）在一次 `transaction(db, …)` 内实际写入的是：

| 写入 | 事实 | 出处 |
|---|---|---|
| 成品入库物理流水 | **1 行** `inventory_transactions`：`warehouse_id='warehouse-001'`（写死）、`product_id = outsourcing_orders.product_id`、`quantity_change = receipt.quantity`、`direction='IN'`、`source_type='OUTSOURCING_RECEIPT'`、`source_id=receiptId`、`business_date=receipt.received_date` | `:130-131` |
| 成品入库实物 | `adjustInventory(db,'warehouse-001', order.product_id, receipt.quantity, now)` → 只改 `inventory` 的 canonical 默认位置 | `:132`；`lib/stock.js:83-89` |
| 材料倒冲 | `outsourcing_material_list.backflushed_quantity += incremental`；**没有任何** `adjustInventory` / `applyInventoryMutation` ⇒ **材料实物从未被扣减** | `:121` |
| 材料倒冲估值 | N 行 `inventory_valuation_movements`：`movement_type='OUTSOURCING_BACKFLUSH'`、`source_type='OUTSOURCING_RECEIPT'`、`source_id=receiptId`、`source_item_id=materialListId`、`quantity_delta = −incremental`、`value_delta_cents = −materialValue`（跨仓全局平均价）、`warehouse_id='warehouse-001'`；**裸 INSERT，不更新 `inventory_valuation_balances`** | `:123-124` |
| 成品入库估值 | **完全没有** —— 成品入库**没有任何** `receiveValue` / `inventory_valuation_movements`（正数、`inventory_transaction_id` 指向该收货行） | 全函数无此写入 |
| 成本证据 | `outsourcing_cost_evidences` 行；由 `refreshOutsourcingCostEvidence` 在**账单过账**或**成品退货**时写入，**不是**生效动作的产物 | `:135-146`；`refreshOutsourcingCostEvidence` `:22-61` |

⇒ **R3 的关键更正**：历史收货的 `inventory_valuation_movements`（`source_id=receiptId`）**全部是材料倒冲流水**（负数量、`OUTSOURCING_BACKFLUSH`），**不是**成品入库估值证据；成品入库估值在历史路径中**必然缺失**。因此**不得**用"存在估值流水"作为历史收货的效力证据，也**不得**把材料倒冲流水当作成品入库估值证据。

```text
deriveOutsourcingReceiptEffectiveState(db, receipt):

── 效力证据（三项，缺一即 LEGACY_UNVERIFIED）──────────────────────────
E1 质量
    qualityCode = deriveQualityState(db,'IQC',receipt.id,'OUTSOURCING_RECEIPT').code
                  （canonical 质量权威；PASS / WAIVED / NOT_INSPECTED / FAIL / STALE / INSPECTION_DRAFT）
    要求 qualityCode ∈ {PASS, WAIVED}

E2 成品入库物理流水（**相符**，而非"存在"）
    流 = SELECT * FROM inventory_transactions
          WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=receipt.id
    要求：恰有 1 行，且
          direction='IN'
          AND ABS(quantity_change) == receipt.quantity
          AND product_id  == 收货所属委外订单的 product_id
          AND warehouse_id == 该收货的入库仓（历史为 'warehouse-001'；新路径为 outsourcing_receipts.warehouse_id）
          AND business_date == receipt.received_date
    并核对该行的 quantity_change 已在 `inventory` 的对应 canonical 位置生效

E3 来源明细完整（**完整**，而非"至少一条"）
    要求：Σ outsourcing_receipt_items.quantity (WHERE receipt_id=receipt.id) == receipt.quantity
          且明细行数 ≥ 1
          （历史 G-1 缺陷使大量收货的明细为空 ⇒ 该项必然不通过）

── 成本证据（**不决定效力**，但必须记录缺口）────────────────────────────
C1 成品入库估值：历史路径**必然缺失**（无正数估值流水）→ 记为 finishedGoodsValuationAbsent
C2 材料倒冲实物扣减：历史路径**必然缺失**（无 adjustInventory / 无 canonical mutation）
C3 材料倒冲估值流水：存在，但**无法与物理事实对账**（对账对象不存在）→ 只能作**弱旁证**
C4 outsourcing_cost_evidences：存在与否**不作为**效力证据（由账单过账/退货触发）
```

| 条件 | `effectiveState` | `unverifiedReason` |
|---|---|---|
| `business_status='EFFECTED'` **且** E1 ∧ E2 ∧ E3 全部成立 | `EFFECTED_CONFIRMED` | — |
| `business_status='CONFIRMED'` **且** E1 ∧ E2 ∧ E3 全部成立（历史路径中 E3 必然不通过） | `EFFECTED_CONFIRMED` | — |
| 其余全部情形 | `LEGACY_UNVERIFIED` | `NO_QUALITY_PASS` / `INVENTORY_FLOW_MISMATCH` / `INVENTORY_FLOW_ABSENT` / `SOURCE_ITEMS_INCOMPLETE` / `SOURCE_ITEMS_ABSENT` / `STATUS_CONFLICT`（按缺失项判定，优先级自上而下） |

**`business_status='EFFECTED'` 的信任前提（R3 明确）**

- 现状 `confirmOutsourcingReceipt` 的全部写入位于**同一 `transaction(db, …)`** 内 ⇒ 该状态**蕴含**事务已提交，其物理写入随之存在（SQLite/MySQL 均如此）。
- 但该推断依赖"该行由**生产路径**写入"这一前提 —— 测试夹具（L3 直接 SQL）以及人工编辑都可能写出**没有物理证据**的 `EFFECTED` 行。
- ⇒ `business_status='EFFECTED'` 是**必要非充分**条件：**必须同时**通过 E1/E2/E3 三项校验，**不得**单凭状态值判定为已生效。

**成本证据缺口的处置边界（R3 明确）**

- `EFFECTED_CONFIRMED` 只解除**库存效力**阻断，**不自动**产生可开票的**成本**依据；
- 历史收货缺失的成品入库估值与材料倒冲实物扣减（C1/C2）属于 **G-4 类**历史数据缺陷，其修复需要**独立授权**与专项设计，**不在** M1 范围，本轮**不**顺带批准；
- 在成本缺口被独立处置之前，历史收货的**成本证据**不得被用于 `OUT-21` 成本证据的闭合断言（§26.33.10.2 的 VAL-5）。

**规则**

1. **不改写历史**：`effectiveState` 是**读时派生**的只读字段，**不写回** `business_status`，**不**改写任何历史行；
2. **不开放新能力**：`LEGACY_UNVERIFIED` 收货**不得**成为加工费账单的来源行，**不得**作为成品退货的对象。门禁在**创建**加工费账单与成品退货时按 `effectiveState` 判定（**先判后写**），不是”先允许、事后核对”；
3. **来源明细必须完整**：历史收货若 `outsourcing_receipt_items` 为零行（正是 G-1 的产物），或明细数量之和不等于 `receipt.quantity`，一律归入 `LEGACY_UNVERIFIED`（`SOURCE_ITEMS_ABSENT` / `SOURCE_ITEMS_INCOMPLETE`）：它没有行级来源，无法满足 C-REQ-01 的行级可追溯要求。**"至少存在一条明细"不构成通过**；
4. **质量的默认免检是 canonical 结论，不是缺证**：`resolveQualityPolicy`（`traceability-quality.js:427-430`）在无 QCP 时对 `OUTSOURCING_RECEIPT` 返回 `inspectionRequired:false`，`deriveQualityState`（`:207-209`）在无快照时返回 `WAIVED`。因此**无 IQC 记录本身不构成不合格**，判定一律走 canonical `deriveQualityState`，本 Design 不另立质量口径；
5. **历史处置是独立授权**：把 `LEGACY_UNVERIFIED` 记录转为可开票 / 可退货状态，需要**独立授权**的历史数据修复与专项设计，**不在** M1 范围，本轮**不**顺带批准，也**不得**由读时映射变相实现；
6. **新单据不受影响**：`DRAFT` / `PENDING_INSPECTION` / `EFFECTED` 三态的新单据按状态机判定；只有**历史** `'CONFIRMED'` 才需要证据判定。
7. **成本证据不替代效力证据**（R3）：历史收货缺失的成品入库估值（C1）与材料倒冲实物扣减（C2）是 **G-4 类**历史缺陷，登记为**独立授权**范围；`EFFECTED_CONFIRMED` **不**代表成本闭合，`OUT-21` 成本断言（§26.33.10.2 VAL-5）**不得**引用这些缺口行作为证据。

##### 26.33.5.2 B 组状态机

```text
委外材料行 outsourcing_material_list（数量列，非状态机）
  发料 issue      : issued_i += q            （立即生效，无 DRAFT）
  补料 supplement  : supplemented_i += q
  退料 return      : returned_i += q
  倒冲 backflush   : backflushed_i += q
  WIP 转移 transfer: transferred_out_i += q（源行）/ transferred_in_j += q（目标行）
                     -- R4-03 更正：R2 的 `transferred_i` / `transferred_j` 写法**作废**，
                     --   权威列名只有 `transferred_out_quantity` / `transferred_in_quantity`
  supplier_wip_i = issued_i + supplemented_i − returned_i − backflushed_i
                  − transferred_out_i + transferred_in_i
  legacy_unverified_wip_quantity_i = supplier_wip_i − verified_tracked_wip_i
                                     − verified_quantity_only_wip_i
                     -- R4-6-R2：**残差定义 + 三种数量拆分**（取代 R4-6-R1 的单一
                     --   verified_identity_wip；口径见 §26.33.4.2 的 R4-6-R2 块）
  verified_tracked_wip_i = Σ_b outsourcing_wip_identity_balances(i, b).available_quantity
                     WHERE evidence_state = 'TRACKED'
                     -- R4-6-R2：LOT/SERIAL 身份证据合计
  verified_quantity_only_wip_i = Σ_b outsourcing_wip_identity_balances(i, b).available_quantity
                     WHERE evidence_state = 'QUANTITY_ONLY'
                     -- R4-6-R2：数量桶合计（**不是**身份证据）
  supplier_wip_available_i = supplier_wip_i − legacy_unverified_wip_quantity_i
                     = verified_tracked_wip_i + verified_quantity_only_wip_i
                     -- R4-03：归属不可证的历史量被隔离在**新**转移 / 新倒冲之外
```

**R4-6-R2：状态机新增证据层（B 组数量列 + 证据台账 + 分配血缘）**

```text
委外证据层 outsourcing_wip_identity_effects / _effect_allocations / _balances
  SUPPLY  effect（event_type ∈ ISSUE | SUPPLEMENT | TRANSFER_IN）
      → balances.supplied_quantity  += q；balances.available_quantity += q
  CONSUME effect（event_type ∈ RETURN | BACKFLUSH | TRANSFER_OUT）
      → balances.consumed_quantity  += q；balances.available_quantity -= q
  恒等式：available_quantity == supplied_quantity − consumed_quantity >= 0
  授权边界：负向动作必须 q <= available_quantity(identity) **且** q <= supplier_wip_available(行)
             且 **evidence_state 必须与产品 tracking_policy 匹配**（ID-INDEP-6）
  残差不变式：任何合法动作后 legacy_unverified_wip_quantity(行) 保持不变（§26.33.4.2）
  来源血缘：每个 CONSUME effect 必须有 allocation 分配到来源 SUPPLY；
             每个 TRANSFER_IN effect 必须有 TRANSFER_ORIGIN allocation **继承**源 TRANSFER_OUT 的来源构成
```

- 证据层是**只追加**台账 + 分配血缘 + 物化余额：`outsourcing_wip_identity_effects` 与 `outsourcing_wip_identity_effect_allocations` 行**永不** UPDATE / DELETE；余额行按锁内重读结果做单调的 `supplied` / `consumed` 累加。
- 证据层**不产生**物理库存、Tracking 或 Valuation 流水；它是**归属层**事实，其物理背书由同事务内的 canonical 物理腿提供（`ID-INDEP-1` 的事件类型矩阵），其来源血缘由 allocation 表提供。

**R4-6 取代旧的“五动作统一四写”概括**：五种动作必须按 §26.33.4.2 的逐动作矩阵执行，不得套用同一流程。

- Issue / Supplement / Return：业务事实 + `MOVE` 物理双腿 + 跟踪双腿 + 估值双腿在同一事务；顺序为 `applyInventoryMutation` → 每条腿 `postCanonicalTrackedLeg` → OUT `issueValue` → IN `receiveValue` → 业务计数与审计。
- Backflush：只对锁内计算的本次正增量执行业务事实 + 物理 OUT + 跟踪 OUT + `issueValue`；不得执行 IN 或 `receiveValue`。
- WIP Transfer：只写 transfer 事实、源/目标计数器与审计；**不得**调用任何物理、跟踪或估值 Writer。成本携带保持 B-P01 阻塞。

需要物理副作用的四种动作必须在同一 `transaction(db, …)` 内闭合。现状只有业务计数器或存在裸写，属于 Implementation 缺口；本 Design 不把现状描述为已闭合。

- **顺序不可换**：有物理腿时必须 `applyInventoryMutation` → `postCanonicalTrackedLeg`（逐腿）→ 对应的 `issueValue`/`receiveValue`。WIP Transfer 不进入该序列。
- **来源类型前置**：`OUTSOURCING_SUPPLEMENT` 与 `OUTSOURCING_BACKFLUSH` 必须先按 `M1-D-23` 注册，否则第 2 步即以 `400 sourceType 不合法` 失败。
- **R4-01 物理腿断言**：第 2 步之后必须断言（a）每条腿的 `mutation.replayed === false`（除整条业务事件命中 canonical 幂等的情形），（b）**实际写入腿数 == 预期腿数**。倒冲事件逐物料行产生 OUT 腿（预期 = 本次有增量倒冲的物料行数）；SERIAL 产品按序列号拆分（预期 = 序列号个数）。任一不满足 → 409 → **整笔回滚**（详见 §26.33.4.7.2 的"第二道防线"）。
- **R4-03 隔离门禁**：参与过历史转移且无身份证据的物料行（`identity_evidence_state='UNVERIFIED'`）**不得**参与**新的身份绑定**动作：
  - 新的 WIP 转移：受影响行的 `supplier_wip_available=0`，任何正数请求均 409 `WIP_TRANSFER_LEGACY_UNVERIFIED`；
  - 新的倒冲（身份绑定腿）：受影响行同样全量阻断，任何正数请求均 409 `BACKFLUSH_LEGACY_IDENTITY_UNVERIFIED`。
  - ⇒ **R4-6 收紧**：隔离量本身不得被任何负向动作消费；Return、Backflush、Transfer-Out 都先断言 `q <= supplier_wip_available`。新且可追溯的 Issue/Supplement/Transfer-In 可形成独立可用增量，但不减少隔离桶；无法区分新旧身份层时 fail closed。
  - ⇒ **R4-6-R1 再收紧（身份级授权取代数量级授权）**：负向动作**必须**同时通过**身份级**与**行级**两道断言 —— `q <= outsourcing_wip_identity_balances(material_list_id, identity_key).available_quantity` **且** `q <= supplier_wip_available(行)`。仅满足行级数量断言**不构成**授权：历史身份在身份层没有余额 ⇒ `available_quantity = 0` ⇒ 一律拒绝（`BACKFLUSH_INSUFFICIENT_VERIFIED_WIP` / `WIP_TRANSFER_LEGACY_UNVERIFIED` / `RETURN_IDENTITY_UNVERIFIED`）。行级 `identity_evidence_state='UNVERIFIED'` **不再**单独构成阻断依据（它只是残差 > 0 的派生读数）；阻断由**身份层余额**决定。
  - ⇒ **R4-6-R1 的隔离范围更正**：隔离对象由"参与过历史转移的行"扩展为"**全部无身份证据的历史行**"（残差定义，§26.33.4.2）。这是**收紧**方向的更正，理由与影响规模见 §26.33.4.2 与 `T-14`。
  - ⇒ 该隔离的**解除**属于**独立授权**的历史修复（逐身份的历史对账，且必须遵守 `ID-INDEP-4` 的残差扣除规则），**不在** M1 范围。

**倒冲差异状态机（M1-D-11）**：

```text
outsourcing_period_differences.business_status（现存 CHECK 已含四值）
  PREVIEW ──allocate──> ALLOCATED ──apply──> APPLIED
     │                      │
     └──────────────────────┴──> CANCELLED
```

- 现状：`previewOutsourcingDifference`(`outsourcing-finance.js:332`) 是**只读 POST，不写任何行**，`applyOutsourcingDifference`(`:351`) 直接写 `APPLIED`；`PREVIEW`/`ALLOCATED` **从未被写入**。
- 方向导出：`actual = issued + supplemented − returned − backflushed`；`actual < expected` → **补料候选**；`actual > expected` → **退料候选**；`actual == expected` → 无候选（apply 拒绝）。客户端**不得**指定方向（现状客户端用 `supplementQuantity`/`returnQuantity` 两个独立 `if` 自行决定方向，且二者可同时为 0 而仍写 `APPLIED`，见 `outsourcing-finance.js:364-373`）。
- 数量上限：`apply` 的数量必须 `≤ |difference|`；超限 409 `DIFFERENCE_ALLOCATION_EXCEEDS`。
- **审核（B-P02 待决）**：设计**提议**新增 `outsourcing_difference_approvals(id, difference_id, approver_id, decision, reason, decided_at)` 与 `OUTSOURCING_DIFFERENCE_APPROVE` 权限，并在 `ALLOCATED → APPLIED` 之间强制存在一条 `decision='APPROVED'` 记录。**该提议未获业务 Owner 批准**；在 `B-P02` 裁定前，`ALLOCATED → APPLIED` 的实现**不得**开始，且 `M1-GB03` 标记 **BLOCKED**。

##### 26.33.5.3 C 组状态机

```text
supplier_bills.status（现存 CHECK）
  DRAFT ──post──> POSTED ──void──> REVERSED
    └──cancel──> CANCELLED
  WAITING_MATCH ──match──> DRAFT ──post──> POSTED
```

- 委外加工费账单**必须**复用该状态机与 canonical 的 `postSupplierBill` 前置序列（`commercial-golive.js:305-308`：状态前置、`assertFinanceBusinessDateOpen`、`assertFinancialPeriodsOpen`、`supplierBillRecognitionSources` 非空）。现状 `postProcessingFeeBill`(`outsourcing-finance.js:221`) 只检查 `status !== 'DRAFT'`，其余全部缺失。
- 委外账单**不新建**取消/作废路径：canonical 的 `POST /api/supplier-bills/:id/(cancel|void)`（`commercial-golive.js:725`）按 side 分派，对委外账单同样适用（`invoiceSpec('AP')` 不按 source 类型分派）。设计**禁止**在委外模块再建一套 cancel/void。

**成品退货与贷项状态机**：

```text
outsourcing_finished_returns.business_status（无 CHECK）
  CONFIRMED（现状直接写入）──> 设计新增 DRAFT ──confirm──> CONFIRMED
```

- 现状 `createFinishedReturn`(`outsourcing-finance.js:249`) 直接以 `CONFIRMED` 落库，且**不写** `outsourcing_finished_returns.business_status` 的 CHECK。设计保持单次确认语义（退货本身不是多阶段审批），但必须补齐**期间守卫**（现状缺 `assertFinancialPeriodsOpen`）与**幂等键**。
- **R4-6-R2 明细层（R4-6-R2 权威）**：现状是**收货单级数量模型**（表头 `quantity`，**无** `outsourcing_receipt_item_id`，**无** `outsourcing_finished_return_items` 表）。TARGET CONTRACT 引入**明细级**退货：`outsourcing_finished_return_items(return_id, outsourcing_receipt_item_id, quantity)`，每条明细**唯一**对应原始委外收货明细 → PO 行 → 交期 → 原始正向交期 effect，并据此写**引用原始 effect** 的负向 effect（`reverses_effect_id = original_positive_effect.id`，`0 < q ≤ reversible_remaining`）。不可唯一归属 ⇒ `LEGACY_SCHEDULE_UNPROVEN` + 阻止交期容量授权，**不得按比例分配**。详见 §26.33.4.1 的"R4-6-R2：委外成品退货的交期反向归属修正"。
- **R4-6 贷项边界**：未计费且不触发其它政策阻塞的实物退货可以保持 `UNBILLED_NO_AP_CREDIT`；已计费退货的商业贷项分配、AP 调整、GL 凭证全部归 C-P03，裁定前在物理副作用之前 fail closed。现有按 `min(remaining, available)` 的确定性分配算法只能作为候选 helper，不能在 C-P03 前执行。
- **GL 不对称（`M1-F-10`）**：现状会用普通采购角色集生成无原始委外凭证对应的贷项凭证。R4-6 不再以“缺角色后在 GL 段失败”作为保护，因为那可能已经产生前置 AP/商业副作用；委外路径在 source-aware C-P03 门禁处提前 409，禁止调用 `createCommercialCreditNote` / `applyCreditAdjustment`。未来获批后才允许选择委外 accounting profile 与原子四层流程。

##### 26.33.5.4 D 组状态机

```text
vmi_receipts.business_status（现存 CHECK）
  PENDING ──confirm──> CONFIRMED ──transfer──> TRANSFERRED
                            └──consume──> CONFIRMED（'CONSUMED' 状态在 CHECK 中存在但从未被写入）
```

- `'CONSUMED'` 状态在 `:417` 的 CHECK 中允许，但**全仓库无任何写入**。本 Design 明确**不启用**它（启用会改变 `getVmiSummary` 的语义且无业务依据），登记为 `M1-F-11`（陈旧状态值）。
- 消耗与转移的**互斥**必须从“状态读”升级为“数量读”。设计：
  - `createVmiConsumption` 与 `transferVmiOwnership` 必须在事务内对 `vmi_receipts` 行取锁（MySQL `FOR UPDATE`）并**重读** `business_status`（现状两者都在事务外读，`procurement-vmi.js:148` / `:187`，随后才进 `transaction`）；
  - 引入**行级结算量**（**R4 更正列名**：权威列为 `vmi_settlement_lines.supplier_consumed_qty` / `enterprise_consumed_qty` / `owner_changed_qty`；R1/R3 草稿中的 `transferred_qty` 与合并的 `consumed_qty` **不是** M-09 DDL 中的列，**作废**），转移量上限 = `received_qty − supplier_consumed_qty − owner_changed_qty`（即 `M1-F-07` 恒等式的转写），**取代**现状“转移量与消耗量互相独立、都直接扣 SUPPLIER 位”的双扣路径；
  - 现状 `transferVmiOwnership` 的转移量 `body.settlementQuantity` 只受 `applyInventoryMutation` 的“库存不足”保护，**不**受任何与消耗量的约束（`procurement-vmi.js:203`）。

##### 26.33.5.5 Mutation Boundary（谁能写什么）

| 表 | 唯一允许写入者 | 委外模块可否直写 |
|---|---|---|
| `inventory` / `inventory_transactions` / `tracked_inventory_movements` / `inventory_mutation_log` | `applyInventoryMutation` | **否** |
| `inventory_valuation_movements` / `inventory_valuation_balances` | `financial-inventory.js` 的 `writeMovement`（经 `issueValue`/`receiveValue`/…） | **否** |
| `purchase_receipts` / `purchase_receipt_items` | `app.js` 的收货引擎 | **否**（转换模块只写来源列与转换记录） |
| `receipt_notices` / `receipt_notice_items` / `receipt_notice_item_sources` | `procurement-receiving.js` / `procurement-notice-conversion.js` | 是（A 组） |
| `schedule_consumption_effects` | 交期容量 canonical writer（由直接收货/通知转换/退货取消 adapter 调用） | 仅经共享 `resolveAndReserveScheduleCapacity` / reverse adapter；禁止裸 UPDATE |
| `outsourcing_receipts` / `outsourcing_receipt_items` | `outsourcing.js`（创建）/ `outsourcing-finance.js`（生效） | 是（A 组） |
| `outsourcing_finished_returns` / `outsourcing_finished_return_items` | `outsourcing-finance.js`（成品退货） | 是（C 组；**R4-6-R2**：新增明细表 `outsourcing_finished_return_items`，仅写明细级退货事实，不写物理/跟踪/估值） |
| `supplier_bills` / `supplier_bill_items` | `commercial-golive.js` / `outsourcing-finance.js`（委外加工费仅经 `createSupplierBill` 等价路径） | 仅经 canonical 路径 |
| `accounting_vouchers` / `accounting_entries` | `createSystemVoucher`（Accounting Owner） | **否**（M1-D-15 未闭合） |
| `account_payables` | `ensurePayableSource` / `ensureSubledger`（经 `recognizeFinanceExposure`） | **否**（必须经 `recognizeFinanceExposure`，M1-D-14） |
| `vmi_*` | `procurement-vmi.js` | 是（D 组） |
| `vmi_settlement_bill_allocations` | VMI settlement bill adapter（经 canonical Supplier Bill） | D-P01/D-P02 前**否**（保持空表） |
| `outsourcing_material_list` 数量列 | `outsourcing.js` 的材料/倒冲/差异动作 | 是（B 组） |
| `outsourcing_wip_identity_effects` / `outsourcing_wip_identity_effect_allocations` / `outsourcing_wip_identity_balances` | **R4-6-R1 / R4-6-R2**：委外材料证据层 writer（与材料/倒冲/差异动作同事务，由 `server/modules/outsourcing.js` 拥有） | 是（B 组，仅写证据层**归属**与**来源分配**事实，不写物理/跟踪/估值） |

#### 26.33.6 API / Handler / UI Contracts

##### 26.33.6.1 A 组

```text
POST   /api/receipt-notices                       (既有) createReceiptNotice
POST   /api/receipt-notices/:id/confirm           (既有) confirmReceiptNotice
POST   /api/receipt-notices/:id/cancel            (既有) cancelReceiptNotice
POST   /api/receipt-notices/:id/convert           (新增) convertReceiptNoticeToReceipts
       Header: Idempotency-Key（必填）
       body: { target: 'PURCHASE_RECEIPT' | 'OUTSOURCING_RECEIPT',
               items: [ { noticeItemId, allocations: [
                             { purchaseOrderItemId, quantity, deliveryScheduleId? }   -- R4-11 新增可选
                         ] } ],
               warehouseId, businessDate }
       201 -> { conversions: [ { receiptId, receiptNo, noticeId } ],
                allocated: [ { noticeItemId, purchaseOrderItemId, deliveryScheduleId,
                               quantity, convertedQuantity, scheduleBound } ] }   -- R4-11
POST   /api/purchase-receipts                     (既有) createPurchaseReceipt
       Header: Idempotency-Key（必填）
       body: { ... 每个 item 增可选 deliveryScheduleId 与 sourceNoticeItemSourceId }
POST   /api/purchase-receipts/:id/confirm         (既有) confirmPurchaseReceipt
       body: { action: 'confirm' | 'cancel' }   -- 两者是**两个** operation type（§26.33.8 矩阵）
```

> **R4-6-R1：路径与真实注册一致（§26.33.6 与 §26.33.8 的 API 集合必须逐项一致）**
>
> 本小节的 Path 一律采用 `server/app.js` 的 `ownedRouteTable.register` **实际注册路径**。本轮逐条核对后更正了三处**设计稿与真实注册不一致**的路径，并补齐了 §26.33.6 **漏列**的既有路由：
>
> | 设计稿旧写法 | 真实注册路径 | 处置 |
> |---|---|---|
> | `POST .../orders/:id/differences/preview` | `POST /api/procurement/outsourcing/orders/:id/difference-preview` | **更正**（§26.33.6.2） |
> | `POST .../orders/:id/differences/apply` | `POST /api/procurement/outsourcing/orders/:id/difference-apply` | **更正**（§26.33.6.2） |
> | `POST .../orders/:id/wip-transfers` | `POST /api/procurement/outsourcing/wip-transfers` | **更正**（§26.33.6.2） |
> | （未列） | `POST /api/purchase-receipts`、`POST /api/purchase-receipts/:id/confirm` | **补齐**（见上） |
> | （未列） | `POST /api/procurement/vmi/receipts`、`.../receipts/:id/confirm`、`.../consumptions`、`.../agreements` | **补齐**（§26.33.6.4） |
> | （未列） | `POST /api/procurement/outsourcing/finished-returns` | **补齐**（§26.33.6.3） |
>
> ⇒ §26.33.6 与 §26.33.8 的 API 集合现按 §26.33.8 的 **29 条 API 记录 / 28 个唯一 operation type / 1 组别名**对齐；本表是**路径与路由状态**权威，§26.33.8 的矩阵是**幂等语义**权威。
>
> **R4-6-R2：路由状态标注（本表是 `Route Status` 的权威）** —— 本表中**当前已注册**的路径（`server/app.js` 的 `ownedRouteTable.register` 或 `app.js` 内联分派）：`/api/receipt-notices`（GET/POST）、`/api/receipt-notices/:id/confirm`、`/api/receipt-notices/:id/cancel`、`/api/purchase-receipts`（GET/POST，内联分派 `app.js:2663-2668`）、`/api/procurement/vmi/agreements`（GET/POST）、`/api/procurement/vmi/receipts`、`/api/procurement/vmi/receipts/:id/confirm`、`/api/procurement/vmi/consumptions`、`/api/procurement/vmi/ownership-transfers`、`/api/procurement/outsourcing/orders/:id/issues|supplements|returns|backflush`、`/api/procurement/outsourcing/orders/:id/difference-preview`、`/api/procurement/outsourcing/orders/:id/difference-apply`、`/api/procurement/outsourcing/wip-transfers`、`/api/procurement/outsourcing/receipts`、`/api/procurement/outsourcing/receipts/:id/confirm`、`/api/procurement/outsourcing/processing-fee-bills`、`/api/procurement/outsourcing/processing-fee-bills/:id/post`、`/api/procurement/outsourcing/finished-returns`。
> **当前不存在、属本设计新增目标**的路径（`NEW_DESIGN_TARGET`，**不得**冒充已注册路由）：`/api/receipt-notices/:id/convert`、`/api/procurement/outsourcing/receipts/:id/submit`、`/api/procurement/outsourcing/receipts/:id/effect`、`/api/procurement/vmi/settlement-periods`、`/api/procurement/vmi/settlement-periods/:id/close`、`/api/procurement/vmi/settlement-periods/:id/bills`。
> **别名**：`/api/procurement/outsourcing/receipts/:id/confirm`（已注册）与 `/api/procurement/outsourcing/receipts/:id/effect`（新增目标）指向**同一业务操作**，共用 `OUTSOURCING_RECEIPT_EFFECT`。
> ⇒ 其余 M1 相关路由（如 `/api/procurement/outsourcing/orders`、`:id/transition`、`:id/cancel`、`:id/material-list`、`/api/reports/outsourcing/*`、`/api/procurement/outsourcing/opening-orders`）**不在 M1 幂等矩阵范围**内 —— 它们不是本 Design 的 M1 mutation 目标。

- **R4-5：交期参数可省略，但交期约束不可省略**。服务端先读取该 PO 行全部有效交期：显式 ID 必须属于该行；未传且恰好一条时按唯一性确定绑定；未传且多条时 409 `RECEIPT_NOTICE_SCHEDULE_REQUIRED`；零条时在 Owner 裁定前同样 fail closed。不得按日期、行序或数量猜测。`scheduleBound` 表示实际是否绑定并执行了上限，不表示客户端是否传参；成功响应若存在适用交期则必为 `true` 并回显实际 `deliveryScheduleId`。
- **R4-11：响应必须回显可审计的分配事实** —— `allocated[]` 至少给出 `noticeItemId` / `purchaseOrderItemId` / `deliveryScheduleId` / `quantity` / 转换后的累计 `convertedQuantity` / `scheduleBound`。这满足 A-REQ-03"转换已用数量与剩余量应可查询、可审计、可追溯"。
- **R4-5：来源行的剩余量读模型** —— 暴露 `allocatedQuantity` / `convertedQuantity` / `capacityState` / `remainingConvertible`。当 `convertedQuantity=NULL` 时，`capacityState='UNKNOWN'`、`remainingConvertible=null`，转换 409；不得展示为全额可用。
- **R4-11：同一通知行对同一 PO 行至多一条分配** —— 请求中若出现重复的 `(noticeItemId, purchaseOrderItemId)` 组合 → 400（由 `UNIQUE(notice_item_id, purchase_order_item_id)` 兜底亦可，但请求侧应给出明确错误）。

- 转换 handler 归 **新模块** `server/modules/procurement-notice-conversion.js`（`ownedRouteTable` owner 唯一，`route-table.js:151-154` 禁止 owner 为 `app.js`）。
- 转换**不**重写采购入库引擎：`POST /api/purchase-receipts`（`app.js:2664`）要求 `Idempotency-Key` Header；每个 item 新增可选 `sourceNoticeItemSourceId` 和 `deliveryScheduleId`。普通直接收货也必须提供/确定性解析交期；当存在通知来源时调用 `reserveNoticeSources(...)`，所有路径共同调用 `resolveAndReserveScheduleCapacity(...)`。`confirmPurchaseReceipt` 在库存写之前追加业务类型、通知来源一致性与交期 effect 断言。
- 委外转换目标（`target='OUTSOURCING_RECEIPT'`）：由转换 handler 直接调用 `outsourcing.js` 的新建/更新逻辑，产出 `DRAFT` 委外收货（含明细），**不**产生库存效力。
- 权限：转换用既有 `RECEIPT_NOTICE_MANAGE` + 目标侧权限（`PURCHASE_RECEIPTS_MANAGE` 或 `OUTSOURCING_RECEIVING_MANAGE`）；委外收货明细创建用 `OUTSOURCING_RECEIVING_MANAGE`。
- 幂等：转换与直接收货采用统一 `Idempotency-Key` Header，走 canonical `idempotencyReplay`/`saveIdempotency`。既有通知创建 body `idempotencyKey` 暂时保留为兼容输入，但 Header 优先；两者同时存在且不同 → 400，响应回显采用的 key 来源。不得把外部 API key 与五字段 Mutation Key 混用。

```text
POST /api/procurement/outsourcing/receipts        (既有，创建) —— 请求体新增必填 items[]
       items: [ { productId, quantity, unitCode, unitPriceCents,
                  lotId?, serialId?, processingPoItemId?, sourceNoticeItemSourceId? } ]
       201 -> { id, receiptNo, businessStatus: 'DRAFT' }
POST /api/procurement/outsourcing/receipts/:id/submit   (新增) —— 触发质量门禁 → PENDING_INSPECTION
POST /api/procurement/outsourcing/receipts/:id/effect   (新增) —— 库存 + 倒冲 + 成本证据 → EFFECTED
POST /api/procurement/outsourcing/receipts/:id/confirm  (既有 confirmOutsourcingReceipt)
       —— 语义重定义为 = effect 的别名（保留路由以兼容既有 UAT-23），但内部必须走同一事务与同一 writer
```

##### 26.33.6.2 B 组

```text
POST /api/procurement/outsourcing/orders/:id/issues     (既有 issueMaterial)
     body 变更: 移除 fromWarehouseId / toWarehouseId；新增 lotId?/serialId?/unitCode?
     201 -> { id, fromPositionKey, toPositionKey, valueCents, movementGroupId }
POST /api/procurement/outsourcing/orders/:id/supplements (既有 supplementMaterial) —— 同上
POST /api/procurement/outsourcing/orders/:id/returns    (既有 returnMaterial) —— 同上
POST /api/procurement/outsourcing/orders/:id/backflush   (既有 backflushMaterial)
     —— 重定义为“计算并过账倒冲”：写物理 OUT + issueValue + 成本证据增量
POST /api/procurement/outsourcing/orders/:id/difference-preview  (既有 preview) —— 改为落 PREVIEW 行
     **R4-6-R1**：落 PREVIEW 行 ⇒ **产生持久化副作用** ⇒ 必须有独立的 operation type / scope /
     fingerprint / 唯一约束 / 并发防重（§26.33.8 的 `OUTSOURCING_DIFFERENCE_PREVIEW`），
     **不得**再被描述为纯只读接口
POST /api/procurement/outsourcing/orders/:id/difference-apply    (既有 apply)   —— 方向由差额导出
     **R4-6-R1**：独立的 operation type `OUTSOURCING_DIFFERENCE_APPLY`，scope 与 fingerprint
     与 preview 分离（§26.33.8）
POST /api/procurement/outsourcing/wip-transfers        (既有 createWipTransfer) —— 携带成本
     **R4-6-R1 路径更正**：真实注册路径为 `/api/procurement/outsourcing/wip-transfers`
     （**不是** `/orders/:id/wip-transfers`）
     body 变更（R4-04）: 新增必填 targetMaterialListId（**显式指定目标物料行**）
     body 变更（R4-04）: 新增必填 identities[]（本次转移的 LOT/SERIAL 身份分区明细，
                       Σ 分区数量必须 == quantity；SERIAL 一次一个）
     body 变更（R4-6-R1）: 新增必填 identities[] 的每一项须带**身份数量**，
                       以便写入身份层 effect（`SUPPLY` / `CONSUME`）与余额
     201 -> { id, transferNo, sourceMaterialListId, targetMaterialListId,
             quantity, identityState:'VERIFIED', quantityAccounting:'COUNTER_ONLY' }
```

- **R4-6-R1：身份层的接线义务**：Issue / Supplement / Return / Backflush / WIP Transfer 五个动作在
  §26.33.4.2 的逐动作矩阵之外，**必须**在同一事务内写入 `outsourcing_wip_identity_effects`
  并更新 `outsourcing_wip_identity_balances`（§26.33.4.2 的"R4-6-R1 身份级 WIP 可用量模型"）。
  负向动作的身份授权（`q <= available(identity)`）是**独立于**行级数量授权的第二道断言，
  缺任一断言即不得放行。

- **R4-04：请求体的破坏性输入变更**。现状 `createWipTransfer`（`outsourcing-finance.js:387`）只接受 `sourceOrderId` / `targetOrderId` / `materialListId` / `quantity` / `transferDate`，并按 `product_id` 在目标订单内**取第一行**作为目标行（`:388`）。R4 要求：
  1. **目标物料行必须显式指定**（`targetMaterialListId`）—— 否则目标订单有多行同产品时会**静默取错行**；
  2. **身份分区必须显式提供**（`identities[]`）—— 转移不得跨 LOT/SERIAL 身份分区，且各分区数量之和必须等于 `quantity`（INV-WIP-6）；
  3. 服务端**必须**执行五项相容性门禁（产品 / UOM / 供应商 / 供应商 WIP 仓 / 身份证据），任一不满足即 409（错误码见 §26.33.11）；
  4. 服务端**必须**在**加锁并重读源物料行之后**计算 `WIP_before` 与 `supplier_wip_available`（§26.33.8 的 L2e），再判定 `q ≤ WIP_before` 且 `q ≤ supplier_wip_available`；
  5. **成本携带**仍受 `B-P01` 阻塞：`cost_cents` 保持 NULL、`cost_state='UNVERIFIED_COST'`。
- 既有调用方若仍只传旧字段 → 400（缺 `targetMaterialListId` / `identities`），**不得**回退到"按产品取第一行"的旧行为。

- **请求体字段删除是破坏性输入变更**：既有调用方若传 `fromWarehouseId` 将收到 400 `请求包含不支持的字段`（`assertAllowedFields`，`http.js:105-109`）。这是**有意的 fail-closed**，因为 Requirement B-REQ-01 禁止客户端越权指定仓位。实施时必须同步修正 `scripts/acceptance/procurement-outsourcing-functional-uat.mjs` 的 UAT-18/UAT-20 请求体。

##### 26.33.6.3 C 组（C-04 已修正过账合同）

```text
POST /api/procurement/outsourcing/processing-fee-bills       (既有 createProcessingFeeBill)
     body: { supplierId, supplierInvoiceNo(必填), billDate(必填),
             lines: [ { outsourcingReceiptItemId, quantity, unitPriceCents? } ], idempotencyKey }
     201 -> { id, billNo }
POST /api/procurement/outsourcing/processing-fee-bills/:id/post  (既有 postProcessingFeeBill；R2 重定义为 postOutsourcingProcessingFeeBill)
     当前（C-P01..C-P04 未裁定）：409 OUTSOURCING_GL_POLICY_NOT_APPROVED —— 账单保持 DRAFT，
            零 AP open item、零凭证、零分录
     裁定后：200 -> { ok: true, apOpenItemId, voucherId|null, closureState }
POST /api/procurement/outsourcing/finished-returns  (既有 createFinishedReturn)
     **R4-6-R1 补列**：成品退货是 C-REQ-04 范围内的 M1 Mutation API，必须独立登记幂等合同
     （operation type `OUTSOURCING_FINISHED_RETURN`，scope = 收货 id）；
     **负向交期 effect** 与实物库存 OUT 必须在同一事务内写入；
     C-P03 未裁定 ⇒ 实物退货 / 商业贷项 / AP 调整 / GL 凭证四层在**物理副作用之前** fail closed
     **R4-6-R2 请求体破坏性变更（CURRENT → TARGET）**：
       CURRENT（源码实际）：{ outsourcingReceiptId, quantity, returnDate, remark }
       TARGET（必须实现）  ：{ outsourcingReceiptId,
                             items: [ { outsourcingReceiptItemId, quantity } ],
                             returnDate, remark }
     每条明细必须关联真实原始收货明细、属于该收货单、累计不超原始数量、
     并唯一对应原始正向交期 effect；不可唯一归属 ⇒ 409 `OUTSOURCING_RETURN_ITEM_UNPROVEN`
     + `LEGACY_SCHEDULE_UNPROVEN`，**不得按收货数量比例分配交期**
```

- **过账被门禁阻断（C-04 的诚实表述）**：在 C-P01～C-P04 获批之前，委外加工费账单**只能创建并占用预留量，不能过账**。过账动作在 source-aware 门禁处显式失败（§26.33.4.3 ④），因此**不存在**”AP 已确认但 GL 未知”的对账盲区：委外账单不会进入 `supplier_bills.status='POSTED'` 集合，`SUPPLIER_BILL_TO_SUBLEDGER_GL` 不会因委外账单产生假 PASS 或假 FAIL。
- **`closureState` 三态**（Requirement C-REQ-02 要求区分 `AP_CLOSED` / `GL_CLOSED` / `END_TO_END_CLOSED`；R2 补第三态）：
  - `NOT_POSTED` —— 裁定前委外账单的**唯一**可能状态（账单为 DRAFT）；
  - `AP_CLOSED` —— AP 已确认、总账未闭合；
  - `AP_AND_GL_CLOSED` —— AP 与总账均闭合（`END_TO_END_CLOSED` 的等价表述）。
- `post` 的响应**显式携带** `voucherId: null` 与 `closureState`，因为在 C-P01/C-P02 裁定前不会产生委外凭证；这是对”账单已 POSTED ≠ 已有总账凭证”的显式化。
- **创建路径不受门禁影响**：`createProcessingFeeBill` 的来源校验、预留量计算、容量锁、输入校验、幂等与审计全部**可实施**（门禁只作用于过账，见 §26.33.4.3 的允许/禁止表）。

##### 26.33.6.4 D 组

```text
POST /api/procurement/vmi/agreements                 (既有 createVmiAgreement)
     —— **R4-6-R1 补列**：协议创建是 M1 Mutation API，必须独立登记幂等合同
     （operation type `VMI_AGREEMENT_CREATE`）
POST /api/procurement/vmi/receipts                   (既有 createVmiReceipt)
     —— **R4-6-R1 补列**：**VMI 收货创建**是独立 mutation API，不得因 §26.33.6.4 旧版未列入而遗漏
     （operation type `VMI_RECEIPT_CREATE`；现状只有 body `idempotencyKey` 写入
       `vmi_receipts.idempotency_key`，**无** canonical `idempotencyReplay` ⇒ R4-6-R1 要求补齐）
POST /api/procurement/vmi/receipts/:id/confirm       (既有 confirmVmiReceipt)
     —— **R4-6-R1 补列**：**VMI 收货确认**是独立 mutation API（operation type `VMI_RECEIPT_CONFIRM`）；
     状态重读必须移入事务内并加行锁（现状 `procurement-vmi.js:110` 在事务外读 `business_status`）
GET  /api/procurement/vmi/summary/:supplierId        (既有 getVmiSummary)
     —— 保留为生命周期视图（响应增加 deprecated 标记），新增：
GET  /api/procurement/vmi/settlement-periods/:id     (新增) 期间汇总
POST /api/procurement/vmi/settlement-periods         (新增) 开期（生成/重算）
POST /api/procurement/vmi/settlement-periods/:id/close (新增) 关期（强制恒等式断言）
POST /api/procurement/vmi/consumptions               (既有 createVmiConsumption)
     —— **R4-6-R1 补列**：**VMI 消耗**是独立 mutation API（operation type `VMI_CONSUMPTION`）；
     现状 `idempotencyKey: 'VMI_CONSUMPTION:' + randomUUID()`（`procurement-vmi.js:171`）
     **非确定性** ⇒ 重试会重复扣减 ⇒ 必须改为事件 ID 派生
POST /api/procurement/vmi/ownership-transfers        (既有 transferVmiOwnership)
     body 变更: 移除 settlementAmountCents 与 supplierBillId
     —— **R4-6-R1**：物权转移是独立 mutation API（operation type `VMI_OWNERSHIP_TRANSFER`）；
     现状 `idempotencyKey: 'VMI_OWNERSHIP_TRANSFER:' + randomUUID()`（`procurement-vmi.js:218`）
     同样非确定性 ⇒ 必须改为事件 ID 派生
POST /api/procurement/vmi/settlement-periods/:id/bills (新增) 按结算期生成 canonical Supplier Bill
```

- **R4-6-R1：VMI 结算期间的 `status` 语义统一（唯一权威）**
  - `vmi_settlement_periods.status` 的**真实 DDL 取值集合是 `('OPEN','CLOSED')` 两值**
    （§26.33.4.4 的 M-09 DDL：`status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN' | 'CLOSED'`）。
  - ⇒ **重叠检查的有效期间集合 = 全部期间**（`OPEN` 与 `CLOSED` **均**参与）。
    §26.33.4.4 中"同一 `agreement_id` 的**非取消期间**"的措辞 **作废** —— 本 Design **没有**
    `CANCELLED` 状态，也**不**为修正文案而新增该状态。
  - 重叠谓词（唯一权威，两端逐字一致）：
    ```text
    overlap(a, b) = a.window_start <= b.window_end AND b.window_start <= a.window_end
    ```
    对**同一 `agreement_id` 的任意两条期间**（含 `CLOSED`）求值；相邻窗口要求
    `next.window_start > previous.window_end`。
  - `CLOSED` 期间**不可重开**、**不可删除**；关闭后其窗口仍占用该协议的交叠空间 ⇒
    若后续需要"撤销一个期间"，属**新的业务政策**，本轮**不批准**、**不实现**。
  - **与 `vmi_receipts.business_status` 的区分**：`vmi_receipts` 的 CHECK 含 `'CANCELLED'`
    （`procurement-outsourcing-schema.js:417`），那是**收货单**状态，与**结算期间**状态
    是两个不同值空间，**不得**混用、不得据前者推断后者。
  - **D-P01 / D-P02 的 BLOCKED 状态不变**：本条只是**口径统一**，不构成对结算模型、
    窗口策略或部分结算的任何批准。

- `getVmiSummary` 的 `pendingSettlement = received − consumed − transferred` **不得**被当作可开票量（Requirement D-REQ-01 明文禁止）。设计**保留**该字段以兼容既有读模型，但在响应中标注 `pendingSettlementIsBillable: false`，并新增 `billableQuantity` 字段（仅在结算期已开启且 D-P01 模型已选定后有值，否则 `null`）。
- R4-6：开期请求必须携带 `agreementId/windowStart/windowEnd/periodKey` 与 `Idempotency-Key`，执行闭区间重叠检查并建立可审计 opening snapshot；首期 Owner 维度不可证即 409。`/:id/bills` 在 D-P01/D-P02 未批准前统一 409 `VMI_PARTIAL_SETTLEMENT_POLICY_PENDING`，不得因为 allocation 表存在而开放部分/多账单结算。

##### 26.33.6.5 U/T 组

- 前端契约见 §26.33.4.5 的 10 处调用点表；**不新增** `api.get`/`api.post` 兼容层（那会新建第二套 API 客户端语义）。
- `src/api.js` 不改。

#### 26.33.7 SQLite / MySQL Schema and Migration Plan

**迁移注册方式**：本仓库**没有**全局 migration 注册表（除 Sales & Customer 域的 `SALES_CUSTOMER_MIGRATIONS` 数组）。Procurement & Outsourcing 的迁移在 `server/db.js` 的 `createSqliteDatabase`（`:314-573`）中按顺序调用。**新增迁移必须**：

1. 新建 `server/migrations/m1-procurement-outsourcing-schema.js`，导出单一 `export function migrateM1ProcurementOutsourcingSchema(db)`；
2. 在 `server/db.js:5-42` import；
3. 在 `createSqliteDatabase` 中**紧接** `migrateV14OutProcurementFinalAcceptance(db)`（`:529`）之后调用 —— 因为本迁移依赖 V14 已加的 `outsourcing_order_id` / `processing_po_id` / `iqc_inspection_items.outsourcing_receipt_item_id` 等列；
4. MySQL 侧：`bootstrapMySql`（`mysql-schema.js:395-477`）从 SQLite 快照生成 DDL，`mysql-adapter.js:293-301` 会在 MySQL adapter 上重放 `createSqliteDatabase` 之外的 live additive 迁移 —— **必须确认本迁移被纳入该重放列表**，否则 SQLite 有列而 MySQL 无列（parity 破坏）。这是本 Design 强制要求 Implementation 时逐项核对的第一条 parity 断言。

**加性原则**：全部使用 `safeAddColumn`（`PRAGMA table_info` 判定，MySQL 侧被翻译为 `information_schema.columns`，`mysql-adapter.js:27-30`）与 `CREATE TABLE IF NOT EXISTS`。**禁止** `ALTER TABLE ... ADD COLUMN ... UNIQUE`（SQLite 不支持）与 `ALTER` 改 CHECK（SQLite 需重建表）。本迁移**不需要**任何表重建。

**迁移清单**

| # | 目标 | 变更 | 幂等 | SQLite/MySQL |
|---|---|---|---|---|
| M-01 | `receipt_notice_item_sources` | 新表（**已解析来源**；全部列 NOT NULL，见 §26.33.4.7.1） | `CREATE TABLE IF NOT EXISTS` | 双端 |
| M-02 | `purchase_receipts` | `+ source_notice_id TEXT` | `safeAddColumn` | 双端 |
| M-03 | `purchase_receipt_items` / `outsourcing_receipt_items` + `schedule_consumption_effects` + **R4-6-R2 新增 `outsourcing_finished_return_items`** | 两类收货行增通知来源/`delivery_schedule_id`；effect 表增 `purchase_order_item_id/source_type/source_item_id/business_event_type/business_event_id/business_event_item_id/signed_quantity/reverses_effect_id/reverses_effect_key/effect_state/idempotency_key/request_fingerprint/business_date`。`reverses_effect_key` 正向为 `''`、反向为原 effect id；唯一键为 `idempotency_key` 与全部 NOT NULL 的 `(business_event_type,business_event_id,business_event_item_id,reverses_effect_key)`，替代旧三元 UNIQUE并规避 SQLite/MySQL NULL 语义。确定性回填单交期历史收货；多/零交期与不可解析行不猜测；兼容旧 M-03 已执行状态。**R4-6-R1 扩展（P0-03）**：回填链扩展为 §26.33.4.1 的**七步**（正向 + 负向 + 绑定 + 上限校验）；负向 effect 的入账条件是"**存在真实反向库存流水**"，**不是**退货单状态；不可归属者登记 `LEGACY_SCHEDULE_UNPROVEN` 并使该 PO 行容量授权 fail closed；原始正向 effect 行**永不** UPDATE。**R4-6-R2 扩展**：新建 `outsourcing_finished_return_items`（DDL 权威见 §26.33.4.1 的 R4-6-R2 块）；**历史数据不回填**（历史退货无明细级归属，**不得**按比例拆分或推定） | `safeAddColumn` + 幂等建表/索引 + 只补缺失的确定性 `INSERT ... WHERE NOT EXISTS`；PRE-1/PRE-2/PRE-3 + BACKFILL-1/BACKFILL-2 + POST-1/POST-2/POST-3（§26.33.4.1 的时点矩阵）；`outsourcing_finished_return_items` 为 `CREATE TABLE IF NOT EXISTS` 且**零回填** | 双端；确定性 ID/排序/fingerprint parity；`LEGACY_SCHEDULE_UNPROVEN` 集合**成员**两端一致；新表列/CHECK/FK/UNIQUE 两端一致 |
| M-04 | `outsourcing_receipts` | `+ warehouse_id TEXT`、`+ source_notice_id TEXT`、`+ business_date TEXT`、`+ version INTEGER NOT NULL DEFAULT 0` | `safeAddColumn` | 双端 |
| M-05 | `outsourcing_receipt_items` | `+ lot_id TEXT`、`+ serial_id TEXT`、`+ unit_code TEXT NOT NULL DEFAULT 'EA'`、`+ processing_po_item_id TEXT`、`+ source_notice_item_source_id TEXT` | `safeAddColumn` | 双端 |
| M-06 | `outsourcing_material_list` | `+ source_warehouse_id TEXT`、**`+ transferred_out_quantity REAL NOT NULL DEFAULT 0`**、**`+ transferred_in_quantity REAL NOT NULL DEFAULT 0`**（C-02：取代 R1 的单一 `transferred_quantity`；两列均带**默认值**，故在已有数据的表上 `ADD COLUMN ... NOT NULL DEFAULT 0` 在 SQLite 与 MySQL 上都可执行）、**`+ legacy_unverified_wip_quantity REAL NOT NULL DEFAULT 0`**（R4-03：归属不可证的历史量）、**`+ identity_evidence_state TEXT NOT NULL DEFAULT 'NONE'`**（R4-03：`'NONE'`/`'UNVERIFIED'`/`'VERIFIED'`） | `safeAddColumn` | 双端 |
| M-07a | `outsourcing_wip_transfers`（**现存非空表**；先加列） | `+ source_material_list_id TEXT NULL`、`+ target_material_list_id TEXT NULL`、`+ product_id TEXT NULL`、`+ identity_json TEXT NOT NULL DEFAULT '[]'`、**`+ identity_state TEXT NOT NULL DEFAULT 'UNVERIFIED'`**（R4-03）、**`+ source_resolution_state TEXT NOT NULL DEFAULT 'UNRESOLVED'`**（R4-03）、**`+ quantity_accounting TEXT NOT NULL DEFAULT 'NETTED_IN_ISSUED'`**（R4-03）、`+ cost_cents INTEGER NULL`、`+ cost_state TEXT NOT NULL DEFAULT 'UNVERIFIED_COST'`、`+ business_date TEXT NULL`、`+ period_key TEXT NULL` —— **全部以可空或带默认值形式加入**（R3 修正：R2 的 NOT NULL 版本在 MySQL 8 严格模式下会失败、在 SQLite 上需重建表才能收紧） | `safeAddColumn` | 双端 |
| M-07b | `outsourcing_wip_transfers`（**历史回填；仅确定性可判定者**） | `target_material_list_id` := `material_list_id`（历史语义即目标行）；`product_id` := 目标行的 `outsourcing_material_list.product_id`；`source_material_list_id` := **仅当**下列四条**同时**成立时回填，否则留 NULL（R4-04 收紧）：① 源订单中**恰好一行**同 `product_id` 的物料行；② 该源行的 `unit` 与目标行 `unit` **相等**；③ 源订单与目标订单的 `supplier_id` **相等**；④ 两订单的供应商 WIP 仓**可解析且相等**（仓未配置 ⇒ 无法确认 ⇒ 不回填）；`business_date` := `transfer_date`（**仅当**匹配 `^\d{4}-\d{2}-\d{2}$`）；`period_key` := `substr(business_date,1,7)`（同条件）；`identity_json` 保持 `'[]'`、`identity_state` 保持 `'UNVERIFIED'`（**历史行无身份分区证据，不得编造**）；`source_resolution_state` := `'RESOLVED'`（当 `source_material_list_id` 已回填）否则 `'UNRESOLVED'`；`quantity_accounting` 恒为 `'NETTED_IN_ISSUED'`（**历史转移量已被净值计入 `issued_quantity`**）；`cost_cents` 保持 NULL、`cost_state` 保持 `'UNVERIFIED_COST'`（**历史转移无成本证据，不得编造**） | `UPDATE ... WHERE <目标列 IS NULL>`（**只填空、不覆盖**），按确定性排序取首条 | 双端 |
| M-07c | `outsourcing_material_list`（**R4-5 历史隔离回填**） | 按 §26.33.4.2 的 `legacyAffected(i)` 确定受影响集合；受影响且当前 `supplier_wip_i>0` 的行写 `legacy_unverified_wip_quantity := supplier_wip_i`、`identity_evidence_state := 'UNVERIFIED'`，其余写 0/`'NONE'`。禁止累计历史事件 quantity，禁止 `MAX()` 截断；未解析源扩大到保守候选集合。`transferred_out_quantity` / `transferred_in_quantity` 保持 0，不改写 `issued_quantity`。**R4-6-R1 说明**：本步的**历史含义不变**（它建立的是"参与过历史转移的行"的初始桶）；R4-6-R1 的残差扩展由**新增子步 M-07d** 承担，不改写本步 | 可重放确定性 UPDATE；PRE 检查负 WIP，POST 检查 `0≤legacy_unverified≤supplier_wip` | 双端 |
| **M-07d** | **R4-6-R1 新增子步（P0-02）；R4-6-R2 扩展**：证据层表 + 来源分配表 + 残差扩展 | ① 新建 `outsourcing_wip_identity_effects`、`outsourcing_wip_identity_effect_allocations`（**R4-6-R2 新增**）与 `outsourcing_wip_identity_balances`（DDL 权威见 §26.33.4.2 的 R4-6-R2 块）；② **历史证据层不回填**：历史发/退/补三表**无 lot_id / serial_id 列**（`procurement-outsourcing-schema.js:503-556`）⇒ 历史身份**不可证** ⇒ 证据层历史行数为 0，**不得**编造身份分区、**不得**按比例分摊、**不得**推定 LOT/SERIAL；③ 把 `legacy_unverified_wip_quantity` 由"M-07c 的独立数量"**收紧为残差**：`legacy_unverified_wip_quantity_i := supplier_wip_i − verified_tracked_wip_i − verified_quantity_only_wip_i`（历史行两者皆为 0 ⇒ 桶 = `supplier_wip_i`，**含 M-07c 未覆盖的行**）；④ `identity_evidence_state`：残差 > 0 ⇒ `'UNVERIFIED'`；残差 = 0 ⇒ `'VERIFIED'`；从未参与证据绑定动作 ⇒ `'NONE'`；**不得**因新补料而把行级状态改成 `'VERIFIED'`；⑤ **R4-6-R2**：分配表**纯新增、零历史回填**（历史无来源血缘可证） | ① `CREATE TABLE IF NOT EXISTS` × 3（纯加性，无表重建）；② ③ 确定性 `UPDATE ... WHERE <目标列> ...`，**只填空/只收紧**，不改写 `issued_quantity` 与既有 `transferred_*`；④ PRE 检查负 WIP 与证据层行数为 0、分配表行数为 0；POST 检查 `0 ≤ legacy_unverified ≤ supplier_wip` 且 `legacy_unverified == supplier_wip − verified_tracked − verified_quantity_only` **逐行成立** | 双端；两侧残差与 `identity_evidence_state` **逐行一致**；三张新表的列 / CHECK / FK / UNIQUE 两端一致（`CHECK` 由 `mysql-schema.js:204` 翻译保留） |
| M-08 | `outsourcing_difference_approvals` | 新表 | `CREATE TABLE IF NOT EXISTS` | 双端 |
| M-09 | `vmi_settlement_periods` / `vmi_settlement_lines` / `vmi_settlement_bill_allocations` | periods/lines 按 C-03 分列七量；R4-6 增首期期初证据（source/snapshot/evidence/audit ref）与独立 bill allocation 表。`bill_id` 仅兼容投影；同 agreement 窗口重叠由 agreement-scope 锁 + 闭区间谓词阻断；历史 Owner 不可证不写 0 | `CREATE TABLE IF NOT EXISTS` + 加性列/索引；不开启未批部分结算 | 双端；同一重叠谓词与 snapshot fingerprint |
| M-10 | `vmi_agreements` | `+ price_source_kind TEXT`、`+ price_value_cents INTEGER`、`+ price_list_entry_id TEXT` | `safeAddColumn` | 双端 |
| M-11 | `permissions` / `role_permissions` | `+ OUTSOURCING_DIFFERENCE_APPROVE`（**待 B-P02 批准后才可实施**） | `INSERT OR IGNORE` | 双端 |
| M-12a | 历史回填（**已解析来源**；R4-07 **逐列**指定取值来源） | `receipt_notice_item_sources` 由 `receipt_notice_items` 中 **`purchase_order_item_id IS NOT NULL`** 的行 1:1 回填。**逐列取值**：<br>`id` = **确定性派生** `'M12A-' \|\| receipt_notice_items.id`（**不用** `randomUUID` —— 迁移必须可重放且幂等）<br>`notice_item_id` = `receipt_notice_items.id`<br>`purchase_order_item_id` = `receipt_notice_items.purchase_order_item_id`（该子集恒非空）<br>`delivery_schedule_id` = **NULL**（遗留通知行**无**交期绑定证据，**不得推定**）<br>`allocated_quantity` = `receipt_notice_items.quantity`（1:1 分配）<br>`converted_quantity` = **NULL**（遗留 `purchase_receipt_items` 无 `source_notice_item_source_id`，转换量**不可证**；**不得**写 0 冒充"已证明未转换" —— R4-07）<br>`source_trace_json` = **确定性派生**（记录推导依据，不含臆造字段）<br>`business_date` = `receipt_notices.notice_date`（**权威历史业务日期**；`receipt_notices.notice_date` 为 `TEXT NOT NULL`）<br>`created_at` = `receipt_notices.created_at`（**权威历史创建时间**）<br>`updated_at` = `receipt_notices.updated_at`（**权威历史更新时间**）<br>⇒ **不写入任何迁移执行时间作为业务日期** | `INSERT ... SELECT ... WHERE NOT EXISTS`（按**唯一键** `(notice_item_id, purchase_order_item_id)` 判重；MySQL 侧子查询须包一层派生表以规避"目标表出现在 FROM"的限制） | 双端（`detected_at` 类运行时刻**不适用**于本表，故两端逐列一致） |
| M-12b | 历史回填（**未解析来源登记**；R4-07 **逐列**指定取值来源） | `receipt_notice_item_unresolved_sources` 由 `receipt_notice_items` 中 **`purchase_order_item_id IS NULL`** 的行 1:1 回填；**不推定任何 PO 关联**（C-01）。**逐列取值**：<br>`id` = **确定性派生** `'M12B-' \|\| receipt_notice_items.id`<br>`notice_item_id` = `receipt_notice_items.id`<br>`quantity` = `receipt_notice_items.quantity`<br>`resolution_state` = **常量** `'UNRESOLVED'`（**绝不为** `'RESOLVED'` —— R-C01-11）<br>`resolution_note` = **确定性派生**的溯源串（`M-12b legacy backfill: source PO line unknown`）<br>`detected_at` = **迁移执行时刻**（这是"检测到未解析"的事实时刻，**不是**业务日期；**不得**用 `receipt_notices.notice_date` 冒充检测时刻）<br>`resolved_at` = **NULL**<br>⇒ `detected_at` 是**运行时刻**而非业务事实 ⇒ **排除出 parity 断言**（两端迁移执行时刻必然不同） | `INSERT ... SELECT ... WHERE NOT EXISTS`（按 `notice_item_id` 判重，该列同时是 `UNIQUE(notice_item_id)` 的键；MySQL 侧同样包派生表） | 双端（**`detected_at` 明确排除出 parity**） |
| M-13 | 历史回填 | `outsourcing_material_list.source_warehouse_id` 由历史 `outsourcing_issues.from_warehouse_id` 推导（该订单**最早一次**发料的来源仓，按 `issued_date, id` **确定性**排序；无发料历史则留 NULL → 运行期 409 fail-closed） | **`UPDATE`（不是 INSERT）**：物料行**已存在**，只能更新目标列，且**仅当目标列当前为 NULL**；已存在的值**绝不覆盖**（C-10 修正） | 双端 |
| M-14 | `receipt_notice_item_unresolved_sources` | 新表（未解析来源登记；C-01） | `CREATE TABLE IF NOT EXISTS` | 双端 |
| M-15 | `tracked_inventory_movements` | **R4-08 更正为五步，且前置检查 fail-closed**（顺序**不可调换**）：<br>**STEP-1 PRE-A（可在加列之前运行）**：委外来源行 `source_item_id` 必须全非空 —— `SELECT COUNT(*) ... WHERE source_type IN (六个委外来源) AND source_item_id IS NULL` 必须为 0；否则【中止迁移】并报告行数。**不得**删除历史流水、**不得**补写 `source_item_id`、**不得**臆造<br>**STEP-2 加列**：`+ identity_key TEXT NOT NULL DEFAULT ''`（`'LOT:<lot_id>'` / `'SERIAL:<serial_id>'` / `'NONE'`；**仅委外写者填充**，其他写者留 `''`）<br>**STEP-3 回填**：`UPDATE ... SET identity_key = CASE WHEN lot_id IS NOT NULL THEN 'LOT:' \|\| lot_id WHEN serial_id IS NOT NULL THEN 'SERIAL:' \|\| serial_id ELSE 'NONE' END WHERE identity_key = '' AND source_type IN (六个委外来源)` —— **只填空、不覆盖**，且**限定在六个委外来源**（R4-08：不得触碰其它写者的行）<br>**STEP-4 PRE-B / PRE-C（必须在加列 + 回填之后）**：PRE-B = 回填自洽性（委外来源行的 `identity_key` 必须与其 `lot_id`/`serial_id` 一致，两列皆空必须为 `'NONE'`）；PRE-C = 委外来源 `reversed=0` 范围内无重复身份（`GROUP BY source_type,source_id,source_item_id,identity_key,direction HAVING COUNT(*)>1` 必须为空）。任一不通过【中止迁移】并报告<br>**STEP-5 建索引**：`CREATE UNIQUE INDEX uq_tracked_outsourcing_identity ON tracked_inventory_movements(source_type, source_id, source_item_id, identity_key, direction) WHERE source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT','OUTSOURCING_RETURN','OUTSOURCING_BACKFLUSH','OUTSOURCING_RECEIPT','OUTSOURCING_FINISHED_RETURN') AND reversed = 0` —— **只在 STEP-1/4 全部通过后**才可执行 | `safeAddColumn`（幂等）+ `UPDATE`（只填空）+ 索引创建；**SQLite**：`CREATE UNIQUE INDEX IF NOT EXISTS`；**MySQL**：**不得**直接写 `CREATE UNIQUE INDEX IF NOT EXISTS`（MySQL 语法不支持该子句），唯一索引由 `mysql-schema.js` 的 `generatedPartialIndex` 路径**从 SQLite 快照生成**（幂等性由快照对账器对 `information_schema` 的既有检查提供） | 双端（SQLite 部分索引 / MySQL `generatedPartialIndex` 摘要路径；"重复必拒绝"方向**等价**，"不同必放行"方向依赖 SHA-256 无碰撞假设，**形式上不等价** —— R4-09） |
| M-16 | `outsourcing_accounting_policy_scopes` + `outsourcing_accounting_policies` | scope guard 表只提供 `(side,source_type)` 并发锁；policy 表默认空，active 闭区间不得重叠，`business_date_to NULL`=无限未来；零条/多条均 fail closed；保留 `approval_ref` 与审计 | 幂等建 scope 表/已知 scope 行；政策表不得 seed 任何政策内容；写入先锁 scope 再查重叠 | 双端；不能只依赖起始日 UNIQUE |
| M-17 | `permissions` / `role_permissions` | `+ SUPPLIER_BILL_MANAGE`（C-09；**必须**与 `V13_DESIRED_ROLE_PERMISSIONS['role-accounting']` 的扩展同步实施，否则每次启动被剥离） | `INSERT OR IGNORE` | 双端 |
| M-18 | `supplier_bill_items` | **R4-10**：加工费预留的**超额**状态落地（`supplier_bill_items` **无** `created_at`/`updated_at`，故超额识别的确定性排序键用 `supplier_bills.created_at, supplier_bill_items.bill_id, supplier_bill_items.line_no, supplier_bill_items.id`）：`+ reservation_state TEXT NOT NULL DEFAULT 'NORMAL'`（`'NORMAL'` / `'OVER_RESERVED'`）、`+ over_reserved_quantity REAL NOT NULL DEFAULT 0`、`+ over_reserved_reason TEXT NULL`、`+ over_reserved_detected_at TEXT NULL` | `safeAddColumn`（四列均带**默认值**，在已有数据的表上双端可执行；**不做** NOT NULL 收紧以外的重建） | 双端 |

**R4-08：M-15 在 MySQL DDL 自动提交下的"部分完成后重试"语义**

MySQL 8 的 DDL **隐式提交**，**不**随事务回滚。因此 M-15 的任何一步失败后，**已执行的步骤不会自动撤销**。R4 明确每种中间状态下**下一次运行**的行为（全部**幂等**、**不重复写**、**不删历史**）：

| 已完成到 | 状态 | 下一次运行的行为 | 委外跟踪写入路径 |
|---|---|---|---|
| STEP-1 之前 | 未开始 | 完整执行 STEP-1 → STEP-5 | **关闭**（feature gate 未开） |
| STEP-1（PRE-A） | 只读检查已跑 | 重跑 PRE-A（纯读）→ STEP-2 | **关闭** |
| STEP-2 完成 | 列已存在 | `safeAddColumn` 判定列已存在 → **跳过**；继续 STEP-3 | **关闭** |
| STEP-3 完成 | 已回填 | 回填条件 `identity_key='' AND source_type IN (六个委外来源)` 已无匹配 → **无操作**；继续 STEP-4 | **关闭** |
| STEP-4（PRE-B/PRE-C）**失败** | 列与回填**已提交并保留** | **再次中止**（PRE-B/PRE-C 是 fail-closed 的读检查，不会自愈）；输出重复组/不一致清单，等待**独立授权**的历史修复 | **保持关闭** |
| STEP-5 完成 | 索引已存在 | 索引存在性检查通过 → **跳过**；开启 feature gate | **开启**（前提已证明） |

- **feature gate 开启条件（R4-08 硬性要求）**：委外跟踪写入路径（`postCanonicalTrackedLeg` 的委外调用）**只在**下列**全部**成立时才允许开启：① PRE-A / PRE-B / PRE-C **实测**全部通过；② `uq_tracked_outsourcing_identity` 在**当前目标库**上**确实存在**（SQLite `PRAGMA index_list`；MySQL `information_schema.statistics`）；③ 该断言在**每次启动/迁移后**重新校验。任一不成立 ⇒ 委外跟踪写入路径**保持关闭**（不得写入不可去重的行），并对外暴露只读诊断。
- **不得**用"删历史行""补写 `source_item_id`""臆造 `identity_key`"来让 PRE-A/PRE-C 通过 —— 这三条被 AGENTS.md §13 与本 Design 明确禁止。
- **SQLite 差异**：SQLite 的 DDL 是事务性的，但**本迁移不依赖其事务性**（每一步都写成可重放的幂等步骤），因此两端语义**一致**。

**不需要迁移的变更（R1 明确）**：`M1-D-23` 的 `SOURCE_TYPES` 注册扩展是**代码级集合**（`server/lib/inventory-mutation.js:47-61`），既非 schema 约束、也非 CHECK，因此**不进入本迁移清单**、**不需要** `safeAddColumn`、**不产生** SQLite/MySQL parity 差异。既有 37 个字面量一个不改；扩展只新增 `OUTSOURCING_SUPPLEMENT`、`OUTSOURCING_BACKFLUSH`、`OUTSOURCING_FINISHED_RETURN` 三个。实施顺序上，它属于 **WP-0** 的代码前置，WP-2/WP-3 在其之后接线（§26.33.4.6.3）。

**历史兼容与“不可推定来源”**（Requirement A-REQ-03 / §31.12.11 的证据纪律）：
- M-12 的回填**不删除、不改写**任何历史行，并按 R3 的统一模型**分流**：M-12a —— `receipt_notice_items.purchase_order_item_id IS NOT NULL` 的行生成 1 条 `receipt_notice_item_sources`；M-12b —— `purchase_order_item_id IS NULL` 的行生成 1 条 `receipt_notice_item_unresolved_sources`（`quantity = receipt_notice_items.quantity`）。**任何路径都不向 `receipt_notice_item_sources.purchase_order_item_id` 写 NULL**，**不**猜测 PO。
- **R4-5 对 M-12a 的权威补充**：`converted_quantity=NULL` 的遗留来源行全额占用订单级保守预留，但其正向 `remainingConvertible` 未定义且任何转换均 409 `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN`。迁移、客户端与常规业务路径均不得把 NULL 自动改成 0；独立授权、可审计的历史对账是唯一补齐入口。
- **R4-5 对 R4-07 的取代说明**：遗留行 `converted_quantity=NULL` 时，`COALESCE(NULL,0)` 只用于订单级保守预留，使通知全量继续占位；来源行可转换授权禁止 COALESCE，任何正向转换均 409 `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN`。只读诊断继续报告影响范围；不得自动归属、不得改历史、不得把 NULL 修成 0。
- M-13 的回填**不**为无发料历史的订单编造仓库；运行期遇到 NULL 一律 409。
- 既有 `outsourcing_receipts` 行**不改写** `business_status`；`DRAFT`/`PENDING_INSPECTION` 只对新单据生效。**R2 更正（C-08）**：既有 `'CONFIRMED'` 行**不再被读时映射为 `'EFFECTED'`** —— 其效力由 `§26.33.5.1` 的**证据判定**（Inventory 流水 / Valuation 流水 / canonical 质量判定 / 来源明细）得出 `EFFECTED_CONFIRMED` 或 `LEGACY_UNVERIFIED`；后者**不开放**新的账单与退货能力。这是**读时派生**，**不是**历史改写，**也不是**状态转换。

**parity 断言（Implementation 必须逐项证明）**

```text
PA-1  两端 information_schema/PRAGMA 的新增列集合完全一致
PA-2  两端新增表的列、类型、默认值、索引、CHECK 完全一致
PA-3  两端 `receipt_notice_item_sources` 的历史回填行数一致，且**逐列**一致 ——
      `id` / `notice_item_id` / `purchase_order_item_id` / `allocated_quantity` /
      `source_trace_json` / `business_date` / `created_at` / `updated_at` 必须**逐字**相同，
      `delivery_schedule_id` 必须**同为 NULL**，`converted_quantity` 必须**同为 NULL**；
      两端 `receipt_notice_item_unresolved_sources` 的回填行数一致，且
      `id` / `notice_item_id` / `quantity` / `resolution_state` / `resolution_note` 一致，
      `resolved_at` 必须**同为 NULL**。
      **明确排除**：`detected_at` 是**迁移执行时刻**（运行时刻，非业务事实），
      两端执行时刻**必然不同** ⇒ **不纳入 parity 断言**（R4-07）。
PA-4  两端 `outsourcing_material_list` 的 `transferred_out_quantity` 与 `transferred_in_quantity`
      **两列**的初值一致（均为 0），且 **M-07c 之后仍必须均为 0** ——
      **历史转移量不得被回填进这两列**（历史量已在 `issued_quantity` 内净值计入，回填即双计）；
      `legacy_unverified_wip_quantity` 与 `identity_evidence_state` 两端的回填结果
      在**同一行**上一致；并且两端的 `outsourcing_wip_transfers` 新增列在
      **同一条历史行**上回填结果一致（`target_material_list_id`、`product_id`、
      `source_material_list_id`（可空）、`business_date`（可空）、`period_key`（可空）、
      `identity_state`、`source_resolution_state`、`quantity_accounting`）——
      任一端把"无法判定"回填成具体值即视为 parity 破坏
PA-5  两端 UNIQUE 约束在业务并发下行为一致（MySQL 的 NULL 语义差异已规避：新增 UNIQUE 全部建立在 NOT NULL 列上；
      `receipt_notice_item_sources` 的唯一键 `(notice_item_id, purchase_order_item_id)` 两列皆 NOT NULL ⇒ 双端严格等价；
      **R4-11**：该唯一键**不**包含可空的 `delivery_schedule_id` —— 否则唯一键会因 NULL 互异而失效）
PA-6  **R4-6-R1（身份层）**：两端 `outsourcing_wip_identity_effects` 与 `outsourcing_wip_identity_balances`
      的**列、类型、默认值、CHECK、索引**完全一致；`CHECK` 约束由 `mysql-schema.js:204` 从 SQLite
      快照翻译保留 ⇒ 双端都强制；两端 UNIQUE / 主键全部建立在 NOT NULL 列上
      （`(event_type,business_event_id,business_event_item_id,identity_key)` 与
      `(material_list_id,identity_key)`）⇒ **不依赖 NULL 互异语义**，双端严格等价；
      M-07d 之后两端 `outsourcing_material_list` 的 `legacy_unverified_wip_quantity` 与
      `identity_evidence_state` 在**同一行**上逐字一致，且逐行满足
      `legacy_unverified_wip_quantity == supplier_wip − Σ(身份层 available_quantity)`。
      两端身份层历史行数**同为 0**（历史身份不可证，**不得**编造分区）
PA-7  **R4-6-R1（交期 effect 负向回填）**：两端 `schedule_consumption_effects` 的**成员**一致 ——
      正向 effect 集合、负向 effect 集合、`LEGACY_SCHEDULE_UNPROVEN` 集合三者的成员与数量一致；
      逐 effect 满足 `Σ negative referencing original ≤ original.signed_quantity`；
      原始正向 effect 的 `signed_quantity` / `source_item_id` / `delivery_schedule_id`
      在回填前后**逐字未变**（不被 UPDATE 覆盖）
```

#### 26.33.8 Transactions, Lock Ordering, Idempotency

**事务边界（`transaction(db, work)`，`db.js:2324-2398`）**

| 后端 | 行为 |
|---|---|
| SQLite | `BEGIN IMMEDIATE`（`:2348`）—— 写锁串行化整个库 |
| MySQL | `BEGIN IMMEDIATE` → `START TRANSACTION`（`mysql-adapter.js:39`）；**外加**全局单例门 `SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE`（`db.js:2356`），在 `work()` 之前取得、直到 COMMIT/ROLLBACK 才释放 |

- MySQL 下所有写事务因此**已经全局串行**；`FOR UPDATE` 行锁是纵深防御而非唯一保护。
- **无嵌套事务支持**：`transaction()` 无条件 BEGIN，嵌套在 SQLite 报 “cannot start a transaction within a transaction”、在 MySQL 被 admission guard 拒绝。Finance 模块用本地 `runInTransaction(db, fn)` 守卫（`finance-business-close.js:99-102`），**Procurement / Outsourcing 模块目前没有该守卫**（`procurement-receiving.js:165,192,219`、`outsourcing.js:164,203,216,231,254,272,291,320,353`、`outsourcing-finance.js:100,170,230,262,359,397` 全部直接调用）。
- **本 Design 的强制要求**：所有新增 handler 必须使用**同一个** `runInTransaction` 语义（新建 `server/lib/db-transaction.js` 导出 `runInTransaction(db, fn)`，与 Finance 的本地副本语义一致），**不得**在已有事务内再次 `transaction(db, …)`。特别是 `applyInventoryMutation` 内部在 `db.isTransaction` 为真时会**内联执行**（`inventory-mutation.js:456-459,465-469`），`postCanonicalTrackedLeg`、`issueValue`、`receiveValue` 自身**不开事务**，因此委外 handler 必须在**外层**开启事务，让库存、跟踪、估值、业务单据、审计同处一个事务（§26.33.4.6.1「失败回滚」）。

**锁顺序（Lock Ordering）**——所有多对象事务必须按同一顺序取锁，避免死锁：

```text
L1  通知/收货/账单等业务头（按 id 升序）
L2  业务行 / 来源行（按 id 升序）
    ├ L2a 通知行 receipt_notice_items（按 id 升序）        —— R4-11
    ├ L2b 来源行 receipt_notice_item_sources（按 id 升序） —— R4-11
    ├ L2c PO 行 purchase_order_items（按 id 升序）         —— R4-11
    └ L2d 交期 purchase_order_delivery_schedules（按 id 升序） —— R4-11
    └ L2e 委外物料行 outsourcing_material_list（按 id 升序）—— R4-04（WIP 转移）
    └ L2f 原正向 schedule_consumption_effect（按 id 升序）—— R4-6（反向上限）
L3  库存位（按 position_key ASC）        —— applyInventoryMutation 内部已如此（inventory-mutation.js:298-303）
L4  估值余额（按 balance_key ASC）
L5  AP open item（account_payables，按 id）
L6  结算行（vmi_settlement_lines，按 id）
L7  policy / agreement scope guard（仅创建区间时先锁 scope，再锁其子行）
```

> **R4-5 锁序扩展**：通知→入库转换仍按 **L2a → L2b → L2c → L2d**、各类按 id 升序取锁；随后在同一事务写 `schedule_consumption_effects`。普通 PO 直接收货、通知转采购入库、通知转委外收货以及取消/退货/冲销，只要消费同一 PO 行/交期容量，就必须遵循兼容的 **PO 行 → 交期行 → effect** 子序列，禁止从 effect 或交期反向取得 PO/通知锁。容量比较、effect 写入、业务收货写入与反向 effect 必须同事务原子完成。
> **R4-6 反向 effect 扩展**：取消/退货/冲销按业务头/行 → PO 行 → 交期行 → 原正向 effect → 已有负向 effects 取锁，重读 `reversible_remaining` 后写独立负向行；不得锁负向行后再回锁原正向行。普通直接收货使用 PO 行 → 交期行 → 新正向 effect 子序列。
>
> **R4-04 锁序扩展**：WIP 转移涉及**两个订单**与**两行物料**，必须按 **源订单 → 目标订单 → 源物料行 → 目标物料行** 的固定顺序取锁（跨订单对称转移时按 order_id 升序确定源/目标），避免 A→B 与 B→A 并发时的死锁。

- MySQL 行锁写法：`SELECT ... ${lockSuffix(db)}`（`sales-scope.js:43` 的既有模式：`db.dialect === 'mysql' ? ' FOR UPDATE' : ''`）。**不得**在 SQLite 上加锁后缀。
- **必须加锁而现状缺失的点**（本 Design 逐点补齐）：
  1. `vmi_receipts` 行 —— `createVmiConsumption` / `transferVmiOwnership` 的状态重读（现状在事务外读，`procurement-vmi.js:148/187`）；
  2. `outsourcing_receipt_items` 行 —— 加工费计量的容量求和（现状注释声称有行锁但**实际只有 SELECT**，`outsourcing-finance.js:189`）；
  3. `vmi_settlement_lines` 行 —— 结算防重（M1-D-17）；
  4. `receipt_notice_item_sources` 行 —— 通知→入库的容量预留（M1-D-02）；**R4-11 扩展**：同时锁定通知行（L2a）、PO 行（L2c）与交期行（L2d），并在锁定后**重读**四类容量值；
  5. **`outsourcing_material_list` 行（R4-02/R4-04 新增）** —— WIP 转移的源/目标物料行：必须在**加锁并重读**之后计算 `WIP_before` / `supplier_wip_available` / 五项相容性。现状 `createWipTransfer`（`outsourcing-finance.js:383-406`）在**事务外**读 `wipRemaining`（`:393`）⇒ 并发转移可双方通过，R4 要求改为锁内重读。

**幂等（Idempotency）**

**R4-6-R2 外部 API 幂等合同（F-04 权威矩阵；本小节取代 R4-6-R1 的 F-04 段落）**

> **R4-6-R2 授权来源**：业务所有者《R4-6-R2 Final Bounded Correction》授权本轮修正 F-04。**不是**新的 Audit / Requirement；**未**授予 Implementation 授权；**未**批准任何业务政策。
>
> **本轮三项修正**：① 增加 `Route Status` 列，**区分"当前已注册路由"与"本设计新增目标"**（R4-6-R1 曾在措辞上暗示"本矩阵所有路径均为当前真实注册路径"，本轮**禁止**该表述）；② 统一**创建类 API 的请求期 Scope**（`create-request:<normalized Idempotency-Key>`），不再使用尚未生成的随机 document id；③ Alias 路由必须共用同一 operation type、同一 scope、同一 fingerprint 规则。

**第一步：与 canonical 原语核对 scope（保持 R4-6-R1 的三元结论，本轮不变）**

| 事实 | 源码位置 |
|---|---|
| 原语签名 `idempotencyReplay(db, operationType, documentId, key, fingerprint)` | `server/modules/financial-controls.js:32` |
| 真实查询 `SELECT * FROM idempotency_records WHERE operation_type=? AND document_id=? AND idempotency_key=?` | `financial-controls.js:44` |
| 存储表 `idempotency_records(id, operation_type, document_id, idempotency_key, request_fingerprint, result_json, status, created_at, UNIQUE(operation_type,document_id,idempotency_key))` | `server/migrations/v13-phase6a-financial-controls.js:144-152` |
| MySQL 命名锁 `erp-idem-${sha256(operationType  documentId  key).slice(0,48)}` | `financial-controls.js:36` |
| 缺 `Idempotency-Key` → 400；处理中 → 503；同键异指纹 → 409 | `financial-controls.js:33/38/56` |
| `saveIdempotency` 写入 `status='SUCCEEDED'` | `financial-controls.js:60-63` |

⇒ **canonical scope = `(operation_type, document_id, idempotency_key)` 三元组**；`document_id` 是**服务端派生的聚合作用域字符串**（既有实现已用它表达复合作用域，例如 `financial-controls.js:199` 的 `${side}:${balance.id}`）。**当前既无独立的 actor 字段，也无独立的 tenant 字段**。

⇒ **R4-6 的 `(operation_type, aggregate/document id, actor/tenant scope, key)` 四元 scope 没有源码依据**，已被取代为三元 scope。**不得**在文档中保留一个源码不支持的隔离维度。

**关于 actor / tenant scope 的裁定（保持 R4-6-R1 结论，本轮不实施扩展）**

若未来确需把 actor / tenant 作为**独立隔离维度**，必须**同步扩展**下列全部载体，缺一即破坏一致性：

1. `idempotency_records` 的**存储列**（新增 `actor_id` / `tenant_id`，并**可空**以兼容既有行）；
2. `idempotency_records` 的**唯一键**（改为包含该列的全 UNIQUE，或新增第二唯一键）；
3. `idempotencyReplay` 的**查询条件**（`financial-controls.js:44`）；
4. **MySQL 命名锁的锁键**（`financial-controls.js:36`）—— 否则同键不同 actor 会互相阻塞；
5. `saveIdempotency` 的**写入列**（`financial-controls.js:60-63`）；
6. **SQLite / MySQL 双端迁移**（`safeAddColumn` 加性 + 唯一键重建策略；MySQL 侧唯一键变更需走 `mysql-schema.js` 的索引对账路径，**不得**裸 `ALTER`）；
7. **全部调用方**的 `documentId` 构造方式（现有调用点必须逐个复核）。

**本轮不实施该扩展**，也不把它登记为未决业务政策（当前**没有**任何已批准 Requirement 要求 actor 级幂等隔离）。若 Owner 后续提出，必须作为一次**独立的、有界的技术变更**处理，不得在 M1 Implementation 中夹带。

**第二步：Route Status 的取值域与判定规则（R4-6-R2 强制；只允许以下四个值）**

```text
EXISTING_REGISTERED
  = 当前 server/app.js 已实际注册，且本设计**不改变其业务行为**

EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE
  = 路由当前已实际注册，但本设计**要求改变其业务语义**
    （数量口径 / 状态机 / 副作用集合 / 请求体 / 来源关系 / 幂等合同）

NEW_DESIGN_TARGET
  = 路由当前**不存在**，本设计要求新增

ALIAS
  = 两个 URL 指向**同一业务操作**（共用 operation type、scope、fingerprint 与幂等结果）
```

⇒ **禁止**写"本矩阵所有路径均为当前真实注册路径"。下表的 `Route Status` 列**逐行**标注；**29** 条 API 记录中有 **6** 条为 `NEW_DESIGN_TARGET`（Receipt Notice Convert、Outsourcing Receipt Submit、Outsourcing Receipt Effect、VMI Settlement Period Open、VMI Settlement Period Close、VMI Settlement Bill Allocation），这些**当前不存在**，不得被描述为已注册路由。

**第三步：创建类 API 的请求期 Scope 统一规定（R4-6-R2 强制）**

**所有创建类 API 都必须在生成随机 document ID 之前完成幂等重放判断。**

```text
Idempotency-Key:
  必填 HTTP Header

Document Scope:
  create-request:<normalized Idempotency-Key>
```

**固定处理顺序**：

1. 读取并**规范化** Header（去空白、长度与字符集校验）；
2. **规范化请求体**（键排序、剔除与业务结果无关的字段）；
3. 生成 **request fingerprint**；
4. 通过 `operation_type` + `scope` + `key` 查询幂等记录；
5. **相同 fingerprint** ⇒ 返回**首次结果**；
6. **不同 fingerprint** ⇒ `409` `IDEMPOTENCY_KEY_CONFLICT`；
7. **只有首次请求**才生成随机 document ID；
8. 业务单据、明细、审计、幂等结果在**同一事务内**提交。

⇒ **不得**使用尚未生成的 `purchase_receipts.id`、`outsourcing_receipts.id`、`vmi_receipts.id`、`receipt_notices.id`、`supplier_bills.id`、`vmi_agreements.id` 作为创建请求的**唯一请求期 Scope**。
⇒ 创建后的 document ID 必须保存在**首次响应结果**中，供后续重放复用（重放直接返回首次结果，不重新生成）。
⇒ **业务唯一性约束与请求幂等约束必须分开**：前者（如 `supplier_bills.idempotency_key` UNIQUE、收货行号唯一）表达业务事实唯一性；后者（`idempotency_records`）表达请求重放防护。二者不得互相替代。

**第四步：非创建类 API 的 Scope（保持稳定业务聚合 ID，不得为统一而破坏锁范围）**

| 类别 | Document Scope | 说明 |
|---|---|---|
| 单据状态变更 | **document ID**（通知 id / 收货 id / 账单 id / 期间 id） | 路径中已存在，天然稳定 |
| WIP 动作（issue / supplement / return / backflush / difference） | **委外订单 ID** | 路径中已存在 |
| WIP Transfer | **source order ID + target order ID** | 归属再分配涉及两个聚合 |
| VMI Consumption | **VMI receipt ID** | 路径/请求中的既有收货 id |
| 交期反向（退货 / 冲销） | **原始 effect ID** | 反向事实锚定在原始正向 effect 上 |
| 差异 Apply | **委外订单 ID** | 与 Preview 共用订单聚合，二者靠 operation type 区分 |

⇒ **不能为了统一而破坏已有业务锁范围**：非创建类 API **不得**改用 `create-request:<key>` scope，因为那会让两个不同订单上的并发动作共享同一个 scope，从而破坏 §26.33.8 的锁序与容量断言。

**第五步：Alias 路由规则（R4-6-R2 强制）**

委外收货的两个 URL：

```text
POST /api/procurement/outsourcing/receipts/:id/effect    (NEW_DESIGN_TARGET)
POST /api/procurement/outsourcing/receipts/:id/confirm   (已注册，保留为别名)
```

**若二者保持别名关系**，则必须同时满足：

- 共用 `OUTSOURCING_RECEIPT_EFFECT`（**同一** operation type）；
- 共用**同一个** document scope（收货 id）；
- 共用**同一个** fingerprint 规则；
- **第二次调用必须命中首次结果**（返回 `replayed: true` + 首次响应）；
- **不得重复执行**倒冲、成品入库、估值写入或交期 effect。

**第六步：Difference Preview 的性质（R4-6-R2 明确）**

**CURRENT IMPLEMENTATION（源码实际行为）**：`previewOutsourcingDifference`（`server/modules/outsourcing-finance.js:332-349`）是**只读** POST —— 它 `SELECT` 物料行并 `send(res, 200, { preview: items })`，**不写任何行**。

**R4-6-R1 / R4-6-R2 的 TARGET CONTRACT**：

```text
Preview → 持久化 PREVIEW 行
Apply   → PREVIEW 转为 APPLIED
```

⇒ 这是**未来实现的行为变化**，**不得**声称当前代码已经具备持久化 `PREVIEW` 行的行为。
⇒ Preview 因为写入 `PREVIEW` 行，**是 Mutation API**。
⇒ Preview 与 Apply 使用**不同**的 operation type（`OUTSOURCING_DIFFERENCE_PREVIEW` / `OUTSOURCING_DIFFERENCE_APPLY`）。
⇒ **Preview 重放不能重复生成预览记录**（同一 order + period + material + 预览序号的预览行唯一）。
⇒ **Apply 只能消费合法且未应用的 PREVIEW**（`business_status='PREVIEW'` 且未被任何 APPLIED 引用）。

**第七步：通用列取值（每行都重复写出，不依赖读者跳转）**

- **Key**：`Idempotency-Key` Header（**必填**，缺 → 400）；既有 body `idempotencyKey` 作为**兼容输入**暂留，Header 优先，二者同时存在且不同 → 400；**不得**新增 body-only 合同。
- **Fingerprint**：`requestFingerprint(规范化请求体)`（`financial-controls.js:25-30`，键排序 + SHA-256），**必须覆盖全部影响业务 / 经济结果的字段**。
- **Unique**：`idempotency_records UNIQUE(operation_type, document_id, idempotency_key)`（`v13-phase6a-financial-controls.js:149`）**＋** 该 API 自身的业务事实唯一键。
- **Replay**：同 key + 同 fingerprint → `200` + `replayed: true` + **首次结果**（不重放副作用）。
- **Conflict**：同 key + 不同 fingerprint → `409` `IDEMPOTENCY_KEY_CONFLICT`；**不得**返回首次结果。
- **Concurrency**：MySQL 命名锁 `erp-idem-<sha256 前 48>`（`financial-controls.js:36-38`），获取失败 → `503`；业务层另加行锁 / 唯一约束双保险。
- **Rollback**：`saveIdempotency` 与业务写入**同事务**（`financial-controls.js:60-63`）⇒ 事务失败时**不留下**虚假的成功记录；业务行、库存、估值、审计同时回滚。

**A 组：收料通知 / 采购入库**

| API | Route Status | Mutation | Operation Type | Document Scope | Key | Fingerprint | Unique | Replay | Conflict | Concurrency | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST /api/receipt-notices` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写 `receipt_notices` / `_items`） | `RECEIPT_NOTICE_CREATE` | **`create-request:<normalized Idempotency-Key>`** | Header（必填）；兼容 body `idempotencyKey` | 规范化请求体：supplier / warehouse / businessType / items[] / noticeDate | `idempotency_records` UNIQUE + `receipt_notices.idempotency_key` UNIQUE | `200` + `replayed:true` + 首次 `{id, noticeNo}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + `receipt_notices.idempotency_key` UNIQUE | 事务内不写 `idempotency_records`；通知与明细原子回滚；document id 在**首次响应**中返回 |
| `POST /api/receipt-notices/:id/confirm` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（`status` DRAFT→CONFIRMED + 容量断言） | `RECEIPT_NOTICE_CONFIRM` | `receipt_notices.id` | Header（必填） | 规范化请求体（当前无业务入参 ⇒ 空对象摘要） | `idempotency_records` UNIQUE + `receipt_notices.status` 状态守卫 | `200` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 通知行锁 + `assertNoticeCapacity` 锁内重读 | 状态与容量断言失败 ⇒ 整笔回滚，不写幂等记录 |
| `POST /api/receipt-notices/:id/cancel` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（`status` DRAFT→CANCELLED） | `RECEIPT_NOTICE_CANCEL` | `receipt_notices.id` | Header（必填） | 规范化请求体 | `idempotency_records` UNIQUE + 状态守卫（仅 DRAFT 可取消） | `200` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 通知行锁 | 整笔回滚；**取消不恢复通知来源容量**（T-11 fail closed） |
| `POST /api/receipt-notices/:id/convert` | `NEW_DESIGN_TARGET` | 是（写收货单 + 来源行 `converted_quantity` + 正向交期 effect） | `RECEIPT_NOTICE_CONVERT` | `receipt_notices.id` | Header（必填） | 规范化请求体：target + items[].allocations[]（noticeItemId / purchaseOrderItemId / quantity / deliveryScheduleId）+ warehouseId + businessDate | `idempotency_records` UNIQUE + `schedule_consumption_effects UNIQUE(business_event_type,business_event_id,business_event_item_id,reverses_effect_key)` + `receipt_notice_item_sources UNIQUE(notice_item_id,purchase_order_item_id)` | `200` + `replayed:true` + 首次 `{conversions[], allocated[]}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 锁序 L2a→L2b→L2c→L2d | 容量 / 交期 / 政策门禁失败 ⇒ 收货、来源累计、effect、审计全部回滚 |
| `POST /api/purchase-receipts` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写 `purchase_receipts` / `_items` DRAFT） | `PURCHASE_RECEIPT_CREATE` | **`create-request:<normalized Idempotency-Key>`** | Header（必填） | 规范化请求体：supplier / PO / warehouse / items[]（含 quantity / price / **deliveryScheduleId**） | `idempotency_records` UNIQUE + 收货行 ID | `201` + `replayed:true` + 首次 `{id, receiptNo}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 | 整笔回滚；document id 在**首次响应**中返回 |
| `POST /api/purchase-receipts/:id/confirm`（`action='confirm'`） | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（库存 + 跟踪 + 估值 + 状态 + 凭证 + **正向交期 effect**） | `PURCHASE_RECEIPT_CONFIRM` | `purchase_receipts.id` | Header（必填）；兼容 body `idempotencyKey`；**既有默认值 `document-<receiptId>` 保留** | **必须**覆盖 `action` **与** `items[].deliveryScheduleId`（现状仅 `requestFingerprint({action})`，加入交期入参后**必须**扩展） | `idempotency_records` UNIQUE + `schedule_consumption_effects` 正向 effect UNIQUE + 五字段 Mutation Key | `200` + `replayed:true` + 首次 `{ok,id,status}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 收货行锁 + 交期 effect 唯一约束 | 库存 / 估值 / 期间 / 交期任一失败 ⇒ 整笔回滚，**不**保存幂等成功记录 |
| `POST /api/purchase-receipts/:id/confirm`（`action='cancel'` 分支，同一路由） | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（`status` DRAFT→CANCELLED） | `PURCHASE_RECEIPT_CANCEL` | `purchase_receipts.id` | Header（必填） | 规范化请求体（含 `action='cancel'`） | `idempotency_records` UNIQUE（**与 CONFIRM 分属不同 operation_type ⇒ scope 不冲突**）+ 状态守卫 | `200` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 收货行锁 | 整笔回滚；DRAFT 取消**不产生**负向交期 effect |

**B 组：委外材料执行（物理副作用类）**

| API | Route Status | Mutation | Operation Type | Document Scope | Key | Fingerprint | Unique | Replay | Conflict | Concurrency | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST /api/procurement/outsourcing/orders/:id/issues` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（`MOVE` 双腿 + 跟踪双腿 + 估值双腿 + 业务事实 + **证据层 SUPPLY effect**） | `OUTSOURCING_MATERIAL_ISSUE` | `outsourcing_orders.id:<orderId>` | Header（必填）；兼容 body `idempotencyKey` | 规范化请求体：materialListId / quantity / **lotId / serialId** / unitCode / issuedDate | `idempotency_records` UNIQUE + `outsourcing_issues.idempotency_key` UNIQUE + 五字段 Mutation Key + `outsourcing_wip_identity_effects UNIQUE(idempotency_key)` | `201` + `replayed:true` + 首次 `{id}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 物料行锁 + 证据余额行锁（L2e→L2g） | 任一腿失败 ⇒ 库存 / 跟踪 / 估值 / 证据层 / 业务行 / 审计同时回滚 |
| `POST /api/procurement/outsourcing/orders/:id/supplements` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（同 Issue） | `OUTSOURCING_MATERIAL_SUPPLEMENT` | `outsourcing_orders.id:<orderId>` | Header（必填） | 规范化请求体：materialListId / quantity / **lotId / serialId** / unitCode / reason / supplementDate | `idempotency_records` UNIQUE + 五字段 Mutation Key + 证据层 effect UNIQUE | `201` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 物料行锁 + 证据余额行锁 | 同上 |
| `POST /api/procurement/outsourcing/orders/:id/returns` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（`MOVE` 双腿 + 跟踪 + 估值 + 业务事实 + **证据层 CONSUME effect + allocation**） | `OUTSOURCING_MATERIAL_RETURN` | `outsourcing_orders.id:<orderId>` | Header（必填） | 规范化请求体：materialListId / quantity / **lotId / serialId** / unitCode / returnDate | `idempotency_records` UNIQUE + 五字段 Mutation Key + 证据层 effect UNIQUE + allocation UNIQUE | `201` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 物料行锁 + 证据余额行锁 + 来源供应行锁（L2i） | 同上；`q > available(identity)` ⇒ 409 且零副作用 |
| `POST /api/procurement/outsourcing/orders/:id/backflush` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（单 OUT 腿 + 跟踪 OUT + `issueValue` + 业务事实 + **证据层 CONSUME effect + allocation**） | `OUTSOURCING_BACKFLUSH` | `outsourcing_orders.id:<orderId>` | Header（必填） | 规范化请求体：receiptId + 身份分区（lotId / serialId 与数量） | `idempotency_records` UNIQUE + 五字段 Mutation Key + 证据层 effect UNIQUE | `200` + `replayed:true` + 首次 `{ok, results[]}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 收货行锁 + 物料行锁 + 证据余额行锁 + 来源供应行锁 | 增量 < 0、净供应不足、`q > available(identity)` ⇒ 409 `BACKFLUSH_INSUFFICIENT_VERIFIED_WIP` 且整笔回滚 |
| `POST /api/procurement/outsourcing/orders/:id/difference-preview` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | **是**（TARGET：落 `PREVIEW` 行 ⇒ **产生持久化副作用**；CURRENT：源码为只读） | `OUTSOURCING_DIFFERENCE_PREVIEW` | `outsourcing_orders.id:<orderId>` | Header（必填） | 规范化请求体：periodKey + 预览口径（expected / actual 基线） | `idempotency_records` UNIQUE + 预览行 UNIQUE（`<orderId>:<materialListId>:<periodKey>:<previewSeq>`） | `200` + `replayed:true` + 首次 `{previews[]}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 物料行锁（锁内重读 expected / actual） | 整笔回滚；**重放不得重复生成预览记录** |
| `POST /api/procurement/outsourcing/orders/:id/difference-apply` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写 `APPLIED` 行 + 补料 / 退料业务事实 + 计数器 + **证据层 effect**） | `OUTSOURCING_DIFFERENCE_APPLY` | `outsourcing_orders.id:<orderId>` | Header（必填） | 规范化请求体：materialListId + **differenceId**（引用 PREVIEW 行）+ periodKey + 方向（由差额导出，**客户端不得指定**） | `idempotency_records` UNIQUE + 差异行状态守卫 + 证据层 effect UNIQUE | `200` + `replayed:true` + 首次 `{ok, differenceId}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 差异行锁 + 物料行锁 + 证据余额行锁 | `ALLOCATED→APPLIED` 的审核（B-P02 未批）⇒ **BLOCKED**；**Apply 只能消费合法且未应用的 PREVIEW** |
| `POST /api/procurement/outsourcing/wip-transfers` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写 transfer 事实 + 源/目标计数器 + **源 CONSUME / 目标 SUPPLY 证据层 effect + allocation**；**零**物理/跟踪/估值腿） | `OUTSOURCING_WIP_TRANSFER` | `wip-transfer:<sourceOrderId>:<targetOrderId>` | Header（必填） | 规范化请求体：sourceOrderId / targetOrderId / **targetMaterialListId** / quantity / identities[] / transferDate | `idempotency_records` UNIQUE + `outsourcing_wip_transfers` 事件 UNIQUE + 证据层 effect UNIQUE + allocation UNIQUE | `201` + `replayed:true` + 首次 `{id, transferNo}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 锁序：源订单→目标订单→源物料行→目标物料行→源证据余额→目标证据余额→来源供应行 | 五项相容门禁或来源授权失败 ⇒ 整笔回滚 |

**B′ 组：委外收货**

| API | Route Status | Mutation | Operation Type | Document Scope | Key | Fingerprint | Unique | Replay | Conflict | Concurrency | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST /api/procurement/outsourcing/receipts` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写表头 + **明细** `outsourcing_receipt_items` + 状态 DRAFT） | `OUTSOURCING_RECEIPT_CREATE` | **`create-request:<normalized Idempotency-Key>`** | Header（必填） | 规范化请求体：orderId / items[]（productId / quantity / unitCode / unitPriceCents / lotId / serialId / processingPoItemId / sourceNoticeItemSourceId）/ warehouseId / businessDate | `idempotency_records` UNIQUE + `outsourcing_receipts.receipt_no` UNIQUE + 明细行 ID | `201` + `replayed:true` + 首次 `{id, receiptNo, businessStatus}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 委外订单行锁 + 通知来源行锁 | 表头与明细原子；失败 ⇒ 零写入；document id 在**首次响应**中返回 |
| `POST /api/procurement/outsourcing/receipts/:id/submit` | `NEW_DESIGN_TARGET` | 是（`DRAFT`→`PENDING_INSPECTION` + 质量门禁判定） | `OUTSOURCING_RECEIPT_SUBMIT` | `outsourcing_receipts.id` | Header（必填） | 规范化请求体（当前无业务入参） | `idempotency_records` UNIQUE + 状态守卫 | `200` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 收货行锁 | 质量未通过 ⇒ 整笔回滚，零库存副作用 |
| `POST /api/procurement/outsourcing/receipts/:id/effect` | `NEW_DESIGN_TARGET` | 是（倒冲 + 成品入库 + 成本证据 + 状态 `EFFECTED` + **正向交期 effect**） | `OUTSOURCING_RECEIPT_EFFECT` | `outsourcing_receipts.id` | Header（必填） | 规范化请求体：receiptId + 倒冲身份分区 + deliveryScheduleId | `idempotency_records` UNIQUE + 交期正向 effect UNIQUE + 五字段 Mutation Key + 证据层 effect UNIQUE | `200` + `replayed:true` + 首次 `{ok, totalMaterialValueCents, incrementalRows}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 收货行锁 + 物料行锁 + 证据余额行锁 | 质量 / 库存 / 估值 / 证据 / 交期任一失败 ⇒ 整笔回滚 |
| `POST /api/procurement/outsourcing/receipts/:id/confirm` | `ALIAS` | 是（**`effect` 的别名路由**；语义重定义 = effect） | `OUTSOURCING_RECEIPT_EFFECT` | `outsourcing_receipts.id`（**与 effect 共用同一 scope**） | Header（必填） | **与 effect 共用同一 fingerprint 规则** | 同 effect | `200` + `replayed:true` + **首次结果**（第二次调用必须命中首次结果） | `409` IDEMPOTENCY_KEY_CONFLICT | 同 effect | 同 effect；**别名不得双写**（同 scope ⇒ 第二次命中重放，**不得重复执行**倒冲、成品入库、估值或交期 effect） |

**C 组：加工费与成品退货**

| API | Route Status | Mutation | Operation Type | Document Scope | Key | Fingerprint | Unique | Replay | Conflict | Concurrency | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST /api/procurement/outsourcing/processing-fee-bills` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写 `supplier_bills` DRAFT + `supplier_bill_items` + 预留量占用） | `OUTSOURCING_PROCESSING_FEE_BILL` | **`create-request:<normalized Idempotency-Key>`** | Header（必填）；兼容 body `idempotencyKey` | 规范化请求体：supplierId / supplierInvoiceNo / billDate / lines[].outsourcingReceiptItemId / quantity / unitPriceCents | `idempotency_records` UNIQUE + `supplier_bills.idempotency_key` UNIQUE + **来源预留键 `commercial_source_type='OUTSOURCING_RECEIPT_ITEM' + commercial_source_item_id`** | `201` + `replayed:true` + 首次 `{id, billNo, totalNet, totalGross}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 收货明细行锁（锁内重读预留量） | 容量不足 ⇒ 409，账单与预留**零写入**；document id 在**首次响应**中返回 |
| `POST /api/procurement/outsourcing/processing-fee-bills/:id/post` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（`DRAFT`→`POSTED` + AP open item + 成本证据刷新） | `OUTSOURCING_PROCESSING_FEE_POST` | `supplier_bills.id` | Header（必填） | 规范化请求体（当前无业务入参） | `idempotency_records` UNIQUE + `supplier_bills.status` 状态守卫 | `200` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 账单行锁 + `assertOutsourcingAccountingPolicy` 的 scope 行锁（L7） | **C-P01..C-P04 未批 ⇒ 在任何 AP/GL 副作用之前 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`**；账单保持 DRAFT、零 AP / 零凭证 |
| `POST /api/procurement/outsourcing/finished-returns` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写 `outsourcing_finished_returns` + **明细** `outsourcing_finished_return_items` + 成品库存 OUT + 负向交期 effect + 贷项分配） | `OUTSOURCING_FINISHED_RETURN` | `outsourcing_receipts.id:<receiptId>` | Header（必填） | 规范化请求体：outsourcingReceiptId + **items[].outsourcingReceiptItemId / quantity** + returnDate + remark（**R4-6-R2：明细级**） | `idempotency_records` UNIQUE + `outsourcing_finished_return_items UNIQUE(return_id, outsourcing_receipt_item_id)` + **负向交期 effect UNIQUE** | `201` + `replayed:true` + 首次 `{id, returnNo, commercialState, commercialCreditCents}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 收货行锁 + 收货明细行锁 + 账单行锁 + 交期 effect 锁（L2f） | **C-P03 未裁定时在物理副作用之前 fail closed**（实物退货 / 商业贷项 / AP 调整 / GL 凭证四层）；明细不可唯一归属 ⇒ 409 `OUTSOURCING_RETURN_ITEM_UNPROVEN` |

**D 组：VMI**

| API | Route Status | Mutation | Operation Type | Document Scope | Key | Fingerprint | Unique | Replay | Conflict | Concurrency | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST /api/procurement/vmi/agreements` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写 `vmi_agreements`） | `VMI_AGREEMENT_CREATE` | **`create-request:<normalized Idempotency-Key>`** | Header（必填） | 规范化请求体：supplierId / warehouseId / productId / minStock / maxStock / reorderLevel / effectiveFrom / effectiveTo | `idempotency_records` UNIQUE + 协议有效区间唯一 | `201` + `replayed:true` + 首次 `{id}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 协议区间检查 | 整笔回滚；document id 在**首次响应**中返回 |
| `POST /api/procurement/vmi/receipts` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（写 `vmi_receipts` `PENDING`） | `VMI_RECEIPT_CREATE` | **`create-request:<normalized Idempotency-Key>`** | Header（必填）；兼容 body `idempotencyKey` | 规范化请求体：supplierId / warehouseId / productId / quantity / receivedDate / remark | `idempotency_records` UNIQUE + `vmi_receipts.idempotency_key` UNIQUE + `vmi_receipts.receipt_no` UNIQUE | `201` + `replayed:true` + 首次 `{id, receiptNo}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + `vmi_receipts.idempotency_key` UNIQUE | 整笔回滚；document id 在**首次响应**中返回 |
| `POST /api/procurement/vmi/receipts/:id/confirm` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（物理 IN + 状态 PENDING→CONFIRMED） | `VMI_RECEIPT_CONFIRM` | `vmi_receipts.id` | Header（必填） | 规范化请求体（当前无业务入参） | `idempotency_records` UNIQUE + `vmi_receipts.business_status` 状态守卫 + 五字段 Mutation Key `VMI_RECEIPT:<receiptId>`（**已确定性**） | `200` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + `vmi_receipts` 行锁（状态重读移入事务内） | 库存 / 期间失败 ⇒ 整笔回滚，状态保持 PENDING |
| `POST /api/procurement/vmi/consumptions` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（物理 OUT + `vmi_consumptions` CONFIRMED） | `VMI_CONSUMPTION` | `vmi-receipt:<vmiReceiptId>` | Header（必填） | 规范化请求体：vmiReceiptId / quantity / consumedDate / destination / remark | `idempotency_records` UNIQUE + 五字段 Mutation Key（**现状为 `randomUUID` ⇒ 非确定性，必须改为事件 ID 派生**） | `201` + `replayed:true` + 首次 `{id, consumptionNo}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + `vmi_receipts` 行锁 + 消耗量上限断言 | 库存不足 / 数量超限 ⇒ 409 且零副作用 |
| `POST /api/procurement/vmi/ownership-transfers` | `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` | 是（`OWNER_CHANGE` 成对腿 + `vmi_ownership_transfers` + 状态 →TRANSFERRED） | `VMI_OWNERSHIP_TRANSFER` | `vmi-receipt:<vmiReceiptId>` | Header（必填） | 规范化请求体：vmiReceiptId / **settlementQuantity** / transferDate（**移除 `settlementAmountCents` 与 `supplierBillId`**） | `idempotency_records` UNIQUE + `vmi_ownership_transfers` 事件 UNIQUE + 五字段 Mutation Key（同上，非确定性 ⇒ 必须改为确定性派生） | `201` + `replayed:true` + 首次 `{id, transferNo}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + `vmi_receipts` 行锁 + 转移量上限断言 | 超限 / 状态不符 ⇒ 409 且零副作用；**物理净 0** |
| `POST /api/procurement/vmi/settlement-periods` | `NEW_DESIGN_TARGET` | 是（写 `vmi_settlement_periods` + `_lines` + 期初快照证据） | `VMI_SETTLEMENT_PERIOD_OPEN` | `vmi-period:<agreementId>:<periodKey>` | Header（必填） | 规范化请求体：agreementId / windowKind / windowStart / windowEnd / periodKey + 期初快照身份 | `idempotency_records` UNIQUE + `vmi_settlement_periods UNIQUE(agreement_id, period_key)` + 闭区间重叠谓词 | `201` + `replayed:true` + 首次 `{id, periodKey}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + **agreement 行 `FOR UPDATE`**（先锁 scope，再查重叠）+ `vmi_settlement_lines UNIQUE(period_id, product_id)` | 首期期初不可证 ⇒ 409 `VMI_OPENING_BALANCE_UNPROVEN`；重叠 ⇒ 409 `VMI_SETTLEMENT_PERIOD_OVERLAP`；两者均零写入 |
| `POST /api/procurement/vmi/settlement-periods/:id/close` | `NEW_DESIGN_TARGET` | 是（`status` OPEN→CLOSED + 恒等式快照） | `VMI_SETTLEMENT_PERIOD_CLOSE` | `vmi_settlement_periods.id` | Header（必填） | 规范化请求体（当前无业务入参） | `idempotency_records` UNIQUE + `vmi_settlement_periods.status` 状态守卫 | `200` + `replayed:true` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 期间行锁 + 结算行锁（L6） | 恒等式不成立 / 未归属调整量超容差 ⇒ 409，状态保持 OPEN |
| `POST /api/procurement/vmi/settlement-periods/:id/bills` | `NEW_DESIGN_TARGET` | 是（写 canonical Supplier Bill + bill item + `vmi_settlement_bill_allocations` + `settled_qty`） | `VMI_SETTLEMENT_BILL_ALLOCATE` | `vmi-allocation:<periodId>:<allocationEventId>` | Header（必填） | 规范化请求体：allocationEventId + 分配明细[].settlementLineId / quantity + 账单业务日 | `idempotency_records` UNIQUE + `vmi_settlement_bill_allocations UNIQUE(allocation_event_id)` + `UNIQUE(idempotency_key)` + `UNIQUE(settlement_line_id, supplier_bill_item_id)` | `201` + `replayed:true` + 首次 `{billId, allocations[]}` | `409` IDEMPOTENCY_KEY_CONFLICT | 命名锁 + 结算行锁（L6）+ `settled_qty <= commercial_released_qty` 断言 | **D-P01/D-P02 未批 ⇒ 统一 409 `VMI_PARTIAL_SETTLEMENT_POLICY_PENDING`，零写入** |

**R4-6-R2 表格脚注（不改变任何单元格取值）**

- 委外收货的 `.../receipts/:id/confirm` 路由**当前已注册**（`server/app.js:1116`），但本设计把它的语义重定义为 `.../receipts/:id/effect` 的**别名** ⇒ 二者共用 `OUTSOURCING_RECEIPT_EFFECT`、共用同一 document scope 与同一 fingerprint 规则，**第二次调用必须命中首次结果**，不得重复执行倒冲、成品入库、估值或交期 effect。
- `POST /api/purchase-receipts/:id/confirm` 的两行是**同一路由的两个 `action` 分支**：`action='confirm'` ⇒ `PURCHASE_RECEIPT_CONFIRM`；`action='cancel'` ⇒ `PURCHASE_RECEIPT_CANCEL`（二者 operation type 不同 ⇒ scope 不冲突）。
- 6 条 `NEW_DESIGN_TARGET` 路由**当前不存在**：Receipt Notice Convert、Outsourcing Receipt Submit、Outsourcing Receipt Effect、VMI Settlement Period Open、VMI Settlement Period Close、VMI Settlement Bill Allocation。

**第八步：一致性静态交叉核对（R4-6-R2 结论）**

| 核对项 | 结论 |
|---|---|
| §26.33.6 与 §26.33.8 的 API 集合一致 | **一致** —— §26.33.6 已按本矩阵同步更正路径、标注 `Route Status` 并补齐缺失项 |
| API 行数统计 | **29** 条 API 记录 |
| 唯一 operation type 数 | **28** 个 |
| 别名组数 | **1** 组（委外收货 `.../effect` ↔ `.../confirm`，共用 `OUTSOURCING_RECEIPT_EFFECT`） |
| **不得**把 API 行数写成 operation type 数量 | 已遵守：29 ≠ 28，差额恰为 1 组别名 |
| 所有 M1 Mutation API 均已登记 | **是** —— 29 条记录覆盖 §26.33.6.1～§26.33.6.5 与 `server/app.js` 实际注册的 M1 路由；`GET` 端点不在范围内 |
| operation type 不重复、不冲突 | **是** —— 28 个字面量互不相同；`OUTSOURCING_RECEIPT_EFFECT` 被 `effect` 与 `confirm` **有意共用**（别名） |
| document scope 与实际 Handler 参数一致 | **是** —— 非创建类的 scope 全部由路径 / 请求中的既有业务 ID 派生，不接受客户端指定 scope |
| 创建类 scope 统一 | **是** —— 6 个创建类 API 全部使用 `create-request:<normalized Idempotency-Key>`（通知、采购入库、委外收货、加工费账单、VMI 协议、VMI 收货）；**未**使用尚未生成的随机 document id |
| preview / apply 各自独立 | **是** —— `OUTSOURCING_DIFFERENCE_PREVIEW` 与 `OUTSOURCING_DIFFERENCE_APPLY` 是两个 operation type、两个 fingerprint |
| VMI receipt create / confirm 各自独立 | **是** —— `VMI_RECEIPT_CREATE`（请求期 scope）与 `VMI_RECEIPT_CONFIRM`（收货 id scope）分离 |
| Alias 共用 operation type / scope / fingerprint | **是** —— 第二次调用命中首次结果，**不得重复执行**倒冲、成品入库、估值或交期 effect |
| actor / tenant scope 与 canonical helper 一致 | **是** —— 矩阵**不含** actor / tenant 维度，与 `financial-controls.js:32-58` 及 `idempotency_records` 的唯一键一致 |
| 锁键、数据库唯一键与 fingerprint 口径一致 | **是** —— 三者都基于 `(operation_type, document_id, idempotency_key)`；命名锁与唯一键同键同域 |
| Route Status 区分已注册与设计目标 | **是** —— **6** 条 `NEW_DESIGN_TARGET` 明确标注为当前**不存在**；**不得**声称矩阵所有路径均已注册 |

**三层防重继续严格区分（不得互相替代）**

| 层 | 载体 | 防的是 |
|---|---|---|
| ① 外部 API 幂等 | `idempotency_records`（`operation_type, document_id, idempotency_key`） | 同一客户端请求被重放 |
| ② 库存 Mutation Key | `inventory_mutation_log.idempotency_key`（五字段：`<SOURCE_TYPE>:<business_event_id>:<business_event_item_id>:<leg_seq>:<identity_key>`） | 同一条**物理腿**被重复过账 |
| ③ 业务效果 / 分配事实唯一键 | `schedule_consumption_effects` 的两个 UNIQUE、`outsourcing_wip_identity_effects` 的两个 UNIQUE、`outsourcing_wip_identity_effect_allocations` 的 UNIQUE、`vmi_settlement_bill_allocations` 的三个 UNIQUE | 同一条**业务事实**或**来源分配**被重复登记 |

⇒ ① 不阻止②（同一物理腿可能来自两个不同的外部请求）；② 不阻止③（同一业务效果可能包含多条腿）；③ 不阻止①②。三层各自成立，任一层不得被另一层替代。

外部 API key 只防请求重放；内部五字段 Mutation Key 只防物理腿重放；`schedule_consumption_effects.idempotency_key`、身份层 effect / allocation 与 allocation event unique 只防各自事实账重复。三层不得互相替代。

| 动作 | 现状 | 本 Design |
|---|---|---|
| 收料通知创建 | 仅 `receipt_notices.idempotency_key` UNIQUE，重复 → 裸唯一约束错误（409，消息为通用文案） | 走 canonical `idempotencyReplay`/`saveIdempotency`，返回 `replayed: true` |
| 通知确认 | 无幂等 | 用 `RECEIPT_NOTICE_CONFIRM:<noticeId>` 键 |
| 通知→入库转换 | 无 | `RECEIPT_NOTICE_CONVERT:<noticeId>:<hash(allocations)>` |
| 采购入库创建/确认 | 确认已有 `PURCHASE_RECEIPT_CONFIRM` 幂等（`app.js:5562-5610`），创建无 | 创建补 `PURCHASE_RECEIPT_CREATE` |
| 委外收货创建/生效 | **全部无** | `OUTSOURCING_RECEIPT_CREATE` / `OUTSOURCING_RECEIPT_EFFECT` |
| 材料发/退/补 | 仅 `outsourcing_issues.idempotency_key` 有 UNIQUE 列；补料/退料**无** | **C-05 修正（R4-01 再更正）**：物理腿 Mutation Key = `<SOURCE_TYPE>:<business_event_id>:<business_event_item_id>:<leg_seq>:<identity_key>`（**不含** orderId / materialListId；**且区分业务项与身份子腿**），同一订单同一物料行的多次合法发/退/补彼此独立，同一事件内的多个物料行与 SERIAL 拆分腿亦互不撞键；**外加** canonical `idempotencyReplay`/`saveIdempotency` + `requestFingerprint` 请求指纹（§26.33.4.6.1、§26.33.4.7.2） |
| 加工费账单创建 | 仅手写重复键检查（`outsourcing-finance.js:172-175`），无 `idempotencyReplay` | `OUTSOURCING_PROCESSING_FEE_BILL` |
| 加工费账单过账 | 无 | `OUTSOURCING_PROCESSING_FEE_POST` |
| VMI 消耗/转移/结算开期 | 无 | `VMI_CONSUMPTION` / `VMI_OWNERSHIP_TRANSFER` / `VMI_SETTLEMENT_PERIOD_OPEN` |

- canonical 幂等原语：`idempotencyReplay`(`financial-controls.js:32`，MySQL 下用 `GET_LOCK` 命名锁) / `saveIdempotency`(`:60`)。`idempotencyReplay` 在缺 `Idempotency-Key` 时抛 **400** `关键过账操作必须提供 Idempotency-Key`，处理中抛 503。
- **R1 补充（重放语义的来源类型分叉）**：`applyInventoryMutation` 自身的重放保证**按来源类型分叉** —— Consignment 来源命中 `inventory_mutation_log` 后会比对 `request_fingerprint` 与位置身份，不一致 → 409 `INVENTORY_MUTATION_IDEMPOTENCY_CONFLICT`；**非 Consignment 来源（含全部委外动作）命中后直接返回 `{ replayed:true }`，不比对请求内容**（`inventory-mutation.js:258-261`）。因此委外路径**必须**在业务层使用 canonical `idempotencyReplay`/`saveIdempotency` + `requestFingerprint`（`financial-controls.js:25-30`）做请求级幂等，`inventory_mutation_log` 只作为物理重放占用。同一幂等键不得用于不同请求内容（`financial-controls.js:56` → 409）。详见 §26.33.4.6.1「幂等与重放」。
- **C-05 补充（Mutation Key 必须含业务事件 ID —— R4-01 再补两项区分）**：R1 设计的物理腿 `idempotencyKey = <ACTION>:<orderId>:<materialListId>:<legSeq>` **不含独立业务事件 ID** ⇒ 同一订单、同一物料行的**第二次合法发料**会算出**同一个** Mutation Key → 命中 `inventory_mutation_log` 后因非 Consignment 路径**不比对请求内容**而直接返回 `replayed:true` → **第二次发料被静默丢弃**。**R4-01 追加发现**：R3 的三段式 `<SOURCE_TYPE>:<business_event_id>:<legSeq>` 虽已含事件 ID，但仍**不区分同一事件内的多个业务项**（倒冲 N 个物料行）与**同一腿内的多个身份子分区**（SERIAL 拆分 q 条腿）⇒ 这两类腿仍会撞键并被静默丢弃（源码依据：`outsourcing-finance.js:100-124` 的逐行倒冲；`traceability-quality.js:247-275` 的 `qty===1` 强制）。**最终裁定**：Mutation Key = `<SOURCE_TYPE>:<business_event_id>:<business_event_item_id>:<leg_seq>:<identity_key>`，且 `source_id` 必须是**业务事件 ID**、`source_item_id` 必须是**业务行 ID**（§26.33.4.7.2）；另加"非预期重放"与"实际腿数 == 预期腿数"两条硬断言。R1 §26.33.8 表中的 `OUTSOURCING_MATERIAL_<ACTION>:<orderId>:<materialListId>` 一式**作废**。

**回滚（Rollback）**

- 任何 handler 内抛错 → `transaction()` 回滚，业务行、库存、估值、审计**全部**回滚（审计写在事务内，`lib/audit.js`）。
- MySQL 下若回滚未被证明，adapter 被 quarantine（`db.js:2293-2317`），连接不可复用 —— 这是**故意**的 fail-closed，不得用 catch-and-continue 绕过。
- 本 Design **禁止**在 handler 内 `catch` 掉库存/估值错误后继续（现状 `applyInventoryMutation` 的估值分支**确实**吞掉估值错误，`inventory-mutation.js:278-282`，注释称“legacy best-effort”）。委外路径必须使用 `valuationMode:'EXTERNAL'`，从而**根本不进入**那个吞异常的分支。

#### 26.33.9 RBAC / SOD and Audit

**权限（新增，全部 additive）**

| 权限 | 用途 | 授予（提议） | 状态 |
|---|---|---|---|
| `OUTSOURCING_DIFFERENCE_APPROVE` | 倒冲差异 `ALLOCATED → APPLIED` 审核 | 待 `B-P02` | **未批准，不得实施** |
| `SUPPLIER_BILL_MANAGE` | 委外加工费账单创建/过账 | Finance 角色矩阵待 Owner 确认；admin 随目录全权限 | 需按 M-17 注册 |

**R4-6 通知权限唯一矩阵（F-03）**

| 动作 | 权限合同 |
|---|---|
| 列表/详情 | `allowAny(actor, ['RECEIPT_NOTICE_VIEW','RECEIPT_NOTICE_MANAGE'])`（与真实 `procurement-receiving.js` 一致） |
| 创建/确认/取消 | `allow(actor, 'RECEIPT_NOTICE_MANAGE')` |
| 转换为采购入库 | `RECEIPT_NOTICE_MANAGE` **且** `PURCHASE_RECEIPTS_MANAGE` |
| 转换为委外收货 | `RECEIPT_NOTICE_MANAGE` **且** `OUTSOURCING_RECEIVING_MANAGE` |

`RECEIPT_NOTICE_VIEW` / `RECEIPT_NOTICE_MANAGE` 均已在 `server/db.js` 注册；admin 通过全目录自动获得。`PROCUREMENT_NOTICE_CONVERT` 在真实注册表、desired role permissions 与路由守卫中均不存在，R4-6 将其判定为**作废的未注册设计字面量**：不得新增、不得放进 `allowAny()`，也不得据此擅自决定角色授予矩阵。转换采用“通知管理 + 目标侧管理”的 AND 门禁；完整非 admin 授予仍由既有角色治理决定。

- **必须修复的既有缺陷**：`SUPPLIER_BILL_MANAGE`（`outsourcing-finance.js:14`）**不在** `PERMISSIONS` 目录（`server/db.js:46-301`），也不在任何角色的授权集合中 → `allowAny(actor, ['SUPPLIER_BILL_MANAGE','OUTSOURCING_MANAGE'])` 实际**退化为只认 `OUTSOURCING_MANAGE`**。因此**任何**有 `OUTSOURCING_MANAGE` 的人都能创建并过账委外加工费账单，而财务角色 `role-accounting` 反倒没有该权限。
  - 本 Design 的处置（R2 已按 `M1-D-35` 收紧）：**注册** `SUPPLIER_BILL_MANAGE` 到 `PERMISSIONS` 目录，并把委外路径的权限判定从 `allowAny([...])` 改为 **`allow(actor, 'SUPPLIER_BILL_MANAGE')`（单权限）** —— `OUTSOURCING_MANAGE` **不得**创建或过账加工费账单。完整依据与授予矩阵边界见 **§26.33.4.7.3**。
  - **注册注意事项**（`server/db.js:1745-1812` / `v13-phase1-contracts.js:75-109`）：
    1. 加入 `PERMISSIONS` 目录后，`role-admin` 通过“授予全部”自动获得（`db.js:1760-1762`）；
    2. `reconcileV13RolePermissions` 会把**不在** `V13_DESIRED_ROLE_PERMISSIONS` 的新权限从四个非 admin 角色**剥离** → 必须同步加入 desired set（`v13-phase1-contracts.js:63-72` 的 `role-accounting` 列表）；该常量位于**已发布的 V13 migration 文件**中，实施时须单独标注该文件改动并取得授权；
    3. `server/modules/roles.js:68` 规定 admin 的权限集必须包含 `PERMISSIONS` 的**全部** → 任何新增权限会使已保存的 admin 权限集失效直到重存；管理界面必须容忍 `PERMISSIONS` 增长。
- **SoD**：委外加工费账单的**创建/过账**（Finance 侧 `SUPPLIER_BILL_MANAGE`）与**收货生效**（`OUTSOURCING_RECEIVING_MANAGE`）分属两个权限族，`role-accounting` 不应持有 `OUTSOURCING_RECEIVING_MANAGE`，委外业务侧角色不应持有 `SUPPLIER_BILL_MANAGE`。现状 `role-accounting` **没有** `OUTSOURCING_MANAGE`、`role-warehouse` **没有** `FINANCE_INVOICE_MANAGE`，方向正确；本 Design 保持该隔离并**显式**写入验收断言。**除 `role-accounting` 外的完整角色授予矩阵属业务授权决定，标记 `POLICY_DECISION_PENDING`（§26.33.14.1）。**

**审计**

- 既有 `audit(db, userId, action, entityType, entityId, detail)` → `audit_logs`（6 列，自由文本 `detail`，索引仅 `(entity_type, entity_id)`）。
- 本 Design **不新建**审计表（`audit_logs` 是唯一的业务审计 sink；`inventory_mutation_log` 是物理变更的幂等证据账，不是审计 sink）。
- 新增/变更的审计调用（全部在事务内）：

| action | entityType | entityId | detail 约定 |
|---|---|---|---|
| `CONVERT` | `RECEIPT_NOTICE` | noticeId | `→ { receiptIds }` |
| `SUBMIT` | `OUTSOURCING_RECEIPT` | receiptId | `PENDING_INSPECTION` |
| `EFFECT` | `OUTSOURCING_RECEIPT` | receiptId | `material=…; fee=…; movementGroup=…` |
| `ISSUE` / `SUPPLEMENT` / `RETURN` | 既有 `OUTSOURCING_ISSUE` / `_SUPPLEMENT` / `_RETURN` | 既有 id | **追加** `movementGroup=…; from=…; to=…; valueCents=…` |
| `BACKFLUSH` | `OUTSOURCING_BACKFLUSH`（现状 entityId 是 materialListId） | 保持 materialListId | **追加** `movementGroup=…; valueCents=…` |
| `APPLY` | `OUTSOURCING_DIFFERENCE` | differenceId | 既有 `Δ=…` **追加** `direction=SUPPLY / RETURN` |
| `TRANSFER` | `OUTSOURCING_WIP_TRANSFER` | transferId | 既有 `transferNo` **追加** `costCents=…; from=…; to=…` |
| `PERIOD_OPEN` / `PERIOD_CLOSE` | `VMI_SETTLEMENT_PERIOD` | periodId | `periodKey=…; identity=…` |
| `RELEASE` | `VMI_SETTLEMENT_LINE` | lineId | `qty=…; priceCents=…; billId=…` |
| `POST` | `SUPPLIER_BILL` | billId | 既有 `bill_no` **追加** `closureState=…` |

- **审计缺口登记**：`audit_logs` 无 `business_date`、无 `request_id`、无 before/after 结构化字段，`created_at` 无索引。本 Design **不**在本轮修改审计 schema（属 Platform/Finance 域决策），登记为 `M1-F-12`。

#### 26.33.10 Conservation Invariants

以下恒等式是本 Design 的**可测断言**，每条都必须在对应 Gate 中被直接验证，且**失败时零副作用**。

##### 26.33.10.1 物理库存守恒

```text
INV-1  Σ inventory.quantity (按 position_key 分组) 在一次 MOVE 前后守恒；
       SUPPLIER 位 +q 的同时 ENTERPRISE 位 −q（VMI 场景反向）。
INV-2  任一位置不得出现负数量：'BLOCK' 策略下 `lockable < q` → 409（inventory-mutation.js:311-321）。
INV-3  委外材料总量守恒：
       Δ(内部仓 企业位) + Δ(WIP 仓 企业位) = 0（发料/补料/退料/WIP 转移）
       Δ(WIP 仓 企业位) = −backflushed（倒冲）
INV-4  VMI 物理（**分列**，C-03）：
       Δ(SUPPLIER 位)   = −supplierConsumedDirect − ownerChanged
       Δ(ENTERPRISE 位) = +ownerChanged − enterpriseConsumed
       ⇒ 全仓物理总量变化 = −supplierConsumedDirect − enterpriseConsumed
         （**只有真实消耗使总量减少**；ownerChanged 是归属再分配，不改变总量）
INV-4b 委外材料 WIP 归属再分配（C-02；R3 已统一字段名，权威定义见 §26.33.4.2）：
INV-WIP-1  对任一**订单**：Σ_i supplier_wip_i ≥ 0
INV-WIP-1b 对任一**物料行**：supplier_wip_i ≥ 0
           （R4-02：逐行非负必须单独断言，订单级聚合非负不足以覆盖单行透支）
INV-WIP-2  跨订单：Σ_订单 Σ_i supplier_wip_i 在转移前后守恒（差额为 0）
INV-WIP-3  **转移量不得超过源行当时可用的 WIP**（R4-02：四量定义，锁内重读后求值）：
             WIP_before(i)       = issued + supplemented − returned − backflushed
                                  − transferred_out + transferred_in
             q_requested         = 本次请求量（> 0 且有限）
             cum_transferred_out = transferred_out(前) + q_requested
             WIP_after(i)        = WIP_before(i) − q_requested
             断言：q_requested ≤ WIP_before(i) 且 WIP_after(i) ≥ 0
             违反 → 409 WIP_TRANSFER_EXCEEDS_AVAILABLE
           （R4-02 更正：R3 的 `transferred_out_i ≤ (… − transferred_out_i + transferred_in_i)`
             是**自指**不等式，且与本小节 R3 旧写法 `transferred_out_i ≤ supplier_wip_i`
             **互不一致** —— 两处登记点现已统一为四量定义）
INV-WIP-3b **隔离口径（R4-03；R4-6-R2 收紧为残差定义 + 三种数量）**：q_requested ≤ supplier_wip_available(i)
             = WIP_before(i) − legacy_unverified_wip_quantity(i)
             其中 legacy_unverified_wip_quantity(i)
                     = WIP_before(i) − verified_tracked_wip(i) − verified_quantity_only_wip(i)
             —— 归属不可证的历史量不得被新的身份绑定转移再次动用
           违反 → 409 WIP_TRANSFER_LEGACY_UNVERIFIED
INV-WIP-4  **新写入**转移行（quantity_accounting='COUNTER_ONLY'）：
             transferred_in_j 与 transferred_out_i 必须成对出现在同一条
             outsourcing_wip_transfers 行上；单边出现 → 409
           **历史行**（quantity_accounting='NETTED_IN_ISSUED'）：
             数量由 legacy_unverified_wip_quantity 承载，其"配对"以
             source_resolution_state 显式登记；**不得**用 transferred_out/in
             （恒为 0）去核对历史行
INV-WIP-5  一个业务事件 ID 对应一条 transfer 行（M1-D-31 防重）
INV-WIP-6  任一**新写入**转移行的 Σ(identity_json 分区数量) == 该行 quantity；
           且不得跨 LOT/SERIAL 身份分区
           **历史行**（identity_state='UNVERIFIED'、identity_json='[]'）
           ⇒ Σ 分区数量 = 0 ≠ quantity ⇒ **该不变量对历史行不成立**，
             不得被当作"已满足"；其后果由 INV-WIP-3b 的隔离规则承担
INV-WIP-7  **R4-6-R2 证据层对账（行级恒等式；三种数量）**：对任一物料行 i
             supplier_wip_i = legacy_unverified_wip_quantity_i
                              + verified_tracked_wip_i
                              + verified_quantity_only_wip_i
             其中 legacy_unverified_wip_quantity_i
                     = supplier_wip_i − verified_tracked_wip_i − verified_quantity_only_wip_i
             （**残差定义**），
             verified_tracked_wip_i       = Σ_b available_quantity  WHERE evidence_state='TRACKED'
             verified_quantity_only_wip_i = Σ_b available_quantity  WHERE evidence_state='QUANTITY_ONLY'
           ⇒ 恒有 0 ≤ legacy_unverified_wip_quantity_i ≤ supplier_wip_i
           ⇒ 恒有 supplier_wip_available_i == verified_tracked_wip_i + verified_quantity_only_wip_i
           ⇒ **两个层级必须逐行相等**；任一行不等 ⇒ 409 并整笔回滚
           违反 → 409 WIP_IDENTITY_RECONCILIATION_FAILED
INV-WIP-8  **R4-6-R2 证据级授权（负向动作；按 tracking_policy 分离）**：Return / Backflush /
           Transfer-Out 的数量 q 必须同时满足
             q ≤ available_quantity(material_list_i, identity_key)     -- 证据级授权
             q ≤ supplier_wip_available_i                             -- 行级授权
             且 evidence_state 与产品 tracking_policy 匹配
                （LOT/SERIAL ⇒ 'TRACKED'；NONE ⇒ 'QUANTITY_ONLY'）
           **行级数量授权不构成身份授权**；证据层余额为 0 的历史身份一律不可消费
           **禁止**用 QUANTITY_ONLY 余额授权 LOT / SERIAL 产品
           ⇒ 不允许任何负余额（available_quantity 恒 >= 0）
           违反 → 409 BACKFLUSH_INSUFFICIENT_VERIFIED_WIP /
                   409 RETURN_IDENTITY_UNVERIFIED /
                   409 WIP_TRANSFER_LEGACY_UNVERIFIED /
                   409 WIP_IDENTITY_POLICY_MISMATCH
INV-WIP-9  **R4-6-R2 残差不变性**：任何合法的业务动作（Issue / Supplement / Return /
           Backflush / Transfer）之后，legacy_unverified_wip_quantity_i **保持不变**
           ⇒ 正向动作：supplier_wip 与对应证据层同增 q；
             负向动作：二者同减 q
           ⇒ **新增 50 不得改变原历史隔离量 100**
           ⇒ **新业务事件一律不得用于减少历史隔离残差**
           ⇒ 残差只被 M-07d 迁移初值与独立授权的历史对账改变
           违反 → 409 WIP_IDENTITY_RESIDUAL_CONFLICT
INV-WIP-10 **R4-6-R2 证据层与物理层一致**：每个 TRACKED 余额行的 available_quantity
           不得超过该身份在 WIP 仓的物理可证明量（由 canonical 库存位 / 批次余额 /
           序列号生命周期在锁内重读）；证据层**不得**虚构物理上不存在的单位
           ⇒ QUANTITY_ONLY 余额行**不受**本条约束（它本就不主张物理身份）
           违反 → 409 WIP_IDENTITY_PHYSICAL_MISMATCH
INV-WIP-11 **R4-6-R2 来源血缘完整性（新增）**：对任一 CONSUME effect c 与任一 SUPPLY effect s
             Σ allocated_quantity(FROM allocations WHERE effect_id=c AND allocation_kind='CONSUMPTION')
                 == |c.signed_quantity|
             Σ allocated_quantity(FROM allocations WHERE effect_id=t AND allocation_kind='TRANSFER_ORIGIN')
                 == t.signed_quantity          （t 为 TRANSFER_IN effect）
             remaining_supply(s) == s.signed_quantity
                                  − Σ allocated_quantity(WHERE source_supply_effect_id=s.id
                                                        AND allocation_kind='CONSUMPTION')
             ⇒ remaining_supply(s) >= 0；且 TRANSFER_IN 的 TRANSFER_ORIGIN 分配必须与同一
               转移事件的 TRANSFER_OUT 的 CONSUMPTION 分配**逐项完全对应**
           ⇒ 物化余额必须与不可变台账重算结果**一致**
           违反 → 409 WIP_IDENTITY_ALLOCATION_INCOMPLETE /
                   409 WIP_IDENTITY_SUPPLY_EXHAUSTED /
                   409 WIP_IDENTITY_ALLOCATION_MISMATCH
```

> **R4-6-R2 断言边界（不得夸大）**：INV-WIP-7..11 中的**跨行 `SUM` 一致性**（INV-WIP-11 的分配合计、`remaining_supply`、余额与台账一致性）**不能**由普通 SQL `CHECK` 表达 ⇒ **只能**由运行时事务断言保证；数据库只负责单行取值范围、关系存在性与唯一性（§26.33.4.2 的"数据库约束与运行时约束必须分开"表）。

##### 26.33.10.2 估值守恒（R1-02 已重述并更正失效行号）

```text
VAL-1  一次 MOVE 的 |issueValue.valueDeltaCents| == receiveValue.valueDeltaCents（成对相等，零差额）。
VAL-2  Σ inventory_valuation_balances.value_cents 按 balance_key 在 MOVE 前后守恒（总额不变，分仓桶变化）。
VAL-3  估值余额不得为负：quantity < 0 或 value_cents < 0，或 (|quantity|≈0 且 value≠0)
       → 409「估值余额将产生负数或零数量残值」（financial-inventory.js:87）。
VAL-4a （普通采购/销售的 allocation-driven 路径，现状不变）
       LOT/SERIAL 产品的出库必须消费 tracked_source_allocations 中 posted=1 且 reversed=0 的身份分配，
       且分配数量之和 == 出库数量，否则 409「跟踪库存缺少已过账身份分配」
       （financial-inventory.js:129-132,144；原引用 :453-454 已失效，本轮更正）。
VAL-4b （委外 position-driven 路径，R1-01/R1-02 新增）
       委外每条物理腿必须由 postCanonicalTrackedLeg 过账，因而 inventory_lot_balances
       （按 warehouse_id+lot_id）与 inventory_serials.lifecycle_state/current_warehouse_id
       必须与 inventory.quantity 一致；断言方式 = reconcileTrackedInventory()
       （traceability-quality.js:472-482）返回 ok=true。
       委外路径**不**依赖 tracked_source_allocations —— 那是 allocation-driven 模型的身份来源，
       委外用位置口径（§26.33.4.6.1）。
VAL-5  委外成本证据的材料价值必须来自 canonical 分摊结果（issueValue 的 allocateProportionalCents），
       禁止跨仓全局平均价（现状 outsourcing-finance.js:116-119 违反此条）。
VAL-6  委外 MOVE 的价值中性：|issueValue.valueDeltaCents| == receiveValue.valueCents，
       差额必须为 0；不为 0 即表示两腿的 quantity 或 valueCents 传错。
VAL-7  委外每条物理腿必须产生且只产生 1 行 inventory_valuation_movements（status='POSTED'）
       与 1 次 inventory_valuation_balances 变更；Σ movement(quantity_delta, value_delta_cents)
       必须逐桶等于 balance 的 (quantity, value_cents) 增量。
VAL-8  委外每条物理腿必须产生且只产生 1 行 tracked_inventory_movements，且该行必须带
       transaction_id（= 对应 inventory_transactions.id），使跟踪流水与物理流水可对账。
VAL-9  委外物理流水必须被估值标记：inventory_transactions.valuation_status 必须由默认的
       'LEGACY_UNVALUED'（v13-phase6d-financial-inventory.js:35）变为 'VALUED'
       （writeMovement :91）。canonical 核对入口 = inventoryValuationReport
       （financial-inventory.js:375）的 authoritative 标志与逐桶明细 ——
       任何"只写物理库存、不写估值"的方案都会让该报告出现缺口。
VAL-10 委外估值腿的返回值必须 `status='POSTED'`；`LEGACY_UNVALUED` 回退
       （financial-inventory.js:95,:110）在委外路径**被显式拒绝** → 409 并整体回滚
       （C-06；§26.33.4.6.1）。
VAL-11 委外每条物理流水对应唯一一条 `inventory_valuation_movements`，且其
       `inventory_transaction_id` 必指向该物理流水；委外不得出现"有物理无估值"或
       "有估值无物理"的孤立行（C-06）。
VAL-12 身份占用（C-06；**R4-09 更正：分三个方向如实表述，不得宣称"语义等价"**）：
       对委外来源，(source_type, source_id, source_item_id, identity_key, direction)
       在 reversed=0 的行上**至多一条**；`identity_key` 非空
       （'LOT:<id>' / 'SERIAL:<id>' / 'NONE'），由委外写者填充。
       ① **重复必拒绝** —— SQLite 部分索引逐列精确比较（5 列全 NOT NULL）
          与 MySQL `generatedPartialIndex` 摘要生成列**等价**；
       ② **不同必放行** —— SQLite 逐列精确比较 ⇒ 放行；
          MySQL 依赖 **SHA-256 无碰撞**假设 ⇒ 放行。
          ⇒ 该方向**形式上不等价**（工程上可接受，但**不得**表述为"语义等价"）；
       ③ **谓词外行** —— SQLite 不在部分索引内；MySQL 摘要为 NULL，
          唯一索引允许多个 NULL ⇒ 两端**均不参与**去重 ⇒ **等价**。
```

**零副作用与对账的双重保证**：VAL-7 与 VAL-9 合起来排除「只写物理库存、不写相应估值而宣称成本闭合」的形态 —— 该形态在两处同时暴露：估值表缺行/余额缺增（VAL-7），且物理流水停留在 `LEGACY_UNVALUED`（VAL-9）。

##### 26.33.10.3 AP / 金额守恒（C-07 已重写为三段式口径）

```text
AP-1  GrossEligible(line)  = 收货行数量 − 有效退货量
       （有效退货量 = 归属该行的成品退货，且该退货所属收货必须通过
         §26.33.5.1 的 effectiveState 判定；LEGACY_UNVERIFIED 收货的退货不计入）
AP-2  ReservedOthers(line) = Σ 其他有效账单行的 base_quantity
       （有效账单 = status IN ('DRAFT','WAITING_MATCH','POSTED')；
         预留键统一为 canonical commercial_source_type='OUTSOURCING_RECEIPT_ITEM'
         + commercial_source_item_id = 收货明细 id —— **不是**现状的
         source_outsourcing_receipt_item_id 键，否则经 canonical 路径创建的账单不被计入预留）
AP-3  RemainingEligible(line) = GrossEligible − ReservedOthers
AP-4  新账单行必须满足 newQuantity <= RemainingEligible
AP-5  同一收货行的累计 active 预留（含本次）<= GrossEligible
       —— AP-5 是 AP-4 的等价形式；**禁止**把已扣过预留的 RemainingEligible
          再与全量预留比较（那会造成二次扣减）
AP-6  【C-P03 获批后才启用】贷项金额 ≤ 原单 gross_cents 且 ≤ remaining_creditable_amount_cents。
AP-7  【C-P03 获批后才启用】贷项分配须按获批顺序确定且可追溯；现有排序只是候选，不是已批准政策。
AP-8  【C-P03 获批后才启用】open_amount_cents 减少量 == 获批贷项金额；裁定前不得调用 applyCreditAdjustment。
```

**R2 纠正**：R1 的 `AP-1` 写作"账单行的 base_quantity 之和 ≤ 该收货行的可计费量（eligible = 行数量 − 已归属退货 − 已预留）"，把 **GrossEligible** 与 **RemainingEligible** 混为一谈 —— 若拿"账单行之和"去比较一个**已经扣过预留**的量，等于把同一笔预留扣两次，容量会被**过度收紧**。R2 把它拆成 AP-1…AP-5：先算 `GrossEligible`，再扣 `ReservedOthers` 得 `RemainingEligible`，新行与 `RemainingEligible` 比较；累计口径则与 `GrossEligible` 比较。**两者只能选其一使用，不得交叉。**

**R3 补充的四个边界（R3 已统一全文）**

1. **同一请求内重复引用同一来源行 → 先按 canonical source item 汇总**：`createProcessingFeeBill` 在写入前必须把请求的 `lines[]` **按 `outsourcingReceiptItemId` 聚合**（同一来源行的多行数量求和后再参与容量比较），否则同一请求内两行各 60、行来源数量 100 会被逐行判为"60 ≤ 100 通过"，实际新增 120 > 100。聚合后的本次新增量 `newQtyBySourceItem[sourceItemId]` 才是与 `RemainingEligible` 比较的对象。
2. **并发创建必须在同一来源行锁下重读预留量**：`ReservedOthers` 的求和必须在**事务内、对该收货明细行加锁后重读**（MySQL `SELECT ... FOR UPDATE`；SQLite 由 `BEGIN IMMEDIATE` 串行化），禁止用事务外读到的快照计算容量。两张账单并发针对同一收货明细创建时，**只有一方**能占用到最后一份容量，另一方必须得到 409 `PROCESSING_FEE_CAPACITY_EXCEEDED`（不是两方都通过）。
3. **退货导致超额的政策停止点（R4-5）**：C-REQ-04 要求保留退货、贷项/AP、成本反向追踪，但没有裁定“阻止退货”还是“允许退货并形成已过账异常”。因此 R4“退货必然允许”的表述作废。退货预检若发现会使 POSTED 行超额，在 C-P03 裁定前 409 `POSTED_RESERVATION_POLICY_PENDING`、零副作用；若数据库已存在这种历史事实，则允许只读/重算标记为 POSTED 历史异常，但绝不自动修改 AP/GL。只有全部超额行均未 POST 时，才按既有 DRAFT/WAITING_MATCH 标记和过账阻断合同处理。

**R4-10：OVER_RESERVED 的持久模型（R3 只说"登记为 `OVER_RESERVED`"，没有载体；本轮补齐）**

**(1) 粒度：账单行级持久 + 账单级派生**

| 层级 | 载体 | 语义 |
|---|---|---|
| **账单行级（持久）** | `supplier_bill_items.reservation_state`（`'NORMAL'` / `'OVER_RESERVED'`）、`over_reserved_quantity`、`over_reserved_reason`、`over_reserved_detected_at`（M-18） | **唯一权威**。超额是"某一行对某收货明细的预留超出可计费量"这一**行级**事实 |
| **账单级（派生）** | 账单读模型的 `reservationState`（`'NORMAL'` / `'OVER_RESERVED'`） | 派生规则：该账单**存在任一** `OVER_RESERVED` 行 ⇒ 账单级为 `'OVER_RESERVED'`。**不新增**账单表列，不改变 `closureState` 的既有三态（`NOT_POSTED` / `AP_CLOSED` / `AP_AND_GL_CLOSED`） |

**(2) 超额行是否仍属 active 预留集合？—— 是**

`ReservedOthers` 的求和集合**包含** `OVER_RESERVED` 行：它们**仍持有**对该批货的索取权，**仍占用**容量 ⇒ 超额**不会**把容量"让"给新账单行。设计**不得**因超额而自动作废、自动缩减或自动把数量移出 `base_quantity`。**这一保守取向是刻意的**：它保证"历史预留不会因为一次退货就静默消失"。

**(3) 确定性识别（不依赖插入顺序的偶然性）**

对每一个收货明细行（`commercial_source_item_id`），取其全部 **active** 预留行（`supplier_bills.status IN ('DRAFT','WAITING_MATCH','POSTED')`），按**确定性顺序**排序：

```text
排序键 = (supplier_bills.created_at ASC,
          supplier_bill_items.bill_id ASC,
          supplier_bill_items.line_no ASC,
          supplier_bill_items.id ASC)
          -- supplier_bill_items **无** created_at/updated_at 列，故用 bills.created_at + line_no + id
          -- 排序键**全序且无并列**（id 唯一）⇒ 识别结果与并发到达顺序无关

逐行累计 base_quantity（= 累计预留）：
  cum(i) = Σ_{j<=i} base_quantity(j)
  第 i 行被标记 OVER_RESERVED ⟺ cum(i) > GrossEligible
  over_reserved_quantity(i) = min(base_quantity(i), max(0, cum(i) − GrossEligible))
  over_reserved_reason(i)  = 'RETURN_REDUCED_ELIGIBLE'（或实际触发原因码）
```

⇒ 超额**必然落在累计跨过 `GrossEligible` 的那一行及其后所有行**上；越早创建的预留越先被保障（先到先得），**不依赖**插入顺序的偶然性。

**(4) 哪些账单行被阻止过账**

- `reservation_state='OVER_RESERVED'` 的**账单行**不得过账 ⇒ 409 `PROCESSING_FEE_OVER_RESERVED`（整笔过账被拒，账单保持 DRAFT，零 AP/GL 写入）。
- 未被标记的行**不受**该门禁影响（它们的预留仍在 `GrossEligible` 之内）。
- 该门禁与 §26.33.10.3 第 4 条"POST 前重新校验收货效力与容量"**同时**生效；两者都不满足时，按**先判效力、后判容量**的顺序报错（与 §26.33.5.1 的"先判后写"一致）。

**(4b) 已经 POSTED 的行**：同一 `reservation_state='OVER_RESERVED'` 与 `over_reserved_quantity` 保留异常事实，但行为按账单状态分流：DRAFT / WAITING_MATCH 禁止后续过账；POSTED 派生为 `POSTED_HISTORY_ANOMALY`，仍属于 active reservation，保留原 `base_quantity` 与审计。重算不得删除、不得改金额、不得减少数量、不得自动反向 AP/GL。C-P03 未裁定前，系统只识别并报告异常，不产生贷项、红冲或冲销。

**(5) 取消 / 重开如何恢复有效容量**

- **取消/作废**（canonical `POST /api/supplier-bills/:id/(cancel|void)`，`commercial-golive.js:725`）使该账单**退出** active 预留集合 → 重算后其余行的 `OVER_RESERVED` 标记**可以被清除**（若累计不再超出 `GrossEligible`）。**清除只写标记，绝不写数量。**
- **重开**（作废后重新开票）**不是**"复活"原预留行，而是**一张新的账单行**重新走容量检查与预留登记（新的 `reservation_state='NORMAL'`）。原预留行保持其历史状态，**不得**被静默改写。
- 被标记的行**必须**由业务显式动作（作废该账单、或重新分配其数量到一张新账单）才能解除"不得过账"的门禁；系统**不**提供自动解除。

**(6) 如何防止静默释放或缩减历史预留（五条硬约束）**

1. `OVER_RESERVED` 的**重算只允许写** `reservation_state` / `over_reserved_quantity` / `over_reserved_reason` / `over_reserved_detected_at` 四列；**禁止**触碰 `base_quantity_num` / `base_quantity_den` 或任何数量列。
2. 任何 `base_quantity` 的减少**必须**经 canonical 的显式业务动作（作废 / 贷项分配 / 显式取消预留）并写审计；**不得**由重算路径产生。
3. **不得**自动取消或自动缩减**既有 DRAFT 预留**（R3 已确立，本轮固化为可测约束）。
4. 每次重算写一条审计（action `RECOMPUTE_RESERVATION`，entityType `OUTSOURCING_RECEIPT_ITEM`，detail 记录 `receiptItemId` / `grossEligible` / 前后标记 / 超额量），使"标记变化"本身可追溯。
5. 重算**必须**在同一事务内、**对来源收货明细行加锁后重读**（§26.33.10.3 第 2 条的锁约定），避免并发退货与并发开票导致的重算互相覆盖。
4. **POST 前必须重新校验收货效力与容量**：即便账单已是 DRAFT，过账前必须在同一事务内重新校验 —— (a) 来源收货的 `effectiveState` 仍为 `EFFECTED_CONFIRMED`（§26.33.5.1）；(b) 该收货明细的 `GrossEligible` 与 `ReservedOthers` 仍满足 `newQty <= RemainingEligible`（含本账单自身预留的排除）。任一不满足 → 409，过账不得通过。
5. **预留键统一为 canonical `commercial_source_item_id`**：`ReservedOthers` 的求和条件固定为 `supplier_bill_items.commercial_source_type='OUTSOURCING_RECEIPT_ITEM' AND supplier_bill_items.commercial_source_item_id = <收货明细 id> AND supplier_bills.status IN ('DRAFT','WAITING_MATCH','POSTED')`；**不得**继续使用现状的 `source_outsourcing_receipt_item_id` 键（否则经 canonical 路径创建的账单不被计入预留，形成预留泄漏）。

##### 26.33.10.4 GL 边界（**当前不闭合**，C-04 已重写为 source-aware 门禁）

```text
GL-1  【目标，未闭合】委外加工费账单 POST 后，Σ(accounting_entries) 借 == 贷，
       且与 AP open item 金额、来源行金额、期间一致。
       —— 需要 C-P01（确认/暂估/GRNI 政策）与 C-P02（科目/资本化/税）先裁定。
GL-2  【当前必须成立】委外贷项凭证（若存在）必须有可追溯的原始凭证来源；
       现状无原始凭证（账单 POST 不写凭证）→ 登记为 M1-F-10，裁定前该路径显式失败。
GL-3  【C-04 新增，当前必须成立】委外加工费**不得**复用 postSupplierBill 的任一分支：
       DIRECT 分支不生成凭证且使该账单逃出 SUPPLIER_BILL_TO_SUBLEDGER_GL 的 BLOCKING 检查；
       INVOICE_DRIVEN / PROVISIONAL 分支会使用普通采购角色集生成 Dr GRNI / Cr AP。
       ⇒ 委外过账必须走 §26.33.4.3 的 source-aware 门禁；无已批准政策时 409
         OUTSOURCING_GL_POLICY_NOT_APPROVED，账单保持 DRAFT，零 AP open item / 零凭证 / 零分录。
GL-4  【C-04 新增】委外账单的 recognition_mode 不得取 DIRECT_BUSINESS_OPEN_ITEM
       （该值会使 commercialReconciliation 的 SUPPLIER_BILL_TO_SUBLEDGER_GL
        整行跳过该账单，commercial-golive.js:650）。
GL-5  【C-04 新增】委外加工费的任何分录都不得使用普通采购角色集
       （GRNI / INPUT_TAX_RECEIVABLE / PURCHASE_PRICE_VARIANCE / ACCOUNTS_PAYABLE）；
       委外角色集在 C-P01/C-P02 裁定前**不注册**于 account_role_mappings。
```

##### 26.33.10.5 VMI 结算恒等式（M1-F-07；C-03 重写、R3 复核；**本小节是唯一权威**）

**R4-6 F-01 Gate 口径**：物理数量、商业释放与未归属调整是三类不同断言，不得用一个“严格相等/容差”结论代替。

| Gate 分类 | 权威检查 | 失败语义 |
|---|---|---|
| 物理数量平衡 | VMI-P、VMI-S、VMI-E、VMI-R；已归属调整量按有符号值进入对应池 | 任一残差非 0 即物理不平，容差不得掩盖 |
| 商业数量平衡 | `0 <= settled_qty <= commercial_released_qty`，并与 bill allocations 合计一致 | 商业释放/结算不平；不改变物理 closing |
| 未分配调整 | `unallocated_adjusted_qty = VMI-P − (VMI-S+VMI-E)` | 默认零容差下非 0 即拒绝关期；未来获批容差也只放宽关期，不把残差写成 0 |
| 政策状态 | `M1-P-04` 是否批准非零容差 | 未批准时安全基线 `t=0`，状态仍 `POLICY_DECISION_PENDING`，不得自动关闭 |

因此 M1-GD01 必须分别报告 `physicalResidual`、`commercialResidual`、`unallocatedAdjustment` 与 `tolerancePolicyState`，能区分物理不平、商业不平、未分配调整超限和政策未批准。零容差是未获政策时的 fail-closed 执行基线，不等于批准了 M1-P-04。

```text
【调整量的符号约定（R4-05 裁定；唯一权威）】
  adjusted_supplier_qty / adjusted_enterprise_qty / unallocated_adjusted_qty
  全部是**有符号量**：正 = 该池在库量增加；负 = 该池在库量减少。
  有符号量的**来源侧在等式左端**。R3 把 `adjusted_*` 放在右端，
  与 VMI-R 的 `+ adjusted` 符号相反 ⇒ R3 的 VMI-P/S/E 与 VMI-R **互斥**
  （差 2×(adjusted_S + adjusted_E)）⇒ 本版为准。

VMI-P 【物理总量，以期初为起点】
       opening_supplier_qty + opening_enterprise_qty + received_qty
         + adjusted_supplier_qty + adjusted_enterprise_qty
         + unallocated_adjusted_qty
         = supplierOnHand + enterpriseOnHand
           + supplierConsumedDirect + enterpriseConsumed
           + returnedOrCancelled
VMI-S 【供应商来源池】
       opening_supplier_qty + received_qty + adjusted_supplier_qty
         = supplierOnHand + supplierConsumedDirect
           + ownerChanged + returnedOrCancelled
VMI-E 【企业池 —— 只由物权转移进入】
       opening_enterprise_qty + ownerChanged + adjusted_enterprise_qty
         = enterpriseOnHand + enterpriseConsumed
VMI-C 【商业，与物理解耦】
       billable_qty = commercialReleased     （不得用 received − consumed − transferred 冒充）
       settled_qty  <= commercialReleased    （不得重复结算）
       有效上限（防止对同一批超额释放）：
         commercialReleased <= ownerChanged + supplierConsumedDirect
       |unallocated_adjusted_qty| > VMI_ADJUSTMENT_TOLERANCE_QTY → 拒绝关期（409）
         （R4-05：**正负同等阻断**；默认容差 = 0，严格；
           非零容差属业务政策 → `M1-P-04`，本 Design 不自行选择）
         调整量归属不明时**不得擅自分配**到 supplier 或 enterprise 任一池
VMI-R 【结算行 closing，纯物理量】
       closing_supplier_qty   = opening_supplier_qty + received_qty
                               − supplier_consumed_qty − owner_changed_qty
                               − returned_qty + adjusted_supplier_qty
       closing_enterprise_qty = opening_enterprise_qty + owner_changed_qty
                               − enterprise_consumed_qty + adjusted_enterprise_qty
       closing_qty            = closing_supplier_qty + closing_enterprise_qty
       ⇒ owner_changed_qty 在两池之间**对冲**（供应商池 −、企业池 +），
         **不减少**两池合计：它是归属再分配，不是物理流出
       ⇒ commercial_released_qty / settled_qty **不进入** closing 公式
       ⇒ R4-5：`unallocated_adjusted_qty=0` 时 `closing_S + closing_E` 与 VMI-P 严格对账；
         非零时差额恰为该未归属残差，不得声称三式严格相等
VMI-L 【锁定与重算】
       settled_qty 单调不减，且每次增加都在同一事务内对结算行取锁后重读
       期间生成是**纯函数式重算 + 幂等 upsert**（同一 period_key 重放得到相同结果）
       关期前 VMI-S / VMI-E 必须各自对已归属池成立，VMI-P 必须对物理总量成立；
       二者差额必须显式等于 `unallocated_adjusted_qty`，且
       |unallocated_adjusted_qty| <= VMI_ADJUSTMENT_TOLERANCE_QTY，否则拒绝关期（409）

【R4-05 对账条款（VMI-P 与两池方程的机械关系）】
  (VMI-S + VMI-E) 的右端 ≡ VMI-P 的右端；两式的**左端**相差恰为
      unallocated_adjusted_qty
  ⇒ VMI-S / VMI-E / VMI-P **三者严格相等** ⟺ `unallocated_adjusted_qty = 0`
  ⇒ 关期时必须满足：
      (VMI-S + VMI-E 蕴含的池余额之和) − (VMI-P 蕴含的池余额之和)
        = unallocated_adjusted_qty
      且 |unallocated_adjusted_qty| <= VMI_ADJUSTMENT_TOLERANCE_QTY
  ⇒ 归属不明时**两个所有权池的恒等式不可能同时成立**（数值例见 §26.33.4.4 第 5 例）
```

**R4-05 复核要点（在 R3 的六条之上补充）**

| # | 要点 | 结论 |
|---|---|---|
| R3-1 | 期初不得被忽略 | 保留：VMI-P/S/E 的左端含 `opening_supplier_qty` / `opening_enterprise_qty` |
| R3-2 | 调整量必须有归属 | 保留并**强化**：拆为 `adjusted_supplier_qty` / `adjusted_enterprise_qty` / `unallocated_adjusted_qty`；归属不明者**不得擅自分配**，且**正负同等**阻断关期 |
| R3-3 | 超额释放有上限 | 保留：`commercialReleased <= ownerChanged + supplierConsumedDirect` |
| R3-4 | 结算不得超释放 | 保留：`settled_qty <= commercial_released_qty` |
| R3-5 | 商业量不进物理 closing | 保留：`commercial_released_qty` / `settled_qty` 不出现在 VMI-R 任何一项 |
| R3-6 | Owner Change 不是物理消耗 | 保留：`owner_changed_qty` 在两池对冲，不减少两池合计 |
| **R4-7** | **符号约定必须一致** | R4 统一为“有符号量、来源侧在左端”。R4-5 进一步澄清：VMI-S/E 各自成立，二者相加时 ownerChanged 对消；其与 VMI-P 的差额恰为 `unallocated_adjusted_qty`，只有残差为 0 时才严格相等 |
| **R4-8** | **过期 closing 公式** | **新发现**：§26.33.4.4 的"可复现"段落里 `closing_enterprise_qty` **遗漏 `+ adjusted_enterprise_qty`**，与本小节的 VMI-R 不一致 → 已补齐，两处逐字一致 |
| **R4-9** | **`returned_qty` 的池归属** | 固定为**供应商池退货**；企业池不设退货项 ⇒ VMI-P 的 `returnedOrCancelled` = `returned_qty`。本轮**不**臆造第二列 |
| **R4-10** | **容差是业务政策** | `VMI_ADJUSTMENT_TOLERANCE_QTY` 默认 **0**；非零值登记为 `M1-P-04`，**不**在本 Design 选定 |

**R3 复核要点（**已被上表取代**；保留原文以说明 R4 的更正动机）**

1. **期初不得被忽略**：R2 的 VMI-P/S/E 以 `received` 为左端，**没有期初项** —— 按期间计算时若忽略期初在库，恒等式会在跨期时失真。R3 把 `opening_supplier_qty` / `opening_enterprise_qty` 明确为左端项（取上一已关闭窗口的 closing）。
2. **调整量必须有归属**：`adjusted_qty` 单一列无法表达"属于哪个所有权池"。R3 拆为 `adjusted_supplier_qty` / `adjusted_enterprise_qty` / `unallocated_adjusted_qty`；**归属不明者不得擅自分配**，`unallocated_adjusted_qty > 0` 时**拒绝关期**。**（R4-05 更正：阻断判据必须是 `|unallocated| > 容差`，负值同样阻断；且 `adjusted_*` 的符号位置必须与 VMI-R 一致 —— 见上表 R4-7 / R4-8 / R4-10）**
3. **超额释放有上限**：`commercialReleased <= ownerChanged + supplierConsumedDirect`（可被商业释放的物理批次上界）—— 无此上限则同一批可被重复释放。
4. **结算不得超释放**：`settled_qty <= commercial_released_qty`。
5. **商业量不进物理 closing**：`commercial_released_qty` / `settled_qty` 不出现在 VMI-R 任何一项。
6. **Owner Change 不是物理消耗**：`owner_changed_qty` 在两池对冲，不减少两池合计（VMI-R 的 closing 之和不受其影响）。

**R2 纠正（保留）**：R1 的单式 `received = consumed + transferred + still_supplier_owned + returned_or_cancelled` 把**物理消耗**、**物权转移**与**商业释放**压进同一个词，导致两类重复扣减 —— 把 `ownerChanged` 当物理流出（`closing_qty` 少扣一次）、把 `commercialReleased` 当物理流出（再少扣一次）。R2 拆为五组，两类重复扣减**均已删除**；R3 在此基础上补齐期初、调整量归属与释放上限（§26.33.4.4 给出 D-1 / D-2a / D-2b / D-3 的数值例子，逐例满足 VMI-P / VMI-S / VMI-E / VMI-C）；**R4 在此基础上更正了调整量的符号位置与关期判据，并补齐五个含调整量的数值例子**。

#### 26.33.11 Error Behavior and Rollback

**错误契约**

| 场景 | HTTP | code | 说明 |
|---|---|---|---|
| 请求含不支持字段 | 400 | `VALIDATION` | `assertAllowedFields`（`http.js:105`） |
| 数量非正 / 非有限 | 400 | `VALIDATION` | |
| UOM 与物料行不一致 | 409 | `BUSINESS_RULE_BLOCKED` | `MATERIAL_UOM_MISMATCH` |
| 供应商无 WIP 仓 / 物料行无来源仓 | 409 | `BUSINESS_RULE_BLOCKED` | fail-closed |
| 通知容量超限 | 409 | `BUSINESS_RULE_BLOCKED` | `NOTIFY_CAPACITY_EXCEEDED`（修正 E-06 后的唯一入口） |
| 通知/PO 业务类型不匹配 | 409 | `BUSINESS_RULE_BLOCKED` | `RECEIPT_NOTICE_PO_TYPE_MISMATCH` |
| 库存不足 | 409 | `BUSINESS_RULE_BLOCKED` | `库存不足：position …`（既有文案） |
| 可估值库存不足 | 409 | `BUSINESS_RULE_BLOCKED` | `可估值库存不足；旧库存须在 Phase 6E 转换后使用`（既有文案） |
| 质量门禁未通过 | 409 | `BUSINESS_RULE_BLOCKED` | `委外完工入库单质量门禁未通过：…`（既有 `assertQualityGate` 文案） |
| 业务日期已结账 | 409 | `BUSINESS_RULE_BLOCKED` | `AP 业务日期 … 已结账至 …`（既有） |
| 会计/存货期间已结 | 409 | `BUSINESS_RULE_BLOCKED` | code `FINANCIAL_PERIOD_CLOSED` / `INVENTORY_PERIOD_CLOSED`（既有） |
| 委外凭证角色未映射 | 409 | `BUSINESS_RULE_BLOCKED` | `缺少会计科目角色映射: OUTSOURCING_…`（C-P01 前**故意**失败） |
| **委外过账无已批准会计政策（R2/C-04）** | 409 | `BUSINESS_RULE_BLOCKED` | `OUTSOURCING_GL_POLICY_NOT_APPROVED` —— 账单保持 DRAFT，零 AP open item / 零凭证 / 零分录；**发生在任何 Finance 写入之前** |
| **通知来源未解析（R2/C-01）** | 409 | `BUSINESS_RULE_BLOCKED` | `RECEIPT_NOTICE_SOURCE_UNRESOLVED` —— 该通知行只有未解析来源登记，禁止转换 |
| **通知来源不完整（R2/C-01）** | 409 | `BUSINESS_RULE_BLOCKED` | `RECEIPT_NOTICE_SOURCE_INCOMPLETE` —— 同一通知行既有已解析来源又有未解析登记 |
| **通知来源与请求不符（R2/C-01）** | 409 | `BUSINESS_RULE_BLOCKED` | `RECEIPT_NOTICE_SOURCE_MISMATCH` —— 请求引用的 PO 行不在该通知行的已解析来源集合内（表头兼容字段不可作为来源） |
| **通知来源事实缺失（R3/C-01）** | 409 | `BUSINESS_RULE_BLOCKED` | `RECEIPT_NOTICE_SOURCE_ABSENT` —— 该通知行既无已解析来源、也无未解析登记（fail-closed，不得按"无来源即无约束"放行） |
| **历史收货未生效（R2/C-08）** | 409 | `BUSINESS_RULE_BLOCKED` | `OUTSOURCING_RECEIPT_NOT_EFFECTED` —— `effectiveState='LEGACY_UNVERIFIED'`，不可开票、不可退货 |
| **委外估值未达 POSTED（R2/C-06）** | 409 | `BUSINESS_RULE_BLOCKED` | `委外估值必须为 POSTED 估值事件，不得使用 LEGACY_UNVALUED 回退` → 整体回滚 |
| **委外物理流水未被标记已估值（R2/C-06）** | 409 | `BUSINESS_RULE_BLOCKED` | `委外物理流水未被标记为已估值` → 整体回滚 |
| 重复幂等键 | 200 + `replayed: true` | — | canonical `idempotencyReplay` |
| 缺 Idempotency-Key | 400 | `VALIDATION` | `关键过账操作必须提供 Idempotency-Key`（既有） |
| 权限不足 | 403 | `PERMISSION_DENIED` | 既有 |

**R4 新增错误码（全部 fail closed；409 = `BUSINESS_RULE_BLOCKED`，400 = `VALIDATION`）**

| 场景 | HTTP | code | 触发条件 |
|---|---|---|---|
| **R4-01 物理腿撞键（非预期重放）** | 409 | `INVENTORY_MUTATION_UNEXPECTED_REPLAY` | 某条物理腿的 `mutation.replayed === true`，但整条业务事件**未**命中 canonical 幂等 ⇒ 该腿撞上了既有 `inventory_mutation_log` 行 ⇒ 整笔回滚 |
| **R4-01 实际腿数与预期不符** | 409 | `INVENTORY_MUTATION_LEG_COUNT_MISMATCH` | 实际写入腿数 ≠ 预期腿数（多物料倒冲 / SERIAL 拆分）⇒ 整笔回滚 |
| **R4-02 转移量超过源行可用 WIP** | 409 | `WIP_TRANSFER_EXCEEDS_AVAILABLE` | `q_requested > WIP_before(源行)`（加锁重读后求值） |
| **R4-03 转移动用了归属不可证的历史量** | 409 | `WIP_TRANSFER_LEGACY_UNVERIFIED` | `q_requested > supplier_wip_available(源行)`（即触及 `legacy_unverified_wip_quantity`） |
| **R4-03 历史转移行源行不可确定** | 409 | `WIP_TRANSFER_LEGACY_UNRESOLVED` | 该转移行 `source_resolution_state='UNRESOLVED'`（`source_material_list_id IS NULL`）⇒ 其数量不参与任何新的可转出量计算 |
| **R4-03 倒冲触及归属不可证的历史量** | 409 | `BACKFLUSH_LEGACY_IDENTITY_UNVERIFIED` | 物料行 `identity_evidence_state='UNVERIFIED'` 且本次倒冲量超过其 `supplier_wip_available` |
| **R4-04 产品不相容** | 409 | `WIP_TRANSFER_PRODUCT_MISMATCH` | 源/目标物料行 `product_id` 不等 |
| **R4-04 UOM 不相容** | 409 | `WIP_TRANSFER_UOM_MISMATCH` | 源/目标物料行 `unit` 不等（**不做静默换算**） |
| **R4-04 供应商不相容** | 409 | `WIP_TRANSFER_SUPPLIER_MISMATCH` | 源/目标委外订单 `supplier_id` 不等 |
| **R4-04 供应商 WIP 仓缺失** | 409 | `WIP_TRANSFER_WAREHOUSE_MISSING` | 源或目标订单的供应商未配置（或仓库未启用）`supplier_wip_warehouse_id` |
| **R4-04 供应商 WIP 仓不相容** | 409 | `WIP_TRANSFER_WAREHOUSE_MISMATCH` | 两订单的供应商 WIP 仓不同 ⇒ 该动作是**物理转移**而非归属再分配 ⇒ 无独立设计即拒绝 |
| **R4-04 身份证据不相容** | 409 | `WIP_TRANSFER_IDENTITY_MISMATCH` | `identities[]` 的分区与源行已发往 WIP 仓的身份证据不匹配，或 Σ 分区数量 ≠ `quantity` |
| **R4-05 未归属调整量超出容差** | 409 | `VMI_UNALLOCATED_ADJUSTMENT_EXCEEDS_TOLERANCE` | `\|unallocated_adjusted_qty\| > VMI_ADJUSTMENT_TOLERANCE_QTY`（默认 0；**正负同等阻断**） |
| **R4-06 解析不完整** | 409 | `RECEIPT_NOTICE_RESOLUTION_INCOMPLETE` | 置 `RESOLVED` 时已解析来源行为空，或其分配量之和 ≠ 原未解析量 |
| **R4-06 解析说明缺失** | 409 | `RECEIPT_NOTICE_RESOLUTION_NOTE_REQUIRED` | 置 `RESOLVED` 时 `resolution_note` 或 `resolved_at` 为空 |
| **R4-06 来源超额分配** | 409 | `RECEIPT_NOTICE_SOURCE_OVERALLOCATED` | `Σ(已解析 allocated_quantity) + Σ(未解析 quantity) > receipt_notice_items.quantity` |
| **R4-5 来源行可转换容量未知** | 409 | `RECEIPT_NOTICE_SOURCE_CAPACITY_UNKNOWN` | `converted_quantity IS NULL`；正向转换 fail closed。另保留只读诊断 `NOTICE_LEGACY_CONVERSION_UNRESOLVED`，订单级仍按全量保守预留 |
| **R4-11 来源行分配余量不足** | 409 | `RECEIPT_NOTICE_SOURCE_EXHAUSTED` | `q > sourceRowRemaining(s)`（`allocated − converted`） |
| **R4-11 PO 行剩余不足** | 409 | `RECEIPT_NOTICE_PO_LINE_EXCEEDED` | `q > poLineRemaining(poItem)` |
| **R4-11 交期剩余不足** | 409 | `RECEIPT_NOTICE_SCHEDULE_EXCEEDED` | `q > scheduleRemaining(schedule)`（含上容差） |
| **R4-5 交期消费量不可证** | 409 | `RECEIPT_NOTICE_SCHEDULE_CAPACITY_UNKNOWN` | 多交期 PO 行存在无法唯一归属到 `schedule_consumption_effects` 的历史已确认收货；不得把 `received_quantity=0` 当证据 |
| **R4-11 交期与 PO 行不匹配** | 409 | `RECEIPT_NOTICE_SCHEDULE_MISMATCH` | `delivery_schedule.order_item_id != purchaseOrderItemId` |
| **R4-5 交期必须明确绑定** | 409 | `RECEIPT_NOTICE_SCHEDULE_REQUIRED` | 多条有效交期未指定；或零有效交期且无获批的无交期路径。省略参数不得绕过交期容量 |
| **R4-11 供应商不相容（通知来源）** | 409 | `RECEIPT_NOTICE_SUPPLIER_MISMATCH` | 来源 PO 行的 `supplier_id` ≠ 通知的 `supplier_id` |
| **R4-11 仓库不相容（通知来源）** | 409 | `RECEIPT_NOTICE_WAREHOUSE_MISMATCH` | 收货仓 ≠ 通知的 `warehouse_id`（STANDARD_PURCHASE）或 ≠ 服务端解析的 OUTSOURCE 目标仓 |
| **R4-10 账单行超额预留** | 409 | `PROCESSING_FEE_OVER_RESERVED` | 账单行 `reservation_state='OVER_RESERVED'` ⇒ 该行不得过账（账单保持 DRAFT，零 AP/GL 写入） |
| **R4-5 POSTED 超额处置政策待决** | 409 | `POSTED_RESERVATION_POLICY_PENDING` | 退货将使已 POSTED 账单行超额且 C-P03 未裁定；退货零副作用。既存历史异常只标记/报告，不自动反向 AP/GL |

**R4-6 新增错误码（全部必须在副作用前或事务内回滚）**

| 场景 | HTTP | code | 触发条件 |
|---|---|---|---|
| 交期反向 effect 超限 | 409 | `SCHEDULE_EFFECT_REVERSAL_EXCEEDED` | 反向数量超过原正向 effect 的未冲销量 |
| 交期反向来源不一致 | 409 | `SCHEDULE_EFFECT_REVERSAL_MISMATCH` | 原 effect 不存在，或 PO 行/交期不一致 |
| 通知转换取消释放政策未证明 | 409 | `NOTICE_CONVERSION_RELEASE_POLICY_UNPROVEN` | 试图因取消/退货减少 `converted_quantity` 或重新开放通知来源容量 |
| VMI 期间重叠 | 409 | `VMI_SETTLEMENT_PERIOD_OVERLAP` | 同 agreement 的闭区间窗口重叠 |
| VMI 首期期初不可证 | 409 | `VMI_OPENING_BALANCE_UNPROVEN` | canonical owner position 快照不完整/含 legacy 未归属量 |
| VMI 部分结算政策未批准 | 409 | `VMI_PARTIAL_SETTLEMENT_POLICY_PENDING` | D-P01/D-P02 前尝试生成 bill allocation |
| 委外会计政策多匹配 | 409 | `OUTSOURCING_GL_POLICY_AMBIGUOUS` | 业务日命中多条 active policy；不得任选一条 |
| 外部幂等键冲突 | 409 | `IDEMPOTENCY_KEY_CONFLICT` | 相同 scope/key 携带不同规范化 fingerprint |

**R4-6-R1 新增错误码（全部 fail closed；409 = `BUSINESS_RULE_BLOCKED`，400 = `VALIDATION`）**

| 场景 | HTTP | code | 触发条件 |
|---|---|---|---|
| 身份级可用量不足（倒冲） | 409 | `BACKFLUSH_INSUFFICIENT_VERIFIED_WIP` | `q > outsourcing_wip_identity_balances(material_list_id, identity_key).available_quantity`（**证据级**授权，R4-6-R1 权威码；行级数量充足**不构成**放行理由） |
| 身份级可用量不足（退料） | 409 | `RETURN_IDENTITY_UNVERIFIED` | `q > available_quantity(identity)`（退料同样只能消费已验证证据层） |
| 身份证据缺失 | 409 | `WIP_IDENTITY_EVIDENCE_MISSING` | 正向身份事件**缺少其事件类型所要求的物理背书**（R4-6-R2：`ID-INDEP-1` 事件类型 × tracking_policy 矩阵）—— ISSUE/SUPPLEMENT/RETURN/BACKFLUSH 缺 canonical WIP 仓腿或缺 tracked movement；TRANSFER_OUT/TRANSFER_IN 缺来源分配 |
| 跟踪品缺身份 | 409 | `WIP_IDENTITY_REQUIRED` | LOT/SERIAL 跟踪品请求缺 `lotId`/`serialId`，**不得**以 `identity_key='NONE'` 落账（`ID-INDEP-2`） |
| 身份独立性不可证 | 409 | `WIP_IDENTITY_INDEPENDENCE_UNPROVEN` | SERIAL 独占性冲突，或 TRANSFER_IN 未继承源 TRANSFER_OUT 的来源构成（`ID-INDEP-3`） |
| 残差与身份冲突 | 409 | `WIP_IDENTITY_RESIDUAL_CONFLICT` | 新正向事件试图减少隔离残差，或历史对账未扣除已声明证据量（`ID-INDEP-4`） |
| 身份不可分辨 | 409 | `WIP_IDENTITY_NOT_RESOLVABLE` | 请求身份在证据层无余额而行级可用量 > 0 ⇒ 整行阻断，不得按数量猜测（`ID-INDEP-5`） |
| 身份层对账失败 | 409 | `WIP_IDENTITY_RECONCILIATION_FAILED` | `supplier_wip != legacy_unverified_wip_quantity + verified_tracked_wip + verified_quantity_only_wip`（INV-WIP-7，**R4-6-R2 三种数量**） |
| 身份层与物理层不一致 | 409 | `WIP_IDENTITY_PHYSICAL_MISMATCH` | 身份余额超过该身份在 WIP 仓的物理可证明量（INV-WIP-10） |
| 交期负向 effect 归属不可证 | 409 | `RECEIPT_NOTICE_SCHEDULE_CAPACITY_UNKNOWN` | 历史负向事实无法绑定到原始正向 effect / PO 行 / 交期；该 PO 行交期容量授权 fail closed（**不猜测、不自动冲减**） |

**R4-6-R2 新增错误码（全部 fail closed；409 = `BUSINESS_RULE_BLOCKED`，400 = `VALIDATION`）**

| 场景 | HTTP | code | 触发条件 |
|---|---|---|---|
| 证据层与 tracking_policy 不匹配 | 409 | `WIP_IDENTITY_POLICY_MISMATCH` | `evidence_state='QUANTITY_ONLY'` 的余额被用于授权 LOT/SERIAL 产品；或 `evidence_state='TRACKED'` 却绑定 `identity_type='NONE'`（`ID-INDEP-6`） |
| 来源分配不完整 | 409 | `WIP_IDENTITY_ALLOCATION_INCOMPLETE` | `Σ CONSUMPTION allocations ≠ \|effect.signed_quantity\|`；或 `Σ TRANSFER_ORIGIN allocations ≠ TRANSFER_IN quantity`；或消费 effect 完全没有来源分配（`ID-INDEP-7` / INV-WIP-11） |
| 来源供应量已用尽 | 409 | `WIP_IDENTITY_SUPPLY_EXHAUSTED` | 分配量超过来源 supply effect 的 `remaining_supply`（`remaining_supply(source) >= 0` 被破坏） |
| 转移来源构成不匹配 | 409 | `WIP_IDENTITY_ALLOCATION_MISMATCH` | TRANSFER_IN 的 `TRANSFER_ORIGIN` 分配与同一转移事件的 TRANSFER_OUT 的 `CONSUMPTION` 分配**未逐项完全对应**（数量或来源构成不等） |
| 成品退货明细不可归属 | 409 | `OUTSOURCING_RETURN_ITEM_UNPROVEN` | 退货明细**无法唯一**对应原始委外收货明细 / PO 行 / 交期 / 原始正向交期 effect ⇒ 标记 `LEGACY_SCHEDULE_UNPROVEN` 并阻止该交期容量授权（**不得按收货数量比例分配交期**） |

**关键修正：消除 500。** 现状 `createProcessingFeeBill` 缺 `supplierInvoiceNo` / `billDate` 时，NOT NULL 约束冲突在 SQLite 与 MySQL 上都**不是** `HttpError`，落入 `app.js:2303-2307` 的兜底 → **500 `服务器内部错误`**。本 Design 要求所有新增/修改的 handler 在写库**之前**用 `requiredText` / `normalizeBusinessDate` 校验必填字段（`http.js:111/127`），使这类失败变成 400 而非 500。

**零副作用保证**：所有错误路径必须在**事务内**抛出，使业务行、库存位、估值余额、AP open item、审计行**同时**回滚。任何“先写业务、后失败”的形态（例如现状 `confirmOutsourcingReceipt` 先写 `inventory_transactions` 再写估值）都不允许。

#### 26.33.12 13-Gate Acceptance Design

**证据层级标注**：`L1` = 生产 API 造数；`L2` = 直接调用领域函数；`L3` = 直接 SQL 造数（**不可**作为通路证据）。

| Gate | 对应 Requirement / Capability | 前置数据创建方式 | 证据层 | 成功断言 | 拒绝断言 | 零副作用断言 | 状态 |
|---|---|---|---|---|---|---|---|
| `M1-GA01` | A-REQ-01；OUT-18..22 | **L1**：`POST /api/procurement/outsourcing/receipts`（带 items）→ IQC `POST /api/iqc` | HTTP + SQLite/MySQL | 收货表头 + ≥1 明细落库；明细非空且 `processing_po_item_id` 可追；IQC 从**正式明细**可达并可完成 PASS | 缺 items → 400；items 为空数组 → 400；明细 product 与 processing PO 行不匹配 → 409 | 校验失败时收货/IQC/库存/估值全部零写入 | 设计完成，**未运行** |
| `M1-GA02` | A-REQ-02/03；PRC-16/20/22 | 多 PO 通知 → 转换 → 普通采购/委外收货；直接 PO 收货同样消费交期账本 | HTTP + MySQL race | 四重容量同时成立；`converted_quantity=NULL` 不产生可转换容量；唯一有效交期可确定性绑定，多交期必须显式指定；所有收货/反向路径共用 `schedule_consumption_effects` | 省略交期不得绕过；多交期未指定、零交期未裁定、历史消费不可证、来源容量未知均 409 | 失败时收货、库存、估值、通知与交期 effect 零变化 | 设计完成；历史/零交期子项 `TECHNICAL_CONTRACT_UNPROVEN`，未运行 |
| `M1-GA03` | A-REQ-04/05；OUT-17/19 | L1：委外订单 → 完成通知 → 待检收货 → IQC PASS → 生效 | HTTP + Quality + Inventory | 正确来源链；未检/PASS/FAIL/WAIVED 各状态的库存效力时点正确；FAIL 时库存/成本零副作用 | FAIL 或未检时生效 → 409；通知容量超限 → 409（E-06 修正后） | FAIL/超限时库存、估值、成本证据、审计零写入 | 设计完成，**未运行** |
| `M1-GB01` | B-REQ-01/02；OUT-11..16 | L1：物料行 → 发料/补料/退料 | HTTP + Inventory snapshots | 沿 canonical 库存位写真实库存；企业所有权不变；内部仓与 WIP 仓数量与流水可对账；**R4-01：多物料倒冲与 SERIAL 拆分各自产生互不撞键的物理腿（实际腿数 == 预期腿数）** | 无 WIP 仓 → 409；库存不足 → 409；UOM 不符 → 409；重放 → 幂等；**R4-01：撞键 → 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`（不得静默丢弃）** | 失败时库存、估值、业务单据、审计零写入 | 设计完成，**未运行** |
| `M1-GB02` | B-REQ-03；OUT-16/21 | L1：发料 → 分批完工 → 生效 | HTTP + Valuation snapshots | 增量倒冲公式正确；材料成本来自 canonical 池分摊（非全局平均价）；材料 + 加工费暂估证据一致 | 增量 < 0 或 > 净供应 → 409；重复确认不得双扣/双收 | 重复/并发时零重复扣减 | 设计完成，**未运行** |
| `M1-GB03` | B-REQ-04/05；OUT-23 | L1：制造差异 → preview → apply；**R4-04：跨单 WIP 转移（含五项相容性）** | HTTP + approval + period | 盘点**多**→退料候选、**少**→补料候选，方向由差额导出；跨单 WIP 迁移数量守恒、成本携带；**R4-02：`WIP_after = WIP_before − q ≥ 0` 逐行成立；R4-03：历史隔离量不可被新转移动用；R4-04：产品/UOM/供应商/供应商 WIP 仓/身份五项相容** | 方向由客户端指定 → 400；数量超出差额 → 409；无审核直接生效 → 409；**R4-02：`q > WIP_before` → 409；R4-03：触及隔离量 → 409；R4-04：任一不相容 → 409** | — | **BLOCKED（B-P01/B-P02）** |
| `M1-GC01` | C-REQ-01/04；OUT-20 | 委外收货明细 → 部分账单 → 过账；退货导致未过账/POSTED 预留超额 | HTTP + Finance | active 预留三段式容量；DRAFT/WAITING_MATCH 超额阻断过账；POSTED 超额保留数量、金额、AP/GL 与审计并派生历史异常，绝不自动反向 | 过账 OVER_RESERVED → 409；退货将制造 POSTED 超额且 C-P03 未裁定 → 409 `POSTED_RESERVATION_POLICY_PENDING`、零副作用 | 失败时业务、AP/GL、审计零写入；既存 POSTED 异常只报告 | 设计完成，政策段 BLOCKED，未运行 |
| `M1-GC02` | C-REQ-02/03/04 | L1：过账 → 贷项/红冲 | Finance + Accounting reconciliation | 来源与金额对账、期间/冲销可查 | 缺会计角色映射 → 409（**裁定前故意失败**） | — | **BLOCKED（C-P01..C-P04）** |
| `M1-GD01` | D-REQ-01/02；VMI-04 | L1：VMI 协议 → 收货 → 消耗 → 结算期；含正/负调整量与未归属调整量 | HTTP + Inventory + period | 期间汇总可复现；Owner Change 物理净 0；VMI-S/E 对各自已归属池精确成立；`VMI-P − (VMI-S+VMI-E) = unallocated_adjusted_qty`；仅残差 0 时三式严格相等；physical/commercial residual 分开报告 | 已消耗量再转移、重叠期间、期初不可证、重复释放、默认零容差下 unallocated 非 0 → 409 | 失败时库存位、期间与结算行零变化 | **BLOCKED（D-P01）** |
| `M1-GD02` | D-REQ-02；VMI-05 | L1：结算期 → 释放 → 生成账单 | HTTP + Finance | 账单由权威价格源生成；无重复结算；无客户端传入 ID | 客户端传金额/账单 ID → 400 | — | **BLOCKED（D-P02）** |
| `M1-GU01` | U-REQ-01 | 无（浏览器） | Browser | 两个工作面无 `api.get/post` TypeError；320/390/430/680 四宽度交互成功；server 端 RBAC 生效 | 无权用户访问 → 页面级处理 + server 403 | — | 设计完成，**未运行** |
| `M1-GT01` | T-REQ-02；§31.8.E | L1：真实 Domain Handler | Real MySQL 8 concurrency | 11 项同资源竞争：一方成功/另一方合规拒绝或确定性串行；零重复写入；零部分副作用 | 每项都必须有**拒绝方**的零副作用快照 | 每项都必须有权威库存/AP/收货行前后快照 | 设计完成，**未运行** |
| `M1-GT02` | D-REQ-03；G-5 / T-01 | L1 | Browser/HTTP + Inventory | UAT-14 正向 VMI Owner Dimension；库存 UAT-20 保留全段 **+50** 算术并**新增**独立 `OWNER_CHANGE` Handler Gate（断言 SUPPLIER 位 −20、ENTERPRISE 位 +20、总和不变）；**旧 oracle 的 409 期望按已批准的 `document.md §31.12.6`（D-REQ-03）在 Implementation 中纠正为创建 201 / 确认 200** —— 这是**已批准的 Requirement 义务**，不再作为业务政策待决（C-10） | 旧 oracle 仍期望 409 → 在 Implementation 中按 D-REQ-03 纠正（**已批准义务**，非待裁定项） | — | 设计完成，**未运行** |

**13 个 Gate 的 Requirement ↔ Design ↔ Gate 三方追踪（R1 复核 + R2 更新 + R3 状态双维度化）**

**状态双维度定义（R3 明确；全文不再混用）**

| 维度 | 含义 | 取值 |
|---|---|---|
| `execution_status` | 该 Gate **是否被执行过** | 13 个 Gate **全部** `NOT_RUN` —— 本轮及此前**从未运行**任何 Gate，**无任何 PASS** |
| `readiness_status` | 该 Gate 的**设计就绪状态** | 9 个 `NOT_RUN`（设计与断言已就绪，待执行）、4 个 `BLOCKED`（被**未获批准的业务政策**阻塞） |

- `readiness_status = BLOCKED` 的 **4 个** Gate：`M1-GB03`、`M1-GC02`、`M1-GD01`、`M1-GD02`（R2 文中曾写"五个 `BLOCKED` Gate"，是把 `M1-GB02` 的**成本断言段**误计为一个 Gate —— 该段是 Gate 内部的**分段**，不是独立 Gate；R3 已更正为 4）。
- `M1-GB02` 的**成本断言段**单独标记为 `BLOCKED`（`M1-P-02`），但该 Gate 本身的 `readiness_status` 为 `NOT_RUN`。

| Gate（`document.md §31.12.9`） | 对应 Requirement | Design 小节（唯一权威） | 关键可测不变量 | `execution_status` | `readiness_status` |
|---|---|---|---|---|---|
| `M1-GA01` | A-REQ-01；OUT-18..22 | §26.33.4.1 / §26.33.5.1 / §26.33.6.1 | 表头+明细原子、零空明细、IQC 从正式明细可达 | `NOT_RUN` | `NOT_RUN` |
| `M1-GA02` | A-REQ-02/03；PRC-20/22 | §26.33.4.1 / §26.33.4.7.1 / §26.33.5.1 / §26.33.8 | `M1-D-02` 行级来源；**C-01 来源唯一性与未解析阻断（含 R4-06 的 `RESOLVED` 完整性）**；E-06 容量不变式（§26.33.5.1）；**R4-11 四重上界（通知行分配剩余 / PO 行剩余 / 交期与上容差 / 委外订单剩余）+ 供应商与仓库相容 + 累计转换量单调** | `NOT_RUN` | `NOT_RUN` |
| `M1-GA03` | A-REQ-04/05；OUT-17/19 | §26.33.5.1 / §26.33.4.5 | 两段式状态机与质量门禁时点；`M1-F-09` 白名单扩展；**C-08 历史 `CONFIRMED` 证据判定（E1/E2/E3）** | `NOT_RUN` | `NOT_RUN` |
| `M1-GB01` | B-REQ-01/02；OUT-11..16 | §26.33.4.2 / **§26.33.4.6.1** / §26.33.4.7.2 / §26.33.5.2 | INV-1/2/3、**VAL-4b**、VAL-8、**VAL-12（分三方向）**、**C-05 业务事件 ID 与多次合法发料**；**五字段 Mutation Key（SOURCE_TYPE + 四个区分维度）与"非预期重放 / 实际腿数 == 预期腿数"两条硬断言** | `NOT_RUN` | `NOT_RUN` |
| `M1-GB02` | B-REQ-03；OUT-16/21 | **§26.33.4.6.2** / §26.33.5.2 / §26.33.10.2 | VAL-1/5/**6/7/9**、**VAL-10/11** | `NOT_RUN` | `NOT_RUN`；**成本断言段单独 `BLOCKED`（`M1-P-02`）** |
| `M1-GB03` | B-REQ-04/05；OUT-23 | §26.33.5.2 / §26.33.4.2 | 差异方向由差额导出；`ALLOCATED→APPLIED` 审核存在性；**C-02 WIP 转移守恒**；**R4-02 的 `WIP_before / q / cum_transferred_out / WIP_after` 四量断言 + INV-WIP-1b 逐行非负**；**R4-03 的历史隔离（`supplier_wip_available`）与 `quantity_accounting` / `identity_state` 声明**；**R4-04 的五项相容性门禁** | `NOT_RUN` | **`BLOCKED`（B-P01/B-P02）** |
| `M1-GC01` | C-REQ-01；OUT-20 | §26.33.4.3 / §26.33.6.3 / §26.33.8 / §26.33.10.3 | **AP-1..AP-5 三段式容量 + R3 四项边界**；期间与业务日守卫；来源三元组；**C-04 过账合规拒绝（GL-3/GL-4）**；**C-08 只允许 `EFFECTED_CONFIRMED` 收货开票**；**R4-10 的 `OVER_RESERVED` 持久模型（行级标记、仍属 active 预留、确定性识别、被阻止过账、取消后只重算标记）** | `NOT_RUN` | `NOT_RUN` |
| `M1-GC02` | C-REQ-02/03/04 | §26.33.4.3 / §26.33.10.4 | GL-1/GL-2；**GL-3/GL-4/GL-5 source-aware 门禁** | `NOT_RUN` | **`BLOCKED`（C-P01..C-P04）** |
| `M1-GD01` | D-REQ-01/02；VMI-04 | §26.33.4.4 / §26.33.5.4 / §26.33.10.5 | VMI-P/S/E/C/R/L；`VMI-P − (VMI-S+VMI-E)=unallocated`，仅 residual=0 时严格相等；物理/商业/未分配/容差政策四类结果分开；期间重叠与首期快照门禁 | `NOT_RUN` | **`BLOCKED`（D-P01）** |
| `M1-GD02` | D-REQ-02；VMI-05 | §26.33.4.4 / §26.33.6.4 | **VMI-C**（`billable = commercialReleased`，含释放上限）；**VMI-L**（结算防重）；权威价格源 | `NOT_RUN` | **`BLOCKED`（D-P02）** |
| `M1-GU01` | U-REQ-01 | §26.33.4.5 / §26.33.6.5 | 10 处调用点；四宽度交互；server 端 RBAC | `NOT_RUN` | `NOT_RUN` |
| `M1-GT01` | T-REQ-02；§31.8.E | §26.33.12 RACE 表 / §26.33.8 | RACE-01..RACE-11 真实 Handler；零重复写入；零部分副作用；**C-05 业务事件 ID 的并发安全**；**R4-6-R1 新增四个子场景 RACE-05a / RACE-06a / RACE-10a / RACE-11a（交期正向 effect、交期负向 effect、会计政策有效区间、VMI 结算期间重叠）** | `NOT_RUN` | `NOT_RUN` |
| `M1-GT02` | D-REQ-03；G-5 / T-01 | §26.33.4.4 / §26.33.12 | UAT-14 正向；`OWNER_CHANGE` 物理净 0；**旧 oracle 的纠正为已批准 Requirement 义务（C-10）** | `NOT_RUN` | `NOT_RUN` |

**追踪结论（R3 更新）**：§31.12.9 的 13 个 Gate **全部**在 §26.33 有唯一对应的设计小节与可测不变量，**无一遗漏**；R1、R2、R3 三轮修订**均未新增、删除或合并**任何 Gate，**编号不变**，`execution_status` **13 个全部 `NOT_RUN`**（无任何 PASS），`readiness_status` **9 个 `NOT_RUN` + 4 个 `BLOCKED`**。4 个 `BLOCKED` Gate 的阻塞源分别是 `B-P01`/`B-P02`（GB03）、`C-P01..C-P04`（GC02）、`D-P01`（GD01）、`D-P02`（GD02）—— 全部是**未获批准的业务政策**，不是技术缺口。**技术合同修正不得自动解除任何业务政策阻塞。**

**R4-6 Gate 断言增量（不改编号与状态）**：

- `M1-GA02`：补单交期历史 effect 确定性回填、直接 PO 收货绑定、负向 effect 原行/同 PO/同交期/累计上限、重复反向事件防重；T-10/T-11 不可证分支必须 fail closed。
- `M1-GB01/GB02`：按 Issue/Supplement/Return 的 MOVE 双腿、Backflush 单 OUT 增量腿分别断言物理/跟踪/估值；不得再要求 WIP Transfer 产生物理/估值腿。
- `M1-GB03`：补隔离桶生命周期场景 `100/100/0 → 150/100/50`，倒冲 60 拒绝、倒冲 50 仅在其它门禁通过时允许；负向动作永不消费隔离量。
- `M1-GC01/GC02`：补 source-aware 门禁先于 AP/GL、policy 区间唯一、实物退货/贷项/AP/GL 四层副作用矩阵；C-P03 前后三层保持 BLOCKED。
- `M1-GD01`：分别断言 physical residual、commercial residual、unallocated adjustment 与 tolerance policy state；期间重叠、首期期初不可证均拒绝；M1-P-04 仍 pending。
- `M1-GD02`：补 bill allocation 防重和多账单追踪；D-P01/D-P02 前生成部分结算账单必须合规拒绝。
- `M1-GT01`：新增交期正/负 effect 并发、VMI 重叠窗口并发、会计政策区间并发三类真实 Handler race；只能在独立 disposable MySQL 目标且另获 destructive 授权后执行。

**R4-6-R1 Gate 断言增量（不改编号、不改状态、不新增 Gate）**

> **R4-6-R1 授权来源**：业务所有者《R4-6-R1 — Bounded Technical Contract Correction》要求在**现有 Gate 内**补强断言，**不新增 Gate**。13 个 Gate 的 `execution_status` 仍为 **13/13 `NOT_RUN`**，`readiness_status` 仍为 **9 `NOT_RUN` + 4 `BLOCKED`**（GB03 / GC02 / GD01 / GD02）。

| Gate | R4-6-R1 追加断言（全部为**可测**断言；任一失败 ⇒ 该 Gate 不得 PASS） | 失败时零副作用要求 |
|---|---|---|
| `M1-GB01` | **证据级正向断言**：Issue / Supplement 后，`outsourcing_wip_identity_balances` 出现对应 `(material_list_id, identity_key)` 余额行，`available_quantity` == 本次补料量；`outsourcing_wip_identity_effects` 恰好一条 `SUPPLY` effect。**R4-6-R2 追加**：`evidence_state` 必须与产品 tracking_policy 匹配（LOT/SERIAL ⇒ `TRACKED`；NONE ⇒ `QUANTITY_ONLY`）；`NONE` **不得**被用于 LOT/SERIAL 产品（⇒ 409 `WIP_IDENTITY_POLICY_MISMATCH`）。**证据级拒绝断言**：跟踪品缺 `lotId`/`serialId` → 409 `WIP_IDENTITY_REQUIRED`；SERIAL 身份独占性冲突 → 409 `WIP_IDENTITY_INDEPENDENCE_UNPROVEN`；缺 `ID-INDEP-1` 矩阵所要求的物理背书 → 409 `WIP_IDENTITY_EVIDENCE_MISSING` | 拒绝时证据层余额、effect、业务行、库存、跟踪、估值、审计**全部零写入** |
| `M1-GB02` | **证据级负向断言**：Backflush 只消费 `available_quantity(identity)`；**倒冲 60 被拒**（`100/100/0` 场景下 `available(identity)=50`）⇒ 409 `BACKFLUSH_INSUFFICIENT_VERIFIED_WIP`；**倒冲 50 成功**（须同时通过证据、库存、估值与业务门禁）⇒ 过账后 `supplier_wip=100 / legacy=100 / verified_tracked=0 / verified_quantity_only=0 / available=0`。**R4-6-R2 追加**：每个 CONSUME effect 必有 `CONSUMPTION` allocation 且分配合计 == 消费量的绝对值；`remaining_supply(source) >= 0`；`Σ allocations == \|effect\|`（INV-WIP-11）。**逐行对账**：每行 `supplier_wip == legacy_unverified_wip_quantity + verified_tracked_wip + verified_quantity_only_wip`（INV-WIP-7） | 拒绝时**零**物理腿、**零**跟踪行、**零**估值行、**零**身份层 effect、**零**allocation、**零**业务计数器变化 |
| `M1-GB03` | **残差不变性断言**：`100/100/0 → 补料 50 → 150/100/50` 场景中，`legacy_unverified_wip_quantity` **两次均为 100**（INV-WIP-9）；**行级 `identity_evidence_state` 仍为 `UNVERIFIED`**（不得因新补料变成 `VERIFIED`）；**错误 LOT 拒绝** ⇒ 409；**SERIAL 身份错配拒绝** ⇒ 409；**无法证明身份独立性时拒绝** ⇒ 409 `WIP_IDENTITY_INDEPENDENCE_UNPROVEN`；**并发消费同一身份时仅允许合法的一方成功**，另一方 409 且零副作用 | 拒绝方：身份层余额、effect、transfer 事实、计数器、审计**全部零变化** |
| `M1-GA02` | **正负 effect 生命周期断言**：DRAFT 收货与 DRAFT 通知**不产生**任何 effect；已生效收货确认**产生**正向 effect（同一事务内）；已生效收货退货确认**产生**负向 effect（同一事务内）；**未生效单据取消不产生负向 effect**；**仅改状态、无真实反向流水的"取消/冲销"不产生负向 effect**且该 PO 行容量 fail closed。**数值证明**：`+100` 与 `−30` 保留为**两条独立事实**，净消费 = **70**（不是 100）；两次部分退货（−30、−20）净 50；第三次超额退货 409；累计反向超过原量 409；历史退货找不到原始 effect ⇒ `LEGACY_SCHEDULE_UNPROVEN` 且**不自动冲减**。**R4-6-R2 追加（成品退货明细级）**：退货请求必须携带 `items[].outsourcingReceiptItemId`；每条明细关联真实原始收货明细、属于该收货单、累计不超原始数量、**唯一**对应原始正向交期 effect；负向 effect 的 `reverses_effect_id` == 原始正向 effect id 且 `0 < q ≤ reversible_remaining`；不可唯一归属 ⇒ 409 `OUTSOURCING_RETURN_ITEM_UNPROVEN` + `LEGACY_SCHEDULE_UNPROVEN`，**不得按比例分配** | 失败时收货、退货、退货明细、库存、估值、交期账本、审计**全部零变化** |
| `M1-GT01` | **四个新增子场景**（RACE-05a / RACE-06a / RACE-10a / RACE-11a）逐项断言：一方成功 / 一方合规拒绝、**零重复写入**、**零部分副作用**、原始正向 effect 行**未被 UPDATE**、拒绝方的权威库存 / 应付 / 收货行 / 交期账本前后快照一致。**R4-6-R2**：RACE-05a 的拒绝错误码**唯一**为 `RECEIPT_NOTICE_SCHEDULE_EXCEEDED`；RACE-06a 为**两个 `confirmPurchaseReturn`** 竞争**同一**原始正向 effect，拒绝码**精确**为 `SCHEDULE_EFFECT_REVERSAL_EXCEEDED`；**RACE-10a = `BLOCKED`（`NO_REGISTERED_ACCOUNTING_POLICY_WRITER`）**、**RACE-11a = `BLOCKED_UNTIL_HANDLER_REGISTERED`** —— 两者**不执行、不声称可执行、不伪造 Handler**；委外成品退货的并发场景**单独**保持 `BLOCKED` | 拒绝方快照必须**逐字段**相同（不得只断言数量） |
| `M1-GD01` | **期间状态语义断言**：`vmi_settlement_periods.status` 只允许 `('OPEN','CLOSED')`；`OPEN` 与 `CLOSED` **均**参与闭区间重叠检查；**不存在** `CANCELLED` 期间；相邻窗口（`next.start > previous.end`）**不**误判为重叠 | 重叠拒绝时期间表、结算行、库存位、审计**零变化** |

**R2 对 Gate 断言的两处实质影响（不改编号、不改状态）**：

1. `M1-GC01` 的"过账"断言按 §26.33.4.3 的 source-aware 门禁解释为**合规拒绝**（409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`，账单保持 DRAFT，零 AP/GL 写入）—— Requirement §31.12.9 该 Gate 的原文即为"重复 POST **幂等或合规拒绝**"，因此断言仍成立；
2. `M1-GT02` 的旧 UAT-14 oracle 纠正是**已批准的 Requirement 义务**（`document.md §31.12.6`），在 Implementation 中执行，**不再**作为待裁定项（G-5 仍为已登记历史风险，其处置即该纠正动作）。

**RACE-01～RACE-11 的真实 Handler 映射（M1-D-22 / T-REQ-02）**

现状 `server/mysql-procurement-outsourcing-concurrency.integration.js` 的 **11 项全部**使用自造的 `race_probe_generic` 计数器表，**零**调用真实 Domain Handler（该文件只 import `assert`/`node:test`/`createTempDb`/`transaction`，无任何 `server/modules/*` 导入），且 11 项共用**同一个同步连接**（`Promise.all` 在单连接上仍是串行）。本 Design 要求逐项替换为真实 Handler：

| Race | 业务资源 | 必须调用的真实 Handler | 竞争断言 |
|---|---|---|---|
| RACE-01 | Sourcing allocation | `server/modules/procurement-sourcing.js` 的分配入口 | 分配总量 ≤ 配额；一方越限被拒 |
| RACE-02 | PR → PO | `server/modules/procurement-orders.js` 的 PO 生成 | 累计释放量 ≤ PR 量 |
| RACE-03 | PO Change vs Receipt | PO Change 应用 + `app.js` 的 `confirmPurchaseReceipt` | 已执行数量受保护 |
| RACE-04 | Receipt Notice 容量 | `procurement-receiving.js::confirmReceiptNotice`（经 E-06 修正后的 `assertNoticeCapacity`） | 通知累计量 ≤ 订单可收量 |
| RACE-05 | Purchase Receipt | `app.js::confirmPurchaseReceipt` | 累计收货 ≤ 订单行量 |
| RACE-06 | Purchase Return vs Supplier Bill | `app.js::confirmPurchaseReturn` + 账单过账 | 分支分配确定、无双重占用 |
| RACE-07 | Planning handoff | `outsourcing.js::createOutsourcingOrder`（`source_type='PLANNING'` → `consumePlanningHandoff`，`outsourcing.js:98-137`） | exactly-once（**R1-04 更正**：生产源码**已**具备 authoritative 消费路径 —— 行锁 + `PENDING` 状态守卫 + `planning_handoff_id` UNIQUE 守卫 + UNIQUE 冲突兜底 + `CONSUMED` 审计。§31.11 的 UAT-15 结论由 `09abeb4`(2026-10-09 15:43) 记录，早于 `4e035c5`(2026-10-09 19:31) 落地，属**历史时序差**而非当前缺陷。剩余缺口 = 运行时证据 + 本 MySQL 并发证据） |
| RACE-08 | Outsource Material Issue | `outsourcing.js::issueMaterial`（改写后走 canonical Writer） | 库存位数量守恒、零重复扣减 |
| RACE-09 | Outsourcing Receipt | `outsourcing-finance.js::confirmOutsourcingReceipt`（改写后） | 成品入库不重复、成本证据唯一 |
| RACE-10 | Processing Fee Partial Bill | `outsourcing-finance.js::createProcessingFeeBill` + `postProcessingFeeBill` | `newQty <= RemainingEligible`（AP-1..AP-5 三段式）；并发下仅一方占用最后容量 |
| RACE-11 | VMI Ownership Transfer | `procurement-vmi.js::transferVmiOwnership` | 恰好一次物权转移生效；物理净 0 |

**R4-6-R2：四个并发子场景（RACE-01～RACE-11 的编号与历史含义全部保留；本表只**新增**子编号；本轮取代 R4-6-R1 的同名表）**

> **R4-6-R2 授权来源**：业务所有者《R4-6-R2 Final Bounded Correction》要求修正四个子场景。**本表不修改** `RACE-01`～`RACE-11` 的任何编号或历史含义，**不修改** `M1-GT01` 编号，**不修改** 13 个 Gate 的编号与状态（全部仍为 `NOT_RUN`）。子编号按**真实竞争资源**与**真实 Handler**选择，不机械套用。
>
> **本轮四项修正**：① RACE-05a 固定**唯一**错误码；② RACE-06a 改为**同一 Handler、同一原始 effect**（不再把两个不同来源的退货 Handler 混作同一 effect 的竞争者）；③ RACE-10a **BLOCKED**（无已注册的会计政策维护 Handler）；④ RACE-11a **只**使用开期 Handler（关期 Handler 不得混入），且因路由尚未注册而 **BLOCKED**。

| 子场景 | 对应 RACE | 对应 M1-GT01 | 真实 Handler（必须直接调用） | 竞争资源 | 锁定对象 | 唯一约束 | 允许成功的一方 | 必须拒绝的一方 | 拒绝方零副作用断言 | MySQL 多连接测试方式 | **状态** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **RACE-05a** —— 交期**正向** effect 并发 | `RACE-05`（Purchase Receipt） | `M1-GT01` | `server/app.js::confirmPurchaseReceipt`（`action='confirm'`）**与** 新增 `server/modules/procurement-notice-conversion.js::convertReceiptNoticeToReceipts` —— **两条路径必须调用同一个 `resolveAndReserveScheduleCapacity(...)`** | 同一 `purchase_order_delivery_schedules` 行的剩余可收量（交期容量）。**场景设定**：剩余容量 = **100**，请求 A = **60**，请求 B = **60** | 锁序 **L2c PO 行 → L2d 交期行 → 新正向 effect**（MySQL `FOR UPDATE`；SQLite `BEGIN IMMEDIATE`） | `schedule_consumption_effects UNIQUE(business_event_type,business_event_id,business_event_item_id,reverses_effect_key)`（两个不同业务事件**不**撞键，但**容量**必须由行锁串行判定） | 恰好一方把该交期的最后一份容量写入正向 effect（60 ≤ 100） | 另一方 409 **`RECEIPT_NOTICE_SCHEDULE_EXCEEDED`**（**唯一**错误码 —— 本场景已明确指定有效交期，**不允许** OR 表达式、**不得**使用 `RECEIPT_NOTICE_SCHEDULE_REQUIRED`） | 拒绝方：**零**新增正向 effect、**零**收货明细、**零**库存变化、**零**估值变化、**零**审计记录 | **两个独立 MySQL worker**（`scripts/gates/mysql-concurrency-worker.mjs` + `AppInstance`，同 `server/mysql-inventory-domain-concurrency.integration.js:18-58`）；**不允许**用单连接 `Promise.all` 代替；两个 worker 各带独立 `Idempotency-Key` | `NOT_RUN`（设计就绪，**本轮未运行**） |
| **RACE-06a** —— 交期**负向** effect 并发（**同一 Handler、同一原始 effect**） | `RACE-06`（Purchase Return vs Supplier Bill） | `M1-GT01` | **`server/app.js::confirmPurchaseReturn`（`action='confirm'`）× 2** —— **两个独立的 `confirmPurchaseReturn` 调用**，**不**与 `createFinishedReturn` 混用 | **同一个**原始 purchase receipt item 的**正向**交期 effect 的累计反向上限（`reversible_remaining`）。**场景设定**：原始正向 effect = **+100**，Return A = **−60**，Return B = **−60** | 锁序 **L2c PO 行 → L2d 交期行 → L2f 原正向 effect → 已有负向 effects**（锁内重读 `reversible_remaining`） | `schedule_consumption_effects UNIQUE(business_event_type,business_event_id,business_event_item_id,reverses_effect_key)`（不同 `business_event_id` 的部分退货**允许**共存，但**累计**上限由行锁保证） | 恰好一方的负向量被接受（60 ≤ 100） | 另一方 409 **`SCHEDULE_EFFECT_REVERSAL_EXCEEDED`**（**精确**错误码；累计反向 120 > 100 超过原正向量） | 拒绝方：**零**负向 effect 行、**零**退货单、**零**库存变化、**零**估值变化、**零**审计记录；**原始正向 effect 行不得被 UPDATE** | 同上：两个独立 worker 并发对**同一原始正向 effect** 提交两次 `-60` 退货；断言只有一方成功、净反向 = 60 | `NOT_RUN`（设计就绪，**本轮未运行**） |
| **RACE-10a** —— 会计政策**有效区间重叠**并发 | `RACE-10`（Processing Fee Partial Bill） | `M1-GT01` | **无已注册的真实政策维护 Handler** —— `postProcessingFeeBill` 是**加工费账单过账** Handler，**不是**会计政策创建 Handler；`server/` 全仓库**无** `outsourcing_accounting_polic*` 的表、模型或写入路径（已核对：零命中） | （未来）同一 `scope`（`(side, source_type)`）下的**会计政策有效区间**（闭区间 `[business_date_from, business_date_to]`，`business_date_to IS NULL` = 无限未来） | （未来）锁序 **L7：先锁 scope 行，再查该 scope 下的政策行** | （未来）政策表按 `scope` + 有效区间的唯一性断言（**先锁 scope 再查重叠**，不依赖起始日 UNIQUE —— 见 §26.33.7 的 M-16） | — | — | — | — | **`BLOCKED`**，原因 = **`NO_REGISTERED_ACCOUNTING_POLICY_WRITER`** |
| **RACE-11a** —— VMI **结算期间重叠**并发 | `RACE-11`（VMI Ownership Transfer，同为 VMI 域并发） | `M1-GT01` | **`createVmiSettlementPeriod` × 2**（新增 `server/modules/procurement-vmi.js::createVmiSettlementPeriod`）—— **只使用开期 Handler**；`closeVmiSettlementPeriod` **不得**混入本场景 | **同一个** `vmi_agreements.id` 的**结算窗口区间**（闭区间 `[window_start, window_end]`；`OPEN` 与 `CLOSED` **均**参与重叠检查，见 §26.33.6.4） | 锁序 **L7：先锁 `vmi_agreements` 行（`FOR UPDATE`），再查该协议的全部期间并做闭区间重叠判定**，最后写期间/行/审计 | `vmi_settlement_periods UNIQUE(agreement_id, period_key)`（同键重放）＋ 闭区间重叠谓词（并发下由 agreement 行锁串行判定，**不**依赖唯一键） | 恰好一方创建该窗口 | 另一方 409 **`VMI_SETTLEMENT_PERIOD_OVERLAP`** | 拒绝方：**零**新增期间、**零**新增明细、**零**审计记录 | 同上：两个独立 worker 并发创建**重叠**窗口；另加一个 case 验证 `next.start = previous.end + 1 day`（相邻期间）**不**被判定为重叠 | **`BLOCKED_UNTIL_HANDLER_REGISTERED`** —— 开期 API **当前尚未实际注册**（`server/app.js` 中无该路由；`server/` 全仓库无 `vmi_settlement_periods` 的模型与 handler）⇒ **不得宣称已具备执行条件** |

**委外成品退货的并发测试（单独保留为 BLOCKED，R4-6-R2 明确）**

RACE-06a **不**覆盖委外成品退货。委外成品退货的并发场景**单独**保留，状态为 **`BLOCKED`**，直到以下三项**全部**满足：

1. **退货明细到原收货明细的分配实现** —— `outsourcing_finished_return_items` 落地（§26.33.4.1 的 R4-6-R2 块）；
2. **交期负向 effect 实现** —— 每条退货明细唯一对应原始正向交期 effect 并写负向 effect；
3. **C-P03 相关门禁获批** —— 由业务 Owner 裁定 C-P03（当前仍为 `POLICY_DECISION_PENDING`）。

⇒ 在此之前**不得**把委外成品退货与 `confirmPurchaseReturn` **拼成同一个 Race**，**不得**声称两者反向同一个原始 effect，**不得**伪造 Handler。**不新增 Gate**。

**四个子场景的共同约束**

- **Gate 归属**：四个子场景全部计入 `M1-GT01` 的证据集，**不新增 Gate**；`M1-GT01` 的 `execution_status` 仍为 `NOT_RUN`、`readiness_status` 仍为 `NOT_RUN`。
- **执行前提**：只能在**独立 disposable MySQL 目标**上执行，且必须另获**本次 run 的 destructive 授权**（§26.33.12 的 P0-06 四重 ACK 合同）。**本轮未运行任何 Gate**。
- **BLOCKED 子场景**：RACE-10a 与 RACE-11a 在其阻塞原因消除前**不执行、不声称可以执行、不伪造 Handler、不增加 Gate、不擅自增加会计政策 API**。
- **证据要求**（`T-REQ-02`）：每项必须有**拒绝方**的零副作用快照 + **权威库存 / 应付 / 收货行 / 交期账本**的前后快照；断言必须精确到 status + error code + 状态不变，**不得**用"201 或 409"式宽松区间。
- **不得**用 `race_probe_generic` 之类自造计数器表代替真实 Handler（§26.33.12 现状裁定）。

**测试架构约束（不得违反）**

- **R4-6 授权边界（P0-06，取代“统一测试库可直接清空”的旧概括）**：`127.0.0.1:3306 / modern_erp_domain_test` 的既有只读核验授权**不等于** destructive test 授权；共享、长期存在或身份未证明的数据库一律不得清空。本轮只改设计，禁止实际连接数据库。
- **独立 disposable database 优先**：破坏性 Gate 必须使用为本次 run 单独创建、名称含受控随机 run id 的数据库；凭据只授予该库，结束后由同一受控 launcher 清理。创建/清理本身也需要用户对该 run 的单独明确授权。若只能使用 `modern_erp_domain_test`，必须另获“该库当前为 disposable 且允许全表清空”的逐次授权，不能继承历史授权。
- **受控 Launcher 与身份断言**：连接前同时验证 host/port、database、user、MySQL **8.0.37**、server UUID、非生产标识、disposable token、四重 destructive ACK 与 machine-wide mutex；任一不符立即停止。明确拒绝生产库、默认库、空数据库名、共享账号及白名单外目标。

**R4-6-R1：四重 Destructive ACK 的技术合同（P0-06 权威；本表逐项区分"已实现"与"未实现"）**

> **R4-6-R1 授权来源**：业务所有者《R4-6-R1 — Bounded Technical Contract Correction》要求把"第四重 ACK"与"数据库身份验证"分别定义清楚。**本轮绝对禁止连接数据库、清空数据库或运行 MySQL Gate**；下表全部是**静态源码核对**结论，**不**是运行时证据。
>
> **核对到的真实 guard**：`server/test-utils/mysql-disposable-target.js` 的 `assertAuthorizedDisposableMySqlTarget(config, env)` —— 它**恰好有三项**环境检查（`:19` / `:25-30` / `:31-37`）**加**一项名称提示检查（`:22-24`）**加**一项 `SELECT DATABASE()` 复核（`:43-46`，在 `resetAuthorizedDisposableMySqlSchema` 内）。`scripts/gates/mysql-concurrency-gate.mjs:32-33` 在启动时调用它，`:78-96` 另有 `SELECT DATABASE()` 与表数的前后断言。

**四重 ACK 的逐项定义**

| ACK | 确认内容 | 必须验证 | 具体取值 / 字段名 | 取得方式 | 验证方式 | 失败行为 | **真实源码实现状态** |
|---|---|---|---|---|---|---|---|
| **ACK-1** | 明确允许本次 destructive reset | **精确布尔值** | `ERP_MYSQL_TEST_ALLOW_RESET` == `'true'`（**字符串精确相等**，非 truthy） | 进程环境变量 | `env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true'` → 抛错 | 抛 `MYSQL DISPOSABLE TARGET REFUSED: ERP_MYSQL_TEST_ALLOW_RESET=true required`，**不连接**数据库 | **已实现** —— `server/test-utils/mysql-disposable-target.js:19-21` |
| **ACK-2** | 明确授权的目标数据库身份 | host / port / database / user **精确匹配** | `ERP_MYSQL_TEST_DISPOSABLE_TARGET` == `mysqlDisposableTargetIdentity(config)` == `` `mysql://${user}@${host}:${port}/${database}` `` | 进程环境变量 vs 由 `resolveDatabaseConfig` 解析出的配置 | 字符串**全等**比较（`:26-30`）；另加 `DISPOSABLE_NAME_HINT = /(?:test\|phase7[abc]\|disposable)/i` 的库名提示检查（`:22-24`） | 抛 `MYSQL DISPOSABLE TARGET REFUSED: ... must exactly equal ...`；身份不完整（缺 host/port/database/user）时在 `:11-13` 即抛错 | **已实现** —— `mysql-disposable-target.js:11-14` 与 `:22-30` |
| **ACK-3** | 明确允许的破坏性操作集合 | 与**预定义操作清单完全一致** | `ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS` == `MYSQL_DESTRUCTIVE_OPERATIONS_ACK` == `'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP'`（**全等**，不接受子集、超集或顺序变体） | 进程环境变量 | `approvedOperations !== MYSQL_DESTRUCTIVE_OPERATIONS_ACK` → 抛错（`:31-37`） | 抛 `MYSQL DISPOSABLE TARGET REFUSED: ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS must explicitly approve ...` | **已实现** —— `mysql-disposable-target.js:3-4` 与 `:31-37` |
| **ACK-4** | 本次 run 的**一次性**授权 | 与**本次 run ID** 及**目标 commit SHA** 绑定 | **提议**（尚未实现；**R4-6-R2 已确定完整未来合同**）：`ERP_MYSQL_TEST_RUN_ID`（UUIDv4，须与目标库名中的 run token 一致）＋ `ERP_MYSQL_TEST_TARGET_COMMIT_SHA`（完整 40 位 SHA，须等于 `git rev-parse HEAD`）＋ `ERP_MYSQL_TEST_RUN_ACK`（授权人显式提供的规范字符串 `ALLOW_DESTRUCTIVE_RUN:<run_id>:<full_commit_sha>:<target_identity>:DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP`）—— 一次性消费账本与全部规则见本节下方的"R4-6-R2：ACK-4 未来一次性授权合同" | **不存在** —— 仓库中**没有**这三个变量，也**没有**任何消费方 | **不存在** | **不存在** | **PROPOSED / NOT IMPLEMENTED** —— **不得**声称现有 runner 已验证它。既有最接近的机制是 `ERP_MYSQL_WAVE10_CAMPAIGN_ID` + 进程内 campaign lease（`server/test-utils/mysql-wave10-campaign-target.js:227`），但它**不**绑定 commit SHA，且 lease 只存在于**进程内存**（`activeCampaignLeases` Map），**进程重启即失效** ⇒ 不能充当跨进程的一次性授权 |

**R4-6-R2：ACK-4 未来一次性授权合同（确定合同，但本轮不实现）**

> **R4-6-R2 授权来源**：业务所有者《R4-6-R2 Final Bounded Correction》要求"确定未来一次性授权合同，但不实现"。
> **本轮不修改任何 ACK 代码**；ACK-1 / ACK-2 / ACK-3 保持**已实现**；ACK-4 继续为 **`PROPOSED / NOT IMPLEMENTED`**。
> 下列条款是**未来实现合同**，**不是**当前已具备的行为。

**8.1 授权输入（三个环境变量）**

```text
ERP_MYSQL_TEST_RUN_ID
ERP_MYSQL_TEST_TARGET_COMMIT_SHA
ERP_MYSQL_TEST_RUN_ACK
```

**固定规则（R4-6-R2）**：

1. `RUN_ID` 必须为 **UUIDv4**（版本位 4、variant 位 8/9/a/b）。
2. `TARGET_COMMIT_SHA` 必须为**完整 40 位**十六进制 SHA（**不得**使用缩写或短 SHA）。
3. 该 SHA 必须与实际 `git rev-parse HEAD` **一致**（不匹配 ⇒ 拒绝启动）。
4. `RUN_ID` 必须与 disposable 数据库名称中的 **run token** 一致（防止"用一次授权打另一个库"）。
5. `RUN_ACK` 必须由**授权人显式提供**（**不得**由程序自行推导、**不得**由默认值兜底）。

**RUN_ACK 的规范字符串（必须逐字段精确匹配）**

```text
ALLOW_DESTRUCTIVE_RUN:
<run_id>:
<full_commit_sha>:
<target_identity>:
DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP
```

⇒ 五个字段（标签、`run_id`、完整 SHA、目标 identity、破坏性操作清单）**全部精确匹配**才算有效；任一字段不符 ⇒ 拒绝。

⇒ **不得将普通 SHA-256 摘要冒充数字签名。** 上述确认值是**一次性授权凭据**，其安全性来自"由人工授权人显式提供 + 一次性消费 + 与目标/commit 绑定"，**不**来自任何签名机制；文档**不得**把它描述为密码学签名。

**8.2 一次性消费（跨进程、跨重启的持久化消费记录）**

一次性授权必须具有**跨进程、跨重启**的持久化消费记录。未来实现采用位于 **disposable 目标数据库之外**的授权消费账本：

```text
scripts/gates/.state/mysql-destructive-acks/<run_id>.json
```

**要求（R4-6-R2）**：

- **按 `RUN_ID` 唯一** —— 文件名即 `run_id`。
- **原子创建，不允许覆盖** —— 必须用 `open(..., 'wx')` 之类的排他创建语义；已存在 ⇒ 拒绝。
- **创建成功即视为 ACK-4 已消费** —— 消费点在**第一次 DROP 之前**。
- **必须在第一次 DROP 之前完成消费** —— 不得"先清库、后记账"。
- **已存在的 `RUN_ID` 必须拒绝** —— 同一授权不得二次使用。
- **即使执行中途失败，也不得重新使用该授权** —— 失败的 run 其消费记录同样有效，必须换**新的 `RUN_ID`** 与**新的明确人工授权**才能开始下一次破坏性运行。
- **不得保存数据库密码** —— 记录中只允许出现下列字段。

**记录至少包含（R4-6-R2）**

```text
run_id
target_commit_sha
target_identity
approved_operations
authorized_at
consumed_at
```

**8.3 当前状态（R4-6-R2 明确）**

- 上述**只是未来实现合同**。
- 由于本轮**不允许修改代码**，因此：
  - **ACK-4 仍未实现**；
  - **不得**声称一次性消费已经验证；
  - **`T-13` 继续为 `TECHNICAL_CONTRACT_UNPROVEN`**；
  - ACK-1 / ACK-2 / ACK-3 的**已实现**状态不变，**不得**被牵连降级。


⇒ **因此**：R4-6 文本中"四重 destructive ACK"的表述 **必须**按本表修正为 —— **ACK-1 / ACK-2 / ACK-3 已有真实源码实现；ACK-4 为 PROPOSED / NOT IMPLEMENTED**。**不得**把三项已实现检查冒充四项均已实现。`T-13` 因此**继续保持** `TECHNICAL_CONTRACT_UNPROVEN`，直到 ACK-4 具备真实实现与验证证据。

**ACK 与"实际数据库身份验证"必须分开（R4-6-R1 明确）**

ACK 是**授权**（环境变量声明"我允许做什么"）；身份验证是**事实**（连接后读回数据库的真实身份）。**连接成功不等于目标数据库身份正确。** 下列各项**不属于** ACK，但**必须**在任何 destructive 操作之前完成：

| # | 验证项 | 具体字段名 / 取值来源 | 预期值 | 取得方式 | 验证方式 | 失败行为 | **真实源码实现状态** |
|---|---|---|---|---|---|---|---|
| 1 | 当前数据库 | `SELECT DATABASE()` | 与配置的 `config.database` **精确相等** | `db.prepare('SELECT DATABASE() ...').get()` | 字符串全等 | 抛 `MYSQL DISPOSABLE TARGET REFUSED: SELECT DATABASE()=... expected ...` | **已实现** —— `mysql-disposable-target.js:43-46`；并发 gate 另有 `:78-87` |
| 2 | 认证账号 | `SELECT CURRENT_USER()` | 与期望账号**精确相等**（`financial-controls.js` 无关；VMI/采购链路同） | `readWave10ConnectedIdentity(db)`（`server/test-utils/mysql-wave10-campaign-target.js:129-137`） | 与 `ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER` 全等（`:145`） | 抛 `WAVE10 MYSQL TARGET REFUSED: CURRENT_USER() mismatch` | **已实现，但仅在 Wave 10 campaign 路径**；**`mysql-disposable-target.js` 与 `mysql-concurrency-gate.mjs` 均未调用** ⇒ 对 `pnpm test:mysql:concurrency` **未实现** |
| 3 | 服务器实例标识 | `SELECT @@server_uuid` | 与固定身份基线一致 | 同上（`:133`） | 与 `ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID` 全等（`:146`） | 抛 `... server UUID mismatch` | **同第 2 项** —— Wave 10 路径已实现；**并发 gate 未实现** |
| 4 | MySQL 版本 | `SELECT VERSION()` | 主版本为 8（目标基线 **8.0.37**） | 同上（`:134`） | `/^8\./` 匹配（`:147`）；精确 8.0.37 的比对在 local baseline 侧 | 抛 `... MySQL 8 required` | **同第 2 项** —— Wave 10 路径已实现（策略级）；**并发 gate 未实现** |
| 5 | host / port | 配置解析结果 | 与授权目标一致（`config.host` / `config.port`） | `resolveDatabaseConfig({ backend: 'mysql' })` | ACK-2 的 identity 字符串已包含 host/port ⇒ 全等比较即覆盖 | 同 ACK-2 | **已实现** —— `mysql-disposable-target.js:6-15` + `:25-30` |
| 6 | 授权集合摘要 | `SHOW GRANTS FOR CURRENT_USER()` → 规范化 → SHA-256 | 与固定基线摘要一致 | `normalizeGrantLines` + `grantFingerprint`（`mysql-wave10-campaign-target.js:129-137`） | 与 `ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256` 全等（`:148`）；并经 `assertExactLeastPrivilegeGrants` 核验最小权限集合 | 抛 `... effective grant fingerprint mismatch` | **同第 2 项** —— Wave 10 路径已实现；**并发 gate 未实现** |
| 7 | disposable 目标标识 | 库名正则 | 命中 `/(?:test\|phase7[abc]\|disposable)/i` | `config.database` | 正则匹配（`:22-24`） | 抛 `... database name lacks a disposable hint` | **已实现** —— `mysql-disposable-target.js:1` 与 `:22-24` |
| 8 | 初始对象清单 | 五类计数：`tables` / `views` / `triggers` / `routines` / `events` | 全部为 **0** | `wave10ObjectInventory(db)`（`mysql-wave10-campaign-target.js:35-43`，查 `information_schema`） | `assertWave10ZeroObjects`（`:45-51`）逐类断言 | 抛 `... expected zero <kind>, found <n>` | **已实现，但仅在 Wave 10 campaign 路径**；**并发 gate 只做 `SHOW TABLES` 计数**（`mysql-concurrency-gate.mjs:88-96`），**不**覆盖 view / trigger / routine / event ⇒ 对并发 gate **部分实现** |
| 9 | 机器级互斥 | 命名互斥体 `Global\ModernERP.MySqlGate` | 同一时刻只有一个进程持有 | `scripts/gates/run-mysql-local-gate.ps1:99-121`（`System.Threading.Mutex`） | `WaitOne(0)` 获取失败即退出；`AbandonedMutexException` 被显式处理 | 抛/退出，不启动 Gate | **部分实现** —— **本机 launcher 路径已实现**；**`mysql-concurrency-gate.mjs` 自身没有互斥**（它假定由 launcher 串行调用） |
| 10 | 清理阶段的身份重新验证 | 同第 1 项 + 五类计数 | 与授权目标一致且清空后计数仍为 0 | reset 后重查 | `mysql-concurrency-gate.mjs:88-96`（PRE/POST 表数）；`resetAuthorizedDisposableMySqlSchema` 内 `SELECT DATABASE()` 复核 | 抛 `MYSQL CONCURRENCY RESET REFUSED: post-reset table count = n, expected 0` | **部分实现** —— 表数与 `SELECT DATABASE()` 已实现；**CURRENT_USER / UUID / version / grants 的清理后复核未实现** |

⇒ **对 `M1-GT01` 与四个新增 Race 子场景的直接结论**：以 `pnpm test:mysql:concurrency` 入口执行时，当前只有 **ACK-1 / ACK-2 / ACK-3** 与第 1、5、7 项身份核验被真实强制；**ACK-4 与第 2、3、4、6 项以及完整的第 8、9、10 项**必须通过**受控 launcher**（`pnpm test:mysql:local` / `scripts/gates/run-mysql-local-gate.ps1`）与**本轮尚未实现的 ACK-4** 才能闭合。**本轮未运行任何 Gate**，上述结论全部是**静态源码事实**。
- **隔离与清理**：InnoDB、`READ COMMITTED`、独立连接/worker；只在目标身份全部匹配后允许 suite 内 reset。不得绕过 launcher 直接运行 `mysql-concurrency-gate`，不得把“脚本有清空逻辑”解释成授权。
- **DDL 重试语义保留**：MySQL DDL 自动提交，M-15/M-03 等迁移必须按已完成步骤可重放；失败后不得假设事务回滚了 DDL。SQLite 事务性差异不改变 fail-closed 前置。
- **新 suite 必须注册**进 `scripts/gates/mysql-concurrency-gate.mjs:166-179` 的 `suites` 数组，否则不会获得“每 suite 一次重置”，也永远不会被 `pnpm test:mysql:concurrency` 执行。
- **多连接 race 模式**：复制 `server/mysql-inventory-domain-concurrency.integration.js:18-58` 的 worker spawn 模式（`scripts/gates/mysql-concurrency-worker.mjs` + `AppInstance`），而不是单连接 `Promise.all`。
- **suite 注册表**：`server/mysql-procurement-outsourcing-concurrency.integration.js` 与 `scripts/acceptance/procurement-outsourcing-functional-uat.mjs` **都不在** `scripts/testing/test-suites.js` 的 FAST/FULL/HEAVY 集合中（前者不是 `*.test.js`，后者不在 `server/`/`src/lib/` 扫描根）。本 Design 要求：
  - 新建的 `server/mysql-procurement-outsourcing-domain-concurrency.integration.js` 同样以 gate 方式驱动（**不**塞进 FAST/FULL/HEAVY）；
  - 端到端 UAT 增加 `package.json` 脚本入口（与 `test:finance:uat` 同构），使 `M1-GU01` 可被脚本化复跑 —— 这是**测试资产**变更，Design 授权范围内。

#### 26.33.13 Implementation Dependency DAG and Bounded Work Packages

```text
WP-0  基础设施（无业务依赖）
      ├ 迁移骨架 + 5 条 parity 断言（PA-1..PA-5）
      ├ runInTransaction 统一守卫
      ├ 锁顺序文档化 + lockSuffix 复用
      └ 权限注册（SUPPLIER_BILL_MANAGE）+ desired-set 同步
           │
           ├────────────┬────────────┬────────────┬────────────┐
           ▼            ▼            ▼            ▼            │
WP-1 A组通知/转换   WP-2 B组材料   WP-3 A组委外收货 WP-4 D组VMI   │
  (M1-D-01..04)     (M1-D-07..10) (M1-D-05/06)  (M1-D-17..20) │
  │                │            │            │            │
  └──────┬─────────┴─────┬──────┘            │            │
         ▼               ▼                    │            │
  WP-5 C组加工费        WP-6 U/T前端+验收       │            │
  (M1-D-13/14/19)      (M1-D-21/22)            │            │
         │               │                    │            │
         ▼               ▼                    ▼            ▼
  WP-7 GL/凭证（**BLOCKED**: C-P01..C-P04）  WP-8 差异审核+结算释放（**BLOCKED**: B-P01/P02, D-P01/D-P02）
```

**R1 复核说明**：本轮**不**以「设计文档已写」作为任何工作包可实施的依据。每一项都回到**生产源码**逐条核对合同是否**存在且自洽**，再按四态给出结论。状态只取 §26.33 抬头定义的四个值之一；「未闭合子项」列另行给出子包自身的状态。四态在本轮的语义：

- `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE` —— 该包的技术合同已在 §26.33 完整给出、与已批准 Requirement 自洽、无未决政策；剩余为业主对 Design 的验收（以及所有包共有的「尚未运行」这一事实）。
- `TECHNICAL_CONTRACT_UNPROVEN` —— 该包内某项技术合同**无法**由静态源码确立，或只在设计中断言而从未被运行过。
- `DEPENDENCY_PENDING` —— 该包的起点依赖另一个包或另一个域的交付物。
- `POLICY_DECISION_PENDING` —— 需业务政策裁定后，对应子项方可实施。

**本轮没有任何工作包被宣布为 Implementation Ready。** Gate 状态按 §26.33.12 的**双维度**口径：`execution_status` 13 个全部 `NOT_RUN`；`readiness_status` 9 个 `NOT_RUN` + 4 个 `BLOCKED`（GB03 / GC02 / GD01 / GD02）。

| WP | 内容 | 依赖 | 状态（R2 复核） | 未闭合子项（各自状态） | 交付 Gate |
|---|---|---|---|---|---|
| WP-0 | 迁移骨架、parity 断言、事务守卫、权限注册、**`SOURCE_TYPES` 注册扩展（`M1-D-23`，纯代码、无 migration）**、**R2 新增迁移 M-12a/M-12b/M-14/M-15/M-16/M-17**、**R3 的 M-07a/M-07b 分阶段迁移与 M-15 三重前置检查**、**R4 的 M-07c 历史隔离回填、M-18 预留超额状态列、M-15 五步执行顺序与部分完成重试语义、M-12a/M-12b 逐列取值规格**、**`SUPPLIER_BILL_MANAGE` 注册与 desired-set 同步（`M1-D-35`）** | — | `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE` | **子项（与包级状态区分）**：MySQL 重放清单逐项核对（`mysql-adapter.js:293-301`）、**M-15 的 PRE-A/PRE-B/PRE-C 实测结果**（本轮未运行数据库 ⇒ 委外来源历史跟踪流水是否为零、`source_item_id` 是否全非空**未获证明**）、**M-07b/M-07c 历史回填的确定性实测**、**M-15 部分完成后重试的 MySQL 实测（T-07）**、**交期容差字段的历史取值分布（T-06）**、PA-1..PA-5 实测 → `TECHNICAL_CONTRACT_UNPROVEN` | PA-1..PA-5 |
| WP-1 | A 组通知模型 + 容量不变式（E-06 修正，R1-05）+ 多 PO 来源表 + **C-01 未解析来源登记与三项转换阻断（R3：UNRESOLVED / RESOLVED / ABSENT）** + **R4-06 的 `RESOLVED` 完整性 + R4-07 的遗留转换量保守口径 + R4-11 的四重上界与相容性** | WP-0 | `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE` | A-P02（拒收/退回重开、批号继承）= `POLICY_DECISION_PENDING`，按 §26.33.14 **不**阻塞 WP-1 主链；**遗留转换量未证明的规模与保守预留损失未实测（T-08）、交期消费量不可证的范围未实测（T-10）** ⇒ 该两项子项为 `TECHNICAL_CONTRACT_UNPROVEN`，**不**影响包级分类 | `M1-GA02` / `M1-GA03` |
| WP-2 | B 组材料：WIP 解析、canonical MOVE、**严格跟踪写者**、**估值成对**、倒冲物理化、**C-05 业务事件 ID 体系**、**C-06 VALUED 断言与非空身份键**、**五字段 Mutation Key（SOURCE_TYPE + 四个区分维度）与物理腿硬断言**、**R4-5 的历史全行隔离门禁** | WP-0 | `POLICY_DECISION_PENDING` | 跟踪合同、估值合同、五字段键与两条硬断言、全行隔离公式本身 = `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE`；倒冲数量基数残余 = `POLICY_DECISION_PENDING`；依赖 M-15 前置检查；历史隔离解除属独立授权，业务阻断规模 T-09 未实测 | `M1-GB01` / `M1-GB02` |
| WP-3 | 委外收货表头+明细 Writer + 两段式状态机 + Quality 门禁时点 + **C-08 历史收货效力判定（R3：E1 质量 / E2 相符的成品物理流水 / E3 完整来源明细）** | WP-0（可与 WP-2 并行） | `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE` | `M1-F-09`（Quality 可检状态白名单）已在 §26.33.5.1 指定为实现项；**C-08 的 `LEGACY_UNVERIFIED` 历史修复与 G-4 类成本缺口（C1/C2）属独立授权，不在本包**；`M1-F-06`/`M1-F-08`/`M1-F-12` 属外域（§26.33.14.3） | `M1-GA01` / `M1-GA03` |
| WP-4 | D 组：结算期/行表、**C-03 七量分列（R3：期初项、调整量归属、释放上限）**、恒等式断言、结算防重、**R4-05 的有符号调整量与三式对账条款** | WP-0 | `POLICY_DECISION_PENDING` | 表结构与 **VMI-P/S/E/C/R/L** 恒等式断言（§26.33.10.5，含 R4-05 的符号约定与对账条款）= `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE`；结算触发模型 D-P01（**D-1 / D-2a / D-2b / D-3** 四个备选的选择）= `POLICY_DECISION_PENDING`；**D-P01 未裁定前不得选择 D-2a / D-2b**；**R4-05 的关期容差数值 = `M1-P-04`（`POLICY_DECISION_PENDING`，默认 0 不阻塞实现）** | `M1-GD01`（部分） |
| WP-5 | C 组：来源合同、**C-07 三段式容量 + R3 四项边界**、容量锁、期间守卫、输入校验、识别路径、**C-04 source-aware 会计政策门禁与委外专用过账路径**、**R4-10 的 OVER_RESERVED 持久模型** | WP-0 + WP-3（需真实收货行） | `POLICY_DECISION_PENDING` | 账单**创建**、预留量、容量（含同请求聚合与来源行锁重读）、期间守卫、输入校验、幂等、审计、**R4-10 的超额识别与标记重算（只写标记、不缩减预留量）** = `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE`；**过账**（AP 确认模型 + GL 交接）= `POLICY_DECISION_PENDING`（C-P01..C-P04，GL 段归 WP-7）→ **WP-5 的过账子项在裁定前停止实现设计** | `M1-GC01` |
| WP-6 | U/T：前端 10 处调用修正 + 真实端到端 + MySQL 真实 Handler 并发 suite + **C-10 UAT-14 oracle 纠正（已批准 Requirement 义务）** | WP-0 | `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE` | RACE-01..RACE-11 的真实 Handler 映射已给（RACE-07 已按 R1-04 更正为 `consumePlanningHandoff`）；**子项**：并发与浏览器证据本身 = `TECHNICAL_CONTRACT_UNPROVEN`（本轮未运行）；**C-10 的 oracle 纠正不是待裁定项，是 Implementation 内的已批准动作** | `M1-GU01` / `M1-GT01` / `M1-GT02` |
| WP-7 | GL 凭证与贷项角色集 + **C-04 的委外专用会计政策登记表 `outsourcing_accounting_policies`（M-16，默认无行）** | WP-5 | `POLICY_DECISION_PENDING` | C-P01 / C-P02 / C-P03 / C-P04 未裁定 → 政策表**无行**、委外角色**不注册**于 `account_role_mappings` → 过账必然 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`，且零 AP open item / 零凭证 / 零分录 | `M1-GC02` |
| WP-8 | 差异审核与跨单 WIP 成本携带、结算释放策略 + **C-02 WIP 转移数量守恒（R3：有符号两列、目标行可再转出、历史行 fail-closed）** + **R4-02 的四量断言 / R4-03 的历史隔离 / R4-04 的五项相容性门禁** | WP-2 / WP-4 | `POLICY_DECISION_PENDING` | **C-02 的数量归属**（有符号两列、来源/目标行、身份明细、跨订单守恒、目标行再转出规则）= `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE`；**R4-02 的 `WIP_before / q / cum_transferred_out / WIP_after` 断言与 INV-WIP-1b 逐行非负** = `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE`；**R4-03 的历史隔离与 `quantity_accounting` 声明** = `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE`（**解除隔离属独立授权**）；**R4-04 的五项相容性门禁** = `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE`；**成本携带**（`cost_cents` / 计价方法）= `POLICY_DECISION_PENDING`（B-P01，未裁定前 `cost_state='UNVERIFIED_COST'`）；B-P02 / D-P01 / D-P02 未裁定 | `M1-GB03` / `M1-GD02` |

**R3 对包级状态与子项状态关系的明确（R3 要求，不得混用）**

- **包级状态**（上表第 4 列）描述**该工作包整体**的技术就绪分类；**子项状态**（第 5 列括号内）描述**包内某一项**的分类。二者是**不同层级**，允许并存而不矛盾：例如 WP-0 包级为 `DESIGN_CONTRACT_COMPLETE_PENDING_OWNER_ACCEPTANCE`，但其"M-15 前置检查实测"子项为 `TECHNICAL_CONTRACT_UNPROVEN` —— 前者说"迁移**方案**已写完整"，后者说"迁移**尚未运行**，其前置检查结果未获证明"。
- **不得**由子项的 `TECHNICAL_CONTRACT_UNPROVEN` 反推包级为不可实施，**也不得**由包级的完整状态宣称子项已闭合。
- **没有任何工作包因技术合同修正而被宣布为 Implementation Ready**；**没有任何业务政策阻塞被自动解除**。

**R2 Readiness 复核说明**：本轮**仍不**以"设计文档已写"作为任何工作包可实施的依据；每一项都回到生产源码逐条核对合同是否**存在且自洽**。四态语义与 §26.33 抬头一致。**没有任何工作包在本轮被宣布为 Implementation Ready，也没有任何工作包被授予 Implementation 授权** —— 四态只描述技术就绪分类，与授权是两回事。

**明确的非强依赖（Requirement §31.12.10）**：WP-2 **不**依赖 WP-3（委外收货 Schema）；不得把“完成委外收货 Schema”当作“开始修订材料发退料权威 Writer”的全局阻塞。WP-1 / WP-2 / WP-3 / WP-4 必须**并行**推进，不得留到最后。

#### 26.33.14 Business Policy Register and Disposition

##### 26.33.14.1 Requirement 原登记项与 A-P01 独立追认

下表的「本 Design 的处置」是**技术处置**，不是业务政策批准。`A-P01` 已有技术方案但状态固定为 `OWNER_RATIFICATION_PENDING`，**不计入**开放业务政策；其余 A-P02～D-P02 仍按各自行保持开放。

| ID | Requirement 待决内容 | 本 Design 的处置 | 仍未决 | 是否阻塞 Implementation |
|---|---|---|---|---|
| `A-P01` | `§26.12` 独立完成通知表 vs `§26.20` 复用通知表 + 历史行级来源迁移 | 唯一权威 = `receipt_notices` + `receipt_notice_items` + `receipt_notice_item_sources`；技术方案已形成 | `OWNER_RATIFICATION_PENDING`（独立追认；不计入开放政策） | 否 |
| `A-P02` | 完成通知部分转换、拒收/退回重开、剩余量与批号继承边界 | 部分收敛：部分转换与行级容量已在 `M1-D-02/D-03` 定义；**拒收/退回重开**与**批号继承**未定义 | **是** | 否（不阻塞 WP-1 的主链；相关子项保持 `POLICY_DECISION_PENDING`） |
| `B-P01` | 跨订单/跨期 Supplier WIP 价值携带（源账面价值、价差、转移时点、期间锁） | 设计给出**机制**（`M1-D-12`：转移只改归属、不动实物，成本按 canonical 估值余额分摊携带，期间受 `assertFinancialPeriodsOpen` 约束），**不指定**计价方法 | **是** | 是（WP-8 的成本部分） |
| `B-P02` | 倒冲差异生成单据后的具体审核人、退补单撤销/冲销状态 | 提出 `outsourcing_difference_approvals` + `OUTSOURCING_DIFFERENCE_APPROVE` 的**建议**，并给出 `PREVIEW→ALLOCATED→APPLIED` 状态机 | **是** | 是（WP-8 的审核部分） |
| `C-P01` | 加工费在收货/暂估/正式过账各时点的金额确认；GRNI 产生与冲回 | 明确**禁止**照搬 `Dr GRNI / Cr AP`；**R2 更正**：R1 的"角色未映射即失败"**不覆盖** `postSupplierBill` 的 DIRECT 分支（该分支不生成凭证且使账单逃出 `SUPPLIER_BILL_TO_SUBLEDGER_GL` 的 BLOCKING 检查），也不阻止 INVOICE_DRIVEN/PROVISIONAL 分支使用**普通采购角色集**。因此建立 **source-aware 会计政策门禁**（§26.33.4.3）：在 C-P01..C-P04 获批前，**委外加工费账单不能过账**（409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`，账单保持 DRAFT，零 AP/GL 写入） | **是** | 是（WP-7 **与 WP-5 的过账子项**） |
| `C-P02` | 加工费会计科目/资本化、价差与税务 | 设计只落实 `tax_mode` 的**显式**选择与 `NO_TAX` 的显式声明；资本化与进项税留待裁定 | **是** | 是（WP-7） |
| `C-P03` | 过账后红冲/贷项与历史无原始凭证数据的处理 | 明确**禁止**自动补记不明来源的历史总账；给出 `accountingProfile` 的兼容式扩展机制；历史缺口登记为 `M1-F-10` | **是** | 是（WP-7） |
| `C-P04` | Accounting 未 Domain Closure 时委外 Source→Canonical Voucher 的有界接入边界 | 界定边界为：**只**接入 `createSystemVoucher` 的既有接口，不新建委外专用 GL；角色映射在裁定前不存在 | **是** | 是（WP-7） |
| `D-P01` | VMI 结算窗口、消耗与物权转移的前后顺序、可结算数量口径 | 给出 **D-1 / D-2a / D-2b / D-3 四个有界备选**（D-2 按"是否先做 Owner Change"拆为两个子形态）及各自的物理与商业恒等式，**推荐 D-2a**（物理腿最少、恒等式最简）；落地与模型无关的结算期/行表、七量分列与 VMI-P/S/E/C/R/L 恒等式断言。**不得自动采用任一模型** | **是** | 是（WP-4 的触发模型部分、WP-8） |
| `D-P02` | VMI 物权释放数量的协议价格、税、账单日期、部分结算 | 明确移除客户端金额与账单 ID；价格必须来自权威源（协议价/采购价目表）；账单走 canonical Supplier Bill | **是** | 是（WP-8 的价格部分） |

##### 26.33.14.2 本 Design 语义项状态（含已闭合项）

| ID | 内容 | 仍未决 | 阻塞 |
|---|---|---|---|
| `M1-P-01` | **倒冲数量基数歧义（R1 已按已批准规则收敛）**：现状 `outsourcing_material_list.required_quantity` 由**客户端**在 `snapshotMaterialList`(`outsourcing.js:223`) 提交，**无 BOM 校验、无基数声明**；现状公式 `required_i × cumulativeFinished / order_quantity` 只在「`required_quantity` 是订单总量」时成立。同时 `previewOutsourcingDifference` 的 `expected = required × order_quantity / order_quantity ≡ required` 与 `applyOutsourcingDifference` 的累计口径**单位不一致**（`outsourcing-finance.js:338` vs `:360`）。**R1 裁定 = 优先继承已批准的 OUT-09 委外用料清单快照规则**（`document.md §31.3.3`：快照承载 `BOM/version / component / **per-unit quantity** / scrap / required quantity`，Release 后 master BOM 改变**不**回写历史，额外材料走 Supplement）**＋ OUT-08 的 BOM 消费规则**（消费 canonical `resolveEffectiveBomForCaller(db, productId, 'OUTSOURCE', businessDate)`，`engineering-bom.js:672`；**禁止** `ACTIVE LIMIT 1` 选择器）。因此**主歧义（每单位用量 vs 订单总量）不再需要新裁定**：快照必须同时承载 `per_unit_quantity` 与 `required_quantity`（订单总量口径 = per-unit × order_quantity），倒冲基数取 `required_quantity`，`preview` 与 `apply` 必须使用同一口径 | 否（主歧义已由**已批准**规则闭合） | 否（残余见 `M1-P-02`） |
| `M1-P-02` | **损耗（scrap）是否计入倒冲基数，以及 BOM 计量单位与物料清单 `unit` 不一致时的换算系数**。OUT-09 的快照规则把 `scrap` 与 `per-unit quantity` **并列**为快照字段，但**未裁定** scrap 是否放大 `required_quantity`（从而放大倒冲量与材料成本），也未裁定 BOM 单位↔`outsourcing_material_list.unit` 的换算系数。**本 Design 不自行选择答案**，登记为待业务 Owner 裁定 | **是** | 是（WP-2 的成本部分 / `M1-GB02` 的成本断言段）。**不**阻塞 WP-2 的跟踪与估值合同 |
| `M1-P-03` | **角色授予矩阵（C-09 新增的业务授权项）**。本 Design 已固化"委外**业务**权限与加工费**应付**权限分离"这一职责分离原则，并指定注册 `SUPPLIER_BILL_MANAGE`、把委外过账门禁从 `allowAny` 收紧为单权限 `allow(actor,'SUPPLIER_BILL_MANAGE')`、以及 `role-accounting` 获得该权限。**但以下属业务授权决定，本 Design 不自行决定**：除 `role-accounting` 外是否设立独立的委外业务角色、该角色持有哪些 `OUTSOURCING_*` 权限、以及 `SUPPLIER_BILL_MANAGE` 是否还应授予其它既有角色 | **是** | 是（WP-0 的权限注册子项）。**不**阻塞 `SUPPLIER_BILL_MANAGE` 的**注册**与门禁收紧本身 —— 门禁收紧可先于授予矩阵落地（无人持有该权限即无人能过账，属 fail-closed） |
| `M1-P-04` | **VMI 调整量的关期容差（R4-05 新增的业务容忍度项）**。R4 裁定 VMI 调整量是**有符号量**，且关期门禁为 `\|unallocated_adjusted_qty\| > VMI_ADJUSTMENT_TOLERANCE_QTY` ⇒ 拒绝关期。**本 Design 的默认容差 = 0（严格）**。是否允许非零容差（例如允许 \|未归属调整量\| ≤ 0.5 的尾差过账）、容差适用到哪一类调整量（供应商池 / 企业池 / 两者），属**业务容忍度政策** —— **本 Design 不自行选择**，只固化"默认严格"与"正负同等阻断"这两条技术前提 | **是** | 是（WP-4 的关期子项 / `M1-GD01`）。**不**阻塞 VMI-P/S/E/R/L 恒等式本身与 `vmi_settlement_lines` 的分列实现 —— 那些在容差 = 0 下即可实施 |

**R4-5 权威开放政策清单（12 项）**：`A-P02`、`B-P01`、`B-P02`、`C-P01`、`C-P02`、`C-P03`、`C-P04`、`D-P01`、`D-P02`、`M1-P-02`、`M1-P-03`、`M1-P-04`。本轮没有批准其中任何一项。`A-P01` 单列 `OWNER_RATIFICATION_PENDING`；`M1-P-01` 的主歧义已由已批准 OUT-09 / OUT-08 规则闭合，其残余只归 `M1-P-02`，不得重新列入开放政策。

##### 26.33.14.3 R1 的 8+1 项发现去重处置（`M1-F-05`…`M1-F-12` + `M1-P-01`）

处置口径只有四类：**本轮 Design**（技术合同已在本 Design 内修正）／**仅作为跨域阻塞**（登记并转交对应 Domain，本轮不修改）／**需要 Requirement 决策**（业务政策未裁定，`POLICY_DECISION_PENDING`）／**仅待运行验证**（静态事实已确定，缺的是运行证据）。**R3 更正**：`M1-P-01` 的主歧义已由**已批准**规则闭合，其处置类别是**本轮 Design**，**不是**"需要 Requirement 决策"；真正仍需业务裁定的是其残余 `M1-P-02`。

| ID | 内容 | R1 去重结论 | 处置类别 | 本轮具体动作 |
|---|---|---|---|---|
| `M1-F-05` | §31.11 的 UAT-15（Planning handoff exactly-once） | **历史验收与当前源码的时序协调**，不是当前缺陷。§31.11 由 `09abeb4`(2026-10-09 15:43) 记录；`consumePlanningHandoff` 由 `4e035c5`(2026-10-09 19:31) 落地，晚约 3 小时 48 分。**§31.11 的历史结论不得被覆盖**，只登记时序差 | **本轮 Design**（事实陈述已更正）＋**仅待运行验证** | `M1-D-26` 更正 §26.33.2、§26.33.14、§26.33.12 的 RACE-07 映射；剩余 = 运行时证据 + MySQL 并发证据（归 WP-6 / `M1-GT01`） |
| `M1-F-06` | canonical `createSupplierBill` 与委外路径共享「缺 `supplierInvoiceNo` → 500」缺陷 | **Finance 跨域问题**：canonical 侧（`commercial-golive.js:283`）不在 §31.12 范围 | **仅作为跨域阻塞** | 本轮**不修改** canonical 侧；委外侧已由 §26.33.4.3 的输入校验消除。转交 Finance 域独立授权 |
| `M1-F-07` | VMI 消耗与物权转移对同一 SUPPLIER 位的**双扣路径**（`procurement-vmi.js:155-173` / `:195-220`，两者都在事务外读 `business_status`，转移量不受消耗量约束） | **D 组 VMI 状态机**问题，不是 B 组 | **需要 Requirement 决策**（D-P01） | 恒等式 **VMI-P / VMI-S / VMI-E / VMI-C / VMI-R / VMI-L**（R3 更名，R2 的 VMI-1..VMI-5 已作废）与 **D-1 / D-2a / D-2b / D-3** 四个有界备选已在 §26.33.4.4 / §26.33.10.5 落地；模型选择仍 `POLICY_DECISION_PENDING` |
| `M1-F-08` | `src/pages/inventory-hub.jsx`、`src/pages/inventory-overview.jsx` 调用**不存在**的 `apiClient` 导出 | **Inventory Domain 独立问题**，不在 §31.12 U-01 范围 | **仅作为跨域阻塞** | 本轮**不修改**；转交 Inventory 域独立授权 |
| `M1-F-09` | `quality-gates.js:147-153` 的「可检状态」白名单为 `['DRAFT','CONFIRMED']` | **A 组 Quality 状态机**的配套白名单缺口（引入 `PENDING_INSPECTION` 后 IQC 无法建检验） | **本轮 Design**（技术合同已指定） | §26.33.5.1 已指定把 `PENDING_INSPECTION` 加入白名单；实现归 WP-3，**不**单独阻塞 |
| `M1-F-10` | 委外退货现状会写无原始委外凭证对应的普通采购贷项凭证 | **C-P03 的直接对象**，属 C 组 | **需要 Requirement 决策**（C-P03） | R4-6 把实物退货、商业贷项、AP、GL 四层拆开；裁定前在会计 helper 之前 fail closed，禁止调用 `createCommercialCreditNote` / `applyCreditAdjustment`，不是等到缺角色后失败 |
| `M1-F-11` | `vmi_receipts.business_status` 的 CHECK 含 `'CONSUMED'`，但**全仓库无写入** | **D 组 VMI 状态机**的陈旧状态值 | **需要 Requirement 决策**（是否启用）+ **仅待运行验证**（确认无写入） | §26.33.5.4 明确**不启用**（启用无业务依据且会改变 `getVmiSummary` 语义）；保持 `POLICY_DECISION_PENDING` |
| `M1-F-12` | `audit_logs` 无 `business_date` / `request_id` / before-after 结构化字段，`created_at` 无索引 | **对应工作包的 Audit/Schema** 问题，属 Platform/Finance 域 | **仅作为跨域阻塞** | 本轮**不修改**审计 schema；`audit_logs` 仍是唯一业务审计 sink（§26.33.9）；转交 Platform/Finance 域 |
| `M1-P-01` | 倒冲数量基数歧义 | **优先继承已批准的 OUTSOURCE BOM Snapshot 规则**（OUT-09 快照 + OUT-08 BOM 消费），主歧义闭合 | **本轮 Design 已闭合（不再是待决项）** | **R3 更正**：本项**不再**被描述为"需要 Requirement 决策"或任何待决状态 —— 主歧义（每单位用量 vs 订单总量）已由**已批准**的 OUT-09 / OUT-08 规则闭合。残余真歧义（损耗计入、BOM↔物料 UOM 换算）单独登记为 **`M1-P-02`**（`POLICY_DECISION_PENDING`）；`M1-P-01` 本身不再整体阻塞 |

**去重后的计数**：1 项（`M1-F-05`）改判为历史时序差；2 项（`M1-F-06`、`M1-F-08`）与 1 项（`M1-F-12`）转交外域；2 项（`M1-F-09`）与本轮 Design 的技术合同合并；3 项（`M1-F-07`、`M1-F-10`、`M1-F-11`）依赖业务政策；1 项（`M1-P-01`）收敛为 `M1-P-02`。**没有任何一项被静默关闭，也没有一项被表述为已获批准。**

**G-5 的处置（R2/C-10 明确）**：`document.md §35.8` 登记的 G-5（UAT-14 旧 oracle 与 V21 owner-dimension 合同不一致）**仍为已登记的历史风险**，其**处置动作**已由 `document.md §31.12.6`（D-REQ-03）**批准** —— UAT-14 必须针对当前 V21 合同（创建 201 / 确认 200），拒绝恢复过时 409 作为测试捷径。因此 G-5 **不再是**"是否可以修改测试"的业务政策待决项；它是 **Implementation 内的已批准纠正动作**（归 WP-6 / `M1-GT02`）。本 Design **不改写** §35.8，也**不**重新征询该决定。

**R2 新增待决项登记**：`M1-P-03`（角色授予矩阵，C-09）—— 见 §26.33.14.2。它是**唯一**由 R2 新增的业务政策项；R2 的其余九项纠正均为**技术**合同纠正，不新增业务政策。

#### 26.33.15 Explicit Implementation Blockers and HARD STOP

**当前状态**：`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变。本节是 **Design 草案（R4-6 技术合同修订后）**，不是 Acceptance。

**可提交 Owner 复核的技术合同部分**：R4-5 已把 WIP 全行隔离、NULL 转换 fail-closed、适用交期不可绕过、POSTED 超额异常识别、五字段 Mutation Key、VMI 残差关系写成一致合同。零交期路径、POSTED 超额后的最终会计处置与历史证据规模仍分别保持 `TECHNICAL_CONTRACT_UNPROVEN` / `POLICY_DECISION_PENDING`；因此不得把整个 M1 Design 宣称为技术合同全部闭合，更不得宣布 Implementation Ready。

**阻塞部分（不得进入 Implementation）**

| 阻塞项 | 依赖的未决政策 | 后果 |
|---|---|---|
| 委外加工费的确认模型、GL 凭证、贷项角色集、历史缺口处理 | `C-P01`、`C-P02`、`C-P03`、`C-P04` | `M1-GC02` = **BLOCKED**；**且 WP-5 的过账子项一并停止**（`outsourcing_accounting_policies` 无行 ⇒ 过账必然 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`，账单保持 DRAFT） |
| 倒冲差异的审核人与权限、退补单撤销/冲销 | `B-P02` | `M1-GB03` 的审核段 = **BLOCKED** |
| 跨订单/跨期 WIP 价值携带的计价方法 | `B-P01` | WIP 转移的**数量归属**可实施；`cost_cents` 保持 NULL、`cost_state='UNVERIFIED_COST'`；计价算法 = **BLOCKED** |
| VMI 消耗/物权转移模型与可结算量口径 | `D-P01` | `M1-GD01` 的触发模型段 = **BLOCKED**；**不得**选择 D-2a 或 D-2b |
| VMI 协议价格、税、账单日期、部分结算 | `D-P02` | `M1-GD02` = **BLOCKED** |
| 倒冲数量基数的**残余**：损耗（scrap）是否计入、BOM↔物料 UOM 换算系数 | `M1-P-02`（`M1-P-01` 主歧义已按已批准 OUT-09/OUT-08 规则闭合） | `M1-GB02` 的成本断言段 = **BLOCKED**；WP-2 的跟踪/估值合同**不**受此阻塞 |
| 完成通知的拒收/退回重开与批号继承 | `A-P02` | 相应子项 = `POLICY_DECISION_PENDING`（不阻塞 WP-1 主链） |
| VMI 双扣路径的模型选择（`M1-F-07`）、委外退货贷项无原始凭证（`M1-F-10`）、`CONSUMED` 陈旧状态（`M1-F-11`） | `D-P01` / `C-P03` / VMI 状态裁定 | 均为 `POLICY_DECISION_PENDING` |
| **角色授予矩阵（C-09）** | `M1-P-03` | **不**阻塞 `SUPPLIER_BILL_MANAGE` 的注册与门禁收紧（无人持有即无人能过账，属 fail-closed）；**阻塞**把该权限授予 `role-accounting` 以外的任何角色 |
| **VMI 调整量的关期容差（R4-05 新增）** | `M1-P-04` | **不**阻塞 VMI-P/S/E/R/L 恒等式与 `vmi_settlement_lines` 分列实现（默认容差 = 0 即可实施）；**阻塞**把"非零容差"作为关期放行条件（`M1-GD01` 的关期子项） |
| **通知转换后取消是否恢复通知来源容量** | Owner 最小裁定（T-11；未新增为已批准政策） | `converted_quantity` 保持历史累计且单调；取消不恢复通知来源容量，任何重新转换 fail closed |
| **VMI 部分结算、多账单、首期历史 Owner 证据** | `D-P01` / `D-P02` + T-12 | allocation 表可设计但写路径 BLOCKED；首期期初不可证明即拒绝开期，不默认 0 |

**R1 已解除的阻塞项**

| 原阻塞项 | R1 结论 |
|---|---|
| Planning handoff exactly-once（§31.11 UAT-15 / `M1-F-05`） | **解除**：生产源码 `consumePlanningHandoff`（`outsourcing.js:98-137`）已具备 authoritative exactly-once 消费路径（`4e035c5`，2026-10-09 19:31）。§31.11 的历史结论**保持原样、不被覆盖**；剩余仅为运行时与 MySQL 并发证据 → `M1-GT01` 的 RACE-07 |

**R2 已解除/降级的阻塞项**

| 原阻塞项 | R2 结论 |
|---|---|
| UAT-14 旧 oracle 是否可改（`G-5`） | **不再是政策待决**：`document.md §31.12.6`（D-REQ-03）已**批准**该纠正，处置动作在 Implementation 中执行（WP-6 / `M1-GT02`）；G-5 仍为已登记历史风险，本 Design 不改写 §35.8 |
| 委外加工费"过账会不会悄悄发出普通采购分录" | **已闭合为技术门禁**（C-04）：source-aware 门禁在**任何** Finance 写入之前拦截；`DIRECT` 分支的凭证盲区与 `INVOICE_DRIVEN`/`PROVISIONAL` 的普通采购角色集路径均被封堵。**剩余**的是业务政策本身（C-P01..C-P04），不是技术缺口 |

**R3 / R4 / R4-5 仍为 `TECHNICAL_CONTRACT_UNPROVEN` 的技术项（这些不解除任何政策阻塞）**

| # | 技术项 | 为什么未获证明 | 归属 |
|---|---|---|---|
| T-01 | **M-15 的 PRE-A/PRE-B/PRE-C 前置检查结果** | "委外来源历史跟踪流水为零、`source_item_id` 全非空、委外身份无重复"只是**静态推断**（生产写者不使用委外来源类型），本轮**未运行数据库**，未获实测证明 | WP-0（子项）→ WP-2 的委外跟踪写入路径**依赖**其通过（`DEPENDENCY_PENDING`） |
| T-02 | **M-15 唯一索引的双端行为（三个方向，R4-09 更正表述）** | ① "重复必拒绝"方向：SQLite 部分索引与 MySQL `generatedPartialIndex` 摘要路径**等价**；② "不同必放行"方向依赖 SHA-256 无碰撞假设，**形式上不等价**；③ "谓词外行"方向**等价**。⇒ **不得**表述为"语义等价" | WP-0（子项） |
| T-03 | **M-07b 历史回填的确定性结果** | `source_material_list_id` 只能在 R4-04 收紧后的**四条**条件（产品唯一 + UOM 相等 + 供应商相等 + 供应商 WIP 仓可解析且相等）同时成立时回填；`business_date` 只能在 `transfer_date` 匹配日期格式时回填。历史数据的实际可回填比例**未运行验证** | WP-0（子项） |
| T-04 | **历史收货 C1/C2 成本缺口的规模** | 历史成品入库估值与材料倒冲实物扣减**必然缺失**（§26.33.5.1 的源码事实），但受影响的**行数与金额**未实测 | WP-3（子项）；处置属**独立授权** |
| T-05 | **委外 RACE-01..RACE-11 与 MySQL 并发证据** | 本轮未运行 MySQL | WP-6（子项） |
| **T-06** | **交期容差字段的历史取值分布** | `upper_tolerance_pct` / `lower_tolerance_pct` 的写入路径**不校验**（`procurement-orders.js:133-140`）⇒ 历史上可能存在 > 100 或单位不一致的值。R4 已固定消费口径为**百分数单位**并要求写入路径校验，但**历史分布未实测** | WP-0（子项，容差字段校验）；WP-1（子项，容量口径） |
| **T-07** | **M-15 在 MySQL DDL 自动提交下的"部分完成后重试"实测** | R4 已给出每个中间状态的重试语义（§26.33.7 的 R4-08 表），但"PRE-C 失败后列与回填保留、重跑仍中止、索引不创建"的**实际行为**未在 MySQL 上验证 | WP-0（子项） |
| **T-08** | **遗留来源行“未证明转换量”的规模** | M-12a 写 NULL；R4-5 明确这些行既按全量保守预留，又禁止正向转换。过严阻断规模未实测 | WP-0 / WP-1 子项；独立授权历史对账 |
| **T-09** | **遗留 WIP 受影响集合与全行隔离规模** | M-07c 不再累计事件量，而把 `legacyAffected` 行当前 WIP 全量隔离；候选行数、隔离总量与业务停机范围未实测 | WP-0 / WP-2 子项；Owner Acceptance 评估 + 独立历史对账 |
| **T-10** | **交期消费量不可证的范围** | R4-5 已指定 `schedule_consumption_effects` 为未来唯一权威；但多交期 PO 行的历史已确认收货缺少交期归属，不能迁移进该账本。受影响行数未实测 | WP-1 子项；独立授权历史对账 |
| **T-11** | **通知转换后取消的来源容量语义** | 已批准 Requirement/§22 capability 基线没有证明取消后允许再次转换。R4-6 保留累计事实、不恢复通知来源容量；Owner 尚未裁定是否需要不可变 conversion reversal ledger | WP-1 子项；裁定前 fail closed |
| **T-12** | **VMI 首期期初 Owner 维度的历史可证明范围** | 首期必须从 canonical inventory position 快照建立；历史是否存在 owner 维度缺失或 legacy 未归属库存，本轮未连接数据库，影响范围未知 | WP-4 子项；不可证即 `VMI_OPENING_BALANCE_UNPROVEN` |
| **T-13** | **MySQL destructive Gate 的独立目标与逐次授权** | 当前只有只读核验事实；没有本轮 destructive 授权，也未创建独立 disposable run database。**R4-6-R1 补充**：四重 ACK 中 **ACK-1 / ACK-2 / ACK-3 已有真实源码实现**（`server/test-utils/mysql-disposable-target.js:19-37`），**ACK-4（绑定 run ID + commit SHA 的一次性授权）为 `PROPOSED / NOT IMPLEMENTED`**（**R4-6-R2 已确定其完整未来合同**：三个环境变量、UUIDv4 / 40 位 SHA / 与 `git rev-parse HEAD` 一致 / run token 一致 / 授权人显式提供的规范 `RUN_ACK` 字符串、跨进程跨重启的一次性消费账本 `scripts/gates/.state/mysql-destructive-acks/<run_id>.json`、原子创建不允许覆盖、必须在第一次 DROP 之前消费、已存在 RUN_ID 必须拒绝、中途失败亦不得重用、记录不含数据库密码）—— 但**本轮不修改任何 ACK 代码**，故 **ACK-4 仍未实现**、一次性消费**未经验证**、`T-13` 继续 `TECHNICAL_CONTRACT_UNPROVEN`；数据库身份验证（`CURRENT_USER()` / `@@server_uuid` / `VERSION()` / grants 摘要）**只在 Wave 10 campaign 路径实现**（`server/test-utils/mysql-wave10-campaign-target.js:129-152`），**并发 gate 未强制**；机器级互斥**只在 `scripts/gates/run-mysql-local-gate.ps1` 实现** | WP-6 / M1-GT01；执行前独立授权与目标身份验证 |
| **T-14** | **R4-6-R1 新增、R4-6-R2 更正：证据层残差模型的历史阻断规模** | R4-6-R1/R4-6-R2 把 `legacy_unverified_wip_quantity` 收紧为**残差**（`supplier_wip − verified_tracked_wip − verified_quantity_only_wip`）⇒ **全部**无身份证据的历史 WIP 行在 M-07d 之后 `supplier_wip_available = 0`。历史发/退/补三表**无 `lot_id`/`serial_id` 列** ⇒ 历史身份**不可证** ⇒ 证据层历史行数必然为 0。**R4-6-R2 明确**：`NONE` 数量桶**不得**被算成 LOT/SERIAL 身份证明 —— 历史无身份证据的行**一律**留在残差里；历史数据**没有**可确定关联的物理流水时 ⇒ **不做身份回填、不做比例分摊、不推定 LOT/SERIAL、不减少历史隔离残差**。受影响的**行数、隔离总量与业务停机范围未实测** ⇒ 继续标记**未知** | WP-0 / WP-2 子项；Owner Acceptance 评估 + 独立历史对账（必须遵守 `ID-INDEP-4` 的残差扣除规则） |

**R4-6 跨章节一致性登记（§26.33.4–§26.33.15 全量交叉核对）**

| 检查项 | 唯一定义 / 使用与公式 | 状态 / Gate | Migration | API | Blocker |
|---|---|---|---|---|---|
| `legacy_unverified_wip_quantity` | **R4-6-R2：残差定义 + 三种数量** = `supplier_wip − verified_tracked_wip − verified_quantity_only_wip`；只由 **M-07d** 初始建立或独立历史对账调整；**常规业务 Writer 永不写**；M-07c 的历史含义保留（建立转移受影响行的初始桶），M-07d 把范围扩展为全部无身份证据的历史行 | GB02/GB03；负向动作不得消费；INV-WIP-9 残差不变性 | M-06 / M-07c / **M-07d** | B 组 WIP 动作 | T-09 / **T-14** |
| `verified_tracked_wip` / `verified_quantity_only_wip` | **R4-6-R2 拆分**：前者 = Σ `available_quantity WHERE evidence_state='TRACKED'`（LOT/SERIAL 身份证据）；后者 = Σ `available_quantity WHERE evidence_state='QUANTITY_ONLY'`（**数量桶，非身份**）。**禁止**用后者授权 LOT/SERIAL 产品 | GB01/GB02/GB03；INV-WIP-7 逐行对账、INV-WIP-8 按 tracking_policy 授权 | **M-07d** | B 组五个动作 | T-14 |
| `outsourcing_wip_identity_effects` / `outsourcing_wip_identity_effect_allocations` / `outsourcing_wip_identity_balances` | **R4-6-R1 新增两张 + R4-6-R2 新增分配表**：证据层只追加台账 + **来源分配血缘** + 物化余额；**不持有物理数量**，物理背书由同事务 canonical 腿提供（`ID-INDEP-1` 事件类型矩阵），来源血理由 allocation 表提供（权威血缘不再是单个 `source_effect_id`） | GB01/GB02/GB03；GT01 并发消费同一身份 | **M-07d** | B 组五个动作 | T-14 |
| `available_wip` / `supplier_wip_available` | `supplier_wip - legacy`，恒 `>=0`；两名称指同一派生量，代码命名采用后者；**R4-6-R2：恒等于 `verified_tracked_wip + verified_quantity_only_wip`** | GB02/GB03 | 无新列 | 所有负向 WIP API | 历史/新量不可分即 fail closed |
| `converted_quantity` | 历史累计转换事实，NULL=未证明，非 NULL 单调不减；取消不减回 | GA02 | M-12a=NULL | notice convert | T-08/T-11 |
| `schedule_consumption_effects` | §4.1 不可变 signed effect ledger；反向累计不得超过原正向；**R4-6-R1：正负 effect 的生效时点由事件时点矩阵确定；历史负向回填以"存在真实反向库存流水"为唯一入账条件** | GA02/GT01 | M-03（**扩展为七步回填链**） | 直接收货/转换/退货/取消/冲销 | T-10 / **T-13 之外的交期历史证据** |
| `deliveryScheduleId` | 显式匹配或唯一有效交期确定性绑定；多/零条 fail closed | GA02 | M-03 | 转换及 purchase receipt item | 零交期待裁定 |
| `received_quantity` | 仅由 effect ledger 派生的兼容投影，不参与授权 | GA02 | 不作为 migration 回填权威 | 无独立写 API | 历史值不能作证据 |
| `OUTSOURCING_SUPPLEMENT/BACKFLUSH` | `SOURCE_TYPES` 使用前注册；Supplement=MOVE，Backflush=单 OUT | GB01/GB02 | WP-0 代码前置，无 migration | B 组 API | M1-P-02 只阻塞倒冲成本残余 |
| `postCanonicalTrackedLeg` | 只对真实物理腿逐腿调用；WIP Transfer 禁止调用 | GB01/GB02 | M-15 身份索引 | B 组物理动作 | T-01/T-02 |
| `issueValue/receiveValue` | MOVE 成对、Backflush 仅 issue、Transfer 均无；Movement/Balance 双写 | GB02 | 无新 schema | B 组物理动作 | B-P01 不得被用来发明 transfer 成本 |
| 五字段 Mutation Key | `<SOURCE_TYPE>:event:item:leg:identity`，仅内部物理腿 | GB01/GT01 | inventory mutation log | 由服务端派生 | 与外部 API key 严格分离 |
| `Idempotency-Key` | §8 外部 API Header；canonical record + fingerprint；**R4-6-R1/R4-6-R2：scope 固定为 `(operation_type, document_id, idempotency_key)` 三元组，与 `financial-controls.js:32-58` 及 `idempotency_records` 的 UNIQUE 一致；R4-6 的四元（含 actor/tenant）scope 作废；R4-6-R2：创建类 API 使用请求期 scope `create-request:<normalized Idempotency-Key>`** | 所有 mutation Gate | 既有 idem store；effect/allocation/身份层另有事实 unique | §6/§8 矩阵（**29 条 API 记录 / 28 个唯一 operation type / 1 组别名**） | 兼容 body 不得成为新合同 |
| `postSupplierBill` | 不得作为委外顶层 orchestrator；只可复用纯 helper | GC01/GC02 | 无 | `postOutsourcingProcessingFeeBill` | C-P01..04 |
| `assertOutsourcingAccountingPolicy` | AP/GL 副作用前唯一政策门禁；零/多匹配均拒绝 | GC01/GC02 | M-16 | processing-fee post | C-P01..04 |
| `RECEIPT_NOTICE_MANAGE` | 创建/确认/取消；转换再 AND 目标侧权限 | GA02 | 已注册；不新增码 | receipt notice APIs | 角色矩阵不由本轮扩张 |
| `PROCUREMENT_NOTICE_CONVERT` | 未注册旧字面量，R4-6 作废，不得使用 | — | 不进入 M-17 | 无 | 无 |
| `outsourcing_accounting_policies` | active 闭区间唯一；NULL end=无限；保留 approval/audit | GC02 | M-16，默认空 | 受控政策维护另需授权 | C-P01..04 |
| `vmi_settlement_lines` | 物理七量、商业释放、settled 分列；首期期初有快照证据 | GD01/GD02 | M-09 | period open/close | D-P01/D-P02/T-12 |
| `settled_qty` / `bill_id` | settled=allocations 合计；bill_id 仅单 bill 兼容投影 | GD02 | M-09 allocation 表 | settlement bills | 部分结算政策未批 |
| `C-P01..C-P04` | 委外确认/GL/贷项/历史会计政策，全部 pending | GC02 BLOCKED | M-16 空表 | AP/GL/credit 路径 blocked | 未批准 |
| `D-P01/D-P02/M1-P-04` | VMI 模型/价格与部分结算/非零容差，全部 pending；默认容差 0 | GD01/GD02 BLOCKED | M-09 | VMI settlement | 未批准 |

| `outsourcing_wip_identity_effect_allocations` | **R4-6-R2 新增**：身份层**来源分配血缘**（`CONSUMPTION` / `TRANSFER_ORIGIN`）；**权威多来源血缘不再是单个 `source_effect_id`**；FIFO、严格同域（订单 / 物料行 / 产品 / identity） | GB02/GB03；INV-WIP-11 来源血缘完整性 | **M-07d** | B 组五个动作 | T-14 |
| `outsourcing_finished_return_items` | **R4-6-R2 新增**：成品退货的**明细级**来源（`return_id` ↔ `outsourcing_receipt_item_id`）；**历史不回填**（无明细级归属，**不得**按比例拆分） | GA02；退回明细唯一对应原始正向交期 effect | **M-03 扩展**（不新增编号） | 成品退货 API | T-10 / 交期历史证据 |
| `Route Status` | **R4-6-R2 新增**：API 的**路由注册状态**（`EXISTING_REGISTERED` / `EXISTING_ROUTE_TARGET_SEMANTICS_CHANGE` / `NEW_DESIGN_TARGET` / `ALIAS`）；**6** 条 `NEW_DESIGN_TARGET` 当前**不存在** | GT01/全部 mutation Gate | 无（纯文档标注） | §26.33.6 / §26.33.8 矩阵 | 路由未注册前不可执行 |
| ACK-4 | **R4-6-R2 已确定完整未来合同**（三个环境变量 + 规范 `RUN_ACK` 字符串 + 跨进程一次性消费账本）；**本轮未实现**，`PROPOSED / NOT IMPLEMENTED` | GT01 | 无（未来需新增消费账本文件） | MySQL gate launcher | **T-13** |
一致性结论：同一字段/动作/API 的权威语义已收敛到上表锚点；R1–R4-5 历史文字若仍描述统一五动作流程、旧 effect UNIQUE、未注册权限或单 `bill_id` 权威关系，均由 R4-6 明确取代。**R4-6-R1 进一步取代三处**：① R4-05 的"隔离桶独立数量字段 / 未受影响行取 0"（改为**残差定义**）；② R4-6 的"四元幂等 scope（含 actor/tenant）"（改为与 canonical 源码一致的**三元 scope**）；③ §26.33.4.4 的"非取消期间"重叠措辞（改为 **`OPEN` 与 `CLOSED` 均参与**）。**R4-6-R2 进一步取代五处**：① R4-6-R1 的单一 `verified_identity_wip`（改为 **`verified_tracked_wip` 与 `verified_quantity_only_wip` 两种证据的严格分离**）；② R4-6-R1 的"所有正向身份事件都由 `tracked_inventory_movements` 背书"（改为**按事件类型 × tracking_policy 的背书矩阵**）；③ 把单一 `source_effect_id` **当作**完整来源血缘（改为 **`outsourcing_wip_identity_effect_allocations` 分配表**，该字段降级为历史兼容字段）；④ R4-6-R1 的"委外成品退货与采购退货竞争同一原始 effect"（改为**同一 Handler、同一原始 effect**，委外场景单独 `BLOCKED`）；⑤ R4-6-R1 对 `postProcessingFeeBill` 作为会计政策创建者的描述（改为 **`BLOCKED` / `NO_REGISTERED_ACCOUNTING_POLICY_WRITER`**）。未解决项均保持 policy/technical blocker，没有通过技术修订冒充业务批准。

**R4-5 未改变任何业务政策阻塞**：开放政策固定为 12 项：`A-P02`、`B-P01`、`B-P02`、`C-P01..C-P04`、`D-P01`、`D-P02`、`M1-P-02`、`M1-P-03`、`M1-P-04`。`A-P01` 独立 `OWNER_RATIFICATION_PENDING`；`M1-P-01` 已闭合。没有任何政策在本轮获批。

**Design 阶段的硬性边界**

- 本节**未**修改任何实现代码、测试、Migration 或配置；**未**运行 MySQL、浏览器或业务测试；**未**执行 Git add/commit/push/merge/tag。
- 本节**未**签发任何 Capability 的 `COVERED`，**未**签发 Domain Acceptance、Freeze 或 Release Readiness；§31.12.9 的 13 个 Gate **编号不变**，`execution_status` 全部 `NOT_RUN`，`readiness_status` 9 个 `NOT_RUN` + 4 个 `BLOCKED`（§26.33.12）。
- §31.12 的业务合同、Gap 映射、Capability 归属与十项未决政策**未被本节改写**；本节只做技术裁定，并把不能由技术裁定的部分显式标记为 `POLICY_DECISION_PENDING`。**推荐方案一律未被表述为用户已批准。**
- **R1 修订的边界**：只改写本节内已登记的技术合同；`document.md §31.12` 的 R-ACC 修改保持原状，**未**追加新 Requirement，**未**改变已批准的业务合同。
- **R2 修订的边界**：保留既有结构、`M1-D-01..26` 编号、`WP-0..WP-8` 与 13 个 Gate 的编号与状态；只改写本节内已登记的设计段落；**未**修改 `document.md`。
- **R4 修订的边界**：保留 `M1-D-01..36` 编号、`WP-0..WP-8`、13 个 Gate 的**编号**与**状态**（`execution_status` 13/13 `NOT_RUN`；`readiness_status` 9 `NOT_RUN` + 4 `BLOCKED`）；只改写本节内已登记的技术合同；**未**修改 `document.md`；**未**新增业务政策批准；**未**宣布任何工作包 Implementation Ready。R4 的十一项更正若与 R3 的措辞冲突，**以 R4 为准**；R3 的历史措辞**保留**在其原文位置并显式标注"已作废/已取代"。
- **R4-5 修订的边界**：保留同一编号与状态；仅修订 §26.33 技术合同。R4-5 与 R4 措辞冲突时以 R4-5 为准；未修改 Requirement、未执行 Implementation/数据库/测试/Git 写操作。
- **R4-6 修订的边界**：保留 `M1-D-01..36`、M-01..M-18、`WP-0..WP-8` 与 13 Gate 编号/状态；补强逐动作、effect、VMI、RBAC、幂等、政策区间和测试授权合同。未修改 Requirement、代码、测试、Schema/Migration 实现或数据库；R4-6 明确授权的分支/提交/双远端交付不构成 Implementation 或 Acceptance。
- **R4-6-R1 修订的边界（2026-11-01）**：保留 `M1-D-01..36`、M-01..M-18（新增**子步** `M-07d`，**不**改 M-07a/b/c 的历史含义）、`WP-0..WP-8` 与 13 Gate 编号/状态；新增 `RACE-05a / RACE-06a / RACE-10a / RACE-11a` **子编号**（`RACE-01..RACE-11` 的编号与历史含义**全部保留**）；新增技术风险 `T-14`。本轮**只**修订 `solution.md §26.33` 与 `log/2026-11-01.md`；**未**修改 `document.md`、README、生产代码、测试、Schema/Migration 实现、配置；**未**运行数据库、Migration、MySQL、浏览器或任何测试；**未**执行 Git add / commit / push / merge / reset / rebase / tag / release / deploy；**未**批准任何业务政策；**未**签发任何 Capability 的 `COVERED`、Design/Domain Acceptance、Freeze 或 Release Readiness。
- **R4-6-R2 修订的边界（2026-11-01）**：保留 `M1-D-01..36`、`M-01..M-18`（**不新增 Migration 编号**；`outsourcing_finished_return_items` 作为 **M-03 的扩展**）、`WP-0..WP-8` 与 13 Gate 编号/状态；`RACE-01..RACE-11` 的编号与历史含义**全部保留**（仅修正 R4-6-R1 已新增的四个子编号的内容与状态）。本轮**只**修订 `solution.md §26.33` 与 `log/2026-11-01.md`；**未**修改 `document.md`、README、生产代码、测试、Migration 实现、数据库 Schema 文件、配置；**未**连接数据库、**未**执行 Migration、**未**运行 MySQL Gate、**未**运行任何测试或 build；**未**执行 Git add / commit / push / merge / reset / rebase / tag / release / deploy；**未**修改任何 ACK 代码；**未**批准任何业务政策；**未**签发任何 Capability 的 `COVERED`、Design/Domain Acceptance、Freeze 或 Release Readiness。
- **DESIGN HARD STOP**：按 `AGENTS.md §4.3`，本节完成后必须停止，等待业务所有者明确批准 Design；**未获批准不得进入 Implementation**。
- 本节标出的 `M1-F-08 / M1-F-12 / M1-F-06` 需要业务所有者确认转交相应 Domain；`M1-F-05 / M1-F-09 / M1-P-01` 已收敛或指定实现项；`M1-F-07 / M1-F-10 / M1-F-11 / M1-P-02 / M1-P-03` 等待业务政策裁定。

**本轮结束标识**

```text
R4-6-R2_CORRECTION_COMPLETE_PENDING_INDEPENDENT_REVIEW
```

> **R4-6 的 `R4-6_CORRECTION_COMPLETE_PENDING_INDEPENDENT_REVIEW` 与 R4-6-R1 的 `R4-6-R1_CORRECTION_COMPLETE_PENDING_INDEPENDENT_REVIEW` 均为历史记录**，依次由 R4-6-R1、R4-6-R2 的标识取代。R4-6-R2 **不是**重新设计 M1、**不是**重新审计 Requirement、**不是** Implementation。

- 该标识只表示 R4-6-R2 的文档勘误完成并等待独立复核，**不是** Owner Design Acceptance、**不是** Domain Acceptance / Freeze / Release Readiness。
- `TECHNICAL_CONTRACT_UNPROVEN` 子项仍包括零交期路径、T-01..T-14 的运行/历史证据与通知取消容量语义；其中 **T-13 继续 `TECHNICAL_CONTRACT_UNPROVEN`**（ACK-4 未实现）。
- `POLICY_DECISION_PENDING` 仍覆盖 12 项开放政策；A-P01 仍独立待追认，M1-P-01 仍已闭合。
- 13 个 Gate 的 `execution_status` 仍为 **13/13 `NOT_RUN`**，`readiness_status` 仍为 **9 `NOT_RUN` + 4 `BLOCKED`**。

