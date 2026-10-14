# Modern ERP — Phase G1 Global Implementation Status Audit

> 日期：2026-10-14（Asia/Shanghai）
> 审计基线：`master@cb356ecba25c7bbc34e8e19244a01a4f575f6e43`
> 发布身份：`package.json = 1.6.2`；最近 release tag = `v1.6.2`；当前提交为 `v1.6.2-118-gcb356ec`
> 性质：非 canonical 的只读证据快照。本文不修改 Requirement、Design、实现状态或 Freeze 状态。

## A. Executive Summary

本轮对九个目标领域完成了全局实现状态审计。结论不是“全部完成”：当前产品已经具备六个前序领域的大量可执行实现，Sales & Customer 仅完成 Wave 0 基础设施，Accounting & Analytics 与 Platform 仍是部分实现且尚未进入正式 Domain Closure。

最重要的状态校正如下：

1. **Procurement & Outsourcing 的三个旧 blocker 已在当前源码关闭，但当前浏览器验收脚本发生合同漂移。** `OUT-05` 已 exactly-once 消费 authoritative planning handoff，`OUT-17` 已有委外完工收货通知，`OUT-18` 已支持 `OUTSOURCING_RECEIPT` IQC；对应 MySQL 11-race 历史证据也已补齐。因此 README 与 `document.md §31.11` 的“25/28、三个 blocker、NOT READY”不再代表当前实现。与此同时，`scripts/acceptance/procurement-outsourcing-functional-uat.mjs:235-240` 的 UAT-14 仍要求 VMI receipt 返回旧的 409 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE`，而 V21 当前合同已允许 create 返回 201，并在 confirm 时写入 `SUPPLIER` owner truth。该问题分类为 **`CURRENT ACCEPTANCE HARNESS DRIFT — REVALIDATION REQUIRED`**：历史 28/28 与 MySQL 11/11 证据继续保留，但不得推断为当前 HEAD 的完整 Procurement browser PASS，也不得在修正并重跑前建议最终 Freeze。
2. **Inventory & Warehouse 旧 Gap 列表大量过期。** Bin、Stock Status、Form Conversion、Lock/Reservation、Barcode、Container、native receipt/issue、period close 等均已有 schema/module/API/test 证据。仍应保留的 Gap 是组织范围、跨组织、进一步移动执行深度及部分高级分析/集成，而不是把已落地能力继续写成 MISSING。
3. **Finance Operations 已达到“实现完成、验收证据可用、用户 Freeze 未核实”。** 当前源码有 58-capability implementation，历史执行证据包括 32/32 UAT、24/24 responsive、15/15 Finance MySQL races；但 `log/2026-10-12.md:226` 明确声明该证据不自行构成用户 Acceptance/Freeze。
4. **Sales & Customer 不能按文档完成度误判为产品完成度。** Requirement、Technical Design、Implementation Wave Plan 以及 Wave 0 已明确 PASS/FROZEN；`server/migrations/sales-customer-domain.js:13` 的 migration registry 仍为空，Waves 1–13 明确 NOT IMPLEMENTED / NOT ACCEPTED。
5. **Accounting & Analytics 是下一主线候选，但不是从零开始。** Voucher/SoD、GL、Trial Balance、P&L、Balance Sheet、期间、标准成本基础、经营分析已经可执行；Cash Flow、Smart Accounting/Event Engine、报表设计器、管理会计、完整固定资产仍是主要缺口。
6. **Platform 应作为受边界约束的支撑轨。** RBAC、用户/角色、六类聚合审批、审计、通知、route registry/lifecycle 已存在；Generic Workflow 路由仍 disabled，Organization Scope、通用 Document Relation/Conversion、统一 Numbering 尚未形成平台级闭环。

上一轮 G1 全局审计在同一 HEAD 的真实执行结果为：`pnpm test:fast` 368/368、`pnpm test` 2370/2370、`pnpm build` PASS。本次 limited evidence correction 未重新运行这些命令，也未执行 MySQL、Heavy、浏览器、reset、部署或任何外部动作。

## B. Baseline and Evidence Policy

### B.1 Repository baseline

- branch：`master`
- HEAD：`cb356ecba25c7bbc34e8e19244a01a4f575f6e43`
- `origin/master`：同一提交
- version/tag：`1.6.2` / `v1.6.2`，既有 tag 未移动
- 启动工作树：clean
- 额外 worktree 保持不动：
  - detached `cc61f3e...` 的 apply-guide-fix worktree
  - `fix/apply-guide-forward-2828c472` 的 forward-correction worktree；本次核对时其 HEAD 为 `cb356ec...`

### B.2 Evidence classes

| 标记 | 含义 | 本文使用规则 |
|---|---|---|
| `HISTORICAL_PASS` | 日志中记录的过去执行结果 | 不自动升级为当前提交的执行结果 |
| `CURRENT_SOURCE_VERIFIED` | 在当前 HEAD 检查到 schema/module/route/UI/RBAC/audit/test wiring | 证明代码存在并接线，不等同于运行通过 |
| `CURRENT_EXECUTION_PASS` | 本轮在当前 HEAD 实际运行且 exit 0 | 仅覆盖本轮实际运行的 FAST/FULL/build |

浏览器与 MySQL 结果在本轮均只可标为 `HISTORICAL_PASS`。FULL suite 的通过不替代浏览器 UAT、真实 MySQL 并发或用户 Acceptance。

### B.3 Canonical trace used

本轮从头完整读取 `README.md`、`document.md`、`solution.md`、`AGENTS.md`、`CLAUDE.md`，以及最近三个实际日志日期（2026-10-12、13、14）并扩展读取 2026-10-07 至 11 的领域闭环证据。审计追溯链保持：

`Manual → Capability → Target Domain → Current Implementation → Coverage → Gap → Requirement → Design → Implementation → Acceptance`

## C. Global Status Matrix

| Domain | Requirement | Design | Current implementation | Functional / responsive evidence | MySQL evidence | Explicit user Freeze | Remaining status |
|---|---|---|---|---|---|---|---|
| Master & Engineering | `document.md §28` Requirement；canonical downstream 记录为 V17 frozen | `solution.md §23` Technical Design | `CURRENT_SOURCE_VERIFIED`：BOM governance/resolver、Routing、reference data、substitute、ECO 与六条 registry surface | `HISTORICAL_PASS`：frontend contract + 16 viewport combinations；当前 FULL 覆盖回归 | `HISTORICAL_PASS`：functional PASS、generic concurrency 13/13 | **未找到原始明确用户批准记录**；后续日志称 FROZEN | 主体完成；保留 Organization、跨域完整消费、Mold/复杂辅助属性等边界 Gap |
| Sales & Customer | `PASS / FROZEN` | `PASS / FROZEN` | Wave 0 `PASS / FROZEN`；Waves 1–13 **未实现** | Wave 0 tests 在当前 FULL 通过；没有域最终 UAT | 仅 Wave 0 harness/schema compatibility；无 Waves 1–13 实现可验 | **CONFIRMED**，但只冻结 Requirement/Design/Plan 和 Wave 0 | 下一实现主线；Quotation/Pricing/Credit/Order Change 等仍缺失 |
| Planning | `PASS / FROZEN` | `PASS / FROZEN` | `CURRENT_SOURCE_VERIFIED`：Forecast/MRP/Planned Order/Reservation/Workbench/Instructions/handoff | `HISTORICAL_PASS`：24/24 responsive；当前 FULL 回归通过 | `HISTORICAL_PASS`：functional + concurrency PASS | **YES**（`log/2026-10-08.md:288-301`） | 主体冻结；APS、跨组织与更深策略为后续增强 |
| Procurement & Outsourcing | approved closure contract | approved `solution.md §26` design | `CURRENT_SOURCE_VERIFIED`：旧三 blocker 已关闭；全采购、VMI、委外执行链存在 | `HISTORICAL_PASS`：当时合同下 functional 28/28、responsive 28/28；**当前 UAT-14 harness drift，必须修正并重跑，不能视为当前 browser PASS** | `HISTORICAL_PASS`：generic 13/13 + domain 11/11 | **未找到明确用户 Freeze 记录** | `CURRENT ACCEPTANCE HARNESS DRIFT — REVALIDATION REQUIRED`；完成 UAT-14 修正与当前完整 browser UAT 后再进入用户 Acceptance/Freeze |
| Manufacturing & Quality | `document.md §29` Requirement；canonical downstream 记录为 V18 frozen | `solution.md §24` Technical Design | `CURRENT_SOURCE_VERIFIED`：工单、领退补、工序执行、检验、入库、WIP/成本/扫码 | `HISTORICAL_PASS`：24/24 browser；当前 FULL 回归通过 | 仅后续 generic MySQL gate 历史证据；未见独立 M&Q race matrix | **未找到原始明确用户批准记录**；后续日志称 FROZEN | 主体完成；Dispatch、Operation Transfer、NC disposition、更多检验类型仍缺 |
| Inventory & Warehouse | approved/frozen contract | approved §27 design | `CURRENT_SOURCE_VERIFIED`：44 capability 代码面与关键模块存在 | 28-UAT harness 与 responsive harness 当前存在；日志有最终关键 UAT 3/3，**未找到同一日志中的完整 28/28 实际输出**；当前 FULL 通过 | `HISTORICAL_PASS`：functional、generic 13/13、procurement 11/11、inventory 14/14 | **未找到明确用户 Freeze 记录** | 实现主体完成；完整 UAT 执行记录需统一收口，旧 Gap 列表需校正 |
| Finance Operations | frozen 58-capability contract | frozen §28 design | `CURRENT_SOURCE_VERIFIED`：recognition、AR/AP、invoice、settlement、treasury、business close、reports | `HISTORICAL_PASS`：32/32 UAT、58/58 trace、24/24 responsive；当前 FULL 通过 | `HISTORICAL_PASS`：Finance 15/15 + generic/procurement/inventory gates | **NO / NOT VERIFIED**；日志明确仅供用户验收 | `IMPLEMENTED / ACCEPTANCE EVIDENCE AVAILABLE / USER FREEZE NOT VERIFIED` |
| Accounting & Analytics | 仅 §21/§22 capability baseline；未完成专属 closure Requirement | 无专属 Domain Closure Design | `PARTIAL`：Voucher/SoD、GL、TB/P&L/BS、period、cost基础、decision reports | 当前 FULL 含会计 workflow/report/RBAC 执行并通过；无专属最终 UAT | 无专属 Accounting MySQL closure | NO | 下一主线候选；先 Audit/Coverage，再由用户确认 Gap 后进入 Requirement |
| Platform | 仅产品架构与 gap baseline | 无专属 Domain Closure Design | `PARTIAL`：RBAC、users/roles、approvals、audit、notifications、registry/lifecycle；workflow disabled | 当前 FULL 覆盖 route/RBAC/approval/platform regression | 无专属 Platform MySQL closure | NO | 作为支撑轨推进；Generic Workflow、Org Scope、通用关系/转换/编号仍缺 |

## D. Domain-by-Domain Audit

### D.1 Master & Engineering

**Coverage：`PARTIAL`（主体 closure 已实现，仍有明确 deferred/cross-domain Gap）**

- Canonical chapter identity：Requirement = `document.md §28`；Technical Design = `solution.md §23`。V17 仅是历史版本/阶段标签，不是当前章节编号。
- `CURRENT_SOURCE_VERIFIED`：`src/navigation/applicationRegistry.js:23,46-50` 提供 Products、BOM、Routing、Engineering Reference、Substitute、Engineering Change；`server/modules/engineering-bom.js:162,672` 有 effective BOM resolver；`server/modules/engineering-change.js:131-290` 有 ECO create/submit/approve/reject/apply；`server/migrations/engineering-change-schema.js:28-73` 有 schema/index。
- `HISTORICAL_PASS`：`log/2026-10-07.md:266-277` 记录 focused/full/heavy/build 和 16 viewport combinations；`:337-343` 记录真实 MySQL functional 与 generic concurrency 13/13。
- 冻结证据存在二层差异：`log/2026-10-08.md:329` 将 V17 称作 FROZEN，但最初闭环日志 `log/2026-10-07.md:351` 仍写“等待用户 Final Acceptance / Freeze”。因此本审计不补造原始用户批准。
- 真实 Gap：Organization/Organization Scope、跨域完整 substitute/MRP 与委外消费、Mold/复杂 Auxiliary Attributes、完整 APS/MES/HMI。

### D.2 Sales & Customer

**Coverage：`PARTIAL`；正式实现状态 = Wave 0 only**

- `log/2026-10-14.md:18-33` 明确 Requirement、Technical Design、Implementation Wave Plan 与 Wave 0 PASS/FROZEN，同时 Waves 1–13 NOT IMPLEMENTED/NOT ACCEPTED。
- `CURRENT_SOURCE_VERIFIED`：`server/migrations/sales-customer-domain.js:13` 的 `SALES_CUSTOMER_MIGRATIONS` 为空；这与 Wave 0“迁移基础设施、零业务表”的合同一致。
- 当前可复用基础仍包括 Customer、Sales Order、Delivery、Return、post-delivery discount、Invoice/AR 集成，但不能把它们等同于新冻结的 114 项 Sales closure 已实现。
- 主要 Gap：Quotation、Sales Pricing/Discount at order time、Credit、Order Change、commercial parties/schedules/prepayment gates、replacement obligation，以及 Waves 1–13 对应 schema/API/UI/UAT/MySQL race。

### D.3 Planning

**Coverage：`COVERED`（冻结范围内）；后续深化为 Gap，不重开已冻结事实**

- `CURRENT_SOURCE_VERIFIED`：registry 有 Forecast、MRP、Planned Orders、Reservations、Configuration、Workbench、Production/Purchase Instructions（`applicationRegistry.js:58-66,235`）；`planning-domain-schema.js:253` 有 outsourcing handoff；Planning 通过 Engineering resolver 消费 BOM（`server/modules/planning.js:387-388`）。
- `HISTORICAL_PASS`：`log/2026-10-08.md:280-301` 记录 Final MySQL Acceptance、24/24 responsive、2173/2173 FULL、MySQL functional/concurrency PASS；`:288-289` 明确 `Final Acceptance: PASS / Freeze: YES`。
- 主要增强项：APS 深化、跨组织计划、更细时界/批量/合并策略、替代料自动策略深化；这些不否定冻结范围。

### D.4 Procurement & Outsourcing

**Coverage：`COVERED`（实现面）；Acceptance 状态 = `CURRENT ACCEPTANCE HARNESS DRIFT — REVALIDATION REQUIRED`**

- OUT-05：`server/modules/outsourcing.js:85-135` 在同一业务路径重读 handoff、拒绝非 PENDING、创建订单并更新为 `CONSUMED`，保存 target/consumer/timestamp 并审计；migration 在 `server/migrations/v14-out-procurement-final-acceptance.js:22-61`。
- OUT-17：委外 receipt-notice schema/handler 已接入 Procurement Receiving，且 notice 不直接创造 inventory/GRNI/AP；对应最终验收 test 在 `server/out-final-acceptance.test.js`。
- OUT-18：`server/modules/authoritative-quality.js:53-233`、`server/modules/quality-gates.js:44-248` 与 migration `v14...js:76-118` 支持 `OUTSOURCING_RECEIPT` IQC；`server/modules/outsourcing-finance.js:91-147` 在确认时消费质量结果并产生受控库存/成本/audit。
- `HISTORICAL_PASS`：`log/2026-10-09.md:490-505` 记录当时合同下 focused、functional 28/28、responsive 28/28；`:564-584` 记录 generic 13/13、Procurement/Outsourcing 11/11、functional MySQL PASS。历史结果保持有效，但不能升级为当前 HEAD browser PASS。
- 当前合同矛盾：`scripts/acceptance/procurement-outsourcing-functional-uat.mjs:235-240` 的 UAT-14 固定要求 `POST /api/procurement/vmi/receipts` 返回 409 和 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE`。当前 route 在 `server/app.js:771-781` 分别接入 create/confirm；`server/modules/procurement-vmi.js:88-104` 的合法 create 路径返回 201，`:107-140` 的 confirm 通过 `applyInventoryMutation` 写入 `ownerType='SUPPLIER' / ownerId=supplier_id`。V21 schema 已在 `server/migrations/inventory-position-schema.js:187-188,238` 增加 owner columns/index。
- 当前正向合同还有独立 executable source evidence：`server/procurement-vmi.test.js:44-87` 验证 create 201、confirm 200、SUPPLIER position 与 ENTERPRISE stock 分离；`:91-126` 验证 consumption；`:129-190` 验证 ownership transfer 守恒与重复动作 409。`log/2026-10-10.md:1285-1325` 也明确把旧 fail-closed 期待分类为 `STALE_TEST_EXPECTATION`。
- 同类漂移扫描：其余 UAT 未发现仍固定要求旧错误码/旧依赖不可用的明显断言。UAT-21 与 UAT-22 的注释保留旧缺陷说明，但实际合同均要求当前正向 201（`functional-uat.mjs:309-343`），不属于同类漂移。
- 结论：README `:89` 与 `document.md:2172-2188` 描述的三个旧 blocker 已被实现关闭；但 Procurement 当前 Acceptance 仍被 UAT-14 harness drift 阻断。后续独立任务必须按 V21 合同修正 UAT-14，验证 VMI receipt create/confirm 与 SUPPLIER owner truth，执行当前版本完整 Procurement browser UAT，然后才进入最终用户 Acceptance/Freeze。

