# 历史验收记录当前有效性复核（2026-11-12）

> **用途**：登记对 `docs/acceptance/` 下**全部历史验收记录**在当前 HEAD 上的有效性复核结论，并把「历史已验收结论可否被当作当前证据引用」变成机器可验证的清单。
>
> **Owner**：Platform（治理层复核）；各 Domain Owner（对自己域的记录负责）。
>
> **状态**：`ACTIVE` —— 本记录是**复核结论**，不改写任何已签发记录，也不撤销任何已签发结论。
>
> **权威来源**：本目录的验收记录是**证据**；当前项目状态见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；本记录不替代 Requirement / Design。
>
> **机器可验证入口**：`node scripts/qa/verify-acceptance-records.mjs`（只读；指针悬空或未登记漂移时返回非零退出码）。

## 1. 为什么需要这份复核

域级验收审计发现：Planning 域 2026-10-08 的 "Final Acceptance: PASS"（`log/2026-10-08.md:283..289`）在仓库里**没有**签发记录、**没有**机器可读 token，其浏览器证据已因之后的界面改动失效，其 MySQL 证据在当前门禁基础设施下不可复现。一个**历史已验收**的结论可以长期留在文档里，而没有任何机制告诉读者它已经不成立。

本复核把这件事变成两条可执行的规则：

1. **指针不悬空**：每份验收记录引用的仓库路径必须能被解析（允许扩展名不同或路径搬迁，但搬迁必须登记）。
2. **引用有条件**：历史验收结论只有在 `CURRENT` 或 `STILL_VALID` 时才可作为当前证据引用；`SUPERSEDED` / `PENDING_DOMAIN_AUDIT` / `NEEDS_REVIEW` 的记录必须按本记录的引用规则标注。

## 2. 复核方法

| 项 | 口径 |
|---|---|
| 记录范围 | `docs/acceptance/**` 下全部 68 份 `.md`（不含 `README.md` 与各目录索引） |
| 时间锚点 | 记录自身最后一次提交时间；记录正文声明了实现锚点（`锚点 <sha>`）时以该锚点提交时间为准 |
| 指针解析 | ① 原样存在 → EXACT；② 同名不同扩展名 → EXTENSION；③ 全仓同名唯一文件 → RELOCATED；④ 都没有 → BROKEN |
| 失效判定 | 记录锚点之后，被引用的**实现路径**或**合同路径**被改动 → NEEDS_REVIEW |
| 负向引用 | 记录中明确说明「不存在」的路径（如 `src/pages/returns.js`、`server/modules/planning-reservation.js`）不计为断链 |
| 人工裁定 | 脚本**不**判断「结论是否仍成立」，只保证指针不悬空、漂移可见；结论由本记录按域范围裁定 |

## 3. 复核结论

| 类别 | 记录数 | 含义 | 引用规则 |
|---|---|---|---|
| `CURRENT` | **15** | 指针完好，被引用的实现与合同在其锚点之后均未被改动 | 可作为当前证据引用 |
| `STILL_VALID` | **3** | 指针完好；其后只有**与该域无关的加法改动**，该域能力结论不受影响 | 可作为当前证据引用，并注明「其后有无关的加法改动」 |
| `SUPERSEDED_BY_DOMAIN_ACCEPTANCE` | **36** | 同一域的能力结论已被**更晚的域级 Acceptance** 在当前 HEAD 上重新逐项取证；这些包级 / Gate 级 / 工作面级结论转为历史 | **不得**单独引用；引用该域能力时改引域级 Acceptance |
| `PENDING_DOMAIN_AUDIT` | **13** | Sales & Customer 域内记录，被引用的实现与门禁在其锚点之后被改动 | **不得**作为当前证据单独引用；待该域域级审计复核后由域级结论取代 |
| `NEEDS_REVIEW` | **1** | G0 治理验收：其文档一致性结论已被后续的双模式重构改变 | 按 §4.2 的具体说明引用 |

**引用规则（本次裁定）**：引用一份历史验收记录时，必须同时写明它的类别。`CURRENT` / `STILL_VALID` 可直接引用；其余三类必须写成「历史记录，结论已被更晚的域级验收取代」或「历史记录，结论待复核」。

### 3.1 `SUPERSEDED_BY_DOMAIN_ACCEPTANCE`（36 份）的范围

全部属于 **Procurement & Outsourcing** 域范围：M1-Core 首期包级与 Gate 级记录（31 份）、OUT-001 委外跨单 WIP 记录（2 份）、委外工作面验收（1 份）、WP-A1-01 / WP-A1-02 采购寻源记录（2 份）。

取代它们的域级结论是 [`procurement-outsourcing-domain-acceptance-20261111.md`](./procurement-outsourcing-domain-acceptance-20261111.md)（`PROCUREMENT_OUTSOURCING_DOMAIN_ACCEPTANCE_PASS`，54 项逐项复核，50 `COVERED`）。

### 3.2 `STILL_VALID`（3 份）

| 记录 | 其后的改动 | 为什么结论仍成立 |
|---|---|---|
| `accounting-analytics-domain-acceptance-20261111.md` | `server/app.js` | 改动是 **Planning 域的 3 条加法路由**（`/api/planning/planned-orders/batch/*`、`/api/planning/reservations/:id`），未触及会计与分析域的任何能力 |
| `accounting-analytics-domain-acceptance-candidate-20261111.md` | 同上 | 同上 |
| `procurement-outsourcing-domain-acceptance-20261111.md` | 4 个共享套件（`m11-planning` / `m4-blocker-source-lookup-hotfix` / `period` / `v12-release-acceptance`） | 该记录 §2.1 已把这些失败登记为 Accounting & Analytics 权限计数变更所致，并明确「本记录未代其修改，也未把该失败写成通过」；**当前 HEAD 上这 4 个套件已随权限计数更新全部转绿**（FULL 3718/3718），该残余已消解 |

