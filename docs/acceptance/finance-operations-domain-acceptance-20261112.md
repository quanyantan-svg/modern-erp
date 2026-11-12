# Finance Operations 财务运营域级 Acceptance 与 Capability Freeze 记录（2026-11-12）

> **用途**：登记业务所有者对 Finance Operations 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Finance Operations Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；**58 项 `COVERED` 能力已冻结**。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/finance-operations.md`](../requirements/finance-operations.md) §33.1～§33.50；Design [`docs/design/finance-operations.md`](../design/finance-operations.md) §28；能力矩阵 [`docs/operations/finance-operations-capability-matrix.md`](../operations/finance-operations-capability-matrix.md)；逐项判定 [`docs/audits/finance-operations-capability-audit-20261112.md`](../audits/finance-operations-capability-audit-20261112.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §56。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS
FINANCE_OPERATIONS_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在本轮对话中指示「签发域级 Acceptance 与 Capability Freeze」，并要求「FIN-RES-01、02、03 能够解决吗？最好是解决了再开始下一域」。据此：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 58 项 `COVERED` 能力**（`FINANCE_OPERATIONS_CAPABILITY_FREEZE`） |
| 能力判定 | FO01～FO58 共 **58 项**：`COVERED` **58**、`PARTIAL` **0**、`MISSING` **0**、`OUT_OF_SCOPE` **0**（55 Domain-Owned + 3 Integration-Backed：FO50 / FO57 / FO58，不得互相升降级 —— Requirement §33.4） |
| `FIN-RES-01`（RACE-01..15 真实 MySQL 行为等价未取证） | **已解决**：整改轮为本域建立独立 ACK-4 campaign `FINANCE_MYSQL_V1`，并在真实 MySQL 8.0.37 上取得实证（§2.1） |
| `FIN-RES-02`（FO02 管理面 list/upsert 无专门用例） | **已解决**：新增合同用例覆盖写入、读取与解析器消费，并带「非法模式被拒且不留行」的负例 |
| `FIN-RES-03`（N7 文档追溯债务） | **不解决**：成因是四个**已推送**历史提交的 message 缺少变更章节引用；不改写已发布历史则无法消除，且与本域能力无关。**作为显式残余随冻结接受** |
| 实现锚点 | `7a205e8`（race 套件作用域修正）；审计与整改轮的前序提交见 §7 |

决定来源是当前对话中所有者的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：整改轮后的本域 Active Contract（Requirement §33.1～§33.50 / Design §28）及其 58 项 `COVERED` 能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3108–B3113 手册级关闭）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance。

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3728/3728 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 域内 focused（`--filter finance`） | **79/79 PASS** |
| 整改轮合同套件 `server/v22-finance-closure-wiring.test.js` | **7/7 PASS**（含 FO03 未知条款 409、无方案行为不变、FO02 非法模式被拒等负例） |
| `pnpm test:finance:uat` | **32/32 PASS**；能力检查 **58/58 PASS**（矩阵形状 + 每行证据列非空 + 引用的 UAT 身份存在） |
| `pnpm test:finance:responsive`（真实 Edge） | **24/24 PASS**（六工作面 × 320/390/430/680） |
| 真实 MySQL 8.0.37 campaign（`FINANCE_MYSQL_V1`） | **PASS**，见 §2.1 |
| 治理守卫（跨域错误码耦合 / 验收记录有效性） | 双 PASS |
| 文档一致性 | `current`：N1、N3～N6、N8、N9 **PASS**；N2 `RETIRED`；**N7 FAIL**（既有历史提交的追溯债务，与本域无关）；`migration`：C1～C6 全 PASS |

### 2.1 真实 MySQL 8.0.37 证据（Requirement §33.39）

| 项 | 值 |
|---|---|
| Campaign | `FINANCE_MYSQL_V1`（manifest 操作 `RESET_SCHEMA_PRE_RUN` / `BOOTSTRAP_CURRENT_SCHEMA` / `RUN_FINANCE_RACES` / `CLEANUP_SCHEMA_POST_RUN`） |
| 套件 | `server/mysql-finance-operations-concurrency.integration.js`（16 个用例：RACE-01..15A/15B） |
| run id | `74b21f14-0e82-42fa-a302-c0359f6cef4f` |
| commit | `7a205e86995ceb205213dc1b5f6d83a6fb5614d0` |
| 结果 | `PASS`；`ACK-4 STATE = FINISHED` —— 清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明 |
| 目标身份 | `modern_erp_domain_test` @ `127.0.0.1:3306`；server uuid `256c7a4e-d275-11f1-885b-b025aa71d167`；grants sha256 `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e` |
| 入口 | `pnpm test:mysql:finance`（本机统一启动器 `run-mysql-local-gate.ps1`）；无一次性 ACK-4 capability 时 fail closed（已实测） |

Requirement §33.39 的「Must execute on: real MySQL」「SQLite-only evidence 不计入」由**真实 MySQL** 满足。Requirement §33.49 的 Hard Stop 第 12 条（MySQL migration 无法保证 parity）**未触发**。

## 3. 本次验收同时确认的事实

| 事项 | 确认内容 |
|---|---|
| 三个主数据已接线 | FO03 付款条款、FO04 多到期日计划、FO05 对账方案现在被业务路径消费；FO19 自动对账按该侧活动方案运行，无方案时行为与整改前完全一致 |
| FO36 已实现 | 发票运营报表 `GET /api/finance/reports/invoices` 按 Requirement §33.17 读取发票事实与源基数，是只读投影 |
| FO31 已收敛 | 未路由的第二写入口已删除；发票过账路径成为唯一写入口，并由源码扫描用例固定 |
| FO48 已退役 | legacy 银行对账账本的读写路由与写入口已移除；表保留为历史且不再写入 |
| 需求 §33.39 未被削弱 | 整改轮中途曾按 `MYSQL-EV-01` 临时修正该条款的指向；在真实 MySQL 实证取得后，该临时修正被撤销，**原合同条款恢复为唯一正文**，并补记证据 |

## 4. 冻结内容与解冻条件

| 冻结对象 | 说明 |
|---|---|
| 业务合同 | Requirement §33.1～§33.50 与 Design §28 为本域唯一权威正文 |
| 能力实现 | 58 项 `COVERED` 能力的端点、状态机、权限、事务、审计与错误码 |
| Schema | `v22-finance-wave-a-foundation.js` 的 Finance Closure schema（含整改轮的 `finance_payment_term_installments`）与既有迁移链共同构成冻结基线 |
| 主数据消费 | `finance-due-plan.js`（付款条款 → 到期计划）与 `settlement-core::activeSettlementScheme`（方案 → 自动对账）是本域的两条接线点，不得旁路 |
| 测试 | FULL / HEAVY / focused / 合同套件 / 浏览器 UAT / 真实 MySQL campaign 全部通过是冻结基线的一部分 |

**解冻条件**：任何对上述内容的修改都必须先走显式解冻（登记变更理由、影响范围与新的验收证据），不得以「顺手优化」扩大范围；涉及跨域合同变更（Sales 预留意图、Inventory 估值、Accounting 凭证、Planning 供给）时必须回到对应 Domain 的 Requirement / Design 层重新裁定。

## 5. 已知限制（随本次验收一并接受）

| 编号 | 残余 |
|---|---|
| `FIN-RES-03` | 文档一致性 `current` 模式的 **N7 仍 FAIL**。成因是四个**已推送**历史提交（`a40e356`、`59eccd5`、`171ade5`、`4403a80`）的提交信息没有引用其变更的章节编号或完整路径。消除它需要改写**已发布**的 Git 历史，本记录不授权；该债务与本域能力无关，任何域都不得把它记为某���域的缺陷 |

## 6. 本记录**不**主张的内容

- 不主张 B3108–B3113 手册级关闭（Manual Closure）；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张其他 Domain 的 Acceptance 或 Freeze；
- 不主张本次验收授权了真实环境 migration、业务数据库写入或远端 Git 操作。

## 7. 登记与后续

- 状态登记：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §56；能力矩阵：`docs/status/CAPABILITY_MATRIX.md` 的 B3108–B3113 行；逐项判定：`docs/audits/finance-operations-capability-audit-20261112.md`。
- 本记录取代同日的候签材料 [`finance-operations-domain-acceptance-candidate-20261112.md`](./finance-operations-domain-acceptance-candidate-20261112.md)；候签材料标记为 `SUPERSEDED`，保留作为决定过程的证据。
- 本域的整改轮提交序列：`2ef5c7f`（审计与可确定的缺陷处置）、`be3e4cd`（整改轮实施）、`d7edd17`（ACK-4 campaign）、`67559f1`（临时库守卫扩展）、`7a205e8`（race 套件作用域）。
- 按就绪度顺序，下一个域为 **Master & Engineering**（ME-01..31）。