### D.5 Manufacturing & Quality

**Coverage：`PARTIAL`（V18 closure 主体覆盖，明确增强项仍在）**

- Canonical chapter identity：Requirement = `document.md §29`；Technical Design = `solution.md §24`。V18 仅是历史版本/阶段标签，不是当前章节编号。
- `CURRENT_SOURCE_VERIFIED`：十条 domain routes（Production Orders、Material Issues、Receipts、Analytics、Quality、Scan、Quality Configuration、IQC/OQC/QCP）；`manufacturing-quality-schema.js:253-298` 与 `manufacturing-quality.js:186-354` 覆盖 production inspection lifecycle；生产订单通过 Engineering resolver 固化 BOM（`manufacturing-orders.js:16,59`）。
- `HISTORICAL_PASS`：`log/2026-10-07-m19.md:26-53` 记录真实 browser 24/24、FAST/FULL/HEAVY/build；`:65` 仅宣告 acceptance evidence complete。后续 `log/2026-10-08.md:330` 称 V18 FROZEN，但本轮未找到原始用户 Freeze 批准文本。
- Gap：Dispatch、Operation Transfer、更完整 NC/disposition、更多 inspection type、完整 MES/HMI；byproduct final costing 属 Accounting/Costing 边界。

### D.6 Inventory & Warehouse

