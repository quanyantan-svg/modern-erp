# OUT-001 Candidate Freeze 记录（2026-11-09）

> 用途：把 OUT-001 的**技术候选基线**固定在一个精确提交上，并留存该提交上**离线**回归的真实
> 退出码与已证明 / 未证明边界，供 Owner 复核后再单独决定远端 Push 与真实 MySQL Gate 的授权。
>
> Owner：业务所有者（远端 Push 与真实 MySQL Gate 的最终授权）；Platform（冻结记录与证据维护）。
>
> 状态：`FROZEN` —— **Candidate Freeze（技术候选基线冻结）**。本文**只是**技术候选基线冻结，
> **不是**业务 Capability Freeze、**不是** Gate Acceptance、**不是** Domain Acceptance、
> **不是** Manual Closure、**不是** Release Readiness，也**不**签发 `GATE_READY` / `GATE_AUTHORIZED` /
> `GATE_ACCEPTED` 或任何 Acceptance。
>
> 权威来源：Active Requirement [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md)
> §31.14.2；Active Design [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md)
> §26.34.14.3、§26.34.16、§26.34.16.3、§26.34.16.3.1；唯一项目状态登记表
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §45.18～§45.25。
>
> 本文是冻结**证据**，不取代 Requirement、Active Design 或唯一项目状态登记表。**本文件的生成本身
> 不构成远端同步、Merge、Tag、Release 或 Deploy。**

---

## 1. 冻结对象

| 项 | 值 |
|---|---|
| Candidate 名称 | `candidate/out001-d4c97a8`（**本地分支**，本轮**未 Push**） |
| 冻结 SHA（完整） | `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec` |
| 冻结 SHA（短） | `d4c97a8` |
| Source branch | `fix/out001-launcher-tap-summary-0adfecb6` |
| Source SHA | `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec`（与冻结 SHA **相同**） |
| 冻结提交标题 | 记录 OUT-001 M3 提交在 GitHub 上的远端同步事实 |
| 冻结提交父提交 | `dc58771ba91ea41b1876b4de3e14cb78848b32ce` |
| Candidate HEAD 与冻结 SHA 一致 | **是**（`git rev-parse HEAD` 与 `git rev-parse candidate/out001-d4c97a8` 实测均为 `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec`） |
| Candidate 分支新增提交 | **0 条**（回归全程未产生任何提交；冻结后该分支仍精确指向 `d4c97a8`） |
| `package.json` version | `1.6.2`（未变） |

冻结点与 Source SHA **精确相等**：候选不是从源分支"再往前"的某个近似点，而是源分支当前 HEAD 本身。

## 2. 前置核验（实际值）

| # | 核验项 | 实际结果 |
|---|---|---|
| 1 | 工作树状态 | clean（无未提交、无未跟踪文件） |
| 2 | 本地 source branch HEAD | `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec` ✓ |
| 3 | `git ls-remote github refs/heads/fix/out001-launcher-tap-summary-0adfecb6` | `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec` ✓（与本地一致） |
| 4 | `candidate/out001-d4c97a8` 是否已存在 | **本地不存在、GitHub 不存在** → 未覆盖任何既有候选 ✓ |
| 5 | `master`（本地 = GitHub） | `97eea5a58bad774b36fbe0e94d60a1e35c2c3a3b`（未变） |
| 5 | `candidate/out001-075e0f6`（GitHub） | `075e0f6e61108a423c4ae0b194199edec2bc9465`（保留，未变） |
| 5 | `candidate/out001-97eea5a`（GitHub） | `97eea5a58bad774b36fbe0e94d60a1e35c2c3a3b`（保留，未变） |
| 5 | `candidate/out001-a5fffd1`（GitHub） | `a5fffd10835336fc5137ff2768290f5c34def4ea`（保留，未变） |
| 5 | `fix/out001-mysql-test-fixtures`（GitHub） | `075e0f6e61108a423c4ae0b194199edec2bc9465`（保持不变） |
| 6 | `package.json` version | `1.6.2` ✓ |
| 7 | release tags | 本地 `29`；GitHub `3`（`v1.6.0` / `v1.6.1` / `v1.6.2`）；Gitee `29` —— 数量与构成均未变 |