### 3.3 `NEEDS_REVIEW`（1 份）

`g0-governance-acceptance-20261101.md`：其引用的 `scripts/docs/check-doc-consistency.mjs` 在 2026-11-01 之后被重构为**双模式**（`current` / `migration`），`server/mobile-shell.test.js` 也被改动。因此该记录中「文档一致性检查全项通过」的结论**已不再成立**：当前 `current` 模式的 **N7 FAIL**（四个既有历史提交的追溯债务），`migration` 模式 C1～C6 全 PASS。

N7 的成因与当前状态已登记在 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §53.3 与 §54；该 FAIL 与任何 Domain 验收无关，**不得**被记为某个域的缺陷。

### 3.4 `PENDING_DOMAIN_AUDIT`（13 份）的域级复核结果（2026-11-13 更新）

域 6 —— Sales & Customer 的域级逐项审计与整改轮已完成（[`sales-customer-capability-audit-20261113.md`](../audits/sales-customer-capability-audit-20261113.md)），
候签材料见 [`sales-customer-domain-acceptance-candidate-20261113.md`](./sales-customer-domain-acceptance-candidate-20261113.md)（`PENDING_APPROVAL`）。

| 记录 | 域级复核结论 |
|---|---|
| `wave-8-stage-d-implementation-evidence.md`、`wave-8-stage-d-verification-and-p1-remediation.md`、`wave-8-user-decision-approval.md`、`wave-8-stage-d-coverage-record.md`、`wave-8-final-acceptance-and-freeze.md` | Wave 8 能力（CAP-25 寄售 / CAP-26 服务物料）在域级逐项复核中判为 `COVERED`，对应套件在当前 HEAD 保持绿色 |
| `wave-9-final-acceptance-and-freeze.md`、`wave-10-capability-freeze.md`、`wave-10-implementation-records.md` | Wave 9 / Wave 10 信用能力（CAP-28..CAP-33）在域级逐项复核中判为 `COVERED`；**Wave 9 的两处冻结断言已按 `SC-SUP-01` / `SC-SUP-02` / `SC-SUP-03` 显式收窄**（原意保留） |
| `wave-0-2-implementation-records.md`、`batch-a-implementation-mapping.md`、`f2-implementation-status-clarification.md` | Waves 1–2 / Batch A 的实施事实在域级逐项复核中已由当前工作树重新取证；对应能力判为 `COVERED` |
| `package-b-final-acceptance.md` | 本地测试后端隔离结论在当前 HEAD 仍成立（隔离由 `scripts/testing/test-env.js` 在 runner 内自建） |
| `w11-sec-01-acceptance-and-freeze.md`、`w11-a-u1-acceptance-and-freeze.md`、`w11-a-u2-acceptance-and-freeze.md`、`w11-a-overdue-acceptance-and-freeze.md`、`w11-a-u3-*.md` | W11-SEC-01 与 W11-A U1/U2/U3 的单元级冻结在域级复核中判为仍成立（对应套件绿色）；**W11-A 整包（`W11_A_ACCEPTANCE_PASS`）仍未签发**，为业务所有者的独立决定 |

**当前分类（2026-11-13 更新）**：Sales & Customer 域级 Acceptance 已签发
（[`sales-customer-domain-acceptance-20261113.md`](./sales-customer-domain-acceptance-20261113.md)，
`SALES_CUSTOMER_DOMAIN_ACCEPTANCE_PASS` / `SALES_CUSTOMER_CAPABILITY_FREEZE`，36 项 `COVERED`）。
这 13 份域内记录因此由 `PENDING_DOMAIN_AUDIT` 转入 **`SUPERSEDED_BY_DOMAIN_ACCEPTANCE`**：
它们的能力结论已被更晚的域级 Acceptance 在当前 HEAD 上重新逐项取证，域级能力结论一律改引
域级 Acceptance 记录。**这些记录本身仍保留原样**（不撤销、不改写任何已签发结论）。

## 4. 复核的可重跑性

| 检查 | 命令 | 当前结果 |
|---|---|---|
| 指针与漂移复核 | `node scripts/qa/verify-acceptance-records.mjs` | **PASS**：68 份记录，CURRENT 15 / NEEDS_REVIEW 53（其中 52 份已由 §3 的域范围裁定归类），BROKEN 0 / 漂移未登记 0 |
| 跨域错误码耦合守卫 | `node scripts/qa/verify-error-code-coupling.mjs` | **PASS**：已登记契约耦合 2 / 未登记 0 / 死引用 0 |

两条检查都是**只读**的，可随时重跑。

## 5. 本记录**不**主张的内容

- 不撤销、不改写任何已签发的验收记录或 token；
- 不代替任何域的域级审计；
- 不主张 `PENDING_DOMAIN_AUDIT` 的 13 份 Sales 记录已被复核 —— 它们待域 6 复核；
- 不主张 `NEEDS_REVIEW` 的 G0 记录仍然成立 —— 它的具体失效点已在 §3.3 写明；
- 不构成任何 Domain 的 Acceptance、Capability Freeze、Manual Closure 或 Release Readiness。