**Coverage：`COVERED`（44-capability 实现主体）；证据表述需收口**

- `CURRENT_SOURCE_VERIFIED`：position schema 包含 stock-status master（`inventory-position-schema.js:9,83-...`）；Bin CRUD（`warehouse-bin.js:24-80`）、Stock Status（`stock-status.js:27-83`）、Lock（`inventory-lock.js:33-80`）、Form Conversion（`inventory-form-conversion.js:17-89`）、Container（`inventory-container.js:15-111`）、native document（`inventory-native-document.js:13-50`）均存在且后端权限 fail closed。
- `scripts/acceptance/inventory-warehouse-final-uat.mjs:60-669` 当前包含 UAT-01..28 的 executable harness；`inventory-warehouse-responsive-uat.mjs:20-139` 覆盖 320/390/430/680。它们是 `CURRENT_SOURCE_VERIFIED`，本轮没有运行，不能标为 current pass。
- `HISTORICAL_PASS`：`log/2026-10-10.md:1479-1491` 记录 MySQL functional、generic 13、procurement 11、inventory 14 races、performance、2309 FULL；`:1526-1541` 记录关键最终 UAT 10/27/28 与全部 MySQL gates。
- 证据缺口：日志虽保存完整 28-UAT harness 与 responsive 合同，但未找到一条明确的完整 `PASS=28 FAIL=0 TOTAL=28` 最终输出。正式 Freeze 前应重跑并记录，而不是从“slots defined”推导 PASS。
- 仍存 Gap：Organization Scope/跨组织库存、部分高级移动执行与外设集成、进一步 aging/obsolete/ABC 产品化；README 把 Bin/Stock Status/Form Conversion/Lock/Barcode 全部列为缺失已不准确。