**旧 candidate 全部保留**：三条旧 candidate 的 ref 与 SHA 均未被本工作包改动或删除。
另如实登记：本地存在一条**仅本地**分支 `candidate/out001-163e43c`
（`163e43cdb7b52e2f90f711539573284db3b4c123`，`master` 的祖先），GitHub 上无对应 ref，
不在本冻结范围内，未被改动。

## 3. 候选上的离线回归（真实退出码）

全部命令在 `candidate/out001-d4c97a8`（= `d4c97a8`）上执行。**未运行任何真实 MySQL Gate**。

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `node --test server/mysql-out001-m3-uncertain-commit.test.js` | `0` | `23/23 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 2 | `node --test server/mysql-out001-gate-infrastructure.test.js` | `0` | `44/44 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 3 | `node --test server/mysql-disposable-target-guard.test.js` | `0` | `10/10 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 4 | `node --test server/outsourcing-wip-transfer.test.js` | `0` | `21/21 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 5 | `node --test server/outsourcing-finance.test.js` | `0` | `7/7 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 6 | `node --test server/outsourcing.test.js` | `0` | `5/5 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 7 | `pnpm test:fast` | `0` | `624/624 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 8 | `pnpm test`（FULL） | `0` | `3438/3438 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 9 | `pnpm build` | `0` | 构建通过 |
| 10 | `node scripts/docs/check-doc-consistency.mjs --mode migration` | `0` | `ALL CHECKS PASSED`（C1 迁移章节覆盖率 100% / C2 正文逐字保留且唯一 / C3 MIGRATION-MAP 一致 / C4 无新增失效链接与锚点 / C5 历史引用抽样可解析 / C6 无重复 Active 合同正文） |
| 11 | `node scripts/docs/check-doc-consistency.mjs`（current） | `0` | `ALL CHECKS PASSED`（N1、N3、N4、N5、N6、**N7**、N8、N9 全 PASS；N2 为 `RETIRED`，不参与 PASS/FAIL 判定） |
| 12 | `git diff --check` | `0` | 无空白错误 |

**全部 12 项退出码为 0，无一项失败**，因此本次冻结记为通过。任一项失败都应停止冻结并提交失败证据，
本轮未发生该情形。

## 4. M1～M5 的已证明范围与未证明范围

### 4.1 在本候选上**已证明**（离线）

| 项 | 已证明内容 | 依据 |
|---|---|---|
| M1 | 命名锁获取 / COMMIT-ROLLBACK 释放 / 第二会话重新获取的**代码路径**与离线夹具 | `server/mysql-out001-gate-infrastructure.test.js` 等离线套件；真实会话行为**未**在本候选上证明 |
| M2 | 不同 Key、同源并发的**离线**路径与 CAS / 全局门禁守卫 | OUT-001 SQLite focused 套件；真实并发**未**在本候选上证明 |
| M3 | 会话状态机、锁释放未确认 → 隔离 → 终止确认、**不确定 COMMIT 的处置顺序**（不 ROLLBACK / 不重跑业务体 / 标记透传 / 终止确认后才清锁登记）、账户身份核验口径与 R3 合同 | `server/mysql-out001-m3-uncertain-commit.test.js` `23/23 PASS`（含两条**变异实验**证明防回归断言非空洞） |
| M4 | CHECK / UNIQUE / FK 语义与 SQLite-MySQL Schema Parity 的**离线**部分 | OUT-001 focused 套件；真实 MySQL 约束语义**未**在本候选上证明 |
| M5 | `transfer_no` UNIQUE 冲突 → 409 的**离线**路径与生产分类器 | `server/outsourcing-wip-transfer.test.js` / `server/outsourcing-finance.test.js`；真实 MySQL 重复键错误**未**在本候选上证明 |

### 4.2 在本候选上**未证明**（真实 MySQL）

