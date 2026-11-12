# Master & Engineering 工程主数据域级 Acceptance 与 Capability Freeze 候签（2026-11-12）

> **用途**：本文件是 Master & Engineering 域**整域 Acceptance** 与 **Capability Freeze** 的候签材料：汇总逐项能力判定、整改轮实施、Gate 证据、已披露限制与仍需业务所有者裁定的事项。本文件**不**构成 Acceptance 本身。
>
> **Owner**：Master & Engineering Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`PENDING_APPROVAL` —— 候签材料，等待业务所有者决定。逐项证据见 [`docs/audits/master-engineering-capability-audit-20261112.md`](../audits/master-engineering-capability-audit-20261112.md)。
>
> **权威来源**：Requirement [`docs/requirements/master-engineering.md`](../requirements/master-engineering.md) §28.1～§28.10；Design [`docs/design/master-engineering.md`](../design/master-engineering.md) §23；能力基线 `document.md` §22.18；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> **本文件的生成不等于** Git 提交、远端同步、发布、部署、真实环境 migration 或真实业务数据库写入。

```text
MASTER_ENGINEERING_DOMAIN_ACCEPTANCE_CANDIDATE_READY_FOR_OWNER_DECISION
```

## 1. 候签范围

| 项 | 范围 |
|---|---|
| Domain | Master & Engineering（产品架构第 1 个业务域） |
| 手册对标 | B3118 工程数据 |
| 能力集合 | `document.md` §22.18 的 **21 项能力**（Requirement §28.3 的 ME-01～ME-31 evidence 集） |
| 覆盖判定（整改前） | `COVERED` **13** 项；`PARTIAL` **5** 项（工作日历/班次、资源/设备、工序/作业、Routing Topology、Old Material Cleanup）；`MISSING` **3** 项（多组织分发、Mold / Mold Combination、Engineering Auxiliary Attributes —— 三项均已被 Requirement §28.7 排除） |
| 覆盖判定（整改后） | `COVERED` **17** 项；`PARTIAL` **1** 项（Old Material Cleanup，按 §28.4 自身的目标口径）；`OUT_OF_SCOPE` **3** 项；`MISSING` **0** 项 |
| 合同基线 | Requirement §28.1～§28.10；Design §23（§23.1 / §23.15 的归属与测试族清单按实现事实更正） |
| 本轮已实施 | 参考资料 master 生命周期（update + deactivate + 引用守卫 + 20 条路由 + 工作面接入）、路由 master 的工序级拓扑与 link 删除回退、Use-Up-Old 当前库存 cleanup candidate、界面编辑既有公式的 POST→PATCH、§22.18 覆盖矩阵同步、`document.md` 与 Design 的失真更正 |
| 不在本次范围 | Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作、其他域的 Acceptance |

## 2. Gate 证据（整改后）

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3740/3740 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 域内 focused（9 个既有工程套件） | **63/63 PASS** |
| 整改轮新增合同套件 `server/engineering-reference-lifecycle.test.js` | **7/7 PASS** |
| 整改轮新增合同套件 `server/engineering-topology-cleanup.test.js` | **5/5 PASS** |
| 浏览器（真实 Edge，`v17-engineering-frontend.mjs`，4 工作面 × 320/390/430/680） | **PASS**，含「打开参考资料详情 → 断言编辑/停用动作存在 → 断言触控目标不小于 44px」 |
| 真实 MySQL 8 | 见 §3.2 |
| 治理守卫（跨域错误码耦合 / 验收记录有效性） | 双 PASS |
| 文档一致性 | `current` N1、N3～N6、N8、N9 PASS；N2 `RETIRED`；**N7 FAIL**（既有历史提交的追溯债务，与本域无关）；`migration` C1～C6 全 PASS |

### 2.1 非空洞证明（变异实验）

| 实验 | 期望 | 结果 |
|---|---|---|
| 把生命周期按钮强制为 20px | 浏览器验收必须 FAIL | **FAIL**，精确指出 `编辑` / `停用` 两个 22px 目标 |
| 清空参考资料夹具 | 生命周期断言不得被静默跳过 | 断言已改为**强制**：无 master 行即 FAIL，并补入夹具保证四档宽度都真正打开详情（4 张详情截图） |

## 3. 必须随验收一并接受的事实

### 3.1 整改轮闭合的 5 项 `PARTIAL`

