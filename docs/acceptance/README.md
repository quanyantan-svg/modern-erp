# 验收与冻结证据

> 状态：`ACTIVE`（证据目录）
> Owner：Platform
> 权威来源：**无** —— 本目录保存验收 / 冻结 / 实施证据，**不是**当前需求、架构或项目状态的权威来源。
> 当前 Requirement：[`docs/requirements/`](../requirements/)；当前 Design：[`docs/design/`](../design/)；
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)

## 目录

| 路径 | 内容 |
|---|---|
| [`g0-governance-acceptance-20261101.md`](./g0-governance-acceptance-20261101.md) | G0 开发治理重构的正式验收记录（`G0_ACCEPTANCE_PASS`，2026-11-01）—— 治理层验收，**不含**任何业务 Domain Acceptance |
| [`m1-core-requirement-design-acceptance-20261102.md`](./m1-core-requirement-design-acceptance-20261102.md) | M1-Core Requirement / Design 正式验收（`M1_CORE_REQUIREMENT_ACCEPTANCE_PASS` / `M1_CORE_DESIGN_PASS`）；Implementation 未授权，非 Domain Acceptance |
| [`m1-core-wp1-implementation-acceptance-20261102.md`](./m1-core-wp1-implementation-acceptance-20261102.md) | M1-Core WP1 Implementation 正式验收（`M1C_WP1_IMPLEMENTATION_PASS`）；不等于 `M1C-G01 PASS`，非 Capability Freeze / Domain Acceptance |
| [`m1-core-wp7a-gate-acceptance-20261103.md`](./m1-core-wp7a-gate-acceptance-20261103.md) | M1-Core WP7-A 首期非破坏性验收**执行记录**（G01–G06 逐 Gate 证据矩阵、G05 缺陷登记、G07 MySQL 执行准备）；**未签发**任何 Gate PASS，非 Domain Acceptance |
| [`m1-core-g05-independent-review-20261103.md`](./m1-core-g05-independent-review-20261103.md) | M1-Core G05 修复独立技术审查（`M1C_G05_INDEPENDENT_REVIEW_PASS`）；Owner 正式 Acceptance 仍为 `PENDING_APPROVAL`，未签发 `M1C-G05 PASS` |
| [`m1-core-wp7b0-design-promotion-20261103.md`](./m1-core-wp7b0-design-promotion-20261103.md) | M1-Core WP7-B0-R1 Design 三项批准与 Active Promotion 独立记录；Implementation、MySQL、M-15、Migration 与 Gate PASS 均未授权/未签发 |
| [`m1-core-wp7-combined-implementation-20261104.md`](./m1-core-wp7-combined-implementation-20261104.md) | M1C-WP7-COMBINED Implementation 证据：ACK-4、并发错误码/编号、M-15 离线代码、G07 Oracle/Parity 与统一回归；真实 MySQL/Migration 未运行，非 Acceptance/Freeze |
| [`m1-core-wp7-r1-closure-20261104.md`](./m1-core-wp7-r1-closure-20261104.md) | M1C-WP7-R1 收口证据：N7 根因与历史修正、G07 生命周期收口、Ed25519 Child Lease、N7 前置治理与回归耗时优化；真实 MySQL/Migration 未运行，非 Acceptance/Freeze |
| [`m1-core-wp7-g07-r2-readiness-20261104.md`](./m1-core-wp7-g07-r2-readiness-20261104.md) | M1C-WP7-G07-R2 执行准备收口证据：固定 Fixture、独立 Oracle、独立 postflight、子进程生命周期修复；真实 MySQL/Migration 未运行，非 Acceptance/Freeze |
| [`m1-core-g07-execution-and-acceptance-review-20261105.md`](./m1-core-g07-execution-and-acceptance-review-20261105.md) | M1C-G07 一次性真实 MySQL 执行与 M1-Core 候审包；G07 在 `CR-08.issue` Setup 失败，清理已证明，结论 `M1_CORE_ACCEPTANCE_BLOCKED`，待 Owner 复核 |
| [`m1-core-g07-rerun-a4c97802-20261105.md`](./m1-core-g07-rerun-a4c97802-20261105.md) | 新 SHA 单次 G07 重跑：Fixture Setup 已越过 CR-08，Suite 已启动但 child exit 1；逐项 stdout 未保留，清理已证明，结论仍为 `M1_CORE_ACCEPTANCE_BLOCKED` |
| [`m1-core-g01-g06-consolidated-review-20261105.md`](./m1-core-g01-g06-consolidated-review-20261105.md) | G07 Suite 失败证据链最终离线收口，以及 G01～G06 精确证据矩阵、G05 Owner 决策包与最小剩余阻塞；只供候审，不签发 Gate PASS |
| [`m1-core-g05-owner-acceptance-20261105.md`](./m1-core-g05-owner-acceptance-20261105.md) | M1-Core G05 正式 Owner Acceptance（`M1C-G05 PASS`，2026-11-05）；原始 16/24 失败历史保留、24/24 修复证据、仅批准 G05、不依赖 G07 |
| [`m1-core-g02-g06-owner-acceptance-20261105.md`](./m1-core-g02-g06-owner-acceptance-20261105.md) | M1-Core G02/G06 正式 Owner Acceptance（`M1C-G02 PASS` / `M1C-G06 PASS`，2026-11-05）；接受两 Gate 无单独真实 MySQL 证据的残余风险，不豁免 G01/G03/G04/G07 |
| [`m1-core-g07-final-execution-and-acceptance-20261105.md`](./m1-core-g07-final-execution-and-acceptance-20261105.md) | M1C-G07 最终一次性真实 MySQL 执行（Run `94e2e0c7`）与七 Gate 候审矩阵；Suite exit 1、逐项证据不可恢复、G07=`FAIL`、`M1_CORE_ACCEPTANCE_BLOCKED` |
| [`m1-core-g07-final-fix-review-20261106.md`](./m1-core-g07-final-fix-review-20261106.md) | Run `dcfbf040` 两项阻塞的离线闭合证据；CR-02 IQC digest 已获 Owner 批准并激活为唯一固定 Fixture，历史 G07 FAIL 保持 |
| [`m1-core-g07-parity-r3-review-20261106.md`](./m1-core-g07-parity-r3-review-20261106.md) | Run `df0202b6` 唯一失败（Schema Parity，14 表 4 类差异）的根因与离线修复候审证据；统一索引 digest 规则、方言感知目录解码、脱敏结构证据采集；未重跑真实 G07，历史 G07 FAIL 保持 |
| [`m1-core-g07-parity-r4-review-20261106.md`](./m1-core-g07-parity-r4-review-20261106.md) | Run `a78b0d3e` 唯一失败（Schema Parity，5 张表目录表达式括号）的真实根因与保义括号规范化候审证据；范围受限表达式 AST、S 表达式树形比较、真实导出夹具与 16 表离线回放；第一轮独立源码复核 `M1C_G07_PARITY_R4_REVIEW_BLOCKED` 的两项 AST 缺陷（字面量类别、CAST 长度）已由 R4-R1 定向修复，第二轮发现的 CAST 字符集无条件丢弃已由 R4-R2 定向修复；未重跑真实 G07，历史 G07 FAIL 保持 |
| [`m1-core-g07-owner-acceptance-20261107.md`](./m1-core-g07-owner-acceptance-20261107.md) | M1C-G07 正式 Owner Acceptance（`M1C-G07 PASS`，2026-11-07）；Run `b29c3f1f` / SHA `054ebb67` 单次真实 MySQL 执行：11/11 PASS、16 表 Schema Parity 全 MATCHED、CR-01～CR-09、Root FINISHED、五类对象归零、ACK-4 一次性消费；仅批准 G07，不签发包级 Acceptance / Freeze / Release |
| [`m1-core-wp7a-r1-offline-evidence-20261107.md`](./m1-core-wp7a-r1-offline-evidence-20261107.md) | M1-Core 第一批最小离线补证候审证据（WP-A / WP-B / WP-E / WP-F / WP-H）：G03 的 L2 canonical inventory primitive 碰撞负控、G03 拒绝路径 18 表完整业务事实快照、G04 成品唯一 Writer 与逐批成本估值对账、G01 历史 25 项 + 后补 D0 的逐项归属与执行记录对照；四项变异实验证明非空洞；未签发任何 Owner Acceptance |
| [`sales-customer/`](./sales-customer/) | Sales & Customer 各 Wave 的 Acceptance / Freeze 记录与实施证据 |

## 规则

- 证据文件**引用**合同，不复制合同正文；
- 证据中的历史 PASS **不得**被描述为当前 HEAD 的 PASS；
- 冻结标识、冻结边界、Git 锚点与排除项必须原样保留；
- 新的验收证据不得写入 `document.md` / `solution.md` / `docs/requirements/` / `docs/design/`。
