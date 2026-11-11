# 采购与委外域级 Acceptance 与 Capability Freeze 记录（2026-11-11）

> **用途**：登记业务所有者对 Procurement & Outsourcing 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Procurement & Outsourcing Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；50 项 `COVERED` 能力已冻结。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.1～§31.20；Design [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.1～§26.40；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §51；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)；逐项判定 [`docs/audits/b3121-domain-acceptance-audit-20261110.md`](../audits/b3121-domain-acceptance-audit-20261110.md)。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
PROCUREMENT_OUTSOURCING_DOMAIN_ACCEPTANCE_PASS
PROCUREMENT_OUTSOURCING_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在同一轮对话中先要求「完成最后的收尾，最终目标是域级 Acceptance 和能力 Freeze」，继而指示「这几个为解决矛盾需解决，解决后签发 acceptance 和 freeze」。据此作出以下决定：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`PROCUREMENT_OUTSOURCING_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 50 项 `COVERED` 能力**（`PROCUREMENT_OUTSOURCING_CAPABILITY_FREEZE`） |
| 能力判定 | PRC-01..26、VMI-01..05、OUT-01..23 共 54 项：**50 `COVERED`**、0 `PARTIAL`、0 `MISSING`、3 项按已批准决定排除在本域范围外 |
| 范围外 3 项 | PRC-06（寻源决策写入口，`SAFE_CLOSE`）、VMI-05（结算与物权释放，`D-P01/D-P02`）、OUT-22（成品退货，`MC-REQ-16`）——**不是**实现缺口，也**不得**被描述为已覆盖 |
| 实现锚点 | `b4ff57d`（G07 目录条款重新捕获）；第四轮锚点 `1c5b653`；第四轮合同层锚点 `fdb7156` |
| 真实 MySQL Gate | run `b9023437-4030-46f2-b469-0a08396bd7f6`（commit `9a4ccbb`）→ `state=FINISHED`、`testsPassed=true`、`cleanupProven=true`、`childrenExited=true` |
| 固定场景冻结产物 | `M1_CORE_G07_FIXED_FIXTURE_DIGEST = f112c88cb6d327f4885cf349de4a6c4efd6b4a4b1499e0547727e7103ccad33f` |

决定来源是当前对话中所有者的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：第四轮与第五轮整改后本域的 Active Contract（§31.1～§31.20 / §26.1～§26.40）及其 50 项 `COVERED` 能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3101 / B3121 手册级关闭）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance。

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| 真实 MySQL Gate（M1C-G07，受保护 disposable MySQL 8.0.37） | **PASS**：schema parity + CR-01..CR-09 全部通过；`state=FINISHED`、清理由 root 独立 post-flight 证明；目标 `modern_erp_domain_test` @ `127.0.0.1:3306`，server uuid `256c7a4e-d275-11f1-885b-b025aa71d167` |
| G07 离线对等回放 | **55/55 PASS**（真实 MySQL 目录捕获条款已按 run `b9023437` 的实测值更新，见 [`docs/evidence/procurement-outsourcing-domain-acceptance-20261111/`](../evidence/procurement-outsourcing-domain-acceptance-20261111/g07-outsourcing-wip-identity-effects-catalogue-capture.json)） |
| `pnpm test`（FULL） | 见 §7 登记 |
| `pnpm test:fast` | 见 §7 登记 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| focused（第四轮新增） | `procurement-sourcing-capabilities` **11/11**、`procurement-prepayment` **15/15**、`out-03-out-23` **16/16** |
| focused（第五轮新增） | `outsourcing-gl-profile-maintenance` **6/6** |
| 浏览器 UAT | `procurement-outsourcing-functional-uat.mjs` **36/36 PASS**（含第四轮新增子能力的 7 条与三个工作面 390 px 可达性闭环） |
| 文档一致性 | `current` 模式 N1、N3～N6、N8、N9 **PASS**（N2 `RETIRED`；N7 为既有历史提交追溯债务）；`migration` 模式 C1～C6 全 PASS |

## 3. 本次验收同时确认的三项裁定

| 事项 | 确认内容 |
|---|---|
| 供应商品类门禁 | **单向门禁**：品类只门禁委外业务；普通采购由采购资质门禁把关（§31.19.2 / §31.20.3） |
| M1-Core G06 被取代的断言 | 共享入口仍一律 409（跨域边界不变），**专用**入口按 `C-P02` 档案放行；2026-11-07 首期包级 Acceptance 覆盖的 G06 证据在该条断言上被 §31.19 取代，**随本次域级 Acceptance 重新确认** |
| G07 固定场景重新冻结 | 确认摘要 `f112c88cb6d327f4885cf349de4a6c4efd6b4a4b1499e0547727e7103ccad33f`（摘要链 `60f7888f…` → `aa024bd5…` → `f112c88c…`） |

## 4. 冻结内容与解冻条件

| 冻结对象 | 说明 |
|---|---|
| 业务合同 | §31.1～§31.20 与 §26.1～§26.40 为本域唯一权威正文 |
| 能力实现 | 50 项 `COVERED` 能力的端点、状态机、权限、事务、审计与错误码 |
| Schema | 第四轮四个加法迁移（`procurement-sourcing-schema`、`procurement-prepayment-schema`、`procurement-outsourcing-finance-schema`、`procurement-outsourcing-opening-schema`）与既有迁移链共同构成冻结基线 |
| 测试 | FULL / HEAVY / focused / 浏览器 UAT 全部通过是冻结基线的一部分 |
| 固定场景 | `M1_CORE_G07_FIXED_FIXTURE_DIGEST = f112c88c…` 是受保护 Gate 的冻结输入 |

**解冻条件**：任何对上述内容的修改都必须先走显式解冻（登记变更理由、影响范围与新的验收证据），不得以「顺手优化」扩大范围；涉及跨域合同变更（会计科目、期间关闭、VMI 结算、库存估值）时必须回到对应 Domain 的 Requirement / Design 层重新裁定。

## 5. 已知限制（随本次验收一并接受）

1. **委外加工费会计档案**已有产品内维护面（列出 / 建立 / 暂停 / 重新批准），但**档案引用的角色码必须已存在于启用科目**；档案不是业务单据，不得被用来绕过科目治理。
2. **第四轮新增子能力的界面可达性**已由浏览器 UAT-30..UAT-36 取证（390 px 无整页横向滚动、面板实际渲染）；§31.8 F 既有五条 operator workflow 的闭环证据不变。
3. **委外差异生效（`B-P02`）与跨单成本携带（`B-P01`）**仍按既有延期，不在本次冻结的能力范围内。
4. **VMI-05 结算与物权释放**、**PRC-06 寻源决策写入口**、**OUT-22 成品退货**三项按已批准决定排除在本域范围外，其拒绝路径与边界继续有效并继续被回归固定。
5. 新增会计科目 `6408 委外加工费` 是**跨域事实**：它登记在会计科目登记簿上，试算平衡科目集合由 21 变为 22；既有损益表与资产负债表口径不变。Accounting & Analytics 域的 Domain Closure 不因本次冻结而获得任何结论。

## 6. 本记录**不**主张的内容

- 不主张 B3101 / B3121 手册级关闭（Manual Closure）；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张其他 Domain 的 Acceptance 或 Freeze；
- 不主张 3 项范围外能力已实现或已覆盖；
- 不主张本次验收授权了真实环境 migration、业务数据库写入或远端 Git 操作。

## 7. 登记与后续

- 状态登记：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §51；能力覆盖矩阵：`docs/status/CAPABILITY_MATRIX.md` 的 B3101 / B3121 两行；逐项判定：`docs/audits/b3121-domain-acceptance-audit-20261110.md`。
- 本记录取代同日的候签材料 [`procurement-outsourcing-domain-acceptance-candidate-20261111.md`](./procurement-outsourcing-domain-acceptance-candidate-20261111.md)；候签材料保留作为决定过程的证据。