| 能力 | 整改前 | 整改轮实施 |
|---|---|---|
| 工作日历 / 班次 | 班次之外只有 create + list | Shift / Shift Pattern / Calendar Template / Work Calendar 均具备 update + deactivate 与引用守卫 |
| 资源 / 设备 | 只有 create + list | Resource / Equipment 均具备 update + deactivate 与引用守卫 |
| 工序 / 作业 | 只有 create + list | Operation / Control Code / Basic Activity 均具备 update + deactivate；被活动作业引用的基础活动拒绝停用（409） |
| Routing Topology | 路由 master 上没有工序级拓扑；删除最后一条 link 后 `topology_type` 仍留在 NETWORK | 新增 `product_routing_operations.topology` / `topology_meta`；最后一条 link 删除时回退 LINEAR |
| Old Material Cleanup | 矩阵声称「cleanup candidate 已落地」，实际只有日志行 | 新增 `GET /api/engineering/cleanup-candidates`：已退出 ACTIVE BOM 但仍有库存的组件被判为候选；**预计入供应**一段按 §28.4 仍是跨域依赖 |

### 3.2 真实 MySQL 证据边界（按 `MYSQL-EV-01`）

| 段 | 覆盖 | 证据 |
|---|---|---|
| schema 对等 | 本域 15 张新表 + 28 个加法列 + 本轮新增的 2 个工序级拓扑列，在真实 MySQL 8 上被接受 | `test:mysql:accounting-analytics` 的 `BOOTSTRAP_CURRENT_SCHEMA` 步骤在**全量当前迁移集**上运行（工程域迁移链在其中） |
| 行为等价 | 生命周期守卫、BOM 周期拒绝、快照不可变、ECO 原子应用 | 本域 focused 合同套件（含负例） |

**残余（随冻结显式登记）**：本域 15 张表**没有**列入任何可运行 campaign 的**列级** parity 清单（`M1_CORE_PARITY_TABLES` 为 16 张采购/库存表，`AA_PARITY_TABLES` 为 47 张会计/分析表），因此「真实 MySQL 上的列级 schema parity」与「真实 MySQL 上的工程域并发行为等价」均**未被单独取证**，不得表述为已证明。

### 3.3 本轮更正的文档失真

| 编号 | 失真 | 处置 |
|---|---|---|
| `ME-DEF-04` | `document.md` §22.18 声称「当前库存 cleanup candidate/log 已落地」，实际只有日志行 | 已实现候选查询；§22.18 表述同步更正 |
| `ME-DEF-05` | `document.md` §22.19 声称 `product_routing_operations.topology` 存在，该列实际在 M&Q 的快照表上 | 已在路由 master 上新增真实的工序级拓扑列；文档更正 |
| `ME-DEF-07` | Design §23.1 指向不存在的 `engineering-work-center.js` | 按实现事实更正 |
| `ME-DEF-08` | Design §23.15 的测试族名与实际文件名不符 | 按实现事实更正 |

## 4. 未解决矛盾（需要业务所有者裁定）

| 编号 | 事项 | 可选处置 |
|---|---|---|
| `ME-DEC-01` | 真实 MySQL 的列级 parity 与并发行为等价未单独取证（§3.2） | ① 接受为随冻结的显式残余；② 授权新建 `MASTER_ENGINEERING_MYSQL_V1` 域级 campaign（新 manifest、launcher 条目、业主逐次签发 ACK-4 capability） |
| `ME-DEC-02` | `Old Material Cleanup` 的「预计入供应」一段 | 按 §28.4 保持 `CROSS_DOMAIN_DEPENDENCY`，留待 Planning / Procurement 域 |

## 5. 本次候签**不**主张的内容

- 不主张真实 MySQL 上的列级 schema parity 或工程域并发行为等价已证明；
- 不主张「预计入供应」已接入 Use-Up-Old；
- 不主张多组织分发、模具 / 模具组合、复杂辅助属性已实现（三项按 §28.7 排除在本 Domain Closure 范围外）；
- 不主张 B3118 手册级关闭（Manual Closure）；
- 不主张 Release Readiness、发布、部署或生产授权；
- 不主张其他 Domain 的 Acceptance 或 Freeze。

## 6. 待业务所有者填写的决定

| 项 | 值 |
|---|---|
| 域级 Acceptance | ☐ 通过（`MASTER_ENGINEERING_DOMAIN_ACCEPTANCE_PASS`）　☐ 有条件通过　☐ 退回 |
| Capability Freeze | ☐ 签发（`MASTER_ENGINEERING_CAPABILITY_FREEZE`，17 项 `COVERED` 能力）　☐ 部分签发（能力清单：______）　☐ 不签发 |
| `ME-DEC-01` | ☐ 接受 §3.2 残余　☐ 授权新建 `MASTER_ENGINEERING_MYSQL_V1` campaign |
| 随冻结接受的残余 | 真实 MySQL 列级 parity 与并发行为等价未取证　☐ 接受　☐ 不接受（说明：______） |
| 未解决矛盾（须显式记录） | ______ |
