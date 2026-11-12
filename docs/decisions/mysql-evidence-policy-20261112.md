# MYSQL-EV-01 —— 域级验收的真实 MySQL 证据统一口径（2026-11-12）

> **决策 ID**：`MYSQL-EV-01`
> **归属**：Platform（治理与验收口径）／业务所有者（裁定）
> **状态**：`APPROVED`
> **规范来源锚点**：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §55；各域 Requirement 的 database 条款（本决策为其统一口径）。
> **不授权**：任何 Implementation、真实环境 migration、业务数据库写入、发布、部署或远端 Git 操作。

## 1. 背景

八业务域的域级验收都要求**真实 MySQL 8** 证据。但 2026-11-12 实测确认：本仓库**只有三个已批准的 ACK-4 campaign 可以运行** —— `test:mysql:m1-core`、`test:mysql:accounting-analytics`、`test:mysql:out001`；其余 MySQL 入口（`test:mysql`、`test:mysql:concurrency`、`test:mysql:legacy`、各 Sales Wave 门禁、Finance 并发门禁、Inventory demo-seed 门禁）被 `blockUnmigratedAck4Entry` **永久阻断**，不得被引用为证据。

两个可运行 campaign 的对等清单都是**域内**的：`M1_CORE_PARITY_TABLES` 是 16 张采购/库存表，`AA_PARITY_TABLES` 是 47 张会计/分析表，都不含第三个域的表。因此**其余五个域没有可运行的域级真实 MySQL 门禁**。

若每个域各判一次，会产生五份口径不一致的残余登记。

## 2. 决定

自本决策起，**全部业务域**（含已签发的三个域与剩余五个域）的域级验收，其真实 MySQL 证据一律按下列**两段口径**处理：

| 段 | 覆盖什么 | 由什么证明 |
|---|---|---|
| **schema / migration 对等** | 该域的迁移链与表结构在真实 MySQL 8 上被接受 | `test:mysql:accounting-analytics` 的 `BOOTSTRAP_CURRENT_SCHEMA` 步骤 —— 它在真实 MySQL 8 上运行**全量当前迁移集** |
| **release / reservation 行为等价**（不双发、不超分配等） | 该域的写路径在真实 MySQL 上的并发与幂等行为 | 本域 focused 套件的并发与幂等**反例**用例；**在真实 MySQL 上未被单独取证** |

两段的边界必须逐段写明，**不得**把第二段表述为已证明。

## 3. 强制要求

1. 每个域的域级 Acceptance 记录必须有一节「真实 MySQL 证据边界」，逐段写明覆盖什么、**不**覆盖什么。
2. 「真实 MySQL 行为等价未单独取证」必须作为**显式残余**登记，随冻结一并接受，并写明它**不是**已证明。
3. Requirement 的 database 条款若指向 `pnpm test:mysql` / `pnpm test:mysql:concurrency` 等**被永久阻断**的入口，必须按本决策修正指向，并把「不覆盖什么」写进合同。
4. 新建域级 ACK-4 campaign（例如 `PLANNING_MYSQL_V1`）是把这个残余升级为真实 MySQL 证据的**唯一**路径；它需要新 manifest、launcher 条目，以及业务所有者**逐次**签发 ACK-4 capability。本决策**不**授权任何此类新建工作。

## 4. 与既有结论的关系

- **Procurement & Outsourcing**（2026-11-11 签发）：其 `M1C-G07` campaign 是真实 MySQL 证据，**强于**本决策的两段口径；本决策不削弱它。
- **Accounting & Analytics**（2026-11-12 签发）：其 `ACCOUNTING_ANALYTICS_MYSQL_V1` campaign 同样强于本决策的两段口径；本决策不削弱它。
- **Planning**（2026-11-12 签发）：其 §5.1 已按本决策的两段口径写明，`PLAN-DEC-02` 由业务所有者裁定接受为残余。

## 5. 停止点

本决策只统一**证据口径**。它不关闭任何域的 Acceptance，不构成任何域的 Manual Closure 或 Release Readiness，也不改变任何已签发结论。

下一次触发复核的时机：新增域级 ACK-4 campaign，或本仓库的 ACK-4 manifest 集合发生变化。