### D.7 Finance Operations

**Coverage：`COVERED`（冻结 Requirement 范围内）；状态必须写为 `IMPLEMENTED / ACCEPTANCE EVIDENCE AVAILABLE / USER FREEZE NOT VERIFIED`**

- `CURRENT_SOURCE_VERIFIED`：production dispatch 在 `server/app.js:2112` 调用 `handleFinanceRoute`；Delivery/Receipt 等权威 writer 在 `server/app.js:5340,5506` 调用 `recognizeFinanceExposure`；canonical recognition 位于 `finance-recognition.js:108`。Accounting role 的 bounded Finance 权限见 `server/db.js:1708`。
- `HISTORICAL_PASS`：`log/2026-10-12.md:212-224` 记录 MySQL functional、generic/procurement/inventory concurrency、Finance 15/15、performance、2363 FULL、32/32 UAT、58/58 capabilities、24/24 responsive、build/diff。
- `log/2026-10-12.md:226` 明确：“records evidence for user final acceptance review; it does not self-declare product acceptance or freeze”。这是本审计的状态上限。
- 剩余产品 Gap：更深票据背书/贴现与现金预测、批量/法定电子发票与税务硬件、多币种、Purchase Expense Allocation；完整 Fixed Asset 属 Accounting & Analytics。