| 项 | 状态 |
|---|---|
| M1～M5 的**真实 MySQL** 执行 | **全部未在本候选上重跑**。§45.18 记录的真实 Gate 34/34 PASS 是**旧候选 `075e0f6`** 的历史事实；本候选相对 `075e0f6` 改动了 `server/db.js`（不确定 COMMIT 处置）与 `server/modules/outsourcing-finance.js`（`createWipTransfer` 的 catch/finally），二者都在 M1/M2/M4/M5 的执行路径上。**旧候选的 PASS 不得被描述为本候选的 PASS。** |
| **M3 真实不确定 COMMIT** | **`NOT_PROVEN_ON_REAL_MYSQL`** —— 从未在任何候选上被真实证明。真实故障注入装置（本地 TCP 代理 + 同账户 `KILL CONNECTION`）已实现并离线验证，但在本工作包中**未连接真实 MySQL**，因此 R1～R5 与账户身份五条断言**均未**获得真实实证。 |
| SQLite-MySQL Schema Parity（真实目录比对） | 未在本候选上证明 |
| 真实 MySQL 下的并发、命名锁跨会话释放、`transfer_no` 真实重复键 | 未在本候选上证明 |

## 5. 明确不包含的内容

本 Candidate Freeze **只是技术候选基线冻结**。本文**不**包含、也**不**签发：

| 项 | 状态 |
|---|---|
| 真实 MySQL Acceptance | **不包含** |
| ACK-4 签发或消费 | **不包含**（本工作包未签发、未消费；既有已消费的 ACK-4 不得复用） |
| Capability Freeze（业务能力冻结） | **不包含** —— 本记录**不是**业务 Capability Freeze |
| Domain Acceptance | **不包含** |
| Manual Closure / Release Readiness | **不包含** |
| Release / Deploy | **不包含** |
| `GATE_READY` | **尚未签发** |
| `GATE_AUTHORIZED` / 新的 `GATE_EXECUTED` / 技术 PASS / `GATE_ACCEPTED` | **未签发** |
| `AUD-OUT-001` Acceptance | **未签发**（仍为 `TESTED` / `PENDING_OWNER_APPROVAL`） |

本工作包**未**发生：Merge、Tag、Release、Deploy、数据库连接、RESET / BOOTSTRAP / CLEANUP、
ACK-4 签发或消费、`GATE_READY` 签发、远端 Push。

## 6. 与 §45.24 的关系

§45.24（OUT-001 M3 远端同步记录）已由业务所有者复核通过 —— 本工作包的授权即以 §45.24 为基础。
§45.24 记录 M3 最终提交 `7fda3e9` 及其后续记录提交 `d4c97a8` 在 **GitHub** 上的同步事实，
并如实登记 **Gitee 未同步**（Gitee 上不存在本工作分支与三条 candidate，其 `master` 为
`a17ef2bb45b658d1c23136406f560e83634f0bbf`，与 GitHub 的 `master` 不同）。因此本次冻结同样
**只存在于本地**：`candidate/out001-d4c97a8` 本轮**未 Push**，远端 Push 需 Owner 单独授权。

## 7. 后续授权边界

1. 本地 `candidate/out001-d4c97a8` 精确指向 `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec`，
   **不得**移动、不得新增提交、不得删除。
2. 远端 Push 该 candidate 分支、真实 MySQL Gate 的授权与执行、`GATE_READY` 签发、
   任何 Acceptance 签发，均需**单独**的 Owner 授权。
3. 真实 MySQL Gate 一旦授权，必须使用**全新**的 RunId / ACK-4 Capability；既有已消费的
   ACK-4 不得复用；候选必须仍是本记录登记的 SHA，否则本次冻结不再适用。
4. 本记录与 §45.25 之外，**不得**把本次 Candidate Freeze 描述成业务 Capability Freeze、
   Gate Acceptance 或任何形式的验收通过。

## 8. 索引

- 项目状态登记：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §45.25
- 验收与冻结证据索引：[`README.md`](./README.md)
- 当日开发记录：`log/2026-11-09.md`