### D.8 Accounting & Analytics

**Coverage：`PARTIAL`；下一主线候选**

- `CURRENT_SOURCE_VERIFIED`：registry 有 Accounting、Decision Reports、Product Costs、Cost Rates；Fixed Assets route disabled（`applicationRegistry.js:43,45,70-71,82`）。
- Accounting page 调用 P&L、Balance Sheet、Trial Balance、Period Closure（`src/pages/accounting.jsx:59,117,206-275,403`）；voucher create/submit/approve/reject/reverse 权限与 SoD 在 `server/app.js:4352-4555,6226-6227`；Decision Reports 后端同时要求 `REPORT_VIEW` 与领域权限（`decision-reports.js:66-77`）。
- `CURRENT_EXECUTION_PASS`：本轮 FULL 的会计角色实际覆盖 Voucher create/submit、自己不能 approve、Admin 审批、三张报表读取、期间权限隔离，全部通过。
- Gap：Cash Flow、Smart Accounting Rule/Accounting Event Engine、Voucher Template 深化、Business↔GL reconciliation 产品化、Report Designer/Formula Engine、Management Accounting/Operating Ledger、完整 Fixed Asset lifecycle、完整成本核算 closure。
- 尚无专属 Audit → Requirement → Design，因此下一步只能先做 domain audit/coverage，不能直接写实现。

### D.9 Platform

**Coverage：`PARTIAL`；bounded support track**

- `CURRENT_SOURCE_VERIFIED`：RBAC/users/roles schema（`server/db.js:913-933`）、audit（`:1470`）、notifications（`:1619`）、approval workflow foundation（`:1632`）；owned routes 对 notifications/workflows 的单一 owner 在 `server/app.js:1471-1496`。
- 聚合审批中心当前支持 Sales Order、Purchase Order、Inventory Check、Accounting Voucher、Purchase Requisition、Production Order 六类（`server/modules/approvals.js`）；当前 FULL 对 route registry、五角色 RBAC、审批 SoD、通知页面与 lifecycle 回归通过。
- Generic Workflow route 在 registry 中 disabled（`applicationRegistry.js:83`）；已有 list/create foundation 不等于可用的通用 workflow orchestration。
- Gap：Organization/Organization Scope、Generic Workflow runtime/adoption、generic Document Relation/Conversion、统一 Numbering、平台级可观测/治理深化。

## E. Stale / Contradiction Register

| Location | Stale claim | Current evidence | Classification / action |
|---|---|---|---|
| `scripts/acceptance/procurement-outsourcing-functional-uat.mjs:235-240` | UAT-14 要求 VMI receipt 固定返回 409 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE` | V21 create 返回 201；confirm 写入 SUPPLIER owner position；当前 positive tests 已覆盖 | **CURRENT ACCEPTANCE HARNESS DRIFT — REVALIDATION REQUIRED**；只登记，后续独立修正并完整重跑 Procurement browser UAT |
| `README.md:89` | Procurement functional browser 25/28；OUT-05/17/18 未关闭 | 当前代码已实现；`log/2026-10-09.md:490-505,564-584` 保存当时合同下 28/28 + 11/11 MySQL races；当前 UAT-14 drift 另行阻断当前 browser PASS | **STALE**；后续独立文档任务修订 README，不得用历史 28/28 代替当前重验证 |
| `document.md:2172-2184` | 同一三个 blocker，Domain `NOT READY` | 修复提交后的当前源码与后续日志已覆盖 | **DATED CHECKPOINT / STALE AS CURRENT STATUS**；应增加 superseded 标识，不能删除历史证据 |
| `document.md:2188` | 指定 11 个 Procurement races 无 MySQL 实证 | `log/2026-10-09.md:564-566` 已记录 11/11 real MySQL | **STALE**；保留历史但需后续 canonical reconciliation |
| `README.md:101-106` | Barcode、Bin、Stock Status、Form Conversion、完整 Lock 均作为当前 Gap | 当前 modules/schema/UAT harness 均存在 | **STALE / OVERBROAD**；只保留尚未覆盖的深度或外设/跨组织 Gap |
| `README.md:184-185` | “Credit、Barcode、完整 Outsourcing 尚未完成” | Credit 仍未完成；Barcode inventory baseline 与 Outsourcing closure 已落地 | **MIXED / PARTIALLY STALE**；应拆开陈述 |
| `document.md:504` | Master 当前 Gap 含 Resource/Equipment、Calendar、Substitute、ECO | V17 当前源码已存在这些能力 | **STALE SUMMARY**；§21 概览落后于 §28/current source |
| `document.md:506-507` | Planning/Procurement 仍以 early PARTIAL 与 Sourcing/VMI/Outsourcing 为主要 Gap | 两域后续 closure 已实现并有验收证据 | **STALE SUMMARY**；不可用作当前 roadmap |
| `document.md:509-510` | Inventory/Finance 仍列大量已完成能力为主要 Gap | V21/V22 current source + logs 已实现 | **STALE SUMMARY**；需要未来经用户授权的 canonical refresh |
| `README.md:113` | “完整 Fixed Asset 生命周期”置于 Finance Operations Gap | `document.md:2814` 已冻结 B3107 ownership 为 Accounting & Analytics | **OWNERSHIP WORDING MISMATCH**；应移动到 Accounting & Analytics |
| `solution.md:3944` | Procurement final verdict `NOT READY` | 后续 fix + MySQL final gate 已通过 | **HISTORICAL VERDICT**；必须显式标记被后续证据 superseded |

说明：本轮只登记，不修改上述 canonical 文件。历史 checkpoint 不应删除；正确做法是用后续状态说明其已被取代。

## F. Source, Route, RBAC and Test Inventory

### F.1 Current application surface

- canonical registry：66 routes = 61 active + 5 disabled；当前 FULL 有同值不变量测试。
- 九域 route 分布：Accounting & Analytics 7、Sales 5、Platform 5、Procurement 6、Master 6、Inventory 6、Finance 12、Manufacturing 10、Planning 9。
- disabled：Fixed Assets、Cash Journals、Bills、Workflows、Data Cleanup。
- launcher 仍是八个业务域；Platform 不进入业务 launcher，符合架构约束。

### F.2 Cross-cutting controls

- Backend authorization：handler 内 `allow/allowAny` fail closed；前端隐藏不作为授权。
- SoD：Sales/Purchase/Voucher creator 与 approver 分离；当前 FULL 的五角色矩阵通过。
- Transaction/audit：高风险库存、委外、财务、会计 writer 存在 transaction、source/idempotency/audit 证据；本审计未声称逐函数重新证明全部并发语义。
- SQLite/MySQL：当前 source 保留双路径；真实 MySQL 只引用历史受保护 disposable execution。
- Tests：manifest 当前 15 FAST、164 FULL，全部 `*.test.js` 受分类治理；Heavy 与 MySQL 未在本轮触发。

## G. Current Execution Evidence

下表是上一轮 G1 全局审计在同一 `cb356ec...` HEAD 上已真实取得的结果。本次 limited correction 仅修正文档，没有重跑，也没有把这些结果重标为本次执行。

| Command | Result | Evidence class | Notes |
|---|---|---|---|
| `pnpm.cmd test:fast` | 368 tests / 36 suites / 368 pass / 0 fail | `CURRENT_EXECUTION_PASS` | 首次 `pnpm` 被 PowerShell execution policy 拒绝，改用同一 pnpm 的 `.cmd` launcher；出现既有 Vite HMR port 24678 warning，不影响 exit 0 |
| `pnpm.cmd test` | 2370 tests / 348 suites / 2370 pass / 0 fail | `CURRENT_EXECUTION_PASS` | 164 files；临时 SQLite；无 skip/cancel/todo |
| `pnpm.cmd build` | PASS；Vite 7.3.6；1958 modules | `CURRENT_EXECUTION_PASS` | production client build |
| MySQL / MySQL concurrency / performance | **NOT RUN** | n/a | 本轮没有明确 disposable MySQL 授权；只引用历史证据 |
| Heavy / browser / responsive scripts | **NOT RUN** | n/a | 本轮审计不把历史或 source harness 伪装为 current pass |

## H. Recommended Roadmap — Answers to the Seven Decisions

1. **先完成 G1 审计修正与外部评审。** 本文件完成证据纠偏后即停止，不把文档修正扩展成测试修复或业务实现。
2. **Sales & Customer Wave 1 是下一条已获授权的主要 Implementation 任务。** 继续严格遵守已冻结的 `solution.md §30` Wave Plan；本次修正不得改变 Wave allocation、内容或顺序。
3. **另设 Acceptance Closure Track。** Procurement UAT-14 按 V21 合同更新并执行完整 browser UAT、Inventory 完整 28-UAT 收口、Finance 用户 Acceptance/Freeze，以及 Master/Manufacturing Freeze provenance 核实，均属于后续独立 closure 工作。
4. **Closure Track 不自动成为 Sales Wave 1 的前置阻塞。** 它可以在后续独立阶段处理；不得仅因“仍待收口”而擅自暂停已经授权的 Sales Wave 1。
5. **只有可证明的具体跨域业务依赖才能形成真正 Wave blocker。** 必须指出受影响的 Sales capability、调用/数据链、权威 owner、失败行为与证据；抽象的“其它域未 Freeze”不足以构成 blocker。
6. **Accounting & Analytics 仍须从 Audit/Coverage 开始。** 只有用户确认其 `PARTIAL / MISSING / SEMANTIC_MISMATCH` 后才能进入 Requirement；不得直接设计或实现。
7. **Platform 继续作为 bounded supporting track。** 只有已确认业务 Gap 需要 Generic Workflow、Organization Scope、Document Relation/Conversion 或 Numbering 时，才进入独立 Audit/Requirement/Design；不得建立第二套业务 truth。

并行关系可概括为：主实施线 `G1 external review → Sales Wave 1`；独立收口线 `Procurement UAT-14/browser revalidation + Inventory 28-UAT + Finance/user-freeze decisions`。两条线默认互不阻塞，除非后续出现具体、可复核的跨域依赖证据。

## I. Risks, Blockers and Non-Actions

- 本轮没有发现阻止生成全局审计快照的 blocker。
- Procurement 最终 Acceptance 当前存在明确证据 blocker：UAT-14 harness 与 V21 owner-dimension 合同冲突。它阻止把历史 28/28 宣告为当前 HEAD browser PASS，也阻止在重验证前建议 Procurement Freeze；它**不自动阻塞 Sales Wave 1**。
- 最大治理风险是把 canonical 文档中的历史 checkpoint 当作当前状态；尤其 Procurement/Inventory/Finance 的旧 Gap 会误导 roadmap。
- 最大交付风险是把“tests exist”或“历史 PASS”写成当前 PASS；本文已分级避免该问题。
- 当前 FULL 通过证明当前回归基线绿色，但不能代替 domain browser UAT、MySQL race、性能、用户验收。
- 未修改 application code、schema/migration、README、document、solution、package version 或 tag。
- 未 stage、commit、push、merge、tag、deploy、release、reset database 或改写历史。

## J. Verdict

审计范围、九域矩阵、过期状态登记、当前源码核实、当前隔离回归以及 roadmap 已完成；Procurement UAT-14 drift 已作为独立 Acceptance blocker 登记，未越权修改脚本、运行浏览器验收或宣告任何新的 Domain PASS/FROZEN。

**PHASE G1 — CORRECTED / READY FOR EXTERNAL REVIEW**
